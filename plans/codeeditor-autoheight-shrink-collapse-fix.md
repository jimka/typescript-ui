# CodeEditor autoHeightMaxRows Shrink Collapse Fix — Implementation Plan

## Overview

`CodeEditor`'s `autoHeightMaxRows` option can collapse a live editor's committed height to `0px` — fully invisible — on certain document shrinks, even though the underlying CodeMirror document is intact and correct. A consumer app (SQLAdmin) hit this while adopting `autoHeightMaxRows` for a DDL SQL-preview editor: a 3-line, 68px editor grows correctly to 4 lines (87.375px), then shrinks back to the *original* 3-line text and collapses to `0px` instead of returning to 68px.

The bug lives entirely in [`syncAutoHeight`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L835), the private method that `mount`'s `EditorView.updateListener` calls on every CodeMirror `heightChanged`/`geometryChanged` update ([CodeEditor.ts:702-704](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L702-L704)). This plan is confirmed, not theorized: a regression test added directly to this repo's own test harness (`packages/lib/tests/component/code-editor.test.ts`, using the same mocked-`_view` technique the file's existing tests already use) reproduces the exact 0px collapse against the current, unmodified source, and a hand-verified fix makes it pass. Both are detailed below so `/implement` reproduces them exactly rather than re-deriving them.

The fix is a single, additive guard inside `syncAutoHeight` — a handful of lines plus one updated test whose old expectation encoded the bug. No public API changes, no changes to `CodeEditor`'s already-working growth-side guards, and no changes outside `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` and its test file.

---

## Architecture Decisions

### The bug is the shrink-side mirror of an already-solved growth bug, and the fix mirrors the existing solution

Commit `38a7d6ab` ("Reject CodeEditor auto-height growth against an unchanged shape") gave `syncAutoHeight` its current structure: a `shapeChanged` flag (true only when the document's line count, length, or width genuinely changed) gates whether a **growth** is trusted at all —

```typescript
if (desired > previousHeight && !shapeChanged) {
    return;
}
```

— because CodeMirror's own internal remeasure pass reports a fresh `geometryChanged` update after `syncAutoHeight`'s own `setHeight()` commit, on a call no real edit caused, and "on a real (non-integer) device-pixel ratio the re-measurement does not reliably read back the exact value just committed... it can read fractionally MORE" ([CodeEditor.ts:112-137](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L112-L137)). That guard is unconditional: **no** growth is ever trusted against an unchanged shape, however small.

The same commit added a **shrink**-side guard too, but a much weaker one — only a sub-pixel noise filter:

```typescript
if (desired < previousHeight && !shapeChanged && previousHeight - desired < 1) {
    return;
}
```

Its own comment states the assumption behind this asymmetry: "a shrink against an UNCHANGED shape... can only be integer-rounding noise, never genuine content: the document/width haven't changed, so real content can't have gotten shorter without an edit (which would itself be a shape change)" ([CodeEditor.ts:969-972](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L969-L972)). That assumption is false: the same re-entrant `geometryChanged` echo the growth guard already distrusts can also report a `scrollHeight` reading **more than a pixel below** what was already committed, on a call no real edit caused. Nothing bounds how far, or how many times in a row, so a chain of such echoes can walk the height down past the true content height, past zero, with the sub-pixel filter never engaging (each step is individually larger than 1px).[^regression-proof]

The fix applies the growth guard's own principle — *a re-entrant call earns no new trust in the content reading; only a genuine shape change does* — to the shrink case, without touching the growth guard itself.

### Only the content component is gated; the independently-measured horizontal-scrollbar reserve is untouched

`syncAutoHeight` computes the committed height as `contentDesired + this._lastHbarReserve` — two components with different trust rules, already established by the surrounding code. The horizontal-scrollbar reserve is deliberately re-measured **every** call, shape-changed or not, because (per the comment at [CodeEditor.ts:890-895](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L890-L895)) "a scrollbar's thickness is independent of this element's height, so re-reading it here can't manufacture its own feedback loop" — unlike content height, which "is fed back into `.cm-content`'s `min-height: 100%`". An existing test (`'re-measures the horizontal-scrollbar reserve on a later call against the same shape...'`) already exercises a legitimate, non-shape-changed **shrink** driven purely by this component (a scrollbar resolving away), and must keep passing unmodified.

So the new guard must gate `contentDesired` specifically, not the summed `desired` the existing checks compare — otherwise a legitimate hbar-only shrink on a `!shapeChanged` call would also be blocked. The fix holds `contentDesired` at its last-trusted value (`previousHeight - this._lastHbarReserve`, using the reserve from the *previous* call, before this call recomputes it) whenever this call's fresh reading is more than a pixel lower and the shape didn't change; the hbar-reserve component still flows through unchanged, independently, exactly as it already does today.

### One existing test pinned the exact bug and must be corrected, not preserved

`'still allows a shrink during a pure selection change'` ([code-editor.test.ts:772](packages/lib/tests/component/code-editor.test.ts#L772)) asserts that a content-driven shrink (`scrollHeight` 160→120, `!shapeChanged`) is applied immediately, with the comment "a shrink is always safe to apply". This is a single-step instance of the exact mechanism the regression test below runs ten times to reach zero — it is not a different, legitimate scenario. Its sibling test two tests above it (`'rejects a growth attempt flagged as a pure selection change...'`) already rejects the mirror-image growth case for the same reason (a cursor move triggers no reflow, so any reported change in vertical space it carries is spurious). The fix makes the shrink case symmetric with its sibling: rewrite this test's expectation from `120` to `160` (unchanged) and its name/comment to state why, rather than leaving a passing test that re-asserts the bug.[^no-other-callers]

---

## Internal Structure

Current structure (unmodified, [CodeEditor.ts:917-921](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L917-L921)):

```typescript
let settledClientHeight = metrics.clientHeight;

if (shapeChanged) {
    this.setHeight(contentDesired);
    // ... settle + fractional-undershoot correction (unchanged) ...
}
```

New structure — add an `else` branch that clamps `contentDesired` back to its last-trusted value when this call didn't earn a shrink through a shape change:

```typescript
let settledClientHeight = metrics.clientHeight;

if (shapeChanged) {
    this.setHeight(contentDesired);
    // ... settle + fractional-undershoot correction (unchanged) ...
} else {
    // A content shrink this call did NOT earn through a genuine shape
    // change is the same self-triggered geometry echo the growth guard
    // below already distrusts (see the comment above `_lastSyncedShape`,
    // and the growth check a few lines down): CodeMirror's own internal
    // remeasure pass can report a `scrollHeight` reading that drifts away
    // from what this method already committed -- on a real device-pixel
    // ratio it can read fractionally MORE, forever, on the growth side
    // (see the comment above); live-confirmed to drift the other way too:
    // a chain of such echoes, each shrinking `contentDesired` by more than
    // the sub-pixel noise floor below, walks the committed height down
    // with nothing to stop it short of zero -- even though the document
    // never changed. Only a genuine shape change re-establishes trust in
    // a smaller reading; a re-entrant call holds the content component at
    // its last-trusted value instead. The hbar-reserve component measured
    // below is unaffected -- it is re-measured, and trusted, on every
    // call regardless of shape, since (per the comment above its own
    // computation) it cannot manufacture this kind of feedback loop on
    // its own.
    const previousContentHeight = previousHeight - this._lastHbarReserve;

    if (contentDesired < previousContentHeight && previousContentHeight - contentDesired >= 1) {
        contentDesired = previousContentHeight;
    }
}
```

Nothing else in `syncAutoHeight` changes: the growth check (line 965-967), the final sub-pixel shrink check (line 984-986), and the fractional-undershoot correction inside the `shapeChanged` branch are all untouched.

---

## Ordered Implementation Steps

Test-first, per this project's own convention: steps 1-2 change tests only (both go red against the current, unmodified source); step 3 makes them pass.

1. **`packages/lib/tests/component/code-editor.test.ts` — add the regression test.** Add the following test to the `describe('CodeEditor autoHeightMaxRows', ...)` block, anywhere after the `'still allows a shrink during a pure selection change'` test (which step 2 below also touches):

   ```typescript
   it('does not collapse the height when several re-entrant calls each shrink an unchanged shape by more than a pixel', () => {
       // Mirrors 'caps consecutive height growths...' above, but for a
       // shrink. Live-reproduced via a consumer app (SQLAdmin): a 4-line,
       // 87.375px editor shrinks back to its original 3-line, 68px
       // document, and its committed height collapses to 0px even though
       // the document is correct -- CodeMirror's own geometryChanged echo
       // (see the comment above the growth check below) can report a
       // scrollHeight more than a pixel below what this method already
       // committed, on a call no genuine edit caused; unlike growth,
       // nothing stopped a chain of these from walking the height to zero.
       const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
       editor._view = {
           state: { doc: { lines: 4, length: 80 } },
           documentPadding: { top: 0, bottom: 0 },
       };
       editor._scrollElement = DOM.sink.createElement('div');

       let scrollHeight = 160;
       vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
           scrollTop: 0, scrollLeft: 0,
           scrollWidth: 500, scrollHeight,
           clientWidth: 500, clientHeight: scrollHeight,
       }));

       editor.syncAutoHeight(); // establishes the grown, 4-line state
       expect(editor.getHeight()).toBe(160);

       // A genuine edit shrinks the document back to 3 lines...
       editor._view.state.doc.lines = 3;
       editor._view.state.doc.length = 40;

       // ...followed by repeated re-entrant echoes against the now-
       // unchanged shape, each still reading a lower scrollHeight than
       // the last.
       for (let i = 0; i < 10; i++) {
           scrollHeight = Math.max(0, scrollHeight - 20);
           editor.syncAutoHeight();
       }

       // The first, shape-earned reading (140) is trusted and held; none
       // of the nine unshaped echoes after it are.
       expect(editor.getHeight()).toBe(140);
   });
   ```

   → verify: `npx vitest run tests/component/code-editor.test.ts -t "does not collapse the height"` (from `packages/lib/`) — must **fail**, with `editor.getHeight()` equal to `0`. This confirms the test reproduces the collapse against the current, unmodified `syncAutoHeight` before any fix is applied.

2. **`packages/lib/tests/component/code-editor.test.ts` — correct the test that pinned the bug.** Rename `'still allows a shrink during a pure selection change'` ([code-editor.test.ts:772](packages/lib/tests/component/code-editor.test.ts#L772)) to `'rejects a content shrink flagged as a pure selection change against an unchanged shape'`, replace its trailing comment (`// a shrink is always safe to apply`) with one explaining the corrected behaviour (mirrors its sibling growth-rejection test above it), and change the final assertion from `expect(editor.getHeight()).toBe(120)` to `expect(editor.getHeight()).toBe(160)`. Do not change the test's setup (mocked `_view`, `getScrollMetrics` sequence) — only the name, comment, and final expectation.
   → verify: `npx vitest run tests/component/code-editor.test.ts -t "pure selection change"` (from `packages/lib/`) — must **fail**, with `editor.getHeight()` equal to `120` rather than the newly expected `160`. Confirms this test also currently pins the bug.

3. **`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — add the shrink guard.** In `syncAutoHeight`, wrap the existing `if (shapeChanged) { this.setHeight(contentDesired); ... }` block (currently [CodeEditor.ts:920-953](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L920-L953)) with an `else` branch per `## Internal Structure` above. Do not change the block's existing contents, the growth check, or the final sub-pixel check.
   → verify: `grep -n "previousContentHeight" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` shows exactly the new lines. Then re-run both commands from steps 1 and 2 — both now **pass** (`140` and `160` respectively).

4. **Full verification.** Run the checks in `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |

---

## Expected Behaviour

All of the following are unit-testable through the existing mocked-`_view` harness `code-editor.test.ts` already uses (no live browser needed to pin the logic; a live-browser manual check is listed separately below).

| Scenario | `shapeChanged` | Shrink source | Behaviour after fix |
|---|---|---|---|
| Genuine edit shrinks the document (e.g. 4 lines → 3 lines) | true | content | Commits the new, smaller content height immediately — unchanged from today. |
| Re-entrant `geometryChanged`/`heightChanged` echo against an unchanged shape reports `scrollHeight` **≥1px** below the last commit | false | content | **New:** ignored; content height holds at its last-trusted value. (Previously: accepted, the collapse.) |
| Re-entrant echo reports `scrollHeight` **<1px** below the last commit | false | content | Unchanged: still absorbed as rounding noise by the existing final sub-pixel check. |
| A horizontal scrollbar resolves away (or appears) with the document/width unchanged | false | hbar reserve | Unchanged: still re-measured and applied every call, growing or shrinking, regardless of shape. |
| Growth against an unchanged shape (any source) | false | — | Unchanged: still unconditionally blocked by the pre-existing growth check. |
| A pure selection change (cursor move) reports a smaller `scrollHeight` with the shape unchanged | false | content | **New:** rejected, mirroring the pre-existing rejection of a pure-selection-change growth. (Previously: accepted.) |
| A chain of several re-entrant echoes, each shrinking `scrollHeight` by more than a pixel, following one genuine shape-changing shrink | false (after the first call) | content | **New:** height stabilizes at the first, shape-earned reading; none of the later echoes move it further. (Previously: walked to `0`.) |

Manual-verify (not exercised by the mocked harness, since `CodeEditor` is live-only offline — see `code-editor.test.ts`'s own top-of-file comment): confirm the fix resolves the original SQLAdmin repro in a real browser once this fix is available there (symlinked `dist/lib` build) — grow a `CodeEditor` with `autoHeightMaxRows` set by adding content, then shrink it back to the original content, and confirm the committed height returns to the original value rather than collapsing to `0px`. This manual check belongs to SQLAdmin's own verification once it picks up the fix, not to this plan.

---

## Verification

- **Typecheck:** `npm run typecheck` (from the repo root, or `npm run typecheck` inside `packages/lib`) — zero new errors. (This environment has a handful of pre-existing, unrelated typecheck errors in other files — `AccordionDemoPanel.ts`, `StatusBar.ts`, `AbstractCalendarDropdown.ts`, a few test files — confirmed present before this change and outside `CodeEditor.ts`; do not attempt to fix them here.)
- **Targeted tests:** `npx vitest run tests/component/code-editor.test.ts` (from `packages/lib/`) — all tests pass, including the corrected pure-selection-change test and the new regression test.
- **Full suite:** `npm run test` (from the repo root, or `npx vitest run` inside `packages/lib`) — no new failures. (Confirmed during planning: 4095/4096 tests already pass unmodified against the fixed `syncAutoHeight`; the one pre-existing failure is exactly the test step 2 corrects.)
- **Regression-proof ordering:** per steps 1-2, both the new regression test and the corrected pure-selection-change test must be confirmed to fail against the source as it stands *before* step 3's fix, and pass after — this is the artifact that confirms the mechanism, not just the fix.

---

## Potential Challenges

- **Don't reuse `SUBPIXEL_HEIGHT_SLOP_PX` for the new guard's 1px threshold.** That constant documents a specific, different rounding source (the mount-time `.cm-scroller` padding-bottom slop). The existing final sub-pixel check ([CodeEditor.ts:984](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L984)) already uses a bare literal `1` for the same kind of threshold, not that constant — match that precedent and use a bare `1` in the new guard too, so the two unrelated meanings stay visually distinct.
- **Row-cap interaction.** `contentDesired` can come from either `metrics.scrollHeight` or the row-cap-derived `capPx`, depending on which is smaller. The new guard clamps the final `contentDesired` value regardless of which source produced it, so it needs no special-casing for the capped case — confirmed during planning by tracing both paths.
- **Ordering with the existing final checks.** The new guard runs *before* `this._lastHbarReserve` is recomputed and before the final `desired === previousHeight` / growth / sub-pixel checks. Keep it there — moving it after would use the *new* (not yet recomputed) reserve where the fix needs the *previous* call's reserve to derive `previousContentHeight`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — `syncAutoHeight` (835-990, the method being changed), the `updateListener` that invokes it (696-705), `_lastSyncedShape`/`_lastHbarReserve` field docs (247-265), the growth-guard comment block (112-137) this fix mirrors.
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) — the full `describe('CodeEditor autoHeightMaxRows', ...)` block (163-794); in particular the growth-echo precedent tests (`'does not ratchet the height upward...'`, `'caps consecutive height growths...'`, `'resumes growing after a genuine document change...'`, `'rejects any growth against an unchanged shape...'`) this fix's shrink-side behaviour must now match in spirit, and the hbar-reserve re-measurement test (`'re-measures the horizontal-scrollbar reserve...'`) that must keep passing unmodified.
- Commit `38a7d6ab` ("Reject CodeEditor auto-height growth against an unchanged shape") — introduced the `shapeChanged` mechanism, the hbar-reserve split, and the (too-weak) shrink sub-pixel guard this plan extends. `git show 38a7d6ab` from the repo root.

---

## Non-Goals

- Any change to the SQLAdmin (consumer) repo. SQLAdmin's own `LIBRARY_NOTES.md` entry for this bug already states there is no legitimate app-side workaround; the fix is entirely library-side.
- Any change to the growth-side guards, `pureSelectionChange`'s growth-blocking behaviour, or the fractional-undershoot correction — all confirmed, by tracing every existing test, to be unaffected by this fix and must stay that way.
- Pixel-perfect convergence to the true content height on every re-entrant call. Matches the existing growth-side design philosophy already stated in the code: "a block whose first, always-free commit undershoots true content is a distinct bug (the initial measurement itself, not this guard) to fix at the source" ([CodeEditor.ts:135-137](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L135-L137)). The fix only re-earns trust in a smaller reading via a genuine shape change, same as growth already does — it does not try to detect which re-entrant reading (if any) is the "real" settled value.
- Live-browser instrumentation or a `dist/lib` rebuild-and-log investigation. Unnecessary: the mechanism is confirmed directly against this repo's own test harness (see `## Verification`).

---

## Notes

[^regression-proof]: Confirmed during planning by adding the exact regression test in `## Ordered Implementation Steps` step 1 to a disposable worktree and running it against the current, unmodified `syncAutoHeight`: a sequence of ten re-entrant `syncAutoHeight()` calls, each reporting a `scrollHeight` 20px below the last (all after one genuine shape-changing shrink from 160 to 140), walked the committed height 140 → 120 → 100 → 80 → 60 → 40 → 20 → 0 → 0 → 0 — an exact reproduction of the reported 0px collapse, with every step individually larger than the 1px noise floor the existing guard checks. Re-running the same test after applying the fix in `## Internal Structure` stabilizes the height at 140 (the one shape-earned reading) and leaves it there through all nine subsequent echoes.

[^no-other-callers]: `syncAutoHeight` is private and this test's mocked-`_view` technique (not a real `EditorView`) is internal to the test file, so no other test or production code path depends on the corrected test's old expectation. Confirmed by running the full `packages/lib` suite against the fix: 4095 of 4096 tests pass unmodified, and the single failure is exactly this one test with exactly the predicted values (`expected 160 to be 120`).
