<script>
	import { listSchemas, listTables, createSchema, deleteSchema, deleteTable } from '$lib/api';
	import { asStringList, asTableList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

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
	 * } MenuState
	 */
	let menu = $state(/** @type {MenuState | null} */ (null));

	let filter = $state('');

	$effect(() => {
		baseConn;
		void refreshSchemas();
	});

	$effect(() => {
		// 主动展开当前选中的 schema
		if (selectedSchema && !expanded[selectedSchema]) {
			toggle(selectedSchema, true);
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
		} finally {
			loading = { ...loading, [schema]: false };
		}
	}

	async function toggle(schema, force) {
		const target = force === undefined ? !expanded[schema] : force;
		expanded = { ...expanded, [schema]: target };
		if (target && !tablesBySchema[schema]) await loadTables(schema);
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
		const ch = baseConn.driver === 'mysql' ? '`' : '"';
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

	let filteredSchemas = $derived(
		filter ? schemas.filter((s) => s.toLowerCase().includes(filter.toLowerCase())) : schemas
	);

	function tablesIn(schema) {
		const all = tablesBySchema[schema] ?? [];
		if (!filter) return all;
		const f = filter.toLowerCase();
		return all.filter((t) => t.name.toLowerCase().includes(f));
	}
</script>

<aside
	class="flex h-full w-72 shrink-0 flex-col border-r"
	style="background: var(--md-surface-container-low); border-color: var(--md-outline-variant);"
>
	<!-- Sidebar header -->
	<div
		class="flex items-center justify-between gap-2 px-3 py-2.5"
		style="border-bottom: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-2">
			<span class="text-sm" style="color: var(--md-on-surface-variant);">DATABASE</span>
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
								onSelectSchema(s);
								toggle(s, true);
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onSelectSchema(s);
									toggle(s, true);
								}
							}}
							oncontextmenu={(e) => {
								onSelectSchema(s);
								openSchemaMenu(e, s);
							}}
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
										<li>
											<div
												role="button"
												tabindex="0"
												class="group/row flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-left text-xs transition"
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
											</div>
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
{#if menu}
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default"
		style="background: transparent;"
		aria-label="关闭菜单"
		onclick={closeMenu}
		oncontextmenu={(e) => {
			e.preventDefault();
			closeMenu();
		}}
	></button>
	<div
		role="menu"
		class="fixed z-50 flex min-w-[10rem] flex-col py-1 text-xs"
		style:left="{menu.x}px"
		style:top="{menu.y}px"
		style="background: var(--md-surface-container-high); color: var(--md-on-surface); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-sm); box-shadow: var(--md-elev-2);"
	>
		{#if menu.kind === 'schema'}
			{@const schema = menu.schema}
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuRefreshSchema(schema)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">↻</span>
				<span>刷新</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuCreateTable(schema)}
			>
				<span style="color: var(--md-primary); width: 1rem;">＋</span>
				<span>新建表</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuCopySchemaRef(schema)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">⧉</span>
				<span>复制引用</span>
			</button>
			<div style="height: 1px; background: var(--md-outline-variant); margin: 0.25rem 0;"></div>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-error) 12%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuDeleteSchema(schema)}
			>
				<span style="color: var(--md-error); width: 1rem;">✕</span>
				<span style="color: var(--md-error);">删除 schema</span>
			</button>
		{:else}
			{@const schema = menu.schema}
			{@const table = menu.table}
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuOpenTable(schema, table)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">▦</span>
				<span>打开数据</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuInspectTable(schema, table)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">⊞</span>
				<span>查看表字段</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuRefreshSchema(schema)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">↻</span>
				<span>刷新表列表</span>
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-on-surface) 8%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuCopyTableRef(schema, table)}
			>
				<span style="color: var(--md-on-surface-variant); width: 1rem;">⧉</span>
				<span>复制引用</span>
			</button>
			<div style="height: 1px; background: var(--md-outline-variant); margin: 0.25rem 0;"></div>
			<button
				type="button"
				role="menuitem"
				class="flex items-center gap-2 px-3 py-1.5 text-left transition"
				onmouseenter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--md-error) 12%, transparent)')}
				onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
				onclick={() => menuDeleteTable(schema, table)}
			>
				<span style="color: var(--md-error); width: 1rem;">✕</span>
				<span style="color: var(--md-error);">删除表</span>
			</button>
		{/if}
	</div>
{/if}

<svelte:window
	onkeydown={menu ? (e) => { if (e.key === 'Escape') closeMenu(); } : null}
/>
