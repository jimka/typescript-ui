---
depends-on: [scrollstrip-resize-resync-coalescing, resize-settle-afternextlayout-uplift]
touches-shared: [packages/lib/src/typescript/lib/component/container/ScrollStrip.ts, packages/lib/src/typescript/lib/core/Aria.ts]
---

# ScrollStrip Deferred Resync — Implementation Plan

## Overview

In Loom's 2×2 editor grid (four `Tab` panes inside a `Dock`, each with a visible tab strip), dragging the horizontal gutter between the two rows costs ~228 ms per frame in WebKitGTK, while dragging a vertical gutter costs ~105 ms. A per-frame instrument found the difference: four *forced synchronous layouts* per frame — one per tab strip — each with the stack `Component.getScrollLeft ← Component.syncScrollOffsets ← ScrollStrip.layoutItems ← ScrollStrip.layoutContent ← TabBar.layoutChrome ← TabBar.placeStrip ← Tab.doLayout`. A forced synchronous layout happens when code reads scroll geometry after DOM writes in the same frame: the browser must compute layout right then, and computes it again at the end of the frame once more writes land. With `syncScrollOffsets` made a no-op, the horizontal drag fell to 103 ms, the vertical drag's figure.

The read lives in [`ScrollStrip.layoutItems`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L515). `ScrollStrip` already withholds it during a live resize, but only when the clip's *main-axis* extent keeps changing between passes (the settle relay from `plans/implemented/scrollstrip-resize-resync-coalescing.md`: a two-frame `Component.afterNextLayout` relay that withholds the read while the extent keeps moving and catches it up once the extent stops). A horizontal-gutter drag never changes the strip's box at all — `Tab.doLayout` gives a north strip `toolbarW = cs.width` and `toolbarH = thickness` ([Tab.ts:2130-2145](packages/lib/src/typescript/lib/layout/Tab.ts#L2130)), both constant while only the pane's height moves — so every pass looks like a one-off layout and reads live.

This plan changes what decides the read. `layoutItems` compares a *clamp signature* — the two cached numbers the browser's own scroll clamp depends on: the clip's main-axis extent and the laid-out items' far edge — against the previous pass, and performs no read at all when neither moved. The direct cache resync in `layoutItems` is removed; the arrow-enablement read (`refreshArrows`, which resyncs the cache through `mainScroll()`) becomes the only layout-time read, gated by the signature and by the existing settle relay. A second, smaller finding is fixed in the same change: `TabBar`'s tool-group and lead-group `setVisible` calls are already idempotent, but `Aria`'s typed setters rewrite an unchanged `aria-selected` / `aria-hidden` on every pass; `Aria.setAttribute` gets the same unchanged-value guard `Component.setVisible` already has. Files touched: `ScrollStrip.ts`, `Aria.ts`, one stale comment in `TabBar.ts`, tests, and the changelog.

---

## Architecture Decisions

### The read is gated on a clamp signature, not on the main-axis extent alone

`layoutItems` computes, from cached geometry after `_clip.doLayout()`, the clip's main-axis extent and the laid-out items' far main-axis edge (`laidOutItemsExtent()`, below). A pass whose two numbers equal the previous pass's performs no DOM read and arms no settle relay. This mirrors [`Panel.scheduleGutterSettleOnShrink`](packages/lib/src/typescript/lib/core/Panel.ts#L852), which detects a content-extent change from cached data (`_lastContentExtent`) rather than a live read, and reads committed item geometry the way [`TabBar.positionIndicator`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2713) does, folding in the size-stable translate `LayoutManager.commitBounds` may have left.[^signature]

### The layout pass's only read is the arrow refresh; the direct cache resync goes

`layoutItems` no longer calls `_clip.syncScrollOffsets()`, and neither does the settle catch-up. The clip's scroll cache has exactly one reader, `mainScroll()`, and that reader resyncs the cache from the DOM before returning (ScrollStrip.ts:837-841, added by the previous plan). `refreshArrows()` reads through `mainScroll()`, so the one read a layout pass still needs — re-deriving the arrows after the clamp may have moved — happens there.[^cache-readers]

### The two-frame settle relay stays as it is

`scheduleResizeSettle` / `flushResizeSettle` and the `_resizeSettleHandle` field are unchanged in mechanism; only what the relay withholds (the arrow refresh) and what re-arms it (a clamp-signature change) differ. The relay is the established shape for a per-frame cost during a resize burst — a run of layout passes, one per frame, each at a different size — see `Split.scheduleDrag`/`flushDrag`, `Panel`'s `scheduleScrollMetricsSettle`, and `VirtualRowView`'s `scheduleResizeSettle`.

### Rejected: deferring the read to `Component.afterNextLayout`

Moving the read out of the layout pass into an after-layout callback was considered and rejected: the callback still runs inside the same animation frame, before the browser's own layout, so the read still forces one synchronous layout per frame instead of four — not zero — and during a `Split` drag it lands one frame late besides.[^afternextlayout]

### `Aria.setAttribute` gets the unchanged-value guard; the tool/lead group code is not touched

`TabBar.positionToolGroup` and `positionLeadGroup` call `setVisible(false)` or `setVisible(true)` once per pass, never both, and `Component.setVisible`'s guard ([Component.ts:2231](packages/lib/src/typescript/lib/core/Component.ts#L2231)) makes a repeated call a no-op. A recording-sink probe of a repeated `Tab` layout pass shows zero `addClass`/`removeClass` writes and five unconditional attribute rewrites, two of them ARIA: `aria-selected` from `TabBar.prepareStrip` (TabBar.ts:2833-2835) and `aria-hidden` from `Tab.doLayout` (Tab.ts:2113, 2228). Both route through [`Aria.setAttribute`](packages/lib/src/typescript/lib/core/Aria.ts#L789), which writes without comparing against its own `_attributes` cache. The guard goes there — the typed-setter level, where `setVisible`, `setDisplayed`, and `setX` already guard — not into `ElementAttributes`.[^aria-guard]

### Names follow the new meaning

Three private members are renamed because their old names describe a resync that no longer happens: `_scrollResyncOwed` → `_arrowRefreshOwed`, `_clipExtentMoved` → `_clampMoved`, `_deferScrollResyncThisPass` → `_refreshArrowsThisPass` (polarity inverted: `true` means *do* refresh), and `deferScrollResyncWhileResizing` → `arrowRefreshDueThisPass` (same inversion). `_lastClipExtent`, `_resizeSettleHandle`, `scheduleResizeSettle`, and `flushResizeSettle` keep their names.

---

## Internal Structure

### `ScrollStrip` fields (replace [ScrollStrip.ts:186-207](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L186))

```typescript
// The clip's own main-axis extent as of the last pass — one half of the
// clamp signature layoutItems compares (the cached counterpart of the
// clip's clientWidth / clientHeight). -1 until the first pass, so the
// very first pass always counts as a change.
private _lastClipExtent: number = -1;

// The laid-out items' far main-axis edge as of the last pass — the other
// half of the clamp signature (the cached counterpart of the clip's
// scrollWidth / scrollHeight). -1 until the first pass.
private _lastItemsExtent: number = -1;

// Whether a withheld pass still owes the arrow-enablement read once the
// current resize burst settles.
private _arrowRefreshOwed: boolean = false;

// Whether the clamp signature moved again after the settle relay was armed.
private _clampMoved: boolean = false;

// The afterNextLayout relay armed to end a resize burst, or null when none
// is in flight.
private _resizeSettleHandle: { cancel(): void } | null = null;

// Set by layoutItems on every pass; layoutArrows reads it to decide whether
// this pass performs the arrow-enablement read.
private _refreshArrowsThisPass: boolean = false;
```

### `layoutItems` (replace [ScrollStrip.ts:499-532](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L499))

```typescript
/**
 * Lays out the inner clip's box, sizing the items, then decides whether
 * this pass must re-derive the arrows' enabled state. Call after
 * positioning the band (see {@link layoutContent}).
 *
 * The decision compares a clamp signature against the previous pass: the
 * clip's main-axis extent and the laid-out items' far edge, both from
 * cached geometry. Only those two numbers can move the browser's own
 * scroll clamp (the browser clamps the native offset when the content
 * lays out smaller than the current offset), so a pass where neither
 * changed reads nothing from the DOM. A pass where one changed reads live,
 * unless a resize burst is in flight — a live external resize, e.g. a
 * `Split` gutter drag resizing the strip's owner — in which case the read
 * is withheld until a couple of quiet frames confirm the resize stopped.
 * {@link mainScroll} always resyncs the cached offset for itself, so a
 * reveal or a within-strip reorder drag never sees a stale position.
 *
 * @returns This strip, for method chaining.
 */
layoutItems(): this {
    this._clip.doLayout();

    const clipExtent = this.isVertical() ? this._clip.getHeight() : this._clip.getWidth();
    const itemsExtent = this.laidOutItemsExtent();
    const clampChanged = clipExtent !== this._lastClipExtent || itemsExtent !== this._lastItemsExtent;

    if (clampChanged) {
        this._lastClipExtent = clipExtent;
        this._lastItemsExtent = itemsExtent;
    }

    this._refreshArrowsThisPass = this.arrowRefreshDueThisPass(clampChanged);

    return this;
}
```

### `laidOutItemsExtent` (new, placed directly after `layoutItems`)

```typescript
/**
 * The far main-axis edge of the laid-out items, from the geometry the
 * clip's box just committed — the cached counterpart of the browser's
 * `scrollWidth` / `scrollHeight`. Folds in the translate a size-stable
 * move may have left on an item (see `LayoutManager.commitBounds`), the
 * same way `TabBar.positionIndicator` does. Undisplayed items are skipped,
 * matching what the box itself lays out.
 *
 * @returns The largest item end offset in px, or 0 with no laid-out items.
 */
private laidOutItemsExtent(): number {
    const vertical = this.isVertical();
    let end = 0;

    for (const item of this._clip.getLaidOutComponents()) {
        const start = vertical ? item.getY() + item.getTranslateY() : item.getX() + item.getTranslateX();
        const extent = vertical ? item.getHeight() : item.getWidth();

        end = Math.max(end, start + extent);
    }

    return end;
}
```

`HBox` places children starting at the clip's leading inset ([HBox.ts:321](packages/lib/src/typescript/lib/layout/HBox.ts#L321), [:351](packages/lib/src/typescript/lib/layout/HBox.ts#L351), [:526](packages/lib/src/typescript/lib/layout/HBox.ts#L526)), so the `endGap` inset `layoutContent` writes is already part of each item's committed position; the signature needs no separate inset term.

### `arrowRefreshDueThisPass` (replaces `deferScrollResyncWhileResizing`, [ScrollStrip.ts:534-578](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L534))

```typescript
/**
 * Decides whether this layout pass performs the arrow-enablement read, and
 * arms (or extends) the settle relay that catches a withheld read up once
 * a resize burst goes quiet. Mirrors `Split.scheduleDrag`/`flushDrag`,
 * which solves the same class of problem one layer up (a live pane resize).
 *
 * @param clampChanged - Whether this pass's clamp signature differs from
 *   the previous pass's.
 *
 * @returns `true` when the caller must read live this pass.
 *
 * @remarks Whether a settle relay is already armed decides first: a pass
 * that finds one armed never reads, and marks a read as owed only when its
 * own signature moved, so an unchanged pass mid-burst owes nothing. With
 * no relay armed, an unchanged signature reads nothing and arms nothing —
 * the horizontal-gutter case, where the strip's box never moves — while
 * a changed signature reads live and arms the relay, so a one-off resize
 * (a sidebar toggle, a window resize, opening or closing a tab) lands
 * accurate on its own frame and only the second and later changes of a
 * burst are withheld. {@link flushResizeSettle} performs the catch-up.
 */
private arrowRefreshDueThisPass(clampChanged: boolean): boolean {
    if (this._resizeSettleHandle !== null) {
        if (clampChanged) {
            this._clampMoved = true;
            this._arrowRefreshOwed = true;
        }

        return false;
    }

    if (!clampChanged) {
        return false;
    }

    this.scheduleResizeSettle();

    return true;
}
```

### `flushResizeSettle` (replace the body at [ScrollStrip.ts:624-641](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L624))

```typescript
private flushResizeSettle(): void {
    this._resizeSettleHandle = null;

    if (this._clampMoved) {
        this._clampMoved = false;
        this.scheduleResizeSettle();

        return;
    }

    if (!this._arrowRefreshOwed) {
        return;
    }

    this._arrowRefreshOwed = false;
    this.refreshArrows();
}
```

`flushResizeSettle`'s doc comment changes from "the native scroll-offset resync and the arrow-enablement read" to "the arrow-enablement read (which resyncs the cached offset on its way through `mainScroll`)". `scheduleResizeSettle`'s doc comment ([:580-615](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L580)) mentions `_clipExtentMoved` once; rename it there to `_clampMoved`.

### `layoutArrows` gate (replace [ScrollStrip.ts:784-790](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L784))

```typescript
// Only when layoutItems found the clamp signature moved and no resize
// burst is in flight (see arrowRefreshDueThisPass); flushResizeSettle
// catches a withheld read up once the burst goes quiet.
if (this._refreshArrowsThisPass) {
    this.refreshArrows();
}
```

Everything else in `layoutArrows` — `ensureArrows()`, the glyph and visibility writes, the position and size writes — stays unconditional.

### `Aria.setAttribute` (replace [Aria.ts:789-792](packages/lib/src/typescript/lib/core/Aria.ts#L789))

```typescript
private setAttribute(name: string, value: string): void {
    if (this._attributes.get(name) === value) {
        return;
    }

    this._attributes.set(name, value);
    this._component.applyAriaAttribute("aria-" + name, value);
}
```

Add one sentence to its doc comment: a value equal to the cached one writes nothing, mirroring `Component.setVisible`'s guard. The removal paths (`setExpanded(null)` at [Aria.ts:317](packages/lib/src/typescript/lib/core/Aria.ts#L317), `setActiveDescendant("")` at [:426](packages/lib/src/typescript/lib/core/Aria.ts#L426), `setValueMin`/`setValueMax` with `null`) delete the key from `_attributes`, so a value set again after a removal still writes.

### The rule, worked through

Each row is one `layoutContent` pass. "Read" means `refreshArrows()` runs this pass (one `syncScrollOffsets` through `mainScroll`, one `getScrollMetrics` through `mainScrollMax`).

| Pass | Clip extent | Items' far edge | Relay armed before? | Read this pass? | Relay after |
|---|---|---|---|---|---|
| First layout ever (baselines are `-1`) | changed | changed | no | yes, live | armed |
| Horizontal-gutter drag, every frame (strip box unchanged) | same | same | no | **no** | not armed |
| Vertical-gutter drag, frame 1 | changed | — | no | yes, live | armed |
| Vertical-gutter drag, frames 2..N | changed | — | yes | no — withheld, owed | extended |
| Same-signature pass mid-burst | same | same | yes | no — nothing owed by this pass | unchanged |
| Tab opened/closed, compact toggle, width-mode change at a fixed strip width | same | changed | no | yes, live | armed |
| Settle relay, first quiet cycle | — | — | — | yes, only if owed | cleared |
| `mainScroll()` called directly (reveal, arrow click, reorder drag) | — | — | irrelevant | always resyncs | unchanged |

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — fields.** Replace the six field declarations at [:186-207](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L186) with the block in *Internal Structure* (adds `_lastItemsExtent`; renames three fields). Checkpoint: `grep -n '_scrollResyncOwed\|_clipExtentMoved\|_deferScrollResyncThisPass' packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — expect only the not-yet-edited method bodies from steps 2-4 to match.

2. **`ScrollStrip.ts` — `layoutItems` and `laidOutItemsExtent`.** Replace `layoutItems` ([:499-532](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L499)) with the *Internal Structure* version and insert `laidOutItemsExtent` directly after it. `Component.getLaidOutComponents` ([Component.ts:7000](packages/lib/src/typescript/lib/core/Component.ts#L7000)) is public; no new import.

3. **`ScrollStrip.ts` — `arrowRefreshDueThisPass`.** Replace `deferScrollResyncWhileResizing` ([:534-578](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L534)) with the *Internal Structure* version, keeping its position (before `scheduleResizeSettle`).

4. **`ScrollStrip.ts` — relay doc and `flushResizeSettle`.** In `scheduleResizeSettle`'s doc comment ([:580-615](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L580)) rename the one `_clipExtentMoved` mention to `_clampMoved`. Replace `flushResizeSettle` ([:617-641](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L617)) with the *Internal Structure* version and adjust its doc comment as described there.

5. **`ScrollStrip.ts` — `layoutArrows` gate.** Replace the gated block at [:784-790](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L784) with the *Internal Structure* version. Change `layoutContent`'s doc-comment phrase "resyncs the cached scroll offset" ([:711](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L711)) to "re-derives the arrows when the layout could have moved the scroll clamp".

   Checkpoint: `grep -n 'syncScrollOffsets' packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — expect exactly one match, inside `mainScroll`. `grep -n '_scrollResyncOwed\|_clipExtentMoved\|_deferScrollResyncThisPass\|deferScrollResyncWhileResizing' packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — expect zero matches. `npm run typecheck` from the repo root — clean.

6. **`packages/lib/src/typescript/lib/component/container/TabBar.ts` — stale comment only.** Rewrite the comment at [:2905-2911](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2905) ("… and resync its cached scroll offset. The resync matters because …") to: the strip lays out its clip, places the arrows, and re-derives their enabled state only when the layout could have moved the scroll clamp; `revealSelectedIfRequested` is unaffected because `revealItem` reads the offset through `mainScroll()`, which resyncs for itself. No code change in this file.

7. **`packages/lib/src/typescript/lib/core/Aria.ts` — the guard.** Replace `setAttribute` ([:789-792](packages/lib/src/typescript/lib/core/Aria.ts#L789)) with the *Internal Structure* version and extend its doc comment by one sentence.

8. **Update `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts`.**
   - Rewrite the header comment (lines 3-12) and the constants block ([:51-61](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L51)): `SYNC_PER_LIVE_PASS = 1` (the only `syncScrollOffsets` call on a live pass is `refreshArrows → mainScroll`), `REFRESH_PER_LIVE_PASS = 1`.
   - In `'extends the burst when a change lands between the settle relay's two hops'` ([:231-271](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L231)) replace every `_clipExtentMoved` with `_clampMoved`.
   - Rewrite `'tracks height, not width, for a vertical strip'` ([:291-316](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L291)) to *Expected Behaviour* case 5: the cross-axis-only pass now expects `0` sync and `0` refresh calls and a null `_resizeSettleHandle`; the main-axis pass expects `SYNC_PER_LIVE_PASS` / `REFRESH_PER_LIVE_PASS` and a non-null handle.
   - Add cases 4 and 6 from *Expected Behaviour* as new `it` blocks; cases 7 and 8 already exist and only take the new constants. Case 6 needs the strip's item count to change: `strip.removeItem(strip.getItems()[6])` after mount and drain, then `layoutAt(strip, W1)` again at the same width.

9. **Update `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts`.** Same constants change ([:54-60](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts#L54)) and header-comment fix; add *Expected Behaviour* case 9 as a new `it`: a `realDragFrame`-style helper that changes only the band's height (`strip.setHeight(BAND_THICKNESS + frame)` with the width fixed at 200) for 20 frames, draining queued frames before each as `advanceDragFrame` does — after the mount frame and a `drainFrames()`, neither spy is called and `_resizeSettleHandle` stays `null` throughout.

10. **Create `packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts`** — *Expected Behaviour* cases 10 and 11. Build the host with the `hostTab()` helper from [`Tab.tabModified.test.ts:25-35`](packages/lib/tests/layout/Tab.tabModified.test.ts#L25) (one `Component` child, `host.doLayout()`), install the `Map`-keyed `requestAnimationFrame` capture and `drainFrames()` from `ScrollStrip.resizeResyncCoalescing.test.ts` ([:67-115](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts#L67)) so the mount pass's relay resolves, reach the strip via `(tab as any)._bar._tabClip`, and spy on `DOM.source.getScrollLeft`, `DOM.source.getScrollTop`, and `DOM.source.getScrollMetrics`. Keep the recording sink `installTestDOM` returns and fold its `apply` patches per handle the way [`ElementAttributeReplay.test.ts:22-38`](packages/lib/tests/core/ElementAttributeReplay.test.ts#L22) does.

11. **Create `packages/lib/tests/component/container/TabBar.chromeIdempotency.test.ts`** — *Expected Behaviour* case 12. Build a `TabBar` with two `createBarEntry` calls, one `addTool(new Button({ text: 'T' }))`, and one `setLeadingWidget(new Button({ text: 'L' }))` (a widget with a measured preferred size, so the lead group is shown); realise it with `bar.getElement(true)`; drive a pass with `bar.prepareStrip(); bar.placeStrip(0, 0, 400, 32);` (the sequence `Tab.doLayout` uses, [Tab.ts:2122](packages/lib/src/typescript/lib/layout/Tab.ts#L2122) and [:2218](packages/lib/src/typescript/lib/layout/Tab.ts#L2218)).

12. **Add cases 13-15 to `packages/lib/tests/core/Aria.test.ts`** in a new `describe('Aria — unchanged writes are skipped')` block. These need a materialised element and the recording sink: `installTestDOM(CONFIG)` (copy `CONFIG` from `ElementAttributeReplay.test.ts`), `const c = new Component(); c.getElement(true);`, then count `sink.writes` entries whose `op === 'apply'` and whose patch carries `setAttr['aria-hidden']` (or the attribute under test). Call `DOM.reset()` in `afterEach` as the sibling files do.

13. **Changelog.** Add the entry from *Documentation Impact* to `packages/lib/docs/reference/changelog/next.md` under `## Fixed` → `### Components`, directly after the existing ScrollStrip entry that ends at [:389](packages/lib/docs/reference/changelog/next.md#L389).

14. **Typecheck, lint, test.** `npm run typecheck`, `npm run lint`, then the commands in *Verification*, including the full suite.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` (one comment) |
| Modify | `packages/lib/src/typescript/lib/core/Aria.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts` |
| Create | `packages/lib/tests/layout/Tab.stripRelayoutEconomy.test.ts` |
| Create | `packages/lib/tests/component/container/TabBar.chromeIdempotency.test.ts` |
| Modify | `packages/lib/tests/core/Aria.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable offline with `installTestDOM`, the captured-frame harness (`requestAnimationFrame` keyed in a `Map`, `runQueuedFramesOnce()` / `drainFrames()`), and `vi.spyOn` on `(strip as any)._clip.syncScrollOffsets` and `strip.refreshArrows` — the same harness the two existing coalescing files use. A "live pass" calls `syncScrollOffsets` exactly once (via `refreshArrows → mainScroll`) and `refreshArrows` exactly once; a "silent pass" calls neither.

### `ScrollStrip` — the clamp signature and the relay

1. **Mount is a live pass and arms the relay.** One `layoutAt(strip, W1)` on an overflowing strip: 1 sync, 1 refresh, `_resizeSettleHandle` not null. (Existing case, new counts.)
2. **A second width change in the same burst is withheld.** `layoutAt(W1)` then `layoutAt(W2)` without draining: still 1 / 1; `_clip.getWidth()` already reports `W2 - 2 * SCROLL_ARROW_SIZE`. Draining then performs exactly one catch-up (2 / 2). (Existing cases, new counts.)
3. **A same-signature pass mid-burst owes nothing.** `layoutAt(W1)`, `layoutAt(W2)`, `layoutAt(W2)`: still 1 / 1; draining performs exactly one catch-up, not two. (Existing case; the "not two" assertion is new.)
4. **An unchanged signature with no relay armed is a silent pass.** `layoutAt(W1)`, `drainFrames()` (relay resolves, nothing owed), then `layoutAt(W1)` again: 0 further sync, 0 further refresh, `_resizeSettleHandle` null.
5. **A cross-axis-only change is a silent pass, on either orientation.** Horizontal strip: after mount and drain, `strip.setHeight(BAND_THICKNESS + 20)` then `layoutContent(reserve, 0)` at the same width: 0 / 0, handle null. Vertical strip: the same with the width. Then a main-axis change on each is a live pass that arms the relay. (Replaces the existing vertical-only case.)
6. **An items-extent change at a fixed clip extent is a live pass.** After mount and drain, `strip.removeItem(...)` one item, then `layoutAt(W1)` at the unchanged width: 1 further sync, 1 further refresh, handle not null.
7. **`mainScroll()` resyncs immediately regardless of the relay.** From case 2's withheld state, `strip.mainScroll()` adds exactly one sync call and no refresh call. (Existing case, new counts.)
8. **Teardown mid-burst cancels the relay.** `dispose()` from case 2's state: handle null; draining runs neither spy and throws nothing. (Existing case, unchanged.)

### `ScrollStrip` — realtime (one pass per frame)

9. **A height-only per-frame drag never reads and never arms.** Mount at width 200, drain; then 20 frames that change only the band height, each preceded by `runQueuedFramesOnce()`: 0 sync, 0 refresh across the whole drag, `_resizeSettleHandle` null after every frame. The existing width-drag cases keep passing with the new constants.

### `Tab`-hosted strip (Loom's shape)

10. **A pane height change alone reads nothing from the strip.** `hostTab()` with one child, `host.doLayout()`, `drainFrames()`; then `host.setHeight(310); host.doLayout()`: zero calls to `DOM.source.getScrollLeft` / `getScrollTop` / `getScrollMetrics`, and the strip's `_resizeSettleHandle` is null.
11. **A repeated pass writes no ARIA and toggles no class.** Same setup; after the second `doLayout()` clear `sink.writes`, run a third with `host.setHeight(320)`: no `apply` patch carries `addClass` or `removeClass`, and none carries a `setAttr` key starting with `aria-`.

### `TabBar` chrome idempotency

12. **Tool and lead groups are not re-hidden or re-shown on an unchanged pass.** Two passes of `prepareStrip(); placeStrip(0, 0, 400, 32)`, clear `sink.writes`, a third identical pass: no `apply` patch carries `addClass`/`removeClass` on any handle, and no `setAttr` key starts with `aria-`. `_toolGroup.isVisible()` is `true` and `_leadGroup.isVisible()` is `true` before and after. Repeat with no tools and no leading widget: both groups report `false` before and after, still with no class or ARIA writes.

### `Aria`

13. **A repeated setter with the same value writes nothing.** `c.getAria().setHidden(true)` twice on a materialised component: exactly one `apply` patch with `setAttr['aria-hidden'] === 'true'`; `getHidden()` is `true`.
14. **A changed value writes.** `setHidden(true)` then `setHidden(false)`: two patches, the second with `'false'`.
15. **A value set again after a removal writes.** `setExpanded(true)`, `setExpanded(null)`, `setExpanded(true)`: three patches — set, `removeAttr` containing `aria-expanded`, set again.

### Manual verification (WebKitGTK; pointer drag and paint are not exercisable offline)

- The horizontal-gutter drag in Loom's 2×2 grid costs what the vertical-gutter drag costs (see *Verification*).
- After a vertical-gutter drag over an overflowing strip settles, the paging arrows are enabled/disabled correctly for the final width, and a tab selected during the drag is revealed into view.
- Closing a tab at a fixed pane width leaves the arrows correct on that same frame (a live pass, case 6).

---

## Verification

- **Typecheck:** `npm run typecheck` (clean). **Lint:** `npm run lint` (clean).
- **Unit tests**, from `packages/lib`:
  ```
  npx vitest run tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts \
    tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts \
    tests/component/container/ScrollStrip.test.ts \
    tests/component/container/ScrollStrip.classStyleHoisting.test.ts \
    tests/component/container/TabBar.chromeIdempotency.test.ts \
    tests/component/container/TabBar.test.ts tests/component/container/TabBar.tools.test.ts \
    tests/component/container/TabBar.leadingWidgetChrome.test.ts \
    tests/layout/Tab.stripRelayoutEconomy.test.ts tests/layout/Tab.tabModified.test.ts \
    tests/core/Aria.test.ts tests/core/ElementAttributeReplay.test.ts tests/core/AfterNextLayout.test.ts
  ```
- **Full suite:** `npm run test` from `packages/lib`. `Aria` is used by every component, so the full suite is the gate for step 7; a failure there is most likely a test counting redundant ARIA writes (see *Potential Challenges*).
- **Grep invariants:** the checkpoints in steps 1 and 5.
- **Build and docs:** `npm run build:lib`; `npm run docs:api` finishes with no new warnings (no public JSDoc `{@link}` to a private symbol was added — `layoutItems`'s comment names `mainScroll`, which is public, and describes the private helpers in prose).
- **WebKitGTK harness (run by the requester, not the implementer):** the per-frame instrument the requester keeps as `qa-harness.ts` in the Loom session's scratchpad (it was lost in a reboot and must be recreated from its recording before this check), run against the Loom shell in MiniBrowser with the same library build, parameters `tabs=4&grid=2x2&gutter=dock-h&count=1`. Expected: the forced-read counter lists no read whose stack contains `ScrollStrip`, `TabBar`, or `Tab.doLayout`; the drag's per-frame cost matches the vertical-gutter run of the same harness (~103 ms today, against 228 before); the attribute counters show no `aria-*` writes per strip per frame. If a class add/remove per strip per frame is still reported, capture its stack before changing anything — the offline probe reproduced none, and `setVisible` is already guarded.[^class-toggle-not-reproduced]

---

## Documentation Impact

No public API changes: `layoutContent`, `layoutItems`, `mainScroll`, `refreshArrows`, and every `Aria` setter keep their signatures and consumer-visible behaviour. `packages/lib/docs/components/ScrollStrip.md` describes `layoutContent` as "lay out the items, and place/enable the arrows" and names `mainScroll` as the single source of truth — both still true; no page edit.

Changelog entry for `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components`, after the existing ScrollStrip entry:

> - **Resizing a `Tab` pane on the axis its strip does not scroll along — e.g. dragging the horizontal gutter between two rows of editor panes — no longer forces a synchronous layout per visible tab strip on every frame.** `ScrollStrip` now re-reads scroll geometry only when a layout pass could have moved the browser's scroll clamp (its clip's main-axis extent or the laid-out items' far edge changed), instead of on every pass the resize-burst detector did not recognise as a burst; a pass that changes nothing the clamp depends on reads nothing. `Aria`'s typed setters also skip a write whose value is unchanged, so a tab strip's per-pass `aria-selected` / `aria-hidden` refresh no longer rewrites attributes that already hold the value. No consumer action is needed.

---

## Potential Challenges

- **The offline sink never fires `requestAnimationFrame`.** After the mount pass, the relay stays armed forever unless the test installs the `Map`-keyed capture and drains it; a test that forgets this sees "withheld" instead of "silent" and cannot tell the two apart. Every new test drains after mount before asserting a silent pass.
- **`getLaidOutComponents` excludes undisplayed items.** That is the intended set (the box lays out the same one), but a test that hides an item with `setDisplayed(false)` must expect the signature to change on that pass.
- **Tests that count ARIA writes.** `grep -rln "aria-" packages/lib/tests` at implementation time and read any file that asserts an exact number of `aria-*` `apply` patches; a repeated same-value write now produces one patch, not two. Fix such a test's count, never the guard.
- **Renamed private fields are read by tests.** Step 8 covers the one existing test that reaches `_clipExtentMoved`; the step-5 grep confirms no old name survives in source, and `grep -rn '_clipExtentMoved\|_scrollResyncOwed\|_deferScrollResyncThisPass' packages/lib/tests` must return zero matches after step 9.
- **The first pass of a freshly built strip still arms one relay** (`-1` baselines), as before; it reads live and owes nothing at settle. Case 1 accounts for it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts) — the main change. Read the fields ([:186-207](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L186)), `layoutItems` through `flushResizeSettle` ([:499-641](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L499)), `layoutContent` ([:721-750](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L721)), `layoutArrows` ([:763-818](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L763)), `mainScroll`/`mainScrollMax`/`refreshArrows` ([:837-898](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L837)), `destructor` ([:1020-1029](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L1020)).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — `scheduleGutterSettleOnShrink` ([:852-885](packages/lib/src/typescript/lib/core/Panel.ts#L852)): the precedent for detecting a content-extent change from cached data; `doLayout` ([:650-705](packages/lib/src/typescript/lib/core/Panel.ts#L650)): confirms `_clip.doLayout()` reads nothing at `autoScroll: "none"`.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `positionIndicator`'s translate fold ([:2713-2720](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2713)), the precedent for reading committed item geometry; `prepareStrip` ([:2829-2838](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2829)) and `layoutChrome` ([:2874-2925](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2874)); `positionToolGroup`/`positionLeadGroup` ([:2626-2693](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2626)), which are not modified.
- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `doLayout` ([:2057](packages/lib/src/typescript/lib/layout/Tab.ts#L2057)): the strip rect math ([:2130-2165](packages/lib/src/typescript/lib/layout/Tab.ts#L2130)) that leaves the strip's box unchanged during a horizontal-gutter drag, and the `aria-hidden` writes ([:2113](packages/lib/src/typescript/lib/layout/Tab.ts#L2113), [:2228](packages/lib/src/typescript/lib/layout/Tab.ts#L2228)).
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` ([:547-577](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L547)): the size-stable translate fast path `laidOutItemsExtent` folds back in.
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts) — placement starts at the container's leading inset ([:321](packages/lib/src/typescript/lib/layout/HBox.ts#L321)), so the `endGap` inset is already inside each item's position.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setVisible` and its guard ([:2211-2252](packages/lib/src/typescript/lib/core/Component.ts#L2211)), `setStyleState` ([:6164-6183](packages/lib/src/typescript/lib/core/Component.ts#L6164)), `getScrollLeft` ([:4314-4325](packages/lib/src/typescript/lib/core/Component.ts#L4314)), `syncScrollOffsets` ([:4418-4440](packages/lib/src/typescript/lib/core/Component.ts#L4418)), `getMaxScrollLeft` ([:4539-4548](packages/lib/src/typescript/lib/core/Component.ts#L4539)), `getLaidOutComponents` ([:7000](packages/lib/src/typescript/lib/core/Component.ts#L7000)), `applyAriaAttribute` ([:5148-5156](packages/lib/src/typescript/lib/core/Component.ts#L5148)), `afterNextLayout` and `flushPendingLayouts` ([:7360-7376](packages/lib/src/typescript/lib/core/Component.ts#L7360), [:192-240](packages/lib/src/typescript/lib/core/Component.ts#L192)).
- [`packages/lib/src/typescript/lib/core/Aria.ts`](packages/lib/src/typescript/lib/core/Aria.ts) — `setAttribute` ([:789-792](packages/lib/src/typescript/lib/core/Aria.ts#L789)) and the removal paths ([:313-322](packages/lib/src/typescript/lib/core/Aria.ts#L313), [:424-428](packages/lib/src/typescript/lib/core/Aria.ts#L424)).
- [`packages/lib/src/typescript/lib/core/ElementAttributes.ts`](packages/lib/src/typescript/lib/core/ElementAttributes.ts) — `set` ([:30-38](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L30)) and `attach` (writes the whole retained state on re-render), which is why the guard can sit above it.
- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `onDrag`/`scheduleDrag`/`flushDrag` ([:1085-1132](packages/lib/src/typescript/lib/layout/Split.ts#L1085)): the driver that calls `doLayout()` directly once per frame.
- `plans/implemented/scrollstrip-resize-resync-coalescing.md` and `plans/implemented/resize-settle-afternextlayout-uplift.md` — the two plans this one extends; read their Implementation Notes for the relay's two-hop reasoning and the `mainScroll()` backstop.
- [`packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts`](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts), [`…Realtime.test.ts`](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescingRealtime.test.ts) — the harness and helpers every new test copies; [`packages/lib/tests/layout/Tab.tabModified.test.ts`](packages/lib/tests/layout/Tab.tabModified.test.ts) — `hostTab()`; [`packages/lib/tests/core/ElementAttributeReplay.test.ts`](packages/lib/tests/core/ElementAttributeReplay.test.ts) — folding recorded `apply` patches per handle.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the `DOM.source` seam (no raw DOM access is added), the typed-setter and cache rules the `Aria` guard follows, and the "Defer DOM work to render time" measurement rule.

---

## Non-Goals

- **CodeMirror's own per-frame `getBoundingClientRect`** — present in every run, unchanged by this plan.
- **The `Split` drag path itself** — the external driver; not part of the mechanism.
- **Other layout-time DOM reads elsewhere in the library** — listed as follow-ups for the same harness to find.[^other-layout-reads]
- **Redundant `data-insets` rewrites** — `Component.setInsets`/`clearInsets` write the debug attribute unconditionally each pass (three per strip in the probe); a plain write with no layout cost, left for a follow-up alongside the reads above.
- **A guard inside `ElementAttributes.set`** — rejected in *Architecture Decisions*; idempotency lives at the typed setter in this codebase.
- **Changing `Component.syncScrollOffsets` or `mainScroll()`** — both keep their contracts; the plan only removes callers.

---

## Notes

[^signature]: Two triggers were weighed against the code here; a third, deferring the read to `Component.afterNextLayout`, has its own decision above. (a) *Gate on anything that can move the clamp* — this plan. The browser clamps `scrollLeft` to `[0, scrollWidth - clientWidth]`; `clientWidth` is the clip's main-axis extent, already cached as `_lastClipExtent`, and `scrollWidth` is the laid-out content's far edge, which the box has just committed to each item's cached `x`/`width` (plus the translate `commitBounds` may substitute for a same-size move). If neither number changed, the clamp did not change, so the cached offset is exactly as authoritative as `Component.getScrollLeft`'s doc says it is for a host-driven strip. (b) *Treat any change to the clip's box on either axis, or any `Split` drag, as a burst* — does not fire in the measured case at all: `Tab.doLayout` sizes a north strip to `cs.width × thickness`, so a horizontal-gutter drag leaves the strip's and the clip's box byte-for-byte unchanged on both axes; and a drag signal from `Split` was already rejected by the previous plan (no ancestor walk, no emitter-side change, covers every driver). Reading the committed item geometry rather than the box's `getPreferredSize()` (what `Panel.scheduleGutterSettleOnShrink` uses) is deliberate: preferred and laid-out extents diverge in `equal`/`fill` box modes and under `applyTabWidths`'s min/max clamps, whereas the committed geometry is what the browser lays out. This is change *detection* from cached numbers, not a re-implementation of the browser's clamp arithmetic — the previous plan's rejection of deriving the clamped *value* in JS still stands; the value is still read from the DOM whenever a read is due.

[^cache-readers]: Every reader of the clip's scroll cache was enumerated. `grep -rn '_clip\.getScroll\|_tabClip\.getScroll' packages/lib/src` matches one line, `mainScroll()` (ScrollStrip.ts:840), which calls `_clip.syncScrollOffsets()` first (ScrollStrip.ts:838). `setScrollLeft`/`setScrollTop` read the clamped value back after every write (Component.ts:4353, 4376). The framework's own consumers of a cached offset — `captureSubtreeScroll`/`restoreSubtreeScroll` and `reapplyCachedScroll` — walk `getComponents()`, and the clip is raw-appended into the strip (ScrollStrip.ts:266), the strip into the bar (TabBar.ts:768), and the bar into the `Tab` container (Tab.ts:985), so no recursion reaches it. The clip's overflow is `hidden`, so no wheel scroller reads it. The `Tab`/`Dock` capture on undisplay reaches only page content. With no reader left that does not resync first, a layout-time resync refreshes a value nobody consumes; the previous plan's test constants already document that every live pass performed the read twice (`SYNC_PER_LIVE_PASS = 2`), once directly and once through `refreshArrows → mainScroll`.

[^afternextlayout]: `Component.afterNextLayout` callbacks drain at the end of `flushPendingLayouts` (Component.ts:192-240), i.e. inside the same `requestAnimationFrame` callback, before the browser runs style and layout for the frame. A scroll-geometry read there still forces a synchronous layout — one per frame for all four strips instead of four, because nothing writes between the four reads — which the success criterion (zero forced reads from the strip) rules out, and which still costs one extra layout of four CodeMirror editors per frame. During a `Split` drag the pass is driven by `Split.flushDrag`'s own `requestAnimationFrame` (Split.ts:1107-1132), not by `flushPendingLayouts`, so a callback registered during the pass would fire in the *next* frame's flush, after that frame's writes — the same ordering that forced the two-hop settle relay in the first place. Deferring the read moves it; only not needing it removes it.

[^aria-guard]: The probe: an offline `Tab` host with one child, laid out twice, then a third pass with a height-only change while every recording-sink write was captured. The third pass produced 17 `apply` patches, none with `addClass`/`removeClass`, and five attribute rewrites with unchanged values: `aria-selected="true"` on the tab button, `aria-hidden="false"` on the page content, and `data-insets` on the button, the bar, and the clip. The same result held for a tab with a glyph and a modified badge, and for a width change. So the counters' "two aria changes per strip per frame" are `prepareStrip`'s `setSelected` and `Tab.doLayout`'s `setHidden`, not the group visibility. `Aria.setAttribute` → `Component.applyAriaAttribute` → `setElementAttribute` → `ElementAttributes.set` has no comparison anywhere on the path; `InlineStyle`/`StyleRule` have none either — in this codebase the comparison belongs to the typed setter that owns the cache (`setVisible` at Component.ts:2231, `setDisplayed` at :2308, `setStyleState` at :6165, `setX`/`setWidth` per the comment at TabBar.ts:2737). `Aria` owns `_attributes`, so the guard goes in its one private write path. It is safe across re-renders because `ElementAttributes.attach` rewrites the whole retained state onto a rebuilt element (Component.ts:7509, 7582), and safe against the only other `aria-hidden` writers (`Glyph.ts:718`, `Glyphs.ts:119`) because those patch their own SVG elements directly, not a component's `Aria`. A guard inside `ElementAttributes.set` would cover `data-insets` too but would change every attribute write in the library and break any test counting them; the narrower guard fixes what the counters saw.

[^class-toggle-not-reproduced]: The requester's counters also reported one `.invisible` add and one remove per strip per frame. No code path reproduces it: `positionToolGroup` and `positionLeadGroup` each call `setVisible` once per pass with the same value every frame, `layoutArrows` shows arrows only when they exist, `positionModifiedBadge`'s `setVisible(shown)` is likewise guarded, and `TabIndicator.slideTo` writes translate and inline box styles only. The probe (a plain tab, a glyph-and-modified tab, height-only and width changes) recorded no class writes on a repeated pass. Loom's `node_modules/@jimka/typescript-ui` resolves to this repository's `packages/lib`, so the harness ran this same source. The plan therefore pins the idempotency with tests (cases 11 and 12) rather than changing the group code, and asks for a stack before any further change.

[^other-layout-reads]: Every `DOM.source` read that forces layout (`getElementRect`, `getScrollMetrics`, `getOffsetSize`, `getBorderWidths`, `getComputedOverflow`, `getScrollLeft`/`getScrollTop`, `getViewportRect`, `isRenderedVisible`, `getNaturalSize`) was mapped to its enclosing method. Two still run on a layout pass: `FloatingPanel.placeNextTo` (FloatingPanel.ts:223, `getElementRect` of the text column, called from `MarkdownViewer.doLayout` at MarkdownViewer.ts:220-221 and `DocsShell` at DocsShell.ts:132-133 on every pass — by design, to read a CSS-capped rendered width) and `CodeEditor.syncAutoHeight` (CodeEditor.ts:2339-2531, six reads, auto-height mode only, driven from `onEffectiveVisibilityChange` and a one-shot `afterNextLayout` after mount). `Panel.remeasureScrollMetrics` is already gated by its own settle relay. The rest are one-shot or gesture-driven: `Markdown.measureContentHeight`/`resyncCodeEditorWidths` (`setMarkdown`, `setWidth`, theme change, a scheduled measure), `Markdown.isBlockNearViewport`/`onViewportPass` (scroll-driven), `Accordion.primeWrapper` (section open), `AbstractWindow.computeMaximizeRect`/`pickSnapBorder`/`openWindowMenu` (window gestures), `AbstractChart.clearMarks` (`getElementRect` of the SVG, on data change), `Menu`/`Tooltip`/`Popover`/dropdown anchoring (open), `SpatialNavigation.ancestorGeometry` (keyboard), `TabBar.updateReorderSlot` (tab-reorder drag), `HeadingScrollTracker` (scroll), and the `Text`/`Util` text-measure probes (batched, cached until stale). `FloatingPanel.placeNextTo` is the one worth the same treatment as this plan if the harness shows it on a Markdown-preview pane during a drag.
