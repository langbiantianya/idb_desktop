<script>
	/**
	 * @typedef {Object} Props
	 * @property {'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'icon'} [variant]
	 * @property {'sm' | 'md' | 'lg'} [size]
	 * @property {boolean} [disabled]
	 * @property {'button' | 'submit' | 'reset'} [type]
	 * @property {string} [title]
	 * @property {string} [ariaLabel]
	 * @property {string} [class]
	 * @property {import('svelte').Snippet} [children]
	 * @property {(e: MouseEvent) => void} [onclick]
	 */

	/** @type {Props & Record<string, unknown>} */
	let {
		variant = 'filled',
		size = 'md',
		disabled = false,
		type = 'button',
		title = undefined,
		ariaLabel = undefined,
		class: className = '',
		children,
		onclick,
		...rest
	} = $props();
</script>

<button
	{type}
	{disabled}
	{title}
	aria-label={ariaLabel}
	class="md-btn md-btn-{variant} md-btn-{size} {className}"
	{onclick}
	{...rest}
>
	{#if children}
		{@render children()}
	{/if}
</button>

<style>
	/* ── Base ── */
	.md-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		border: none;
		cursor: pointer;
		white-space: nowrap;
		user-select: none;
		-webkit-user-select: none;
		outline: none;
		line-height: 1;
		font-family: inherit;
	}
	.md-btn:focus-visible {
		outline: 2px solid var(--md-primary);
		outline-offset: 2px;
	}

	/* ── Sizes ── */
	.md-btn-sm {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		border-radius: var(--md-radius-full);
	}
	.md-btn-md {
		padding: 0.4rem 0.75rem;
		font-size: 0.8125rem;
		border-radius: var(--md-radius-full);
	}
	.md-btn-lg {
		padding: 0.625rem 1.5rem;
		font-size: 1rem;
		font-weight: 500;
		border-radius: var(--md-radius-full);
	}

	/* ── Icon size overrides ── */
	.md-btn-icon.md-btn-sm {
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border-radius: var(--md-radius-full);
	}
	.md-btn-icon.md-btn-md {
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: var(--md-radius-full);
	}
	.md-btn-icon.md-btn-lg {
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border-radius: var(--md-radius-full);
	}

	/* ── Variant: Filled ── */
	.md-btn-filled {
		background: var(--md-primary);
		color: var(--md-on-primary);
		transition: filter 120ms ease, box-shadow 120ms ease;
	}
	.md-btn-filled:hover:not(:disabled) {
		filter: brightness(1.05);
		box-shadow: var(--md-elev-1);
	}

	/* ── Variant: Tonal ── */
	.md-btn-tonal {
		background: var(--md-secondary-container);
		color: var(--md-on-secondary-container);
		transition: filter 120ms ease;
	}
	.md-btn-tonal:hover:not(:disabled) {
		filter: brightness(0.96);
	}

	/* ── Variant: Outlined ── */
	.md-btn-outlined {
		background: transparent;
		color: var(--md-primary);
		border: 1px solid var(--md-outline);
		transition: background 120ms ease;
	}
	.md-btn-outlined:hover:not(:disabled) {
		background: color-mix(in srgb, var(--md-primary) 8%, transparent);
	}

	/* ── Variant: Text ── */
	.md-btn-text {
		background: transparent;
		color: var(--md-primary);
		transition: background 120ms ease;
	}
	.md-btn-text:hover:not(:disabled) {
		background: color-mix(in srgb, var(--md-primary) 8%, transparent);
	}

	/* ── Variant: Danger ── */
	.md-btn-danger {
		background: var(--md-error);
		color: var(--md-on-error);
		transition: filter 120ms ease;
	}
	.md-btn-danger:hover:not(:disabled) {
		filter: brightness(1.05);
	}

	/* ── Variant: Icon ── */
	.md-btn-icon {
		color: var(--md-on-surface-variant);
		background: transparent;
		transition: background 120ms ease, color 120ms ease;
	}
	.md-btn-icon:hover:not(:disabled) {
		background: color-mix(in srgb, var(--md-on-surface) 8%, transparent);
		color: var(--md-on-surface);
	}

	/* ── Disabled (all variants) ── */
	.md-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
