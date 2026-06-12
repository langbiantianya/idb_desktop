// Lua 代码格式化工具（基于 StyLua WASM，延迟加载）。

/** @type {Promise<boolean> | null} */
let initPromise = null;
/** @type {typeof import('stylua-wasm').format | null} */
let formatFn = null;

/**
 * 延迟加载并初始化 StyLua WASM（只执行一次）。
 * @returns {Promise<boolean>}
 */
async function ensureLoaded() {
	if (formatFn) return true;
	if (!initPromise) {
		initPromise = (async () => {
			try {
				const mod = await import('stylua-wasm');
				// Vite 会把 .wasm 文件作为静态资源处理
				// 尝试传 URL，如果失败则用默认方式初始化
				try {
					const wasmUrl = (await import('stylua-wasm/stylua_wasm_bg.wasm?url')).default;
					await mod.default(wasmUrl);
				} catch {
					await mod.default();
				}
				formatFn = mod.format;
				return true;
			} catch (e) {
				console.warn('[luaFormat] Failed to load StyLua WASM:', e);
				return false;
			}
		})();
	}
	return initPromise;
}

/**
 * 格式化 Lua 代码。
 * @param {string} code - 原始 Lua 代码
 * @returns {Promise<string>} 格式化后的代码，加载失败时返回原文
 */
export async function formatLua(code) {
	if (!code.trim()) return code;
	const ok = await ensureLoaded();
	if (!ok || !formatFn) return code;
	try {
		const mod = await import('stylua-wasm');
		return formatFn(code, {
			column_width: 120,
			line_endings: mod.LineEndings.Unix,
			indent_type: mod.IndentType.Spaces,
			indent_width: 2,
			quote_style: mod.QuoteStyle.AutoPreferDouble,
			no_call_parentheses: false
		}, mod.OutputVerification.Full);
	} catch (e) {
		console.warn('[luaFormat] Format error:', e);
		return code;
	}
}
