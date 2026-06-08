---
depends-on:
  - size-constraint-invariant.md
  - component-move-helper.md
  - tab-layout-extensions.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
---

# Tab Tear-Off Detach & Re-Dock — Implementation Plan

## Overview

Layer **tear-off detach** and **re-dock** onto the within-strip drag wiring that [`tab-layout-extensions.md`](tab-layout-extensions.md) installs. A tab header can be (1) **torn off** the strip into a floating [`Window`](../src/typescript/lib/core/Window.ts#L135) when its drag is released over empty space, and (2) **re-docked** — dropped onto another (or the same) [`Tab`](../src/typescript/lib/layout/Tab.ts#L220) strip — to move the live content into that strip as a new tab. This is plan **#2 of 5** toward a dock/tab manager; it delivers the cross-container half of the gesture set (the within-strip reorder half now lives in the sibling extensions plan).

This plan **depends on** the extensions plan having already built the drag infrastructure: the `reorderable` option/triad, the per-wrapper `makeDragSource` registrations, the single `_toolbar` `makeDropTarget`, the `TabReorderBar` insertion overlay, `reorderTab`, the close-button drag veto, the main-axis slot math, and `installTabDnD`/`teardownTabDnD`. This plan does **not** install its own drag sources or drop target — it **extends the existing toolbar drop target's `onDrop`** (to branch reorder-vs-dock) and adds a source-side **`onDragEnd`** path (to detect drop-on-nothing for tear-off). The two new private methods this plan adds are `detachTabToWindow` and `dockComponentFromWindow`; all content re-parenting goes through `moveComponent(child, index?, constraints?)` from plan #1 ([`component-move-helper.md`](component-move-helper.md)), never a manual remove+add.

The work is confined to [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) plus one minimal optional touch to [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts). This plan **defines and exports** the `TabDragData` TYPE and the module-level `tabDragRegistry`; the extensions plan's `dragData` builder produces values of that shape. Plans #3 (edge-drop-to-split) and #5 (dock/tab manager) read `detail.dragData.tabDrag === true` and resolve the registry — both reference this plan as the single definition site (see [`edge-drop-to-split.md`](edge-drop-to-split.md), [`dock-tab-manager.md`](dock-tab-manager.md)).

**Filename note:** this plan was renamed from `tab-drag-reorder-detach.md` to `tab-detach-redock.md` because reorder moved to the extensions plan; all inbound links in sibling plans were updated.

---

## Architecture Decisions

### Composition — extend the extensions plan's drop target, don't install new DnD

The drag sources (`makeDragSource(entry.wrapper, …)`) and the single toolbar drop target (`makeDropTarget(this._toolbar, …)`) are **owned by** [`tab-layout-extensions.md`](tab-layout-extensions.md)'s `installTabDnD`/`teardownTabDnD`. This plan adds the cross-container move behaviour **on top of** that existing infrastructure:

- **Re-dock / cross-strip dock** is handled inside the *existing* toolbar `onDrop`. The extensions plan already branches on `sourceTabId`: a drop whose `dragData.sourceTabId === this._toolbar.getId()` is a within-strip reorder (`reorderTab`); a drop with a **different** `sourceTabId` is a dock from another container, and *that branch* calls this plan's `dockComponentFromWindow` / cross-strip dock using the insert slot the extensions plan already computed in `onDragOver` (`_dragInsertIndex`). This plan does not redefine the slot math — it reads the shared `_dragInsertIndex`.
- **Tear-off** is decided **source-side** when a committed drag is released over no accepting target. It hooks the source's drag-end, not a new drop target.

This keeps exactly one drop target and one set of drag sources per strip. No `installTabDnD` duplication; no second overlay.

### Tear-off needs a source-side "dropped on nothing" signal — add a minimal `onDragEnd`

[`endSession`](../src/typescript/lib/core/DragManager.ts#L532) already fires a `"dragend"` DOM event on the source when the session committed ([DragManager.ts:564-568](../src/typescript/lib/core/DragManager.ts#L564)), but it **discards** the `dropped` flag: the parameter is named `_dropped` and is never read, while [`onMouseUp`](../src/typescript/lib/core/DragManager.ts#L502) is the only place that knows whether an accepting target consumed the drop ([DragManager.ts:511-525](../src/typescript/lib/core/DragManager.ts#L502)). So a `"dragend"` listener on the wrapper fires for **both** a successful re-dock and a drop-on-nothing, with no way to tell them apart — which would tear off a tab that was actually re-docked.

**Decision:** add a single optional source-side hook to [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40):

```typescript
/** Fired once the gesture ends, after any onDrop. `dropped` is true iff an accepting target consumed it. */
onDragEnd?: (detail: DragEventDetail, dropped: boolean) => void;
```

`endSession` already receives the `dropped` value (rename its unused `_dropped` param to `dropped`) and already builds `detail` in the committed branch — invoke `session.sourceOptions.onDragEnd?.(detail, dropped)` there. This is the **smallest possible** manager change: no new session state, no new overlay, one field + one call inside the existing committed branch. The extensions plan's `makeDragSource` call gains this one callback (it is the source owner); the callback body is `(detail, dropped) => { if (!dropped) this.detachTabToWindow(entry, detail.clientX, detail.clientY); }`. Flagged in Architecture Decisions because it is the one cross-file touch outside `Tab.ts`.

### Tear-off destination is a plain `Window` hosting the content directly

A `Window` uses a [`Border`](../src/typescript/lib/core/Window.ts#L197) layout; a child added with no placement fills CENTER (the body). So `detachTabToWindow(entry, clientX, clientY)` constructs `new Window(label)`, positions it near the release point, calls `win.moveComponent(entry.component)` to re-parent the **live** content into the window body, and `win.show()`s it. It then removes the now-empty `TabEntry` from the source strip — reusing the [`closeTab`](../src/typescript/lib/layout/Tab.ts#L1263) teardown bookkeeping (`_buttonGroup.removeButton`, `_rovingTabIndex.remove`, `_tabs.splice`, `_toolbar.removeComponent(wrapper)`, `selectNextTab`, `scheduleLayout`) **minus** the `container.removeComponent(content)` (the content is already detached by `moveComponent`) **and minus** the `tabclose` emit (the tab is relocated, not closed). Using `moveComponent` rather than remove+add gives the atomic detach/attach with both ends re-laying out for free, per plan #1.

### Re-dock / cross-strip dock moves content into the destination container as a new tab

`dockComponentFromWindow(content, slot)` (and the equivalent cross-strip dock) re-homes the live `content` into **this** strip's container at the slot the extensions plan computed: `this.getContainer().moveComponent(content, slot)`, then builds a `TabEntry` for it (reuse `buildTabEntry` + `wireComponentAria`, [Tab.ts:727](../src/typescript/lib/layout/Tab.ts#L727)/[Tab.ts:865](../src/typescript/lib/layout/Tab.ts#L865)), selects the new tab, and `scheduleLayout`s. If the content came from a torn-off `Window` (resolved via the registry / the content's current parent), close that window once it is empty. `moveComponent` (not remove+add) does the atomic cross-container move; both the source container/window and this strip re-lay out.

### `TabDragData` payload — this plan owns the type + registry; the extensions plan builds the value

```typescript
/** Drag-data payload for a tab header drag. The cross-plan contract. */
export interface TabDragData {
    tabDrag:     true;        // discriminator other targets test in `accepts`
    sourceTabId: string;      // the source Tab toolbar's getId() — reorder-vs-dock detection
    componentId: string;      // the content Component's getId() — what gets moved
    label:       string;      // tab label, for the ghost and the tear-off window title
}
```

**Single definition site:** this plan declares and exports the `TabDragData` **type** (from `Tab.ts` and the layout barrel) and owns the module-level `tabDragRegistry` (`Map<string, Component>`, `componentId → live content Component`). The extensions plan's `dragData` builder *produces* a `TabDragData` value — it imports the type from here rather than re-declaring it. The registry is populated by the source at drag start and resolved by `onDrop`/`onDragEnd`; a plain id can't carry a live `Component` reference through the `DragData` record, hence the lookup. `sourceTabId` lets the toolbar `onDrop` distinguish "reorder within me" (same id → `reorderTab`, extensions plan) from "dock from elsewhere" (different id → `dockComponentFromWindow`, this plan). Plans #3/#5 test `tabDrag === true` and resolve `componentId` through this registry. Do not rename these fields downstream.

**Reconciliation:** because the extensions plan's `makeDragSource` is the only producer, its `dragData: () => buildDragData(entry)` builder must emit exactly `{ tabDrag: true, sourceTabId: this._toolbar.getId(), componentId, label }`, annotated against the type this plan defines. There is no second definition; if the extensions plan and this plan ever disagree on field names, this plan's type is canonical.

### No tear-off / re-dock when content is still lazy

A tab in `"lazy"` or `"building"` state has `entry.component === null` ([`TabEntry`](../src/typescript/lib/layout/Tab.ts#L119) / [`materializeAsync`](../src/typescript/lib/layout/Tab.ts#L975)). Detach and dock are gated on `entry.state === "ready"` and `entry.component !== null`. Forcing materialization on drag *start* is the extensions plan's `onDragStart` concern (it owns the gesture's start); this plan only guards the *move* at `onDragEnd`/`onDrop` time, so a still-building tab released over empty space is a no-op rather than tearing off a null component.

---

## Public API (TypeScript Signatures)

This plan adds **no new public setters or options** — the `reorderable` triad (`setReorderable`/`isReorderable`/`TabOptions.reorderable`) is owned by [`tab-layout-extensions.md`](tab-layout-extensions.md). The detach/dock gestures are enabled by that same `reorderable` flag; turning a strip `reorderable` enables reorder, tear-off, and re-dock together.

The only new exported surface is the cross-plan contract type:

```typescript
/** Drag-data payload for a tab header drag. The cross-plan contract. */
export interface TabDragData {
    tabDrag:     true;
    sourceTabId: string;
    componentId: string;
    label:       string;
}
```

`TabDragData` is exported from `Tab.ts` and re-exported from the layout barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)) for downstream plans.

The one conditional manager touch is the optional source-side hook on the existing `DragSourceOptions`:

```typescript
interface DragSourceOptions {
    // ...existing fields unchanged...
    /** Fired once the gesture ends, after any onDrop. `dropped` is true iff an accepting target consumed it. */
    onDragEnd?: (detail: DragEventDetail, dropped: boolean) => void;
}
```

---

## Theme Tokens

No new tokens. Tear-off and re-dock add no visual chrome of their own — the `TabReorderBar`, ghost, and feedback are owned/installed by the extensions plan and reuse the existing `--ts-ui-drag-*` family. The floating window uses the existing `Window` theming. Confirm with `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — expect no additions.

---

## Internal Structure

This plan adds **two private methods** plus the module-level registry and type; it does **not** add `_reorderable`, `_reorderBar`, `_dndTeardowns`, `_dragMouseTarget`, `_dragInsertIndex`, or `installTabDnD`/`teardownTabDnD` — those are the extensions plan's members. This plan **reads** `_dragInsertIndex` (the slot the extensions plan computes in `onDragOver`) inside the dock branch of `onDrop`.

```typescript
// module scope (this plan owns these):
export interface TabDragData { /* see Public API */ }
const tabDragRegistry = new Map<string, Component>();   // componentId -> live content Component
```

**Where this plan extends the extensions plan's wiring:**

- **Source `onDragEnd`** (added to the extensions plan's `makeDragSource(entry.wrapper, …)` call): `(detail, dropped) => { if (!dropped && entry.state === "ready" && entry.component) this.detachTabToWindow(entry, detail.clientX, detail.clientY); }`. The registry entry for `entry.component` is cleaned up here regardless of outcome.
- **Toolbar `onDrop` dock branch** (added to the extensions plan's `makeDropTarget(this._toolbar, …)` `onDrop`): when `detail.dragData.sourceTabId !== this._toolbar.getId()`, resolve the live content via `tabDragRegistry.get(detail.dragData.componentId)` and call `this.dockComponentFromWindow(content, this._dragInsertIndex)` instead of `reorderTab`. The `reorderTab` (same-id) branch is unchanged extensions-plan code.

**New methods:**

`detachTabToWindow(entry: TabEntry, clientX: number, clientY: number)`:
```text
guard entry.state === "ready" && entry.component;
const label = <entry's tab label>;
const win = new Window(label);
win.setX(clientX); win.setY(clientY); win.setSize(...);   // near release point
win.moveComponent(entry.component);                       // re-parent live content into window body (Border CENTER)
win.show();
// strip-entry removal — closeTab bookkeeping minus content removeComponent + minus tabclose:
this._buttonGroup.removeButton(entry.button);
this._rovingTabIndex.remove(entry.button);
const idx = this._tabs.indexOf(entry); this._tabs.splice(idx, 1);
this._toolbar.removeComponent(entry.wrapper);
this.selectNextTab(idx);
this.getContainer()?.scheduleLayout();
```

`dockComponentFromWindow(content: Component, slot: number)` / cross-strip dock:
```text
const sourceWindow = <Window currently hosting content, if any>;
this.getContainer().moveComponent(content, slot);         // atomic cross-container move (plan #1)
const entry = this.buildTabEntry(<label>, <constraints>); // builds wrapper/button, pushes to _tabs, adds to toolbar
this.wireComponentAria(entry, content);
entry.component = content; entry.state = "ready";
// select the new tab, then:
if (sourceWindow && sourceWindow.getComponents().length === 0) sourceWindow.close();
this.getContainer()?.scheduleLayout();
```

The `tabDragRegistry` write happens at drag start — kept next to the `dragData` builder the extensions plan owns (`tabDragRegistry.set(componentId, entry.component)`), so there is a single write site. This plan owns the cleanup, in `onDragEnd`.

---

## Ordered Implementation Steps

> Prerequisite: [`tab-layout-extensions.md`](tab-layout-extensions.md) must be implemented first — its `installTabDnD`/`teardownTabDnD`, drag sources, toolbar drop target, `reorderTab`, `TabReorderBar`, and `_dragInsertIndex` are the substrate this plan extends.

1. **Add the source-side drag-end hook.** Add optional `onDragEnd?(detail: DragEventDetail, dropped: boolean)` to [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40). In [`endSession`](../src/typescript/lib/core/DragManager.ts#L532) rename the unused `_dropped` param to `dropped` and, inside the existing `if (session.committed)` branch ([DragManager.ts:564-568](../src/typescript/lib/core/DragManager.ts#L564)) that already builds `detail`, call `session.sourceOptions.onDragEnd?.(detail, dropped)`. Typecheck.
2. **Add `TabDragData` + `tabDragRegistry`** in `Tab.ts`; export `TabDragData` from the file and re-export from [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts). Verify the extensions plan's `dragData` builder is annotated to return this type (reconcile to one definition site).
3. **Implement `detachTabToWindow(entry, clientX, clientY)`** using `new Window(label)` + `win.moveComponent(entry.component)` (plan #1) + the strip-entry removal (no `tabclose`, no `container.removeComponent`).
4. **Implement `dockComponentFromWindow(content, slot)` / cross-strip dock** using `container.moveComponent(content, slot)` + `buildTabEntry` + `wireComponentAria`; close the emptied source window.
5. **Extend the extensions plan's drag source** `makeDragSource(entry.wrapper, …)` with the `onDragEnd` callback that calls `detachTabToWindow` when `!dropped` and the entry is ready; clean up the registry entry there.
6. **Extend the extensions plan's toolbar `onDrop`** with the dock branch: when `dragData.sourceTabId !== this._toolbar.getId()`, resolve `tabDragRegistry.get(componentId)` and call `dockComponentFromWindow(content, this._dragInsertIndex)`.
7. **Typecheck** (`npm run build`/tsc) — zero errors. **Token checkpoint:** `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — expect no additions. **No-manual-reparent checkpoint:** `grep -n "removeComponent\|addComponent\|insertComponent" src/typescript/lib/layout/Tab.ts` — confirm the *content* move in `detachTabToWindow`/`dockComponentFromWindow` uses `moveComponent`, not a manual remove+add pair (the wrapper removal in `detachTabToWindow` legitimately uses `removeComponent`, matching `closeTab`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` — `TabDragData` type + `tabDragRegistry`, `detachTabToWindow`, `dockComponentFromWindow`, the `onDragEnd` source callback + the dock branch of the existing toolbar `onDrop` |
| Modify | `src/typescript/lib/layout/index.ts` — export `TabDragData` |
| Modify | `src/typescript/lib/core/DragManager.ts` — add optional `onDragEnd?` to `DragSourceOptions`; surface the `dropped` flag to it from `endSession` |

---

## Verification

- **Typecheck:** project `tsc`/build passes with zero errors.
- **Demo screen:** the extensions plan's `reorderable: true` Tab in `TabDemoPanel.ts` (or `MiscPanel.ts`) already exercises the gesture; tear-off/re-dock are exercised through the same strip.
- **Tear-off:** drag a tab header off the strip and release over empty space; a `Window` opens at the cursor hosting the tab's live content; the source strip drops that tab and selects a neighbour; **no `tabclose` fires** and the content is not destroyed.
- **Re-dock / cross-strip dock:** drop a tab (or the torn-off window's content) onto another Tab strip; a new tab appears at the insertion slot the extensions plan computed and is selected; the emptied source window closes; the content is the same live instance (state preserved).
- **Reorder still works:** dragging within the same strip still reorders (extensions-plan behaviour, unbroken by the `onDrop` dock branch — same `sourceTabId` takes the `reorderTab` path).
- **Drop-on-target vs drop-on-nothing:** a successful re-dock does **not** also tear off a second copy (the `onDragEnd` `dropped` flag gates tear-off correctly).
- **Lazy tab:** a not-yet-built tab released over empty space is a no-op (guarded on `state === "ready"`), not a tear-off of a null component.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- `TabDragData` is new public surface on the layout barrel; TypeDoc picks up its JSDoc. Add it to [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts).
- The tear-off / re-dock gestures attach to the same `reorderable` option the extensions plan documents. Update the curated Tab page under `docs/layouts/` (find via `grep -rln "\bTab\b" docs/layouts/`): add a **tear-off & re-dock** section that cross-references the reorder section the extensions plan adds, and document the `TabDragData` contract for downstream consumers. Do not duplicate the reorder gesture docs.
- JSDoc cross-bucket links: reference `DragManager`, `Window`, and `Component.moveComponent` with markdown links (`[`X`](/api/…)`), not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- No renames or removals of public symbols.

---

## Potential Challenges

- **`endSession` discards `dropped`** — the `"dragend"` DOM event alone cannot distinguish re-dock from tear-off. Mitigation: step 1 surfaces the existing `dropped` value through the new `onDragEnd` hook (the value already flows into `endSession` from `onMouseUp`; it is merely dropped on the floor today).
- **Tear-off fires only on committed sessions** — `endSession`'s `dragend`/`onDragEnd` runs only inside `if (session.committed)` ([DragManager.ts:564](../src/typescript/lib/core/DragManager.ts#L564)). A sub-threshold gesture never commits, so it never tears off — correct, but confirm the close-button veto (extensions plan) still prevents a ✕ press from committing.
- **Re-dock content lives in a `Window`, not a Tab strip** — `dockComponentFromWindow` resolves the live content via `componentId` through `tabDragRegistry` and must close the now-empty window. Mitigation: the registry is populated at drag start by the source (extensions plan); this plan reads it and cleans it up in `onDragEnd`. Resolve the host window from the content's current parent at dock time.
- **`_dragInsertIndex` ownership** — the dock branch reads a field the extensions plan writes in `onDragOver`. Mitigation: both branches run inside the same `makeDropTarget` the extensions plan owns; this plan only adds the else-branch of an already-present `sourceTabId` test. If the extensions plan renames the field, this plan tracks it.
- **`selectNextTab` index drift on detach** — splicing `_tabs` shifts indices. Mitigation: `detachTabToWindow` calls `selectNextTab(idx)` with the spliced-out index, identical to `closeTab`'s contract ([Tab.ts:1289](../src/typescript/lib/layout/Tab.ts#L1289)).
- **Element detach resets CSS transitions** — `moveComponent` re-parents the live DOM node, cancelling in-flight descendant transitions (documented plan #1 behaviour). Acceptable: a torn-off panel should not animate mid-flight.
- **Window placement** — `win.show()` ([Window.ts:374](../src/typescript/lib/core/Window.ts#L374)) appends to the document and lays out; set X/Y/size before `show()` so it opens at the release point rather than the default position.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `Tab` (220), `TabEntry` (119), `buildTabEntry` (727), `wireComponentAria` (865), `closeTab` (1263, the teardown bookkeeping `detachTabToWindow` mirrors minus content-remove + tabclose), `selectNextTab` (1298), `_buttonGroup` (224), `_rovingTabIndex` (225), `_toolbar` (222), `_tabs` (223), `_selectedTabIndex` (226).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `DragSourceOptions` (40), `DragEventDetail` (24), `endSession` (532, the `_dropped` param to surface), `onMouseUp` (502, where `dropped` is decided), the committed `dragend` branch (564-568).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `Window` (135), `Border` layout (197, added child fills body/CENTER), `show` (374), constructor (194).
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — the `Tab` `export type {...}` line that gains `TabDragData`.
- [`plans/tab-layout-extensions.md`](tab-layout-extensions.md) — owner of the reorder wiring (`installTabDnD`/`teardownTabDnD`, drag sources, toolbar drop target, `TabReorderBar`, `reorderTab`, `_dragInsertIndex`, the `dragData` builder) this plan extends. Hard `depends-on`.
- [`plans/component-move-helper.md`](component-move-helper.md) — the `moveComponent(child, index?, constraints?)` primitive the detach/dock content moves depend on. Hard `depends-on`.
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts#L600) — `installRowDnD` (600): the canonical `makeDragSource`+`makeDropTarget` consumer idiom (for reference; the extensions plan owns the install here).

---

## Non-Goals

- **Within-strip drag-reorder** (and its `reorderable` option, `installTabDnD`/`teardownTabDnD`, drag sources, toolbar drop target, `TabReorderBar`, `reorderTab`, slot math, close-button veto) — owned by [`tab-layout-extensions.md`](tab-layout-extensions.md); referenced as a dependency, not re-specified here.
- **Edge-drop-to-split** (drop a tab on a panel edge to create a split) — that is plan #3 ([`edge-drop-to-split.md`](edge-drop-to-split.md)); this plan tears off / re-docks whole tabs only.
- **A general dock/tab manager** (persisting layouts, multi-region docking) — plan #5 ([`dock-tab-manager.md`](dock-tab-manager.md)).
- **Animated cross-container tab moves** — `moveComponent` resets transitions by design (plan #1 Non-Goal); not re-litigated here.
- **Multi-tab / multi-select drag** — one tab per gesture.
- **New theme tokens** — reuses the existing `--ts-ui-drag-*` family and `Window` theming.

---

## Blocking Prerequisite

[`plans/size-constraint-invariant.md`](size-constraint-invariant.md) should land first — detach and dock each re-run layout on the source and destination containers (and on a freshly-shown `Window`), and doing so while the `min ≤ preferred ≤ max` invariant is still violated can surface inconsistent strip/content/window sizing. Referenced as an ordering dependency only; its contents are not re-planned here. Plan #1 [`component-move-helper.md`](component-move-helper.md) (the `moveComponent` API) and [`tab-layout-extensions.md`](tab-layout-extensions.md) (the reorder DnD substrate) are hard code dependencies.
