<script>
	import { executeSql, listSchemas, listTables, listColumns } from '$lib/api';
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
	import { format as formatSql } from 'sql-formatter';
	import SqlEditor from './SqlEditor.svelte';
	import ContextMenu from './ContextMenu.svelte';

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
	let cellCtx = $state(/** @type {{ x: number; y: number; col: string; value: unknown } | null} */ (null));
	let headerCtx = $state(/** @type {{ x: number; y: number; col: string } | null} */ (null));

	function openCellCtx(e, col, value) {
		e.preventDefault();
		cellCtx = { x: e.clientX, y: e.clientY, col, value };
	}

	function openHeaderCtx(e, col) {
		e.preventDefault();
		headerCtx = { x: e.clientX, y: e.clientY, col };
	}

	async function copyValue(value) {
		try {
			await navigator.clipboard.writeText(String(value ?? ''));
			ok('已复制');
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
		}
	}

	// 元数据缓存：避免每次按键都去打引擎。schemaConn.database 是当前 tab 绑定的 schema，
	// 跨 schema 的表 / 列懒加载，结果落到下面两个对象里。
	let schemas = $state(/** @type {string[]} */ ([]));
	let tablesBySchema = $state(/** @type {Record<string, string[]>} */ ({}));
	/** key: "schema.table" → 列名数组 */
	let columnsByQualifiedTable = $state(/** @type {Record<string, string[]>} */ ({}));

	const SQL_KEYWORDS = [
		'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
		'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
		'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON',
		'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL',
		'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'DISTINCT', 'UNION', 'UNION ALL',
		'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'TRUE', 'FALSE'
	];

	const SQL_FUNCTIONS = [
		'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
		'NOW', 'CURRENT_DATE', 'CURRENT_TIMESTAMP',
		'COALESCE', 'NULLIF', 'CAST', 'CONVERT',
		'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'SUBSTRING', 'CONCAT'
	];

	// 上一次拉取过的连接键，避免 schemaConn 引用变了但内容相同时重复拉。
	let lastLoadKey = '';

	$effect(() => {
		const conn = schemaConn;
		if (!conn) return;
		const key = `${conn.driver}|${conn.host}|${conn.port}|${conn.user}|${conn.database}`;
		if (key === lastLoadKey) return;
		lastLoadKey = key;
		void loadInitialMeta(conn);
	});

	/** @param {ConnectionConfig} conn */
	async function loadInitialMeta(conn) {
		try {
			const sResp = await listSchemas(conn);
			if (sResp.success) schemas = asStringList(sResp.data);
		} catch (_) { /* 忽略：完成项只是辅助 */ }

		const cur = conn.database;
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
			const r = await listTables({ ...schemaConn, database: schema });
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
			const r = await listColumns({ ...schemaConn, database: schema }, table);
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
		const cur = schemaConn.database || '';

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

		for (const f of SQL_FUNCTIONS) items.push({ label: f, kind: 'function' });
		for (const k of SQL_KEYWORDS) items.push({ label: k, kind: 'keyword' });
		return items;
	}

	function format() {
		const trimmed = sql.trim();
		if (!trimmed) return;
		try {
			const language = schemaConn.driver === 'Postgresql' ? 'Postgres' : 'Mysql';
			const formatted = formatSql(trimmed, {
				language,
				keywordCase: 'upper',
				tabWidth: 2,
				useTabs: false,
				linesBetweenQueries: 1
			});
			if (formatted !== sql) sql = formatted;
		} catch (e) {
			err(e instanceof Error ? e.message : 'SQL 格式化失败');
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
					err(`MySQL 系统库只读，禁止执行 ${kw} 语句`);
					return;
				}
			}
		}

		pending = true;
		const collected = /** @type {StatementResult[]} */ ([]);
		try {
			for (const stmt of stmts) {
				try {
					const resp = await executeSql(schemaConn, stmt);
					if (!resp.success) {
						collected.push({ sql: stmt, success: false, error: resp.error ?? 'SQL 执行失败', rows: [], columns: [], affectedRows: null });
						continue;
					}
					const r = asSqlResult(resp.data);
					collected.push({ sql: stmt, success: true, error: null, rows: r.rows, columns: r.columns, affectedRows: r.affectedRows });
				} catch (e) {
					collected.push({ sql: stmt, success: false, error: e instanceof Error ? e.message : String(e), rows: [], columns: [], affectedRows: null });
				}
			}
			results = collected;
			activeResultIdx = 0;

			const failed = collected.filter((r) => !r.success).length;
			const totalAffected = collected.reduce((acc, r) => acc + (r.affectedRows ?? 0), 0);
			if (failed > 0) {
				err(`${stmts.length} 条语句中 ${failed} 条失败`);
			} else if (totalAffected > 0) {
				ok(`受影响行数：${totalAffected}（共 ${stmts.length} 条）`);
			}
		} finally {
			pending = false;
		}
	}
</script>

<section class="flex h-full flex-col gap-3">
	<header
		class="flex items-center justify-between px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface);">SQL 控制台</h2>
		<div class="flex items-center gap-3">
			<div class="text-xs font-mono" style="color: var(--md-on-surface-variant);">
				{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '(未选库)'}
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="sql-tool-btn"
					onclick={format}
					disabled={!sql.trim()}
					title="格式化 (Ctrl/Cmd + Shift + F)"
				>
					格式化
				</button>
				<button
					type="button"
					class="sql-run-btn"
					onclick={run}
					disabled={pending || !sql.trim()}
					title="执行 (Ctrl/Cmd + Enter)"
					aria-label="执行"
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
		</div>
	</header>

	<div class="flex flex-col gap-3 px-3 pb-3">
		<div class="h-56 w-full">
			<SqlEditor
				bind:this={editorRef}
				value={sql}
				onValueChange={(v) => (sql = v)}
				onCtrlEnter={run}
				onFormat={format}
				{getSuggestions}
				placeholder={'SELECT id, name FROM users LIMIT 10;\n\nCtrl/Cmd + Enter 执行（有选中则执行选中部分）   Ctrl/Cmd + Shift + F 格式化'}
			/>
		</div>

		{#if results.length > 0}
			{@const cur = results[activeResultIdx] ?? results[0]}
			<div class="flex flex-col" style="border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-md); overflow: hidden;">
				<nav
					class="flex shrink-0 items-end gap-px overflow-x-auto"
					style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
				>
					{#each results as r, i (i)}
						<button
							type="button"
							class="result-tab"
							aria-selected={activeResultIdx === i}
							onclick={() => (activeResultIdx = i)}
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
						{cur.error ?? '执行失败'}
					</div>
				{:else if cur.affectedRows !== null && cur.rows.length === 0}
					<div
						class="px-4 py-3 text-sm"
						style="background: var(--md-success-container); color: var(--md-on-success-container); border-top: 1px solid var(--md-outline-variant);"
					>
						受影响行数：{cur.affectedRows}
					</div>
				{:else if cur.rows.length > 0 && cur.columns.length > 0}
					<div class="max-h-[50vh] overflow-auto" style="border-top: 1px solid var(--md-outline-variant);">
						<table class="min-w-full text-left text-xs">
							<thead
								class="sticky top-0"
								style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
							>
								<tr>
									{#each cur.columns as col (col)}
										<th
											class="px-3 py-2 font-medium font-mono whitespace-nowrap"
											style="border-bottom: 1px solid var(--md-outline-variant);"
											oncontextmenu={(e) => openHeaderCtx(e, col)}
										>
											{col}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each cur.rows as row, i (i)}
									<tr style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}>
										{#each cur.columns as col (col)}
											<td
												class="max-w-[24rem] truncate px-3 py-1.5 font-mono"
												style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
												oncontextmenu={(e) => openCellCtx(e, col, row[col])}
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
						</table>
					</div>
					<p class="px-3 py-1.5 text-right text-xs" style="color: var(--md-on-surface-variant); border-top: 1px solid var(--md-outline-variant);">{cur.rows.length} 行结果</p>
				{:else}
					<p class="px-3 py-6 text-center text-sm" style="color: var(--md-on-surface-variant); border-top: 1px solid var(--md-outline-variant);">无结果</p>
				{/if}
			</div>
		{/if}
	</div>
</section>

<ContextMenu
	open={cellCtx ? {
		x: cellCtx.x,
		y: cellCtx.y,
		items: [
			{ label: '复制', icon: '⧉', onClick: () => { if (cellCtx) copyValue(cellCtx.value); } },
			{ label: '复制列名', icon: '⧉', onClick: () => { if (cellCtx) copyValue(cellCtx.col); } }
		]
	} : null}
	onClose={() => (cellCtx = null)}
/>

<ContextMenu
	open={headerCtx ? {
		x: headerCtx.x,
		y: headerCtx.y,
		items: [
			{ label: '复制列名', icon: '⧉', onClick: () => { if (headerCtx) copyValue(headerCtx.col); } }
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
