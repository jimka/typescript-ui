// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the seven built-in language definitions as a side effect of
// importing this module (from the barrel `index.ts`). Every grammar and
// formatter loader is a dynamic `import()`, so — because the CodeMirror
// language packages and Prettier/sql-formatter are `external` in the lib
// build — none of them reach the base editor chunk; each loads only when a
// consumer actually selects that language or calls `format()`. The three
// external packages imported statically for their code,
// `@codemirror/language`, `@codemirror/state` and `@codemirror/view`, are
// ones `CodeEditor` itself imports, so they are in that chunk already; the
// other static imports are this library's own modules, or types.

import { syntaxTree } from "@codemirror/language";
import type { Language, TreeIndentContext } from "@codemirror/language";
import { countColumn, EditorSelection, Prec } from "@codemirror/state";
import type { EditorState, SelectionRange, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { SqlLanguage } from "sql-formatter";
import { registerLanguage } from "~/component/editor/LanguageRegistry.js";
import type { LanguageOptions } from "~/component/editor/LanguageRegistry.js";
import { formatWithPrettier } from "~/component/editor/formatters/prettier.js";
import { formatWithSql } from "~/component/editor/formatters/sql.js";
import { collectSyntaxErrors } from "~/component/editor/syntaxDiagnostics.js";

/** Loads the babel + estree plugins Prettier's `babel-ts` and `json` parsers need. */
async function loadBabelPlugins() {
    const [babel, estree] = await Promise.all([
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
    ]);

    return [babel, estree];
}

registerLanguage({
    id: "javascript",
    label: "JavaScript / TypeScript",
    loadExtension: async () => {
        const { javascript } = await import("@codemirror/lang-javascript");

        return javascript({ typescript: true });
    },
    loadFormatter: async () => formatWithPrettier("babel-ts", loadBabelPlugins),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "json",
    label: "JSON",
    loadExtension: async () => {
        // The only built-in grammar with no completion source of its own
        // (every other language publishes one through its own <lang>Language.data
        // facet, which autocompletion() reads without being told); attached here
        // using the same language-data idiom a consumer would use for a custom
        // grammar.
        const [{ json, jsonLanguage }, { completeFromList }] = await Promise.all([
            import("@codemirror/lang-json"),
            import("@codemirror/autocomplete"),
        ]);

        return [json(), jsonLanguage.data.of({ autocomplete: completeFromList(["true", "false", "null"]) })];
    },
    loadFormatter: async () => formatWithPrettier("json", loadBabelPlugins),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "html",
    label: "HTML",
    loadExtension: async () => {
        const { html } = await import("@codemirror/lang-html");

        return html();
    },
    loadFormatter: async () => formatWithPrettier("html", async () => [await import("prettier/plugins/html")]),
    loadLintSource: async () => collectSyntaxErrors,
});

/**
 * Options the built-in `"sql"` language reads. An unrecognised `dialect`
 * value falls back to `"standard"`.
 *
 * Declared with `type`, not `interface`, so a variable of this type is
 * assignable to `LanguageOptions` (an object-literal type alias gets an
 * implicit index signature; an interface does not).
 *
 * @category Components
 */
export type SqlLanguageOptions = {
    /** SQL dialect for highlighting, completion, lint and format(). Default `"standard"`. */
    dialect?: "standard" | "postgresql";
};

/** What one SQL dialect selects in each of the two engines. */
type SqlDialectEntry = {
    /** The `@codemirror/lang-sql` dialect export, by name. */
    grammar: "StandardSQL" | "PostgreSQL";
    /** The `sql-formatter` language. */
    formatter: SqlLanguage;
};

/**
 * What each SqlLanguageOptions dialect selects in the two engines: the
 * `@codemirror/lang-sql` export (a name, so the grammar package stays behind
 * the dynamic import) and the `sql-formatter` language.
 */
const SQL_DIALECTS: Record<NonNullable<SqlLanguageOptions["dialect"]>, SqlDialectEntry> = {
    standard:   { grammar: "StandardSQL", formatter: "sql" },
    postgresql: { grammar: "PostgreSQL",  formatter: "postgresql" },
};

/**
 * Resolves the "sql" loaders' options to a dialect entry. Anything other than
 * a recognised `dialect` string falls back to "standard"; `Object.hasOwn`
 * (not `in`) keeps inherited keys such as `"toString"` from matching.
 *
 * @param options - The options the "sql" loader received.
 * @returns The dialect entry to load.
 */
function resolveDialectEntry(options?: LanguageOptions): SqlDialectEntry {
    const dialect = options?.dialect;

    if (typeof dialect === "string" && Object.hasOwn(SQL_DIALECTS, dialect)) {
        return SQL_DIALECTS[dialect as keyof typeof SQL_DIALECTS];
    }

    return SQL_DIALECTS.standard;
}

registerLanguage({
    id: "sql",
    label: "SQL",
    loadExtension: async (options) => {
        const langSql = await import("@codemirror/lang-sql");

        return langSql.sql({ dialect: langSql[resolveDialectEntry(options).grammar] });
    },
    loadFormatter: async (options) => formatWithSql(resolveDialectEntry(options).formatter),
    loadLintSource: async () => collectSyntaxErrors,
});

/**
 * A syntax tree node, as an indentation query carries it. Named from the
 * query's own type because `@lezer/common`, which declares it, is not a
 * direct dependency.
 */
type SyntaxNode = TreeIndentContext["node"];

/**
 * The width of Markdown's tab stops, in columns: a tab advances to the next
 * multiple of four (CommonMark §2.2), whatever tab size the editor shows it
 * with — so the columns Markdown reads its indentation by are counted with
 * this, not with the editor's `tabSize`.
 */
const MARKDOWN_TAB_STOP = 4;

/**
 * The indentation the built-in `"markdown"` language gives a line that Enter
 * starts inside HTML. `null` means "no opinion": Enter then copies the current
 * line's leading whitespace, as on any other Markdown line, and a line being
 * typed is left where it is.
 *
 * The one line with nothing to copy is a list item's marker line (`- <div>`):
 * its text starts after the marker, not after whitespace. There the new line
 * is indented to the item's content column, which keeps it in the item.
 * Inside a blockquote there is no opinion either way: spaces cannot continue
 * the quote, and deeper indentation outside it would read as a code block.
 *
 * Inside a blockquote or list item, continueContainersInsideHtml handles
 * Enter at a plain caret before this rule is asked. The rule still answers
 * for HTML outside both, when Enter replaces a selection, and when that
 * command passes the key on.
 *
 * @param context - The indentation query, positioned on an HTML node.
 * @returns The column to indent to, or `null` to keep the current line's indentation.
 */
function indentInsideMarkdownHtml(context: TreeIndentContext): number | null {
    let item: SyntaxNode | null = null;

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = context.node; node; node = node.parent) {
        if (node.name === "Blockquote") {
            return null;
        }

        if (node.name === "ListItem" && !item) {
            item = node;
        }
    }

    const line = context.state.doc.lineAt(context.pos);

    // Only the innermost item counts, and only on its marker line: every
    // later line of the item already carries the indentation to copy.
    if (!item || item.from < line.from) {
        return null;
    }

    const content = item.getChild("ListMark")?.nextSibling;

    // Markdown's column, not the editor's: a tab before the content counts
    // to the next of Markdown's stops, whatever `tabSize` the editor has.
    // CodeMirror's own column count, which its Markdown parser calls with the
    // same stop.
    return content ? countColumn(line.text, MARKDOWN_TAB_STOP, content.from - line.from) : null;
}

/**
 * Whether continueContainersInsideHtml handles Enter at a selection range:
 * the range is a caret, the caret is outside Markdown on both sides (inside
 * HTML, or the JavaScript or CSS nested in it), and it sits in a blockquote
 * or list item. "Outside Markdown on both sides" is the exact opposite of the
 * test Markdown's own Enter command starts with, so the two commands never
 * want the same caret.
 *
 * @param state - The editor state.
 * @param markdownLanguage - The Markdown language the editor runs.
 * @param range - The selection range Enter was pressed on.
 * @returns `true` when the range is a caret inside HTML inside a blockquote or list item.
 */
function isCaretInsideContainedHtml(state: EditorState, markdownLanguage: Language, range: SelectionRange): boolean {
    if (!range.empty) {
        return false;
    }

    const activeBefore = markdownLanguage.isActiveAt(state, range.from, -1);
    const activeAfter  = markdownLanguage.isActiveAt(state, range.from, 1);

    if (activeBefore || activeAfter) {
        return false;
    }

    // The HTML tree is mounted inside the Markdown one, so the ancestors of
    // an HTML node continue into the Markdown blocks that hold it.
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, -1); node; node = node.parent) {
        if (node.name === "Blockquote" || node.name === "ListItem") {
            return true;
        }
    }

    return false;
}

/**
 * The text that starts a new line in the same blockquotes and list item as
 * the caret's line: that line's own start, up to its content, with each list
 * marker replaced by spaces. `> - <div>` gives `>   `, and `  x` gives `  `.
 *
 * The characters are copied, not measured, so the new line's columns equal
 * the current line's whatever the editor's tab size is. Markdown counts a tab
 * as four columns; a copied tab is still that tab.
 *
 * Only the syntax tree says what is a marker: inside a `<pre>` block a line
 * may start with `>` or `-` as plain text.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns The prefix for the new line, or `null` when the caret is in front of a marker on its line.
 */
function containerPrefixAt(state: EditorState, pos: number): string | null {
    const line  = state.doc.lineAt(pos);
    let prefix  = "";
    let markEnd = 0;

    syntaxTree(state).iterate({
        from:  line.from,
        to:    line.to,
        enter: (node) => {
            const isListMark = node.name === "ListMark";

            if (!isListMark && node.name !== "QuoteMark") {
                return;
            }

            const from = node.from - line.from;
            const to   = node.to - line.from;

            prefix += line.text.slice(markEnd, from) + (isListMark ? " ".repeat(to - from) : line.text.slice(from, to));
            markEnd = to;
        },
    });

    if (pos - line.from < markEnd) {
        return null;
    }

    const rest = line.text.slice(markEnd);

    return prefix + rest.slice(0, rest.search(/[^ \t]|$/));
}

/**
 * Whether the caret sits directly between an element's open tag and its close
 * tag, as in `<div>|</div>`.
 *
 * @param state - The editor state.
 * @param pos - The caret position.
 * @returns `true` when the open tag ends, and the close tag starts, at the caret.
 */
function isBetweenAdjacentTags(state: EditorState, pos: number): boolean {
    const around = syntaxTree(state).resolveInner(pos);
    const open   = around.childBefore(pos);
    const close  = around.childAfter(pos);

    return open?.name === "OpenTag" && close?.name === "CloseTag" && open.to === pos && close.from === pos;
}

/**
 * Builds the Enter command the built-in `"markdown"` language adds for a
 * caret inside HTML that sits in a blockquote or list item. Markdown's own
 * Enter command refuses a caret inside HTML, and the editor's plain Enter can
 * only write whitespace, so without this command the new line loses its `>`
 * and leaves the quote.
 *
 * The new line starts with the caret line's own prefix (see
 * containerPrefixAt). It never gets a new list marker, and the command never
 * removes a prefix. Between an adjacent open and close tag the close tag moves
 * to a line of its own, with the same prefix.
 *
 * The command passes Enter on (returns `false`) in a read-only editor, for a
 * selection, for a caret Markdown's own command handles, for HTML outside
 * every blockquote and list item, and for a caret in front of a marker on its
 * line. With several carets it acts only when it can act on all of them.
 *
 * @param markdownLanguage - The Markdown language the editor runs.
 * @returns The command, for an Enter key binding.
 */
function continueContainersInsideHtml(markdownLanguage: Language): StateCommand {
    return ({ state, dispatch }) => {
        if (state.readOnly) {
            return false;
        }

        let declined = false;

        const changes = state.changeByRange((range) => {
            const pos      = range.from;
            const eligible = isCaretInsideContainedHtml(state, markdownLanguage, range);
            const prefix   = eligible ? containerPrefixAt(state, pos) : null;

            if (prefix === null) {
                declined = true;

                return { range };
            }

            const line    = state.doc.lineAt(pos);
            const after   = line.text.slice(pos - line.from);
            const newLine = state.lineBreak + prefix;
            const split   = isBetweenAdjacentTags(state, pos);

            return {
                // Spaces and tabs after the caret are dropped, as the editor's
                // plain Enter drops them: the prefix replaces them.
                changes: { from: pos, to: pos + after.search(/[^ \t]|$/), insert: split ? newLine + newLine : newLine },
                // A line break is one document position, whatever the length
                // of the editor's line separator.
                range:   EditorSelection.cursor(pos + 1 + prefix.length),
            };
        });

        if (declined) {
            return false;
        }

        dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));

        return true;
    };
}

registerLanguage({
    id: "markdown",
    label: "Markdown",
    loadExtension: async () => {
        // Indentation in Markdown is meaningful (four spaces start an indented
        // code block; inside a list it picks the item a line belongs to), so
        // HTML inside Markdown is typed literally: no auto-inserted close tags,
        // and no HTML indentation rules. indentInsideMarkdownHtml replaces
        // them: Enter keeps the current line's indentation, as on any other
        // Markdown line.
        const [{ markdown }, { html, htmlLanguage }, { indentNodeProp, LanguageSupport }] = await Promise.all([
            import("@codemirror/lang-markdown"),
            import("@codemirror/lang-html"),
            import("@codemirror/language"),
        ]);

        // dialect "noMatch" mirrors markdown()'s own default HTML language
        // (tag matching off); html({ autoCloseTags: false }).support keeps its
        // tag completion and the nested <script>/<style> support.
        const literalHtml = new LanguageSupport(
            htmlLanguage.configure({
                dialect: "noMatch",
                props:   [indentNodeProp.add({ "Document Element OpenTag CloseTag SelfClosingTag": indentInsideMarkdownHtml })],
            }),
            html({ autoCloseTags: false }).support,
        );

        const support = markdown({ htmlTagLanguage: literalHtml });

        // Prec.high puts this Enter binding beside Markdown's own, ahead of
        // the editor's. It comes second, so Markdown's own command is still
        // tried first.
        return [support, Prec.high(keymap.of([{ key: "Enter", run: continueContainersInsideHtml(support.language) }]))];
    },
    loadFormatter: async () => formatWithPrettier("markdown", async () => [await import("prettier/plugins/markdown")]),
});

registerLanguage({
    id: "css",
    label: "CSS",
    loadExtension: async () => {
        const { css } = await import("@codemirror/lang-css");

        return css();
    },
    loadFormatter: async () => formatWithPrettier("css", async () => [await import("prettier/plugins/postcss")]),
    loadLintSource: async () => collectSyntaxErrors,
});

registerLanguage({
    id: "python",
    label: "Python",
    loadExtension: async () => {
        const { python } = await import("@codemirror/lang-python");

        return python();
    },
    // No formatter: format() falls back to CodeMirror's own re-indent.
    loadLintSource: async () => collectSyntaxErrors,
});
