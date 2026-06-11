---
depends-on:
  - size-constraint-invariant.md
  - component-move-helper.md
  - tab-detach-redock.md
touches-shared:
  - src/typescript/lib/layout/Split.ts
  - src/typescript/lib/core/Theme.ts
---

# Edge-Drop-to-Split Orchestration — Implementation Plan

## Overview

Wire the existing drag engine into a reusable **edge-drop-to-split** gesture: while a panel/tab is dragged, a registered region shows five drop zones — four edge bands (top/bottom/left/right) plus a center; dropping on an edge **splits** the region (wrapping it in a new [`Split`](../src/typescript/lib/layout/Split.ts#L36) or inserting a pane into an existing one) and re-homes the dragged panel into the freshly-created pane; dropping on center adds it as a tab. This is plan **#3 of 5** toward a dock/tab manager — the layer that turns a drag into a structural re-split.

This plan **owns** three things: (1) the drop-zone *geometry* — dividing a target region's box into four edge bands + a center hit-region given the cursor position; (2) the drop-zone *visual overlay* — a lightweight `DropZoneOverlay` component that paints the five zones and highlights the hovered one; and (3) the *split-mutation* logic on drop — wrapping a region in a new `Split` or inserting a pane into an existing `Split`, then moving the panel in.

It **reuses** without re-planning: [`DragManager.makeDropTarget`](../src/typescript/lib/core/DragManager.ts#L182) (drives the zones via `accepts`/`onDragOver`/`onDragLeave`/`onDrop`), [`Component.moveComponent`](component-move-helper.md) from plan #1 (re-homes the panel), and the [`TabDragData`](tab-detach-redock.md) payload from plan #2 (the `accepts` discriminator). The work lives in a new `DockRegion` wiring class plus a new `DropZoneOverlay` overlay, a handful of new public `Split` methods, and theme tokens.

---

## Architecture Decisions

### A new `DockRegion` wiring class owns the gesture; it is not bolted onto `Split` or `Panel`

The gesture spans concerns no existing class should absorb: it registers a drop target, computes zone geometry, drives an overlay, and mutates layout structure. Putting that on `Split` would force `Split` (a `LayoutManager`) to reach up into its container and re-parent siblings — a layout manager mutating the component tree it lives under inverts the direction of control. Putting it on `Panel` would bloat the base container. **Decision:** add a small `DockRegion` class (a plain coordinator, not a `Component`) constructed around a target container Component: `new DockRegion(region)` registers the drop target and tears down via a returned/owned closure, mirroring the `installRowDnD` teardown-bag idiom in [`TreeBody`](../src/typescript/lib/component/table/TreeBody.ts#L600). One `DockRegion` per dockable region. This keeps `Split` a pure layout manager and `DockRegion` the single home for the split-on-drop orchestration that plan #5 will instantiate per region.

### Drop-zone overlay is a new lightweight `DropZoneOverlay`, not a reuse of `DragFeedback`

[`DragFeedback`](../src/typescript/lib/core/component/DragFeedback.ts#L25) tints the **whole** target a single valid/invalid colour and is owned exclusively by `DragManager` (one instance per session, attached/detached by the manager). It cannot show *five* distinct sub-regions or highlight one band. **Decision:** add a new `DropZoneOverlay extends Component` (one element per class) that draws the five zones as inset bands and highlights the hovered zone. It is `Position.ABSOLUTE`, `pointerEvents:none`, z-index just under the ghost — the same overlay carve-out `DragFeedback`/`ReorderIndicator` use. `DockRegion` owns the instance, attaches it to the region on first `onDragOver`, repositions the highlight as the cursor moves between zones, and detaches on `onDragLeave`/`onDrop`. `DragManager`'s own `DragFeedback` still tints the region (validity), and `DragManager`'s `ReorderIndicator` stays detached because `onDragOver` returns `null` (no number) — exactly how plan #2's `TabReorderBar` suppresses it. The two overlays compose: validity tint from the manager, zone highlight from `DockRegion`.

Drawing five sub-bands in **one** element means the overlay paints the highlight via a single positioned child rectangle (the hovered band), not five persistent child elements — one-element-per-class is satisfied by giving the highlight rect its own nested `Component`, the same way [`Tab`'s `TabIndicator`](../src/typescript/lib/layout/Tab.ts#L139) is a nested overlay class. See *Internal Structure*.

### Zone geometry: edge bands are a fixed fraction of the region, center is the remainder

`computeZone(region, clientX, clientY)` returns one of `"top" | "bottom" | "left" | "right" | "center"`. The cursor's position relative to the region's box decides the zone: if it falls within `EDGE_BAND_FRACTION` of an edge (and is closer to that edge than to the perpendicular edges), it is that edge; otherwise center. A fractional band (not a fixed pixel inset) keeps small regions usable — a thin region would otherwise be all-edge. The fraction is a documented constant (`EDGE_BAND_FRACTION = 0.25`, the canonical quarter-split used by VS Code / GoldenLayout drop affordances). The corners resolve by nearest-edge distance so there is no dead diagonal. This is pure math on a `getBoundingClientRect()` of the region, no DOM mutation.

### Split mutation: wrap-in-new-Split vs. insert-into-existing-Split, chosen by the region's current layout manager

On an edge drop the structural change depends on what the region already is:

- **Region is *not* a `Split` (or is a `Split` whose axis is perpendicular to the drop edge):** wrap. Create a new container Component with a `Split` layout in the drop edge's axis (`left`/`right` → horizontal, `top`/`bottom` → vertical), move the *existing region's content* into one pane and the dragged panel into the other, and put the new Split-container where the region was. Because a `LayoutManager` lives on a container, "wrap a region" means: the region's parent gets a new child (the Split container) inserted at the region's old index, and the region itself plus the dragged panel become that Split container's two panes via `moveComponent`. Edge side decides pane order (`top`/`left` → dragged panel is pane 0).
- **Region *is* a `Split` whose axis matches the drop edge:** insert. Add the dragged panel as a new pane at the leading (`top`/`left`) or trailing (`bottom`/`right`) index via the new `Split.insertPane` path + `moveComponent`, and let `recalculateSizes` give it a proportional share.

This keeps nesting shallow (matching-axis edge drops extend rather than nest) and is the standard dock-manager behaviour. **Center** drops never split: they call into the region's tab host (a `Tab` layout) and add the panel as a tab — if the region is not already a `Tab`, center-drop wraps it in a `Tab` the same structural way an edge wraps it in a `Split`. (Center-into-Tab reuses plan #2's dock path; this plan only routes to it.)

> **Write-time note (resolved during implementation):** plan #2's `Tab.dockComponent` is *private*, so `dockAsTab` cannot call it. The public route is `region.moveComponent(panel)` followed by the public [`Tab.createTab(panel)`](../src/typescript/lib/layout/Tab.ts#L1897) — `createTab` reads the tab label from the panel's `LayoutConstraints.name`, which `moveComponent` carries, so a dragged tab keeps its label. The **wrap** case (region is not a `Tab`) needs no explicit `createTab`: `Tab.doLayout` already creates a tab for every container child no entry owns yet ([Tab.ts:2639](../src/typescript/lib/layout/Tab.ts#L2639)), so moving both the region and the panel into a fresh `new Panel({ layoutManager: new Tab() })` and scheduling a layout tabs them both.

### New public `Split` methods — `insertPane` and `setPaneSize`; do not mutate `_sizes` from outside

`Split` exposes no way to add a pane at a runtime index with a chosen size, nor to read/seed a pane's stored size — `_sizes`, `_direction`, `_gutters` are all private and `recalculateSizes` only *fills* missing sizes. A `DockRegion` performing an insert must (a) put the dragged panel into the Split container at a specific index (that is `container.moveComponent(panel, index)` — *not* a Split method; the container owns children) and (b) optionally seed the new pane's stored size so it doesn't steal the whole container on first layout. **Decision:** add two typed public methods to `Split`:

```typescript
setPaneSize(pane: Component, size: number): this;   // seeds/overrides _sizes for one pane
getPaneSize(pane: Component): number | undefined;   // reads the stored main-axis size
```

`insertPane` is deliberately **not** added: inserting a pane is just `splitContainer.moveComponent(panel, index)` because the container — not the layout manager — owns the child list, and `Split.doLayout`/`recalculateSizes` already create the gutter and assign a proportional size for a child with no stored size (the existing "new panel added" path, [`recalculateSizes`](../src/typescript/lib/layout/Split.ts#L789)). Adding a redundant `Split.insertPane` would duplicate that and breach Surgical-Changes. The only genuinely missing capability is *seeding a specific size* for the new pane (so an edge drop can give the new pane, say, 50% instead of the equal-division default) — hence `setPaneSize`/`getPaneSize`. Wrapping reuses the same: create the Split container, `moveComponent` both children in, optionally `setPaneSize` to split 50/50. The `_direction` is set at construction via `new Split({ direction })` (existing option), so no `setDirection` is needed at the call site beyond the existing public setter.

### `accepts` predicate reuses plan #2's `TabDragData`, does not invent a competing shape

`DockRegion`'s `accepts` tests `detail.dragData.tabDrag === true` — the exact discriminator plan #2 ([`tab-detach-redock.md`](tab-detach-redock.md)) defines on its `TabDragData` payload. The dragged panel's live `Component` is resolved through plan #2's module-level `tabDragRegistry` (`componentId → Component`) — this plan imports/reads that registry rather than building a second one. A panel dragged from a `Tab` is therefore droppable onto a split edge with no new drag-data plumbing. `accepts` additionally rejects a self-drop (the dragged panel is already the region's only content and the edge would create a degenerate split): compare `detail.dragData.componentId` against the region's sole child id. Reconciling with #2 is mandatory — if #2's field names shift, this plan tracks them; it never forks the payload.

### Re-splitting stresses sizing — the size-constraint invariant is the load-bearing prerequisite

A wrap or insert immediately re-runs `Split.doLayout` → `recalculateSizes` → `placeComponent(FillType.BOTH)` on *two new* containers whose children's min/preferred/max have never been reconciled in this configuration. If `min ≤ preferred ≤ max` is violated (the open issue in [`size-constraint-invariant.md`](size-constraint-invariant.md)), a freshly-created pane can be placed below its min (cross-axis, the exact `HBox`/`VBox`/`Split` `BOTH`-branch gap that plan fixes) or report a preferred outside its constraints, producing a visibly wrong first split or an immediate layout thrash. This is the plan most sensitive to that invariant because every drop *creates new geometry on the fly* rather than re-laying-out a stable tree. It is listed as a hard `depends-on` and must land first; this plan does not re-plan it.

### CODE_CONVENTIONS compliance

Typed setters with cached fields and `XOptions` forwarding apply to any new DOM property: `DropZoneOverlay`'s highlighted-zone is internal state, not a public DOM property, so it gets a `setHighlight(zone)` runtime method (no option/cache pair needed — it is overlay-internal, created and driven solely by `DockRegion`, never constructed by app code, mirroring `DragFeedback.setValid`). `Split.setPaneSize`/`getPaneSize` follow the typed-setter idiom (explicit param/return types, JSDoc). `DockRegion` is a coordinator, not a `Component`, so the one-element-per-class rule does not apply to it; it applies to `DropZoneOverlay`, which owns exactly one root element plus one nested highlight `Component` (the `TabIndicator` precedent). All magic numbers (`EDGE_BAND_FRACTION`, overlay z-index, band opacity) are named constants with why-comments.

---

## Public API (TypeScript Signatures)

```typescript
/** One of the five drop zones a DockRegion resolves the cursor into. */
type DropZone = "top" | "bottom" | "left" | "right" | "center";

/**
 * Coordinator that turns an edge/center drop onto a region into a structural
 * re-split (edge) or a tab add (center). One instance per dockable region.
 */
class DockRegion {
    /** Registers `region` as a drop target and wires the five-zone gesture. */
    constructor(region: Component);
    /** Unregisters the drop target and detaches the overlay. */
    destroy(): void;
}

/** Overlay that paints the five drop zones and highlights the hovered one. */
class DropZoneOverlay extends Component {
    /** Mirrors the region's box and attaches the overlay to it. */
    attachTo(region: Component): void;
    /** Highlights the given zone (or clears the highlight when null). */
    setHighlight(zone: DropZone | null): void;
    /** Removes the overlay element from the DOM. */
    detach(): void;
}

class Split extends LayoutManager {
    /** Seeds or overrides the stored main-axis size for one pane. */
    setPaneSize(pane: Component, size: number): this;
    /** Returns a pane's stored main-axis size, or undefined when unset. */
    getPaneSize(pane: Component): number | undefined;
}
```

`DropZone` and `DockRegion` are exported from the layout barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)); `DropZoneOverlay` is exported alongside the other overlays from the core component group (it sits next to `DragFeedback`). `setPaneSize`/`getPaneSize` are added to the already-exported `Split`. No new `XOptions` field — `DockRegion` takes no options bag in this plan (a region is either dockable or not; configurability is deferred to plan #5), and `DropZoneOverlay`'s state is overlay-internal.

---

## Theme Tokens

The hovered-zone highlight needs its own fill/border so it reads against the manager's validity tint. The four idle bands reuse the existing reorder colour at low opacity. New tokens live in `BaseTheme` (shared defaults) since they are colour-neutral hints; if a theme wants to override, it adds them to its `drag` block.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-drag-dropzone-bg` | `rgba(80, 140, 240, 0.10)` | `rgba(80, 140, 240, 0.12)` | Fill of the four idle edge/center bands |
| `--ts-ui-drag-dropzone-border` | `rgba(80, 140, 240, 0.40)` | `rgba(80, 140, 240, 0.45)` | Outline separating the bands |
| `--ts-ui-drag-dropzone-active-bg` | `rgba(80, 140, 240, 0.28)` | `rgba(80, 140, 240, 0.32)` | Fill of the currently-hovered band |

Reuse note: the values are tuned around the existing `--ts-ui-drag-reorder-color` (`rgb(80, 140, 240)`) so the dock affordance is visually consistent with the reorder line; the idle band could in principle inline `--ts-ui-drag-reorder-color` with an alpha, but CSS custom properties can't apply alpha to another token's value, so explicit rgba tokens are required.

Token wiring touches:
- [`Theme.ts`](../src/typescript/lib/core/Theme.ts#L546) — add `dropzone: { background; border; activeBackground; }` to the `drag` interface block (after `reorderIndicator`).
- [`Theme.ts`](../src/typescript/lib/core/Theme.ts#L880) — add three rows to `themeToVars` under the existing `--ts-ui-drag-*` lines.
- [`BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts#L100) — add `dropzone` defaults to the shared `drag` block (Base currently only sets `ghost.opacity`; the light/full defaults live in the concrete themes — see below).
- [`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts#L272), [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts#L277) (light themes) and [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts#L267) — add the `dropzone` block with the light/dark values from the table.

> The brief said "all three theme files"; the repo has four theme files. `BaseTheme` carries shared defaults and the three concrete themes (Classic, Modern, Dark) carry the colour values — confirm at write time which block each token belongs in by reading the existing `drag.feedback` placement (it lives in the concrete themes, not Base), and mirror that exactly. Flag in the implementation if the split differs from this assumption.

---

## Internal Structure

`DropZoneOverlay` DOM: one root element (the band canvas) + one nested highlight `Component` (the moving hover rect), mirroring [`TabIndicator`](../src/typescript/lib/layout/Tab.ts#L139):

```typescript
class DropZoneOverlay extends Component {
    private _highlight: Component;          // single positioned rect, moved per zone
    private _zone: DropZone | null = null;  // cached current highlight

    // attachTo(region): mirror region bounds (setX/Y 0, setWidth/Height to region),
    //   append root to region element (DragFeedback.attachTo precedent), append
    //   _highlight to root.
    // setHighlight(zone): if zone === _zone return; cache it; if null hide
    //   _highlight; else compute the band rect from EDGE_BAND_FRACTION × current
    //   width/height and place _highlight there with the active-bg colour.
}
```

`DockRegion` zone math (pure, no DOM mutation):

```typescript
// EDGE_BAND_FRACTION: quarter of the region counts as an edge band; the
// canonical VS Code / GoldenLayout dock affordance ratio. Corners resolve to
// whichever edge is nearer so there is no dead diagonal.
private static readonly EDGE_BAND_FRACTION = 0.25;

private computeZone(rect: DOMRect, x: number, y: number): DropZone {
    const fx = (x - rect.left) / rect.width;   // 0..1 across
    const fy = (y - rect.top)  / rect.height;  // 0..1 down
    const f  = DockRegion.EDGE_BAND_FRACTION;

    const distLeft = fx, distRight = 1 - fx, distTop = fy, distBottom = 1 - fy;
    const nearest  = Math.min(distLeft, distRight, distTop, distBottom);

    if (nearest >= f) {
        return "center";
    }

    // Pick the nearest edge (corner tie-break by smallest distance).
    if (nearest === distLeft)   { return "left"; }
    if (nearest === distRight)  { return "right"; }
    if (nearest === distTop)    { return "top"; }

    return "bottom";
}
```

`DockRegion` drop-target wiring (the `makeDropTarget` consumer idiom, teardown captured for `destroy`):

```typescript
// accepts: detail.dragData.tabDrag === true && not a degenerate self-drop.
// onDragOver: overlay.attachTo(region) (idempotent), zone = computeZone(...),
//   overlay.setHighlight(zone); return null  (suppress ReorderIndicator).
// onDragLeave: overlay.detach().
// onDrop: resolve panel via plan #2's tabDragRegistry from componentId;
//   zone === "center" ? dockAsTab(panel) : splitOnEdge(panel, zone);
//   overlay.detach().
```

`splitOnEdge(panel, zone)` (the structural mutation):

```typescript
// axis = (zone === "left" || zone === "right") ? "horizontal" : "vertical";
// const lm = region.getLayoutManager();
// if (lm is Split && lm.getDirection() === axis) {
//     // extend existing split
//     const leading = zone === "top" || zone === "left";
//     region.moveComponent(panel, leading ? 0 : region.getComponents().length);
//     // optional: lm.setPaneSize(panel, <proportional seed>)  — see decision
// } else {
//     // wrap region in a new Split container, placed where region was
//     const parent = region.getParentComponent();
//     const index  = parent.getComponents().indexOf(region);
//     const split  = new Panel({ layoutManager: new Split({ direction: axis }) });
//     parent.moveComponent(split, index);              // split takes region's slot
//     const leading = zone === "top" || zone === "left";
//     split.moveComponent(panel,  leading ? 0 : 1);    // order by edge
//     split.moveComponent(region, leading ? 1 : 0);
// }
```

Key invariants the implementer must preserve: all re-parents go through `moveComponent` (plan #1), never manual remove+add; the new Split container is a plain container with a `Split` layout (a `Panel` is the lightest such container — confirm `Panel` accepts a `layoutManager` option, it does via `ComponentOptions.layoutManager`); the wrap moves the *dragged panel* and the *region* as the two panes, so the region's former content survives intact inside its pane.

---

## Ordered Implementation Steps

1. **Add `setPaneSize`/`getPaneSize` to [`Split.ts`](../src/typescript/lib/layout/Split.ts).** Place them next to `getDirection`/`setDirection`. `setPaneSize(pane, size)` writes `this._sizes.set(pane, size)` and returns `this`; `getPaneSize(pane)` returns `this._sizes.get(pane)`. Full JSDoc. Typecheck.
2. **Add the `DropZone` type, `DropZoneOverlay` component.** New file `src/typescript/lib/core/component/DropZoneOverlay.ts` mirroring `DragFeedback.ts` structure (Position.ABSOLUTE, pointerEvents:none, z-index below the ghost, `callable()` export pair). Implement `attachTo`/`setHighlight`/`detach` and the nested `_highlight` rect per *Internal Structure*. Wire its three theme tokens.
3. **Add the three `dropzone` theme tokens** to `Theme.ts` (interface + `themeToVars`), `BaseTheme.ts` (if shared defaults belong there — match the existing `drag.feedback` placement), and the concrete themes (`ClassicTheme`, `ModernTheme`, `DarkTheme`). Token checkpoint: `grep -n "dropzone" src/typescript/lib/core/Theme.ts` returns the interface + three var rows.
4. **Add the `DockRegion` class.** New file `src/typescript/lib/layout/DockRegion.ts`. Constructor registers `DragManager.makeDropTarget(region, …)` capturing the teardown; `computeZone`, `splitOnEdge`, `dockAsTab` (routes to plan #2's Tab dock path), and `destroy` (runs teardown + `overlay.detach()`). `accepts` tests `detail.dragData.tabDrag === true` (plan #2 contract) and rejects the degenerate self-drop. Resolve the live panel through plan #2's `tabDragRegistry`.
5. **Export new public symbols.** Add `DockRegion` + `DropZone` to [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts); add `DropZoneOverlay` to the core component export surface (next to `DragFeedback` — find via `grep -rn "DragFeedback" src/typescript/lib/core/index.ts` or the component sub-barrel).
6. **Typecheck** (`npx tsc --noEmit`) — zero errors. **No-manual-reparent checkpoint:** `grep -n "removeComponent\|addComponent\|insertComponent" src/typescript/lib/layout/DockRegion.ts` — confirm every re-parent uses `moveComponent`, not a remove+add pair. **Self-drop checkpoint:** confirm `accepts` rejects dropping a panel onto the region whose sole child it already is.
7. **Wire a demo region.** In an existing demo (e.g. a `Tab`-backed panel from plan #2's demo, or `MiscPanel`), construct a `DockRegion` around a panel so a tab dragged from a reorderable `Tab` can be dropped on its edges/center. Exercise wrap, matching-axis extend, and center-as-tab.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/layout/DockRegion.ts` — the gesture coordinator (zone math, split mutation, drop-target wiring) |
| Create | `src/typescript/lib/core/component/DropZoneOverlay.ts` — five-zone overlay with hovered-band highlight |
| Modify | `src/typescript/lib/layout/Split.ts` — add `setPaneSize`/`getPaneSize` |
| Modify | `src/typescript/lib/layout/index.ts` — export `DockRegion`, `DropZone` |
| Modify | `src/typescript/lib/core/index.ts` (or the core component sub-barrel) — export `DropZoneOverlay` |
| Modify | `src/typescript/lib/core/Theme.ts` — `dropzone` interface fields + `themeToVars` rows |
| ~~Modify~~ | ~~`src/typescript/lib/core/themes/BaseTheme.ts`~~ — **not modified**: `BaseTheme.drag` carries only `ghost.opacity`; `feedback`/`reorderIndicator`/`dropzone` colour values live in the three concrete themes (confirmed at write time, matching the `drag.feedback` placement) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` — `dropzone` light values |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` — `dropzone` light values |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` — `dropzone` dark values |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Token checkpoint:** `grep -n "dropzone" src/typescript/lib/core/Theme.ts` returns the interface block + three `themeToVars` rows; `grep -rn "ts-ui-drag-dropzone" src/` resolves in `DropZoneOverlay` and `themeToVars`.
- **No-manual-reparent checkpoint:** `grep -n "addComponent\|removeComponent\|insertComponent" src/typescript/lib/layout/DockRegion.ts` — every re-parent is `moveComponent`.
- **Wrap-on-edge:** drag a tab from a reorderable `Tab` strip (plan #2) over a plain region; the overlay shows five zones; hovering an edge highlights that band; dropping on the **left** edge wraps the region in a horizontal `Split` with the dragged panel as pane 0 and the original region as pane 1, both rendering at ~50/50; a gutter sits between them.
- **Extend matching-axis split:** drop another panel on the **right** edge of that horizontal Split; it is inserted as a trailing pane (no extra nesting), and `recalculateSizes` gives it a proportional share.
- **Perpendicular edge nests:** dropping on the **top** edge of the horizontal Split wraps it in a *vertical* Split (one extra level), not an insert.
- **Center-as-tab:** dropping on the center adds the panel as a tab (via plan #2's dock path), no split created.
- **Self-drop rejected:** dragging a panel onto the edge of the region that is its own sole host shows the invalid tint and performs no mutation on release.
- **Sizing under re-split (the load-bearing check):** after a wrap, both panes satisfy `pane.getWidth()/getHeight() >= its min` and neither is placed below min on the cross axis — this is the behaviour `size-constraint-invariant.md` must have fixed first; if a pane lands sub-min, that prerequisite has not landed.
- **Theme toggle:** flip light/dark mid-drag — the idle bands and hovered highlight recolour from the `--ts-ui-drag-dropzone-*` tokens.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbols:** `DockRegion` and `DropZone` (layout bucket), `DropZoneOverlay` (core bucket), `Split.setPaneSize`/`getPaneSize` (existing `Split`). Re-export each from the correct per-subpath barrel (no root barrel) and add `@category Layouts` / `@category Core` tags. Verify they land in `docs/api/layout/index.md` and `docs/api/core/index.md` after build.
- **Curated pages:** add a `DockRegion` page (or a "dock / edge-drop" recipe) under `docs/layout/` or `docs/recipes/`, link it in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts), and add it to the group catalog `index.md`. Document the five-zone gesture and the wrap-vs-extend rule. Update the `Split` page to mention `setPaneSize`/`getPaneSize`.
- **JSDoc cross-bucket links:** `DropZoneOverlay`, `DragFeedback`, `DragManager`, `Component.moveComponent`, and plan #2's `TabDragData` cross buckets — reference them with markdown links (`[`X`](/api/<subpath>/<kind>/X)`), not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- **typedoc-callable-plugin:** `DropZoneOverlay` uses the `export { _DropZoneOverlay as ..., DropZoneOverlayCallable as DropZoneOverlay }` form (mirroring `DragFeedback`) so it is auto-promoted from `variables/` to `classes/`; verify after build.

---

## Potential Challenges

- **Sizing during re-split** — a freshly-created pane can be placed below its min on the cross axis if the size-constraint invariant is unfixed. Mitigation: hard `depends-on` `size-constraint-invariant.md`; the sizing verification check catches a regression.
- **Resolving the live panel from `componentId`** — `DragEventDetail.dragData` carries only ids, not `Component` references. Mitigation: read plan #2's module-level `tabDragRegistry`; do not build a second registry. If plan #2's registry is not exported, this plan's step 4 must coordinate exporting it (note the cross-plan touch) rather than forking it.
- **`Panel` as the Split container** — wrapping needs a plain container that accepts a `Split` layout. Mitigation: confirm `Panel` (or the lightest base container) accepts `layoutManager` via `ComponentOptions` (it does — [`Component.applyOptions`](../src/typescript/lib/core/Component.ts#L387) dispatches `layoutManager`); use it, do not invent a new container class.
- **Overlay hit-test under the ghost and the manager's tint** — both `DropZoneOverlay` and `DragFeedback` attach *inside* the region; both are `pointer-events:none`, so `pickDropTarget`'s `elementsFromPoint` still returns the region. Mitigation: keep `DropZoneOverlay` z-index below the ghost and confirm the region element id still resolves first in the z-stack (same constraint plan #2 verified for the toolbar).
- **`onDragOver` re-entry cost** — it fires every mousemove; recomputing the zone and re-placing the highlight each frame is cheap (pure arithmetic + one element move), but `setHighlight` must early-return when the zone is unchanged (cached `_zone`) to avoid per-frame DOM writes. Mitigation: the cached-zone guard in *Internal Structure*.
- **Degenerate / repeated wraps** — dropping repeatedly on edges could nest Splits deeply. Mitigation: the matching-axis *extend* path keeps same-axis drops flat; deep perpendicular nesting is correct behaviour (and plan #5 owns any later flattening), so not addressed here.
- **`moveComponent` resets CSS transitions** — re-parenting the region's live node into the new Split pane cancels in-flight descendant transitions (documented plan #1 behaviour). Acceptable: a panel being docked should not animate mid-flight.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `Split` (36), `_sizes`/`_direction` (38-39), `getDirection`/`setDirection` (258/267), `recalculateSizes` (789, the "new pane added" proportional-size path the wrap/insert relies on), `doLayout` (459, gutter creation), `callable` export pair (880).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `makeDropTarget` (182), `DropTargetOptions` (63), `DragEventDetail` (24), `pickDropTarget` (338), `enterNewTarget` (383, why `onDragOver` returning `null` suppresses the ReorderIndicator), `onMouseUp` (502, the `onDrop` call site).
- [`src/typescript/lib/core/component/DragFeedback.ts`](../src/typescript/lib/core/component/DragFeedback.ts) — the overlay structure (Position.ABSOLUTE, pointerEvents:none, `attachTo`/`detach`, `callable` export pair) `DropZoneOverlay` mirrors.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts#L139) — `TabIndicator` (139), the nested-overlay-with-one-highlight-rect precedent for `DropZoneOverlay`.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `drag` interface block (546), `themeToVars` drag rows (872-880).
- [`src/typescript/lib/core/themes/BaseTheme.ts`](../src/typescript/lib/core/themes/BaseTheme.ts#L100) / [`DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts#L267) / [`ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts#L272) / [`ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts#L277) — where the `dropzone` block goes (mirror the existing `drag.feedback` placement).
- [`plans/component-move-helper.md`](component-move-helper.md) — `moveComponent` (every re-parent in this plan).
- [`plans/tab-detach-redock.md`](tab-detach-redock.md) — `TabDragData` (the `accepts` contract), `tabDragRegistry` (panel resolution), the Tab dock path (center-as-tab routing).
- [`plans/size-constraint-invariant.md`](size-constraint-invariant.md) — the blocking sizing prerequisite.

---

## Non-Goals

- **A general dock/tab manager** (persisting/serialising layouts, multi-region coordination, drag between regions across windows) — that is plan #5; this plan provides the single-region edge-drop primitive it composes.
- **Tab drag-reorder / tear-off** — plan #2 owns the source side and the `TabDragData` contract; this plan only consumes it as a drop *target*.
- **The `moveComponent` primitive** — plan #1; consumed, not re-planned.
- **Fixing the size-constraint invariant** — plan referenced as a blocking prerequisite, not re-planned.
- **Flattening redundant nested Splits** after repeated perpendicular drops — correct nesting is kept; any later flattening/normalisation belongs to plan #5.
- **A `Split.insertPane` method** — rejected; inserting a pane is `container.moveComponent(panel, index)` because the container owns children and `recalculateSizes` already sizes a new pane. Only `setPaneSize`/`getPaneSize` (seeding a specific share) are genuinely missing.
- **Configurable edge-band fraction / per-region dock options** — a single documented `EDGE_BAND_FRACTION` constant; per-region configurability is deferred to plan #5.
- **Animated split creation** — `moveComponent` resets transitions by design; a docked panel snaps into its new pane.
- **Promoting `DropZoneOverlay` into a `DragManager`-owned feedback protocol** — `DropZoneOverlay` is the 2-D twin of [`ReorderIndicator`](../src/typescript/lib/core/component/ReorderIndicator.ts) (same overlay shape, same `Band.Window - 1` z-order, both positional feedback driven by `onDragOver`): `ReorderIndicator` off a returned `number`, `DropZoneOverlay` off a returned zone. The natural future generalisation is to widen `DragManager`'s `onDragOver` return from `number | null` to a small feedback descriptor and let the manager own `DropZoneOverlay` the way it already owns `ReorderIndicator`, centralising attach/detach/z-order. It is **not** done here: there is one consumer, and widening that contract touches every drop target — a cross-cutting change to a shared core class that should wait for a second zone-style target. Note also that this is *not* a merge with `DragFeedback`: validity (tint, driven by `accepts`) and position (zone) are orthogonal axes that compose, so the future home is the `ReorderIndicator` positional-feedback path, never `DragFeedback`.

---

## Blocking Prerequisite

[`plans/size-constraint-invariant.md`](size-constraint-invariant.md) must land first. Every edge drop synchronously constructs new `Split` geometry and re-lays-out two new containers whose children's `min ≤ preferred ≤ max` relationship is exercised for the first time in that configuration. Of all five dock-manager plans this one is the most sensitive to the invariant because it *creates* geometry on drop rather than re-flowing a stable tree — an unfixed cross-axis `BOTH`-branch clamp (the exact gap that plan fixes in `HBox`/`VBox`/`Split`) would place a brand-new pane below its minimum on its very first layout, producing a visibly broken split. Referenced as an ordering dependency only; its contents are not re-planned here. Plan #1 ([`component-move-helper.md`](component-move-helper.md)) and plan #2 ([`tab-detach-redock.md`](tab-detach-redock.md)) are hard code dependencies (`moveComponent`; `TabDragData` + `tabDragRegistry`).
