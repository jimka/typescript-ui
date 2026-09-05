// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";

/**
 * Caps the number of diagnostics {@link collectSyntaxErrors} reports for one
 * document, so a pathological parse (or an incomplete tree from CodeMirror's
 * own parse budget on a very large document) cannot flood the lint gutter.
 */
const MAX_SYNTAX_DIAGNOSTICS = 100;

/**
 * Walks the parse tree for error nodes and reports each as an `"error"`
 * diagnostic. Syntax only — it knows nothing about names, types or other
 * files; it reports *where the grammar failed*, nothing more. Two adjacent
 * error nodes (one starting exactly where the previous one ended) merge into
 * a single diagnostic. A `syntaxTree` that is incomplete (CodeMirror's parse
 * budget on a very large document) simply yields fewer diagnostics; that is
 * not treated as an error.
 *
 * @param state - The editor state to walk.
 * @returns Up to 100 diagnostics, in document order.
 */
export function collectSyntaxErrors(state: EditorState): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const cursor = syntaxTree(state).cursor();

    do {
        if (!cursor.type.isError) {
            continue;
        }

        const from = cursor.from;
        const to   = cursor.to;
        const last = diagnostics[diagnostics.length - 1];

        if (last && last.to === from) {
            last.to = to;
            continue;
        }

        if (diagnostics.length >= MAX_SYNTAX_DIAGNOSTICS) {
            break;
        }

        diagnostics.push({
            from,
            to,
            severity: "error",
            message: from === to ? "Missing input" : "Unexpected input",
        });
    } while (cursor.next());

    return diagnostics;
}
