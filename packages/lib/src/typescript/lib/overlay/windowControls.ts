// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Resting + pressed/hover defaults for a window control button (minimize /
 * maximize / close), painted from the theme's `window.control` tokens.
 * `backgroundColor` and `backgroundImage` both carry the same token —
 * flat-colour themes (modern/dark) resolve it as a colour, the classic
 * theme's gradient resolves it as an image; CSS silently drops whichever
 * channel doesn't parse, the same two-channel pattern Button's own resting
 * fill uses (see Button.ts's chromeful `applyChromeOptions` branch).
 * `pressedForegroundColor`/`pressedShadow`/`hoverShadow` are pinned to the
 * same value as the resting tier — window-control buttons never change
 * colour or shadow on press/hover, only background — so the `ownStyleStates`
 * merge below doesn't leak Button's generic raised pressed/hover chrome onto
 * these two properties. `borderRadius: undefined` is an explicit key (not an
 * omission) so it wins over Button's own non-empty default in the
 * subclassDefaults spread merge, mirroring TabButton's identical trick.
 */
const _defaultWindowControlOptions: Partial<ButtonOptions> = {
    backgroundColor:        "var(--ts-ui-window-control-bg)",
    backgroundImage:        "var(--ts-ui-window-control-bg)",
    border:                 "var(--ts-ui-window-control-border)",
    borderRadius:           undefined,
    shadow:                 "var(--ts-ui-window-control-shadow)",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "var(--ts-ui-window-control-active-bg)",
    pressedBackgroundImage: "var(--ts-ui-window-control-active-bg)",
    pressedShadow:          "var(--ts-ui-window-control-shadow)",
    hoverBackgroundColor:   "var(--ts-ui-window-control-hover-bg)",
    hoverBackgroundImage:   "var(--ts-ui-window-control-hover-bg)",
    hoverShadow:            "var(--ts-ui-window-control-shadow)",
};

/**
 * A single window control button (minimize / maximize / close), shared by
 * `TabWindow`'s trailing tools and `WindowHeader`'s trailing buttons. Real,
 * declared chrome instead of `chromeless: true` — see
 * plans/implemented/button-variant-chrome-dedup.md's Architecture Decisions
 * for why chromeless's bare-`#id` resting write can never lose to a shared
 * class rule. Module-private: not exported, not wrapped in `callable()`
 * (same treatment as `CheckboxBox` in `Checkbox.ts`).
 */
class WindowControlButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultWindowControlOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultWindowControlOptions.pressedForegroundColor,
                backgroundColor: _defaultWindowControlOptions.pressedBackgroundColor,
                backgroundImage: _defaultWindowControlOptions.pressedBackgroundImage,
                shadow:          _defaultWindowControlOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultWindowControlOptions.hoverBackgroundColor,
                backgroundImage: _defaultWindowControlOptions.hoverBackgroundImage,
                shadow:          _defaultWindowControlOptions.hoverShadow,
            }),
        },
    ];

    constructor(glyph: string, subclassDefaults?: Partial<ButtonOptions>) {
        super(undefined, { glyph, insets: new Insets(2, 2, 2, 2) }, { ..._defaultWindowControlOptions, ...(subclassDefaults ?? {}) });
    }
}

/**
 * Resting + pressed/hover defaults for the window-menu-trigger leading glyph
 * (title icon) — transparent at rest, so the bar/header surface shows
 * through, with a `1px solid transparent` border reserving the same border
 * box the real controls' themed border occupies (keeps it a size/inset
 * peer). `pressedShadow` / `hoverShadow` are pinned to `"none"` (this
 * button's own resting shadow), mirroring how `_defaultWindowControlOptions`
 * pins its own pressed/hover shadow to its resting value — the icon now
 * opens the window menu, so it needs the same active/hover background swap
 * `WindowControlButton` declares, just never a shadow or foreground change.
 */
const _defaultWindowLeadGlyphOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "1px solid transparent",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "var(--ts-ui-window-control-active-bg)",
    pressedBackgroundImage: "var(--ts-ui-window-control-active-bg)",
    pressedShadow:          "none",
    hoverBackgroundColor:   "var(--ts-ui-window-control-hover-bg)",
    hoverBackgroundImage:   "var(--ts-ui-window-control-hover-bg)",
    hoverShadow:            "none",
};

/**
 * The window's leading glyph (title icon) and system-menu trigger. Real,
 * declared chrome — the same `ownStyleStates` shape `WindowControlButton`
 * declares — since a press now opens the window menu instead of falling
 * through to the window-move gesture.
 */
class WindowLeadGlyphButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultWindowLeadGlyphOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultWindowLeadGlyphOptions.pressedForegroundColor,
                backgroundColor: _defaultWindowLeadGlyphOptions.pressedBackgroundColor,
                backgroundImage: _defaultWindowLeadGlyphOptions.pressedBackgroundImage,
                shadow:          _defaultWindowLeadGlyphOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultWindowLeadGlyphOptions.hoverBackgroundColor,
                backgroundImage: _defaultWindowLeadGlyphOptions.hoverBackgroundImage,
                shadow:          _defaultWindowLeadGlyphOptions.hoverShadow,
            }),
        },
    ];

    constructor(glyph: string, subclassDefaults?: Partial<ButtonOptions>) {
        super(undefined, { glyph, insets: new Insets(2, 2, 2, 2) }, { ..._defaultWindowLeadGlyphOptions, ...(subclassDefaults ?? {}) });
    }
}

/**
 * Builds a window control button (minimize / maximize / close) shared by
 * `TabWindow` and `WindowHeader`. Callers wire the `"action"` listener and
 * may override the insets to match their container's box (a `TabWindow`'s
 * bar re-sets them to the compact tool inset).
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured control button.
 */
export function createWindowControlButton(glyph: string): Button {
    return new WindowControlButton(glyph);
}

/**
 * Builds the window's leading glyph (title icon) shared by `TabWindow` and
 * `WindowHeader` — the window's system-menu trigger, not a decorative
 * pass-through. Same size/inset box as {@link createWindowControlButton} so
 * it is a peer of the trailing controls.
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured leading glyph button.
 */
export function createWindowLeadGlyphButton(glyph: string): Button {
    const button = new WindowLeadGlyphButton(glyph);
    // Button sets its whole `_content` row to `pointer-events: none` so face
    // clicks fall through to the `<button>`; this button then sits inside
    // `TabBar._leadGroup`'s own `pointer-events: none`, so with no declaration
    // of its own it would stay un-hit-testable — see SplitButton's chevron
    // for the identical inherited-none reason.
    button.setPointerEvents("auto");

    return button;
}

/**
 * Toggles a set of window control buttons between their opaque themed fill
 * (focused) and `"transparent"` (blurred). Two channels (`backgroundColor` +
 * `backgroundImage`), not the `background` shorthand — see this file's
 * `_defaultWindowControlOptions` comment for why. Shared by `TabWindow`'s
 * and `WindowHeader`'s focus hooks.
 *
 * @param buttons - The control buttons to flatten or restore.
 * @param active - True to restore the control fill, false to flatten it.
 */
export function setWindowControlsActive(buttons: Button[], active: boolean): void {
    const backgroundColor = active ? "var(--ts-ui-window-control-bg)" : "transparent";
    const backgroundImage = active ? "var(--ts-ui-window-control-bg)" : "none";

    for (const button of buttons) {
        button.setBackgroundColor(backgroundColor);
        button.setBackgroundImage(backgroundImage);
    }
}
