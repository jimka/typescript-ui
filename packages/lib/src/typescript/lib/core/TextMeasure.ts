// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Internal layer that measures single-line text without a document layout.
// Every DOM measurement probe (`DOMSource.measureText` / `measureTexts` /
// `measureTextWidths`) appends a hidden element and reads its rectangle, which
// forces a layout of the whole document — on a keystroke, a re-layout of the
// editor the keystroke just invalidated. This module measures a single line on
// a canvas instead, under the font the probe would have resolved, and keeps the
// probe for everything the canvas cannot reproduce: a wrap width, whitespace
// the probe collapses, a font or `<body>` typography the canvas shorthand
// cannot express, and a font whose canvas width has not matched the probe's.
// Results are memoised until the next `Util.invalidateTextMetricsCache()`.
//
// It composes seam reads and never touches the DOM itself, so every routing,
// calibration and cache rule runs offline against the modelled source. Not
// exported from `core/index.ts` — mirrors `core/BorderWidths.ts`, the same
// shape (a module-level cache over a seam read, cleared by the theme path and
// the test harness). See plans/implemented/text-measurement-without-reflow.md.

import { DOM } from "~/core/DOM.js";
import type { ComputedFont, TextAdvanceSpacing } from "~/core/DOM.js";
import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from "~/core/Util.js";

/**
 * A fixed Latin line dense in kerning pairs, measured on both the probe and
 * the canvas to calibrate a font. `AVAWAY To Ty Yo` is repeated four times
 * because one copy separates the two spacing modes by only 0.43–0.95 px in
 * Manrope at 11–24 px (both round to the same pixel at 14 px); four copies put
 * them more than 1 px apart at every size, so the modes round apart.
 */
export const CALIBRATION_TEXT = "AVAWAY To Ty Yo. P. LT, (1,047.29) ffi AVAWAY To Ty Yo. P. LT, (1,047.29) ffi AVAWAY To Ty Yo AVAWAY To Ty Yo";

// The memo's capacity. The largest per-pass working set the W3.0 sweep
// measured is 48 strings (a 50-chart dashboard pass); a tree window is about
// 100 rows, a menu or combo box a few dozen labels. 1,024 holds several
// screens of that with an order of magnitude to spare, and at the text-length
// cap below a full memo stays under 1 MB.
const MEMO_MAX_ENTRIES = 1024;

// The longest text the memo keeps. Labels, tick texts and status lines are far
// shorter; the texts above it are tooltip and dialog bodies, measured once per
// show, and memoising them would crowd out the working set.
const MEMO_MAX_TEXT_LENGTH = 256;

// The font-level caches' capacity. Distinct font option bags per generation
// number in the tens; the cap only guards an app that animates a font size and
// would otherwise grow the caches until the next theme change. All three are
// cleared together, so a spacing mode or line box never outlives the computed
// font it came from — except the entries a batch that crosses the cap adds for
// its own fonts after the clear, which are keyed by shorthand and so stay
// correct until the next clear drops them.
const FONT_CACHE_MAX_ENTRIES = 256;

// Joins the fields of a cache key. U+0000 appears in no CSS value and in no
// label text a caller measures.
const KEY_SEPARATOR = "\u0000";

// A text the canvas measures as the probe does: no tab, line feed, form feed
// or carriage return, no leading or trailing space, no run of spaces. The
// probe lays text out under `white-space: nowrap`, which collapses whitespace;
// the canvas never collapses runs or trims ends.
const PROBE_COLLAPSED_WHITESPACE = /[\t\n\f\r]|^ | $| {2}/;

// A computed `font-weight` or length the canvas shorthand accepts.
const PLAIN_NUMBER = /^\d+(?:\.\d+)?$/;
const PX_LENGTH    = /^\d+(?:\.\d+)?px$/;

// Computed `font-style` and `font-variant-caps` values the canvas shorthand accepts.
const CANVAS_STYLES: ReadonlySet<string> = new Set(["normal", "italic", "oblique"]);
const CANVAS_CAPS:   ReadonlySet<string> = new Set(["normal", "small-caps"]);

// Computed `font-stretch` is a percentage, which the canvas shorthand rejects;
// these are the nine percentages CSS Fonts defines a keyword for.
const STRETCH_KEYWORDS: ReadonlyMap<string, string> = new Map([
    ["50%",    "ultra-condensed"],
    ["62.5%",  "extra-condensed"],
    ["75%",    "condensed"],
    ["87.5%",  "semi-condensed"],
    ["100%",   "normal"],
    ["112.5%", "semi-expanded"],
    ["125%",   "expanded"],
    ["150%",   "extra-expanded"],
    ["200%",   "ultra-expanded"],
]);
const STRETCH_KEYWORD_NAMES: ReadonlySet<string> = new Set(STRETCH_KEYWORDS.values());

// The typography the probe inherits from `<body>` and the canvas does not,
// each with the values under which the two agree. The library sets none of
// them, so only app CSS trips the gate. `fontKerning` takes both DOM defaults
// because the canvas is set to `normal`, which both behave as.
const CONTEXT_COMPATIBLE: ReadonlyArray<readonly [keyof ComputedFont, ReadonlySet<string>]> = [
    ["letterSpacing",         new Set(["normal", "0px"])],
    ["wordSpacing",           new Set(["0px", "normal"])],
    ["textTransform",         new Set(["none"])],
    ["fontFeatureSettings",   new Set(["normal"])],
    ["fontVariationSettings", new Set(["normal"])],
    ["fontKerning",           new Set(["auto", "normal"])],
    ["fontVariantLigatures",  new Set(["normal"])],
    ["fontVariantNumeric",    new Set(["normal"])],
    ["fontVariantEastAsian",  new Set(["normal"])],
    ["fontSizeAdjust",        new Set(["none"])],
    ["textRendering",         new Set(["auto"])],
];

/**
 * A font the canvas can measure: its CSS `font` shorthand, and its line key —
 * the shorthand and the computed line height — or `null` when its height and
 * baseline stay on the probe.
 */
export interface CanvasFont {
    shorthand: string;
    lineKey:   string | null;
}

/** A line box: the height and baseline every single line of one font measures at. */
interface LineBox {
    height:   number;
    baseline: number;
}

/** A font whose calibration rides the next probe call. */
interface Calibration {
    font:    CanvasFont;
    /** The options of the request that needed the font, which the calibration probe measures under. */
    options: TextMeasureOptions;
    /** The calibration text's `"run"` advance, measured before the probe. */
    run:     number;
}

/** A request that goes to the probe, and where its result goes. */
interface ProbeEntry {
    /** Its position in the caller's request list. */
    index:   number;
    request: TextMeasureRequest;
    /** Its memo key. */
    key:     string;
    /** Its canvas font when it is canvas-eligible, whose line box its result teaches. */
    font:    CanvasFont | null;
}

/** What one batch still needs from the probe. */
interface ProbePlan {
    entries:      ProbeEntry[];
    /** Shorthand → the calibration queued for that font in this batch. */
    calibrations: Map<string, Calibration>;
}

// Font key → the font's canvas form; `null`: the font stays on the probe.
const _fonts: Map<string, CanvasFont | null> = new Map();

// Shorthand → spacing mode; `null`: the font stays on the probe; absent: not yet calibrated.
const _spacing: Map<string, TextAdvanceSpacing | null> = new Map();

// Line key → the line box its first probe measured.
const _lines: Map<string, LineBox> = new Map();

// Memo key → metrics, least recently used first.
const _memo: Map<string, TextMetrics> = new Map();

/**
 * Whether a text measures the same on the canvas as on the probe as far as
 * whitespace goes: it holds no tab, line feed, form feed or carriage return,
 * does not begin or end with a space, and has no two spaces in a row.
 *
 * @param text - The text to check.
 * @returns `true` when the canvas may measure it.
 */
export function isCanvasText(text: string): boolean {
    return !PROBE_COLLAPSED_WHITESPACE.test(text);
}

/**
 * Maps a computed `font-stretch` onto the keyword the canvas shorthand takes.
 *
 * @param stretch - The computed value: a percentage, or already a keyword.
 * @returns The keyword, or `null` for a percentage with no keyword.
 */
function canvasStretch(stretch: string): string | null {
    if (STRETCH_KEYWORD_NAMES.has(stretch)) {
        return stretch;
    }

    return STRETCH_KEYWORDS.get(stretch) ?? null;
}

/**
 * Whether every inherited typography property reads a value under which the
 * canvas and the probe agree. An empty value counts as compatible: the engine
 * does not implement that property.
 *
 * @param computed - The computed font.
 * @returns `true` when the typography context is the canvas's own.
 */
function inCanvasContext(computed: ComputedFont): boolean {
    return CONTEXT_COMPATIBLE.every(([field, compatible]) => computed[field] === "" || compatible.has(computed[field]));
}

/**
 * Turns a computed font into a canvas `font` shorthand, `style caps weight
 * stretch size family`, when the canvas can express it and the inherited
 * typography context is the canvas's own.
 *
 * @param computed - The computed font, as the probe resolves it.
 * @returns The canvas font, or `null` when the font stays on the probe.
 */
export function canvasFontFrom(computed: ComputedFont): CanvasFont | null {
    const stretch = canvasStretch(computed.fontStretch);

    const expressible = CANVAS_STYLES.has(computed.fontStyle)
        && CANVAS_CAPS.has(computed.fontVariantCaps)
        && PLAIN_NUMBER.test(computed.fontWeight)
        && stretch !== null
        && PX_LENGTH.test(computed.fontSize)
        && computed.fontFamily !== ""
        && !computed.fontFamily.includes("var(");

    if (!expressible || !inCanvasContext(computed)) {
        return null;
    }

    const shorthand = `${computed.fontStyle} ${computed.fontVariantCaps} ${computed.fontWeight} ${stretch} ${computed.fontSize} ${computed.fontFamily}`;

    // At `normal` a fallback face could enlarge the line box in some engine,
    // so that font's height and baseline stay on the probe.
    const lineKey = computed.lineHeight === "" || computed.lineHeight === "normal"
        ? null
        : `${shorthand}|${computed.lineHeight}`;

    return { shorthand, lineKey };
}

/**
 * Picks a font's spacing mode from its calibration: the mode whose rounded-up
 * advance equals the probe's width, `"words"` on a tie.
 *
 * @param probeWidth - The probe's width of {@link CALIBRATION_TEXT}.
 * @param run - The canvas's `"run"` advance of it, or `null`.
 * @param words - The canvas's `"words"` advance of it, or `null`.
 * @returns The spacing mode, or `null` when neither matches and the font
 *   stays on the probe.
 *
 * @remarks A tie goes to `"words"` because per-word widths were only ever
 * wider than the probe, never narrower, and a label measured too wide is never
 * ellipsised.
 */
export function decideSpacing(probeWidth: number, run: number | null, words: number | null): TextAdvanceSpacing | null {
    if (words !== null && Math.ceil(words) === probeWidth) {
        return "words";
    }

    if (run !== null && Math.ceil(run) === probeWidth) {
        return "run";
    }

    return null;
}

/**
 * The key of a font option bag: its seven font fields, unset as empty.
 *
 * @param options - The font options.
 * @returns The key.
 */
function fontKey(options: TextMeasureOptions): string {
    return [
        options.fontFamily,
        options.fontSize,
        options.fontWeight,
        options.fontStyle,
        options.fontVariant,
        options.fontStretch,
        options.lineHeight,
    ].map(field => field ?? "").join(KEY_SEPARATOR);
}

/**
 * The memo key of a measurement: its text, its font key and its wrap width.
 *
 * @param text - The text.
 * @param options - The measurement options.
 * @returns The key.
 */
function memoKey(text: string, options: TextMeasureOptions): string {
    return [text, fontKey(options), options.maxWidth === undefined ? "" : String(options.maxWidth)].join(KEY_SEPARATOR);
}

/**
 * Resolves an option bag to its canvas font, reading the computed style once
 * per bag per generation.
 *
 * @param options - The font options.
 * @returns The canvas font, or `null` when the font stays on the probe.
 */
function canvasFontFor(options: TextMeasureOptions): CanvasFont | null {
    const key   = fontKey(options);
    const known = _fonts.get(key);

    if (known !== undefined) {
        return known;
    }

    if (_fonts.size >= FONT_CACHE_MAX_ENTRIES) {
        _fonts.clear();
        _spacing.clear();
        _lines.clear();
    }

    const font = canvasFontFrom(DOM.source.getComputedFont(options));

    _fonts.set(key, font);

    return font;
}

/**
 * Measures a text's advance on the canvas under its font's decided spacing
 * mode. A canvas that turns out unable to measure the font marks it probe-only.
 *
 * @param text - A canvas-eligible text.
 * @param font - Its canvas font.
 * @returns The unrounded advance, or `null` when the font is uncalibrated,
 *   probe-only, or unmeasurable.
 */
function advanceOnCanvas(text: string, font: CanvasFont): number | null {
    const spacing = _spacing.get(font.shorthand);

    if (!spacing) {
        return null;
    }

    const advance = DOM.source.measureTextAdvance(text, font.shorthand, spacing);

    if (advance === null) {
        _spacing.set(font.shorthand, null);
    }

    return advance;
}

/**
 * Measures a text on the canvas: its width from the canvas, rounded up as the
 * probe rounds, and its height and baseline from its font's line box.
 *
 * @param text - A canvas-eligible text.
 * @param font - Its canvas font.
 * @returns The metrics, or `null` when the font is uncalibrated, probe-only or
 *   unmeasurable, or its line box is not yet known.
 */
function canvasMetrics(text: string, font: CanvasFont): TextMetrics | null {
    const line = font.lineKey === null ? undefined : _lines.get(font.lineKey);

    if (line === undefined) {
        return null;
    }

    const advance = advanceOnCanvas(text, font);

    if (advance === null) {
        return null;
    }

    return { width: Math.ceil(advance), height: line.height, baseline: line.baseline };
}

/**
 * Starts calibrating a font: measures the calibration text's `"run"` advance,
 * which the probe's width of the same text is later compared against. A font
 * the canvas cannot measure is marked probe-only instead, with nothing to
 * calibrate.
 *
 * @param font - The uncalibrated canvas font.
 * @param options - The options the calibration probe measures under.
 * @returns The calibration to finish after the probe, or `null`.
 */
function beginCalibration(font: CanvasFont, options: TextMeasureOptions): Calibration | null {
    const run = DOM.source.measureTextAdvance(CALIBRATION_TEXT, font.shorthand, "run");

    if (run === null) {
        _spacing.set(font.shorthand, null);

        return null;
    }

    return { font, options, run };
}

/**
 * Finishes a calibration from the probe's width of the calibration text,
 * deciding the font's spacing mode.
 *
 * @param calibration - The calibration begun before the probe.
 * @param probeWidth - The probe's width of {@link CALIBRATION_TEXT}.
 */
function finishCalibration(calibration: Calibration, probeWidth: number): void {
    const words = DOM.source.measureTextAdvance(CALIBRATION_TEXT, calibration.font.shorthand, "words");

    _spacing.set(calibration.font.shorthand, decideSpacing(probeWidth, calibration.run, words));
}

/**
 * Returns a memoised measurement, moving it to the most recently used end.
 *
 * @param key - The memo key.
 * @returns The metrics, or `undefined` on a miss.
 */
function recall(key: string): TextMetrics | undefined {
    const hit = _memo.get(key);

    if (hit !== undefined) {
        _memo.delete(key);
        _memo.set(key, hit);
    }

    return hit;
}

/**
 * Memoises a measurement unless its text is too long, evicting the least
 * recently used entry past the capacity.
 *
 * @param key - The memo key.
 * @param text - The measured text.
 * @param metrics - Its metrics.
 * @returns `metrics`.
 */
function remember(key: string, text: string, metrics: TextMetrics): TextMetrics {
    if (text.length <= MEMO_MAX_TEXT_LENGTH) {
        _memo.set(key, metrics);

        if (_memo.size > MEMO_MAX_ENTRIES) {
            _memo.delete(_memo.keys().next().value!);
        }
    }

    return metrics;
}

/**
 * Answers a request from the memo or the canvas. A request neither can answer
 * is added to the batch's probe plan, with its font's calibration when the
 * font has none yet.
 *
 * @param request - The request.
 * @param index - Its position in the caller's list.
 * @param plan - The batch's probe plan.
 * @returns The metrics, or `null` when the request goes to the probe.
 */
function measureWithoutProbe(request: TextMeasureRequest, index: number, plan: ProbePlan): TextMetrics | null {
    const options = request.options ?? {};
    const key     = memoKey(request.text, options);
    const hit     = recall(key);

    if (hit !== undefined) {
        return hit;
    }

    const eligible = options.maxWidth === undefined && isCanvasText(request.text);
    const font     = eligible ? canvasFontFor(options) : null;

    if (font !== null && !_spacing.has(font.shorthand)) {
        queueCalibration(font, options, plan.calibrations);
    }

    const measured = font === null ? null : canvasMetrics(request.text, font);

    if (measured !== null) {
        return remember(key, request.text, measured);
    }

    plan.entries.push({ index, request, key, font });

    return null;
}

/**
 * Queues a font's calibration into the batch, once per font.
 *
 * @param font - The uncalibrated canvas font.
 * @param options - The options of the request that needs it.
 * @param calibrations - The batch's queued calibrations.
 */
function queueCalibration(font: CanvasFont, options: TextMeasureOptions, calibrations: Map<string, Calibration>): void {
    if (calibrations.has(font.shorthand)) {
        return;
    }

    const calibration = beginCalibration(font, options);

    if (calibration !== null) {
        calibrations.set(font.shorthand, calibration);
    }
}

/**
 * Sends a batch's probe-bound requests and calibrations to the probe in one
 * call: a lone request with no calibration through `measureText`, anything
 * else through one `measureTexts`, calibrations last.
 *
 * @param plan - The batch's probe plan, with at least one entry.
 * @returns One result per entry, then one per calibration, in plan order.
 */
function probe(plan: ProbePlan): TextMetrics[] {
    const { entries, calibrations } = plan;

    if (entries.length === 1 && calibrations.size === 0) {
        return [DOM.source.measureText(entries[0].request.text, entries[0].request.options)];
    }

    return DOM.source.measureTexts([
        ...entries.map(entry => entry.request),
        ...[...calibrations.values()].map(calibration => ({ text: CALIBRATION_TEXT, options: calibration.options })),
    ]);
}

/**
 * Runs a batch's probe, if it needs one, and folds its results in: each
 * request's metrics are memoised and teach its font's line box, and each
 * calibration decides its font's spacing mode.
 *
 * @param plan - The batch's probe plan.
 * @param results - The batch's results, filled in at each entry's index.
 */
function runProbe(plan: ProbePlan, results: TextMetrics[]): void {
    const { entries, calibrations } = plan;

    if (entries.length === 0) {
        return;
    }

    const metrics = probe(plan);

    entries.forEach((entry, i) => {
        const lineKey = entry.font?.lineKey ?? null;

        if (lineKey !== null && !_lines.has(lineKey)) {
            _lines.set(lineKey, { height: metrics[i].height, baseline: metrics[i].baseline });
        }

        results[entry.index] = remember(entry.key, entry.request.text, metrics[i]);
    });

    [...calibrations.values()].forEach((calibration, j) => finishCalibration(calibration, metrics[entries.length + j].width));
}

/**
 * Measures many single texts, each under its own font, forcing at most one
 * document layout: memo hits and canvas measurements cost none, and every
 * request left for the probe shares one probe call.
 *
 * @param requests - The texts to measure, each with its font options.
 * @returns One result per request, in request order; `[]` for `[]`, with no
 *   seam read.
 *
 * @remarks Every result is served from the memo on a repeat, as the same
 * object; callers only read it and must never mutate it.
 */
export function measureManyTextMetrics(requests: TextMeasureRequest[]): TextMetrics[] {
    const results: TextMetrics[] = new Array(requests.length);
    const plan: ProbePlan        = { entries: [], calibrations: new Map() };

    requests.forEach((request, index) => {
        const measured = measureWithoutProbe(request, index, plan);

        if (measured !== null) {
            results[index] = measured;
        }
    });

    runProbe(plan, results);

    return results;
}

/**
 * Measures one text's size and baseline, without a document layout when the
 * memo or the canvas can answer.
 *
 * @param text - The text to measure.
 * @param options - Font options; unset ones take the probe's theme defaults.
 *   A `maxWidth` measures the wrapped height, always on the probe.
 * @returns The metrics.
 *
 * @remarks A repeat is served from the memo as the same object; callers only
 * read it and must never mutate it.
 */
export function measureTextMetrics(text: string, options?: TextMeasureOptions): TextMetrics {
    return measureManyTextMetrics([{ text, options }])[0];
}

/**
 * Measures the widths of many texts under one font. Canvas-eligible texts in a
 * calibrated font cost no layout; the rest share one widths-probe call, which
 * also carries the font's calibration when it has none yet.
 *
 * @param texts - The texts to measure.
 * @param options - Font options; unset ones take the probe's theme defaults.
 * @returns One width per text, in input order; `[]` for `[]`, with no seam read.
 *
 * @remarks Not memoised: it serves table autosizing, where strings rarely repeat.
 */
export function measureManyTextWidths(texts: string[], options?: TextMeasureOptions): number[] {
    if (texts.length === 0) {
        return [];
    }

    const font        = canvasFontFor(options ?? {});
    const calibration = font !== null && !_spacing.has(font.shorthand) ? beginCalibration(font, options ?? {}) : null;
    const widths      = new Array<number>(texts.length);
    const rest: number[] = [];

    texts.forEach((text, index) => {
        const advance = font !== null && isCanvasText(text) ? advanceOnCanvas(text, font) : null;

        if (advance === null) {
            rest.push(index);
        } else {
            widths[index] = Math.ceil(advance);
        }
    });

    probeWidths(texts, rest, options, calibration, widths);

    return widths;
}

/**
 * Measures the texts the canvas did not, plus a pending calibration, in one
 * widths-probe call.
 *
 * @param texts - Every text of the call.
 * @param rest - The indices of the texts left for the probe.
 * @param options - The call's font options, passed to the probe as given.
 * @param calibration - The font's calibration to finish, or `null`.
 * @param widths - The call's widths, filled in at each index in `rest`.
 */
function probeWidths(
    texts:       string[],
    rest:        number[],
    options:     TextMeasureOptions | undefined,
    calibration: Calibration | null,
    widths:      number[],
): void {
    const probeTexts = rest.map(index => texts[index]);

    if (calibration !== null) {
        probeTexts.push(CALIBRATION_TEXT);
    }

    if (probeTexts.length === 0) {
        return;
    }

    const measured = DOM.source.measureTextWidths(probeTexts, options);

    rest.forEach((index, i) => {
        widths[index] = measured[i];
    });

    if (calibration !== null) {
        finishCalibration(calibration, measured[rest.length]);
    }
}

/** Drops every cache. Called by `Util.invalidateTextMetricsCache` and the test harness. @internal */
export function clearTextMeasureCache(): void {
    _fonts.clear();
    _spacing.clear();
    _lines.clear();
    _memo.clear();
}

/** Entry counts; for tests only. @internal */
export function _textMeasureCacheSizes(): { fonts: number; spacing: number; lines: number; memo: number } {
    return { fonts: _fonts.size, spacing: _spacing.size, lines: _lines.size, memo: _memo.size };
}
