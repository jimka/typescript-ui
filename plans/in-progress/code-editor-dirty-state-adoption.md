---
depends-on:
  - component-dirty-state
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# CodeEditor Dirty-State Adoption — Implementation Plan

## Overview

`Component` now carries a generic dirty-state mechanism — `isDirty()`, a protected `setDirty(dirty)`, `onDirtyChange(listener)` / `offDirtyChange(listener)`, and an automatic parent-to-child relay wired in `wireChild` / `unwireChild` so any container's `isDirty()` folds in every descendant's. It shipped with no real caller: only a test-only `DirtyProbe` subclass in [`packages/lib/tests/component/dirty-state-propagation.test.ts`](packages/lib/tests/component/dirty-state-propagation.test.ts) exercises it.[^mechanism-branch]

This plan gives the mechanism its first real adopter and makes it visible in a browser. Three code changes, plus docs:

1. **[`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) reports itself dirty** whenever its document changes, and gains one public method, `markClean()`, to clear the flag.
2. **[`CodeEditorPanel`](packages/lib/src/typescript/CodeEditorPanel.ts)** — the demo panel registered as the "CodeEditor" section in [`main.ts:92`](packages/lib/src/typescript/main.ts#L92) — gains a **Save** button and a status line driven by `onDirtyChange`, so a person running `npm run dev` can type in the editor, watch the indicator flip, click Save, and watch it flip back.
3. **[`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts)** gains a `describe` block pinning the adopter's own contract.

The status line shows two values: the editor's own `isDirty()` and the panel's own `isDirty()`. The panel sits two containers above the editor (`CodeEditorPanel` → `editorHost` → `CodeEditor`, [CodeEditorPanel.ts:34-36](packages/lib/src/typescript/CodeEditorPanel.ts#L34-L36)) and is never told anything directly, so the second value makes the relay itself visible rather than only the leaf's flag.

---

## Architecture Decisions

### `CodeEditor` is the only adopter — `MarkdownEditor` is not wired

Only `CodeEditor` calls `setDirty()`. [`MarkdownEditor`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) is left alone, even though it will start reporting dirty for free — it holds a `CodeEditor` as a child via `addComponent` ([MarkdownEditor.ts:361](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L361)), so the relay folds the source editor's flag into it with no code.[^only-codeeditor]

### Every document change marks the editor dirty; `markClean()` is the one clean point

`CodeEditor`'s dirty flag mirrors its existing `"change"` event exactly: whatever fires `"change"` also sets dirty. Nothing clears the flag implicitly — not `setValue()`, not `format()`. A host clears it by calling the new public `markClean()`.[^mirror-change]

| Action | Fires `"change"` | `isDirty()` afterwards |
|---|---|---|
| `new CodeEditor(text)` | no | `false` |
| user types a character (live view) | yes | `true` |
| `format()` (live view) | yes | `true` |
| `setValue("…")` (live view) | yes | `true` |
| `setValue("…")` with no view mounted (offline) | no | unchanged |
| `markClean()` | no | `false` |
| user types again after `markClean()` | yes | `true` |

### The document-change path is factored into a private `onDocChange`, so the adopter's seam is testable offline

The `setDirty(true)` call does not go inline into CodeMirror's update listener. The listener's `docChanged` branch ([CodeEditor.ts:720-723](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L720-L723)) is reduced to one call to a new private `onDocChange(value)`, which caches the value, sets dirty, and emits `"change"`. The framework's offline test harness never mounts a CodeMirror `EditorView`, so that update listener never runs in a test; a test drives `onDocChange` directly instead.[^factor-out]

`onDocChange` sets dirty **before** emitting `"change"`, so any `"change"` listener that queries `isDirty()` sees the settled value.[^dirty-before-change]

### The demo surfaces the editor's flag and the panel's own flag in one status line

`CodeEditorPanel` registers a single listener on *itself* (`this.onDirtyChange(...)`) and, on each fire, rewrites one `Text` row with both values. It does not listen to the editor directly.[^listen-on-self]

| Moment | Status line |
|---|---|
| panel opens | `Dirty — editor: no, panel (2 levels up): no` |
| after typing a character | `Dirty — editor: yes, panel (2 levels up): yes` |
| after clicking Save | `Dirty — editor: no, panel (2 levels up): no` |

The status `Text` is added as its own row in the panel's `VBox`, below the toolbar — the shape [`MenuBarPanel.ts:171`](packages/lib/src/typescript/MenuBarPanel.ts#L171) and [`ToolBarPanel.ts:142`](packages/lib/src/typescript/ToolBarPanel.ts#L142) already use for a demo status line. [`BindingPanel.ts:115-125`](packages/lib/src/typescript/BindingPanel.ts#L115-L125) is the nearest precedent for what the row reports: a `Text` flipped between "Status: modified" and "Status: clean" by a component's own change and commit events.

### The demo's Save button writes nothing — it only clears the flag

The **Save** button calls `this._editor.markClean()` and nothing else. No file, no store, no fake backend.[^save-writes-nothing]

---

## Public API

One new public method on the already-exported `CodeEditor`. `isDirty()` / `onDirtyChange()` / `offDirtyChange()` are inherited from `Component` and are **not** redeclared. No new option, no new backing field on `CodeEditor` — the flag lives in `Component`'s own private state, reached through the inherited protected setter.[^no-option]

```typescript
// component/editor/CodeEditor.ts

/**
 * Accepts the current document as the clean baseline, clearing this
 * editor's dirty flag (and, through the framework's relay, every
 * ancestor's, unless another descendant is still dirty). Call it after
 * the host has persisted the document, or after loading one with
 * `setValue`. Persisting is the host's job — this method only reports
 * state; it writes nothing and does not change the document.
 *
 * Every document change — typing, paste, `format()`, `setValue()` —
 * marks the editor dirty again.
 *
 * @returns This component, for method chaining.
 */
markClean(): this;
```

---

## Internal Structure

The new private handler, and the update-listener branch that calls it:

```typescript
/**
 * Applies a document change from the live CodeMirror view: caches the new
 * text, flags the editor dirty, then emits `"change"`. Factored out of the
 * update listener in `mount()` so the offline harness — where no
 * `EditorView` ever mounts — can drive the same path directly, mirroring
 * how `reindentFallback` is factored out of `format()`.
 *
 * @param value - The new document text.
 */
private onDocChange(value: string): void {
    this._options.value = value;
    // Dirty before the emit, so a `"change"` listener that queries
    // isDirty() sees the settled value.
    this.setDirty(true);
    this.emit("change", { value });
}
```

```typescript
// inside mount()'s EditorView.updateListener
if (update.docChanged) {
    this.onDocChange(update.state.doc.toString());
}
```

```typescript
markClean(): this {
    this.setDirty(false);

    return this;
}
```

The demo panel's handler is an arrow-function **field**, not a method: it is passed as a bare `this.handleDirtyChange` reference to `onDirtyChange`, which calls it unbound. That is the convention [`MarkdownEditorPanel.ts:93-99`](packages/lib/src/typescript/MarkdownEditorPanel.ts#L93-L99) documents for the same situation. It declares **no parameter**: `onDirtyChange` does pass the new value, but the handler reads both flags itself, and a zero-argument function is assignable to `(dirty: boolean) => void`, so declaring an unused one would only add noise.

```typescript
// CodeEditorPanel.ts
private readonly handleDirtyChange = (): void => {
    this._statusText.setText(
        `Dirty — editor: ${this._editor.isDirty() ? 'yes' : 'no'}`
        + `, panel (2 levels up): ${this.isDirty() ? 'yes' : 'no'}`);
};
```

---

## Ordered Implementation Steps

Steps 1-3 add the two methods, step 5 writes the tests that pin them, and steps 6-10 build the demo. Note that `npm test` runs a typecheck over the test files before vitest, so `markClean()` must exist before the new test block can run at all — that is why the two source methods come first rather than the test block.

1. **[`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts)** — add the private `onDocChange(value: string): void` method from **Internal Structure**, placed directly above `private reindentFallback()` ([:546](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L546)) so it sits with the other private helpers.

2. **Same file, [:719-723](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L719-L723)** — in `mount()`'s `EditorView.updateListener`, replace the two lines inside the `if (update.docChanged)` branch with the single `this.onDocChange(update.state.doc.toString());` call. The `update.heightChanged || update.geometryChanged` branch below it is unchanged.

3. **Same file** — add the public `markClean(): this` method with the JSDoc from **Public API**, placed directly after `setValue()` ([:347-357](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L347-L357)), so the load-a-document and clear-the-flag calls read together. Do **not** modify `setValue()` itself.

4. Check: `grep -n 'setDirty' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly two matches (`onDocChange`, `markClean`). `grep -n 'this.emit("change"' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly one match, now inside `onDocChange`.

5. **[`packages/lib/tests/component/code-editor.test.ts`](packages/lib/tests/component/code-editor.test.ts)** — insert a new `describe('CodeEditor dirty state', …)` block after the `describe('CodeEditor listeners bag', …)` block ends at [:162](packages/lib/tests/component/code-editor.test.ts#L162), before `describe('CodeEditor autoHeightMaxRows', …)`. Cover cases 1-8 of **Expected Behaviour**. Reach the private handler as `(editor as any).onDocChange('…')`, matching the `(editor as any).emit('change', …)` probe already used at [:129](packages/lib/tests/component/code-editor.test.ts#L129). Use a plain `new Component()` as the parent in the relay case, as [`dirty-state-propagation.test.ts`](packages/lib/tests/component/dirty-state-propagation.test.ts) does; `Component` is already imported at [:9](packages/lib/tests/component/code-editor.test.ts#L9).

6. **[`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts)** — add `Text` to the existing import list, taking it from `'@jimka/typescript-ui/component/input'` (a new import line; the file has no input-barrel import yet).

7. **Same file** — add two private fields beside `_editor` / `_readOnlyBtn` ([:24-25](packages/lib/src/typescript/CodeEditorPanel.ts#L24-L25)):
   - `private readonly _statusText: Text;`
   - the `handleDirtyChange` arrow field from **Internal Structure**, declared after `_statusText`.

8. **Same file, inside the toolbar block ([:44-47](packages/lib/src/typescript/CodeEditorPanel.ts#L44-L47))** — build a Save button and add it to `toolbar` alongside `formatBtn` and `_readOnlyBtn`, above the existing `this.addComponent(toolbar)` line: `const saveBtn = new Button({ text: 'Save' });` and `saveBtn.on('action', () => this._editor.markClean());`. Match the inline-arrow shape the file already uses at [:39](packages/lib/src/typescript/CodeEditorPanel.ts#L39) and [:42](packages/lib/src/typescript/CodeEditorPanel.ts#L42), and add a comment saying the button persists nothing and only clears the dirty flag.

9. **Same file, after `this.addComponent(toolbar)`** — append these four statements, in this order, at the end of the constructor:
   - `this._statusText = new Text('');`
   - `this.addComponent(this._statusText);` — its own row in the panel's `VBox`, below the toolbar row.
   - `this.onDirtyChange(this.handleDirtyChange);`
   - `this.handleDirtyChange();` — paints the initial line from the same formatting code rather than duplicating the string.

10. **Same file** — extend the class JSDoc ([:16-21](packages/lib/src/typescript/CodeEditorPanel.ts#L16-L21)) with one sentence: the status row reports the editor's own dirty flag and the panel's own, the panel's arriving through the framework's parent-to-child relay two containers up, and Save clears it.

11. Run `cd packages/lib && npm run typecheck && npm test` — clean, including the new cases.

12. Run `cd packages/lib && npm run lint` — no new findings.

13. Update docs per **Documentation Impact**: [`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md) and [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).

14. Run `cd packages/lib && npm run docs:llms` (regenerates `packages/lib/llms.txt` — never hand-edit) then `npm run docs:api` — zero warnings.

15. Run the manual browser checks in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (regenerate) | `packages/lib/llms.txt` |

---

## Expected Behaviour

### Unit-testable (offline)

The offline test harness never mounts a CodeMirror `EditorView`, so the cases that need a document change drive the private `onDocChange` directly instead of typing.

1. A freshly built editor is clean: `new CodeEditor('const x = 1;').isDirty()` is `false`.
2. `(editor as any).onDocChange('typed')` makes `isDirty()` `true`, and `getValue()` returns `'typed'`.
3. The same call still emits `"change"`: a listener registered with `editor.on('change', fn)` receives `{ value: 'typed' }` exactly once.
4. A `"change"` listener that calls `editor.isDirty()` sees `true` — dirty is set before the emit.
5. `onDirtyChange` fires once per real transition through the real adopter: with a listener registered via `editor.onDirtyChange(fn)`, two consecutive `onDocChange('a')` / `onDocChange('b')` calls fire it exactly once, with `true`.
6. `markClean()` makes `isDirty()` `false` and fires the listener once with `false`; it returns the editor itself (chainable). A second `markClean()` on an already-clean editor fires nothing further.
7. The relay reaches a real parent: with `parent = new Component()` and `parent.addComponent(editor)`, `onDocChange('x')` makes `parent.isDirty()` `true` and fires a listener on `parent` once with `true`; `editor.markClean()` returns `parent.isDirty()` to `false` and fires it once with `false`.
8. Offline, `setValue('hello')` leaves `isDirty()` unchanged — with no view there is no transaction, so `onDocChange` never runs. Live, `setValue` dispatches a replace transaction and does mark the editor dirty (see the table in **Architecture Decisions**); the demo panel exposes no `setValue` control, so that path has no manual case below.

### Manual verification (browser)

`npm run dev`, then open <http://localhost:8015> and select the **CodeEditor** section.

9. On open, the status row reads `Dirty — editor: no, panel (2 levels up): no`.
10. Typing one character in the editor flips it to `Dirty — editor: yes, panel (2 levels up): yes`. Both values flip together — the panel's is derived through the relay, never written by the panel.
11. Clicking **Save** returns it to `Dirty — editor: no, panel (2 levels up): no`, and the document text is unchanged.
12. Typing again after Save flips it back to `yes` / `yes`.
13. Clicking **Format** flips it to `yes` / `yes` (formatting rewrites the document, so it is an edit).
14. With **Read-only: on**, typing changes neither the document nor the status row — a rejected edit never becomes a transaction, so it does not reach `onDocChange`.
15. Undoing every edit back to the original text leaves the row reading `yes`: the flag tracks that changes happened, not whether the text differs from a baseline.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including cases 1-8 above.
- `cd packages/lib && npm run lint` — no new findings.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.
- `grep -n 'setDirty' packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly two matches.
- `grep -n 'setDirty' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — zero matches; `MarkdownEditor` is not an adopter.
- `git diff --name-only` lists none of `Component.ts`, `MarkdownEditor.ts`, `Tab.ts`, or `plans/code-editor-desktop-app.md`.
- `grep -n 'markClean\|onDirtyChange\|isDirty' packages/lib/src/typescript/CodeEditorPanel.ts` — matches for all three.
- Manual: `npm run dev` → <http://localhost:8015> → **CodeEditor** section → cases 9-15 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/CodeEditor.md`](packages/lib/docs/components/CodeEditor.md)** — add a `## Dirty state` section immediately before `## Keyboard` ([:84](packages/lib/docs/components/CodeEditor.md#L84)). State the rule from **Architecture Decisions** (every document change marks the editor dirty; `markClean()` is the only thing that clears it), that `isDirty()` folds up into every ancestor container automatically, that a host loading a document with `setValue()` should follow it with `markClean()`, and that the flag tracks *that* edits happened rather than whether the text differs from a baseline (so undoing back to the original leaves it dirty).
- **Same page**, `## Common methods` table ([:96-105](packages/lib/docs/components/CodeEditor.md#L96)) — add one row:

  ```markdown
  | `markClean()` | Clear the dirty flag, accepting the current document as the clean baseline. |
  ```
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — under `## Added` → `### Components` ([:64](packages/lib/docs/reference/changelog/next.md#L64)), add a bullet: `CodeEditor` now reports itself dirty through `Component.isDirty()` on every document change and gains `markClean()` to clear the flag. Note that `MarkdownEditor` inherits the state through the framework's relay because it hosts a `CodeEditor`, and that no consumer action is needed.
- **`packages/lib/llms.txt`** — regenerate via `npm run docs:llms` (step 14); `markClean` is a new consumer-facing capability on `CodeEditor`.
- `markClean()`'s JSDoc must **not** `{@link}` the protected dirty setter — describe it in prose, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols*. `{@link Component.isDirty}` would be legal (public, documented), but plain prose is used above and is enough.

---

## Potential Challenges

- **`MarkdownEditor` starts reporting dirty without being changed.** It holds a `CodeEditor` child, so the relay folds the source editor's flag into it, and `setMode("source")`'s internal `_codeEditor.setValue(markdown)` ([MarkdownEditor.ts:418](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L418)) marks it dirty on a mode switch alone. Nothing in the library or the demos reads `MarkdownEditor.isDirty()`, so no behaviour changes; wiring `MarkdownEditor`'s own edit paths is a separate plan (see **Non-Goals**).
- **The live typing path cannot be unit-tested.** CodeMirror's update listener only runs against a mounted `EditorView`, which the offline test harness never creates — the same limitation the existing test file already documents at its head. Mitigation: `onDocChange` is a directly-callable seam for the tests, and manual cases 9-15 cover the live path.
- **`markClean()` clears only this editor's own flag.** If a sibling component under the same ancestor is dirty, the ancestor stays dirty. Ancestor-level aggregation is the mechanism's defined behaviour, not a defect in the adopter; the demo panel has exactly one dirty-capable component, so its two status values always agree.
- **The demo panel's listener needs no teardown.** `onDirtyChange` registers on the panel itself, and `Component` clears its own listener bag on dispose — there is no cross-component registration to unwind.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — `setValue` ([:347](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L347)), `format` ([:513](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L513)), `reindentFallback` and the JSDoc explaining why it was factored out ([:539-550](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L539-L550) — **the precedent this plan's `onDocChange` mirrors**), `emit` ([:625](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L625)), `mount`'s update listener ([:719-728](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L719-L728)), `onEditIntent` ([:1183](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1183) — the read-only rejection path that never reaches `onDocChange`).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the inherited `isDirty()` / protected `setDirty()` / `onDirtyChange()` / `offDirtyChange()` and the `wireChild` / `unwireChild` relay. Read for the exact contract; unmodified by this plan.
- [`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md) — the mechanism's design, its aggregation rule, and the Non-Goals section this plan discharges.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) — the demo panel being extended; note the two-level nesting at [:34-36](packages/lib/src/typescript/CodeEditorPanel.ts#L34-L36).
- [`packages/lib/src/typescript/MenuBarPanel.ts:171`](packages/lib/src/typescript/MenuBarPanel.ts#L171) and [`packages/lib/src/typescript/ToolBarPanel.ts:44`](packages/lib/src/typescript/ToolBarPanel.ts#L44) / [`:142`](packages/lib/src/typescript/ToolBarPanel.ts#L142) — **the precedent for a demo status `Text` added as its own row** in the panel's `VBox`.
- [`packages/lib/src/typescript/BindingPanel.ts:68`](packages/lib/src/typescript/BindingPanel.ts#L68) and [`:115-125`](packages/lib/src/typescript/BindingPanel.ts#L115-L125) — the existing "Status: modified" / "Status: clean" readout driven by a commit-style event; the wording precedent.
- [`packages/lib/src/typescript/MarkdownEditorPanel.ts:93-99`](packages/lib/src/typescript/MarkdownEditorPanel.ts#L93-L99) — the arrow-function-field convention for a handler passed as a bare reference.
- [`packages/lib/tests/component/code-editor.test.ts:124-162`](packages/lib/tests/component/code-editor.test.ts#L124-L162) — the `describe` block the new one follows, and the `(editor as any)` probe pattern.
- [`packages/lib/tests/component/dirty-state-propagation.test.ts`](packages/lib/tests/component/dirty-state-propagation.test.ts) — the generic mechanism's coverage; read to avoid duplicating it.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts:361`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L361) and [`:408-427`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L408-L427) — the `addComponent` that makes the relay reach it for free, and the `setMode` bridge that marks it dirty.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Event handling*, *Keep presentation state out of data Models*. [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — *Don't `{@link}` internal symbols*.

---

## Non-Goals

- **`MarkdownEditor` and its WYSIWYG surface are not wired.** Its Lexical surface has its own change path and its mode switch reloads the source editor, so making its dirty reporting correct is a design problem of its own. The goal here is one working, visible adopter.
- **No change to `plans/code-editor-desktop-app.md`'s `FileEditor._dirty`.** The Loom app's hand-rolled flag stays as it is; that plan file is not touched.
- **No `Tab` label decoration.** How a container renders "something inside me is dirty" stays each consumer's own decision, as the mechanism's own plan established. `Tab.ts` is not touched.
- **No persistence.** The demo's Save button writes nothing anywhere. No file API, no store, no fake backend.
- **No baseline diffing.** `CodeEditor` does not keep a copy of the clean text and compare against it, so undoing back to the original document leaves the editor dirty.[^no-baseline-diff]
- **No `dirty` construction option, and no widening of `setDirty` to public.** `markClean()` is the whole new public surface.
- **No change to `Component.ts`.** The mechanism is used as shipped.

---

## Notes

[^mechanism-branch]: The mechanism is implemented on the `feature/component-dirty-state` branch and is **not on `master`** at the time of writing — `grep -n 'setDirty' packages/lib/src/typescript/lib/core/Component.ts` on `master` returns nothing. That is what the `depends-on: [component-dirty-state]` frontmatter records: this plan cannot start until that branch is merged and its plan file has moved to `plans/implemented/component-dirty-state.md`. If an implementer finds `setDirty` missing from `Component.ts`, the dependency has not landed yet — stop rather than re-implementing the mechanism.

[^only-codeeditor]: Three reasons for stopping at `CodeEditor`. First, it is the case the mechanism's own plan named and analysed, and it already has a `"change"` event to key off. Second, `MarkdownEditor` would need a second, unrelated adoption: its WYSIWYG surface is a Lexical editor with its own change plumbing, so covering it means wiring two edit paths, not one. Third, its `setMode` bridge reloads the source editor through `_codeEditor.setValue(markdown)`, which under this plan's rule marks the editor dirty — so a *correct* `MarkdownEditor` adoption also has to decide what a mode switch means for the flag, which is a design question this plan would have to answer badly or at length. Since the goal is a demo a person can drive, one honest adopter beats two half-specified ones. The relay still reaches `MarkdownEditor` for free, so nothing is blocked later.

[^mirror-change]: Two options were live. (a) *Any document change marks dirty; `markClean()` is the only clean point* — chosen. (b) *`setValue()` additionally re-establishes a clean baseline*, on the argument that replacing the whole document is a load rather than an edit. Option (b) was rejected on failure direction: in `MarkdownEditor`, `setMode("source")` calls `_codeEditor.setValue(...)`, so under (b) a user who edits in source mode, switches to WYSIWYG, and switches back would have a real dirty flag silently cleared. A dirty flag that is wrongly `true` costs an extra save prompt; one that is wrongly `false` loses unsaved work. Option (b) also needed `markClean()` to run *after* the replace transaction (which re-enters the change path synchronously), producing a `true`→`false` event pair on every `setValue` — an ordering trap in a method the plan otherwise leaves alone. Option (a) needs no ordering rule, does not touch `setValue` at all, and states in one sentence: the dirty flag mirrors the `"change"` event. A third option, comparing the document against a stored clean copy so that undoing back to the original reports clean, was rejected on cost: it means a full string comparison per keystroke, which on a large document is exactly the per-keystroke work a code editor cannot afford.

[^factor-out]: [`packages/lib/tests/component/code-editor.test.ts:27-31`](packages/lib/tests/component/code-editor.test.ts#L27-L31) records the constraint: `DOM.sink.mountView` returns `null` under the recording sink, so `_view` never leaves `null` and CodeMirror's `updateListener` never fires in any test. An inline `this.setDirty(true)` in that listener would therefore be unreachable by every automated test, leaving the adopter's whole seam manual-only. The same file already solved the same problem once: `reindentFallback` ([:539-550](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L539-L550)) was factored out of `format()` with the JSDoc "so the dispatch decision … is unit-testable by spying on this method — the actual re-indent needs a live view". `onDocChange` follows that precedent exactly, and it also keeps the update listener a two-line dispatch rather than a growing inline body.

[^dirty-before-change]: The two events have to fire in some order, and only one order leaves the object consistent for its listeners: a `"change"` listener that asks `isDirty()` should not be told `false` about a change it is being notified of right now. Reordering is free here because `"dirtychange"` has no consumers yet — the mechanism shipped with no adopter, so nothing existing can observe the relative order. `"change"` still fires at the same point in the sequence it always did, so no existing `"change"` listener sees any difference.

[^listen-on-self]: Listening on the panel itself rather than on `this._editor` is what makes the demo prove the relay. A listener on the editor only shows that `setDirty` works; a listener on the panel — two containers above, wired by `wireChild` with no code in the panel reaching down into its subtree — shows that the aggregation and the bubbling work. One listener is enough for both readouts, since the panel's fire is caused by the editor's, and reading `this._editor.isDirty()` inside the handler costs nothing. The panel's own value is labelled "2 levels up" in the status text so a person can see what is being claimed.

[^save-writes-nothing]: The alternative — a Revert button calling `setValue(SAMPLE_JS)`, which needs no new public API at all — was rejected because it demonstrates the wrong thing. The mechanism exists so a host that has *persisted* a document can say so, and a component with no public way to say it is not actually adoptable: the Loom app's `FileEditor` would hit that wall immediately. A demo that only reverts text would leave the mechanism's one real use unexercised. Labelling the button "Save" while it writes nothing is honest as long as the code says so, hence the required comment at the call site and the "persisting is the host's job" sentence in `markClean()`'s own JSDoc.

[^no-option]: Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Construction* rule, an options field is for configuring a component at construction; the dirty flag is runtime state a component sets about itself, never something a consumer configures up front. It also has no backing field on `CodeEditor`: `_ownDirty` lives on `Component`, and `markClean()` reaches it only through the inherited protected setter. So there is nothing here to route through `applyOptions`, and no `declare` field to add.

[^no-baseline-diff]: See the third option discussed in the dirty-semantics footnote above: a stored clean copy would make undo-to-original report clean, at the cost of a full string comparison on every keystroke. The behaviour is documented on the `CodeEditor` page rather than worked around.
