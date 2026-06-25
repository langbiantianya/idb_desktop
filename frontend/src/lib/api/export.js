// 数据导出 API 层
// 协议：EXPORT / EXPORT category×action，独立子进程运行，流式进度响应

import { invokeStreaming } from './index.js';

/** @typedef {import('./index.js').ConnectionConfig} ConnectionConfig */

/**
 * 预览 SQL 查询结果（前 limit 行，用于确认导出内容）
 * 直接执行 SQL 查询，返回流式结果
 * @param {ConnectionConfig} connection
 * @param {string} sql - 原始 SELECT SQL
 * @param {number} [limit=100] - 预览行数限制
 * @returns {Promise<{ rows: Record<string, unknown>[]; columns: string[] }>}
 */
export async function previewExport(connection, sql, limit = 100) {
	// 先给 SQL 追加 LIMIT
	const previewSql = addLimit(sql.trim(), limit);

	const accRows = /** @type {Record<string, unknown>[]} */ ([]);
	const colSet = new Set();

	await invokeStreaming('SQL', 'EXECUTE', connection, { sql: previewSql }, (data) => {
		if (data && typeof data === 'object') {
			const d = /** @type {Record<string, unknown>} */ (data);
			// SQL EXECUTE 流式响应的 data 格式为 { rows: [...] }
			const rowArr = Array.isArray(d.rows) ? d.rows : [];
			for (const row of rowArr) {
				if (row && typeof row === 'object') {
					accRows.push(row);
					for (const k of Object.keys(row)) colSet.add(k);
				}
			}
		}
	});

	return {
		rows: accRows,
		columns: [...colSet]
	};
}

/**
 * 开始导出任务
 * @param {ConnectionConfig} connection
 * @param {{ sql: string; outputDir: string; fileName: string; format: string; tableName?: string; fetchSize?: number }} payload
 * @param {(data: unknown) => void} onProgress - 进度回调
 * @param {(data: unknown) => void} [onEnd] - 结束回调（stream end 事件触发）
 * @returns {Promise<{ id: string; success: boolean; error?: string }>}
 */
export async function startExport(connection, payload, onProgress, onEnd) {
	return invokeStreaming('EXPORT', 'EXPORT', connection, payload, onProgress, onEnd);
}

/**
 * 停止导出任务
 * @param {ConnectionConfig} connection
 * @param {string} exportId - 要停止的导出任务 ID
 * @returns {Promise<{ success: boolean; error?: string }>}
 */
export async function cancelExport(connection, exportId) {
	return invokeStreaming('EXPORT', 'EXPORT', connection, { stopExportId: exportId }, () => {});
}

/**
 * 给 SQL 追加 LIMIT 子句（如果还没有 LIMIT）
 * @param {string} sql
 * @param {number} limit
 * @returns {string}
 */
function addLimit(sql, limit) {
	const trimmed = sql.trim();
	// 检查是否已有 LIMIT 子句（不区分大小写）
	if (/\blimit\s+\d+/i.test(trimmed)) {
		return trimmed;
	}
	// 简单追加 LIMIT（实际应插入到 ORDER BY 之前，但这里做简化处理）
	return trimmed + ` LIMIT ${limit}`;
}
