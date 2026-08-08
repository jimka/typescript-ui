# Slider and ToolBar Orientation Clobbering Fix — Implementation Plan

## Overview

[`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) fixed the constructor-time option-clobbering bug at thirteen sites, but explicitly deferred two: `Slider`'s orientation-conditional `preferredSize` / `maxSize`, and `ToolBar`'s orientation-driven `border`. Both share a bug shape its own bag-substitution fix can't reach: the method that recomputes the clobbered field is *also* the public runtime API for switching orientation, so deleting the constructor-time call would break real runtime orientation switching. This plan carries out the fix that plan's `## Architecture Decisions` named but didn't implement: split each method into a construction-time, options-aware path and a runtime, unconditional path.

Two components, verified against current source:

- [`Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts) — the private `applyOrientation(orientation)` at [line 720](packages/lib/src/typescript/lib/component/input/Slider.ts#L720) unconditionally calls `setPreferredSize` / `setMaxSize` with orientation-derived literals. It runs from the constructor (gated, [line 141](packages/lib/src/typescript/lib/component/input/Slider.ts#L141)) and from the public `setOrientation()` ([line 388](packages/lib/src/typescript/lib/component/input/Slider.ts#L388)). A second, independent clobber sits earlier in the same constructor: [lines 113-114](packages/lib/src/typescript/lib/component/input/Slider.ts#L113-L114) unconditionally set the horizontal default *before* the gated call even runs, so a caller-supplied `preferredSize` / `maxSize` is discarded even when no `orientation` option is passed at all. Both write sites are fixed together (see `## Architecture Decisions`).
- [`ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts) — the public `setOrientation(value)` at [line 221](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L221) unconditionally calls `setBorder` with an orientation-derived literal at its tail ([lines 245-249](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L245-L249)). It runs from `applyOptions`'s construction-time dispatch ([line 196](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L196)) and from any runtime caller. Unlike `Slider`, `ToolBar` has no existing internal/public method split — `setOrientation` is both the implementation and the API — so this plan introduces one.

Both fixes reuse the exact "fold the caller's value first, fall through to the computed default" technique the precedent plan's `## Implementation Notes` already used for `TabBar.applyUnderBorder`, and the independent per-field fold `Component.applyChromeOptions` already uses for `border` / `borderRadius` / `shadow` / `backgroundImage`. Neither component's default look changes; only the override path does.

---

## Architecture Decisions

### Reuse the existing `applyX` (internal) / `setX` (public) split, extending it to `ToolBar`

`Slider` already separates the internal recompute (`private applyOrientation`) from the public API (`setOrientation`, which calls it) — the same shape `Rail.applyOrientation`, `ChartLegend.applyOrientationLayout`, and the precedent plan's `TabBar.applyUnderBorder` use. `ToolBar` has no such split today: `setOrientation` is both. This plan extracts a private `ToolBar.applyOrientation(value, options?)` carrying today's `setOrientation` body, leaving `setOrientation` as a thin wrapper — the same naming and shape already established elsewhere in this codebase, not a new pattern.[^naming-search]

### Fold each clobbered field at the point that computes it, before falling through to the default

Both fixes add an optional `options` parameter to the private `applyOrientation` and check the caller's raw option first, at the exact point the orientation-derived literal would otherwise be written: only when the caller supplied nothing does the method fall through to today's unconditional literal. `ToolBar` has one field (`border`) — it uses the same early-return guard the precedent plan's `TabBar.applyUnderBorder` fix already established: `if (options?.border !== undefined) { this.setBorder(options.border); return; }`, then the existing derivation, unchanged. `Slider` has two fields (`preferredSize`, `maxSize`) that must fold independently — a caller overriding only one must still get the orientation-driven default for the other — so it uses an `if` / `else` per field instead of a single guard, the same independent-per-field shape `Component.applyChromeOptions` ([`Component.ts:679-689`](packages/lib/src/typescript/lib/core/Component.ts#L679-L689)) already uses for its four chrome fields. Both are the same fold-then-fallback technique; the control-flow shape differs only because `ToolBar` has one field to guard and `Slider` has two to fold independently.

Only the constructor passes `options`; every runtime call (the public `setOrientation`) omits it, so `options?.field` is always `undefined` there and the method falls through to the same unconditional, orientation-derived literal it computes today — the runtime resize/reborder behavior does not change.

### `Slider`'s constructor gains one call site instead of two

Today the constructor writes `preferredSize` / `maxSize` twice: once unconditionally at [lines 113-114](packages/lib/src/typescript/lib/component/input/Slider.ts#L113-L114) (always the horizontal literal), and again via the gated `applyOrientation` call at [lines 141-143](packages/lib/src/typescript/lib/component/input/Slider.ts#L141-L143) — but only when the caller explicitly passed an `orientation` option. A caller who passes `preferredSize` alone (no `orientation`) never reaches the gated call, so folding only inside `applyOrientation` would leave the first site clobbering it regardless. Both sites are replaced with one unconditional call, `this.applyOrientation(this.getOrientation(), this._options)`, placed where the gated call used to be.[^why-unify] This makes the hardcoded ARIA default at [line 118](packages/lib/src/typescript/lib/component/input/Slider.ts#L118) (`this.getAria().setOrientation("horizontal")`) dead — the new unconditional call sets ARIA orientation to the resolved value moments later, in the same constructor, before anything reads it — so line 118 is deleted as part of this change, not left behind as an orphan the plan's own restructuring created.

### An adjacent `ToolBar` clobbering bug is noticed, not fixed

`ToolBar.setOrientation` also unconditionally calls `this.setLayoutManager(newLM)`. A caller who supplies both a construction-time `layoutManager` option and relies on the default `orientation` would have that `layoutManager` silently overwritten the same way `border` is today — the identical bug shape, on a different field. It is out of scope here: the task and its precedent plan name `border` specifically, `layoutManager` is not part of either's confirmed-sites list, and fixing it needs its own verification pass (what a caller-supplied non-`HBox`/`VBox` layout manager should mean for orientation switching is a separate design question). See `## Non-Goals`.

---

## Internal Structure

`Slider.applyOrientation`'s new signature (private, unchanged visibility):

```typescript
private applyOrientation(orientation: AxisOrientation, options?: SliderOptions): void
```

`ToolBar` gains a new private method and its `setOrientation` becomes a thin wrapper:

```typescript
private applyOrientation(value: AxisOrientation, options?: ToolBarOptions): void
setOrientation(value: AxisOrientation): this   // unchanged signature; now calls applyOrientation(value)
```

Neither class's public API signature changes — `Slider.setOrientation(orientation)` and `ToolBar.setOrientation(value)` both keep their current single-parameter signature. Only the new private `applyOrientation` methods carry the second, options-aware parameter.

---

## Ordered Implementation Steps

Run `npm test` (in `packages/lib`) after each component's steps to localize any regression before moving to the next.

### Slider — `packages/lib/src/typescript/lib/component/input/Slider.ts`

**Step 1 — Remove the two now-redundant unconditional writes in the constructor.**

1. Delete [lines 113-114](packages/lib/src/typescript/lib/component/input/Slider.ts#L113-L114):
   ```typescript
   this.setPreferredSize({ width: 200, height: THUMB_SIZE });
   this.setMaxSize({ width: UNBOUNDED, height: THUMB_SIZE });
   ```
2. Delete [line 118](packages/lib/src/typescript/lib/component/input/Slider.ts#L118): `this.getAria().setOrientation("horizontal");` (made dead by Step 2 below).
3. Replace the gated block at [lines 141-143](packages/lib/src/typescript/lib/component/input/Slider.ts#L141-L143):
   ```typescript
   if (this._options.orientation !== undefined) {
       this.applyOrientation(this._options.orientation);
   }
   ```
   with a single, unconditional call in the same position:
   ```typescript
   this.applyOrientation(this.getOrientation(), this._options);
   ```
   `this.getOrientation()` already folds `this._options.orientation ?? "horizontal"`, so this resolves to the same value the deleted code computed for both the "no orientation option" and "explicit orientation option" cases — this is a pure relocation, not a behavior change on its own.

**Verification checkpoint:** `grep -n "this.setPreferredSize\|this.setMaxSize" packages/lib/src/typescript/lib/component/input/Slider.ts` — the only two remaining matches are inside `applyOrientation` itself (Step 2); none inside the constructor body directly. `grep -n 'this.getAria().setOrientation' packages/lib/src/typescript/lib/component/input/Slider.ts` — exactly one match, inside `applyOrientation`.

**Step 2 — Make `applyOrientation` options-aware.**

Replace the method at [lines 716-732](packages/lib/src/typescript/lib/component/input/Slider.ts#L716-L732):

```typescript
/**
 * Reflects the orientation in ARIA, swaps the preferred size between
 * landscape and portrait, and forces a layout.
 */
private applyOrientation(orientation: AxisOrientation): void {
    this.getAria().setOrientation(orientation);

    if (orientation === "horizontal") {
        this.setPreferredSize({ width: 200, height: THUMB_SIZE });
        this.setMaxSize({ width: UNBOUNDED, height: THUMB_SIZE });
    } else {
        this.setPreferredSize({ width: THUMB_SIZE, height: 200 });
        this.setMaxSize({ width: THUMB_SIZE, height: UNBOUNDED });
    }

    this.scheduleLayout();
}
```

with:

```typescript
/**
 * Reflects the orientation in ARIA, swaps the preferred size between
 * landscape and portrait, and forces a layout. A caller-supplied
 * `preferredSize` / `maxSize` wins over the orientation-derived default.
 *
 * @param orientation - `"horizontal"` or `"vertical"`.
 * @param options - Passed only from the constructor, so a caller-supplied
 *   `preferredSize` / `maxSize` wins there; every runtime caller (the public
 *   {@link setOrientation}) omits it, so both are always recomputed from
 *   `orientation`.
 */
private applyOrientation(orientation: AxisOrientation, options?: SliderOptions): void {
    this.getAria().setOrientation(orientation);

    const horizontal = orientation === "horizontal";

    if (options?.preferredSize !== undefined) {
        this.setPreferredSize(options.preferredSize);
    } else {
        this.setPreferredSize(horizontal
            ? { width: 200, height: THUMB_SIZE }
            : { width: THUMB_SIZE, height: 200 });
    }

    if (options?.maxSize !== undefined) {
        this.setMaxSize(options.maxSize);
    } else {
        this.setMaxSize(horizontal
            ? { width: UNBOUNDED, height: THUMB_SIZE }
            : { width: THUMB_SIZE, height: UNBOUNDED });
    }

    this.scheduleLayout();
}
```

Do not change `setOrientation` (public, [lines 386-392](packages/lib/src/typescript/lib/component/input/Slider.ts#L386-L392)) — it already calls `this.applyOrientation(orientation)` with no second argument, which is exactly the unconditional runtime path this plan preserves.

**Verification checkpoint:** `grep -n "applyOrientation(" packages/lib/src/typescript/lib/component/input/Slider.ts` — three matches: the constructor (passes `this._options`), `setOrientation` (passes nothing), and the method definition itself.

**Step 3 — Add the Slider test cases.**

In `packages/lib/tests/component/input/Slider.test.ts`, add the five table rows plus items 6-8 from `## Expected Behaviour`'s Slider section (eight cases total) to the existing `describe('Slider getters and deprecated aliases', ...)` block (or a new `describe('Slider orientation sizing', ...)` block placed right after it) — mirror the file's existing bare-construction style already used by `defaults orientation to horizontal` (around line 89); no `installTestDOM` is needed for any of these cases.

**Verification checkpoint:** `npm test -- Slider.test` (in `packages/lib`) — all new and existing cases pass.

### ToolBar — `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`

**Step 4 — Extract `applyOrientation` from `setOrientation`.**

Replace `setOrientation` at [lines 207-252](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L207-L252) (JSDoc plus body):

```typescript
setOrientation(value: AxisOrientation): this {
    if (value === this._orientation) {
        return this;
    }

    const oldLM = this.getLayoutManager();
    const gap   = (oldLM instanceof HBox || oldLM instanceof VBox)
        ? oldLM.getComponentSpacing()
        : 0;

    const newLM: HBox | VBox = value === "horizontal" ? new HBox() : new VBox();
    newLM.setComponentSpacing(gap);
    newLM.setStretching(true);

    this.setLayoutManager(newLM);
    this._orientation = value;

    this.getAria().setOrientation(value);

    const ruleColor = "var(--ts-ui-toolbar-border, rgb(220, 220, 220))";

    if (value === "horizontal") {
        this.setBorder({ borderBottom: `1px solid ${ruleColor}` });
    } else {
        this.setBorder({ borderRight: `1px solid ${ruleColor}` });
    }

    return this;
}
```

with a thin public wrapper plus a new private `applyOrientation` carrying the body, folding `border` at the point it's computed:

```typescript
/**
 * Sets the layout direction. Horizontal toolbars pack children
 * left-to-right via [`HBox`](/api/layout/classes/HBox); vertical toolbars
 * pack them top-to-bottom via [`VBox`](/api/layout/classes/VBox). Child
 * spacing is preserved across the swap; the trailing-edge border flips
 * from bottom to right (or vice versa) to match the new direction.
 *
 * Existing {@link ToolBarSeparator} children are **not** auto-flipped —
 * see the architecture note in the plan.
 *
 * @param value - The new orientation.
 *
 * @returns This component, for method chaining.
 */
setOrientation(value: AxisOrientation): this {
    this.applyOrientation(value);

    return this;
}
```

```typescript
/**
 * Recomputes the layout manager, ARIA orientation, and trailing-edge border
 * for `value`. A no-op when `value` matches the current orientation.
 *
 * @param value - The new orientation.
 * @param options - Passed only from the constructor's `applyOptions`
 *   dispatch; when its `border` is set, that value wins over the
 *   orientation-derived border so a caller-supplied `border` option
 *   survives construction. Every runtime caller (the public
 *   {@link setOrientation}) omits it, so the border is always recomputed
 *   from `value`.
 */
private applyOrientation(value: AxisOrientation, options?: ToolBarOptions): void {
    if (value === this._orientation) {
        return;
    }

    const oldLM = this.getLayoutManager();
    const gap   = (oldLM instanceof HBox || oldLM instanceof VBox)
        ? oldLM.getComponentSpacing()
        : 0;

    const newLM: HBox | VBox = value === "horizontal" ? new HBox() : new VBox();
    newLM.setComponentSpacing(gap);
    newLM.setStretching(true);

    this.setLayoutManager(newLM);
    this._orientation = value;

    this.getAria().setOrientation(value);

    if (options?.border !== undefined) {
        this.setBorder(options.border);
        return;
    }

    const ruleColor = "var(--ts-ui-toolbar-border, rgb(220, 220, 220))";

    if (value === "horizontal") {
        this.setBorder({ borderBottom: `1px solid ${ruleColor}` });
    } else {
        this.setBorder({ borderRight: `1px solid ${ruleColor}` });
    }
}
```

Place `applyOrientation` immediately after `setOrientation` (mirrors `getOrientation` sitting right after `setOrientation` today; both new methods stay adjacent to the API they back).

**Step 5 — Route the constructor's dispatch through the options-aware path.**

In `applyOptions` at [line 196](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L196), change:

```typescript
this.setOrientation(options.orientation ?? this.getOrientation());
```

to:

```typescript
this.applyOrientation(options.orientation ?? this.getOrientation(), options);
```

Leave every other line in `applyOptions` untouched.

**Verification checkpoint:** `grep -n "applyOrientation(" packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — three matches: the new method's own definition, `applyOptions`'s call (passes `options`), and `setOrientation`'s call (passes nothing). `grep -n "setOrientation(" packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — two matches: the pre-existing class-level doc-comment example (`or call \`setOrientation("vertical")\``, unrelated prose, untouched) and the method's own definition — no other executable call site exists inside this file. `grep -rn "\.setOrientation(" packages/lib/tests/component/menubar/ToolBar.test.ts` — all three existing calls still pass a single argument; none needs updating.

**Step 6 — Add the ToolBar test cases.**

In `packages/lib/tests/component/menubar/ToolBar.test.ts`, add the four table rows plus items 5-6 from `## Expected Behaviour`'s ToolBar section to the existing `describe('ToolBar orientation', ...)` block (lines 27-62) — mirror its existing bare-construction style (e.g. `applies an { orientation: "vertical" } option`, line 59); no `installTestDOM` is needed for any of these cases.

**Verification checkpoint:** `npm test -- ToolBar.test` (in `packages/lib`) — all new and existing cases pass.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/tests/component/input/Slider.test.ts` |
| Modify | `packages/lib/tests/component/menubar/ToolBar.test.ts` |

No files are created or deleted.

---

## Expected Behaviour

All cases are unit-testable **(U)** on a bare, unmounted instance — orientation and size getters need no DOM, matching the existing `defaults orientation to horizontal` test already in `Slider.test.ts` and the `ToolBar orientation` describe block already in `ToolBar.test.ts`. Use `getPreferredSizeConstraint()` / `getMaxSizeConstraint()` for `Slider` assertions, not `getPreferredSize()` / `getMaxSize()` — the non-`Constraint` getters additionally clamp against the component's own max/min ([`Component.ts:2751-2779`](packages/lib/src/typescript/lib/core/Component.ts#L2751-L2779)), which would make a test's expected value depend on *both* fields at once instead of the one under test.

### Slider

| # | Construction / call | `getPreferredSizeConstraint()` | `getMaxSizeConstraint()` |
|---|---|---|---|
| 1 | `new Slider()` | `{width: 200, height: 16}` | `{width: UNBOUNDED, height: 16}` |
| 2 | `new Slider({ orientation: 'vertical' })` | `{width: 16, height: 200}` | `{width: 16, height: UNBOUNDED}` |
| 3 | `new Slider({ preferredSize: { width: 300, height: 40 } })` | `{width: 300, height: 40}` | `{width: UNBOUNDED, height: 16}` (unaffected field keeps its default) |
| 4 | `new Slider({ maxSize: { width: 500, height: 50 } })` | `{width: 200, height: 16}` (unaffected field keeps its default) | `{width: 500, height: 50}` |
| 5 | `new Slider({ orientation: 'vertical', preferredSize: { width: 50, height: 300 } })` | `{width: 50, height: 300}` (caller's value, not the vertical default) | `{width: 16, height: UNBOUNDED}` |

(`THUMB_SIZE` is `16`; `UNBOUNDED` is `Number.MAX_SAFE_INTEGER`, exported from `~/primitive/Size.js`.)

6. **Runtime `setOrientation` stays unconditional (U).** Construct `new Slider({ preferredSize: { width: 300, height: 40 }, maxSize: { width: 500, height: 50 } })`, then call `.setOrientation('vertical')`. `getPreferredSizeConstraint()` returns `{width: 16, height: 200}` and `getMaxSizeConstraint()` returns `{width: 16, height: UNBOUNDED}` — the construction-time override is gone, proving the runtime path still recomputes both fields unconditionally.
7. **Runtime `setOrientation` back to horizontal after a construction-time vertical override (U).** Construct `new Slider({ orientation: 'vertical', maxSize: { width: 999, height: 999 } })`, then call `.setOrientation('horizontal')`. `getMaxSizeConstraint()` returns `{width: UNBOUNDED, height: 16}`.
8. **No-op guard on `setOrientation` is unaffected (U, regression).** The existing `Slider.test.ts` coverage for `setValue`/`getOrientation` and the `AbstractInput` `change` listener behavior must keep passing unchanged — this plan does not touch `setOrientation`'s body.

### ToolBar

| # | Construction / call | `getBorder()` |
|---|---|---|
| 1 | `new ToolBar()` | `{borderBottom: "1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))"}` |
| 2 | `new ToolBar({ orientation: 'vertical' })` | `{borderRight: "1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))"}` |
| 3 | `new ToolBar({ border: { borderBottom: '2px dashed red' } })` | `{borderBottom: '2px dashed red'}` |
| 4 | `new ToolBar({ orientation: 'vertical', border: { borderLeft: '3px solid blue' } })` | `{borderLeft: '3px solid blue'}` (caller's value, not the derived `borderRight`) |

5. **Runtime `setOrientation` stays unconditional (U).** Construct `new ToolBar({ border: { borderBottom: '2px dashed red' } })`, then call `.setOrientation('vertical')`. `getBorder()` returns `{borderRight: "1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))"}` — the construction-time override is gone, proving the runtime call still recomputes the border unconditionally from the new orientation.
6. **Existing orientation tests are unaffected (U, regression).** `ToolBar.test.ts`'s `swaps to a VBox layout manager on setOrientation("vertical")`, `preserves component spacing across the orientation swap`, and `is a no-op on the same orientation (keeps the same manager instance)` must keep passing unchanged — the guard, layout-manager swap, and spacing logic move into `applyOrientation` verbatim.

---

## Verification

- `npm run typecheck` (in `packages/lib`) — both `applyOrientation` methods gain a new *private* optional parameter; no call site outside the file passes a second argument today (confirmed by the Step verification greps), so no external code needs updating.
- `npm run test` (in `packages/lib`) — full suite green; add `## Expected Behaviour`'s cases as new tests in `Slider.test.ts` and `ToolBar.test.ts`, following the existing bare-construction pattern already used in each file's own orientation tests (no `installTestDOM` needed — confirmed by the existing `defaults orientation to horizontal` / `ToolBar orientation` tests using bare construction).
- Grep invariants (also listed per-step above; re-run together as a final pass):
  ```
  grep -n "this.setPreferredSize\|this.setMaxSize" packages/lib/src/typescript/lib/component/input/Slider.ts
  grep -n "applyOrientation(" packages/lib/src/typescript/lib/component/input/Slider.ts packages/lib/src/typescript/lib/component/menubar/ToolBar.ts
  ```
- Manual visual smoke (no automated coverage of rendered CSS): open the app (`npm run dev`) and confirm unchanged appearance for `LayoutTestPanel` / `SplitPanel` (both use `Slider`) and a toolbar demo (`ToolBarPanel`, `MarkdownEditorPanel`) under Modern, Dark, and Classic themes. This is a regression check — nothing should look different from before this plan, since every default-path case in `## Expected Behaviour` keeps today's values.

No `npm run docs:api` run is needed — neither class's public API signature changes (see `## Internal Structure`), and both new/changed methods are `private`, outside TypeDoc's public surface.

---

## Documentation Impact

No public API changes — `Slider.setOrientation` and `ToolBar.setOrientation` keep their existing signatures, and no new exported symbol is added. No doc page needs updating.

A changelog entry will still be needed once this ships, since consumer-visible behavior changes (a previously-ignored `preferredSize` / `maxSize` / `border` option now works). That's for whoever runs `/implement` to add, in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — the precedent plan's own entry lives under `## Breaking changes` → `### Component defaults` there, and this fix is a direct continuation of that same entry's list of components. Not a required step of this plan.

---

## Critical Files

- [`plans/implemented/option-setter-clobbering-audit.md`](plans/implemented/option-setter-clobbering-audit.md) — names both sites, explains why its own bag-substitution fix doesn't reach them, and (`## Implementation Notes`) works the exact fold technique this plan reuses for `TabBar.applyUnderBorder`.
- [`packages/lib/src/typescript/lib/core/Component.ts:679-689`](packages/lib/src/typescript/lib/core/Component.ts#L679-L689) (`applyChromeOptions`) — the independent per-field fold both fixes mirror.
- [`packages/lib/src/typescript/lib/component/input/Slider.ts:716-732`](packages/lib/src/typescript/lib/component/input/Slider.ts#L716-L732) (current `applyOrientation`) and [`:386-392`](packages/lib/src/typescript/lib/component/input/Slider.ts#L386-L392) (current `setOrientation`) — the existing `applyX`/`setX` split `ToolBar`'s new split mirrors.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts:190-252`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L190-L252) (`applyOptions` and current `setOrientation`) — the exact code this plan splits.
- [`packages/lib/tests/component/menubar/ToolBar.test.ts:27-62`](packages/lib/tests/component/menubar/ToolBar.test.ts#L27-L62) and [`packages/lib/tests/component/input/Slider.test.ts:89-90`](packages/lib/tests/component/input/Slider.test.ts#L89-L90) — the existing orientation tests both new test additions extend.

---

## Non-Goals

- **Not fixing `ToolBar`'s `layoutManager` clobbering.** `setOrientation` also unconditionally calls `this.setLayoutManager(newLM)`, the same clobbering shape on a different field, noticed during this plan's investigation but not named by either this task or its precedent plan. See `## Architecture Decisions`.
- **Not touching `Slider`'s `outline` / `cursor`.** Already fixed by `plans/implemented/option-setter-clobbering-audit.md`; unrelated to orientation.
- **Not touching the `updateHeight()` / `updateSize()` sizing family** (`TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `AbstractPickerField`) or `Scrollbar`'s `setTouchAction("none")` — both still-deferred, differently-shaped bugs named in the precedent plan's own `## Non-Goals`, out of scope here. (A separate, already-created worktree covers the `updateHeight()` family follow-up.)
- **No component's default paint or behaviour changes** when nobody customises `preferredSize` / `maxSize` / `border`. Every case in `## Expected Behaviour`'s "default" rows keeps today's values.
- **Not adding new public API surface.** `orientation`, `preferredSize`, `maxSize` (`Slider`) and `orientation`, `border` (`ToolBar`) are already-documented `ComponentOptions` / class-specific option fields; this plan only fixes which value wins when more than one is supplied together.

---

## Notes

[^naming-search]: Searched for the `applyX`-internal / `setX`-public split before choosing it: `Slider.applyOrientation` ([`Slider.ts:720`](packages/lib/src/typescript/lib/component/input/Slider.ts#L720)), `Rail.applyOrientation` ([`Rail.ts:1085`](packages/lib/src/typescript/lib/overlay/Rail.ts#L1085)), `ChartLegend.applyOrientationLayout` ([`ChartLegend.ts:157`](packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L157)), and the precedent plan's own `TabBar.applyUnderBorder` all use it already. No sibling pattern was found for "extract a private helper from an existing public method that had no internal/public split before" beyond what the precedent plan already did for `TabBar` — `applyUnderBorder` there was already private before that plan touched it, so `ToolBar` is the first site where the split itself (not just the fold) is new work. The split is justified by the same reasoning as `Slider`'s existing one: a public runtime API and a construction-time-only concern (the options fold) need different behavior from the same recompute logic, and a parameter that's "only meaningful from one caller" has no clean expression other than two entry points sharing one body.

[^why-unify]: An alternative was considered: leave the two write sites in place and add the same independent fold to each, reading `this._options.preferredSize` / `this._options.maxSize` directly at lines 113-114 instead of the hardcoded literals, and leaving `applyOrientation`'s own fold (Step 2) to handle the gated path separately. This was rejected because lines 113-114 already duplicate `applyOrientation`'s horizontal branch verbatim — adding a second, independent fold there would duplicate not just a literal (as today) but the fold logic itself, and a caller passing both `orientation: "vertical"` and a `preferredSize` override would still take a wasted intermediate write (the horizontal fold at lines 113-114, immediately overwritten by the vertical fold moments later) that the unified version avoids entirely by resolving the orientation once, up front, via `this.getOrientation()`.

---

## Implementation Notes

**Performed the `## Verification` section's manual visual smoke check; no discrepancy found.** Started the `packages/lib` dev server (`npx vite --port 8015`) from inside this worktree (confirmed via `readlink /proc/<pid>/cwd` that it served this worktree's own source, not the main tree's — the vite config resolves `~/*` relative to `import.meta.url`, so no cross-tree leak was possible here) and drove it with `chrome-devtools` MCP tools. Checked the `Split` section (`SplitPanel`, whose horizontal `Slider` renders at the top-right, thin, at its default width — matches the pre-fix appearance), the `ToolBar` section (`ToolBarPanel`, four stacked horizontal toolbars each showing their `borderBottom` rule unchanged), and the `MD Editor` section (`MarkdownEditorPanel`, whose small `Edit Markdown source` / `Insert table` toolbar also keeps its `borderBottom` rule) under all three themes reachable from the `Misc.` panel's theme-cycle button (Modern → Classic → Dark). All nine combinations (3 panels × 3 themes) look identical to their pre-fix appearance — no clipping, no missing borders, no resized controls. This is expected: every default-path case in `## Expected Behaviour` keeps today's values, and none of the three demo routes passes a construction-time `preferredSize`, `maxSize`, or `border` option that would exercise the new fold's non-default branch, so the check is a pure regression guard on the unwritten (default) path.
