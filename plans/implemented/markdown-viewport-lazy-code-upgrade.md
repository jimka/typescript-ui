---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Viewport-Lazy Fenced-Code Upgrade in `Markdown` — Implementation Plan

## Overview

[`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts) upgrades every supported-language fenced block from a plain `<pre>` to a live read-only `CodeEditor`. Today the only gate is component-level: once the whole `Markdown` is effectively visible, *every* block upgrades ([`Markdown.ts:1063`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1063)). On the docs app's generated API pages that means up to 460 CodeMirror editors built in one burst — a measured **22 seconds** of blocked main thread.[^evidence]

This plan adds a second, per-block gate: a fenced block starts its upgrade only once its wrapper is inside the browser viewport or within one viewport-height below it. It also removes two cost multipliers in the same method cluster that would otherwise turn the removed load-time burst into scroll-time stutter: the per-measure re-sync of every live editor's width, and the per-upgrade full-document re-measure.[^why-three]

All three changes are inside `Markdown.ts` — one file, no public API change. The two hosts that render `Markdown` inside a scrolling `Panel` ([`DocsContent.ts:133`](packages/docs/src/shell/DocsContent.ts#L133) and [`MarkdownViewer.ts:167`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L167)) are untouched.

---

## Architecture Decisions

### The gate lives inside `Markdown`, not in a new library primitive

`Markdown` already owns the block handles, the render-generation token, and two upgrade queues. The new gate is a third queue drained by the same funnel method, `startCodeEditorImport`. No new class, no new exported symbol.[^no-primitive]

### "In viewport" is the wrapper's own viewport-space rect, compared against the window box

The gate reads `DOM.source.getElementRect(wrapper)` ([`DOM.ts:979`](packages/lib/src/typescript/lib/core/DOM.ts#L979)) and compares it to `DOM.source.getViewportSize().height` ([`DOM.ts:1029`](packages/lib/src/typescript/lib/core/DOM.ts#L1029)). Both are existing seam reads with modelled offline counterparts, so `Markdown` never learns which component hosts its scroll.[^why-window-box]

A block is **eligible** when its rect satisfies both conditions below. *The fold* is the bottom edge of the visible window.

| Condition | Meaning |
|---|---|
| `rect.bottom >= 0` | not entirely above the top of the window |
| `rect.top <= viewportHeight * (1 + CODE_UPGRADE_LOOKAHEAD_VIEWPORTS)` | not further than one viewport-height below the fold |

Worked cases, at `viewportHeight = 800`:

| Block rect (`top`, `bottom`) | Eligible? | Why |
|---|---|---|
| `(-300, -40)` | no | scrolled fully past the top |
| `(-300, 120)` | yes | straddles the top edge, partly on screen |
| `(700, 900)` | yes | straddles the fold |
| `(1500, 1700)` | yes | below the fold but inside the 1600px lookahead |
| `(1700, 1900)` | no | beyond the lookahead |

### The lookahead is one viewport-height *below only* — nothing above

Swapping a `<pre>` for a `CodeEditor` changes the block's rendered height, which moves everything below it. Giving the margin no upward component means that in ordinary downward reading, every upgrade happens at or below the reader's position, so the movement lands on off-screen content.[^asymmetric]

### The margin is a module constant, not an option

`CODE_UPGRADE_LOOKAHEAD_VIEWPORTS = 1`, alongside the file's existing `CODE_BLOCK_MAX_AUTO_ROWS` ([`Markdown.ts:76`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L76)) and `GUESS_HEIGHT_CORRECTION_WARN_PX` ([`Markdown.ts:89`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L89)). No `MarkdownOptions` field, no setter.[^not-configurable]

### Re-evaluation is scroll- and resize-driven, coalesced to one pass per frame

`Markdown` registers `Event.addViewportListener(this, "scroll", …)` and `…(this, "resize", …)` while — and only while — it has blocks waiting on the viewport. Each event schedules one pass through `Component.afterNextLayout` ([`Component.ts:5543`](packages/lib/src/typescript/lib/core/Component.ts#L5543)), guarded by a boolean so a burst of scroll events produces one pass.[^why-viewport-listener]

### The pass is a linear walk in document order with an early break

Fenced blocks are appended in document order, so their `rect.top` values are non-decreasing. The pass walks the queue from the front, reads one rect per entry, and breaks at the first entry past the lookahead cutoff — everything after it is further down. This mirrors [`findActiveHeading`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1622) in this same file, which `DocsContent` calls on every native scroll event with the whole page's headings.[^scan-cost]

The pass reads every rect first and applies upgrades only afterwards, so one pass costs at most one forced reflow.

### Editor width re-sync leaves the measure path

`syncCodeEditors` ([`Markdown.ts:1023`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1023)) does two unrelated jobs and runs on every `measureContentHeight` call. It splits into `flushPendingCodeUpgrades` (stays on the measure path) and `resyncCodeEditorWidths` (moves to the two call sites that can actually change a wrapper's width: `setWidth` and the theme-change handler).[^quadratic]

### Upgrade-driven re-measures coalesce to one per frame

`measureContentHeight` forces a full-document reflow. The two call sites that fire once per upgraded block — the tail of `loadCodeEditorUpgrade` and `handleCodeEditorHeightChange` — route through a new `scheduleContentMeasure()` that defers to the next layout flush and collapses repeats. `setWidth`, `setMarkdown`, the theme handler, and the constructor's `onFirstLayout` keep calling `measureContentHeight()` synchronously.[^coalesce-measure]

### The dynamic import is untouched

`loadCodeEditorUpgrade` ([`Markdown.ts:1115`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1115)) `await`s two ES module imports. A module specifier resolves once per process, so N blocks still produce one load; the first eligible block warms it for every later one. Do not add a prewarm, a shared promise field, or a module-level cache.

### Two kinds of callback reference, and they are not interchangeable

- A listener passed to `Event.addViewportListener` / `removeViewportListener` is a **plain prototype method reference** (`this.handleViewportChange`). The dispatcher invokes it with the component as `this` ([`Event.ts:227`](packages/lib/src/typescript/lib/core/Event.ts#L227)), and the prototype lookup yields the same function object every time, which is what `removeViewportListener` matches on.
- A callback passed to `Component.afterNextLayout` is **a `readonly` arrow field** (`private readonly handleViewportPass: () => void = () => this.onViewportPass();`), because `afterNextLayout` calls it bare with no receiver. This is the shape [`DocsContent.ts:124`](packages/docs/src/shell/DocsContent.ts#L124) already uses for the same API.

---

## Internal Structure

New private state on `Markdown`, beside the existing `_awaitingVisibilityKickoffs` ([`Markdown.ts:517`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L517)). Plain initializers are correct here: nothing writes these during the `super()` cascade.

```typescript
/** Blocks whose import has not started because they are not near the viewport yet. */
private _awaitingViewportKickoffs: QueuedCodeUpgrade[] = [];

/** Whether the scroll/resize viewport listeners are currently registered. */
private _viewportWatchArmed = false;

/** Whether a viewport pass is already queued on the next layout flush. */
private _viewportPassScheduled = false;

/** Whether a coalesced content-height measure is already queued. */
private _measureScheduled = false;

private readonly handleViewportPass:     () => void = () => this.onViewportPass();
private readonly handleScheduledMeasure: () => void = () => this.onScheduledMeasure();
```

The pass. Note the read loop completes before the first upgrade is started.

```typescript
private onViewportPass(): void {
    this._viewportPassScheduled = false;

    if (this._awaitingViewportKickoffs.length === 0) {
        this.disarmViewportWatch();

        return;
    }

    if (!this.isEffectivelyVisible()) {
        return;
    }

    this.commitElementStyle();

    const viewportHeight = DOM.source.getViewportSize().height;
    const cutoff         = viewportHeight * (1 + CODE_UPGRADE_LOOKAHEAD_VIEWPORTS);
    const queue          = this._awaitingViewportKickoffs;
    const due:       QueuedCodeUpgrade[] = [];
    const remaining: QueuedCodeUpgrade[] = [];

    for (let i = 0; i < queue.length; i++) {
        const entry = queue[i]!;
        const rect  = DOM.source.getElementRect(entry.wrapper);

        if (rect.top > cutoff) {
            remaining.push(...queue.slice(i));

            break;
        }

        (rect.bottom >= 0 ? due : remaining).push(entry);
    }

    this._awaitingViewportKickoffs = remaining;

    if (remaining.length === 0) {
        this.disarmViewportWatch();
    }

    for (const entry of due) {
        void this.loadCodeEditorUpgrade(entry.wrapper, entry.pre, entry.code, entry.text, entry.languageId, entry.generation);
    }
}
```

`startCodeEditorImport` gains the second gate between the existing visibility check and the loader call:

```typescript
if (!this.isBlockNearViewport(entry.wrapper)) {
    this._awaitingViewportKickoffs.push(entry);
    this.armViewportWatch();

    return;
}
```

---

## Ordered Implementation Steps

Each step names its file. Steps 1–5 are the viewport gate; steps 6–7 are the two cost multipliers; steps 8–9 update and extend the tests; step 10 is documentation.

1. **`Markdown.ts` — add the constant.** Add `CODE_UPGRADE_LOOKAHEAD_VIEWPORTS = 1` next to `GUESS_HEIGHT_CORRECTION_WARN_PX` (around line 89), with a doc comment stating that the lookahead is measured in multiples of the viewport's own height and applies below the fold only. Import `Event` from `~/core/Event.js` (the file does not import it today).
   *Check:* `npm run typecheck` in `packages/lib` still passes.

2. **`Markdown.ts` — add the state.** Add the four fields and two arrow fields from `## Internal Structure` beside `_awaitingVisibilityKickoffs` (line 517).

3. **`Markdown.ts` — add the helpers.** Add six private methods: `isBlockNearViewport(wrapper: Handle): boolean` (the two-condition test from `## Architecture Decisions`, reading `DOM.source.getViewportSize().height` itself), `armViewportWatch()`, `disarmViewportWatch()`, `scheduleViewportPass()` (returns early when `_viewportPassScheduled` is set **or** `_awaitingViewportKickoffs` is empty), `handleViewportChange()` (body: `this.scheduleViewportPass();`), and `onViewportPass()` as written above.

4. **`Markdown.ts` — wire the gate into the funnel.** In `startCodeEditorImport` (line 1063), insert the viewport check after the existing `isEffectivelyVisible()` branch. Update its doc comment to describe both gates in series. `onEffectiveVisibilityChange` (line 1081) needs no edit: it already flushes its queue *through* `startCodeEditorImport`, so a block that becomes visible while still off-screen falls straight into the viewport queue.

5. **`Markdown.ts` — teardown.** In `clearContent` (line 900), add `this._awaitingViewportKickoffs.length = 0;` beside the two existing queue clears and call `this.disarmViewportWatch();`.
   *Check:* `grep -n '_awaitingViewportKickoffs' src/typescript/lib/component/display/Markdown.ts` — every match must sit in one of: the declaration, `startCodeEditorImport`, `scheduleViewportPass`, `onViewportPass`, `clearContent`. Any other method touching the queue is a mistake.

6. **`Markdown.ts` — split `syncCodeEditors`.** Replace it with `flushPendingCodeUpgrades()` (the `_pendingCodeUpgrades` filter, unchanged) and `resyncCodeEditorWidths()` (the `isEffectivelyVisible()` guard plus the `_codeEditors` width loop, unchanged, but starting with `this.commitElementStyle();`). Then:
   - `measureContentHeight` (line 814): call `flushPendingCodeUpgrades()` where `syncCodeEditors()` was.
   - `setWidth` (line 779): inside the `if (changed)` branch, call `this.resyncCodeEditorWidths();` before `this.measureContentHeight();`.
   - Constructor theme subscription (line 578): change to `ThemeManager.onThemeChange(() => this.onThemeChanged())` and add `private onThemeChanged(): void { this.resyncCodeEditorWidths(); this.measureContentHeight(); }`.
   *Check:* `grep -rn 'syncCodeEditors' packages/lib/src` — expect zero matches.

7. **`Markdown.ts` — coalesce the upgrade-driven measure.** Add `scheduleContentMeasure()` (guard on `_measureScheduled`, then `Component.afterNextLayout(this.handleScheduledMeasure)`) and `onScheduledMeasure()` (clear the flag, call `this.measureContentHeight()`, then `this.scheduleViewportPass()`). Change the tail of `loadCodeEditorUpgrade` (line 1138) and the tail of `handleCodeEditorHeightChange` (line 1003) from `this.measureContentHeight()` to `this.scheduleContentMeasure()`.
   *Check:* `grep -n 'this.measureContentHeight()' src/typescript/lib/component/display/Markdown.ts` — the only callers left must be the constructor's `onFirstLayout`, `setMarkdown`, `setWidth`, `onThemeChanged`, and `onScheduledMeasure`. A match inside `loadCodeEditorUpgrade` or `handleCodeEditorHeightChange` means the step is incomplete.

8. **`Markdown.test.ts` — update the tests the split and the coalescing affect.** Four existing tests name `syncCodeEditors` directly (lines 1213, 1237, 1258, 1283): the first two become `flushPendingCodeUpgrades`, the last two become `resyncCodeEditorWidths`. The `describe` at line 1200 and the one at line 1289 rename to match. The heightchange test at line 1078 asserts `expect(measureSpy).toHaveBeenCalledOnce()` — respy on `scheduleContentMeasure` instead.

9. **`Markdown.test.ts` — add the new coverage** listed under `## Expected Behaviour` as unit-testable.

10. **Docs.** Update the class JSDoc on `Markdown` (line 452–458, the "The upgrade is lazy" paragraph), [`packages/lib/docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md) (the paragraph at line 88), and add a `### Display` entry under `## Changed` in [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L55).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Offline-testable

The modelled `getElementRect` composes a handle's rect from the inline `left`/`top`/`width`/`height` writes the recording sink folded onto its stub ([`TestDOM.ts:421`](packages/lib/tests/dom/TestDOM.ts#L421), [`TestDOM.ts:922`](packages/lib/tests/dom/TestDOM.ts#L922)). A test therefore seeds a block's position by writing them itself:

```typescript
DOM.sink.apply(wrapper, { style: { left: '0px', top: '5000px', width: '600px', height: '80px' } });
```

The test config's viewport is `{ width: 1280, height: 800 }`, so the cutoff is 1600px. A wrapper with **no** seeded geometry reads as the zero rect, which is eligible — so every existing upgrade test keeps passing untouched, and every new gate test must seed geometry explicitly.

Tests drive the gate the way the existing queue tests already do: build the handles with `buildCodeHostTrio(md)` ([`Markdown.test.ts:1190`](packages/lib/tests/component/display/Markdown.test.ts#L1190)), seed the wrapper's geometry, then call `startCodeEditorImport(entry)` or `onViewportPass()` directly. `buildCodeHostTrio` never appends its wrapper into the `Markdown` root, so the composed rect is exactly what the test wrote, with no ancestor offset to account for.

1. A block seeded at `top: 5000px` queues instead of loading: `loadCodeEditorUpgrade` is not called and `_awaitingViewportKickoffs` has length 1.
2. A block seeded at `top: 200px` loads immediately and never enters `_awaitingViewportKickoffs`.
3. A block seeded at `top: 1500px` (inside the 1600px cutoff) loads immediately — the lookahead is live, not a no-op.
4. Queueing a block arms the watch: `_viewportWatchArmed` is `true` and `Event._registeredComponentIds()` contains the component's id.
5. Re-seeding a queued block to `top: 200px` and invoking `onViewportPass()` directly loads it, empties `_awaitingViewportKickoffs`, and disarms the watch.
6. A queued block seeded at `top: -900px, height: 80px` (fully above the window) stays queued after a pass — the lookahead does not extend upward.
7. `onViewportPass()` on a not-effectively-visible `Markdown` leaves the queue untouched and calls no loader.
8. The pass breaks early and trusts document order: with three queued blocks seeded at `top` 200, 5000, and 300 in that queue order, only the first loads. The third is geometrically eligible but stays queued, because the walk stopped at the 5000 entry.
9. `setMarkdown()` on an instance with a queued block empties `_awaitingViewportKickoffs`, disarms the watch, and bumps `_renderGeneration` (extends the existing test at line 1417).
10. `dispose()` on an instance with a queued block leaves no registration for its id in `Event._registeredComponentIds()`.
11. `flushPendingCodeUpgrades()` applies a pending upgrade when effectively visible and leaves it queued otherwise (the two tests at lines 1213/1237, renamed).
12. `resyncCodeEditorWidths()` writes each live editor's width from its wrapper's `clientWidth`, and writes nothing while not effectively visible (the two tests at lines 1258/1283, renamed).
13. `measureContentHeight()` no longer calls `editor.setWidth` — a live editor in `_codeEditors` gets no `setWidth` call from a bare `measureContentHeight()`.
14. `setWidth(300)` on an instance with a live editor does call `editor.setWidth`, and the first `getScrollMetrics` read happens after the `width: 300px` write (the existing ordering test at line 1290, retargeted at `resyncCodeEditorWidths`).
15. `handleCodeEditorHeightChange` still writes the wrapper's new height synchronously, and calls `scheduleContentMeasure` exactly once.
16. Two `scheduleContentMeasure()` calls before a flush produce one `measureContentHeight()` call when `onScheduledMeasure()` runs.

### Manual verification only

The offline sink drops `requestAnimationFrame` callbacks, so `Component.afterNextLayout` never fires in tests and no real scroll event is dispatched. Everything below is verified in the browser against the docs dev server (`npm run docs:dev`, then a second server on a spare port if the user's own is running — check `readlink /proc/<pid>/cwd` before assuming which tree a listening server serves).

- On `/api/component/list/classes/List`, the page is interactive within a second and `document.querySelectorAll('.cm-editor').length` is small (single digits to low tens, depending on window height) instead of 460.
- Scrolling down grows that count progressively; blocks are already highlighted when they reach the fold, never after.
- Scrolling top-to-bottom through the page shows no content jump under the cursor.
- Resizing the window with un-upgraded blocks below the fold upgrades whatever the new height exposes.
- A fragment link into the middle of a page (`/api/…#methods`) upgrades the blocks around the landing point and leaves the ones above it plain until scrolled back to.
- A `Markdown` in a hidden tab still upgrades nothing until the tab is shown.

---

## Verification

- `npm run typecheck` and `npm run test` in `packages/lib` — the new tests plus every existing test in `Markdown.test.ts` pass.
- `npm run lint` in `packages/lib` — `local/no-raw-dom` has an empty baseline, so any accidental raw DOM read in the new pass is a build error.
- `grep -rn 'syncCodeEditors' packages/lib` — zero matches (`resyncCodeEditorWidths` does not contain the string).
- `npm run docs:api` — must finish with zero warnings (the class JSDoc changes).
- Browser checks: the manual list above, on `http://localhost:<port>/typescript-ui/api/component/list/classes/List` and on an authored page with fenced blocks such as `/data/store`.
- Re-run the load measurement from `## Addendum: Evidence` on `/api/component/list/classes/List` and record the new numbers in the commit message.

---

## Documentation Impact

No exported symbol changes, so no barrel, catalog, or sidebar edit is needed.

- **Class JSDoc**, `Markdown.ts` lines 452–458: the sentence "deferred until this component's first connected, displayed layout" is now only half the story. State both gates.
- **[`packages/lib/docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md)**, the "The upgrade is lazy" paragraph at line 88: add that an individual block upgrades when it comes within one viewport-height of the visible area, so a long document pays only for what the reader sees. Keep the existing `displayed: false` sentence.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)**: a `### Display` subsection under the existing `## Changed` heading (line 55). Entries land under the *current* heading, so put it there and nowhere else.

---

## Potential Challenges

- **A zero rect reads as eligible.** An element under a non-framework hidden ancestor returns an all-zero rect and passes the gate. This matches today's behaviour (upgrade immediately) so it is not a regression, and the framework's own `displayed: false` is already caught by the first gate.
- **The window box is not the scroll pane.** A block sitting behind a fixed app header counts as visible. The gate is deliberately over-inclusive by at most one header height; over-upgrading costs time, never correctness.
- **A stale rect inside a layout pass.** `onViewportPass` calls `this.commitElementStyle()` before its first read, the same guard `measureContentHeight` already carries (line 827) for `commitBounds`' auto-commit window.
- **Interleaving reads and writes in the pass.** Splitting the loop into a read phase and an apply phase is load-bearing: a rect read after a style write forces a reflow, measured at 41.9ms on a 230-editor document versus 0.2–0.6ms for 230 reads on a clean layout.
- **Double-scheduling.** `Component.afterNextLayout` does not dedupe by callback identity; the `_viewportPassScheduled` and `_measureScheduled` booleans are what prevent one pass per scroll event.
- **A deferred callback outliving the component.** `Component.destructor` sets its element handle to `undefined` (`Component.ts:869`), so a `scheduleContentMeasure` or `scheduleViewportPass` callback that drains a frame after `dispose()` finds no element: `measureContentHeight` already returns early on that, and `onViewportPass` finds an emptied queue because `clearContent` ran first. No extra disposal flag is needed.
- **Viewport-listener registration survives `DOM.reset()`.** `Event`'s `viewportListenerMap` is module-level, so a second test-file registration for `"scroll"` never re-attaches the window listener. New tests must invoke `onViewportPass()` directly rather than dispatching a scroll event — which is also how the existing tests drive `onFirstLayout` (see the comment at line 274).
- **Fewer blocks per page is coming.** `plans/docs-api-hide-inherited-members.md` hides inherited members by default, which cuts a big API page's block count by roughly 70%. It reduces the worst case; it does not remove it, since the toggle restores the full page on demand.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — the only source file changed. Read lines 388–430 (the queue types), 500–530 (state), 900–1145 (the whole upgrade cluster), and 1592–1654 (`findActiveHeading`, the in-file precedent for the scan).
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `addViewportListener` (line 581), `removeViewportListener` (line 618), and `baseViewportListener` (line 212), which is what binds `this` on dispatch.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `afterNextLayout` (line 5543), `onFirstLayout` (line 5435), `commitElementStyle` (line 1528), `isEffectivelyVisible` (line 1909), and the `Event.purgeComponent` teardown (line 779).
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink.foldGeometry` (line 421) and `ModelledDOMSource.getElementRect` (line 922). These two decide exactly what a test must write to place a block offline.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `computeVisibleWindow` (line 263) and `SCROLL_BUFFER` (line 10), the framework's other "visible window plus a margin" computation.[^virtualrowview]
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — the real host: a `Panel` with `autoScroll: 'y'` (line 133) holding one `Markdown` per prose block (line 368).

---

## Non-Goals

- **No `IntersectionObserver`.** It has no seam in `core/DOM.ts` and no offline counterpart; adding one is a `DOMSource` extension with its own modelled implementation, far past this change's weight.[^no-io]
- **No `VirtualScroller`.** It is a scroll *engine* — a helper a container owns to drive transform-based scrolling with custom scrollbars, wheel and touch handling — not a visibility oracle. It exposes `getScrollY()`/`getViewportWidth()` and the offset-plus-viewport-height arithmetic that row virtualization is built on, but nothing that answers "is this arbitrary element on screen"; its consumers know their rows by *index* and uniform height, which prose fenced blocks are not. It is also absent from the docs host chain: `DocsContent` is a `VBox` container with `autoScroll: 'y'`, i.e. native scrolling, so reaching for `VirtualScroller` would mean first converting the content pane's scroll model. The rect-versus-window-box gate above computes the same visible-range answer without either cost.
  - **Caveat this leaves open.** Because the re-evaluation pass is driven by native `"scroll"` events, a `Markdown` placed inside a transform-scrolled `VirtualScroller` host would never re-run the pass — only the blocks eligible at first layout would upgrade. No such host exists today (`DocsContent` and `MarkdownViewer` both scroll natively), and the component-level `onEffectiveVisibilityChange` gate still bounds the damage to "some blocks stay as plain `<pre>`", never a crash. If `Markdown` is ever hosted in a `VirtualScroller`, the fix is to also drain the queue from that host's scroll callback.
- **No recycling.** An upgraded block's `CodeEditor` is never torn down when it scrolls away. Upgrading is one-way, as it is today.
- **No configurable margin, no `MarkdownOptions` field, no setter.**
- **No change to the placeholder-height guess.** `applyCodeEditorUpgrade` keeps sizing the editor from the `<pre>`'s `scrollHeight`, and `GUESS_HEIGHT_CORRECTION_WARN_PX` keeps reporting the correction. Making the swap exactly height-neutral means reconciling the `<pre>`'s `0.6em` padding with CodeMirror's own content padding — a separate change with its own visual verification.
- **No restructuring of `measureContentHeight`'s probe.** The `height: auto` → read → restore sequence stays as-is; only how often it runs changes.
- **No docs-app change.** `DocsContent` and `MarkdownViewer` keep their current scroll wiring.

---

## Addendum: Evidence

Measured on 2026-08-07 against the docs dev server (Vite dev, unbundled, no CPU throttling), on generated API pages. Block counts are `ts`-fenced blocks, all of which map to a `CodeEditor` language.

| Page | Supported fenced blocks | `.cm-editor` after load | Long-task total | `clientWidth` reads | `scrollHeight` reads |
|---|---|---|---|---|---|
| `/api/data/classes/AjaxStore` | 59 | 59 | 0.94 s | 3,867 | 5,079 |
| `/api/component/diagram/classes/DiagramView` | 230 | 230 | 4.79 s | 36,566 | 41,490 |
| `/api/component/list/classes/List` | 460 | 460 | 13.16 s | 126,674 | 136,835 |

On the 460-block page a chained 250ms `setTimeout` sampler could not run between t=250ms and t=22.3s — the main thread was continuously busy for roughly 22 seconds.

Two separate costs are visible in that table.

**Linear.** Long-task time per block is 15.9 / 20.8 / 28.6 ms at N = 59 / 230 / 460. Most of that is the `CodeEditor` construction itself, and it is what the viewport gate removes for every block the reader never reaches.

**Quadratic.** `clientWidth` reads per block are 65.5 / 159 / 275 — growing linearly with N, so the total grows as N². The source is `syncCodeEditors`' width loop over every live editor, run once per `measureContentHeight` call, which itself runs twice per upgraded block. That is the second and third changes in this plan. Left in place, it re-emerges as scroll stutter once a reader has accumulated a few hundred live editors.

**Scan cost.** On the 230-block page, reading all 230 wrapper rects costs 0.2–0.6 ms when layout is clean, and 41.9 ms when a style write has dirtied it first. This is the measured basis for the pass's read-then-write ordering and for accepting a full linear walk rather than a binary search.

**Corpus.** 726 generated API pages: median 6 supported blocks, mean 60.7, 195 pages above 50, 163 above 100, 44,067 in total. Authored documentation pages are far smaller — the largest, [`packages/lib/docs/data/store.md`](packages/lib/docs/data/store.md), has 20, and the whole authored corpus of 169 pages has 517. The problem this plan solves is an API-reference problem; on authored pages the gate is a small, harmless win.

---

## Notes

[^evidence]: Full numbers in `## Addendum: Evidence`. The headline: `/api/component/list/classes/List` builds 460 `CodeEditor` instances on load and blocks the main thread for about 22 seconds doing it. The premise that the up-front upgrade is the dominant cost is confirmed, with one correction — a second, quadratic cost sits next to it, which is why this plan is three changes rather than one.

[^why-three]: The gate alone would move the cost rather than remove it. Editors are never torn down, so a reader scrolling a long page accumulates live editors, and each new upgrade costs `O(live editors)` DOM reads through `syncCodeEditors` plus two full-document reflows through `measureContentHeight`. At a few hundred live editors that is tens of milliseconds per upgraded block, landing in the middle of a scroll instead of at load. The measured per-block read count (65.5 → 275 as N goes 59 → 460) is what makes this concrete rather than theoretical.

[^no-primitive]: A reusable "upgrade when visible" primitive was considered and rejected. There is exactly one call site, the queue entries carry `Markdown`-specific payload (`pre`, `code`, `text`, `languageId`, `generation`), and the gate has to interleave with `Markdown`'s existing visibility queue and generation token. A general primitive would have to expose all of that, so it would relocate the logic across a boundary rather than remove any — which is the test `ARCHITECTURE.md`'s *Compose before specializing* section sets for a new specialized piece.

[^why-window-box]: Two alternatives were rejected. (1) Asking the scroll host: `Markdown` would have to find its nearest `autoScroll` ancestor and read its `getScrollElement()`, which is `protected` — reaching it would breach `ARCHITECTURE.md`'s rule that a component owns its own surface, and it would make the gate depend on which host is above. (2) `IntersectionObserver`: no seam exists (see `## Non-Goals`). The window box needs neither: `getElementRect` already returns viewport-space coordinates for an arbitrary handle, and `getViewportSize` already exists. The cost is over-inclusiveness — a block clipped by an ancestor pane but inside the window counts as visible — which only ever means upgrading something slightly early.

[^asymmetric]: The upgrade is not height-neutral. `applyCodeEditorUpgrade` pins the wrapper to the `<pre>`'s measured `scrollHeight`, then CodeMirror reports its own height through `"heightchange"` and the wrapper is re-pinned. That correction has been measured at 20px and 29px in two live reproductions — the reason `GUESS_HEIGHT_CORRECTION_WARN_PX` exists at all (line 89). A block that changes height while it is above the reader's viewport top drags the whole page under the cursor by that amount. Giving the lookahead no upward component means that in normal downward reading it cannot happen: every eligible block is at or below the top edge, so its height change only moves content further down. The residual case is a block already straddling the viewport when it first becomes eligible — page load, or a fragment jump — where the shift is the same one that happens today.

[^not-configurable]: `CLAUDE.md`'s *Simplicity First* rules out configurability that was not asked for, and the two existing tuning constants in this file are module constants for the same reason. One viewport-height is the value: at a typical 900px pane and 60fps, it is roughly 1.5 seconds of fast scrolling of runway — enough that the reader never catches an unhighlighted block — while costing at most a screenful of extra upgrades over the strict minimum. A fixed pixel margin was rejected because it would mean a tall monitor prefetches proportionally less.

[^why-viewport-listener]: A scroll on an ancestor pane cannot reach `Markdown` any other way. `scroll` does not bubble, and even if it did, the pane is above `Markdown` in the tree, so neither `Event.addListener` (exact-id match) nor `Event.addSubtreeListener` (descendants) ever fires. `Event.addViewportListener` is the framework's existing answer for an event a component needs but that does not land on its own element — `SpinButton`, `SplitGutter`, `WindowBorder`, `Scrollbar`, and `Header` all use it for drag tracking. The window handler is registered with `capture: true` (`Event.ts:60`), which is what lets it see non-bubbling `scroll` events at all, and `"scroll"` is already in `PASSIVE_TYPES` (line 58). Arming lazily keeps the global fan-out proportional to the number of `Markdown` instances that still have work, not to how many exist: a page whose blocks have all upgraded holds no registration.

[^scan-cost]: Cost per pass: one `getViewportSize` (a window property read, no reflow), one forced reflow on the first rect read, then one cheap rect read per queued entry up to the break. Measured at 0.2–0.6 ms for 230 reads on a clean layout, so ~1 ms at 460. A binary search over the monotonic tops would cut that to ~9 reads and was considered, but the measured linear cost is under a millisecond and `findActiveHeading` — called on every scroll event by `DocsContent`, over every heading on the page — already establishes the linear walk as this codebase's answer to exactly this shape of problem. Entries above the window top are re-read on every pass rather than being dropped, because the reader can scroll back up to them; that is the case the measured number covers.

[^quadratic]: `syncCodeEditors` runs on every `measureContentHeight` call, and `measureContentHeight` runs twice per upgraded block (once from `loadCodeEditorUpgrade`, once from the editor's first `"heightchange"`). Its second half loops over `_codeEditors` calling `editor.setWidth(getScrollMetrics(wrapper).clientWidth)` — one forced read per live editor. That is the N² term in the evidence table. The loop is only ever needed when something changed a wrapper's width, which is `setWidth` (the layout assigned a new width) and a theme change (`--ts-ui-md-max-measure` is in `ch` units, so a font swap moves it). An editor's own height change and a freshly applied upgrade change no widths, so both drop the call. `resyncCodeEditorWidths` keeps the `isEffectivelyVisible()` guard verbatim: a hidden subtree reads `clientWidth: 0`, and writing that through would collapse a live editor with nothing to correct it on re-show.

[^coalesce-measure]: `measureContentHeight` writes `height: auto`, commits, reads `scrollHeight`, writes the height back, and commits again — two forced reflows of the whole document, measured at ~42 ms on a 230-editor page. Running it once per upgraded block is what makes a burst of upgrades expensive even after the width loop is gone. Only the two upgrade-driven call sites are coalesced; `setWidth` and `setMarkdown` keep their synchronous measure because callers depend on the height being settled when they return — `DocsContent.onScrollToFragment` calls `flushLayout()` and then scrolls to a heading, and a deferred measure there would scroll against a stale extent. The upgrade path has no such caller: it is already asynchronous behind the dynamic import.

[^virtualrowview]: `VirtualRowView.computeVisibleWindow` is the nearest existing "which items are on screen" computation, and `SCROLL_BUFFER = 2` is its prefetch margin. Its arithmetic does not transfer: it divides a scroll offset by a uniform `ROW_HEIGHT` to get indices in O(1), which works only because every row is the same height. Fenced blocks have arbitrary, content-dependent heights, so there is no offset-to-index arithmetic to borrow. What does transfer, and is followed here, is the shape — a visible range padded by a margin, recomputed from a scroll signal, with the items outside it left unbuilt.

[^no-io]: `IntersectionObserver` appears nowhere in the codebase. Adding it would mean a new `DOMSource` (or `DOMSink`) method, a production implementation, a modelled offline implementation with its own callback scheduling, and test coverage for the seam itself — for a single call site whose need is answered by two reads that already exist. The rejection is on weight, not on the API: if a second consumer ever needs true intersection semantics, the seam is the right way to add it.
