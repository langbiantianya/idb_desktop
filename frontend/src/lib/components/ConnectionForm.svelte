<script>
	import { listSchemas } from '$lib/api';
	import { defaultConnection } from '$lib/stores/appState.js';
	import { err } from '$lib/stores/toasts.js';

	/**
	 * @typedef {import('$lib/api').ConnectionConfig} ConnectionConfig
	 * @typedef {Object} Props
	 * @property {(conn: ConnectionConfig) => void} onConnected   连接成功后回调，父组件登记 baseConn
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

<form
	class="grid grid-cols-2 gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
	onsubmit={submit}
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
		<span class="text-slate-600">默认 database（可选，连接后再选 schema）</span>
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
		{pending ? '请求中…' : '连接并加载 schema'}
	</button>
</form>
