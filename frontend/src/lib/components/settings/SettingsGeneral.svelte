<script>
	import { t, locale, setLocale, locales } from '$lib/i18n';
</script>

<section class="space-y-3">
	<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
		{$t('settings.language')}
	</h2>
	<select
		class="w-full md-input text-sm"
		value={$locale}
		onchange={(e) => setLocale(e.currentTarget.value)}
	>
		{#each locales as loc (loc.code)}
			<option value={loc.code}>{loc.nativeName}</option>
		{/each}
	</select>
</section>
