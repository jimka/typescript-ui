---
depends-on: [markdown-language-readonly-and-fences]   # the tip of the Markdown stack when this was written; use a later branch of that stack if one exists
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/tests/component/code-editor.test.ts
  - packages/lib/docs/reference/changelog/next.md       # edited by every branch
---

# Code Editor Flash After Dispose — Implementation Plan

## Overview

A read-only `CodeEditor` answers a refused edit with a short red wash, the *read-only flash*. The flash is an `Animation.play` on an overlay element whose handle — the library's opaque id for a DOM element — the editor keeps in `_flashOverlay` ([packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:3027](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L3027), line numbers from `feature/markdown-language-readonly-and-fences`).

On the Markdown stack, `format()` and `paste()` each `await` and then call `signalReadOnlyEdit()` when the editor is read-only. If the editor is disposed during the await, `destructor` has released the overlay's handle but `_flashOverlay` still holds it. The flash then plays on a released handle and throws `DOM handle N is not registered`. `format()`'s promise rejects with that error; a context-menu paste, whose promise nobody holds, ends as an unhandled rejection.

The fix is one statement in `CodeEditor.destructor`, one unit test and one changelog bullet. It belongs on the Markdown stack because the two paths that reach the flash after an `await` exist only there. The keyboard stack has the same field and the same `destructor`, but nothing on it calls the flash after a dispose.[^which-stack]

This plan is the Markdown-stack part of `plans/deferred-work-after-dispose.md`, whose inventory lists the site as row 46.

---

## Architecture Decisions

### `destructor` clears the field, and the flash already checks it

`CodeEditor.destructor` sets `_flashOverlay` to `null`. `flashReadOnly` returns at its first statement when the field is `null`, so no other code changes. The same destructor already clears `_scrollElement`, `_contentElement` and `_view` so that later code finds nothing to act on ([CodeEditor.ts:2071](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2071) on the Markdown stack).[^clear-field]

### The `"readonlyedit"` event is left alone

`signalReadOnlyEdit` still calls `emit("readonlyedit")` on a disposed editor. The editor's listener bag is cleared when it is destroyed, so nobody hears it.

---

## Ordered Implementation Steps

Run every command from `packages/lib`, with one vitest process and `--maxWorkers=1`.

1. **Check the anchors.** `grep -n "private flashReadOnly\|private mountFlashOverlay\|private signalReadOnlyEdit\|this._flashAnimation = null;" src/typescript/lib/component/editor/CodeEditor.ts`. Expect four lines, the last one inside `destructor`. If `destructor` already contains `this._flashOverlay = null;`, stop and report: the defect is fixed.

2. **Add the tests.** In `tests/component/code-editor.test.ts`, add the two cases of `## Expected Behaviour` in a new `describe('CodeEditor — read-only flash after dispose', …)`. Use the file's existing `installTestDOM` setup.

3. **See them fail.** `npx vitest run tests/component/code-editor.test.ts -t "read-only flash after dispose" --maxWorkers=1`. Both fail on `is not registered`. If F1 passes, stop and report.

4. **Apply the fix.** In `src/typescript/lib/component/editor/CodeEditor.ts`, in `destructor`, directly after `this._flashAnimation = null;`:

   ```ts
        // The overlay's handle is released by `super.destructor()` below. A
        // format or a paste that resumes after this teardown still calls
        // `flashReadOnly`, which does nothing once the field is cleared.
        this._flashOverlay = null;
   ```

5. **See them pass.** Run the command of step 3 again: 2 passed. Then `npx vitest run tests/component/code-editor.test.ts --maxWorkers=1`: no failure.

6. **Add the changelog bullet** of `## Documentation Impact`.

7. **Run the full checks** of `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

**The contract.** After `dispose()`, a `CodeEditor` plays no flash and writes through no handle, whatever resumes afterwards.

F2 starts with an editor that is not read-only because `format()` on a read-only editor flashes at once, before any `await`. The branch under test is the second check, the one after the formatter returns.

The overlay is mounted only when a live CodeMirror view exists, which the unit tests never build. Both cases therefore mount it by hand, by calling the private `mountFlashOverlay(host)` with the editor's own element.

| # | Steps | Required | Today |
|---|---|---|---|
| F1 | `new CodeEditor('x', { readOnly: true })`; `getElement(true)`; `mountFlashOverlay(host)`; `dispose()`; call the private `flashReadOnly()` | no throw; `_flashOverlay` is `null` | throws `is not registered` |
| F2 | register a language whose `loadFormatter` returns a promise the test resolves by hand; build an editor in that language that is **not** read-only and mount its overlay as in F1; call `format()` and keep the promise; then `setReadOnly(true)`, `dispose()`, and resolve the formatter's promise | `format()`'s promise resolves | rejects with `is not registered` |

F2 follows the existing case "format() that resolves after the editor became read-only changes nothing and signals the rejected edit" in the same file, which shows how to register a language with a formatter under the test's control.

**Manual.** In the demo's "CodeEditor" page, with a formatter that takes a noticeable time (throttle the network to "Slow 3G" before the first format, so the formatter's module is still loading): start a format from the toolbar, make the editor read-only, and close its tab before the formatter returns. The console stays clean.

---

## Verification

- `npx vitest run tests/component/code-editor.test.ts --maxWorkers=1` — no failure; two tests more than before.
- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — clean.
- `npm run test` — no failure; the count rises by 2.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` and `npm run build:lib` — succeed.
- `grep -n "this._flashOverlay = null" src/typescript/lib/component/editor/CodeEditor.ts` — one match, inside `destructor`.

---

## Documentation Impact

No public API changes. `packages/lib/docs/reference/changelog/next.md`, under `## Fixed` → `### Components`, as the last bullet:

```markdown
- **A read-only `CodeEditor` disposed during a format or a paste no longer
  fails afterwards.** The refused edit's flash used to play on the disposed
  editor: `format()` rejected with `DOM handle … is not registered`, and a
  paste from the context menu logged an unhandled rejection.
```

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — on the Markdown stack: `paste` (1616), `format` (1692), `destructor` (2048), `mountFlashOverlay` (2934), `signalReadOnlyEdit` (3010), `flashReadOnly` (3027).
- [packages/lib/tests/component/code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts) — the read-only `format()` cases near line 2796 on the Markdown stack.
- [plans/deferred-work-after-dispose.md](plans/deferred-work-after-dispose.md) — the sweep this site came from, and the rule for code after an `await`.

---

## Non-Goals

- **A registry row in `tests/component/dispose-deferred-work.test.ts`.** That file is created by `deferred-work-after-dispose` on the keyboard stack. When both stacks have merged, a row for this site can replace the file's baseline entry for `component/editor/CodeEditor.ts`.
- **An `isDestroyed()` check after each `await` in `format()` and `paste()`.** With the field cleared, everything those methods do after a dispose already returns early: `applyFormatted` and `paste` test `_view`, which `destructor` nulls.
- **`MarkdownEditor` and `MarkdownDocumentPanel`.** Their continuations after an `await` act on a headless Lexical editor and touch no handle (inventory rows 48 and 49).

---

## Notes

[^which-stack]: The Markdown stack changes `CodeEditor.ts` by about 400 lines and none of its hunks touches `destructor`, so the statement would merge cleanly from either side. It goes on the Markdown stack because a fix should land where its failing case exists: on the keyboard stack `signalReadOnlyEdit` is called only from CodeMirror's transaction filter, which cannot run after the view is destroyed, so the statement there would guard a state that cannot occur.

[^clear-field]: Run while drafting, on the keyboard stack, where `flashReadOnly`, `mountFlashOverlay` and `destructor` are the same code: with the overlay mounted, `dispose()` leaves `_flashOverlay` set to a handle `DOM.source.isRegistered` reports as released, and `flashReadOnly()` then throws from `Animation.play`; with the field set to `null` it returns. The `format()` and `paste()` paths were read on the Markdown stack (`git show feature/markdown-language-readonly-and-fences:…/CodeEditor.ts`) and not run there. An `isRegistered` test inside `flashReadOnly` would also work; clearing the field in `destructor` is what this class already does for its three other element references.

---

## Implementation Notes

- **Codebase drift: the fix moved to the shared class.** The plan's anchors no longer matched: the stack since moved the flash out of `CodeEditor` into a shared `ReadOnlyFlash` class (`component/editor/ReadOnlyFlash.ts`), which holds the overlay handle (`_overlay`) and the animation. `CodeEditor` and `MarkdownEditor` both own one and tear it down first in their destructor. There is no `_flashOverlay` field, so the planned statement could not be applied. The orchestrator accepted re-targeting the fix to the shared class: `ReadOnlyFlash` has a `dispose()` (first written as `cancel()`, renamed in review because it now ends the wash for good) that stops the pulse and sets `_overlay` to `null`, so a later `play()` returns at its first statement. Both destructors call it.
- **The plan's paste claim was wrong.** The plan said a paste from the context menu also flashes after a dispose and ends as an unhandled rejection. Of the `CodeEditor` paths it does not: `CodeEditor.paste` checks read-only only before its `await`, its only route to a flash afterwards is a `this._view.dispatch` guarded by `this._view` (which the destructor nulls), and a read-only editor's context menu has no paste row. `MarkdownEditor.paste` also refuses before its `await`. A review probe on the pre-fix code confirmed `paste()` resolves with no flash and no throw. The plan's footnote admits that path was read, not run. Of the `CodeEditor` paths, only `format()` is named in the changelog, tests and commits.
- **MarkdownEditor, and the plan's Non-Goals claim.** The plan's Non-Goals said `MarkdownEditor` continuations after an `await` "touch no handle". That was wrong. The context menu's Insert link and Edit link (`promptAndApplyLink`, then `toggleLink`), Image… (`promptAndInsertImage`) and Column width… (`promptAndSetColumnWidth`) await a dialog and then run a command. If the editor was made read-only and disposed while the dialog was open, the command reached `refuseIfReadOnly`, `signalReadOnlyEdit` and `_flash.play()` on the released handle; the menu actions are `void`-ed, so it ended as an unhandled rejection. The fix covers it, and `markdown-editor-readonly-mounted.test.ts` has four rows for it (Insert link, Edit link, Image…, Column width…; they fail with `dispose()` not forgetting the overlay, pass with it). The rows stub `Dialog.show` with a deferred result, as the prompt-flow tests in `markdown-editor.test.ts` do. A direct call of a refused command after `dispose()` reached `play()` before too, on both editors.
- **Tests** follow the plan's F1 and F2 in `code-editor.test.ts` (both failed with `is not registered` before the fix). F1 asserts `Animation.play` is not called and `_flash._overlay` is `null`; F2 asserts `format()` resolves to `undefined`.
- **Verification that ran, on the final code:** typecheck, typecheck:test, lint, the full suite (`--maxWorkers=4`, 19,605 passing), `docs:api`, `docs:llms:check` and `build:lib`, all clean. The plan's final grep for `this._flashOverlay = null` cannot apply: that field and statement do not exist after the re-targeting.
- **Not done:** the plan's manual demo check (Slow 3G format, close tab) was not run in a browser; no registry row or sibling-plan helper was used.
