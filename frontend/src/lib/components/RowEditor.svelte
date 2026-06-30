<script>
	import { Modal, MdButton } from '$lib/components/ui/index.js';
	import { t } from '$lib/i18n';
	import {
		temporalKind,
		hasTimeZone,
		fractionalDigits,
		stepFor,
		dbToPickerValue,
		pickerToDbValue,
		parseTzSuffix
	} from '$lib/temporal.js';
	import { DatePicker, TimePicker, DateTimePicker } from '$lib/components/ui/index.js';

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

	/** 带 TZ 类型列的原始时区后缀（'+08:00' 或 'Z'），提交时拼回 DB。
	 *  在 $effect 中从 initial 抽取；与 drafts 同生命周期。 */
	let tzSuffixes = $state(/** @type {Record<string, string>} */ ({}));

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
		const tzNext = /** @type {Record<string, string>} */ ({});
		for (const c of columns) {
			const v = initial[c];
			if (v === null || v === undefined) {
				next[c] = null;
				continue;
			}
			const meta = map[c];
			const kind = temporalKind(meta?.type);
			const tz = hasTimeZone(meta?.type);
			if (kind && tz) {
				// 带 TZ 类型：从 initial 抽取后缀，按本地时区显示
				const s = String(v).trim();
				const parsed = parseTzSuffix(s);
				tzNext[c] = parsed ? parsed.raw : '';
				next[c] = dbToPickerValue(s, meta);
			} else if (kind) {
				next[c] = dbToPickerValue(v, meta);
			} else {
				next[c] = String(v);
			}
		}
		drafts = next;
		tzSuffixes = tzNext;
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
		if (kind) return pickerToDbValue(v, meta, tzSuffixes[col] ?? '');
		return v;
	}

	async function submit(e) {
		e.preventDefault();
		if (editing) {
			const changes = /** @type {Record<string, unknown>} */ ({});
			for (const c of columns) {
				const before = initial[c];
				const after = drafts[c];
				// 把 before 也过一遍 pickerToDbValue，让比较两边都到 DB-shape
				// DB 原值与 picker round-trip 都收敛到同一形态，防止 digits 截断、
				// T/空格差异造成假 diff 触发多余 UPDATE。
				const beforeRaw = before === null || before === undefined
					? null
					: toDbValue(c, dbToPickerValue(before, metaByName[c]));
				const afterRaw = after === null ? null : toDbValue(c, after);
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
				if (v === '' || v === null || v === undefined) continue;
				values[c] = toDbValue(c, v);
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
						<MdButton
							type="button"
							variant="text"
							style="padding: 0 0.375rem; font-size: 0.625rem;"
							onclick={() => setNull(c)}
						>
							{$t('row.set_null')}
							</MdButton>
						</div>
						{#if drafts[c] === null}
							<button
								type="button"
								class="px-3 py-2 text-left italic"
								style="border: 1px dashed var(--md-outline); border-radius: var(--md-radius-xs); color: var(--md-on-surface-variant); background: transparent;"
								onclick={() => setText(c, '')}
							>
								{$t('row.null_hint')}
							</button>
						{:else if kind === 'date'}
							<DatePicker
								value={drafts[c] ?? ''}
								size="sm"
								onchange={(v) => setText(c, v)}
							/>
						{:else if kind === 'time'}
							<TimePicker
								value={drafts[c] ?? ''}
								size="sm"
								onchange={(v) => setText(c, v)}
							/>
						{:else if kind === 'datetime'}
							<DateTimePicker
								value={drafts[c] ?? ''}
								size="sm"
								onchange={(v) => setText(c, v)}
							/>
						{:else}
							<input
								class="md-input font-mono text-sm"
								type="text"
								value={drafts[c]}
								oninput={(e) => setText(c, e.currentTarget.value)}
								placeholder={kind && tz ? $t('row.tz_hint') : ''}
							/>
						{/if}
					</label>
				{/each}
			</div>

		<footer class="flex justify-end gap-2 pt-2">
			<MdButton variant="text" type="button" onclick={onCancel} disabled={pending}>
				{$t('common.cancel')}
			</MdButton>
			<MdButton variant="filled" type="submit" disabled={pending}>
				{pending ? $t('common.submitting') : editing ? $t('row.save_changes') : $t('common.insert')}
			</MdButton>
		</footer>
	</form>
</Modal>
