# Changelog

Release history for `@jimka/typescript-ui`.

## 0.2.0

**Breaking:** `Component.setPreferredSize`, `setMinSize`, and `setMaxSize` now
take a single `Size` object instead of two loose numbers, matching the
`Size`-typed `preferredSize` / `minSize` / `maxSize` options-bag fields and
the existing `setSize(size: Size)`. There is no `(width, height)` overload.

```typescript
// Before
sidebar.setPreferredSize(240, 0);

// After
sidebar.setPreferredSize({ width: 240, height: 0 });
```

**Breaking:** event listeners registered through `Event.addListener`,
`Event.addSubtreeListener`, and `Event.addViewportListener` now consume an
event by **returning** a disposition (`true`, or `{ stop, prevent }`) rather
than calling `stopPropagation()` themselves. A direct `stopPropagation()` call
still halts native propagation but no longer influences the dispatcher's
subtree walk. `async` listeners no longer typecheck, since `Promise<void>` is
not a disposition.

See [Migration](/reference/migration#upgrading-from-0-1-x-to-0-2-0) for the full upgrade note.

## 0.1.0

First public release — the initial published surface of `@jimka/typescript-ui`, a
layout-driven, retained-mode web UI framework written in TypeScript (closer to Java
Swing than to React: every component is a rectangle absolutely positioned and sized in
JavaScript by a layout manager in a single `doLayout()` pass; no flexbox, CSS grid, or
document flow). The public API is **subpath-only** — there is no bare
`@jimka/typescript-ui` import; consumers import from `@jimka/typescript-ui/<group>`.
Each subpath ships as its own ESM bundle plus a `.d.ts` declaration barrel under
`dist/lib/`. Licensed under PolyForm Noncommercial 1.0.0.

The capabilities below cover the primary components of each entry point.

### `@jimka/typescript-ui/core`

Framework runtime shared by every component.

- **Component / Container / Panel / Form** — the component base classes; `Panel` adds
  native auto-scroll (`autoScroll`) and a synced overlay-scrollbar style, `Form` bakes a
  semantic `<form>` with submit handling.
- **Binding** (+ `Bindable`, `BindingAccessors`) — two-way synchronisation between a
  `ModelRecord` and a set of UI components, with a `beforerecord` veto.
- **ThemeManager, BaseTheme, ClassicTheme, DarkTheme, ModernTheme** —
  token-based theming; `ModernTheme` is the default, `ClassicTheme` the gradient light
  look, `DarkTheme` the dark variant.
- **Event** — the DOM-event seam (route DOM events through `Event`, never
  `addEventListener`); semantic events flow through `on` / `off` / `emit`.
- **Util** — exact text metrics, self-determined baselines, optical centring.
- **DOM, ProductionDOMSink, ProductionDOMSource** — the testable DOM
  read/write seam (sink/source), with production implementations.
- **StyleTarget, StyleRule, InlineStyle** — styling primitives behind the typed setters.

### `@jimka/typescript-ui/overlay`

Floating UI, docking, and drag-and-drop.

- **Window, TabWindow** — floating, draggable, resizable windows
  with maximize/minimize/snap; `TabWindow`'s interior is itself a tab strip.
- **Dialog** (+ `DialogTitleBar`, `DialogButtons`) — modal dialogs with title bar,
  scrollable content, and preset confirm/ok/cancel/close button rows.
- **Menu** — context / dropdown menu (right-click-rebuild and persistent modes).
- **Popover, Tooltip** — anchored click popover with arrow tail; hover tooltip singleton.
- **Notification, NotificationHistoryButton** — auto-dismissing toasts with a browsable
  history.
- **Drawer** — edge-anchored sliding panel.
- **Rail** — an activity rail that hosts collapsible drawers.
- **Dock** — a dockable multi-panel workspace (tear-out, redock, edge-drop-to-split).

### `@jimka/typescript-ui/layout`

Layout managers — the framework's answer to CSS layout.

- **HBox / VBox** (`BoxLayout`) — single-axis rows/columns with `preferred` and `equal`
  modes, weights, and justification.
- **HFlow / VFlow** (`FlowLayout`) — wrapping flows.
- **Border** — five named regions (north/south/east/west/center).
- **Grid** (`GridConstraints`, `GridTrack`) — a tracked rows-and-columns grid with
  spanning.
- **Split** — resizable panes with draggable gutters, collapsible, size-persisting.
- **Tab** — tabbed panels sharing one region.
- **Card** — one-child-at-a-time card stack.
- **Fit** — stretch a single child to fill.
- **Accordion** (`AccordionConstraints`) — collapsible animated sections, resizable and
  weighted-fill.
- **Absolute / Anchor** (`AnchorConstraints`, `AnchorType`, `FillType`) — absolute and
  anchored positioning.

### `@jimka/typescript-ui/data`

Model / store / proxy data layer.

- **Model** (+ `AbstractModel`), **Field** — typed record schemas (field types,
  defaults, raw-data mapping).
- **ModelRecord** — a single editable record.
- **Store, MemoryStore, AjaxStore** (+ `AbstractStore`) — in-memory and REST-backed
  record collections with sort/filter/pagination and change events.
- **TreeStore** — hierarchical (parent/child) store.
- **Proxy, MemoryProxy, AjaxProxy, WebStorageProxy** (+ `AjaxError`) — the read/write
  backends behind stores.
- **JsonReader, JsonWriter** — JSON payload decode/encode for proxies.

### `@jimka/typescript-ui/validation`

- **FieldDecorator, ValidationRule, FieldValidationResult** — field-level validation
  rules and results.

### `@jimka/typescript-ui/component/input`

Form controls and text.

- **Text, Label, Link** — static text, form label, in-app text link.
- **TextField, TextArea, PasswordField, UsernameField** — text inputs (the latter two
  preset browser-credential autocomplete).
- **Checkbox, RadioButton, Toggle, Slider** — custom-drawn boolean/range controls.
- **ComboBox, AutoCompleteField** — store-bound dropdown select and type-ahead field.
- **NumberSpinner** — numeric input with spin buttons.
- **DateField, TimeField, DateTimeField** — date/time picker fields with their picker
  dropdowns (`DatePickerDropdown`, `TimePickerDropdown`, `DateTimePickerDropdown`,
  `PickerColumn`).
- **FileField** — file chooser and drag-to-drop file zone.
- Abstract bases (`AbstractInput`, `AbstractBooleanInput`, `AbstractPickerField`,
  `TextInput`) for building custom controls.

### `@jimka/typescript-ui/component/button`

- **Button, ToggleButton, SplitButton, MenuButton** — push,
  two-state, split-with-dropdown, menu-opening.

### `@jimka/typescript-ui/component/display`

Read-only display components.

- **Image, Glyph, IconText, IconLabel** — image, Font Awesome icon, and
  icon+text/label composites.
- **Markdown** — renders a Markdown string as a live DOM subtree (uses `marked`).
- **ProgressBar, ProgressSpinner** — determinate/indeterminate progress and a
  busy spinner.
- **Canvas, WebGLCanvas** — 2D and WebGL drawing surfaces.
- **Video, VideoPlayer** — media element and a player with chrome.

### `@jimka/typescript-ui/component/editor`

- **CodeEditor** — syntax-highlighting, one-command-formatting editor wrapping
  CodeMirror 6, with five built-in languages (HTML, JavaScript, JSON, Markdown, SQL) and
  a `registerLanguage` registry.
- **MarkdownEditor** — WYSIWYG rich-text editor (Lexical) whose value is a Markdown
  string, with an optional raw-source mode.

### `@jimka/typescript-ui/component/chart`

- **LineChart, BarChart** — store-bindable SVG charts.
  d3 (`d3-array`, `d3-scale`, `d3-shape`) is bundled into this subpath.

### `@jimka/typescript-ui/component/list`

- **List, MultiSelectList** — custom-rendered single- and multi-selection list boxes
  with keyboard navigation and store binding.
- **BulletedList, NumberedList** — static ordered/unordered lists.

### `@jimka/typescript-ui/component/container`

Composite containers and chrome.

- **FieldSet, LabeledFieldSet, LabeledGrid** — bordered/legended and chrome-less
  baseline-aligned labelled-field forms.
- **TabPanel, AccordionPanel** — self-managing tab and accordion containers.
- **StatusBar** — bottom status strip with message and indicator zones.
- **Spacer** — layout filler.

### `@jimka/typescript-ui/component/menubar`

- **MenuBar, MenuBarButton** — application menu bar.
- **ToolBar, ToolBarSeparator** — a horizontal/vertical toolbar with roving focus.

### `@jimka/typescript-ui/component/table`

Data-bound tables.

- **Table, TablePanel** — an editable data grid (per-column or per-cell editor/renderer
  types) and a store-bound panel with an add/remove/sync toolbar.
- **TreeTable, TreeTablePanel** — tables whose rows form an expandable hierarchy.
- **TableExporter** — export table data.
- Typed **cells** (`BooleanCell`, `NumberCell`, `StringCell`, `DateCell`, `TimeCell`,
  `DateTimeCell`, `GlyphCell`, `ComboCell`, `DynamicCell`, …), **editors**
  (`CellEditor` + Boolean/Number/String/Date/Time/DateTime/Combo, `CellEditorPool`), and
  **renderers** (`CellRenderer` + Number/String/Date/Time/DateTime/Glyph/Combo/Link/Tree)
  for building custom columns.

### `@jimka/typescript-ui/component/tree`

- **Tree** — a virtual-scrolling collapsible node view.
- **TreeNodeRenderer** (`LabelTreeNodeRenderer`, `IconLabelTreeNodeRenderer`) — pluggable
  per-row renderers.

### `@jimka/typescript-ui/component/diagram`

Node-and-edge diagram rendering. **Requires the optional `elkjs` peer dependency** —
`ElkLayoutEngine` lazily `import()`s `elkjs` and it is left external in the library
build, so a consumer using this subpath must install `elkjs` themselves; every other
subpath works without it.

- **DiagramView** — the diagram surface with pan/zoom and pluggable node renderers.

### `@jimka/typescript-ui/glyphs`

The bundled Font Awesome Free icon registry, importable individually or as namespaces:

- **`@jimka/typescript-ui/glyphs/solid`** (~2000 icons), **`/regular`** (~273), and
  **`/brands`** (~587) — each importable as a whole namespace (`glyphs/solid`) or as a
  single glyph (`glyphs/solid/<name>`); **`@jimka/typescript-ui/glyphs`** re-exports all
  three as `solid` / `regular` / `brands` namespaces. Registered names feed the `Glyph`
  display component and any glyph slot (buttons, tree toggles, table cells).

### Packaging notes

- **Optional peer:** `elkjs` (`^0.10.0`) — required only for
  `@jimka/typescript-ui/component/diagram`.
- **Bundled third-party code:** d3 (`d3-array` / `d3-scale` / `d3-shape`) is bundled into
  the chart subpath; the Manrope variable font ships with the package.
- **Externalized runtime dependencies** (declared as regular `dependencies`, so a package
  manager installs them for the consumer): the CodeMirror family (editor), the Lexical
  family (Markdown editor), `marked` (Markdown display), `prettier` and `sql-formatter`
  (code-editor formatting).
