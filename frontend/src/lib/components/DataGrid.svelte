<script>
	import {
		listData,
		listColumns,
		createRow,
		updateRow,
		deleteRow,
		executeSql,
		listDataStreaming
	} from '$lib/api';
	import { asDataPage, asColumnList, asSqlResult, isLob, renderCell } from '$lib/api/normalize.js';
	import { formatTemporal, temporalKind } from '$lib/temporal.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import { getWhereCompletionItems, getOrderByKeywords } from '$lib/sqlCompletion.js';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowEditor from './RowEditor.svelte';
	import MonacoInput from './MonacoInput.svelte';
	import MdButton from './MdButton.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 * @property {string} schemaName
	 * @property {string} tableName
	 * @property {number} [reloadKey]   - 父级 bump 一次值来强制重拉数据 + 元数据
	 */

	/** @type {Props} */
	let { schemaConn, schemaName, tableName, reloadKey = 0 } = $props();

	const PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500, 0];

	let page = $state(1);
	let pageSize = $state(20);
	let total = $state(/** @type {number | null} */ (null));
	let rows = $state(/** @type {Record<string, unknown>[]} */ ([]));
	let columns = $state(/** @type {string[]} */ ([]));
	let columnMeta = $state(/** @type {ColumnMeta[]} */ ([]));
	let pending = $state(false);
	let streaming = $state(false);
	let streamedRowCount = $state(0);

	// ── Virtual Scroll ──────────────────────────────────────────────
	const VIRTUAL_THRESHOLD = 500;
	const OVERSCAN = 10;
	const ESTIMATED_ROW_H = 28;

	let scrollEl = $state(/** @type {HTMLDivElement | null} */ (null));
	let virtualActive = $state(false);
	let scrollTop = $state(0);
	let viewportH = $state(0);
	let measuredRowH = $state(ESTIMATED_ROW_H);
	let colWidths = $state(/** @type {number[]} */ ([]));
	let colsMeasured = $state(false);
	let rafId = 0;

	/** @param {Event} e */
	function onScroll(e) {
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			scrollTop = /** @type {HTMLDivElement} */ (e.target).scrollTop;
		});
	}

	let vRange = $derived.by(() => {
		if (!virtualActive) return null;
		const n = rows.length;
		if (n === 0) return null;
		const rh = measuredRowH;
		const start = Math.max(0, Math.floor(scrollTop / rh) - OVERSCAN);
		const end = Math.min(n, Math.ceil((scrollTop + viewportH) / rh) + OVERSCAN);
		const visCount = end - start;
		return {
			start,
			end,
			offsetY: start * rh,
			bottomPad: (n - start - visCount) * rh
		};
	});

	let visRows = $derived(vRange ? rows.slice(vRange.start, vRange.end) : null);

	/** Measure <th> widths once, then lock to table-layout:fixed */
	function measureCols() {
		if (colsMeasured || !scrollEl) return;
		const ths = scrollEl.querySelectorAll('thead th');
		if (!ths.length) return;
		colWidths = [...ths].map((th) => Math.max(80, th.getBoundingClientRect().width));
		colsMeasured = true;
	}

	// ── Viewport size via ResizeObserver ────────────────────────────
	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			viewportH = entry.contentRect.height;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	// ── Column width measurement (only after streaming completes, columns stable) ─
	$effect(() => {
		if (!virtualActive || streaming || rows.length === 0 || colsMeasured) return;
		requestAnimationFrame(measureCols);
	});

	// ── Row height calibration ──────────────────────────────────────
	$effect(() => {
		if (!virtualActive || !scrollEl) return;
		requestAnimationFrame(() => {
			const row = scrollEl?.querySelector('tbody tr:not(.vs-spacer)');
			if (!row) return;
			const h = row.getBoundingClientRect().height;
			if (h > 0 && Math.abs(h - measuredRowH) > 1) {
				measuredRowH = Math.round(h);
			}
		});
	});

	let inserting = $state(false);
	let editing = $state(/** @type {Record<string, unknown> | null} */ (null));
	let confirmDelete = $state(/** @type {Record<string, unknown> | null} */ (null));
	let actionPending = $state(false);

	let whereClause = $state('');
	let orderByClause = $state('');

	let lobView = $state(
		/** @type {{ column: string; row: Record<string, unknown>; loading: boolean; value: unknown } | null} */ (
			null
		)
	);
	let cellCtx = $state(
		/** @type {{ x: number; y: number; row: Record<string, unknown>; col: string; value: unknown; selection: string } | null} */ (
			null
		)
	);
	let headerCtx = $state(/** @type {{ x: number; y: number; col: string } | null} */ (null));

	let pkColumns = $derived(columnMeta.filter((c) => c.isPrimaryKey).map((c) => c.name));
	let readOnly = $derived(isReadOnlySchema(schemaConn, schemaName));
	let totalPages = $derived(total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null);
	/** @type {Record<string, import('$lib/api').ColumnMeta>} */
	let metaByName = $derived.by(() => {
		const m = {};
		for (const c of columnMeta) m[c.name] = c;
		return m;
	});

	let confirmDeleteMsg = $derived(
		confirmDelete
			? `${get(t)('datagrid.delete_row_msg')}\n${JSON.stringify(buildRowWhere(confirmDelete), null, 2)}`
			: ''
	);

	/** @param {number} p @param {number} tp */
	function pageText(p, tp) {
		if (tp > 1) return get(t)('datagrid.page_of', { page: p, totalPages: tp });
		return get(t)('datagrid.page_single', { page: p });
	}

	let streamingText = $derived.by(() => {
		const count = streamedRowCount.toLocaleString();
		const totalStr = total !== null ? ` / ${total.toLocaleString()}` : '';
		return get(t)('datagrid.loading_streaming', { count, total: totalStr });
	});

	/**
	 * 渲染单元格——时间类按列声明精度整形，其他走默认。
	 * @param {string} col @param {unknown} v
	 */
	function renderCellWithType(col, v) {
		const meta = metaByName[col];
		if (meta && temporalKind(meta.type)) {
			const formatted = formatTemporal(v, meta);
			if (formatted !== null) return formatted;
		}
		return renderCell(v);
	}

	function openCellCtx(e, row, col, value) {
		e.preventDefault();
		// 右键时若已有选区（左键长按选中），把选中文本一并捕获，菜单优先把"复制"绑定到选区
		const sel = (typeof window !== 'undefined' ? window.getSelection()?.toString() : '') ?? '';
		cellCtx = { x: e.clientX, y: e.clientY, row, col, value, selection: sel };
	}

	function openHeaderCtx(e, col) {
		e.preventDefault();
		headerCtx = { x: e.clientX, y: e.clientY, col };
	}

	// 仅当 schemaConn / tableName / reloadKey 变化时才重置分页并重载；
	// gotoPage / changePageSize 只更新状态，直接调用 load / loadStreaming，不经过 effect。
	let _prevSig = $state('');
	$effect(() => {
		const sig = `${schemaConn.driver}|${schemaConn.host}|${schemaConn.port}|${schemaConn.database}|${schemaConn._schema || ''}|${tableName}|${reloadKey}`;
		if (sig !== _prevSig) {
			_prevSig = sig;
			page = 1;
			total = null;
			whereClause = '';
			orderByClause = '';
			void loadMeta();
			if (pageSize === 0) {
				void loadStreaming();
			} else {
				void load();
			}
		}
	});

	function stripLeadingKeyword(text, keyword) {
		const trimmed = text.trim();
		const re = new RegExp('^' + keyword.replace(/\s+/g, '\\s+') + '\\s+', 'i');
		return trimmed.replace(re, '').trim();
	}

	async function load() {
		pending = true;
		const opts = {};
		const w = stripLeadingKeyword(whereClause, 'WHERE');
		if (w) opts.where = w;
		const o = stripLeadingKeyword(orderByClause, 'ORDER BY');
		if (o) opts.orderBy = o;
		try {
			const resp = await listData(schemaConn, tableName, page, pageSize, opts);
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.load_failed'));
				rows = [];
				columns = [];
				total = null;
				return;
			}
			const normalized = asDataPage(resp.data);
			rows = normalized.rows;
			columns = normalized.columns;
			total = normalized.total;
		} finally {
			pending = false;
		}
	}

	async function loadMeta() {
		const resp = await listColumns(schemaConn, tableName);
		if (resp.success) columnMeta = asColumnList(resp.data);
	}

	async function loadStreaming() {
		if (streaming) return;
		streaming = true;
		streamedRowCount = 0;
		virtualActive = false;
		colsMeasured = false;
		colWidths = [];
		rows = [];
		columns = [];
		const accRows = [];
		const colSet = new Set();
		const opts = {};
		const w = stripLeadingKeyword(whereClause, 'WHERE');
		if (w) opts.where = w;
		const o = stripLeadingKeyword(orderByClause, 'ORDER BY');
		if (o) opts.orderBy = o;

		try {
			const resp = await listDataStreaming(
				schemaConn,
				tableName,
				(data) => {
					if (data && typeof data === 'object') {
						const d = /** @type {Record<string, unknown>} */ (data);
						if (d.total != null && typeof d.total === 'number') total = d.total;
						const rowArr = Array.isArray(d.rows) ? d.rows : [];
						for (const row of rowArr) {
							accRows.push(row);
							if (row && typeof row === 'object') {
								for (const k of Object.keys(row)) colSet.add(k);
							}
						}
						streamedRowCount = accRows.length;
						rows = [...accRows];
						columns = [...colSet];
						if (!virtualActive && accRows.length > VIRTUAL_THRESHOLD) {
							virtualActive = true;
						}
					}
				},
				opts
			);
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.stream_failed'));
			}
		} finally {
			streaming = false;
			streamedRowCount = 0;
		}
	}

	function gotoPage(p) {
		if (p < 1 || pending) return;
		if (totalPages !== null && p > totalPages) return;
		page = p;
		load();
	}

	/** @param {number} newSize */
	function changePageSize(newSize) {
		if (newSize === pageSize || pending) return;
		pageSize = newSize;
		page = 1;
		total = null;
		virtualActive = false;
		colsMeasured = false;
		colWidths = [];
		scrollTop = 0;
		if (newSize === 0) {
			loadStreaming();
		} else {
			// 先清空行数据，防止 Svelte 在 load() 返回前用全量 rows 走非虚拟渲染（卡死 UI）
			rows = [];
			columns = [];
			load();
		}
	}

	function buildRowWhere(row) {
		const where = /** @type {Record<string, unknown>} */ ({});
		const cols = pkColumns.length > 0 ? pkColumns : columns;
		for (const c of cols) where[c] = row[c];
		return where;
	}

	async function doInsert(values) {
		if (readOnly) {
			err(get(t)('datagrid.toast.mysql_readonly_write', { schema: schemaName }));
			inserting = false;
			return;
		}
		actionPending = true;
		try {
			const resp = await createRow(schemaConn, tableName, values);
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.insert_failed'));
				return;
			}
			ok(get(t)('datagrid.toast.inserted'));
			inserting = false;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function doUpdate(changes, where) {
		if (readOnly) {
			err(get(t)('datagrid.toast.mysql_readonly_update', { schema: schemaName }));
			editing = null;
			return;
		}
		actionPending = true;
		try {
			const resp = await updateRow(schemaConn, tableName, changes, where ?? {});
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.update_failed'));
				return;
			}
			ok(get(t)('datagrid.toast.updated'));
			editing = null;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function doDelete() {
		if (!confirmDelete) return;
		if (readOnly) {
			err(get(t)('datagrid.toast.mysql_readonly_delete', { schema: schemaName }));
			confirmDelete = null;
			return;
		}
		actionPending = true;
		try {
			const where = buildRowWhere(confirmDelete);
			const resp = await deleteRow(schemaConn, tableName, where);
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.delete_failed'));
				return;
			}
			ok(get(t)('datagrid.toast.deleted'));
			confirmDelete = null;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function openLob(row, column) {
		if (pkColumns.length === 0) {
			err(get(t)('datagrid.toast.no_pk'));
			return;
		}
		lobView = { column, row, loading: true, value: null };
		try {
			const where = pkColumns
				.map((c) => `${quoteIdent(c)} = ${quoteLiteral(row[c])}`)
				.join(' AND ');
			const sql = `SELECT ${quoteIdent(column)} FROM ${quoteIdent(tableName)} WHERE ${where} LIMIT 1`;
			const resp = await executeSql(schemaConn, sql);
			if (!resp.success) {
				err(resp.error ?? get(t)('datagrid.toast.query_failed'));
				lobView = null;
				return;
			}
			const result = asSqlResult(resp.data);
			const v = result.rows.length > 0 ? result.rows[0][column] : null;
			lobView = { column, row, loading: false, value: v };
		} catch (e) {
			err(e instanceof Error ? e.message : String(e));
			lobView = null;
		}
	}

	function quoteIdent(s) {
		const ch = schemaConn.driver === 'Mysql' ? '`' : '"';
		return ch + String(s).replaceAll(ch, ch + ch) + ch;
	}

	function quoteLiteral(v) {
		if (v === null || v === undefined) return 'NULL';
		if (typeof v === 'number' && Number.isFinite(v)) return String(v);
		return `'${String(v).replaceAll("'", "''")}'`;
	}

	async function copyCell(col, value) {
		try {
			await navigator.clipboard.writeText(String(value ?? ''));
			ok(get(t)('common.copied'));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('common.copy_failed'));
		}
	}

	async function copyText(text, label) {
		try {
			await navigator.clipboard.writeText(text);
			ok(label ?? get(t)('common.copied'));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('common.copy_failed'));
		}
	}

	/**
	 * 行序列化为 TSV：tab 分列、列内换行 / tab 转义为字面量；NULL 转空串。
	 * 这种格式粘进 Excel / 数据库客户端最自然。
	 * @param {Record<string, unknown>} row
	 */
	function rowToTsv(row) {
		return columns
			.map((c) => {
				const v = row[c];
				if (v === null || v === undefined) return '';
				return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
			})
			.join('\t');
	}

	/** WHERE 子句补全：列名 + 方言级条件关键字/函数 */
	function getWhereSuggestions() {
		const seen = new Set();
		const items = [];
		for (const c of columns) {
			if (seen.has(c)) continue; seen.add(c);
			items.push({ label: c, kind: 'column', detail: tableName });
		}
		const { keywords, functions } = getWhereCompletionItems(schemaConn.driver);
		for (const f of functions) {
			if (seen.has(f)) continue; seen.add(f);
			items.push({ label: f, kind: 'function' });
		}
		for (const k of keywords) {
			if (seen.has(k)) continue; seen.add(k);
			items.push({ label: k, kind: 'keyword' });
		}
		return items;
	}

	/** ORDER BY 子句补全：列名 + ASC/DESC */
	function getOrderBySuggestions() {
		const seen = new Set();
		const items = [];
		for (const c of columns) {
			if (seen.has(c)) continue; seen.add(c);
			items.push({ label: c, kind: 'column', detail: tableName });
		}
		const { keywords } = getOrderByKeywords();
		for (const k of keywords) {
			if (seen.has(k)) continue; seen.add(k);
			items.push({ label: k, kind: 'keyword' });
		}
		return items;
	}
</script>

<section class="flex h-full flex-col overflow-hidden">
	<header
		class="flex shrink-0 flex-col gap-1 px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-2">
			<h2 class="shrink-0 text-sm font-medium">
				<span style="color: var(--md-on-surface-variant);">{schemaName}</span>
				<span style="color: var(--md-on-surface-variant);"> · </span>
				<span class="font-mono" style="color: var(--md-on-surface);">{tableName}</span>
				{#if pending}
					<span class="ml-2 animate-pulse text-xs" style="color: var(--md-on-surface-variant);"
						>…</span
					>
				{/if}
			</h2>
			<div class="flex shrink-0 items-center gap-1.5 ml-auto">
				<MdButton
					variant="icon"
					title={$t('datagrid.refresh')}
					onclick={() => {
						if (pageSize === 0) loadStreaming();
						else load();
					}}
					disabled={pending || streaming}
				>
					↻
				</MdButton>
				{#if readOnly}
					<span class="md-chip" title={$t('datagrid.ro_tooltip')}>{$t('datagrid.ro_readonly')}</span>
				{:else}
					<MdButton
						variant="filled"
						size="sm"
						onclick={() => (inserting = true)}
						disabled={columns.length === 0 && columnMeta.length === 0}
					>
						{$t('datagrid.insert')}
					</MdButton>
				{/if}
			</div>
		</div>
		<div
			class="flex items-center gap-2 pt-1"
			style="border-top: 1px solid var(--md-outline-variant);"
		>
			<span class="shrink-0 text-xs font-mono" style="color: var(--md-on-surface-variant);">WHERE</span>
			<div class="min-w-0 flex-1" style="height: 20px;">
				<MonacoInput
					value={whereClause}
					onValueChange={(v) => (whereClause = v)}
					onEnter={() => {
						if (pageSize === 0) loadStreaming();
						else load();
					}}
					getSuggestions={getWhereSuggestions}
					placeholder={$t('datagrid.where_placeholder')}
				/>
			</div>
			<span class="shrink-0 text-xs font-mono" style="color: var(--md-on-surface-variant);">ORDER BY</span>
			<div class="shrink-0" style="width: 11rem; height: 20px;">
				<MonacoInput
					value={orderByClause}
					onValueChange={(v) => (orderByClause = v)}
					onEnter={() => {
						if (pageSize === 0) loadStreaming();
						else load();
					}}
					getSuggestions={getOrderBySuggestions}
					placeholder={$t('datagrid.orderby_placeholder')}
				/>
			</div>
		</div>
	</header>

	<div
		class="flex-1 overflow-auto pb-3"
		bind:this={scrollEl}
		onscroll={onScroll}
		bind:clientHeight={viewportH}
	>
		{#if rows.length === 0 && !pending}
			<p class="py-8 text-center text-sm" style="color: var(--md-on-surface-variant);">
				{$t('datagrid.empty')}
			</p>
		{:else if columns.length > 0}
			<table
				class="min-w-full text-left text-xs"
				style:table-layout={colsMeasured ? 'fixed' : 'auto'}
			>
				<thead
					class="sticky top-0 z-10"
					style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
				>
					<tr>
						{#each columns as col, ci (col)}
							<th
								class="px-3 py-2 font-mono font-medium truncate"
								style="border-bottom: 1px solid var(--md-outline-variant);"
								style:width={colsMeasured ? `${colWidths[ci] ?? 120}px` : undefined}
								oncontextmenu={(e) => openHeaderCtx(e, col)}
							>
								{col}
								{#if pkColumns.includes(col)}
									<span class="ml-1 md-chip-pk">{$t('common.pk')}</span>
								{/if}
							</th>
						{/each}
						{#if !readOnly}
							<th
								class="sticky right-0 px-3 py-2 font-medium"
								style="background: var(--md-surface-container); border-bottom: 1px solid var(--md-outline-variant); z-index: 2;"
							>
								{$t('datagrid.action_col')}
							</th>
						{/if}
					</tr>
				</thead>
				{#if vRange}
					<!-- 虚拟滚动：spacer 撑开上方不可见区域，把可见行推到正确位置 -->
					<tbody>
						<!-- 上方 spacer：滚动位置之前的行 -->
						<tr class="vs-spacer" style:height="{vRange.offsetY}px">
							<td
								colspan={columns.length + (readOnly ? 0 : 1)}
								style="padding: 0; border: none;"
							></td>
						</tr>
						<!-- 可见行 -->
						{#each visRows as row, vi (vRange.start + vi)}
							{@const i = vRange.start + vi}
							<tr
								class="row-hover"
								style:background={i % 2 === 0
									? 'transparent'
									: 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							>
								{#each columns as col, ci (col)}
									<td
										class="truncate px-3 py-1.5 font-mono"
										style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
										style:width={colsMeasured ? `${colWidths[ci] ?? 120}px` : undefined}
										oncontextmenu={(e) => openCellCtx(e, row, col, row[col])}
									>
										{#if isLob(row[col])}
											<button
												class="italic underline decoration-dotted"
												style="color: var(--md-primary);"
												onclick={() => openLob(row, col)}
												title={$t('datagrid.lob_tooltip')}
											>
												{row[col]}
											</button>
										{:else}
											{renderCellWithType(col, row[col])}
										{/if}
									</td>
								{/each}
								{#if !readOnly}
									<td
										class="sticky right-0 px-3 py-1.5"
										style:background={i % 2 === 0
											? 'var(--md-surface)'
											: 'var(--md-surface-container-low)'}
										style="border-bottom: 1px solid var(--md-outline-variant);"
									>
										<div class="flex gap-2 text-xs">
											<MdButton
												variant="text"
												size="sm"
												onclick={() => (editing = row)}
											>
												{$t('common.edit')}
											</MdButton>
											<MdButton
												variant="text"
												size="sm"
												class="!text-[var(--md-error)]"
												onclick={() => (confirmDelete = row)}
											>
												{$t('common.delete')}
											</MdButton>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
						<!-- 下方 spacer：保证表格总高度恒定，滚动条大小不变 -->
						<tr class="vs-spacer" style:height="{vRange.bottomPad}px">
							<td
								colspan={columns.length + (readOnly ? 0 : 1)}
								style="padding: 0; border: none;"
							></td>
						</tr>
					</tbody>
				{:else}
					<!-- 普通渲染：分页模式 / 小数据集 -->
					<tbody>
						{#each rows as row, i (i)}
							<tr
								class="row-hover"
								style:background={i % 2 === 0
									? 'transparent'
									: 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							>
								{#each columns as col (col)}
									<td
										class="max-w-[24rem] truncate px-3 py-1.5 font-mono"
										style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
										oncontextmenu={(e) => openCellCtx(e, row, col, row[col])}
									>
										{#if isLob(row[col])}
											<button
												class="italic underline decoration-dotted"
												style="color: var(--md-primary);"
												onclick={() => openLob(row, col)}
												title={$t('datagrid.lob_tooltip')}
											>
												{row[col]}
											</button>
										{:else}
											{renderCellWithType(col, row[col])}
										{/if}
									</td>
								{/each}
								{#if !readOnly}
									<td
										class="sticky right-0 px-3 py-1.5"
										style:background={i % 2 === 0
											? 'var(--md-surface)'
											: 'var(--md-surface-container-low)'}
										style="border-bottom: 1px solid var(--md-outline-variant);"
									>
										<div class="flex gap-2 text-xs">
											<MdButton
												variant="text"
												size="sm"
												onclick={() => (editing = row)}
											>
												{$t('common.edit')}
											</MdButton>
											<MdButton
												variant="text"
												size="sm"
												class="!text-[var(--md-error)]"
												onclick={() => (confirmDelete = row)}
											>
												{$t('common.delete')}
											</MdButton>
										</div>
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				{/if}
			</table>
		{/if}
	</div>
	<footer
		class="flex shrink-0 items-center justify-between px-3 py-1.5"
		style="background: var(--md-surface-container-low); border-top: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-1.5">
			{#if pageSize > 0}
				<MdButton
					variant="icon"
					title={$t('datagrid.prev_page')}
					onclick={() => gotoPage(page - 1)}
					disabled={pending || page <= 1}
				>
					◀
				</MdButton>
				{#if totalPages !== null && totalPages > 1}
					<select
						class="text-xs"
						style="padding: 0.125rem 0.25rem; border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-sm); background: var(--md-surface-container-high); color: var(--md-on-surface); cursor: pointer;"
						value={page}
						onchange={(e) => gotoPage(Number(e.currentTarget.value))}
					>
						{#each { length: totalPages } as _, i}
							<option value={i + 1}>{pageText(i + 1, totalPages)}</option>
						{/each}
					</select>
				{:else}
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						{pageText(page, totalPages ?? 1)}
					</span>
				{/if}
				<MdButton
					variant="icon"
					title={$t('datagrid.next_page')}
					onclick={() => gotoPage(page + 1)}
					disabled={pending || (totalPages !== null ? page >= totalPages : rows.length < pageSize)}
				>
					▶
				</MdButton>
			{/if}
		</div>
		<div class="flex items-center gap-1.5">
			<select
				class="md-input text-xs"
				style="padding: 0.125rem 0.5rem; min-width: 0;"
				value={pageSize}
				onchange={(e) => changePageSize(Number(e.currentTarget.value))}
			>
				{#each PAGE_SIZE_OPTIONS as opt (opt)}
					<option value={opt}>{opt === 0 ? $t('datagrid.all_rows') : $t('datagrid.rows_per_page', { opt })}</option>
				{/each}
			</select>
			{#if pageSize > 0 && total !== null}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">
					{$t('datagrid.total', { total: total.toLocaleString() })}
				</span>
			{:else if pageSize === 0 && streaming}
				<span class="animate-pulse text-xs" style="color: var(--md-primary);">
					{streamingText}
				</span>
			{:else if pageSize === 0 && total !== null}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">
					{$t('datagrid.total', { total: total.toLocaleString() })}
				</span>
			{/if}
		</div>
	</footer>
</section>

<RowEditor
	open={inserting}
	title={$t('datagrid.insert_title', { table: tableName })}
	columns={columnMeta.length > 0 ? columnMeta.map((c) => c.name) : columns}
	{columnMeta}
	initial={{}}
	pending={actionPending}
	onSubmit={doInsert}
	onCancel={() => (inserting = false)}
/>

<RowEditor
	open={editing !== null}
	title={$t('datagrid.edit_title', { table: tableName })}
	columns={columnMeta.length > 0 ? columnMeta.map((c) => c.name) : columns}
	{columnMeta}
	initial={editing ?? {}}
	editing
	{pkColumns}
	pending={actionPending}
	onSubmit={(changes, where) => doUpdate(changes, where)}
	onCancel={() => (editing = null)}
/>

<ConfirmDialog
	open={confirmDelete !== null}
	title={$t('datagrid.delete_row_title')}
	message={confirmDeleteMsg}
	confirmText={$t('common.delete')}
	danger
	pending={actionPending}
	onConfirm={doDelete}
	onCancel={() => (confirmDelete = null)}
/>

<Modal
	open={lobView !== null}
	title={`${tableName}.${lobView?.column ?? ''}`}
	size="lg"
	onClose={() => (lobView = null)}
>
	{#if lobView?.loading}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">{$t('datagrid.loading')}</p>
	{:else if lobView?.value === null || lobView?.value === undefined}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">NULL</p>
	{:else}
		<pre
			class="max-h-[60vh] overflow-auto p-3 font-mono text-xs whitespace-pre-wrap"
			style="background: var(--md-surface-container-lowest); color: var(--md-on-surface); border-radius: var(--md-radius-sm); border: 1px solid var(--md-outline-variant);">{String(
				lobView?.value
			)}</pre>
	{/if}
</Modal>

<ContextMenu
	open={cellCtx
		? {
				x: cellCtx.x,
				y: cellCtx.y,
				items: [
					cellCtx?.selection
						? {
								label: $t('datagrid.ctx.copy_selected'),
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyText(cellCtx.selection);
								}
							}
						: {
								label: $t('datagrid.ctx.copy'),
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyCell(cellCtx.col, cellCtx.value);
								}
							},
					{
						label: $t('datagrid.ctx.copy_row'),
						icon: '⊟',
						onClick: () => {
							if (cellCtx) copyText(rowToTsv(cellCtx.row), $t('datagrid.toast.row_copied'));
						}
					},
					{
						label: $t('datagrid.ctx.copy_column'),
						icon: '⧉',
						onClick: () => {
							if (cellCtx) copyCell(cellCtx.col, cellCtx.col);
						}
					},
					cellCtx?.value !== null && cellCtx?.value !== undefined && isLob(cellCtx.value)
						? {
								label: $t('datagrid.ctx.view_lob'),
								icon: '⊕',
								onClick: () => {
									if (cellCtx) openLob(cellCtx.row, cellCtx.col);
								}
							}
						: null,
					!readOnly
						? {
								label: $t('datagrid.ctx.edit_row'),
								icon: '✎',
								onClick: () => {
									if (cellCtx) editing = cellCtx.row;
								}
							}
						: null,
					!readOnly
						? {
								label: $t('datagrid.ctx.delete_row'),
								icon: '✕',
								danger: true,
								onClick: () => {
									if (cellCtx) confirmDelete = cellCtx.row;
								}
							}
						: null
				].filter((i) => i !== null)
			}
		: null}
	onClose={() => (cellCtx = null)}
/>

<ContextMenu
	open={headerCtx
		? {
				x: headerCtx.x,
				y: headerCtx.y,
				items: [
					{
						label: $t('datagrid.ctx.copy_column'),
						icon: '⧉',
						onClick: () => {
							if (headerCtx) copyCell(headerCtx.col, headerCtx.col);
						}
					}
				]
			}
		: null}
	onClose={() => (headerCtx = null)}
/>

<style>
	tr.row-hover:hover {
		background: color-mix(in srgb, var(--md-on-surface) 6%, transparent) !important;
	}
</style>
