---
depends-on: [dock-reveal-panel-without-focus]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/src/typescript/lib/overlay/index.ts
  - packages/lib/src/typescript/lib/layout/DockRegion.ts
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/docs/components/Dock.md
  - packages/lib/docs/layouts/Tab.md
  - packages/lib/docs/reference/changelog/next.md
---

# Dock Programmatic Split — Implementation Plan

## Overview

[`Dock`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L257) can only split a region when the user drops a dragged tab on a region edge ([`DockRegion`'s `onDrop`](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L87)) or when `setLayoutState` rebuilds a saved tree. An editor app needs commands such as *Split Editor Right* and *Move Editor Down*: from code, put a panel into a new pane beside another panel.

This plan adds `Dock.splitPanel(targetId, panel, side, options?)`. It runs the edge drop's own split code — the same legality check and the same wrap-or-insert rule in `DockRegion` — and adds only what a drop gets for free from the drag: finding the target's region, registering a new panel, dropping the moved tab from its old strip, and activating the panel. Three files change in the library: [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts), [`layout/DockRegion.ts`](../packages/lib/src/typescript/lib/layout/DockRegion.ts) (an `@internal` entry point onto the existing split, plus an optional pane share), and [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts) (a public `removeMovedTab`, the programmatic twin of what a finished drag already does).

This plan depends on [`dock-reveal-panel-without-focus`](dock-reveal-panel-without-focus.md), which adds `focusPanel(id, options?)` with a per-call `focus` option (typed `DockFocusPanelOptions`); `splitPanel` activates the panel through it. It does not plan the event for a split ratio changed by a gutter drag; a follow-up plan does.

---

## Architecture Decisions

### One method: `splitPanel(targetId, panel, side, options?)`

`Dock` gains `splitPanel(targetId: string, panel: string | DockPanelSpec, side: Edge, options?: DockSplitOptions): boolean`. A string `panel` names a registered panel: it is moved when open and re-opened when it was closed. A `DockPanelSpec` is registered and opened as `addPanel` would. The required inputs are positional and the optional ones go in a bag, like `focusPanel(id, options?)`. It returns `false` for an unknown id or a split that would change nothing, like `focusPanel` and `removePanel` do.[^api-shape] The edge type is the existing [`Edge`](../packages/lib/src/typescript/lib/primitive/Edge.ts#L23) that `DropZone` is built from.[^side-name]

### The split runs through the drop path's own code in `DockRegion`

`DockRegion` gains an `@internal` method `dropOnEdge(panel, side, options?)` that calls the existing `isLegalDrop` and then the existing `splitOnEdge` — the two calls `onDrop` makes ([DockRegion.ts:98–111](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L98)). `Dock.splitPanel` reaches it through the target region's `DockRegion`, which `Dock` already keeps in `_wiring` for every region it wires ([Dock.ts:1351](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1351)). No split, insert, wrap, stack-making or prune logic is copied into `Dock`.[^reuse-dockregion]

This means `splitPanel` follows the drop's structure rule exactly. The **unit** is the target panel's tab group — the `Tab` region whose container child the target is.

| Unit's container | Result |
|---|---|
| A `Split` running the way `side` splits (`left`/`right` → horizontal, `top`/`bottom` → vertical) | Insert: the new group joins that `Split`, just before (`left`/`top`) or just after (`right`/`bottom`) the unit. No new nesting. |
| Anything else — a perpendicular `Split`, the `Dock` itself, a float `Window` | Wrap: a fresh `Split` takes the unit's slot; the unit and the new group are its two panes, the new group first for `left`/`top`. |

Worked cases, written as region trees: `T(a,b)` is a tab group holding panels `a` and `b`; `H[…]` / `V[…]` is a horizontal / vertical `Split`.

| Before | Call | After |
|---|---|---|
| `T(a,b)` | `splitPanel('a', 'b', 'right')` | `H[T(a),T(b)]` |
| `H[T(a),T(b)]` | `splitPanel('a', specC, 'right')` | `H[T(a),T(c),T(b)]` |
| `H[T(a),T(b)]` | `splitPanel('a', specC, 'bottom')` | `H[V[T(a),T(c)],T(b)]` |
| `H[T(a),T(b)]` | `splitPanel('b', 'a', 'bottom')` | `V[T(b),T(a)]` — `T(a)` empties and is pruned, the one-pane `H` collapses |

### The target region is the target panel's parent `Tab` region; a `TabWindow` is refused

`splitPanel` takes the target's region from the target frame's parent component. It does not use `regionForFrame`, which searches for the panel's *strip cell* — the tab-button entry `Tab` creates for a child on its next layout — so a panel added earlier in the same task can be a target.[^target-parent] The parent must be a `Tab` region and must not be a [`TabWindow`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L62). A panel in a strip-mode tear-off window therefore returns `false`: the drag path has no edge drop there either, because `Dock` never gives a `TabWindow` a `DockRegion`.[^tabwindow] A target in a float built from a Shift tear-off (a bare `Window` that `Dock` adopts as a mini-dock of its own tab groups) splits inside that float, as a drop there does.

### A new public `Tab.removeMovedTab(content)` drops the old strip cell

When a drag moves a tab's content elsewhere, the source strip's `"detach"` handler drops the orphaned cell after the drop has run ([Tab.ts:1574](../packages/lib/src/typescript/lib/layout/Tab.ts#L1574), reached from `DragManager`'s `endSession` after `onDrop`, [DragManager.ts:747–757](../packages/lib/src/typescript/lib/overlay/DragManager.ts#L747)). A move from code has no drag, and `Tab.doLayout` never removes cells for children that left. `Tab` gains `removeMovedTab(content): boolean`, a public wrapper over the private `removeEntryKeepingContent` with the same "has it left?" guard the `"detach"` handler applies.[^remove-moved-tab] `splitPanel` calls it on the panel's old `Tab` after the split, the same order a drag uses, so the old group is already empty when its `"empty"` event prunes it.[^release-order]

### The panel is activated through `focusPanel(id, { focus })`, and `"focus"` fires before `splitPanel` returns

`Dock`'s *sweep* is its pass, coalesced to one per animation frame, that wires every region (a `DockRegion` and the `Tab` listeners) and then compares each panel's host and region with the previous pass to emit events. After the split, `splitPanel` wires the new group at once (`wireRegion(stack)`, the sweep's own step), creates the panel's strip cell at once (`Tab.createTab`), and calls `focusPanel(id, { focus: options?.focus })`. It then sets `_lastActiveRegion` to the new group, so a later `addPanel` opens beside the split panel.[^eager-cell] The dock's `"focus"` event therefore fires synchronously, before the `"attach"` / `"move"` / `"detach"` events that the next sweep emits.[^focus-order]

Keyboard focus follows `focusPanel`'s rules from the reveal plan. A target in a float raises that float; with `focus` omitted the window's `autoFocus` decides, `focus: false` raises it without moving focus, and `focus: true` takes focus into it. The new group's tab button is not rendered yet, so `splitPanel` never moves focus onto it, whatever `focus` says. Focusing the panel's own content stays the application's job. `DockSplitOptions` declares its own `focus` field rather than extending `DockFocusPanelOptions`, because that interface's documentation promises a focus move onto the tab that a split cannot make.

### The new pane's share: the drop's sizing by default, `ratio` on request

Without `ratio`, `splitPanel` sizes the new pane exactly as an edge drop does: half of a fresh wrap `Split`, or an equal `1/(n+1)` share taken proportionally from every pane when it joins an existing same-direction `Split` ([Split.ts:2770–2798](../packages/lib/src/typescript/lib/layout/Split.ts#L2770)).[^ratio-default] With `ratio`, the new pane takes that fraction of the unit's own share and the unit keeps the rest; other panes keep their shares. Both cases write through the existing [`Split.applyPaneRatios`](../packages/lib/src/typescript/lib/layout/Split.ts#L1226).

| Before (pane shares) | Call | After (pane shares) |
|---|---|---|
| `T(a,b)` (no `Split`) | `splitPanel('a', specC, 'right', { ratio: 0.25 })` | `H[T(a,b) 0.75, T(c) 0.25]` |
| `T(a,b)` | `splitPanel('a', specC, 'left', { ratio: 0.25 })` | `H[T(c) 0.25, T(a,b) 0.75]` |
| `H[T(a) 0.5, T(b) 0.5]` | `splitPanel('a', specC, 'right', { ratio: 0.4 })` | `H[T(a) 0.3, T(c) 0.2, T(b) 0.5]` |
| `H[T(a) 0.5, T(b) 0.5]` | `splitPanel('a', specC, 'right')` | `H[T(a) ⅓, T(c) ⅓, T(b) ⅓]` (drop sizing) |

A `Split` with a pane that has no stored size yet (never laid out) counts every pane as an equal share before carving.[^ratio-carve] A `ratio` outside `(0, 1)` throws an `Error` before anything changes.[^ratio-throw]

### `splitPanel` returns `false` for every drop the drag path would refuse

`dropOnEdge` returns `null` when `isLegalDrop` refuses, and `splitPanel` then returns `false` with no change. For a `Dock` panel that means: the panel is the target itself and the target's group holds nothing else, or the panel is the only tab of a group that already sits right beside the unit on that side. `isLegalDrop` and its two `isRedundant…` helpers take the dragged component as an argument instead of looking it up in `tabDragRegistry`, which only holds components during a drag; the drag path passes the registry lookup as before.[^illegal]

### Events: whatever the sweep's host diff finds, as for a drop

`splitPanel` schedules the sweep; its host diff emits the events, the same code that reports a drop ([Dock.ts:1204](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1204)). A newly opened panel fires `"attach"`; a moved panel in the same host fires `"move"`; a moved panel whose host changes fires `"detach"` then `"attach"`. `splitPanel` adds no new `DockEvent` and fires no `Split` event.[^follow-up]

---

## Public API

```typescript
// overlay/Dock.ts — new, exported, declared directly after DockFocusPanelOptions
// (which the reveal plan declares after DockExceptionEvent)

/**
 * Options for {@link Dock.splitPanel}.
 *
 * @category Core
 */
export interface DockSplitOptions {
    /**
     * Whether the split may move keyboard focus. It is passed to the
     * panel's activation as `DockFocusPanelOptions.focus`. In practice it
     * decides only the raise of a float that holds the target: omitted, the
     * window's `autoFocus` decides; `false` raises it without moving focus;
     * `true` takes focus into it also when it was built with
     * `autoFocus: false`. The panel's new tab is not rendered yet when it is
     * activated, so a split never moves focus onto that tab.
     */
    focus?: boolean;
    /**
     * The new pane's share of the target group's slot, along the split, as a
     * fraction between 0 and 1, exclusive; the target group keeps the rest.
     * Omit it to size the new pane as an edge drop does: half of a new split,
     * or an equal share taken from every pane when the pane joins a split that
     * already runs that way.
     */
    ratio?: number;
}
```

```typescript
// Dock — new method, placed directly after focusPanel
/**
 * Puts a panel in a new pane beside the panel `targetId`, on `side` — the
 * programmatic form of dropping a tab on a region edge. The target's whole
 * tab group is split: when that group already sits in a split running the
 * same way, the new pane joins that split next to it; otherwise the group
 * and the new pane become the two panes of a new split. The panel lands as
 * the only tab of its own new tab group and becomes the active panel, which
 * fires `"focus"` before this method returns. Its `"attach"` (a newly opened
 * panel), `"move"` (same host) or `"detach"` then `"attach"` (another host)
 * follow on the next frame, as for a drop.
 *
 * @param targetId - The panel to split beside. It must be open in the tiled
 *   tree or in a float that holds this dock's tab groups; a panel in a
 *   strip-mode tear-off window cannot be split beside.
 * @param panel - The id of a registered panel — moved when open, opened again
 *   when it was closed — or a spec to register and open, as `addPanel` takes.
 *   A spec whose id is already open moves that panel.
 * @param side - The edge of the target's tab group the new pane goes on.
 * @param options - The new pane's share, and whether activating the panel may
 *   move keyboard focus.
 *
 * @returns `true` when the split was made; `false` when `targetId` is not an
 *   open panel in a tab group that can be split, `panel` is an unknown id, or
 *   the split would leave the layout as it is — the panel is the target's only
 *   tab, or already sits alone right beside it on that side.
 *
 * @throws Error - When `options.ratio` is not between 0 and 1, exclusive, or
 *   a spec's `content` factory returns a promise.
 */
splitPanel(targetId: string, panel: string | DockPanelSpec, side: Edge, options?: DockSplitOptions): boolean;
```

```typescript
// layout/Tab.ts — new public method, placed directly after closeTab
/**
 * Removes the tab of `content` after `content` has been moved out of this
 * tab's container — the clean-up a finished tab drag performs, for a caller
 * that moves the content itself. The cell goes and the next tab is selected;
 * `content` is not destroyed and no `"tabclose"` fires. `"empty"` fires when
 * this was the last tab. A deferred activation of `content` that has not
 * applied yet is dropped too.
 *
 * @param content - The content component that has already left this tab's container.
 *
 * @returns `true` when a tab was removed; `false` when `content` is still a
 *   child of this tab's container (close it with `closeTab` instead) or no tab
 *   hosts it.
 */
removeMovedTab(content: Component): boolean;
```

```typescript
// layout/DockRegion.ts — new method, @internal (Dock's entry point; not documented)
/**
 * @internal
 * Performs an edge drop of `panel` on this region from code: the same
 * legality check and the same split `onDrop` runs, without a drag.
 *
 * @param panel - The content component to re-home.
 * @param side - The edge of this region to split on.
 * @param options - `constraints` for a panel that has no parent yet (a moved
 *   panel carries its own); `ratio` for the new pane's share of the unit's
 *   slot (see splitOnEdge).
 *
 * @returns The new tab stack now holding `panel`, or `null` when the drop
 *   would be refused.
 */
dropOnEdge(panel: Component, side: Edge, options?: { constraints?: LayoutConstraints; ratio?: number }): Container | null;
```

`overlay/index.ts` adds `DockSplitOptions` to the `export type { … } from '~/overlay/Dock.js'` line ([index.ts:29](../packages/lib/src/typescript/lib/overlay/index.ts#L29)). No new state-bearing property and no options-bag field: every value is per call.

---

## Implementation

### `Dock.splitPanel` and its two helpers

```typescript
splitPanel(targetId: string, panel: string | DockPanelSpec, side: Edge, options?: DockSplitOptions): boolean {
    const ratio = options?.ratio;

    if (ratio !== undefined && !(ratio > 0 && ratio < 1)) {
        throw new Error(`Dock.splitPanel: ratio must be between 0 and 1, exclusive; got ${ratio}.`);
    }

    const region = this.splitTargetRegion(targetId);

    if (!region) {
        return false;
    }

    const frame = this.splitSourceFrame(panel);

    if (!frame) {
        return false;
    }

    // Read before the move: afterwards the frame's parent is the new stack.
    const fresh       = frame.getParentComponent() === null;
    const sourceTab   = this.ownerTab(frame);
    const constraints = fresh ? this.leafConstraints(this._panels.get(frame.getId())!) : undefined;

    // The target region is wired by the sweep; one added in this task may not be yet.
    this.wireRegion(region);

    const stack = this._wiring.get(region)!.dockRegion.dropOnEdge(frame, side, { constraints, ratio });

    if (!stack) {
        return false;
    }

    // A drag drops the old cell after the drop; do the same, so the old
    // region is already empty when its "empty" event prunes it.
    sourceTab?.removeMovedTab(frame);
    this.activateSplitPanel(stack, frame, fresh, options?.focus);
    this.scheduleSweep();

    return true;
}
```

```typescript
/**
 * The tab region `splitPanel` splits for `targetId`: the open frame's parent
 * when it is a `Tab` region of this dock — the tiled tree or an adopted float.
 * Read from the parent, not from the strip cells, so a panel added in the same
 * task qualifies. A `TabWindow` is refused: it holds no `DockRegion`.
 */
private splitTargetRegion(targetId: string): Component | null {
    const parent = this._frames.get(targetId)?.getParentComponent() ?? null;

    if (!parent || parent instanceof TabWindow || !this.isTab(parent)) {
        return null;
    }

    return parent;
}

/**
 * The identity frame `splitPanel` moves: a registered id's frame (built again
 * when it was closed), or a spec registered first, as `addPanel` does.
 */
private splitSourceFrame(panel: string | DockPanelSpec): Component | null {
    if (typeof panel === "string") {
        return this.resolvePanel(panel);
    }

    this._panels.set(panel.id, panel);

    return this.resolvePanel(panel.id);
}

/**
 * Wires the new stack, gives the panel its strip cell, and activates it.
 * `_frameRegion` is seeded only for a panel entering the dock for the first
 * time (as addPanel does); a moved panel keeps its old entry so the sweep
 * reports the "move". `_lastActiveRegion` is set last because the activation
 * runs onPanelFocused, which writes it from the not-yet-updated `_frameRegion`.
 */
private activateSplitPanel(stack: Component, frame: Component, fresh: boolean, focus: boolean | undefined): void {
    this.wireRegion(stack);
    (stack.getLayoutManager() as Tab).createTab(frame);

    if (fresh) {
        this._frameRegion.set(frame.getId(), stack);
    }

    this.focusPanel(frame.getId(), { focus });
    this._lastActiveRegion = stack;
}
```

### `DockRegion` changes

`isLegalDrop` gains a third parameter with a default, so both existing call sites (`onDragOver`, `onDrop`) stay as they are:

```typescript
private isLegalDrop(componentId: string, zone: DropZone, dragged: Component | undefined = tabDragRegistry.get(componentId)): boolean {
    // … ancestor walk and sole-content check unchanged …

    if (zone === "center") {
        return !this.isRedundantCenterDrop(dragged);
    }

    return !this.isRedundantEdgeDrop(dragged, zone);
}

private isRedundantCenterDrop(dragged: Component | undefined): boolean { /* body unchanged minus its registry lookup line */ }
private isRedundantEdgeDrop(dragged: Component | undefined, zone: DropZone): boolean { /* same */ }
```

`dropOnEdge`:

```typescript
dropOnEdge(panel: Component, side: Edge, options?: { constraints?: LayoutConstraints; ratio?: number }): Container | null {
    if (!this.isLegalDrop(panel.getId(), side, panel)) {
        return null;
    }

    return this.splitOnEdge(panel, side, options);
}
```

`splitOnEdge(panel, zone)` becomes `splitOnEdge(panel: Component, zone: DropZone, options?: { constraints?: LayoutConstraints; ratio?: number }): Container`. Its changes:

1. `stack.moveComponent(panel)` becomes `stack.moveComponent(panel, undefined, options?.constraints)`. With `constraints` undefined the old parent's constraints are carried, as today.
2. Every `return;` becomes `return stack;`, and the method ends with `return stack;`.
3. In the insert branch (the container is a same-axis `Split`), after `container.moveComponent(stack, …)`:
   `if (options?.ratio !== undefined) { this.carveSlot(containerLm, container, unit, stack, options.ratio); }`
4. In the wrap branch, after the `transferPaneSize` block:
   `if (options?.ratio !== undefined) { (split.getLayoutManager() as Split).applyPaneRatios(leading ? [options.ratio, 1 - options.ratio] : [1 - options.ratio, options.ratio]); }`
5. The first branch (the region is itself a same-axis `Split`) ignores `ratio`. `Dock` never reaches it, because its targets are always `Tab` regions; say so in the `@param options` line of `splitOnEdge`'s JSDoc.

```typescript
/**
 * Gives the freshly inserted `stack` `ratio` of `unit`'s share of `container`'s
 * `Split`, leaving every other pane's share alone. Shares are the stored pane
 * sizes; when any pane other than `stack` has none yet (never laid out), every
 * pane counts as an equal share.
 */
private carveSlot(lm: Split, container: Component, unit: Component, stack: Component, ratio: number): void {
    const panes  = container.getComponents();
    const sized  = panes.every(pane => pane === stack || lm.getPaneSize(pane) !== undefined);
    const shares = panes.map(pane => (sized ? (lm.getPaneSize(pane) ?? 0) : 1));

    const unitIndex = panes.indexOf(unit);
    const unitShare = shares[unitIndex];

    shares[panes.indexOf(stack)] = unitShare * ratio;
    shares[unitIndex]            = unitShare * (1 - ratio);

    lm.applyPaneRatios(shares);
}
```

### `Tab.removeMovedTab`

```typescript
removeMovedTab(content: Component): boolean {
    if (this.getContainer()?.getComponents().includes(content)) {
        return false;
    }

    if (this._pendingActiveContent === content) {
        this._pendingActiveContent = null;
    }

    const entry = this._contents.find(e => e.component === content);

    if (!entry) {
        return false;
    }

    this.removeEntryKeepingContent(entry.id);

    return true;
}
```

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Line numbers were taken at `43b5dd0fe`; the reveal plan shifts `Dock.ts`, so re-locate by symbol.

1. **Prerequisite and baseline.** Confirm `plans/implemented/dock-reveal-panel-without-focus.md` exists and `grep -n "DockFocusPanelOptions" src/typescript/lib/overlay/Dock.ts` finds the interface and `focusPanel(id: string, options?: DockFocusPanelOptions)`. In a worktree, symlink `node_modules` from the main tree (repo root and `packages/lib`). Run `npx vitest run tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.closeDisposal.test.ts tests/overlay/Dock.styleRuleDisposal.test.ts tests/layout/DockRegion.styleRuleDisposal.test.ts tests/component/layout/Tab.test.ts tests/component/layout/Tab.lifecycle.test.ts tests/component/layout/Split.collapseUndisplay.test.ts`. All must pass before any edit.
2. **Tests first.** Add the `removeMovedTab` cases (RM1–RM6) to `tests/component/layout/Tab.test.ts` as a new `describe('Tab removeMovedTab')` at the end of the file, using its `hostTab` helper. Create `tests/overlay/Dock.splitPanel.test.ts` with every other automated case in `## Expected Behaviour`. Copy the harness from `tests/overlay/Dock.lifecycle.test.ts` — `CONFIG`, `captureRaf`, `flush`, `mountDock`, `priv`, `frameOf`, `regionsDock`, `floatPanel`, `sourceTabEntryId`, the `afterEach` — as every Dock test file does, and add the `shape`, `entries` and `tabsDock` helpers given in `## Expected Behaviour`. Run both files: every new case fails (`npm run typecheck:test` fails until step 6; expected).
3. **`layout/Tab.ts`.** Add `removeMovedTab` directly after `closeTab` ([:1251](../packages/lib/src/typescript/lib/layout/Tab.ts#L1251)) per `## Implementation`, with the JSDoc from `## Public API`. Check: RM1–RM6 pass.
4. **`layout/DockRegion.ts`.**
   a. Change `isLegalDrop` ([:281](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L281)), `isRedundantCenterDrop` ([:313](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L313)) and `isRedundantEdgeDrop` ([:353](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L353)) per `## Implementation`. Each `isRedundant…` loses its `const dragged = tabDragRegistry.get(componentId);` line; replace its `@param componentId` with `@param dragged - The dragged content component, or undefined when it cannot be resolved.` Add the same `@param dragged` line to `isLegalDrop`, saying it defaults to the drag registry's entry. Check: the step-1 command still passes.
   b. Add `import type { Edge } from "~/primitive/Edge.js";` and `import type { LayoutConstraints } from "~/layout/LayoutConstraints.js";`. Change `splitOnEdge` ([:436](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L436)) per the numbered list in `## Implementation`; add `@param options` and `@returns The new tab stack holding panel.` to its JSDoc. Add `carveSlot` after `splitOnEdge`, and `dropOnEdge` directly after `destroy()` ([:131](../packages/lib/src/typescript/lib/layout/DockRegion.ts#L131)) with the `@internal` JSDoc from `## Public API`. Check: `grep -n "splitOnEdge(" src/typescript/lib/layout/DockRegion.ts` shows the definition, the `onDrop` call and the `dropOnEdge` call only; `npm run typecheck` passes.
5. **`overlay/Dock.ts`.** Add `import type { Edge } from "~/primitive/Edge.js";`. Add `DockSplitOptions` directly after `DockFocusPanelOptions`. Add `splitPanel` directly after `focusPanel`, and `splitTargetRegion`, `splitSourceFrame`, `activateSplitPanel` directly after `splitPanel`, per `## Implementation`, with full JSDoc. In `DockPanelSpec.content`'s JSDoc ([:53–57](../packages/lib/src/typescript/lib/overlay/Dock.ts#L53)) change "{@link Dock.addPanel} throws on one" to "{@link Dock.addPanel} and {@link Dock.splitPanel} throw on one". Check: every case in `Dock.splitPanel.test.ts` passes; `grep -n "removeEntryKeepingContent\|splitOnEdge" src/typescript/lib/overlay/Dock.ts` finds nothing.
6. **`overlay/index.ts`.** Add `DockSplitOptions` to the `export type { … } from '~/overlay/Dock.js'` line. Check: `npm run typecheck` and `npm run typecheck:test` pass.
7. **Demo.** In `src/typescript/MiscPanel.ts`, in the Dock demo ([:1246–1371](../packages/lib/src/typescript/MiscPanel.ts#L1246)): keep `let focusedPanelId: string | null = null;` updated from a `dock.on("focus", …)` listener next to the existing logging listeners, and add two toolbar buttons after `addFailingButton` ([:1362](../packages/lib/src/typescript/MiscPanel.ts#L1362)). **Split right** calls `dock.splitPanel(focusedPanelId, { id: "split-" + n, title: "Split", content: dockPanel("Split — opened beside the focused panel.") }, "right")`; **Split down** does the same with `"bottom"` and `{ ratio: 0.3 }`. Both increment a shared counter `n`, do nothing when `focusedPanelId` is `null`, and `console.log` the returned boolean as `[Dock] splitPanel: <result>`. Follow the demo's existing inline-arrow listener style.[^demo]
8. **Docs.** Apply every edit in `## Documentation Impact`.
9. **Full verification.** Run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/DockRegion.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Create | `packages/lib/tests/overlay/Dock.splitPanel.test.ts` |
| Modify | `packages/lib/tests/component/layout/Tab.test.ts` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/layouts/DockRegion.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unless a case says otherwise, call `flush()` after the action before asserting events, and assert the return value and tree shape straight after the call. `specC` is `{ id: 'c', title: 'C', content: new Component({}) }` (and likewise `specD`). Helpers for `Dock.splitPanel.test.ts`, beside the copied harness:

```typescript
// Region tree as text: T(a,b) is a Tab region holding frames a and b in child
// order; H[…] / V[…] is a horizontal / vertical Split region.
function shape(region: Component): string {
    const lm = region.getLayoutManager();

    if (lm instanceof Split) {
        return `${lm.getOrientation() === 'horizontal' ? 'H' : 'V'}[${region.getComponents().map(shape).join(',')}]`;
    }

    return `T(${region.getComponents().map(child => child.getId()).join(',')})`;
}

// The content ids a Tab region's strip still has cells for.
function entries(region: Component): Array<string | undefined> {
    return ((region.getLayoutManager() as any)._contents as Array<{ component: Component | null }>)
        .map(entry => entry.component?.getId());
}

// mountDock(), addPanel({ id, title: id.toUpperCase(), content: new Component({}) })
// per id, doLayout(), flush(): root T(ids…).
function tabsDock(ids: string[]): Dock { /* … */ }
```

`regionsDock([['a'],['b']])` gives `H[T(a),T(b)]`; `regionsDock([['a','b'],['c']])` gives `H[T(a,b),T(c)]`; call `flush()` after building either.

### Structure — `Dock.splitPanel.test.ts`

| Case | Setup | Call | Returns | Root `shape` after |
|---|---|---|---|---|
| St1 | `tabsDock(['a','b'])` | `splitPanel('a', 'b', 'right')` | `true` | `H[T(a),T(b)]` |
| St2 | `tabsDock(['a','b'])` | `splitPanel('a', 'b', 'left')` | `true` | `H[T(b),T(a)]` |
| St3 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'right')` | `true` | `H[T(a),T(c),T(b)]` |
| St4 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'bottom')` | `true` | `H[V[T(a),T(c)],T(b)]` |
| St5 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'top')` | `true` | `H[V[T(c),T(a)],T(b)]` |
| St6 | `regionsDock([['a'],['b']])` | `splitPanel('b', 'a', 'bottom')` | `true` | `V[T(b),T(a)]` |
| St7 | `tabsDock(['a','b'])` | `splitPanel('a', 'a', 'right')` | `true` | `H[T(b),T(a)]` |

Also assert that the old group keeps no strip cell for the moved panel: in St1, `entries` of `a`'s region is `['a']`; in St7, `entries` of `b`'s region is `['b']`.

### Refused calls — `Dock.splitPanel.test.ts`

Each refused call leaves `shape` unchanged and emits no dock event after `flush()`.

| Case | Setup | Call | Expected |
|---|---|---|---|
| N1 | `tabsDock(['a'])` | `splitPanel('nope', specC, 'right')` | `false`; `priv(dock)._panels.has('c')` is `false` |
| N2 | `tabsDock(['a'])` | `splitPanel('a', 'nope', 'right')` | `false` |
| N3 | `regionsDock([['a'],['b']])` | `splitPanel('a', 'a', 'right')` | `false` (the target's only tab) |
| N4 | `regionsDock([['a'],['b']])` | `splitPanel('a', 'b', 'right')`, then `splitPanel('b', 'a', 'left')` | both `false` (already the neighbour) |
| N5 | `tabsDock(['a'])` | `splitPanel('a', specC, 'right', { ratio })` for each of `0`, `1`, `-0.5`, `1.5`, `NaN` | throws `Error`; `priv(dock)._panels.has('c')` is `false` |
| N6 | `tabsDock(['a'])` | `splitPanel('a', { id: 'c', title: 'C', content: async () => new Component({}) }, 'right')` | throws (the same `Error` `addPanel` throws); `shape` unchanged |
| N7 | `tabsDock(['a','b'])`; tear `a` off into a `TabWindow` the way `Dock.panelPresentation.test.ts` does ([:273–283](../packages/lib/tests/overlay/Dock.panelPresentation.test.ts#L273), `forceBare: false`); `scheduleSweep()`; `flush()` | `splitPanel('a', 'b', 'right')` | `false`; `b` still in the root region. Close the `TabWindow` with `requestClose()` and `flush()` at the end |

### Pane shares — `Dock.splitPanel.test.ts`

Read shares with `(splitRegion.getLayoutManager() as Split).getPaneRatios()` and compare each with `toBeCloseTo(x, 5)`. For R1–R3, check straight after the call and again after `dock.doLayout()`; for R4–R5, only after `dock.doLayout()`.

| Case | Setup | Call | `Split` checked | Shares |
|---|---|---|---|---|
| R1 | `tabsDock(['a','b'])` | `splitPanel('a', specC, 'right', { ratio: 0.25 })` | root `H[T(a,b),T(c)]` | `[0.75, 0.25]` |
| R2 | `tabsDock(['a','b'])` | `splitPanel('a', specC, 'left', { ratio: 0.25 })` | root `H[T(c),T(a,b)]` | `[0.25, 0.75]` |
| R3 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'right', { ratio: 0.4 })` | root `H[T(a),T(c),T(b)]` | `[0.3, 0.2, 0.5]` |
| R4 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'right')` | root, after `dock.doLayout()` only | `[⅓, ⅓, ⅓]` (drop sizing) |
| R5 | `tabsDock(['a','b'])` | `splitPanel('a', specC, 'right')` | root, after `dock.doLayout()` only | `[0.5, 0.5]` |

### Events — `Dock.splitPanel.test.ts`

Record `attach`, `detach` and `move` as `{ type, id, window }` after setup (extend `recordHostEvents` from `Dock.lifecycle.test.ts` with `move`).

| Case | Setup | Call | Events after `flush()` | Also |
|---|---|---|---|---|
| E1 | `regionsDock([['a','b'],['c']])` | `splitPanel('c', 'b', 'bottom')` | `[move b null]` | shape `H[T(a),V[T(c),T(b)]]`; `entries` of `a`'s region is `['a']` |
| E2 | `regionsDock([['a'],['b']])` | `splitPanel('a', specC, 'right')` | `[attach c null]` | — |
| E3 | `tabsDock(['a'])`; `addPanel({ id: 'c', title: 'C', content: () => new Component({}) })` (a factory, so the panel can be rebuilt after a close); `doLayout()`; `flush()`; `removePanel('c')`; `flush()` | `splitPanel('a', 'c', 'right')` | `[attach c null]` | returns `true`; shape `H[T(a),T(c)]` |
| E4 | `tabsDock(['a','b'])`; `const win = floatPanel(dock, 'a')` | `splitPanel('a', 'b', 'right')` | `[detach b null, attach b win]` | `shape(priv(dock).windowContent(win))` is `H[T(a),T(b)]`; root shape `T()` |
| E5 | as N7, with the `TabWindow` as `tw` | `splitPanel('b', 'a', 'right')` | `[detach a tw, attach a null]` | returns `true`; `(tw.getLayoutManager() as Tab).isEmpty()` is `true`; root shape `H[T(b),T(a)]` |
| E6 | `mountDock()`; `addPanel(a)`; `doLayout()`; `flush()`; then, with no layout or flush between: `addPanel(specD)` | `splitPanel('a', 'd', 'right')` | after `dock.doLayout(); flush()`: `[attach d null]` | returns `true`; shape `H[T(a),T(d)]`; `entries` of `a`'s region is `['a']`; that region's `Tab` has `_pendingActiveContent` `null` |
| E7 | `mountDock()`; `addPanel(a)` with no layout or flush | `splitPanel('a', specC, 'right')` | after `dock.doLayout(); flush()`: `[attach a null, attach c null]` | returns `true` — a target added in the same task qualifies |

### Activation and focus — `Dock.splitPanel.test.ts`

| Case | Setup | Action | Expected |
|---|---|---|---|
| F1 | `tabsDock(['a','b'])`; record `"focus"` | `splitPanel('a', specC, 'right')`, no `flush()` | the recorded `"focus"` events are exactly `[{ id: 'c', window: null }]` already; `dock.focusPanel('c')` returns `true` straight away |
| F2 | `regionsDock([['a','b'],['c']])`; `dock.focusPanel('c')`; `flush()`; record `"focus"` | `splitPanel('c', 'a', 'bottom')` | one `"focus"` with `id` `'a'`, before any `flush()` |
| F3 | `tabsDock(['a','b'])` | `splitPanel('a', 'a', 'right')`, then `addPanel(specD)`, `doLayout()`, `flush()` | shape `H[T(b),T(a,d)]` — the next add opens beside the split panel |
| F4 | `tabsDock(['a','b'])`; `const win = floatPanel(dock, 'a')`; `dock.focusPanel('b')`; `flush()`; then focus a connected outside button (as `focusedOpener()` in `tests/overlay/AbstractWindow.focus.test.ts` does, [:54](../packages/lib/tests/overlay/AbstractWindow.focus.test.ts#L54)) | `splitPanel('a', specC, 'right', { focus: false })` | returns `true`; active element (`DOM.source.getActiveElement()`) is still the outside button; last `"focus"` is `{ id: 'c', window: win }` |
| F5 | as F4 | `splitPanel('a', specC, 'right')` | active element is `win.getElement()` (its `autoFocus` is on) |
| F6 | `tabsDock(['a','b'])`; focus a connected outside button | `splitPanel('a', specC, 'right')` | active element is still the outside button — a tiled split moves no keyboard focus |

### `Tab.removeMovedTab` — `tests/component/layout/Tab.test.ts`, new `describe('Tab removeMovedTab')`

Each case: `installTestDOM(CONFIG)`; `const { host, tab, a, b } = hostTab(new Tab())`; `tab.createTab(a)`; `tab.createTab(b)`; `const other = new Container({})`.

| Case | Action | Expected |
|---|---|---|
| RM1 | spy `tab.on('tabclose')`; `other.moveComponent(a)`; `tab.removeMovedTab(a)` | `true`; `tab.indexOfContent(a)` is `-1`; `tabclose` not called; `a.isDestroyed()` is `false` |
| RM2 | `tab.removeMovedTab(a)` with `a` still in the host | `false`; `tab.indexOfContent(a)` is `0` |
| RM3 | spy `tab.on('empty')`; move `a` and `b` into `other`; `removeMovedTab(a)`; `removeMovedTab(b)` | both `true`; `empty` called once, after the second |
| RM4 | `tab.removeMovedTab(new Component({}))` | `false` |
| RM5 | `tab.setActiveTabIndex(0)`; `other.moveComponent(a)`; `tab.removeMovedTab(a)` | `tab.getActiveContent()` is `b` |
| RM6 | `const c = new Component({})`; `host.addComponent(c)` (no cell yet); `tab.setActiveContent(c)`; `other.moveComponent(c)`; `tab.removeMovedTab(c)` | `false`; `(tab as any)._pendingActiveContent` is `null` |

### Unchanged drag path

Every existing test in the step-1 command still passes. In particular `Dock.lifecycle.test.ts`'s "can open a panel again after closing a dragged-then-promoted last region" calls `splitOnEdge(frame, 'bottom')` with two arguments and ignores the return value.

### Manual verification (real browser; the offline DOM shows no geometry or paint)

Demo app (`npm run dev`, `localhost:8015`), *Misc* page, **Dockable layout (Dock)**, with the console open.

| Case | Steps | Expected |
|---|---|---|
| MV1 | Click the *Search* tab, then **Split right** | A *Split* pane opens right of the Explorer/Search group with a gutter between them; its tab is active; the console logs `focus: split-1`, then `attach: split-1 -> (tiled)` |
| MV2 | Click the *Editor* tab, then **Split down** | A *Split* pane opens under *Editor* at about 30% of that column's height |
| MV3 | Shift-drag a tab off into a bare float; click its tab; **Split right** | The split happens inside the float; the float stays in front |
| MV4 | Drag a tab off (no Shift) into a strip float; click its tab; **Split right** | Nothing changes; the console logs `[Dock] splitPanel: false` |
| MV5 | Drag the new *Split* tab onto another region, tear it off, drag its gutter | It behaves like any dropped tab: re-docks, tears off, resizes |

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` pass.
- `npm run lint` passes.
- `npx vitest run` — the whole suite passes, including every case above.
- `npm run docs:api` finishes with zero warnings.
- `npm run docs:llms:check` passes.
- `grep -n "removeEntryKeepingContent\|splitOnEdge" src/typescript/lib/overlay/Dock.ts` — no match.
- `grep -n "splitOnEdge(" src/typescript/lib/layout/DockRegion.ts` — the definition plus the calls in `onDrop` and `dropOnEdge`.
- Manual cases MV1–MV5.

---

## Documentation Impact

`DockSplitOptions` is exported from `@jimka/typescript-ui/overlay` ([overlay/index.ts](../packages/lib/src/typescript/lib/overlay/index.ts)); its API page is `/api/overlay/interfaces/DockSplitOptions`. `Tab.removeMovedTab` appears on `/api/layout/classes/Tab#removemovedtab`. `DockRegion.dropOnEdge` is `@internal`: no public JSDoc may link it, and `Dock.splitPanel`'s JSDoc describes the drop path in prose. Link `Edge` as [`Edge`](/api/primitive/type-aliases/Edge) in Markdown.

- **[`docs/components/Dock.md`](../packages/lib/docs/components/Dock.md)**
  - *Programmatic control*: the intro sentence becomes "Seven methods drive the lifecycle, layout and presentation from code, each keyed by panel `id`". Add to the code sample, after the `removePanel` line:
    ```typescript
    dock.splitPanel('editor', 'search', 'right');                // move Search beside Editor
    dock.splitPanel('editor', previewSpec, 'bottom', { ratio: 0.3 }); // open a new panel under it
    ```
    Add a **`splitPanel(targetId, panel, side, options?)`** bullet after the `removePanel` bullet: it does what dropping a tab on the edge of the target's tab group does — the wrap-or-join rule, linking [`DockRegion`'s *Wrap vs. extend*](/layouts/DockRegion#wrap-vs-extend); `panel` is a registered id (moved, or opened again when closed) or a spec (registered and opened, as `addPanel`); the panel becomes the active panel and fires `focus` before the call returns, and `attach` / `move` / `detach`+`attach` follow as for a drop; `ratio` is the new pane's share of the target group's slot, and leaving it out sizes the pane as a drop does; `focus` decides whether a float holding the target takes keyboard focus when it is raised (the new tab never takes focus), linking [`DockSplitOptions`](/api/overlay/interfaces/DockSplitOptions); returns `false` for an unknown id, a target in a strip-mode tear-off window, or a split that changes nothing; throws for a `ratio` outside `(0, 1)`.
  - *Panel lifecycle*, the gesture → events table: add one row, "Split from code with `splitPanel`" → "`attach` for a newly opened panel; otherwise `move`, or `detach` then `attach` when its host changes".
  - *What the user can do*, the "Drop a tab on a region **edge**" row: append "(or `splitPanel` from code)".
- **[`docs/layouts/Tab.md`](../packages/lib/docs/layouts/Tab.md)**, *Tear-off & re-dock*, after the paragraph starting "All of these *move* the content": add a short paragraph — code that moves a tab's content to another container itself calls [`removeMovedTab(content)`](/api/layout/classes/Tab#removemovedtab) afterwards; the cell goes, the next tab is selected, `empty` fires when it was the last, and no `tabclose` fires. `closeTab` stays the call for content that is still in the strip.
- **[`docs/layouts/DockRegion.md`](../packages/lib/docs/layouts/DockRegion.md)**, *Wrap vs. extend*: add one sentence at the end — [`Dock.splitPanel`](/api/overlay/classes/Dock#splitpanel) makes the same split from code, with no drag.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)** — add under the headings the reveal plan created, adding any that are missing in the shape of [`0.11.0.md`](../packages/lib/docs/reference/changelog/0.11.0.md):
  - `## Added` → `### Overlay`: **`Dock.splitPanel(targetId, panel, side, options?)`** puts a panel in a new pane beside another panel from code — the split a tab dropped on a region edge makes — for commands such as *Split Editor Right*. `panel` is a registered id to move or reopen, or a spec to open; `ratio` sets the new pane's share. See [Dock: Programmatic control](/components/Dock#programmatic-control).
  - `## Added` → `### Layouts`: **`Tab.removeMovedTab(content)`** removes the tab of content that code has already moved to another container, without destroying it or firing `tabclose`. See [Tab: Tear-off & re-dock](/layouts/Tab#tear-off-re-dock).
- **[`docs/reference/migration/next.md`](../packages/lib/docs/reference/migration/next.md)** — no entry: both additions are new API.
- **`llms.txt`** — no change: no component is added.

---

## Potential Challenges

- **The reveal plan's final names.** It is still being revised. Mitigation: if its implemented `DockFocusPanelOptions`, `focusPanel` options or `bringToFront` option differ from this plan, use the implemented names and semantics, and stop and report if `focusPanel` no longer takes a per-call focus value.
- **Moved content loses keyboard focus.** Re-parenting an element that holds focus drops focus to the page, as a drag does. Mitigation: the `splitPanel` docs say focusing the panel's content is the application's job.
- **A stale strip cell.** A move without `removeMovedTab` leaves the old `Tab` naming the frame, and `regionForFrame` can then return the old region. Mitigation: St1, St6, St7, E1 and E6 assert the old strip's `entries`.
- **`regionsDock` builds a split even for one group.** Mitigation: use `tabsDock` where a case's "Before" is a bare `T(…)`.
- **Docs link warnings.** `{@link Dock.splitPanel}` resolves only inside `Dock.ts`. Mitigation: `DockSplitOptions` lives in `Dock.ts`; elsewhere use the module-qualified form from `CODE_CONVENTIONS.md` or a Markdown link.

---

## Critical Files

- [`layout/DockRegion.ts`](../packages/lib/src/typescript/lib/layout/DockRegion.ts) — the precedent this plan reuses: `onDrop` (:87), `isLegalDrop` (:281), `isRedundantEdgeDrop` (:353), `splitOnEdge` (:436), `newStack` (:542), `pruneEmptyStack` (:558).
- [`overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) — `addPanel` (:508, the registration and activation `splitPanel` mirrors), `resolvePanel` (:643), `leafConstraints` (:715), `scheduleSweep` (:911), `reconcileHosts` (:1204), `wireRegion` (:1351), `pruneRegion` (:1418), `onPanelFocused` (:1682), `focusPanel` (:1990), `ownerTab` (:2175), `regionForFrame` (:2190).
- [`layout/Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts) — `closeTab` (:1251), `_onBarDetached` (:1574), `createTab` (:1721), `setActiveContent` (:2417), `removeEntryKeepingContent` (:2491), `_pendingActiveContent` (:333).
- [`layout/Split.ts`](../packages/lib/src/typescript/lib/layout/Split.ts) — `getPaneSize` (:889), `applyPaneRatios` (:1226), `recalculateSizes`'s new-pane share (:2770).
- [`overlay/DragManager.ts`](../packages/lib/src/typescript/lib/overlay/DragManager.ts#L717) — `onMouseUp`: `onDrop`, then `endSession`, which leads to the source strip's `"detach"`.
- [`plans/dock-reveal-panel-without-focus.md`](dock-reveal-panel-without-focus.md) (or its `implemented/` copy) — `DockFocusPanelOptions`, `focusPanel(id, options?)`.
- [`tests/overlay/Dock.lifecycle.test.ts`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts) — the harness to copy (:27–109, `regionsDock` :289, `floatPanel` :487).

---

## Non-Goals

- **Splitting beside a panel in a strip-mode tear-off window.** Its `TabWindow` is a tab strip, not a region tree; supporting it means turning the window into a mini-dock first.[^tabwindow]
- **Targeting a region or the dock's outer edge** ("move this panel to the bottom of the whole dock"). Regions have no public identity; the target is always a panel.
- **A lazy spec.** `splitPanel` opens a spec eagerly, as `addPanel` does. For a lazy panel, call `addLazyPanel(spec)` and then `splitPanel(target, spec.id, side)` in the same task — E6 pins that route.
- **Moving a panel into another tab group as a tab** (the centre drop) from code.
- **A dock event for a split ratio changed by a gutter drag.** A follow-up plan owns it.[^follow-up]
- **A public programmatic split on a standalone `DockRegion`.** `dropOnEdge` is `@internal`.[^reuse-dockregion]
- **Focusing the panel's content.**

---

## Notes

[^api-shape]: Three shapes were weighed. An `addPanel(spec, { beside, side })` option covers only new panels, and `addPanel` returns `this` for chaining while a split needs a found/not-found answer. A `movePanel(id, { beside, side })` covers only open panels, so *Split Editor Right* for a new view would need `addPanel` then `movePanel`, where `addPanel` first docks the panel into the active region and queues an activation there that the move then has to undo. One method that takes either an id or a spec covers both commands. The id-or-spec union and the `false` return follow `Dock`'s own surface: `addPanel` re-adding a registered id moves the open frame, and `focusPanel` / `removePanel` return `false` for an id they cannot act on. The positional-required, bag-optional shape follows `focusPanel(id, options?)` in the reveal plan and `CodeEditor.revealRange(at, options?)`.

[^side-name]: `Edge` (`"left" | "right" | "top" | "bottom"`, `primitive/Edge.ts`) is already the dock's vocabulary: `DropZone` is `Edge | "center"`. `Drawer` and `Rail` call a similar option `edge`, but their value says which edge of the viewport the surface sits on; here the value says which side of the target the new pane goes, which `TabOptions.side` and Edge.ts's own `HorizontalSide` / `VerticalSide` also call a side.

[^reuse-dockregion]: The edge drop's split logic lives entirely in `DockRegion`: `splitOnEdge`, `ensureStacked`, `newStack` (which subscribes the stack's own prune), `pruneEmptyStack` and `collapseIfSinglePaneSplit`. Copying it into `Dock` would give two copies of the wrap/insert rule to keep in step. `dropOnEdge` is the smallest entry point onto it: the legality check plus the split, exactly what `onDrop` runs. It is `@internal` rather than public because a standalone `DockRegion` user calling it would also need to release the source strip's cell and wire the new stack — work `Dock.splitPanel` does and a public `DockRegion` method would have to specify; nobody asked for that. `Component.setContentClampSuspended` is the existing `@internal` cross-class seam of the same kind.

[^target-parent]: `Dock.regionForFrame` finds a region by asking each `Tab` whether it has a strip cell for the frame, and `Tab.doLayout` creates the cell for a freshly added child on the next layout. So right after `addPanel('a')`, `regionForFrame` finds nothing and `focusPanel('a')` returns `false` (the reveal plan measured this). `Dock.ownerTab` already reads a frame's owner from its parent for the same reason. Reading the parent lets `addPanel(a); splitPanel('a', …)` work in one task (E7).

[^tabwindow]: A default (`"strip"`) tear-off builds a `TabWindow`, whose own layout manager is the `Tab`; its tabs' frames are the window's direct children. `Dock.ownedFloatWindows` excludes `TabWindow`s from adoption and `wireRegion` never runs on one, so dragging a tab onto a `TabWindow`'s body offers no edge zones. Running `splitOnEdge` with a `TabWindow` as the region would wrap the window itself into a `Split` placed in the window's parent — not a split inside the float. Only a Shift tear-off's bare `Window` becomes a mini-dock with `DockRegion`s.

[^remove-moved-tab]: `Tab.doLayout` only creates cells for children no entry owns yet (`syncUntabbedChildren`); it never removes the entry of a child that left, so a raw `moveComponent` out of a `Tab` leaves a phantom tab (the comment above `Dock.hideEmptyState` and the `floatPanel` test helper, which reaches the private `removeEntryKeepingContent` for this reason, both record it). `closeTab` cannot be used: it removes the content, fires `"tabclose"` — which `Dock` reports as a `"close"` and evicts the frame — and destroys the content. `removeMovedTab` keeps the `"detach"` handler's guard (do nothing while the content is still a child), so it cannot orphan a live child. It also drops a still-pending `setActiveContent` for that content: `addPanel` queues one that applies on the next layout, and a panel moved in the same task would otherwise be activated again if it ever came back.

[^release-order]: `Dock.pruneRegion` returns early while the region still has children ([Dock.ts:1421](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1421)). The source `Tab` fires `"empty"` synchronously from `removeEntryKeepingContent`, so the cell must be dropped after the frame has left the region, or the emptied region would never be pruned. A drag has the same order: `onDrop` moves the frame, then `endSession` makes the source strip fire `"detach"`.

[^eager-cell]: Activating the panel the way `addPanel` does — `setActiveContent`, applied on the new stack's first layout — fails three ways. The new stack's `Tab` is only wired on the next sweep, and its layout can run first, so the `"activate"` that drives the dock's `"focus"` would go unheard. `onPanelFocused` writes `_lastActiveRegion` from `_frameRegion`, which for a moved panel still names the old region until the sweep. And `focusPanel` — the one call that applies the reveal plan's float-raise option — returns `false` until the cell exists, as would any `focusPanel` a caller makes straight after `splitPanel`. Creating the cell with the public `Tab.createTab` and wiring the stack first lets `splitPanel` call `focusPanel(id, { focus })` directly; the later layout pass finds the cell already made and skips it. A throwaway probe against `43b5dd0fe` ran this sequence offline — `splitOnEdge`, `removeEntryKeepingContent`, `wireRegion(stack)`, `createTab`, `focusPanel` — and saw `focusPanel` return `true`, one `"focus"` at once, one `"move"` after the sweep, and one cell in the new stack. Unlike `onDrop`, `splitPanel` does not raise the window the dock itself lives in; `focusPanel` raises only a float that holds the panel.

[^focus-order]: `focusPanel` already fires `"focus"` synchronously, and `addPanel`'s `"focus"` (on the next layout) and `"attach"` (on the next sweep) have no fixed order today, so no consumer can rely on `"attach"` first. A consumer that keeps its own map of panels should add the new panel to it before calling `splitPanel`, because its `"focus"` listener runs inside the call.

[^ratio-default]: Matching the drop by default keeps one sizing rule for both routes and makes `splitPanel` without `ratio` a pure reuse of the drop. VS Code's *Split Editor* gives the new group half of the target group; an application wanting that passes `ratio: 0.5`.

[^ratio-carve]: `applyPaneRatios` is the existing seam for writing shares: it seeds stored px against the container's live extent, or against a unit base on a container not laid out yet, and resets the rescale baseline so the next layout scales the shares instead of re-dividing them. The probe confirmed a fresh, never-laid-out two-pane container keeps `[0.7, 0.3]` from `applyPaneRatios` and lays out at 700/300 px in a 1000 px box. Writing raw px with `setPaneSize` would need the live extent and would not reset that baseline. When some pane has no stored size, `getPaneRatios` reads it as `0`, which would collapse it; treating every pane as equal in that one case is the same split a first layout would make.

[^ratio-throw]: `ratio` outside `(0, 1)` is a programming error, not a state of the dock, so it throws like `Component.addComponent` does for an async factory without a deferring manager. Clamping would hide a typo such as `30` meant as `0.3`, and returning `false` would mix a bad argument with "nothing to split".

[^illegal]: `isLegalDrop` is the drag path's single "would this change anything?" predicate. Reusing it keeps the two routes in agreement: what the drag shows as a red zone, `splitPanel` refuses. Its redundancy helpers looked the dragged component up in `tabDragRegistry`, which `Tab` fills only while a tab drag is live; a default parameter keeps that lookup for the drag and lets `dropOnEdge` pass the frame. For a panel that has never been in the tree (a new spec or a re-opened closed panel) every check passes, so registering it before the check never leaves a frame built for a refused call.

[^follow-up]: A follow-up plan will add a dock event for a split ratio changed by a gutter drag. Nothing here constrains it. Every `Split` region `splitPanel` creates is made by `DockRegion` and reaches `wireRegion` through the sweep, so a per-`Split` subscription added in `wireRegion` covers splits made from code too. `applyPaneRatios` emits no `Split` event, so whether a programmatic `ratio` should count as a ratio change is left to that plan. `splitPanel` adds no `DockEvent`; a consumer that saves the layout re-reads `getLayoutState()` on `"attach"` / `"move"`, as `Dock.md` already advises.

[^demo]: The demo toolbar is where the dock's other programmatic paths are exercised (*Add async panel*, *Add failing panel*), and the manual cases need a way to call `splitPanel` from the running app. The demo's existing `dock.on(…)` listeners are inline arrows; the named-function rule in `ARCHITECTURE.md` is for library code, and matching the surrounding demo style keeps the change local.

---

## Implementation Notes

### Deviations

- **A wrapping split takes `ratio` through Split's `paneSizes` option, not `applyPaneRatios`.** The plan wrote the share with `applyPaneRatios` straight after the wrap. In the browser that failed (MV2 first gave 50/50, a second probe 0.966/0.034): the new split has no size yet, so `applyPaneRatios` seeds the shares against a unit base (0.7 and 0.3 px), and the split's first layout clamps each stored size up to the pane's minimum (a tab stack's 24 px strip, the VBox panel's 678 px) before it rescales. The footnote's probe had used panes with no minimum. `splitOnEdge` now builds the wrap `Split` with `paneSizes: [{ unit: "ratio", … }]` (helper `wrapPaneSizes`), which Split applies on its first layout against its real extent. R6 (added) pins this offline with minimum widths on the contents. R1 and R2 therefore read the shares straight after the call from `getPaneSizes()` (the pending array), not `getPaneRatios()`, and from `getPaneRatios()` after `doLayout()`.
- **`ratio` when joining a split that has never been laid out (open limitation, closed by the audit fix below).** The insert branch keeps `applyPaneRatios` (via `carveSlot`), which is correct against a laid-out split (R3; checked in the browser too: `[⅓, ⅓, ⅓]` became `[⅓, ⅓, 0.2, 0.133]`). Against a split that was never laid out it hit the same unit-base clamp: a probe with minimum widths 50/100/150 and `ratio: 0.4` gave `[⅙, ⅓, ½]` instead of `[0.3, 0.2, 0.5]`.
- **`Tab.removeMovedTab` also clears `_pendingActiveFocus`** with `_pendingActiveContent`. The reveal plan added that field after this plan was drafted; `setActiveContent` clears both together.
- **`@internal` sits at the end of `dropOnEdge`'s JSDoc**, after `@returns`, as on `Component.setContentClampSuspended`, and the description says the caller releases the old tab and wires the new stack.
- **Test harness.** E4 runs one extra `scheduleSweep(); flush()` after `floatPanel`: that helper's sweep runs before the float's Tab makes the frame's cell, so the region ledger still names the root and the next sweep reports a stale `move` for the floated panel. The same stale `move` shows in the browser after a Shift tear-off (`moved: search -> Search` on the sweep after a later split); it comes from the tear-off, not from `splitPanel`. N6 compares against the message `addPanel` throws on another dock. `tabsDock` and the extended `recordHostEvents` live in the new test file.
- **Changelog order.** `next.md` already had `## Added` → `### Layouts` and `### Overlay` from the stacked branches; the two entries were appended at the end of each, in the released order (Breaking / Changed / Added / Fixed) the page already follows.

### Focus (decided deliberately)

`splitPanel` is a change made from code. It never goes through `Tab.dockComponent`, so it does not inherit the drop's `{ focus: true }`; it passes `options.focus` to `focusPanel` unchanged. Added tests: F7 (`focus: true` on a tiled split makes no `DOM.sink.focus` call), F8 (focus on the moved panel's old tab moves to a tab left in its old group — `removeMovedTab` → `removeBarEntry`'s removal rule) and F9 (`focus: true` takes focus into a float built with `autoFocus: false`). In the browser, with nothing focused, neither the default nor `focus: true` moved focus onto the new tab; with focus on the moved panel's tab, it moved to the old group's surviving tab; with focus in an input inside the moved panel, focus fell to `<body>` when the panel was re-parented (so the docs leave focusing the content to the application).

### Verification

- Step 2 red: RM1–RM6 and every `Dock.splitPanel` case failed before the code (N5 passed vacuously on the missing method, and is meaningful now). Mutation checks: dropping the `removeMovedTab` call fails St1, St6, St7, E1, E5, E6, F8; dropping the `focus` pass-through fails F4 and F9.
- From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint` clean; `npx vitest run`: 640 files, 28 180 tests pass (2 todo). `npm run docs:api` zero warnings; `npm run docs:llms:check` passes (108 / 121 / 0) and `docs:llms` changes nothing. `packages/docs` tests: 13 files, 2 617 pass (after `build:lib` and the `@jimka/typescript-ui` link).
- Grep checks: `Dock.ts` names neither `removeEntryKeepingContent` nor `splitOnEdge`; `splitOnEdge(` in `DockRegion.ts` is the definition plus the `onDrop` and `dropOnEdge` calls.
- Callers of changed methods: `isLegalDrop` (`onDragOver`, `onDrop`, `dropOnEdge`), `isRedundantCenterDrop` / `isRedundantEdgeDrop` (only `isLegalDrop`), `splitOnEdge` (`onDrop`, `dropOnEdge`, and `Dock.lifecycle.test.ts` and `Dock.panelPresentation.test.ts` through the private name, which both ignore the return), `Tab.removeMovedTab` (only `Dock.splitPanel`).

### Manual checks (own Vite server on port 8030, Chrome DevTools MCP)

- **MV1 — pass.** Real clicks on *Search*, then **Split right**: a *Split* pane opened right of the Explorer/Search group, its tab active; console `focus: split-1 -> (tiled)`, `splitPanel: true`, `attach: split-1 -> (tiled)`. Focus stayed on the toolbar button.
- **MV2 — pass after the `paneSizes` fix.** Real clicks on *Editor*, then **Split down**: the column split 0.7 / 0.3 (frames 251 px and 94 px under 24 px strips).
- **MV3 — pass, tear-off scripted.** The Shift tear-off was made with `detachTabToWindow(…, forceBare: true)` from the console (the MCP drag cannot hold Shift); then real clicks on the float's tab and **Split right**: the float held `H[T(search),T(split-2)]`, stayed in front (z-index 9004 over the dock window's 9003), and took focus (its `autoFocus`).
- **MV4 — pass, tear-off scripted.** A strip-mode tear-off (`forceBare: false`), a real click on its tab and **Split right** logged `[Dock] splitPanel: false`.
- **MV5 — pass, partly synthetic.** The new *Split* tab was re-docked onto the VBox group and torn off into a `TabWindow` with real MCP drags; the gutter of the split `splitPanel` made in the float was dragged with synthetic pointer/mouse events (no a11y handle for a real drag) and moved from 0.5 / 0.5 to 0.34 / 0.66.
- **`"focus"` does not fire when the split moves the already-focused panel (audit).** The plan's Architecture Decision said `"focus"` fires synchronously on every split, and the JSDoc, Dock.md and the code commit repeated it. `Dock.setFocus` is silent when the id is already focused, by documented design on every path (a drag-drop of the focused panel behaves the same), so a *Move Editor Right* on the focused editor fires no `"focus"`; the host change, if any, is reported by `"detach"` / `"attach"` on the next frame. The wording now says so, and F10 (tiled, `"move"`) and F11 (out of a strip tear-off, `"detach"` then `"attach"`) pin it. F7 also checks that no focus moves after the layout pass and sweep.
- **A pending `ratio` is invisible to `getLayoutState()` until the new split's first layout.** The wrap branch carries `ratio` as Split's pending `paneSizes`, which `getPaneRatios()` (read by `serializeLayout`) ignores, so a `getLayoutState()` in the same task as the split reports `[0.5, 0.5]`. The layout frame normally runs before the sweep that fires `"attach"` / `"move"`, so saving from those events records the requested share.
- **`removeMovedTab` and Tab.md no longer say "the next tab is selected"**: a neighbouring tab is selected only when the removed tab was the active one, as `selectNextContent` does.
- **`ratio` into a split that has not been laid out is ignored (audit fix, contract chosen by the user).** The audit found the open limitation above worse than stated: every vertical case came out equal (24 px strip minimums), mixed horizontal minimums collapsed panes to ~1 px (`[0.001, 0.001, 0.998]`, worse than no `ratio`), and a second `splitPanel` joining a wrap made earlier in the same task made Split discard the wrap's pending `paneSizes` with a `console.warn` (P1). Contract now: the wrap branch is unchanged (`ratio` rides in as `paneSizes`); the insert branch carves `ratio` only into a split that has been laid out, and otherwise ignores it and drops the split's pending shares, so all its panes size as for a drop and nothing warns. `ratio` is never worse than omitting it. "Laid out" is read from the container, not Split's internals: `DockRegion.isLaidOut` checks for a main-axis extent left after the gutters (`getInnerSize()` minus `getComponentSpacing()` gaps; a never-sized box reports `NaN`), the same test `applyPaneRatios` makes before falling back to a unit base. Split's `_lastAvailableMain` was rejected because `applyPaneRatios` sets it on an unlaid split (a `setLayoutState` restore), which would let the carve through. Pending shares are dropped through a new `@internal` seam, `Split.discardPendingPaneSizes()` (nulls `_pendingSizes`; no public API cleared it). The insert into an unsized split always leaves that array one entry short, so dropping it equals Split's own discard, minus the warning; the drag path through `splitOnEdge` gets the same. Tests R7 (P1: no warning, `[⅓, ⅓, ⅓]` as without `ratio`), R8 (`new Dock({ layout })` then `splitPanel` with `ratio` before any layout: as without `ratio`, no warning) and R9 (the auditor's P4 shape, a 500 px minimum beside two unconstrained panes: no pane squeezed, was 0.48 px) failed first for those reasons; R3 and R6 unchanged and green. Commenting out the discard fails R7. The `DockSplitOptions.ratio` and `carveSlot` JSDoc, Dock.md and the changelog entry say when `ratio` applies; the old "minimum sizes can bend" wording is gone. The audit's focus advisory is fixed too: `DockSplitOptions.focus` and the `splitPanel` JSDoc now say the option governs the activation, while the rescue onto the old group's surviving tab happens whatever it says. Checks after the fix: typecheck, typecheck:test and lint clean; `npx vitest run` 640 files, 28 185 pass (2 todo); `docs:api` zero warnings; `docs:llms:check` 108 / 121 / 0; `packages/docs` 13 files, 2 617 pass after `build:lib`.
- **Follow-up: `setLayoutState` bends restored shares the same way.** `LayoutSerialization.populateContainer` calls `applyPaneRatios` on a freshly built split that has no size, so the ratios are seeded against a unit base and the first layout clamps them to the panes' minimums, as the insert branch did here. Out of scope for this plan; not fixed. A split laid out at zero extent (no room beyond its gutters) also counts as not laid out for `ratio`; Dock splits are not expected to reach that state.
- **`ratio` into a laid-out split that changed since its last layout is ignored too (audit round 3, user-approved).** After the round-2 fix `carveSlot` only ran on a laid-out split, but it still fell back to counting every pane as an equal share when any pane other than the new one had no stored size, which is exactly the state an earlier insert in the same task leaves a laid-out split in. The auditor's probe (a laid-out 90 / 10 split, one `splitPanel` without `ratio`, then one with `ratio: 0.5`) flattened the panes to `[0.167, 0.167, 0.333, 0.333]` against `[0.25, 0.45, 0.25, 0.05]` without `ratio`. `carveSlot` now returns without writing when any other pane is unsized, so the new pane sizes as for a drop and the other panes keep their shares; the equal-share fallback (and footnote `[^ratio-carve]`'s reasoning for it) is gone. R10 pins the probe against the no-`ratio` result and `b`'s 5 %. The `DockSplitOptions.ratio` JSDoc, Dock.md and the changelog say `ratio` applies to a split laid out since it last changed. RM7 pins that `removeMovedTab` of a non-active tab keeps the active tab, and the `removeMovedTab` JSDoc and Tab.md paragraph are rewrapped.
