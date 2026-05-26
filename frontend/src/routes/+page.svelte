<script>
	import { activeConnection } from '$lib/stores/appState.js';
	import ConnectionForm from '$lib/components/ConnectionForm.svelte';
	import SchemaPanel from '$lib/components/SchemaPanel.svelte';
	import TablePanel from '$lib/components/TablePanel.svelte';
	import DataGrid from '$lib/components/DataGrid.svelte';
	import SqlConsole from '$lib/components/SqlConsole.svelte';
	import UserPanel from '$lib/components/UserPanel.svelte';

	/** @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig */

	/** 已确认连通的连接（不含 schema 切换的派生）。 @type {ConnectionConfig | null} */
	let baseConn = $state(null);

	/** 当前选中的 schema，作为后续 TABLE/DATA/SQL 操作的目标库。 */
	let selectedSchema = $state('');

	/** 当前选中的表，DATA tab 的目标。 */
	let selectedTable = $state('');

	/** Tab：tables（含表列表与数据网格）/ sql / users */
	let tab = $state(/** @type {'tables' | 'sql' | 'users'} */ ('tables'));

	/** 选中表后内嵌的子视图：list（表列表）| data（行网格） */
	let tableView = $state(/** @type {'list' | 'data'} */ ('list'));

	let schemaConn = $derived(
		baseConn && selectedSchema ? { ...baseConn, database: selectedSchema } : null
	);

	function onConnected(conn) {
		baseConn = conn;
		activeConnection.set(conn);
		selectedSchema = conn.database || '';
		selectedTable = '';
		tab = 'tables';
		tableView = 'list';
	}

	function onPickSchema(name) {
		selectedSchema = name;
		selectedTable = '';
		tableView = 'list';
	}

	function onPickTable(name) {
		selectedTable = name;
		tableView = 'data';
	}

	function disconnect() {
		baseConn = null;
		activeConnection.set(null);
		selectedSchema = '';
		selectedTable = '';
		tab = 'tables';
		tableView = 'list';
	}
</script>

<main class="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-semibold tracking-tight">idb · 数据库浏览</h1>
		{#if baseConn}
			<div class="flex items-center gap-3 text-xs">
				<span class="text-slate-500">
					{baseConn.driver}://{baseConn.user}@{baseConn.host}:{baseConn.port}
					{#if selectedSchema}/ <span class="text-slate-900">{selectedSchema}</span>{/if}
				</span>
				<button
					class="rounded-md border border-slate-200 px-3 py-1 hover:bg-slate-50"
					onclick={disconnect}
				>
					断开
				</button>
			</div>
		{/if}
	</header>

	{#if !baseConn}
		<ConnectionForm {onConnected} />
	{:else}
		<!-- Tab 切换 -->
		<nav class="flex gap-1 border-b border-slate-200 text-sm">
			{#each [{ id: 'tables', label: 'Schemas / Tables' }, { id: 'sql', label: 'SQL 控制台' }, { id: 'users', label: '用户与权限' }] as t (t.id)}
				<button
					class="border-b-2 px-4 py-2 transition
						{tab === t.id
						? 'border-slate-900 font-medium text-slate-900'
						: 'border-transparent text-slate-500 hover:text-slate-900'}"
					onclick={() => (tab = /** @type {any} */ (t.id))}
				>
					{t.label}
				</button>
			{/each}
		</nav>

		{#if tab === 'tables'}
			<SchemaPanel {baseConn} selected={selectedSchema} onSelect={onPickSchema} />

			{#if selectedSchema && schemaConn}
				{#if tableView === 'list'}
					<TablePanel
						{schemaConn}
						schemaName={selectedSchema}
						selected={selectedTable}
						onSelect={onPickTable}
					/>
				{:else if tableView === 'data' && selectedTable}
					<div class="flex items-center gap-2 text-xs text-slate-500">
						<button
							class="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
							onclick={() => {
								tableView = 'list';
								selectedTable = '';
							}}
						>
							← 返回表列表
						</button>
						<span>{selectedSchema} / {selectedTable}</span>
					</div>
					<DataGrid
						{schemaConn}
						schemaName={selectedSchema}
						tableName={selectedTable}
					/>
				{/if}
			{/if}
		{:else if tab === 'sql'}
			{#if schemaConn}
				<SqlConsole {schemaConn} />
			{:else}
				<p class="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
					请先在 Schemas 选项卡选择目标 schema
				</p>
			{/if}
		{:else if tab === 'users'}
			<UserPanel {baseConn} />
		{/if}
	{/if}
</main>
