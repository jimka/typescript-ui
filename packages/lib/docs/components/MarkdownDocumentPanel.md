# MarkdownDocumentPanel

[`MarkdownDocumentPanel`](/api/component/editor/classes/MarkdownDocumentPanel) is a composite that combines a [`MarkdownEditor`](/components/MarkdownEditor) with a built-in glyph-only toolbar. The toolbar is docked to the north region; the editor fills the centre — the same "toolbar + content, both owned" shape [`TablePanel`](/components/TablePanel) uses for `Table`.

This is the convenience component for the common case where you want a Markdown editor with ready-made formatting controls, rather than wiring your own buttons to `MarkdownEditor`'s command API.

## Usage

```typescript
import { MarkdownDocumentPanel } from '@jimka/typescript-ui/component/editor';

const panel = new MarkdownDocumentPanel({ value: '# Title\n\nSome **bold** text.' });

container.addComponent(panel);
panel.on('change', ({ value }) => console.log(value)); // value is Markdown
```

## Toolbar

The toolbar groups its buttons the same way `MarkdownEditor`'s own right-click context menu is grouped:

| Group | Toolbar entry |
| --- | --- |
| Format toggles | Five buttons: Bold, Italic, Underline, Strikethrough, Code |
| Link | Popup: a URL field with Insert/Update, plus Remove while editing an existing link |
| Insert | Dropdown: Quote, Code block, Bulleted list, Numbered list, Table, Image… |
| Table | Dropdown: Insert (row/column), Delete (row/column/table), Merge cells, Unmerge cell, Column width…, Align column |
| Text style | Dropdown: Colour, Font, Size sub-submenus |
| Alignment | Dropdown: Left, Center, Right, Justify, Default |
| Columns | Dropdown: 2/3/4 columns, None |
| Edit Markdown source | Toggle pinned to the toolbar's far right, switching `getEditor()`'s mode |

Every entry calls straight through to the matching method on the owned `MarkdownEditor` — see [MarkdownEditor › Command API](/components/MarkdownEditor#command-api) for what each one does, including which commands no-op (without throwing) outside a table cell. The Insert, Text style, Alignment, and Columns dropdowns stay always-enabled and no-op-safe: an entry is simply a no-op when the caret isn't where the command needs it to be.

The toolbar itself is live, reflecting [MarkdownEditor › Live selection state](/components/MarkdownEditor#live-selection-state): the five format buttons are `ToggleButton`s that press and release as the caret's bold/italic/underline/strikethrough/code state changes; the Link button is enabled (via `Button.setEnabled`) with a text selection or while the caret is inside a link; the Table button is disabled (via the same mechanism) except while the caret is inside a table, since every one of its entries would otherwise no-op; and the Alignment, Columns, and Table dropdowns show a checkmark on whichever value currently applies (an alignment/column-count/column-alignment fully outside their tracked range — e.g. a column count above 4 — leaves every entry unchecked).

## Delegated methods and events

`MarkdownDocumentPanel` forwards the document-editing surface straight to the owned `MarkdownEditor`:

```typescript
panel.getValue();               // reads the owned editor's Markdown
panel.setValue('# New title');  // writes it
panel.markClean();              // clears the owned editor's dirty flag
panel.on('change', listener);   // re-emitted whenever the owned editor's own "change" fires
```

`isDirty()` needs no delegation: [`Component`](/api/core/classes/Component)'s parent/child dirty relay already makes `panel.isDirty()` true whenever the docked `MarkdownEditor` is dirty.

## Escape hatch

Anything else `MarkdownEditor` exposes — `setMode`, `setReadOnly`, `toggleLink`, the full command API, and so on — is reached through the owned instance rather than re-declared a second time:

```typescript
panel.getEditor().setReadOnly(true);
panel.getEditor().toggleLink('https://example.com');
```

`getToolbar()` returns the owned [`ToolBar`](/components/ToolBar) itself, for reaching toolbar-level configuration (e.g. `setOverflow`) that this component doesn't re-expose.

## See also

- [API: MarkdownDocumentPanel](/api/component/editor/classes/MarkdownDocumentPanel)
- [`MarkdownEditor`](/components/MarkdownEditor) — the composed editor, including the full command API and its own right-click context menu
- [`TablePanel`](/components/TablePanel) — the same toolbar-`NORTH`/content-`CENTER` structural precedent, for a `Table` instead
- [`ToolBar`](/components/ToolBar) — the toolbar component `getToolbar()` returns
