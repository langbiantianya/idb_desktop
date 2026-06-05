<script>
	import { toasts, dismissToast } from '$lib/stores/toasts.js';
	import { t } from '$lib/i18n';
</script>

<div class="pointer-events-none fixed bottom-4 right-4 z-100 flex w-80 flex-col gap-2">
	{#each $toasts as toast (toast.id)}
		<div
			class="pointer-events-auto flex items-start gap-2 px-4 py-3 text-sm"
			style:background={toast.kind === 'ok' ? 'var(--md-success-container)' : 'var(--md-error-container)'}
			style:color={toast.kind === 'ok' ? 'var(--md-on-success-container)' : 'var(--md-on-error-container)'}
			style="border-radius: var(--md-radius-md); box-shadow: var(--md-elev-2);"
		>
			<span class="flex-1">{toast.text}</span>
			<button
				type="button"
				class="toast-close"
				onclick={() => dismissToast(toast.id)}
				aria-label={$t('common.close_label')}
			>✕</button>
		</div>
	{/each}
</div>

<style>
	.toast-close {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		font-size: 0.75rem;
		line-height: 1;
		color: inherit;
		opacity: 0.6;
		background: none;
		border: none;
		border-radius: 50%;
		cursor: pointer;
		transition: opacity 120ms ease, background-color 120ms ease;
	}
	.toast-close:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}
</style>
