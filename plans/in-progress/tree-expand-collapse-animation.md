---
touches-shared:
  - packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/layout/CollapseSupport.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# Tree Expand/Collapse Animation — Implementation Plan

## Overview

`Tree` and `TreeTable`'s tree column get two visual changes, and the two components stay identical in both.

1. **Glyph.** The solid triangle toggles (`caret-right` / `caret-down`) become FontAwesome's thin `angle-right`. One glyph serves both states: collapsed points right, and expanded turns it 90° to point down. When the same row flips its own state, the turn is a 200 ms CSS transition.
2. **Row motion.** When one node expands, its children slide down out from under the parent's row and fade in, and the rows below move down to make room. Collapse plays the same motion backwards. Today both are instant.

The motion is visual only. Expansion state, `_flatRows`, the `"expand"` / `"collapse"` events and `expandNodeAsync` all commit synchronously, exactly as today. The rows are rendered in their final state in the same call. The motion is layered on top from the next animation frame, rewinding the rows to their start position before the browser paints, then playing forward.

Where the code lives:

- A new shared helper, [`component/shared/TreeToggle.ts`](packages/lib/src/typescript/lib/component/shared/TreeToggle.ts), builds and turns the toggle glyph for both [`TreeRow`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L256) and [`TreeCellRenderer`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L235).
- The motion primitives go on the shared pool base [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L59), which both [`Tree`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L218) and [`Body`](packages/lib/src/typescript/lib/component/table/Body.ts#L1239) (and so `TreeBody`) extend. The motion reuses the duration and easing curve of [`CollapseSupport`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L19).
- `Tree` renders from a *motion row list* while a motion runs. `Body` gains one protected hook, `getRenderedRecords`, so `TreeBody` can do the same.

The plan is ordered in four phases: glyph and rotation (both components), `Tree` row motion, `TreeTable` row motion, then documentation.

---

## Architecture Decisions

### One `angle-right` glyph, turned by an inline transform

Both toggles show `angle-right` always. Expanded state is `setTransform("rotate(90deg)")`; collapsed is `setTransform("rotate(0deg)")`. An animated flip first sets `setTransition("transform 200ms cubic-bezier(0.4, 0, 0.6, 1)")`; a non-animated one first sets `setTransition(null)`. This mirrors [`ComboBox.setCaretOpen`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1139) and [`SplitButton._setChevronOpen`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L266), which turn a `Glyph` the same way, and [`AccordionIndicator`](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L93), whose one rotating character covers both states.[^rotate-not-rename]

### Tree and TreeTable share one toggle helper

`component/shared/TreeToggle.ts` owns the glyph name, its registration, the construction of a toggle and its rotation. `TreeRow` and `TreeCellRenderer` call it instead of each building their own caret.[^shared-toggle]

### The caret turns smoothly only when its row keeps the same node

A toggle animates its turn only when the row it sits in stays bound to the same node (`Tree`) or record (`TreeTable`) and only the expanded flag changed. A row rebound to a different node or record snaps its caret to the new angle. Reduced motion never installs the transition.[^same-node]

### The motion starts on the next animation frame, after a synchronous commit

The commit path is unchanged: state, flattening, a full render at the final state and the event, all in the calling tick. The motion is then *scheduled*. Its first frame rewinds the rows to the start of the motion. Browsers run animation-frame callbacks before painting, so the final state rendered by the commit is never shown before the rewind.[^first-frame]

### The motion lives on `VirtualRowView`, driven by `Animation.tween` on the collapse curve

`VirtualRowView` gets the motion state and the primitives both render passes call: a per-row Y offset, the animated content height, the extra window height, and a per-row style (opacity, pointer events). A frame is driven by [`Animation.tween`](packages/lib/src/typescript/lib/core/Animation.ts#L470) and calls the subclass's `renderWindow()`. The duration and curve are `CollapseSupport`'s `COLLAPSE_DURATION` (200 ms) and the JS twin of `COLLAPSE_EASING`, now exported. This mirrors [`CollapseSupport.animateLayout`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L381), which re-runs layout from interpolated values each frame on that same curve.[^js-driven]

### Children slide from under the parent and fade by how much of them has emerged

For the row list a motion renders, with the toggled row at index `b - 1`, `k` child rows at `[b, b + k)`, row height `H` and reveal `r` (0 = children hidden, 1 = fully shown):

- `hidden = (1 - r) * k * H`
- a row at index `i < b` sits at `i * H`;
- a row at index `i ≥ b` sits at `i * H - hidden`;
- a child row's opacity is `clamp((y + H - b * H) / H, 0, 1)`, where `y` is its position above — the share of it below the parent row's bottom edge;
- the content height is `totalRows * H - hidden`.

Worked example: `H = 24`, rows `A B b1 b2 b3 C D` (B expanded, `b = 2`, `k = 3`).

| Row | Index | `r = 0` y / opacity | `r = 0.5` y / opacity | `r = 1` y / opacity |
|---|---|---|---|---|
| A | 0 | 0 / — | 0 / — | 0 / — |
| B | 1 | 24 / — | 24 / — | 24 / — |
| b1 | 2 | -24 / 0 | 12 / 0 | 48 / 1 |
| b2 | 3 | 0 / 0 | 36 / 0.5 | 72 / 1 |
| b3 | 4 | 24 / 0 | 60 / 1 | 96 / 1 |
| C | 5 | 48 / — | 84 / — | 120 / — |
| D | 6 | 72 / — | 108 / — | 144 / — |
| content height | | 96 | 132 | 168 |

At `r = 0`, C and D sit exactly where they were before the expand. Collapse uses the same list and the same table, with `r` running from 1 to 0. Rows marked `—` carry no opacity.[^no-clip]

### A collapse renders from the pre-collapse row list; child rows ignore the pointer

While a collapse motion runs, the pool renders the row list as it was before the collapse (the *motion row list*). The committed `_flatRows` already excludes the children. Every row inside the child block — entering on expand, leaving on collapse — gets `pointer-events: none` for the duration, so it can be neither clicked nor hit behind the rows it overlaps. Everything else (keyboard navigation, selection, `getPreferredSize`, `aria-activedescendant`) keeps reading the committed state.[^motion-rows]

### Which toggles animate

A toggle animates only when every condition holds:

| Condition | Why it matters |
|---|---|
| It is one node's expand or collapse: a caret click, a row click / double-click toggle, `ArrowRight` / `ArrowLeft`, `expandNode`, `expandNodeAsync`, a lazy load that commits with an expand waiting, `TreeTable.setExpanded` | Bulk and structural calls never animate |
| `prefers-reduced-motion: reduce` is off | No motion at all under reduced motion |
| The view is rendered (has a scroller) | Nothing to animate |
| `1 ≤ k ≤ ceil(viewportHeight / H)` | A block taller than the view snaps |
| The commit render left the vertical scroll offset unchanged | A clamped scroll would make the first frame jump |

Examples, viewport 120 px, `H = 24` (5 visible rows):

| Toggle | Animates? |
|---|---|
| Expand a node with 5 children | yes |
| Expand a node with 6 children | no — more rows than fit |
| Collapse a node whose 3 children sit at the very bottom while scrolled to the end (the commit clamps the scroll offset) | no |
| `expandAll()` / `expandToDepth(1)` / `collapseAll()` / `revealByPredicate(...)` / `setNodes(...)` | no |
| Expand a lazy node whose load resolves with 2 children | yes, when the load commits |
| Expand a node with an empty loaded child list | no — `k = 0` |

[^threshold]

### Anything that re-flattens stops the motion; re-toggling the same node reverses it

Every change that rebuilds the flat rows — `Tree._flatten` and `TreeBody.flatten` — first calls `stopRowMotion()`. That cancels the frame loop and clears the motion itself, rather than relying on the tween's completion callback, which a cancel suppresses. The new state is then rendered at its final position in the same call. A toggle of the *same* node while its motion is still pending or running starts the new motion from the current reveal instead of the far end, for `200 ms × |to - from|`. A toggle of a different node snaps the old motion and starts a fresh one.

| While… | …this happens | Result |
|---|---|---|
| B's expand is at `r = 0.4` | collapse B | B collapses from 0.4 to 0 over 80 ms |
| B's expand is at `r = 0.4` | expand C | B snaps fully open; C animates 0 → 1 |
| B's collapse is running | `setChildren` / `insertNode` / `removeNode` / `setNodes` / `expandAll` / a store change (TreeTable) | motion stops; rows at the new final state in the same call |
| any motion | scroll, resize, selection, theme reflow | motion keeps running; each render uses the current reveal |

[^stop-semantics]

### No `animate` option

Neither `Tree` nor `TreeTable` gets an option to turn the motion off. Reduced motion is the only switch.[^no-option]

### `Body` renders from `getRenderedRecords(visible)`

`Body` gets `protected getRenderedRecords(visible: ModelRecord[]): ModelRecord[]`, returning `visible` by default. The render pass binds rows from it. Every other `Body` site that pairs a pool slot's bound index with a record list reads the rendered list too. `TreeBody` returns its motion row list's records while a motion runs. Selection logic, keyboard navigation and every public API keep using `getVisibleRecords()`.[^body-rendered]

### `Tree` re-lays out a row's children only when the row's size changed

`Tree._positionRows` calls `row.layoutChildren` only when the row was rebound or its width or height changed, not when only its Y offset moved. Without this, every moving row would re-lay out its toggle and renderer on every frame.[^relayout]

---

## Public API

`packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` — one new optional parameter:

```typescript
setTreeState(depth: number, hasChildren: boolean, expanded: boolean, animate?: boolean): this
```

`animate` (default `false`): when the toggle stays and only `expanded` changed, turn it with the 200 ms transition instead of snapping. Ignored under `prefers-reduced-motion: reduce`.

`packages/lib/src/typescript/lib/component/table/Body.ts` — one protected hook (subclass seam, not for consumers; TypeDoc excludes it):

```typescript
protected getRenderedRecords(visible: ModelRecord[]): ModelRecord[]
```

Consumer-visible behaviour changes with no signature change:

- `Tree` and `TreeTable` toggles are `angle-right` glyphs; `getToggle().getGlyphName()` always returns `"angle-right"`.
- `TreeRow` and `TreeCell` no longer register `caret-down` / `caret-right` at module load.
- Single-node expand and collapse animate (see *Which toggles animate*).

No new options fields, so no `XOptions` / default-options registry rows.

---

## Internal Structure

### `component/shared/TreeToggle.ts` (new)

```typescript
import { Glyph } from "~/component/display/Glyph.js";
import { Animation } from "~/core/Animation.js";
import { TREE_TOGGLE_TRAIT } from "~/core/StyleTraits.js";
import { COLLAPSE_DURATION, COLLAPSE_EASING } from "~/layout/CollapseSupport.js";
import { angle_right } from "~/glyphs/solid/angle_right.js";

Glyph.register(angle_right);

/** The one glyph every tree toggle shows; expansion is a rotation of it. */
export const TREE_TOGGLE_GLYPH = "angle-right";

/** Collapsed: the glyph as drawn, pointing right. */
const COLLAPSED_ROTATION = "rotate(0deg)";

/** Expanded: a quarter turn clockwise, pointing down. */
const EXPANDED_ROTATION = "rotate(90deg)";

/** Same duration and curve as the row motion, so caret and rows move together. */
const ROTATION_TRANSITION = `transform ${COLLAPSE_DURATION}ms ${COLLAPSE_EASING}`;

export function createTreeToggle(expanded: boolean): Glyph {
    // The pointer cursor comes from the shared tree-toggle trait.
    const toggle = new Glyph(TREE_TOGGLE_GLYPH, { styleTrait: TREE_TOGGLE_TRAIT });

    toggle.clearInsets();
    toggle.getAria().setHidden(true);
    rotateTreeToggle(toggle, expanded, false);

    return toggle;
}

export function rotateTreeToggle(toggle: Glyph, expanded: boolean, animate: boolean): void {
    toggle.setTransition(animate && !Animation.isReducedMotion() ? ROTATION_TRANSITION : null);
    toggle.setTransform(expanded ? EXPANDED_ROTATION : COLLAPSED_ROTATION);
}
```

The transition must be written before the transform, so the transform change is the one it animates (or does not).

### `VirtualRowView` motion state and primitives

```typescript
/** Where a toggled row's children sit in the row list a motion renders. */
export interface RowMotionBlock {
    /** Index of the first child row: one past the toggled row. */
    blockStart:  number;
    /** Number of rows under the toggled row, every depth included. */
    blockLength: number;
}

/** One expand or collapse motion, from scheduling until it settles or is stopped. */
interface RowMotion extends RowMotionBlock {
    /** The toggled node or record; a second toggle of the same key reverses from `reveal`. */
    key:     object;
    /** 0 = children hidden under the toggled row, 1 = fully shown. */
    reveal:  number;
    /** False until the first frame applies the motion; render passes ignore an unstarted one. */
    started: boolean;
    handle:  Animation.CancelHandle;
}

private _rowMotion: RowMotion | null = null;
```

Key method bodies (JSDoc omitted here; every method gets one per the conventions):

```typescript
protected isRowMotionRunning(): boolean {
    return this._rowMotion !== null && this._rowMotion.started;
}

/** The running motion's hidden height in px, or 0. */
private rowMotionHiddenHeight(): number {
    const motion = this._rowMotion;

    if (motion === null || !motion.started) {
        return 0;
    }

    return (1 - motion.reveal) * motion.blockLength * this.getRowHeight();
}

protected rowMotionY(dataIndex: number): number {
    const y      = dataIndex * this.getRowHeight();
    const motion = this._rowMotion;

    if (motion === null || !motion.started || dataIndex < motion.blockStart) {
        return y;
    }

    return y - this.rowMotionHiddenHeight();
}

protected rowMotionContentHeight(totalRows: number): number {
    return totalRows * this.getRowHeight() - this.rowMotionHiddenHeight();
}

/** Extra px the visible window must cover, for rows pulled up by the motion. */
protected rowMotionOverhang(): number {
    return this.rowMotionHiddenHeight();
}

protected applyRowMotionStyle(slot: number, dataIndex: number): void {
    const row    = this._rowPool[slot];
    const motion = this._rowMotion;
    const inBlock = motion !== null && motion.started
        && dataIndex >= motion.blockStart && dataIndex < motion.blockStart + motion.blockLength;

    if (inBlock) {
        const rowHeight = this.getRowHeight();
        const emerged   = (this.rowMotionY(dataIndex) + rowHeight - motion!.blockStart * rowHeight) / rowHeight;

        row.setOpacity(Math.min(1, Math.max(0, emerged)));

        if (row.getPointerEvents() !== "none") {
            row.setPointerEvents("none");
        }

        return;
    }

    if (row.getOpacity() !== null) {
        row.clearOpacity();
    }

    row.clearPointerEvents();
}

protected rowMotionBlock(rows: ReadonlyArray<{ depth: number }>, parentIndex: number): RowMotionBlock | null {
    if (parentIndex < 0) {
        return null;
    }

    const depth = rows[parentIndex].depth;
    let   end   = parentIndex + 1;

    while (end < rows.length && rows[end].depth > depth) {
        end++;
    }

    return { blockStart: parentIndex + 1, blockLength: end - parentIndex - 1 };
}

/**
 * Runs `commit` — the state change plus its final-state render — then
 * schedules a motion for the block it returns when the rules allow one.
 * Returns whether a motion was scheduled.
 */
protected commitWithRowMotion(key: object, expanding: boolean, commit: () => RowMotionBlock | null): boolean {
    const motion        = this._rowMotion;
    const retarget      = motion !== null && motion.key === key ? motion.reveal : null;
    const scrollYBefore = this._scroller?.getScrollY() ?? 0;
    const block         = commit();

    if (block === null || !this.mayAnimateRowMotion(block, scrollYBefore)) {
        return false;
    }

    const from = retarget ?? (expanding ? 0 : 1);
    const to   = expanding ? 1 : 0;

    if (from === to) {
        return false;
    }

    this.scheduleRowMotion(key, block, from, to);

    return true;
}

private mayAnimateRowMotion(block: RowMotionBlock, scrollYBefore: number): boolean {
    if (Animation.isReducedMotion() || this._scroller === null) {
        return false;
    }

    const viewportRows = Math.ceil((this.getHeight() || 0) / this.getRowHeight());

    return block.blockLength > 0
        && block.blockLength <= viewportRows
        && this._scroller.getScrollY() === scrollYBefore;
}

private scheduleRowMotion(key: object, block: RowMotionBlock, from: number, to: number): void {
    const motion: RowMotion = { key, ...block, reveal: from, started: false, handle: { cancel: (): void => {} } };

    this._rowMotion = motion;

    motion.handle = Animation.tween({
        from:       { reveal: from },
        to:         { reveal: to },
        durationMs: COLLAPSE_DURATION * Math.abs(to - from),
        // Clamped below 0: a frame timestamped before the tween's start (a
        // test driving frames with `now = 0`) must read as "not started".
        easing:     (t: number): number => COLLAPSE_EASE(Math.max(0, t)),
        onStep:     (values) => this.stepRowMotion(motion, values.reveal),
        onComplete: () => this.finishRowMotion(motion),
    });
}

private stepRowMotion(motion: RowMotion, reveal: number): void {
    if (this._rowMotion !== motion) {
        return;
    }

    motion.reveal = reveal;

    if (!motion.started) {
        motion.started = true;
        this.onRowMotionRowsChanged();
    }

    this.renderWindow();
}

private finishRowMotion(motion: RowMotion): void {
    if (this._rowMotion !== motion) {
        return;
    }

    this._rowMotion = null;
    this.onRowMotionRowsChanged();
    this.renderWindow();
}

/** Abandons a pending or running motion without rendering; the caller renders. */
protected stopRowMotion(): void {
    const motion = this._rowMotion;

    if (motion === null) {
        return;
    }

    this._rowMotion = null;
    motion.handle.cancel();
    this.onRowMotionRowsChanged();
}

/**
 * Called when the row list the pool renders switches: a motion's first
 * frame, and its end (settled or stopped). Default: nothing.
 */
protected onRowMotionRowsChanged(): void {}
```

### `Tree` motion wiring

```typescript
// New field, next to `_flatRows`. Framework-managed, no option.
// The row list a motion renders: `_flatRows` for an expand, the
// pre-collapse list for a collapse. Read only while a motion runs.
private _motionRows: FlatRow[] | null = null;

private _renderedRows(): FlatRow[] {
    return this.isRowMotionRunning() && this._motionRows !== null ? this._motionRows : this._flatRows;
}

private _reflattenWithMotion(node: TreeNode, expanding: boolean): void {
    const before = this._flatRows;

    const scheduled = this.commitWithRowMotion(node, expanding, () => {
        this._reflattenAndRender();

        const rows = expanding ? this._flatRows : before;

        this._motionRows = rows;

        return this.rowMotionBlock(rows, rows.findIndex(r => r.node === node));
    });

    if (!scheduled) {
        this._motionRows = null;
    }
}

protected onRowMotionRowsChanged(): void {
    this._flatRowsDirty   = true;
    this._maxContentWidth = 0;

    if (!this.isRowMotionRunning()) {
        this._motionRows = null;
    }
}
```

### `TreeBody` motion wiring

```typescript
// New fields. `_motionRecords` caches `_motionRows.map(f => f.record)`.
private _motionRows:       FlatRecord[] | null        = null;
private _motionRecords:    ModelRecord[] | null       = null;
// The record each pool row last pushed into its tree cell, so a caret
// turns smoothly only for a row that kept its record.
private _treeStateRecords: WeakMap<Row, ModelRecord>  = new WeakMap();

private renderedFlatRows(): FlatRecord[] {
    return this.isRowMotionRunning() && this._motionRows !== null ? this._motionRows : this._flatRows;
}

protected getRenderedRecords(visible: ModelRecord[]): ModelRecord[] {
    return this.isRowMotionRunning() && this._motionRecords !== null ? this._motionRecords : visible;
}

protected onRowMotionRowsChanged(): void {
    // Body re-binds by index, so a list switch must force the rebind.
    if (this._motionRows !== null && this._motionRows !== this._flatRows) {
        this.invalidateRowBindings();
    }

    if (!this.isRowMotionRunning()) {
        this._motionRows    = null;
        this._motionRecords = null;
    }
}
```

`setExpanded`'s body after its existing guards:

```typescript
const before = this._flatRows;

const scheduled = this.commitWithRowMotion(record, expanded, () => {
    if (expanded) {
        this._expanded.add(id);
    } else {
        this._expanded.delete(id);
    }

    this.flatten();
    this.invalidateRowBindings();
    this.renderWindow();

    const rows = expanded ? this._flatRows : this.collapsingMotionRows(before, record);

    this._motionRows    = rows;
    this._motionRecords = rows.map(f => f.record);

    return this.rowMotionBlock(rows, rows.findIndex(f => f.record === record));
});

if (!scheduled) {
    this._motionRows    = null;
    this._motionRecords = null;
}
```

`collapsingMotionRows(before, record)` returns a copy of `before` whose entry for `record` is `{ ...entry, expanded: false }`. `FlatRecord` bakes `expanded` in, so without this the collapsing parent's caret and `aria-expanded` would flip back to "expanded" for the length of the motion.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first: in each phase write the listed tests, see them fail, then implement.

### Phase 1 — Glyph and rotation

1. **`src/typescript/lib/layout/CollapseSupport.ts`**: export `COLLAPSE_DURATION` (line 19) and `COLLAPSE_EASE` (line 283), keeping their comments. No value changes. Check: `grep -n "^export const COLLAPSE" src/typescript/lib/layout/CollapseSupport.ts` lists `COLLAPSE_STRIP_SIZE`, `COLLAPSE_DURATION`, `COLLAPSE_EASING`, `COLLAPSE_EASE`.
2. **Create `src/typescript/lib/component/shared/TreeToggle.ts`** as in *Internal Structure*, with full JSDoc on each export and the module.
3. **Tests (red first)** in `tests/component/tree/Tree.test.ts` and `tests/component/table/cell/TreeCellRenderer.test.ts`: convert every glyph-name assertion. List them with `grep -n "caret-" tests/component/tree/Tree.test.ts tests/component/table/cell/TreeCellRenderer.test.ts`. The rule for each:

   | Old assertion | New assertion |
   |---|---|
   | `getGlyphName()).toBe('caret-right')` | `getGlyphName()).toBe('angle-right')` and `getTransform()).toBe('rotate(0deg)')` |
   | `getGlyphName()).toBe('caret-down')` | `getGlyphName()).toBe('angle-right')` and `getTransform()).toBe('rotate(90deg)')` |
   | a listener capturing `getGlyphName()` (the `loaderror` case) | capture `getTransform()` instead; expect `'rotate(0deg)'` |

   Rename the tests whose titles say "renames … to caret-down" to say "turns … to point down". In the `TreeRow` "renames the same toggle instance" case, keep the no-rule-ops and no-`createElementNS` assertions; drop the sprite warm-up comment's caret wording. Fix the file-header comment of `TreeCellRenderer.test.ts` (lines 4–5) to name `angle-right`. Add the new cases G1–G5 from *Expected Behaviour*; add G6 to `tests/component/table/TreeBody.test.ts`, mounting the table the way that file already does.
4. **`tests/component/dispose-full-teardown.test.ts`**: add `import { caret_down } from '~/glyphs/solid/caret_down';`, `import { caret_right } from '~/glyphs/solid/caret_right';` and a top-level `Glyph.register(caret_down, caret_right);` so the List and Tree-icon-renderer cases keep their glyph names now that no library module registers `caret-right`. Change the Tree case comment (line 513) to "expandAll() rebinds the root row, so `setRowData` turns its toggle". Import `Glyph` from `~/component/display/Glyph` if the file does not already.
5. **`src/typescript/lib/component/tree/TreeRow.ts`**:
   - Remove the `caret_down` / `caret_right` imports, the `Glyph.register` call (lines 14–17) and the `TREE_TOGGLE_TRAIT` import (line 7). Keep the `Glyph` import: `_toggle` is still typed `Glyph`. Import `createTreeToggle`, `rotateTreeToggle` from `~/component/shared/TreeToggle.js`.
   - `setRowData`: compute `const sameNode = node === this._node;` before the field writes; call `this.rebindToggle(hasChildren, expanded, loading, sameNode)`.
   - `rebindToggle(hasChildren, expanded, loading, animate)`: in the "idle branch stays idle branch" path call `rotateTreeToggle(this._toggle, expanded, animate)` instead of `setGlyphName`. In the build path, `const toggle = createTreeToggle(expanded);` replaces the four construction lines.
   - Update the class JSDoc (lines 38–46) and `rebindToggle`'s JSDoc: the caret turns instead of being renamed; it animates only when the row keeps its node.
   - Check: `grep -n "caret" src/typescript/lib/component/tree/TreeRow.ts` — only prose uses of "caret" remain, no `caret-down` / `caret-right`.
6. **`src/typescript/lib/component/table/cell/renderer/TreeCell.ts`**:
   - Remove the `TREE_TOGGLE_TRAIT` import (line 7), the `caret_down` / `caret_right` imports and the `Glyph.register` call (lines 9–12). Keep the `Glyph` import. Import `createTreeToggle`, `rotateTreeToggle` from `~/component/shared/TreeToggle.js`.
   - `setTreeState(depth, hasChildren, expanded, animate = false)`; pass `animate` to `refreshToggle(animate)`. Document `animate` in the JSDoc and fix the `expanded` param doc (line 180).
   - `refreshToggle(animate)`: `rotateTreeToggle(this._toggle, this._expanded, animate)` in the keep path; `createTreeToggle(this._expanded)` in the build path.
   - Update the class JSDoc (lines 30–34), `getToggle`'s JSDoc (lines 103–106) and `refreshToggle`'s JSDoc (lines 222–228).
7. **`src/typescript/lib/component/table/TreeBody.ts`**: add `_treeStateRecords` (see *Internal Structure*). In `afterRowBound`, compute `const animate = this._treeStateRecords.get(row) === flat.record;`, pass it as `setTreeState`'s fourth argument, then `this._treeStateRecords.set(row, flat.record)`.
8. **`src/typescript/lib/component/table/TreeTable.ts`**: class JSDoc line 49 — the toggle is an `angle-right` glyph turned to point down when expanded.
9. **Check**: `npm run typecheck`; `npx vitest run tests/component/tree tests/component/table/cell/TreeCellRenderer.test.ts tests/component/dispose-full-teardown.test.ts tests/component/table/TreeBody.test.ts`; `grep -rn '"caret-down"\|"caret-right"' src/typescript/lib/component/tree src/typescript/lib/component/table` — expect zero matches.

### Phase 2 — `Tree` row motion

10. **Tests (red first)**: create `tests/component/tree/TreeExpandMotion.test.ts` covering M1–M15. Copy the frame-capture setup from `tests/component/tree/RenderPassEconomy.test.ts` (lines 37–84): captured `requestAnimationFrame` / `cancelAnimationFrame`, dispose trees *before* draining frames in `afterEach`. Add a controllable clock: `vi.spyOn(performance, 'now').mockImplementation(() => clock)`, and run frames with `callback(clock)` after setting `clock`. Read row positions with `row.getTranslateY()` and opacity with `row.getOpacity()`; read the content height from a spy on the scroller's `layoutScrollbars` (second argument).
11. **`src/typescript/lib/component/shared/VirtualRowView.ts`**: import `Animation` and `COLLAPSE_DURATION`, `COLLAPSE_EASE`. Add `RowMotionBlock` (exported type), `RowMotion`, `_rowMotion` and the methods in *Internal Structure*, each with JSDoc. In `destructor` (line 144), before the pool loop, add `this._rowMotion?.handle.cancel(); this._rowMotion = null;` with a comment mirroring the resize-settle one. Update the class JSDoc's primitive list (lines 47–52) to mention the motion primitives.
12. **`src/typescript/lib/component/tree/Tree.ts`** — state and flattening:
    - Add `_motionRows` beside `_flatRows` (line 222), with a comment in the style of `_flatRowsDirty`'s.
    - `_flatten` (line 1121): first statement `this.stopRowMotion();`.
    - Add `_renderedRows`, `_reflattenWithMotion` and the `onRowMotionRowsChanged` override from *Internal Structure*.
13. **`Tree.ts`** — the three animated commit paths:
    - `_expand` (line 1432): replace `this._reflattenAndRender();` with `this._reflattenWithMotion(node, true);`.
    - `_collapse` (line 1453): replace it with `this._reflattenWithMotion(node, false);`.
    - `_settleResolvedLoad` (line 1647): inside the `_captureThrow` step, `if (expanding) { this._reflattenWithMotion(node, true); } else { this._reflattenAndRender(); }`, then the existing `emit`.
    - Leave `expandAll`, `_expandPathTo`, `_commitStructureChange`, `_loadAndExpand`, `_settleFailedLoad` and `setNodes` on `_reflattenAndRender` / `_flatten`. Check: `grep -n "_reflattenWithMotion" src/typescript/lib/component/tree/Tree.ts` — exactly the definition plus three calls.
14. **`Tree.ts`** — render pass:
    - `renderWindow` (line 2104): `const rows = this._renderedRows();` `totalRows = rows.length`; `totalHeight = this.rowMotionContentHeight(totalRows)`; the window is `computeVisibleWindow(scroller.getScrollY(), visibleHeight + this.rowMotionOverhang(), totalRows)`; `computePoolTarget` keeps plain `visibleHeight`; `reconcilePoolByKey`'s `keyAtRow` reads `rows[dataIndex].node`; pass `rows` to `_bindAndMeasure`.
    - `_bindAndMeasure(rows, firstRow, windowSize)` (line 2224): read `rows[dataIndex]` instead of `this._flatRows[dataIndex]`. Update its JSDoc.
    - `_positionRows` (line 2285): read `const prev = this._rowGeom[i];` and `const sizeChanged = prev === null || prev.w !== rowWidth || prev.h !== ROW_HEIGHT;` *before* `positionRow`; position at `this.rowMotionY(dataIndex)`; call `this.applyRowMotionStyle(i, dataIndex)` after it; relayout when `wasRebound || (geomChanged && sizeChanged && !deferChildLayout)`. Update its JSDoc.
15. **`Tree.ts`** — JSDoc: add a paragraph to the class JSDoc (after line 201) saying a single expand or collapse animates after the state commits, and that bulk calls and reduced motion do not. Add a one-line remark to `expandNode` and `expandNodeAsync` that the row animation follows the commit and does not delay the resolution.
16. **Check**: `npm run typecheck`; `npx vitest run tests/component/tree` — all green, including `RenderPassEconomy.test.ts`, `ResizeLayoutEconomy*.test.ts` and `TreeFontReflow.test.ts` unchanged.

### Phase 3 — `TreeTable` row motion

17. **Tests (red first)**: create `tests/component/table/TreeTableExpandMotion.test.ts` covering T1–T6, with the same frame and clock capture. Mount a `TreeTable` the way `tests/component/table/EditAcrossRowRebind.test.ts` does (`realize`, lines 102–110), with a small store so the child block fits the viewport.
18. **`src/typescript/lib/component/table/Body.ts`** — hook and render pass:
    - Add `protected getRenderedRecords(visible: ModelRecord[]): ModelRecord[] { return visible; }` next to `getVisibleRecords` (line 540), JSDoc marking it a subclassing seam.
    - `renderWindowPass` (line 1239): `let visible = this.getVisibleRecords(); let records = this.getRenderedRecords(visible);`; `totalRows = records.length`; `totalHeight = this.rowMotionContentHeight(totalRows)`. In the `commitEditsOutsideWindow` branch re-read both lists and recompute the same way. The window uses `visibleHeight + this.rowMotionOverhang()`. The `aria-rowcount` block uses `visible.length` (both the comparison and the stored `_lastAriaRowCount`).
    - `bindAndPositionRows` (line 1437): both `positionRow` calls use `this.rowMotionY(dataIndex)`; each is followed by `this.applyRowMotionStyle(i, dataIndex)`.
19. **`Body.ts`** — slot-lookup sites read the rendered list:

    | Site | Change |
    |---|---|
    | `onRowClick` (line 1564), the `_boundIndices.forEach` repaint | iterate with `const rendered = this.getRenderedRecords(records)`; the selection reducer keeps `records` |
    | `refreshCellRangeHighlight` (line 1737) | `const rendered = this.getRenderedRecords(records)`; compute `bounds` from and repaint against `rendered` |
    | `selectRecord` (line 2283) | repaint with `this.getRenderedRecords(this.getVisibleRecords())` |
    | `setSelectedRecords` (line 2329) | same |
    | `_updateFocusStyle` (line 2657) | `anchorIdx = this.getRenderedRecords(this.getVisibleRecords()).indexOf(this._anchorRecord)` |
    | `_updateActiveDescendant` (line 2713) | same |
    | `resolveFocusedCell` (line 2948) | same |

    Check: `grep -n "_boundIndices" src/typescript/lib/component/table/Body.ts` — every read that indexes a record list is one of the rows above or inside `bindAndPositionRows`.
20. **`src/typescript/lib/component/table/TreeBody.ts`**:
    - Add `_motionRows`, `_motionRecords`, `renderedFlatRows`, the `getRenderedRecords` and `onRowMotionRowsChanged` overrides and `collapsingMotionRows` from *Internal Structure*.
    - `flatten` (line 970): first statement `this.stopRowMotion();`.
    - `setExpanded` (line 320): after the existing guards, replace the mutate / `flatten` / `invalidateRowBindings` / `renderWindow` tail with the `commitWithRowMotion` block from *Internal Structure*. Leave `expandToDepth`, `collapseAll`, `expandAll` and `onStoreChange` as they are; they reach `flatten` and so stop any motion.
    - `computeRowAria` (line 552) and `afterRowBound` (line 580): read `this.renderedFlatRows()[dataIndex]` instead of `this._flatRows[dataIndex]`.
    - Update `setExpanded`'s JSDoc and `TreeTable.setExpanded`'s JSDoc (TreeTable.ts line 186): the change commits at once and a single toggle then animates.
21. **Check**: `npm run typecheck`; `npx vitest run tests/component/table` — all green, including `Body.test.ts`, `TreeBody.test.ts`, `EditAcrossRowRebind.test.ts`.

### Phase 4 — Documentation

22. **`docs/components/Tree.md`**: add a `### Animation` subsection at the end of `## Expansion state` (after line 93), stating: a single expand or collapse animates (caret turn, children slide out from under the parent, rows below move); state and events commit first; the bulk and structural calls never animate; a toggle whose children would not fit in the view, or whose commit moves the scroll offset, snaps; `prefers-reduced-motion: reduce` turns it off.
23. **`docs/components/TreeTable.md`**: add the same paragraph, adapted to `setExpanded` / `ArrowLeft` / `ArrowRight` / the toggle, under `## Expand / collapse` (after line 74). Delete the `**Animation.**` non-goal bullet (line 142).
24. **`docs/components/Glyph.md`**: line 50 — "`Tree` and `TreeTable` row toggles — `angle-right`, turned 90° to point down when expanded." Line 62 — remove "the `Tree` and `TreeTable` expand/collapse carets" from the list of `setGlyphName` users.
25. **`docs/components/Glyphs.md`**: line 42 — "`Tree` and `TreeTable` — register `angle-right` for the row toggle."
26. **`docs/reference/changelog/next.md`**: add, in the existing heading shape (`## Breaking changes` / `## Changed` above the existing `## Fixed`, each with `### Components`):
    - Breaking: "`Tree` and `TreeTable` no longer register `caret-down` / `caret-right`." One paragraph ending "See [Migration](/reference/migration/next) for the full note."
    - Changed: "`Tree` and `TreeTable` toggles are a thin angle that turns to point down, and a single expand or collapse animates." Summarise the rules in *Which toggles animate* in two sentences, and name the new optional `TreeCellRenderer.setTreeState` parameter.
27. **`docs/reference/migration/next.md`**: add a `##` section headed "`Tree` and `TreeTable` no longer register `caret-down` / `caret-right`", with **What changed and why** / **Who needs to act** paragraphs in the 0.10.0 migration page's style. Who acts: code that shows `caret-down` / `caret-right` (a button glyph, an icon renderer resolver) and relied on importing `Tree` or `TreeTable` to register them — register them itself: `Glyph.register(caret_down, caret_right)`. Also: code that read `getToggle().getGlyphName()` to learn a row's expansion should call `Tree.getExpandedNodes()` / `TreeTable.isExpanded(record)`.
28. **Check**: `grep -rn "caret-down\|caret-right" docs/components/Tree.md docs/components/TreeTable.md docs/components/Glyph.md docs/components/Glyphs.md` — zero matches. `npm run docs:api` (0 errors, 0 link warnings); `npm run docs:llms:check` — run `npm run docs:llms` only if it reports a change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/shared/TreeToggle.ts` |
| Create | `packages/lib/tests/component/tree/TreeExpandMotion.test.ts` |
| Create | `packages/lib/tests/component/table/TreeTableExpandMotion.test.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeBody.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/TreeTable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/TreeCellRenderer.test.ts` |
| Modify | `packages/lib/tests/component/table/TreeBody.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/components/Glyph.md` |
| Modify | `packages/lib/docs/components/Glyphs.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

All cases are unit-testable offline unless marked **manual**. Motion cases capture animation frames and mock `performance.now` (see step 10). The tree fixture is 300 × 120 px (`H = 24`, 5 visible rows) over `A`, `B { b1, b2, b3 }`, `C`, `D` unless stated.

### Glyph and rotation

- **G1** A branch row's toggle reports `getGlyphName() === 'angle-right'` collapsed and expanded; `getTransform()` is `'rotate(0deg)'` collapsed and `'rotate(90deg)'` expanded. Same for a `TreeCellRenderer` via `setTreeState`.
- **G2** `TreeRow.setRowData` for the same node with only `expanded` flipped keeps the same toggle instance, sets `getTransition()` to `'transform 200ms cubic-bezier(0.4, 0, 0.6, 1)'`, and writes no stylesheet rule (no `ensureStyleRule` / `setRuleStyles` / `deleteStyleRule` ops) and no `createElementNS`.
- **G3** Rebinding a row to a *different* branch node with a different `expanded` leaves `getTransition()` `null` and sets the new rotation.
- **G4** With `DOM.source.matchMedia` mocked to `{ matches: true }`, G2's flip leaves `getTransition()` `null`; the rotation still changes.
- **G5** `TreeCellRenderer.setTreeState(0, true, true, true)` after `(0, true, false)` sets the transition; `(0, true, false)` with `animate` omitted sets it `null`. A leaf has no toggle.
- **G6** `TreeTable.setExpanded(record, true)`: the toggle in the row bound to `record` has a non-null transition. After scrolling so that row's slot binds a different branch record, that toggle's transition is `null`.

### `Tree` row motion

- **M1** Commit is synchronous. Right after `tree.expandNode(B)`, before any frame: `getExpandedNodes()` contains B; `"expand"` fired once; `_flatRows` holds 7 rows; every displayed row's `getTranslateY()` is `index * 24`; no pool row has an opacity (`getOpacity() === null`).
- **M2** Expand frames. Clock 1000 at `expandNode`; frame at 1000: rows match the `r = 0` column of the worked example; frame at 1100: rows match the `r = 0.5` column (use `toBeCloseTo`); the content height passed to `layoutScrollbars` is 96 then 132.
- **M3** Settle. Frame at 1200: every displayed row at `index * 24`; no pool row has an opacity or `pointer-events`; the last `layoutScrollbars` height is 168; no further frame is requested by the motion.
- **M4** Collapse. Start with B expanded and its motion settled, then collapse B through the private `_onToggle(B)` — the caret-click / `ArrowLeft` path — called the way `Tree.test.ts`'s `_onToggle` cases do. Before any frame: `_flatRows` has 4 rows and `"collapse"` fired once. Frame at start: rows bound to b1–b3 are displayed again (the motion row list) at the `r = 1` column positions. Frame at +100 ms: the `r = 0.5` column. After settle: no displayed row is bound to b1, b2 or b3; C at 48, D at 72.
- **M5** During M2 and M4 frames, rows bound to b1–b3 have `getPointerEvents() === 'none'`; A, B, C, D do not.
- **M6** Retarget. Expand B, frame at start and at +80 ms, note `r` (read from the row positions or `COLLAPSE_EASE(0.4)`). Collapse B at +80 ms. `"collapse"` fires once. The next frame at the same clock renders with that same `r`; the motion settles `200 × r` ms later with no child rows displayed.
- **M7** Stop. During an expand motion, each of `setChildren(B, [...])`, `insertNode(null, 0, X)`, `removeNode(C)`, `setNodes(...)`, `expandAll()` renders the new state at final positions in the same call, leaves no opacity or pointer-events on any row, and running the remaining captured frames changes nothing.
- **M8** `expandAll()`, `revealByPredicate(...)` (awaited), `setNodes(...)` on a fresh tree: `Animation.tween` (spied) is never called.
- **M9** Threshold. A node with 5 children animates (tween called); one with 6 children does not.
- **M10** Scroll clamp. 20 root leaves then `Z { z1, z2, z3 }`, Z expanded, scrolled to the end. Collapsing Z clamps the scroll offset in the commit, so no tween is called and the rows are final.
- **M11** Reduced motion (`matchMedia` mocked true): expanding B calls no tween, and the rows are final in the same call.
- **M12** Lazy load. A lazy node with `hasChildren: true` expanded via `expandNodeAsync`: the spinner render calls no tween; when the loader resolves with 2 children, the tween is called, `"expand"` fires after the render as today, and the promise resolves `true`.
- **M13** `tree.dispose()` mid-motion cancels the captured motion frame; draining frames afterwards throws nothing and calls no `renderWindow`.
- **M14** `setScrollY` mid-motion re-renders using the current reveal: a frame's row positions equal the formula for the reveal of that frame (the scroll moves the rows container, not the rows).
- **M15** Keyboard during a collapse motion. Focus B (expanded); `ArrowLeft` (through `_onKeyDown`, as `Tree.test.ts` drives keys) collapses it; then, before any further frame, `ArrowDown`: the selection moves to C, never to b1.

### `TreeTable` row motion

- **T1** `table.setExpanded(record, true)`: `isExpanded(record)` and `getBody().getFlatRecords()` reflect it before any frame, and every row sits at `index * rowHeight`.
- **T2** At half the duration, row positions follow the worked-example formula with `H = body.getRowHeight()`.
- **T3** Collapse motion: at the first frame the collapsing parent's row has `aria-expanded="false"` and its toggle `getTransform() === 'rotate(0deg)'`, while the leaving child rows are bound again and have pointer-events `none`.
- **T4** Collapse B while the anchor (selected) record is D, below the block. At a mid-motion frame, the cell carrying `.focused` belongs to the row whose `getData()` is D, and `aria-activedescendant` names a cell in that row.
- **T5** `expandToDepth(1)`, `collapseAll()`, `expandAll()` and a store change (`store.notifyRecordChanged` of a parent field) each stop a running motion and render final in the same call; none calls the tween.
- **T6** A plain `Table` renders exactly as before: `getRenderedRecords` returns its argument, and the existing `Body.test.ts` suite passes unchanged.

### Manual

- **V1 (manual)** In the dev app (`npm run dev`, `localhost:8015`), **MiscPanel**'s `Tree` and `TreeTable`: expand and collapse nodes by caret, double-click and arrow keys. The angle turns and the children slide in from under the parent with the rows below moving in step; collapse reverses; no one-frame flash of the final state at the start.
- **V2 (manual)** The rotated angle stays centred in its 20 px toggle box at both angles.
- **V3 (manual)** Rapid double toggles reverse smoothly; scrolling with the wheel mid-motion keeps rows aligned; `expandAll` snaps.
- **V4 (manual)** With the OS reduced-motion setting on (or DevTools *Emulate CSS prefers-reduced-motion: reduce*), nothing animates, caret included.

---

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test` — the whole suite; in particular `tests/component/tree/*`, `tests/component/table/*`, `tests/component/dispose-full-teardown.test.ts`, `tests/unit/import-without-dom.test.ts`
- `grep -rn '"caret-down"\|"caret-right"' packages/lib/src/typescript/lib/component/tree packages/lib/src/typescript/lib/component/table` — zero matches
- `npm run docs:api` — 0 errors, 0 link warnings; `npm run docs:llms:check`
- Manual V1–V4 in MiscPanel

---

## Documentation Impact

- Export surface: `TreeCellRenderer` (`@jimka/typescript-ui/component/table`) gains the optional `animate` parameter. `TreeToggle.ts` is internal and is not added to any barrel.
- Pages: `docs/components/Tree.md`, `docs/components/TreeTable.md`, `docs/components/Glyph.md`, `docs/components/Glyphs.md`, `docs/reference/changelog/next.md`, `docs/reference/migration/next.md` (steps 22–27).
- JSDoc: `Tree` class, `expandNode`, `expandNodeAsync`, `TreeRow` class and `rebindToggle`, `TreeCellRenderer` class / `getToggle` / `setTreeState` / `refreshToggle`, `TreeTable` class and `setExpanded`, `TreeBody.setExpanded`. Cross-bucket references follow the document skill's link forms.
- `llms.txt`: no new class; the Tree and TreeTable one-line summaries do not change, so no regeneration is expected (step 28 checks).

---

## Potential Challenges

- **A toggle made from inside an animation-frame callback** schedules its first motion frame for the *next* frame, so the final state paints once before the rewind. Every user toggle comes from an input event, so this only affects code that toggles from its own `requestAnimationFrame`; accept it.
- **Pool growth.** The window grows by up to `k ≤ viewport rows` rows during a motion, and the pool never shrinks, so a tree can keep up to about twice its viewport's rows pooled. Bounded by the threshold; accept it.
- **TreeTable collapse rebinds the window twice more** (at the first frame and at the settle), because `Body` binds by index and the motion row list shifts indices. Expand costs nothing extra (its motion list is `_flatRows`).
- **A half-emerged child row overlaps the parent's lower edge at partial opacity.** Deliberate; see the no-clip footnote.
- **Offline frame drivers** that call captured frames with `now = 0` against a real clock leave a motion pending at its start reveal forever. New tests must mock `performance.now`. Of the existing suites that drain frames, `RenderPassEconomy` case 20 expands inside the threshold but disposes its trees before draining (the destructor cancels the motion), and `EditAcrossRowRebind`'s child block is larger than its view.
- **Recorded writes.** Offline, every animated toggle records one `requestAnimationFrame` op in the `RecordingDOMSink`. A test that asserts a toggle's complete write list must filter that op out.
- **Synthetic clicks** bypass `pointer-events: none`, so a test dispatching a click on a leaving row still reaches the handler. Tests must not rely on that path.
- **A size-driven parent** (an `Anchor`-pinned `Tree` using its preferred height) resizes to the final height at once while the rows animate inside it.
- **Assistive technology** can see the leaving rows for up to 200 ms after a collapse. Selection and `aria-activedescendant` never point at them.

---

## Critical Files

- `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` — `animateLayout` (line 381), `COLLAPSE_DURATION`, `COLLAPSE_EASING`, `COLLAPSE_EASE`: the JS-driven motion and curve this plan reuses.
- `packages/lib/src/typescript/lib/core/Animation.ts` — `tween` (line 470), `isReducedMotion` (line 77), `CancelHandle`.
- `packages/lib/src/typescript/lib/component/input/ComboBox.ts` — `setCaretOpen` (line 1139): transition-then-transform on a `Glyph`.
- `packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts` — single rotating chevron.
- `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — the pool base: `positionRow`, `computeVisibleWindow`, `reconcilePoolByKey`, `hideExcessPoolRows`, `destructor`.
- `packages/lib/src/typescript/lib/component/tree/Tree.ts` — `_flatten`, `_expand`, `_collapse`, `_settleResolvedLoad`, `renderWindow`, `_bindAndMeasure`, `_positionRows`.
- `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` — `setRowData`, `rebindToggle`.
- `packages/lib/src/typescript/lib/component/table/Body.ts` — `renderWindowPass`, `bindAndPositionRows`, and the seven slot-lookup sites in step 19.
- `packages/lib/src/typescript/lib/component/table/TreeBody.ts` — `setExpanded`, `flatten`, `computeRowAria`, `afterRowBound`.
- `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` — `setTreeState`, `refreshToggle`.
- `packages/lib/tests/component/tree/RenderPassEconomy.test.ts` — the frame-capture pattern the new tests copy.

---

## Non-Goals

- **Animating bulk or structural changes** (`expandAll`, `expandToDepth`, `collapseAll`, `revealByPredicate`, `setNodes`, `insertNode`, `removeNode`, `setChildren`, store changes). They can change many blocks at once; they snap.
- **An `animate` or duration option** on `Tree` / `TreeTable` (see the no-option footnote).
- **Keeping a motion alive across a structural change.** It snaps to the new state.
- **Animating the tree's own preferred size** for size-driven parents.
- **Merging the two `TOGGLE_WIDTH` constants** in `TreeRow.ts` and `TreeCell.ts`. They stay in lockstep by comment, as today.
- **Hiding leaving rows from assistive technology** during the 200 ms collapse.

---

## Notes

[^rotate-not-rename]: A CSS transition cannot animate a change of glyph name — `setGlyphName` swaps the painted symbol in one step — so a rename could never produce the requested turn. Renaming between `angle-right` and `angle-down` was rejected for that reason. One glyph plus a rotation also keeps the toggle's DOM untouched on every flip: the transform is an inline motion property (ARCHITECTURE.md, *Motion properties write inline*), so a flip writes no stylesheet rule, which the existing "no rule ops on a flip" test pins. `AccordionIndicator` does the rotation through a declared `.expanded` style state instead; that route needs a per-instance rule and a class toggle and exists for a component that owns its own element. A toggle glyph owned by a pooled row is closer to `ComboBox`'s and `SplitButton`'s caret, which take the inline route.

[^shared-toggle]: Both toggles were already duplicated line for line (construction, trait, `clearInsets`, `aria-hidden`, rename). Adding a rotation, a transition and a reduced-motion check to both copies would double the chance of the two components drifting apart, and the user asked for them to stay consistent. `component/shared/` already holds code the tree and table share (`VirtualRowView`, `selectionsEqual`).

[^same-node]: Pool rows are reused. On a scroll or a rebind, a row that showed an expanded node can be handed a collapsed one; with a standing transition its caret would visibly spin while scrolling. Tying the animation to "same node, only `expanded` changed" means only a real flip of the thing on screen animates. `Tree` reconciles its pool by node identity, so `TreeRow` can compare `node === this._node` itself. `TreeBody` forces a full rebind on every toggle (`invalidateRowBindings`), so `wasRebound` cannot tell it the same thing; it remembers the record each row last pushed into its tree cell instead. A flip caused by `expandAll` on a row that keeps its node also animates its caret — harmless, and the same in both components.

[^first-frame]: The offline test harness drops `requestAnimationFrame`. Starting the motion synchronously (rendering the start state in the commit, as `animateLayout` does) would leave every existing `Tree` and `TreeTable` test that expands or collapses looking at a half-played motion forever: collapsed children still bound, rows shifted. Rendering the final state first keeps those tests, and every caller that reads the rows right after a toggle, seeing the committed result. In a browser, animation-frame callbacks run before style, layout and paint in the same rendering step, so the first frame's rewind replaces the final state before it is ever painted. The caret's CSS transition starts at the commit; the rows start one frame later. At 200 ms that offset is not visible.

[^js-driven]: Precedent search covered `Animation.play` / `afterTransition` (CSS transitions on one element, used by `Dialog`, `Notification`, `Accordion`), `Animation.tween` (JS numeric tween, used by `AbstractWindow`), `CollapseSupport.animateLayout` / `runCollapse` (`Split`, `Border`), `Accordion.primeWrapper`, `Toggle`, `TabButton`, `ComboBox.setCaretOpen`, `SplitButton._setChevronOpen`. The closest problem is `animateLayout`: several boxes move together and the layout is re-run from interpolated values each frame, so what is on screen always comes from one function of progress. A virtual pool needs exactly that: a scroll, a rebind, a pool rotation or a resize mid-motion all re-render from the current reveal, and each row's position is always `rowMotionY(dataIndex)`. Per-row CSS transitions (FLIP) were rejected: a pooled row can change which data row it shows mid-transition, a scroll moves the window under running transitions, and leaving rows would need their own lifetime management. `Animation.tween` is used rather than a copy of `animateLayout`'s frame loop because it is the library's generic numeric tween with a cancel handle; the easing is `COLLAPSE_EASE` so rows move on the same symmetric curve, and at the same 200 ms, as `Split`, `Border` and `Accordion`. The primitives go on `VirtualRowView` because that class already owns the pool's position, window and geometry primitives for both subclasses (its own JSDoc lists them); `Body` and `Tree` each compose them in their own render pass, as they already compose `positionRow` and `computeVisibleWindow`.

[^no-clip]: A cleaner reveal would clip each child row at the parent's bottom edge. `Component.setClipPath` writes the component's `#id` stylesheet rule, not an inline style, and ARCHITECTURE.md lists that exact per-event `clip-path` rule write (Split/Border) as a known deviation not to repeat: in WebKitGTK every rule write restyles the whole document, so one per row per frame is ruled out. Opacity and transform are inline motion properties. Fading each child row by the share of it below the parent edge hides a row while it is fully under the parent (so no text overlaps) and leaves at most one row half-overlapping the parent's lower edge at partial opacity. Pool rows have transparent backgrounds and an arbitrary DOM order, so no z-order trick can hide the overlap instead. The slide (children emerge from under the parent) was chosen over a curtain (children stay put and are uncovered) because the whole block below the parent then moves as one rigid piece — one offset for every row at or after `b` — which is both what the user described and the cheaper formula.

[^motion-rows]: A collapse must keep showing rows that the committed state no longer contains. Delaying the flat-list update until the motion ends was rejected: for 200 ms, keyboard navigation, selection ranges, `getPreferredSize` and the pool's click mapping would all see nodes that are no longer visible, and `ArrowLeft` followed quickly by `ArrowDown` would select a hidden child. A separate list read only by the render pass keeps every semantic path on the committed state. `pointer-events: none` on the child block does two jobs: leaving rows cannot be clicked into selecting a hidden node, and a row still fully under the parent (opacity 0) does not swallow clicks meant for the rows above it. `pointer-events` is inherited, so the toggle glyph inside such a row is covered too.

[^threshold]: A block taller than the view would travel more than a screen in 200 ms — too fast to read — and would need a pool larger than the view to cover the hidden rows. `ceil(viewportHeight / H)` caps both. The scroll check covers one case: a collapse near the end of a scrolled list, where the commit render's `clampToContent` pulls the scroll offset up. The first motion frame renders the longer list again at the clamped offset, so the content would jump by up to `k` rows before collapsing. Expanding never clamps (content only grows). `expandAll`, `revealByPredicate` and the structural calls can open or change many blocks at once, which one reveal value cannot describe; they keep their current instant behaviour.

[^stop-semantics]: `Animation.tween`'s `cancel()` suppresses `onComplete` (the same trap recorded for `Animation.play`), so a stopped motion's cleanup cannot live in the completion callback. `stopRowMotion` clears `_rowMotion` and calls the list-switch hook itself, and `stepRowMotion` / `finishRowMotion` ignore a motion that is no longer current. Stopping inside `_flatten` / `TreeBody.flatten` makes one choke point cover every structural path — `setNodes`, the three node-level calls, lazy-load commits, `expandAll`, `revealByPredicate`, store changes — without listing them. Retargeting only the same key keeps the one case users actually hit (clicking a caret twice quickly) smooth; interleaving two blocks' motions would need two reveal values in one row formula. Scaling the duration by `|to - from|` matches how browsers shorten a reversed CSS transition, so the caret and the rows stay in step on a reverse.

[^no-option]: The motion code reuses `Split` / `Border`'s collapse timing, and neither exposes an option to turn it off. `Accordion` has `animationDuration`, a tuning knob that also re-times its chevron; nothing here asks for tuning. `AnimatedDropdown`'s `animated` flag exists for picker hosts that must show instantly, which has no parallel in a tree. The user asked for configurability only where precedent calls for it, and `prefers-reduced-motion` already gives users a switch.

[^body-rendered]: `Body` binds pool slots by data index and several paths outside the render pass map a slot's bound index back to a record through `getVisibleRecords()`: the click repaint, the range highlight, `selectRecord`, `setSelectedRecords`, the focus ring, `aria-activedescendant` and the focused-cell lookup used by editing. During a collapse motion the bound indices are positions in the motion list, so each of those must read the same list, or the focus ring and selection tint land on the wrong row for every frame. Passing the committed list in (`getRenderedRecords(visible)`) keeps the default a zero-cost identity for a plain `Table`, which never calls `getVisibleRecords()` a second time. Overriding `getVisibleRecords()` in `TreeBody` instead was rejected for the reason in the motion-rows footnote: selection, keyboard navigation and Table APIs would see hidden rows.

[^relayout]: `layoutChildren` places the toggle, spinner and renderer inside the row's content box and depends on the row's size and depth, never on its Y offset; a depth change is a rebind (`isBoundTo` compares depth), and `invalidateGeom` clears `_rowGeom`, so `prev === null` still forces a relayout after a width, theme or settle invalidation. Today a reflatten that only moves rows also re-lays them out; after this change it does not, which only removes work.
