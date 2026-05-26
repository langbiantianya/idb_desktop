// 全局连接状态：CLAUDE.md §8.4 规定的"唯一凭证全局状态锁"。
// 当前活动连接的 password 仅常驻前端内存，不写入任何持久层。

import { writable } from 'svelte/store';

/** @typedef {import('../api').ConnectionConfig} ConnectionConfig */

/** @type {ConnectionConfig} */
export const defaultConnection = {
	driver: 'mysql',
	host: '127.0.0.1',
	port: 3306,
	user: 'root',
	password: '',
	database: ''
};

/** @type {import('svelte/store').Writable<ConnectionConfig | null>} */
export const activeConnection = writable(null);
