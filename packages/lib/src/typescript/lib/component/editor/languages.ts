// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Registers the five built-in language definitions as a side effect of
// importing this module (from the barrel `index.ts`). Every grammar and
// formatter loader is a dynamic `import()`, so — because the CodeMirror
// language packages and Prettier/sql-formatter are `external` in the lib
// build — none of them reach the base editor chunk; each loads only when a
// consumer actually selects that language or calls `format()`.

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

registerLanguage({
    id: "markdown",
    label: "Markdown",
    loadExtension: async () => {
        const { markdown } = await import("@codemirror/lang-markdown");

        return markdown();
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
