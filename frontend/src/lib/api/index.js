// 与 Go 主进程 FetchDatabaseData 对接的统一 API 层。
// 协议契约见 CLAUDE.md §5：单行 JSON envelope，行尾 \n 由 Go 侧负责。

import { FetchDatabaseData } from '../../../wailsjs/go/main/App.js';

/** @typedef {'mysql' | 'postgresql'} Driver */
/** @typedef {'SCHEMA' | 'USER' | 'TABLE' | 'DATA' | 'SQL'} Category */
/** @typedef {'LIST' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE'} Action */

/**
 * @typedef {Object} ConnectionConfig
 * @property {Driver} driver
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {string} database
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

// -------- DATA --------

/**
 * 分页拉取。page 从 1 开始；pageSize 上限 1000（CLAUDE.md §9）。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {number} [page]
 * @param {number} [pageSize]
 */
export const listData = (connection, tableName, page = 1, pageSize = 100) =>
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
