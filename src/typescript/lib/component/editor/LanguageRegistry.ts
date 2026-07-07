// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Extension } from "@codemirror/state";

/**
 * Formats `source`, returning the formatted text and a cursor offset mapped
 * (or clamped) into the new document. May return synchronously or via a
 * `Promise` — `CodeEditor.format()` awaits either.
 *
 * @param source - The document text to format.
 * @param cursorOffset - The cursor's current offset into `source`.
 * @returns The formatted text and the mapped/clamped cursor offset.
 */
export type Formatter = (
    source: string,
    cursorOffset: number,
) =>
    | Promise<{ formatted: string; cursorOffset: number }>
    | { formatted: string; cursorOffset: number };

/**
 * Describes one language {@link CodeEditor} can be configured with: its
 * grammar (a lazily-loaded CodeMirror `Extension`) and, optionally, its
 * formatter.
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
