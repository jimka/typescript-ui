// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the five built-in language definitions as a side effect of
// importing this module (from the barrel `index.ts`). Every grammar and
// formatter loader is a dynamic `import()`, so — because the CodeMirror
// language packages and Prettier/sql-formatter are `external` in the lib
// build — none of them reach the base editor chunk; each loads only when a
// consumer actually selects that language or calls `format()`. The one
// external package imported statically for its code, `@codemirror/state`,
// is one `CodeEditor` itself imports, so it is in that chunk already; the
// other static imports are this library's own modules, or types.

import { countColumn } from "@codemirror/state";
import type { TreeIndentContext } from "@codemirror/language";
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

        return markdown({ htmlTagLanguage: literalHtml });
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
