<script>
	import './layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import { initTheme, setupComplete, settingsLoaded } from '$lib/stores/themeStore.js';
	import { IsDevMode } from '../../wailsjs/go/main/App.js';

	let { children } = $props();
	let devMode = $state(false);

	$effect(() => {
		initTheme();
		IsDevMode().then((v) => (devMode = v));
	});

	// 设置加载完成后，未完成引导则跳转 /setup（已在 /setup 则不跳）
	$effect(() => {
		if ($settingsLoaded && !$setupComplete && page.url.pathname !== '/setup') {
			goto('/setup');
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<svelte:window oncontextmenu={devMode ? undefined : (e) => e.preventDefault()} />
{@render children()}
<ToastHost />
