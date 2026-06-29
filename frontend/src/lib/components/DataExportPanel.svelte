<script>
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { ok, err } from '$lib/stores/toasts.js';
	import { startExport, cancelExport } from '$lib/api/export.js';
	import { pickDirectory } from '$lib/wailsDialog.js';
	import { listSchemas, listTables, listColumns } from '$lib/api';
	import { asStringList, asTableList, asColumnList } from '$lib/api/normalize.js';
	import { getCompletionItems } from '$lib/sqlCompletion.js';
	import SqlEditor from './SqlEditor.svelte';
	import { format as formatSql } from 'sql-formatter';
	import { invokeStreaming } from '$lib/api/index.js';

	/** @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig */

	/** @type {{ schemaConn: ConnectionConfig }} */
	let { schemaConn } = $props();

	// ── 配置 ──
	let sql = $state('');
	let format = $state('CSV');
	let outputDir = $state('');
	let fileName = $state(new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14));
	let tableName = $state('');
	let fetchSize = $state(1000);

	// ── 状态 ──
	let running = $state(false);
	let previewing = $state(false);
	let exportedRows = $state(0);
	let currentExportId = $state('');

	// ── Tab ──
	let activeTab = $state(/** @type {'preview' | 'log'} */ ('preview'));

	// ── 预览 ──
	let previewRows = $state(/** @type {Record<string, unknown>[]} */ ([]));
	let previewColumns = $state(/** @type {string[]} */ ([]));

	// ── 日志 ──
	let sqlLogs = $state(/** @type {string[]} */ ([]));
	let logEl = $state(/** @type {HTMLDivElement | null} */ (null));
	let logBuf = /** @type {string[]} */ ([]);
	const MAX_LOG = 500;

	// ── SQL 补全元数据缓存 ──
	let schemas = $state(/** @type {string[]} */ ([]));
	let tablesBySchema = $state(/** @type {Record<string, string[]>} */ ({}));
	let columnsByQualifiedTable = $state(/** @type {Record<string, string[]>} */ ({}));
	let lastLoadKey = '';

	// ── 加载初始元数据 ──
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
		} catch (_) { /* 忽略 */ }

		// 当前 schema：PG 取 _schema，MySQL 取 database
		const cur = conn.driver === 'Postgresql' ? (conn._schema || '') : conn.database;
		if (cur && !tablesBySchema[cur]) {
			try {
				const tResp = await listTables(conn);
				if (tResp.success) {
					const list = asTableList(tResp.data).map((t) => t.name);
					tablesBySchema = { ...tablesBySchema, [cur]: list };
				}
			} catch (_) { /* 忽略 */ }
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
	 * @param {string} text
	 * @returns {{ schema?: string; table: string; alias?: string }[]}
	 */
	function parseReferencedTables(text) {
		const refs = [];
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
	 * @typedef {Object} Suggestion
	 * @property {string} label
	 * @property {'schema' | 'table' | 'column' | 'keyword' | 'function'} kind
	 * @property {string} [detail]
	 */

	/**
	 * @param {{ word: string; prevToken: string; qualifier: string | null }} ctx
	 * @returns {Promise<Suggestion[]>}
	 */
	async function getSuggestions(ctx) {
		const { prevToken, qualifier } = ctx;
		const items = /** @type {Suggestion[]} */ ([]);
		const cur = (schemaConn.driver === 'Postgresql' ? (schemaConn._schema || '') : schemaConn.database) || '';

		if (qualifier) {
			if (schemas.includes(qualifier)) {
				const tables = await tablesIn(qualifier);
				for (const t of tables) items.push({ label: t, kind: 'table', detail: `${qualifier}.${t}` });
				return items;
			}
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
			if (cur && tablesBySchema[cur]) {
				for (const t of tablesBySchema[cur]) items.push({ label: t, kind: 'table', detail: cur });
			}
		}

		const { keywords, functions } = getCompletionItems(schemaConn.driver);
		for (const f of functions) items.push({ label: f, kind: 'function' });
		for (const k of keywords) items.push({ label: k, kind: 'keyword' });
		return items;
	}

	// ── 虚拟滚动 ──
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

	let vsRange = $derived.by(() => {
		if (!vsActive || previewRows.length === 0) return null;
		const rh = vsRowH;
		const start = Math.max(0, Math.floor(vsScrollTop / rh) - VS_OVERSCAN);
		const end = Math.min(
			previewRows.length,
			Math.ceil((vsScrollTop + vsViewportH) / rh) + VS_OVERSCAN
		);
		return {
			start,
			end,
			offsetY: start * rh,
			bottomPad: (previewRows.length - start - (end - start)) * rh
		};
	});
	let vsVisRows = $derived(vsRange ? previewRows.slice(vsRange.start, vsRange.end) : null);

	function vsOnScroll(e) {
		if (vsRafId) return;
		vsRafId = requestAnimationFrame(() => {
			vsRafId = 0;
			vsScrollTop = e.target.scrollTop;
		});
	}
	function vsMeasureCols() {
		if (vsColsLocked || !vsScrollEl || previewRows.length === 0) return;
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
	}

	$effect(() => {
		const el = vsScrollEl;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => {
			vsViewportH = e.contentRect.height;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
	$effect(() => {
		if (!vsActive || vsColsLocked || previewRows.length === 0) return;
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

	// ── 格式选项 ──
	const FORMATS = [
		{ value: 'CSV', label: 'CSV' },
		{ value: 'JSON_LINES', label: 'JSON Lines (.jsonl)' },
		{ value: 'SQL_INSERT', label: 'SQL INSERT' },
		{ value: 'EXCEL', label: 'Excel (.xlsx)' },
		{ value: 'PARQUET', label: 'Parquet' }
	];

	// ── 工具函数 ──
	function addLimit(sqlText, limit) {
		const trimmed = sqlText.trim();
		return /\blimit\s+\d+/i.test(trimmed) ? trimmed : trimmed + ` LIMIT ${limit}`;
	}
	function flushLogs() {
		if (logBuf.length === 0) return;
		sqlLogs = [...sqlLogs, ...logBuf].slice(-MAX_LOG);
		logBuf = [];
		requestAnimationFrame(() => {
			if (logEl) logEl.scrollTop = logEl.scrollHeight;
		});
	}

	// ── 操作 ──
	async function pickOutputDir() {
		const dir = await pickDirectory(get(t)('export.pick_dir'));
		if (dir) outputDir = dir;
	}

	function formatSqlText() {
		const trimmed = sql.trim();
		if (!trimmed) return;
		try {
			sql = formatSql(trimmed, {
				language: schemaConn.driver === 'Postgresql' ? 'postgresql' : 'mysql',
				keywordCase: 'upper',
				tabWidth: 2,
				useTabs: false,
				linesBetweenQueries: 1
			});
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('sql.toast.format_failed'));
		}
	}

	async function doPreview() {
		if (previewing || !sql.trim()) return;
		previewing = true;
		previewRows = [];
		previewColumns = [];
		vsReset();
		const accRows = [];
		const colSet = new Set();
		let previewError = /** @type {string | null} */ (null);
		try {
			const resp = await invokeStreaming('SQL', 'EXECUTE', schemaConn, { sql: addLimit(sql, 1000) }, (data) => {
				if (!data || typeof data !== 'object') return;
				const rows = Array.isArray(data.rows) ? data.rows : [];
				for (const row of rows) {
					if (row && typeof row === 'object') {
						accRows.push(row);
						for (const k of Object.keys(row)) colSet.add(k);
					}
				}
				if (!vsActive && accRows.length > VS_THRESHOLD) vsActive = true;
			}, (endData) => {
				// 处理流结束时的错误
				if (!endData || typeof endData !== 'object') return;
				const d = /** @type {Record<string, unknown>} */ (endData);
				if (d.success === false && d.error) {
					previewError = /** @type {string} */ (d.error);
				}
			});
			// 检查流初始化错误
			if (!resp.success) {
				previewError = resp.error ?? get(t)('export.preview_failed');
			}
			if (previewError) {
				err(previewError);
				previewRows = [];
				previewColumns = [];
				return;
			}
			previewRows = accRows;
			previewColumns = [...colSet];
			if (previewRows.length > VS_THRESHOLD && !vsActive) {
				vsActive = true;
				vsColsLocked = false;
				vsColWidths = [];
			}
			ok(get(t)('export.preview_ok', { count: previewRows.length }));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('export.preview_failed'));
		} finally {
			previewing = false;
		}
	}

	async function doExport() {
		if (running) return;
		if (!sql.trim()) {
			err(get(t)('export.sql_required'));
			return;
		}
		if (!outputDir.trim()) {
			err(get(t)('export.output_dir_required'));
			return;
		}
		if (!fileName.trim()) {
			err(get(t)('export.filename_required'));
			return;
		}
		if (format === 'SQL_INSERT' && !tableName.trim()) {
			err(get(t)('export.table_name_required'));
			return;
		}

		running = true;
		exportedRows = 0;
		sqlLogs = [];
		logBuf = [];
		activeTab = 'log';

		// 生成导出任务 ID
		const exportId = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		currentExportId = exportId;

		const payload = {
			sql: sql.trim(),
			outputDir: outputDir.trim(),
			fileName: fileName.trim(),
			format,
			fetchSize
		};
		if (format === 'SQL_INSERT' && tableName.trim()) payload.tableName = tableName.trim();

		const timer = setInterval(flushLogs, 100);
		try {
			const resp = await startExport(
				schemaConn,
				payload,
				(data) => {
					// 流式进度回调：显示原始数据
					if (!data || typeof data !== 'object') return;
					logBuf.push(JSON.stringify(data));
					if (data.exportedRows !== undefined) exportedRows = data.exportedRows;
				},
				(endData) => {
					// 结束回调：判断完成状态
					// endData 是完整的 envelope：{ id, success, stream, end, data }
					// data 里面才是 { exportedRows, columnCount, completed, filePath }
					if (!endData || typeof endData !== 'object') return;
					const data = endData.data;
					if (!data) return;
					// end=true 这一行也写进 SQL 日志（包含权威行数）
					logBuf.push(JSON.stringify(data));
					// 末行的 exportedRows 是权威值，覆盖流过程中的累加值
					if (data.exportedRows !== undefined) exportedRows = data.exportedRows;
					if (data.completed === true) {
						logBuf.push(`\n✅ ${get(t)('export.completed', { rows: exportedRows })}`);
					}
					if (data.filePath) {
						logBuf.push(`📁 ${data.filePath}`);
						ok(get(t)('export.export_success', { path: data.filePath }));
					}
					if (data.error) {
						logBuf.push(`❌ ${data.error}`);
						err(data.error);
					}
				}
			);
			if (!resp.success) {
				err(resp.error ?? get(t)('export.export_failed'));
			}
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('export.export_failed'));
		} finally {
			clearInterval(timer);
			flushLogs();
			running = false;
			currentExportId = '';
		}
	}

	async function doStop() {
		if (!currentExportId) return;
		try {
			await cancelExport(schemaConn, currentExportId);
			ok(get(t)('export.export_stopped'));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('export.stop_failed'));
		}
	}
</script>

<!-- Header: 两行布局 -->
<header
	class="shrink-0 flex-col"
	style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
>
	<!-- 第一行：标题 + 连接信息 + 操作按钮 -->
	<div class="flex items-center gap-3 px-3 py-1.5">
		<h2 class="shrink-0 text-sm font-semibold" style="color: var(--md-on-surface);">
			{$t('export.title')}
		</h2>
		<span class="flex-1 truncate font-mono text-[11px]" style="color: var(--md-on-surface-variant);">
			{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '—'}{schemaConn.driver === 'Postgresql' ? '/' + (schemaConn._schema || 'public') : ''}
		</span>
		<div class="flex shrink-0 items-center gap-1.5">
			<button
				type="button"
				class="rounded border px-2 py-1 text-[11px] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
				style="border-color: var(--md-outline-variant); color: var(--md-on-surface-variant);"
				onclick={formatSqlText}
				disabled={running || !sql.trim()}
				title={$t('sql.format_tooltip')}
			>
				{$t('sql.format')}
			</button>
			<button
				type="button"
				class="rounded border px-2 py-1 text-[11px] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
				style="border-color: var(--md-outline-variant); color: var(--md-on-surface-variant);"
				onclick={doPreview}
				disabled={running || previewing || !sql.trim()}
			>
				{#if previewing}
					<svg viewBox="0 0 24 24" width="14" height="14" class="animate-spin" aria-hidden="true"
						><circle
							cx="12"
							cy="12"
							r="9"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-dasharray="40"
							stroke-dashoffset="20"
						/></svg
					>
				{:else}{$t('export.preview')}{/if}
			</button>
			{#if running}
				<button
					type="button"
					class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition hover:opacity-90"
					style="background: var(--md-error, #B3261E); color: var(--md-on-error, white);"
					onclick={doStop}
				>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
						><path d="M6 6h12v12H6z" fill="currentColor" /></svg
					>
					{$t('export.stop')}
				</button>
			{:else}
				<button
					type="button"
					class="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					style="background: var(--md-primary); color: var(--md-on-primary);"
					onclick={doExport}
					disabled={!sql.trim() || !outputDir.trim() || !fileName.trim()}
				>
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
						><path d="M8 5v14l11-7z" fill="currentColor" /></svg
					>
					{$t('export.start_export')}
				</button>
			{/if}
		</div>
	</div>
	<!-- 第二行：配置输入（带分割线） -->
	<div
		class="flex items-center gap-3 px-3 py-1.5"
		style="border-top: 1px solid var(--md-outline-variant);"
	>
		<label class="flex min-w-0 flex-1 items-center gap-1">
			<span class="text-[11px] whitespace-nowrap" style="color: var(--md-on-surface-variant);"
				>{$t('export.output_dir')}</span
			>
			<span
				class="min-w-0 flex-1 truncate rounded border px-1.5 py-0.5 font-mono text-[11px]"
				style="border-color: var(--md-outline-variant); background: var(--md-surface-container-lowest); color: {outputDir
					? 'var(--md-on-surface)'
					: 'var(--md-on-surface-variant)'};"
			>
				{outputDir || '—'}
			</span>
			<button
				type="button"
				class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] transition hover:opacity-80"
				style="border-color: var(--md-outline-variant); color: var(--md-on-surface-variant);"
				onclick={pickOutputDir}
			>
				📁
			</button>
		</label>
		<label class="flex items-center gap-1">
			<span class="text-[11px] whitespace-nowrap" style="color: var(--md-on-surface-variant);"
				>{$t('export.filename')}</span
			>
			<input
				type="text"
				class="w-[120px] rounded border px-1 py-0.5 font-mono text-[11px] outline-none"
				style="border-color: var(--md-outline-variant); background: var(--md-surface-container-lowest); color: var(--md-on-surface);"
				bind:value={fileName}
				placeholder="users"
				disabled={running}
			/>
		</label>
		<label class="flex items-center gap-1">
			<span class="text-[11px] whitespace-nowrap" style="color: var(--md-on-surface-variant);"
				>{$t('export.format')}</span
			>
			<select
				class="cursor-pointer rounded border px-1 py-0.5 font-mono text-[11px] outline-none"
				style="border-color: var(--md-outline-variant); background: var(--md-surface-container-lowest); color: var(--md-on-surface);"
				bind:value={format}
				disabled={running}
			>
				{#each FORMATS as opt}<option value={opt.value}>{opt.label}</option>{/each}
			</select>
		</label>
		{#if format === 'SQL_INSERT'}
			<label class="flex items-center gap-1">
				<span class="text-[11px] whitespace-nowrap" style="color: var(--md-on-surface-variant);"
					>{$t('export.table_name')}</span
				>
				<input
					type="text"
					class="w-[120px] rounded border px-1 py-0.5 font-mono text-[11px] outline-none"
					style="border-color: var(--md-outline-variant); background: var(--md-surface-container-lowest); color: var(--md-on-surface);"
					bind:value={tableName}
					placeholder="users"
					disabled={running}
				/>
			</label>
		{/if}
	</div>
</header>

<!-- Row 2: SQL 编辑器 -->
<div class="shrink-0">
	<SqlEditor
		value={sql}
		onValueChange={(v) => (sql = v)}
		onCtrlEnter={doExport}
		placeholder={$t('export.sql_placeholder')}
		{getSuggestions}
	/>
</div>

<!-- Row 3: 预览区 + 日志区（点击切换，同一行） -->
<div class="flex flex-col overflow-hidden" style="flex: 1; min-height: 0;">
	<!-- Tab Bar -->
	<nav
		class="flex shrink-0 items-center gap-2 px-3 py-1.5"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<button
			type="button"
			class="export-tab"
			class:active={activeTab === 'preview'}
			onclick={() => (activeTab = 'preview')}
		>
			{$t('export.preview_title')}
			{#if previewRows.length > 0}<span class="ml-1 text-[10px]" style="color: var(--md-primary);"
					>({previewRows.length.toLocaleString()})</span
				>{/if}
		</button>
		<button
			type="button"
			class="export-tab"
			class:active={activeTab === 'log'}
			onclick={() => (activeTab = 'log')}
		>
			{#if running}
				<svg
					viewBox="0 0 24 24"
					width="12"
					height="12"
					class="animate-spin"
					aria-hidden="true"
					style="color: var(--md-primary);"
					><circle
						cx="12"
						cy="12"
						r="9"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-dasharray="40"
						stroke-dashoffset="20"
						><animateTransform
							attributeName="transform"
							type="rotate"
							from="0 12 12"
							to="360 12 12"
							dur="0.9s"
							repeatCount="indefinite"
						/></circle
					></svg
				>
			{/if}
			{$t('dg.log_title')}
			{#if exportedRows > 0}<span class="ml-1 text-[10px]" style="color: var(--md-primary);"
					>({exportedRows.toLocaleString()} {$t('export.rows')})</span
				>{/if}
		</button>
	</nav>

	<!-- Tab Content -->
	<div class="flex flex-col overflow-hidden" style="flex: 1; min-height: 0;">
		{#if activeTab === 'preview'}
			{#if previewRows.length === 0}
				<div class="flex flex-1 items-center justify-center">
					<p class="text-sm" style="color: var(--md-on-surface-variant);">
						{$t('export.preview_empty')}
					</p>
				</div>
			{:else}
				<div class="min-h-0 flex-1 overflow-auto" bind:this={vsScrollEl} onscroll={vsOnScroll}>
					<table
						class="min-w-full border-collapse text-left font-mono text-xs"
						style:table-layout={vsColsLocked ? 'fixed' : 'auto'}
					>
						<thead
							class="sticky top-0"
							style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
						>
							<tr
								>{#each previewColumns as col, ci}<th
										class="truncate px-3 py-1.5 font-medium whitespace-nowrap"
										style="border-bottom: 1px solid var(--md-outline-variant);"
										style:width={vsColsLocked ? `${vsColWidths[ci] ?? 120}px` : undefined}>{col}</th
									>{/each}</tr
							>
						</thead>
						{#if vsRange}
							<tbody>
								<tr class="vs-spacer" style:height="{vsRange.offsetY}px"
									><td colspan={previewColumns.length} class="border-none p-0"></td></tr
								>
								{#each vsVisRows as row, vi (vsRange.start + vi)}
									{@const ri = vsRange.start + vi}
									<tr
										style:background={ri % 2 === 0
											? 'transparent'
											: 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
									>
										{#each previewColumns as col, ci}<td
												class="truncate px-3 py-1"
												style="border-bottom: 1px solid var(--md-outline-variant);"
												style:width={vsColsLocked ? `${vsColWidths[ci] ?? 120}px` : undefined}
												>{row[col] ?? ''}</td
											>{/each}
									</tr>
								{/each}
								<tr class="vs-spacer" style:height="{vsRange.bottomPad}px"
									><td colspan={previewColumns.length} class="border-none p-0"></td></tr
								>
							</tbody>
						{:else}
							<tbody>
								{#each previewRows as row, i (i)}
									<tr
										style:background={i % 2 === 0
											? 'transparent'
											: 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
									>
										{#each previewColumns as col}<td
												class="max-w-[12rem] truncate px-3 py-1"
												style="border-bottom: 1px solid var(--md-outline-variant);"
												>{row[col] ?? ''}</td
											>{/each}
									</tr>
								{/each}
							</tbody>
						{/if}
					</table>
				</div>
				<p
					class="shrink-0 px-3 py-1.5 text-right text-[11px]"
					style="color: var(--md-on-surface-variant); border-top: 1px solid var(--md-outline-variant);"
				>
					{previewRows.length.toLocaleString()}
					{$t('export.rows')} · {previewColumns.length}
					{$t('export.columns')}
				</p>
			{/if}
		{/if}

		{#if activeTab === 'log'}
			<div
				bind:this={logEl}
				class="flex-1 overflow-auto font-mono text-[11px] leading-5"
				style="white-space: pre-wrap; word-break: break-all;"
			>
				{#if sqlLogs.length === 0 && !running}
					<div class="flex h-full items-center justify-center">
						<p class="text-sm" style="color: var(--md-on-surface-variant);">
							{$t('export.log_empty')}
						</p>
					</div>
				{:else}
					{#each sqlLogs as line, i (i)}
						<div class="log-line px-3" style="color: var(--md-on-surface);">{line}</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.export-tab {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		line-height: 1.2;
		background: transparent;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-radius-xs);
		cursor: pointer;
		white-space: nowrap;
		color: var(--md-on-surface-variant);
		transition: all 120ms ease;
	}
	.export-tab.active {
		background: var(--md-primary-container, color-mix(in srgb, var(--md-primary) 12%, transparent));
		color: var(--md-primary);
		border-color: var(--md-primary);
		font-weight: 500;
	}
	.export-tab:hover:not(.active) {
		background: var(
			--md-surface-container-high,
			color-mix(in srgb, var(--md-on-surface) 8%, transparent)
		);
		color: var(--md-on-surface);
	}
	.export-tab.active:hover {
		opacity: 0.9;
	}
	.log-line:hover {
		background: color-mix(in srgb, var(--md-primary) 6%, transparent);
	}
	.animate-spin {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
