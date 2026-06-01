# Padding-Aware Layout Content Insets — Implementation Plan

## Overview

CSS padding on a container is already honored by the content *area size* — [`Component.getPerimiterSize()`](../src/typescript/lib/core/Component.ts#L2013) sums inset + border + padding per side, and [`getInnerSize()`](../src/typescript/lib/core/Component.ts#L1898) subtracts that whole perimeter, so a child's width/height is correct. The remaining defect is the child **origin**: every framework `Component` is `position: absolute` ([Component.ts:218](../src/typescript/lib/core/Component.ts#L218), [render() at Component.ts:631](../src/typescript/lib/core/Component.ts#L631)), so a child's containing block is its positioned parent's **padding box**. A child placed at `left: 0` lands at the inner edge of the parent's border — the *outer* edge of the padding — so the browser does not push it inward by padding. Layout managers compute the child origin from `container.getInsets()` (inset only, no padding), so the padding allowance that `getInnerSize` already removed from the child's width piles entirely onto the far (right/bottom) side. Border is correctly excluded from the origin (the containing-block edge is already inside the border) and already subtracted from size, so **only padding must be added to the origin**.

The fix is a new pure accessor [`Component.getContentInsets()`](../src/typescript/lib/core/Component.ts#L1096) returning `inset + padding` per side (border excluded), and a switch from `getInsets()` to `getContentInsets()` at every **origin** call site across the layout managers. Separately, `HBox`/`VBox` size-hint methods add back bare `getInsets() + getBorderSize()` (border present, padding missing) — these switch to `getPerimiterSize()` so a padded container reports its true footprint to its parent. Touches: [Component.ts](../src/typescript/lib/core/Component.ts), [HBox.ts](../src/typescript/lib/layout/HBox.ts), [VBox.ts](../src/typescript/lib/layout/VBox.ts), [Grid.ts](../src/typescript/lib/layout/Grid.ts), [Border.ts](../src/typescript/lib/layout/Border.ts), [Card.ts](../src/typescript/lib/layout/Card.ts), [Fit.ts](../src/typescript/lib/layout/Fit.ts), [Accordion.ts](../src/typescript/lib/layout/Accordion.ts), [Table.ts](../src/typescript/lib/layout/Table.ts), [Tab.ts](../src/typescript/lib/layout/Tab.ts), [Split.ts](../src/typescript/lib/layout/Split.ts).

---

## Architecture Decisions

### `getContentInsets` is a pure, derived accessor — no field, no option

It computes from two existing accessors (`getInsets()`, `getPadding()`) on every call; both are O(1) cached reads. There is no new consumer-configurable property, so per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) "All attributes and styles go through typed setters" rule #3 it must **not** be added to `ComponentOptions` and must **not** get a backing field — it is derived state, not stored state. This mirrors `getPerimiterSize()`, which is likewise a pure derivation with no field. Returns a fresh `Insets` each call (cheap, four-number construction), matching the brief's requirement that call sites change by exactly one token (`getInsets()` → `getContentInsets()`, both yielding `.getLeft()/.getTop()`).

### The offset stays in each `doLayout`, never in `commitBounds`

Per the standing decision, [`LayoutManager.commitBounds`](../src/typescript/lib/layout/LayoutManager.ts#L338) remains the raw "write exactly these bounds" primitive and documented bypass path (overflow placement, the Grid clip-frame at [Grid.ts:797–798](../src/typescript/lib/layout/Grid.ts#L797), `Absolute`'s natural-size placement). Padding is added to the origin by each manager before it calls `placeComponent`/`commitBounds`/`setX`/`setY` — never centralized. `commitBounds` and `resolveBounds` are untouched.

### Only ORIGIN uses of `getInsets()` convert; size-hint chrome math is handled separately

Each manager's `getInsets()` call is classified origin vs. non-origin. Origin uses (the x/y starting offset for children) switch to `getContentInsets()`. Size-hint chrome (the inset/border the manager adds back to report its own footprint) is addressed by switching `HBox`/`VBox` to `getPerimiterSize()` — see _Decision: HBox/VBox size hints_. `Grid`/`Border`/`Card`/`Fit` size hints already use `getPerimiterSize()`, so no size-hint change is needed there.

### HBox/VBox size hints switch to `getPerimiterSize()` (also fixes a latent padding omission)

`HBox.getPreferredSize/getMinSize/getMaxSize` and the `VBox` equivalents currently build chrome as `containerInsets.get*() + containerBorderSize.*` — border is included but **padding is omitted**. With padding now real layout space, a padded `HBox`/`VBox` under-reports its footprint to its parent. Replacing both terms with `container.getPerimiterSize()` (inset + border + padding) reports the true footprint. (`Grid`/`Border`/`Card`/`Fit` already do this — the omission is `HBox`/`VBox`-only.) The brief framed this as a "latent border omission"; on this branch the omission is **padding**, not border — border is already present in these methods.

### `Absolute` is out of scope (no origin to convert)

The brief lists `Absolute` in the general set, but [Absolute.ts](../src/typescript/lib/layout/Absolute.ts) places each child at the child's *own* `getX()/getY()` via `commitBounds` ([Absolute.ts:54–57](../src/typescript/lib/layout/Absolute.ts#L54)) — it never reads `container.getInsets()` and computes no container-relative origin. There is nothing to convert. This is the documented natural-placement bypass; leave it.

### Split.recalculateSizes (`Split.ts:365`) is NOT an origin use — leave it

The brief flagged `Split.ts:354` (now [365](../src/typescript/lib/layout/Split.ts#L365)) as a possible origin. It is not. `recalculateSizes` uses `containerInsets` only at [Split.ts:402/404](../src/typescript/lib/layout/Split.ts#L402) to compute a child *extent* (`containerSize.width - insets.left - insets.right`) — and `containerSize` there is already `getInnerSize()` (which already subtracted the full perimeter), so this line is a pre-existing double-subtract of insets, not an origin offset. Converting it would not fix that and is outside this plan's "origin only" rule. Flag the latent double-subtract as a mention-only observation; do not change it. Only the `doLayout` origin at [Split.ts:272](../src/typescript/lib/layout/Split.ts#L272) converts.

### FieldSet needs NO change — its premise in the brief is stale

The brief anticipated manual horizontal padding math (`chromeW = perim.left + perim.right + padW`) to remove. On this branch there is **no such `+ padW` term**. [`clampLegendWidth` (FieldSet.ts:109–110)](../src/typescript/lib/component/container/FieldSet.ts#L109) and [`getMinSize` (FieldSet.ts:133–134)](../src/typescript/lib/component/container/FieldSet.ts#L133) already compute `chromeW = perim.left + perim.right` where `perim = this.getPerimiterSize()`, which already counts padding exactly once. There is no double-count to undo. The legend-clearance top padding (`padding: new Insets(15, 3, 3, 3)` default at [FieldSet.ts:28](../src/typescript/lib/component/container/FieldSet.ts#L28)) reserves the notch and stays.

**Correction (post-implementation):** this "no FieldSet edits" conclusion was wrong, and the eventual fix reframed the chrome itself. A `<fieldset>` reserves its `<legend>`'s height at the top of the content box automatically — the browser offsets absolutely-positioned children below the legend regardless of CSS padding (measured: the content-box top offset is the same whether `padding-top` is 0 or 15). So the original `padding: Insets(15,3,3,3)` was not what created the top clearance; the legend was. The padding's only real effect was making `getInnerSize` reserve ~15px of height, while the base `getContentInsets` (which adds padding on every side) wrongly *also* pushed the child origin down — double-counting against the legend offset and clipping the bottom row.

The shipped fix drops CSS padding entirely and treats the clearance as intrinsic chrome: `insets` become `Insets(5, 8, 8, 8)`, and a `FieldSet`-local `getPerimiterSize` override adds the measured legend height to the `top` perimeter so `getInnerSize` reserves it for height — without the inset feeding the child origin (the browser supplies that offset). No CSS padding, no `getContentInsets` override, and the clearance now tracks the font instead of a hard-coded 15. The horizontal/`getMinSize`/`clampLegendWidth` analysis above is still correct.

---

## Public API (TypeScript Signatures)

```typescript
// Component.ts — new pure accessor, placed adjacent to getPadding/getInsets.
// Returns inset + padding per side (border excluded). Works when padding is
// null (FieldSet is the only setter today; getPadding() returns null otherwise).
getContentInsets(): Insets;
```

Backing logic (no field, no option):

```typescript
getContentInsets(): Insets {
    const insets  = this.getInsets();          // always an Insets (never null)
    const padding = this.getPadding();          // Insets | null

    if (!padding) {
        return new Insets(insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft());
    }

    return new Insets(
        insets.getTop()    + padding.getTop(),
        insets.getRight()  + padding.getRight(),
        insets.getBottom() + padding.getBottom(),
        insets.getLeft()   + padding.getLeft(),
    );
}
```

`Insets` constructor is `(top, right, bottom, left)` ([Insets.ts:31](../src/typescript/lib/primitive/Insets.ts#L31)) with `getTop/getRight/getBottom/getLeft` ([Insets.ts:45–107](../src/typescript/lib/primitive/Insets.ts#L45)) — verified. `getInsets()` returns a non-null `Insets` ([Component.ts:1096](../src/typescript/lib/core/Component.ts#L1096)); `getPadding()` returns `Insets | null` ([Component.ts:1136](../src/typescript/lib/core/Component.ts#L1136)). The method needs an explicit return type and a JSDoc block per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md).

---

## Origin Call-Site Inventory (verified at write time)

Each row is the single line per manager that reads the container inset for the child **origin**; switch that one read from `getInsets()` to `getContentInsets()`. Downstream `.getLeft()/.getTop()` reads (and, for Grid, the `Insets` passed into `layoutOccupancy`) inherit the change automatically.

| Manager | Origin read | Downstream origin sinks (inherit, no edit) |
|---|---|---|
| HBox | [HBox.ts:414](../src/typescript/lib/layout/HBox.ts#L414) (`doLayout`) | x/y at 455–456, 490, 502–507, 640, 649+ |
| VBox | [VBox.ts:400](../src/typescript/lib/layout/VBox.ts#L400) (`doLayout`) | x/y at 435–436, and preferred-mode origins below |
| Grid | [Grid.ts:526](../src/typescript/lib/layout/Grid.ts#L526) (`doLayout`) | 559, 582; passed as `insets` param to `layoutOccupancy` → 766/772 |
| Border | [Border.ts:413](../src/typescript/lib/layout/Border.ts#L413) (`doLayout`) | region origins + `ignoreParentInsets` add-backs (451–453, 447, …) |
| Card | [Card.ts:295](../src/typescript/lib/layout/Card.ts#L295) (`doLayout`) | 311–312 |
| Fit | [Fit.ts:258](../src/typescript/lib/layout/Fit.ts#L258) (`doLayout`) | 274–275 |
| Accordion | [Accordion.ts:545](../src/typescript/lib/layout/Accordion.ts#L545) (`doLayout`) | 558, 566, 583 (header/wrapper origin; `component.setX/Y(0)` at 588–589 is inside the wrapper — leave) |
| Table | [Table.ts:97](../src/typescript/lib/layout/Table.ts#L97) (`doLayout`) | header 146–147, footer 246–247, body 272–273 |
| Tab | [Tab.ts:1067](../src/typescript/lib/layout/Tab.ts#L1067) (`doLayout`) | toolbar 1120–1121, content 1184–1185 |
| Split | [Split.ts:272](../src/typescript/lib/layout/Split.ts#L272) (`doLayout`) | x/y at 292–293 |

Non-origin / leave-as-`getInsets()`:
- `Split.ts:365` (`recalculateSizes`) — child-extent math, see Architecture Decisions.
- `Border` `ignoreParentInsets` add-backs at [Border.ts:447/451–453](../src/typescript/lib/layout/Border.ts#L447): these add the container inset *back* into a region's width/origin when a region opts out of insets. Because they derive from the **same** `containerInsets` variable as the region origin, converting the single `doLayout` read to `getContentInsets()` makes the add-back include padding too — which is consistent (innerSize subtracted padding, so the opt-out region reclaiming the full content area must add padding back). This is correct, not a bug; no separate edit, but verify the `ignoreParentInsets` north/south regions still span edge-to-edge after the change.

Size-hint reads that switch to `getPerimiterSize()` (HBox/VBox only):
- HBox `getPreferredSize` [168/206–207](../src/typescript/lib/layout/HBox.ts#L168), `getMinSize` [232/270–271](../src/typescript/lib/layout/HBox.ts#L232), `getMaxSize` [294/326–327](../src/typescript/lib/layout/HBox.ts#L294).
- VBox `getPreferredSize` [154/170–172/190–191](../src/typescript/lib/layout/VBox.ts#L154), `getMinSize` [215/…](../src/typescript/lib/layout/VBox.ts#L215), `getMaxSize` [276/292–294/312–313](../src/typescript/lib/layout/VBox.ts#L276).

Each of these methods currently holds *both* a `containerInsets = container.getInsets()` and a `containerBorderSize = container.getBorderSize()` and adds `insets.get* + borderSize.*` as chrome. Replace with a single `perimiterSize = container.getPerimiterSize()` and add `perimiterSize.left/right/top/bottom`, deleting the now-unused `containerInsets` and `containerBorderSize` locals. `getPerimiterSize()` returns a `PerimeterSize` with `.top/.right/.bottom/.left` numeric fields ([Component.ts:2013](../src/typescript/lib/core/Component.ts#L2013)) — field access, not getter calls.

---

## Ordered Implementation Steps

1. **Add `getContentInsets()` to `Component.ts`** adjacent to `getPadding`/`getPerimiterSize`, with the body and JSDoc above. → verify: `npm run typecheck` clean.

2. **Convert the ten origin reads** (one per manager in the inventory table) from `container.getInsets()` to `container.getContentInsets()`. Leave the local variable name as-is (`containerInsets`/`insets`) — only the right-hand accessor changes, so downstream `.getLeft()/.getTop()` and the Grid `layoutOccupancy` param are untouched. → verify after each: type-check.

3. **Switch HBox size hints to `getPerimiterSize()`** in `getPreferredSize`/`getMinSize`/`getMaxSize`: replace the `containerInsets`/`containerBorderSize` locals with one `perimiterSize` and update the chrome add-backs (`width += perimiterSize.left + perimiterSize.right`, `height += perimiterSize.top + perimiterSize.bottom`). Match existing blank-line style.

4. **Switch VBox size hints to `getPerimiterSize()`** the same way in `getPreferredSize`/`getMinSize`/`getMaxSize`, including the inline `width/height = ...` initializers (VBox seeds `height` from insets at e.g. [VBox.ts:178/300](../src/typescript/lib/layout/VBox.ts#L178)).

5. **Grep checkpoint — origin uses converted:**
   ```
   grep -rn 'getInsets()' src/typescript/lib/layout/
   ```
   Expect only `Split.ts:365` (recalculateSizes, intentional) remaining across the targeted managers; every `doLayout`/direct-positioner origin read is now `getContentInsets()`.

6. **Verify no orphaned locals:** after steps 3–4, confirm `containerBorderSize` / `containerInsets` are no longer referenced inside the HBox/VBox size-hint methods (otherwise type-check flags unused-but-not-error; visually remove). → `npm run typecheck` clean.

7. **Confirm FieldSet untouched** — no edits; the Binding demo symmetry comes from the manager origin fix.

8. **Docs:** add one sentence to [docs/concepts/sizing.md](../docs/concepts/sizing.md) near the `getInnerSize()` paragraph (line ~69) noting that layout managers offset the child origin by `getContentInsets()` (inset + padding, border excluded) so padding is honored symmetrically. The typed API page for `Component.getContentInsets` is auto-generated by typedoc.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — add `getContentInsets()` |
| Modify | [src/typescript/lib/layout/HBox.ts](../src/typescript/lib/layout/HBox.ts) — origin + 3 size hints |
| Modify | [src/typescript/lib/layout/VBox.ts](../src/typescript/lib/layout/VBox.ts) — origin + 3 size hints |
| Modify | [src/typescript/lib/layout/Grid.ts](../src/typescript/lib/layout/Grid.ts) — origin only |
| Modify | [src/typescript/lib/layout/Border.ts](../src/typescript/lib/layout/Border.ts) — origin only |
| Modify | [src/typescript/lib/layout/Card.ts](../src/typescript/lib/layout/Card.ts) — origin only |
| Modify | [src/typescript/lib/layout/Fit.ts](../src/typescript/lib/layout/Fit.ts) — origin only |
| Modify | [src/typescript/lib/layout/Accordion.ts](../src/typescript/lib/layout/Accordion.ts) — origin only |
| Modify | [src/typescript/lib/layout/Table.ts](../src/typescript/lib/layout/Table.ts) — origin only |
| Modify | [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — origin only |
| Modify | [src/typescript/lib/layout/Split.ts](../src/typescript/lib/layout/Split.ts) — `doLayout` origin only (not `recalculateSizes`) |
| Modify | [docs/concepts/sizing.md](../docs/concepts/sizing.md) — one-sentence mention |

---

## Verification

- **Type-check:** `npm run typecheck` — clean (use `npm run typecheck`, NOT `npx tsc --noEmit`, which selects the wrong tsconfig).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). Confirm `Component.getContentInsets` appears on the generated `docs/api/core/classes/Component.md`.
- **Grep invariant:** `grep -rn 'getInsets()' src/typescript/lib/layout/` returns only `Split.ts:365` among the targeted managers (every origin read converted).
- **Manual smoke** at `http://localhost:8015` (`npm run dev`):
  - **Binding demo** (FieldSet "Information", [src/typescript/BindingPanel.ts](../src/typescript/BindingPanel.ts)): the FieldSet's content now has **symmetric** left/right inset (previously the padding piled on the right). Top/bottom symmetric too, with the legend notch preserved at top.
  - **Grid demo** ([src/typescript/GridPanel.ts](../src/typescript/GridPanel.ts)): still clips/scrolls the oversized pinned child correctly — the clip-frame path (`setClipFrame` + `commitBounds`) is unaffected.
  - Toggle stretching on/off for an HBox/VBox/Grid panel to confirm no regression in stretched placement; confirm a Border layout with a `ignoreParentInsets` region still spans edge-to-edge.

---

## Potential Challenges

- **`getContentInsets` allocates an `Insets` per call.** `doLayout` runs per layout pass, not per frame; the four-number allocation is negligible and matches the existing `getPerimiterSize` pattern. No caching needed.
- **HBox/VBox size-hint rewrite touches arithmetic split across `width`/`height` initializers and trailing add-backs.** Re-read each method after editing to confirm every inset+border term became a single perimeter term and no side is double-counted or dropped. The grep invariant plus type-check catch orphaned locals.
- **Border `ignoreParentInsets` regions** now add padding back into their reclaimed area. This is consistent with `getInnerSize` subtracting padding, but visually verify a north/south region still reaches both edges.

---

## Critical Files

- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `getInsets`/`getPadding`/`getPerimiterSize`/`getInnerSize`/`setX`/`setY` and the `position: absolute` base rule; new method lands here.
- [src/typescript/lib/primitive/Insets.ts](../src/typescript/lib/primitive/Insets.ts) — constructor + getter shape the new method builds on.
- [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — `placeComponent`/`resolveBounds`/`commitBounds` (the seam origins flow through; untouched).
- [src/typescript/lib/component/container/FieldSet.ts](../src/typescript/lib/component/container/FieldSet.ts) — confirm the no-change conclusion before declaring done.

---

## Non-Goals

- **No change to `commitBounds`/`resolveBounds`** — the deliberate raw-write primitive and documented bypass path stays exactly as is.
- **No new public option or theme token** — this is internal layout math; `getContentInsets` is a derived accessor only.
- **No FieldSet edits** — its padding math is already correct on this branch (see Architecture Decisions).
- **No fix to the `Split.recalculateSizes` latent inset double-subtract** — observed and flagged, but it is a non-origin site outside this plan's scope.
- **No `Absolute` change** — it places children at their own coordinates and reads no container inset.
