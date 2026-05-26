<script>
	import { listUsers, listSchemas, updateUserPrivileges } from '$lib/api';
	import { asUserList, asStringList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} baseConn
	 */

	/** @type {Props} */
	let { baseConn } = $props();

	let users = $state(/** @type {{ user: string; host?: string }[]} */ ([]));
	let schemaOptions = $state(/** @type {string[]} */ ([]));
	let pending = $state(false);

	let editing = $state(/** @type {{ user: string; host?: string } | null} */ (null));
	let formSchema = $state('');
	let formIsGrant = $state(true);
	let formPrivileges = $state(/** @type {Set<string>} */ (new Set()));
	let formPending = $state(false);

	const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX'];

	$effect(() => {
		baseConn;
		void refresh();
		void loadSchemas();
	});

	async function refresh() {
		pending = true;
		try {
			const resp = await listUsers(baseConn);
			if (!resp.success) {
				err(resp.error ?? '加载用户失败');
				users = [];
				return;
			}
			users = asUserList(resp.data);
		} finally {
			pending = false;
		}
	}

	async function loadSchemas() {
		const resp = await listSchemas(baseConn);
		if (resp.success) schemaOptions = asStringList(resp.data);
	}

	function openEditor(u) {
		editing = u;
		formSchema = baseConn.database || schemaOptions[0] || '';
		formIsGrant = true;
		formPrivileges = new Set(['SELECT']);
	}

	function togglePriv(p) {
		const next = new Set(formPrivileges);
		if (next.has(p)) next.delete(p);
		else next.add(p);
		formPrivileges = next;
	}

	async function submit() {
		if (!editing) return;
		if (!formSchema) {
			err('请选择目标 schema');
			return;
		}
		if (formPrivileges.size === 0) {
			err('请至少勾选一项权限');
			return;
		}
		formPending = true;
		try {
			const resp = await updateUserPrivileges(baseConn, {
				user: editing.user,
				schema: formSchema,
				privileges: [...formPrivileges],
				isGrant: formIsGrant
			});
			if (!resp.success) {
				err(resp.error ?? '操作失败');
				return;
			}
			ok(`${formIsGrant ? '已授予' : '已回收'} ${editing.user} 在 ${formSchema} 的权限`);
			editing = null;
		} finally {
			formPending = false;
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<header class="flex items-center justify-between text-sm">
		<h2 class="font-medium text-slate-700">
			users
			<span class="ml-2 text-xs text-slate-400">{users.length}</span>
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

	{#if users.length === 0 && !pending}
		<p class="py-6 text-center text-sm text-slate-400">暂无用户</p>
	{:else}
		<ul class="grid grid-cols-2 gap-2">
			{#each users as u, i (`${u.user}@${u.host ?? '*'}-${i}`)}
				<li
					class="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
				>
					<span class="truncate font-mono">
						{u.user}{u.host ? `@${u.host}` : ''}
					</span>
					<button
						class="text-xs text-slate-500 hover:text-slate-900"
						onclick={() => openEditor(u)}
					>
						授权 / 回收
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<Modal
	open={editing !== null}
	title={editing ? `权限管理 · ${editing.user}${editing.host ? '@' + editing.host : ''}` : ''}
	size="md"
	onClose={() => (editing = null)}
>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-slate-600">目标 schema</span>
			<select
				class="rounded-md border border-slate-300 px-3 py-2"
				bind:value={formSchema}
			>
				{#if schemaOptions.length === 0}
					<option value="">（暂无 schema 选项）</option>
				{/if}
				{#each schemaOptions as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</label>

		<div class="flex gap-2 text-sm">
			<button
				class="flex-1 rounded-md border px-3 py-1.5
					{formIsGrant
					? 'border-emerald-300 bg-emerald-50 text-emerald-700'
					: 'border-slate-200 text-slate-500 hover:bg-slate-50'}"
				onclick={() => (formIsGrant = true)}
			>
				授予 GRANT
			</button>
			<button
				class="flex-1 rounded-md border px-3 py-1.5
					{!formIsGrant
					? 'border-rose-300 bg-rose-50 text-rose-700'
					: 'border-slate-200 text-slate-500 hover:bg-slate-50'}"
				onclick={() => (formIsGrant = false)}
			>
				回收 REVOKE
			</button>
		</div>

		<div class="flex flex-col gap-1 text-sm">
			<span class="text-slate-600">权限</span>
			<div class="grid grid-cols-4 gap-2">
				{#each PRIVILEGES as p (p)}
					<label
						class="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs
							{formPrivileges.has(p)
							? 'border-slate-900 bg-slate-50 text-slate-900'
							: 'border-slate-200 text-slate-500 hover:bg-slate-50'}"
					>
						<input
							type="checkbox"
							checked={formPrivileges.has(p)}
							onchange={() => togglePriv(p)}
						/>
						{p}
					</label>
				{/each}
			</div>
		</div>
	</div>

	{#snippet footer()}
		<button
			class="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
			onclick={() => (editing = null)}
			disabled={formPending}
		>
			取消
		</button>
		<button
			class="rounded-md px-4 py-1.5 text-sm text-white shadow-sm disabled:opacity-60
				{formIsGrant ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-rose-600 hover:bg-rose-700'}"
			onclick={submit}
			disabled={formPending || formPrivileges.size === 0 || !formSchema}
		>
			{formPending ? '提交中…' : formIsGrant ? '授予' : '回收'}
		</button>
	{/snippet}
</Modal>
