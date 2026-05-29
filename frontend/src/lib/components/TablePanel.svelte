<script>
	import { listColumns, addTableColumn, modifyTableColumn, dropTableColumn } from '$lib/api';
	import { asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ContextMenu from './ContextMenu.svelte';

	/**
	 * 表结构面板：查看 + 增 / 删 / 改列。
	 *
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {import('$lib/api').ColumnDef} ColumnDef
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {ConnectionConfig | null} schemaConn
	 * @property {string} tableName
	 * @property {() => void} onClose
	 */

	/** @type {Props} */
	let { open, schemaConn, tableName, onClose } = $props();

	const TYPE_PRESETS = [
		'INT', 'BIGINT', 'SMALLINT',
		'VARCHAR', 'TEXT', 'CHAR',
		'DECIMAL', 'FLOAT', 'DOUBLE',
		'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
		'BOOLEAN', 'JSON', 'BLOB'
	];

	let columns = $state(/** @type {ColumnMeta[]} */ ([]));
	let pending = $state(false);

	let adding = $state(false);
	/** @type {ColumnDef} */
	let addDraft = $state({ name: '', type: 'VARCHAR', size: 255, nullable: true });
	let addPending = $state(false);

	let editing = $state(/** @type {ColumnMeta | null} */ (null));
	/** @type {ColumnDef} */
	let editDraft = $state({ name: '', type: '' });
	let editPending = $state(false);

	let confirmDrop = $state(/** @type {string | null} */ (null));
	let dropPending = $state(false);

	let rowCtx = $state(/** @type {{ x: number; y: number; col: ColumnMeta } | null} */ (null));

	function openRowCtx(e, col) {
		e.preventDefault();
		rowCtx = { x: e.clientX, y: e.clientY, col };
	}

	async function copyText2(text) {
		try {
			await navigator.clipboard.writeText(text);
			ok('已复制');
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
		}
	}

	let readOnly = $derived(isReadOnlySchema(schemaConn, schemaConn?.database));

	$effect(() => {
		if (!open || !schemaConn || !tableName) return;
		void load();
	});

	async function load() {
		if (!schemaConn) return;
		pending = true;
		columns = [];
		try {
			const resp = await listColumns(schemaConn, tableName);
			if (!resp.success) {
				err(resp.error ?? '加载列失败');
				return;
			}
			columns = asColumnList(resp.data);
		} finally {
			pending = false;
		}
	}

	function openAdd() {
		addDraft = { name: '', type: 'VARCHAR', size: 255, nullable: true };
		adding = true;
	}

	async function submitAdd() {
		if (!schemaConn) return;
		if (readOnly) {
			err(`${schemaConn.database} 是 MySQL 系统库，禁止添加列`);
			adding = false;
			return;
		}
		const n = addDraft.name.trim();
		const t = addDraft.type.trim().toUpperCase();
		if (!n) {
			err('列名不能为空');
			return;
		}
		if (!t) {
			err('类型不能为空');
			return;
		}
		/** @type {ColumnDef} */
		const col = { name: n, type: t };
		if (typeof addDraft.size === 'number' && addDraft.size > 0) col.size = addDraft.size;
		if (addDraft.nullable !== undefined) col.nullable = addDraft.nullable;
		if (addDraft.defaultValue) col.defaultValue = addDraft.defaultValue;
		addPending = true;
		try {
			const resp = await addTableColumn(schemaConn, tableName, col);
			if (!resp.success) {
				err(resp.error ?? '添加列失败');
				return;
			}
			ok(`已添加列 ${n}`);
			adding = false;
			await load();
		} finally {
			addPending = false;
		}
	}

	/** @param {ColumnMeta} c */
	function openEdit(c) {
		editing = c;
		editDraft = {
			name: c.name,
			type: c.type,
			size: c.size,
			nullable: c.nullable !== false,
			defaultValue: c.defaultValue == null ? undefined : String(c.defaultValue)
		};
	}

	async function submitEdit() {
		if (!schemaConn || !editing) return;
		if (readOnly) {
			err(`${schemaConn.database} 是 MySQL 系统库，禁止修改列`);
			editing = null;
			return;
		}
		const t = editDraft.type.trim().toUpperCase();
		if (!t) {
			err('类型不能为空');
			return;
		}
		/** @type {ColumnDef} */
		const col = { name: editing.name, type: t };
		if (typeof editDraft.size === 'number' && editDraft.size > 0) col.size = editDraft.size;
		if (editDraft.nullable !== undefined) col.nullable = editDraft.nullable;
		if (editDraft.defaultValue !== undefined && editDraft.defaultValue !== '') {
			col.defaultValue = editDraft.defaultValue;
		}
		editPending = true;
		try {
			const resp = await modifyTableColumn(schemaConn, tableName, col);
			if (!resp.success) {
				err(resp.error ?? '修改列失败');
				return;
			}
			ok(`已修改列 ${editing.name}`);
			editing = null;
			await load();
		} finally {
			editPending = false;
		}
	}

	async function doDrop() {
		if (!schemaConn || !confirmDrop) return;
		if (readOnly) {
			err(`${schemaConn.database} 是 MySQL 系统库，禁止删除列`);
			confirmDrop = null;
			return;
		}
		dropPending = true;
		try {
			const resp = await dropTableColumn(schemaConn, tableName, confirmDrop);
			if (!resp.success) {
				err(resp.error ?? '删除列失败');
				return;
			}
			ok(`已删除列 ${confirmDrop}`);
			confirmDrop = null;
			await load();
		} finally {
			dropPending = false;
		}
	}
</script>

<Modal {open} title={`列结构 · ${tableName}`} size="lg" {onClose}>
	<div class="flex items-center justify-between pb-2">
		<span class="text-xs" style="color: var(--md-on-surface-variant);">
			共 {columns.length} 列
			{#if pending}<span class="ml-2 animate-pulse">…</span>{/if}
		</span>
		<div class="flex items-center gap-1">
			<button class="md-icon-btn" title="刷新" onclick={load} disabled={pending}>↻</button>
			{#if readOnly}
				<span class="md-chip" title="MySQL 系统库，只读">RO · 只读</span>
			{:else}
				<button class="md-btn-text" onclick={openAdd} disabled={pending}>+ 添加列</button>
			{/if}
		</div>
	</div>

	{#if pending && columns.length === 0}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">加载中…</p>
	{:else if columns.length === 0}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">无列信息</p>
	{:else}
		<div
			class="max-h-[60vh] overflow-auto"
			style="border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-md);"
		>
			<table class="min-w-full text-left text-xs">
				<thead
					class="sticky top-0"
					style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
				>
					<tr>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">列</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">类型</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">长度</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">可空</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">主键</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">默认值</th>
						<th class="px-3 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 8rem;"></th>
					</tr>
				</thead>
				<tbody>
					{#each columns as c, i (c.name)}
						<tr
							style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							oncontextmenu={(e) => openRowCtx(e, c)}
						>
							<td class="px-3 py-1.5 font-mono" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);">
								{c.name}
							</td>
							<td class="px-3 py-1.5 font-mono" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);">
								{c.type}
							</td>
							<td class="px-3 py-1.5" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);">
								{c.size ?? '—'}
							</td>
							<td class="px-3 py-1.5" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);">
								{c.nullable ? '是' : '否'}
							</td>
							<td class="px-3 py-1.5" style="border-bottom: 1px solid var(--md-outline-variant);">
								{#if c.isPrimaryKey}
									<span class="md-chip-pk">PK</span>
								{:else}
									<span style="color: var(--md-on-surface-variant);">—</span>
								{/if}
							</td>
							<td class="px-3 py-1.5 font-mono" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);">
								{c.defaultValue == null ? '—' : String(c.defaultValue)}
							</td>
							<td class="px-3 py-1" style="border-bottom: 1px solid var(--md-outline-variant);">
								{#if !readOnly}
									<div class="flex items-center justify-end gap-1">
										<button
											type="button"
											class="md-btn-text"
											style="padding: 0.125rem 0.5rem;"
											onclick={() => openEdit(c)}
										>
											修改
										</button>
										<button
											type="button"
											class="md-btn-text"
											style="padding: 0.125rem 0.5rem; color: var(--md-error);"
											onclick={() => (confirmDrop = c.name)}
											disabled={c.isPrimaryKey === true}
											title={c.isPrimaryKey ? '主键列不可在此处删除' : '删除列'}
										>
											删除
										</button>
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<datalist id="md-col-type-presets">
		{#each TYPE_PRESETS as t (t)}
			<option value={t}></option>
		{/each}
	</datalist>
</Modal>

<!-- 添加列 -->
<Modal open={adding} title={`添加列 · ${tableName}`} size="md" onClose={() => (adding = false)}>
	<div class="grid grid-cols-2 gap-3 text-sm">
		<label class="col-span-2 flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">列名</span>
			<input class="md-input font-mono" type="text" bind:value={addDraft.name} placeholder="例如 description" />
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">类型</span>
			<input
				class="md-input font-mono"
				type="text"
				list="md-col-type-presets"
				bind:value={addDraft.type}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">长度</span>
			<input
				class="md-input"
				type="number"
				min="0"
				value={addDraft.size ?? ''}
				oninput={(e) => {
					const n = Number(e.currentTarget.value);
					addDraft = { ...addDraft, size: Number.isFinite(n) && n > 0 ? n : undefined };
				}}
			/>
		</label>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={addDraft.nullable !== false}
				onchange={(e) => (addDraft = { ...addDraft, nullable: e.currentTarget.checked })}
			/>
			<span style="color: var(--md-on-surface);">可空</span>
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">默认值</span>
			<input
				class="md-input font-mono"
				type="text"
				value={addDraft.defaultValue ?? ''}
				oninput={(e) =>
					(addDraft = {
						...addDraft,
						defaultValue: e.currentTarget.value === '' ? undefined : e.currentTarget.value
					})}
			/>
		</label>
	</div>

	{#snippet footer()}
		<button class="md-btn-text" onclick={() => (adding = false)} disabled={addPending}>取消</button>
		<button
			class="md-btn-filled"
			onclick={submitAdd}
			disabled={addPending || !addDraft.name.trim() || !addDraft.type.trim()}
		>
			{addPending ? '提交中…' : '添加'}
		</button>
	{/snippet}
</Modal>

<!-- 修改列 -->
<Modal
	open={editing !== null}
	title={editing ? `修改列 · ${editing.name}` : ''}
	size="md"
	onClose={() => (editing = null)}
>
	<div class="grid grid-cols-2 gap-3 text-sm">
		<label class="col-span-2 flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">列名（不可改）</span>
			<input class="md-input font-mono" type="text" value={editDraft.name} disabled />
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">类型</span>
			<input
				class="md-input font-mono"
				type="text"
				list="md-col-type-presets"
				bind:value={editDraft.type}
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">长度</span>
			<input
				class="md-input"
				type="number"
				min="0"
				value={editDraft.size ?? ''}
				oninput={(e) => {
					const n = Number(e.currentTarget.value);
					editDraft = { ...editDraft, size: Number.isFinite(n) && n > 0 ? n : undefined };
				}}
			/>
		</label>
		<label class="flex items-center gap-2">
			<input
				type="checkbox"
				checked={editDraft.nullable !== false}
				onchange={(e) => (editDraft = { ...editDraft, nullable: e.currentTarget.checked })}
			/>
			<span style="color: var(--md-on-surface);">可空</span>
		</label>
		<label class="flex flex-col gap-1">
			<span style="color: var(--md-on-surface-variant);">默认值</span>
			<input
				class="md-input font-mono"
				type="text"
				value={editDraft.defaultValue ?? ''}
				oninput={(e) =>
					(editDraft = {
						...editDraft,
						defaultValue: e.currentTarget.value === '' ? undefined : e.currentTarget.value
					})}
			/>
		</label>
	</div>

	{#snippet footer()}
		<button class="md-btn-text" onclick={() => (editing = null)} disabled={editPending}>取消</button>
		<button class="md-btn-filled" onclick={submitEdit} disabled={editPending || !editDraft.type.trim()}>
			{editPending ? '提交中…' : '保存'}
		</button>
	{/snippet}
</Modal>

<ConfirmDialog
	open={confirmDrop !== null}
	title="删除列"
	message={`确认删除列 ${confirmDrop}？该列数据将一并丢失，且无法恢复。`}
	confirmText="删除"
	danger
	pending={dropPending}
	onConfirm={doDrop}
	onCancel={() => (confirmDrop = null)}
/>

<ContextMenu
	open={rowCtx ? {
		x: rowCtx.x,
		y: rowCtx.y,
		items: [
			{ label: '复制列名', icon: '⧉', onClick: () => { if (rowCtx) copyText2(rowCtx.col.name); } },
			{ label: '复制类型', icon: '⧉', onClick: () => { if (rowCtx) copyText2(rowCtx.col.type + (rowCtx.col.size ? `(${rowCtx.col.size})` : '')); } },
			!readOnly ? { label: '修改列', icon: '✎', onClick: () => { if (rowCtx) openEdit(rowCtx.col); } } : null,
			!readOnly && !rowCtx?.col.isPrimaryKey ? { label: '删除列', icon: '✕', danger: true, onClick: () => { if (rowCtx) confirmDrop = rowCtx.col.name; } } : null
		].filter((i) => i !== null)
	} : null}
	onClose={() => (rowCtx = null)}
/>
