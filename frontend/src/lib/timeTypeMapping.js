/**
 * MySQL / PostgreSQL 时间类型 → java.time 类型映射配置
 *
 * 用途：
 * 1. 时间选择器根据列类型确定应使用的 Java 时间格式
 * 2. 数据网格显示时根据映射选择正确的格式化方式
 * 3. 造数引擎根据映射生成正确的 JDBC 类型绑定
 *
 * 映射规则：
 * - MySQL DATE → java.time.LocalDate (YYYY-MM-DD)
 * - MySQL TIME → java.time.LocalTime (HH:MM:SS[.fff])
 * - MySQL DATETIME → java.time.LocalDateTime (YYYY-MM-DDTHH:MM:SS[.fff])
 * - MySQL TIMESTAMP → java.time.LocalDateTime (无 TZ) 或 java.time.OffsetDateTime (有 TZ)
 * - MySQL YEAR → java.time.Year (YYYY)
 * - PostgreSQL DATE → java.time.LocalDate
 * - PostgreSQL TIME / TIMETZ → java.time.LocalTime / java.time.OffsetTime
 * - PostgreSQL TIMESTAMP / TIMESTAMPTZ → java.time.LocalDateTime / java.time.OffsetDateTime
 * - PostgreSQL INTERVAL → java.time.Duration
 */

/**
 * @typedef {Object} TimeTypeMapping
 * @property {string} dbType - 数据库类型名（标准化后大写）
 * @property {string} javaType - 对应的 java.time 类型全名
 * @property {string} javaShort - 简写类型名（用于显示）
 * @property {string} format - ISO-8601 格式字符串
 * @property {string} pickerType - 前端 picker 类型: 'date' | 'time' | 'datetime' | 'year' | 'interval' | null
 * @property {boolean} hasTimeZone - 是否带时区
 * @property {number} [defaultFractionalDigits] - 默认小数位精度（时间类型）
 * @property {string} [jdbcType] - JDBC 类型名（用于元数据）
 */

/** @type {TimeTypeMapping[]} */
export const TIME_TYPE_MAPPINGS = [
  // ============================================================
  // MySQL 时间类型
  // ============================================================
  {
    dbType: 'DATE',
    javaType: 'java.time.LocalDate',
    javaShort: 'LocalDate',
    format: 'yyyy-MM-dd',
    pickerType: 'date',
    hasTimeZone: false,
    jdbcType: 'DATE',
  },
  {
    dbType: 'TIME',
    javaType: 'java.time.LocalTime',
    javaShort: 'LocalTime',
    format: 'HH:mm:ss[.SSSSSS]',
    pickerType: 'time',
    hasTimeZone: false,
    defaultFractionalDigits: 0,
    jdbcType: 'TIME',
  },
  {
    dbType: 'DATETIME',
    javaType: 'java.time.LocalDateTime',
    javaShort: 'LocalDateTime',
    format: 'yyyy-MM-dd\'T\'HH:mm:ss[.SSSSSS]',
    pickerType: 'datetime',
    hasTimeZone: false,
    defaultFractionalDigits: 0,
    jdbcType: 'TIMESTAMP',
  },
  {
    dbType: 'DATETIME(6)',
    javaType: 'java.time.LocalDateTime',
    javaShort: 'LocalDateTime',
    format: 'yyyy-MM-dd\'T\'HH:mm:ss.SSSSSS',
    pickerType: 'datetime',
    hasTimeZone: false,
    defaultFractionalDigits: 6,
    jdbcType: 'TIMESTAMP',
  },
  {
    dbType: 'TIMESTAMP',
    javaType: 'java.time.LocalDateTime',
    javaShort: 'LocalDateTime',
    format: 'yyyy-MM-dd\'T\'HH:mm:ss[.SSSSSS]',
    pickerType: 'datetime',
    hasTimeZone: false,
    defaultFractionalDigits: 0,
    jdbcType: 'TIMESTAMP',
  },
  {
    dbType: 'TIMESTAMP(6)',
    javaType: 'java.time.LocalDateTime',
    javaShort: 'LocalDateTime',
    format: 'yyyy-MM-dd\'T\'HH:mm:ss.SSSSSS',
    pickerType: 'datetime',
    hasTimeZone: false,
    defaultFractionalDigits: 6,
    jdbcType: 'TIMESTAMP',
  },
  {
    dbType: 'YEAR',
    javaType: 'java.time.Year',
    javaShort: 'Year',
    format: 'yyyy',
    pickerType: 'year',
    hasTimeZone: false,
    jdbcType: 'DATE',
  },

  // ============================================================
  // PostgreSQL 时间类型
  // ============================================================
  {
    dbType: 'PG_DATE',
    javaType: 'java.time.LocalDate',
    javaShort: 'LocalDate',
    format: 'yyyy-MM-dd',
    pickerType: 'date',
    hasTimeZone: false,
    jdbcType: 'DATE',
  },
  {
    dbType: 'PG_TIME',
    javaType: 'java.time.LocalTime',
    javaShort: 'LocalTime',
    format: 'HH:mm:ss[.SSSSSS]',
    pickerType: 'time',
    hasTimeZone: false,
    defaultFractionalDigits: 6,
    jdbcType: 'TIME',
  },
  {
    dbType: 'PG_TIMETZ',
    javaType: 'java.time.OffsetTime',
    javaShort: 'OffsetTime',
    format: 'HH:mm:ss[.SSSSSS]XXX',
    pickerType: 'time',
    hasTimeZone: true,
    defaultFractionalDigits: 6,
    jdbcType: 'TIME_WITH_TIMEZONE',
  },
  {
    dbType: 'PG_TIMESTAMP',
    javaType: 'java.time.LocalDateTime',
    javaShort: 'LocalDateTime',
    format: 'yyyy-MM-dd\'T\'HH:mm:ss[.SSSSSS]',
    pickerType: 'datetime',
    hasTimeZone: false,
    defaultFractionalDigits: 6,
    jdbcType: 'TIMESTAMP',
  },
  {
    dbType: 'PG_TIMESTAMPTZ',
    javaType: 'java.time.OffsetDateTime',
    javaShort: 'OffsetDateTime',
    format: "yyyy-MM-dd'T'HH:mm:ss[.SSSSSS]XXX",
    pickerType: 'datetime',
    hasTimeZone: true,
    defaultFractionalDigits: 6,
    jdbcType: 'TIMESTAMP_WITH_TIMEZONE',
  },
  {
    dbType: 'PG_INTERVAL',
    javaType: 'java.time.Duration',
    javaShort: 'Duration',
    format: 'PnDTnHnMnS',
    pickerType: 'interval',
    hasTimeZone: false,
    jdbcType: 'OTHER',
  },
];

/**
 * 数据库驱动 → 类型前缀映射
 * @type {Record<string, string>}
 */
export const DRIVER_PREFIX = {
  Mysql: '',      // MySQL 类型无前缀
  Postgres: 'PG_', // PostgreSQL 类型加 PG_ 前缀
};

/**
 * 根据数据库驱动和原始类型名查找映射（忽略大小写）
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名（如 'datetime', 'timestamptz'）
 * @returns {TimeTypeMapping | null}
 */
export function findTimeMapping(driver, dbType) {
  if (!dbType) return null;
  const normalized = String(dbType).toUpperCase().trim();
  const prefix = (DRIVER_PREFIX[driver] || '').toUpperCase();

  // 1. 精确匹配（带前缀，忽略大小写）
  let found = TIME_TYPE_MAPPINGS.find((m) => m.dbType.toUpperCase() === prefix + normalized);
  if (found) return found;

  // 2. 去掉精度后缀再匹配（如 DATETIME(6) → DATETIME）
  const baseType = normalized.replace(/\s*\(\d+\)$/, '');
  if (baseType !== normalized) {
    found = TIME_TYPE_MAPPINGS.find((m) => m.dbType.toUpperCase() === prefix + baseType);
    if (found) return found;
  }

  // 3. MySQL 特殊别名
  if (driver === 'Mysql') {
    const aliasMap = {
      'TIMESTAMP WITHOUT TIME ZONE': 'TIMESTAMP',
      'TIMESTAMP WITH TIME ZONE': 'TIMESTAMP', // MySQL 不支持，fallback
      'TIME WITHOUT TIME ZONE': 'TIME',
    };
    const aliased = aliasMap[normalized];
    if (aliased) {
      found = TIME_TYPE_MAPPINGS.find((m) => m.dbType.toUpperCase() === aliased);
      if (found) return found;
    }
  }

  // 4. PostgreSQL 特殊别名（不带 PG_ 前缀的原始类型名）
  if (driver === 'Postgres') {
    const pgAliasMap = {
      'DATE': 'PG_DATE',
      'TIME': 'PG_TIME',
      'TIME WITHOUT TIME ZONE': 'PG_TIME',
      'TIMETZ': 'PG_TIMETZ',
      'TIME WITH TIME ZONE': 'PG_TIMETZ',
      'TIMESTAMP': 'PG_TIMESTAMP',
      'TIMESTAMP WITHOUT TIME ZONE': 'PG_TIMESTAMP',
      'TIMESTAMPTZ': 'PG_TIMESTAMPTZ',
      'TIMESTAMP WITH TIME ZONE': 'PG_TIMESTAMPTZ',
      'INTERVAL': 'PG_INTERVAL',
    };
    const aliased = pgAliasMap[normalized];
    if (aliased) {
      found = TIME_TYPE_MAPPINGS.find((m) => m.dbType.toUpperCase() === aliased);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 判断是否为时间类型（可用于选择器）
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {boolean}
 */
export function isTimeType(driver, dbType) {
  return findTimeMapping(driver, dbType) !== null;
}

/**
 * 获取 picker 类型
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {'date' | 'time' | 'datetime' | 'year' | 'interval' | null}
 */
export function getPickerType(driver, dbType) {
  const mapping = findTimeMapping(driver, dbType);
  return mapping?.pickerType ?? null;
}

/**
 * 获取 Java 时间类型名
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {string | null}
 */
export function getJavaTimeType(driver, dbType) {
  const mapping = findTimeMapping(driver, dbType);
  return mapping?.javaType ?? null;
}

/**
 * 获取格式化字符串（java.time.format.DateTimeFormatter 格式）
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {string | null}
 */
export function getTimeFormat(driver, dbType) {
  const mapping = findTimeMapping(driver, dbType);
  return mapping?.format ?? null;
}

/**
 * 获取 JDBC 类型名
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {string | null}
 */
export function getJdbcType(driver, dbType) {
  const mapping = findTimeMapping(driver, dbType);
  return mapping?.jdbcType ?? null;
}

/**
 * 获取默认小数位精度
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @param {string} dbType - 原始数据库类型名
 * @returns {number}
 */
export function getDefaultFractionalDigits(driver, dbType) {
  const mapping = findTimeMapping(driver, dbType);
  return mapping?.defaultFractionalDigits ?? 0;
}

/**
 * 获取所有支持的 Java 时间类型列表（用于文档/提示）
 * @returns {string[]}
 */
export function getAllJavaTimeTypes() {
  return [...new Set(TIME_TYPE_MAPPINGS.map((m) => m.javaType))];
}

/**
 * 获取指定驱动的所有时间类型映射
 * @param {string} driver - 'Mysql' | 'Postgres'
 * @returns {TimeTypeMapping[]}
 */
export function getMappingsByDriver(driver) {
  const prefix = DRIVER_PREFIX[driver] || '';
  return TIME_TYPE_MAPPINGS.filter((m) => m.dbType.startsWith(prefix));
}
