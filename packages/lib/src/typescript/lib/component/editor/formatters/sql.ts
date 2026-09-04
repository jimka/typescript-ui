// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FormatOptionsWithLanguage } from "sql-formatter";
import { mapFormatOptions } from "~/component/editor/formatters/options.js";
import type { FormatOptionNames } from "~/component/editor/formatters/options.js";
import type { FormatOptions, Formatter } from "~/component/editor/LanguageRegistry.js";

/** Every `FormatOptions` field, mapped to its `sql-formatter` option name or to `null` when it has none. */
const SQL_OPTION_NAMES: FormatOptionNames = {
    indentWidth:               "tabWidth",
    useTabs:                   "useTabs",
    keywordCase:               "keywordCase",
    lineWidth:                 null,
    singleQuote:               null,
    semicolons:                null,
    trailingComma:             null,
    arrowParens:               null,
    bracketSpacing:            null,
    proseWrap:                 null,
    htmlWhitespaceSensitivity: null,
};

/**
 * SQL formatter adapter backed by `sql-formatter`, dynamically imported on
 * first call so it never lands in the base editor chunk.
 *
 * Unlike Prettier's `formatWithCursor`, `sql-formatter` has no cursor-mapping
 * API, so the old cursor offset is clamped to the formatted document's length
 * rather than mapped to its logically-equivalent position.
 */
export const formatWithSql: Formatter = async (
    source: string,
    cursorOffset: number,
    options?: FormatOptions,
) => {
    const { format } = await import("sql-formatter");
    const formatted = format(source, mapFormatOptions<FormatOptionsWithLanguage>(options, SQL_OPTION_NAMES));

    return { formatted, cursorOffset: Math.min(cursorOffset, formatted.length) };
};
