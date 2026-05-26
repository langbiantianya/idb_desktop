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

function uuid() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Wails Webview2 / WKWebView 均原生支持 crypto.randomUUID，这里仅作降级。
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * 调用引擎并把响应反序列化为对象。
 * 任何失败（管道异常、引擎业务失败）都以 Response.success=false 抛出语义错误。
 *
 * @param {Category} category
 * @param {Action} action
 * @param {ConnectionConfig} connection
 * @param {Record<string, unknown>} [payload]
 * @returns {Promise<Response>}
 */
export async function invoke(category, action, connection, payload = {}) {
	/** @type {Request} */
	const req = {
		id: uuid(),
		category,
		action,
		connection,
		payload
	};

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
 * 列出连接可见的所有 schema/database。
 * @param {ConnectionConfig} connection
 */
export function listSchemas(connection) {
	return invoke('SCHEMA', 'LIST', connection);
}

/**
 * 列出 connection.database 下的表。
 * 切换库时调用方负责覆盖 connection.database，不要单独传 schema 字段。
 * @param {ConnectionConfig} connection
 */
export function listTables(connection) {
	return invoke('TABLE', 'LIST', connection);
}

/**
 * 拉取列元数据：name / type / size / nullable / isPrimaryKey / defaultValue
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 */
export function listColumns(connection, tableName) {
	return invoke('TABLE', 'EXECUTE', connection, { tableName });
}

/**
 * 分页拉取表数据。page 从 1 开始；pageSize 上限受 §9 约束（≤1000）。
 * @param {ConnectionConfig} connection
 * @param {string} tableName
 * @param {number} [page]
 * @param {number} [pageSize]
 */
export function listData(connection, tableName, page = 1, pageSize = 100) {
	return invoke('DATA', 'LIST', connection, { tableName, page, pageSize });
}

/**
 * 执行原生 SQL。
 * @param {ConnectionConfig} connection
 * @param {string} sql
 */
export function executeSql(connection, sql) {
	return invoke('SQL', 'EXECUTE', connection, { sql });
}
