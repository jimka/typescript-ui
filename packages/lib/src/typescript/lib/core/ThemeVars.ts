// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal cache over `DOM.source.getThemeVar`. In the browser a
// theme-variable read resolves `:root`'s computed style, which recalculates
// the document's style whenever a write is pending — once per border side per
// layout step for a component laid out before it is attached, and once per
// minimized window per viewport resize for the dock's slot width. Every
// `--ts-ui-*` variable is written inline on `:root` by `ThemeManager.setTheme`
// and by nothing else, so a value read once stays correct until the next theme
// change. Not exported from `core/index.ts` — mirrors `core/BorderWidths.ts`,
// which caches a seam read the same way. See
// plans/implemented/environment-read-caching.md.

import { DOM, type DOMSource } from "~/core/DOM.js";

// Variable name -> the value the seam returned: trimmed, "" when unset.
// Cleared by `clearThemeVars`, which `Util.invalidateTextMetricsCache` calls
// on every theme change and every settled font batch.
const _values: Map<string, string> = new Map();

// The source `_values` was read from. A read through any other installed
// source starts from empty, so `installTestDOM`, `DOM.install` and
// `DOM.reset()` never leave a value read from the previous source.
let _source: DOMSource | null = null;

/**
 * Returns a theme CSS variable's value, reading it through the DOM seam only
 * the first time it is asked for under the active theme and installed source.
 *
 * @param name - The custom-property name, including the leading `--`.
 *
 * @returns The value, trimmed; `""` when the variable is unset.
 */
export function readThemeVar(name: string): string {
    if (_source !== DOM.source) {
        _values.clear();
        _source = DOM.source;
    }

    let value = _values.get(name);

    if (value === undefined) {
        value = DOM.source.getThemeVar(name);
        _values.set(name, value);
    }

    return value;
}

/** Drops every cached value. Called by `Util.invalidateTextMetricsCache`. @internal */
export function clearThemeVars(): void {
    _values.clear();
}

/** Number of cached variables; for tests only. @internal */
export function _themeVarCacheSize(): number {
    return _values.size;
}
