// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Size } from "./Size.js";

/**
 * Font options for off-screen text measurement.
 * All properties default to the active theme variables when omitted.
 */
export interface TextMeasureOptions {
    fontFamily?: string;
    fontSize?  : string;
    fontWeight?: string;
    fontStyle? : string;
    fontVariant?: string;
    fontStretch?: string;
}

/**
 * General-purpose utility functions for DOM interaction and browser environment queries.
 */
export namespace Util {

    let scrollBarWidth: number = -1;

    /**
     * Measures the rendered size of a text string using an off-screen probe `<span>`.
     *
     * @param text - The string to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns The measured `{width, height}` in pixels, ceiled to whole pixels.
     */
    export function measureTextSize(text: string, options: TextMeasureOptions = {}): Size {
        const {
            fontFamily  = "var(--ts-ui-font-family, system-ui, sans-serif)",
            fontSize    = "var(--ts-ui-font-size, 14px)",
            fontWeight  = "normal",
            fontStyle   = "normal",
            fontVariant = "normal",
            fontStretch = "normal",
        } = options;

        const probe = document.createElement("span");

        probe.style.cssText = [
            "position:fixed",
            "visibility:hidden",
            "white-space:nowrap",
            `font-family:${fontFamily}`,
            `font-size:${fontSize}`,
            `font-weight:${fontWeight}`,
            `font-style:${fontStyle}`,
            `font-variant:${fontVariant}`,
            `font-stretch:${fontStretch}`,
        ].join(";");

        probe.textContent = text;
        document.body.appendChild(probe);

        const rect = probe.getBoundingClientRect();

        document.body.removeChild(probe);

        return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    }

    /**
     * Returns the rendered pixel width of a text string.
     *
     * @param text - The string to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns The measured width in pixels, ceiled to a whole pixel.
     */
    export function measureTextWidth(text: string, options?: TextMeasureOptions): number {
        return measureTextSize(text, options).width;
    }

    /**
     * Measures the natural height of a native `<input>` element at the current theme font size.
     *
     * Uses an off-screen probe element so that the result reflects the browser's actual
     * default styling at whatever font size the theme specifies.
     * Returns 20 as a safe fallback if the measurement fails.
     *
     * @returns The measured height in pixels, rounded up to the nearest integer.
     */
    export function measureInputHeight(): number {
        const probe = document.createElement("input");

        probe.style.position   = "fixed";
        probe.style.visibility = "hidden";
        probe.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        probe.style.fontSize   = "var(--ts-ui-font-size, 14px)";

        document.body.appendChild(probe);

        const height = Math.ceil(probe.getBoundingClientRect().height);

        document.body.removeChild(probe);

        return height || 20;
    }

    /**
     * Generates a UUID string, ensuring the first character is never a digit.
     *
     * @returns A UUID v4 string with a guaranteed non-numeric first character.
     *
     * @remarks If the standard UUID generation produces a leading digit, it is replaced
     * with the letter "a" so the result is safe to use as a DOM id or CSS identifier.
     */
    export function generateUUID() {
        let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = Math.random() * 16 | 0,
                v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });

        let first = parseInt(uuid[0]);
        if (Util.isInteger(first)) {
            uuid = "a" + uuid.substring(1, uuid.length);
        }

        return uuid;
    }

    /**
     * Returns true if value is an integer.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is an integer, `false` otherwise.
     */
    export function isInteger(value: Object) {
        return Number.isInteger(value);
    }

    /**
     * Queries the DOM for the first element matching the CSS selector.
     *
     * @param selector - A valid CSS selector string.
     *
     * @returns The first matching `HTMLElement`, or `null` cast as `HTMLElement` if none found.
     */
    export function select(selector: string): HTMLElement {
        return document.querySelector(selector) as HTMLElement;
    }

    /**
     * Returns the current browser viewport dimensions.
     *
     * @returns An object with `width` and `height` properties representing the viewport size in pixels.
     */
    export function getViewportSize(): Size {
        var width = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
        var height = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);

        return {
            width: width,
            height: height
        };
    }

    /**
     * Measures and caches the native scrollbar width by temporarily inserting a div pair.
     *
     * @returns The scrollbar width in pixels.
     *
     * @remarks Appends two nested divs to `document.body`, measures the inner width
     * with and without overflow, then immediately removes them. The result is stored
     * in the module-level `scrollBarWidth` variable for use by `getScrollBarWidth`.
     */
    export function calculateScrollBarWidth() {
        var scr = null;
        var inn = null;
        var wNoScroll = 0;
        var wScroll = 0;

        // Outer scrolling div
        scr = document.createElement('div');
        scr.style.position = 'absolute';
        scr.style.top = '-1000px';
        scr.style.left = '-1000px';
        scr.style.width = '100px';
        scr.style.height = '50px';

        // Start with no scrollbar
        scr.style.overflow = 'hidden';

        // Inner content div
        inn = document.createElement('div');
        inn.style.width = '100%';
        inn.style.height = '200px';

        // Put the inner div in the scrolling div
        scr.appendChild(inn);

        // Append the scrolling div to the doc
        document.body.appendChild(scr);

        // Width of the inner div sans scrollbar
        wNoScroll = inn.offsetWidth;

        // Add the scrollbar
        scr.style.overflow = 'auto';

        // Width of the inner div width scrollbar
        wScroll = inn.offsetWidth;

        // Remove the scrolling div from the doc
        document.body.removeChild(<Node>document.body.lastChild);

        // Pixel width of the scroller
        scrollBarWidth = (wNoScroll - wScroll);

        return scrollBarWidth;
    }

    /**
     * Returns the cached scrollbar width, calculating it on first call.
     *
     * @returns The scrollbar width in pixels.
     */
    export function getScrollBarWidth() {
        if (scrollBarWidth < 0) {
            calculateScrollBarWidth();
        }

        return scrollBarWidth;
    }
}
