# Components

Every UI element extends [`Component`](/api/core/classes/Component) — see the [mental model](/guide/mental-model) for the architectural foundation.

This page is a flat catalog. Per-component documentation lives in the [API reference](/api/) until dedicated pages land.

## Core

| Component | Purpose |
| --- | --- |
| [`Component`](/api/core/classes/Component) | Base class — position, size, styling, child tree |
| [`BaseObject`](/api/core/classes/BaseObject) | UUID-based identity above `Component` |
| [`Body`](/api/core/classes/Body) | Singleton wrapping `document.body`; bootstraps the framework |
| [`Container`](/api/core/classes/Container) | Fit-parent, zero-inset, no-scroll base for structural regions; `Panel` adds 4px padding + scrolling |
| [`AbstractWindow`](/components/AbstractWindow) | Abstract base for `Window` and `TabWindow` — header-agnostic window machinery |
| [`Window`](/components/Window) | Floating, draggable, resizable window with a title-bar header |
| [`TabWindow`](/components/TabWindow) | Headerless floating window whose tab bar is its title bar (strip tear-off) |
| [`Dialog`](/api/core/classes/Dialog) | Modal dialog with async result |
| [`Drawer`](/components/Drawer) | Edge-anchored panel that slides in from a viewport edge; modal or non-modal |
| [`Dock`](/components/Dock) | Rearrangeable panel layout — reorder, tear-off, edge-split, and save/restore |
| [`Tooltip`](/api/core/classes/Tooltip) | Singleton hover hint, attach via `Tooltip.attach(component, text)` |
| [`Popover`](/components/Popover) | Anchored, non-modal floating bubble with arrow tail and dismiss modes |
| [`Notification`](/api/core/classes/Notification) | Static toast — `Notification.show(message, type, duration?)` |
| [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) | Floating-panel base with shared fade lifecycle |

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

Every value-bearing control below extends [`AbstractInput<T>`](/api/component/input/classes/AbstractInput) — the abstract base owns the [`Bindable<T>`](/api/core/interfaces/Bindable) value contract, the `on("change", fn)` / `on("binding", fn)` fan-out, and the `setEnabled` / `setReadOnly` surface. `instanceof AbstractInput` is the universal check for "this is a form input." The three picker fields share a second base, [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField), which owns the [`PickerInput`](/api/component/input/classes/PickerInput) + [`PickerButton`](/api/component/input/classes/PickerButton) chrome and the dropdown lifecycle.

| Component | Purpose |
| --- | --- |
| [`AbstractInput`](/api/component/input/classes/AbstractInput) | Abstract base for every value-bearing input — Bindable, listeners, enabled/read-only |
| [`AbstractPickerField`](/api/component/input/classes/AbstractPickerField) | Abstract base for date/time/datetime picker fields — shares PickerInput + PickerButton chrome |
| [`PickerInput`](/api/component/input/classes/PickerInput) | Internal text input used inside the picker fields |
| [`PickerButton`](/api/component/input/classes/PickerButton) | Internal glyph button used to the right of a picker field's input |
| [`TextField`](/api/component/input/classes/TextField) | Single-line text input |
| [`TextArea`](/api/component/input/classes/TextArea) | Multi-line text input |
| [`PasswordField`](/api/component/input/classes/PasswordField) | Masked text input |
| [`Checkbox`](/api/component/input/classes/Checkbox) | Boolean toggle (supports indeterminate / mixed state) |
| [`Toggle`](/api/component/input/classes/Toggle) | Sliding-pill on/off switch |
| [`ComboBox`](/api/component/input/classes/ComboBox) | Drop-down selection from a list of items or a [`Store`](/api/data/classes/Store) |
| [`AutoCompleteField`](/api/component/input/classes/AutoCompleteField) | Text field with type-ahead suggestions |
| [`DateField`](/api/component/input/classes/DateField) | Date picker with animated calendar dropdown |
| [`TimeField`](/api/component/input/classes/TimeField) | Time picker with animated hour/minute dropdown |
| [`DateTimeField`](/api/component/input/classes/DateTimeField) | Combined date + time picker with animated dropdown |
| [`NumberSpinner`](/api/component/input/classes/NumberSpinner) | Number field with up / down spinner |
| [`Slider`](/api/component/input/classes/Slider) | Continuous-value slider |
| [`FileField`](/api/component/input/classes/FileField) | File picker — trigger button + filename label over a hidden native input |
| [`FileDropZone`](/api/component/input/classes/FileDropZone) | Drag-and-drop file surface that composes a `FileField` |

## Display

| Component | Purpose |
| --- | --- |
| [`Text`](/api/component/input/classes/Text) | Standalone text — the default for status, captions, body |
| [`Label`](/api/component/input/classes/Label) | Text tied to a form control via the HTML `for` attribute |
| [`Header`](/api/component/display/classes/Header) | Title-bar / panel header text |
| [`Image`](/api/component/display/classes/Image) | `<img>` wrapper |
| [`Glyph`](/components/Glyph) | Self-contained icon — SVG or Unicode entry from a curated registry |
| [`IconText`](/components/IconText) | Glyph + standalone [`Text`](/api/component/input/classes/Text), horizontal flow |
| [`IconLabel`](/components/IconLabel) | Glyph + form-control [`Label`](/api/component/input/classes/Label), horizontal flow |
| [`FieldSet`](/api/component/container/classes/FieldSet) | Grouped form section with optional [`Legend`](/api/component/container/classes/Legend) |
| [`FormFieldSet`](/components/FormFieldSet) | [`FieldSet`](/api/component/container/classes/FieldSet) of baseline-aligned title/field rows in one or more columns |
| [`ProgressBar`](/components/ProgressBar) | Horizontal progress indicator (determinate or indeterminate) |
| [`ProgressSpinner`](/components/ProgressSpinner) | Circular loading spinner; supports inline and overlay use |
| [`PaginationBar`](/components/PaginationBar) | First / prev / next / last navigation for a paginated [`Store`](/api/data/classes/Store) |
| [`StatusBar`](/components/StatusBar) | Bottom-of-window status strip with a transient message and left / right indicator zones |

## Lists

| Component | Purpose |
| --- | --- |
| [`List`](/api/component/list/classes/List) | Single-selection list |
| [`MultiSelectList`](/api/component/list/classes/MultiSelectList) | Multi-selection list |
| [`ListItem`](/api/component/list/classes/ListItem) | Item inside a `List` / `MultiSelectList` |
| [`BulletedList`](/api/component/list/classes/BulletedList) | `<ul>`-style bulleted list (style via [`BulletedListItemStyle`](/api/component/list/enumerations/BulletedListItemStyle)) |
| [`NumberedList`](/api/component/list/classes/NumberedList) | `<ol>`-style numbered list (style via [`NumberedListItemStyle`](/api/component/list/enumerations/NumberedListItemStyle)) |

## Toolbar

| Component | Purpose |
| --- | --- |
| [`ToolBar`](/components/ToolBar) | Horizontal or vertical strip of related controls — Buttons, ToggleButtons, ComboBoxes, separators |
| [`ToolBarSeparator`](/components/ToolBarSeparator) | Divider rule inside a `ToolBar` |

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
| [`TablePanel`](/api/component/table/classes/TablePanel) | Table + add/remove/sync toolbar |
| [`TreeTable`](/components/TreeTable) | Table whose rows form a parent/child hierarchy via a `parentField` on the model |
| [`TreeTablePanel`](/components/TreeTablePanel) | `TreeTable` + add/remove/sync toolbar |
| [`Header`](/api/component/table/classes/Header) | Column-header strip (import as `TableHeader` to avoid collision with `component/display`) |
| [`Body`](/api/component/table/classes/Body) | Virtual-scrolling row container (import as `TableBody`) |
| [`TreeBody`](/api/component/table/classes/TreeBody) | Tree-aware body that virtual-scrolls a depth-flattened record list |
| [`FooterRow`](/api/component/table/classes/FooterRow) | Optional summary / footer strip (often aliased to `TableFooter`) |
| [`Row`](/api/component/table/classes/Row) | Row component, recycled by `Body` (import as `TableRow` to avoid collision with `layout`) |
| [`Column`](/api/component/table/classes/Column) | Per-column metadata (import as `TableColumn` to avoid collision with `layout`) |
| [`Cell`](/api/component/table/classes/Cell) | Cell base class |
| [`BooleanCell`](/api/component/table/classes/BooleanCell), [`NumberCell`](/api/component/table/classes/NumberCell), [`StringCell`](/api/component/table/classes/StringCell), [`HeaderCell`](/api/component/table/classes/HeaderCell), [`GlyphCell`](/api/component/table/classes/GlyphCell) | Built-in cell types |
| [`CellEditor`](/api/component/table/classes/CellEditor), [`BooleanEditor`](/api/component/table/classes/BooleanEditor), [`NumberEditor`](/api/component/table/classes/NumberEditor), [`StringEditor`](/api/component/table/classes/StringEditor) | Inline editors per cell type |
| [`CellEditorPool`](/api/component/table/classes/CellEditorPool) | Body-owned registry that shares one editor instance per variant across cells |
| [`CellRenderer`](/api/component/table/classes/CellRenderer), [`NumberRenderer`](/api/component/table/classes/NumberRenderer), [`StringRenderer`](/api/component/table/classes/StringRenderer) | Display renderers per cell type |
| [`TreeCellRenderer`](/api/component/table/classes/TreeCellRenderer) | Wraps a typed renderer with indent + expand/collapse toggle for the tree column |

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

## Containers

| Component | Purpose |
| --- | --- |
| [`TabBar`](/components/TabBar) | Standalone, window-agnostic tab **strip** (buttons, indicator, reorder bar, tools, overflow scroll, tab DnD) the [`Tab`](/api/layout/classes/Tab) layout composes — emits semantic events, owns no content |
| [`TabPanel`](/components/TabPanel) | [`Panel`](/api/core/classes/Panel) subclass wrapping the [`Tab`](/api/layout/classes/Tab) layout — typed `addTab` / `addLazyTab` / `on("tabclose")` |
| [`AccordionPanel`](/components/AccordionPanel) | [`Panel`](/api/core/classes/Panel) subclass wrapping the [`Accordion`](/api/layout/classes/Accordion) layout — typed `addSection` / `openSection` / `setSingleOpen` |

## Layout primitives

These components are usually internal but are publicly exposed in case you need them:

| Component | Purpose |
| --- | --- |
| [`Spacer`](/components/Spacer) | Invisible gap — fixed `(w, h)` or flex (absorbs leftover row/column space via `weight`) |
| [`SplitGutter`](/api/component/container/classes/SplitGutter) | Drag handle for the [`Split`](/api/layout/classes/Split) layout |
| [`AccordionHeader`](/api/component/container/classes/AccordionHeader) | Collapsible section header for the [`Accordion`](/api/layout/classes/Accordion) layout |
| [`Scrollbar`](/components/Scrollbar) | Custom vertical or horizontal scrollbar overlay for components that own their scroll state |
| [`VirtualScroller`](/components/VirtualScroller) | Shared scroll machinery for transform-based virtual lists (rows container, scrollbars, wheel + touch + momentum) |
