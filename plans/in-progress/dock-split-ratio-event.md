---
depends-on: [dock-programmatic-split]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/src/typescript/lib/overlay/index.ts
  - packages/lib/src/typescript/MiscPanel.ts
  - packages/lib/docs/components/Dock.md
  - packages/lib/docs/reference/changelog/next.md
---

# Dock Split Resize Event — Implementation Plan

## Overview

Loom saves its [`Dock`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L257) layout and wants to know when the user resizes a split, without polling `getLayoutState()`. Today `Dock` emits nothing for it. Its events are the per-panel `attach` / `detach` / `move` / `focus` / `close` / `beforeclose` / `dblclick`, plus the dock-wide `emptychange` and `exception` ([Dock.ts:158](../packages/lib/src/typescript/lib/overlay/Dock.ts#L158)). The [`Split`](../packages/lib/src/typescript/lib/layout/Split.ts#L50) regions inside a dock already emit what is needed: `"paneresize"` once a gutter drag ends ([Split.ts:1719](../packages/lib/src/typescript/lib/layout/Split.ts#L1719)) and `"panecollapse"` when a pane collapses or expands ([Split.ts:551](../packages/lib/src/typescript/lib/layout/Split.ts#L551), [:1425](../packages/lib/src/typescript/lib/layout/Split.ts#L1425)). Nobody listens to them: `Dock.wireRegion` subscribes to every `Tab` region's events but to no `Split` region's ([Dock.ts:1351](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1351)).

This plan adds one dock-wide event, `"splitresize"`, with a `DockSplitEvent` payload. `wireRegion` subscribes to each `Split` region's two events and re-emits them as `"splitresize"`, the way it already re-emits `Tab`'s `"tabclose"` as `"close"`. Only [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) changes in the library, plus the type export in [`overlay/index.ts`](../packages/lib/src/typescript/lib/overlay/index.ts#L29). `Split` is not changed.

This plan runs after [`dock-programmatic-split`](dock-programmatic-split.md), which adds `Dock.splitPanel(targetId, panel, side, { ratio?, focus? })` and itself runs after [`dock-reveal-panel-without-focus`](dock-reveal-panel-without-focus.md). All three edit `Dock.ts`, `Dock.md` and the changelog staging page. Line numbers below were taken at `c02c192f1`, before either of those plans; re-locate by symbol.

---

## Architecture Decisions

### Dock re-emits its `Split` regions' events, the way it re-emits `Tab`'s

`wireRegion` subscribes the dock to each `Split` region's `"paneresize"` and `"panecollapse"`, and both handlers emit the dock's `"splitresize"`. This mirrors the `Tab` wiring in the same method ([Dock.ts:1354–1393](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1354)): subscribe once per layout-manager instance, compare the stored instance by identity on every sweep, and use a named per-region `const` listener like `onEmpty` ([:1379](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1379)) because the inner event's payload does not say which region fired it.[^precedent]

`Dock`'s *sweep* is its pass, coalesced to one per animation frame, that calls `wireRegion` on the root region and on every adopted float region, recursing into child regions. Every region the dock shows passes through it on the next sweep, so one subscription point covers every split the user can drag:

| Split | How it reaches `wireRegion` |
|---|---|
| Built by `DockOptions.layout` | the constructor's first sweep |
| Made by an edge drop, or by `splitPanel` | the sweep the drop / `splitPanel` schedules |
| Nested inside another split | `wireRegion` recurses into child regions |
| Inside a float (a Shift tear-off's bare `Window` mini-dock) | the sweep wires each adopted float region |
| Rebuilt by `setLayoutState` | the sweep after the restore; a manager rebuilt on the same region is a new instance, so it is re-subscribed |

A strip-mode tear-off (`TabWindow`) holds no split, so it needs nothing.

### One event, `"splitresize"`, for both gestures

A finished gutter drag and a pane collapsed or expanded from the gutter both fire the same `"splitresize"`. The payload carries the split's whole state, so a listener never needs to know which gesture it was.[^one-event] The name follows the library's convention for a gesture that ends: `Split`'s `"paneresize"` and `Accordion`'s `"sectionresize"` ([Accordion.ts:57](../packages/lib/src/typescript/lib/layout/Accordion.ts#L57)) both fire once when a gutter drag ends. A `…change` name was rejected because, in this library, `"change"` also fires for programmatic writes.[^name]

### Payload: the host, the ratios, the collapsed flags, and the panels in each pane

`DockSplitEvent` is `{ window, ratios, collapsed, panels }`:

- `window` — the host the split sits in, as in `DockPanelEvent`: `null` for the tiled tree, otherwise the float window.
- `ratios` — `Split.getPaneRatios()` after the change: one share per pane, summing to 1. These are the shares `getLayoutState()` records for this split, up to float rounding. A collapsed pane keeps the share it returns to when expanded.
- `collapsed` — one flag per pane, from `Split.isPaneCollapsed`.
- `panels` — for each pane, the ids of the open panels anywhere inside it, including inside nested splits.

Regions have no public identity, so `panels` is how a listener tells which split moved, in the dock's own vocabulary of panel ids.[^payload]

Example: the user drags the gutter in `H[T(explorer,search), T(editor)]` so the left group takes 30%:

```typescript
{ window: null, ratios: [0.3, 0.7], collapsed: [false, false], panels: [['explorer', 'search'], ['editor']] }
```

### When it fires: the end of the gesture, synchronously

| Change | `"splitresize"`? |
|---|---|
| A gutter drag ends (live or outline mode) | yes, once, on release |
| A gutter press and release that did not move it | yes, once, with unchanged ratios |
| Pointer moves during a drag | no |
| An outline drag cancelled with `Escape` | no |
| A pane collapsed or expanded by its gutter chevron | yes, once |
| A pane collapsed or expanded by code calling `Split.setPaneCollapsed` / `setPaneCollapsedImmediate` on a dock region | yes, once |
| The dock, or a float holding a split, is resized | no |
| `splitPanel`, with or without `ratio` | no |
| An edge drop that makes or extends a split; a pane pruned when its last panel leaves | no |
| `setLayoutState` | no |
| The gutter menu's *Lock gutter*, *Fix … pane width* or *Collapse … pane* (retarget) | no |

The event fires inside `Split`'s own emit, so it reaches listeners before `onDragStop` / the chevron handler returns, not on the next frame. Nothing is throttled; a per-frame event during the drag is out of scope.[^grain]

The rule behind the table: `"splitresize"` reports a gesture on a split's gutter. Changes to the region tree are already reported by `attach` / `move` / `detach` / `close`, and a consumer that saves on those already captures the new ratios.

- **No event on a window or dock resize.** `Split` rescales its panes in proportion to their sizes, which keeps every ratio the same ([Split.ts:2697](../packages/lib/src/typescript/lib/layout/Split.ts#L2697)). A pane pinned with *Fix … pane width* keeps its pixels, so the ratios do drift then; that drift still fires nothing.[^window-resize]
- **No event for `splitPanel`.** Its `ratio` is written through `Split.applyPaneRatios`, which emits no `Split` event, so there is nothing to forward. The split it makes is reported by the `"attach"` / `"move"` / `"detach"` the sweep emits, as the sibling plan specifies.[^split-panel]
- **No event for a restore.** `restoreLayout` builds new `Split` instances and collapses their panes before the next sweep subscribes the dock to them, so no handler is attached yet.[^restore]
- **A press without movement fires.** `Split` reports `"paneresize"` for every completed drag, moved or not, and `Dock` forwards it unchanged. Saving the same state twice is harmless.[^zero-move]
- **A collapse from code fires.** `Split.panecollapse` does not say where the collapse came from. `Dock` has no collapse method of its own, so this only happens when code reaches into a region's `Split`.[^programmatic-collapse]

### A `Split` region's subscription is released when the region leaves

`RegionWiring` stores the subscribed `Split` and its listener. `teardownVanished` unsubscribes them before it drops the region's wiring, and `wireRegion` unsubscribes the old instance when a region's manager is replaced. The `Tab` wiring does neither. This plan does it for `Split` because `removeComponent` does not destroy a pruned region, and a region wired twice would emit twice.[^release]

---

## Public API

```typescript
// overlay/Dock.ts — new, exported, declared directly after DockSplitOptions
// (which dock-programmatic-split declares after DockFocusPanelOptions)

/**
 * Payload for a {@link Dock} `"splitresize"` event: the state of one split
 * region after the user resized it from its gutter.
 *
 * @category Core
 */
export interface DockSplitEvent {
    /**
     * The host the split sits in: `null` for the tiled tree (the main dock),
     * otherwise the float window holding it.
     */
    window:    AbstractWindow | null;
    /**
     * Each pane's share of the split, in pane order, summing to 1 — the ratios
     * {@link Dock.getLayoutState} records for this split. A collapsed pane keeps
     * the share it takes back when expanded.
     */
    ratios:    number[];
    /** Whether each pane is collapsed, in pane order. */
    collapsed: boolean[];
    /**
     * For each pane, in pane order, the ids of the open panels anywhere inside
     * it, nested splits included. Read each inner array as a set: its order
     * is not the tab strips' order.
     */
    panels:    string[][];
}
```

```typescript
// DockEvent — widened
export type DockEvent =
    "attach" | "detach" | "move" | "focus" | "close" | "beforeclose" | "dblclick" | "emptychange" | "exception" | "splitresize";

// DockOptions.listeners — new key, after `exception`
splitresize?: (event: DockSplitEvent) => void;
```

```typescript
// Dock — new overloads, each placed directly after its "dblclick" overload

/**
 * Registers a listener for the `"splitresize"` event, which fires when the
 * user resizes a split from its gutter: once when a gutter drag ends, and
 * once when a pane is collapsed or expanded. It fires for splits in the tiled
 * tree and in floats, nested or not. It does not fire while the drag is still
 * moving, when the dock or a float is resized, or for changes to the region
 * tree (an edge drop, `splitPanel`, a pane pruned when its last panel leaves,
 * `setLayoutState`) — those fire the panel events instead.
 *
 * @param event - The `"splitresize"` event.
 * @param listener - Invoked with the resized split's state.
 *
 * @returns This dock, for method chaining.
 */
on(event: "splitresize", listener: (event: DockSplitEvent) => void): this;

/**
 * Removes a previously registered `"splitresize"` listener.
 *
 * @param event - The `"splitresize"` event.
 * @param listener - The exact listener reference passed to `on`.
 *
 * @returns This dock, for method chaining.
 */
off(event: "splitresize", listener: (event: DockSplitEvent) => void): this;

protected emit(event: "splitresize", payload: DockSplitEvent): void;
```

`overlay/index.ts` adds `DockSplitEvent` to the `export type { … } from '~/overlay/Dock.js'` line ([index.ts:29](../packages/lib/src/typescript/lib/overlay/index.ts#L29)). There is no new state-bearing property and no options field other than the `listeners` key.

---

## Implementation

### `RegionWiring`

```typescript
interface RegionWiring {
    dockRegion: DockRegion;
    wiredTab:   Tab | null;
    /**
     * The `Split` instance this region's manager was last subscribed as, with
     * the listener it was given, or `null` when the region is not a `Split`
     * region. Compared by identity against `region.getLayoutManager()` on every
     * sweep, as `wiredTab` is, so a manager rebuilt in place is re-subscribed;
     * kept so the subscription can be released (see unwireSplit).
     */
    wiredSplit: { split: Split; onResize: () => void } | null;
}
```

`wireRegion`'s `wiring = { dockRegion: …, wiredTab: null }` literal gains `wiredSplit: null`.

### New private methods, placed directly after `wireRegion`

```typescript
/**
 * Subscribes the dock to a `Split` region's gutter events, so that a finished
 * drag or a pane collapsed or expanded is re-emitted as `"splitresize"`.
 * Idempotent per `Split` instance, like the `Tab` wiring: a region whose
 * manager was replaced (a `setLayoutState` restore) releases the old instance
 * and subscribes the new one; a region that is not a `Split` region holds none.
 *
 * @param region - The region being wired.
 * @param wiring - The region's wiring record.
 */
private wireSplit(region: Component, wiring: RegionWiring): void {
    const split   = this.regionKind(region) === "Split" ? (region.getLayoutManager() as Split) : null;
    const current = wiring.wiredSplit?.split ?? null;

    if (split === current) {
        return;
    }

    this.unwireSplit(wiring);

    if (!split) {
        return;
    }

    // Per-region listener: the named const carries the region and split that
    // the Split events' own payloads do not (ARCHITECTURE: a listener is a
    // named reference, never an inline arrow).
    const onResize: () => void = (): void => { this.emitSplitResize(region, split); };

    split.on("paneresize",   onResize);
    split.on("panecollapse", onResize);

    wiring.wiredSplit = { split, onResize };
}

/**
 * Releases the `Split` subscription `wireSplit` made for a region, if any.
 *
 * @param wiring - The region's wiring record.
 */
private unwireSplit(wiring: RegionWiring): void {
    if (!wiring.wiredSplit) {
        return;
    }

    const { split, onResize } = wiring.wiredSplit;

    split.off("paneresize",   onResize);
    split.off("panecollapse", onResize);

    wiring.wiredSplit = null;
}

/**
 * Emits `"splitresize"` with a split region's state as it is now.
 *
 * @param region - The split region whose gutter was used.
 * @param split - Its `Split` manager.
 */
private emitSplitResize(region: Component, split: Split): void {
    const panes = region.getComponents();

    this.emit("splitresize", {
        // hostForFrame walks the ancestor chain, so it serves any component.
        window:    this.hostForFrame(region, this.getRootRegion()),
        ratios:    split.getPaneRatios(),
        collapsed: panes.map((_pane, index) => split.isPaneCollapsed(index)),
        panels:    panes.map(pane => this.panelIdsUnder(pane)),
    });
}

/**
 * The ids of the registered panels whose identity frame lies inside `pane`.
 *
 * @param pane - A pane of a split region.
 *
 * @returns The panel ids, in the registry's order.
 */
private panelIdsUnder(pane: Component): string[] {
    return [...this._frames.entries()]
        .filter(([id, frame]) => this._panels.has(id) && this.isUnder(pane, frame))
        .map(([id]) => id);
}
```

`collapsed` reads `isPaneCollapsed(index)` against `getComponents()` indices, as `serializeLayout`'s `nodeFor` does ([LayoutSerialization.ts:295](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L295)). `isPaneCollapsed` indexes laid-out panes. The two agree because `Dock` never hides a region pane.

### Call sites

- `wireRegion`: call `this.wireSplit(region, wiring);` directly after the `if (this.isTab(region)) { … }` block and before the child-recursion loop.
- `teardownVanished` ([:1517](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1517)): in the `if (!reachable.has(region))` branch, call `this.unwireSplit(wiring);` before `wiring.dockRegion.destroy();`.

The `destructor` loop needs no change: the dock's destructor destroys every region, `Split`s included.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`.

1. **Prerequisite and baseline.** Confirm `plans/implemented/dock-programmatic-split.md` exists and `grep -n "splitPanel(targetId" src/typescript/lib/overlay/Dock.ts` finds the method. In a worktree, symlink `node_modules` from the main tree (repo root and `packages/lib`). Run `npx vitest run tests/overlay/ tests/layout/DockRegion.styleRuleDisposal.test.ts tests/component/layout/Split.test.ts tests/component/layout/LayoutSerialization.test.ts`. All must pass before any edit.
2. **Tests first.** Create `tests/overlay/Dock.splitResize.test.ts` with every automated case in `## Expected Behaviour`, using the harness described there. Run it: every case fails, and `npm run typecheck:test` fails on `"splitresize"` until step 3 (expected).
3. **`overlay/Dock.ts` — types.** Add `DockSplitEvent` directly after `DockSplitOptions`, with the JSDoc from `## Public API`. Add `"splitresize"` to the `DockEvent` union. In `DockEvent`'s JSDoc, add a paragraph after the `"emptychange"` paragraph: "`"splitresize"` is also dock-wide: it fires when the user resizes a split from its gutter — once when a drag ends, once when a pane is collapsed or expanded — carrying a {@link DockSplitEvent}. Changes to the region tree fire the panel events instead." Add `splitresize?: (event: DockSplitEvent) => void;` to `DockOptions.listeners` after `exception`. Add the `on` / `off` / `emit` overloads from `## Public API`, each directly after its `"dblclick"` overload. Check: `npm run typecheck` passes.
4. **`overlay/Dock.ts` — wiring.** Add `wiredSplit` to `RegionWiring` and `wiredSplit: null` to the literal in `wireRegion`. Add `wireSplit`, `unwireSplit`, `emitSplitResize` and `panelIdsUnder` directly after `wireRegion`, and the two call sites, per `## Implementation`. Check: every case in `Dock.splitResize.test.ts` passes, and `grep -n "this.unwireSplit(wiring)" src/typescript/lib/overlay/Dock.ts` finds two calls: one in `wireSplit`, one in `teardownVanished`.
5. **`overlay/index.ts`.** Add `DockSplitEvent` to the `export type { … } from '~/overlay/Dock.js'` line. Check: `npm run typecheck` and `npm run typecheck:test` pass.
6. **Demo.** In `src/typescript/MiscPanel.ts`, in the Dock demo's logging block ([:1310–1316](../packages/lib/src/typescript/MiscPanel.ts#L1310)), add after the `exception` line:
   ```typescript
   dock.on("splitresize", e => console.log(`[Dock] splitresize: ${e.panels.map(ids => ids.join("+")).join(" | ")} ratios=${e.ratios.map(r => r.toFixed(2)).join("/")} collapsed=${e.collapsed.join(",")} -> ${e.window ? (e.window.getTitle() || "(window)") : "(tiled)"}`));
   ```
   It follows the block's existing inline-arrow style.[^demo]
7. **Docs.** Apply every edit in `## Documentation Impact`.
8. **Full verification.** Run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Create | `packages/lib/tests/overlay/Dock.splitResize.test.ts` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Harness — `tests/overlay/Dock.splitResize.test.ts`

Copy from `tests/overlay/Dock.lifecycle.test.ts`, as every Dock test file does: `CONFIG`, `captureRaf`, `flush`, `mountDock`, `priv`, `frameOf`, `regionsDock`, `floatPanel`, `sourceTabEntryId`, and the `afterEach`. Also import `DockSplitEvent` from `~/overlay/Dock`, `Split` from `~/layout/Split` and `SplitNode` from `~/layout/LayoutSerialization`. Add:

```typescript
// Records every "splitresize" payload.
function recordSplitResize(dock: Dock): DockSplitEvent[] {
    const log: DockSplitEvent[] = [];

    dock.on('splitresize', e => log.push(e));

    return log;
}

// Drives a full gutter drag through the gutter's own handlers. Both
// coordinates are set, so it works for either orientation. Pass from === to
// for a press and release that does not move.
function dragGutter(region: Component, index: number, from: number, to: number): void {
    const gutter = ((region.getLayoutManager() as Split) as any)._gutters[index];

    gutter.onDragStart({ clientX: from, clientY: from } as MouseEvent);
    gutter.onDrag({ clientX: to, clientY: to } as MouseEvent);
    gutter.onDragStop();
}

// Fires the gutter's "collapse" event, as its chevron does.
function clickChevron(region: Component, index: number): void {
    ((region.getLayoutManager() as Split) as any)._gutters[index].emit('collapse');
}

// The panel ids per pane, each sorted, for order-free comparison.
function sortedPanels(event: DockSplitEvent): string[][] {
    return event.panels.map(ids => [...ids].sort());
}
```

`specC` is `{ id: 'c', title: 'C', content: new Component({}) }`. Unless a case says otherwise, the setup is `regionsDock([['a'],['b']])` then `flush()`, which gives the root region `H[T(a),T(b)]`, 800 px wide, with ratios `[0.5, 0.5]`. Call the root region `root`. Compare every ratio element-wise with `toBeCloseTo(x, 5)`.

A throwaway probe at `c02c192f1` confirmed this harness: the root split of this setup has one gutter, `dragGutter(root, 0, 400, 300)` leaves ratios `[0.375, 0.625]`, a zero-move press fires `"paneresize"`, `emit('collapse')` collapses pane 0, a dock resize to 1000 px leaves the ratios at `[0.375, 0.625]` with no `Split` event, `setLayoutState` keeps the root region `Component` but gives it a new `Split` instance, and a split inside a `floatPanel` float has a gutter after `win.doLayout()`.

### Gutter gestures

| Case | Action | Expected |
|---|---|---|
| G1 | Record. Call the three handlers of `dragGutter(root, 0, 400, 300)` one at a time: assert after `onDragStart` and after `onDrag`, then after `onDragStop` | 0 events, 0 events, then exactly 1, before any `flush()`. Payload: `window` `null`; `ratios` `[0.375, 0.625]`, each close to the matching entry of `(dock.getLayoutState().root as SplitNode).ratios`; `collapsed` `[false, false]`; `panels` `[['a'], ['b']]` |
| G2 | Record; `dragGutter(root, 0, 400, 400)` | exactly 1 event; `ratios` `[0.5, 0.5]` |
| G3 | Record; `clickChevron(root, 0)`; then `clickChevron(root, 0)` again | 2 events: the first has `collapsed` `[true, false]`, the second `[false, false]`; both have `ratios` `[0.5, 0.5]` |
| G4 | Record; `(root.getLayoutManager() as Split).setPaneCollapsed(0, true)` | 1 event with `collapsed` `[true, false]` (a collapse from code is reported) |
| G5 | `const spy = vi.fn()`; `dock.on('splitresize', spy)`; `dock.off('splitresize', spy)`; `dragGutter(root, 0, 400, 300)` | `spy` not called |
| G6 | `new Dock({ layout: <regionsDock's two-region layout>, listeners: { splitresize: spy } })`, mounted and laid out as `regionsDock` does; `flush()`; `dragGutter(root, 0, 400, 300)` | `spy` called once |

### No event for container resizes and region-tree changes

Each case records after setup and expects **0** `"splitresize"` events after its last `flush()`.

| Case | Action | Also |
|---|---|---|
| N1 | `dock.setWidth(1000)`; `dock.doLayout()`; `flush()` | root ratios still `[0.5, 0.5]` |
| N2 | `(root.getLayoutManager() as Split).setPaneResizeWeight(root.getComponents()[0], 0)`; `dock.doLayout()`; `dock.setWidth(1000)`; `dock.doLayout()`; `flush()` | root ratios now differ from `[0.5, 0.5]` (the pinned pane kept its pixels), still no event |
| N3 | `dock.splitPanel('a', specC, 'right', { ratio: 0.4 })`; `dock.doLayout()`; `flush()` | returns `true`; root ratios `[0.3, 0.2, 0.5]` |
| N4 | `dock.splitPanel('a', specC, 'bottom')`; `dock.doLayout()`; `flush()` | returns `true`; root region `H[V[T(a),T(c)],T(b)]` |
| N5 | setup `regionsDock([['a'],['b'],['c']])`; `flush()`; `const bRegion = priv(dock).regionForFrame(frameOf(dock, 'b'))`; `dock.removePanel('b')`; `priv(dock).pruneRegion(bRegion)`; `dock.doLayout()`; `flush()` | root has two panes |

### Nested splits and floats

| Case | Setup | Action | Expected |
|---|---|---|---|
| P1 | default setup; `dock.splitPanel('a', specC, 'bottom')`; `flush()`; `dock.doLayout()`; `const v = root.getComponents()[0]`; record | `dragGutter(v, 0, 300, 200)` | 1 event: `window` `null`; `panels` `[['a'], ['c']]`; `ratios` equal `(v.getLayoutManager() as Split).getPaneRatios()` with `ratios[0] < 0.5` |
| P2 | as P1, then clear the log | `dragGutter(root, 0, 400, 300)` | 1 event; `sortedPanels` `[['a', 'c'], ['b']]` |
| P3 | `mountDock()`; `addPanel` `a` and `b`; `dock.doLayout()`; `flush()`; `const win = floatPanel(dock, 'a')`; `dock.splitPanel('a', 'b', 'right')`; `flush()`; `win.doLayout()`; `const split = priv(dock).windowContent(win)`; record | `dragGutter(split, 0, 100, 60)` | 1 event: `window` is `win`; `panels` `[['a'], ['b']]`. End the test with `win.requestClose(); flush();` |

### Restore and release

| Case | Setup | Action | Expected |
|---|---|---|---|
| R1 | default setup; `const oldSplit = root.getLayoutManager()`; `const state = dock.getLayoutState()`; `(state.root as SplitNode).collapsed = [true, false]`; record | `dock.setLayoutState(state)`; `flush()`; `dock.doLayout()` | 0 events; `root.getLayoutManager()` is not `oldSplit`; `isPaneCollapsed(0)` is `true` |
| R2 | continue R1 | `clickChevron(root, 0)` | exactly 1 event, `collapsed` `[false, false]` — the new instance is subscribed once |
| R3 | continue R2, clear the log | `(oldSplit as any).emit('paneresize', [])` | 0 events — the old instance was released |
| R4 | default setup; `dock.splitPanel('a', specC, 'bottom')`; `flush()`; `dock.doLayout()`; `const v = root.getComponents()[0]`; `const vSplit = v.getLayoutManager()`; `const cRegion = priv(dock).regionForFrame(frameOf(dock, 'c'))` | `dock.removePanel('c')`; `priv(dock).pruneRegion(cRegion)`; `dock.doLayout()`; `flush()`; record; `(vSplit as any).emit('panecollapse', 0, true)` | `priv(dock)._wiring.has(v)` is `false`; 0 events |

R4 relies on the single-pane `V` being removed: `pruneRegion` removes `T(c)` and `collapseSinglePaneSplit` hoists `T(a)` into the root in `V`'s place.

### Covered by `Split`'s own tests, not repeated

An outline drag fires `"paneresize"` once on release and not after `Escape` (`tests/component/layout/Split.resizeMode.test.ts`). A coalesced burst of moves fires once (`Split.test.ts`, *Split events*). `Dock` forwards those events unchanged.

### Manual verification (real browser; the offline DOM has no pointer drag or paint)

Demo app (`npm run dev`, `localhost:8015`), *Misc* page, **Dockable layout (Dock)**, console open.

| Case | Steps | Expected |
|---|---|---|
| MV1 | Drag the gutter between the Explorer/Search group and Editor, holding the mouse down for a moment before releasing | No `splitresize` line while dragging; one line on release, e.g. `[Dock] splitresize: explorer+search \| editor \| vbox_test ratios=0.25/0.42/0.33 collapsed=false,false,false -> (tiled)` |
| MV2 | Double-click a gutter's chevron, then again | One line each, `collapsed` `true` then back to `false` for that pane |
| MV3 | Resize the demo window by its border | No `splitresize` line |
| MV4 | Shift-drag the Editor tab into a float; drop Search on the float's right edge; drag the float's gutter | One line on release ending `-> Editor` (the float's title) |
| MV5 | **Save**, **Restore**, then drag a gutter | Exactly one line on release |

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` pass.
- `npm run lint` passes.
- `npx vitest run` — the whole suite passes, including `tests/overlay/Dock.splitResize.test.ts`.
- `npm run docs:api` finishes with zero warnings.
- `npm run docs:llms:check` passes.
- `grep -n 'this.emit("splitresize"' src/typescript/lib/overlay/Dock.ts` — exactly one match, in `emitSplitResize`.
- Manual cases MV1–MV5.

---

## Documentation Impact

`DockSplitEvent` is exported from `@jimka/typescript-ui/overlay` ([overlay/index.ts](../packages/lib/src/typescript/lib/overlay/index.ts)). Its API page is `/api/overlay/interfaces/DockSplitEvent`. In `Dock.ts` JSDoc, `{@link DockSplitEvent}` and `{@link Dock.getLayoutState}` resolve because they share the module. `Split` is linked as the Markdown link [`Split`](/api/layout/classes/Split), as the `Dock` class JSDoc already does.

- **[`docs/components/Dock.md`](../packages/lib/docs/components/Dock.md)**
  - *What the user can do*: add a row after "Drop a tab into another window": "Drag the gutter between two panes, or double-click its chevron" | "Resize the panes, or collapse / expand one; fires `splitresize`" | [`Split`](/api/layout/classes/Split).
  - *Panel lifecycle*, the bullet "**`Split` generates no events.**": replace with "**`Split` generates no per-panel events.** It is structural — it holds regions, never a panel directly. Resizing a split from its gutter fires the dock-wide [`splitresize`](#splitresize) instead."
  - *Panel lifecycle*, the paragraph "Alongside the per-panel events, one **dock-wide aggregate** event fires …" and its table: change the lead-in to "Alongside the per-panel events, two **dock-wide** events report changes that are not about one panel:" and add a table row: `splitresize` | the user resized a split from its gutter — a drag ended, or a pane was collapsed or expanded | `{ window, ratios, collapsed, panels }`. Keep the `emptychange` paragraph and its code sample as they are.
  - New subsection `### \`splitresize\`` directly before `### \`exception\``. Content:
    - It carries a [`DockSplitEvent`](/api/overlay/interfaces/DockSplitEvent): `window` (the host, as in the panel events), `ratios` (each pane's share, as `getLayoutState()` records it), `collapsed`, and `panels` (the open panel ids inside each pane — the way to tell which split moved, since regions are anonymous; read each as a set).
    - It fires once when a gutter drag ends — never while the pointer moves, and not after an outline drag is cancelled — and once when a pane collapses or expands. A press on a gutter that does not move it still fires, with the same ratios. It covers splits in the main dock and in floats, nested or not.
    - It does not fire when the dock or a float is resized, which rescales the panes without changing their ratios, nor for changes to the region tree — an edge drop, `splitPanel`, a pane pruned when its last panel leaves, `setLayoutState` — which fire the panel events instead.
    - Code sample:
      ```typescript
      dock.on('splitresize', () => localStorage.setItem('layout', JSON.stringify(dock.getLayoutState())));
      dock.on('splitresize', ({ panels, ratios }) => {
          const side = panels.findIndex(ids => ids.includes('explorer'));
          if (side >= 0) prefs.explorerShare = ratios[side];
      });
      ```
  - *Saving and restoring*: after the paragraph starting "Transport (localStorage, a server, debounced auto-save)", add: "To save as the user works, listen to `splitresize`, `attach`, `detach`, `move`, `close` and `focus`. Two changes fire no event — a tab reordered within its strip, and a float window moved or resized — so save on unload as well."
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — under `## Added` → `### Overlay`, creating either heading if missing in the shape of [`0.11.0.md`](../packages/lib/docs/reference/changelog/0.11.0.md): "**`Dock` emits `splitresize`** when the user resizes a split from its gutter — once when a drag ends, and once when a pane is collapsed or expanded — in the main dock or a float. Its [`DockSplitEvent`](/api/overlay/interfaces/DockSplitEvent) payload carries the host window, the pane ratios and collapsed flags, and the panel ids in each pane, so an application can save its layout without polling `getLayoutState()`. Window resizes and changes to the region tree do not fire it. See [Dock: `splitresize`](/components/Dock#splitresize)."
- **`docs/reference/migration/next.md`** — no entry: the event is new API.
- **`docs/layouts/Split.md`** — no change: `Split` is not modified.
- **`llms.txt`** — no change: no component is added.

---

## Potential Challenges

- **The two earlier plans move `Dock.ts`.** Mitigation: re-locate every line by symbol; if `DockSplitOptions` was not added, declare `DockSplitEvent` directly after `DockExceptionEvent` and report it.
- **A gutter beside a collapsed pane does not drag.** `SplitGutter.onDragStart` returns early on an opaque gutter. Mitigation: R2 uses the chevron, not a drag, after restoring a collapsed pane.
- **A split made in the same task is not wired yet.** The dock subscribes on the next sweep. Mitigation: every case that makes a split calls `flush()` before using its gutter. A real user cannot reach a gutter before the next frame.
- **Floating-point ratios.** `getLayoutState()` re-normalises the ratios it reads, so even that comparison can differ in the last bits. Mitigation: compare every ratio element-wise with `toBeCloseTo(x, 5)`, never `toEqual`.
- **Docs link warnings.** Mitigation: link `Split` as a Markdown link in `Dock.ts` JSDoc; never `{@link Split}` from `Dock.ts`.

---

## Critical Files

- [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) — the precedent: `RegionWiring` (:223), `wireRegion` (:1351, the `Tab` subscription and `onEmpty` at :1354–1393), `teardownVanished` (:1507), `hostForFrame` (:1247), `framesInWindow` (:2271), `isUnder` (:2313), `regionKind` (:1575), the `on` / `off` / `emit` overloads (:2337–2490), `DockOptions.listeners` (:102), `setLayoutState` (:617).
- [`layout/Split.ts`](../packages/lib/src/typescript/lib/layout/Split.ts) — `SplitEvent` (:50), `on` / `off` (:356–376), `setPaneCollapsed` (:521), `setPaneCollapsedImmediate` (:1393), `onDragEnd` (:1719), the gutter wiring in `doLayout` (:2237–2255), `getPaneRatios` (:1108), `applyPaneRatios` (:1226), the resize rescale in `recalculateSizes` (:2697).
- [`layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) — `nodeFor` (:277, the ratios and collapsed flags `getLayoutState` records), `populateContainer` (:586, the restore's new `Split` and its `setPaneCollapsedImmediate`).
- [`component/container/SplitGutter.ts`](../packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — `onDragStart` (:609), `onDragStop` (:638), the chevron's `"collapse"` (:211).
- [`plans/dock-programmatic-split.md`](dock-programmatic-split.md) (or its `implemented/` copy) — `splitPanel`, `DockSplitOptions`, and its footnote on this follow-up.
- [`tests/overlay/Dock.lifecycle.test.ts`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts) — the harness to copy (:27–109, `regionsDock` :289, `floatPanel` :487); [`tests/component/layout/Split.test.ts`](../packages/lib/tests/component/layout/Split.test.ts) — the gutter-drag driving the new helper copies (*Split events*, :1572).

---

## Non-Goals

- **A per-frame event during the drag.** Saving per frame is wasteful, and `Split` itself exposes no such event.[^grain]
- **A general `layoutchange` event covering every saved change** (tab reorder, float window move or resize, active tab). Each needs its own source; this plan covers the split gutter only.[^one-event]
- **Reporting `splitPanel`'s `ratio`, `Split.applyPaneRatios`, or a restore.** These are programmatic changes; see *When it fires*.[^split-panel]
- **Suppressing the event for a press that did not move the gutter.** That is `Split`'s contract for `"paneresize"`; changing it is a `Split` change.[^zero-move]
- **Reporting a window resize that changes a pinned pane's ratio.**[^window-resize]
- **Changing `Split`.**

---

## Notes

[^precedent]: `Dock` already turns inner layout-manager events into dock events in `wireRegion`: `Tab`'s `"tabclose"` becomes `"close"`, `"tabdblclick"` becomes `"dblclick"`, and `"beforetabclose"` becomes `"beforeclose"`. Each is subscribed once per `Tab` instance, with `wiredTab` compared by identity so that a manager rebuilt on the same region Component is re-wired. Those handlers are shared bound methods because each `Tab` payload names the content it concerns. `"paneresize"` and `"panecollapse"` carry only sizes or an index, so the listener must close over its region, which is what `onEmpty` already does for `Tab`'s `"empty"`. `ARCHITECTURE.md` forbids listening on another component through `Event`, but `Split` is a layout manager with a public `on` / `off` surface; subscribing through `on` is the sanctioned route.

[^one-event]: Two Dock events mirroring `Split` one to one (`"splitresize"` and `"splitcollapse"`) were weighed. A consumer saving the layout would subscribe both to the same handler, and a consumer reacting to a collapse can read `collapsed` from the payload. Both gestures change exactly the two arrays a `SplitNode` stores, so one event with that state is enough. A general `"layoutchange"` does not exist today. It would also need a tab reorder within a strip (silent today), a float window's position and size (no Dock event today) and an active-tab change, each with its own source and its own rules, which is a larger plan.

[^name]: Gutter-owning layouts name the event that fires once at the end of a drag `…resize`: `Split.paneresize`, `Accordion.sectionresize`. `Table`'s header uses `columnresize` for the per-move event and `columnresizeend` for the end, but that is a column drag with a separate start/move/end triple, not a layout's commit event. `"change"` in this library means "the value changed, from any source": `Slider`'s `"change"` fires for user steps and for `setValue`, while `"action"` is the user-only event. A `"splitchange"` would therefore promise reports of programmatic ratio writes, which this plan does not make (see *When it fires*). `Dock`'s own `"emptychange"` fires for any transition, user or code, which is consistent with that meaning.

[^payload]: `window` reuses `DockPanelEvent`'s meaning so a listener can tell the main dock from a float. `ratios` and `collapsed` are exactly what `SplitNode` stores, so a listener that keeps its own model can update it without calling `getLayoutState()`. `orientation` was left out: the panel ids already identify the split, and a consumer reacting to one split knows its axis. Exposing the region `Component` was rejected: regions are anonymous on purpose (the `move` docs say so), and a `Component` reference is not something a consumer can persist. `panels` lists ids from the registry (`_frames`) filtered by ancestry, the same walk `framesInWindow` uses for floats; the registry's order is insertion order, which is why the docs say to read each array as a set. The empty-state placeholder is never in `_frames`, so it never appears.

[^grain]: `Split` reports only the committed result (`"paneresize"` from `onDragEnd`), and its gutter's per-move `"drag"` is internal to `Split`. A Dock event per frame would need a new `Split` event, and a save per frame would write the whole layout dozens of times a second. The end-of-gesture event is what a persisting consumer needs, as `Split.md` already says of `"paneresize"`: "a listener can persist on every commit without debouncing".

[^window-resize]: `recalculateSizes` hands a container size change to the panes in proportion to their resize weights, which by default are their sizes, so each pane's ratio is kept (the probe saw `[0.375, 0.625]` before and after a resize from 800 to 1000 px). With a pane pinned through *Fix … pane width* (`weight: 0`), the pinned pane keeps its pixels and the ratios move. That drift is caused by the window, not by a gesture on the split, and it happens on every frame of a window resize. Firing then would flood a saving consumer. The pin itself is not saved (`SplitNode` has no weights), so a restore into a different window size cannot reproduce the drift anyway. A consumer that wants the drifted ratios gets them on its next save from any other event or on unload.

[^split-panel]: `dock-programmatic-split` writes `ratio` through `Split.applyPaneRatios`, which emits no `Split` event, and leaves the decision to this plan ("whether a programmatic ratio should count as a ratio change is left to that plan"). The decision is no: `splitPanel` changes the region tree, and the sweep after it reports that change through `"attach"` / `"move"` / `"detach"`, which a saving consumer already listens to. A `"splitresize"` as well would make one call produce two saves. The same holds for an edge drop. Adding an event to `applyPaneRatios` would change `Split` and would also fire during every restore, since `populateContainer` calls it.

[^restore]: `restoreLayout`'s `populateContainer` makes `new Split(…)`, calls `applyPaneRatios` (silent), then `setPaneCollapsedImmediate` for each saved collapsed pane, which emits `"panecollapse"` on the new instance. `Dock.setLayoutState` only schedules the sweep, so the new instance has no listener when that emit happens. R1 pins this. The old `Split` instance is detached by the restore; the next sweep's `wireSplit` sees the new instance and releases the old one (R3).

[^zero-move]: A press and release on a gutter runs `ResizeDrag.end()`, which returns `true` unless an outline drag was cancelled, so `Split.onDragEnd` emits `"paneresize"` with unchanged sizes. The probe confirmed it. `Dock` could suppress it by keeping each split's last reported state and comparing, but ratios are floats, so the comparison would need a tolerance, and the snapshot would go stale after a pinned pane's window-resize drift. Forwarding unchanged keeps `Dock` aligned with `Split`'s documented contract ("fires once a completed gutter drag settles"). A save handler that writes the same state twice is harmless. A press is also rare: the chevron is a separate element whose clicks do not start a gutter drag.

[^programmatic-collapse]: `Split` emits `"panecollapse"` from `setPaneCollapsed`, which both the chevron and code call, and from `setPaneCollapsedImmediate`. `Dock` cannot tell them apart without changing `Split`. `Dock` has no collapse method, so the only code path is a consumer calling a region's `Split` directly (through `getRootRegion().getLayoutManager()`), and a consumer doing that can expect the event. A restore is the one internal programmatic collapse, and it happens before the dock subscribes.

[^release]: `pruneRegion` and `collapseSinglePaneSplit` call `removeComponent`, which detaches without destroying. A detached region kept alive could in principle be wired again under a new `RegionWiring`; with the old subscription still on its `Split`, every gesture would then emit twice — the stacking-listener failure `ListenerBag.add` allows, since it appends. Storing the listener costs one field and makes the release exact. It also keeps the semantic-listener counter in the diagnostics flat across drag sessions. The `Tab` wiring was not changed to match: that is outside this plan.

[^demo]: The manual cases need the event visible from the running app, and the demo's logging block is where every other Dock event is shown. Its existing `dock.on(…)` listeners are inline arrows; the named-function rule in `ARCHITECTURE.md` is for library code, and matching the surrounding demo style keeps the change local.
