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

## `List`, `MultiSelectList` and `ComboBox` fire `"action"` for user selections only

**What changed and why.** These were the last controls whose `"action"` still
announced a programmatic write, and they got there by two different routes.
`List` and `MultiSelectList` share one `setSelectedIndex`, whose notifying
default path ended by dispatching the DOM `change` that `on("action", fn)`
wraps — so a rendered list announced your own write as if the user had made
it (an unrendered one did not, since that dispatch was already skipped
without an element). `ComboBox` differed in kind: its `"action"` was not a DOM
shorthand at all, but a plain alias of the inherited listener-bag `"change"`,
so it announced every `setSelectedIndex(idx)` whether or not the combo box was
rendered, and it was the one control in the family whose listener received a
value rather than an event. Both now mean what
[`RadioButton`](/components/RadioButton) and
[`ToggleButton`](/components/ToggleButton) already meant by the name, and what
`Checkbox` and `Slider` come to mean in this same release: `"action"` fires
from the click and keyboard commit paths only, and `ComboBox`'s is a DOM
`change` shorthand like its siblings'. A
programmatic `setSelectedIndex(idx)` still fires `"change"` and `"binding"`;
`setValue` and `setValues` stay silent on all three events, as before.

**Who needs to act.** A consumer that relied on `"action"` after its own
`setSelectedIndex` subscribes to `"change"` instead, which fires for the
user's selections and your own index writes alike:

```typescript
// Before
list.on("action", syncDetail);

// After
list.on("change", syncDetail);
```

A `ComboBox` `"action"` listener that used its argument reads
`combo.getValue()` instead:

```typescript
// Before
combo.on("action", (value: string) => status("Zoom " + value));

// After
combo.on("action", () => status("Zoom " + combo.getValue()));
```

**The compiler will not find these for you.** The overload's listener type is
`Event.Listener`, whose parameter is `any`, so a listener still declared
`(value: string) => …` type-checks exactly as before and silently receives a
`CustomEvent` at runtime. Grep your combo boxes for `on("action"` and check
each listener's parameter by hand. A listener that takes no parameter — the
common shape — needs no change at all.

**Match `off` to the name you registered with.** On a `ComboBox` the two names
used to share one listener bag, and `off` substituted `"change"` for
`"action"` exactly as `on` did, so either name removed a listener registered
under the other. They are now separate registries — `"action"` a DOM
registration, `"change"` the inherited bag — and a crossed pair removes
nothing, throws nothing, and leaves the listener attached for the life of the
component.

```typescript
// Before: either of these detached the listener
combo.on("change", fn);  combo.off("action", fn);
combo.on("action", fn);  combo.off("change", fn);

// After: each name detaches only its own registration
combo.on("change", fn);  combo.off("change", fn);
combo.on("action", fn);  combo.off("action", fn);
```

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

## A `Panel` re-committed at its own rectangle is not re-laid-out

**What changed and why.** Committing a child's rectangle and recursing into
its own layout pass are two separate steps, and the second is withheld when
the first moved nothing and the child's class opted in — see
[the write is diffed](/concepts/layout-system#the-write-is-diffed).
[`Panel`](/api/core/classes/Panel) now opts in, alongside
[`LabeledGrid`](/api/component/container/classes/LabeledGrid),
[`Header`](/api/component/display/classes/Header),
[`StatusBar`](/api/component/container/classes/StatusBar) and the two bars
that opted in before them. Measured across the render-review cells, a settled
pass over a shell stopped re-laying out between 72% and 100% of the subtree it
used to walk.

The opt-in is on `Panel` exactly, by prototype identity rather than
`instanceof`, so `ScrollStrip`, `Form`, `AbstractChart`, `DiagramView`,
`MarkdownViewer`, `FloatingPanel` and every consumer subclass of `Panel` keep
being laid out on every commit until each is audited on its own. A subclass
that wants the skip overrides the protected gate after that audit.

Every placement input the library owns announces itself, so a change made
through the public API is never lost: adding, removing or moving a child, the
panel's insets, padding, border, scroll settings, layout manager and its
configuration setters, a child's `setDisplayed` or layout constraints, a
`Text` descendant's text or font, and a theme or web-font swap all either lay
the panel out or mark its pass as owed.

**Who needs to act.** Code that changes a component's intrinsic size inside a
plain `Panel` without telling the framework — a component that re-renders its
own DOM or draws to its own canvas, and neither calls `setPreferredSize` nor
`notifyIntrinsicSizeChanged` — and relied on some later, unrelated layout pass
to pick the new size up. That pass no longer reaches a panel whose rectangle
holds still. Announce the change instead:

```typescript
// Before — the new size appeared on whatever pass came next
class Sparkline extends Component {
    setSamples(samples: number[]): this {
        this.renderOwnCanvas(samples);   // the canvas is now 40px taller

        return this;
    }
}

// After — announce the change, so every opted-in ancestor re-flows it
setSamples(samples: number[]): this {
    this.renderOwnCanvas(samples);
    this.notifyIntrinsicSizeChanged();

    return this;
}
```

`scheduleLayout()` on the component works too, and is the right call when the
component's own children need re-placing rather than its size re-measuring.

### The form controls opt in too

**What changed and why.** The same skip now covers the classes a form's fields
are built from:
[`Text`](/api/component/input/classes/Text) itself and
[`TextField`](/api/component/input/classes/TextField) itself — by prototype
identity, as with `Panel`, so every library subclass of either is unaffected —
plus [`ComboBox`](/api/component/input/classes/ComboBox),
[`DateField`](/api/component/input/classes/DateField),
[`TimeField`](/api/component/input/classes/TimeField),
[`NumberSpinner`](/api/component/input/classes/NumberSpinner),
[`Checkbox`](/api/component/input/classes/Checkbox),
[`Toggle`](/api/component/input/classes/Toggle),
[`Slider`](/api/component/input/classes/Slider) and
[`FieldDecorator`](/api/validation/classes/FieldDecorator).

This reaches further than the container opt-ins did, because the skip is
decided one child at a time: a field grid that must lay out — which, in a form,
it usually must — still withholds every opted-in field it hands an unchanged
rectangle. Two library changes come with it. `LayoutManager.commitBounds` now
reads "the rectangle changed" from the child's committed box before versus
after the write rather than from the request, so a control whose own size
ceiling clamps a stretched cell no longer reports a move on every pass; and
`Slider.doLayout` now opens with `super.doLayout()`, which is what records that
a pass ran. A consumer subclass of `Slider` that overrides `doLayout` must keep
that call.

**Who needs to act.** The same case as above, one level down: code that changes
a *field's* intrinsic size from outside the library — writing to the inner
`<input>` directly, swapping a glyph by hand, drawing into a control's own
element — without calling `setPreferredSize` or `notifyIntrinsicSizeChanged`,
and relying on an unrelated later pass to pick it up. That pass no longer
reaches a field whose rectangle holds still; announce the change, or call
`scheduleLayout()` on the field.

## `Event.init` is removed

**What changed and why.** `Event.init()` initialised nothing — the event
system installs its single window-level capture listener on the first
registration of each event type, so there has never been anything for a
bootstrap call to do, and the function's own documentation said it was a
no-op. Nothing in the library, and no consumer anywhere, ever called it.
Pre-1.0.0, dead public surface with no callers is cut rather than deprecated.

**Who needs to act.** Any `Event.init()` call is now a compile error. There is
no replacement — delete the line; nothing happened when it ran:

```typescript
// Before
Event.init();

const body = await Body.init({ layoutManager: Fit() });

// After
const body = await Body.init({ layoutManager: Fit() });
```

## The absolute time form is read back exactly as it is written

**What changed and why.** `TimeField` and the table's time cell editor each
read the absolute time form with their own loose check: `TimeField` split the
text on `:` and handed each piece to `Number`, and the time cell editor did
the same with only an `isNaN` guard and no range check at all. `Number`
accepts far more than the `H:MM[:SS]` the fields format, so both accepted an
exponent or hex form (`1e1:30`, `0x9:30`), a fractional hour or minute
(`9.5:30`), a sign (`+9:30`), a leftover fourth part (`9:30:00:99`), a
trailing separator (`09:30:`), a missing hour (`:30`) and a three-digit hour
(`009:30`), and both truncated a fractional second (`05.5`) rather than
rejecting it. `DateTimeField` and the date-time cell editor already rejected
each of those malformed forms, because each built a single date-time string
and handed it to `new Date`, which rejects a malformed time half outright —
but they kept a fractional second rather than truncating it.

This release consolidates all four onto one anchored `H:MM[:SS]` grammar for
the time half: one or two digits per part, seconds optional and defaulting to
`0`. All four now reject a fractional second, and `TimeField` and the time
cell editor also reject each of the malformed forms above, plus surrounding
whitespace. Whitespace is the one place the two date-time components differ:
`DateTimeField` trimmed the whole typed string before splitting it and still
does, so it is unaffected, while the date-time cell editor had no trim of its
own and no longer rejects text with surrounding or doubled whitespace.

**Who needs to act.** The shared time parsing only runs on text a person
types or pastes into one of these four components' input — a `Binding` writes through
`setValue`, which formats rather than parses, and a store `time` or
`datetime` column reads with `new Date(...)`, so neither ever reaches it.
Code that types or pastes one of these forms into `TimeField`,
`DateTimeField`, or the table's time/date-time cell editor — most likely a
UI test driving the field programmatically — should use the form the
component itself would produce instead:

| Was accepted | Write instead |
|---|---|
| `" 9:30"` | `"9:30"` — trim first |
| `"09:30:00.000"` | `"09:30:00"` — drop the fractional part |
| `":30"` | `"0:30"` — name the hour |
| `"+9:30"` | `"9:30"` — drop the sign |
| `"9:30:00:99"` | `"9:30:00"` — at most three parts |
