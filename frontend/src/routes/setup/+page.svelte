<script>
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import {
		themeMode,
		setTheme,
		completeSetup
	} from '$lib/stores/themeStore.js';
	import { t, locale, setLocale, locales } from '$lib/i18n';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let step = $state(1); // 1=语言, 2=主题
	// 临时语言选择（预览用，点击"下一步"时才持久化）
	let selectedLocale = $state($locale);

	// 问候语轮播
	const greetings = [
		'你好',
		'Hello',
		'こんにちは',
		'你好',
		'Привет'
	];
	let greetIndex = $state(0);
	const langHints = [
		'选择语言',
		'Select Language',
		'言語を選択',
		'選擇語言',
		'Выберите язык'
	];
	let hintIndex = $state(0);
	let textVisible = $state(true);

	/** MD3 emphasized decelerate easing: cubic-bezier(0.05, 0.7, 0.1, 1.0) */
	function mdDecelerate(/** @type {number} */ t) {
		return 1 - Math.pow(1 - t, 3);
	}

	$effect(() => {
		if (step !== 1) return;
		const timer = setInterval(() => {
			// 淡出
			textVisible = false;
			// 淡出完成后切换文字并淡入
			setTimeout(() => {
				greetIndex = (greetIndex + 1) % greetings.length;
				hintIndex = (hintIndex + 1) % langHints.length;
				textVisible = true;
			}, 350);
		}, 4000);
		return () => clearInterval(timer);
	});

	/** 切换下拉时仅预览，不持久化 */
	function previewLocale(code) {
		selectedLocale = code;
		locale.set(code);
	}

	/** 点击"下一步"时持久化语言并进入主题选择 */
	function goNext() {
		setLocale(selectedLocale);
		step = 2;
	}

	function finish() {
		completeSetup();
		// 延迟跳转，确保 store 更新和持久化完成
		setTimeout(() => {
			window.location.href = '/';
		}, 100);
	}
</script>

<div class="flex h-screen flex-col items-center justify-center overflow-hidden" style="background: var(--md-background); color: var(--md-on-background);">
	<div class="flex w-full max-w-md flex-col items-center gap-8 px-6" style="height: 70vh;">
		<!-- 问候语轮播（始终占位，仅语言步骤可见） -->
		<div class="flex h-10 items-center justify-center" style="opacity: {step === 1 && textVisible ? 1 : 0}; transition: opacity 350ms cubic-bezier(0.05, 0.7, 0.1, 1.0);">
			<h1 class="text-2xl font-semibold tracking-tight">{greetings[greetIndex]}</h1>
		</div>

		<!-- 步骤指示器 -->
		<div class="flex items-center gap-3">
			<div class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
				style="background: var(--md-primary); color: var(--md-on-primary);">1</div>
			<div class="h-px w-12" style="background: var(--md-outline-variant);"></div>
			<div class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
				style="background: {step >= 2 ? 'var(--md-primary)' : 'var(--md-surface-container)'}; color: {step >= 2 ? 'var(--md-on-primary)' : 'var(--md-on-surface-variant)'};">2</div>
		</div>

		<!-- 步骤内容区（固定高度防跳动） -->
		<div class="w-full" style="min-height: 16rem;">

		{#if step === 1}
			<!-- Step 1: 语言选择 -->
			<div class="w-full space-y-4"
				in:fly={{ x: 60, duration: 500, delay: 300, easing: mdDecelerate }}
				out:fly={{ x: -60, duration: 300, easing: (t) => t * t }}
			>
				<div class="flex h-8 items-center justify-center">
					<h2
						class="text-lg font-medium"
						style="opacity: {textVisible ? 1 : 0}; transition: opacity 350ms cubic-bezier(0.05, 0.7, 0.1, 1.0);"
					>{langHints[hintIndex]}</h2>
				</div>
				<select
					class="md-input w-full text-sm"
					value={selectedLocale}
					onchange={(e) => previewLocale(e.currentTarget.value)}
				>
					{#each locales as loc (loc.code)}
						<option value={loc.code}>{loc.nativeName}</option>
					{/each}
				</select>
				<div class="flex justify-center pt-2">
					<button class="md-btn-filled px-8 py-2 text-sm" onclick={goNext}>
						下一步
					</button>
				</div>
			</div>
		{:else}
			<!-- Step 2: 主题选择 -->
			<div class="w-full space-y-5"
				in:fly={{ x: 60, duration: 500, delay: 300, easing: mdDecelerate }}
				out:fly={{ x: -60, duration: 300, easing: (t) => t * t }}
			>
				<h2 class="text-center text-lg font-medium">{$t('settings.theme_mode')}</h2>

				<div class="flex justify-center">
					<ThemeToggle />
				</div>

				<p class="text-center text-xs" style="color: var(--md-on-surface-variant);">
					{#if $themeMode === 'auto'}
						{$t('theme.auto')}
					{:else if $themeMode === 'light'}
						{$t('settings.light_mode')}
					{:else}
						{$t('settings.dark_mode')}
					{/if}
				</p>

				<div class="flex justify-center gap-3 pt-4">
					<button class="md-btn-outlined px-6 py-2 text-sm" onclick={() => (step = 1)}>
						{$t('common.cancel')}
					</button>
					<button class="md-btn-filled px-8 py-2 text-sm" onclick={finish}>
						{$t('common.confirm')}
					</button>
				</div>
			</div>
		{/if}
		</div>
	</div>
</div>
