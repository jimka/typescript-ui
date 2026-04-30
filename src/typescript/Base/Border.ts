// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { BorderLine } from "./BorderLine.js";
import { BorderStyle } from "./BorderStyle.js";

/**
 * Configuration options for a single border side.
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
 */
export class Border extends Object {

    private top: BorderLine;
    private right: BorderLine;
    private bottom: BorderLine;
    private left: BorderLine;

    /**
     * @param options - Optional. Border configuration. Per-side options take precedence over
     * the top-level `style`, `width`, and `color` fallback values.
     */
    constructor(options?: BorderOptions) {
        super();

        const fallback: BorderSideOptions = { style: options?.style, width: options?.width, color: options?.color };
        const top = options?.top ?? fallback;
        const right = options?.right ?? fallback;
        const bottom = options?.bottom ?? fallback;
        const left = options?.left ?? fallback;

        this.top = new BorderLine("border-top", top.style, top.width, top.color);
        this.right = new BorderLine("border-right", right.style as BorderStyle, right.width as number, right.color as string);
        this.bottom = new BorderLine("border-bottom", bottom.style as BorderStyle, bottom.width as number, bottom.color as string);
        this.left = new BorderLine("border-left", left.style as BorderStyle, left.width as number, left.color as string);
    }

    /**
     * Returns the top border line definition.
     *
     * @returns The `BorderLine` instance for the top side.
     */
    getTop() {
        return this.top;
    }

    /**
     * Returns the right border line definition.
     *
     * @returns The `BorderLine` instance for the right side.
     */
    getRight() {
        return this.right;
    }

    /**
     * Returns the bottom border line definition.
     *
     * @returns The `BorderLine` instance for the bottom side.
     */
    getBottom() {
        return this.bottom;
    }

    /**
     * Returns the left border line definition.
     *
     * @returns The `BorderLine` instance for the left side.
     */
    getLeft() {
        return this.left;
    }

    /**
     * Sets all four sides to the same style, width, and color.
     *
     * @param borderStyle - The `BorderStyle` enum value to apply to all sides.
     * @param width - The border width in pixels to apply to all sides.
     * @param color - The border color string to apply to all sides.
     */
    set(borderStyle: BorderStyle, width: number, color: string) {
        this.top.set(borderStyle, width, color);
        this.right.set(borderStyle, width, color);
        this.bottom.set(borderStyle, width, color);
        this.left.set(borderStyle, width, color);
    }

    /**
     * Writes all four border sides as CSS properties onto the given rule.
     *
     * @param rule - The `CSSStyleRule` to apply the border properties to.
     */
    applyOnCSSRule(rule: CSSStyleRule) {
        this.top.applyOnCSSRule(rule);
        this.right.applyOnCSSRule(rule);
        this.bottom.applyOnCSSRule(rule);
        this.left.applyOnCSSRule(rule);
    }
}
