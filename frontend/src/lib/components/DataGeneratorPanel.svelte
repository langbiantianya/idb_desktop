<script>
	import { listTables, listColumns, generateData } from '$lib/api';
	import { asTableList, asColumnList } from '$lib/api/normalize.js';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import LuaEditor from './LuaEditor.svelte';
	import DataGenHelp from './DataGenHelp.svelte';
	import { formatLua } from '$lib/luaFormat.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 *
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 */

	/** @type {Props} */
	let { schemaConn } = $props();

	// ---- 配置 ----
	let count = $state(100);
	let script = $state('');

	// ---- 数据库元数据（补全用）----
	/** @type {string[]} */
	let tableSuggestions = $state([]);
	/** @type {{ table: string; column: string; type: string }[]} */
	let columnSuggestions = $state([]);

	// 加载表名，然后逐表加载列
	$effect(() => {
		const conn = schemaConn;
		if (!conn) return;
		listTables(conn).then((resp) => {
			if (!resp.success) return;
			const tables = asTableList(resp.data);
			tableSuggestions = tables.map((t) => t.name);
			// 逐表加载列
			for (const tbl of tables) {
				listColumns(conn, tbl.name).then((colResp) => {
					if (!colResp.success) return;
					const cols = asColumnList(colResp.data);
					columnSuggestions = [
						...columnSuggestions,
						...cols.map((c) => ({ table: tbl.name, column: c.name, type: c.type }))
					];
				});
			}
		});
	});

	// ---- 运行状态 ----
	let running = $state(false);
	let luaVersion = $state('luajit');
	let showHelp = $state(false);

	// ---- SQL 日志（最多 MAX_LOG 行）----
	const MAX_LOG = 500;
	/** @type {string[]} */
	let sqlLogs = $state([]);
	/** 按表名统计已插入行数 */
	let insertCounts = $state(/** @type {Record<string, number>} */ ({}));
	/** @type {string[]} */
	let logBuf = [];
	/** @type {Record<string, number>} */
	let latestCounts = {};
	let logFlushTimer = /** @type {ReturnType<typeof setInterval>} */ (0);
	let logEl = $state(/** @type {HTMLDivElement | null} */ (null));

	/** 从 INSERT SQL 中提取表名 */
	const TABLE_RE = /INSERT\s+INTO\s+[`'"]?(\w+)[`'"]?/i;

	function flushLogs() {
		const hasCounts = Object.keys(latestCounts).some(
			(k) => latestCounts[k] !== insertCounts[k]
		);
		if (logBuf.length === 0 && !hasCounts) return;
		sqlLogs = [...sqlLogs, ...logBuf].slice(-MAX_LOG);
		logBuf = [];
		insertCounts = { ...latestCounts };
		requestAnimationFrame(() => {
			if (logEl) logEl.scrollTop = logEl.scrollHeight;
		});
	}

	let formatting = $state(false);
	async function format() {
		if (formatting || !script.trim()) return;
		formatting = true;
		try {
			script = await formatLua(script);
		} finally {
			formatting = false;
		}
	}

	async function run() {
		if (running) return;

		if (!count || count <= 0) {
			err(get(t)('dg.toast.no_count', { index: 1 }));
			return;
		}

		running = true;
		sqlLogs = [];
		logBuf = [];
		insertCounts = {};
		latestCounts = {};
		logFlushTimer = setInterval(flushLogs, 100);

		const tables = [{ count, script }];

		try {
			const resp = await generateData(schemaConn, tables, (data) => {
				if (data.sql) {
					logBuf.push(data.sql);
					const m = TABLE_RE.exec(data.sql);
					if (m) {
						const tbl = m[1];
						latestCounts[tbl] = (latestCounts[tbl] || 0) + 1;
					}
				}
			}, { luaVersion });

			if (resp.success) {
				ok(get(t)('dg.toast.success', { total: 1 }));
			} else {
				err(resp.error ?? get(t)('dg.toast.failed'));
			}
		} catch {
			err(get(t)('dg.toast.failed'));
		} finally {
			clearInterval(logFlushTimer);
			flushLogs();
			running = false;
		}
	}
</script>

<section class="flex h-full w-full flex-col overflow-hidden">
	<!-- Header -->
	<header
		class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<h2 class="shrink-0 text-sm font-medium" style="color: var(--md-on-surface);">{$t('dg.title')}</h2>
		<button
			type="button"
			class="dg-help-btn"
			onclick={() => (showHelp = true)}
			title={$t('dg.help')}
		>?</button>
		<div class="flex min-w-0 flex-wrap items-center gap-3">
			<div class="shrink-0 font-mono text-xs" style="color: var(--md-on-surface-variant);">
				{schemaConn.driver}://{schemaConn.host}:{schemaConn.port}/{schemaConn.database || '—'}
			</div>
			<div class="flex items-center gap-1.5">
				<span class="text-xs" style="color: var(--md-on-surface-variant);">{$t('dg.lua_version')}</span>
				<select
					class="dg-version-select"
					value={luaVersion}
					onchange={(e) => (luaVersion = /** @type {HTMLSelectElement} */ (e.target).value)}
					disabled={running}
				>
					<option value="luajit">LuaJIT</option>
					<option value="5.1">Lua 5.1</option>
					<option value="5.2">Lua 5.2</option>
					<option value="5.3">Lua 5.3</option>
					<option value="5.4">Lua 5.4</option>
					<option value="5.5">Lua 5.5</option>
				</select>
			</div>
			<div class="flex items-center gap-1">
				<span class="text-xs" style="color: var(--md-on-surface-variant);">{$t('dg.count')}</span>
				<input
					type="number"
					class="dg-count-input"
					value={count}
					min="1"
					placeholder={$t('dg.count_placeholder')}
					oninput={(e) => (count = parseInt(/** @type {HTMLInputElement} */ (e.target).value) || 1)}
				/>
			</div>
			<button
				type="button"
				class="dg-format-btn"
				onclick={format}
				disabled={formatting || running || !script.trim()}
				title="Alt+Shift+F"
			>
				{$t('dg.format')}
			</button>
			<button
				type="button"
				class="dg-run-btn"
				onclick={run}
				disabled={running}
				title={$t('dg.run')}
			>
				{#if running}
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="20">
							<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
						</circle>
					</svg>
				{:else}
					<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
						<path d="M8 5v14l11-7z" fill="currentColor" />
					</svg>
				{/if}
				<span class="ml-1">{$t('dg.run')}</span>
			</button>
		</div>
	</header>

	<!-- Lua Editor -->
	<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
		<LuaEditor
			value={script}
			onValueChange={(v) => (script = v)}
			onCtrlEnter={run}
			onFormat={format}
			placeholder={$t('dg.script_placeholder')}
			{tableSuggestions}
			{columnSuggestions}
		/>
	</div>

	<!-- SQL 日志 -->
	<div
		class="dg-log-area shrink-0"
		style="border-top: 1px solid var(--md-outline-variant); background: var(--md-surface-container-lowest);"
	>
		<div class="flex flex-wrap items-center gap-2 px-3 py-1">
			<span class="text-[11px] font-medium uppercase tracking-wide" style="color: var(--md-on-surface-variant);">
				{$t('dg.log_title')}
			</span>
			{#if running}
				<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" style="color: var(--md-primary);">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="20">
						<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
					</circle>
				</svg>
			{/if}
			{#each Object.entries(insertCounts) as [tbl, cnt] (tbl)}
				<span class="text-[11px] font-mono" style="color: var(--md-on-surface);">
					<span style="color: var(--md-on-surface-variant);">{tbl}</span>
					<span class="dg-count-badge">{$t('dg.inserted_short', { count: cnt })}</span>
				</span>
			{/each}
			<span class="ml-auto text-[11px] font-mono" style="color: var(--md-on-surface-variant);">
				· {sqlLogs.length}
			</span>
		</div>
		<div bind:this={logEl} class="dg-log-scroll overflow-y-auto font-mono text-[11px] leading-5">
			{#if sqlLogs.length === 0 && !running}
				<div class="px-3 py-2" style="color: var(--md-on-surface-variant);">
					{$t('dg.log_empty')}
				</div>
			{:else}
				{#each sqlLogs as line, i (i)}
					<div class="dg-log-line truncate px-3" style="color: var(--md-on-surface);">
						{line}
					</div>
				{/each}
			{/if}
		</div>
	</div>
</section>

<DataGenHelp open={showHelp} onClose={() => (showHelp = false)} />

<style>
	.dg-count-input {
		width: 5rem;
		padding: 0.125rem 0.375rem;
		font-size: 0.75rem;
		font-family: 'JetBrains Mono', monospace;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-radius-xs);
		background: var(--md-surface-container-lowest);
		color: var(--md-on-surface);
		outline: none;
	}
	.dg-count-input:focus {
		border-color: var(--md-primary);
	}
	.dg-version-select {
		padding: 0.125rem 0.375rem;
		font-size: 0.75rem;
		font-family: 'JetBrains Mono', monospace;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-radius-xs);
		background: var(--md-surface-container-lowest);
		color: var(--md-on-surface);
		outline: none;
		cursor: pointer;
	}
	.dg-version-select:focus {
		border-color: var(--md-primary);
	}
	.dg-format-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		border: 1px solid var(--md-outline-variant);
		border-radius: var(--md-radius-xs);
		background: transparent;
		color: var(--md-on-surface-variant);
		cursor: pointer;
		transition: background 0.15s;
	}
	.dg-format-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--md-primary) 8%, transparent);
	}
	.dg-format-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.dg-run-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.25rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		border: none;
		border-radius: var(--md-radius-xs);
		background: var(--md-primary);
		color: var(--md-on-primary);
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.dg-run-btn:hover {
		opacity: 0.9;
	}
	.dg-run-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.dg-log-area {
		height: 35%;
		min-height: 100px;
		display: flex;
		flex-direction: column;
	}
	.dg-log-scroll {
		flex: 1;
		min-height: 0;
	}
	.dg-log-line:hover {
		background: color-mix(in srgb, var(--md-primary) 6%, transparent);
	}
	.dg-count-badge {
		display: inline-block;
		margin-left: 0.25rem;
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		line-height: 1.25rem;
		border-radius: 9999px;
		background: color-mix(in srgb, var(--md-primary) 12%, transparent);
		color: var(--md-primary);
	}
	.dg-help-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.375rem;
		height: 1.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid var(--md-outline-variant);
		border-radius: 50%;
		background: transparent;
		color: var(--md-on-surface-variant);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}
	.dg-help-btn:hover {
		background: color-mix(in srgb, var(--md-primary) 12%, transparent);
		color: var(--md-primary);
	}
</style>
