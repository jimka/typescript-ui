# CodeEditor Auto-Height Initial Undersize Fix — Implementation Plan

## Overview

[`CodeEditor.syncAutoHeight`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L676) computes an auto-growing editor's height from CodeMirror's own `EditorView.contentHeight` and `EditorView.defaultLineHeight` getters. On a fenced code block that `Markdown` upgrades below the page fold — off-screen at the moment the page first loads — those two getters can keep reporting CodeMirror's pre-measurement defaults indefinitely, because CodeMirror defers its own real line-height measurement while a view is scrolled outside the browser's visible viewport. `syncAutoHeight` applies that wrong, too-small number via `setHeight()`, and nothing ever corrects it: the DOM's `.cm-scroller` ends up with a real `scrollHeight` larger than the `clientHeight` `syncAutoHeight` gave it, so the browser shows a vertical scrollbar with nothing meaningful to reveal — this is the bug from the AccordionPanel docs page.

The fix stays entirely inside `syncAutoHeight`: read `.cm-scroller`'s live, native scroll metrics (already fetched one line below, for the horizontal-scrollbar check) instead of CodeMirror's own internal estimate, for both the content height and the row cap's per-row pixel size. This is a private-method-only change with no public API, `Markdown.ts`, or width-timing involvement — a different file and mechanism from the separate, already-known width-resync race in `Markdown.syncCodeEditors()` (see Architecture Decisions).

---

## Architecture Decisions

### Root cause: CodeMirror gates its own height/line measurement behind on-screen visibility

Reading `@codemirror/view`'s bundled source (`node_modules/@codemirror/view/dist/index.js`) confirms the mechanism precisely:

- `HeightOracle`'s constructor (`index.js:5354`) starts every `EditorView` at `lineHeight: 14` — a hardcoded placeholder, not a measurement.
- `EditorView`'s constructor (`index.js:7861`) never measures synchronously. It only calls `this.requestMeasure()`, which schedules the real pass on the next `requestAnimationFrame` (`index.js:8309`).
- `ViewState.measure()` (`index.js:6308`) is where the real per-line refresh happens (`oracle.refresh(...)`, setting the real line height and marking the update `heightChanged`/`geometryChanged`) — but that refresh sits *after* an early return: `if (!this.inView && !this.scrollTarget && !inWindow(view.dom)) return 0;` (`index.js:6365`). While `inView` is `false`, the function returns before ever reaching the refresh, so `defaultLineHeight`/`contentHeight` stay stuck at the constructor defaults.

This was confirmed live: on the docs app's AccordionPanel page, every fenced-block `CodeEditor` below the initial viewport fold showed `.cm-scroller`'s `clientHeight` short of its `scrollHeight` (e.g. 28 vs 47 for a 2-line block) on a plain page load. Calling `scrollIntoView()` on each of those editors — with no other change — made every one self-correct to `clientHeight === scrollHeight` within one frame, which is only possible if CodeMirror itself withholds the real measurement until the view is on-screen.[^live-repro]

### Fix: read `.cm-scroller`'s live scroll metrics instead of CodeMirror's own estimate

`syncAutoHeight` already reads `.cm-scroller`'s real metrics one statement below the line this plan changes — `DOM.source.getScrollMetrics(this._scrollElement)`, used today only for the horizontal-scrollbar check. That call forces a real browser reflow and returns native `scrollHeight`/`scrollWidth`/`clientWidth`, so it is accurate at any time, regardless of whether CodeMirror's own `inView` gate has let it refresh its internal estimate — CodeMirror always renders a short document's actual line DOM eagerly at construction (confirmed live: `.cm-line` elements with correct real heights exist in the DOM for an off-screen editor, even though `contentHeight` reports the wrong number).

The fix moves that same `getScrollMetrics` read up so `metrics.scrollHeight` becomes the content-height baseline (replacing `this._view.contentHeight`), and derives the row cap's per-row pixel height from `metrics.scrollHeight` divided by the live line count (`this._view.state.doc.lines`, a plain `EditorState.doc` property, unrelated to CodeMirror's internal height cache) instead of `this._view.defaultLineHeight`. This mirrors the codebase's own established idiom for "read geometry only after a pending write has settled": [`Markdown.measureContentHeight`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L697) forces a `commitElementStyle()` flush and then reads the DOM's own `scrollHeight` rather than trusting a cached size, and [`Panel.measureScrollbarGutter`](../packages/lib/src/typescript/lib/core/Panel.ts#L734) — the precedent the shipped `markdown-code-editor-autogrow-height` plan already cites for this exact method's scrollbar check — reads post-layout `DOM.source.getScrollMetrics` rather than a stored value. This plan simply applies that same "trust the live DOM, not a cached estimate" rule to the *other* number `syncAutoHeight` computes, since both numbers were failing for the identical reason.[^why-not-force-inview]

Because the fix reads real geometry rather than depending on a second corrective pass, it does not need CodeMirror's `updateListener` to ever fire again for an off-screen editor — the single seed call already made at the end of `mount()` becomes self-sufficient. `mount()`'s call site and the `updateListener`'s conditional call are both left unchanged; only what `syncAutoHeight` reads changes.

### Not the same bug as the resize-lag issue

The reported bug reproduces on a plain page load with no resize or interaction, and does not depend on `Markdown`'s width-resync path at all: with line wrapping off (`CodeEditor` never enables it), a line's rendered height never depends on the box's width, so a width-timing race could not produce this symptom. This plan makes no change to `Markdown.ts`. If a `markdown-code-editor-resize-lag-fix` plan exists or is written later, it addresses a distinct problem (`Markdown.syncCodeEditors()`'s width reads racing its own buffered write) with no code overlap here.

---

## Internal Structure

### `CodeEditor.ts` — `syncAutoHeight`, rewritten

```typescript
/**
 * Computes this editor's desired height when {@link CodeEditorOptions.autoHeightMaxRows}
 * is set — the real rendered content height, plus the horizontal scrollbar's
 * measured thickness when `.cm-scroller` is showing one, capped at the row
 * limit — and applies it via `setHeight()`, emitting `"heightchange"` when
 * the value actually moves. No-op offline (no `_view`, or `_scrollElement`
 * hasn't resolved) and when `autoHeightMaxRows` is unset (today's
 * fixed-height contract).
 *
 * @remarks Reads `.cm-scroller`'s live `scrollHeight`/`scrollWidth`/
 * `clientWidth` via `DOM.source.getScrollMetrics` rather than CodeMirror's
 * own `contentHeight`/`defaultLineHeight` getters. CodeMirror defers its own
 * internal line-height refresh while its view is scrolled outside the
 * browser's visible viewport (`ViewState.measure`'s `inView` gate, a
 * performance optimisation for large documents), so those getters can keep
 * reporting CodeMirror's pre-measurement default indefinitely for a fenced
 * block that upgrades below the page fold. `.cm-scroller`'s native scroll
 * metrics force a real reflow on every read and are accurate regardless of
 * that gate, since CodeMirror always renders a short document's line DOM
 * eagerly at construction. The row cap's per-row pixel height is derived
 * the same way — from the live line count, not `defaultLineHeight`.
 */
private syncAutoHeight(): void {
    const maxRows = this.getAutoHeightMaxRows();

    if (!this._view || maxRows === null || !this._scrollElement) {
        return;
    }

    const metrics = DOM.source.getScrollMetrics(this._scrollElement);

    let desired = metrics.scrollHeight;

    if (metrics.scrollWidth > metrics.clientWidth) {
        desired += DOM.source.getScrollBarWidth();
    }

    const padding       = this._view.documentPadding.top + this._view.documentPadding.bottom;
    const perLineHeight = (metrics.scrollHeight - padding) / this._view.state.doc.lines;
    const capPx         = perLineHeight * maxRows + padding;

    desired = Math.min(desired, capPx);

    if (desired === this.getHeight()) {
        return;
    }

    this.setHeight(desired);
    this.emit("heightchange", { height: desired });
}
```

Compared to the current implementation: `desired`'s starting value moves from `this._view.contentHeight` to `metrics.scrollHeight`, and `metrics` is now computed unconditionally at the top of the method (the horizontal-scrollbar check below it reuses the same `metrics` object instead of guarding a separate `if (this._scrollElement)` block, so the method now also requires `_scrollElement` up front — see the widened guard clause). `capPx`'s per-row height changes from `this._view.defaultLineHeight` to `perLineHeight`, computed from the same `metrics.scrollHeight` divided by the live line count, so a stale `defaultLineHeight` can no longer under- or over-cap an off-screen editor's height. `this._view.documentPadding` is kept as-is for both the cap's padding term and the `perLineHeight` subtraction — it is not gated by `inView` in CodeMirror's own measure pass (it's set from `getComputedStyle` before the `inView` early return), so it is reliably accurate except in the narrow, safe-direction case covered in Non-Goals.

---

## Ordered Implementation Steps

1. **`CodeEditor.ts` — rewrite `syncAutoHeight`.** Replace the method body and its doc comment exactly as shown in **Internal Structure**. The method stays `private`, in the same location (`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`, currently starting at line 676). Do not change `mount()`'s call to `this.syncAutoHeight()` or the `EditorView.updateListener.of(...)` extension's conditional call to it (both already correct call sites; only what the method reads changes). Check: `grep -n "_view.contentHeight\|_view.defaultLineHeight" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect zero matches.

2. **`code-editor.test.ts` — rewrite the five tests in `describe('CodeEditor autoHeightMaxRows')` that stub `_view.contentHeight`/`_view.defaultLineHeight`.** These tests are at [code-editor.test.ts:201-277](../packages/lib/tests/component/code-editor.test.ts#L201). Two tests above them (`'syncAutoHeight is a no-op with no live view'` and `'syncAutoHeight is a no-op with a view but autoHeightMaxRows unset'`) are unaffected — leave them exactly as they are. Rewrite the other five, and add two new ones, per the exact bodies in **Expected Behaviour** below (each one is unit-testable and given verbatim so the arithmetic doesn't need to be re-derived). Check: `npx vitest run code-editor.test.ts` (from `packages/lib`) is green.

3. **Typecheck and full test run.** `npm run typecheck` and `npm test` (from `packages/lib`) both clean — confirms no other call site or test references the removed `_view.contentHeight`/`_view.defaultLineHeight` reads.

4. **Manual verification.** Per **Verification** below — confirms the fix on the actual reported page, not just the unit tests (CodeMirror's `inView` gating cannot be modelled under the offline DOM sink; `_view` is always stubbed in tests, as the file's own top-of-file comment states).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |

No changes to `Markdown.ts`, any other source file, or any documentation page.

---

## Expected Behaviour

All cases below are unit-testable by stubbing `_view` and `_scrollElement` and spying on `DOM.source.getScrollMetrics`/`getScrollBarWidth`, exactly as the existing tests in this `describe` block already do. Give each test the exact body below — the arithmetic is worked out so the implementer does not need to re-derive it.

- **No live view: unchanged.** `'syncAutoHeight is a no-op with no live view (the real offline contract)'` ([code-editor.test.ts:176](../packages/lib/tests/component/code-editor.test.ts#L176)) — leave exactly as-is.
- **`autoHeightMaxRows` unset: unchanged.** `'syncAutoHeight is a no-op with a view but autoHeightMaxRows unset'` ([code-editor.test.ts:188](../packages/lib/tests/component/code-editor.test.ts#L188)) — leave exactly as-is.
- **New: no-op when `_scrollElement` hasn't resolved.** Add this test right after the two above, proving the widened guard clause:

  ```typescript
  it('syncAutoHeight is a no-op with a view but no resolved scroll element', () => {
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = { state: { doc: { lines: 5 } }, documentPadding: { top: 0, bottom: 0 } };
      let fired = false;
      editor.on('heightchange', () => { fired = true; });

      const heightBefore = editor.getHeight();
      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(heightBefore);
      expect(fired).toBe(false);
  });
  ```

- **Sets the content height when it is below the row cap** — replace the existing test of this name ([code-editor.test.ts:201](../packages/lib/tests/component/code-editor.test.ts#L201)) with:

  ```typescript
  it('sets the content height when it is below the row cap', () => {
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          state: { doc: { lines: 5 } },
          documentPadding: { top: 4, bottom: 4 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 500, scrollHeight: 100,
          clientWidth: 500, clientHeight: 100,
      });

      let received: { height: number } | null = null;
      editor.on('heightchange', (payload: { height: number }) => { received = payload; });

      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(100);
      expect(received).toEqual({ height: 100 });
  });
  ```

  (`perLineHeight = (100 - 8) / 5 = 18.4`; `capPx = 18.4 * 20 + 8 = 376`; `desired = min(100, 376) = 100`.)

- **Clamps to the row cap when content height exceeds it** — replace the existing test ([code-editor.test.ts:214](../packages/lib/tests/component/code-editor.test.ts#L214)) with:

  ```typescript
  it('clamps to the row cap when content height exceeds it', () => {
      // 250 lines at an even 20px/line + 8px padding = 5008px of real
      // content; capPx = 20 (perLineHeight) * 20 (maxRows) + 8 (padding) = 408.
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          state: { doc: { lines: 250 } },
          documentPadding: { top: 4, bottom: 4 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 500, scrollHeight: 5008,
          clientWidth: 500, clientHeight: 100,
      });

      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(408);
  });
  ```

- **Reserves the horizontal scrollbar width before applying the cap** — replace the existing test ([code-editor.test.ts:224](../packages/lib/tests/component/code-editor.test.ts#L224)) with:

  ```typescript
  it('reserves the horizontal scrollbar width before applying the cap', () => {
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          state: { doc: { lines: 5 } },
          documentPadding: { top: 0, bottom: 0 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 600, scrollHeight: 100,
          clientWidth: 500, clientHeight: 100,
      });
      vi.spyOn(DOM.source, 'getScrollBarWidth').mockReturnValue(15);

      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(115);
  });
  ```

  (`perLineHeight = (100 - 0) / 5 = 20`; `capPx = 20 * 20 + 0 = 400`; `desired = min(100 + 15, 400) = 115`.)

- **Reserves the width before the cap, not after** — replace the existing test ([code-editor.test.ts:241](../packages/lib/tests/component/code-editor.test.ts#L241)) with:

  ```typescript
  it('reserves the width before the cap, not after: the cap wins even when only the reserved sum exceeds it', () => {
      // capPx = 10 (perLineHeight = 190 / 19 lines) * 20 (maxRows) + 0
      // (padding) = 200. Content alone (190) is under the cap, but content +
      // the 15px scrollbar reserve (205) is not — reserving before Math.min
      // clamps to 200; reserving after would clamp 190 to 190 first and add
      // 15 on top, landing on 205. The two orders are indistinguishable at
      // any content height that already exceeds the cap on its own, which is
      // why this case (just under, only over once the reserve is added) is
      // what actually pins the ordering.
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          state: { doc: { lines: 19 } },
          documentPadding: { top: 0, bottom: 0 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 600, scrollHeight: 190,
          clientWidth: 500, clientHeight: 100,
      });
      vi.spyOn(DOM.source, 'getScrollBarWidth').mockReturnValue(15);

      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(200);
  });
  ```

- **Idempotent: a second call with unchanged inputs makes no further setHeight/emit calls** — replace the existing test ([code-editor.test.ts:265](../packages/lib/tests/component/code-editor.test.ts#L265)) with:

  ```typescript
  it('is idempotent: a second call with unchanged inputs makes no further setHeight/emit calls', () => {
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          state: { doc: { lines: 5 } },
          documentPadding: { top: 0, bottom: 0 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 500, scrollHeight: 100,
          clientWidth: 500, clientHeight: 100,
      });

      let fireCount = 0;
      editor.on('heightchange', () => { fireCount += 1; });

      editor.syncAutoHeight();
      expect(fireCount).toBe(1);

      editor.syncAutoHeight();
      expect(fireCount).toBe(1);
  });
  ```

- **New: ignores a stale `_view.contentHeight`/`defaultLineHeight` — the actual regression test for this bug.** Add this test at the end of the `describe` block:

  ```typescript
  it('reads the real DOM scroll metrics for content height, not the CodeMirror view\'s own possibly-stale estimate', () => {
      // contentHeight/defaultLineHeight stand in for CodeMirror's stale,
      // pre-measurement defaults (see the syncAutoHeight doc comment) — set
      // to deliberately wrong values to prove the method no longer reads
      // them; only the DOM.source.getScrollMetrics mock below should win.
      const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
      editor._view = {
          contentHeight: 9999,
          defaultLineHeight: 9999,
          state: { doc: { lines: 5 } },
          documentPadding: { top: 4, bottom: 4 },
      };
      editor._scrollElement = DOM.sink.createElement('div');

      vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
          scrollTop: 0, scrollLeft: 0,
          scrollWidth: 500, scrollHeight: 100,
          clientWidth: 500, clientHeight: 100,
      });

      editor.syncAutoHeight();

      expect(editor.getHeight()).toBe(100);
  });
  ```

- **Real off-screen `CodeEditor` on the docs app.** A fenced block that upgrades below the page fold settles at its real content height with no spurious vertical scrollbar, matching an on-screen block, with no scroll or resize needed. **Manual-verify only** — CodeMirror's `inView` gating (and the whole live `EditorView`) cannot be modelled under the offline DOM sink; see the test file's own top-of-file comment.

---

## Verification

- `npm run typecheck` (from `packages/lib`) — zero errors.
- `npx vitest run code-editor.test.ts` (from `packages/lib`) — all cases in **Expected Behaviour** green, plus the rest of the file unaffected.
- `npm test` (from `packages/lib`) — full suite green (confirms nothing else in the codebase reads `CodeEditor`'s removed internal reads).
- `npm run build:lib` (from repo root), then manual smoke test: start or reuse the docs dev server (`ps aux | grep vite`; if none, `cd packages/docs && npm run dev`), navigate to `/typescript-ui/components/AccordionPanel`, and confirm every fenced-code block under "Adding sections after construction" renders with no vertical scrollbar on a plain page load (no scrolling first) — check via `document.querySelectorAll('.cm-scroller')` in the browser console: every entry's `clientHeight` should equal its `scrollHeight`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — `mount()` (~line 586) and `syncAutoHeight()` (~line 676), the method this plan rewrites.
- [`packages/lib/tests/component/code-editor.test.ts`](../packages/lib/tests/component/code-editor.test.ts) — the `describe('CodeEditor autoHeightMaxRows')` block (lines 163-278) this plan rewrites; read the file's own top-of-file comment (lines 26-30) on the offline/live-view split before editing.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) — `measureContentHeight` (line 697), the precedent this plan's "read live DOM, not a cached estimate" rule mirrors. Not modified by this plan.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts) — `measureScrollbarGutter` (line 734), the precedent the shipped `markdown-code-editor-autogrow-height` plan already cites for this same method's scrollbar-detection idiom, which this plan extends to the content-height read too.
- [`plans/implemented/markdown-code-editor-autogrow-height.md`](implemented/markdown-code-editor-autogrow-height.md) — the plan that shipped `syncAutoHeight` and `autoHeightMaxRows`; read its Architecture Decisions and Implementation Notes for the full context this plan revises. Its Implementation Notes already record a *different*, unresolved timing gap in `Markdown.syncCodeEditors()`'s width resync — unrelated to this fix (see Architecture Decisions, "Not the same bug as the resize-lag issue").

---

## Non-Goals

- **No change to `Markdown.ts` or the width-resync path.** This bug is width-independent (line wrapping is off); the width-resync timing gap flagged in the shipped plan's Implementation Notes is a separate, unaddressed issue.
- **No attempt to force CodeMirror to treat an off-screen editor as in-view.** Reading real DOM geometry directly makes this unnecessary, and there is no public, stable CodeMirror API for it (`EditorView.readMeasured` exists but is marked `private` in `@codemirror/view`'s own type declarations).
- **No perfect fix for the row cap's padding term at the very first synchronous `mount()`-time call.** `this._view.documentPadding` can itself still read `{top: 0, bottom: 0}` on that one specific call (before CodeMirror's first-ever measure pass, which always happens on the next animation frame regardless of `inView`) — see the footnote below for why this is accepted rather than replaced with a third DOM read.[^padding-edge-case]
- **No new public API, setter, or option.** This is an internal correctness fix to already-shipped, unreleased behaviour (`autoHeightMaxRows` has not shipped in a numbered version yet — see Documentation Impact).

---

## Documentation Impact

None. `autoHeightMaxRows`, `getAutoHeightMaxRows()`, and `"heightchange"` are documented in [`packages/lib/docs/components/CodeEditor.md`](../packages/lib/docs/components/CodeEditor.md), but their contract does not change — only the internal correctness of the height computation does. The feature itself has not shipped in a numbered release yet: it is still under `## Added` / `### Display` in [`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md), whose existing entry ("grows to fit its real rendered content") already describes the *intended* behaviour this plan makes actually true. No changelog entry is needed for a fix to not-yet-released behaviour.

---

## Notes

[^live-repro]: Reproduced against the docs app's AccordionPanel page (`packages/docs`, dev server) with a script that queried every `.cm-scroller` on the page: on a plain load, the two fenced blocks within the first ~900px of viewport height matched (`clientHeight === scrollHeight`); every block further down the page (a long docs page, several fenced examples under "Adding sections after construction") showed a shortfall, e.g. `clientHeight: 28, scrollHeight: 47` for a 2-line block — matching the bug report's own numbers. Calling `el.scrollIntoView()` on each mismatched block and re-reading immediately after made every one settle to `clientHeight === scrollHeight`, with no other code change — isolating the cause to CodeMirror's own viewport-gated internal measurement rather than anything in `CodeEditor.ts`'s call sequencing or `Markdown.ts`'s wiring.

[^why-not-force-inview]: An alternative fix would force CodeMirror to always treat itself as in-view (bypassing the gate entirely), so `contentHeight`/`defaultLineHeight` stay accurate without needing a DOM-metrics read at all. Rejected: there is no public, supported way to do this — CodeMirror's own escape hatch for a synchronous, forced measurement, `EditorView.readMeasured()`, is `private` in `@codemirror/view`'s shipped type declarations (confirmed by reading `node_modules/@codemirror/view/dist/index.d.ts`), so calling it from `CodeEditor.ts` would depend on an explicitly unstable, undocumented method that could disappear in a routine CodeMirror upgrade. Reading `.cm-scroller`'s real DOM metrics uses only long-standing, fully public CodeMirror surface (`EditorView.scrollDOM`, indirectly via the already-resolved `_scrollElement`) and the project's own existing `DOM.source.getScrollMetrics` seam.

[^padding-edge-case]: `this._view.documentPadding`'s underlying fields are set from `getComputedStyle` inside `ViewState.measure()`, *before* that method's `inView` early return — so they become accurate on CodeMirror's first-ever measure pass regardless of on-screen visibility, and stay accurate from then on. The one narrow gap is `mount()`'s own synchronous seed call, which runs before that first pass has had a chance to fire at all (padding is still at its `0`/`0` construction default at that exact instant). The consequence is confined to the row cap (`capPx`), not the content height (`desired`): omitting ~8px of real padding from the `perLineHeight` subtraction makes the derived per-row height a few percent *larger* than the true value, which makes `capPx` a few percent *more generous* than intended — the safe direction, since it can only delay clamping, never cause the under-sized/spurious-scrollbar failure this plan fixes. A third DOM read (e.g. `getComputedStyle` on `.cm-content`) could close this remaining gap but was judged not worth the added surface for an edge case that is itself edge-case-squared (over-cap content that is *also* still off-screen on this one specific call) and never under-corrects.
