// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StyleRule, deferStyleSheetWrite } from "~/core/StyleTarget.js";
import { FOCUS_VISIBLE_ATTR } from "~/core/SpatialNavigation.js";

/**
 * Shared style body for the inset `::after` focus ring, used by both
 * {@link registerFocusWithinRing} and {@link registerFocusVisibleRing}. A
 * pseudo-element drawn at `inset: 0` carries the 2px focus-indicator border
 * so the ring sits *inside* the element's own padding box and isn't clipped
 * by an ancestor's `overflow: hidden` (the framework's default). `z-index: 1`
 * lifts it above the element's own absolutely-positioned children so the
 * ring is never painted over.
 */
const INSET_FOCUS_RING_STYLES: Record<string, string> = {
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
 * The rule is queued through {@link deferStyleSheetWrite} and written just
 * before the library's first stylesheet write, so calling this helper from a
 * module's top level touches no DOM.
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

    deferStyleSheetWrite(() => {
        new StyleRule({
            scope:  "selector",
            name:   selector,
            styles: INSET_FOCUS_RING_STYLES,
        });
    });
}

/**
 * Registers the shared `:focus-visible` ring for a leaf, self-focusing,
 * click-activated control (`Button`, `ComboBox`, `Checkbox`, `Link`) —
 * deliberately gated on `:focus-visible` rather than the text inputs' plain
 * `:focus`, so the ring does not linger after the mouse click that activates
 * the control (see `Link`'s own rationale, the first consumer of this shape).
 *
 * Also matched against `[data-ts-ui-focus-visible]`, the attribute
 * `SpatialNavigation` mirrors onto whatever element it focuses. Chromium's
 * native `:focus-visible` heuristic does not treat a keydown with `ctrlKey` /
 * `altKey` held as keyboard-navigation-worthy, even when it synchronously
 * drives a real `.focus()` call — exactly the shape of `SpatialNavigation`'s
 * own `Ctrl+Alt` / `Ctrl+Shift` chords — so a bare `:focus-visible` rule alone
 * would silently never show a ring for either chord. The marker attribute is
 * the service's own explicit assertion that this focus move should look the
 * same as a native one; it self-clears on the element's next `focusout`.
 *
 * Paints on the same `::after` overlay as {@link registerFocusWithinRing}
 * rather than `outline`: these controls sit flush against a clipping
 * ancestor often enough (a `TabButton` inside its `TabBar` strip, a
 * `ComboBox` inside a `LabeledFieldSet`) that an outward-drawn `outline`
 * — even with no `outlineOffset` — gets silently clipped by that ancestor's
 * `overflow: hidden` (the framework's default). The inset `::after` ring sits
 * inside the control's own padding box, so it is never subject to ancestor
 * clipping, and `z-index: 1` keeps it painted above the control's own
 * absolutely-positioned children (every framework `Component` positions its
 * children absolutely) rather than under them. A second rule on the bare
 * (non-`::after`) selector sets `outline: none`, since moving the ring off
 * `outline` would otherwise let the browser's own default `:focus-visible`
 * outline show through on any control that doesn't already suppress it
 * itself (`Checkbox` does; `Button`, `ComboBox`, and `Link` don't).
 *
 * Both rules are queued together through {@link deferStyleSheetWrite} and
 * written just before the library's first stylesheet write, so calling this
 * helper from a module's top level touches no DOM.
 *
 * @param baseSelector - One or more comma-separated class selectors (e.g.
 *   `".Button"` or `".DateField, .TimeField, .DateTimeField"`), without the
 *   pseudo-class / attribute suffix.
 * @param options - Per-consumer overrides, merged onto the two rules'
 *   defaults (a later key wins over the same key in the shared base).
 *   `baseStyles` lands on the bare `outline: none` rule (`Button` uses this
 *   for `borderColor: "transparent"`, so its own 2px ridge border doesn't
 *   compete with the ring right inside it — the ring can't move outward to
 *   meet the border instead, since the framework's own default
 *   `overflow: hidden` self-clips a control's `::after` the moment it steps
 *   outside the padding box). `ringStyles` lands on the `::after` ring
 *   (`Checkbox` adds a `boxShadow` there, so the ring stays visible against
 *   its own checked-state fill, which uses the same accent blue). Do not
 *   pass `ringStyles: { border: "none" }` to hide the base ring's border —
 *   Chromium silently drops the whole `::after` box's `box-shadow` once its
 *   own border width is zero; override `borderColor` instead (or add an
 *   opaque `boxShadow` on top, as `Checkbox` does) to keep the border's 2px
 *   box-model width while hiding it.
 */
export function registerFocusVisibleRing(
    baseSelector: string,
    options?: { baseStyles?: Record<string, string>; ringStyles?: Record<string, string> },
): void {
    const bases = baseSelector.split(",").map(part => part.trim());

    const bareSelector = bases
        .flatMap(part => [`${part}:focus-visible`, `${part}[${FOCUS_VISIBLE_ATTR}]`])
        .join(", ");

    const afterSelector = bases
        .flatMap(part => [`${part}:focus-visible::after`, `${part}[${FOCUS_VISIBLE_ATTR}]::after`])
        .join(", ");

    deferStyleSheetWrite(() => {
        new StyleRule({
            scope:  "selector",
            name:   bareSelector,
            styles: { outline: "none", ...options?.baseStyles },
        });

        new StyleRule({
            scope:  "selector",
            name:   afterSelector,
            styles: { ...INSET_FOCUS_RING_STYLES, ...options?.ringStyles },
        });
    });
}
