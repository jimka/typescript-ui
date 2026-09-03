# CodeEditor

[`CodeEditor`](/api/component/editor/classes/CodeEditor) wraps [CodeMirror 6](https://codemirror.net/) to provide syntax highlighting and one-command formatting — explicitly *no* IntelliSense, no TypeScript language service, no virtual file system.

`CodeEditor` is a **live-only** component, the same category as [`Canvas`](/components/Canvas): CodeMirror's `EditorView` takes a real DOM element and mutates a whole region of it directly, so under the framework's offline test seam the editor mounts nothing and every operation (`format()`, `setLanguage()`, …) no-ops. In a real browser it mounts once the component is connected and sized, fills its assigned box, and scrolls internally.

Wheel scrolling inside the editor is driven by the framework's eased scroller, the same glide every other scrolling surface uses — `CodeEditor` points the framework's scroll plumbing at CodeMirror's own viewport rather than at its outer box. The scrollbars themselves are still the browser's native ones: the custom overlay [`Scrollbar`](/components/Scrollbar) is a [`Panel`](/api/core/classes/Panel) feature and does not reach a foreign widget's internal scroller.

Highlighting grammars and formatters load lazily, per language, through `import()` — the base editor stays small and Prettier's much larger standalone bundle is only ever fetched behind a `format()` call.

## Usage

```typescript
import { CodeEditor } from '@jimka/typescript-ui/component/editor';
import { Fit } from '@jimka/typescript-ui/layout';

const host = new Panel({ layoutManager: new Fit() });
const editor = new CodeEditor('const x = 1;', { language: 'javascript' });

host.addComponent(editor);
await editor.format();
```

`codemirror`, the `@codemirror/*` packages, `prettier`, and `sql-formatter` are runtime dependencies of the library, installed transitively when you install `@jimka/typescript-ui` — the same as `marked` for [`Markdown`](/components/Markdown).

Give the editor a sized host (a `Fit` panel, as above, or an explicit `preferredSize`) — it reports no content-derived size of its own and relies on its parent to size it, exactly like `Canvas`.

## Construction

`CodeEditor(value?, options?)` — the initial document `value` is an optional positional argument (equivalent to the `value` option).

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `value` | `string` | `""` | Initial document text. |
| `language` | `string` | unset | A registered language id (e.g. `"javascript"`, `"sql"`). Unset renders plain text with no grammar. |
| `readOnly` | `boolean` | `false` | Whether the editor rejects edits. |
| `autoHeightMaxRows` | `number` | unset | Row count the editor grows to fit before its own vertical scrollbar takes over. Unset: today's fixed-height, fill-parent behaviour, controlled via `setHeight`/`preferredSize`. |
| `listeners` | `{ change?: (payload) => void }` | — | Construction-time listener bag for the `"change"` event. |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Built-in languages

The library registers five languages out of the box, each with a grammar and a formatter:

| id | Grammar | Formatter |
| --- | --- | --- |
| `javascript` | `@codemirror/lang-javascript` (TypeScript-aware) | Prettier (`babel-ts` parser) |
| `json` | `@codemirror/lang-json` | Prettier (`json` parser) |
| `html` | `@codemirror/lang-html` | Prettier (`html` parser) |
| `sql` | `@codemirror/lang-sql` | `sql-formatter` |
| `markdown` | `@codemirror/lang-markdown` | Prettier (`markdown` parser) |

Both the grammar and the formatter load through a dynamic `import()` the first time they're needed — selecting a language fetches only its grammar; calling `format()` additionally fetches that language's formatter (and, for the four Prettier-backed languages, the shared Prettier standalone bundle, fetched once and reused across them).

### Registering a language

Register a new language with `registerLanguage` before constructing an editor that uses it:

```typescript
import { registerLanguage } from '@jimka/typescript-ui/component/editor';

registerLanguage({
    id: 'python',
    label: 'Python',
    loadExtension: async () => {
        const { python } = await import('@codemirror/lang-python');
        return python();
    },
    // loadFormatter is optional — omit it and format() falls back to re-indenting.
});
```

`getLanguage(id)` looks up a registration; `listLanguages()` lists every registered definition.

## `format()` semantics

`editor.format()` returns a `Promise<void>`:

- If the active language has a formatter, it is invoked with the current document text. On success, the whole document is replaced in one transaction and the cursor is preserved (mapped by Prettier's `formatWithCursor`, or clamped to the new document length for `sql-formatter`, which has no cursor map).
- If the formatter's result matches the document already held, it is left **completely untouched** — no transaction, so no re-render, no undo entry, and no `"change"` event for a save that had nothing to reformat.
- When the result does change the document, the editor's visible area no longer unconditionally jumps to the top. It stays exactly in place when nothing above it changed length, which is the common case for an incremental edit-then-save, and can otherwise shift — by roughly however much text the formatter added or removed above it, never all the way back to the top — when a reformat changes text throughout the document, e.g. a first-time format of a wholly unformatted file.
- If the formatter **throws** (invalid syntax), the promise **rejects** and the document is left **completely untouched** — formatting never loses content.
- If the active language has no formatter (or none is set), `format()` re-indents the whole document using CodeMirror's own indentation service instead.

## Dirty state

The editor reports itself dirty, via the framework's [`Component.isDirty()`](/api/core/classes/Component) mechanism, whenever its document differs from the text at the last clean point — the text it was constructed with, or the text `markClean()` last accepted. Typing, paste, `format()`, and `setValue()` all go through the same check, so an edit undone back to the clean text clears the flag on its own. `isDirty()` folds up into every ancestor container automatically. A host that loads a document with `setValue()` should follow it with `markClean()`, so the loaded text becomes the clean text.

## Keyboard

The editor uses CodeMirror's default keymap plus its history bindings, with one
addition: **Tab indents** and **Shift-Tab dedents**.

That binding traps Tab inside the editor, so Tab no longer moves focus to the
next control while the caret is in the document. To move focus out, press
**Ctrl-m** (**Alt-Shift-m** on macOS) to toggle CodeMirror's tab-focus mode;
Tab then moves focus again, and the same shortcut switches back to indenting.

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(value)` | Read or replace the whole document. |
| `getLanguage()` / `setLanguage(id)` | Read or swap the active language (grammar loads lazily). |
| `getReadOnly()` / `setReadOnly(readOnly)` | Read or toggle whether the editor accepts edits. |
| `format()` | Format the document (or re-indent, with no formatter). |
| `on('change', fn)` / `off('change', fn)` | Subscribe to document changes. |
| `getAutoHeightMaxRows()` | Read the configured `autoHeightMaxRows`, or `null` when unset. |
| `on('heightchange', fn)` / `off('heightchange', fn)` | Subscribe to the editor's own auto-height changes (only fires when `autoHeightMaxRows` is set). |
| `dispose()` | Detach the theme-change listener and destroy the live CodeMirror view — call before discarding a dynamically-built `CodeEditor`. |
| `markClean()` | Clear the dirty flag, accepting the current document as the clean baseline. |

## Theming

The editor's chrome (background, gutters, cursor, selection) reads the project's CSS custom-property tokens directly, so a [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) toggle recolours it immediately with no rebuild. Syntax colours come from a fixed, IDE-conventional palette (there is no per-token-kind theme token in the framework).

## See also

- [API: CodeEditor](/api/component/editor/classes/CodeEditor)
- [`Markdown`](/components/Markdown) — another third-party-library-backed display component.
- [`Canvas`](/components/Canvas) — the live-only pattern `CodeEditor` follows.
