// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Formatter } from "~/component/editor/LanguageRegistry.js";

/**
 * SQL formatter adapter backed by `sql-formatter`, dynamically imported on
 * first call so it never lands in the base editor chunk.
 *
 * Unlike Prettier's `formatWithCursor`, `sql-formatter` has no cursor-mapping
 * API, so the old cursor offset is clamped to the formatted document's length
 * rather than mapped to its logically-equivalent position.
 */
export const formatWithSql: Formatter = async (source: string, cursorOffset: number) => {
    const { format } = await import("sql-formatter");
    const formatted = format(source);

    return { formatted, cursorOffset: Math.min(cursorOffset, formatted.length) };
};
