# typescript-ui

A web-based layout manager and UI component framework written in TypeScript. Provides desktop-style user interfaces in the browser using absolute positioning, with a rich set of reusable components and layout algorithms.

> **Notice:** Developed and tested on Chrome and Firefox. Safari compatibility is not verified.

## Getting started

```bash
npm run dev
```

Open your browser at `http://localhost:8015`. The app renders a tabbed demo showcasing all available layout managers and components.

## Build commands

| Command | Description |
|---|---|
| `npm run build` | Production bundle to `dist/` |
| `npm run clean` | Delete `dist/` contents |
| `npm run dev` | Start Vite dev server on port 8015 with hot reload |
| `npm run doc` | Generate TypeDoc documentation to `dist/docs/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run strict TypeScript type check (no emit) |

## Architecture overview

The framework is organized into three layers:

```
Entry point (main.ts)
  └─ Demo panels (*Panel.ts)
       └─ Component system (Base/)
            ├─ Layout managers (Base/layout/)
            └─ UI components (Base/component/)
```

### Component system

All UI elements extend `Component`, which manages:
- Absolute position and size (with min/max/preferred bounds)
- CSS styling (colors, borders, shadow, opacity)
- Child component tree and layout manager attachment
- Deferred DOM rendering via `getElement()`

`BaseObject` sits above `Component` and provides UUID-based identity.

`Body` is a singleton wrapping `document.body` that bootstraps the framework and listens for viewport resize events.

### Layout managers

A `LayoutManager` is attached to a container component and positions its children on each `doLayout()` call. All managers extend `LayoutManager`, which handles fill/anchor constraint resolution.

| Manager | Description |
|---|---|
| `Absolute` | No-op — children are positioned manually |
| `Border` | Five-region layout: north, south, east, west, center |
| `Card` | Stacked layers — one visible at a time |
| `Column` | Horizontal sequence with gap control |
| `Fit` | Expands one child to fill the entire container |
| `Grid` | Two-dimensional grid |
| `HBox` | Horizontal stack with configurable spacing |
| `Row` | Vertical sequence with gap control |
| `Split` | Two panes with a draggable resize gutter |
| `Tab` | Tabbed interface with a button toolbar |
| `VBox` | Vertical stack with configurable spacing |

### UI components

Located in `Base/component/`:

**Text and input**
- `Label`, `PasswordField`, `Text`, `TextArea`, `TextField`
- `Checkbox`, `ComboBox`, `DateField`, `Input`, `RadioButton`, `Slider`, `TimeField`

**Buttons**
- `Button`, `RadioButton`, `ToggleButton`
- `ButtonGroup` — enforces single selection across radio/toggle buttons

**Display**
- `FontAwesomeIcon`, `Header`, `Image`
- `BulletedList`, `BulletedListItemStyle`, `List`, `ListItem`, `NumberedList`, `NumberedListItemStyle`
- `FieldSet`, `Legend`

**Containers**
- `Option` — `<option>` element wrapper; add to a `ComboBox` to populate its items
- `SplitGutter` — drag handle for the Split layout
- `Window` — draggable and resizable floating window
- `ContextMenu` — floating right-click menu appended to `document.documentElement`; call `show(x, y, items[])` to display and it closes automatically on item click or outside click
- `ContextMenuItem`, `ContextMenuSeparator` — building blocks used inside `ContextMenu`

**Overlays**
- `Notification` — static toast; call `Notification.show(message, type, duration?)` to display a timed overlay in the bottom-right corner. `type` is `'info'`, `'success'`, `'warning'`, or `'error'`; `duration` defaults to 3000 ms (pass `0` for a persistent notification). Multiple notifications stack upward and each has a manual dismiss button. The timer pauses while the pointer hovers over the notification.
- `Tooltip` — singleton hover hint; use `Tooltip.attach(component, text)` to wire a 500 ms delay tooltip onto any component, or `Tooltip.show` / `Tooltip.hide` for manual control

**Table subsystem** (`Base/component/table/`):
- `Body`, `Footer`, `Header`, `Row`, `Table`
- Cell types: `Boolean`, `Header`, `Number`, `String`
- Pluggable cell editors and renderers
- Column definitions come from the data layer `Model` passed to the `Table` constructor

> `Body` uses **virtual scrolling**: only the rows visible in the viewport plus a small buffer are in the DOM at any time. A phantom `<div>` gives the scroll container its full height without rendering every row. A fixed pool of `Row` components is reused as the user scrolls — pool slots are rebound to new data via `setData()` only when their data index changes, avoiding redundant DOM work on resize. See `Body.ts` for the full implementation.

**Tree subsystem** (`Base/component/tree/`):
- `Tree` — hierarchical data view with collapsible nodes and virtual scrolling; pass root nodes via `setNodes(nodes[])`.
- `TreeNode` — data interface: `{ label: string; children?: TreeNode[] }`. Nodes with children are collapsible parents; nodes without are leaves.
- `TreeRow` — internal row component recycled by `Tree`; not used directly.

```typescript
const tree = new Tree();
tree.setNodes([
    { label: 'Fruits', children: [
        { label: 'Apple' },
        { label: 'Banana' },
    ]},
    { label: 'Vegetables' },
]);
```

### Utilities

| File | Purpose |
|---|---|
| `AnchorType.ts`, `BorderStyle.ts`, `FillType.ts`, `Placement.ts`, `Position.ts` | Enums |
| `Border.ts`, `BorderLine.ts` | Four-sided border management |
| `CSS.ts` | Dynamic CSS rule creation and lookup |
| `Event.ts` | Event delegation — centralized per-type listener map |
| `Insets.ts` | Padding/margin abstraction (top/right/bottom/left) |
| `Point.ts`, `Size.ts` | Geometric primitives |
| `Type.ts` | Type-checking utilities (`isBoolean`, `isInteger`, etc.) |
| `Util.ts` | UUID generation, viewport size, scrollbar width |

## Theming

The framework includes a `ThemeManager` (`Base/Theme.ts`) that applies a set of design tokens to the entire UI at once via CSS custom properties.

### Switching themes

```typescript
import { ThemeManager, DarkTheme, DefaultTheme } from './Base/Theme.js';

ThemeManager.setTheme(DarkTheme);   // dark
ThemeManager.setTheme(DefaultTheme); // back to light
```

Two built-in themes are provided: `DefaultTheme` (light) and `DarkTheme`. Custom themes can be created by implementing the `Theme` interface and passing them to `setTheme`.

### How it works

`setTheme` does three things:

1. Writes each token as a CSS custom property on `:root` (e.g. `--ts-ui-body-bg`). Because CSS variables cascade, any component that references a variable in its style rule updates automatically — no re-render needed.
2. Sets `color-scheme` on `:root` so the browser renders native form elements (checkboxes, scrollbars, `<select>`) in the matching light or dark style.
3. Sets `color` and `background-color` on both `<html>` and `<body>`. The `<html>` target is necessary because `Window` components are appended to `document.documentElement` rather than `document.body`, so text inside floating windows must inherit from `<html>`.

### Theme keys

The `Theme` interface uses nested objects grouped by component. All keys are required; spread `DefaultTheme` and override only what you need (see [Custom themes](#custom-themes) below).

| Key path | CSS variable | Affects |
|---|---|---|
| `colorScheme` | *(set directly as `color-scheme`)* | Tells the browser to render native controls (checkboxes, scrollbars) in light or dark style. Use `'light'` or `'dark'`. |
| `font.family` | `--ts-ui-font-family` | Font family for the entire UI (cascades from `<html>`) |
| `font.size` | `--ts-ui-font-size` | Base font size for the entire UI (cascades from `<html>`) |
| `text.color` | `--ts-ui-text-color` | Default text color for all components |
| `body.background` | `--ts-ui-body-bg` | Page background; also the background of `Window` |
| `border.color` | `--ts-ui-border-color` | Default border color for `Window` and other bordered components |
| `border.radius` | `--ts-ui-border-radius` | Corner radius applied to `Button` and text-input components |
| `button.background` | `--ts-ui-button-bg` | Background of `Button`, window title bars, and table headers. Accepts any CSS `background-image` value (gradient or solid colour — see note below). |
| `button.border` | `--ts-ui-button-border` | Outline of `Button` and `ToggleButton` |
| `button.shadow` | `--ts-ui-button-shadow` | Drop shadow on unpressed buttons |
| `button.padding` | `--ts-ui-button-padding` | Padding inside `Button` |
| `button.font.size` | `--ts-ui-button-font-size` | Font size of `Button` labels |
| `button.pressed.background` | `--ts-ui-button-pressed-bg` | Background of a button while it is held down. Accepts a colour or gradient (see note below). |
| `button.pressed.foreground` | `--ts-ui-button-pressed-fg` | Text color of a button while it is held down |
| `button.pressed.shadow` | `--ts-ui-button-pressed-shadow` | Inset shadow on a pressed button |
| `toggle.selected.background` | `--ts-ui-toggle-selected-bg` | Background of a selected `ToggleButton` or `RadioButton`. Accepts a colour or gradient (see note below). |
| `toggle.selected.shadow` | `--ts-ui-toggle-selected-shadow` | Inset shadow on a selected `ToggleButton` or `RadioButton` |
| `input.background` | `--ts-ui-input-bg` | Background of text inputs, password fields, text areas, checkboxes, and the table body |
| `gutter.background` | `--ts-ui-gutter-bg` | Background of the `Split` layout drag gutter; also used as the scrollbar track color |
| `tab.toolbar.background` | `--ts-ui-tab-toolbar-bg` | Background of the tab button toolbar in the `Tab` layout |
| `tab.toolbar.border` | `--ts-ui-tab-toolbar-border` | Bottom border of the tab button toolbar |
| `tab.button.background` | `--ts-ui-tab-button-bg` | Background of inactive tab buttons |
| `window.shadow` | `--ts-ui-window-shadow` | Drop shadow on floating `Window` components |
| `header.font.size` | `--ts-ui-header-font-size` | Font size of window and panel title-bar labels (`Header` component) |
| `table.header.border` | `--ts-ui-table-header-border` | Bottom border separating the table header from the body |
| `table.header.font.size` | `--ts-ui-table-header-font-size` | Font size of table column header cells |
| `table.row.selected` | `--ts-ui-table-row-selected` | Background tint of the currently selected table row |
| `table.row.new` | `--ts-ui-table-row-new` | Background tint of unsaved new records in the table |
| `table.row.dirty` | `--ts-ui-table-row-dirty` | Background tint of locally modified (dirty) records in the table |
| `contextMenu.background` | `--ts-ui-context-menu-bg` | Background of the `ContextMenu` panel |
| `contextMenu.border` | `--ts-ui-context-menu-border` | Border color of the `ContextMenu` panel |
| `contextMenu.shadow` | `--ts-ui-context-menu-shadow` | Drop shadow of the `ContextMenu` panel |
| `contextMenu.item.hoverBackground` | `--ts-ui-context-menu-item-hover-bg` | Background of a `ContextMenuItem` on hover |
| `contextMenu.item.disabledColor` | `--ts-ui-context-menu-item-disabled-color` | Text color of a disabled `ContextMenuItem` |
| `contextMenu.separatorColor` | `--ts-ui-context-menu-separator-color` | Color of the `ContextMenuSeparator` line |
| `tooltip.background` | `--ts-ui-tooltip-bg` | Background of the `Tooltip` panel |
| `tooltip.color` | `--ts-ui-tooltip-color` | Text color inside the `Tooltip` |
| `tooltip.border` | `--ts-ui-tooltip-border` | Border color of the `Tooltip` panel |
| `tooltip.shadow` | `--ts-ui-tooltip-shadow` | Drop shadow of the `Tooltip` panel |
| `notification.shadow` | `--ts-ui-notification-shadow` | Drop shadow applied to all `Notification` toasts |
| `notification.info.background` | `--ts-ui-notification-info-bg` | Background of `'info'` notifications |
| `notification.info.border` | `--ts-ui-notification-info-border` | Border color of `'info'` notifications |
| `notification.success.background` | `--ts-ui-notification-success-bg` | Background of `'success'` notifications |
| `notification.success.border` | `--ts-ui-notification-success-border` | Border color of `'success'` notifications |
| `notification.warning.background` | `--ts-ui-notification-warning-bg` | Background of `'warning'` notifications |
| `notification.warning.border` | `--ts-ui-notification-warning-border` | Border color of `'warning'` notifications |
| `notification.error.background` | `--ts-ui-notification-error-bg` | Background of `'error'` notifications |
| `notification.error.border` | `--ts-ui-notification-error-border` | Border color of `'error'` notifications |

> **Background tokens** (`button.background`, `button.pressed.background`, `toggle.selected.background`) accept either a plain colour (`rgb(200, 200, 200)`) or any CSS `background-image` value (`linear-gradient(...)`, `radial-gradient(...)`, etc.). The framework applies the token to both `background-color` and `background-image`; CSS's "invalid at computed-value time" rule routes the value to whichever property it is valid for.

### Custom themes

Implement the `Theme` interface and pass it to `setTheme`:

```typescript
import { Theme, ThemeManager, DefaultTheme } from './Base/Theme.js';

const MyTheme: Theme = {
    ...DefaultTheme,
    body  : { background: 'rgb(240, 248, 255)' },
    text  : { color: 'rgb(10, 30, 60)' },
    button: {
        ...DefaultTheme.button,
        background: 'linear-gradient(rgb(200, 220, 255), rgb(160, 190, 240))',
    },
};

ThemeManager.setTheme(MyTheme);
```

Components that need a theme value at construction time (rather than via a CSS variable) can call `ThemeManager.getTheme()` to read the currently active theme.

### Theme change listeners

`ThemeManager.onThemeChange(listener)` subscribes a callback that fires after every `setTheme` call, once all CSS variables have been written. `Text`-based components (`Label`, `Header` labels, table column headers) automatically recalculate their preferred size on each theme change so that layout managers see updated dimensions.

```typescript
const unsubscribe = ThemeManager.onThemeChange(() => {
    console.log('theme changed:', ThemeManager.getTheme().colorScheme);
});

// Later, to stop listening:
unsubscribe();
```

Custom components that create `Text` instances and are removed from the page should call `text.dispose()` to detach the listener and avoid memory leaks.

## Demo panels

Each tab in the running app corresponds to a `*Panel.ts` file that demonstrates one layout manager or feature set. All layout panels extend `LayoutTestPanel`.

`MiscPanel` shows floating `Window`s, a data `Table`, an `Image`, and various form components.

`BindingPanel` demonstrates the `Binding` system: a `Model` and `MemoryStore` are wired to form fields (`TextField`, `Checkbox`, `ComboBox`, `DateField`, `TimeField`) via a `Binding` instance, with commit/reject buttons and live field validation (required, min/max length rules with red-outline error indicators and hover tooltips).

`ComplexUIPanel` is a general showcase combining `FieldSet`, `RadioButton`, `ButtonGroup`, `Table`, and other components in a realistic layout.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Free for personal and educational use; commercial use is not permitted.

## Data layer

The framework includes a data package (`Base/data/`) with three concepts: a `Model` defines the shape of a record, a `Proxy` handles transport, and a `Store` orchestrates loading, sorting, and filtering.

### Define a model

Pass an array of field configs to `Model`:

```typescript
import { Model } from './Base/index.js';

const PersonModel = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);
```

Or extend `AbstractModel` to give the schema a named class, mirroring the `AbstractStore` pattern:

```typescript
import { AbstractModel } from './Base/index.js';

class PersonModel extends AbstractModel {
    readonly fields = [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'age',  type: 'number', defaultValue: 0 },
    ];
}

const personModel = new PersonModel();
```

Both forms are accepted everywhere a `Model` is expected.

### Load from memory

`MemoryStore` is a convenience subclass that wires a `MemoryProxy` internally:

```typescript
import { MemoryStore } from './Base/index.js';

const store = new MemoryStore(PersonModel, [
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob',   age: 25 },
]);

store.on('load', () => {
    console.log(store.getCount());              // 2
    console.log(store.getAt(0)?.get('name'));   // 'Alice'
});

await store.load();
```

### Load from a REST endpoint

```typescript
import { AjaxProxy, Store } from './Base/index.js';

const store = new Store(PersonModel, new AjaxProxy({
    url: '/api/people',
    root: 'data',       // extracts response.data array
}));

await store.load();
```

### Typed subclasses

Extend `AbstractStore` to bake in the model and proxy, and add domain-specific methods. Combine with an `AbstractModel` subclass to keep the schema self-contained:

```typescript
import { AbstractModel, AbstractStore, AjaxProxy } from './Base/index.js';

class PersonModel extends AbstractModel {
    readonly fields = [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'age',  type: 'number', defaultValue: 0 },
    ];
}

class PersonStore extends AbstractStore {
    readonly model = new PersonModel();
    readonly proxy = new AjaxProxy({ url: '/api/people' });

    findByName(name: string) {
        return this.find('name', name);
    }
}

const personStore = new PersonStore();
await personStore.load();
personStore.findByName('Alice');
```

### Sort and filter

```typescript
store.sort('age', 'asc');

store.filter('age', 25);                        // exact match
store.filterBy(r => r.get('age') > 20);         // custom predicate
store.clearFilter();
```

Multiple `filter`/`filterBy` calls stack — all must pass. `clearFilter()` removes all at once.

### Add and remove records

```typescript
const [newPerson] = store.add({ id: 3, name: 'Carol', age: 28 });

store.on('datachanged', () => console.log('store changed'));

store.remove(newPerson);
```

### Mutate a record

```typescript
const rec = store.find('id', 1);
rec?.set('age', 31);
console.log(rec?.isDirty());  // true
rec?.commit();                // clears dirty flag
// rec?.reject()              // reverts to last commit
```

### Bind a record to UI components

`Binding` synchronises a `ModelRecord` with a set of form components. Components that implement `Bindable` (`TextField`, `Checkbox`, `ComboBox`, `DateField`, `TimeField`) can be bound directly by field name. Any other component can be wired via explicit accessor callbacks.

```typescript
import { Binding } from './Base/index.js';

const binding = new Binding()
    .bind('name',   nameField)
    .bind('active', activeCheckbox)
    .bind('role',   roleCombo);

// Populate all components from a record:
binding.setRecord(store.getAt(0));

// Commit or reject the edits:
binding.commit();
// binding.reject();
```

Use explicit accessors for components that do not implement `Bindable`:

```typescript
const binding = new Binding()
    .bind('name', myWidget, {
        get:    () => myWidget.getValue(),
        set:    (v) => myWidget.setValue(v),
        listen: (fn) => myWidget.addChangeListener(fn),
    });
```

`Binding` also fires `onChange`, `onCommit`, and `onReject` listeners so callers can react to record mutations without polling.

### Field mapping

Use `mapping` when the incoming JSON key differs from the field name:

```typescript
{ name: 'firstName', type: 'string', mapping: 'first_name' }
// incoming { first_name: 'Alice' } → record.get('firstName') === 'Alice'
```

## TODO

### High priority

* **`Binding` record-change veto** — `setRecord()` has no way to abort a record switch. Add an `addBeforeRecordListener(fn: (next: ModelRecord | null) => boolean)` API: listeners return `false` to cancel the change. Useful for guarding against switching away from an invalid or dirty record. Async confirmation (e.g. a dialog) must be handled at the call site since `setRecord()` stays synchronous.

* **Modal dialog** — `Window` is draggable but never blocking. A `Dialog` component (or a `modal` option on `Window`) should render a full-viewport backdrop, trap keyboard focus inside, and prevent interaction with content behind it. This is needed for confirmation prompts and multi-step forms.

* **Drag-and-drop system** — no DnD primitive exists. A `DragSource` / `DropTarget` API built on top of the `Event` class would enable reordering list items, moving tree nodes, and rearranging tab order. Should expose drag data and drag-over feedback hooks rather than a single monolithic implementation.

* **Progress / loading indicators** — no `ProgressBar` or `Spinner` component exists. The Table's virtual scroll has no "loading" state, and async `Store.load()` has no visual feedback. A `ProgressBar` (0–100 %, or indeterminate) and a `Spinner` overlay are the minimum needed to communicate async activity.

* **Keyboard navigation and focus management** — ARIA roles are applied (`role="grid"`, `role="tree"`) but keyboard interaction is absent. Table rows, tree nodes, and list items should respond to arrow keys; `Tab` order inside composite widgets needs a `roving tabindex` implementation. This is the main accessibility gap.

### Low priority

* **Add a test suite** — the project has no automated tests. Adding unit tests for the pure logic in `Util`, `Type`, layout constraint resolution, and `ButtonGroup` would catch regressions quickly and is a natural starting point before larger refactors.

* **Create an initialisation package** — add a separate `create-typescript-ui` (or similar) package whose sole purpose is to scaffold new projects. Running `npm create typescript-ui` (or `npx create-typescript-ui`) would generate a minimal project wired up with the library, a working `tsconfig.json`, and a Vite dev server, so consumers can get started without manually configuring dependencies or entry-point boilerplate.

* **Tree node renderers** — `TreeRow` currently renders each node as two plain `<span>` elements (a toggle icon and a label). A renderer API similar to the table's `CellRenderer` pattern — a factory passed to the `Tree` constructor or `setNodeRenderer()` — would let callers display icons, badges, or rich content per node.

* **Menu bar** — `ContextMenu` covers right-click menus; there is no top-level horizontal menu bar with keyboard-navigable drop-down submenus. A `MenuBar` + `Menu` + `MenuItem` hierarchy would fill this gap for application-style UIs.

* **Closeable tabs** — the `Tab` layout has no way to remove a tab at runtime. Adding an optional close button (×) per tab button, and a `onTabClose` callback on the layout, would allow dynamic tab management without reimplementing the entire `Tab` layout.

* **Multi-select List** — `List` (and `ComboBox`) support only single selection. A `multiSelect` option with checkbox rendering per item and a `getValues() / setValues()` API would cover the common case of selecting several items from a fixed set.

* **Autocomplete / typeahead** — `TextField` has no suggestion overlay. An `AutoCompleteField` (or an `AutoComplete` plugin for `TextField`) that shows a filtered dropdown as the user types, backed by a static array or a `Store`, is a frequently needed input pattern.

* **Table column pinning** — there is no way to freeze one or more columns to the left while the rest scroll horizontally. Column pinning requires a dual-panel table (fixed + scrolling) sharing a single virtual-scroll position; this is the largest missing table feature.

* **Table multi-column sort** — `Store.sort()` accepts one field at a time. Supporting an ordered sort descriptor array (e.g. `store.sort([{ field: 'lastName', dir: 'asc' }, { field: 'firstName', dir: 'asc' }])`) and surfacing the sort priority in column header indicators would match the expectation of most tabular UIs.

* **Server-side pagination** — `AjaxProxy` loads all records in one request. Adding `page` / `pageSize` params, a `totalCount` field in the response contract, and `Store.nextPage()` / `prevPage()` methods would support large server-side datasets without requiring the client to hold all rows in memory.

* **Number spinner input** — there is no `NumberField` or `Spinner` component with increment/decrement buttons and a numeric `Bindable` interface. The current `Slider` covers range selection but not free numeric entry with step controls.

* **CSV / JSON export** — the `Table` has no export capability. A `Table.exportCSV()` and `Table.exportJSON()` utility (operating on the store's current filtered/sorted record set) would be a low-effort addition with high practical value.

