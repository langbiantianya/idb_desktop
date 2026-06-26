<script>
	/** @typedef {Object} Props
	 * @property {() => void} onClose
	 */

	/** @type {Props} */
	let { onClose } = $props();

	import { t } from '$lib/i18n';
	import { MdButton } from '$lib/components/ui/index.js';
	import SettingsGeneral from './settings/SettingsGeneral.svelte';
	import SettingsAppearance from './settings/SettingsAppearance.svelte';
	import SettingsPerformance from './settings/SettingsPerformance.svelte';
	import SettingsSystem from './settings/SettingsSystem.svelte';
	import SettingsAbout from './settings/SettingsAbout.svelte';

	/** @type {'general' | 'appearance' | 'performance' | 'system' | 'about'} */
	let activeSection = $state('general');

	const sections = [
		{ id: 'general', i18nKey: 'settings.nav.general', icon: 'general' },
		{ id: 'appearance', i18nKey: 'settings.nav.appearance', icon: 'appearance' },
		{ id: 'performance', i18nKey: 'settings.nav.performance', icon: 'performance' },
		{ id: 'system', i18nKey: 'settings.nav.system', icon: 'system' },
		{ id: 'about', i18nKey: 'settings.nav.about', icon: 'about' }
	];
</script>

<div
	class="flex h-full flex-col overflow-hidden"
	style="background: var(--md-background); color: var(--md-on-background);"
>
	<header
		class="flex shrink-0 items-center gap-3 px-4 py-3"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<MdButton variant="icon" onclick={onClose} title={$t('settings.back')}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M12.5 15L7.5 10L12.5 5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</MdButton>
		<h1 class="text-lg font-medium">{$t('settings.title')}</h1>
	</header>

	<div class="flex min-h-0 flex-1">
		<!-- 左侧导航 -->
		<nav
			class="flex shrink-0 flex-col gap-1 overflow-auto px-2 py-3"
			style="width: 140px; background: var(--md-surface-container-low); border-right: 1px solid var(--md-outline-variant);"
		>
			{#each sections as sec (sec.id)}
				{@const active = activeSection === sec.id}
				<button
					class="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors"
					style:background={active
						? 'color-mix(in srgb, var(--md-primary) 12%, transparent)'
						: 'transparent'}
					style:color={active ? 'var(--md-primary)' : 'var(--md-on-surface-variant)'}
					onclick={() => (activeSection = /** @type {any} */ (sec.id))}
				>
					{#if sec.icon === 'general'}
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<circle cx="10" cy="7" r="3" stroke="currentColor" stroke-width="1.5" />
							<path
								d="M4 17c0-3.3 2.7-5 6-5s6 1.7 6 5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
							/>
						</svg>
					{:else if sec.icon === 'appearance'}
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" />
							<path d="M10 3v14" stroke="currentColor" stroke-width="1.5" />
							<path d="M10 3a7 7 0 010 14" fill="currentColor" opacity="0.2" />
						</svg>
					{:else if sec.icon === 'performance'}
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<path
								d="M3 14l3-6 3 4 3-8 5 10"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{:else if sec.icon === 'system'}
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<rect
								x="3"
								y="4"
								width="14"
								height="10"
								rx="1.5"
								stroke="currentColor"
								stroke-width="1.5"
							/>
							<path d="M7 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
							<path d="M10 14v3" stroke="currentColor" stroke-width="1.5" />
						</svg>
					{:else if sec.icon === 'about'}
						<svg width="18" height="18" viewBox="0 0 20 20" fill="none">
							<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" />
							<path d="M10 9v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
							<circle cx="10" cy="6.5" r="0.75" fill="currentColor" />
						</svg>
					{/if}
					{$t(sec.i18nKey)}
				</button>
			{/each}
		</nav>

		<!-- 右侧内容区 -->
		<main class="flex-1 overflow-auto px-6 py-6">
			<div class="mx-auto max-w-lg">
				{#if activeSection === 'general'}
					<SettingsGeneral />
				{:else if activeSection === 'appearance'}
					<SettingsAppearance />
				{:else if activeSection === 'performance'}
					<SettingsPerformance />
				{:else if activeSection === 'system'}
					<SettingsSystem />
				{:else if activeSection === 'about'}
					<SettingsAbout />
				{/if}
			</div>
		</main>
	</div>
</div>
