---
depends-on:
  - implemented/dock-tab-manager.md
touches-shared:
  - src/typescript/lib/layout/LayoutSerialization.ts
  - src/typescript/MiscPanel.ts
---

# Floating Dockable Windows — Implementation Plan

## Overview

A panel torn off from a [`Dock`](../src/typescript/lib/core/Dock.ts) today lands in a `TabWindow` — a window whose *whole body is a single `Tab` strip* ([TabWindow.ts:79-90](../src/typescript/lib/core/TabWindow.ts#L79)). That window can only accept *tab-adds*; it has no internal `Split`/region tree, so you cannot edge-split inside it or arrange a multi-pane layout there. This feature makes a tear-off land in a plain floating [`Window`](../src/typescript/lib/core/Window.ts) whose content is a **wired dock region tree** — a *mini-dock* — that you can edge-split, arrange, and re-dock against the main dock in both directions.

The work is almost entirely in **`Dock`** ([Dock.ts](../src/typescript/lib/core/Dock.ts)): switch its `Tab`s to bare detach mode so a tear-off produces an ordinary `Window` hosting the live identity frame, then extend the existing rAF-coalesced sweep ([`runSweep`/`wireRegion`/`teardownVanished`/`collectRegions`](../src/typescript/lib/core/Dock.ts#L446)) to **adopt** each such float window's content into a wired region tree and keep its regions live across sweeps. One serialization change ([LayoutSerialization.ts:98](../src/typescript/lib/layout/LayoutSerialization.ts#L98)) lets a `WindowNode` carry a full `LayoutNode` tree instead of a single `panelId`, with backward-compat for legacy single-panel nodes. [`DockRegion.splitOnEdge`](../src/typescript/lib/layout/DockRegion.ts#L325) already wraps *within* a window-rooted container — no change needed there, only a documented confirmation.

No new public component, no new theme token. The new public surface is one optional field on `WindowNode` (`content?: LayoutNode`) and the existing `Dock` behaviour gaining float-window participation. Demo home is [`MiscPanel.ts:624`](../src/typescript/MiscPanel.ts#L624).

---

## Architecture Decisions

### Tear-off mechanism — `Dock` sets its `Tab`s to `"bare"` detach mode and the sweep adopts the float

**Chosen:** `Dock.wireRegion` calls `tab.setDetachWindowMode("bare")` on every `Tab` region it wires (alongside the existing `setReorderable(true)` — [Dock.ts:477](../src/typescript/lib/core/Dock.ts#L477)). In `"bare"` mode [`Tab.detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L1727) builds `new Window(name, { closeable })` and does `win.moveComponent(content); win.show()` ([Tab.ts:1755-1757](../src/typescript/lib/layout/Tab.ts#L1755)) — an ordinary header `Window` whose CENTER child is the live identity frame, **not** a `TabWindow`. The dock then *adopts* that window in its next sweep: it wraps the bare frame in a fresh `Tab` region (so the frame has a draggable handle and is a proper region leaf) and `wireRegion`s the result, turning the window's content into a mini-dock.

**Why this over the alternatives:**

- **(a) bare-mode + adopt (chosen).** Zero change to shipped `Tab`/`TabWindow`/`Window`. `"bare"` is an already-shipped, already-tested `TabDetachWindowMode` ([Tab.ts:43](../src/typescript/lib/layout/Tab.ts#L43)) whose entire contract — *"the live content fills the window body directly; it re-docks by Ctrl-dragging the window header onto a strip"* — is exactly what a mini-dock host wants. The dock already owns an idempotent sweep that wraps bare leaves in `Tab` stacks ([`DockRegion.ensureStacked`](../src/typescript/lib/layout/DockRegion.ts#L402) does the same in-tree), so adoption is a small, natural extension of code that already exists.
- **(b) a new `Tab` detach mode / a `Dock`-supplied tear-off window factory.** Rejected: it adds shipped-primitive surface (`Tab` would need a `detachWindowFactory` hook or a third mode) to achieve what bare mode + adopt already achieves with no `Tab` change. The dock-tab-manager plan was explicit that the **only** acceptable shipped-primitive changes were the `DockRegion.onStructureChanged` callback and the serialization id rework ([dock-tab-manager.md:227](implemented/dock-tab-manager.md#L227)); adding a `Tab` factory hook re-opens that surface for no gain.

The Shift-force-bare path ([Tab.ts:1728](../src/typescript/lib/layout/Tab.ts#L1728)) is now redundant for dock tabs (they are always bare) but harmless — it stays untouched.

### `Dock` owns float windows by adopting any open window that hosts one of its frames

`Dock` already has the membership oracle: `_frames` ([Dock.ts:96](../src/typescript/lib/core/Dock.ts#L96)) maps every registered `panelId` to the identity `Panel` the dock built for it, and that frame survives a tear-off re-home (its `getId()` is stable). A new private `ownedFloatWindows()` enumerates `AbstractWindow.getOpenWindows()` ([AbstractWindow.ts:828](../src/typescript/lib/core/AbstractWindow.ts#L828)) and keeps those whose content subtree contains a frame in `_frames.values()` — tested by walking each frame's ancestor chain to the window (the same shape as [`hostsComponent`](../src/typescript/lib/layout/LayoutSerialization.ts#L333)). It deliberately **excludes** the host window the dock itself lives in (the dock is a *descendant* of that window, not its content a *frame* — the test keys on frames, and the host window's content is the dock, whose own subtree holds the frames but whose *direct* content is not a frame; we additionally guard with `!hostsComponent(win, this)` to be unambiguous).

`runSweep` ([Dock.ts:446](../src/typescript/lib/core/Dock.ts#L446)) is extended: after `wireRegion(root)` it iterates `ownedFloatWindows()`, **adopts** each (ensures its content is a wired region tree), and `wireRegion`s each window's content region. The tear-off already schedules a sweep — the source strip emits `"empty"` → `Dock`'s `pruneRegion` → `scheduleSweep` ([Dock.ts:501,429](../src/typescript/lib/core/Dock.ts#L501)) — so an adoption sweep fires on the frame *immediately after* it lands in the window, with no new trigger needed. (Confirmed: `removeEntryKeepingContent` on the source strip drives the strip to zero tabs and emits `"empty"` — [Tab.ts:1692](../src/typescript/lib/layout/Tab.ts#L1692), emit at [1710](../src/typescript/lib/layout/Tab.ts#L1710).)

### Adoption: wrap the bare window content in a `Tab` region once, idempotently

A freshly torn-off bare `Window` has its identity frame as the direct child of the window's `Border` layout ([Window.ts:236](../src/typescript/lib/core/Window.ts#L236)) — added via `win.moveComponent(content)` with **no** constraint ([Tab.ts:1756](../src/typescript/lib/layout/Tab.ts#L1756)), so the frame holds no `Placement.CENTER` constraint; `Border` simply treats an unplaced child as CENTER. `adoptFloat(win)`:

1. Reads `windowContentOf(win)` — the first non-chrome child (reuse the existing predicate shape: `win.getComponents().find(c => !win.isChromeComponent(c))`, [AbstractWindow.ts:1685](../src/typescript/lib/core/AbstractWindow.ts#L1685) / [LayoutSerialization.ts:212](../src/typescript/lib/layout/LayoutSerialization.ts#L212)).
2. If that content is already a region container (`isRegionContainer` — [Dock.ts:597](../src/typescript/lib/core/Dock.ts#L597)), it has already been adopted (or restored as a tree) — return it.
3. Otherwise the content is a bare frame: build a fresh `Tab` region (`newTabRegion()` — [Dock.ts:354](../src/typescript/lib/core/Dock.ts#L354)), `win.moveComponent(region)` it into the window body (the fresh region carries no constraint, so the `Border` fills it as an unplaced→CENTER child — the same way the bare frame filled), then `region.moveComponent(frame)` the frame into the region. Return the region.

Adoption is idempotent: step 2 short-circuits once the window holds a region tree, so re-sweeps after edge-splits inside the float don't re-wrap. The frame's glyph constraint is dropped on the move into a single-tab region — acceptable; the tab label still rides the frame's `getName()`. (If glyph preservation in floats is wanted it would re-stamp the constraint, but that is not required for the feature and is left as a Non-Goal.)

### `teardownVanished` must treat float-window regions as live — extend the live-set, not just the root walk

`teardownVanished` ([Dock.ts:558](../src/typescript/lib/core/Dock.ts#L558)) currently builds its reachable set with `collectRegions(root, set)` — *only* regions under the in-dock root. Every region inside an owned float window is therefore "unreachable" and its `DockRegion` coordinator gets `destroy()`ed on the very next sweep, killing the float's drop targets. The fix: after `collectRegions(root, reachable)`, also `collectRegions(adoptedRegion, reachable)` for each owned float window's adopted content region. This is the **combined live-set**: in-dock tree ∪ every owned float's region tree. The per-window root regions are **not** tracked in a separate field — they are re-derived each sweep from `ownedFloatWindows()` + `windowContentOf`, mirroring the existing decision that the in-dock root is *derived live, never cached* ([Dock.ts:200](../src/typescript/lib/core/Dock.ts#L200)). A closed float drops out of `getOpenWindows()`, so its regions fall out of the live-set and their coordinators are correctly torn down on the next sweep.

Refactor `runSweep` so wiring and live-set collection share the float enumeration: compute `const floats = this.ownedFloatWindows()` once, wire root + each float's adopted region, then pass the same adopted regions to a `teardownVanished(root, adoptedRegions)` that seeds the reachable set from all of them.

### `splitOnEdge` already handles a window-rooted container — no `DockRegion` change

Reading [`DockRegion.splitOnEdge`](../src/typescript/lib/layout/DockRegion.ts#L325): it resolves `unit` = the region (or its parent `Tab` stack) and `container = unit.getParentComponent()` ([DockRegion.ts:349-351](../src/typescript/lib/layout/DockRegion.ts#L349)), then wraps the unit by `container.moveComponent(split, unitIndex)` ([DockRegion.ts:372](../src/typescript/lib/layout/DockRegion.ts#L372)). When the region's chain tops out at a `Window`, `container` is the `Window` itself and the fresh `Split` is inserted as a child of the **window's content area** (the `Border`'s CENTER slot the old unit occupied) — it wraps the *pane within the window*, never the window. The `container.moveComponent(split, unitIndex)` path works against a `Window` exactly as against a region container because `Window` *is* a `Container` subclass (`Window` → `AbstractWindow extends Container` — [AbstractWindow.ts:167](../src/typescript/lib/core/AbstractWindow.ts#L167)) with a real layout manager (its `Border`). **One subtlety:** the new `split` is inserted at `unitIndex` but the `Border`-placement constraint the unit held is **not** carried by `moveComponent`'s index form — the unit was CENTER-placed; the wrapper inherits no placement and a `Border` treats an unplaced child as CENTER by default, so it still fills. This works today via the adoption decision above: **adoption replaces the bare CENTER frame with a `Tab` *region*, so by the time any edge-split happens the window's content is already a region whose own `getLayoutManager()` is a `Tab`/`Split`** — `splitOnEdge` then extends/wraps *inside* that region tree (its `lm instanceof Split` / parent-`Tab` branches, [DockRegion.ts:349-372](../src/typescript/lib/layout/DockRegion.ts#L349)), never reaching the window as `container`. So the window is the container only for the *first* split of a single-region float, and even then it wraps the content, not the window. No code change; this is documented in the verification smoke and a `## Potential Challenges` note.

### Serialization — `WindowNode` carries an optional `content: LayoutNode` tree, `panelId` kept for backward-compat

Today a `WindowNode` references one `panelId` ([LayoutSerialization.ts:98-107](../src/typescript/lib/layout/LayoutSerialization.ts#L98)) and `applyWindow` rebuilds a single-panel `Window` ([LayoutSerialization.ts:461](../src/typescript/lib/layout/LayoutSerialization.ts#L461)). A dockable float holds a region *tree*, so:

- **`WindowNode` gains `content?: LayoutNode`** (the float's internal arrangement: splits, tab order, active tab). `panelId` becomes optional (`panelId?: string`) and is retained **only for reading legacy states** — new states always write `content`.
- **`windowNodeFor`** captures the window's content via `nodeFor(windowContentOf(win))` ([LayoutSerialization.ts:174,212](../src/typescript/lib/layout/LayoutSerialization.ts#L174)) into `content`, and **stops** writing `panelId` (or writes it `undefined`). `nodeFor` already produces a `panel` node for a single-frame float and a `split`/`tab` node for a multi-region float — so the single-panel case round-trips through the *same* tree path, just wrapped one level deeper.
- **`applyWindow`** rebuilds the float by `materializeNode(node.content, …)` into the window when `content` is present; for a `panel`-kind content (or a legacy `panelId`-only node), it re-homes the single frame exactly as today. Backward-compat branch: `const contentNode = node.content ?? (node.panelId ? { kind: "panel", panelId: node.panelId, glyph: null } : null)`. If `contentNode` is `null`, skip with a warning (unchanged behaviour).
- **`parkLeaves`** must park *all* leaves in each live float, not just `windowContentOf`'s single child. Today it pushes only `windowContentOf(win)` ([LayoutSerialization.ts:302-308](../src/typescript/lib/layout/LayoutSerialization.ts#L302)); change it to `collectLeaves(content, leaves)` when the content is a region container, else push the bare content. This makes every frame in a multi-region float parkable so its state survives a restore.

This is the one shipped-primitive change beyond `Dock` (flagged in Files-to-Modify and Non-Goals). It is purely additive to the schema: `version` stays `1` because a legacy `panelId`-only `WindowNode` still restores correctly through the fallback branch; no migration is required. New writes are forward-only (an old reader would ignore `content` and fall to `panelId`, which is now absent — but only *this* codebase reads these states, so that's a non-issue and documented).

### Cross-window re-dock already spans windows — confirm, no change

`DockRegion`'s `accepts`/`onDrop` key on `tabDragRegistry` ([DockRegion.ts:91](../src/typescript/lib/layout/DockRegion.ts#L91)) and `DragManager` drop targets, both viewport-global — a tab dragged from the main dock onto a float's region (or vice-versa) is the *same* gesture as an in-dock drop. The float's regions become drop targets because the extended sweep `wireRegion`s them (a `DockRegion` per float region). Re-docking a *whole* bare float back into the main dock still works via the bare-mode Ctrl-drag-header path ([Tab.ts:39](../src/typescript/lib/layout/Tab.ts#L39)) for a single-frame float; for a multi-region float the user drags individual tabs out (each tab is its own drag source once adopted). **One gap:** the `isLegalDrop` self-drop guard walks `this._region`'s ancestor chain for the dragged id ([DockRegion.ts:170-175](../src/typescript/lib/layout/DockRegion.ts#L170)) — across windows the chains are disjoint, so no false rejection; confirmed no change. The cross-window drop is verified by smoke step 5.

### CODE_CONVENTIONS compliance

All new `Dock` methods follow the existing private-method idiom (typed return, JSDoc, single responsibility). Every re-parent uses `moveComponent` ([Dock.ts:166,344,548](../src/typescript/lib/core/Dock.ts#L166)); the adoption `win.moveComponent(region)` / `region.moveComponent(frame)` honour the no-manual-reparent checkpoint. No new DOM property, backing field, `XOptions` styling field, or theme token — these are behavioural extensions, not styled properties. String-discrimination (`isRegionContainer`) over `instanceof` is reused, not re-introduced. The serialization change adds one optional interface field and a fallback branch — no new exported symbol, so no `callable` or barrel work.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/LayoutSerialization.ts — WindowNode gains a content tree

export interface WindowNode {
    kind:        "window";
    /** Legacy single-panel reference. Read on restore for backward-compat; new states write `content`. */
    panelId?:    string;
    /** The float's internal arrangement (a region tree). Present in all newly-serialized states. */
    content?:    LayoutNode;
    header:      string;
    rect:        SerializedRect;
    state:       "normal" | "minimized" | "maximized";
    restoreRect: SerializedRect | null;
}
```

```typescript
// src/typescript/lib/core/Dock.ts — new private surface (no public API change)

class Dock extends Container<DockOptions> {
    // existing public API unchanged: addPanel, getRootRegion, getLayoutState, setLayoutState

    /** Open windows whose content subtree holds one of this dock's frames (excluding the dock's own host window). */
    private ownedFloatWindows(): AbstractWindow[];
    /** Ensures a float window's content is a wired region tree; returns that region. Idempotent. */
    private adoptFloat(win: AbstractWindow): Component;
    /** A window's first non-chrome child, or null. */
    private windowContent(win: AbstractWindow): Component | null;
}
```

`teardownVanished` changes signature to `teardownVanished(root: Component, floatRegions: Component[]): void`; `runSweep` is rewritten to compute the float set once and feed both wiring and teardown. No exported symbol is added or renamed.

---

## Internal Structure

`runSweep` (rewritten):

```
root = getRootRegion(); if !root: return
floats = ownedFloatWindows()
wireRegion(root)
adopted = floats.map(win => adoptFloat(win))   // each returns the float's wired-able content region
for region in adopted: wireRegion(region)
teardownVanished(root, adopted)
```

`teardownVanished(root, floatRegions)`:

```
reachable = new Set()
collectRegions(root, reachable)
for region in floatRegions: collectRegions(region, reachable)
for [region, wiring] in _wiring:
    if !reachable.has(region): wiring.dockRegion.destroy(); _wiring.delete(region)
```

`ownedFloatWindows()`:

```
frames = new Set(this._frames.values())
return AbstractWindow.getOpenWindows().filter(win =>
    !hostsWindowContains(win, this) &&                 // not the dock's own host window
    win.getComponents().some(c => !win.isChromeComponent(c) && subtreeHoldsFrame(c, frames)))
```
where `subtreeHoldsFrame(c, frames)` recurses the content subtree (or, cheaper, walk each frame's ancestor chain to the window — reuse the `hostsComponent` ancestor-walk shape). The host-window guard re-uses the `hostsComponent` ancestor walk against `this`.

`adoptFloat(win)`:

```
content = windowContent(win); if !content: return  (guarded — a freshly shown bare win always has content)
if isRegionContainer(content): return content       // already adopted or restored as a tree
region = newTabRegion()
win.moveComponent(region)                            // fresh region carries no constraint; Border fills it as unplaced→CENTER
region.moveComponent(content)
return region
```

---

## Ordered Implementation Steps

1. **Bare detach for dock tabs.** In [`Dock.wireRegion`](../src/typescript/lib/core/Dock.ts#L465), where the `Tab` branch calls `setReorderable(true)`, also call `(manager as Tab).setDetachWindowMode("bare")` so every dock `Tab` tears off into a plain `Window`. (Single additive line in the existing `tabWired` guard.)
2. **Float enumeration + host-window guard.** Add `ownedFloatWindows()` and a private `windowContent(win)` to `Dock.ts`. Use the `hostsComponent`-style ancestor walk for the membership and host-window-exclusion tests. Import `AbstractWindow` from `~/core/AbstractWindow.js` (already a dependency band).
3. **Adoption.** Add `adoptFloat(win)` per Internal Structure — wrap a bare frame in a `Tab` region once, idempotent for already-adopted/restored trees.
4. **Extend the sweep.** Rewrite `runSweep` to compute `ownedFloatWindows()` once, wire root + each adopted float region, and call the new `teardownVanished(root, adoptedRegions)`. Change `teardownVanished` to seed its reachable set from root **and** every float region.
5. **Serialize the float tree.** In [`LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts): make `WindowNode.panelId` optional and add `content?: LayoutNode`; `windowNodeFor` writes `content: nodeFor(windowContentOf(win))` (drop `panelId` for new states); `applyWindow` materializes `node.content ?? legacy-panelId fallback` into the window; `parkLeaves` parks all leaves of a region-container float (via `collectLeaves`) instead of only `windowContentOf`.
6. **Typecheck:** `npm run typecheck` — zero errors. **No-manual-reparent checkpoint:** `grep -n "addComponent\|removeComponent\|insertComponent" src/typescript/lib/core/Dock.ts` — every new runtime re-parent is `moveComponent`. **No-instanceof checkpoint:** `grep -n "instanceof" src/typescript/lib/core/Dock.ts` — expect zero (string discrimination kept).
7. **Demo.** Extend the `MiscPanel.ts` Dock demo (see Verification) so the tear-off → edge-split-inside-float → re-dock → save/restore loop is exercisable.
8. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Dock.ts` — bare detach mode on wired tabs; `ownedFloatWindows`/`adoptFloat`/`windowContent`; sweep + teardown extended to float regions |
| Modify | `src/typescript/lib/layout/LayoutSerialization.ts` — `WindowNode.content?: LayoutNode` (+ optional `panelId`); float-tree serialize/restore; `parkLeaves` parks all float leaves |
| Modify | `src/typescript/MiscPanel.ts` — extend the Dock demo to exercise the dockable-float loop |
| Modify | `docs/components/Dock.md` + cross-refs (see Documentation Impact) |

No deletions, no new files. One shipped-primitive change (the `WindowNode` schema extension); all `Tab`/`TabWindow`/`Window`/`DockRegion` code is unchanged — the tear-off mechanism reuses the shipped `"bare"` mode and `splitOnEdge`'s window-rooted-container handling as-is.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Checkpoints:** the no-manual-reparent and no-instanceof greps from step 6.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).
- **Manual smoke — Misc-screen Dock demo** (`npm run dev`, http://localhost:8015; scope DevTools to the demo's window per the per-class-scope rule):
  1. **Tear off → plain window, not TabWindow.** Drag a left-group tab off the strip; it opens in an ordinary header `Window` (title bar, no tab strip as the *whole* body). Confirm via DevTools it is a `Window`, not a `TabWindow`.
  2. **Edge-split inside the float.** Tear off a second panel into the same float (or drag a main-dock tab onto the float), then drop a tab on an *edge of the float's pane*; the float's content wraps in a `Split` with two panes — proving the float is a mini-dock, and that adoption + the extended sweep made the float region a drop target.
  3. **Nested split inside the float.** Drop a third panel on an edge of one of the float's just-created panes; it splits again — proving the sweep reaches *dynamically-created* regions inside the float (the teardown live-set keeps them alive).
  4. **Float survives repeated sweeps.** Reorder a tab in the *main* dock (forces a sweep) and confirm the float's drop targets still work afterwards — proving `teardownVanished` no longer destroys float coordinators.
  5. **Re-dock both directions.** Drag a tab from the float back into the main dock (it lands in a reorderable strip); drag a main-dock tab into the float. Both work — cross-window re-dock.
  6. **Save/restore round-trips the float's internal arrangement.** With the float holding a two-pane split, click Save, then rearrange and Restore: the float reappears with its split ratio, tab order, and active tab intact (not collapsed to a single panel). Confirm a legacy single-panel float (or a hand-edited `panelId`-only `WindowNode`) still restores via the fallback branch.
- **Theme toggle:** flip light/dark mid-drag inside a float — drop bands/reorder line recolour from the existing `--ts-ui-drag-*` tokens (no new token).

---

## Documentation Impact

- **No new exported symbol** — `WindowNode.content` is an added optional field on an already-exported interface; `Dock`'s new methods are private. So no barrel change and no new typedoc class page.
- **Curated page:** update [`docs/components/Dock.md`](../docs/components/Dock.md) — the tear-off section now describes a *dockable mini-dock* float (edge-split, arrange, re-dock both ways) rather than a tab-only `TabWindow`; note that float internal arrangements round-trip through save/restore. Touch the serialization page (the `Dock`/layout-serialization doc) where `WindowNode` is described to mention the `content` tree and the legacy `panelId` fallback.
- **Cross-references (markdown links across buckets, per `_shared/docs-conventions.md`):** from the Dock page link to `Window` and the `Tab` `detachWindowMode` doc (explaining bare mode is what makes a float a mini-dock); from the serialization page link back to `Dock`.

---

## Potential Challenges

- **Adoption double-wrap / sweep churn** — re-sweeps must not re-wrap an already-adopted float. Mitigation: `adoptFloat` short-circuits when `windowContent` is already a region container (step 2), so only a bare-frame float is wrapped, once.
- **Float coordinator leak on close** — a closed float drops out of `getOpenWindows()`, so its regions vanish from the live-set and `teardownVanished` destroys their coordinators on the next sweep. But the *frame* lives inside the closed window's subtree and may be destroyed with it — its `_frames` entry then points at a dead frame. Mitigation: this matches today's behaviour for `TabWindow` floats (the dock holds no float registry and relies on the open-windows set); no new leak is introduced because the dock never *retained* float regions in a field — they are re-derived each sweep.
- **`splitOnEdge` with the window as `container`** — for the *first* split of a single-region float, `container` resolves to the `Window`; the wrapper is inserted into the window's CENTER slot and a `Border` fills it as an unplaced (default-CENTER) child. Mitigation: adoption guarantees the window's content is a `Tab`/`Split` region *before* any split, so `splitOnEdge`'s in-region branches handle it and the window-as-container case only ever wraps content, never the window — confirmed by reading [DockRegion.ts:349-372](../src/typescript/lib/layout/DockRegion.ts#L349). Verified by smoke step 2.
- **Park-all-leaves regression risk** — changing `parkLeaves` to walk a float's whole subtree must not double-push a leaf already collected from `root`. Mitigation: floats are disjoint from `root` (separate windows), and the `factory(id) === leaf` park guard ([LayoutSerialization.ts:315](../src/typescript/lib/layout/LayoutSerialization.ts#L315)) already de-dupes by id into a `Map`.
- **Legacy state restore** — an old `panelId`-only `WindowNode` must still restore. Mitigation: `applyWindow`'s `node.content ?? { kind:"panel", panelId }` fallback; covered by smoke step 6.

---

## Critical Files

- [`src/typescript/lib/core/Dock.ts`](../src/typescript/lib/core/Dock.ts) — the sweep (`runSweep`/`wireRegion`/`teardownVanished`/`collectRegions`), `_frames`/`_panels` registry, `isRegionContainer`/`newTabRegion`/`pruneRegion` — every extension lands here.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `detachTabToWindow` (1727), `_detachWindowMode`/`setDetachWindowMode` (290/709), `fillWindowWithStrip` (1778), the `"bare"` path (1755) and `"empty"` emit (1710) the sweep relies on.
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — the *old* tear-off target being replaced (its body-is-a-Tab limitation, 79-90); read to confirm bare mode bypasses it entirely.
- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — `getOpenWindows` (828), `findBodyHost`/`isChromeComponent` (1685/497); `getLayoutConstraints` is inherited from `Component` (4041) — not used by adoption, which relies on the unplaced→CENTER `Border` default.
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `addContent` CENTER placement (236), `isChromeComponent` (246), `Border` layout (67) — the bare float's content host.
- [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) — `splitOnEdge` (325, unit/container/wrap 349-372), `dockAsTab` (520), `newStack`/`ensureStacked` (431/402); read to confirm no change is needed for window-rooted containers.
- [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) — `WindowNode` (98), `nodeFor` (174), `windowContentOf` (212), `windowNodeFor` (223), `parkLeaves` (297), `hostsComponent` (333), `applyWindow` (461), `restoreLayout` (514).
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts#L624) — the Dock demo to extend.
- [`plans/implemented/dock-tab-manager.md`](implemented/dock-tab-manager.md) — the shipped Dock design this builds on (registry, sweep, the two prior shipped-primitive changes).

---

## Non-Goals

- **Nested floats-of-floats** — tearing a tab off a float into a *second* float is out of scope; a float's tabs re-dock into the main dock or another existing float, not into new floats. (A torn-off-from-float tab still opens a plain `Window`, but wiring chains of floats is not designed here.)
- **A `Dock` float registry** — the dock holds no per-float field; owned floats are re-derived each sweep from `getOpenWindows()` + `_frames` membership, matching the shipped no-float-registry decision.
- **Glyph preservation across the float wrap** — the leading-tab glyph constraint is dropped when a bare frame is wrapped in a single-tab float region; the label (frame `getName()`) is kept. Re-stamping the glyph is a cosmetic follow-up, not part of this feature.
- **Schema migration / `version` bump** — the `WindowNode` change is additive and backward-compatible via the `panelId` fallback; no migration pass and no `version: 2`.
- **Cross-OS-window / multi-monitor docking** — floats are in-viewport `Window`s; dragging between separate browser/OS windows is out of scope (inherited from the Dock plan).
- **New `Tab`/`TabWindow`/`Window`/`DockRegion` surface** — the tear-off reuses shipped `"bare"` mode and `splitOnEdge`'s existing window-rooted-container handling; no new mode, factory hook, or callback is added to a primitive (the only shipped change is the additive `WindowNode.content` field). *(Superseded during implementation — see Post-Implementation Deviations.)*

---

## Post-Implementation Deviations

Manual testing surfaced gaps the original design's assumptions missed; the following shipped beyond the plan as written and are recorded here for accuracy.

- **A `Tab` `"detached"` event was added (revises the "no new `Tab` surface" Non-Goal).** The plan assumed the tear-off's `"empty"` emit was a sufficient adoption trigger. It is not: `"empty"` only fires when the tear-off *drains* the source strip, so tearing one tab off a strip that keeps siblings scheduled no sweep and the float was never adopted — it lingered as a bare-frame window. `Tab` now emits `"detached"` (carrying the torn-off window) for every tear-off, and `Dock.wireRegion` subscribes to it with `scheduleSweep`. This is one additive event on the existing exported `TabEvent` union, the minimal surface that makes adoption fire on *every* tear-off.

- **`DockRegion` and `Dock` gained window-lifecycle behaviour (revises the "no `DockRegion` change / cross-window re-dock needs no change" decision).** Three follow-ups, all behavioural (no new public method, option, or callback on a primitive): (1) `DockRegion.onDrop` raises and activates the region's host window on a cross-window dock — mirroring `Tab`'s existing strip-drop raise — so a tab dropped into a backgrounded float surfaces it; (2) `DockRegion` spring-loads the same raise while a tab dwells over the region, gated on `DragManager.isDragging` so a late timer fire after the gesture ends is a no-op; (3) `Dock.pruneRegion` closes a float window when pruning its mini-dock leaves it empty, restoring the close-on-empty contract the strip-mode `TabWindow` had. The "cross-window re-dock spans windows — no change" decision held for the *drop mechanics*; only the window raise/close *affordances* were missing.
