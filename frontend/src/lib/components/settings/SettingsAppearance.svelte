<script>
	import {
		themeMode,
		lightThemeId,
		darkThemeId,
		resolvedTheme,
		setLightTheme,
		setDarkTheme
	} from '$lib/stores/themeStore.js';
	import { listThemes } from '$lib/api/themes.js';
	import { t } from '$lib/i18n';
	import { ThemeToggle } from '$lib/components/ui/index.js';

	/** @type {import('$lib/api/themes.js').ThemeInfo[]} */
	let themes = $state([]);
	let loading = $state(true);

	$effect(() => {
		listThemes().then((th) => {
			themes = th;
			loading = false;
		});
	});

	let lightThemes = $derived(themes.filter((th) => th.type === 'light'));
	let darkThemes = $derived(themes.filter((th) => th.type === 'dark'));
</script>

<div class="space-y-8">
	<!-- 主题模式 -->
	<section class="space-y-3">
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
			{$t('settings.theme_mode')}
		</h2>
		<div class="flex items-center gap-3">
			<ThemeToggle />
			<span class="text-xs" style="color: var(--md-on-surface-variant);">
				{#if $themeMode === 'auto'}
					{$t('settings.follow_system', {
						theme: $resolvedTheme === 'dark' ? $t('settings.dark') : $t('settings.light')
					})}
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
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
			{$t('settings.light_theme')}
		</h2>
		{#if loading}
			<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
				{$t('common.loading')}
			</p>
		{:else}
			<select
				class="w-full md-input text-sm"
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
					<code class="font-mono text-[11px]" style="color: var(--md-primary);"
						>~/.config/idb/theme/</code
					>
				</p>
			{/if}
		{/if}
	</section>

	<!-- 深色主题 -->
	<section class="space-y-3">
		<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
			{$t('settings.dark_theme')}
		</h2>
		{#if loading}
			<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
				{$t('common.loading')}
			</p>
		{:else}
			<select
				class="w-full md-input text-sm"
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
					<code class="font-mono text-[11px]" style="color: var(--md-primary);"
						>~/.config/idb/theme/</code
					>
				</p>
			{/if}
		{/if}
	</section>

	<!-- 主题文件说明 -->
	<section
		class="rounded-lg p-4 text-xs leading-relaxed"
		style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);"
	>
		<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
			{$t('settings.custom_theme_format')}
		</h3>
		<pre
			class="overflow-auto font-mono text-[11px] leading-relaxed"
			style="color: var(--md-on-surface-variant);">{`/* @idb-theme
   name: Cyberpunk
   type: dark
*/

:root {
  --md-primary: #00f0ff;
  --md-on-primary: #00363b;
  /* ... */
}`}</pre>
		<p class="mt-2">
			{$t('settings.file_path')}<code
				class="font-mono text-[11px]"
				style="color: var(--md-primary);">~/.config/idb/theme/*.css</code
			>
		</p>
		<p class="mt-1">
			<code class="font-mono text-[11px]">type</code>
			{$t('settings.type_hint')}
			{$t('settings.vars_hint')}
		</p>
	</section>
</div>
