# NumberSpinner Component — Implementation Plan

## Overview

`NumberSpinner` is a composite component presenting a numeric text input with flanking increment/decrement spin buttons. It integrates with the binding system (`Bindable<number>`) and follows established framework patterns: CSS-rule-based theming, `Event` namespace for DOM routing, `ThemeManager` for theme-change callbacks, `HBox`/`VBox` layout composition.

---

## Architecture Decisions

### `SpinButton extends Button` (not `Component`)

`Button` already provides pressed-state CSS rule (`:active`), `addActionListener`, `setCursor("pointer")`, border/shadow/background gradient, and the internal `Label`. Extending it means `SpinButton` inherits all that for free and only needs to override sizing and the hold-repeat gesture layer.

### `NumberSpinner extends Component` (not a container class)

`NumberSpinner` is itself the outermost container. It owns an `HBox` layout manager, an internal `TextField` instance, and a `Component` acting as a VBox container for the two `SpinButton` instances.

### Internal text input is a `TextField` instance (not a subclass)

`NumberSpinner` instantiates `TextField` and holds it as `private input: TextField`. This avoids an awkward `super.render()` chain and lets `NumberSpinner` compose children in its own constructor.

### Hold-repeat via recursive `setTimeout` (not `setInterval`)

`setInterval` cannot adjust its period mid-flight. Recursive `setTimeout` matches the spec (initial 400 ms, ×0.75 per tick, floor 40 ms) and is cancellable with a single `clearTimeout`.

### `applyValue()` as the single commit point

All mutations (click, hold-repeat, keyboard arrow, blur) funnel through one private method. This eliminates divergent code paths and guarantees clamping, step-snapping, DOM update, and event firing always happen together.

### Blur behaviour: revert-on-invalid

On blur, parse the raw text. If `isNaN`, revert display to `this.value` (last committed number). If valid, call `applyValue()`.

### `setValue()` is silent (no binding listener fire)

`setValue()` is the programmatic path from `Binding`. Firing listeners would create a write-back loop. Only user-driven `applyValue()` calls fire binding listeners.

---

## Public API (TypeScript Signatures)

### `SpinButton`

```typescript
export class SpinButton extends Button {
    constructor(symbol: "▲" | "▼");

    /** Register a callback that fires on each logical "tick" (click or hold-repeat). */
    addTickListener(listener: () => void): void;

    /** Cancel any in-progress hold-repeat. Called by NumberSpinner on mouseup. */
    cancelRepeat(): void;
}
```

### `NumberSpinner`

```typescript
export class NumberSpinner extends Component implements Bindable<number> {
    constructor();

    // Bindable<number>
    getValue(): number;
    setValue(n: number): void;
    addBindingListener(fn: () => void): void;

    // Configuration
    setMin(n: number): void;
    getMin(): number;
    setMax(n: number): void;
    getMax(): number;
    setStep(n: number): void;
    getStep(): number;
    setPrecision(decimals: number): void;
    getPrecision(): number;

    // State
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;

    // Events
    addChangeListener(listener: (value: number) => void): void;
}
```

---

## Theme Tokens

Two new tokens; all existing `--ts-ui-button-*` tokens cover `SpinButton`'s appearance.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-spinner-btn-width` | `18px` | `18px` | Width of SpinButton strip |
| `--ts-ui-spinner-divider` | `rgb(180, 180, 180)` | `rgb(80, 80, 80)` | 1px border between ▲ and ▼ |

Add to `Theme.ts` under a new `spinner` sub-object, `DefaultTheme`, `DarkTheme`, and `themeToVars()`.

---

## Ordered Implementation Steps

### Step 1 — Add theme tokens to `Theme.ts`

Add `spinner: { buttonWidth: string; dividerColor: string; }` to `Theme` interface. Add values to `DefaultTheme` and `DarkTheme`. Wire into `themeToVars()`.

### Step 2 — Create `SpinButton.ts`

`Base/component/SpinButton.ts`

1. `super(symbol)` where symbol is `"▲"` or `"▼"`.
2. Size: `setPreferredSize(18, h/2)` and `setMaxSize(18, h/2)` where `h = Input.measureNativeHeight()`. Subscribe `ThemeManager.onThemeChange` to recalculate.
3. Remove shadow, `setBorderRadius("0")`.
4. `setFontSize("9px")` on inner label for small glyphs.
5. Add `private tickListeners: Array<() => void> = []`.
6. Add `private repeatHandle: ReturnType<typeof setTimeout> | null = null`.
7. Add `private repeatDelay: number = 400`.
8. Register `"mousedown"` via `Event.addListener(this, "mousedown", () => this.onMouseDown())`.
9. Register `"mouseup"` and `"mouseleave"` via `Event.addViewportListener`.
10. `onMouseDown()`: fire all tick listeners immediately (first tick), then call `scheduleNext()`.
11. `scheduleNext()`:
    ```typescript
    this.repeatHandle = setTimeout(() => {
        this.tickListeners.forEach(fn => fn());
        this.repeatDelay = Math.max(40, this.repeatDelay * 0.75);
        this.scheduleNext();
    }, this.repeatDelay);
    ```
12. `cancelRepeat()`: `clearTimeout(this.repeatHandle)`, reset `this.repeatDelay = 400`.
13. `onMouseUp()` / `onMouseLeave()`: call `cancelRepeat()` (guard: only if `repeatHandle !== null`).

### Step 3 — Create `NumberSpinner.ts`

`Base/component/NumberSpinner.ts`

**Construction:**

1. `super()`.
2. Init private state: `value = 0`, `min = -Infinity`, `max = Infinity`, `step = 1`, `precision = null`, `bindingListeners = []`, `enabled = true`.
3. Create `this.input = new TextField()`.
   - `input.setTextAlign("right")`.
   - Remove input's border (it's borderless inside the composite).
   - `input.setText(this.formatValue(0))`.
4. Create `this.upBtn = new SpinButton("▲")`.
5. Create `this.downBtn = new SpinButton("▼")`.
   - Bottom button: apply `--ts-ui-spinner-divider` top border.
6. Create `this.btnBox = new Component()`.
   - `btnBox.setLayoutManager(new VBox())` with `setComponentSpacing(0)`.
   - `btnBox.setInsets(new Insets(0, 0, 0, 0))`.
   - `btnBox.addComponent(this.upBtn)`.
   - `btnBox.addComponent(this.downBtn)`.
7. `this.setLayoutManager(new HBox())` with `setComponentSpacing(0)`.
8. `this.setInsets(new Insets(0, 0, 0, 0))`.
9. `this.addComponent(this.input)`.
10. `this.addComponent(this.btnBox)`.
11. Wire tick listeners:
    ```typescript
    this.upBtn.addTickListener(() => this.applyValue(this.value + this.step));
    this.downBtn.addTickListener(() => this.applyValue(this.value - this.step));
    ```
12. Wire blur: `Event.addListener(this.input, "blur", () => this.onBlur())`.
13. Wire keyboard: `Event.addListener(this.input, "keydown", (e: KeyboardEvent) => this.onKeyDown(e))`.
14. Set composite border on `this`.
15. Set `setBorderRadius("var(--ts-ui-border-radius, 4px)")` on `this`.
16. Set preferred height via `Input.measureNativeHeight()`.
17. Set ARIA: `input.setElementAttribute("role", "spinbutton")`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.

**`applyValue(n: number): void`:**
```typescript
private applyValue(n: number): void {
    if (!this._enabled) { return; }
    n = Math.min(this.max, Math.max(this.min, n));
    n = Math.round(n / this.step) * this.step;
    n = parseFloat(n.toFixed(this.derivePrecision()));
    if (n === this.value) { return; }
    this.value = n;
    this.input.setText(this.formatValue(n));
    this.input.setElementAttribute("aria-valuenow", String(n));
    Event.fireEvent(this, "change", { detail: n });
    this.bindingListeners.forEach(fn => fn());
}
```

**`_setValueSilent(n: number): void` (private):**
Clamp, snap, format, DOM update — no event, no listener fire. Used by `setValue()`.

**`onBlur(): void`:**
```typescript
private onBlur(): void {
    const parsed = parseFloat(this.input.getText());
    if (isNaN(parsed)) {
        this.input.setText(this.formatValue(this.value));
        return;
    }
    this.applyValue(parsed);
}
```

**`onKeyDown(e: KeyboardEvent): void`:**
```typescript
private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp')   { e.preventDefault(); this.applyValue(this.value + this.step); }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.applyValue(this.value - this.step); }
    if (e.key === 'Enter')     { this.onBlur(); }
}
```

**`formatValue(n: number): string`:** `n.toFixed(this.derivePrecision())`.

**`derivePrecision(): number`:** If `this.precision !== null`, return it. Otherwise count decimal places in `String(this.step)`.

**`setEnabled(enabled: boolean): void`:**
- `_enabled = enabled`.
- If false: `input.setElementAttribute("disabled", "true")`, `upBtn.setPointerEvents("none")`, `downBtn.setPointerEvents("none")`, set opacity 0.5.
- If true: reverse above.

**Bindable implementation:**
- `getValue()`: return `this.value`.
- `setValue(n)`: call `this._setValueSilent(n)`.
- `addBindingListener(fn)`: push to `this.bindingListeners`.

**ARIA min/max update:** In `setMin(n)` and `setMax(n)`, update `aria-valuemin`/`aria-valuemax` attributes (omit if ±Infinity).

### Step 4 — Export from `index.ts`

In "Components — text and input" section:

```typescript
export { NumberSpinner } from './component/NumberSpinner.js';
export { SpinButton }    from './component/SpinButton.js';
```

---

## Potential Challenges

**Floating-point step drift**: `toFixed(derivePrecision())` re-quantises to display precision, eliminating visible drift for any step expressible as a finite decimal. For irrational steps, callers set `setPrecision()` explicitly.

**HBox spacing**: default is 5 px. Must call `hbox.setComponentSpacing(0)` to flush input and button strip.

**VBox spacing for two SpinButtons**: same — `vbox.setComponentSpacing(0)`.

**VBox height calculation**: use `Math.floor(h/2)` for top button, `h - Math.floor(h/2)` for bottom to guarantee exact sum.

**Blur fires on spin button click**: when user clicks a spin button, the text input blurs before the button's `mousedown`. Blur validation runs first (normalises display), then button tick fires. Sequence is correct and harmless.

**`Input.measureNativeHeight()` import**: `SpinButton` extends `Button` (not `Input`). Import and call `Input.measureNativeHeight()` statically.

**ARIA `aria-valuemin`/`aria-valuemax`**: must be finite numbers per ARIA spec. If `min === -Infinity`, omit the attribute.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/component/SpinButton.ts` |
| Create | `Base/component/NumberSpinner.ts` |
| Modify | `Base/Theme.ts` |
| Modify | `Base/index.ts` |

---

## Critical Files

- `src/typescript/Base/component/Button.ts`
- `src/typescript/Base/component/TextField.ts`
- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/index.ts`
- `src/typescript/Base/Event.ts`
