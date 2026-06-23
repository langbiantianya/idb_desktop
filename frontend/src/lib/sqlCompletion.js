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
 * SqlEditor 通用补全（全量关键字 + 函数）。
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
 * FunctionPanel 使用的 plpgsql 函数体补全。
 * 包含 PL/pgSQL 特定关键字、控制结构、内置函数等。
 * @param {'Mysql' | 'Postgresql'} driver
 * @returns {{ keywords: string[], functions: string[], plpgsqlKeywords: string[], plpgsqlFunctions: string[] }}
 */
export function getPlpgsqlCompletionItems(driver) {
	const base = getCompletionItems(driver);

	// PL/pgSQL 特定关键字（函数体中常用）
	const PLPGSQL_KEYWORDS = [
		'DECLARE', 'BEGIN', 'EXCEPTION', 'WHEN', 'RAISE', 'NOTICE',
		'RETURNS', 'RETURN', 'RETURN NEXT', 'RETURN QUERY',
		'OUT', 'INOUT', 'VARIADIC', 'DEFAULT',
		'LANGUAGE', 'AS', 'IS', 'ELSIF',
		'GET DIAGNOSTICS', 'SQLSTATE', 'SQLERRM',
		'FOREACH', 'IN', 'LOOP', 'EXIT', 'CONTINUE',
		'EXECUTE', 'USING', 'INTO', 'STRICT',
		'CREATE OR REPLACE FUNCTION', 'CREATE OR REPLACE PROCEDURE',
		'COMMENT ON', 'ALTER FUNCTION', 'ALTER PROCEDURE', 'DROP FUNCTION', 'DROP PROCEDURE'
	];

	// PL/pgSQL 内置函数
	const PLPGSQL_FUNCTIONS = [
		// 事务控制
		'COMMIT', 'ROLLBACK', 'SAVEPOINT',
		// 错误处理
		'GET STACKED DIAGNOSTICS', 'GET DIAGNOSTICS',
		// 类型转换
		'CAST', '::', 'COALESCE', 'NULLIF',
		// 字符串函数
		'CONCAT', 'CONCAT_WS', 'SUBSTRING', 'TRIM', 'UPPER', 'LOWER', 'LENGTH', 'LENGTH_B',
		'REPLACE', 'SPLIT_PART', 'REGEXP_REPLACE', 'REGEXP_MATCHES',
		// 数值函数
		'ROUND', 'TRUNC', 'FLOOR', 'CEIL', 'ABS', 'MOD',
		// 日期时间函数
		'NOW', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
		'CLOCK_TIMESTAMP', 'STATEMENT_TIMESTAMP', 'TO_TIMESTAMP', 'TO_CHAR', 'TO_DATE',
		'EXTRACT', 'DATE_TRUNC', 'AGE', 'OVERLAPS',
		// 数组函数
		'ARRAY_LENGTH', 'ARRAY_UPPER', 'ARRAY_LOWER', 'CARDINALITY',
		// JSON 函数
		'JSON_OBJECT', 'JSON_ARRAY', 'JSON_BUILD_OBJECT', 'JSON_BUILD_ARRAY',
		'JSON_OBJECT_AGG', 'JSON_ARRAY_AGG', 'JSONB_OBJECT', 'JSONB_ARRAY',
		'JSONB_BUILD_OBJECT', 'JSONB_BUILD_ARRAY', 'JSONB_SET', 'JSONB_INSERT',
		'JSON_EACH', 'JSONB_EACH', 'JSON_EACH_TEXT', 'JSONB_EACH_TEXT',
		'JSON_OBJECT_KEYS', 'JSONB_OBJECT_KEYS',
		// 类型检查
		'PG_TYPEOF', 'pg_typeof',
		// 行/记录构造
		'ROW', 'ROW_TO_JSON', 'JSON_TO_RECORD', 'JSONB_TO_RECORD',
		// 杂项
		'GENERATE_SERIES', 'NULLIF', 'GREATEST', 'LEAST'
	];

	return {
		...base,
		plpgsqlKeywords: PLPGSQL_KEYWORDS,
		plpgsqlFunctions: PLPGSQL_FUNCTIONS
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
