---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/layout/LayoutManager.ts
  - packages/lib/src/typescript/lib/layout/Table.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/component/table/Header.ts
---

# Layout calculate / commit split — first step — Implementation Plan

## Overview

A layout pass in this framework does three things in one fused step: it works out where a child goes, it writes that rectangle to the child, and it recurses into the child's own `doLayout()`. [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L484) is where all three meet, and the recursion at the end is unconditional — a child is re-laid-out even when the rectangle it was just handed is byte-for-byte the one it already had.

This plan takes the first step toward separating the two halves. It gives `Component` two new geometry primitives — one that writes a rectangle, one that writes it and then recurses only when something actually changed — routes `LayoutManager.commitBounds` through the second, and converts the Table's layout pipeline to use them. The Table already carries a private, hand-rolled version of the same idea in [`CellGeometryCache`](packages/lib/src/typescript/lib/component/table/CellGeometry.ts#L60); this plan deletes it and re-expresses its behaviour through the framework primitive, so there is one mechanism rather than two.

The motivating pain is the window-maximize tween: [`AbstractWindow.animateRect`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2225) calls a full synchronous `doLayout()` on every animation frame, and for a 25-column table that pass costs hundreds of milliseconds. This step does **not** make that tween cheap — a growing window genuinely changes almost every rectangle inside it, so there is little for a geometry diff to skip. What it does is put the seam in place, remove the Table's duplicate mechanism, and make repeat passes at unchanged geometry stop at the first unchanged child. `## Non-Goals` states the boundary precisely.[^why-not-the-tween]

---

## Architecture Decisions

### The diff goes into the existing commit seam, not a new cache

`LayoutManager` already names both phases: [`resolveBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L345) is documented as pure resolution that "does NOT mutate the `Component`", [`commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L484) does the writing, and [`ResolvedPlacement`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L28) is the hand-off between them. The missing piece is the comparison. This plan adds it inside the commit seam rather than beside it.[^seam-not-cache]

### The last-committed rectangle is the component's own state — no `WeakMap`

`Component` already stores its committed rectangle in `_left` / `_top` / `_width` / `_height`, and [`setX`](packages/lib/src/typescript/lib/core/Component.ts#L3528) / [`setY`](packages/lib/src/typescript/lib/core/Component.ts#L3561) / [`setWidth`](packages/lib/src/typescript/lib/core/Component.ts#L3369) / [`setHeight`](packages/lib/src/typescript/lib/core/Component.ts#L3470) each return early when handed the value they already hold. So the comparison is: snapshot those four fields, run the four setters, compare again. Because the record lives on the component object, it is keyed on component identity by construction — the rule `CellGeometryCache` had to state and defend ("records are keyed on the cell, not on its position").[^identity-keyed]

### The skip is opt-in per component, default off

`Component` gains a protected `canSkipUnchangedLayout()` returning `false`. A component's `doLayout()` is withheld only when it overrides that to `true`. `Cell` is the only override this plan adds, so nothing outside the Table pipeline changes behaviour on the day this lands.

The reason for staging it that way: an earlier attempt at this skip, on the table header alone, needed five rounds of review to find four ways stale layout leaked through it. Each one existed because the unconditional `doLayout()` had been quietly covering some other writer of a layout input. One component at a time is how that risk stays reviewable.[^opt-in]

This mirrors [`Component.canRelease`](packages/lib/src/typescript/lib/core/Component.ts#L3419), the protected gate that [`release()`](packages/lib/src/typescript/lib/core/Component.ts#L1080) consults before doing anything — a seam that shipped default-off with no component opting in, and had components opted in afterwards.

### A component that dirties its own layout inputs says so

`Component` gains a `_layoutDirty` flag, set by a new `invalidateLayout()` and by the existing [`scheduleLayout()`](packages/lib/src/typescript/lib/core/Component.ts#L5518), and cleared by `doLayout()` just before it delegates to the layout manager. A dirty component is never skipped even when its rectangle is unchanged. This is the structural half: the setter that changes a layout input marks its own component, rather than some outside reconciler being expected to notice.[^dirty-flag]

### The skip rule, worked

Four conditions decide whether `applyBounds` recurses. The rectangle comparison is the fast path; the other three are the conservative half.

| Situation | Rect changed | Opted in | Dirty | Has element | `doLayout()` runs |
|---|---|---|---|---|---|
| A `Panel` placed at a new width | yes | no | – | yes | yes |
| A `Panel` re-placed at the same rect | no | no | – | yes | yes — not opted in |
| A table `Cell` whose column narrowed | yes | yes | no | yes | yes |
| A table `Cell` re-placed at the same rect | no | yes | no | yes | **no** |
| A table `Cell` after `setActiveRenderer` | no | yes | yes | yes | yes — dirty |
| A header `Cell` positioned before first render | no | yes | no | no | yes — no element |

The last row is load-bearing: a cell with no element cannot lay out (its layout manager fits the child against `getInnerSize()`, which returns `null` without one), so recording that pass as "done" would make every later pass at the same rectangle skip it forever.[^element-gate]

### `layout/Table.doLayout` splits into `calculate` + `commit`

[`Table.doLayout`](packages/lib/src/typescript/lib/layout/Table.ts#L101) becomes two private methods: `calculate()` returns a `TableGeometry` value object computed without touching any component, and `commit(geometry)` performs every write. Two values stay in the commit phase because they are read back from committed state — see `## Internal Structure`.

### Nothing outside the Table converts

Every other layout manager keeps calling `commitBounds` and gets the new behaviour for free (which, with no component opting in, is exactly today's behaviour). No other component's `doLayout` override is touched.

---

## Public API

New on `Component` ([packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts)):

```typescript
/**
 * Writes x / y / width / height as one batched DOM update.
 * Returns whether the committed rectangle changed.
 */
setBounds(x: number, y: number, width: number, height: number): boolean;

/**
 * Writes the rectangle, then lays this component out unless the rectangle
 * was unchanged and this component allows the pass to be skipped.
 */
applyBounds(x: number, y: number, width: number, height: number): this;

/** Marks this component's layout as stale, so the next applyBounds cannot skip it. */
invalidateLayout(): this;

/** Whether a layout pass is owed. True until the first doLayout completes. */
isLayoutDirty(): boolean;

/** Opt-in gate for the unchanged-geometry skip. Default false. */
protected canSkipUnchangedLayout(): boolean;

/**
 * Backing field. Declared bare — see the `declare` rule in CODE_CONVENTIONS.md.
 * Framework-managed bookkeeping, so it gets no `ComponentOptions` field, per
 * ARCHITECTURE.md's third DOM-write rule.
 */
declare private _layoutDirty: boolean;

/** Shared body of setBounds / applyBounds; assumes the batching window is open. */
private writeBounds(x: number, y: number, width: number, height: number): boolean;
```

Overridden on `Cell` ([packages/lib/src/typescript/lib/component/table/cell/Cell.ts](packages/lib/src/typescript/lib/component/table/cell/Cell.ts)):

```typescript
protected canSkipUnchangedLayout(): boolean;   // returns true
```

Changed on `LayoutManager` — body only, signature unchanged:

```typescript
protected commitBounds(component: Component, x: number, y: number, width: number, height: number): void;
```

Deleted: `CellGeometryCache` and the whole of `packages/lib/src/typescript/lib/component/table/CellGeometry.ts`.

---

## Internal Structure

### `Component.applyBounds` and friends

```typescript
setBounds(x: number, y: number, width: number, height: number): boolean {
    this.setAutoCommitStyle(false);
    const changed = this.writeBounds(x, y, width, height);
    this.setAutoCommitStyle(true);

    return changed;
}

applyBounds(x: number, y: number, width: number, height: number): this {
    this.setAutoCommitStyle(false);

    const changed = this.writeBounds(x, y, width, height);

    if (changed || !this.canSkipUnchangedLayout() || this.isLayoutDirty() || !this.getElement()) {
        this.doLayout();
    }

    this.setAutoCommitStyle(true);

    return this;
}

private writeBounds(x: number, y: number, width: number, height: number): boolean {
    const px = this._left, py = this._top, pw = this._width, ph = this._height;

    this.setX(x);
    this.setY(y);
    this.setWidth(width);
    this.setHeight(height);

    return this._left !== px || this._top !== py || this._width !== pw || this._height !== ph;
}
```

`applyBounds` keeps the batching window open across `doLayout()`, matching today's `commitBounds` exactly.[^batching-window] The comparison reads the fields *after* the setters ran, so a `setWidth` that clamped to the component's min or max still reports honestly.

`doLayout()` clears the flag **before** delegating to the layout manager, so anything the pass itself dirties survives:

```typescript
doLayout(): this {
    if (this.isLayoutPaused()) {
        return this;
    }

    const lm = this.getLayoutManager();
    if (!lm) {
        throw new Error("Unable to do layout, no layout manager specified.");
    }

    this._layoutDirty = false;
    lm.doLayout();
    this.runFirstLayoutCallbacks();

    return this;
}
```

`isLayoutDirty()` returns `this._layoutDirty ?? true`, so a component that has never laid out reads dirty. `scheduleLayout()` sets the flag before its `isLayoutPaused()` early return, so a paused component still owes a pass when it resumes.

### `TableGeometry` in `layout/Table.ts`

A private interface, not exported:

```typescript
interface Rect { x: number; y: number; width: number; height: number; }

interface TableGeometry {
    columnWidths   : number[];
    availableWidth : number;
    header         : { band: Rect; columnHeight: number; parentRowHeight: number; filterRowHeight: number } | null;
    footer         : { band: Rect; columnHeight: number } | null;
    bodyVisible    : boolean;
    containerInsets: Insets;
    containerSize  : Size;
}
```

`calculate()` produces it and touches no component setter. `commit(geometry)` performs every write, in today's order.

**Two values stay in `commit`, deliberately.** The header's inner content box comes from `header.getContentBounds()` and the body band's height comes from `header.getHeight()` / `footer.getHeight()` — both read *committed* state, and a committed height can differ from the requested one because `setHeight` clamps. Computing them in `calculate()` would change behaviour wherever a clamp bites. They stay where they are, and the remaining coupling is named here so a later step can address it.[^committed-readback]

---

## Ordered Implementation Steps

1. **`core/Component.ts` — add the dirty flag.** Add `declare private _layoutDirty: boolean;` beside the other geometry fields. Add `invalidateLayout(): this` (sets the flag, returns `this`) and `isLayoutDirty(): boolean` (returns `this._layoutDirty ?? true`). In `scheduleLayout()` (line 5518), set `this._layoutDirty = true` as the **first** statement, before the `isLayoutPaused()` check.
   *Check:* `npm run typecheck` passes.

2. **`core/Component.ts` — clear the flag in `doLayout`.** In `doLayout()` (line 5425), insert `this._layoutDirty = false;` immediately before `lm.doLayout();`.

3. **`core/Component.ts` — add the geometry primitives.** Add `private writeBounds`, `setBounds`, `applyBounds`, and `protected canSkipUnchangedLayout(): boolean { return false; }` exactly as in `## Internal Structure`. Place them next to `setSize` (line 3326) so the geometry group stays together.
   *Check:* `npm run typecheck` passes; `npm test` is green (nothing calls them yet).

4. **`layout/LayoutManager.ts` — route `commitBounds` through the primitive.** Replace the body of `commitBounds` (line 484) with `component.applyBounds(x, y, width, height);`. Keep the signature, the `protected` modifier, and the doc comment's first paragraph; extend the comment to say the recursion is now conditional, naming `Component.canSkipUnchangedLayout` in prose rather than with `{@link}`.
   *Check:* `npm test` green — no component opts in yet, so every call still recurses.

5. **`component/table/cell/Cell.ts` — opt in.** Add `protected canSkipUnchangedLayout(): boolean { return true; }`. Its JSDoc carries the enumeration currently in the `CellGeometryCache` class comment: the writers that move a cell's layout without moving its rectangle (`setActiveRenderer`, `startEdit` / `detachEditor`, `TreeCellRenderer.setTreeState`, `HeaderCell.setHeaderGlyph`, `FilterCell.selectOperator` / `setFilterState`, `GlyphRenderer.setValue`, and a theme change), and the note that each of those already lays the cell out itself, except the theme change, which steps 6 and 8 handle by marking the cells dirty.
   *Check:* `grep -rn "canSkipUnchangedLayout(): boolean {" packages/lib/src/typescript/lib/` — exactly two declarations, `Component` returning `false` and `Cell` returning `true`.

6. **`component/table/Header.ts` — drop the cache.** Delete the `_cellGeom` field (line 137), its preceding comment (line 136), and the `CellGeometryCache` import (line 15). In `positionFilterCells`, `positionColumnCells`, and `positionParentCells` (lines 1368, 1386, 1405) replace `this._cellGeom.apply(cell, x, w, h)` with `cell.applyBounds(x, 0, w, h)`. Add a private `invalidateCellLayouts(): void` that calls `invalidateLayout()` on every component of `this.getParentRow()`, `this.getComponents()[1]` (the column row), and `this.getFilterRow()`, and replace the theme subscription at line 271 with `this.subscribeTheme(() => this.invalidateCellLayouts());`. Rewrite that subscription's comment (lines 261-270): keep the paragraph explaining why it does not re-render inline, and re-point the first sentence at `Cell.canSkipUnchangedLayout` instead of `CellGeometryCache`.

7. **`component/table/Body.ts` — drop the cache.** Delete the `_cellGeom` field (line 292), the `CellGeometryCache` import (line 10), and the whole `invalidateGeom` override (line 604) — with `_cellGeom` gone the override adds nothing over the base. In `bindAndPositionRows` replace `this._cellGeom.apply(row.getComponents()[0], 0, rowWidth, rowHeight)` (line 1210) with `row.getComponents()[0].applyBounds(0, 0, rowWidth, rowHeight)`, and `this._cellGeom.apply(cells[slot], x, colW, rowHeight)` (line 1254) with `cells[slot].applyBounds(x, 0, colW, rowHeight)`.
   *Note:* this is the one intentional behaviour change in the Table pipeline. `updateColumnWidthCache` (line 1120) still calls `invalidateGeom()` on a width change, but that now only clears the row-translate cache, not the cells. A cell whose x and width are unchanged by a body-width change is no longer re-laid-out.[^drop-invalidate]

8. **`component/table/Body.ts` — keep the theme path.** Add an `onThemeReflow()` override that marks every pooled row's cells dirty *before* chaining up:
   ```typescript
   protected onThemeReflow(): void {
       for (const row of this._rowPool) {
           for (const cell of row.getComponents()) {
               cell.invalidateLayout();
           }
       }

       super.onThemeReflow();
   }
   ```
   Order matters: [`VirtualRowView.onThemeReflow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L571) ends by calling `renderWindow()`, so the cells must already be dirty when it does.

9. **Delete `component/table/CellGeometry.ts`,** then repoint the three comments that name it: `component/table/cell/Filter.ts:345`, `tests/component/table/ColumnFilterRow.test.ts:334` and `:340`, and `tests/component/table/HeaderThemeReflow.test.ts:4` and `:139` (the latter two also use the older name `applyCellGeometry`). Each should refer to `Cell.canSkipUnchangedLayout` and its writer list instead.
   *Check:* `grep -rn "CellGeometry" packages/lib/src/` — zero matches, and no test file imports the deleted module. `npm run typecheck` passes.

10. **`layout/Table.ts` — extract `calculate`.** Add the private `Rect` / `TableGeometry` interfaces from `## Internal Structure`, plus a `Size` type import from `~/primitive/Size.js` (the file currently imports only `UNBOUNDED` from it). Add `private calculate(): TableGeometry | null` holding everything from the top of today's `doLayout` down to and including the width initialise/rescale branch, the header band's `columnHeight` / `parentRowHeight` / `filterRowHeight` / `headerBandHeight` arithmetic, and the footer band's `columnHeight` / `footerBandHeight` arithmetic. It returns `null` for the two existing early returns (no container; non-finite container size). It must call no setter and no `renderWindow` / `renderColumnWindow`. `header` is `null` when the header is not both visible and displayed; `footer` likewise.

11. **`layout/Table.ts` — extract `commit`.** Add `private commit(geometry: TableGeometry): void` holding every write from today's `doLayout`, in the same order: `container.setColumnWidths`, the header band, `header.getContentBounds()` and the three inner rows, `header.renderColumnWindow`, the menu button, the footer band and its column loop, then the body band and `body.renderWindow`. `doLayout()` becomes:
    ```typescript
    doLayout() {
        const geometry = this.calculate();

        if (geometry) {
            this.commit(geometry);
        }
    }
    ```

12. **`layout/Table.ts` — route the writes through the primitives.** Inside `commit`, replace each six-line `setAutoCommitStyle(false)` / four setters / `setAutoCommitStyle(true)` block with a single call:
    - `header`, `parentRow`, `columnRow`, `filterRow`, `footer`, `body` → `setBounds(...)` (these never cascaded and must not start to).
    - each footer column and the menu button → `applyBounds(...)`, replacing the block plus its explicit `doLayout()` call. Keep the menu button's `setPreferredSize` call ahead of it and its comment explaining why the cascade is needed.
    *Check:* `grep -n "setAutoCommitStyle" packages/lib/src/typescript/lib/layout/Table.ts` — zero matches.

13. **Write the two new test files** — `packages/lib/tests/core/ComponentBounds.test.ts` and `packages/lib/tests/component/table/CellLayoutSkip.test.ts` — covering behaviours 1-15 of `## Expected Behaviour`.

14. **Docs.** Update `packages/lib/docs/concepts/layout-system.md` and `packages/lib/docs/reference/changelog/next.md` per `## Documentation Impact`.
    *Check:* `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Delete | `packages/lib/src/typescript/lib/component/table/CellGeometry.ts` |
| Create | `packages/lib/tests/core/ComponentBounds.test.ts` |
| Create | `packages/lib/tests/component/table/CellLayoutSkip.test.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable, offline (`tests/core/ComponentBounds.test.ts`):

1. `setBounds(10, 20, 30, 40)` on a fresh component sets `getX()` to 10, `getY()` to 20, `getWidth()` to 30, `getHeight()` to 40, and returns `true`.
2. Calling `setBounds` twice with the same four numbers returns `true` then `false`.
3. `setBounds` on a component with `setMaxSize({ width: 25, height: 40 })` returns `true` and leaves `getWidth()` at 25; calling it again with the same request returns `false`.
4. `setBounds` leaves `getAutoCommitStyle()` `true` afterwards, and the four properties reach the recording sink as one batched style write rather than four separate ones — the same shape `LayoutManager.commitBounds` produces today.
5. `applyBounds` on a component that does not opt in calls `doLayout()` both times when called twice with the same rectangle.
6. `applyBounds` on a component that overrides `canSkipUnchangedLayout()` to `true` calls `doLayout()` on the first call and not on the second.
7. Same as (6), but with `invalidateLayout()` between the two calls: `doLayout()` runs both times.
8. Same as (6), but on a component with no element: `doLayout()` runs both times.
9. `isLayoutDirty()` is `true` on a fresh component, `false` after a `doLayout()`, and `true` again after `scheduleLayout()`.
10. `scheduleLayout()` on a paused component still leaves `isLayoutDirty()` `true`.

Unit-testable, offline (`tests/component/table/CellLayoutSkip.test.ts`):

11. Two consecutive `table.doLayout()` calls at an unchanged container size, with `doLayout` spy-counted on every rendered header cell and pooled body cell: the second pass records zero calls. This is the parity check for the deleted `CellGeometryCache`, which guaranteed the same thing.
12. A body-width change that leaves the first column's x and width untouched does not re-lay-out that column's cells, while the columns whose width changed are re-laid-out. This pins step 7's behaviour change.
13. **Negative half — this is the test the earlier attempt at this skip was missing.** Take a rendered table, run a pass, snapshot every cell's `getX` / `getY` / `getWidth` / `getHeight` and its renderer's, then force a `doLayout()` on every cell and re-snapshot: nothing moved. Repeat after a theme reflow and after `setActiveRenderer` on a `DynamicCell`.[^negative-half]
14. A theme reflow re-lays-out every rendered header cell and every pooled body cell even though no rectangle changed.
15. A `DynamicCell` that swaps its active renderer between two passes at identical geometry is re-laid-out on the second pass.

Manual verification (the offline harness cannot exercise pointer gestures or real geometry):

16. On `#/misc` in the dev app (`npm run dev`, localhost:8015), open the wide table demo and drag a column's resize handle: columns keep their widths, the header and body stay aligned, and no cell blanks or mis-sizes.
17. Maximize and restore the window holding the wide table: the header, body, and footer stay aligned at every intermediate size and at rest.
18. Scroll the wide table horizontally to the far right and back: cells entering the column window render at the right size and position on their first frame.
19. Switch theme with the wide table open: cell padding and text re-fit; no cell keeps the outgoing theme's box.
20. Open a table before its first render (a store load that fires a layout before the table is sized) and confirm the cells render sized rather than collapsed — the no-element gate.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean; in particular the `local/require-content-bounds` rule must not gain a new report from `layout/Table.ts`'s `commit`.
- `npm test` — the whole suite, plus the two new files. The existing table suites are the regression net: `tests/component/table/Header*.test.ts`, `Body.test.ts`, `ColumnResize.test.ts`, `ColumnWidths.test.ts`, `ColumnWindow.test.ts`, `HeaderColumnWindow.test.ts`, `HeaderThemeReflow.test.ts`, `TreeBody.test.ts`.
- `grep -rn "CellGeometry" packages/lib/src/` — zero matches.
- `grep -n "setAutoCommitStyle" packages/lib/src/typescript/lib/layout/Table.ts` — zero matches.
- `grep -rn "canSkipUnchangedLayout(): boolean {" packages/lib/src/typescript/lib/` — exactly two declarations, `Component` and `Cell`.
- `npm run docs:api` — zero warnings.
- Manual smoke tests 16-20 above, in the dev app at localhost:8015, screen `#/misc`.

---

## Documentation Impact

- **Export surface.** `setBounds`, `applyBounds`, `invalidateLayout`, and `isLayoutDirty` are public members of `Component`, which is already exported from the core entry point, so no barrel change is needed. `canSkipUnchangedLayout` is `protected` and will not appear in the generated API docs — per CODE_CONVENTIONS.md, no public JSDoc may `{@link}` it; describe it in prose instead ("the protected opt-in gate").
- **`packages/lib/docs/concepts/layout-system.md`.** The page states that a layout manager "writes pixel-level position and size values to the children" on every `doLayout()`. Add a short subsection under the existing layout-pass walkthrough saying the write is diffed: a child handed the rectangle it already has is not re-laid-out, provided it opts in. Name `Component.setBounds` / `Component.applyBounds` as the primitives.
- **`packages/lib/docs/reference/changelog/next.md`.** Add entries for the four new public `Component` methods and for the removal of the internal `CellGeometryCache`. `CellGeometryCache` is marked `@internal`, so its removal is not a consumer-facing break — say so rather than listing it as one.
- **No new doc page**, and `packages/lib/llms.txt` needs no change: no new component or layout manager is introduced.

---

## Potential Challenges

- **The unconditional recursion is currently covering for missing invalidations.** That is the documented failure mode of the earlier attempt at this skip. Mitigation: exactly one component opts in, its writers are enumerated in its JSDoc, and behaviour 13 pins the negative half by forcing the withheld pass and asserting nothing moves.
- **`_layoutDirty` is written during the `super()` cascade** — `applyOptions` can dispatch `setSize`, which calls `scheduleLayout`. Mitigation: declare it bare with `declare` (no initializer, no `!`) per CODE_CONVENTIONS.md, and read it through `isLayoutDirty()`'s `?? true`.
- **A `doLayout` override that does not call `super.doLayout()` never clears the flag** — `Row.doLayout` is one. Mitigation: none needed; the component then reads permanently dirty, which fails safe (it is never skipped). `Row` does not opt in.
- **Dropping the cell half of `invalidateGeom` widens what the per-cell diff must catch alone.** Mitigation: behaviour 12 pins the new skip, and behaviour 13 pins that nothing else moved. The related trap recorded in this project — a width producer that mutates the width array in place, making `columnWidthsEqual` compare a value with itself — stays latent either way, because the diff is now per-cell and per-value rather than depending on that comparison.
- **`applyBounds` closes the batching window after the cascade, `setBounds` before it.** Getting these the wrong way round changes when a child's own inline styles flush. Mitigation: the two bodies are given in full in `## Internal Structure`; do not merge them into one method with a flag.
- **The menu button's `setPreferredSize` must stay ahead of `applyBounds`.** It is what keeps `Absolute` from re-committing the button at its own glyph-derived size. Mitigation: step 12 says so explicitly.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/CellGeometry.ts`](packages/lib/src/typescript/lib/component/table/CellGeometry.ts) — the precedent this plan generalises and then deletes. Read the whole class comment: it is the enumeration of every writer that moves a cell's layout without moving its rectangle, and that enumeration moves to `Cell.canSkipUnchangedLayout`'s JSDoc.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `resolveBounds` (345), `commitBounds` (484), `commitPlacements` (503), `ResolvedPlacement` (28). The calc/commit vocabulary already lives here.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setX` (3528), `setY` (3561), `setWidth` (3369), `setHeight` (3470), `setAutoCommitStyle` (1539), `doLayout` (5425), `scheduleLayout` (5518), `canRelease` (3419), `release` (1080).
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — the whole of `doLayout` (101-358), which steps 10-12 restructure.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `positionRow` (406), `invalidateGeom` (452), `onThemeReflow` (571), `alignPoolWindow` (377). The row-pool rotation is the in-repo precedent for identity-keyed bookkeeping over a pooled set; `positionRow` is the row-level diff this plan leaves alone.
- `ARCHITECTURE.md` — "All attributes and styles go through typed setters", "Three non-negotiable rules for every DOM write", "Positioning is always absolute".
- `CODE_CONVENTIONS.md` — the `declare` rule for fields written during the `super()` cascade, and the `{@link}` restriction on public JSDoc.

---

## Non-Goals

- **Making the window-maximize tween cheap.** A growing window changes almost every rectangle inside it, so there is very little for a geometry diff to skip during the tween. The measured cost is one full pass of the table subtree, repeated per animation frame; this step reduces neither the cost of that pass nor the number of passes. The fix for that is to stop running deep interior passes on every animation frame, which needs this split as a prerequisite and is separate work.
- **Opting any component in beyond `Cell`.** `CellRenderer`, `Text`, `Panel`, and the rest keep `canSkipUnchangedLayout()` at `false`. Each opt-in needs its own enumeration of layout-input writers and its own negative-half test; batching them would repeat the failure this plan is built to avoid.
- **Converting other layout managers' `doLayout` into calculate + commit.** `HBox`, `VBox`, `Grid`, `HFlow`, `VFlow`, `Absolute`, `Anchor`, and `Split` already push `ResolvedPlacement[]` through `commitPlacements`; they pick up the diff through `commitBounds` without being restructured. `Border` and `Split` call `commitBounds` directly and likewise need no change.
- **Changing `VirtualRowView.positionRow` or its `_rowGeom` cache.** Row placement writes a CSS translate rather than `top`, which `setBounds` does not cover, and `Row.doLayout` is a no-op so there is no cascade to skip. It stays as it is.
- **Changing when layout is scheduled.** `Table.onColumnResize`'s synchronous `doLayout()` per mousemove, and `AbstractWindow.animateRect`'s synchronous `doLayout()` per frame, both stay as they are.
- **Adding a `Bounds` / `Rect` type to the public API.** The new methods take four numbers, matching `commitBounds`. The `Rect` in `TableGeometry` is private to `layout/Table.ts`.

---

## Notes

[^why-not-the-tween]: The investigation that prompted this plan measured a single maximize of the 25-column MiscPanel demo table at two long tasks totalling 522 ms, against zero long tasks for the same gesture on a plain window. `Animation.tween` steps on `requestAnimationFrame`, so those two tasks are two frames — meaning one full layout pass of that table subtree costs on the order of 250 ms, and the tween is slow because each pass is slow, not because there are many. During the tween the container's width changes every frame, so `rescaleWidths` produces different column widths every frame, so nearly every cell's x and width genuinely differ from the previous frame. A diff that skips unchanged rectangles has almost nothing to skip there. Saying otherwise in the body would set up a benchmark this step cannot meet.

[^seam-not-cache]: The alternative was to keep `CellGeometryCache` and add a second, parallel cache for the levels that have none (the header band, the three header rows, the footer columns, the menu button). Rejected: it would leave two mechanisms with two invalidation stories, and the second would need its own `WeakMap` keyed on components whose committed rectangles the framework is already storing. Building the comparison into `commitBounds` instead means every layout manager in the framework — `HBox`, `VBox`, `Grid`, `Border`, `Split`, `Absolute`, `Anchor`, `HFlow`, `VFlow`, `Card`, `Fit` — inherits it at once, which is what "geometry diffing globally" requires.

[^identity-keyed]: `CellGeometryCache`'s class comment spends a paragraph on this and the project's own record of the earlier attempt calls it out as one of the four holes found: a column-window slide renumbers the pool slots while surviving cells keep their columns, so a cache keyed on "slot N" misses on every survivor. Storing the record on the component object removes the question — there is no key to get wrong. It also removes the eviction question: the record dies with the component.

[^opt-in]: The earlier attempt at this skip, on `TableHeader` alone, took five audit rounds to find four reachable staleness holes: a per-column property changing on a surviving cell, a theme change rewriting padding behind every renderer's insets, the same setter reached from outside the reconciler, and a record written for a cell with no element. Each hole existed because the unconditional `doLayout()` had been silently covering some other writer of a layout input. That was one component. Turning the skip on for every component at once would be that audit multiplied by the component count, with no way to stage the risk. Default-off means the change is inert until a component's writers have been enumerated, and each future opt-in is a small, separately reviewable change.

[^dirty-flag]: The lesson recorded from the earlier attempt is that patching the caller only fixes the route you thought of — rounds 1 and 3 of that audit were the same defect one level out — and that the fix which ended it was structural: the setter that dirties a layout input lays itself out. `invalidateLayout()` is the cheaper version of the same shape for setters that cannot lay out immediately (during construction, or mid-cascade). Wiring it into `scheduleLayout()` means the roughly 125 existing sites that already announce "my layout inputs changed" keep working with no edit. Note the direction of the signal: `Text` schedules a layout on its *parent*, which marks the parent dirty, not the `Text` — that is why `Text` is not among the opt-ins.

[^element-gate]: This was hole 4 of the earlier audit, and it is reachable from the header, which renders no cells until its first layout pass and so can be driven through `renderColumnWindow` before the table is realised. `Card.doLayout` fits the renderer against `getInnerSize()`, which returns `null` without an element, so the pass cannot do its job — but `setWidth` and friends still write `_width` and `_height`, so the rectangle would compare equal on the next pass and the cell would be skipped forever, keeping a full-width box around an unsized renderer. `CellGeometryCache.apply` guarded this by refusing to record; `applyBounds` guards it by refusing to skip.

[^batching-window]: Today's `commitBounds` calls `setAutoCommitStyle(false)`, the four setters, `component.doLayout()`, then `setAutoCommitStyle(true)` — so any inline style the component writes on *itself* during its own layout pass is batched into the same flush. `applyBounds` reproduces that exactly. `setBounds` is for the call sites that do not cascade (the header band, the three header rows, the footer band, the body band in `layout/Table.ts`), where closing the window immediately is both correct and what those sites already do.

[^committed-readback]: `header.setHeight(headerBandHeight)` runs `clampHeight`, which for a component that clamps to its content size can return something other than the requested height. Today the header's inner rows are placed from `header.getContentBounds()` and the body band's height is derived from `header.getHeight()`, both of which see the clamped value. Recomputing them in `calculate()` from the requested value would be right in the ordinary case and wrong whenever a clamp bites — a behaviour change with no test to catch it. A fully pure calculate phase needs the clamp exposed as a query the calc phase can call without writing; that is a later step, not this one.

[^drop-invalidate]: `Body.updateColumnWidthCache` calls `invalidateGeom()` whenever the body width or any column width changes, and `Body.invalidateGeom` currently clears the entire per-cell geometry cache. That is a sledgehammer over an exact-valued comparison: the per-cell records store the x, width, and height last written, so a cell whose three numbers are unchanged does not need the cache cleared to stay correct, and a cell whose numbers changed is caught by the comparison anyway. Removing the cell half means a body-width change that leaves some columns untouched — fixed-shape `boolean` / `number` / `date` columns keep their width through `rescaleWidths`, and every column left of the first flexible one keeps its x too — no longer re-lays those cells out. The row half of `invalidateGeom` is untouched.

[^negative-half]: The recorded instruction from the earlier attempt is explicit: pin the negative half with a test that snapshots the subtree, forces the withheld `doLayout()`, and asserts nothing moved — or a later setter that grows a layout dependency goes stale silently with the suite green. Behaviour 13 is that test. It is worth more than the positive-path tests, because the positive path fails loudly and the negative path fails as a stale pixel nobody notices for a month.

---

## Implementation Notes

- **`Component.doLayout` clears `_layoutDirty` only when the component has an element**, not unconditionally as `## Internal Structure`'s snippet shows. The plan's own `doLayout()` body sets `this._layoutDirty = false` before `lm.doLayout()` with no element check. Implemented literally, this reopens `[^element-gate]`'s hole 4 one level out: `HeaderColumnWindow.test.ts`'s pre-existing test 36 ("geometry applied before the header renders is re-applied once it has") failed under the literal version. Trace: a header cell's first `applyBounds` call, before the header has an element, takes the `!this.getElement()` branch and calls `doLayout()`; `Card.doLayout` fits nothing (`getInnerSize()` is `null`), but the unconditional clear still marks the cell clean. Once the table is realised (`table.getElement(true)`, which per `Component.init` recursively builds every already-added descendant's element), a second `applyBounds` call with the *same* geometry sees `changed = false`, `isLayoutDirty() = false`, and `getElement()` now truthy — every skip condition is false, so the cell that has never actually been fitted stays permanently unfitted. `CellGeometryCache.apply` never had this failure mode because it only recorded a geometry once the cell had an element, so a miss (not a stale "clean" flag) forced the next pass to retry. Fix: gate the clear on `this.getElement()` — a pass with no element never marks the component clean, so a later pass at the identical rectangle still runs once the element exists. This is a stricter, still-correct reading of "the dirty flag tracks whether a layout pass is owed": a pass that could not place anything has not discharged the obligation. No behaviour the plan's own table (§ `## Expected Behaviour`) describes changes — behaviours 5-10 and 11-15 all pass under the corrected version, and `ComponentBounds.test.ts` behaviours 6-9 call `getElement(true)` before their first `doLayout`/`applyBounds`, which is the ordinary case this correction leaves unchanged.
- **`Body.test.ts`'s pre-existing `invalidateGeom` test asserted the removed cell-cache behaviour** (`expect(layouts).toBeGreaterThan(0)` after calling `invalidateGeom()` at unchanged geometry) — exactly the "one intentional behaviour change" `[^drop-invalidate]` documents, just not called out as a test to update. Updated the test's final assertion to `toBe(0)` and its comments to explain why, rather than leaving a failing assertion or silently deleting coverage.
- **A pre-existing gap in `Body`'s theme-reflow timing, found by the audit, is deliberately left as-is.** `VirtualRowView.onThemeReflow` (unchanged by this plan) ends by calling `renderWindow()` inline, from inside `ThemeManager.setTheme`'s synchronous listener dispatch — the same ordering `TableHeader`'s own theme subscription comment warns about and avoids by *not* re-rendering inline: a cell renderer's own theme subscription registers later (when the cell is pooled, not in `Body`'s constructor), so it can still be pending when this inline pass reads the renderer's insets, leaving the renderer's own content (e.g. its `Text`) fitted against the outgoing theme for one pass. This is exact parity with the deleted `CellGeometryCache`: its `.clear()` was reached from this same `invalidateGeom` → `renderWindow` chain, at the same point relative to other theme subscriptions, so the old cache had the identical gap. Confirmed via a deeper (renderer-content-level) snapshot on both this branch and the `ddfb0418` base commit — both show the same one-pass lag, so this step neither introduces nor fixes it. `CellLayoutSkip.test.ts`'s negative-half case for a theme reflow is scoped to the (cell, renderer) rect level accordingly, not the renderer's own descendants; see that test's and `snapshot`'s comments.
