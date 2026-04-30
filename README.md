# typescript-ui

A web-based layout manager and UI component framework written in TypeScript. Provides desktop-style user interfaces in the browser using absolute positioning, with a rich set of reusable components and layout algorithms.

> **Notice:** Developed and tested only on Chrome.

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
- `Checkbox`, `ComboBox`, `Input`, `RadioButton`, `Slider`

**Buttons**
- `Button`, `RadioButton`, `ToggleButton`
- `ButtonGroup` — enforces single selection across radio/toggle buttons

**Display**
- `FontAwesomeIcon`, `Header`, `Image`
- `BulletedList`, `List`, `ListItem`, `NumberedList`
- `FieldSet`, `Legend`

**Containers**
- `SplitGutter` — drag handle for the Split layout
- `Window` — draggable and resizable floating window

**Table subsystem** (`Base/component/table/`):
- `Body`, `Footer`, `Header`, `Row`, `Table`
- Cell types: `Boolean`, `Header`, `Number`, `String`
- Pluggable cell editors and renderers
- Column definitions come from the data layer `Model` passed to the `Table` constructor

> `Body` uses **virtual scrolling**: only the rows visible in the viewport plus a small buffer are in the DOM at any time. A phantom `<div>` gives the scroll container its full height without rendering every row. A fixed pool of `Row` components is reused as the user scrolls — pool slots are rebound to new data via `setData()` only when their data index changes, avoiding redundant DOM work on resize. See `Body.ts` for the full implementation.

### Utilities

| File | Purpose |
|---|---|
| `AnchorType.ts`, `FillType.ts`, `Placement.ts`, `Position.ts` | Enums |
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

| Key | CSS variable | Affects |
|---|---|---|
| `bodyBg` | `--ts-ui-body-bg` | Page background; also the background of `Window` |
| `borderColor` | `--ts-ui-border-color` | Default border color for `Window` and other bordered components |
| `buttonBgBottom` | `--ts-ui-button-bg-bottom` | Bottom color of the button gradient; also used as the scrollbar thumb color |
| `buttonBgTop` | `--ts-ui-button-bg-top` | Top color of the button gradient; also used as the top of the table header gradient |
| `buttonBorderColor` | `--ts-ui-button-border` | Outline of `Button` and `ToggleButton` |
| `buttonPressedBg` | `--ts-ui-button-pressed-bg` | Background of a button while it is held down |
| `buttonPressedFg` | `--ts-ui-button-pressed-fg` | Text color of a button while it is held down |
| `buttonPressedShadow` | `--ts-ui-button-pressed-shadow` | Inset shadow on a pressed button |
| `buttonShadow` | `--ts-ui-button-shadow` | Drop shadow on unpressed buttons |
| `colorScheme` | *(set directly as `color-scheme`)* | Tells the browser to render native controls (checkboxes, scrollbars) in light or dark style. Use `'light'` or `'dark'`. |
| `gutterBg` | `--ts-ui-gutter-bg` | Background of the `Split` layout drag gutter; also used as the scrollbar track color |
| `inputBg` | `--ts-ui-input-bg` | Background of text inputs, password fields, text areas, checkboxes, and the table body |
| `tabButtonBg` | `--ts-ui-tab-button-bg` | Background of inactive tab buttons |
| `tableHeaderBorder` | `--ts-ui-table-header-border` | Bottom border separating the table header from the body |
| `tabToolbarBg` | `--ts-ui-tab-toolbar-bg` | Background of the tab button toolbar in the `Tab` layout |
| `tabToolbarBorder` | `--ts-ui-tab-toolbar-border` | Bottom border of the tab button toolbar |
| `textColor` | `--ts-ui-text-color` | Default text color for all components |
| `toggleSelectedBg` | `--ts-ui-toggle-selected-bg` | Background of a selected `ToggleButton` or `RadioButton` |
| `toggleSelectedShadow` | `--ts-ui-toggle-selected-shadow` | Inset shadow on a selected `ToggleButton` or `RadioButton` |

### Custom themes

Implement the `Theme` interface and pass it to `setTheme`:

```typescript
import { Theme, ThemeManager } from './Base/Theme.js';

const MyTheme: Theme = {
    ...DefaultTheme,
    bodyBg   : 'rgb(240, 248, 255)',
    textColor: 'rgb(10, 30, 60)',
    colorScheme: 'light',
};

ThemeManager.setTheme(MyTheme);
```

Components that need a theme value at construction time (rather than via a CSS variable) can call `ThemeManager.getTheme()` to read the currently active theme.

## Demo panels

Each tab in the running app corresponds to a `*Panel.ts` file that demonstrates one layout manager. All panels extend `LayoutTestPanel`.

`MiscPanel` is the most feature-rich: it shows floating `Window`s, a data `Table`, an `Image`, and various form components.

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

### Field mapping

Use `mapping` when the incoming JSON key differs from the field name:

```typescript
{ name: 'firstName', type: 'string', mapping: 'first_name' }
// incoming { first_name: 'Alice' } → record.get('firstName') === 'Alice'
```

## Suggestions for next steps

* **Add a test suite** — the project has no automated tests. Adding unit tests for the pure logic in `Util`, `Type`, layout constraint resolution, and `ButtonGroup` would catch regressions quickly and is a natural starting point before larger refactors.

* **Create an initialisation package** — add a separate `create-typescript-ui` (or similar) package whose sole purpose is to scaffold new projects. Running `npm create typescript-ui` (or `npx create-typescript-ui`) would generate a minimal project wired up with the library, a working `tsconfig.json`, and a Vite dev server, so consumers can get started without manually configuring dependencies or entry-point boilerplate.

* **Wire the data layer to components** — the `Store` / `Model` / `Proxy` data package is implemented (see [Data layer](#data-layer) above). The next step is binding components such as `List`, and `ComboBox` to a store so they react to its change events, decoupling data-fetching logic from rendering.

* **Build a Form component** — a container that accepts a `ModelRecord` and wires its child input components (`TextField`, `Checkbox`, `ComboBox`, etc.) to named record fields. Setting a record on the Form should populate each bound input, and changes in the inputs should call `record.set()` — providing two-way binding so the same record can be committed or rejected as a unit.

* **Extend theme support** — the current `Theme` interface covers colors and shadows. A natural next step is adding tokens for fonts (family, size, weight) and spacing (padding, margins, gaps). Consider also restructuring the key naming convention from flat camelCase (e.g. `tabToolbarBorder`) to a namespaced dot format (e.g. `tab.toolbar.border`) to better reflect component hierarchy and make the API easier to discover and extend. **Implementation note:** when setting CSS rule properties that contain `var()` references, always use `cssRule.style.setProperty('property-name', value)` rather than the camelCase shorthand setter (e.g. `cssRule.style.boxShadow = value`) — Chrome's shorthand setters perform eager value parsing and silently discard `var()` tokens, while `setProperty` stores the value as a raw token sequence and defers resolution to computed-value time.
