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
| `npm run dev` | Start Vite dev server on port 8015 with hot reload |
| `npm run build` | Production bundle to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Run strict TypeScript type check (no emit) |
| `npm run doc` | Generate TypeDoc documentation to `dist/docs/` |
| `npm run clean` | Delete `dist/` contents |

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
| `Fit` | Expands one child to fill the entire container |
| `Tab` | Tabbed interface with a button toolbar |
| `Border` | Five-region layout: north, south, east, west, center |
| `HBox` | Horizontal stack with configurable spacing |
| `VBox` | Vertical stack with configurable spacing |
| `Row` | Vertical sequence with gap control |
| `Column` | Horizontal sequence with gap control |
| `Grid` | Two-dimensional grid |
| `Split` | Two panes with a draggable resize gutter |
| `Card` | Stacked layers — one visible at a time |

### UI components

Located in `Base/component/`:

**Text and input**
- `Text`, `Label`, `TextField`, `PasswordField`, `TextArea`
- `Input`, `Checkbox`, `RadioButton`, `Slider`, `ComboBox`

**Buttons**
- `Button`, `ToggleButton`, `RadioButton`
- `ButtonGroup` — enforces single selection across radio/toggle buttons

**Display**
- `Image`, `Header`, `FontAwesomeIcon`
- `List`, `BulletedList`, `NumberedList`, `ListItem`
- `FieldSet`, `Legend`

**Containers**
- `Window` — draggable and resizable floating window
- `SplitGutter` — drag handle for the Split layout

**Table subsystem** (`Base/component/table/`):
- `Table`, `Header`, `Body`, `Footer`, `Row`
- Cell types: `String`, `Boolean`, `Number`, `Header`
- Pluggable cell editors and renderers
- `Model` / `Field` for data binding

`Body` uses **virtual scrolling**: only the rows visible in the viewport plus a small buffer are in the DOM at any time. A phantom `<div>` gives the scroll container its full height without rendering every row. A fixed pool of `Row` components is reused as the user scrolls — pool slots are rebound to new data via `setData()` only when their data index changes, avoiding redundant DOM work on resize. See `Body.ts` for the full implementation.

### Utilities

| File | Purpose |
|---|---|
| `Util.ts` | UUID generation, viewport size, scrollbar width |
| `Type.ts` | Type-checking utilities (`isBoolean`, `isInteger`, etc.) |
| `CSS.ts` | Dynamic CSS rule creation and lookup |
| `Event.ts` | Event delegation — centralized per-type listener map |
| `Insets.ts` | Padding/margin abstraction (top/right/bottom/left) |
| `Border.ts`, `BorderLine.ts` | Four-sided border management |
| `Point.ts`, `Size.ts` | Geometric primitives |
| `Position.ts`, `Placement.ts`, `AnchorType.ts`, `FillType.ts` | Enums |

## Demo panels

Each tab in the running app corresponds to a `*Panel.ts` file that demonstrates one layout manager. All panels extend `LayoutTestPanel`.

`MiscPanel` is the most feature-rich: it shows floating `Window`s, a data `Table`, an `Image`, and various form components.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Free for personal and educational use; commercial use is not permitted.

## Known bugs

None atm.

### Design / TODO items noted in source

- `Split` layout has open questions about gutter listener cleanup.
- `Tab` layout has a TODO to fix a naming issue in the tab button creation path.

## Suggestions for next steps

* **Add a test suite** — the project has no automated tests. Adding unit tests for the pure logic in `Util`, `Type`, layout constraint resolution, and `ButtonGroup` would catch regressions quickly and is a natural starting point before larger refactors.

* **Create an initialisation package** — add a separate `create-typescript-ui` (or similar) package whose sole purpose is to scaffold new projects. Running `npm create typescript-ui` (or `npx create-typescript-ui`) would generate a minimal project wired up with the library, a working `tsconfig.json`, and a Vite dev server, so consumers can get started without manually configuring dependencies or entry-point boilerplate.

* **Implement a Store / Model / Proxy data layer** — introduce an ExtJS-style data package where a `Model` defines the shape of a record (fields and types), a `Proxy` handles the transport concern (REST, WebSocket, local memory), and a `Store` orchestrates loading, caching, sorting, and filtering of model instances. Components such as `Table`, `List`, and `ComboBox` would bind to a store and react to its change events, decoupling data-fetching logic from rendering and making it straightforward to swap backends or add offline support without touching component code.

* **Extend theme support** — the current `Theme` interface covers colors and shadows. A natural next step is adding tokens for fonts (family, size, weight) and spacing (padding, margins, gaps). Consider also restructuring the key naming convention from flat camelCase (e.g. `tabToolbarBorder`) to a namespaced dot format (e.g. `tab.toolbar.border`) to better reflect component hierarchy and make the API easier to discover and extend. **Implementation note:** when setting CSS rule properties that contain `var()` references, always use `cssRule.style.setProperty('property-name', value)` rather than the camelCase shorthand setter (e.g. `cssRule.style.boxShadow = value`) — Chrome's shorthand setters perform eager value parsing and silently discard `var()` tokens, while `setProperty` stores the value as a raw token sequence and defers resolution to computed-value time.
