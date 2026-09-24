# G22 — can a transform keep the body in step with the header?

Offline investigation, 2026-09-24, opened by the blocker
[`00-post-campaign-agenda.md`](00-post-campaign-agenda.md) records under *G22
unblocked: the tree table's focused cell*: the settle relay is a measured win
(103.02 → 81.58 ms per resize frame, work −92.4%) that the user rejected on
sight, because the body cells hold still while the header moves and snap into
line only on release. The question put here is whether the body can keep up
without paying for a per-cell layout — moving each cell with
`Component.setTranslate` during the burst and reconciling on the settle.

| | |
|---|---|
| Method | Throwaway `vitest` probes in `packages/lib/tests/component/table`, `installTestDOM` + a captured `requestAnimationFrame`, the idiom of `EditAcrossRowRebind.test.ts` / `ColumnResize.test.ts`. Every probe file is deleted; the working tree carries only this document |
| Arms | The three deferral shapes are simulated by patching `Cell.prototype.applyBounds` and wrapping the body's `renderWindow` exactly as `g22SettleRelay` does (`packages/qa/src/harness/ablations.ts:1804`), each patch installed and removed per run so no wrapper leaks between arms |
| Work proxy | The same eight `Component` methods `work=1` wraps (`packages/qa/src/harness/counters.ts`, `BASE_WORK_METHODS` plus `beginSizeHintRecord` / `getLaidOutComponents`), counted offline. It counts calls, not milliseconds |
| Geometry | `ModelledDOMSource.getElementRect`, which composes a handle's rect from the inline `left` / `top` / `width` / `height` / `transform` the sink actually recorded — so a translate is part of the rect and a cached-but-unwritten value is not |
| Not done | Nothing was run in an engine. No `runqa.sh`, no sweep, no MiniBrowser, no Tauri host |

Every figure below is per drag frame, from a probe that ran in this session.

## 1. What a column resize actually moves

### The blocker names one driver; the measurement used another

`g22.settle-relay` does not know what moved the widths. It gates on
`renderWindow(bodyWidth, columnWidths)` reporting that the body width or any
column width differs from the last pass — `updateColumnWidthCache`'s own test
(`component/table/Body.ts:1275`). Two very different gestures reach it:

- a **column-handle drag**, `Table.onColumnResize` (`component/table/Table.ts:2173`);
- a **table-width resize**, `layout/Table.rescaleWidths` (`layout/Table.ts:478`).

The cell that measured G22 is `ttr`, `panel=treetable-rows&drive=resize`, and
the QA `resize` driver is the second one: it re-lays the panel out at a new
width every frame (`packages/qa/src/harness/drivers.ts:256`, "window-resize
stand-in"). The agenda's own record names those runs — five, prefix
`g22r-ttr-` — as both the source of the 103.02 → 81.58 ms reading *and* the
runs the user was watching when the body lagged its header. So the measured
win and the by-eye rejection are both about a **pane/window resize of the
table**, not a handle drag, although the agenda's prose calls it a column
resize. Both gestures end in the same loop, so both are answered here:

```
cells[slot].applyBounds(x, 0, colW, rowHeight);   // component/table/Body.ts:1474
```

Every rendered cell is re-placed every frame, at an absolute content x
accumulated from the column window's `lefts`/`widths`. The header does the
same, one band up (`component/table/Header.ts:1641`, `positionColumnCells`).

### A column-handle drag: two columns resize, the rest translate — or don't move at all

`onColumnResize` splits the visible columns into a left chain
`[colIndex … 0]` and a right chain `[colIndex+1 … n-1]`, each nearest-first,
and hands this frame's travel to `distributeDragChain` (`core/DragChain.ts:72`),
which fills the nearest entry to its bound before spilling to the next.

Probe: six `string` columns, `minWidth` 60, a 900 px table, starting widths
`[180,160,140,130,120,110]` rescaled by the layout to
`[189.86, 168.76, 147.67, 137.12, 126.57, 116.02]`; drag the edge of column 1
by 6 px a frame for 30 frames. Per frame, per column — `W` width only,
`X` position only, `B` both, `.` still:

| Frames | Pattern | What it means |
|---|---|---|
| 1–14 | `.WB...` | column 1 grows, column 2 shrinks by the same amount. Nothing else moves at all |
| 15 | `.WBBXX` | column 2 reaches its 60 px floor; the spill starts |
| 16–27 | `.WXB..` | column 2 is pinned at its floor and now only translates; column 3 absorbs |
| 28–30 | `.WXXB.` | column 3 floors in turn |
| census | `W` 30, `B` 32, `X` 19, still 99 | over 180 column-frames |

Past the point where the right chain is exhausted the table grows instead
(`Table.ts:2216`, `absorbed`), and the picture inverts — a second probe drove
the edge 400 px right first, then 6 px a frame:

| Frames | Pattern | Census over 90 column-frames |
|---|---|---|
| 1–15 | `.WXXXX` | `W` 15, `X` 60, still 15, `B` 0 |

So: **at most two columns change width in any one frame** — the nearest
growable on the dragged side and the nearest shrinkable on the other — and
every other column that moves at all is a pure translation. But in the
ordinary "the table still fits" regime the two that change width are *the
only two that move*, and there is nothing to translate.

Per cell, with a 25-slot row pool over 23 displayed rows and six columns
(138 `applyBounds` calls a frame):

| Regime | unchanged | x only (translatable) | width changed |
|---|---|---|---|
| fits, frames 1–14 | 92.0 | 0.0 | 46.0 |
| fits, 30-frame mean | 75.9 | 14.6 | 47.5 |
| grown | 23.0 | 92.0 | 23.0 |

### A table-width resize: the flex columns resize, the pinned ones translate

`rescaleWidths` holds a column at its current width when `isFixedColumn`
says so — type `boolean`, `number` or `date`, or `preserveWidth`
(`layout/Table.ts:565`) — and rescales every other column by
`newFlexTotal / prevFlexTotal`, then clamps it to its own min/max.

Probe: `treetable-rows`' own four columns — `name` (string, `minWidth` 200),
`size` (number), `modified` (datetime), `kind` (string) — over 300 records in
a 1200 px `TreeTable`, narrowed 8 px a frame for 30 frames. Starting widths
`[530, 40, 86, 530]`:

| Column | Type | Behaviour | Why |
|---|---|---|---|
| `name` | string | **`W`** — width shrinks, x stays 0 | flexible, rescaled |
| `size` | number | `X` — pure translation | `isFixedColumn` |
| `modified` | datetime | `X` — pure translation | flexible in principle, but clamped at its 86 px type floor for the whole burst |
| `kind` | string | **`B`** — both | flexible, and every column left of it moved |

Census over 120 column-frames: `W` 30, `X` 60, `B` 30, still 0. Per cell, 92
`applyBounds` calls a frame (23 rows × 4 columns), every frame:

| unchanged | x only | width changed |
|---|---|---|
| 0.0 | 46.0 | 46.0 |

**Answer to question 1: both, and the split is knowable per column.** A
column whose width changes cannot be faked with a translate; a column that is
merely pushed sideways can. Under a table-width resize that is a clean
half-and-half on the very panel G22 was measured on. Under a handle drag it is
0% translatable while the table fits, and 80% once the table has grown past its
viewport. What the transform can *never* fake is the dragged column itself —
in every regime of every driver, the column under the pointer is a width
change.

## 2. What a cell's content does under a transform

Nothing in `component/table` reads a live rectangle during a resize. The one
`getBoundingClientRect` in the whole directory is
`Header.ts:716`, for the header's own menu button, outside any drag.

| Surface | Under a transform on the cell | Evidence |
|---|---|---|
| Renderer placement | Correct. `Cell`'s `Card` layout and `CellRenderer`'s `Fit` place children from `getContentBounds()`, which is `getInnerSize()` + `getContentInsets()` — cached fields, no DOM read (`core/Component.ts:4121`) | read |
| Text truncation | Correct **while the cell's width is unchanged**. `Text` defaults to `truncate: true` → `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (`component/input/Text.ts:75`, `setTruncate`), clipped at the Text element's own written width. A transform does not move that clip point, and does not need to | read |
| Tree indent and toggle | Correct. `TreeCellRenderer.doLayout` places the toggle at `box.x + depth * indentPx` and the delegate at `box.x + indent + TOGGLE_WIDTH` — all relative to the cell's content box, all carried by the transform. There are no indent *guides* (no vertical rules) to break | `component/table/cell/renderer/TreeCell.ts` |
| Open cell editor | Correct. `Cell.startEdit` parents the borrowed editor with `addComponent`, so it is inside the transformed subtree; `alignEditorWithContent` reads `getContentBounds()`, not the DOM | `cell/Cell.ts` |
| A picker the editor anchors | Correct. Anchoring goes through `DOM.source.getViewportRect`, which is `getBoundingClientRect` in production (`core/DOM.ts:2507`) and therefore transform-aware | read |
| Focus outline | Correct. `_updateFocusStyle` toggles the shared `.Cell.focused` class rule (`Body.ts:2572`); an `outline` follows the element's rendered box | read |
| Pointer hit-testing | Correct. `onSubtreeClick` and `onCellDragMove` resolve from `e.target`, the engine's own hit test, which honours transforms | `Body.ts` |
| The transform slot itself | Free. A `Cell` writes no `transform` of its own — the only `setTransform` in the table is on a header cell's *glyph* (`cell/Header.ts:377`). Rows use their translate for `y` (`VirtualRowView.ts:436`), the header's three inner rows use theirs for scroll-x (`Header.ts:1695`), and the body's scroll lives on the `VirtualScroller` rows container (`container/VirtualScroller.ts:462`) — three different elements, no composition conflict | read |

The one thing that does *not* survive is a **stale width**: the ellipsis clip
point, a right-aligned value (`NumberRenderer` is `text-align: right` by
default, `cell/renderer/Number.ts`), and the cell's own box all follow the
written width, not the transform. A cell's default background is
`var(--ts-ui-table-cell-bg, transparent)` and its default border is `none`
(`cell/Cell.ts:40`), so an over-wide cell does not paint over its neighbour —
but its *text* is clipped at the old, wider boundary, so a shrinking column's
truncated text spills into the column beside it. That matters only for the
variant in §5 that leaves widths stale on purpose.

## 3. Does the settle land pixel-identical?

Yes, on every arm tested. Three-arm probe, each arm a fresh table and a fresh
DOM, driven through the identical burst, compared cell by cell on the rect
`getElementRect` composes from what was actually written:

| Driver | Arm | Mid-burst vs live | After the settle vs live |
|---|---|---|---|
| width resize | plain defer | 66 of 100 cells mis-positioned, worst 116 px; 44 stale in width | **0 differences** |
| width resize | translate the width-stable cells | **0 differences** | **0 differences** |
| width resize | translate every cell | position exact; 44 stale in width, worst 116 px | **0 differences** |
| column drag | plain defer | 66 of 150 mis-positioned, worst 174 px; 88 stale in width | **0 differences** |
| column drag | translate the width-stable cells | **0 differences** | **0 differences** |
| column drag | translate every cell (delta pre-rounded) | position exact; 88 stale in width, worst 174 px | **0 differences** |

The settle is `VirtualRowView.flushResizeSettle` (`component/shared/VirtualRowView.ts:573`)
unchanged: `invalidateGeom()` then `renderWindow()`, with the deferral gate now
closed, so every cell takes the real `applyBounds` path. This reproduces
offline what the agenda recorded in engine (converges within two idle frames,
lands on the plain arm's exact width).

Two things the probes found that a plan must carry:

**The transform must be cleared unconditionally, not on the branch that
writes.** `Cell` opts into the unchanged-geometry skip
(`canSkipUnchangedLayout`, `cell/Cell.ts:256`), so a settle that re-places a
cell at the rectangle it already holds writes nothing at all. Probe: park a
translate of 37 px on a pooled cell, then call the real
`Component.applyBounds` with the cell's current rectangle — the translate is
still 37 afterwards and the element's composed rect has not moved. Any burst
that ends where it began (an out-and-back drag, a pane resized back to its
starting width) strands every cell's translate permanently unless the clear
runs before the rectangle comparison.

**Rounding.** `setX` writes `Math.round(left)` and `setTranslate` writes
`translate3d(Math.round(x), …)` (`core/Component.ts:4887`, `5228`), so the
composed position of a translated cell is
`round(x₀) + round(x − x₀)`, which is not `round(x)` in general. Census over
a 60-frame burst: **38.1% of 5,192 translate writes** in the width resize and
**7.1% of 7,788** in the column drag land 1 device pixel from where the live
arm puts them. Passing the delta pre-rounded — `Math.round(x) - Math.round(x₀)`
— removes it exactly: the column-drag arm goes from 22 cells off by 1 px to 0,
with no other change. The library needs no change for this; the caller just
must not hand `setTranslate` a fractional delta.

**Cell recycling mid-burst is real and is already handled by that formula.**
On a 40-column table the column window slides during a burst — 22
`setColumnWindow` changes over a 40-frame column drag, 88 over a width resize,
and with the body scrolled to x = 1500, 88 changes carrying **88 retargeted
cells** onto different columns. Because the translate is recomputed from the
cell's *committed* x on every deferred pass rather than accumulated, a
recycled cell lands in the right place on the very next frame. A scheme that
accumulated deltas would not.

## 4. What it costs

Same probes, work counted with the `work=1` method set. `live` is the
unmodified library.

### Table-width resize (`treetable-rows`, the `ttr` driver)

| Arm | work / frame | Δ vs live | style writes / frame | settle work (once) | translate calls / frame |
|---|---|---|---|---|---|
| live | 2,626.0 | — | 481.2 | 0 | — |
| plain defer (G22 as measured) | 428.8 | **−83.7%** | 98.4 | 2,377 | — |
| translate only the width-stable cells | 1,732.8 | −34.0% | 438.6 | 1,028 | 42.5 |
| translate every cell | 428.8 | **−83.7%** | 162.2 | 2,377 | 85.1 |

### Column-handle drag (six string columns, table still fits)

| Arm | work / frame | Δ vs live | style writes / frame | settle work (once) | translate calls / frame |
|---|---|---|---|---|---|
| live | 1,542.0 | — | 316.8 | 0 | — |
| plain defer | 340.8 | **−77.9%** | 26.4 | 1,946 | — |
| translate only the width-stable cells | 1,264.8 | −18.0% | 304.3 | 560 | 83.6 |
| translate every cell (pre-rounded) | 340.8 | **−77.9%** | 60.1 | 1,946 | 127.6 |

Read against the in-engine record — 12,335 → 943 work units per resize unit,
−92.4% — the offline proxy reproduces the deferral's shape at a smaller
absolute (this fixture is 300 records against the panel's 2,600) and a
slightly smaller ratio, −83.7%. It is a call count, not a time, and is used
here only to rank the arms against each other inside one fixture.

**Transform writes against skipped `applyBounds` calls.** Translating every
cell issues 85.1 `setTranslate` calls a frame in the width resize and 127.6 in
the column drag, of which 63.8 and 33.7 respectively survive
`setTranslate`'s own unchanged-value guard (`core/Component.ts:5206`) and reach
the DOM as one composed inline `transform` declaration each — against 92 and 138 `applyBounds` calls whose
`doLayout` the deferral skips. So the trade is roughly **one inline transform
declaration per cell per frame in place of one full cell layout pass**, and the
`work` counter does not move at all: `setTranslate` reaches
`writeTransform` → `setElementStyle` and never touches `scheduleLayout` or
`doLayout` (`core/Component.ts:5201`, `5249`).

## 5. The two shapes of the idea, and which one works

**Shape A — translate only the cells whose width is unchanged, lay out the
rest for real.** Pixel-exact mid-burst, on both drivers, with no stale
anything: the probes show 0 differences against the live arm at every frame
sampled. But it keeps only **34.0%** of the deferral's saving on the width
resize and **18.0%** on the column drag, because the columns that move are
largely the columns that resize — and on a handle drag in the ordinary regime
they are *entirely* the columns that resize, so for the first fourteen frames
of that probe Shape A is the live arm exactly. Shape A is correct and
worth almost nothing.

**Shape B — translate every cell to its target x and let its width stay
stale until the settle.** Work per frame is **identical to the plain
deferral's** (428.8 and 340.8, to the tenth), style writes rise by 63.8 and
33.7 a frame, and the body's columns sit at *exactly* the x the live arm puts
them at — which is the thing the user rejected the deferral for. What is left
stale is each resizing column's own width: 44 of 100 cells by up to 116 px on
the width resize, 88 of 150 by up to 174 px on the column drag. Visually that
is (a) a truncated string clipping at the old, wider boundary — so a shrinking
column's text spills over the next column's left edge — and (b) a
right-aligned value hugging a stale right edge, which under `rescaleWidths`
cannot happen (number columns are `isFixedColumn`) but under a handle drag
directly on a number column can.

Shape B is what the question was really asking for, and it is not the shape
the question proposed.

## Recommendation

**Promising, and one in-engine measurement decides it.** Shape B — translate
every body cell during the burst, clear the transforms and apply real bounds
on the settle — costs the same work per frame as the deferral the engine
already measured at 103.02 → 81.58 ms, keeps the body's columns pixel-exact
under their headers throughout the drag, and settles bit-identically to the
live arm. Offline it has no correctness failure. What offline cannot answer is
the two things that decide it:

1. **Do 64–128 extra inline `transform` writes a frame cost anything in
   WebKitGTK, and does promoting a hundred-odd `<td>` elements onto their own
   compositor layers for the length of a drag cost paint?**
   `motion-transform-inline` proved an inline transform write is cheap
   (`97-w3-implementation-measurement.md`, `dgp` −36.20 ms) — but at one write
   per frame, not eighty-five, and on one element, not a hundred.
   *The cell to run: `ttr`, `panel=treetable-rows&drive=resize,idle:4`, the
   same parameters as the `g22r-ttr-` runs of 2026-09-24, with a fourth arm
   added to `ablations.ts` beside `g22.settle-relay` that writes
   `setTranslate(Math.round(x) - Math.round(cell.getX()), 0)` in place of the
   early return. The counters that settle it: frame ms in the resize phase
   against both the plain and the `g22.settle-relay` arms; `work` per unit
   (it should land on the settle-relay arm's 943, not between it and 12,335);
   `writes` per unit (expect the settle-relay arm's plus ~60 per unit); and
   `apply` per unit, which is where a compositor cost would *not* show — so
   the frame time against the settle-relay arm is the whole question. If the
   new arm reads within its own bracket of `g22.settle-relay` on ms, Shape B
   is free and the plan is a formality.*

2. **Is the stale width acceptable to the eye?** Only the user can answer
   that, and the same run answers it for them: watching the new arm shows a
   body whose columns track their headers exactly, with the resizing column's
   text clipping at the wrong point until release. That is a strictly smaller
   defect than the one that blocked G22, but it is a defect, and it is the
   same live-versus-outline judgement `drag-resize-outline-mode` put to them
   one layer up.

If both come back clean, a plan would have to cover:

- **Where the translate is written.** `Body.bindAndPositionRows`
  (`Body.ts:1474`) is the one loop; the deferral flag belongs beside
  `Tree`'s (`component/tree/Tree.ts:2180`), so `Body` starts calling
  `VirtualRowView.deferRowLayoutWhileResizing` the way `Tree` already does.
  The separator row's single cell (`Body.ts:1420`) is the same call and needs
  the same treatment.
- **The unconditional clear**, ahead of the rectangle comparison, on every
  path that re-places a cell — the settle, a rebind, a column-window slide,
  and `Row`'s park/restore of a cell filed by key. §3 shows why a clear gated
  on "the rectangle changed" strands a translate forever.
- **The pre-rounded delta**, `Math.round(x) - Math.round(cell.getX())`, which
  is the difference between exact and a 1 px jitter on 38% of writes.
- **The header.** It is not deferred today and does not need to be, but a plan
  should say so explicitly, since header and body now agree only because the
  body is translating to the header's own geometry.
- **The gate.** The agenda already records that G22's geometry gate must read
  the settled state, not every unit of the burst. Under Shape B the *positions*
  are gateable mid-burst too — only the widths are not — which makes for a
  sharper criterion than "compare after the settle": `x` equal on every unit,
  `width` equal on the settle's last unit.
- **Whether it is the default or an opt-in.** `Body.setResizeMode` is the
  precedent; a stale ellipsis is a smaller defect than a frozen body, but it is
  still a behaviour change to the default drag.

The remaining risk, if it ships: a compositing regression that only a real
WebKitGTK recording shows — a hundred simultaneously-transformed `<td>`
elements is the one part of this that has no precedent anywhere else in the
library.

**What is not worth planning** is the shape the question proposed —
translating only the cells whose width does not change. It is exactly correct
and buys 34% of the saving on a pane resize, 18% on a handle drag, and nothing
at all in the first half of an ordinary column drag, because the columns a
drag moves are the columns a drag resizes.

## The in-engine run this investigation asked for (2026-09-24)

Run on `3c324f59`, prefix `g22t-ttr-`, `panel=treetable-rows&drive=resize,idle:4`,
seven runs: three plain arms bracketing one run of each candidate. The fourth
arm is Shape B, added to `ablations.ts` beside `g22.settle-relay` in a scratch
worktree and not committed: during a burst it writes
`setTranslate(round(x) − round(getX()), 0)` in place of the early return, and
clears every cell's translate unconditionally on the settle pass.

| Arm | Resize frame | Work/unit | Writes/unit |
|---|---|---|---|
| plain (bracket 5.60) | 107.09 ms | 12,335.37 | 1,721.7 |
| `g22.settle-relay` | 83.43 ms (−23.66) | 942.92 | 152.4 |
| `g22.transform-relay` | 83.94 ms (−23.15) | 942.92 | 474.3 |

**Shape B is free.** It lands 0.51 ms from the deferral, inside the plain arms'
own 5.60 ms bracket, so promoting roughly 85 cells onto transforms for the
length of a burst costs nothing measurable in WebKitGTK, and its work per unit
is the deferral's to the digit. The 322 extra writes per unit are the
translates themselves. Question 1 of the investigation is answered: the body
can track its header at the deferral's full saving.

Two things the run did not answer. The `table`, `body` and `header` geometry is
identical in all seven runs, unit for unit (5117 → 4895 at the midpoint → 5120
settled), but the cell-level `focused` probe voids the cell as `unstable`
again — the tree table's known non-determinism, which `qa-panel-determinism`
owns, and which has now blocked a third measurement. And the stale-ellipsis
judgement still needs a **column-handle drag**, which no driver performs: the
`resize` driver resizes the whole table (`drivers.ts:256`), so what a viewer
sees on this cell is the table narrowing and widening, not a column being
dragged. That driver belongs with the QA surfaces work.
