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
		// Ctrl/Cmd + Enter 执行
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault();
			run();
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between text-sm">
		<h2 class="font-medium text-slate-700">SQL 控制台</h2>
		<div class="flex items-center gap-2 text-xs text-slate-400">
			<span>{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '(未选库)'}</span>
		</div>
	</header>

	<textarea
		class="h-40 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-sm leading-relaxed focus:bg-white"
		bind:value={sql}
		onkeydown={onKeyDown}
		placeholder="SELECT id, name FROM users LIMIT 10;&#10;&#10;Ctrl/Cmd + Enter 执行"
	></textarea>

	<div class="flex items-center justify-between text-xs">
		<span class="text-slate-400">
			{#if lastSql}
				上次执行：<code class="font-mono">{lastSql.length > 80 ? lastSql.slice(0, 80) + '…' : lastSql}</code>
			{/if}
		</span>
		<button
			class="rounded-full bg-slate-900 px-4 py-1.5 text-sm text-white shadow-sm hover:bg-slate-700 disabled:opacity-60"
			onclick={run}
			disabled={pending || !sql.trim()}
		>
			{pending ? '执行中…' : '执行 (Ctrl+Enter)'}
		</button>
	</div>

	{#if affected !== null && rows.length === 0}
		<div class="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
			受影响行数：{affected}
		</div>
	{:else if rows.length > 0 && columns.length > 0}
		<div class="max-h-[50vh] overflow-auto rounded-md border border-slate-200">
			<table class="min-w-full text-left text-xs">
				<thead class="sticky top-0 bg-slate-100 text-slate-600">
					<tr>
						{#each columns as col (col)}
							<th class="border-b border-slate-200 px-3 py-2 font-medium whitespace-nowrap">
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row, i (i)}
						<tr class="even:bg-slate-50">
							{#each columns as col (col)}
								<td class="max-w-[24rem] truncate border-b border-slate-100 px-3 py-1.5">
									{#if isLob(row[col])}
										<span class="text-slate-400 italic">{row[col]}</span>
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
		<p class="text-right text-xs text-slate-400">{rows.length} 行结果</p>
	{:else if lastSql && !pending}
		<p class="py-6 text-center text-sm text-slate-400">无结果</p>
	{/if}
</section>
