// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the five built-in language definitions as a side effect.
import '~/component/editor/languages.js';

export { CodeEditor } from '~/component/editor/CodeEditor.js';
export type { CodeEditorOptions, CodeEditorChange, CodeEditorHeightChange } from '~/component/editor/CodeEditor.js';
export { registerLanguage, getLanguage, listLanguages } from '~/component/editor/LanguageRegistry.js';
export type { LanguageDefinition, Formatter, FormatOptions } from '~/component/editor/LanguageRegistry.js';

export { MarkdownEditor } from '~/component/editor/MarkdownEditor.js';
export type { MarkdownEditorOptions, MarkdownEditorChange, MarkdownBlockType, MarkdownEditorMode } from '~/component/editor/MarkdownEditor.js';
