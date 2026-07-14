# Resizable Accordion Sections — Implementation Plan

## Overview

The [`Accordion`](src/typescript/lib/layout/Accordion.ts) layout manager gives the user no way to reapportion height between its open sections. Open-section heights are computed entirely by the manager: each open section takes its preferred height (shrunk toward min when the container is too short — [`computeShrinkRatio`](src/typescript/lib/layout/Accordion.ts#L1353)), plus a share of the container's leftover height distributed by per-section `fillWeight` or the legacy bottommost-only `fillHeight` ([`computeFill`](src/typescript/lib/layout/Accordion.ts#L1439)). A VSCode-style explorer (navigator over properties) wants to *drag the boundary* between two open sections to trade height, which none of the current knobs allow — `fillWeight` fixes the ratio at construction and can only *add* leftover above preferred, never shrink a section below its preferred to feed a sibling.

This plan adds an opt-in **resizable mode** to `Accordion`: draggable gutters between adjacent open sections, backed by a per-section stored-height layer that the drag rewrites and that reconciles with collapse/expand and the existing fill distribution. The change is contained to [`Accordion.ts`](src/typescript/lib/layout/Accordion.ts), [`AccordionOptions`](src/typescript/lib/layout/Accordion.ts#L86), and a thin pass-through in [`AccordionPanel`](src/typescript/lib/component/container/AccordionPanel.ts). The drag divider **reuses the existing [`SplitGutter`](src/typescript/lib/component/container/SplitGutter.ts) component** (vertical, non-collapsible) rather than a bespoke handle, so the drag/touch/body-pointer-events plumbing is shared with `Split`.

**Hard requirement:** the gutters **must take up no layout space** — they are absolutely-positioned overlays that reserve zero height in the accordion's sizing math and are never inserted into the flow between sections — **yet must remain live mouse-drag targets** that react to press/drag to reapportion the two adjacent sections. Zero footprint and full drag interactivity are both non-negotiable; the design below satisfies them via a positioned overlay strip (not an in-flow divider).

---

## Architecture Decisions

### Native resizable gutters, not a `Split`-composition recipe

A `Split`-composition recipe was rejected as the primary answer. `Accordion` sections are **manager-internal**: the per-section `AccordionHeader` and the animated panel-wrapper are created and owned by the manager ([`createSection`](src/typescript/lib/layout/Accordion.ts#L1074)) and are *not* visible through `container.getComponents()`. A `Split` sees only the content components, so wrapping the accordion's children in a `Split` would forfeit the header stack, collapse/expand, single-open, `fillWeight`, and the coordinated open/close animation — it would no longer be an accordion. Composing *separate* single-section `AccordionPanel`s inside a `Split` reproduces none of the cross-section behaviour either. The resize therefore has to live inside the accordion, operating on the same open-section set the fill logic already manages. (A short "compose with `Split` when you want independent draggable panes instead of collapsible sections" pointer belongs in the docs, but it is not the feature.)

### Reuse `SplitGutter`, not `Split`'s sizing model

The drag *divider* is reused wholesale: `SplitGutter("vertical", { collapsible: false, expandedBackground: "transparent" })` is a transparent, `ns-resize`, draggable strip that already emits `dragstart`/`drag` with the absolute `clientY`, handles touch, and disables `document.body` pointer-events for the drag ([`SplitGutter.onDragStart`](src/typescript/lib/component/container/SplitGutter.ts#L496)) — exactly the plumbing a hand-rolled handle would duplicate. `collapsible: false` suppresses the chevron, tooltip, and opaque-strip machinery, which are irrelevant here.

`Split`'s *sizing* model is **not** reused. `Split.setPaneSize`/`recalculateSizes` apportion **all** panes of a container against one main axis; the accordion's open sections are a *subset* of the children (closed sections and headers are fixed overhead interleaved between them), so the accordion needs its own subset-aware distribution. We adopt `Split`'s *proven shape* — store absolute px sizes per open section, rescale them by `budget / Σstored` each layout to refit, and rewrite only the two adjacent sections on drag (conserving their sum) — but keyed to the open-section subset.

### Stored per-section heights supersede fill for open sections, seeded from it

In resizable mode the open sections' content heights come from a new `Map<Component, number>` (`_resizeSizes`) instead of the `openContentHeight + fill` path. On the first resizable layout a section with no stored entry is **seeded from what the non-resizable path would have given it** (`openContentHeight(shrinkRatio) + computeFill share`), so turning resizable on is visually seamless and `fillWeight` still decides the *initial* split. After that, drag is authoritative — this is the manual override of `fillWeight`, mirroring how a `Split` gutter-drag overrides its resize weights. The stored sizes are absolute px that sum to the open budget when written, so the per-layout rescale is a near-identity until the container resizes (then it rescales proportionally, preserving the dragged ratio). Keying by `Component` (not index) matches `Split._sizes` and survives section reordering; stale entries are pruned each layout.

### Gutters take zero layout space but stay live drag targets

**This is a requirement, not just a consequence:** a resize gutter must reserve **no** layout space while still reacting to mouse-drag. Each gutter is an absolutely-positioned strip (`position: absolute`, thin `RESIZE_GUTTER_SIZE = 6px`) laid **over** the bottom edge of the upper open section's content — it is never an in-flow element between sections, so it contributes nothing to any height calculation. It stays fully interactive because `SplitGutter` is a real, event-wired component sitting on top of the content: it captures `pointerdown`/drag on those overlaid px and emits `dragstart`/`drag`, which drive the apportionment. So the two properties hold simultaneously — **zero footprint** (nothing threaded through `computeShrinkRatio`/`computeFill`/the size reports; the open-content budget stays exactly `containerInner − Σheaders − Σspacing`) **and full drag reactivity** (the overlay is a normal draggable component, not a decorative line).

Further consequences: a section with a closed section between it and the next open section still gets a boundary handle at its own content bottom. This diverges from `Split` (whose gutters *do* reserve `GUTTER_SIZE` in flow) and is the right call because the accordion already has fixed header rows structuring the stack — a reserved gutter would fight the header rhythm and the `top`-animation of the rows below. (See _Potential Challenges → Gutter overlay vs header clicks_ for the one interaction cost: the overlay claims the bottom 6px of the upper content.)

### Default off; no effect under `singleOpen` or with < 2 open sections

`resizable` defaults `false` — every existing accordion is byte-for-byte unchanged. Gutters are created/shown only when `resizable` and **two or more** sections are open. Under `singleOpen` at most one section is ever open, so no gutter ever appears (documented, not an error). With resizable on and exactly one section open, that section fills the whole budget (the stored-size distribution degenerates to "one section = budget"), which subsumes `fillHeight` for that case.

### `_resizable` uses a plain field initializer (not `declare`)

The `declare`-during-super rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) applies only when the base constructor dispatches `applyOptions` *during* `super()`. `Accordion` extends `LayoutManager`, whose constructor takes no options; `Accordion`'s own constructor calls `applyOptions` from its **body, after `super()` returns** ([`Accordion` constructor](src/typescript/lib/layout/Accordion.ts#L157)), so field initializers have already run. `_fillHeight`, `_spacing`, etc. are plain `= …` initializers for exactly this reason; `_resizable` follows suit.

---

## Public API

### `Accordion` (src/typescript/lib/layout/Accordion.ts)

```typescript
interface AccordionOptions extends LayoutManagerOptions {
    // …existing…
    resizable?: boolean;   // opt into draggable gutters between open sections
}

class Accordion extends LayoutManager {
    isResizable(): boolean;
    setResizable(value: boolean): this;   // toggles; schedules a layout
}
```

- Backing field: `private _resizable: boolean = false;` (plain initializer — see Architecture Decisions).
- `setResizable` dispatched from `applyOptions` alongside the other option setters.

### `AccordionPanel` (src/typescript/lib/component/container/AccordionPanel.ts)

```typescript
interface AccordionPanelOptions extends ContainerOptions {
    // …existing…
    resizable?: boolean;   // forwarded to getAccordion().setResizable
}
```

- In the constructor, `if (options?.resizable !== undefined) this.getAccordion().setResizable(options.resizable);` (mirrors the existing `singleOpen` pass-through at [AccordionPanel:94](src/typescript/lib/component/container/AccordionPanel.ts#L94)).
- No new `AccordionConstraints` field — per-section minimums already come from `component.getMinSize()`, and `fillWeight` already seeds the initial split.

---

## Internal Structure

New module-private constant, near [`COMPACT_HEADER_HEIGHT`](src/typescript/lib/layout/Accordion.ts#L48):

```typescript
// Thickness (px) of a resizable-mode drag gutter. It overlays the bottom edge
// of the upper open section's content and reserves NO layout budget, so the
// open-content sizing math is unaffected by whether gutters are shown.
const RESIZE_GUTTER_SIZE: number = 6;
```

New fields on `Accordion`:

```typescript
private _resizable: boolean = false;
// User-dragged content heights per open section, absolute px summing to the
// open budget when written. Keyed by Component (reorder-safe, like Split._sizes);
// pruned each layout for removed components. A closed section keeps its entry
// frozen for reopen.
private _resizeSizes: Map<Component, number> = new Map<Component, number>();
// Gutter pool, reused across layouts; one shown per adjacent open-section pair.
private _resizeGutters: SplitGutter[] = [];
// Rebuilt each layout: for gutter i, the two content components it resizes.
private _gutterPairs: Array<{ upper: Component; lower: Component }> = [];
// Drag origin captured on gutter dragstart.
private _dragUpper: Component | null = null;
private _dragLower: Component | null = null;
private _dragOriginPointer: number = 0;
private _dragOriginUpper: number = 0;
private _dragOriginLower: number = 0;
```

Import: `import { SplitGutter } from "~/component/container/SplitGutter.js";` (`Accordion` already imports from `~/component/container/` for `AccordionHeader`, so no new cycle).

### Open-section height distribution (resizable path)

`private computeResizableHeights(components, containerSize, shrinkRatio, fills): Map<number, number> | null`

Returns a map from **container index → content height** for open sections, or `null` when the resizable path is inactive (`!_resizable`, no container size, or zero open sections) so the caller keeps the legacy `openContentHeight + fill` path.

1. Collect the displayed-open container indices and their content components.
2. `openBudget = containerSize.height − Σ effectiveHeaderHeight(displayed) − Σ spacing(between displayed)`. (Same overhead the `y`-cursor walk consumes; closed sections contribute a header only.)
3. **Seed** any open component missing from `_resizeSizes` with its legacy height `openContentHeight(component, shrinkRatio) + (fills.get(index) ?? 0)`, then `_resizeSizes.set(component, seed)`. This is why `doLayout` computes `shrinkRatio`/`fills` before calling this (seed parity with non-resizable mode).
4. `stored = Σ _resizeSizes.get(openComponent)`. `factor = stored > 0 ? openBudget / stored : 0`.
5. For each open index, `height = _resizeSizes.get(component) * factor`, floored at `component.getMinSize()?.height ?? 0`. Emit into the result map.

No per-layout rewrite of `_resizeSizes` (preserves the dragged ratio; the `factor` absorbs container-size changes) — matching `Split`'s flexible-refill approach.

### Drag handlers (vertical, over content heights)

`private onGutterDragStart(gutterIndex, position)`:
- `const pair = this._gutterPairs[gutterIndex]; if (!pair) return;`
- `_dragUpper = pair.upper; _dragLower = pair.lower; _dragOriginPointer = position;`
- `_dragOriginUpper = pair.upper.getHeight(); _dragOriginLower = pair.lower.getHeight();`
- Suppress transitions for the live drag: set every header/wrapper/content `setTransition("none")` (reuse the reduced-motion branch pattern in [`primeWrapper`](src/typescript/lib/layout/Accordion.ts#L1570)).

`private onGutterDrag(gutterIndex, position)` — mirrors [`Split.onDrag`](src/typescript/lib/layout/Split.ts#L737) on the vertical axis:
- `total = _dragOriginUpper + _dragOriginLower; offset = position − _dragOriginPointer;`
- `minU/minD/maxU/maxD` from each content's `getMinSize().height` / `getMaxSize().height` (null min → 0, null/UNBOUNDED max → +∞).
- `loU = max(minU, total − maxD); hiU = min(maxU, total − minD);`
- `newU = clamp(_dragOriginUpper + offset, loU, hiU); newD = total − newU;`
- `_resizeSizes.set(_dragUpper, newU); _resizeSizes.set(_dragLower, newD);`
- `this.getContainer()?.doLayout();` (synchronous reflow of the whole stack; transitions are off, so writes land instantly). Full `doLayout` — unlike `Split`, a change to the upper section shifts every header/wrapper below it.

`private onGutterDragEnd()`: restore each header/wrapper/content transition via `buildHeaderTransition()`/`buildWrapperTransition()`/`buildContentTransition()`; clear `_dragUpper/_dragLower`. Wire it to the gutter's drag stop — `SplitGutter` has no `dragend` event, so add a viewport `mouseup`/`touchend` listener in `onGutterDragStart` (via `Event.addViewportListener`, mirroring `SplitGutter.onDragStart`) that fires `onGutterDragEnd` once, or add a `"dragend"` emit to `SplitGutter` (see Potential Challenges).

### Gutter placement in `doLayout`

Within the existing per-section loop in [`doLayout`](src/typescript/lib/layout/Accordion.ts#L1238), after advancing `y` past an open section's `panelHeight`:
- Compute `resizeHeights = this.computeResizableHeights(...)` once before the loop (alongside `shrinkRatio`/`fills`).
- The open height becomes `const openHeight = resizeHeights ? resizeHeights.get(i)! : (this.openContentHeight(...) + (fills.get(i) ?? 0));`
- Maintain a running "previous open index" while walking. When the resizable path is active and this open section has another open section later, take the next pooled gutter, position it at `x = insets.left`, `y = (content bottom) − RESIZE_GUTTER_SIZE`, `width = containerWidth`, `height = RESIZE_GUTTER_SIZE`, `setVisible(true)`, and record `_gutterPairs[g] = { upper: thisContent, lower: nextOpenContent }`. Because "next open" may be several indices down (closed sections between), resolve it by scanning ahead for the next displayed-open section — or, simpler, place the gutter for open section *k* keyed to "the previous open section" on the *next* open iteration (defer placement by one open section so both endpoints are known).
- Lazily create gutters like `Split` ([Split.doLayout gutter creation](src/typescript/lib/layout/Split.ts#L921)): `new SplitGutter("vertical", { collapsible: false, expandedBackground: "transparent" })`, wire `on("dragstart", pos => this.onGutterDragStart(gIdx, pos))` and `on("drag", pos => this.onGutterDrag(gIdx, pos))`, `DOM.sink.appendChild(container.getElement()!, gutter.getElement(true)!)`, push to `_resizeGutters`.
- After the loop, `setVisible(false)` every pooled gutter not placed this pass (mirrors [Split.doLayout tail](src/typescript/lib/layout/Split.ts#L1054)).
- Give each placed gutter a `top` transition matching the header transition (`buildHeaderTransition()`) so the boundary handle slides with the animating rows on open/close.

### Cleanup

- In `doLayout` (or a small pruning pass), drop `_resizeSizes` entries whose component is absent from `container.getComponents()` — mirrors [`Split.recalculateSizes`](src/typescript/lib/layout/Split.ts#L1241).
- In [`detach`](src/typescript/lib/layout/Accordion.ts#L905): remove each gutter element from the DOM and `destroy()` it, then clear `_resizeGutters`, `_resizeSizes`, `_gutterPairs` (mirror [`Split.detach`](src/typescript/lib/layout/Split.ts#L790)).

---

## Ordered Implementation Steps

1. **Constant + import** — add `RESIZE_GUTTER_SIZE = 6` near `COMPACT_HEADER_HEIGHT`, and `import { SplitGutter } from "~/component/container/SplitGutter.js";`.
2. **Fields** — add `_resizable`, `_resizeSizes`, `_resizeGutters`, `_gutterPairs`, and the five `_drag*` fields listed above (all plain initializers).
3. **Option + setters** — add `resizable?: boolean` to `AccordionOptions`; add `isResizable`/`setResizable` (setter sets `_resizable` and calls `this.getContainer()?.scheduleLayout()`); dispatch `options.resizable` in `applyOptions` next to `fillHeight`.
4. **Seed distribution helper** — add `computeResizableHeights(components, containerSize, shrinkRatio, fills)` per _Internal Structure_. Verify: returns `null` when `!_resizable`.
5. **doLayout wiring** — compute `resizeHeights` after `fills`; branch `openHeight` on it; add the deferred-by-one-open-section gutter placement + `_gutterPairs` bookkeeping + lazy gutter creation + trailing `setVisible(false)`; prune stale `_resizeSizes`.
6. **Drag handlers** — add `onGutterDragStart`/`onGutterDrag`/`onGutterDragEnd`; wire dragstart to also register a one-shot viewport `mouseup`/`touchend` (or a new `SplitGutter` `"dragend"` — see Challenges).
7. **detach cleanup** — remove/destroy gutters and clear the three collections.
8. **AccordionPanel** — add `resizable?: boolean` to `AccordionPanelOptions`; forward it in the constructor.
9. **Checkpoint** — `grep -n "declare" src/typescript/lib/layout/Accordion.ts` — expect no new `declare` fields (the plain-initializer decision).
10. **Docs + JSDoc** — see _Documentation Impact_.
11. **Typecheck + build** — `npm run build:lib` (the app consumes the built `dist/lib`); `npm run docs:build` must finish with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` |
| Modify | `docs/layouts/Accordion.md` |
| (maybe) Modify | `src/typescript/lib/component/container/SplitGutter.ts` — only if adding a `"dragend"` event (see Potential Challenges) |
| Add | `tests/component/layout/Accordion.resizable.test.ts` |

---

## Expected Behaviour

Unit-testable (extend the harness in [`Accordion.manager.test.ts`](tests/component/layout/Accordion.manager.test.ts) — `hostAccordion`, `content`, `constraints`, fixed `HEADER`):

1. **Default off:** with `resizable` unset, `doLayout` places open sections exactly as today (preferred + `fillWeight`/`fillHeight`), and no gutter elements are appended to the container. A regression test that the existing sizing/fill numbers are unchanged.
2. **Seed parity:** enable `resizable`, two open sections with `fillWeight` `1`/`0` and preferred heights, host taller than preferred → first `doLayout` yields the *same* two heights the non-resizable `fillWeight` split would (seed-from-fill), summing to the open budget.
3. **Fill invariant:** in resizable mode the open sections' heights always sum to `containerInner − Σheaders − Σspacing` (allowing for min floors), for 1, 2, and 3 open sections.
4. **Rescale on container resize:** after a first layout, grow/shrink the host height and re-layout → open heights rescale proportionally (dragged/seeded ratio preserved), still summing to the new budget.
5. **Min floor:** an open section with a `minHeight` never renders below it even when the sibling's stored size would push it lower.
6. **Collapse frees space:** open A/B/C, then close B → A and C rescale to fill the freed budget; B's `_resizeSizes` entry is retained. Reopen B → it returns near its retained height and A/C give the space back.
7. **Gutter count:** number of *visible* gutters equals `max(0, openCount − 1)` in resizable mode, `0` otherwise and `0` under `singleOpen`.
8. **Prune:** removing a section's component drops its `_resizeSizes` entry on the next layout.
9. **Drag apportionment (logic only):** call `onGutterDragStart`/`onGutterDrag` directly with synthetic pointer coordinates and assert the two adjacent sections trade height conserving their sum and clamped to each `[min, max]` — the same contract as [`Split.onDrag`](src/typescript/lib/layout/Split.ts#L737), which is unit-tested in [`Split.test.ts`](tests/component/layout/Split.test.ts).

Manual verification (not exercisable by the DOM test harness):
- Real pointer/touch drag on the boundary shows the `ns-resize` cursor, resizes live without lag, and does not toggle the sections.
- On open/close the gutter slides with the boundary (its `top` transition) rather than snapping.
- `document.body` pointer-events are restored after a drag (no stuck cursor).
- Ground truth in the app: `sqladmin` `TreeExplorerView` (tree over inspector) — enabling `resizable` lets the user drag the tree/inspector boundary (app adoption is downstream; see Non-Goals).

---

## Verification

- `npm run build:lib` — typecheck + emit the `dist/lib` the app consumes (per repo memory, **not** `npm run build`).
- `npx vitest run tests/component/layout/Accordion.resizable.test.ts tests/component/layout/Accordion.manager.test.ts` — new behaviours + no regression in the existing manager suite.
- `grep -n "declare" src/typescript/lib/layout/Accordion.ts` — expect no new `declare` fields.
- `npm run docs:build` — zero warnings (watch the `{@link}`-to-internal rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md): the new public JSDoc may link `SplitGutter`/`Split`/`AccordionConstraints` but not private members).
- Manual smoke: drive an accordion with `resizable: true` and ≥2 open sections; drag the boundary, toggle a section mid-layout, resize the viewport.

---

## Documentation Impact

- **[`docs/layouts/Accordion.md`](docs/layouts/Accordion.md):** add a `resizable` row to the options table (Setter/getter `setResizable`/`isResizable`, default `false`); add a `## Resizable sections` section after `## Fill mode` explaining draggable gutters between open sections, that it seeds from and then overrides `fillWeight`, that it is inert under `singleOpen`/with <2 open, and a one-line pointer to composing with [`Split`](/api/layout/classes/Split) when independent draggable panes (not collapsible sections) are wanted.
- **JSDoc:** class-doc `@example` optional; document `setResizable`/`isResizable` and the `AccordionOptions.resizable` / `AccordionPanelOptions.resizable` fields.
- **`llms.txt`** is generated from `scripts/llms/manifest.data.mjs`; the Accordion one-line summary is unchanged, so no manifest edit — but the `tests/unit/llms-generate.test.ts` regeneration check still runs.
- The API reference pages (`docs/api/`) are generated by `npm run docs:build`; no manual edit.

---

## Potential Challenges

- **Drag-end signal.** `SplitGutter` emits `dragstart`/`drag` but not `dragend` (it restores its own body pointer-events internally on `onDragStop`). To re-enable the suppressed section transitions, either (a) register a one-shot viewport `mouseup`/`touchend` in `onGutterDragStart` via `Event.addViewportListener` (self-contained, no library change), or (b) add a `"dragend"` event to `SplitGutter` fired from `onDragStop` (cleaner, tiny surface change, but touches a shared component). Prefer (a) to keep the change inside `Accordion`.
- **Live-drag animation.** The section wrappers/contents carry `height` transitions ([`buildWrapperTransition`](src/typescript/lib/layout/Accordion.ts#L1638)); without suppressing them a drag would animate every frame and lag the cursor. Suppress on dragstart, restore on dragend (reuse the reduced-motion `"none"` pattern).
- **Gutter overlay vs header clicks.** The 6px gutter overlays the *content* bottom, not the header, so header toggles are unaffected; but it does capture the bottom 6px of the upper content. Acceptable (matches VSCode's resize hit zone); keep the strip thin.
- **`getPreferredSize`/`getMinSize` untouched.** Resizable only changes *distribution* of a stretched accordion, not its intrinsic hints — leave the size reports alone so the host contract (`min ≤ preferred ≤ max`, `notifyIntrinsicSizeChanged` on toggle) is unchanged.
- **`shrinkRatio` interaction.** When even the open sections' combined min exceeds the container, `computeResizableHeights` floors each at its min and lets the host clip — same fallback spirit as the non-resizable shrink case 3.

---

## Critical Files

- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — `doLayout`, `computeShrinkRatio`, `computeFill`, `openContentHeight`, `primeWrapper`, `detach`, the `build*Transition` helpers.
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `onDragStart`/`onDrag` (the reused clamp-conserve drag math), lazy gutter creation and `setVisible(false)` tail in `doLayout`, `detach`, stale-entry pruning in `recalculateSizes`.
- [`src/typescript/lib/component/container/SplitGutter.ts`](src/typescript/lib/component/container/SplitGutter.ts) — construction options (`collapsible`, `movable`, `expandedBackground`, direction→cursor/axis), the `dragstart`/`drag` event contract, `onDragStart`/`onDragStop` body-pointer-events handling.
- [`src/typescript/lib/component/container/AccordionPanel.ts`](src/typescript/lib/component/container/AccordionPanel.ts) — the option pass-through pattern.
- [`tests/component/layout/Accordion.manager.test.ts`](tests/component/layout/Accordion.manager.test.ts) and [`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts) — test harness and the existing drag-math assertions to model the new tests on.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) / [ARCHITECTURE.md](ARCHITECTURE.md) — the `declare`-during-super rule, `{@link}` restriction, typed-setter and event conventions.

---

## Non-Goals

- **App adoption.** Turning on `resizable` in `sqladmin`'s `TreeExplorerView`/`QueriesView` is downstream and out of scope; this plan is the library capability only.
- **Persistence/serialization of dragged sizes.** `Split` exposes `getPaneRatios`/`applyPaneRatios`; an equivalent for the accordion is not part of this plan (add later if a consumer needs to save layout).
- **Collapse-to-strip / chevron on the gutter.** The reused `SplitGutter` runs with `collapsible: false`; section collapse stays on the header chevron, unchanged.
- **Reserving gutter footprint in the layout budget.** Deliberately rejected (zero-reserving overlay — see Architecture Decisions).
- **Horizontal accordions.** `Accordion` is a vertical stack; no orientation option is added.
