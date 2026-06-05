<script>
	import { goto } from '$app/navigation';
	import { activeConnection } from '$lib/stores/appState.js';
	import { showSettings, openSettings } from '$lib/stores/overlayStore.js';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import DataGrid from '$lib/components/DataGrid.svelte';
	import SqlConsole from '$lib/components/SqlConsole.svelte';
	import UserPanel from '$lib/components/UserPanel.svelte';
	import TablePanel from '$lib/components/TablePanel.svelte';
	import TableEditor from '$lib/components/TableEditor.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import MdButton from '$lib/components/MdButton.svelte';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { getSystemInfo } from '$lib/api';
	import { memRefreshSeconds } from '$lib/stores/themeStore.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {{ id: string; kind: 'data'; schema: string; table: string; title: string }
	 *   | { id: string; kind: 'sql'; schema: string; title: string }
	 *   | { id: string; kind: 'users'; title: string }
	 * } Tab
	 */

	let baseConn = $state(/** @type {ConnectionConfig | null} */ (null));
	let selectedSchema = $state('');
	let selectedTable = $state('');

	let tabs = $state(/** @type {Tab[]} */ ([]));
	let activeTabId = $state('');

	let inspectingTable = $state('');
	let inspectingSchema = $state('');
	let creatingTableIn = $state('');

	// 表结构改完后，bump 这个 map 里对应 schema:table 的版本号 → DataGrid 的 reloadKey 变化触发重拉。
	let tableReloadVersion = $state(/** @type {Record<string, number>} */ ({}));

	function reloadKeyFor(schema, table) {
		return tableReloadVersion[`${schema}:${table}`] ?? 0;
	}

	/** @type {Sidebar | null} */
	let sidebarRef = $state(null);

	// JVM 内存信息（按设置的间隔刷新）
	let memUsed = $state(0);
	let memTotal = $state(0);

	$effect(() => {
		const interval = $memRefreshSeconds * 1000;
		function fetchMem() {
			getSystemInfo().then((resp) => {
				if (resp.success && resp.data) {
					const m = /** @type {{ used: number; total: number }} */ (resp.data.memory);
					memUsed = m.used;
					memTotal = m.total;
				}
			}).catch(() => {});
		}
		fetchMem();
		const timer = setInterval(fetchMem, interval);
		return () => clearInterval(timer);
	});

	function formatMB(/** @type {number} */ bytes) {
		return (bytes / 1024 / 1024).toFixed(0);
	}

	// 初始化：从 store 读取连接，无连接则跳回首页
	$effect(() => {
		const unsub = activeConnection.subscribe((conn) => {
			if (!conn) {
				goto('/');
			} else {
				baseConn = conn;
				if (!selectedSchema && conn.database) {
					selectedSchema = conn.database;
				}
			}
		});
		return unsub;
	});

	function disconnect() {
		baseConn = null;
		activeConnection.set(null);
		selectedSchema = '';
		selectedTable = '';
		tabs = [];
		activeTabId = '';
		goto('/');
	}

	function pickSchema(name) {
		selectedSchema = name;
	}

	function pickTable(schema, table) {
		selectedSchema = schema;
		selectedTable = table;
		const id = `data:${schema}:${table}`;
		const exists = tabs.find((t) => t.id === id);
		if (!exists) {
			tabs = [
				...tabs,
				{ id, kind: 'data', schema, table, title: `${schema}.${table}` }
			];
		}
		activeTabId = id;
	}

	function openSqlTab() {
		if (!selectedSchema) return;
		const id = `sql:${selectedSchema}`;
		const exists = tabs.find((t) => t.id === id);
		if (!exists) {
			tabs = [...tabs, { id, kind: 'sql', schema: selectedSchema, title: `SQL · ${selectedSchema}` }];
		}
		activeTabId = id;
	}

	function openUsersTab() {
		const id = 'users';
		const exists = tabs.find((t) => t.id === id);
		if (!exists) {
			tabs = [...tabs, { id, kind: 'users', title: get(t)('workspace.users_tab') }];
		}
		activeTabId = id;
	}

	function closeTab(id, evt) {
		evt?.stopPropagation();
		const idx = tabs.findIndex((t) => t.id === id);
		if (idx < 0) return;
		const next = tabs.filter((t) => t.id !== id);
		tabs = next;
		if (activeTabId === id) {
			activeTabId = next.length > 0 ? next[Math.max(0, idx - 1)].id : '';
		}
	}

	let activeTab = $derived(tabs.find((t) => t.id === activeTabId) ?? null);

	// 用 $derived.by + 内部 Map 做按 schema 的连接缓存，
	// 让传给子组件的 schemaConn 引用稳定 —— 否则每次父级 rerender 都会
	// 触发 DataGrid 内部 $effect 重新拉数据。仅当 baseConn 自身换了才重置。
	let schemaConnFor = $derived.by(() => {
		const conn = baseConn;
		const cache = new Map();
		return (schema) => {
			if (!conn) return null;
			if (!cache.has(schema)) cache.set(schema, { ...conn, database: schema });
			return cache.get(schema);
		};
	});

	function onCreateTable(schema) {
		creatingTableIn = schema;
	}

	function onInspectTable(schema, table) {
		inspectingSchema = schema;
		inspectingTable = table;
	}

	async function onTableCreated(name) {
		const schema = creatingTableIn;
		creatingTableIn = '';
		if (!schema) return;
		await sidebarRef?.refreshTablesIn(schema);
	}

	function onTableDeleted(schema, table) {
		const id = `data:${schema}:${table}`;
		const idx = tabs.findIndex((t) => t.id === id);
		if (idx >= 0) {
			const next = tabs.filter((t) => t.id !== id);
			tabs = next;
			if (activeTabId === id) {
				activeTabId = next.length > 0 ? next[Math.max(0, idx - 1)].id : '';
			}
		}
		if (selectedSchema === schema && selectedTable === table) {
			selectedTable = '';
		}
	}

	async function onTableStructureSaved(schema, table) {
		// 触发 DataGrid 重拉
		const k = `${schema}:${table}`;
		tableReloadVersion = { ...tableReloadVersion, [k]: (tableReloadVersion[k] ?? 0) + 1 };
		// 让侧栏列子节点（已展开的）重新拉
		await sidebarRef?.refreshColumnsOf(schema, table);
	}
</script>

<svelte:head>
	<title>IDB Desktop — {baseConn?.database ?? 'workspace'}</title>
</svelte:head>

{#if baseConn}
<div
	class="flex h-screen flex-col"
	style="background: var(--md-background); color: var(--md-on-background);"
>
	<!-- Top bar -->
	<header
		class="flex shrink-0 items-center gap-3 px-3 py-2"
		style="background: var(--md-surface-container); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-2">
			<span class="text-sm font-semibold tracking-tight" style="color: var(--md-on-surface);">
				idb
			</span>
			<span class="text-xs" style="color: var(--md-on-surface-variant);">·</span>
			<span class="font-mono text-xs" style="color: var(--md-on-surface-variant);">
				{baseConn.driver}://{baseConn.user}@{baseConn.host}:{baseConn.port}
			</span>
			{#if selectedSchema}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">/</span>
				<span class="font-mono text-xs" style="color: var(--md-primary);">{selectedSchema}</span>
			{/if}
		</div>

		<div class="flex-1"></div>

		<MdButton variant="text" onclick={openSqlTab} disabled={!selectedSchema}>
			{$t('workspace.sql_console')}
		</MdButton>
		<MdButton variant="text" onclick={openUsersTab}>{$t('workspace.users')}</MdButton>
		<div class="flex items-center gap-1">
			<ThemeToggle />
			<MdButton variant="icon" onclick={openSettings} title={$t('workspace.settings')}>
				<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
					<path d="M8.325 2.317a1.417 1.417 0 013.35 0 1.417 1.417 0 002.142.866 1.417 1.417 0 012.368 2.368 1.417 1.417 0 00.866 2.142 1.417 1.417 0 010 3.35 1.417 1.417 0 00-.866 2.142 1.417 1.417 0 01-2.368 2.368 1.417 1.417 0 00-2.142.866 1.417 1.417 0 01-3.35 0 1.417 1.417 0 00-2.142-.866 1.417 1.417 0 01-2.368-2.368 1.417 1.417 0 00-.866-2.142 1.417 1.417 0 010-3.35 1.417 1.417 0 00.866-2.142 1.417 1.417 0 012.368-2.368 1.417 1.417 0 002.142-.866z" stroke="currentColor" stroke-width="1.3"/>
					<circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.3"/>
				</svg>
			</MdButton>
		</div>
		<MdButton variant="outlined" onclick={disconnect}>{$t('workspace.disconnect')}</MdButton>
	</header>

	<div class="flex flex-1 overflow-hidden">
		<!-- Sidebar -->
		<Sidebar
			bind:this={sidebarRef}
			{baseConn}
			{selectedSchema}
			{selectedTable}
			onSelectSchema={pickSchema}
			onSelectTable={pickTable}
			{onCreateTable}
			{onInspectTable}
			{onTableDeleted}
		/>

		<!-- Workspace -->
		<main class="flex flex-1 flex-col overflow-hidden">
			<!-- Tab strip -->
			<nav
				class="flex shrink-0 items-end gap-px overflow-x-auto px-2"
				style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
			>
				{#if tabs.length === 0}
					<span class="px-3 py-2 text-xs" style="color: var(--md-on-surface-variant);">
						{$t('workspace.select_table_hint')}
					</span>
				{:else}
					{#each tabs as tab (tab.id)}
						<div
							role="tab"
							tabindex="0"
							aria-selected={activeTabId === tab.id}
							class="group flex shrink-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition"
							style:background={activeTabId === tab.id ? 'var(--md-surface)' : 'transparent'}
							style:color={activeTabId === tab.id ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)'}
							style="border-top: 2px solid {activeTabId === tab.id ? 'var(--md-primary)' : 'transparent'}; border-radius: var(--md-radius-xs) var(--md-radius-xs) 0 0;"
							onclick={() => (activeTabId = tab.id)}
							onmousedown={(e) => {
								if (e.button === 1) e.preventDefault();
							}}
							onauxclick={(e) => {
								if (e.button === 1) closeTab(tab.id, e);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									activeTabId = tab.id;
								}
							}}
						>
							{#if tab.kind === 'data'}
								<span style="color: var(--md-tertiary-container); filter: brightness(0.7);">▦</span>
							{:else if tab.kind === 'sql'}
								<span style="color: var(--md-primary);">⌘</span>
							{:else}
								<span style="color: var(--md-secondary);">◐</span>
							{/if}
							<span class="font-mono">{tab.title}</span>
							<button
								type="button"
								class="opacity-50 hover:opacity-100"
								aria-label={$t('common.close_label')}
								onclick={(e) => closeTab(tab.id, e)}
							>
								✕
							</button>
						</div>
					{/each}
				{/if}
			</nav>

			<!-- Active tab content -->
			<div
				class="flex flex-1 flex-col overflow-hidden"
				style="background: var(--md-surface);"
			>
				{#if !activeTab}
					<div class="flex flex-1 items-center justify-center">
						<div class="text-center text-sm" style="color: var(--md-on-surface-variant);">
							<p class="mb-2 text-base">{$t('workspace.no_tabs')}</p>
							<p>{$t('workspace.no_tabs_hint')}</p>
						</div>
					</div>
				{/if}
				{#each tabs as tab (tab.id)}
					<div
						class="flex flex-1 flex-col overflow-hidden"
						style:display={activeTabId === tab.id ? 'flex' : 'none'}
					>
						{#if tab.kind === 'data'}
							{@const sc = schemaConnFor(tab.schema)}
							{#if sc}
								<DataGrid schemaConn={sc} schemaName={tab.schema} tableName={tab.table} reloadKey={reloadKeyFor(tab.schema, tab.table)} />
							{/if}
						{:else if tab.kind === 'sql'}
							{@const sc = schemaConnFor(tab.schema)}
							{#if sc}
								<SqlConsole schemaConn={sc} />
							{/if}
						{:else if tab.kind === 'users'}
							<UserPanel {baseConn} />
						{/if}
					</div>
				{/each}
			</div>
		</main>
	</div>

	<!-- 底部状态栏：JVM 内存 -->
	<footer
		class="flex shrink-0 items-center justify-end gap-3 px-3 py-1 text-[11px]"
		style="background: var(--md-surface-container-low); border-top: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);"
	>
		{#if memTotal > 0}
			<span>JVM {formatMB(memUsed)} / {formatMB(memTotal)} MB</span>
			<div class="h-1.5 w-24 overflow-hidden rounded-full" style="background: var(--md-surface-container-highest);">
				<div class="h-full rounded-full" style="width: {Math.round(memUsed / memTotal * 100)}%; background: var(--md-primary);"></div>
			</div>
		{/if}
	</footer>
</div>

<!-- 修改表结构弹窗（draft + 保存批量提交） -->
<TablePanel
	open={!!inspectingTable}
	schemaConn={schemaConnFor(inspectingSchema)}
	tableName={inspectingTable}
	onClose={() => {
		inspectingTable = '';
		inspectingSchema = '';
	}}
	onSaved={onTableStructureSaved}
/>

<!-- 新建表 -->
<TableEditor
	open={!!creatingTableIn}
	schemaConn={schemaConnFor(creatingTableIn)}
	schemaName={creatingTableIn}
	onCreated={onTableCreated}
	onClose={() => (creatingTableIn = '')}
/>
{/if}
