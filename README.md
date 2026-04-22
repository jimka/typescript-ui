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

- `TextField` and `PasswordField` inherit from `Text` but should inherit from `Input`.
- `ToggleButton` is marked as a "hack" and needs a proper implementation.
- `ListItem` and `Option` are both marked `TODO: Fix!`.
- `Split` layout has open questions about gutter listener cleanup.
- Border/button constructors accept too many positional parameters — a builder pattern would improve call sites.

## Suggestions for next steps

1. ~~**Correct the inheritance of `TextField` and `PasswordField`** — move them from `Text` to `Input` to reflect that they are form inputs, not text renderers. This will likely surface other API inconsistencies to clean up.~~

2. ~~**Replace positional border/button constructors with option objects** — large constructor signatures are fragile; switching to `{ width, style, color }` objects would improve readability and prevent argument-order mistakes.~~

3. ~~**Implement `ToggleButton` properly** — remove the "hack" and give it a clean selected-state model consistent with `RadioButton`.~~

4. ~~**Resolve `ListItem` and `Option` TODOs** — clarify what is broken and fix or remove these components.~~

5. ~~**Add cross-browser support** — currently Chrome-only. Audit layout calculations that rely on Chrome-specific DOM behavior (especially text measurement via canvas) and add compatibility for Firefox and Safari.~~

6. ~~**Re-layout parent when a `Text` component's preferred size changes**~~ — calling `setText()` with longer text updates the preferred size but does not trigger `doLayout()` on the parent container, causing text to be clipped. The fix likely belongs in `calculateSize()` or `setText()`, propagating a size-change notification up to the nearest layout manager.

7. ~~**Introduce virtual scrolling for `Table`**~~ — implemented: only the visible rows ± a small buffer are rendered; a phantom element provides the correct scroll height; the row pool is reused as the user scrolls. Resize is fast (data rebinding is skipped when the scroll position hasn't changed). A minor scroll flicker remains — inherent to compositor-driven scrolling in the browser; fixing it would require a transform-based positioning strategy.

8. **Add a test suite** — the project has no automated tests. Adding unit tests for the pure logic in `Util`, `Type`, layout constraint resolution, and `ButtonGroup` would catch regressions quickly and is a natural starting point before larger refactors.

9. ~~**Remove or extract the 550-line commented block in `MiscPanel.ts`** — move large test datasets to fixture files so the panel code stays readable.~~

10. ~~**Upgrade Vite** — the project uses Vite 2.9 (released 2022). Upgrading to Vite 5+ would bring faster cold starts, better HMR, and security fixes.~~

11. **Consider publishing as a library** — the framework is self-contained. Adding a library build entry in `vite.config.ts` would let it be consumed as an npm package by other projects.
