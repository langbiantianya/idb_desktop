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
	import { isReadOnlySchema } from '$lib/readonly.js';
	import { getWhereCompletionItems, getOrderByKeywords } from '$lib/sqlCompletion.js';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowEditor from './RowEditor.svelte';
	import MonacoInput from './MonacoInput.svelte';

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

	/**
	 * 渲染单元格——时间类按列声明精度整形，其他走默认。
	 * @param {string} col @param {unknown} v
	 */
	function renderCellWithType(col, v) {
		const meta = metaByName[col];
		if (meta && temporalKind(meta.type)) {
			const t = formatTemporal(v, meta);
			if (t !== null) return t;
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
		const sig = `${schemaConn.driver}|${schemaConn.host}|${schemaConn.port}|${schemaConn.database}|${tableName}|${reloadKey}`;
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
				err(resp.error ?? '加载失败');
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
						// 每 100 行刷新一次 UI
						if (accRows.length % 100 === 0) {
							rows = [...accRows];
							columns = [...colSet];
						}
					}
				},
				opts
			);
			if (!resp.success) {
				err(resp.error ?? '流式加载失败');
			}
			// 最终刷新
			rows = accRows;
			columns = [...colSet];
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
		if (newSize === 0) {
			loadStreaming();
		} else {
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
			err(`${schemaName} 是 MySQL 系统库，禁止写入`);
			inserting = false;
			return;
		}
		actionPending = true;
		try {
			const resp = await createRow(schemaConn, tableName, values);
			if (!resp.success) {
				err(resp.error ?? '插入失败');
				return;
			}
			ok('已插入 1 行');
			inserting = false;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function doUpdate(changes, where) {
		if (readOnly) {
			err(`${schemaName} 是 MySQL 系统库，禁止更新`);
			editing = null;
			return;
		}
		actionPending = true;
		try {
			const resp = await updateRow(schemaConn, tableName, changes, where ?? {});
			if (!resp.success) {
				err(resp.error ?? '更新失败');
				return;
			}
			ok('已更新');
			editing = null;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function doDelete() {
		if (!confirmDelete) return;
		if (readOnly) {
			err(`${schemaName} 是 MySQL 系统库，禁止删除`);
			confirmDelete = null;
			return;
		}
		actionPending = true;
		try {
			const where = buildRowWhere(confirmDelete);
			const resp = await deleteRow(schemaConn, tableName, where);
			if (!resp.success) {
				err(resp.error ?? '删除失败');
				return;
			}
			ok('已删除');
			confirmDelete = null;
			await load();
		} finally {
			actionPending = false;
		}
	}

	async function openLob(row, column) {
		if (pkColumns.length === 0) {
			err('该表无主键，无法做单行精准查询');
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
				err(resp.error ?? '查询失败');
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
			ok('已复制');
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
		}
	}

	async function copyText(text, label = '已复制') {
		try {
			await navigator.clipboard.writeText(text);
			ok(label);
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
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
				<button
					class="md-icon-btn"
					title="刷新"
					onclick={() => {
						if (pageSize === 0) loadStreaming();
						else load();
					}}
					disabled={pending || streaming}
				>
					↻
				</button>
				{#if readOnly}
					<span class="md-chip" title="MySQL 系统库，只读">RO · 只读</span>
				{:else}
					<button
						class="md-btn-filled"
						style="padding: 0.125rem 0.5rem; font-size: 0.75rem;"
						onclick={() => (inserting = true)}
						disabled={columns.length === 0 && columnMeta.length === 0}
					>
						+ 插入
					</button>
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
					placeholder="WHERE（如 status = 'active'）"
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
					placeholder="ORDER BY（如 created_at DESC）"
				/>
			</div>
		</div>
	</header>

	<div class="flex-1 overflow-auto pb-3">
		{#if rows.length === 0 && !pending}
			<p class="py-8 text-center text-sm" style="color: var(--md-on-surface-variant);">
				空表 / 当前页无数据
			</p>
		{:else if columns.length > 0}
			<table class="min-w-full text-left text-xs">
				<thead
					class="sticky top-0 z-10"
					style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
				>
					<tr>
						{#each columns as col (col)}
							<th
								class="px-3 py-2 font-mono font-medium whitespace-nowrap"
								style="border-bottom: 1px solid var(--md-outline-variant);"
								oncontextmenu={(e) => openHeaderCtx(e, col)}
							>
								{col}
								{#if pkColumns.includes(col)}
									<span class="ml-1 md-chip-pk">PK</span>
								{/if}
							</th>
						{/each}
						{#if !readOnly}
							<th
								class="sticky right-0 px-3 py-2 font-medium"
								style="background: var(--md-surface-container); border-bottom: 1px solid var(--md-outline-variant); z-index: 2;"
							>
								操作
							</th>
						{/if}
					</tr>
				</thead>
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
											title="点击查看完整内容"
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
										<button
											class="md-btn-text"
											style="padding: 0.125rem 0.5rem;"
											onclick={() => (editing = row)}
										>
											编辑
										</button>
										<button
											class="md-btn-text"
											style="padding: 0.125rem 0.5rem; color: var(--md-error);"
											onclick={() => (confirmDelete = row)}
										>
											删除
										</button>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
	<footer
		class="flex shrink-0 items-center justify-between px-3 py-1.5"
		style="background: var(--md-surface-container-low); border-top: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-1.5">
			{#if pageSize > 0}
				<button
					class="md-icon-btn"
					title="上一页"
					onclick={() => gotoPage(page - 1)}
					disabled={pending || page <= 1}
				>
					◀
				</button>
				{#if totalPages !== null && totalPages > 1}
					<select
						class="text-xs"
						style="padding: 0.125rem 0.25rem; border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-sm); background: var(--md-surface-container-high); color: var(--md-on-surface); cursor: pointer;"
						value={page}
						onchange={(e) => gotoPage(Number(e.currentTarget.value))}
					>
						{#each { length: totalPages } as _, i}
							<option value={i + 1}>第 {i + 1} / {totalPages} 页</option>
						{/each}
					</select>
				{:else}
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						第 {page} 页
					</span>
				{/if}
				<button
					class="md-icon-btn"
					title="下一页"
					onclick={() => gotoPage(page + 1)}
					disabled={pending || (totalPages !== null ? page >= totalPages : rows.length < pageSize)}
				>
					▶
				</button>
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
					<option value={opt}>{opt === 0 ? '全量' : `${opt} 条/页`}</option>
				{/each}
			</select>
			{#if pageSize > 0 && total !== null}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">
					共 {total.toLocaleString()} 条
				</span>
			{:else if pageSize === 0 && streaming}
				<span class="animate-pulse text-xs" style="color: var(--md-primary);">
					加载中 {streamedRowCount.toLocaleString()} 行{total !== null
						? ` / ${total.toLocaleString()}`
						: ''}…
				</span>
			{:else if pageSize === 0 && total !== null}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">
					共 {total.toLocaleString()} 条
				</span>
			{/if}
		</div>
	</footer>
</section>

<RowEditor
	open={inserting}
	title={`插入 · ${tableName}`}
	columns={columnMeta.length > 0 ? columnMeta.map((c) => c.name) : columns}
	{columnMeta}
	initial={{}}
	pending={actionPending}
	onSubmit={doInsert}
	onCancel={() => (inserting = false)}
/>

<RowEditor
	open={editing !== null}
	title={`编辑 · ${tableName}`}
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
	title="删除该行"
	message={confirmDelete
		? `根据 ${pkColumns.length > 0 ? '主键' : '所有列'}匹配删除：\n${JSON.stringify(buildRowWhere(confirmDelete), null, 2)}`
		: ''}
	confirmText="删除"
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
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">读取中…</p>
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
								label: '复制选中文本',
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyText(cellCtx.selection);
								}
							}
						: {
								label: '复制',
								icon: '⧉',
								onClick: () => {
									if (cellCtx) copyCell(cellCtx.col, cellCtx.value);
								}
							},
					{
						label: '复制此行',
						icon: '⊟',
						onClick: () => {
							if (cellCtx) copyText(rowToTsv(cellCtx.row), '已复制此行');
						}
					},
					{
						label: '复制列名',
						icon: '⧉',
						onClick: () => {
							if (cellCtx) copyCell(cellCtx.col, cellCtx.col);
						}
					},
					cellCtx?.value !== null && cellCtx?.value !== undefined && isLob(cellCtx.value)
						? {
								label: '查看完整内容',
								icon: '⊕',
								onClick: () => {
									if (cellCtx) openLob(cellCtx.row, cellCtx.col);
								}
							}
						: null,
					!readOnly
						? {
								label: '编辑此行',
								icon: '✎',
								onClick: () => {
									if (cellCtx) editing = cellCtx.row;
								}
							}
						: null,
					!readOnly
						? {
								label: '删除此行',
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
						label: '复制列名',
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
