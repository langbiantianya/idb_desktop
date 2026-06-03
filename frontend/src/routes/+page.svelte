<script>
	import { goto } from '$app/navigation';
	import { activeConnection } from '$lib/stores/appState.js';
	import ConnectionForm from '$lib/components/ConnectionForm.svelte';
	import { t } from '$lib/i18n';
</script>

<svelte:head>
	<title>{$t('conn.title')}</title>
</svelte:head>

<ConnectionForm
	onConnected={(conn) => {
		activeConnection.set(conn);
		goto('/workspace');
	}}
/>
