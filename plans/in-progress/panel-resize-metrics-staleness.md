---
depends-on: [panel-scroll-metrics-resize-coalescing, panel-scroll-read-economy]
touches-shared:
  - packages/lib/src/typescript/lib/core/Panel.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Panel Resize-Metrics Staleness — Implementation Plan

## Overview

During any live resize of a scrolling `Panel` — a `Split` gutter drag, a `Dock` pane resize, a plain window resize — three things visibly stop updating until 2–3 frames after the pointer stops: the panel's content does not re-flow, an overlay scrollbar freezes in place, and the scroll-shadow edge keeps the strength it had when the resize began. All three come from one mechanism. [`Panel.doLayout`](packages/lib/src/typescript/lib/core/Panel.ts#L738) asks [`deferScrollMetricsWhileResizing`](packages/lib/src/typescript/lib/core/Panel.ts#L860) whether to withhold the whole post-layout remeasure, [`remeasureScrollMetrics`](packages/lib/src/typescript/lib/core/Panel.ts#L1202), and that method withholds **all** of it on every frame of a resize burst after the first. `remeasureScrollMetrics` is the only caller of every write behind the three symptoms, so withholding it freezes all three together.[^symptom-map]

This plan splits those writes in two. The ones that are a pure function of the panel's own committed box and its cached scrollbar gutter — the shadow overlay's box, and the overlay bars' position and track length — are written on every withheld frame from cached data, costing no DOM read. The ones that genuinely need a fresh read — whether an axis still overflows, which drives the gutter reservation, each bar's show/hide and thumb, and each shadow edge's strength — are taken live whenever the panel is currently painting a scroll affordance, using the existing [`showsScrollAffordance`](packages/lib/src/typescript/lib/core/Panel.ts#L1011) predicate. A scrolling panel painting no affordance keeps today's coalescing unchanged.

The work is confined to `core/Panel.ts` plus tests and one changelog entry. No exported signature changes. **For a panel that is painting an affordance this is close to reverting the coalescing** — the per-frame cost goes back to what a live pass has always cost. `## Architecture Decisions` states that cost plainly and says what is assumed about the benefit being given up.

---

## Architecture Decisions

### The affordance predicate gates the read, inside the existing withhold decision

`deferScrollMetricsWhileResizing` gains one more reason to return `false`: the panel is currently painting a scroll affordance. The check goes after the method's existing `_panelSizeMoved` bookkeeping and before it records a debt, so the two-frame settle relay that ends a resize burst — [`scheduleScrollMetricsSettle`](packages/lib/src/typescript/lib/core/Panel.ts#L912) and [`flushScrollMetricsSettle`](packages/lib/src/typescript/lib/core/Panel.ts#L925) — still arms, extends and ends exactly as it does today.[^gate-location]

The predicate is [`showsScrollAffordance`](packages/lib/src/typescript/lib/core/Panel.ts#L1011), which the file already uses for exactly this purpose: [`scheduleGutterSettleOnShrink`](packages/lib/src/typescript/lib/core/Panel.ts#L972) gates its own extra measurement behind the same call ([:987](packages/lib/src/typescript/lib/core/Panel.ts#L987)), because a painted affordance is the only state a shrink could leave stale. This plan asks the same question of the same predicate to decide whether a read is worth taking. `showsScrollAffordance` reads the state the *last completed* measure left, which is what "currently painting" means:

| `_scrollbarGutter` | `_shadowEdges` | `showsScrollAffordance()` | A withheld-candidate frame |
|---|---|---|---|
| `{right: 12, bottom: 0}` | all `0` | `true` | reads live |
| `{right: 0, bottom: 12}` | all `0` | `true` | reads live |
| `{right: 0, bottom: 0}` | `bottom: 40` | `true` | reads live |
| `{right: 0, bottom: 0}` | `left: 40` | `true` | reads live |
| `{right: 0, bottom: 0}` | all `0` | `false` | withheld — cached writes only |

### A frame that reads live records no debt

When the affordance check sends a frame down the live path, the method returns without setting `_scrollMetricsOwed`. That frame has already paid, so the settle catch-up has nothing left to do for it. A burst whose every frame read live therefore ends with no catch-up remeasure at all, while a burst containing any withheld frame still gets one.[^no-debt]

### Cached-data writes move into one method, replacing `doLayout`'s inline block

`doLayout`'s withheld branch already writes the inner overlay scroller's size from cached data, with its reasoning spelled out at [`Panel.ts:767-795`](packages/lib/src/typescript/lib/core/Panel.ts#L767). That block becomes a call to a new private `commitCachedScrollGeometry`, which adds the shadow overlay's box and the two overlay bars' position and track length to the same treatment. The new method reuses the file's existing pure pair [`resolveShadowOverlaySize`](packages/lib/src/typescript/lib/core/Panel.ts#L1138) / [`applyShadowOverlaySize`](packages/lib/src/typescript/lib/core/Panel.ts#L1152) rather than restating the overlay's box arithmetic.[^cached-precedent]

### One expression derives the cached box for both scrollbar styles

`commitCachedScrollGeometry` runs only when no affordance is painted, which means the cached gutter is `{right: 0, bottom: 0}`. That is what lets a single expression — the committed width and height minus the panel's own cached border — serve `scrollbarStyle: "overlay"` and `scrollbarStyle: "native"` alike, with no branch on the style for the box itself.[^one-expression]

### A bar that must *appear* mid-burst still appears at the catch-up

The predicate answers "is an affordance painted **now**", so it is true on the frame a bar must disappear and false on the frame a bar must appear. A resize that takes a panel from fits-content to overflows-content therefore still shows its new bar 2–3 frames late, as today. What the cached writes do fix in that direction is the bar's track length, which now tracks the panel every frame instead of freezing, so the bar appears at the right length rather than being corrected afterwards.[^appearing-bar]

### The per-frame cost for an affordance-showing panel goes back to a live pass's

| Panel state during a resize burst | DOM reads per frame today | After this change |
|---|---|---|
| `autoScroll: "none"` — the class default | 0 | 0 |
| scrolling, content fits, nothing scrolled | 0 | 0 |
| scrolling, a gutter reserved or any shadow edge lit | 0 | 2, or 4 on a frame whose gutter change schedules a second pass |

Two reads per pass is exactly what a live pass costs today, so for the third row this change effectively reverts the coalescing. Measured offline over a five-frame vertical gutter drag on an overflowing pane, the whole burst went from 4 reads to 12.[^cost-measured] This plan assumes the coalescing's benefit for that row is not established, because the plan that introduced it retracted its own measurement.[^benefit-unproven]

---

## Internal Structure

### The gate

In [`deferScrollMetricsWhileResizing`](packages/lib/src/typescript/lib/core/Panel.ts#L860), between the `_panelSizeMoved` write and the `_scrollMetricsOwed` write:

```typescript
if (sizeChanged) {
    this._panelSizeMoved = true;
}

if (this.showsScrollAffordance()) {
    return false;
}

this._scrollMetricsOwed = true;

return true;
```

### `doLayout`'s branch

[`Panel.ts:764-796`](packages/lib/src/typescript/lib/core/Panel.ts#L764) becomes:

```typescript
if (!this.canSkipSettledRemeasure(sizeChanged, settledAtEntry)) {
    if (!this.deferScrollMetricsWhileResizing(sizeChanged)) {
        this.remeasureScrollMetrics();
    } else {
        this.commitCachedScrollGeometry(width, height);
    }
}
```

`width` and `height` are `doLayout`'s own locals, the same two `sizeChanged` was computed from.

### The new method

Placed immediately after `doLayout`, before `canSkipSettledRemeasure`:

```typescript
private commitCachedScrollGeometry(width: number, height: number): void {
    const border       = this.getBorderSize();
    const clientWidth  = width  - border.left - border.right;
    const clientHeight = height - border.top  - border.bottom;
    const innerW       = clientWidth  - this._scrollbarGutter.right;
    const innerH       = clientHeight - this._scrollbarGutter.bottom;

    if (this._scrollbarStyle === "overlay" && this._overlayScrollElement) {
        this._overlayScrollStyle.setMany({ width: innerW + "px", height: innerH + "px" });
    }

    this._scrollbarV?.setX(innerW);
    this._scrollbarV?.setY(0);
    this._scrollbarV?.setHeight(innerH);

    this._scrollbarH?.setX(0);
    this._scrollbarH?.setY(innerH);
    this._scrollbarH?.setWidth(innerW);

    const size = this.resolveShadowOverlaySize(clientWidth, clientHeight);

    if (size) {
        this.applyShadowOverlaySize(size);
    }
}
```

The six bar writes are six of the eight [`commitOverlayLayout`](packages/lib/src/typescript/lib/core/Panel.ts#L1080) makes. The two left out are its `setMetrics` calls, which are what need the read: `setMetrics` drives each bar's `setDisplayed` and its thumb from the measured content extent.

### What the withheld frame still does not do

| Write | Needs a read | On a withheld frame with no affordance |
|---|---|---|
| inner overlay scroller's width/height | no | written from cache |
| shadow overlay's width/height | no | written from cache |
| bar `setX` / `setY` / `setWidth` / `setHeight` | no | written from cache |
| bar `setMetrics` — show/hide and thumb | yes | withheld |
| `commitScrollbarGutterIfChanged` — the reservation | yes | withheld |
| `applyShadowEdges` — the four strengths | yes | withheld |

---

## Ordered Implementation Steps

1. **`core/Panel.ts` — add the gate.** Insert the three-line `showsScrollAffordance()` early return into `deferScrollMetricsWhileResizing`, exactly as *Internal Structure* shows. Check: `grep -n 'showsScrollAffordance' packages/lib/src/typescript/lib/core/Panel.ts` — expect four matches, up from three: a field comment at [:218](packages/lib/src/typescript/lib/core/Panel.ts#L218), `scheduleGutterSettleOnShrink`'s call, the new call, and the definition.

2. **`core/Panel.ts` — add `commitCachedScrollGeometry`.** Add the method from *Internal Structure* immediately after `doLayout`. Carry the two explanatory paragraphs from the block being replaced ([`Panel.ts:768-788`](packages/lib/src/typescript/lib/core/Panel.ts#L768)) into its doc comment — they are the reason the derivation subtracts the border — and extend them with the gutter-is-zero reasoning from *One expression derives the cached box for both scrollbar styles*.

3. **`core/Panel.ts` — replace `doLayout`'s withheld branch** with the `else { this.commitCachedScrollGeometry(width, height); }` form. Check: `grep -c 'else if (this._scrollbarStyle === "overlay" && this._overlayScrollElement)' packages/lib/src/typescript/lib/core/Panel.ts` — expect `0`, down from `1`; the surviving `_scrollbarStyle === "overlay"` test is the one inside `commitCachedScrollGeometry`.

4. **`core/Panel.ts` — fix the four doc comments that now describe the old behaviour.**
   - `doLayout`'s own comment, second paragraph ([`:718-726`](packages/lib/src/typescript/lib/core/Panel.ts#L718)): say that the withholding now applies only while the panel paints no scroll affordance, and that a withheld pass still writes the geometry derivable from its own box and the cached gutter. **Prose only — `doLayout` is public and every method that paragraph describes is private, so a `{@link}` raises a TypeDoc warning on `Panel.doLayout` and on every subclass that inherits the comment.**[^public-jsdoc]
   - `deferScrollMetricsWhileResizing`'s `@remarks`, last three sentences ([`:852-858`](packages/lib/src/typescript/lib/core/Panel.ts#L852)): *"Otherwise, whether a settle frame is already armed — not `sizeChanged` — decides withholding"* and *"the check that matters — 'is a settle frame already armed' — is false until this call arms one"* are both now wrong. Two conditions decide withholding: a settle frame already armed **and** no affordance painted. Add what returning `false` on the affordance path means for the debt — that the frame has paid, so it records none.
   - `showsScrollAffordance`'s comment ([`:1003-1010`](packages/lib/src/typescript/lib/core/Panel.ts#L1003)): it names `scheduleGutterSettleOnShrink` as its one caller. Name both, and what each asks.
   - `resizeScrollShadowOverlay`'s comment ([`:1566-1571`](packages/lib/src/typescript/lib/core/Panel.ts#L1566)): the sentence beginning *"The exception is a pass the resize-settle relay is withholding, which measures nothing and so leaves the overlay at its pre-burst box"* is now wrong — a withheld pass writes the overlay's box from cache. Replace it with what is still true: a withheld pass leaves the *edge strengths* stale, not the box.

5. **Add `packages/lib/tests/core/PanelResizeGeometryStaleness.test.ts`** with cases V1–V5, H1–H5, N1–N3 and R from `## Expected Behaviour`. Harness: `Split.dragFrameGate.test.ts`'s scene-and-drive shape, plus `setScrollExtent` from `tests/dom/TestDOM`. **The `afterEach` must drain captured frames to quiescence before restoring mocks** — without it the second and later tests in the file start with `Component`'s module-level `afterNextLayout` flush still queued and the settle relay behaves differently.[^teardown-drain]

6. **Add cases G1 and G3–G6 to `packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts`**, using that file's existing `mountPanel` / `stubMetrics` / frame-capture helpers. Do not add G2 — the file's existing *"withholds the remeasure for a second size change in the same burst"* case already is G2.

7. **Amend `packages/lib/docs/reference/changelog/next.md`.** See `## Documentation Impact`.

8. **Run `## Verification` end to end.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Create | `packages/lib/tests/core/PanelResizeGeometryStaleness.test.ts` |
| Modify | `packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable offline with `installTestDOM` and captured animation frames. Nothing here needs a browser: the geometry each case asserts is a committed component box or a recorded style write, not a painted pixel. The one manual check is at the end.

### The scenes

**Scene V** — a vertical `Split` in a 300×600 host. Leading pane: `_Panel({ layoutManager: new Fit(), autoScroll: 'y' })` holding one `Component({ preferredSize: { width: 200, height: 400 } })`. Trailing pane: a plain `_Panel`. After the first layout settles, the inner overlay scroller's scroll extent is stubbed to 200×400 with `setScrollExtent`. The gutter is pressed at `clientY: 300` and dragged to 350, 400, 450 and 500, one captured frame per move. The pane's content is 400 tall throughout, so the pane stops overflowing between the second and third move — **the threshold crossing happens mid-burst, which is the case these tests exist for.**

**Scene H** — Scene V rotated: a horizontal `Split` in a 600×300 host, `autoScroll: 'x'`, content 400 wide, gutter pressed at `clientX: 300` and dragged to 350, 400, 450, 500.

**Scene N** — Scene V with `scrollbarStyle: 'native'`, and the scroll extent stubbed on the panel element rather than an inner scroller (native mode installs none).

### Scene V — the vertical arm

Pane heights across the drag are 298 (pre-press), then 348, 398, 448, 498.

| Frame | Pane | `gutter.right` today | after | bar track length today | after | child width today | after |
|---|---|---|---|---|---|---|---|
| pre-press | 298 | 0 | 0 | 298 | 298 | 292 | 292 |
| drag 350 | 348 | 12 | 12 | 348 | 348 | 292 | 292 |
| drag 400 | 398 | 12 | 12 | 348 | **398** | 280 | 280 |
| drag 450 | 448 | 12 | **0** | 348 | **448** | 280 | 280 |
| drag 500 | 498 | 12 | 0 | 348 | **498** | 280 | **292** |
| catch-up | 498 | 0 | 0 | 498 | 498 | 292 | 292 |

1. **V1 — the reservation is released on the frame the content stops overflowing.** `_scrollbarGutter.right` is `12` after the 350 frame and `0` after the 450 frame.
2. **V2 — the child recovers during the drag, one frame after the release.** The content child's width is `280` after the 400 frame and `292` after the 500 frame. The one-frame gap is the existing reflow: [`commitScrollbarGutterIfChanged`](packages/lib/src/typescript/lib/core/Panel.ts#L1121) schedules the pass that re-lays the child out.
3. **V3 — the vertical bar's track length follows the pane every frame.** `_scrollbarV.getHeight()` is `298` before the press, then `348`, `398`, `448`, `498`.
4. **V4 — the bar returns to the un-inset edge and hides on the crossing frame.** After the 350 frame `getX()` is `288` and `isDisplayed()` is `true`; after the 450 frame `getX()` is `300` and `isDisplayed()` is `false`.
5. **V5 — the bottom shadow edge ramps down during the drag.** `_shadowEdges.bottom` is `100` after the 350 frame, below `100` after the 400 frame, and `0` after the 450 frame.

### Scene H — the horizontal arm

Pane widths across the drag are 298, then 348, 398, 448, 498.

6. **H1 — the bottom reservation is released on the crossing frame.** `_scrollbarGutter.bottom` is `12` after the 350 frame and `0` after the 450 frame.
7. **H2 — the child's height recovers during the drag.** `280` after the 400 frame, `292` after the 500 frame.
8. **H3 — the horizontal bar follows the pane and hides on the crossing frame.** After 350: `getWidth()` `348`, `getY()` `288`, displayed. After 400: `getWidth()` `398`. After 450: `getWidth()` `448`, `getY()` `300`, not displayed.
9. **H4 — the shadow overlay's committed box follows the pane every frame.** The last recorded style write on `_shadowOverlay` is `348px` × `288px` after the 350 frame (the `288` is the bottom gutter being subtracted), then `398px` wide, then `448px` × `300px`, then `498px` wide.
10. **H5 — the right shadow edge ramps down.** `_shadowEdges.right` is `100` after 350, below `100` after 400, `0` after 450.

### Scene N — native scrollbars

11. **N1 — the native reservation is released on the crossing frame.** `_scrollbarGutter.right` is `15` after the 350 frame and `0` after the 450 frame. `_scrollbarV` is absent throughout: native mode installs no overlay bars, so symptom 2 does not arise here while symptoms 1 and 3 do.
12. **N2 — the child recovers during the drag.** `277` after the 400 frame, `292` after the 500 frame.
13. **N3 — the shadow overlay's committed height follows the pane every frame.** `348px`, `398px`, `448px`, `498px` across the four frames. **Assert the height, not the width.** Offline, `TestDOM.getScrollMetrics` reports `clientWidth` as the recorded style width and does not subtract a native scrollbar, so the width figure cannot tell the cached derivation from the live read; the height can, because no bottom gutter is ever reserved in this scene.

### The arm that stays coalesced

14. **R — a burst on a panel painting no affordance is still withheld, and its cached writes track the pane.** Scene V with the content child 50 tall, so nothing ever overflows and no scroll extent is stubbed. The first drag frame's `DOM.source.getScrollMetrics` delta is greater than zero (the first size change of a burst always reads live). On each of the three later frames: the read delta is `0`, `_scrollbarV.getHeight()` equals the pane's current height, `_scrollbarV.getX()` equals the pane's current width, `_scrollbarV.isDisplayed()` is `false`, and the last recorded `height` style write on both the inner scroller and the shadow overlay equals the pane's current height in `px`.

### The gate itself, in the existing harness

Each case builds `mountPanel('auto')`, runs one live `doLayout()` to arm the relay, seeds the affordance state named, then resizes and runs a second `doLayout()` with no frame drained. `live` is the first pass's `getScrollMetrics` delta and is asserted greater than zero in every case. **G2 is the no-seed baseline these cases are read against — a second pass with no affordance seeded, whose delta is `0`.** That case already exists in the file as *"withholds the remeasure for a second size change in the same burst"*; it is named here only so the cases below can refer to it.

15. **G1 — a reserved right gutter sends the frame live.** Seed `_scrollbarGutter = { right: 12, bottom: 0 }`: the second pass's delta equals `live`.
16. **G3 — a lit bottom shadow edge alone is enough.** Seed `_shadowEdges = { top: 0, bottom: 40, left: 0, right: 0 }` with the gutter at zero: delta equals `live`.
17. **G4 — a reserved bottom gutter alone is enough.** Seed `{ right: 0, bottom: 12 }`: delta equals `live`.
18. **G5 — a lit left shadow edge alone is enough.** Seed `_shadowEdges = { top: 0, bottom: 0, left: 40, right: 0 }`: delta equals `live`.
19. **G6 — a frame that read live records no debt.** Run G1's sequence and G2's in the same test. `_scrollMetricsOwed` immediately after the second pass is `false` for G1's and `true` for G2's.

### Unchanged behaviour

20. `autoScroll: "none"` panels arm nothing and read nothing, as today — the existing *"never arms a settle frame for a class-default (\"none\") panel"* case covers it.
21. The settled-pass skip, [`canSkipSettledRemeasure`](packages/lib/src/typescript/lib/core/Panel.ts#L823), is untouched.
22. A bar that must *appear* mid-burst still appears at the catch-up, not during the burst — see `## Non-Goals`.

### Manual-verify

- Drag a `Split` gutter over a scrolling, overflowing `Panel` and confirm the content re-flows, the overlay bar tracks the panel edge, and the shadow edge follows, all during the drag rather than after it. Nothing in the automated cases covers real pointer input or paint.

---

## Verification

- **Typecheck:** `npm run typecheck` — clean.
- **Lint:** `npm run lint` — clean. `commitCachedScrollGeometry` places children (`_scrollbarV.setX`, `setHeight`), which is half of what `local/require-content-bounds` looks for; it never reaches the other half, because the outer box arrives as parameters rather than through `this.getWidth()` / `getHeight()`, and because `this.getBorderSize()` is the rule's own border-aware escape on the same `this` receiver. No baseline entry is needed and none may be added.
- **Unit tests, inner loop:** from `packages/lib`, `npx vitest run tests/core/PanelResizeGeometryStaleness.test.ts tests/core/PanelResizeMetricsCoalescing.test.ts tests/core/PanelResizeMetricsCoalescingRealtime.test.ts tests/core/PanelOverlayScrollbar.test.ts tests/core/PanelGutterSettle.test.ts tests/core/PanelScrollReadEconomy.test.ts tests/core/PanelScrollShadowStrips.test.ts tests/core/PanelHiddenRemeasure.test.ts` — all green.
- **Unit tests, gate:** `npm test` from the worktree root (it runs `typecheck:test` first, then the whole suite). Never a bare `--root`: `llms-generate.test.ts`'s `resolveDoc` depends on the working directory and fails spuriously otherwise. `Panel` is the base class nearly every scrollable component extends, so the full run is the gate, not the subset above.
- **Docs:** `npm run docs:api` — must finish at the pre-existing warning baseline, not above it. A `{@link}` to a private method added to `doLayout`'s public comment raises one warning per link on `Panel.doLayout` *and* on every subclass that inherits the comment.
- **Build:** `npm run build:lib` succeeds.
- **Manual:** the single bullet at the end of `## Expected Behaviour`.

Never run `packages/qa/runqa.sh`, MiniBrowser, the Tauri qa-host or `npm run dev` for this change. Every assertion above is offline.

### Which mutation each prescribed assertion catches

Each row was confirmed by breaking the implementation in the way named and watching the listed cases go red.[^mutation-run] The implementer should re-confirm each one.

| Mutation | Cases that must redden |
|---|---|
| Delete the `showsScrollAffordance()` early return | G1, G3, G4, G5, G6, V1–V5, H1–H5, N1–N3 |
| Invert it to `if (!this.showsScrollAffordance())` | all of the above **and** R |
| Drop `commitCachedScrollGeometry`'s shadow-overlay write | H4, N3, R |
| Drop its bar writes | V3, V4, R |
| Drop its inner-scroller write | R |
| Narrow the predicate to the vertical arm only (`gutter.right` plus the top/bottom edges) | G4, G5, H1, H3, H4, H5 |
| Gate the live read on `scrollbarStyle === "overlay"` as well | N1, N2, N3 |

Three properties of that table are deliberate, because each is a failure this repo has shipped before:[^verification-standard]

- **No assertion is satisfiable by zero.** Every "reads live" case asserts `live > 0` before comparing anything to `live`, and every "released" or "recovered" assertion is preceded on the same observable by a non-zero anchor from an earlier frame in the same burst — `gutter.right === 12` before `=== 0`, child width `280` before `292`, `_shadowEdges.bottom === 100` before `0`. An implementation that stopped measuring altogether fails the anchor.
- **Both axes are covered by cases, not by symmetry arguments.** Scene H is not a variant of Scene V's assertions; it drives the horizontal arm of every expression the vertical arm uses, which is the only thing that catches a predicate narrowed to one axis.
- **Every consequence is geometry.** The two exceptions are the read-count delta in R and cases G1–G5, and the `_scrollMetricsOwed` flag in G6. Both are the mechanism's own observables, with no geometric proxy, and each is anchored on that same observable — the delta against a non-zero delta from the same spy in the same test, the flag against G2's `true`.

---

## Documentation Impact

No exported symbol changes, so no API page, catalog entry or `llms.txt` regeneration is affected. One changelog edit:

- **Amend the existing `## Changed` → `### Core` entry** in `packages/lib/docs/reference/changelog/next.md` beginning *"Dragging a `Split` gutter, resizing a `Dock` pane, or any other live external resize of a scrolling `Panel` no longer forces up to five synchronous layout flushes"* ([`:1383-1403`](packages/lib/docs/reference/changelog/next.md#L1383)). Its closing sentences — *"the scrollbar gutter reservation, the overlay bar's own position and size, and the edge shadow all briefly lag a fast resize instead, catching up once it settles"* — describe behaviour this plan removes. Rewrite them to say that the withholding applies only while the panel paints no scroll affordance (no reserved gutter, no lit shadow edge); that a panel painting one measures live on every frame of a resize; and that a withheld frame still keeps the inner scroller, the shadow overlay's box and the overlay bars' position and track length in step with the panel's live size. Keep "No consumer action is needed."

Nothing goes in `## Fixed`, and nothing goes in the migration page: the coalescing entry is on the unreleased `next` page, so no released version ever carried the stale-geometry behaviour and there is nothing for a consumer to migrate.

---

## Potential Challenges

- **Test isolation in the new file.** A test that ends with frames still captured leaves `Component`'s module-level `afterNextLayout` flush queued, and the next test's settle relay then finds a flush already pending and arms nothing. Mitigation: drain frames to quiescence in `afterEach` before `vi.restoreAllMocks()`, as step 5 requires.
- **`doLayout`'s comment is public API documentation.** A `{@link}` to any of the private methods involved raises a TypeDoc warning on `Panel.doLayout` and on each of the eight subclasses that inherit the comment. Mitigation: prose only, as step 4 states; `npm run docs:api` catches a slip.
- **Offline `clientWidth` does not model a native scrollbar.** Mitigation: Scene N asserts the shadow overlay's height rather than its width, per case N3.
- **A stale cached gutter can make the cached client box wrong by one scrollbar width in native mode.** If the content starts overflowing during a withheld burst, the browser draws a native bar the cache does not know about, and the shadow overlay is written that much too wide for those frames. The error is bounded by the bar width, invisible (every shadow edge is at zero strength whenever `commitCachedScrollGeometry` runs), and self-correcting at the catch-up — and strictly better than today, where the overlay keeps its whole pre-burst box.
- **The thumb lags on a withheld frame.** `Scrollbar` does not override `setHeight`/`setWidth`, so changing the track length without `setMetrics` leaves the thumb at its previous size. Mitigation: none needed — `commitCachedScrollGeometry` runs only when no affordance is painted, which is exactly when both bars are hidden.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — the only source file changed. Read `doLayout` ([:738](packages/lib/src/typescript/lib/core/Panel.ts#L738)) including the withheld block at [:767-795](packages/lib/src/typescript/lib/core/Panel.ts#L767) that step 3 replaces and whose comment step 2 carries over; `deferScrollMetricsWhileResizing` ([:860](packages/lib/src/typescript/lib/core/Panel.ts#L860)); `flushScrollMetricsSettle` ([:925](packages/lib/src/typescript/lib/core/Panel.ts#L925)); `scheduleGutterSettleOnShrink` ([:972](packages/lib/src/typescript/lib/core/Panel.ts#L972)) — the in-file precedent for gating a measurement behind the affordance predicate; `showsScrollAffordance` ([:1011](packages/lib/src/typescript/lib/core/Panel.ts#L1011)); `measureOverlayLayout` ([:1033](packages/lib/src/typescript/lib/core/Panel.ts#L1033)); `commitOverlayLayout` ([:1073](packages/lib/src/typescript/lib/core/Panel.ts#L1073)) — the six bar writes the new method mirrors and the two `setMetrics` calls it must not; `resolveShadowOverlaySize` ([:1138](packages/lib/src/typescript/lib/core/Panel.ts#L1138)); `remeasureScrollMetrics` ([:1202](packages/lib/src/typescript/lib/core/Panel.ts#L1202)); `resizeScrollShadowOverlay` ([:1577](packages/lib/src/typescript/lib/core/Panel.ts#L1577)) whose comment step 4 corrects.
- [`packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts`](packages/lib/tests/core/PanelResizeMetricsCoalescing.test.ts) — the `mountPanel` / `stubMetrics` / `internals` / frame-capture harness cases G1 and G3–G6 extend, and the `afterEach` comment explaining the frame-drain requirement.
- [`packages/lib/tests/component/layout/Split.dragFrameGate.test.ts`](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts) — the harness precedent for the new file: the scene builders, the `_gutters[0]` reach, the `onDragStart` / `onDrag` / `onDragStop` drive, and the `setAppResizeMode('live')` / `Tooltip._stopPointerWatch()` teardown. Its own `verticalScene` comment — that a gate reading one axis unconditionally would pass every other case in the file — is why Scene H exists.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `setScrollExtent` ([:2060](packages/lib/tests/dom/TestDOM.ts#L2060)) and `getScrollMetrics` ([:1415](packages/lib/tests/dom/TestDOM.ts#L1415)), the two that decide what the offline scenes can express.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) — `setMetrics` ([:785](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L785)), which is what makes show/hide and the thumb read-dependent, and `getTrackWidth` ([:867](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L867)), a constant needing no read.
- [`plans/implemented/panel-scroll-metrics-resize-coalescing.md`](plans/implemented/panel-scroll-metrics-resize-coalescing.md) — the origin of the defect. Read its `## Implementation Notes`, in particular the BLOCKING note that introduced the cached inner-scroller write this plan generalises, and correction 2, which retracts the plan's own measurement.
- [`plans/implemented/panel-scroll-read-economy.md`](plans/implemented/panel-scroll-read-economy.md) — the restructuring this plan sits on: the calc/commit split and the two-reads-per-live-pass shape. Its *Prescribed verifications that could not have caught a regression* section is the source of this plan's `## Verification` standard.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.sink` / `DOM.source` seam and the typed-setter rules. No new raw DOM access and no new setter is introduced; every write goes through an existing `InlineStyle` buffer or an existing component setter.

---

## Non-Goals

- **Making a bar that must *appear* mid-burst appear during the burst.** Detecting impending overflow needs the read the coalescing exists to avoid, and no cached signal proves it. The lag is 2–3 frames, the panel paints nothing wrong in the meantime, and the bar now arrives at the correct track length.
- **Deriving the panel's own client box from cache on the live path too.** It would halve the reads for an affordance-showing panel, but it changes the settled path's numbers and introduces a cached-versus-measured divergence where none exists today. The cached derivation stays confined to the withheld branch.
- **Restoring the coalescing's saving for an affordance-showing panel by some other means.** `## Architecture Decisions` states the cost; a cheaper design is a separate investigation with its own measurement.
- **Touching `canSkipSettledRemeasure`, the settle relay's two-hop shape, or `scheduleGutterSettleOnShrink`.** None of them causes the staleness.
- **`ScrollStrip`, `VirtualRowView` and `Accordion`'s own resize coalescing.** Separate mechanisms with separate state; `ScrollStrip` never leaves `autoScroll` at anything but `"none"`, so this plan is inert on it.

---

## Notes

[^symptom-map]: Traced against the source at this plan's base commit. `remeasureScrollMetrics` ([Panel.ts:1202](packages/lib/src/typescript/lib/core/Panel.ts#L1202)) is the sole caller of all three write groups. Symptom 2 (the frozen overlay bar) comes from `commitOverlayLayout`'s `setX`/`setY`/`setHeight`/`setWidth`/`setMetrics` ([:1080-1088](packages/lib/src/typescript/lib/core/Panel.ts#L1080)). Symptom 1 (content not re-flowing) comes from `commitScrollbarGutterIfChanged` ([:1121](packages/lib/src/typescript/lib/core/Panel.ts#L1121)), whose cached `_scrollbarGutter` feeds `getInnerSize()` and so every child's laid-out box, plus the follow-up `scheduleLayout` at [:1126](packages/lib/src/typescript/lib/core/Panel.ts#L1126). Symptom 3 (the stalled shadow) comes from the `resolveShadowOverlaySize`/`applyShadowOverlaySize` pair at [:1251-1253](packages/lib/src/typescript/lib/core/Panel.ts#L1251) and `resolveShadowEdges`/`applyShadowEdges` at [:1256-1258](packages/lib/src/typescript/lib/core/Panel.ts#L1256). The withholding is unconditional after the burst's first frame because `deferScrollMetricsWhileResizing` keys on whether a settle frame is armed, not on `sizeChanged` (its own `@remarks` say so), and `flushScrollMetricsSettle` re-arms whenever `_panelSizeMoved` is set — which every resizing frame sets — so the arm never lapses mid-drag. The defect dates from commit `1a11db34` (2026-09-13) and is present on `master`; neither unmerged branch in the current stack causes or worsens it.

[^gate-location]: The alternative was to branch in `doLayout` itself — `if (!this.deferScrollMetricsWhileResizing(sizeChanged) || this.showsScrollAffordance())`. Rejected: `deferScrollMetricsWhileResizing` and its sibling `canSkipSettledRemeasure` are both predicates extracted out of `doLayout` precisely so the withhold decision lives in one named place with its reasoning on it, and splitting the decision across two sites would leave the method's `@remarks` describing only half of it. Putting the check inside also keeps the `_scrollMetricsOwed` bookkeeping in the same method as the decision it belongs to, which is what the *records no debt* decision depends on.

[^no-debt]: Confirmed offline on both arms. With a gutter seeded, the affordance path leaves `_scrollMetricsOwed` `false`; with no affordance, a withheld pass sets it `true`. Over a five-frame drag on an overflowing pane the catch-up performed zero reads after the change, against two before it — every frame had already measured, so there was nothing owed. A mixed burst still works: a frame that drops to no affordance sets the debt, and the catch-up pays it.

[^cached-precedent]: The precedent is in the same method being changed. `doLayout`'s existing withheld branch ([Panel.ts:767-795](packages/lib/src/typescript/lib/core/Panel.ts#L767)) already writes the inner overlay scroller's size from cached data, and its comment already carries the argument this plan generalises — that a write against already-cached data "costs nothing the withholding exists to avoid", and that skipping it leaves the content "visibly stuck at its pre-burst size for the whole resize burst". That block exists because the origin plan's second audit round found the same class of defect for the inner scroller alone; this plan applies the same remedy to the two write groups the same audit left behind. Reusing `resolveShadowOverlaySize`/`applyShadowOverlaySize` rather than restating the box arithmetic follows the file's own pure-calc / pure-write split, introduced by `panel-scroll-read-economy`.

[^one-expression]: `showsScrollAffordance()` is false only when `_scrollbarGutter.right`, `_scrollbarGutter.bottom` and all four `_shadowEdges` are zero, and `commitCachedScrollGeometry` runs only on that branch — so the gutter terms in `innerW`/`innerH` are provably zero there. That is what collapses the two styles to one expression. In `scrollbarStyle: "overlay"` the native bar is hidden, so the real `clientWidth` is the border-box width minus the border. In `scrollbarStyle: "native"` the real `clientWidth` is that minus the rendered native bar — but with no gutter reserved there is no bar, so the same expression holds. The gutter terms are kept in the expression anyway: they are what the replaced code wrote, they cost nothing, and removing them would make the method wrong the moment a future change let it run with a gutter cached.

[^appearing-bar]: Measured on a shrinking vertical drag over a pane whose 400-tall content fits at the start. Before and after the change alike, `_scrollbarGutter.right` stays `0` for the whole burst and becomes `12` only once the settle relay catches up, several frames after the drag stops, because the predicate reads the last completed measure and there is nothing there to read. What does change is the bar's track length: it froze at `468` for the whole burst before, and now follows the pane through `438`, `408`, `378`, `348`. The disappearing direction is fully covered because the affordance from the *previous* frame is exactly the signal that a bar is on screen and may need to come off it.

[^cost-measured]: Measured offline against a prototype of this plan, counting `DOM.source.getScrollMetrics` calls per animation frame over a five-frame vertical `Split` gutter drag. Overflowing pane, before: `[2, 0, 0, 0, 0]` during the drag and `2` at the catch-up — 4 reads for the burst. After: `[2, 4, 2, 2, 2]` and `0` at the catch-up — 12 reads. The `4` is a frame on which the gutter reservation changed, so `commitScrollbarGutterIfChanged`'s `scheduleLayout` ran a second panel pass inside the same frame. Pane whose content fits, before and after identically: `[2, 0, 0, 0, 0]` during the drag and `2` at the catch-up. The prototype also passed the whole library suite unchanged — 8652 tests, including all ten `Panel` test files. (Three further files failed in the prototype's isolated copy only, on paths the copy did not carry — `package.json`, `scripts/llms/generate.mjs`, the repo `README.md` — not on any code path.)

[^benefit-unproven]: `plans/implemented/panel-scroll-metrics-resize-coalescing.md`'s `## Implementation Notes`, correction 2, retracts the measurement the coalescing was justified by: the reported "133 forced `Layout` events before the fix, 1 after" could not be reproduced — re-runs produced 133 on fixed-branch runs too, on builds a direct fetch confirmed carried the guard — and the note downgrades the live trace to "corroborating, not primary, evidence", resting the case on the offline unit tests, which measure read counts rather than frame time. So what this plan gives up for an affordance-showing panel is a read-count reduction whose frame-time benefit was never demonstrated, in exchange for three symptoms a user reported seeing. If a later measurement does establish a frame-time cost for that row, the *Non-Goals* entry about halving the live path's reads is where to start.

[^public-jsdoc]: `CODE_CONVENTIONS.md`'s *Don't `{@link}` internal symbols from public JSDoc*. The origin plan hit this exact trap: copying its own snippet verbatim into `doLayout`'s comment took `npm run docs:api` from 14 warnings to 50 — four for `Panel.doLayout` itself and four more for each of the eight subclasses that override `doLayout` without their own comment and so render the inherited one. Links *inside* the private methods' own comments are fine; TypeDoc excludes those pages entirely.

[^teardown-drain]: Found while prototyping. Without the drain, seven of the eight scene cases failed on the prototype — their very first anchor assertion, because the relay never armed. `PanelResizeMetricsCoalescing.test.ts`'s own `afterEach` carries the explanation: `cancel()` only sets a flag and does not deregister the frame, so a test ending mid-burst leaves `Component`'s module-level `rafHandle` non-null and the next test's `scheduleScrollMetricsSettle` finds a flush already pending. Adding the drain turned all eight green.

[^mutation-run]: Each row was executed against a prototype in an isolated copy of the library: the named change was applied, the suite run, and the failing set recorded. Two results are worth noting because they are not obvious from the code. Dropping the cached shadow-overlay write reddens H4 and N3 as well as R, because both scenes cross the threshold mid-burst and their post-crossing frames therefore run the cached branch, not the live one. Inverting the predicate reddens every case including R, since it both withholds the frames that must read and reads on the frames that must not.

[^verification-standard]: The batch this plan's base commit belongs to shipped twelve prescribed verifications across nine plans that could not fail, catalogued in `panel-scroll-read-economy.md`'s *Prescribed verifications that could not have caught a regression*. The three recurring shapes were an `expect(x).toBe(y)` satisfiable when both sides are `0`, a case list covering one of two symmetric arms, and an assertion on a call count where the contract was a consequence. The three properties listed above are those three failures inverted, one for one.

---

## Implementation Notes

**The design in this plan's body was superseded during implementation, by the
user, and the body was left as written.** What shipped is not the gated design
below but a full withdrawal of the deferral. This section records both, since the
body is now a description of a road not taken.

### What happened

The gated design was implemented first, exactly as `## Ordered Implementation
Steps` prescribes: the `showsScrollAffordance()` early return in
`deferScrollMetricsWhileResizing`, a new `commitCachedScrollGeometry` holding the
read-free writes on the withheld branch, the four doc-comment corrections, and
the changelog amendment. It passed, with 19 prescribed cases green and the
library suite clean.

The user then tested by hand and walked straight into the plan's documented
Non-Goal: on the `Split` demo, shrinking a viewport over a list that was showing
**no** scrollbar produced no scrollbar and no shadow until the drag settled.
Already-visible bars behaved correctly, which is exactly what the gate fixed.
They judged the appearing direction a defect that had to be fixed rather than a
Non-Goal, and chose a full revert.

### Why fixing the appearing direction empties the gate

`deferScrollMetricsWhileResizing` opened with
`if (this._autoScroll === "none" || !this.getElement()) return false;`, so a
non-scrolling panel never deferred at all, before or after the gated change. That
leaves exactly three populations, and the gated design covers them like this:

| Population | Under the gated design |
|---|---|
| `autoScroll: "none"` | never deferred; unaffected |
| scrolling, **showing** an affordance | reads live — the gate's whole purpose |
| scrolling, showing **no** affordance | still coalesced — and this is the reported defect |

So the only population the gate still coalesced is the one whose behaviour the
user rejected. Fixing the appearing direction empties the gate's population
entirely, which makes the gate a predicate that always returns the same answer,
and makes `commitCachedScrollGeometry` — which only ever ran on the withheld
branch — unreachable. Both were therefore removed rather than kept as dead code.

The saving being given up was never established in the first place: the plan that
introduced the deferral, `panel-scroll-metrics-resize-coalescing`, retracted its
own 133→1 forced-layout measurement in its `## Implementation Notes`
(correction 2), having failed to reproduce it, and downgraded the live trace to
corroborating evidence. So the trade was a read-count reduction of unproven
frame-time value against three defects a user could see.

This is a revert of a *behaviour*, not of a commit: `1a11db34` is far back in
history and `core/Panel.ts` has moved under it since, including on a branch below
this one in the same stack. The end state was reached by editing current code.

### The symptom, stated correctly

Three details matter and two of them contradict the plan's body, which describes
the panel as holding its *pre-burst* box:

- **The freeze is at the burst's first drag frame's value, not the pre-drag
  value.** Frame 1 of a burst finds no settle frame armed, so it arms one and
  measures live; frames 2..n are withheld. The stale value is whatever frame 1
  committed, and the error is the pane's extent change *since frame 1*. Measured
  offline here: over the four-frame growing drag, the vertical bar's track length
  froze at 348 while the pane reached 498 — the pane was 298 before the press, so
  the frozen figure is frame 1's, not the resting one.
- **It self-corrects after roughly three motion-free frames, then re-freezes.**
  Two still frames let the relay lapse, so the next moving frame measures live and
  the geometry is briefly exact again. At 60 Hz that is about 50 ms, which is why
  the defect is easy to miss by hand and plausibly why only the appearing half
  was reported: a bar that is merely mis-positioned keeps snapping back, while a
  bar that is entirely absent stays absent.
- **All of it froze together, from the one withheld call.** `commitOverlayLayout`
  holds each bar's `setX`/`setY`/track length *and* its thumb (`setMetrics`), plus
  the scrollbar-gutter commit; the shadow overlay's box and its four edge
  strengths follow in the same method. One withheld `remeasureScrollMetrics`
  withheld every one of them.

Two sub-cases are invisible even though the committed geometry is wrong, and the
fixtures avoid both deliberately:

- On a **shrink**, the stale bar overshoots past the pane's edge, and
  `autoScroll: "y"` sets `overflow-x: hidden`, so the wrongness is clipped out of
  sight. Every case here asserts a committed rectangle or a recorded style write,
  never apparent visibility.
- On a **scrolled** panel the thumb has a second writer outside the withheld path
  (`syncOverlayScrollbars` → `Scrollbar.setMetrics`, from the scroll listener), so
  the thumb keeps tracking while the track length freezes. No fixture here
  scrolls during a burst, so the track length stays a witness.

One more correction to the plan's framing: the cached writes already on the
withheld branch (`core/Panel.ts:767-796` at the base commit) covered
`_overlayScrollStyle`'s width/height only — the inner scroller, and nothing else.
Confirmed by probe: the inner rectangle tracked every frame while the bar, the
gutter and the shadow froze. Removing that branch removed one write's worth of
caching, not a broad cache — and it arguably made the defect *more* legible,
since the content viewport visibly grew away from a motionless bar.

### What was removed from `core/Panel.ts`

`deferScrollMetricsWhileResizing`, `scheduleScrollMetricsSettle` and
`flushScrollMetricsSettle`; the `_scrollMetricsOwed`, `_panelSizeMoved` and
`_scrollMetricsSettleHandle` fields with their `applyOptions` seeding and the
destructor's cancel; and `doLayout`'s withheld branch, which reduces to one
unconditional `this.remeasureScrollMetrics()` behind the surviving settled-pass
skip. Six comment sites were corrected to match: the `_lastPanelWidth` /
`_lastPanelHeight` field block (which counted five fields), `applyOptions`'
seeding comment, `doLayout`'s own public comment, `canSkipSettledRemeasure`,
the destructor, and `resizeScrollShadowOverlay`.

Two things deliberately stayed. `canSkipSettledRemeasure` is a different
mechanism — it skips a pass that committed the same rectangle with nothing marked
— and the plan's `## Non-Goals` already ruled it out of scope; its comment lost
the sentence about protecting the settle relay. The replacement first claimed the
gate stays on the caller's side because `remeasureScrollMetrics` has other
callers that would be wrongly skipped. That was wrong and an audit caught it:
after this change the method has exactly one caller, `doLayout`. The reason now
given is the true one — both of the predicate's inputs are `doLayout`'s own and
neither survives the call, since `sizeChanged` compares against a baseline this
pass overwrites and `settledAtEntry` must be sampled before `super.doLayout()`
clears the dirty flag. `showsScrollAffordance()` keeps its original
caller, `scheduleGutterSettleOnShrink`, so it is not orphaned and the pre-1.0
unused-private-API rule does not apply. `_lastPanelWidth`/`_lastPanelHeight` also
stay: they compute `sizeChanged`, which is what keeps the settled-pass skip from
swallowing a resize frame.

### Tests: what was dropped, and why

Dropped outright, because the mechanism they pinned no longer exists — none of
these was renumbered around or quietly reinterpreted:

- **Cases G1 and G3–G6**, added to `PanelResizeMetricsCoalescing.test.ts` under
  the gated design. Each seeded one branch of `showsScrollAffordance()` and
  asserted the gate sent that frame live. There is no gate.
- **Case R**, the gated design's "the arm that stays coalesced". It asserted that
  a burst on a panel painting no affordance keeps taking zero reads — precisely
  the behaviour the user rejected. Keeping it would have pinned the defect.
- **`PanelResizeMetricsCoalescing.test.ts` and
  `PanelResizeMetricsCoalescingRealtime.test.ts`, both deleted.** Their subject
  was the withholding: "withholds the remeasure for a second size change",
  "performs exactly one catch-up at settle", "extends the burst between the
  relay's two hops", "still withholds a same-size pass inside a burst", "stays
  withheld through a 35-frame drag", "cancels an armed settle frame on teardown".
  (The same-size case's answer survives on its own terms rather than inverted: a
  same-size pass after a drain still reads nothing, via the settled-pass skip,
  which `PanelResizeMetricsLive.test.ts`'s "reads nothing on a pass that commits
  the same box" asserts — and which still catches a stale
  `_lastPanelWidth`/`_lastPanelHeight` baseline.) The cases that outlived the
  mechanism moved into a
  new `PanelResizeMetricsLive.test.ts`, with the burst assertions inverted: the
  absolute per-pass read count (2, overlay and native), the write-before-read
  ordering in the native gutter branch, the `"none"` and pre-render no-ops, and a
  33-frame realistic one-pass-per-frame drag that now asserts every frame
  measures.
- **Two cases lost their subject rather than their answer** and were dropped
  instead of inverted: "keeps the overlay inner scroller tracking this panel's
  live size even while withheld" and "accounts for this panel's own border when
  tracking the live size while withheld". Both tested arithmetic that existed
  only inside the cached write — the live path takes `clientWidth`/`clientHeight`
  from its own read, so `Panel` performs no border subtraction for the inner
  scroller any more. Under a stubbed `getScrollMetrics` the inverted versions were
  tautological (the stub dictates the value the code writes back). The real claim
  is now case V6 in `PanelResizeGeometryStaleness.test.ts`, which asserts the
  inner scroller's box against *modelled* geometry across a real drag.

`PanelScrollReadEconomy.test.ts` case F was inverted in place — it pinned the
withheld pass plus its catch-up, and now pins that the settled-pass skip does not
swallow a resize frame and that a burst leaves nothing owed. Its case G lost two
assertions on the deleted relay handle. Stale comments naming the removed methods
were corrected in that file and in `PanelOverlayScrollbar.test.ts`.

### The scenes need an explicit `spacing: 4` on the `Split`

`Split`'s own default `spacing` is `0`, which gives each pane exactly half the
host and lands the overflow threshold on the drive's *first* frame. A 4 px gap
makes each pane half the host less half the gap, which puts the crossing strictly
inside the drive — between frames 1 and 2 in both directions — which is what the
mid-burst coverage requires. This also reproduces the pane extents the plan's own
`## Expected Behaviour` tables assert (298 / 348 / 398 / 448 / 498), which are
unreachable at the default spacing.

### Verification

Twenty-three cases in `PanelResizeGeometryStaleness.test.ts` cover both
directions of the overflow threshold, on both axes, in overlay and native mode:
scenes V/H/N grow the pane past its content so a reservation must be released, a
bar hidden and an edge ramped down mid-drag; scenes AV/AH/AN shrink it until the
content overflows so a gutter must be reserved, a bar shown and an edge lit
mid-drag. The appearing scenes are the user's reported defect. Every case pins a
committed box, a recorded style write or the cached gutter, and every transition
is anchored on the same observable against an earlier frame of the same burst.

All 23 were confirmed red against the base commit's source before the source
changed, each failing on the assertion its scene predicts. Three mutations were
then applied to the implemented source, the seven `Panel` test files run, and the
source restored:

| Mutation | Cases reddened |
|---|---|
| Restore the withheld branch — the defect itself | 29: all 23 geometry cases, the 5 live-burst cases, and read-economy F |
| `canSkipSettledRemeasure` always `true` — never remeasure | 42: the above plus the per-pass-count cases, read-economy A–E, and two cases in other `Panel` files |
| Drop `sizeChanged` from `canSkipSettledRemeasure` — let the settled skip swallow a resize frame | 31: all 23 geometry cases, the 5 live-burst cases, read-economy B and F, and one `PanelOverlayScrollbar` case |

Every case that claims a pass measured is reddened by at least one mutation, and
each of the 23 geometry cases by mutation 1, which is the defect itself. Exactly
two cases are immune to all three, and neither is vacuous: the two whose whole
claim is that a configuration measures *nothing* at all —
`PanelResizeMetricsLive`'s `"none"`-panel case and read-economy's G. No mutation
to the resize path can make a non-measuring configuration measure, so neither has
a live-pass anchor available, and each states in place what would make it
non-zero. Read-economy's A is *not* in that set, though an earlier draft of this
note claimed it was: it asserts zero for a *settled* pass but opens with its own
live-pass anchor, and mutation 2 reddens it. The mutation table's second row names
representative groups rather than an exhaustive list; its total of 42 is exact. `PanelResizeMetricsLive`'s
header was corrected to scope its own anti-vacuity claim to the deltas it
actually covers, rather than claiming it of every assertion in the file.

`npm test` from the worktree root: 520 files / 8750 passed / 2 todo / 0 failed,
against a start-point baseline of 520 / 8734 / 2 / 0 measured before any change —
two test files deleted and two added, and a net 16 more cases.
`npm -w packages/qa run test`: 453 passed / 0 failed, the baseline.
`npm run typecheck` and `npm run lint` clean. `npm run docs:api`: 0 errors and 14
warnings, the pre-existing baseline, so `doLayout`'s prose-only comment held.
`npm run docs:llms:check` and `npm run build:lib` clean.

### The changelog entry is deleted, not rewritten

The first attempt rewrote the coalescing entry in
`docs/reference/changelog/next.md` to describe the withdrawal and state the cost.
An audit showed that was the wrong treatment and that the rewrite miscounted: a
withheld burst paid two reads on its first frame plus two at its catch-up — four,
not "two for the whole burst" — and the measurement the origin plan downgraded
was a count of forced `Layout` events, not a frame-time figure. More importantly
the entry had no consumer to address. `1a11db34` landed on 2026-09-13, after
`0.9.0` was cut, so the withholding only ever existed on the unreleased `next`
page: a consumer upgrading from `0.9.0` never met the stale geometry and never
meets its fix, and their per-pass read count still goes *down* (five to two, via
the read-economy entry that remains). This is the same reasoning the plan's own
`## Documentation Impact` used to keep the change out of `## Fixed` and out of
the migration page, carried to its conclusion — so the entry is removed. No other
entry on the page narrates "an earlier revision of this release", and adding the
first one to describe a behaviour no release carried would have been noise.

The consumer migration page needed a real correction, which the first attempt
missed: `docs/reference/migration/next.md` told readers that "the resize-settle
relay is unaffected" and that its catch-up "still runs in full". That paragraph
now says a live external resize never reaches the settled-pass skip, because such
a pass commits a different rectangle every frame.

Four stale comments naming the removed mechanism also survived the first pass and
were caught by the same audit: the `requestAnimationFrame`-capture rationale in
`PanelOverlayScrollbar.test.ts`, a helper's doc comment in
`PanelScrollReadEconomy.test.ts`, and the `PANEL_SETTLE_FRAMES = 3` rationale in
both `packages/qa/tests/mount.test.ts` and `packages/qa/tests/ablations.test.ts`.
That constant took two further audit rounds to settle, and the honest answer
turned out to be deletion. The first replacement rationale claimed the mount
reserves a scrollbar gutter whose follow-up pass the cases wait for — false, since
jsdom paints no scroll affordance at all, as `ablations.test.ts`'s own comment
says. The second claimed the wait is what leaves the panel settled for the
settled-pass skip these cases read — also false: with the constant set to `0` all
453 qa tests still pass, because every `ablations` case calls `doLayout()` itself
before counting and the `mount` case's own `mountPanel(..., SMOKE_WAITS)` already
settles the panes. The removed relay was the wait's only reason to exist, so
rather than write a third rationale to fit it, the constant and its five `await
tools.waitFrames(...)` calls are deleted. This change is what orphaned them, which
is exactly the case the repo's own guidance says to clean up. `npm -w packages/qa
run test` stays at 453 passed / 0 failed without them.

### Manual verification is outstanding, and is the user's

The plan's `## Verification` is a bullet list, not numbered steps; its only manual
item is the closing bullet of `## Expected Behaviour`. That bullet, plus the
appearing direction the user found by hand, needs real pointer input and real
paint: drag a `Split` gutter over a scrolling `Panel` both ways and confirm the
content re-flows, the bar tracks the panel edge and appears when the content
starts overflowing, and the shadow edge follows — all during the drag. Nothing in
this run opened a window: no `packages/qa/runqa.sh`, no MiniBrowser, no Tauri
qa-host, no `npm run dev`. Every automated assertion above is offline.

`ScrollStrip` and `VirtualRowView` still carry the same two-hop withholding for
their own resize bursts, which this plan's `## Non-Goals` put out of scope and
which stays out of scope here. Worth recording for whoever picks them up: if
either paints an affordance that only appears on overflow — `ScrollStrip`'s
scroll arrows are the candidate — it has the same appearing-direction defect the
user hit on `Panel`, for the same reason, and no cached signal can fix it either.

Gutter and overlay-scrollbar reachability after the gutter became pure overhang is
already settled — the user confirmed both by hand on the branch below this one —
so this branch does not re-argue it.
