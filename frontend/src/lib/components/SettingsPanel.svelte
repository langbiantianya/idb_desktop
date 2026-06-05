<script>
	/** @typedef {Object} Props
	 * @property {() => void} onClose
	 */

	/** @type {Props} */
	let { onClose } = $props();

	import {
		themeMode,
		lightThemeId,
		darkThemeId,
		resolvedTheme,
		memRefreshSeconds,
		jvmMaxMemoryMB,
		systemMemoryMB,
		setTheme,
		setLightTheme,
		setDarkTheme,
		setMemRefresh,
		setJvmMaxMemory
	} from '$lib/stores/themeStore.js';
	import { listThemes } from '$lib/api/themes.js';
	import { getSystemInfo } from '$lib/api';
	import { RestartEngine } from '../../../wailsjs/go/main/App.js';
	import { t, locale, setLocale, locales } from '$lib/i18n';
	import { get } from 'svelte/store';
	import { ok, err } from '$lib/stores/toasts.js';
	import ThemeToggle from './ThemeToggle.svelte';
	import MdButton from './MdButton.svelte';

	/** @type {import('$lib/api/themes.js').ThemeInfo[]} */
	let themes = $state([]);
	let loading = $state(true);

	/** @type {Record<string, unknown> | null} */
	let sysInfo = $state(null);
	let sysLoading = $state(true);
	let sysError = $state(false);

	let restarting = $state(false);

	let jvmMax = $derived($systemMemoryMB > 0 ? Math.floor($systemMemoryMB / 2) : 4096);
	let jvmPct = $derived(jvmMax > 64 ? (($jvmMaxMemoryMB - 64) / (jvmMax - 64)) * 100 : 0);

	$effect(() => {
		listThemes().then((th) => {
			themes = th;
			loading = false;
		});

		// 系统信息每秒轮询
		async function fetchSys() {
			try {
				const resp = await getSystemInfo();
				if (resp.success && resp.data) {
					sysInfo = /** @type {Record<string, unknown>} */ (resp.data);
					sysError = false;
				} else {
					sysError = true;
				}
			} catch {
				sysError = true;
			} finally {
				sysLoading = false;
			}
		}
		fetchSys();
		const timer = setInterval(fetchSys, 1000);
		return () => clearInterval(timer);
	});

	let lightThemes = $derived(themes.filter((th) => th.type === 'light'));
	let darkThemes = $derived(themes.filter((th) => th.type === 'dark'));

	/** @param {number} bytes */
	function formatBytes(bytes) {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
		return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
	}

	/** @param {number} ms */
	function formatUptime(ms) {
		const s = Math.floor(ms / 1000);
		if (s < 60) return s + 's';
		const m = Math.floor(s / 60);
		if (m < 60) return m + 'min ' + (s % 60) + 's';
		const h = Math.floor(m / 60);
		return h + 'h ' + (m % 60) + 'min';
	}

	async function doRestartEngine() {
		restarting = true;
		try {
			await RestartEngine();
			ok(get(t)('perf.jvm_restart_ok'));
		} catch (e) {
			err(get(t)('perf.jvm_restart_fail'));
		} finally {
			restarting = false;
		}
	}
</script>

<div
	class="flex h-full flex-col overflow-hidden"
	style="background: var(--md-background); color: var(--md-on-background);"
>
	<header
		class="flex shrink-0 items-center gap-3 px-4 py-3"
		style="background: var(--md-surface-container-low); border-bottom: 1px solid var(--md-outline-variant);"
	>
		<MdButton variant="icon" onclick={onClose} title={$t('settings.back')}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
				<path
					d="M12.5 15L7.5 10L12.5 5"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</MdButton>
		<h1 class="text-lg font-medium">{$t('settings.title')}</h1>
	</header>

	<main class="flex-1 overflow-auto px-6 py-6">
		<div class="mx-auto max-w-lg space-y-8">
			<!-- 语言 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
					{$t('settings.language')}
				</h2>
				<select
					class="w-full md-input text-sm"
					value={$locale}
					onchange={(e) => setLocale(e.currentTarget.value)}
				>
					{#each locales as loc (loc.code)}
						<option value={loc.code}>{loc.nativeName}</option>
					{/each}
				</select>
			</section>

			<!-- 主题模式 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
					{$t('settings.theme_mode')}
				</h2>
				<div class="flex items-center gap-3">
					<ThemeToggle />
					<span class="text-xs" style="color: var(--md-on-surface-variant);">
						{#if $themeMode === 'auto'}
							{$t('settings.follow_system', {
								theme: $resolvedTheme === 'dark' ? $t('settings.dark') : $t('settings.light')
							})}
						{:else if $themeMode === 'light'}
							{$t('settings.light_mode')}
						{:else}
							{$t('settings.dark_mode')}
						{/if}
					</span>
				</div>
			</section>

			<!-- 浅色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
					{$t('settings.light_theme')}
				</h2>
				{#if loading}
					<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
						{$t('common.loading')}
					</p>
				{:else}
					<select
						class="w-full md-input text-sm"
						value={$lightThemeId}
						onchange={(e) => setLightTheme(e.currentTarget.value)}
					>
						<option value="">{$t('settings.builtin_light')}</option>
						{#each lightThemes as th (th.id)}
							<option value={th.id}>{th.name}</option>
						{/each}
					</select>
					{#if lightThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							{$t('settings.theme_help', { mode: $t('settings.light') })}
							<code class="font-mono text-[11px]" style="color: var(--md-primary);"
								>~/.config/idb/theme/</code
							>
						</p>
					{/if}
				{/if}
			</section>

			<!-- 深色主题 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
					{$t('settings.dark_theme')}
				</h2>
				{#if loading}
					<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
						{$t('common.loading')}
					</p>
				{:else}
					<select
						class="w-full md-input text-sm"
						value={$darkThemeId}
						onchange={(e) => setDarkTheme(e.currentTarget.value)}
					>
						<option value="">{$t('settings.builtin_dark')}</option>
						{#each darkThemes as th (th.id)}
							<option value={th.id}>{th.name}</option>
						{/each}
					</select>
					{#if darkThemes.length === 0}
						<p class="text-xs" style="color: var(--md-on-surface-variant);">
							{$t('settings.theme_help', { mode: $t('settings.dark') })}
							<code class="font-mono text-[11px]" style="color: var(--md-primary);"
								>~/.config/idb/theme/</code
							>
						</p>
					{/if}
				{/if}
			</section>
			<!-- 主题文件说明 -->
			<section
				class="rounded-lg p-4 text-xs leading-relaxed"
				style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant); color: var(--md-on-surface-variant);"
			>
				<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
					{$t('settings.custom_theme_format')}
				</h3>
				<pre
					class="overflow-auto font-mono text-[11px] leading-relaxed"
					style="color: var(--md-on-surface-variant);">{`/* @idb-theme
   name: Cyberpunk
   type: dark
*/

:root {
  --md-primary: #00f0ff;
  --md-on-primary: #00363b;
  /* ... */
}`}</pre>
				<p class="mt-2">
					{$t('settings.file_path')}<code
						class="font-mono text-[11px]"
						style="color: var(--md-primary);">~/.config/idb/theme/*.css</code
					>
				</p>
				<p class="mt-1">
					<code class="font-mono text-[11px]">type</code>
					{$t('settings.type_hint')}
					{$t('settings.vars_hint')}
				</p>
			</section>
			<!-- 性能设置 -->
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
								style:background="linear-gradient(to right, var(--md-primary) {jvmPct}%, var(--md-surface-container-highest) {jvmPct}%)"
							/>
							<span
								class="w-10 shrink-0 font-mono text-xs"
								style="color: var(--md-on-surface-variant);">{jvmMax}</span
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

			<!-- 系统信息 -->
			<section class="space-y-3">
				<h2 class="text-sm font-medium" style="color: var(--md-on-surface-variant);">
					{$t('sysinfo.title')}
				</h2>
				{#if sysLoading}
					<p class="animate-pulse text-xs" style="color: var(--md-on-surface-variant);">
						{$t('sysinfo.loading')}
					</p>
				{:else if sysError}
					<p class="text-xs" style="color: var(--md-error);">{$t('sysinfo.error')}</p>
				{:else if sysInfo}
					{@const mem = /** @type {Record<string, number>} */ (sysInfo.memory)}
					<div class="grid grid-cols-2 gap-3 text-xs">
						<div
							class="col-span-2 rounded-lg p-3"
							style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
						>
							<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
								{$t('sysinfo.jvm')}
							</h3>
							<div class="space-y-1" style="color: var(--md-on-surface-variant);">
								<p>
									{$t('sysinfo.jvm_version')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{sysInfo.jvmVersion}</span
									>
								</p>
								<p>
									{$t('sysinfo.jvm_vendor')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{sysInfo.jvmVendor}</span
									>
								</p>
								<p>
									{$t('sysinfo.jvm_name')}:
									<span class="font-mono text-[11px]" style="color: var(--md-on-surface);"
										>{sysInfo.jvmName}</span
									>
								</p>
							</div>
						</div>
						<div
							class="rounded-lg p-3"
							style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
						>
							<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
								{$t('sysinfo.os')}
							</h3>
							<div class="space-y-1" style="color: var(--md-on-surface-variant);">
								<p>
									{$t('sysinfo.os_name')}:
									<span style="color: var(--md-on-surface);">{sysInfo.osName}</span>
								</p>
								<p>
									{$t('sysinfo.os_arch')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{sysInfo.osArch}</span
									>
								</p>
								<p>
									{$t('sysinfo.os_version')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{sysInfo.osVersion}</span
									>
								</p>
							</div>
						</div>
						<div
							class="rounded-lg p-3"
							style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
						>
							<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
								{$t('sysinfo.cpu')}
							</h3>
							<div class="space-y-1" style="color: var(--md-on-surface-variant);">
								<p class="font-mono text-lg" style="color: var(--md-on-surface);">
									{sysInfo.availableProcessors}
								</p>
								<p>
									{$t('sysinfo.uptime')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{formatUptime(/** @type {number} */ (sysInfo.uptime))}</span
									>
								</p>
								<p>
									{$t('sysinfo.pid')}:
									<span class="font-mono" style="color: var(--md-on-surface);">{sysInfo.pid}</span>
								</p>
							</div>
						</div>
						<div
							class="col-span-2 rounded-lg p-3"
							style="background: var(--md-surface-container-low); border: 1px solid var(--md-outline-variant);"
						>
							<h3 class="mb-2 font-medium" style="color: var(--md-on-surface);">
								{$t('sysinfo.memory')}
							</h3>
							<div class="grid grid-cols-2 gap-2" style="color: var(--md-on-surface-variant);">
								<p>
									{$t('sysinfo.mem_max')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{formatBytes(mem.max)}</span
									>
								</p>
								<p>
									{$t('sysinfo.mem_allocated')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{formatBytes(mem.total)}</span
									>
								</p>
								<p>
									{$t('sysinfo.mem_used')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{formatBytes(mem.used)}</span
									>
								</p>
								<p>
									{$t('sysinfo.mem_free')}:
									<span class="font-mono" style="color: var(--md-on-surface);"
										>{formatBytes(mem.free)}</span
									>
								</p>
							</div>
							<div
								class="mt-2 h-2 w-full overflow-hidden rounded-full"
								style="background: var(--md-surface-container-highest);"
							>
								<div
									class="h-full rounded-full transition-all duration-500"
									style="width: {Math.round(
										(mem.used / mem.total) * 100
									)}%; background: var(--md-primary);"
								></div>
							</div>
							<p class="mt-1 text-[11px]" style="color: var(--md-on-surface-variant);">
								{Math.round((mem.used / mem.total) * 100)}% · {formatBytes(mem.used)} / {formatBytes(
									mem.total
								)}
							</p>
						</div>
					</div>
				{/if}
			</section>
		</div>
	</main>
</div>

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
