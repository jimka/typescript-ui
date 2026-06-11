---
depends-on:
  - tab-detach-redock.md
  - edge-drop-to-split.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/layout/DockRegion.ts
---

# Prune Degenerate Dock Containers — Implementation Plan

## Overview

When a `Tab` stack inside a dock tree loses its **last** tab — torn off to a window, re-docked into another strip, or closed with the close button — the now-empty stack lingers on screen; and when removing that stack leaves a `Split` with a single child, the single-pane `Split` also lingers. This plan prunes both: the empty stack is removed from its parent, and a `Split` left with one child collapses (its lone child hoisted into the grandparent at the `Split`'s slot).

The just-shipped [`plans/implemented/edge-drop-to-split.md`](implemented/edge-drop-to-split.md) made edge/centre drops land in reorderable `Tab` stacks ([`DockRegion.newStack()`](../src/typescript/lib/layout/DockRegion.ts#L187)) so docked panels keep a draggable handle — which made them detachable and exposed that nothing cleans up the emptied stack or the single-pane `Split`.

All three emptying paths already funnel through one of two `Tab` teardown sinks that *both already end with the same two host-window calls*: re-dock and tear-off go through [`removeEntryKeepingContent`](../src/typescript/lib/layout/Tab.ts#L3115) (called from [`onTabDragEnd:2992`](../src/typescript/lib/layout/Tab.ts#L2992) and [`detachTabToWindow:3037`](../src/typescript/lib/layout/Tab.ts#L3037)); the close button goes through [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3380). Both call [`syncHostWindowCloseable()` + `closeHostWindowIfEmpty()`](../src/typescript/lib/layout/Tab.ts#L3166) as their final step. That shared tail is the single insertion point for a new, structure-agnostic **`empty` event** that the dock-tree owner subscribes to.

This plan adds one `Tab` event (`empty`), one prune+collapse routine owned (interim) by `DockRegion`, wiring of that routine onto every stack `DockRegion.newStack()` creates, and a demo in [`TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts). No theme tokens, no new DOM property, no `DragManager` change.

---

## Architecture Decisions

### `DragManager` must not own pruning

[`DragManager`](../src/typescript/lib/core/DragManager.ts#L3) imports only `Component`, `DragFeedback`, `DragGhost`, `Event`, `ReorderIndicator` (verified: lines 3–7) and is shared by `TreeBody` row DnD, `Window` header drag, and `Tab` reorder. It knows nothing of `Split`/`Tab` and must stay that way. Putting dock-tree pruning in it is a layering inversion on three counts: (1) emptiness is not universally "delete me" — a deliberately-placed app strip stays; (2) the single-child-`Split` collapse needs tree knowledge (parent slot, grandparent, sibling) the manager lacks; (3) the close-button path is not a drag at all, so a `DragManager` hook would miss it. Pruning lives above the generic DnD layer.

### `Tab` emits a generic, structure-agnostic `empty` event — it never prunes itself

`Tab` gains one event, `empty`, fired whenever the last tab leaves by **any** path (relocate, tear-off, close). It is a pure announcement: `Tab` does not know what a `Split` or a dock is, and the event itself triggers no removal. The signal **generalizes — does not replace** — `closeHostWindowIfEmpty`: the existing tear-off-window close stays exactly as is (gated on `_closeHostWindowWhenEmpty`), and the new `empty` emit sits beside it in the same shared tail. A `Tab` can therefore both close its host window (if it is a tear-off strip) *and* announce emptiness (always); the two are independent and coexist.

Chosen mechanism: **reuse the existing `Tab` event system**, mirroring `tabclose`. `Tab` already has a `ListenerBag<TabEvent>` ([`_listeners:521`](../src/typescript/lib/layout/Tab.ts#L521)), `on`/`off`/`emit` overloads ([3341/3357/3370](../src/typescript/lib/layout/Tab.ts#L3341)), a `TabEvent` union ([line 44](../src/typescript/lib/layout/Tab.ts#L44)), and a `TabOptions.listeners` bag ([line 195](../src/typescript/lib/layout/Tab.ts#L195)) dispatched from `applyOptions`. Adding `"empty"` to that union and one overload per method reuses all of it — no new field, no callback-option parallel surface, and consumers wire it the same way they wire `tabclose`. A bare callback option was rejected: it would add a second, redundant subscription style for the same machinery.

Why `empty` and not reusing `tabclose`: `tabclose` fires only on the close-button path and carries the *removed content*; it does not fire on relocate/tear-off (those use `removeEntryKeepingContent`, which deliberately omits the `tabclose` emit because the tab is relocated, not closed). `empty` is orthogonal — it fires after the strip count hits zero on *any* path, carries no content, and may fire in the same `closeTab` call right after `tabclose`.

### The dock-tree owner subscribes and prunes — interim home is `DockRegion`, formal home is `Dock`

The prune+collapse routine is owned **for now by `DockRegion`**, wired onto each stack at the moment `DockRegion.newStack()` ([line 187](../src/typescript/lib/layout/DockRegion.ts#L187)) creates it. `DockRegion` is the component that *creates* the reorderable stacks edge/centre drops deposit into, so it is the natural place to attach an `empty` listener to each new stack at birth — it already holds the parent-tree handles (`_region`, `getParentComponent`) the collapse needs.

The architecturally correct long-term owner is plan #5's [`Dock`](dock-tab-manager.md) — its [`wireRegion` sweep](dock-tab-manager.md) is explicitly designed to wire DnD onto *every* region in the tree (including ad-hoc ones), and a tree-wide prune belongs there, not on a per-region coordinator. `DockRegion` is a per-region drop-gesture *coordinator* wired on ONE region; it is not the owner of the whole tree, and a stack created under region A but later moved under region B is still only known to A's coordinator.

**Choice: (a) interim `DockRegion`-hosted pruning now.** Rationale: `Dock` (#5) is not yet implemented and is the capstone of the whole chain; blocking this cleanup on it leaves the just-shipped edge-drop demo visibly broken (empty stacks and single-pane `Split`s litter the screen). Hosting the prune on `DockRegion` unblocks the demo immediately and is a small, self-contained addition to the component that already mints the stacks. **Tradeoff:** this puts tree-mutation logic on a per-region coordinator, which is a mild single-responsibility stretch — `DockRegion` grows from "handle drops on my region" to "also clean up stacks I created." That is acceptable because (1) every stack `DockRegion` prunes is one it created via `newStack()`, so ownership is real, not borrowed; and (2) when `Dock` lands, its `wireRegion` sweep is the formal home — it can take over the `empty` wiring and the prune routine moves up. The routine is written so `Dock` can call the identical logic; this plan notes that migration as the explicit intent without re-planning #5. **Regardless of where the owner lives, the formal long-term home is `Dock`.**

### Don't prune persistent app strips

A `TabPanel` a consumer placed deliberately (e.g. the demo's top/bottom strips) must not auto-vanish when emptied. The `empty` event is **passive** — every `Tab` fires it, but it removes nothing. Only a stack a dock owner *opted into* pruning (by subscribing its `empty` to the prune routine — which `DockRegion.newStack()` does, and the demo's standalone strips do not) is acted on. The persistent strips in `TabDemoPanel` are plain `TabPanel`s with no such subscription, so they stay put when emptied.

### All re-parents go through `moveComponent`

The collapse hoist re-homes the `Split`'s lone child into the grandparent via [`Component.moveComponent`](../src/typescript/lib/core/Component.ts#L3822) ([`plans/implemented/component-move-helper.md`](implemented/component-move-helper.md)) — never manual `removeComponent`+`addComponent`. `moveComponent` carries the child's layout constraints and schedules layout on both ends. The empty-stack removal itself is a `removeComponent` (the stack is being destroyed, not moved), which is the one legitimate non-`moveComponent` re-parent here.

### CODE_CONVENTIONS compliance

`empty` is wired through the existing `ListenerBag` / `on` / `emit` / `applyOptions` `listeners`-bag idiom — the same `Event`-style dispatch `tabclose` uses, so the framework's event-class rule holds. The `options.listeners.empty` dispatch goes in `applyOptions` beside the existing `tabclose` dispatch (safe here because `_listeners` is a class-field initializer that runs before the constructor body calls `applyOptions`, so the `options.listeners`-super-trap does not apply — `applyOptions` is invoked from the constructor body at [line 638](../src/typescript/lib/layout/Tab.ts#L638), not during `super()`). No typed DOM setter is added — `empty` is an event, not a styled property. The prune routine is decomposed into named private methods per the large-function rule.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/Tab.ts

/** Events a Tab layout can emit. */
export type TabEvent = "tabclose" | "empty";

interface TabOptions extends LayoutManagerOptions {
    listeners?: {
        tabclose?: (component: Component) => void;
        /** Fires after the last tab leaves the strip by any path (close, tear-off, re-dock). */
        empty?: () => void;
    };
    // …existing fields unchanged…
}

class Tab extends LayoutManager<TabOptions> {
    // new overloads (signatures only):
    on(event: "tabclose", listener: (component: Component) => void): this;
    on(event: "empty",    listener: () => void): this;

    protected emit(event: "tabclose", component: Component): void;
    protected emit(event: "empty"): void;
}
```

`off(event: TabEvent, listener: Function)` already accepts the widened union; no new `off` overload needed. The catch-all implementation signatures (`on(event: TabEvent, listener: Function)`, `emit(event: TabEvent, ...payload: unknown[])`) stay; only the typed front overloads grow.

`empty` carries **no payload** — it is a structure-agnostic "this strip is now empty" announcement; the subscriber already holds the stack reference it wired the listener onto.

No change to `Tab`'s callable export, no new exported symbol — `TabEvent` and `TabOptions` are already exported from the `layout` barrel; this widens existing types.

---

## Internal Structure

### The shared emit point in `Tab`

`removeEntryKeepingContent` ([3115](../src/typescript/lib/layout/Tab.ts#L3115)) and `closeTab` ([3380](../src/typescript/lib/layout/Tab.ts#L3380)) both end with:

```
this.selectNextTab(...);
this.getContainer()?.scheduleLayout();
this.syncHostWindowCloseable();
this.closeHostWindowIfEmpty();      // existing tear-off-window close — UNCHANGED
```

Add, in **both** tails, after `closeHostWindowIfEmpty()`:

```
if (this._tabs.length === 0) {
    this.emit("empty");
}
```

`closeHostWindowIfEmpty` stays first so the tear-off window still closes; the `empty` emit is additive. (Two emit call-sites rather than a single helper — the two tails are not otherwise extracted, and a one-line guard inlined twice is clearer than a new private method for it.)

### The prune+collapse routine in `DockRegion`

`newStack()` ([187](../src/typescript/lib/layout/DockRegion.ts#L187)) wires the listener at creation:

```typescript
private newStack(): Panel {
    const stack = new Panel({ layoutManager: new Tab({ reorderable: true }) });
    const tab   = stack.getLayoutManager() as Tab;

    tab.on("empty", () => this.pruneEmptyStack(stack));

    return stack;
}
```

`pruneEmptyStack(stack)` — remove the empty stack from its parent, then collapse a now-single-child `Split`:

```
parent = stack.getParentComponent()
if !parent: return                       // already detached
parent.removeComponent(stack)            // the stack is destroyed, not moved
collapseIfSinglePaneSplit(parent)
```

`collapseIfSinglePaneSplit(container)`:

```
lm = container.getLayoutManager()
if !(lm instanceof Split): return         // only Splits collapse
children = container.getComponents()
if children.length !== 1: return          // a Split with ≥2 panes is fine
lone        = children[0]
grandparent = container.getParentComponent()
if !grandparent: return                    // root region — leave the lone child in place
index = grandparent.getComponents().indexOf(container)
grandparent.moveComponent(lone, index)     // hoist into the Split's old slot
grandparent.removeComponent(container)     // drop the emptied Split
```

`instanceof Split` is acceptable here (mirrors `DockRegion.splitOnEdge`/`dockAsTab`, which already use `instanceof Split`/`instanceof Tab` at [154](../src/typescript/lib/layout/DockRegion.ts#L154)/[203](../src/typescript/lib/layout/DockRegion.ts#L203)). `Split` is already imported in `DockRegion.ts` ([line 5](../src/typescript/lib/layout/DockRegion.ts#L5)).

### Why the collapse is safe and bounded

- **Stale `_sizes` entry:** [`recalculateSizes`](../src/typescript/lib/layout/Split.ts#L929) keys `_sizes` by `Component` but iterates `container.getComponents()` (the live array) — a removed child's lingering map entry is never read, so removing a pane needs no `_sizes` cleanup. (The map entry leaks until the `Split` is GC'd, which is immediately here since the `Split` is itself removed.)
- **Gutters:** `_gutters` are rebuilt each `doLayout` from the live child count; removing a pane is handled on the next scheduled layout. `removeComponent` calls `scheduleLayout` ([Component.ts:3872](../src/typescript/lib/core/Component.ts#L3872)), so the layout runs.
- **Cascade bound:** a `Split` is constructed with ≥2 children (edge-split always makes a 2-pane `Split` — [`splitOnEdge`](../src/typescript/lib/layout/DockRegion.ts#L142)). Removing one stack drops it to 1 → one collapse. The hoisted child takes the `Split`'s slot in the grandparent; the grandparent's child count is **unchanged** (one out, one in), so the grandparent never itself drops to a single child *from this operation*. Collapse therefore does **not** cascade — bound is one collapse per emptied stack.
- **Root region:** if the single-pane `Split` is the root (no grandparent), the lone child is left in place and the `Split` is **not** dropped (nothing to hoist into). The lone pane simply fills the region. Acceptable — a root `Split` with one child renders that child full-bleed.

---

## Ordered Implementation Steps

1. **Widen `TabEvent`** ([Tab.ts:44](../src/typescript/lib/layout/Tab.ts#L44)) to `"tabclose" | "empty"`.
2. **Add the `empty` typed overloads** to `on` ([3341](../src/typescript/lib/layout/Tab.ts#L3341)) and `emit` ([3370](../src/typescript/lib/layout/Tab.ts#L3370)), each with its own JSDoc block (per CODE_CONVENTIONS: one JSDoc per overload). Update the `on`/`emit` JSDoc to describe `empty`.
3. **Add `empty?: () => void`** to `TabOptions.listeners` ([195](../src/typescript/lib/layout/Tab.ts#L195)) and dispatch it in `applyOptions` ([676](../src/typescript/lib/layout/Tab.ts#L676)) beside the `tabclose` dispatch.
4. **Emit `empty`** at the tail of `removeEntryKeepingContent` ([3137, after `closeHostWindowIfEmpty`](../src/typescript/lib/layout/Tab.ts#L3137)) and `closeTab` ([3418](../src/typescript/lib/layout/Tab.ts#L3418)), guarded by `this._tabs.length === 0`. Leave `closeHostWindowIfEmpty` untouched and first.
5. **Wire + prune in `DockRegion`:** in `newStack` ([187](../src/typescript/lib/layout/DockRegion.ts#L187)) attach `tab.on("empty", () => this.pruneEmptyStack(stack))`; add private `pruneEmptyStack(stack)` and `collapseIfSinglePaneSplit(container)` per Internal Structure. All re-parents via `moveComponent`; the stack/`Split` drops via `removeComponent`.
6. **Typecheck:** `npm run typecheck` — 0 errors.
7. **Reuse checkpoint:** `grep -n "addComponent\|removeComponent" src/typescript/lib/layout/DockRegion.ts` — the only `removeComponent`s are the empty-stack drop and the collapsed-`Split` drop; every re-home is `moveComponent`.
8. **Demo** in [`TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — extend the `splitRegion` block (see Verification).
9. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` — `empty` event: `TabEvent`, `on`/`emit` overloads, `TabOptions.listeners`, two emit call-sites |
| Modify | `src/typescript/lib/layout/DockRegion.ts` — wire `empty` in `newStack`; add `pruneEmptyStack` + `collapseIfSinglePaneSplit` |
| Modify | `src/typescript/TabDemoPanel.ts` — extend the `splitRegion` demo to exercise prune + collapse |
| Modify | `docs/layouts/Tab.md` (+ `docs/concepts/` docking page if present) — document the `empty` event |

No new files, no deletions. No `DragManager`/`Split`/`Window` change.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Checkpoint grep:** step 7 above.
- **Demo screen — `TabDemoPanel` (`npm run dev`, http://localhost:8015, scope DevTools to `.TabDemoPanel`):**
  1. **Empty-on-tear-off:** edge-drop two tabs onto the `splitRegion` to build a `Split` of two stacks; tear the *only* tab off one stack into a window → that stack disappears, and the remaining single-pane `Split` collapses so the surviving stack fills the region.
  2. **Empty-on-close:** rebuild a two-stack `Split`; close the last tab of one stack via its close button → same prune + collapse.
  3. **Empty-on-re-dock:** rebuild; drag the last tab of one stack onto the *other* stack's centre (re-dock) → source stack pruned, `Split` collapsed.
  4. **Persistent strip untouched:** empty the top/bottom `TabPanel` strips (close all their tabs) → they stay on screen (no `empty` subscription), proving the signal is passive.
  5. **Tear-off window still closes:** tear a tab into a `"strip"`-mode window, then tear its last tab back out → the window closes (the existing `closeHostWindowIfEmpty` path is intact alongside the new `empty` emit).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **No new exported symbol** — `TabEvent` and `TabOptions` are already exported from the `layout` barrel ([`src/typescript/lib/layout/index.ts`]); this widens them. No barrel edit needed.
- **Curated page:** update [`docs/layouts/Tab.md`](../docs/layouts/Tab.md) to document the `empty` event beside `tabclose` (when/why it fires, that it carries no payload, and that it is passive — the consumer decides what to do). If a docking/`DockRegion` concept page exists under `docs/concepts/`, note that `DockRegion` uses `empty` to prune emptied stacks and collapse single-pane `Split`s.
- **Cross-bucket JSDoc:** `Tab` and `DockRegion` are both in the `layout` bucket, so `{@link}` resolves between them; no markdown-link form needed. The `empty` JSDoc may `{@link Tab.on}`-style reference within the bucket.

---

## Potential Challenges

- **`empty` firing on a non-dock strip with no listener** — harmless: `ListenerBag.fire` on an event with no listeners is a no-op; the persistent demo strips never subscribe, so nothing prunes them.
- **Double-firing across paths** — `closeTab` may emit `tabclose` then `empty` in one call; subscribers must treat them as independent. The prune listener only reads `empty`, so no interaction.
- **Listener leak on a pruned stack** — when `pruneEmptyStack` `removeComponent`s the stack, the `Tab` (and its `ListenerBag`) is dropped with it; the closure captured `stack`, both GC together. No explicit `off` needed.
- **Collapse at the root** — handled by the "no grandparent → leave in place" branch; the lone child fills the root region full-bleed (acceptable).
- **Stale `Split._sizes` entry** — not read after the pane is removed (the map is iterated against live `getComponents()`), and the whole `Split` is dropped anyway; no cleanup required.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `TabEvent:44`, `_listeners:521`, `TabOptions.listeners:195`, `applyOptions:673`, `on:3341`/`emit:3370`, the two emit sinks `removeEntryKeepingContent:3115` / `closeTab:3380`, `closeHostWindowIfEmpty:3166`, `_closeHostWindowWhenEmpty:585`.
- [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) — `newStack:187` (wire point), `splitOnEdge:142`/`dockAsTab:200` (the `instanceof Split`/`Tab` discrimination idiom to mirror), `Split` import at line 5.
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `getDirection:258`, `recalculateSizes:929` (confirms removed-pane `_sizes` entry is never read), gutter rebuild.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `moveComponent:3822`, `removeComponent:3852` (schedules layout on removal).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts#L3) — imports (lines 3–7) proving it is `Split`/`Tab`-agnostic.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — `splitRegion` block at lines 194–203 (the demo to extend).
- [`plans/dock-tab-manager.md`](dock-tab-manager.md) — #5's `wireRegion` sweep: the formal long-term home for the prune wiring once `Dock` lands.
- [`plans/implemented/edge-drop-to-split.md`](implemented/edge-drop-to-split.md), [`plans/implemented/tab-detach-redock.md`](implemented/tab-detach-redock.md), [`plans/implemented/component-move-helper.md`](implemented/component-move-helper.md).

---

## Non-Goals

- **Merging same-direction nested `Split`s on collapse** — if the hoisted lone child is itself a `Split` of the same direction as the grandparent, ideal dock behaviour would flatten the two into one. Out of scope: the nesting is left as-is (matching #3's "correct nesting is kept" non-goal). Any normalisation pass is future work.
- **Moving the prune to `Dock`** — the formal long-term owner is plan #5's `Dock.wireRegion` sweep; this plan deliberately hosts the prune on `DockRegion` as an interim, demo-unblocking slice. Migrating it to `Dock` is #5's concern, not re-planned here.
- **Pruning persistent app strips** — a deliberately-placed `TabPanel` that empties is left alone by design; the `empty` signal is passive and only subscribed by dock-created stacks.
- **A new `Tab`/`Split` subclass or container kind** — regions stay plain `Panel` + `Split`/`Tab`, exactly as #3 defines them.
- **Touching `closeHostWindowIfEmpty`** — the tear-off-window close stays as-is; `empty` is purely additive and coexists with it.
