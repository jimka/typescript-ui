// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Plugin } from "prettier";
import type { Formatter } from "~/component/editor/LanguageRegistry.js";

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
    return async (source: string, cursorOffset: number) => {
        const [{ formatWithCursor }, plugins] = await Promise.all([
            import("prettier/standalone"),
            loadPlugins(),
        ]);

        return formatWithCursor(source, { parser, plugins, cursorOffset });
    };
}
