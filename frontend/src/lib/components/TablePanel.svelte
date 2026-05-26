<script>
	import { listTables, listColumns } from '$lib/api';
	import { asTableList, asColumnList } from '$lib/api/normalize.js';
	import { err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn   - 已注入 database 字段的连接
	 * @property {string} schemaName
	 * @property {string | null} selected
	 * @property {(name: string) => void} onSelect
	 */

	/** @type {Props} */
	let { schemaConn, schemaName, selected, onSelect } = $props();

	let tables = $state(/** @type {{ name: string; type: string }[]} */ ([]));
	let pending = $state(false);

	let inspecting = $state(/** @type {string | null} */ (null));
	let columns = $state(/** @type {ColumnMeta[]} */ ([]));
	let columnsPending = $state(false);

	$effect(() => {
		schemaName;
		schemaConn;
		refresh();
	});

	async function refresh() {
		pending = true;
		try {
			const resp = await listTables(schemaConn);
			if (!resp.success) {
				err(resp.error ?? '加载失败');
				tables = [];
				return;
			}
			tables = asTableList(resp.data);
		} finally {
			pending = false;
		}
	}

	async function inspect(name) {
		inspecting = name;
		columns = [];
		columnsPending = true;
		try {
			const resp = await listColumns(schemaConn, name);
			if (!resp.success) {
				err(resp.error ?? '加载列失败');
				return;
			}
			columns = asColumnList(resp.data);
		} finally {
			columnsPending = false;
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between text-sm">
		<h2 class="font-medium text-slate-700">
			<span class="text-slate-500">{schemaName} ·</span>
			tables
			<span class="ml-2 text-xs text-slate-400">{tables.length}</span>
			{#if pending}<span class="ml-2 animate-pulse text-xs text-slate-400">…</span>{/if}
		</h2>
		<button
			class="rounded-md border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50"
			onclick={refresh}
			disabled={pending}
		>
			刷新
		</button>
	</header>

	{#if tables.length === 0 && !pending}
		<p class="py-6 text-center text-sm text-slate-400">该 schema 下没有可见的表</p>
	{:else}
		<ul class="grid grid-cols-3 gap-2">
			{#each tables as t (t.name)}
				<li
					class="group flex items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm hover:bg-white
						{selected === t.name ? 'border-slate-900 bg-white' : 'border-slate-200 hover:border-slate-400'}"
				>
					<button class="flex-1 truncate text-left" onclick={() => onSelect(t.name)}>
						{t.name}
					</button>
					<span class="text-xs text-slate-400">{t.type}</span>
					<button
						class="text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-900"
						onclick={() => inspect(t.name)}
						title="查看列结构"
					>
						列
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Modal
	open={inspecting !== null}
	title={`列结构 · ${inspecting ?? ''}`}
	size="lg"
	onClose={() => (inspecting = null)}
>
	{#if columnsPending}
		<p class="py-6 text-center text-sm text-slate-400">加载中…</p>
	{:else if columns.length === 0}
		<p class="py-6 text-center text-sm text-slate-400">无列信息</p>
	{:else}
		<div class="max-h-[60vh] overflow-auto rounded-md border border-slate-200">
			<table class="min-w-full text-left text-xs">
				<thead class="sticky top-0 bg-slate-100 text-slate-600">
					<tr>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">列</th>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">类型</th>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">长度</th>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">可空</th>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">主键</th>
						<th class="border-b border-slate-200 px-3 py-2 font-medium">默认值</th>
					</tr>
				</thead>
				<tbody>
					{#each columns as c (c.name)}
						<tr class="even:bg-slate-50">
							<td class="border-b border-slate-100 px-3 py-1.5 font-mono">{c.name}</td>
							<td class="border-b border-slate-100 px-3 py-1.5">{c.type}</td>
							<td class="border-b border-slate-100 px-3 py-1.5">{c.size ?? '—'}</td>
							<td class="border-b border-slate-100 px-3 py-1.5">{c.nullable ? '是' : '否'}</td>
							<td class="border-b border-slate-100 px-3 py-1.5">
								{#if c.isPrimaryKey}
									<span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">PK</span>
								{:else}
									—
								{/if}
							</td>
							<td class="border-b border-slate-100 px-3 py-1.5 text-slate-500">
								{c.defaultValue == null ? '—' : String(c.defaultValue)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</Modal>
