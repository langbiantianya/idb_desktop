<script>
	import { onMount } from 'svelte';
	import { resolvedTheme } from '$lib/stores/themeStore.js';
	import { ensureMonacoBooted } from '$lib/monaco/setup.js';

	/**
	 * @typedef {Object} Props
	 * @property {string} value
	 * @property {(v: string) => void} onValueChange
	 * @property {() => void} [onCtrlEnter]
	 * @property {string} [placeholder]
	 * @property {string[]} [extraSuggestions] - 额外补全项（如列名）
	 * @property {string} [height] - 编辑器高度，默认 10rem
	 */

	/** @type {Props} */
	let {
		value,
		onValueChange,
		onCtrlEnter,
		placeholder = '',
		extraSuggestions = [],
		height = '10rem'
	} = $props();

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
	let suspendIncoming = false;

	// 造数引擎内置 Lua 辅助函数
	const BUILTINS = [
		{ label: 'insert', detail: 'insert(tableName, rowTable)', insertText: "insert('${1:table}', {\n\t${2:column} = ${3:value}\n})", doc: 'Insert a row into the specified table' },
		{ label: 'lastId', detail: 'lastId()', insertText: 'lastId()', doc: 'Return the last auto-increment ID from the previous batch insert' },
		{ label: 'random_int', detail: 'random_int(min, max)', insertText: 'random_int(${1:min}, ${2:max})', doc: 'Random integer in [min, max]' },
		{ label: 'random_float', detail: 'random_float(min, max)', insertText: 'random_float(${1:min}, ${2:max})', doc: 'Random float in [min, max]' },
		{ label: 'random_string', detail: 'random_string(length)', insertText: 'random_string(${1:length})', doc: 'Random alphanumeric string' },
		{ label: 'random_date', detail: 'random_date(start, end)', insertText: "random_date('${1:2024-01-01}', '${2:2024-12-31}')", doc: 'Random date between start and end (YYYY-MM-DD)' },
		{ label: 'random_email', detail: 'random_email()', insertText: 'random_email()', doc: 'Random email address' },
		{ label: 'random_phone', detail: 'random_phone()', insertText: 'random_phone()', doc: 'Random phone number' },
		{ label: 'random_name', detail: 'random_name()', insertText: 'random_name()', doc: 'Random person name' },
		{ label: 'random_enum', detail: 'random_enum(...)', insertText: "random_enum('${1:val1}', '${2:val2}')", doc: 'Pick a random value from the given list' },
		{ label: 'random_uuid', detail: 'random_uuid()', insertText: 'random_uuid()', doc: 'Random UUID v4' }
	];

	/** @param {typeof import('monaco-editor')} monaco */
	function defineThemes(monaco) {
		monaco.editor.defineTheme('idb-light', {
			base: 'vs',
			inherit: true,
			rules: [
				{ token: 'keyword.lua', foreground: '6750A4', fontStyle: 'bold' },
				{ token: 'string.lua', foreground: '146C2E' },
				{ token: 'comment.lua', foreground: '79747E', fontStyle: 'italic' },
				{ token: 'number.lua', foreground: 'B3261E' },
				{ token: 'operator.lua', foreground: '6750A4' }
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
				{ token: 'keyword.lua', foreground: 'D0BCFF', fontStyle: 'bold' },
				{ token: 'string.lua', foreground: '88D99C' },
				{ token: 'comment.lua', foreground: '938F99', fontStyle: 'italic' },
				{ token: 'number.lua', foreground: 'F2B8B5' },
				{ token: 'operator.lua', foreground: 'D0BCFF' }
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

	onMount(() => {
		let cancelled = false;
		(async () => {
			ensureMonacoBooted();
			const monaco = await import('monaco-editor');
			if (cancelled || !host) return;
			monacoNS = monaco;

			// F12 透传到 WebView2 打开 DevTools
			host.addEventListener('keydown', (e) => {
				if (e.key === 'F12' || e.keyCode === 123) {
					e.stopImmediatePropagation();
				}
			}, true);

			defineThemes(monaco);

			editor = monaco.editor.create(host, {
				value: value ?? '',
				language: 'lua',
				theme: $resolvedTheme === 'dark' ? 'idb-dark' : 'idb-light',
				automaticLayout: true,
				minimap: { enabled: false },
				fontSize: 13,
				fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, 'Courier New', monospace",
				lineNumbers: 'on',
				scrollBeyondLastLine: false,
				smoothScrolling: true,
				renderLineHighlight: 'all',
				wordWrap: 'on',
				tabSize: 2,
				suggestOnTriggerCharacters: true,
				quickSuggestions: { other: true, comments: false, strings: false },
				placeholder
			});

			modelChangeDisposer = editor.onDidChangeModelContent(() => {
				if (suspendIncoming) return;
				const v = editor?.getValue() ?? '';
				onValueChange(v);
			});

			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
				onCtrlEnter?.();
			});

			completionDisposer = monaco.languages.registerCompletionItemProvider('lua', {
				triggerCharacters: ['.', '('],
				provideCompletionItems(model, position) {
					const wordInfo = model.getWordUntilPosition(position);
					const word = wordInfo.word;
					const range = {
						startLineNumber: position.lineNumber,
						endLineNumber: position.lineNumber,
						startColumn: position.column - word.length,
						endColumn: position.column
					};

					const K = monaco.languages.CompletionItemKind;
					const suggestions = [];

					// 内置造数函数
					for (const b of BUILTINS) {
						suggestions.push({
							label: b.label,
							kind: K.Function,
							detail: b.detail,
							documentation: b.doc,
							insertText: b.insertText,
							insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
							range
						});
					}

					// 额外列名补全
					for (const col of extraSuggestions) {
						suggestions.push({
							label: col,
							kind: K.Field,
							insertText: col,
							range
						});
					}

					return { suggestions };
				}
			});
		})();
		return () => {
			cancelled = true;
			completionDisposer?.dispose();
			modelChangeDisposer?.dispose();
			editor?.dispose();
			editor = null;
			completionDisposer = null;
			modelChangeDisposer = null;
		};
	});

	// 父级 value 变化时同步
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

	// 主题跟随
	$effect(() => {
		const t = $resolvedTheme;
		if (!monacoNS) return;
		monacoNS.editor.setTheme(t === 'dark' ? 'idb-dark' : 'idb-light');
	});
</script>

<div bind:this={host} class="lua-editor-host" style:min-height={height}></div>

<style>
	.lua-editor-host {
		width: 100%;
		height: 100%;
		min-width: 0;
		max-width: 100%;
		border: none;
		overflow: hidden;
		position: relative;
	}
	.lua-editor-host :global(.monaco-editor),
	.lua-editor-host :global(.monaco-editor .overflow-guard) {
		border-radius: 0;
	}
</style>
