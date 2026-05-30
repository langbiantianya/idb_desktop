<script>
	import { goto } from '$app/navigation';
	import { activeConnection } from '$lib/stores/appState.js';
	import ConnectionForm from '$lib/components/ConnectionForm.svelte';
</script>

<svelte:head>
	<title>IDB Desktop — 连接</title>
</svelte:head>

<ConnectionForm
	onConnected={(conn) => {
		activeConnection.set(conn);
		goto('/workspace');
	}}
/>
