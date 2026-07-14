# Accordion Resizable Drag Perf & Resize-Snap — Implementation Plan

## Overview

Two coupled bugs in the resizable Accordion, both rooted in the layout/transition model of [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts):

- **BUG 1 — viewport resize animates instead of snapping.** `createSection` installs a *permanent* CSS transition on every header, panel wrapper, and content component ([Accordion.ts:1173](src/typescript/lib/layout/Accordion.ts#L1173), [:1202](src/typescript/lib/layout/Accordion.ts#L1202), [:1217](src/typescript/lib/layout/Accordion.ts#L1217)) and on every gutter ([:1492](src/typescript/lib/layout/Accordion.ts#L1492)). Because the transition is always on, *any* `doLayout` that rewrites `top`/`height` animates — including a window/viewport resize, which should snap. Fix: flip the model so transitions are **off by default** and enabled **only for the duration of an open/close toggle**.

- **BUG 2 — drag lags the pointer.** `onGutterDrag` ([:1566](src/typescript/lib/layout/Accordion.ts#L1566)) calls `this.getContainer().doLayout()` on *every* pointer move. `doLayout` runs `computeShrinkRatio` + `computeFill` + `computeResizableHeights` (each walking recursive, unmemoized `Component.getPreferredSize` over every open section) plus a full write loop over all sections — ~7ms median, up to ~12ms, per move on the live demo, so the boundary trails the cursor. In resizable mode all that preferred-size work is discarded anyway (drag-backed `_resizeSizes` override it). Fix (user chose "option 2", the aggressive path): give `onGutterDrag` a lightweight path that writes geometry for **only** the dragged pair (plus any displayed closed sections between them) and never calls `container.doLayout()`.

Both fixes share a new per-section placement primitive (`placeSection`) and a gutter primitive (`placeGutter`), extracted from `doLayout`'s main loop and reused by the drag path so the two geometry writers cannot drift. This is an internal bug fix with no public API or documentation surface.

**Land BUG 1 first**: once transitions are off by default, the drag no longer needs its manual suppress/restore, so BUG 2 can *remove* that code rather than work around it. BUG 1 is independently verifiable before BUG 2 is touched.

---

## Architecture Decisions

### Transitions off by default; enabled only during a toggle

`createSection` and `getOrCreateResizeGutter` set each element's transition to `"none"` at creation. The only path that enables transitions is the open/close toggle (`primeWrapper`): it turns header/wrapper/content/gutter transitions on synchronously *before* the toggle's deferred `doLayout` writes land, and turns them back off in the existing `afterTransition` `onComplete`. Every other relayout — viewport resize, `setHeaderHeight`, drag — writes with transitions off, so it snaps. This is the minimal flip that satisfies "resize snaps, toggle animates" without adding a stateful "is-animating" flag threaded through `doLayout`.

### Reduced motion becomes a plain early-return

Today `primeWrapper`'s reduced-motion branch sets transitions to `"none"` for one frame then restores them ([:1976–1998](src/typescript/lib/layout/Accordion.ts#L1976)). With transitions off by default there is nothing to suppress: reduced motion simply **does not enable** them, so the deferred `doLayout` snaps. The branch collapses to `if (Animation.isReducedMotion()) { return; }` at the top of `primeWrapper`.

### A toggle-in-flight counter gates the global transition-disable

`onHeaderClicked` / `openSection` call `primeWrapper` for **multiple** sections in single-open mode (close the others, open the clicked one). Each call registers its own `afterTransition`. If the first `onComplete` to fire disabled *all* sections' transitions, it would snap the others mid-animation — a regression on the flagship single-open accordion interaction. Guard with a private counter `_toggleAnimations`: each `primeWrapper` that enables transitions increments it; each `onComplete` decrements it and performs the **global** transition-disable + container-transition-clear only when it reaches zero. Per-wrapper `will-change` cleanup stays unconditional in each `onComplete`. (The counter is ~4 lines and removes a real snap; it is not speculative flexibility.)

### Lightweight drag path writes only the affected band; shared `placeSection`/`placeGutter`

> **Superseded by later work.** This section describes the *original* two-section
> band-shift drag this plan shipped. The drag was subsequently generalized (in
> follow-up commits, not this plan) to a nearest-first chain across the whole open
> set: `onGutterDrag` distributes each frame's pointer delta through
> `distributeDragChain` — the section nearest the gutter absorbs the travel first,
> spilling to the next once it hits its min/max — and re-places every displayed
> section through the shared `layoutSections` helper rather than only the dragged
> pair. The perf goal below still holds (the drag path skips
> `getPreferredSize`/`computeShrinkRatio`/`computeFill`/`computeResizableHeights`
> and reflows only the sections whose height changed), and the shared
> `placeSection`/`placeGutter` primitives are unchanged; only the "just the pair +
> intervening band" claim in this and the next section is out of date.

A gutter drag *conserves* the pair's combined height (`onGutterDrag` already computes `newUpper + newLower = total`, both clamped to `[min, max]`). Therefore the bottom of the lower section — and everything below it — is unchanged, and everything above the upper section is unchanged. Only the upper section grows/shrinks, the boundary (gutter) moves, and everything strictly between the upper wrapper's bottom and the lower section shifts by `delta = newUpper − currentUpperHeight`. The drag path writes exactly that, using the same `placeSection`/`placeGutter` helpers `doLayout` uses, so full-layout geometry and drag geometry can never diverge. No `getPreferredSize`, no `computeShrinkRatio`/`computeFill`/`computeResizableHeights`, no touching other sections. This mirrors `Split.onDrag` ([Split.ts:737](src/typescript/lib/layout/Split.ts#L737)), which resizes only its two adjacent panes and moves the gutter directly.

### The band, not just the adjacent pair

`doLayout`'s gutter bookkeeping lets a **displayed closed section** sit between two open sections in a pair (`previousOpen*` persists across closed sections — [:1333–1339](src/typescript/lib/layout/Accordion.ts#L1333)), so `pair.upper` and `pair.lower` are adjacent in the *open set* but may not be adjacent indices. Growing the upper section must push any intervening closed-section headers (and the lower section) down by `delta`. The drag path therefore shifts every header+wrapper with index in `(upperIndex, lowerIndex)` by `delta`, then re-places the lower section at its shifted top. In the common case `lowerIndex === upperIndex + 1` this loop is empty and only the pair moves.

### The drag path always takes the immediate reflow

`doLayout`'s "shrinking" branch defers `component.doLayout()` to `afterTransition` when an open section is shrinking under non-reduced motion ([:1434–1450](src/typescript/lib/layout/Accordion.ts#L1434)), because the wrapper's `overflow:hidden` clip covers the still-large interior during the height animation. During a drag transitions are off (BUG 1), so there is no animation to cover a stale interior — the drag path calls `component.doLayout()` immediately for both sections. The shrink-defer decision stays in `doLayout`'s loop; `placeSection` does *not* own it (it writes geometry and calls `header.doLayout()`, but leaves the content `component.doLayout()` to each caller).

### `_resizeSizes` still updated on every drag move

The lightweight path keeps the existing stored-unit write ([:1603–1604](src/typescript/lib/layout/Accordion.ts#L1603)): `_resizeSizes.set(upper, newUpper / _resizeFactor)` and likewise for lower. This is what makes the *next* full `doLayout` (after a resize or toggle) preserve the dragged ratio. Only the trailing `container.doLayout()` call is replaced.

### Conventions

All geometry writes go through typed setters (`setX`/`setY`/`setWidth`/`setHeight`/`setTransition`/`setVisible`) per [ARCHITECTURE.md](ARCHITECTURE.md) — no raw element styles. `RESIZE_GUTTER_SIZE` ([:57](src/typescript/lib/layout/Accordion.ts#L57)) stays the single gutter-thickness constant. `_toggleAnimations` is framework-managed runtime bookkeeping, so it is a private field, **not** on any options bag (ARCHITECTURE.md, "Three non-negotiable rules", rule 3).

---

## Internal Structure

### `placeSection` — the shared per-section writer

Extracted verbatim from `doLayout`'s loop body ([:1369–1452](src/typescript/lib/layout/Accordion.ts#L1369), the header + wrapper + content geometry writes). It does **not** call `component.doLayout()` and does **not** decide shrink-vs-immediate — the caller owns that. Returns the vertical cursor after the section (its wrapper bottom).

```typescript
/**
 * Writes one section's header, wrapper, and content geometry and returns the
 * vertical cursor after it (the wrapper's bottom edge). Shared by doLayout's
 * main loop and the lightweight drag path so their geometry cannot drift.
 * Does not reflow the content (the caller decides immediate vs. shrink-deferred
 * `component.doLayout()`).
 *
 * @param index - Section index into `_headers` / `_panelWrappers`.
 * @param component - The section's content component.
 * @param top - The header's top edge.
 * @param panelHeight - The wrapper height (0 for a closed section).
 * @param contentHeight - The content height (preferred height for a closed section).
 * @param width - The header/wrapper/content width.
 * @param left - The header/wrapper left edge.
 * @returns The vertical cursor after this section (wrapper bottom).
 */
private placeSection(index: number, component: Component, top: number, panelHeight: number, contentHeight: number, width: number, left: number): number {
    const header = this._headers[index];
    const wrapper = this._panelWrappers[index];
    const headerHeight = this.effectiveHeaderHeight();

    header.setX(left);
    header.setY(top);
    header.setWidth(width);
    header.setHeight(headerHeight);
    header.doLayout();

    const wrapperTop = top + headerHeight;

    wrapper.setX(left);
    wrapper.setY(wrapperTop);
    wrapper.setWidth(width);
    wrapper.setHeight(panelHeight);

    component.setX(0);
    component.setY(0);
    component.setWidth(width);
    component.setHeight(contentHeight);

    return wrapperTop + panelHeight;
}
```

### `placeGutter` — the shared gutter writer

Extracted from `doLayout`'s gutter block ([:1403–1407](src/typescript/lib/layout/Accordion.ts#L1403)). Geometry + visibility only — `_gutterPairs` bookkeeping stays with the caller.

```typescript
/**
 * Positions and shows the pooled gutter at `index`, overlaying the upper
 * section's content bottom edge. `_gutterPairs` bookkeeping stays with the
 * caller.
 *
 * @param index - The gutter's pool index.
 * @param upperBottom - The upper section's content bottom edge.
 * @param width - The gutter width.
 * @param left - The gutter left edge.
 */
private placeGutter(index: number, upperBottom: number, width: number, left: number): void {
    const gutter = this.getOrCreateResizeGutter(index);

    gutter.setX(left);
    gutter.setY(upperBottom - RESIZE_GUTTER_SIZE);
    gutter.setWidth(width);
    gutter.setHeight(RESIZE_GUTTER_SIZE);
    gutter.setVisible(true);
}
```

### Lightweight drag body (replaces `onGutterDrag`'s trailing `container.doLayout()`)

Everything up to and including the `_resizeSizes` writes ([:1573–1604](src/typescript/lib/layout/Accordion.ts#L1573)) is unchanged. Replace the final `this.getContainer()?.doLayout();` ([:1606](src/typescript/lib/layout/Accordion.ts#L1606)) with:

```typescript
const components = this.getContainer()?.getComponents() ?? [];
const upperIndex = components.indexOf(pair.upper);
const lowerIndex = components.indexOf(pair.lower);

if (upperIndex === -1 || lowerIndex === -1) {
    return;
}

// Boundary travel in rendered px (both are on-screen scale).
const delta = newUpper - pair.upper.getHeight();

const left = this._panelWrappers[upperIndex].getX();
const width = this._panelWrappers[upperIndex].getWidth();

// Upper section: header top and content top unchanged; only its height changes.
const upperTop = this._headers[upperIndex].getY();

this.placeSection(upperIndex, pair.upper, upperTop, newUpper, newUpper, width, left);
pair.upper.doLayout();

// Move the boundary gutter to the upper section's new content bottom.
const upperBottom = this._panelWrappers[upperIndex].getY() + newUpper;

this.placeGutter(gutterIndex, upperBottom, width, left);

// Any displayed closed sections between the pair slide down by delta so they
// stay glued to the moving boundary (empty loop in the common adjacent case).
for (let i = upperIndex + 1; i < lowerIndex; i++) {
    this._headers[i].setY(this._headers[i].getY() + delta);
    this._panelWrappers[i].setY(this._panelWrappers[i].getY() + delta);
}

// Lower section: shifted by delta, resized to newLower.
const lowerTop = this._headers[lowerIndex].getY() + delta;

this.placeSection(lowerIndex, pair.lower, lowerTop, newLower, newLower, width, left);
pair.lower.doLayout();
```

> Note the `pair.upper.getHeight()` read for `delta` **must** happen before `placeSection` overwrites the height — it is read on the first line of the block, before any `placeSection` call, so this holds.

---

## Ordered Implementation Steps

### Phase A — BUG 1: transitions off by default (land and verify first)

1. **Add the counter field.** In the field block near [:170–198](src/typescript/lib/layout/Accordion.ts#L170), add `private _toggleAnimations: number = 0;` with a one-line comment (in-flight open/close toggle animations; global transition-disable waits for zero).

2. **`createSection`: default transitions off.** Change [:1173](src/typescript/lib/layout/Accordion.ts#L1173), [:1202](src/typescript/lib/layout/Accordion.ts#L1202), [:1217](src/typescript/lib/layout/Accordion.ts#L1217) from `header.setTransition(this.buildHeaderTransition())` / `wrapper.setTransition(this.buildWrapperTransition())` / `component.setTransition(this.buildContentTransition())` to `setTransition("none")` for each. Update the three inline comments to say the transition is enabled only during a toggle (by `primeWrapper`), not permanent. Keep `header.setAnimationTiming(...)` at [:1167](src/typescript/lib/layout/Accordion.ts#L1167) unchanged.

3. **`getOrCreateResizeGutter`: default gutter transition off.** Change [:1492](src/typescript/lib/layout/Accordion.ts#L1492) from `gutter.setTransition(this.buildHeaderTransition())` to `gutter.setTransition("none")`. Update the method's doc comment ([:1465–1478](src/typescript/lib/layout/Accordion.ts#L1465)) — the "set once at creation so the drag doLayout doesn't re-apply it" rationale is now stale; replace it with: the gutter's `top` transition is enabled only during a toggle (by `primeWrapper`) and off otherwise so drags and resizes snap.

4. **Rewrite `primeWrapper`** ([:1973–2024](src/typescript/lib/layout/Accordion.ts#L1973)):
   - First statement: `if (Animation.isReducedMotion()) { return; }` (reduced motion leaves transitions off → snaps).
   - Then enable transitions on every header/wrapper/content (`buildHeaderTransition` / `buildWrapperTransition` / `buildContentTransition`) and every gutter (`buildHeaderTransition`), exactly the loops currently in the reduced-motion branch + the gutter loop from `onGutterDragEnd`.
   - Keep the container height transition ([:2010](src/typescript/lib/layout/Accordion.ts#L2010)) and `wrapper.setWillChange("height")` ([:2012](src/typescript/lib/layout/Accordion.ts#L2012)).
   - `this._toggleAnimations += 1;` after enabling.
   - `afterTransition` `onComplete`: `wrapper.setWillChange(null);` then `this._toggleAnimations -= 1;` then, **only when `this._toggleAnimations <= 0`**, clamp it to `0`, set every header/wrapper/content/gutter transition back to `"none"`, and `container?.setTransition(null)`.
   - Update the JSDoc to describe the new model (transitions enabled for the toggle, disabled when the last in-flight toggle completes; reduced motion skips enabling).

   Checkpoint: `grep -n 'requestAnimationFrame' src/typescript/lib/layout/Accordion.ts` — the reduced-motion `rAF` restore at [:1989](src/typescript/lib/layout/Accordion.ts#L1989) should be gone.

5. **Typecheck + build the offline-testable behaviour.** `npm run typecheck`. Then extend tests (see Phase A tests below) and run them.

### Phase B — BUG 2: shared helpers + lightweight drag (land after A)

6. **Add `placeSection`** (body in *Internal Structure*), placed as a private method adjacent to `doLayout`.

7. **Add `placeGutter`** (body in *Internal Structure*), adjacent to `getOrCreateResizeGutter`.

8. **Rewrite `doLayout`'s loop to call the helpers** ([:1341–1453](src/typescript/lib/layout/Accordion.ts#L1341)), preserving identical final geometry:
   - Keep the non-displayed early-continue, the spacing/`displayedSoFar` bookkeeping, and the `preferred`/`contentPref`/`openHeight`/`panelHeight`/`contentHeight` computation.
   - Replace the gutter block ([:1399–1415](src/typescript/lib/layout/Accordion.ts#L1399)): when `isOpen && resizeHeights && previousOpenComponent !== null`, call `this.placeGutter(placedGutterCount, previousOpenBottom, containerWidth, insets.getLeft())`, then set `this._gutterPairs[placedGutterCount] = { upper: previousOpenComponent, lower: component }` and `placedGutterCount += 1`.
   - Compute `shrinking` ([:1434–1436](src/typescript/lib/layout/Accordion.ts#L1434)) **before** placing (it reads `component.getHeight()`, which `placeSection` overwrites).
   - Replace the header/wrapper/content writes ([:1369–1452](src/typescript/lib/layout/Accordion.ts#L1369)) with `const cursor = this.placeSection(i, component, y, panelHeight, contentHeight, containerWidth, insets.getLeft());`.
   - Keep the shrink branch: `if (shrinking) { Animation.afterTransition({ …, onComplete: () => component.doLayout() }); } else { component.doLayout(); }`.
   - After placement, if `isOpen && resizeHeights` set `previousOpenComponent = component` and `previousOpenBottom = cursor`.
   - Set `y = cursor` at the end of the iteration.

   Checkpoint: the existing full-layout tests (default-off, seed-parity, fill-invariant, rescale, min-floor, gutter-count, prune) must pass unchanged — they pin byte-identical full-layout geometry.

9. **Lightweight `onGutterDrag`** ([:1566–1607](src/typescript/lib/layout/Accordion.ts#L1566)): keep the guard, the clamp math, and the `_resizeSizes` writes; replace the trailing `this.getContainer()?.doLayout();` ([:1606](src/typescript/lib/layout/Accordion.ts#L1606)) with the lightweight body from *Internal Structure*. Update the method JSDoc to note it writes only the dragged band and does not run a full layout.

10. **Remove the now-redundant drag transition suppression.**
    - `onGutterDragStart` ([:1528–1538](src/typescript/lib/layout/Accordion.ts#L1528)): delete the header/wrapper/content `setTransition("none")` loop and the gutter `setTransition("none")` loop. Keep the drag-origin capture and the `Event.addViewportListener` registrations. Remove the now-unused `const components = ...` if the deletion orphaned it. Update the JSDoc (drop the "suppresses every transition" sentence).
    - `onGutterDragEnd` ([:1623–1633](src/typescript/lib/layout/Accordion.ts#L1623)): delete the transition-restore loops (header/wrapper/content and gutter). Keep the `removeViewportListener` calls and the `_dragUpper`/`_dragLower` reset. Update the JSDoc.

    Checkpoint: `grep -n 'setTransition("none")' src/typescript/lib/layout/Accordion.ts` — after Phase B only the `primeWrapper` `onComplete` disable and the `createSection`/`getOrCreateResizeGutter` defaults remain; no occurrences inside `onGutterDragStart`.

11. **Typecheck + full test + build.** `npm run typecheck`, `npx vitest run tests/component/layout/Accordion.resizable.test.ts`, then the manual live verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `tests/component/layout/Accordion.resizable.test.ts` |

---

## Expected Behaviour

### Unit-testable (offline via TestDOM — extend `Accordion.resizable.test.ts`)

Geometry, sizing, conservation, `_resizeSizes`, and gutter placement are fully modelled offline (the existing tests already drive drags by calling the private `onGutterDragStart`/`onGutterDrag` directly and read `getHeight()`/`getY()`). Add:

1. **Lightweight drag updates geometry with no following `doLayout`.** 2 open sections; `onGutterDragStart(0,0)` then `onGutterDrag(0, +30)`; **without** calling `host.doLayout()`, assert upper grew, lower shrank, and `upper.getHeight() + lower.getHeight()` equals the pre-drag sum (conservation). (Distinguishes the new direct-write path from the old "drag then relayout" one.)

2. **Conservation across a range of deltas.** For several deltas (e.g. −40, +15, +30) on a 2-open layout, the pair's height sum is invariant (`toBeCloseTo`, 5).

3. **Clamp still holds on the lightweight path.** Drag far past the lower section's floor (`onGutterDrag(0, 10000)`) with no `doLayout`; assert lower clamps at its `minHeight` and upper absorbs the rest.

4. **Gutter tracks the boundary.** After a lightweight drag, `gutter.getY()` equals `upperWrapper.getY() + upper.getHeight() − RESIZE_GUTTER_SIZE`. (Reach the gutter via `(acc as any)._resizeGutters[0]`.)

5. **Untouched section unchanged.** 3 open sections; drag gutter 0 (A/B boundary) with no `doLayout`; assert C's height *and* C's header `getY()` are unchanged, while A+B is conserved.

6. **Closed section between the pair shifts with the band.** A open, B **closed**, C open (so gutter 0's pair is `{upper: A, lower: C}` spanning B). Capture B's header `getY()` and `delta`; after `onGutterDrag(0, +20)` with no `doLayout`, assert B's header `getY()` moved by exactly `delta`, C's header shifted, and A+C is conserved.

7. **A full `doLayout` after a drag preserves the dragged ratio.** After a lightweight drag, capture `upper.getHeight()/lower.getHeight()`, call `host.doLayout()`, assert the ratio is preserved (`toBeCloseTo`) and the sum equals the open budget. (Pins the `_resizeSizes` stored-unit write; the existing "3+ open, rendered≠stored scale" test at [:304](tests/component/layout/Accordion.resizable.test.ts#L304) already exercises the `_resizeFactor` conversion and must keep passing.)

8. **Full-layout geometry regression.** The existing default-off, seed-parity, fill-invariant, rescale, min-floor, gutter-count, and prune tests must pass unchanged after the `placeSection`/`placeGutter` extraction (they assert `placeSection` reproduces today's geometry byte-for-byte).

### Manual-verify (not exercisable offline — describe-then-verify-live)

The recording DOM sink delivers no pointer events, fires no real CSS transitions, and does no paint, so pointer-drag latency, live transitions firing/snapping, and window-resize animation must be checked in the browser (see *Verification* for the exact steps). Expected observations:

- **Drag tracks the pointer with no trailing** — the boundary stays under the cursor across fast drags (BUG 2 fixed).
- **Viewport resize snaps** — resizing the window instantly re-fits the sections with **zero** animation (BUG 1 fixed).
- **Open/close toggles still animate smoothly** — clicking a header animates the wrapper height, the headers/wrappers below sliding, and (resizable) the gutters, then settles.
- **Single-open toggle animates both the closing and opening sections** without either snapping partway (validates the `_toggleAnimations` counter).
- **Reduced motion snaps** — with `prefers-reduced-motion: reduce` emulated, toggles apply instantly with no animation.
- **No stuck cursor / pointer-events** after a drag (unchanged from today).

---

## Verification

- **Typecheck:** `npm run typecheck` (clean).
- **Unit tests:** `npx vitest run tests/component/layout/Accordion.resizable.test.ts` — all existing + new cases green. Also run the sibling `tests/component/layout/Accordion.manager.test.ts` and `tests/component/default-options-fallback.test.ts` to catch full-layout / default regressions.
- **Grep invariants:**
  - `grep -n 'requestAnimationFrame' src/typescript/lib/layout/Accordion.ts` — no reduced-motion `rAF` restore remains in `primeWrapper`.
  - `grep -n 'setTransition("none")' src/typescript/lib/layout/Accordion.ts` — occurs in `createSection`, `getOrCreateResizeGutter`, and `primeWrapper`'s `onComplete`; **not** in `onGutterDragStart`/`onGutterDragEnd`.
  - `grep -n 'getContainer()?.doLayout' src/typescript/lib/layout/Accordion.ts` — the call inside `onGutterDrag` is gone.
- **Build:** `npm run build` (or the project's lib build) succeeds.
- **Manual live (chrome-devtools, dev server per project memory — app on `http://localhost:8015`):** open the Accordion demo, enable **Resizable**, turn **Single-open OFF**, **Open All** so adjacent open sections and gutters exist. Then:
  1. Drag a gutter up and down quickly — the boundary must stay pinned to the cursor (no trailing).
  2. Resize the viewport (`resize_page`) — sections must re-fit instantly, no animation.
  3. Toggle a section open/closed — it must animate smoothly (wrapper height, headers below sliding, gutters sliding).
  4. Toggle in **Single-open** mode — closing + opening both animate, neither snaps.
  5. Emulate `prefers-reduced-motion: reduce` (`emulate`) and toggle — instant, no animation.

---

## Potential Challenges

- **Byte-identical full-layout geometry after extraction.** `placeSection` must reproduce the exact write sequence and the shrink-defer decision must stay in `doLayout` (it reads the pre-write `getHeight()`). Mitigation: compute `shrinking` before calling `placeSection`; keep the existing full-layout tests as the regression net (Expected Behaviour #8).
- **Multi-prime cleanup race.** Without the `_toggleAnimations` counter, the first toggle animation to complete would snap the others. Mitigation: the counter gates the global disable to zero (Architecture Decisions).
- **Closed section inside a pair.** Naively assuming `lowerIndex === upperIndex + 1` would leave an intervening closed header stuck during the drag. Mitigation: shift the whole `(upperIndex, lowerIndex)` band by `delta` (Expected Behaviour #6 pins it).
- **`delta` read ordering.** `delta = newUpper − pair.upper.getHeight()` must read the height *before* `placeSection` overwrites it. Mitigation: it is the first computed value in the lightweight block.

---

## Critical Files

- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — the only source file changed; read `doLayout` ([:1277](src/typescript/lib/layout/Accordion.ts#L1277)), `onGutterDrag*` ([:1515](src/typescript/lib/layout/Accordion.ts#L1515)–[:1637](src/typescript/lib/layout/Accordion.ts#L1637)), `primeWrapper` ([:1973](src/typescript/lib/layout/Accordion.ts#L1973)), `computeResizableHeights` ([:1825](src/typescript/lib/layout/Accordion.ts#L1825)), the transition builders ([:2031](src/typescript/lib/layout/Accordion.ts#L2031)–[:2054](src/typescript/lib/layout/Accordion.ts#L2054)), and the drag/gutter fields ([:170–198](src/typescript/lib/layout/Accordion.ts#L170)).
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `onDrag` ([:737](src/typescript/lib/layout/Split.ts#L737)) is the reference pattern for a two-pane lightweight drag (write only the affected panes + gutter, then `lhs.doLayout()`/`rhs.doLayout()`).
- [`tests/component/layout/Accordion.resizable.test.ts`](tests/component/layout/Accordion.resizable.test.ts) — the test harness (`hostAccordion`/`content`/`constraints`) and the existing drag-via-private-handler seam to extend.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — typed-setter and DOM-seam rules the geometry writes must honour.
