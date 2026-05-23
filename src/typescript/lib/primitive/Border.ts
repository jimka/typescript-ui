// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BorderLine } from "~/primitive/BorderLine.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";

/**
 * Configuration options for a single border side.
 *
 * @category Util
 */
export interface BorderSideOptions {
    style?: BorderStyle;
    width?: number;
    color?: string;
}

/**
 * Configuration options for all four sides of a border.
 * Top-level `style`, `width`, and `color` act as fallbacks for any side that does not
 * specify its own options.
 *
 * @category Util
 */
export interface BorderOptions {
    style?: BorderStyle;
    width?: number;
    color?: string;
    top?: BorderSideOptions;
    right?: BorderSideOptions;
    bottom?: BorderSideOptions;
    left?: BorderSideOptions;
}

/**
 * Represents a complete CSS border composed of four individually configurable sides.
 *
 * @category Util
 */
export class Border extends Object {

    private _top: BorderLine;
    private _right: BorderLine;
    private _bottom: BorderLine;
    private _left: BorderLine;

    /**
     * @param options - Optional. Border configuration. Per-side options take precedence over
     * the top-level `style`, `width`, and `color` fallback values.
     */
    constructor(options?: BorderOptions) {
        super();

        const fallback: BorderSideOptions = { style: options?.style, width: options?.width, color: options?.color };

        const top    = options?.top    ?? fallback;
        const right  = options?.right  ?? fallback;
        const bottom = options?.bottom ?? fallback;
        const left   = options?.left   ?? fallback;

        this._top    = new BorderLine("border-top"   , top.style, top.width, top.color);
        this._right  = new BorderLine("border-right" , right.style as BorderStyle, right.width as number, right.color as string);
        this._bottom = new BorderLine("border-bottom", bottom.style as BorderStyle, bottom.width as number, bottom.color as string);
        this._left   = new BorderLine("border-left"  , left.style as BorderStyle, left.width as number, left.color as string);
    }

    /**
     * Returns the top border line definition.
     *
     * @returns The [`BorderLine`](/api/primitive/classes/BorderLine) instance for the top side.
     */
    getTop() {
        return this._top;
    }

    /**
     * Returns the right border line definition.
     *
     * @returns The [`BorderLine`](/api/primitive/classes/BorderLine) instance for the right side.
     */
    getRight() {
        return this._right;
    }

    /**
     * Returns the bottom border line definition.
     *
     * @returns The [`BorderLine`](/api/primitive/classes/BorderLine) instance for the bottom side.
     */
    getBottom() {
        return this._bottom;
    }

    /**
     * Returns the left border line definition.
     *
     * @returns The [`BorderLine`](/api/primitive/classes/BorderLine) instance for the left side.
     */
    getLeft() {
        return this._left;
    }

    /**
     * Sets all four sides to the same style, width, and color.
     *
     * @param borderStyle - The [`BorderStyle`](/api/primitive/enumerations/BorderStyle) enum value to apply to all sides.
     * @param width - The border width in pixels to apply to all sides.
     * @param color - The border color string to apply to all sides.
     */
    set(borderStyle: BorderStyle, width: number, color: string) : this {
        this._top.set(borderStyle, width, color);
        this._right.set(borderStyle, width, color);
        this._bottom.set(borderStyle, width, color);
        this._left.set(borderStyle, width, color);

        return this;
    }

    /**
     * Returns all four border sides as a [`Style`](/api/core/interfaces/Style)
     * map ready to feed into `Component.setElementCSSRules`, so the writes are
     * buffered through the component's dirty-style path instead of mutating a
     * live `CSSStyleRule`.
     *
     * @returns A map of CSS property names to string values covering all four sides.
     */
    toStyle(): { [key: string]: string | null } {
        return {
            ...this._top.toStyle(),
            ...this._right.toStyle(),
            ...this._bottom.toStyle(),
            ...this._left.toStyle()
        };
    }

    /**
     * Parses a CSS border shorthand string (e.g. `"1px solid #aaa"`) into a Border object.
     * Tokens are classified as width (`<n>px`), style (any BorderStyle keyword), or color (everything else).
     *
     * @param css - A CSS border shorthand value.
     * @returns A Border whose four sides share the parsed width, style, and color.
     */
    static fromString(css: string): Border {
        const tokens = css.trim().split(/\s+/);
        let width = 0;
        let style: BorderStyle = BorderStyle.SOLID;
        const colorParts: string[] = [];

        for (const token of tokens) {
            const widthMatch = token.match(/^([\d.]+)px$/i);
            if (widthMatch) {
                width = parseFloat(widthMatch[1]);
                continue;
            }

            const key = token.toUpperCase();
            if (key in BorderStyle && typeof (BorderStyle as Record<string, unknown>)[key] === 'number') {
                style = (BorderStyle as Record<string, unknown>)[key] as BorderStyle;
                continue;
            }

            colorParts.push(token);
        }

        const color = colorParts.length > 0 ? colorParts.join(' ') : 'black';
        return new Border({ style, width, color });
    }
}
