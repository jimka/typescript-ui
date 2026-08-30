---
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts, packages/lib/src/typescript/lib/layout/LayoutManager.ts]
---

# Layout Manager Clamp Precedence and Coordinate Rounding — Implementation Plan

## Overview

Two independent correctness bugs sit in the code that turns a layout manager's arithmetic into a painted box. Both are fixed here, each with its own regression test.

The first is a clamp-precedence bug in [`LayoutManager.resolveBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L382). Its size clamp is an `if / else if` ladder at [`LayoutManager.ts:418-422`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L418) and [`:444-448`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L444), so a child's maximum wins whenever its minimum is larger. Everywhere else the minimum wins — `plans/implemented/box-child-clamp-ordering.md` established that rule and fixed three managers, but missed `resolveBounds`, the one method every layout manager sizes a child through, whether it calls `resolveBounds` directly or goes via [`placeComponent`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L355).

The second is a rounding bug in [`Component`](packages/lib/src/typescript/lib/core/Component.ts). `setX` / `setY` / `setWidth` / `setHeight` each round their own value independently ([`:4007`](packages/lib/src/typescript/lib/core/Component.ts#L4007), [`:4043`](packages/lib/src/typescript/lib/core/Component.ts#L4043), [`:3842`](packages/lib/src/typescript/lib/core/Component.ts#L3842), [`:3946`](packages/lib/src/typescript/lib/core/Component.ts#L3946)), so at fractional coordinates a component's painted right edge and its neighbour's painted left edge can land 1px apart — a visible seam between two boxes the layout placed flush. The fix derives each extent from two rounded edges instead. A third, smaller change corrects the doc comment in the same region, which claims a *device*-pixel rounding the code does not do.

---

## The two rules

**Rule 1 — when a child's minimum exceeds its maximum, the minimum wins.** Apply the maximum first, the minimum last.

| min | max | requested | Today (`else if` ladder) | After |
|---|---|---|---|---|
| 40 | 200 | 120 | 120 | 120 |
| 40 | 200 | 10 | 40 | 40 |
| 40 | 200 | 900 | 200 | 200 |
| **120** | **47** | 100 | **47** | **120** |

Only the last row moves; the first three are the ordinary `min ≤ max` cases where both orderings agree.[^only-degenerate]

**Rule 2 — round the edges, not the position and the extent separately.** A box's painted origin is `round(x)` and its painted extent is `round(x + width) − round(x)`, so its far edge lands exactly on `round(x + width)` — which is where the next box's rounded origin lands.

Three equal-weight children in a 400px row (`x = 0`, `133.33`, `266.67`, each `133.33` wide):

| child | `left` / `width` today | painted span today | `left` / `width` after | painted span after |
|---|---|---|---|---|
| a | 0 / 133 | 0 – 133 | 0 / 133 | 0 – 133 |
| b | 133 / 133 | 133 – **266** | 133 / 134 | 133 – 267 |
| c | 267 / 133 | **267** – 400 | 267 / 133 | 267 – 400 |

Today a 1px gap opens between `b`'s right edge and `c`'s left edge. After the change every edge meets its neighbour and the row still ends on 400.[^measured-row]

---

## Architecture Decisions

### `resolveBounds` adopts the max-then-min ordering the box managers already use

Split the two `if / else if` ladders into two independent `if` statements, so the maximum caps first and the minimum floors last.[^min-is-floor] This mirrors [`HBox.resolveChildWidth`](packages/lib/src/typescript/lib/layout/HBox.ts#L649) (`Math.min` against the maximum, then `Math.max` against the minimum), its `VBox` twin at [`VBox.ts:607`](packages/lib/src/typescript/lib/layout/VBox.ts#L607), [`FlowLayout.clampedPreferredSize`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L406), and [`Component.clampWidth`](packages/lib/src/typescript/lib/core/Component.ts#L3892), which the committed size already goes through.

### One shared helper derives every rounded extent

Add a module-level `roundedExtent(origin, extent)` function to `Component.ts` and two private methods, `writeHorizontalGeometry` / `writeVerticalGeometry`, that write an axis's position and extent together from the cached fields. Every geometry write routes through them.[^one-write-path]

Writing both properties together is what makes the rule hold: a component's rounded width depends on its own `left`, so a move that leaves the width unchanged still has to re-emit the width.[^move-rewrites-width]

### The rounding stays CSS-pixel; the doc comment is corrected to say so

`Math.round` on a CSS-pixel value snaps to a whole CSS pixel. Keep that behaviour and fix the five `@remarks` blocks that call it device-pixel rounding.[^css-not-device]

### `setSize` joins the shared write path

[`setSize`](packages/lib/src/typescript/lib/core/Component.ts#L3689) writes `width` / `height` unrounded today, bypassing the rounding entirely. Route it through the two new methods so a component sized through it paints the same box as one sized through `setWidth` / `setHeight`.[^setsize-inconsistent]

---

## Implementation

The module-level helper, placed beside `formatSizeAttr` at [`Component.ts:297`](packages/lib/src/typescript/lib/core/Component.ts#L297). A `NaN` origin means "never positioned", and treating it as 0 reproduces the plain `Math.round(extent)` the code writes today:

```typescript
function roundedExtent(origin: number, extent: number): number {
    const start = Number.isNaN(origin) ? 0 : origin;

    return Math.round(start + extent) - Math.round(start);
}
```

The two private methods, placed directly after `setY`. Each guards both fields independently, because either can still be `NaN`:

```typescript
private writeHorizontalGeometry(): void {
    if (!Number.isNaN(this._left)) {
        this.setElementStyle("left", Math.round(this._left) + "px");
    }

    if (!Number.isNaN(this._width)) {
        this.setElementStyle("width", roundedExtent(this._left, this._width) + "px");
    }
}

private writeVerticalGeometry(): void {
    if (!Number.isNaN(this._top)) {
        this.setElementStyle("top", Math.round(this._top) + "px");
    }

    if (!Number.isNaN(this._height)) {
        this.setElementStyle("height", roundedExtent(this._top, this._height) + "px");
    }
}
```

Both methods write through `setElementStyle`. Their source values are the already-cached `_left` / `_top` / `_width` / `_height` fields, which makes them the "flush whose source values are cached elsewhere" caller ARCHITECTURE.md permits, not a new uncached write site.

---

## Ordered Implementation Steps

Tests come before the fix they cover, per the project's test-first rule. Steps 1-3 (the clamp) and steps 4-6 (the rounding) are independent; do them in this order.

1. **Create `packages/lib/tests/component/layout/LayoutManager.resolveBounds.test.ts`** with clamp cases C1-C3 from `## Expected Behaviour`. Model the file on [`LayoutManager.commitBounds.test.ts`](packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts) — same `CONFIG` bag, same `Container` host helper (the host must be a `Container` with a materialised element and cleared insets, or `doLayout` collapses). Run it: C1 and C3 fail, C2 passes.
2. **Fix `packages/lib/src/typescript/lib/layout/LayoutManager.ts`.** In `resolveBounds`, turn the `else if` at line 420 into a separate `if`, and the same at line 446, so each ladder becomes "cap to `maxSize`, then floor to `minSize`". Change nothing else in the method. Update the method's docblock (lines 361-381) to state that the minimum wins when a child's minimum exceeds its maximum, matching the wording already on `HBox.resolveChildWidth`.
3. **Re-run the file from step 1** — all three cases pass.
4. **Create `packages/lib/tests/component/geometry-edge-rounding.test.ts`** with rounding cases R1-R4. Read the recorded inline styles the way [`Component.test.ts:636`](packages/lib/tests/component/Component.test.ts#L636) does: filter `sink.writes` for `w.op === 'apply' && w.args[0] === handle` and read `(w.args[1] as { style?: Record<string, string> }).style`. Run it: all four cases fail.
5. **Fix `packages/lib/src/typescript/lib/core/Component.ts`** — add `roundedExtent` and the two private methods from `## Implementation`, each with a doc comment in the file's existing style (`formatSizeTerm` a few lines above is the model), then route all six write sites through them:
   - `setWidth` (line 3842) → `this.writeHorizontalGeometry();`
   - `setHeight` (line 3946) → `this.writeVerticalGeometry();`
   - `setX` (line 4007) → `this.writeHorizontalGeometry();`
   - `setY` (line 4043) → `this.writeVerticalGeometry();`
   - `setSize` (lines 3701-3704) → replace the `setElementStyles` call with `this.writeHorizontalGeometry(); this.writeVerticalGeometry();`
   - `replayGeometryStyles` (lines 6074 and 6086) → keep the `this._inlineStyle.set(...)` calls and the `NaN` guards, but take the value from `roundedExtent(this._left, this._width)` / `roundedExtent(this._top, this._height)`.
6. **Re-run the file from step 4** — all four cases pass.
7. **Correct the documentation** in `Component.ts`. Rewrite `setX`'s `@remarks` (lines 3990-3993) to describe CSS-pixel rounding and the edge derivation, and keep its existing sentence that `getX()` returns the exact value passed in. Update the four `see {@link setX}` cross-references at lines 3825, 3929, 4028 and 4228 to say **CSS** pixel. Add one matching `@remarks` line to `setSize`, which is newly rounded.
8. **Grep checkpoints**, all in `packages/lib`:
   - `grep -n "device pixel" src/typescript/lib/core/Component.ts` — expect zero matches.
   - `grep -n "Math.round(this._width)\|Math.round(this._height)" src/typescript/lib/core/Component.ts` — expect zero matches (every extent now comes from `roundedExtent`).
   - `grep -n "else if (minSize" src/typescript/lib/layout/LayoutManager.ts` — expect zero matches.
9. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Create | `packages/lib/tests/component/layout/LayoutManager.resolveBounds.test.ts` |
| Create | `packages/lib/tests/component/geometry-edge-rounding.test.ts` |

---

## Expected Behaviour

Every case below is unit-testable offline; none needs a browser. The numbers were measured against the current code and against a working prototype of this plan's changes.[^measured-cases] One thing the harness cannot see is whether a seam is actually *painted*; `## Verification` carries the manual check for that.

### Clamp cases

The host in C1 and C2 is a `Container` 400×200 with cleared insets, laid out by a `Fit` whose fill is set to `FillType.NONE` — the shortest route into the clamp this plan fixes.[^why-fit]

**C1 — a child whose minimum exceeds its maximum is placed at its minimum.** Child: `preferredSize` 100×30, `minSize` 120×120, `maxSize` 47×47. It must be placed at `x = 140`, `y = 40` — the centre position for a 120×120 box in a 400×200 cell. Today it is placed at `x = 176.5`, `y = 76.5`, the centre position for a 47×47 box.

**`getWidth()` and `getHeight()` read 120 either way and are not a valid assertion for this case.** `commitBounds` hands the resolved rect to `setWidth` / `setHeight`, whose own `clampWidth` / `clampHeight` already floor to the minimum. The child's *position* is what the clamp bug moves, because the anchor displacement is computed from the wrong width.

**C2 — an ordinary child is untouched (control).** Same host, child `preferredSize` 100×30, `minSize` 40×20, `maxSize` 200×60. Placed at `x = 150`, `y = 85`, sized 100×30, before and after.

**C3 — the same fix reaches a flow cell.** An `HFlow` with `componentSpacing` 0 in the same 400×200 host, holding the C1 child followed by a plain 50×16 sibling. The degenerate child must be placed at `x = 0`, `y = 0` (its 120×120 cell exactly fits it); today it sits at `x = 36.5`, `y = 36.5` and overflows its own cell. The sibling stays at `x = 120` in both cases.

### Rounding cases

**R1 — two adjacent boxes at fractional coordinates paint edge to edge.** Two components with materialised elements: `a.setX(0.4)`, `a.setWidth(10.4)`, then `b.setX(10.8)`, `b.setWidth(10.4)`. The recorded inline styles must be `a: left 0px, width 11px` and `b: left 11px, width 10px`. `a`'s right edge (`0 + 11`) equals `b`'s left edge (`11`) — no gap, no overlap. Today `a` is written `width 10px`, leaving a 1px gap.

**R2 — a real layout pass keeps a weighted row seam-free.** An `HBox` with `componentSpacing` 0 in a 400×40 `Container` host, three children each carrying `weight: 1`. Recorded widths must be `133`, `134`, `133` at lefts `0`, `133`, `267`. Today all three are written `133`, opening a 1px gap before the third child.

**R3 — a position-only move re-derives the width.** A component with a materialised element: `a.setX(0.6)`, `a.setWidth(10.4)` — recorded as `left 1px, width 10px`. Then `a.setX(0.4)` alone must emit **both** `left 0px` and `width 11px`, putting the right edge on `round(0.4 + 10.4) = 11`. Today the move emits only `left 0px`, the stale `width 10px` stands, and the right edge lands on 10.

Assert the merged recorded style rather than a write count: `setX` and `setWidth` each write both properties, so the same value can legitimately be recorded twice in one sequence.

**R4 — the render replay agrees with the setter.** A component whose `setX(0.4)` / `setWidth(10.4)` ran *before* it had an element must, at its first `getElement(true)`, replay `left 0px, width 11px` — the same pair the setter path writes. Today the replay writes `width 10px`. This pins `replayGeometryStyles` to the shared derivation.

### Documentation

**D1 — no behaviour, one check.** `npm run docs:api` finishes with zero warnings after the `@remarks` rewrite.

---

## Verification

All commands run in `packages/lib` unless stated.

- `npm run typecheck`.
- `npx vitest run tests/component/layout` — the layout suite, where a cell-sizing regression surfaces first.
- `npx vitest run tests/component/geometry-edge-rounding.test.ts tests/component/layout/LayoutManager.resolveBounds.test.ts` — the two new files.
- `npx vitest run` — the full library suite. Both changes sit under every component in the framework, so a green layout suite alone is not enough. Expect 5804 tests passing, plus the new cases.[^suite-green]
- `npm run lint`.
- `npm run docs:api` — zero warnings.
- `npx vitest run` in `packages/docs`. In a fresh worktree this needs `npm run docs:api` in `packages/lib` first, or four of its eleven files fail on a missing TypeDoc tree before running any assertion.[^docs-prereq]
- **Manual, in the demo app.** Rounding changes are visual and the offline harness cannot see paint. Run `npm run dev` in `packages/lib` (http://localhost:8015) and check a `Split` and a `Border` with a collapsible region: dragging a gutter and toggling a collapse must leave no hairline gap between adjacent panes at any point of the animation, and no pane may jitter by a pixel as it moves.

---

## Documentation Impact

No exported symbol is added, removed or renamed, so no doc page, catalog or sidebar entry changes.

Six `@remarks` blocks on public `Component` methods gain or change text, and all six render on the `Component` API page: `setWidth`, `setHeight`, `setX`, `setY` and `setTranslate` are rewritten, and `setSize` gains one (it has no `@remarks` today). All cross-references use `{@link setX}`, a public method, so the "no `{@link}` to internal symbols" rule in CODE_CONVENTIONS.md is satisfied. `npm run docs:api` must finish with zero warnings.

---

## Potential Challenges

- **A test asserting an exact fractional-box width may move by 1px.** Measured: none does — the full 5804-test suite passes unchanged with both fixes applied. Treat any new failure as a real seam the test had baked in, not as a reason to revert the derivation.
- **A component that sets a maximum smaller than an ancestor's explicit minimum and relies on winning** would change size. This is the same blast radius the earlier box-clamp plan carried, and a component that moves there is the clamp bug surfacing, not a regression: fix the contradictory constraint pair at its source rather than restoring the old ordering.
- **`setX` now writes two style properties instead of one.** Both go into the same buffered inline-style batch and flush together, so no extra DOM write results. The "a settled layout writes nothing" guarantee still holds, because `setX` and `setWidth` both return early before any write when their cached value is unchanged.
- **`_left` / `_top` / `_width` / `_height` all start as `NaN`.** Every write path must keep its `NaN` guard; a lost guard writes `NaNpx` and the browser drops the declaration silently.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:382`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L382) — `resolveBounds`, the method fixed by rule 1, and [`:355`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L355) `placeComponent`, one of its two entry points (a manager's `commitPlacements` loop calls `resolveBounds` directly instead).
- [`packages/lib/src/typescript/lib/layout/HBox.ts:637`](packages/lib/src/typescript/lib/layout/HBox.ts#L637) — `resolveChildWidth`, the precedent the fix mirrors. Its docblock already carries the sentence step 2 copies.
- [`packages/lib/src/typescript/lib/core/Component.ts:3892`](packages/lib/src/typescript/lib/core/Component.ts#L3892) — `clampWidth`, the same max-then-min ordering on the committed size. This is the clamp `resolveBounds` disagrees with today, and the reason C1 cannot assert on `getWidth()`.
- [`packages/lib/src/typescript/lib/core/Component.ts:6070`](packages/lib/src/typescript/lib/core/Component.ts#L6070) — `replayGeometryStyles`, the second geometry write path. Missing it leaves the seam in place for every component whose geometry was set before it rendered.
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:329`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L329) — the comment claiming interpolated frames are seam-free, and [`:378`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L378), the per-frame commit that produces the fractional coordinates rule 2 is about. Nothing in this file changes; read it to understand what the rounding fix restores.
- [`packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts`](packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts) — the host-helper and `CONFIG` shape both new test files copy.
- `plans/implemented/box-child-clamp-ordering.md` — the earlier plan that set the minimum-wins rule and fixed three of the four sites. Its Implementation Notes explain why a single-child `getWidth()` assertion cannot see this class of bug.

---

## Non-Goals

- **`setTranslate`'s rounding.** [`Component.ts:4231`](packages/lib/src/typescript/lib/core/Component.ts#L4231) rounds a move delta independently of the `left` it offsets, so a component moved through `commitBounds`'s compositor fast path can paint up to 1px away from where the slow path would put it. Out of scope: the fast path runs only when the size is unchanged, and making the transform edge-consistent would mean re-writing `width` on every move — the layout work the fast path exists to avoid. The collapse animation this plan's rounding fix serves never takes that path, because `CollapseSupport.commitRect` resets the translate to zero on every frame.
- **Device-pixel-aware rounding.** The rounding stays CSS-pixel and only the doc comment changes; `DOM.source.getDevicePixelRatio()` is not consulted here.
- **Setter-time validation of a `min > max` pair.** `setMinSize` / `setMaxSize` keep accepting the contradiction silently, as the earlier plan decided.
- **The cross-axis clamps in `HBox` / `VBox`.** Their maximum-only treatment is deliberate and unrelated.
- **`Anchor` and `Absolute`.** Both commit rects directly and never reach `resolveBounds`, so rule 1 does not apply to them.

---

## Notes

[^only-degenerate]: `min(max(x, lo), hi)` and `max(min(x, hi), lo)` agree for every `x` whenever `lo ≤ hi` — both reduce to clamping `x` into `[lo, hi]`. They diverge only when `lo > hi`, where the first returns `hi` and the second returns `lo`. The current `else if` form has the same property with one extra wrinkle: the minimum branch is skipped only when the maximum branch actually fired, which again can only change the answer when the minimum exceeds the maximum. So the blast radius is exactly the set of children carrying a contradictory pair.

[^measured-row]: Measured on the current code with an `HBox` (`componentSpacing` 0) in a 400×40 `Container` holding three `weight: 1` children: each child's committed width is `133.33333333333331`, and the recorded inline styles are `left 0px / width 133px`, `left 133px / width 133px`, `left 267px / width 133px`. With the derivation in this plan the middle child is written `width 134px` and the others are unchanged.

[^min-is-floor]: The alternative — leaving `resolveBounds` alone because the committed size is re-floored by `clampWidth` anyway — was rejected. The clamp does restore the child's *size*, but `resolveBounds` has already used the wrong width to compute the anchor displacement, so the child is committed at the right size in the wrong place, overflowing its own cell. C1 and C3 in `## Expected Behaviour` are both instances of that: the child ends up 120×120 either way, offset by 36.5px when the clamp is wrong.

[^one-write-path]: The alternative of fixing only `setWidth` and `setHeight` does not hold the rule. A rounded extent is a function of the origin as well as the extent, so any path that changes the origin alone — `setX`, `setY`, and the render-time replay — must re-derive it. Three separate copies of the arithmetic across those paths is exactly how the derivation drifts apart again, which is why one module-level helper feeds all of them.

[^move-rewrites-width]: Worked case. A component at `x = 0.4`, `width = 10.4` is written `left 0px, width 11px`; its right edge is 11, which is `round(0.4 + 10.4)`. Move it to `x = 0.6` with no size change: `left` becomes `round(0.6) = 1`, and the width must become `round(11.0) − 1 = 10` to keep the right edge on 11. `setWidth` cannot do this — its cached `_width` is unchanged, so it returns early — which is why `setX` writes both properties.

[^css-not-device]: `Math.round(10.5)` is `11` in CSS pixels. On a 2× display a device pixel is 0.5 CSS px, so `10.5` was *already* device-pixel-aligned and the rounding moves it — the opposite of what the comment claims. Making the rounding genuinely device-pixel-aware was considered and rejected. The seam exists (`DOM.source.getDevicePixelRatio()`, [`DOM.ts:1061`](packages/lib/src/typescript/lib/core/DOM.ts#L1061), used by [`Canvas.ts:352`](packages/lib/src/typescript/lib/component/display/Canvas.ts#L352) and [`WebGLCanvas.ts:400`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L400)), but consuming it here would put a source read on the hottest write path in the framework, and would need every component's geometry re-flushed when the ratio changes — `Canvas` and `WebGLCanvas` each arm their own `matchMedia` watch for exactly that, and no such watch exists on `Component`. The payoff is a fraction of a pixel of crispness; the cost is a new invalidation path through every component. The doc fix is the whole change.

[^setsize-inconsistent]: `setSize` writes `width + "px"` verbatim at lines 3701-3704 while `setWidth` rounds — two public setters for the same property producing different painted boxes. Leaving it out would also leave the seam open for its 22 call sites (`Slider`'s track and thumb, `Checkbox`'s box, `ProgressSpinner`, `Tab`'s detached window). The change is two lines and is covered by the full-suite run.

[^measured-cases]: Every number in `## Expected Behaviour` — both the "today" value and the required one — was read out of the modelled-DOM harness twice: once against `master` and once against a prototype carrying both fixes, rather than derived on paper. R3's coordinates were re-chosen after the first pair of measurements showed the original ones happened to give the same painted edge either way. The prototype was then discarded; this plan is the record of it.

[^suite-green]: 403 files / 5804 tests passed with both fixes applied, plus a clean `npm run typecheck` and a clean `eslint` on both modified files. That is the measurement behind the first bullet of `## Potential Challenges`.

[^why-fit]: The clamp branch runs only when a child's effective fill is not `FillType.BOTH`. `HBox`, `VBox`, `Split`, `Card` and `Border` all pass `BOTH`, so they reach it only through a per-child `LayoutConstraints.fill`. `HFlow` and `VFlow` always pass `FillType.NONE`, and `Fit` passes its own configurable fill — which makes a one-child `Fit` with `setFill(FillType.NONE)` the smallest possible reproduction. C3 then covers the flow managers, which hit the branch on every child with no configuration at all.

[^docs-prereq]: The four failures are `DocsContent`, `DocsSidebar`, `api` and `links`, all reporting "TypeDoc API tree not found at packages/lib/docs/api". The remaining seven files (2241 tests) pass. This is a fresh-checkout prerequisite, not a signal about this change.

## Implementation Notes

- **The `## Verification` manual demo-app check was performed, not just documented.** No dev server for this worktree was already running (`ss -ltnp` showed only unrelated instances on other ports/repos), so `npm run dev` was launched in `packages/lib` on port 8017 and driven live via the Chrome DevTools MCP tools.
  - **Split gutter drag:** on the "Split" demo tab, the gutter between the "One/Two/Three…" list pane and the instructions text area was dragged through 9 synthetic `mousemove` steps at fractional target positions (deltas of 7, 13, 22, 31, 40, 55, 70, 33, 5px from the gutter's centre). At every step, `getBoundingClientRect()` on the list pane, the gutter, and the text-area pane showed **zero gap** on both sides of the gutter (`list.right === gutter.left` and `gutter.right === textarea.left`, exactly, at every fractional position sampled), confirming no hairline seam opens during a live resize drag.
  - **Pane collapse animation:** the same gutter's collapse chevron was double-clicked to collapse the list pane (confirmed by the demo's own event log: "panecollapse: pane 0 collapsed"). Rects were sampled every ~16ms for 320ms across the ~200ms `CollapseSupport` transition. The boundary between the animating collapsed-gutter strip and the next visible pane (`gutter.right` vs `textarea.left`) measured **zero gap at every one of 19 sampled frames**, start to finish. (The collapsing pane's own element never resizes — `CollapseSupport` keeps it at its committed size and lets the growing gutter/next-pane paint over it in DOM order — so the relevant seam is the gutter/next-pane boundary, not the collapsing pane's own edge; this was confirmed by inspecting the DOM structure and computed style directly.)
  - **Border collapsible-region animation (vertical axis):** the plan's check also names a `Border` with a collapsible region, and the Split checks above only exercised the horizontal axis (`writeHorizontalGeometry`), so this was run separately to cover `writeVerticalGeometry` too, on a live NORTH/SOUTH collapse rather than a duplicate of the Split axis. On the "Border" demo tab (`BorderPanel.ts`'s NORTH `Text` header region, `collapsible: true`), the region's collapse chevron was double-clicked and rects sampled every ~16ms for 320ms. As in the Split case, the collapsing header's own element stays at its full committed size and the animating gutter strip slides up to occlude it: `gutter.top` moved monotonically from `135` down to `35` over 13 samples with no reversal or overshoot, settling exactly flush with the static header's own `top` (`35 === 35`, zero gap) and holding there for the remaining 6 samples — no jitter, no 1px error at settle.
  - No pixel jitter was observed at any sampled step in any of the three checks. The dev server was stopped and the browser tab closed after each session.
- **`npm run docs:api` emits one pre-existing warning unrelated to this change**: `DiagramEdgeLayer.setEdges` links to `Component.onFirstLayout`, which TypeDoc resolves but does not include in the documentation. Confirmed pre-existing by stashing this branch's changes and re-running — the warning is identical with or without this plan's diff. The immediately preceding branch on this stack recorded the same warning for the same reason (`plans/implemented/menu-row-boolean-input-extraction.md`).
