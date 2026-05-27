<script>
	import { toasts } from '$lib/stores/toasts.js';
</script>

<div class="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2">
	{#each $toasts as t (t.id)}
		<div
			class="pointer-events-auto px-4 py-3 text-sm"
			style:background={t.kind === 'ok' ? 'var(--md-success-container)' : 'var(--md-error-container)'}
			style:color={t.kind === 'ok' ? 'var(--md-on-success-container)' : 'var(--md-on-error-container)'}
			style="border-radius: var(--md-radius-md); box-shadow: var(--md-elev-2);"
		>
			<span class="mr-2 font-semibold">{t.kind === 'ok' ? '✓' : '✗'}</span>
			{t.text}
		</div>
	{/each}
</div>
