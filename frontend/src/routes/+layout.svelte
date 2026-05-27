<script>
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { initTheme } from '$lib/stores/themeStore.js';

	let { children } = $props();

	$effect(() => {
		initTheme();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<ToastHost />
