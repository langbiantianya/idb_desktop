<script>
	import { t } from '$lib/i18n';
	import { MdButton } from '$lib/components/ui/button/index.js';

	/**
	 * @typedef {Object} Props
	 * @property {string} [value] - 当前值（YYYY-MM-DD 格式）
	 * @property {string} [label] - 标签文本
	 * @property {boolean} [disabled]
	 * @property {boolean} [error]
	 * @property {string} [placeholder]
	 * @property {string} [min] - 最小日期（YYYY-MM-DD）
	 * @property {string} [max] - 最大日期（YYYY-MM-DD）
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
		placeholder = 'YYYY-MM-DD',
		min = '',
		max = '',
		size = 'md',
		onchange,
		onconfirm
	} = $props();

	// 内部状态
	let open = $state(false);
	let inputEl = $state(/** @type {HTMLInputElement | null} */ (null));
	let popoverEl = $state(/** @type {HTMLDivElement | null} */ (null));
	let selectedYear = $state(new Date().getFullYear());
	let selectedMonth = $state(new Date().getMonth());
	let selectedDay = $state(new Date().getDate());
	let originalValue = $state('');

	// 月份名称
	const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

	// 从 value 解析日期
	$effect(() => {
		if (value) {
			const d = new Date(value + 'T00:00:00');
			if (!isNaN(d.getTime())) {
				selectedYear = d.getFullYear();
				selectedMonth = d.getMonth();
				selectedDay = d.getDate();
			}
		}
	});

	// 弹窗打开后滚动到选中项
	$effect(() => {
		if (!open) return;
		setTimeout(() => {
			scrollToIndex('year', selectedYear - 1900);
			scrollToIndex('month', selectedMonth);
			scrollToIndex('day', selectedDay - 1);
		}, 10);
	});

	/** @param {string} col @param {number} idx */
	function scrollToIndex(col, idx) {
		const el = document.querySelector(`.dp-wheel-${col}[data-picker="date"]`);
		if (!el) return;
		const itemHeight = 40;
		const containerHeight = el.clientHeight;
		const scrollTop = idx * itemHeight - (containerHeight - itemHeight) / 2;
		el.scrollTop = Math.max(0, scrollTop);
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

	function selectYear(/** @type {number} */ y) {
		selectedYear = y;
		emitChange();
	}

	function selectMonth(/** @type {number} */ m) {
		selectedMonth = m;
		emitChange();
	}

	function selectDay(/** @type {number} */ d) {
		selectedDay = d;
		emitChange();
	}

	function emitChange() {
		const yyyy = selectedYear;
		const mm = String(selectedMonth + 1).padStart(2, '0');
		const dd = String(selectedDay).padStart(2, '0');
		value = `${yyyy}-${mm}-${dd}`;
		onchange?.(value);
	}

	function confirmSelection() {
		emitChange();
		open = false;
		onconfirm?.(value);
	}

	function clearValue() {
		value = '';
		open = false;
		onchange?.('');
	}

	function goToToday() {
		const today = new Date();
		selectedYear = today.getFullYear();
		selectedMonth = today.getMonth();
		selectedDay = today.getDate();
		emitChange();
	}

	// 点击外部关闭——还原原先的值
	function handleClickOutside(/** @type {MouseEvent} */ e) {
		if (popoverEl && !popoverEl.contains(e.target) && !inputEl?.contains(e.target)) {
			value = originalValue;
			open = false;
		}
	}

	// 生成范围数组
	function range(start, end) {
		const arr = [];
		for (let i = start; i <= end; i++) arr.push(i);
		return arr;
	}

	// 获取当前月份的天数
	function daysInMonth(year, month) {
		return new Date(year, month + 1, 0).getDate();
	}

	// 尺寸
	const sizeClasses = {
		sm: 'h-8 px-2 text-xs',
		md: 'h-10 px-3 text-sm',
		lg: 'h-12 px-4 text-base'
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
		<!-- 日历图标 -->
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
			<rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
			<line x1="16" y1="2" x2="16" y2="6" />
			<line x1="8" y1="2" x2="8" y2="6" />
			<line x1="3" y1="10" x2="21" y2="10" />
		</svg>
	</div>

	<!-- 弹出面板 -->
	{#if open}
		<div
			bind:this={popoverEl}
			class="fixed z-[2147483647] flex w-80 flex-col overflow-hidden shadow-elev-3"
			style="
				background: var(--md-surface-container-high);
				border: 1px solid var(--md-outline-variant);
				border-radius: var(--md-radius-lg);
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
			"
			role="dialog"
			aria-label="日期选择器"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- 头部：显示当前选中日期 -->
			<div
				class="flex items-center justify-center gap-1 px-4 py-3"
				style="background: var(--md-primary-container);"
			>
				<span class="font-mono text-xl font-bold" style="color: var(--md-on-primary-container);">
					{selectedYear}年 {monthNames[selectedMonth]} {selectedDay}日
				</span>
			</div>

			<!-- 滚轮选择器 -->
			<div class="flex items-stretch justify-center" style="height: 200px; padding: 0 8px;">
				<!-- 年滚轮 -->
				<div class="dp-wheel dp-wheel-year" data-picker="date" data-column="year">
					<div class="dp-wheel-inner">
						{#each range(1900, 2100) as y (y)}
							<button
								type="button"
								class="dp-wheel-item"
								class:dp-wheel-selected={y === selectedYear}
								onclick={() => selectYear(y)}
							>
								{y}
							</button>
						{/each}
					</div>
				</div>

				<!-- 月滚轮 -->
				<div class="dp-wheel dp-wheel-month" data-picker="date" data-column="month">
					<div class="dp-wheel-inner">
						{#each range(0, 11) as m (m)}
							<button
								type="button"
								class="dp-wheel-item"
								class:dp-wheel-selected={m === selectedMonth}
								onclick={() => selectMonth(m)}
							>
								{monthNames[m]}
							</button>
						{/each}
					</div>
				</div>

				<!-- 日滚轮 -->
				<div class="dp-wheel dp-wheel-day" data-picker="date" data-column="day">
					<div class="dp-wheel-inner">
						{#each range(1, daysInMonth(selectedYear, selectedMonth)) as d (d)}
							<button
								type="button"
								class="dp-wheel-item"
								class:dp-wheel-selected={d === selectedDay}
								onclick={() => selectDay(d)}
							>
								{d}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- 底部操作栏 -->
			<div class="flex items-center justify-between border-t px-3 py-2" style="border-color: var(--md-outline-variant);">
				<MdButton variant="text" size="sm" onclick={goToToday}>
					今天
				</MdButton>
				<div class="flex gap-1">
					<MdButton variant="text" size="sm" onclick={clearValue}>
						{$t('common.cancel')}
					</MdButton>
					<MdButton variant="filled" size="sm" onclick={confirmSelection}>
						{$t('common.confirm')}
					</MdButton>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* 滚轮容器 */
	.dp-wheel {
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
	.dp-wheel::-webkit-scrollbar {
		display: none;
	}

	/* 上下渐变遮罩 */
	.dp-wheel-year,
	.dp-wheel-month,
	.dp-wheel-day {
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
	.dp-wheel-inner {
		padding: 80px 0;
	}

	/* 滚轮项 */
	.dp-wheel-item {
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
	.dp-wheel-item:hover {
		color: var(--md-primary);
	}
	.dp-wheel-item.dp-wheel-selected {
		color: var(--md-primary);
		font-weight: 700;
		font-size: 1.125rem;
	}
</style>
