// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { FormatOptions } from "~/component/editor/LanguageRegistry.js";

/**
 * Maps each {@link FormatOptions} field to one engine's own option name, or
 * to `null` when that engine does not honour it.
 */
export type FormatOptionNames = Readonly<Record<keyof FormatOptions, string | null>>;

/**
 * Renames `options` onto one engine's config keys, dropping every field the
 * engine does not honour and every field that is absent.
 *
 * @remarks Writes a key only when its value is not `undefined` — some
 * engines (e.g. `sql-formatter`) merge the returned object over their own
 * defaults with `Object.assign`, so an explicitly-`undefined` key would erase
 * that default instead of leaving it alone.
 *
 * @param options - The caller-supplied style options, or `undefined`.
 * @param names - The engine's field-name table.
 * @returns The engine-specific config fragment.
 */
export function mapFormatOptions<T extends object>(
    options: FormatOptions | undefined,
    names: FormatOptionNames,
): Partial<T> {
    const mapped: Record<string, unknown> = {};

    for (const [field, target] of Object.entries(names)) {
        const value = options?.[field as keyof FormatOptions];

        if (target !== null && value !== undefined) {
            mapped[target] = value;
        }
    }

    // The names table is the type bridge: every non-null target names a real
    // option of `T` whose type matches the `FormatOptions` field mapped onto
    // it. TypeScript cannot follow that correspondence through a string-keyed
    // write, so the assertion stands in for it.
    return mapped as Partial<T>;
}
