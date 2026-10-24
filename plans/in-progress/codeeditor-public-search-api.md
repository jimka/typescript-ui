---
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/CodeEditor.ts
  - packages/lib/docs/components/CodeEditor.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/src/typescript/CodeEditorPanel.ts
---

# CodeEditor Public Search API — Implementation Plan

## Overview

`CodeEditor` gains one public method, `openSearch(): boolean`. It opens the editor's floating search card exactly as `Ctrl-F` (`Cmd-F` on macOS) does inside the document. It lets an app offer Find from places other than a keypress in the editor: an Edit › Find… menu item, a command-palette entry, or an app-wide `Ctrl+F` that targets the active editor while focus is in, say, a file tree. The request comes from the Loom app, which today works around the missing method by installing a second `search()` extension and calling `@codemirror/search`'s `openSearchPanel` on the editor's view; with `openSearch()` it can delete that code.

The method already exists as the private [`openSearch(view)` in CodeEditor.ts:2102](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2102), reached only from the `Mod-f` key binding at [CodeEditor.ts:2363](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2363). This plan makes that method public, drops its `view` parameter in favour of the editor's own `_view` field, and points the key binding at it, so the key and the public call run one code path. Everything else touched is tests, the `CodeEditor` docs page, the changelog staging page, and one demo button.

---

## Architecture Decisions

### The private `openSearch(view)` becomes the public `openSearch()` — one path for the key and the call

The existing private method is changed in place: it becomes public, loses its `view` parameter, reads `this._view`, and returns `false` when `this._view` is `null`. The `Mod-f` binding becomes `run: () => this.openSearch()`. No second method is added, so the keymap and the public API cannot drift apart.[^one-path]

This mirrors the shape of the private search methods beside it: [`runSearchCommand` (CodeEditor.ts:2139)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2139) and [`applySearchQuery` (CodeEditor.ts:2174)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2174) already read `this._view` and return early when it is `null`. The private `closeSearch(view)` at [CodeEditor.ts:2120](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2120) is not changed.

### Before mount, `openSearch()` returns `false` and does nothing — it is not queued

`CodeEditor` mounts its CodeMirror view on its first sized layout ([`onFirstLayout`, CodeEditor.ts:844](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L844)). Until then, and after `dispose()`, `_view` is `null`. In that state `openSearch()` returns `false`, does not build or show the card, and remembers nothing for a later mount.

This follows every other public `CodeEditor` method that acts on the live view rather than on configuration: [`focus()` (:1397)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1397), [`moveCursorToEnd()` (:1418)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1418), [`revealRange()` (:1499)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1499) and [`copy()` (:1544)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1544) are documented no-ops before mount, and [`paste()` (:1614)](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1614) resolves `false` with no mounted view. Only configuration setters (`setReadOnly`, `setLineWrap`, …) cache and replay at mount.[^no-queue]

### Return `boolean`, not `this`

`openSearch()` returns `true` when the card is open and its find field was focused, `false` when there is no mounted view. This differs from the `this`-returning open methods elsewhere ([`ComboBox.openDropdown()`, ComboBox.ts:1106](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1106), [`MenuBar.openMenu()`, MenuBar.ts:279](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L279)). It matches `paste()`'s `boolean` result in the same class.[^boolean]

### Only `openSearch()` is added — no `closeSearch()`, `isSearchOpen()` or `openReplace()`

The public surface grows by one method. Closing, querying and a replace mode are left out because no stated use needs them and the card has no replace mode to open.[^only-open]

---

## Public API

```typescript
class CodeEditor extends Component<CodeEditorOptions> {
    /**
     * Opens the floating search card, as `Ctrl-F` (`Cmd-F` on macOS) does in
     * the document, and moves keyboard focus to its find field with the
     * field's text selected.
     *
     * The find field is seeded from the primary selection when text is
     * selected. A collapsed caret, or a selection longer than 100 characters,
     * keeps the query the card last held. Called while the card is already
     * open, it re-seeds the same way and moves focus back to the find field,
     * so calling it twice in a row leaves the same state as calling it once.
     *
     * @remarks For a host that offers Find from outside the editor: an Edit
     * menu item, a command-palette entry, or an app-wide shortcut that targets
     * this editor while focus is somewhere else. Like the other operations
     * that act on the live view ({@link CodeEditor.focus},
     * {@link CodeEditor.revealRange}, {@link CodeEditor.paste}), it does
     * nothing before the view is mounted. The editor mounts its view on its
     * first sized layout, so an editor not yet laid out, a disposed one, or
     * one under the offline test harness returns `false`. The call is not
     * queued for a later mount.
     *
     * @returns `true` when the card is open and its find field was focused;
     *   `false` when there is no mounted view, in which case nothing changed.
     */
    openSearch(): boolean;
}
```

The JSDoc above is final: copy it verbatim. It links only to public `CodeEditor` members, as [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*) requires. The current private JSDoc links to the private `CodeEditor.mount`, so it must be replaced, not edited.

No new state, options field, event or export. `CodeEditor` is already exported from `component/editor`.

---

## Implementation

The changed method, in place at [CodeEditor.ts:2093-2109](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2093-L2109):

```typescript
openSearch(): boolean {
    if (!this._view) {
        return false;
    }

    openSearchPanel(this._view);
    this.setSearchPanelOpen(true);
    this.syncSearchPanelFields(this._view.state);
    this._searchPanel.focusFind();

    return true;
}
```

The four calls and their order are unchanged from today's body. `openSearchPanel` dispatches first, so the update listener at [CodeEditor.ts:2436](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2436) may already have shown the card. The explicit `setSearchPanelOpen(true)` / `syncSearchPanelFields` after it cover the already-open case, where `openSearchPanel` dispatches nothing when the caret is collapsed.[^double-sync]

The binding, at [CodeEditor.ts:2363](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2363):

```typescript
{ key: "Mod-f",  run: () => this.openSearch(), preventDefault: true },
```

### Seeding, worked through

These are CodeMirror's own `openSearchPanel` rules, which `openSearch()` inherits. The document is `alpha beta alpha`.

| Card before | Selection | Find field after |
|---|---|---|
| never opened | `beta` (6–10) | `beta` |
| open, holds `beta` | `alpha` (0–5) | `alpha` |
| open, holds `beta` | caret at 0 | `beta` (kept) |
| closed, last held `beta` | caret at 0 | `beta` (kept; card shown again) |
| open, user typed `gam` | caret at 0 | `gam` (kept) |

All five rows were checked against a live view under jsdom while drafting (see *Expected Behaviour*).

---

## Ordered Implementation Steps

Tests first (steps 1–2 fail until step 3 lands).

1. **Offline tests** — `packages/lib/tests/component/code-editor.test.ts`, in `describe('CodeEditor floating search panel', …)` ([:6511](packages/lib/tests/component/code-editor.test.ts#L6511)):
   - Add `afterEach(() => vi.restoreAllMocks());` as the describe's first statement. `mountOffline` ([:2013](packages/lib/tests/component/code-editor.test.ts#L2013)) leaves a spy on `EditorState.create` that the describe must restore.
   - Add cases S1–S3 from *Expected Behaviour*.
   - Check: `npx vitest run tests/component/code-editor.test.ts` (from `packages/lib`). S1–S3 fail: S1 and S2 throw a `TypeError`, because today's private `openSearch(view)` reads `view.state` from a missing argument; S3 fails its no-argument assertion, because the binding still passes the view.

2. **Mounted tests** — create `packages/lib/tests/component/code-editor-search-mounted.test.ts` with the harness of [code-editor-read-only-mounted.test.ts:1-38](packages/lib/tests/component/code-editor-read-only-mounted.test.ts#L1-L38): the `// @vitest-environment jsdom` first line, a header comment saying why this file mounts a real view (the card's focus and CodeMirror's re-open path need a live `EditorView`), the `editors` array, the `beforeEach` that stubs `Range.prototype.getClientRects` / `getBoundingClientRect`, and the `afterEach` that disposes every editor, calls `vi.restoreAllMocks()`, `DOM.reset()` and `document.body.replaceChildren()`. Do **not** call `installTestDOM`. Import only what this file uses: `describe` / `it` / `expect` / `beforeEach` / `afterEach` / `vi` from `vitest`, `EditorSelection` from `@codemirror/state`, the `EditorView` type from `@codemirror/view`, `searchPanelOpen` from `@codemirror/search`, `CodeEditor` from `~/component/editor/CodeEditor`, and `DOM` from `~/core/DOM`. Add these file-local helpers:
   - `mountEditor(doc: string): { editor: CodeEditor; view: EditorView }` — `new CodeEditor(doc)`, push to `editors`, `editor.getElement(true)`, `(editor as any).mount()`, read `(editor as any)._view`, `document.body.appendChild(view.dom.parentNode ?? view.dom)`. Same shape as `mountInto` ([:51-68](packages/lib/tests/component/code-editor-read-only-mounted.test.ts#L51-L68)) without the language wait and refusal counter.
   - `focusOutside(): HTMLButtonElement` — creates a `<button>`, appends it to `document.body`, focuses it, returns it.
   - `pressCtrlF(view: EditorView): boolean` — dispatches `new KeyboardEvent('keydown', { key: 'f', keyCode: 70, ctrlKey: true, bubbles: true, cancelable: true })` on `view.contentDOM`, returns `event.defaultPrevented`. Mirrors `pressKey` ([:92-98](packages/lib/tests/component/code-editor-read-only-mounted.test.ts#L92-L98)).
   - `findFieldFocused(editor: CodeEditor): boolean` — `DOM.source.intern(document.activeElement as Node) === (editor as any)._searchPanel._findField.getElement()`.
   - `cardFields(editor: CodeEditor)` — `(editor as any)._searchPanel.getFields()`; `cardShown(editor)` — `(editor as any)._searchPanel.isDisplayed()`.
   - Add cases M1–M7 from *Expected Behaviour*.
   - Check: `npx vitest run tests/component/code-editor-search-mounted.test.ts`. Every case except the `pressCtrlF` half of M2 fails, because `openSearch()` is still private and expects a view argument.

3. **The change** — `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`:
   - At [:2093-2109](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2093-L2109), replace the private `openSearch(view)` and its JSDoc with the public `openSearch()` from *Public API* (JSDoc) and *Implementation* (body). Keep it in the same place, directly above the private `closeSearch(view)`.
   - At [:2363](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2363), change the `Mod-f` binding's `run` to `() => this.openSearch()`. Leave the `Escape` binding and the comment above both bindings as they are.
   - Check: `grep -n "openSearch(" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` from the repo root — expect exactly two lines: the method declaration and the binding, and neither passes an argument.
   - Check: `npm run typecheck` and `npm run lint` (repo root).
   - Check: steps 1 and 2's test files now pass, and the existing keymap test K4 ([code-editor.test.ts:3383](packages/lib/tests/component/code-editor.test.ts#L3383)) still passes unchanged.

4. **Demo button** — `packages/lib/src/typescript/CodeEditorPanel.ts`: after the `previewBtn` block ([:206-209](packages/lib/src/typescript/CodeEditorPanel.ts#L206-L209)), add a `Find` button, written the way `revealBtn` is at [:201-202](packages/lib/src/typescript/CodeEditorPanel.ts#L201-L202), with a one-line comment that it opens the search card from outside the editor, as an app's Find… menu item would:
   ```typescript
   const findBtn = new Button({ text: 'Find' });
   findBtn.on('action', () => { this._editor.openSearch(); });
   ```
   Add `upperToolbar.addComponent(findBtn);` directly after `upperToolbar.addComponent(previewBtn);` ([:222](packages/lib/src/typescript/CodeEditorPanel.ts#L222)).

5. **Docs page** — `packages/lib/docs/components/CodeEditor.md`:
   - In *Search and replace* ([:332](packages/lib/docs/components/CodeEditor.md#L332)), after the first paragraph (the one ending "returns focus to the document."), insert the paragraph and fence from *Documentation Impact*.
   - In *Common methods*, insert the `openSearch()` row from *Documentation Impact* directly after the `revealRange(at, options?)` row ([:405](packages/lib/docs/components/CodeEditor.md#L405)).

6. **Changelog** — `packages/lib/docs/reference/changelog/next.md`: append `## Added`, then `### Components`, then the bullet from *Documentation Impact*. The page holds only its intro today, so both headings are new. No migration note: the change breaks nothing.

7. **Final checks** — run everything in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/code-editor.test.ts` |
| Create | `packages/lib/tests/component/code-editor-search-mounted.test.ts` |
| Modify | `packages/lib/src/typescript/CodeEditorPanel.ts` |
| Modify | `packages/lib/docs/components/CodeEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Offline — `code-editor.test.ts` (modelled DOM, no live view)

- **S1 — before mount.** `new CodeEditor('x').openSearch()` returns `false`. The card is not shown (`_searchPanel.isDisplayed()` is `false`) and its controls are not built (`_searchPanel.isBuilt()` is `false`).
- **S2 — after dispose.** `const e = new CodeEditor('x'); e.dispose();` then `e.openSearch()` returns `false` and does not throw.
- **S3 — the key binding is the public method.** `const { editor, state } = mountOffline('x');`. Take `binding = state.facet(keymap).flat().find((b) => b.key === 'Mod-f')!` (the editor's own `Prec.high` binding comes first, as K4 pins). `vi.spyOn(editor, 'openSearch').mockReturnValue(true)`; `binding.run({} as EditorView)` returns `true` and the spy was called once with no arguments. Repeat with `mockReturnValue(false)`: `binding.run` returns `false`. `binding.preventDefault` is `true`.

### Mounted — `code-editor-search-mounted.test.ts` (jsdom, live `EditorView`)

Every case uses the document `alpha beta alpha` and the helpers from step 2. Selections are set with `view.dispatch({ selection: EditorSelection.range(from, to) })` or `EditorSelection.cursor(pos)`.

- **M1 — opens from focus outside the editor.** Select 6–10 (`beta`), call `focusOutside()`, then `editor.openSearch()`. It returns `true`; `cardShown` is `true`; `cardFields(editor).search` is `beta`; `searchPanelOpen(view.state)` is `true`; `findFieldFocused` is `true`; and the focused input's `selectionStart` / `selectionEnd` are `0` / `4`.
- **M2 — same result as `Ctrl-F`.** Two editors, each with 6–10 selected. On the first, call `view.focus()`, then `pressCtrlF(view)` returns `true` (default prevented); record `cardShown`, `cardFields` and `findFieldFocused` straight away. On the second, `focusOutside()` then `openSearch()`; record the same three. The two records are equal (`toEqual`).
- **M3 — re-seeds while open.** After M1's steps, select 0–5 (`alpha`) and call `openSearch()`. Returns `true`; `cardFields(editor).search` is `alpha`; `findFieldFocused` is `true`.
- **M4 — keeps the query on a collapsed caret, and re-focuses.** After M1's steps, set the caret at 0, call `focusOutside()`, then `openSearch()`. `cardFields(editor).search` is still `beta`; `findFieldFocused` is `true`.
- **M5 — reopens after a close.** After M1's steps, close the card with `(editor as any).runSearchCommand('close')` (`cardShown` becomes `false`), set the caret at 0, call `openSearch()`. Returns `true`; `cardShown` is `true`; `cardFields(editor).search` is `beta`.
- **M6 — twice equals once.** Select 6–10, `focusOutside()`, call `openSearch()` twice. Both return `true`, and `cardShown`, `cardFields` and `findFieldFocused` equal what one call produces (`beta`, focused). This is the case of an app-wide `Ctrl+F` handler and the editor's own binding both running for one key press.
- **M7 — disposed after mount.** Mount, `editor.dispose()`, then `openSearch()` returns `false` and does not throw. Leave the editor in `editors`: the `afterEach`'s second `dispose()` is a documented no-op.

### Manual (real browser)

The offline harness cannot exercise focus or a live view; jsdom covers focus and the live view but not real keyboard input or layout. Check by hand in the demo app's **CodeEditor** section (see *Verification*):

- Click **Find** with text selected in the top editor: the card appears in the editor's upper-right corner, the find field holds the selection, and typing goes into the find field.
- Click **Find** again after clicking elsewhere in the toolbar: focus returns to the find field.
- `Ctrl-F` in the document still opens the card, with no browser find bar.

---

## Verification

From the repo root unless noted:

- `npm run typecheck` and `npm run lint` — clean.
- `npm -w packages/lib test` — the full suite, including S1–S3, M1–M7 and the unchanged K1–K4 keymap tests.
- `grep -n "openSearch(" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` — exactly two lines, neither passing an argument.
- `npm run docs:api` — 0 warnings (the new JSDoc links only to public members).
- Manual: start the demo app from the worktree with `npx vite --port 8016` (run in `packages/lib`; `npm run dev` is the same `vite` command on the default port 8015), and open the **CodeEditor** section. The worktree needs `node_modules` symlinked from the main tree first, or the browser loads the main tree's library. A dev server may already be running on port 8015 for another tree: start a second one instead of stopping it, and never use `pkill`. Run the three manual checks from *Expected Behaviour*.

---

## Documentation Impact

`CodeEditor` is already exported from `@jimka/typescript-ui/component/editor`, and `llms.txt` needs no change: a method added to a catalogued component keeps its manifest row.

**`packages/lib/docs/components/CodeEditor.md`, *Search and replace*** — insert after the first paragraph:

````markdown
To open the card from outside the editor — an Edit › Find… menu item, a command-palette entry, or an app-wide shortcut that targets the active editor while focus is in another control — call `openSearch()`. It does what `Ctrl-F` does: it opens the card, seeds the find field from the selection, and moves focus to the find field. Called while the card is already open, it re-seeds and re-focuses the find field. Before the editor has mounted (it mounts on its first sized layout) and after `dispose()`, it does nothing and returns `false`.

```typescript
findButton.on('action', () => { editor.openSearch(); });
```
````

**Same page, *Common methods* table** — new row after `revealRange(at, options?)`:

```markdown
| `openSearch()` | Open the [search card](#search-and-replace) as `Ctrl-F` does: seed the find field from the selection and focus it. Returns `true`, or `false` with no effect before the editor is mounted. |
```

**`packages/lib/docs/reference/changelog/next.md`** — append:

```markdown
## Added

### Components

- **`CodeEditor.openSearch()` opens the search card from code.** It does
  what `Ctrl-F` (`Cmd-F` on macOS) does in the document: it opens the
  floating search card, seeds the find field from the selection and moves
  focus to it, re-focusing the field when the card is already open. It is
  for a Find… menu item, a command-palette entry or an app-wide shortcut
  that targets an editor while focus is elsewhere. Before the editor has
  mounted its view it does nothing and returns `false`. See
  [Search and replace](/components/CodeEditor#search-and-replace).
```

`packages/lib/docs/reference/migration/next.md` is not touched.

---

## Potential Challenges

- **CodeMirror's re-open path needs a live view.** With the card already open, `openSearchPanel` looks up CodeMirror's own (hidden) panel through `view.plugin(...)`, which a duck-typed fake view does not have. Mitigation: every case that opens the card is in the jsdom file, never in `code-editor.test.ts`.
- **A test left with a mounted view logs a jsdom `TypeError` after it ends.** CodeMirror's measure frame calls `Range.getClientRects`. Mitigation: the copied `beforeEach` stubs both `Range` methods, and the `afterEach` disposes every editor.
- **`npm run docs:api` warns on a stale `{@link}`.** Mitigation: replace the old JSDoc wholesale with the text in *Public API*, which links only to `CodeEditor.focus`, `CodeEditor.revealRange` and `CodeEditor.paste`.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/editor/CodeEditor.ts](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts) — the private `openSearch` / `closeSearch` / `runSearchCommand` / `setSearchPanelOpen` / `syncSearchPanelFields` group (:2093-2234), the keymap and update listener in `mount()` (:2338-2444), and the precedent view methods `focus`, `moveCursorToEnd`, `revealRange`, `copy`, `paste` (:1382-1656).
- [packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts](packages/lib/src/typescript/lib/component/editor/CodeEditorSearchPanel.ts) — `buildControls` (:168) builds both rows unconditionally; `focusFind` (:329).
- [packages/lib/tests/component/code-editor-read-only-mounted.test.ts](packages/lib/tests/component/code-editor-read-only-mounted.test.ts) — the jsdom harness to copy (:1-98).
- [packages/lib/tests/component/code-editor.test.ts](packages/lib/tests/component/code-editor.test.ts) — `mountOffline` (:2013), the keymap-order tests (:3340-3400), the floating-search describe (:6511).
- [packages/lib/src/typescript/CodeEditorPanel.ts](packages/lib/src/typescript/CodeEditorPanel.ts) — the demo toolbar (:168-222).
- `node_modules/@codemirror/search/dist/index.js` (6.7.1) — `openSearchPanel` (:1001), `defaultQuery` (:974), `searchKeymap` (:1043).

---

## Non-Goals

- **`closeSearch()`.** `Escape` in the document or either field, and the card's Close button, already close it; no stated use closes it from outside.[^only-open]
- **`isSearchOpen()`.** None of the three stated uses branches on whether the card is open, because `openSearch()` handles both states.[^only-open]
- **`openReplace()`.** The card has no separate replace mode: both rows are always shown, and there is no `Mod-h` binding to mirror.[^only-open]
- **`Ctrl-F` while focus is inside the card's own fields.** The fields are outside CodeMirror, so the editor's binding does not see that key; this plan does not add one. An app-wide handler that calls `openSearch()` covers it.
- **`MarkdownEditor`'s source mode.** It wraps a private `CodeEditor`; exposing search there is a separate decision.
- **Queuing a call made before mount.** See the decision above.[^no-queue]

---

## Notes

[^one-path]: Making the existing method public is the smallest change that gives the key and the public call one path. A public wrapper around the private method would also share the logic but adds a second name for the same thing. Dropping the `view` parameter is safe: the binding is installed only in this editor's own view, so the `view` CodeMirror passes to `run` is always `this._view`. A key press cannot reach the binding before `this._view` is assigned, because the assignment in `mount()` happens as soon as `new EditorView(...)` returns, before any DOM event can be dispatched to it. The `boolean` return is what a CodeMirror `run` command must return, so the binding can pass the result straight through.

[^no-queue]: Queuing was rejected for three reasons. First, precedent: the codebase splits `CodeEditor`'s pre-mount behaviour cleanly. Configuration (`setReadOnly`, `setLineWrap`, `setPlaceholder`, `setLanguage`, …) is cached in `_options` and read by `mount()`. Actions on the view (`focus`, `moveCursorToEnd`, `revealRange`, `copy`, `cut`, `paste`) do nothing before mount, and `paste()` reports that through its `false` result. `openSearch()` is an action. Second, a queued call would move focus at an unpredictable later moment — for example when a hidden tab holding the editor is first shown — taking focus away from wherever the user is. Third, the stated uses all target an editor the user can see, which has been laid out and so is mounted; an editor that is not mounted yet has no document worth searching. Returning `false` lets the caller decide what to do instead, such as not calling `preventDefault()` on its own shortcut.

[^boolean]: `ComboBox.openDropdown()` and `MenuBar.openMenu()` return `this` because they cannot fail once the component exists. `openSearch()` can fail (no mounted view), and the caller may want to know — an app-wide `Ctrl+F` handler can leave the key alone when no editor opened its card. `paste()` in the same class already reports a missing view through a `boolean` (inside a `Promise`). The request also asked for this shape, and the key binding needs a `boolean` to tell CodeMirror whether it consumed the key.

[^only-open]: Searched: open/close/`isOpen` methods on components that own a popup. `Drawer` exposes `open()`, `close()` and `isOpen()`, and `Popover` and `AnimatedDropdown` expose `isOpen()`, because their callers toggle or dismiss them. `ComboBox` exposes only `openDropdown()`, because its caller (a table cell editor) only needs to open it; that matches this request, whose three uses (an Edit menu item, a command-palette entry, an app-wide `Ctrl+F`) all only open. `openSearch()` already does the right thing whether the card is open or closed, so no caller needs `isSearchOpen()` to decide. For `openReplace()`: `CodeEditorSearchPanel.buildControls()` (CodeEditorSearchPanel.ts:168-259) adds the find row and the replace row unconditionally, with no toggle between them, and neither `@codemirror/search`'s `searchKeymap` nor `CodeEditor`'s own keymap binds `Mod-h`, so there is no replace mode or key to mirror. If a later request needs `closeSearch()`, the private `closeSearch(view)` is changed the same way this plan changes `openSearch(view)`.

[^double-sync]: On a first open, `openSearchPanel` dispatches a transaction that opens CodeMirror's search state, and the update listener at CodeEditor.ts:2436 shows the card and copies the query into it. `openSearch()` then calls `setSearchPanelOpen(true)` and `syncSearchPanelFields` again, which is harmless: `buildControls()` does nothing after its first run and `setFields` does not emit `"querychange"`. On a re-open with a collapsed caret, `openSearchPanel` dispatches nothing at all (the comment at CodeEditor.ts:2354-2361 records this), so only the explicit calls reach the card and only `focusFind()` moves focus. The order is kept as it is today; this plan changes where the view comes from and nothing else in the body.

---

## Implementation Notes

- **Changelog staging page was not empty.** Step 6 says `next.md` "holds only its intro today, so both headings are new". This branch is stacked on `feature/tree-row-motion-no-snap`, which had already added a `## Changed › ### Components` entry. The `## Added › ### Components` block was appended after it, as the plan says ("append"), which also matches the released pages' order (Breaking changes, Changed, Added, Fixed).
- **Demo comment wraps to two lines.** Step 4 asks for a one-line comment above the `Find` button; the sentence it describes does not fit the line width, so it wraps onto a second comment line. Wording unchanged in substance.
