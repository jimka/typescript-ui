# Subpath Exports & Folder Mirror — Implementation Plan

## Overview

Today every public symbol of `@jimka/typescript-ui` is re-exported from a single barrel at [src/typescript/lib/index.ts](../src/typescript/lib/index.ts), and on disk the bulk of the API lives flat in [src/typescript/lib/](../src/typescript/lib/) and [src/typescript/lib/component/](../src/typescript/lib/component/). The `lib/index.ts` file is already sliced into commented sections (Core, Primitives, Layout, Components — input/buttons/display/lists/containers, Data, Validation, Table) — those comment groups are the de-facto taxonomy.

This plan promotes the comment groups into real folders and real package subpaths. After it lands:

- The on-disk tree mirrors the export tree exactly: `lib/<group>/<File>.ts` ↔ `@jimka/typescript-ui/<group>`.
- Each group folder owns an `index.ts` barrel that the package's `exports` map points at.
- The root `@jimka/typescript-ui` barrel is **removed**: every consumer must import from a subpath. This is a deliberate breaking change — the package isn't published yet, so the only consumers are the ~19 demo panels under [src/typescript/](../src/typescript/), which are rewritten in the same change set.
- The library build at [vite.lib.config.ts](../vite.lib.config.ts) becomes a multi-entry build, one bundle per subpath, so consumers tree-shake by subpath rather than relying on `sideEffects: false` to prune a megabundle.

The reorganization is structural, not behavioural — no public API signatures change beyond their import paths.

---

## Architecture Decisions

### Strict folder/export mirror, but only at the comment-group level

The user's stated rule is "folders and exports mirror each other." Taken literally, every existing nested folder ([data/proxy/](../src/typescript/lib/data/proxy/), [component/table/cell/](../src/typescript/lib/component/table/cell/), [component/table/cell/editor/](../src/typescript/lib/component/table/cell/editor/), [component/table/cell/renderer/](../src/typescript/lib/component/table/cell/renderer/)) would get its own subpath. That's nine subpaths under `table/` alone, for an API surface that today's `index.ts` treats as a single comment group "Table subsystem".

We mirror at the granularity of the existing `index.ts` comment groups instead — one subpath per group. Sub-folders inside a group (e.g. `table/cell/renderer/`) stay as folders for code organization but are re-exported through the group's barrel. This honours both the on-disk-mirror principle and the existing taxonomy without exploding the public surface.

### Root `@jimka/typescript-ui` is removed

There is no published consumer yet, so the cost of dropping the root is just rewriting the demo panels. The benefit is a single, consistent rule — *every* import goes through a subpath — with no "well, you can also `import { … } from '@jimka/typescript-ui'` for back-compat" footnote. Demos become a faithful preview of how a real consumer would write code against the published package.

### File moves preserve git history via a two-pass commit sequence

Per [plans/implemented/package-imports-and-lib-rename.md:15-25](implemented/package-imports-and-lib-rename.md#L15-L25), git detects renames at diff time using ~50% content similarity. A naive single commit that both `git mv`s a file *and* rewrites every relative import inside it can drop similarity below the threshold for files near the bottom of import graphs (small files with many imports), silently fragmenting blame.

Mitigation: precede the moves with a `~/`-alias sweep so that, when a file is moved, **its own contents do not need to change** — its imports already use the location-independent `~/Foo.js` form. Only imports of the moved file (in *other* files) get updated, which is mechanical search-replace. The `~/` alias was added in the prior package-rename plan but never adopted internally; this plan adopts it under duress.

### Per-folder `index.ts` barrels

Each group folder ships an `index.ts` that re-exports every public symbol in the folder (and in any nested folders the group encompasses, e.g. `data/index.ts` re-exports `data/proxy/*`). The `package.json` `exports` map points each subpath at the barrel, not at individual files, so:

- Consumers import from a stable subpath; nothing breaks if a file is later moved within a group.
- The Vite library build has a single entry per subpath (the barrel), keeping [vite.lib.config.ts](../vite.lib.config.ts) tractable.
- Per-folder barrels also let the demo files use `import { HBox, VBox, Tab } from '@jimka/typescript-ui/layout'` without listing every file.

### Multi-entry Vite library build, ES-only

[vite.lib.config.ts](../vite.lib.config.ts) currently emits a single `typescript-ui.es.js` + `typescript-ui.umd.js`. With one bundle per subpath, UMD is dropped — Vite's `lib.entry` accepts a record only when emitting ES (UMD is single-entry by definition, and modern consumers don't use UMD). [package.json:6-9](../package.json#L6-L9) loses the `main`/`module` top-level fields; only the `exports` map matters under modern Node resolution.

If a UMD/CDN bundle is later needed, that's a separate concern — addressed by adding a second `vite.lib.umd.config.ts` that bundles the public surface into a single global. Out of scope here.

### `Binding`/`Bindable` go into `core/`, not their own bucket

`Binding` and `Bindable` form a tiny section in today's `index.ts` (lines 3-5). They're foundational plumbing used by both components and the data layer. Splitting them into a one-file `binding/` group adds a subpath that always travels with `core/`. Folding them into `core/` keeps the public surface narrower without losing anything. (If they later grow, promoting them to `binding/` is a one-step extraction.)

### `AccordionHeader` moves from "Layout" to `component/container/`

Today [lib/component/AccordionHeader.ts](../src/typescript/lib/component/AccordionHeader.ts) lives under `component/` but is exported from the "Layout managers" comment group ([index.ts:67-69](../src/typescript/lib/index.ts#L67-L69)) because it's logically associated with the Accordion layout. It's a `Component` subclass, not a `LayoutManager`, so it belongs in `component/container/` alongside other container-style chrome (`WindowHeader`, `WindowBorder`, `SplitGutter`, `Legend`). Consumers that want both write `import { Accordion } from '@jimka/typescript-ui/layout'; import { AccordionHeader } from '@jimka/typescript-ui/component/container';`.

### Name collisions resolved naturally by subpath

`Border` exists as both a primitive (`lib/Border.ts` — a visual border around a Component) and a layout manager (`lib/layout/Border.ts`). The current `index.ts` aliases the second as `BorderLayout` ([index.ts:72-73](../src/typescript/lib/index.ts#L72-L73)). With subpath exports the collision is gone at the package level — `@jimka/typescript-ui/primitive` exports `Border`; `@jimka/typescript-ui/layout` exports `Border`. The `BorderLayout` alias is **dropped**. Consumers that need both write `import { Border as BorderLayout } from '@jimka/typescript-ui/layout';` themselves, which is idiomatic ES.

Likewise `Header`/`Body`/`Row`/`Column` exist in both `component/table/` and other places. Their `Table*` aliases ([index.ts:218-224](../src/typescript/lib/index.ts#L218-L224)) are dropped — `@jimka/typescript-ui/component/table` exports them under their natural names.

### Internal-only files stay in their group folder, off the barrel

A few files exist on disk but are not currently re-exported from `index.ts`: `AutoCompleteDropdown.ts`, `AutoCompleteItem.ts`, `DialogBackdrop.ts`, `TreeRow.ts`, `Validator.ts`, `ValidationResult.ts`, `Type.ts`, `CSS.ts`, `data/StoreWorker.ts`, `data/StoreWorkerClient.ts`. These are implementation details. They move into the group folder that holds their dependents (e.g. `AutoCompleteDropdown.ts` → `component/input/`, `Type.ts` and `CSS.ts` → `core/`) but are **not** added to the group's `index.ts` barrel. Source-internal imports continue to use `~/group/File.js`.

---

## New Folder Layout

```
src/typescript/lib/
├── core/                       (formerly: Binding + Theming + Core sections of index.ts)
│   ├── index.ts                ← barrel
│   ├── BaseObject.ts
│   ├── Event.ts
│   ├── Util.ts
│   ├── Callable.ts
│   ├── Component.ts
│   ├── Panel.ts
│   ├── Aria.ts
│   ├── RovingTabIndex.ts
│   ├── Body.ts
│   ├── ButtonGroup.ts
│   ├── Window.ts
│   ├── Menu.ts
│   ├── Tooltip.ts
│   ├── Notification.ts
│   ├── Dialog.ts
│   ├── Theme.ts
│   ├── Binding.ts
│   ├── Bindable.ts
│   ├── Type.ts                 (internal, not in barrel)
│   └── CSS.ts                  (internal, not in barrel)
├── primitive/
│   ├── index.ts
│   ├── Border.ts
│   ├── BorderLine.ts
│   ├── BorderStyle.ts
│   ├── Insets.ts
│   ├── Point.ts
│   ├── Position.ts
│   ├── Placement.ts
│   └── Size.ts
├── layout/                     (already exists; barrel added; Border layout stays)
│   ├── index.ts
│   ├── LayoutManager.ts
│   ├── LayoutConstraints.ts
│   ├── AnchorType.ts
│   ├── FillType.ts
│   ├── Absolute.ts
│   ├── Fit.ts
│   ├── Accordion.ts
│   ├── AccordionConstraints.ts
│   ├── Tab.ts
│   ├── Border.ts
│   ├── HBox.ts
│   ├── VBox.ts
│   ├── Row.ts
│   ├── Column.ts
│   ├── Grid.ts
│   ├── Split.ts
│   ├── Card.ts
│   └── Table.ts                (currently present; review whether public)
├── data/                       (already exists; barrel added; proxy/ folded in)
│   ├── index.ts                ← also re-exports proxy/*
│   ├── AbstractModel.ts
│   ├── Field.ts
│   ├── Model.ts
│   ├── ModelRecord.ts
│   ├── AbstractStore.ts
│   ├── Store.ts
│   ├── MemoryStore.ts
│   ├── AjaxStore.ts
│   ├── FilterDescriptor.ts
│   ├── StoreWorker.ts          (internal)
│   ├── StoreWorkerClient.ts    (internal)
│   └── proxy/
│       ├── Proxy.ts
│       ├── MemoryProxy.ts
│       └── AjaxProxy.ts
├── validation/                 (already exists; barrel added)
│   ├── index.ts
│   ├── FieldDecorator.ts
│   ├── ValidationRule.ts
│   ├── ValidationResult.ts     (internal — only `FieldValidationResult` type is public)
│   └── Validator.ts            (internal)
└── component/
    ├── input/
    │   ├── index.ts
    │   ├── Text.ts
    │   ├── Label.ts
    │   ├── Input.ts
    │   ├── TextInput.ts
    │   ├── TextField.ts
    │   ├── DateField.ts
    │   ├── TimeField.ts
    │   ├── PasswordField.ts
    │   ├── TextArea.ts
    │   ├── Checkbox.ts
    │   ├── RadioButton.ts
    │   ├── Slider.ts
    │   ├── ComboBox.ts
    │   ├── Option.ts
    │   ├── AutoCompleteField.ts
    │   ├── AutoCompleteDropdown.ts (internal)
    │   ├── AutoCompleteItem.ts     (internal)
    │   ├── NumberSpinner.ts
    │   └── SpinButton.ts
    ├── button/
    │   ├── index.ts
    │   ├── Button.ts
    │   ├── ToggleButton.ts
    │   └── TabCloseButton.ts
    ├── display/
    │   ├── index.ts
    │   ├── Header.ts
    │   ├── Image.ts
    │   ├── FontAwesomeIcon.ts
    │   ├── ProgressBar.ts
    │   ├── ProgressSpinner.ts
    │   └── PaginationBar.ts
    ├── list/
    │   ├── index.ts
    │   ├── List.ts
    │   ├── MultiSelectList.ts
    │   ├── AbstractListComponent.ts
    │   ├── BulletedList.ts
    │   ├── BulletedListItemStyle.ts
    │   ├── NumberedList.ts
    │   ├── NumberedListItemStyle.ts
    │   └── ListItem.ts
    ├── container/
    │   ├── index.ts
    │   ├── FieldSet.ts
    │   ├── Legend.ts
    │   ├── MenuItem.ts
    │   ├── MenuSeparator.ts
    │   ├── Scrollbar.ts
    │   ├── VirtualScroller.ts
    │   ├── SplitGutter.ts
    │   ├── WindowBorder.ts
    │   ├── WindowHeader.ts
    │   ├── AccordionHeader.ts   (moved from component/)
    │   └── DialogBackdrop.ts    (internal)
    ├── menubar/                 (already exists; barrel added)
    │   ├── index.ts
    │   ├── MenuBar.ts
    │   └── MenuBarButton.ts
    ├── table/                   (already exists; barrel added; cell/ stays nested)
    │   ├── index.ts             ← re-exports own files + cell/, cell/editor/, cell/renderer/
    │   ├── Table.ts
    │   ├── TablePanel.ts
    │   ├── Column.ts
    │   ├── ColumnConfig.ts
    │   ├── TableExporter.ts
    │   ├── Header.ts
    │   ├── Body.ts
    │   ├── Footer.ts
    │   ├── Row.ts
    │   └── cell/
    │       ├── Cell.ts
    │       ├── Default.ts
    │       ├── Header.ts
    │       ├── Boolean.ts
    │       ├── Number.ts
    │       ├── String.ts
    │       ├── Date.ts
    │       ├── Time.ts
    │       ├── DateTime.ts
    │       ├── editor/
    │       │   ├── CellEditor.ts, Boolean.ts, Number.ts, String.ts, Date.ts, Time.ts, DateTime.ts
    │       └── renderer/
    │           ├── CellRenderer.ts, Number.ts, String.ts, Date.ts, Time.ts, DateTime.ts
    └── tree/                    (already exists; barrel added)
        ├── index.ts
        ├── Tree.ts
        ├── TreeNode.ts
        └── TreeRow.ts           (internal if not currently exported)
```

The current top-level [src/typescript/lib/index.ts](../src/typescript/lib/index.ts) is **deleted**.

---

## Public Subpath Inventory

| Subpath | Source Barrel | Symbols (summary) |
|---|---|---|
| `@jimka/typescript-ui/core` | `lib/core/index.ts` | `BaseObject`, `Event`, `Util`, `callable`, `Callable`, `Component` (+ types), `Panel`, `Aria`, `RovingTabIndex`, `Body`, `ButtonGroup`, `Window`, `Menu`, `Tooltip`, `Notification`, `Dialog`, `ThemeManager`, `DefaultTheme`, `DarkTheme`, `Theme`, `Binding`, `Bindable`, `BindingAccessors` |
| `@jimka/typescript-ui/primitive` | `lib/primitive/index.ts` | `Border` (+ options), `BorderLine`, `BorderStyle`, `Insets`, `Point`, `Position`, `Placement`, `Size` |
| `@jimka/typescript-ui/layout` | `lib/layout/index.ts` | `LayoutManager`, `LayoutConstraints`, `AnchorType`, `FillType`, `Absolute`, `Fit`, `Accordion` (+ `AccordionConstraints`, `SectionToggleCallback`), `Tab`, `Border`, `HBox`, `VBox`, `Row`, `Column`, `Grid`, `Split`, `Card` (each with its `Options` type) |
| `@jimka/typescript-ui/data` | `lib/data/index.ts` | `AbstractModel`, `Field`, `Model`, `ModelRecord`, `AbstractStore`, `Store`, `MemoryStore`, `AjaxStore`, `FilterDescriptor`, `Proxy`, `MemoryProxy`, `AjaxProxy` (each with its types) |
| `@jimka/typescript-ui/validation` | `lib/validation/index.ts` | `FieldDecorator`, `ValidationRule`, `FieldValidationResult` |
| `@jimka/typescript-ui/component/input` | `lib/component/input/index.ts` | `Text`, `Label`, `Input`, `TextInput`, `TextField`, `DateField`, `TimeField`, `PasswordField`, `TextArea`, `Checkbox`, `RadioButton`, `Slider`, `ComboBox`, `Option`, `AutoCompleteField` (+ config + match-mode), `NumberSpinner`, `SpinButton` |
| `@jimka/typescript-ui/component/button` | `lib/component/button/index.ts` | `Button`, `ToggleButton`, `TabCloseButton` |
| `@jimka/typescript-ui/component/display` | `lib/component/display/index.ts` | `Header`, `Image`, `FontAwesomeIcon`, `ProgressBar`, `ProgressSpinner`, `PaginationBar` |
| `@jimka/typescript-ui/component/list` | `lib/component/list/index.ts` | `List`, `MultiSelectList`, `AbstractListComponent`, `BulletedList`, `BulletedListItemStyle`, `NumberedList`, `NumberedListItemStyle`, `ListItem` |
| `@jimka/typescript-ui/component/container` | `lib/component/container/index.ts` | `FieldSet`, `Legend`, `MenuItem`, `MenuSeparator`, `Scrollbar`, `VirtualScroller`, `SplitGutter`, `WindowBorder` (+ `Direction`), `WindowHeader`, `AccordionHeader` |
| `@jimka/typescript-ui/component/menubar` | `lib/component/menubar/index.ts` | `MenuBar`, `MenuBarButton` |
| `@jimka/typescript-ui/component/table` | `lib/component/table/index.ts` | `Table`, `TablePanel`, `Column`, `ColumnConfig`, `ColumnSpec`, `TableExporter`, `ExportOptions`, `Header`, `Body`, `FooterRow`, `Row`, `Cell`, `DefaultCell`, `HeaderCell`, `BooleanCell`, `NumberCell`, `StringCell`, `DateCell`, `TimeCell`, `DateTimeCell`, `CellEditor`, all `*Editor`s, `CellRenderer`, all `*Renderer`s |
| `@jimka/typescript-ui/component/tree` | `lib/component/tree/index.ts` | `Tree`, `TreeNode` |

---

## Build Configuration

### `package.json`

Replace the current top-level `main` / `module` / `types` (lines 6-8) and the single `exports` entry (lines 9-14) with a subpath-only `exports` map. Drop `main` and `module` (legacy fields, ignored under modern resolution when `exports` is present).

```jsonc
{
  "name": "@jimka/typescript-ui",
  "version": "1.0.0",
  "license": "LicenseRef-PolyForm-Noncommercial-1.0.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist/lib"],
  "exports": {
    "./core":                { "import": "./dist/lib/core.es.js",                "types": "./dist/lib/types/core/index.d.ts" },
    "./primitive":           { "import": "./dist/lib/primitive.es.js",           "types": "./dist/lib/types/primitive/index.d.ts" },
    "./layout":              { "import": "./dist/lib/layout.es.js",              "types": "./dist/lib/types/layout/index.d.ts" },
    "./data":                { "import": "./dist/lib/data.es.js",                "types": "./dist/lib/types/data/index.d.ts" },
    "./validation":          { "import": "./dist/lib/validation.es.js",          "types": "./dist/lib/types/validation/index.d.ts" },
    "./component/input":     { "import": "./dist/lib/component/input.es.js",     "types": "./dist/lib/types/component/input/index.d.ts" },
    "./component/button":    { "import": "./dist/lib/component/button.es.js",    "types": "./dist/lib/types/component/button/index.d.ts" },
    "./component/display":   { "import": "./dist/lib/component/display.es.js",   "types": "./dist/lib/types/component/display/index.d.ts" },
    "./component/list":      { "import": "./dist/lib/component/list.es.js",      "types": "./dist/lib/types/component/list/index.d.ts" },
    "./component/container": { "import": "./dist/lib/component/container.es.js", "types": "./dist/lib/types/component/container/index.d.ts" },
    "./component/menubar":   { "import": "./dist/lib/component/menubar.es.js",   "types": "./dist/lib/types/component/menubar/index.d.ts" },
    "./component/table":     { "import": "./dist/lib/component/table.es.js",     "types": "./dist/lib/types/component/table/index.d.ts" },
    "./component/tree":      { "import": "./dist/lib/component/tree.es.js",      "types": "./dist/lib/types/component/tree/index.d.ts" }
  }
}
```

No `"."` entry — bare `import '@jimka/typescript-ui'` deliberately fails.

### `vite.lib.config.ts`

Replace the single-entry config ([vite.lib.config.ts:3-15](../vite.lib.config.ts#L3-L15)) with a multi-entry one. ES-only.

```ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const r = (p: string) => resolve(__dirname, 'src/typescript/lib', p)

export default defineConfig({
  build: {
    lib: {
      entry: {
        'core':                r('core/index.ts'),
        'primitive':           r('primitive/index.ts'),
        'layout':              r('layout/index.ts'),
        'data':                r('data/index.ts'),
        'validation':          r('validation/index.ts'),
        'component/input':     r('component/input/index.ts'),
        'component/button':    r('component/button/index.ts'),
        'component/display':   r('component/display/index.ts'),
        'component/list':      r('component/list/index.ts'),
        'component/container': r('component/container/index.ts'),
        'component/menubar':   r('component/menubar/index.ts'),
        'component/table':     r('component/table/index.ts'),
        'component/tree':      r('component/tree/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.es.js`,
    },
    outDir: 'dist/lib',
    sourcemap: true,
    minify: 'oxc',
  },
})
```

### `tsconfig.json`

[tsconfig.json:13-14](../tsconfig.json#L13-L14) currently has:

```jsonc
"paths": {
    "@jimka/typescript-ui": ["./src/typescript/lib/index.ts"],
    "~/*": ["./src/typescript/lib/*"]
}
```

Replace with one path entry per subpath (so `tsc` resolves the new bare specifiers in demo files). Keep `~/*` for internal use.

```jsonc
"paths": {
    "@jimka/typescript-ui/core":                ["./src/typescript/lib/core/index.ts"],
    "@jimka/typescript-ui/primitive":           ["./src/typescript/lib/primitive/index.ts"],
    "@jimka/typescript-ui/layout":              ["./src/typescript/lib/layout/index.ts"],
    "@jimka/typescript-ui/data":                ["./src/typescript/lib/data/index.ts"],
    "@jimka/typescript-ui/validation":          ["./src/typescript/lib/validation/index.ts"],
    "@jimka/typescript-ui/component/input":     ["./src/typescript/lib/component/input/index.ts"],
    "@jimka/typescript-ui/component/button":    ["./src/typescript/lib/component/button/index.ts"],
    "@jimka/typescript-ui/component/display":   ["./src/typescript/lib/component/display/index.ts"],
    "@jimka/typescript-ui/component/list":      ["./src/typescript/lib/component/list/index.ts"],
    "@jimka/typescript-ui/component/container": ["./src/typescript/lib/component/container/index.ts"],
    "@jimka/typescript-ui/component/menubar":   ["./src/typescript/lib/component/menubar/index.ts"],
    "@jimka/typescript-ui/component/table":     ["./src/typescript/lib/component/table/index.ts"],
    "@jimka/typescript-ui/component/tree":      ["./src/typescript/lib/component/tree/index.ts"],
    "~/*":                                       ["./src/typescript/lib/*"]
}
```

The bare `"@jimka/typescript-ui"` entry is **removed**, so any leftover bare import becomes a typecheck error — useful canary during the demo rewrite.

### `vite.config.ts`

[vite.config.ts:7-10](../vite.config.ts#L7-L10) currently has:

```ts
alias: {
  '@jimka/typescript-ui': fileURLToPath(...),
  '~':                    fileURLToPath(...),
}
```

Replace with one alias per subpath, plus the `~` internal alias. Vite alias resolution is order-sensitive and longest-prefix-wins for plain string aliases, but to be safe use array form:

```ts
alias: [
  { find: '@jimka/typescript-ui/component/input',     replacement: fileURLToPath(new URL('./src/typescript/lib/component/input/index.ts',     import.meta.url)) },
  { find: '@jimka/typescript-ui/component/button',    replacement: fileURLToPath(new URL('./src/typescript/lib/component/button/index.ts',    import.meta.url)) },
  { find: '@jimka/typescript-ui/component/display',   replacement: fileURLToPath(new URL('./src/typescript/lib/component/display/index.ts',   import.meta.url)) },
  { find: '@jimka/typescript-ui/component/list',      replacement: fileURLToPath(new URL('./src/typescript/lib/component/list/index.ts',      import.meta.url)) },
  { find: '@jimka/typescript-ui/component/container', replacement: fileURLToPath(new URL('./src/typescript/lib/component/container/index.ts', import.meta.url)) },
  { find: '@jimka/typescript-ui/component/menubar',   replacement: fileURLToPath(new URL('./src/typescript/lib/component/menubar/index.ts',   import.meta.url)) },
  { find: '@jimka/typescript-ui/component/table',     replacement: fileURLToPath(new URL('./src/typescript/lib/component/table/index.ts',     import.meta.url)) },
  { find: '@jimka/typescript-ui/component/tree',      replacement: fileURLToPath(new URL('./src/typescript/lib/component/tree/index.ts',      import.meta.url)) },
  { find: '@jimka/typescript-ui/core',                replacement: fileURLToPath(new URL('./src/typescript/lib/core/index.ts',                import.meta.url)) },
  { find: '@jimka/typescript-ui/primitive',           replacement: fileURLToPath(new URL('./src/typescript/lib/primitive/index.ts',           import.meta.url)) },
  { find: '@jimka/typescript-ui/layout',              replacement: fileURLToPath(new URL('./src/typescript/lib/layout/index.ts',              import.meta.url)) },
  { find: '@jimka/typescript-ui/data',                replacement: fileURLToPath(new URL('./src/typescript/lib/data/index.ts',                import.meta.url)) },
  { find: '@jimka/typescript-ui/validation',          replacement: fileURLToPath(new URL('./src/typescript/lib/validation/index.ts',          import.meta.url)) },
  { find: '~',                                        replacement: fileURLToPath(new URL('./src/typescript/lib',                              import.meta.url)) },
]
```

(`component/*` entries are listed first only as documentation — the array form requires no ordering, but keeping siblings together makes diffs readable.)

### `tsconfig.lib.json`

`rootDir: "src/typescript/lib"` and `include: ["src/typescript/lib/**/*"]` ([tsconfig.lib.json:7-9](../tsconfig.lib.json#L7-L9)) stay correct. `emitDeclarationOnly` continues to emit `dist/lib/types/<group>/index.d.ts` per the new tree, which is what `package.json` `exports[...].types` points at.

---

## Symbol Bucket Map (selected)

| Symbol(s) | From | To |
|---|---|---|
| `Component`, `Panel`, `Body`, `Window`, `Menu`, `Tooltip`, `Notification`, `Dialog`, `Aria`, `RovingTabIndex`, `ButtonGroup`, `BaseObject`, `Event`, `Util`, `callable`, `Callable`, `ThemeManager`, `DefaultTheme`, `DarkTheme`, `Theme`, `Binding`, `Bindable` | flat `lib/` | `lib/core/` |
| `Border`, `BorderLine`, `BorderStyle`, `Insets`, `Point`, `Position`, `Placement`, `Size` | flat `lib/` | `lib/primitive/` |
| `AccordionHeader` | `lib/component/AccordionHeader.ts` | `lib/component/container/AccordionHeader.ts` |
| `Text`, `Label`, `Input`, `TextInput`, `TextField`, `DateField`, `TimeField`, `PasswordField`, `TextArea`, `Checkbox`, `RadioButton`, `Slider`, `ComboBox`, `Option`, `AutoCompleteField`, `NumberSpinner`, `SpinButton` | flat `lib/component/` | `lib/component/input/` |
| `Button`, `ToggleButton`, `TabCloseButton` | flat `lib/component/` | `lib/component/button/` |
| `Header`, `Image`, `FontAwesomeIcon`, `ProgressBar`, `ProgressSpinner`, `PaginationBar` | flat `lib/component/` | `lib/component/display/` |
| `List`, `MultiSelectList`, `AbstractListComponent`, `BulletedList`, `BulletedListItemStyle`, `NumberedList`, `NumberedListItemStyle`, `ListItem` | flat `lib/component/` | `lib/component/list/` |
| `FieldSet`, `Legend`, `MenuItem`, `MenuSeparator`, `Scrollbar`, `VirtualScroller`, `SplitGutter`, `WindowBorder`, `WindowHeader` | flat `lib/component/` | `lib/component/container/` |

`layout/`, `data/` (with nested `proxy/`), `validation/`, `component/menubar/`, `component/table/` (with nested `cell/`/`editor/`/`renderer/`), and `component/tree/` keep their existing folder structure — only an `index.ts` barrel is added.

---

## Ordered Implementation Steps

The work is sequenced into **five commits** to keep blame clean and let each commit be independently verified by `npm run typecheck && npm run build && npm run build:lib`.

### Step 1 — Adopt `~/` alias inside `lib/`

**Goal:** before any file moves, rewrite every relative import inside `lib/` (`./Foo.js`, `../bar/Baz.js`) to the location-independent form `~/Foo.js`, `~/bar/Baz.js`. Files are not moved; only import lines change.

- Mechanical search-replace per file. For `lib/Foo.ts`, `from "./Bar.js"` → `from "~/Bar.js"`; `from "../layout/HBox.js"` → `from "~/layout/HBox.js"`. The `~/*` alias already resolves correctly (added in [package-imports-and-lib-rename plan](implemented/package-imports-and-lib-rename.md)).
- The library build doesn't currently configure the `~/` alias ([package-imports-and-lib-rename.md:179](implemented/package-imports-and-lib-rename.md#L179) explicitly excluded it). Add it to `vite.lib.config.ts` in this step:

  ```ts
  resolve: { alias: { '~': fileURLToPath(new URL('./src/typescript/lib', import.meta.url)) } }
  ```

  This is the only structural change to the lib build in Step 1.
- Verify: `npm run typecheck && npm run build && npm run build:lib`. Demo behaviour identical.
- Commit message: `Adopt ~/ alias for all lib internal imports`.

This step does inflate every blame line in `lib/` once, but it eliminates the rewrites that would otherwise happen in Step 2, where they would interfere with rename detection.

### Step 2 — Move files into the new tree (`git mv` + alias-target rewrites)

**Goal:** physically reshuffle files into the new folders. Because every internal import is now `~/Foo.js`, the moved files themselves don't need any content change beyond updating their *own* alias targets. Other files only need their `~/Foo.js` updated to `~/group/Foo.js`.

Per-file `git mv` plan (see "New Folder Layout" above for the mapping). For each move:

```bash
git mv src/typescript/lib/Component.ts        src/typescript/lib/core/Component.ts
git mv src/typescript/lib/Panel.ts            src/typescript/lib/core/Panel.ts
# … all moves in this commit
```

Then, in a single mechanical sweep across `lib/` and `src/typescript/` (demos), update alias targets:

```bash
# Examples (use sed -i or your editor's project-wide replace, scoped to .ts files):
#   ~/Component.js           → ~/core/Component.js
#   ~/Panel.js               → ~/core/Panel.js
#   ~/Border.js              → ~/primitive/Border.js     (NOT layout/Border.js — that one stays)
#   ~/component/Text.js      → ~/component/input/Text.js
#   ~/component/Button.js    → ~/component/button/Button.js
#   ~/component/AccordionHeader.js → ~/component/container/AccordionHeader.js
#   …
```

Build a one-time mapping script that takes `(old-alias, new-alias)` pairs and runs them in order longest-to-shortest to avoid prefix overlap (`~/component/table/cell/Header.js` vs `~/component/Header.js`).

**Verify rename detection before committing:**

```bash
git status                  # should show "renamed:" entries for every moved file
git diff --stat HEAD        # confirms similarity ≥ ~50% on each
```

If any moved file shows as `deleted` + `new file`, content drift slipped in — usually because the file's own `~/Foo.js` references were updated *and* it was simultaneously moved into a deep folder, dropping similarity. Mitigation: split the move-plus-self-edit into two commits for that file.

**Verify build and runtime:**

```bash
npm run typecheck
npm run build
npm run build:lib
npm run dev          # click through every demo tab — should look identical
```

The old top-level `lib/index.ts` still works at this point (its own `~/Foo.js` references are part of the alias-update sweep), so the package surface is unchanged.

Commit message: `Reorganize lib/ into per-group folders (pure git mv + alias-target rewrites)`.

### Step 3 — Add per-folder barrels; remove top-level `lib/index.ts`

**Goal:** introduce `lib/<group>/index.ts` for every group, and delete the monolithic `lib/index.ts`.

For each group, the barrel is a focused re-export of that group's public symbols (use the existing `lib/index.ts` comment-group sections as the source of truth). Example for `lib/layout/index.ts`:

```ts
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
export { LayoutManager }            from './LayoutManager.js';
export type { LayoutManagerOptions } from './LayoutManager.js';
export { LayoutConstraints }        from './LayoutConstraints.js';
export { AnchorType }               from './AnchorType.js';
export { FillType }                 from './FillType.js';
export { Absolute }                 from './Absolute.js';
export type { AbsoluteOptions }     from './Absolute.js';
export { Fit }                      from './Fit.js';
export type { FitOptions }          from './Fit.js';
export { Accordion }                from './Accordion.js';
export type { AccordionOptions, SectionToggleCallback } from './Accordion.js';
export { AccordionConstraints }     from './AccordionConstraints.js';
export { Tab }                      from './Tab.js';
export type { TabOptions }          from './Tab.js';
export { Border }                   from './Border.js';
export type { BorderOptions }       from './Border.js';
export { HBox }                     from './HBox.js';
export type { HBoxOptions }         from './HBox.js';
// … VBox, Row, Column, Grid, Split, Card …
```

`lib/data/index.ts` re-exports `data/proxy/*` as well (folded subpath):

```ts
export { Proxy }      from './proxy/Proxy.js';
export { MemoryProxy } from './proxy/MemoryProxy.js';
export { AjaxProxy }   from './proxy/AjaxProxy.js';
export type { ReadParams } from './proxy/Proxy.js';
// … etc
```

`lib/component/table/index.ts` re-exports its nested `cell/`, `cell/editor/`, `cell/renderer/`:

```ts
export { Cell }        from './cell/Cell.js';
export { DefaultCell } from './cell/Default.js';
// … all cell types
export { CellEditor }  from './cell/editor/CellEditor.js';
export { BooleanEditor } from './cell/editor/Boolean.js';
// … all editors
export { CellRenderer } from './cell/renderer/CellRenderer.js';
// … all renderers
```

After all barrels are in place:

```bash
rm src/typescript/lib/index.ts
```

The `package.json` `exports` map and `tsconfig.json` paths still reference the old root briefly — those are updated in Step 4. Demos still import from `@jimka/typescript-ui` — those are updated in Step 5. So **after Step 3, the build is broken** (deliberately). To keep this step independently verifiable, defer the deletion to the same commit as Step 4 *or* fold Step 3 + Step 4 + Step 5 into one commit. Recommended: **bundle Steps 3-5 into a single commit** since they're not independently runnable.

### Step 4 — Replace `package.json` exports, `vite.lib.config.ts`, `tsconfig.json` paths, `vite.config.ts` aliases

Apply the configuration changes spelled out in **Build Configuration** above. Sequence within the commit:

1. Update `tsconfig.json` `paths` (subpaths added, root removed). `npm run typecheck` will fail on demos until Step 5 runs; that's expected.
2. Update `vite.config.ts` `resolve.alias` (subpaths added, root removed).
3. Update `vite.lib.config.ts` to multi-entry.
4. Update `package.json` `exports` map; remove `main` and `module`; remove the legacy `"."` entry.

### Step 5 — Rewrite demo imports

Touch every demo file under [src/typescript/](../src/typescript/) (the 18 panel files plus `main.ts` and `perf/Benchmark.ts` enumerated in [implemented/package-imports-and-lib-rename.md:125-143](implemented/package-imports-and-lib-rename.md#L125-L143)). Each `import { … } from '@jimka/typescript-ui'` is split into one import per source subpath.

**Example — [BindingPanel.ts](../src/typescript/BindingPanel.ts):**

Before:

```ts
import { Body, Tab, Model, MemoryStore, ModelRecord, TextField, Button, HBox, VBox, callable } from '@jimka/typescript-ui';
```

After:

```ts
import { Body, callable } from '@jimka/typescript-ui/core';
import { HBox, VBox, Tab } from '@jimka/typescript-ui/layout';
import { Model, MemoryStore, ModelRecord } from '@jimka/typescript-ui/data';
import { TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
```

A small script can generate the per-symbol bucket map from the *old* `lib/index.ts` (preserved in git history) and emit the rewrite — but most demos have <15 imports, so manual rewrite is also feasible. Either way, the typecheck failure surface from Step 4 (`Cannot find module '@jimka/typescript-ui'`) becomes a per-demo to-do list.

**Verify:**

```bash
npm run typecheck   # must pass — proves every symbol exists at the claimed subpath
npm run build       # demo bundle
npm run build:lib   # multi-entry library bundle
npm run dev         # click every tab; runtime identical
```

Commit message: `Switch to subpath-only public API and rewrite demos`.

---

## Files to Create / Modify / Delete

| Action | File | Notes |
|---|---|---|
| Create | `src/typescript/lib/core/index.ts` | Group barrel |
| Create | `src/typescript/lib/primitive/index.ts` | Group barrel |
| Create | `src/typescript/lib/layout/index.ts` | Group barrel |
| Create | `src/typescript/lib/data/index.ts` | Group barrel; re-exports `proxy/*` |
| Create | `src/typescript/lib/validation/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/input/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/button/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/display/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/list/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/container/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/menubar/index.ts` | Group barrel |
| Create | `src/typescript/lib/component/table/index.ts` | Group barrel; re-exports `cell/*`, `cell/editor/*`, `cell/renderer/*` |
| Create | `src/typescript/lib/component/tree/index.ts` | Group barrel |
| Move | ~22 files from flat `lib/` → `lib/core/` | per **Symbol Bucket Map** |
| Move | 8 files from flat `lib/` → `lib/primitive/` | per **Symbol Bucket Map** |
| Move | ~17 files from flat `lib/component/` → `lib/component/input/` | per **Symbol Bucket Map** |
| Move | 3 files from flat `lib/component/` → `lib/component/button/` | per **Symbol Bucket Map** |
| Move | 6 files from flat `lib/component/` → `lib/component/display/` | per **Symbol Bucket Map** |
| Move | 8 files from flat `lib/component/` → `lib/component/list/` | per **Symbol Bucket Map** |
| Move | 10 files from flat `lib/component/` → `lib/component/container/` | includes `AccordionHeader.ts` and internal `DialogBackdrop.ts` |
| Modify | every file under `src/typescript/lib/` | Step 1: relative imports → `~/...` |
| Modify | every file under `src/typescript/lib/` (those that reference moved files) | Step 2: `~/Foo.js` → `~/group/Foo.js` |
| Delete | `src/typescript/lib/index.ts` | Replaced by per-group barrels |
| Modify | `package.json` | New `exports` map, drop `main`/`module` |
| Modify | `vite.lib.config.ts` | Multi-entry |
| Modify | `vite.config.ts` | Per-subpath aliases |
| Modify | `tsconfig.json` | Per-subpath `paths`; root removed |
| Modify | every demo file under `src/typescript/*Panel.ts`, `main.ts`, `perf/Benchmark.ts` | Subpath-split imports |

---

## Verification

1. **Each commit independently** — `npm run typecheck && npm run build && npm run build:lib` passes after Step 1, after Step 2, and after the bundled Steps 3-5. (Skip the assertion between Steps 3 and 5 since the build is intentionally broken mid-bundle.)
2. **Rename detection** (after Step 2):
   ```bash
   git diff --stat HEAD~1 HEAD | grep -c '=>' # should equal the number of moved files
   git log --follow src/typescript/lib/core/Component.ts # shows pre-rename history
   ```
   Spot-check 5 moved files across the depth gradient (root → 2-deep → 3-deep) to confirm history survived the move.
3. **No leftover bare imports**:
   ```bash
   grep -rn "from ['\"]@jimka/typescript-ui['\"]" src/typescript/ # expect zero matches after Step 5
   ```
4. **No leftover relative imports inside lib/** (sanity check after Step 1):
   ```bash
   grep -rnE "from ['\"]\.\.?/" src/typescript/lib/ # expect zero matches
   ```
5. **Subpath bundles emit correctly** (after Step 4):
   ```bash
   ls dist/lib/*.es.js dist/lib/component/*.es.js   # 13 files total
   ls dist/lib/types/*/index.d.ts dist/lib/types/component/*/index.d.ts # 13 .d.ts barrels
   ```
6. **Demo regression test** — run `npm run dev`, click through every tab in [main.ts](../src/typescript/main.ts), and verify each panel renders identically. Pay special attention to `BindingPanel`, `MultiSelectListPanel`, and `ComplexUIPanel` (heaviest cross-module imports).
7. **Theme toggle** still works (toggle between Default and Dark in any panel that exposes it). Nothing in this plan touches `Theme.ts` semantically, but the file moves to `lib/core/Theme.ts` and any demo that imports `ThemeManager` from a now-wrong path will silently no-op until the import is fixed.
8. **Type narrowing canary**: in any demo, temporarily import a symbol from the wrong subpath (e.g. `import { Button } from '@jimka/typescript-ui/component/input'`). Typecheck should fail with `'Button' is not exported by '@jimka/typescript-ui/component/input'`. Revert.
9. **Per [CLAUDE.md](../CLAUDE.md):** run `graphify update .` after the implementation lands so the knowledge graph reflects the new module boundaries.

---

## Potential Challenges

- **Rename-detection failure on small files.** A file like `lib/component/TabCloseButton.ts` with only ~30 lines and 4-5 imports could drop below 50% similarity if both moved deep AND has its own `~/Foo.js` references rewritten in the same commit. Mitigation: the Step 1 alias sweep absorbs all *self*-edits before Step 2, leaving Step 2 to only `git mv` the file. The file's content is byte-identical when moved.
- **Prefix collisions in alias rewrites.** `~/Border.js` (primitive) vs `~/layout/Border.js` (layout manager) — the search-replace must be anchored. Use exact-match (`~/Border.js"` or `~/Border.js'`) not substring match.
- **`Header`, `Body`, `Row`, `Column` namespace clashes.** Today `index.ts` aliases the table versions ([index.ts:218-224](../src/typescript/lib/index.ts#L218-L224)). Subpath exports remove the need for those aliases at the package level, but demos that imported `TableRow` etc. now write `import { Row as TableRow } from '@jimka/typescript-ui/component/table'` themselves. Audit demo files in Step 5 for `TableHeader`, `TableBody`, `TableRow`, `TableFooter`, `TableColumn`, `BorderLayout`.
- **Circular subpath bundles.** Multi-entry Vite library mode may shared-chunk symbols that appear in two bundles (e.g. `core/Component` is referenced from `layout/`, `data/`, every `component/*`). Vite's default behaviour is to emit shared chunks under `dist/lib/chunks/`. Verify those chunk files are also covered by `package.json` `files` (the current `"files": ["dist/lib"]` covers them). If shared chunks become a publishing concern, switch the build to `preserveModules: true` so each source file emits 1:1.
- **`AccordionHeader` reclassification ripple.** It moves from "Layout managers" comment group to `component/container/`. Any demo that imports `AccordionHeader` alongside `Accordion` now needs two import lines (`@jimka/typescript-ui/layout` for `Accordion`, `@jimka/typescript-ui/component/container` for `AccordionHeader`). Audit `AccordionPanel.ts` in Step 5.
- **UMD users (none today).** The current `dist/lib/typescript-ui.umd.js` is dropped. If a CDN-style UMD is required later, build it as a separate concern (a second Vite config that emits one combined UMD bundle, exposed via a `package.json` `exports` `"./umd"` entry — out of scope here).

---

## Critical Files

- [src/typescript/lib/index.ts](../src/typescript/lib/index.ts) — the source of truth for which symbols are public and how they're grouped today. Read top-to-bottom before splitting; the comment groups are the bucket boundaries.
- [package.json](../package.json) — current `main`/`module`/`exports`. Compare against the proposed structure above.
- [vite.lib.config.ts](../vite.lib.config.ts) — single-entry library build that becomes multi-entry.
- [tsconfig.json](../tsconfig.json) — `paths` block that gets per-subpath entries.
- [vite.config.ts](../vite.config.ts) — `resolve.alias` block that mirrors `paths`.
- [plans/implemented/package-imports-and-lib-rename.md](implemented/package-imports-and-lib-rename.md) — establishes the `~/` alias and the multi-commit rename-preserving pattern this plan reuses.
- [src/typescript/lib/component/AccordionHeader.ts](../src/typescript/lib/component/AccordionHeader.ts) — only "Layout-classified component" being relocated; mention in commit message.
- [src/typescript/lib/Border.ts](../src/typescript/lib/Border.ts) and [src/typescript/lib/layout/Border.ts](../src/typescript/lib/layout/Border.ts) — name collision; subpath-resolved.

---

## Non-Goals

- **No public API redesign.** No symbols are added, removed, or renamed (apart from dropping the `BorderLayout`/`TableHeader`/`TableBody`/`TableRow`/`TableFooter`/`TableColumn` aliases that exist solely to disambiguate inside the flat root barrel — consumers can re-alias on import).
- **No internal-import normalization beyond what the moves require.** The Step 1 alias sweep is a means to an end (preserving rename detection in Step 2), not a campaign to enforce `~/` everywhere going forward.
- **No UMD bundle.** Modern ESM only. CDN consumers are not a current use case.
- **No published-package smoke test.** The package isn't published; verifying the `exports` map against `node --experimental-vm-modules` or `pnpm publish --dry-run` is optional polish, not required by this plan.
- **No documentation site updates.** TypeDoc reads the `lib/` source tree directly; the generated API docs will reorganize themselves around the new folders. If the documentation site's hand-written nav references the old flat structure, that's a follow-up.
