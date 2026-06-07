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

The public surface is two free functions, `serializeLayout(root): LayoutState` and `restoreLayout(root, state, factory)`, plus the `LayoutState` schema interfaces, living in a new module [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) (exported from the `layout` barrel beside `Split`/`Tab`). It walks a live tree via the existing `Component`/`LayoutManager` accessors ([`getComponents`](../src/typescript/lib/core/Component.ts#L3628), [`getLayoutManager`](../src/typescript/lib/core/Component.ts#L3686), [`getLayoutConstraints`](../src/typescript/lib/core/Component.ts#L3639)), discriminating container kind by [`getClassName`](../src/typescript/lib/core/BaseObject.ts#L44) (which reports the callable alias `_Split` / `_Tab`).

This is **plan #4 of 5** for a dock/tab manager. Plan #5 (the dock manager) calls this API; plan #1 ([`plans/component-move-helper.md`](component-move-helper.md)) supplies [`moveComponent(child, index?, constraints?)`](component-move-helper.md) which `restoreLayout` uses to re-home already-built panels. It is independent of the DnD plans (#2/#3).

To read and write the managers' private arrangement state without breaching encapsulation, this plan adds **narrow public accessors** to `Split`, `Tab`, and `Window` (enumerated below) rather than reaching into `_sizes` / `_tabs` / `_restoreRect` from the serializer. The serializer is a pure consumer of those accessors.

---

## Architecture Decisions

### Serialize topology + sizing keyed by panel ID; the caller owns content via a factory

The naive "serialize the whole tree, reconstruct from JSON" model is impossible here: a leaf panel is an arbitrary `Component` subclass (`MiscPanel`, `TablePanel`, …) built imperatively with constructor args and post-construction wiring the framework cannot recover from data. So the serialized form captures **structure and geometry only** — the shape of the container nesting, split ratios, tab order/active index, window rects — with each **leaf** recorded as a bare `{ kind: "panel", panelId }` reference. On restore, the caller supplies a `LayoutFactory` mapping each `panelId` to a `Component`. The library reconstructs the *containers* (`Split`/`Tab`/`Window` arrangements) and asks the factory for each leaf's content. This is the only model that fits an imperative framework, and it cleanly separates **arrangement** (library-owned, serializable) from **content** (caller-owned, code-built).

**Panel identity is caller-assigned, not the auto-generated `getId()`.** `Component.getId()` returns a per-instance UUID that changes every run, so it cannot key persisted state across reloads. The contract is: a panel that participates in serialization carries a **stable string ID** the caller chose. We do **not** add a new identity field to `Component` — instead the panel's serialization ID is read from its layout constraint **`name`** (already used by `Tab` for the tab label, see [Tab.ts:886](../src/typescript/lib/layout/Tab.ts#L886)) when present, falling back to `getId()` only as a last resort (with a one-time `console.warn`, because a UUID won't round-trip). The factory is keyed by the same string. This reuses the existing `LayoutConstraints.name` channel rather than minting a parallel ID concept.

### Discriminate container kind by `getClassName()`, with a graceful "opaque" fallback

The serializer walks the tree and, at each container, inspects `getLayoutManager().getClassName()`. `Split` → `"_Split"`, `Tab` → `"_Tab"` (the callable alias; strip the leading `_` to compare, exactly as [setLayoutManager](../src/typescript/lib/core/Component.ts#L3710) already does for the `data-layout` attribute). A `Window` is recognised by `getClassName() === "_Window"` on the *component* (Window is a `Panel` subclass, not a layout manager). Any container whose manager is **not** one of the recognised arrangement managers (`Border`, `HBox`, `VBox`, `Fit`, `Accordion`, `Grid`, …) is treated as an **opaque leaf**: the walk does not descend into it, and it is recorded as a single `panel` node keyed by its own constraint name/ID. This keeps scope tight — only `Split`/`Tab`/`Window` topologies are captured; everything else is an atomic content panel from the layout's point of view. Recognising the manager by class name (a string) avoids importing `Split`/`Tab` into the serializer purely for `instanceof`, which would create a layout-bucket import cycle risk; the string compare is sufficient and matches the framework's own precedent.

### Two free functions in a new `layout` module, not methods on `Component`

`serializeLayout` / `restoreLayout` are cross-cutting traversal utilities that read several managers' state; they are not the responsibility of any one container. Putting them on `Component` would bloat the base class with dock-specific concerns (the Simplicity rule). They live in `src/typescript/lib/layout/LayoutSerialization.ts` as exported functions taking the root `Component` explicitly. This is the `layout` bucket because the captured concepts (`Split`, `Tab`) are layout managers; `Window` is core but is consumed here as a recognised node type, not owned. The module imports `Component`, `Split`, `Tab`, `Window` for the accessor calls and `instanceof`-free class-name discrimination.

### Add narrow public accessors to the managers; do not reach into privates

The serializer must read `Split._sizes` / `_direction` / `_collapsed`, `Tab`'s order + `_selectedTabIndex`, and `Window`'s rect + state, and on restore write them back. Rather than friend-access privates, each manager gains a **small, typed, public** read/apply pair scoped exactly to serialization:

- `Split`: `getPaneRatios(): number[]` (stored sizes **normalised to sum 1.0**, in child order — ratios survive viewport differences across reload) and `applyPaneRatios(ratios: number[]): this` (writes `_sizes` against the current children by index, then `scheduleLayout`). Direction is already public via [`getDirection`](../src/typescript/lib/layout/Split.ts#L258)/[`setDirection`](../src/typescript/lib/layout/Split.ts#L267). Collapsed state reuses the existing public [`isPaneCollapsed`](../src/typescript/lib/layout/Split.ts#L110) and a new non-animating `setPaneCollapsedImmediate(index, collapsed)` (the existing [`setPaneCollapsed`](../src/typescript/lib/layout/Split.ts#L214) animates, which is wrong for a bulk restore — see Potential Challenges).
- `Tab`: `getActiveTabIndex(): number` + the existing selection setter generalised to a public `setActiveTabIndex(index: number): this`. Tab **order** is the child order in `container.getComponents()` (the toolbar mirrors it), so order is captured from the container walk, not a Tab accessor; restore re-homes children into the recorded order via `moveComponent`.
- `Window`: `getRect(): { x; y; width; height }` (public form of the private [`currentRect`](../src/typescript/lib/core/Window.ts#L1371)) and `applyRect(rect): this`. State is already public via [`getWindowState`](../src/typescript/lib/core/Window.ts#L643)/[`setWindowState`](../src/typescript/lib/core/Window.ts#L662). The minimized **restore rect** (`_restoreRect`) is captured via a new `getRestoreRect(): WindowRect | null` / `setRestoreRect(rect)` so a window serialized *while minimized* round-trips back to the right normal-state geometry.

Each accessor is the minimum needed; none exposes the internal `Map`/array references.

### Sizes are stored as **ratios**, not pixels

`Split._sizes` holds absolute px that the manager rescales on every viewport resize ([recalculateSizes](../src/typescript/lib/layout/Split.ts#L789) multiplies by `available / _lastAvailableMain`). Persisting absolute px would restore wrong proportions whenever the window is a different size on reload. `getPaneRatios` therefore divides each stored size by their sum; `applyPaneRatios` multiplies the ratios by the **current** available main-axis extent. Because `Split` is ratio-invariant, the first `doLayout` after restore lands the panes at the recorded proportions regardless of viewport size. Window rects stay **absolute px** (a window's position is meaningful in pixels and there is no proportional contract for it); restore clamps them to the viewport via the window's existing `constrainToViewport` machinery.

### `restoreLayout` rebuilds arrangement against the live root, re-homing existing panels

`restoreLayout(root, state, factory)` does **not** destroy and rebuild `root`. It walks the `LayoutState` tree top-down. For each `panel` leaf it obtains the `Component` from the factory (the factory may return an already-mounted panel or build a fresh one) and `moveComponent`s it into the reconstructed container at the recorded index. For `split`/`tab`/`window` nodes it ensures the container has the right manager (creating a `Split`/`Tab` with the recorded direction when the live container's manager doesn't match), populates children in recorded order, then applies the recorded sizing (`applyPaneRatios`, `setActiveTabIndex`, `applyRect` + `setWindowState`). Using `moveComponent` (plan #1) means a panel that already exists in the live tree is re-parented atomically with both ends re-laying out, rather than rebuilt. **A panel ID present in `state` but absent from the factory is skipped with a `console.warn`; a factory entry never referenced is left untouched** — restore is tolerant of drift between a saved layout and a changed app.

### `Window` nodes are top-level only

Windows are mounted on `document.documentElement`, not inside the `root` subtree ([Window.ts](../src/typescript/lib/core/Window.ts) appends itself to the document). So `serializeLayout` collects open windows from `Window`'s existing `static openWindows` set (exposed via a new `Window.getOpenWindows(): Window[]`), filtered to those whose content panel resolves to a known panel ID, and records them as a sibling `windows: WindowNode[]` array on the root `LayoutState`, not as children of the tree. `restoreLayout` reconstructs each via the factory-built content panel placed in a fresh `Window`, then applies rect/state. This keeps the window plane orthogonal to the in-`root` container tree, matching how the framework actually mounts windows.

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

/** Resolves a stable panel ID to the Component that supplies its content. */
export type LayoutFactory = (panelId: string) => Component | null;

/** Captures the arrangement of `root` (and open windows) to a plain object. */
export function serializeLayout(root: Component): LayoutState;

/** Restores a previously captured `state` onto `root`, sourcing leaves from `factory`. */
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
    setRestoreRect(rect: { x: number; y: number; width: number; height: number } | null): this;
    // getWindowState / setWindowState already public
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

`panelIdOf(component)` reads the parent's `getLayoutConstraints(component)?.name`, else the component's own constraint name if it is itself a container child, else `getId()` with a one-time warn. Windows are gathered separately: `Window.getOpenWindows()` → for each, the content panel is `findBodyHost()`-equivalent (the first non-header child); emit a `WindowNode` with `panelIdOf` of that panel, `getRect()`, `getWindowState()`, `getRestoreRect()`.

**Walk (restore).** `restoreLayout` mirrors the shape:

```
applyNode(container, node):
  switch node.kind:
    "panel":  return factory(node.panelId)   // a Component, or null → skip+warn
    "split":  ensure container has a Split (direction = node.direction);
              for each child node: applyNode → moveComponent into container at index;
              manager.applyPaneRatios(node.ratios);
              node.collapsed.forEach((c,i) => if (c) manager.setPaneCollapsedImmediate(i,true))
    "tab":    ensure container has a Tab;
              for each child node: applyNode → moveComponent into container at index;
              manager.setActiveTabIndex(node.activeIndex)
```

For `split`/`tab` the child `applyNode` returns either a factory leaf `Component` or a freshly-constructed sub-container `Component` (a new `Component` with a `Split`/`Tab` manager) that has itself been populated. Windows: for each `WindowNode`, `const panel = factory(panelId)`; if non-null, `new Window(headerText)` with the panel as content, `applyRect(node.rect)`, `setRestoreRect(node.restoreRect)`, `setWindowState(node.state)`.

**Ratio math.** `getPaneRatios`: `const sizes = children.map(c => _sizes.get(c) ?? 0); const sum = sizes.reduce(...); return sum > 0 ? sizes.map(s => s/sum) : children.map(() => 1/children.length)`. `applyPaneRatios`: compute `available = innerMain − gutterTotal(n)` (reuse the existing private math via a small shared helper or inline), then `_sizes.set(child, ratio * available)` per child, reset `_lastAvailableMain` so the next `recalculateSizes` does not double-rescale, and `scheduleLayout`.

---

## Ordered Implementation Steps

1. **`Split` accessors** ([Split.ts](../src/typescript/lib/layout/Split.ts)). Add `getPaneRatios`, `applyPaneRatios`, `setPaneCollapsedImmediate`. `applyPaneRatios` must set each child's stored size and reset `_lastAvailableMain` to the freshly-computed `available` so `recalculateSizes` treats the new sizes as the baseline (no spurious rescale). `setPaneCollapsedImmediate` sets `_collapsed.set(pane, collapsed)` directly (no `runCollapse`) and `scheduleLayout`. Verify: `npm run typecheck`.
2. **`Tab` accessors** ([Tab.ts](../src/typescript/lib/layout/Tab.ts)). Add `getActiveTabIndex` (return `_selectedTabIndex`) and `setActiveTabIndex` (clamp to `[0, _tabs.length-1]`, mirror the selection-sync done in [onTabPressed](../src/typescript/lib/layout/Tab.ts#L517): set `_selectedTabIndex`, `_rovingTabIndex.moveTo`, button-group selection, materialize a lazy entry if needed, `scheduleLayout`). Verify: `npm run typecheck`.
3. **`Window` accessors** ([Window.ts](../src/typescript/lib/core/Window.ts)). Add `static getOpenWindows(): Window[]` (`return Array.from(Window.openWindows)`), public `getRect` (delegate to `currentRect`), `applyRect` (setX/setY/setWidth/setHeight), `getRestoreRect`/`setRestoreRect` (expose `_restoreRect`). Verify: `npm run typecheck`.
4. **`LayoutSerialization.ts`** ([new file](../src/typescript/lib/layout/LayoutSerialization.ts)). Define the schema interfaces and `serializeLayout`/`restoreLayout` per *Internal Structure*. Class-kind discrimination by `getClassName().replace(/^_/,"")`. Use `moveComponent` (plan #1) for re-homing. Tolerate missing factory entries (skip + warn) and unmatched managers (opaque leaf).
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
- **No-cycle / no-private checkpoints** from step 6.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- `serializeLayout`, `restoreLayout`, and the `LayoutState` family are exported from the per-subpath `layout` barrel ([src/typescript/lib/layout/index.ts](../src/typescript/lib/layout/index.ts)) — there is no root barrel. TypeDoc picks up the JSDoc on the new symbols automatically.
- Add a curated page `docs/layout/layout-serialization.md` explaining the topology-not-tree model, the panel-ID-keyed factory contract, and the `Split`/`Tab`/`Window` node schema; add it to the `docs/layout/` catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- The new `Split`/`Tab`/`Window` accessors are new public methods on already-exported classes — no new barrel entry, JSDoc only. Cross-bucket JSDoc references (e.g. `LayoutFactory` referencing `Component` in the `core` bucket) use markdown links, not `{@link}`, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- Cross-reference the page from `docs/layout/split.md` and `docs/layout/tab.md` and from `docs/core/window.md` if those pages exist (verify at write time).

---

## Potential Challenges

- **`Split.setPaneCollapsed` animates** — using it for bulk restore would fire N concurrent `runCollapse` rAF loops fighting over geometry. Mitigation: the new `setPaneCollapsedImmediate` sets state and schedules a single layout, no animation.
- **`applyPaneRatios` vs. `recalculateSizes` rescale** — `recalculateSizes` rescales `_sizes` by `available/_lastAvailableMain` on the next layout; if `applyPaneRatios` writes px without resetting `_lastAvailableMain`, the restored ratios get double-scaled. Mitigation: set `_lastAvailableMain` to the just-used `available` inside `applyPaneRatios`.
- **Lazy tabs** — `Tab.setActiveTabIndex` to a lazy entry must trigger `materializeAsync` (as `onTabPressed` does) or the restored active tab shows nothing. Mitigation: mirror `onTabPressed`'s lazy-materialize branch.
- **Panel identity collisions / UUID fallback** — two panels without a constraint `name` both fall back to a fresh UUID `getId()`, which won't round-trip. Mitigation: warn once per such panel; document that serialized panels must carry a stable constraint `name`.
- **Window content discovery** — a Window's content panel is its first non-header child ([findBodyHost](../src/typescript/lib/core/Window.ts#L1380) is private). Mitigation: replicate the "first non-header child" rule in the serializer using public `getComponents()` plus the header reference exposure already needed, or add a small public `getContentComponent()` to Window if the header isn't otherwise reachable (prefer reusing existing public surface; only add the getter if necessary).
- **Restore re-home order** — `moveComponent` re-parents one child at a time; restoring children into a container that still holds stale children needs the stale ones cleared first or the recorded indices drift. Mitigation: `restoreLayout` clears the target container's existing children (or moves only factory-resolved panels and removes the remainder) before applying the recorded order.
- **`size-constraint-invariant.md` not yet landed** — restored ratios/rects assume `min ≤ preferred ≤ max` holds, or a restored split can clamp to an inconsistent size. Mitigation: ordering dependency (below), not re-planned here.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `_direction` (38), `_sizes` (39), `_collapsed` (46), `recalculateSizes` (789), `gutterTotal` (385), `getDirection`/`setDirection` (258/267), `isPaneCollapsed` (110), `setPaneCollapsed` (214); the ratio + immediate-collapse accessors land here.
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `_tabs` (223), `_selectedTabIndex` (226), `onTabPressed` (517), `materializeAsync` (975), `createTab` (882); the active-index accessors land here.
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `openWindows` (137), `currentRect` (1371), `_restoreRect` (174), `_preMinimizeState` (173), `getWindowState`/`setWindowState` (643/662), `findBodyHost` (1380), `getHeaderText`/`setHeaderText` (627).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getComponents` (3628), `getLayoutManager` (3686), `getLayoutConstraints` (3639), `getParentComponent` (3434), and `moveComponent` (added by plan #1).
- [`src/typescript/lib/core/BaseObject.ts`](../src/typescript/lib/core/BaseObject.ts) — `getClassName` (44), the callable-alias source the kind-discrimination relies on.
- [`plans/component-move-helper.md`](component-move-helper.md) — the `moveComponent(child, index?, constraints?)` primitive restore uses.
- [`src/typescript/main.ts`](../src/typescript/main.ts) — the imperative composition model this plan is shaped around.

---

## Non-Goals

- **A generic declarative-UI / component-tree serializer.** Only `Split`/`Tab`/`Window` arrangement + sizing is captured; arbitrary `Component` subclasses are never reconstructed from data — leaf content is always caller-built via the factory.
- **Serializing leaf content / panel internal state** (table column widths, form values, scroll position). Out of scope; a panel may expose its own persistence if it wants it. Note `plans/table-column-pinning.md` and similar own their own per-panel state.
- **Capturing `Border` / `HBox` / `VBox` / `Accordion` / `Grid` sub-arrangements.** These are treated as opaque content leaves; the dock manager arranges via `Split`/`Tab`/`Window` only. Extending recognition to more managers is additive and deferred until a plan needs it.
- **Auto-persistence (localStorage / server round-trip), schema migration beyond `version: 1`, debounced auto-save.** The API returns/accepts a plain object; persistence transport is the caller's (plan #5's) concern.
- **Adding a first-class stable `Component` identity field.** Identity reuses the existing `LayoutConstraints.name`; no new `Component` field is introduced.
- **Animating the restore.** Restore applies geometry immediately (`setPaneCollapsedImmediate`, direct `applyRect`); a transitioned restore is not in scope.

---

## Blocking Prerequisites

- [`plans/size-constraint-invariant.md`](size-constraint-invariant.md) (`min ≤ preferred ≤ max` enforcement) should land first — restored split ratios and window rects depend on sane sizing. Referenced as an ordering dependency only; not re-planned here.
- [`plans/component-move-helper.md`](component-move-helper.md) (`moveComponent`) must land first — `restoreLayout` re-homes existing panels through it.
