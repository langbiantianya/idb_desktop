<script>
	import Modal from './Modal.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {string} title
	 * @property {string[]} columns
	 * @property {Record<string, unknown>} initial
	 * @property {boolean} [editing]
	 * @property {string[]} [pkColumns]
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
		pending = false,
		onSubmit,
		onCancel
	} = $props();

	/** @type {Record<string, string | null>} */
	let drafts = $state({});

	$effect(() => {
		if (!open) return;
		const next = /** @type {Record<string, string | null>} */ ({});
		for (const c of columns) {
			const v = initial[c];
			next[c] = v === null || v === undefined ? null : String(v);
		}
		drafts = next;
	});

	function setNull(col) {
		drafts = { ...drafts, [col]: null };
	}

	function setText(col, text) {
		drafts = { ...drafts, [col]: text };
	}

	async function submit(e) {
		e.preventDefault();
		if (editing) {
			const changes = /** @type {Record<string, unknown>} */ ({});
			for (const c of columns) {
				const before = initial[c];
				const after = drafts[c];
				const beforeStr = before === null || before === undefined ? null : String(before);
				if (after !== beforeStr) changes[c] = after;
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
				values[c] = v;
			}
			await onSubmit(values);
		}
	}
</script>

<Modal {open} {title} size="lg" onClose={onCancel}>
	<form class="flex flex-col gap-3" onsubmit={submit}>
		<div class="grid max-h-[60vh] grid-cols-2 gap-3 overflow-auto pr-1">
			{#each columns as c (c)}
				<label class="flex flex-col gap-1 text-xs">
					<div class="flex items-center justify-between">
						<span class="font-mono" style="color: var(--md-on-surface);">
							{c}
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
					{:else}
						<input
							class="md-input font-mono text-sm"
							type="text"
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
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
