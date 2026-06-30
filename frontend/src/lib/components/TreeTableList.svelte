<script>
	import { t } from '$lib/i18n';
	import { MdButton } from '$lib/components/ui/index.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {{ name: string; type: string }} TableEntry
	 * @typedef {import('$lib/api').ColumnMeta} ColumnMeta
	 * @typedef {Object} Props
	 * @property {string} database — 当前节点所属 database（用于构造复合 key，避免跨库同名表冲突）
	 * @property {string} schema
	 * @property {TableEntry[]} tables
	 * @property {boolean} loading
	 * @property {string} selectedSchema
	 * @property {string} selectedTable
	 * @property {Record<string, boolean>} tableExpanded
	 * @property {Record<string, ColumnMeta[]>} columnsByTable
	 * @property {Record<string, boolean>} colsLoading
	 * @property {boolean} readOnly
	 * @property {string} filter
	 * @property {(schema: string, table: string) => void} onSelectTable
	 * @property {(schema: string, table: string) => void} onInspectTable
	 * @property {(schema: string, table: string) => void} onDeleteTable
	 * @property {(e: MouseEvent, schema: string, table: string) => void} onTableContextMenu
	 * @property {(database: string, schema: string, table: string) => void} onToggleTable
	 * @property {(e: MouseEvent, schema: string, table: string, column: string) => void} onColumnContextMenu
	 * @property {(column: string) => void} onColumnCopy
	 */

	/** @type {Props} */
	let {
		database,
		schema,
		tables,
		loading,
		selectedSchema,
		selectedTable,
		tableExpanded,
		columnsByTable,
		colsLoading,
		readOnly,
		filter,
		onSelectTable,
		onInspectTable,
		onDeleteTable,
		onTableContextMenu,
		onToggleTable,
		onColumnContextMenu,
		onColumnCopy
	} = $props();

	let filteredTables = $derived(
		filter
			? tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
			: tables
	);

	/** 构造 table 缓存 key：PG 时用 (db, schema, table) 复合 key；MySQL 时 database === schema 退化为单 key */
	function keyOf(table) {
		// 如果 database 与 schema 相同（MySQL 模式），用短 key 与 Sidebar 内部缓存保持一致
		if (!database || database === schema) return `${schema}.${table}`;
		return `${database}::${schema}.${table}`;
	}
</script>

{#if loading}
	<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
		{$t('common.loading')}
	</li>
{:else if filteredTables.length === 0}
	<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
		{filter && tables.length ? $t('sidebar.no_match') : $t('sidebar.empty_schema')}
	</li>
{:else}
	{#each filteredTables as tbl (tbl.name)}
		{@const key = keyOf(tbl.name)}
		<li>
			<div
				role="button"
				tabindex="0"
				class="group/row flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-1 pl-1 text-left text-xs transition"
				style:background={selectedSchema === schema && selectedTable === tbl.name
					? 'var(--md-primary-container)'
					: 'transparent'}
				style:color={selectedSchema === schema && selectedTable === tbl.name
					? 'var(--md-on-primary-container)'
					: 'var(--md-on-surface)'}
				onmouseenter={(e) =>
					!(selectedSchema === schema && selectedTable === tbl.name) &&
					(e.currentTarget.style.background =
						'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
				onmouseleave={(e) =>
					!(selectedSchema === schema && selectedTable === tbl.name) &&
					(e.currentTarget.style.background = 'transparent')}
				onclick={() => onSelectTable(schema, tbl.name)}
				ondblclick={() => onSelectTable(schema, tbl.name)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onSelectTable(schema, tbl.name);
					}
				}}
				oncontextmenu={(e) => onTableContextMenu(e, schema, tbl.name)}
			>
				<span
					class="inline-block w-3 text-center text-[10px] transition-transform"
					style:transform={tableExpanded[key] ? 'rotate(90deg)' : 'rotate(0deg)'}
					onclick={(e) => {
						e.stopPropagation();
						onToggleTable(database, schema, tbl.name);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							e.stopPropagation();
							onToggleTable(database, schema, tbl.name);
						}
					}}
					role="button"
					tabindex="-1"
				>
					▶
				</span>
				<span
					class="text-[10px]"
					style="color: var(--md-tertiary-container); filter: brightness(0.7);"
				>
					{tbl.type === 'VIEW' ? '◈' : '▦'}
				</span>
				<span class="flex-1 truncate font-mono">{tbl.name}</span>
				{#if tbl.type !== 'TABLE'}
					<span class="md-chip">{tbl.type}</span>
				{/if}
				{#if tbl.type !== 'VIEW'}
					<MdButton
						variant="icon"
						class="opacity-0 group-hover/row:opacity-100"
						style="width: 1.125rem; height: 1.125rem;"
						title={$t('sidebar.modify_table')}
						onclick={(e) => {
							e.stopPropagation();
							onInspectTable(schema, tbl.name);
						}}
					>
						<span style="color: var(--md-on-surface-variant); font-size: 0.625rem;">⊞</span>
					</MdButton>
					{#if !readOnly}
						<MdButton
							variant="icon"
							class="opacity-0 group-hover/row:opacity-100"
							style="width: 1.125rem; height: 1.125rem;"
							title={$t('sidebar.delete_table')}
							onclick={(e) => {
								e.stopPropagation();
								onDeleteTable(schema, tbl.name);
							}}
						>
							<span style="color: var(--md-error); font-size: 0.625rem;">✕</span>
						</MdButton>
					{/if}
				{/if}
			</div>

			{#if tableExpanded[key]}
				<ul
					class="ml-5 flex flex-col gap-px border-l"
					style="border-color: var(--md-outline-variant);"
				>
					{#if colsLoading[key]}
						<li
							class="px-3 py-1 text-[11px]"
							style="color: var(--md-on-surface-variant);"
						>
							{$t('common.loading')}
						</li>
					{:else if (columnsByTable[key] ?? []).length === 0}
						<li
							class="px-3 py-1 text-[11px]"
							style="color: var(--md-on-surface-variant);"
						>
							{$t('sidebar.no_columns')}
						</li>
					{:else}
						{#each columnsByTable[key] as c (c.name)}
							<li
								role="button"
								tabindex="0"
								class="flex w-full cursor-default items-center gap-1.5 rounded-md py-0.5 pr-2 pl-2 text-left text-[11px] transition"
								onmouseenter={(e) =>
									(e.currentTarget.style.background =
										'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
								onmouseleave={(e) =>
									(e.currentTarget.style.background = 'transparent')}
								ondblclick={() => onColumnCopy?.(c.name)}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										onColumnCopy?.(c.name);
									}
								}}
								oncontextmenu={(e) => onColumnContextMenu?.(e, schema, tbl.name, c.name)}
								title={`${c.name} : ${c.type}${c.size ? `(${c.size})` : ''}${c.nullable === false ? ' NOT NULL' : ''}${c.isPrimaryKey ? ' PK' : ''}`}
							>
								<span
									class="text-[10px]"
									style:color={c.isPrimaryKey
										? 'var(--md-tertiary)'
										: 'var(--md-on-surface-variant)'}
								>
									{c.isPrimaryKey ? '◆' : '·'}
								</span>
								<span
									class="truncate font-mono"
									style="color: var(--md-on-surface);">{c.name}</span
								>
								<span
									class="ml-auto truncate font-mono text-[10px]"
									style="color: var(--md-on-surface-variant); max-width: 8rem;"
								>
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
