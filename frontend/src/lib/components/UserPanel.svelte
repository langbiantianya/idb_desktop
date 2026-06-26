<script>
	import {
		listUsers,
		listSchemas,
		listUserGrants,
		createUser,
		deleteUser,
		changeUserPassword,
		updateUserPrivileges
	} from '$lib/api';
	import { asUserList, asStringList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { Modal, ConfirmDialog, MdButton } from '$lib/components/ui/index.js';

	// 系统 schema 集合，授权列表中过滤掉
	const SYSTEM_SCHEMAS = new Set([
		// MySQL
		'sys',
		'performance_schema',
		'mysql',
		'information_schema',
		// PostgreSQL
		'pg_catalog',
		'information_schema',
		'pg_toast'
	]);

	/** 是否为系统 schema（大小写不敏感） */
	function isSystemSchema(/** @type {string} */ name) {
		if (!name) return false;
		if (SYSTEM_SCHEMAS.has(name.toLowerCase())) return true;
		// PostgreSQL: pg_temp_* / pg_toast_temp_*
		if (/^pg_toast_temp_/i.test(name)) return true;
		return false;
	}

	// 系统默认用户，仅允许修改密码
	const SYSTEM_USERS_MYSQL = new Set(['root', 'mysql.sys', 'mysql.session', 'mysql.infoschema']);
	const SYSTEM_USERS_PG = new Set(['postgres']);

	/** 是否为系统用户（禁止授权/删除，仅允许改密） */
	function isSystemUser(/** @type {string} */ user) {
		const u = user.toLowerCase();
		if (isMysql) return SYSTEM_USERS_MYSQL.has(u);
		return SYSTEM_USERS_PG.has(u);
	}

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} baseConn
	 */

	/** @type {Props} */
	let { baseConn } = $props();

	let isMysql = $derived(baseConn.driver === 'Mysql');

	// ── 用户列表 ──
	let users = $state(/** @type {{ user: string; host?: string }[]} */ ([]));
	let pending = $state(false);

	// ── Schema 列表（授权用） ──
	let schemaOptions = $state(/** @type {string[]} */ ([]));

	// ── 创建用户 Modal ──
	let showCreate = $state(false);
	let createUserVal = $state('');
	let createPassword = $state('');
	let createConfirm = $state('');
	let createHost = $state('%');
	let createPending = $state(false);

	// ── 授权 Modal ──
	let editing = $state(/** @type {{ user: string; host?: string } | null} */ (null));
	let formSchema = $state('');
	let formPrivileges = $state(/** @type {Set<string>} */ (new Set()));
	let formPending = $state(false);
	/** @type {{ schema: string; table: string; privileges: string }[]} */
	let formExistingGrants = $state([]);
	let formGrantsLoading = $state(false);

	const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX'];

	// ── 查看权限 Modal ──
	let viewingPriv = $state(/** @type {{ user: string; host?: string } | null} */ (null));
	let privData = $state(/** @type {unknown[]} */ ([]));
	let privLoading = $state(false);

	// ── 修改密码 Modal ──
	let changingPw = $state(/** @type {{ user: string; host?: string } | null} */ (null));
	let newPassword = $state('');
	let confirmPassword = $state('');
	let pwPending = $state(false);

	// ── 删除确认 ──
	let deleting = $state(/** @type {{ user: string; host?: string } | null} */ (null));
	let deletePending = $state(false);

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
		if (resp.success) schemaOptions = asStringList(resp.data).filter((s) => !isSystemSchema(s));
	}

	// ── 创建用户 ──
	function openCreate() {
		createUserVal = '';
		createPassword = '';
		createConfirm = '';
		createHost = '%';
		showCreate = true;
	}

	async function submitCreate() {
		if (!createUserVal || !createPassword) return;
		if (createPassword !== createConfirm) {
			err(get(t)('user.password_mismatch'));
			return;
		}
		createPending = true;
		try {
			const resp = await createUser(
				baseConn,
				createUserVal,
				createPassword,
				isMysql ? createHost : undefined
			);
			if (!resp.success) {
				err(resp.error ?? get(t)('user.toast.failed'));
				return;
			}
			ok(get(t)('user.toast.created', { user: createUserVal }));
			showCreate = false;
			await refresh();
		} finally {
			createPending = false;
		}
	}

	// ── 授权 ──
	async function openEditor(u) {
		editing = u;
		formSchema = baseConn.database || schemaOptions[0] || '';
		formPrivileges = new Set();
		formExistingGrants = [];
		// 拉取已有权限用于回显
		formGrantsLoading = true;
		try {
			const resp = await listUserGrants(baseConn, u.user, u.host);
			if (resp.success && Array.isArray(resp.data)) {
				formExistingGrants =
					/** @type {{ schema: string; table: string; privileges: string }[]} */ (resp.data).filter(
						(g) => !isSystemSchema(g.schema)
					);
			}
		} finally {
			formGrantsLoading = false;
		}
		// 按当前 schema 聚合已有权限并预勾选
		syncPrivsFromGrants();
	}

	/** 当前 schema 下的已有权限 */
	let schemaGrants = $derived(formExistingGrants.filter((g) => g.schema === formSchema));

	/** 聚合后的已有权限集合（用于 diff 和样式判断） */
	let existingPrivSet = $derived(() => {
		const s = new Set();
		for (const g of schemaGrants) {
			for (const p of g.privileges.split(/\s*,\s*/)) {
				if (p) s.add(p.toUpperCase());
			}
		}
		return s;
	});

	/** 从 schemaGrants 聚合出权限集合，同步到 formPrivileges */
	function syncPrivsFromGrants() {
		const privSet = new Set();
		for (const g of schemaGrants) {
			for (const p of g.privileges.split(/\s*,\s*/)) {
				if (p) privSet.add(p.toUpperCase());
			}
		}
		formPrivileges = privSet;
	}

	// schema 切换时重新聚合已有权限
	$effect(() => {
		formSchema;
		if (editing && !formGrantsLoading) {
			syncPrivsFromGrants();
		}
	});

	function togglePriv(p) {
		const next = new Set(formPrivileges);
		if (next.has(p)) next.delete(p);
		else next.add(p);
		formPrivileges = next;
	}

	async function submitGrant() {
		if (!editing) return;
		if (!formSchema) {
			err(get(t)('user.toast.select_schema'));
			return;
		}
		// 计算已有权限集合（聚合自 schemaGrants）
		const existingPrivs = new Set();
		for (const g of schemaGrants) {
			for (const p of g.privileges.split(/\s*,\s*/)) {
				if (p) existingPrivs.add(p.toUpperCase());
			}
		}
		// diff: toGrant = 新勾选的, toRevoke = 取消勾选的
		const toGrant = [...formPrivileges].filter((p) => !existingPrivs.has(p));
		const toRevoke = [...existingPrivs].filter((p) => !formPrivileges.has(p));
		if (toGrant.length === 0 && toRevoke.length === 0) {
			editing = null;
			return;
		}
		formPending = true;
		try {
			if (toGrant.length > 0) {
				const resp = await updateUserPrivileges(baseConn, {
					user: editing.user,
					schema: formSchema,
					privileges: toGrant,
					isGrant: true
				});
				if (!resp.success) {
					err(resp.error ?? get(t)('user.toast.failed'));
					return;
				}
			}
			if (toRevoke.length > 0) {
				const resp = await updateUserPrivileges(baseConn, {
					user: editing.user,
					schema: formSchema,
					privileges: toRevoke,
					isGrant: false
				});
				if (!resp.success) {
					err(resp.error ?? get(t)('user.toast.failed'));
					return;
				}
			}
			const parts = [];
			if (toGrant.length > 0)
				parts.push(get(t)('user.toast.granted', { user: editing.user, schema: formSchema }));
			if (toRevoke.length > 0)
				parts.push(get(t)('user.toast.revoked', { user: editing.user, schema: formSchema }));
			ok(parts.join(' · '));
			editing = null;
		} finally {
			formPending = false;
		}
	}

	// ── 查看权限 ──
	async function openPrivileges(u) {
		viewingPriv = u;
		privLoading = true;
		privData = [];
		try {
			const resp = await listUserGrants(baseConn, u.user, u.host);
			if (resp.success && Array.isArray(resp.data)) {
				privData = resp.data.filter(
					(/** @type {Record<string, unknown>} */ g) =>
						!isSystemSchema(/** @type {string} */ (g.schema))
				);
			}
		} finally {
			privLoading = false;
		}
	}

	// ── 修改密码 ──
	function openChangePw(u) {
		changingPw = u;
		newPassword = '';
		confirmPassword = '';
	}

	async function submitChangePw() {
		if (!changingPw) return;
		if (!newPassword) return;
		if (newPassword !== confirmPassword) {
			err(get(t)('user.password_mismatch'));
			return;
		}
		pwPending = true;
		try {
			const resp = await changeUserPassword(
				baseConn,
				changingPw.user,
				newPassword,
				isMysql ? changingPw.host : undefined
			);
			if (!resp.success) {
				err(resp.error ?? get(t)('user.toast.failed'));
				return;
			}
			ok(get(t)('user.toast.pw_changed', { user: changingPw.user }));
			changingPw = null;
		} finally {
			pwPending = false;
		}
	}

	// ── 删除用户 ──
	function openDelete(u) {
		deleting = u;
	}

	async function confirmDelete() {
		if (!deleting) return;
		deletePending = true;
		try {
			const resp = await deleteUser(baseConn, deleting.user, isMysql ? deleting.host : undefined);
			if (!resp.success) {
				err(resp.error ?? get(t)('user.toast.failed'));
				return;
			}
			ok(get(t)('user.toast.deleted', { user: deleting.user }));
			deleting = null;
			await refresh();
		} finally {
			deletePending = false;
		}
	}

	/** @param {{ user: string; host?: string }} u */
	function userLabel(u) {
		return u.user + (u.host ? `@${u.host}` : '');
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
				<span class="ml-2 animate-pulse text-xs" style="color: var(--md-on-surface-variant);"
					>…</span
				>
			{/if}
		</h2>
		<div class="flex items-center gap-1">
			<MdButton variant="icon" title={$t('common.refresh')} onclick={refresh} disabled={pending}
				>↻</MdButton
			>
			<MdButton variant="tonal" size="sm" onclick={openCreate}>{$t('user.create_user')}</MdButton>
		</div>
	</header>

	<div class="flex-1 overflow-auto px-3 pb-3">
		{#if users.length === 0 && !pending}
			<p class="py-6 text-center text-sm" style="color: var(--md-on-surface-variant);">
				{$t('user.no_users')}
			</p>
		{:else}
			<div class="flex flex-col gap-1">
				{#each users as u, i (`${u.user}@${u.host ?? '*'}-${i}`)}
					<div
						class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
						style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
					>
						<span class="flex-1 truncate font-mono" style="color: var(--md-on-surface);">
							{userLabel(u)}
						</span>
						<div class="flex shrink-0 items-center gap-0.5">
							<MdButton
								variant="icon"
								size="sm"
								title={$t('user.view_privileges')}
								disabled={isSystemUser(u.user)}
								onclick={() => openPrivileges(u)}
							>
								<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
									<rect
										x="3"
										y="5"
										width="14"
										height="10"
										rx="1.5"
										stroke="currentColor"
										stroke-width="1.5"
									/>
									<path
										d="M7 9h6M7 12h4"
										stroke="currentColor"
										stroke-width="1.2"
										stroke-linecap="round"
									/>
								</svg>
							</MdButton>
							<MdButton
								variant="icon"
								size="sm"
								title={$t('user.grant_revoke')}
								disabled={isSystemUser(u.user)}
								onclick={() => openEditor(u)}
							>
								<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
									<path
										d="M10 4v12M4 10h12"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
									/>
								</svg>
							</MdButton>
							<MdButton
								variant="icon"
								size="sm"
								title={$t('user.change_password')}
								onclick={() => openChangePw(u)}
							>
								<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
									<rect
										x="4"
										y="9"
										width="12"
										height="8"
										rx="1.5"
										stroke="currentColor"
										stroke-width="1.5"
									/>
									<path
										d="M7 9V6a3 3 0 016 0v3"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
									/>
									<circle cx="10" cy="13.5" r="1" fill="currentColor" />
								</svg>
							</MdButton>
							<MdButton
								variant="icon"
								size="sm"
								title={$t('user.delete_user')}
								disabled={isSystemUser(u.user)}
								onclick={() => openDelete(u)}
							>
								<svg width="16" height="16" viewBox="0 0 20 20" fill="none">
									<path
										d="M5 6h10M8 6V4.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V6"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
									<path
										d="M6 6l.7 10.1a1 1 0 001 .9h4.6a1 1 0 001-.9L14 6"
										stroke="currentColor"
										stroke-width="1.3"
									/>
									<path
										d="M9 9v5M11 9v5"
										stroke="currentColor"
										stroke-width="1.2"
										stroke-linecap="round"
									/>
								</svg>
							</MdButton>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</section>

<!-- ── 创建用户 Modal ── -->
<Modal
	open={showCreate}
	title={$t('user.create_user')}
	size="sm"
	onClose={() => (showCreate = false)}
>
	<div class="flex flex-col gap-4">
		{#if isMysql}
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">{$t('user.host')}</span>
				<input class="md-input" type="text" bind:value={createHost} placeholder="%" />
			</label>
		{/if}
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.title')}</span>
			<input class="md-input" type="text" bind:value={createUserVal} placeholder="username" />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.new_password')}</span>
			<input class="md-input" type="password" bind:value={createPassword} />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.confirm_password')}</span>
			<input class="md-input" type="password" bind:value={createConfirm} />
		</label>
	</div>
	{#snippet footer()}
		<MdButton variant="text" onclick={() => (showCreate = false)} disabled={createPending}>
			{$t('common.cancel')}
		</MdButton>
		<MdButton
			variant="filled"
			onclick={submitCreate}
			disabled={createPending || !createUserVal || !createPassword}
		>
			{createPending ? $t('common.creating') : $t('common.create')}
		</MdButton>
	{/snippet}
</Modal>

<!-- ── 授权 Modal ── -->
<Modal
	open={editing !== null}
	title={editing ? $t('user.edit_title', { user: userLabel(editing) }) : ''}
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

		<!-- 已有权限回显 -->
		{#if formGrantsLoading}
			<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
				{$t('common.loading')}
			</p>
		{:else if schemaGrants.length > 0}
			<div class="flex flex-col gap-1">
				<span class="text-xs font-medium" style="color: var(--md-on-surface-variant);">
					{$t('user.privilege_detail', { user: editing ? userLabel(editing) : '' })}
				</span>
				<div
					class="max-h-32 overflow-auto rounded-lg"
					style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
				>
					<table class="w-full text-xs" style="border-collapse: collapse;">
						<thead>
							<tr style="border-bottom: 1px solid var(--md-outline-variant);">
								<th
									class="px-3 py-1.5 text-left font-medium"
									style="color: var(--md-on-surface-variant);">{$t('user.table_col')}</th
								>
								<th
									class="px-3 py-1.5 text-left font-medium"
									style="color: var(--md-on-surface-variant);">{$t('user.privilege_col')}</th
								>
							</tr>
						</thead>
						<tbody>
							{#each schemaGrants as g, i (i)}
								<tr style="border-bottom: 1px solid var(--md-outline-variant);">
									<td class="px-3 py-1 font-mono" style="color: var(--md-on-surface);">{g.table}</td
									>
									<td class="px-3 py-1 font-mono" style="color: var(--md-primary);"
										>{g.privileges}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<div class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.privileges')}</span>
			<div class="grid grid-cols-4 gap-2">
				{#each PRIVILEGES as p (p)}
					{@const checked = formPrivileges.has(p)}
					{@const existed = existingPrivSet().has(p)}
					{@const willGrant = checked && !existed}
					{@const willRevoke = !checked && existed}
					{@const bg = willGrant
						? 'var(--md-success-container)'
						: willRevoke
							? 'var(--md-error-container)'
							: checked
								? 'var(--md-secondary-container)'
								: 'transparent'}
					{@const fg = willGrant
						? 'var(--md-on-success-container)'
						: willRevoke
							? 'var(--md-on-error-container)'
							: checked
								? 'var(--md-on-secondary-container)'
								: 'var(--md-on-surface-variant)'}
					<label
						class="flex items-center gap-2 px-2 py-1.5 text-xs"
						style:background={bg}
						style:color={fg}
						style="border: 1px solid {checked || willRevoke
							? 'transparent'
							: 'var(--md-outline-variant)'}; border-radius: var(--md-radius-sm); cursor: pointer;"
					>
						<input type="checkbox" {checked} onchange={() => togglePriv(p)} />
						{p}
						{#if willGrant}
							<span class="text-[10px] opacity-70">+</span>
						{:else if willRevoke}
							<span class="text-[10px] opacity-70">−</span>
						{/if}
					</label>
				{/each}
			</div>
			<p class="text-[11px]" style="color: var(--md-on-surface-variant);">
				<span
					style="color: var(--md-on-success-container); background: var(--md-success-container); border-radius: 2px; padding: 0 3px;"
					>+</span
				>
				新增 &nbsp;
				<span
					style="color: var(--md-on-error-container); background: var(--md-error-container); border-radius: 2px; padding: 0 3px;"
					>−</span
				>
				移除
			</p>
		</div>
	</div>

	{#snippet footer()}
		<MdButton variant="text" onclick={() => (editing = null)} disabled={formPending}>
			{$t('common.cancel')}
		</MdButton>
		<MdButton variant="filled" onclick={submitGrant} disabled={formPending || !formSchema}>
			{formPending ? $t('common.submitting') : $t('common.save')}
		</MdButton>
	{/snippet}
</Modal>

<!-- ── 查看权限 Modal ── -->
<Modal
	open={viewingPriv !== null}
	title={viewingPriv ? $t('user.privilege_detail', { user: userLabel(viewingPriv) }) : ''}
	size="md"
	onClose={() => (viewingPriv = null)}
>
	{#if privLoading}
		<p class="animate-pulse py-4 text-center text-sm" style="color: var(--md-on-surface-variant);">
			{$t('common.loading')}
		</p>
	{:else if privData.length === 0}
		<p class="py-4 text-center text-sm" style="color: var(--md-on-surface-variant);">
			{$t('user.no_privileges')}
		</p>
	{:else}
		<div class="max-h-80 overflow-auto">
			<table class="w-full text-xs" style="border-collapse: collapse;">
				<thead>
					<tr style="border-bottom: 1px solid var(--md-outline-variant);">
						<th class="px-3 py-2 text-left font-medium" style="color: var(--md-on-surface-variant);"
							>{$t('user.schema_col')}</th
						>
						<th class="px-3 py-2 text-left font-medium" style="color: var(--md-on-surface-variant);"
							>{$t('user.table_col')}</th
						>
						<th class="px-3 py-2 text-left font-medium" style="color: var(--md-on-surface-variant);"
							>{$t('user.privilege_col')}</th
						>
					</tr>
				</thead>
				<tbody>
					{#each privData as row, i (i)}
						{@const r = /** @type {Record<string, unknown>} */ (row)}
						<tr style="border-bottom: 1px solid var(--md-outline-variant);">
							<td class="px-3 py-1.5 font-mono" style="color: var(--md-on-surface);"
								>{r.schema ?? ''}</td
							>
							<td class="px-3 py-1.5 font-mono" style="color: var(--md-on-surface);"
								>{r.table ?? ''}</td
							>
							<td class="px-3 py-1.5 font-mono" style="color: var(--md-primary);"
								>{r.privileges ?? ''}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#snippet footer()}
		<MdButton variant="text" onclick={() => (viewingPriv = null)}>
			{$t('common.close')}
		</MdButton>
	{/snippet}
</Modal>

<!-- ── 修改密码 Modal ── -->
<Modal
	open={changingPw !== null}
	title={changingPw ? $t('user.change_password') + ' · ' + userLabel(changingPw) : ''}
	size="sm"
	onClose={() => (changingPw = null)}
>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.new_password')}</span>
			<input class="md-input" type="password" bind:value={newPassword} />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('user.confirm_password')}</span>
			<input class="md-input" type="password" bind:value={confirmPassword} />
		</label>
	</div>
	{#snippet footer()}
		<MdButton variant="text" onclick={() => (changingPw = null)} disabled={pwPending}>
			{$t('common.cancel')}
		</MdButton>
		<MdButton variant="filled" onclick={submitChangePw} disabled={pwPending || !newPassword}>
			{pwPending ? $t('common.processing') : $t('common.confirm')}
		</MdButton>
	{/snippet}
</Modal>

<!-- ── 删除确认 ── -->
<ConfirmDialog
	open={deleting !== null}
	title={$t('user.delete_user')}
	message={deleting ? $t('user.confirm_delete_msg') : ''}
	confirmText={$t('common.delete')}
	danger={true}
	pending={deletePending}
	onConfirm={confirmDelete}
	onCancel={() => (deleting = null)}
/>
