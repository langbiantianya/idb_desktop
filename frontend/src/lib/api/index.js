// 与 Go 主进程 FetchDatabaseData 对接的统一 API 层。
// 协议契约见 CLAUDE.md §5：单行 JSON envelope，行尾 \n 由 Go 侧负责。

import {
	FetchDatabaseData,
	FetchDatabaseDataStreaming,
	GetRuntimeInfo
} from '../../../wailsjs/go/main/App.js';
import { EventsOn, EventsOnce, EventsOff } from '../../../wailsjs/runtime/runtime.js';
import { validateWhere, validateOrderBy } from '../sqlValidate.js';

/** @typedef {'Mysql' | 'Postgres'} Driver */
/** @typedef {'SCHEMA' | 'USER' | 'TABLE' | 'DATA' | 'SQL'} Category */
/** @typedef {'LIST' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'GET_DDL' | 'GENERATE'} Action */

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

/** 构造前端校验失败的合成错误响应，避免请求打到引擎。 */
function validationError(msg) {
	return { id: uuid(), success: false, error: msg, data: null };
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

		// 注册流式数据行事件（Go batcher 可能发送单条字符串或字符串数组）
		EventsOn(streamEventName, (/** @type {string | string[]} */ raw) => {
			try {
				const items = Array.isArray(raw) ? raw : [raw];
				for (const item of items) {
					const parsed = JSON.parse(item);
					if (parsed.data) {
						onRow(parsed.data);
					}
				}
			} catch {
				// 忽略无法解析的行
			}
		});

		// 发送请求；Go 端 FetchDatabaseDataStreaming 等同于普通 Invoke 的初始化确认
		FetchDatabaseDataStreaming(JSON.stringify(req))
			.then((raw) => {
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
			})
			.catch((e) => {
				safeResolve({
					id,
					success: false,
					error: e instanceof Error ? e.message : String(e),
					data: null
				});
			});
	});
}

// -------- SCHEMA --------

/** @param {ConnectionConfig} connection */
export const listSchemas = (connection) => invoke('SCHEMA', 'LIST', connection);

/**
 * @param {ConnectionConfig} connection
 * @param {string} name
 * @param {{ charset?: string; collate?: string }} [options]
 */
export const createSchema = (connection, name, options) =>
	invoke('SCHEMA', 'CREATE', connection, { name, ...(options ? { options } : {}) });

/** @param {ConnectionConfig} connection @param {string} name */
export const deleteSchema = (connection, name) => invoke('SCHEMA', 'DELETE', connection, { name });

// -------- USER --------

/** @param {ConnectionConfig} connection */
export const listUsers = (connection) => invoke('USER', 'LIST', connection);

/**
 * 查询指定用户的权限列表（MySQL: GRANT 语句; PostgreSQL: schema/table/privilege）。
 * @param {ConnectionConfig} connection
 * @param {string} user
 * @param {string} [host] - 仅 MySQL 使用
 */
export const listUserPrivileges = (connection, user, host) =>
	invoke('USER', 'LIST', connection, { user, ...(host ? { host } : {}) });

/**
 * 查询用户被授权的所有表与权限（按 schema + table 聚合）。
 * @param {ConnectionConfig} connection
 * @param {string} user
 * @param {string} [host] - 仅 MySQL 使用
 */
export const listUserGrants = (connection, user, host) =>
	invoke('USER', 'GRANTS', connection, { user, ...(host ? { host } : {}) });

/**
 * 创建用户。
 * @param {ConnectionConfig} connection
 * @param {string} user
 * @param {string} password
 * @param {string} [host] - 仅 MySQL 使用，默认 "%"
 */
export const createUser = (connection, user, password, host) =>
	invoke('USER', 'CREATE', connection, { user, password, ...(host ? { host } : {}) });

/**
 * 删除用户。
 * @param {ConnectionConfig} connection
 * @param {string} user
 * @param {string} [host] - 仅 MySQL 使用
 */
export const deleteUser = (connection, user, host) =>
	invoke('USER', 'DELETE', connection, { user, ...(host ? { host } : {}) });

/**
 * 授予 / 回收权限。schema 取目标 database 名；privileges 例如 ['SELECT','INSERT']。
 * @param {ConnectionConfig} connection
 * @param {{ user: string; schema: string; privileges: string[]; isGrant: boolean }} payload
 */
export const updateUserPrivileges = (connection, payload) =>
	invoke('USER', 'UPDATE', connection, /** @type {Record<string, unknown>} */ (payload));

/**
 * 修改用户密码。
 * @param {ConnectionConfig} connection
 * @param {string} user
 * @param {string} password
 * @param {string} [host] - 仅 MySQL 使用
 */
export const changeUserPassword = (connection, user, password, host) =>
	invoke('USER', 'UPDATE', connection, { user, password, ...(host ? { host } : {}) });

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
 * @property {boolean} [autoIncrement]
 * @property {string} [defaultValue]
 * @property {string} [newName]  - 字段改名时传新名供引擎做 RENAME COLUMN
 */

/**
 * 创建表。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {ColumnDef[]} columns
 * @param {{ engine?: string; charset?: string; collate?: string; comment?: string }} [options]
 */
export const createTable = (connection, tableName, columns, options) =>
	invoke('TABLE', 'CREATE', connection, { tableName, columns, ...(options ? { options } : {}) });

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
 * opts.where / opts.orderBy 为可选 SQL 片段，前端先做方言级校验。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {number} [page]
 * @param {number} [pageSize]
 * @param {{ where?: string; orderBy?: string }} [opts]
 */
export function listData(connection, tableName, page = 1, pageSize = 20, opts = {}) {
	if (opts.where) {
		const err = validateWhere(opts.where, connection.driver);
		if (err) return Promise.resolve(validationError(err));
	}
	if (opts.orderBy) {
		const err = validateOrderBy(opts.orderBy, connection.driver);
		if (err) return Promise.resolve(validationError(err));
	}
	const payload = { tableName, page, pageSize };
	if (opts.where) payload.where = opts.where;
	if (opts.orderBy) payload.orderBy = opts.orderBy;
	return invoke('DATA', 'LIST', connection, payload);
}

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

// -------- SYSTEM --------

/**
 * 获取 JVM 运行时系统信息（无需数据库连接，connection 字段仍需传递）。
 * @returns {Promise<Response>}
 */
export function getSystemInfo() {
	// SYSTEM/INFO 不需要真实连接，传一个空壳即可
	const dummyConn = /** @type {ConnectionConfig} */ ({
		driver: 'Mysql',
		host: '',
		port: 0,
		user: '',
		password: '',
		database: ''
	});
	return invoke('SYSTEM', 'INFO', dummyConn);
}

/**
 * 获取 Go 进程 + WebView 运行时信息（直接调用 Go 方法，不走引擎）。
 * @returns {Promise<import('../../../wailsjs/go/main/App').RuntimeInfo>}
 */
export function getRuntimeInfo() {
	return GetRuntimeInfo();
}

// -------- Streaming --------

/**
 * 全量拉取表数据（pageSize=0 触发引擎流式响应）。
 * opts.where / opts.orderBy 为可选 SQL 片段，前端先做方言级校验。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {(data: unknown) => void} onRow
 * @param {{ where?: string; orderBy?: string }} [opts]
 * @returns {Promise<Response>}
 */
export function listDataStreaming(connection, tableName, onRow, opts = {}) {
	if (opts.where) {
		const err = validateWhere(opts.where, connection.driver);
		if (err) return Promise.resolve(validationError(err));
	}
	if (opts.orderBy) {
		const err = validateOrderBy(opts.orderBy, connection.driver);
		if (err) return Promise.resolve(validationError(err));
	}
	const payload = { tableName, page: 1, pageSize: 0 };
	if (opts.where) payload.where = opts.where;
	if (opts.orderBy) payload.orderBy = opts.orderBy;
	return invokeStreaming('DATA', 'LIST', connection, payload, onRow);
}

/**
 * 流式执行 SQL（SELECT 自动走流式，非 SELECT 正常返回）。
 * @param {ConnectionConfig} connection
 * @param {string} sql
 * @param {(data: unknown) => void} onRow
 * @returns {Promise<Response>}
 */
export const executeSqlStreaming = (connection, sql, onRow) =>
	invokeStreaming('SQL', 'EXECUTE', connection, { sql }, onRow);

/**
 * 流式造数。每张表完成后通过 onProgress 推送进度（stream:true），最终 end:true。
 * @param {ConnectionConfig} connection
 * @param {{ count: number; script: string }[]} tables
 * @param {(data: { table: string; inserted: number; total: number; index: number; sql: string }) => void} onProgress
 * @param {{ luaVersion?: string }} [options]
 * @returns {Promise<Response>}
 */
export const generateData = (connection, tables, onProgress, options = {}) => {
	const payload = { tables };
	if (options.luaVersion) payload.luaVersion = options.luaVersion;
	return invokeStreaming('DATA', 'GENERATE', connection, payload, onProgress);
};
