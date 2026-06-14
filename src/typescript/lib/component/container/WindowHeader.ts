// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header, HeaderOptions } from "~/component/display/Header.js";
import { Button, ClickListener } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Placement } from "~/primitive/Placement.js";
import { callable } from "~/core/Callable.js";
import {
    createWindowControlButton,
    setWindowControlsActive,
} from "~/core/windowControls.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { window_maximize } from "~/glyphs/solid/window_maximize.js";
import { window_minimize } from "~/glyphs/solid/window_minimize.js";
import { window_restore } from "~/glyphs/solid/window_restore.js";

Glyph.register(xmark, window_maximize, window_minimize, window_restore);

// Pixel size of the leading title-glyph's ink. Matches the ink a TabWindow's
// leading glyph renders (its control-peer box syncs the glyph to ~14px), so the
// two window kinds show a same-sized title icon. A plain Glyph is pinned to this
// rather than auto-syncing, since it sits in the title-text row, not a strip.
const LEAD_GLYPH_INK_SIZE: number = 14;

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

/**
 * A window title bar component with an embedded `times` glyph close button
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

        this.addComponent(this._titleRow, {
            placement: Placement.WEST,
            anchor:    AnchorType.WEST,
            fill:      FillType.HORIZONTAL
        });

        // Control buttons built from the shared window-control factory so the
        // header's trailing controls match a TabWindow's exactly: the themed
        // `window.control` fill (white in modern, raised in classic). A TabWindow's
        // controls reach their 24×24 box by being stretched to the strip thickness
        // (their `Insets(0,4,0,4)` only sets the within-box padding); a header row is
        // not stretched, so the same look is reached with symmetric `Insets(4,4,4,4)`
        // — a 24×24 box around the 14px glyph that centres in the header (it slightly
        // overflows the text content area into the header padding, like the TabWindow
        // controls fill the strip, without forcing the header taller).
        this._minimizeButton = createWindowControlButton("window-minimize");
        this._maximizeButton = createWindowControlButton("window-maximize");
        this._exitButton     = createWindowControlButton("xmark");

        for (const control of [this._minimizeButton, this._maximizeButton, this._exitButton]) {
            control.setInsets(new Insets(4, 4, 4, 4));
        }

        this._trailingRow = new Component();
        this._trailingRow.setLayoutManager(new HBox({ spacing: 0 }));
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
     * Applies a {@link WindowHeaderOptions} bag, dispatching the closeable,
     * minimizable, and maximizable flags and the optional title-glyph name
     * after inherited Header fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowHeaderOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as WindowHeaderOptions;

        if (opts.closeable !== undefined) {
            this.setCloseable(opts.closeable);
        }

        if (opts.minimizable !== undefined) {
            this.setMinimizable(opts.minimizable);
        }

        if (opts.maximizable !== undefined) {
            this.setMaximizable(opts.maximizable);
        }

        if (opts.glyph !== undefined) {
            this.setGlyph(opts.glyph);
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
        const glyph = new Glyph(name);
        glyph.setPreferredSize(LEAD_GLYPH_INK_SIZE, LEAD_GLYPH_INK_SIZE);
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
     * icons. Called by the owning [`Window`](/api/core/classes/Window) when
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
     * owning [`Window`](/api/core/classes/Window) to toggle the maximize state
     * when the user double-clicks the title (but not the trailing buttons).
     *
     * @param listener - The callback to invoke on `dblclick`.
     */
    addHeaderDoubleClickListener(listener: Function): this {
        Event.addListener(this, "dblclick", listener);

        return this;
    }

    /**
     * Computes the natural required width of the header: title glyph width
     * (or 0 when no glyph is set) plus the supplied text budget plus the
     * three trailing buttons' row width. Used by the owning
     * [`Window`](/api/core/classes/Window) to derive a minSize that keeps
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
     * @remarks Used by the owning [`Window`](/api/core/classes/Window) to
     * short-circuit `dblclick`-on-header maximize toggling when the click
     * target sits inside one of the trailing buttons.
     */
    getMinimizeButtonElement(): HTMLElement | undefined {
        return this._minimizeButton.getElement();
    }

    /**
     * Returns the maximize button DOM element, if the header has been rendered.
     *
     * @returns The maximize button's HTMLElement, or undefined when the header
     *          has not yet been rendered.
     */
    getMaximizeButtonElement(): HTMLElement | undefined {
        return this._maximizeButton.getElement();
    }

    /**
     * Returns the close (exit) button DOM element, if the header has been rendered.
     *
     * @returns The exit button's HTMLElement, or undefined when the header
     *          has not yet been rendered.
     */
    getExitButtonElement(): HTMLElement | undefined {
        return this._exitButton.getElement();
    }
}

const WindowHeaderCallable = callable(WindowHeader);
type WindowHeaderCallable = WindowHeader;
export {
    WindowHeader         as _WindowHeader,
    WindowHeaderCallable as WindowHeader
};
