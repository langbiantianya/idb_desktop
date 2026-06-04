// 主题与应用设置 API：包装 Wails 主进程的 4 个方法。

import {
	ListThemes,
	GetThemeCSS,
	LoadSettings,
	SaveSettings
} from '../../../wailsjs/go/main/App.js';

/**
 * @typedef {Object} ThemeInfo
 * @property {string} id    - 文件名（不含 .css）
 * @property {string} name  - 显示名称
 * @property {'light' | 'dark'} type
 */

/**
 * @typedef {Object} AppSettings
 * @property {number} version
 * @property {'light' | 'dark' | 'auto'} themeMode
 * @property {string} lightThemeId - 空串 = 内置 MD3
 * @property {string} darkThemeId  - 空串 = 内置 MD3
 * @property {string} locale - 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ru'
 * @property {boolean} setupComplete - 首次引导已完成
 */

/** @returns {Promise<ThemeInfo[]>} */
export async function listThemes() {
	try {
		const r = await ListThemes();
		return Array.isArray(r) ? r : [];
	} catch {
		return [];
	}
}

/**
 * @param {string} id
 * @returns {Promise<string>} CSS 内容
 */
export async function getThemeCSS(id) {
	try {
		return await GetThemeCSS(id);
	} catch {
		return '';
	}
}

/** @returns {Promise<AppSettings>} */
export async function loadSettings() {
	try {
		const r = await LoadSettings();
		return r && typeof r === 'object' ? r : defaultSettings();
	} catch {
		return defaultSettings();
	}
}

/** @param {AppSettings} settings */
export async function saveSettings(settings) {
	try {
		await SaveSettings(settings);
	} catch (e) {
		console.error('[themes] saveSettings failed:', e);
	}
}

/** @returns {AppSettings} */
function defaultSettings() {
	return { version: 1, themeMode: 'auto', lightThemeId: '', darkThemeId: '', locale: '', setupComplete: false };
}
