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
	import { isReadOnlySchema } from '$lib/readonly.js';
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
	let readOnly = $derived(isReadOnlySchema(schemaConn, schemaName));

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
		const ch = schemaConn.driver === 'Mysql' ? '`' : '"';
		return ch + String(s).replaceAll(ch, ch + ch) + ch;
	}

	function quoteLiteral(v) {
		if (v === null || v === undefined) return 'NULL';
		if (typeof v === 'number' && Number.isFinite(v)) return String(v);
		return `'${String(v).replaceAll("'", "''")}'`;
	}
</script>

<section class="flex h-full flex-col gap-3">
	<header
		class="flex items-center justify-between px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="text-sm font-medium">
			<span style="color: var(--md-on-surface-variant);">{schemaName}</span>
			<span style="color: var(--md-on-surface-variant);"> · </span>
			<span class="font-mono" style="color: var(--md-on-surface);">{tableName}</span>
			{#if pending}
				<span class="ml-2 animate-pulse text-xs" style="color: var(--md-on-surface-variant);">…</span>
			{/if}
		</h2>
		<div class="flex items-center gap-1.5">
			<button
				class="md-btn-text"
				onclick={() => gotoPage(page - 1)}
				disabled={pending || page <= 1}
			>
				← 上一页
			</button>
			<span class="text-xs" style="color: var(--md-on-surface-variant);">
				第 {page} 页 · {PAGE_SIZE} 行
			</span>
			<button
				class="md-btn-text"
				onclick={() => gotoPage(page + 1)}
				disabled={pending || rows.length < PAGE_SIZE}
			>
				下一页 →
			</button>
			<button class="md-icon-btn" title="刷新" onclick={() => load()} disabled={pending}>
				↻
			</button>
			{#if readOnly}
				<span class="md-chip" title="MySQL 系统库，只读">RO · 只读</span>
			{:else}
				<button
					class="md-btn-filled"
					onclick={() => (inserting = true)}
					disabled={columns.length === 0 && columnMeta.length === 0}
				>
					+ 插入
				</button>
			{/if}
		</div>
	</header>

	<div class="flex-1 overflow-auto px-3 pb-3">
		{#if rows.length === 0 && !pending}
			<p class="py-8 text-center text-sm" style="color: var(--md-on-surface-variant);">
				空表 / 当前页无数据
			</p>
		{:else if columns.length > 0}
			<div
				class="overflow-auto"
				style="border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-md);"
			>
				<table class="min-w-full text-left text-xs">
					<thead
						class="sticky top-0"
						style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
					>
						<tr>
							{#each columns as col (col)}
								<th
									class="px-3 py-2 font-medium whitespace-nowrap font-mono"
									style="border-bottom: 1px solid var(--md-outline-variant);"
								>
									{col}
									{#if pkColumns.includes(col)}
										<span class="md-chip-pk ml-1">PK</span>
									{/if}
								</th>
							{/each}
							{#if !readOnly}
								<th
									class="sticky right-0 px-3 py-2 font-medium"
									style="background: var(--md-surface-container); border-bottom: 1px solid var(--md-outline-variant);"
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
								style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							>
								{#each columns as col (col)}
									<td
										class="max-w-[24rem] truncate px-3 py-1.5 font-mono"
										style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
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
											{renderCell(row[col])}
										{/if}
									</td>
								{/each}
								{#if !readOnly}
									<td
										class="sticky right-0 px-3 py-1.5"
										style:background={i % 2 === 0 ? 'var(--md-surface)' : 'var(--md-surface-container-low)'}
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
			</div>
		{/if}
	</div>
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
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">读取中…</p>
	{:else if lobView?.value === null || lobView?.value === undefined}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">NULL</p>
	{:else}
		<pre
			class="max-h-[60vh] overflow-auto p-3 font-mono text-xs whitespace-pre-wrap"
			style="background: var(--md-surface-container-lowest); color: var(--md-on-surface); border-radius: var(--md-radius-sm); border: 1px solid var(--md-outline-variant);"
		>{String(lobView?.value)}</pre>
	{/if}
</Modal>

<style>
	tr.row-hover:hover {
		background: color-mix(in srgb, var(--md-on-surface) 6%, transparent) !important;
	}
</style>
