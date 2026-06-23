<script>
	import { getRoutineInfo, getRoutineDdl, callRoutine, deleteRoutine, debugRoutine, validateRoutine, createRoutine } from '$lib/api';
	import { ok, err } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { format as formatSql } from 'sql-formatter';
	import { getPlpgsqlCompletionItems } from '$lib/sqlCompletion.js';
	import MdButton from './MdButton.svelte';
	import Modal from './Modal.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import SqlEditor from './SqlEditor.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {ConnectionConfig} schemaConn
	 * @property {string} name
	 * @property {'FUNCTION'|'PROCEDURE'|'TRIGGER'} routineType
	 * @property {string} schema
	 * @property {boolean} [isNew]
	 */

	/** @type {Props} */
	let { schemaConn, name, routineType, schema, isNew = false } = $props();

	// 模式：view | edit | new
	// view: 查看详情，可编辑/调用/调试/删除
	// edit: 编辑代码，可保存/验证/格式化/取消
	// new:  新建函数，可保存/取消
	let mode = $state(/** @type {'view'|'edit'|'new'} */ ('view'));

	// 详情数据
	/** @type {any | null} */
	let detail = $state(null);
	let loading = $state(true);
	let error = $state('');

	// 编辑状态
	let editedBody = $state('');
	let validating = $state(false);
	let saving = $state(false);
	let hasChanges = $state(false);

	// DDL
	let ddl = $state('');
	let showDdl = $state(false);

	// 调用
	let callArgs = $state('');
	let callResult = $state('');
	let calling = $state(false);

	// 调试
	let debugOutput = $state(/** @type {any[]} */ ([]));
	let debugging = $state(false);

	// 确认删除
	let confirmingDelete = $state(false);
	let deleting = $state(false);

	// SQL 编辑器引用
	/** @type {any} */
	let editorRef = $state(null);

	// 加载详情
	$effect(() => {
		if (isNew) {
			initNewRoutine();
			mode = 'new';
		} else {
			loadDetail();
		}
	});

	function initNewRoutine() {
		// 新建模式默认值
		const isFunc = routineType === 'FUNCTION';
		detail = {
			name: '',
			routine_type: routineType,
			schema,
			language: 'plpgsql',
			return_type: isFunc ? 'INTEGER' : undefined,
			volatility: isFunc ? 'VOLATILE' : undefined,
			security_definer: 'SECURITY INVOKER',
			source_code: '',
			args: '',
			identity_args: ''
		};
		editedBody = '';
		hasChanges = false;
		loading = false;
	}

	// 监听编辑内容变化
	$effect(() => {
		if (detail && mode === 'edit') {
			// 初始化编辑内容
			editedBody = detail.source_code || '';
		}
	});

	async function loadDetail() {
		loading = true;
		error = '';
		try {
			// 并行获取详情和源码
			const [infoResp, ddlResp] = await Promise.all([
				getRoutineInfo(schemaConn, name, schema),
				getRoutineDdl(schemaConn, name, schema)
			]);

			if (infoResp.success) {
				detail = {
					...infoResp.data,
					source_code: ddlResp.success ? ddlResp.data : ''
				};
			} else {
				error = infoResp.error ?? get(t)('routine.load_failed');
			}
		} catch {
			error = get(t)('routine.load_failed');
		} finally {
			loading = false;
		}
	}

	async function loadDdl() {
		const resp = await getRoutineDdl(schemaConn, name, schema);
		if (resp.success) {
			ddl = resp.data;
			showDdl = true;
		} else {
			err(resp.error ?? get(t)('routine.ddl_failed'));
		}
	}

	function enterEditMode() {
		if (!detail) return;
		editedBody = detail.source_code || '';
		hasChanges = false;
		mode = 'edit';
	}

	function exitEditMode() {
		if (hasChanges) {
			if (!confirm(get(t)('routine.confirm_exit'))) {
				return;
			}
		}
		mode = 'view';
		hasChanges = false;
	}

	async function doValidate() {
		validating = true;
		try {
			// 验证时传递完整 DDL
			const resp = await validateRoutine(schemaConn, { ddl: editedBody.trim() });
			if (resp.success) {
				ok(get(t)('routine.validate_success'));
			} else {
				err(resp.error ?? get(t)('routine.validate_failed'));
			}
		} catch (e) {
			err(String(e));
		} finally {
			validating = false;
		}
	}

	async function doSave() {
		if (!editedBody.trim()) {
			err(get(t)('routine.body_required'));
			return;
		}
		if (!isNew && !hasChanges) return;
		saving = true;
		try {
			// 直接传递完整 DDL 语句
			const resp = await createRoutine(schemaConn, { ddl: editedBody.trim() });
			if (resp.success) {
				ok(get(t)('routine.save_success'));
				hasChanges = false;
				if (isNew) {
					// 新建成功：刷新页面以让侧栏加载新函数
					window.location.reload();
				} else {
					mode = 'view';
					await loadDetail();
				}
			} else {
				err(resp.error ?? get(t)('routine.save_failed'));
			}
		} catch (e) {
			err(String(e));
		} finally {
			saving = false;
		}
	}

	async function doCall() {
		// TRIGGER 类型不能手动调用，由数据库事件触发
		if (routineType === 'TRIGGER') {
			err(get(t)('routine.trigger_cannot_call'));
			return;
		}
		calling = true;
		callResult = '';
		try {
			let args = [];
			if (callArgs.trim()) {
				try {
					args = JSON.parse(callArgs);
					if (!Array.isArray(args)) args = [args];
				} catch {
					args = callArgs.split(',').map((s) => s.trim()).filter(Boolean);
				}
			}
			const resp = await callRoutine(schemaConn, { name, routineType, schema, args });
			if (resp.success) {
				callResult = JSON.stringify(resp.data, null, 2);
				ok(get(t)('routine.call_success'));
			} else {
				err(resp.error ?? get(t)('routine.call_failed'));
			}
		} catch (e) {
			err(String(e));
		} finally {
			calling = false;
		}
	}

	async function doDebug() {
		debugging = true;
		debugOutput = [];
		try {
			const resp = await debugRoutine(schemaConn, name, schema);
			if (resp.success) {
				debugOutput = resp.data ?? [];
			} else {
				err(resp.error ?? get(t)('routine.debug_failed'));
			}
		} catch (e) {
			err(String(e));
		} finally {
			debugging = false;
		}
	}

	async function doDelete() {
		deleting = true;
		try {
			const resp = await deleteRoutine(schemaConn, { name, routineType, schema });
			if (resp.success) {
				ok(get(t)('routine.deleted', { name }));
				confirmingDelete = false;
				// 触发页面刷新以关闭 tab
				window.location.reload();
			} else {
				err(resp.error ?? get(t)('routine.delete_failed'));
			}
		} catch (e) {
			err(String(e));
		} finally {
			deleting = false;
		}
	}

	function formatBody() {
		if (editorRef) {
			try {
				const formatted = formatSql(editedBody, {
					language: detail.language === 'plpgsql' ? 'postgresql' : 'sql',
					keywordCase: 'upper'
				});
				editedBody = formatted;
			} catch {
				// 格式化失败，保持原样
			}
		}
	}

	/** 复制到剪贴板 */
	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			ok(get(t)('routine.copied'));
		} catch {
			err(get(t)('routine.copy_failed'));
		}
	}

	/**
	 * 构建 Monaco SQL 编辑器的补全建议。
	 * 根据 driver 返回 plpgsql 语法关键字和函数。
	 * @param {{ word: string, prevToken: string, qualifier: string | null }} ctx
	 */
	function buildCompletion(ctx) {
		const driver = schemaConn?.driver ?? 'Mysql';
		const items = getPlpgsqlCompletionItems(driver);

		// 确定前缀排序
		const prefix = ctx.word ? ctx.word.toLowerCase() : '';

		/** @type {{ label: string, kind: string, detail?: string }[]} */
		const suggestions = [];

		// 1. plpgsql 关键字
		for (const kw of items.plpgsqlKeywords) {
			if (!prefix || kw.toLowerCase().startsWith(prefix)) {
				suggestions.push({ label: kw, kind: 'keyword' });
			}
		}

		// 2. SQL 关键字
		for (const kw of items.keywords) {
			if (!prefix || kw.toLowerCase().startsWith(prefix)) {
				suggestions.push({ label: kw, kind: 'keyword' });
			}
		}

		// 3. PL/pgSQL 特定函数
		for (const fn of items.plpgsqlFunctions) {
			if (!prefix || fn.toLowerCase().startsWith(prefix)) {
				suggestions.push({ label: fn, kind: 'function' });
			}
		}

		// 4. 通用 SQL 函数
		for (const fn of items.functions) {
			if (!prefix || fn.toLowerCase().startsWith(prefix)) {
				suggestions.push({ label: fn, kind: 'function' });
			}
		}

		return suggestions;
	}
</script>

<section class="flex h-full w-full flex-col overflow-hidden">
	<!-- Header -->
	<header
		class="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<div class="flex items-center gap-3">
			<span
				class="rounded px-2 py-0.5 text-[10px] font-medium"
				style="background: var(--md-tertiary-container); color: var(--md-on-tertiary-container);"
			>
				{routineType}
			</span>
			<h1 class="font-mono text-sm font-medium" style="color: var(--md-on-surface);">
				{name}
			</h1>
			{#if routineType === 'TRIGGER' && detail?.trigger_table}
				<span
					class="rounded px-2 py-0.5 text-[10px] font-medium"
					style="background: var(--md-tertiary-container); color: var(--md-on-tertiary-container);"
				>
					→ {detail.trigger_table}
				</span>
			{/if}
			{#if detail?.description}
				<span class="text-xs" style="color: var(--md-on-surface-variant);">
					— {detail.description}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if mode === 'view'}
				<MdButton variant="filled" size="sm" onclick={enterEditMode}>
					{$t('routine.edit')}
				</MdButton>
				<MdButton variant="text" size="sm" onclick={loadDdl}>
					{$t('routine.view_ddl')}
				</MdButton>
				{#if routineType === 'FUNCTION'}
					<!-- 仅 FUNCTION 支持调试，PROCEDURE 不支持 -->
					<MdButton variant="text" size="sm" onclick={doDebug} disabled={debugging}>
						{debugging ? '...' : $t('routine.debug')}
					</MdButton>
				{/if}
				<MdButton variant="danger" size="sm" onclick={() => (confirmingDelete = true)}>
					{$t('routine.delete')}
				</MdButton>
			{:else}
				<!-- 编辑模式 / 新建模式 -->
				<MdButton variant="text" size="sm" onclick={formatBody}>
					{$t('routine.format')}
				</MdButton>
				{#if mode === 'edit'}
					<!-- 仅编辑模式显示验证按钮 -->
					<MdButton variant="text" size="sm" onclick={doValidate} disabled={validating}>
						{validating ? '...' : $t('routine.validate')}
					</MdButton>
				{/if}
				<MdButton variant="filled" size="sm" onclick={doSave} disabled={saving || (mode === 'edit' && !hasChanges)}>
					{saving ? '...' : (mode === 'new' ? $t('routine.create') : $t('routine.save'))}
				</MdButton>
				<MdButton variant="outlined" size="sm" onclick={exitEditMode}>
					{$t('routine.cancel')}
				</MdButton>
			{/if}
		</div>
	</header>

	<!-- Content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if mode === 'edit' || mode === 'new'}
			<!-- 编辑模式 / 新建模式 -->
			<div class="flex flex-1 flex-col overflow-hidden">
				<!-- 函数体编辑器 -->
				<div class="flex flex-1 flex-col overflow-hidden">
					<div class="flex items-center justify-between border-b px-4 py-2" style="border-color: var(--md-outline-variant); background: var(--md-surface-container-low);">
						<span class="text-xs font-medium" style="color: var(--md-on-surface);">
							{$t('routine.source_code')} {mode === 'new' ? '' : `(${detail?.language})`}
						</span>
						<div class="flex items-center gap-2">
							{#if mode === 'edit' && hasChanges}
								<span class="text-xs" style="color: var(--md-primary);">●</span>
							{/if}
							{#if mode === 'edit'}
								<span class="text-[10px]" style="color: var(--md-on-surface-variant);">
									Ctrl+Enter: {$t('routine.validate')}
								</span>
							{/if}
						</div>
					</div>
					<div class="flex-1 overflow-hidden">
						<SqlEditor
							bind:this={editorRef}
							value={editedBody}
							onValueChange={(v) => {
								editedBody = v;
								hasChanges = true;
							}}
							onCtrlEnter={mode === 'edit' ? doValidate : undefined}
							getSuggestions={buildCompletion}
							placeholder={routineType === 'FUNCTION'
								? 'CREATE OR REPLACE FUNCTION ...'
								: routineType === 'PROCEDURE'
									? 'CREATE OR REPLACE PROCEDURE ...'
									: 'CREATE OR REPLACE TRIGGER ...'}
						/>
					</div>
				</div>
			</div>
		{:else}
			<!-- 查看模式 -->
			<div class="flex flex-1 overflow-hidden">
				<!-- Left: Info -->
				<div class="flex w-72 shrink-0 flex-col overflow-auto border-r" style="border-color: var(--md-outline-variant);">
					{#if loading}
						<div class="flex flex-1 items-center justify-center p-4">
							<span class="text-sm" style="color: var(--md-on-surface-variant);">
								{$t('common.loading')}
							</span>
						</div>
					{:else if error}
						<div class="flex flex-1 items-center justify-center p-4">
							<span class="text-sm" style="color: var(--md-error);">{error}</span>
						</div>
					{:else if detail}
						<div class="flex flex-col gap-4 p-4">
							<!-- 基本信息 -->
							<section>
								<h3 class="mb-2 text-xs font-medium uppercase tracking-wide" style="color: var(--md-on-surface-variant);">
									{$t('routine.info')}
								</h3>
								<dl class="flex flex-col gap-2 text-xs">
									<div class="flex justify-between">
										<dt style="color: var(--md-on-surface-variant);">{$t('routine.schema')}</dt>
										<dd class="font-mono" style="color: var(--md-on-surface);">{detail.schema}</dd>
									</div>
									<div class="flex justify-between">
										<dt style="color: var(--md-on-surface-variant);">{$t('routine.language')}</dt>
										<dd class="font-mono" style="color: var(--md-on-surface);">{detail.language}</dd>
									</div>
									<div class="flex justify-between">
										<dt style="color: var(--md-on-surface-variant);">{$t('routine.return_type')}</dt>
										<dd class="font-mono" style="color: var(--md-on-surface);">{detail.return_type || '—'}</dd>
									</div>
									<div class="flex justify-between">
										<dt style="color: var(--md-on-surface-variant);">{$t('routine.volatility')}</dt>
										<dd class="font-mono" style="color: var(--md-on-surface);">{detail.volatility}</dd>
									</div>
									<div class="flex justify-between">
										<dt style="color: var(--md-on-surface-variant);">{$t('routine.security')}</dt>
										<dd class="font-mono" style="color: var(--md-on-surface);">{detail.security_definer}</dd>
									</div>
								</dl>
							</section>

							<!-- 参数 -->
							{#if detail.arg_names}
								<section>
									<h3 class="mb-2 text-xs font-medium uppercase tracking-wide" style="color: var(--md-on-surface-variant);">
										{$t('routine.arguments')}
									</h3>
									{#if detail.arg_names}
										{#each detail.arg_names.split(',').filter(Boolean) as arg}
											<div class="rounded px-2 py-1 text-xs font-mono" style="background: var(--md-surface-container-lowest); color: var(--md-on-surface);">
												{arg.trim()}
											</div>
										{/each}
									{/if}
									{#if detail.arg_count}
										<div class="mt-1 text-[10px]" style="color: var(--md-on-surface-variant);">
											({detail.arg_count} 参数)
										</div>
									{/if}
								</section>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Right: Source Code & Call -->
				<div class="flex flex-1 flex-col overflow-hidden">
					<!-- Source Code -->
					<div class="flex flex-1 flex-col overflow-hidden border-b" style="border-color: var(--md-outline-variant);">
						<div class="flex items-center justify-between border-b px-4 py-2" style="border-color: var(--md-outline-variant); background: var(--md-surface-container-low);">
							<h3 class="text-xs font-medium" style="color: var(--md-on-surface);">
								{$t('routine.source_code')}
							</h3>
							{#if detail?.source_code}
								<MdButton variant="text" size="sm" onclick={() => copyText(detail.source_code)}>
									{$t('routine.copy')}
								</MdButton>
							{/if}
						</div>
						<div class="flex-1 overflow-auto p-4">
							{#if detail?.source_code}
								<pre class="text-xs font-mono whitespace-pre-wrap" style="color: var(--md-on-surface);">{detail.source_code}</pre>
							{:else}
								<span class="text-sm" style="color: var(--md-on-surface-variant);">—</span>
							{/if}
						</div>
					</div>

					<!-- Call / Trigger Info -->
					{#if routineType === 'TRIGGER'}
						<!-- TRIGGER 提示 -->
						<div class="flex flex-1 items-center justify-center">
							<div class="text-center">
								<p class="text-sm" style="color: var(--md-on-surface-variant);">
									{$t('routine.trigger_info')}
								</p>
								<p class="mt-1 text-xs" style="color: var(--md-on-surface-variant);">
									{$t('routine.trigger_info_desc')}
								</p>
							</div>
						</div>
					{:else}
						<div class="flex flex-1 flex-col overflow-hidden">
							<div class="flex items-center justify-between border-b px-4 py-2" style="border-color: var(--md-outline-variant); background: var(--md-surface-container-low);">
								<h3 class="text-xs font-medium" style="color: var(--md-on-surface);">
									{$t('routine.call')}
								</h3>
							</div>
							<div class="flex flex-1 flex-col gap-3 overflow-auto p-4">
								<label class="flex flex-col gap-1">
									<span class="text-xs font-medium" style="color: var(--md-on-surface-variant);">
										{$t('routine.arguments')} (JSON array)
									</span>
									<input
										type="text"
										class="md-input font-mono text-xs"
										placeholder='["arg1", "arg2"] 或 arg1, arg2'
										bind:value={callArgs}
										onkeydown={(e) => {
											if (e.key === 'Enter' && !calling) doCall();
										}}
									/>
								</label>
								<div class="flex items-center gap-2">
									<MdButton variant="filled" onclick={doCall} disabled={calling}>
										{#if calling}
											<span class="animate-spin">↻</span>
										{:else}
											{$t('routine.execute')}
										{/if}
									</MdButton>
									<span class="text-xs" style="color: var(--md-on-surface-variant);">
										{#if routineType === 'FUNCTION'}
											{$t('routine.call_hint_fn')}
										{:else if routineType === 'PROCEDURE'}
											{$t('routine.call_hint_prc')}
										{/if}
									</span>
								</div>
								{#if callResult}
									<div class="rounded p-3" style="background: var(--md-surface-container-lowest);">
										<pre class="text-xs font-mono whitespace-pre-wrap" style="color: var(--md-on-surface);">{callResult}</pre>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<!-- DDL Modal -->
	<Modal open={showDdl} title={$t('routine.ddl')} size="lg" onClose={() => (showDdl = false)}>
		{#if ddl}
			<div class="flex justify-end">
				<MdButton variant="text" size="sm" onclick={() => copyText(ddl)}>
					{$t('routine.copy')}
				</MdButton>
			</div>
			<pre class="mt-2 max-h-96 overflow-auto rounded p-3 text-xs font-mono" style="background: var(--md-surface-container-lowest); color: var(--md-on-surface);">{ddl}</pre>
		{/if}
	</Modal>

	<!-- Delete Confirm -->
	<ConfirmDialog
		open={confirmingDelete}
		title={$t('routine.delete_confirm_title')}
		message={get(t)('routine.delete_confirm_msg', { name })}
		confirmText={$t('routine.delete')}
		danger={true}
		pending={deleting}
		onConfirm={doDelete}
		onCancel={() => (confirmingDelete = false)}
	/>
</section>

<style>
	pre {
		tab-size: 4;
	}
</style>
