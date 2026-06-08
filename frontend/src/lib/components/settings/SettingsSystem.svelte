<script>
	import { getSystemInfo } from '$lib/api';
	import { t } from '$lib/i18n';

	/** @type {Record<string, unknown> | null} */
	let sysInfo = $state(null);
	let sysLoading = $state(true);
	let sysError = $state(false);

	$effect(() => {
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
</script>

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
						<span class="font-mono" style="color: var(--md-on-surface);">{sysInfo.jvmVersion}</span>
					</p>
					<p>
						{$t('sysinfo.jvm_vendor')}:
						<span class="font-mono" style="color: var(--md-on-surface);">{sysInfo.jvmVendor}</span>
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
						<span class="font-mono" style="color: var(--md-on-surface);">{sysInfo.osArch}</span>
					</p>
					<p>
						{$t('sysinfo.os_version')}:
						<span class="font-mono" style="color: var(--md-on-surface);">{sysInfo.osVersion}</span>
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
