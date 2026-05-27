<script>
	import { listSchemas } from '$lib/api';
	import { defaultConnection } from '$lib/stores/appState.js';
	import { err } from '$lib/stores/toasts.js';
	import ThemeToggle from './ThemeToggle.svelte';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {(conn: ConnectionConfig) => void} onConnected
	 */

	/** @type {Props} */
	let { onConnected } = $props();

	let conn = $state({ ...defaultConnection });
	let pending = $state(false);

	function adjustDefaultPort() {
		if (conn.driver === 'postgresql' && conn.port === 3306) conn.port = 5432;
		else if (conn.driver === 'mysql' && conn.port === 5432) conn.port = 3306;
	}

	async function submit(e) {
		e.preventDefault();
		pending = true;
		try {
			const resp = await listSchemas(conn);
			if (!resp.success) {
				err(resp.error ?? '连接失败');
				return;
			}
			onConnected({ ...conn });
		} finally {
			pending = false;
		}
	}
</script>

<div
	class="flex min-h-screen items-center justify-center p-6"
	style="background: var(--md-background);"
>
	<div class="w-full max-w-lg">
		<div class="mb-6 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-semibold tracking-tight" style="color: var(--md-on-background);">
					idb · 数据库管理
				</h1>
				<p class="mt-1 text-sm" style="color: var(--md-on-surface-variant);">
					本地化 · 零端口 · MySQL / PostgreSQL
				</p>
			</div>
			<ThemeToggle />
		</div>

		<form
			class="grid grid-cols-2 gap-4 p-6"
			style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-lg); box-shadow: var(--md-elev-1);"
			onsubmit={submit}
		>
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">驱动</span>
				<select
					class="md-input"
					bind:value={conn.driver}
					onchange={adjustDefaultPort}
				>
					<option value="mysql">MySQL</option>
					<option value="postgresql">PostgreSQL</option>
				</select>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">主机</span>
				<input class="md-input" type="text" bind:value={conn.host} required />
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">端口</span>
				<input
					class="md-input"
					type="number"
					bind:value={conn.port}
					min="1"
					max="65535"
					required
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">用户名</span>
				<input class="md-input" type="text" bind:value={conn.user} required />
			</label>
			<label class="col-span-2 flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">密码</span>
				<input
					class="md-input"
					type="password"
					bind:value={conn.password}
					autocomplete="off"
				/>
			</label>
			<label class="col-span-2 flex flex-col gap-1 text-sm">
				<span style="color: var(--md-on-surface-variant);">默认 database（可选）</span>
				<input class="md-input" type="text" bind:value={conn.database} />
			</label>
			<button
				type="submit"
				class="md-btn-filled col-span-2 mt-2"
				disabled={pending}
			>
				{pending ? '请求中…' : '连接并加载 schema'}
			</button>
		</form>
	</div>
</div>
