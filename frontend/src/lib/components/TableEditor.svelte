<script>
	import { createTable } from '$lib/api';
	import { ok, err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnDef} ColumnDef
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {ConnectionConfig | null} schemaConn
	 * @property {string} schemaName
	 * @property {(tableName: string) => void} [onCreated]
	 * @property {() => void} onClose
	 */

	/** @type {Props} */
	let { open, schemaConn, schemaName, onCreated, onClose } = $props();

	const TYPE_PRESETS = [
		'INT', 'BIGINT', 'SMALLINT',
		'VARCHAR', 'TEXT', 'CHAR',
		'DECIMAL', 'FLOAT', 'DOUBLE',
		'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
		'BOOLEAN', 'JSON', 'BLOB'
	];

	let tableName = $state('');
	/** @type {ColumnDef[]} */
	let columns = $state([]);
	let pending = $state(false);

	$effect(() => {
		if (open) {
			tableName = '';
			columns = [
				{ name: 'id', type: 'INT', nullable: false, isPrimaryKey: true }
			];
		}
	});

	function addColumn() {
		columns = [...columns, { name: '', type: 'VARCHAR', size: 255, nullable: true }];
	}

	function removeColumn(idx) {
		columns = columns.filter((_, i) => i !== idx);
	}

	function moveUp(idx) {
		if (idx <= 0) return;
		const next = [...columns];
		[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
		columns = next;
	}

	function moveDown(idx) {
		if (idx >= columns.length - 1) return;
		const next = [...columns];
		[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
		columns = next;
	}

	/** @param {number} idx @param {Partial<ColumnDef>} patch */
	function patchColumn(idx, patch) {
		columns = columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
	}

	async function submit() {
		if (!schemaConn) return;
		const name = tableName.trim();
		if (!name) {
			err('请填写表名');
			return;
		}
		if (columns.length === 0) {
			err('至少需要一个列');
			return;
		}
		const cleaned = /** @type {ColumnDef[]} */ ([]);
		for (const c of columns) {
			const cn = c.name.trim();
			if (!cn) {
				err('列名不能为空');
				return;
			}
			if (!c.type.trim()) {
				err(`列 ${cn} 的类型不能为空`);
				return;
			}
			/** @type {ColumnDef} */
			const out = { name: cn, type: c.type.trim().toUpperCase() };
			if (typeof c.size === 'number' && c.size > 0) out.size = c.size;
			if (c.nullable !== undefined) out.nullable = c.nullable;
			if (c.isPrimaryKey) out.isPrimaryKey = true;
			if (c.defaultValue !== undefined && c.defaultValue !== '') out.defaultValue = c.defaultValue;
			cleaned.push(out);
		}
		pending = true;
		try {
			const resp = await createTable(schemaConn, name, cleaned);
			if (!resp.success) {
				err(resp.error ?? '创建表失败');
				return;
			}
			ok(`已创建 ${schemaName}.${name}`);
			onCreated?.(name);
			onClose();
		} finally {
			pending = false;
		}
	}
</script>

<Modal {open} title={`新建表 · ${schemaName}`} size="lg" {onClose}>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">表名</span>
			<input
				class="md-input font-mono"
				type="text"
				bind:value={tableName}
				placeholder="例如 products"
			/>
		</label>

		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<span class="text-sm" style="color: var(--md-on-surface-variant);">列定义</span>
				<button class="md-btn-text" onclick={addColumn}>+ 添加列</button>
			</div>

			<div
				class="max-h-[50vh] overflow-auto"
				style="border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-sm);"
			>
				<table class="min-w-full text-left text-xs">
					<thead
						class="sticky top-0"
						style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
					>
						<tr>
							<th class="px-2 py-1.5 font-medium">列名</th>
							<th class="px-2 py-1.5 font-medium">类型</th>
							<th class="px-2 py-1.5 font-medium" style="width: 5rem;">长度</th>
							<th class="px-2 py-1.5 font-medium" style="width: 4rem;">可空</th>
							<th class="px-2 py-1.5 font-medium" style="width: 3rem;">PK</th>
							<th class="px-2 py-1.5 font-medium">默认值</th>
							<th class="px-2 py-1.5 font-medium" style="width: 6rem;"></th>
						</tr>
					</thead>
					<tbody>
						{#each columns as c, i (i)}
							<tr style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}>
								<td class="px-2 py-1">
									<input
										class="md-input w-full font-mono text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="text"
										value={c.name}
										oninput={(e) => patchColumn(i, { name: e.currentTarget.value })}
									/>
								</td>
								<td class="px-2 py-1">
									<input
										class="md-input w-full font-mono text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="text"
										list="md-type-presets"
										value={c.type}
										oninput={(e) => patchColumn(i, { type: e.currentTarget.value })}
									/>
								</td>
								<td class="px-2 py-1">
									<input
										class="md-input w-full text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="number"
										min="0"
										value={c.size ?? ''}
										oninput={(e) => {
											const n = Number(e.currentTarget.value);
											patchColumn(i, { size: Number.isFinite(n) && n > 0 ? n : undefined });
										}}
									/>
								</td>
								<td class="px-2 py-1 text-center">
									<input
										type="checkbox"
										checked={c.nullable !== false}
										onchange={(e) => patchColumn(i, { nullable: e.currentTarget.checked })}
									/>
								</td>
								<td class="px-2 py-1 text-center">
									<input
										type="checkbox"
										checked={c.isPrimaryKey === true}
										onchange={(e) =>
											patchColumn(i, {
												isPrimaryKey: e.currentTarget.checked,
												nullable: e.currentTarget.checked ? false : c.nullable
											})}
									/>
								</td>
								<td class="px-2 py-1">
									<input
										class="md-input w-full font-mono text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="text"
										value={c.defaultValue ?? ''}
										oninput={(e) =>
											patchColumn(i, {
												defaultValue: e.currentTarget.value === '' ? undefined : e.currentTarget.value
											})}
									/>
								</td>
								<td class="px-2 py-1">
									<div class="flex items-center justify-end gap-0.5">
										<button
											type="button"
											class="md-icon-btn"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title="上移"
											onclick={() => moveUp(i)}
											disabled={i === 0}
										>
											↑
										</button>
										<button
											type="button"
											class="md-icon-btn"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title="下移"
											onclick={() => moveDown(i)}
											disabled={i === columns.length - 1}
										>
											↓
										</button>
										<button
											type="button"
											class="md-icon-btn"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title="删除"
											onclick={() => removeColumn(i)}
										>
											<span style="color: var(--md-error);">✕</span>
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<datalist id="md-type-presets">
				{#each TYPE_PRESETS as t (t)}
					<option value={t}></option>
				{/each}
			</datalist>
		</div>
	</div>

	{#snippet footer()}
		<button class="md-btn-text" onclick={onClose} disabled={pending}>取消</button>
		<button
			class="md-btn-filled"
			onclick={submit}
			disabled={pending || !tableName.trim() || columns.length === 0}
		>
			{pending ? '创建中…' : '创建'}
		</button>
	{/snippet}
</Modal>
