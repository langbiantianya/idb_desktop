/**
 * SQL 片段校验：WHERE / ORDER BY 子句的安全性检查，按数据库方言区分规则。
 *
 * 校验时机：前端发送 DATA LIST 请求前，拒绝明显危险的片段。
 * 引擎侧也会做二次校验，前端校验是为了尽早给出友好提示。
 */

/** @typedef {'Mysql' | 'Postgresql'} Driver */

/**
 * 通用禁止关键字（引号外出现即拒绝）。
 * @type {Set<string>}
 */
const FORBIDDEN_KEYWORDS = new Set([
	'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION',
	'EXEC', 'EXECUTE', 'CREATE', 'ALTER',
	'GRANT', 'REVOKE', 'TRUNCATE'
]);

/**
 * PostgreSQL / MySQL 共有的额外禁止关键字。
 * @type {Set<string>}
 */
const FORBIDDEN_EXTRA = new Set(['COPY', 'DO']);

/**
 * 跳过引号内容，返回引号结束位置（不含结束引号字符）。
 * 支持单引号 `'`、双引号 `"`、反引号 `` ` ``，以及单引号内的转义 `''`。
 * @param {string} s 全文
 * @param {number} i 当前引号字符位置
 * @returns {number} 引号结束后的位置；若未闭合则返回 s.length
 */
function skipQuoted(s, i) {
	const quote = s[i];
	let j = i + 1;
	while (j < s.length) {
		if (s[j] === quote) {
			// 转义引号 '' / "" / ``
			if (j + 1 < s.length && s[j + 1] === quote) {
				j += 2;
				continue;
			}
			return j + 1;
		}
		j++;
	}
	return j;
}

/**
 * 
 * @param {string} s @param {number} i
 * @returns {number}
 */
function skipLineComment(s, i) {
	const nl = s.indexOf('\n', i);
	return nl === -1 ? s.length : nl + 1;
}

/**
 * 
 * @param {string} s @param {number} i
 * @returns {number}
 */
function skipBlockComment(s, i) {
	const end = s.indexOf('*/', i + 2);
	return end === -1 ? s.length : end + 2;
}

/**
 * 提取从 pos 开始的完整单词（A-Z a-z 0-9 _），大写返回。
 * @param {string} s @param {number} pos
 * @returns {{ word: string, end: number }}
 */
function extractWord(s, pos) {
	let end = pos;
	while (end < s.length && /[\w]/.test(s[end])) end++;
	return { word: s.slice(pos, end).toUpperCase(), end };
}

/**
 * 通用校验逻辑：遍历片段，跳过引号和注释，在引号外检测禁止字符和关键字。
 * @param {string} text 待校验片段
 * @param {'where' | 'orderBy'} kind 片段类型（用于错误消息）
 * @param {Set<string>} extraKw 额外禁止关键字
 * @param {boolean} allowBacktick 是否允许反引号标识符（MySQL ORDER BY）
 * @returns {string | null} 通过返回 null；拒绝返回错误消息
 */
function validateFragment(text, kind, extraKw, allowBacktick) {
	if (!text || !text.trim()) return null;
	const s = text;
	const n = s.length;

	// 通用：分号
	if (s.includes(';')) return `${kind} 片段不允许包含分号`;

	let i = 0;
	while (i < n) {
		const ch = s[i];

		// 跳过引号内容
		if (ch === "'" || ch === '"' || ch === '`') {
			// 反引号仅在 allowBacktick 时合法
			if (ch === '`' && !allowBacktick) {
				return `${kind} 片段不允许使用反引号标识符（当前方言不支持）`;
			}
			i = skipQuoted(s, i);
			continue;
		}

		// 跳过行注释
		if (ch === '-' && i + 1 < n && s[i + 1] === '-') {
			return `${kind} 片段不允许包含注释`;
		}

		// 跳过块注释
		if (ch === '/' && i + 1 < n && s[i + 1] === '*') {
			return `${kind} 片段不允许包含注释`;
		}

		// 检查关键字
		if (/[A-Za-z]/.test(ch)) {
			const { word, end } = extractWord(s, i);
			if (FORBIDDEN_KEYWORDS.has(word)) {
				return `${kind} 片段不允许包含 ${word} 语句`;
			}
			if (extraKw.has(word)) {
				return `${kind} 片段不允许包含 ${word} 语句`;
			}
			i = end;
			continue;
		}

		i++;
	}

	return null;
}

/**
 * 校验 WHERE 子句片段。
 * @param {string} text
 * @param {Driver} driver
 * @returns {string | null}
 */
export function validateWhere(text, driver) {
	if (!text || !text.trim()) return null;
	// WHERE 中不允许反引号（不论方言），允许双引号字符串
	return validateFragment(text, 'where', FORBIDDEN_EXTRA, false);
}

/**
 * 校验 ORDER BY 子句片段。
 * MySQL 允许反引号标识符，PostgreSQL 不允许但允许双引号。
 * @param {string} text
 * @param {Driver} driver
 * @returns {string | null}
 */
export function validateOrderBy(text, driver) {
	if (!text || !text.trim()) return null;
	const allowBacktick = driver === 'Mysql';
	return validateFragment(text, 'orderBy', FORBIDDEN_EXTRA, allowBacktick);
}
