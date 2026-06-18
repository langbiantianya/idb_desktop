<script>
	import {
		listSchemas,
		listTables,
		listColumns,
		createSchema,
		deleteSchema,
		deleteTable,
		getTableDdl
	} from '$lib/api';
	import { asStringList, asTableList, asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { isReadOnlySchema } from '$lib/readonly.js';
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import ContextMenu from './ContextMenu.svelte';
	import MdButton from './MdButton.svelte';
	import Combobox from './Combobox.svelte';
	import TreeTableList from './TreeTableList.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {{ name: string; type: string }} TableEntry
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} baseConn
	 * @property {string} selectedSchema
	 * @property {string} selectedTable
	 * @property {(db: string) => void} onSelectDatabase
	 * @property {(database: string, schema: string) => void} onSelectSchema — MySQL 时 database === schema
	 * @property {(database: string, schema: string, table: string) => void} onSelectTable
	 * @property {(database: string, schema: string) => void} [onCreateTable]
	 * @property {(database: string, schema: string, table: string) => void} [onInspectTable]
	 * @property {(database: string, schema: string, table: string) => void} [onTableDeleted]
	 * @property {(database: string, schema: string) => void} [onOpenGenerator]
	 */

	/** @type {Props} */
	let {
		baseConn,
		selectedDatabase,
		selectedSchema,
		selectedTable,
		onSelectDatabase,
		onSelectSchema,
		onSelectTable,
		onCreateTable,
		onInspectTable,
		onTableDeleted,
		onOpenGenerator
	} = $props();

	let isPg = $derived(baseConn.driver === 'Postgresql');
	let isMysql = $derived(baseConn.driver === 'Mysql');
	let pending = $state(false);

	// 顶层节点列表
	/** MySQL: databases（= schemas）；PG: databases */
	let databases = $state(/** @type {string[]} */ ([]));

	// PG: db → schema[]
	let schemasByDb = $state(/** @type {Record<string, string[]>} */ ({}));
	/** db → 是否展开 @type {Record<string, boolean>} */
	let dbExpanded = $state({});
	/** db → 是否正在加载 schema 列表 @type {Record<string, boolean>} */
	let dbLoading = $state({});

	// schema -> tables（懒加载） @type {Record<string, TableEntry[]>} */
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
	let newCharset = $state('utf8mb4');
	let newCollate = $state('utf8mb4_unicode_ci');
	let createPending = $state(false);

	// MySQL 常见 charset → collation 映射
	const CHARSET_OPTIONS = ['utf8mb4', 'utf8', 'latin1', 'ascii', 'utf16', 'binary'];
	const COLLATE_MAP = {
		utf8mb4: ['utf8mb4_unicode_ci', 'utf8mb4_general_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin'],
		utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
		latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
		ascii: ['ascii_general_ci', 'ascii_bin'],
		utf16: ['utf16_general_ci', 'utf16_unicode_ci', 'utf16_bin'],
		binary: ['binary']
	};
	let collateOptions = $derived(COLLATE_MAP[newCharset] || []);

	// charset 切换时重置 collate 为该 charset 的首个选项
	$effect(() => {
		if (newCharset && collateOptions.length > 0 && !collateOptions.includes(newCollate)) {
			newCollate = collateOptions[0];
		}
	});

	let confirming = $state(/** @type {string | null} */ (null));
	let deletePending = $state(false);

	let confirmingTable = $state(/** @type {{ database: string; schema: string; table: string } | null} */ (null));
	let deleteTablePending = $state(false);

	/** PG 当前活跃数据库（用于连接构造） */
	let activeDb = $derived.by(() => {
		if (!isPg) return baseConn.database;
		// 找到第一个已展开的数据库
		for (const [db, exp] of Object.entries(dbExpanded)) {
			if (exp) return db;
		}
		return baseConn.database || '';
	});

	/** PG 连接用的数据库名 */
	let pgDb = $derived(activeDb || 'postgres');

	/**
	 * 当前节点对应的 database（用于回调）。MySQL 时 database === schema。
	 * @param {string} schema
	 * @returns {string}
	 */
	function dbFor(schema) {
		return isPg ? activeDb : schema;
	}

	/**
	 * 是否高亮：MySQL 只看 schema；PG 要求 db + schema 同时匹配
	 * @param {string} db
	 * @param {string} schema
	 * @returns {boolean}
	 */
	function isSchemaSelected(db, schema) {
		if (isPg) return selectedDatabase === db && selectedSchema === schema;
		return selectedSchema === schema;
	}

	// 复合 key：PG 用 db::schema 避免同名 schema 跨库冲突，MySQL 保持 schema
	/**
	 * @param {string} db
	 * @param {string} schema
	 * @returns {string}
	 */
	function sk(db, schema) {
		return isPg ? `${db}::${schema}` : schema;
	}
	/**
	 * @param {string} db
	 * @param {string} schema
	 * @param {string} table
	 * @returns {string}
	 */
	function tk(db, schema, table) {
		return isPg ? `${db}::${schema}.${table}` : `${schema}.${table}`;
	}

	/**
	 * @typedef {{ x: number; y: number; kind: 'database'; database: string }
	 *   | { x: number; y: number; kind: 'schema'; schema: string }
	 *   | { x: number; y: number; kind: 'table'; schema: string; table: string }
	 *   | { x: number; y: number; kind: 'column'; schema: string; table: string; column: string }
	 * } MenuState
	 */
	let menu = $state(/** @type {MenuState | null} */ (null));

	let filter = $state('');

	// 宽度 / 折叠
	const MIN_WIDTH = 64;
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
			// PG: 遍历所有展开的 db，找包含此 schema 的那个；MySQL: 直接用 schema 名
			let isExpanded = false;
			untrack(() => {
				if (isPg) {
					for (const db of Object.keys(dbExpanded)) {
						if (dbExpanded[db] && expanded[sk(db, selectedSchema)]) {
							isExpanded = true;
							break;
						}
					}
				} else {
					isExpanded = !!expanded[selectedSchema];
				}
			});
			if (!isExpanded) {
				if (isPg) {
					// PG: 找到当前展开且包含该 schema 的 db 并展开
					for (const db of Object.keys(dbExpanded)) {
						if (dbExpanded[db] && (schemasByDb[db] ?? []).includes(selectedSchema)) {
							toggle(db, selectedSchema, true);
							break;
						}
					}
				} else {
					toggle('', selectedSchema, true);
				}
			}
		}
	});

	async function refreshSchemas() {
		pending = true;
		try {
			// PG: 连接到默认库拉取数据库列表；MySQL: 直接拉取 database/schema 列表
			const conn = isPg ? { ...baseConn, database: baseConn.database || 'postgres' } : baseConn;
			const resp = await listSchemas(conn);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.schema_failed'));
				databases = [];
				return;
			}
			databases = asStringList(resp.data);
		} finally {
			pending = false;
		}
	}

	/** 展开数据库节点：PG 加载 schema 列表（支持多库同时展开，不清空其他库状态），MySQL 直接加载表 */
	async function toggleDb(db, force) {
		const target = force === undefined ? !dbExpanded[db] : force;
		if (target) {
			dbExpanded = { ...dbExpanded, [db]: true };
			// 通知 workspace 更新侧栏高亮用的 selectedDatabase
			onSelectDatabase?.(db);
		} else {
			dbExpanded = { ...dbExpanded, [db]: false };
			return;
		}
		if (isPg) {
			// PG: 懒加载该库的 schema 列表（不清空其他已展开库的状态）
			if (schemasByDb[db]) return;
			dbLoading = { ...dbLoading, [db]: true };
			try {
				const resp = await listSchemas({ ...baseConn, database: db }, { database: db });
				if (!resp.success) {
					err(resp.error ?? get(t)('sidebar.toast.schema_failed'));
					schemasByDb = { ...schemasByDb, [db]: [] };
					return;
				}
				schemasByDb = { ...schemasByDb, [db]: asStringList(resp.data) };
			} finally {
				dbLoading = { ...dbLoading, [db]: false };
			}
		} else {
			// MySQL: database 即 schema，直接加载表
			if (!tablesBySchema[db]) await loadTables(db, db);
		}
	}

	async function loadTables(db, schema) {
		const key = sk(db, schema);
		loading = { ...loading, [key]: true };
		try {
			const conn = isPg ? { ...baseConn, database: db, _schema: schema } : { ...baseConn, database: schema };
			const resp = await listTables(conn);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.tables_failed', { schema }));
				tablesBySchema = { ...tablesBySchema, [key]: [] };
				return;
			}
			tablesBySchema = { ...tablesBySchema, [key]: asTableList(resp.data) };
			// 表列表变化时，丢弃该 schema 下所有表的列缓存与展开态
			const prefix = isPg ? `${db}::${schema}.` : `${schema}.`;
			const nextCols = { ...columnsByTable };
			const nextTE = { ...tableExpanded };
			const nextColsLoading = { ...colsLoading };
			let dirty = false;
			for (const k of Object.keys(nextCols)) {
				if (k.startsWith(prefix)) {
					delete nextCols[k];
					dirty = true;
				}
			}
			for (const k of Object.keys(nextTE)) {
				if (k.startsWith(prefix)) {
					delete nextTE[k];
					dirty = true;
				}
			}
			for (const k of Object.keys(nextColsLoading)) {
				if (k.startsWith(prefix)) {
					delete nextColsLoading[k];
					dirty = true;
				}
			}
			if (dirty) {
				columnsByTable = nextCols;
				tableExpanded = nextTE;
				colsLoading = nextColsLoading;
			}
		} finally {
			loading = { ...loading, [key]: false };
		}
	}

	async function toggle(db, schema, force) {
		const key = sk(db, schema);
		const target = force === undefined ? !expanded[key] : force;
		expanded = { ...expanded, [key]: target };
		if (target && !tablesBySchema[key]) await loadTables(db, schema);
	}

	/** @param {string} db @param {string} schema @param {string} table */
	async function loadColumns(db, schema, table) {
		const key = tk(db, schema, table);
		colsLoading = { ...colsLoading, [key]: true };
		try {
			const conn = isPg ? { ...baseConn, database: db, _schema: schema } : { ...baseConn, database: schema };
			const resp = await listColumns(conn, table);
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

	/** @param {string} db @param {string} schema @param {string} table @param {boolean} [force] */
	async function toggleTable(db, schema, table, force) {
		const key = tk(db, schema, table);
		const target = force === undefined ? !tableExpanded[key] : force;
		tableExpanded = { ...tableExpanded, [key]: target };
		if (target && !columnsByTable[key]) await loadColumns(db, schema, table);
	}

	async function doCreate() {
		const name = newName.trim();
		if (!name) return;
		createPending = true;
		try {
			const opts = isMysql ? { charset: newCharset, collate: newCollate } : undefined;
			const resp = await createSchema(baseConn, name, opts);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.create_failed'));
				return;
			}
			ok(get(t)('sidebar.toast.created', { name }));
			creating = false;
			newName = '';
			newCharset = 'utf8mb4';
			newCollate = 'utf8mb4_unicode_ci';
			if (isPg && activeDb) {
				// 刷新当前展开数据库的 schema 列表
				delete schemasByDb[activeDb];
				schemasByDb = { ...schemasByDb };
				await toggleDb(activeDb, true);
			} else {
				await refreshSchemas();
			}
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
			if (selectedSchema === name) onSelectSchema(isPg ? activeDb : name, '');
			// 清除该 schema 的缓存（MySQL 时按 schema 自身；PG 时清空所有相关 db 的缓存）
			if (isPg) {
				for (const db of Object.keys(dbExpanded)) {
					const key = sk(db, name);
					delete tablesBySchema[key];
					delete expanded[key];
					delete loading[key];
				}
			} else {
				delete tablesBySchema[name];
				delete expanded[name];
				delete loading[name];
			}
			tablesBySchema = { ...tablesBySchema };
			expanded = { ...expanded };
			loading = { ...loading };
			if (isPg && activeDb) {
				delete schemasByDb[activeDb];
				schemasByDb = { ...schemasByDb };
				await toggleDb(activeDb, true);
			} else {
				await refreshSchemas();
			}
		} finally {
			deletePending = false;
		}
	}

	async function doDeleteTable() {
		if (!confirmingTable) return;
		const { database, schema, table } = confirmingTable;
		if (isReadOnlySchema(baseConn, schema)) {
			err(get(t)('sidebar.toast.mysql_table_readonly', { schema }));
			confirmingTable = null;
			return;
		}
		deleteTablePending = true;
		try {
			const conn = isPg ? { ...baseConn, database, _schema: schema } : { ...baseConn, database: schema };
			const resp = await deleteTable(conn, table);
			if (!resp.success) {
				err(resp.error ?? get(t)('sidebar.toast.delete_table_failed'));
				return;
			}
			ok(get(t)('sidebar.toast.table_deleted', { schema, table }));
			confirmingTable = null;
			onTableDeleted?.(database, schema, table);
			await loadTables(database, schema);
		} finally {
			deleteTablePending = false;
		}
	}

	export async function refreshTablesIn(db, schema) {
		await loadTables(db, schema);
	}

	/**
	 * 强制刷新某张表的列子节点（仅当该子节点已经展开 / 已缓存时；否则跳过）。
	 * @param {string} db
	 * @param {string} schema
	 * @param {string} table
	 */
	export async function refreshColumnsOf(db, schema, table) {
		const key = tk(db, schema, table);
		if (columnsByTable[key]) {
			const next = { ...columnsByTable };
			delete next[key];
			columnsByTable = next;
		}
		if (tableExpanded[key]) {
			await loadColumns(db, schema, table);
		}
	}

	// ---- 菜单 ----
	function openDatabaseMenu(e, database) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'database', database };
	}

	function openSchemaMenu(e, schema) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'schema', schema };
	}

	function openTableMenu(e, schema, table) {
		e.preventDefault();
		menu = { x: e.clientX, y: e.clientY, kind: 'table', schema, table };
	}

	function openColumnMenu(e, schema, table, column) {
		e.preventDefault();
		e.stopPropagation();
		menu = { x: e.clientX, y: e.clientY, kind: 'column', schema, table, column };
	}

	function closeMenu() {
		menu = null;
	}

	async function menuRefreshSchema(schema) {
		closeMenu();
		const db = dbFor(schema);
		const key = sk(db, schema);
		expanded = { ...expanded, [key]: true };
		await loadTables(db, schema);
	}

	async function menuRefreshDatabase(db) {
		closeMenu();
		// 强制重载：清除缓存后重新展开
		if (isPg) {
			delete schemasByDb[db];
			schemasByDb = { ...schemasByDb };
		}
		await toggleDb(db, true);
	}

	function menuInspectTable(schema, table) {
		closeMenu();
		onInspectTable?.(dbFor(schema), schema, table);
	}

	function menuOpenTable(schema, table) {
		closeMenu();
		onSelectTable(dbFor(schema), schema, table);
	}

	function menuOpenGenerator(schema) {
		closeMenu();
		onOpenGenerator?.(dbFor(schema), schema);
	}

	function menuCreateTable(schema) {
		closeMenu();
		onCreateTable?.(dbFor(schema), schema);
	}

	function menuDeleteSchema(schema) {
		closeMenu();
		confirming = schema;
	}

	function menuDeleteTable(schema, table) {
		closeMenu();
		confirmingTable = { database: dbFor(schema), schema, table };
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
			const conn = isPg ? { ...baseConn, database: pgDb, _schema: schema } : { ...baseConn, database: schema };
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

	function menuCopyColumnRef(schema, table, column) {
		closeMenu();
		void copyText(`${quoteIdent(schema)}.${quoteIdent(table)}.${quoteIdent(column)}`);
	}

	function menuCopyColumnName(column) {
		closeMenu();
		void copyText(quoteIdent(column));
	}

	// ---- 派生：过滤后的列表 ----
	let filteredDatabases = $derived(
		filter ? databases.filter((s) => s.toLowerCase().includes(filter.toLowerCase())) : databases
	);

	let menuItems = $derived.by(() => {
		if (!menu) return [];
		if (menu.kind === 'database') {
			return [
				{ label: $t('sidebar.refresh'), icon: '↻', onClick: () => menuRefreshDatabase(menu.database) }
			];
		}
		if (menu.kind === 'schema') {
			const ro = isReadOnlySchema(baseConn, menu.schema);
			const items = [
				{ label: $t('sidebar.refresh'), icon: '↻', onClick: () => menuRefreshSchema(menu.schema) }
			];
			if (!ro)
				items.push({
					label: $t('sidebar.new_table'),
					icon: '＋',
					onClick: () => menuCreateTable(menu.schema)
				});
			items.push({
				label: $t('sidebar.copy_ref'),
				icon: '⧉',
				onClick: () => menuCopySchemaRef(menu.schema)
			});
			if (!ro && isMysql) {
				items.push(null);
				items.push({
					label: $t('sidebar.delete_schema'),
					icon: '✕',
					danger: true,
					onClick: () => menuDeleteSchema(menu.schema)
				});
			}
			return items;
		}
		if (menu.kind === 'table') {
			const ro = isReadOnlySchema(baseConn, menu.schema);
			const items = [
				{
					label: $t('sidebar.open_data'),
					icon: '▦',
					onClick: () => menuOpenTable(menu.schema, menu.table)
				},
				{
					label: $t('sidebar.modify_table'),
					icon: '⊞',
					onClick: () => menuInspectTable(menu.schema, menu.table)
				},
				{
					label: $t('sidebar.data_generator'),
					icon: '⚡',
					onClick: () => menuOpenGenerator(menu.schema)
				},
				{
					label: $t('sidebar.refresh_tables'),
					icon: '↻',
					onClick: () => menuRefreshSchema(menu.schema)
				},
				{
					label: $t('sidebar.copy_ref'),
					icon: '⧉',
					onClick: () => menuCopyTableRef(menu.schema, menu.table)
				},
				{
					label: $t('sidebar.copy_ddl'),
					icon: '⊕',
					onClick: () => menuCopyDdl(menu.schema, menu.table)
				}
			];
			if (!ro) {
				items.push(null);
				items.push({
					label: $t('sidebar.delete_table'),
					icon: '✕',
					danger: true,
					onClick: () => menuDeleteTable(menu.schema, menu.table)
				});
			}
			return items;
		}
		// column
		return [
			{
				label: $t('sidebar.copy_column'),
				icon: '⧉',
				onClick: () => menuCopyColumnName(menu.column)
			},
			{
				label: $t('sidebar.copy_qualified'),
				icon: '⧉',
				onClick: () => menuCopyColumnRef(menu.schema, menu.table, menu.column)
			}
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
		<div class="flex h-full flex-col items-center gap-2 py-2" style="border-right: none;">
			<MdButton
				variant="icon"
				title={$t('sidebar.expand')}
				ariaLabel={$t('sidebar.expand')}
				onclick={toggleCollapsed}
			>
				»
			</MdButton>
			<span
				class="mt-1 text-[10px] tracking-widest"
				style="writing-mode: vertical-rl; color: var(--md-on-surface-variant);">{isPg ? 'DATABASE' : 'DATABASE'}</span
			>
		</div>
	{:else}
		<!-- Sidebar header -->
		<div
			class="flex items-center justify-between gap-2 px-3 py-2.5"
			style="border-bottom: 1px solid var(--md-outline-variant);"
		>
			<div class="flex min-w-0 items-center gap-2">
				<MdButton
					variant="icon"
					title={$t('sidebar.collapse')}
					ariaLabel={$t('sidebar.collapse')}
					onclick={toggleCollapsed}
				>
					«
				</MdButton>
				<span class="truncate text-sm" style="color: var(--md-on-surface-variant);">DATABASE</span>
				{#if pending}
					<span class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">…</span>
				{/if}
			</div>
			<div class="flex items-center gap-0.5">
				<MdButton
					variant="icon"
					title={$t('sidebar.refresh')}
					onclick={refreshSchemas}
					disabled={pending}
				>
					↻
				</MdButton>
				{#if isMysql}
					<MdButton
						variant="icon"
						title={$t('sidebar.new_schema')}
						onclick={() => {
							newName = '';
							creating = true;
						}}
					>
						＋
					</MdButton>
				{/if}
			</div>
		</div>

		<!-- Filter -->
		<div class="px-3 py-2">
			<input
				type="text"
				class="w-full md-input text-xs"
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

		<!-- Tree -->
		<div class="flex-1 overflow-auto px-1 pb-3">
			{#if filteredDatabases.length === 0 && !pending}
				<p class="px-3 py-4 text-center text-xs" style="color: var(--md-on-surface-variant);">
					{filter ? $t('sidebar.no_match') : $t('sidebar.no_visible_schema')}
				</p>
			{:else}
				<ul class="flex flex-col gap-px">
					{#each filteredDatabases as db (db)}
						<li>
							<!-- database row -->
							<div
								role="button"
								tabindex="0"
								class="group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition"
								onmouseenter={(e) =>
									(e.currentTarget.style.background =
										'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
								onmouseleave={(e) => (e.currentTarget.style.background = 'transparent')}
								onclick={() => toggleDb(db)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										toggleDb(db);
									}
								}}
								oncontextmenu={(e) => openDatabaseMenu(e, db)}
							>
								<span
									class="inline-block w-3 text-center text-[10px] transition-transform"
									style:transform={dbExpanded[db] ? 'rotate(90deg)' : 'rotate(0deg)'}
									onclick={(e) => {
										e.stopPropagation();
										toggleDb(db);
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											e.stopPropagation();
											toggleDb(db);
										}
									}}
									role="button"
									tabindex="-1"
								>
									▶
								</span>
								<span class="text-xs" style="color: var(--md-primary);">DB</span>
								<span class="flex-1 truncate font-mono text-xs">{db}</span>
								<MdButton
									variant="icon"
									class="opacity-0 group-hover:opacity-100"
									style="width: 1.25rem; height: 1.25rem;"
									title={$t('sidebar.refresh')}
									onclick={(e) => {
										e.stopPropagation();
										void menuRefreshDatabase(db);
									}}
								>
									<span style="color: var(--md-on-surface-variant); font-size: 0.75rem;">↻</span>
								</MdButton>
							</div>

							<!-- database children -->
							{#if dbExpanded[db]}
								{#if isPg}
									<!-- PG: Database → Schema → Table → Column -->
									<ul
										class="ml-6 flex flex-col gap-px border-l"
										style="border-color: var(--md-outline-variant);"
									>
										{#if dbLoading[db]}
											<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
												{$t('common.loading')}
											</li>
										{:else if (schemasByDb[db] ?? []).length === 0}
											<li class="px-3 py-1 text-xs" style="color: var(--md-on-surface-variant);">
												{$t('sidebar.empty_schema')}
											</li>
										{:else}
											{#each (filter
												? (schemasByDb[db] ?? []).filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
												: (schemasByDb[db] ?? [])) as s (s)}
												
												{@const sKey = sk(db, s)}
											<li>
													<!-- schema row -->
													<div
														role="button"
														tabindex="0"
														class="group flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition"
														style:background={isSchemaSelected(db, s)
															? 'var(--md-secondary-container)'
															: 'transparent'}
														style:color={isSchemaSelected(db, s)
															? 'var(--md-on-secondary-container)'
															: 'var(--md-on-surface)'}
														onmouseenter={(e) =>
															!isSchemaSelected(db, s) &&
															(e.currentTarget.style.background =
																'color-mix(in srgb, var(--md-on-surface) 6%, transparent)')}
														onmouseleave={(e) =>
															!isSchemaSelected(db, s) && (e.currentTarget.style.background = 'transparent')}
														onclick={() => {
															if (isSchemaSelected(db, s)) {
																toggle(db, s);
															} else {
																onSelectSchema(db, s);
																toggle(db, s, true);
															}
														}}
														onkeydown={(e) => {
															if (e.key === 'Enter' || e.key === ' ') {
																e.preventDefault();
																if (isSchemaSelected(db, s)) {
																	toggle(db, s);
																} else {
																	onSelectSchema(db, s);
																	toggle(db, s, true);
																}
															}
														}}
														oncontextmenu={(e) => openSchemaMenu(e, s)}
													>
														<span
															class="inline-block w-3 text-center text-[10px] transition-transform"
															style:transform={expanded[sKey] ? 'rotate(90deg)' : 'rotate(0deg)'}
															onclick={(e) => {
																e.stopPropagation();
																toggle(db, s);
															}}
															onkeydown={(e) => {
																if (e.key === 'Enter' || e.key === ' ') {
																	e.preventDefault();
																	e.stopPropagation();
																	toggle(db, s);
																}
															}}
															role="button"
															tabindex="-1"
														>
															▶
														</span>
														<span class="text-xs" style="color: var(--md-primary);">SC</span>
														<span class="flex-1 truncate font-mono text-xs">{s}</span>
														<MdButton
															variant="icon"
															class="opacity-0 group-hover:opacity-100"
															style="width: 1.25rem; height: 1.25rem;"
															title={$t('sidebar.new_table')}
															onclick={(e) => {
																e.stopPropagation();
																onCreateTable?.(activeDb, s);
															}}
														>
															<span style="color: var(--md-primary); font-size: 0.75rem;">＋</span>
														</MdButton>
													</div>

													<!-- table children -->
													{#if expanded[sKey]}
														<ul
															class="ml-6 flex flex-col gap-px border-l"
															style="border-color: var(--md-outline-variant);"
														>
															<TreeTableList
																database={db}
																schema={s}
																tables={tablesBySchema[sKey] ?? []}
																loading={loading[sKey] ?? false}
																{selectedSchema}
																{selectedTable}
																tableExpanded={tableExpanded}
																{columnsByTable}
																{colsLoading}
																readOnly={false}
																{filter}
																onSelectTable={(sch, tbl) => onSelectTable(activeDb, sch, tbl)}
																onInspectTable={(sch, tbl) => onInspectTable?.(activeDb, sch, tbl)}
																onDeleteTable={(sch, tbl) => (confirmingTable = { database: activeDb, schema: sch, table: tbl })}
																onTableContextMenu={openTableMenu}
																onToggleTable={toggleTable}
																onColumnContextMenu={openColumnMenu}
																onColumnCopy={(col) => void copyText(quoteIdent(col))}
															/>
														</ul>
													{/if}
												</li>
											{/each}
										{/if}
									</ul>
								{:else}
									<!-- MySQL: Database → Table → Column（database 即 schema） -->
									<ul
										class="ml-6 flex flex-col gap-px border-l"
										style="border-color: var(--md-outline-variant);"
									>
										<TreeTableList
											database={db}
											schema={db}
											tables={tablesBySchema[db] ?? []}
											loading={loading[db] ?? false}
											{selectedSchema}
											{selectedTable}
											tableExpanded={tableExpanded}
											{columnsByTable}
											{colsLoading}
											readOnly={isReadOnlySchema(baseConn, db)}
											{filter}
											onSelectTable={(sch, tbl) => onSelectTable(sch, sch, tbl)}
											onInspectTable={(sch, tbl) => onInspectTable?.(sch, sch, tbl)}
											onDeleteTable={(sch, tbl) => (confirmingTable = { database: sch, schema: sch, table: tbl })}
											onTableContextMenu={openTableMenu}
											onToggleTable={toggleTable}
											onColumnContextMenu={openColumnMenu}
											onColumnCopy={(col) => void copyText(quoteIdent(col))}
										/>
									</ul>
								{/if}
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
<Modal
	open={creating}
	title={$t('sidebar.new_schema')}
	size="sm"
	onClose={() => (creating = false)}
>
	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-sm">
			<span style="color: var(--md-on-surface-variant);">{$t('sidebar.name_label')}</span>
			<input
				class="md-input"
				type="text"
				bind:value={newName}
				placeholder={$t('sidebar.name_placeholder')}
			/>
		</label>
		{#if isMysql}
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">{$t('schema.charset')}</span>
				<Combobox bind:value={newCharset} options={CHARSET_OPTIONS} placeholder="utf8mb4" />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">{$t('schema.collate')}</span>
				<Combobox
					bind:value={newCollate}
					options={collateOptions}
					placeholder="utf8mb4_unicode_ci"
				/>
			</label>
		{/if}
	</div>
	{#snippet footer()}
		<MdButton variant="text" onclick={() => (creating = false)} disabled={createPending}>
			{$t('common.cancel')}
		</MdButton>
		<MdButton variant="filled" onclick={doCreate} disabled={createPending || !newName.trim()}>
			{createPending ? $t('common.creating') : $t('common.create')}
		</MdButton>
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
		? $t('sidebar.dialog.delete_table_msg', {
				schema: confirmingTable.schema,
				table: confirmingTable.table
			})
		: ''}
	confirmText={$t('common.delete')}
	danger
	pending={deleteTablePending}
	onConfirm={doDeleteTable}
	onCancel={() => (confirmingTable = null)}
/>

<!-- 右键菜单 -->
<ContextMenu open={menu ? { x: menu.x, y: menu.y, items: menuItems } : null} onClose={closeMenu} />

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
