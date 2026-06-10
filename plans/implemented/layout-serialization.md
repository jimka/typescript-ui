---
depends-on:
  - size-constraint-invariant.md
  - component-move-helper.md
touches-shared:
  - src/typescript/lib/layout/Split.ts
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/core/Window.ts
---

# Layout Serialization / Restoration — Implementation Plan

## Overview

The framework builds UIs **imperatively** — components are constructed in code and wired together by hand ([main.ts:31](../src/typescript/main.ts#L31) builds the app's top-level `Tab` with a series of `addLazyTab` calls). There is no declarative component tree and no generic way to reconstruct an arbitrary `Component` subclass from data. This plan therefore does **not** serialize the component tree. It serializes only the **arrangement / topology** of the recognised container managers — `Split` pane ratios, `Tab` order + active index, `Window` rects + state — keyed by stable, caller-assigned **panel IDs**, and restores that arrangement against a caller-supplied **factory** that owns content construction.

The public surface is two free functions, `serializeLayout(root): LayoutState` and `restoreLayout(root, state, factory)`, plus the `LayoutState` schema interfaces, living in a new module [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) (exported from the `layout` barrel beside `Split`/`Tab`). It walks a live tree via the existing `Component`/`LayoutManager` accessors ([`getComponents`](../src/typescript/lib/core/Component.ts#L3913), [`getLayoutManager`](../src/typescript/lib/core/Component.ts#L3971), [`getLayoutConstraints`](../src/typescript/lib/core/Component.ts#L3924)), discriminating container kind by [`getClassName`](../src/typescript/lib/core/BaseObject.ts#L44) (which reports the callable alias `_Split` / `_Tab`).

**Runtime layout-switching is a first-class use case, not a one-shot restore.** A caller holds an **array** of `LayoutState` objects (named workspaces, user presets, a "reset to default") and calls `restoreLayout` with any of them at any point in the app's life — not just once against a fresh tree at startup. Full topology *and* geometry can differ between two saved layouts: a given panel may be tabbed in layout A, a split pane in layout B, and floating in a `Window` in layout C. `restoreLayout` must therefore be **safely callable repeatedly on a live, already-arranged tree**, switching arrangement without losing the panels' own state. This requirement shapes the restore model (see *Restore is a single-pass reconcile-with-teardown* below).

This is **plan #4 of 5** for a dock/tab manager. Plan #5 (the dock manager) calls this API; plan #1 ([`plans/component-move-helper.md`](component-move-helper.md)) supplies [`moveComponent(child, index?, constraints?)`](component-move-helper.md) which `restoreLayout` uses to re-home parked panels into the freshly-built container tree. It is independent of the DnD plans (#2/#3).

To read and write the managers' private arrangement state without breaching encapsulation, this plan adds **narrow public accessors** to `Split`, `Tab`, and `Window` (enumerated below) rather than reaching into `_sizes` / `_tabs` / `_restoreRect` from the serializer. The serializer is a pure consumer of those accessors.

---

## Architecture Decisions

### Serialize topology + sizing keyed by panel ID; the caller owns content via a factory

The naive "serialize the whole tree, reconstruct from JSON" model is impossible here: a leaf panel is an arbitrary `Component` subclass (`MiscPanel`, `TablePanel`, …) built imperatively with constructor args and post-construction wiring the framework cannot recover from data. So the serialized form captures **structure and geometry only** — the shape of the container nesting, split ratios, tab order/active index, window rects — with each **leaf** recorded as a bare `{ kind: "panel", panelId }` reference. On restore, the caller supplies a `LayoutFactory` mapping each `panelId` to a `Component`. The library reconstructs the *containers* (`Split`/`Tab`/`Window` arrangements) and asks the factory for each leaf's content. This is the only model that fits an imperative framework, and it cleanly separates **arrangement** (library-owned, serializable) from **content** (caller-owned, code-built).

**Panel identity is caller-assigned, not the auto-generated `getId()`.** `Component.getId()` returns a per-instance UUID that changes every run, so it cannot key persisted state across reloads. The contract is: a panel that participates in serialization carries a **stable string ID** the caller chose. We do **not** add a new identity field to `Component` — instead the panel's serialization ID is read from its layout constraint **`name`** (already used by `Tab` for the tab label, see [Tab.ts:1788](../src/typescript/lib/layout/Tab.ts#L1788)) when present, falling back to `getId()` only as a last resort (with a one-time `console.warn`, because a UUID won't round-trip). The factory is keyed by the same string. This reuses the existing `LayoutConstraints.name` channel rather than minting a parallel ID concept.

### Discriminate container kind by `getClassName()`, with a graceful "opaque" fallback

The serializer walks the tree and, at each container, inspects `getLayoutManager().getClassName()`. `Split` → `"_Split"`, `Tab` → `"_Tab"` (the callable alias; strip the leading `_` to compare, exactly as [setLayoutManager](../src/typescript/lib/core/Component.ts#L3980) already does for the `data-layout` attribute). A `Window` is recognised by `getClassName() === "_Window"` on the *component* (Window is a `Panel` subclass, not a layout manager). Any container whose manager is **not** one of the recognised arrangement managers (`Border`, `HBox`, `VBox`, `Fit`, `Accordion`, `Grid`, …) is treated as an **opaque leaf**: the walk does not descend into it, and it is recorded as a single `panel` node keyed by its own constraint name/ID. This keeps scope tight — only `Split`/`Tab`/`Window` topologies are captured; everything else is an atomic content panel from the layout's point of view. Recognising the manager by class name (a string) avoids importing `Split`/`Tab` into the serializer purely for `instanceof`, which would create a layout-bucket import cycle risk; the string compare is sufficient and matches the framework's own precedent.

### Two free functions in a new `layout` module, not methods on `Component`

`serializeLayout` / `restoreLayout` are cross-cutting traversal utilities that read several managers' state; they are not the responsibility of any one container. They live in `src/typescript/lib/layout/LayoutSerialization.ts` as exported functions taking the root `Component` explicitly. This is the `layout` bucket because the captured concepts (`Split`, `Tab`) are layout managers; `Window` is core but is consumed here as a recognised node type, not owned. The module imports `Component`, `Split`, `Tab`, `Window` for the accessor calls and `instanceof`-free class-name discrimination.

**A `serialize()` / `deserialize()` method pair on `Component` was considered and rejected**, for four reasons:

- **(a) Arrangement state lives on the `LayoutManager`, not the `Component`.** `Split._sizes`, `Tab._selectedTabIndex`, etc. are the manager's state. A `Component.serialize()` would just turn around and ask `getLayoutManager()` for it — relocating the ask-don't-tell coupling rather than removing it. The free function asks the managers directly, through the narrow accessors.
- **(b) `deserialize` cannot be a symmetric instance method.** At restore time the components don't exist yet — the **factory** constructs them. There is no live instance to call `instance.deserialize(node)` on. Restoration is inherently a *top-down construction-against-data* operation (read a node, build/obtain the container, populate it), not a method dispatched on an already-built object.
- **(c) Leaf content is deliberately opaque / factory-built**, so there is nothing to assemble bottom-up. A bottom-up `serialize()` that recursed into children would try to descend *into* opaque leaves; the walk instead records topology **top-down** and **stops at the first opaque boundary**, which a free walker expresses naturally and an instance method fights against.
- **(d) Tree-level restructuring spans many containers and managers.** Park-and-rebuild (below) tears down and rebuilds the whole container tree under `root` and re-homes leaves across it. That coordination is not the business of any single object; it belongs in a **coordinator function**.

**Deferred option (explicitly not adopted now):** the one wart is the string-based `getClassName()` kind-discrimination. If that is ever judged worth removing, the honest refactor is a **virtual `serializeArrangement()` on `LayoutManager`** — `Split` and `Tab` override it to emit their node, the base returns an opaque-leaf marker — replacing the central `switch` with polymorphism. This is recorded as a deferred alternative and **not** adopted here: with only three recognised kinds plus an opaque fallback, the central switch keeps the whole schema visible in **one place** and is simpler to read and evolve than spreading node-emission across the manager class hierarchy. Revisit only if the recognised-kind count grows substantially.

### Runtime layout-switching is a first-class use case

`restoreLayout` is not a startup-only "rehydrate a fresh app" call. The intended consumer (plan #5) keeps several `LayoutState` objects in memory and lets the user switch between them live — e.g. a "Coding" workspace, a "Debugging" workspace, a "Reset" default. Each switch may change the **full topology** (a panel that was a tab becomes a split pane, or floats out into a `Window`) as well as the geometry. Two consequences drive the design:

- `restoreLayout(root, stateA, factory)` followed later by `restoreLayout(root, stateB, factory)` must both succeed and leave the tree in *exactly* the arrangement the target state describes — `stateB` must not be polluted by `stateA`'s leftover containers.
- A panel's own internal state (scroll offset, form values, table column widths, selection) must **survive** the switch. The panel is the expensive, stateful thing; the arrangement around it is cheap. This is why restore *parks* leaves rather than destroying them (next decision), and why the factory must hand back the **same instance** per ID (the stable-instance contract, below).

### Restore is a single-pass reconcile-with-teardown using park-and-rebuild

`restoreLayout(root, state, factory)` performs **one synchronous pass** that ends in a single layout flush. It does **not** diff the live arrangement against the target and patch the difference; it does **not** attempt to match and reuse existing containers. Instead it uses a **park-and-rebuild** model whose key insight is an **asymmetry**: leaf panels are the stateful, expensive things, while `Split`/`Tab` are cheap, stateless arrangement managers. So:

1. **Park the leaves.** Walk the live tree (and open windows) and **detach every factory-known leaf panel**, holding references to them. **Never destroy them** — they hold scroll/form/table/selection state that must survive the switch.
2. **Tear down all containers.** Remove every `Split`/`Tab` (and their windows) under `root`. These are cheap, stateless arrangement managers; throwing them away costs nothing of value.
3. **Build the target container tree fresh from the `LayoutState`.** Construct new `Split`/`Tab` containers (and `Window`s) matching the recorded topology exactly.
4. **Re-home the parked leaves** into the freshly-built tree via [`moveComponent`](component-move-helper.md) (plan #1), at the recorded indices.
5. **Apply geometry** — `applyPaneRatios` / `setActiveTabIndex` / `applyRect` + `setWindowState` — per container, then flush layout **once**.

Rationale: rebuilding the containers wholesale **sidesteps all diff/patch matching heuristics**. There is no "is this the same Split? does it need a child added/removed/reordered?" logic to get wrong. Each switch starts from a **clean container slate**, which makes A→B→A switching **correct-by-construction**: returning to A rebuilds A's containers from A's state with no residue from B. Structure-then-geometry survives only as the **internal per-container ordering** — e.g. populate a `Split`'s children, *then* call `applyPaneRatios` — not as two public entry points and not as two tree passes. A separate geometry-only "apply arrangement" public entry point was considered and **rejected as redundant** once topology can change between layouts: if the container tree must be rebuilt anyway, there is no live arrangement for a geometry-only call to attach to.

Performance is explicitly **not** a concern here (see *Non-Goals*): restore runs behind a loading screen as a discrete user action, not on a hot path.

### Add narrow public accessors to the managers; do not reach into privates

The serializer must read `Split._sizes` / `_direction` / `_collapsed`, `Tab`'s order + `_selectedTabIndex`, and `Window`'s rect + state, and on restore write them back. Rather than friend-access privates, each manager gains a **small, typed, public** read/apply pair scoped exactly to serialization:

- `Split`: `getPaneRatios(): number[]` (stored sizes **normalised to sum 1.0**, in child order — ratios survive viewport differences across reload) and `applyPaneRatios(ratios: number[]): this` (writes `_sizes` against the current children by index, then `scheduleLayout`). Direction is already public via [`getDirection`](../src/typescript/lib/layout/Split.ts#L258)/[`setDirection`](../src/typescript/lib/layout/Split.ts#L267). Collapsed state reuses the existing public [`isPaneCollapsed`](../src/typescript/lib/layout/Split.ts#L110) and a new non-animating `setPaneCollapsedImmediate(index, collapsed)` (the existing [`setPaneCollapsed`](../src/typescript/lib/layout/Split.ts#L214) animates, which is wrong for a bulk restore — see Potential Challenges).
- `Tab`: `getActiveTabIndex(): number` + the existing selection setter generalised to a public `setActiveTabIndex(index: number): this`. Tab **order** is the child order in `container.getComponents()` (the toolbar mirrors it), so order is captured from the container walk, not a Tab accessor; restore re-homes children into the recorded order via `moveComponent`.
- `Window`: `getRect(): { x; y; width; height }` (public form of the private [`currentRect`](../src/typescript/lib/core/Window.ts#L1371)) and `applyRect(rect): this`. State is already public via [`getWindowState`](../src/typescript/lib/core/Window.ts#L643)/[`setWindowState`](../src/typescript/lib/core/Window.ts#L662). The minimized/maximized **restore rect** (`_restoreRect`) is captured via a new `getRestoreRect(): WindowRect | null`. **No `setRestoreRect` is added:** `setWindowState` already re-caches `currentRect()` as `_restoreRect` when leaving the normal state ([Window.ts:691/705](../src/typescript/lib/core/Window.ts#L691)), so a seeded value would be clobbered. Restore instead applies the *normal* geometry first (from `restoreRect` when the saved state isn't normal) and lets `setWindowState` re-cache it — see *Internal Structure*. The window **title** is captured via the already-public `getHeader().getText()` and replayed through `new Window(header)`; it is recorded on `WindowNode.header`.

Each accessor is the minimum needed; none exposes the internal `Map`/array references.

### Sizes are stored as **ratios**, not pixels

`Split._sizes` holds absolute px that the manager rescales on every viewport resize ([recalculateSizes](../src/typescript/lib/layout/Split.ts#L789) multiplies by `available / _lastAvailableMain`). Persisting absolute px would restore wrong proportions whenever the window is a different size on reload. `getPaneRatios` therefore divides each stored size by their sum; `applyPaneRatios` multiplies the ratios by the **current** available main-axis extent. Because `Split` is ratio-invariant, the first `doLayout` after restore lands the panes at the recorded proportions regardless of viewport size. Window rects stay **absolute px** (a window's position is meaningful in pixels and there is no proportional contract for it); restore clamps them to the viewport via the window's existing `constrainToViewport` machinery.

### `Window` nodes are top-level only

Windows are mounted on `document.documentElement`, not inside the `root` subtree ([Window.ts](../src/typescript/lib/core/Window.ts) appends itself to the document). So `serializeLayout` collects open windows from `Window`'s existing `static openWindows` set (exposed via a new `Window.getOpenWindows(): Window[]`), filtered to those whose content panel resolves to a known panel ID, and records them as a sibling `windows: WindowNode[]` array on the root `LayoutState`, not as children of the tree. `restoreLayout` parks each window's content panel during teardown, closes the live windows, then reconstructs each recorded window via the factory-built (same-instance) content panel placed in a fresh `Window`, and applies rect/state. This keeps the window plane orthogonal to the in-`root` container tree, matching how the framework actually mounts windows.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/LayoutSerialization.ts

/** Serializable rectangle for a Window node. */
export interface SerializedRect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/** A recognised arrangement node, or an opaque content leaf. */
export type LayoutNode = PanelNode | SplitNode | TabNode;

/** Leaf: a single content panel, keyed by its stable panel ID. */
export interface PanelNode {
    kind:    "panel";
    panelId: string;
}

/** A Split container: direction plus per-pane ratios (sum 1.0) and collapsed flags. */
export interface SplitNode {
    kind:      "split";
    direction: "horizontal" | "vertical";
    /** Child arrangement nodes, in pane order. */
    children:  LayoutNode[];
    /** One ratio per child, in the same order; sums to ~1.0. */
    ratios:    number[];
    /** One collapsed flag per child, in the same order. */
    collapsed: boolean[];
}

/** A Tab container: ordered child nodes plus the active index. */
export interface TabNode {
    kind:        "tab";
    /** Child arrangement nodes, in tab order. */
    children:    LayoutNode[];
    /** Zero-based index of the active tab. */
    activeIndex: number;
}

/** A floating Window referencing one content panel. */
export interface WindowNode {
    kind:        "window";
    panelId:     string;
    /** Title-bar text — captured so the restored Window reproduces its title. */
    header:      string;
    rect:        SerializedRect;
    state:       "normal" | "minimized" | "maximized";
    /** Normal-state geometry to restore to when un-minimizing; null when not minimized. */
    restoreRect: SerializedRect | null;
}

/** Top-level captured layout: the in-root tree plus the orthogonal window plane. */
export interface LayoutState {
    /** Schema version for forward-compatible migration. */
    version: 1;
    /** The arrangement rooted at the serialized container. */
    root:    LayoutNode;
    /** Floating windows, captured separately from the root subtree. */
    windows: WindowNode[];
}

/**
 * Resolves a stable panel ID to the Component that supplies its content.
 *
 * **Contract:** the factory MUST return the **same Component instance** for a
 * given `panelId` on every call. Restoration parks and re-homes the live panel
 * rather than rebuilding it, so panel state (scroll, form values, table column
 * widths, selection) only survives a runtime layout switch when the factory
 * hands back the identical instance. Returning a fresh instance per call
 * discards that state and makes parking pointless. Return `null` for an ID the
 * caller no longer provides — that leaf is skipped (see `restoreLayout`).
 */
export type LayoutFactory = (panelId: string) => Component | null;

/** Captures the arrangement of `root` (and open windows) to a plain object. */
export function serializeLayout(root: Component): LayoutState;

/**
 * Restores a previously captured `state` onto `root`, sourcing leaves from
 * `factory`. Safe to call repeatedly on a live, already-arranged tree to switch
 * between saved layouts at runtime; parks existing leaves, tears down and
 * rebuilds the container tree, then re-homes the leaves and applies geometry.
 */
export function restoreLayout(root: Component, state: LayoutState, factory: LayoutFactory): void;
```

```typescript
// Additive accessors — src/typescript/lib/layout/Split.ts
class Split extends LayoutManager {
    getPaneRatios(): number[];                                  // _sizes normalised to sum 1.0, child order
    applyPaneRatios(ratios: number[]): this;                   // write _sizes against current children, scheduleLayout
    setPaneCollapsedImmediate(index: number, collapsed: boolean): this; // non-animating collapse for bulk restore
    // getDirection / setDirection / isPaneCollapsed already public
}
```

```typescript
// Additive accessors — src/typescript/lib/layout/Tab.ts
class Tab extends LayoutManager {
    getActiveTabIndex(): number;            // returns _selectedTabIndex
    setActiveTabIndex(index: number): this; // clamps, syncs button group + roving index, scheduleLayout
}
```

```typescript
// Additive accessors — src/typescript/lib/core/Window.ts
class Window extends Panel<WindowOptions> {
    static getOpenWindows(): Window[];                  // snapshot of the private openWindows set
    getRect(): { x: number; y: number; width: number; height: number };  // public currentRect
    applyRect(rect: { x: number; y: number; width: number; height: number }): this;
    getRestoreRect(): { x: number; y: number; width: number; height: number } | null;
    // getWindowState / setWindowState / getHeader already public (header text via getHeader().getText())
}
```

No new DOM property, backing field, `XOptions` field, or theme token — these are arrangement-state accessors and pure functions, not styled components.

---

## Internal Structure

**Walk (serialize).** `serializeLayout` recurses from `root`:

```
nodeFor(component):
  manager = component.getLayoutManager()
  cls = manager.getClassName().replace(/^_/, "")
  if cls === "Split":
    children = component.getComponents().map(nodeFor)
    return { kind:"split", direction: manager.getDirection(),
             children, ratios: manager.getPaneRatios(),
             collapsed: children.map((_,i) => manager.isPaneCollapsed(i)) }
  if cls === "Tab":
    return { kind:"tab", children: component.getComponents().map(nodeFor),
             activeIndex: manager.getActiveTabIndex() }
  // opaque container or true leaf
  return { kind:"panel", panelId: panelIdOf(component) }
```

`panelIdOf(component)` reads the parent's `getLayoutConstraints(component)?.name`, else the component's own constraint name if it is itself a container child, else `getId()` with a one-time warn. Windows are gathered separately: `Window.getOpenWindows()` → for each, the content panel is the first non-header child, found publicly via `getComponents().find(c => c !== window.getHeader())` (no new Window method needed — `getHeader()` is already public); emit a `WindowNode` with `panelIdOf` of that panel, the title via `getHeader().getText()`, `getRect()`, `getWindowState()`, `getRestoreRect()`.

**Restore — park → teardown → rebuild → re-home → apply geometry.** `restoreLayout` is a single synchronous pass:

```
restoreLayout(root, state, factory):
  # 1. PARK: detach every factory-known leaf from the live tree and windows;
  #    hold references. NEVER destroy — they carry panel state.
  parked = {}                       # panelId -> Component
  for each leaf panel reachable under root (walk) and in every open Window:
    id = panelIdOf(leaf)
    if factory(id) is the same instance as leaf:   # stable-instance contract
      detach leaf from its parent (no destroy); parked[id] = leaf

  # 2. TEARDOWN: remove ALL Split/Tab containers under root and close all
  #    open windows. These are cheap, stateless arrangement managers.
  clear root's container subtree; close Window.getOpenWindows()

  # 3 + 4 + 5. REBUILD the container tree from state.root, RE-HOME parked
  #    leaves into it, then APPLY geometry — bottom of each container first
  #    so children exist before applyPaneRatios / setActiveTabIndex run.
  applyNode(root, state.root)
  for node in state.windows: applyWindow(node)
  flush layout once

applyNode(container, node):
  switch node.kind:
    "panel":  return parked[node.panelId] ?? factory(node.panelId)  # null -> skip+warn
    "split":  give container a fresh Split (direction = node.direction);
              for each child node: moveComponent(applyNode(...), index) into container;
              manager.applyPaneRatios(node.ratios);
              node.collapsed.forEach((c,i) => if (c) manager.setPaneCollapsedImmediate(i,true))
    "tab":    give container a fresh Tab;
              for each child node: moveComponent(applyNode(...), index) into container;
              manager.setActiveTabIndex(node.activeIndex)

applyWindow(node):
  panel = parked[node.panelId] ?? factory(node.panelId)
  if panel is null: skip + warn
  else: win = new Window(node.header); win.addComponent(panel); win.show()
        # Apply the NORMAL geometry first; for a minimized/maximized node that is
        # restoreRect (node.rect is the transient docked/maximized rect). Then
        # setWindowState re-caches that normal rect as _restoreRect and animates
        # to the saved state.
        normalRect = node.state === "normal" ? node.rect : (node.restoreRect ?? node.rect)
        win.applyRect(normalRect)
        if node.state !== "normal": win.setWindowState(node.state)
```

For `split`/`tab` the child `applyNode` returns either a parked/factory leaf `Component` or a freshly-constructed sub-container `Component` (a new `Component` with a `Split`/`Tab` manager) that has itself been populated. A `panelId` in `state` whose factory returns `null` is **skipped with a `console.warn`**; a factory entry never referenced is simply left unused — restore is tolerant of drift between a saved layout and a changed app.

**Ratio math.** `getPaneRatios`: `const sizes = children.map(c => _sizes.get(c) ?? 0); const sum = sizes.reduce(...); return sum > 0 ? sizes.map(s => s/sum) : children.map(() => 1/children.length)`. `applyPaneRatios`: compute `available = innerMain − gutterTotal(n)` (reuse the existing private math via a small shared helper or inline), then `_sizes.set(child, ratio * available)` per child, reset `_lastAvailableMain` so the next `recalculateSizes` does not double-rescale, and `scheduleLayout`.

---

## Ordered Implementation Steps

1. **`Split` accessors** ([Split.ts](../src/typescript/lib/layout/Split.ts)). Add `getPaneRatios`, `applyPaneRatios`, `setPaneCollapsedImmediate`. `applyPaneRatios` must set each child's stored size and reset `_lastAvailableMain` to the freshly-computed `available` so `recalculateSizes` treats the new sizes as the baseline (no spurious rescale). `setPaneCollapsedImmediate` sets `_collapsed.set(pane, collapsed)` directly (no `runCollapse`) and `scheduleLayout`. Verify: `npm run typecheck`.
2. **`Tab` accessors** ([Tab.ts](../src/typescript/lib/layout/Tab.ts)). Add `getActiveTabIndex` (return `_selectedTabIndex`) and `setActiveTabIndex` (clamp to `[0, _tabs.length-1]`, mirror the selection-sync done in [onTabPressed](../src/typescript/lib/layout/Tab.ts#L1389): set `_selectedTabIndex`, `_rovingTabIndex.moveTo`, button-group selection, materialize a lazy entry if needed, `scheduleLayout`). Verify: `npm run typecheck`.
3. **`Window` accessors** ([Window.ts](../src/typescript/lib/core/Window.ts)). Add `static getOpenWindows(): Window[]` (`return Array.from(Window.openWindows)`), public `getRect` (delegate to `currentRect`), `applyRect` (setX/setY/setWidth/setHeight), `getRestoreRect` (expose `_restoreRect`). No `setRestoreRect` — restore seeds `_restoreRect` indirectly by applying the normal rect before `setWindowState`. Verify: `npm run typecheck`.
4. **`LayoutSerialization.ts`** ([new file](../src/typescript/lib/layout/LayoutSerialization.ts)). Define the schema interfaces and `serializeLayout`/`restoreLayout` per *Internal Structure*. Implement restore as **park → teardown → rebuild → re-home → apply-geometry** in one pass. Class-kind discrimination by `getClassName().replace(/^_/,"")`. Use `moveComponent` (plan #1) to re-home parked leaves. Tolerate missing factory entries (skip + warn) and unmatched managers (opaque leaf).
5. **Barrel export** ([layout/index.ts](../src/typescript/lib/layout/index.ts)). `export { serializeLayout, restoreLayout } from '~/layout/LayoutSerialization.js';` and `export type { LayoutState, LayoutNode, PanelNode, SplitNode, TabNode, WindowNode, SerializedRect, LayoutFactory } from '~/layout/LayoutSerialization.js';`, beside the `Split`/`Tab` entries ([index.ts:15,27](../src/typescript/lib/layout/index.ts#L15)).
6. **Regression checkpoints.** `grep -n "instanceof Split\|instanceof Tab" src/typescript/lib/layout/LayoutSerialization.ts` — expect zero (class-name discrimination only, no import cycle). `grep -n "_sizes\|_tabs\|_restoreRect\|_selectedTabIndex" src/typescript/lib/layout/LayoutSerialization.ts` — expect zero (serializer touches no privates).
7. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `src/typescript/lib/layout/Split.ts` (ratio + immediate-collapse accessors) |
| Modify | `src/typescript/lib/layout/Tab.ts` (active-index accessors) |
| Modify | `src/typescript/lib/core/Window.ts` (rect/state/open-windows accessors) |
| Modify | `src/typescript/lib/layout/index.ts` (barrel exports) |
| Create | `docs/layout/layout-serialization.md` + catalog/sidebar entries (see Documentation Impact) |

No deletions.

---

## Verification

- **Typecheck:** `npm run typecheck` clean.
- **Round-trip smoke (temporary wiring in `SplitPanel.ts` / `TabDemoPanel.ts`, removed before commit):**
  1. Build a `Split` of two named panels, drag the gutter to a non-default ratio, `serializeLayout(root)` → confirm `ratios` sum ≈ 1.0 and reflect the drag.
  2. `restoreLayout` the captured state into a **fresh** root of differently-sized viewport → confirm panes land at the same *proportions* (ratio-invariance), not the same pixels.
  3. Collapse one pane, re-serialize → `collapsed[i] === true`; restore → pane is collapsed with **no** collapse animation (`setPaneCollapsedImmediate`).
  4. `Tab` with 3 panels, select tab 2, serialize/restore → `activeIndex === 1` and tab 2 is shown after restore.
  5. Open a `Window`, move/resize it, minimize it, serialize → `WindowNode.rect` reflects the docked rect, `restoreRect` holds the pre-minimize geometry; restore into a fresh app → window reappears minimized and un-minimizes to the saved rect.
  6. Serialize a layout, drop one panel ID from the factory, restore → that leaf is skipped with a warn, the rest restores cleanly (drift tolerance).
  7. **Runtime A→B→A switch (the headline use case).** Save two layouts with **different topology**: layout A has panel `p` as a tab inside a `Tab`; layout B has `p` as a pane of a `Split` (and a third panel floated into a `Window`). With a **stable-instance** factory, `restoreLayout(root, B)` on the live A-arrangement, then `restoreLayout(root, A)` again. Confirm: (i) after each switch the tree matches the target topology exactly; (ii) panel `p`'s own state (e.g. a scrolled offset or a typed form value set before the first switch) **survives** both switches — i.e. the same instance was parked and re-homed, not rebuilt; (iii) **no orphaned/empty `Split`/`Tab` containers remain** after switching (assert the container count under `root` equals the target's, with no leftover empties from the prior layout).
- **No-cycle / no-private checkpoints** from step 6.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- `serializeLayout`, `restoreLayout`, and the `LayoutState` family are exported from the per-subpath `layout` barrel ([src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts)) — there is no root barrel. TypeDoc picks up the JSDoc on the new symbols automatically.
- Add a curated page `docs/layout/layout-serialization.md` explaining the topology-not-tree model, the panel-ID-keyed **stable-instance** factory contract, the runtime layout-switching use case (park-and-rebuild), and the `Split`/`Tab`/`Window` node schema; add it to the `docs/layout/` catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- The new `Split`/`Tab`/`Window` accessors are new public methods on already-exported classes — no new barrel entry, JSDoc only. Cross-bucket JSDoc references (e.g. `LayoutFactory` referencing `Component` in the `core` bucket) use markdown links, not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- Cross-reference the page from `docs/layout/split.md` and `docs/layout/tab.md` and from `docs/core/window.md` if those pages exist (verify at write time).

---

## Potential Challenges

- **`Split.setPaneCollapsed` animates** — using it for bulk restore would fire N concurrent `runCollapse` rAF loops fighting over geometry. Mitigation: the new `setPaneCollapsedImmediate` sets state and schedules a single layout, no animation.
- **`applyPaneRatios` vs. `recalculateSizes` rescale** — `recalculateSizes` rescales `_sizes` by `available/_lastAvailableMain` on the next layout; if `applyPaneRatios` writes px without resetting `_lastAvailableMain`, the restored ratios get double-scaled. Mitigation: set `_lastAvailableMain` to the just-used `available` inside `applyPaneRatios`.
- **Lazy tabs** — `Tab.setActiveTabIndex` to a lazy entry must trigger `materializeAsync` (as `onTabPressed` does) or the restored active tab shows nothing. Mitigation: mirror `onTabPressed`'s lazy-materialize branch.
- **Stable-instance factory contract** — if the factory returns a **fresh instance per call**, the parked-and-re-homed panel is discarded and panel state is lost on every switch, making parking pointless. Mitigation: the `LayoutFactory` contract requires same-instance-per-`panelId`; document it on the type, and have restore park a leaf only when `factory(id)` returns that very instance (so a misbehaving factory degrades to "panel state not preserved" rather than corrupting the tree).
- **Orphaned-container teardown** — across repeated runtime switches, naive re-homing could leave empty `Split`/`Tab` nodes behind. Mitigation: parking leaves *before* tearing down containers means the teardown removes the entire stale container subtree wholesale; no orphaned/empty containers can accumulate because each switch rebuilds the container tree from scratch.
- **A→B→A idempotency** — switching back to a previously-applied layout must reproduce it exactly. Mitigation: the clean-container-slate of park-and-rebuild makes this trivially correct — A is rebuilt from A's state with zero residue from B; no diff/patch matching to get wrong.
- **Panel identity collisions / UUID fallback** — two panels without a constraint `name` both fall back to a fresh UUID `getId()`, which won't round-trip. Mitigation: warn once per such panel; document that serialized panels must carry a stable constraint `name`.
- **Window content discovery** — a Window's content panel is its first non-header child ([findBodyHost](../src/typescript/lib/core/Window.ts#L1380) is private). Mitigation: replicate the "first non-header child" rule in the serializer using public `getComponents()` plus the header reference exposure already needed, or add a small public `getContentComponent()` to Window if the header isn't otherwise reachable (prefer reusing existing public surface; only add the getter if necessary).
- **`size-constraint-invariant.md` not yet landed** — restored ratios/rects assume `min ≤ preferred ≤ max` holds, or a restored split can clamp to an inconsistent size. Mitigation: ordering dependency (below), not re-planned here.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `_direction` (38), `_sizes` (39), `_collapsed` (46), `_lastAvailableMain` (62), `recalculateSizes` (789), `gutterTotal` (385), `getDirection`/`setDirection` (258/267), `isPaneCollapsed` (110), `setPaneCollapsed` (214); the ratio + immediate-collapse accessors land here.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `_tabs` (480), `_selectedTabIndex` (488), `onTabPressed` (1389), `materializeAsync` (1880), `createTab` (1787), constraint-`name` label resolution (1788); the active-index accessors land here.
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `openWindows` (137), `currentRect` (1371), `_restoreRect` (174), `_preMinimizeState` (173), `getWindowState`/`setWindowState` (643/662), `findBodyHost` (1380), `setHeaderText` (627).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getComponents` (3913), `getLayoutManager` (3971), `getLayoutConstraints` (3924), `setLayoutManager` (3980), `getParentComponent` (3666), and `moveComponent` (added by plan #1).
- [`src/typescript/lib/core/BaseObject.ts`](../src/typescript/lib/core/BaseObject.ts) — `getClassName` (44), the callable-alias source the kind-discrimination relies on.
- [`plans/component-move-helper.md`](component-move-helper.md) — the `moveComponent(child, index?, constraints?)` primitive restore uses to re-home parked leaves.
- [`src/typescript/main.ts`](../src/typescript/main.ts) — the imperative composition model this plan is shaped around.

---

## Non-Goals

- **A generic declarative-UI / component-tree serializer.** Only `Split`/`Tab`/`Window` arrangement + sizing is captured; arbitrary `Component` subclasses are never reconstructed from data — leaf content is always caller-built via the factory.
- **Serializing leaf content / panel internal state** (table column widths, form values, scroll position). Out of scope; a panel may expose its own persistence if it wants it. Note `plans/table-column-pinning.md` and similar own their own per-panel state. (Panel state is *preserved* across a runtime switch by parking the same instance — but that state is never written into `LayoutState`.)
- **Capturing `Border` / `HBox` / `VBox` / `Accordion` / `Grid` sub-arrangements.** These are treated as opaque content leaves; the dock manager arranges via `Split`/`Tab`/`Window` only. Extending recognition to more managers is additive and deferred until a plan needs it.
- **Auto-persistence (localStorage / server round-trip), schema migration beyond `version: 1`, debounced auto-save.** The API returns/accepts a plain object; persistence transport is the caller's (plan #5's) concern.
- **Adding a first-class stable `Component` identity field.** Identity reuses the existing `LayoutConstraints.name`; no new `Component` field is introduced.
- **Animating the restore.** Restore applies geometry immediately (`setPaneCollapsedImmediate`, direct `applyRect`); a transitioned restore is not in scope.
- **Optimizing restore performance.** Restoration runs behind a loading screen as a discrete user action, not a hot path; a few hundred ms of container teardown/rebuild churn per switch is acceptable. Replacing the wholesale park-and-rebuild with a diff/patch container-reuse strategy is **explicitly out of scope and deferred** until a real workload demonstrates a problem. The deferred `serializeArrangement()` polymorphism refactor (Architecture Decisions) is likewise not adopted now.

---

## Blocking Prerequisites

- [`plans/size-constraint-invariant.md`](size-constraint-invariant.md) (`min ≤ preferred ≤ max` enforcement) should land first — restored split ratios and window rects depend on sane sizing. Referenced as an ordering dependency only; not re-planned here.
- [`plans/component-move-helper.md`](component-move-helper.md) (`moveComponent`) must land first — `restoreLayout` re-homes parked panels through it.
