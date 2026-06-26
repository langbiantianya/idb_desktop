<script>
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { executeSql, executeSqlStreaming, listSchemas, listTables, listColumns } from '$lib/api';
	import {
		asSqlResult,
		asStringList,
		asTableList,
		asColumnList,
		isLob,
		renderCell
	} from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema, detectWriteKeyword } from '$lib/readonly.js';
	import { getCompletionItems } from '$lib/sqlCompletion.js';
	import { format as formatSql } from 'sql-formatter';
	import SqlEditor from './SqlEditor.svelte';
	import { ContextMenu } from '$lib/components/ui/index.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 *
	 * @typedef {Object} Suggestion
	 * @property {string} label
	 * @property {'schema' | 'table' | 'column' | 'keyword' | 'function'} kind
	 * @property {string} [detail]
	 * @property {string} [insertText]
	 *
	 * @typedef {Object} StatementResult
	 * @property {string} sql
	 * @property {boolean} success
	 * @property {string | null} error
	 * @property {Record<string, unknown>[]} rows
	 * @property {string[]} columns
	 * @property {number | null} affectedRows
	 */

	/** @type {Props} */
	let { schemaConn } = $props();

	let sql = $state('');
	let pending = $state(false);

	/** @type {SqlEditor | null} */
	let editorRef = $state(null);

	let results = $state(/** @type {StatementResult[]} */ ([]));
	let activeResultIdx = $state(0);
	let cellCtx = $state(
		/** @type {{ x: number; y: number; row: Record<string, unknown>; col: string; value: unknown; selection: string } | null} */ (
			null
		)
	);
	let headerCtx = $state(/** @type {{ x: number; y: number; col: string } | null} */ (null));

	// ── Virtual Scroll ──────────────────────────────────────────────
	const VS_THRESHOLD = 500;
	const VS_OVERSCAN = 10;
	const VS_ESTIMATED_RH = 28;

	let vsScrollEl = $state(/** @type {HTMLDivElement | null} */ (null));
	let vsActive = $state(false);
	let vsScrollTop = $state(0);
	let vsViewportH = $state(0);
	let vsRowH = $state(VS_ESTIMATED_RH);
	let vsColWidths = $state(/** @type {number[]} */ ([]));
	let vsColsLocked = $state(false);
	let vsRafId = 0;
	let vsStreaming = $state(false);

	/** 当前激活的结果（响应式依赖 results 和 activeResultIdx） */
	let cur = $derived(results[activeResultIdx] ?? null);

	let vsRange = $derived.by(() => {
		if (!vsActive || !cur) return null;
		const n = cur.rows.length;
		if (n === 0) return null;
		const rh = vsRowH;
		const start = Math.max(0, Math.floor(vsScrollTop / rh) - VS_OVERSCAN);
		const end = Math.min(n, Math.ceil((vsScrollTop + vsViewportH) / rh) + VS_OVERSCAN);
		const visCount = end - start;
		return { start, end, offsetY: start * rh, bottomPad: (n - start - visCount) * rh };
	});

	let vsVisRows = $derived(vsRange && cur ? cur.rows.slice(vsRange.start, vsRange.end) : null);

	/** @param {Event} e */
	function vsOnScroll(e) {
		if (vsRafId) return;
		vsRafId = requestAnimationFrame(() => {
			vsRafId = 0;
			vsScrollTop = /** @type {HTMLDivElement} */ (e.target).scrollTop;
		});
	}

	function vsMeasureCols() {
		if (vsColsLocked || !vsScrollEl || !cur) return;
		const ths = vsScrollEl.querySelectorAll('thead th');
		if (!ths.length) return;
		vsColWidths = [...ths].map((th) => Math.max(80, th.getBoundingClientRect().width));
		vsColsLocked = true;
	}

	function vsReset() {
		vsActive = false;
		vsScrollTop = 0;
		vsRowH = VS_ESTIMATED_RH;
		vsColWidths = [];
		vsColsLocked = false;
		vsStreaming = false;
	}

	$effect(() => {
		const el = vsScrollEl;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => { vsViewportH = entry.contentRect.height; });
		ro.observe(el);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!vsActive || vsStreaming || !cur || cur.rows.length === 0 || vsColsLocked) return;
		requestAnimationFrame(vsMeasureCols);
	});

	$effect(() => {
		if (!vsActive || !vsScrollEl) return;
		requestAnimationFrame(() => {
			const row = vsScrollEl?.querySelector('tbody tr:not(.vs-spacer)');
			if (!row) return;
			const h = row.getBoundingClientRect().height;
			if (h > 0 && Math.abs(h - vsRowH) > 1) vsRowH = Math.round(h);
		});
	});

	function openCellCtx(e, row, col, value) {
		e.preventDefault();
		const sel = (typeof window !== 'undefined' ? window.getSelection()?.toString() : '') ?? '';
		cellCtx = { x: e.clientX, y: e.clientY, row, col, value, selection: sel };
	}

	function openHeaderCtx(e, col) {
		e.preventDefault();
		headerCtx = { x: e.clientX, y: e.clientY, col };
	}

	async function copyValue(value) {
		try {
			await navigator.clipboard.writeText(String(value ?? ''));
			ok(get(t)('common.copied'));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('common.copy_failed'));
		}
	}

	async function copyText(text, label = get(t)('common.copied')) {
		try {
			await navigator.clipboard.writeText(text);
			ok(label);
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('common.copy_failed'));
		}
	}

	/**
	 * 行序列化为 TSV：tab 分列、列内换行 / tab 转义为字面量；NULL 转空串。
	 * @param {string[]} columns
	 * @param {Record<string, unknown>} row
	 */
	function rowToTsv(columns, row) {
		return columns
			.map((c) => {
				const v = row[c];
				if (v === null || v === undefined) return '';
				return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
			})
			.join('\t');
	}

	// 元数据缓存：避免每次按键都去打引擎。schemaConn.database 是当前 tab 绑定的 schema，
	// 跨 schema 的表 / 列懒加载，结果落到下面两个对象里。
	let schemas = $state(/** @type {string[]} */ ([]));
	let tablesBySchema = $state(/** @type {Record<string, string[]>} */ ({}));
	/** key: "schema.table" → 列名数组 */
	let columnsByQualifiedTable = $state(/** @type {Record<string, string[]>} */ ({}));

	// 上一次拉取过的连接键，避免 schemaConn 引用变了但内容相同时重复拉。
	let lastLoadKey = '';

	$effect(() => {
		const conn = schemaConn;
		if (!conn) return;
		const key = `${conn.driver}|${conn.host}|${conn.port}|${conn.user}|${conn.database}|${conn._schema || ''}`;
		if (key === lastLoadKey) return;
		lastLoadKey = key;
		void loadInitialMeta(conn);
	});

	/** @param {ConnectionConfig} conn */
	async function loadInitialMeta(conn) {
		try {
			// PostgreSQL: 从 connection.database 加载该库的 schema 列表
			if (conn.driver === 'Postgresql') {
				const sResp = await listSchemas(conn, { database: conn.database });
				if (sResp.success) schemas = asStringList(sResp.data);
			} else {
				const sResp = await listSchemas(conn);
				if (sResp.success) schemas = asStringList(sResp.data);
			}
		} catch (_) { /* 忽略：完成项只是辅助 */ }

		// 当前 schema：PG 取 _schema，MySQL 取 database
		const cur = conn.driver === 'Postgresql' ? (conn._schema || '') : conn.database;
		if (cur && !tablesBySchema[cur]) {
			try {
				const tResp = await listTables(conn);
				if (tResp.success) {
					const list = asTableList(tResp.data).map((t) => t.name);
					tablesBySchema = { ...tablesBySchema, [cur]: list };
				}
			} catch (_) { /* 同上 */ }
		}
	}

	/** @param {string} schema */
	async function tablesIn(schema) {
		if (tablesBySchema[schema]) return tablesBySchema[schema];
		try {
			const conn = schemaConn.driver === 'Postgresql'
				? { ...schemaConn, _schema: schema }
				: { ...schemaConn, database: schema };
			const r = await listTables(conn);
			if (!r.success) return [];
			const list = asTableList(r.data).map((t) => t.name);
			tablesBySchema = { ...tablesBySchema, [schema]: list };
			return list;
		} catch (_) {
			return [];
		}
	}

	/** @param {string} schema @param {string} table */
	async function columnsOf(schema, table) {
		const key = `${schema}.${table}`;
		if (columnsByQualifiedTable[key]) return columnsByQualifiedTable[key];
		try {
			const conn = schemaConn.driver === 'Postgresql'
				? { ...schemaConn, _schema: schema }
				: { ...schemaConn, database: schema };
			const r = await listColumns(conn, table);
			if (!r.success) return [];
			const list = asColumnList(r.data).map((c) => c.name);
			columnsByQualifiedTable = { ...columnsByQualifiedTable, [key]: list };
			return list;
		} catch (_) {
			return [];
		}
	}

	/**
	 * 从当前 SQL 文本里抠出 FROM / JOIN / UPDATE / INTO 之后引用的表（以及可能的 schema 限定与别名）。
	 * 用于在补全列名时知道"列是哪个表的"。这里只做轻量正则解析，覆盖常见单表 / 双表 JOIN 写法。
	 *
	 * @param {string} text
	 * @returns {{ schema?: string; table: string; alias?: string }[]}
	 */
	function parseReferencedTables(text) {
		const refs = [];
		// 把字符串字面量里的 FROM/JOIN 关键字屏蔽掉，避免误匹配。
		const stripped = text.replace(/'(?:''|[^'])*'/g, ' ').replace(/"(?:""|[^"])*"/g, ' ');
		const re = /\b(?:from|join|update|into)\s+(?:([\w$]+)\s*\.\s*)?([\w$]+)(?:\s+(?:as\s+)?([\w$]+))?/gi;
		const stop = new Set([
			'where', 'on', 'group', 'order', 'having', 'join', 'inner', 'left',
			'right', 'cross', 'full', 'outer', 'set', 'values', 'select', 'limit',
			'offset', 'using', 'union', 'as', 'and', 'or'
		]);
		let m;
		while ((m = re.exec(stripped)) !== null) {
			const schema = m[1];
			const table = m[2];
			const aliasRaw = m[3];
			const alias = aliasRaw && !stop.has(aliasRaw.toLowerCase()) ? aliasRaw : undefined;
			refs.push(schema ? { schema, table, alias } : { table, alias });
		}
		return refs;
	}

	/**
	 * Monaco 触发的补全回调；返回当前光标语境下相关的库 / 表 / 列 / 关键字。
	 * @param {{ word: string; prevToken: string; qualifier: string | null }} ctx
	 * @returns {Promise<Suggestion[]>}
	 */
	async function getSuggestions(ctx) {
		const { prevToken, qualifier } = ctx;
		const items = /** @type {Suggestion[]} */ ([]);
		const cur = (schemaConn.driver === 'Postgresql' ? (schemaConn._schema || '') : schemaConn.database) || '';

		if (qualifier) {
			// 已知 schema：列出该 schema 下的表
			if (schemas.includes(qualifier)) {
				const tables = await tablesIn(qualifier);
				for (const t of tables) items.push({ label: t, kind: 'table', detail: `${qualifier}.${t}` });
				return items;
			}
			// SQL 中已经引用过的表 / 别名：列出它的列
			const refs = parseReferencedTables(sql);
			const ref = refs.find((r) => r.alias === qualifier || r.table === qualifier);
			if (ref) {
				const sch = ref.schema || cur;
				if (sch) {
					const cols = await columnsOf(sch, ref.table);
					const prefix = ref.alias || ref.table;
					for (const c of cols) items.push({ label: c, kind: 'column', detail: `${prefix}.${c}` });
				}
			}
			return items;
		}

		const tableSlots = new Set(['from', 'join', 'update', 'into']);
		if (tableSlots.has(prevToken)) {
			if (cur) {
				const tables = await tablesIn(cur);
				for (const t of tables) items.push({ label: t, kind: 'table', detail: cur });
			}
			for (const s of schemas) {
				if (s === cur) continue;
				items.push({ label: s, kind: 'schema', detail: 'database' });
			}
		} else {
			// 默认按列名补全：从 SQL 里引用的表里取
			const refs = parseReferencedTables(sql);
			const seen = new Set();
			for (const r of refs) {
				const sch = r.schema || cur;
				if (!sch) continue;
				const cols = await columnsOf(sch, r.table);
				const prefix = r.alias || r.table;
				for (const c of cols) {
					const key = `${prefix}::${c}`;
					if (seen.has(key)) continue;
					seen.add(key);
					items.push({ label: c, kind: 'column', detail: `${prefix}.${c}` });
				}
			}
			// 兜底：当前 schema 的表名（光标可能正在写 SELECT * FROM 之外的位置）
			if (cur && tablesBySchema[cur]) {
				for (const t of tablesBySchema[cur]) items.push({ label: t, kind: 'table', detail: cur });
			}
		}

		const { keywords, functions } = getCompletionItems(schemaConn.driver);
		for (const f of functions) items.push({ label: f, kind: 'function' });
		for (const k of keywords) items.push({ label: k, kind: 'keyword' });
		return items;
	}

	function format() {
		const trimmed = sql.trim();
		if (!trimmed) return;
		try {
			const language = schemaConn.driver === 'Postgresql' ? 'postgresql' : 'mysql';
			const formatted = formatSql(trimmed, {
				language,
				keywordCase: 'upper',
				tabWidth: 2,
				useTabs: false,
				linesBetweenQueries: 1
			});
			if (formatted !== sql) sql = formatted;
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('sql.toast.format_failed'));
		}
	}

	/**
	 * 把 SQL 文本切成多条语句。语义层面的"分号"才是分隔符；字符串字面量、行注释、
	 * 块注释里的分号都要排除。这里走一遍简易状态机以便正确处理 'a;b' / "a;b" / -- ; / /* ; *​/。
	 *
	 * @param {string} text
	 * @returns {string[]}
	 */
	function splitStatements(text) {
		const out = [];
		let buf = '';
		let i = 0;
		const n = text.length;
		// 0=normal, 1=single-quote string, 2=double-quote string, 3=backtick ident, 4=line comment, 5=block comment
		let mode = 0;
		while (i < n) {
			const ch = text[i];
			const next = text[i + 1];
			if (mode === 0) {
				if (ch === '-' && next === '-') { buf += ch + next; i += 2; mode = 4; continue; }
				if (ch === '/' && next === '*') { buf += ch + next; i += 2; mode = 5; continue; }
				if (ch === "'") { mode = 1; buf += ch; i++; continue; }
				if (ch === '"') { mode = 2; buf += ch; i++; continue; }
				if (ch === '`') { mode = 3; buf += ch; i++; continue; }
				if (ch === ';') {
					const piece = buf.trim();
					if (piece) out.push(piece);
					buf = '';
					i++;
					continue;
				}
				buf += ch; i++; continue;
			}
			if (mode === 1) {
				buf += ch;
				if (ch === "'") {
					if (next === "'") { buf += next; i += 2; continue; }
					mode = 0;
				}
				i++; continue;
			}
			if (mode === 2) {
				buf += ch;
				if (ch === '"') {
					if (next === '"') { buf += next; i += 2; continue; }
					mode = 0;
				}
				i++; continue;
			}
			if (mode === 3) {
				buf += ch;
				if (ch === '`') mode = 0;
				i++; continue;
			}
			if (mode === 4) {
				buf += ch;
				if (ch === '\n') mode = 0;
				i++; continue;
			}
			if (mode === 5) {
				buf += ch;
				if (ch === '*' && next === '/') { buf += next; i += 2; mode = 0; continue; }
				i++; continue;
			}
		}
		const tail = buf.trim();
		if (tail) out.push(tail);
		return out;
	}

	/**
	 * 判断 SQL 是否为 SELECT 查询（走流式响应）。
	 * @param {string} stmt
	 */
	function isSelectStmt(stmt) {
		return /^\s*SELECT\b/i.test(stmt);
	}

	async function run() {
		const selected = (editorRef?.getSelectedText() ?? '').trim();
		const source = (selected || sql).trim();
		if (!source) return;
		const stmts = splitStatements(source);
		if (stmts.length === 0) return;

		const ro = isReadOnlySchema(schemaConn, schemaConn.database);
		if (ro) {
			for (const stmt of stmts) {
				const kw = detectWriteKeyword(stmt);
				if (kw) {
					err(get(t)('sql.toast.mysql_readonly', { kw }));
					return;
				}
			}
		}

		pending = true;
		vsReset();
		const collected = /** @type {StatementResult[]} */ ([]);
		try {
			for (const stmt of stmts) {
				try {
					if (isSelectStmt(stmt)) {
						// SELECT 走流式响应
						const accRows = [];
						const colSet = new Set();
						vsStreaming = true;
						// 先占位，流式过程中增量更新
						const idx = collected.length;
						collected.push({ sql: stmt, success: true, error: null, rows: [], columns: [], affectedRows: null });
						results = [...collected];
						activeResultIdx = idx;

						try {
							const resp = await executeSqlStreaming(schemaConn, stmt, (data) => {
								if (data && typeof data === 'object') {
									const d = /** @type {Record<string, unknown>} */ (data);
									const rowArr = Array.isArray(d.rows) ? d.rows : [];
									for (const row of rowArr) {
										accRows.push(row);
										if (row && typeof row === 'object') {
											for (const k of Object.keys(row)) colSet.add(k);
										}
									}
									const cols = [...colSet];
									collected[idx] = { ...collected[idx], rows: [...accRows], columns: cols };
									results = [...collected];
									if (!vsActive && accRows.length > VS_THRESHOLD) {
										vsActive = true;
									}
								}
							});
							vsStreaming = false;
							if (!resp.success) {
								collected[idx] = { sql: stmt, success: false, error: resp.error ?? get(t)('sql.exec_failed'), rows: [], columns: [], affectedRows: null };
							} else {
								const cols = [...colSet];
								collected[idx] = { sql: stmt, success: true, error: null, rows: accRows, columns: cols, affectedRows: null };
							}
							results = [...collected];
							if (accRows.length > VS_THRESHOLD && !vsActive) vsActive = true;
							if (vsActive) { vsColsLocked = false; vsColWidths = []; }
						} finally {
							vsStreaming = false;
						}
					} else {
						// 非 SELECT 走普通响应
						const resp = await executeSql(schemaConn, stmt);
						if (!resp.success) {
							collected.push({ sql: stmt, success: false, error: resp.error ?? get(t)('sql.exec_failed'), rows: [], columns: [], affectedRows: null });
							continue;
						}
						const r = asSqlResult(resp.data);
						collected.push({ sql: stmt, success: true, error: null, rows: r.rows, columns: r.columns, affectedRows: r.affectedRows });
					}
				} catch (e) {
					collected.push({ sql: stmt, success: false, error: e instanceof Error ? e.message : String(e), rows: [], columns: [], affectedRows: null });
				}
			}
			results = collected;
			activeResultIdx = 0;

			const failed = collected.filter((r) => !r.success).length;
			const totalAffected = collected.reduce((acc, r) => acc + (r.affectedRows ?? 0), 0);
			if (failed > 0) {
				err(get(t)('sql.toast.stmts_failed', { total: stmts.length, failed }));
			} else if (totalAffected > 0) {
				ok(get(t)('sql.toast.stmts_ok', { affected: totalAffected, total: stmts.length }));
			}
		} finally {
			pending = false;
		}
	}
</script>

<section class="flex h-full flex-col">
	<header
		class="flex items-center px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="shrink-0 text-sm font-medium" style="color: var(--md-on-surface);">{$t('sql.title')}</h2>
		<span class="ml-3 flex-1 truncate text-xs font-mono" style="color: var(--md-on-surface-variant);">
			{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '—'}{schemaConn.driver === 'Postgresql' ? '/' + (schemaConn._schema || 'public') : ''}
		</span>
		<div class="ml-3 flex shrink-0 items-center gap-1">
			<button
				type="button"
				class="sql-tool-btn"
				onclick={format}
				disabled={!sql.trim()}
				title={$t('sql.format_tooltip')}
			>
				{$t('sql.format')}
			</button>
			<button
				type="button"
				class="sql-run-btn"
				onclick={run}
				disabled={pending || !sql.trim()}
				title={$t('sql.run_tooltip')}
				aria-label={$t('sql.run_aria')}
			>
				{#if pending}
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="20">
							<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
						</circle>
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<path d="M8 5v14l11-7z" fill="currentColor" />
					</svg>
				{/if}
			</button>
		</div>
	</header>

	<div class="flex min-h-0 flex-1 flex-col overflow-auto">
		<div class="h-56 w-full">
			<SqlEditor
				bind:this={editorRef}
				value={sql}
				onValueChange={(v) => (sql = v)}
				onCtrlEnter={run}
				onFormat={format}
				{getSuggestions}
				placeholder={$t('sql.placeholder')}
			/>
		</div>

		<hr style="border: none; border-top: 1px solid var(--md-outline-variant); margin: 0;" />

		{#if results.length > 0}
			<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
				<nav
					class="flex shrink-0 items-end gap-px overflow-x-auto"
					style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
				>
					{#each results as r, i (i)}
						<button
							type="button"
							class="result-tab"
							aria-selected={activeResultIdx === i}
							onclick={() => { activeResultIdx = i; vsReset(); }}
							title={r.sql.length > 200 ? r.sql.slice(0, 200) + '…' : r.sql}
							style:background={activeResultIdx === i ? 'var(--md-surface)' : 'transparent'}
							style:color={activeResultIdx === i ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)'}
							style="border-top: 2px solid {activeResultIdx === i ? (r.success ? 'var(--md-primary)' : 'var(--md-error, #B3261E)') : 'transparent'};"
						>
							<span class="dot" style:background={r.success ? 'var(--md-primary)' : 'var(--md-error, #B3261E)'}></span>
							<span class="font-mono">#{i + 1}</span>
							<span class="truncate" style="max-width: 12rem; color: var(--md-on-surface-variant);">
								{r.sql.replace(/\s+/g, ' ').slice(0, 40)}{r.sql.length > 40 ? '…' : ''}
							</span>
						</button>
					{/each}
				</nav>

				<div class="px-3 py-2 text-xs" style="background: var(--md-surface);">
					<code class="font-mono" style="color: var(--md-on-surface-variant);">{cur.sql.length > 160 ? cur.sql.slice(0, 160) + '…' : cur.sql}</code>
				</div>

				{#if !cur.success}
					<div
						class="px-4 py-3 text-sm"
						style="background: var(--md-error-container, #F9DEDC); color: var(--md-on-error-container, #410E0B); border-top: 1px solid var(--md-outline-variant);"
					>
						{cur.error ?? $t('sql.exec_failed')}
					</div>
				{:else if cur.affectedRows !== null && cur.rows.length === 0}
					<div
						class="px-4 py-3 text-sm"
						style="background: var(--md-success-container); color: var(--md-on-success-container); border-top: 1px solid var(--md-outline-variant);"
					>
						{$t('sql.affected_rows', { count: cur.affectedRows })}
					</div>
				{:else if cur.rows.length > 0 && cur.columns.length > 0}
					<div
						class="min-h-0 flex-1 overflow-auto"
						style="border-top: 1px solid var(--md-outline-variant);"
						bind:this={vsScrollEl}
						onscroll={vsOnScroll}
						bind:clientHeight={vsViewportH}
					>
						<table
							class="min-w-full text-left text-xs"
							style:table-layout={vsColsLocked ? 'fixed' : 'auto'}
						>
							<thead
								class="sticky top-0"
								style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
							>
								<tr>
									{#each cur.columns as col, ci (col)}
										<th
											class="px-3 py-2 font-medium font-mono truncate"
											style="border-bottom: 1px solid var(--md-outline-variant);"
											style:width={vsColsLocked ? `${vsColWidths[ci] ?? 120}px` : undefined}
											oncontextmenu={(e) => openHeaderCtx(e, col)}
										>
											{col}
										</th>
									{/each}
								</tr>
							</thead>
							{#if vsRange}
								<tbody>
									<tr class="vs-spacer" style:height="{vsRange.offsetY}px">
										<td colspan={cur.columns.length} style="padding: 0; border: none;"></td>
									</tr>
									{#each vsVisRows as row, vi (vsRange.start + vi)}
										{@const i = vsRange.start + vi}
										<tr style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}>
											{#each cur.columns as col, ci (col)}
												<td
													class="truncate px-3 py-1.5 font-mono"
													style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
													style:width={vsColsLocked ? `${vsColWidths[ci] ?? 120}px` : undefined}
													oncontextmenu={(e) => openCellCtx(e, row, col, row[col])}
												>
													{#if isLob(row[col])}
														<span class="italic" style="color: var(--md-on-surface-variant);">{row[col]}</span>
													{:else}
														{renderCell(row[col])}
													{/if}
												</td>
											{/each}
										</tr>
									{/each}
									<tr class="vs-spacer" style:height="{vsRange.bottomPad}px">
										<td colspan={cur.columns.length} style="padding: 0; border: none;"></td>
									</tr>
								</tbody>
							{:else}
								<tbody>
									{#each cur.rows as row, i (i)}
										<tr style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}>
											{#each cur.columns as col (col)}
												<td
													class="max-w-[24rem] truncate px-3 py-1.5 font-mono"
													style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
													oncontextmenu={(e) => openCellCtx(e, row, col, row[col])}
												>
													{#if isLob(row[col])}
														<span class="italic" style="color: var(--md-on-surface-variant);">{row[col]}</span>
													{:else}
														{renderCell(row[col])}
													{/if}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							{/if}
						</table>
					</div>
					<p class="px-3 py-1.5 text-right text-xs" style="color: var(--md-on-surface-variant); border-top: 1px solid var(--md-outline-variant);">{$t('sql.rows_result', { count: cur.rows.length })}</p>
				{:else}
					<p class="px-3 py-6 text-center text-sm" style="color: var(--md-on-surface-variant); border-top: 1px solid var(--md-outline-variant);">{$t('sql.no_result')}</p>
				{/if}
			</div>
		{/if}
	</div>
</section>

<ContextMenu
	open={cellCtx
		? {
				x: cellCtx.x,
				y: cellCtx.y,
				items: [
					cellCtx?.selection
						? {
								label: $t('sql.ctx.copy_selected'),
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyText(cellCtx.selection);
								}
							}
						: {
								label: $t('sql.ctx.copy'),
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyValue(cellCtx.value);
								}
							},
					{
						label: $t('sql.ctx.copy_row'),
						icon: '⊟',
						onClick: () => {
							if (cellCtx) copyText(rowToTsv(results[activeResultIdx]?.columns ?? [], cellCtx.row), get(t)('datagrid.toast.row_copied'));
						}
					},
					{
						label: $t('sql.ctx.copy_column'),
						icon: '⧉',
						onClick: () => {
							if (cellCtx) copyValue(cellCtx.col);
						}
					},
					cellCtx?.value !== null && cellCtx?.value !== undefined && isLob(cellCtx.value)
						? {
								label: $t('sql.ctx.view_lob'),
								icon: '⊕',
								onClick: () => {
									if (cellCtx) copyValue(cellCtx.value);
								}
							}
						: null
				].filter((i) => i !== null)
			}
		: null}
	onClose={() => (cellCtx = null)}
/>

<ContextMenu
	open={headerCtx ? {
		x: headerCtx.x,
		y: headerCtx.y,
		items: [
			{ label: $t('sql.ctx.copy_column'), icon: '⧉', onClick: () => { if (headerCtx) copyValue(headerCtx.col); } }
		]
	} : null}
	onClose={() => (headerCtx = null)}
/>

<style>
	.sql-tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.5rem;
		padding: 0 0.625rem;
		font-size: 0.75rem;
		line-height: 1;
		color: var(--md-primary);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--md-radius-xs);
		cursor: pointer;
		transition: background-color 120ms ease;
	}
	.sql-tool-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--md-primary) 8%, transparent);
	}
	.sql-tool-btn:disabled {
		color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
		cursor: not-allowed;
	}

	.sql-run-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		color: var(--md-on-primary);
		background: var(--md-primary);
		border: none;
		border-radius: var(--md-radius-xs);
		cursor: pointer;
		transition: filter 120ms ease, background-color 120ms ease;
	}
	.sql-run-btn:hover:not(:disabled) {
		filter: brightness(1.08);
	}
	.sql-run-btn:disabled {
		background: color-mix(in srgb, var(--md-on-surface) 12%, transparent);
		color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
		cursor: not-allowed;
	}

	.result-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		font-size: 0.75rem;
		line-height: 1;
		background: transparent;
		border: none;
		border-radius: var(--md-radius-xs) var(--md-radius-xs) 0 0;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 120ms ease;
	}
	.result-tab:hover {
		background: color-mix(in srgb, var(--md-on-surface) 4%, transparent) !important;
	}
	.result-tab .dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 9999px;
	}
	.result-tab .truncate {
		display: inline-block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
