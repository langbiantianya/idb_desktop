<script>
	import {
		memRefreshSeconds,
		jvmMaxMemoryMB,
		systemMemoryMB,
		setMemRefresh,
		setJvmMaxMemory
	} from '$lib/stores/themeStore.js';
	import { RestartEngine } from '../../../../wailsjs/go/main/App.js';
	import { t } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { ok, err } from '$lib/stores/toasts.js';
	import MdButton from '../MdButton.svelte';

	let restarting = $state(false);

	let jvmMax = $derived($systemMemoryMB > 0 ? Math.floor($systemMemoryMB / 2) : 4096);
	let jvmPct = $derived(jvmMax > 64 ? (($jvmMaxMemoryMB - 64) / (jvmMax - 64)) * 100 : 0);

	async function doRestartEngine() {
		restarting = true;
		try {
			await RestartEngine();
			ok(get(t)('perf.jvm_restart_ok'));
		} catch {
			err(get(t)('perf.jvm_restart_fail'));
		} finally {
			restarting = false;
		}
	}
</script>

<section class="space-y-3">
	<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
		{$t('perf.title')}
	</h2>
	<div class="space-y-4">
		<!-- 内存刷新间隔 -->
		<div class="space-y-1">
			<label class="text-xs" style="color: var(--md-on-surface-variant);"
				>{$t('perf.mem_refresh')}</label
			>
			<select
				class="w-full md-input text-sm"
				value={$memRefreshSeconds}
				onchange={(e) => setMemRefresh(Number(e.currentTarget.value))}
			>
				{#each [1, 2, 3, 5, 10] as s (s)}
					<option value={s}>{$t('perf.seconds', { n: s })}</option>
				{/each}
			</select>
		</div>

		<!-- JVM 最大堆内存 -->
		<div class="space-y-1">
			<label class="text-xs" style="color: var(--md-on-surface-variant);"
				>{$t('perf.jvm_memory')}</label
			>
			<div class="flex items-center gap-3">
				<span
					class="w-10 shrink-0 text-right font-mono text-xs"
					style="color: var(--md-on-surface);">64</span
				>
				<input
					type="range"
					class="jvm-slider flex-1"
					min="64"
					max={jvmMax}
					step="64"
					value={$jvmMaxMemoryMB}
					oninput={(e) => setJvmMaxMemory(Number(e.currentTarget.value))}
					style:background="linear-gradient(to right, var(--md-primary) {jvmPct}%,
					var(--md-surface-container-highest) {jvmPct}%)"
				/>
				<span class="w-10 shrink-0 font-mono text-xs" style="color: var(--md-on-surface-variant);"
					>{jvmMax}</span
				>
				<span
					class="w-16 shrink-0 text-right font-mono text-sm font-medium"
					style="color: var(--md-primary);">{$jvmMaxMemoryMB} MB</span
				>
				<MdButton
					variant="tonal"
					size="sm"
					class="ml-auto"
					onclick={doRestartEngine}
					disabled={restarting}
				>
					{restarting ? $t('perf.jvm_restarting') : $t('perf.jvm_restart')}
				</MdButton>
			</div>
			<p class="text-[11px]" style="color: var(--md-on-surface-variant);">
				{$t('perf.jvm_memory_hint')}
			</p>
		</div>
	</div>
</section>

<style>
	/* ── MD3 Slider ── https://m3.material.io/components/sliders/specs ── */
	.jvm-slider {
		-webkit-appearance: none;
		appearance: none;
		height: 4px;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	/* WebKit — Chrome / Edge / Safari */
	.jvm-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--md-primary);
		cursor: pointer;
		box-shadow:
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
		transition: box-shadow 0.2s;
	}
	.jvm-slider::-webkit-slider-thumb:hover {
		box-shadow:
			0 0 0 10px color-mix(in srgb, var(--md-primary) 12%, transparent),
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.jvm-slider:focus-visible::-webkit-slider-thumb {
		box-shadow:
			0 0 0 12px color-mix(in srgb, var(--md-primary) 18%, transparent),
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.jvm-slider:active::-webkit-slider-thumb {
		box-shadow:
			0 0 0 14px color-mix(in srgb, var(--md-primary) 24%, transparent),
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
	}
	/* Firefox */
	.jvm-slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--md-primary);
		border: none;
		cursor: pointer;
		box-shadow:
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
		transition: box-shadow 0.2s;
	}
	.jvm-slider::-moz-range-thumb:hover {
		box-shadow:
			0 0 0 10px color-mix(in srgb, var(--md-primary) 12%, transparent),
			0 1px 3px 1px rgba(0, 0, 0, 0.15),
			0 1px 2px rgba(0, 0, 0, 0.3);
	}
	.jvm-slider::-moz-range-track {
		height: 4px;
		border-radius: 2px;
		background: var(--md-surface-container-highest);
	}
	.jvm-slider::-moz-range-progress {
		height: 4px;
		border-radius: 2px;
		background: var(--md-primary);
	}
</style>
