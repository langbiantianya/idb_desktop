<script>
	import Modal from './Modal.svelte';
	import {
		temporalKind,
		hasTimeZone,
		fractionalDigits,
		stepFor,
		dbToPickerValue,
		pickerToDbValue
	} from '$lib/temporal.js';

	/**
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {string} title
	 * @property {string[]} columns
	 * @property {Record<string, unknown>} initial
	 * @property {boolean} [editing]
	 * @property {string[]} [pkColumns]
	 * @property {ColumnMeta[]} [columnMeta]
	 * @property {boolean} [pending]
	 * @property {(values: Record<string, unknown>, where?: Record<string, unknown>) => void | Promise<void>} onSubmit
	 * @property {() => void} onCancel
	 */

	/** @type {Props} */
	let {
		open,
		title,
		columns,
		initial,
		editing = false,
		pkColumns = [],
		columnMeta = [],
		pending = false,
		onSubmit,
		onCancel
	} = $props();

	/** @type {Record<string, string | null>} */
	let drafts = $state({});

	let metaByName = $derived.by(() => {
		/** @type {Record<string, ColumnMeta>} */
		const m = {};
		for (const c of columnMeta ?? []) m[c.name] = c;
		return m;
	});

	$effect(() => {
		if (!open) return;
		const map = metaByName;
		const next = /** @type {Record<string, string | null>} */ ({});
		for (const c of columns) {
			const v = initial[c];
			if (v === null || v === undefined) {
				next[c] = null;
				continue;
			}
			const meta = map[c];
			const kind = temporalKind(meta?.type);
			if (kind && !hasTimeZone(meta?.type)) {
				next[c] = dbToPickerValue(v, kind, fractionalDigits(meta));
			} else {
				next[c] = String(v);
			}
		}
		drafts = next;
	});

	function setNull(col) {
		drafts = { ...drafts, [col]: null };
	}

	function setText(col, text) {
		drafts = { ...drafts, [col]: text };
	}

	/**
	 * 打包写回值：时间类用 picker 值反向转回 DB 字符串；其他类原样。
	 * @param {string} col
	 * @param {string | null} v
	 */
	function toDbValue(col, v) {
		if (v === null) return null;
		const meta = metaByName[col];
		const kind = temporalKind(meta?.type);
		if (kind && !hasTimeZone(meta?.type)) return pickerToDbValue(v, kind);
		return v;
	}

	async function submit(e) {
		e.preventDefault();
		if (editing) {
			const changes = /** @type {Record<string, unknown>} */ ({});
			for (const c of columns) {
				const before = initial[c];
				const after = drafts[c];
				const beforeRaw = before === null || before === undefined ? null : String(before);
				const afterRaw = after === null ? null : toDbValue(c, after);
				// 比较时拿 DB-shape 字符串：picker 把 '2024-01-01 12:00:00' 解析后会回到完全相同的字符串
				if (afterRaw !== beforeRaw) changes[c] = afterRaw;
			}
			if (Object.keys(changes).length === 0) {
				onCancel();
				return;
			}
			const whereCols = pkColumns.length > 0 ? pkColumns : columns;
			const where = /** @type {Record<string, unknown>} */ ({});
			for (const c of whereCols) where[c] = initial[c];
			await onSubmit(changes, where);
		} else {
			const values = /** @type {Record<string, unknown>} */ ({});
			for (const c of columns) {
				const v = drafts[c];
				if (v === '' || v === undefined) continue;
				values[c] = v === null ? null : toDbValue(c, v);
			}
			await onSubmit(values);
		}
	}
</script>

<Modal {open} {title} size="lg" onClose={onCancel}>
	<form class="flex flex-col gap-3" onsubmit={submit}>
		<div class="grid max-h-[60vh] grid-cols-2 gap-3 overflow-auto pr-1">
			{#each columns as c (c)}
				{@const meta = metaByName[c]}
				{@const kind = temporalKind(meta?.type)}
				{@const tz = hasTimeZone(meta?.type)}
				{@const digits = fractionalDigits(meta)}
				<label class="flex flex-col gap-1 text-xs">
					<div class="flex items-center justify-between">
						<span class="font-mono" style="color: var(--md-on-surface);">
							{c}
							{#if meta}
								<span class="ml-1" style="color: var(--md-on-surface-variant);">
									{meta.type}{meta.size ? `(${meta.size})` : ''}
								</span>
							{/if}
							{#if editing && pkColumns.includes(c)}
								<span class="md-chip-pk ml-1">PK</span>
							{/if}
						</span>
						<button
							type="button"
							class="md-btn-text"
							style="padding: 0 0.375rem; font-size: 0.625rem;"
							onclick={() => setNull(c)}
						>
							设为 NULL
						</button>
					</div>
					{#if drafts[c] === null}
						<button
							type="button"
							class="px-3 py-2 text-left italic"
							style="border: 1px dashed var(--md-outline); border-radius: var(--md-radius-xs); color: var(--md-on-surface-variant); background: transparent;"
							onclick={() => setText(c, '')}
						>
							NULL（点击编辑）
						</button>
					{:else if kind === 'date'}
						<input
							class="md-input font-mono text-sm"
							type="date"
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
						/>
					{:else if kind === 'time' && !tz}
						<input
							class="md-input font-mono text-sm"
							type="time"
							step={stepFor(digits)}
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
						/>
					{:else if kind === 'datetime' && !tz}
						<input
							class="md-input font-mono text-sm"
							type="datetime-local"
							step={stepFor(digits)}
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
						/>
					{:else}
						<input
							class="md-input font-mono text-sm"
							type="text"
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
							placeholder={kind && tz ? '带时区时间需手动输入，如 2024-01-01 12:00:00+08:00' : ''}
						/>
					{/if}
				</label>
			{/each}
		</div>

		<footer class="flex justify-end gap-2 pt-2">
			<button class="md-btn-text" type="button" onclick={onCancel} disabled={pending}>
				取消
			</button>
			<button class="md-btn-filled" type="submit" disabled={pending}>
				{pending ? '提交中…' : editing ? '保存修改' : '插入'}
			</button>
		</footer>
	</form>
</Modal>
