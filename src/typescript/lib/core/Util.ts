// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Size } from "~/primitive/Size.js";
import { InlineStyle } from "~/core/StyleTarget.js";

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
    lineHeight?: string
}

/**
 * Result of an off-screen text measurement that also reports the typographic baseline.
 *
 * @remarks `baseline` is the offset from the top of the measured box to the font baseline,
 * in pixels — analogous to CSS `vertical-align: baseline` on an inline-block element.
 */
export interface TextMetrics {
    width: number;
    height: number;
    baseline: number;
}

/**
 * General-purpose utility functions for DOM interaction and browser environment queries.
 *
 * @category Util
 */
export namespace Util {

    let scrollBarWidth: number = -1;
    let inputBaseline: number = -1;
    let labelBaseline: number = -1;

    /**
     * Measures the rendered size of a text string using an off-screen probe `<span>`.
     *
     * @param text - The string to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns The measured `{width, height}` in pixels, ceiled to whole pixels.
     */
    export function measureTextSize(text: string, options: TextMeasureOptions = {}): Size {
        const metrics = measureTextMetrics(text, options);

        return { width: metrics.width, height: metrics.height };
    }

    /**
     * Measures the rendered width, height, and baseline of a text string using an
     * off-screen probe `<span>`.
     *
     * @param text - The string to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns The measured metrics: `width`, `height`, and `baseline` (offset from
     * the top of the box to the typographic baseline) in pixels.
     *
     * @remarks A second 0×0 inline-block reference span is placed inside the probe
     * with `vertical-align: baseline`. The reference span's top equals the probe's
     * baseline, so `baseline = referenceTop - probeTop`.
     */
    export function measureTextMetrics(text: string, options: TextMeasureOptions = {}): TextMetrics {
        const {
            fontFamily  = "var(--ts-ui-font-family, system-ui, sans-serif)",
            fontSize    = "var(--ts-ui-font-size, 14px)",
            fontWeight  = "normal",
            fontStyle   = "normal",
            fontVariant = "normal",
            fontStretch = "normal",
            lineHeight  = "50px",
        } = options;

        const probe    = document.createElement("span");
        const probeBuf = new InlineStyle();

        probeBuf.attach(probe);
        probeBuf.setMany({
            position:    "fixed",
            visibility:  "hidden",
            whiteSpace:  "nowrap",
            fontFamily:  fontFamily,
            fontSize:    fontSize,
            fontWeight:  fontWeight,
            fontStyle:   fontStyle,
            fontVariant: fontVariant,
            fontStretch: fontStretch,
            lineHeight:  lineHeight,
        });

        probe.textContent = text;

        const ref    = document.createElement("span");
        const refBuf = new InlineStyle();

        refBuf.attach(ref);
        refBuf.setMany({
            display:       "inline-block",
            width:         "0",
            height:        "0",
            verticalAlign: "baseline",
        });

        probe.appendChild(ref);

        document.body.appendChild(probe);

        const probeRect = probe.getBoundingClientRect();
        const refRect   = ref.getBoundingClientRect();

        document.body.removeChild(probe);

        return {
            width:    Math.ceil(probeRect.width),
            height:   Math.ceil(probeRect.height),
            baseline: Math.round(refRect.top - probeRect.top),
        };
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
     * Measures the offset from the top of a native `<input>` element to its inner-text baseline.
     *
     * @returns The baseline offset in pixels, rounded to the nearest integer.
     *
     * @remarks Reads the UA-applied `border-top` and `padding-top` from a probe
     * `<input>` rendered at the active theme font, then adds the text baseline of
     * the same font measured by `measureTextMetrics`. This avoids relying on
     * `vertical-align: baseline` against an `<input>`, which browsers
     * inconsistently resolve to either the inner-text baseline or the element's
     * bottom edge. The result is cached after the first measurement; call
     * `invalidateInputBaselineCache` after a theme change to force re-measurement.
     */
    export function measureInputBaseline(): number {
        if (inputBaseline >= 0) {
            return inputBaseline;
        }

        return remeasureInputBaseline();
    }

    /**
     * Discards the cached `<input>` baseline measurement so the next call to
     * `measureInputBaseline` re-probes the DOM.
     *
     * @remarks Call this whenever the active theme's font size or family changes,
     * since the cached value reflects the font in use at the time of the first
     * measurement and would otherwise mis-align inputs against text after a theme swap.
     */
    export function invalidateInputBaselineCache(): void {
        inputBaseline = -1;
    }

    /**
     * Measures the offset from the top of a bare text-bearing element (`<span>`,
     * `<label>`) to its inner-text baseline at the active theme font.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks Mirrors `measureInputBaseline` but skips the `<input>` UA chrome
     * probe — labels have no UA border or padding, so the baseline collapses to
     * the typographic baseline reported by `measureTextMetrics`. Used by
     * components that render a label (e.g. ComboBox) rather than a native input.
     * The result is cached after the first measurement; call
     * `invalidateLabelBaselineCache` after a theme change to force re-measurement.
     */
    export function measureLabelBaseline(): number {
        if (labelBaseline >= 0) {
            return labelBaseline;
        }

        labelBaseline = measureTextMetrics("X", {
            fontFamily: "var(--ts-ui-font-family, sans-serif)",
            fontSize  : "var(--ts-ui-font-size, 14px)",
            lineHeight: "var(--ts-ui-line-height, 1.2)",
        }).baseline;

        return labelBaseline;
    }

    /**
     * Discards the cached label baseline measurement so the next call to
     * `measureLabelBaseline` re-measures against the active theme font.
     *
     * @remarks Call this whenever the active theme's font size or family changes,
     * since the cached value reflects the font in use at the time of the first
     * measurement and would otherwise mis-align labels against text after a theme swap.
     */
    export function invalidateLabelBaselineCache(): void {
        labelBaseline = -1;
    }

    /**
     * Performs the off-screen probe and updates the cached input baseline.
     *
     * @returns The measured baseline offset in pixels.
     */
    function remeasureInputBaseline(): number {
        const probe = document.createElement("input");
        probe.style.position   = "fixed";
        probe.style.visibility = "hidden";
        probe.style.fontFamily = "var(--ts-ui-font-family, sans-serif)";
        probe.style.fontSize   = "var(--ts-ui-font-size, 14px)";

        document.body.appendChild(probe);

        const computed   = getComputedStyle(probe);
        const borderTop  = parseFloat(computed.borderTopWidth) || 0;
        const paddingTop = parseFloat(computed.paddingTop)     || 0;

        document.body.removeChild(probe);

        const textMetrics = measureTextMetrics("X", {
            fontFamily: "var(--ts-ui-font-family, sans-serif)",
            fontSize  : "var(--ts-ui-font-size, 14px)",
            lineHeight: "var(--ts-ui-line-height, 1.2)",
        });

        inputBaseline = borderTop + paddingTop + textMetrics.baseline;

        return inputBaseline;
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
     * Converts a hyphen-separated identifier (e.g. `"border-top-width"`) to its
     * camelCase equivalent (`"borderTopWidth"`). Useful for translating
     * CSS-style kebab-case property names into the camelCase form expected by
     * `CSSStyleDeclaration` bracket-indexed assignment.
     *
     * @param value - The kebab-case input string.
     * @returns The camelCase equivalent.
     */
    export function kebabToCamel(value: string): string {
        return value.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
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
