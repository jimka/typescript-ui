# Baseline Alignment for HBox

## Context

When components of different intrinsic heights are placed on the same row (e.g. `<Text><ProgressBar><Text>`, `<Text><RadioButton>`, `<Text><TextField>`), they look misaligned: text labels appear higher than form controls; the radio circle inside `RadioButton` appears higher than its label.

Root cause is in [HBox.ts:215](src/typescript/Base/layout/HBox.ts#L215) and [HBox.ts:247](src/typescript/Base/layout/HBox.ts#L247): every child is placed at the same `y = containerInsets.getTop()`. The framework ignores `verticalAlign` (Component declares `this.verticalAlign = "baseline"` at [Component.ts:196](src/typescript/Base/Component.ts#L196) but `applyStyle` never writes it, and absolute-positioned elements ignore CSS `vertical-align` anyway). So children with different heights end up with their visible content (text glyphs, input contents, progress fill) at different Y positions.

The fix is **baseline alignment**: each component declares an offset from its top to its visual baseline, and HBox stacks children so those baselines coincide. This mirrors how CSS `vertical-align: baseline` works on inline / inline-block elements: text-bearing components return their **font ascent**; non-text components return `null`, meaning "no baseline of my own" — treat the bottom edge of the box as the baseline (CSS replaced-element behavior).

---

## Layout-Manager Audit (only HBox needs changes)

Confirmed by reading every layout's `doLayout`:

| Layout | Direction | Strategy | Baseline relevance |
|---|---|---|---|
| **HBox** | horizontal | preferred widths, preferred heights | **YES — needs change** |
| Column | horizontal | equal widths, **FillType.BOTH** (full height) | No — children stretch to fill row |
| Grid | grid | equal cells, **FillType.BOTH** | No — children stretch |
| Row | vertical | top-to-bottom, FillType.BOTH | Vertical stacking |
| VBox | vertical | top-to-bottom | Vertical stacking |
| Border | named regions | one component per region | No co-placed siblings |
| Card | overlay | one visible child | No siblings |
| Fit | single | one child fills parent | No siblings |
| Split, Tab, Absolute, Accordion | various | structural / panel-level | No mixed-content rows |

Only **HBox** places mixed-height children side-by-side using preferred sizes, so it is the only layout requiring baseline-aware logic.

---

## Component-Coverage Audit

Components that should report a meaningful baseline (everything else inherits the default `null` from `Component`, which means "bottom edge"):

### Tier 1 — base classes (single override covers many descendants)

- **Text** ([Text.ts](src/typescript/Base/component/Text.ts)) — measure font ascent in `calculateSize()`
  - `Label` extends Text → inherits
  - `Legend` extends Text → inherits
- **Input** ([Input.ts](src/typescript/Base/component/Input.ts)) — measure input inner-text ascent
  - `TextInput` → inherits → `TextField`, `TextArea`, `PasswordField`
  - `Checkbox` extends Input → inherits (visual: bottom of checkbox sits on row baseline, conventional)
  - `DateField`, `TimeField` extend Input → inherit

### Tier 2 — composite components (each holds a key Text or Input child; needs an explicit override that delegates)

For each, the formula is `getBaseline() = insets.top + borderTop + keyChild.getBaseline()`. Children with `Fit + AnchorType.CENTER` plus matching preferred heights effectively place the child at `insets.top`, so this is exact in practice. When the key child returns `null`, return `null`.

- **Button** ([Button.ts:52](src/typescript/Base/component/Button.ts#L52)) — `this.text` is the key child
  - `AccordionHeader` extends Button → inherits
  - `ToggleButton` extends Button → inherits
- **ComboBox** ([ComboBox.ts](src/typescript/Base/component/ComboBox.ts)) — internal TextField is the key child
- **NumberSpinner** ([NumberSpinner.ts:49](src/typescript/Base/component/NumberSpinner.ts#L49)) — `this.input` (TextField)
- **AutoCompleteField** ([AutoCompleteField.ts:98](src/typescript/Base/component/AutoCompleteField.ts#L98)) — `this.textField`
- **Header** ([Header.ts:29](src/typescript/Base/component/Header.ts#L29)) — `this.text`
  - `WindowHeader` extends Header → inherits
- **MenuItem** ([MenuItem.ts:154](src/typescript/Base/component/MenuItem.ts#L154)) — `this._titleText`
- **AutoCompleteItem** ([AutoCompleteItem.ts:51](src/typescript/Base/component/AutoCompleteItem.ts#L51)) — `this.textComponent`
- **RadioButton** — internal HBox + label means baseline propagates inside, but as a peer in an outer HBox it should still report a baseline. Override to return `insets.top + borderTop + this.label.getBaseline()`. Apply the same to `Checkbox` if it follows the same internal pattern.

### Tier 3 — leave returning `null` (correct as-is)

- ProgressBar, ProgressSpinner — non-text indicators
- Image, FontAwesomeIcon — graphical
- Slider, SpinButton, TabCloseButton, SplitGutter, DialogBackdrop, WindowBorder — non-text controls
- ListItem, Option — pure containers (text added via `setText` on a child if any; if patterns differ they can be added later as Tier 2)
- BulletedList, NumberedList, FieldSet — vertical containers (never co-placed in HBox visually)

---

## Approach

1. Teach `Component` to expose a baseline (default: `null`).
2. Teach `Text` and `Input` to compute a real baseline from font metrics.
3. Teach Tier-2 composites to delegate to their key child.
4. Teach `HBox` to stack children by baseline.
5. Update `HBox`'s `getPreferredSize` / `getMinSize` / `getMaxSize` so the row reserves enough height above and below the shared baseline.
6. Fall back to today's top-alignment behavior only if **no** child in the row reports a baseline.

---

## Implementation

### [src/typescript/Base/Util.ts](src/typescript/Base/Util.ts)

Extend the existing probe-based pattern at [Util.ts:32-64](src/typescript/Base/Util.ts#L32-L64). Add:

```ts
export interface TextMetrics { width: number; height: number; baseline: number; }
export function measureTextMetrics(text: string, options?: TextMeasureOptions): TextMetrics
```

Implementation: place a 0×0 `inline-block` reference span (`vertical-align: baseline`) inside the same probe; baseline = `refRect.top - probeRect.top`.

Add `measureInputBaseline(): number` analogous to `measureInputHeight()` at [Util.ts:86](src/typescript/Base/Util.ts#L86): build an `<input>` probe wrapping a baseline-reference span, returning the offset from input top to its inner-text baseline. Cache like the existing `scrollBarWidth` if measurement turns out to be hot.

### [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts)

Add a public hook returning `null` by default (no other Component changes):

```ts
getBaseline(): number | null { return null; }
```

### [src/typescript/Base/component/Text.ts](src/typescript/Base/component/Text.ts)

In `calculateSize()` ([Text.ts:105-120](src/typescript/Base/component/Text.ts#L105-L120)), call `Util.measureTextMetrics` and cache `this.baseline`. Override `getBaseline()` to return that cached value. Existing setters that call `calculateSize()` (font family / size / weight / theme change) automatically refresh the baseline. Empty text → baseline `0`.

### [src/typescript/Base/component/Input.ts](src/typescript/Base/component/Input.ts)

Override `getBaseline()` to return `borderTop + paddingTop + Util.measureInputBaseline()`. Borders/insets come from existing `getBorderSize()` / `getInsets()` accessors used elsewhere ([HBox.ts:73-76](src/typescript/Base/layout/HBox.ts#L73-L76)).

### Tier-2 composites (one short override each)

For each component listed in Tier 2, add:

```ts
getBaseline(): number | null {
    const childBaseline = this.<keyChild>.getBaseline();
    if (childBaseline === null) return null;
    return this.getInsets().getTop() + this.getBorderSize().top + childBaseline;
}
```

Adapted in `RadioButton` / `Checkbox` to point at the inner Label or Input depending on which produces the more pleasing visual (verify in step 2 of the verification section below).

### [src/typescript/Base/layout/HBox.ts](src/typescript/Base/layout/HBox.ts)

#### `doLayout()` ([HBox.ts:178-256](src/typescript/Base/layout/HBox.ts#L178-L256))

Replace the single shared `y` with baseline-aware Y computation:

```
// after width/height per child have been decided but before placeComponent:
//   for each child compute effective baseline:
//      b = child.getBaseline(); if b === null then b = chosenHeight (bottom edge)
//   rowBaseline = max(b across children that returned non-null), else null
//   for each child:
//      if rowBaseline !== null:
//          childY = containerInsets.getTop() + (rowBaseline - effectiveBaseline)
//      else:
//          childY = containerInsets.getTop()  // legacy fallback
//   pass childY into placeComponent (x logic unchanged)
```

`placeComponent` with `FillType.BOTH` honors the supplied origin ([LayoutManager.ts:122](src/typescript/Base/layout/LayoutManager.ts#L122)), so no changes needed there.

#### `getPreferredSize()` / `getMinSize()` / `getMaxSize()` ([HBox.ts:67-168](src/typescript/Base/layout/HBox.ts#L67-L168))

Currently row height = `max(child height)`. With baseline alignment, row height = `max(baseline) + max(height − baseline)` over children that reported a baseline; if none, fall back to current `max(height)`. This ensures parents like `RadioButton` get correct outer dimensions.

---

## Reuse Notes

- Use the existing off-screen probe pattern from [Util.measureTextSize](src/typescript/Base/Util.ts#L32) — keeps theme-variable awareness through CSS, no canvas font resolution.
- Use existing `getInsets()` / `getBorderSize()` on Component for the Input + Tier-2 baseline overrides (precedent at [HBox.ts:73-76](src/typescript/Base/layout/HBox.ts#L73-L76)).
- `setElementCSSRule` mechanism stays untouched — baseline is a layout-time concept, not a style-time one.

---

## Verification

1. **Build & type-check**: project build passes with no new TS errors.
2. **Visual smoke test** (build a small demo or extend an existing one):
   - HBox of `Text("Progress:")` + `ProgressBar(50)` + `Text("done")` → bar bottom sits on the labels' text baseline.
   - HBox of `Text("Name:")` + `TextField()` → "Name:" baseline aligns with the input's inner text baseline (typed text matches the label baseline).
   - Standalone `RadioButton("Option")` → radio circle's bottom sits on the label baseline.
   - HBox of `Text("Save:")` + `Button("Save")` → button label baseline matches the outer "Save:" label.
   - HBox of `Text("Pick:")` + `ComboBox` → inner combo text baseline matches the label.
3. **Regression check**: row of only ProgressBars (every child returns `null`) → fallback to top-alignment, no shift from current behavior.
4. **Run existing demo screens** (`AccordionPanel`, `Benchmark`, dialog/menu samples in `src/typescript/Base/`) to spot unintended layout shifts.

---

## Critical Files

- [src/typescript/Base/Util.ts](src/typescript/Base/Util.ts)
- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts)
- [src/typescript/Base/component/Text.ts](src/typescript/Base/component/Text.ts)
- [src/typescript/Base/component/Input.ts](src/typescript/Base/component/Input.ts)
- [src/typescript/Base/component/Button.ts](src/typescript/Base/component/Button.ts)
- [src/typescript/Base/component/ComboBox.ts](src/typescript/Base/component/ComboBox.ts)
- [src/typescript/Base/component/NumberSpinner.ts](src/typescript/Base/component/NumberSpinner.ts)
- [src/typescript/Base/component/AutoCompleteField.ts](src/typescript/Base/component/AutoCompleteField.ts)
- [src/typescript/Base/component/Header.ts](src/typescript/Base/component/Header.ts)
- [src/typescript/Base/component/MenuItem.ts](src/typescript/Base/component/MenuItem.ts)
- [src/typescript/Base/component/AutoCompleteItem.ts](src/typescript/Base/component/AutoCompleteItem.ts)
- [src/typescript/Base/component/RadioButton.ts](src/typescript/Base/component/RadioButton.ts)
- [src/typescript/Base/component/Checkbox.ts](src/typescript/Base/component/Checkbox.ts)
- [src/typescript/Base/layout/HBox.ts](src/typescript/Base/layout/HBox.ts)
- [src/typescript/Base/layout/LayoutManager.ts](src/typescript/Base/layout/LayoutManager.ts) (read-only reference)
