<script>
	import { goto } from '$app/navigation';
	import { activeConnection } from '$lib/stores/appState.js';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import DataGrid from '$lib/components/DataGrid.svelte';
	import SqlConsole from '$lib/components/SqlConsole.svelte';
	import UserPanel from '$lib/components/UserPanel.svelte';
	import TablePanel from '$lib/components/TablePanel.svelte';
	import TableEditor from '$lib/components/TableEditor.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

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
			tabs = [...tabs, { id, kind: 'users', title: '用户与权限' }];
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

		<button class="md-btn-text" onclick={openSqlTab} disabled={!selectedSchema}>
			SQL 控制台
		</button>
		<button class="md-btn-text" onclick={openUsersTab}>用户</button>
		<ThemeToggle />
		<button class="md-btn-outlined" onclick={disconnect}>断开</button>
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
						从左侧选择表，或打开 SQL / 用户
					</span>
				{:else}
					{#each tabs as t (t.id)}
						<div
							role="tab"
							tabindex="0"
							aria-selected={activeTabId === t.id}
							class="group flex shrink-0 cursor-pointer items-center gap-2 px-3 py-1.5 text-xs transition"
							style:background={activeTabId === t.id ? 'var(--md-surface)' : 'transparent'}
							style:color={activeTabId === t.id ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)'}
							style="border-top: 2px solid {activeTabId === t.id ? 'var(--md-primary)' : 'transparent'}; border-radius: var(--md-radius-xs) var(--md-radius-xs) 0 0;"
							onclick={() => (activeTabId = t.id)}
							onmousedown={(e) => {
								if (e.button === 1) e.preventDefault();
							}}
							onauxclick={(e) => {
								if (e.button === 1) closeTab(t.id, e);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									activeTabId = t.id;
								}
							}}
						>
							{#if t.kind === 'data'}
								<span style="color: var(--md-tertiary-container); filter: brightness(0.7);">▦</span>
							{:else if t.kind === 'sql'}
								<span style="color: var(--md-primary);">⌘</span>
							{:else}
								<span style="color: var(--md-secondary);">◐</span>
							{/if}
							<span class="font-mono">{t.title}</span>
							<button
								type="button"
								class="opacity-50 hover:opacity-100"
								aria-label="关闭"
								onclick={(e) => closeTab(t.id, e)}
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
							<p class="mb-2 text-base">无打开的标签</p>
							<p>点击左侧表节点打开数据视图，或在顶部打开 SQL 控制台。</p>
						</div>
					</div>
				{/if}
				{#each tabs as t (t.id)}
					<div
						class="flex flex-1 flex-col overflow-hidden"
						style:display={activeTabId === t.id ? 'flex' : 'none'}
					>
						{#if t.kind === 'data'}
							{@const sc = schemaConnFor(t.schema)}
							{#if sc}
								<DataGrid schemaConn={sc} schemaName={t.schema} tableName={t.table} reloadKey={reloadKeyFor(t.schema, t.table)} />
							{/if}
						{:else if t.kind === 'sql'}
							{@const sc = schemaConnFor(t.schema)}
							{#if sc}
								<SqlConsole schemaConn={sc} />
							{/if}
						{:else if t.kind === 'users'}
							<UserPanel {baseConn} />
						{/if}
					</div>
				{/each}
			</div>
		</main>
	</div>
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
