<script>
	import { goto } from '$app/navigation';
	import {
		themeMode,
		lightThemeId,
		darkThemeId,
		resolvedTheme,
		setTheme,
		setLightTheme,
		setDarkTheme
	} from '$lib/stores/themeStore.js';
	import { listThemes } from '$lib/api/themes.js';
	import { t, locale, setLocale, locales } from '$lib/i18n';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	/** @type {import('$lib/api/themes.js').ThemeInfo[]} */
	let themes = $state([]);
	let loading = $state(true);

	$effect(() => {
		listThemes().then((t) => {
			themes = t;
			loading = false;
		});
	});

	let lightThemes = $derived(themes.filter((th) => th.type === 'light'));
	let darkThemes = $derived(themes.filter((th) => th.type === 'dark'));

	function goBack() {
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back();
		} else {
			goto('/');
		}
	}
</script>

<div class="flex h-screen flex-col overflow-hidden" style="background: var(--md-background); color: var(--md-on-background);">
	<header
		class="flex shrink-0 items-center gap-3 px-4 py-3"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<button class="md-icon-btn" onclick={goBack} title={$t('settings.back')}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
		<h1 class="text-lg font-medium">{$t('settings.title')}</h1>
	</header>

	<main class="flex-1 overflow-auto px-6 py-6">
		<div class="mx-auto max-w-lg space-y-8">

			<!-- 语言 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">{$t('settings.language')}</h2>
				<select
					class="md-input w-full text-sm"
					value={$locale}
					onchange={(e) => setLocale(e.currentTarget.value)}
				>
					{#each locales as loc (loc.code)}
						<option value={loc.code}>{loc.nativeName}</option>
					{/each}
				</select>
			</section>

			<!-- 主题模式 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">{$t('settings.theme_mode')}</h2>
				<div class="flex items-center gap-3">
					<ThemeToggle />
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						{#if $themeMode === 'auto'}
							{$t('settings.follow_system', { theme: $resolvedTheme === 'dark' ? $t('settings.dark') : $t('settings.light') })}
						{:else if $themeMode === 'light'}
							{$t('settings.light_mode')}
						{:else}
							{$t('settings.dark_mode')}
						{/if}
					</span>
				</div>
			</section>

			<!-- 浅色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">{$t('settings.light_theme')}</h2>
				{#if loading}
					<p class="text-xs animate-pulse" style="color: var(--md-on-surface-variant);">{$t('common.loading')}</p>
				{:else}
					<select
						class="md-input w-full text-sm"
						value={$lightThemeId}
						onchange={(e) => setLightTheme(e.currentTarget.value)}
					>
						<option value="">{$t('settings.builtin_light')}</option>
						{#each lightThemes as th (th.id)}
							<option value={th.id}>{th.name}</option>
						{/each}
					</select>
					{#if lightThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							{$t('settings.theme_help', { mode: $t('settings.light') })}
							<code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/</code>
						</p>
					{/if}
				{/if}
			</section>

			<!-- 深色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">{$t('settings.dark_theme')}</h2>
				{#if loading}
					<p class="text-xs animate-pulse" style="color: var(--md-on-surface-variant);">{$t('common.loading')}</p>
				{:else}
					<select
						class="md-input w-full text-sm"
						value={$darkThemeId}
						onchange={(e) => setDarkTheme(e.currentTarget.value)}
					>
						<option value="">{$t('settings.builtin_dark')}</option>
						{#each darkThemes as th (th.id)}
							<option value={th.id}>{th.name}</option>
						{/each}
					</select>
					{#if darkThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							{$t('settings.theme_help', { mode: $t('settings.dark') })}
							<code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/</code>
						</p>
					{/if}
				{/if}
			</section>

			<!-- 主题文件说明 -->
			<section
				class="rounded-lg p-4 text-xs leading-relaxed"
				style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);"
			>
				<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">{$t('settings.custom_theme_format')}</h3>
				<pre class="overflow-auto font-mono text-[11px] leading-relaxed" style="color: var(--md-on-surface-variant);">{`/* @idb-theme
   name: Cyberpunk
   type: dark
*/

:root {
  --md-primary: #00f0ff;
  --md-on-primary: #00363b;
  /* ... */
}`}</pre>
				<p class="mt-2">
					{$t('settings.file_path')}<code class="font-mono text-[11px]" style="color: var(--md-primary);">~/.config/idb/theme/*.css</code>
				</p>
				<p class="mt-1">
					<code class="font-mono text-[11px]">type</code> {$t('settings.type_hint')}
					{$t('settings.vars_hint')}
				</p>
			</section>

		</div>
	</main>
</div>
