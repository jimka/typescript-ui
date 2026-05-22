// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header, HeaderOptions } from "~/component/display/Header.js";
import { Button } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Placement } from "~/primitive/Placement.js";
import { callable } from "~/core/Callable.js";
import { xmark } from "~/glyphs/solid/xmark.js";
import { window_maximize } from "~/glyphs/solid/window_maximize.js";
import { window_minimize } from "~/glyphs/solid/window_minimize.js";
import { window_restore } from "~/glyphs/solid/window_restore.js";

Glyph.register(xmark, window_maximize, window_minimize, window_restore);

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
    private _activeBackgroundImage: string;
    private _titleGlyph:      Glyph | null = null;
    private _titleRow:        Component;
    private _minimizable:     boolean = true;
    private _maximizable:     boolean = true;

    constructor(text: string, options?: WindowHeaderOptions) {
        super(text);

        this._activeBackgroundImage = "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))";
        this.setBackgroundImage(this._activeBackgroundImage);

        // Reparent the inherited title text into a permanent HBox row that
        // owns the Border WEST slot. setGlyph then only has to swap the
        // optional leading glyph child in or out of this row.
        const title = this.getText();
        this.removeComponent(title);

        this._titleRow = new Component();
        this._titleRow.setLayoutManager(new HBox({ spacing: 8 }));
        this._titleRow.setInsets(new Insets(0, 0, 0, 0));
        this._titleRow.setPointerEvents("none");
        this._titleRow.addComponent(title);

        this.addComponent(this._titleRow, {
            placement: Placement.WEST,
            anchor:    AnchorType.WEST,
            fill:      FillType.HORIZONTAL
        });

        this._minimizeButton = new Button({ glyph: "window-minimize" });
        this._minimizeButton.setBackgroundImage(this._activeBackgroundImage);
        this._minimizeButton.clearBorder();

        this._maximizeButton = new Button({ glyph: "window-maximize" });
        this._maximizeButton.setBackgroundImage(this._activeBackgroundImage);
        this._maximizeButton.clearBorder();

        this._exitButton = new Button({ glyph: "xmark" });
        this._exitButton.setBackgroundImage(this._activeBackgroundImage);
        this._exitButton.clearBorder();

        this._trailingRow = new Component();
        this._trailingRow.setLayoutManager(new HBox({ spacing: 2 }));
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

        if (options.closeable !== undefined) {
            this._exitButton.setVisible(options.closeable);
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

        const glyph = new Glyph(name);
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
     * @param active - True to show the focused (gradient) background; false for the unfocused (flat) background.
     */
    setActive(active: boolean): this {
        if (active) {
            this.setBackgroundImage(this._activeBackgroundImage);
            this.clearBackgroundColor();
        } else {
            this.clearBackgroundImage();
            this.setBackgroundColor("var(--ts-ui-gutter-bg, rgb(200, 200, 200))");
        }

        return this;
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
        this._exitButton.addActionListener(listener);

        return this;
    }

    /**
     * Registers a click listener on the window minimize button.
     *
     * @param listener - The callback to invoke when the minimize button is clicked.
     */
    addMinimizeButtonListener(listener: Function): this {
        this._minimizeButton.addActionListener(listener);

        return this;
    }

    /**
     * Registers a click listener on the window maximize button.
     *
     * @param listener - The callback to invoke when the maximize button is clicked.
     */
    addMaximizeButtonListener(listener: Function): this {
        this._maximizeButton.addActionListener(listener);

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
