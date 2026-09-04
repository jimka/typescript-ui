// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Options, Plugin } from "prettier";
import { mapFormatOptions } from "~/component/editor/formatters/options.js";
import type { FormatOptionNames } from "~/component/editor/formatters/options.js";
import type { FormatOptions, Formatter } from "~/component/editor/LanguageRegistry.js";

/** Every `FormatOptions` field, mapped to its Prettier option name or to `null` when Prettier has none. */
const PRETTIER_OPTION_NAMES: FormatOptionNames = {
    indentWidth:               "tabWidth",
    useTabs:                   "useTabs",
    lineWidth:                 "printWidth",
    singleQuote:               "singleQuote",
    semicolons:                "semi",
    trailingComma:             "trailingComma",
    arrowParens:               "arrowParens",
    bracketSpacing:            "bracketSpacing",
    proseWrap:                 "proseWrap",
    htmlWhitespaceSensitivity: "htmlWhitespaceSensitivity",
    keywordCase:               null,
};

/**
 * Builds a Prettier-backed {@link Formatter} for a given parser id.
 *
 * The returned closure dynamically imports `prettier/standalone` and the
 * caller-supplied plugin set on first invocation, so the (large) Prettier
 * standalone bundle only ever loads behind a `format()` call, never as part
 * of the base editor chunk. This adapter is shared by every Prettier-backed
 * language entry in `languages.ts` — each supplies its own parser id and
 * plugin loader (`babel-ts` + the babel/estree plugins for JS/TS, `json` for
 * JSON, `html` for HTML, `markdown` for Markdown).
 *
 * @param parser - The Prettier parser id (e.g. `"babel-ts"`, `"json"`).
 * @param loadPlugins - Dynamically imports the Prettier plugin modules the
 *   parser needs.
 * @returns A {@link Formatter} that formats through Prettier's
 *   `formatWithCursor`, which maps the cursor offset through the reformat.
 */
export function formatWithPrettier(
    parser: string,
    loadPlugins: () => Promise<Plugin[]>,
): Formatter {
    return async (source: string, cursorOffset: number, options?: FormatOptions) => {
        const [{ formatWithCursor }, plugins] = await Promise.all([
            import("prettier/standalone"),
            loadPlugins(),
        ]);

        // The mapped style options go first, so `parser`, `plugins`, and
        // `cursorOffset` — the three the adapter owns — cannot be displaced.
        return formatWithCursor(source, {
            ...mapFormatOptions<Options>(options, PRETTIER_OPTION_NAMES),
            parser,
            plugins,
            cursorOffset,
        });
    };
}
