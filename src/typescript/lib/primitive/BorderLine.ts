// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BorderStyle } from "~/primitive/BorderStyle.js";

/**
 * Converts a hyphenated placement prefix (e.g. `"border-top"`) to its
 * camelCase equivalent (`"borderTop"`). Used to compose the camelCase
 * property keys emitted by {@link BorderLine.toStyle}.
 *
 * @param placement - The CSS property prefix (e.g. `"border-top"`).
 * @returns The camelCase prefix (e.g. `"borderTop"`).
 */
function camelCasePrefix(placement: string): string {
    return placement.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Represents a single side of a CSS border, holding its placement prefix,
 * style, width, and color.
 *
 * @category Util
 */
export class BorderLine extends Object {

    private _placement: string;
    private _borderStyle: BorderStyle;
    private _width: number;
    private _color: string;

    /**
     * @param placement - The CSS property prefix for this side (e.g. `"border-top"`).
     * @param borderStyle - Optional. The border style enum value. Defaults to `BorderStyle.NONE`.
     * @param width - Optional. The border width in pixels. Defaults to `0`.
     * @param color - Optional. The border color string. Defaults to `"black"`.
     */
    constructor(placement: string, borderStyle?: BorderStyle, width?: number, color?: string) {
        super();

        this._placement = placement;
        this._borderStyle = borderStyle ? borderStyle : BorderStyle.NONE;
        this._width = width ? width : 0;
        this._color = color ? color : "black";
    }

    /**
     * Returns the CSS property prefix for this side (e.g. `"border-top"`).
     *
     * @returns The placement string passed at construction time.
     */
    getPlacement() {
        return this._placement;
    }

    /**
     * Returns the border style enum value.
     *
     * @returns The [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum member for this border side.
     */
    getStyle() {
        return this._borderStyle;
    }

    /**
     * Returns the border style as a lowercase CSS string (e.g. `"solid"`).
     *
     * @returns The lowercased name of the [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum member.
     */
    getStyleString() {
        return BorderStyle[this.getStyle()].toLowerCase();
    }

    /**
     * Returns the border width in pixels.
     *
     * @returns The width value in pixels.
     */
    getWidth() {
        return this._width;
    }

    /**
     * Returns the border color string.
     *
     * @returns The color value as a CSS color string.
     */
    getColor() {
        return this._color;
    }

    /**
     * Sets the border style, width, and color.
     *
     * @param borderStyle - The new [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum value.
     * @param width - The new border width in pixels.
     * @param color - The new border color string.
     */
    set(borderStyle: BorderStyle, width: number, color: string) : this {
        this._borderStyle = borderStyle;
        this._width = width;
        this._color = color;

        return this;
    }

    /**
     * Returns the border as a CSS shorthand string (e.g. `"1px solid black"`).
     *
     * @returns A CSS border shorthand value in `"<width>px <style> <color>"` format.
     */
    render() {
        return this.getWidth() + "px " + this.getStyleString() + " " + this.getColor();
    }

    /**
     * Returns this side's width / style / color as a [`Style`](/api/core/interfaces/Style)
     * map so callers can batch the writes through `Component.setElementCSSRules`
     * (or the underlying `StyleRule.setMany`) rather than mutating a live
     * `CSSStyleRule`.
     *
     * @returns A map of camelCase CSS property names to string values
     *   (e.g. `borderTopWidth`, `borderTopStyle`, `borderTopColor`).
     *
     * @remarks Keys are camelCase because the underlying `StyleRule` /
     * `InlineStyle` buffers write via bracket-indexed assignment on
     * `CSSStyleDeclaration`, which only honours camelCase property names.
     */
    toStyle(): { [key: string]: string | null } {
        const prefix = camelCasePrefix(this._placement);

        return {
            [prefix + "Width"]: this.getWidth() + "px",
            [prefix + "Style"]: this.getStyleString(),
            [prefix + "Color"]: this.getColor()
        };
    }
};
