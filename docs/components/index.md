# Components

Every UI element extends [`Component`](/api/core/classes/Component) — see the [mental model](/guide/mental-model) for the architectural foundation.

This page is a flat catalog. Per-component documentation lives in the [API reference](/api/) until dedicated pages land.

## Core

| Component | Purpose |
| --- | --- |
| [`Component`](/api/core/classes/Component) | Base class — position, size, styling, child tree |
| [`BaseObject`](/api/core/classes/BaseObject) | UUID-based identity above `Component` |
| [`Body`](/api/core/classes/Body) | Singleton wrapping `document.body`; bootstraps the framework |
| [`Window`](/api/core/classes/Window) | Floating, draggable, resizable window |
| [`Dialog`](/api/core/classes/Dialog) | Modal dialog with async result |
| [`Tooltip`](/api/core/classes/Tooltip) | Singleton hover hint, attach via `Tooltip.attach(component, text)` |
| [`Notification`](/api/core/classes/Notification) | Static toast — `Notification.show(message, type, duration?)` |

## Buttons

| Component | Purpose |
| --- | --- |
| [`Button`](/api/component/button/classes/Button) | Standard click button |
| [`ToggleButton`](/api/component/button/classes/ToggleButton) | Two-state press button |
| [`RadioButton`](/api/component/input/classes/RadioButton) | Single-selection radio (use with `ButtonGroup`) |
| [`ButtonGroup`](/api/core/classes/ButtonGroup) | Enforces single selection across radio / toggle buttons |
| [`SpinButton`](/api/component/input/classes/SpinButton) | Up / down arrow paired with a numeric field |
| [`TabCloseButton`](/api/component/button/classes/TabCloseButton) | Small `×` button for closeable tabs |

## Inputs

| Component | Purpose |
| --- | --- |
| [`TextField`](/api/component/input/classes/TextField) | Single-line text input |
| [`TextArea`](/api/component/input/classes/TextArea) | Multi-line text input |
| [`PasswordField`](/api/component/input/classes/PasswordField) | Masked text input |
| [`Checkbox`](/api/component/input/classes/Checkbox) | Boolean toggle |
| [`ComboBox`](/api/component/input/classes/ComboBox) | Drop-down selection from a list of [`Option`](/api/component/input/classes/Option) or a [`Store`](/api/data/classes/Store) |
| [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField) | Text field with type-ahead suggestions |
| [`DateField`](/api/component/input/classes/DateField) | Date picker |
| [`TimeField`](/api/component/input/classes/TimeField) | Time picker |
| [`NumberSpinner`](/api/component/input/classes/NumberSpinner) | Number field with up / down spinner |
| [`Slider`](/api/component/input/classes/Slider) | Continuous-value slider |

## Display

| Component | Purpose |
| --- | --- |
| [`Text`](/api/component/input/classes/Text) | Standalone text — the default for status, captions, body |
| [`Label`](/api/component/input/classes/Label) | Text tied to a form control via the HTML `for` attribute |
| [`Header`](/api/component/display/classes/Header) | Title-bar / panel header text |
| [`Image`](/api/component/display/classes/Image) | `<img>` wrapper |
| [`FontAwesomeIcon`](/api/component/display/classes/FontAwesomeIcon) | FontAwesome glyph (peer dep) |
| [`FieldSet`](/api/component/container/classes/FieldSet) | Grouped form section with optional [`Legend`](/api/component/container/classes/Legend) |
| [`ProgressBar`](/components/ProgressBar) | Horizontal progress indicator (determinate or indeterminate) |
| [`ProgressSpinner`](/components/ProgressSpinner) | Circular loading spinner; supports inline and overlay use |
| [`PaginationBar`](/components/PaginationBar) | First / prev / next / last navigation for a paginated [`Store`](/api/data/classes/Store) |

## Lists

| Component | Purpose |
| --- | --- |
| [`List`](/api/component/list/classes/List) | Single-selection list |
| [`MultiSelectList`](/api/component/list/classes/MultiSelectList) | Multi-selection list |
| [`ListItem`](/api/component/list/classes/ListItem) | Item inside a `List` / `MultiSelectList` |
| [`BulletedList`](/api/component/list/classes/BulletedList) | `<ul>`-style bulleted list (style via [`BulletedListItemStyle`](/api/component/list/enumerations/BulletedListItemStyle)) |
| [`NumberedList`](/api/component/list/classes/NumberedList) | `<ol>`-style numbered list (style via [`NumberedListItemStyle`](/api/component/list/enumerations/NumberedListItemStyle)) |
| [`Option`](/api/component/input/classes/Option) | Item inside a [`ComboBox`](/api/component/input/classes/ComboBox) |

## Menus

| Component | Purpose |
| --- | --- |
| [`MenuBar`](/api/component/menubar/classes/MenuBar) | Top-of-window menu bar |
| [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) | A button that opens a menu panel |
| [`Menu`](/api/core/classes/Menu) | Floating menu — right-click context menu (`Menu()`) or `MenuBar` dropdown (`Menu(items, onClose)`) |
| [`MenuItem`](/api/component/container/classes/MenuItem) | Item inside a menu |
| [`MenuSeparator`](/api/component/container/classes/MenuSeparator) | Divider line in a menu |

## Table

A [`Table`](/api/component/table/classes/Table) ties columns to a [`Store`](/api/data/classes/Store) and renders rows via virtual scrolling. The body keeps only visible rows + a small buffer in the DOM at any time. Scrolling is delegated to a [`VirtualScroller`](/components/VirtualScroller) — `translate3d` positioning plus two custom [`Scrollbar`](/components/Scrollbar) overlays — with wheel, touch (fling momentum), and keyboard support.

| Component | Purpose |
| --- | --- |
| [`Table`](/api/component/table/classes/Table) | Top-level container; wires header, body, footer |
| [`Header`](/api/component/table/classes/Header) | Column-header strip (import as `TableHeader` to avoid collision with `component/display`) |
| [`Body`](/api/component/table/classes/Body) | Virtual-scrolling row container (import as `TableBody`) |
| [`FooterRow`](/api/component/table/classes/FooterRow) | Optional summary / footer strip (often aliased to `TableFooter`) |
| [`Row`](/api/component/table/classes/Row) | Row component, recycled by `Body` (import as `TableRow` to avoid collision with `layout`) |
| [`Column`](/api/component/table/classes/Column) | Per-column metadata (import as `TableColumn` to avoid collision with `layout`) |
| [`Cell`](/api/component/table/classes/Cell) | Cell base class |
| [`BooleanCell`](/api/component/table/classes/BooleanCell), [`NumberCell`](/api/component/table/classes/NumberCell), [`StringCell`](/api/component/table/classes/StringCell), [`HeaderCell`](/api/component/table/classes/HeaderCell) | Built-in cell types |
| [`CellEditor`](/api/component/table/classes/CellEditor), [`BooleanEditor`](/api/component/table/classes/BooleanEditor), [`NumberEditor`](/api/component/table/classes/NumberEditor), [`StringEditor`](/api/component/table/classes/StringEditor) | Inline editors per cell type |
| [`CellRenderer`](/api/component/table/classes/CellRenderer), [`NumberRenderer`](/api/component/table/classes/NumberRenderer), [`StringRenderer`](/api/component/table/classes/StringRenderer) | Display renderers per cell type |

## Tree

| Component | Purpose |
| --- | --- |
| [`Tree`](/api/component/tree/classes/Tree) | Hierarchical view with collapsible nodes and virtual scrolling |
| [`TreeNode`](/api/component/tree/interfaces/TreeNode) | Data interface: `{ label, children? }` |

```typescript
import { Tree } from '@jimka/typescript-ui/component/tree';
const tree = Tree();
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
| [`SplitGutter`](/api/component/container/classes/SplitGutter) | Drag handle for the [`Split`](/api/layout/classes/Split) layout |
| [`AccordionHeader`](/api/component/container/classes/AccordionHeader) | Collapsible section header for the [`Accordion`](/api/layout/classes/Accordion) layout |
| [`Scrollbar`](/components/Scrollbar) | Custom vertical or horizontal scrollbar overlay for components that own their scroll state |
| [`VirtualScroller`](/components/VirtualScroller) | Shared scroll machinery for transform-based virtual lists (rows container, scrollbars, wheel + touch + momentum) |
