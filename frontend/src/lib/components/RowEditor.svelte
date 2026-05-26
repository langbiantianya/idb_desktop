<script>
	import Modal from './Modal.svelte';

	/**
	 * RowEditor 既用作"插入"又用作"编辑"。
	 * - 插入：传 columns（列名集合），initial 为 {}；
	 * - 编辑：传 columns + initial（当前行）；onSubmit 回调拿到 (changes, where)，由调用方决定哪些列做 where。
	 *
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {string} title
	 * @property {string[]} columns
	 * @property {Record<string, unknown>} initial
	 * @property {boolean} [editing]      true: 编辑模式（显示原值占位，仅提交修改字段）
	 * @property {string[]} [pkColumns]   编辑模式下作为 where 条件的主键列；缺省时回退到所有列
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

	/** 当前各列的字符串输入；null 显式表示 NULL。 @type {Record<string, string | null>} */
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
			// 仅提交真正修改过的列
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
				// 插入时跳过空字符串视为不显式提供，留给数据库默认/约束处理
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
						<span class="font-mono text-slate-700">
							{c}
							{#if editing && pkColumns.includes(c)}
								<span class="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
									PK
								</span>
							{/if}
						</span>
						<button
							type="button"
							class="text-[10px] text-slate-400 hover:text-slate-700"
							onclick={() => setNull(c)}
						>
							设为 NULL
						</button>
					</div>
					{#if drafts[c] === null}
						<button
							type="button"
							class="rounded-md border border-dashed border-slate-300 px-3 py-2 text-left text-slate-400 italic hover:border-slate-400"
							onclick={() => setText(c, '')}
						>
							NULL（点击编辑）
						</button>
					{:else}
						<input
							class="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
							type="text"
							value={drafts[c]}
							oninput={(e) => setText(c, e.currentTarget.value)}
						/>
					{/if}
				</label>
			{/each}
		</div>

		<footer class="flex justify-end gap-2 pt-2">
			<button
				type="button"
				class="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
				onclick={onCancel}
				disabled={pending}
			>
				取消
			</button>
			<button
				type="submit"
				class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white shadow-sm hover:bg-slate-700 disabled:opacity-60"
				disabled={pending}
			>
				{pending ? '提交中…' : editing ? '保存修改' : '插入'}
			</button>
		</footer>
	</form>
</Modal>
