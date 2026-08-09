# BoxLayout `itemAlign` — Implementation Plan

## Overview

Add a cross-axis alignment option `itemAlign` to `BoxLayout` — the shared base of `HBox` and `VBox` — mirroring the `itemAlign` that `FlowLayout` already exposes for its flow subclasses. Today `BoxLayout` offers only a `stretching` boolean plus per-child `anchor`/`fill` (align-self), and geometric CENTER is deliberately inert ([BoxLayout.ts:434](src/typescript/lib/layout/BoxLayout.ts#L434), [BoxLayout.ts:485](src/typescript/lib/layout/BoxLayout.ts#L485)), so an `HBox` cannot vertically-center a shorter control in a taller row. This is what blocks cleanly centering the mixed-height controls in the settings toolbar of `src/typescript/FlowDemoPanel.ts`.

The change introduces `BoxItemAlign = "start" | "center" | "end" | "baseline" | "stretch"` and folds the existing `stretching` boolean into it: `stretching` becomes a deprecated shorthand over `itemAlign`, keeping every existing call site working unchanged. The default `itemAlign` is `"baseline"`, which reproduces today's exact defaults (HBox baseline alignment; VBox west-origin, since VBox has no cross-axis text baseline and degrades `"baseline"` to `"start"`).

Scope is the library layout layer only: `BoxLayout` + `HBox` + `VBox` (both `doLayout` paths — preferred and equal — plus `HBox.getContentBaseline`), the barrel export in [layout/index.ts:27](src/typescript/lib/layout/index.ts#L27), tests, and docs. No consumer panel is touched.

---

## Architecture Decisions

### Mirror `FlowLayout`'s `itemAlign` shape

The precedent is [`FlowLayout`](src/typescript/lib/layout/FlowLayout.ts) — the sibling abstract layout base that already solved cross-axis item alignment. It defines `FlowItemAlign` ([FlowLayout.ts:43](src/typescript/lib/layout/FlowLayout.ts#L43)), a `protected _itemAlign: FlowItemAlign = "start"` field ([FlowLayout.ts:83](src/typescript/lib/layout/FlowLayout.ts#L83)), `getItemAlign`/`setItemAlign` accessors ([FlowLayout.ts:235](src/typescript/lib/layout/FlowLayout.ts#L235)-[255](src/typescript/lib/layout/FlowLayout.ts#L255)), an `applyOptions` dispatch ([FlowLayout.ts:127](src/typescript/lib/layout/FlowLayout.ts#L127)), and a `crossOffset` helper ([FlowLayout.ts:411](src/typescript/lib/layout/FlowLayout.ts#L411)) whose `center`/`end`/`baseline` arms compute the leading cross offset. `BoxLayout` follows this shape exactly: same field name, same accessor names, same option field, same dispatch order. `BoxItemAlign` adds one member `FlowItemAlign` lacks — `"stretch"` — because a box can fill the cross axis (a flow never resizes its cells).

`BoxLayout` uses plain protected fields (`_spacing`, `_stretching`, `_justify`), **not** the `Component` `_options`/`_defaultOptions` bag, so the "class-level defaults must survive the getter" trap and the `default-options-fallback.test.ts` registry do **not** apply here. `getItemAlign()` returns `this._itemAlign` directly, exactly as `getJustify()` returns `this._justify` and `FlowLayout.getItemAlign()` returns its field.

The `declare`/`super()`-cascade rule also does not apply: `BoxLayout`'s constructor calls `applyOptions` from its **own body** after `super()` returns ([BoxLayout.ts:121](src/typescript/lib/layout/BoxLayout.ts#L121)), not from inside `LayoutManager`'s constructor, so the field initializer `_itemAlign = "baseline"` runs before `setItemAlign` dispatches. A plain initializer is correct (matching `FlowLayout`).

### Fold `stretching` into `itemAlign`, keep it as a deprecated shorthand

`_stretching` is replaced by `_itemAlign`. `isStretching()` returns `this._itemAlign === "stretch"`; `setStretching(b)` maps to `setItemAlign(b ? "stretch" : "baseline")`. The `stretching?` option and `isStretching()`/`setStretching()` stay as a `@deprecated` shorthand so all existing call sites — `ToolBar.ts:229`, `MenuBar.ts:69`, `NumberSpinner.ts:120`, `Popover.ts:177`, `Menu.ts:154`, and every `stretching:` option literal across `src/` — keep working with no edit. In `applyOptions`, `stretching` dispatches **first**, then `itemAlign`, so an explicit `itemAlign` wins when both are passed.

Because `isStretching()` now reads `_itemAlign === "stretch"`, all four existing `HBox.isStretching()` call sites and both `VBox.isStretching()` call sites keep their exact behaviour: the stretch value routes through them unchanged.

### Default `"baseline"` reproduces today's behaviour byte-for-byte

Default `_itemAlign = "baseline"`. For `HBox` this is today's baseline alignment. For `VBox` there is no cross-axis text baseline, so `"baseline"` degrades to `"start"` (VBox's current WEST origin) — mirroring how `VFlow` degrades `itemAlign: "baseline"` to `"start"` ([FlowLayout.ts:36](src/typescript/lib/layout/FlowLayout.ts#L36)-[42](src/typescript/lib/layout/FlowLayout.ts#L42)). The implementation guarantees this by leaving the existing baseline / west-origin / stretch placement branches **untouched**; only the three genuinely new values (`"start"`, `"center"`, `"end"`) add a new placement branch.

### Additive placement branch, not a rewrite of the baseline path

`crossPlacement` ([BoxLayout.ts:447](src/typescript/lib/layout/BoxLayout.ts#L447)) is consulted first and stays **unchanged** — a per-child `fill`/`anchor` (align-self) still takes precedence and returns a concrete `{offset, extent}`. Only when it returns `null` (no explicit per-child cross intent) does the layout-level `_itemAlign` decide. Rather than reroute the existing baseline/west-origin/stretch code through a unified helper (which risks changing the default under insets, since the baseline path uses `heights[idx]`/`defaultWidth` while align-self uses trimmed `naturalCross`/`naturalWidth`), the plan adds a **new branch** guarded by `itemAlign ∈ {start, center, end}`:

- `"start"` → child's cross extent at the leading cross edge (offset `0`).
- `"center"` → `crossLead + (crossExtent − childCross) / 2`.
- `"end"` → `crossLead + (crossExtent − childCross)`.

`"baseline"` and `"stretch"` fall through to the existing `else` branch, literally unchanged, so today's defaults are provably preserved. This is the surgical choice: existing tested code is not edited, and the new offsets mirror `FlowLayout.crossOffset`'s `center`/`end` arms.

A shared 3-case helper `crossItemOffset(childCross, crossExtent)` on `BoxLayout` computes the offset (start=`0`, center, end), used by both `HBox` and `VBox`, matching how `crossPlacement`/`justifyOffsets` are shared on the base.

### Per-child CENTER anchor stays inert — Non-Goal

Honouring a per-child `AnchorType.CENTER` as align-self:center would require `crossAnchorEdge` to return a third `"center"` value and `crossPlacement` to express a centered offset. `AnchorType.CENTER` is documented as **deliberately inert** on box layouts ([BoxLayout.ts:434](src/typescript/lib/layout/BoxLayout.ts#L434), [BoxLayout.ts:476](src/typescript/lib/layout/BoxLayout.ts#L476), [docs/layouts/HBox.md:122](docs/layouts/HBox.md)); flipping it to centered would silently change existing behaviour and create two redundant ways to center. Layout-level `itemAlign: "center"` is the sanctioned centering path. See `## Non-Goals`.

---

## Public API

```typescript
// BoxLayout.ts
/**
 * Cross-axis alignment of a child within an HBox row / VBox column, when the
 * child sets no explicit per-child cross intent (fill/anchor align-self).
 * Mirrors FlowLayout's FlowItemAlign, with the extra "stretch" a box can do.
 *
 * - "start"    — leading cross-edge (HBox top, VBox left).
 * - "center"   — centred in the cross band.
 * - "end"      — trailing cross-edge (HBox bottom, VBox right).
 * - "baseline" — HBox: shared text baseline (the default). VBox has no cross
 *                text baseline, so it degrades to "start".
 * - "stretch"  — fill the cross band (equivalent to the deprecated stretching).
 */
export type BoxItemAlign = "start" | "center" | "end" | "baseline" | "stretch";

export interface BoxLayoutOptions extends LayoutManagerOptions {
    spacing?:         number;
    /** @deprecated Use `itemAlign` — `stretching: true` ≡ `itemAlign: "stretch"`. */
    stretching?:      boolean;
    itemAlign?:       BoxItemAlign;
    mode?:            BoxMode;
    overflowSizing?:  BoxOverflowSizing;
    justify?:         BoxJustify;
}

// on BoxLayout:
protected _itemAlign: BoxItemAlign = "baseline"; // replaces `_stretching`

getItemAlign(): BoxItemAlign;                 // returns this._itemAlign
setItemAlign(itemAlign: BoxItemAlign): this;  // caches this._itemAlign

/** @deprecated Use `getItemAlign() === "stretch"`. */
isStretching(): boolean;                      // this._itemAlign === "stretch"
/** @deprecated Use `setItemAlign("stretch" | "baseline")`. */
setStretching(stretching: boolean): this;     // setItemAlign(stretching ? "stretch" : "baseline")

/** Leading cross offset for the start/center/end itemAlign fallback. */
protected crossItemOffset(childCross: number, crossExtent: number): number;
```

`HBoxOptions` and `VBoxOptions` inherit `itemAlign` from `BoxLayoutOptions` with no change.

---

## Internal Structure

The shared helper on `BoxLayout` (only the three new values; baseline/stretch never reach it):

```typescript
protected crossItemOffset(childCross: number, crossExtent: number): number {
    if (this._itemAlign === "center") {
        return Math.max(0, (crossExtent - childCross) / 2);
    }
    if (this._itemAlign === "end") {
        return Math.max(0, crossExtent - childCross);
    }
    return 0; // "start"
}
```

`isStretching` / `setStretching` after the fold:

```typescript
isStretching(): boolean {
    return this._itemAlign === "stretch";
}

setStretching(stretching: boolean): this {
    return this.setItemAlign(stretching ? "stretch" : "baseline");
}
```

The new placement branch (HBox `layoutPreferredMode` shown; the other three call sites follow the same shape). It sits between the existing `if (cross)` align-self branch and the existing `else` baseline branch:

```typescript
if (cross) {
    // align-self — unchanged
    this.placeComponent(component, x, cross.offset, widths[idx], cross.extent, FillType.BOTH);
} else if (this._itemAlign === "start" || this._itemAlign === "center" || this._itemAlign === "end") {
    const y = crossLead + this.crossItemOffset(heights[idx], crossExtent);
    this.placeComponent(component, x, y, widths[idx], heights[idx], FillType.BOTH);
} else {
    // baseline / stretch — existing code, unchanged
    const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);
    this.placeComponent(component, x, y, widths[idx], heights[idx], FillType.BOTH);
}
```

Per-site `childCross` / `crossLead` / `crossExtent` (all already computed locally today):

| Site | crossLead | crossExtent | childCross | placed extent |
|---|---|---|---|---|
| HBox `layoutEqualMode` ([HBox.ts:340](src/typescript/lib/layout/HBox.ts#L340)) | `insets.getTop()` | `containerSize.height` | `heights[idx]` | `heights[idx]` (cellWidth on main) |
| HBox `layoutPreferredMode` ([HBox.ts:500](src/typescript/lib/layout/HBox.ts#L500)) | `insets.getTop()` | `containerSize.height − top − bottom` | `heights[idx]` | `heights[idx]` |
| VBox `layoutEqualMode` ([VBox.ts:329](src/typescript/lib/layout/VBox.ts#L329)) | `insets.getLeft()` | `containerSize.width` | `width` (`size.width`) | `width` (cellHeight on main) |
| VBox `layoutPreferredMode` ([VBox.ts:450](src/typescript/lib/layout/VBox.ts#L450)) | `insets.getLeft()` | `containerSize.width − left − right` | `naturalWidth` ([VBox.ts:488](src/typescript/lib/layout/VBox.ts#L488)) | `naturalWidth` |

For HBox the new branch places `y = crossLead + crossItemOffset(...)`; for VBox it places `x = crossLead + crossItemOffset(...)` (the cross axis is horizontal).

---

## Ordered Implementation Steps

1. **[BoxLayout.ts] Add the `BoxItemAlign` type.** Insert the exported `export type BoxItemAlign = "start" | "center" | "end" | "baseline" | "stretch";` with the JSDoc from `## Public API`, near `BoxJustify` ([BoxLayout.ts:72](src/typescript/lib/layout/BoxLayout.ts#L72)). Add `@category Layouts`.

2. **[BoxLayout.ts] Add the `itemAlign` option field** to `BoxLayoutOptions` ([BoxLayout.ts:87](src/typescript/lib/layout/BoxLayout.ts#L87)); mark the existing `stretching?` with `@deprecated Use itemAlign` in its JSDoc.

3. **[BoxLayout.ts] Replace the `_stretching` field** ([BoxLayout.ts:111](src/typescript/lib/layout/BoxLayout.ts#L111)) with `protected _itemAlign: BoxItemAlign = "baseline";`.

4. **[BoxLayout.ts] Rewrite `isStretching`/`setStretching`** ([BoxLayout.ts:189](src/typescript/lib/layout/BoxLayout.ts#L189)-[204](src/typescript/lib/layout/BoxLayout.ts#L204)) per `## Internal Structure`; add `@deprecated` tags pointing to `getItemAlign`/`setItemAlign`.

5. **[BoxLayout.ts] Add `getItemAlign`/`setItemAlign`** next to the stretching accessors, mirroring `FlowLayout.getItemAlign`/`setItemAlign` ([FlowLayout.ts:235](src/typescript/lib/layout/FlowLayout.ts#L235)-[255](src/typescript/lib/layout/FlowLayout.ts#L255)). `getItemAlign()` returns `this._itemAlign`; `setItemAlign(v)` sets it and returns `this`.

6. **[BoxLayout.ts] Dispatch `itemAlign` in `applyOptions`** ([BoxLayout.ts:138](src/typescript/lib/layout/BoxLayout.ts#L138)): keep the existing `if (options.stretching !== undefined) this.setStretching(...)` block, then **immediately after it** add `if (options.itemAlign !== undefined) this.setItemAlign(options.itemAlign);`. Order matters — `itemAlign` after `stretching` so an explicit `itemAlign` wins.

7. **[BoxLayout.ts] Add the `crossItemOffset` helper** (body in `## Internal Structure`) with JSDoc noting it handles only the start/center/end fallback, mirroring `FlowLayout.crossOffset`'s center/end arms.

8. **[BoxLayout.ts] Update the `crossPlacement` / `crossAnchorEdge` doc comments** ([BoxLayout.ts:424](src/typescript/lib/layout/BoxLayout.ts#L424)-[484](src/typescript/lib/layout/BoxLayout.ts#L484)) so the phrase "each box's default cross placement (HBox baseline, VBox WEST origin) is more specific than geometric centring" reads "…when `itemAlign` is `baseline` (the default); other `itemAlign` values choose the cross offset in the caller." Keep the CENTER-inert statement (it remains true — see Non-Goals). Do not change any logic.

9. **[HBox.ts] Guard `getContentBaseline` on `itemAlign`** ([HBox.ts:45](src/typescript/lib/layout/HBox.ts#L45)-[48](src/typescript/lib/layout/HBox.ts#L48)): replace `if (this.isStretching()) { return null; }` with `if (this._itemAlign !== "baseline") { return null; }` and update the JSDoc `@returns` to say "or `null` when `itemAlign` is not `baseline` (a centred/edge-aligned or stretched row exposes no shared baseline)". `_itemAlign` is protected on the base, so it is directly readable.

10. **[HBox.ts] Add the new branch to `layoutEqualMode`** ([HBox.ts:345](src/typescript/lib/layout/HBox.ts#L345)-[359](src/typescript/lib/layout/HBox.ts#L359)): between the `if (cross)` and the `else` (rowChildY), insert `else if (this._itemAlign === "start" || "center" || "end")` computing `const y = crossLead + this.crossItemOffset(heights[idx], crossExtent);` and `placeComponent(component, x, y, cellWidth, heights[idx], FillType.BOTH)`. `crossLead`/`crossExtent` are already defined at [HBox.ts:340](src/typescript/lib/layout/HBox.ts#L340)-[341](src/typescript/lib/layout/HBox.ts#L341).

11. **[HBox.ts] Add the same branch to `layoutPreferredMode`** ([HBox.ts:519](src/typescript/lib/layout/HBox.ts#L519)-[527](src/typescript/lib/layout/HBox.ts#L527)) using `crossLead`/`crossExtent` from [HBox.ts:500](src/typescript/lib/layout/HBox.ts#L500)-[501](src/typescript/lib/layout/HBox.ts#L501), `heights[idx]` as `childCross`, placed extent `heights[idx]`, main size `widths[idx]`.

12. **[VBox.ts] Add the new branch to `layoutEqualMode`** ([VBox.ts:336](src/typescript/lib/layout/VBox.ts#L336)-[342](src/typescript/lib/layout/VBox.ts#L342)): between `if (cross)` and the `else`, insert `else if (start|center|end)` computing `const cx = crossLead + this.crossItemOffset(width, crossExtent);` and `placeComponent(component, cx, y, width, cellHeight, FillType.BOTH)`. `crossLead`/`crossExtent` from [VBox.ts:329](src/typescript/lib/layout/VBox.ts#L329)-[330](src/typescript/lib/layout/VBox.ts#L330).

13. **[VBox.ts] Add the same branch to `layoutPreferredMode`** ([VBox.ts:496](src/typescript/lib/layout/VBox.ts#L496)-[500](src/typescript/lib/layout/VBox.ts#L500)) using `crossLead`/`crossExtent` from [VBox.ts:450](src/typescript/lib/layout/VBox.ts#L450)-[451](src/typescript/lib/layout/VBox.ts#L451), `naturalWidth` ([VBox.ts:488](src/typescript/lib/layout/VBox.ts#L488)) as `childCross` and placed width, main size `heights[idx]`.

14. **[layout/index.ts] Export `BoxItemAlign`.** Add it to the `export type { BoxLayoutOptions, BoxMode, BoxOverflowSizing, BoxJustify } from '~/layout/BoxLayout.js';` line ([layout/index.ts:27](src/typescript/lib/layout/index.ts#L27)).

15. **[tests] Extend `tests/component/layout/HBox.test.ts`** with setter/getter cases and a geometry suite (see `## Verification`). This file currently has no DOM harness — add the `installTestDOM` + `hostHBox` scaffold copied from `VBox.test.ts` ([VBox.test.ts:1](tests/component/layout/VBox.test.ts#L1)-[35](tests/component/layout/VBox.test.ts#L35), [168](tests/component/layout/VBox.test.ts#L168)-[177](tests/component/layout/VBox.test.ts#L177)).

16. **[tests] Add an `itemAlign` geometry suite to `tests/component/layout/VBox.test.ts`** reusing its existing `hostVBox`.

17. **Typecheck + run the layout tests.** `grep -rn "_stretching" src/typescript/lib/` must return zero matches after step 3.

18. **[docs] Update `docs/layouts/HBox.md` and `docs/layouts/VBox.md`** per `## Documentation Impact` (run through the `document` skill).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/BoxLayout.ts` |
| Modify | `src/typescript/lib/layout/HBox.ts` |
| Modify | `src/typescript/lib/layout/VBox.ts` |
| Modify | `src/typescript/lib/layout/index.ts` |
| Modify | `tests/component/layout/HBox.test.ts` |
| Modify | `tests/component/layout/VBox.test.ts` |
| Modify | `docs/layouts/HBox.md` |
| Modify | `docs/layouts/VBox.md` |

---

## Expected Behaviour

All cases below are **unit-testable** through the offline `TestDOM` harness (the cross-axis geometry is fully modelled). Hosts use `clearInsets()` so origins start at 0 and `crossLead === 0`.

### Accessors / back-compat (pure, no DOM)

- `new HBox().getItemAlign()` → `"baseline"`; `new HBox().isStretching()` → `false`.
- `new VBox().getItemAlign()` → `"baseline"`; `new VBox().isStretching()` → `false`.
- `new HBox({ stretching: true }).getItemAlign()` → `"stretch"`; `.isStretching()` → `true`.
- `new HBox({ stretching: false }).getItemAlign()` → `"baseline"`.
- `setStretching(true)` → `getItemAlign() === "stretch"`; then `setStretching(false)` → `getItemAlign() === "baseline"`.
- `setItemAlign("stretch")` → `isStretching() === true`; `setItemAlign("center")` → `isStretching() === false`.
- Precedence: `new HBox({ stretching: true, itemAlign: "center" }).getItemAlign()` → `"center"` (itemAlign dispatched after stretching).
- Round-trip: `setItemAlign("end")` then `getItemAlign()` → `"end"`.

### HBox cross placement — host `200 × 24`, single child preferred `100 × 16`

- `itemAlign: "start"` → child `y === 0`, `height === 16`.
- `itemAlign: "center"` → child `y === 4` (`(24 − 16) / 2`), `height === 16`.
- `itemAlign: "end"` → child `y === 8` (`24 − 16`), `height === 16`.
- `itemAlign: "stretch"` → child `y === 0`, `height === 24` (fills the row).
- `stretching: true` (no `itemAlign`) → identical to `itemAlign: "stretch"`: `y === 0`, `height === 24` (proves the back-compat equivalence).
- Default (`itemAlign` omitted) with a single non-baseline child behaves as today (top-aligned when no child reports a baseline).

### HBox `getContentBaseline`

- Default `HBox` (itemAlign `"baseline"`) hosting a `Text('Label')` child → returns a non-null number (unchanged from today).
- Same row with `itemAlign: "center"` → returns `null`.
- Same row with `itemAlign: "stretch"` (or `setStretching(true)`) → returns `null` (unchanged from today, now via the `!== "baseline"` guard).

### VBox cross placement — host `24 × 200`, single child preferred `16 × 100`

- `itemAlign: "start"` → child `x === 0`, `width === 16`.
- `itemAlign: "center"` → child `x === 4`, `width === 16`.
- `itemAlign: "end"` → child `x === 8`, `width === 16`.
- `itemAlign: "stretch"` (or `stretching: true`) → child `x === 0`, `width === 24` (fills the column).
- Default (`itemAlign` omitted, `"baseline"` degrades to `"start"`) → child `x === 0`, `width === 16` — identical to today's west-origin placement.

### Regression (unchanged existing suites)

- Every current `VBox.test.ts` geometry and baseline-forwarding case still passes (stack offsets, stretching fill, weight split, first-child baseline forwarding, stretching-still-forwards-baseline).
- Per-child align-self (`fill: FillType.VERTICAL`, `anchor: NORTH/SOUTH`) still overrides `itemAlign` for that child only (`crossPlacement` runs first, unchanged) — verify with one HBox case: a `SOUTH`-anchored child under `itemAlign: "center"` pins to the row bottom while siblings centre.

---

## Verification

- **Typecheck:** `npm run typecheck` (or the project's tsc task) — clean.
- **Invariant:** `grep -rn "_stretching" src/typescript/lib/` → zero matches (field fully replaced).
- **Unit tests:** `npx vitest run tests/component/layout/HBox.test.ts tests/component/layout/VBox.test.ts` — the new suites in `## Expected Behaviour` plus all pre-existing cases pass. Follow the harness pattern in `VBox.test.ts`: `installTestDOM(CONFIG)`, build a `Container({ layoutManager })`, `getElement(true)`, `setWidth`/`setHeight`, `clearInsets()`, `addComponent(new Component({ preferredSize }))`, `host.doLayout()`, assert `getX/getY/getWidth/getHeight`. `afterEach(() => DOM.reset())`.
- **Full layout suite:** run the whole `tests/component/layout/` directory to catch any manager that read `stretching` indirectly (none expected — `isStretching` is the only accessor and it is preserved).
- **Docs build:** `npm run docs:build` must finish with zero TypeDoc warnings (public JSDoc must not `{@link}` internal-only symbols; `BoxItemAlign` is exported so linking it is fine).
- **Manual smoke (optional, not required for red-green):** the motivating toolbar is a Non-Goal; no app screen change ships in this plan.

---

## Documentation Impact

`BoxItemAlign` is exported from `~/layout/BoxLayout.js` and re-exported through the `~/layout` barrel ([layout/index.ts:27](src/typescript/lib/layout/index.ts#L27)), so TypeDoc generates `/api/layout/type-aliases/BoxItemAlign` — mirror the existing `FlowItemAlign` page cross-links.

- **`docs/layouts/HBox.md`** — add `itemAlign` to the options sentence ([HBox.md:26](docs/layouts/HBox.md)) and add an "Item alignment" section modelled on `docs/layouts/HFlow.md` ([HFlow.md:97](docs/layouts/HFlow.md)-[118](docs/layouts/HFlow.md)), linking `[BoxItemAlign](/api/layout/type-aliases/BoxItemAlign)`. Note that `stretching` is now the deprecated shorthand for `itemAlign: "stretch"`, and that the baseline discussion ([HBox.md:146](docs/layouts/HBox.md)-[157](docs/layouts/HBox.md)) is the `itemAlign: "baseline"` (default) behaviour.
- **`docs/layouts/VBox.md`** — add `itemAlign` to its options list; note `"baseline"` degrades to `"start"` (VBox has no cross-axis text baseline), matching the `VFlow` wording.
- **`docs/layouts/index.md`** — optionally extend the HBox/VBox rows to mention cross-axis `itemAlign`, as the HFlow/VFlow rows already do ([index.md:20](docs/layouts/index.md)-[21](docs/layouts/index.md)).
- **`llms.txt`** is generated by `scripts/llms/generate.mjs` (`npm run docs:llms`, part of `docs:build`) — no manual edit; it picks up the new export.
- The `document` skill owns these edits per the project's documentation workflow.

---

## Potential Challenges

- **VBox `layoutPreferredMode` `naturalWidth` vs `defaultWidth`.** The new `start`/`center`/`end` branch uses `naturalWidth` (trimmed to the inset band) as both `childCross` and the placed width, whereas the untouched default/baseline branch uses `defaultWidth` (capped to un-trimmed `containerSize.width`). They differ only for a child wider than the inset-trimmed band with non-zero left/right insets — an edge case; in the inset-free common case they are equal. The default (baseline→start) path is deliberately left on `defaultWidth` to keep today's behaviour byte-identical.
- **HBox `crossExtent` differs between modes** — `containerSize.height` (un-trimmed) in equal mode vs trimmed in preferred mode. This is pre-existing (matches the equal-stretch band comment at [HBox.ts:337](src/typescript/lib/layout/HBox.ts#L337)-[341](src/typescript/lib/layout/HBox.ts#L341)); the new branch reuses the same locals, so centering is consistent with the existing stretch band in each mode.
- **Ordering in `applyOptions`.** If `itemAlign` were dispatched before `stretching`, `stretching: true` would clobber an explicit `itemAlign`. Step 6 fixes the order; the precedence test guards it.
- **`stretch` must not reach `crossItemOffset`.** The new branch guards on `{start, center, end}` only, so `"stretch"` and `"baseline"` fall to the existing `else` — where `isStretching()` (now `=== "stretch"`) already drives the fill via `heights[idx]`/`rowAscent = null`. Do not add `"stretch"` to the guard.

---

## Critical Files

- [`src/typescript/lib/layout/FlowLayout.ts`](src/typescript/lib/layout/FlowLayout.ts) — **the precedent.** `FlowItemAlign` (43), `_itemAlign` field (83), `applyOptions` dispatch (127), `getItemAlign`/`setItemAlign` (235-255), `crossOffset` (411). Mirror its shape.
- [`src/typescript/lib/layout/BoxLayout.ts`](src/typescript/lib/layout/BoxLayout.ts) — the base being extended: options bag (87), fields (110-114), `applyOptions` (138), stretching accessors (189-204), `crossPlacement` (447), `crossAnchorEdge` (485).
- [`src/typescript/lib/layout/HBox.ts`](src/typescript/lib/layout/HBox.ts) — `getContentBaseline` (45), `layoutEqualMode` else-branch (345-359), `layoutPreferredMode` else-branch (505-534), `rowChildY` (647, kept for the baseline path).
- [`src/typescript/lib/layout/VBox.ts`](src/typescript/lib/layout/VBox.ts) — `layoutEqualMode` (332-345), `layoutPreferredMode` cross placement (456-507), `naturalWidth` (488).
- [`src/typescript/lib/layout/LayoutManager.ts`](src/typescript/lib/layout/LayoutManager.ts) — `nullChildY` (522), `computeRowMetrics` (538) used by the untouched baseline path.
- [`tests/component/layout/VBox.test.ts`](tests/component/layout/VBox.test.ts) — the geometry-harness template (`installTestDOM`, `hostVBox`, `hostHBox`).
- [`tests/component/layout/FlowLayout.test.ts`](tests/component/layout/FlowLayout.test.ts) — the accessor-test template (defaults + round-trip for `itemAlign`).
- [`src/typescript/lib/layout/index.ts`](src/typescript/lib/layout/index.ts) — barrel export (27).

---

## Non-Goals

- **Per-child `AnchorType.CENTER` as align-self:center.** `AnchorType.CENTER` stays deliberately inert on box layouts. Honouring it would change `crossAnchorEdge`'s `"lead" | "trail" | null` contract, silently alter existing CENTER-anchored children, and duplicate the layout-level `itemAlign: "center"` path. Centering is expressed via `itemAlign`.
- **Modifying `src/typescript/FlowDemoPanel.ts`.** Its settings toolbar is the motivating consumer but stays baseline-aligned for now. The follow-up (a separate change) would replace `bar.setStretching(false)` at [FlowDemoPanel.ts:111](src/typescript/FlowDemoPanel.ts) with `bar.setItemAlign("center")` to vertically-center the mixed-height controls — out of scope here.
- **VBox `getContentBaseline` changes.** VBox forwards its first child's baseline regardless of cross-axis alignment (itemAlign moves children horizontally, not vertically), so its baseline exposure is unaffected. Only `HBox.getContentBaseline` gains the `itemAlign` guard.
- **New demo panel / app UI for BoxLayout itemAlign.** Not requested.
