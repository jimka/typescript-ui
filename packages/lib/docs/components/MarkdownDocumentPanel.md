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

Every entry calls straight through to the matching method on the owned `MarkdownEditor` — see [MarkdownEditor › Command API](/components/MarkdownEditor#command-api) for what each one does, including which commands no-op (without throwing) outside a table cell. The Insert dropdown stays enabled, and dims each entry whose command would decline at the selection: the block conversions (Quote, Code block and the two lists) with no selection or in a table cell, Table and Image… in a raw Markdown block or a code block, and Table also in a table cell. With no selection Table and Image… go in at the document's end, so they are dimmed when the document ends in a block that declines them. A selection that runs from outside a table into one of its cells does not dim Table: `insertTable` removes that selection first, its table included.

The toolbar itself is live, reflecting [MarkdownEditor › Live selection state](/components/MarkdownEditor#live-selection-state): the five format buttons are `ToggleButton`s that press and release as the caret's bold/italic/underline/strikethrough/code state changes, and they are disabled (via `Button.setEnabled`) where `canFormat` is `false` — before the editor has a selection, in a raw Markdown block or a code block, or over text kept as Markdown source; the Text style dropdown is disabled where `canStyle` is `false` — the same places, and also inside a link and while table cells are selected; the Alignment and Columns dropdowns are disabled where `canSetBlockLayout` is `false` — with no selection, while table cells are selected, and on the source surface; the Link button is enabled (via the same mechanism) where one of its popup's two actions would apply — `canLink` (text or an image to link, or a link to re-point), or `canRemoveLink` — and the popup's own **Insert link** / **Update link** and **Remove link** buttons are disabled one by one the same way, so in an autolink nested in another link, where both commands decline, the button itself is disabled; the Table button is enabled where one of its entries would apply — `canEditTable`, with the caret in a table cell, `canMergeCells`, with more than one cell selected, or `canUnmergeCell` — and its dropdown dims each entry on its own field: with a caret in a cell everything but Merge cells applies (Unmerge cell only in a merged cell), and with cells selected Merge cells alone; in a read-only editor (`getEditor().setReadOnly(true)`), which refuses every editing command, all of these controls are disabled and every Insert entry is dimmed — the fields they read are all `false` then, so there is no second rule for read-only; and the Alignment, Columns, and Table dropdowns show a checkmark on whichever value currently applies (an alignment/column-count/column-alignment fully outside their tracked range — e.g. a column count above 4 — leaves every entry unchecked).

After the **Edit Markdown source** toggle, the format toggles, Link, the Insert dropdown's Quote/Code block/Bulleted list/Numbered list/Table/Image… entries, and the clipboard entries keep working, writing the markers straight into the raw text (see [MarkdownEditor › Command API](/components/MarkdownEditor#command-api) for which commands do this). The Text style dropdown keeps working too, writing the dialect's `[text]{…}` styled span into the raw text instead of styling a rich-text node. The Table, Alignment, and Columns commands are no-ops there, so all three dropdowns are greyed out: the editor reports the three table fields and `canSetBlockLayout` as `false`, the same disabled state the Table button already gets outside a table cell in WYSIWYG mode.

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
