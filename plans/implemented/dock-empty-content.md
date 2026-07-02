# Dock Empty-State / Placeholder — Implementation Plan

## Overview

Give [`Dock`](src/typescript/lib/overlay/Dock.ts:150) first-class support for a
placeholder shown while it holds no panels — the "start page" a downstream SQL
admin tool wants when nothing is open. Today a consumer must track the panel
count itself and toggle a `Card`; `Dock` exposes no `emptyContent` hook, no
emptiness accessor, and no empty↔populated signal (only per-panel `"attach"` /
`"detach"` / `"moved"` / `"focus"` / `"close"`).

The feature adds three routed surfaces — a `DockOptions.emptyContent?: Component`
field, a `setEmptyContent` / `getEmptyContent` setter+accessor pair, and an
`isEmpty()` accessor plus a single `"emptychange"` event — and an internal
empty-state machine that attaches the placeholder into the (kept) empty root
region's element while empty and detaches it the instant a panel appears. The
placeholder never touches the region's `getComponents()`, so it is invisible to
`Tab.doLayout` (no phantom tab) and to `serializeLayout` (not persisted), and the
empty root region stays a live [`DockRegion`](src/typescript/lib/layout/DockRegion.ts:37)
drop target underneath it.

All changes are confined to [`Dock.ts`](src/typescript/lib/overlay/Dock.ts) and its
lifecycle test [`tests/overlay/Dock.lifecycle.test.ts`](tests/overlay/Dock.lifecycle.test.ts).

---

## Architecture Decisions

### API surface — `emptyContent` + `isEmpty()` + one `"emptychange"` event

The minimal coherent surface is:

- `DockOptions.emptyContent?: Component` + `setEmptyContent(component: Component | null): this` + `getEmptyContent(): Component | null` — the state-bearing placeholder property, routed through the options bag per the typed-setter convention (options field → `applyOptions` → setter → cached in `_options.emptyContent`, getter reads `this._options.emptyContent ?? null`).
- `isEmpty(): boolean` — the panel-count accessor. It saves every consumer the manual `_frames.size` / tab-count bookkeeping and is the public read side of the state machine the plan already needs internally.
- A single `"emptychange"` event carrying `{ empty: boolean }`, added to the `DockEvent` union and the `on` / `off` / `emit` overload set. It fires **once** on each real transition into or out of empty.

**Why one `"emptychange"` and not `"empty"` + `"populated"`:** the state is a single boolean; two events would force a consumer wanting "toggle my start page" to wire two listeners and keep them in sync, and it duplicates the payload information (`empty: true` vs a separate event name). One event with a boolean payload is the smaller, non-redundant surface and matches the existing `"focus"`-carries-`null` precedent of encoding state in the payload rather than the event name.

**Why not fold emptiness into the existing `"attach"`/`"detach"` events:** those are *per-panel host-transition* events (a panel entering/leaving a host), fired from the host-diff reconcile; emptiness is a *dock-wide* aggregate. Overloading them would make "did the dock just become empty?" require the consumer to re-derive the aggregate on every panel event — exactly the bookkeeping this feature removes.

### Where the placeholder renders — attached into the empty root region's element, never as a region child

The emptied dock keeps a valid empty **root `Tab` region** as the add/drop target (the [`pruneRegion`](src/typescript/lib/overlay/Dock.ts:965) `parent === this` guard). The placeholder must show without destroying that region or defeating it as a drop target. Three placements were considered:

1. **As a child of the root region** (`region.addComponent(emptyContent)`) — **rejected.** [`Tab.doLayout`](src/typescript/lib/layout/Tab.ts:1484) creates a tab cell for *every* container child no entry owns, so the placeholder would become a phantom UUID-labelled tab; and [`nodeFor`](src/typescript/lib/layout/LayoutSerialization.ts:203) walks the region's `getComponents()` and would serialize the placeholder as a `{ kind: "panel", panelId: emptyContent.getId() }` leaf — corrupting the layout state. Poison on both counts.

2. **A separate Fit child of the Dock** — **rejected.** The Dock's layout manager is [`Fit`](src/typescript/lib/layout/Fit.ts:27), which *throws* on more than one child. `getRootRegion()` is `getComponents()[0]` and the empty-drop predicate reads `getComponents().length === 0`; a second Fit child breaks all three.

3. **Raw-appended into the root region's element, sized by the Dock, `pointer-events: none` — chosen.** This mirrors the existing [`DropZoneOverlay.attachTo`](src/typescript/lib/overlay/DropZoneOverlay.ts:154) precedent already used in `Dock` for `_emptyDropOverlay`: the overlay is appended into the region element via raw `DOM.sink.appendChild`, **not** `addComponent`, so it never enters `getComponents()`. Consequences, all desired:
   - `Tab.doLayout`'s "catch up to unowned children" scan (`container.getComponents()`) never sees it → **no phantom tab**.
   - `serializeLayout` walks `getComponents()` → **never serialized** (Decision *Serialization* below).
   - The root region — and its `DockRegion` edge/centre drop wiring plus the Dock's own empty-drop target — stay **live underneath**; the placeholder carries `pointer-events: none` (exactly as `DropZoneOverlay` does) so a drop passes through to the region body / dock. `addPanel` docks a tab into the region unchanged; when the panel appears the placeholder detaches.

The placeholder is hosted in the root region's element (not the Dock's own element) so it occupies the region's box — which, for an empty dock, is the full dock bounds (the sole `Fit` child fills the Dock). Sizing is driven from a `Dock.doLayout` override: after `super.doLayout()` positions the root region, the Dock sizes the attached placeholder to the root region's inner size, the same explicit-size discipline `DropZoneOverlay.attachTo` uses (`setX(0)/setY(0)/setWidth/setHeight`).

### Show/hide transitions — driven off `isEmpty()`, reconciled once per sweep + once per close

Emptiness is defined as **`this._frames.size === 0`** — no live panel anywhere the dock manages, tiled *or* floated. This is the single source of truth already maintained by `addPanel`/`compileTabs` (adds), `onPanelClosed`/`onFloatClosed` (removes), and the restore path. Deriving emptiness from `_frames.size` (not from the root region's tab count) makes the **tear-off decision fall out correctly**: a dock whose only panels are all torn off into floats still has those frames in `_frames`, so it is **not empty** and shows **no** placeholder — matching the intent that a float is still a live panel of this dock, just relocated. The placeholder is for "nothing is open anywhere," which is precisely `_frames.size === 0`.

The transitions that change `_frames.size` between zero and non-zero, and where each is observed:

| Transition | Direction | Observed at |
|---|---|---|
| `addPanel` / `addLazyPanel` into empty dock | → populated | reconcile at end of `runSweep` |
| construction with a `layout` | → populated | reconcile at end of first `runSweep` |
| `setLayoutState` restore (from empty, or to empty) | either | reconcile at end of the restore's `runSweep` |
| close last tiled tab → `pruneRegion` keeps root, `onPanelClosed` deletes frame | → empty | `onPanelClosed` (frame delete) then reconcile |
| close last floated panel (`onFloatClosed`) | → empty | `onFloatClosed` then reconcile |
| re-dock a float back in / tear-off out | no change | `_frames.size` unchanged → **silent** |

The emit is centralised in a single `reconcileEmptyState()` helper called at the **end of `runSweep`** (after `reconcileHosts`), and once from the two frame-deleting close handlers' path. `runSweep` already runs coalesced on one rAF per gesture burst (`scheduleSweep`), so the emit is **once per settled transition, not per frame**. `reconcileEmptyState` diffs the current `_frames.size === 0` against a cached `_empty: boolean` latch; it attaches/detaches the placeholder and emits `"emptychange"` **only when the latch flips**. A no-op sweep (unchanged tree) leaves the latch unchanged → silent, matching the existing `"is silent for a sweep over an unchanged tiled tree"` guarantee.

Both close handlers already `scheduleSweep` indirectly (a close leaves the region, `pruneRegion` → `scheduleSweep`; a float close is followed by a focus-recompute rAF), but to guarantee the reconcile runs even on a close that schedules no structural sweep, `onPanelClosed` and `onFloatClosed` call `scheduleSweep()` after deleting the frame(s). This routes every close through the one reconcile site rather than duplicating attach/detach logic in the close handlers.

### Serialization — confirmed excluded

`emptyContent` is chrome, not a panel. `getLayoutState()` → `serializeLayout(getRootRegion())` walks the region tree via [`nodeFor`](src/typescript/lib/layout/LayoutSerialization.ts:187) / [`collectLeaves`](src/typescript/lib/layout/LayoutSerialization.ts:286), both reading only `component.getComponents()`. Because the placeholder is raw-appended (never `addComponent`), it is absent from `getComponents()` and cannot appear in the serialized tree. `restoreLayout` sources leaves from the panel registry (`resolvePanel`), which the placeholder is never registered in (`_panels` / `_frames`), so a restore neither parks nor rebuilds it. No serialization change is needed — this is asserted as a regression test, not implemented.

### Convention compliance

- **Typed-setter + options-bag routing:** `emptyContent` gets the three-way route (`DockOptions.emptyContent` → `applyOptions` → `setEmptyContent` → `_options.emptyContent` cache → `getEmptyContent`), per [ARCHITECTURE.md *Three non-negotiable rules*](ARCHITECTURE.md).
- **Event surface:** `"emptychange"` is a framework-custom (non-DOM) event, so it uses the existing `ListenerBag<DockEvent>` + `on`/`off`/`emit` machinery already in `Dock` — no new `Event` API site.
- **`super()`-cascade field trap:** `setEmptyContent` is dispatched from `applyOptions` (inside `super()`), so it must **only cache** into `_options.emptyContent` and defer any DOM/attach work to render/sweep time — it must not attach the element during construction (the placeholder attaches from the reconcile, which runs on the post-`super()` first sweep). The `_empty` latch, if given a class-field initializer, would be reverted by the cascade only if a cascade-dispatched setter wrote it; it is not written by any setter, so a plain initializer (`private _empty = false;`) is safe — but the first reconcile establishes the true value regardless.
- **Listeners reference named functions; `emit` stays `protected`** — unchanged from the existing `Dock` event plumbing.

---

## Public API

```typescript
// DockOptions gains one field:
export interface DockOptions extends ContainerOptions {
    layout?:       DockLayoutSpec;
    emptyContent?: Component;   // NEW — placeholder shown only while the dock has no panels.
}

// DockEvent union gains one member:
export type DockEvent =
    "attach" | "detach" | "moved" | "focus" | "close" | "emptychange";   // NEW: "emptychange"

// New payload for the aggregate event:
export interface DockEmptyEvent {
    /** true when the dock just became empty (no live panels), false when it became populated. */
    empty: boolean;
}

class Dock extends Container<DockOptions> {
    // Placeholder property — routed setter/accessor.
    setEmptyContent(component: Component | null): this;
    getEmptyContent(): Component | null;

    // Aggregate emptiness accessor: true iff no live panel (tiled or floated) exists.
    isEmpty(): boolean;

    // New on/off overloads (added alongside the existing "attach|detach|moved|close" and "focus"):
    on(event: "emptychange", listener: (event: DockEmptyEvent) => void): this;
    off(event: "emptychange", listener: (event: DockEmptyEvent) => void): this;
    // emit gains the matching protected overload.
}
```

Backing state (private fields):

- `this._options.emptyContent` — the cache for `getEmptyContent` (options bag is the cache; no separate `_emptyContent` field, per the default-shape convention).
- `private _empty: boolean = true;` — the state-machine latch gating the `"emptychange"` emit and the attach/detach. **(Drift correction:** seeded `true`, not `false`, because a dock is *born* empty. With a `false` seed the first `addPanel` into a fresh dock would find `empty === _empty` on the coalesced first sweep and stay silent, missing the empty→populated transition. Seeding `true` makes the first reconcile on a still-empty dock a no-op, while the first add — or a born-with-layout dock — correctly flips it and emits `emptychange(false)`.)
- `private _emptyReconciled: boolean = false;` — first-run guard so the very first `reconcileEmptyState` syncs the placeholder to the *born* state (attaching it when the dock is born empty) **without** an emit — being born empty is not a transition. A born-with-layout dock falls through this guard to the normal transition branch and emits `emptychange(false)` once.

---

## Internal Structure

`isEmpty()` and the reconcile:

```typescript
isEmpty(): boolean {
    return this._frames.size === 0;
}

// Called at the end of runSweep (after reconcileHosts) and reached from every
// close via scheduleSweep. Flips the latch, toggles the placeholder, emits once.
private reconcileEmptyState(): void {
    const empty = this.isEmpty();

    if (empty === this._empty) {
        return;                      // no transition -> silent, no re-attach
    }

    this._empty = empty;

    if (empty) {
        this.attachEmptyContent();   // raw-append into the root region's element
    } else {
        this.detachEmptyContent();
    }

    this.emit("emptychange", { empty });
}
```

`attachEmptyContent` / `detachEmptyContent` mirror `DropZoneOverlay.attachTo` /
`detach`: raw `DOM.sink.appendChild` of `emptyContent.getElement(true)` into the
root region's element (guarded so it is idempotent), `pointer-events: none` on
the placeholder, and sizing deferred to the `doLayout` override:

```typescript
doLayout(): void {
    super.doLayout();

    if (this._empty && this.getEmptyContent()) {
        // Size the attached placeholder to the root region's box (the full dock
        // while empty), matching the explicit-size discipline DropZoneOverlay uses.
    }
}
```

A `null` / absent `emptyContent` makes `attach`/`detach` no-ops that only flip the
latch and emit — so `"emptychange"` still fires for a consumer that wants the
signal without supplying a placeholder.

---

## Ordered Implementation Steps

1. **`DockOptions.emptyContent`** — add the optional field to the interface with JSDoc.
2. **`DockEvent` union + `DockEmptyEvent`** — add `"emptychange"` to the union; declare the `DockEmptyEvent` payload interface with JSDoc.
3. **Backing state** — add `private _empty: boolean = false;` (plain initializer is safe — no cascade-dispatched setter writes it).
4. **`setEmptyContent` / `getEmptyContent`** — routed setter (cache into `this._options.emptyContent`, no DOM work) + `?? null` getter.
5. **`applyOptions` route** — forward `options.emptyContent` to `setEmptyContent` under an `!== undefined` guard. (Confirm `Dock` has/needs an `applyOptions` override; if it currently relies on the base, add one that calls `super.applyOptions` first.)
6. **`isEmpty()`** — `return this._frames.size === 0;` with JSDoc.
7. **`attachEmptyContent` / `detachEmptyContent`** — private helpers: idempotent raw-append into `getRootRegion().getElement(true)`, `pointer-events: none`, detach via `DropZoneOverlay`-style element removal. Guard on `getEmptyContent()` being non-null and `getRootRegion()` existing.
8. **`reconcileEmptyState()`** — the latch-diff helper above; call it at the **end of `runSweep`** after `reconcileHosts(root)`.
9. **`doLayout` override** — `super.doLayout()`, then size the attached placeholder to the root region while `_empty`.
10. **Route closes through the reconcile** — in `onPanelClosed` and `onFloatClosed`, call `scheduleSweep()` after the frame delete(s) so the sweep's `reconcileEmptyState` runs even when no structural prune scheduled one. (Verify `pruneRegion`'s existing `scheduleSweep` already covers the tiled-close case; the explicit call makes it unconditional and covers the float-close case.)
11. **`on` / `off` / `emit` overloads** — add the `"emptychange"` overload to each of the three, forwarding to the existing `_listeners` bag; widen the terminal `emit(event: DockEvent, payload)` signature to accept `DockEmptyEvent`.
12. **Regression checkpoint** — `grep -n 'addComponent' src/typescript/lib/overlay/Dock.ts` around the new helpers — expect **zero** `addComponent(emptyContent)` (the placeholder must never enter `getComponents()`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/overlay/Dock.ts` |
| Modify | `tests/overlay/Dock.lifecycle.test.ts` |

No new files; no deletions.

---

## Expected Behaviour

State-machine behaviours are **offline red-green testable** through the existing
harness (`mountDock` / `captureRaf` / `flush` / `priv`, driving
`addPanel` / `removePanel` / `setLayoutState` / `runSweep` with rAF flushing).
Only the **visual paint** of the placeholder is manual-verify.

Offline-testable:

1. **A fresh empty dock reports `isEmpty() === true`.** `mountDock()` then `flush()` — no panels added.
2. **`addPanel` into an empty dock flips to populated and emits `emptychange({empty:false})` once.** After `flush()`, `isEmpty()` is `false`; exactly one `"emptychange"` with `empty:false`; no second emit on a subsequent no-op `runSweep`.
3. **Closing the last tiled panel flips to empty and emits `emptychange({empty:true})` once.** Add one panel, `flush`; `removePanel`, `doLayout`, `flush`; `isEmpty()` is `true`; exactly one `"emptychange"` with `empty:true`.
4. **Closing the last floated panel flips to empty and emits once.** Tear a panel to a `Window`, `flush`; `win.requestClose()`, `flush`; `isEmpty()` true; one `emptychange({empty:true})`.
5. **A dock with all panels floated is NOT empty.** Add a panel, tear it to a float (`win.moveComponent(frame)` + sweep), `flush`; `isEmpty()` is `false`; no `"emptychange"` fired (never entered empty).
6. **Placeholder attach/detach across the machine.** With `emptyContent: new Component({})`: after construction+flush the placeholder is attached to the root region element and absent from `getRootRegion().getComponents()`; after `addPanel`+flush it is detached; after close-last+flush it is re-attached. Assert attach/detach via the placeholder element's parent (or a `priv`-reached `_empty` latch + an attach spy), and assert `getRootRegion().getComponents()` **never** contains the placeholder at any point.
7. **`emptychange` fires with no `emptyContent` supplied.** Same as (2)/(3) but without a placeholder — the event still fires once per transition (signal-only consumer).
8. **A no-op sweep over an unchanged tree emits no `emptychange`.** Mirrors the existing unchanged-tree silence test.
9. **`setLayoutState` restore reconciles emptiness.** Restore a non-empty state into an empty dock → one `emptychange({empty:false})`. A surviving-panel restore that stays populated emits nothing. **(Implementation note / drift correction:** the plan originally also claimed "restore an empty state (root with no leaves) → `emptychange({empty:true})`". This does **not** hold under the `_frames.size === 0` emptiness definition: `restoreLayout` *parks* factory-known leaves — it detaches them but does **not** evict them from `_frames` — so a restore that drops a panel leaves the frame parked-but-registered, and `isEmpty()` stays `false`. A parked frame is still a live-but-unplaced panel, consistent with the "a float is still a live panel" reasoning, so restore-to-empty is deliberately *not* reported as empty. The test therefore asserts only the empty→populated direction plus populated-restore silence.)
10. **`emptyContent` is not serialized.** With a placeholder attached (empty dock), `getLayoutState().root` is a `tab` node with an empty `children` array — the placeholder's id never appears; `serializeLayout` walks only `getComponents()`.
11. **The empty root region stays a live drop target.** After close-last, `getRootRegion()` is truthy, its `DockRegion` wiring entry survives in `priv(dock)._wiring`, and a subsequent `addPanel` docks a tab (the existing "can open a panel again after the last one was closed" test still passes, extended to assert the placeholder detached).
12. **Routed setter/accessor parity.** `new Dock({ emptyContent: c }).getEmptyContent() === c`; `dock.setEmptyContent(c2).getEmptyContent() === c2`; `setEmptyContent(null)` clears it.

Manual-verify (visual only):

- The placeholder actually renders, fills the empty dock, and is visually replaced by the panel content when a panel opens (exercise in the app's Dock demo / SQL-admin start-page scenario).
- A tab dragged over the empty dock still shows the blue drop overlay and drops through the `pointer-events: none` placeholder (drag/geometry is not offline-testable).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or the project's typecheck script) — clean.
- **Unit tests:** `npx vitest run tests/overlay/Dock.lifecycle.test.ts` — the new behaviours (1)–(12) pass; the existing lifecycle suite stays green (no regression in attach/detach/moved/focus/close).
- **Grep invariant:** `grep -n 'addComponent' src/typescript/lib/overlay/Dock.ts` — no `addComponent` of the placeholder; placeholder attaches only via the raw-append helper.
- **Docs build:** `npm run docs:build` — zero warnings (new public JSDoc on `setEmptyContent` / `getEmptyContent` / `isEmpty` / `on("emptychange")` must only `{@link}` public symbols; describe `_frames`/reconcile internals in prose, not links).
- **Manual smoke:** run the app, open the Dock demo, verify the placeholder shows on an empty dock, hides when a panel opens, and re-shows when the last panel closes; drag a tab over the empty dock and confirm the drop still lands.

---

## Documentation Impact

`Dock` is exported through `~/overlay/Dock` (callable). The new public symbols
(`setEmptyContent`, `getEmptyContent`, `isEmpty`, the `"emptychange"` `on`/`off`
overload, `DockOptions.emptyContent`, `DockEmptyEvent`) render on the existing
`Dock` API page via TypeDoc — no new page or barrel entry is needed. Per
[CODE_CONVENTIONS.md *Don't `{@link}` internal symbols*](CODE_CONVENTIONS.md),
the JSDoc for these must not link `_frames`, `runSweep`, `reconcileEmptyState`,
or other private members — describe the "no live panels anywhere" semantics and
the "shown only while empty, not serialized" behaviour in prose. If the docs
site has a Dock concept/recipe page that lists its events, add `"emptychange"`
there alongside the panel-lifecycle events. Run the `document` skill after the
code change to update any consumer-facing Dock docs.

---

## Potential Challenges

- **Sizing the raw-appended placeholder across resizes.** Unlike `DropZoneOverlay` (re-sized on every drag `onDragOver`), the placeholder must track arbitrary dock resizes — mitigated by sizing it in the `Dock.doLayout` override so it re-fits on every layout pass while empty.
- **First-sweep timing.** `setEmptyContent` from `applyOptions` runs during `super()`; the placeholder must not attach then (no element/region yet). Mitigated by deferring all attach to `reconcileEmptyState`, which first runs on the post-construction sweep — matching how `Dock` already defers `wireEmptyDropTarget` wiring and the initial `scheduleSweep`.
- **`emit` signature widening.** The terminal `emit(event: DockEvent, payload: DockPanelEvent | null)` must widen to also accept `DockEmptyEvent`; keep the public per-event overloads precise so a `"focus"` listener can't be handed a `DockEmptyEvent` and vice versa.
- **Double-reconcile on a close that also prunes.** A tiled close both deletes the frame and prunes → one sweep; the latch-diff makes a second reconcile in the same settled state a no-op, so the extra `scheduleSweep` in the close handler cannot double-fire `"emptychange"`.

---

## Critical Files

- [`src/typescript/lib/overlay/Dock.ts`](src/typescript/lib/overlay/Dock.ts) — the class under change; read `runSweep`, `reconcileHosts`, `pruneRegion`, `onPanelClosed`, `onFloatClosed`, `wireEmptyDropTarget`, and the `on`/`off`/`emit` block.
- [`src/typescript/lib/overlay/DropZoneOverlay.ts`](src/typescript/lib/overlay/DropZoneOverlay.ts:154) — the raw-append + explicit-size + `pointer-events:none` precedent to mirror.
- [`src/typescript/lib/layout/LayoutSerialization.ts`](src/typescript/lib/layout/LayoutSerialization.ts:187) — `nodeFor` / `collectLeaves` walk only `getComponents()`; confirms the non-serialization guarantee.
- [`src/typescript/lib/layout/Tab.ts`](src/typescript/lib/layout/Tab.ts:1484) — `doLayout` makes a tab for every container child; confirms why the placeholder must not be a region child.
- [`src/typescript/lib/layout/Fit.ts`](src/typescript/lib/layout/Fit.ts:27) — throws on >1 child; confirms why the placeholder can't be a second Dock child.
- [`tests/overlay/Dock.lifecycle.test.ts`](tests/overlay/Dock.lifecycle.test.ts) — the offline harness (`mountDock`/`captureRaf`/`flush`/`priv`) the new behaviours plug into.

---

## Non-Goals

- **No entrance/exit animation** for the placeholder — attach/detach is immediate; a fade can be layered later but is not requested.
- **No per-region empty state** — emptiness is dock-wide (`_frames.size === 0`); an individual empty region inside a populated dock shows nothing.
- **No placeholder for float windows** — the feature targets the main dock's empty state; a fully-floated dock is deliberately *not* empty.
- **No serialization of `emptyContent`** — it is chrome; excluded by construction, confirmed by test, never added to `_panels`.
