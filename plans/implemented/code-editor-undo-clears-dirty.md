---
depends-on:
  - component-dirty-state
  - code-editor-dirty-state-adoption
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Undo Clears Dirty — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) currently reports itself dirty on **every** document change and stays dirty until a host calls `markClean()`. Undoing an edit back to the text the editor started with leaves the flag set, because nothing compares the document against anything.

This plan changes the flag's meaning: **the editor is dirty exactly when its current document text differs from the text at the last clean point.** The clean point is the text the editor was constructed with, or the text as of the most recent `markClean()` call. Undo therefore clears the flag on its own, which is what a person expects after undoing their only edit.

The change is five small edits to one class: a private `_cleanValue: string` holding the clean text, set in the constructor ([CodeEditor.ts:288-302](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L288-L302)), re-taken in `mount()` ([:776](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L776)) and in `markClean()` ([:372-376](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L372-L376)), and compared against in `onDocChange` ([:580-586](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L580-L586)). No new public API, no new option, no signature change. The rest of the work is updating the three places that assert the old contract: the unit tests, the `CodeEditor` doc page, and the demo panel's class JSDoc.

This reverses the **No baseline diffing** Non-Goal of [`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md). That plan rejected the comparison on cost. The cost was overestimated.[^content-compare]

The work starts from the `feature/code-editor-dirty-state-adoption` branch, not from `master`.[^dependency-branch]

---

## Architecture Decisions

### The dirty flag is derived by comparing the document against a stored clean copy

`CodeEditor` keeps one private string, `_cleanValue`, holding the document text as of the last clean point. Every document change compares the new text against it and sets the flag from the result. This mirrors [`ModelRecord`](packages/lib/src/typescript/lib/data/ModelRecord.ts), the codebase's existing dirty-tracking component: it keeps a committed snapshot in `_original` ([:57](packages/lib/src/typescript/lib/data/ModelRecord.ts#L57), seeded at [:97](packages/lib/src/typescript/lib/data/ModelRecord.ts#L97)), recomputes dirty by comparing against it on every field write (`recomputeDirty`, [:337](packages/lib/src/typescript/lib/data/ModelRecord.ts#L337)), and re-takes the snapshot on `commit()` ([:553-554](packages/lib/src/typescript/lib/data/ModelRecord.ts#L553-L554)). A `ModelRecord` whose field is edited and then edited back reports clean; a `CodeEditor` whose document is edited and then undone now does the same.[^content-compare]

The rule, for a mounted editor:

| Step | Document text | Clean text | `isDirty()` |
|---|---|---|---|
| `new CodeEditor('a')` | `a` | `a` | `false` |
| user types `b` | `ab` | `a` | `true` |
| user presses Ctrl-Z | `a` | `a` | **`false`** |
| user types `b` again | `ab` | `a` | `true` |
| `markClean()` | `ab` | `ab` | `false` |
| user presses Ctrl-Z | `a` | `ab` | **`true`** |
| user presses Ctrl-Y | `ab` | `ab` | `false` |

The last three rows are the point of `markClean()`: after it, `ab` is the clean text, so undoing *away* from `ab` is a change like any other.

A design based on CodeMirror's `undoDepth()` was investigated and rejected — it reports clean while unsaved edits stand, in two reachable cases.[^undo-depth-rejected]

### `onDocChange(value: string)` keeps its signature

The private seam `onDocChange(value)` ([:580](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L580)) — the one place a document change is handled, factored out of CodeMirror's update listener so the offline test harness can drive it — is unchanged apart from its one `setDirty` line. All eight existing dirty-state tests keep their call shape and keep passing without edits, and the new behaviour is exercised through the same seam by calling `onDocChange` with the clean text.[^seam-signature]

### `mount()` re-takes the clean text from the state CodeMirror built

`EditorState.create` splits the document on `/\r\n?|\n/` and `doc.toString()` rejoins with `"\n"`, so a document constructed from CRLF text reaches `onDocChange` in a form the pre-mount cached string can never equal. `mount()` re-takes `_cleanValue` from the created state, right after [:776](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L776), so the comparison compares like with like.[^crlf]

### `setValue()` and `format()` are not touched

Both already dispatch ordinary transactions through the live view ([:350-354](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L350-L354), [:550-555](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L550-L555)), so the view's own update listener calls `onDocChange` for them exactly as it does for typing. They inherit the new rule with no code aimed at them: formatting the document marks it dirty, and undoing the format back to the pre-format text clears the flag again.[^setvalue-untouched]

Neither re-establishes a clean baseline of its own. A host loading a document with `setValue()` still follows it with `markClean()`, which is what the `CodeEditor` doc page already tells consumers to do.[^no-rebaseline-on-setvalue]

---

## Public API

**No signature changes.** `markClean(): this` keeps its shape; `isDirty()` / `onDirtyChange()` / `offDirtyChange()` stay inherited from `Component`. Only `markClean()`'s documented contract moves, so its JSDoc is rewritten:

```typescript
// component/editor/CodeEditor.ts

/**
 * Accepts the current document as the clean text, clearing this editor's
 * dirty flag (and, through the framework's relay, every ancestor's, unless
 * another descendant is still dirty). Call it after the host has persisted
 * the document, or after loading one with `setValue`. Persisting is the
 * host's job — this method only reports state; it writes nothing and does
 * not change the document.
 *
 * The editor reports itself dirty whenever its document differs from the
 * clean text, so an edit that is undone back to that text clears the flag
 * on its own — and an undo that moves the document *away* from the text a
 * later `markClean()` accepted marks it dirty again.
 *
 * @returns This component, for method chaining.
 */
markClean(): this;
```

---

## Internal Structure

The new field, declared beside the other private caches (`_lastHbarReserve` at [:277](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L277)):

```typescript
/**
 * The document text as of the last clean point — the text this editor was
 * constructed with (re-taken from the mounted state in `mount`), or the
 * text `markClean()` last accepted. `onDocChange` compares against it to
 * decide the dirty flag, so an edit undone back to this text reports clean
 * again. Mirrors `ModelRecord._original`.
 */
private _cleanValue: string;
```

The comparison, replacing the unconditional `setDirty(true)`:

```typescript
private onDocChange(value: string): void {
    this._options.value = value;
    // Dirty before the emit, so a `"change"` listener that queries
    // isDirty() sees the settled value. `setDirty` is idempotent, so
    // calling it on every change costs nothing when nothing flipped.
    this.setDirty(value !== this._cleanValue);
    this.emit("change", { value });
}
```

`markClean()` re-takes the clean text before clearing the flag:

```typescript
markClean(): this {
    this._cleanValue = this.getValue();
    this.setDirty(false);

    return this;
}
```

---

## Ordered Implementation Steps

Step 1 is a real red step: `onDocChange` and `markClean` both already exist, so the new cases compile against today's code and fail on behaviour rather than on a missing symbol.

1. **[`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts)** — append cases 1-7 of **Expected Behaviour** to the existing `describe('CodeEditor dirty state', …)` block, after its last test ends at [:260](packages/lib/tests/component/code-editor.test.ts#L260). **Do not edit the eight tests already in that block** ([:165-260](packages/lib/tests/component/code-editor.test.ts#L165-L260)) — every one of them still passes under the new rule. Reach the private handler as `(editor as any).onDocChange('…')`, the probe shape the block already uses.

2. Run `cd packages/lib && npm test -- code-editor` — the eight existing dirty-state cases pass; the new ones fail. If any of the eight fails, stop: something other than this plan's change is in play.

3. **[`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)** — add the `_cleanValue` field from **Internal Structure**, directly after `_lastHbarReserve` ([:277](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L277)). Declare it bare (`private _cleanValue: string;`) with **no** initializer and **no** `declare` keyword.[^no-declare]

4. **Same file, in the constructor** — add `this._cleanValue = this.getValue();` immediately after the positional-argument block that ends at [:295](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L295), before the `_unsubscribeTheme` assignment. The assignment must come after that block, not before it and not as a field initializer, so a positional `new CodeEditor('x')` makes `x` the clean text rather than `""`.[^no-declare]

5. **Same file, in `mount()`** — directly after `const state = EditorState.create(…)` ([:776](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L776)), add `this._cleanValue = state.doc.toString();` with a comment giving the reason from the `mount()` decision above (CodeMirror normalizes line endings when it builds the state, and the editor is always clean at this point because only the live view's update listener can mark it dirty).

6. **Same file, in `onDocChange`** ([:584](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L584)) — replace `this.setDirty(true);` with `this.setDirty(value !== this._cleanValue);` and extend the adjacent comment as shown in **Internal Structure**.

7. **Same file, in `markClean()`** ([:372-376](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L372-L376)) — add `this._cleanValue = this.getValue();` as the first statement, and replace the JSDoc's second paragraph ([:367-368](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L367-L368)) with the wording in **Public API**.

8. Run `cd packages/lib && npm run typecheck && npm test` — clean, all fifteen dirty-state cases green.

9. Check: `grep -n 'this\._cleanValue' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — one write in the constructor, one in `mount`, one in `markClean`, and one read in `onDocChange`. `grep -n 'setDirty' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — still exactly two matches (`onDocChange`, `markClean`).

10. Run `cd packages/lib && npm run lint` — no new findings.

11. **[`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md)** — rewrite the `## Dirty state` paragraph ([:86](packages/lib/docs/components/CodeEditor.md#L86)) per **Documentation Impact**. Leave the `markClean()` row in `## Common methods` ([:110](packages/lib/docs/components/CodeEditor.md#L110)) alone — it already reads correctly.

12. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — amend the existing unreleased bullet at [:72-75](packages/lib/docs/reference/changelog/next.md#L72-L75) per **Documentation Impact**. Do **not** add a second bullet.

13. **[`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts)** — extend the class JSDoc's last sentence ([:21-24](packages/lib/src/typescript/CodeEditorPanel.ts#L21-L24)) so it says Save clears the flag *and* that undoing back to the last-saved text clears it too. **No code change in this file** — the panel needs none.

14. Run `cd packages/lib && npm run docs:llms` (regenerates `packages/lib/llms.txt` — never hand-edit) then `npm run docs:api` — zero warnings.

15. Run the manual browser checks in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify (JSDoc only) | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (regenerate) | `packages/lib/llms.txt` |

---

## Expected Behaviour

### Unit-testable (offline)

The offline harness never mounts a CodeMirror `EditorView`, so these drive the private `onDocChange` directly instead of typing — the same way the eight existing cases do.

1. **Undo back to the constructed text clears the flag.** `new CodeEditor('a')`; `onDocChange('ab')` makes `isDirty()` `true`; `onDocChange('a')` makes it `false` again.
2. **Both transitions fire `onDirtyChange`.** Over the sequence in case 1, a listener registered with `editor.onDirtyChange(fn)` fires exactly twice: once with `true`, then once with `false`.
3. **`"change"` still fires on the change that returns to clean.** Over the sequence in case 1, a `"change"` listener receives `{ value: 'ab' }` then `{ value: 'a' }`, and on the second call `editor.isDirty()` reads `false` — the flag is settled before the emit, in both directions.
4. **`markClean()` moves the clean text.** `new CodeEditor('a')`; `onDocChange('ab')`; `markClean()`; `onDocChange('a')` now makes `isDirty()` `true` (the document moved away from the accepted text); `onDocChange('ab')` makes it `false`.
5. **The relay follows both ways.** With `parent = new Component()` and `parent.addComponent(editor)` on a `new CodeEditor('a')`, `onDocChange('ab')` makes `parent.isDirty()` `true` and `onDocChange('a')` returns it to `false`, firing a listener on `parent` once per transition.
6. **A `setValue()` load followed by `markClean()` makes the loaded text the clean text.** `new CodeEditor('a')`; `setValue('b')`; `markClean()`; `onDocChange('bc')` is `true`; `onDocChange('b')` is `false`.
7. **An editor built with no text has `""` as its clean text.** `new CodeEditor()`; `onDocChange('x')` is `true`; `onDocChange('')` is `false`.

The eight cases already in the block are unaffected and must not be edited: each either constructs an editor and checks it is clean, or drives `onDocChange` with text that differs from the clean text, or checks `markClean()` / the relay / the offline `setValue` no-op — all of which read the same under the new rule.

### Manual verification (browser)

`npm run dev`, then open <http://localhost:8015> and select the **CodeEditor** section. The status row is the one the demo panel already renders.

8. On open, the row reads `Dirty — editor: no, panel (2 levels up): no`.
9. Typing one character flips it to `yes` / `yes`.
10. **Pressing Ctrl-Z once returns it to `no` / `no`**, with the document text back to the original sample. This is the new behaviour.
11. Pressing Ctrl-Y (or Ctrl-Shift-Z) to redo flips it back to `yes` / `yes`.
12. Type a character, click **Save** (row → `no` / `no`), click back into the editor, then press Ctrl-Z: the row flips to `yes` / `yes`, because the saved text is now the clean text and the undo moves away from it.
13. Click **Format** (row → `yes` / `yes`, since the sample gains semicolons), click back into the editor, then press Ctrl-Z until the document text matches the original sample: the row returns to `no` / `no`. Clicking a toolbar button moves focus out of the editor, so the click back in is what lets Ctrl-Z reach it.
14. With **Read-only: on**, typing changes neither the document nor the row — a rejected edit never becomes a transaction, so it never reaches `onDocChange`.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including cases 1-7 above and the eight pre-existing dirty-state cases.
- `cd packages/lib && npm run lint` — no new findings.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.
- `grep -n 'this\._cleanValue' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — writes in the constructor, `mount`, and `markClean`, and one read in `onDocChange`.
- `grep -n 'setDirty' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly two matches (`onDocChange`, `markClean`).
- `grep -rn 'undoDepth\|isolateHistory\|addToHistory' packages/lib/src/` — zero matches; no CodeMirror history API is used.
- `git diff --name-only` lists none of `Component.ts`, `MarkdownEditor.ts`, or `plans/implemented/code-editor-dirty-state-adoption.md`.
- `git diff packages/lib/src/typescript/CodeEditorPanel.ts` — only JSDoc lines changed; no statement in the file moves.
- Manual: `npm run dev` → <http://localhost:8015> → **CodeEditor** section → cases 8-14 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md)**, `## Dirty state` ([:86](packages/lib/docs/components/CodeEditor.md#L86)) — replace the paragraph. The current text says the flag "tracks *that* edits happened, not whether the text currently differs from a baseline — undoing back to the original document leaves the editor dirty", which is now the opposite of the truth. The replacement must state: the editor is dirty whenever its document differs from the text at the last clean point; the clean point is the text it was constructed with, or the text `markClean()` last accepted; typing, paste, `format()`, and `setValue()` all go through the same check, so an edit undone back to the clean text clears the flag on its own; `isDirty()` folds up into every ancestor container automatically; and a host loading a document with `setValue()` should follow it with `markClean()` so the loaded text becomes the clean text.
- **Same page**, `## Common methods` ([:110](packages/lib/docs/components/CodeEditor.md#L110)) — the `markClean()` row already reads "Clear the dirty flag, accepting the current document as the clean baseline", which stays correct. Leave it.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** ([:72-75](packages/lib/docs/reference/changelog/next.md#L72-L75)) — amend the existing `CodeEditor` dirty-state bullet in place rather than adding a "Fixed" entry: the adopter has not shipped yet, so `next.md` should describe the behaviour that will ship, once. The amended bullet says the editor reports itself dirty whenever its document differs from the text at the last clean point, that `markClean()` accepts the current document as that point, and that undoing an edit back to the clean text clears the flag on its own. Keep the existing `MarkdownEditor` sentence and the "No consumer action is needed" closer.
- **`packages/lib/llms.txt`** — regenerate via `npm run docs:llms` (step 14); `markClean()`'s summary text changes.
- `markClean()`'s JSDoc must not `{@link}` the protected dirty setter or the private `_cleanValue`, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols* — the wording in **Public API** already describes both in prose.

---

## Potential Challenges

- **The live typing and undo paths cannot be unit-tested.** CodeMirror's update listener only runs against a mounted `EditorView`, which the offline harness never creates. Mitigation: `onDocChange` is a directly-callable seam that carries the whole rule, and manual cases 10-13 cover the live path.
- **A document loaded offline with `setValue()` and never `markClean()`d compares against the constructed text.** The editor reports clean until the first live edit, then reports dirty even if that edit is undone, because the clean text is the constructed text and the document is the loaded one. Mitigation: the documented workflow — `setValue()` then `markClean()` — is stated on the `CodeEditor` page and pinned by Expected Behaviour case 6.
- **A second copy of the document text is retained.** `_cleanValue` holds one more full string alongside the one `_options.value` already caches. On a large document the extra cost is a second copy of the text, not a second copy of the editor, and after the first `markClean()` that copy is usually the very string a previous `onDocChange` already allocated — a retained reference rather than a new allocation.[^content-compare]
- **`MarkdownEditor` gets a behaviour change for free, in the helpful direction.** Its `setMode("source")` bridge calls `_codeEditor.setValue(markdown)`, which today marks the source editor dirty on a mode switch alone. Under the new rule it does so only when the round-tripped Markdown actually differs from the clean text.[^markdown-editor]

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the constructor and its positional-value block ([:288-302](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L288-L302)), `getValue` ([:332](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L332)), `setValue` ([:347](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L347)), `markClean` ([:359-376](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L359-L376)), `format` ([:532](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L532)), `onDocChange` ([:571-586](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L571-L586)), and `mount`'s state creation plus update listener ([:776](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L776), [:755-763](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L755-L763)).
- [`packages/lib/src/typescript/lib/data/ModelRecord.ts`](packages/lib/src/typescript/lib/data/ModelRecord.ts) — **the precedent this plan mirrors**: `_original` ([:57](packages/lib/src/typescript/lib/data/ModelRecord.ts#L57), [:97](packages/lib/src/typescript/lib/data/ModelRecord.ts#L97)), `recomputeDirty` ([:337](packages/lib/src/typescript/lib/data/ModelRecord.ts#L337)), `commit` ([:553](packages/lib/src/typescript/lib/data/ModelRecord.ts#L553)).
- [`packages/lib/src/typescript/lib/core/Component.ts:2340`](packages/lib/src/typescript/lib/core/Component.ts#L2340) and [`:2380`](packages/lib/src/typescript/lib/core/Component.ts#L2380) — `isDirty()` and the protected `setDirty()`, which early-returns when the flag is unchanged. Unmodified by this plan; read for that idempotence, which is what lets `onDocChange` call it on every change.
- [`packages/lib/tests/component/code-editor.test.ts:164-261`](packages/lib/tests/component/code-editor.test.ts#L164-L261) — the dirty-state block being extended, and the head-of-file note ([:27-31](packages/lib/tests/component/code-editor.test.ts#L27-L31)) explaining why no test ever has a live view.
- [`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md) — the mechanism this plan revises, especially its `[^mirror-change]` and `[^no-baseline-diff]` footnotes. **Historical: do not edit it**, even though its Expected Behaviour case 15 and its **No baseline diffing** Non-Goal now describe behaviour this plan replaces. An implemented plan records what was decided at the time.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:354-358`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L354-L358) and [`:418`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L418) — the `CodeEditor` construction and the `setMode` bridge. Unmodified; read to confirm the mode-switch case.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) — the demo panel whose status row exercises this; only its class JSDoc changes.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — *Fields written during the `super()` cascade must use `declare`*, and *Don't `{@link}` internal symbols*.

---

## Non-Goals

- **No CodeMirror history API is used.** No `undoDepth`, no `isolateHistory`, no `Transaction.addToHistory` annotation, no change to the `history()` configuration in `mount()`.[^undo-depth-rejected]
- **`setValue()` does not re-establish a clean baseline.** Loading a document and accepting it as clean stays two calls.[^no-rebaseline-on-setvalue]
- **No change to `Component.ts`.** The mechanism is used as shipped.
- **`MarkdownEditor` is still not an adopter.** It gains nothing but the relay it already had; its WYSIWYG surface remains unwired, as the prior plan's Non-Goals set out.
- **No change to the demo panel's controls.** No Revert button, no undo button — the browser's own Ctrl-Z is what cases 10-13 exercise.
- **No new public API.** `markClean()` remains the only method this feature added to `CodeEditor`.

---

## Notes

[^dependency-branch]: This plan builds on `code-editor-dirty-state-adoption`, which builds on `component-dirty-state`. Both are implemented on their own branches and **neither is on `master`** at the time of writing. If `setDirty` is missing from [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts), or `onDocChange` / `markClean` are missing from [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts), a dependency has not landed — **stop rather than re-implementing it**. Every line number in this plan is taken against the `feature/code-editor-dirty-state-adoption` tree, which is the base this work starts from.

[^content-compare]: The prior plan rejected this design on cost, in its `[^mirror-change]` footnote: "a full string comparison per keystroke, which on a large document is exactly the per-keystroke work a code editor cannot afford." Reading the shipped code shows the marginal cost is far smaller than that. The update listener already calls `update.state.doc.toString()` on every document change ([CodeEditor.ts:757](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L757)) — a full O(n) allocation and copy of the whole document, per keystroke, today. `onDocChange` then already retains that whole string in `this._options.value` ([:581](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L581)). So the document is already being materialized and already being kept in full. What this plan adds on the same line is one `!==` between two strings and one retained reference — and JavaScript string equality checks lengths first, which is an O(1) answer in the common typing case where a character was added or removed. Where the lengths do match, the byte comparison stops at the first difference. In every case it is cheaper than the `toString()` call sitting on the same line, so it cannot be the thing that makes a code editor unaffordable. The memory cost is one extra reference to a string that, after the first `markClean()`, is one CodeMirror already produced.

[^undo-depth-rejected]: The alternative considered was CodeMirror's own undo stack: snapshot `undoDepth(state)` in `markClean()` and compare the live depth against it instead of comparing text. `@codemirror/commands` 6.10.4 does export `undoDepth(state: EditorState): number`, and `CodeEditor` does install `history()` ([CodeEditor.ts:737](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L737)), so the sketch is buildable. Reading `@codemirror/commands`'s `HistoryState` implementation shows it is wrong in two reachable ways, both reporting **clean while unsaved edits stand** — the failure direction the prior plan itself singled out as the expensive one. (a) *Event joining*: `HistoryState.addChanges` merges a new change into the previous undo event when it arrives within `newGroupDelay` (500 ms by default) of it, touches its ranges, and carries an `input.type` / `delete` user event. A merge does not raise `undoDepth`. So a character typed within half a second of a `markClean()` leaves the depth at its snapshot while the text has moved. (b) *Stack truncation*: `updateBranch` discards the oldest events once the branch grows past `minDepth + 20` (100 + 20 by default). After a session with more than about 120 undo events, undoing back down to the snapshot depth no longer restores the snapshot text, because the events in between were thrown away. A depth check could be used as a cheap gate in front of an exact comparison, but the comparison it would gate is cheaper than the `doc.toString()` on the same line, so the gate buys nothing while costing a CodeMirror import, two snapshot sites, a no-view fallback, and a second way to test the same rule. `undoDepth` also needs a live `EditorState`, which the offline harness never has.

[^seam-signature]: Widening or splitting the seam was the alternative. A depth-based design cannot run through `onDocChange(value: string)` — there is no depth in a string — so it would either widen the signature (breaking the `(editor as any).onDocChange('…')` call in the six existing tests that use it) or leave `onDocChange` as an always-dirty offline fallback with the real reconciliation living only in the live update listener. The second shape is worse than it looks: the offline harness could still reach CodeMirror's history by standing up a bare `EditorState` with `history()` and dispatching transactions, since CM6's state layer needs no DOM view — but a test built that way pins CodeMirror's history semantics rather than this component's contract, and leaves the component's own seam with no coverage of the behaviour being added. Comparing text needs neither: the rule lives entirely inside `onDocChange`, so the existing seam tests it exactly as it tests everything else.

[^crlf]: `EditorState.create({ doc })` builds the document with `Text.of(doc.split(/\r\n?|\n/))` and `Text.toString()` rejoins with `"\n"` (`@codemirror/state` 6.7.1). A `CodeEditor` constructed from a file read on Windows therefore holds CRLF text in `_options.value` while the live document reports LF, so the first `onDocChange` would compare LF text against a CRLF clean copy, find them different, and leave the editor permanently dirty no matter how much the user undid. Re-taking `_cleanValue` from `state.doc.toString()` inside `mount()` makes both sides of the comparison come from the same normalizer. Overwriting it there unconditionally is safe: the only call that can set a `CodeEditor`'s flag to `true` is the one in `onDocChange`, which runs only from the live view's update listener, so a `CodeEditor` is always clean at the moment it mounts and no re-take can discard a real dirty flag.

[^setvalue-untouched]: Confirmed by reading, not assumed. `grep -n 'Transaction' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` returns nothing: the file never imports `Transaction` and never annotates a dispatch with `Transaction.addToHistory.of(false)` or anything else. `setValue` ([:350-354](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L350-L354)), `format` ([:550-555](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L550-L555)), and `reindentFallback` ([:566-568](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L566-L568)) all dispatch plain change transactions, which CodeMirror records in the undo history and reports through `update.docChanged` exactly like a keystroke. That is what makes manual case 13 (format, then undo, then clean again) work with no code written for it.

[^no-rebaseline-on-setvalue]: The prior plan rejected re-baselining inside `setValue()` and the reason still holds: `MarkdownEditor.setMode("source")` calls `_codeEditor.setValue(markdown)` ([MarkdownEditor.ts:418](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L418)), so a `setValue` that re-established a clean baseline would silently clear a real dirty flag when a user edits in source mode, switches to WYSIWYG, and switches back. A flag wrongly `true` costs an extra save prompt; a flag wrongly `false` loses work.

[^markdown-editor]: `MarkdownEditor` builds its `_codeEditor` with the initial Markdown ([MarkdownEditor.ts:354-358](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L354-L358)), so the source editor's clean text is the real document rather than `""`. On a mode switch, `setMode` reads the Markdown back from the outgoing surface and calls `_codeEditor.setValue(markdown)` ([:418](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L418)). Under the old rule that replace marked the editor dirty unconditionally, which is the "starts reporting dirty without being changed" problem the prior plan listed as a challenge; under the new rule it marks it dirty only when the round-tripped text actually differs, so a lossless round trip now leaves it clean. `setValue` does not reset CodeMirror's history — it dispatches an ordinary change transaction, so the replace is itself undoable and only the redo branch is cleared — but the new rule reads no history at all, so nothing a mode switch does to the undo stack can make the flag wrong. Whatever text the document ends up holding, the flag answers the same question: does it differ from the clean text.

[^no-declare]: [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s `declare` rule applies to fields written by a setter that `applyOptions` dispatches during the `super()` cascade. `_cleanValue` is written only from the constructor body, `mount()`, and `markClean()`, none of which the cascade reaches, so it is an ordinary field. It must still be declared with no initializer and assigned in the constructor body **after** the positional-argument block: a class-field initializer runs immediately after `super()` returns, which is before that block caches a positional `value`, so `private _cleanValue = this.getValue()` would capture `""` for `new CodeEditor('x')` and leave the editor permanently dirty from its first keystroke. TypeScript's `strictPropertyInitialization` is satisfied by the constructor-body assignment.

---

## Implementation Notes

**Manual case 13, and the "works with no code written for it" claim in [^setvalue-untouched], do not hold under the literal sequence 8-14 — and the primary reason is that case 13 contradicts the plan's own Architecture Decisions table, not CodeMirror's history.** Verified live at `localhost:8015` → CodeEditor, following cases 8-14 in order with distinct characters (`a` then `b`) for the two "type a character" steps, as case 12 requires:

- Cases 8-12 all matched the plan exactly, including case 12's end state: doc `…world"));\na` (clean text `…world"));\nab`, saved by case 12's Save click), row `yes / yes`.
- Case 13's Format click reformats that doc, row stays `yes / yes` as predicted.
- Undoing the format (1st Ctrl-Z) returns the doc to `…world"));\na` — still `yes / yes`, one more undo away from clean, not yet clean.
- A second Ctrl-Z undoes the `a` insertion, landing on the plain constructed sample — but the row **stays `yes / yes`**, and further Ctrl-Z presses do nothing more: the undo stack is exhausted. The document never becomes clean.

**Root cause: case 13's own instruction is unsatisfiable given the semantics the plan itself defines, independent of CodeMirror.** The Architecture Decisions table's worked example ([:36-43](plans/in-progress/code-editor-undo-clears-dirty.md#L36-L43)) already establishes that once `markClean()` accepts `ab`, `_cleanValue` is `ab` until the next `markClean()`/`setValue()`-then-`markClean()` call, and `isDirty()` is `doc !== _cleanValue` — a direct, unconditional consequence of `this.setDirty(value !== this._cleanValue)`. Case 13 then asks to "press Ctrl-Z until the document text matches **the original sample**: the row returns to `no`/`no`." But the original sample and `ab` are different strings, and nothing case 13 does re-baselines `_cleanValue` away from `ab` — Format dispatches an ordinary change transaction, not a `markClean()`-equivalent action ([^setvalue-untouched] already establishes this). So no matter what sequence of Ctrl-Z presses, redos, or reformats produces a document reading "the original sample", that document is a different string from `ab`, and `isDirty()` reads `true` for it by definition. This holds independent of CodeMirror's specific undo/redo bookkeeping — it would hold even under a hypothetical history that preserved every branch losslessly, because the target document case 13 names simply is not the clean text this scenario established. Case 13 as worded needed correcting (e.g. naming the actual saved text `ab` as the target, or adding an explicit `markClean()`/redo step to re-baseline first), not just annotating; that correction is out of this note's scope per the `implement` skill's "the plan is authoritative and this skill does not rewrite it" rule, so it is recorded here for whoever revisits this plan.

**A second, independent fact compounds the same scenario, and is worth recording because it forecloses even the corrected recovery path once Format has already been clicked.** `@codemirror/commands`'s `HistoryState.addChanges` (`node_modules/@codemirror/commands/dist/index.js:496`, v6.10.4 — `return new HistoryState(done, none, time, userEvent);`) unconditionally discards whatever sits on the redo branch on any newly-dispatched change that isn't itself an undo/redo. Format's dispatch, arriving after case 12's Ctrl-Z had moved the `b` insertion onto that branch, erases `b` from history permanently — so after Format, no sequence of Ctrl-Z *or* Ctrl-Y can reconstruct `ab` at all; undoing walks back through the *surviving* branch (format, then `a`) to the plain constructed sample, never through `ab`. [^markdown-editor]'s footnote already names this general mechanism ("only the redo branch is cleared") without applying it to case 13's own sequence, which is the gap this half of the note closes.

Neither point is a defect in `onDocChange`'s rule: every individual transition observed above is the correct answer to "does the document differ from `_cleanValue`", and the 7 new unit tests (cases 1-7) pin that comparison directly, independent of both case 13's unsatisfiable wording and CodeMirror's redo semantics. No code changes accordingly; a host that needs to get back to a specific saved text after either kind of recovery gap has `setValue()` followed by `markClean()`, per [^no-rebaseline-on-setvalue]'s documented workflow, same as any other case where undo can't reach a target text.
