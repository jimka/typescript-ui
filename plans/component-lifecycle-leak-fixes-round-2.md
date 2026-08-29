---
touches-shared: [src/typescript/lib/component/input/ComboBox.ts, src/typescript/lib/component/list/AbstractSelectableList.ts, tests/component/dispose-full-teardown.test.ts, tests/component/dispose-listener-teardown.test.ts]
---

# Component Lifecycle Leak Fixes (Round 2) — Implementation Plan

## Overview

Eight component classes hold a child in a private field and mount it with a raw `DOM.sink.appendChild` instead of `addComponent`. A raw-appended child never enters `_components`, so [`Component.destructor()`](src/typescript/lib/core/Component.ts#L956)'s child recursion cannot reach it, and the class needs its own `destructor()` override to dispose it. None of the eight has one. Five of them also *discard* a raw-held child during normal operation — a tree row swapping its expand caret for a loading spinner, a renderer swapping its icon — by detaching the element and nulling the field, which leaks on every data refresh rather than only at teardown.

Separately, [`AbstractSelectableList.syncRows()`](src/typescript/lib/component/list/AbstractSelectableList.ts#L1597) shrinks its row pool with `removeComponent`, which is detach-only, so every surplus row and everything it owns survives the shrink. The same file's `resetEmptyPlaceholder()` drops its cached placeholder the same way.

The campaign that established the fix pattern left two registry tests as its regression guard, and both have gone stale. [`dispose-full-teardown.test.ts`](tests/component/dispose-full-teardown.test.ts#L17) carries a hand-written count of `destructor()` declarations that says 35 where the source now has 54, plus a prose list of unreconciled classes that is out of date in both directions. This plan makes both registries derive their expected class list from the library source at test run time, and gives the teardown registry an assertion that actually detects these leaks: its only check today counts leftover per-instance CSS rules, and a leaked label or renderer writes none.

---

## Architecture Decisions

### A raw-appended child is disposed in a `destructor()` override

Every class that raw-appends a child gains a `protected destructor()` that disposes each raw-held field and ends with `super.destructor()`, mirroring [`SplitGutter.destructor()`](src/typescript/lib/component/container/SplitGutter.ts#L515), [`HeaderCell.destructor()`](src/typescript/lib/component/table/cell/Header.ts#L702), [`TabButton.destructor()`](src/typescript/lib/component/button/TabButton.ts#L279), [`Row.destructor()`](src/typescript/lib/component/table/Row.ts#L1001) and [`VirtualRowView.destructor()`](src/typescript/lib/component/shared/VirtualRowView.ts#L133).[^precedent] A nullable field uses `?.dispose()`; a non-nullable one uses a plain `.dispose()`.

### A discarded child is disposed where it is discarded

Wherever a raw-held child is replaced or dropped mid-life, the outgoing child is disposed at that point instead of having its element detached. `dispose()` removes the element itself, so the `DOM.sink.removeChild` / `DOM.source.getParentNode` guard those sites use today is deleted rather than kept alongside.[^dispose-detaches]

Every site, and which of the two mechanisms applies:

| File | Site | Field(s) | Mechanism |
|---|---|---|---|
| `tree/TreeRow.ts` | `setRowData` rebind | `_toggle`, `_spinner` | dispose at the discard point |
| `tree/TreeRow.ts` | `setRenderer` | `_renderer` | dispose at the discard point |
| `tree/TreeRow.ts` | teardown | `_renderer`, `_toggle`, `_spinner` | new `destructor()` |
| `tree/renderer/Label.ts` | teardown | `_label` | new `destructor()` |
| `tree/renderer/IconLabel.ts` | `update` glyph change | `_icon` | dispose at the discard point |
| `tree/renderer/IconLabel.ts` | teardown | `_label`, `_icon` | new `destructor()` |
| `list/AbstractSelectableList.ts` | `SelectableListRow.setRenderer` | `_renderer` | dispose at the discard point |
| `list/AbstractSelectableList.ts` | `SelectableListRow` teardown | `_renderer` | new `destructor()` |
| `list/AbstractSelectableList.ts` | `syncRows` pool shrink | surplus `_rowPool` entries | dispose after `removeComponent` |
| `list/AbstractSelectableList.ts` | `resetEmptyPlaceholder` | `_emptyPlaceholder` | dispose at the discard point |
| `list/AbstractSelectableList.ts` | teardown | `_emptyPlaceholder` | existing `destructor()` gains one line |
| `list/renderer/Label.ts` | teardown | `_label` | new `destructor()` |
| `list/renderer/Glyph.ts` | `update` glyph change | `_icon` | dispose at the discard point |
| `list/renderer/Glyph.ts` | teardown | `_label`, `_icon` | new `destructor()` |
| `input/ComboBox.ts` | `ComboBoxLabel.setRenderer` | `_renderer` | dispose at the discard point |
| `input/ComboBox.ts` | `ComboBoxLabel` teardown | `_renderer` | new `destructor()` |
| `container/FieldSet.ts` | teardown | `_legend` | new `destructor()` |

### The pool shrink disposes each surplus row rather than calling `disposeAllComponents()`

`syncRows` disposes the surplus rows individually, after the existing `removeComponent` call. [`Component.disposeAllComponents()`](src/typescript/lib/core/Component.ts#L6533) is the wrong fit: it discards *every* child of the container, and `_innerPanel` also holds the empty-state placeholder, which the shrink must leave alone.[^not-dispose-all]

### The four renderer classes are in scope

`LabelTreeNodeRenderer`, `IconLabelTreeNodeRenderer`, `LabelListItemRenderer` and `GlyphListItemRenderer` each raw-append a `Text` label — and, for two of them, a `Glyph` icon — and none has a `destructor()`. Disposing a row's renderer without them releases the renderer and leaves its label behind, so the four leaking classes the audit named cannot be fixed without also fixing the four renderers they own.[^renderer-scope]

### `FieldSet` gets the destructor; `LabeledFieldSet` inherits it

`FieldSet` raw-appends `_legend` in `render()`, so `FieldSet.destructor()` disposes it. `LabeledFieldSet` declares no `Legend` of its own and registers its `LabeledGrid` through `addComponent`, so it needs no override — it inherits `FieldSet`'s.[^labeled-fieldset]

### `ComboBoxLabel` gets the destructor; `ComboBox.destructor()` is untouched

The leaked renderer belongs to `ComboBoxLabel`, a second class in `ComboBox.ts`. `ComboBox` registers `_label` through `addComponent`, so the base recursion already reaches it — what it cannot reach is the renderer `ComboBoxLabel` raw-appends. The existing [`ComboBox.destructor()`](src/typescript/lib/component/input/ComboBox.ts#L1265) stays as it is.

### Both registries derive their class list from the library source

A new plain-ESM helper scans `src/typescript/lib/**/*.ts` and returns the class names matching each registry's pattern — `^\s*protected destructor(` for the teardown registry, `Event.add{,Subtree,Viewport}Listener(this,` for the listener registry. Each registry row declares which of those classes it is evidence for, and the test asserts that every scanned class is either claimed by a row or named in a shrink-only baseline array. No count and no class list is hand-maintained.[^self-derived] The helper is plain ESM with a sibling `.d.mts`, mirroring [`tests/helpers/readReadmes.mjs`](tests/helpers/readReadmes.mjs), because `tsconfig.test.json` builds a deliberately Node-types-free program that cannot import `node:fs`.

### The teardown registry gains a construct/destroy balance assertion

`dispose-full-teardown.test.ts` keeps its per-instance-CSS-rule assertion and adds a second one: after `dispose()`, `Diagnostics.counters()` must report as many components destroyed as constructed. The rule check detects none of the leaks in this plan; the balance check detects all of them.[^balance-probe]

---

## Internal Structure

### The source scan helper

`tests/helpers/libraryClassScan.mjs` walks the library source and returns a sorted, de-duplicated array of class names. Both scans attribute a matched line to the most recent class declared at column 0, and both exclude `Component` itself — the base class declares both patterns and is the mechanism under test, not a subject of it.

```js
/** Top-level class declaration; every library class is declared at column 0. */
const CLASS_DECLARATION = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/;

/** An indented one would be attributed to the wrong class, so the scan refuses to guess. */
const NESTED_CLASS_DECLARATION = /^\s+(?:export\s+)?(?:abstract\s+)?class\s+\w+/;

/** The teardown registry's source of truth. */
const DESTRUCTOR_DECLARATION = /^\s*protected destructor\(/;

/** The listener registry's source of truth. */
const SELF_LISTENER_REGISTRATION = /Event\.add(Listener|SubtreeListener|ViewportListener)\(\s*this\s*,/;
```

A line matching `NESTED_CLASS_DECLARATION` makes the scan throw, naming the file and line, so the column-0 assumption cannot rot silently. The library has no such line today.

The sibling `libraryClassScan.d.mts` declares the two exports:

```typescript
export function classesDeclaringDestructor(): string[];
export function classesRegisteringEventListeners(): string[];
```

### The registry row shape

Both registries gain one optional field:

```typescript
/**
 * Source classes this row is the registry's evidence for. Omitted where the
 * row exercises the base class's own recursion rather than a declared
 * override.
 */
covers?: string[];
```

`covers` is not "every override this row's `dispose()` happens to reach" — it is what the row was written to prove. Every row's exact value is given in `## Ordered Implementation Steps`; do not derive new ones.

| Row | `covers` | Why |
|---|---|---|
| `Markdown` | `['Markdown']` | `Markdown` declares its own `destructor()` |
| `MenuBarButton` | omitted | declares none; the row covers the base recursion |
| `Table (cell-editor pool)` | `['TableBody']` | written for `TableBody`'s editor pool, not `Table`'s own override |
| `List` | `['AbstractSelectableList', 'SelectableListRow', 'LabelListItemRenderer']` | one `dispose()` exercises all three new overrides |

### The baseline ratchet

Each registry holds a sorted array of scanned classes that no row claims. The test computes the same difference and compares:

```typescript
const claimed   = new Set(REGISTRY.flatMap((row) => row.covers ?? []));
const scanned   = classesDeclaringDestructor();
const unclaimed = scanned.filter((name) => !claimed.has(name));

it('every covers entry still declares a destructor', () => {
    expect([...claimed].filter((name) => !scanned.includes(name))).toEqual([]);
});

it('every declared destructor is claimed by a row or listed as unclaimed', () => {
    expect(unclaimed).toEqual(UNCLAIMED_DESTRUCTOR_CLASSES);
});
```

What each kind of drift fails on:

| Change | Effect on the test |
|---|---|
| A new class gains `destructor()`, with no row and no baseline entry | `unclaimed` grows; the second assertion fails |
| A row is added for a baseline class, baseline not shrunk | `unclaimed` shrinks; the second assertion fails |
| A class in the baseline is renamed or loses its `destructor()` | `unclaimed` shrinks; the second assertion fails |
| A `covers` entry names a class that declares no `destructor()` | the first assertion fails |

---

## Ordered Implementation Steps

The two registry files are rewired first, so every fix below them lands against a failing test. Both registry files stay red from step 2 until step 9 completes; work the steps in order and use each step's targeted check rather than re-running the whole file.

### 1. Add the source scan helper

Create `packages/lib/tests/helpers/libraryClassScan.mjs` and `packages/lib/tests/helpers/libraryClassScan.d.mts`, following `readReadmes.mjs` / `readReadmes.d.mts` for the SPDX header, the `fileURLToPath(new URL(...))` root resolution and the "why plain ESM" comment. Implement the two exports per `## Internal Structure`.

Verify: from the repo root,

```
node -e "import('./packages/lib/tests/helpers/libraryClassScan.mjs').then(m => console.log(m.classesDeclaringDestructor().length, m.classesRegisteringEventListeners().length))"
```

prints `53 57`. If either number differs, **stop and report** — the baselines in steps 2 and 3 are computed against those two figures.

### 2. Rewire `dispose-listener-teardown.test.ts`

In `packages/lib/tests/component/dispose-listener-teardown.test.ts`:

- Import `classesRegisteringEventListeners` from `'../helpers/libraryClassScan.mjs'` and `List` from `'~/component/list/List'`.
- Add `covers?: string[]` and `ids?: (c: Component) => string[]` to the `REGISTRY` element type.
- Give the six existing rows `covers: ['Link']`, `['MenuItem']`, `['MenuBarButton']`, `['CollapseButton']`, `['ChartLegend']` and `['AbstractChart']` respectively.
- Add the pool-shrink row, whose `ids` hook snapshots the full three-row pool *before* shrinking it, so the two discarded rows are in the snapshot:

```typescript
{
    name: 'List (pool shrink)',
    covers: ['AbstractSelectableList', 'SelectableListRow'],
    make: () => new List({ items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }] }),
    // Snapshot all three rows' ids, then shrink to one item so the two surplus
    // rows go down syncRows' discard path before the dispose below. Collecting
    // after the shrink would miss them: they are already out of `_components`.
    ids: (c) => {
        const ids = collectIds(c);

        (c as List).setItems([{ key: 'a', label: 'A' }]);

        return ids;
    },
},
```

- In the `it` body, replace `const ids = collectIds(c);` with a call to the row's `ids` hook when it has one, falling back to `collectIds(c)`.
- Add `UNCLAIMED_LISTENER_CLASSES`, a sorted `readonly string[]` of these 49 names, with a doc comment saying entries come out as rows are added and an entry only goes in as a deliberate, commented deferral:

```
'AbstractBooleanInput', 'AbstractCalendarDropdown', 'AbstractWindow', 'Body', 'Button',
'Checkbox', 'CheckboxMenuRow', 'ComboBox', 'DateEditor', 'DateTimeEditor', 'DiagramView',
'Dialog', 'DialogBackdrop', 'Drawer', 'FileDropZone', 'Form', 'HeaderCell', 'Markdown',
'MarkdownViewer', 'MenuBar', 'Notification', 'Panel', 'ParentHeaderCell', 'PickerCell',
'PickerDay', 'PickerMonthLabel', 'PickerNavButton', 'Popover', 'RadioButton', 'RadioMenuRow',
'Rail', 'ResizeHandle', 'ScrollArrowButton', 'Scrollbar', 'Slider', 'SpinButton', 'SplitGutter',
'TabBar', 'TableBody', 'TextInput', 'TimeEditor', 'TimePickerDropdown', 'ToggleButton',
'ToolBar', 'Tree', 'TreeTable', 'WebGLCanvas', 'WindowBorder', 'WindowHeader'
```

- Add the two coverage assertions from `## Internal Structure`, against `classesRegisteringEventListeners()` and `UNCLAIMED_LISTENER_CLASSES`.
- Extend the file's header comment with a paragraph naming the scan as the source of truth for which classes must be covered.

Verify: `npx vitest run tests/component/dispose-listener-teardown.test.ts` — both coverage assertions pass; the `List (pool shrink)` row fails with two leaked ids. That failure is the reproduction; step 7 fixes it.

### 3. Rewire `dispose-full-teardown.test.ts`

In `packages/lib/tests/component/dispose-full-teardown.test.ts`:

- Replace the header comment's lines 11–36 (the hand-written count and the prose list of unreconciled classes) with a paragraph describing the scan-derived coverage check and the `UNCLAIMED_DESTRUCTOR_CLASSES` ratchet. Keep lines 1–10.
- Correct the `Menu` row's comment. It claims `Menu` has no `destructor()` of its own; `overlay/Menu.ts:715` declares one, cancelling in-flight fades and disposing an open submenu panel. Rewrite it to say the row covers that override.
- Add imports: `Diagnostics` from `'~/core/Diagnostics'`, `classesDeclaringDestructor` from `'../helpers/libraryClassScan.mjs'`, `FieldSet` from `'~/component/container/FieldSet'`, `ComboBox` from `'~/component/input/ComboBox'`, `List` from `'~/component/list/List'`, `Tree` from `'~/component/tree/Tree'`, `GlyphListItemRenderer` from `'~/component/list/renderer/Glyph'`, `IconLabelTreeNodeRenderer` from `'~/component/tree/renderer/IconLabel'`.
- Add `covers?: string[]` and `undisposedBaseline?: number` to the `REGISTRY` element type.
- Give the 25 existing rows their `covers` values. These twenty each cover their own name: `Markdown`, `Video`, `VideoPlayer`, `MenuItem`, `CodeEditor`, `MarkdownEditor`, `PaginationBar`, `Menu`, `MenuButton`, `SplitButton`, `ToolBar`, `Table`, `DateEditor`, `TimeEditor`, `DateTimeEditor`, `MenuBar`, `Popover`, `TabButton`, `TabBar`, `ScrollStrip`. `AbstractChart (via LineChart)` covers `['AbstractChart']` and `Table (cell-editor pool)` covers `['TableBody']`. `ChartLegend`, `MenuBarButton` and `Link` omit `covers`.
- Add these six rows:

```typescript
{ name: 'FieldSet', covers: ['FieldSet'], make: () => new FieldSet('Group') },
{
    name: 'ComboBox',
    covers: ['ComboBox', 'ComboBoxLabel'],
    make: () => new ComboBox({ items: [{ key: 'a', label: 'Alpha' }] }),
},
{
    name: 'List',
    covers: ['AbstractSelectableList', 'SelectableListRow', 'LabelListItemRenderer'],
    make: () => new List({ items: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }] }),
},
{
    // setRendererFactory after render so the per-row renderer *swap* path runs
    // too, not only the teardown path.
    name: 'List (glyph renderer)',
    covers: ['GlyphListItemRenderer'],
    make: () => {
        const list = new List({
            items: [
                { key: 'a', label: 'Alpha', glyph: 'caret-right' },
                { key: 'b', label: 'Beta',  glyph: 'caret-down'  },
            ],
            rendererFactory: () => new GlyphListItemRenderer(),
        });

        list.getElement(true);
        list.setRendererFactory(() => new GlyphListItemRenderer());

        return list;
    },
},
{
    // expandAll() rebinds the root row, so `setRowData` swaps its caret-right
    // glyph for a caret-down one and the discarded caret is exercised.
    name: 'Tree',
    covers: ['VirtualRowView', 'TreeRow', 'LabelTreeNodeRenderer'],
    make: () => {
        const tree = new Tree();

        tree.setNodes([{ label: 'Root', children: [{ label: 'A' }] }]);
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(200);
        tree.doLayout();
        tree.expandAll();

        return tree;
    },
},
{
    // "caret-right" rather than the resolver default "file", which no library
    // module registers with `Glyph.register` — the default throws here.
    name: 'Tree (icon renderer)',
    covers: ['IconLabelTreeNodeRenderer'],
    make: () => {
        const tree = new Tree();

        tree.setNodes([{ label: 'Root', children: [{ label: 'A' }] }]);
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(200);
        tree.doLayout();
        tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(() => 'caret-right'));
        tree.expandAll();

        return tree;
    },
},
```

- Append the balance assertion to the `it` body, after the existing `expect(leaked).toEqual([])`, with `Diagnostics._reset()` placed immediately before `const c = await make();`:

```typescript
const counters   = Diagnostics.counters();
const undisposed = counters.componentsConstructed - counters.componentsDestroyed;

// Compared as a labelled string so the failure names the row, not just a number.
expect(`${name}: undisposed=${undisposed}`).toBe(`${name}: undisposed=${undisposedBaseline ?? 0}`);
```

- Give the `VideoPlayer` row `undisposedBaseline: 4`, with a comment naming it as a pre-existing residual this plan does not address and noting the number may only go down.
- Add `UNCLAIMED_DESTRUCTOR_CLASSES`, a sorted `readonly string[]` of these 28 names, with the same shrink-only doc comment as step 2's:

```
'AbstractPickerField', 'AbstractWindow', 'AnimatedDropdown', 'AutoCompleteField', 'Button',
'Canvas', 'DiagramView', 'Dialog', 'Dock', 'Drawer', 'DropZoneOverlay', 'FilterCell',
'HeaderCell', 'LabeledGrid', 'MarkdownMinimap', 'Notification', 'Panel', 'PopupButton',
'Rail', 'Row', 'SplitGutter', 'StatusBar', 'TableHeader', 'TablePanel', 'Text', 'Tooltip',
'TreeTablePanel', 'WebGLCanvas'
```

- Add the two coverage assertions, against `classesDeclaringDestructor()` and `UNCLAIMED_DESTRUCTOR_CLASSES`.

Verify: `npx vitest run tests/component/dispose-full-teardown.test.ts` fails in two ways, both of which steps 4–9 clear. The six new rows fail the balance assertion. The stale-claim assertion fails, listing the eight classes named in a `covers` that do not yet declare a `destructor()`: `ComboBoxLabel`, `FieldSet`, `GlyphListItemRenderer`, `IconLabelTreeNodeRenderer`, `LabelListItemRenderer`, `LabelTreeNodeRenderer`, `SelectableListRow`, `TreeRow`. The baseline assertion passes from the start and must keep passing: `unclaimed` is 28 both before and after, because each of those eight joins `scanned` and `claimed` in the same step.[^baseline-invariant] **Do not** edit the baseline.

### 4. `TreeRow`

In `packages/lib/src/typescript/lib/component/tree/TreeRow.ts`:

- In `setRenderer` (line 120), replace the `removeChild` block with `this._renderer.dispose();` before the `if (el)` branch, leaving that branch holding only the `appendChild` call. Record the ownership change in the method's `@remarks`: the replaced renderer is disposed, so a caller holding a reference from `getRenderer()` must not reuse it.
- In `setRowData` (line 169), replace each of the two `DOM.sink.removeChild` blocks with `this._toggle.dispose();` / `this._spinner.dispose();`, keeping the `= null` assignment that follows.
- Add a `protected destructor()` after `init()` disposing `_renderer`, then `_toggle?`, then `_spinner?`, ending with `super.destructor()`. Its doc comment states that all three are raw-appended rather than registered, so the base recursion cannot reach them.

Verify: `grep -n 'DOM.source' packages/lib/src/typescript/lib/component/tree/TreeRow.ts` — expect zero matches. The `DOM` namespace import stays, for the remaining `DOM.sink` calls.

### 5. The two tree renderers

- `packages/lib/src/typescript/lib/component/tree/renderer/Label.ts`: add a `destructor()` disposing `_label`.
- `packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts`: in `update()` (line 91) replace the `removeChild` block with `this._icon?.dispose();`, and add a `destructor()` disposing `_label` then `_icon?`.

Verify: `npx vitest run tests/component/dispose-full-teardown.test.ts -t Tree` — both `Tree` rows pass their balance assertion.

### 6. `SelectableListRow` and the two list renderers

- `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`, `SelectableListRow.setRenderer` (line 418): replace the `removeChild` block with `this._renderer.dispose();`. Add a `protected destructor()` after `init()` disposing `_renderer`.
- `packages/lib/src/typescript/lib/component/list/renderer/Label.ts`: add a `destructor()` disposing `_label`.
- `packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts`: in `update()` (line 89) replace the `removeChild` block with `this._icon?.dispose();`, and add a `destructor()` disposing `_label` then `_icon?`.

### 7. `AbstractSelectableList` — pool shrink and empty placeholder

In `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`:

- `syncRows()` (line 1597): add `this._rowPool[i].dispose();` after the existing `this._innerPanel.removeComponent(this._rowPool[i]);`. Order matters — `removeComponent` writes DOM through the row's handles, so it must run while the row is still alive.[^remove-then-dispose] Extend the loop's existing comment to say the surplus rows are discarded, not re-parented, so `removeComponent`'s detach-only contract needs the explicit disposal.
- `resetEmptyPlaceholder()` (line 1127): add `this._emptyPlaceholder?.dispose();` immediately before `this._emptyPlaceholder = null;`.
- `destructor()` (line 888): add `this._emptyPlaceholder?.dispose();` after the `unbindStore` call. This covers the *detached and cached* placeholder, which is not a registered child and so is unreachable by the base recursion; disposing an attached one is an idempotent no-op.

Verify: `npx vitest run tests/component/dispose-listener-teardown.test.ts` — the whole file is green, including `List (pool shrink)`.

### 8. `ComboBoxLabel`

In `packages/lib/src/typescript/lib/component/input/ComboBox.ts`, `ComboBoxLabel.setRenderer` (line 452): replace the `removeChild` block with `this._renderer.dispose();`, and record the same ownership change in the method's `@remarks` as step 4. Add a `protected destructor()` after `ComboBoxLabel.doLayout()` disposing `_renderer`. Leave `ComboBox.destructor()` (line 1265) unchanged.

### 9. `FieldSet`

In `packages/lib/src/typescript/lib/component/container/FieldSet.ts`, add a `protected destructor()` after `render()` disposing `_legend`. Make no change to `LabeledFieldSet.ts`.

Verify: `npx vitest run tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts` — both files fully green, coverage assertions included.

### 10. Documentation

- Add a `## Fixed` section to `packages/lib/docs/reference/changelog/next.md` covering the leaks and the renderer-ownership change.
- Add one sentence to the renderer-factory paragraph in `packages/lib/docs/components/List.md` (line 56), `packages/lib/docs/components/ComboBox.md` (line 71) and the `setRendererFactory` row in `packages/lib/docs/components/Tree.md` (line 104): swapping the factory disposes the renderer it replaces.

### 11. Full verification

Run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/helpers/libraryClassScan.mjs` |
| Create | `packages/lib/tests/helpers/libraryClassScan.d.mts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/tests/component/dispose-listener-teardown.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/Label.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/renderer/Label.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/FieldSet.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/ComboBox.md` |
| Modify | `packages/lib/docs/components/Tree.md` |

---

## Expected Behaviour

Every case below is exercised by the two registry files under the offline DOM harness, using process-level counters rather than rendered output. Nothing here needs manual verification.

### Teardown leaves no component undisposed

Construct, render, dispose. `Diagnostics.counters()` must report `componentsDestroyed === componentsConstructed`. Each figure below was measured against the current code and against the fix:

| Case | Undisposed today | Undisposed after |
|---|---|---|
| `new FieldSet('Group')` | 1 (the `Legend`) | 0 |
| `new ComboBox({ items: [one] })` | 4 | 0 |
| `new List({ items: [two] })` | 4 (2 renderers + 2 labels) | 0 |
| `List` with two glyph items, then `setRendererFactory(…)` | 12 | 0 |
| `Tree` with one expandable root, laid out, then `expandAll()` | 6 | 0 |
| the same `Tree` with `setRendererFactory(() => new IconLabelTreeNodeRenderer(…))` | 11 | 0 |
| `new List({ items: [three] })` then `setItems([one])` | 8 | 0 |
| `List` with `emptyText`, then `setEmptyText(…)`, then `setItems([one])` | 4 | 0 |

The last two are the pool-shrink and empty-placeholder paths from step 7. The `Tree` row's `expandAll()` is what exercises the caret discard: `setRowData` builds a fresh `caret-down` / `caret-right` `Glyph` on every expand-state change, so an undisposed one accumulates per toggle rather than only at teardown.

### The pool shrink purges its rows' DOM listeners

Build a `List` with three items, snapshot every id in the tree, `setItems` down to one item, then dispose the list. No snapshotted id may still appear in `Event._registeredComponentIds()`. Today two ids survive — the two discarded rows, each holding four `Event` registrations from its constructor.

### Swapping the renderer factory disposes the replaced renderers

`Tree.setRendererFactory`, `AbstractSelectableList.setRendererFactory` and `ComboBox.setRendererFactory` each replace one renderer per row. After the swap and a dispose the balance is still zero, because the outgoing renderers are disposed by `setRenderer` rather than left for a teardown that no longer holds a reference to them.

### The registries fail on drift

- Adding a `protected destructor()` to a library class with neither a registry row claiming it nor a baseline entry fails the coverage assertion.
- Removing a class's `destructor()` while leaving its name in the baseline fails the same assertion.
- Naming a class in a row's `covers` that declares no `destructor()` fails the stale-claim assertion.
- The equivalents hold for `classesRegisteringEventListeners()` in the listener registry.

---

## Verification

From `packages/lib`:

1. `npm run typecheck` — clean.
2. `npm run typecheck:test` — clean. This is the check that catches a missing or wrong `libraryClassScan.d.mts`.
3. `npm run lint` — clean, with no new baseline entries.
4. `npx vitest run tests/component/dispose-full-teardown.test.ts tests/component/dispose-listener-teardown.test.ts` — every row and every coverage assertion green.
5. `npx vitest run` — 403 test files pass and the test count is at least 5804 (the seven new rows and the four coverage assertions add to it). A *lower* file count means a file failed to collect.
6. `npm run docs:api` — finishes with zero warnings.
7. `grep -rn 'currently returns 35 hits' packages/lib/tests/` — expect zero matches, confirming the stale count is gone.
8. `grep -rn 'DOM.source.getParentNode' packages/lib/src/typescript/lib/component/tree/ packages/lib/src/typescript/lib/component/list/` — expect zero matches.

---

## Documentation Impact

No exported symbol is added, renamed or removed, and every new method is `protected`, so TypeDoc's output is unchanged. Two consumer-visible behaviours do change and are documented in prose:

- **Renderer ownership.** `setRendererFactory` on `Tree`, `List` / `MultiSelectList` and `ComboBox` now disposes the renderer it replaces. Add one sentence to the renderer paragraph in `docs/components/List.md`, `docs/components/ComboBox.md` and the `setRendererFactory` row of `docs/components/Tree.md`. `docs/components/MultiSelectList.md` already defers to `List.md` for this and needs no edit.
- **Release notes.** `docs/reference/changelog/next.md` is the staging page for the next release and is currently empty apart from its preamble; add a `## Fixed` section there.

`docs/concepts/component-lifecycle.md`'s *Disposal* section already states the detach-versus-discard rule these fixes obey and needs no change.

---

## Potential Challenges

- **The intermediate red is wide.** Steps 2 and 3 leave both registry files failing until step 9 lands, including the stale-claim assertion failing on eight not-yet-declared classes. Work steps 4–9 in order and re-run the targeted checks each step names, rather than the whole file.
- **`removeComponent` must precede `dispose()` in the pool shrink.** Reversing the two runs `unwireChild`'s DOM writes against a component whose handles the destructor has already released.
- **`VideoPlayer`'s residual is real.** The balance assertion fails on `VideoPlayer` with four undisposed components before its `undisposedBaseline: 4` is set. That is a separate, pre-existing defect — record the number, do not chase it.
- **The scan's column-0 assumption.** A future nested class declaration would be attributed to the wrong enclosing class; the scan throws instead, and the fix is to extend the scanner, not to relax the check.
- **The baseline arrays are computed, not guessed.** If step 1's verification prints anything other than `53 57`, the 28- and 49-entry baselines are wrong. Stop and report rather than editing them to fit.

---

## Critical Files

| File | Why |
|---|---|
| [`src/typescript/lib/component/container/SplitGutter.ts:509`](src/typescript/lib/component/container/SplitGutter.ts#L509) | the destructor precedent, with the doc-comment shape to mirror |
| [`src/typescript/lib/component/table/cell/Header.ts:689`](src/typescript/lib/component/table/cell/Header.ts#L689) | the multi-field variant of the same precedent |
| [`src/typescript/lib/component/shared/VirtualRowView.ts:119`](src/typescript/lib/component/shared/VirtualRowView.ts#L119) | `TreeRow`'s own base one level up; disposes a raw-held pool for the same reason |
| [`src/typescript/lib/core/Component.ts:6473`](src/typescript/lib/core/Component.ts#L6473) | `removeComponent` / `removeAllComponents` / `disposeAllComponents` and their detach-versus-discard contracts |
| [`tests/helpers/readReadmes.mjs`](tests/helpers/readReadmes.mjs) | the plain-ESM test-helper pattern the scan helper copies |
| [`tests/unit/readme-mirror.test.ts:32`](tests/unit/readme-mirror.test.ts#L32) | the precedent for exemptions that are themselves checked for staleness |
| [`scripts/eslint/require-content-bounds.baseline.json`](scripts/eslint/require-content-bounds.baseline.json) | the shrink-only baseline artefact the two registries' baselines mirror |
| [`docs/concepts/component-lifecycle.md:144`](docs/concepts/component-lifecycle.md#L144) | the consumer-facing statement of the rule these fixes restore |

---

## Non-Goals

- **`VideoPlayer`'s four undisposed components.** Pinned by `undisposedBaseline: 4` and left for a separate change; it is not one of the raw-append leaks this plan is about.
- **Shrinking either baseline beyond the classes this plan fixes.** 28 destructor classes and 49 listener classes stay unclaimed. Writing rows for them is a follow-on the ratchet now makes visible.
- **`FieldSet`'s `legend` construction option.** `_legend` is a plain field initialiser, so it is still `undefined` when `applyOptions` dispatches `setTitle` during the `super()` cascade, and `new FieldSet('', { legend: 'x' })` throws. Nothing in the library passes the option. It is a distinct defect — the `declare` trap from `CODE_CONVENTIONS.md` — and out of scope here.
- **Migrating any raw-appended child to `addComponent`.** Each site raw-appends deliberately, to keep the child out of a layout manager's or a parent's size negotiation; this plan restores their teardown, not their mounting.
- **A general "no undisposed components" assertion across the whole suite.** The balance assertion applies to the teardown registry's rows only.

---

## Notes

[^precedent]: Each of the five cited destructors was read and matches the shape this plan uses: dispose the raw-held fields first, then `super.destructor()`, with a doc comment explaining why the base recursion cannot reach them. `HeaderCell`'s is the multi-field one (`_resizeHandle`, `_priorityBadge`, `_headerGlyphInstance`) and uses `?.` on fields declared with `declare`. `VirtualRowView`'s loops a pool and is the nearest precedent to `TreeRow`, being `TreeRow`'s own base one level up through `Tree`.

[^dispose-detaches]: `Component.destructor()` calls `DOM.sink.removeElement(element)` on the component's own element before recursing into children, so `dispose()` already detaches. `SplitGutter.destructor()` and `HeaderCell.destructor()` both rely on this and perform no removal of their own. Keeping the `getParentNode` guard alongside the disposal would be a redundant DOM read on every rebind — and in `TreeRow.setRowData`, on every scroll tick.

[^not-dispose-all]: `_innerPanel` holds the row pool *and* `_emptyPlaceholder`, which `syncEmptyPlaceholder` adds through `addComponent` at `AbstractSelectableList.ts:1094`. `disposeAllComponents()` would take the placeholder with it and leave `_emptyPlaceholder` pointing at a destroyed component, which the next empty-state transition would re-attach. The per-row `dispose()` also leaves the existing `Tooltip.detach` line's position and semantics intact.

[^renderer-scope]: Measured on the current code with the `Diagnostics` construct/destroy counters: a `List` with two items leaves four components undisposed, two of which are the rows' renderers and two the `Text` labels those renderers raw-append. Adding only `SelectableListRow.destructor()` takes that from four to two. `LabelTreeNodeRenderer`, `IconLabelTreeNodeRenderer`, `LabelListItemRenderer` and `GlyphListItemRenderer` each hold a `Text` in `_label` and raw-append it in `init()`; the two icon variants also build a fresh `Glyph` on every glyph-name change in `update()` and drop the previous one.

[^labeled-fieldset]: `LabeledFieldSet` was read in full. It declares one field, `_labeledGrid`, and registers it with `addComponent` in its constructor, so the base recursion reaches it. Its only other state is the legend it inherits from `FieldSet`. A second `destructor()` on `LabeledFieldSet` would be dead code.

[^self-derived]: The alternative — keeping the hand-written count and correcting it to 54 — was rejected: it is the same artefact that already drifted from 35 to 54 without failing anything, and this project has the general lesson on record that hand-written counts in checked-in artefacts go stale. The shrink-only baseline array is the shape the repo already uses for exactly this problem in `scripts/eslint/require-content-bounds.baseline.json`, described in `ARCHITECTURE.md` as "baseline entries come out as sites are fixed and none should go in".

[^balance-probe]: Both probes were run against the current code. The per-instance-CSS-rule probe (`_ruleCacheKeys()` before and after) reports zero leaked keys for `FieldSet`, `ComboBox`, `List` and `Tree`, because a leaked renderer or `Text` label writes no per-instance rule — the existing registry's only assertion is blind to this whole class of leak. The `Diagnostics` construct/destroy probe reports 1, 4, 4 and 6 respectively, and zero for all four once the fixes land. Retrofitting the balance assertion onto the 25 existing rows was measured too: 24 pass unchanged, and `VideoPlayer` reports 4.

[^baseline-invariant]: `unclaimed` is `scanned` minus `claimed`. The eight classes step 3 adds to some row's `covers` are exactly the eight that steps 4–9 give a `destructor()`, so each one enters `scanned` and `claimed` together and never appears in the difference. The three classes the new rows claim that *already* declare a `destructor()` — `AbstractSelectableList`, `ComboBox`, `VirtualRowView` — leave the baseline the moment step 3's rows land, which is why the baseline is 28 rather than the 31 it would be with the existing rows alone.

[^remove-then-dispose]: `removeComponent` calls `unwireChild`, which writes to the child's element through its handles. Running it after `dispose()` writes through handles the destructor has already released, which throws against the production sink. The same ordering is why `Tab.closeTab` removes the closed content before disposing it.
