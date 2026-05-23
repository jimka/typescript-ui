# Custom Form Controls — Implementation Plan

## Overview

Rebuild four form controls as fully custom, non-native components so the framework owns their visuals, theming, and interaction model end-to-end:

1. **Slider** — replace [`<input type="range">`](../src/typescript/lib/component/input/Slider.ts#L210) with a custom-drawn track + thumb.
2. **Toggle** — net-new on/off switch widget (sliding pill). No existing component; `ToggleButton` ([ToggleButton.ts:25](../src/typescript/lib/component/button/ToggleButton.ts#L25)) is a different concept (a toggle-able push button). Naming choice: `Toggle` — not `Switch` (clashes with the JS `switch` keyword and is hard to alias cleanly) and not `ToggleSwitch` (verbose and almost-overlapping with `ToggleButton`).
3. **Checkbox** — replace [`<input type="checkbox">`](../src/typescript/lib/component/input/Checkbox.ts#L154) with a custom-drawn box + check glyph. Adds `indeterminate` state.
4. **RadioButton** — replace [`<input type="radio">`](../src/typescript/lib/component/input/RadioButton.ts#L189) with a custom-drawn circle + dot, while preserving the existing [`ButtonGroup`](../src/typescript/lib/core/ButtonGroup.ts#L28) wiring so consumers keep their grouping API unchanged.

All four share an architecture (focusable host element, ARIA role, state cache, baseline reporting, change-event API, theme tokens), so they get one plan with a shared section and four per-component sub-sections. The pre-existing `Bindable<T>` contract ([Bindable.ts:21](../src/typescript/lib/core/Bindable.ts#L21)) is preserved on the boolean controls and added to `Toggle` and `Slider`. Existing `RadioButton` consumers use `ButtonGroup.addButton` ([ButtonGroup.ts:114](../src/typescript/lib/core/ButtonGroup.ts#L114)); that path must continue to compile and behave identically, which means keeping `setRadioName`/`getRadioName` available even though the new implementation no longer relies on the browser's native radio grouping.

---

## Architecture Decisions

### No native `<input>` elements

Each control renders the visual as a focusable `<div>` (project convention — one element per class, no `<button>` so we avoid inheriting `<button>`'s default styling and submit-on-Enter quirk inside `<form>`). ARIA role is set per WAI-ARIA Authoring Practices: `slider` / `switch` / `checkbox` / `radio`. `tabindex=0` makes them keyboard-focusable. This unlocks pixel-perfect theming the native input cannot deliver. Trade-off acknowledged: native inputs ship with free screen-reader semantics; custom controls require careful ARIA. Mitigation: implement the full WAI-ARIA pattern for each role (value, state, group, keyboard model) and verify with a screen reader as part of the verification step.

### Single shared `--ts-ui-form-*` token family plus per-control tokens

A shared family (`--ts-ui-form-bg`, `--ts-ui-form-border`, `--ts-ui-form-color`, `--ts-ui-form-disabled-bg`, `--ts-ui-form-disabled-color`, `--ts-ui-focus-ring`) gives the four controls a coherent look across light/dark themes; per-control tokens cover the geometry that is genuinely unique (track widths, thumb sizes, check colour). All tokens live in [`Theme.ts`](../src/typescript/lib/core/Theme.ts) and route through `themeToVars` ([Theme.ts:565](../src/typescript/lib/core/Theme.ts#L565)) so the existing `ThemeManager.setTheme` switch flips them all at once.

### State storage follows the project's options-bag convention

Every control owns its state through `this._options.<field>` (e.g. `_options.value`, `_options.selected`, `_options.indeterminate`) — the same pattern Slider/Checkbox/RadioButton already use today. Typed setters (`setValue`, `setSelected`, `setIndeterminate`) update `_options`, push to the DOM (CSS class or aria attribute), and fire change listeners. This keeps the existing options-cascade in `Component`'s constructor working without special-casing.

### Uniform disabled & readonly surface

All four controls expose `setEnabled(boolean)`/`isEnabled()` and `setReadOnly(boolean)`/`isReadOnly()`. `disabled` removes interactivity (no keyboard, no click, `aria-disabled="true"`, CSS class `disabled` for muted visuals); `readonly` blocks user-driven changes but keeps the control focusable and announce-able (`aria-readonly="true"`, CSS class `readonly`). Disabled also implies `tabindex=-1` so the keyboard skips the control.

### Focus ring uses outline, not box-shadow

Outline avoids layout shift (box-shadow alters the visual box in ways layout tools sometimes catch). The shared `--ts-ui-focus-ring` token holds the outline value. Applied via CSS rule `&:focus-visible { outline: var(--ts-ui-focus-ring); outline-offset: 2px; }` per control. `focus-visible` (not `:focus`) so mouse clicks do not show the ring.

### Baseline alignment via `getBaseline()` override

Per [`baseline-alignment.md`](implemented/baseline-alignment.md), each control overrides `getBaseline()` so HBox lines it up with adjacent `Text`. Strategy: when the control has an inline `Label`, delegate to `this.label.getBaseline()` (same pattern as today's `RadioButton.getBaseline()` at [RadioButton.ts:118](../src/typescript/lib/component/input/RadioButton.ts#L118)). When the control has no label (bare `Checkbox`, bare `Slider`), return `null` so HBox falls back to bottom-edge alignment (matches the current convention for `Slider`/`SpinButton`).

### Animations respect `isReducedMotion()`

`Checkbox` check glyph draws in on toggle via a short CSS transition; `Toggle` thumb slides on toggle; `Slider` thumb does not animate (live drag should feel direct). All animations are gated on `!Animation.isReducedMotion()` ([Animation.ts:70](../src/typescript/lib/core/Animation.ts#L70)) — when reduced motion is set, the visual state flips instantly. The animations use CSS transitions (not the [`Animation`](../src/typescript/lib/core/Animation.ts) helper), since they are simple two-state crossfades that the GPU handles via `transform`/`opacity` for free.

### A11y per WAI-ARIA Authoring Practices

- **Checkbox** — `role=checkbox`, `aria-checked` (`true|false|mixed`). Keyboard: Space toggles.
- **RadioButton** — `role=radio`, `aria-checked` (`true|false`). Keyboard: Space selects. Arrow keys navigate within group via `ButtonGroup` and `RovingTabIndex`.
- **Toggle** — `role=switch`, `aria-checked` (`true|false`). Keyboard: Space / Enter toggle.
- **Slider** — `role=slider`, `aria-valuemin` / `aria-valuemax` / `aria-valuenow` / `aria-orientation` / `aria-valuetext` (optional). Keyboard: ArrowRight/ArrowUp = +step; ArrowLeft/ArrowDown = −step; PageUp = +largeStep; PageDown = −largeStep; Home = min; End = max.

`RadioButton` group navigation reuses the existing `RovingTabIndex` ([RovingTabIndex.ts:21](../src/typescript/lib/core/RovingTabIndex.ts#L21)). Because the new `RadioButton` is no longer a native `<input type=radio>`, the browser will not handle arrow-key navigation for free. `ButtonGroup.setContainer` already wires Left/Right/Up/Down via `Event.addSubtreeListener` ([ButtonGroup.ts:158](../src/typescript/lib/core/ButtonGroup.ts#L158)) — currently only the `ToggleButton` branch invokes this path. Extend `ButtonGroup.addButton` so a `RadioButton` is also registered with `_rovingTabIndex` when a container is set. `setRadioName` is kept as a no-op (or sets a private `_options.radioName` for back-compat reads), since the shared-name attribute no longer drives behaviour.

### Glyph-based check & circle via the existing `Glyph` registry

**Drift note:** `Glyphs.ts` is no longer a hardcoded array — it is a registry with `Glyph.register(...)` entry points, and FA-Free glyphs already live as individual modules under `src/typescript/lib/glyphs/<style>/<name>.ts`. The named exports `check` (from `~/glyphs/solid/check.js`) and `circle` (from `~/glyphs/solid/circle.js`, already a filled circle) already exist. Each control imports the modules it needs and calls `Glyph.register(check)` / `Glyph.register(circle)` at module-load time; this is idempotent. No edit to `Glyphs.ts` itself is required, so it is removed from the shared-file list. Naming-wise: the radio dot is rendered with `new Glyph("circle")` rather than the original plan's `"dot"` since `circle` is already exactly the filled disc we need.

### One-element-per-class

Each control's root is one `<div>` with a small fixed set of child `Component`s (track + thumb, box + glyph, circle + dot, optional label) added via `addComponent`. No raw child `<div>` elements grafted onto `getElement()` — everything is a `Component` so layout, theming, hit-testing, and Bindable wiring stay uniform.

---

## Public API (TypeScript Signatures)

### `Toggle` — new file `src/typescript/lib/component/input/Toggle.ts`

```typescript
export interface ToggleOptions extends ComponentOptions {
    value?:    boolean;   // initial on/off state
    label?:    string | null;
    enabled?:  boolean;
    readOnly?: boolean;
}

class Toggle<TOptions extends ToggleOptions = ToggleOptions>
    extends Component<TOptions>
    implements Bindable<boolean>
{
    constructor(options?: TOptions);

    setValue(v: boolean): this;          // backing field: _options.value
    getValue(): boolean;
    clearValue(): this;                  // resets to false

    setLabel(text: string | null): this; // backing field: _options.label
    getLabel(): string | null;

    setEnabled(v: boolean): this;        // backing field: _options.enabled
    isEnabled(): boolean;

    setReadOnly(v: boolean): this;       // backing field: _options.readOnly
    isReadOnly(): boolean;

    addChangeListener(fn: (v: boolean) => void): this;
    removeChangeListener(fn: (v: boolean) => void): this;

    // Bindable<boolean>:
    addBindingListener(fn: () => void): this;

    // Baseline:
    getBaseline(): number | null;
}
```

### `Slider` — rewrite in place at `src/typescript/lib/component/input/Slider.ts`

```typescript
export interface SliderOptions extends ComponentOptions {
    value?:        number;
    min?:          number;
    max?:          number;
    step?:         number;
    largeStep?:    number;   // PageUp/PageDown increment, default = step * 10
    orientation?:  "horizontal" | "vertical";
    showTicks?:    boolean;
    enabled?:      boolean;
    readOnly?:     boolean;
}

class Slider<TOptions extends SliderOptions = SliderOptions>
    extends Component<TOptions>
    implements Bindable<number>
{
    constructor(options?: TOptions);

    setValue(v: number): this;           // backing field: _options.value
    getValue(): number;

    setMin(v: number): this;             // backing field: _options.min
    getMin(): number;

    setMax(v: number): this;             // backing field: _options.max
    getMax(): number;

    setStep(v: number): this;            // backing field: _options.step
    getStep(): number;

    setLargeStep(v: number): this;       // backing field: _options.largeStep
    getLargeStep(): number;

    setOrientation(o: "horizontal" | "vertical"): this; // backing field: _options.orientation
    getOrientation(): "horizontal" | "vertical";

    setShowTicks(v: boolean): this;      // backing field: _options.showTicks
    isShowTicks(): boolean;

    setEnabled(v: boolean): this;
    isEnabled(): boolean;
    setReadOnly(v: boolean): this;
    isReadOnly(): boolean;

    addChangeListener(fn: (v: number) => void): this;
    removeChangeListener(fn: (v: number) => void): this;

    addBindingListener(fn: () => void): this;
    getBaseline(): number | null;        // returns null (bare slider has no text baseline)
}
```

Note: the existing API uses `minValue`/`maxValue` ([Slider.ts:74-79](../src/typescript/lib/component/input/Slider.ts#L74)). The rewrite renames to `min`/`max` to match HTML and the brief. Keep the old setters as `@deprecated` thin shims that forward to the new ones so existing demos compile during migration — drop the shims in a follow-up cleanup once the demos have been updated.

### `Checkbox` — rewrite in place at `src/typescript/lib/component/input/Checkbox.ts`

```typescript
export interface CheckboxOptions extends ComponentOptions {
    selected?:      boolean;
    value?:         boolean;    // alias for selected, applied after selected
    indeterminate?: boolean;
    label?:         string | null;
    enabled?:       boolean;
    readOnly?:      boolean;
}

class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions>
    extends Component<TOptions>
    implements Bindable<boolean>
{
    constructor(options?: TOptions);

    setSelected(v: boolean): this;            // backing field: _options.selected
    isSelected(): boolean;

    setValue(v: boolean): this;               // alias → setSelected
    getValue(): boolean;

    setIndeterminate(v: boolean): this;       // backing field: _options.indeterminate
    isIndeterminate(): boolean;

    setLabel(text: string | null): this;      // backing field: _options.label
    getLabel(): string | null;

    setEnabled(v: boolean): this;
    isEnabled(): boolean;
    setReadOnly(v: boolean): this;
    isReadOnly(): boolean;

    addChangeListener(fn: (v: boolean) => void): this;
    removeChangeListener(fn: (v: boolean) => void): this;

    // existing alias kept for back-compat with current Checkbox callers:
    addActionListener(listener: Function): this;

    addBindingListener(fn: () => void): this;
    getBaseline(): number | null;
}
```

Back-compat preserved: `setSelected` / `isSelected` / `setValue` / `getValue` / `addActionListener` / `addBindingListener` are all carried forward from the current file ([Checkbox.ts:101](../src/typescript/lib/component/input/Checkbox.ts#L101)) — no consumer change required.

### `RadioButton` — rewrite in place at `src/typescript/lib/component/input/RadioButton.ts`

```typescript
export interface RadioButtonOptions extends ComponentOptions {
    selected?:   boolean;
    value?:      boolean;        // alias for selected
    label?:      string | null;  // replaces `text`
    text?:       string;         // deprecated alias for label
    radioName?:  string;         // back-compat — stored, no longer drives browser grouping
    enabled?:    boolean;
    readOnly?:   boolean;
}

class RadioButton<TOptions extends RadioButtonOptions = RadioButtonOptions>
    extends Component<TOptions>
    implements Bindable<boolean>
{
    constructor(text?: string, options?: TOptions);   // keep positional `text` for back-compat

    setSelected(v: boolean): this;            // backing field: _options.selected
    isSelected(): boolean;

    setValue(v: boolean): this;               // alias → setSelected
    getValue(): boolean;

    setGroup(g: ButtonGroup | null): this;    // backing field: _options.group (transient, not serialised)
    getGroup(): ButtonGroup | null;

    setLabel(text: string | null): this;      // backing field: _options.label
    getLabel(): string | null;

    // Back-compat — kept as a thin shim that stores the name but no longer
    // emits a `name` attribute since the host element is no longer <input>:
    setRadioName(name: string): this;
    getRadioName(): string | null;

    setEnabled(v: boolean): this;
    isEnabled(): boolean;
    setReadOnly(v: boolean): this;
    isReadOnly(): boolean;

    addActionListener(listener: Function): this;          // back-compat (used by ButtonGroup)
    addChangeListener(fn: (selected: boolean) => void): this;
    removeChangeListener(fn: (selected: boolean) => void): this;

    addBindingListener(fn: () => void): this;
    getBaseline(): number | null;                          // delegates to this.label
}
```

`addActionListener` is the existing API surface that `ButtonGroup.addButton` calls into ([ButtonGroup.ts:117](../src/typescript/lib/core/ButtonGroup.ts#L117)); preserving it means the existing group wiring keeps working unchanged.

---

## Theme Tokens

Add to the `Theme` interface ([Theme.ts:17](../src/typescript/lib/core/Theme.ts#L17)) under a new `form` sub-object, plus matching entries in [`DefaultTheme`](../src/typescript/lib/core/Theme.ts#L259), [`DarkTheme`](../src/typescript/lib/core/Theme.ts#L413), and [`themeToVars`](../src/typescript/lib/core/Theme.ts#L565).

### Shared

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-form-bg` | `rgb(255, 255, 255)` | `rgb(40, 40, 40)` | Resting background for box/circle/track. |
| `--ts-ui-form-border` | `rgb(160, 160, 160)` | `rgb(110, 110, 110)` | Border on unchecked/off state. |
| `--ts-ui-form-color` | `rgb(40, 40, 40)` | `rgb(230, 230, 230)` | Foreground (label, glyph fallback). |
| `--ts-ui-form-disabled-bg` | `rgb(240, 240, 240)` | `rgb(60, 60, 60)` | Disabled background. |
| `--ts-ui-form-disabled-color` | `rgb(170, 170, 170)` | `rgb(120, 120, 120)` | Disabled foreground. |
| `--ts-ui-focus-ring` | `2px solid rgb(30, 100, 200)` | `2px solid rgb(120, 170, 240)` | Outline on `:focus-visible`. |

### Toggle

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-toggle-track-bg-off` | `rgb(200, 200, 200)` | `rgb(70, 70, 70)` | Track colour when off. |
| `--ts-ui-toggle-track-bg-on` | `rgb(30, 100, 200)` | `rgb(120, 170, 240)` | Track colour when on. |
| `--ts-ui-toggle-thumb-bg` | `rgb(255, 255, 255)` | `rgb(230, 230, 230)` | Sliding pill colour. |
| `--ts-ui-toggle-width` | `36px` | `36px` | Track width. |
| `--ts-ui-toggle-height` | `20px` | `20px` | Track height. |

### Slider

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-slider-track-bg` | `rgb(220, 220, 220)` | `rgb(70, 70, 70)` | Inactive track colour. |
| `--ts-ui-slider-track-active-bg` | `rgb(30, 100, 200)` | `rgb(120, 170, 240)` | Active (from min to thumb) track colour. |
| `--ts-ui-slider-thumb-bg` | `rgb(255, 255, 255)` | `rgb(230, 230, 230)` | Thumb colour. |
| `--ts-ui-slider-thumb-size` | `16px` | `16px` | Thumb diameter. |
| `--ts-ui-slider-track-thickness` | `4px` | `4px` | Track thickness. |

### Checkbox

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-checkbox-bg` | `var(--ts-ui-form-bg)` | `var(--ts-ui-form-bg)` | Box fill when unchecked. |
| `--ts-ui-checkbox-bg-selected` | `rgb(30, 100, 200)` | `rgb(120, 170, 240)` | Box fill when checked. |
| `--ts-ui-checkbox-check-color` | `rgb(255, 255, 255)` | `rgb(20, 20, 20)` | Check-glyph colour. |
| `--ts-ui-checkbox-size` | `16px` | `16px` | Box width/height. |
| `--ts-ui-checkbox-radius` | `3px` | `3px` | Box corner radius. |

### Radio

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-radio-bg` | `var(--ts-ui-form-bg)` | `var(--ts-ui-form-bg)` | Circle fill when unselected. |
| `--ts-ui-radio-bg-selected` | `rgb(30, 100, 200)` | `rgb(120, 170, 240)` | Circle ring colour when selected. |
| `--ts-ui-radio-dot-color` | `rgb(255, 255, 255)` | `rgb(20, 20, 20)` | Centre dot colour. |
| `--ts-ui-radio-size` | `16px` | `16px` | Circle diameter. |

---

## Internal Structure

Each control's root element is a focusable `<div>` (`tabindex=0`, role per WAI-ARIA pattern) that hosts a small fixed set of child components.

### Toggle

```
<div role="switch" aria-checked aria-readonly tabindex>
  ├── track   (Component, Fit layout)
  │     └── thumb (Component, CSS translateX = on ? track-width - thumb-size : 0)
  └── label   (Text)                              // omitted when label === null
```

CSS transition on `transform` of `.thumb` and `background-color` of `.track`; suppressed when `isReducedMotion()` (drop the `transition` rule conditionally at construction).

### Slider

```
<div role="slider" aria-valuemin aria-valuemax aria-valuenow aria-orientation tabindex>
  ├── track          (Component)
  │     ├── activeTrack (Component, width = (value - min) / (max - min) * 100%)
  │     └── thumb       (Component, transform = translateX(progress%))
  └── ticks          (Component, optional — emits N tick marks when showTicks)
```

Drag handled via `pointerdown` on the root → `setPointerCapture(pointerId)` → `pointermove` updates `value` until `pointerup`. `setPointerCapture` ensures the drag follows the cursor outside the bounds of the track without losing the stream. Keyboard handler reads `event.key` and maps to the WAI-ARIA slider model documented above.

### Checkbox

```
<div role="checkbox" aria-checked tabindex>
  ├── box      (Component, the square; bg flips on selected)
  │     └── glyph (Glyph "check" — opacity 0 when unselected, 1 when selected, animated)
  └── label    (Text)                              // omitted when label === null
```

When `_options.indeterminate === true`, `aria-checked="mixed"`, the box renders a `−` (minus glyph or CSS pseudo-element) instead of the check, and selecting/clearing via user interaction first clears `indeterminate` then flips `selected`.

### RadioButton

```
<div role="radio" aria-checked tabindex>
  ├── circle   (Component, the ring)
  │     └── dot (Component or Glyph "dot" — opacity 0 when unselected, 1 when selected)
  └── label    (Text)
```

`getBaseline()` delegates to `this.label.getBaseline()`, wrapped through `wrapInnerBaseline` (the same idiom as today's RadioButton at [RadioButton.ts:118](../src/typescript/lib/component/input/RadioButton.ts#L118)).

### Private state per control

`_options.value` / `_options.selected` / `_options.indeterminate` per the API. Listeners stored as `private _changeListeners: Array<(v: T) => void> = []` initialised in the constructor body. Setters notify listeners only when the value actually changed (cheap idempotence guard).

---

## Ordered Implementation Steps

### Phase 1 — shared groundwork

1. **Theme tokens.** Edit [`Theme.ts`](../src/typescript/lib/core/Theme.ts) — add a `form` sub-object to the `Theme` interface, populate `DefaultTheme`/`DarkTheme`, and add the matching `--ts-ui-form-*`, `--ts-ui-focus-ring`, and per-control entries to `themeToVars`. **Checkpoint:** `npm run typecheck` is clean.
2. **Aria helpers.** Add `setChecked(value: boolean | "mixed")`, `setOrientation(value: "horizontal" | "vertical")`, and `setReadOnly(value: boolean)` to [`Aria.ts`](../src/typescript/lib/core/Aria.ts) — none exist today and the WAI-ARIA patterns for the four widgets require them. **Drift note:** the plan originally assumed these existed; they don't.
3. **Glyph registration.** Inside each new control's module (or in a shared static-init block), import `check` from `~/glyphs/solid/check.js` and `circle` from `~/glyphs/solid/circle.js` and call `Glyph.register(...)` at module top-level. Both modules already exist; no edits to `Glyphs.ts` are required. **Checkpoint:** `grep -n "Glyph.register" src/typescript/lib/component/input/` finds the new register calls.

### Phase 2 — per control (parallelisable)

4. **Implement `Toggle`** — new file `src/typescript/lib/component/input/Toggle.ts`. Mirror the [`callable()` wrapper export pattern](../src/typescript/lib/component/input/Slider.ts#L220) used by Slider. Wire `setValue`, `setLabel`, `setEnabled`, `setReadOnly`, change listeners, baseline. Reduced-motion gate on the slide transition.
5. **Rewrite `Checkbox`** at [`Checkbox.ts`](../src/typescript/lib/component/input/Checkbox.ts) — replace the `Input`-based implementation with a `Component<TOptions>` subclass containing the box+glyph children and an inline label. Keep the existing public methods (`setSelected`/`isSelected`/`setValue`/`getValue`/`addActionListener`/`addBindingListener`) so `Body`'s [boolean cell renderer](../src/typescript/lib/component/table/cell/Boolean.ts) and other consumers keep compiling. Add `setIndeterminate`/`isIndeterminate`/`setLabel`/`getLabel`/`setReadOnly`/`addChangeListener`.
6. **Rewrite `RadioButton`** at [`RadioButton.ts`](../src/typescript/lib/component/input/RadioButton.ts) — replace the Input+Label composite with a `Component<TOptions>` subclass. Preserve the positional `text` constructor arg, `setRadioName`/`getRadioName` (as no-op-on-DOM shims), and `addActionListener` (used by `ButtonGroup.addButton`). Override `getBaseline()` to delegate to the internal label exactly as today.
7. **Rewrite `Slider`** at [`Slider.ts`](../src/typescript/lib/component/input/Slider.ts) — replace the `<input type=range>` with the track/thumb DOM tree. Add `min`/`max`/`step`/`largeStep`/`orientation`/`showTicks`. Implement pointer-capture drag and the full WAI-ARIA keyboard model. Keep `minValue`/`maxValue` as `@deprecated` shims that forward to `setMin`/`setMax` to keep migration painless.

### Phase 3 — wiring

8. **Group navigation.** Edit [`ButtonGroup.ts`](../src/typescript/lib/core/ButtonGroup.ts#L114): in `addButton`, after the existing `RadioButton`/`ToggleButton` branches, also register `RadioButton` instances with `_rovingTabIndex` when a container is set (currently only `ToggleButton` is registered there at [ButtonGroup.ts:124](../src/typescript/lib/core/ButtonGroup.ts#L124)). Drop the now-unused `setRadioName(this._groupId)` call — replace with a no-op or leave it for back-compat with consumers that read `getRadioName()`.
9. **Re-export `Toggle`.** Edit [`component/input/index.ts`](../src/typescript/lib/component/input/index.ts) — add `export { Toggle }` and `export type { ToggleOptions }` between the existing `RadioButton` and `Slider` entries.
10. **Migrate existing demo screens.** `grep -rln 'new Slider\|new Checkbox\|new RadioButton' src/typescript` (excluding `lib/`) — visit each call site and adjust any renames (`minValue` → `min`, etc.). The deprecated shims should make this a pure-cosmetic pass.
11. **Docs build.** `npm run docs:build` — confirm 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
12. **Graphify update.** `graphify update . --directed`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/Toggle.ts` |
| Modify | `src/typescript/lib/component/input/Slider.ts` |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `src/typescript/lib/component/input/index.ts` (re-export `Toggle`) |
| Modify | `src/typescript/lib/core/Aria.ts` (add `setChecked`, `setOrientation`, `setReadOnly` helpers) |
| Modify | `src/typescript/lib/core/Theme.ts` (form tokens in `Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`) |
| Modify | `src/typescript/lib/core/ButtonGroup.ts` (register `RadioButton` with `_rovingTabIndex`; remove `setRadioName(_groupId)` call) |
| Modify | `docs/component/input/index.md` (catalog entry for new `Toggle`) |
| Create | `docs/component/input/Toggle.md` (curated page) |
| Modify | `docs/component/input/Slider.md` (note API rename + custom-control behaviour) |
| Modify | `docs/component/input/Checkbox.md` (note `indeterminate`, custom-control behaviour) |
| Modify | `docs/component/input/RadioButton.md` (note custom-control behaviour, group via `ButtonGroup`) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry for `Toggle`) |
| Modify | `src/typescript/<demo>/...` — demo screens that instantiate the four controls (one-line API renames from the deprecated shims) |

---

## Verification

- `npm run typecheck` — clean.
- `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- `grep -rn 'input type="range"\|input type="checkbox"\|input type="radio"' src/typescript/lib/` — expect zero matches inside the library.
- `grep -rn 'new Toggle\b' src/typescript/lib/` — at least the new export and any demo usage.
- Open `http://localhost:8015`:
  - **MiscPanel** (or whichever demo hosts these controls). Tab through each control — focus ring shows on Tab, not on click.
  - Slider — drag, arrow keys, PageUp/PageDown, Home/End. Vertical slider works.
  - Checkbox — Space toggles; `setIndeterminate(true)` renders the mixed state; clicking it from mixed goes to checked.
  - RadioButton group — Tab focuses the active member; Arrow keys move within the group; Space selects the focused member; only one member selected at a time.
  - Toggle — Space and Enter both toggle; thumb slides smoothly; reduced-motion disables the slide.
- Light/dark `ThemeManager.setTheme` toggle — all four controls flip visuals atomically.
- VoiceOver / NVDA announces role and state for each control.
- `graphify update . --directed` — completes cleanly.

---

## Documentation Impact

- The per-subpath barrel [`component/input/index.ts`](../src/typescript/lib/component/input/index.ts) gains `Toggle` and `ToggleOptions` exports.
- Curated pages under `docs/component/input/` — add `Toggle.md`; update `Slider.md` / `Checkbox.md` / `RadioButton.md` to mention they are now custom-drawn (theming via `--ts-ui-form-*`, no underlying native input).
- Update `docs/component/input/index.md` (catalog) and the sidebar in `docs/.vitepress/config.mts` to list `Toggle`.
- Cross-bucket JSDoc references (e.g. `ButtonGroup` ↔ `RadioButton`) must use markdown links (`[\`ButtonGroup\`](/api/core/classes/ButtonGroup)`) per [CLAUDE.md](../CLAUDE.md) — the existing `RadioButton` JSDoc already follows this pattern.
- `setMinValue`/`setMaxValue` renamed to `setMin`/`setMax` on `Slider` — the deprecated shims keep the old names callable but should not appear in new docs. `grep -rln '\bsetMinValue\b\|\bsetMaxValue\b' docs/` and update any prose references to point at the new names.

---

## Potential Challenges

- **Screen-reader parity with native inputs.** Custom controls must replicate every state announcement the native input provides for free. Mitigation: pure WAI-ARIA implementation plus an explicit manual smoke test on VoiceOver and NVDA before merge.
- **`ButtonGroup` back-compat.** `ButtonGroup.addButton` calls `button.setRadioName(_groupId)` ([ButtonGroup.ts:122](../src/typescript/lib/core/ButtonGroup.ts#L122)). Once the new RadioButton no longer emits a `name` attribute, this call becomes a no-op. Mitigation: leave `setRadioName` as a stored-only shim and remove the call from `ButtonGroup` in the same commit; existing consumer code that calls `setRadioName` directly continues to compile.
- **Pointer-capture drag for Slider.** `setPointerCapture` is well supported but its lifecycle (release on `pointerup`, `pointercancel`, blur) is easy to get wrong, leading to "stuck drag" bugs. Mitigation: release in all three listeners and add an explicit unit-style verification step in MiscPanel: drag the thumb, alt-tab away, return — expect the slider to be in a clean idle state.
- **Indeterminate `Checkbox`.** Native `<input type=checkbox>` has a property-only `indeterminate` flag with quirky reset semantics; the custom version is simpler but consumers may rely on the native quirk. Mitigation: document the new "user click from mixed → checked" semantics on the `Checkbox.md` page.
- **Baseline alignment math.** With the host element now a `<div>` of fixed CSS height, the inline `Text` label may sit a few pixels below where it did with the native input. Mitigation: align the label with `Fit + AnchorType.CENTER` and verify in HBox rows that also contain a `Text`/`TextInput`. The existing baseline-alignment system handles this once `getBaseline()` is correctly overridden.

---

## Critical Files

- [`Component.ts`](../src/typescript/lib/core/Component.ts) — parent class, `applyOptions` cascade, `getBaseline()`/`wrapInnerBaseline`, `getAria()`.
- [`Aria.ts`](../src/typescript/lib/core/Aria.ts) — `setRole`, `setChecked`, `setValueMin/Max/Now`, `setOrientation`, `setReadOnly`, `setDisabled`. Confirm each setter exists; the `keyboard-navigation.md` plan ([keyboard-navigation.md:54](implemented/keyboard-navigation.md#L54)) added several of these.
- [`Bindable.ts`](../src/typescript/lib/core/Bindable.ts) — the two-way binding contract.
- [`ButtonGroup.ts`](../src/typescript/lib/core/ButtonGroup.ts) — radio group coordinator.
- [`RovingTabIndex.ts`](../src/typescript/lib/core/RovingTabIndex.ts) — keyboard navigation within a group.
- [`Theme.ts`](../src/typescript/lib/core/Theme.ts) — token registration in four places.
- [`Glyphs.ts`](../src/typescript/lib/component/display/Glyphs.ts) — check and dot path data.
- [`Animation.ts`](../src/typescript/lib/core/Animation.ts) — `isReducedMotion()` predicate.
- [`Event.ts`](../src/typescript/lib/core/Event.ts) — `addListener`, `fireEvent`, `addSubtreeListener` (used by `ButtonGroup`).
- [`Callable.ts`](../src/typescript/lib/core/Callable.ts) — the `callable()` wrapper export pattern reused for `Toggle`.
- [`ToggleButton.ts`](../src/typescript/lib/component/button/ToggleButton.ts) — naming sibling, _not_ the same widget. Cite explicitly in `Toggle`'s JSDoc to disambiguate.

---

## Non-Goals

- **`NumberSlider`** — not building a Slider with a built-in numeric readout. Consumers can compose `Slider + Text` in an HBox.
- **`RangeSlider`** — not building a two-thumb range slider. Out of scope; would need its own plan.
- **`TriStateCheckbox`** — not a separate class. The new `Checkbox` carries `indeterminate` natively; tri-state is just `setSelected` + `setIndeterminate`.
- **Renaming to `Switch`.** `Switch` clashes with the JS `switch` keyword and produces awkward callable-wrapper aliases. `Toggle` keeps the noun simple at the cost of mild naming overlap with `ToggleButton`, which the JSDoc disambiguates.
- **Removing the deprecated `minValue`/`maxValue`/`setRadioName` shims in this plan.** They are kept as a single-step migration aid; a follow-up cleanup plan can excise them once all in-repo consumers have moved over.
- **A standalone `Switch` macOS-style component visually distinct from the new `Toggle`.** The new `Toggle` is the one switch widget the framework needs.
