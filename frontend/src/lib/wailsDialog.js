/**
 * Wails 对话框工具
 * 用于处理 WebView2 与原生系统对话框之间的焦点竞态问题
 *
 * 问题描述：Windows 上 WebView2 在处理焦点切换时，原生对话框可能导致
 * "Failed to unregister class Chrome_WidgetWin_0. Error = 1412" 错误。
 *
 * 解决方案：在调用 Wails 原生对话框前延迟一小段时间，让 WebView2 完成焦点切换。
 */

/**
 * 调用 Wails 原生目录选择对话框
 * @param {string} title - 对话框标题
 * @returns {Promise<string>} 选中的目录路径，取消则返回空串
 */
export async function pickDirectory(title) {
	// 延迟调用，给 WebView2 足够的焦点切换时间
	// 50ms 在大多数情况下足够，但如果你遇到问题可以增加到 100ms
	await new Promise((resolve) => setTimeout(resolve, 50));

	const { PickDirectory } = await import('../../wailsjs/go/main/App.js');
	return PickDirectory(title);
}

/**
 * 通用延迟 Promise
 * 用于在需要让 WebView2 完成焦点切换的场景
 * @param {number} [ms=200] - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function delay(ms = 200) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
