<script>
	import { listUsers, listSchemas, updateUserPrivileges } from '$lib/api';
	import { asUserList, asStringList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import Modal from './Modal.svelte';
	import MdButton from './MdButton.svelte';

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
				err(resp.error ?? get(t)('user.toast.load_failed'));
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
			err(get(t)('user.toast.select_schema'));
			return;
		}
		if (formPrivileges.size === 0) {
			err(get(t)('user.toast.select_priv'));
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
				err(resp.error ?? get(t)('user.toast.failed'));
				return;
			}
			ok(get(t)(formIsGrant ? 'user.toast.granted' : 'user.toast.revoked', { user: editing.user, schema: formSchema }));
			editing = null;
		} finally {
			formPending = false;
		}
	}
</script>

<section class="flex h-full flex-col gap-3">
	<header
		class="flex items-center justify-between px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface);">
			{$t('user.title')}
			<span class="ml-2 text-xs" style="color: var(--md-on-surface-variant);">{users.length}</span>
			{#if pending}
				<span class="ml-2 animate-pulse text-xs" style="color: var(--md-on-surface-variant);">…</span>
			{/if}
		</h2>
		<MdButton variant="icon" title={$t('common.refresh')} onclick={refresh} disabled={pending}>↻</MdButton>
	</header>

	<div class="flex-1 overflow-auto px-3 pb-3">
		{#if users.length === 0 && !pending}
			<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">{$t('user.no_users')}</p>
		{:else}
			<ul class="grid grid-cols-2 gap-2">
				{#each users as u, i (`${u.user}@${u.host ?? '*'}-${i}`)}
					<li
						class="flex items-center justify-between gap-2 px-3 py-2 text-sm"
						style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-sm);"
					>
						<span class="truncate font-mono" style="color: var(--md-on-surface);">
							{u.user}{u.host ? `@${u.host}` : ''}
						</span>
						<MdButton variant="text" onclick={() => openEditor(u)}>{$t('user.grant_revoke')}</MdButton>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<Modal
	open={editing !== null}
	title={editing ? `${get(t)('user.edit_title', { user: editing.user + (editing.host ? '@' + editing.host : '') })}` : ''}
	size="md"
	onClose={() => (editing = null)}
>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.target_schema')}</span>
			<select class="md-input" bind:value={formSchema}>
				{#if schemaOptions.length === 0}
					<option value="">{$t('user.no_schema')}</option>
				{/if}
				{#each schemaOptions as s (s)}
					<option value={s}>{s}</option>
				{/each}
			</select>
		</label>

		<div class="flex gap-2 text-sm">
			<button
				class="flex-1 px-3 py-1.5"
				style:background={formIsGrant ? 'var(--md-success-container)' : 'transparent'}
				style:color={formIsGrant ? 'var(--md-on-success-container)' : 'var(--md-on-surface-variant)'}
				style="border: 1px solid {formIsGrant ? 'transparent' : 'var(--md-outline-variant)'}; border-radius: var(--md-radius-sm);"
				onclick={() => (formIsGrant = true)}
			>
				{$t('user.grant')}
			</button>
			<button
				class="flex-1 px-3 py-1.5"
				style:background={!formIsGrant ? 'var(--md-error-container)' : 'transparent'}
				style:color={!formIsGrant ? 'var(--md-on-error-container)' : 'var(--md-on-surface-variant)'}
				style="border: 1px solid {!formIsGrant ? 'transparent' : 'var(--md-outline-variant)'}; border-radius: var(--md-radius-sm);"
				onclick={() => (formIsGrant = false)}
			>
				{$t('user.revoke')}
			</button>
		</div>

		<div class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.privileges')}</span>
			<div class="grid grid-cols-4 gap-2">
				{#each PRIVILEGES as p (p)}
					<label
						class="flex items-center gap-2 px-2 py-1.5 text-xs"
						style:background={formPrivileges.has(p) ? 'var(--md-secondary-container)' : 'transparent'}
						style:color={formPrivileges.has(p) ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface-variant)'}
						style="border: 1px solid {formPrivileges.has(p) ? 'transparent' : 'var(--md-outline-variant)'}; border-radius: var(--md-radius-sm); cursor: pointer;"
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
		<MdButton variant="text" onclick={() => (editing = null)} disabled={formPending}>
			{$t('common.cancel')}
		</MdButton>
		<MdButton
			variant={formIsGrant ? 'filled' : 'danger'}
			onclick={submit}
			disabled={formPending || formPrivileges.size === 0 || !formSchema}
		>
			{formPending ? $t('common.submitting') : formIsGrant ? $t('user.grant') : $t('user.revoke')}
		</MdButton>
	{/snippet}
</Modal>
