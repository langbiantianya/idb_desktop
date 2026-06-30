// 引擎响应形态归一化与通用判别工具。
// 引擎对不同 category/action 返回的 data 形态有差异（数组 / 对象 / { rows: [...] }），
// 这里集中处理，避免每个组件重复兼容逻辑。

/** @typedef {import('./api').ColumnMeta} ColumnMeta */

/**
 * 从任意 data 形态折叠成 string[]。
 * 支持 string[] | {name|schema|database|user|...}[] | {schemas:[...]} 等。
 * @param {unknown} data
 * @param {string[]} [keys]
 * @returns {string[]}
 */
export function asStringList(data, keys = ['name', 'schema', 'database', 'user']) {
	if (Array.isArray(data)) {
		return data.map((item) => {
			if (typeof item === 'string') return item;
			if (item && typeof item === 'object') {
				const o = /** @type {Record<string, unknown>} */ (item);
				for (const k of keys) if (typeof o[k] === 'string') return /** @type {string} */ (o[k]);
				return JSON.stringify(o);
			}
			return String(item);
		});
	}
	if (data && typeof data === 'object') {
		const o = /** @type {Record<string, unknown>} */ (data);
		for (const k of ['schemas', 'tables', 'list', 'items']) {
			if (Array.isArray(o[k])) return asStringList(o[k], keys);
		}
	}
	return [];
}

/**
 * @param {unknown} data
 * @returns {{ name: string; type: string }[]}
 */
export function asTableList(data) {
	const arr = pickArray(data, ['tables', 'list', 'items']);
	return arr.map((item) => {
		if (typeof item === 'string') return { name: item, type: 'TABLE' };
		const o = /** @type {Record<string, unknown>} */ (item);
		const rawType = String(o.type ?? 'TABLE');
		// 统一映射：MySQL 返回 "BASE TABLE"，PostgreSQL 返回 "BASE TABLE" / "VIEW"
		const type = rawType === 'BASE TABLE' ? 'TABLE' : rawType;
		return {
			name: String(o.name ?? o.tableName ?? ''),
			type
		};
	});
}

/**
 * 用户列表归一化：MySQL `[{user, host}]` / PostgreSQL `[{user}]`。
 * @param {unknown} data
 * @returns {{ user: string; host?: string }[]}
 */
export function asUserList(data) {
	const arr = pickArray(data, ['users', 'list', 'items']);
	return arr
		.map((item) => {
			if (typeof item === 'string') return { user: item };
			const o = /** @type {Record<string, unknown>} */ (item);
			const user = String(o.user ?? o.name ?? o.username ?? '');
			if (!user) return null;
			const host = o.host == null ? undefined : String(o.host);
			return host ? { user, host } : { user };
		})
		.filter(/** @returns {x is { user: string; host?: string }} */ (x) => x !== null);
}

/**
 * @param {unknown} data
 * @returns {ColumnMeta[]}
 */
export function asColumnList(data) {
	const arr = pickArray(data, ['columns', 'list', 'items']);
	return arr.map((item) => {
		const o = /** @type {Record<string, unknown>} */ (item);
		return {
			name: String(o.name ?? ''),
			type: String(o.type ?? ''),
			size: typeof o.size === 'number' ? o.size : undefined,
			nullable: typeof o.nullable === 'boolean' ? o.nullable : undefined,
			isPrimaryKey: typeof o.isPrimaryKey === 'boolean' ? o.isPrimaryKey : undefined,
			defaultValue: o.defaultValue
		};
	});
}

/**
 * 数据页归一化：列名取所有行键的并集（保留出现顺序）。
 * 同时提取 total / page / pageSize 分页元数据（引擎新协议）。
 * @param {unknown} data
 * @returns {{ rows: Record<string, unknown>[]; columns: string[]; total: number | null; page: number | null; pageSize: number | null }}
 */
export function asDataPage(data) {
	const rawRows = pickArray(data, ['rows', 'list', 'data', 'items']);
	const colSet = new Set();
	for (const r of rawRows) {
		if (r && typeof r === 'object') for (const k of Object.keys(r)) colSet.add(k);
	}

	// 提取分页元数据（引擎可能返回 total / page / pageSize）
	let total = null;
	let pg = null;
	let ps = null;
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		const o = /** @type {Record<string, unknown>} */ (data);
		if (typeof o.total === 'number') total = o.total;
		if (typeof o.page === 'number') pg = o.page;
		if (typeof o.pageSize === 'number') ps = o.pageSize;
	}

	return { rows: /** @type {Record<string, unknown>[]} */ (rawRows), columns: [...colSet], total, page: pg, pageSize: ps };
}

/**
 * SQL 执行结果归一化：可能是结果集数组、{ affectedRows }、或两者之一。
 * @param {unknown} data
 * @returns {{ rows: Record<string, unknown>[]; columns: string[]; affectedRows: number | null }}
 */
export function asSqlResult(data) {
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		const o = /** @type {Record<string, unknown>} */ (data);
		if (typeof o.affectedRows === 'number' && !Array.isArray(o.rows)) {
			return { rows: [], columns: [], affectedRows: o.affectedRows };
		}
	}
	const page = asDataPage(data);
	return { ...page, affectedRows: null };
}

/**
 * 取数组形态。data 本身是数组直接返回；对象时按候选 key 寻找数组字段。
 * @param {unknown} data
 * @param {string[]} keys
 * @returns {any[]}
 */
function pickArray(data, keys) {
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') {
		const o = /** @type {Record<string, unknown>} */ (data);
		for (const k of keys) if (Array.isArray(o[k])) return /** @type {any[]} */ (o[k]);
	}
	return [];
}

const LOB_PATTERN = /^\[LOB Data/i;

/** @param {unknown} v */
export function isLob(v) {
	return typeof v === 'string' && LOB_PATTERN.test(v);
}

/** 渲染单元格为可显示字符串。@param {unknown} v */
export function renderCell(v) {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}
