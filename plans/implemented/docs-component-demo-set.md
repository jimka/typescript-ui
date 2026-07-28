---
depends-on: [docs-inline-demos]
touches-shared:
  - packages/docs/src/demos/
  - packages/lib/docs/components/
  - packages/lib/docs/layouts/
---

# Component Demo Set for the Docs App — Implementation Plan

## Overview

The `docs-inline-demos` plan builds the machinery: a page is split into blocks at an HTML-comment marker, and each marker id resolves to a module under `packages/docs/src/demos/` through two eager Vite globs ([packages/docs/src/content/demos.ts](packages/docs/src/content/demos.ts), created by that plan). It ships one reference demo, `button-basic`.

This plan writes the catalogue: a curated set of live demos across the component and layout pages under `packages/lib/docs/`. Every demo is one new module in `packages/docs/src/demos/` plus one marker line in an existing `.md` page. **No library code changes, and no docs-app machinery changes** — this plan only consumes the seam `docs-inline-demos` created.

The [demo catalogue](#the-demo-catalogue) is the authority for *what* gets built: one table row per demo, naming the module, the page, and the exact insertion point. Count the rows; do not trust any number written in prose here.[^no-count-literal]

---

## Architecture Decisions

### One demo shows one idea

A demo is small, self-contained, and teaches a single thing. A page gets one demo; a page gets a second only when it documents two genuinely different modes, and no page gets three.[^one-idea]

The house rules, all of which the catalogue's rows already satisfy:

| Rule | What it means |
|---|---|
| One idea | The demo illustrates the one section it sits under, not the component's whole option surface. |
| Interactive where the component is | If the real component responds to clicks, drags, or typing, the demo does too. |
| Readable at rest | The point must be visible before the reader touches anything. No demo opens on a blank stage awaiting a click. |
| Fixed height class | `height` is one of the five values in the height scale below. |
| Tiny data | Five to eight records, three to four fields. Enough to sort and select; not enough to scroll past. |
| No timers | No `setInterval`, `setTimeout`, or `requestAnimationFrame` anywhere in a demo module.[^no-timers] |
| No module-level state | The only top-level binding is `height`. Everything else is constructed inside `create()`. |
| No colour literals | Colours come from the theme, never from a hex or `rgb()` string.[^theme-tokens] |
| Events through the component's own surface | Wire with the options `listeners: { action: handleChange }` bag, or `slider.on('action', handleChange)` for a component built earlier in `create()`. Never `Event.addListener` against a component the demo constructed — ARCHITECTURE.md reserves the `Event` API for a component listening on itself. |
| Handlers are named functions | Declare the handler as a `function` *inside* `create()` and pass it by name. Never an inline arrow. |
| Each demonstrated component gets its own rows | One named `const` per component the demo is about, constructed and configured in its own statement; the composition then refers to it by name. Never a construction inside a `components: [...]` array, never a composition on one line.[^own-rows] |

### Demos are written fresh, in the callable + options-bag idiom

Every demo constructs components with the callable form and an options bag — `Button({ text, glyph })`, `Panel({ layoutManager: VBox(), components: [...] })` — and reserves `setX` for a change made *after* construction, which in a demo means inside an event handler. This is the idiom `CODE_CONVENTIONS.md` (*Construction*) and `packages/lib/llms.txt` (Conventions rule 3) require.

The existing dev-app panels under `packages/lib/src/typescript/` are the model for *composition and data*, not for *syntax*: several build with `new` plus post-construction setters ([GridPanel.ts:26-33](packages/lib/src/typescript/GridPanel.ts#L26), [BorderPanel.ts:14-40](packages/lib/src/typescript/BorderPanel.ts#L14)), which is the opposite of what these pages tell a consumer to write.[^fresh-not-adapted]

The one panel worth copying wholesale is the options-bag composition in [ComplexUIPanel.ts:35-64](packages/lib/src/typescript/ComplexUIPanel.ts#L35) — nested `Panel({ layoutManager, components })` with no setters — and the store-load idiom in [ChartDemoPanel.ts:67](packages/lib/src/typescript/ChartDemoPanel.ts#L67).

Data classes are the exception: `Model`, `MemoryStore`, and `TreeStore` are not `Component`s and are not `callable()`-wrapped ([packages/lib/src/typescript/lib/data/index.ts:6-21](packages/lib/src/typescript/lib/data/index.ts#L6)), so they are built with `new`.

| Construct | Write | Not |
|---|---|---|
| A component | `Button({ text: 'Save' })` | `new Button(); b.setText('Save')` |
| A component with children | `Panel({ layoutManager: VBox(), components: [a, b] })` | `p.setLayoutManager(new VBox()); p.addComponent(a)` |
| A layout manager | `VBox({ spacing: 8 })` | `new VBox()` then `setComponentSpacing(8)` |
| A model or store | `new MemoryStore(model, rows)` | `MemoryStore(model, rows)` |
| A runtime change in a handler | `bar.setValue(60)` | (correct — this is what `setX` is for) |

### Each demo carries its own data; there is no shared fixture module

A demo that needs records declares its `Model` and `MemoryStore` inline inside `create()`. Nothing is imported from a fixture file.[^inline-data]

To keep thirty demos from inventing thirty datasets, three canonical datasets are defined once in this plan ([Canonical datasets](#canonical-datasets)) and copied verbatim into each demo that needs one.

### No demo opens a floating overlay

`Window`, `Dialog`, `Drawer`, `Menu`, `Popover`, `Notification`, and `Tooltip` get no demo in this release. Each mounts its element on the document root through `LayerManager.mount` rather than inside the demo's own component tree ([packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:614-630](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L614)), so it is not a child of the demo block and the block's `dispose()` cannot reach it.[^no-overlays]

`SplitButton` and `ComboBox` *do* get demos even though both open a dropdown, because each owns its dropdown internally and closes it on outside click — the overlay's lifetime belongs to the component, not to the demo.

### The marker sits at the end of the section it illustrates

A demo goes on its own line, blank-line separated, immediately **before the next heading** that follows the prose it illustrates — that is, at the bottom of that section, after its last code fence.[^placement-rule]

| Page | Section the demo illustrates | Marker goes immediately before |
|---|---|---|
| `layouts/VBox.md` | `## Usage` | `## Sizing modes` |
| `components/Slider.md` | `## Keyboard model` | `## Notes` |
| `components/LineChart.md` | `## Usage` | `## Construction` |

Two hard constraints on the insertion point: the marker must not land inside a fenced code block, and it must not land inside a `::: tip` / `::: warning` / `::: info` container. Both would stop it being a whole line at column 0, which is what the splitter matches.

### Live-area heights come from a fixed five-value scale

Each module's exported `height` is one of five values. A fixed scale keeps a page of demos from looking ragged and makes the value a decision the catalogue already made.[^height-classes]

| `height` | Use for |
|---|---|
| `64` | One row of single-line controls. This is the value `button-basic` already carries, so the scale starts where the prerequisite left it. |
| `120` | One row of two-line controls, or two short stacked rows. |
| `200` | A small form or a multi-part composition. |
| `260` | A layout-manager demo. |
| `320` | A table, tree, or chart. |

---

## Internal Structure

### The demo module shape

Every module in `packages/docs/src/demos/` exports exactly two things — `height` and `create` — as fixed by `docs-inline-demos`' `DemoModule` interface. Files in `packages/docs/` carry no SPDX header ([packages/docs/src/content/pages.ts:1](packages/docs/src/content/pages.ts#L1) starts with an import), so demo modules carry none either.

The full reference module, which every other demo follows:

```typescript
// packages/docs/src/demos/table-store.ts
import type { Component } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { Table } from '@jimka/typescript-ui/component/table';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 320 is a header row, five body rows, and the surrounding frame.
 */
export const height: number = 320;

/**
 * A store-bound `Table`. Click a column header to sort, click a row to select,
 * double-click a cell to edit.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const model = new Model([
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'role', type: 'string' },
        { name: 'age',  type: 'number' },
    ]);

    const store = new MemoryStore(model, [
        { id: 1, name: 'Alice', role: 'Engineer', age: 30 },
        { id: 2, name: 'Bob',   role: 'Designer', age: 25 },
        { id: 3, name: 'Carol', role: 'Engineer', age: 41 },
        { id: 4, name: 'Dan',   role: 'Analyst',  age: 38 },
        { id: 5, name: 'Erin',  role: 'Designer', age: 29 },
    ]);

    const table = Table(store);

    void store.load();

    return table;
}
```

These are house rules, not incidental:

- **Every demonstrated component is constructed into its own named `const`, on its own rows** — its construction and its configuration are one statement the reader can find by eye, and the composition below refers to it by name. Nothing is folded into a parent's argument list, and nothing is packed onto one line.[^own-rows]

  ```typescript
  // Yes — each component the demo is about stands on its own.
  const saveButton = Button({ text: 'Save' });

  const cancelButton = Button({ text: 'Cancel' });

  return Panel({
      layoutManager: HBox(),
      components:    [saveButton, cancelButton],
  });

  // No — the reader has to unpick one line to find what the demo demonstrates.
  return Panel({ layoutManager: HBox(), components: [Button({ text: 'Save' }), Button({ text: 'Cancel' })] });
  ```

- **`create()` returns the component directly** when the demo is one component. `DocsDemo`'s stage is already a `Panel` with `Fit()`, so a single returned component fills the live area. Return a `Panel({ layoutManager: …, components: [...] })` only when the demo genuinely has several pieces.
- **`void store.load()` after the component is built**, mirroring [ChartDemoPanel.ts:67](packages/lib/src/typescript/ChartDemoPanel.ts#L67). `create()` is synchronous — never `await`, never mark it `async`.
- **The `height` JSDoc says what `height` controls and what the number is made of** — that it sets the height of the framed live area the demo appears in on the docs page, and which rows and margins add up to the value chosen, so a later author can re-derive it. The reader of the "show source" panel meets `height` with no other explanation of what it does.
- **The `create()` JSDoc is the demo's caption in code** — one sentence naming what to look at and what to try.

### Canonical datasets

Copied verbatim into each demo that needs records. Do not alter the field names or the row values between demos — a reader who moves from `Table` to `List` should recognise the same rows.

**PEOPLE** — used by `table-store`, `table-cell-types`, `list-selection`, `combobox-store`. Extends the two-row fence already on [components/Table.md:9-25](packages/lib/docs/components/Table.md#L9).

```typescript
new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'role', type: 'string' },
    { name: 'age',  type: 'number' },
]);
// rows:
{ id: 1, name: 'Alice', role: 'Engineer', age: 30 },
{ id: 2, name: 'Bob',   role: 'Designer', age: 25 },
{ id: 3, name: 'Carol', role: 'Engineer', age: 41 },
{ id: 4, name: 'Dan',   role: 'Analyst',  age: 38 },
{ id: 5, name: 'Erin',  role: 'Designer', age: 29 },
```

**FILES** — used by `treetable-hierarchy`. Extends the fence already on [components/TreeTable.md:11-38](packages/lib/docs/components/TreeTable.md#L11).

```typescript
new Model([
    { name: 'id',       type: 'number' },
    { name: 'parentId', type: 'number' },
    { name: 'name',     type: 'string' },
    { name: 'size',     type: 'number' },
]);
// rows:
{ id: 1, parentId: null, name: 'src',          size: 0    },
{ id: 2, parentId: 1,    name: 'main.ts',      size: 320  },
{ id: 3, parentId: 1,    name: 'Component.ts', size: 4820 },
{ id: 4, parentId: null, name: 'docs',         size: 0    },
{ id: 5, parentId: 4,    name: 'guide.md',     size: 1450 },
{ id: 6, parentId: null, name: 'package.json', size: 1100 },
```

`tree-nodes` shows the same folders through `Tree`'s node literals, because `Tree` takes `setNodes`, not a store ([components/Tree.md:7-19](packages/lib/docs/components/Tree.md#L7)):

```typescript
[
    { label: 'src',  children: [{ label: 'main.ts' }, { label: 'Component.ts' }] },
    { label: 'docs', children: [{ label: 'guide.md' }] },
    { label: 'package.json' },
]
```

**SALES** — used by `linechart-store` and `barchart-grouped`. Copied verbatim from [ChartDemoPanel.ts:44-53](packages/lib/src/typescript/ChartDemoPanel.ts#L44) and [ChartDemoPanel.ts:79-82](packages/lib/src/typescript/ChartDemoPanel.ts#L79) — proven data that already renders in both chart types.

### The marker line

Exactly as `docs-inline-demos` specifies: whole line, column 0, blank line either side.

```markdown
Existing prose ends here.

<!-- demo: table-store -->

## Next Heading
```

---

## The demo catalogue

One row per demo. Every row means: create `packages/docs/src/demos/<id>.ts`, and add `<!-- demo: <id> -->` to the named page immediately before the named heading.

Three pages end up with two demos each. `components/Button.md` already carries `button-basic` from the prerequisite and gains row 1; `layouts/VBox.md` takes rows 9 and 10; `components/Table.md` takes rows 20 and 21. Every other page in the catalogue gets exactly one.

**Batch 1 — controls** (no data layer; establishes the house style)

| # | id | Page | Marker before | What it shows | `height` |
|---|---|---|---|---|---|
| 1 | `button-glyph-description` | `components/Button.md` | `## Theming` | Three buttons in an `HBox`: glyph + title, glyph + title + description, and `showText: false` icon-only whose label survives in the hover tooltip. | 120 |
| 2 | `togglebutton-group` | `components/ToggleButton.md` | `## Theming` | Three `ToggleButton`s in a `ButtonGroup` — clicking one releases the others. | 64 |
| 3 | `splitbutton-menu` | `components/SplitButton.md` | `## How the chevron click is distinguished` | A `SplitButton` whose face fires the primary action and whose chevron opens a three-item menu. | 64 |
| 4 | `textfield-binding` | `components/TextField.md` | `## Theming` | Two `TextField`s bound to one `ModelRecord` via `Binding`, with a `Text` below echoing the record's current values as you type. | 200 |
| 5 | `checkbox-states` | `components/Checkbox.md` | `## Notes` | Unchecked, checked, and indeterminate `Checkbox`es, plus a button that cycles the third through all three states. | 64 |
| 6 | `radiobutton-group` | `components/RadioButton.md` | `## Notes` | Three `RadioButton`s stacked in a `ButtonGroup`; arrow keys move the selection. | 120 |
| 7 | `toggle-switch` | `components/Toggle.md` | `## Notes` | Two `Toggle`s, one on and one off, so the slide animation is visible on click. | 64 |
| 8 | `slider-range` | `components/Slider.md` | `## Notes` | A `Slider` over 0–100 with a `Text` beside it that updates from the slider's `action` event. | 120 |

**Batch 2 — layout managers**

| # | id | Page | Marker before | What it shows | `height` |
|---|---|---|---|---|---|
| 9 | `vbox-stack` | `layouts/VBox.md` | `## Sizing modes` | Four labelled panels stacked with `spacing: 8` and `stretching: true`. | 260 |
| 10 | `vbox-sizing-modes` | `layouts/VBox.md` | `## Overflow sizing (equal mode)` | Two columns side by side — `mode: 'preferred'` and `mode: 'equal'` — over the same four children. | 260 |
| 11 | `hbox-justify` | `layouts/HBox.md` | `## Per-child constraints` | Three buttons in an `HBox`, with a row of `ToggleButton`s above switching `justify` between its values at runtime. | 260 |
| 12 | `border-regions` | `layouts/Border.md` | `## Per-child constraints` | All five regions filled with labelled panels; north, south, and west are `collapsible: true`, so double-clicking a gutter collapses them. | 260 |
| 13 | `grid-tracks` | `layouts/Grid.md` | `## Cell spanning and explicit placement` | A 3-column grid with fixed / weight / content column tracks, so resizing the pane moves only the weighted column. | 260 |
| 14 | `split-panes` | `layouts/Split.md` | `## Three+ panes` | Two panes with a draggable gutter. | 260 |
| 15 | `tab-strip` | `layouts/Tab.md` | `## Events` | Three tabs over labelled panels, selected by clicking the strip. | 260 |
| 16 | `accordion-sections` | `layouts/Accordion.md` | `## Themed appearance` | Three collapsible sections; clicking a header animates it open or shut. | 260 |
| 17 | `hflow-wrap` | `layouts/HFlow.md` | `## Spacing` | A dozen buttons that reflow into more or fewer rows as the pane narrows. | 260 |
| 18 | `anchor-positions` | `layouts/Anchor.md` | `## When to use it` | A full-width header band, a bottom-right pinned button, and a percentage-anchored centre panel, all moving live as the pane resizes. | 260 |

**Batch 3 — data-backed**

| # | id | Page | Marker before | What it shows | `height` |
|---|---|---|---|---|---|
| 19 | `combobox-store` | `components/ComboBox.md` | `## Item renderers` | A `ComboBox` backed by the PEOPLE store, its `displayField` set to `name`. | 120 |
| 20 | `table-store` | `components/Table.md` | `## Constraining columns` | The reference module above: PEOPLE through `Model` + `MemoryStore`, sortable, selectable, editable. | 320 |
| 21 | `table-cell-types` | `components/Table.md` | `## Rotated record view` | The same store with a per-column `ColumnSpec`: `role` as a combo cell, `age` as a number cell. | 320 |
| 22 | `treetable-hierarchy` | `components/TreeTable.md` | `## TreeTableSpec` | FILES through a `TreeTable` with `idField` / `parentField` / `treeColumn`; rows expand and collapse. | 320 |
| 23 | `tree-nodes` | `components/Tree.md` | `## TreeNode` | The FILES folders as `Tree` node literals, with expand / collapse and selection. | 320 |
| 24 | `list-selection` | `components/List.md` | `## Keyboard` | PEOPLE names in a `List`, with a `Text` below showing the current selection. | 200 |

**Batch 4 — composites**

| # | id | Page | Marker before | What it shows | `height` |
|---|---|---|---|---|---|
| 25 | `labeledfieldset-form` | `components/LabeledFieldSet.md` | `## Common methods` | A two-column `rows` bag: three labelled fields plus a full-width `Button` row. | 200 |
| 26 | `tabpanel-lazy` | `components/TabPanel.md` | `## Close hooks` | Three tabs added with `addLazyTab`, each factory logging to a `Text` in the panel so the reader sees a tab build on first selection and not again. | 260 |
| 27 | `linechart-store` | `components/LineChart.md` | `## Construction` | SALES through a store-bound `LineChart`, two regional series, legend entries toggling series. | 320 |
| 28 | `barchart-grouped` | `components/BarChart.md` | `## Construction` | The SALES bar series, `grouped: true`, with a hover tooltip. | 320 |
| 29 | `progressbar-modes` | `components/ProgressBar.md` | `## Common methods` | A determinate bar at 60% beside an indeterminate one, plus two buttons stepping the determinate value. No timer. | 120 |

### Deliberately left without a demo

Named so the implementer does not add them and a reviewer does not read the gap as an oversight.[^dropped-pages]

| Page | Why not |
|---|---|
| `components/Window.md`, `Dialog.md`, `Drawer.md`, `Menu.md`, `Popover.md`, `Notification.md`, `Tooltip.md` | Mount outside the demo block; teardown cannot reach them. |
| `layouts/VFlow.md`, `layouts/Card.md`, `layouts/Fit.md` | `hflow-wrap` and `tab-strip` already show wrapping and show-one-child; a near-duplicate demo teaches nothing new. Each page keeps its existing prose link. |
| `components/AccordionPanel.md` | `accordion-sections` on `layouts/Accordion.md` covers the same behaviour. |
| `components/MenuButton.md`, `NumberSpinner.md`, `AutoCompleteField.md`, `DateField.md` | `splitbutton-menu` and `slider-range` cover the dropdown and numeric-input ideas; these are the second instance of each. |
| `components/Glyph.md`, `Glyphs.md` | A glyph gallery is a different kind of artefact (a searchable index, not a demo) and would bundle the whole icon set into the docs app. |
| `components/CodeEditor.md`, `MarkdownEditor.md`, `DiagramView.md`, `Canvas.md`, `WebGLCanvas.md`, `Video.md` | Each pulls a heavy third-party bundle or a media asset into the docs build. |
| Everything else under `components/` and `layouts/` | Either a small part of a component that already has a demo (`TabBar`, `TabButton`, `Legend`, `ListItem`, `Scrollbar`) or a reference page with no single behaviour to show (`layouts/Constraints.md`, `components/TableInternals.md`). |

---

## Ordered Implementation Steps

Each batch is self-contained: after it lands, every page it touched renders with a working demo and the whole suite is green. Do not start a batch before the previous one's checks pass.

1. **Confirm the prerequisite is in place.** `packages/docs/src/content/demos.ts`, `packages/docs/src/shell/DocsDemo.ts`, `packages/docs/src/demos/button-basic.ts`, and `packages/docs/tests/demos.test.ts` must all exist, and `npm -w packages/docs test` must be green. If any is missing, stop — `docs-inline-demos` has not landed.
   *Check:* `ls packages/docs/src/demos/ packages/docs/src/content/demos.ts`.

2. **Create `packages/docs/tests/demo-catalogue.test.ts`** covering Expected Behaviour cases 1-7. It globs `../src/demos/*.ts` with `{ query: '?raw', import: 'default', eager: true }` and globs the Markdown corpus — the authored pages under `packages/lib/docs/` — independently, in the style of [packages/docs/tests/content-constructs.test.ts:7-11](packages/docs/tests/content-constructs.test.ts#L7). Written before any demo, so every batch is checked as it lands; it must pass against `button-basic` alone.
   *Check:* `npm -w packages/docs test -- demo-catalogue` green with one demo registered.

3. **Batch 1 — write the eight control demos** (catalogue rows 1-8), each as `packages/docs/src/demos/<id>.ts` following the reference module.
   *Check:* `npm -w packages/docs run typecheck`.

4. **Batch 1 — add the eight markers** to their pages at the insertion points in the catalogue.
   *Check:* `npm -w packages/docs test` green — the registry bijection and the corpus guards both.

5. **Batch 1 — look at it.** `npm run build:lib && npm run docs:dev`, then walk the eight pages per `## Verification`'s per-batch walk, including the three-theme pass and the leak check on `/components/Button`.

6. **Batch 2 — write the ten layout demos** (rows 9-18) and add their markers.
   *Check:* `npm -w packages/docs run typecheck`; `npm -w packages/docs test` green.

7. **Batch 2 — look at it.** Walk the nine layout pages. Resize the browser window on `/layouts/Grid`, `/layouts/HFlow`, and `/layouts/Anchor` — those three demos only make their point while the pane changes width.

8. **Batch 3 — write the six data demos** (rows 19-24) and add their markers. Every one of the six copies a canonical dataset verbatim.
   *Check:* `npm -w packages/docs run typecheck`; `npm -w packages/docs test` green.

9. **Batch 3 — look at it.** Walk the five data pages. On `/components/Table`, sort by clicking a header, select a row, and double-click a cell to edit. Run the leak check on `/components/Table` — a table has the largest teardown surface in the catalogue.

10. **Batch 4 — write the five composite demos** (rows 25-29) and add their markers.
    *Check:* `npm -w packages/docs run typecheck`; `npm -w packages/docs test` green.

11. **Batch 4 — look at it.** Walk the five pages. On `/components/TabPanel`, select each tab twice and confirm the log line appears once per tab.

12. **Full pass.** Run `## Verification` end to end: build, typecheck, tests, docs build, the three-theme pass over one page per batch, and the leak check.

---

## Files to Create / Modify / Delete

The [demo catalogue](#the-demo-catalogue) is the authority; this table states the shape, and the catalogue's rows state the names. Re-count the catalogue's rows rather than trusting a number written here.[^no-count-literal]

| Action | File |
|---|---|
| Create | `packages/docs/src/demos/<id>.ts` — one per catalogue row, `<id>` being that row's id |
| Modify | `packages/lib/docs/components/<Page>.md` and `packages/lib/docs/layouts/<Page>.md` — one marker line per catalogue row, on the page that row names |
| Create | `packages/docs/tests/demo-catalogue.test.ts` |

Nothing under `packages/lib/src/` is touched. Nothing is deleted.

---

## Expected Behaviour

Cases 1-7 are unit-testable in `packages/docs/tests/demo-catalogue.test.ts`, which reads the demo modules through a `?raw` glob and the corpus through its own glob. Cases 8-14 need a browser — `packages/docs` has no component-level test harness.

Cases 11-14 of the prerequisite's `demos.test.ts` (every corpus marker resolves; every registered id appears in a marker; no page with a marker has a duplicate heading slug) are inherited unchanged and are not restated here. They are what makes a mistyped id a red test rather than a "demo not found" panel in the page.

**Source hygiene (automatable)**

1. Every module matched by `../src/demos/*.ts` exports exactly two symbols: its source contains exactly two lines matching `/^export /m`, one matching `/^export const height\b/m` and one matching `/^export function create\(/m`.
2. No demo module declares a top-level binding other than `height`: its source has no match for `/^(?:export\s+)?(?:const|let|var)\s+(?!height\b)/m`. Column-0 anchoring is what makes this work — a `const` inside `create()` is indented and never matches.
3. No demo module declares a top-level function other than `create`: no match for `/^(?:export\s+)?(?:async\s+)?function\s+(?!create\b)/m`.
4. Every module's `height` literal is one of `64`, `120`, `200`, `260`, `320`.
5. No demo module source matches `/\b(?:setInterval|setTimeout|requestAnimationFrame)\b/`.
6. No demo module source matches `/#[0-9a-fA-F]{3,8}\b|\brgba?\(/` — no colour literal.
7. No demo module constructs a component inside a `components:` array literal — no match for `/components:\s*\[[^\]]*(?:new\s+)?[A-Z][A-Za-z]*\s*\(/` — and no line in a demo module exceeds 100 characters. The pair enforces the own-rows rule from `## Internal Structure`: the first stops a construction being folded into the composition, the second stops the composition being packed onto one line.

Worked cases for rules 2 and 5, so the implementer can write them straight:

| Source line | Rule 2 | Rule 5 |
|---|---|---|
| `export const height: number = 320;` | passes | passes |
| `const store = new MemoryStore(model, rows);` at column 0 | **fails** | passes |
| `    const store = new MemoryStore(model, rows);` inside `create()` | passes | passes |
| `    setTimeout(() => bar.setValue(60), 500);` | passes | **fails** |

**Live behaviour (manual)**

8. Every page named in the catalogue renders its demo at the stated insertion point, between the prose it illustrates and the next heading, with no "demo not found" panel.
9. Every demo's live area is fully occupied at the stated `height` — no demo is clipped, and none leaves a band of empty space taller than roughly a text line.
10. "Show source" on any demo reveals that demo's own TypeScript, and the revealed code compiles as written (it is the module the docs app just executed).
11. Each demo's stated interaction works: sorting and row selection on `table-store`, expand/collapse on `tree-nodes` and `treetable-hierarchy`, gutter drag on `split-panes`, tab selection on `tab-strip`, section toggle on `accordion-sections`, arrow-key movement on `radiobutton-group`.
12. `grid-tracks`, `hflow-wrap`, and `anchor-positions` re-lay themselves out as the browser window is resized, with no clipping at any width down to a 900px viewport.
13. Every demo renders correctly under `ModernTheme`, `ClassicTheme`, and `DarkTheme`: text stays legible against its background, borders remain visible, and no element keeps a colour from the previous theme.
14. Navigating into and out of a page with a demo ten times leaves the document's element count and total CSS-rule count flat.

---

## Verification

Run from the repo root:

```bash
npm run build:lib                     # packages/docs resolves @jimka/typescript-ui to dist/
npm -w packages/docs run typecheck    # every demo module compiles
npm -w packages/docs test             # cases 1-7, plus the inherited registry tests
npm run build:docs
```

`npm -w packages/docs run typecheck` is the load-bearing one. Nothing compiles the fenced examples in `packages/lib/docs/**/*.md`, so a demo module is the only example on these pages that is known to be correct — which is the whole point of showing the executed source.

**Per-batch page walk.** `npm run docs:dev`, then open each page the batch touched at `http://localhost:5173/typescript-ui/<page-route>` (e.g. `components/Button.md` → `/typescript-ui/components/Button`) and check cases 8-12 for its demos.

**Three-theme pass (case 13).** The docs app applies `ModernTheme` and has no theme switcher, so make the switch temporarily in `packages/docs/src/main.ts`.[^theme-check] Add two lines at the top:

```typescript
import { ThemeManager, DarkTheme } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(DarkTheme);
```

Walk one page from each batch, then repeat with `ClassicTheme`, then revert.

```bash
git diff --exit-code packages/docs/src/main.ts   # must be clean before commit
```

Watch for one specific failure: a demo whose colours come from the theme changes with it; a demo that hardcoded a colour does not. Case 6's grep catches the literal form, but a component built with the wrong option (a `background` set to a fixed string) shows up only here.

**Leak check (case 14).** Run it at the end of batches 1 and 3, on `/components/Button` and `/components/Table`. In DevTools, with the page showing:

```js
const snap = () => [
    document.querySelectorAll('*').length,
    [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0),
];
```

Record `snap()`, navigate away and back ten times through the sidebar, record `snap()` again. Both numbers must match the first reading. A rising CSS-rule count means a component was constructed and never disposed; a rising element count means a DOM subtree outlived its component. This repo has shipped both, so a non-flat reading is a blocker.

---

## Documentation Impact

No library exports change, so no TypeDoc, barrel, or `packages/lib/llms.txt` change. The only edit to shipped documentation is the marker line each catalogue row adds — an HTML comment, hidden by every Markdown renderer, so the corpus reads unchanged on GitHub and npm.

The demo-authoring rules in `## Architecture Decisions` are the plan's own; they do not need a home in the corpus. The marker syntax itself is documented in `packages/docs/src/content/blocks.ts`'s module header, created by `docs-inline-demos`.

---

## Potential Challenges

- **Every demo is bundled eagerly into the docs app.** Thirty demos pull in most of the library — the chart, table, tree, and editor bundles included. Measure `npm run build:docs` output size after batch 4; if it has become a problem, the fix belongs in the registry (lazy globs), not in the catalogue.
- **A demo's own minimum size exceeds its `height` class and stretches the stage.** That is the size contract working: a manager must not compress a child below its minimum. Move the demo to the next height class up, or give it fewer children — do not fight the layout.
- **A page's fenced example is wrong, or uses an idiom the demos do not.** Several fences in this corpus are known to be broken because nothing compiles them, and [components/Button.md:7-14](packages/lib/docs/components/Button.md#L7) still wires its click with `Event.addListener(saveButton, …)` rather than the `listeners` bag. Follow the house rules, not the fence; fix the demo, and leave the fence alone (correcting the page's prose or fences is a separate change).
- **A layout demo looks fine at the author's window width and clips at another.** Case 11 exists for this. Check `grid-tracks`, `hflow-wrap`, and `anchor-positions` at a narrow viewport before calling batch 2 done.
- **`tabpanel-lazy` builds a tab on every page visit.** That is correct — each navigation constructs a fresh demo — but it means the "built once" claim must be checked *within* one page visit, by selecting each tab twice without navigating away.

---

## Critical Files

- [plans/docs-inline-demos.md](plans/docs-inline-demos.md) — the prerequisite. Read `## Public API` (the `DemoModule` contract) and `## Expected Behaviour` cases 9-14 (the registry tests this plan inherits) before writing the first demo.
- [packages/docs/src/demos/button-basic.ts](packages/docs/src/demos/button-basic.ts) — the one demo that already exists; the shape every new module matches.
- [packages/docs/src/content/demos.ts](packages/docs/src/content/demos.ts) — the two eager globs. Note the glob is `../demos/*.ts`, single level: nothing may be added to that directory that is not a demo.
- [packages/docs/tests/content-constructs.test.ts:7-11](packages/docs/tests/content-constructs.test.ts#L7) — the corpus-glob test style `demo-catalogue.test.ts` follows.
- [packages/lib/src/typescript/ChartDemoPanel.ts](packages/lib/src/typescript/ChartDemoPanel.ts) — the SALES datasets (lines 44-53, 79-82) and the `void store.load()` idiom (line 67).
- [packages/lib/src/typescript/ComplexUIPanel.ts:35-64](packages/lib/src/typescript/ComplexUIPanel.ts#L35) — nested options-bag composition, the one dev-app panel whose syntax the demos follow.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the *Construction* rule: options bag at instantiation, `setX` for runtime changes only.
- [ARCHITECTURE.md](ARCHITECTURE.md) — `callable()` export and import rules, and the listener rules (`Event.addListener(this, …)` on self; a named function, never an inline arrow, as the handler).
- [packages/lib/llms.txt](packages/lib/llms.txt) — the capability index; check it before building any demo composition, so a demo does not hand-roll something the library already provides.

---

## Non-Goals

- **Any change to the block/registry machinery.** If a demo seems to need one, stop and re-plan rather than widening `docs-inline-demos`' seam mid-implementation.
- **Any library code change.** The files touched under `packages/lib` are Markdown corpus pages only.
- **Covering all 92 documented components.** The catalogue is curated; the [deliberately left without a demo](#deliberately-left-without-a-demo) table records the gap on purpose.
- **Floating-overlay demos.** Excluded for the teardown reason above; giving them demos needs a teardown hook the demo block does not have.
- **A shared fixture module, a demo base class, or any other helper under `src/demos/`.** The registry's glob would treat one as a demo, and the "show the source" panel would show the reader an import they cannot follow.
- **Editing the surrounding prose.** A demo is added to a page; the page's existing text stays as written. If a demo makes a paragraph read wrong, note it and leave it for a separate change.
- **Lazy demo loading and bundle-size work.** Measured at the end, acted on separately.

---

## Notes

[^no-count-literal]: A hand-written total ("29 demos") becomes a test literal the moment `/implement` reads it, and then a later trim of one row silently fails an assertion that was never about anything real. The catalogue table is the derivation rule; the count is whatever it yields. If a step's instruction and the catalogue disagree about which demos exist, stop and report rather than reconciling by guess.

[^one-idea]: A demo that exercises ten options at once produces a screenshot, not a lesson: the reader cannot tell which option caused which part of what they see, and the "show source" panel becomes a wall. Three small demos across a page — each landing under the prose that explains it — each answer one question and can each be read in ten seconds. The cost is more modules, which is cheap; the alternative (one big demo per page) was rejected because it also makes the height classes meaningless and turns every page into a 500px scroll obstacle.

[^own-rows]: The "show source" panel is the demo's real output, so the module is read as prose by someone who has just met the component. A construction folded into a parent's `components: [...]` array — or a whole composition packed onto one line — makes the reader parse the wiring to find the two lines the page is actually about. Naming each demonstrated component and building it on its own rows separates *what is being shown* from *how it is arranged*: the reader skims the `const` declarations, sees the components the section names, and reads the composition only if they care where things sit. It costs a few lines per demo, which is nothing next to twenty-nine modules a reader has to decode. `button-basic` was written the packed way first and re-written this way, which is what prompted the rule.

[^fresh-not-adapted]: The dev-app panels under `packages/lib/src/typescript/` were built to stress the framework, not to teach it. `GridPanel` deliberately includes an oversized child that clips and a commented-out collision case; `BorderPanel` seeds thirteen list items to force a scrollbar. Beyond content, their syntax is the problem: `GridPanel.ts:26` calls `setLayoutManager(new Grid({...}))` and `BorderPanel.ts:14` does the same, while the pages these demos will sit on tell the reader to write `Panel({ layoutManager: Grid({...}) })`. A consumer reading a demo takes it as the recommended way to use the library, so the demos cannot ship the older idiom. What the panels *do* provide, and what is reused, is proven data and proven compositions — which is why the SALES dataset is copied verbatim rather than invented.

[^inline-data]: A shared fixture module cannot live in `src/demos/` at all: the registry globs `../demos/*.ts` and would register the fixture as a demo with no marker, failing the inherited bijection test. It could live in a subdirectory, which the single-level glob skips — but then the "show source" panel shows the reader `import { PEOPLE } from './support/data.js'` and the code on screen is no longer runnable as written. Since the whole point of showing the executed source is that the reader can copy it, self-contained wins. The duplication is bounded: five to eight rows, in eight of the twenty-nine demos, and the three canonical datasets in this plan keep the copies identical.

[^no-overlays]: `AbstractWindow.show()` registers with `LayerManager` and calls `LayerManager.mount(el)`, which puts the element on the document root rather than inside the parent's element. The window is therefore not in the demo root's `_components` array, and `Component.destructor()`'s child recursion — the thing that makes the block's `dispose()` reach everything — never sees it. Three workarounds were considered and dropped. Parenting the window to the demo root with `addComponent` puts it in `getLaidOutComponents()`, so the demo's own layout manager would then size and move a floating window. Giving each overlay demo a small local `Panel` subclass with a `destructor()` override works, but puts a subclass in front of the reader purely for teardown — the opposite of what an example should show. Leaving the window open across navigation is a leak, and this repo has shipped two teardown-leak classes already. The clean fix is a teardown hook on `DocsDemo` itself, which belongs to the machinery plan, not to this content plan.

[^no-timers]: A timer started in `create()` outlives the block. When the reader navigates away, the block is disposed and its handles are released, but the queued callback still fires and writes through them — the exact "DOM handle not registered" failure this repo has already diagnosed once. `components/ProgressBar.md:11-25`'s own fence drives the bar with `setInterval`, which is why `progressbar-modes` shows a fixed value plus stepping buttons instead: the indeterminate bar's motion is a CSS animation the component owns and tears down itself. The rule is absolute rather than "clear the timer on dispose", because a demo module has no dispose hook to clear it in.

[^theme-tokens]: `packages/lib/llms.txt` Conventions rule 6 and `docs/concepts/theming.md` require colours to come from design tokens. In a demo the practical form is simply to pass no colour at all — every component already defaults to the theme. The grep in case 6 catches a hex or `rgb()` string; the three-theme walk catches the rest, because a themed component follows a theme switch and a hardcoded one does not.

[^placement-rule]: Two placements were compared. Putting the demo immediately *after* a heading, before the prose, means the reader meets a live widget before being told what it is. Putting it at the end of the section means the prose has already introduced the idea and the demo confirms it, which is also where a reader's eye lands before moving to the next heading. Bottom-of-section also has a mechanical advantage: the insertion point is identified by the *next* heading's text, which is stable under editing, whereas "N lines after the heading" drifts the moment a paragraph is added.

[^height-classes]: A free-form per-demo height turns into thirty separately tuned numbers that drift as content changes, and a page with two demos at 214 and 227 pixels reads as a mistake. Five classes make the value a lookup instead of a judgement, keep sibling demos visually aligned, and give case 4 something to assert. The classes are derived from what each kind of demo actually contains: one control row is a row of default-height buttons plus frame; a layout demo needs enough room for three or four stacked children to be distinguishable; a table needs a header plus five body rows.

[^theme-check]: The docs app has no theme switcher today — `packages/docs/src/shell/DocsShell.ts` never touches `ThemeManager`, so every page renders under the default `ModernTheme`. Adding a switcher to make this check convenient would be scope creep into the docs shell, which this plan does not touch. A two-line temporary edit to `main.ts`, reverted afterwards and checked by `git diff --exit-code`, gets the same coverage at no lasting cost. The three shipped themes are `ModernTheme`, `ClassicTheme`, and `DarkTheme`, all exported from `@jimka/typescript-ui/core`.

[^dropped-pages]: Four reasons drive every exclusion, and the table names which applies where. *Cannot be torn down* covers the floating overlays. *Already covered* covers pages whose behaviour a demo elsewhere shows better — a `VFlow` demo beside the `HFlow` one would differ only in axis. *Too heavy* covers pages whose demo would pull CodeMirror, a diagram engine, or a media asset into the docs bundle for one example. *Nothing to show* covers reference pages that document a type or an internal rather than a behaviour. The curated set is the point: thirty demos a reader trusts beat ninety-two a reader skims.

---

## Implementation Notes

**`border-regions` and `accordion-sections` need an extra wrapper `Panel` around their `Border` / `Accordion`-managed panel.** Both crashed the whole page on first render: `Border.doLayout()` threw `Unable to determine component size` (`Border.ts:880`) and `Accordion.doLayout()` threw `DOM handle null is not registered` (`Accordion.ts:1384-1388`, inside `createSection`'s `appendChild` calls). Root cause: `DocsDemo`'s stage `Panel` applies `autoScroll: 'both'` in its own constructor, and `Panel.setAutoScroll` → `LayoutManager.setOverflowing` synchronously drives one speculative `Fit.doLayout()` pass on the demo's returned root component *before* that component has a DOM element (it is still mid-construction, inside `entry.module.create()`). Every other layout manager used in this catalogue (`Grid`, `HBox`, `VBox`, `Split`, `Tab`) guards this with `if (!containerSize) return;` at the top of `doLayout()` and silently no-ops until the real, post-attachment pass; `Border` and `Accordion` do not — they read `getInnerSize()` / touch the DOM unconditionally and throw. This is a pre-existing inconsistency in `packages/lib/src/typescript/lib/layout/{Border,Accordion}.ts`, out of reach for this plan (`packages/lib/src` is untouched by design). The demo-local workaround: wrap the `Border` / `Accordion` panel in an outer `Panel({ layoutManager: Grid({ columns: 1, rows: 1 }) })`. `Grid` no-ops on the premature pass (protecting the inner panel from ever being reached while unattached) and fills the single cell on the real pass (`defaultFill` is `FillType.BOTH`), so the visual result is identical to a direct `Fit`. `accordion-sections` additionally sets `fillHeight: true` so its one open section absorbs the wrapper's full stretched height instead of leaving blank space below a short section.

**Pre-existing `Scrollbar` CSS-rule leak, confirmed unrelated to this plan's content.** The plan's leak check (`## Verification`, case 14) found stylesheet rules climbing on every page that renders *any* demo — roughly +34–38 rules per away-and-back cycle on `/components/Button`, `/components/List`, and others — while a page pair with no demo at all (`/components/MenuButton` ↔ `/components/SpinButton`) shows a much smaller, separate baseline leak (~4 rules/cycle). Inspecting the newly-added rules on every affected page shows the same signature regardless of which demo is present: unique `#<uuid> { ... }` rules scoped to `--ts-ui-scrollbar-track` / `-thumb` / `-arrow-*` selectors — the custom `Scrollbar` overlay pair every `autoScroll` `Panel` mounts. Since `DocsDemo`'s stage `Panel` is built with `autoScroll: 'both'` for *every* demo block (this plan's or the prerequisite's `button-basic`), this leak is triggered by the stage itself, not by anything in `src/demos/`; it would already have been present with `button-basic` alone before this plan started. The fix lives in `Scrollbar`'s (or `Panel`'s autoScroll teardown) dispose path under `packages/lib/src`, which this plan's Non-Goals explicitly put out of reach. No demo module in this catalogue was changed in response to this finding, since none of them causes it or could fix it from `src/demos/`. Flagged here rather than silently passed over, per case 14's own "a non-flat reading is a blocker" — the block applies to the machinery, not to this plan's content, and is left for a follow-up plan against `Scrollbar`/`Panel` disposal.
