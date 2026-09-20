# Destructors That Never Run Or Never Reach — Implementation Plan

## Overview

Five entries in the render-review correctness register — C8, C9, C10, C11
and C14 — cover seven classes that leak on teardown, in two shapes.

Three hand `DragManager`'s process-wide registry a closure and throw it
away, so the registry keeps the component and its whole subtree for the
life of the page:
[`overlay/Dock.ts:448`](packages/lib/src/typescript/lib/overlay/Dock.ts#L448),
[`overlay/Window.ts:165`](packages/lib/src/typescript/lib/overlay/Window.ts#L165),
[`component/table/TreeBody.ts:132`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L132).
Four hold a component that is not a registered child, so the base class's
recursion over `_components` never reaches it:
[`component/table/cell/renderer/TreeCell.ts:221`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L221),
[`component/input/AbstractCalendarDropdown.ts:1007`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L1007),
[`component/table/TablePanel.ts:132`](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L132)
and its near-verbatim copy
[`component/table/TreeTablePanel.ts:138`](packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts#L138).

The test gate that should have caught them cannot see them.
[`tests/helpers/libraryClassScan.mjs`](packages/lib/tests/helpers/libraryClassScan.mjs)
scans the library source for two line patterns — a declared
`protected destructor(`, and a self-registered `Event.add*(this, …)` — and
the two registry tests derive their expected class lists from it. A class
that owns disposable state but declares no destructor matches neither
pattern, so no coverage is ever expected of it.

This plan fixes all five entries, adds a third scan pattern for classes that
hand `DragManager` a teardown closure, and moves `Dock`, `TablePanel` and
`TreeTablePanel` out of
[`dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts)'s
`UNCLAIMED_DESTRUCTOR_CLASSES` baseline into rows that actually prove their
teardown.

---

## Scope

**One plan.** The five entries are one failure mode with two faces — a
teardown closure that is never called back, and a component that left
`_components` and was never disposed — and both faces are proved by the
same two mechanisms: a registry test that watches a registry shrink, and
the construct/destroy balance the full-teardown registry already
asserts.[^one-plan] The new scan pattern is not separable from the fixes:
its entire population today is five classes, three of which this plan
fixes, and a gate landing without them would fail the build on arrival.

The one seam where a split would be clean runs between
`Dock`/`Window`/`TreeBody` (which need the new `DragManager` accessor and
the new scan pattern) and `TreeCellRenderer`/`AbstractCalendarDropdown`/the
two panels (which need neither). That split would produce a second plan of
three one-line fixes with no shared decision in it, so it is not taken.

---

## Architecture Decisions

### A teardown closure is stored in a field and called from `destructor()`

Each class that calls `DragManager.makeDragSource` / `makeDropTarget`
keeps the returned closure in a private field (or a collection of them) and
runs it from its `destructor()` before `super.destructor()`. The precedent
is [`layout/DockRegion.ts:41`](packages/lib/src/typescript/lib/layout/DockRegion.ts#L41)
— `private _teardown: () => void`, assigned at `:59`, called from
`destroy()` at `:132` — and, for the bag-of-closures case,
[`component/container/TabBar.ts:565`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L565)'s
`_dndTeardowns` array, swept by `teardownTabDnD()` from `destructor()` at
`:805`.

**The teardown must run before `super.destructor()`.** `DragManager`'s
source teardown calls `component.removeMouseDownSubtreeListener(...)` on
the registered component
([`overlay/DragManager.ts:309`](packages/lib/src/typescript/lib/overlay/DragManager.ts#L309)),
and `super.destructor()` is what destroys that component — the window
header for `Window`, the pooled rows for `TreeBody`.[^teardown-order]

### `TreeCellRenderer` needs one disposal, not a destructor

`refreshToggle` gains a `dispose()` on the outgoing toggle. It does **not**
gain a `destructor()`: the current toggle is added with `addComponent`
([`TreeCell.ts:238`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L238)),
so it is a registered child and the base recursion already reaches
it.[^treecell-correction]

### `AbstractCalendarDropdown` disposes whichever half sits detached

`openYearScroller` detaches the day grid and attaches the year column;
`closeYearScroller` does the reverse. Whichever of the two is detached when
the dropdown is destroyed is no longer a registered child, so the new
`destructor()` disposes the detached one, chosen by the
`_yearScrollOpen` flag.[^calendar-two-faces]

### The third scan pattern is a `DragManager` registration, and nothing else

`libraryClassScan.mjs` gains one pattern: a line that calls
`DragManager.makeDragSource(` or `DragManager.makeDropTarget(` and is not a
JSDoc continuation line. It matches five classes today and one of them is
innocent.[^pattern-choice] The rejected candidates and their measured hit
counts are in the table below.

| Candidate | Classes matched | Would have caught | Verdict |
|---|---|---|---|
| `DragManager.make{DragSource,DropTarget}(` | 5 (1 innocent) | C8, C9 | **chosen** |
| `.showOverlay(` | 3, all already declaring a destructor | nothing — gate is green today | rejected: a declared destructor is not a destructor that *reaches* the spinner |
| `.removeComponent(this._…)` | 16 (11 with no destructor, 9 of them unrelated) | C10, C11 | rejected: 9-entry baseline on arrival, and misses C8 and C14 |
| a field typed `(() => void)` | 60+ | — | rejected: nearly every bound event handler matches |
| a field named `*teardown*` | 3 | C9 | rejected: `_unregister`, `_themeCleanup`, `_closeHandler` are teardown closures under other names — a gate you escape by renaming a field is not a gate |
| a `Component`-typed field never passed to `addComponent` | — | C11, C14 | not line-detectable: needs a cross-file table of which type names are `Component`s |

### A scan proves a destructor exists; only a runtime test proves it reaches

`TablePanel` declares a destructor and still leaks its spinner, so no
source-line pattern can separate it from a class that tears down
correctly — "does this destructor reach this member" is a runtime fact. The
scan therefore answers only "does a destructor exist at all", and the
classes whose destructors must *reach* a member are promoted into
`dispose-full-teardown.test.ts` rows, where the existing construct/destroy
balance assertion catches an undisposed member directly.[^split-of-labour]

### `DragManager` gets one test-only id accessor

`DragManager._registeredComponentIds()` returns the ids currently
registered as a drag source or a drop target, mirroring
[`core/Event.ts:753`](packages/lib/src/typescript/lib/core/Event.ts#L753)'s
`_registeredComponentIds()` in name, shape and JSDoc. It returns ids rather
than counts because the registries are module-level and survive between
tests in a file, so the assertion has to be "none of *my* ids survive", not
"the registry is empty".[^accessor-shape]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/overlay/DragManager.ts
// Inside `export namespace DragManager`, placed after `cancel()`.

/** Ids currently registered as a drag source or drop target; for tests only. @internal */
export function _registeredComponentIds(): readonly string[];
```

```typescript
// packages/lib/tests/helpers/libraryClassScan.mjs  (+ the .d.mts sibling)

/** Class names calling `DragManager.makeDragSource(` / `makeDropTarget(` — the drag-teardown registry's source of truth. */
export function classesRegisteringDragTargets(): string[];
```

New `protected destructor(): void` overrides, each ending in
`super.destructor()`:

```typescript
// overlay/Window.ts:42
class Window extends AbstractWindow { protected destructor(): void; }

// component/table/TreeBody.ts:113
class TreeBody extends _Body { protected destructor(): void; }

// component/input/AbstractCalendarDropdown.ts:493
abstract class AbstractCalendarDropdown<
    TOptions extends AbstractCalendarDropdownOptions = AbstractCalendarDropdownOptions
> extends AnimatedDropdown<TOptions> { protected destructor(): void; }
```

New private fields:

```typescript
// overlay/Dock.ts
private _emptyDropTeardown: (() => void) | null = null;

// overlay/Window.ts
private _headerDragTeardown: (() => void) | null = null;
```

---

## Internal Structure

### The new scan pattern

```javascript
/** The drag-teardown registry's source of truth. The lookahead skips JSDoc
 *  continuation lines, so `DragManager.ts`'s own `@example` block and the
 *  `{@link}` references in `TreeBody`'s method docs are not matches. */
const DRAG_REGISTRATION = /^(?!\s*\*).*DragManager\.make(DragSource|DropTarget)\(/;
```

| Source line | Match? |
|---|---|
| `        DragManager.makeDropTarget(this, {` | yes |
| `        this._teardown = DragManager.makeDropTarget(region, {` | yes |
| `        return DragManager.makeDragSource(entry.button, {` | yes |
| ` * const tearDownSrc = DragManager.makeDragSource(row, {` | no — JSDoc `@example` |
| `     * [\`DragManager.makeDropTarget\`](/api/…) for a pool row` | no — JSDoc `{@link}` |
| `    export function makeDropTarget(component: Component, …` | no — the declaration, not a call |

Applied to `master` the pattern matches exactly five classes:

| Class | Site | Status after this plan |
|---|---|---|
| `Dock` | `overlay/Dock.ts:448` | row in the new registry |
| `Window` | `overlay/Window.ts:165` | row in the new registry |
| `TreeBody` | `component/table/TreeBody.ts:613`, `:627`, `:740` | row in the new registry |
| `TabBar` | `component/container/TabBar.ts:2973`, `:3021` | row in the new registry (already correct today) |
| `DockRegion` | `layout/DockRegion.ts:59` | the sole `UNCLAIMED_DRAG_TEARDOWN_CLASSES` entry |

### How the new baseline declares a class innocent

`UNCLAIMED_DRAG_TEARDOWN_CLASSES` copies
`UNCLAIMED_DESTRUCTOR_CLASSES`'s shape exactly: a `readonly string[]`
compared with `expect(unclaimed).toEqual([...BASELINE])`, so an entry going
*in* is as visible in review as a row going in. An entry is only legitimate
when its comment names the teardown path that stands in for a destructor.
`DockRegion` qualifies: it is not a `Component` at all, it owns a plain
`destroy()` at
[`layout/DockRegion.ts:131`](packages/lib/src/typescript/lib/layout/DockRegion.ts#L131)
that calls `this._teardown()`, and `Dock.destructor` calls that `destroy()`
for every wired region
([`overlay/Dock.ts:2379`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2379)).

---

## Ordered Implementation Steps

Steps 1–3 are the shared tooling; 4–11 are the fixes, each with its test;
12–13 are the gate; 14 is documentation. Step 7 depends on steps 1 and
4–6; step 12 depends on steps 4–6 and 10–11.

1. **`packages/lib/src/typescript/lib/overlay/DragManager.ts`** — add
   `_registeredComponentIds()` inside the `DragManager` namespace, after
   `cancel()`. Body: collect `dragSources.keys()` and `dropTargets.keys()`
   into a `Set<string>`, return `Array.from(...)`. Both maps are
   `Map<string, …>` keyed by `component.getId()`, which returns a primitive
   `string` ([`core/BaseObject.ts:24`](packages/lib/src/typescript/lib/core/BaseObject.ts#L24)),
   so no `String`-object normalisation is needed — unlike `Event`'s copy of
   this accessor. Use the one-line JSDoc form from
   [`core/Event.ts:752`](packages/lib/src/typescript/lib/core/Event.ts#L752):
   a single sentence ending `for tests only. @internal`.
   *Check:* `npm run typecheck` in `packages/lib`.

2. **`packages/lib/tests/helpers/libraryClassScan.mjs`** — add the
   `DRAG_REGISTRATION` constant (exact regex in `## Internal Structure`)
   beside the two existing pattern constants, and export
   `classesRegisteringDragTargets()` delegating to the existing
   `classesMatching(...)` helper. Match the one-line JSDoc style of its two
   siblings.

3. **`packages/lib/tests/helpers/libraryClassScan.d.mts`** — declare
   `classesRegisteringDragTargets(): string[]` alongside the two existing
   declarations, with the same JSDoc line.
   *Check:* `npm run typecheck:test` in `packages/lib`.

4. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — add the
   `_emptyDropTeardown` field; assign it in `wireEmptyDropTarget` (`:447`)
   from the `DragManager.makeDropTarget(...)` return; call it and null it
   at the **top** of the existing `destructor()` (`:2371`), before
   `this._emptyDropOverlay.dispose()`. Extend the destructor's JSDoc with
   one sentence naming the unregistration.

5. **`packages/lib/src/typescript/lib/overlay/Window.ts`** — add the
   `_headerDragTeardown` field; assign it in `wireMoveTrigger` (`:150`)
   from the `DragManager.makeDragSource(this._header, …)` return; add a
   `protected destructor()` that calls the teardown, nulls the field, then
   calls `super.destructor()`. The class has no destructor today, so this
   is a new method — place it immediately after the `wireMoveTrigger`
   block, with JSDoc explaining that the registration is keyed by the
   header's id and that the teardown must run before `super.destructor()`
   destroys the header.
   *Check:* `grep -n 'protected destructor' packages/lib/src/typescript/lib/overlay/Window.ts` — expect one match.

6. **`packages/lib/src/typescript/lib/component/table/TreeBody.ts`** — add
   a `protected destructor()` that, in order: iterates
   `this._rowDnDTeardowns.values()` calling each, clears the map, calls
   `this._emptyAreaDropTeardown?.()` and nulls it, then calls
   `super.destructor()`. Place it near the other lifecycle methods, after
   `teardownRowDnD` (`:692`). JSDoc must state that
   `super.destructor()` (via `VirtualRowView.destructor`,
   [`component/shared/VirtualRowView.ts:155`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L155))
   disposes the pooled rows, which is why the per-row teardowns run first.

7. **`packages/lib/tests/component/dispose-drag-teardown.test.ts`** —
   create the new registry test (shape in `## Expected Behaviour`), with
   rows for `Dock`, `Window`, `TreeBody` and `TabBar`, the
   `UNCLAIMED_DRAG_TEARDOWN_CLASSES` baseline holding only `'DockRegion'`,
   and the two coverage assertions
   `dispose-listener-teardown.test.ts` closes with — `every covers entry
   still registers a drag target` and `every class registering a drag
   target is claimed by a row or listed as unclaimed`.
   *Check:* `npx vitest run tests/component/dispose-drag-teardown.test.ts`
   — all rows pass. Reverting step 4, 5 or 6 individually must fail the
   matching row.

8. **`packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts`**
   — in `refreshToggle` (`:221`), hold the outgoing toggle in a local, keep
   the `removeComponent` call, and add `outgoing.dispose()` after it.
   `dispose()` does not remove a child from its parent's `_components`, so
   the `removeComponent` call stays. Mirror
   [`Button.clearDescription`](packages/lib/src/typescript/lib/component/button/Button.ts#L1434)'s
   JSDoc addition: a caller holding a reference from `getToggle()` must not
   reuse it across a `setTreeState` call. Do **not** add a `destructor()`.
   *Check:* `grep -n 'protected destructor' packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` — expect zero matches.

9. **`packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts`** —
   add the C10 regression test, copying
   [`tests/component/button/Button.test.ts:641`](packages/lib/tests/component/button/Button.test.ts#L641)'s
   shape (`Diagnostics.counters()` balance plus `_ruleCacheKeys().length`).

10. **`packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts`**
    — add a `protected destructor()` after `closeYearScroller` (`:1007`)
    that disposes `this._dayGrid` when `this._yearScrollOpen` is true and
    `this._yearColumn` otherwise, then calls `super.destructor()`. JSDoc
    must name both cases and say why: the detached half is no longer a
    registered child, so `super.destructor()`'s recursion over
    `_components` cannot reach it.

11. **`packages/lib/src/typescript/lib/component/table/TablePanel.ts`** and
    **`TreeTablePanel.ts`** — add `this._spinner?.dispose();` as the first
    line of each existing `destructor()` (`:132` and `:138`) and extend
    each JSDoc with one sentence: the spinner is mounted by `showOverlay`
    ([`component/display/ProgressSpinner.ts:236`](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L236)),
    which raw-appends it onto the table's element, so it is never a
    registered child of the panel. The two files are near-verbatim copies —
    make the two edits identical apart from the field they read.

12. **`packages/lib/tests/component/dispose-full-teardown.test.ts`** —
    - remove `'Dock'`, `'TablePanel'` and `'TreeTablePanel'` from
      `UNCLAIMED_DESTRUCTOR_CLASSES`;
    - add rows `Dock` (`covers: ['Dock']`), `TablePanel`
      (`covers: ['TablePanel']`), `TreeTablePanel`
      (`covers: ['TreeTablePanel']`), `Window` (`covers: ['Window']`) and
      `TreeBody` (`covers: ['TreeBody']`) — drivers in
      `## Expected Behaviour`;
    - add `'AbstractCalendarDropdown'` to the existing `DateEditor` row's
      `covers`, and extend that row's `make` to call the dropdown's
      `openYearScroller()` then `closeYearScroller()`;
    - add one more row, `DateEditor (year scroller open)`, whose `make`
      opens the scroller and leaves it open, with **no** `covers` (the
      first row already claims `AbstractCalendarDropdown`; a second claim
      would be redundant, and the `Link` and `ChartLegend` rows are the
      precedent for a `covers`-less row).
    *Check:* `npx vitest run tests/component/dispose-full-teardown.test.ts`.
    The assertion `every declared destructor is claimed by a row or listed
    as unclaimed` is exact equality, so a missed promotion fails it.

13. Run the two other gates unchanged:
    `npx vitest run tests/component/dispose-listener-teardown.test.ts tests/component/dispose-store-subscription-teardown.test.ts`.
    Neither needs an edit — no class in this plan gains an
    `Event.add*(this, …)` registration or a store subscription.

14. **`packages/lib/docs/reference/changelog/next.md`** — add entries under
    `## Fixed`: one covering `Dock` and `Window` under `### Overlay`; one
    each for `TreeBody`, `TreeCellRenderer`, `AbstractCalendarDropdown` and
    the two panels (together, since they are copies) under
    `### Components`. Each says what leaked and that no consumer action is
    needed, except `TreeCellRenderer`, which notes the `getToggle()`
    reference rule.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Window.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TablePanel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.mjs` |
| Modify | `packages/lib/tests/helpers/libraryClassScan.d.mts` |
| Create | `packages/lib/tests/component/dispose-drag-teardown.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### The drag registry empties (unit-testable)

`DragManager._registeredComponentIds()` holds no id belonging to a
component's subtree once that component is disposed. All four rows go in
`dispose-drag-teardown.test.ts`, which mirrors
[`dispose-listener-teardown.test.ts`](packages/lib/tests/component/dispose-listener-teardown.test.ts):
snapshot the ids, dispose, assert none survive.

| Row | `make` | Which ids to snapshot |
|---|---|---|
| `Dock` | `new Dock()`, `getElement(true)`, `setWidth(800)`, `setHeight(600)` | `collectIds(dock)` — the registered id is the dock's own |
| `Window` | `new Window('W')`, `getElement(true)` — never `show()` | `collectIds(win)` — the registered id is the header's, a registered child |
| `TreeBody` | store with two records, `setReparentHandlers(() => true, () => true)`, `getElement(true)`, `setWidth(400)`, `setHeight(200)`, `renderWindow(400, [100, 100, 100])` | `collectIds(body)` **plus** each `getRowPool()` row's id |
| `TabBar` | `new TabBar({ reorderable: true })`, `getElement(true)`, `createBarEntry('a', 'Alpha')` | `collectIds(bar)` **plus** `collectIds(bar._tabClip)` |

Two rows need ids that `collectIds` alone cannot reach, both for the same
reason — the component is raw-appended rather than registered, so
`getComponents()` never returns it. `TreeBody`'s pooled rows are kept only
in `_rowPool`
([`component/shared/VirtualRowView.ts:144`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L144)),
and `TabBar`'s `_tabClip` — the component the drop target is registered on
— is appended straight to the strip element. Reach them with the
`ids?: (c: Component) => string[]` row hook
`dispose-listener-teardown.test.ts` already defines for its
`List (pool shrink)` row, casting to the private field as the
`dispose-full-teardown.test.ts` `TabBar` row's `ownIds` already does.

`TabBar` is the control row: it passes on `master` and must keep passing,
which is what shows the other three rows are not asserting something
trivially true.

### Nothing is left undisposed (unit-testable)

Each case below is one `dispose-full-teardown.test.ts` row, asserting zero
leaked rule-cache keys and a construct/destroy balance of zero. The
"today" column is measured on `master` at `39fa8097` in jsdom, with the
registry's own warm-up pass subtracted.

| Row | Driver, after `getElement(true)` | Today | After |
|---|---|---|---|
| `TablePanel` | `handleStoreLoadingChange({loading: true})` then `({loading: false})` | 2 components, 2 rules | 0, 0 |
| `TreeTablePanel` | same | 2, 2 | 0, 0 |
| `DateEditor` (extended) | `openDropdown()`, then the dropdown's `openYearScroller()` and `closeYearScroller()` | 185, 172 | 0, 0 |
| `DateEditor (year scroller open)` | `openDropdown()`, then the dropdown's `openYearScroller()` only | 43, 30 | 0, 0 |
| `Dock` | `setWidth(800)`, `setHeight(600)`, `doLayout()` | 0, 0 | 0, 0 |
| `Window` | none | 0, 0 | 0, 0 |
| `TreeBody` | as in the drag table above | 0, 0 | 0, 0 |

The last three rows already balance today; they exist because `Dock` leaves
the `UNCLAIMED_DESTRUCTOR_CLASSES` baseline and because `Window` and
`TreeBody` newly declare a destructor, which the coverage assertion then
demands a row or a baseline entry for.

Reaching a private driver through a cast is the registry's established
idiom — see its `MenuButton`, `SplitButton` and `Table` rows.

### The tree-table toggle swap strands nothing (unit-testable)

In `TreeCellRenderer.test.ts`, following
`Button.test.ts`'s `strands neither a component nor a stylesheet rule`
case: build a `TreeCellRenderer`, `getElement(true)`, snapshot the live
component count and `_ruleCacheKeys().length`, run three `setTreeState`
calls that flip the toggle, then dispose and assert both are back to the
snapshot. The live count is `Diagnostics.counters().componentsConstructed −
componentsDestroyed`; copy `Button.test.ts:537`'s two-line
`liveComponents()` helper into the new `describe` rather than exporting it.

| Toggles driven | Stranded today | Stranded after |
|---|---|---|
| 1 (`setTreeState(0, true, false)`) | 0 | 0 |
| 3 (collapsed → expanded → collapsed) | 2 | 0 |

The N−1 shape is the evidence that the *current* toggle is already reached
by the base recursion: only the outgoing ones leak.

### The calendar dropdown releases the detached half (unit-testable)

The two `DateEditor` rows above cover the two branches of the new
destructor:

| Dropdown state at dispose | Detached member | Today | After |
|---|---|---|---|
| year scroller closed (after open + close) | `_yearColumn` + its 171 year cells | 185 components, 172 rules | 0, 0 |
| year scroller left open | `_dayGrid` + its day cells | 43 components, 30 rules | 0, 0 |

### The gate refuses a sixth unclaimed drag registrant (unit-testable)

Adding a `DragManager.makeDropTarget(` call to any library class that has
no row and no baseline entry fails
`every class registering a drag target is claimed by a row or listed as
unclaimed`. Check by hand once during implementation, then revert the
probe edit.

### What the existing test files cover, and what they miss

| File | Covers today | Missing | This plan |
|---|---|---|---|
| `tests/overlay/Dock.lifecycle.test.ts` | 40+ cases on panel attach / detach / focus / close, the sweep, and the empty-state placeholder | nothing about teardown; `Dock` sits in `UNCLAIMED_DESTRUCTOR_CLASSES` | leave it untouched; `Dock` gets a `dispose-drag-teardown` row and a `dispose-full-teardown` row |
| `tests/component/table/TreeBody.test.ts` | the flatten relation, expand/collapse, orphan-as-root, the tree-column render window, inherited copy — its own header scopes the DnD tier out | teardown of any kind, and the DnD tier entirely | leave it untouched; `TreeBody` gets rows in both registries |
| `tests/component/table/cell/TreeCellRenderer.test.ts` | `getContentX` arithmetic, delegation, the leaf/branch toggle, the same-triple no-op | that a toggle swap strands the outgoing `Glyph` | add the C10 regression case here (step 9) |
| `tests/component/dispose-store-subscription-teardown.test.ts` | that `TablePanel` unsubscribes its store listeners on dispose | the spinner — it is a component, not a store subscription, so this file is the wrong gate for C14 | leave it untouched; C14 is proved by the `TablePanel` / `TreeTablePanel` rows in `dispose-full-teardown` |
| `tests/overlay/DragManager.test.ts` | that `makeDragSource` / `makeDropTarget` return a working teardown closure | that any *caller* runs the closure it was given | leave it untouched; the new registry file asks that question |

Promoted out of `UNCLAIMED_DESTRUCTOR_CLASSES` by this plan: `Dock`,
`TablePanel`, `TreeTablePanel`. Newly requiring a row because they start
declaring a destructor: `Window`, `TreeBody`, `AbstractCalendarDropdown`.
`Notification` and `Tooltip` stay in the baseline — neither is this plan's
bug.

### Manual verification

Three QA panels show the fixes in a real engine, and are **not** run by the
implementer — every run opens a full-screen window and needs the user's
explicit go-ahead. Record them as a documented manual step:
`treetable-rows` (C9, C10), `windows` (C8), `table-rows` (C14). For these
leaks the jsdom assertions above are the stronger evidence: a registry that
provably shrinks to nothing beats a frame-time delta that a collector can
mask.[^qa-panels]

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — expects 0 errors.
2. `npm run typecheck:test` — expects 0 errors; catches a missing
   `.d.mts` declaration for the new scan export.
3. `npx vitest run tests/component/dispose-drag-teardown.test.ts` — the new
   gate, 4 rows plus 2 coverage assertions.
4. `npx vitest run tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts tests/component/dispose-store-subscription-teardown.test.ts`
   — the three existing gates.
5. `npx vitest run tests/component/table/cell/TreeCellRenderer.test.ts tests/component/table/TreeBody.test.ts tests/overlay/Dock.lifecycle.test.ts tests/overlay/DragManager.test.ts`
   — the four files whose classes this plan edits.
6. `npm test` — the full suite, once.
7. `npm run lint`.
8. `npm run docs:api` — must emit no *new* warnings. `master` already emits
   14; the bar is "no more than before", not zero.[^docs-warnings]
9. `grep -rnE '^[^*]*DragManager\.make' src/typescript/lib --include=*.ts`
   — expect 8 hits: `Dock.ts` 1, `Window.ts` 1, `TreeBody.ts` 3,
   `TabBar.ts` 2, `DockRegion.ts` 1. Every one of the 8 must assign its
   return to a field, push it into a bag, or return it; none may discard
   it.

---

## Documentation Impact

`DragManager._registeredComponentIds` is `@internal`, and
[`packages/lib/typedoc.json:32`](packages/lib/typedoc.json#L32) sets
`excludeInternal: true`, so it renders on no API page and needs no
catalogue entry. The new `destructor()` overrides are `protected` and are
excluded the same way. No public signature changes, so no page under
`packages/lib/docs/components/` moves.

Per [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md), none of the new JSDoc may
`{@link}` `_registeredComponentIds`, `destructor`, or any private field —
describe the behaviour in prose instead. `npm run docs:llms:check` is
unaffected: it guards newly-shipped concrete classes, and this plan adds
none.

The only consumer-facing note is `TreeCellRenderer.getToggle()`: the
returned `Glyph` is destroyed by the next `setTreeState` that changes the
toggle. Record it in the method's JSDoc and in the changelog entry, exactly
as `Button.clearDescription` records the same rule for its description
label.

---

## Potential Challenges

- **The `DragManager` registries persist between tests in a file** — there
  is no reset hook and `DOM.reset()` does not touch them. Mitigation: every
  assertion is "none of my snapshotted ids survive", never "the registry is
  empty".
- **`TreeBody`'s pooled rows are invisible to `getComponents()`** — a row
  that snapshots only `collectIds(body)` would pass whether or not the
  per-row teardowns run. Mitigation: the row's `ids` hook reads
  `getRowPool()` explicitly; sanity-check by reverting step 6 and
  confirming the row fails.
- **Disposing the calendar's day grid mid-teardown** — `buildDayGrid`
  calls `this._dayGrid.disposeAllComponents()` on every rebuild
  ([`AbstractCalendarDropdown.ts:763`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L763)),
  so the grid's cells are already handled; only the grid container itself
  needs the new call. Mitigation: dispose `_dayGrid`, not its children.
- **`Window` must not be shown in a test** — `show()` registers the window
  in `AbstractWindow.openWindows` and starts entrance animations whose
  fallback timers write to released handles after `DOM.reset()`.
  Mitigation: the row constructs and renders the window only;
  `wireMoveTrigger` runs from the constructor via `initChrome`
  ([`overlay/AbstractWindow.ts:539`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L539)),
  so the registration is present without showing.
- **The scan attributes a match to the last column-0 class** — a future
  column-0 class declared in `DragManager.ts` above its `@example` block
  would take the example's lines as matches. Mitigation: the pattern's
  JSDoc-continuation lookahead already rejects them.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/layout/DockRegion.ts` | The teardown-in-a-field precedent this plan mirrors (`:41`, `:59`, `:131`), and the one class the new baseline exempts. |
| `packages/lib/src/typescript/lib/component/container/TabBar.ts` | The teardown-bag precedent (`:565`, `:805`, `:3293`) and the new gate's control row. |
| `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` | The in-family swap precedent C10's own comment cites — `setRowData` disposes the outgoing toggle at `:229-231`; `TreeRow` also needs a destructor (`:370`) because its toggle is raw-appended, which `TreeCellRenderer`'s is not. |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `clearDescription` at `:1434` — the landed fix for the same "dispose the outgoing instance" shape, including the JSDoc note about a stale caller reference. |
| `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` | The other landed fix of the same shape (`register`). |
| `packages/lib/tests/component/button/Button.test.ts` | `:641` — the balance + rule-count regression-test shape step 9 copies. |
| `packages/lib/tests/component/table/cell/CellEditorPool.test.ts` | `:175` — the `vi.spyOn(x, 'dispose')` variant of the same proof. |
| `packages/lib/src/typescript/lib/core/Event.ts` | `:752` — the `_registeredComponentIds` accessor the new one mirrors. |
| `packages/lib/src/typescript/lib/core/StyleTarget.ts` | `:305-311` — the other `_`-prefixed `@internal` test accessor, for the JSDoc form. |
| `packages/lib/src/typescript/lib/core/Component.ts` | `:1148` — `destructor()`, whose `_components` recursion is what these seven classes fall outside of. |
| `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` | `:155` — the ancestor destructor `TreeBody`'s must run after, and the reason pooled rows are invisible to `getComponents()`. |
| `packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` | `:236` — `showOverlay` raw-appends onto the target, which is why the two panels must dispose their spinner. |
| `packages/lib/tests/component/dispose-listener-teardown.test.ts` | The registry-plus-baseline shape the new test file copies wholesale. |

---

## Non-Goals

- **`ButtonGroup` (C16).** It is the fourth class the status pass named as
  declaring no destructor, but its leak is a per-button handler and a
  `RovingTabIndex`, not a drag registration or a stranded component. It
  belongs to the sibling *listeners and rules with no removal path* plan.
- **A `showOverlay` scan pattern.** Rejected above: all three of its
  classes already declare a destructor, so the gate would be green on
  arrival and green while `TablePanel` leaked.
- **`AbstractCalendarDropdown`'s `_yearTypeTimer`.** The pending
  type-ahead timer holds the dropdown until it fires, which is bounded by
  the idle timeout rather than growing — a different bug from the one this
  plan fixes, and out of its surgical scope.
- **Running any QA panel.** Every run opens a full-screen window on the
  user's desktop and needs their explicit go-ahead. The panels are named as
  a manual step, not performed.
- **Auditing the nine other classes that call `removeComponent` on one of
  their own fields.** That candidate pattern was rejected; the nine are not
  known bugs and nothing in this plan touches them.

---

## Notes

[^one-plan]: Splitting the gate out from the fixes was considered and
    rejected. The new scan pattern's population on `master` is five
    classes: `Dock`, `Window` and `TreeBody` (this plan's C8 and C9),
    `TabBar` (already correct) and `DockRegion` (innocent). A gate landing
    before the fixes would fail the build on its first run; one landing
    after them would leave three fixes with no standing guard in the
    interval. Splitting the fixes from each other was also rejected: C10,
    C11 and C14 are one-line changes whose only shared artefact is the
    `dispose-full-teardown.test.ts` promotion, which has to happen once,
    not three times.

[^teardown-order]: `tearDownDragSource` at `overlay/DragManager.ts:309`
    calls `component.removeMouseDownSubtreeListener(onSourceMouseDown)`
    before deleting the map entry. For `Window` that component is
    `this._header`, a registered child that `super.destructor()` destroys;
    for `TreeBody` they are the pooled rows that
    `VirtualRowView.destructor` disposes. Calling the teardown afterwards
    would reach into components whose handles have already been released.
    `tearDownDropTarget` (`:318`) only deletes a map entry, so `Dock`'s
    ordering is not load-bearing — it follows the same order for
    consistency.

[^treecell-correction]: `01-phase2-status-pass.md`'s correction 5 states
    that C10 needs a destructor created because "the final toggle leaks
    too". That is wrong, and measurably so. `TreeRow` raw-appends its
    toggle, which is why *it* needs a destructor
    (`component/tree/TreeRow.ts:370`); `TreeCellRenderer` uses
    `this.addComponent(toggle)` at `TreeCell.ts:238`, so the toggle joins
    `_components` and `Component.destructor`'s recursion reaches it.
    Measured in jsdom on `master`: one `setTreeState` with no swap strands
    0 components and 0 rules; three `setTreeState` calls flipping the
    toggle strand exactly 2 of the 3 glyphs built. The N−1 result is only
    consistent with the current toggle being disposed by the base
    recursion. Adding a destructor here would also put `TreeCellRenderer`
    into `classesDeclaringDestructor()`, forcing a row or a baseline entry
    for a class with nothing left to prove.

[^calendar-two-faces]: The register names only the year column. Measured on
    `master`, a `DateEditor` whose dropdown opened and closed the year
    scroller strands 185 components and 172 rules — the detached
    `PickerColumn` plus its 171 year cells (`DEFAULT_YEAR_SPAN_BACK` 120 +
    `DEFAULT_YEAR_SPAN_FORWARD` 50 + the current year). But
    `openYearScroller` detaches `_dayGrid` in the same breath
    (`AbstractCalendarDropdown.ts:990`), and `closeYearScroller` is what
    puts it back — so a dropdown destroyed *while the scroller is open*
    strands the day grid instead: 43 components and 30 rules, measured the
    same way. One destructor covers both by disposing whichever half
    `_yearScrollOpen` says is detached.

[^pattern-choice]: The pattern was chosen by measuring each candidate
    against the whole library source and counting classes that match but
    declare no destructor — the population the gate would demand work for
    on day one. `DragManager.make*`: 5 matches, 3 of them this plan's bugs,
    1 innocent, so a one-entry baseline. `.showOverlay(`: 3 matches, all 3
    already declaring a destructor, so the gate cannot distinguish the
    leaking `TablePanel` from the correct `DiagramView`.
    `.removeComponent(this._…)`: 16 matches, 11 with no destructor, 2 of
    them this plan's — so a 9-entry baseline on arrival, whose reduction
    means auditing nine unrelated classes (`IconText`, `IconLabel`,
    `AccordionHeader`, `Scrollbar`, `WindowHeader`, `DiagramNode`,
    `DialogTitleBar`, `GlyphRenderer`, `AbstractBooleanInput`), and it
    still misses C8 and C14 entirely. A field
    typed `(() => void)`: 60+ matches, overwhelmingly bound DOM handlers. A
    field named `*teardown*`: 3 matches, but `MarkdownEditor._unregister`,
    `AbstractChart._themeCleanup` and `AnimatedDropdown._closeHandler` are
    the same kind of closure under other names, so the pattern measures
    naming discipline rather than behaviour.

[^split-of-labour]: A line-level regex over source can establish exactly
    one thing about teardown: whether a `protected destructor(` line
    exists. Everything else the gate would want to know — does the
    destructor call `super.destructor()`, does it reach this field, is this
    field a registered child — is a fact about the running object graph.
    `TablePanel` is the proof: it has declared a destructor since it was
    written, and that destructor has never touched `_spinner`. The runtime
    counterpart already exists and works —
    `dispose-full-teardown.test.ts`'s `componentsConstructed −
    componentsDestroyed` assertion catches an undisposed member with no
    pattern-matching at all — and it caught nothing here only because these
    classes had no row. Hence: the scan decides *which* classes must be
    covered, and the runtime rows decide whether they *are*. The
    `Component`-typed-field-never-added candidate fails on both counts: it
    is not line-detectable (knowing `ProgressSpinner` is a `Component`
    means reading another file), and the balance assertion already answers
    the same question exactly.

[^accessor-shape]: Three shapes were weighed against the repo's pre-1.0
    policy, which deletes unused public API and makes exported-but-internal
    symbols private. A count accessor (`_registrationCount()`) is smaller
    but unusable: `dragSources` and `dropTargets` are module-level and
    nothing resets them between tests in a file, so a count assertion would
    be order-dependent. Two accessors, one per map, double the surface for
    no test that needs the distinction. Exposing the maps themselves would
    let a test mutate the manager's state. The chosen shape is the one the
    codebase already uses for exactly this job — `Event`'s
    `_registeredComponentIds()` at `core/Event.ts:753` and
    `StyleTarget`'s `_ruleCacheKeys()` at `core/StyleTarget.ts:311` — an
    `_`-prefixed, `@internal`, read-only snapshot. It is not unused API: it
    has a caller from the commit it lands in, and it cannot be private
    because the caller is outside the module. `excludeInternal: true` keeps
    it off every docs page.

[^qa-panels]: The QA app measures frame-time and DOM-work counters, and
    `00-post-campaign-agenda.md` item 6 already found that C10's stylesheet
    churn is GC-bounded: `deleteStyleRule` tracked elapsed time rather than
    toggle count, because `Component`'s `FinalizationRegistry` reclaims the
    orphaned carets' rules at collection. A panel run can therefore show a
    leak shrinking without proving it gone. The jsdom assertions do prove
    it: `Diagnostics`' construct/destroy balance and the rule-cache key
    diff are exact and deterministic. The panels stay in the plan as the
    real-engine sanity check the user may authorise, not as the evidence
    the fix rests on.

[^docs-warnings]: `00-post-campaign-agenda.md` records that
    `npm run docs:api` emits 14 warnings on `master`, and instructs plans
    to stop writing a zero-warning bar into their verification rather than
    silently inheriting a failing gate. The bar here is therefore "no new
    warnings"; fixing the existing 14 is separate work.

---

## Implementation Notes

**The C10 regression test snapshots before constructing the renderer, not
after.** `## Expected Behaviour` describes step 9's case as "build a
`TreeCellRenderer`, `getElement(true)`, snapshot the live component count and
`_ruleCacheKeys().length`, run three `setTreeState` calls that flip the
toggle, then dispose and assert both are back to the snapshot" — but a
snapshot taken after construction can never be returned to by a `dispose()`
that also destroys the renderer and its delegate, which were constructed
before it. The snapshot is therefore taken before the whole round trip
(construct → three `setTreeState` calls → dispose), which is the only reading
consistent with the plan's own measured "stranded today: 2": the two outgoing
glyphs survive, while the third is reclaimed by the base recursion along with
the renderer itself. `Button.test.ts:641`, the cited precedent, has no such
problem because its round trip leaves the button alive on both sides of the
assertion. The same case departs from that precedent a second way, for the
same unavoidable reason: it runs the round trip twice and snapshots between
the two, because the first renderer of the process materialises shared
class-tier rules that no instance's dispose is meant to reclaim.
`Button.test.ts` needs no warm-up only because its file has already built many
`Button`s by then; the warm-up pass itself is
`dispose-full-teardown.test.ts`'s own established idiom.

**The red-state measurements matched the plan's tables exactly**, which is
what shows the new rows are not asserting something trivially true. Before
the fixes: `dispose-drag-teardown.test.ts` failed on `Dock`, `Window` and
`TreeBody` (the last leaking three ids — the body plus both pool rows, so the
row's `ids` hook is load-bearing) while the `TabBar` control row passed;
`dispose-full-teardown.test.ts`'s extended `DateEditor` row leaked 172 rules,
the figure `[^calendar-two-faces]` predicts; and the `TreeCellRenderer` case
stranded exactly 2 components. The `TreeTablePanel` row's driver needed a
`columns` entry neither step 12 nor `## Expected Behaviour` mentions
(`TreeTableSpec` inherits a required `columns` from `ColumnSpec`), and with the
fix reverted by hand that row fails, so its green is earned rather than
inherited from the sibling panel's.

**Both `Dock` rows force the region sweep, which the plan's driver tables do
not list.** They stop at `setHeight(600)` / `doLayout()`, but the sweep that
populates `_wiring` is scheduled through `requestAnimationFrame`, and the
offline sink records that call without ever firing the callback. A dock left
to schedule its own sweep therefore reaches `dispose()` with no wired region
at all, so the `DockRegion.destroy()` loop in `Dock.destructor` never runs —
which would have made `UNCLAIMED_DRAG_TEARDOWN_CLASSES`'s justification for
exempting `DockRegion` ("a teardown path the `Dock` row already exercises") an
unbacked claim, against the bar `## Internal Structure` sets for a baseline
entry. Both rows now drive `runSweep()` through a private cast, the idiom
`tests/overlay/Dock.lifecycle.test.ts:149` already uses; with
`DockRegion.destroy()`'s teardown call removed by hand, the drag row fails, so
the claim is now backed.

**The one-toggle control case from the C10 table landed as its own test.**
`## Expected Behaviour`'s table enumerates two cases — one toggle (0 stranded
before and after) and three (2 → 0) — and only the second is a red-to-green
proof, so the first was initially left out as a test that could never fail.
That was the wrong call: the control is what pins `[^treecell-correction]`'s
N−1 argument inside the test file rather than only in a footnote. With
`refreshToggle`'s new `dispose()` reverted, the one-toggle case still passes
while the three-toggle case fails — which is the evidence that the *current*
toggle is already reclaimed by the base recursion, and hence that this
renderer correctly gains no `destructor()`.

**Each drag row also pins the registry's positive direction, which
`## Expected Behaviour` does not ask for.** It specifies only the negative
half ("snapshot the ids, dispose, assert none survive"), which a row that
registers nothing — or an accessor that lost one of its two maps — satisfies
trivially. `tests/unit/core/Event.test.ts:247` guards `Event`'s copy of this
accessor with a `toContain` before the matching `not.toContain`, so each row
now asserts that at least one snapshotted id *is* registered before the
dispose. Verified by hand in both directions: an accessor returning only
`dropTargets` fails the `Window` row (its registration is a drag source),
and one returning only `dragSources` fails `Dock` and `TabBar`.

**The sixth-registrant probe under `## Expected Behaviour` was run and
reverted.** A `DragManager.makeDropTarget(` line added to `Canvas` failed
`every class registering a drag target is claimed by a row or listed as
unclaimed` with `"Canvas"`, as intended.

**No QA panel was run.** `treetable-rows`, `windows` and `table-rows` remain
the manual, real-engine sanity check named in `## Expected Behaviour`; every
run opens a full-screen window and needs the user's explicit go-ahead. The
jsdom assertions above stand as the evidence, as that section already argues.
