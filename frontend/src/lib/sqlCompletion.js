/**
 * SQL 补全项配置：按数据库驱动返回差异化的关键字与函数列表。
 * 通用项 + 驱动专属项在运行时合并，避免在组件内硬编码。
 */

/** @type {string[]} 通用 SQL 关键字 */
const COMMON_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
	'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
	'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
	'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL',
	'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'DISTINCT', 'UNION', 'UNION ALL',
	'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'TRUE', 'FALSE'
];

/** @type {string[]} 通用 SQL 函数 */
const COMMON_FUNCTIONS = [
	'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
	'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
	'COALESCE', 'NULLIF', 'CAST',
	'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'SUBSTRING', 'CONCAT'
];

/** @type {string[]} MySQL 专属关键字 */
const MYSQL_KEYWORDS = [
	'RLIKE', 'REGEXP', 'SOUNDS LIKE', 'XOR',
	'IGNORE', 'FORCE', 'USE INDEX', 'STRAIGHT_JOIN',
	'DESCRIBE', 'EXPLAIN', 'SHOW', 'TRUNCATE',
	'AUTO_INCREMENT', 'IF NOT EXISTS', 'REPLACE'
];

/** @type {string[]} MySQL 专属函数 */
const MYSQL_FUNCTIONS = [
	'IFNULL', 'IF', 'GROUP_CONCAT', 'CONVERT',
	'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'DATE_FORMAT', 'STR_TO_DATE',
	'CHAR_LENGTH', 'REPLACE', 'LPAD', 'RPAD', 'SUBSTRING_INDEX',
	'JSON_EXTRACT', 'JSON_CONTAINS', 'JSON_ARRAYAGG',
	'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LEAD', 'LAG'
];

/** @type {string[]} PostgreSQL 专属关键字 */
const PG_KEYWORDS = [
	'ILIKE', 'SIMILAR TO',
	'LATERAL', 'WITH', 'RECURSIVE',
	'RETURNING', 'CONFLICT', 'DO NOTHING', 'DO UPDATE SET',
	'VACUUM', 'ANALYZE', 'EXPLAIN', 'VERBOSE',
	'TRUE', 'FALSE', 'BOOLEAN',
	'TYPE', 'CREATE TYPE', 'ENUM',
	'MATERIALIZED VIEW', 'REFRESH MATERIALIZED VIEW',
	'WINDOW'
];

/** @type {string[]} PostgreSQL 专属函数 */
const PG_FUNCTIONS = [
	'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
	'STRING_AGG', 'ARRAY_AGG', 'JSONB_AGG', 'JSON_AGG',
	'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'TO_NUMBER',
	'EXTRACT', 'DATE_TRUNC', 'AGE',
	'GENERATE_SERIES', 'UNNEST',
	'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LEAD', 'LAG',
	'REGEXP_REPLACE', 'REGEXP_MATCHES', 'SPLIT_PART',
	'NOW', 'CLOCK_TIMESTAMP', 'STATEMENT_TIMESTAMP',
	'COALESCE', 'NULLIF'
];

/**
 * 根据驱动返回合并后的补全项。
 * @param {'Mysql' | 'Postgresql'} driver
 * @returns {{ keywords: string[], functions: string[] }}
 */
export function getCompletionItems(driver) {
	const isPg = driver === 'Postgresql';
	return {
		keywords: [...COMMON_KEYWORDS, ...(isPg ? PG_KEYWORDS : MYSQL_KEYWORDS)],
		functions: [...COMMON_FUNCTIONS, ...(isPg ? PG_FUNCTIONS : MYSQL_FUNCTIONS)]
	};
}
