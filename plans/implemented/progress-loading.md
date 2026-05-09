# Progress and Loading Indicators — Implementation Plan

## Overview

This plan covers two new components (`ProgressBar` and `Spinner`), the CSS keyframe animation infrastructure they need, new theme tokens, and the wiring of `AbstractStore` and `Table`/`TablePanel` to a loading state that automatically shows/hides a `Spinner` overlay.

---

## New Files to Create

### `Base/component/ProgressBar.ts`

A normal `Component` subclass. Contains two child `Component` instances: a track (the full-width background rail) and a fill (the coloured bar that grows or shrinks). Indeterminate mode uses a CSS keyframe animation injected once at module-load time via `CSS.ensureKeyframes` (see CSS section below).

### `Base/component/Spinner.ts`

A `Component` subclass whose element is styled as a rotating arc using `border-radius: 50%` and a `border` where one side is transparent. Rotation is driven by a CSS keyframe injected once at module-load time. Supports both inline use (sized and positioned normally) and overlay use (absolute, fills parent, includes a semi-transparent backdrop).

---

## Existing Files to Modify

| File | Change |
|---|---|
| `Base/CSS.ts` | Add `ensureKeyframes(name, body)` exported function |
| `Base/Theme.ts` | Add `progressBar` and `spinner` sections to `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars` |
| `Base/data/AbstractStore.ts` | Add `loading` state flag, `isLoading()` getter, `'loadingchanged'` event |
| `Base/component/table/TablePanel.ts` | Subscribe to `'loadingchanged'` and show/hide a `Spinner` overlay |
| `Base/index.ts` | Export `ProgressBar` and `Spinner` |

---

## Full Proposed Public API

### `ProgressBar`

```typescript
export class ProgressBar extends Component {
    /**
     * Constructs a ProgressBar.
     *
     * @param value - Initial progress value in [0, 100]. Defaults to 0.
     * @param indeterminate - When true the bar animates continuously and value is ignored.
     */
    constructor(value?: number, indeterminate?: boolean);

    /**
     * Returns the current progress value (0–100).
     *
     * @returns The current percentage, or 0 when indeterminate.
     */
    getValue(): number;

    /**
     * Sets the progress value and updates the fill width. Clamps to [0, 100].
     * Has no visual effect while in indeterminate mode.
     *
     * @param value - Progress percentage in [0, 100].
     */
    setValue(value: number): void;

    /**
     * Returns whether the bar is in indeterminate (animated) mode.
     *
     * @returns True if indeterminate mode is active.
     */
    isIndeterminate(): boolean;

    /**
     * Activates or deactivates indeterminate animation mode.
     *
     * @param value - True to activate indeterminate mode.
     */
    setIndeterminate(value: boolean): void;

    /**
     * Lays out the track and fill child components.
     */
    doLayout(): void;
}
```

Internal structure: two child `Component` objects — `track` fills the component bounds; `fill` is a child of `track` with width driven by `value / 100 * trackWidth`.

### `Spinner`

```typescript
export class Spinner extends Component {
    /**
     * Constructs a Spinner.
     *
     * @param size - Diameter in pixels. Defaults to 32.
     */
    constructor(size?: number);

    /**
     * Returns the spinner diameter in pixels.
     *
     * @returns The diameter.
     */
    getSize(): number;

    /**
     * Sets a new diameter and updates the component dimensions and border-radius.
     *
     * @param size - Diameter in pixels.
     */
    setSpinnerSize(size: number): void;

    /**
     * Mounts this Spinner as an absolute overlay covering the given component.
     * Sized to the target's full bounds, added as a child of the target component.
     * A semi-transparent backdrop fills the overlay; the spinning arc is centred inside it.
     * No-op if already shown as an overlay.
     *
     * @param target - The component to overlay.
     */
    showOverlay(target: Component): void;

    /**
     * Removes the overlay from its parent and resets state.
     * No-op if not currently shown as an overlay.
     */
    hideOverlay(): void;

    /**
     * Returns whether the spinner is currently mounted as an overlay.
     *
     * @returns True if showOverlay has been called and hideOverlay has not.
     */
    isOverlay(): boolean;

    /**
     * Lays out the inner arc element at the centre of the component bounds.
     */
    doLayout(): void;
}
```

Internal structure: the outer `Component` (overlay container or inline element) holds a single inner `Component` — the spinning arc — which is absolutely positioned with `border-radius: 50%`, a 3–4 px border where three sides use the theme accent colour and one side is transparent, and the CSS `animation` property pointing at the shared keyframe rule.

### `AbstractStore` loading state additions

```typescript
// StoreEvent union extended:
export type StoreEvent =
    'load' | 'datachanged' | 'add' | 'remove' |
    'beforesync' | 'sync' | 'loadingchanged';   // NEW

// New public method on AbstractStore:

/**
 * Returns whether the store is currently loading data.
 *
 * @returns True while load() is in-flight.
 */
isLoading(): boolean;
```

The `load()` method gains:
- `this.setLoading(true)` before the `await`.
- `this.setLoading(false)` in a `finally` block so errors still clear the flag.

`setLoading(value: boolean)` is a private helper that sets `this._loading` and fires `'loadingchanged'` only when the value actually changes.

### `TablePanel` overlay wiring

In the `TablePanel` constructor, after constructing `this.table`:
- Create `private _spinner: Spinner` (lazy, instantiated once).
- Subscribe: `store.on('loadingchanged', ({ loading }) => { loading ? this._spinner.showOverlay(this.table) : this._spinner.hideOverlay(); })`.

No layout changes needed — the overlay sizes itself to the table on each `showOverlay` call.

---

## CSS Keyframe Animations

`CSS.createRule` and `CSS.getRule` work on selector-based `CSSStyleRule` objects and do not support `@keyframes`. Add one new exported function to `CSS.ts`:

```typescript
/**
 * Inserts a @keyframes block into the "Base" stylesheet if a rule with the
 * given name does not already exist.
 *
 * @param name - The keyframe animation name (no @keyframes prefix).
 * @param body - The keyframe body, e.g. "from { transform: rotate(0deg) } to { transform: rotate(360deg) }".
 */
export function ensureKeyframes(name: string, body: string): void;
```

Implementation: iterate `sheet.cssRules` looking for a `CSSKeyframesRule` whose `name` matches; if absent, call `sheet.insertRule('@keyframes ' + name + ' { ' + body + ' }', sheet.cssRules.length)`. All dynamic CSS stays in the single `<style id="Base">` sheet, consistent with how component rules work.

**Keyframe definitions:**

`ProgressBar` indeterminate — name `ts-ui-progress-indeterminate`:
```
0%   { transform: translateX(-100%); }
100% { transform: translateX(400%); }
```
Applied to the fill element: `animation: ts-ui-progress-indeterminate 1.4s ease-in-out infinite`.

`Spinner` rotation — name `ts-ui-spinner-rotate`:
```
from { transform: rotate(0deg); }
to   { transform: rotate(360deg); }
```
Applied to the arc element: `animation: ts-ui-spinner-rotate 0.8s linear infinite`.

Both `ensureKeyframes` calls happen at module-level (executed once on import), so animations are registered exactly once regardless of how many instances are created.

---

## Theme Tokens

### New entries in the `Theme` interface

```typescript
progressBar: {
    track: {
        background  : string;
        borderRadius: string;
    };
    fill: {
        background: string;
    };
    indeterminate: {
        background: string;
    };
};

spinner: {
    color   : string;   // arc's visible border colour
    backdrop: string;   // semi-transparent overlay background
    size    : string;   // default diameter, used as a CSS length
};
```

### `DefaultTheme` values

```typescript
progressBar: {
    track: { background: 'rgb(220, 220, 220)', borderRadius: '4px' },
    fill:  { background: 'rgb(30, 100, 200)' },
    indeterminate: { background: 'rgb(30, 100, 200)' },
},
spinner: {
    color:    'rgb(30, 100, 200)',
    backdrop: 'rgba(255, 255, 255, 0.6)',
    size:     '32px',
},
```

### `DarkTheme` values

```typescript
progressBar: {
    track: { background: 'rgb(55, 55, 55)', borderRadius: '4px' },
    fill:  { background: 'rgb(60, 130, 220)' },
    indeterminate: { background: 'rgb(60, 130, 220)' },
},
spinner: {
    color:    'rgb(60, 130, 220)',
    backdrop: 'rgba(20, 20, 20, 0.6)',
    size:     '32px',
},
```

### CSS variable names added to `themeToVars`

```
'--ts-ui-progress-track-bg'         : theme.progressBar.track.background
'--ts-ui-progress-track-radius'     : theme.progressBar.track.borderRadius
'--ts-ui-progress-fill-bg'          : theme.progressBar.fill.background
'--ts-ui-progress-indeterminate-bg' : theme.progressBar.indeterminate.background
'--ts-ui-spinner-color'             : theme.spinner.color
'--ts-ui-spinner-backdrop'          : theme.spinner.backdrop
'--ts-ui-spinner-size'              : theme.spinner.size
```

---

## Key Design Decisions and Tradeoffs

**Single DOM element vs. child components for `Spinner`**
The spinning arc is a child `Component` of the spinner container. This keeps the overlay container free to fill the parent (via `Position.ABSOLUTE` + full width/height) while the arc sits centred inside it. One element doing both would require pseudo-elements (`::before`/`::after`), which the framework never uses.

**Overlay via `addComponent` / `removeComponent`**
`showOverlay` calls `target.addComponent(this)` rather than appending a raw `<div>`. This keeps the component tree coherent and ensures `doLayout` calls propagate correctly. The spinner temporarily appears in the target's `getComponents()` list — only `TablePanel` uses this path.

**`loadingchanged` event on `AbstractStore`**
Adding the flag to `AbstractStore` means `MemoryStore` also benefits. Because `MemoryStore.loadData` is currently synchronous it will never flip the flag, so it does not need modification. Only the async `load()` method wraps with the flag.

**`ensureKeyframes` vs. a separate `<style>` element**
Injecting into the existing `<style id="Base">` sheet keeps all framework CSS in one place, avoids specificity surprises between sheets, and is consistent with how every other dynamic rule is managed.

**No `requestAnimationFrame` for animations**
CSS animations handle their own frame scheduling natively and are GPU-composited when `transform` is used. Driving rotation via `requestAnimationFrame` would be unnecessary and counter to the existing CSS-only animation approach.

**Indeterminate `ProgressBar` uses a sliding fill child, not a gradient background**
A sliding highlight child (`transform: translateX(...)`) preserves the ability to switch back to determinate mode cleanly — just stop the animation and set the fill's width from `value`. A pure background-gradient would be simpler CSS but harder to reconcile with the setter-based style API.

---

## Ordered Implementation Steps

**Step 1 — Extend `CSS.ts`**
Add `ensureKeyframes(name, body)`. Inline the sheet-lookup logic (two lines) rather than exposing the unexported `getMainStyle`.

**Step 2 — Extend `Theme.ts`**
Add `progressBar` and `spinner` sections. Add seven new CSS variable mappings to `themeToVars`.

**Step 3 — Implement `ProgressBar`**
- Module-level: `CSS.ensureKeyframes('ts-ui-progress-indeterminate', ...)`.
- Constructor: create `track` and `fill` child components; set `overflow: hidden` on track.
- `setValue`: clamp, store, call `doLayout`.
- `setIndeterminate(true)`: apply `animation` CSS property to fill.
- `setIndeterminate(false)`: remove animation; revert fill width.
- `doLayout`: size track to component inner bounds; size fill to `value / 100 * trackWidth`.

**Step 4 — Implement `Spinner`**
- Module-level: `CSS.ensureKeyframes('ts-ui-spinner-rotate', ...)`.
- Constructor: create `arc` child; set `borderRadius: 50%`; set border with three solid sides and one transparent; apply animation.
- `showOverlay(target)`: set `position = Position.ABSOLUTE`; set z-index 9999; set `backgroundColor` to `var(--ts-ui-spinner-backdrop)`; set size to target's full size; call `target.addComponent(this)`.
- `hideOverlay`: call `overlayTarget.removeComponent(this)`.
- `doLayout`: centre the arc child within current bounds.

**Step 5 — Extend `AbstractStore`**
Add `private _loading: boolean = false`. Add `isLoading()`. Add private `setLoading(value)`. Extend `StoreEvent` type. Wrap `load()` body with `setLoading(true)` before `await` and `setLoading(false)` in `finally`.

**Step 6 — Wire `TablePanel`**
Create `private _spinner: Spinner` lazily. Subscribe to `'loadingchanged'` in the constructor.

**Step 7 — Update `Base/index.ts`**
Export `ProgressBar` and `Spinner`.

**Step 8 — Verification**
- Confirm `ensureKeyframes` skips reinsertion on hot-reload.
- Confirm `Spinner.hideOverlay` calls `removeComponent`, not `removeElement`, to keep constraint bookkeeping clean.
- Confirm `setLoading(false)` is in `finally` so a rejected proxy read does not leave `isLoading()` stuck.
- Confirm ARIA: `ProgressBar` sets `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` via `getAria()`. `Spinner` sets `role="status"` and `aria-label="Loading"`.

---

## Critical Files

- `src/typescript/Base/CSS.ts`
- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/data/AbstractStore.ts`
- `src/typescript/Base/component/table/TablePanel.ts`
- `src/typescript/Base/index.ts`
- `src/typescript/Base/component/ProgressBar.ts` (new)
- `src/typescript/Base/component/Spinner.ts` (new)
