---
depends-on:
  - component-dirty-state
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Dirty-State Adoption — Implementation Plan

## Overview

[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) already reports itself dirty: it keeps a private `_cleanValue` holding the text at the last clean point, compares the document against it inside a private `onDocChange(value)` seam ([CodeEditor.ts:594](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L594)), and clears the flag through a public `markClean()` ([CodeEditor.ts:385](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L385)). [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) does not; it only inherits a dirty flag from the source `CodeEditor` it holds as a child, which answers a different question than the one a host asks.

This plan gives `MarkdownEditor` the same adoption, shaped for a component with **two** editing surfaces — the Lexical WYSIWYG surface and the source `CodeEditor` — that both write one Markdown string:

1. **A single document-change seam.** `MarkdownEditor` emits `"change"` from two private handlers today, `handleChange` ([MarkdownEditor.ts:863](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L863), the Lexical update listener) and `handleCodeChange` ([:888](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L888), the source editor's `"change"`), each carrying its own copy of the same cache-and-emit logic. Both are routed through one new private `onDocChange(value)` that caches, sets the flag, and emits — mirroring `CodeEditor`'s seam of the same name.
2. **One clean baseline, `_cleanValue`.** `getValue()` ([:436](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L436)) returns one canonical Markdown string whichever surface is active, so one string is the whole baseline. A new public `markClean()` re-takes it.
3. **The source `CodeEditor` stops contributing its own flag.** `handleCodeChange` marks the child clean after every source-surface change, so `MarkdownEditor.isDirty()` is decided by this component's own comparison alone rather than by the child's flag that `Component`'s parent-to-child relay folds in.
4. **[`MarkdownEditorPanel`](packages/lib/src/typescript/MarkdownEditorPanel.ts)** — the demo registered as the "MD Editor" section in [`main.ts:95`](packages/lib/src/typescript/main.ts#L95) — gains a **Save** button and a status row, the same affordance [`CodeEditorPanel`](packages/lib/src/typescript/CodeEditorPanel.ts) already has, because the live typing paths in both surfaces are manual-verify only.

`Component.ts`, `CodeEditor.ts`, and `Tab.ts` are not modified. The dirty mechanism and both `CodeEditor` adoptions are already on `master`, so this plan's `depends-on` entry records lineage rather than gating the work.[^depends-on]

---

## Architecture Decisions

### The flag is `getValue() !== _cleanValue`, compared inside one private `onDocChange` seam

`MarkdownEditor` keeps one private string, `_cleanValue`, holding the Markdown as of the last clean point — the value it was constructed with, the converted form taken when the Lexical editor is first built, or the value `markClean()` last accepted. Every document change, from either surface, runs through the new private `onDocChange(value)`, which sets the flag from `value !== this._cleanValue`. This is exactly `CodeEditor`'s rule and exactly its seam name.[^mirror-codeeditor]

`onDocChange` sets the flag **before** emitting `"change"`, so a `"change"` listener that queries `isDirty()` sees the settled value.[^dirty-before-change]

| Step | `getValue()` | `_cleanValue` | `isDirty()` |
|---|---|---|---|
| `new MarkdownEditor('# Hi')` | `# Hi` | `# Hi` | `false` |
| user types ` there` (WYSIWYG) | `# Hi there` | `# Hi` | `true` |
| user presses Ctrl-Z | `# Hi` | `# Hi` | **`false`** |
| user types ` there` again, then `markClean()` | `# Hi there` | `# Hi there` | `false` |
| `setMode('source')`, no edit | `# Hi there` | `# Hi there` | `false` |
| user deletes ` there` in source mode | `# Hi` | `# Hi there` | **`true`** |

### Both surfaces feed the one seam; the public `"change"` event is not the hook

`handleChange` and `handleCodeChange` keep their jobs — one converts the Lexical state to Markdown, the other receives the source text — and both then call `onDocChange(value)`, which carries the "did the content actually change" guard both handlers duplicate today. Nothing subscribes to this component's own public `"change"` event to drive the flag.[^single-seam]

### The clean baseline is re-taken when the Lexical editor is first built, while the document is still clean

Lexical's Markdown converters normalize what they round-trip: a trailing newline is dropped, and a table's delimiter row is re-spaced. So the string a consumer constructs the editor with is usually **not** the string `getValue()` returns once the WYSIWYG editor exists. `ensureEditor()` re-takes `_cleanValue` from the converted form right after it populates the initial state — but only when `isDirty()` is false, so a first build that happens *after* a source-mode edit cannot silently clear a real dirty flag.[^normalization]

| Constructed Markdown | `getValue()` once the editor is built | `_cleanValue` after the re-take | `isDirty()` |
|---|---|---|---|
| `# Title\n\nbody\n` | `# Title\n\nbody` | `# Title\n\nbody` | `false` |
| `\| a \| b \|\n\|:---\|:---:\|\n\| 1 \| 2 \|` | `\| a \| b \|\n\| :--- \| :---: \|\n\| 1 \| 2 \|` | the converted form | `false` |

Without the re-take, both rows report `true` the moment the user first clicks into the editor.

### The source `CodeEditor` is a surface, not a second owner of the dirty state

`handleCodeChange` calls `this._codeEditor.markClean()` after routing the change, so the child's own flag is clear at every observable point and `MarkdownEditor.isDirty()` reduces to this component's own comparison. The call sits in `handleCodeChange`, **outside** `onDocChange`'s content-changed guard, so it also runs on the mode-switch load that the guard swallows.[^child-not-owner]

`MarkdownEditor.markClean()` calls `this._codeEditor.markClean()` too, so the public clean point moves both baselines in one step.[^markclean-forwards]

### `setValue()` does not re-establish a clean baseline

Loading a document and accepting it as clean stays two calls, `setValue()` then `markClean()` — the rule `CodeEditor` already documents. `setMode("source")` loads the source surface through `_codeEditor.setValue(markdown)` ([:418](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L418)), so a `setValue` that re-baselined would clear a real dirty flag on a mode switch.[^no-rebaseline]

### The demo panel gets a Save button and a status row

`MarkdownEditorPanel` gains a **Save** button in its existing toolbar and a status `Text` row along the bottom of the editor's `Border` host, reporting the editor's own `isDirty()` and the panel's own. The panel registers one listener on *itself*, so the row proves the relay rather than the leaf's flag.[^demo-affordance]

| Moment | Status row |
|---|---|
| panel opens | `Dirty — editor: no, panel (3 levels up): no` |
| after typing a character | `Dirty — editor: yes, panel (3 levels up): yes` |
| after clicking Save | `Dirty — editor: no, panel (3 levels up): no` |
| after toggling source mode and back, no edits | `Dirty — editor: no, panel (3 levels up): no` |

---

## Public API

One new public method on the already-exported `MarkdownEditor`. `isDirty()` / `onDirtyChange()` / `offDirtyChange()` are inherited from `Component` and are **not** redeclared. No new option and no new construction argument.[^no-option]

```typescript
// component/editor/MarkdownEditor.ts

/**
 * Accepts the current document as the clean Markdown, clearing this editor's
 * dirty flag (and, through the framework's relay, every ancestor's, unless
 * another descendant is still dirty). Call it after the host has persisted
 * the document, or after loading one with `setValue`. Persisting is the
 * host's job — this method only reports state; it writes nothing and does
 * not change the document.
 *
 * The editor reports itself dirty whenever `getValue()` differs from the
 * clean Markdown, in either editing mode, so an edit undone back to that
 * text clears the flag on its own.
 *
 * @returns This component, for method chaining.
 */
markClean(): this;
```

New private field, declared bare with **no** initializer and **no** `declare` keyword:[^no-declare]

```typescript
private _cleanValue: string;
```

---

## Internal Structure

The new seam, holding the guard both change handlers carry today:

```typescript
/**
 * The single document-change seam for both editing surfaces: caches the new
 * Markdown, sets the dirty flag from a comparison against the clean Markdown,
 * then emits `"change"`. No-op when the value is unchanged, which is what
 * keeps the programmatic `setValue` on a mode switch from double-emitting (it
 * loads the value already equal to `_options.value`).
 *
 * @param value - The new Markdown value.
 */
private onDocChange(value: string): void {
    if (value === this._options.value) {
        return;
    }

    this._options.value = value;
    // Dirty before the emit, so a `"change"` listener that queries isDirty()
    // sees the settled value. `setDirty` is idempotent, so calling it on
    // every change costs nothing when nothing flipped.
    this.setDirty(value !== this._cleanValue);
    this.emit("change", { value });
}
```

Both handlers reduce to a dispatch:

```typescript
private handleChange(): void {
    const editor = this._editor;

    if (!editor) {
        return;
    }

    this.onDocChange(editor.read(() => $convertToMarkdownString(TRANSFORMERS)));
}

private handleCodeChange(payload: CodeEditorChange): void {
    this.onDocChange(payload.value);
    // The source editor is a surface, not a second owner of this document's
    // dirty state: re-baselining it on every change keeps its own flag clear,
    // so `isDirty()` is decided by this component's comparison alone. Outside
    // `onDocChange` so it also runs on a mode-switch load, which that method's
    // unchanged-value guard returns early from.
    this._codeEditor.markClean();
}
```

The clean point, moving both baselines:

```typescript
markClean(): this {
    this._cleanValue = this.getValue();
    this.setDirty(false);
    this._codeEditor.markClean();

    return this;
}
```

The re-take inside `ensureEditor()`, between `editor.setEditable(...)` and the `mergeRegister` block:

```typescript
// Lexical's converters normalize what they round-trip (a trailing newline is
// dropped, a table's delimiter row is re-spaced), so from here on `getValue()`
// reports the converted form rather than the string this editor was built
// with. Re-take the clean Markdown from the converted form so both sides of
// `onDocChange`'s comparison come from the same converter — but only while the
// document is still clean, since a first build can also happen after a
// source-mode edit, and re-taking then would clear a real dirty flag.
if (!this.isDirty()) {
    this._cleanValue = editor.read(() => $convertToMarkdownString(TRANSFORMERS));
}
```

The demo panel's handler is an arrow-function **field**, not a method: it is passed as a bare `this.handleDirtyChange` reference to `onDirtyChange`, which calls it unbound — the convention [`MarkdownEditorPanel.ts:93-99`](packages/lib/src/typescript/MarkdownEditorPanel.ts#L93-L99) already documents for `handleInsertTable`. It declares no parameter: it reads both flags itself, and a zero-argument function is assignable to `(dirty: boolean) => void`.

```typescript
// MarkdownEditorPanel.ts
private readonly handleDirtyChange = (): void => {
    this._statusText.setText(
        `Dirty — editor: ${this._editor.isDirty() ? 'yes' : 'no'}`
        + `, panel (3 levels up): ${this.isDirty() ? 'yes' : 'no'}`);
};
```

---

## Ordered Implementation Steps

Steps 1-7 add the source changes, step 9 writes the tests that pin them, and steps 12-13 build the demo and the docs. `npm test` typechecks the test files before running vitest, so `markClean()` must exist before the new test block can run at all — that is why the source changes come first rather than a red test step.

1. **[`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)** — add the `_cleanValue` field directly after the `_codeEditor` field ([:327](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L327)), with a doc comment saying it holds the Markdown as of the last clean point (the constructed value, the converted form re-taken when the Lexical editor is built, or the value `markClean()` last accepted) and that `onDocChange` compares against it.

2. **Same file, in the constructor** — add `this._cleanValue = this.getValue();` immediately after the `this._card.setVisibleComponentId(…)` statement that ends at [:365](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L365), before `this.applyListeners(options?.listeners);` at [:367](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L367). The assignment must sit **after** `_codeEditor` is constructed ([:354](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L354)), because `getValue()` reads the source editor when the mode is `"source"`.

3. **Same file** — add the public `markClean(): this` from **Public API** / **Internal Structure**, placed directly after `setValue()` ends at [:470](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L470) and before `getReadOnly()`'s JSDoc at [:472](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L472) — the same position `markClean()` occupies in `CodeEditor`. Do **not** modify `setValue()`.

4. **Same file, in `ensureEditor()`** — insert the guarded re-take from **Internal Structure** after `editor.setEditable(…)` ([:822](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L822)) and before `this._unregister = mergeRegister(` ([:824](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L824)). `$convertToMarkdownString` and `TRANSFORMERS` are already imported ([:13](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L13), [:29](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L29)); add no import.

5. **Same file** — add the private `onDocChange(value: string): void` from **Internal Structure**, placed directly above `handleChange`'s JSDoc ([:858](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L858)).

6. **Same file** — replace `handleChange`'s body ([:863-878](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L863-L878)) with the delegating version from **Internal Structure**, keeping the `if (!editor) return;` guard. Rewrite its JSDoc: it recomputes the Markdown from the committed editor state after a Lexical update and hands it to the shared change seam.

7. **Same file** — replace `handleCodeChange`'s body ([:888-895](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L888-L895)) with the two-statement version from **Internal Structure**. Rewrite its JSDoc: it routes a source-surface edit into the shared change seam and then re-baselines the source editor, with the reason from the `## Architecture Decisions` entry. The unchanged-value guard's explanation moves to `onDocChange`'s JSDoc — do not leave it stated twice.

8. Check, all against `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`: `grep -n 'this\.setDirty(' ` — exactly two matches (`onDocChange`, `markClean`). `grep -n 'this\.emit("change"' ` — exactly one match, now inside `onDocChange`. `grep -n 'this\._codeEditor\.markClean()' ` — exactly two matches (`markClean`, `handleCodeChange`). `grep -n 'this\._cleanValue' ` — four matches: one write in the constructor, one in `ensureEditor`, one in `markClean`, one read in `onDocChange`.

9. **[`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts)** — add `import { Component } from '~/core/Component';` to the imports, extend the `codeEditorOf` helper's structural type ([:69-72](packages/lib/tests/component/markdown-editor.test.ts#L69-L72)) to `{ getReadOnly(): boolean; getValue(): string; isDirty(): boolean; onDocChange(value: string): void }` (existing call sites keep working), and insert a new `describe('MarkdownEditor dirty state', …)` block after the `describe('MarkdownEditor mode', …)` block ends at [:428](packages/lib/tests/component/markdown-editor.test.ts#L428), before `describe('MarkdownEditor dialect fidelity (viewer token set)', …)` at [:430](packages/lib/tests/component/markdown-editor.test.ts#L430). Cover cases 1-12 of **Expected Behaviour**. Drive the source surface through the **child's own** private seam, `codeEditorOf(editor).onDocChange('…')`, not through `MarkdownEditor`'s private handler — that reaches `handleCodeChange` through the real listener wired in the constructor ([:357](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L357)) and so exercises the relay as well.

10. Run `cd packages/lib && npm run typecheck && npm test` — clean, including the new cases and every case already in `markdown-editor.test.ts`, none of which may be edited. If an existing case fails, stop and report rather than editing it: this plan's change was verified against the whole suite.

11. Run `cd packages/lib && npm run lint` — no new findings, including the naming-convention rule on `_cleanValue`.

12. **[`packages/lib/src/typescript/MarkdownEditorPanel.ts`](packages/lib/src/typescript/MarkdownEditorPanel.ts)** — the demo, in this order:
    - Add `import { Text } from '@jimka/typescript-ui/component/input';` (a new import line; the file has no input-barrel import yet).
    - Add `private readonly _statusText: Text;` beside `_editor` / `_viewer` ([:48-49](packages/lib/src/typescript/MarkdownEditorPanel.ts#L48-L49)), and the `handleDirtyChange` arrow field from **Internal Structure** next to the existing `handleInsertTable` field ([:97-99](packages/lib/src/typescript/MarkdownEditorPanel.ts#L97-L99)).
    - In the toolbar block ([:69-72](packages/lib/src/typescript/MarkdownEditorPanel.ts#L69-L72)), add `const saveBtn = new Button('Save');` with `saveBtn.on('action', () => { this._editor.markClean(); });` and `toolbar.addComponent(saveBtn);`, matching the inline-arrow shape used at [:62](packages/lib/src/typescript/MarkdownEditorPanel.ts#L62). Add a comment saying the button persists nothing and only clears the dirty flag.
    - Before `this.addComponent(editorHost);` ([:79](packages/lib/src/typescript/MarkdownEditorPanel.ts#L79)), build the status row and add it along the bottom of the editor's `Border` host: `this._statusText = new Text('');` then `editorHost.addComponent(this._statusText, { placement: Placement.SOUTH });`. `Placement` is already imported ([:5](packages/lib/src/typescript/MarkdownEditorPanel.ts#L5)); [`BorderPanel.ts:41`](packages/lib/src/typescript/BorderPanel.ts#L41) is the precedent for a `Text` in a `Border`'s SOUTH slot.
    - At the end of the constructor, after `this._editor.on('change', …)` ([:86](packages/lib/src/typescript/MarkdownEditorPanel.ts#L86)), add `this.onDirtyChange(this.handleDirtyChange);` then `this.handleDirtyChange();` — the second call paints the initial row from the same formatting code rather than duplicating the string.
    - Extend the class JSDoc ([:35-45](packages/lib/src/typescript/MarkdownEditorPanel.ts#L35-L45)) with one sentence: the status row reports the editor's own dirty flag and the panel's own, the panel's arriving through the framework's parent-to-child relay three containers up; Save clears it, and so does undoing an edit back to the last-saved text.

13. Update docs per **Documentation Impact**: [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) and [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).

14. Run `cd packages/lib && npm run docs:llms` then `npm run docs:api` — zero warnings. `llms.txt` is expected to come out **byte-identical**.[^llms-noop]

15. Run the manual browser checks in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Unit-testable (offline)

Lexical runs headless, so `setValue()` in WYSIWYG mode really drives `handleChange` → `onDocChange` under the test harness — these cases need no probe. The source surface's live path does not run offline (CodeMirror's update listener needs a mounted view), so the source cases call the child editor's own private seam, `codeEditorOf(editor).onDocChange('…')`, which fires the real `"change"` listener into `handleCodeChange`.

1. **A fresh editor is clean.** `new MarkdownEditor('# Hi').isDirty()` and `new MarkdownEditor().isDirty()` are both `false`.
2. **A WYSIWYG edit marks it dirty, and undoing it clears the flag.** `new MarkdownEditor('# Hi')`; `setValue('# Bye')` makes `isDirty()` `true`; `setValue('# Hi')` makes it `false` again.
3. **`onDirtyChange` fires once per real transition.** On a `new MarkdownEditor('# Hi')`, `setValue('# A')` then `setValue('# B')` fire a registered listener exactly once, with `true`; a following `setValue('# Hi')` fires it once with `false`.
4. **`markClean()` moves the clean point and is chainable.** `new MarkdownEditor('# Hi')`; `setValue('# A')`; `markClean()` returns the editor and makes `isDirty()` `false`; `setValue('# Hi')` now makes it `true`; `setValue('# A')` makes it `false`.
5. **`"change"` still fires, with the flag settled first.** A `"change"` listener that reads `isDirty()` sees `true` on the edit and `false` on the change that returns to the clean text.
6. **The relay reaches a real parent.** With `parent = new Component({})` and `parent.addComponent(editor)`, `setValue('# A')` makes `parent.isDirty()` `true` and `editor.markClean()` returns it to `false`, firing a listener on `parent` once per transition.
7. **A construction value the converters normalize does not report dirty.** `new MarkdownEditor('# Title\n\nbody\n')` (the trailing newline is dropped by the round trip); after forcing the build with `(editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor()`, `isDirty()` is `false`, and it stays `false` after a selection-only Lexical update — `lexicalOf(editor).update(() => {}, { discrete: true })`, which is what `focus()` produces. The private `_cleanValue`, read as `(editor as unknown as { _cleanValue: string })._cleanValue`, equals `getValue()`. The `lexicalOf` helper ([:65-67](packages/lib/tests/component/markdown-editor.test.ts#L65-L67)) and the `LexicalEditor` type import ([:13](packages/lib/tests/component/markdown-editor.test.ts#L13)) already exist in the file.
8. **A mode round trip with no edits leaves it clean**, for the same normalized document — both when the Lexical editor was built first (`ensureEditor()` before `setMode('source')`) and when it was not.
9. **A source-surface edit marks the editor dirty while the child stays clean.** With `new MarkdownEditor('# Hi', { mode: 'source' })`, `codeEditorOf(editor).onDocChange('# Hi typed')` makes `editor.isDirty()` `true` and `codeEditorOf(editor).isDirty()` `false`, firing the editor's own listener once with `true`; `codeEditorOf(editor).onDocChange('# Hi')` returns both to `false`, firing once with `false`.
10. **`markClean()` leaves the child clean too.** After a source-surface edit, `markClean()` makes both `editor.isDirty()` and `codeEditorOf(editor).isDirty()` `false`.
11. **Dirty survives a mode switch.** `new MarkdownEditor('# Hi')`; `setValue('# Edited')`; `setMode('source')`; `setMode('wysiwyg')` — `isDirty()` is `true` at every step after the edit.
12. **A first build that happens after a source-mode edit does not clear the flag.** `new MarkdownEditor('# Title\n\nbody\n', { mode: 'source' })`; `codeEditorOf(editor).onDocChange('# Title\n\nbody\n\nmore')` makes `isDirty()` `true`; `setMode('wysiwyg')` — the first `ensureEditor()` call — leaves it `true`.

The cases already in `markdown-editor.test.ts` are unaffected and must not be edited.

### Manual verification (browser)

`npm run dev`, then open <http://localhost:8015> and select the **MD Editor** section.

13. On open, the status row reads `Dirty — editor: no, panel (3 levels up): no`.
14. Typing one character in the WYSIWYG surface flips it to `yes` / `yes`. Both values flip together — the panel's is derived through the relay, never written by the panel.
15. Pressing Ctrl-Z returns it to `no` / `no`, with the text back to the sample.
16. Clicking **Save** after an edit returns it to `no` / `no`, and the document text is unchanged.
17. Toggling **Edit Markdown source** on and off again with no edits leaves it `no` / `no` — a mode switch that changes nothing textually is not an edit.
18. Typing in source mode flips it to `yes` / `yes`; deleting back to the saved text returns it to `no` / `no`.
19. Editing in source mode, switching back to WYSIWYG, and clicking **Save** returns it to `no` / `no`.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including cases 1-12 and every pre-existing `markdown-editor.test.ts` and `code-editor.test.ts` case.
- `cd packages/lib && npm run lint` — no new findings.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings; `git diff --stat packages/lib/llms.txt` shows no change.
- `grep -n 'this\.setDirty(' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — exactly two matches.
- `grep -n 'this\.emit("change"' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — exactly one match.
- `grep -n 'this\._codeEditor\.markClean()' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — exactly two matches.
- `git diff --name-only` lists none of `Component.ts`, `CodeEditor.ts`, `Tab.ts`, `CodeEditorPanel.ts`, or anything under `plans/implemented/`.
- `grep -n 'markClean\|onDirtyChange\|isDirty' packages/lib/src/typescript/MarkdownEditorPanel.ts` — matches for all three.
- Manual: `npm run dev` → <http://localhost:8015> → **MD Editor** section → cases 13-19 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md)** — add a `## Dirty state` section immediately before `## Read-only` ([:110](packages/lib/docs/components/MarkdownEditor.md#L110)), so the `## Source / WYSIWYG mode` section it refers to is already introduced. State: the editor reports itself dirty, via [`Component.isDirty()`](/api/core/classes/Component), whenever `getValue()` differs from the Markdown at the last clean point; the clean point is the value it was constructed with or the value `markClean()` last accepted; both surfaces go through the same check, so an edit undone back to the clean text clears the flag on its own and a mode switch that changes nothing textually does not set it; `isDirty()` folds up into every ancestor container automatically; and a host loading a document with `setValue()` should follow it with `markClean()`. Add one sentence for the corner: because the editor emits its own canonical Markdown, a `markClean()` taken in source mode over text that is not in that canonical form marks the editor dirty on the next switch to WYSIWYG — the value the host would save really did change.
- **Same page**, `## Common methods` ([:81-89](packages/lib/docs/components/MarkdownEditor.md#L81-L89)) — add one row after the `dispose()` row, matching the position and wording used on the `CodeEditor` page:

  ```markdown
  | `markClean()` | Clear the dirty flag, accepting the current document as the clean baseline. |
  ```
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — two edits under `## Added` → `### Components`:
  - Amend the existing `CodeEditor` bullet ([:72-77](packages/lib/docs/reference/changelog/next.md#L72-L77)) by deleting its "`MarkdownEditor` inherits the state through the framework's relay because it hosts a `CodeEditor`" sentence, which this plan makes untrue, and keeping the "No consumer action is needed." closer.
  - Add a new bullet after it: `MarkdownEditor` now reports itself dirty through `Component.isDirty()` whenever its Markdown differs from the value at the last clean point, in either editing mode, and gains `markClean()` to accept the current document as that point. Switching between the WYSIWYG and source surfaces is not an edit. No consumer action is needed.
- **`packages/lib/llms.txt`** — no change expected; the manifest is a curated capability catalog, not a member scan.[^llms-noop]
- `markClean()`'s JSDoc must not `{@link}` the protected dirty setter or the private `_cleanValue`, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols* — the wording in **Public API** describes both in prose.

---

## Potential Challenges

- **Neither surface's live typing path can be unit-tested.** Lexical's mounted `contenteditable` and CodeMirror's `EditorView` both need a real DOM the harness never creates. Mitigation: the Lexical *state* path is fully offline-drivable through `setValue()`, the source path is drivable through the child's own `onDocChange`, and manual cases 13-19 cover the rest.
- **A `markClean()` taken in source mode over non-canonical Markdown marks the editor dirty on the next switch to WYSIWYG.** The switch really does change `getValue()`, so the flag is answering its own question correctly. Mitigation: documented on the `MarkdownEditor` page.
- **An editor first built while already dirty keeps an un-normalized clean baseline.** The `ensureEditor()` re-take is skipped in that case by design, so if the document is later returned to exactly that text in WYSIWYG mode the editor still reports dirty. The failure is in the safe direction — wrongly `true` costs an extra save prompt, wrongly `false` loses work — and the case needs a source-mode construction with non-canonical Markdown plus a switch, an edit, and a switch back.
- **Offline, `setValue()` in source mode leaves `isDirty()` unchanged.** With no CodeMirror view there is no transaction, so nothing reaches `handleCodeChange`. This mirrors `CodeEditor`'s own documented offline behaviour and is why case 9 drives the child's seam directly.
- **The demo panel's listener needs no teardown.** `onDirtyChange` registers on the panel itself, and `Component` clears its own listener bag on dispose.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — the constructor and its `_codeEditor` construction plus `"change"` wiring ([:338-368](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L338-L368)), `setMode` ([:408-427](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L408-L427)), `getValue` ([:436](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L436)), `setValue` ([:458](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L458)), `emit` ([:763](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L763)), `ensureEditor` ([:815-838](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L815-L838)), `handleChange` ([:863](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L863)), `handleCodeChange` ([:888](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L888)).
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — **the precedent this plan mirrors**: `_cleanValue` ([:279-286](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L279-L286)), its constructor assignment ([:306](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L306)), `markClean` ([:370-390](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L370-L390)), `onDocChange` ([:585-601](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L585-L601)), and the normalization re-take in `mount` ([:797-799](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L797-L799)) that this plan's `ensureEditor()` re-take is the analogue of. **Unmodified by this plan.**
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `isDirty()` ([:2340](packages/lib/src/typescript/lib/core/Component.ts#L2340)), the protected `setDirty()` and its unchanged-value early return ([:2380](packages/lib/src/typescript/lib/core/Component.ts#L2380)), `onDirtyChange` ([:2352](packages/lib/src/typescript/lib/core/Component.ts#L2352)), and the `wireChild` relay ([:6451](packages/lib/src/typescript/lib/core/Component.ts#L6451)). Read for the contract; unmodified.
- [`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md) and [`plans/implemented/code-editor-undo-clears-dirty.md`](plans/implemented/code-editor-undo-clears-dirty.md) — the two-plan precedent, including the rejected `setValue`-re-baselines-on-load option this plan also rejects. **Historical: do not edit them**, even though the first one's Non-Goals name this work as deferred.
- [`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md) — the mechanism's design and its aggregation rule.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) — the demo status row and Save button this plan copies. **Not modified by this plan.**
- [`packages/lib/src/typescript/MarkdownEditorPanel.ts`](packages/lib/src/typescript/MarkdownEditorPanel.ts) — the demo being extended; note the three-level nesting `panel → editorHost → editorFit → editor` ([:73-79](packages/lib/src/typescript/MarkdownEditorPanel.ts#L73-L79)) and the arrow-field convention ([:93-99](packages/lib/src/typescript/MarkdownEditorPanel.ts#L93-L99)).
- [`packages/lib/src/typescript/BorderPanel.ts:41`](packages/lib/src/typescript/BorderPanel.ts#L41) — a `Text` added to a `Border`'s SOUTH slot, the shape the status row uses.
- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — the head-of-file note on what runs offline ([:30-35](packages/lib/tests/component/markdown-editor.test.ts#L30-L35)), the `codeEditorOf` probe helper ([:69-72](packages/lib/tests/component/markdown-editor.test.ts#L69-L72)), and the mode block's own note on why source-mode change emission is untested ([:335-343](packages/lib/tests/component/markdown-editor.test.ts#L335-L343)).
- [`packages/lib/tests/component/code-editor.test.ts:164-351`](packages/lib/tests/component/code-editor.test.ts#L164-L351) — the sibling `describe('CodeEditor dirty state', …)` block, for shape.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Event handling*, *Compose before specializing*. [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — *Fields written during the `super()` cascade*, *Don't `{@link}` internal symbols*.

---

## Non-Goals

- **No change to `Component.ts`, `CodeEditor.ts`, or `Tab.ts`.** The mechanism and the source editor are used exactly as they ship.
- **No change to `CodeEditorPanel.ts`.** Its status row is read as precedent only.
- **`setValue()` does not re-establish a clean baseline.** Loading a document and accepting it as clean stays two calls.[^no-rebaseline]
- **`WysiwygSurface` gets no flag of its own.** It never holds an edit buffer — the Lexical editor object lives on `MarkdownEditor` — so it stays a plain child that contributes nothing to `MarkdownEditor.isDirty()`.
- **No change to an extra `"change"` event that already fires today.** When a construction value is one the converters normalize, the first Lexical update emits a `"change"` carrying the converted Markdown, and this plan leaves that as it is. Suppressing it means writing the converted form into `_options.value` inside `ensureEditor()`, which changes the `"change"` event's contract and is not needed for the dirty flag to be correct.[^spurious-change]
- **No `dirty` construction option, and no widening of `setDirty` to public.** `markClean()` is the whole new public surface.
- **No visual decoration by any container.** How a `Tab` or `Window` shows "something inside me is dirty" stays each consumer's own decision.
- **No persistence.** The demo's Save button writes nothing anywhere.

---

## Notes

[^mirror-codeeditor]: The design is `CodeEditor`'s, transplanted rather than re-derived: one private clean-text string, one private change seam that compares against it, one public `markClean()` that re-takes it, and no new option or event. `plans/implemented/code-editor-undo-clears-dirty.md` established the comparison itself, citing [`ModelRecord`](packages/lib/src/typescript/lib/data/ModelRecord.ts)'s `_original` / `recomputeDirty` / `commit` triple as the codebase's own dirty-tracking precedent, and rejected CodeMirror's `undoDepth()` after finding it reports clean while unsaved edits stand. Nothing about `MarkdownEditor` reopens either question: Lexical has its own history (`registerHistory`, [MarkdownEditor.ts:829](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L829)) with the same coalescing and truncation behaviour that made a depth check unsound there, and the value comparison needs no history API at all. The one thing that genuinely differs here is that the string being compared can be produced by two different surfaces, which is what the shared `onDocChange` seam and the normalization re-take address.

[^dirty-before-change]: The two notifications have to fire in some order, and only one leaves the object consistent: a `"change"` listener that asks `isDirty()` should not be told `false` about a change it is being notified of right now. `CodeEditor.onDocChange` already settles it in that order, so the two editors answer the question the same way.

[^single-seam]: Three options were live. (a) *One private seam both handlers call* — chosen. (b) *Set the flag inline in each handler* — duplicates the comparison in two places that already duplicate a cache-and-emit pair, and leaves no single point a test can drive. (c) *Subscribe to the component's own public `"change"` event* — rejected on ordering and on layering: a self-registered listener runs after every consumer listener, so a consumer reading `isDirty()` inside its own `"change"` handler would see the stale value, reversing the rule `CodeEditor` set; and a component consuming its own public event to maintain its own private state inverts the direction the `ListenerBag` fan-out exists for. Option (a) also removes a real duplication: `handleChange` and `handleCodeChange` carry the same three-statement body today, and after this change they carry one dispatch each. The seam is named `onDocChange` to match `CodeEditor`'s, and it is factored out for the same reason `reindentFallback` was ([CodeEditor.ts:571-583](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L571-L583)) — a directly-callable method is testable where the live path is not.

[^normalization]: Measured, not assumed. Running the demo's own `SAMPLE` document through `MarkdownEditor.setValue` and reading `getValue()` back shows two normalizations: the document's trailing newline is dropped, and the table's delimiter row `|:---|:---:|` becomes `| :--- | :---: |`. The conversion is idempotent from the second pass on, so the converted form is a fixpoint. Two consequences make the re-take mandatory rather than a refinement. First, the Lexical editor is built lazily and its build does **not** emit `"change"` (the initial state is populated before the update listener is registered, [MarkdownEditor.ts:819-821](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L819-L821)), so nothing else would ever reconcile the baseline. Second, `handleChange` runs on *every* Lexical update, including a selection-only one — a measured no-op `editor.update()` emits a `"change"` carrying the converted Markdown — so the first click into a freshly-opened editor would set the flag. Guarding the re-take on `!this.isDirty()` costs one condition and closes the one path where the re-take would be wrong: `ensureEditor()` is also reachable from `setMode("wysiwyg")`, `focus()`, and every command method, so on a `mode: "source"` editor the first build can land after real edits. This mirrors `CodeEditor.mount()`'s re-take of `_cleanValue` from `state.doc.toString()` ([CodeEditor.ts:797-799](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L797-L799)), which exists for CodeMirror's line-ending normalization — the same problem, one class over. `CodeEditor` needs no guard there because only its live view can set its flag, so it is always clean when it mounts; `MarkdownEditor` cannot make that claim, hence the condition.

[^child-not-owner]: `Component.isDirty()` is `_ownDirty || _dirtyDescendantCount > 0`, and the source `CodeEditor` is an `addComponent` child ([MarkdownEditor.ts:361](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L361)), so its flag is OR-ed into `MarkdownEditor`'s. That aggregation is working as designed, but the child answers a different question — "has the text changed since this surface last loaded or mounted" — and the two baselines drift apart on a mode switch. The reachable failure: with the default WYSIWYG mode, a user edits, then switches to source. `setMode` loads the edited text with `_codeEditor.setValue(markdown)` **before** the `Card` makes the source editor visible, so the child has no view yet, takes no transaction, and then re-takes its own clean text from the loaded document when it mounts. The child's baseline is now the *edited* text while `MarkdownEditor`'s is the original. If the user then hand-deletes their edit in source mode, `MarkdownEditor`'s own comparison correctly says clean while the child says dirty, and the OR reports dirty for a document that is back to its clean text. Calling `_codeEditor.markClean()` on every source change removes the second baseline entirely rather than trying to keep two in step. It is cheap (the child's `markClean` is two assignments and an early-returning `setDirty`) and it fires no spurious event: the relay's decrement and this component's own `setDirty` overlap inside one synchronous change, so `onDirtyChange` still fires exactly once per real transition — verified across the source-edit, undo-to-clean, and mode-switch-load sequences.

[^markclean-forwards]: Strictly, `handleCodeChange`'s re-baseline already leaves the child clean at every point a caller can observe, so the forwarding call inside `markClean()` clears a flag that is already clear. It earns its line by moving the child's *clean text*, not its flag: `MarkdownEditor.setValue()` in source mode reaches `_codeEditor.setValue(value)` directly, and when the source surface has never been displayed there is no view, no transaction, and therefore no `"change"` — so without this call the child's clean text stays at the constructed document until `CodeEditor.mount()` happens to re-take it. That makes `markClean()`'s contract depend on another class's mount-time internals. One call removes the dependency.

[^no-rebaseline]: The rule and its reason are inherited unchanged from `plans/implemented/code-editor-dirty-state-adoption.md`: a dirty flag wrongly `true` costs an extra save prompt, one wrongly `false` loses unsaved work. `setMode("source")` calls `_codeEditor.setValue(markdown)` on every switch, so a `setValue` that re-established a clean baseline would clear a real dirty flag when a user edits in one mode and switches to the other. `MarkdownEditor.setValue` is the same kind of call one level up, and gets the same answer.

[^demo-affordance]: The demo affordance is not decoration here, it is the only way to exercise the feature end to end. Both surfaces' live edit paths are unreachable from the test harness, so without a visible readout the adopter's behaviour under real typing, real undo, and a real mode toggle is never checked at all. `CodeEditorPanel` set the precedent for exactly this, for exactly this reason, and its shape is copied rather than redesigned: one status `Text`, one Save button that persists nothing, and a single `onDirtyChange` listener registered on the panel itself. Listening on the panel rather than on the editor is what makes the row prove the relay — the panel sits three containers above the editor and is never told anything directly. The one deviation is placement: `CodeEditorPanel` is a `VBox` and adds the row as its own row, while `MarkdownEditorPanel` is a `Split` whose left half is a `Border`, so the row goes in that `Border`'s SOUTH slot to keep the split's two halves intact.

[^no-option]: Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Construction* rule, an options field configures a component at construction; the dirty flag is runtime state a component sets about itself. There is also no backing field for it on `MarkdownEditor` — `_ownDirty` lives on `Component` and is reached only through the inherited protected setter — so nothing needs routing through `applyOptions`.

[^no-declare]: [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s `declare` rule covers fields written by a setter that `applyOptions` dispatches during the `super()` cascade. `_cleanValue` is written only from the constructor body, `ensureEditor()`, and `markClean()`, none of which the cascade reaches, so it is an ordinary field. It must still be declared with no initializer and assigned in the constructor **body**: a field initializer runs the moment `super()` returns, which is before the positional `value` argument is cached and before `_codeEditor` exists, so an initializer would capture `""`. TypeScript's `strictPropertyInitialization` is satisfied by the constructor-body assignment. `CodeEditor` declares its own `_cleanValue` the same way.

[^spurious-change]: The extra `"change"` emit predates this plan: `handleChange` compares the converted Markdown against `_options.value`, which still holds the un-converted construction string until the first update writes over it, so the first Lexical update after a normalized construction value emits a `"change"` whose payload differs from the constructed text. It is measurable today on `master` and has one visible consequence in the demo — the read-only viewer re-renders once with identical output. The dirty flag is unaffected because the `ensureEditor()` re-take puts `_cleanValue` in the converted form, so that first emit computes `converted !== converted`. Fixing the emit means also writing the converted form into `_options.value` inside `ensureEditor()`, which changes when and whether `"change"` fires for every consumer — a separate change, with its own test and doc impact, and not one this feature needs.

[^llms-noop]: `packages/lib/llms.txt` is generated from the curated manifest in `scripts/llms/manifest.data.mjs`, which lists capabilities and their doc pages rather than class members — `MarkdownEditor`'s single entry names the component and its doc page, and `CodeEditor.markClean()` did not appear there when it shipped either. `npm run docs:llms` is still run per `## Ordered Implementation Steps`, to confirm the no-op rather than assume it, which is why the file is absent from `## Files to Create / Modify / Delete`.

[^depends-on]: `depends-on: [component-dirty-state]` stays correct and stays useful. Per `../_shared/plan-frontmatter.md` the field names plans that must sit in `plans/implemented/` before this one starts — a precondition, not a branch-stacking instruction — and `plans/implemented/component-dirty-state.md` is there, so the check passes immediately and `/implement` needs no order derivation of its own. Keeping the entry after the dependency merges costs nothing and records the lineage the plan's design rests on. Two other plans, `code-editor-dirty-state-adoption` and `code-editor-undo-clears-dirty`, are equally prerequisites in fact — `MarkdownEditor.markClean()` calls the `CodeEditor.markClean()` the first added — and are equally already in `plans/implemented/`; they are listed under `## Critical Files` rather than in the frontmatter, since naming the mechanism's own plan is enough to pin the branch point and every one of the three is already on `master`. If an implementer finds `setDirty` missing from `Component.ts` or `markClean` missing from `CodeEditor.ts`, a dependency has been reverted — stop rather than re-implementing it.
