# Dropdown Fade Animation — Implementation Plan

## Overview

The framework already supports a polished fade-in/fade-out lifecycle on floating panels — [`Menu.fadeIn`/`Menu.fadeOutAndDetach`](../src/typescript/lib/core/Menu.ts#L325) and [`AutoCompleteDropdown.show`/`hide`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L132) both drive [`Animation.play`](../src/typescript/lib/core/Animation.ts#L90) with the same `from: { opacity: "0" } → to: { opacity: "1" }` pattern, the same `_dismissing` re-entrancy flag, and the same `transitionend`-plus-fallback bookkeeping. The pattern is copied verbatim between the two files (compare [Menu.ts:325-366](../src/typescript/lib/core/Menu.ts#L325) with [AutoCompleteDropdown.ts:173-217](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L173)).

ComboBox / DateField / TimeField currently render native browser controls (`<select>`, `<input type="date">`, `<input type="time">`) and **have no JS-controlled dropdown panel at all** — the dropdown is the operating system's native picker. There is nothing to fade in those components today. To deliver the requested animation we must replace the native pickers with framework-built floating panels and run them through a shared fade helper.

The work splits cleanly into two layers:
1. **Extract** a single `AnimatedDropdown` helper in `core/` that owns the `opacity + translateY` transition, the dismissing flag, the reduced-motion short-circuit, and viewport click-outside hide. `AutoCompleteDropdown` and `Menu` collapse to thin wrappers around it.
2. **Rewrite** `ComboBox`, `DateField`, and `TimeField` to compose an `AnimatedDropdown` instance instead of relying on the native picker. Each field exposes `setDropdownAnimated()` delegated to the helper.

No `DateTimeField` *form field* exists today, but the same native-picker problem appears a second time in the **table cell editors**: [`DateEditor`](../src/typescript/lib/component/table/cell/editor/Date.ts) (`<input type="date">`), [`TimeEditor`](../src/typescript/lib/component/table/cell/editor/Time.ts) (`<input type="time">`), and [`DateTimeEditor`](../src/typescript/lib/component/table/cell/editor/DateTime.ts) (`<input type="datetime-local">`). These editors are **pooled** by [`CellEditorPool`](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L41) — one shared instance per variant key (`"date"`, `"time"`, `"time:seconds"`, `"datetime"`, `"datetime:seconds"`) across an entire table, with `blur`/`keydown` wired once at first acquire. To deliver the fade everywhere the user can pop a temporal picker, the form fields and the cell editors must compose the **same** `AnimatedDropdown` subclasses (`DatePickerDropdown`, `TimePickerDropdown`, `DateTimePickerDropdown`) — otherwise the picker UI is duplicated. A new `DateTimeField` form field is introduced as the canonical owner of `DateTimePickerDropdown` so the cell editor isn't an orphan.

---

## Architecture Decisions

### Helper, not base class — composition over inheritance

Each field owns a single `AnimatedDropdown` instance via `private dropdown: AnimatedDropdown`. The field decides *when* to call `dropdown.show()`/`dropdown.hide()`; the helper handles *how* the transition plays. A base class (`DropdownPanel extends Panel`) was rejected because it locks every consumer into one ancestry chain and complicates `Menu`, which already extends `Component` directly. The helper extends `Component` (matching `AutoCompleteDropdown`'s parent) so it inherits CSS-rule generation, z-index, and positioning APIs without forcing those onto the host field.

### Cascade answer — subclasses do not opt in

The user asked: *"how does this cascade to sub-classes? Do we need to implement custom variants of these?"* Answer: **no.** Because each field owns a single `AnimatedDropdown` instance and the dropdown lifecycle methods (`openDropdown`, `closeDropdown`) live on the base class, any subclass — e.g. [`List`](../src/typescript/lib/component/container/List.ts) and [`MultiSelectList`](../src/typescript/lib/component/container/MultiSelectList.ts) which extend `ComboBox` per [Community 21](../graphify-out/GRAPH_REPORT.md) — inherits the animated dropdown automatically. Subclasses only need a custom variant if they want to replace the dropdown *content* (e.g. a multi-select adds checkboxes to each item), not the animation. That is already orthogonal to the fade work and out of scope.

### Reuse, don't reinvent — fold `AutoCompleteDropdown` and `Menu`'s fade into the helper

`AutoCompleteDropdown` and `Menu` both already implement the exact lifecycle. The plan consolidates by:
- Making `AutoCompleteDropdown extends AnimatedDropdown` — `show`/`hide` collapse to anchor positioning plus `super.show()`/`super.hide()`. The pool/highlight logic stays.
- Migrating `Menu`'s private `_dismissing`, `fadeIn`, `fadeOutAndDetach` onto the helper. `Menu`'s `show`/`open`/`hide`/`close` call `this.fadeShow(el)` / `this.fadeHideAndDetach()` (renamed to be unambiguous). Because `Menu` extends `Component` directly we use the *mixin* form — see the next section.

### Helper shape — class extension, with a mixin escape hatch

`AnimatedDropdown` is a concrete subclass of `Component`. `AutoCompleteDropdown` reparents to it cleanly. `Menu` already extends `Component` and cannot multi-inherit, so the helper additionally exports two free functions, `fadeShow(component, options?)` and `fadeHideAndDetach(component, options?)`, that operate on any `Component`. Both forms route through the same `Animation.play` call and share the `_dismissing` flag stored as a `WeakMap<Component, boolean>` so re-entrancy works across both APIs. `Menu` migrates to the free functions; new code uses the class.

### Animation — opacity plus subtle translateY

`opacity: 0 → 1` over `var(--ts-ui-dropdown-fade-duration, 120ms)` (matches `MENU_ANIM_DURATION_MS` already in [Menu.ts:21](../src/typescript/lib/core/Menu.ts#L21)) combined with `transform: translateY(calc(-1 * var(--ts-ui-dropdown-fade-translate, 4px))) → translateY(0)`. `transform` keeps the work on the compositor; using `top` would invalidate layout every frame. The transition declares both properties so `Animation.play`'s shorthand covers them: `properties: ["opacity", "transform"]`.

### Will-change pre-promotion

Hook into the existing [`setWillChange`](../src/typescript/lib/core/Component.ts#L2172) wiring documented in [plans/implemented/will-change-hints.md](implemented/will-change-hints.md). `AnimatedDropdown.show()` sets `will-change: opacity, transform` before the two-RAF flush in `Animation.play`, then clears it in `onComplete` so idle dropdowns don't keep a compositor layer alive.

### Reduced motion — single check, in the helper

`Animation.play` already short-circuits on `isReducedMotion()` at [Animation.ts:94](../src/typescript/lib/core/Animation.ts#L94). The helper does **not** duplicate the check — relying on the existing one keeps the policy in one place and means consumers do not see any animated-vs-reduced branching.

### Opt-out — `setDropdownAnimated`

Default ON. Each field exposes `setDropdownAnimated(value: boolean)` which delegates to `dropdown.setAnimated(value)`. The helper, when `animated === false`, calls `setVisible(true)` / `setVisible(false)` synchronously and bypasses `Animation.play`. This is distinct from the reduced-motion path because users may want instant dropdowns even when their OS allows motion.

### Positioning is unchanged

Anchor-rect math, viewport clamping, and "flip above the anchor when bottom overflows" logic stays in each call site (it already does in `AutoCompleteDropdown.show` and `Menu.show`/`open`). The helper only owns the fade — composition keeps the boundary clean.

### Native picker replacement — necessary for ComboBox / DateField / TimeField

The animation requirement cannot be satisfied by the native `<select>` / `<input type="date">` / `<input type="time">` controls — browsers do not expose their picker chrome to CSS transitions. ComboBox / DateField / TimeField must be rewritten to:
- Keep the focusable native input element (preserves keyboard, accessibility, IME) but suppress the native picker (`<select>` becomes a styled text-anchor; `inputmode="none"` and a click handler on date/time inputs).
- Render a framework-built `AnimatedDropdown` instance on click / arrow-down / typing.
- Mirror the chosen value back to the native input's `value`.

This is a substantial rewrite, called out plainly in **Non-Goals** below: this plan covers the *fade-animation* hook-up and dropdown-panel scaffolding; the bespoke picker UIs (option list rendering, calendar grid, time-grid) are scoped per-component and itemized in the implementation steps.

---

## Public API (TypeScript Signatures)

### `AnimatedDropdown` (new)

```typescript
// src/typescript/lib/core/AnimatedDropdown.ts
import { Component, ComponentOptions } from "~/core/Component.js";

export interface AnimatedDropdownOptions extends ComponentOptions {
    animated?:    boolean;     // default: true
    durationMs?:  number;      // default: 120
    translatePx?: number;      // default: 4
}

export class AnimatedDropdown<TOptions extends AnimatedDropdownOptions = AnimatedDropdownOptions> extends Component<TOptions> {
    constructor(options?: AnimatedDropdownOptions);

    setAnimated(value: boolean): this;
    isAnimated(): boolean;
    setDurationMs(ms: number): this;
    getDurationMs(): number;
    setTranslatePx(px: number): this;
    getTranslatePx(): number;

    /** Mount (if needed), play the fade-in. Cancels any in-flight fade-out. */
    showAnimated(): this;
    /** Play the fade-out, then `setVisible(false)` + `removeElement()`. */
    hideAnimated(): this;

    isOpen(): boolean;

    protected onShowComplete(): void;   // hook for subclasses
    protected onHideComplete(): void;   // hook for subclasses
}

/** Mixin form for components that already extend Component (Menu). */
export function fadeShow(c: Component, opts?: { durationMs?: number; translatePx?: number; animated?: boolean }): void;
export function fadeHideAndDetach(c: Component, opts?: { durationMs?: number; translatePx?: number; animated?: boolean; onComplete?: () => void }): void;
```

Backing fields on the class: `_animated`, `_durationMs`, `_translatePx`, `_dismissing` (private), `_open` (private). The setter / option / cascade triad follows the framework's typed-setter convention enforced by `/implement`.

### `ComboBox` additions

```typescript
// existing constructor + setter contract preserved
class ComboBox extends Component<ComboBoxOptions> implements Bindable<string> {
    setDropdownAnimated(value: boolean): this;
    isDropdownAnimated(): boolean;
}

export interface ComboBoxOptions extends ComponentOptions {
    // ...existing fields...
    dropdownAnimated?: boolean;   // default true
}
```

Identical additions on `DateField` / `TimeField` / the new `DateTimeField`. The three pooled cell editors (`DateEditor`, `TimeEditor`, `DateTimeEditor`) expose the same `setDropdownAnimated` / `isDropdownAnimated` pair so a table can opt the shared pooled instance in or out of the fade.

---

## Theme Tokens

| CSS Custom Property                  | Light Default | Dark Default | Purpose                                       |
|--------------------------------------|---------------|--------------|-----------------------------------------------|
| `--ts-ui-dropdown-fade-duration`     | `120ms`       | `120ms`      | Fade-in / fade-out duration.                  |
| `--ts-ui-dropdown-fade-translate`    | `4px`         | `4px`        | Vertical offset for the entrance translation. |

Add a `dropdown` block to the `Theme` interface in [Theme.ts](../src/typescript/lib/core/Theme.ts) at the same nesting level as `autoComplete` (Theme.ts:217). Mirror entries in `DefaultTheme`, `DarkTheme`, and the `themeToVars()` mapper. The block is intentionally minimal (two scalars) — colours stay on per-field tokens (`--ts-ui-autocomplete-bg`, future `--ts-ui-combobox-bg`, …) so the fade tokens cascade across every dropdown surface without coupling to colour theming.

---

## Internal Structure

### `AnimatedDropdown.showAnimated()`

```typescript
showAnimated(): this {
    this._dismissing = false;
    this._open = true;

    const el = this.getElement(true);

    if (!document.documentElement.contains(el)) {
        document.documentElement.appendChild(el);
    }

    this.setVisible(true);

    if (!this._animated) {
        this.onShowComplete();
        return this;
    }

    this.setWillChange("opacity, transform");

    Animation.play(el, {
        from:       { opacity: "0", transform: `translateY(-${this._translatePx}px)` },
        to:         { opacity: "1", transform: "translateY(0)" },
        durationMs: this._durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            this.setWillChange(null);
            this.onShowComplete();
        },
    });

    return this;
}
```

### `AnimatedDropdown.hideAnimated()`

```typescript
hideAnimated(): this {
    this._open = false;

    const el = this.getElement();
    const finalize = (): void => {
        this.setVisible(false);
        this.removeElement();
        this.onHideComplete();
    };

    if (!el || !this._animated) {
        finalize();
        return this;
    }

    this._dismissing = true;
    this.setWillChange("opacity, transform");

    Animation.play(el, {
        to:         { opacity: "0", transform: `translateY(-${this._translatePx}px)` },
        durationMs: this._durationMs,
        properties: ["opacity", "transform"],
        onComplete: () => {
            if (!this._dismissing) {
                this.setWillChange(null);
                return;
            }
            this._dismissing = false;
            this.setWillChange(null);
            finalize();
        },
    });

    return this;
}
```

The `_dismissing` flag mirrors [AutoCompleteDropdown.dismissing](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L55) and [Menu._dismissing](../src/typescript/lib/core/Menu.ts#L72): a fresh `showAnimated()` mid-fade resets it, so the deferred detach in the still-running `onComplete` skips and the panel stays mounted.

### Field-to-dropdown wiring (ComboBox example)

```typescript
private dropdown: ComboBoxDropdown;  // extends AnimatedDropdown

constructor(options?: ComboBoxOptions) {
    super({ ..._defaultComboBoxOptions, ...(options ?? {}), tag: "div" });   // was "select"
    // ... existing setup ...

    this.dropdown = new ComboBoxDropdown(value => this.onItemSelected(value));

    Event.addListener(this, "click", () => this.toggleDropdown());
    Event.addListener(this, "keydown", e => this.onKeyDown(e));
}

private toggleDropdown(): void {
    if (this.dropdown.isOpen()) {
        this.dropdown.hideAnimated();
    } else {
        this.dropdown.showAt(this.getElement(true), this.items);
    }
}

setDropdownAnimated(value: boolean): this {
    this._options.dropdownAnimated = value;
    this.dropdown.setAnimated(value);
    return this;
}
```

Each per-field subclass of `AnimatedDropdown` (`ComboBoxDropdown`, `DatePickerDropdown`, `TimePickerDropdown`) owns the content (option list, calendar grid, time grid). The fade lifecycle is inherited.

---

## Ordered Implementation Steps

1. **Add `AnimatedDropdown` to `core/`.** New file `src/typescript/lib/core/AnimatedDropdown.ts`. Implement the class plus `fadeShow` / `fadeHideAndDetach` free functions, backed by a module-scope `WeakMap<Component, boolean>` for the dismissing flag. **Verify:** `tsc --noEmit` clean; add minimal unit-style smoke in the existing test harness if one covers `core/` (otherwise defer to step 9 demo verification).

2. **Add theme tokens.** Edit [Theme.ts](../src/typescript/lib/core/Theme.ts) at four sites: the `Theme` interface (alongside `autoComplete` at Theme.ts:217), `DefaultTheme` (~Theme.ts:322), `DarkTheme` (~Theme.ts:476), and `themeToVars()` (~Theme.ts:608). **Verify:** `grep -n 'dropdown-fade' src/typescript/lib/core/Theme.ts` returns four hits.

3. **Refactor `AutoCompleteDropdown` onto `AnimatedDropdown`.** Change the `extends` to `AnimatedDropdown`. Delete the private `dismissing` field and the inline `Animation.play` blocks at [AutoCompleteDropdown.ts:173](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L173) and [AutoCompleteDropdown.ts:206](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L206). Override `onShowComplete` only if the existing `Event.addViewportListener` call needs to run post-fade (today it runs pre-fade — keep that ordering). The `show(anchorEl, suggestions)` method retains its positioning math and calls `super.showAnimated()` at the end; `hide()` becomes `super.hideAnimated()` plus the existing `Event.removeViewportListener` and `this.onHide()` callback wired into `onHideComplete`. **Verify:** typecheck; the AutoCompleteField demo on `http://localhost:8015` still fades.

4. **Migrate `Menu` to `fadeShow`/`fadeHideAndDetach`.** In [Menu.ts](../src/typescript/lib/core/Menu.ts), replace the bodies of `fadeIn` and `fadeOutAndDetach` (Menu.ts:325-366) with calls to the new free functions. Delete the private `_dismissing` field. **Verify:** right-click menu and menu-bar dropdowns still fade in/out; `npm run dev` smoke on context-menu demo.

5. **Rewrite `ComboBox`.** [ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) currently builds a `<select>`. Change to `tag: "div"`, render a styled input-like surface with the current value text plus a caret glyph, attach click + keyboard handlers, and own a `ComboBoxDropdown extends AnimatedDropdown` that renders one row per `Option`. Preserve the existing public API (`setItems`, `addItem`, `setStore`, `setValue`, `getValue`, `setSelectedIndex`, etc.) — only the rendering substrate changes. Add `setDropdownAnimated`/`isDropdownAnimated` and the matching `dropdownAnimated` field in `ComboBoxOptions`. Subclasses [`List`](../src/typescript/lib/component/container/List.ts) and [`MultiSelectList`](../src/typescript/lib/component/container/MultiSelectList.ts) inherit the dropdown for free; verify by smoke-testing them.

6. **Rewrite `DateField`.** [DateField.ts](../src/typescript/lib/component/input/DateField.ts) currently uses `<input type="date">`. Change the rendered element to `<input type="text" inputmode="none">` with a calendar glyph button on the right, plus a `DatePickerDropdown extends AnimatedDropdown` showing a month-view calendar grid. Click on the input or glyph toggles the dropdown; selecting a day calls `setValue`. Preserve `getValue`/`setValue`/`addActionListener`/`addBindingListener`. Add `setDropdownAnimated`. **Note:** the calendar UI itself is its own design surface — this plan owns only the *fade hook-up*. If the calendar grid is too large for this slice, ship the dropdown with a minimal grid (current month, no navigation) and call the polished calendar out as follow-up in the merge commit.

7. **Rewrite `TimeField`.** [TimeField.ts](../src/typescript/lib/component/input/TimeField.ts) similarly: replace `<input type="time">` with a text input plus clock glyph and a `TimePickerDropdown extends AnimatedDropdown` showing an hour/minute scroller (or a simple two-column list of hours and minutes). Same setter/preservation contract as DateField.

8. **Introduce `DateTimeField` form field.** New file `src/typescript/lib/component/input/DateTimeField.ts`. Composes a `DateTimePickerDropdown extends AnimatedDropdown` that renders the month-grid above an hour/minute selector. Mirrors the `DateField` / `TimeField` setter contract (`setValue`/`getValue` over `Date | null`, `addActionListener`, `addBindingListener`) and the same `setDropdownAnimated` / `dropdownAnimated` option. Export from [src/typescript/lib/component/input/index.ts](../src/typescript/lib/component/input/index.ts). This step is what gives `DateTimePickerDropdown` a single owner in `component/input/` — the cell editor (step 8b) imports it from there.

8b. **Rewrite the three pooled cell editors.** Each editor in [src/typescript/lib/component/table/cell/editor/](../src/typescript/lib/component/table/cell/editor/) currently extends `CellEditor` with `super("input")` and slaps `type="date"|"time"|"datetime-local"` on the element in `applyStyle`. Change each to:
   - Render the same focusable text-input substrate the form fields use (`<input type="text" inputmode="none">`).
   - Compose the matching dropdown subclass: `DateEditor` → `DatePickerDropdown`, `TimeEditor` → `TimePickerDropdown`, `DateTimeEditor` → `DateTimePickerDropdown` (the very classes introduced in steps 6, 7, 8 — imported, not duplicated).
   - Preserve `getValue` / `setValue` / `isEmpty` semantics exactly, since [DateTimeCell.commitEdit](../src/typescript/lib/component/table/cell/DateTime.ts#L54) and its peers rely on `isEmpty() && getValue() === null` to detect bad input and revert.
   - Add `setDropdownAnimated` / `isDropdownAnimated` on each editor; the pooled instance picks up table-wide configuration through whatever knob the host table exposes (out of scope here — default ON is fine).

   **Pool-wiring hazard.** [CellEditorPool.wireListeners](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L117) commits the edit on the editor's `blur`. Today the native picker lives outside the editor element, so picker clicks already fire blur and commit. With a framework-built `AnimatedDropdown` mounted on `document.documentElement`, clicking a day or hour will *also* blur the input — but the dropdown's click handler runs after the blur. Fix: on `pointerdown` inside the dropdown, `event.preventDefault()` to suppress the blur, and have the dropdown's selection callback explicitly call the active cell's `commitEdit()` instead of relying on blur. Alternatively the pool's blur listener checks whether the new `activeElement` (or `relatedTarget`) is inside the dropdown's element and defers commit. Pick one; document the choice in the editor's JSDoc so future readers don't break it. **Verify:** click a day in a `DateCell` edit — value commits to that day; press Escape — edit cancels; click outside both editor and dropdown — edit commits the typed text via the existing `blur` path.

9. **Demo verification.** Open `http://localhost:8015` (per the user's `project_dev_urls` memory), exercise:
   - ComboBox open/close — observe the 120 ms fade and 4 px translate.
   - DateField open/close — same.
   - TimeField open/close — same.
   - DateTimeField open/close — same; verify both the date grid and time selector are inside the single faded surface.
   - Edit a `DateCell` / `TimeCell` / `DateTimeCell` in `MiscPanel`'s table — the pooled editor's dropdown fades in on focus, day/hour click commits and fades the dropdown out, Escape cancels, click-outside commits the typed text.
   - `setDropdownAnimated(false)` on each — verifies the opt-out renders instantly.
   - Theme toggle — fade is unchanged (only colours flip; the new tokens are theme-neutral but must still resolve).
   - DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` — fade collapses to an instant show/hide via `Animation.play`'s built-in short-circuit.
   - `MiscPanel` slow-table page (per `project_perf_benchmark`) — confirms no layout-thrash regression from the new compositor layers, *and* that the pooled-editor rewrite hasn't slowed cell-edit acquisition (the dropdown should mount lazily on first acquire, not at pool construction).

10. **`graphify update .`** — keep the graph current (AST-only, no API cost) per the project's `graphify` directive.

11. **`npm run docs:build`** — confirm 0 errors and 0 link warnings; the only acceptable warning is the pre-existing TypeScript-version notice.

---

## Files to Create / Modify / Delete

| Action | File                                                                                                        |
|--------|-------------------------------------------------------------------------------------------------------------|
| Create | `src/typescript/lib/core/AnimatedDropdown.ts`                                                               |
| Modify | `src/typescript/lib/core/index.ts` — export `AnimatedDropdown` + types + `fadeShow`/`fadeHideAndDetach`     |
| Modify | `src/typescript/lib/core/Theme.ts` — `dropdown` block × 4 sites                                             |
| Modify | `src/typescript/lib/core/Menu.ts` — migrate `fadeIn`/`fadeOutAndDetach` to helper                           |
| Modify | `src/typescript/lib/component/input/AutoCompleteDropdown.ts` — re-parent to `AnimatedDropdown`              |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — replace native `<select>` with framework dropdown        |
| Modify | `src/typescript/lib/component/input/DateField.ts` — replace native picker with framework dropdown           |
| Modify | `src/typescript/lib/component/input/TimeField.ts` — replace native picker with framework dropdown           |
| Create | `src/typescript/lib/component/input/DateTimeField.ts` — new form field owning `DateTimePickerDropdown`      |
| Modify | `src/typescript/lib/component/input/index.ts` — export `DateTimeField` and the three picker dropdown classes |
| Modify | `src/typescript/lib/component/table/cell/editor/Date.ts` — compose `DatePickerDropdown`, drop `type="date"`  |
| Modify | `src/typescript/lib/component/table/cell/editor/Time.ts` — compose `TimePickerDropdown`, drop `type="time"`  |
| Modify | `src/typescript/lib/component/table/cell/editor/DateTime.ts` — compose `DateTimePickerDropdown`, drop `type="datetime-local"` |
| Modify | `src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` — see step 8b: either guard `blur`-commit against dropdown clicks, or leave unchanged if the dropdown suppresses blur via `pointerdown` preventDefault |
| Modify | `docs/core/index.md` + `docs/.vitepress/config.mts` — add the `AnimatedDropdown` API page                   |

No deletions.

---

## Verification

- `npx tsc --noEmit` — clean.
- `grep -rn 'private.*_dismissing' src/typescript/lib/ —` expect a single hit (only inside `AnimatedDropdown.ts`); zero hits in `Menu.ts` and `AutoCompleteDropdown.ts` after step 3 and step 4.
- `grep -rn '"select"' src/typescript/lib/component/input/ComboBox.ts` — expect zero hits after step 5.
- `grep -rn 'type="date"\|type="time"\|type="datetime-local"' src/typescript/lib/component/input/ src/typescript/lib/component/table/cell/editor/` — expect zero hits after steps 7, 8, and 8b (covers both form fields and pooled cell editors).
- `grep -n 'dropdown-fade-duration\|dropdown-fade-translate' src/typescript/lib/core/Theme.ts` — expect 4 hits (interface + 2 themes + mapper).
- Manual demo per step 9.
- `npm run docs:build` — 0 errors, 0 link warnings.
- `graphify update .` — graph reflects the new `AnimatedDropdown` node and re-parented `AutoCompleteDropdown`.

---

## Documentation Impact

- New symbol `AnimatedDropdown` lives in the `core` bucket — exported from [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts).
- Add a curated page under `docs/core/animated-dropdown.md`; update `docs/core/index.md`'s catalog and the sidebar in `docs/.vitepress/config.mts`.
- Cross-bucket JSDoc references (ComboBox / DateField / TimeField in `component/input` mentioning `AnimatedDropdown` in `core`) **must** use the markdown-link form `[\`AnimatedDropdown\`](/api/core/classes/AnimatedDropdown)` per the project's documentation rules — `{@link}` does not resolve across buckets.
- No renames; no deletions of existing pages. `AutoCompleteDropdown` and `Menu` API pages stay valid; their behaviour narrative needs a one-line edit noting "fade lifecycle delegated to `AnimatedDropdown`".

---

## Potential Challenges

- **`<select>` removal regresses keyboard / IME / accessibility.** Mitigation: keep a focusable element (`<div tabindex="0" role="combobox">`) and wire `aria-expanded`, `aria-activedescendant`, arrow-key navigation explicitly. Mirror the patterns in [AutoCompleteField](../src/typescript/lib/component/input/AutoCompleteField.ts) which already does this work.
- **Native date picker offers better UX than a hand-rolled calendar on mobile.** Mitigation: document the trade-off in the merge commit and consider a `setUseNativePicker(true)` escape hatch as a follow-up, not part of this slice.
- **Two compositor layers per dropdown (one for the dropdown itself, one for the host page if it scrolls).** Mitigation: clear `will-change` in `onComplete` (already in the helper) so idle dropdowns release the layer.
- **Re-entrant show during fade-out** — already handled by the `_dismissing` flag, verified in `AutoCompleteDropdown` today.
- **`Menu` is in `core/`; `AnimatedDropdown` will also be in `core/`** — no circular import: `Menu` imports `AnimatedDropdown`, not the reverse.
- **Subclasses of `ComboBox` (`List`, `MultiSelectList`) override `render()`** — verify the rewritten `ComboBox.render()` still calls into the subclass override or that the subclasses are migrated to the new substrate; do not silently drop their customisations.
- **CellEditorPool's `blur`-commit collides with framework-built dropdown clicks.** The pool wires a single `blur` listener that calls `activeCell.commitEdit()` ([CellEditorPool.ts:117](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L117)). With the native picker the picker chrome lives outside the editor element, so clicking it blurs the input and commits the typed (or picker-mirrored) value. With an `AnimatedDropdown` mounted on `document.documentElement`, clicking a day or hour will fire `blur` on the editor *before* the dropdown's selection callback runs — `commitEdit` commits the stale value, the dropdown's callback then writes the picked value into a no-longer-active editor. Mitigation: in the picker dropdown's pointer handling, call `event.preventDefault()` on `pointerdown` so the input keeps focus; the selection callback then explicitly invokes `activeCell.commitEdit()` after writing the value via `editor.setValue(...)`. Document the contract in `AnimatedDropdown` JSDoc so future cell-editor authors don't re-introduce the bug.
- **Shared dropdown identity across form field and pooled cell editor.** A single `DatePickerDropdown` instance must not be mounted by both a `DateField` and a `DateEditor` at the same time (the dropdown is a singleton inside its host). Each host owns its own dropdown instance — the **class** is shared, the **instance** is per-host. Spelled out here because the natural reading of "share `DatePickerDropdown`" is "share the instance", which would break.

---

## Critical Files

- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `Animation.play` + `isReducedMotion`; the helper builds on this.
- [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts) — fade pattern source; constants `MENU_ANIM_DURATION_MS = 120` and the `_dismissing` flag.
- [src/typescript/lib/component/input/AutoCompleteDropdown.ts](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) — second copy of the same pattern; folds into the helper.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `setWillChange`, `setVisible`, `removeElement`, `getElement`.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — token wiring × 4 sites.
- [src/typescript/lib/component/input/index.ts](../src/typescript/lib/component/input/index.ts) — barrel exports for the rewritten fields plus the new `DateTimeField` and the three picker dropdown classes.
- [src/typescript/lib/component/table/cell/editor/CellEditorPool.ts](../src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — pooled-editor lifecycle and the `blur`-commit listener that step 8b's hazard concerns.
- [src/typescript/lib/component/table/cell/DateTime.ts](../src/typescript/lib/component/table/cell/DateTime.ts), [Date.ts](../src/typescript/lib/component/table/cell/Date.ts), [Time.ts](../src/typescript/lib/component/table/cell/Time.ts) — the `Cell` wrappers that call `getEditorKey()` to acquire the pooled editor; their `commitEdit` overrides assume the editor's `isEmpty() && getValue() === null` semantics, which must be preserved exactly.
- [plans/implemented/autocomplete.md](implemented/autocomplete.md) — prior-art dropdown pattern.
- [plans/implemented/will-change-hints.md](implemented/will-change-hints.md) — compositor-layer pre-promotion pattern this plan reuses.

---

## Non-Goals

- **Calendar polish.** A minimal calendar grid (current month, no navigation) is acceptable for the DateField rewrite. Multi-month navigation, week-number rendering, locale-aware first-day-of-week, and range selection are deliberately out of scope — they belong in a separate `date-picker-ui` plan.
- **Time-picker UX richness.** Same posture: a basic hour/minute selector is enough; 12-hour vs 24-hour formatting toggles, seconds, and time-zone display are out of scope.
- **Native-picker escape hatch (`setUseNativePicker(true)`).** Worth considering but adds API surface — punt to follow-up.
- **Animation curves beyond the default `ease-out`.** `Animation.play` already accepts an `easing` config; the helper does not surface it as a setter to keep the API minimal. Consumers needing custom easing can subclass.
- **Animating the dropdown's *open direction* flip** (flipping to above the anchor when the bottom overflows). Today's positioning math sets the final coordinates before the fade starts; the fade plays from those coordinates. Animating the flip itself is out of scope.
