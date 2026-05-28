// Monaco workers — Vite 通过 `?worker` 把对应模块单独打包成 Worker 入口。
// 仅初始化一次：把 MonacoEnvironment.getWorker 指向真实的 Worker 构造器。
// 我们只用基础语言（SQL），所以只挂 editor.worker；不引入 ts/json/css/html worker 体积。

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

let booted = false;

export function ensureMonacoBooted() {
	if (booted) return;
	if (typeof window === 'undefined') return;
	/** @type {any} */ (window).MonacoEnvironment = {
		getWorker(_moduleId, _label) {
			return new EditorWorker();
		}
	};
	booted = true;
}
