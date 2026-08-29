// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Size } from "~/primitive/Size.js";
import type { Insets } from "~/primitive/Insets.js";
import { DOM } from "~/core/DOM.js";

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
 * One string to measure, with the font properties to measure it under.
 */
export interface TextMeasureRequest {
    text: string;
    options?: TextMeasureOptions;
}

/**
 * General-purpose utility functions for DOM interaction and browser environment queries.
 *
 * @category Util
 */
export namespace Util {

    // Cached text-metric results, invalidated together on theme change via
    // `invalidateTextMetricsCache`. `-1` is the "not yet measured" sentinel
    // (a real padding / font size / baseline / offset is always >= 0).
    let linePaddingCache: number = -1;
    let rootFontSizeCache: number = -1;
    let textBaselineCache: number = -1;
    let opticalOffsetCache: number = -1;

    // Generation counter bumped by `invalidateTextMetricsCache`, so a caller
    // (e.g. `Text.needsMeasure`) can tell whether its last measurement
    // predates the active theme without holding its own subscription.
    let metricsGeneration = 0;

    // Resolved bound-font-size results, keyed by `cssVar + "|" + cssRule`, so
    // every `Text` bound to the same CSS var/rule pair shares one resolution
    // per theme change instead of each instance re-probing the cascade.
    const boundFontSizeCache = new Map<string, number | null>();

    /**
     * Measures the rendered size of a text string using an off-screen probe `<span>`.
     *
     * @param text - The string to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns The measured `{width, height}` in pixels, ceiled to whole pixels.
     */
    export function measureTextSize(text: string, options: TextMeasureOptions = {}): Size {
        const metrics = DOM.source.measureText(text, options);

        return { width: metrics.width, height: metrics.height };
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
     * Measures many strings under one font in a single document reflow,
     * instead of one reflow per string.
     *
     * @param texts - The strings to measure.
     * @param options - Font properties to apply. Defaults to the active theme variables.
     * @returns One width per input, in input order.
     */
    export function measureTextWidths(texts: string[], options?: TextMeasureOptions): number[] {
        return DOM.source.measureTextWidths(texts, options);
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

        const raw    = DOM.source.getThemeVar("--ts-ui-line-padding");
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

        const raw    = DOM.source.getThemeVar("--ts-ui-font-size");
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

        const m   = DOM.source.measureFontMetrics();
        const gap = lineHeightPx() - (m.ascent + m.descent);

        textBaselineCache = Math.round(gap / 2 + m.ascent);

        return textBaselineCache;
    }

    /**
     * Returns the pixel height of a single-line input box: the theme line-box
     * height ({@link lineHeightPx}) plus the component's own vertical chrome
     * (insets + optional padding + border).
     *
     * @param insets - The component's layout insets (top/bottom read).
     * @param padding - The component's CSS padding, or `null` when it has none.
     * @param border - The component's border widths (top/bottom read).
     * @returns The single-line box height in pixels.
     *
     * @remarks Factors out the `chrome = insets + padding + border; h =
     * lineHeightPx() + chrome` idiom shared by every single-line native-input
     * box height (`TextField` / `PasswordField` / `ComboBox` / the picker fields
     * / `NumberSpinner`). Only the vertical (top/bottom) edges contribute; the
     * horizontal edges are the caller's width concern. `NumberSpinner` uniquely
     * passes its *inner input's* padding rather than its own.
     */
    export function singleLineBoxHeight(
        insets:  Insets,
        padding: Insets | null,
        border:  { top: number; bottom: number },
    ): number {
        const chrome = insets.getTop() + insets.getBottom()
                     + (padding ? padding.getTop() + padding.getBottom() : 0)
                     + border.top + border.bottom;

        return lineHeightPx() + chrome;
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

        const m      = DOM.source.measureFontMetrics();
        const boxMid = (m.ascent - m.descent) / 2;
        const inkMid = m.capTop / 2;

        opticalOffsetCache = Math.max(0, Math.round(boxMid - inkMid));

        return opticalOffsetCache;
    }

    /**
     * Returns the generation counter for the cached text metrics, bumped once
     * every time {@link invalidateTextMetricsCache} runs.
     *
     * @returns The current generation number.
     *
     * @remarks Lets a caller that measured against a past generation (stashed
     * from a prior read of this function) tell, cheaply and without holding
     * its own theme subscription, whether a re-measure is due — the pattern
     * `Text` uses instead of subscribing to `ThemeManager` per instance.
     */
    export function textMetricsGeneration(): number {
        return metricsGeneration;
    }

    /**
     * Resolves a CSS custom property bound to a control's font size to a
     * pixel number, caching the result per `cssVar`/`cssRule` pair so every
     * control bound to the same token shares one resolution per theme change.
     *
     * @param cssVar - The CSS custom property name (e.g. `"--ts-ui-font-size"`).
     * @param cssRule - The CSS value the control's `font-size` rule is set to
     *   (e.g. `"var(--ts-ui-font-size, 14px)"`), used as the fallback probe
     *   when `cssVar`'s raw value isn't a bare, parseable pixel number (a
     *   `calc(...)`-valued relative token). Pass `null` when the control has
     *   no rule text of its own; the probe then falls back to `var(${cssVar})`.
     * @returns The resolved pixel size.
     *
     * @remarks Mirrors the theme-var-then-probe strategy every other cached
     * metric in this namespace uses: a simple var parses straight off its raw
     * string; a `calc(...)`-valued token falls back to
     * {@link DOMSource.resolveFontSizePx}, a cascade-evaluating probe. Cleared
     * together with the rest of the text metrics by
     * {@link invalidateTextMetricsCache}.
     */
    export function boundFontSizePx(cssVar: string, cssRule: string | null): number | null {
        const key    = cssVar + "|" + (cssRule ?? "");
        const cached = boundFontSizeCache.get(key);

        if (cached !== undefined) {
            return cached;
        }

        const raw      = parseFloat(DOM.source.getThemeVar(cssVar));
        const resolved = isNaN(raw)
            ? DOM.source.resolveFontSizePx(cssRule ?? `var(${cssVar})`)
            : raw;

        boundFontSizeCache.set(key, resolved);

        return resolved;
    }

    /**
     * Discards every cached text metric (line box, baseline, optical offset,
     * bound font sizes) so the next read re-measures against the active theme
     * font.
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
        boundFontSizeCache.clear();
        metricsGeneration++;
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
     * Clamps a number into an inclusive `[min, max]` range.
     *
     * @param value - The number to clamp.
     * @param min - The lower bound.
     * @param max - The upper bound.
     *
     * @returns `value` when it lies within the range, otherwise the nearer bound.
     *
     * @remarks Assumes `min <= max` (the framework's `min <= preferred <= max`
     * size invariant). When `min > max` the maximum wins (`clamp(v, 10, 0) === 0`)
     * — the low-first `Math.min(Math.max(...))` tie-break; callers must not rely
     * on it. `NaN` propagates (a `NaN` input returns `NaN`), matching the inlined
     * `Math.min`/`Math.max` expressions this replaces.
     */
    export function clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Builds the inclusive integer range `[a, b]` as an array.
     *
     * @param a - The range's lower bound, inclusive.
     * @param b - The range's upper bound, inclusive.
     *
     * @returns The array `[a, a + 1, ..., b]`.
     *
     * @remarks Returns an empty array when `b < a`, rather than propagating a
     * negative length into `Array.from`.
     */
    export function range(a: number, b: number): number[] {
        return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
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

}
