// 时间相关列类型判别 + 取值在 "DB 字符串 ↔ HTML 时间 picker 值" 之间互转。
//
// 设计：所有时间类型内部统一用「UTC 毫秒时间戳」（number）作 canonical 值。
//   - DB 字符串 → 解析 → UTC ms
//   - UTC ms → 按列类型格式化为 picker 需要的字符串（本地时区）
//   - picker 字符串 → 解析为本地时区 Date → UTC ms → 反向 DB 字符串
//
// 这样：6 种类型（DATE / TIME / DATETIME / TIMESTAMP / TIMETZ / TIMESTAMPTZ）
// 都有统一的中介值，避免 per-type 字符串拼接和 TZ 正则博弈。

import { getPickerType, getJavaTimeType, getTimeFormat, getJdbcType, getDefaultFractionalDigits } from './timeTypeMapping.js';

/** @typedef {import('./api').ColumnMeta} ColumnMeta */

/**
 * 根据数据库类型获取时间种类（用于前端选择器）
 * @param {string | undefined | null} type
 * @returns {'date' | 'time' | 'datetime' | null}
 */
export function temporalKind(type) {
	if (!type) return null;
	const t = String(type).toUpperCase().trim();
	if (t === 'DATE') return 'date';
	if (t.startsWith('DATE') && !t.startsWith('DATETIME')) return 'date';
	if (t.startsWith('DATETIME')) return 'datetime';
	if (t.startsWith('TIMESTAMP')) return 'datetime';
	if (t.startsWith('TIME')) return 'time';
	if (t.startsWith('SMALLDATETIME')) return 'datetime';
	if (t.startsWith('YEAR')) return 'date';
	if (t.startsWith('INTERVAL')) return 'datetime';
	return null;
}

/** @param {string | undefined | null} type */
export function hasTimeZone(type) {
	if (!type) return false;
	const t = String(type).toUpperCase();
	return /WITH TIME ZONE/.test(t) || /TIMESTAMPTZ/.test(t) || /TIMETZ/.test(t);
}

/** @param {ColumnMeta | undefined | null} meta */
export function fractionalDigits(meta) {
	if (!meta) return 0;
	const s = typeof meta.size === 'number' ? meta.size : 0;
	if (!Number.isFinite(s)) return 0;
	return Math.max(0, Math.min(6, Math.floor(s)));
}

/** @param {number} digits */
export function stepFor(digits) {
	if (digits <= 0) return '1';
	return '0.' + '0'.repeat(digits - 1) + '1';
}

/* ===========================================================================
 * 导出 timeTypeMapping 的便捷方法（供组件直接使用）
 * ========================================================================== */

/**
 * 获取列类型对应的 Java 时间类型
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 数据库类型名
 * @returns {string | null}
 */
export function getJavaType(driver, dbType) {
	return getJavaTimeType(driver, dbType);
}

/**
 * 获取列类型对应的 ISO 格式字符串
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 数据库类型名
 * @returns {string | null}
 */
export function getColumnFormat(driver, dbType) {
	return getTimeFormat(driver, dbType);
}

/**
 * 获取列类型对应的 JDBC 类型
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 数据库类型名
 * @returns {string | null}
 */
export function getColumnJdbcType(driver, dbType) {
	return getJdbcType(driver, dbType);
}

/**
 * 获取列类型的默认小数位精度
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 数据库类型名
 * @returns {number}
 */
export function getColumnFractionalDigits(driver, dbType) {
	return getDefaultFractionalDigits(driver, dbType);
}

/* ===========================================================================
 * 核心：DB 字符串 ↔ UTC 毫秒时间戳
 * ======================================================================= */

/**
 * 把 DB 时间字符串解析为 UTC 毫秒数（从 1970-01-01T00:00:00Z 起算）。
 * DATE / TIME / DATETIME / TIMESTAMP：直接按"字面值"当 UTC 解析（无 TZ 含义，
 *   不做时区转换，picker 会按本地时区显示）。
 * TIMESTAMPTZ：解析 PG 字符串末尾的 TZ 偏移（+08 / +08:00 / +0800 / Z），
 *   转为绝对 UTC 毫秒。
 * TIMETZ：补今天日期后解析为 UTC 毫秒。
 *
 * @param {string} raw
 * @returns {number | null}  NaN 时返回 null
 */
export function dbStringToUtcMs(raw) {
	const s = String(raw).trim();
	if (!s) return null;

	// 抽 TZ 后缀（如果有）：TIMESTAMPTZ / TIMETZ / 也包含 DATETIME 偶尔带 TZ 的 case
	const tz = parseTzSuffix(s);
	const body = tz ? s.slice(0, s.length - tz.raw.length).trim() : s;

	if (tz) {
		// TIMESTAMPTZ（带日期）或 TIMETZ（仅时间，今天日期补 1970-01-01）
		const iso = body.includes('T') ? body : body.replace(' ', 'T');
		// body 可能是 'YYYY-MM-DD HH:MM:SS[.fff]' 或 'HH:MM:SS[.fff]'
		const isoFull = iso.includes('-')
			? `${iso}${tz.normalized}`
			: `1970-01-01T${iso}${tz.normalized}`;
		const d = new Date(isoFull);
		return isNaN(d.getTime()) ? null : d.getTime();
	}

	// 无 TZ：把字符串当成 UTC 时刻
	const iso = body.replace(' ', 'T');
	if (!iso.includes('-')) {
		// TIME HH:MM[:SS[.fff]]：补 1970-01-01 当 UTC 时刻
		return Date.UTC(1970, 0, 1, ...parseClock(iso));
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
		// DATE YYYY-MM-DD：当作当天 00:00:00 UTC
		const [y, mo, da] = iso.split('-').map(Number);
		return Date.UTC(y, mo - 1, da);
	}
	// DATETIME / TIMESTAMP：当作 UTC
	const d = new Date(`${iso}Z`);
	return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * UTC 毫秒数 → DB 字符串（picker 提交时使用）。
 * 按列类型格式化；TZ 类型不带 TZ 后缀（写回 PG 时让 DB 按 session TZ 解释，
 * 或调用方用 rawTzSuffix 显式拼回）。
 *
 * @param {number} ms
 * @param {ColumnMeta} meta
 * @param {string} [rawTzSuffix]  原始 TZ 后缀（TIMESTAMPTZ/TIMETZ 时拼回）
 * @returns {string | null}
 */
export function utcMsToDbString(ms, meta, rawTzSuffix = '') {
	const d = new Date(ms);
	if (isNaN(d.getTime())) return null;
	const kind = temporalKind(meta?.type);
	if (!kind) return null;
	const digits = fractionalDigits(meta);
	const tz = hasTimeZone(meta?.type);
	const pad = (n) => String(n).padStart(2, '0');
	const y = d.getUTCFullYear();
	const mo = pad(d.getUTCMonth() + 1);
	const da = pad(d.getUTCDate());
	const ho = pad(d.getUTCHours());
	const mi = pad(d.getUTCMinutes());
	const se = pad(d.getUTCSeconds());
	const ms3 = String(d.getUTCMilliseconds()).padStart(3, '0');
	const frac = digits > 0 ? '.' + (ms3 + '000000').slice(0, digits) : '';

	let out;
	if (kind === 'date') {
		out = `${y}-${mo}-${da}`;
	} else if (kind === 'time') {
		out = `${ho}:${mi}:${se}${frac}`;
	} else {
		out = `${y}-${mo}-${da} ${ho}:${mi}:${se}${frac}`;
	}
	return tz && rawTzSuffix ? `${out} ${rawTzSuffix}` : out;
}

/**
 * 从时间字符串 ('HH:MM[:SS[.fff]]') 解析出 [h, m, s, ms]（用于 Date.UTC）。
 * @param {string} clock
 * @returns {[number, number, number, number?]}
 */
function parseClock(clock) {
	const m = clock.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/);
	if (!m) return [0, 0, 0];
	const [, h, mm, s, f] = m;
	const ms = f ? Math.floor(parseInt(f.padEnd(3, '0').slice(0, 3)) / 1) : 0;
	return [Number(h), Number(mm), Number(s || 0), ms];
}

/* ===========================================================================
 * 主入口：DB → picker、picker → DB（都走 UTC ms 中介）
 * ======================================================================= */

/**
 * DB 字符串 → 时间 picker 的 value。
 *
 * 输出与 `pickerToDbValue` 互为逆，必须与 java.time 类型严格 1:1 对应：
 *   DATE              'YYYY-MM-DD'                   LocalDate
 *   TIME              'HH:MM:SS[.fff]'               LocalTime
 *   TIMESTAMP         'YYYY-MM-DDTHH:MM:SS[.fff]'    LocalDateTime
 *   TIMESTAMPTZ       wall-clock（浏览器本地时区）   OffsetDateTime
 *   TIMETZ            wall-clock（浏览器本地时区）   OffsetTime
 *
 * @param {unknown} raw
 * @param {ColumnMeta | undefined | null} meta
 * @returns {string}
 */
export function dbToPickerValue(raw, meta) {
	if (raw === null || raw === undefined) return '';
	if (!meta) return String(raw);
	const kind = temporalKind(meta.type);
	if (!kind) return String(raw);

	const rawStr = String(raw).trim();
	if (!rawStr) return '';
	const digits = fractionalDigits(meta);
	const tz = hasTimeZone(meta.type);

	if (tz) {
		const ms = dbStringToUtcMs(rawStr);
		if (ms === null) return rawStr;
		// picker 只支持 3 位小数（毫秒），列声明超出的精度在 picker 上无法编辑
		const pickerDigits = Math.min(digits, 3);
		return formatMsForPicker(ms, kind, pickerDigits);
	}

	// 无 TZ 类型：按 digits 截亚秒，T 替换 ' ' 以匹配 HTML5 datetime-local 期望
	let s = rawStr;
	if (kind === 'date') {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
		return m ? m[1] : s;
	}
	if (kind === 'time') {
		const m = /^(\d{2}:\d{2}(?::\d{2})?(\.\d+)?)/.exec(s);
		if (!m) return s;
		return shapeFractional(m[1], digits);
	}
	const m = /^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}(?::\d{2})?(\.\d+)?)/.exec(s);
	if (m) return shapeFractional(`${m[1]}T${m[2]}`, digits);
	const m2 = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(\.\d+)?)/.exec(s);
	return m2 ? shapeFractional(m2[1], digits) : s;
}

/**
 * picker 字符串 → DB 字符串。
 *
 * 设计原则：**输出必须与 java.time 类型严格 1:1 对应**，让引擎侧
 * `OffsetDateTime.parse(raw, ISO_OFFSET_DATE_TIME)` / `OffsetTime.parse(raw)` /
 * `LocalDate.parse` / `LocalTime.parse` / `LocalDateTime.parse(...)` 直接消化。
 *
 *   列类型             输出形态                       java.time 类型
 *   DATE              'YYYY-MM-DD'                   LocalDate
 *   TIME              'HH:MM:SS[.fff]'               LocalTime
 *   TIMESTAMP         'YYYY-MM-DDTHH:MM:SS[.fff]'    LocalDateTime
 *   TIMESTAMPTZ       'YYYY-MM-DDTHH:MM:SS[.fff]+HH:MM' 或 '...Z'
 *                     OffsetDateTime
 *   TIMETZ            'HH:MM:SS[.fff]+HH:MM'         OffsetTime
 *
 * TZ 偏移来源：保留从 DB 初值解析的偏移（`tzSuffixes[col]`），保证前后 wall-clock
 * 没有偏移歧义；用户输入若修改时间需要保留偏移，不允许 picker 跨 TZ 改动。
 *
 * @param {string} v  picker value
 * @param {ColumnMeta | undefined | null} meta
 * @param {string} [rawTzSuffix]  原始 TZ 后缀（'+08' / '+08:00' / 'Z'），
 *                                 从 DB 初值解析过来；仅带 TZ 类型列使用
 * @returns {string}
 */
export function pickerToDbValue(v, meta, rawTzSuffix = '') {
	if (!v) return '';
	const kind = temporalKind(meta?.type);
	if (!kind) return v;
	const tz = hasTimeZone(meta?.type);
	const digits = fractionalDigits(meta);

	if (kind === 'date' && !tz) {
		// LocalDate: 'YYYY-MM-DD'
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
		return m ? m[1] : v;
	}
	if (kind === 'time' && !tz) {
		// LocalTime: 'HH:MM:SS[.fff]' — picker 无秒时补 :00
		const m = /^(\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?/.exec(v);
		if (!m) return v;
		const head = `${m[1]}:${m[2] || '00'}`;
		const frac = m[3] ? m[3].slice(1) : '';
		const fracOut = digits > 0 ? '.' + (frac + '000000').slice(0, digits) : '';
		return head + fracOut;
	}
	if (kind === 'datetime' && !tz) {
		// LocalDateTime: 'YYYY-MM-DDTHH:MM:SS[.fff]'
		const iso = v.replace(' ', 'T');
		const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?/.exec(iso);
		if (!m) return v;
		const head = `${m[1]}T${m[2]}:${m[3] || '00'}`;
		const frac = m[4] ? m[4].slice(1) : '';
		const fracOut = digits > 0 ? '.' + (frac + '000000').slice(0, digits) : '';
		return head + fracOut;
	}

	if (kind === 'time' && tz) {
		// OffsetTime: 'HH:MM:SS[.fff]+HH:MM'
		const m = /^(\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?/.exec(v);
		if (!m) return v;
		const head = `${m[1]}:${m[2] || '00'}`;
		const frac = m[3] ? m[3].slice(1) : '';
		const fracOut = digits > 0 ? '.' + (frac + '000000').slice(0, digits) : '';
		return head + fracOut + (normalizeOffsetToColon(rawTzSuffix) || 'Z');
	}
	if (kind === 'datetime' && tz) {
		// OffsetDateTime: 'YYYY-MM-DDTHH:MM:SS[.fff]+HH:MM' 或 '...Z'
		const iso = v.replace(' ', 'T');
		const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(\.\d+)?/.exec(iso);
		if (!m) return v;
		const head = `${m[1]}T${m[2]}:${m[3] || '00'}`;
		const frac = m[4] ? m[4].slice(1) : '';
		const fracOut = digits > 0 ? '.' + (frac + '000000').slice(0, digits) : '';
		const tzCol = normalizeOffsetToColon(rawTzSuffix) || 'Z';
		return head + fracOut + tzCol;
	}

	// fallback: 原样透传（防御性）
	return v;
}

/**
 * 把任意形态的 TZ 偏移归一化为 OffsetDateTime 解析器吃的 '+HH:MM' / 'Z' / ''。
 * 接受 '+08' / '+08:00' / '+0800' / 'Z' / '-0530' / ''。
 */
function normalizeOffsetToColon(s) {
	if (!s) return '';
	const t = s.trim();
	if (t === 'Z' || t === 'z') return 'Z';
	const m = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(t);
	if (!m) return '';
	return `${m[1]}${m[2]}:${m[3] || '00'}`;
}

/**
 * 把已经形如 HH:MM[:SS[.fff]] 的字符串按 digits 截 / 补 0。
 * @param {string} stamp
 * @param {number} digits
 */
function shapeFractional(stamp, digits) {
	if (!/:\d{2}(?:\.\d+)?$/.test(stamp)) stamp += ':00';
	const dotIdx = stamp.lastIndexOf('.');
	const head = dotIdx >= 0 ? stamp.slice(0, dotIdx) : stamp;
	const frac = dotIdx >= 0 ? stamp.slice(dotIdx + 1) : '';
	if (digits <= 0) return head;
	return head + '.' + (frac + '000000').slice(0, digits);
}

/**
 * 解析 picker 字符串为 UTC 毫秒（仅供 TZ 分支用，picker 字符串按浏览器本地 TZ 解释）。
 * @param {string} v
 * @param {'date'|'time'|'datetime'} kind
 * @returns {number | null}
 */
function pickerStringToUtcMs(v, kind) {
	if (kind === 'date') {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
		if (!m) return null;
		const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
		return d.getTime();
	}
	if (kind === 'time') {
		const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(v);
		if (!m) return null;
		const h = Number(m[1]);
		const mm = Number(m[2]);
		const s = Number(m[3] || 0);
		const ms = m[4] ? Math.floor(parseInt(m[4].padEnd(3, '0').slice(0, 3)) / 1) : 0;
		const today = new Date();
		const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, mm, s, ms);
		return d.getTime();
	}
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/.exec(v);
	if (!m) return null;
	const ms = m[7] ? Math.floor(parseInt(m[7].padEnd(3, '0').slice(0, 3)) / 1) : 0;
	const d = new Date(
		Number(m[1]), Number(m[2]) - 1, Number(m[3]),
		Number(m[4]), Number(m[5]), Number(m[6] || 0), ms
	);
	return d.getTime();
}

/**
 * UTC 毫秒 → picker value（按浏览器本地时区格式化）。
 * digits 是列声明精度；picker 上限 3 位小数（毫秒），超过只输出 3 位。
 */
function formatMsForPicker(ms, kind, digits) {
	const d = new Date(ms);
	const pad = (n) => String(n).padStart(2, '0');
	const y = d.getFullYear();
	const mo = pad(d.getMonth() + 1);
	const da = pad(d.getDate());
	const ho = pad(d.getHours());
	const mi = pad(d.getMinutes());
	const se = pad(d.getSeconds());
	const ms3 = String(d.getMilliseconds()).padStart(3, '0');
	const pickerDigits = Math.min(digits, 3); // picker 最多到毫秒
	const frac = pickerDigits > 0 ? '.' + (ms3 + '000000').slice(0, pickerDigits) : '';
	if (kind === 'date') return `${y}-${mo}-${da}`;
	if (kind === 'time') return `${ho}:${mi}:${se}${frac}`;
	return `${y}-${mo}-${da}T${ho}:${mi}:${se}${frac}`;
}

/* ===========================================================================
 * 兼容性
 * ======================================================================= */

/** @deprecated 暂时保留，显示在 DataGrid。 */
export function formatTemporal(v, meta) {
	if (v === null || v === undefined) return null;
	const kind = temporalKind(meta?.type);
	if (!kind) return null;
	const s = String(v).trim();
	if (!s) return s;
	if (kind === 'date') {
		const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
		return m ? m[1] : s;
	}
	const tzMatch = parseTzSuffix(s);
	let body = tzMatch ? s.slice(0, s.length - tzMatch.raw.length).trim() : s;
	body = body.replace('T', ' ');
	const tzStr = tzMatch ? tzMatch.raw : '';
	if (kind === 'time') {
		const m = /^(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(body);
		if (!m) return s;
		return m[1] + tzStr;
	}
	const m = /^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(body);
	if (!m) return s;
	return m[1] + tzStr;
}

/* ===========================================================================
 * 工具：从 PG/MySQL 时间字符串末尾抽 TZ 后缀
 * ======================================================================= */

/**
 * 支持：'Z' / '+08' / '-05' / '+0800' / '+08:00' / '-0530'。
 * 判定原则：TZ 必须接在「秒数字」后面（`:SS[.fff]`），不接受其他位置，
 * 避免把日期 '2024-01-15' 末尾的 '-15' 误认为时区。
 *
 * @param {string} s
 * @returns {{ raw: string, normalized: string } | null}
 */
export function parseTzSuffix(s) {
	const m = s.match(/(?::\d{2}(?:\.\d+)?)(Z|[+-]\d{2}(?::?\d{2})?)$/);
	if (!m) return null;
	const raw = m[1];
	if (raw === 'Z') return { raw, normalized: 'Z' };
	const sign = raw[0];
	const num = raw.slice(1);
	let hh, mm = '00';
	if (num.length === 2) {
		hh = num;
	} else if (num.length === 4) {
		hh = num.slice(0, 2);
		mm = num.slice(2);
	} else if (num.length === 5 && num[2] === ':') {
		hh = num.slice(0, 2);
		mm = num.slice(3);
	} else {
		return null;
	}
	return { raw, normalized: `${sign}${hh}:${mm}` };
}
