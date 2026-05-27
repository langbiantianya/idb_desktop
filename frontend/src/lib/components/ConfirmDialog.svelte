<script>
	import Modal from './Modal.svelte';

	/**
	 * @typedef {Object} Props
	 * @property {boolean} open
	 * @property {string} title
	 * @property {string} message
	 * @property {string} [confirmText]
	 * @property {string} [cancelText]
	 * @property {boolean} [danger]
	 * @property {boolean} [pending]
	 * @property {() => void | Promise<void>} onConfirm
	 * @property {() => void} onCancel
	 */

	/** @type {Props} */
	let {
		open,
		title,
		message,
		confirmText = '确认',
		cancelText = '取消',
		danger = false,
		pending = false,
		onConfirm,
		onCancel
	} = $props();
</script>

<Modal {open} {title} size="sm" onClose={onCancel}>
	<p class="leading-relaxed whitespace-pre-line" style="color: var(--md-on-surface-variant);">{message}</p>
	{#snippet footer()}
		<button class="md-btn-text" onclick={onCancel} disabled={pending}>
			{cancelText}
		</button>
		<button
			class={danger ? 'md-btn-danger' : 'md-btn-filled'}
			onclick={onConfirm}
			disabled={pending}
		>
			{pending ? '处理中…' : confirmText}
		</button>
	{/snippet}
</Modal>
