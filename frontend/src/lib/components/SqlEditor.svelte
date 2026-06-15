<script>
	import { onMount } from 'svelte';
	import { resolvedTheme } from '$lib/stores/themeStore.js';
	import { ensureMonacoBooted } from '$lib/monaco/setup.js';

	/**
	 * @typedef {Object} CompletionContext
	 * @property {string} word            // 当前输入的前缀
	 * @property {string} prevToken       // 光标前最近的非空白单词（小写），如 'from' / 'join' / 'into'
	 * @property {string | null} qualifier // 写到 `db.` 或 `schema.` 时点号前的标识符；不带前缀时为 null
	 *
	 * @typedef {Object} Suggestion
	 * @property {string} label
	 * @property {'schema' | 'table' | 'column' | 'keyword' | 'function'} kind
	 * @property {string} [detail]
	 * @property {string} [insertText]
	 *
	 * @typedef {Object} Props
	 * @property {string} value
	 * @property {(v: string) => void} onValueChange
	 * @property {() => void} [onCtrlEnter]
	 * @property {() => void} [onFormat]
	 * @property {(ctx: CompletionContext) => Suggestion[] | Promise<Suggestion[]>} [getSuggestions]
	 * @property {string} [placeholder]
	 * @property {boolean} [singleLine]
	 */

	/** @type {Props} */
	let { value, onValueChange, onCtrlEnter, onFormat, getSuggestions, placeholder, singleLine = false } = $props();

	/** 父组件可通过 `bind:this` 调用：拿到当前选中的文本（无选中返回空串）。 */
	export function getSelectedText() {
		if (!editor) return '';
		const sel = editor.getSelection();
		if (!sel || sel.isEmpty()) return '';
		return editor.getModel()?.getValueInRange(sel) ?? '';
	}

	/** @type {HTMLDivElement | undefined} */
	let host = $state();

	/** @type {import('monaco-editor').editor.IStandaloneCodeEditor | null} */
	let editor = null;
	/** @type {typeof import('monaco-editor') | null} */
	let monacoNS = null;
	/** @type {{ dispose: () => void } | null} */
	let completionDisposer = null;
	/** @type {{ dispose: () => void } | null} */
	let modelChangeDisposer = null;
	/** @type {{ dispose: () => void } | null} */
	let typeDisposer = null;
	let suspendIncoming = false;

	onMount(() => {
		let cancelled = false;
		(async () => {
			ensureMonacoBooted();
			const monaco = await import('monaco-editor');
			if (cancelled || !host) return;
			monacoNS = monaco;

			// 在 Monaco 初始化前注册 capture 阶段 F12 监听，阻止 Monaco 消费 F12（Go to Definition），
			// 让 F12 传递到 WebView2 打开 DevTools。
			host.addEventListener('keydown', (e) => {
				if (e.key === 'F12' || e.keyCode === 123) {
					e.stopImmediatePropagation();
					// 不调用 e.preventDefault()，让浏览器/WebView2 原生处理 F12（打开 DevTools）
				}
			}, true); // capture: true，优先于 Monaco 的 keydown

			defineThemes(monaco);

			editor = monaco.editor.create(host, {
				value: value ?? '',
				language: 'sql',
				theme: $resolvedTheme === 'dark' ? 'idb-dark' : 'idb-light',
				automaticLayout: true,
				minimap: { enabled: false },
				fontSize: 13,
				fontFamily:
					"'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, 'Courier New', monospace",
				lineNumbers: singleLine ? 'off' : 'on',
				scrollBeyondLastLine: false,
				smoothScrolling: true,
				renderLineHighlight: singleLine ? 'none' : 'all',
				wordWrap: singleLine ? 'off' : 'on',
				tabSize: 2,
				suggestOnTriggerCharacters: true,
				quickSuggestions: { other: true, comments: false, strings: false },
				acceptSuggestionOnEnter: 'off',
				placeholder: placeholder ?? '',
				...(singleLine && {
					folding: false,
					scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
					overviewRulerLanes: 0,
					hideCursorInOverviewRuler: true,
					overviewRulerBorder: false,
					glyphMargin: false,
					contextmenu: false
				})
			});

			// 单行模式：阻止 Enter 插入换行
			if (singleLine) {
				editor.addCommand(monaco.KeyCode.Enter, () => {
					onCtrlEnter?.();
				});
			}

			modelChangeDisposer = editor.onDidChangeModelContent(() => {
				if (suspendIncoming) return;
				let v = editor?.getValue() ?? '';
				// 单行模式：剥离换行（粘贴多行文本时只保留第一行）
				if (singleLine && v.includes('\n')) {
					v = v.replace(/\n/g, ' ').replace(/\r/g, '');
					suspendIncoming = true;
					editor.setValue(v);
					suspendIncoming = false;
				}
				onValueChange(v);
			});

			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
				onCtrlEnter?.();
			});

			editor.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
				onFormat?.();
			});

			// 输入空格立即弹补全（Monaco 默认在空 word 时不会自动展开）
			typeDisposer = editor.onDidType((text) => {
				if (text === ' ') editor?.trigger('keyboard', 'editor.action.triggerSuggest', {});
			});

			completionDisposer = monaco.languages.registerCompletionItemProvider('sql', {
				triggerCharacters: ['.', ' '],
				provideCompletionItems: async (model, position) => {
					if (!getSuggestions) return { suggestions: [] };
					const ctx = buildCompletionContext(model, position);
					const items = await getSuggestions(ctx);
					const range = {
						startLineNumber: position.lineNumber,
						endLineNumber: position.lineNumber,
						startColumn: position.column - ctx.word.length,
						endColumn: position.column
					};
					return {
						suggestions: items.map((s) => ({
							label: s.label,
							kind: kindToMonaco(monaco, s.kind),
							detail: s.detail,
							insertText: s.insertText ?? s.label,
							range
						}))
					};
				}
			});
		})();
		return () => {
			cancelled = true;
			completionDisposer?.dispose();
			modelChangeDisposer?.dispose();
			typeDisposer?.dispose();
			editor?.dispose();
			editor = null;
			completionDisposer = null;
			modelChangeDisposer = null;
			typeDisposer = null;
		};
	});

	// 父级把 value 改了时同步进编辑器（例如外部清空）。
	$effect(() => {
		const v = value ?? '';
		if (!editor) return;
		if (editor.getValue() === v) return;
		suspendIncoming = true;
		try {
			editor.setValue(v);
		} finally {
			suspendIncoming = false;
		}
	});

	// 主题切换：跟随 resolvedTheme。
	$effect(() => {
		const t = $resolvedTheme;
		if (!monacoNS) return;
		monacoNS.editor.setTheme(t === 'dark' ? 'idb-dark' : 'idb-light');
	});

	/**
	 * @param {import('monaco-editor').editor.ITextModel} model
	 * @param {import('monaco-editor').Position} position
	 * @returns {CompletionContext}
	 */
	function buildCompletionContext(model, position) {
		const wordInfo = model.getWordUntilPosition(position);
		const word = wordInfo.word;

		// 取光标前完整一行 + 之前的内容，找点号前缀
		const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
		let qualifier = /** @type {string | null} */ (null);
		const dotMatch = /([\w$]+)\s*\.\s*[\w$]*$/.exec(lineBefore);
		if (dotMatch) qualifier = dotMatch[1];

		// 找最近的非空白上一个 token（用于区分 from / join / update / into ...）
		const wholeBefore = model.getValueInRange({
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: position.lineNumber,
			endColumn: position.column
		});
		const cleanedBefore = wholeBefore.slice(0, wholeBefore.length - word.length);
		const tokens = cleanedBefore.match(/[\w$]+/g) ?? [];
		const prevToken = (tokens[tokens.length - 1] ?? '').toLowerCase();

		return { word, prevToken, qualifier };
	}

	/**
	 * @param {typeof import('monaco-editor')} monaco
	 * @param {Suggestion['kind']} kind
	 */
	function kindToMonaco(monaco, kind) {
		const K = monaco.languages.CompletionItemKind;
		switch (kind) {
			case 'schema':
				return K.Module;
			case 'table':
				return K.Struct;
			case 'column':
				return K.Field;
			case 'function':
				return K.Function;
			default:
				return K.Keyword;
		}
	}

	/** @param {typeof import('monaco-editor')} monaco */
	function defineThemes(monaco) {
		monaco.editor.defineTheme('idb-light', {
			base: 'vs',
			inherit: true,
			rules: [
				{ token: 'keyword.sql', foreground: '6750A4', fontStyle: 'bold' },
				{ token: 'predefined.sql', foreground: '7D5260' },
				{ token: 'string.sql', foreground: '146C2E' },
				{ token: 'comment.sql', foreground: '79747E', fontStyle: 'italic' },
				{ token: 'number.sql', foreground: 'B3261E' }
			],
			colors: {
				'editor.background': '#fef7ff',
				'editor.foreground': '#1d1b20',
				'editor.lineHighlightBackground': '#f3edf7',
				'editorLineNumber.foreground': '#79747e',
				'editorCursor.foreground': '#6750a4',
				'editor.selectionBackground': '#eaddff',
				'editorIndentGuide.background1': '#e7e0ec'
			}
		});
		monaco.editor.defineTheme('idb-dark', {
			base: 'vs-dark',
			inherit: true,
			rules: [
				{ token: 'keyword.sql', foreground: 'D0BCFF', fontStyle: 'bold' },
				{ token: 'predefined.sql', foreground: 'EFB8C8' },
				{ token: 'string.sql', foreground: '88D99C' },
				{ token: 'comment.sql', foreground: '938F99', fontStyle: 'italic' },
				{ token: 'number.sql', foreground: 'F2B8B5' }
			],
			colors: {
				'editor.background': '#141218',
				'editor.foreground': '#e6e0e9',
				'editor.lineHighlightBackground': '#211f26',
				'editorLineNumber.foreground': '#938f99',
				'editorCursor.foreground': '#d0bcff',
				'editor.selectionBackground': '#4f378b',
				'editorIndentGuide.background1': '#49454f'
			}
		});
	}
</script>

<div bind:this={host} class="monaco-host" class:single-line={singleLine}></div>

<style>
	.monaco-host {
		width: 100%;
		height: 100%;
		min-height: 12rem;
		border: none;
		overflow: hidden;
	}
	.monaco-host.single-line {
		min-height: 0;
		height: 1.75rem;
	}
	.monaco-host :global(.monaco-editor),
	.monaco-host :global(.monaco-editor .overflow-guard) {
		border-radius: 0;
	}
</style>
