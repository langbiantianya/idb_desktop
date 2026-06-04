// 全局覆盖层：设置页用覆盖层而非路由跳转，避免销毁 workspace 组件。
import { writable } from 'svelte/store';

/** @type {import('svelte/store').Writable<boolean>} */
export const showSettings = writable(false);

export function openSettings() {
	showSettings.set(true);
}

export function closeSettings() {
	showSettings.set(false);
}
