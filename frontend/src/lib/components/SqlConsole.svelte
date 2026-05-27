<script>
	import { executeSql } from '$lib/api';
	import { asSqlResult, isLob, renderCell } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 */

	/** @type {Props} */
	let { schemaConn } = $props();

	let sql = $state('');
	let pending = $state(false);

	let rows = $state(/** @type {Record<string, unknown>[]} */ ([]));
	let columns = $state(/** @type {string[]} */ ([]));
	let affected = $state(/** @type {number | null} */ (null));
	let lastSql = $state('');

	async function run() {
		const trimmed = sql.trim();
		if (!trimmed) return;
		pending = true;
		try {
			const resp = await executeSql(schemaConn, trimmed);
			lastSql = trimmed;
			if (!resp.success) {
				err(resp.error ?? 'SQL 执行失败');
				rows = [];
				columns = [];
				affected = null;
				return;
			}
			const result = asSqlResult(resp.data);
			rows = result.rows;
			columns = result.columns;
			affected = result.affectedRows;
			if (affected !== null) ok(`受影响行数：${affected}`);
		} finally {
			pending = false;
		}
	}

	function onKeyDown(e) {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			run();
		}
	}
</script>

<section class="flex h-full flex-col gap-3">
	<header
		class="flex items-center justify-between px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface);">SQL 控制台</h2>
		<div class="flex items-center gap-2 text-xs font-mono" style="color: var(--md-on-surface-variant);">
			{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '(未选库)'}
		</div>
	</header>

	<div class="flex flex-col gap-3 px-3 pb-3">
		<textarea
			class="md-input h-40 w-full resize-y font-mono text-sm leading-relaxed"
			bind:value={sql}
			onkeydown={onKeyDown}
			placeholder={"SELECT id, name FROM users LIMIT 10;\n\nCtrl/Cmd + Enter 执行"}
		></textarea>

		<div class="flex items-center justify-between text-xs">
			<span style="color: var(--md-on-surface-variant);">
				{#if lastSql}
					上次执行：<code class="font-mono">{lastSql.length > 80 ? lastSql.slice(0, 80) + '…' : lastSql}</code>
				{/if}
			</span>
			<button class="md-btn-filled" onclick={run} disabled={pending || !sql.trim()}>
				{pending ? '执行中…' : '执行 (Ctrl+Enter)'}
			</button>
		</div>

		{#if affected !== null && rows.length === 0}
			<div
				class="px-4 py-3 text-sm"
				style="background: var(--md-success-container); color: var(--md-on-success-container); border-radius: var(--md-radius-sm);"
			>
				受影响行数：{affected}
			</div>
		{:else if rows.length > 0 && columns.length > 0}
			<div
				class="max-h-[50vh] overflow-auto"
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
									class="px-3 py-2 font-medium font-mono whitespace-nowrap"
									style="border-bottom: 1px solid var(--md-outline-variant);"
								>
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as row, i (i)}
							<tr style:background={i % 2 === 0 ? 'transparent' : 'color-mix(in srgb, var(--md-on-surface) 3%, transparent)'}>
								{#each columns as col (col)}
									<td
										class="max-w-[24rem] truncate px-3 py-1.5 font-mono"
										style="border-bottom: 1px solid var(--md-outline-variant); color: var(--md-on-surface);"
									>
										{#if isLob(row[col])}
											<span class="italic" style="color: var(--md-on-surface-variant);">{row[col]}</span>
										{:else}
											{renderCell(row[col])}
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-right text-xs" style="color: var(--md-on-surface-variant);">{rows.length} 行结果</p>
		{:else if lastSql && !pending}
			<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">无结果</p>
		{/if}
	</div>
</section>
