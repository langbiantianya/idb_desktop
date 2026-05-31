// 全局 toast：成功 / 错误反馈，UI 顶层订阅渲染。

import { writable } from 'svelte/store';

/** @typedef {{ id: number; kind: 'ok' | 'err'; text: string }} Toast */

/** @type {import('svelte/store').Writable<Toast[]>} */
export const toasts = writable([]);

let seq = 0;

/**
 * @param {'ok' | 'err'} kind
 * @param {string} text
 * @param {number} [ttl]
 */
export function pushToast(kind, text, ttl = 3500) {
	const id = ++seq;
	toasts.update((list) => [...list, { id, kind, text }]);
	setTimeout(() => {
		toasts.update((list) => list.filter((t) => t.id !== id));
	}, ttl);
}

/** @param {number} id */
export function dismissToast(id) {
	toasts.update((list) => list.filter((t) => t.id !== id));
}

/** @param {string} text */
export const ok = (text) => pushToast('ok', text);

/** @param {string} text */
export const err = (text) => pushToast('err', text);
