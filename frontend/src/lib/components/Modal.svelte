<script>
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
	<div class="fixed inset-0 z-40 flex items-start justify-center bg-slate-900/40 p-6">
		<div
			class="mt-16 flex w-full {widths[size] ?? widths.md} flex-col gap-4 rounded-2xl bg-white p-6 shadow-xl"
			role="dialog"
			aria-modal="true"
		>
			{#if title}
				<header class="flex items-start justify-between">
					<h2 class="text-base font-semibold text-slate-900">{title}</h2>
					<button
						class="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
						onclick={onClose}
						aria-label="关闭"
					>
						✕
					</button>
				</header>
			{/if}
			<div class="text-sm text-slate-700">
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
