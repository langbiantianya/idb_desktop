// 主题管理：支持内置 MD3 亮色/暗色主题 + ~/.config/idb/theme/ 下的自定义主题。
// - 启动时从 Go 后端加载设置（themeMode / lightThemeId / darkThemeId）。
// - 切换主题时注入自定义 CSS 到 <style id="idb-custom-theme">，内置主题移除该元素。
// - 设置变更自动写回 Go 后端持久化。

import { writable, get } from 'svelte/store';
import { loadSettings, saveSettings, getThemeCSS } from '../api/themes.js';
import { locale, readInitialLocale } from '../i18n/index.js';

const STORAGE_KEY = 'idb.theme'; // 兼容旧版 localStorage

/** @typedef {'light' | 'dark'} Resolved */
/** @typedef {'light' | 'dark' | 'auto'} Mode */

function getSystemTheme() {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @type {import('svelte/store').Writable<Mode>} */
export const themeMode = writable('auto');

/** @type {import('svelte/store').Writable<Resolved>} */
export const resolvedTheme = writable('light');

/** 当前浅色模式使用的自定义主题 ID（空 = 内置 MD3）。 */
export const lightThemeId = writable('');

/** 当前深色模式使用的自定义主题 ID（空 = 内置 MD3）。 */
export const darkThemeId = writable('');

/** 是否已完成从 Go 加载设置（用于 UI 判断是否可以渲染主题选择器）。 */
export const settingsLoaded = writable(false);

/** 首次引导是否已完成。 */
export const setupComplete = writable(false);

/** 内存刷新间隔（秒）。 */
export const memRefreshSeconds = writable(10);

/** JVM 最大堆内存（MB）。 */
export const jvmMaxMemoryMB = writable(256);

/** 系统物理内存（MB），只读，由 Go 后端 LoadSettings 返回。 */
export const systemMemoryMB = writable(0);

// --- 自定义 CSS 注入 ---

let currentInjectedId = '';
let currentInjectedResolved = '';

/**
 * 注入自定义主题 CSS 到 <head>。id 为空时移除。
 * 将 CSS 中的 :root 替换为 :root[data-theme='...']，
 * 确保特异性不低于 layout.css 中的内置主题选择器。
 * @param {string} id
 * @param {Resolved} resolved - 当前亮/暗，用于选择器匹配
 */
async function injectCustomTheme(id, resolved) {
	if (typeof document === 'undefined') return;

	// 移除旧的
	let el = document.getElementById('idb-custom-theme');
	if (!id) {
		if (el) el.remove();
		currentInjectedId = '';
		currentInjectedResolved = '';
		return;
	}
	if (id === currentInjectedId && resolved === currentInjectedResolved) return; // 完全相同才跳过

	const css = await getThemeCSS(id);
	if (!css) return;

	// 将 :root 替换为特异性更高的选择器，
	// 确保覆盖 layout.css 中内置主题的同名变量。
	// :root[data-theme='dark'].idb-custom-theme 比 :root[data-theme='dark'] 多一个类选择器。
	const selector = `:root[data-theme='${resolved}'].idb-custom-theme`;
	const patched = css
		.replace(/:root\s*,\s*:root\[data-theme='[a-z]+'\]\s*\{/g, selector + ' {')
		.replace(/:root\[data-theme='[a-z]+'\]\s*\{/g, selector + ' {')
		.replace(/:root\s*\{/g, selector + ' {');

	if (!el) {
		el = document.createElement('style');
		el.id = 'idb-custom-theme';
		document.head.appendChild(el);
	}
	el.textContent = patched;
	currentInjectedId = id;
	currentInjectedResolved = resolved;
}

// --- 核心 apply 逻辑 ---

/** 应用到 <html data-theme> 并加载对应的自定义主题。 @param {Resolved} t */
async function apply(t) {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	root.setAttribute('data-theme', t);
	resolvedTheme.set(t);

	// 根据当前亮/暗选择对应的自定义主题
	const lid = get(lightThemeId);
	const did = get(darkThemeId);
	const themeId = t === 'light' ? lid : did;

	// 管理 .idb-custom-theme 类（CSS 选择器依赖它来获得更高特异性）
	if (themeId) {
		root.classList.add('idb-custom-theme');
	} else {
		root.classList.remove('idb-custom-theme');
	}

	await injectCustomTheme(themeId, t);
}

/** @param {Mode} mode */
export function setTheme(mode) {
	themeMode.set(mode);
	if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, mode);
	const resolved = mode === 'auto' ? getSystemTheme() : mode;
	apply(resolved);
	persistSettings();
}

/**
 * 设置浅色模式自定义主题 ID。
 * @param {string} id - 空串表示使用内置 MD3
 */
export function setLightTheme(id) {
	lightThemeId.set(id);
	const current = get(resolvedTheme);
	if (current === 'light') apply('light');
	persistSettings();
}

/**
 * 设置深色模式自定义主题 ID。
 * @param {string} id - 空串表示使用内置 MD3
 */
export function setDarkTheme(id) {
	darkThemeId.set(id);
	const current = get(resolvedTheme);
	if (current === 'dark') apply('dark');
	persistSettings();
}

/** 将当前设置写回 Go 后端。 */
function persistSettings() {
	saveSettings({
		version: 1,
		themeMode: get(themeMode),
		lightThemeId: get(lightThemeId),
		darkThemeId: get(darkThemeId),
		locale: get(locale),
		setupComplete: get(setupComplete),
		memRefreshSeconds: get(memRefreshSeconds),
		JvmMaxMemoryMB: get(jvmMaxMemoryMB)
	});
}

/** 标记引导完成并持久化。 */
export function completeSetup() {
	setupComplete.set(true);
	persistSettings();
}

/** 设置内存刷新间隔并持久化。 @param {number} seconds */
export function setMemRefresh(seconds) {
	memRefreshSeconds.set(seconds);
	persistSettings();
}

/** 设置 JVM 最大堆内存并持久化。 @param {number} mb */
export function setJvmMaxMemory(mb) {
	jvmMaxMemoryMB.set(mb);
	persistSettings();
}

/**
 * 初始化主题：从 Go 后端加载设置，应用主题，监听系统变化。
 * 应在 +layout.svelte 的 $effect 中调用一次。
 */
export async function initTheme() {
	if (typeof window === 'undefined') return;

	// 从 Go 加载设置
	try {
		const settings = await loadSettings();
		if (settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'auto') {
			themeMode.set(settings.themeMode);
		}
		lightThemeId.set(settings.lightThemeId ?? '');
		darkThemeId.set(settings.darkThemeId ?? '');
		// 语言：优先 Go 设置，其次 localStorage，最后浏览器检测
		if (settings.locale) {
			locale.set(settings.locale);
		} else {
			locale.set(readInitialLocale());
		}
		setupComplete.set(settings.setupComplete ?? false);
		memRefreshSeconds.set(settings.memRefreshSeconds ?? 10);
		jvmMaxMemoryMB.set(settings.JvmMaxMemoryMB ?? 256);
		systemMemoryMB.set(settings.systemMemoryMB ?? 0);
		// 兼容：同步写回 localStorage
		localStorage.setItem(STORAGE_KEY, get(themeMode));
	} catch {
		// 降级：读 localStorage（旧版兼容）
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'light' || saved === 'dark' || saved === 'auto') {
			themeMode.set(saved);
		}
	}

	settingsLoaded.set(true);

	const mode = get(themeMode);
	const resolved = mode === 'auto' ? getSystemTheme() : mode;
	await apply(resolved);

	// 监听系统主题变化
	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	mq.addEventListener?.('change', async () => {
		if (get(themeMode) === 'auto') {
			await apply(mq.matches ? 'dark' : 'light');
		}
	});
}
