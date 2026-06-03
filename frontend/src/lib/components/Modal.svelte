<script>
	import { t } from '$lib/i18n';
	/**
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {string} [title]
	 * @property {string} [size]   - sm | md | lg
	 * @property {() => void} onClose
	 * @property {import('svelte').Snippet} [children]
	 * @property {import('svelte').Snippet} [footer]
	 */

	/** @type {Props} */
	let { open, title = '', size = 'md', onClose, children, footer } = $props();

	const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

	function onKey(e) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={open ? onKey : null} />

{#if open}
	<div
		class="fixed inset-0 z-40 flex items-start justify-center p-6"
		style="background: color-mix(in srgb, var(--md-scrim) 40%, transparent);"
	>
		<div
			class="mt-16 flex w-full {widths[size] ?? widths.md} flex-col gap-4 p-6"
			style="background: var(--md-surface-container-high); color: var(--md-on-surface); border-radius: var(--md-radius-lg); box-shadow: var(--md-elev-3);"
			role="dialog"
			aria-modal="true"
		>
			{#if title}
				<header class="flex items-start justify-between">
					<h2 class="text-base font-semibold" style="color: var(--md-on-surface);">{title}</h2>
					<button
						class="md-icon-btn"
						onclick={onClose}
						aria-label={$t('common.close_label')}
					>
						✕
					</button>
				</header>
			{/if}
			<div class="text-sm" style="color: var(--md-on-surface);">
				{@render children?.()}
			</div>
			{#if footer}
				<footer class="flex justify-end gap-2 pt-2">
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
