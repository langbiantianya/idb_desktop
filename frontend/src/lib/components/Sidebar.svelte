<script>
	import { listSchemas, listTables, listColumns, createSchema, deleteSchema, deleteTable } from '$lib/api';
	import { asStringList, asTableList, asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import { untrack } from 'svelte';
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
				err(resp.error ?? '加载 schema 失败');
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
				err(resp.error ?? `加载 ${schema} 表失败`);
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
				err(resp.error ?? `加载 ${schema}.${table} 列失败`);
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
				err(resp.error ?? '创建失败');
				return;
			}
			ok(`已创建 ${name}`);
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
			err(`${name} 是 MySQL 系统库，禁止删除`);
			confirming = null;
			return;
		}
		deletePending = true;
		try {
			const resp = await deleteSchema(baseConn, name);
			if (!resp.success) {
				err(resp.error ?? '删除失败');
				return;
			}
			ok(`已删除 ${name}`);
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
			err(`${schema} 是 MySQL 系统库，禁止删除表`);
			confirmingTable = null;
			return;
		}
		deleteTablePending = true;
		try {
			const resp = await deleteTable({ ...baseConn, database: schema }, table);
			if (!resp.success) {
				err(resp.error ?? '删除表失败');
				return;
			}
			ok(`已删除 ${schema}.${table}`);
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
			ok(`已复制：${text}`);
		} catch (e) {
			err(e instanceof Error ? e.message : '复制失败');
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
				{ label: '刷新', icon: '↻', onClick: () => menuRefreshSchema(menu.schema) }
			];
			if (!ro) items.push({ label: '新建表', icon: '＋', onClick: () => menuCreateTable(menu.schema) });
			items.push({ label: '复制引用', icon: '⧉', onClick: () => menuCopySchemaRef(menu.schema) });
			if (!ro) {
				items.push(null);
				items.push({ label: '删除 schema', icon: '✕', danger: true, onClick: () => menuDeleteSchema(menu.schema) });
			}
			return items;
		}
		if (menu.kind === 'table') {
			const ro = isReadOnlySchema(baseConn, menu.schema);
			const items = [
				{ label: '打开数据', icon: '▦', onClick: () => menuOpenTable(menu.schema, menu.table) },
				{ label: '查看表字段', icon: '⊞', onClick: () => menuInspectTable(menu.schema, menu.table) },
				{ label: '刷新表列表', icon: '↻', onClick: () => menuRefreshSchema(menu.schema) },
				{ label: '复制引用', icon: '⧉', onClick: () => menuCopyTableRef(menu.schema, menu.table) }
			];
			if (!ro) {
				items.push(null);
				items.push({ label: '删除表', icon: '✕', danger: true, onClick: () => menuDeleteTable(menu.schema, menu.table) });
			}
			return items;
		}
		// column
		return [
			{ label: '复制列名', icon: '⧉', onClick: () => menuCopyColumnName(menu.column) },
			{ label: '复制限定引用', icon: '⧉', onClick: () => menuCopyColumnRef(menu.schema, menu.table, menu.column) }
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
				title="展开侧栏"
				aria-label="展开侧栏"
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
					title="折叠侧栏"
					aria-label="折叠侧栏"
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
					title="刷新"
					onclick={refreshSchemas}
					disabled={pending}
				>
					↻
				</button>
				<button
					type="button"
					class="md-icon-btn"
					title="新建 schema"
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
			placeholder="过滤 schema / 表"
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
				{filter ? '无匹配' : '无可见 schema'}
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
								<span class="md-chip" title="MySQL 系统库，只读">RO</span>
							{:else}
								<button
									type="button"
									class="md-icon-btn opacity-0 group-hover:opacity-100"
									style="width: 1.25rem; height: 1.25rem;"
									title="新建表"
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
									title="删除"
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
										加载中…
									</li>
								{:else if tablesIn(s).length === 0}
									<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
										{filter && tablesBySchema[s]?.length ? '无匹配' : '空 schema'}
									</li>
								{:else}
									{#each tablesIn(s) as t (t.name)}
										{@const tk = `${s}.${t.name}`}
										<li>
											<div
												role="button"
												tabindex="0"
												class="group/row flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-1 pl-1 text-left text-xs transition"
												style:background={selectedSchema === s && selectedTable === t.name
													? 'var(--md-primary-container)'
													: 'transparent'}
												style:color={selectedSchema === s && selectedTable === t.name
													? 'var(--md-on-primary-container)'
													: 'var(--md-on-surface)'}
												onmouseenter={(e) =>
													!(selectedSchema === s && selectedTable === t.name) &&
													(e.currentTarget.style.background =
														'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
												onmouseleave={(e) =>
													!(selectedSchema === s && selectedTable === t.name) &&
													(e.currentTarget.style.background = 'transparent')}
												onclick={() => onSelectTable(s, t.name)}
												ondblclick={() => onSelectTable(s, t.name)}
												onkeydown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														onSelectTable(s, t.name);
													}
												}}
												oncontextmenu={(e) => openTableMenu(e, s, t.name)}
											>
												<span
													class="inline-block w-3 text-center text-[10px] transition-transform"
													style:transform={tableExpanded[tk] ? 'rotate(90deg)' : 'rotate(0deg)'}
													onclick={(e) => {
														e.stopPropagation();
														toggleTable(s, t.name);
													}}
													onkeydown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															e.stopPropagation();
															toggleTable(s, t.name);
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
												<span class="flex-1 truncate font-mono">{t.name}</span>
												{#if t.type !== 'TABLE'}
													<span class="md-chip">{t.type}</span>
												{/if}
												<button
													type="button"
													class="md-icon-btn opacity-0 group-hover/row:opacity-100"
													style="width: 1.125rem; height: 1.125rem;"
													title="列结构"
													onclick={(e) => {
														e.stopPropagation();
														onInspectTable?.(s, t.name);
													}}
												>
													<span style="color: var(--md-on-surface-variant); font-size: 0.625rem;">⊞</span>
												</button>
												{#if !isReadOnlySchema(baseConn, s)}
													<button
														type="button"
														class="md-icon-btn opacity-0 group-hover/row:opacity-100"
														style="width: 1.125rem; height: 1.125rem;"
														title="删除表"
														onclick={(e) => {
															e.stopPropagation();
															confirmingTable = { schema: s, table: t.name };
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
															加载中…
														</li>
													{:else if (columnsByTable[tk] ?? []).length === 0}
														<li class="px-3 py-1 text-[11px]" style="color: var(--md-on-surface-variant);">
															无列
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
			aria-label="拖拽调整侧栏宽度"
			title="拖拽调整宽度（双击重置）"
			onmousedown={startResize}
			ondblclick={() => (width = DEFAULT_WIDTH)}
		></button>
	{/if}
</aside>

<!-- 创建 schema -->
<Modal open={creating} title="新建 schema" size="sm" onClose={() => (creating = false)}>
	<label class="flex flex-col gap-1 text-sm">
		<span style="color: var(--md-on-surface-variant);">名称</span>
		<input class="md-input" type="text" bind:value={newName} placeholder="例如 my_db" />
	</label>
	{#snippet footer()}
		<button class="md-btn-text" onclick={() => (creating = false)} disabled={createPending}>
			取消
		</button>
		<button class="md-btn-filled" onclick={doCreate} disabled={createPending || !newName.trim()}>
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

<ConfirmDialog
	open={confirmingTable !== null}
	title="删除表"
	message={confirmingTable
		? `确认删除 ${confirmingTable.schema}.${confirmingTable.table}？该表所有数据将一并丢失，且无法恢复。`
		: ''}
	confirmText="删除"
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
