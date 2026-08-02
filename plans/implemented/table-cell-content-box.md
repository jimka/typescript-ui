# Table cell content box — Implementation Plan

## Overview

Two loose ends in `packages/lib/src/typescript/lib/component/table/cell/`, both about a component's content box — the rectangle `getContentBounds()` returns, which is where a component must place its own children.

The first is a live defect. [`Cell.alignEditorWithContent`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L534) re-indents the active cell editor so it lines up with the value the user double-clicked. It reads the cell's **outer** width at [Cell.ts:547](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L547), so on a bordered cell the editor runs past the far edge and the `overflow: hidden` every component carries clips it. The site is grandfathered in [`require-content-bounds.baseline.json`](packages/lib/scripts/eslint/require-content-bounds.baseline.json); removing that key is part of the fix.

The second is missing coverage. [`TreeCellRenderer.doLayout`](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L238) was made content-box correct by commit `3f954d39`, but all three shipped themes set `table.cell.border` to `none`, so nothing in the app draws a bordered tree cell and no rendered pixel depends on that arithmetic. The one existing test covers the delegate at depth 0 with no toggle and no padding, which is the configuration where the fixed arithmetic and the old arithmetic agree. This plan adds offline tests that separate them and a demo that renders the case.

Both ends are covered by one change to `Cell`, additions to [`content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts), and one new row on the existing **Content Box** demo panel, [`ContentBoxPanel.ts`](packages/lib/src/typescript/ContentBoxPanel.ts).

---

## Architecture Decisions

### Read the cell's content box, keep the outer numbers as the fallback

`alignEditorWithContent` takes the editor's left edge and width from `this.getContentBounds()`, falling back to the outer width only when that returns `null`. This is the shape commit `3f954d39` used at all eleven sites it fixed.[^precedent]

### The editor path is testable offline — pin it with a unit test

A `Cell` constructed directly with its own editor opens that editor from `startEdit()` with no `CellEditorPool` and no real focus, so the whole geometry is reachable from the offline harness. The bordered cases go in `content-box-containment.test.ts` as ordinary literal-geometry tests; no manual step substitutes for them.[^offline]

### The demo renders standalone cells, not a `TreeTable`

The new demo row builds two `Cell` instances directly and wraps each renderer in a `TreeCellRenderer`, rather than configuring a `TreeTable`. A table builds its own cells and hands out no writable reference to one.[^standalone]

### One border per demo cell

The first demo cell borders the `Cell`; the second borders the `TreeCellRenderer` inside an unbordered cell. Bordering both at once would leave the editor sitting its border-width to the left of the value, because `getContentX()` is an offset inside the renderer's own content box and the cell adds it to the cell's content origin. That interaction is out of scope (see `## Non-Goals`).[^one-border]

### Padding, not a border, is what makes the tree-renderer test bite

A border shrinks the content box without moving its origin, so a border-only case cannot tell `box.x + indent` from `indent`. The new `TreeCellRenderer` cases therefore carry padding as well as a border, matching how the suite's `ComboBox` and `MenuItem` cases pin their origins.[^padding]

---

## Implementation

The whole source change is the body of `alignEditorWithContent` in [Cell.ts:534](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L534). Everything above `const cellWidth` stays as it is:

```typescript
        // The Card layout already placed the editor inside this cell's content
        // box, so its y and height are right; only the left edge and the width
        // move here. The outer-width fallback preserves the previous behaviour
        // before the element exists.
        const box = this.getContentBounds()
                 ?? { x: 0, y: 0, width: this.getWidth() ?? 0, height: 0 };
        const editorWidth = Math.max(0, box.width - contentX);

        editor.setAutoCommitStyle(false);
        editor.setX(box.x + contentX);
        editor.setWidth(editorWidth);
        editor.setAutoCommitStyle(true);
```

Update the method's JSDoc to say the editor is placed inside the cell's content box.

---

## Demo panel

Add to `ContentBoxPanel`, alongside the existing rows. `Cell` takes no options bag, so its geometry and value are set with setters.[^no-options-bag]

Two module constants beside the existing `BORDER` and `BOX`:

```typescript
/** Depth the demo tree cells sit at, so the indent is wide enough to see. */
const TREE_CELL_DEPTH = 2;

/** Outer box of one demo tree cell: room for a caret, an indent and a value. */
const TREE_CELL_SIZE = { width: 230, height: 28 };
```

One static builder:

```typescript
/**
 * Builds a standalone tree-column cell: a `Cell` whose renderer is wrapped in
 * a `TreeCellRenderer` showing an expand toggle at {@link TREE_CELL_DEPTH},
 * carrying its own `StringEditor` so a double-click opens an editor without a
 * table's `CellEditorPool`.
 *
 * @param text - The value the cell renders.
 *
 * @returns The configured cell.
 */
private static buildTreeCell(text: string): Cell<String | null> {
    const cell = new Cell<String | null>("div", new StringRenderer(), new StringEditor());

    cell.wrapRenderer((delegate: CellRenderer<String | null>) => new TreeCellRenderer(delegate));
    (cell.getRenderer() as TreeCellRenderer<String | null>)
        .setTreeState(TREE_CELL_DEPTH, true, false);
    cell.setValue(text);
    cell.setPreferredSize(TREE_CELL_SIZE);

    return cell;
}
```

`buildTableCellRow()` returns one `FieldSet` inside an `HFlow` row, matching the other two rows. The FieldSet holds two cells:

| Cell | Border goes on | Purpose |
|---|---|---|
| `buildTreeCell("Editor inside the border")` | the `Cell` — `setBorder(BORDER)` | `Cell.alignEditorWithContent`: double-click opens the editor inside the frame |
| `buildTreeCell("Caret inside the frame")` | the renderer — `cell.getRenderer()` gets `setBorder(BORDER)` and `setPadding(new Insets(3, 3, 3, 3))` | `TreeCellRenderer.doLayout`: caret and value sit inside the renderer's own frame |

Keep the first cell in a private readonly field. `Cell` re-applies `var(--ts-ui-table-cell-border, none)` on every theme change ([Cell.ts:66](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L66)), which would wipe the demo border the moment someone uses the theme switcher, so the panel constructor ends with:

```typescript
this.subscribeTheme(() => this._borderedCell.setBorder(BORDER));
```

The panel subscribes after the cell does, and theme listeners fire in registration order, so the panel's write lands last. Only the cell needs this — `CellRenderer` subscribes for padding, not for a border.

Imports needed from `@jimka/typescript-ui/component/table`: `Cell`, `CellRenderer`, `StringEditor`, `StringRenderer`, `TreeCellRenderer`. `Insets` comes from `@jimka/typescript-ui/primitive`.

---

## Ordered Implementation Steps

1. **Add the failing tests for the cell editor.** In [`packages/lib/tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts), add a `describe('Cell aligns its editor with the content box')` block after the existing `describe('TreeCellRenderer')` block at line 409. Add two imports — `Cell` from `~/component/table/cell/Cell` and a type-only `CellRenderer` from `~/component/table/cell/renderer/CellRenderer`; `_StringEditor`, `StringRenderer`, `TreeCellRenderer` and `Insets` are already imported. No `as any` casts are needed anywhere in this block. Build each cell with a local helper:

   ```typescript
   const makeCell = (border: number, pad: number, depth: number | null, w: number, h: number) => {
       const cell = new Cell<String | null>('div', new StringRenderer(), new _StringEditor());

       cell.getElement(true);
       cell.setBorder(border === 0 ? 'none' : `${border}px solid black`);
       cell.setPadding(new Insets(pad, pad, pad, pad));

       if (depth !== null) {
           cell.wrapRenderer((delegate: CellRenderer<String | null>) => new TreeCellRenderer(delegate));
           (cell.getRenderer() as TreeCellRenderer<String | null>).setTreeState(depth, true, false);
       }

       cell.setValue('Component.ts');
       cell.setWidth(w);
       cell.setHeight(h);
       cell.doLayout();
       cell.startEdit();

       return cell;
   };
   ```

   Write the four cases from _Table A_ in `## Expected Behaviour`, each asserting both the literal editor rectangle and the "editor covers the delegate exactly" equality described there. Verify: `npx vitest run tests/component/content-box-containment.test.ts` — the two bordered tree cases fail with the numbers in the "today" column; the borderless case and the plain-renderer case pass.

2. **Fix `alignEditorWithContent`** in [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) with the body under `## Implementation`. Verify: the same vitest command is green.

3. **Un-baseline the site.** Delete the `"src/typescript/lib/component/table/cell/Cell.ts:Cell.alignEditorWithContent"` string from [`packages/lib/scripts/eslint/require-content-bounds.baseline.json`](packages/lib/scripts/eslint/require-content-bounds.baseline.json), leaving eleven entries. Verify from `packages/lib`: `npx eslint src` reports no `local/require-content-bounds` error, and `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` no longer lists `Cell.alignEditorWithContent`.[^lint-noise]

4. **Extend the `TreeCellRenderer` test block.** Keep the existing `only shrinks its delegate when given a border` case. Add a local builder that sets a border *and* `new Insets(3, 3, 3, 3)` of padding, calls `setTreeState(depth, true, false)`, commits the outer size and calls `doLayout()`, then add the three cases from _Table B_. Verify non-vacuity by hand: temporarily change `box.x + indent` back to `indent` and `box.x + delegateX` back to `delegateX` at [TreeCell.ts:254](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L254) and [:265](packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts#L265), confirm the new cases fail, then restore.[^already-green]

5. **Add the demo row.** In [`packages/lib/src/typescript/ContentBoxPanel.ts`](packages/lib/src/typescript/ContentBoxPanel.ts), add `buildTreeCell` and `buildTableCellRow` per `## Demo panel`, and call `buildTableCellRow()` from the constructor between the existing `buildRowRendererRow()` and `buildBaselinedRow()` calls (lines 166–167), so the fixed cases stay together and the baselined row stays last.

6. **Update the panel's own documentation.** Replace the sentence at [ContentBoxPanel.ts:128–130](packages/lib/src/typescript/ContentBoxPanel.ts#L128) — "`TreeCellRenderer` is covered by nothing … worth adding here if it is ever touched again" — with a statement that the table-cell row now covers it. Extend the "What to look for here" paragraph with the double-click instruction from `## Verification`.

7. **Update the changelog** in [`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md): change "Twelve sites are baselined" at line 235 to "Eleven sites are baselined"; extend the demo-panel sentence at line 242 to mention the tree-column table cell; and add a bullet under `## 0.4.0` → `### Fixed` for the editor overrun. There is no `Unreleased` heading — `0.4.0` is the in-progress version and `0.3.0` is the last tag, so `0.4.0` is where the entry belongs.

8. **Run the full gate** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.baseline.json` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/src/typescript/ContentBoxPanel.ts` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Expected Behaviour

Every case below is unit-testable offline. The only manual check is the double-click in `## Verification`.

### Table A — `Cell.alignEditorWithContent`

Each cell wraps its `StringRenderer` in a `TreeCellRenderer` at depth 2 — with the default 16px indent and `TOGGLE_WIDTH` of 20, `getContentX()` is 52 — except the last, which keeps the plain renderer. "Delegate" is the delegate renderer's rectangle in the *cell's* coordinate space (`renderer.getX() + delegate.getX()`, and likewise for y), which is the rectangle the editor must cover exactly.

| Cell | Content box | Editor today | Editor after fix | Delegate |
|---|---|---|---|---|
| border 2, padding 0, 200×24 | (0, 0, 196, 20) | (52, 0, **148**, 20) | (52, 0, **144**, 20) | (52, 0, 144, 20) |
| border 2, padding 3, 200×30 | (3, 3, 190, 20) | (**52**, 3, **148**, 20) | (**55**, 3, **138**, 20) | (55, 3, 138, 20) |
| border 0, padding 0, 196×20 | (0, 0, 196, 20) | (52, 0, 144, 20) | unchanged | (52, 0, 144, 20) |
| border 2, padding 0, 200×24, plain renderer | (0, 0, 196, 20) | (0, 0, 196, 20) | unchanged | — |

Row 1 is the width bug on its own; row 2 adds the origin bug, which only padding exposes because a border never moves the content origin. Row 3 is the no-op proof: a borderless, unpadded cell sees the same numbers either way. Row 4 is the common path — a plain renderer reports `getContentX()` of 0, so the method returns early and the `Card` layout's placement stands untouched.

Rows 1–3 also satisfy the stronger equality, which is worth asserting as its own case because it survives a change to any of these dimensions: **the editor's rectangle equals the delegate's rectangle in cell coordinates.**

### Table B — `TreeCellRenderer.doLayout`

Every row: padding 3, depth as stated, `hasChildren` true, `expanded` false. The toggle commits 16 wide although it is handed 20, because it is a rigid glyph whose min and max are pinned to its 16×16 preferred size; only its origin is this code's to get right.

| Renderer | Content box | Toggle | Delegate |
|---|---|---|---|
| border 2, 200×40, depth 2 | (3, 3, 190, 30) | (35, 10, 16, 16) | (55, 3, 138, 30) |
| border 0, 196×36, depth 2 | (3, 3, 190, 30) | (35, 10, 16, 16) | (55, 3, 138, 30) |
| border 2, 200×40, depth 0 | (3, 3, 190, 30) | (3, 10, 16, 16) | (23, 3, 170, 30) |

The first two rows must produce identical rectangles: a border may only shrink the content box, never move its origin. The third pins the indent arithmetic at a depth that contributes nothing, so an origin error cannot hide inside the indent.

---

## Verification

From `packages/lib`:

- `npm run test` — runs `typecheck:test` then the full vitest suite. Expect green; master is green today at 259 files / 3565 tests, and the fix was measured not to move any of them.
- `npx eslint src` — expect exactly one error, the pre-existing `local/forward-super-options` on `src/typescript/lib/component/table/cell/renderer/Link.ts:57`. A second error is new.
- `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` — expect 12 problems in total: 11 `require-content-bounds` errors, down from 12, with `Cell.alignEditorWithContent` gone, plus the same `Link.ts` error.
- `npm run dev`, then the **Content Box** tab (demo app on `localhost:8015`). In the new "Table cell" box:
  - The first cell's frame is unbroken. Double-click its text: the editor's outline starts at the text, not at the cell's left edge, and its right edge stops inside the cell's border rather than under it. Press Escape to close.
  - The second cell's caret and value sit inside the renderer's frame, with the padding visible on all four sides and nothing cut at the right edge.
  - Switch themes from the Misc tab and come back: both frames are still drawn.

---

## Potential Challenges

- **The new `TreeCellRenderer` cases are green before any source change**, so a green run proves nothing about them on its own. Step 4's mutation check is what makes them non-vacuous.
- **A `Cell`'s border is theme-owned**, so any demo that sets one directly loses it on the next theme switch. The panel re-applies it from its own theme subscription.
- **`wrapRenderer` does not move the double-click listener**, which stays on the delegate. Double-clicking the caret or the indent gutter opens nothing; the demo instruction says to double-click the text. A real tree table behaves the same way, so this is not a defect introduced here.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` | The site being fixed; also its theme-driven `setBorder` at line 66 and `startEdit` at line 387. |
| `packages/lib/src/typescript/lib/component/table/cell/renderer/TreeCell.ts` | `doLayout` (line 238) is the arithmetic under test; `getContentX` (line 123) is what `Cell` consumes. |
| `packages/lib/src/typescript/lib/core/Component.ts` | `getContentBounds` (line 2953), `getContentInsets` (line 2004), `getInnerSize` (line 2921). |
| `packages/lib/tests/component/content-box-containment.test.ts` | The suite to extend; read `expectBorderOnlyShrinks` (line 108) and the `TreeRow` block (line 449) for the literal-geometry style. |
| `packages/lib/src/typescript/ContentBoxPanel.ts` | The demo to extend; `BorderedRowTree` (line 83) and the standalone `MenuItem` (line 187) are the two shapes already in use. |
| `packages/lib/src/typescript/lib/layout/Card.ts` | `doLayout` (line 249) already places the editor in the cell's content box, which is why only x and width move. |
| `packages/lib/docs/concepts/sizing.md` | "Inner size vs outer size" states the rule this plan applies. |
| `packages/lib/scripts/eslint/require-content-bounds.js` | Its header lists what the rule can and cannot see, including the whole-method escape the fix relies on. |

---

## Non-Goals

- **Making `getContentX()` account for the renderer's own content origin.** A bordered or padded `TreeCellRenderer` inside a bordered `Cell` leaves the editor that renderer's left inset away from the value. Fixing it means changing what `getContentX()` measures, and `CellRenderer`'s base returns 0 for every plain cell today — folding the content origin in there would indent every cell editor by the cell padding, which is a behaviour change and not this defect.
- **Giving any shipped theme a `table.cell.border`.** All three deliberately set `none`; the demo supplies its own border instead.
- **Clearing the other eleven baseline entries.** Each is its own site with its own geometry.
- **Adding a `Table` or `TreeTable` demo.** Two standalone cells exercise the same code with far less setup.

---

## Notes

[^precedent]: Commit `3f954d39` ("Lay children out inside the content box, not the border box") introduced `Component.getContentBounds()` and converted eleven sites to `const box = this.getContentBounds() ?? { … }` followed by `box.x` / `box.y` / `box.width` / `box.height`. `TreeCellRenderer.doLayout` and `LabelListItemRenderer.layoutChildren` are the two clearest reads: both keep the old outer numbers as the null fallback rather than returning early, because the surrounding method still has work to do. `Cell` follows that — the fallback keeps `getWidth()`, so an unrendered cell behaves as it does today.

[^offline]: Measured against master in a throwaway probe, then deleted. `new Cell('div', new StringRenderer(), new StringEditor())` takes the per-cell editor path in `startEdit` ([Cell.ts:398](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L398)), which needs no `CellEditorPool`. `editor.focus(true)` routes through `DOM.sink.focus`, which the offline `TestDOM` models, so nothing about the call depends on a real focus ring. A detached, bordered, 200×24 cell at depth 2 committed an editor 148px wide inside a 196px content box — the overrun, reproduced offline, exactly as _Table A_ records it; applying the `## Implementation` body turned all four cases green and left the rest of the suite untouched. The brief for this plan assumed the path was focus-dependent and unreachable offline. It is not, so no manual step substitutes for the geometry assertions.

[^standalone]: `Row.buildCells` constructs each cell and immediately wraps the tree column's renderer ([Row.ts:106](packages/lib/src/typescript/lib/component/table/Row.ts#L106)); the pool that owns those rows is reachable only through `Body.getRowPool()`, which is protected. Getting a border onto a real table cell therefore means subclassing `TreeBody` and swapping it in through `Table`'s body factory, which `TreeTable`'s constructor hard-codes. The panel already sets the precedent for skipping that: its `MenuItem` is rendered standalone "rather than inside a `Menu`, which builds its own items and hands out no reference to them". Overriding the `--ts-ui-table-cell-border` custom property on an ancestor container was the other candidate and was rejected — `Component` exposes no typed setter for a CSS custom property, and adding one to the public API in service of a demo is out of proportion.

[^one-border]: `TreeCellRenderer.getContentX()` returns `depth * indentPx + TOGGLE_WIDTH` — an offset measured inside the renderer's own content box. `alignEditorWithContent` adds it to the *cell's* content origin. The two agree while the renderer's own content origin is zero, which it is in every shipped configuration and in the first demo cell. Give the renderer a 2px border as well and the editor lands 2px left of the value: visible, not clipped, and confusing on a panel whose whole job is to make misplacement obvious. Splitting the two borders across two cells keeps each one a clean signal.

[^padding]: The suite already relies on this distinction twice. Its `ComboBox` case notes that the component "has enough internal slack that containment passes either way" and pins padding instead, and its `MenuItem` case says outright that "padding is the observable difference — the origin must come from `getContentInsets()`, which includes it". A bordered-but-unpadded `TreeCellRenderer` at 200×40 and a borderless one at 196×36 already produce identical child rectangles on master, which is what the existing delegate-only case checks; only padding moves `box.x` off zero and puts the origin term under test.

[^already-green]: The `TreeCellRenderer` arithmetic was fixed by `3f954d39`, so these cases are coverage for code that is already correct rather than a red-green cycle. That makes the mutation check the only evidence they bite. Do the mutation as an uncommitted local edit and revert it before moving on — it must not appear in any commit.

[^lint-noise]: `npx eslint src` on master already reports one unrelated error: `local/forward-super-options` on `Link.ts:57`. It is pre-existing and out of scope. Do not fix it here, and do not read it as breakage caused by this change.

[^no-options-bag]: `CODE_CONVENTIONS.md` asks for construction through the options bag rather than post-construction setters. `Cell`'s constructor is positional — `(tag, renderer, editor?, rendererConstraints?, editorConstraints?)` — and carries no `CellOptions`, so `setValue` / `setPreferredSize` / `setBorder` are the only surface available. Adding an options bag to `Cell` is a public-API change well outside this plan.

## Implementation Notes

- **The baseline count was stale before this branch even started, not because of it.** The plan's `## Verification` and Step 3/7 text assumed the `require-content-bounds` baseline still held all twelve originally-found sites minus `Cell.alignEditorWithContent` (i.e. eleven remaining). By the time this branch was cut, two sibling branches lower in the stack (`menuitem-border-aware-centring`, `scroll-chrome-content-box`) had already fixed four of the twelve (`MenuItem`, `VirtualScroller.layoutScrollbars`, `ScrollStrip.layoutContent`, `Scrollbar.setMetrics`), so the baseline file held eight entries, not twelve, before this change. Removing `Cell.alignEditorWithContent` therefore leaves **seven** entries, confirmed both by counting `require-content-bounds.baseline.json` directly and by `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src`, which reports exactly seven `local/require-content-bounds` errors plus the one pre-existing `local/forward-super-options` error on `Link.ts:57` (eight problems total). The changelog carries **three** running-total mentions, not the two this note first claimed, and all three are updated rather than the plan's literal (and already-inaccurate) "eleven". Two sit in the founding `require-content-bounds` entry — "eight remain baselined" and "The other seven are latent" — and become seven and six. The third closes the scroll-chrome entry — "Eight sites remain baselined" — and becomes seven.

- **`ContentBoxPanel.ts`'s row layout drifted from the plan's line references for the same reason.** Step 5 said to insert `buildTableCellRow()` "between the existing `buildRowRendererRow()` and `buildBaselinedRow()` calls (lines 166–167)". No `buildBaselinedRow` method exists in the current file — the constructor calls are `buildFieldRow()`, `buildRowRendererRow()`, `buildMenuAndNotificationRow()`, `buildScrollChromeRow()`, with `buildScrollChromeRow()` (a fixed case) added after `buildMenuAndNotificationRow()` (which holds the still-baselined notification case) by the scroll-chrome-content-box branch — so "the baselined row stays last" was already untrue before this change. I inserted `buildTableCellRow()` between `buildRowRendererRow()` and `buildMenuAndNotificationRow()`, which preserves the plan's actual intent (group the newly-fixed case with the other fixed cases, ahead of the still-baselined one) given the method that intent pointed at no longer exists under that name.

- **That insertion point makes the new row the panel's third, not fifth**, pushing the existing "third row" (menu item + notification) to fourth and "fourth row" (scroll chrome) to fifth. Updated every row-ordinal reference to match (five rows total, not four) — in `ContentBoxPanel`'s class doc, in its constructor's intro `Text`, and in the changelog's scroll-chrome entry, which called the scroll row the panel's fourth. That last one was missed on the first pass and found in review; a row inserted in the middle of the panel invalidates ordinals in the changelog as well as in the panel's own source.

- **The changelog demo-panel sentence extension followed a precedent introduced after this plan was written, not the plan's literal instruction.** Step 7 said to "extend the demo-panel sentence at line 242 to mention the tree-column table cell" — the enumeration sentence in the founding `require-content-bounds` entry. By the time this branch started, the scroll-chrome entry (added by a sibling branch) had already established a different pattern for documenting a later addition to the same demo panel: its own closing sentence ("The Content Box demo panel gained a fourth row bordering one of each") rather than an edit to the founding enumeration. I followed that established, more-recent precedent instead: the new `Cell.alignEditorWithContent` bullet closes with "the Content Box demo panel's new third row", and the founding entry's enumeration sentence is left to describe what it always described, plus the new coverage folded into its "Covered:" list (which is a live list of what the panel demonstrates today, not a historical snapshot, so it was updated).

- **A sixth file was edited that the plan's `## Files to Create / Modify /
  Delete` table does not list: `component/container/VirtualScroller.ts`.** Only
  a JSDoc sentence changed, no behaviour. Review found the same factual error
  in three places at once — the claim that a child sized to its parent's outer
  box overruns "a border-width" past the clip edge. It overruns by **both**
  border sides: the child's containing block is already the padding box, so it
  starts inside the near border and runs the far one past the edge. The
  correction was applied wherever the sentence appears — this branch's own
  changelog entry and demo-panel doc, the sibling scroll-chrome entry, the
  containment suite's header, and `VirtualScroller.layoutScrollbars`'s JSDoc,
  which is the sixth file. Correcting one copy and leaving the others would
  have left the shipped docs contradicting themselves. Still uncorrected and
  deliberately out of scope: the same phrasing in `docs/concepts/sizing.md`,
  which no plan in this batch touches.

- **Verified rather than repeated the plan's "all three shipped themes set `table.cell.border` to `none`" claim.** Read `ModernTheme.ts`, `ClassicTheme.ts` and `DarkTheme.ts` directly: each sets `table.cell.border: 'none'` in its own `table.cell` block. `BaseTheme.ts`'s partial `table.cell` block sets no `border` at all. The claim holds.

- **Manual verification (plan's `## Verification`, third bullet) was performed, not skipped.** Started `vite --port 8123` from this worktree (confirmed via `readlink /proc/<pid>/cwd`), confirmed the demo app resolves `@jimka/typescript-ui/*` imports through `vite.config.ts`'s source aliases rather than `node_modules` (the top-level `node_modules` symlink in this worktree does point at the main tree's `packages/lib`, which would be a trap for an app that resolves the package through `node_modules`, but `packages/lib`'s own dev server does not — its aliases resolve straight to this worktree's source via `import.meta.url`). In the browser: double-clicking the first table-cell row's text opened an editor measuring `width: 174` at `x: 52` **in the cell's padding box** — the space `box.x + contentX` is expressed in — inside a 230×28 cell whose 2px border leaves a 226×24 content box. It stops 174 + 52 = 226 across, exactly flush with the content box's far edge rather than under the border. The second row's bordered-and-padded `TreeCellRenderer` placed its delegate at `x: 55, width: 168` in the renderer's own padding box, likewise matching the predicted arithmetic, with the padding visible on all sides and nothing clipped.

  A first pass of this note reported those two x values as **67** and **70**, called them a match for `box.x + contentX`, and was wrong: 67 and 70 are viewport coordinates, 15px further right because of the enclosing `FieldSet`'s frame and inset. The arithmetic under test is expressed relative to the parent's padding box, so a viewport-relative reading cannot confirm or refute it. The corrected figures above were re-measured against each parent's padding box. Switching to the Classic theme from the Misc tab and back left both cells' borders intact (`2px` on the `Cell` for the first row, `2px` on the `TreeCellRenderer` for the second), confirming the constructor's trailing `subscribeTheme` re-application survives a real theme change.
