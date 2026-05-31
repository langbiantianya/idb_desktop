/**
 * SQL 补全项配置：按数据库驱动返回差异化的关键字与函数列表。
 * 按上下文分组：表达式级（WHERE 可用）、子句级（ORDER BY 等）、DDL/DML 级。
 */

// ─── 表达式级关键字（WHERE / HAVING 条件中合法） ───
const EXPR_KEYWORDS = [
	'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL',
	'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'DISTINCT',
	'TRUE', 'FALSE',
	'CASE', 'WHEN', 'THEN', 'ELSE', 'END'
];

// ─── 子句级关键字（SELECT 语句结构，不用于 WHERE 条件内部） ───
const CLAUSE_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
	'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
	'AS', 'UNION', 'UNION ALL', 'ASC', 'DESC'
];

// ─── DDL/DML 级关键字（写操作，只读场景不提示） ───
const DML_KEYWORDS = [
	'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM'
];

// ─── 通用 SQL 函数 ───
const COMMON_FUNCTIONS = [
	'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
	'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
	'COALESCE', 'NULLIF', 'CAST',
	'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'SUBSTRING', 'CONCAT'
];

// ─── MySQL 专属 ───
const MYSQL_KEYWORDS = [
	'RLIKE', 'REGEXP', 'SOUNDS LIKE', 'XOR',
	'IGNORE', 'FORCE', 'USE INDEX', 'STRAIGHT_JOIN',
	'DESCRIBE', 'EXPLAIN', 'SHOW', 'TRUNCATE',
	'AUTO_INCREMENT', 'IF NOT EXISTS', 'REPLACE'
];
const MYSQL_EXPR_KEYWORDS = ['RLIKE', 'REGEXP'];
const MYSQL_FUNCTIONS = [
	'IFNULL', 'IF', 'GROUP_CONCAT', 'CONVERT',
	'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'DATE_FORMAT', 'STR_TO_DATE',
	'CHAR_LENGTH', 'REPLACE', 'LPAD', 'RPAD', 'SUBSTRING_INDEX',
	'JSON_EXTRACT', 'JSON_CONTAINS', 'JSON_ARRAYAGG',
	'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LEAD', 'LAG'
];

// ─── PostgreSQL 专属 ───
const PG_KEYWORDS = [
	'ILIKE', 'SIMILAR TO',
	'LATERAL', 'WITH', 'RECURSIVE',
	'RETURNING', 'CONFLICT', 'DO NOTHING', 'DO UPDATE SET',
	'VACUUM', 'ANALYZE', 'EXPLAIN', 'VERBOSE',
	'BOOLEAN', 'TYPE', 'CREATE TYPE', 'ENUM',
	'MATERIALIZED VIEW', 'REFRESH MATERIALIZED VIEW',
	'WINDOW'
];
const PG_EXPR_KEYWORDS = ['ILIKE', 'SIMILAR TO'];
const PG_FUNCTIONS = [
	'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
	'STRING_AGG', 'ARRAY_AGG', 'JSONB_AGG', 'JSON_AGG',
	'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'TO_NUMBER',
	'EXTRACT', 'DATE_TRUNC', 'AGE',
	'GENERATE_SERIES', 'UNNEST',
	'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LEAD', 'LAG',
	'REGEXP_REPLACE', 'REGEXP_MATCHES', 'SPLIT_PART',
	'NOW', 'CLOCK_TIMESTAMP', 'STATEMENT_TIMESTAMP'
];

/**
 * 合并并去重两个字符串数组。
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function mergeUnique(a, b) {
	return [...new Set([...a, ...b])];
}

/**
 * SqlConsole 通用补全（全量关键字 + 函数）。
 * @param {'Mysql' | 'Postgresql'} driver
 * @returns {{ keywords: string[], functions: string[] }}
 */
export function getCompletionItems(driver) {
	const isPg = driver === 'Postgresql';
	return {
		keywords: mergeUnique(
			[...EXPR_KEYWORDS, ...CLAUSE_KEYWORDS, ...DML_KEYWORDS],
			isPg ? PG_KEYWORDS : MYSQL_KEYWORDS
		),
		functions: mergeUnique(COMMON_FUNCTIONS, isPg ? PG_FUNCTIONS : MYSQL_FUNCTIONS)
	};
}

/**
 * WHERE 子句专用补全：仅表达式级关键字 + 函数，不含 ORDER BY / GROUP BY 等。
 * @param {'Mysql' | 'Postgresql'} driver
 * @returns {{ keywords: string[], functions: string[] }}
 */
export function getWhereCompletionItems(driver) {
	const isPg = driver === 'Postgresql';
	return {
		keywords: mergeUnique(EXPR_KEYWORDS, isPg ? PG_EXPR_KEYWORDS : MYSQL_EXPR_KEYWORDS),
		functions: mergeUnique(COMMON_FUNCTIONS, isPg ? PG_FUNCTIONS : MYSQL_FUNCTIONS)
	};
}

/**
 * ORDER BY 子句专用补全：仅列名占位 + ASC/DESC，不含条件表达式。
 * DataGrid 内自行追加列名，此处只返回关键字部分。
 * @returns {{ keywords: string[] }}
 */
export function getOrderByKeywords() {
	return { keywords: ['ASC', 'DESC'] };
}
