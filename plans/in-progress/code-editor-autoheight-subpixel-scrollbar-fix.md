# CodeEditor Auto-Height Sub-Pixel Scrollbar Fix — Implementation Plan

## Overview

[`CodeEditor.syncAutoHeight`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L689) sizes an auto-growing editor by reading `.cm-scroller`'s live `scrollHeight` and committing exactly that number through `setHeight()`. `scrollHeight` is an integer; the content it measures is not. When a fenced code block's real rendered content is, say, 184.3px tall, `scrollHeight` reports `184`, `syncAutoHeight` commits `184`, and roughly a third of a pixel of content is left outside the box. `.cm-scroller` has `overflow-y: auto`, so the browser paints a vertical scrollbar for that fraction of a pixel — a permanent bar on a block that has nothing to scroll.

The fix adds a 1px slop to the committed height, mirroring the `+1` slop [`ScrollStrip.arrowReserve`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L451) already uses to stop the same class of sub-pixel rounding from flickering a scroll affordance on a flush fit. One new module constant and one changed line in `syncAutoHeight`; no public API, no `Markdown.ts` involvement, no new mechanism.

The defect does not reproduce in the available Chromium instance, whose `devicePixelRatio` is 1 — every `.cm-scroller` there measures `clientHeight === scrollHeight` exactly. The reporting display runs at a fractional device-pixel ratio (a browser trace from the same investigation recorded `hostDPR: 1.1979166269302368`), which is what makes rendered line heights land on fractional pixel values in the first place. The fix is therefore justified from the code, and its real-display effect is a manual-verify step rather than a red/green browser test — the `debug` skill's describe-then-verify substitute for behaviour the offline harness and the available browser cannot exercise.

---

## Architecture Decisions

### Root cause: `scrollHeight` is an integer, the content extent it measures is not

`DOM.source.getScrollMetrics` returns `Element.scrollHeight` verbatim ([`DOM.ts:2132`](../packages/lib/src/typescript/lib/core/DOM.ts#L2132)), and that DOM property is specified to round the real scrolling-area height to a whole number. `syncAutoHeight` commits the rounded value as an exact CSS height, so any fractional part the rounding discarded becomes real, unscrollable overflow.[^rounding-direction]

### Fix: commit one pixel more than the measured extent

`syncAutoHeight` adds a fixed 1px slop, `SUBPIXEL_HEIGHT_SLOP_PX`, to the height it commits. One pixel is provably enough — the shortfall can never reach a whole pixel, because the number being committed is itself the rounded form of the extent it must cover.[^one-pixel-suffices] This follows [`ScrollStrip.arrowReserve`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L451), which absorbs a flush fit with `contentExtent > regionExtent + 1` for the same reason: a scroll affordance must not appear on a difference that is only rounding noise. [`Table.ts:69`](../packages/lib/src/typescript/lib/component/table/Table.ts#L69) (`WIDTH_TARGET_EPSILON_PX = 0.5`) establishes the naming and documentation convention for a sub-pixel tolerance constant in this codebase.[^why-not-recheck]

### The slop is added after the row cap, not before

`desired = Math.min(desired, capPx) + SUBPIXEL_HEIGHT_SLOP_PX`. Adding the slop last means it also covers a block sitting exactly at the `autoHeightMaxRows` cap, where `capPx` and the measured extent are arithmetically the same number and a slop applied earlier would be clamped straight back off.[^slop-after-cap]

### `clampHeight` is not a second source of the fractional value

[`Component.setHeight`](../packages/lib/src/typescript/lib/core/Component.ts#L3446) routes through `clampHeight`, but every bound `clampHeight` can apply to a `CodeEditor` is a whole number, so it can neither introduce a fraction nor clamp the slop away.[^clamp-audit]

---

## Internal Structure

### `CodeEditor.ts` — new module constant

Insert between `CM_SCROLLER_SELECTOR` ([line 91](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L91)) and `READONLY_FLASH_MS` ([line 94](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L94)):

```typescript
// Slop added to the auto-grown height so a sub-pixel content overhang can
// never leave `.cm-scroller` a fraction of a pixel short and paint a
// permanent, non-functional vertical scrollbar. `.cm-scroller`'s
// `scrollHeight` is a whole number but the content it measures is not, so
// committing the reported extent verbatim discards up to half a pixel of
// real content. One pixel covers it: the discarded remainder is always less
// than the rounding step. Mirrors ScrollStrip.arrowReserve's `+1` slop
// against the same rounding noise.
const SUBPIXEL_HEIGHT_SLOP_PX = 1;
```

### `CodeEditor.ts` — `syncAutoHeight`, one changed line

The only statement that changes is the clamp ([line 708](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L708)):

```typescript
    // Before:
    desired = Math.min(desired, capPx);

    // After:
    desired = Math.min(desired, capPx) + SUBPIXEL_HEIGHT_SLOP_PX;
```

Everything else in the method — the guard clause, the `getScrollMetrics` read, the horizontal-scrollbar reserve, the `perLineHeight`/`capPx` derivation, the `desired === this.getHeight()` short-circuit, the `setHeight` + `emit` tail — stays exactly as it is.

### `CodeEditor.ts` — `syncAutoHeight`'s doc comment

Append this paragraph to the existing `@remarks` block (which currently ends `...from the live line count, not `defaultLineHeight`.`):

```
 * The committed height carries a one-pixel slop
 * (`SUBPIXEL_HEIGHT_SLOP_PX`) on top of that measurement, because
 * `scrollHeight` is a whole number while the content it measures is not:
 * committing the reported extent verbatim leaves a sub-pixel overhang that
 * `.cm-scroller`'s `overflow-y: auto` paints a permanent, non-functional
 * scrollbar for. The slop is added after the row cap so a block sitting
 * exactly at the cap is covered too.
```

Name the constant in backticks, not `{@link}`: it is a module-private constant TypeDoc cannot resolve to a page, and `CODE_CONVENTIONS.md` requires `npm run docs:api` to finish with zero link warnings.

### Worked cases

`maxRows` is 20 throughout (the value `Markdown` passes). "h-bar reserve" is the 15px `getScrollBarWidth()` the method already adds when `scrollWidth > clientWidth`.

| `scrollHeight` | lines | doc padding | h-bar reserve | `capPx` | committed | why |
|---|---|---|---|---|---|---|
| 184 | 9 | 0 | — | 408.9 | **185** | under the cap: measured extent, then slop |
| 5008 | 250 | 8 | — | 408 | **409** | over the cap: cap wins, then slop |
| 100 | 5 | 0 | 15 | 400 | **116** | reserve added before the cap, slop after |
| 190 | 19 | 0 | 15 | 200 | **201** | reserve pushes past the cap; cap wins, then slop |

---

## Ordered Implementation Steps

Work test-first: step 2 writes the failing tests, step 3 makes them pass.

1. **`CodeEditor.ts` — add the constant.** Insert `SUBPIXEL_HEIGHT_SLOP_PX` with its comment exactly as given in **Internal Structure**, between `CM_SCROLLER_SELECTOR` and `READONLY_FLASH_MS`.

2. **`code-editor.test.ts` — update five tests and add one.** In `describe('CodeEditor autoHeightMaxRows')` ([line 163](../packages/lib/tests/component/code-editor.test.ts#L163)), apply every change listed in **Expected Behaviour**: five literal updates, two added assertions in the idempotence test, one new test. Check: `npx vitest run code-editor.test.ts` (from `packages/lib`) — seven tests fail (the five with changed literals, the idempotence test, and the new one), everything else passes.

3. **`CodeEditor.ts` — apply the slop.** Change the `Math.min` line in `syncAutoHeight` and append the doc-comment paragraph, both exactly as given in **Internal Structure**. Check: `npx vitest run code-editor.test.ts` is fully green.

4. **Confirm the slop is applied once, at one site.** `grep -n "SUBPIXEL_HEIGHT_SLOP_PX" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect exactly three matches: the declaration, the mention inside `syncAutoHeight`'s doc comment, and exactly one use in an expression. More than one expression use means the slop is being applied twice.

5. **Typecheck and full test run.** `npm run typecheck` and `npm test` from `packages/lib`, both clean.

6. **Manual verification.** Per **Verification** — the fractional-device-pixel-ratio rendering behaviour itself is not reproducible in the available browser, so this step is described here and confirmed by the user on the reporting display.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |

No changes to `Markdown.ts`, `Component.ts`, `Panel.ts`, any other source file, or any documentation page.

---

## Expected Behaviour

Every case below except the last is unit-testable with the stubbing pattern the `describe` block already uses: assign `editor._view` and `editor._scrollElement` directly, then `vi.spyOn(DOM.source, 'getScrollMetrics')`. The `_view` stub only ever needs `state.doc.lines` and `documentPadding`.

**Unchanged — leave these three tests exactly as they are:**

- `'syncAutoHeight is a no-op with no live view (the real offline contract)'` ([line 176](../packages/lib/tests/component/code-editor.test.ts#L176)).
- `'syncAutoHeight is a no-op with a view but autoHeightMaxRows unset'` ([line 188](../packages/lib/tests/component/code-editor.test.ts#L188)).
- `'syncAutoHeight is a no-op with a view but no resolved scroll element'` ([line 201](../packages/lib/tests/component/code-editor.test.ts#L201)). The slop must never be committed on a no-op path — these three already assert `getHeight()` is unmoved, which pins that.

**Changed literals — each of these keeps its name and body, with only the expected number moved by the slop:**

| Test | Line | Old expectation | New expectation |
|---|---|---|---|
| `'sets the content height when it is below the row cap'` | [214](../packages/lib/tests/component/code-editor.test.ts#L214) | `getHeight()` `100`, `received` `{ height: 100 }` | `101`, `{ height: 101 }` |
| `'clamps to the row cap when content height exceeds it'` | [237](../packages/lib/tests/component/code-editor.test.ts#L237) | `408` | `409` |
| `'reserves the horizontal scrollbar width before applying the cap'` | [258](../packages/lib/tests/component/code-editor.test.ts#L258) | `115` | `116` |
| `'reserves the width before the cap, not after: …'` | [278](../packages/lib/tests/component/code-editor.test.ts#L278) | `200` | `201` |
| `'reads the real DOM scroll metrics for content height, …'` | [330](../packages/lib/tests/component/code-editor.test.ts#L330) | `100` | `101` |

Two of those tests carry arithmetic comments that must be corrected alongside the literal:

- `'clamps to the row cap…'` — its comment ends `capPx = 20 (perLineHeight) * 20 (maxRows) + 8 (padding) = 408.` Append: ` The committed height is 409 — the cap plus the 1px sub-pixel slop.`
- `'reserves the width before the cap, not after…'` — its comment says `reserving before Math.min clamps to 200; reserving after would clamp 190 to 190 first and add 15 on top, landing on 205.` Update those two numbers to `201` and `206` respectively, since the slop is added to both orderings, and append: ` The 1px slop is added after Math.min in either case, so it does not affect which ordering this test distinguishes.`

**Added assertions — `'is idempotent: a second call with unchanged inputs makes no further setHeight/emit calls'` ([line 306](../packages/lib/tests/component/code-editor.test.ts#L306)):** keep the two existing `fireCount` assertions and add a height assertion after each `syncAutoHeight()` call, both `expect(editor.getHeight()).toBe(101)`. This pins that the slop is applied to the freshly computed value, not accumulated onto the previously committed height — a cumulative slop would leave the second call at 102 and would also break the `desired === this.getHeight()` short-circuit, turning every call into another `"heightchange"` emit.

**New test — the regression case.** Add at the end of the `describe` block, using the reported block's own numbers:

```typescript
it('commits one pixel more than the reported content extent, so a sub-pixel overhang cannot leave the box short', () => {
    // `.cm-scroller`'s `scrollHeight` is a whole number while the content it
    // measures is not, so a 9-line block whose real extent is ~184.3px
    // reports 184. Committing 184 verbatim leaves ~0.3px outside the box,
    // which `overflow-y: auto` paints a permanent, non-functional scrollbar
    // for. 185 covers it. (perLineHeight = 184 / 9; capPx ≈ 408.9, so the
    // cap does not bind here.)
    const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
    editor._view = {
        state: { doc: { lines: 9 } },
        documentPadding: { top: 0, bottom: 0 },
    };
    editor._scrollElement = DOM.sink.createElement('div');

    vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
        scrollTop: 0, scrollLeft: 0,
        scrollWidth: 500, scrollHeight: 184,
        clientWidth: 500, clientHeight: 184,
    });

    let received: { height: number } | null = null;
    editor.on('heightchange', (payload: { height: number }) => { received = payload; });

    editor.syncAutoHeight();

    expect(editor.getHeight()).toBe(185);
    expect(received).toEqual({ height: 185 });
});
```

**Manual-verify only — the real-display behaviour.** On a display whose device-pixel ratio is not a whole number, a fenced code block in the docs app renders with no vertical scrollbar. This cannot be turned into an automated test: the offline harness has no real layout or paint, and the available Chromium instance runs at `devicePixelRatio: 1`, where the content extent lands on whole pixels and there is nothing to round away. The expected behaviour is stated here first and confirmed by the reporting user afterwards, per the `debug` skill's describe-then-verify rule.

---

## Verification

- `npm run typecheck` (from `packages/lib`) — zero errors.
- `npx vitest run code-editor.test.ts` (from `packages/lib`) — every case in **Expected Behaviour** green.
- `npm test` (from `packages/lib`) — full suite green.
- `npm run build:lib` (from the repo root) — required before any browser check, since `dist/` is gitignored and the docs app serves the built library.
- **Available-browser check (regression only, cannot show the fix).** Start or reuse the docs dev server (`ps aux | grep vite`; if none, `cd packages/docs && npm run dev`) and load `/typescript-ui/components/AccordionPanel` and `/typescript-ui/components/LineChart`. In the console, `[...document.querySelectorAll('.cm-scroller')].map(e => [e.clientHeight, e.scrollHeight])` — every pair must satisfy `clientHeight >= scrollHeight`, and no block may show a vertical scrollbar. At `devicePixelRatio: 1` this only confirms the slop broke nothing; it cannot exhibit the bug.
- **Manual check on the reporting display (the actual fix).** On the fractional-device-pixel-ratio display, load the same pages in real Chrome and confirm the previously-scrollbarred fenced block no longer shows a vertical scrollbar, and that no block gained visible dead space at its bottom edge.

---

## Documentation Impact

None. `autoHeightMaxRows`, `getAutoHeightMaxRows()`, and `"heightchange"` are documented in [`packages/lib/docs/components/CodeEditor.md`](../packages/lib/docs/components/CodeEditor.md), and their contract is unchanged — only the internal correctness of the committed height moves. The feature is still unreleased: its entry sits under `## Added` / `### Display` in [`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md), whose existing wording ("grows to fit its real rendered content") already describes the behaviour this fix makes true. No changelog entry for a fix to not-yet-released behaviour.

---

## Potential Challenges

- **The `Markdown` diagnostic warn's numbers shift by 1px.** `GUESS_HEIGHT_CORRECTION_WARN_PX` is 8 ([`Markdown.ts:89`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L89)) and observed corrections are 20–29px, so a 1px shift cannot flip the threshold. No change to `Markdown.ts`.
- **A reviewer may read the extra pixel as dead space.** It is one pixel of `.cm-scroller` background below the last line, on a background that is uniform — invisible, and the alternative is a permanently visible scrollbar. Say so in the review rather than reverting the slop.
- **Temptation to also slop the horizontal axis.** Out of scope; nothing in the report or the code points at a spurious horizontal bar, and the width path already reserves a full scrollbar width rather than committing a measured extent. See **Non-Goals**.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the module constants block (lines 88–94) and `syncAutoHeight` (line 689), the only two edit sites.
- [`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`](../packages/lib/src/typescript/lib/component/container/ScrollStrip.ts) — `arrowReserve` (line 451), the `+1`-slop precedent this fix mirrors, and `refreshArrows` (line 668) which applies the same slop to the live scroll position. Not modified.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `WIDTH_TARGET_EPSILON_PX` (line 69), the naming and comment convention for a sub-pixel tolerance constant. Not modified.
- [`packages/lib/src/typescript/lib/core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts) — `setHeight` (line 3446) and `clampHeight` (line 3472); read both to confirm `setHeight` never calls `scheduleLayout` and that the clamp bounds are whole numbers. Not modified.
- [`packages/lib/tests/component/code-editor.test.ts`](../packages/lib/tests/component/code-editor.test.ts) — the `describe('CodeEditor autoHeightMaxRows')` block (lines 163–354); read the file's top-of-file comment (lines 26–30) on the offline/live-view split before editing.
- [`plans/implemented/code-editor-autoheight-initial-undersize-fix.md`](implemented/code-editor-autoheight-initial-undersize-fix.md) — the plan that made `syncAutoHeight` read `.cm-scroller`'s metrics in the first place; its Non-Goals list the edge cases deliberately left open.
- [`plans/implemented/linechart-demo-code-example-spasm-fix.md`](implemented/linechart-demo-code-example-spasm-fix.md) — its `## Addendum: Real-Chrome Trace` documents the `handleCodeEditorHeightChange` → `measureContentHeight` → `scheduleLayout` → `syncCodeEditors` feedback loop that an oscillating height feeds, and ships the diagnostic warn that caught this bug's numbers.

---

## Non-Goals

- **No re-measure-and-correct pass after `setHeight`.** Rejected in favour of the fixed slop; the reasoning is in the footnote on the `Fix: commit one pixel more than the measured extent` decision.
- **No horizontal-axis slop.** The width path reserves a measured full scrollbar width rather than committing a measured content extent, so it does not have the same rounding exposure, and no spurious horizontal bar was reported.
- **No change to `Markdown.ts`.** The guess-height path, the diagnostic warn, and `measureContentHeight` are all untouched; this defect lives entirely in what `syncAutoHeight` commits.
- **No new option, setter, or public API.** The slop is a fixed internal correctness detail, not something a caller tunes.
- **No wider redesign of `syncAutoHeight`.** The row-cap derivation, the scrollbar reserve, and the guard clause are all left as-is.

---

## Implementation Notes

Two deviations from the plan as drafted, both found via live user reports after the plan's own manual-verify step (necessarily deferred, since neither defect reproduces in the available Chromium instance) turned out to still be broken on the reporting display.

**The slop moved from a JS-computed height addition to a static CSS `padding-bottom`.** The plan's `Math.min(desired, capPx) + SUBPIXEL_HEIGHT_SLOP_PX` was implemented as written, then reported live as an unbounded upward ratchet — the editor's height grew by roughly one pixel on every re-layout, without stopping. Root cause the plan's `^why-not-recheck` footnote came close to but didn't name: `.cm-content`'s CSS carries `min-height: 100%`, and `.cm-scroller`'s `scrollHeight` can never report less than the scroller's own `clientHeight`. Once the committed height exceeds the true content extent by even the planned 1px, the *next* `syncAutoHeight` call reads back the box's own last-committed height as if it were fresh content, and re-adding the same +1px on top climbs the height again — forever, once per re-layout. The fix keeps `SUBPIXEL_HEIGHT_SLOP_PX = 1` and the reasoning in `^one-pixel-suffices`, but applies it once, in `mount`, as a fixed `.cm-scroller` `padding-bottom` — never recomputed from a prior measurement, so it cannot feed back into itself. `syncAutoHeight` itself is unchanged from `master` (`desired = Math.min(desired, capPx)`, no slop term). Confirmed live (after finding and fixing an unrelated worktree `node_modules` resolution problem that had been silently testing `master` instead of this branch): 20 consecutive resize events, byte-identical heights every time, on both the AccordionPanel and LineChart docs pages.

**A second, pre-existing defect surfaced once the above was fixed: a horizontal/vertical scrollbar feedback loop.** With the ratchet gone, the same live report (a real Chrome performance trace) still showed sustained thrashing — ~500 forced browser `Layout` events/sec, driven by the same `measureContentHeight` → `scheduleLayout` path as the already-fixed `markdown-code-editor-resize-lag-fix` loop, but now sourced from CodeMirror's own internal `measure()` pass calling `syncAutoHeight` repeatedly. A live-instrumented sample of `.cm-scroller`'s `clientHeight`/`scrollHeight` over 2.5s showed a clean two-state flip: `187/187` (horizontal-scrollbar reserve included, no vertical overflow) alternating with `174/185` (reserve dropped, 11px of real vertical overflow) roughly ten times a second. Root cause: `syncAutoHeight`'s horizontal-scrollbar reserve (`if (metrics.scrollWidth > metrics.clientWidth) desired += getScrollBarWidth()`, present on `master`, predating this plan — added by the original `markdown-code-editor-autogrow-height` plan) compares against `.cm-scroller`'s own `clientWidth`, which shrinks whenever `.cm-scroller` shows a *vertical* scrollbar. For a document whose longest line sits within one scrollbar-width of that boundary, the two axes chase each other: the taller (reserved) commit removes the vertical scrollbar, which widens `clientWidth`, which drops the horizontal reserve, which commits the shorter height, which brings the vertical scrollbar back. Not reproducible in the available Chromium instance (the test content's line-width margin there is too wide to sit on the boundary), so this was root-caused from the live numbers plus a synthetic reproduction of the mechanism (a flex container matching `.cm-scroller`'s own `display: flex` gutter+content structure, with a forced vertical-scrollbar toggle) rather than a direct repro on the reporting page. Fixed with `scrollbar-gutter: stable` on `.cm-scroller`, applied at the same mount-time, auto-height-only site as the padding-bottom — it reserves the vertical scrollbar's track unconditionally, so `clientWidth` no longer depends on whether a vertical scrollbar is currently showing. Verified directly against the real `.cm-scroller` element (ancestor scroll reactivity neutralised, since the docs page's own outer scroller was found to react to the forced height changes used for the toggle and confound the first attempt at this check): `clientWidth` held constant across a forced no-scrollbar/scrollbar toggle, both before and after. This is `## Non-Goals`' "No horizontal-axis slop" claim superseded — that line assumed the horizontal path had no rounding exposure, which is true, but did not anticipate a *structural* circular dependency between the two axes.

**A third defect surfaced after both of the above were fixed and merged: an intermittent, non-functional vertical scrollbar on documents well under the row cap. Two independent attempts at fixing it both caused a worse regression than the bug itself and were reverted; the cosmetic bug is still open.** Reported as "sometimes I can see a 1px scroll, sometimes nothing at all" on two specific AccordionPanel doc blocks. `.cm-scroller`'s native `overflow-y: auto` decides whether to paint a scrollbar by comparing its own integer-rounded `scrollHeight` against `clientHeight` — the same rounding this plan's padding-bottom slop (`^rounding-direction`) absorbs for the *height-commit* side, but the native comparison runs independently on every browser layout pass and is not guaranteed to stay inside that 1px margin on every display.

*Attempt 1* neutralised `.cm-content`'s `min-height: 100%` around each measurement so `scrollHeight` could never read back a previously-committed height. It passed the full offline suite and an initial live check (ten genuine width changes on the originally-reported block, perfectly stable), but a broader live sweep caught it causing an unrelated, unbounded runaway height growth (tens of pixels every 100ms, no interaction) on the "Programmatic open / close" block. Reverted before landing (working-tree only, nothing committed).

*Attempt 2* sidestepped the native comparison instead of trying to make it exact: `syncAutoHeight` already computes, from its own row-count math, whether the document exceeds `autoHeightMaxRows` (`atRowCap`, the same test `Math.min(desired, capPx)` performs), so it drove `.cm-scroller`'s `overflow-y` directly from that boolean — `hidden` below the cap, `auto` at or above it — writing the style only on a flip. This passed the offline suite (three new tests pinning the hidden/auto/write-once-per-flip behaviour, kept below) and an initial live sweep across every block on the AccordionPanel, CodeEditor, and VirtualScroller docs pages, all idle for 1.4s with zero movement. It was committed and reported as fixed. It was not: a live user report ("I'm getting an infinite growth on 5174") led to reproducing, on the *same* "Programmatic open / close" block Attempt 1 broke, unbounded runaway growth triggered by a mouse-wheel gesture over the editor (a plain viewport resize reproduced it too, in a follow-up check). Confirmed by reverting the change and rerunning the identical resize trigger: rock-stable with the revert, reproduced again by reapplying it — causation, not correlation. Reverted before landing (this plan file and the commit history were the only place it had been recorded as shipped; nothing reached `master`).

Two independently-designed fixes, both mutating `.cm-scroller`/`.cm-content` styling in reaction to a live measurement, have now caused the same class of catastrophic runaway growth on the same block. That block's example is only three lines, plainly under the 20-row cap — this is not a boundary/threshold effect in `syncAutoHeight`'s own row-count math, which stays exactly the same regardless of how close a document is to the cap. The common thread is CodeMirror's own `ResizeObserver` on `.cm-scroller` (`@codemirror/view`, `dist/index.js`, `resizeScroll`) and the framework's eased wheel-scroller, which also targets `.cm-scroller` (`Component.attachWheelScrolling`/`writeNativeScroll`) — both attempts wrote to an element that is simultaneously watched and driven by machinery outside `syncAutoHeight`'s control, and both accidentally closed a feedback path back into it. The exact mechanism was not pinned down before reverting Attempt 2 (unlike the first two deviations above, which have a proven root cause) — this needs substantially more careful design, probably starting from *why* a style write on `.cm-scroller` (not `.cm-content`) reopens a feedback loop at all, before a third attempt is safe to try. Until then this specific cosmetic bug (an occasionally-visible, non-functional 1px scrollbar on an otherwise-correct auto-height editor) is accepted as open.

Neither of the first two deviations is unit-testable beyond what already exists: `mount()` never runs under the offline harness (no real CodeMirror view), so both fixes are, like the rest of `syncAutoHeight`'s live-DOM-dependent behaviour, manual-verify-only. Attempt 2's `code-editor.test.ts` additions (asserting `overflow-y: hidden`/`auto` and write-once-per-flip) were reverted along with the source change — they exercised real behaviour, but behaviour this plan no longer ships.

---

## Notes

[^rounding-direction]: Two effects push in the same direction and the slop covers both, so the fix does not depend on distinguishing them. First, and provable from the code: `Element.scrollHeight` is specified to return the scrolling area height rounded to an integer, so a real extent of 184.3px reports as `184` and `syncAutoHeight` commits a box 0.3px shorter than the content. Second, and browser-internal: a box given an exact integer CSS height can be laid out and snapped against a device-pixel grid, and at a fractional device-pixel ratio the snapped result can differ slightly from the integer that was set. The reporting user measured a rendered box of 184.3px against a diagnostic that recorded `syncAutoHeight` committing exactly `184` — a ~0.3px gap either way. The device-pixel ratio matters mostly upstream of both: at a fractional ratio, Chrome scales computed font and line metrics, so rendered line heights become fractional (e.g. 20.47px/line) and a 9-line block lands at 184.3 instead of a round 184. At `devicePixelRatio: 1` the same block's lines are whole pixels, the extent is a whole number, `scrollHeight` rounds nothing away, and there is no gap — which is exactly what the live measurement in the available Chromium found (`clientHeight === scrollHeight` on every `.cm-scroller`, on both docs pages, zero mismatch).

[^one-pixel-suffices]: Write `E` for the true content extent and `m` for what `scrollHeight` reports. `m` is `E` rounded to a whole number, so `m > E - 1` always. Committing `m + 1` makes the box `m + 1 > E`, strictly taller than the content, for every possible value of `E` — including the integer case, where the box simply ends up one pixel taller than needed. The bound holds regardless of which way the rounding went, and regardless of the device-pixel ratio, because it only uses the fact that the rounding step is one pixel. A half-pixel slop would be tighter but would not survive a browser that snaps the applied height back to a whole pixel; a whole pixel costs nothing visible and needs no such assumption.

[^why-not-recheck]: The alternative considered was self-correction: after `setHeight(desired)`, re-read `.cm-scroller`'s metrics once and bump the height by a pixel only when `scrollHeight` still exceeds `clientHeight` — the overflow-detection idiom [`Panel.measureScrollbarGutter`](../packages/lib/src/typescript/lib/core/Panel.ts#L734) already uses. Rejected for three reasons. (1) It breaks idempotence in a way that feeds a known feedback loop. `syncAutoHeight` short-circuits on `desired === this.getHeight()`, and `desired` would keep recomputing to the uncorrected value (the content has not changed), so every later call would re-commit the short height, re-detect the gap, bump again, and emit `"heightchange"` twice — on a path that runs `handleCodeEditorHeightChange` → `measureContentHeight` → `scheduleLayout` → `syncCodeEditors`, the exact loop the `markdown-code-editor-resize-lag-fix` work closed (see the `linechart-demo-code-example-spasm-fix` plan's Real-Chrome Trace addendum, which measured 2537 browser `Layout` events over 5.4 idle seconds when that loop was live). Keeping idempotence would mean carrying the applied correction in a new field and comparing against `desired + correction` — more state and a new invariant, for the same end result as a constant. (2) It costs a second forced synchronous reflow per editor per call, plus a `commitElementStyle()` flush first (`setHeight`'s style write is buffered; `Markdown.measureContentHeight` flushes for exactly this reason before its own geometry read), on a page that mounts many fenced blocks. (3) It may not be able to see the gap at all: `clientHeight` and `scrollHeight` are both rounded to whole numbers from the same box, so a sub-pixel overhang can round both to the same integer and hide from the very comparison the correction depends on. A fixed slop needs no detection, no extra reflow, no extra state, and no extra layout pass. `setHeight` itself was checked and does not call `scheduleLayout` — only `setSize` does ([`Component.ts:3319`](../packages/lib/src/typescript/lib/core/Component.ts#L3319)) — so neither approach schedules a pass directly; that check does not rescue the re-read option, whose loop runs through the `"heightchange"` emit rather than through `setHeight`.

[^slop-after-cap]: `capPx` is derived from the same measurement as `desired` — `perLineHeight` is `(scrollHeight - padding) / lines` and `capPx` is `perLineHeight * maxRows + padding` — so for a document of exactly `maxRows` lines the two are the same number by construction. A slop added to `desired` before `Math.min` would be clamped straight back off in that case, leaving a 20-line block with the same sub-pixel scrollbar the fix exists to remove. Adding it after the clamp covers under-cap, at-cap, and over-cap blocks uniformly. The over-cap block gets a viewport one pixel taller than `maxRows` rows, which is not a semantic change worth avoiding: `autoHeightMaxRows` is documented as the row count the editor grows to fit *before its own vertical scrollbar takes over*, and that scrollbar still takes over at the same content threshold.

[^clamp-audit]: `clampHeight` ([`Component.ts:3472`](../packages/lib/src/typescript/lib/core/Component.ts#L3472)) clamps against `getMaxSize()`/`getMinSize()` because `CodeEditor` inherits the default `clampsToContentSize()` of `true`. Each of those merges the component's own constraint with its layout manager's. `CodeEditor` sets neither `minSize` nor `maxSize`, so both fall through to the frozen base defaults in [`ComponentDefaults.ts`](../packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L16) — `{ width: 0, height: 0 }` and `{ width: UNBOUNDED, height: UNBOUNDED }` — and `CodeEditor` uses the base `LayoutManager`, whose `getMinSize`/`getMaxSize` return the same two constants ([`LayoutManager.ts:121`](../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L121)). Every bound is therefore a whole number: no `getComputedStyle` read, no border measurement, and nothing that could produce a fraction or clamp the slop away. The only fraction `syncAutoHeight` can produce is `capPx`, from its own division — and the diagnostic recorded an exact integer (`184`) for a block far under the 20-row cap, so the cap was not the source of the reported gap.
