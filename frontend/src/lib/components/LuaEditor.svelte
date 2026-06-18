<script>
	import { onMount } from 'svelte';
	import { resolvedTheme } from '$lib/stores/themeStore.js';
	import { ensureMonacoBooted } from '$lib/monaco/setup.js';

	/**
	 * @typedef {Object} Props
	 * @property {string} value
	 * @property {(v: string) => void} onValueChange
	 * @property {() => void} [onCtrlEnter]
	 * @property {() => void} [onFormat]
	 * @property {string} [placeholder]
	 * @property {string[]} [tableSuggestions] - 数据库表名
	 * @property {{ table: string; column: string; type: string }[]} [columnSuggestions] - 数据库列名
	 * @property {string} [height] - 编辑器高度，默认 10rem
	 */

	/** @type {Props} */
	let {
		value,
		onValueChange,
		onCtrlEnter,
		onFormat,
		placeholder = '',
		tableSuggestions = [],
		columnSuggestions = [],
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

	// Lua 关键字
	const LUA_KEYWORDS = [
		'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
		'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
		'then', 'true', 'until', 'while'
	];

	// Lua 标准库函数
	const LUA_BUILTINS = [
		{ label: 'print', detail: 'print(...)', doc: 'Print values to stdout' },
		{ label: 'type', detail: 'type(v)', doc: 'Return the type of v as a string' },
		{ label: 'tostring', detail: 'tostring(v)', doc: 'Convert v to a string' },
		{ label: 'tonumber', detail: 'tonumber(v)', doc: 'Convert v to a number' },
		{ label: 'pairs', detail: 'pairs(t)', doc: 'Iterate over key-value pairs of a table' },
		{ label: 'ipairs', detail: 'ipairs(t)', doc: 'Iterate over integer-keyed array part' },
		{ label: 'select', detail: 'select(index, ...)', doc: 'Select elements from varargs' },
		{ label: 'require', detail: "require('module')", doc: 'Load a module (disabled in sandbox)' },
		{ label: 'string.len', detail: 'string.len(s)', doc: 'Length of string' },
		{ label: 'string.sub', detail: 'string.sub(s, i, j)', doc: 'Substring from i to j' },
		{ label: 'string.format', detail: 'string.format(fmt, ...)', doc: 'Format a string' },
		{ label: 'string.rep', detail: 'string.rep(s, n)', doc: 'Repeat string n times' },
		{ label: 'string.upper', detail: 'string.upper(s)', doc: 'Uppercase' },
		{ label: 'string.lower', detail: 'string.lower(s)', doc: 'Lowercase' },
		{ label: 'math.random', detail: 'math.random(m, n)', doc: 'Random integer in [m, n]' },
		{ label: 'math.floor', detail: 'math.floor(x)', doc: 'Floor' },
		{ label: 'math.ceil', detail: 'math.ceil(x)', doc: 'Ceiling' },
		{ label: 'math.abs', detail: 'math.abs(x)', doc: 'Absolute value' },
		{ label: 'table.insert', detail: 'table.insert(t, v)', doc: 'Insert value into array' },
		{ label: 'table.remove', detail: 'table.remove(t, i)', doc: 'Remove element at index' },
		{ label: 'table.concat', detail: 'table.concat(t, sep)', doc: 'Concatenate array elements' }
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
				quickSuggestions: { other: 'on', comments: false, strings: false },
				acceptSuggestionOnEnter: 'off',
				placeholder
			});

			// 让 Enter 始终插入换行（即使建议框弹出时）；Esc/Tab 仍可关闭建议
			editor.addCommand(monaco.KeyCode.Enter, () => {
				editor?.trigger('keyboard', 'type', { text: '\n' });
			});

			modelChangeDisposer = editor.onDidChangeModelContent(() => {
				if (suspendIncoming) return;
				const v = editor?.getValue() ?? '';
				onValueChange(v);
			});

			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
				onCtrlEnter?.();
			});

			editor.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
				onFormat?.();
			});

			completionDisposer = monaco.languages.registerCompletionItemProvider('lua', {
				triggerCharacters: ['.', '(', '"', "'"],
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

					// Lua 关键字
					for (const kw of LUA_KEYWORDS) {
						suggestions.push({
							label: kw,
							kind: K.Keyword,
							insertText: kw,
							range
						});
					}

					// Lua 标准库
					for (const fn of LUA_BUILTINS) {
						suggestions.push({
							label: fn.label,
							kind: K.Function,
							detail: fn.detail,
							documentation: fn.doc,
							insertText: fn.label,
							range
						});
					}

					// 数据库表名（优先显示）
					for (const tbl of tableSuggestions) {
						suggestions.push({
							label: tbl,
							kind: K.Struct,
							detail: 'table',
							insertText: tbl,
							sortText: '0' + tbl,
							range
						});
					}

					// 数据库列名（优先显示）
					for (const col of columnSuggestions) {
						suggestions.push({
							label: col.column,
							kind: K.Field,
							detail: `${col.table}.${col.column} ${col.type}`,
							insertText: col.column,
							sortText: '1' + col.column,
							range
						});
					}

					// 内置造数函数
					for (const b of BUILTINS) {
						suggestions.push({
							label: b.label,
							kind: K.Function,
							detail: b.detail,
							documentation: b.doc,
							insertText: b.insertText,
							insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
							sortText: '2' + b.label,
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
