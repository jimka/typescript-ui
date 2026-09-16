---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/layout/LayoutManager.ts
  - packages/lib/src/typescript/lib/layout/Grid.ts
  - packages/lib/src/typescript/lib/layout/HBox.ts
  - packages/lib/src/typescript/lib/layout/VBox.ts
  - packages/lib/src/typescript/lib/layout/Fit.ts
  - packages/lib/src/typescript/lib/layout/Card.ts
---

# Degenerate child sets and layout-flush isolation — Implementation Plan

## Overview

Four layout managers produce nonsense — or throw — when they are handed a child
set that has gone empty, or a child that was removed. All four became reachable
when inactive tab pages and collapsed panes started leaving the render tree via
`setDisplayed(false)`, because that is what empties a container's laid-out child
list at runtime: [`Component.getLaidOutComponents`](packages/lib/src/typescript/lib/core/Component.ts#L7049)
filters on `isDisplayed()`, so a container with children can report none.

The four:

- An auto-sized `Grid` with zero laid-out children computes `Math.ceil(0 / 0)`
  rows at [`Grid.ts:316-318`](packages/lib/src/typescript/lib/layout/Grid.ts#L316); the
  `NaN` reaches `new Array(rows)` at [`Grid.ts:880-881`](packages/lib/src/typescript/lib/layout/Grid.ts#L880)
  and throws `RangeError: Invalid array length` from all three size reports and
  from `doLayout`.
- An emptied `HBox`/`VBox` reports a negative or unbounded preferred width,
  because the inter-child spacing term is `spacing * (count - 1)` with a count of
  zero ([`HBox.ts:117`](packages/lib/src/typescript/lib/layout/HBox.ts#L117),
  [`VBox.ts:122`](packages/lib/src/typescript/lib/layout/VBox.ts#L122)) and because
  `VBox`'s cross-axis width is seeded with the unbounded sentinel that no child
  ever reduces ([`VBox.ts:108`](packages/lib/src/typescript/lib/layout/VBox.ts#L108)).
- `Card` keeps a removed child as its current visible one
  ([`Card.ts:29`](packages/lib/src/typescript/lib/layout/Card.ts#L29),
  [`Card.ts:171-177`](packages/lib/src/typescript/lib/layout/Card.ts#L171)), so the
  container goes permanently blank.
- `Fit` and `Card` lay out a 0×0 rectangle and recurse into the whole subtree
  before their container has an element ([`Fit.ts:243-250`](packages/lib/src/typescript/lib/layout/Fit.ts#L243),
  [`Card.ts:318-325`](packages/lib/src/typescript/lib/layout/Card.ts#L318)), where every
  other manager returns.

This plan fixes all four at their source, and adds one protection around them:
the batched layout flush at [`Component.ts:218-247`](packages/lib/src/typescript/lib/core/Component.ts#L218)
currently lets a single throwing component drop every remaining layout in the
frame *and* the frame's queued post-layout callbacks. It will isolate and report
a throwing entry instead.

---

## Architecture Decisions

### An empty child set reports the container perimeter and nothing more

A box or grid manager with zero laid-out children reports its container's
perimeter — its own insets, border and padding — on both axes, and never a
negative extent or the unbounded sentinel.[^empty-rule] The rule is already in
the codebase in two forms, and this plan spreads both to the size reports that
missed them:

- The zero-safe spacing term `this._spacing * Math.max(0, components.length - 1)`,
  used by [`HFlow.getPreferredSize:121`](packages/lib/src/typescript/lib/layout/HFlow.ts#L121),
  [`VFlow.getPreferredSize:111`](packages/lib/src/typescript/lib/layout/VFlow.ts#L111) and
  [`BoxLayout.aggregateMaxSize:393`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L393).
- The `components.length === 0` early return, used by
  [`HBox.computeTotalMinSize:227-229`](packages/lib/src/typescript/lib/layout/HBox.ts#L227),
  [`VBox.computeTotalMinSize:225-227`](packages/lib/src/typescript/lib/layout/VBox.ts#L225) and
  [`Grid.computeTotalMinSize:577-579`](packages/lib/src/typescript/lib/layout/Grid.ts#L577).

`HBox` and `VBox` get the spacing term; `Grid` gets the early return, one level
up in `getColRowCount`.[^why-two-shapes] `VBox` additionally stops seeding its
cross-axis width with the unbounded sentinel and takes a plain maximum over its
children instead.[^vbox-seed]

Worked cases, `HBox` in `"preferred"` mode with `spacing = 5` and a zero
perimeter:

| Children | Child widths | Spacing term now | Reported width now | Spacing term after | Reported width after |
|---|---|---|---|---|---|
| 3 | 30, 30, 30 | `5 * 2` = 10 | 100 | `5 * max(0, 2)` = 10 | 100 (unchanged) |
| 1 | 30 | `5 * 0` = 0 | 30 | `5 * max(0, 0)` = 0 | 30 (unchanged) |
| 0 | — | `5 * -1` = −5 | **−5** | `5 * max(0, -1)` = 0 | **0** |

### `Grid.getColRowCount` returns a zero-by-zero grid when there are no children

The guard lands at the one place the counts are derived, so every caller
(`getPreferredSize`, `getMinSize`, `getMaxSize`, `computeTotalMinSize`,
`doLayout`) inherits it.[^grid-guard] The guard also stops an explicitly-sized
empty grid over-reporting one spacing gap it has no cells to separate.

| `rows` / `columns` set | Laid-out children | Result now | Result after |
|---|---|---|---|
| neither (auto) | 0 | `{width: 0, height: NaN}` → throws downstream | `{width: 0, height: 0}` |
| neither (auto) | 9 | `{width: 3, height: 3}` | `{width: 3, height: 3}` (unchanged) |
| `columns: 2` | 0 | `{width: 2, height: 0}` | `{width: 0, height: 0}` |
| `columns: 2` | 5 | `{width: 2, height: 3}` | `{width: 2, height: 3}` (unchanged) |

### `LayoutManager` is told when a child is removed

`LayoutManager` gains a public `componentRemoved(component)` whose base
implementation does nothing, mirroring
[`LayoutManager.addDeferredComponent:93-95`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L93)
— the existing hook for the other half of the same seam, a child *arriving*.
[`Component.unwireChild`](packages/lib/src/typescript/lib/core/Component.ts#L6745) calls it,
so both `removeComponent` and `removeAllComponents` route through one place.
`Card` is the only manager that implements it in this plan.[^hook-not-poll]

`removeAllComponents` currently unwires each child while `_components` still
holds every one of them, and empties the array afterwards. That order is
reversed so the hook always observes a child list the removed child has already
left.[^remove-all-order]

`Card.componentRemoved` clears its parked state and re-resolves:

| Removed child | `visibleComponentId` | Visible child after |
|---|---|---|
| the visible one, siblings remain | unset | the first remaining child |
| the visible one, siblings remain | the removed child's id | the first remaining child, plus the existing "no matching component" warning |
| the visible one, it was the only child | either | `null`; the card reports no size and lays nothing out |
| a non-visible sibling | either | unchanged; no display writes |

The removed child itself stays undisplayed. Re-displaying it is the caller's
job, exactly as [`packages/lib/docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md)
already documents for a page removed from a `Tab` or `Card`.

### `Fit` and `Card` return when the container has no inner size

Both `doLayout` methods return as soon as `container.getInnerSize()` is `null`,
matching [`HBox.ts:274-277`](packages/lib/src/typescript/lib/layout/HBox.ts#L274),
[`VBox.ts:272-275`](packages/lib/src/typescript/lib/layout/VBox.ts#L272),
[`Grid.ts:679-682`](packages/lib/src/typescript/lib/layout/Grid.ts#L679),
[`HFlow.ts:281-284`](packages/lib/src/typescript/lib/layout/HFlow.ts#L281),
[`VFlow.ts:265-268`](packages/lib/src/typescript/lib/layout/VFlow.ts#L265) and
[`Anchor.ts:147-151`](packages/lib/src/typescript/lib/layout/Anchor.ts#L147). This is
what [`Component.doLayout`'s own remarks](packages/lib/src/typescript/lib/core/Component.ts#L7215)
already claim happens: it names `Card` and `Fit` as managers that "cannot
actually place children on a pass run before this component is rendered", and
leaves the dirty flag set for exactly that reason.

### The batched layout flush isolates a throwing entry and reports it loudly

`flushPendingLayouts` wraps each `c.doLayout()` and each queued post-layout
callback in its own `try`/`catch`. A throw is caught, reported, and the flush
continues with the next entry.[^isolate]

**This is a new pattern for this codebase, adopted deliberately.** All of
`core/` and `layout/` holds four `try`/`catch` blocks — two in
[`Event`](packages/lib/src/typescript/lib/core/Event.ts), one in
[`Focusable`](packages/lib/src/typescript/lib/core/Focusable.ts), one in
[`DOM`](packages/lib/src/typescript/lib/core/DOM.ts) — and none of them isolates
a failing entry in a batched loop. `Component`, `LayoutManager` and `Animation`
hold none at all, so the library's standing behaviour is to let an exception
propagate. The nearest existing shape is warn-and-skip over *known* bad data:
`restoreLayout` skips a node it cannot resolve
([LayoutSerialization.ts:479](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L479),
[:570](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L570)) and
`Card` warns when a named visible component is absent
([Card.ts:224](packages/lib/src/typescript/lib/layout/Card.ts#L224)). This
decision extends that shape from bad data to an unexpected throw, and raises
`warn` to `error` because an exception is not an expected condition. The
alternatives — abort the frame and rethrow, or leave the flush untouched and
ship only the four root fixes — were put to the repository owner with this
decision drafted three ways; isolation was chosen on 2026-09-16.

Reporting is two channels, both mandatory — an isolation that cannot be noticed
is worse than a crash:

1. One `console.error` per failing entry per frame, naming the failing
   component's id and passing the original error through as a second argument so
   the browser console keeps its stack:

   ```
   Layout flush: doLayout for #c17 threw; the rest of the frame continued. <Error object>
   Layout flush: an afterNextLayout callback threw; the rest of the frame continued. <Error object>
   ```

2. A new cumulative `layoutErrors` counter on `Diagnostics`, shown as a **Layout
   errors** row in the shipped diagnostics overlay.

Nothing else changes for the user: the failing component keeps whatever geometry
it already had, and every other component in the frame lays out normally.

The synchronous escape hatch
[`Component.flushLayout`](packages/lib/src/typescript/lib/core/Component.ts#L7445) is
deliberately **not** wrapped. It lays out one named component for one direct
caller, and that caller is entitled to the exception. Isolation is only for the
batched flush, where a throw lands in an animation-frame callback with nobody to
hand it to.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/layout/LayoutManager.ts
abstract class LayoutManager extends BaseObject {
    /** Notifies this manager that a child has left its container. Base: no-op. */
    componentRemoved(_component: Component): void;
}
```

```typescript
// packages/lib/src/typescript/lib/layout/Card.ts
class Card extends LayoutManager {
    componentRemoved(component: Component): void;
}
```

```typescript
// packages/lib/src/typescript/lib/core/Diagnostics.ts
export interface DiagnosticsCounters {
    // …existing fields…
    layoutErrors: number;
}

export namespace Diagnostics {
    /** Increments the count of throws the batched layout flush isolated. */
    export function noteLayoutError(): void;
}
```

```typescript
// packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts
export interface FrameworkCounts {
    // …existing fields…
    layoutErrors: number;
}

export interface DiagnosticsSample {
    // …existing fields…
    /** Cumulative count of throws the batched layout flush isolated. */
    layoutErrors: number;
}
```

Behaviour change on an existing signature: `Grid.getColRowCount()` returns
`{width: 0, height: 0}` for a grid with zero laid-out children, whatever its
`rows`/`columns` setting. The signature is unchanged.

---

## Ordered Implementation Steps

The project works test-first: for each step, write the cases from
`## Expected Behaviour` first, watch them fail, then make the change.

Steps 1–5 are five separate code commits, one functionality each. Step 6 is the
documentation commit.

Line numbers throughout this plan refer to the files as they stand *before* any
step runs. Once an earlier step has edited a file, find the site by the symbol
named beside the line number, not by the number.

### 1. `Grid` — an empty grid has no tracks

1. Create `packages/lib/tests/component/layout/DegenerateChildSets.test.ts`,
   copying the harness preamble (`CONFIG`, `installTestDOM`, the `hostGrid`-style
   helper, `afterEach(() => DOM.reset())`) from
   `packages/lib/tests/component/layout/Grid.test.ts:1-28`. Add cases **G1–G4**.
2. In `packages/lib/src/typescript/lib/layout/Grid.ts`, inside `getColRowCount()`,
   immediately after `let componentCount = components.length;`
   ([`Grid.ts:311`](packages/lib/src/typescript/lib/layout/Grid.ts#L311)), insert an
   early return of `{ width: 0, height: 0 }` when `componentCount === 0`, with a
   comment saying a grid with no children has no tracks on either axis and that
   the auto arm below would otherwise divide by a zero column count.
3. Update the method's JSDoc `@returns` to state the zero-children result.
4. Check: `npx vitest run tests/component/layout/DegenerateChildSets.test.ts`
   — G1–G4 pass.
5. Check: `npx vitest run tests/component/layout/Grid.test.ts` — the existing
   `getColRowCount inference` suite still passes.

### 2. `HBox` / `VBox` — zero-safe size reports

1. Add cases **B1–B9** to `DegenerateChildSets.test.ts`.
2. In `packages/lib/src/typescript/lib/layout/HBox.ts`, replace the main-axis
   spacing arithmetic in the four size-report arms:
   - [`:104`](packages/lib/src/typescript/lib/layout/HBox.ts#L104) and
     [`:166`](packages/lib/src/typescript/lib/layout/HBox.ts#L166) (`"equal"` mode):
     `width += components.length * maxChildWidth + this._spacing * Math.max(0, components.length - 1);`
     (and the `maxChildMinWidth` variant at `:166`). This is algebraically the
     same value as the current `count * (max + spacing) - spacing` for one or
     more children, and `0` for none.
   - [`:117`](packages/lib/src/typescript/lib/layout/HBox.ts#L117) and
     [`:179`](packages/lib/src/typescript/lib/layout/HBox.ts#L179) (`"preferred"`
     mode): `width += this._spacing * Math.max(0, components.length - 1);`
3. In `packages/lib/src/typescript/lib/layout/VBox.ts`, make the mirrored changes
   on the height axis:
   - [`:102-103`](packages/lib/src/typescript/lib/layout/VBox.ts#L102) and
     [`:162-163`](packages/lib/src/typescript/lib/layout/VBox.ts#L162) (`"equal"`
     mode), keeping the existing two-line continuation:
     ```typescript
     const height = components.length * innerHeight + this._spacing * Math.max(0, components.length - 1)
                  + perimeterSize.top + perimeterSize.bottom;
     ```
   - [`:122`](packages/lib/src/typescript/lib/layout/VBox.ts#L122) and
     [`:182`](packages/lib/src/typescript/lib/layout/VBox.ts#L182) (`"preferred"`
     mode): `height += this._spacing * Math.max(0, components.length - 1);`
4. In the same file, replace the sentinel-seeded cross-axis width in
   `getPreferredSize`: `let width = UNBOUNDED;`
   ([`:108`](packages/lib/src/typescript/lib/layout/VBox.ts#L108)) becomes
   `let width = 0;`, and
   `width = isUnbounded(width) ? Math.min(width, size.width) : Math.max(width, size.width);`
   ([`:116`](packages/lib/src/typescript/lib/layout/VBox.ts#L116)) becomes
   `width = Math.max(width, size.width);` — the same widest-child value, without
   the sentinel left behind when there is no first child to pick up.
5. Both `UNBOUNDED` and `isUnbounded` are now unused in `VBox.ts`. Narrow its
   import at [`:4`](packages/lib/src/typescript/lib/layout/VBox.ts#L4) to
   `import { Size } from "~/primitive/Size.js";`.
6. Update the four methods' JSDoc in both files to state the zero-children
   result (perimeter only, both axes).
7. Check: `grep -n "this._spacing \* (components.length - 1)" packages/lib/src/typescript/lib/layout/HBox.ts packages/lib/src/typescript/lib/layout/VBox.ts`
   — expect exactly two hits, one in each file's `computeTotalMinSize`, which
   already guards `components.length === 0` and so needs no change.
8. Check: `grep -n "UNBOUNDED\|isUnbounded" packages/lib/src/typescript/lib/layout/VBox.ts`
   — expect zero matches.
9. Check: `npx vitest run tests/component/layout/HBox.test.ts tests/component/layout/VBox.test.ts tests/component/layout/DegenerateChildSets.test.ts`.

### 3. `Fit` / `Card` — return when the host has no inner size

1. In `packages/lib/tests/component/layout/PrematureLayout.test.ts`, add `Fit`
   and `Card` to the manager list in case `B2-4` ([`:129-137`](packages/lib/tests/component/layout/PrematureLayout.test.ts#L129)),
   then add cases **F1**, **F2** and **F4** as their own `it(...)` blocks. Case
   **F3** is already pinned by `Fit.test.ts` and `Card.test.ts`; do not
   duplicate it.
2. In `packages/lib/src/typescript/lib/layout/Fit.ts`, after
   `let containerSize = container.getInnerSize();`
   ([`:232`](packages/lib/src/typescript/lib/layout/Fit.ts#L232)), return when it is
   `null`. Then collapse the now-dead branches the return creates: the
   `if (containerSize)` wrapper around `inflateForOverflow`
   ([`:239-241`](packages/lib/src/typescript/lib/layout/Fit.ts#L239)) becomes an
   unconditional call, and the two `containerSize ? … : 0` ternaries
   ([`:247-248`](packages/lib/src/typescript/lib/layout/Fit.ts#L247)) become plain
   `containerSize.width` / `containerSize.height` reads. Leave the
   `containerInsets ? … : 0` ternaries alone — they are unrelated to this change.
3. Apply the same three edits in `packages/lib/src/typescript/lib/layout/Card.ts`
   at [`:307`](packages/lib/src/typescript/lib/layout/Card.ts#L307),
   [`:314-316`](packages/lib/src/typescript/lib/layout/Card.ts#L314) and
   [`:322-323`](packages/lib/src/typescript/lib/layout/Card.ts#L322). The guard goes
   where `containerSize` is read — **after** the existing `_currentVisible`
   resolution block at [`:299-305`](packages/lib/src/typescript/lib/layout/Card.ts#L299),
   so the display transition that block performs is unaffected.
4. Check: `npx vitest run tests/component/layout/PrematureLayout.test.ts tests/component/layout/Fit.test.ts tests/component/layout/Card.test.ts`.

### 4. `Card` — recover when the visible child is removed

1. Add cases **C1–C7** to `DegenerateChildSets.test.ts`.
2. In `packages/lib/src/typescript/lib/layout/LayoutManager.ts`, add a public
   `componentRemoved(_component: Component): void {}` next to
   `addDeferredComponent` ([`:93-95`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L93)),
   with a JSDoc saying the container calls it after the child has left the
   container's child list, and that the base does nothing.
3. In `packages/lib/src/typescript/lib/core/Component.ts`, call the hook from
   `unwireChild` ([`:6745-6766`](packages/lib/src/typescript/lib/core/Component.ts#L6745))
   as the last statement before the `return`, so a manager reacting to it never
   observes a half-unwired child:
   `this.getLayoutManager()?.componentRemoved(component);`. Extend the method's
   JSDoc to mention the notification.
4. In the same file, reverse the order inside `removeAllComponents`
   ([`:6985-6993`](packages/lib/src/typescript/lib/core/Component.ts#L6985)): take a
   local reference to `this._components`, assign `this._components = []`, then
   loop the local calling `unwireChild`. Add a comment saying the list is
   emptied first so `componentRemoved` sees a child list the removed child has
   already left.
5. In `packages/lib/src/typescript/lib/layout/Card.ts`, override
   `componentRemoved(component)`: clear `_pendingScrollRestore` when it is the
   removed child; return when `_currentVisible` is not the removed child;
   otherwise set `_currentVisible = null` and call `this.syncVisible()`. Nulling
   first is what makes `syncVisible` take its first-sync branch
   ([`:236-246`](packages/lib/src/typescript/lib/layout/Card.ts#L236)) instead of
   early-returning at [`:232`](packages/lib/src/typescript/lib/layout/Card.ts#L232),
   and it is also what keeps the removed child from being undisplayed a second
   time — it is no longer in `getComponents()`, so the loop cannot reach it.
   Leave `_visibleComponentId` alone, so re-adding a child with that id resolves
   it again. Clearing `_pendingScrollRestore` is about not retaining the removed
   component: `doLayout`'s `restore === this._currentVisible` guard
   ([`:337`](packages/lib/src/typescript/lib/layout/Card.ts#L337)) already prevents a
   wrong restore, so a test cannot distinguish the clear — do it anyway, and say
   so in the code comment.
6. Check: `grep -rn "componentRemoved" packages/lib/src/typescript/lib/` —
   hits only in `LayoutManager.ts` (the base and its doc comment), `Card.ts`
   (the override and its doc comment) and `Component.ts` (the `unwireChild` call
   site and its doc comment). Nothing anywhere else.
7. Check: `npx vitest run tests/component/layout/ tests/core/`.

### 5. The layout flush isolates and reports a throwing entry

1. Create `packages/lib/tests/core/LayoutFlushIsolation.test.ts`, copying the
   animation-frame shim harness from
   `packages/lib/tests/core/DisposedPendingLayout.test.ts:33-54` (the
   `frames` array, the `requestAnimationFrame` spy, `flushFrame`). Add cases
   **X1–X6**. Use a purpose-built throwing `LayoutManager` subclass whose
   `doLayout()` throws — not the `Grid` bug, which steps 1–4 have removed.
2. In `packages/lib/src/typescript/lib/core/Diagnostics.ts`, add a
   `layoutErrors` field to `DiagnosticsCounters`, the module-level counter, an
   exported `noteLayoutError()`, the field in `counters()`, and the zeroing in
   `_reset()`. Do **not** zero it in `setTimingEnabled` — it is a cumulative
   count like `componentsConstructed`, not a timing aggregate.
3. In `packages/lib/src/typescript/lib/core/Component.ts`, add a module-private
   `reportFlushFailure(stage: string, componentId: string | null, error: unknown): void`
   beside `flushPendingLayouts` ([`:192`](packages/lib/src/typescript/lib/core/Component.ts#L192)).
   It calls `Diagnostics.noteLayoutError()` and then one `console.error` whose
   first argument names the stage and the component id and states that the rest
   of the frame continued, and whose second argument is `error` itself.
4. In `flushPendingLayouts`, wrap `c.doLayout()`
   ([`:238`](packages/lib/src/typescript/lib/core/Component.ts#L238)) in
   `try`/`catch`, calling `reportFlushFailure("doLayout", c.getId(), error)`.
5. Wrap `cb()` in the post-layout callback drain
   ([`:245-247`](packages/lib/src/typescript/lib/core/Component.ts#L245)) the same
   way, with a `null` component id.
6. In `packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts`, add
   `layoutErrors` to `FrameworkCounts`, to `readFrameworkCounts()`'s returned
   object, to `DiagnosticsSample`, and to the assembled sample.
7. In `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`, add a
   `_layoutErrors: Text` field, a `layoutErrors` entry in `ROW_DESCRIPTIONS`, a
   `{ title: "Layout errors", … }` row placed directly after the "Layout flush"
   row ([`:112`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts#L112)),
   and the matching `setText` line in `onSample`.
8. Add a `layoutErrors` case to `packages/lib/tests/core/Diagnostics.test.ts`,
   and add `layoutErrors` to the counter list asserted by its existing case `7b`.
9. Check: `npx vitest run tests/core/LayoutFlushIsolation.test.ts tests/core/Diagnostics.test.ts tests/core/AfterNextLayout.test.ts tests/core/DisposedPendingLayout.test.ts`.

### 6. Documentation

1. `packages/lib/docs/concepts/layout-system.md`, the "`LayoutManager` itself
   handles" list: add a bullet for the removal notification, phrased like the
   existing `addDeferredComponent` bullet beside it.
2. Same file, under "Building a custom layout manager": one sentence stating
   that a manager with no laid-out children reports the container's perimeter and
   nothing more — never a negative extent, never the unbounded sentinel.
3. `ARCHITECTURE.md`, *Size constraints: who is responsible for what*: add the
   empty-child-set clause to the aggregation contract sentence at line 97.
4. `packages/lib/docs/layouts/Card.md`: one sentence saying that removing the
   visible child promotes the first remaining child, and that the removed child
   stays undisplayed for the caller to re-display.
5. `packages/lib/docs/components/DiagnosticsOverlay.md`: add the **Layout errors**
   row to the row-by-row table, directly after "Layout flush". The table and
   `ROW_DESCRIPTIONS` are edited together, as the file says.
6. Check: `npm run docs:api` — finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Grid.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VBox.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Fit.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Card.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Diagnostics.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts` |
| Modify | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Create | `packages/lib/tests/component/layout/DegenerateChildSets.test.ts` |
| Create | `packages/lib/tests/core/LayoutFlushIsolation.test.ts` |
| Modify | `packages/lib/tests/component/layout/PrematureLayout.test.ts` |
| Modify | `packages/lib/tests/core/Diagnostics.test.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/layouts/Card.md` |
| Modify | `packages/lib/docs/components/DiagnosticsOverlay.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Every case below is unit-testable against the offline harness
(`installTestDOM`) unless marked **manual-verify**. Hosts are sized and given an
element with `getElement(true)`; "perimeter" is the host's own insets, border
and padding summed on that axis, which is `0` for a host with `clearInsets()`,
no border and no padding.

### `Grid` with no laid-out children

| # | Setup | Expected |
|---|---|---|
| G1 | `new Grid()` in a 300×200 host, no children | `getColRowCount()` is `{width: 0, height: 0}`; `getPreferredSize()`, `getMinSize()` and `getMaxSize()` each return the host perimeter on both axes; none of them throws; `host.doLayout()` does not throw |
| G2 | auto `Grid`, one 40×20 child, then `child.setDisplayed(false)` | identical to G1 — this is the runtime-reachable form of the bug |
| G3 | `new Grid({columns: 2})`, no children | `getColRowCount()` is `{width: 0, height: 0}`; preferred width is the perimeter, with no stray spacing gap |
| G4 | auto `Grid`, 9 children of 10×10 | `getColRowCount()` is `{width: 3, height: 3}` — unchanged |

### `HBox` / `VBox` with no laid-out children

Spacing is the default 5 px; hosts have a zero perimeter unless stated.

| # | Setup | Expected |
|---|---|---|
| B1 | empty `HBox` | `getPreferredSize()` is `{width: 0, height: 0}`; `getMinSize()` is `{width: 0, height: 0}` |
| B2 | empty `VBox` | same as B1 — in particular the width is `0`, not the unbounded sentinel |
| B3 | empty `HBox` and empty `VBox`, both in `"equal"` mode | both report `{width: 0, height: 0}` for preferred and minimum |
| B4 | empty `VBox` in a host with `setInsets` of 4 px on every side, no border, no padding | preferred and minimum are `{width: 8, height: 8}` — perimeter only |
| B5 | `HBox`, 3 children 30 px wide | preferred width is 100 (`30 * 3 + 5 * 2`) — unchanged |
| B6 | `VBox` in `"equal"` mode, children 20 px and 30 px tall | preferred height is 65 (`2 * 30 + 5`) — unchanged |
| B7 | `HBox` host 400 px wide holding `[50 px leaf, Container(VBox, no children), 50 px leaf]`, then `doLayout()` | both leaves are 50 px wide; the empty container is 0 px |
| B8 | as B7 but the middle container starts with one child, which is then removed, then `doLayout()` again | both leaves are still 50 px wide |
| B9 | `VBox`, children 20 px and 40 px wide | preferred width is 40 — the widest child, unchanged by the seed change |

### `Card` when a child is removed

| # | Setup | Expected |
|---|---|---|
| C1 | `Card` host with children `a` (40×20) and `b` (60×30), `a` visible; `host.removeComponent(a)`; `host.doLayout()` | `getVisibleComponent()` is `b`; `b.isDisplayed()` is `true`; `a.doLayout` is not called during the pass; `getPreferredSize()` reports `b`'s size plus the perimeter |
| C2 | as C1 | `a.isDisplayed()` is still `false` — the removed child is the caller's to re-display |
| C3 | `Card` host whose only child `a` is visible; `host.removeComponent(a)` | `getVisibleComponent()` is `null`; `getPreferredSize()` is `null`; `host.doLayout()` does not throw |
| C4 | `Card` with `visibleComponentId` set to `b`'s id, children `a` and `b`; `host.removeComponent(a)` | `getVisibleComponent()` is still `b`; `b.isDisplayed()` stays `true`; no display write reaches `a` |
| C5 | `Card` host with two children; `host.removeAllComponents()` | `getVisibleComponent()` is `null`; `host.doLayout()` does not throw |
| C6 | `HBox` host (a manager that does not override the hook) with two children; `host.removeComponent(child)` | unchanged behaviour: the remaining child lays out as before, and nothing throws |
| C7 | `Card` with children `a` and `b`, switched to `b` so `b` is parked for a scroll restore, then `host.removeComponent(b)`, then `host.doLayout()` | `b.restoreSubtreeScroll` is not called; `a` is displayed and laid out to the host's inner size |

### `Fit` / `Card` before the host has an element

| # | Setup | Expected |
|---|---|---|
| F1 | `Container({layoutManager: new Fit()})` with one child, never rendered; `host.doLayout()` | the child's `doLayout` is not called; the child's committed width is still `NaN` (untouched), matching `HBox`, `Grid` and `Anchor` |
| F2 | the same with `new Card()` | identical to F1 |
| F3 | either host, after `getElement(true)` and a real size, then `doLayout()` | the child fills the host's inner size exactly — unchanged from today |
| F4 | as F1, then `host.getElement(true)`, a size, and `doLayout()` | the child is laid out and sized on this second pass; nothing was lost by the first pass returning |

### The batched layout flush

The harness drives the flush by spying on `DOM.sink.requestAnimationFrame` and
invoking the captured callback, exactly as `DisposedPendingLayout.test.ts` does.
Both components must be rendered (`getElement(true)`) or the flush skips them
for an unrelated reason, and both must be roots, or the flush prunes the one
with a dirty ancestor. The queue is a `Set`, so the throwing component has to be
scheduled first for these cases to mean anything.

| # | Setup | Expected |
|---|---|---|
| X1 | two rendered components queued via `scheduleLayout()`, the first with a manager whose `doLayout()` throws | the second component's `doLayout` still runs |
| X2 | as X1, plus a callback registered with `Component.afterNextLayout` | the callback still runs |
| X3 | two post-layout callbacks queued, the first throws | the second still runs |
| X4 | as X1 | `Diagnostics.counters().layoutErrors` rises by exactly 1 |
| X5 | as X1, with `console.error` spied | called exactly once; the first argument contains the failing component's id; the second argument is the thrown error itself |
| X6 | an ordinary flush with nothing throwing | `layoutErrors` does not move and `console.error` is not called |
| X7 | **manual-verify** — `npm run dev`, Misc panel → "Show diagnostics overlay" | a **Layout errors** row sits directly under "Layout flush", reads `0`, and its hover tooltip matches the row's entry in `docs/components/DiagnosticsOverlay.md` |
| X8 | **manual-verify** — in the running showcase, temporarily make one panel's layout manager throw | the rest of the page still lays out and renders; the console carries one error per frame naming that component; removing the deliberate throw restores a clean console |

---

## Verification

- `npm run typecheck` — clean.
- `npm -w packages/lib run test` — runs `typecheck:test` then the full vitest
  suite. The layout and core suites must be green, in particular
  `tests/component/layout/HBox.test.ts`, `VBox.test.ts`, `Grid.test.ts`,
  `Fit.test.ts`, `Card.test.ts`, `Card.undisplay.test.ts`,
  `Split.collapseUndisplay.test.ts`, `Border.collapseUndisplay.test.ts`,
  `Tab.undisplay.test.ts`, `PrematureLayout.test.ts`, and
  `tests/core/AfterNextLayout.test.ts`, `DisposedPendingLayout.test.ts`,
  `ComponentContentClamp.test.ts`, `Diagnostics.test.ts`.
- `npm run lint` — clean, including the narrowed `VBox.ts` import.
- `npm run docs:api` — zero warnings.
- `grep -n "this._spacing \* (components.length - 1)" packages/lib/src/typescript/lib/layout/HBox.ts packages/lib/src/typescript/lib/layout/VBox.ts`
  — exactly two hits, one in each file's `computeTotalMinSize`.
- `grep -n "UNBOUNDED\|isUnbounded" packages/lib/src/typescript/lib/layout/VBox.ts`
  — zero hits.
- `grep -rn "componentRemoved" packages/lib/src/typescript/lib/` — hits only in
  `LayoutManager.ts`, `Card.ts` and `Component.ts`.
- Manual smoke, `npm run dev` (port 8015): the Grid, HBox, VBox, Fit, Split and
  Tab demo panels render unchanged; case **X7** and case **X8** above.

---

## Documentation Impact

| Doc | Change |
|---|---|
| `packages/lib/docs/concepts/layout-system.md` | One bullet for the removal notification in the "`LayoutManager` itself handles" list; one sentence on the empty-child-set size report under "Building a custom layout manager" |
| `ARCHITECTURE.md` (*Size constraints*) | The aggregation contract gains its empty-child-set clause |
| `packages/lib/docs/layouts/Card.md` | One sentence on removing the visible child |
| `packages/lib/docs/components/DiagnosticsOverlay.md` | A **Layout errors** row in the row-by-row table |

JSDoc: `Grid.getColRowCount`, the four `HBox`/`VBox` size reports,
`LayoutManager.componentRemoved`, `Card.componentRemoved`,
`Component.unwireChild`, `Diagnostics.noteLayoutError`, and the two new
`layoutErrors` interface fields. `componentRemoved` is public and documented, so
its JSDoc renders in TypeDoc — it must not `{@link}` `Component.unwireChild`,
which is private and therefore excluded from the API docs; describe the call
site in prose instead.

No new exported class, so `llms.txt` needs no entry and `npm run docs:llms:check`
is unaffected.

---

## Potential Challenges

- **`removeAllComponents`'s reordering.** Emptying `this._components` before the
  unwire loop is only safe because `unwireChild` never reads the parent's child
  list — it touches the child's constraints, parent pointer, dirty relay and
  element. Confirm that by reading
  [`unwireChild`](packages/lib/src/typescript/lib/core/Component.ts#L6745) before making
  the change; `tests/core/StructureMutationPropagation.test.ts` and
  `ComponentDispose.test.ts` cover the dirty-relay half.
- **`Card.componentRemoved` must null `_currentVisible` before calling
  `syncVisible`.** Calling `syncVisible` with the stale reference still in place
  hits the `resolved === this._currentVisible` early return at
  [`Card.ts:232`](packages/lib/src/typescript/lib/layout/Card.ts#L232) and changes
  nothing, or worse, reaches `undisplayChild` on a component that is no longer a
  child.
- **The `Grid` guard must sit before the rows/columns branch, not inside the
  auto arm.** Only the auto arm crashes, but an explicitly-sized empty grid
  over-reports one spacing gap; one guard ahead of the branch fixes the crash and
  the over-report together, and keeps every empty container on the same
  perimeter-only result.
- **A persistently throwing component logs every frame.** That is intended — the
  isolation buys a rendered frame, not silence. If the noise is unbearable in
  practice, the fix is the underlying throw, not a rate limiter.
- **`Card.getPreferredSize()` returns `null`, not a perimeter, when nothing is
  visible.** That is `computeSize`'s existing documented contract
  ([`Card.ts:108-136`](packages/lib/src/typescript/lib/layout/Card.ts#L108)) and this
  plan does not change it — only the box and grid managers adopt the
  perimeter-only empty report.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/HFlow.ts:121`](packages/lib/src/typescript/lib/layout/HFlow.ts#L121)
  and [`VFlow.ts:111`](packages/lib/src/typescript/lib/layout/VFlow.ts#L111) — the
  zero-safe spacing term this plan copies into `HBox`/`VBox`, in the same methods.
- [`packages/lib/src/typescript/lib/layout/HBox.ts:220-261`](packages/lib/src/typescript/lib/layout/HBox.ts#L220)
  — `computeTotalMinSize`, the empty-child-set early return `Grid` mirrors.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:80-95`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L80)
  — `addDeferredComponent`, the hook `componentRemoved` is modelled on.
- [`packages/lib/src/typescript/lib/layout/Card.ts`](packages/lib/src/typescript/lib/layout/Card.ts)
  — the whole file; `syncVisible`'s two branches decide what `componentRemoved`
  has to do.
- [`packages/lib/src/typescript/lib/core/Component.ts:192-252`](packages/lib/src/typescript/lib/core/Component.ts#L192)
  (the flush), [`:6745-6766`](packages/lib/src/typescript/lib/core/Component.ts#L6745)
  (`unwireChild`), [`:6959-6993`](packages/lib/src/typescript/lib/core/Component.ts#L6959)
  (`removeComponent` / `removeAllComponents`),
  [`:7208-7244`](packages/lib/src/typescript/lib/core/Component.ts#L7208) (`doLayout`
  and its remarks about `Fit`/`Card`).
- [`packages/lib/tests/core/DisposedPendingLayout.test.ts`](packages/lib/tests/core/DisposedPendingLayout.test.ts)
  — the animation-frame shim harness to copy, and a header comment describing
  this exact failure mode.
- [`packages/lib/tests/component/layout/PrematureLayout.test.ts`](packages/lib/tests/component/layout/PrematureLayout.test.ts)
  — case `B2-4` is the existing home for the `Fit`/`Card` guard.
- [`packages/lib/src/typescript/lib/core/Diagnostics.ts`](packages/lib/src/typescript/lib/core/Diagnostics.ts)
  — every counter's shape; the new one copies `noteLayoutPass` exactly.

---

## Non-Goals

- **The slice's performance work.** Lazy size reads in `resolveBounds`, the
  per-pass hint gather in the box managers, caching `getLaidOutComponents()`,
  keying layout constraints on the `Component`, `reserveContentFrame`'s
  pre-check, `Grid.measureContent`'s discarded sweeps, the
  `inflateForOverflow` / `reserveContentFrame` inconsistency, and the
  unchanged-subtree layout skip are all separate later plans over the same
  files. Nothing here may anticipate them.
- **Converting the `for…in` loops in `HBox`/`VBox`'s size reports to `for…of`.**
  Those are the exact lines the per-pass hint-gather plan rewrites, and touching
  them here buys nothing but a merge conflict.
- **Renaming `Grid.getColRowCount`'s `{width, height}` return shape.** It is a
  public API rename with its own test updates, unrelated to the crash.
- **Deleting `Fit.getComponent()`** and the other dead code the review found in
  these files. Separate deletion commit, separate plan.
- **Adopting `componentRemoved` in `Tab`, `Split`, `Border`, `Accordion` or
  `DockRegion`.** They have the same shape of parked per-child state, but no
  reported defect and no reviewer requirement; each is its own slice's call.
- **Isolating `flushPendingVisibility`.** The effective-visibility flush has the
  same loop shape but no reported throw; changing it is speculative.
- **Making `Fit`/`Card` report a perimeter instead of `null` when they have no
  visible child.** A different contract with a wider blast radius, and not one
  of the four defects.

---

## Notes

[^empty-rule]: The rule — perimeter only — falls out of `ARCHITECTURE.md`'s
    aggregation contract: a container's report is derived from its children, and
    zero children contribute zero, leaving only the container's own chrome. The
    probes measured how far the current code is from that: an empty `HBox`
    reports `{-5, 0}` and an empty `VBox` `{9007199254740991, -5}`. A negative
    width is not merely wrong in isolation — `HBox.measureFixedWidths` sums a
    sibling's report into `fixedPreferred`, and a sentinel-sized summand drives
    `BoxLayout.computeShrink` to a shrink ratio of ~1, which starves every other
    child in the row to its minimum. Probe P10 measured the siblings of an
    emptied `VBox` at 2.2e-12 px where they should have been 50 px.

[^why-two-shapes]: `HBox` and `VBox` get the arithmetic fix rather than an early
    return because the only defect there is one term of an otherwise-correct
    formula: with zero children the accumulation loops are already no-ops and
    `computeRowHeight([], [])` already returns `0`, so correcting the spacing term
    makes the existing code produce the right answer with no new branch. An early
    return there was considered and rejected — it
    adds a branch to the hottest size reports in the framework and buys nothing
    the corrected arithmetic does not already give.

[^grid-guard]: `Grid` takes the other shape because its defect is not one term
    but a division by a derived zero, whose `NaN` then flows into five separate
    callers — `getPreferredSize`, `getMinSize`, `getMaxSize`,
    `computeTotalMinSize` and `doLayout` all read `getColRowCount` and hand the
    counts to `measureContent`, where `new Array(NaN)` throws. Guarding the one
    place the counts are derived fixes all five at once. It also removes the need
    for a second defence around the division itself: past the guard
    `componentCount >= 1`, so `Math.floor(Math.sqrt(componentCount))` is at least
    `1` and `Math.ceil(componentCount / columns)` can no longer produce `NaN`.
    The guard sits before the rows/columns branch rather than inside the auto arm
    so that an explicitly-sized empty grid — which does not crash today, but does
    report one spacing gap for cells it does not have — lands on the same
    perimeter-only result as every other empty container.

[^vbox-seed]: Replacing `VBox`'s `isUnbounded(width) ? Math.min : Math.max`
    trick with a plain `Math.max` over a `0` seed is equivalent for every
    non-negative child width, which is every real one — the trick exists only to
    pick up the first child's width, and the sentinel it seeds is what survives
    when there is no first child. The single case where the two differ is a child
    that itself reports an unbounded *preferred* width: the current trick lets a
    later, smaller sibling pull the result back down, while `Math.max` keeps it
    unbounded. `Math.max` is the correct aggregation — `ARCHITECTURE.md` says a
    container takes the max along its cross axis — and after this plan no manager
    reports an unbounded preferred size anyway, since `VBox`'s own empty case was
    the only source of one.

[^hook-not-poll]: The alternative was to keep the fix inside `Card`: treat a
    `_currentVisible` whose `getParentComponent()` is no longer this container as
    stale, and re-resolve on read. It works, costs one pointer comparison, and
    adds no API. It was rejected for two reasons. It recovers only when somebody
    asks — so a `Card` that nothing queries keeps the removed component alive in
    a field indefinitely — and it leaves the next manager with parked per-child
    state (`Tab`'s pages, `Split`'s and `Border`'s collapsed-child ownership) to
    invent its own detection. A hook fires once, immediately, and mirrors
    `addDeferredComponent`, which the base class already publishes for a child
    arriving. Slices 06, 07
    and 08 of the review — the ones the reviewer asked to coordinate with —
    raised no competing requirement for this seam, so it is defined at its
    minimum: one method, a base no-op, one implementor.

[^remove-all-order]: `removeComponent` splices the child out of `_components`
    *before* calling `unwireChild`, so a hook fired from `unwireChild` already
    sees the correct list on that path. `removeAllComponents` does the opposite —
    it unwires every child while the array is still full, then empties it — so
    without the reorder a `Card` re-syncing from the hook would resolve the child
    that is in the middle of being removed. Reversing the two statements is safe
    because `unwireChild` reads only the child: its constraints, its parent
    pointer, its dirty relay, and its element.

[^isolate]: Both sides of this are real, so the decision turns on what each
    failure actually costs. Not isolating costs more than the bug that triggers
    it: the snapshot loop has already dequeued both `pendingLayouts` and
    `afterLayoutCallbacks` before it starts, so a throw takes down every
    *later* component's layout in that frame and destroys the frame's entire
    post-layout callback queue. Those callbacks are one-shot consumer code —
    "focus the editor once it is laid out", "measure the revealed panel" — and
    nothing retries them or reports that they were dropped, which is how the
    `Grid` crash above turned one manager's `RangeError` into a half-updated
    application. Isolating
    costs the risk that a bug is lived with instead of fixed, and that cost is
    paid only if the report is easy to miss; pairing the catch with a
    `console.error` that carries the original error object and a counter the
    shipped diagnostics overlay displays removes it. Two alternatives were
    rejected. A bare `try { … } catch { }` is the silent swallow the brief rules
    out. Storing the first error and re-throwing after the loop keeps the frame
    alive and still surfaces the error, but the re-throw lands inside an
    animation-frame callback where nothing can handle it — it reaches
    `window.onerror` exactly as the `console.error` does, with a stack that now
    points at the flush instead of the component, so it is strictly less
    informative. Note what isolation does *not* replace: the framework's existing
    answer to this hazard is prevention, and
    `tests/core/DisposedPendingLayout.test.ts`'s header describes this exact
    failure mode as the reason the flush skips a disposed component. The four
    root-cause fixes in this plan are that prevention; the isolation is the floor
    under the next one.
