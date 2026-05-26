<script>
	import { listSchemas, listTables, listData } from '$lib/api';
	import { activeConnection, defaultConnection } from '$lib/stores/appState.js';

	let conn = $state({ ...defaultConnection });
	let pending = $state(false);
	let errorMsg = $state(/** @type {string | null} */ (null));

	// 已确认连通的连接（含其填的默认 database）；后续切 schema 时基于它派生
	let baseConn = $state(/** @type {import('$lib/api').ConnectionConfig | null} */ (null));

	let schemas = $state(/** @type {string[]} */ ([]));
	let selectedSchema = $state(/** @type {string | null} */ (null));

	let tables = $state(/** @type {{ name: string; type: string }[]} */ ([]));
	let selectedTable = $state(/** @type {string | null} */ (null));

	let page = $state(1);
	const pageSize = 100;
	let columns = $state(/** @type {string[]} */ ([]));
	let rows = $state(/** @type {Record<string, unknown>[]} */ ([]));

	// 视图状态由数据派生，单一信源
	let view = $derived(
		!baseConn ? 'connect' : !selectedSchema ? 'schemas' : !selectedTable ? 'tables' : 'data'
	);

	function adjustDefaultPort() {
		if (conn.driver === 'postgresql' && conn.port === 3306) conn.port = 5432;
		else if (conn.driver === 'mysql' && conn.port === 5432) conn.port = 3306;
	}

	/** @returns {import('$lib/api').ConnectionConfig} */
	function connFor(database) {
		if (!baseConn) throw new Error('no active connection');
		return { ...baseConn, database };
	}

	async function call(fn) {
		pending = true;
		errorMsg = null;
		try {
			const resp = await fn();
			if (!resp.success) {
				errorMsg = resp.error ?? '未知错误';
				return null;
			}
			return resp.data;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : String(e);
			return null;
		} finally {
			pending = false;
		}
	}

	async function testConnection() {
		const data = await call(() => listSchemas(conn));
		if (data == null) return;
		baseConn = { ...conn };
		activeConnection.set({ ...conn });
		schemas = normalizeStringList(data, ['name', 'schema', 'database']);
		selectedSchema = null;
		selectedTable = null;
	}

	async function pickSchema(name) {
		selectedSchema = name;
		selectedTable = null;
		tables = [];
		const data = await call(() => listTables(connFor(name)));
		if (data == null) return;
		tables = normalizeTableList(data);
	}

	async function pickTable(name) {
		selectedTable = name;
		page = 1;
		await loadData();
	}

	async function loadData() {
		if (!selectedSchema || !selectedTable) return;
		const data = await call(() =>
			listData(connFor(selectedSchema), selectedTable, page, pageSize)
		);
		if (data == null) return;
		const normalized = normalizeDataPage(data);
		rows = normalized.rows;
		columns = normalized.columns;
	}

	async function gotoPage(p) {
		if (p < 1 || pending) return;
		page = p;
		await loadData();
	}

	function backToConnect() {
		baseConn = null;
		activeConnection.set(null);
		schemas = [];
		selectedSchema = null;
		selectedTable = null;
		tables = [];
		rows = [];
		columns = [];
	}

	function backToSchemas() {
		selectedSchema = null;
		selectedTable = null;
		tables = [];
		rows = [];
		columns = [];
	}

	function backToTables() {
		selectedTable = null;
		rows = [];
		columns = [];
	}

	// ---- 兼容引擎多种返回形态 ----

	/**
	 * 把响应折叠为 string[]：支持 string[] | {name|schema|database}[] | {schemas:[...]}
	 * @param {unknown} data
	 * @param {string[]} keys
	 * @returns {string[]}
	 */
	function normalizeStringList(data, keys) {
		if (Array.isArray(data)) {
			return data.map((item) => {
				if (typeof item === 'string') return item;
				if (item && typeof item === 'object') {
					const o = /** @type {Record<string, unknown>} */ (item);
					for (const k of keys) if (typeof o[k] === 'string') return /** @type {string} */ (o[k]);
					return JSON.stringify(o);
				}
				return String(item);
			});
		}
		if (data && typeof data === 'object') {
			const o = /** @type {Record<string, unknown>} */ (data);
			for (const k of ['schemas', 'tables', 'list', 'items']) {
				if (Array.isArray(o[k])) return normalizeStringList(o[k], keys);
			}
		}
		return [];
	}

	/**
	 * @param {unknown} data
	 * @returns {{name: string; type: string}[]}
	 */
	function normalizeTableList(data) {
		const arr = Array.isArray(data)
			? data
			: data && typeof data === 'object' && Array.isArray(/** @type {any} */ (data).tables)
				? /** @type {any} */ (data).tables
				: [];
		return arr.map((item) => {
			if (typeof item === 'string') return { name: item, type: 'TABLE' };
			const o = /** @type {Record<string, unknown>} */ (item);
			return {
				name: String(o.name ?? o.tableName ?? ''),
				type: String(o.type ?? 'TABLE')
			};
		});
	}

	/**
	 * @param {unknown} data
	 * @returns {{rows: Record<string, unknown>[]; columns: string[]}}
	 */
	function normalizeDataPage(data) {
		let rawRows = [];
		if (Array.isArray(data)) {
			rawRows = data;
		} else if (data && typeof data === 'object') {
			const o = /** @type {Record<string, unknown>} */ (data);
			if (Array.isArray(o.rows)) rawRows = /** @type {any[]} */ (o.rows);
			else if (Array.isArray(o.list)) rawRows = /** @type {any[]} */ (o.list);
			else if (Array.isArray(o.data)) rawRows = /** @type {any[]} */ (o.data);
		}
		// 列名：取第一行键的并集（保持出现顺序）
		const colSet = new Set();
		for (const r of rawRows) {
			if (r && typeof r === 'object') for (const k of Object.keys(r)) colSet.add(k);
		}
		return { rows: rawRows, columns: [...colSet] };
	}

	function isLob(v) {
		return typeof v === 'string' && /^\[LOB Data/i.test(v);
	}

	function renderCell(v) {
		if (v === null || v === undefined) return '';
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}
</script>

<main class="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-6">
	<header class="flex items-center justify-between">
		<h1 class="text-xl font-semibold tracking-tight">idb · 数据库浏览</h1>
		{#if baseConn}
			<div class="text-xs text-slate-500">
				{baseConn.driver}://{baseConn.user}@{baseConn.host}:{baseConn.port}
			</div>
		{/if}
	</header>

	<!-- 面包屑 -->
	{#if baseConn}
		<nav class="flex items-center gap-2 text-sm">
			<button class="text-slate-500 hover:text-slate-900" onclick={backToConnect}>连接</button>
			<span class="text-slate-300">/</span>
			<button
				class="text-slate-500 hover:text-slate-900 disabled:text-slate-900"
				disabled={!selectedSchema}
				onclick={backToSchemas}
			>
				{selectedSchema ?? 'schemas'}
			</button>
			{#if selectedSchema}
				<span class="text-slate-300">/</span>
				<button
					class="text-slate-500 hover:text-slate-900 disabled:text-slate-900"
					disabled={!selectedTable}
					onclick={backToTables}
				>
					{selectedTable ?? 'tables'}
				</button>
			{/if}
			{#if pending}
				<span class="ml-2 animate-pulse text-xs text-slate-400">…</span>
			{/if}
		</nav>
	{/if}

	{#if errorMsg}
		<div class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
			✗ {errorMsg}
		</div>
	{/if}

	<!-- 连接视图 -->
	{#if view === 'connect'}
		<form
			class="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
			onsubmit={(e) => {
				e.preventDefault();
				testConnection();
			}}
		>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-slate-600">驱动</span>
				<select
					class="rounded-md border border-slate-300 px-3 py-2"
					bind:value={conn.driver}
					onchange={adjustDefaultPort}
				>
					<option value="mysql">MySQL</option>
					<option value="postgresql">PostgreSQL</option>
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-slate-600">主机</span>
				<input
					class="rounded-md border border-slate-300 px-3 py-2"
					type="text"
					bind:value={conn.host}
					required
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-slate-600">端口</span>
				<input
					class="rounded-md border border-slate-300 px-3 py-2"
					type="number"
					bind:value={conn.port}
					min="1"
					max="65535"
					required
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-slate-600">用户名</span>
				<input
					class="rounded-md border border-slate-300 px-3 py-2"
					type="text"
					bind:value={conn.user}
					required
				/>
			</label>
			<label class="col-span-2 flex flex-col gap-1 text-sm">
				<span class="text-slate-600">密码</span>
				<input
					class="rounded-md border border-slate-300 px-3 py-2"
					type="password"
					bind:value={conn.password}
					autocomplete="off"
				/>
			</label>
			<label class="col-span-2 flex flex-col gap-1 text-sm">
				<span class="text-slate-600">默认 database（可选，留空连服务后再选 schema）</span>
				<input
					class="rounded-md border border-slate-300 px-3 py-2"
					type="text"
					bind:value={conn.database}
				/>
			</label>
			<button
				type="submit"
				class="col-span-2 rounded-full bg-slate-900 py-2 text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
				disabled={pending}
			>
				{pending ? '请求中…' : '连接并列出 schema'}
			</button>
		</form>
	{/if}

	<!-- schema 列表 -->
	{#if view === 'schemas'}
		<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-3 text-sm font-medium text-slate-500">{schemas.length} 个 schema</h2>
			<ul class="grid grid-cols-3 gap-2">
				{#each schemas as name (name)}
					<li>
						<button
							class="w-full truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm hover:border-slate-400 hover:bg-white"
							onclick={() => pickSchema(name)}
						>
							{name}
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- 表列表 -->
	{#if view === 'tables'}
		<section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-3 text-sm font-medium text-slate-500">
				<span class="text-slate-900">{selectedSchema}</span> · {tables.length} 个表
			</h2>
			{#if tables.length === 0 && !pending}
				<p class="text-sm text-slate-400">该 schema 下没有可见的表</p>
			{:else}
				<ul class="grid grid-cols-3 gap-2">
					{#each tables as t (t.name)}
						<li>
							<button
								class="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm hover:border-slate-400 hover:bg-white"
								onclick={() => pickTable(t.name)}
							>
								<span class="truncate">{t.name}</span>
								<span class="text-xs text-slate-400">{t.type}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<!-- 数据网格 -->
	{#if view === 'data'}
		<section class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
			<header class="flex items-center justify-between text-sm">
				<h2 class="font-medium">
					<span class="text-slate-500">{selectedSchema}</span> ·
					<span class="text-slate-900">{selectedTable}</span>
				</h2>
				<div class="flex items-center gap-2">
					<button
						class="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
						onclick={() => gotoPage(page - 1)}
						disabled={pending || page <= 1}
					>
						上一页
					</button>
					<span class="text-xs text-slate-500">第 {page} 页 · {pageSize} 行/页</span>
					<button
						class="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
						onclick={() => gotoPage(page + 1)}
						disabled={pending || rows.length < pageSize}
					>
						下一页
					</button>
				</div>
			</header>

			{#if rows.length === 0 && !pending}
				<p class="py-8 text-center text-sm text-slate-400">空表 / 当前页无数据</p>
			{:else if columns.length > 0}
				<div class="max-h-[60vh] overflow-auto rounded-md border border-slate-200">
					<table class="min-w-full text-left text-xs">
						<thead class="sticky top-0 bg-slate-100 text-slate-600">
							<tr>
								{#each columns as col (col)}
									<th class="border-b border-slate-200 px-3 py-2 font-medium whitespace-nowrap">
										{col}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each rows as row, i (i)}
								<tr class="even:bg-slate-50">
									{#each columns as col (col)}
										<td class="max-w-[24rem] truncate border-b border-slate-100 px-3 py-1.5">
											{#if isLob(row[col])}
												<span
													class="text-slate-400 italic"
													title="大字段已熔断，需单行精准查询（待实现）"
												>
													{row[col]}
												</span>
											{:else}
												{renderCell(row[col])}
											{/if}
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</main>
