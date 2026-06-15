# Centralize Size Aggregation — Implementation Plan

## Overview

The layout managers hand-roll two pieces of sizing arithmetic that should be shared primitives. **Part A:** the "no upper bound" concept exists as *two* different magic numbers — [`Component`'s default `maxSize`](../src/typescript/lib/core/Component.ts#L345) and [`LayoutManager._defaultMaxSize`](../src/typescript/lib/layout/LayoutManager.ts#L35) use `Number.MAX_VALUE`, while every manager's `getMaxSize` tests `value >= Number.MAX_SAFE_INTEGER` and inlines its own saturation. It works only because `MAX_VALUE >= MAX_SAFE_INTEGER`. **Part B:** [`HBox.getMaxSize`](../src/typescript/lib/layout/HBox.ts#L200) and [`VBox.getMaxSize`](../src/typescript/lib/layout/VBox.ts#L165) (and the symmetric cross-axis parts of their min/preferred) re-implement the same *sum-main / max-cross / null-or-sentinel = unbounded* aggregation that already silently diverged once (a stray `Math.min` on the cross axis) and caused the bugs fixed in [`plans/implemented/size-constraint-invariant-regressions.md`](implemented/size-constraint-invariant-regressions.md).

This is an **almost-pure, behaviour-preserving refactor.** It introduces one `UNBOUNDED` sentinel plus `isUnbounded`/`saturate` helpers in the `primitive/Size` module (Part A), and a shared child-extent accumulator on [`BoxLayout`](../src/typescript/lib/layout/BoxLayout.ts) (Part B). The numeric min/preferred/max **reported** by every component is unchanged. There is exactly **one accepted, intended behaviour change**: the ~16 components that explicitly pass `Number.MAX_SAFE_INTEGER` to `setMaxSize` now render their unbounded axis as `inf`/`none` instead of a giant pixel value (a visually-inert normalization — see the dedicated *Architecture Decision* below).

The aggregation contract is already authoritative in [`ARCHITECTURE.md` § "Size constraints: who is responsible for what"](../ARCHITECTURE.md#L64) (the contract bullet is at [L68](../ARCHITECTURE.md#L68)): **sum main / max cross / null-or-sentinel child = unbounded / saturate the unbounded axis.**

---

## Architecture Decisions

### `UNBOUNDED = Number.MAX_SAFE_INTEGER`, with a value-migration caveat in `Component`

The single sentinel is `Number.MAX_SAFE_INTEGER` — the value the managers already test against — exported as `UNBOUNDED`. `LayoutManager._defaultMaxSize` and `Component`'s default `maxSize` migrate to it. This is a **value change** in those two defaults (`MAX_VALUE` → `MAX_SAFE_INTEGER`), and it is only behaviour-preserving if *every* downstream comparison that special-cases "no max" migrates in lockstep.

The trap: `Component` does not only *produce* the sentinel, it also *reads* it back with `=== Number.MAX_VALUE` equality branches that decide whether to render `max-width: none` / a `data-maxSize="inf"` attribute instead of a pixel value — [`setMaxSize`](../src/typescript/lib/core/Component.ts#L2250-L2254) (the `maxWidth`/`maxHeight` style at L2250-2251 and the `data-maxSize` attribute at L2254), [`applyStyle`](../src/typescript/lib/core/Component.ts#L3671-L3673), and the [`setPreferredSize`](../src/typescript/lib/core/Component.ts#L2111) / [`setMinSize`](../src/typescript/lib/core/Component.ts#L2181) "inf" data-attribute branches. If the default value becomes `MAX_SAFE_INTEGER` but those equality checks still test `=== MAX_VALUE`, an unbounded component would suddenly render `max-width: 9007199254740991px` instead of `none` — a behaviour change. **Therefore every `=== Number.MAX_VALUE` and `>= Number.MAX_SAFE_INTEGER` comparison in `Component` migrates to `isUnbounded(...)`, and the two `width = Number.MAX_VALUE` fallback writes in `getMaxSize` migrate to `UNBOUNDED`.** After the change, `isUnbounded` must accept *both* legacy `MAX_VALUE` and the new `MAX_SAFE_INTEGER` (see next decision) so any caller still passing `MAX_VALUE` (e.g. `setMaxSize(Number.MAX_VALUE, …)` call sites listed below) keeps rendering `none`.

### `isUnbounded` recognises both `MAX_SAFE_INTEGER` and `MAX_VALUE`

`isUnbounded(n)` returns `n >= Number.MAX_SAFE_INTEGER`. Because `MAX_VALUE > MAX_SAFE_INTEGER`, this recognises *both* the new sentinel and any lingering `MAX_VALUE` literal — so the 8 call sites across 4 files that still pass `setMaxSize(Number.MAX_VALUE, …)` (TabBar ×4, ToolBarSeparator ×2, Menu ×1, FieldSet ×1 — see *Non-Goals*) keep behaving identically without being touched. This is the same `>=` test the managers already use, now named once. `saturate(n)` returns `Math.min(n, UNBOUNDED)` — identical to the inline `Math.min(value, Number.MAX_SAFE_INTEGER)` already in [`Grid`](../src/typescript/lib/layout/Grid.ts#L481).

### Accepted behaviour change: `MAX_SAFE_INTEGER` leaf components' unbounded axis now renders `inf`/`none` instead of a giant pixel value

This is the one place the refactor is **not** byte-identical, and it is accepted as an intended normalization. The numeric *reports* (`getMaxSize` return values) do not change — only the **DOM string representation of an already-unbounded axis** does, and only for the ~16 components that explicitly pass `Number.MAX_SAFE_INTEGER` to `setMaxSize` (`TextField`, `Tree`, `Slider`, `NumberSpinner`, `PasswordField`, `AbstractPickerField`, `ComboBox`, `AbstractCustomList`, `StatusBar`, the Date/Time/DateTime/String/Number cell editors).

The cause: today `setMaxSize`/`applyStyle` test the explicit max with `=== Number.MAX_VALUE`, so a `MAX_SAFE_INTEGER` value falls through to the pixel branch and renders `max-width: 9007199254740991px` / `data-maxSize="9007199254740991px 32px"`. Once the default migrates to `MAX_SAFE_INTEGER`, those branches **must** widen to `isUnbounded` (`>=`) or the default-unbounded component would itself render the giant pixel value — so the same widening incidentally catches the explicit `MAX_SAFE_INTEGER` leaves, normalizing them to `max-width: none` / `data-maxSize="inf inf"`. This is the inverse of, and forced by, the same trap the previous decision describes; it is a latent-inconsistency fix (those leaves always *meant* unbounded), visually inert (giant-px and `none` paint identically), and the only alternative — keeping the default as `MAX_VALUE` so the rendering checks never widen — was considered and rejected in favour of the single `MAX_SAFE_INTEGER` sentinel the managers already use. **Verification must expect this specific diff** (see *Verification* step 3), not treat it as a regression.

### Sentinel + helpers live in `primitive/Size.ts`, exported from the `primitive` barrel

`UNBOUNDED`, `isUnbounded`, and `saturate` are size-domain primitives and belong beside the `Size` interface in [`src/typescript/lib/primitive/Size.ts`](../src/typescript/lib/primitive/Size.ts). The per-subpath barrel [`src/typescript/lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts) gains a `value` export line for them (the barrel already value-exports several primitives — `borderToStyle`, `BorderStyle`, `Insets`, `Point`, etc. — but `Size` is currently a type-only `export type { Size }`, so the three new symbols need their own `export { … }` line). There is no root barrel. Every consumer already imports `Size` from `~/primitive/Size.js`, so the imports extend an existing line.

### The shared accumulator lives on `BoxLayout`, parameterised by axis

`HBox` and `VBox` are mirror images across the main/cross axis. A single `protected aggregateMaxSize(horizontal: boolean): Size` on [`BoxLayout`](../src/typescript/lib/layout/BoxLayout.ts) encodes the *sum-main / max-cross / null-or-sentinel = unbounded / saturate* contract once; `HBox` passes `horizontal = true`, `VBox` passes `false`. It reads `this._spacing` and `this._mode` (both already `protected` on `BoxLayout`) and the container's components, so the two `getMaxSize` overrides collapse to a one-line delegation. This is the method that *already diverged once* — centralising it is the whole point.

### `HBox`'s baseline-aware cross-axis *minimum* stays bespoke

`HBox.getMinSize`/`getPreferredSize` compute cross-axis height through [`computeRowHeight(heights, baselines)`](../src/typescript/lib/layout/LayoutManager.ts#L535) — a baseline-aware row metric genuinely asymmetric from `VBox`'s plain `Math.max`. **Do not fold these into the shared accumulator.** Only `getMaxSize` (which uses a plain cross-axis `Math.max`, identical in both classes) adopts `aggregateMaxSize`. The min/preferred methods keep their own loops; the only change they receive is routing any sentinel literal through the Part-A helpers (there are none in HBox/VBox min/preferred today, so they are untouched by Part A — see *Ordered Steps*).

### `VBox.getPreferredSize`'s `MAX_SAFE_INTEGER` seed is a private idiom, not the sentinel — leave its mechanic, swap only the literal

[`VBox.getPreferredSize`](../src/typescript/lib/layout/VBox.ts#L72-L80) seeds `width = Number.MAX_SAFE_INTEGER` and uses `width == Number.MAX_SAFE_INTEGER ? Math.min(...) : Math.max(...)` as a "first-iteration" sentinel — **not** an unbounded report (the value never escapes; it is overwritten on the first child). This is *not* a max-aggregation and must **not** be routed through the shared accumulator. Swap the two literals to `UNBOUNDED`/`isUnbounded(width)` for one-sentinel consistency (purely cosmetic, value-identical) or leave them — implementer's call; flag in the commit either way. Recommendation: swap, so a grep for `MAX_SAFE_INTEGER` in `layout/` returns only the helper module.

### Border and Grid adopt the Part-A helpers but not the Part-B accumulator

[`Border.getMaxSize`](../src/typescript/lib/layout/Border.ts#L687) (the `INF` local at L698 + `Math.min(_, INF)` saturation) and [`Grid.getMaxSize`/`trackAxisMax`/`maxChildExtent`](../src/typescript/lib/layout/Grid.ts#L481-L550) (the `saturate` local + `>= MAX_SAFE_INTEGER` tests) have geometries (5-region stack, track model) that the box accumulator cannot express. But their *sentinel handling* is identical to Part A's: route their `INF`/`saturate` locals and `>= MAX_SAFE_INTEGER` tests through `UNBOUNDED`/`isUnbounded`/`saturate`. This deletes the duplicated `saturate` local in Grid and the `INF` local in Border in favour of the shared names. Value-identical.

### HFlow reuses the Part-A helpers; it is *not* a candidate for the Part-B accumulator

`HFlow` deliberately does not extend `BoxLayout` ([its class doc explains why](../src/typescript/lib/layout/HFlow.ts#L44): wrapping flow, no mode/stretching/weight/shrink). Its `getMaxSize` cross-axis is `Math.max` and main-axis is a sum — *shape-compatible* with `aggregateMaxSize` — but the uniform-width branch (`count * columnWidth`) and the per-child `uniformWidth` guard make a clean delegation impossible without parameterising the accumulator into something baroque. **Recommendation: HFlow adopts Part A only** (swap its `>= Number.MAX_SAFE_INTEGER` tests and `Number.MAX_SAFE_INTEGER` writes to `isUnbounded`/`UNBOUNDED`), and is **left out of Part B.** Forcing the shared accumulator onto a wrapping flow would re-introduce the coupling the class was split out to avoid.

---

## Public API (TypeScript Signatures)

New exports from `src/typescript/lib/primitive/Size.ts`:

```typescript
/** The sentinel extent meaning "no upper bound" on a size axis. */
export const UNBOUNDED: number; // = Number.MAX_SAFE_INTEGER

/** True when an extent is at or above the unbounded sentinel (recognises the legacy Number.MAX_VALUE too). */
export function isUnbounded(n: number): boolean; // n >= Number.MAX_SAFE_INTEGER

/** Caps an extent at the unbounded sentinel so an unbounded sum cannot overflow it. */
export function saturate(n: number): number; // Math.min(n, UNBOUNDED)
```

New protected method on `BoxLayout` (internal, not exported):

```typescript
/**
 * Aggregates the children's maximum sizes per the box contract: main axis =
 * sum of child maxima (+ spacing; in "equal" mode count * widest-child-max),
 * cross axis = max of child maxima, a null or unbounded child max making that
 * axis unbounded. Saturated to UNBOUNDED. Includes the container perimeter.
 * @param horizontal true for HBox (main = width), false for VBox (main = height).
 */
protected aggregateMaxSize(horizontal: boolean): Size;
```

After the refactor, `HBox.getMaxSize` is `return this.aggregateMaxSize(true);` and `VBox.getMaxSize` is `return this.aggregateMaxSize(false);` — the per-class JSDoc on `getMaxSize` is retained (it documents the public override), and the equal-mode / unbounded-sentinel prose moves to `aggregateMaxSize`.

---

## Internal Structure

`aggregateMaxSize` must reproduce the **exact** arithmetic of the two current overrides, generalised over axis. Pseudostructure (HBox = main:width/cross:height, VBox = main:height/cross:width):

```
container? else return null
perimeter = container.getPerimiterSize()
mainStart  = horizontal ? perimeter.left+right : perimeter.top+bottom
crossExtra = horizontal ? perimeter.top+bottom : perimeter.left+right
main = mainStart; cross = 0; mainUnbounded = crossUnbounded = false
for component in components:
    size = component.getMaxSize()
    if !size: mainUnbounded = crossUnbounded = true; continue
    mainExtent  = horizontal ? size.width  : size.height
    crossExtent = horizontal ? size.height : size.width
    // "equal": accumulate widest child max into a separate maxChildMax; "preferred": main += mainExtent
    if isUnbounded(mainExtent):  mainUnbounded  = true  else (sum or max-into-maxChildMax)
    if isUnbounded(crossExtent): crossUnbounded = true  else cross = Math.max(cross, crossExtent)
// equal: main += count * maxChildMax + spacing*(n-1); preferred: main += spacing*(n-1)
cross += crossExtra
return { main-axis: mainUnbounded ? UNBOUNDED : main,
         cross-axis: crossUnbounded ? UNBOUNDED : cross }   // mapped back to {width,height} by axis
```

The `width:/height:` keys in the returned `Size` are assigned by axis: for `horizontal`, `width = main`, `height = cross`; for vertical, swapped. The spacing term is `this._spacing * Math.max(0, components.length - 1)` (matches both current implementations). Verify the equal-mode main-axis formula against both originals: HBox equal `width += components.length * maxChildMaxWidth + spacing * max(0,n-1)` and VBox equal `height += components.length * maxChildMaxHeight + spacing * max(0,n-1)` — they are identical modulo axis, so one branch covers both.

---

## Ordered Implementation Steps

1. **`src/typescript/lib/primitive/Size.ts`** — add `UNBOUNDED`, `isUnbounded`, `saturate` below the `Size` interface, with JSDoc per *Public API*. Verify: `grep -n 'UNBOUNDED\|isUnbounded\|saturate' src/typescript/lib/primitive/Size.ts`.

2. **`src/typescript/lib/primitive/index.ts`** — add `export { UNBOUNDED, isUnbounded, saturate } from '~/primitive/Size.js';` (a `value` export, distinct from the existing `export type { Size }`).

3. **`src/typescript/lib/layout/LayoutManager.ts`** — import `UNBOUNDED` from `~/primitive/Size.js`; change `_defaultMaxSize` to `{ width: UNBOUNDED, height: UNBOUNDED }`.

4. **`src/typescript/lib/core/Component.ts`** — import `UNBOUNDED, isUnbounded` (extend the existing `~/primitive/Size.js` import). Migrate: the default `maxSize` (L345) to `UNBOUNDED`; the `getMaxSize` fallback writes `width/height = Number.MAX_VALUE` (L2221-2222) to `UNBOUNDED`; **all** `=== Number.MAX_VALUE` equality branches in `setMaxSize` (the `maxWidth`/`maxHeight` style at L2250-2251 and the `data-maxSize` attribute at L2254), `applyStyle` (L3671-3673), and the `setPreferredSize` (L2111) / `setMinSize` (L2181) `data-` "inf" branches to `isUnbounded(...)`. **Do a literal-for-literal swap of the condition only** — every one of these `data-` branches has a pre-existing copy-paste quirk where the *height* segment's condition reads `next.width` (not `.height`); preserve it exactly (`isUnbounded(next.width)` in both segments), do **not** "fix" it to `.height`, or the parity diff breaks. Verify: `grep -n 'MAX_VALUE' src/typescript/lib/core/Component.ts` — expect zero matches.

5. **`src/typescript/lib/layout/BoxLayout.ts`** — import `Size, UNBOUNDED, isUnbounded` from `~/primitive/Size.js`; add `protected aggregateMaxSize(horizontal: boolean): Size` per *Internal Structure*.

6. **`src/typescript/lib/layout/HBox.ts`** — replace the `getMaxSize` body with `return this.aggregateMaxSize(true);` (retain the override + its JSDoc). Leave `getMinSize`/`getPreferredSize`/`getContentBaseline`/`computeTotalMinSize` untouched (baseline-bespoke). Verify: `grep -n 'MAX_SAFE_INTEGER' src/typescript/lib/layout/HBox.ts` — expect zero matches.

7. **`src/typescript/lib/layout/VBox.ts`** — replace `getMaxSize` body with `return this.aggregateMaxSize(false);`. In `getPreferredSize`, swap the two `Number.MAX_SAFE_INTEGER` literals (L72, L80) to `UNBOUNDED`/`isUnbounded(width)` (cosmetic; keep the first-iteration mechanic). Verify: `grep -n 'MAX_SAFE_INTEGER' src/typescript/lib/layout/VBox.ts` — expect zero matches.

8. **`src/typescript/lib/layout/HFlow.ts`** — import `UNBOUNDED, isUnbounded`; in `getMaxSize` swap the two `>= Number.MAX_SAFE_INTEGER` tests to `isUnbounded(...)` and the two `Number.MAX_SAFE_INTEGER` result writes to `UNBOUNDED`. No structural change. Verify: `grep -n 'MAX_SAFE_INTEGER' src/typescript/lib/layout/HFlow.ts` — expect zero matches.

9. **`src/typescript/lib/layout/Border.ts`** — import `UNBOUNDED, saturate`; replace the `INF` local with `UNBOUNDED`, the `Math.min(_, INF)` calls with `saturate(_)`. Verify: `grep -n 'MAX_SAFE_INTEGER' src/typescript/lib/layout/Border.ts` — expect zero matches.

10. **`src/typescript/lib/layout/Grid.ts`** — import `UNBOUNDED, isUnbounded, saturate`; delete the local `const saturate = …` (use the imported one), swap `>= Number.MAX_SAFE_INTEGER` tests in `trackAxisMax`/`maxChildExtent` to `isUnbounded(...)` and the `return Number.MAX_SAFE_INTEGER` writes to `return UNBOUNDED`. Verify: `grep -n 'MAX_SAFE_INTEGER' src/typescript/lib/layout/Grid.ts` — expect zero matches.

11. **Repo-wide sentinel sweep** — `grep -rn 'MAX_SAFE_INTEGER\|MAX_VALUE' src/typescript/lib/layout/ src/typescript/lib/core/Component.ts` should now show only the helper definitions in `primitive/Size.ts` (and any *intentionally-untouched* `setMaxSize(Number.MAX_VALUE, …)` leaf call sites — see *Non-Goals*). Confirm the remaining hits are exactly those leaves.

12. **`npm run typecheck`** → 0 errors.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/primitive/Size.ts` (add `UNBOUNDED`/`isUnbounded`/`saturate`) |
| Modify | `src/typescript/lib/primitive/index.ts` (export the three) |
| Modify | `src/typescript/lib/layout/LayoutManager.ts` (`_defaultMaxSize`) |
| Modify | `src/typescript/lib/core/Component.ts` (default + all sentinel comparisons) |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` (add `aggregateMaxSize`) |
| Modify | `src/typescript/lib/layout/HBox.ts` (`getMaxSize` → delegate) |
| Modify | `src/typescript/lib/layout/VBox.ts` (`getMaxSize` → delegate; preferred literals) |
| Modify | `src/typescript/lib/layout/HFlow.ts` (Part-A helpers in `getMaxSize`) |
| Modify | `src/typescript/lib/layout/Border.ts` (Part-A helpers in `getMaxSize`) |
| Modify | `src/typescript/lib/layout/Grid.ts` (Part-A helpers; delete local `saturate`) |

---

## Documentation Impact

The refactor is internal except for **three new value exports** from the `primitive` barrel (`UNBOUNDED`, `isUnbounded`, `saturate`). They carry JSDoc (per *Public API*) and surface in the typedoc API docs; Verification step 5 (`npm run docs:build`) confirms they don't break the docs build or introduce link warnings. No hand-written docs pages, recipes, or `ARCHITECTURE.md`/`CODE_CONVENTIONS.md` prose need editing — the aggregation contract these helpers encode is already documented at `ARCHITECTURE.md` §"Size constraints" (L64/L68).

## Verification

This is an almost-pure refactor; the proof is that **no numeric size report changes**, and the **only** rendered-attribute diff is the accepted `MAX_SAFE_INTEGER`-leaf normalization (`9007…px`→`inf`/`none`).

1. **Typecheck:** `npm run typecheck` → 0 errors.
2. **Sentinel sweep (Step 11):** `grep -rn 'MAX_SAFE_INTEGER\|MAX_VALUE' src/typescript/lib/layout/ src/typescript/lib/core/Component.ts` → only `primitive/Size.ts` helpers + the documented untouched leaf `setMaxSize(Number.MAX_VALUE,…)` call sites remain.
3. **Reported-size parity (the core proof):** the framework already writes resolved sizes to DOM `data-` attributes — `data-maxSize`, `data-minSize`, `data-preferredSize`, rendered as `"<w>px <h>px"` or `"inf inf"` ([`Component.setMaxSize` L2254](../src/typescript/lib/core/Component.ts#L2254), etc.). Before the change, on a clean tree run the dev server (`npm run dev`, app on `http://localhost:8015`) and capture these attributes across the layout demo panels; after the change, re-capture and diff. **They must be byte-identical** (an unbounded axis must still read `inf`, not `9007199254740991px`). Use the Chrome DevTools MCP (`evaluate_script`) to snapshot:
   ```js
   [...document.querySelectorAll('[data-maxSize],[data-minSize],[data-preferredSize]')]
     .map(e => [e.className, e.dataset.minSize, e.dataset.preferredSize, e.dataset.maxSize].join('|')).sort().join('\n')
   ```
   Drive each box/flow/border/grid panel: **`HBoxPanel`, `VBoxPanel`, `HFlowPanel`, `BorderPanel`, `GridPanel`, `ColumnPanel`, `RowPanel`, `LayoutTestPanel`, `ComplexUIPanel`** (the panels that exercise the touched managers and the `inf` rendering path). **The diff must be empty *except*** for rows belonging to the `MAX_SAFE_INTEGER` leaf components (`TextField`, `ComboBox`, `Slider`, `NumberSpinner`, `PasswordField`, `Tree`, `AbstractCustomList`, `StatusBar`, the cell editors), whose `maxSize` column flips from a `9007199254740991px …` value to `inf inf` — the accepted normalization. Any *other* changed row, and any change to a `minSize`/`preferredSize` column, is a regression. Because those leaf inputs may not appear on the listed layout panels, also snapshot a panel that hosts them (e.g. an input/form demo) to positively confirm the px→`inf` flip is the *only* difference, not silently absent.
4. **Visual smoke:** screenshot `HBoxPanel`, `VBoxPanel`, `BorderPanel`, `GridPanel`, `HFlowPanel` — no layout shift, no clipped/inflated children, scrollbars appear where they did before.
5. **`npm run docs:build`** → 0 errors, 0 link warnings (the lone acceptable warning is typedoc's "unsupported TypeScript version" notice). Confirms the new `primitive` exports don't break the API docs surface.

---

## Potential Challenges

- **The `MAX_VALUE` → `MAX_SAFE_INTEGER` value migration is where the refactor leaks its one accepted behaviour change** — the `=== MAX_VALUE` rendering branches in `Component`. Widening them to `isUnbounded` keeps every *default*-unbounded component rendering `inf`/`none` (the must-preserve case) but also normalizes the explicit-`MAX_SAFE_INTEGER` leaves from giant-px to `inf`/`none` (the accepted case — see its Architecture Decision). Mitigation: Step 4 migrates *all* of them to `isUnbounded` in the same edit and preserves the height-segment copy-paste quirk verbatim; Verification step 3 proves `inf` still renders for defaults and that the leaf flip is the *only* other diff.
- **`isUnbounded` must use `>=`, not `===`** so it recognises the legacy `MAX_VALUE` still flowing from untouched leaf `setMaxSize(Number.MAX_VALUE,…)` call sites. A `===` test would make those leaves render a giant px value. Mitigation: signature fixed as `n >= Number.MAX_SAFE_INTEGER`.
- **`aggregateMaxSize`'s equal-mode branch must match both originals exactly** — the `count * maxChildMax + spacing*(n-1)` term, the perimeter add on the correct axis, and the `cross = Math.max(cross, …)` accumulation. Mitigation: *Internal Structure* derives the generalised form from both current bodies; Verification step 3 catches any arithmetic drift via the data-attribute diff.
- **`VBox.getPreferredSize`'s seed literal is NOT an unbounded report** — routing it through `saturate`/`aggregateMaxSize` would corrupt the first-iteration logic. Mitigation: the decision above scopes it to a literal swap only; it stays in `getPreferredSize`, untouched in mechanic.

---

## Critical Files

- [`src/typescript/lib/primitive/Size.ts`](../src/typescript/lib/primitive/Size.ts) — where the sentinel + helpers land, beside `Size`.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — the dual producer/consumer of the sentinel; the `=== MAX_VALUE` rendering branches are the behaviour-preservation hinge.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the two `getMaxSize` bodies the accumulator replaces; read both to confirm they are axis-mirror-identical.
- [`ARCHITECTURE.md` § "Size constraints"](../ARCHITECTURE.md#L64) — the authoritative aggregation contract (the contract bullet is at [L68](../ARCHITECTURE.md#L68)).
- [`plans/implemented/size-constraint-invariant-regressions.md`](implemented/size-constraint-invariant-regressions.md) — the as-built record of the divergence this refactor prevents recurring (the `Math.min` cross-axis bug across Grid/HBox/VBox/Border/HFlow).

---

## Non-Goals

- **Touching the leaf `setMaxSize(…)` call sites.** Two distinct literal sets exist: the `Number.MAX_VALUE` set (8 sites across `TabBar`, `ToolBarSeparator`, `Menu`, `FieldSet`) and the larger `Number.MAX_SAFE_INTEGER` set (`TextField`, `Tree`, `Slider`, `NumberSpinner`, `PasswordField`, `AbstractPickerField`, `ComboBox`, `AbstractCustomList`, `StatusBar`, the Date/Time/DateTime/String/Number cell editors). The `MAX_VALUE` set keeps rendering identically because `isUnbounded` is `>=`; the `MAX_SAFE_INTEGER` set's *rendering* changes (see the dedicated Architecture Decision) but the call sites themselves are not edited here. Migrating them to `UNBOUNDED` is a follow-up cosmetic sweep, out of scope here — keeps the diff surgical and the behaviour-parity proof tractable.
- **Folding `HBox`'s baseline-aware cross-axis minimum/preferred into the shared accumulator.** Genuinely asymmetric (`computeRowHeight` over baselines); stays bespoke per the task and the box-class doc.
- **Putting `HFlow` on the Part-B accumulator.** It does not extend `BoxLayout` by design; it adopts Part A only.
- **Changing the `min ≤ preferred ≤ max` enforcement or any reported value.** That is the separate, already-implemented size-constraint-invariant work; this refactor must leave every reported size identical.
