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

Layer **tear-off detach** and **re-dock** onto the within-strip drag-reorder wiring that the `tab-layout-extensions` work already shipped directly inside [`Tab.ts`](../src/typescript/lib/layout/Tab.ts). A tab header can be (1) **torn off** the strip into a floating [`Window`](../src/typescript/lib/core/Window.ts#L135) when its drag is released over empty space (drop-on-nothing), and (2) **re-docked** — dropped onto another (or the same) [`Tab`](../src/typescript/lib/layout/Tab.ts#L467) strip — moving the **live** content component into that strip as a new tab. This is plan **#2 of 5** toward a dock/tab manager; it delivers the cross-container half of the gesture set (within-strip reorder already shipped).

The reorder substrate this plan builds on is concrete and already in the tree: [`installTabDnD`](../src/typescript/lib/layout/Tab.ts#L2741) / [`teardownTabDnD`](../src/typescript/lib/layout/Tab.ts#L2960), the per-wrapper [`makeTabDragSource(entry)`](../src/typescript/lib/layout/Tab.ts#L2769), the single [`makeTabDropTarget()`](../src/typescript/lib/layout/Tab.ts#L2793) hosted on `_clipFrame` (with `feedbackHost: _toolbar`), [`isTabReorderDrag`](../src/typescript/lib/layout/Tab.ts#L2822), [`updateReorderSlot`](../src/typescript/lib/layout/Tab.ts#L2833) (which caches the slot in `_dragInsertIndex`, [Tab.ts:2864](../src/typescript/lib/layout/Tab.ts#L2864)), [`dropReorder`](../src/typescript/lib/layout/Tab.ts#L2904), [`reorderTab`](../src/typescript/lib/layout/Tab.ts#L2925), and the `TabReorderBar` overlay. **This plan modifies that shipped code in place** — it enriches the drag source's `dragData`, relaxes the drop target's `accepts`, and adds a dock branch to the drop target's `onDrop`. It also adds two new private methods (`detachTabToWindow`, `dockComponent`), a module-level `tabDragRegistry`, and one minimal optional touch to [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts).

This plan is the **single definition site** for the cross-plan [`TabDragData`](#public-api-typescript-signatures) contract and the module-level `tabDragRegistry` (`componentId → live Component`). Plans #3 ([`edge-drop-to-split.md`](edge-drop-to-split.md)) and #5 ([`dock-tab-manager.md`](dock-tab-manager.md)) test `detail.dragData.tabDrag === true` in their `accepts` and resolve the live panel through `tabDragRegistry`; both name this plan as the contract owner. All content re-parenting goes through [`Component.moveComponent(child, index?, constraints?)`](../src/typescript/lib/core/Component.ts#L3822) from plan #1 ([`component-move-helper.md`](component-move-helper.md)), never a manual remove+add.

---

## Architecture Decisions

### We extend **and modify** the shipped reorder drag source + drop target

The old version of this plan assumed a clean "extensions plan" substrate it could layer on without touching: a `_toolbar` drop target that already branched on `sourceTabId`, a `dragData` builder already carrying component identity, and an `accepts` that already admitted foreign drags. **None of that exists.** The shipped reorder code is reorder-only, identity-less, and same-strip-only:

- The drop target is on `_clipFrame`, not `_toolbar` ([`makeTabDropTarget`](../src/typescript/lib/layout/Tab.ts#L2793)); its `feedbackHost` is `_toolbar`. Wrapper removal uses `this._clipFrame.removeComponent(entry.wrapper)` (see [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3037), [`reorderTab`](../src/typescript/lib/layout/Tab.ts#L2945)).
- The drag data is the **static literal** `{ tabReorder: true }` ([`makeTabDragSource`](../src/typescript/lib/layout/Tab.ts#L2771)) — no `sourceTabId`, no `componentId`, no `label`, no `TabDragData` type anywhere.
- [`isTabReorderDrag`](../src/typescript/lib/layout/Tab.ts#L2822) returns `detail.dragData["tabReorder"] === true && this._tabs.some(entry => entry.wrapper.getId() === detail.sourceId)` — it **rejects** any drag whose source wrapper is not one of this strip's tabs. There is no foreign-source branch to extend.
- [`onDrop`](../src/typescript/lib/layout/Tab.ts#L2808) unconditionally calls `dropReorder(detail)`, which finds the source via `detail.sourceId` among `_tabs` and reorders.

So this plan **deliberately edits the shipped reorder code**: it enriches `makeTabDragSource`'s `dragData`, relaxes the drop target's `accepts`, and adds the dock-vs-reorder branch in `onDrop` itself. This is the necessary scope — flagged here explicitly so the implementer does not treat the reorder methods as off-limits. The discriminator is **kept as a single field on the same dragData object** the reorder path already keys off (see next decision), so reorder, detach, and dock all share one payload and one drop target.

### One enriched `dragData` object, one discriminator, shared by reorder/detach/dock

Rather than introduce a competing `tabDrag` marker alongside the existing `tabReorder` one, this plan **replaces the static literal with a per-entry `TabDragData` object** that carries the discriminator `tabDrag: true` plus identity. The reorder path (`isTabReorderDrag`, `dropReorder`) is updated to read `tabDrag` instead of `tabReorder` — a one-marker rename, not a second marker. Downstream plans #3/#5 already expect `tabDrag` (see [`edge-drop-to-split.md:61`](edge-drop-to-split.md), [`dock-tab-manager.md`](dock-tab-manager.md)), so `tabDrag` is the canonical discriminator and `tabReorder` is retired. Carrying everything on one object means a single drop target handles reorder (same strip), dock (foreign strip), and — via #3 — edge-split, all keyed off `tabDrag === true`.

`DragManager`'s `DragData` is `Record<string, unknown>` ([DragManager.ts:15](../src/typescript/lib/core/DragManager.ts#L15)), so the object can carry only serialisable-ish primitives — ids and a label, not a live `Component`. The drag source therefore emits `{ tabDrag: true, sourceTabId, componentId, label }`; the live content is resolved out-of-band through the registry (next decision).

### A module-level `tabDragRegistry` carries the live content `Component`

A plain `componentId` cannot reach the live content component through the `DragData` record. So this plan adds a module-level `tabDragRegistry = new Map<string, Component>()` (`componentId → live content Component`), written **at drag start** next to the `dragData` builder in `makeTabDragSource` (the single write site) and cleaned up **at drag end** in the new `onDragEnd` source hook. The drop target resolves the live content via `tabDragRegistry.get(detail.dragData["componentId"])`. Downstream plans #3/#5 read this same registry — it is exported (or read via the barrel) as the canonical resolution channel; they never build a second one.

The registry write must be gated: a tab in `"lazy"`/`"building"` state has `entry.component === null` ([`TabEntry.component`](../src/typescript/lib/layout/Tab.ts#L257), [`materializeAsync`](../src/typescript/lib/layout/Tab.ts#L1922)), so the source only registers (and the gesture only detaches/docks) when `entry.state === "ready" && entry.component !== null`.

### Tear-off needs a source-side "dropped on nothing" signal — add a minimal `onDragEnd`

[`endSession`](../src/typescript/lib/core/DragManager.ts#L539) fires a `"dragend"` DOM event when the session committed ([DragManager.ts:571-575](../src/typescript/lib/core/DragManager.ts#L571)) but **discards** the `dropped` flag — the parameter is named `_dropped` and never read, while [`onMouseUp`](../src/typescript/lib/core/DragManager.ts#L509) is the only place that knows whether an accepting target consumed the drop ([DragManager.ts:518-532](../src/typescript/lib/core/DragManager.ts#L518)). The `"dragend"` DOM event therefore fires for **both** a successful re-dock and a drop-on-nothing, with no way to tell them apart — a `dragend` listener alone would tear off a tab that was actually re-docked.

**Decision:** add one optional source-side hook to [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40):

```typescript
/** Fired once the gesture ends, after any onDrop. `dropped` is true iff an accepting target consumed it. */
onDragEnd?: (detail: DragEventDetail, dropped: boolean) => void;
```

`endSession` already receives the flag (rename its unused `_dropped` param to `dropped`) and already builds `detail` in the committed branch — invoke `session.sourceOptions.onDragEnd?.(detail, dropped)` there. This is the **smallest possible** manager change: one field, one call inside the existing committed branch, no new session state, no new overlay. `makeTabDragSource` gains this one callback; its body tears off only when `!dropped` (and the entry is ready), and cleans up the registry entry regardless of outcome.

### Tear-off destination is a plain `Window` hosting the content directly

A [`Window`](../src/typescript/lib/core/Window.ts#L135) uses a [`Border`](../src/typescript/lib/layout/Border.ts) layout ([Window.ts:197](../src/typescript/lib/core/Window.ts#L197)); a child added with no placement fills CENTER (the body), beside the header (NORTH) and the eight resize-border overlays. So `detachTabToWindow(entry, clientX, clientY)` constructs `new Window(label)`, sets X/Y/size **before** `show()` so it opens at the release point ([`setX`](../src/typescript/lib/core/Component.ts#L2616)/[`setY`](../src/typescript/lib/core/Component.ts#L2649)/[`setSize`](../src/typescript/lib/core/Component.ts#L2428)), re-parents the live content into the window body via `win.moveComponent(entry.component)`, and `win.show()`s it. It then removes the now-empty `TabEntry` from the source strip via the [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3017) teardown bookkeeping **minus** the content removal and **minus** the `tabclose` emit (see next decision). The registry's `componentId → window` association (or resolving the window from the content's parent at dock time) lets a later re-dock close the emptied window. `moveComponent` (not remove+add) gives the atomic detach/attach with both ends re-laying out, per plan #1.

### Detach bookkeeping mirrors `closeTab` minus content-remove and minus `tabclose`

[`closeTab`](../src/typescript/lib/layout/Tab.ts#L3017) is the canonical teardown. `detachTabToWindow` replays it **except** it does **not** call `container.removeComponent(contentComponent)` (the content is relocated by `moveComponent`, not destroyed) and does **not** `this.emit("tabclose", contentComponent)` (the tab is relocated, not closed). It still: captures `wasSelected = this._selectedTabIndex === idx`, then `this._buttonGroup.removeButton(entry.button)`, `this._rovingTabIndex.remove(entry.button)`, splices `_tabs`, `this._clipFrame.removeComponent(entry.wrapper)`, tears down the wrapper's contextmenu listener via `Event.removeSubtreeListener(entry.wrapper, "contextmenu", entry.contextMenuListener)` ([the exact field is `TabEntry.contextMenuListener`](../src/typescript/lib/layout/Tab.ts#L277); closeTab does this at [Tab.ts:3042](../src/typescript/lib/layout/Tab.ts#L3042)), then `this.selectNextTab(idx, wasSelected)` ([note the **two**-arg signature](../src/typescript/lib/layout/Tab.ts#L3065)) and `this.getContainer()?.scheduleLayout()`.

### Re-dock / cross-strip dock moves content into this strip's container as a new tab

`dockComponent(content, slot, sourceWindow?)` re-homes the live `content` into **this** strip's container at the slot the drop target already computed in `_dragInsertIndex`: `this.getContainer().moveComponent(content, slot)`. It then builds a tab entry for it by reusing the shipped [`buildTabEntry(name, constraints?)`](../src/typescript/lib/layout/Tab.ts#L1656) (which mints the wrapper + button, pushes to `_tabs`, adds the wrapper to `_clipFrame`, and — when `_reorderable` and attached — registers a fresh drag source, [Tab.ts:1798](../src/typescript/lib/layout/Tab.ts#L1798)) followed by [`wireComponentAria(entry, content)`](../src/typescript/lib/layout/Tab.ts#L1812), then sets `entry.component = content` and `entry.state = "ready"` (matching what [`createTab`](../src/typescript/lib/layout/Tab.ts#L1829) does after `buildTabEntry`). It selects the new tab via [`setActiveTabIndex`](../src/typescript/lib/layout/Tab.ts#L1433) (the canonical programmatic-select that syncs the button group, roving index, and layout) and, if the content came from a torn-off `Window`, closes that window via [`requestClose()`](../src/typescript/lib/core/Window.ts#L534) once it is empty. The source window is resolved from `content.getParentComponent()`'s owning window at dock time (and/or held alongside the registry entry).

### No tear-off / re-dock when content is still lazy

A tab in `"lazy"`/`"building"` state has `entry.component === null`. The source registry write, the detach (`onDragEnd` body), and the dock are all gated on `entry.state === "ready" && entry.component !== null`. A still-building tab released over empty space is a **no-op**, not a tear-off of `null`. Forcing materialization on drag *start* is out of scope — this plan only guards the move.

---

## Public API (TypeScript Signatures)

This plan adds **no new public setters or `TabOptions` fields** — detach/dock ride the existing [`setReorderable`](../src/typescript/lib/layout/Tab.ts#L1307)/[`isReorderable`](../src/typescript/lib/layout/Tab.ts#L1332)/`TabOptions.reorderable` flag; turning a strip reorderable enables reorder, tear-off, and re-dock together.

The new exported surface is the cross-plan contract type, defined and exported **once** from `Tab.ts` and re-exported from the layout barrel:

```typescript
/** Drag-data payload for a tab header drag. The cross-plan contract (plans #3 and #5 read it). */
export interface TabDragData {
    /** Discriminator other drop targets test in `accepts`. Replaces the old `tabReorder` marker. */
    tabDrag:     true;
    /** The source Tab strip's identity — reorder-vs-dock detection. */
    sourceTabId: string;
    /** The live content Component's id — the key into `tabDragRegistry`, the thing that gets moved. */
    componentId: string;
    /** Tab label, for the drag ghost and the tear-off window title. */
    label:       string;
}
```

`sourceTabId` is the value the drop target's `accepts`/`onDrop` compares against the strip to distinguish "reorder within me" from "dock from elsewhere". Because the existing reorder path resolves its source by matching `detail.sourceId` (the **wrapper** id) against `this._tabs`, the same-strip test can equivalently be "is `detail.sourceId` one of my tab wrappers" — `sourceTabId` is the explicit, strip-level twin of that test and the one #3/#5 rely on. Choose one strip-identity value and use it consistently: this plan stamps `sourceTabId` with a stable per-strip id (e.g. the `_clipFrame` or `_toolbar` `getId()`), and `accepts`/`onDrop` compare it to that same id.

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

**None.** Tear-off and re-dock add no visual chrome of their own — the `TabReorderBar`, ghost, and validity feedback are the shipped reorder wiring's and reuse the existing `--ts-ui-drag-*` family ([Theme.ts:872-880](../src/typescript/lib/core/Theme.ts#L872)). The floating window uses existing `Window` theming. Checkpoint: `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — expect **no additions**.

---

## Internal Structure

Module scope (this plan owns these — single definition site):

```typescript
export interface TabDragData { /* see Public API */ }

/** componentId -> live content Component. The DragData record can't carry a live reference. */
const tabDragRegistry = new Map<string, Component>();
```

**Edits to the shipped reorder wiring:**

`makeTabDragSource(entry)` ([Tab.ts:2769](../src/typescript/lib/layout/Tab.ts#L2769)) — replace the static `dragData: { tabReorder: true }` with a per-entry object, register the live content, and add the `onDragEnd` detach hook:

```text
dragData: () => {
    // entry.state may have changed since wiring; resolve at gesture start.
    const content = entry.component;                       // null when lazy/building
    if (content) {
        tabDragRegistry.set(content.getId(), content);     // single write site
    }
    return {
        tabDrag:     true,
        sourceTabId: this.stripId(),                       // stable per-strip id (e.g. _clipFrame.getId())
        componentId: content ? content.getId() : "",
        label:       entry.name,
    };
},
onDragStart: (...) => { /* unchanged close-button veto */ },
onDragEnd: (detail, dropped) => {
    const content = entry.component;
    if (!dropped && entry.state === "ready" && content) {
        this.detachTabToWindow(entry, detail.clientX, detail.clientY);
    }
    if (content) {
        tabDragRegistry.delete(content.getId());           // cleanup regardless of outcome
    }
},
```

`isTabReorderDrag(detail)` ([Tab.ts:2822](../src/typescript/lib/layout/Tab.ts#L2822)) — read the new marker and **accept foreign-source drags too** so the dock path can fire:

```text
return detail.dragData["tabDrag"] === true;   // accept any tab-header drag (reorder OR dock)
```

(The same-strip-only restriction moves into `onDrop`, which now branches; `accepts` only needs the discriminator. Optionally also require a non-empty `componentId` to reject a lazy-tab drag.)

`makeTabDropTarget`'s `onDrop` ([Tab.ts:2808](../src/typescript/lib/layout/Tab.ts#L2808)) — branch reorder vs. dock:

```text
onDrop: (detail) => {
    const sameStrip = this._tabs.some(e => e.wrapper.getId() === detail.sourceId);
    if (sameStrip) {
        this.dropReorder(detail);                          // unchanged shipped path
        return;
    }
    const content = tabDragRegistry.get(detail.dragData["componentId"] as string);
    if (content) {
        const sourceWindow = this.resolveOwningWindow(content);
        this.dockComponent(content, this._dragInsertIndex, sourceWindow);
    }
    this._reorderBar.hide();
    this._dragInsertIndex = -1;
},
```

**New methods:**

`detachTabToWindow(entry: TabEntry, clientX: number, clientY: number): void`:
```text
if (entry.state !== "ready" || !entry.component) return;        // lazy guard
const content = entry.component;
const win = new Window(entry.name);
win.setX(clientX); win.setY(clientY);
win.setSize({ width: DETACH_WINDOW_W, height: DETACH_WINDOW_H }); // documented constants
win.moveComponent(content);                                      // live content into Border CENTER
win.show();
// closeTab bookkeeping MINUS container.removeComponent MINUS tabclose:
const idx = this._tabs.indexOf(entry);
if (idx < 0) return;
const wasSelected = this._selectedTabIndex === idx;
this._buttonGroup.removeButton(entry.button);
this._rovingTabIndex.remove(entry.button);
this._tabs.splice(idx, 1);
this._clipFrame.removeComponent(entry.wrapper);
Event.removeSubtreeListener(entry.wrapper, "contextmenu", entry.contextMenuListener);
this.selectNextTab(idx, wasSelected);                            // TWO args
this.getContainer()?.scheduleLayout();
```

`dockComponent(content: Component, slot: number, sourceWindow?: Window): void`:
```text
const container = this.getContainer();
if (!container) return;
container.moveComponent(content, slot);                          // atomic cross-container move
const name = <constraints.name ?? content.getId()>;             // mirror createTab's label resolution
const entry = this.buildTabEntry(name, this.getLayoutConstraints(content) ?? undefined);
entry.component = content;
entry.state     = "ready";
this.wireComponentAria(entry, content);
this.setActiveTabIndex(this._tabs.indexOf(entry));              // select the new tab
if (sourceWindow && this.windowIsEmpty(sourceWindow)) {
    sourceWindow.requestClose();
}
this.getContainer()?.scheduleLayout();
```

`detachTabToWindow` exceeds ~30 lines once fully fleshed; split the closeTab-mirror bookkeeping into a private `removeEntryKeepingContent(entry)` (the splice/button-group/roving/wrapper/contextmenu/selectNextTab block) so both the orchestration and the teardown read as named steps, per CODE_CONVENTIONS decomposition rule. `stripId()`, `resolveOwningWindow(content)`, and `windowIsEmpty(win)` are tiny private helpers (the last enumerates the window's non-header children — note `Window.findBodyHost` is private, so resolve emptiness from the public `getComponents()` minus the header, or by tracking the window alongside the registry entry).

---

## Ordered Implementation Steps

> Prerequisite: the within-strip reorder wiring is already in `Tab.ts` (`installTabDnD`, `makeTabDragSource`, `makeTabDropTarget`, `isTabReorderDrag`, `updateReorderSlot`/`_dragInsertIndex`, `dropReorder`, `reorderTab`, `TabReorderBar`). This plan edits it.

1. **Add the source-side drag-end hook** to [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40) — `onDragEnd?: (detail: DragEventDetail, dropped: boolean) => void;`. In [`endSession`](../src/typescript/lib/core/DragManager.ts#L539) rename the unused `_dropped` param to `dropped` and, inside the existing `if (session.committed)` branch ([DragManager.ts:571-575](../src/typescript/lib/core/DragManager.ts#L571)) that already builds `detail`, call `session.sourceOptions.onDragEnd?.(detail, dropped)`. Typecheck. **File:** `src/typescript/lib/core/DragManager.ts`.
2. **Add `TabDragData` + `tabDragRegistry`** to `Tab.ts`; export `TabDragData` from the file and extend the layout barrel's Tab `export type { ... }` line ([`src/typescript/lib/layout/index.ts:16`](../src/typescript/lib/layout/index.ts#L16)) with `TabDragData`. **File:** `src/typescript/lib/layout/Tab.ts`, `src/typescript/lib/layout/index.ts`.
3. **Enrich `makeTabDragSource`'s `dragData`** ([Tab.ts:2771](../src/typescript/lib/layout/Tab.ts#L2771)) from the static literal to the per-entry `TabDragData` factory, write the registry at start, and add the `onDragEnd` detach hook (gated on `!dropped && entry.state === "ready" && entry.component`). Add the `stripId()` helper. **File:** `src/typescript/lib/layout/Tab.ts`.
4. **Relax `isTabReorderDrag`** ([Tab.ts:2822](../src/typescript/lib/layout/Tab.ts#L2822)) to `detail.dragData["tabDrag"] === true` (accept foreign sources). Update [`dropReorder`](../src/typescript/lib/layout/Tab.ts#L2904) only if it reads the old marker (it reads `detail.sourceId`, so likely unchanged). **File:** `src/typescript/lib/layout/Tab.ts`.
5. **Implement `detachTabToWindow`** (+ the `removeEntryKeepingContent` helper) using `new Window(label)` + X/Y/size before `show()` + `win.moveComponent(content)` + the closeTab-mirror teardown (no `tabclose`, no `container.removeComponent`). Document the `DETACH_WINDOW_W/H` constants (why those pixel defaults). **File:** `src/typescript/lib/layout/Tab.ts`.
6. **Implement `dockComponent`** (+ `resolveOwningWindow`, `windowIsEmpty` helpers) using `container.moveComponent(content, slot)` + `buildTabEntry` + `wireComponentAria` + `setActiveTabIndex`, closing the emptied source window via `requestClose()`. **File:** `src/typescript/lib/layout/Tab.ts`.
7. **Add the dock branch to `makeTabDropTarget`'s `onDrop`** ([Tab.ts:2808](../src/typescript/lib/layout/Tab.ts#L2808)): same-strip → `dropReorder` (unchanged), foreign → resolve `tabDragRegistry.get(componentId)` and `dockComponent(content, this._dragInsertIndex, sourceWindow)`. **File:** `src/typescript/lib/layout/Tab.ts`.
8. **Typecheck** (`npx tsc --noEmit` / `npm run build`) — zero errors. **Token checkpoint:** `grep -n "ts-ui-drag-" src/typescript/lib/core/Theme.ts` — no additions. **No-manual-content-reparent checkpoint:** `grep -n "removeComponent\|addComponent\|insertComponent" src/typescript/lib/layout/Tab.ts` — confirm the **content** move in `detachTabToWindow`/`dockComponent` uses `moveComponent`, never a manual remove+add; the **wrapper** removal in `detachTabToWindow` legitimately uses `_clipFrame.removeComponent`, mirroring `closeTab`, and `buildTabEntry`'s `addComponent(wrapper)` is the shipped wrapper-add path. **Marker checkpoint:** `grep -n "tabReorder" src/typescript/lib/layout/Tab.ts` — expect zero (renamed to `tabDrag`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` — `TabDragData` type + `tabDragRegistry`; enrich `makeTabDragSource` `dragData` + add `onDragEnd`; relax `isTabReorderDrag`; add the dock branch to `makeTabDropTarget` `onDrop`; new `detachTabToWindow`, `dockComponent` (+ `removeEntryKeepingContent`, `stripId`, `resolveOwningWindow`, `windowIsEmpty` helpers) |
| Modify | `src/typescript/lib/layout/index.ts` — re-export `TabDragData` on the Tab `export type { ... }` line |
| Modify | `src/typescript/lib/core/DragManager.ts` — add optional `onDragEnd?` to `DragSourceOptions`; surface the `dropped` flag from `endSession` |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` / build passes with zero errors.
- **Demo screen:** [`TabDemoPanel.ts:140`](../src/typescript/TabDemoPanel.ts#L140) already builds a `reorderable: true` Tab; tear-off, re-dock, and reorder are all exercised there (`npm run dev`, http://localhost:8015). Scope DevTools queries to `.TabDemoPanel .TabPanel` — many same-type components coexist.
- **Reorder still works:** dragging a header within the same strip still reorders and keeps selection (same-strip branch → `dropReorder` → `reorderTab`, unbroken by the `onDrop` dock branch).
- **Tear-off:** drag a header off the strip and release over empty space; a `Window` opens at the cursor hosting the tab's **live** content; the source strip drops that tab and selects a neighbour; **no `tabclose` fires** and the content is not destroyed.
- **Re-dock:** drag the torn-off window's content (or a tab from another strip) onto a Tab strip; a new tab appears at the computed `_dragInsertIndex` slot and is selected; the emptied source window closes; the content is the same live instance (state preserved).
- **Drop-on-target vs drop-on-nothing:** a successful re-dock does **not** also tear off a second copy (the `onDragEnd` `dropped` flag gates tear-off).
- **Lazy tab no-op:** a not-yet-built tab released over empty space is a no-op (registry never written, gesture gated on `state === "ready" && component`), not a tear-off of `null`.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbol `TabDragData`** is added to the layout barrel ([`src/typescript/lib/layout/index.ts:16`](../src/typescript/lib/layout/index.ts#L16)); TypeDoc picks up its JSDoc. No new curated page needed for the type itself, but document it in the Tab page's new section as the cross-plan drag contract.
- **Curated Tab page** [`docs/layouts/Tab.md`](../docs/layouts/Tab.md): the existing **Reorderable tabs** section ([Tab.md:177](../docs/layouts/Tab.md#L177)) already says "Dragging a tab *out* of its strip (tear-off / re-dock) is a separate capability layered on top of this reorder wiring." Add a **Tear-off & re-dock** section immediately after it that documents the gesture (release over empty space → floating window; drop on another strip → new tab) and the `TabDragData` contract, cross-referencing the reorder section. Add a line to the **See also** list. No catalog/sidebar change (the page already exists in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts)).
- **Cross-bucket JSDoc references** — `TabDragData`'s and the new methods' JSDoc reference [`DragManager`](/api/core/classes/DragManager), [`Window`](/api/core/classes/Window), and [`Component.moveComponent`](/api/core/classes/Component#movecomponent) across buckets, so use **markdown links**, not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- No renames or removals of public symbols (`tabReorder` was an internal drag-data marker, not public API).

---

## Potential Challenges

- **Editing shipped reorder code, not a clean substrate** — the drag source, drop target, and `accepts` are reorder-only and must be modified in place. Mitigation: the marker rename (`tabReorder` → `tabDrag`) is mechanical; `accepts` relaxes to the discriminator only; the same-strip restriction moves to the `onDrop` branch where `dropReorder` already resolves by `sourceId`.
- **`endSession` discards `dropped`** — the `dragend` DOM event can't distinguish re-dock from tear-off. Mitigation: step 1 surfaces the already-computed `dropped` value through the new `onDragEnd` hook.
- **Lazy-tab drag of `null`** — a `"lazy"`/`"building"` tab has `component === null`. Mitigation: the registry write, the detach, and the dock are all gated on `state === "ready" && component !== null`; a lazy drag carries an empty `componentId` and resolves to nothing.
- **Resolving the source window for an emptied float** — `Window.findBodyHost` is private and `getComponents()` includes the header + border overlays. Mitigation: track the window alongside the registry entry at detach, or resolve it from `content.getParentComponent()` and check emptiness via `getComponents()` minus the header; close with the public `requestClose()`.
- **`selectNextTab` two-arg signature** — it now takes `(closedIndex, closedWasSelected)` ([Tab.ts:3065](../src/typescript/lib/layout/Tab.ts#L3065)); `detachTabToWindow` must capture `wasSelected` before the splice and pass both, exactly as `closeTab` does. The old plan's one-arg call would not compile.
- **`buildTabEntry` registers its own drag source** when `_reorderable` and attached ([Tab.ts:1798](../src/typescript/lib/layout/Tab.ts#L1798)) — so a docked tab is immediately reorderable/tear-offable with no extra wiring. Mitigation: rely on this; do not double-register.
- **`moveComponent` resets CSS transitions** on the re-parented subtree (documented plan #1 behaviour). Acceptable: a torn-off / docked panel snaps rather than animating mid-flight.
- **Window placement before `show()`** — [`show()`](../src/typescript/lib/core/Window.ts#L374) appends to the document and lays out; set X/Y/size first or the window opens at its default position.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `Tab` (467); `TabEntry` (253, fields: `wrapper` 254, `button` 255, `closeButton` 256, `component` 257, `state` 269, `name` 267, `contextMenuListener` 277); `TabEntryState` (235); `_toolbar` (472), `_clipFrame` (479), `_tabs` (480), `_buttonGroup` (481), `_rovingTabIndex` (487), `_selectedTabIndex` (488), `_reorderBar` (542), `_dndTeardowns` (543), `_dragInsertIndex` (545); `setReorderable` (1307), `isReorderable` (1332); `buildTabEntry` (1656), `wireComponentAria` (1812), `createTab` (1829), `materializeAsync` (1922), `setActiveTabIndex` (1433); `installTabDnD` (2741), `makeTabDragSource` (2769), `makeTabDropTarget` (2793), `isTabReorderDrag` (2822), `updateReorderSlot` (2833), `dropReorder` (2904), `reorderTab` (2925), `teardownTabDnD` (2960); `closeTab` (3017, the teardown `detachTabToWindow` mirrors minus content-remove + tabclose), `selectNextTab` (3065, two args).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `DragData` (15), `DragEventDetail` (24), `DragSourceOptions` (40, where `onDragEnd?` is added), `onMouseUp` (509, where `dropped` is decided and passed to `endSession` at 532), `endSession` (539, `_dropped` param to rename + the committed `dragend` branch 571-575).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `Window` (135), constructor `new Window(headerText, options?)` (194), `Border` layout set at (197), header added NORTH (227), body content fills CENTER, `setSize({width,height})` via Component (2428), `setX`/`setY`, `show()` (374), `requestClose()` (534) → `onExitAction` (575), `findBodyHost` (1432, **private** — don't call), `getComponents()` (inherited) for emptiness.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `moveComponent(child, index?, constraints?)` (3822), `setSize` (2428), `setX` (2616), `setY` (2649).
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts#L16) — the Tab `export type { ... }` line that gains `TabDragData`.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts#L140) — the `reorderable: true` demo strip.
- [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L177) — the Reorderable-tabs section to extend.
- [`plans/edge-drop-to-split.md`](edge-drop-to-split.md) / [`plans/dock-tab-manager.md`](dock-tab-manager.md) — downstream consumers of `TabDragData` (`tabDrag` discriminator) and `tabDragRegistry`; keep field names consistent — this plan's type is canonical.

---

## Non-Goals

- **Within-strip drag-reorder** (the `reorderable` option, `installTabDnD`/`teardownTabDnD`, drag sources, drop target, `TabReorderBar`, `reorderTab`, slot math, close-button veto) — already shipped in `Tab.ts`; this plan modifies it, it does not re-specify it.
- **Edge-drop-to-split** (drop on a panel edge to create a split) — plan #3 ([`edge-drop-to-split.md`](edge-drop-to-split.md)); this plan tears off / re-docks whole tabs only and only *owns* the `TabDragData`/`tabDragRegistry` contract #3 consumes.
- **A general dock/tab manager** (persisting layouts, multi-region docking, the region-wiring sweep) — plan #5 ([`dock-tab-manager.md`](dock-tab-manager.md)).
- **Animated cross-container tab moves** — `moveComponent` resets transitions by design (plan #1).
- **Multi-tab / multi-select drag** — one tab per gesture.
- **New theme tokens** — reuses the existing `--ts-ui-drag-*` family and `Window` theming.
