# LabeledGrid Extraction & Empty-Legend Notch Collapse — Implementation Plan

## Overview

Two related papercuts on [`LabeledFieldSet`](src/typescript/lib/component/container/LabeledFieldSet.ts#L89) are fixed together because they touch the same component.

**Note 1 — extract the labelled grid.** `LabeledFieldSet` couples two separable concerns: (1) a baseline-aligned title/field grid (multi-column via `columns`), and (2) `<fieldset>` chrome (a bordered box with a `<legend>`). Today concern (1) lives inside the `_FieldSet` subclass and is unreachable without the border/legend. This plan extracts the interior grid into a new standalone container, **`LabeledGrid`**, rendered in a plain `<div>` with no border and no legend, exposing the same `addField` / `addRow` / `addFullWidthRow` methods and `columns` / `fieldSpacing` / `rows` options. `LabeledFieldSet` then *composes* a `LabeledGrid` inside its `<fieldset>` chrome (via a `Fit` layout), so existing consumers are unaffected.

**Note 2 — collapse the empty-legend notch.** A `FieldSet` (and therefore a `LabeledFieldSet`) with an empty title still reserves the `<legend>` notch in the top border, leaving a visible gap. Because the extraction moves the grid out of the `<fieldset>` but the legend fix is a `<fieldset>`-chrome concern, both land in the same files: `LabeledGrid` has no legend at all, and `FieldSet` collapses its own notch when the title is empty.

New file: [`LabeledGrid.ts`](src/typescript/lib/component/container/LabeledGrid.ts). Modified: [`LabeledFieldSet.ts`](src/typescript/lib/component/container/LabeledFieldSet.ts#L89), [`FieldSet.ts`](src/typescript/lib/component/container/FieldSet.ts#L46), the container [`index.ts`](src/typescript/lib/component/container/index.ts) barrel, and tests.

---

## Architecture Decisions

### Name — `LabeledGrid`

Chosen over the alternatives. It reads as "a grid of labelled components" and composes cleanly: **`LabeledFieldSet` = a `LabeledGrid` inside a `FieldSet`**, mirroring the existing `FieldSet` → `LabeledFieldSet` naming pair (the `Labeled` prefix is already the library's word for "baseline-aligned title/field content"). Rejected: `LabeledFieldGrid` (redundant — "Field" + "Grid" both describe the cells), `FieldGrid` (drops the "labelled" semantics that are the point), `LabeledFields` (implies a flat list, not a 2-D multi-column grid).

### `LabeledGrid extends Container` (not `Component`, not `Panel`)

Matches the sibling self-managing containers `AccordionPanel` and `TabPanel`, which both `extend Container` and own an internal layout manager. `Container` renders a plain `<div>` (default tag), carries **zero insets**, no border, and no scroll — exactly the "chrome-less" surface Note 1 asks for. `Container.clampsToContentSize` is `false` (fills its allocated slot), but that only affects the component's *rendered* box clamping, **not** size reporting: `getPreferredSize` / `getMinSize` still delegate to the layout manager (the `Grid`), so a `LabeledGrid` reports its grid-content size to a content-sizing parent (e.g. `VBox` preferred mode) exactly as needed. It needs no `preferredSize`/`minSize` default-clearing because `Container` (unlike `FieldSet`) sets no fixed size defaults.

### `LabeledFieldSet` composes via a `Fit` layout, forwarding the add-methods

`LabeledFieldSet` stays a `_FieldSet` subclass (preserving its constructor signature and all `FieldSet` chrome/behaviour). Instead of installing a `Grid` as its own layout manager, it now installs a [`Fit`](src/typescript/lib/layout/Fit.ts) layout with a single child: an internal `LabeledGrid`. `Fit` forwards the child's preferred/min/max sizes ([`Fit.ts:86-105`](src/typescript/lib/layout/Fit.ts#L86)), so the `FieldSet`'s content-derived size (grid content + legend clearance + insets) is unchanged. `addField` / `addRow` / `addFullWidthRow` become one-line forwarders to the internal `LabeledGrid`, each returning `this` (the fieldset) to preserve chaining. `getColumns()` forwards too. A new typed accessor `getGrid()` exposes the internal `LabeledGrid` (mirroring `AccordionPanel.getAccordion()`), which library-internal tests use to inspect grid cells.

### Empty-legend collapse lives in `FieldSet`, keyed off empty title

The notch is `<fieldset>`/`<legend>` chrome, so the fix belongs in `FieldSet`, benefiting **every** `FieldSet` (bare or `LabeledFieldSet`) whose title is `""` (the default title). Mechanism: when the title is empty, set the `Legend` component to `display:none` via `setDisplayed(false)`. A `display:none` `<legend>` is not rendered, so the browser draws the top border continuously — the native equivalent of `<fieldset><legend></legend></fieldset>`. When the title is non-empty, `setDisplayed(true)` restores `display:block`, which is already the framework's default display for every rendered element ([`Component.ts:4019-4021`](src/typescript/lib/core/Component.ts#L4019)), so the notch renders exactly as today. Alongside the display toggle, `legendClearance()` returns `0` and `getMinSize()` skips the legend-width augmentation when the title is empty, so an untitled fieldset reserves no top clearance and no legend-driven min width.

### Options typing — shared `LabeledGridOptions`, multiple-extended into `LabeledFieldSetOptions`

`LabeledGridOptions extends ContainerOptions` adds `columns` / `fieldSpacing` / `rows`. `LabeledFieldSetOptions extends FieldSetOptions, LabeledGridOptions` (both ultimately extend `ComponentOptions`; no member conflicts), so the three grid fields are declared once. The descriptor types `LabeledFieldDescriptor` and `LabeledRowDescriptor` move to `LabeledGrid.ts` (they describe grid content) and are imported by `LabeledFieldSet.ts`; the barrel re-exports them from the new path, so the public import (`@jimka/typescript-ui/component/container`) is unchanged.

---

## Public API

New file `LabeledGrid.ts` exports (callable idiom, as every sibling: `const XCallable = callable(X); type XCallable = X; export { X as _X, XCallable as X }`):

```typescript
export interface LabeledFieldDescriptor {
    title: string;
    component: Component;
}

export type LabeledRowDescriptor =
    | LabeledFieldDescriptor[]
    | { component: Component; fullWidth: true };

export interface LabeledGridOptions extends ContainerOptions {
    /** Logical title/field columns laid side by side. Default `1`. */
    columns?: number;
    /** Inter-cell spacing in px for the grid. Default `8`. */
    fieldSpacing?: number;
    /** Declarative rows, applied in order at construction via the same path as `addRow`. */
    rows?: LabeledRowDescriptor[];
}

class LabeledGrid extends Container<LabeledGridOptions> {
    constructor(options?: LabeledGridOptions);
    addField(title: string, component: Component): this;
    addRow(fields: LabeledFieldDescriptor[]): this;
    addFullWidthRow(component: Component): this;
    getColumns(): number;
}
// exported as: _LabeledGrid (raw class), LabeledGrid (callable)
```

`LabeledFieldSet.ts` — unchanged public constructor signature; `LabeledFieldSetOptions` re-typed and one accessor added:

```typescript
export interface LabeledFieldSetOptions extends FieldSetOptions, LabeledGridOptions {}

class LabeledFieldSet extends _FieldSet {
    constructor(title?: string, options?: LabeledFieldSetOptions, subclassDefaults?: Partial<LabeledFieldSetOptions>);
    addField(title: string, component: Component): this;      // forwards to internal LabeledGrid, returns this
    addRow(fields: LabeledFieldDescriptor[]): this;           // forwards, returns this
    addFullWidthRow(component: Component): this;              // forwards, returns this
    getColumns(): number;                                    // forwards
    getGrid(): LabeledGrid;                                  // NEW — typed accessor for the internal LabeledGrid
}
```

`FieldSet.ts` — no signature changes; internal behaviour change only (empty-title notch collapse).

---

## Internal Structure

**`LabeledGrid`** carries the state and methods lifted verbatim from today's `LabeledFieldSet`:

- Fields: `_columns: number`, `_grid: Grid` (the layout manager), `_flowCol = 0`, `_rowCount = 0`.
- Constructor: reads `options?.columns ?? 1`, builds the `Grid({ baselineAlign: true, columns: 2 * this._columns, spacing: options?.fieldSpacing ?? FIELD_SPACING_DEFAULT, columnTracks: this.buildColumnTracks(), rows: 0, rowTracks: [] })`, `this.setLayoutManager(this._grid)`, then `if (options?.rows) this.applyRows(options.rows)`.
- Methods moved unchanged: `addField`, `addRow`, `addFullWidthRow`, `getColumns`, and privates `buildColumnTracks`, `applyRows`, `openRow`, `finishRow`, `growRows`. `FIELD_SPACING_DEFAULT = 8` moves here too.
- Imports move here: `Grid`, `GridConstraints`, `GridTrack`, `Text`.

**`LabeledFieldSet`** becomes thin:

```typescript
private _labeledGrid: LabeledGrid;

constructor(title: string = "", options?: LabeledFieldSetOptions, subclassDefaults?: Partial<LabeledFieldSetOptions>) {
    super(title, options, { ..._defaultLabeledFieldSetOptions, ...(subclassDefaults ?? {}) });

    this._labeledGrid = new _LabeledGrid({
        columns:      options?.columns,
        fieldSpacing: options?.fieldSpacing,
        rows:         options?.rows,
    });

    this.setLayoutManager(new Fit());
    this.addComponent(this._labeledGrid);
}

addField(title: string, component: Component): this { this._labeledGrid.addField(title, component); return this; }
addRow(fields: LabeledFieldDescriptor[]): this { this._labeledGrid.addRow(fields); return this; }
addFullWidthRow(component: Component): this { this._labeledGrid.addFullWidthRow(component); return this; }
getColumns(): number { return this._labeledGrid.getColumns(); }
getGrid(): LabeledGrid { return this._labeledGrid; }
```

`_defaultLabeledFieldSetOptions` (clearing FieldSet's fixed `preferredSize`/`minSize`) is **kept** — the FieldSet must still size to its content (now forwarded through `Fit` from the `LabeledGrid`).

**`FieldSet`** empty-legend collapse — three touch points, all keyed off `this.getTitle() === ""`:

1. Title routing: in `setTitle`, after `this._legend.setText(title)`, add `this._legend.setDisplayed(title !== "")`. In the **constructor**, after `this._legend.setText(title)`, add the same `this._legend.setDisplayed(title !== "")` so an untitled fieldset starts collapsed.
2. `legendClearance()` — first line: `if (this.getTitle() === "") return 0;` (before the `_legendClearance` cache check, so a title later cleared to `""` does not return a stale cached positive height).
3. `getMinSize()` — first line: `if (this.getTitle() === "") return super.getMinSize();` (skip the legend-width augmentation; return the plain component+layout min).
4. `clampLegendWidth()` — early-return when `this.getTitle() === ""` (no point clamping a hidden legend). Optional but tidy.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/container/LabeledGrid.ts`.** Move from `LabeledFieldSet.ts`: the `FIELD_SPACING_DEFAULT` const, the `LabeledFieldDescriptor` interface, the `LabeledRowDescriptor` type, and the full grid mechanism (`_columns`/`_grid`/`_flowCol`/`_rowCount` fields; `addField`/`addRow`/`addFullWidthRow`/`getColumns`; privates `buildColumnTracks`/`applyRows`/`openRow`/`finishRow`/`growRows`). Declare `class LabeledGrid extends Container<LabeledGridOptions>` with `constructor(options?: LabeledGridOptions)` per _Internal Structure_. Add `LabeledGridOptions extends ContainerOptions` with `columns`/`fieldSpacing`/`rows`. Imports: `Component` (`~/core/Component.js`), `Container, ContainerOptions` (`~/core/Container.js`), `Grid` (`~/layout/Grid.js`), `GridConstraints` (`~/layout/GridConstraints.js`), `GridTrack` (`~/layout/GridTrack.js`), `Text` (`~/component/input/Text.js`), `callable` (`~/core/Callable.js`). Carry the SPDX header line. Export `_LabeledGrid` + `LabeledGrid` via the callable idiom. Keep the existing doc-comments on every moved member; add a class doc-comment stating it is the chrome-less grid `LabeledFieldSet` composes.

2. **Rewrite `LabeledFieldSet.ts` to compose.** Delete the moved grid mechanism and the moved const/descriptor types. Change imports: drop `Grid`/`GridConstraints`/`GridTrack`/`Text`; add `Fit` (`~/layout/Fit.js`) and `_LabeledGrid, LabeledGrid, LabeledGridOptions, LabeledFieldDescriptor, LabeledRowDescriptor` (`~/component/container/LabeledGrid.js`); keep `Component`, `_FieldSet, FieldSetOptions`, `callable`. Re-type `LabeledFieldSetOptions extends FieldSetOptions, LabeledGridOptions {}`. Keep `_defaultLabeledFieldSetOptions`. Replace the body with the thin constructor + four forwarders + `getGrid()` from _Internal Structure_. Keep the class/export names identical (`_LabeledFieldSet`, `LabeledFieldSet`).

3. **Update `FieldSet.ts` for the empty-legend collapse.** Apply the four touch points in _Internal Structure_ → _FieldSet_ (constructor `setDisplayed`, `setTitle` `setDisplayed`, `legendClearance` early-`0`, `getMinSize` early-`super`, optional `clampLegendWidth` early-return). No import changes.

4. **Update the barrel `src/typescript/lib/component/container/index.ts`.** Add `export { LabeledGrid } from '~/component/container/LabeledGrid.js';` and `export type { LabeledGridOptions } from '~/component/container/LabeledGrid.js';`. Move the `LabeledFieldDescriptor, LabeledRowDescriptor` type export so it points at `~/component/container/LabeledGrid.js` (they no longer live in `LabeledFieldSet.js`); keep `LabeledFieldSetOptions` exported from `LabeledFieldSet.js`. Place the new `LabeledGrid` exports next to the `LabeledFieldSet` block for locality.

5. **Update `tests/component/container/LabeledFieldSet.test.ts`.** The suite inspects `form.getComponents()` expecting grid cells; after composition the fieldset's child list is the single `LabeledGrid`. Re-point cell assertions through `form.getGrid().getComponents()`: the "starts empty" check becomes `expect(form.getGrid().getComponents().length).toBe(0)` (and `expect(form.getComponents().length).toBe(1)` for the wrapping grid); the `addField` two-cell / order checks, the `addFullWidthRow` `toContain`, and the `addRow` `toContain` checks all read `form.getGrid().getComponents()`. The chainability assertions (`toBe(form)`), `getColumns` tests, and the min-height tests are unchanged and must still pass.

6. **Add `tests/component/container/LabeledGrid.test.ts`.** Mirror the column and field-structure suites directly against `LabeledGrid` (default columns = 1; configured columns; `addField` appends `Text` + component and is chainable, reading `grid.getComponents()`; `addFullWidthRow`; `addRow`). Reuse the `CONFIG` + `installTestDOM` harness from the sibling tests.

7. **Add an empty-legend collapse test to `tests/component/container/FieldSet.test.ts`.** `new FieldSet()` (empty title) → `getPerimeterSize().top` equals the top inset with **no** legend clearance added (i.e. `fs.getInsets()!.getTop()`, not `+ 16`). `new FieldSet('Group')` still adds the fallback clearance (existing test). Optionally assert `new FieldSet().setTitle('X')` then `.setTitle('')` returns clearance to `0` (cache-staleness guard).

8. **Regression checkpoints.** `grep -rn "new Grid" src/typescript/lib/component/container/LabeledFieldSet.ts` → expect zero matches (grid mechanism fully moved). `grep -rn "LabeledFieldDescriptor\|LabeledRowDescriptor" src/typescript/lib/component/container/LabeledFieldSet.ts` → only import + usage in method signatures, not `export interface`/`export type` declarations.

9. **Docs & manifest** — see _Documentation Impact_.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `src/typescript/lib/component/container/LabeledGrid.ts` |
| Modify | `src/typescript/lib/component/container/LabeledFieldSet.ts` |
| Modify | `src/typescript/lib/component/container/FieldSet.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` |
| Modify | `tests/component/container/LabeledFieldSet.test.ts` |
| Create | `tests/component/container/LabeledGrid.test.ts` |
| Modify | `tests/component/container/FieldSet.test.ts` |
| Create | `docs/components/LabeledGrid.md` |
| Modify | `docs/components/LabeledFieldSet.md` |
| Modify | `docs/components/index.md` |
| Modify | `docs/.vitepress/config.mts` |
| Modify | `scripts/llms/manifest.data.mjs` |

---

## Expected Behaviour

Unit-testable (Node/vitest via `installTestDOM`):

- **LabeledGrid column count.** `new LabeledGrid()` → `getColumns() === 1`; `new LabeledGrid({ columns: 2 })` → `2`.
- **LabeledGrid field structure.** `addField(title, c)` appends exactly two cells — a `Text` label then `c` (order preserved) — and returns the grid. `addFullWidthRow(w)` appends `w` (present in `getComponents()`) and returns the grid. `addRow([...])` flows all pair components into the child list and returns the grid. (Same cases as today's `LabeledFieldSet` suite, now against `LabeledGrid`.)
- **LabeledGrid declarative rows.** `new LabeledGrid({ rows: [[{title,component}], {component, fullWidth:true}] })` yields the same child list as the equivalent imperative calls.
- **LabeledFieldSet unchanged surface.** `getColumns()` reflects `columns`; `addField`/`addRow`/`addFullWidthRow` return the fieldset (`toBe(form)`); the cells land on `form.getGrid().getComponents()`; `form.getComponents()` is `[the LabeledGrid]` (length 1); `getGrid()` returns that `LabeledGrid`.
- **LabeledFieldSet content sizing preserved.** A one-row `LabeledFieldSet` reports `getMinSize().height < 100` (fixed floor dropped); an N-stacked-field form reports `getMinSize().height >= N * perFieldMin` (min forwarded through `Fit`). (Existing tests — must still pass.)
- **FieldSet empty-legend collapse.** `new FieldSet()` (empty title) → `getPerimeterSize().top === getInsets().getTop()` (no `+16` clearance); `getMinSize()` equals the base component+layout min (no legend-width augmentation). `new FieldSet('Group')` → `getPerimeterSize().top === insetTop + 16` (unchanged). After `setTitle('X')` then `setTitle('')`, clearance returns to `0`.

Manual / visual verification (geometry/rendering the headless harness can't confirm):

- An untitled `FieldSet` / `LabeledFieldSet` renders a **continuous** top border (no gap where the legend notch was).
- A titled fieldset still renders the legend inside the notch, with the border broken around the title as before.
- A standalone `LabeledGrid` renders as a plain `<div>` — no border, no legend — with its labelled fields baseline-aligned across `columns`.

---

## Verification

- `npm run build:lib` (or the repo's typecheck) — no TS errors; confirm `LabeledFieldSetOptions extends FieldSetOptions, LabeledGridOptions` compiles.
- `npx vitest run tests/component/container/LabeledGrid.test.ts tests/component/container/LabeledFieldSet.test.ts tests/component/container/FieldSet.test.ts` — all green.
- Grep invariants from step 8.
- Docs build (`npm run docs:build` or the project's docs command) succeeds with the new page and sidebar entry.
- Manual: exercise a `LabeledFieldSet` in the demo (`src/typescript/BindingPanel.ts` uses it) — titled form looks identical to today; construct one with `''` title and confirm the top border is unbroken; drop a bare `LabeledGrid` into a panel and confirm chrome-less baseline-aligned fields.

---

## Documentation Impact

- **New page `docs/components/LabeledGrid.md`.** Modelled on `LabeledFieldSet.md`: describe the chrome-less baseline grid, the `addField`/`addRow`/`addFullWidthRow` API and `columns`/`fieldSpacing`/`rows` options, and the "See also" cross-links to `LabeledFieldSet` (the fieldset-wrapped variant) and `Grid` (the layout used internally). Import path `@jimka/typescript-ui/component/container`.
- **`docs/components/LabeledFieldSet.md`.** Update the intro/"Internally" paragraph: it now *composes* a `LabeledGrid` inside a `FieldSet` rather than being a `Grid` directly; add a "See also" link to `LabeledGrid`.
- **`docs/components/index.md`.** Add a `LabeledGrid` table row in the Containers section next to `FieldSet`/`LabeledFieldSet` (link `/components/LabeledGrid`).
- **`docs/.vitepress/config.mts`.** Add `{ text: 'LabeledGrid', link: '/components/LabeledGrid' }` to the Containers sidebar group, adjacent to the `LabeledFieldSet` entry (line ~122).
- **`scripts/llms/manifest.data.mjs`.** Add `{ task: "Line up labelled components without a border/legend", symbol: "LabeledGrid" }` next to the `LabeledFieldSet` entry (line ~43). `llms.txt` is generated from this — regenerate per the repo's generate step; do not hand-edit `llms.txt`.
- **API reference** (`docs/api/…`) is TypeDoc-generated from the exported symbols; the new `_LabeledGrid`/`LabeledGrid`/`LabeledGridOptions` exports surface automatically on the next docs build. Keep `@category Components` on the new public types, matching siblings.
- The `@link` cross-references (`{@link FieldSet}`, `{@link Grid}`, etc.) in the moved doc-comments remain valid.

---

## Potential Challenges

- **Existing `LabeledFieldSet` tests read `getComponents()` for cells.** They break under composition (cells move to the inner grid). Mitigation: step 5 re-points them through the new `getGrid()` accessor — this is the load-bearing test edit, do not skip it.
- **`setDisplayed(true)` writes `display:block` on the legend.** This is already the framework's default rendered display for every element ([`Component.ts:4019`](src/typescript/lib/core/Component.ts#L4019)), so the notch renders as today; the risk is only if a future change special-cases legend display. Mitigation: if the notch ever regresses on a titled fieldset, restore the legend by clearing the inline `display` instead of forcing `block`.
- **Stale legend-clearance cache.** `_legendClearance` caches a positive measured height; a title later cleared to `""` must not return it. Mitigation: the empty-title early-return in `legendClearance()` is placed *before* the cache check (step 3).
- **`Fit` adds one nesting level.** The `LabeledGrid` now sits one layer below the `<fieldset>`; the `FieldSet`'s legend clearance + insets still offset the grid correctly because `Fit` positions the child inside the fieldset's inner (post-perimeter) region. Verified via the retained min-height tests.

---

## Critical Files

- [`src/typescript/lib/component/container/LabeledFieldSet.ts`](src/typescript/lib/component/container/LabeledFieldSet.ts) — the grid mechanism to extract, verbatim.
- [`src/typescript/lib/component/container/FieldSet.ts`](src/typescript/lib/component/container/FieldSet.ts) — base chrome; `legendClearance`/`getMinSize`/`setTitle`/`clampLegendWidth` are the collapse touch points; the `_legend: Legend` field.
- [`src/typescript/lib/component/container/AccordionPanel.ts`](src/typescript/lib/component/container/AccordionPanel.ts) — the precedent for a `Container` subclass owning an internal manager and exposing a typed accessor (`getAccordion()` ↔ `getGrid()`) plus the callable/barrel idiom.
- [`src/typescript/lib/core/Container.ts`](src/typescript/lib/core/Container.ts) — confirms `Container` renders a `<div>`, zero insets, `clampsToContentSize=false`; base for `LabeledGrid`.
- [`src/typescript/lib/layout/Fit.ts`](src/typescript/lib/layout/Fit.ts) — the single-child fill layout `LabeledFieldSet` uses; forwards child preferred/min/max.
- [`src/typescript/lib/component/container/index.ts`](src/typescript/lib/component/container/index.ts) — barrel export surface.
- [`tests/component/container/LabeledFieldSet.test.ts`](tests/component/container/LabeledFieldSet.test.ts) & [`FieldSet.test.ts`](tests/component/container/FieldSet.test.ts) — the test harness (`installTestDOM`, `CONFIG`) and the assertions to migrate.

---

## Non-Goals

- **App-side adoption.** The sqladmin demo app (and any consumer that would rather use a bare `LabeledGrid` than a `LabeledFieldSet`) is a downstream follow-up; this plan only lands the library capability. No sqladmin edits.
- **Changing `LabeledFieldSet`'s public surface.** Constructor signature, option names, and method names are preserved; the only additions are the internal-facing `getGrid()` accessor and the re-typed (superset) options interface.
- **Re-parenting `LabeledFieldSet` onto `LabeledGrid` by inheritance.** Composition (a `LabeledGrid` inside the `<fieldset>`) is deliberate — `LabeledFieldSet` *is-a* `FieldSet` and *has-a* grid, not *is-a* grid.
- **Reworking the baseline-grid algorithm, spacing defaults, or `Grid` track logic.** The mechanism moves unchanged.
