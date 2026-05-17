// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Header, HeaderOptions } from "~/component/display/Header.js";
import { Button } from "~/component/button/Button.js";
import { Component } from "~/core/Component.js";
import { Glyph } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { Placement } from "~/primitive/Placement.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link WindowHeader}.
 *
 * @category Components
 */
export interface WindowHeaderOptions extends HeaderOptions {
    closeable?: boolean;
    glyph?:     string;
}

/**
 * A window title bar component with an embedded `times` glyph close button
 * and an optional title icon shown to the west of the title text.
 *
 * Extends [`Header`](/api/component/display/classes/Header) by anchoring a
 * close button to the east side and exposing an optional title-icon slot on
 * the west.
 *
 * @category Components
 */
class WindowHeader extends Header {

    private _exitButton: Button;
    private _activeBackgroundImage: string;
    private _titleGlyph: Glyph | null = null;
    private _titleRow: Component;

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

        this._exitButton = new Button({ glyph: "times" });
        this._exitButton.setBackgroundImage(this._activeBackgroundImage);
        this._exitButton.clearBorder();

        this.addComponent(this._exitButton, { placement: Placement.EAST });

        // Default title icon: applied unless an explicit glyph name was passed.
        // Call clearGlyph() on the resulting WindowHeader to opt out entirely.
        if (options?.glyph === undefined) {
            this.setGlyph("window");
        }

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link WindowHeaderOptions} bag, dispatching the closeable flag
     * and the optional title-glyph name after inherited Header fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowHeaderOptions): this {
        super.applyOptions(options);

        if (options.closeable !== undefined) {
            this._exitButton.setVisible(options.closeable);
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
     * Registers a click listener on the window close button.
     *
     * @param listener - The callback to invoke when the close button is clicked.
     */
    addExitButtonListener(listener: Function) : this {
        this._exitButton.addActionListener(listener);

        return this;
    }
}

const WindowHeaderCallable = callable(WindowHeader);
type WindowHeaderCallable = WindowHeader;
export {
    WindowHeader         as _WindowHeader,
    WindowHeaderCallable as WindowHeader
};
