// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button } from "~/component/button/Button.js";
import { ComponentStyleRuleSpec } from "~/core/Component.js";
import { Insets } from "~/primitive/Insets.js";

/**
 * Shared style rules for a window control button (minimize / maximize / close),
 * painted entirely from the theme's `window.control` tokens so the look switches
 * live with the theme: flat themes (modern / dark) blend the controls into the
 * surface (no border, no shadow), while the classic theme renders them as
 * standard raised buttons (gradient fill, border, drop shadow). The `background`
 * shorthand (not `backgroundColor`) is used because the classic fills are
 * gradients.
 *
 * Shared by both window kinds — {@link TabWindow}'s trailing tools and the
 * `WindowHeader`'s trailing buttons — so the two cannot visually drift.
 */
const WINDOW_CONTROL_STYLE_RULES: ComponentStyleRuleSpec[] = [
    { suffix: "",                    styles: { background: "var(--ts-ui-window-control-bg)", border: "var(--ts-ui-window-control-border)", boxShadow: "var(--ts-ui-window-control-shadow)" } },
    { suffix: ":hover:not(:active)", styles: { background: "var(--ts-ui-window-control-hover-bg)" } },
    { suffix: ":active",             styles: { background: "var(--ts-ui-window-control-active-bg)" } },
];

/**
 * Shared style rules for the decorative leading window glyph (the title icon).
 * A transparent base background lets the bar / header surface show through in
 * every theme, so it reads as a title icon rather than a clickable button; the
 * `1px solid transparent` border is invisible in all themes yet reserves the
 * same 1px border box the controls' `window.control.border` does (1px wide
 * across every theme), keeping the icon a true size/inset peer of the controls.
 * The styling is baked into the rules (CSS) rather than a post-construct
 * `setBackground`, which the pre-init `applyStyle` cascade would replay away.
 */
const WINDOW_LEAD_GLYPH_STYLE_RULES: ComponentStyleRuleSpec[] = [
    { suffix: "", styles: { background: "transparent", border: "1px solid transparent", boxShadow: "none" } },
];

/**
 * Builds a window control button (minimize / maximize / close) shared by
 * {@link TabWindow} and `WindowHeader`. Chromeless, painted from
 * {@link WINDOW_CONTROL_STYLE_RULES}, with the 2px control insets. Callers wire
 * the `"action"` listener and may override the insets to match their container's
 * box (a `TabWindow`'s bar re-sets them to the compact tool inset).
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured control button.
 */
export function createWindowControlButton(glyph: string): Button {
    return new Button({ glyph, chromeless: true, styleRules: WINDOW_CONTROL_STYLE_RULES, insets: new Insets(2, 2, 2, 2) });
}

/**
 * Builds the decorative leading window glyph (title icon) shared by
 * {@link TabWindow} and `WindowHeader`. Same chromeless control box as
 * {@link createWindowControlButton} so it is a size/inset peer, but painted from
 * {@link WINDOW_LEAD_GLYPH_STYLE_RULES} (transparent) and made pointer-transparent
 * so a press falls through to the window-move gesture.
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured decorative leading glyph button.
 */
export function createWindowLeadGlyphButton(glyph: string): Button {
    const button = new Button({ glyph, chromeless: true, styleRules: WINDOW_LEAD_GLYPH_STYLE_RULES, insets: new Insets(2, 2, 2, 2) });
    button.setPointerEvents("none");

    return button;
}

/**
 * Toggles a set of window control buttons between their opaque themed fill
 * (focused) and `"transparent"` (blurred), so a blurred window flattens its
 * controls. The `background` shorthand resets every layer, so the classic
 * gradient clears on blur too, leaving the border/shadow and hover/press rules
 * intact. Shared by {@link TabWindow}'s and `WindowHeader`'s focus hooks.
 *
 * @param buttons - The control buttons to flatten or restore.
 * @param active - True to restore the control fill, false to flatten it.
 */
export function setWindowControlsActive(buttons: Button[], active: boolean): void {
    const background = active ? "var(--ts-ui-window-control-bg)" : "transparent";

    for (const button of buttons) {
        button.setBackground(background);
    }
}
