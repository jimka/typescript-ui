---
depends-on:
  - size-constraint-invariant.md
  - component-move-helper.md
  - tab-detach-redock.md
  - edge-drop-to-split.md
  - layout-serialization.md
touches-shared:
  - src/typescript/lib/core/index.ts
  - src/typescript/MiscPanel.ts
---

# Dock / Tab Layout Manager — Implementation Plan

## Overview

The capstone — **plan #5 of 5** — assembles the four foundational primitives into one user-facing component, `Dock`, that lets users freely rearrange panels: drag tabs to reorder, tear panels out to floating [`Window`](../src/typescript/lib/core/Window.ts#L41)s, drop panels on region edges to split, and save/restore the whole arrangement. It is **glue, not new mechanics**: every move goes through [`Component.moveComponent`](component-move-helper.md) (#1), tab drag/tear-off is owned by [`Tab`'s `reorderable` wiring](tab-detach-redock.md) (#2), edge-split-on-drop is owned by [`DockRegion`](edge-drop-to-split.md) (#3), and persistence is owned by [`serializeLayout`/`restoreLayout`](layout-serialization.md) (#4). `Dock` *orchestrates* those across its whole region tree.

`Dock` lives in **`src/typescript/lib/core/Dock.ts`** beside [`Window.ts`](../src/typescript/lib/core/Window.ts), [`Drawer.ts`](../src/typescript/lib/core/Drawer.ts), and [`LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — it is an app-root-level container, not a layout manager, so it belongs in the `core` band (exported from [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts)), not the `layout` band. It is a [`Panel`](../src/typescript/lib/core/Panel.ts) subclass whose single child is the **root region** of a tree of `Split`/`Tab` containers. It owns three things the primitives can't own alone: (1) the **panel registry** (`panelId → Component | factory`) shared with #4's `LayoutFactory`; (2) **DnD lifecycle wiring** — making every `Tab` it creates `reorderable` and wrapping every dockable region in a `DockRegion`, *including regions created on the fly by an edge-split*; and (3) the **public façade** (`addPanel`, `getLayoutState`/`setLayoutState`) that delegates to #4.

The new public surface is `Dock` + `DockOptions` + `DockPanelSpec`. No new theme tokens (the drag affordances are themed by #2/#3). The demo home is [`MiscPanel.ts`](../src/typescript/MiscPanel.ts).

> **Disambiguation:** this is *not* [`plans/launcher-rail.md`](launcher-rail.md). That `Rail` is an edge-anchored launcher *rail* of drawer/window handles (a taskbar). This `Dock` is the VS Code / GoldenLayout-style rearrangeable panel *layout*. They are unrelated components — the rail owns the `Rail` / `--ts-ui-rail-*` namespace, leaving `Dock` and the `dock`/`docking` vocabulary free for this layout.

---

## Architecture Decisions

### Name `Dock`, a `Panel` subclass in the `core` band

`Dock` is free now that the launcher rail is named [`Rail`](launcher-rail.md), so the layout claims the `dock`/`docking` vocabulary that matches its job — panels *dock* into it. `DockLayout` was rejected: it would imply a `LayoutManager` subclass, which this is not — it does not *lay out* children on an axis; it *hosts* a region tree and coordinates DnD/serialization across it. `DockManager` was rejected as redundant once the `Dock`-vs-rail collision disappeared. `Dock` extends `Panel` (not bare `Component`) to inherit the body-host/auto-scroll machinery a top-level app container wants, and it carries a `Fit` layout so its single root-region child fills it. It lives in `core` (not `layout`) because it composes core concerns — `Window` (tear-off targets), `DockRegion` orchestration, serialization — and sits at/near the app root alongside `Window`/`Drawer`, mirroring where [`main.ts:31`](../src/typescript/main.ts#L31) mounts the app's top-level container today.

### The region tree is plain `Panel` containers carrying `Split`/`Tab` managers — `Dock` never invents a new container kind

#3 already establishes the structural vocabulary: a "region" is a `Panel` with a `Split` or `Tab` `layoutManager`, and splitting/wrapping is done by `moveComponent`-ing panels and regions between such containers ([edge-drop-to-split Internal Structure](edge-drop-to-split.md)). `Dock` reuses that verbatim. Its root child is one such region (a `Tab` by default for a single-group start, or a `Split` once the caller defines columns). It does **not** subclass `Split`/`Tab` or add a "DockPanel" container — that would duplicate #3's wrap/extend logic. The only structural code `Dock` owns is the *initial* arrangement build (turn a `DockPanelSpec[]` into the starting region tree) and the *re-wiring sweep* described next; all runtime restructuring is #3's `DockRegion`.

### DnD wiring is applied by a single idempotent sweep over the region tree — this is the hard part

The tricky requirement is that drop targets and reorderable strips must exist on **every** region, including the `Split`/`Tab` containers #3 creates mid-drag during an edge-split or centre-dock. `Dock` solves this with one private method, `wireRegion(region)`, that:

1. If the region's manager is a `Tab`, calls `tab.setReorderable(true)` (#2) so its tabs reorder and tear off, and subscribes the `Tab`'s public `"empty"` event ([Tab.ts:30](../src/typescript/lib/layout/Tab.ts#L30)) to `scheduleSweep()` so a strip emptied by a tear-off/close has its coordinator torn down promptly.
2. Constructs a `DockRegion(region, () => this.scheduleSweep())` (#3) so the region accepts edge/centre drops **and** notifies `Dock` after a drop mutates the tree; stores the coordinator so it can be `destroy()`ed.
3. Recurses into the region's child regions (a `Split` whose panes are themselves `Tab`/`Split` regions).

`wireRegion` is **idempotent and incremental**: it tracks already-wired regions in a `Map<Component, RegionWiring>`, so re-running it only wires *new* regions and `destroy()`s the coordinators of regions no longer reachable from the root.

The **load-bearing** thing the sweep adds is the per-region `DockRegion` **drop target** on every dynamically-created region — #3 does *not* register drop targets on the stacks it builds. Step 1's `setReorderable(true)` + `"empty"` subscription are belt-and-suspenders for those stacks: [`DockRegion.newStack()`](../src/typescript/lib/layout/DockRegion.ts) already creates them `reorderable` and self-prunes on `"empty"`, and the `tabWired` guard keeps `Dock` from re-applying either. They still matter for regions `Dock` builds itself (the `compileLayout` tree and `restoreLayout` output), which are not necessarily `DockRegion`-made.

**The re-wire trigger.** A sweep must follow every structural change, of which there are exactly two sources:

- **`Dock`'s own operations** — the constructor build, `addPanel`, and `setLayoutState` — call `scheduleSweep()` directly.
- **Drag-driven changes** — an edge/centre drop that #3's `DockRegion` turns into a fresh `Split` or tab stack ([DockRegion.splitOnEdge / dockAsTab](../src/typescript/lib/layout/DockRegion.ts)). `DockRegion` performs the mutation internally and shipped with **no** post-mutation hook, so this plan adds **one minimal additive callback** to it — an optional `onStructureChanged` invoked at the end of its `onDrop`, after `splitOnEdge`/`dockAsTab`. `Dock` passes `() => this.scheduleSweep()` when constructing each coordinator. This is the **only** change to a shipped primitive (flagged in Files-to-Modify and Non-Goals); because it fires target-side it covers a panel **re-docked from a torn-off `Window`** (whose drag source lives outside the dock subtree) exactly as well as an in-dock drop.

`scheduleSweep()` sets a dirty flag and coalesces to a single `requestAnimationFrame` that runs `wireRegion(this.getRootRegion())` once and clears the flag — so a burst of moves within one gesture yields exactly one sweep. **It is *not* driven by `Dock.doLayout`.** An earlier draft assumed a descendant `moveComponent` would schedule a layout that "bubbles" to `Dock.doLayout`; that is false — `Component.scheduleLayout` queues *the scheduled node itself* ([Component.ts:4186](../src/typescript/lib/core/Component.ts#L4186)) and `flushPendingLayouts` runs `doLayout` only on scheduled nodes, recursing *downward*, never up to `Dock`.

**Rejected alternative — a global `"dragend"` listener.** `DragManager` fires a *non-bubbling* `"dragend"` CustomEvent on the drag source and calls a per-source `onDragEnd` ([DragManager.ts:623-624](../src/typescript/lib/core/DragManager.ts#L623)); neither is a `Dock`-reachable global hook. A window-capture `Event.addViewportListener(this, "dragend", …)` would observe it (capture reaches the target regardless of `bubbles`), but `baseViewportListener` calls `stopPropagation()` on every matched event and fires for unrelated app-wide drags — risking interference with other `"dragend"` consumers. The target-side `DockRegion` callback is deterministic and local, so it is preferred.

### The root region is derived live, never cached

An edge drop onto the **root** region wraps it in a fresh `Split` ([DockRegion.splitOnEdge](../src/typescript/lib/layout/DockRegion.ts)), making that wrapper `Dock`'s new single child. A cached `_root` field would then point at a now-nested sub-region, so `getRootRegion()` / serialization would capture the wrong subtree. `Dock` therefore derives the root region live as its sole `Fit` child — `getRootRegion() => this.getComponents()[0]` ([Component.ts:4003](../src/typescript/lib/core/Component.ts#L4003)) — and `getLayoutState` / `setLayoutState` / `wireRegion` all read it through that accessor. The constructor guarantees exactly one child (the compiled layout, or a default empty `Panel`+`Tab`).

### Panel registry is the serialization factory — one source of truth

#4 restores leaves through a caller-supplied `LayoutFactory: (panelId) => Component | null`. `Dock` *is* that caller, so it owns a `Map<string, DockPanelSpec>` where a spec carries either a live `Component` or a lazy `() => Component` factory plus the panel's title/glyph. `getLayoutState()` calls `serializeLayout(this.getRootRegion())`; `setLayoutState(state)` calls `restoreLayout(this.getRootRegion(), state, id => this.resolvePanel(id))`. The same registry feeds both the initial build and restore, so there is exactly one `panelId → content` mapping. Panel IDs are the stable strings the caller assigns via `DockPanelSpec.id`; `Dock` stamps each panel's `LayoutConstraints.name` to that id when it adds the panel (the channel #4 reads for `panelIdOf`), so serialization round-trips without the caller wiring constraint names by hand.

### `addPanel` adds to the active region as a tab; it does not invent placement

The simplest honest default: `addPanel(spec)` registers the spec, resolves its `Component`, stamps the constraint name, and `moveComponent`s it into the **active `Tab` region** as a new tab — then re-sweeps so the new region (if the root had to be wrapped in a `Tab`) is wired. The active region is resolved deterministically with no extra tracking state: the root region if it is a `Tab`; otherwise the first `Tab` region found depth-first; if the tree holds no `Tab` region at all, the root is wrapped in a fresh `Tab` first (the one structural build `addPanel` may trigger). A future `setActiveRegion(region)` could let callers steer placement, but the default needs no stored cursor. Where it lands *structurally* after that is the user's business via drag/drop (#2/#3). `Dock` does **not** expose a "split here / dock there" placement API — that is what the edge-drop gesture is *for*, and adding a programmatic placement vocabulary would duplicate #3's structural mutations. Initial multi-region arrangements are expressed declaratively via `DockOptions.layout` (a `DockPanelSpec` tree, below), not via imperative split calls.

### Initial arrangement is a small declarative spec compiled to the region tree

`DockOptions.layout` accepts a lightweight nested spec — either a leaf `{ id, title, glyph?, content }` or a group `{ split: "horizontal"|"vertical", children: [...] }` / `{ tabs: [...] }`. `Dock` compiles it once at construction into `Panel`+`Split`/`Tab` containers (reusing the exact container shapes #3/#4 produce), registers every leaf in the panel registry, and runs the initial `wireRegion` sweep. This is deliberately a *thin* compiler — it is the same node shapes as #4's `LayoutNode`, minus the persisted sizing — so it shares mental model with the serialization schema. It does **not** accept sizes/ratios (those emerge from layout or from a restored `LayoutState`); seeding a specific split ratio is `restoreLayout`'s job. Compiling the spec is the only structural build code unique to this plan.

### Tear-off windows are tracked but not re-parented into the dock tree

#2 already tears a tab off into a `new Window(...)` and re-docks it. `Dock` lets that happen untouched; it only needs the torn-off windows to participate in serialization. Since #4's `serializeLayout` already gathers windows from `AbstractWindow.getOpenWindows()` ([AbstractWindow.ts:760](../src/typescript/lib/core/AbstractWindow.ts#L760)) and records those whose content resolves to a known panel id, `Dock` gets float persistence **for free** as long as torn-off panels keep their constraint `name` (they do — `moveComponent` carries constraints, plan #1). So `Dock` holds **no** separate float registry; it relies on #4's window-plane capture. The one wiring concern: a panel **re-docked** from a window into a dock `Tab` must land in a `reorderable` strip and a `DockRegion` — guaranteed because every dock `Tab`/region was wired by the sweep before the drop could target it.

### CODE_CONVENTIONS compliance

`Dock` follows the options-bag-as-cache idiom (`new Dock({ layout })`), dispatches `applyOptions` after `super()`, and dispatches any `options.listeners` from the **constructor body** (the documented `_listeners`-undefined-during-super trap). It is one DOM element (the `Panel` root) plus its region-tree children — one-element-per-class holds (the children are independent `Panel` regions, not extra elements of `Dock` itself). No new typed *DOM* setter is added — `addPanel`/`getLayoutState`/`setLayoutState` are behavioural methods, not styled properties, so they need no backing field / `XOptions` pair. The one option, `layout`, is build-time-only (consumed in the constructor), so it is read once, not re-applied by a setter. All re-parents go through `moveComponent`; the no-manual-reparent checkpoint applies.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Dock.ts

/** Declarative description of one dockable content panel. */
export interface DockPanelSpec {
    /** Stable id used for the panel registry and serialization (stamped onto the panel's LayoutConstraints.name). */
    id:       string;
    /** Tab label / tear-off window title. */
    title:    string;
    /** Optional handle/tab glyph. */
    glyph?:   string;
    /** The content. A live Component, or a lazy factory built on first resolve / restore. */
    content:  Component | (() => Component);
}

/** A node in the declarative initial arrangement: a leaf panel, a split, or a tab group. */
export type DockLayoutSpec =
    | DockPanelSpec
    | { split: "horizontal" | "vertical"; children: DockLayoutSpec[] }
    | { tabs: DockPanelSpec[] };

export interface DockOptions extends PanelOptions {
    /** Initial arrangement, compiled to the region tree at construction. Omit for an empty dock. */
    layout?: DockLayoutSpec;
}

class Dock extends Panel<DockOptions> {
    constructor(options?: DockOptions, subclassDefaults?: Partial<DockOptions>);

    /** Registers a panel and adds it as a tab in the active region. Re-wires new regions. */
    addPanel(spec: DockPanelSpec): this;

    /** The root region container (a Panel carrying a Split/Tab manager). */
    getRootRegion(): Component;

    /** Captures the current arrangement (delegates to serializeLayout, #4). */
    getLayoutState(): LayoutState;

    /** Restores a captured arrangement, sourcing leaves from the panel registry (delegates to restoreLayout, #4). */
    setLayoutState(state: LayoutState): this;
}
```

`Dock`, `DockOptions`, `DockPanelSpec`, `DockLayoutSpec` are exported from the `core` barrel ([`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts#L38), beside `Drawer`/`Window`). `LayoutState` is imported from the `layout` bucket (#4) for the return/param types — a cross-bucket type import, fine for signatures. `Dock` uses the `callable` export pair (`callable(_Dock)` + `export { DockCallable as Dock }`) like every other headline component, so it constructs as `Dock({...})` and is auto-promoted to `classes/` by the typedoc-callable-plugin.

No new DOM property, backing field, `XOptions` styling field, or theme token.

---

## Internal Structure

Private state:

```typescript
private _panels  = new Map<string, DockPanelSpec>();   // panelId -> spec (the serialization factory source)
private _wiring  = new Map<Component, RegionWiring>();  // region container -> its DnD wiring
private _sweepScheduled = false;                        // rAF coalescing flag for the re-wire sweep
// No cached root: the root region is derived live as this.getComponents()[0]; it is swapped out when the root is edge-split.

interface RegionWiring {
    dockRegion: DockRegion;     // #3 coordinator (destroy() on teardown)
    tabWired:   boolean;        // setReorderable(true) + "empty" subscription applied (Tab regions only)
}
```

`resolvePanel(id)` — the `LayoutFactory` passed to `restoreLayout`: look up `_panels.get(id)`; if its `content` is a function, call it once and cache the built `Component` back into the spec; stamp the constraint name; return it, or `null` (skip) if unknown.

`getRootRegion()` — the live root region: `this.getComponents()[0]` (`Dock`'s single `Fit` child; swapped out when the root is edge-split, so it is never cached).

`wireRegion(region)` (idempotent sweep, recursive):

```
existing = _wiring.get(region)
if !existing:
    dr = new DockRegion(region, () => this.scheduleSweep())   // #3 — edge/centre drop + post-drop notify
    existing = { dockRegion: dr, tabWired: false }
    _wiring.set(region, existing)
manager = region.getLayoutManager()
if isTab(manager) && !existing.tabWired:
    (manager as Tab).setReorderable(true)                     // #2 — reorder + tear-off
    manager.on("empty", () => this.scheduleSweep())           // prompt teardown when this strip empties
    existing.tabWired = true
for child in region.getComponents():
    if isRegionContainer(child): wireRegion(child)            // Split/Tab child = nested region
// teardown: every region in _wiring not reachable from getRootRegion() -> dockRegion.destroy() + delete
```

`isRegionContainer(c)` = `c.getLayoutManager().getClassName().replace(/^_/, "")` is `"Split"` or `"Tab"`, and `isTab(m)` = `m.getClassName().replace(/^_/, "") === "Tab"`. `getClassName()` returns `this.constructor.name` — `"Split"`/`"Tab"` ([BaseObject.ts:44](../src/typescript/lib/core/BaseObject.ts#L44)), never the `_`-prefixed export alias — so the stripped string compare is what matches, with no `instanceof` (avoids an import cycle). This mirrors #4's discrimination in [LayoutSerialization.ts:148](../src/typescript/lib/layout/LayoutSerialization.ts#L148).

`scheduleSweep()` coalesces re-wires to one `requestAnimationFrame`: if `_sweepScheduled` is set it returns; otherwise it sets the flag and schedules a callback that clears it and runs `wireRegion(this.getRootRegion())` once. A whole gesture (a drop that splits, prunes an emptied stack, and fires several `moveComponent`s) collapses to a single sweep. It does **not** override or depend on `Dock.doLayout`.

`compileLayout(spec)` (construction only) → returns a region `Component`:

```
leaf:           register spec in _panels; build content; stamp constraint name; return content
{ tabs }:       new Panel({ layoutManager: new Tab() }); for each leaf -> compileLayout -> addComponent; return panel
{ split,children }: new Panel({ layoutManager: new Split({ direction: split }) });
                for each child -> compileLayout -> addComponent; return panel
```

Constructor: build the root region from `options.layout` (or a default empty `Panel` + `Tab`), `addComponent(root)` under `Dock`'s `Fit`, then `scheduleSweep()` for the initial wire.

`getLayoutState()` = `serializeLayout(this.getRootRegion())`. `setLayoutState(state)` = `restoreLayout(this.getRootRegion(), state, id => this.resolvePanel(id))` then `scheduleSweep()` (restore creates fresh `Split`/`Tab` regions that must be wired).

---

## Ordered Implementation Steps

1. **Add the `DockRegion` post-drop callback.** In [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts), add an optional `onStructureChanged?: () => void` constructor parameter and invoke it at the end of `onDrop`, after `splitOnEdge`/`dockAsTab` complete (a ~2-line additive change; existing callers pass nothing and are unaffected). This is the trigger `Dock` subscribes to for drag-driven re-wires.
2. **Create `src/typescript/lib/core/Dock.ts`.** `Panel` subclass with `Fit` layout, `callable` export pair (mirror `Drawer.ts`'s export form). Add `DockPanelSpec`, `DockLayoutSpec`, `DockOptions`. Implement private state, `resolvePanel`, `isRegionContainer`, `compileLayout`, `wireRegion`, `scheduleSweep`, and the constructor (compile `layout`, add root, initial sweep). Dispatch `options.listeners` (if any) from the constructor body.
3. **Implement the public façade:** `addPanel` (register + stamp + `moveComponent` into active `Tab` region + `scheduleSweep`), `getRootRegion`, `getLayoutState` (→ `serializeLayout`), `setLayoutState` (→ `restoreLayout` + `scheduleSweep`). Every re-parent uses `moveComponent` (#1).
4. **Barrel export.** Add `Dock` + `DockOptions`, `DockPanelSpec`, `DockLayoutSpec` to [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) beside the Drawer/Window entries.
5. **Typecheck:** `npm run typecheck` — zero errors. **No-manual-reparent checkpoint:** `grep -n "addComponent\|removeComponent\|insertComponent" src/typescript/lib/core/Dock.ts` — every runtime re-parent is `moveComponent`; `addComponent` is acceptable only inside `compileLayout`/constructor (building fresh containers whose children have no parent yet). **No-instanceof checkpoint:** `grep -n "instanceof Split\|instanceof Tab" src/typescript/lib/core/Dock.ts` — expect zero (string discrimination).
6. **Demo screen.** Add a `Dock` demo to [`MiscPanel.ts`](../src/typescript/MiscPanel.ts) (see Verification) exercising the full capstone loop.
7. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/Dock.ts` — the capstone component (registry, region-wiring sweep, façade) |
| Modify | `src/typescript/lib/layout/DockRegion.ts` — add the additive `onStructureChanged?` post-drop callback (#3) |
| Modify | `src/typescript/lib/core/index.ts` — export `Dock` + types |
| Modify | `src/typescript/MiscPanel.ts` — capstone demo |
| Create | `docs/components/Dock.md` + catalog/sidebar entries (see Documentation Impact) |

No deletions. The sole shipped-primitive change is the additive `DockRegion.onStructureChanged` callback above; no `Tab`/`Split`/`Window`/`DragManager` changes — all other needed surface is added by #1–#4.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Checkpoints:** the no-manual-reparent and no-instanceof greps from step 5.
- **Demo screen — the capstone loop** (a new "Dock" button/area in `MiscPanel.ts`, or a dedicated demo panel): build a `Dock` with an initial `layout` of a horizontal split — left a `tabs` group of two panels, right one panel. Then verify, manually (`npm run dev`, http://localhost:8015):
  1. **Reorder:** drag a tab in the left group; it reorders and stays selected (#2 working inside the dock).
  2. **Tear-off:** drag a left tab off the strip; it opens in a floating `Window` (#2); the source strip selects a neighbour.
  3. **Edge-split:** drag a tab onto the **right** edge of the right panel; the right region wraps in a `Split` with the dropped panel as a new pane (#3); confirm the *newly created* `Split`/`Tab` regions are themselves dockable (drop a third panel on an edge of the just-created pane — proves the re-wire sweep reaches dynamically-created regions).
  4. **Center-as-tab:** drop a panel on a region center; it docks as a tab (#3 → #2 dock path).
  5. **Re-dock from window:** drag the torn-off window's content back onto a dock strip; it docks into a `reorderable` strip (proves re-docked panels land in wired regions).
  6. **Save:** click a "Save layout" button → `JSON.stringify(dock.getLayoutState())`; confirm it captures the splits, tab order/active index, and the floating window (#4 window plane).
  7. **Restore:** reload / reset the dock, click "Restore" with the saved JSON → `dock.setLayoutState(state)`; the arrangement (proportions, tab order, active tab, floating window) comes back, and all restored regions are dockable again (the post-restore sweep ran).
- **Theme toggle:** flip light/dark mid-drag — the drop-zone bands and reorder line recolour from #2/#3's existing `--ts-ui-drag-*` tokens (Dock adds none).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbols:** `Dock`, `DockOptions`, `DockPanelSpec`, `DockLayoutSpec` — exported from the per-subpath `core` barrel ([`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts); there is no root barrel). Add `@category Core`. Verify `Dock` lands under `docs/api/core/classes/` after build (the `callable` export form is what the typedoc-callable-plugin promotes — mirror `Drawer`'s export exactly).
- **Curated page:** add `docs/components/Dock.md` covering the declarative `layout` spec, `addPanel`, the four composed behaviours (reorder, tear-off, edge-split, save/restore), and the panel-id/factory contract. Add it to the `docs/components/` catalog `index.md` and to the **Core** group in the sidebar in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) (beside `Window`/`Dialog`/`Drawer` at config lines 59/61/62).
- **Cross-references (markdown links across buckets, not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md)):** the Dock page links to `Window`, `Drawer`, the `Tab` and `Split` layout pages (`/layouts/Tab`, `/layouts/Split`), and the #4 serialization page; conversely add a "see also Dock" line to the `Tab`, `Split`, `Window`, and #3 `DockRegion` pages so the assembly is discoverable from each primitive.
- **Recipe (optional but apt):** a `docs/recipes/dockable-layout.md` walking the save/restore loop would slot beside the existing `recipes/drag-and-drop.md`; add to the recipes sidebar + `recipes/index.md` if created. Not required for the API to be documented.

---

## Potential Challenges

- **Wiring dynamically-created regions** (the headline risk) — #3 creates `Split`/`Tab` containers mid-drag that `Dock` did not build, so they are unwired until the next sweep. Mitigation: the additive `DockRegion.onStructureChanged` callback fires `scheduleSweep()` after every drop, running the idempotent `wireRegion(getRootRegion())` on the next animation frame; verified by demo step 3. (The earlier `doLayout`-bubbling trigger was dropped — `scheduleLayout` queues only the scheduled node, never `Dock`.)
- **Double-wiring / listener stacking** — re-running the sweep must not stack a second `DockRegion` or re-call `setReorderable(true)` on a region. Mitigation: the `_wiring` map's idempotence guard (skip already-wired regions; `tabWired` flag).
- **Stale coordinators after a region is destroyed** (e.g. a `Split` flattened away when a pane empties) — leaked `DockRegion`s keep drop targets registered on dead elements. Mitigation: the teardown half of the sweep `destroy()`s wiring for regions no longer reachable from `getRootRegion()`.
- **Restore re-home order** — #4 clears/repopulates regions; the post-`setLayoutState` sweep must run *after* restore finishes mutating the tree. Mitigation: `scheduleSweep()` defers to the next layout frame, after `restoreLayout`'s synchronous work and its scheduled layouts.
- **Lazy panel content built twice** — `resolvePanel` and `addPanel`/`compileLayout` could each invoke a `() => Component` factory. Mitigation: `resolvePanel` caches the built `Component` back into the spec (`content` becomes the instance after first build), so every id resolves to one instance.
- **`moveComponent` resets CSS transitions** on the moved subtree (documented plan #1 behaviour). Acceptable for a dock — panels snap into place; not re-litigated here.
- **Leaf content that exposes its own `Split`/`Tab` root manager** would be misclassified as a region by `isRegionContainer` (it discriminates on the manager kind, like #4's `managerKind`), so the sweep would wrap it in a `DockRegion`. Mitigation: dock leaf content must not present a `Split`/`Tab` as its *own* root layout manager — wrap such content in a plain `Panel`; this is the same assumption #4's serialization already relies on, so no new constraint is introduced.
- **Float persistence depends on constraint names surviving tear-off** — #4 captures windows whose content resolves to a known panel id via the constraint `name`. Mitigation: `addPanel`/`compileLayout` stamp the name at registration, and `moveComponent` carries constraints, so a torn-off panel keeps its id; verified by demo steps 2/6.

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `Dock`'s superclass (`PanelOptions`, body-host/`Fit` machinery).
- [`src/typescript/lib/core/Drawer.ts`](../src/typescript/lib/core/Drawer.ts) — the headline-component idiom to mirror: options-bag-as-cache, `applyOptions` after `super`, constructor-body listener dispatch, `callable` export pair.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `moveComponent` (3912, #1), `getComponents` (4003), `getLayoutManager` (4075), `getLayoutConstraints`/`setLayoutConstraints` (4028/4044), `getClassName` discrimination, `doLayout`/`scheduleLayout` (4160/4186) — note `scheduleLayout` queues the node itself, not `Dock`, which is why the sweep is callback-driven rather than `doLayout`-driven.
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts#L38) — the `core` barrel; new exports beside Drawer/Window.
- [`src/typescript/main.ts`](../src/typescript/main.ts#L31) — how the app root composes a top-level container today (where a `Dock` would sit in a real app).
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — demo home (Drawer/Window demo blocks to mirror; `setLayoutManager(new HBox)` at 152).
- [`plans/component-move-helper.md`](component-move-helper.md) — `moveComponent` (every re-parent + the both-ends-schedule-layout guarantee the sweep relies on).
- [`plans/tab-detach-redock.md`](tab-detach-redock.md) — `Tab.setReorderable` ([Tab.ts:659](../src/typescript/lib/layout/Tab.ts#L659)), the `Tab` `"empty"` event, the tear-off `Window` path. (`TabDragData` / `tabDragRegistry` live in [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts), re-exported via the layout barrel — used by #3, not `Dock` directly.)
- [`plans/edge-drop-to-split.md`](edge-drop-to-split.md) + [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) — `DockRegion(region)` / `destroy()`, the wrap-vs-extend mutation, the self-pruning `newStack()`/`pruneEmptyStack`; this plan adds the `onStructureChanged?` callback here.
- [`plans/layout-serialization.md`](layout-serialization.md) — `serializeLayout`/`restoreLayout`, `LayoutState`, `LayoutFactory`, the window-plane capture via [`AbstractWindow.getOpenWindows`](../src/typescript/lib/core/AbstractWindow.ts#L760).
- [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) — Core sidebar group (lines 56–67; `Window`/`Dialog`/`Drawer` at 59/61/62).

---

## Architecture Decisions — Phase Order (reference)

The five plans land in dependency order; `Dock` is last because it calls all four:

```
size-constraint-invariant.md            (blocking prerequisite — sane min ≤ preferred ≤ max)
  └─> #1 component-move-helper.md        (the moveComponent primitive)
        ├─> #2 tab-detach-redock.md   ─┐  (#2 and #4 are independent of each other;
        └─> #4 layout-serialization.md      ─┤   can land in parallel after #1)
              #2 ─> #3 edge-drop-to-split.md │  (#3 needs #1 + #2's TabDragData + #4 size accessors)
                          └──────────────────┴─> #5 dock-tab-manager.md  (THIS — composes all four)
```

[`plans/size-constraint-invariant.md`](size-constraint-invariant.md) is a **blocking prerequisite for the whole chain**, not re-planned here: edge-splits and restores create fresh `Split`/`Tab` geometry whose `min ≤ preferred ≤ max` is exercised for the first time, and an unfixed cross-axis clamp would place new panes sub-min. This plan inherits that dependency transitively through #1/#3/#4.

---

## Non-Goals

- **Re-planning any primitive** — `moveComponent` (#1), tab reorder/tear-off (#2), edge-drop-split + `DropZoneOverlay` + `Split.setPaneSize` (#3), and `serializeLayout`/`restoreLayout` (#4) are *consumed*, never reimplemented. `Dock` adds only the registry, the wiring sweep, the spec compiler, and the façade.
- **A programmatic "split here / dock there" placement API** — structural placement is the user's drag/drop gesture (#3); the only declarative placement is the build-time `layout` spec and `restoreLayout`.
- **A new container/region class or a `Split`/`Tab` subclass** — regions are plain `Panel` + `Split`/`Tab`, exactly as #3/#4 already define them.
- **Multi-monitor / cross-window docking** — tear-off `Window`s are floats captured by #4's window plane; dragging a panel from one browser window into another OS window is out of scope.
- **Collapsible / pinnable regions, custom per-region drop policies, region headers/toolbars** — the dock arranges and persists; richer per-region chrome is deferred.
- **Auto-persistence (localStorage / server), debounced auto-save, schema migration** — `getLayoutState`/`setLayoutState` return/accept a plain `LayoutState`; transport is the app's concern (#4 Non-Goal, inherited).
- **Flattening redundant nested `Split`s** after repeated perpendicular edge drops — correct nesting is kept (#3 Non-Goal); any normalisation pass is future work, not this capstone.
- **Migrating `DockRegion`'s prune+collapse routine into `Dock.wireRegion`** — [`prune-degenerate-dock-containers.md`](implemented/prune-degenerate-dock-containers.md) names `Dock.wireRegion` as the *formal long-term home* for the empty-stack prune / single-pane-`Split` collapse and flags the move as "#5's concern." This capstone deliberately **declines** that migration: it leaves the prune where it already works ([`DockRegion.newStack()`](../src/typescript/lib/layout/DockRegion.ts) self-subscribing `"empty"`→prune) and only adds its own `"empty"`→`scheduleSweep()` subscription for stale-coordinator teardown. The two are independent (DockRegion prunes the stack it minted; `Dock` tears down the vanished region's coordinator), so nothing double-prunes and nothing is missed. Hoisting the routine up to `Dock` is left out to keep the capstone minimal glue.
- **New theme tokens** — all drag affordances reuse #2/#3's `--ts-ui-drag-*` family.
- **A floating-window manager beyond what `Window` + #4 provide** — `Dock` holds no float registry; it leans on `AbstractWindow.getOpenWindows()` (#4).
```
