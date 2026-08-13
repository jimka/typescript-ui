# Split gutter context menu — Implementation Plan

## Overview

Right-clicking a `Split` gutter's collapse chevron opens a context menu with three groups of controls: lock this gutter against dragging, pin either neighbouring pane's size against container resizes, and choose which of the two neighbours this gutter collapses. The menu is rebuilt from live state on every open.

The right-click originates on [`CollapseButton`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L127), travels as a typed `"contextmenu"` event up through [`SplitGutter`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L108), and is answered by [`Split`](packages/lib/src/typescript/lib/layout/Split.ts#L85), which owns the pane knowledge every menu row needs. `Border` also builds `SplitGutter`s but subscribes only to their `"collapse"` event, so it gains no menu and its source is not touched.[^border-untouched]

Three existing mechanisms are wrapped rather than reinvented: `SplitGutter`'s `movable` flag (lock), [`Split.setPaneResizeWeight`](packages/lib/src/typescript/lib/layout/Split.ts#L477) (pin), and the per-pane `collapseDirection` field of [`LayoutConstraints`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L128) (collapse target).

---

## Architecture Decisions

### The right-click travels as a typed event, gutter → Split

`CollapseButton` wires its own `contextmenu` DOM listener and emits a typed `"contextmenu"` event carrying the click coordinates; `SplitGutter` re-emits it; `Split` subscribes when it builds the gutter and opens the menu. This mirrors the `"collapse"` chain already running along the same three classes,[^event-chain] and is required by ARCHITECTURE.md's rule that a component never listens on another component through the `Event` API.

### `Split` owns the menu panel and builds its rows

`Split` gains a private `Menu` field, created on first open and shown with rebuild-mode `show(x, y, configs)` the way [`TabBar.openTabMenu`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1751) shows its tab menu.[^menu-ownership] Rows are assembled fresh inside the open handler, so `checked` and `enabled` are read from live state each time.

### `movable` becomes a live flag instead of a construction-time one

The `mousedown` drag listener is wired unconditionally, and `SplitGutter.onDragStart` returns early when `_movable` is false. `setMovable` therefore takes effect at any time, and locking is just `setMovable(false)`.[^live-movable] A locked gutter also drops its resize cursor; its tooltip is unchanged, because the tooltip describes the double-click collapse gesture, which locking does not disable.

### `setPaneResizeWeight` accepts `undefined` to clear the pin

The signature widens to `weight: number | undefined`; passing `undefined` deletes the pane's entry from the weight map, restoring the "no explicit weight" state that resolves through the `weight` constraint or the pane's stored size.[^clear-weight] The pin toggle writes `0` to pin and `undefined` to unpin, and reads `getPaneResizeWeight(pane) === 0` to decide its checkmark.

### A collapse-direction change mutates the stored constraint in place

The collapse-direction action reads the pane's existing `LayoutConstraints` via `getLayoutConstraints`, writes only `collapseDirection`, and stores it back with `setLayoutConstraints`. A pane with no constraints yet gets a fresh `new LayoutConstraints()`. Mutating the retrieved object preserves `collapsible`, `weight`, and every other field.[^constraint-merge]

### The chevron re-syncs through the normal layout pass

After writing the constraint, the collapse-direction action calls `container.scheduleLayout()`; `Split.doLayout` already calls `gutter.setCollapseDirection(this.paneDirection(...))` and `gutter.setCollapsible(target >= 0)` on every pass ([Split.ts:1247](packages/lib/src/typescript/lib/layout/Split.ts#L1247), [Split.ts:1301](packages/lib/src/typescript/lib/layout/Split.ts#L1301)). The layout pass is the single place the chevron is written, matching how `applyPaneRatios` and `setPaneCollapsedImmediate` end.[^schedule-layout]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/container/CollapseButton.ts
export type CollapseButtonEvent = "collapse" | "contextmenu";

export interface CollapseButtonOptions extends ComponentOptions {
    direction?: CollapseDirection;
    listeners?: {
        collapse?:    () => void;
        contextmenu?: (x: number, y: number) => void;
    };
}

class CollapseButton extends Component<CollapseButtonOptions> {
    on(event: "contextmenu",  listener: (x: number, y: number) => void): this;
    off(event: CollapseButtonEvent, listener: Function): this;
    protected emit(event: "contextmenu", x: number, y: number): void;
}
```

```typescript
// packages/lib/src/typescript/lib/component/container/SplitGutter.ts
export type SplitGutterEvent = "dragstart" | "drag" | "dragend" | "collapse" | "contextmenu";

export interface SplitGutterOptions extends ComponentOptions {
    // …unchanged fields…
    listeners?: {
        dragstart?:   (position: number) => void;
        drag?:        (position: number) => void;
        dragend?:     () => void;
        collapse?:    () => void;
        contextmenu?: (x: number, y: number) => void;
    };
}

class SplitGutter extends Component<SplitGutterOptions> {
    on(event: "contextmenu", listener: (x: number, y: number) => void): this;

    /** Now live: toggling at runtime enables/disables drag and the resize cursor. */
    setMovable(value: boolean): this;
    isMovable(): boolean;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/Split.ts
class Split extends LayoutManager {
    /** `undefined` clears the explicit pin; `0` pins; positive absorbs. */
    setPaneResizeWeight(pane: Component, weight: number | undefined): this;
}
```

New private members on `Split`, none exported:

```typescript
private _contextMenu: Menu | null = null;

private openGutterMenu(gutter: SplitGutter, gutterIndex: number, x: number, y: number): void;
private togglePaneResizePin(pane: Component): void;
private retargetGutterCollapse(gutterIndex: number, targetIndex: number): void;
private setPaneCollapseDirection(pane: Component, direction: CollapseDirection): void;
```

---

## Internal Structure

### Menu rows

Six rows and two separators. `components` is `container.getLaidOutComponents()`; `lead` is `components[gutterIndex]` (the pane before the gutter) and `next` is `components[gutterIndex + 1]` (the pane after it); `target` is `this.gutterTargetPane(gutterIndex, components)`. `gutter.isOpaque()` is true while the gutter is standing in as the collapsed pane's strip rather than as a divider.

| Row text (horizontal) | Row text (vertical) | `checked` | `enabled` | Action |
|---|---|---|---|---|
| `Lock gutter` | `Lock gutter` | `!gutter.isMovable()` | always | `gutter.setMovable(!gutter.isMovable())` |
| — separator — | | | | |
| `Fix left pane width` | `Fix top pane height` | `getPaneResizeWeight(lead) === 0` | always | `togglePaneResizePin(lead)` |
| `Fix right pane width` | `Fix bottom pane height` | `getPaneResizeWeight(next) === 0` | always | `togglePaneResizePin(next)` |
| — separator — | | | | |
| `Collapse left pane` | `Collapse top pane` | `target === gutterIndex` | `!gutter.isOpaque() && paneCollapsible(lead)` | `retargetGutterCollapse(gutterIndex, gutterIndex)` |
| `Collapse right pane` | `Collapse bottom pane` | `target === gutterIndex + 1` | `!gutter.isOpaque() && paneCollapsible(next)` | `retargetGutterCollapse(gutterIndex, gutterIndex + 1)` |

The orientation words resolve from `this._orientation`:

| `_orientation` | lead word | next word | extent word | leading heading | trailing heading |
|---|---|---|---|---|---|
| `"horizontal"` | `left` | `right` | `width` | `west` | `east` |
| `"vertical"` | `top` | `bottom` | `height` | `north` | `south` |

### Which constraints a collapse-direction pick writes

`gutterTargetPane` tests the **trailing** neighbour first: it claims the gutter whenever it is collapsible and collapses toward the end. So targeting the leading pane means pushing the trailing neighbour back to the leading heading as well.

| Pick | Writes to `lead` | Writes to `next` | Resulting `gutterTargetPane` |
|---|---|---|---|
| `Collapse left pane` (horizontal) | `collapseDirection: "west"` | `collapseDirection: "west"` | `gutterIndex` |
| `Collapse right pane` (horizontal) | — | `collapseDirection: "east"` | `gutterIndex + 1` |
| `Collapse top pane` (vertical) | `collapseDirection: "north"` | `collapseDirection: "north"` | `gutterIndex` |
| `Collapse bottom pane` (vertical) | — | `collapseDirection: "south"` | `gutterIndex + 1` |

### Key method bodies

```typescript
// CollapseButton
private onContextMenu(evnt: MouseEvent): Event.ListenerResult {
    this.emit("contextmenu", evnt.clientX, evnt.clientY);

    return { stop: true, prevent: true };
}
```

```typescript
// Split
private togglePaneResizePin(pane: Component): void {
    this.setPaneResizeWeight(pane, this.getPaneResizeWeight(pane) === 0 ? undefined : 0);
}

private setPaneCollapseDirection(pane: Component, direction: CollapseDirection): void {
    const constraints = this.getLayoutConstraints(pane) ?? new LayoutConstraints();

    constraints.collapseDirection = direction;

    this.setLayoutConstraints(pane, constraints);
}
```

---

## Ordered Implementation Steps

1. **`CollapseButton.ts` — declare the event.** Extend `CollapseButtonEvent` (line 33) to `"collapse" | "contextmenu"`, and add `contextmenu?: (x: number, y: number) => void;` to `CollapseButtonOptions.listeners` (lines 46-48) with a one-line doc comment.

2. **`CollapseButton.ts` — add the forwarders.** Add an `on(event: "contextmenu", listener: (x: number, y: number) => void): this;` overload above the existing implementation signature (line 254). `emit` currently has a single signature (line 279) — replace it with two overloads, `protected emit(event: "collapse"): void;` and `protected emit(event: "contextmenu", x: number, y: number): void;`, plus the implementation `protected emit(event: CollapseButtonEvent, ...payload: unknown[]): void { this._listeners.fire(event, ...payload); }`, matching `SplitGutter.emit` (SplitGutter.ts:477-483). `off` already takes the union and needs no change beyond its JSDoc.

3. **`CollapseButton.ts` — wire the DOM listener.** After `Event.addListener(this, "mousedown", this.onMouseDown);` (line 158) add `Event.addListener(this, "contextmenu", this.onContextMenu);`. Add the private `onContextMenu` method from *Key method bodies* next to `onMouseDown` (line 303), with JSDoc stating that it consumes the press and suppresses the browser's own menu.
   *Check:* `grep -n 'contextmenu' packages/lib/src/typescript/lib/component/container/CollapseButton.ts` — expect hits in the event union, the options bag, the `on` overload, the `emit` overload, the `Event.addListener` call, and the `onContextMenu` method.

4. **`SplitGutter.ts` — declare and forward the event.** Extend `SplitGutterEvent` (line 18) with `"contextmenu"`; add `contextmenu?: (x: number, y: number) => void;` to the options `listeners` bag (lines 69-74); add the `on` overload (line 445 block) and the `emit` overload (line 477 block) for `(x: number, y: number)`, and document the event in `on`'s JSDoc as *fires when the gutter's chevron is right-clicked, receiving the pointer's viewport coordinates*.

5. **`SplitGutter.ts` — re-emit from the chevron.** In the constructor's `CollapseButton` construction (lines 154-157), add `contextmenu: (x, y) => this.emit("contextmenu", x, y),` to its `listeners` bag beside the existing `collapse` entry.

6. **`SplitGutter.ts` — make `movable` live.** Replace the gated wiring at lines 178-180 with an unconditional `Event.addListener(this, 'mousedown', this.onDragStart);`, and rewrite the comment above it to say the flag is checked live inside `onDragStart` instead of at wiring time. Leave the *separate* `if (!this._movable) { this.setPointerEvents("none"); }` block at lines 170-172 alone — it is `Border`'s pointer-events opt-out, not drag wiring. In `onDragStart` (line 516) change the early return at line 519 to `if (!this._movable || this._opaque) { return; }`, extending the comment to cover the locked case. In `setMovable` (line 279) call `this.applyCursor();` after the field write, and rewrite its JSDoc to describe a live flag. Drop "Read once at construction." from the `movable` option doc (lines 42-47). `applyOptions` dispatches `setMovable` during the `super()` cascade (line 256), so `applyCursor` now also runs there — which is safe and needs no guard: `setDirection` has already run (line 254), `setCursor` only writes buffered state, and the not-yet-initialised `_opaque` field reads `undefined`, which the `!this._opaque` test treats exactly as `false`.
   *Check:* `npm run typecheck`, and `grep -n 'if (this._movable) {' packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — expect zero matches.

7. **`Split.ts` — widen `setPaneResizeWeight`.** Change the parameter to `weight: number | undefined` and the body to delete the map entry when `weight === undefined`, otherwise set it. Extend the JSDoc with the clearing behaviour and note that clearing returns the pane to ratio-based persistence in `getPaneSizes`.
   *Check:* from `packages/lib`, `npx vitest run tests/component/layout/Split.test.ts` — the existing weight suite must stay green.

8. **`Split.ts` — the menu field.** Add `import { Menu } from "~/overlay/Menu.js";` to the import block and `private _contextMenu: Menu | null = null;` next to `_listeners` (line 111), with a comment noting it is created on first open and disposed by `detach`.

9. **`Split.ts` — add the four private methods.** Add `import { MenuItemConfig } from "~/component/container/MenuItem.js";` and `import { LayoutConstraints } from "~/layout/LayoutConstraints.js";` alongside `openGutterMenu`, `togglePaneResizePin`, `retargetGutterCollapse`, and `setPaneCollapseDirection`, placed after `onDragEnd` (line 1029) and built exactly from *Internal Structure*. `openGutterMenu` returns early when `getContainer()` is null or either neighbour is missing, and ends with `this._contextMenu ??= new Menu();` then `this._contextMenu.show(x, y, configs);`. `retargetGutterCollapse` ends with `container.scheduleLayout();`.
   *Check:* `npm run typecheck` — both new imports are consumed by the methods added in this same step.

10. **`Split.ts` — subscribe the gutter.** In the gutter-creation loop, after the `gutter.on("collapse", …)` block (lines 1204-1212), add:
    ```typescript
    gutter.on("contextmenu", function (x: number, y: number) {
        me.openGutterMenu(gutter, gutterIndex, x, y);
    });
    ```
    matching the surrounding handlers' shape and reusing the same captured `gutterIndex` the `collapse` handler uses.

11. **`Split.ts` — tear the menu down.** In `detach()` (lines 1036-1071), after the gutter disposal loop and `this._gutters = []`, add `this._contextMenu?.dispose();` and `this._contextMenu = null;`.
    *Check:* `grep -n '_contextMenu' packages/lib/src/typescript/lib/layout/Split.ts` — expect the field, the lazy create, the show, the dispose, and the null-out.

12. **Tests — gutter lock.** New file `packages/lib/tests/component/container/SplitGutter.movable.test.ts` covering the lock cases in *Expected Behaviour*.

13. **Tests — menu assembly and actions.** New file `packages/lib/tests/component/layout/Split.gutterMenu.test.ts`, using the probe shape from [`TabBar.contextMenu.test.ts`](packages/lib/tests/component/container/TabBar.contextMenu.test.ts#L26): assign a stub `{ show }` to `(split as any)._contextMenu` before calling `(split as any).openGutterMenu(...)` to capture the built configs.

14. **Docs.** Update the JSDoc-driven pages and prose per `## Documentation Impact`.
    *Check:* `npm run docs:api` — zero warnings.

15. **Full verification.** Run everything under `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Create | `packages/lib/tests/component/container/SplitGutter.movable.test.ts` |
| Create | `packages/lib/tests/component/layout/Split.gutterMenu.test.ts` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Lock (unit-testable on a bare `SplitGutter`, under `installTestDOM`)

1. A new `SplitGutter('horizontal')` reports `isMovable() === true`; calling `onDragStart({ clientX: 10 } as MouseEvent)` fires a registered `"dragstart"` listener with `10`. Call `onDragStop()` afterwards to unwind the viewport listeners and the body pointer-events suppression.
2. After `setMovable(false)`, `onDragStart` fires no `"dragstart"` listener.
3. After `setMovable(false)` then `setMovable(true)`, `onDragStart` fires again — the drag wiring was never removed, only gated.
4. `setMovable(false)` sets the cursor to `"default"`; `setMovable(true)` on an expanded gutter restores `"ew-resize"` (horizontal) or `"ns-resize"` (vertical). Read back with `getCursor()`.
5. A gutter in its collapsed strip state (`setOpaque(true)`) still refuses the drag regardless of `movable` — the pre-existing `_opaque` guard.
6. The gutter's tooltip text is unchanged by `setMovable` in either direction.

### Menu assembly (unit-testable via the captured configs)

7. A horizontal 2-pane split's gutter menu has rows, in order: `Lock gutter`, separator, `Fix left pane width`, `Fix right pane width`, separator, `Collapse left pane`, `Collapse right pane`.
8. A vertical split's rows read `Fix top pane height` / `Fix bottom pane height` / `Collapse top pane` / `Collapse bottom pane`.
9. `Lock gutter` is unchecked initially; after activating its action, a re-open shows it checked and `gutter.isMovable()` is `false`.
10. `Fix left pane width` is unchecked initially. Activating it makes `getPaneResizeWeight(lead)` be `0`; a re-open shows it checked. Activating again makes `getPaneResizeWeight(lead)` be `undefined` and a re-open shows it unchecked.
11. The two pin rows are independent: pinning the left pane leaves `Fix right pane width` unchecked.
12. With default constraints on a horizontal 2-pane split, `Collapse left pane` is checked and `Collapse right pane` is unchecked — the single gutter serves the leading pane.
13. Activating `Collapse right pane`, then `host.doLayout()`: `getLayoutConstraints(next)!.collapseDirection === "east"`, `gutterTargetPane(0, panes) === 1`, and `gutters[0].getCollapseDirection() === "east"`. A re-open shows `Collapse right pane` checked and `Collapse left pane` unchecked.
14. Activating `Collapse left pane` afterwards, then `host.doLayout()`: both neighbours' `collapseDirection` are `"west"`, `gutterTargetPane(0, panes) === 0`, and `gutters[0].getCollapseDirection() === "west"`.
15. A neighbour carrying other constraint fields keeps them: a pane added with `{ collapsible: true, weight: 3 }` still reports `collapsible === true` and `weight === 3` after a collapse-direction pick.
16. A pane with no constraints at all gains a `LayoutConstraints` carrying only `collapseDirection`; `paneCollapsible` still reports `true` for it, and its width and x after `host.doLayout()` are unchanged from before the pick (the fresh constraint's `fill: null` / `anchor: null` defaults leave `resolveBounds` on the caller-supplied `FillType.BOTH`).
17. A `collapsible: false` neighbour makes its `Collapse …` row `enabled: false`.
18. While the gutter is an opaque collapse strip (`gutter.isOpaque()`), both `Collapse …` rows are `enabled: false`; the `Lock` and `Fix …` rows stay enabled.
19. Every open rebuilds: mutating state through the setters directly (`gutter.setMovable(false)`, `split.setPaneResizeWeight(lead, 0)`) between two opens is reflected in the second open's configs.
20. `openGutterMenu` is a no-op when the split has no container, or when the gutter index has no pane on one side.

### Interactions (manual verification)

21. Right-clicking the chevron opens the menu at the pointer and suppresses the browser's own context menu.
22. With the gutter locked, dragging the gutter body does not resize the panes and the pointer shows the default arrow over it; unlocking restores both.
23. With `Fix left pane width` checked, resizing the browser window leaves the left pane's pixel width unchanged while the right pane absorbs the delta. Toggling the row off restores proportional resizing.
24. Toggling a `Fix …` row produces no immediate visual change — the pin only bites on the next container resize.
25. After picking `Collapse right pane`, the chevron flips to point right and double-clicking it collapses the right pane into the strip.
26. Right-clicking a `Border` region's chevron opens no menu.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — includes `typecheck:test`; the two new suites plus the existing `Split.test.ts`, `SplitGutter.tooltip.test.ts`, `Menu.test.ts` and `TabBar.contextMenu.test.ts` must all pass.
- `npm run lint` — clean (watch the named-function rule: the new `onContextMenu` is a method reference, not an inline arrow).
- `grep -n "if (this._movable) {" packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — expect zero matches; the constructor's wiring gate is gone and `applyCursor`'s test is the compound `this._movable && !this._opaque`.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms` then `git diff packages/lib/llms.txt` — expect no change (the `Split` entry is derived from the class JSDoc's opening sentence, which is untouched).
- Manual: `npm run dev` (localhost:8015), open a screen hosting a `Split` — the docs app's Split page or any multi-pane demo — and walk cases 21-26.

---

## Documentation Impact

- **JSDoc.** New/changed public JSDoc on `CollapseButtonEvent`, `CollapseButtonOptions.listeners.contextmenu`, `CollapseButton.on`, `SplitGutterEvent`, `SplitGutterOptions.listeners.contextmenu`, `SplitGutter.on`, `SplitGutter.setMovable`, `SplitGutterOptions.movable`, and `Split.setPaneResizeWeight`. Per CODE_CONVENTIONS.md these may only `{@link}` public symbols — describe `openGutterMenu` / `_weights` in prose, never by name.
- **No new exports.** All three classes are already exported through their existing barrels; no catalog, sidebar, or `typedoc.json` change.
- **`packages/lib/docs/layouts/Split.md`.** Add a `## Gutter context menu` section after `### Resizable but not collapsible` (line 90-104), listing the six rows, their orientation-dependent labels, and that the collapse rows write the neighbour's `collapseDirection` constraint. Cross-link it from the `## Collapsible panels` prose that already explains `collapseDirection` (lines 68-83). Add `setPaneResizeWeight(pane, weight)` to the `## Common methods` table (line 131-141), documenting `undefined` as the clear.
- **`packages/lib/docs/reference/changelog/next.md`.** Under `## Added`, a `### Split` block for the gutter context menu and for `SplitGutter`'s / `CollapseButton`'s new `"contextmenu"` event. Under `## Changed`, note that `SplitGutter.setMovable` is now live at runtime and that `setPaneResizeWeight` accepts `undefined`.
- **No renames or removals**, so no `grep -rln '\bOldName\b' docs/` sweep is needed. `packages/lib/docs/concepts/events.md` names `SplitGutter` but lists no individual event names, so it needs no edit.

---

## Potential Challenges

- **`CollapseButton` now suppresses the native context menu everywhere, including on a `Border` region's chevron**, where no framework menu replaces it. This is a deliberate, stated cost: the alternative (deciding the disposition from whether anyone subscribed) adds machinery for a one-bit difference on a 10×40 px grip, and every other framework surface already suppresses the native menu.
- **Retargeting the collapse direction of a gutter serving a *collapsed* pane would strand that pane** — `paneServingGutter` would return `-1`, so `doLayout` lays the pane out expanded while `_collapsed` still says `true`. Mitigated by disabling both `Collapse …` rows while `gutter.isOpaque()`.
- **A pane pinned with a declarative `weight: 0` constraint shows its `Fix …` row unchecked** until the user toggles it, because the row mirrors the imperative override only. Mitigated by choosing that reading deliberately, so the checkbox is always the exact inverse of what the toggle writes and can never get stuck checked.[^pin-reading]
- **`openGutterMenu` indexes `getLaidOutComponents()` with the gutter's creation-time index.** A non-displayed pane shifts that list. The sibling `collapse` handler already carries the same exposure, so this introduces no new failure mode; the `!lead || !next` guard keeps it from throwing.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — the event union (18), options `listeners` bag (69-74), `_movable` (112), chevron construction (154-157), drag wiring gate (174-180), `setMovable` (279-283), `on`/`emit` blocks (445, 477), `onDragStart` (516-534), `applyCursor` (593-599).
- [`packages/lib/src/typescript/lib/component/container/CollapseButton.ts`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts) — the precedent for a chevron-owned DOM gesture re-emitted as a typed event: `onDoubleClick` (290-294), `onMouseDown` (303-305), listener wiring (157-158).
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `paneDirection` (278-282), `paneCollapsible` (296-298), `gutterTargetPane` (311-323), `paneServingGutter` (336-344), `setPaneResizeWeight` (477-481), `getPaneResizeWeight` (491-493), `detach` (1036-1071), gutter creation + `on` wiring (1190-1217), the `setCollapseDirection` calls in `doLayout` (1247, 1301-1304).
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — the precedent this plan mirrors: `_contextMenu` field (518), `openTabMenu` (1751-1801) building `MenuItemConfig[]` with `enabled` flags and calling `show(x, y, configs)`.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — rebuild-mode `show` (250-263) and the class doc's right-click example (83-102).
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` (41-90): `text` (43), `action` (45), `enabled` (47), `checked` (66), `separator` (89).
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `setLayoutConstraints` (517-524), `delLayoutConstraints` (533-537), `getLayoutConstraints` (548-550), and `resolveBounds` (346-359) which shows an all-defaults `LayoutConstraints` is inert.
- [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts) — `weight` (101), `collapsible` (119), `collapseDirection` (128).
- [`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts) — `ensureGutter` (371-395), showing Border subscribes to `collapse` only. **Read to confirm no change is needed; do not edit.**
- [`packages/lib/tests/component/container/TabBar.contextMenu.test.ts`](packages/lib/tests/component/container/TabBar.contextMenu.test.ts) — the probe pattern the new `Split` suite copies.
- [`packages/lib/tests/component/layout/Split.test.ts`](packages/lib/tests/component/layout/Split.test.ts) — `emptyHost` / `hostSplit` helpers (26-52) and the `(split as any)._gutters[0]` access the new suite reuses.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (5-33), especially the listener return protocol and the ban on cross-component `Event` listening.

---

## Non-Goals

- **`Border` gets no context menu and no source change.** Its gutters are built `movable: false` and each region's collapse direction is fixed by its `Placement`, so none of the six rows has a meaningful analog.
- **No persistence of lock / pin / collapse-direction state.** Like the existing collapsed state, these are in-memory only; a consumer that wants them saved reads them through the existing getters.
- **No public runtime setter for `collapseDirection`.** The constraint write stays private to `Split`; only the menu drives it.
- **No keyboard route to the menu.** The trigger is a right-click on the chevron, matching every other context menu in the library.
- **No submenu, glyphs, or shortcuts on the rows.** Six flat rows and two separators.
- **`getPaneSizes` / `applyPaneSizes` are not changed.** They already read the pin through `isResizePinnedMain`, so a menu-driven pin flows through unchanged.

---

## Notes

[^border-untouched]: `Border.ensureGutter` (Border.ts:380-386) constructs each gutter with `movable: false` and a `listeners` bag carrying only `collapse`. Because the new menu is opened by `Split`'s subscription to the gutter's `"contextmenu"` event, a `Border` gutter emits the event into an empty bucket and nothing happens. The one visible consequence for `Border` is that its chevron no longer shows the browser's own context menu — see `## Potential Challenges`.

[^event-chain]: The chain already exists for collapse: `CollapseButton.onDoubleClick` emits `"collapse"` (CollapseButton.ts:290-294) → `SplitGutter`'s construction-time `listeners` bag re-emits it as the gutter's own `"collapse"` (SplitGutter.ts:156) → `Split.doLayout` subscribes with `gutter.on("collapse", …)` and resolves the target pane (Split.ts:1204-1212). The alternative — `SplitGutter` calling `Event.addListener(this._collapseButton, "contextmenu", …)` — is banned outright by ARCHITECTURE.md's *A component must not listen to another component's events through `Event`*, which names exactly this "parent listening on a child it just constructed" case.

[^menu-ownership]: Both existing right-click menus in the library are owned by the class that opens them and shown through rebuild-mode `Menu.show(x, y, configs)`: `TabBar._contextMenu` (TabBar.ts:518) and `Table._columnContextMenu` (Table.ts:157). Both hold the panel in a plain field rather than registering it as a child, and dispose it explicitly, because `Menu` is `LayerManager`-mounted and the destructor's child recursion cannot reach it. `Split` differs from those two in one respect only: it is a `LayoutManager` with no destructor, so the disposal hook is `detach()` — which already disposes the gutters. `detach()` can run on a manager swap and be followed by a re-attach, so the field is created lazily (`??=`, as `MenuButton.toggleMenu` does at MenuButton.ts:182) and nulled on detach rather than eagerly re-allocated, which would leak a `Menu` on a disposed `Split`.

[^live-movable]: The flag was previously read exactly once, at SplitGutter.ts:178, to decide whether to wire `mousedown` at all. Two designs were considered. Adding a second `_locked` field beside `_movable` would leave `Border` untouched but give the class two fields meaning "can this be dragged", which CLAUDE.md's *Simplicity First* rules out. Keeping the construction-time wiring gate and adding the live check inside `onDragStart` would work for `Split` (whose gutters start movable) but silently leave `setMovable(true)` inert on any gutter constructed with `movable: false` — a latent trap. Wiring unconditionally and gating live removes the trap and leaves one flag. The cost is one inert listener registration per `Border` gutter, which can never fire anyway: `Border`'s gutters set `pointerEvents: "none"` on their body (SplitGutter.ts:170-172), so a `mousedown` never targets them.

[^clear-weight]: `Split._weights` deliberately distinguishes absence from an explicit `0` — `effectiveResizeWeight` (Split.ts:509-511) falls back through the `weight` constraint to the pane's stored size when the map has no entry, whereas `0` pins. Without a way to delete the entry there is no way to undo a pin, and writing some positive weight instead would be a different behaviour (proportional absorption at that weight, not the pre-pin default). Deleting is the exact inverse of setting. `recalculateSizes` already prunes `_weights` in its own pass (Split.ts:1544-1548), so a deleted entry needs no other bookkeeping.

[^constraint-merge]: `LayoutManager` stores constraints in a `Map<string, LayoutConstraints>` keyed by component id (LayoutManager.ts:46), and `getLayoutConstraints` returns the stored instance itself, not a copy. Mutating that instance and re-storing it is therefore both sufficient and non-destructive; building a replacement object would silently drop `collapsible`, `weight`, `fill`, `anchor`, `closeable` and every other field the caller set at `addComponent` time. `setLayoutConstraints(component, undefined)` *deletes* the entry (LayoutManager.ts:518-520), so the argument must never be allowed to go undefined here. For a pane with no constraints, a fresh `new LayoutConstraints()` is inert: its class defaults are `fill: null` and `anchor: null`, and `resolveBounds` (LayoutManager.ts:355-359) falls through both to the caller-supplied values, while `collapsible` and `weight` stay `undefined` and keep their unset meanings.

[^schedule-layout]: `Split.doLayout` writes `gutter.setCollapseDirection(this.paneDirection(...))` in both the collapsed-strip branch (Split.ts:1247) and the expanded-divider branch (Split.ts:1301-1304), and `gutter.setCollapsible(target >= 0)` alongside. Calling `setCollapseDirection` directly from the menu action as well would duplicate that write in a second place, and the two could drift; routing through the layout pass keeps one writer. `applyPaneRatios` (Split.ts:791), `applyPaneSizes` (Split.ts:882) and `setPaneCollapsedImmediate` (Split.ts:924) all end the same way, with `container.scheduleLayout()`.

[^pin-reading]: The alternative reading is `isResizePinnedMain(pane)` (Split.ts:564-566), which resolves the *effective* weight and so also reports `true` for a pane pinned declaratively with a `weight: 0` constraint. Using it would produce a checkmark the toggle cannot clear: the "off" action deletes the imperative entry, the constraint still resolves to `0`, and the row re-opens still checked. Reading `getPaneResizeWeight(pane) === 0` keeps the row an exact mirror of what the toggle writes. The trade is that a declaratively pinned pane reads unchecked on first open; toggling it on then writes the imperative `0` that already matched its behaviour, so nothing changes visually, and toggling off returns it to the declarative pin.
