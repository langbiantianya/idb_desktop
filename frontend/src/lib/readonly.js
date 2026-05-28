// MySQL 系统库：禁止任何写操作（DDL / DML / 权限以外的修改）。
// 名称大小写不敏感（MySQL 标识符默认 case-insensitive）。
const MYSQL_READONLY_SCHEMAS = new Set([
	'sys',
	'performance_schema',
	'mysql',
	'information_schema'
]);

/**
 * @param {{ driver?: string } | null | undefined} conn
 * @param {string | null | undefined} schema
 */
export function isReadOnlySchema(conn, schema) {
	if (!conn || !schema) return false;
	if (conn.driver !== 'Mysql') return false;
	return MYSQL_READONLY_SCHEMAS.has(String(schema).toLowerCase());
}

/**
 * SQL 控制台用：仅在 MySQL 且当前 schema 是只读系统库时，
 * 阻止可能修改数据 / 表结构的语句。判定方式是看语句首关键字。
 *
 * 支持识别：INSERT / UPDATE / DELETE / REPLACE / TRUNCATE /
 *          CREATE / ALTER / DROP / RENAME / GRANT / REVOKE /
 *          CALL / LOAD / IMPORT / SET（仅 SET PASSWORD/GLOBAL/PERSIST）。
 *
 * @param {string} sql
 * @returns {string | null} 命中的写关键字（大写）；非写语句返回 null
 */
export function detectWriteKeyword(sql) {
	if (!sql) return null;
	// 去掉前导注释 / 空白后取首单词
	let s = sql;
	while (true) {
		const trimmed = s.replace(/^\s+/, '');
		if (trimmed.startsWith('--')) {
			const nl = trimmed.indexOf('\n');
			s = nl === -1 ? '' : trimmed.slice(nl + 1);
			continue;
		}
		if (trimmed.startsWith('/*')) {
			const end = trimmed.indexOf('*/');
			s = end === -1 ? '' : trimmed.slice(end + 2);
			continue;
		}
		s = trimmed;
		break;
	}
	const m = /^([A-Za-z]+)/.exec(s);
	if (!m) return null;
	const kw = m[1].toUpperCase();
	const writeSet = new Set([
		'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'TRUNCATE',
		'CREATE', 'ALTER', 'DROP', 'RENAME',
		'GRANT', 'REVOKE',
		'CALL', 'LOAD', 'IMPORT',
		'HANDLER', 'LOCK', 'UNLOCK',
		'OPTIMIZE', 'REPAIR', 'ANALYZE', 'CHECK',
		'FLUSH', 'RESET', 'PURGE', 'KILL'
	]);
	if (writeSet.has(kw)) return kw;
	// SET PASSWORD / SET GLOBAL / SET PERSIST 视为写；其他 SET（会话变量）放行
	if (kw === 'SET') {
		const rest = s.slice(m[0].length).replace(/^\s+/, '').toUpperCase();
		if (/^(PASSWORD|GLOBAL|PERSIST|PERSIST_ONLY)\b/.test(rest)) return 'SET';
	}
	return null;
}
