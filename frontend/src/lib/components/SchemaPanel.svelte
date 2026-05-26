<script>
	import { listSchemas, createSchema, deleteSchema } from '$lib/api';
	import { asStringList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} baseConn
	 * @property {string | null} selected
	 * @property {(name: string) => void} onSelect
	 */

	/** @type {Props} */
	let { baseConn, selected, onSelect } = $props();

	let schemas = $state(/** @type {string[]} */ ([]));
	let pending = $state(false);

	let creating = $state(false);
	let newName = $state('');
	let createPending = $state(false);

	let confirming = $state(/** @type {string | null} */ (null));
	let deletePending = $state(false);

	$effect(() => {
		// baseConn 变化时（重新连接）刷新列表
		baseConn;
		refresh();
	});

	async function refresh() {
		pending = true;
		try {
			const resp = await listSchemas(baseConn);
			if (!resp.success) {
				err(resp.error ?? '加载失败');
				schemas = [];
				return;
			}
			schemas = asStringList(resp.data);
		} finally {
			pending = false;
		}
	}

	async function doCreate() {
		const name = newName.trim();
		if (!name) return;
		createPending = true;
		try {
			const resp = await createSchema(baseConn, name);
			if (!resp.success) {
				err(resp.error ?? '创建失败');
				return;
			}
			ok(`已创建 ${name}`);
			creating = false;
			newName = '';
			await refresh();
		} finally {
			createPending = false;
		}
	}

	async function doDelete() {
		const name = confirming;
		if (!name) return;
		deletePending = true;
		try {
			const resp = await deleteSchema(baseConn, name);
			if (!resp.success) {
				err(resp.error ?? '删除失败');
				return;
			}
			ok(`已删除 ${name}`);
			confirming = null;
			if (selected === name) onSelect('');
			await refresh();
		} finally {
			deletePending = false;
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between text-sm">
		<h2 class="font-medium text-slate-700">
			schemas
			<span class="ml-2 text-xs text-slate-400">{schemas.length}</span>
			{#if pending}<span class="ml-2 animate-pulse text-xs text-slate-400">…</span>{/if}
		</h2>
		<div class="flex gap-2">
			<button
				class="rounded-md border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50"
				onclick={refresh}
				disabled={pending}
			>
				刷新
			</button>
			<button
				class="rounded-md bg-slate-900 px-3 py-1 text-xs text-white hover:bg-slate-700"
				onclick={() => {
					newName = '';
					creating = true;
				}}
			>
				新建
			</button>
		</div>
	</header>

	{#if schemas.length === 0 && !pending}
		<p class="py-6 text-center text-sm text-slate-400">无可见 schema</p>
	{:else}
		<ul class="grid grid-cols-3 gap-2">
			{#each schemas as name (name)}
				<li
					class="group flex items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm hover:bg-white
						{selected === name ? 'border-slate-900 bg-white' : 'border-slate-200 hover:border-slate-400'}"
				>
					<button class="flex-1 truncate text-left" onclick={() => onSelect(name)}>
						{name}
					</button>
					<button
						class="text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-rose-600"
						onclick={() => (confirming = name)}
						title="删除 schema"
					>
						删除
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Modal open={creating} title="新建 schema" size="sm" onClose={() => (creating = false)}>
	<label class="flex flex-col gap-1 text-sm">
		<span class="text-slate-600">名称</span>
		<input
			class="rounded-md border border-slate-300 px-3 py-2"
			type="text"
			bind:value={newName}
			placeholder="例如 my_db"
		/>
	</label>
	{#snippet footer()}
		<button
			class="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
			onclick={() => (creating = false)}
			disabled={createPending}
		>
			取消
		</button>
		<button
			class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white shadow-sm hover:bg-slate-700 disabled:opacity-60"
			onclick={doCreate}
			disabled={createPending || !newName.trim()}
		>
			{createPending ? '创建中…' : '创建'}
		</button>
	{/snippet}
</Modal>

<ConfirmDialog
	open={confirming !== null}
	title="删除 schema"
	message={`确认删除 ${confirming}？库内所有对象将一并丢失，且无法恢复。`}
	confirmText="删除"
	danger
	pending={deletePending}
	onConfirm={doDelete}
	onCancel={() => (confirming = null)}
/>
