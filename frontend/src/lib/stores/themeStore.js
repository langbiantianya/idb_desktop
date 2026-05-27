// 主题：'light' | 'dark' | 'auto'。
// - 启动时读 localStorage('idb.theme')，否则取 prefers-color-scheme。
// - 写入 <html data-theme="...">；'auto' 也会落到具体值，便于 CSS 选择器匹配。

import { writable } from 'svelte/store';

const STORAGE_KEY = 'idb.theme';

/** @typedef {'light' | 'dark'} Resolved */
/** @typedef {'light' | 'dark' | 'auto'} Mode */

function getSystemTheme() {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readInitial() {
	if (typeof window === 'undefined') return /** @type {Mode} */ ('auto');
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved === 'light' || saved === 'dark' || saved === 'auto') return saved;
	return 'auto';
}

/** @type {import('svelte/store').Writable<Mode>} */
export const themeMode = writable(readInitial());

/** @type {import('svelte/store').Writable<Resolved>} */
export const resolvedTheme = writable(
	readInitial() === 'auto' ? getSystemTheme() : /** @type {Resolved} */ (readInitial())
);

/** 应用到 <html data-theme>。 @param {Resolved} t */
function apply(t) {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-theme', t);
	resolvedTheme.set(t);
}

/** @param {Mode} mode */
export function setTheme(mode) {
	themeMode.set(mode);
	if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, mode);
	apply(mode === 'auto' ? getSystemTheme() : mode);
}

/** 应用初值并监听系统主题变化（仅当模式为 auto 时跟随）。 */
export function initTheme() {
	if (typeof window === 'undefined') return;
	const mode = readInitial();
	apply(mode === 'auto' ? getSystemTheme() : mode);

	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	mq.addEventListener?.('change', () => {
		let current = /** @type {Mode} */ ('auto');
		const sub = themeMode.subscribe((v) => (current = v));
		sub();
		if (current === 'auto') apply(mq.matches ? 'dark' : 'light');
	});
}
