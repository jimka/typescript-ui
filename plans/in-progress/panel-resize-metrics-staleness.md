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
