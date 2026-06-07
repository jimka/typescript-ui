---
depends-on:
  - size-constraint-invariant.md
  - component-move-helper.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
---

# Tab Drag-Reorder & Tear-Off Detach — Implementation Plan

## Overview

Wire the existing drag-and-drop engine into the [`Tab`](../src/typescript/lib/layout/Tab.ts#L220) layout manager so a tab header can be (1) **drag-reordered** within its own strip and (2) **torn off** into a floating [`Window`](../src/typescript/lib/core/Window.ts#L135), and dropped back into any Tab strip to re-dock. This is plan **#2 of 5** toward a dock/tab manager and is pure *wiring*: [`DragManager`](../src/typescript/lib/core/DragManager.ts), [`ReorderIndicator`](../src/typescript/lib/core/component/ReorderIndicator.ts#L35), [`DragGhost`](../src/typescript/lib/core/component/DragGhost.ts#L45), [`DragFeedback`](../src/typescript/lib/core/component/DragFeedback.ts#L25), and `Window` all already exist — no new DnD infrastructure is built here.

The work is confined to [`Tab.ts`](../src/typescript/lib/layout/Tab.ts): each tab wrapper becomes a `makeDragSource`, the toolbar becomes a `makeDropTarget`, and three new private methods (`reorderTab`, `detachTabToWindow`, `dockComponentFromWindow`) carry out the moves. All content re-parenting goes through the `moveComponent(child, index?, constraints?)` primitive from plan #1 ([`component-move-helper.md`](component-move-helper.md)), never a manual remove+add.

The drag-data payload shape established here — a stable `{ tabDrag: true, sourceTabId, componentId }` record — is the **reusable contract** that plans #3 (edge-drop-to-split) and #5 (dock/tab manager) read via `accepts`/`onDrop`.

---

## Architecture Decisions

### Drag source = the tab **wrapper**, drop target = the **toolbar**

Each tab's [`wrapper`](../src/typescript/lib/layout/Tab.ts#L120) Component (the `Fit`-laid cell holding the `ToggleButton` + optional close button) is registered as the drag source via `makeDragSource(wrapper, …)`. The wrapper, not the inner `ToggleButton`, is chosen because it already owns the cell geometry the reorder math needs and `makeDragSource` installs an `addMouseDownSubtreeListener` (see [`DragManager.makeDragSource`](../src/typescript/lib/core/DragManager.ts#L165)), so a mousedown anywhere in the cell — button or close glyph — begins a drag candidate.

The single [`_toolbar`](../src/typescript/lib/layout/Tab.ts#L222) Component is registered as the drop target via `makeDropTarget(_toolbar, …)`. One target per strip (not one per tab) keeps the hit-test cheap and lets `onDragOver` compute the insertion slot from the cursor's X against every wrapper's bounds in one place. `DragManager`'s [`pickDropTarget`](../src/typescript/lib/core/DragManager.ts#L338) hit-tests `document.elementsFromPoint(...).id` against registered targets, so the toolbar's element id must resolve — it always does, the toolbar element is created in [`attach`](../src/typescript/lib/layout/Tab.ts#L538).

### The close button must veto the drag threshold

`makeDragSource`'s subtree mousedown listener fires for the close-button cell too. A click on ✕ that drifts a few px would otherwise commit a drag instead of closing. Mitigation: the close-button already stops at `action`; additionally the source's `onDragStart` veto (return `false`, see [`DragSourceOptions.onDragStart`](../src/typescript/lib/core/DragManager.ts#L47)) returns `false` when the recorded mousedown target was inside the close button. The mousedown target is captured by adding a plain `mousedown` subtree listener on the wrapper that records `e.target`, read once in `onDragStart`, then cleared. (`DragEventDetail` carries no DOM target, so we capture it ourselves.)

### Reuse `ReorderIndicator` but drive it for a **vertical** insertion line

[`ReorderIndicator`](../src/typescript/lib/core/component/ReorderIndicator.ts#L35) ships as a 2 px **horizontal** bar: `attachTo` sets `width = target.getWidth()` and `setInsertionY(y)` moves it vertically. A tab strip needs a **vertical** bar between cells. `DragManager`'s contract only lets `onDragOver` return a single number interpreted as `y` ([`enterNewTarget`](../src/typescript/lib/core/DragManager.ts#L383) calls `setInsertionY(hint)`), so the manager-driven indicator cannot draw a vertical line.

**Decision:** do **not** widen the `DragManager`/`ReorderIndicator` contract in this plan. Instead `Tab` owns its own insertion-line overlay drawn inside the toolbar — a thin reuse of the same `--ts-ui-drag-reorder-color` token, positioned horizontally at the computed slot boundary. `onDragOver` returns `null` (so the manager's own indicator stays detached) and `Tab` toggles its private vertical bar from inside the `onDragOver` callback. This keeps the manager's row-oriented indicator untouched for plans #3/#5 while giving tabs correct feedback. The bar is a `TabReorderBar extends Component` nested class mirroring `TabIndicator`'s raw-appended-overlay pattern ([`TabIndicator`](../src/typescript/lib/layout/Tab.ts#L139)), so the toolbar's `HBox` never allocates it a cell. Flagged because it is the one place this plan adds a visual element rather than pure wiring; it adds **no new theme token** (reuses `--ts-ui-drag-reorder-color`).

### Reorder and re-dock move **content**, not buttons — rebuild the strip from `_tabs`

A tab's identity is its `TabEntry` (button + wrapper + content). Reordering must reorder the `_tabs` array *and* the toolbar's wrapper children *and* keep `_selectedTabIndex` pointing at the same logical tab. Rather than splice the DOM by hand, `reorderTab(from, to)` splices the `_tabs` array, then re-orders the toolbar's wrapper children via `this._toolbar.moveComponent(wrapper, to)` (plan #1's primitive — same-parent reorder path), fixes up `_selectedTabIndex`, and `scheduleLayout()`s. The content component is **not** moved on a same-strip reorder (it never leaves the container); only the strip order changes.

For **tear-off** and **re-dock**, the *content* component moves containers, so `detachTabToWindow` / `dockComponentFromWindow` use `window.moveComponent(content)` and `targetContainer.moveComponent(content, index)` respectively. Using `moveComponent` (not remove+add) gives the atomic detach/attach with both ends re-laying out for free, per plan #1.

### Tear-off destination is a plain `Window` hosting the content directly

A `Window` uses a `Border` layout; an added child with no placement fills CENTER (the body). So `detachTabToWindow` creates `new Window(tabLabel)`, calls `window.moveComponent(content)` to re-parent the live content into the window body, `window.show()`s it near the drop point, and removes the now-empty `TabEntry` from the source strip (reusing the existing [`closeTab`](../src/typescript/lib/layout/Tab.ts#L1263) teardown bookkeeping minus the `tabclose` emit and minus the content `removeComponent`, since `moveComponent` already detached it). The window is positioned at the cursor's release point (`detail.clientX/clientY`).

Detach triggers when a drag **commits but is released outside any Tab-strip drop target** — detected in the source's drag lifecycle. Because `DragManager` fires no "dropped on nothing" callback to the *source*, `Tab` listens for the `"dragend"` DOM event on the wrapper (the manager fires `dragstart`; confirm whether it also fires `dragend` — see Potential Challenges) **or**, more robustly, the drop-vs-detach decision is made entirely target-side: every Tab toolbar's `onDrop` handles re-dock/reorder; a release with no accepting target leaves the content where it is, and tear-off is offered instead via a dedicated drop target. **Chosen approach:** tear-off is decided source-side on drag end using a manager-provided end signal; if the manager exposes no source-side end hook, add a minimal `onDragEnd?(detail, dropped: boolean)` to `DragSourceOptions` (smallest possible manager touch) — resolve this in step 1 by reading `endSession`/`onMouseUp` in `DragManager.ts` before committing to either path.

### Drag-data payload — the cross-plan contract

```typescript
interface TabDragData {
    tabDrag:     true;        // discriminator other targets test in `accepts`
    sourceTabId: string;      // the source Tab toolbar's getId() — self-strip detection
    componentId: string;      // the content Component's getId() — what gets moved
    label:       string;      // tab label, for the ghost and the tear-off window title
}
```

`sourceTabId` lets a strip distinguish "reorder within me" from "dock from another strip". `componentId` is resolved back to the live `Component` through a module-level `Weak` registry the source populates at drag start (the content reference can't travel through the `DragData` record cleanly, and a plain id needs a lookup). Plans #3/#5 test `detail.dragData.tabDrag === true` to accept tab drags into splits / other docks. This shape is the stable contract; do not rename its fields downstream.

### No tear-off / re-dock when content is still lazy

A tab in `"lazy"` or `"building"` state has `entry.component === null` (see [`TabEntry`](../src/typescript/lib/layout/Tab.ts#L119) / [`materializeAsync`](../src/typescript/lib/layout/Tab.ts#L975)). Dragging such a tab forces materialization first (call the existing `materializeAsync` and veto the drag via `onDragStart` returning `false` for that gesture) — reordering a not-yet-built tab is still allowed because reorder touches only the wrapper, not the content. Detach/dock are gated on `state === "ready"`.

---

## Public API (TypeScript Signatures)

No new *public* setters or options are strictly required for the feature, but reorder/tear-off should be opt-in per strip so existing `Tab` consumers are unaffected. Add one option + its typed setter/getter following the project's option-backed-field idiom (cached field `_reorderable`, `TabOptions.reorderable`, setter `setReorderable`, getter `isReorderable`):

```typescript
interface TabOptions extends LayoutManagerOptions {
    /** Enable header drag-reorder and tear-off detach. Defaults to `false`. */
    reorderable?: boolean;
    // ...existing fields unchanged
}

class Tab extends LayoutManager {
    /** Toggles header drag-reorder + tear-off detach for this strip. */
    setReorderable(value: boolean): this;
    /** Returns whether drag-reorder + tear-off is enabled. */
    isReorderable(): boolean;
}

/** Drag-data payload for a tab header drag. The cross-plan contract. */
interface TabDragData {
    tabDrag:     true;
    sourceTabId: string;
    componentId: string;
    label:       string;
}
```

Backing field: `private _reorderable: boolean = false;` declared on `Tab`. `setReorderable` installs/tears down the drag sources + drop target (calling `installTabDnD` / `teardownTabDnD`); `applyOptions` dispatches it after the existing option block. `TabDragData` is exported from the layout barrel for downstream plans.

---

## Theme Tokens

No new tokens. The vertical insertion bar reuses the existing `--ts-ui-drag-reorder-color` (already in `Theme.ts` at [line 880](../src/typescript/lib/core/Theme.ts#L880)); ghost/feedback reuse `--ts-ui-drag-ghost-*` and `--ts-ui-drag-feedback-*`. Confirm with `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — expect the existing block, no additions.

---

## Internal Structure

New private members on `Tab`:

```typescript
private _reorderable: boolean = false;
private _reorderBar: TabReorderBar = new TabReorderBar();          // vertical insertion line
private _dndTeardowns: Array<() => void> = [];                     // source + target teardown fns
private _dragMouseTarget: EventTarget | null = null;              // captured mousedown target for close-button veto
private _dragInsertIndex: number = -1;                            // slot computed in onDragOver, read in onDrop

// module scope:
const tabDragRegistry = new Map<string, Component>();             // componentId -> live content Component
```

`installTabDnD()` (called from `setReorderable(true)` and from `attach` when `_reorderable`): for each entry, `makeDragSource(entry.wrapper, …)` with `dragData: () => this.buildDragData(entry)`, an `onDragStart` that vetoes close-button drags + forces lazy materialization, and a `ghostFactory` producing a labelled `DragGhost(entry label)`; then one `makeDropTarget(this._toolbar, …)` whose `accepts` tests `detail.dragData.tabDrag === true`, whose `onDragOver` computes the insert slot from `clientX` vs each wrapper's `getX()+width/2`, positions `_reorderBar`, and returns `null`, and whose `onDrop` calls `reorderTab` (same `sourceTabId`) or `dockComponentFromWindow`/cross-strip dock (different `sourceTabId`). Push every teardown into `_dndTeardowns`.

`teardownTabDnD()` runs and clears `_dndTeardowns`, detaches `_reorderBar`, and is called from [`detach`](../src/typescript/lib/layout/Tab.ts#L560) and from `setReorderable(false)`.

Insert-slot math (`onDragOver`):

```typescript
// cursor X relative to toolbar; find first wrapper whose mid-X is past the cursor
const x = detail.clientX - this._toolbar.getElement(true).getBoundingClientRect().left;
let slot = this._tabs.length;
for (let i = 0; i < this._tabs.length; i++) {
    const w = this._tabs[i].wrapper;
    if (x < w.getX() + w.getWidth() / 2) { slot = i; break; }
}
this._dragInsertIndex = slot;
this._reorderBar.placeAt(slot < this._tabs.length
    ? this._tabs[slot].wrapper.getX()
    : /* right edge of last cell */ ...);
return null; // suppress the manager's horizontal indicator
```

`reorderTab(fromIdx, toIdx)`: splice `_tabs`, `this._toolbar.moveComponent(entry.wrapper, toIdx)`, recompute `_selectedTabIndex` so it still points at the logically-selected entry, `scheduleLayout()`.

`detachTabToWindow(entry, clientX, clientY)`: guard `entry.state === "ready"` and `entry.component`; `const win = new Window(label); win.setSize/ setX/setY near cursor; win.moveComponent(entry.component); win.show();` then remove the entry from the strip (button group / roving index / `_tabs` splice / `_toolbar.removeComponent(wrapper)` — the content is already gone via `moveComponent`, so do **not** call `container.removeComponent` and do **not** emit `tabclose`), `selectNextTab`, `scheduleLayout`.

`dockComponentFromWindow(content, slot)` / cross-strip dock: `this.getContainer().moveComponent(content, /* container index */)`, build a `TabEntry` for it (reuse `buildTabEntry` + wire ARIA via `wireComponentAria`), close the source window if it is now empty, select the new tab, `scheduleLayout`.

`TabReorderBar extends Component`: constructed like `TabIndicator` — `Position.ABSOLUTE`, `pointerEvents:none`, `setWidth(2)`, `setBackgroundColor("var(--ts-ui-drag-reorder-color)")`, raw-appended to the toolbar element in `attach`; `placeAt(x)` sets X + makes visible; `hide()` on drag leave / drop.

---

## Ordered Implementation Steps

1. **Resolve the source-side drag-end hook.** Read [`endSession`](../src/typescript/lib/core/DragManager.ts) / `onMouseUp` in `DragManager.ts`. If a drop-on-nothing signal already reaches the source (e.g. a `dragend` DOM event with a `dropped` flag), use it. Otherwise add a minimal optional `onDragEnd?(detail: DragEventDetail, dropped: boolean)` to [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40) and invoke it from `endSession` — the smallest possible manager change, justified in `## Architecture Decisions`. Typecheck.
2. **Add `TabDragData` interface** and the module-level `tabDragRegistry` map in `Tab.ts`; export `TabDragData` from the file and from [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts).
3. **Add the `TabReorderBar` nested class** (mirror `TabIndicator`). Raw-append its element in [`attach`](../src/typescript/lib/layout/Tab.ts#L538) next to the indicator.
4. **Add `_reorderable` field, `TabOptions.reorderable`, `setReorderable`/`isReorderable`,** and dispatch in [`applyOptions`](../src/typescript/lib/layout/Tab.ts#L292).
5. **Implement `buildDragData`, `installTabDnD`, `teardownTabDnD`,** and the close-button mousedown-target capture. Call `installTabDnD` from `attach` (when `_reorderable`) and from `setReorderable(true)`; call `teardownTabDnD` from [`detach`](../src/typescript/lib/layout/Tab.ts#L560) and `setReorderable(false)`. Register new entries' sources whenever a tab is added while `_reorderable` (hook into `buildTabEntry`).
6. **Implement `reorderTab`** using `this._toolbar.moveComponent(wrapper, toIdx)` (plan #1). Fix up `_selectedTabIndex`.
7. **Implement `detachTabToWindow`** using `window.moveComponent(content)` (plan #1) + the strip-entry removal (no `tabclose`, no content `removeComponent`).
8. **Implement `dockComponentFromWindow` / cross-strip dock** using `container.moveComponent(content, idx)` + `buildTabEntry` + `wireComponentAria`.
9. **Wire `installTabDnD`'s drop target** `onDragOver` (slot math + `_reorderBar.placeAt`, return `null`), `onDragLeave` (`_reorderBar.hide()`), `onDrop` (reorder vs dock by `sourceTabId`), and the source `onDragStart` (close-button veto + lazy-materialize gate) + `onDragEnd`/`dragend` (tear-off when released off-target).
10. **Typecheck** (`npm run build`/tsc) — zero errors. **Token checkpoint:** `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — expect no additions. **No-manual-reparent checkpoint:** `grep -n "removeComponent\|addComponent\|insertComponent" src/typescript/lib/layout/Tab.ts` — confirm new content-move sites use `moveComponent`, not a manual remove+add pair.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` — DnD wiring, `TabReorderBar`, `TabDragData`, `_reorderable` option, reorder/detach/dock methods |
| Modify | `src/typescript/lib/layout/index.ts` — export `TabDragData` |
| Modify (conditional) | `src/typescript/lib/core/DragManager.ts` — add `onDragEnd?` to `DragSourceOptions` only if no source-side drop-on-nothing signal exists (step 1) |

---

## Verification

- **Typecheck:** project `tsc`/build passes with zero errors.
- **Demo screen:** wire a `reorderable: true` Tab into an existing demo (e.g. `MiscPanel.ts`, which already constructs tabbed content) — or add a small `Tab`-driven panel there — to exercise the gestures.
- **Reorder:** drag a tab header left/right; the vertical insertion bar appears at slot boundaries; on release the tab moves and stays selected; content unchanged.
- **Tear-off:** drag a tab header off the strip and release over empty space; a `Window` opens at the cursor hosting the tab's content; the source strip drops the tab and selects a neighbour; no `tabclose` fires.
- **Re-dock:** drag the window's content back (or, if re-dock is gesture-limited, drop a cross-strip tab) onto another Tab strip; a new tab appears at the insertion slot and is selected; the emptied window closes.
- **Close-button veto:** a small drag on the ✕ closes the tab (or no-ops) rather than starting a drag.
- **Lazy tab:** dragging a not-yet-built tab forces materialization; reorder of a lazy tab works; tear-off is blocked until ready.
- **Theme toggle:** switch light/dark mid-drag; the insertion bar and ghost recolour from the existing `--ts-ui-drag-*` tokens.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- `TabDragData` and `setReorderable`/`isReorderable` are new public surface on the already-exported `Tab`; TypeDoc picks up their JSDoc. Add `TabDragData` to the layout barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)).
- Update the curated Tab page under `docs/layout/` (find via `grep -rln "\bTab\b" docs/layout/`): document the `reorderable` option, the reorder + tear-off gestures, and the `TabDragData` contract. Add the new symbols to that group's catalog `index.md` and, if a new page is created, the sidebar in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts).
- JSDoc cross-bucket links: reference `DragManager`, `ReorderIndicator`, `Window`, and `Component.moveComponent` with markdown links (`[`X`](/api/…)`), not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).

---

## Potential Challenges

- **No source-side "dropped on nothing" signal** — the manager fires `dragstart` and runs target callbacks, but tear-off needs the *source* to know the drag ended off-target. Mitigation: step 1 reads `endSession`/`onMouseUp`; add a minimal `onDragEnd?(detail, dropped)` to `DragSourceOptions` only if none exists.
- **Vertical insertion line vs. the row-oriented `ReorderIndicator`** — the manager's indicator only does horizontal. Mitigation: `Tab` owns its own `TabReorderBar`; `onDragOver` returns `null` so the manager's indicator stays detached (decision above).
- **Toolbar hit-test under the ghost** — `DragGhost` is `pointer-events:none`, so `elementsFromPoint` still returns the toolbar; but the per-cell `ToggleButton`/wrapper may be the top element, not the toolbar. Mitigation: `pickDropTarget` walks the *whole* z-stack ([`DragManager.pickDropTarget`](../src/typescript/lib/core/DragManager.ts#L338)) and matches the first registered id, and only the toolbar is registered — so a hover over a child cell still resolves the toolbar. Verify the toolbar element is an ancestor in the returned stack.
- **`_selectedTabIndex` drift on reorder/detach** — splicing `_tabs` shifts indices. Mitigation: recompute the selected index by entry identity (find the formerly-selected `TabEntry` after the splice), not by arithmetic.
- **Re-dock content came from a `Window`, not a Tab strip** — `dockComponentFromWindow` must resolve the live content via `componentId` through `tabDragRegistry` (or the window's body host) and close the now-empty window. Mitigation: register the content in `tabDragRegistry` at drag start for both detach and re-dock; clean the entry up on drag end.
- **Same-parent reorder via `moveComponent`** — relies on plan #1's same-parent path (which detaches then re-inserts so `insertComponent`'s same-parent early-return doesn't swallow it). Confirm `_toolbar.moveComponent(wrapper, idx)` actually reorders; covered by the reorder smoke test.
- **Element detach resets CSS transitions** — `moveComponent` re-parents the live DOM node, cancelling in-flight descendant transitions (documented plan #1 behaviour). Acceptable: a torn-off panel should not animate mid-flight.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `Tab` (220), `TabEntry` (119), `TabIndicator` (139, the overlay pattern to mirror), `buildTabEntry` (727), `createTab` (882), `wireComponentAria` (865), `attach` (538), `detach` (560), `onTabPressed` (517), `closeTab` (1263), `selectNextTab` (1298), `doLayout` (1061).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `DragSourceOptions` (40), `DropTargetOptions` (63), `DragEventDetail` (24), `makeDragSource` (165), `makeDropTarget` (182), `pickDropTarget` (338), `enterNewTarget` (383), `onMouseMove` (415), `commitSession` (296).
- [`src/typescript/lib/core/component/ReorderIndicator.ts`](../src/typescript/lib/core/component/ReorderIndicator.ts) — the horizontal-bar contract this plan deliberately does not extend.
- [`src/typescript/lib/core/component/DragGhost.ts`](../src/typescript/lib/core/component/DragGhost.ts) — labelled ghost via `new DragGhost(label)`.
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `Window` (135, `Border` layout → added child fills body), `show` (374), constructor (194).
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts#L600) — `installRowDnD` (600): the canonical `makeDragSource`+`makeDropTarget` consumer idiom + teardown-bag pattern to mirror.
- [`plans/component-move-helper.md`](component-move-helper.md) — the `moveComponent(child, index?, constraints?)` primitive this plan depends on.

---

## Non-Goals

- **Edge-drop-to-split** (drop a tab on a panel edge to create a split) — that is plan #3; this plan only reorders within a strip and tears off / re-docks whole tabs.
- **A general dock/tab manager** (persisting layouts, multi-region docking) — plan #5.
- **Widening the `DragManager`/`ReorderIndicator` contract to support vertical insertion lines** — deliberately avoided; `Tab` owns its own bar.
- **Animated cross-container tab moves** — `moveComponent` resets transitions by design (plan #1 Non-Goal); not re-litigated here.
- **Multi-tab / multi-select drag** — one tab per gesture.
- **New theme tokens** — reuses the existing `--ts-ui-drag-*` family.

---

## Blocking Prerequisite

[`plans/size-constraint-invariant.md`](size-constraint-invariant.md) should land first — reorder, detach, and dock each re-run layout on the source and destination containers, and doing so while the `min ≤ preferred ≤ max` invariant is still violated can surface inconsistent strip/content sizing. Referenced as an ordering dependency only; its contents are not re-planned here. Plan #1 [`component-move-helper.md`](component-move-helper.md) is a hard code dependency (the `moveComponent` API).
