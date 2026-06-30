<script>
	import { t } from '$lib/i18n';
	import { MdButton } from '$lib/components/ui/button/index.js';

	/**
	 * @typedef {Object} Props
	 * @property {string} [value] - 当前值（HH:MM 或 HH:MM:SS 格式）
	 * @property {string} [label] - 标签文本
	 * @property {boolean} [disabled]
	 * @property {boolean} [error]
	 * @property {string} [placeholder]
	 * @property {boolean} [use24Hour] - 是否使用24小时制（默认 true）
	 * @property {boolean} [showSeconds] - 是否显示秒（默认 false）
	 * @property {string} [size] - 'sm' | 'md' | 'lg'
	 * @property {(value: string) => void} [onchange]
	 * @property {(value: string) => void} [onconfirm]
	 */

	/** @type {Props} */
	let {
		value = $bindable(''),
		label = '',
		disabled = false,
		error = false,
		placeholder = '--:--',
		use24Hour = true,
		showSeconds = false,
		size = 'md',
		onchange,
		onconfirm
	} = $props();

	// 内部状态
	let open = $state(false);
	let inputEl = $state(/** @type {HTMLInputElement | null} */ (null));
	let popoverEl = $state(/** @type {HTMLDivElement | null} */ (null));
	let hours = $state(0);
	let minutes = $state(0);
	let seconds = $state(0);
	let ampm = $state('AM');
	let originalValue = $state('');

	// 从 value 解析时间
	$effect(() => {
		if (!value) {
			hours = 0;
			minutes = 0;
			seconds = 0;
			ampm = 'AM';
			return;
		}
		const parts = value.split(':');
		const h = parseInt(parts[0] || '0', 10);
		const m = parseInt(parts[1] || '0', 10);
		const s = parseInt(parts[2] || '0', 10);

		if (use24Hour) {
			hours = Math.max(0, Math.min(23, h));
			minutes = Math.max(0, Math.min(59, m));
			seconds = Math.max(0, Math.min(59, s));
		} else {
			const displayH = h % 12 || 12;
			hours = displayH;
			minutes = Math.max(0, Math.min(59, m));
			seconds = Math.max(0, Math.min(59, s));
			ampm = h >= 12 ? 'PM' : 'AM';
		}
	});

	// 弹窗打开后滚动到选中项
	$effect(() => {
		if (!open) return;
		setTimeout(() => {
			scrollToIndex('hours', hours);
			scrollToIndex('minutes', minutes);
			scrollToIndex('seconds', seconds);
		}, 10);
	});

	/** @param {string} col @param {number} idx */
	function scrollToIndex(col, idx) {
		const el = document.querySelector(`.tp-wheel-${col}[data-picker="time"]`);
		if (!el) return;
		const itemHeight = 40;
		const containerHeight = el.clientHeight;
		const scrollTop = idx * itemHeight - (containerHeight - itemHeight) / 2;
		el.scrollTop = Math.max(0, scrollTop);
	}

	// 格式化输出值
	function formatValue() {
		let h = hours;
		if (!use24Hour) {
			if (ampm === 'PM' && h !== 12) h += 12;
			if (ampm === 'AM' && h === 12) h = 0;
		}
		const hh = String(h).padStart(2, '0');
		const mm = String(minutes).padStart(2, '0');
		if (showSeconds) {
			const ss = String(seconds).padStart(2, '0');
			return `${hh}:${mm}:${ss}`;
		}
		return `${hh}:${mm}`;
	}

	function handleInputClick() {
		if (disabled) return;
		originalValue = value;
		open = true;
	}

	function handleInputKeydown(/** @type {KeyboardEvent} */ e) {
		if (e.key === 'Enter') {
			originalValue = value;
			open = true;
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function selectHour(/** @type {number} */ h) {
		hours = h;
		emitChange();
	}

	function selectMinute(/** @type {number} */ m) {
		minutes = m;
		emitChange();
	}

	function selectSecond(/** @type {number} */ s) {
		seconds = s;
		emitChange();
	}

	function emitChange() {
		const newValue = formatValue();
		value = newValue;
		onchange?.(newValue);
	}

	function confirmSelection() {
		const newValue = formatValue();
		value = newValue;
		open = false;
		onconfirm?.(newValue);
		onchange?.(newValue);
	}

	function clearValue() {
		value = '';
		open = false;
		onchange?.('');
	}

	// 点击外部关闭——还原原先的值
	function handleClickOutside(/** @type {MouseEvent} */ e) {
		if (popoverEl && !popoverEl.contains(e.target) && !inputEl?.contains(e.target)) {
			value = originalValue;
			open = false;
		}
	}

	// 生成数组
	function range(n) {
		return Array.from({ length: n }, (_, i) => i);
	}

	// 尺寸映射
	const sizeClasses = {
		sm: 'h-8 px-2 text-xs',
		md: 'h-10 px-3 text-sm',
		lg: 'h-12 px-4 text-base'
	};

	const panelWidth = {
		sm: 'w-64',
		md: 'w-72',
		lg: 'w-80'
	};
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative inline-flex flex-col gap-1">
	{#if label}
		<label class="text-xs font-medium" style="color: var(--md-on-surface-variant);">
			{label}
		</label>
	{/if}

	<!-- 输入框触发器 -->
	<div class="relative">
		<input
			bind:this={inputEl}
			class="md-input w-full cursor-pointer font-mono {sizeClasses[size]}"
			class:border-red-500={error}
			type="text"
			{value}
			{placeholder}
			{disabled}
			readonly
			onclick={handleInputClick}
			onkeydown={handleInputKeydown}
			aria-haspopup="dialog"
			aria-expanded={open}
		/>
		<!-- 时钟图标 -->
		<svg
			class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-50"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			style="color: var(--md-on-surface-variant);"
		>
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	</div>

	<!-- 弹出面板 -->
	{#if open}
		<div
			bind:this={popoverEl}
			class="fixed z-[2147483647] flex flex-col overflow-hidden shadow-elev-3 {panelWidth[size]}"
			style="
				background: var(--md-surface-container-high);
				border: 1px solid var(--md-outline-variant);
				border-radius: var(--md-radius-lg);
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
			"
			role="dialog"
			aria-label="时间选择器"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- 头部：显示当前选中时间 -->
			<div
				class="flex items-center justify-center gap-1 px-4 py-3"
				style="background: var(--md-primary-container);"
			>
				<span class="font-mono text-2xl font-bold" style="color: var(--md-on-primary-container);">
					{String(use24Hour ? hours : (hours % 12 || 12)).padStart(2, '0')}
				</span>
				<span class="text-2xl font-bold" style="color: var(--md-on-primary-container);">:</span>
				<span class="font-mono text-2xl font-bold" style="color: var(--md-on-primary-container);">
					{String(minutes).padStart(2, '0')}
				</span>
				{#if showSeconds}
					<span class="text-2xl font-bold" style="color: var(--md-on-primary-container);">:</span>
					<span class="font-mono text-2xl font-bold" style="color: var(--md-on-primary-container);">
						{String(seconds).padStart(2, '0')}
					</span>
				{/if}
				{#if !use24Hour}
					<div class="ml-2 flex flex-col gap-0.5">
						<button
							type="button"
							class="rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
							style={ampm === 'AM'
								? 'background: var(--md-primary); color: var(--md-on-primary);'
								: 'background: transparent; color: var(--md-on-primary-container);'}
							onclick={() => { ampm = 'AM'; emitChange(); }}
						>
							AM
						</button>
						<button
							type="button"
							class="rounded px-1.5 py-0.5 text-xs font-medium transition-colors"
							style={ampm === 'PM'
								? 'background: var(--md-primary); color: var(--md-on-primary);'
								: 'background: transparent; color: var(--md-on-primary-container);'}
							onclick={() => { ampm = 'PM'; emitChange(); }}
						>
							PM
						</button>
					</div>
				{/if}
			</div>

			<!-- 滚轮选择器 -->
			<div class="flex items-stretch justify-center" style="height: 200px; padding: 0 8px;">
				<!-- 小时滚轮 -->
				<div class="tp-wheel tp-wheel-hours" data-picker="time" data-column="hours">
					<div class="tp-wheel-inner">
						{#each range(24) as h (h)}
							<button
								type="button"
								class="tp-wheel-item"
								class:tp-wheel-selected={h === hours}
								onclick={() => selectHour(h)}
							>
								{String(h).padStart(2, '0')}
							</button>
						{/each}
					</div>
				</div>

				<!-- 分隔符 -->
				<div class="flex items-center px-1">
					<span class="text-xl font-bold" style="color: var(--md-on-surface-variant);">:</span>
				</div>

				<!-- 分钟滚轮 -->
				<div class="tp-wheel tp-wheel-minutes" data-picker="time" data-column="minutes">
					<div class="tp-wheel-inner">
						{#each range(60) as m (m)}
							<button
								type="button"
								class="tp-wheel-item"
								class:tp-wheel-selected={m === minutes}
								onclick={() => selectMinute(m)}
							>
								{String(m).padStart(2, '0')}
							</button>
						{/each}
					</div>
				</div>

				{#if showSeconds}
					<!-- 分隔符 -->
					<div class="flex items-center px-1">
						<span class="text-xl font-bold" style="color: var(--md-on-surface-variant);">:</span>
					</div>
					<!-- 秒滚轮 -->
					<div class="tp-wheel tp-wheel-seconds" data-picker="time" data-column="seconds">
						<div class="tp-wheel-inner">
							{#each range(60) as s (s)}
								<button
									type="button"
									class="tp-wheel-item"
									class:tp-wheel-selected={s === seconds}
									onclick={() => selectSecond(s)}
								>
									{String(s).padStart(2, '0')}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- 底部操作栏 -->
			<div class="flex items-center justify-between border-t px-3 py-2" style="border-color: var(--md-outline-variant);">
				<MdButton variant="text" size="sm" onclick={clearValue}>
					{$t('common.cancel')}
				</MdButton>
				<MdButton variant="filled" size="sm" onclick={confirmSelection}>
					{$t('common.confirm')}
				</MdButton>
			</div>
		</div>
	{/if}
</div>

<style>
	/* 滚轮容器 */
	.tp-wheel {
		flex: 1;
		height: 100%;
		overflow-y: auto;
		overflow-x: hidden;
		position: relative;
		/* 隐藏滚动条 */
		scrollbar-width: none;
		-ms-overflow-style: none;
		/* 防止滚动冒泡到父级 */
		overscroll-behavior: contain;
		/* 优化滚动性能 */
		-webkit-overflow-scrolling: touch;
	}
	.tp-wheel::-webkit-scrollbar {
		display: none;
	}

	/* 上下渐变遮罩 */
	.tp-wheel-hours,
	.tp-wheel-minutes,
	.tp-wheel-seconds {
		mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			black 20%,
			black 80%,
			transparent 100%
		);
		-webkit-mask-image: linear-gradient(
			to bottom,
			transparent 0%,
			black 20%,
			black 80%,
			transparent 100%
		);
	}

	/* 内部容器 - 添加上下padding让第一项和最后一项能滚动到中间 */
	.tp-wheel-inner {
		padding: 80px 0;
	}

	/* 滚轮项 */
	.tp-wheel-item {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 40px;
		width: 100%;
		font-size: 1rem;
		font-weight: 500;
		font-family: 'JetBrains Mono', monospace;
		color: var(--md-on-surface);
		background: transparent;
		border: none;
		cursor: pointer;
		/* 性能优化 */
		will-change: transform;
		transform: translateZ(0);
		/* 防止选中 */
		-webkit-user-select: none;
		user-select: none;
	}
	.tp-wheel-item:hover {
		color: var(--md-primary);
	}
	.tp-wheel-item.tp-wheel-selected {
		color: var(--md-primary);
		font-weight: 700;
		font-size: 1.125rem;
	}
</style>
