<script>
	import { themeMode, setTheme } from '$lib/stores/themeStore.js';

	const options = [
		{ value: 'light', label: '☀', title: '浅色' },
		{ value: 'auto', label: '⌬', title: '跟随系统' },
		{ value: 'dark', label: '☾', title: '深色' }
	];
</script>

<div
	class="inline-flex items-center gap-0.5 rounded-full border p-0.5"
	style="background: var(--md-surface-container); border-color: var(--md-outline-variant);"
>
	{#each options as opt (opt.value)}
		<button
			type="button"
			title={opt.title}
			class="rounded-full px-2 py-0.5 text-xs transition"
			style:background={$themeMode === opt.value ? 'var(--md-primary)' : 'transparent'}
			style:color={$themeMode === opt.value
				? 'var(--md-on-primary)'
				: 'var(--md-on-surface-variant)'}
			onclick={() => setTheme(/** @type {any} */ (opt.value))}
		>
			{opt.label}
		</button>
	{/each}
</div>
