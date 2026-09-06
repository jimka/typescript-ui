// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the five built-in language definitions as a side effect.
import '~/component/editor/languages.js';

export { CodeEditor } from '~/component/editor/CodeEditor.js';
export type { CodeEditorOptions, CodeEditorChange, CodeEditorHeightChange, CodeEditorCursorPosition } from '~/component/editor/CodeEditor.js';
export { registerLanguage, getLanguage, listLanguages } from '~/component/editor/LanguageRegistry.js';
export type { LanguageDefinition, Formatter, FormatOptions, LintSource } from '~/component/editor/LanguageRegistry.js';
export { collectSyntaxErrors } from '~/component/editor/syntaxDiagnostics.js';

export { MarkdownEditor } from '~/component/editor/MarkdownEditor.js';
export type { MarkdownEditorOptions, MarkdownEditorChange, MarkdownEditorSelectionState, MarkdownBlockType, MarkdownEditorMode, MarkdownBlockAlignment, MarkdownTableAlignment } from '~/component/editor/MarkdownEditor.js';

export { MarkdownDocumentPanel } from '~/component/editor/MarkdownDocumentPanel.js';
export type { MarkdownDocumentPanelOptions } from '~/component/editor/MarkdownDocumentPanel.js';
