---
touches-shared: ["../../loom/TODO.md", "packages/lib/src/typescript/lib/component/editor/CodeEditor.ts"]
---

# Save Preserves Scroll Position — Implementation Plan

## Overview

Saving a file that is scrolled away from the top re-renders the whole document and drops the scrollbar back to the top, as [`TODO.md:61`](../../loom/TODO.md#L61) reports in Loom, the app consuming this library. The cause is format-on-save: Loom's `save()` (`src/EditorController.ts:548` in the Loom repo) calls `formatBeforeSave`, which calls `CodeEditor.format()`, which replaces the entire document in one CodeMirror transaction. CodeMirror maps its scroll anchor through that transaction's change set, a whole-document replace maps every document position to `0`, and CodeMirror's next measurement pass then scrolls the viewport to the position it thinks the anchor moved to — the very top.[^anchor-chain]

The defect is in this library, so the code change is here. This plan edits `CodeEditor.format()` in `@jimka/typescript-ui` so that a formatter result matching the document produces no transaction at all, and a result that does change the document carries CodeMirror's own scroll snapshot across the replace. Loom's `src/` is not touched; Loom picks the fix up from the rebuilt library.

**Path convention for this plan:** paths beginning `packages/lib/` are relative to this repo, `/home/jika/typescript/typescript-ui`. All other paths (`src/…`, `TODO.md`) are relative to the sibling Loom repo at `/home/jika/typescript/loom`.

---

## Architecture Decisions

### The fix lands in this library's `CodeEditor`, not in Loom

The whole-document replace and the scroll reset both happen inside [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:546`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L546)'s `format()`, which owns the only reference to the CodeMirror view. Loom cannot reach the transaction and cannot undo its effect after the fact, so the change is made where the transaction is built.[^why-not-loom]

This follows how Loom already handles a defect whose root cause is in this library: this repo carries one worktree per Loom-surfaced library gap (`feature/list-row-enabled-state`, `feature/tab-label-styling`, `feature/tab-doubleclick-event`, `feature/command-palette-first-item-focus`, `feature/formatter-options`), each tracked as a `## High` entry in Loom's `TODO.md`. This defect is another of those.[^precedent]

### An unchanged formatter result produces no transaction

When the formatter returns text the document already holds, `format()` returns without dispatching anything. No transaction means no re-render, no undo entry, no `"change"` event, and nothing for CodeMirror's scroll anchor to be mapped through.[^why-skip]

### The viewport is carried across the replace by `scrollSnapshot()`

When the formatter result does differ, the replace transaction also carries `EditorView.scrollSnapshot()`, CodeMirror's purpose-built "put the scroll position back where it is now" effect. CodeMirror's measurement pass honours a scroll target in preference to its own anchor correction, so the document position that sat at the top of the visible area stays there.[^snapshot]

The snapshot must be taken **before** the transaction is dispatched, while the view still holds the old document — it reads the live scroller offset at the moment it is called. The implementation binds it to a local immediately before the `dispatch` call to make that ordering explicit.

`scrollSnapshot()` returns `StateEffect<ScrollTarget>`, and `ScrollTarget` is not part of `@codemirror/view`'s exported types, so the local must take its inferred type — do not annotate it.

### The apply step becomes a private method so the skip is testable

The apply-or-skip decision moves into a private `applyFormatted(formatted, cursorOffset)`, which the test suite can spy on. This mirrors [`reindentFallback`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L579) in the same class, extracted for exactly this reason: the transaction needs a live view that the offline test harness never mounts, so the *decision* is what gets tested.[^extract]

### `setValue()` keeps its unconditional replace

[`CodeEditor.setValue()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L358) dispatches the same shape of whole-document replace and resets the viewport the same way, but it means "load a different document", where starting at the top is the right answer. It is left unchanged here. The separately planned Loom feature *Refresh an open file when it changes on disk* (`TODO.md:40` in Loom) reloads a buffer whose content the user is still reading, and that feature is where preserving the viewport across `setValue()` belongs — `scrollSnapshot()` is the same primitive it will want.

---

## Implementation

`format()` keeps its language lookup, its fallback branch, and its formatter call; only the last two statements change. Replace [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:562-569`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L562) (the `this._options.value = result.formatted;` assignment and the `if (this._view) { … }` block that follows it) with a single call:

```typescript
        const result = await formatter(source, cursorOffset);

        this.applyFormatted(result.formatted, result.cursorOffset);
    }
```

Then add the new method immediately after `format()`, before `reindentFallback`:

```typescript
    /**
     * Applies a successful formatter result to the document: a whole-document
     * replace carrying the formatter's mapped cursor, plus a scroll snapshot so
     * the viewport stays where the user left it. A no-op when the formatter
     * returned text the document already holds — no transaction, so no
     * re-render, no undo entry, and no `"change"` event for a save that had
     * nothing to reformat.
     *
     * Factored out of `format()` so the apply-or-skip decision is unit-testable
     * by spying on this method — the transaction itself needs a live view
     * (guarded below) and is manual-verify only, mirroring `reindentFallback`.
     *
     * @param formatted - The formatter's output text.
     * @param cursorOffset - The formatter's cursor offset into `formatted`.
     */
    private applyFormatted(formatted: string, cursorOffset: number): void {
        if (formatted === this.getValue()) {
            return;
        }

        this._options.value = formatted;

        if (!this._view) {
            return;
        }

        // Taken before the dispatch, while the view still holds the old
        // document: `scrollSnapshot()` reads the live scroller offset and the
        // document position sitting at the top of the visible area. Without it,
        // CodeMirror maps its own scroll anchor through the change set below,
        // which sends every position in a whole-document replace to 0, and the
        // next measurement pass scrolls the viewport to the top.
        const scrollSnapshot = this._view.scrollSnapshot();

        this._view.dispatch({
            changes:   { from: 0, to: this._view.state.doc.length, insert: formatted },
            selection: { anchor: Math.min(cursorOffset, formatted.length) },
            effects:   scrollSnapshot,
        });
    }
```

The equality check reads `this.getValue()` — the document as it stands now — not the `source` captured before the formatter ran. The formatter is asynchronous (it dynamic-imports its bundle), so the two can differ; "is there anything to apply" is a question about the current document.

---

## Ordered Implementation Steps

Steps 1-7 are in this repo, `/home/jika/typescript/typescript-ui`. Steps 8-10 are in the sibling Loom repo, `/home/jika/typescript/loom`.

1. **Create a worktree.** From `/home/jika/typescript/typescript-ui`: `git worktree add .worktrees/code-editor-format-preserves-scroll -b feature/code-editor-format-preserves-scroll`, then `cd` into it. All of steps 2-7 happen there.

2. **Write the failing tests** in `packages/lib/tests/component/code-editor.test.ts`, inside the existing `describe('CodeEditor format() dispatch')` block at line 1346. Three tests, following that block's existing shape (`registerLanguage` with a stub `loadFormatter`, then `new CodeEditor(...) as any`):
   - *skips the apply when the formatter returns the document unchanged* — a formatter returning `source` verbatim; `vi.spyOn(editor, 'applyFormatted')` is called once, and a `dispatch` spy on an injected `_view` is not called at all.
   - *dispatches a whole-document replace when the formatter changes the text* — assert the spec passed to `dispatch` carries `changes: { from: 0, to: <doc length>, insert: <formatted> }` and `selection: { anchor: <clamped cursor> }`.
   - *carries a scroll snapshot on the replace* — assert the same spec's `effects` is the exact sentinel the injected view's `scrollSnapshot()` returned.
   All three inject a duck-typed view the way the `syncAutoHeight` tests do (`editor._view = { … }`, e.g. line 405). The stub needs four members, because `format()` reads the caret off it and `getValue()` reads the document text off it:

   ```typescript
   editor._view = {
       state: {
           doc:       { length: source.length, toString: () => source },
           selection: { main: { head: 0 } },
       },
       dispatch:       vi.fn(),
       scrollSnapshot: () => SNAPSHOT,
   };
   ```

   `doc.toString` is not optional — without it `getValue()` returns `"[object Object]"` and the equality check compares the wrong thing. Run `npm test` — the first test fails on the un-extracted method, the third on the missing `effects`.

3. **Edit `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`** exactly as `## Implementation` above specifies: shrink `format()`'s tail to the single `applyFormatted` call, and add the `applyFormatted` method after it.

4. **Update `format()`'s JSDoc** (the `@remarks` block at lines 536-544). Keep the existing sentences about a throwing formatter and about cursor preservation, and add two: that a formatter returning the document unchanged leaves it untouched with no transaction, and that the visible area is preserved across the replace. Do **not** write `{@link applyFormatted}` anywhere in it — `format()` is public and TypeDoc excludes private members, so linking one warns (`CODE_CONVENTIONS.md`, *Don't `{@link}` internal symbols from public JSDoc*). The existing text does not link `reindentFallback` either; match that.

5. **Run `npm test`** — the three new tests pass and the four pre-existing `format() dispatch` tests still do, including *resolves and applies the result when the formatter succeeds* (line 1351), which depends on `_options.value` still being written on the changed path.

6. **Run `npm run typecheck` and `npm run lint`.** The lint run is not optional here: `local/no-raw-dom` runs with an empty baseline, so it is what confirms the new code introduced no DOM reference.

7. **Update `packages/lib/docs/components/CodeEditor.md`**, the `## format() semantics` section at line 76 — see `## Documentation Impact`.

8. **Manual-verify in this library's dev app** (still in the worktree): `npm run dev`, open the **CodeEditor** section, paste roughly 200 lines of deliberately mis-formatted JavaScript into the editor, scroll to the middle, and press **Format**. The document reformats and the visible area does not move. Scroll to the middle again and press **Format** a second time: the document does not change and the visible area still does not move. Both presses jump to the top before the fix, which is the red state to confirm first.

9. **Update Loom's `TODO.md:61`** (`/home/jika/typescript/loom/TODO.md`) — delete the `**Saving a file that I'm currently editing**, reloads the entire file and moves the scrollbar to the top, loosing the current work state.` bullet from `## High`.

10. **Manual-verify end to end in Loom**, once this branch has been merged and `npm run build:lib` has been run from this repo's own main working tree — that tree is what Loom's `node_modules/@jimka/typescript-ui` symlink resolves to, and Loom loads its built `dist/lib`, so nothing reaches Loom until that build runs. Then from Loom: `npm run tauri:dev`, open a long `.ts` or `.md` file, scroll to the middle, edit a line, press Ctrl/Cmd+S. The file saves, the status bar reports it, and the visible area stays put.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `../../loom/TODO.md` (the sibling Loom repo) |

---

## Expected Behaviour

The rule that decides each case is: apply the formatter result only when it differs from the current document, and when applying, pin the viewport to the document position that was at its top.

| Case | Transaction? | Viewport | Testable |
|---|---|---|---|
| Formatter returns the document verbatim | none | unmoved | unit |
| Formatter changes the text, editor scrolled to the middle | one replace, carrying the snapshot | the top line of the visible area stays at the top | unit (spec shape) + manual (rendered result) |
| Formatter changes the text, editor scrolled to the top | one replace, carrying the snapshot | stays at the top | manual |
| Formatter changes the text, editor scrolled to the bottom | one replace, carrying the snapshot | the top line of the visible area stays put, clamped to the new maximum offset when the document got shorter | manual |
| Formatter throws (invalid syntax mid-edit) | none | unmoved | unit (already covered at line 1367) |
| Language has no formatter (`.py`, `.css`, no extension) | re-indent fallback, unchanged | unmoved, as today | unit for the fallback path (line 1380); viewport manual |

Further behaviours to pin:

- **A save of an already-formatted document produces no `"change"` event and no undo entry** (unit-testable through the `dispatch` spy: it is never called). Today it produces both, plus a full re-render — the "reloads the entire file" half of the report.
- **The formatter's cursor mapping is unchanged**: the caret still lands at `Math.min(result.cursorOffset, result.formatted.length)`. The caret may now sit outside the restored visible area if the formatter moved it far; that is not a regression (it was off-screen after the jump to the top too), and the next cursor command scrolls it back into view. Unit-testable via the dispatched `selection`.
- **Offline (no mounted view) behaviour is unchanged**: `getValue()` reports the formatted text after `format()` resolves, because `_options.value` is still written on the changed path. Unit-testable; the existing test at line 1351 covers it.
- **Loom's save path is unchanged in every other respect** — `formatBeforeSave`'s two guards (`src/EditorController.ts:605` in Loom), the disk write, `markClean()`, the tab label losing its dirty dot, and the status-bar message all behave exactly as before. Manual verification only (step 10).

---

## Verification

In this repo's worktree:

- `npm test` — the three new tests plus the whole existing suite.
- `npm run typecheck`.
- `npm run lint` — the `local/no-raw-dom` empty baseline is the check that matters here.
- `grep -n 'this._options.value = result.formatted' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect zero matches: the assignment now lives inside `applyFormatted`, behind the equality check.
- `grep -n 'scrollSnapshot' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — expect exactly the two lines inside `applyFormatted` (the local and the `effects` field).
- Manual: this library's dev app's **CodeEditor** section, per step 8.

In Loom, after this branch is merged and rebuilt:

- `npm run typecheck` and `npm test` — both must still pass; neither should change, since no Loom source is touched.
- Manual: `npm run tauri:dev`, per step 10.

---

## Documentation Impact

`packages/lib/docs/components/CodeEditor.md`, the `## format() semantics` section at line 76. The first bullet currently reads that on success "the whole document is replaced in one transaction and the cursor is preserved". Extend that list so it states, in the page's existing voice:

- that a formatter returning the document unchanged leaves it completely untouched — no transaction, so no re-render, no undo entry, and no `"change"` event;
- that when the document does change, the editor's visible area is preserved across the replace rather than jumping to the top.

The `## Dirty state` section at line 84 needs no change: it already says the editor is dirty whenever the document differs from the clean text, which is exactly what a skipped no-op format leaves in place.

No API surface moves, so nothing changes in `packages/lib/llms.txt` (its `CodeEditor` line is a one-sentence component summary) and nothing needs regenerating by hand — `docs/api/**` is TypeDoc output and is not committed.

---

## Potential Challenges

- **The snapshot has to be captured before the dispatch.** The effect has to ride in the replace transaction, and it records the scroller offset live at the moment it is built, so it can only be built beforehand. Mitigation: the local binding immediately before `dispatch`, and its comment, exist to make the ordering visible.
- **`ScrollTarget` cannot be imported.** Annotating the local would not compile. Mitigation: leave the local's type inferred.
- **`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` is also the target of this repo's `feature/formatter-options` worktree**, which will change how `format()` calls its formatter. Mitigation: declared in this plan's `touches-shared`; whichever lands second rebases onto the other rather than merging both edits to the same method blindly.
- **Nothing reaches Loom until this library is rebuilt.** A manual check in Loom against a stale `dist/lib` will show the old jump-to-top and read as a failed fix. Mitigation: step 10 states the build prerequisite and where the build must run.
- **`@codemirror/view` must be at 6.23 or newer** for `scrollSnapshot()`. This repo already pins `^6.43.6` and 6.43.9 is installed, so no dependency change is needed; if the pin is ever lowered, this fix goes with it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the file being changed. Read `format()` (line 546), `reindentFallback` (line 579, the extraction precedent this plan mirrors), `setValue()` (line 358, the same replace shape left alone), and `onDocChange` (line 594, the dirty/`"change"` path a skipped transaction no longer reaches).
- [`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts) — `describe('CodeEditor format() dispatch')` at line 1346 for the new tests' shape, the `reindentFallback` spy at line 1388 for the private-method spy idiom, and the injected `_view` at line 405 for the duck-typed view idiom.
- [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) — `## format() semantics`, line 76.
- `../../loom/src/EditorController.ts` — `save()` at line 548 and `formatBeforeSave` at line 604: the call chain that reaches `format()` on every save. Read to confirm no Loom change is needed, not to change it.
- `../../loom/src/data/settings.ts` — line 32, `formatOnSave: true`, which is why the defect fires on an ordinary save with no configuration at all.
- `CODE_CONVENTIONS.md` and `ARCHITECTURE.md` (this repo's root) — this library's own rules govern this change: the no-`{@link}`-to-private rule that shapes step 4, and the DOM-seam rule that step 6's lint run enforces.

---

## Non-Goals

- **No change to `CodeEditor.setValue()`.** Its viewport reset is correct for loading a different document; the external-reload feature owns the question of preserving one.
- **No change to `reindentFallback()`.** CodeMirror's `indentRange` produces only the indentation edits, not a whole-document replace, so its change set maps the scroll anchor normally and the viewport already survives it. It is also unreachable from a save, which guards on `hasFormatter` (`src/editor/languages.ts:70` in Loom).
- **No change to Loom's `src/`.** With this library fixed, the save path needs nothing; adding a Loom-side workaround as well would leave dead code behind.
- **No change to *what* the formatter does** — indent width, quote style, line length. That is the separate Loom `TODO.md` item *Configurable formatting style* and this repo's `feature/formatter-options` branch.
- **No undo-history restructuring.** A reformat that genuinely changes the text stays one undo step, which is what an editor should do; only the useless undo entry for a no-op format goes away.
- **No cursor-into-view behaviour.** Pinning the viewport is the fix; chasing the caret afterwards would reintroduce a jump.

---

## Implementation Notes

**`scrollSnapshot()`'s viewport preservation is exact for the steady-state edit-then-save flow, and bounded (not exact) for a first-time, full-document reformat.**

Manual verification (Ordered Implementation Step 8) covered two shapes of change, both against the dev app's real Prettier formatter:

- A small, localized edit below the visible area (trailing whitespace on one line, deep in an otherwise-formatted 195-line document) — the top gutter line and `scrollTop` were both unchanged, byte-for-byte, after `format()`. This is the plan's target case: an ordinary edit-then-save on an already-mostly-formatted file, which is what Loom's reported bug and this plan's non-goals describe.
- The plan's own step-8 scenario — pasting ~200 lines that are *entirely* unformatted and pressing Format — where the top gutter line drifted (e.g. from line 80 to line 41 at a fixed pre-press `scrollTop`) instead of staying exactly put.

Both are consistent with footnote [^snapshot]'s own reasoning, confirmed by reading `scrollSnapshot()`'s doc comment (`node_modules/@codemirror/view/dist/index.js:8661-8677`: "The effect should be used with a document identical to the one it was created for. Failing to do so is not an error, but may not scroll to the expected position.") and `resolveTransactionInner` (`node_modules/@codemirror/state/dist/index.js:2403-2415`), which takes a spec's `effects` as-is against its own `changes` — never mapped. The snapshot's target position is therefore the *old* document's raw offset, reinterpreted unmapped against the *new* document: exactly right when nothing before that offset changed length, and off by however much the formatter's prefix grew or shrank otherwise. A first-time reformat of a wholly-unformatted file changes length on every line before the anchor; an ordinary incremental save changes length on the line(s) just edited, which is usually not before the anchor at all.

This is not a partial application of the fix — `applyFormatted()` dispatches exactly the one transaction `## Implementation` specifies, and no finer-grained position mapping is available while that transaction's `changes` stays the coarse `{ from: 0, to: length, insert: formatted }` replace this plan calls for (mapping the snapshot's position through that changeset, rather than leaving it raw, would send it to `0` — the bug this plan fixes, per footnote [^snapshot]). Recovering the exact top line across a full-document reformat would need a real text diff in place of the whole-document replace, which is a different, larger design than this plan scoped. What ships here is strictly better than the pre-fix behavior in every case (jumping to line 1 unconditionally), and exact in the case the bug report and this plan's non-goals describe.

**Steps 9 and 10 are deferred, not done, and cannot be done from this branch.** Both touch the sibling Loom repository (`/home/jika/typescript/loom`), a different git repository from this one; no commit on `feature/save-preserves-scroll-position` can carry an edit to a file there, regardless of what the plan's `## Files to Create / Modify / Delete` table or `touches-shared` frontmatter lists. Step 10 already states its own prerequisite — this branch merged and `npm run build:lib` run from this repo's main tree — and step 9 (deleting the bug bullet from Loom's `TODO.md:61-62`) has the same prerequisite in substance: removing the bullet before the fix actually reaches Loom's installed dependency would misdescribe a bug that, from Loom's point of view, is still present. Both remain open, to be done in the Loom repo after this branch is merged and the library rebuilt — not silently dropped.

---

## Notes

[^anchor-chain]: The chain, confirmed against the installed `@codemirror/view` 6.43.9 and `@codemirror/state` in `node_modules`. `EditorView.update` hands the transaction to `ViewState.update`, which records the scroll anchor as `this.scrollAnchorPos = update.changes.mapPos(scrollAnchor.from, -1)` (`node_modules/@codemirror/view/dist/index.js:6293`), where `scrollAnchor` is the line block currently at the top of the scroller. `ChangeDesc.mapPos` with `assoc < 0` returns the *start* of a replaced range for any position inside it (`node_modules/@codemirror/state/dist/index.js:751`), and a `{ from: 0, to: doc.length }` replace covers every position — so the anchor becomes `0` no matter where the user was. `update` then defers the correction with `requestMeasure()` (`index.js:8028`), and on the next animation frame `measure()` computes `newAnchorHeight = lineBlockAt(0).top`, i.e. `0`, takes `diff = newAnchorHeight - scrollAnchorHeight` — roughly minus the old scroll offset — and applies `scroll.scrollTop += diff` (`index.js:8226-8239`). That is the scrollbar moving to the top. `docView.update` having rebuilt every rendered line in the same pass is the "reloads the entire file" half. Two details fall out of the same code and match the report: at scroll offset `0` the anchor maps to `0` unchanged and `diff` is `0`, so a file read from the top never showed the bug; and because the correction is deferred to a later frame, a caller cannot fix it by writing the scroll offset back synchronously after `format()` resolves — the frame that follows would subtract it again.

[^why-not-loom]: Three Loom-side repairs were considered and rejected. (1) *Restore the offset after `format()`.* `CodeEditor` does already expose the accessors for it — `syncScrollOffsets()`, `getScrollTop()`, and `setScrollTop()` are inherited from `Component`, and `CodeEditor.getScrollElement()` (line 728) routes them onto CodeMirror's own `.cm-scroller`, so no new API would be needed. But per the footnote above, the correction lands on a later animation frame, so a synchronous restore is undone; a restore deferred past that frame depends on animation-frame callback ordering between CodeMirror and the framework, and would leave *Format Document* broken regardless. (2) *Run the formatter in Loom, compare, and call `format()` only when the output differs* — `getLanguage(id).loadFormatter()` is public and Loom's `src/editor/languages.ts` already imports `getLanguage`. This fixes only the already-formatted case, runs the formatter twice, and leaves the reported case — a file mid-edit, which the formatter does change — broken. (3) *Format the bytes on the way to disk without touching the buffer* — the buffer would then disagree with the file it was just marked clean against. (1) is also the reason the plan does not add a scroll accessor to `CodeEditor`: the accessors exist and are not the fix.

[^precedent]: Every implemented Loom plan states `No library changes. @jimka/typescript-ui is used exactly as shipped.` as a non-goal (Loom's `plans/implemented/format-on-save.md:545`, `command-palette.md:796`, `temp-tabs.md:723`, and others). That is a statement about those features, not a prohibition: when the root cause *is* in this library, Loom records it in `TODO.md` and the work happens here. Loom's `TODO.md` `## High` section carries several such entries, and this repo carries a matching worktree for each — five open, plus a merged `feature/tab-set-glyph`. This plan is the same shape, with the one difference that its `TODO.md` entry describes the Loom symptom rather than the library gap, because the gap was not yet diagnosed when the entry was written.

[^why-skip]: The skip is not just an optimisation, it is half the fix. `format()` dispatches unconditionally today, so pressing Ctrl/Cmd+S twice on an unchanged file replaces the document twice, each time re-rendering every visible line, pushing an undo entry that reverts nothing, and — before the snapshot below — moving the viewport. Saving is the most frequent thing a user does to a file that is *already* formatted, precisely because the previous save formatted it.

[^snapshot]: `EditorView.scrollSnapshot()` (`node_modules/@codemirror/view/dist/index.js:8675`) returns a `scrollIntoView` effect wrapping a `ScrollTarget` built from the live `scrollDOM.scrollTop`, the document position of the line block at that offset, and that line's pixel distance from the viewport top, with the target's `isSnapshot` flag set. `EditorView.update` reads `scrollIntoView` effects out of the transaction and installs the result as `viewState.scrollTarget` (`index.js:8005-8009`) — taking the effect's own target rather than one mapped through the changes, which is what this fix needs, since mapping it would send it to `0` like the anchor. `measure()` then checks `viewState.scrollTarget` *before* the anchor correction and skips the correction entirely when one is present (`index.js:8219-8224`), and the snapshot branch of `DocView.scrollIntoView` writes `scrollDOM.scrollTop = ref.top - target.yMargin` (`index.js:3430-3434`) — the recorded document position, back at the same distance from the top. `ScrollTarget.clip` clamps the position to the new document length (`index.js:1352`), which covers a formatter that shortened the file.

[^extract]: `reindentFallback`'s own doc comment (line 572) states the rationale verbatim: "Factored out from `format()` so the dispatch decision (formatter vs. this fallback) is unit-testable by spying on this method — the actual re-indent needs a live view (guarded below) and is otherwise manual-verify only." The same constraint applies here. The offline harness never mounts an `EditorView`, so without a spy seam the skip would be invisible to the test suite: with no view, applying and skipping leave `getValue()` reporting the same text either way.
