<script>
	/**
	 * @typedef {Object} Props
	 * @property {string} value
	 * @property {string[]} options
	 * @property {string} [placeholder]
	 * @property {boolean} [disabled]
	 * @property {(value: string) => void} [onchange]
	 */

	/** @type {Props} */
	let {
		value = $bindable(''),
		options = [],
		placeholder = '',
		disabled = false,
		onchange
	} = $props();

	let open = $state(false);
	let filter = $state('');
	let highlightIdx = $state(0);
	let inputEl = $state(/** @type {HTMLInputElement | null} */ (null));
	let listEl = $state(/** @type {HTMLUListElement | null} */ (null));
	let closeTimer = $state(/** @type {ReturnType<typeof setTimeout>} */ (0));

	// 定位用
	let listTop = $state(0);
	let listLeft = $state(0);
	let listWidth = $state(0);

	let filtered = $derived(
		filter ? options.filter((o) => o.toLowerCase().includes(filter.toLowerCase())) : options
	);

	$effect(() => {
		if (highlightIdx >= filtered.length) highlightIdx = Math.max(0, filtered.length - 1);
	});

	function updatePosition() {
		if (!inputEl) return;
		const rect = inputEl.getBoundingClientRect();
		listTop = rect.bottom + 2;
		listLeft = rect.left;
		listWidth = rect.width;
	}

	function handleFocus() {
		filter = value;
		open = true;
		updatePosition();
	}

	function handleBlur() {
		closeTimer = setTimeout(() => {
			open = false;
			if (filter && filter !== value) {
				value = filter;
				onchange?.(value);
			}
		}, 150);
	}

	/** @param {string} opt */
	function selectOption(opt) {
		clearTimeout(closeTimer);
		value = opt;
		filter = opt;
		open = false;
		onchange?.(value);
		inputEl?.focus();
	}

	/** @param {KeyboardEvent} e */
	function handleKeydown(e) {
		if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			open = true;
			filter = value;
			updatePosition();
			return;
		}
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				if (highlightIdx < filtered.length - 1) highlightIdx++;
				scrollToHighlighted();
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (highlightIdx > 0) highlightIdx--;
				scrollToHighlighted();
				break;
			case 'Enter':
				e.preventDefault();
				if (open && filtered.length > 0) selectOption(filtered[highlightIdx]);
				break;
			case 'Escape':
				open = false;
				filter = value;
				break;
		}
	}

	function scrollToHighlighted() {
		if (!listEl) return;
		const item = /** @type {HTMLElement | null} */ (listEl.children[highlightIdx]);
		if (item) item.scrollIntoView({ block: 'nearest' });
	}

	/** @param {Event} e */
	function handleInput(e) {
		filter = /** @type {HTMLInputElement} */ (e.target).value;
		value = filter;
		highlightIdx = 0;
		open = true;
		updatePosition();
		onchange?.(value);
	}
</script>

<svelte:window
	onscroll={() => open && updatePosition()}
	onresize={() => open && updatePosition()}
/>

<div class="relative min-w-28">
	<input
		bind:this={inputEl}
		class="w-full md-input disabled:cursor-not-allowed disabled:opacity-50"
		type="text"
		{value}
		{placeholder}
		{disabled}
		onfocus={handleFocus}
		onblur={handleBlur}
		oninput={handleInput}
		onkeydown={handleKeydown}
		autocomplete="off"
		role="combobox"
		aria-expanded={open}
		aria-haspopup="listbox"
	/>
</div>

{#if open && filtered.length > 0}
	<ul
		bind:this={listEl}
		class="fixed z-[9999] m-0 max-h-50 list-none overflow-y-auto border p-0.5"
		style="
			top: {listTop}px;
			left: {listLeft}px;
			width: {listWidth}px;
			background: var(--md-surface-container);
			border-color: var(--md-outline-variant);
			border-radius: var(--md-radius-xs);
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		"
		role="listbox"
	>
		{#each filtered as opt, i (opt)}
			{@const selected = opt === value}
			<li
				class="cursor-pointer px-3 py-1.5 text-[0.8125rem] transition-colors duration-75"
				class:cbx-active={i === highlightIdx}
				style:color={selected ? 'var(--md-primary)' : 'var(--md-on-surface)'}
				style:font-weight={selected ? '500' : '400'}
				role="option"
				aria-selected={selected}
				onmousedown={(e) => {
					e.preventDefault();
					selectOption(opt);
				}}
				onmouseenter={() => (highlightIdx = i)}
			>
				{opt}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.cbx-active {
		background: color-mix(in srgb, var(--md-primary) 12%, transparent);
	}
</style>
