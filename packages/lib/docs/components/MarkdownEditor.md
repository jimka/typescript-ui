# MarkdownEditor

[`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor) is a **WYSIWYG rich-text editor whose public value is a Markdown string**, built on [Lexical](https://lexical.dev/). You edit a document as rendered rich text — no visible markup — and read or write it as Markdown through `getValue()` / `setValue()`. It is the editing counterpart to the read-only [`Markdown`](/components/Markdown) viewer.

Its dialect is deliberately the **exact subset the viewer renders** — headings, paragraphs, bold, italic, inline code, ordered/unordered lists, blockquotes, fenced code, links, and GFM pipe tables (with per-column alignment). A curated transformer list (not Lexical's full preset) guarantees the editor can never emit Markdown the viewer would drop to plain text, so **a document produced by the editor renders identically in the viewer**.

Lexical's editing view is a `contenteditable` element it owns and mutates directly — a *foreign live widget*, like the CodeMirror view behind [`CodeEditor`](/components/CodeEditor) — so the view mounts through the framework's DOM seam once the component is connected and sized. Unlike a code editor, Lexical keeps its editor **state** (a pure, DOM-free tree) separate from that view, so the Markdown value get/set/round-trip runs headless: offline the view never attaches, yet `getValue` / `setValue` and the command API still operate on the state.

## Usage

```typescript
import { MarkdownEditor } from '@jimka/typescript-ui/component/editor';
import { Fit } from '@jimka/typescript-ui/layout';

const host = new Panel({ layoutManager: new Fit() });
const editor = new MarkdownEditor('# Title\n\nSome **bold** text.');

host.addComponent(editor);
editor.on('change', ({ value }) => console.log(value)); // value is Markdown
```

`lexical` and the `@lexical/*` packages are runtime dependencies of the library, installed transitively when you install `@jimka/typescript-ui` — the same as `marked` for [`Markdown`](/components/Markdown). A consumer who never imports `@jimka/typescript-ui/component/editor` never bundles Lexical.

Give the editor a sized host (a `Fit` panel, as above, or an explicit `preferredSize`) — it fills its assigned box and scrolls internally, exactly like `CodeEditor`.

## Construction

`MarkdownEditor(value?, options?)` — the initial Markdown `value` is an optional positional argument (equivalent to the `value` option).

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `value` | `string` | `""` | Initial Markdown source. |
| `readOnly` | `boolean` | `false` | Whether the editor rejects edits. |
| `mode` | `"wysiwyg" \| "source"` | `"wysiwyg"` | Which editing surface is shown — see [Source / WYSIWYG mode](#source-wysiwyg-mode). |
| `listeners` | `{ change?: (payload) => void }` | — | Construction-time listener bag for the `"change"` event. |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Supported constructs

The editor edits, and emits, only the constructs the [`Markdown`](/components/Markdown) viewer renders:

| Construct | Markdown emitted |
| --- | --- |
| Heading | `# ` … `###### ` |
| Paragraph | plain text |
| Bold | `**bold**` |
| Italic | `*italic*` |
| Inline code | `` `code` `` |
| Unordered list | `- ` |
| Ordered list | `1. ` |
| Blockquote | `> ` |
| Fenced code | ` ``` ` fence |
| Strikethrough | `~~struck~~` |
| Link | `[text](url)` |
| Table | pipe rows plus a `\| --- \|` delimiter row |

Images, task lists, thematic breaks (`hr`), and raw HTML are **not** part of the dialect — they are excluded so the editor's output always round-trips cleanly through the viewer. A column's alignment (from the delimiter row's `:---` / `:---:` / `---:` markers) is **preserved** across a load/edit/save round-trip but is **not authorable** in the WYSIWYG surface — there is no command to change it; switch to source mode and edit the delimiter row directly.

## Formatting

There is no built-in toolbar in v1. Formatting is invoked four ways, all provided by Lexical (the right-click menu is this component's own addition):

- **Markdown-shortcut typing** — `# ` → heading, `**b**` → bold, `- ` → bullet, `1. ` → numbered, `> ` → quote, ` ``` ` → code block, auto-applied as you type.
- **Keyboard shortcuts** — `Ctrl/Cmd+B` (bold), `Ctrl/Cmd+I` (italic), `Ctrl/Cmd+Z` / `+Y` (undo/redo).
- **Command API** — thin imperative methods you can wire to your own [`Button`](/components/Button)s to build a toolbar.
- **Right-click context menu** — a self-wired menu on the WYSIWYG surface whose contents depend on what was clicked: a word or selection gets inline-format and block-style commands; an empty line gets block-insert commands; a table cell gets the same inline-format commands (no block style — a cell holds inline text only) plus Insert/Delete submenus for its row, column, and the whole table. A collapsed right-click inside a word first expands the selection to that whole word, so a format toggle applies to it. No consumer wiring needed — right-clicking the surface shows it directly.

### Command API

| Method | Effect on the current selection |
| --- | --- |
| `toggleBold()` / `toggleItalic()` / `toggleInlineCode()` / `toggleStrikethrough()` | Toggle the inline format. |
| `clearFormatting()` | Clear every inline text format (bold, italic, strikethrough, inline code, …), leaving plain text. Block type is untouched. |
| `toggleUnorderedList()` / `toggleOrderedList()` | Convert the selected blocks into (or out of) a list. |
| `toggleLink(url)` | Wrap the selection in a link, or unwrap it when `url` is `null`. |
| `setBlockType(type)` | Convert the selected blocks to `"paragraph"`, `"h1"`–`"h6"`, `"quote"`, or `"code"`. |
| `insertTable(rows, columns)` | Insert a table at the caret; the first row is the header row. |
| `insertTableRow(after?)` / `deleteTableRow()` | Insert a row after (default) or before the current row, or delete it. |
| `insertTableColumn(after?)` / `deleteTableColumn()` | Insert a column after (default) or before the current column, or delete it. |
| `deleteTable()` | Delete the entire table containing the caret, including every row and cell. |

Each command operates on the current selection and no-ops (without throwing) when there is no selection. The row/column/table commands additionally no-op when the caret is not inside a table cell.

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(value)` | Read or replace the whole document as a Markdown string. |
| `getMode()` / `setMode(mode)` | Read or switch the editing surface — see [Source / WYSIWYG mode](#source-wysiwyg-mode). |
| `getReadOnly()` / `setReadOnly(readOnly)` | Read or toggle whether the editor accepts edits. |
| `on('change', fn)` / `off('change', fn)` | Subscribe to content changes (the payload carries the new Markdown). |
| `dispose()` | Detach the Lexical registrations and the editor root — call before discarding a dynamically-built `MarkdownEditor`. |
| `markClean()` | Clear the dirty flag, accepting the current document as the clean baseline. |

## Source / WYSIWYG mode

The editor has two surfaces, selected by its `mode`:

- `"wysiwyg"` (default) — the Lexical rich-text surface described above.
- `"source"` — a raw-Markdown [`CodeEditor`](/components/CodeEditor), for editing the Markdown text directly.

Both surfaces are bound to the **same Markdown value**, so `getValue()` / `setValue()` and the `"change"` event behave identically whichever mode is active, and switching modes **preserves the document** (the text is converted across on each switch). `setReadOnly` applies to both surfaces.

```typescript
const editor = new MarkdownEditor('# Title', { mode: 'source' });

editor.getMode();            // "source"
editor.setMode('wysiwyg');   // convert the source text into rich text and show it
editor.getValue();           // same Markdown, regardless of the active mode
```

Like the [command API](#command-api), the mode toggle is **consumer-wired** — the editor ships no built-in chrome. Drive `setMode` from your own control (e.g. a [`ToggleButton`](/components/ToggleButton)) when you want to expose the switch to users.

## Dirty state

The editor reports itself dirty, via [`Component.isDirty()`](/api/core/classes/Component), whenever `getValue()` differs from the Markdown at the last clean point — the clean point is the value it was constructed with, or the value `markClean()` last accepted. Both surfaces go through the same check, so an edit undone back to the clean text clears the flag on its own, and a mode switch that changes nothing textually does not set it. `isDirty()` folds up into every ancestor container automatically. A host that loads a document with `setValue()` should follow it with `markClean()`, so the loaded text becomes the clean text.

One corner case: because the editor emits its own canonical Markdown, a `markClean()` taken in source mode over text that is not in that canonical form marks the editor dirty on the next switch to WYSIWYG — the value the host would save really did change.

## Read-only

`setReadOnly(true)` locks the editor against edits (dropping the caret and editing affordances); `false` restores them. For a purely *display* use case, prefer the leaner [`Markdown`](/components/Markdown) viewer, which needs no Lexical — `MarkdownEditor`'s read-only mode is for temporarily locking an editor, not for replacing the viewer.

## Theming

The editing surface's class rules reference the same CSS custom-property tokens the viewer uses (`--ts-ui-font-mono` for code, `--ts-ui-border-color` for the quote bar, `--ts-ui-indicator-focus` for links), so a [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) toggle recolours it immediately with no rebuild, and the edited rich text visually matches what the viewer renders.

## See also

- [API: MarkdownEditor](/api/component/editor/classes/MarkdownEditor)
- [`Markdown`](/components/Markdown) — the read-only viewer this editor is the counterpart to.
- [`CodeEditor`](/components/CodeEditor) — the sibling foreign-live-widget editor in the same package.
