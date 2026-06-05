<script>
	import { goto } from '$app/navigation';
	import { openSettings } from '$lib/stores/overlayStore.js';
	import { listSchemas } from '$lib/api';
	import {
		listSavedConnections,
		loadSavedPassword,
		saveConnectionProfile,
		deleteConnectionProfile
	} from '$lib/api/connections.js';
	import { defaultConnection } from '$lib/stores/appState.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import ThemeToggle from './ThemeToggle.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import MdButton from './MdButton.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {import('$lib/api/connections.js').SavedConnection} SavedConnection
	 * @typedef {Object} Props
	 * @property {(conn: ConnectionConfig) => void} onConnected
	 */

	/** @type {Props} */
	let { onConnected } = $props();

	let conn = $state({ ...defaultConnection });
	let pending = $state(false);

	let saved = $state(/** @type {SavedConnection[]} */ ([]));
	let activeId = $state('');
	let savePassword = $state(false);
	let confirmDeleteId = $state(/** @type {string | null} */ (null));

	$effect(() => {
		void refreshSaved();
	});

	async function refreshSaved() {
		saved = await listSavedConnections();
	}

	/** @param {SavedConnection} s */
	async function pickProfile(s) {
		activeId = s.id;
		const password = s.hasPassword ? await loadSavedPassword(s.id).catch(() => '') : '';
		conn = {
			name: s.name,
			driver: /** @type {ConnectionConfig['driver']} */ (s.driver),
			host: s.host,
			port: s.port,
			user: s.user,
			password,
			database: s.database
		};
		savePassword = s.hasPassword;
	}

	function newProfile() {
		activeId = '';
		conn = { ...defaultConnection };
		savePassword = false;
	}

	function adjustDefaultPort() {
		// 仅当当前 user / port 还停在另一驱动的默认值时才替换；用户改过的就不动。
		if (conn.driver === 'Postgresql') {
			if (conn.port === 3306) conn.port = 5432;
			if (conn.user === 'root') conn.user = 'postgres';
		} else if (conn.driver === 'Mysql') {
			if (conn.port === 5432) conn.port = 3306;
			if (conn.user === 'postgres') conn.user = 'root';
		}
	}

	async function save() {
		const name = (conn.name ?? '').trim();
		if (!name) {
			err(get(t)('conn.toast.fill_name'));
			return;
		}
		try {
			const result = await saveConnectionProfile({
				id: activeId,
				name,
				driver: conn.driver,
				host: conn.host,
				port: Number(conn.port) || 0,
				user: conn.user,
				password: conn.password ?? '',
				database: conn.database ?? '',
				savePassword
			});
			if (result) {
				activeId = result.id;
				ok(get(t)('conn.toast.saved', { name }));
				await refreshSaved();
			}
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('conn.toast.save_failed'));
		}
	}

	async function doDelete() {
		const id = confirmDeleteId;
		if (!id) return;
		try {
			await deleteConnectionProfile(id);
			ok(get(t)('conn.toast.deleted'));
			if (activeId === id) newProfile();
			confirmDeleteId = null;
			await refreshSaved();
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('conn.toast.delete_failed'));
		}
	}

	async function submit(e) {
		e.preventDefault();
		pending = true;
		try {
			const resp = await listSchemas(conn);
			if (!resp.success) {
				err(resp.error ?? get(t)('conn.toast.connect_failed'));
				return;
			}
			onConnected({ ...conn });
		} finally {
			pending = false;
		}
	}
</script>

<div
	class="flex min-h-screen items-center justify-center p-6"
	style="background: var(--md-background);"
>
	<div class="grid w-full max-w-4xl grid-cols-[16rem_1fr] gap-4">
		<!-- 左侧：保存的连接列表 -->
		<aside
			class="flex flex-col"
			style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-lg); box-shadow: var(--md-elev-1);"
		>
			<header class="flex items-center justify-between border-b px-3 py-2.5" style="border-color: var(--md-outline-variant);">
				<span class="text-xs font-medium" style="color: var(--md-on-surface-variant);">{$t('conn.saved')}</span>
				<MdButton
					type="button"
					variant="icon"
					title={$t('conn.new_blank')}
					ariaLabel={$t('conn.new_aria')}
					onclick={newProfile}
				>
					＋
				</MdButton>
			</header>
			<div class="flex-1 overflow-auto p-1">
				{#if saved.length === 0}
					<p class="px-3 py-6 text-center text-xs" style="color: var(--md-on-surface-variant);">
						{$t('conn.no_saved')}
					</p>
				{:else}
					<ul class="flex flex-col gap-px">
						{#each saved as s (s.id)}
							<li>
								<div
									role="button"
									tabindex="0"
									class="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition"
									style:background={activeId === s.id ? 'var(--md-secondary-container)' : 'transparent'}
									style:color={activeId === s.id ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface)'}
									onmouseenter={(e) => activeId !== s.id && (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
									onmouseleave={(e) => activeId !== s.id && (e.currentTarget.style.background = 'transparent')}
									onclick={() => void pickProfile(s)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											void pickProfile(s);
										}
									}}
								>
									<span class="text-xs" style="color: var(--md-primary);">{s.driver === 'Mysql' ? 'My' : 'Pg'}</span>
									<div class="flex min-w-0 flex-1 flex-col">
										<span class="truncate text-xs">{s.name || $t('conn.unnamed')}</span>
										<span class="truncate font-mono text-[10px]" style="color: var(--md-on-surface-variant);">
											{s.user}@{s.host}:{s.port}
										</span>
									</div>
									{#if s.hasPassword}
										<span class="md-chip" title={$t('conn.password_saved')}>PW</span>
									{/if}
									<MdButton
										type="button"
										variant="icon"
										class="opacity-0 group-hover:opacity-100"
										style="width: 1.25rem; height: 1.25rem;"
										title={$t('common.delete')}
										onclick={(e) => {
											e.stopPropagation();
											confirmDeleteId = s.id;
										}}
									>
										<span style="color: var(--md-error); font-size: 0.75rem;">✕</span>
									</MdButton>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</aside>

		<!-- 右侧：连接表单 -->
		<div class="flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<div>
					<h1 class="text-2xl font-semibold tracking-tight" style="color: var(--md-on-background);">
						{$t('conn.title')}
					</h1>
				</div>
				<div class="flex items-center gap-1">
					<ThemeToggle />
					<MdButton variant="icon" onclick={openSettings} title={$t('workspace.settings')}>
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<path d="M8.325 2.317a1.417 1.417 0 013.35 0 1.417 1.417 0 002.142.866 1.417 1.417 0 012.368 2.368 1.417 1.417 0 00.866 2.142 1.417 1.417 0 010 3.35 1.417 1.417 0 00-.866 2.142 1.417 1.417 0 01-2.368 2.368 1.417 1.417 0 00-2.142.866 1.417 1.417 0 01-3.35 0 1.417 1.417 0 00-2.142-.866 1.417 1.417 0 01-2.368-2.368 1.417 1.417 0 00-.866-2.142 1.417 1.417 0 010-3.35 1.417 1.417 0 00.866-2.142 1.417 1.417 0 012.368-2.368 1.417 1.417 0 002.142-.866z" stroke="currentColor" stroke-width="1.3"/>
							<circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.3"/>
						</svg>
					</MdButton>
				</div>
			</div>

			<form
				class="grid grid-cols-2 gap-4 p-6"
				style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-lg); box-shadow: var(--md-elev-1);"
				onsubmit={submit}
			>
				<label class="col-span-2 flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.name')}</span>
					<input
						class="md-input"
						type="text"
						bind:value={conn.name}
						placeholder={$t('conn.name_placeholder')}
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.driver')}</span>
					<select class="md-input" bind:value={conn.driver} onchange={adjustDefaultPort}>
						<option value="Mysql">MySQL</option>
						<option value="Postgresql">PostgreSQL</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.host')}</span>
					<input class="md-input" type="text" bind:value={conn.host} required />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.port')}</span>
					<input class="md-input" type="number" bind:value={conn.port} min="1" max="65535" required />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.user')}</span>
					<input class="md-input" type="text" bind:value={conn.user} required />
				</label>
				<label class="col-span-2 flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.password')}</span>
					<input class="md-input" type="password" bind:value={conn.password} autocomplete="off" />
				</label>
				<label class="col-span-2 flex flex-col gap-1 text-sm">
					<span style="color: var(--md-on-surface-variant);">{$t('conn.database')}</span>
					<input class="md-input" type="text" bind:value={conn.database} />
				</label>

				<label class="col-span-2 flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={savePassword} />
					<span style="color: var(--md-on-surface);">{$t('conn.save_password')}</span>
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						{$t('conn.save_password_help')}
					</span>
				</label>

				<div class="col-span-2 mt-2 flex items-center justify-between gap-2">
					<MdButton type="button" variant="text" onclick={save} disabled={pending}>
						{activeId ? $t('conn.save_changes') : $t('conn.save_as_new')}
					</MdButton>
					<MdButton type="submit" variant="filled" disabled={pending}>
						{pending ? $t('conn.connecting') : $t('conn.connect')}
					</MdButton>
				</div>
			</form>
		</div>
	</div>
</div>

<ConfirmDialog
	open={confirmDeleteId !== null}
	title={$t('conn.delete_title')}
	message={$t('conn.delete_msg')}
	confirmText={$t('common.delete')}
	danger
	onConfirm={doDelete}
	onCancel={() => (confirmDeleteId = null)}
/>
