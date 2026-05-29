// 时间相关列类型判别 + 取值在 "DB 字符串 ↔ HTML 时间选择器值" 之间互转。
//
// HTML 输入控件的语义：
//   <input type="date">           value: YYYY-MM-DD
//   <input type="time" step=N>    value: HH:MM[:SS[.fff]]
//   <input type="datetime-local"> value: YYYY-MM-DDTHH:MM[:SS[.fff]]
//
// 数据库一般要求 DATETIME / TIMESTAMP 用空格分隔，所以提交时需要把 'T' → ' '。
// 带时区的 timestamptz / timetz 信息在 picker 里表达不了，这两类回退到普通文本。

/** @typedef {import('./api').ColumnMeta} ColumnMeta */

/**
 * @param {string | undefined | null} type
 * @returns {'date' | 'time' | 'datetime' | null}
 */
export function temporalKind(type) {
	if (!type) return null;
	const t = String(type).toUpperCase().trim();
	// DATE 单独一类，注意 DATETIME 也包含 "DATE" 前缀，所以先排除带 TIME 的
	if (t === 'DATE') return 'date';
	if (t.startsWith('DATE') && !t.startsWith('DATETIME')) return 'date';
	if (t.startsWith('DATETIME')) return 'datetime';
	if (t.startsWith('TIMESTAMP')) return 'datetime';
	if (t.startsWith('TIME')) return 'time';
	if (t.startsWith('SMALLDATETIME')) return 'datetime';
	return null;
}

/** @param {string | undefined | null} type */
export function hasTimeZone(type) {
	if (!type) return false;
	const t = String(type).toUpperCase();
	return /WITH TIME ZONE/.test(t) || /TIMESTAMPTZ/.test(t) || /TIMETZ/.test(t);
}

/**
 * 小数秒位数。MySQL TIMESTAMP(3) 这种参数会落到 columnMeta.size 里。
 * 没有元数据时按 0；最大 6（DB 上限）；clamp。
 * @param {ColumnMeta | undefined | null} meta
 * @returns {number}
 */
export function fractionalDigits(meta) {
	if (!meta) return 0;
	const s = typeof meta.size === 'number' ? meta.size : 0;
	if (!Number.isFinite(s)) return 0;
	return Math.max(0, Math.min(6, Math.floor(s)));
}

/**
 * 给 <input step="..."> 用：digits=0 → "1"（秒）；digits>0 → "0.001..." 对应分辨率。
 * @param {number} digits
 */
export function stepFor(digits) {
	if (digits <= 0) return '1';
	return '0.' + '0'.repeat(digits - 1) + '1';
}

/**
 * DB 字符串 → 时间 picker 的 value。容忍带 TZ / 末尾 Z 的输入：picker 拿不到 TZ，丢掉即可。
 * 解析失败返回原值（picker 显示空白时 value="" 即可）。
 *
 * @param {unknown} raw
 * @param {'date' | 'time' | 'datetime'} kind
 * @param {number} digits
 * @returns {string}
 */
export function dbToPickerValue(raw, kind, digits) {
	if (raw === null || raw === undefined) return '';
	let s = String(raw).trim();
	if (!s) return '';

	// 标准化：去 TZ 后缀（Z / +HH:MM / -HH:MM 在末尾的）
	s = s.replace(/(?:Z|[+-]\d{2}:?\d{2})\s*$/, '');
	// DATETIME 和 TIMESTAMP 在 DB 里常带空格，picker 要求 'T'
	s = s.replace(' ', 'T');

	if (kind === 'date') {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
		return m ? m[1] : '';
	}
	if (kind === 'time') {
		// 来源可能是 HH:MM:SS 或 HH:MM:SS.fff
		const m = /^(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(s);
		if (!m) return '';
		return shapeFractional(m[1], digits);
	}
	// datetime
	const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(s);
	if (!m) return '';
	return shapeFractional(m[1], digits);
}

/**
 * picker value → 写回 DB 的字符串。datetime 把 'T' 换回空格；其他原样。
 *
 * @param {string} v
 * @param {'date' | 'time' | 'datetime'} kind
 */
export function pickerToDbValue(v, kind) {
	if (!v) return '';
	if (kind === 'datetime') return v.replace('T', ' ');
	return v;
}

/**
 * 显示用：把 DB 返回值按列声明精度重整。
 *  - DATE: 'YYYY-MM-DD'
 *  - TIME(n): 'HH:MM:SS' 或带 n 位小数
 *  - DATETIME(n)/TIMESTAMP(n): 'YYYY-MM-DD HH:MM:SS' 或带 n 位小数；TZ 后缀保留
 *
 * @param {unknown} v
 * @param {ColumnMeta | undefined | null} meta
 * @returns {string | null} null = 让调用方 fallback 到默认渲染
 */
export function formatTemporal(v, meta) {
	if (v === null || v === undefined) return null;
	const kind = temporalKind(meta?.type);
	if (!kind) return null;
	const digits = fractionalDigits(meta);
	const s = String(v).trim();
	if (!s) return s;

	// 抽出 TZ 后缀以便最后拼回去
	const tzMatch = s.match(/(Z|[+-]\d{2}:?\d{2})\s*$/);
	const tz = tzMatch ? tzMatch[0].trim() : '';
	let body = tz ? s.slice(0, s.length - tzMatch[0].length).trim() : s;
	body = body.replace('T', ' ');

	if (kind === 'date') {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(body);
		return m ? m[1] : s;
	}
	if (kind === 'time') {
		const m = /^(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(body);
		if (!m) return s;
		return shapeFractional(m[1], digits) + tz;
	}
	const m = /^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(body);
	if (!m) return s;
	return shapeFractional(m[1], digits) + tz;
}

/**
 * 把已经形如 HH:MM[:SS[.fff]] 或 ...:SS 的字符串按 digits 截 / 补 0。
 * @param {string} stamp
 * @param {number} digits
 */
function shapeFractional(stamp, digits) {
	// 没有秒：补到秒级再说
	if (!/:\d{2}(?:\.\d+)?$/.test(stamp)) {
		stamp += ':00';
	}
	const dotIdx = stamp.lastIndexOf('.');
	const head = dotIdx >= 0 ? stamp.slice(0, dotIdx) : stamp;
	const frac = dotIdx >= 0 ? stamp.slice(dotIdx + 1) : '';
	if (digits <= 0) return head;
	const padded = (frac + '000000').slice(0, digits);
	return head + '.' + padded;
}
