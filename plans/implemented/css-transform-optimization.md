# CSS Transform for Hot-Path Motion + Header Horizontal Scroll Sync

## Context

The earlier DOM-access optimization pass eliminated redundant writes but the **kind** of CSS property being written still matters: `top`/`left` changes trigger layout + paint + composite, while `transform: translate3d(...)` runs only on the compositor thread. Three sites continuously move elements every frame and stand to benefit from switching to transforms:

1. **Virtualized table rows** ([Body.ts:243-282](src/typescript/Base/component/table/Body.ts#L243-L282)) — the codebase already documents at [Body.ts:32-35](src/typescript/Base/component/table/Body.ts#L32-L35) that the one-frame scroll flicker is caused by using `top: dataIndex * rowHeight` instead of a transform-based strategy.
2. **Virtualized tree rows** ([Tree.ts:485-552](src/typescript/Base/component/tree/Tree.ts#L485-L552)) — same pattern.
3. **Window dragging** ([Window.onDrag](src/typescript/Base/Window.ts#L288-L292)) — every mousemove writes `left`/`top`.

A separate latent issue surfaced during exploration: **the table header does not sync with horizontal scroll**. The body sets `overflow: auto`, so the browser scrolls horizontally natively, but column labels stay put while data slides — they desync. This is a feature gap, not a perf bug, but transform is the canonical fix (`transform: translateX(-body.scrollLeft)` on the header is composite-only).

The intended outcome: smoother scroll/drag with no behavior changes, plus the header now follows horizontal scroll.

---

## Core invariant: cached fields mirror DOM properties one-to-one

The plan introduces a second positioning channel (transform) **without** breaking the existing rule that every cached `Component` field matches the value the DOM actually holds for the corresponding property:

| Cached field | DOM property |
| --- | --- |
| `this.left` | `style.left` (pixels) |
| `this.top` | `style.top` (pixels) |
| `this.translateX` (new) | translate-X component of `style.transform` |
| `this.translateY` (new) | translate-Y component of `style.transform` |

**Visual position is intentionally NOT cached anywhere** — it is the sum `left + translateX`, `top + translateY` of two real, independently-observable CSS properties, and any caller who needs it must compute it. `getX()` / `getY()` continue to return only the `left` / `top` component (layout coordinate), matching their pre-change semantics so existing callers see no behavioral change. If a future caller needs visual position, they can either compute the sum or rely on `getBoundingClientRect()`, which already reports transform-translated coordinates.

The three hot-path call sites in this plan are designed so they never read a cached field expecting visual position:

- **Body.ts / Tree.ts row positioning** computes `targetY = dataIndex * rowHeight` from data, never from `row.getY()`.
- **Window.onDrag** uses local `_dragDX` / `_dragDY` accumulators for the in-progress delta. The cached `this.left` / `this.top` are not read between mousedown (where they are snapshotted into `_dragStartLeft` / `_dragStartTop`) and mouseup (where the accumulator is committed back to them).
- **Table header sync** writes `translateX = -scrollLeft`. Nothing currently reads `header.getX()` for a visual-offset purpose.

After every operation, the cached field equals the DOM property it tracks, with no exceptions.

---

## Phase 1 — `setTranslate` on Component

### [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts)
Add a new positioning channel that's independent of `setX`/`setY`. Visual position is `left + translateX, top + translateY`.

- Add private fields `translateX: number = 0` and `translateY: number = 0`.
- Add `getTranslateX()` / `getTranslateY()` getters.
- Add `setTranslate(x: number, y: number)`:
  - Equality short-circuit: `if (this.translateX === x && this.translateY === y && this.getElement()) return;`
  - Cache values, then write `transform: translate3d(x, y, 0)` via `setElementStyle("transform", ...)` (reuses existing `dirtyStyle` batching).
  - Special-case `(0, 0)`: write empty string to remove the property and the compositor layer.

This adds one method; `setX`/`setY` semantics are unchanged so static layout callers are unaffected.

---

## Phase 2 — Body.ts virtualized rows → `translateY`

### [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts)

In the row loop ([Body.ts:243-282](src/typescript/Base/component/table/Body.ts#L243-L282)):

- When growing the pool ([Body.ts:225-235](src/typescript/Base/component/table/Body.ts#L225-L235)), call `row.setY(0)` once for the new row so the row's `top` is at the baseline (rest of the offset comes from transform).
- Replace `row.setY(targetY)` with `row.setTranslate(0, targetY)`. **Keep** `row.setX(0)`, `row.setWidth(rowWidth)`, `row.setHeight(rowHeight)` — width/height aren't transformable.
- Update the `rowGeom` cache shape to track `{ ty: number, w: number, h: number }` (replace `y` with translate-Y). The geom-skip logic stays identical.

Cells are NOT changed — they're inside the row, positioned once per layout via `setX`. They don't move during scroll (they ride along with the parent row's transform), so transform offers no incremental benefit there.

**Risk:** if any caller reads `row.getY()` and expects the visual offset, it will get 0. Audit `getY()` callers on rows: search for `.getY()` within `Body.ts` / `Row.ts`. Likely no callers — the data-driven Y is computed from `dataIndex * rowHeight`, not read back from the row.

---

## Phase 3 — Tree.ts virtualized rows → `translateY`

### [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts)

Mirror Phase 2 in `_renderWindow` ([Tree.ts:485-552](src/typescript/Base/component/tree/Tree.ts#L485-L552)):
- Call `row.setY(0)` once when growing `_rowPool`.
- Replace `row.setY(targetY)` with `row.setTranslate(0, targetY)`.
- Update `_rowGeom` to track `ty` instead of `y`.

---

## Phase 4 — Window drag → transform during, commit on mouseup

### [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts)

Add three private fields: `_dragStartLeft: number = 0`, `_dragStartTop: number = 0`, `_dragDX: number = 0`, `_dragDY: number = 0`.

[Window.onMouseDown](src/typescript/Base/Window.ts#L176-L185):
- Capture `_dragStartLeft = this.getX(); _dragStartTop = this.getY(); _dragDX = 0; _dragDY = 0;` before registering the viewport listeners.

[Window.onDrag:288-292](src/typescript/Base/Window.ts#L288-L292):
- Replace `this.setX(getX() + movementX); this.setY(getY() + movementY);` with `this._dragDX += e.movementX; this._dragDY += e.movementY; this.setTranslate(this._dragDX, this._dragDY);`. Per-frame cost: one `setElementStyle("transform", ...)` instead of two `style.left/top` writes.

[Window.onMouseUp:294-297](src/typescript/Base/Window.ts#L294-L297):
- Before removing the viewport listeners, commit the position: `this.setX(this._dragStartLeft + this._dragDX); this.setY(this._dragStartTop + this._dragDY); this.setTranslate(0, 0);`. The transform reset frees the compositor layer once the drag ends.

**Risk:** the eight WindowBorder resize handles are positioned relative to the window. Transforms on a parent affect descendants visually — borders ride along correctly during drag, and `getBoundingClientRect` reports transformed coords so resize hit-testing on the borders still works. Resize during drag is not a real scenario (you're holding mouse on the title bar, not on a border), so no interaction concern.

---

## Phase 5 — Table header horizontal-scroll sync

### [src/typescript/Base/component/table/Table.ts](src/typescript/Base/component/table/Table.ts)

In `Table`'s init (after both `body` and `header` are constructed), install a body-scroll listener that pushes scrollLeft into the header via transform:

```
Event.addListener(this.body, "scroll", () => {
    const el = this.body.getElement();
    if (!el) return;
    this.header.setTranslate(-el.scrollLeft, 0);
});
```

The `setTranslate` equality guard prevents redundant writes when scrollLeft doesn't change (e.g., pure vertical scroll fires a scroll event but `scrollLeft` is unchanged).

**Risk:** the existing Body.ts scroll listener (Body.ts:175-178) calls `renderWindow()`. Adding a second listener on the same component is fine — `Event.addListener` supports multiple listeners per event type. The two run independently.

**Edge case:** the header's content width must extend beyond the visible header area for the translateX to do anything useful. Verify the header element's width matches the body's content width (sum of column widths, not viewport width). If the header is currently sized to viewport width only, columns past the right edge would be clipped after translateX. May require a small fix to header sizing in [Header.ts](src/typescript/Base/component/table/Header.ts).

---

## Critical files to modify

- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — Phase 1 (setTranslate)
- [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts) — Phase 2 (row Y)
- [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts) — Phase 3 (row Y)
- [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts) — Phase 4 (drag)
- [src/typescript/Base/component/table/Table.ts](src/typescript/Base/component/table/Table.ts) — Phase 5 (header sync)
- Possibly [src/typescript/Base/component/table/Header.ts](src/typescript/Base/component/table/Header.ts) — Phase 5 if header width needs fixing

## Existing primitives to reuse

- `setElementStyle` / `dirtyStyle` batching ([Component.ts:269-332](src/typescript/Base/Component.ts#L269-L332)) — `setTranslate` writes through this, so it batches alongside other style changes when `autoCommitStyle` is paused.
- `Event.addListener` ([Event.ts:130](src/typescript/Base/Event.ts#L130)) — for the body→header scroll wiring in Phase 5.
- `rowGeom` / `cellGeom` caching from the prior optimization pass — extends naturally; just rename `y` to `ty`.

## Order of execution (lowest-risk first)

1. **Phase 1** (setTranslate) — additive, no callers yet, zero risk.
2. **Phase 5** (header sync) — uses Phase 1 only on the header; if it works, validates setTranslate against a static-layout sibling.
3. **Phase 4** (Window drag) — isolated to Window.ts, easy to revert.
4. **Phase 2 & 3** (Body/Tree row Y) — most impactful but also most intertwined with the existing geom cache; do after setTranslate is shaken out.

## End-to-end verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the 9-error baseline.
2. **Capture baseline**: `bench.benchTableScroll()` from devtools (existing perf harness from the prior session).
3. **Demo-panel sweep** in `npm run dev`:
   - **[ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts)** — fast scroll the virtualized Table; the documented one-frame flicker should be gone. Sort, hide columns, resize columns: rows stay correctly positioned. Scroll horizontally if columns extend beyond viewport: header should now slide in lockstep with body.
   - **Tree** (whichever panel hosts it) — fast scroll, expand/collapse: row positions remain correct.
   - **Window dragging** — drag a window across the screen; movement is smoother (compositor-only). Release: window stays where dropped, doesn't snap. Subsequent layout passes (e.g., resize handle drag) operate from the new committed left/top.
   - **MultiSelectListPanel.ts**, **MenuBarPanel.ts**, **AccordionPanel.ts** — no transform interaction expected; smoke-test for regressions in case `setElementStyle("transform", ...)` collides with anything.
4. **Re-run perf harness**, compare frame times against baseline. Expectation: `benchTableScroll` mean frame time drops noticeably and max frame time (worst-case stutters) drops more.
5. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after the implementation lands.
