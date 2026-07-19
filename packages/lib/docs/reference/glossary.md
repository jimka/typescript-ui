# Glossary

Terms used throughout the documentation, in alphabetical order.

## A

**`AnchorType`** — Enum describing how to position a child within its allocated cell when the child does not fill the cell. Values follow compass directions plus `CENTER`. See [`AnchorType`](/api/layout/enumerations/AnchorType) and the [Constraints reference](/layouts/Constraints#anchortype).

**`Aria`** — Typed accessor for WAI-ARIA attributes on a [`Component`](/api/core/classes/Component). Obtained via `component.getAria()`. See [Accessibility](/concepts/accessibility).

**Auto-commit style** — When `true` (the default), every CSS-style setter on a component flushes immediately to the DOM. Set `false` for batching multiple setters into one DOM write.

## B

**`BaseObject`** — Root of the framework's class hierarchy. Provides UUID-based identity. Every [`Component`](/components/Body) descends from this.

**`Binding`** — Class that synchronises a [`ModelRecord`](/data/record) with a set of UI components. See [Data binding](/data/binding).

**`Bindable<T>`** — Interface implemented by components ([`TextField`](/components/TextField), [`Checkbox`](/components/Checkbox), [`ComboBox`](/components/ComboBox), [`DateField`](/components/DateField), [`TimeField`](/components/TimeField)) that can be bound by field name without explicit accessors.

**`Body`** — Singleton `Component` that wraps the page's `<body>` element. Bootstraps the framework and listens for viewport resize. See [Body](/components/Body).

**Bundler resolution** — TypeScript's module resolution mode required by the framework, since source files import each other with `.js` extensions that resolve to `.ts`. Set `"moduleResolution": "bundler"` in `tsconfig.json`.

## C

**Cell** — In the table system, a single (row, column) intersection that combines a [`CellRenderer`](/api/component/table/classes/CellRenderer) for display and an optional [`CellEditor`](/api/component/table/classes/CellEditor) for in-place editing. See [Table internals](/components/TableInternals).

**`Component`** — Base class for all UI elements. Manages the DOM element lifecycle, CSS styles, child tree, and layout manager. See [Component lifecycle](/concepts/component-lifecycle).

## D

**Dirty (record)** — A [`ModelRecord`](/data/record) whose field values differ from the last committed snapshot. Cleared by `commit()`; reverted by `reject()`.

**`doLayout()`** — The single entry point for a layout pass on a container. Reads child preferred sizes, asks the layout manager to assign each child its position and size. See [Layout system](/concepts/layout-system).

## E

**Event delegation** — The framework attaches one native listener per event type to a shared root and dispatches each fired event to subscribed component callbacks. The user-facing API is the [`Event`](/concepts/events) namespace.

## F

**`FillType`** — Enum controlling how a child expands to fill its layout cell. Values: `NONE`, `HORIZONTAL`, `VERTICAL`, `BOTH`. See [Constraints reference](/layouts/Constraints#filltype).

**`FilterDescriptor`** — Serialisable filter algebra for [`AbstractStore`](/data/store). Plain objects that can cross the worker boundary via structured clone. See [API: FilterDescriptor](/api/data/type-aliases/FilterDescriptor).

## I

**`Insets`** — Padding / margin abstraction storing `{ top, right, bottom, left }` in pixels.

## L

**`LayoutConstraints`** — Per-child hint object passed to `addComponent`. Layout managers subclass this to add manager-specific fields. See [Constraints reference](/layouts/Constraints).

**`LayoutManager`** — Component attached to a container that positions children on each `doLayout()` pass. See [Layouts overview](/layouts/).

## M

**`ModelRecord`** — A single record in a [`Store`](/data/store) with dirty-tracking and commit / reject semantics.

## P

**`pauseLayout` / `resumeLayout`** — Methods that suspend automatic layout passes during bulk mutations. See [Performance](/concepts/performance#pauselayout-resumelayout).

**`Placement`** — Enum for compass-point regions plus `CENTER`. Used by [`Border`](/layouts/Border) for region selection. See [Constraints reference](/layouts/Constraints#placement).

**Preferred size** — A component's size hint expressing what it would like to be given the chance. Layout managers honour it within min / max bounds. See [Sizing](/concepts/sizing).

**`Proxy`** — Transport layer for the data system. Built-in proxies: [`MemoryProxy`](/api/data/classes/MemoryProxy), [`AjaxProxy`](/api/data/classes/AjaxProxy). Custom proxies subclass [`Proxy`](/api/data/classes/Proxy).

## R

**rAF coalescing** — The framework queues layout requests and flushes them once per animation frame so multiple changes within one frame produce one layout pass. See [Component lifecycle](/concepts/component-lifecycle).

**`RovingTabIndex`** — Keyboard-navigation primitive that gives exactly one item in a group `tabindex=0` at a time. See [Accessibility](/concepts/accessibility#keyboard-navigation-rovingtabindex).

## S

**`Store`** — Manages a collection of records with loading, sorting, filtering, and event notification. See [Store](/data/store).

**Subtree listener** — An [`Event.addSubtreeListener`](/concepts/events#addsubtreelistener) handler that fires for any event in the subtree rooted at a component, not just events targeting the component itself.

## T

**`Theme`** — Object describing a complete set of design tokens. Applied via [`ThemeManager.setTheme`](/concepts/theming).

**`ThemeManager`** — Singleton that writes theme tokens as CSS custom properties on `:root`. Cascade does the rest.

## V

**Virtual scrolling** — A rendering pattern where only the rows visible in the viewport (plus a small buffer) are in the DOM at any time. Used by [`Table`](/components/Table) and [`Tree`](/components/Tree). See [Performance](/concepts/performance#virtual-scrolling).

## W

**Worker offload** — [`AbstractStore`](/data/store) automatically runs sort / filter on a Web Worker for datasets ≥ 1,000 rows. See [Performance](/concepts/performance#web-worker-for-sort-and-filter).
