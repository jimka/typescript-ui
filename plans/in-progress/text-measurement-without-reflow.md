---
depends-on: [font-gated-body-init, w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Util.ts
  - packages/lib/src/typescript/lib/core/index.ts
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/tests/dom/TestDOM.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/qa/README.md
---

# Text Measurement Without Reflow — Implementation Plan

## Overview

Every text measurement in the library goes through a hidden DOM probe: `ProductionDOMSource.measureText`, `measureTexts` and `measureTextWidths` ([`core/DOM.ts:2241`](packages/lib/src/typescript/lib/core/DOM.ts#L2241), `:2295`, `:2341`) append a span to `<body>` and read its rectangle. Each read forces a document layout. On a keystroke that layout lands right after CodeMirror has invalidated the editor, so it re-lays out the whole editor. The W3.0 sweep measured the cost: a canvas-width ablation took every typing frame from 54–58 ms to 19–21 ms in `code-document` and both shells, and a measurement memo took `tree-nodes` key frames 93 → 82 ms and a 50-chart dashboard pass 23 → 11 ms, all at identical geometry ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#g18--text-measurement)).

This plan ships that change. A new framework-internal module, `core/TextMeasure.ts`, measures single-line text on a canvas under the font the probe would have used, and keeps the probe for everything the canvas cannot reproduce. It adds two primitive reads to the DOM seam (`getComputedFont`, `measureTextAdvance`), a bounded memo, and a once-per-font check of the canvas against the probe. Every library caller of the probe — `Text`, `Util`'s public measurement functions, `ChartAxis`, `Tooltip` — moves onto the new module. The offline test DOM models the two new reads, and the QA app gains a `text-metrics` panel whose geometry labels make canvas-versus-probe parity visible to the in-engine A/B.

---

## Architecture Decisions

### A layout-free measurement layer above the seam, mirroring `BorderWidths.ts`

The routing, caching and invalidation live in a new pure module, `core/TextMeasure.ts`, which composes seam reads and never touches the DOM. It follows [`core/BorderWidths.ts`](packages/lib/src/typescript/lib/core/BorderWidths.ts#L71): a framework-internal module, not exported from `core/index.ts`, holding a module-level cache over a seam read, with a clear function the theme path and the test harness call. `Util.measureTextBaseline` over `DOM.source.measureFontMetrics` ([`core/Util.ts:208`](packages/lib/src/typescript/lib/core/Util.ts#L208)) is the same shape for the canvas font metrics the library already reads.[^above-seam]

### Two primitive seam reads: `getComputedFont` and `measureTextAdvance`

`DOMSource` gains two members, both returning plain data:

- `getComputedFont(options)` resolves font options exactly as the probe does — on a span appended to `<body>` — and returns the computed values of the 18 typography properties that decide a text width, as strings.
- `measureTextAdvance(text, font, spacing)` returns the raw advance width of `text` on a canvas under a CSS `font` shorthand, or `null` when the engine has no 2D context or rejects the font.

Everything that decides with those values lives in `TextMeasure.ts`. This is the `getBorderWidths` precedent: the seam returns raw computed strings, and the module above parses them.[^two-reads]

### Which measurements use the canvas, and which stay on the probe

A measurement uses the canvas only when all of these hold. Anything else goes to the probe, as today. A **generation** here is the span between two calls of `Util.invalidateTextMetricsCache()` — that is, between theme changes and settled font batches.

1. It has no `maxWidth`. A wrap needs line breaking, which a canvas cannot do.
2. Its text passes the whitespace rule below.
3. Its font resolves to a canvas shorthand, and the inherited typography context is the canvas's own (next decision).
4. The font has passed its calibration against the probe in this generation (*Each canvas font is checked against the probe once per generation*, below).
5. For a measurement that returns height and baseline — every one except `measureManyTextWidths` — its line box is already known: one probe measurement of that font and line height has run in this generation.
6. `measureTextAdvance` returned a number.

**The whitespace rule.** The probe lays text out under `white-space: nowrap`, which collapses whitespace; the canvas does not. So a text uses the canvas only if it contains no tab, line feed, form feed or carriage return, does not begin or end with a space, and has no two spaces in a row.[^whitespace]

| Text | Canvas | Why |
|---|---|---|
| `Ln 12, Col 5` | yes | single interior spaces |
| `a` + U+00A0 + `b` | yes | a no-break space does not collapse |
| `` (empty) | yes | both measure 0 |
| ` Ready` | no | the probe drops the leading space |
| `Ready ` | no | the widths probe drops the trailing space |
| `a  b` | no | the probe collapses the run |
| `a` + tab + `b` | no | not a plain space |

### The canvas font comes from the probe's own computed style

`canvasFontFrom(computed)` turns a `ComputedFont` into a canvas `font` shorthand, `style caps weight stretch size family`, or `null` when the canvas cannot express it. Computed style resolves every `var()`, `calc()` and relative keyword the options carry, which the ablation's string substitution could not.[^computed-font]

| Computed | Shorthand |
|---|---|
| `normal`, `normal`, `400`, `100%`, `14px`, `"Manrope Variable", system-ui, sans-serif` | `normal normal 400 normal 14px "Manrope Variable", system-ui, sans-serif` |
| `italic`, `small-caps`, `700`, `75%`, `16px`, `serif` | `italic small-caps 700 condensed 16px serif` |
| stretch `80%` | `null`: no keyword |
| style `oblique 20deg` | `null` |
| caps `all-small-caps` | `null` |
| weight `bold` (never computed by an engine) | `null`: the weight must be numeric |

Each part is accepted as follows, and anything else gives `null`:

- **style**: `normal`, `italic` or `oblique`.
- **caps** (`fontVariantCaps`): `normal` or `small-caps`.
- **weight**: a plain number.
- **stretch**: a keyword, or one of the nine percentages the canvas shorthand cannot take, mapped to its keyword: `50%` ultra-condensed, `62.5%` extra-condensed, `75%` condensed, `87.5%` semi-condensed, `100%` normal, `112.5%` semi-expanded, `125%` expanded, `150%` extra-expanded, `200%` ultra-expanded.
- **size**: a `px` length.
- **family**: non-empty and free of `var(`.

**The context gate.** The probe inherits `<body>`'s typography; the canvas does not. `canvasFontFrom` returns `null` unless each context property reads one of its canvas-compatible values. An empty string counts as compatible: it means the engine does not implement the property.[^context-gate]

| Property | Compatible values |
|---|---|
| `letterSpacing` | `normal`, `0px` |
| `wordSpacing` | `0px`, `normal` |
| `textTransform` | `none` |
| `fontFeatureSettings`, `fontVariationSettings` | `normal` |
| `fontKerning` | `auto`, `normal` |
| `fontVariantLigatures`, `fontVariantNumeric`, `fontVariantEastAsian` | `normal` |
| `fontSizeAdjust` | `none` |
| `textRendering` | `auto` |

The result also carries the font's **line key**: the shorthand and the computed `lineHeight`, joined by `|`. A computed line height of `normal` (or empty) gives no line key, so the metrics of that font stay on the probe.

### Each canvas font is checked against the probe once per generation

Engines disagree about kerning across spaces. In Chromium the DOM kerns across a space, and a canvas does so only with `fontKerning = "normal"`; WebKit's layout is believed to measure words separately. So a canvas font has a **spacing mode**, measured rather than assumed:

- `"run"`: the whole string in one `measureText`, with `fontKerning = "normal"`.
- `"words"`: each space-separated word measured alone, plus one space advance per space.

The first time a font needs the probe, the same probe call also measures `CALIBRATION_TEXT` under that font — a fixed Latin line dense in kerning pairs. `decideSpacing` then compares the probe's width with `Math.ceil` of both canvas advances:[^calibration]

| Probe width | ⌈run⌉ | ⌈words⌉ | Spacing |
|---|---|---|---|
| 560 | 560 | 562 | `"run"` |
| 562 | 560 | 562 | `"words"` |
| 560 | 560 | 560 | `"words"` (tie) |
| 563 | 560 | 562 | `null`: this font stays on the probe for the generation |

A calibration never costs an extra layout: it rides in the probe call the font needed anyway. It is skipped when the canvas cannot measure the font at all (`measureTextAdvance` returns `null`); the font is then marked probe-only with no calibration request.[^no-canvas]

### Height and baseline come from the first probe of each line box

A canvas result takes its width from the canvas and its `height` and `baseline` from the first probe measurement made under the same line key in this generation, as the ablation did. At an explicit line height these are the same for every string.[^line-metrics] The width is `Math.ceil` of the canvas advance, the probe's own rounding rule.[^ceil]

### One bounded memo for metrics, cleared with the text-metrics generation

`measureTextMetrics` and `measureManyTextMetrics` answer a repeated `(text, options, maxWidth)` from a memo, whichever path measured it first. The memo is a `Map` kept in least-recently-used order, capped at 1,024 entries. A text longer than 256 characters is measured but not memoised.[^memo-bounds] `measureManyTextWidths` has no memo; it serves table autosizing, where the strings rarely repeat.

The keys join the option fields with U+0000, `undefined` as empty:

| Call | Font key fields | Memo key fields |
|---|---|---|
| `measureTextMetrics("Ready")` | 7 × `""` | `"Ready"`, 7 × `""`, `""` |
| `measureTextMetrics("Ready", { fontWeight: "600" })` | `""`, `""`, `"600"`, 4 × `""` | `"Ready"`, `""`, `""`, `"600"`, 4 × `""`, `""` |
| `measureTextMetrics("Ready", { maxWidth: 120 })` | 7 × `""` | `"Ready"`, 7 × `""`, `"120"` |

The font key's fields are, in order: `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontVariant`, `fontStretch`, `lineHeight`. The memo key is the text, then the font key's fields, then `maxWidth`.

**Invalidation.** Every cache in `TextMeasure.ts` — computed fonts, spacing modes, line boxes and the memo — is dropped by `clearTextMeasureCache()`. `Util.invalidateTextMetricsCache()` ([`core/Util.ts:346`](packages/lib/src/typescript/lib/core/Util.ts#L346)) calls it, so it runs on every theme change and every settled font batch, before any `Text` re-measures. `installTestDOM` calls it too.[^invalidation] The font-level caches are also dropped together whenever the computed-font cache would pass 256 entries.[^font-cache-cap]

### Fonts that are not yet active

A canvas measures a face that is still loading against the fallback face, as the probe does. Three things keep that from sticking:

1. `Body.init` already awaits font activation, so an app's tree is measured against the real face.
2. A later face (the lazy Latin-Ext subset, or an app's own) settles through `ThemeManager.onFontsSettled` → `reflowText` → `Util.invalidateTextMetricsCache()`, which now clears every cache here too.
3. If the canvas and the probe resolve different faces at calibration time, the calibration fails and the font stays on the probe for the generation.

`measureTextAdvance` also carries the one-time early-measurement warning the probe methods already have.[^fonts-active]

### What the memo covers, for `chart-repaint-gate`

The memo covers every measurement a library caller makes through `measureTextMetrics` or `measureManyTextMetrics`. After this plan, a repeated `measureAxisMargin` for an unchanged chart makes **no seam calls**: its 12 `measureText` calls per chart pass become 12 memo lookups. What stays is the work above the measurement — `scaleTicks`, `format` and the margin arithmetic, once per pass. That residue, and the repaint itself, is `chart-repaint-gate`'s. Its `chart.margin-memo` saving in W3.0 (−12.0 ms on `cdq`) is largely this plan's, and must be re-bounded on top of this plan's merge rather than counted twice.[^chart-overlap]

### Where the fix follows the ablation, and where it must differ

| Aspect | `g18.canvas-width` / `g18.measure-memo` | This plan |
|---|---|---|
| Single-line width | canvas, `Math.ceil` | same |
| Height and baseline | first probe per option strings | first probe per line key (computed font + line height) |
| `maxWidth` | probe | same, now memoised |
| Font resolution | regex over `var()` per call; falls back on `calc(` | computed style once per option bag per generation |
| `fontStretch` | left out of `ctx.font` | mapped to its keyword |
| Inherited context (letter-spacing, …) | ignored | gated |
| Whitespace | every text on the canvas | the whitespace rule |
| Kerning across spaces | engine default | calibrated per font |
| Rejected `ctx.font` | undetected | detected; probe |
| `measureTexts`, `measureTextWidths` | not routed | routed |
| Cache invalidation | never (canvas); root `apply` hook and `loadingdone` (memo) | `Util.invalidateTextMetricsCache()` |
| Memo bound | none | 1,024 entries, 256-character texts |
| Where | patches `DOM.source` | above the seam; counters see the saving |

Each difference is a case the ablation could ignore for one sweep in one engine and a shipped fix cannot. The evidence for each is in *Addendum: Canvas-Versus-Probe Evidence*.

### Scope within G18

In scope: F14.1's canvas half, F11.3, F12.3's measurement half, F16.1(a), F26.2's batching half, the memo half of F14.4, and F18.3, which the canvas makes unnecessary. Out: F14.4's move of the wrap re-measure off the bounds commit, F14.6, F14.7 and F14.10 (see *Non-Goals*).[^scope]

### The offline model derives both paths from one table

`ModelledDOMSource` implements the two new reads from the same baked advances its probe model sums, so canvas and probe agree offline by construction. The offline suite therefore pins routing — which read ran, how often, and when a cache clears — and never parity. Parity is the in-engine gate.[^offline-model]

### A `text-metrics` QA panel gives the geometry gate sight of text widths

Almost none of the W3.0 cells that bounded G18 labels a rectangle whose size is a measured text width: `editor`, `status`, the shells' panes and the charts are all placed by `Border`, `Split` or `Grid`, and `menus`' `menubarButton` covers one font and a handful of strings. A new panel, `packages/qa/src/panels/text-metrics.ts`, lays out 117 `Text`s at their preferred sizes and labels each one, so a one-pixel parity miss is a geometry `DIFF` in the A/B.[^parity-panel]

---

## Public API

In [`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts), after `MediaState` (`:108`), both re-exported as types from [`core/index.ts:14`](packages/lib/src/typescript/lib/core/index.ts#L14):

```typescript
/**
 * The computed values, as the browser reports them, of every typography
 * property that decides how wide a line of text is.
 */
export interface ComputedFont {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    fontStyle: string;
    fontVariantCaps: string;
    fontStretch: string;
    lineHeight: string;
    letterSpacing: string;
    wordSpacing: string;
    textTransform: string;
    fontFeatureSettings: string;
    fontVariationSettings: string;
    fontKerning: string;
    fontVariantLigatures: string;
    fontVariantNumeric: string;
    fontVariantEastAsian: string;
    fontSizeAdjust: string;
    textRendering: string;
}

/**
 * How a canvas advance treats spaces: `"run"` measures the whole string at
 * once, `"words"` sums each space-separated word and one space advance per space.
 */
export type TextAdvanceSpacing = "run" | "words";
```

On `DOMSource`, after `measureTexts` (`:1158`); `ProductionDOMSource` and `ModelledDOMSource` implement both:

```typescript
getComputedFont(options?: TextMeasureOptions): ComputedFont;
measureTextAdvance(text: string, font: string, spacing: TextAdvanceSpacing): number | null;
```

`measureText`, `measureTexts` and `measureTextWidths` keep their signatures. Their JSDoc gains one sentence: each forces a document layout, and the library measures through a layout-free path that falls back to them — in prose, with no `{@link}` to the internal module.

---

## Internal Structure

### `core/TextMeasure.ts`

```typescript
import { DOM } from "~/core/DOM.js";
import type { ComputedFont, TextAdvanceSpacing } from "~/core/DOM.js";
import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from "~/core/Util.js";

/** A fixed Latin line dense in kerning pairs, measured on both paths to calibrate a font. */
export const CALIBRATION_TEXT = "AVAWAY To Ty Yo. P. LT, (1,047.29) ffi AVAWAY To Ty Yo. P. LT, (1,047.29) ffi AVAWAY To Ty Yo AVAWAY To Ty Yo";

const MEMO_MAX_ENTRIES       = 1024;   // see [^memo-bounds]
const MEMO_MAX_TEXT_LENGTH   = 256;    // see [^memo-bounds]
const FONT_CACHE_MAX_ENTRIES = 256;    // see [^font-cache-cap]

/** A font the canvas can measure: its shorthand, and its line key (`null`: metrics stay on the probe). */
export interface CanvasFont { shorthand: string; lineKey: string | null; }

const _fonts   = new Map<string, CanvasFont | null>();          // font key → font; null: probe only
const _spacing = new Map<string, TextAdvanceSpacing | null>();  // shorthand → mode; null: probe only; absent: not calibrated
const _lines   = new Map<string, { height: number; baseline: number }>();  // line key → line box
const _memo    = new Map<string, TextMetrics>();                // memo key → metrics, least recently used first

export function isCanvasText(text: string): boolean;
export function canvasFontFrom(computed: ComputedFont): CanvasFont | null;
export function decideSpacing(probeWidth: number, run: number | null, words: number | null): TextAdvanceSpacing | null;
export function measureTextMetrics(text: string, options?: TextMeasureOptions): TextMetrics;
export function measureManyTextMetrics(requests: TextMeasureRequest[]): TextMetrics[];
export function measureManyTextWidths(texts: string[], options?: TextMeasureOptions): number[];
/** Drops every cache. Called by `Util.invalidateTextMetricsCache` and the test harness. @internal */
export function clearTextMeasureCache(): void;
/** Entry counts; for tests only. @internal */
export function _textMeasureCacheSizes(): { fonts: number; spacing: number; lines: number; memo: number };
```

`measureTextMetrics(text, options)` is `measureManyTextMetrics([{ text, options }])[0]`. The batch walks its requests in order. *Canvas-eligible* below means no `maxWidth` and a text that passes the whitespace rule.

| Request | State | Path |
|---|---|---|
| any | memo hit | memo; no seam call |
| `maxWidth` set, or fails the whitespace rule | — | probe |
| canvas-eligible | `canvasFontFor` gives `null` | probe |
| canvas-eligible | font not yet calibrated | probe, plus one calibration request for that font |
| canvas-eligible | spacing is `null` (probe only) | probe |
| canvas-eligible | spacing decided, line box unknown | probe; its result teaches the line box |
| canvas-eligible | spacing decided, line box known | canvas |
| canvas-eligible | `measureTextAdvance` returns `null` | probe; the font's spacing becomes `null` |

After the walk, every probe-bound request and every calibration request go out in **one** call. A lone request with no calibration uses `DOM.source.measureText`; anything else uses one `DOM.source.measureTexts`, with the calibration requests after the text requests.[^solo-probe]

```typescript
function canvasMetrics(text: string, font: CanvasFont): TextMetrics | null {
    const spacing = _spacing.get(font.shorthand);
    const line    = font.lineKey === null ? undefined : _lines.get(font.lineKey);

    if (!spacing || !line) {
        return null;   // uncalibrated, probe-only, or no line box yet
    }

    const advance = DOM.source.measureTextAdvance(text, font.shorthand, spacing);

    if (advance === null) {
        _spacing.set(font.shorthand, null);

        return null;
    }

    return { width: Math.ceil(advance), height: line.height, baseline: line.baseline };
}

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
```

Calibration, for a font not yet in `_spacing` and not already queued in this batch:

1. `run = DOM.source.measureTextAdvance(CALIBRATION_TEXT, font.shorthand, "run")`. If `run` is `null`, set `_spacing` to `null` and queue nothing.
2. Otherwise queue `{ text: CALIBRATION_TEXT, options }` with the requesting request's own options, and keep `run`.
3. After the probe call: `words = DOM.source.measureTextAdvance(CALIBRATION_TEXT, font.shorthand, "words")`, then `_spacing.set(font.shorthand, decideSpacing(calibrationWidth, run, words))`.

`decideSpacing`: `"words"` when `⌈words⌉` equals the probe width, else `"run"` when `⌈run⌉` does, else `null` (the table in *Architecture Decisions*).

A probe result teaches the line box only for a canvas-eligible request with a line key, never for a `maxWidth` request: `_lines.set(font.lineKey, { height, baseline })` when absent.

The memo:

```typescript
function recall(key: string): TextMetrics | undefined {
    const hit = _memo.get(key);

    if (hit !== undefined) {
        _memo.delete(key);   // move to the most recently used end
        _memo.set(key, hit);
    }

    return hit;
}

function remember(key: string, text: string, metrics: TextMetrics): TextMetrics {
    if (text.length <= MEMO_MAX_TEXT_LENGTH) {
        _memo.set(key, metrics);

        if (_memo.size > MEMO_MAX_ENTRIES) {
            _memo.delete(_memo.keys().next().value!);
        }
    }

    return metrics;
}
```

`measureManyTextWidths(texts, options)` returns `[]` for `[]` without a seam call. Otherwise it resolves the one font (`canvasFontFor(options)`) and measures each canvas-eligible text with `measureTextAdvance` when the font's spacing is decided. Every other text goes to one `DOM.source.measureTextWidths(rest, options)` call, followed by `CALIBRATION_TEXT` when the font is uncalibrated and the canvas measured its `run` advance. Widths come back in input order. It needs no line box.

Split any of these past ~30 lines into named steps per `CODE_CONVENTIONS.md` (`collectRequest`, `runProbe`, `finishCalibration`, …).

### `core/DOM.ts`

A module constant replaces the three copies of the probe's font defaults and also serves `getComputedFont`, so the computed font and the probe can never resolve different defaults:

```typescript
const PROBE_FONT_DEFAULTS = {
    fontFamily:  "var(--ts-ui-font-family, system-ui, sans-serif)",
    fontSize:    "var(--ts-ui-font-size, 14px)",
    fontWeight:  "normal",
    fontStyle:   "normal",
    fontVariant: "normal",
    fontStretch: "normal",
    lineHeight:  "calc(1em + var(--ts-ui-line-padding, 2px))",
} as const;
```

`measureText`, `measureTexts` and `measureTextWidths` destructure their defaults from it; their probes are otherwise unchanged. `measureTextWidths` keeps omitting `lineHeight`.

Beside `_metricsCtx` (`:12`):

```typescript
let _advanceCtx: CanvasRenderingContext2D | null | undefined = undefined;  // undefined: not yet created
let _advanceFont: string | null = null;                                    // the font the context holds
const _canvasFontAccepted: Map<string, boolean> = new Map();
const CANVAS_FONT_SENTINEL  = "1px serif";   // see [^sentinel]
const CANVAS_FONT_CACHE_MAX = 256;           // see [^font-cache-cap]
```

```typescript
measureTextAdvance(text: string, font: string, spacing: TextAdvanceSpacing): number | null {
    _warnEarlyMeasure();

    const ctx = _textAdvanceContext();       // creates the context once; caches null too

    if (ctx === null || !_selectCanvasFont(ctx, font)) {
        return null;
    }

    if (spacing === "run") {
        return ctx.measureText(text).width;
    }

    const words = text.split(" ");
    let width   = (words.length - 1) * ctx.measureText(" ").width;

    for (const word of words) {
        width += ctx.measureText(word).width;
    }

    return width;
}
```

`_selectCanvasFont(ctx, font)`:

1. Returns `true` at once when `_advanceFont === font`.
2. Looks `font` up in `_canvasFontAccepted`. On a first sight, it sets `ctx.font = CANVAS_FONT_SENTINEL`, reads `ctx.font` back, assigns `ctx.font = font`, and records `font` as accepted when `ctx.font` no longer reads the sentinel's value.[^sentinel] The map is cleared first when it has reached `CANVAS_FONT_CACHE_MAX`. On a known accepted font, it assigns `ctx.font = font`.
3. On a rejected font, sets `_advanceFont = null` and returns `false`.
4. Otherwise sets `ctx.fontKerning = "normal"` when `"fontKerning" in ctx`, sets `_advanceFont = font`, and returns `true`.[^kerning]

```typescript
getComputedFont(options: TextMeasureOptions = {}): ComputedFont {
    const probe = document.createElement("span");

    _applyProbeStyles(probe, { position: "fixed", visibility: "hidden", ..._probeFontStyles(options) });
    document.body.appendChild(probe);

    const computed = getComputedStyle(probe);
    const font     = _readComputedFont(computed);   // every field read before the probe leaves the tree

    document.body.removeChild(probe);

    return font;
}
```

`_probeFontStyles(options)` returns the seven font properties, each from `options` or `PROBE_FONT_DEFAULTS`. `_readComputedFont` reads each `ComputedFont` field through `getPropertyValue` with its CSS name (`font-family`, `font-variant-caps`, `letter-spacing`, …), trimmed; an unsupported property reads `""`.

### `tests/dom/TestDOM.ts`

`ModelledDOMConfig` gains `textContext?: Partial<ComputedFont>`, merged over the modelled computed font so a test can set, say, `letterSpacing: "1px"`.

`ModelledDOMSource.getComputedFont(options)` models the probe:

| Field | Modelled value |
|---|---|
| `fontFamily` | the option (default as production), each `var(--name[, fallback])` replaced innermost-first by `themeVars[name]`, or the fallback when unset |
| `fontSize` | the option after the same substitution, then `` `${this.resolveFontSizePx(value)}px` `` |
| `fontWeight` | `normal` → `400`, `bold` → `700`, else as given |
| `fontStyle` | as given (default `normal`) |
| `fontVariantCaps` | `fontVariant` as given (default `normal`) |
| `fontStretch` | keyword → percentage (the reverse of the stretch map); default `100%` |
| `lineHeight` | `normal` when the option is `normal`; else `` `${this.resolveLineHeightPx(option, fontBox)}px` `` |
| the eleven context fields | each property's first compatible value in the context-gate table |

`measureTextAdvance(text, font, spacing)` returns the unrounded sum of the baked per-character advances — the same sum `measureText` ceils, with the same `?? advance[' '] ?? 0` fallback, through a shared private `advanceOf(text)`. It ignores `font` and `spacing`, as the probe model ignores the font options. `installTestDOM` calls `clearTextMeasureCache()` beside `clearBorderWidths()` (`:1609`).

### `packages/qa/src/panels/text-metrics.ts`

A panel in the shape of [`menus.ts`](packages/qa/src/panels/menus.ts). It imports only `@jimka/typescript-ui/*` and `../pageTargets.js`.

- **Fonts** — nine `TextOptions` bags, index `k`:
  - 0 `{}`
  - 1 `{ fontWeight: '600' }`
  - 2 `{ fontWeight: 'bold' }`
  - 3 `{ fontStyle: 'italic' }`
  - 4 `{ fontVariant: 'small-caps' }`
  - 5 `{ fontSize: 12 }`
  - 6 `{ fontSize: 20 }`
  - 7 `{ fontSize: '--ts-ui-header-font-size' }` (a theme-bound `calc()` token)
  - 8 `{ fontFamily: 'serif' }`
- **`MOUNT_STRINGS`**: `'Ready'`, `'File'`, `'Edit'`, `'Ln 1, Col 1'`, `'Command 12'`, `'Settings…'`, `'Open Recent'`, `'1,000'`, `'Jan 2026'`, `'Łódź'`, `'W'`, `'Save As…'`. `'Łódź'` loads the lazy Latin-Ext subset during mount, before anything is measured.
- **`UPDATE_STRINGS`**: `'Ln 128, Col 42'`, `'AVAWAY To Ty Yo'`, `'office affluent'`, `'0123456789'`, `'Sphinx of black quartz'`, `'żółć ąę'`, `'日本語テキスト'`, `'Q4: $12,345.67'`, `'getPreferredSize()'`, `'naïve café'`, `'P. T. Barnum'`, `'iiiWWW'`. None of these appears at mount, so every first measurement of them in `update` is a canvas measurement on the fix's build.
- **Tree**: a root `Panel` with `VBox({ spacing: 8 })` holding:
  - a baseline row: `Panel` + `HBox({ spacing: 12 })` (default baseline alignment) of one `Text('Hxg', font k)` per font;
  - the columns: `Panel` + `HBox({ spacing: 12, itemAlign: 'start' })` of nine column `Panel`s, each `VBox({ spacing: 2 })` of `n` `Text(MOUNT_STRINGS[r], font k)`.
  
  `VBox` without stretching and `HBox` both give a `Text` its preferred width, so every labelled width is a measured one.
- **`n`**: strings per column, `defaultScale = 12`, capped at 12.
- **Targets**:
  - `passes`: the root.
  - `update(i)`: sets every column Text in row `r` to `UPDATE_STRINGS[(r + i) % 12]`.
  - `theme`: `themeTarget([LARGE_FONT_THEME])`, where `LARGE_FONT_THEME = defineTheme(ModernTheme, { font: { size: '16px' } })`, so a theme switch changes measured widths.
- **Geometry**: `b${k}` for the baseline row, `t${k}r${r}` for the columns.
- **`defaultDrive`**: `'passes,update:24'`.
- **`describe()`**: `{ strings: n, fonts: 9 }`.
- **`description`**: names G18's canvas-versus-probe parity check.

---

## Ordered Implementation Steps

1. **Baseline.** From the worktree root, run `git rev-parse HEAD` and record it as **BASE_SHA** in the plan's *Implementation Notes*; the in-engine A/B builds its `wt` arm from it. Run `npm run build:lib`, `npm test` (green) and `npm run docs:api` (expect 14 warnings; note the list).
2. **`core/DOM.ts` — types.** Add `ComputedFont` and `TextAdvanceSpacing` after `MediaState` (`:108`), and add both to the `export type { … } from '~/core/DOM.js'` line of `core/index.ts` (`:14`).
3. **`core/DOM.ts` — defaults.** Add `PROBE_FONT_DEFAULTS` and `_probeFontStyles(options)`. Switch `measureText` (`:2241`), `measureTextWidths` (`:2295`) and `measureTexts` (`:2341`) to read their defaults from it. Check: `npm test` still green with no test edits.
4. **`core/DOM.ts` — the seam.** Add `getComputedFont` and `measureTextAdvance` to `DOMSource` after `measureTexts` (`:1158`), with JSDoc, and add the one-sentence cost note to the three probe members' JSDoc. Implement both on `ProductionDOMSource` after `measureTexts`, with the module state, `_textAdvanceContext`, `_selectCanvasFont` and `_readComputedFont` of *Internal Structure*.
5. **`core/TextMeasure.ts`.** Create it as specified: the file header comment names `BorderWidths.ts` as its precedent and says it is not exported from `core/index.ts`. Document every constant's value and its reason from the footnotes.
6. **`tests/dom/TestDOM.ts`.** Add `textContext`, `getComputedFont`, `measureTextAdvance` and `advanceOf`, and call `clearTextMeasureCache()` in `installTestDOM`. Check: `npm run typecheck && npm -w packages/lib run typecheck:test`.
7. **`core/Util.ts`.**
   - `measureTextSize` (`:79`) calls `measureTextMetrics`.
   - `measureTextWidths` (`:104`) calls `measureManyTextWidths`.
   - `invalidateTextMetricsCache` (`:346`) calls `clearTextMeasureCache()` first.
   - Update the three measurement JSDocs: layout-free for single-line text in fonts the canvas reproduces, an off-screen probe otherwise.
8. **Call sites.**
   - `component/input/Text.ts`: `:491` `DOM.source.measureTexts(` → `measureManyTextMetrics(`; `:531` and `:666` `DOM.source.measureText(` → `measureTextMetrics(`. Update the class JSDoc (`:109`) and `calculateSize`'s JSDoc (`:505`) to describe the canvas-first measurement.
   - `component/chart/ChartAxis.ts:76` and `:84`: `DOM.source.measureText(` → `measureTextMetrics(`; drop its `DOM` import (`:3`), which nothing else in the file uses.
   - `overlay/Tooltip.ts:262` and `:832`: the same.
   - `ComboBox.ts:377` and `Table.ts:2387`, `:2417`, `:2745` already use `Util` and need no edit.
   
   Check: `grep -rn "DOM\.source\.measureText" packages/lib/src/typescript/lib` matches only `core/TextMeasure.ts` and the construction comment at `component/input/Text.ts:216`, which stays as it is.
9. **New tests.** Write the cases of *Expected Behaviour*: TM1–TM16 in `tests/core/TextMeasure.test.ts`, P1–P4 in `tests/dom/text-advance.test.ts` (`// @vitest-environment jsdom`), and I1–I3 in the files each names. The implement skill may write each case before its code; steps 2–8 give the order the code lands in.
10. **Update the pinned tests** listed under *Tests that change*. Check: `npm test` green.
11. **QA panel.** Create `packages/qa/src/panels/text-metrics.ts` and add its row to the *Panels* table of `packages/qa/README.md`: the *Validated* cell reads "none yet"; *Reproduces* names the parity gate. Check: `npm run build:lib && npm -w packages/qa run typecheck && npm -w packages/qa run test` (P1's contract case and `mount.test.ts` cover the new panel under jsdom).
12. **Docs.** Make the edits in *Documentation Impact*. Check: `npm run docs:api` shows the same 14 warnings as step 1 and no new one; `npm run lint` clean.
13. **Stop.** Do not run `packages/qa/runqa.sh`, any sweep, MiniBrowser or the Tauri host. The in-engine A/B in *Verification* is the orchestrator's.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/TextMeasure.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartAxis.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/core/TextMeasure.test.ts` |
| Create | `packages/lib/tests/dom/text-advance.test.ts` |
| Modify | `packages/lib/tests/component/TextBatchMeasure.test.ts` |
| Modify | `packages/lib/tests/core/StartupTextMetrics.test.ts` |
| Modify | `packages/lib/tests/overlay/Tooltip.test.ts` |
| Modify | `packages/lib/tests/component/chart/ChartAxis.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/components/Text.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Create | `packages/qa/src/panels/text-metrics.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Unit cases run under node with `installTestDOM` and a counting wrapper over `DOM.source` in the style of `TextBatchMeasure.test.ts`'s `installCountingMeasureSource`, extended to count `getComputedFont`, `measureTextAdvance` and `measureTextWidths`. "Probe calls" means `measureText` + `measureTexts` + `measureTextWidths`.

### `tests/core/TextMeasure.test.ts` — unit

| # | Case | Expected |
|---|---|---|
| TM1 | First `measureTextMetrics('Hello')` after install | one `getComputedFont`; one `measureTexts` whose requests are `['Hello', CALIBRATION_TEXT]`; two `measureTextAdvance` (`run`, `words`); returns `DOM.source.measureText('Hello')`'s metrics |
| TM2 | Then `measureTextMetrics('World')` | 0 probe calls, 0 `getComputedFont`, 1 `measureTextAdvance`; width = `Math.ceil` of the modelled advance; height and baseline equal TM1's |
| TM3 | Then `measureTextMetrics('World')` again | 0 seam calls of any kind |
| TM4 | After calibration, `measureTextMetrics('Hello World', { maxWidth: 30 })` twice | first: one `measureText` carrying `maxWidth`; second: 0 seam calls |
| TM5 | After calibration, each ineligible text of the whitespace table | one `measureText` each; no `measureTextAdvance` |
| TM6 | `isCanvasText` over the whitespace table | the table's column exactly |
| TM7 | `canvasFontFrom` over the computed-font table, plus each context property set to a non-compatible value (`letterSpacing: '1px'`, `textTransform: 'uppercase'`, `fontFeatureSettings: '"tnum"'`, `textRendering: 'optimizeLegibility'`) and to `''` | the shorthand or `null` as the tables say; `''` is compatible; `lineHeight: 'normal'` gives `lineKey: null` |
| TM8 | `decideSpacing` over the calibration table | the table's column exactly |
| TM9 | `installTestDOM` with `textContext: { letterSpacing: '1px' }` | every measurement is a probe call; no `measureTextAdvance`; one `getComputedFont` per distinct option bag |
| TM10 | `measureTextAdvance` spied to return `null` | the first measurement probes with no calibration request; later ones under that font probe too, with no further `getComputedFont` |
| TM11 | Warm up, then `Util.invalidateTextMetricsCache()`, then measure again | `getComputedFont` and a calibrated probe run again; `_textMeasureCacheSizes()` reads all zero right after the call |
| TM12 | Widen the baked advances (as `TreeFontReflow.test.ts` does), invalidate, re-measure a memoised string | the new, wider width |
| TM13 | 1,025 distinct strings | memo size 1,024; the first string misses; a string recalled before the overflow survives it; a 257-character text is never memoised (measuring it twice costs two `measureTextAdvance`) |
| TM14 | 257 distinct option bags (`fontSize: 1px … 257px`) | the font caches never exceed 256; results stay equal to a fresh measurement |
| TM15 | `measureManyTextMetrics` over `[calibrated-font text, new-font text A, new-font text B, maxWidth text]` | one `measureTexts` of `[A, B, maxWidth text, CALIBRATION_TEXT under A's options]`; the calibrated text by canvas; results in request order; `[]` → `[]` with no seam call |
| TM16 | `measureManyTextWidths` | an uncalibrated font: one `measureTextWidths` of every text plus `CALIBRATION_TEXT` last, returning only the texts' widths in order; once calibrated, eligible texts by canvas and ineligible ones in one `measureTextWidths`; `[]` → `[]` with no seam call |

### `tests/dom/text-advance.test.ts` — unit, jsdom, production seam

| # | Case | Expected |
|---|---|---|
| P1 | No 2D context (jsdom's default) | `measureTextAdvance` returns `null`; `getContext` is called once across three calls |
| P2 | Stubbed context whose `measureText` is 7 px a character, whose `font` setter ignores any string containing `bogus`, and which has `fontKerning` | `run` of `'abc def'` = 49; `words` = 49 (7 + 21 + 21); a `bogus` font gives `null`; after an accepted font, `fontKerning === 'normal'` |
| P3 | Early warning | `measureTextAdvance` before activation warns once, with the same one-shot flag as `measureText` (after one `measureText` warned, it does not warn again) |
| P4 | `getComputedFont({ fontWeight: 'bold' })` | an object with all 18 `ComputedFont` keys, each a string; `<body>` has the same child count before and after |

### Integration — unit

| # | File | Case | Expected |
|---|---|---|---|
| I1 | `tests/core/TextMeasure.test.ts` | A default `nowrap` `Text`, measured once through `getPreferredSize()`, then `setText('Ln 2, Col 7')` and `getPreferredSize()` again — what the parent's `doLayout` does | 0 probe calls, 1 `measureTextAdvance` (the slice 14 proof for F14.1) |
| I1b | same | A wrapping `Text` (`truncate: false`, `whiteSpace: 'normal'`) measured once, then `setWidth(40)` | 1 `measureText` (the wrap); the natural re-measure is a memo hit (was 2 probes, F14.4) |
| I2 | `tests/overlay/Tooltip.test.ts` | `Tooltip.show` of the same one-line text twice | the second show makes 0 probe calls (F11.3) |
| I3 | `tests/component/chart/ChartAxis.test.ts` | `measureAxisMargin('left', …)` twice with the same scale | the second call makes 0 seam calls; both return the same margin (F26.2's measurement half) |

### Tests that change

These pin the probe's call shapes, which this plan changes on purpose. Add a helper `participants(batch) = batch.filter(r => r.text !== CALIBRATION_TEXT)` to `TextBatchMeasure.test.ts`:

- **Case 1**: `participants(batchCalls[0])` has length 2; the raw batch ends with one `CALIBRATION_TEXT`.
- **Case 2**: rename it "a lone stale Text is measured alone". Its first measurement makes one `measureTexts` of `['solo', CALIBRATION_TEXT]` and `textCalls` 0. Add a second lone `Text` afterwards: 0 probe calls.
- **Cases 3, 6 and 9**: compare lengths on `participants(...)`.
- **Case 7**: compare the font weights on `participants(...)`.
- **Case 8**: build `a2` and `b2` with `{ fontWeight: '600' }`, so their font is uncalibrated and still batches, and compare texts on `participants(...)`.
- **Case 11**: `textCalls` after `setWidth(40)` is 1: the natural re-measure is a memo hit and only the wrap probes.
- **Font-style case a**: compare `fontStyle` on `participants(...)`.

In `StartupTextMetrics.test.ts`, also spy on `measureTextAdvance` and record its text. Drop `CALIBRATION_TEXT`, and compare the recorded texts sorted and de-duplicated: `[]` for the awaited app, `['File', 'New']` for the control.

### Manual — in-engine (the orchestrator)

Geometry `=` for every labelled rectangle in every cell of the A/B below, parity included, and the savings and counters of *Expected readings*. Nothing offline can show parity: the model derives both paths from one table.

---

## Verification

1. `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`.
2. `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`. The W3.0 ablation tests (`ablations.test.ts`, `ablations.canvas.test.ts`) call the seam directly and must pass unchanged.
3. `npm run docs:api`: the 14 warnings of step 1 and no new one.
4. The grep of step 8: `DOM.source.measureText*` only in `core/TextMeasure.ts`, plus the comment at `Text.ts:216`.

### In-engine A/B — the orchestrator runs this, never the implementer

Every run opens a full-screen window; run it only with the user's go-ahead. From the root of the checkout that holds the fix, so both arms load the same page and the `text-metrics` panel:

```sh
git worktree add .worktrees/_g18-base <BASE_SHA> --detach
ln -sfn "$PWD/node_modules" .worktrees/_g18-base/node_modules
(cd .worktrees/_g18-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g18-base/packages/lib"
npm run build:lib
```

Then this script, saved anywhere outside the repository and run from the repository root:

```bash
#!/bin/bash
# G18 in-engine A/B: the base build (wt) against the fix (main), one session.
# Each cell runs base-a, fix-1, base-b, fix-2, base-c: the base arm at both
# ends, each arm's runs symmetric about the cell's centre, so a linear drift
# cancels. Every run opens a full-screen window.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${G18_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

wtab() {
    local cell=$1 params=$2 step build arm rep

    for step in wt:base:a main:fix:1 wt:base:b main:fix:2 wt:base:c; do
        IFS=: read -r build arm rep <<< "$step"
        "$RUNQA" "g18$SESSION-$cell-$arm-$rep" "$build" "$params&$FLAGS" || exit 1
    done
}

wtab cdt 'panel=code-document&drive=type'
wtab sdy 'panel=shell-deep&drive=type'
wtab ssy 'panel=shell-shallow&drive=type'
wtab clq 'panel=chart-line&drive=passes'
wtab cdq 'panel=chart-dashboard&n=50&drive=passes'
wtab ffc 'panel=form-flat&click=combo&drive=click'
wtab mt 'panel=menus&drive=toggle'
wtab tnk 'panel=tree-nodes&drive=key'
wtab tmu 'panel=text-metrics&drive=update:24,theme:1,update:24'
```

45 runs, about 15 minutes. `tmu` switches the theme between its two `update` phases on purpose: both arms do the same, and the second phase checks that the canvas re-calibrates after invalidation. A stopped script is re-run for the failing cell under a new `G18_SESSION`.

**Reading a cell.** Run `python3 packages/qa/bin/qa-table.py packages/qa/results g18s1-<cell>- --seam`. The first row, `base-a`, is the geometry reference.

- **bracket** = the largest minus the smallest `avg` of the three `base` rows.
- **Δms** = the mean of the two `fix` rows minus the mean of the three `base` rows.
- A `win` is Δms < −bracket; a `regress` is Δms > +bracket.
- **Probe calls** per unit = `seam.source.measureText + measureTexts + measureTextWidths` from the `--seam` listing.

The `qa-ab.py` analyser does not apply: it scores ablation arms, and requires every non-plain arm to name its `abl=`.

**Expected readings.** The base column is the W3.0 plain mean, for orientation only: the session's own base runs are the reference. The fix column is the order of the ablation's arm, which is the saving this plan must reproduce.

| Cell | Phase | Base ms | Fix ms | Probe calls per unit, base → fix |
|---|---|---|---|---|
| `cdt` | type | 53.6 | ≈ 19 | 0.75 → 0 |
| `sdy` | type | 57.7 | ≈ 21 | 0.75 → 0 |
| `ssy` | type | 56.5 | ≈ 20 | 0.75 → 0 |
| `clq` | passes | 4.7 | ≈ 2.6 | 12 → 0 |
| `cdq` | passes | 23.2 | ≈ 11 | 48 → 0 |
| `ffc` | click | 64.7 | flat (≈ −0.8) | 10 → 0 |
| `mt` | toggle | 35.1 | flat to −0.5 | 0.5 → 0 |
| `tnk` | key | 93.0 | ≈ 82 | 6 → 0 |
| `tmu` | update, update | — | flat | 1.00 → 0 in both `update` phases |
| `tmu` | theme | — | flat | equal on both arms |

**Pass criteria:**

1. **Geometry `=` on every row of every cell.** This is the gate; any `DIFF` fails the change, whatever the timing.
2. **Typing:** `cdt`, `sdy` and `ssy` each read Δms ≤ −25 ms. Below −15 ms, check the probe counter before anything else: a non-zero fix value means a path still probes.
3. **Charts and tree:** `cdq` and `tnk` read `win`.
4. **Every cell:** probe calls read ≤ 0.02 per unit on the fix, outside `tmu`'s theme phase, and no cell reads `regress`.
5. **Steady state:** `seam.source.getComputedFont` reads ≈ 0 per unit on the fix. A per-unit value means the font cache is missing.

A `DIFF` in `tmu` means canvas parity fails in WebKitGTK for the labels it names. Record them; the branch does not merge until a follow-up decides.

Record the readings in `plans/research/render-review-2026-09-15/` and fill in the `text-metrics` row's *Validated* cell.

---

## Documentation Impact

- **`core/index.ts`** exports the types `ComputedFont` and `TextAdvanceSpacing`; TypeDoc documents them and the two new `DOMSource` members. No public JSDoc may `{@link}` `TextMeasure.ts`, which is not exported (`CODE_CONVENTIONS.md`, *Don't `{@link}` internal symbols*).
- **`docs/concepts/performance.md:141`** — replace the "Measuring N strings one at a time" bullet. New content: single-line text in a font the canvas reproduces is measured without a document layout, and a repeat is served from a memo. A wrap width, text with leading, trailing or repeated whitespace, and a font the canvas cannot reproduce still use the probe, so a consumer measuring several of those should use one `DOMSource.measureTexts` call. After changing typography outside `ThemeManager` — a `:root` variable, `<body>` letter-spacing, an app's own font load — call `Util.invalidateTextMetricsCache()`. Also say that `<body>` typography the canvas cannot reproduce — letter-spacing, `text-rendering: optimizeLegibility`, font features — keeps every measurement on the probe.
- **`docs/concepts/dom-seams.md:63`** — the measurement leaf list gains "the canvas text-advance context and the computed-font read".
- **`docs/components/Text.md:3`** — "uses an off-screen probe element to measure text dimensions" becomes: measures its single-line size without a document layout, and a wrapped height through an off-screen probe.
- **`docs/reference/changelog/next.md`**:
  - *Breaking changes → Core*: "`DOMSource` gains `getComputedFont` and `measureTextAdvance`", linking the migration note.
  - *Changed → Core*: text measurement no longer forces a document layout for single-line text, typing and chart passes no longer re-lay out the page, and results are cached until the next theme change or font load (with the `Util.invalidateTextMetricsCache()` advice).
- **`docs/reference/migration/next.md`** — a section "`DOMSource` gains two members": what changed and why, who acts (only a custom `DOMSource` implementation), and a minimal implementation of each: a computed-style read and a canvas `measureText`, or `null` to keep every measurement on the probe.
- **`packages/qa/README.md`** — the `text-metrics` row in *Panels*.

---

## Potential Challenges

- **jsdom logs "Not implemented: HTMLCanvasElement.prototype.getContext" once per module.** `_textAdvanceContext` caches the `null` so it logs once. It changes no test outcome.
- **An app stylesheet setting `text-rendering: optimizeLegibility` (or letter-spacing) on `<body>` disables the canvas everywhere.** That is the context gate working; such an app keeps today's cost. Mention it in `performance.md`.
- **The memo hands every hit the same `TextMetrics` object.** No caller mutates one (`Text.applyNaturalMetrics`, `ChartAxis`, `Tooltip`, `Util.measureTextSize` only read); a new caller must not either. Say so in `measureTextMetrics`'s JSDoc.
- **`getComputedFont` forces a style recalculation on a cache miss.** That is once per option bag per generation, and never on a steady-state keystroke; the A/B's `getComputedFont` counter checks it.
- **Stale entries after typography changes the library cannot see.** `Text` instances already keep stale sizes in that case; the memo extends the same rule to `ChartAxis` and `Tooltip`. The documented remedy is `Util.invalidateTextMetricsCache()`.
- **A WebKit engine without `ctx.fontKerning`.** `"run"` then measures under the engine default, and the calibration picks whichever mode matches the probe, or neither.
- **Running the A/B from the wrong checkout.** Both arms must load the page of the fix's checkout, which holds the `text-metrics` panel; `QA_WT_LIB` only swaps the library.

---

## Critical Files

- [`core/BorderWidths.ts`](packages/lib/src/typescript/lib/core/BorderWidths.ts) — the precedent: an internal cache over a seam read, cleared by the theme path and `installTestDOM`.
- [`core/Util.ts`](packages/lib/src/typescript/lib/core/Util.ts) — `invalidateTextMetricsCache`, `textMetricsGeneration`, `boundFontSizePx` (the theme-var-then-probe cache precedent), and the public measurement functions.
- [`core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the three probes (`:2241`–`:2408`), `measureFontMetrics` (`:2424`, the existing canvas read), `_warnEarlyMeasure` (`:34`), `getBorderWidths` (`:2706`).
- [`core/Theme.ts:1485-1498`](packages/lib/src/typescript/lib/core/Theme.ts#L1485) — `onFontsSettled` → `reflowText` → `Util.invalidateTextMetricsCache()`, the invalidation order this plan relies on.
- [`core/FontActivation.ts`](packages/lib/src/typescript/lib/core/FontActivation.ts) — the startup font wait and `isFontActivated`.
- [`component/input/Text.ts`](packages/lib/src/typescript/lib/component/input/Text.ts) — `batchMeasure` (`:458`), `calculateSize` (`:511`), `measureOptions` (`:602`), `measuredHeight` (`:646`), `setWidth` (`:690`).
- [`tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `ModelledDOMSource.measureText` (`:1085`), `font()` (`:1515`), `installTestDOM` (`:1602`).
- [`tests/component/TextBatchMeasure.test.ts`](packages/lib/tests/component/TextBatchMeasure.test.ts) — the counting-source pattern and the cases that change.
- [`packages/qa/src/harness/ablations.ts:1529-1585`](packages/qa/src/harness/ablations.ts#L1529) — `g18CanvasWidth`, the prototype this ships.
- [`packages/qa/src/panels/menus.ts`](packages/qa/src/panels/menus.ts) and [`packages/qa/src/pageTargets.ts`](packages/qa/src/pageTargets.ts) — the panel shape and `themeTarget`.

---

## Non-Goals

- **F14.4's move of the wrap re-measure off the bounds commit.** `setWidth`'s synchronous re-measure is a documented contract that `TextIntrinsicHeight.test.ts` pins, and W3.0 did not bound it. The memo already halves a wrapping `Text`'s probes per width change (I1b).
- **F14.6, filtering the theme-change sweep by visibility.** The sweep now costs one probe batch, as before, with every later measurement layout-free; what remains is per-`Text` script time, unmeasured.
- **F14.7, dropping the setters' unconditional `scheduleLayout()`.** This plan is what makes it possible — a setter can now measure eagerly for the price of a canvas call — but it changes the layout-scheduling contract (`TextAutoMeasureLayoutSchedule.test.ts`) and needs its own bound: a counter-only read of scheduled passes per `setText` whose size does not change.
- **F14.10**, `Text.render()`'s duplicate value-class token: a class-tier item with no measurement in it.
- **Measuring wraps on a canvas.** Line breaking stays the probe's.
- **Modelling font options in the offline advance table.** The model stays weight- and style-agnostic; parity is the engine's gate.
- **Removing the W3.0 `g18.*` ablations.** They document the sweep and still run against a base build.
- **Removing Loom's `setAutoMeasure(false)` pin in `EditorController.ts`.** That is Loom's change, and S6's success check once this merges.
- **The chart's per-pass tick generation and repaint** — `chart-repaint-gate`.

---

## Addendum: Canvas-Versus-Probe Evidence

Measured while drafting, in headless Chromium 153 (no window), on a page carrying the library's own Manrope subsets and the probe code of `ProductionDOMSource.measureText` / `measureTextWidths` copied verbatim. There were 128 font variants: sizes 11–24 px (with 13.5 px and two theme-variable sizes, one a `calc()` token), weights 400–800, italic, small-caps, condensed, and DejaVu Sans, DejaVu Sans Mono, Ubuntu and `serif`. Each variant measured 31 strings: 3,968 measurements. This is Blink, not WebKitGTK; the in-engine A/B is the WebKitGTK gate.

| Finding | Reading |
|---|---|
| The ablation's canvas (`ctx.font` only, `fontKerning` `auto`) | 83 widths 1 px wider than the probe, none narrower, all on `AVAWAY To Ty Yo`; raw canvas − probe from −0.0156 to +0.954 px |
| The same with `fontKerning = "normal"` | 0 of 3,968 differ; raw canvas − probe in [−1/64, 0] px |
| `AVAWAY To Ty Yo`, 14 px | probe 104.2344; canvas `auto` 104.7895, equal to the sum of its words; canvas `normal` 104.2295 |
| Calibration rule over the same set | `"run"` for all 122 Manrope variants; a tie (run = words exactly) for the 6 system-font variants, which have no space kerning; per-word spacing would have left the same 83 wider widths |
| `measureTextWidths` against `measureText` | identical for every one of the 3,968 |
| ` Ready` | `measureText` 40.33 (space dropped), `measureTextWidths` 41, canvas 43.13 |
| `Ready ` | `measureText` 43.14 (kept: the zero-width reference follows it), `measureTextWidths` 41 (dropped), canvas 43.13 |
| `a  b`; `a`+tab+`b`; `a`+LF+`b`; `a`+U+00A0+`b` | probe 18.88 for all four; canvas 21.66, 18.86, 18.86, 18.86 |
| Two spaces alone | probe 0, canvas 5.60 |
| Height/baseline at the default line height | 16/13 for `Ready`, `日本語テキスト`, `😀 ok`, `Łódź` and the empty string; 21/16 for all at `21px`; 19/15 for all at `normal` |
| Computed values | `--ts-ui-button-font-size` reads `calc(14px + 2px)` at the root, the span's `font-size` `16px`; `font-stretch` computes to `100%` / `75%`; weights compute numeric (`400`, `700`, `550`) |
| Canvas `font` acceptance | `normal small-caps 550 condensed 14px "Manrope Variable", …` accepted; `oblique` accepted; `75% 14px sans-serif` and `var(--x) sans-serif` rejected |
| `<body>` `letter-spacing: 1px` | probe 45.33, canvas 40.33; the probe span's computed `letter-spacing` `1px` |
| A face not yet loaded | the canvas returns the fallback width (80.06 against 72.53 after load), starts the load itself, and `loadingdone` fires |

WebKit's side is inference from its source, not measurement: its inline layout measures a line's intrinsic width as separately shaped whitespace-delimited items, which would lose kerning across a space, as Blink's canvas `auto` does. The calibration exists so the fix does not depend on that inference.

---

## Notes

[^above-seam]: Three reasons put the logic above the seam rather than inside `ProductionDOMSource.measureText`. The routing, eligibility, calibration and cache rules then run offline against the modelled source; inside the production source they would run only in a browser. The QA seam counters (`seam=1`) proxy every `DOM.source` method by name, so a probe avoided shows as `seam.source.measureText` falling and `measureTextAdvance` rising — the work avoided becomes visible, which the W3.0 rule scores. And the seam stays a set of raw reads, as `ARCHITECTURE.md`'s *Minimize direct DOM access* and `docs/concepts/dom-seams.md` describe it. The ablation patched `DOM.source` only because an ablation cannot edit the library.

[^two-reads]: A single seam method returning finished metrics would have put the decisions back in the untestable production source. `getBorderWidths` returns four raw computed strings and `BorderWidths.ts` parses them; `getComputedFont` does the same for fonts. `measureTextAdvance` is the smallest canvas read: one string, one font, one spacing mode. It returns `null` rather than throwing, so jsdom and any engine without a 2D context fall back to the probe with no special case.

[^whitespace]: The canvas replaces every ASCII whitespace character with a space but never collapses runs or trims ends. The probe collapses runs and drops a leading space; `measureText` keeps a single trailing space, because its zero-width reference span follows the text, while `measureTextWidths` drops it (addendum). One rule for all three entry points is simpler than one per probe, and a string with leading, trailing or doubled whitespace is rare in a label. Tabs and line feeds matched the probe as single characters in Chromium, but not as runs, and WebKit's canvas was not checked, so they stay on the probe.

[^computed-font]: The ablation replaced `var(--name, fallback)` with `getThemeVar` on every call and gave up on `calc(`. That misses nested variables — `Table`'s header font size is `var(--ts-ui-table-header-font-size, var(--ts-ui-font-size))` — and every theme font-size token built from an offset, which computes to `calc(var(--ts-ui-font-size) + 2px)`. A computed-style read on the probe's own span resolves all of it, including relative weights, exactly as the probe will. It costs one style recalculation per distinct option bag per generation, which the font cache makes rare. The stretch map exists because computed `font-stretch` is a percentage and the canvas shorthand rejects percentages (addendum).

[^context-gate]: These are the properties that change an advance width and that the probe inherits from `<body>` while the canvas uses its own defaults. The library never sets any of them — `ThemeManager.setTheme` writes only colour, family, size and line height to `<html>` — so the gate trips only on app CSS. `fontKerning` accepts `auto` and `normal` because the canvas is set to `normal`, which is what both DOM values do by default. `font-synthesis` and `font-optical-sizing` are not gated: their computed serialisations differ between engines, and gating on a value one engine prints differently would switch the canvas off there for nothing. The calibration catches a context difference that shows in its text, but not one limited to glyphs the text lacks — digits under `tnum`, say — which is why the gate exists at all.

[^calibration]: In Chromium the ablation's canvas was 1 px wider than the probe on 2.1% of measurements, always on a string whose kerning pairs span a space. Setting `fontKerning = "normal"` made all 3,968 identical (addendum). WebKit's DOM is believed to measure words separately, which would make `"normal"` the wrong choice there. Rather than bet on one engine, each font is checked against the probe once per generation. The check also catches a canvas that resolves a different face from the DOM, such as a face the canvas cannot see or one still loading on one side. A tie goes to `"words"`: in Chromium, per-word widths were only ever wider than the probe, never narrower, and a label measured too wide is never ellipsised. `CALIBRATION_TEXT` repeats `AVAWAY To Ty Yo` four times because one copy separates the two modes by only 0.43–0.95 px in Manrope at 11–24 px (0.56 px at 14 px, where both round to 105). Four copies are more than 1 px apart at every size, so the modes round apart. Calibrated this way, Chromium chose `"run"` for every Manrope variant.

[^no-canvas]: Without the early `run` measurement, every probe call in jsdom and in an engine without a canvas would carry a calibration request whose answer is certain to be "probe only". Measuring `run` first costs nothing when it returns `null`, and keeps those environments' probe calls exactly as they are today.

[^line-metrics]: The probe span is `position: fixed`, so it is a block whose height is its one line box. At an explicit line height that box is the same for every string in Chromium, including a CJK string and an emoji drawn from fallback faces (addendum). Every library caller measures at an explicit line height: the default is `calc(1em + var(--ts-ui-line-padding, 2px))`. `normal` stays on the probe because there a fallback face could enlarge the box in some engine, and no caller needs it. Deriving height and baseline from the canvas font metrics instead was rejected: the probe's baseline depends on how the engine rounds ascent and descent into the line box, and a one-pixel baseline error moves every baseline-aligned row.

[^ceil]: The probe's width is the canvas advance rounded up to the layout unit, 1/64 px: every raw difference in Chromium lay in [−1/64, 0]. Since `⌈⌈x⌉₁/₆₄⌉ = ⌈x⌉`, a plain `Math.ceil` of the advance reproduces the probe's `Math.ceil`. If an engine instead truncated to the layout unit, plain `Math.ceil` would err one pixel wide on a few strings, which never clips; any other rounding would err narrow on some. The calibration checks the rounding along with the spacing.

[^memo-bounds]: The largest per-pass working set W3.0 measured is 48 strings (`cdq`); a tree window is about 100 rows, and a menu or combo box a few dozen labels. 1,024 entries hold several screens of that with an order of magnitude to spare. At the 256-character cap a full memo is under 1 MB — key plus metrics, UTF-16 — and a typical one about 150 KB. Labels, tick texts and status lines are far shorter than 256 characters. The texts above it are tooltip and dialog bodies, measured once per show, and memoising them would crowd out the working set. Recency order costs one delete and one set per hit, and lets a long table autosize or a large tree cycle through without evicting the labels on screen.

[^invalidation]: `Util.invalidateTextMetricsCache()` is the existing seam for "the text metrics are stale": `ThemeManager.reflowText` calls it on every `setTheme` and on every settled font batch, *before* notifying theme listeners, and `Text.needsMeasure` compares against the generation it bumps. Clearing here means no `Text` can re-measure against a stale entry in between. `BorderWidths.ts` subscribes through `ThemeManager.onThemeChange` instead, but that subscription runs after `Util`'s own invalidation and depends on module-evaluation order; the direct call has neither problem. The ablation's memo cleared on every document-element `apply`, which also fires for unrelated root writes and catches nothing the generation does not. The size-hint memo lesson (`97-wave2-measurement.md`: a memo keyed too coarsely passed all 7,519 tests) applies. Every input of a probe measurement is either in the memo key — text, the seven option strings, `maxWidth` — or changes only through `setTheme` or a font load, both of which clear it. The inputs outside that — app CSS on `<body>`, an app-set `:root` variable — already leave `Text`'s own cached sizes stale today.

[^font-cache-cap]: Distinct font option bags per generation number in the tens: nine in the `text-metrics` panel, fewer in any shell. The caps only guard an app that animates a font size and would otherwise grow the caches until the next theme change. Clearing all three font-level caches together keeps them consistent: a spacing mode or line box never outlives the computed font it came from. The cost of a clear is one re-calibration per font. The seam's own map of accepted canvas fonts has the same cap for the same reason.

[^kerning]: Canvas `fontKerning` defaults to `auto`, which in Chromium measures words separately and so drops kerning across spaces. `normal` matches Chromium's DOM exactly (addendum). The property is set after each font assignment, because a `font` assignment may reset it. Where the context lacks the property, the calibration decides with the engine's default behaviour.

[^sentinel]: A canvas silently ignores a `font` it cannot parse and keeps the previous one, so every later width would be measured in the wrong font with no error. Reading `ctx.font` back after assigning a known sentinel is the only portable check, because the getter returns a normalised serialisation that cannot be compared with the input string. `1px serif` is a font no caller measures, so a real font never reads back as the sentinel. If one ever did, the result is only a harmless fallback to the probe.

[^solo-probe]: `DOM.source.measureText` is kept for a lone request because the wrap measurement and every ineligible text still need it, and one probe call is one layout either way. That keeps the method the library's single-request probe; it is not left without callers. Routing lone requests through `measureTexts` instead would change every existing single-probe test for no runtime gain.

[^fonts-active]: Chromium's canvas measures a face that is still loading against the fallback and starts the load itself (addendum). The probe does the same through layout, so the fix inherits today's behaviour, not a new failure. The difference would be caching: a fallback width in the memo would outlive the face's arrival. That is why the memo clears on the same `loadingdone` reflow that already re-measures every `Text`. The deadline path — activation settled after 50 ms without the face — ends in that reflow too, when the face does arrive. Gating memo writes on `isFontActivated()` was considered and dropped: every late face already clears the caches, so the gate would only add a second path to test.

[^chart-overlap]: W3.0 measured `g18.measure-memo` and `chart.margin-memo` on the same cells and noted they overlap: both remove `ChartAxis`'s `measureText` calls. Stating the boundary here lets `chart-repaint-gate` plan against the code as it will stand: measurement is free on a repeated pass, and the tick and format work is not. Its A/B must build its base arm from this plan's merge, or it will credit itself with this plan's saving.

[^scope]: F14.1's canvas half, F11.3 (tooltip), F12.3's measurement half (menu rows), F16.1(a) (combo labels) and F26.2's batching half are all measurements this layer serves without a probe. F18.3 proposed splitting `Tree._bindAndMeasure` so row labels could share one probe batch; with a canvas each row's measurement costs no layout, so the split buys nothing. F14.1's same-string guard landed in `8d8adb29`. F14.6 and F14.7 were unbounded in W3.0, and the status pass noted F14.7 is circular without a layout-free measurement: a setter cannot learn whether its size changed without measuring. This plan breaks that circle, but taking F14.7 here would change the layout-scheduling contract without a bound; it is a follow-up. F14.4's first half and F14.10 are in *Non-Goals* for the reasons given there.

[^offline-model]: `ModelledDOMSource.measureText` already sums baked per-character advances and ceils. Modelling `measureTextAdvance` as the same sum unrounded keeps every existing width expectation valid — `Tree.test.ts`, `ColumnWidths.test.ts` and `Util.test.ts` compute expected widths through the probe. It makes offline parity true by construction, which is the point: `TextBatchMeasure.test.ts`'s header already records that an offline parity assertion "would be true by construction and prove nothing". So the offline tests assert what only they can: which seam read ran, how many times, and when a cache clears.

[^parity-panel]: The W3.0 record says the fix "must still prove canvas widths match the probe's for every font, weight and letter-spacing the library measures". In `code-document`, `status` and `editor` are `Border` regions whose widths do not depend on the status text; the shells, charts, tree and form likewise label only containers. `menus`' `menubarButton` is the one text-sized label, and it covers one font and a handful of strings. The `text-metrics` panel puts nine fonts and 24 strings under the gate, in a layout where every labelled width, and through `y`, every height, is a measured value, and its baseline row turns baselines into `y` offsets. Its `update` corpus is disjoint from its mount corpus so the fix's build measures it on the canvas; its own theme target changes the base font size so a missed invalidation shows as a width `DIFF`.
