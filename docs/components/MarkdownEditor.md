# MarkdownEditor

[`MarkdownEditor`](/api/component/editor/classes/MarkdownEditor) is a **WYSIWYG rich-text editor whose public value is a Markdown string**, built on [Lexical](https://lexical.dev/). You edit a document as rendered rich text — no visible markup — and read or write it as Markdown through `getValue()` / `setValue()`. It is the editing counterpart to the read-only [`Markdown`](/components/Markdown) viewer.

Its dialect is deliberately the **exact subset the viewer renders** — headings, paragraphs, bold, italic, inline code, ordered/unordered lists, blockquotes, fenced code, and links. A curated transformer list (not Lexical's full preset) guarantees the editor can never emit Markdown the viewer would drop to plain text, so **a document produced by the editor renders identically in the viewer**.

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
| Link | `[text](url)` |

Tables, images, strikethrough, task lists, thematic breaks (`hr`), and raw HTML are **not** part of the dialect — they are excluded so the editor's output always round-trips cleanly through the viewer.

## Formatting

There is no built-in toolbar in v1. Formatting is invoked three ways, all provided by Lexical:

- **Markdown-shortcut typing** — `# ` → heading, `**b**` → bold, `- ` → bullet, `1. ` → numbered, `> ` → quote, ` ``` ` → code block, auto-applied as you type.
- **Keyboard shortcuts** — <kbd>Ctrl/Cmd+B</kbd> (bold), <kbd>Ctrl/Cmd+I</kbd> (italic), <kbd>Ctrl/Cmd+Z</kbd> / <kbd>+Y</kbd> (undo/redo).
- **Command API** — thin imperative methods you can wire to your own [`Button`](/components/Button)s to build a toolbar.

### Command API

| Method | Effect on the current selection |
| --- | --- |
| `toggleBold()` / `toggleItalic()` / `toggleInlineCode()` | Toggle the inline format. |
| `toggleUnorderedList()` / `toggleOrderedList()` | Convert the selected blocks into (or out of) a list. |
| `toggleLink(url)` | Wrap the selection in a link, or unwrap it when `url` is `null`. |
| `setBlockType(type)` | Convert the selected blocks to `"paragraph"`, `"h1"`–`"h6"`, `"quote"`, or `"code"`. |

Each command operates on the current selection and no-ops (without throwing) when there is no selection.

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(value)` | Read or replace the whole document as a Markdown string. |
| `getReadOnly()` / `setReadOnly(readOnly)` | Read or toggle whether the editor accepts edits. |
| `on('change', fn)` / `off('change', fn)` | Subscribe to content changes (the payload carries the new Markdown). |
| `dispose()` | Detach the Lexical registrations and the editor root — call before discarding a dynamically-built `MarkdownEditor`. |

## Read-only

`setReadOnly(true)` locks the editor against edits (dropping the caret and editing affordances); `false` restores them. For a purely *display* use case, prefer the leaner [`Markdown`](/components/Markdown) viewer, which needs no Lexical — `MarkdownEditor`'s read-only mode is for temporarily locking an editor, not for replacing the viewer.

## Theming

The editing surface's class rules reference the same CSS custom-property tokens the viewer uses (`--ts-ui-font-mono` for code, `--ts-ui-border-color` for the quote bar, `--ts-ui-indicator-focus` for links), so a [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) toggle recolours it immediately with no rebuild, and the edited rich text visually matches what the viewer renders.

## See also

- [API: MarkdownEditor](/api/component/editor/classes/MarkdownEditor)
- [`Markdown`](/components/Markdown) — the read-only viewer this editor is the counterpart to.
- [`CodeEditor`](/components/CodeEditor) — the sibling foreign-live-widget editor in the same package.
