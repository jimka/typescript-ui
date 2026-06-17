# SplitButton

[`SplitButton`](/api/component/button/classes/SplitButton) is a [`Button`](/components/Button) with a trailing dropdown chevron. The main button face fires the primary `"action"` event exactly like a plain `Button`; clicking the chevron zone instead opens a dropdown [`Menu`](/components/Menu) built from the button's `menuItems`.

## Usage

```typescript
import { SplitButton } from '@jimka/typescript-ui/component/button';

const save = new SplitButton('Save', {
    menuItems: [
        { text: 'Save As…', action: () => saveAs()  },
        { text: 'Save All', action: () => saveAll() },
    ],
});

save.on('action', () => save());
toolbar.addComponent(save);
```

Clicking **Save** fires `"action"`; clicking the chevron opens the dropdown, and selecting a row runs that item's `action`.

## Dropdown items

The dropdown is described by an array of [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig) — the same row descriptor used by [`Menu`](/components/Menu) context menus, so each item carries `text`, an optional `glyph` / `icon`, an `action` callback, and may be a `separator`. Replace the items at runtime with `setMenuItems(items)` and read them back with `getMenuItems()`.

```typescript
save.setMenuItems([
    { text: 'Save As…',  glyph: 'floppy-disk', action: () => saveAs() },
    { separator: true },
    { text: 'Export PDF', action: () => exportPdf() },
]);
```

The dropdown is a rebuild-mode [`Menu`](/components/Menu): it is created lazily on the first chevron click, reused across opens, anchored under the button's bottom-left corner, clamped to the viewport, and dismissed on outside click. The chevron rotates 180° to point up while the dropdown is open and animates back to point down when it closes.

## How the chevron click is distinguished

The chevron is a child [`Glyph`](/api/component/display/classes/Glyph) inside the button's single `<button>` element — the one-DOM-element-per-class rule still holds. It rides the content row beside the leading glyph and title. Button sets its content row to `pointer-events: none` so face clicks reach the `<button>`; the chevron re-enables `pointer-events` on itself and a **subtree listener** catches its click (which the SVG `<use>` retargets to an id-less inner element). The button face's `"action"`, by contrast, only matches an exact click on the `<button>` itself — so the dropdown click and the primary action route to different listeners without hit-testing pointer coordinates.

## In a flat toolbar

Adding a `SplitButton` to a flat [`ToolBar`](/components/ToolBar) flattens it like any other `Button` (`setFlat(true)` is applied automatically). The chevron is part of the content row, so it inherits the flat appearance — no extra wiring is needed.

## See also

- [API: SplitButton](/api/component/button/classes/SplitButton)
- [`Button`](/components/Button) — base class
- [`Menu`](/components/Menu) — the dropdown panel and its item descriptors
- [`ToolBar`](/components/ToolBar) — the classical flat toolbar
