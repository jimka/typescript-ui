// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Extension, EditorState } from "@codemirror/state";
import type { Diagnostic } from "@codemirror/lint";

/**
 * Style knobs a {@link Formatter} may honour. Every field is optional;
 * an absent field means "leave that engine's own default alone". No field is
 * honoured by every built-in language — see the applicability table in
 * `docs/components/CodeEditor.md`.
 *
 * @category Components
 */
export interface FormatOptions {
    /** Spaces per indent level. */
    indentWidth?: number;
    /** Indent with tab characters instead of spaces. */
    useTabs?: boolean;
    /** Column the formatter wraps at. */
    lineWidth?: number;
    /** Prefer single quotes for string literals. */
    singleQuote?: boolean;
    /** Terminate statements with semicolons. */
    semicolons?: boolean;
    /** Where to print trailing commas. */
    trailingComma?: "none" | "es5" | "all";
    /** Parenthesise a sole arrow-function parameter. */
    arrowParens?: "always" | "avoid";
    /** Print spaces inside object braces. */
    bracketSpacing?: boolean;
    /** How to re-wrap prose. */
    proseWrap?: "always" | "never" | "preserve";
    /** How strictly to preserve significant whitespace in markup. */
    htmlWhitespaceSensitivity?: "css" | "strict" | "ignore";
    /** Case to print SQL keywords in. */
    keywordCase?: "preserve" | "upper" | "lower";
}

/**
 * Formats `source`, returning the formatted text and a cursor offset mapped
 * (or clamped) into the new document. May return synchronously or via a
 * `Promise` — `CodeEditor.format()` awaits either.
 *
 * @param source - The document text to format.
 * @param cursorOffset - The cursor's current offset into `source`.
 * @param options - Style knobs to pass to the formatting engine, when it
 *   honours any. Omitted fields leave the engine's own default alone.
 * @returns The formatted text and the mapped/clamped cursor offset.
 */
export type Formatter = (
    source: string,
    cursorOffset: number,
    options?: FormatOptions,
) =>
    | Promise<{ formatted: string; cursorOffset: number }>
    | { formatted: string; cursorOffset: number };

/**
 * Produces parser-level diagnostics for a document state. Takes an
 * `EditorState`, not a view, so a source is DOM-free and unit-testable;
 * `CodeEditor` adapts it to what CodeMirror's `linter()` wants.
 */
export type LintSource = (state: EditorState) => Diagnostic[] | Promise<Diagnostic[]>;

/**
 * Describes one language {@link CodeEditor} can be configured with: its
 * grammar (a lazily-loaded CodeMirror `Extension`) and, optionally, its
 * formatter and lint source.
 *
 * @category Components
 */
export interface LanguageDefinition {
    /** The registry key passed to `CodeEditor.setLanguage` / the `language` option. */
    id: string;
    /** Human-readable name, for a consumer building a language picker. */
    label?: string;
    /** Dynamically imports and builds the CodeMirror grammar extension. */
    loadExtension: () => Promise<Extension>;
    /** Dynamically imports and builds this language's formatter, when one exists. */
    loadFormatter?: () => Promise<Formatter>;
    /** Dynamically imports and builds this language's lint source, when one exists. */
    loadLintSource?: () => Promise<LintSource>;
}

/** Module-level registry, keyed by {@link LanguageDefinition.id}. */
const _registry = new Map<string, LanguageDefinition>();

/**
 * Registers a language definition, replacing any prior registration under the
 * same {@link LanguageDefinition.id}.
 *
 * @param def - The language definition to register.
 */
export function registerLanguage(def: LanguageDefinition): void {
    _registry.set(def.id, def);
}

/**
 * Looks up a registered language definition by id.
 *
 * @param id - The language id.
 * @returns The definition, or `undefined` when no language is registered
 *   under that id.
 */
export function getLanguage(id: string): LanguageDefinition | undefined {
    return _registry.get(id);
}

/**
 * Lists every currently registered language definition.
 *
 * @returns A read-only snapshot of the registered definitions.
 */
export function listLanguages(): readonly LanguageDefinition[] {
    return Array.from(_registry.values());
}
