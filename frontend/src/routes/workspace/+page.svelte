<script>
	import { goto } from '$app/navigation';
	import { activeConnection } from '$lib/stores/appState.js';
	import { showSettings, openSettings } from '$lib/stores/overlayStore.js';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import DataGrid from '$lib/components/DataGrid.svelte';
	import SqlConsole from '$lib/components/SqlConsole.svelte';
	import UserPanel from '$lib/components/UserPanel.svelte';
	import DataGeneratorPanel from '$lib/components/DataGeneratorPanel.svelte';
	import DataExportPanel from '$lib/components/DataExportPanel.svelte';
	import FunctionPanel from '$lib/components/FunctionPanel.svelte';
	import TablePanel from '$lib/components/TablePanel.svelte';
	import TableEditor from '$lib/components/TableEditor.svelte';
	import { ThemeToggle, MdButton } from '$lib/components/ui/index.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { getSystemInfo } from '$lib/api';
	import { memRefreshSeconds } from '$lib/stores/themeStore.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {{ id: string; database: string; kind: 'data'; schema: string; table: string; title: string }
	 *   | { id: string; database: string; kind: 'sql'; schema: string; title: string }
	 *   | { id: string; kind: 'users'; title: string }
	 *   | { id: string; database: string; kind: 'generator'; schema: string; title: string }
	 *   | { id: string; database: string; kind: 'routine'; schema: string; name: string; routineType: string; isNew?: boolean; title: string }
	 *   | { id: string; database: string; kind: 'export'; schema: string; title: string }
	 * } Tab
	 */

	let baseConn = $state(/** @type {ConnectionConfig | null} */ (null));
	let selectedDatabase = $state('');  // PostgreSQL 当前选中的数据库
	let selectedSchema = $state('');
	let selectedTable = $state('');

	let tabs = $state(/** @type {Tab[]} */ ([]));
	let activeTabId = $state('');

	let inspectingTable = $state('');
	let inspectingSchema = $state('');
	let inspectingDatabase = $state('');
	let creatingTableIn = $state('');
	let creatingTableDb = $state('');

	// 表结构改完后，bump 这个 map 里对应 db:schema:table 的版本号 → DataGrid 的 reloadKey 变化触发重拉。
	let tableReloadVersion = $state(/** @type {Record<string, number>} */ ({}));

	function reloadKeyFor(database, schema, table) {
		return tableReloadVersion[`${database}:${schema}:${table}`] ?? 0;
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
				if (!selectedSchema && conn.database && conn.driver === 'Mysql') {
					selectedSchema = conn.database;
				}
			}
		});
		return unsub;
	});

	function disconnect() {
		baseConn = null;
		activeConnection.set(null);
		selectedDatabase = '';
		selectedSchema = '';
		selectedTable = '';
		tabs = [];
		activeTabId = '';
		goto('/');
	}

	function pickSchema(database, name) {
		selectedDatabase = database;
		selectedSchema = name;
	}

	/**
	 * @param {string} database
	 * @param {string} schema
	 * @param {string} table
	 */
	function pickTable(database, schema, table) {
		selectedDatabase = database;
		selectedSchema = schema;
		selectedTable = table;
		const id = baseConn?.driver === 'Mysql' ? `${schema}:${table}` : `${database}:${schema}:${table}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database, kind: 'data', schema, table, title: `${schema}.${table}` }];
		}
		activeTabId = id;
	}

	function openSqlTab() {
		if (!selectedSchema) return;
		const db = baseConn?.driver === 'Mysql' ? '' : selectedDatabase;
		const id = baseConn?.driver === 'Mysql' ? `sql:${selectedSchema}` : `sql:${db}:${selectedSchema}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database: db, kind: 'sql', schema: selectedSchema, title: `SQL · ${selectedSchema}` }];
		}
		activeTabId = id;
	}

	function openUsersTab() {
		const id = 'users';
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, kind: 'users', title: get(t)('workspace.users_tab') }];
		}
		activeTabId = id;
	}

	function openGeneratorTab() {
		if (!selectedSchema) return;
		const db = baseConn?.driver === 'Mysql' ? '' : selectedDatabase;
		const id = baseConn?.driver === 'Mysql' ? `generator:${selectedSchema}` : `generator:${db}:${selectedSchema}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database: db, kind: 'generator', schema: selectedSchema, title: get(t)('dg.tab_title', { schema: selectedSchema }) }];
		}
		activeTabId = id;
	}

	/**
	 * 打开函数/存储过程 tab
	 * @param {string} database
	 * @param {string} schema
	 * @param {string} name
	 * @param {string} routineType
	 */
	function pickRoutine(database, schema, name, routineType) {
		selectedDatabase = database;
		selectedSchema = schema;
		const id = `routine:${database}:${schema}:${name}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database, kind: 'routine', schema, name, routineType, title: name }];
		}
		activeTabId = id;
	}

	/**
	 * 创建新的函数/存储过程 tab（新建模式）
	 * @param {string} database
	 * @param {string} schema
	 * @param {'FUNCTION'|'PROCEDURE'} routineType
	 */
	function createRoutine(database, schema, routineType = 'FUNCTION') {
		selectedDatabase = database;
		selectedSchema = schema;
		// 使用 routineType 生成唯一 id，支持同一 schema 下创建多个不同类型
		const id = `routine:new:${routineType}:${database}:${schema}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database, kind: 'routine', schema, name: '', routineType, isNew: true, title: get(t)('routine.new_title', { schema }) }];
		}
		activeTabId = id;
	}

	function openExportTab() {
		if (!selectedSchema) return;
		const db = baseConn?.driver === 'Mysql' ? '' : selectedDatabase;
		const id = baseConn?.driver === 'Mysql' ? `export:${selectedSchema}` : `export:${db}:${selectedSchema}`;
		if (!tabs.find((t) => t.id === id)) {
			tabs = [...tabs, { id, database: db, kind: 'export', schema: selectedSchema, title: get(t)('export.tab_title', { schema: selectedSchema }) }];
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

	// 用 $derived.by + 内部 Map 做按 (database, schema) 的连接缓存，
	// 让传给子组件的 schemaConn 引用稳定 —— 否则每次父级 rerender 都会
	// 触发 DataGrid 内部 $effect 重新拉数据。仅当 baseConn 自身换了才重置。
	let connFor = $derived.by(() => {
		const conn = baseConn;
		const cache = new Map();
		return (db, schema) => {
			if (!conn || !schema) return null;
			const key = `${db}::${schema}`;
			if (!cache.has(key)) {
				cache.set(key, conn.driver === 'Mysql'
					? { ...conn, database: schema }              // MySQL: database === schema
					: { ...conn, database: db, _schema: schema }); // PG: 独立 db + schema
			}
			return cache.get(key);
		};
	});

	/** 当前 sidebar 选中的 database/schema 对应的连接（用于顶部按钮新建的 tab） */
	function connForActive() {
		if (!baseConn) return null;
		if (baseConn.driver === 'Mysql') return connFor('', selectedSchema);
		return connFor(selectedDatabase, selectedSchema);
	}

	function onCreateTable(database, schema) {
		creatingTableDb = database;
		creatingTableIn = schema;
	}

	function onInspectTable(database, schema, table) {
		inspectingDatabase = database;
		inspectingSchema = schema;
		inspectingTable = table;
	}

	async function onTableCreated(name) {
		const schema = creatingTableIn;
		const db = creatingTableDb;
		creatingTableIn = '';
		creatingTableDb = '';
		if (!schema) return;
		await sidebarRef?.refreshTablesIn(db, schema);
	}

	function onTableDeleted(database, schema, table) {
		const id = baseConn?.driver === 'Mysql' ? `data:${schema}:${table}` : `data:${database}:${schema}:${table}`;
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

	async function onTableStructureSaved(database, schema, table) {
		// 触发 DataGrid 重拉
		const k = `${database}:${schema}:${table}`;
		tableReloadVersion = { ...tableReloadVersion, [k]: (tableReloadVersion[k] ?? 0) + 1 };
		// 让侧栏列子节点（已展开的）重新拉
		await sidebarRef?.refreshColumnsOf(database, schema, table);
	}

	/**
	 * Routine 创建成功：刷新 sidebar 中的 routines 列表，
	 * 并把当前新建 tab 切换为该 routine 的查看 tab。
	 * @param {Tab} tab
	 * @param {string} createdName
	 */
	async function onRoutineSaved(tab, createdName) {
		const db = tab.database || '';
		const schema = tab.schema;
		const routineType = /** @type {'FUNCTION'|'PROCEDURE'|'TRIGGER'} */ (tab.routineType);
		// 1) 刷新 sidebar，让新建的 routine 出现在列表里
		await sidebarRef?.refreshRoutinesIn(db, schema);
		if (!createdName) {
			// 解析不出来 DDL 里的名字就保留当前新建 tab，让用户手动关闭
			return;
		}
		// 2) 关闭当前新建 tab
		const next = tabs.filter((t) => t.id !== tab.id);
		// 3) 打开查看 tab（若已存在则复用，避免重复打开）
		const viewId = `routine:${db}:${schema}:${createdName}`;
		if (!next.find((t) => t.id === viewId)) {
			next.push({
				id: viewId,
				database: db,
				kind: 'routine',
				schema,
				name: createdName,
				routineType,
				title: createdName
			});
		}
		tabs = next;
		activeTabId = viewId;
	}

	/**
	 * Routine 删除成功：关闭当前 tab，刷新 sidebar 中的 routines 列表。
	 * @param {Tab} tab
	 */
	async function onRoutineDeleted(tab) {
		const db = tab.database || '';
		const schema = tab.schema;
		// 1) 关闭当前 tab
		const idx = tabs.findIndex((t) => t.id === tab.id);
		const next = tabs.filter((t) => t.id !== tab.id);
		tabs = next;
		if (activeTabId === tab.id) {
			activeTabId = next.length > 0 ? next[Math.max(0, idx - 1)].id : '';
		}
		// 2) 刷新 sidebar
		await sidebarRef?.refreshRoutinesIn(db, schema);
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
			{#if baseConn.driver === 'Postgresql' && selectedDatabase}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">/</span>
				<span class="font-mono text-xs" style="color: var(--md-primary);">{selectedDatabase}</span>
			{/if}
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
		<MdButton variant="text" onclick={() => openGeneratorTab()} disabled={!selectedSchema}>
			{$t('workspace.data_generator')}
		</MdButton>
		<MdButton variant="text" onclick={() => openExportTab()} disabled={!selectedSchema}>
			{$t('workspace.data_export')}
		</MdButton>
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
			onSelectDatabase={(db) => {
				if (selectedDatabase === db) return;
				selectedDatabase = db;
				// 不再清空 tabs，每个 tab 独立记录自己的 db+schema
			}}
			onSelectSchema={pickSchema}
			onSelectTable={pickTable}
			{onCreateTable}
			{onInspectTable}
			{onTableDeleted}
			onOpenGenerator={(db, schema) => {
				selectedDatabase = db;
				selectedSchema = schema;
				openGeneratorTab();
			}}
			onSelectRoutine={pickRoutine}
			onCreateRoutine={createRoutine}
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
							{:else if tab.kind === 'generator'}
								<span style="color: var(--md-tertiary);">⚡</span>
							{:else if tab.kind === 'routine'}
								<span style="color: var(--md-tertiary);">ƒ</span>
							{:else if tab.kind === 'export'}
								<span style="color: var(--md-secondary);">↓</span>
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
							{@const sc = connFor(tab.database, tab.schema)}
							{#if sc}
								<DataGrid schemaConn={sc} schemaName={tab.schema} tableName={tab.table} reloadKey={reloadKeyFor(tab.database, tab.schema, tab.table)} />
							{/if}
						{:else if tab.kind === 'sql'}
							{@const sc = connFor(tab.database, tab.schema)}
							{#if sc}
								<SqlConsole schemaConn={sc} />
							{/if}
						{:else if tab.kind === 'users'}
							<UserPanel {baseConn} />
						{:else if tab.kind === 'generator'}
							{@const sc = connFor(tab.database, tab.schema)}
							{#if sc}
								<DataGeneratorPanel schemaConn={sc} />
							{/if}
						{:else if tab.kind === 'routine'}
							{@const sc = connFor(tab.database, tab.schema)}
							{#if sc}
								<FunctionPanel
									schemaConn={sc}
									name={tab.name}
									routineType={tab.routineType}
									schema={tab.schema}
									isNew={tab.isNew ?? false}
									onSaved={(createdName) => onRoutineSaved(tab, createdName)}
									onDeleted={() => onRoutineDeleted(tab)}
								/>
							{/if}
						{:else if tab.kind === 'export'}
							{@const sc = connFor(tab.database, tab.schema)}
							{#if sc}
								<DataExportPanel schemaConn={sc} />
							{/if}
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
	schemaConn={connFor(inspectingDatabase, inspectingSchema)}
	tableName={inspectingTable}
	onClose={() => {
		inspectingTable = '';
		inspectingSchema = '';
		inspectingDatabase = '';
	}}
	onSaved={(table) => onTableStructureSaved(inspectingDatabase, inspectingSchema, table)}
/>

<!-- 新建表 -->
<TableEditor
	open={!!creatingTableIn}
	schemaConn={connFor(creatingTableDb, creatingTableIn)}
	schemaName={creatingTableIn}
	onCreated={onTableCreated}
	onClose={() => {
		creatingTableIn = '';
		creatingTableDb = '';
	}}
/>
{/if}
