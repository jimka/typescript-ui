# Components

Every UI element extends [`Component`](/api/classes/Component) — see the [mental model](/guide/mental-model) for the architectural foundation.

This page is a flat catalog. Per-component documentation lives in the [API reference](/api/) until dedicated pages land.

## Core

| Component | Purpose |
| --- | --- |
| [`Component`](/api/classes/Component) | Base class — position, size, styling, child tree |
| [`BaseObject`](/api/classes/BaseObject) | UUID-based identity above `Component` |
| [`Body`](/api/classes/Body) | Singleton wrapping `document.body`; bootstraps the framework |
| [`Window`](/api/classes/Window) | Floating, draggable, resizable window |
| [`Dialog`](/api/classes/Dialog) | Modal dialog with async result |
| [`Tooltip`](/api/classes/Tooltip) | Singleton hover hint, attach via `Tooltip.attach(component, text)` |
| [`Notification`](/api/classes/Notification) | Static toast — `Notification.show(message, type, duration?)` |

## Buttons

| Component | Purpose |
| --- | --- |
| [`Button`](/api/classes/Button) | Standard click button |
| [`ToggleButton`](/api/classes/ToggleButton) | Two-state press button |
| [`RadioButton`](/api/classes/RadioButton) | Single-selection radio (use with `ButtonGroup`) |
| [`ButtonGroup`](/api/classes/ButtonGroup) | Enforces single selection across radio / toggle buttons |
| [`SpinButton`](/api/classes/SpinButton) | Up / down arrow paired with a numeric field |
| [`TabCloseButton`](/api/classes/TabCloseButton) | Small `×` button for closeable tabs |

## Inputs

| Component | Purpose |
| --- | --- |
| [`TextField`](/api/classes/TextField) | Single-line text input |
| [`TextArea`](/api/classes/TextArea) | Multi-line text input |
| [`PasswordField`](/api/classes/PasswordField) | Masked text input |
| [`Checkbox`](/api/classes/Checkbox) | Boolean toggle |
| [`ComboBox`](/api/classes/ComboBox) | Drop-down selection from a list of [`Option`](/api/classes/Option) or a [`Store`](/api/classes/Store) |
| [`AutoCompleteField`](/api/classes/AutoCompleteField) | Text field with type-ahead suggestions |
| [`DateField`](/api/classes/DateField) | Date picker |
| [`TimeField`](/api/classes/TimeField) | Time picker |
| [`NumberSpinner`](/api/classes/NumberSpinner) | Number field with up / down spinner |
| [`Slider`](/api/classes/Slider) | Continuous-value slider |

## Display

| Component | Purpose |
| --- | --- |
| [`Text`](/api/classes/Text) | Standalone text — the default for status, captions, body |
| [`Label`](/api/classes/Label) | Text tied to a form control via the HTML `for` attribute |
| [`Header`](/api/classes/Header) | Title-bar / panel header text |
| [`Image`](/api/classes/Image) | `<img>` wrapper |
| [`FontAwesomeIcon`](/api/classes/FontAwesomeIcon) | FontAwesome glyph (peer dep) |
| [`FieldSet`](/api/classes/FieldSet) | Grouped form section with optional [`Legend`](/api/classes/Legend) |
| [`ProgressBar`](/components/ProgressBar) | Horizontal progress indicator (determinate or indeterminate) |
| [`ProgressSpinner`](/components/ProgressSpinner) | Circular loading spinner; supports inline and overlay use |
| [`PaginationBar`](/components/PaginationBar) | First / prev / next / last navigation for a paginated [`Store`](/api/classes/Store) |

## Lists

| Component | Purpose |
| --- | --- |
| [`List`](/api/classes/List) | Single-selection list |
| [`MultiSelectList`](/api/classes/MultiSelectList) | Multi-selection list |
| [`ListItem`](/api/classes/ListItem) | Item inside a `List` / `MultiSelectList` |
| [`BulletedList`](/api/classes/BulletedList) | `<ul>`-style bulleted list (style via [`BulletedListItemStyle`](/api/enumerations/BulletedListItemStyle)) |
| [`NumberedList`](/api/classes/NumberedList) | `<ol>`-style numbered list (style via [`NumberedListItemStyle`](/api/enumerations/NumberedListItemStyle)) |
| [`Option`](/api/classes/Option) | Item inside a [`ComboBox`](/api/classes/ComboBox) |

## Menus

| Component | Purpose |
| --- | --- |
| [`MenuBar`](/api/classes/MenuBar) | Top-of-window menu bar |
| [`MenuBarButton`](/api/classes/MenuBarButton) | A button that opens a menu panel |
| [`Menu`](/api/classes/Menu) | Floating menu — right-click context menu (`new Menu()`) or `MenuBar` dropdown (`new Menu(items, onClose)`) |
| [`MenuItem`](/api/classes/MenuItem) | Item inside a menu |
| [`MenuSeparator`](/api/classes/MenuSeparator) | Divider line in a menu |

## Table

A [`Table`](/api/classes/Table) ties columns to a [`Store`](/api/classes/Store) and renders rows via virtual scrolling. The body keeps only visible rows + a small buffer in the DOM at any time. Scrolling is delegated to a [`VirtualScroller`](/components/VirtualScroller) — `translate3d` positioning plus two custom [`Scrollbar`](/components/Scrollbar) overlays — with wheel, touch (fling momentum), and keyboard support.

| Component | Purpose |
| --- | --- |
| [`Table`](/api/classes/Table) | Top-level container; wires header, body, footer |
| [`TableHeader`](/api/classes/TableHeader) | Column-header strip |
| [`TableBody`](/api/classes/TableBody) | Virtual-scrolling row container |
| [`TableFooter`](/api/classes/TableFooter) | Optional summary / footer strip |
| [`TableRow`](/api/classes/TableRow) | Row component (recycled by `TableBody`) |
| [`TableColumn`](/api/classes/TableColumn) | Per-column metadata (width, header, hidden state) |
| [`Cell`](/api/classes/Cell) | Cell base class |
| [`BooleanCell`](/api/classes/BooleanCell), [`NumberCell`](/api/classes/NumberCell), [`StringCell`](/api/classes/StringCell), [`HeaderCell`](/api/classes/HeaderCell) | Built-in cell types |
| [`CellEditor`](/api/classes/CellEditor), [`BooleanEditor`](/api/classes/BooleanEditor), [`NumberEditor`](/api/classes/NumberEditor), [`StringEditor`](/api/classes/StringEditor) | Inline editors per cell type |
| [`CellRenderer`](/api/classes/CellRenderer), [`NumberRenderer`](/api/classes/NumberRenderer), [`StringRenderer`](/api/classes/StringRenderer) | Display renderers per cell type |

## Tree

| Component | Purpose |
| --- | --- |
| [`Tree`](/api/classes/Tree) | Hierarchical view with collapsible nodes and virtual scrolling |
| [`TreeNode`](/api/interfaces/TreeNode) | Data interface: `{ label, children? }` |

```typescript
import { Tree } from '@jimka/typescript-ui';

const tree = new Tree();
tree.setNodes([
    { label: 'Fruits', children: [
        { label: 'Apple' },
        { label: 'Banana' },
    ] },
    { label: 'Vegetables' },
]);
```

## Layout primitives

These components are usually internal but are publicly exposed in case you need them:

| Component | Purpose |
| --- | --- |
| [`SplitGutter`](/api/classes/SplitGutter) | Drag handle for the [`Split`](/api/classes/Split) layout |
| [`AccordionHeader`](/api/classes/AccordionHeader) | Collapsible section header for the [`Accordion`](/api/classes/Accordion) layout |
| [`Scrollbar`](/components/Scrollbar) | Custom vertical or horizontal scrollbar overlay for components that own their scroll state |
| [`VirtualScroller`](/components/VirtualScroller) | Shared scroll machinery for transform-based virtual lists (rows container, scrollbars, wheel + touch + momentum) |
