<script>
	import { onMount } from 'svelte';
	import { resolvedTheme } from '$lib/stores/themeStore.js';
	import { ensureMonacoBooted } from '$lib/monaco/setup.js';

	/**
	 * @typedef {Object} Suggestion
	 * @property {string} label
	 * @property {'column' | 'keyword' | 'function'} kind
	 * @property {string} [detail]
	 *
	 * @typedef {Object} Props
	 * @property {string} value
	 * @property {(v: string) => void} onValueChange
	 * @property {() => void} [onEnter]
	 * @property {() => Suggestion[]} [getSuggestions]
	 * @property {string} [placeholder]
	 */

	/** @type {Props} */
	let { value, onValueChange, onEnter, getSuggestions, placeholder } = $props();

	/** @type {HTMLDivElement | undefined} */
	let host = $state();

	/** @type {import('monaco-editor').editor.IStandaloneCodeEditor | null} */
	let editor = null;
	/** @type {{ dispose: () => void } | null} */
	let completionDisposer = null;
	let suspendIncoming = false;

	onMount(() => {
		let cancelled = false;
		(async () => {
			ensureMonacoBooted();
			const monaco = await import('monaco-editor');
			if (cancelled || !host) return;

			// 复用 SqlEditor 已注册的主题（若尚未注册则 fallback）
			try {
				monaco.editor.defineTheme('idb-light', {
					base: 'vs',
					inherit: true,
					rules: [],
					colors: {
						'editor.background': '#fef7ff',
						'editor.foreground': '#1d1b20',
						'editorCursor.foreground': '#6750a4'
					}
				});
				monaco.editor.defineTheme('idb-dark', {
					base: 'vs-dark',
					inherit: true,
					rules: [],
					colors: {
						'editor.background': '#141218',
						'editor.foreground': '#e6e0e9',
						'editorCursor.foreground': '#d0bcff'
					}
				});
			} catch {
				/* 已注册 */
			}

			// 注册独立语言 'sql-filter'，复用 SQL 语法高亮但不共享补全 provider
			if (!monaco.languages.getLanguages().some((l) => l.id === 'sql-filter')) {
				monaco.languages.register({ id: 'sql-filter' });
				const sqlLang = monaco.languages.getLanguages().find((l) => l.id === 'sql');
				if (sqlLang?.loader) {
					sqlLang.loader().then((mod) => {
						monaco.languages.setMonarchTokensProvider('sql-filter', mod.language);
					});
				}
			}

			editor = monaco.editor.create(host, {
				value: value ?? '',
				language: 'sql-filter',
				theme: $resolvedTheme === 'dark' ? 'idb-dark' : 'idb-light',
				automaticLayout: true,
				minimap: { enabled: false },
				fontSize: 12,
				lineHeight: 20,
				fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
				lineNumbers: 'off',
				wordWrap: 'off',
				scrollBeyondLastLine: false,
				renderLineHighlight: 'none',
				folding: false,
				scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
				overviewRulerLanes: 0,
				hideCursorInOverviewRuler: true,
				overviewRulerBorder: false,
				glyphMargin: false,
				contextmenu: false,
				wordBasedSuggestions: 'off',
				suggestOnTriggerCharacters: true,
				quickSuggestions: { other: true, comments: false, strings: false },
				placeholder: placeholder ?? '',
				fixedOverflowWidgets: true,
				// 精简补全弹窗：只显示标签，隐藏文档/详情
				suggest: {
					showIcons: false,
					showStatusBar: false,
					showDetails: false,
					preview: false,
					snippetsPreventQuickSuggestions: false
				}
			});

			// Enter → 提交（不换行）
			editor.addCommand(monaco.KeyCode.Enter, () => {
				onEnter?.();
			});

			editor.onDidChangeModelContent(() => {
				if (suspendIncoming) return;
				let v = editor?.getValue() ?? '';
				if (v.includes('\n')) {
					v = v.replace(/\n/g, ' ').replace(/\r/g, '');
					suspendIncoming = true;
					editor.setValue(v);
					suspendIncoming = false;
				}
				onValueChange(v);
			});

			// 跟踪焦点：每个 provider 只为自己的编辑器返回结果
			let hasFocus = false;
			editor.onDidFocusEditorText(() => (hasFocus = true));
			editor.onDidBlurEditorText(() => (hasFocus = false));

			// 注册精简补全提供器
			if (getSuggestions) {
				completionDisposer = monaco.languages.registerCompletionItemProvider('sql-filter', {
					triggerCharacters: [' '],
					provideCompletionItems(model, position) {
						if (!hasFocus) return { suggestions: [] };
						const wordInfo = model.getWordUntilPosition(position);
						const range = {
							startLineNumber: position.lineNumber,
							endLineNumber: position.lineNumber,
							startColumn: position.column - wordInfo.word.length,
							endColumn: position.column
						};
						const items = getSuggestions() ?? [];
						const K = monaco.languages.CompletionItemKind;
						const seen = new Set();
						return {
							suggestions: items
								.filter((s) => { if (seen.has(s.label)) return false; seen.add(s.label); return true; })
								.map((s) => ({
								label: s.label,
								kind:
									s.kind === 'column' ? K.Field : s.kind === 'function' ? K.Function : K.Keyword,
								detail: s.detail ?? '',
								insertText: s.label,
								range,
								// 单行模式下不展开额外信息
								documentation: undefined
							}))
						};
					}
				});
			}

			// 主题跟随
			const unsub = resolvedTheme.subscribe((t) => {
				if (editor) monaco.editor.setTheme(t === 'dark' ? 'idb-dark' : 'idb-light');
			});

			return () => unsub();
		})();

		return () => {
			cancelled = true;
			completionDisposer?.dispose();
			editor?.dispose();
			editor = null;
		};
	});

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
</script>

<div bind:this={host} class="monaco-input-host"></div>

<style>
	.monaco-input-host {
		width: 100%;
		height: 100%;
		min-height: 0;
		border: none;
		overflow: visible;
		position: relative;
	}
	.monaco-input-host :global(.monaco-editor),
	.monaco-input-host :global(.monaco-editor .overflow-guard) {
		border-radius: 0;
		overflow: visible !important;
	}
	.monaco-input-host :global(.monaco-editor .suggest-widget) {
		max-height: 12rem;
	}
</style>
