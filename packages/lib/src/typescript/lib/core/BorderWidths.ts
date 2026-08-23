// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal helper backing Component's border-width measurement. A style read
// (getComputedStyle) that follows a stylesheet-rule write in the same task
// makes every later rule write in that task dramatically more expensive (the
// "read-after-write penalty" — see docs/concepts/performance.md). A wide
// table's column-window slide issues one getComputedStyle-backed border read
// per rendered cell, all sharing the same border spec, so measuring the spec
// once and sharing the result turns ~30 reads into (at most) one. Not
// exported from `core/index.ts` — mirrors `core/ClassStyleRules.ts`, which
// solves the same shape of problem (a module-level cache serving
// `Component`) the same way. See plans/implemented/table-scroll-forced-reflow.md.

import { DOM, type Handle }                          from "~/core/DOM.js";
import { type BorderOptions, borderToStyle, borderSideWidth } from "~/primitive/Border.js";
import { ThemeManager }                              from "~/core/Theme.js";

/**
 * Per-side pixel widths. Structural twin of `Component`'s `PerimeterSize` —
 * declared locally rather than imported so this module never imports
 * `core/Component.ts`, mirroring `ClassStyleRules.ts`'s own `StyleBag`.
 */
interface SideWidths {
    top:    number;
    right:  number;
    bottom: number;
    left:   number;
}

// A side value whose width is font-relative (em/ex/ch/lh) resolves against the
// element's own font size, so two components with the same spec can measure
// differently — such a spec must never be shared. A digit immediately before
// the unit distinguishes it from `rem`, which is root-relative and safe to share.
const FONT_RELATIVE_UNIT = /[\d.](?:em|ex|ch|lh)\b/i;

// Resolved-side-string key -> measured widths. Cleared on theme change.
const _widths: Map<string, SideWidths> = new Map();

/**
 * Derives the shared-cache key for a border spec: its four resolved side
 * values joined by `|`, so two specs that resolve to the same four sides
 * share one entry. Returns `null` when any side is font-relative — such a
 * spec must be measured per component and never cached.
 *
 * @param spec - The border specification to key.
 *
 * @returns The cache key, or `null` when the spec opts out of sharing.
 */
function cacheKey(spec: BorderOptions): string | null {
    const style = borderToStyle(spec);
    const sides = [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft];

    if (sides.some((side) => side !== null && FONT_RELATIVE_UNIT.test(side))) {
        return null;
    }

    return sides.join("|");
}

/**
 * Returns the browser-measured per-side border widths for `spec`, measuring
 * `element` only when this spec has not already been measured under the
 * active theme. A font-relative spec (see {@link cacheKey}) is always
 * measured and never cached, since it can resolve differently per element.
 *
 * @param spec - The border specification to measure.
 * @param element - The connected element to measure it against.
 *
 * @returns The measured per-side pixel widths.
 */
export function measureBorderWidths(spec: BorderOptions, element: Handle): SideWidths {
    const key = cacheKey(spec);

    if (key !== null) {
        const cached = _widths.get(key);

        if (cached) {
            return cached;
        }
    }

    const cs = DOM.source.getBorderWidths(element);

    const widths: SideWidths = {
        top:    borderSideWidth(cs.top),
        right:  borderSideWidth(cs.right),
        bottom: borderSideWidth(cs.bottom),
        left:   borderSideWidth(cs.left),
    };

    if (key !== null) {
        _widths.set(key, widths);
    }

    return widths;
}

/** Drops every entry. Called on theme change and by the test harness. @internal */
export function clearBorderWidths(): void {
    _widths.clear();
}

/** Number of cached entries; for tests only. @internal */
export function _borderWidthCacheSize(): number {
    return _widths.size;
}

// Registered at import — ahead of every per-component theme listener, since no
// component can exist before `core/Component.ts` has imported this module —
// so no component can observe a stale shared entry while a theme change is
// still being delivered (see plans/implemented/table-scroll-forced-reflow.md).
ThemeManager.onThemeChange(clearBorderWidths);
