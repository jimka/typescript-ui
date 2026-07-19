// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StyleRule } from "~/core/StyleTarget.js";

/**
 * Shared style body for the `:focus-within::after` focus ring. A pseudo-element
 * drawn at `inset: 0` carries the 2px focus-indicator border so the ring sits
 * *inside* the composite's padding box and isn't clipped by an ancestor's
 * `overflow: hidden` (the framework's default). `z-index: 1` lifts it above the
 * absolutely-positioned inner input so the ring is never painted over.
 */
const FOCUS_WITHIN_RING_STYLES: Record<string, string> = {
    content:       "''",
    position:      "absolute",
    inset:         "0",
    border:        "2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))",
    borderRadius:  "inherit",
    boxSizing:     "border-box",
    pointerEvents: "none",
    zIndex:        "1",
};

/**
 * Registers the shared `:focus-within::after` focus-ring overlay rule for the
 * given base selector(s). Used by the composite inputs (the picker fields,
 * {@link AutoCompleteField}, `NumberSpinner`) so the focus indicator paints on
 * the outer composite chrome rather than the border-stripped inner input. The
 * `:focus-within::after` pseudo-element suffix is owned here (appended to each
 * comma-separated selector) so it lives in exactly one place.
 *
 * @param baseSelector - One or more comma-separated class selectors (e.g.
 *   `".NumberSpinner"` or `".DateField, .TimeField, .DateTimeField"`), without
 *   the pseudo-element suffix.
 */
export function registerFocusWithinRing(baseSelector: string): void {
    const selector = baseSelector
        .split(",")
        .map(part => part.trim() + ":focus-within::after")
        .join(", ");

    new StyleRule({
        scope:  "selector",
        name:   selector,
        styles: FOCUS_WITHIN_RING_STYLES,
    });
}
