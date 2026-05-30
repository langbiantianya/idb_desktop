<script>
	import { listColumns, addTableColumn, modifyTableColumn, dropTableColumn } from '$lib/api';
	import { asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ContextMenu from './ContextMenu.svelte';

	/**
	 * 表结构编辑器：所有改动先落到本地 draft，点"保存"才统一推送到引擎。
	 * 这样多个改动可以在同一个工作流里编排（先 drop 再 modify 最后 add），
	 * 用户也可以在保存前撤销任意一步。
	 *
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {import('$lib/api').ColumnDef} ColumnDef
	 *
	 * @typedef {{
	 *   key: string;
	 *   state: 'unchanged' | 'modified' | 'added' | 'dropped';
	 *   original: ColumnMeta | null;
	 *   draft: { name: string; type: string; size?: number; nullable: boolean; defaultValue?: string };
	 * }} EntryDraft
	 *
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {ConnectionConfig | null} schemaConn
	 * @property {string} tableName
	 * @property {() => void} onClose
	 * @property {(schema: string, table: string) => void} [onSaved]
	 */

	/** @type {Props} */
	let { open, schemaConn, tableName, onClose, onSaved } = $props();

	const TYPE_PRESETS = [
		'INT', 'BIGINT', 'SMALLINT',
		'VARCHAR', 'TEXT', 'CHAR',
		'DECIMAL', 'FLOAT', 'DOUBLE',
		'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
		'BOOLEAN', 'JSON', 'BLOB'
	];

	let entries = $state(/** @type {EntryDraft[]} */ ([]));
	let pending = $state(false);
	let saving = $state(false);
	let confirmClose = $state(false);
	let rowCtx = $state(/** @type {{ x: number; y: number; entry: EntryDraft } | null} */ (null));

	let readOnly = $derived(isReadOnlySchema(schemaConn, schemaConn?.database));
	let dirty = $derived(entries.some((e) => e.state !== 'unchanged'));
	let canSave = $derived(
		dirty &&
			entries.every(
				(e) => e.state !== 'added' || (e.draft.name.trim() !== '' && e.draft.type.trim() !== '')
			)
	);

	$effect(() => {
		if (!open || !schemaConn || !tableName) return;
		void load();
	});

	function newKey(prefix) {
		return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
	}

	/** @param {ColumnMeta} c */
	function metaToDraft(c) {
		return {
			name: c.name,
			type: c.type ?? '',
			size: c.size,
			nullable: c.nullable !== false,
			defaultValue: c.defaultValue == null ? undefined : String(c.defaultValue)
		};
	}

	async function load() {
		if (!schemaConn) return;
		pending = true;
		try {
			const resp = await listColumns(schemaConn, tableName);
			if (!resp.success) {
				err(resp.error ?? '加载列失败');
				entries = [];
				return;
			}
			const cols = asColumnList(resp.data);
			entries = cols.map((c) => ({
				key: c.name,
				state: 'unchanged',
				original: c,
				draft: metaToDraft(c)
			}));
		} finally {
			pending = false;
		}
	}

	/**
	 * 比较 draft 与 original 是否有实质差异（忽略未填的可选字段差）。
	 * @param {ColumnMeta} orig
	 * @param {EntryDraft['draft']} d
	 */
	function draftDiffers(orig, d) {
		if (orig.name.trim() !== d.name.trim()) return true;
		if ((orig.type ?? '').trim().toUpperCase() !== d.type.trim().toUpperCase()) return true;
		const oSize = typeof orig.size === 'number' ? orig.size : undefined;
		const dSize = typeof d.size === 'number' ? d.size : undefined;
		if (oSize !== dSize) return true;
		if ((orig.nullable !== false) !== d.nullable) return true;
		const oDef = orig.defaultValue == null ? '' : String(orig.defaultValue);
		const dDef = d.defaultValue == null ? '' : String(d.defaultValue);
		if (oDef !== dDef) return true;
		return false;
	}

	/** @param {number} idx @param {Partial<EntryDraft['draft']>} patch */
	function patchDraft(idx, patch) {
		const e = entries[idx];
		if (!e) return;
		// 直接在 $state 代理上原地改：proxy 会触发反应式更新，
		// 避免 .map() 重建数组 + keyed each 的 DOM 复用导致 input 控件 value/oninput 失序。
		Object.assign(e.draft, patch);
		if (e.state !== 'added' && e.state !== 'dropped') {
			e.state = e.original && draftDiffers(e.original, e.draft) ? 'modified' : 'unchanged';
		}
	}

	function addColumn() {
		entries.push({
			key: newKey('new'),
			state: 'added',
			original: null,
			draft: { name: '', type: 'VARCHAR', size: 255, nullable: true }
		});
	}

	/** @param {number} idx */
	function markDrop(idx) {
		const e = entries[idx];
		if (!e) return;
		if (e.state === 'added') {
			entries.splice(idx, 1);
			return;
		}
		e.state = 'dropped';
	}

	/** @param {number} idx */
	function undoDrop(idx) {
		const e = entries[idx];
		if (!e || !e.original) return;
		e.state = draftDiffers(e.original, e.draft) ? 'modified' : 'unchanged';
	}

	/** @param {EntryDraft['draft']} d */
	function buildColumnDef(d) {
		/** @type {ColumnDef} */
		const col = { name: d.name.trim(), type: d.type.trim().toUpperCase() };
		if (typeof d.size === 'number' && d.size > 0) col.size = d.size;
		col.nullable = !!d.nullable;
		if (d.defaultValue !== undefined && d.defaultValue !== '') col.defaultValue = d.defaultValue;
		return col;
	}

	/**
	 * 校验：新增的列必须有名字和类型；不能与现有未删除列重名；类型不能为空。
	 */
	function validate() {
		const seen = new Map();
		for (const e of entries) {
			if (e.state === 'dropped') continue;
			const name = e.draft.name.trim();
			if (!name) {
				return `存在未填列名的列`;
			}
			if (!e.draft.type.trim()) {
				return `列 ${name} 类型不能为空`;
			}
			const lower = name.toLowerCase();
			if (seen.has(lower)) {
				return `列名 ${name} 重复`;
			}
			seen.set(lower, true);
		}
		return null;
	}

	async function save() {
		if (!schemaConn || readOnly || !canSave) return;
		const v = validate();
		if (v) {
			err(v);
			return;
		}

		saving = true;
		try {
			// 顺序：先删（释放名字 / 索引位）→ 再改（已有列原地修改）→ 最后加（追加到尾部）。
			const drops = entries.filter((e) => e.state === 'dropped' && e.original);
			const mods = entries.filter((e) => e.state === 'modified' && e.original);
			const adds = entries.filter((e) => e.state === 'added');

			for (const e of drops) {
				const r = await dropTableColumn(schemaConn, tableName, /** @type {ColumnMeta} */ (e.original).name);
				if (!r.success) {
					err(r.error ?? `删除列 ${/** @type {ColumnMeta} */ (e.original).name} 失败`);
					await load();
					return;
				}
			}
			for (const e of mods) {
				const col = buildColumnDef(e.draft);
				const origName = /** @type {ColumnMeta} */ (e.original).name;
				// column.name 始终为原始名（定位用），newName 携带新名供引擎做 RENAME
				if (col.name !== origName) {
					col.newName = col.name;
				}
				col.name = origName;
				const r = await modifyTableColumn(schemaConn, tableName, col);
				if (!r.success) {
					err(r.error ?? `修改列 ${col.name} 失败`);
					await load();
					return;
				}
			}
			for (const e of adds) {
				const col = buildColumnDef(e.draft);
				const r = await addTableColumn(schemaConn, tableName, col);
				if (!r.success) {
					err(r.error ?? `添加列 ${col.name} 失败`);
					await load();
					return;
				}
			}

			ok(
				`已保存：${drops.length ? `删 ${drops.length} ` : ''}${mods.length ? `改 ${mods.length} ` : ''}${adds.length ? `加 ${adds.length}` : ''}`.trim() ||
					'已保存'
			);
			await load();
			if (schemaConn.database) onSaved?.(schemaConn.database, tableName);
		} finally {
			saving = false;
		}
	}

	function tryClose() {
		if (saving) return;
		if (dirty) {
			confirmClose = true;
			return;
		}
		onClose();
	}

	function discardAndClose() {
		confirmClose = false;
		entries = [];
		onClose();
	}

	function openRowCtx(e, entry) {
		e.preventDefault();
		rowCtx = { x: e.clientX, y: e.clientY, entry };
	}

	async function copyText2(text) {
		try {
			await navigator.clipboard.writeText(text);
			ok('已复制');
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
		}
	}

	/** @param {EntryDraft['state']} s */
	function stateChip(s) {
		switch (s) {
			case 'added':
				return { label: '新增', bg: 'var(--md-primary-container)', fg: 'var(--md-on-primary-container)' };
			case 'modified':
				return { label: '修改', bg: 'var(--md-tertiary-container)', fg: 'var(--md-on-tertiary-container)' };
			case 'dropped':
				return { label: '删除', bg: 'var(--md-error-container, #F9DEDC)', fg: 'var(--md-on-error-container, #410E0B)' };
			default:
				return null;
		}
	}
</script>

<Modal {open} title={`修改表结构 · ${tableName}`} size="lg" onClose={tryClose}>
	<div class="flex items-center justify-between pb-2">
		<span class="text-xs" style="color: var(--md-on-surface-variant);">
			共 {entries.filter((e) => e.state !== 'dropped').length} 列{#if dirty}<span class="ml-2">·</span>
				<span class="ml-1" style="color: var(--md-tertiary);">未保存改动</span>
			{/if}
			{#if pending}<span class="ml-2 animate-pulse">…</span>{/if}
		</span>
		<div class="flex items-center gap-1">
			<button class="md-icon-btn" title="重新加载（丢弃未保存改动）" onclick={load} disabled={pending || saving}>↻</button>
			{#if readOnly}
				<span class="md-chip" title="MySQL 系统库，只读">RO · 只读</span>
			{:else}
				<button class="md-btn-text" onclick={addColumn} disabled={pending || saving}>+ 添加列</button>
			{/if}
		</div>
	</div>

	{#if pending && entries.length === 0}
		<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">加载中…</p>
	{:else if entries.length === 0}
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
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 4.5rem;">状态</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">列</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">类型</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 5rem;">长度</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 3.5rem;">可空</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 3rem;">主键</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant);">默认值</th>
						<th class="px-2 py-2 font-medium" style="border-bottom: 1px solid var(--md-outline-variant); width: 4rem;"></th>
					</tr>
				</thead>
				<tbody>
					{#each entries as e, i (e.key)}
						{@const chip = stateChip(e.state)}
						{@const droppedRow = e.state === 'dropped'}
						{@const editable = !readOnly && !droppedRow}
						<tr
							style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							style:opacity={droppedRow ? 0.55 : 1}
							style:text-decoration={droppedRow ? 'line-through' : 'none'}
							oncontextmenu={(ev) => openRowCtx(ev, e)}
						>
							<td class="px-2 py-1.5" style="border-bottom: 1px solid var(--md-outline-variant);">
								{#if chip}
									<span
										class="rounded-sm px-1.5 py-0.5 text-[10px] font-medium"
										style:background={chip.bg}
										style:color={chip.fg}
									>{chip.label}</span>
								{:else}
									<span style="color: var(--md-on-surface-variant);">—</span>
								{/if}
							</td>
							<td class="px-2 py-1 font-mono" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);">
								<input
									class="md-input font-mono"
									style="font-size: 0.75rem; padding: 0.25rem 0.375rem;"
									type="text"
									value={e.draft.name}
									disabled={!editable}
									oninput={(ev) => patchDraft(i, { name: ev.currentTarget.value })}
								/>
							</td>
							<td class="px-2 py-1 font-mono" style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);">
								<input
									class="md-input font-mono"
									style="font-size: 0.75rem; padding: 0.25rem 0.375rem;"
									type="text"
									list="md-col-type-presets"
									value={e.draft.type}
									disabled={!editable}
									oninput={(ev) => patchDraft(i, { type: ev.currentTarget.value })}
								/>
							</td>
							<td class="px-2 py-1" style="border-bottom: 1px solid var(--md-outline-variant);">
								<input
									class="md-input"
									style="font-size: 0.75rem; padding: 0.25rem 0.375rem;"
									type="number"
									min="0"
									value={e.draft.size ?? ''}
									disabled={!editable}
									oninput={(ev) => {
										const n = Number(ev.currentTarget.value);
										patchDraft(i, { size: Number.isFinite(n) && n > 0 ? n : undefined });
									}}
								/>
							</td>
							<td class="px-2 py-1.5 text-center" style="border-bottom: 1px solid var(--md-outline-variant);">
								<input
									type="checkbox"
									checked={e.draft.nullable}
									disabled={!editable}
									onchange={(ev) => patchDraft(i, { nullable: ev.currentTarget.checked })}
								/>
							</td>
							<td class="px-2 py-1.5" style="border-bottom: 1px solid var(--md-outline-variant);">
								{#if e.original?.isPrimaryKey}
									<span class="md-chip-pk">PK</span>
								{:else}
									<span style="color: var(--md-on-surface-variant);">—</span>
								{/if}
							</td>
							<td class="px-2 py-1 font-mono" style="border-bottom: 1px solid var(--md-outline-variant);">
								<input
									class="md-input font-mono"
									style="font-size: 0.75rem; padding: 0.25rem 0.375rem;"
									type="text"
									value={e.draft.defaultValue ?? ''}
									disabled={!editable}
									oninput={(ev) =>
										patchDraft(i, {
											defaultValue: ev.currentTarget.value === '' ? undefined : ev.currentTarget.value
										})}
								/>
							</td>
							<td class="px-2 py-1" style="border-bottom: 1px solid var(--md-outline-variant);">
								{#if !readOnly}
									{#if droppedRow}
										<button
											type="button"
											class="md-btn-text"
											style="padding: 0.125rem 0.375rem; font-size: 0.6875rem;"
											onclick={() => undoDrop(i)}
										>
											撤销
										</button>
									{:else}
										<button
											type="button"
											class="md-btn-text"
											style="padding: 0.125rem 0.375rem; color: var(--md-error); font-size: 0.6875rem;"
											onclick={() => markDrop(i)}
											disabled={e.original?.isPrimaryKey === true}
											title={e.original?.isPrimaryKey ? '主键列不可在此处删除' : '删除列'}
										>
											删除
										</button>
									{/if}
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

	{#snippet footer()}
		<button class="md-btn-text" onclick={tryClose} disabled={saving}>
			{dirty ? '取消' : '关闭'}
		</button>
		{#if !readOnly}
			<button class="md-btn-filled" onclick={save} disabled={saving || pending || !canSave}>
				{saving ? '保存中…' : '保存'}
			</button>
		{/if}
	{/snippet}
</Modal>

<ConfirmDialog
	open={confirmClose}
	title="放弃修改？"
	message="存在未保存的改动，确认放弃并关闭？"
	confirmText="放弃"
	danger
	onConfirm={discardAndClose}
	onCancel={() => (confirmClose = false)}
/>

<ContextMenu
	open={rowCtx
		? {
				x: rowCtx.x,
				y: rowCtx.y,
				items: [
					{ label: '复制列名', icon: '⧉', onClick: () => { if (rowCtx) copyText2(rowCtx.entry.draft.name); } },
					{
						label: '复制类型',
						icon: '⧉',
						onClick: () => {
							if (rowCtx)
								copyText2(
									rowCtx.entry.draft.type +
										(rowCtx.entry.draft.size ? `(${rowCtx.entry.draft.size})` : '')
								);
						}
					}
				]
			}
		: null}
	onClose={() => (rowCtx = null)}
/>
