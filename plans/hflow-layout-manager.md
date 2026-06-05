# HFlow Layout Manager — Implementation Plan

## Overview

`HFlow` is a wrapping horizontal box: a new [`LayoutManager`](../src/typescript/lib/layout/LayoutManager.ts#L29) that packs children left-to-right and wraps to a new line when the next child would exceed the container's inner width. It lives in a new file `src/typescript/lib/layout/HFlow.ts`, `callable`-wrapped with the same `_HFlow` / `HFlowCallable` export pair HBox uses at [HBox.ts:776](../src/typescript/lib/layout/HBox.ts#L776).

Cross-axis (vertical) growth reuses the existing overflow path. When the stacked lines exceed the inner height and the host `Panel` has opted into vertical scroll (`autoScroll`), the working size is inflated on the Y axis and [`reserveContentFrame`](../src/typescript/lib/layout/LayoutManager.ts#L189) wraps the children so the host's native `overflow: auto` produces the vertical scrollbar — exactly the mechanism HBox/VBox use on their main axes ([HBox.ts:501](../src/typescript/lib/layout/HBox.ts#L501), [VBox.ts:440](../src/typescript/lib/layout/VBox.ts#L440)).

The manager mirrors the project's HBox/VBox convention — each box extends `LayoutManager` directly with its own copy of the size-hint and placement code, no shared base. The new public surface is `HFlow` plus `HFlowOptions`, re-exported from the layout barrel at [layout/index.ts:19-22](../src/typescript/lib/layout/index.ts#L19), with a curated docs page and a demo tab.

---

## Architecture Decisions

### Extends `LayoutManager` directly, no `FlowBase`

The project deliberately duplicates box code: VBox copies HBox's structure rather than sharing a `Box` base (compare [HBox.ts](../src/typescript/lib/layout/HBox.ts) and [VBox.ts](../src/typescript/lib/layout/VBox.ts) — only `BoxMode`/`BoxOverflowSizing` are imported from HBox). HFlow follows suit: it extends `LayoutManager` and carries its own `doLayout`, size hints, and `computeTotalContentHeight` helper. This keeps each manager single-responsibility and readable in isolation, at the cost of intentional duplication.

### VFlow is a clean later mirror (non-goal here)

The file is structured so a future `VFlow` (vertical-wrap: pack top-to-bottom, wrap into new columns, horizontal scroll) is a mechanical axis-swap of HFlow, the same way VBox mirrors HBox. HFlow names its line-stacking helper and its inflate branch on concrete axes (line = horizontal run, wrap advances `y`) so the mirror is obvious. VFlow is **not** built here (see Non-Goals).

### Vertical scroll reuses the overflow inflation, never the shrink path

HBox/VBox shrink children toward min when content overflows on the main axis. HFlow does **not** shrink on its wrap (vertical) axis — wrapping *is* the overflow relief. When stacked lines exceed inner height and `isOverflowingY()` is true, HFlow lays out against the true stacked content height (`max(innerHeight, totalContentHeight)`) instead of the clamped inner height, so trailing lines land past `innerSize.height` and the host's `overflow: auto` (set by `Panel.setAutoScroll`, [Panel.ts:216](../src/typescript/lib/core/Panel.ts#L216), which forwards to `setOverflowing(x, y)` at [Panel.ts:252](../src/typescript/lib/core/Panel.ts#L252)) engages. When `isOverflowingY()` is false the lines still stack from the top inset but the host's `overflow: hidden` clips anything past the inner height — identical to HBox's clamp-and-clip default.

### `getPreferredSize` is a documented single-line approximation

Real height-for-width can only be resolved at `doLayout` time (the wrap count depends on the assigned width, which the parent has not committed when it queries the hint). So `getPreferredSize` reports the **single-line** shape: width = sum of child preferred widths + `spacing*(n-1)`, height = tallest child (baseline-aware row height, reusing `computeRowHeight`). This matches HBox's preferred-mode width exactly. The parent layout absorbs the difference: the host `Panel` scrolls when the real wrapped height exceeds what the hint implied. This rationale is restated in the JSDoc `@remarks`.

### `getMinSize` — narrowest viable width, tallest child

Anything can wrap onto its own line, so the smallest width that still lays out is the widest single child's min width (plus perimeter). Height = tallest child's min height (plus perimeter). This is the floor below which even one-child-per-line cannot fit.

### `getMaxSize` mirrors HBox preferred-mode max

HBox's `getMaxSize` ([HBox.ts:361](../src/typescript/lib/layout/HBox.ts#L361)) in preferred mode returns width = sum of child widths + spacing, height = `min` of child max heights. HFlow has no `"equal"` mode, so it keeps only that branch: width = sum of child preferred widths + `spacing*(n-1)` + perimeter; height = `min(child.maxSize.height)` + perimeter, starting from `Number.MAX_SAFE_INTEGER`. Simple and consistent with the existing convention.

### `getContentBaseline` returns `null`

A multi-line wrapped block exposes no single text baseline, so a baseline-aware parent must auto-centre or top-align the whole HFlow container rather than aligning it by an interior baseline. The base [`LayoutManager.getContentBaseline`](../src/typescript/lib/layout/LayoutManager.ts#L575) already returns `null`; HFlow simply does **not** override it (unlike HBox, which does).

### One `spacing` plus a separate `lineSpacing`

Item gaps and line gaps are visually independent (a tight item gap with airy line gaps is a common flow look), so two fields read cleanly. `spacing` keeps HBox's name and `getComponentSpacing`/`setComponentSpacing` setters for the item (horizontal) gap; `lineSpacing` + `getLineSpacing`/`setLineSpacing` controls the vertical gap between wrapped lines. Both default to `5` to match HBox/VBox's `_spacing` default.

### No `stretching` / `mode` / `weight`

HFlow always packs children at their preferred size from the line start. There is no equal-division mode (that is what HBox `mode: "equal"` is for) and no `weight` distribution (a flow has no fixed line to distribute remainder across). Children are placed at preferred width clamped to their own min/max via `FillType.NONE` so each keeps its intrinsic size.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/HFlow.ts

/**
 * Construction-time options for HFlow.
 * @category Layouts
 */
export interface HFlowOptions extends LayoutManagerOptions {
    spacing?:     number;   // horizontal gap between items on a line
    lineSpacing?: number;   // vertical gap between wrapped lines
}

class HFlow extends LayoutManager {
    private _spacing: number = 5;
    private _lineSpacing: number = 5;

    constructor(options?: HFlowOptions);

    protected applyOptions(options: HFlowOptions): void;

    getComponentSpacing(): number;
    setComponentSpacing(spacing: number): this;   // backing field _spacing

    getLineSpacing(): number;
    setLineSpacing(lineSpacing: number): this;     // backing field _lineSpacing

    getPreferredSize(): Size | null;
    getMinSize(): Size | null;
    getMaxSize(): Size | null;

    // No getContentBaseline override — inherits null from LayoutManager.

    protected computeTotalContentHeight(innerWidth: number): number;

    doLayout(): void;
}

const HFlowCallable = callable(HFlow);
type HFlowCallable = HFlow;
export {
    HFlow         as _HFlow,
    HFlowCallable as HFlow
};
```

New DOM/layout properties (each needs typed setter + backing field + option forwarding through `applyOptions`):

| Property | Setter | Backing field | Option field |
|---|---|---|---|
| item spacing | `setComponentSpacing` | `_spacing` | `spacing` |
| line spacing | `setLineSpacing` | `_lineSpacing` | `lineSpacing` |

---

## Internal Structure

`computeTotalContentHeight(innerWidth)` — the shared wrap simulator, used both by `doLayout` (to decide the inflated working height) and reusable for any future hint. Packs children at preferred width, accumulates line height (tallest child on the line), wraps when the next child's right edge would exceed `innerWidth`, and returns the total stacked height including `lineSpacing` between lines (no trailing line spacing). No spacing before the first item of a line; no `lineSpacing` before the first line.

`doLayout` skeleton:

```text
container, innerSize, insets, components, spacing, lineSpacing  (guard nulls)
innerWidth  = innerSize.width  - (already inner; insets handled via getContentInsets origin)
contentWidth = inner area width available for packing  // = innerSize.width

// Vertical-scroll inflation (mirror of HBox.ts:501)
workingHeight = innerSize.height
if isOverflowingY():
    workingHeight = max(innerSize.height, computeTotalContentHeight(innerSize.width))

x = insets.getLeft();  y = insets.getTop();  lineHeight = 0;  lineStartX = insets.getLeft()
for each component:
    w = clamp(pref.width, min.width, max.width)
    h = clamp(pref.height, min.height, max.height)
    // wrap test: not the first item on the line AND right edge would exceed inner width
    if x > lineStartX and (x - lineStartX) + w > innerSize.width:
        y += lineHeight + lineSpacing
        x  = lineStartX
        lineHeight = 0
    // oversized single child: clamp its placed width to inner width
    placedW = (x == lineStartX) ? min(w, innerSize.width) : w
    placeComponent(component, x, y, placedW, h, FillType.NONE)
    x += placedW + spacing
    lineHeight = max(lineHeight, h)

reserveContentFrame()
```

`FillType.NONE` is used so `resolveBounds` keeps each child at its own preferred/min/max within the cell rather than stretching it (HBox uses `FillType.BOTH` because it pre-clamps width itself; HFlow passes the cell at the child's own size, so `NONE` is the honest choice). `lineStartX` equals `insets.getLeft()`; the `x > lineStartX` guard is what enforces "no wrap before the first item of a line."

---

## Edge Cases (decided)

### Oversized single child wider than inner width

A child whose clamped preferred width exceeds the container inner width occupies its own line and is **clamped to the inner width** when placed (`placedW = min(w, innerSize.width)` only when it is the first item on its line). This keeps the last/trailing child's right edge inside the container, consistent with HBox's shrink-path reasoning that the last child must land inside so its own scrollbar (if it is itself a scroll host) is not clipped by an `overflow: hidden` ancestor ([HBox.ts:660-680](../src/typescript/lib/layout/HBox.ts#L660)). The wrap test uses the child's full width to decide *whether* to wrap, but the placement clamps the width on the line.

### Item spacing vs line spacing

`spacing` is added **after** each item except it never appears before the first item of a line (enforced by resetting `x = lineStartX` on wrap and only advancing `x += placedW + spacing` after a placement). `lineSpacing` is added **only between** lines (`y += lineHeight + lineSpacing` on wrap), never before the first line and never after the last. `computeTotalContentHeight` mirrors this exactly so the inflated height matches the placed extent.

### Empty container

No children → `computeTotalContentHeight` returns `0`; `doLayout` runs its loop zero times and calls `reserveContentFrame`, which already clears the frame when `components.length === 0` ([LayoutManager.ts:198](../src/typescript/lib/layout/LayoutManager.ts#L198)). Size hints return perimeter-only sizes: `getPreferredSize`/`getMinSize`/`getMaxSize` start from `perimiterSize.left + .right` / `.top + .bottom` and add nothing, exactly as HBox does with an empty component list (the loops simply do not execute, and `spacing*(n-1)` with `n=0` must be guarded — use `spacing * Math.max(0, components.length - 1)` so `n=0` does not subtract spacing). Match HBox's `null`-when-no-container guard at the top of every hint.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/layout/HFlow.ts`.** Copy HBox's import block (`LayoutManager`/`LayoutManagerOptions`, `FillType`, `Size`, `callable`); drop the `BoxMode` import. Declare the class with `_spacing` and `_lineSpacing` fields.
   - verify: `npx tsc --noEmit` reports no missing-import errors for the new file.

2. **Constructor + `applyOptions`.** Mirror [HBox.ts:74-113](../src/typescript/lib/layout/HBox.ts#L74): `super()`, `if (options) this.applyOptions(options)`. In `applyOptions`, call `super.applyOptions(options)` then dispatch `spacing` and `lineSpacing` only when `!== undefined`.

3. **Typed setters.** `getComponentSpacing`/`setComponentSpacing` (copy HBox verbatim), `getLineSpacing`/`setLineSpacing` (same shape on `_lineSpacing`). Each setter returns `this`; each `@param`/`@returns` JSDoc per CODE_CONVENTIONS.

4. **Size hints.** Write `getPreferredSize` (single-line: sum widths + `spacing*Math.max(0,n-1)`, height via `computeRowHeight(heights, baselines)`), `getMinSize` (widest child min width, tallest child min height), `getMaxSize` (sum widths + spacing, `min` of child max heights). All start from `perimiterSize` and return `null` with no container. Reuse the inherited `computeRowHeight`/`computeRowMetrics` for baseline-aware height.

5. **`computeTotalContentHeight(innerWidth)`.** The wrap simulator described in Internal Structure. Returns `0` for an empty/absent container.
   - verify: unit-reason through 0, 1, and N-children-wrapping cases on paper; trailing line/item spacing excluded.

6. **`doLayout`.** Guard container/innerSize; capture insets, components, both spacings. Inflate `workingHeight` on the Y axis only when `isOverflowingY()`. Run the pack-and-wrap loop with `FillType.NONE`, the first-item wrap guard, and the oversized-child width clamp. Call `reserveContentFrame()` after the loop.
   - verify: `npx tsc --noEmit` clean.

7. **`callable` wrapper + exports.** Append the `HFlowCallable` / `type` / `export { _HFlow, HFlowCallable as HFlow }` block exactly as [HBox.ts:776-781](../src/typescript/lib/layout/HBox.ts#L776).

8. **Barrel re-export.** In [src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts), after the VBox lines (22), add `export { HFlow } from '~/layout/HFlow.js';` and `export type { HFlowOptions } from '~/layout/HFlow.js';`.
   - verify: `grep -n HFlow src/typescript/lib/layout/index.ts` shows both lines.

9. **Demo panel `src/typescript/HFlowPanel.ts`.** Mirror [HBoxPanel.ts](../src/typescript/HBoxPanel.ts) exactly: extend `LayoutTestPanel`, `setLayoutManager(new HFlow())`, `callable`-wrap. `LayoutTestPanel` already constructs `super({ autoScroll: 'auto' })` ([LayoutTestPanel.ts:13](../src/typescript/LayoutTestPanel.ts#L13)), so vertical scroll is wired with no extra work. Import `HFlow` from `@jimka/typescript-ui/layout`.

10. **Register the demo tab.** In [src/typescript/main.ts](../src/typescript/main.ts): import `HFlowPanel`, and add `layoutManager.addLazyTab(() => new HFlowPanel(), "HFlow");` after the VBox line (42).

11. **Docs.** New `docs/layouts/HFlow.md` (mirror `docs/layouts/HBox.md` structure: intro, ascii sketch, Usage, wrapping/spacing/scroll sections, options table). Add an `HFlow` row to `docs/layouts/index.md` after the VBox row (18). Add `{ text: 'HFlow', link: '/layouts/HFlow' }` to the layouts sidebar in `docs/.vitepress/config.mts` after the VBox entry (151).
   - verify: `npm run docs:build` — 0 errors, 0 link warnings.

12. **Self-review checklist.** Confirm: no `stretching`/`mode`/`weight` leaked in; `lineSpacing` excluded before first line; `spacing` excluded before first item; oversized child clamped only when first on its line; `reserveContentFrame` called on every `doLayout` return path; `getContentBaseline` *not* overridden.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/layout/HFlow.ts` |
| Create | `src/typescript/HFlowPanel.ts` |
| Create | `docs/layouts/HFlow.md` |
| Modify | `src/typescript/lib/layout/index.ts` (barrel re-export) |
| Modify | `src/typescript/main.ts` (import + `addLazyTab`) |
| Modify | `docs/layouts/index.md` (catalog row) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or the project's build) — zero errors.
- **Barrel invariant:** `grep -n 'HFlow' src/typescript/lib/layout/index.ts` — expect the `export` and `export type` lines.
- **Docs build:** `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning). Confirm `HFlow` lands under `docs/api/layout/classes/` (the `HFlowCallable as HFlow` export promotes it from `variables/` via the typedoc-callable-plugin) and `HFlowOptions` under `interfaces/`.
- **Demo screen:** run `npm run dev` (http://localhost:8015), open the **HFlow** tab. Verify: children wrap to new lines as the window narrows; line gaps respect `lineSpacing`, item gaps respect `spacing`; narrowing past the height of all stacked lines produces a vertical scrollbar (autoScroll is `'auto'`); widening collapses back to fewer lines and the scrollbar disappears (content-frame shrinks below the viewport).
- **Oversized child:** confirm the List (or a wide child) on its own line does not push the container's horizontal scrollbar / is clamped to inner width.
- **Empty case (manual reason):** an HFlow with no children produces no scrollbar and a cleared content frame.

---

## Documentation Impact

- **Barrel:** `HFlow` + `HFlowOptions` re-exported from `src/typescript/lib/layout/index.ts` (the layout subpath barrel — there is no root barrel). Both carry `@category Layouts`.
- **Curated page:** new `docs/layouts/HFlow.md`; add a row to the `docs/layouts/index.md` catalog and an entry to the layouts sidebar in `docs/.vitepress/config.mts`.
- **JSDoc cross-bucket:** `HFlow`'s JSDoc references `Panel` and `Size` from other buckets — use markdown links (`[\`Panel\`](/api/core/classes/Panel)`), not `{@link}`, per `_shared/docs-conventions.md`. Same-bucket references (`LayoutManager`, `FillType`, `HBox`, `VBox`) may use `{@link}`.
- **No theme tokens, no concepts/recipe pages** needed — HFlow adds no CSS custom properties and introduces no new cross-cutting pattern.

---

## Potential Challenges

- **Height-for-width hint mismatch:** `getPreferredSize` reports a single-line height while the real layout may wrap taller. Mitigation: the host `Panel` scrolls vertically; the hint is documented as approximate and the parent never relies on it for exact wrap height.
- **`spacing*(n-1)` underflow at n=0:** guard with `Math.max(0, components.length - 1)` in every hint so an empty container does not subtract a spacing.
- **Inflate vs. clip when not scrolling:** when `isOverflowingY()` is false, lines past the inner height are clipped by the host's `overflow: hidden` — this is intended (matches HBox's clamp-and-clip default), not a bug.
- **`FillType.NONE` vs `BOTH`:** HBox uses `BOTH` because it pre-clamps the cell to the exact width; HFlow passes the child its own size, so `NONE` keeps the child at preferred without stretching. Verify a child with `FillType.HORIZONTAL` constraints still behaves (resolveBounds honours the child's stored constraints first).

---

## Critical Files

- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) — primary template: callable wrapping (776), `applyOptions` dispatch (93), spacing setter (129), size hints (239/301/361), `computeTotalMinSize` (421), the `isOverflowingX()` inflate branch (501), the oversized-last-child reasoning (660), `reserveContentFrame` call (772).
- [`src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the H→V mirror reference (informs the future VFlow): vertical inflate branch (440), per-axis hint structure.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — base: `placeComponent`/`resolveBounds`/`commitBounds` (251/278/414), `reserveContentFrame` (189), `isOverflowingX/Y` (122/132), `setOverflowing` (149), `computeRowHeight`/`computeRowMetrics` (532/499), `getContentBaseline` default `null` (575).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` (216) maps `AutoScrollMode` to CSS overflow and forwards `setOverflowing(x, y)` (252); `setLayoutManager` re-applies it (271).
- [`src/typescript/HBoxPanel.ts`](../src/typescript/HBoxPanel.ts) + [`src/typescript/LayoutTestPanel.ts`](../src/typescript/LayoutTestPanel.ts) — demo panel template (`autoScroll: 'auto'` already set).
- [`docs/layouts/HBox.md`](../docs/layouts/HBox.md) + [`docs/layouts/index.md`](../docs/layouts/index.md) + `docs/.vitepress/config.mts` — docs page template, catalog, sidebar.
- `CODE_CONVENTIONS.md` — options-bag construction, underscore backing fields, JSDoc rules.

---

## Non-Goals

- **`VFlow`** (vertical-wrap mirror: pack top-to-bottom, wrap into columns, horizontal scroll). The file is structured to make it a clean later mirror of HFlow, but it is not built here.
- **justify / align / line-distribution knobs.** v1 always packs from the line start and stacks lines top-down. No `justifyContent`, `alignItems`, or per-line stretching.
- **`stretching` / `mode: "equal"` / `weight`.** No equal-division mode (that is HBox `mode: "equal"`) and no weight distribution — a flow has no fixed line to distribute remainder across.
- **Horizontal scroll.** HFlow wraps instead of overflowing horizontally; the wrap *is* the horizontal-overflow relief. Only vertical scroll is supported.
