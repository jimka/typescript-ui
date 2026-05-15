// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BorderStyle } from "~/primitive/BorderStyle.js";

/**
 * Represents a single side of a CSS border, holding its placement prefix,
 * style, width, and color.
 *
 * @category Util
 */
export class BorderLine extends Object {

    private placement: string;
    private borderStyle: BorderStyle;
    private width: number;
    private color: string;

    /**
     * @param placement - The CSS property prefix for this side (e.g. `"border-top"`).
     * @param borderStyle - Optional. The border style enum value. Defaults to `BorderStyle.NONE`.
     * @param width - Optional. The border width in pixels. Defaults to `0`.
     * @param color - Optional. The border color string. Defaults to `"black"`.
     */
    constructor(placement: string, borderStyle?: BorderStyle, width?: number, color?: string) {
        super();

        this.placement = placement;
        this.borderStyle = borderStyle ? borderStyle : BorderStyle.NONE;
        this.width = width ? width : 0;
        this.color = color ? color : "black";
    }

    /**
     * Returns the CSS property prefix for this side (e.g. `"border-top"`).
     *
     * @returns The placement string passed at construction time.
     */
    getPlacement() {
        return this.placement;
    }

    /**
     * Returns the border style enum value.
     *
     * @returns The [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum member for this border side.
     */
    getStyle() {
        return this.borderStyle;
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
        return this.width;
    }

    /**
     * Returns the border color string.
     *
     * @returns The color value as a CSS color string.
     */
    getColor() {
        return this.color;
    }

    /**
     * Sets the border style, width, and color.
     *
     * @param borderStyle - The new [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum value.
     * @param width - The new border width in pixels.
     * @param color - The new border color string.
     */
    set(borderStyle: BorderStyle, width: number, color: string) : this {
        this.borderStyle = borderStyle;
        this.width = width;
        this.color = color;

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
     * Writes this border side's width, style, and color properties onto the given CSS rule.
     *
     * @param rule - The `CSSStyleRule` to apply the border properties to.
     *
     * @remarks Sets three separate CSS properties using the placement prefix:
     * `<placement>-width`, `<placement>-style`, and `<placement>-color`. Thin
     * wrapper over {@link BorderLine.toStyle} retained for callers that hold a
     * pseudo-class rule (e.g. Button's `:active` rule).
     */
    applyOnCSSRule(rule: CSSStyleRule): void {
        const style = this.toStyle();

        for (const key in style) {
            const value = style[key];

            if (value === null) {
                rule.style.removeProperty(key);
            } else {
                rule.style.setProperty(key, value);
            }
        }
    }

    /**
     * Returns this side's width / style / color as a [`Style`](/api/core/interfaces/Style)
     * map so callers can batch the writes through `Component.setElementCSSRules`
     * rather than mutating a live `CSSStyleRule`.
     *
     * @returns A map of CSS property names to string values.
     */
    toStyle(): { [key: string]: string | null } {
        const prefix = this.placement.valueOf();

        return {
            [prefix + "-width"]: this.getWidth() + "px",
            [prefix + "-style"]: this.getStyleString(),
            [prefix + "-color"]: this.getColor()
        };
    }
};
