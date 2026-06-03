// i18n 轻量多语言方案：Svelte store + 翻译字典。
// 使用：import { t, locale, setLocale } from '$lib/i18n';
// 模板中：{$t('key')}  JS 中：$t('key', { param: value })

import { writable, derived } from 'svelte/store';
import { zhCN } from './zh-CN.js';
import { zhTW } from './zh-TW.js';
import { en } from './en.js';
import { ja } from './ja.js';
import { ru } from './ru.js';

/** @typedef {'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ru'} Locale */

/** 所有可用语言 */
export const locales = [
	{ code: /** @type {const} */ ('zh-CN'), name: '简体中文', nativeName: '简体中文' },
	{ code: /** @type {const} */ ('zh-TW'), name: '繁體中文', nativeName: '繁體中文' },
	{ code: /** @type {const} */ ('en'),    name: 'English',  nativeName: 'English' },
	{ code: /** @type {const} */ ('ja'),    name: '日本語',   nativeName: '日本語' },
	{ code: /** @type {const} */ ('ru'),    name: 'Русский',  nativeName: 'Русский' }
];

/** 翻译字典 */
const dictionaries = {
	'zh-CN': zhCN,
	'zh-TW': zhTW,
	'en': en,
	'ja': ja,
	'ru': ru
};

const STORAGE_KEY = 'idb.locale';

/** @type {import('svelte/store').Writable<Locale>} */
export const locale = writable('zh-CN');

/**
 * 设置语言。
 * @param {Locale} loc
 */
export function setLocale(loc) {
	locale.set(loc);
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, loc);
	}
}

/**
 * 读取初始语言偏好。
 * @returns {Locale}
 */
export function readInitialLocale() {
	if (typeof localStorage === 'undefined') return 'zh-CN';
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved && saved in dictionaries) return /** @type {Locale} */ (saved);
	// 浏览器语言检测
	const nav = typeof navigator !== 'undefined' ? navigator.language : '';
	if (nav.startsWith('zh-TW') || nav.startsWith('zh-Hant')) return 'zh-TW';
	if (nav.startsWith('zh')) return 'zh-CN';
	if (nav.startsWith('ja')) return 'ja';
	if (nav.startsWith('ru')) return 'ru';
	if (nav.startsWith('en')) return 'en';
	return 'zh-CN';
}

/**
 * 翻译函数（derived store）。
 * 用法：$t('key') 或 $t('key', { param: 'value' })
 */
export const t = derived(locale, ($locale) => {
	const dict = dictionaries[$locale] || dictionaries['zh-CN'];
	const fallback = dictionaries['zh-CN'];

	/**
	 * @param {string} key - 翻译 key，如 'common.confirm'
	 * @param {Record<string, string | number>} [params] - 插值参数
	 * @returns {string}
	 */
	return function translate(key, params) {
		let value = dict[key] ?? fallback[key] ?? key;
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
			}
		}
		return value;
	};
});
