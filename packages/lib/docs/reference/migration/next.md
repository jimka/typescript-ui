# Next

Breaking-change notes for the next release, collected here as they land —
this page is not tied to a version number yet. Once this release is tagged,
any note here moves onto its own numbered page (see
[Migration](/reference/migration)) and this page resets to empty.

## `Slider`'s `showTicks` option and accessors are removed

**What changed and why.** `SliderOptions.showTicks` and the
`isShowTicks()` / `setShowTicks()` pair were inert: the flag was stored on the
options bag and read back by its own getter, and nothing else ever consulted
it — `doLayout` drew no tick marks, and the accessor's own documentation said
the field was reserved for a follow-up. No caller anywhere set it. Pre-1.0.0,
dead public surface with no callers is cut rather than deprecated.

**Who needs to act.** Any `new Slider({ showTicks: ... })` option, and any
call to `slider.isShowTicks()` or `slider.setShowTicks(...)`, is now a compile
error. There is no replacement — remove the option and the calls; nothing
rendered from them:

```typescript
// Before
const slider = new Slider({ min: 0, max: 100, showTicks: true });
slider.setShowTicks(false);

// After
const slider = new Slider({ min: 0, max: 100 });
```

## `WindowBorder.setDirection` is removed

**What changed and why.** A `WindowBorder` is one edge or corner strip of a
resizable window, and its direction decides both the resize axis it drives and
the resize cursor it shows. The cursor is written once, from the constructor,
and the drag re-reads the same derivation live — the accessor's own
documentation says the two are shared "so the two can never disagree".
`setDirection` broke exactly that: it rewrote the direction and left the hover
cursor pointing at the old axis. Its guard was wrong as well, mapping an
explicit `Direction.NORTH` — enum value `0` — onto a "not supplied" default.
A strip's direction is also structural to its owner: `AbstractWindow` keeps
its eight strips in a named record and switches on each one's direction, so
re-pointing a strip would desynchronise its name from its behaviour. No caller
anywhere set it. Pre-1.0.0, dead public surface with no callers is cut rather
than deprecated.

**Who needs to act.** Any call to `windowBorder.setDirection(...)` is now a
compile error. There is no replacement: choose the direction at construction,
which is the only point it was ever safe to choose it:

```typescript
// Before
const border = new WindowBorder(Direction.NORTH);
border.setDirection(Direction.EAST);

// After
const border = new WindowBorder(Direction.EAST);
```

`getDirection()` is unchanged.

## Mounting is awaited, and `BodyOptions.components` is gone

**What changed and why.** The singleton's construction is what applies the
active theme, injects the bundled Manrope `@font-face` rules and starts the
face loading, so `Body.init` now returns `Promise<Body>` and resolves once
that font is active (or a bounded deadline expires) instead of returning
synchronously. A tree built before it resolves is measured against the
browser's fallback face rather than the theme's, which is why
`BodyOptions.components` is removed — the option let an app build its tree
before the bootstrap had anywhere to send it.

**Who needs to act.** Any `Body.init({ components: [...] })` call is now a
compile error. Await the bootstrap, then add the tree:

```typescript
// Before
const shell = buildAppShell();

Body.init({ layoutManager: Fit(), components: [shell] });

// After
async function main(): Promise<void> {
    const body = await Body.init({ layoutManager: Fit() });

    body.addComponent(buildAppShell());
}

void main();
```

`Body.getInstance()` is unchanged: same signature, does not wait for the font.
A suite that must build its tree before mounting — because it needs the
singleton's theme applied first, not the font — calls it the same way as
before:

```typescript
import { Body } from '@jimka/typescript-ui/core';

// Applies the default theme before the first component exists.
Body.getInstance();
```

## The startup layout gate is removed

The gate that used to hold the first coalesced layout flush until the web
font activated no longer exists — the awaited `Body.init` bootstrap makes it
unnecessary, since nothing is built until the font is already active. The
`0.4.0` migration notes about `flushLayout()` / `resumeLayout()` reading
fallback-font geometry during a held startup window, and about a
programmatic scroll or row reveal issued during that window being replayed
once it opened, no longer apply: there is no window to hold.

## `Checkbox` and `Slider` fire `"action"` for user activations only

**What changed and why.** `on("action", fn)` on a `Checkbox` or a `Slider`
used to fire for every programmatic write as well as for the user's own
activations: `setSelected`, `setValue` and a `Binding` update each announced
it. A checkbox also announced it, with no change of state, for a click on its
label, on the space beside its box, or on a disabled checkbox. Every existing
subscriber wanted the user's activations only — the library's own two each
suppressed the rest by hand — and [`RadioButton`](/components/RadioButton)
and [`ToggleButton`](/components/ToggleButton) already meant exactly that by
the same event name. Now a checkbox fires `"action"` once per user toggle (a
click on its box, or Space), and a slider once per drag sample or value key
that moves the thumb. A programmatic write still fires `"change"` and
`"binding"`.

**Who needs to act.** A consumer that relied on `"action"` after its own
`setSelected` / `setValue`, or after a `Binding` write, subscribes to
`"change"` instead, which fires for the user's toggles and your own writes
alike:

```typescript
// Before
cb.on("action", syncPreview);

// After
cb.on("change", syncPreview);
```

A listener that read the event object sees a DOM `change` event on a checkbox,
where it used to see a `click`. A slider's listener still sees an `input`.

## `DOMSource` gains two members

**What changed and why.** Every text measurement used to go through a hidden
probe appended to `<body>` — `DOMSource.measureText`, `measureTexts` and
`measureTextWidths` — and each read of its rectangle forced a layout of the
whole document. The library now measures a single line of text on a canvas
instead, under the font the probe would resolve, and keeps the probe for what
the canvas cannot reproduce. Its two new reads go through the read seam, like
every other DOM read, so `DOMSource` gains two members:
`getComputedFont(options?)`, which resolves font options on a probe element
exactly as the measurement probes do and returns the computed values of the
properties that decide a text width, as a `ComputedFont`; and
`measureTextAdvance(text, font, spacing)`, which returns a single line's raw
advance width on a canvas under a CSS `font` shorthand, or `null` when it
cannot measure. Both new types, `ComputedFont` and `TextAdvanceSpacing`, are
exported from `@jimka/typescript-ui/core`.

**Who needs to act.** Only code that implements `DOMSource` itself — a custom
source installed through `DOM.install`. `ProductionDOMSource` implements both,
and code that only calls the seam is unaffected. A source that wraps another
forwards both calls. A source that answers from its own model has two choices.
The least it can do is keep every measurement on its probe methods: an empty
computed font is one the canvas cannot reproduce, so the library never asks it
for an advance:

```typescript
import type { ComputedFont, DOMSource, TextAdvanceSpacing, TextMeasureOptions } from '@jimka/typescript-ui/core';

const NO_FONT: ComputedFont = {
    fontFamily: '', fontSize: '', fontWeight: '', fontStyle: '', fontVariantCaps: '',
    fontStretch: '', lineHeight: '', letterSpacing: '', wordSpacing: '', textTransform: '',
    fontFeatureSettings: '', fontVariationSettings: '', fontKerning: '',
    fontVariantLigatures: '', fontVariantNumeric: '', fontVariantEastAsian: '',
    fontSizeAdjust: '', textRendering: '',
};

class MySource implements DOMSource {
    // ...the existing members...

    getComputedFont(_options?: TextMeasureOptions): ComputedFont {
        return NO_FONT;
    }

    measureTextAdvance(_text: string, _font: string, _spacing: TextAdvanceSpacing): number | null {
        return null;
    }
}
```

To measure without a layout as well, read the computed style of an element
styled like your `measureText` probe (`getPropertyValue("font-family")`,
`"font-variant-caps"`, `"letter-spacing"` and so on, one per `ComputedFont`
field, `""` where the engine has none), and measure on a canvas:
`"run"` is one `measureText(text).width` under `font`; `"words"` sums the
width of each space-separated word and of one space per space. Return `null`
whenever the canvas has no 2D context or does not accept `font`.

## A chart redraws only when its plot moves or `scheduleLayout()` runs

**What changed and why.** A settled layout pass — a parent re-laying out a
chart whose size and data are unchanged — used to remove and re-create every
axis, gridline, label and series mark, and to rewrite the SVG surface's size
attributes; it now keeps them and writes nothing to the SVG. The rebuild was
pure cost: a settled 3-series × 50-point line chart rebuilt 210 elements on
every pass.

**Who needs to act.** Only a subclass of `AbstractChart`, `LineChart` or
`BarChart` that changes something the drawing reads without going through a
built-in setter: state of its own that its `buildScales`, `drawSeries`,
`pointPixel` or `seriesColor` reads, or the protected `_series` or
`_selectedPoint` written directly — clearing a selection with
`this._selectedPoint = null`, say. Such a change used to appear on
whatever pass came next; it now appears only when the chart is next resized
or `scheduleLayout()` runs. Call `this.scheduleLayout()` after the change, as
`LineChart.setCurved` does. Calling `doLayout()` directly does not replace it:

```typescript
// Before — the colour change appeared on whatever pass came next
class AlertChart extends LineChart {
    private _alert = false;

    setAlert(alert: boolean): this {
        this._alert = alert;

        return this;
    }

    protected seriesColor(index: number, model: ChartSeriesModel): string {
        return this._alert ? "red" : super.seriesColor(index, model);
    }
}

// After — announce the change, as the built-in setters do
setAlert(alert: boolean): this {
    this._alert = alert;
    this.scheduleLayout();

    return this;
}
```
