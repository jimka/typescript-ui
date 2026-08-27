// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header, HeaderOptions } from "~/component/display/Header.js";
import type { Handle } from "~/core/DOM.js";
import { Button, ClickListener } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { ThemeManager } from "~/core/Theme.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import type { StyleTrait } from "~/core/ClassStyleRules.js";
import { GLYPH_MD_INK_TRAIT } from "~/core/StyleTraits.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import { HBox } from "~/layout/HBox.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Placement } from "~/primitive/Placement.js";
import { callable } from "~/core/Callable.js";
import {
    createWindowControlButton,
    setWindowControlsActive,
} from "~/overlay/windowControls.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { window_maximize } from "~/glyphs/solid/window_maximize.js";
import { window_minimize } from "~/glyphs/solid/window_minimize.js";
import { window_restore } from "~/glyphs/solid/window_restore.js";

Glyph.register(xmark, window_maximize, window_minimize, window_restore);

// Equal top/bottom gap (px) around the title line inside the header band. The
// header thickness is `textHeight + 2 * CHROME_MARGIN`; the stretched controls
// fill that full-height band edge-to-edge (no overflow, so the region clip frame
// contains them), and the Fit-centred title sits with this margin above and
// below. Tuned so the thickness matches the established ~26px window-chrome height
// (title line ≈ 18px + 2×4), keeping the redesign visually surgical.
const CHROME_MARGIN: number = 4;

/**
 * Construction-time options for {@link WindowHeader}.
 *
 * @category Components
 */
export interface WindowHeaderOptions extends HeaderOptions {
    closeable?:   boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    glyph?:       string;
}

// Cancels `Glyph`'s own glyphLg-sized minSize/maxSize default (see
// `glyphDefaultSize()` in Glyph.ts), which would otherwise still deviate from
// the framework baseline and reinstate a `.WindowHeaderTitleGlyph` class rule
// carrying the wrong (glyphLg, not glyphMd) size. These values resolve to
// exactly the framework's own minWidth/minHeight ("0px") and maxWidth/
// maxHeight ("none"), so this class contributes no CSS deviation of its own —
// GLYPH_MD_INK_TRAIT alone supplies the shared size, and `updatePreferredSize`
// still pins the real per-instance value on top of it every render.
const NO_OWN_SIZE_DEFAULT: Partial<GlyphOptions> = {
    minSize: { width: 0, height: 0 },
    maxSize: { width: UNBOUNDED, height: UNBOUNDED },
};

/**
 * The leading icon inside a {@link WindowHeader}'s title row. Opts into
 * `GLYPH_MD_INK_TRAIT`, so every window's title icon shares one CSS rule
 * with `ComboBoxCaretGlyph`'s chevron instead of each repeating the same
 * theme-matched size on its own class rule.
 */
class WindowHeaderTitleGlyph extends Glyph {
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [GLYPH_MD_INK_TRAIT];

    /**
     * @param name - The glyph to render.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(name: string, subclassDefaults?: Partial<GlyphOptions>) {
        super(name, undefined, { ...NO_OWN_SIZE_DEFAULT, ...(subclassDefaults ?? {}) });
    }
}

/**
 * A window title bar component with an embedded `xmark` glyph close button
 * and an optional title icon shown to the west of the title text.
 *
 * Extends [`Header`](/api/component/display/classes/Header) by anchoring a
 * trailing row of minimize / maximize / close buttons to the east side and
 * exposing an optional title-icon slot on the west.
 *
 * @category Components
 */
class WindowHeader extends Header {

    private _exitButton:      Button;
    private _minimizeButton:  Button;
    private _maximizeButton:  Button;
    private _trailingRow:     Component;
    private _activeBackground: string;
    private _titleGlyph:      Glyph | null = null;
    private _titleRow:        Component;
    private _closeable:       boolean = true;
    private _minimizable:     boolean = true;
    private _maximizable:     boolean = true;

    constructor(text: string, options?: WindowHeaderOptions) {
        super(text);

        // Focused fill: the dedicated window-header surface, valued equal to the
        // tab-toolbar fill a TabWindow's bar uses so a header Window and a headerless
        // TabWindow share one window-chrome colour (both also share the gutter fill
        // when blurred), while staying independently themeable. A solid colour, not
        // the button gradient that used to sit here.
        this._activeBackground = "var(--ts-ui-window-header-bg, #eee)";
        this.setBackgroundColor(this._activeBackground);

        // Horizontal-only padding: the header is a strip whose vertical extent is
        // the chrome thickness (see updatePreferredSize), so the internal Border
        // band spans the full height and the stretched trailing controls reach the
        // bottom edge where the content panel begins. A vertical inset would shrink
        // the band away from that edge and re-open the gap the redesign closes.
        this.setInsets(new Insets(0, 4, 0, 4));

        // Reparent the inherited title text into a permanent HBox row that
        // owns the Border WEST slot. setGlyph then only has to swap the
        // optional leading glyph child in or out of this row.
        const title = this.getText();
        this.removeComponent(title);

        this._titleRow = new Component();
        this._titleRow.setLayoutManager(new HBox({ spacing: 8 }));
        // Leading inset so the title icon sits the same distance from the left edge
        // as the trailing controls sit from the right (and as a TabWindow's leading
        // glyph) — without it the icon hugs the corner, closer in than the controls.
        this._titleRow.setInsets(new Insets(0, 0, 0, 5));
        this._titleRow.setPointerEvents("none");
        this._titleRow.addComponent(title);

        // Centre the title line vertically in the full-height band: a Fit cell
        // fills the WEST region's width and centres its single child (the title
        // row) on the cross axis. A WEST `AnchorType.CENTER` would not work — the
        // non-collapsible Border region commits via the clip-frame path, which
        // bypasses anchor resolution — so the centring lives in this layout, not
        // the placement anchor.
        const titleCell = new Component();
        titleCell.setLayoutManager(new Fit({ fill: FillType.HORIZONTAL }));
        titleCell.setPointerEvents("none");
        titleCell.addComponent(this._titleRow);

        this.addComponent(titleCell, {
            placement: Placement.WEST,
            anchor:    AnchorType.WEST,
            fill:      FillType.HORIZONTAL
        });

        // Control buttons built from the shared window-control factory so the
        // header's trailing controls match a TabWindow's exactly: the themed
        // `window.control` fill (white in modern, raised in classic). Like a
        // TabWindow's controls — stretched to the strip thickness — these are
        // stretched to the full header band (see the trailing row below), so their
        // `Insets(0,4,0,4)` only sets the within-box horizontal padding; the stretch
        // supplies the height. They fill the band edge-to-edge (no overflow, so the
        // clip frame contains them) and meet the content panel at the bottom edge.
        this._minimizeButton = createWindowControlButton("window-minimize");
        this._maximizeButton = createWindowControlButton("window-maximize");
        this._exitButton     = createWindowControlButton("xmark");

        for (const control of [this._minimizeButton, this._maximizeButton, this._exitButton]) {
            control.setInsets(new Insets(0, 4, 0, 4));
        }

        this._trailingRow = new Component();
        this._trailingRow.setLayoutManager(new HBox({ spacing: 0, stretching: true }));
        this._trailingRow.setInsets(new Insets(0, 0, 0, 0));
        this._trailingRow.addComponent(this._minimizeButton);
        this._trailingRow.addComponent(this._maximizeButton);
        this._trailingRow.addComponent(this._exitButton);

        this.addComponent(this._trailingRow, { placement: Placement.EAST });

        // Default title icon: applied unless an explicit glyph name was passed.
        // Call clearGlyph() on the resulting WindowHeader to opt out entirely.
        if (options?.glyph === undefined) {
            this.setGlyph("window-maximize");
        }

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Derives the header's preferred height as a chrome-band thickness —
     * `textHeight + 2 * CHROME_MARGIN` — rather than the base `textHeight +
     * vertical insets`. With the vertical insets zeroed (so the band reaches the
     * content edge for the stretched controls), the base derivation would collapse
     * the header to the bare text height; this override supplies the breathing band
     * that seats the control box and centres the title line. Runs at construction
     * and on every theme change (the base wires both to this method), so the
     * thickness survives a theme toggle.
     *
     * @remarks Touches the `_titleGlyph` subclass field only behind an
     *   `if (this._titleGlyph)` guard, so it stays safe when called via `super()`
     *   before subclass fields init: during the super-cascade the field is
     *   `undefined`, the guard skips the re-pin, and the rest reads only the
     *   inherited text and the module constant.
     */
    protected updatePreferredSize(): void {
        // 20px mirrors the base Header's pre-measurement fallback (a sane default
        // line height before the text element has measured); the real height takes
        // over on the first measured pass.
        const textSize = this.getText().getPreferredSize();
        const textHeight = textSize ? textSize.height : 20;

        this.setPreferredSize({ width: 100, height: textHeight + 2 * CHROME_MARGIN });

        // Re-pin the title glyph's ink whenever the header re-measures — the
        // inherited Header theme listener drives this method on construction and
        // every theme change, so an SVG title glyph follows a base-size change
        // with no listener of our own. Guarded because the field is undefined
        // during the super() cascade that first runs this method.
        if (this._titleGlyph) {
            const ink = this.resolveTitleGlyphInk();
            this._titleGlyph.setPreferredSize({ width: ink, height: ink });
        }
    }

    /**
     * Reads the title-glyph ink size in px from the active theme's resolved
     * scale snapshot. Read at render time (the `updatePreferredSize` re-pin and
     * `setGlyph`); a base- or theme-change re-resolves the snapshot in `setTheme`
     * and the next layout pass picks it up.
     *
     * @returns The title-glyph ink size in pixels.
     */
    private resolveTitleGlyphInk(): number {
        return ThemeManager.getResolvedScale().glyphMd;
    }

    /**
     * Applies a {@link WindowHeaderOptions} bag, dispatching the closeable,
     * minimizable, and maximizable flags and the optional title-glyph name
     * after inherited Header fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowHeaderOptions): this {
        super.applyOptions(options);

        if (options.closeable !== undefined) {
            this.setCloseable(options.closeable);
        }

        if (options.minimizable !== undefined) {
            this.setMinimizable(options.minimizable);
        }

        if (options.maximizable !== undefined) {
            this.setMaximizable(options.maximizable);
        }

        if (options.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        return this;
    }

    /**
     * Sets or clears the title icon shown to the west of the header text.
     *
     * @param name - Registry glyph name to display, or `null` to remove the icon.
     *
     * @returns This component, for method chaining.
     *
     * @remarks
     * Swaps the optional leading glyph child of the permanent title row built
     * by the constructor. The inherited title text always lives inside that
     * row, so the two never overlap and Border's WEST slot only ever tracks
     * one component.
     */
    setGlyph(name: string): this {
        if (this._titleGlyph) {
            this._titleRow.removeComponent(this._titleGlyph);
            this._titleGlyph = null;
        }

        // A bare decorative glyph (pointer-through) sized to the same ink the
        // TabWindow's leading glyph renders, so the title icon matches it. Kept a
        // plain Glyph rather than a control-peer button so it baseline-aligns with
        // the title text in this shared row (a taller control box would desync the
        // text's vertical centring); the leading inset on the title row supplies the
        // corner offset that mirrors the TabWindow's.
        const glyph = new WindowHeaderTitleGlyph(name);
        const ink = this.resolveTitleGlyphInk();
        glyph.setPreferredSize({ width: ink, height: ink });
        glyph.setPointerEvents("none");
        this._titleGlyph = glyph;

        this._titleRow.insertComponent(glyph, 0);

        return this;
    }

    /**
     * Removes the title icon from the header, if one is present.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        if (this._titleGlyph) {
            this._titleRow.removeComponent(this._titleGlyph);
            this._titleGlyph = null;
        }

        return this;
    }

    /**
     * Returns the current title-glyph component, or null if none is set.
     *
     * @returns The title [`Glyph`](/api/component/display/classes/Glyph), or null.
     */
    getGlyph(): Glyph | null {
        return this._titleGlyph;
    }

    /**
     * Toggles the title bar appearance between the focused and unfocused states.
     *
     * @param active - True to show the focused tab-toolbar background; false for the unfocused gutter background.
     */
    setActive(active: boolean): this {
        this.setBackgroundColor(active
            ? this._activeBackground
            : "var(--ts-ui-gutter-bg, rgb(200, 200, 200))");

        // Flatten the controls to transparent on blur (and restore the themed fill
        // on focus) exactly like a TabWindow's bar, via the shared helper.
        setWindowControlsActive([this._minimizeButton, this._maximizeButton, this._exitButton], active);

        return this;
    }

    /**
     * Enables or disables the close (exit) button. Disabling greys it out and
     * stops it firing, rather than hiding it — so a non-closeable window keeps a
     * full, evenly-spaced button row instead of a gap where the close button was.
     *
     * @param value - True to enable the close button, false to disable it.
     *
     * @returns This component, for method chaining.
     */
    setCloseable(value: boolean): this {
        this._closeable = value;
        this._exitButton.setEnabled(value);

        return this;
    }

    /**
     * Returns whether the close button is enabled.
     *
     * @returns True when the close button is enabled.
     */
    isCloseable(): boolean {
        return this._closeable;
    }

    /**
     * Toggles the visibility of the minimize button.
     *
     * @param value - True to show the minimize button, false to hide it.
     *
     * @returns This component, for method chaining.
     */
    setMinimizable(value: boolean): this {
        this._minimizable = value;
        this._minimizeButton.setVisible(value);

        return this;
    }

    /**
     * Returns whether the minimize button is visible.
     *
     * @returns True when the minimize button is shown.
     */
    isMinimizable(): boolean {
        return this._minimizable;
    }

    /**
     * Toggles the visibility of the maximize button.
     *
     * @param value - True to show the maximize button, false to hide it.
     *
     * @returns This component, for method chaining.
     */
    setMaximizable(value: boolean): this {
        this._maximizable = value;
        this._maximizeButton.setVisible(value);

        return this;
    }

    /**
     * Returns whether the maximize button is visible.
     *
     * @returns True when the maximize button is shown.
     */
    isMaximizable(): boolean {
        return this._maximizable;
    }

    /**
     * Swaps the maximize button's glyph between the "maximize" and "restore"
     * icons. Called by the owning [`Window`](/api/overlay/classes/Window) when
     * transitioning between the `"normal"` and `"maximized"` states.
     *
     * @param name - Either `"window-maximize"` or `"window-restore"`.
     *
     * @returns This component, for method chaining.
     */
    setMaximizeButtonGlyph(name: "window-maximize" | "window-restore"): this {
        this._maximizeButton.setGlyph(name);

        return this;
    }

    /**
     * Swaps the minimize button's glyph between the "minimize" and "restore"
     * icons. Called by the owning [`Window`](/api/overlay/classes/Window) when
     * transitioning into and out of the `"minimized"` state — while minimized the
     * window stays docked at header height with the button visible, so a restore
     * glyph signals that pressing it un-minimizes (mirroring the maximize button's
     * restore swap).
     *
     * @param name - Either `"window-minimize"` or `"window-restore"`.
     *
     * @returns This component, for method chaining.
     */
    setMinimizeButtonGlyph(name: "window-minimize" | "window-restore"): this {
        this._minimizeButton.setGlyph(name);

        return this;
    }

    /**
     * Registers a click listener on the window close button.
     *
     * @param listener - The callback to invoke when the close button is clicked.
     */
    addExitButtonListener(listener: Function) : this {
        this._exitButton.on("action", listener as ClickListener);

        return this;
    }

    /**
     * Registers a click listener on the window minimize button.
     *
     * @param listener - The callback to invoke when the minimize button is clicked.
     */
    addMinimizeButtonListener(listener: Function): this {
        this._minimizeButton.on("action", listener as ClickListener);

        return this;
    }

    /**
     * Registers a click listener on the window maximize button.
     *
     * @param listener - The callback to invoke when the maximize button is clicked.
     */
    addMaximizeButtonListener(listener: Function): this {
        this._maximizeButton.on("action", listener as ClickListener);

        return this;
    }

    /**
     * Registers a `dblclick` listener on the header bar itself, used by the
     * owning [`Window`](/api/overlay/classes/Window) to toggle the maximize state
     * when the user double-clicks the title (but not the trailing buttons).
     *
     * @param listener - The callback to invoke on `dblclick`.
     */
    addHeaderDoubleClickListener(listener: Event.Listener): this {
        // Subtree, not exact-target: the title row sits inside a Border clip-frame
        // wrapper, so a double-click on the title text/glyph targets that wrapper
        // rather than the bare header element. The owning Window's handler already
        // filters out the trailing buttons via targetIsInTrailingButton.
        Event.addSubtreeListener(this, "dblclick", listener);

        return this;
    }

    /**
     * Computes the natural required width of the header: title glyph width
     * (or 0 when no glyph is set) plus the supplied text budget plus the
     * three trailing buttons' row width. Used by the owning
     * [`Window`](/api/overlay/classes/Window) to derive a minSize that keeps
     * the title icon, some text space, and the trailing buttons all visible
     * when the window is shrunk.
     *
     * @param textBudget - Pixels to reserve for the title text label.
     *
     * @returns The natural required header width in pixels.
     */
    getMinContentWidth(textBudget: number = 100): number {
        const glyphW    = this._titleGlyph?.getPreferredSize()?.width ?? 0;
        const trailingW = this._trailingRow.getPreferredSize()?.width  ?? 0;

        return glyphW + textBudget + trailingW;
    }

    /**
     * Returns the minimize button DOM element, if the header has been rendered.
     *
     * @returns The minimize button's HTMLElement, or undefined when the header
     *          has not yet been rendered.
     *
     * @remarks Used by the owning [`Window`](/api/overlay/classes/Window) to
     * short-circuit `dblclick`-on-header maximize toggling when the click
     * target sits inside one of the trailing buttons.
     */
    getMinimizeButtonElement(): Handle | undefined {
        return this._minimizeButton.getElement();
    }

    /**
     * Returns the maximize button DOM element, if the header has been rendered.
     *
     * @returns The maximize button's HTMLElement, or undefined when the header
     *          has not yet been rendered.
     */
    getMaximizeButtonElement(): Handle | undefined {
        return this._maximizeButton.getElement();
    }

    /**
     * Returns the close (exit) button DOM element, if the header has been rendered.
     *
     * @returns The exit button's HTMLElement, or undefined when the header
     *          has not yet been rendered.
     */
    getExitButtonElement(): Handle | undefined {
        return this._exitButton.getElement();
    }
}

const WindowHeaderCallable = callable(WindowHeader);
type WindowHeaderCallable = WindowHeader;
export {
    WindowHeader         as _WindowHeader,
    WindowHeaderCallable as WindowHeader
};
