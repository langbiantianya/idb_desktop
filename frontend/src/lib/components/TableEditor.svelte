<script>
	import { createTable } from '$lib/api';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import Modal from './Modal.svelte';
	import MdButton from './MdButton.svelte';
	import Combobox from './Combobox.svelte';

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
		'INT',
		'BIGINT',
		'SMALLINT',
		'VARCHAR',
		'TEXT',
		'CHAR',
		'DECIMAL',
		'FLOAT',
		'DOUBLE',
		'DATE',
		'DATETIME',
		'TIMESTAMP',
		'TIME',
		'BOOLEAN',
		'JSON',
		'BLOB'
	];

	let tableName = $state('');
	/** @type {ColumnDef[]} */
	let columns = $state([]);
	let pending = $state(false);

	// 表选项
	let optEngine = $state('InnoDB');
	let optCharset = $state('utf8mb4');
	let optCollate = $state('utf8mb4_unicode_ci');
	let optComment = $state('');

	let isMysql = $derived(schemaConn?.driver === 'Mysql');

	// MySQL 常见 charset → collation 映射
	const CHARSET_OPTIONS = ['utf8mb4', 'utf8', 'latin1', 'ascii', 'utf16', 'binary'];
	const ENGINE_OPTIONS = ['InnoDB', 'MyISAM', 'MEMORY', 'ARCHIVE', 'CSV', 'BLACKHOLE'];
	const COLLATE_MAP = {
		utf8mb4: ['utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin'],
		utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
		latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
		ascii: ['ascii_general_ci', 'ascii_bin'],
		utf16: ['utf16_general_ci', 'utf16_unicode_ci', 'utf16_bin'],
		binary: ['binary']
	};
	let collateOptions = $derived(COLLATE_MAP[optCharset] || []);

	// charset 切换时重置 collate 为该 charset 的首个选项
	$effect(() => {
		if (optCharset && collateOptions.length > 0 && !collateOptions.includes(optCollate)) {
			optCollate = collateOptions[0];
		}
	});

	$effect(() => {
		if (open) {
			tableName = '';
			columns = [{ name: 'id', type: 'INT', nullable: false, isPrimaryKey: true }];
			optEngine = 'InnoDB';
			optCharset = 'utf8mb4';
			optCollate = 'utf8mb4_unicode_ci';
			optComment = '';
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
			err(get(t)('table.toast.fill_name'));
			return;
		}
		if (columns.length === 0) {
			err(get(t)('table.toast.need_column'));
			return;
		}
		const cleaned = /** @type {ColumnDef[]} */ ([]);
		for (const c of columns) {
			const cn = c.name.trim();
			if (!cn) {
				err(get(t)('table.toast.empty_col_name'));
				return;
			}
			if (!c.type.trim()) {
				err(get(t)('table.toast.empty_col_type', { name: cn }));
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
			const opts = {};
			if (isMysql) {
				opts.charset = optCharset;
				opts.collate = optCollate;
				opts.engine = optEngine;
			}
			if (optComment.trim()) opts.comment = optComment.trim();
			const resp = await createTable(
				schemaConn,
				name,
				cleaned,
				Object.keys(opts).length ? opts : undefined
			);
			if (!resp.success) {
				err(resp.error ?? get(t)('table.toast.create_failed'));
				return;
			}
			ok(get(t)('table.toast.created', { schema: schemaName, name }));
			onCreated?.(name);
			onClose();
		} finally {
			pending = false;
		}
	}
</script>

<Modal {open} title={$t('table.new_title', { schema: schemaName })} size="lg" {onClose}>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('table.table_name')}</span>
			<input
				class="md-input font-mono"
				type="text"
				bind:value={tableName}
				placeholder={$t('table.table_placeholder')}
			/>
		</label>

		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<span class="text-sm" style="color: var(--md-on-surface-variant);"
					>{$t('table.columns')}</span
				>
				<MdButton variant="text" onclick={addColumn}>{$t('table.add_column')}</MdButton>
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
							<th class="px-2 py-1.5 font-medium">{$t('table.col_name')}</th>
							<th class="px-2 py-1.5 font-medium">{$t('table.col_type')}</th>
							<th class="px-2 py-1.5 font-medium" style="width: 5rem;">{$t('table.col_size')}</th>
							<th class="px-2 py-1.5 font-medium" style="width: 4rem;"
								>{$t('table.col_nullable')}</th
							>
							<th class="px-2 py-1.5 font-medium" style="width: 3rem;">{$t('common.pk')}</th>
							<th class="px-2 py-1.5 font-medium">{$t('table.col_default')}</th>
							<th class="px-2 py-1.5 font-medium" style="width: 6rem;"></th>
						</tr>
					</thead>
					<tbody>
						{#each columns as c, i (i)}
							<tr
								style:background={i % 2 === 0
									? 'transparent'
									: 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}
							>
								<td class="px-2 py-1">
									<input
										class="w-full md-input font-mono text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="text"
										value={c.name}
										oninput={(e) => patchColumn(i, { name: e.currentTarget.value })}
									/>
								</td>
								<td class="px-2 py-1">
									<Combobox
										value={c.type}
										options={TYPE_PRESETS}
										placeholder="VARCHAR"
										onchange={(v) => patchColumn(i, { type: v })}
									/>
								</td>
								<td class="px-2 py-1">
									<input
										class="w-full md-input text-xs"
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
										class="w-full md-input font-mono text-xs"
										style="padding: 0.25rem 0.5rem;"
										type="text"
										value={c.defaultValue ?? ''}
										oninput={(e) =>
											patchColumn(i, {
												defaultValue:
													e.currentTarget.value === '' ? undefined : e.currentTarget.value
											})}
									/>
								</td>
								<td class="px-2 py-1">
									<div class="flex items-center justify-end gap-0.5">
										<MdButton
											type="button"
											variant="icon"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title={$t('table.move_up')}
											onclick={() => moveUp(i)}
											disabled={i === 0}
										>
											↑
										</MdButton>
										<MdButton
											type="button"
											variant="icon"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title={$t('table.move_down')}
											onclick={() => moveDown(i)}
											disabled={i === columns.length - 1}
										>
											↓
										</MdButton>
										<MdButton
											type="button"
											variant="icon"
											style="width: 1.5rem; height: 1.5rem; font-size: 0.75rem;"
											title={$t('common.delete')}
											onclick={() => removeColumn(i)}
										>
											<span style="color: var(--md-error);">✕</span>
										</MdButton>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</div>

	<!-- 表选项 -->
	<details class="group text-sm">
		<summary
			class="flex cursor-pointer items-center gap-1 select-none"
			style="color: var(--md-on-surface-variant);"
		>
			<svg
				class="h-4 w-4 transition-transform group-open:rotate-90"
				viewBox="0 0 20 20"
				fill="none"
			>
				<path
					d="M7 5l5 5-5 5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			{$t('table.options')}
		</summary>
		<div class="mt-3 flex flex-col gap-3 pl-5">
			{#if isMysql}
				<label class="flex flex-col gap-1">
					<span style="color: var(--md-on-surface-variant);">{$t('table.engine')}</span>
					<Combobox bind:value={optEngine} options={ENGINE_OPTIONS} placeholder="InnoDB" />
				</label>
				<label class="flex flex-col gap-1">
					<span style="color: var(--md-on-surface-variant);">{$t('table.charset')}</span>
					<Combobox bind:value={optCharset} options={CHARSET_OPTIONS} placeholder="utf8mb4" />
				</label>
				<label class="flex flex-col gap-1">
					<span style="color: var(--md-on-surface-variant);">{$t('table.collate')}</span>
					<Combobox
						bind:value={optCollate}
						options={collateOptions}
						placeholder="utf8mb4_unicode_ci"
					/>
				</label>
			{/if}
			<label class="flex flex-col gap-1">
				<span style="color: var(--md-on-surface-variant);">{$t('table.comment')}</span>
				<input class="md-input" type="text" bind:value={optComment} />
			</label>
		</div>
	</details>

	{#snippet footer()}
		<MdButton variant="text" onclick={onClose} disabled={pending}>{$t('common.cancel')}</MdButton>
		<MdButton
			variant="filled"
			onclick={submit}
			disabled={pending || !tableName.trim() || columns.length === 0}
		>
			{pending ? $t('common.creating') : $t('common.create')}
		</MdButton>
	{/snippet}
</Modal>
