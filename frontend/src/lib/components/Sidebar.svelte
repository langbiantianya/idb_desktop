<script>
	import { listSchemas, listTables, listColumns, createSchema, deleteSchema, deleteTable, getTableDdl } from '$lib/api';
	import { asStringList, asTableList, asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ContextMenu from './ContextMenu.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {{ name: string; type: string }} TableEntry
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} baseConn
	 * @property {string} selectedSchema
	 * @property {string} selectedTable
	 * @property {(schema: string) => void} onSelectSchema
	 * @property {(schema: string, table: string) => void} onSelectTable
	 * @property {(schema: string) => void} [onCreateTable]
	 * @property {(schema: string, table: string) => void} [onInspectTable]
	 * @property {(schema: string, table: string) => void} [onTableDeleted]
	 */

	/** @type {Props} */
	let {
		baseConn,
		selectedSchema,
		selectedTable,
		onSelectSchema,
		onSelectTable,
		onCreateTable,
		onInspectTable,
		onTableDeleted
	} = $props();

	let schemas = $state(/** @type {string[]} */ ([]));
	let pending = $state(false);

	/** schema -> tables（懒加载） @type {Record<string, TableEntry[]>} */
	let tablesBySchema = $state({});
	/** schema -> 是否展开 @type {Record<string, boolean>} */
	let expanded = $state({});
	/** schema -> 是否正在加载子节点 @type {Record<string, boolean>} */
	let loading = $state({});

	/** "schema.table" -> 列元数据（懒加载） @type {Record<string, import('$lib/api').ColumnMeta[]>} */
	let columnsByTable = $state({});
	/** "schema.table" -> 是否展开列 @type {Record<string, boolean>} */
	let tableExpanded = $state({});
	/** "schema.table" -> 是否正在加载列 @type {Record<string, boolean>} */
	let colsLoading = $state({});

	let creating = $state(false);
	let newName = $state('');
	let createPending = $state(false);

	let confirming = $state(/** @type {string | null} */ (null));
	let deletePending = $state(false);

	let confirmingTable = $state(/** @type {{ schema: string; table: string } | null} */ (null));
	let deleteTablePending = $state(false);

	/**
	 * @typedef {{ x: number; y: number; kind: 'schema'; schema: string }
	 *   | { x: number; y: number; kind: 'table'; schema: string; table: string }
	 *   | { x: number; y: number; kind: 'column'; schema: string; table: string; column: string }
	 * } MenuState
	 */
	let menu = $state(/** @type {MenuState | null} */ (null));

	let filter = $state('');

	// 宽度 / 折叠：折叠时只显示一个展开按钮（约 2.25rem 宽）；展开时默认 18rem，可拖拽 [4rem, 32rem]。
	const MIN_WIDTH = 64; // 4rem，约 2-3 个汉字 / 4-5 个等宽字符
	const MAX_WIDTH = 512;
	const DEFAULT_WIDTH = 288;
	const COLLAPSED_WIDTH = 36;
	let collapsed = $state(false);
	let width = $state(DEFAULT_WIDTH);
	let resizing = $state(false);
	let displayWidth = $derived(collapsed ? COLLAPSED_WIDTH : width);

	function startResize(e) {
		if (collapsed) return;
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startWidth = width;
		const onMove = (ev) => {
			const next = startWidth + (ev.clientX - startX);
			width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, next));
		};
		const onUp = () => {
			resizing = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	function toggleCollapsed() {
		collapsed = !collapsed;
		if (!collapsed && width < MIN_WIDTH) width = DEFAULT_WIDTH;
	}

	$effect(() => {
		baseConn;
		void refreshSchemas();
	});

	$effect(() => {
		// 选中切换到一个新 schema 时自动展开它；但用户手动折叠后不再强行展回（用 untrack 切断对 expanded 的依赖）
		if (selectedSchema) {
			const isExpanded = untrack(() => expanded[selectedSchema]);
			if (!isExpanded) toggle(selectedSchema, true);
		}
	});

	async function refreshSchemas() {
		pending = true;
		try {
			const resp = await listSchemas(baseConn);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.schema_failed'));
				schemas = [];
				return;
			}
			schemas = asStringList(resp.data);
		} finally {
			pending = false;
		}
	}

	async function loadTables(schema) {
		loading = { ...loading, [schema]: true };
		try {
			const resp = await listTables({ ...baseConn, database: schema });
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.tables_failed', { schema }));
				tablesBySchema = { ...tablesBySchema, [schema]: [] };
				return;
			}
			tablesBySchema = { ...tablesBySchema, [schema]: asTableList(resp.data) };
			// 表列表变化时，丢弃该 schema 下所有表的列缓存与展开态，让用户重新展开拉新数据
			const prefix = `${schema}.`;
			const nextCols = { ...columnsByTable };
			const nextTE = { ...tableExpanded };
			let dirty = false;
			for (const k of Object.keys(nextCols)) {
				if (k.startsWith(prefix)) { delete nextCols[k]; dirty = true; }
			}
			for (const k of Object.keys(nextTE)) {
				if (k.startsWith(prefix)) { delete nextTE[k]; dirty = true; }
			}
			if (dirty) {
				columnsByTable = nextCols;
				tableExpanded = nextTE;
			}
		} finally {
			loading = { ...loading, [schema]: false };
		}
	}

	async function toggle(schema, force) {
		const target = force === undefined ? !expanded[schema] : force;
		expanded = { ...expanded, [schema]: target };
		if (target && !tablesBySchema[schema]) await loadTables(schema);
	}

	/** @param {string} schema @param {string} table */
	async function loadColumns(schema, table) {
		const key = `${schema}.${table}`;
		colsLoading = { ...colsLoading, [key]: true };
		try {
			const resp = await listColumns({ ...baseConn, database: schema }, table);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.columns_failed', { schema, table }));
				columnsByTable = { ...columnsByTable, [key]: [] };
				return;
			}
			columnsByTable = { ...columnsByTable, [key]: asColumnList(resp.data) };
		} finally {
			colsLoading = { ...colsLoading, [key]: false };
		}
	}

	/** @param {string} schema @param {string} table @param {boolean} [force] */
	async function toggleTable(schema, table, force) {
		const key = `${schema}.${table}`;
		const target = force === undefined ? !tableExpanded[key] : force;
		tableExpanded = { ...tableExpanded, [key]: target };
		if (target && !columnsByTable[key]) await loadColumns(schema, table);
	}

	async function doCreate() {
		const name = newName.trim();
		if (!name) return;
		createPending = true;
		try {
			const resp = await createSchema(baseConn, name);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.create_failed'));
				return;
			}
			ok(get(t)('sidebar.toast.created', { name }));
			creating = false;
			newName = '';
			await refreshSchemas();
		} finally {
			createPending = false;
		}
	}

	async function doDelete() {
		const name = confirming;
		if (!name) return;
		if (isReadOnlySchema(baseConn, name)) {
			err(get(t)('sidebar.toast.mysql_readonly', { name }));
			confirming = null;
			return;
		}
		deletePending = true;
		try {
			const resp = await deleteSchema(baseConn, name);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.delete_failed'));
				return;
			}
			ok(get(t)('sidebar.toast.deleted', { name }));
			confirming = null;
			if (selectedSchema === name) onSelectSchema('');
			delete tablesBySchema[name];
			delete expanded[name];
			tablesBySchema = { ...tablesBySchema };
			expanded = { ...expanded };
			await refreshSchemas();
		} finally {
			deletePending = false;
		}
	}

	async function doDeleteTable() {
		if (!confirmingTable) return;
		const { schema, table } = confirmingTable;
		if (isReadOnlySchema(baseConn, schema)) {
			err(get(t)('sidebar.toast.mysql_table_readonly', { schema }));
			confirmingTable = null;
			return;
		}
		deleteTablePending = true;
		try {
			const resp = await deleteTable({ ...baseConn, database: schema }, table);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.delete_table_failed'));
				return;
			}
			ok(get(t)('sidebar.toast.table_deleted', { schema, table }));
			confirmingTable = null;
			onTableDeleted?.(schema, table);
			await loadTables(schema);
		} finally {
			deleteTablePending = false;
		}
	}

	export async function refreshTablesIn(schema) {
		await loadTables(schema);
	}

	/**
	 * 强制刷新某张表的列子节点（仅当该子节点已经展开 / 已缓存时；否则跳过）。
	 * @param {string} schema @param {string} table
	 */
	export async function refreshColumnsOf(schema, table) {
		const key = `${schema}.${table}`;
		// 不论是否已展开，都丢弃缓存；下次展开时会重新拉
		if (columnsByTable[key]) {
			const next = { ...columnsByTable };
			delete next[key];
			columnsByTable = next;
		}
		// 已展开则立即重拉
		if (tableExpanded[key]) {
			await loadColumns(schema, table);
		}
	}

	function openSchemaMenu(e, schema) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'schema', schema };
	}

	function openTableMenu(e, schema, table) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'table', schema, table };
	}

	function closeMenu() {
		menu = null;
	}

	async function menuRefreshSchema(schema) {
		closeMenu();
		expanded = { ...expanded, [schema]: true };
		await loadTables(schema);
	}

	function menuInspectTable(schema, table) {
		closeMenu();
		onInspectTable?.(schema, table);
	}

	function menuOpenTable(schema, table) {
		closeMenu();
		onSelectTable(schema, table);
	}

	function menuCreateTable(schema) {
		closeMenu();
		onCreateTable?.(schema);
	}

	function menuDeleteSchema(schema) {
		closeMenu();
		confirming = schema;
	}

	function menuDeleteTable(schema, table) {
		closeMenu();
		confirmingTable = { schema, table };
	}

	function quoteIdent(s) {
		const ch = baseConn.driver === 'Mysql' ? '`' : '"';
		return ch + String(s).replaceAll(ch, ch + ch) + ch;
	}

	async function copyText(text) {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
			} else {
				const ta = document.createElement('textarea');
				ta.value = text;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
			}
			ok(get(t)('sidebar.toast.copied', { text }));
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('common.copy_failed'));
		}
	}

	function menuCopySchemaRef(schema) {
		closeMenu();
		void copyText(quoteIdent(schema));
	}

	function menuCopyTableRef(schema, table) {
		closeMenu();
		void copyText(`${quoteIdent(schema)}.${quoteIdent(table)}`);
	}

	async function menuCopyDdl(schema, table) {
		closeMenu();
		try {
			const conn = { ...baseConn, database: schema };
			const resp = await getTableDdl(conn, table);
			if (resp.success && resp.data) {
				await navigator.clipboard.writeText(String(resp.data));
				ok(get(t)('sidebar.toast.ddl_copied'));
			} else {
				err(resp.error ?? get(t)('sidebar.toast.ddl_failed'));
			}
		} catch (e) {
			err(e instanceof Error ? e.message : get(t)('sidebar.toast.ddl_failed'));
		}
	}

	function openColumnMenu(e, schema, table, column) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: e.clientX, y: e.clientY, kind: 'column', schema, table, column };
	}

	function menuCopyColumnRef(schema, table, column) {
		closeMenu();
		void copyText(`${quoteIdent(schema)}.${quoteIdent(table)}.${quoteIdent(column)}`);
	}

	function menuCopyColumnName(column) {
		closeMenu();
		void copyText(quoteIdent(column));
	}

	let filteredSchemas = $derived(
		filter ? schemas.filter((s) => s.toLowerCase().includes(filter.toLowerCase())) : schemas
	);

	function tablesIn(schema) {
		const all = tablesBySchema[schema] ?? [];
		if (!filter) return all;
		const f = filter.toLowerCase();
		return all.filter((t) => t.name.toLowerCase().includes(f));
	}

	let menuItems = $derived.by(() => {
		if (!menu) return [];
		if (menu.kind === 'schema') {
			const ro = isReadOnlySchema(baseConn, menu.schema);
			const items = [
				{ label: $t('sidebar.refresh'), icon: '↻', onClick: () => menuRefreshSchema(menu.schema) }
			];
			if (!ro) items.push({ label: $t('sidebar.new_table'), icon: '＋', onClick: () => menuCreateTable(menu.schema) });
			items.push({ label: $t('sidebar.copy_ref'), icon: '⧉', onClick: () => menuCopySchemaRef(menu.schema) });
			if (!ro) {
				items.push(null);
				items.push({ label: $t('sidebar.delete_schema'), icon: '✕', danger: true, onClick: () => menuDeleteSchema(menu.schema) });
			}
			return items;
		}
		if (menu.kind === 'table') {
			const ro = isReadOnlySchema(baseConn, menu.schema);
			const items = [
				{ label: $t('sidebar.open_data'), icon: '▦', onClick: () => menuOpenTable(menu.schema, menu.table) },
				{ label: $t('sidebar.modify_table'), icon: '⊞', onClick: () => menuInspectTable(menu.schema, menu.table) },
				{ label: $t('sidebar.refresh_tables'), icon: '↻', onClick: () => menuRefreshSchema(menu.schema) },
				{ label: $t('sidebar.copy_ref'), icon: '⧉', onClick: () => menuCopyTableRef(menu.schema, menu.table) },
				{ label: $t('sidebar.copy_ddl'), icon: '⊕', onClick: () => menuCopyDdl(menu.schema, menu.table) }
			];
			if (!ro) {
				items.push(null);
				items.push({ label: $t('sidebar.delete_table'), icon: '✕', danger: true, onClick: () => menuDeleteTable(menu.schema, menu.table) });
			}
			return items;
		}
		// column
		return [
			{ label: $t('sidebar.copy_column'), icon: '⧉', onClick: () => menuCopyColumnName(menu.column) },
			{ label: $t('sidebar.copy_qualified'), icon: '⧉', onClick: () => menuCopyColumnRef(menu.schema, menu.table, menu.column) }
		];
	});
</script>

<aside
	class="relative flex h-full shrink-0 flex-col border-r"
	style:width="{displayWidth}px"
	style:user-select={resizing ? 'none' : 'auto'}
	style="background: var(--md-surface-container-low); border-color: var(--md-outline-variant);"
>
	{#if collapsed}
		<div
			class="flex h-full flex-col items-center gap-2 py-2"
			style="border-right: none;"
		>
			<button
				type="button"
				class="md-icon-btn"
				title={$t('sidebar.expand')}
				aria-label={$t('sidebar.expand')}
				onclick={toggleCollapsed}
			>
				»
			</button>
			<span class="mt-1 text-[10px] tracking-widest" style="writing-mode: vertical-rl; color: var(--md-on-surface-variant);">DATABASE</span>
		</div>
	{:else}
		<!-- Sidebar header -->
		<div
			class="flex items-center justify-between gap-2 px-3 py-2.5"
			style="border-bottom: 1px solid var(--md-outline-variant);"
		>
			<div class="flex min-w-0 items-center gap-2">
				<button
					type="button"
					class="md-icon-btn"
					title={$t('sidebar.collapse')}
					aria-label={$t('sidebar.collapse')}
					onclick={toggleCollapsed}
				>
					«
				</button>
				<span class="truncate text-sm" style="color: var(--md-on-surface-variant);">DATABASE</span>
				{#if pending}
					<span class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">…</span>
				{/if}
			</div>
			<div class="flex items-center gap-0.5">
				<button
					type="button"
					class="md-icon-btn"
					title={$t('sidebar.refresh')}
					onclick={refreshSchemas}
					disabled={pending}
				>
					↻
				</button>
				<button
					type="button"
					class="md-icon-btn"
					title={$t('sidebar.new_schema')}
					onclick={() => {
						newName = '';
						creating = true;
					}}
				>
					＋
				</button>
			</div>
		</div>

	<!-- Filter -->
	<div class="px-3 py-2">
		<input
			type="text"
			class="md-input w-full text-xs"
			placeholder={$t('sidebar.filter_placeholder')}
			bind:value={filter}
		/>
	</div>

	<!-- Connection node -->
	<div
		class="mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
		style="background: var(--md-surface-container); color: var(--md-on-surface-variant);"
	>
		<span style="color: var(--md-primary);">●</span>
		<span class="truncate font-mono">
			{baseConn.driver}://{baseConn.user}@{baseConn.host}:{baseConn.port}
		</span>
	</div>

	<!-- Schema tree -->
	<div class="flex-1 overflow-auto px-1 pb-3">
		{#if filteredSchemas.length === 0 && !pending}
			<p class="px-3 py-4 text-center text-xs" style="color: var(--md-on-surface-variant);">
				{filter ? $t('sidebar.no_match') : $t('sidebar.no_visible_schema')}
			</p>
		{:else}
			<ul class="flex flex-col gap-px">
				{#each filteredSchemas as s (s)}
					<li>
						<!-- schema row -->
						<div
							role="button"
							tabindex="0"
							class="group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition"
							style:background={selectedSchema === s
								? 'var(--md-secondary-container)'
								: 'transparent'}
							style:color={selectedSchema === s
								? 'var(--md-on-secondary-container)'
								: 'var(--md-on-surface)'}
							onmouseenter={(e) =>
								selectedSchema !== s &&
								(e.currentTarget.style.background =
									'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
							onmouseleave={(e) =>
								selectedSchema !== s && (e.currentTarget.style.background = 'transparent')}
							onclick={() => {
								// 已经选中再次点击 → 折叠 / 展开切换；切换到新 schema 默认展开
								if (selectedSchema === s) {
									toggle(s);
								} else {
									onSelectSchema(s);
									toggle(s, true);
								}
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									if (selectedSchema === s) {
										toggle(s);
									} else {
										onSelectSchema(s);
										toggle(s, true);
									}
								}
							}}
							oncontextmenu={(e) => openSchemaMenu(e, s)}
						>
							<span
								class="inline-block w-3 text-center text-[10px] transition-transform"
								style:transform={expanded[s] ? 'rotate(90deg)' : 'rotate(0deg)'}
								onclick={(e) => {
									e.stopPropagation();
									toggle(s);
								}}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										e.stopPropagation();
										toggle(s);
									}
								}}
								role="button"
								tabindex="-1"
							>
								▶
							</span>
							<span class="text-xs" style="color: var(--md-primary);">DB</span>
							<span class="flex-1 truncate font-mono text-xs">{s}</span>
							{#if isReadOnlySchema(baseConn, s)}
								<span class="md-chip" title={$t('sidebar.ro_readonly')}>RO</span>
							{:else}
								<button
									type="button"
									class="md-icon-btn opacity-0 group-hover:opacity-100"
									style="width: 1.25rem; height: 1.25rem;"
									title={$t('sidebar.new_table')}
									onclick={(e) => {
										e.stopPropagation();
										onCreateTable?.(s);
									}}
								>
									<span style="color: var(--md-primary); font-size: 0.75rem;">＋</span>
								</button>
								<button
									type="button"
									class="md-icon-btn opacity-0 group-hover:opacity-100"
									style="width: 1.25rem; height: 1.25rem;"
									title={$t('common.delete')}
									onclick={(e) => {
										e.stopPropagation();
										confirming = s;
									}}
								>
									<span style="color: var(--md-error); font-size: 0.75rem;">✕</span>
								</button>
							{/if}
						</div>

						<!-- table children -->
						{#if expanded[s]}
							<ul class="ml-6 flex flex-col gap-px border-l" style="border-color: var(--md-outline-variant);">
								{#if loading[s]}
									<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
										{$t('common.loading')}
									</li>
								{:else if tablesIn(s).length === 0}
									<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
										{filter && tablesBySchema[s]?.length ? $t('sidebar.no_match') : $t('sidebar.empty_schema')}
									</li>
								{:else}
									{#each tablesIn(s) as tbl (tbl.name)}
										{@const tk = `${s}.${tbl.name}`}
										<li>
											<div
												role="button"
												tabindex="0"
												class="group/row flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-1 pl-1 text-left text-xs transition"
												style:background={selectedSchema === s && selectedTable === tbl.name
													? 'var(--md-primary-container)'
													: 'transparent'}
												style:color={selectedSchema === s && selectedTable === tbl.name
													? 'var(--md-on-primary-container)'
													: 'var(--md-on-surface)'}
												onmouseenter={(e) =>
													!(selectedSchema === s && selectedTable === tbl.name) &&
													(e.currentTarget.style.background =
														'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
												onmouseleave={(e) =>
													!(selectedSchema === s && selectedTable === tbl.name) &&
													(e.currentTarget.style.background = 'transparent')}
												onclick={() => onSelectTable(s, tbl.name)}
												ondblclick={() => onSelectTable(s, tbl.name)}
												onkeydown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														onSelectTable(s, tbl.name);
													}
												}}
												oncontextmenu={(e) => openTableMenu(e, s, tbl.name)}
											>
												<span
													class="inline-block w-3 text-center text-[10px] transition-transform"
													style:transform={tableExpanded[tk] ? 'rotate(90deg)' : 'rotate(0deg)'}
													onclick={(e) => {
														e.stopPropagation();
														toggleTable(s, tbl.name);
													}}
													onkeydown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															e.stopPropagation();
															toggleTable(s, tbl.name);
														}
													}}
													role="button"
													tabindex="-1"
												>
													▶
												</span>
												<span class="text-[10px]" style="color: var(--md-tertiary-container); filter: brightness(0.7);">
													▦
												</span>
												<span class="flex-1 truncate font-mono">{tbl.name}</span>
												{#if tbl.type !== 'TABLE'}
													<span class="md-chip">{tbl.type}</span>
												{/if}
												<button
													type="button"
													class="md-icon-btn opacity-0 group-hover/row:opacity-100"
													style="width: 1.125rem; height: 1.125rem;"
													title={$t('sidebar.modify_table')}
													onclick={(e) => {
														e.stopPropagation();
														onInspectTable?.(s, tbl.name);
													}}
												>
													<span style="color: var(--md-on-surface-variant); font-size: 0.625rem;">⊞</span>
												</button>
												{#if !isReadOnlySchema(baseConn, s)}
													<button
														type="button"
														class="md-icon-btn opacity-0 group-hover/row:opacity-100"
														style="width: 1.125rem; height: 1.125rem;"
														title={$t('sidebar.delete_table')}
														onclick={(e) => {
															e.stopPropagation();
															confirmingTable = { schema: s, table: tbl.name };
														}}
													>
														<span style="color: var(--md-error); font-size: 0.625rem;">✕</span>
													</button>
												{/if}
											</div>

											{#if tableExpanded[tk]}
												<ul class="ml-5 flex flex-col gap-px border-l" style="border-color: var(--md-outline-variant);">
													{#if colsLoading[tk]}
														<li class="px-3 py-1 text-[11px]" style="color: var(--md-on-surface-variant);">
															{$t('common.loading')}
														</li>
													{:else if (columnsByTable[tk] ?? []).length === 0}
														<li class="px-3 py-1 text-[11px]" style="color: var(--md-on-surface-variant);">
															{$t('sidebar.no_columns')}
														</li>
													{:else}
														{#each columnsByTable[tk] as c (c.name)}
															<li
																role="button"
																tabindex="0"
																class="flex w-full cursor-default items-center gap-1.5 rounded-md py-0.5 pr-2 pl-2 text-left text-[11px] transition"
																onmouseenter={(e) =>
																	(e.currentTarget.style.background =
																		'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
																onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
																ondblclick={() => void copyText(quoteIdent(c.name))}
																onkeydown={(e) => {
																	if (e.key === 'Enter') {
																		e.preventDefault();
																		void copyText(quoteIdent(c.name));
																	}
																}}
																oncontextmenu={(e) => openColumnMenu(e, s, t.name, c.name)}
																title={`${c.name} : ${c.type}${c.size ? `(${c.size})` : ''}${c.nullable === false ? ' NOT NULL' : ''}${c.isPrimaryKey ? ' PK' : ''}`}
															>
																<span class="text-[10px]" style:color={c.isPrimaryKey ? 'var(--md-tertiary)' : 'var(--md-on-surface-variant)'}>
																	{c.isPrimaryKey ? '◆' : '·'}
																</span>
																<span class="truncate font-mono" style="color: var(--md-on-surface);">{c.name}</span>
																<span class="ml-auto truncate font-mono text-[10px]" style="color: var(--md-on-surface-variant); max-width: 8rem;">
																	{c.type}{c.size ? `(${c.size})` : ''}
																</span>
															</li>
														{/each}
													{/if}
												</ul>
											{/if}
										</li>
									{/each}
								{/if}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{/if}

	{#if !collapsed}
		<button
			type="button"
			class="resize-handle"
			aria-label={$t('sidebar.resize_aria')}
			title={$t('sidebar.resize_hint')}
			onmousedown={startResize}
			ondblclick={() => (width = DEFAULT_WIDTH)}
		></button>
	{/if}
</aside>

<!-- 创建 schema -->
<Modal open={creating} title={$t('sidebar.new_schema')} size="sm" onClose={() => (creating = false)}>
	<label class="flex flex-col gap-1 text-sm">
		<span style="color: var(--md-on-surface-variant);">{$t('sidebar.name_label')}</span>
		<input class="md-input" type="text" bind:value={newName} placeholder={$t('sidebar.name_placeholder')} />
	</label>
	{#snippet footer()}
		<button class="md-btn-text" onclick={() => (creating = false)} disabled={createPending}>
			{$t('common.cancel')}
		</button>
		<button class="md-btn-filled" onclick={doCreate} disabled={createPending || !newName.trim()}>
			{createPending ? $t('common.creating') : $t('common.create')}
		</button>
	{/snippet}
</Modal>

<ConfirmDialog
	open={confirming !== null}
	title={$t('sidebar.dialog.delete_schema_title')}
	message={confirming ? $t('sidebar.dialog.delete_schema_msg', { name: confirming }) : ''}
	confirmText={$t('common.delete')}
	danger
	pending={deletePending}
	onConfirm={doDelete}
	onCancel={() => (confirming = null)}
/>

<ConfirmDialog
	open={confirmingTable !== null}
	title={$t('sidebar.dialog.delete_table_title')}
	message={confirmingTable
		? $t('sidebar.dialog.delete_table_msg', { schema: confirmingTable.schema, table: confirmingTable.table })
		: ''}
	confirmText={$t('common.delete')}
	danger
	pending={deleteTablePending}
	onConfirm={doDeleteTable}
	onCancel={() => (confirmingTable = null)}
/>

<!-- 右键菜单 -->
<ContextMenu
	open={menu ? { x: menu.x, y: menu.y, items: menuItems } : null}
	onClose={closeMenu}
/>

<style>
	.resize-handle {
		position: absolute;
		top: 0;
		right: -3px;
		width: 6px;
		height: 100%;
		padding: 0;
		background: transparent;
		border: none;
		cursor: col-resize;
		z-index: 10;
	}
	.resize-handle:hover,
	.resize-handle:active {
		background: color-mix(in srgb, var(--md-primary) 24%, transparent);
	}
</style>
