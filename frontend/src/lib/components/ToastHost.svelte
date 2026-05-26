<script>
	import { toasts } from '$lib/stores/toasts.js';
</script>

<div class="pointer-events-none fixed top-4 right-4 z-50 flex w-80 flex-col gap-2">
	{#each $toasts as t (t.id)}
		<div
			class="pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-md backdrop-blur
				{t.kind === 'ok'
				? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
				: 'border-rose-200 bg-rose-50/95 text-rose-800'}"
		>
			<span class="mr-2 font-semibold">{t.kind === 'ok' ? '✓' : '✗'}</span>
			{t.text}
		</div>
	{/each}
</div>
