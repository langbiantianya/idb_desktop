<script>
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { initTheme } from '$lib/stores/themeStore.js';
	import { IsDevMode } from '../../wailsjs/go/main/App.js';

	let { children } = $props();
	let devMode = $state(false);

	$effect(() => {
		initTheme();
		IsDevMode().then((v) => (devMode = v));
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window oncontextmenu={devMode ? undefined : (e) => e.preventDefault()} />
{@render children()}
<ToastHost />
