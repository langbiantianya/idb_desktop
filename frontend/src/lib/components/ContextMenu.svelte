<script>
	/**
	 * @typedef {Object} MenuItem
	 * @property {string} label
	 * @property {string} [icon]
	 * @property {() => void} [onClick]
	 * @property {boolean} [danger]
	 * @property {boolean} [disabled]
	 */

	/**
	 * @typedef {Object} Props
	 * @property {{ x: number; y: number; items: MenuItem[] } | null} open
	 * @property {() => void} onClose
	 */

	/** @type {Props} */
	let { open, onClose } = $props();

	function handleItemClick(item) {
		if (item.disabled) return;
		item.onClick?.();
		onClose();
	}
</script>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-50 cursor-default"
		style="background: transparent;"
		aria-label="关闭菜单"
		onclick={onClose}
		oncontextmenu={(e) => { e.preventDefault(); onClose(); }}
	></button>
	<div
		role="menu"
		class="fixed z-50 flex min-w-[11rem] flex-col py-1 text-xs"
		style:left="{open.x}px"
		style:top="{open.y}px"
		style="background: var(--md-surface-container-high); color: var(--md-on-surface); border: 1px solid var(--md-outline-variant); border-radius: var(--md-radius-md); box-shadow: var(--md-elev-3);"
	>
		{#each open.items as item, i (i)}
			{#if item === null}
				<div style="height: 1px; background: var(--md-outline-variant); margin: 0.25rem 0;"></div>
			{:else}
				<button
					type="button"
					role="menuitem"
					class="context-menu-item"
					class:danger={item.danger}
					class:disabled={item.disabled}
					onclick={() => handleItemClick(item)}
					disabled={item.disabled}
				>
					{#if item.icon}
						<span class="context-menu-icon" style={item.danger ? 'color: var(--md-error);' : ''}>{item.icon}</span>
					{/if}
					<span class="context-menu-label" style={item.danger ? 'color: var(--md-error);' : ''}>{item.label}</span>
				</button>
			{/if}
		{/each}
	</div>
{/if}

<svelte:window
	onkeydown={open ? (e) => { if (e.key === 'Escape') onClose(); } : null}
/>

<style>
	.context-menu-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.5rem 0.875rem;
		text-align: left;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background-color 80ms ease;
	}
	.context-menu-item:hover:not(.disabled) {
		background: color-mix(in srgb, var(--md-on-surface) 8%, transparent);
	}
	.context-menu-item.disabled {
		color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
		cursor: not-allowed;
	}
	.context-menu-icon {
		width: 1rem;
		text-align: center;
		color: var(--md-on-surface-variant);
		flex-shrink: 0;
	}
	.context-menu-label {
		flex: 1;
		color: var(--md-on-surface);
	}
</style>