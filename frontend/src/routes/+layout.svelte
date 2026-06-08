<script>
	import './layout.css';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import favicon from '$lib/assets/favicon.svg';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import { initTheme, setupComplete, settingsLoaded } from '$lib/stores/themeStore.js';
	import { showSettings, closeSettings } from '$lib/stores/overlayStore.js';
	import { IsDevMode } from '../../wailsjs/go/main/App.js';

	let { children } = $props();
	let devMode = $state(false);

	/** 当前路由路径，用于触发页面切换动画 */
	let currentPath = $state('');
	/** 前一个路由路径，用于判断动画方向 */
	let prevPath = $state('');

	/** MD3 emphasized decelerate */
	function mdDecelerate(/** @type {number} */ t) {
		return 1 - Math.pow(1 - t, 3);
	}

	/** 判断是否为"返回"方向（workspace→连接页 / settings→上级） */
	function isBackNav(/** @type {string} */ from, /** @type {string} */ to) {
		// workspace → 首页 = 返回
		if (from.startsWith('/workspace') && to === '/') return true;
		// setup → 首页 = 返回
		if (from === '/setup' && to === '/') return true;
		return false;
	}

	// 初始页面加载标记：首次渲染的 div 不播放路由动画。
	// $effect.pre 在首次 DOM 提交后将 firstRender 置 false；
	// 后续路由变化时 {#key} 重渲染创建新 div，此时 firstRender 已为 false → 播放动画。
	let firstRender = true;

	// 路由变化时更新路径（触发 {#key} 重渲染 + 动画）
	$effect.pre(() => {
		prevPath = currentPath;
		currentPath = page.url.pathname;
		firstRender = false;
	});

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
{#key currentPath}
	{@const back = isBackNav(prevPath, currentPath)}
	<!-- svelte-ignore non_reactive_update -->
	<div
		class="h-screen"
		in:fly={firstRender ? undefined : { x: back ? 300 : -300, duration: 350, easing: mdDecelerate }}
		out:fly={firstRender ? undefined : { x: back ? -300 : 300, duration: 250, easing: cubicOut }}
	>
		{@render children()}
	</div>
{/key}
<ToastHost />

<!-- 设置覆盖层（全局，不销毁当前页面状态） -->
{#if $showSettings}
	<div
		class="fixed inset-0 z-[90]"
		in:fly={{ x: 300, duration: 350, easing: mdDecelerate }}
		out:fly={{ x: 300, duration: 250, easing: cubicOut }}
	>
		<SettingsPanel onClose={closeSettings} />
	</div>
{/if}
