<script>
	import { t } from '$lib/i18n';
	import { BrowserOpenURL } from '../../../../wailsjs/runtime/runtime.js';

	const GITHUB_URL = 'https://github.com/langbiantianya/idb_desktop';
	const ISSUES_URL = 'https://github.com/langbiantianya/idb_desktop/issues';

	const VERSION = '0.1.0';
</script>

<section class="space-y-6">
	<!-- 应用信息 -->
	<div class="flex flex-col items-center gap-3 py-4">
		<div
			class="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold"
			style="background: var(--md-primary); color: var(--md-on-primary);"
		>
			IDB
		</div>
		<div class="text-center">
			<h2 class="text-base font-semibold" style="color: var(--md-on-surface);">IDB Desktop</h2>
			<p class="text-xs" style="color: var(--md-on-surface-variant);">
				{$t('about.version')} {VERSION}
			</p>
		</div>
	</div>

	<!-- 链接列表 -->
	<div class="space-y-2">
		<button
			type="button"
			onclick={() => BrowserOpenURL(GITHUB_URL)}
			class="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors"
			style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface); cursor: pointer;"
		>
			<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path
					d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"
				/>
			</svg>
			<div class="flex-1 text-left">
				<p class="text-sm font-medium">{$t('about.github')}</p>
				<p class="text-[11px] font-mono" style="color: var(--md-on-surface-variant);">
					{GITHUB_URL}
				</p>
			</div>
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="color: var(--md-on-surface-variant);">
				<path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>

		<button
			class="flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-colors"
			style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface); cursor: pointer;"
			onclick={() => BrowserOpenURL(ISSUES_URL)}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.5" />
				<circle cx="10" cy="10" r="1.5" fill="currentColor" />
				<path d="M10 5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
			</svg>
			<div class="flex-1 text-left">
				<p class="text-sm font-medium">{$t('about.issues')}</p>
				<p class="text-[11px] font-mono" style="color: var(--md-on-surface-variant);">
					{ISSUES_URL}
				</p>
			</div>
			<svg width="16" height="16" viewBox="0 0 20 20" fill="none" style="color: var(--md-on-surface-variant);">
				<path d="M8 5l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		</button>

	<!-- 版权信息 -->
	<p class="pt-4 text-center text-[11px]" style="color: var(--md-on-surface-variant);">
		Copyright © 2026 langbiantianya
	</p>
</section>
