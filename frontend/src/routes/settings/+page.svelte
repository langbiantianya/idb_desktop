<script>
	import { goto } from '$app/navigation';
	import {
		themeMode,
		lightThemeId,
		darkThemeId,
		resolvedTheme,
		settingsLoaded,
		setTheme,
		setLightTheme,
		setDarkTheme
	} from '$lib/stores/themeStore.js';
	import { listThemes } from '$lib/api/themes.js';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	/** @type {import('$lib/api/themes.js').ThemeInfo[]} */
	let themes = $state([]);
	let loading = $state(true);

	// 从 Go 加载自定义主题列表
	$effect(() => {
		listThemes().then((t) => {
			themes = t;
			loading = false;
		});
	});

	let lightThemes = $derived(themes.filter((t) => t.type === 'light'));
	let darkThemes = $derived(themes.filter((t) => t.type === 'dark'));

	function goBack() {
		// 简单返回：如果有历史就回去，否则去首页
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back();
		} else {
			goto('/');
		}
	}
</script>

<div class="flex h-screen flex-col overflow-hidden" style="background: var(--md-background); color: var(--md-on-background);">
	<!-- 顶栏 -->
	<header
		class="flex shrink-0 items-center gap-3 px-4 py-3"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<button class="md-icon-btn" onclick={goBack} title="返回">
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<h1 class="text-lg font-medium">设置</h1>
	</header>

	<!-- 内容 -->
	<main class="flex-1 overflow-auto px-6 py-6">
		<div class="mx-auto max-w-lg space-y-8">

			<!-- 主题模式 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">主题模式</h2>
				<div class="flex items-center gap-3">
					<ThemeToggle />
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						{#if $themeMode === 'auto'}
							跟随系统（当前：{$resolvedTheme === 'dark' ? '深色' : '浅色'}）
						{:else if $themeMode === 'light'}
							浅色模式
						{:else}
							深色模式
						{/if}
					</span>
				</div>
			</section>

			<!-- 浅色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">浅色主题</h2>
				{#if loading}
					<p class="text-xs animate-pulse" style="color: var(--md-on-surface-variant);">加载中…</p>
				{:else}
					<select
						class="md-input w-full text-sm"
						value={$lightThemeId}
						onchange={(e) => setLightTheme(e.currentTarget.value)}
					>
						<option value="">MD3 亮色（内置）</option>
						{#each lightThemes as t (t.id)}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
					{#if lightThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							将浅色主题 .css 文件放入 <code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/</code> 目录即可
						</p>
					{/if}
				{/if}
			</section>

			<!-- 深色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">深色主题</h2>
				{#if loading}
					<p class="text-xs animate-pulse" style="color: var(--md-on-surface-variant);">加载中…</p>
				{:else}
					<select
						class="md-input w-full text-sm"
						value={$darkThemeId}
						onchange={(e) => setDarkTheme(e.currentTarget.value)}
					>
						<option value="">MD3 暗色（内置）</option>
						{#each darkThemes as t (t.id)}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
					{#if darkThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							将深色主题 .css 文件放入 <code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/</code> 目录即可
						</p>
					{/if}
				{/if}
			</section>

			<!-- 主题文件说明 -->
			<section
				class="rounded-lg p-4 text-xs leading-relaxed"
				style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);"
			>
				<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">自定义主题文件格式</h3>
				<pre class="overflow-auto font-mono text-[11px] leading-relaxed" style="color: var(--md-on-surface-variant);">{`/* @idb-theme
   name: 霓虹紫
   type: dark
*/

:root {
  --md-primary: #D0BCFF;
  --md-on-primary: #381E72;
  --md-primary-container: #4F378B;
  --md-on-primary-container: #EADDFF;
  /* ... 其他 MD3 变量 ... */
}`}</pre>
				<p class="mt-2">
					文件路径：<code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/*.css</code>
				</p>
				<p class="mt-1">
					<code class="font-mono text-[11px]">type</code> 决定主题出现在哪个分组。
					完整变量列表请参考内置主题。
				</p>
			</section>

		</div>
	</main>
</div>
