// 与 Go 主进程 FetchDatabaseData 对接的统一 API 层。
// 协议契约见 CLAUDE.md §5：单行 JSON envelope，行尾 \n 由 Go 侧负责。

import { FetchDatabaseData, FetchDatabaseDataStreaming } from '../../../wailsjs/go/main/App.js';
import { EventsOn, EventsOnce, EventsOff } from '../../../wailsjs/runtime/runtime.js';

/** @typedef {'Mysql' | 'Postgres'} Driver */
/** @typedef {'SCHEMA' | 'USER' | 'TABLE' | 'DATA' | 'SQL'} Category */
/** @typedef {'LIST' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'GET_DDL'} Action */

/**
 * @typedef {Object} ConnectionConfig
 * @property {Driver} driver
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {string} database
 * @property {string} [name]
 */

/**
 * @typedef {Object} Request
 * @property {string} id
 * @property {Category} category
 * @property {Action} action
 * @property {ConnectionConfig} connection
 * @property {Record<string, unknown>} payload
 */

/**
 * @typedef {Object} Response
 * @property {string} id
 * @property {boolean} success
 * @property {string | null} error
 * @property {unknown} data
 */

/**
 * @typedef {Object} ColumnMeta
 * @property {string} name
 * @property {string} type
 * @property {number} [size]
 * @property {boolean} [nullable]
 * @property {boolean} [isPrimaryKey]
 * @property {unknown} [defaultValue]
 */

function uuid() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * 调用引擎并把响应反序列化为对象。失败仍以 Response 形态返回，调用方根据 success 判断。
 * @param {Category} category
 * @param {Action} action
 * @param {ConnectionConfig} connection
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Response>}
 */
export async function invoke(category, action, connection, payload = {}) {
	/** @type {Request} */
	const req = { id: uuid(), category, action, connection, payload };
	const raw = await FetchDatabaseData(JSON.stringify(req));
	try {
		return JSON.parse(raw);
	} catch (e) {
		return {
			id: req.id,
			success: false,
			error: `invalid response from engine: ${raw}`,
			data: null
		};
	}
}

/**
 * 流式调用引擎。响应通过 Wails 事件逐行推送，onRow 回调收到每行的 data 字段。
 * 兼容引擎未支持流式的场景：此时走普通 channel 响应，直接返回。
 *
 * @param {Category} category
 * @param {Action} action
 * @param {ConnectionConfig} connection
 * @param {Record<string, unknown>} payload
 * @param {(data: unknown) => void} onRow - 每收到一行流式数据时回调
 * @returns {Promise<Response>}
 */
export async function invokeStreaming(category, action, connection, payload, onRow) {
	/** @type {Request} */
	const req = { id: uuid(), category, action, connection, payload };
	const id = req.id;
	console.log('[invokeStreaming] sending request', { id, category, action, payload });

	const streamEventName = `engine:stream:${id}`;
	const endEventName = `engine:stream-end:${id}`;

	return new Promise((resolve) => {
		let resolved = false;
		const safeResolve = (resp) => {
			if (resolved) return;
			resolved = true;
			EventsOff(streamEventName);
			EventsOff(endEventName);
			resolve(resp);
		};

		// 注册流式 end 事件
		EventsOnce(endEventName, (/** @type {string} */ raw) => {
			try {
				const parsed = JSON.parse(raw);
				if (parsed.success === false) {
					safeResolve({ id, success: false, error: parsed.error ?? 'stream error', data: null });
				} else {
					safeResolve({ id, success: true, error: null, data: null });
				}
			} catch {
				safeResolve({ id, success: false, error: 'invalid stream-end response', data: null });
			}
		});

		// 注册流式数据行事件
		EventsOn(streamEventName, (/** @type {string} */ raw) => {
			try {
				const parsed = JSON.parse(raw);
				if (parsed.data) {
					onRow(parsed.data);
				}
			} catch {
				// 忽略无法解析的行
			}
		});

		// 发送请求；Go 端 FetchDatabaseDataStreaming 等同于普通 Invoke 的初始化确认
		FetchDatabaseDataStreaming(JSON.stringify(req)).then((raw) => {
			console.log('[invokeStreaming] Go response', raw);
			try {
				const resp = JSON.parse(raw);
				if (!resp.success) {
					// 请求被拒绝（引擎未就绪等），直接返回错误
					safeResolve(resp);
				}
				// resp.success === true 时不 resolve，等待流式事件或 channel 响应
			} catch {
				safeResolve({ id, success: false, error: 'invalid streaming init response', data: null });
			}
		}).catch((e) => {
			safeResolve({ id, success: false, error: e instanceof Error ? e.message : String(e), data: null });
		});
	});
}

// -------- SCHEMA --------

/** @param {ConnectionConfig} connection */
export const listSchemas = (connection) => invoke('SCHEMA', 'LIST', connection);

/** @param {ConnectionConfig} connection @param {string} name */
export const createSchema = (connection, name) => invoke('SCHEMA', 'CREATE', connection, { name });

/** @param {ConnectionConfig} connection @param {string} name */
export const deleteSchema = (connection, name) => invoke('SCHEMA', 'DELETE', connection, { name });

// -------- USER --------

/** @param {ConnectionConfig} connection */
export const listUsers = (connection) => invoke('USER', 'LIST', connection);

/**
 * 授予 / 回收权限。schema 取目标 database 名；privileges 例如 ['SELECT','INSERT']。
 * @param {ConnectionConfig} connection
 * @param {{ user: string; schema: string; privileges: string[]; isGrant: boolean }} payload
 */
export const updateUserPrivileges = (connection, payload) =>
	invoke('USER', 'UPDATE', connection, /** @type {Record<string, unknown>} */ (payload));

// -------- TABLE --------

/** @param {ConnectionConfig} connection */
export const listTables = (connection) => invoke('TABLE', 'LIST', connection);

/**
 * 取列元数据：name / type / size / nullable / isPrimaryKey / defaultValue。
 * 协议：TABLE/LIST 在 payload 携带 tableName 时自动路由到列元数据查询。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 */
export const listColumns = (connection, tableName) =>
	invoke('TABLE', 'LIST', connection, { tableName });

/**
 * @typedef {Object} ColumnDef
 * @property {string} name
 * @property {string} type
 * @property {number} [size]
 * @property {boolean} [nullable]
 * @property {boolean} [isPrimaryKey]
 * @property {string} [defaultValue]
 * @property {string} [newName]  - 字段改名时传新名供引擎做 RENAME COLUMN
 */

/**
 * 创建表。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {ColumnDef[]} columns
 */
export const createTable = (connection, tableName, columns) =>
	invoke('TABLE', 'CREATE', connection, { tableName, columns });

/**
 * 添加列。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {ColumnDef} column
 */
export const addTableColumn = (connection, tableName, column) =>
	invoke('TABLE', 'UPDATE', connection, { tableName, operation: 'ADD_COLUMN', column });

/**
 * 修改列类型 / 长度 / 可空。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {ColumnDef} column
 */
export const modifyTableColumn = (connection, tableName, column) =>
	invoke('TABLE', 'UPDATE', connection, { tableName, operation: 'MODIFY_COLUMN', column });

/**
 * 删除列。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {string} columnName
 */
export const dropTableColumn = (connection, tableName, columnName) =>
	invoke('TABLE', 'UPDATE', connection, { tableName, operation: 'DROP_COLUMN', columnName });

/**
 * 删除表。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 */
export const deleteTable = (connection, tableName) =>
	invoke('TABLE', 'DELETE', connection, { tableName });

/**
 * 获取建表语句（DDL）。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 */
export const getTableDdl = (connection, tableName) =>
	invoke('TABLE', 'GET_DDL', connection, { tableName });

// -------- DATA --------

/**
 * 分页拉取。page 从 1 开始；pageSize 上限 1000（CLAUDE.md §9）。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {number} [page]
 * @param {number} [pageSize]
 */
export const listData = (connection, tableName, page = 1, pageSize = 20) =>
	invoke('DATA', 'LIST', connection, { tableName, page, pageSize });

/**
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {Record<string, unknown>} values
 */
export const createRow = (connection, tableName, values) =>
	invoke('DATA', 'CREATE', connection, { tableName, values });

/**
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {Record<string, unknown>} changes
 * @param {Record<string, unknown>} where
 */
export const updateRow = (connection, tableName, changes, where) =>
	invoke('DATA', 'UPDATE', connection, { tableName, changes, where });

/**
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {Record<string, unknown>} where
 */
export const deleteRow = (connection, tableName, where) =>
	invoke('DATA', 'DELETE', connection, { tableName, where });

// -------- SQL --------

/** @param {ConnectionConfig} connection @param {string} sql */
export const executeSql = (connection, sql) => invoke('SQL', 'EXECUTE', connection, { sql });

// -------- Streaming --------

/**
 * 全量拉取表数据（pageSize=0 触发引擎流式响应）。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {(data: unknown) => void} onRow
 * @returns {Promise<Response>}
 */
export const listDataStreaming = (connection, tableName, onRow) =>
	invokeStreaming('DATA', 'LIST', connection, { tableName, page: 1, pageSize: 0 }, onRow);

/**
 * 流式执行 SQL（SELECT 自动走流式，非 SELECT 正常返回）。
 * @param {ConnectionConfig} connection
 * @param {string} sql
 * @param {(data: unknown) => void} onRow
 * @returns {Promise<Response>}
 */
export const executeSqlStreaming = (connection, sql, onRow) =>
	invokeStreaming('SQL', 'EXECUTE', connection, { sql }, onRow);
