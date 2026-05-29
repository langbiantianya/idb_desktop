// 连接配置持久化客户端：包装 Wails 主进程的 4 个方法。
// 密码加密 / 解密由 Go 侧负责（Windows: DPAPI；其他平台: AES-GCM + 本地 key 文件）。
// 前端只需关心 hasPassword 标记是否需要预填，以及保存时是否要把密码一起入文件。

import {
	ListConnections,
	GetConnectionPassword,
	SaveConnection,
	DeleteConnection
} from '../../../wailsjs/go/main/App.js';

/**
 * @typedef {Object} SavedConnection
 * @property {string} id
 * @property {string} name
 * @property {string} driver
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} database
 * @property {boolean} hasPassword
 */

/**
 * @typedef {Object} SaveConnectionInput
 * @property {string} id
 * @property {string} name
 * @property {string} driver
 * @property {string} host
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {string} database
 * @property {boolean} savePassword
 */

/** @returns {Promise<SavedConnection[]>} */
export async function listSavedConnections() {
	try {
		const r = await ListConnections();
		return Array.isArray(r) ? r : [];
	} catch {
		return [];
	}
}

/**
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function loadSavedPassword(id) {
	try {
		return await GetConnectionPassword(id);
	} catch {
		return '';
	}
}

/**
 * @param {SaveConnectionInput} input
 * @returns {Promise<SavedConnection | null>}
 */
export async function saveConnectionProfile(input) {
	try {
		return await SaveConnection(input);
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

/** @param {string} id */
export async function deleteConnectionProfile(id) {
	try {
		await DeleteConnection(id);
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}
