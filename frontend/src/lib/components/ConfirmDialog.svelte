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
	<p class="leading-relaxed whitespace-pre-line text-slate-700">{message}</p>
	{#snippet footer()}
		<button
			class="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
			onclick={onCancel}
			disabled={pending}
		>
			{cancelText}
		</button>
		<button
			class="rounded-md px-4 py-1.5 text-sm text-white shadow-sm disabled:opacity-60
				{danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-slate-900 hover:bg-slate-700'}"
			onclick={onConfirm}
			disabled={pending}
		>
			{pending ? '处理中…' : confirmText}
		</button>
	{/snippet}
</Modal>
