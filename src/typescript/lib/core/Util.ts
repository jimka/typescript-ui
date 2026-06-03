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
    /**
     * When set, the probe wraps at this pixel width (using `pre-wrap`) instead of
     * measuring on a single `nowrap` line. The returned `height` then reflects the
     * wrapped, multi-line box. Omit to measure the natural single-line size.
     */
    maxWidth?: number;
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

    // Cached text-metric results, invalidated together on theme change via
    // `invalidateTextMetricsCache`. `-1` is the "not yet measured" sentinel
    // (a real padding / font size / baseline / offset is always >= 0).
    let linePaddingCache: number = -1;
    let rootFontSizeCache: number = -1;
    let textBaselineCache: number = -1;
    let opticalOffsetCache: number = -1;

    // Single off-screen canvas 2D context reused for every font-metric probe.
    // Lazily created so a non-DOM import of this module doesn't touch the DOM.
    let metricsCtx: CanvasRenderingContext2D | null = null;

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
            lineHeight  = "calc(1em + var(--ts-ui-line-padding, 2px))",
            maxWidth,
        } = options;

        const probe    = document.createElement("span");
        const probeBuf = new InlineStyle();

        probeBuf.attach(probe);
        probeBuf.setMany({
            position:    "fixed",
            visibility:  "hidden",
            // With a wrap width the probe must honour `\n` and soft-wrap so the
            // measured height covers every visual line; otherwise stay on a
            // single `nowrap` line for the natural-size measurement.
            whiteSpace:  maxWidth === undefined ? "nowrap" : "pre-wrap",
            width:       maxWidth === undefined ? "" : `${maxWidth}px`,
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
     * Returns the active theme's leading (`--ts-ui-line-padding`) in pixels.
     *
     * @returns The integer-pixel value of `--ts-ui-line-padding`, or `4` as a
     * fallback when the variable is missing or unparseable.
     */
    function linePaddingPx(): number {
        if (linePaddingCache >= 0) {
            return linePaddingCache;
        }

        const raw    = getComputedStyle(document.documentElement)
                           .getPropertyValue("--ts-ui-line-padding")
                           .trim();
        const parsed = parseFloat(raw);

        // 2 mirrors the `--ts-ui-line-padding` default shipped by every theme
        // (see ModernTheme/DarkTheme/ClassicTheme `font.linePadding: '2px'`);
        // it only applies when the var is absent (e.g. pre-theme-apply probe).
        linePaddingCache = isNaN(parsed) ? 2 : parsed;

        return linePaddingCache;
    }

    /**
     * Returns the document root font size (`--ts-ui-font-size`) in pixels, the
     * default font size for a control that doesn't override it.
     *
     * @returns The integer-pixel root font size, or `14` as a fallback.
     */
    function rootFontSizePx(): number {
        if (rootFontSizeCache >= 0) {
            return rootFontSizeCache;
        }

        const raw    = getComputedStyle(document.documentElement)
                           .getPropertyValue("--ts-ui-font-size")
                           .trim();
        const parsed = parseFloat(raw);

        rootFontSizeCache = isNaN(parsed) ? 14 : parsed;

        return rootFontSizeCache;
    }

    /**
     * Returns a vertical text metric in integer pixels: a control's font size,
     * plus the theme leading (`--ts-ui-line-padding`) by default.
     *
     * @param options - Measurement options.
     * @param options.fontSizePx - The control's font size in pixels. Omit to use
     * the document root font size (`--ts-ui-font-size`), which is what the
     * native `<input>`-backed controls render at.
     * @param options.linePadding - Controls the leading added to the font size:
     * `true` (the default) adds the theme `--ts-ui-line-padding`, giving the
     * full rendered line box (matching the `calc(1em + …)` line-height controls
     * render at); `false` adds nothing, returning the bare font size to size a
     * box from its font without leading; a number adds that exact pixel padding.
     * @returns `round(fontSize + leading)`, where leading is the theme padding,
     * `0`, or the given number.
     *
     * @remarks With the default leading the line box scales with font size, so
     * 12px and 14px text get proportionate line boxes from the one token. Text
     * components, table rows, and the baseline computation use the default so
     * their measurement matches the rendered line box; the native input box
     * heights pass `false` so the box hugs the font size plus their own chrome.
     * The padding and root font size are cached; call
     * {@link invalidateTextMetricsCache} after a theme change to force a
     * re-read.
     */
    export function lineHeightPx(options: { fontSizePx?: number, linePadding?: boolean | number } = {}): number {
        let fs = options.fontSizePx ?? rootFontSizePx();

        const linePadding = options.linePadding ?? true;

        if (linePadding === true) {
            fs += linePaddingPx();
        } else if (typeof linePadding === "number") {
            fs += linePadding;
        }

        return Math.round(fs);
    }

    /**
     * Returns the content-relative text baseline for the unified line-height
     * model: the offset from the top of the `lineHeightPx()` line box to the
     * font baseline.
     *
     * @returns The baseline offset in pixels, rounded to the nearest integer.
     *
     * @remarks Computed from the canvas 2D `measureText` font metrics rather
     * than a DOM probe, so it is deterministic and UA-independent. A CSS line
     * box centres the font's ascent+descent within `line-height`; this
     * reproduces that centring with the known px line box —
     * `round(lineGap / 2 + ascent)` where `lineGap = lineHeightPx - (ascent +
     * descent)` — so the measured baseline matches where the browser paints the
     * glyph in both a native `<input>` and a `Text`/`Label`. `fontBoundingBox*`
     * (font-intrinsic, string-independent) is used in preference to
     * `actualBoundingBox*` (glyph-ink specific) so the baseline does not shift
     * per measured string; `"X"` is passed only to satisfy `measureText`. The
     * result is cached; call {@link invalidateTextMetricsCache} after a theme
     * change to force re-measurement.
     */
    export function measureTextBaseline(): number {
        if (textBaselineCache >= 0) {
            return textBaselineCache;
        }

        const m   = measureFontMetrics();
        const gap = lineHeightPx() - (m.ascent + m.descent);

        textBaselineCache = Math.round(gap / 2 + m.ascent);

        return textBaselineCache;
    }

    /**
     * Returns the downward pixel offset that moves a single line of text from
     * its line-box (geometric) centre to its optical (cap-height) centre.
     *
     * @returns The downward offset in pixels (`>= 0`), rounded to the nearest
     * integer.
     *
     * @remarks A label's visible glyphs occupy cap-top→baseline; the descender
     * band below the baseline is empty ink, so the ink's visual centre sits
     * above the font box's geometric centre and a geometrically-centred label
     * reads as too high. This returns roughly half the unused descender space —
     * `round(boxMid - inkMid)` where `boxMid = (ascent - descent) / 2` and
     * `inkMid = capTop / 2` with `capTop = actualBoundingBoxAscent` (the cap-top
     * ink of `"X"`) — so a consumer ([`Button`](/api/component/button/classes/Button))
     * can nudge single-line text down onto its true optical centre. Derived
     * from the same cached canvas
     * metrics as {@link measureTextBaseline}; cached and invalidated together
     * via {@link invalidateTextMetricsCache}.
     */
    export function opticalCenterOffset(): number {
        if (opticalOffsetCache >= 0) {
            return opticalOffsetCache;
        }

        const m      = measureFontMetrics();
        const boxMid = (m.ascent - m.descent) / 2;
        const inkMid = m.capTop / 2;

        opticalOffsetCache = Math.max(0, Math.round(boxMid - inkMid));

        return opticalOffsetCache;
    }

    /**
     * Discards every cached text metric (line box, baseline, optical offset) so
     * the next read re-measures against the active theme font.
     *
     * @remarks Call this whenever the active theme's font size, family, or
     * line-height changes, since the cached values reflect the font in use at
     * the time of the first measurement and would otherwise mis-align controls
     * against each other after a theme swap.
     */
    export function invalidateTextMetricsCache(): void {
        linePaddingCache   = -1;
        rootFontSizeCache  = -1;
        textBaselineCache  = -1;
        opticalOffsetCache = -1;
    }

    /**
     * Reads the active theme font's intrinsic ascent, descent, and cap-top from
     * a single canvas `measureText("X")` call.
     *
     * @returns `ascent`/`descent` (font-intrinsic box, from `fontBoundingBox*`)
     * and `capTop` (cap-height ink, from `actualBoundingBoxAscent`), all in
     * pixels.
     *
     * @remarks `ctx.font` does not accept `var(...)`, so the font shorthand is
     * built from the *computed* `--ts-ui-font-*` values read off the document
     * root, the same token resolution the line-box helpers use. Older engines
     * exposed only `actualBoundingBox*`; when `fontBoundingBoxAscent` is absent
     * the font box falls back to the `"X"` ink box, which is stable enough for
     * Latin text.
     */
    function measureFontMetrics(): { ascent: number; descent: number; capTop: number } {
        if (metricsCtx === null) {
            metricsCtx = document.createElement("canvas").getContext("2d");
        }

        const ctx  = metricsCtx as CanvasRenderingContext2D;
        const root = getComputedStyle(document.documentElement);

        // 14px / system-ui mirror the `--ts-ui-font-*` defaults shipped by the
        // themes; they only apply when the computed value is empty (pre-apply).
        const family = root.getPropertyValue("--ts-ui-font-family").trim() || "system-ui, sans-serif";
        const size   = root.getPropertyValue("--ts-ui-font-size").trim()   || "14px";

        ctx.font = `normal normal ${size} ${family}`;

        const m = ctx.measureText("X");

        const hasFontBox = typeof m.fontBoundingBoxAscent === "number";
        const ascent     = hasFontBox ? m.fontBoundingBoxAscent  : m.actualBoundingBoxAscent;
        const descent    = hasFontBox ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent;

        return { ascent, descent, capTop: m.actualBoundingBoxAscent };
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
