<script>
	import {
		listData,
		listColumns,
		createRow,
		updateRow,
		deleteRow,
		executeSql
	} from '$lib/api';
	import { asDataPage, asColumnList, asSqlResult, isLob, renderCell } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import RowEditor from './RowEditor.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 * @property {string} schemaName
	 * @property {string} tableName
	 */

	/** @type {Props} */
	let { schemaConn, schemaName, tableName } = $props();

	const PAGE_SIZE = 100;

	let page = $state(1);
	let rows = $state(/** @type {Record<string, unknown>[]} */ ([]));
	let columns = $state(/** @type {string[]} */ ([]));
	let columnMeta = $state(/** @type {ColumnMeta[]} */ ([]));
	let pending = $state(false);

	let inserting = $state(false);
	let editing = $state(/** @type {Record<string, unknown> | null} */ (null));
	let confirmDelete = $state(/** @type {Record<string, unknown> | null} */ (null));
	let actionPending = $state(false);

	let lobView = $state(/** @type {{ column: string; row: Record<string, unknown>; loading: boolean; value: unknown } | null} */ (null));

	let pkColumns = $derived(columnMeta.filter((c) => c.isPrimaryKey).map((c) => c.name));

	$effect(() => {
		schemaConn;
		tableName;
		page = 1;
		void load();
		void loadMeta();
	});

	async function load() {
		pending = true;
		try {
			const resp = await listData(schemaConn, tableName, page, PAGE_SIZE);
			if (!resp.success) {
				err(resp.error ?? '加载失败');
				rows = [];
				columns = [];
				return;
			}
			const normalized = asDataPage(resp.data);
			rows = normalized.rows;
			columns = normalized.columns;
		} finally {
			pending = false;
		}
	}

	async function loadMeta() {
		const resp = await listColumns(schemaConn, tableName);
		if (resp.success) columnMeta = asColumnList(resp.data);
	}

	function gotoPage(p) {
		if (p < 1 || pending) return;
		page = p;
		load();
	}

	function buildRowWhere(row) {
		const where = /** @type {Record<string, unknown>} */ ({});
		const cols = pkColumns.length > 0 ? pkColumns : columns;
		for (const c of cols) where[c] = row[c];
		return where;
	}

	async function doInsert(values) {
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

	/**
	 * LOB 单行精准查询：按 where 条件再走一次原生 SQL，仅取该列。
	 * 因 DATA/LIST 走了引擎层的 LOB 截断，这里用 SQL 路径取真实值。
	 */
	async function openLob(row, column) {
		if (pkColumns.length === 0) {
			err('该表无主键，无法做单行精准查询');
			return;
		}
		lobView = { column, row, loading: true, value: null };
		try {
			const where = pkColumns.map((c) => `${quoteIdent(c)} = ${quoteLiteral(row[c])}`).join(' AND ');
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
		// MySQL/Postgres 通用：双引号在 MySQL ANSI_QUOTES 下也成立；为兼容默认 MySQL 配置，按驱动走反引号
		const ch = schemaConn.driver === 'mysql' ? '`' : '"';
		return ch + String(s).replaceAll(ch, ch + ch) + ch;
	}

	function quoteLiteral(v) {
		if (v === null || v === undefined) return 'NULL';
		if (typeof v === 'number' && Number.isFinite(v)) return String(v);
		return `'${String(v).replaceAll("'", "''")}'`;
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between text-sm">
		<h2 class="font-medium">
			<span class="text-slate-500">{schemaName}</span> ·
			<span class="text-slate-900">{tableName}</span>
			{#if pending}<span class="ml-2 animate-pulse text-xs text-slate-400">…</span>{/if}
		</h2>
		<div class="flex items-center gap-2">
			<button
				class="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
				onclick={() => gotoPage(page - 1)}
				disabled={pending || page <= 1}
			>
				上一页
			</button>
			<span class="text-xs text-slate-500">第 {page} 页 · {PAGE_SIZE} 行/页</span>
			<button
				class="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
				onclick={() => gotoPage(page + 1)}
				disabled={pending || rows.length < PAGE_SIZE}
			>
				下一页
			</button>
			<button
				class="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
				onclick={() => load()}
				disabled={pending}
			>
				刷新
			</button>
			<button
				class="rounded-md bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700"
				onclick={() => (inserting = true)}
				disabled={columns.length === 0 && columnMeta.length === 0}
			>
				插入
			</button>
		</div>
	</header>

	{#if rows.length === 0 && !pending}
		<p class="py-8 text-center text-sm text-slate-400">空表 / 当前页无数据</p>
	{:else if columns.length > 0}
		<div class="max-h-[60vh] overflow-auto rounded-md border border-slate-200">
			<table class="min-w-full text-left text-xs">
				<thead class="sticky top-0 bg-slate-100 text-slate-600">
					<tr>
						{#each columns as col (col)}
							<th class="border-b border-slate-200 px-3 py-2 font-medium whitespace-nowrap">
								{col}
								{#if pkColumns.includes(col)}
									<span class="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
										PK
									</span>
								{/if}
							</th>
						{/each}
						<th class="sticky right-0 border-b border-slate-200 bg-slate-100 px-3 py-2 font-medium">
							操作
						</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, i (i)}
						<tr class="even:bg-slate-50">
							{#each columns as col (col)}
								<td class="max-w-[24rem] truncate border-b border-slate-100 px-3 py-1.5">
									{#if isLob(row[col])}
										<button
											class="text-slate-500 italic underline decoration-dotted hover:text-slate-900"
											onclick={() => openLob(row, col)}
											title="点击查看完整内容"
										>
											{row[col]}
										</button>
									{:else}
										{renderCell(row[col])}
									{/if}
								</td>
							{/each}
							<td class="sticky right-0 border-b border-slate-100 bg-white px-3 py-1.5 even:bg-slate-50">
								<div class="flex gap-2 text-xs">
									<button class="text-slate-500 hover:text-slate-900" onclick={() => (editing = row)}>
										编辑
									</button>
									<button
										class="text-slate-400 hover:text-rose-600"
										onclick={() => (confirmDelete = row)}
									>
										删除
									</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<RowEditor
	open={inserting}
	title={`插入 · ${tableName}`}
	columns={columnMeta.length > 0 ? columnMeta.map((c) => c.name) : columns}
	initial={{}}
	pending={actionPending}
	onSubmit={doInsert}
	onCancel={() => (inserting = false)}
/>

<RowEditor
	open={editing !== null}
	title={`编辑 · ${tableName}`}
	columns={columnMeta.length > 0 ? columnMeta.map((c) => c.name) : columns}
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
		<p class="py-6 text-center text-sm text-slate-400">读取中…</p>
	{:else if lobView?.value === null || lobView?.value === undefined}
		<p class="py-6 text-center text-sm text-slate-400">NULL</p>
	{:else}
		<pre class="max-h-[60vh] overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs whitespace-pre-wrap">{String(lobView?.value)}</pre>
	{/if}
</Modal>
