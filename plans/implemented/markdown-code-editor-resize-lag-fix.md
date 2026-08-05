# Markdown Code-Editor Resize Lag Fix — Implementation Plan

## Overview

[`Markdown.measureContentHeight`](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L697) calls `this.syncCodeEditors()` as its first statement. `syncCodeEditors` ([Markdown.ts:879](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L879)) reads each fenced block's `ts-ui-md-code-host` wrapper's live `clientWidth` and resizes its embedded `CodeEditor` to match. On a browser resize, `measureContentHeight` runs synchronously from inside `Markdown.setWidth` ([Markdown.ts:662](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L662)), which itself runs inside `LayoutManager.commitBounds` ([LayoutManager.ts:471](../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L471)) — every layout manager's routine for positioning a child. `commitBounds` disables `Markdown`'s auto-commit (`setAutoCommitStyle(false)`) for the duration of the call, so the `width` write `Component.setWidth` queues stays buffered in `Markdown`'s `_inlineStyle` and does not reach the DOM until something later calls `commitElementStyle()`. `syncCodeEditors` runs before that flush, so it reads the wrapper's `clientWidth` against the *previous* frame's width — the embedded `CodeEditor` is resized one resize cycle behind.

This resize lag was discovered and root-caused (not just theorized) during the `markdown-code-editor-autogrow-height` plan's audit, and left unfixed as out of scope for that plan — see its `## Implementation Notes` for the original diagnosis. Both `markdown-code-editor-highlighting` and `markdown-code-editor-autogrow-height` are merged into `master`; this plan is a small, targeted fix to their already-shipped `syncCodeEditors`/`measureContentHeight` machinery, not a redesign.

The fix is a one-line addition to `measureContentHeight`: flush pending style writes before `syncCodeEditors` reads any wrapper geometry. `Panel.doLayout` ([Panel.ts:541](../packages/lib/src/typescript/lib/core/Panel.ts#L541)) already solves the identical problem the identical way — see `## Architecture Decisions`.

---

## Architecture Decisions

### `measureContentHeight` flushes pending style writes before `syncCodeEditors`, mirroring `Panel.doLayout`

Add `this.commitElementStyle()` as the first statement after `measureContentHeight`'s element-existence check, before `this.syncCodeEditors()`. This flushes whatever `Component.setWidth` (and `setX`/`setY`, if also queued) queued into `_inlineStyle` during a `commitBounds` pass, so `syncCodeEditors`'s `DOM.source.getScrollMetrics` reads see the current frame's committed width, not the previous one.[^root-cause]

`Panel.doLayout` already does exactly this, with a comment naming the same mechanism: *"Flush queued inline-style writes (own size in particular) before reading scrollbar geometry: `LayoutManager.commitBounds` runs us with `autoCommitStyle === false`, so the new width/height `setSize` queued during the parent's layout pass haven't reached the DOM yet — `scrollHeight` / `clientHeight` would otherwise report the previous frame's dimensions"* ([Panel.ts:544-551](../packages/lib/src/typescript/lib/core/Panel.ts#L544)). `measureContentHeight` adopts the same one-line idiom at the same seam — a flush immediately before the first live geometry read of the pass.

### The two existing `commitElementStyle` calls stay exactly where they are

`measureContentHeight` already calls `commitElementStyle()` twice, further down, paired with a `height: auto` probe write and its restore (`Markdown.ts:715-716` and `Markdown.ts:725-726`). Neither call moves. The new flush is additive, not a reorder of those two.[^why-not-reorder]

---

## Internal Structure

`measureContentHeight`'s new first statement (added; nothing else in the method changes except the comment noted below):

```typescript
private measureContentHeight(): void {
    const element = this.getElement();
    if (!element) {
        return;
    }

    // Flush any pending style writes — in particular a `width` queued by
    // LayoutManager.commitBounds, which disables auto-commit
    // (setAutoCommitStyle(false)) for the duration of a layout pass.
    // Markdown.setWidth calls measureContentHeight synchronously from
    // inside that window, so without this flush syncCodeEditors below reads
    // each wrapper's clientWidth against the previous frame's width. Same
    // fix as Panel.doLayout's pre-measureScrollbarGutter flush.
    this.commitElementStyle();

    this.syncCodeEditors();

    // Read the true content height, not the committed box. `scrollHeight` is
    // floored at the element's own `clientHeight`, so measuring the live
    // (already height-committed) box would only ever report *growth* — a
    // document that reflows wider or is edited shorter could never shrink its
    // extent, leaving stale dead space. Collapse the box to its content
    // first — the width was already flushed above, so this second flush only
    // needs to commit the `height: auto` write below. The raw style write is
    // a transient probe restored below, not persistent state, so it
    // deliberately bypasses the typed `setHeight` (which takes only a number).
    const restoreHeight = this.getHeight();
    this.setElementStyle("height", "auto");
    this.commitElementStyle();

    // ... unchanged from here down ...
}
```

The only other change is the comment above `restoreHeight`: its old wording ("the flush also commits the buffered width so the read reflects the assigned width") is now inaccurate — the width is flushed by the new earlier call, not this one — and is replaced with the wording shown above.

---

## Ordered Implementation Steps

1. **`Markdown.ts` — add the early flush.** In `measureContentHeight` ([Markdown.ts:697](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L697)), insert `this.commitElementStyle();` (with the comment shown in `## Internal Structure`) between the `if (!element) { return; }` block and the `this.syncCodeEditors();` call. Check: `grep -n "commitElementStyle\|syncCodeEditors" packages/lib/src/typescript/lib/component/display/Markdown.ts` shows the new `commitElementStyle()` call immediately before `syncCodeEditors()`, and the two pre-existing `commitElementStyle()` calls unchanged further down.

2. **`Markdown.ts` — update the stale comment.** Replace the sentence "Collapse the box to its content first; the flush also commits the buffered width so the read reflects the assigned width (the commitBounds/stale-DOM gotcha)." with the corrected wording in `## Internal Structure`'s comment block, reflecting that the width is now flushed by step 1's earlier call.

3. **`Markdown.test.ts` — add the ordering regression test.** Add a new `describe('Markdown.measureContentHeight — commitBounds width-flush ordering', ...)` block (placed after the existing `describe('Markdown.syncCodeEditors (private, called directly)', ...)` block, so it can reuse `buildCodeHostTrio` and `FakeCodeEditor`). Add one test per `## Expected Behaviour`'s first case. Check: run it against the pre-fix code (temporarily revert step 1) to confirm it fails, then against the fix to confirm it passes — the offline harness stubs `getScrollMetrics` to a fixed value regardless of DOM writes, so this test pins call *order* through the `RecordingDOMSink`'s write log, not the geometry value itself.

4. **Run verification.** Per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |

---

## Expected Behaviour

- **`measureContentHeight` flushes a pending width write before `syncCodeEditors` reads any wrapper's geometry.** Concretely: given a `Markdown` with an already-applied `CodeEditor` (an entry in `_codeEditors`), calling `setAutoCommitStyle(false)`, then `setWidth(newWidth)` — mirroring `LayoutManager.commitBounds`'s own call sequence — then `setAutoCommitStyle(true)`, the `width` style write for `Markdown`'s own element must appear in the DOM sink's write log *before* the first `DOM.source.getScrollMetrics` call `syncCodeEditors` makes for the wrapper. **Unit-testable** via the `RecordingDOMSink` write log (`sink.writes`) cross-referenced against a spied `getScrollMetrics` call, following the existing `'re-syncs an already-applied editor width from its wrapper clientWidth'` test's fixture setup ([Markdown.test.ts:934](../packages/lib/tests/component/display/Markdown.test.ts#L934)):

  ```typescript
  it('flushes a pending width write before syncCodeEditors reads wrapper geometry', () => {
      const md = new Markdown('hello');
      md.getElement(true);
      const anyMd = md as any;
      const { wrapper } = buildCodeHostTrio(md);
      const editor = new FakeCodeEditor('x', { readOnly: true, language: 'javascript' });
      anyMd._codeEditors.push({ editor, wrapper });

      const scrollMetricsWriteCounts: number[] = [];
      vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => {
          scrollMetricsWriteCounts.push(sink.writes.length);
          return {
              scrollTop: 0, scrollLeft: 0, scrollWidth: 0,
              scrollHeight: 240, clientWidth: 640, clientHeight: 240,
          };
      });

      // Mirrors LayoutManager.commitBounds: Markdown.setWidth calls
      // measureContentHeight synchronously from inside this window.
      md.setAutoCommitStyle(false);
      md.setWidth(300);
      md.setAutoCommitStyle(true);

      const widthWriteIndex = sink.writes.findIndex(
          (w) => w.op === 'apply' && w.args[0] === md.getElement()
              && (w.args[1] as { style?: { width?: string } }).style?.width === '300px',
      );

      expect(widthWriteIndex).toBeGreaterThanOrEqual(0);
      expect(scrollMetricsWriteCounts.length).toBeGreaterThan(0);
      expect(scrollMetricsWriteCounts[0]).toBeGreaterThan(widthWriteIndex);
  });
  ```

  Before the fix, `scrollMetricsWriteCounts[0]` is captured while the width write is still queued (not yet in `sink.writes`), so it is *less than or equal to* `widthWriteIndex` (the width write appears later, once the pre-existing `height: auto` flush runs) — the assertion fails. After the fix, the width write lands first.

- **Every other `measureContentHeight` caller is unaffected.** The constructor's `onFirstLayout`, `ThemeManager.onThemeChange`, `setMarkdown`, and `handleCodeEditorHeightChange` call paths never run inside a `setAutoCommitStyle(false)` window, so `_inlineStyle` has nothing queued when the new flush runs and it is a no-op. **Covered by the existing `'Markdown content-height measurement'` and related suites staying green** — no new test needed; per `## Verification`, run the full existing `Markdown.test.ts` suite.
- **The real-browser resize-lag symptom is fixed.** An embedded `CodeEditor` resizes to the current frame's width on a browser window resize, not the previous one. **Manual-verify only** — the offline harness stubs `getScrollMetrics` to a fixed value regardless of actual DOM state (see the existing `stubScrollHeight` comment at [Markdown.test.ts:575-581](../packages/lib/tests/component/display/Markdown.test.ts#L575)), so it cannot express real geometry-dependent staleness; only the call-order regression above is unit-testable.

---

## Verification

- `npm run typecheck` (packages/lib) — zero errors.
- `npm test` (packages/lib) — the new test from `## Expected Behaviour`, plus the full existing `Markdown.test.ts` suite green (in particular `'Markdown content-height measurement'` and `'Markdown.syncCodeEditors (private, called directly)'`).
- Manual smoke test: `npm run dev`, open the lib's demo gallery's `MarkdownPanel` tab (`packages/lib/src/typescript/MarkdownPanel.ts` — has fenced code blocks already upgraded to `CodeEditor`, used for the autogrow plan's own manual verification). Resize the browser window (or a side panel that changes the panel's width) and confirm a fenced block's `CodeEditor` visibly resizes in step with the current resize, not one cycle behind — this is the specific check the autogrow plan's audit ran and recorded as failing (see its `## Implementation Notes`).

---

## Potential Challenges

- **The new `commitElementStyle()` call issues a `DOM.sink.apply` even when nothing is queued**, since `StyleTarget.flush()` ([StyleTarget.ts:79](../packages/lib/src/typescript/lib/core/StyleTarget.ts#L79)) does not early-return on an empty dirty bag. This is already true of the two pre-existing calls in this same method, so it adds no new behaviour class — just one more cheap, already-tolerated no-op write in the common case where nothing is queued.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](../packages/lib/src/typescript/lib/component/display/Markdown.ts) — `measureContentHeight`, `syncCodeEditors`, `setWidth`, `applyCodeEditorUpgrade`. Read in full before editing.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](../packages/lib/src/typescript/lib/core/Panel.ts) — `doLayout` ([Panel.ts:541](../packages/lib/src/typescript/lib/core/Panel.ts#L541)), the precedent this fix mirrors.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](../packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` ([LayoutManager.ts:471](../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L471)), the mechanism that opens the `setAutoCommitStyle(false)` window this bug lives in.
- [`packages/lib/src/typescript/lib/core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts) — `setElementStyle` ([Component.ts:1471](../packages/lib/src/typescript/lib/core/Component.ts#L1471)), `commitElementStyle` ([Component.ts:1528](../packages/lib/src/typescript/lib/core/Component.ts#L1528)), `setWidth` ([Component.ts:3345](../packages/lib/src/typescript/lib/core/Component.ts#L3345)).
- [`packages/lib/tests/component/display/Markdown.test.ts`](../packages/lib/tests/component/display/Markdown.test.ts) — `buildCodeHostTrio` ([Markdown.test.ts:881](../packages/lib/tests/component/display/Markdown.test.ts#L881)) and `FakeCodeEditor` ([Markdown.test.ts:779](../packages/lib/tests/component/display/Markdown.test.ts#L779)), reused by the new test.
- [`plans/implemented/markdown-code-editor-autogrow-height.md`](implemented/markdown-code-editor-autogrow-height.md) — `## Implementation Notes`, the original diagnosis this plan fixes.

---

## Non-Goals

- **No change to `CodeEditor`'s `syncAutoHeight` or the 20-row cap / scrollbar-reserve logic.** Those shipped in `markdown-code-editor-autogrow-height` and are unrelated to this width-read ordering bug.
- **No change to `applyCodeEditorUpgrade`'s own metrics read of the placeholder `<pre>`.** That read happens through the same `syncCodeEditors` call this fix reorders relative to, and benefits from the same flush, but is not itself modified.
- **No general audit of other `setElementStyle`/`commitElementStyle` call sites.** Scoped to `measureContentHeight`'s one confirmed bug.

---

## Notes

[^root-cause]: Traced end to end: a browser resize fires `Event`'s viewport `"resize"` listener, which `Body.init` registers ([Body.ts:160](../packages/lib/src/typescript/lib/core/Body.ts#L160)); `Body._onViewportResize` ([Body.ts:171](../packages/lib/src/typescript/lib/core/Body.ts#L171)) calls `this.setSize(...)`, which calls `this.scheduleLayout()` ([Component.ts:5489](../packages/lib/src/typescript/lib/core/Component.ts#L5489)) to queue a layout flush on the next animation frame (`flushPendingLayouts`, [Component.ts:180](../packages/lib/src/typescript/lib/core/Component.ts#L180)). That flush calls `doLayout()` down the component tree; every layout manager positions each child through `LayoutManager.commitBounds` ([LayoutManager.ts:471](../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L471)), e.g. from `Border.doLayout` ([Border.ts:964](../packages/lib/src/typescript/lib/layout/Border.ts#L964)). `commitBounds` calls `component.setAutoCommitStyle(false)`, then `setX`/`setY`/`setWidth`/`setHeight`, then `doLayout()`, then `setAutoCommitStyle(true)`. When the component being positioned is a `Markdown`, its `setWidth` override ([Markdown.ts:662](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L662)) calls `measureContentHeight()` synchronously, still inside the disabled-auto-commit window — the width write queued by `super.setWidth` (via `Component.setElementStyle`, [Component.ts:1471](../packages/lib/src/typescript/lib/core/Component.ts#L1471)) has not reached the DOM. `syncCodeEditors`'s two responsibilities (finishing a pending `CodeEditor` upgrade via `applyCodeEditorUpgrade`, and re-syncing an already-applied editor's width) both only *read* committed DOM geometry — neither has any reason to run before an unflushed write, confirmed by checking `syncCodeEditors`'s one call site (`measureContentHeight`, [Markdown.ts:703](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L703) — the only caller found by `grep -n "syncCodeEditors()" Markdown.ts`) and the original shipped plan's own ordering note (`markdown-code-editor-highlighting.md`, step 5): `syncCodeEditors` must run before `Markdown`'s own `scrollHeight` read further down in `measureContentHeight` (so a freshly-applied wrapper's height, written directly and unbuffered via `DOM.sink.apply` in `applyCodeEditorUpgrade`, is visible to that read) — a constraint this fix does not touch, since the new flush is inserted *before* `syncCodeEditors`, not between it and the `scrollHeight` read.

[^why-not-reorder]: An alternative fix — moving the existing `height: auto` write and its `commitElementStyle()` call (Markdown.ts:715-716) to run *before* `syncCodeEditors` instead of adding a new, separate flush — was considered and rejected. It would also fix the width-staleness bug (any `commitElementStyle()` call before `syncCodeEditors` flushes the queued width), but it conflates two independent probes: the `height: auto` collapse exists solely to make `Markdown`'s own later `scrollHeight` read reflect shrinkage, and has nothing to do with `syncCodeEditors`'s width reads. Moving it earlier would make a future reader wonder why a height-auto collapse is required before a *width* re-sync. A dedicated flush, with a comment naming the actual reason (a queued width from `commitBounds`), keeps each `commitElementStyle()` call paired with the one write it exists to flush — matching `Panel.doLayout`'s own single-purpose flush.
