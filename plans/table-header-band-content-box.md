---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Table.ts
  - packages/lib/src/typescript/lib/component/table/Header.ts
  - packages/lib/scripts/eslint/require-content-bounds.baseline.json
  - packages/lib/tests/component/content-box-containment.test.ts
---

# Table Header Band Content Box — Implementation Plan

## Overview

`TableHeader` gives itself a 1px bottom border ([packages/lib/src/typescript/lib/component/table/Header.ts:60](packages/lib/src/typescript/lib/component/table/Header.ts#L60)) and sets `overflow: hidden` ([Header.ts:65](packages/lib/src/typescript/lib/component/table/Header.ts#L65)). The table's layout manager then fills the band as if that border cost nothing: [layout/Table.ts:160](packages/lib/src/typescript/lib/layout/Table.ts#L160) makes the band exactly as tall as the rows it will hold, [:192](packages/lib/src/typescript/lib/layout/Table.ts#L192) and [:232](packages/lib/src/typescript/lib/layout/Table.ts#L232) split that full outer height between the parent row and the column row, and [:243](packages/lib/src/typescript/lib/layout/Table.ts#L243) gives every header cell the same height. The rows are the header's children, so their containing block is the header's *padding* box — one pixel shorter than the band. The column row overruns it and `overflow: hidden` takes the pixel off. Measured offline on a 400×300 table: band 20, content box 19, column row 20, cells 20.

The fix is the sum every other layout manager already uses when it derives an outer size from content: **children plus the container's perimeter**. The band grows by the header's own border instead of the rows shrinking inside it, and the rows are then placed from `header.getContentBounds()` rather than from the band. The footer band ([:267–298](packages/lib/src/typescript/lib/layout/Table.ts#L267)) has the same shape and is corrected the same way. Along the way `TableHeader.setWidth` loses its row-width propagation, because the layout manager already owns that number and overwrites it moments later — having two owners is what let the height defect hide.

This plan is written against `master` (`e63e540c`). The branch `feature/content-box-baseline-sweep` is in flight and touches two of the same files; where it has already done part of the work, the steps below say so and give a `grep` to check.[^sweep-branch]

---

## Architecture Decisions

### The band's outer height is the rows plus the header's own perimeter

`headerBandHeight` becomes `parentRowHeight + columnHeight + header.getPerimeterSize().top + .bottom`. The rows and the header cells keep their full `columnHeight`; the band grows to make room for its own border.[^grow-not-shrink]

This is the sum the framework already uses everywhere an outer size is derived from content — [`Card.computeSize`](packages/lib/src/typescript/lib/layout/Card.ts#L99) adds `container.getPerimeterSize()` to the visible child's size, and `BoxLayout`, `HFlow`, `VFlow` and `Border` do the same in their `getPreferredSize` / `getMinSize` / `getMaxSize`. [`Component.getPerimeterSize`](packages/lib/src/typescript/lib/core/Component.ts#L3068) states the contract in its own JSDoc: `getInnerSize` subtracts insets, border and padding, "and the size-hint paths add them back".

Because the perimeter is added to the band and never subtracted from a row, `hasParentRow === false` needs no special case: `parentRowHeight` stays exactly `0` and the collapsed parent row keeps its zero height.

### The rows and cells are placed from the header's content box

After the band's outer height is committed, the manager reads `header.getContentBounds()` once and places both rows inside that rectangle — origin from the box, extent from the box.[^content-bounds-null] The header cells keep `columnHeight`; they sit inside the column *row*, which carries no border, so their own frame is already right.

This mirrors what `layout/Table.doLayout` already does one level up for its own container ([:97](packages/lib/src/typescript/lib/layout/Table.ts#L97) and [:113](packages/lib/src/typescript/lib/layout/Table.ts#L113)) and what every sibling manager does — `Grid`, `Border`, `HBox`, `VBox`, `Fit`, `Card`, `Split`, `Tab`, `Accordion`, `Anchor`, `HFlow`, `VFlow` all pair `container.getContentInsets()` for the origin with `container.getInnerSize()` for the extent.

The rows stay **wider** than the content box on purpose: `innerRowW` is `max(visible width, sum of column widths)` so cells past the right edge can scroll into view when [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts#L269) translates the rows horizontally. That deliberate horizontal overflow is not the defect and is not being removed; only the *floor* changes, from the container's width to the header's content width.

### The layout manager is the sole owner of the header rows' geometry

`TableHeader.setWidth` ([Header.ts:373](packages/lib/src/typescript/lib/component/table/Header.ts#L373)) is deleted. Its only caller is [layout/Table.ts:176](packages/lib/src/typescript/lib/layout/Table.ts#L176), and the manager reassigns both row widths to a *different* value nine lines later, so the override has never had an observable effect.[^who-owns-rows]

`TableHeader.setHeight` stays: it is where the ownership rule is documented, and its `@remarks` widens by one clause to cover widths and positions as well as heights.

### The footer band is corrected the same way

`footer.setHeight` becomes `columnHeight + footer.getPerimeterSize().top + .bottom`, its `setY` subtracts that same band height so it still sits flush with the container's bottom edge, and its cells are sized from `footer.getContentBounds()`. `FooterRow` carries a 1px top border ([Footer.ts:21](packages/lib/src/typescript/lib/component/table/Footer.ts#L21)), so the shape is identical to the header's.

Nothing renders it today: `Table._footerVisible` is set `false` in the constructor ([component/table/Table.ts:217](packages/lib/src/typescript/lib/component/table/Table.ts#L217)) and there is no setter, and the footer's inner row is built with no model so `footer.getColumns()` is always empty. The band half is still worth fixing for uniformity and is testable; the cell half cannot be exercised at all.[^footer-dead]

### No static guard covers this, so the regression test is mandatory

The `local/require-content-bounds` rule cannot see this defect and never will. Its header states the exemption plainly: "Layout managers read the CONTAINER they are handed rather than `this` or one of their own fields, so they are out of scope by construction" ([scripts/eslint/require-content-bounds.js:37–41](packages/lib/scripts/eslint/require-content-bounds.js#L37)). The exemption is deliberate and correct — a manager's insets handling is `LayoutManager`'s concern, and lifting it would report every manager in the codebase.

A manager that reaches past its own container into a *child's* subtree therefore has no static guard of any kind, and deleting `TableHeader.setWidth` moves this area's one baselined entry out of the linter's sight for good. The change ships with offline tests in [`tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts), matching that suite's style: detached components, an explicit border, literal expected geometry, plus a borderless case proving today's numbers are unchanged.

---

## Internal Structure

The header block of [`layout/Table.doLayout`](packages/lib/src/typescript/lib/layout/Table.ts#L142) after the change, with the two per-cell loops elided — they keep their bodies, and the header cells keep `columnHeight`. `setAutoCommitStyle` bracketing is unchanged on every write and is elided on the rows for brevity.

```typescript
const hasParentRow    = header.hasParentRow();
const parentRowHeight = hasParentRow ? columnHeight : 0;

// The band's bottom border is chrome outside the rows, so the outer height is
// what the rows need PLUS the header's own perimeter — the same "children plus
// the container perimeter" sum every other manager's size report uses. Taking
// it out of a row instead would make a header cell shorter than the body row it
// heads, by an amount the theme's border width decides.
const headerPerimeter  = header.getPerimeterSize();
const headerBandHeight = parentRowHeight + columnHeight
                       + headerPerimeter.top + headerPerimeter.bottom;

header.setAutoCommitStyle(false);
header.setX(containerInsets.getLeft());
header.setY(containerInsets.getTop());
header.setWidth(containerSize.width);
header.setHeight(headerBandHeight);
header.setAutoCommitStyle(true);

// The rows are the header's own children, so their frame is the header's
// content box, not the band: a row placed at the band's origin and sized to
// the band starts inside the border and overruns the far edge.
const headerBox = header.getContentBounds()
    ?? { x: 0, y: 0, width: containerSize.width, height: headerBandHeight };

// Rows stay at least as wide as the visible content box, and wider when the
// columns overflow it, so cells off the right edge can translate into view.
const columnSum = columnWidths.reduce((s, w) => s + w, 0);
const innerRowW = Math.max(headerBox.width, columnSum);

const parentRow = header.getParentRow();
parentRow.setX(headerBox.x);
parentRow.setY(headerBox.y);
parentRow.setWidth(innerRowW);
parentRow.setHeight(parentRowHeight);

// … the `if (hasParentRow)` parent-cell loop, unchanged …

const columnRow = header.getComponents()[1];
columnRow.setX(headerBox.x);
columnRow.setY(headerBox.y + parentRowHeight);
columnRow.setWidth(innerRowW);
columnRow.setHeight(columnHeight);

// … the `headerColumns.forEach` cell loop, unchanged …
```

and the scrollbar cover, whose element is a raw `<div>` inside the header and so shares the rows' containing block:

```typescript
DOM.sink.apply(cover, {
    style: {
        left:   (headerBox.x + headerBox.width - trackW) + "px",
        width:  trackW + "px",
        height: headerBox.height + "px",
    },
});
```

---

## Ordered Implementation Steps

1. **Write the failing tests first**, in [`packages/lib/tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts), as a new `describe('a table header band contains its rows and cells')` at the end of the file. Cover every case in `## Expected Behaviour`. Run `npx vitest run tests/component/content-box-containment.test.ts` — the default, grouped, thick-border and footer cases must fail; the borderless case must already pass.

2. In [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts), rewrite lines 158–233 of the header block to match `## Internal Structure`. Four things change and nothing else: `headerBandHeight` gains the header's perimeter (:160); `columnSum` / `innerRowW` move from before the header sizing (:170–171) to after `headerBox` exists, with `headerBox.width` as the floor instead of `containerSize.width`; both rows take their origin from `headerBox`; and the column row's `y` becomes `headerBox.y + parentRowHeight`.

3. Leave both per-cell loops alone. The parent cells keep `parentRowHeight` (:218) and the header cells keep `columnHeight` (:243) — nothing shrinks, because the band grew instead. Verify: `grep -n 'headerBandHeight' src/typescript/lib/layout/Table.ts` — expect two matches, its own declaration and the `header.setHeight` call.

4. In the same block, change the scrollbar cover's `style` at [:258–264](packages/lib/src/typescript/lib/layout/Table.ts#L258) to the `headerBox` form in `## Internal Structure`. The cover is a raw `<div>` appended to the header's element, so it shares the rows' containing block and needs the same rectangle.

5. In the footer block ([:267–298](packages/lib/src/typescript/lib/layout/Table.ts#L267)), add `const footerPerimeter = footer.getPerimeterSize();` and `const footerBandHeight = columnHeight + footerPerimeter.top + footerPerimeter.bottom;`; pass `footerBandHeight` to both `footer.setY(containerInsets.getTop() + containerSize.height - footerBandHeight)` and `footer.setHeight(footerBandHeight)`; read `const footerBox = footer.getContentBounds() ?? { x: 0, y: 0, width: containerSize.width, height: columnHeight };` and give each footer cell `footerBox.height`.

6. Run `npx vitest run tests/component/content-box-containment.test.ts` — all cases green.

7. Delete the `setWidth` override in [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L365) (the whole method and its JSDoc block, currently lines 365–381). Extend `setHeight`'s `@remarks` to say the layout manager assigns the rows' widths and positions as well as their heights, because all three depend on `hasParentRow` and on the header's content box. Verify: `grep -n 'setWidth' src/typescript/lib/component/table/Header.ts` — expect zero matches.

8. Remove `"src/typescript/lib/component/table/Header.ts:TableHeader.setWidth"` from [`packages/lib/scripts/eslint/require-content-bounds.baseline.json`](packages/lib/scripts/eslint/require-content-bounds.baseline.json) if it is still there (`feature/content-box-baseline-sweep` removes it too). Then `npm run lint` — clean.

9. Delete any case in `content-box-containment.test.ts` that exercises `TableHeader.setWidth`: `grep -n 'TableHeader' tests/component/content-box-containment.test.ts`. The `feature/content-box-baseline-sweep` branch adds one named *"TableHeader only shrinks its rows when given a border"*; the method it tests no longer exists, so it would pass vacuously. The `FooterRow` case in the same block stays.

10. Add a bordered-table case to the demo panel [`packages/lib/src/typescript/ContentBoxPanel.ts`](packages/lib/src/typescript/ContentBoxPanel.ts): a private `buildTableRow()` returning a `Container` with an `HFlow`, holding one `FieldSet("Table header band", …)` around a `Table` built like [`ComplexUIPanel.buildPanel5`](packages/lib/src/typescript/ComplexUIPanel.ts#L93) (a `MemoryStore` with `autoLoad: true` and three or four string columns), with `table.getHeader().setBorder(MENU_ITEM_BORDER)` — the panel's existing 4px constant — applied after construction. Add `this.addComponent(this.buildTableRow());` to the constructor and one sentence to the panel's intro `Text` naming the table. Comment the case the way the panel's others are: a 4px border is used, not `BORDER`, because a 1px one is invisible either way.

11. Add a changelog entry under `## 0.4.0` → `### Fixed` in [`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md), per `## Documentation Impact`.

12. `npm run typecheck && npm test && npm run lint` from the repo root, then the manual checks in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.baseline.json` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/src/typescript/ContentBoxPanel.ts` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Expected Behaviour

All geometry cases below are **offline-testable**. The "Today" column was measured against the current code, so it is the red state a new test must reproduce; the "After" column is what the change must produce. The harness is the one `content-box-containment.test.ts` already installs: shared `dom/font-metrics.test-font.json`, no `--ts-ui-font-size`, so `Util.lineHeightPx()` is `16` and `theme.table.cell.padding` is `2`, giving `columnHeight = 20`.

The fixture is a `Table` over a two-`string`-column model, laid out **detached** at 400×300. Detached matters: the modelled DOM source reports `0px` border widths for *connected* elements, so a connected fixture would measure no border and every case would pass vacuously. Pin the harness first — `table.getInnerSize()` is `{ width: 398, height: 298 }` and `table.getBorderSize().top` is `1` — so a harness change fails loudly instead of shifting every number below.

**Ungrouped header, shipped 1px bottom border:**

| Measurement | Today | After |
|---|---|---|
| header outer height | 20 | 21 |
| header content-box height | 19 | 20 |
| parent row height | 0 | 0 |
| column row `(y, height)` | `(0, 20)` — overruns by 1 | `(0, 20)` |
| header cell height | 20, bottom pixel clipped | 20 |
| body `(y, height)` | `(20, 278)` | `(21, 277)` |

**Grouped header** (both columns declare `group: 'G'`), so `hasParentRow()` is `true`:

| Measurement | Today | After |
|---|---|---|
| header outer height | 40 | 41 |
| header content-box height | 39 | 40 |
| parent row `(y, height)` | `(0, 20)` | `(0, 20)` |
| column row `(y, height)` | `(20, 20)` — overruns by 1 | `(20, 20)` |
| body `(y, height)` | `(40, 258)` | `(41, 257)` |

**Borderless header** — `table.getHeader().clearBorder()` before the layout pass. This is the no-op proof: every number is identical before and after the change.

| Measurement | Today | After |
|---|---|---|
| header outer height | 20 | 20 |
| header content-box height | 20 | 20 |
| column row `(y, height)` | `(0, 20)` | `(0, 20)` |
| body y | 20 | 20 |

**Thick border** — `table.getHeader().setBorder('6px solid black')`, the case that fails loudest and the one the demo panel shows:

| Measurement | Today | After |
|---|---|---|
| header outer height | 20 | 32 |
| header content-box height | 8 | 20 |
| header content-box width | 386 | 386 |
| column row `(y, height)` | `(0, 20)` — 12px of a 16px text line clipped | `(0, 20)` |
| row width `innerRowW` | 398 | 386 |
| body y | 20 | 32 |

**Footer band** — reachable only by writing the private flag (`(table as unknown as { _footerVisible: boolean })._footerVisible = true`), because `Table` exposes no footer-visibility setter. Assert the band only; the footer's inner row is built with no model, so `footer.getColumns()` is empty and the cell height cannot be exercised.

| Measurement | Today | After |
|---|---|---|
| footer outer height | 20 | 21 |
| footer content-box height | 19 | 20 |
| footer y | 278 | 277 |

**Needs manual verification** (the harness cannot see rendered pixels):

- Under the shipped themes nothing visibly moves except the band's extra pixel. The clipped pixel today lands exactly where the header's own border paints, so no content is lost and no gap opens — the fix is structural, not cosmetic.[^no-visible-symptom]
- With a thick header border the header text must be whole and the band must have grown. This is what the new demo case is for.

---

## Verification

```
npm run typecheck
npm test
npm run lint
```

`npm run lint` must be clean with one fewer baseline entry, and `npm test` must show no other suite moving. Nothing outside `layout/Table.ts` reads the header band's height: `grep -rn 'getHeader()' src/ tests/` returns the manager's own two uses, the `Table.getHeader` accessor, one unrelated `Window.getHeader`, and one test that reads header *cells*.

Manual, with `npm run dev` (demo app on `localhost:8015`):

1. **Content Box** tab, the new table case: the header cells' text is whole inside the thick border, and the band is visibly taller than one body row. On the unfixed code the same case cuts the bottom of every header label.
2. **Misc.** tab, the tables there — the plain one, the wide one, and the `TreeTable`: each header looks exactly as before apart from being one pixel taller. Include a table with column groups if the demo has one, so the parent-row split is exercised; otherwise add `group` to two columns of the wide table's spec temporarily.
3. Same tab, scroll a table horizontally: the header cells still translate under the scrollbar cover with no seam at the band's right edge, and the cover still spans the full band.
4. **Rotated** tab: rotated mode swaps the store and columns and reuses this identical geometry path, so it needs an eyeball but no separate reasoning.
5. Repeat step 2 after a theme switch (Classic / Modern / Dark). All three give the header a 1px border and differ only in colour, so all three must look the same as before.

---

## Documentation Impact

`TableHeader.setWidth` is removed. It is a public method on an exported class, so it currently renders a TypeDoc member page; deleting it removes that page. Consumers are unaffected at the type level — `Component.setWidth` still answers the call — and no doc page references it (`grep -rn 'setWidth' packages/lib/docs/` finds no `TableHeader` mention). Run `npm run docs:api`; it must finish with zero warnings.

Changelog, under `## 0.4.0` → `### Fixed`, alongside the existing content-box entries:

- A table's header band is one pixel taller: it now adds its own bottom border to the height its rows need, instead of splitting the band's outer height between them and letting `overflow: hidden` take the last pixel off every header cell. A header cell is now exactly as tall as the body row it heads. Nothing visible changes under the shipped themes — the pixel that was clipped is where the border paints — but a header given a thicker border no longer cuts into its own labels. The footer band is corrected the same way; it cannot be switched on today. `TableHeader.setWidth` is gone: it forwarded a width the table's layout manager overwrote immediately, and the rows' widths, positions and heights all come from the manager now.

---

## Potential Challenges

- **`feature/content-box-baseline-sweep` overlaps.** It edits `Header.ts`, the lint baseline and the same test file. If it merges first, steps 7–9 remove work it just added; if it does not, the same steps still apply against master's version. Each of those steps carries a `grep` so the implementer can tell which state the tree is in.
- **`getContentBounds()` returns `null` before the header's element exists.** Every call site falls back to the outer numbers, matching `FooterRow`'s `?? width` shape. Do not drop the fallback: `doLayout` can be driven from a store-load event.
- **Reading the content box before committing the height gives stale numbers.** `getInnerSize` derives from the component's `_width` / `_height` fields, so `header.getContentBounds()` must be called *after* `header.setHeight(...)`. The step order in `## Internal Structure` is the required order.
- **`table-header-column-virtualization.md` moves the header cell loops.** That plan (unimplemented, and itself blocked on `table-column-virtualization`) replaces the two per-column `forEach` loops with a single `TableHeader.renderColumnWindow(geometry)` call, while leaving the band and the two rows with the manager. Land this plan first — it is a dozen lines — and that plan then carries the corrected cell height through its `geometry` argument.
- **A connected test fixture measures no border.** The modelled DOM source reports `0px` border widths once an element is connected, so the new cases must keep the table detached, exactly as the rest of `content-box-containment.test.ts` does.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — the whole of `doLayout`; the header block is :142–265, the footer :267–298, the body :300–312.
- [`packages/lib/src/typescript/lib/layout/Card.ts:99`](packages/lib/src/typescript/lib/layout/Card.ts#L99) — `computeSize`, the precedent for "children plus the container perimeter". `HFlow.ts:82`, `BoxLayout.ts:298` and `Border.ts:561` are the same shape.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getContentInsets` (:2004), `getInnerSize` (:2921), `getContentBounds` (:2953), `getBorderSize` (:2982), `getPerimeterSize` (:3068).
- [`packages/lib/docs/concepts/sizing.md:100`](packages/lib/docs/concepts/sizing.md#L100) — *Inner size vs outer size*, the consumer-facing statement of the rule.
- [`ARCHITECTURE.md:89`](ARCHITECTURE.md#L89) — *Size constraints: who is responsible for what*; the content-box rule itself is the third bullet at [:71](ARCHITECTURE.md#L71).
- [`packages/lib/scripts/eslint/require-content-bounds.js:37`](packages/lib/scripts/eslint/require-content-bounds.js#L37) — the `LayoutManager` exemption, in the rule's own words.
- [`packages/lib/tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts) — the suite to extend and the style to match.
- [`packages/lib/src/typescript/lib/component/table/Body.ts:168`](packages/lib/src/typescript/lib/component/table/Body.ts#L168) — `computeRowHeight`, the body's `lineHeight + 2 * padding`; the header cell must equal it.
- Commit `3f954d39` — the eleven component-side sites fixed the same way, including `Tooltip` growing its outer box by its border.

---

## Non-Goals

- **Making the footer reachable.** `Table` has no footer-visibility setter and this plan does not add one, nor does it populate the footer's empty inner row. `docs/components/Table.md` describes a footer API that does not exist; that is a separate correction.
- **Positioning the footer's inner row.** Its `x` / `y` are never assigned and read back as `NaN`. Pre-existing, invisible while the band is unreachable, out of scope.
- **Relaxing `overflow: hidden` on `TableHeader`.** It is what keeps a cell from painting over the band's own border, and the framework treats a clip as the diagnostic rather than the defect.
- **Widening `local/require-content-bounds` to cover layout managers.** The exemption is deliberate and lifting it would report every manager in the codebase; the tests are the guard here.
- **Changing how the body band lays itself out.** `Body` derives its own row height and places its rows through its virtual-scroll path; that code is not part of this defect and is not touched. The body's `y` and `height` still come from the header's and footer's outer heights exactly as they do today, so they shift by a pixel as a consequence of the bands growing.

---

## Notes

[^grow-not-shrink]: The alternative — keep the band at `parentRowHeight + columnHeight` and take the border out of the column row — was rejected. It makes a header cell's height depend on the theme's border width, so a thicker border eats the text instead of the band: with a 6px border the content box is 8px and a 16px line box loses half of itself. `Body.computeRowHeight` rejects the same coupling in its own JSDoc ("a fixed pixel height ignores the active line box and clips text when the theme changes the leading"). Growing also keeps a header cell exactly as tall as the body row it heads — both are `lineHeight + 2 * padding` — and matches how commit `3f954d39` resolved the one component in that sweep whose outer size is derived from measured content: `Tooltip` grew by its own border so its label kept the width it measured. Shrinking would have been the smaller diff (the band stays 20 and nothing downstream moves), and it is what `FooterRow` does — but `FooterRow` *receives* an outer height it cannot change, whereas the manager *derives* one and is the party that should have added the perimeter. Under this plan the two compose: the manager hands the footer `columnHeight + perimeter`, and `FooterRow` hands its row the content box, which is `columnHeight` again.

[^footer-dead]: Fixing an unreachable band needs a reason. This one is two expressions, both copies of the header's, and it is the half the in-flight `FooterRow` correction pairs with — leaving it out would mean the component-side and manager-side halves of the same rule disagree in the one place a reader would look for the pattern. The alternative, deleting the footer path outright, is a larger and separate decision about a public `getFooter()` accessor and a documented-but-absent footer API, and belongs in its own plan.

[^content-bounds-null]: `getContentBounds()` returns `null` when the component's element does not exist yet ([Component.ts:2953](packages/lib/src/typescript/lib/core/Component.ts#L2953)), mirroring `getInnerSize`. `doLayout` can be driven by a store-load event before the tree has rendered, and the NaN guard at [layout/Table.ts:109](packages/lib/src/typescript/lib/layout/Table.ts#L109) only proves the *container* has an element. The fallback rectangle is today's behaviour — origin `(0, 0)`, the container's width, the full band — which is correct when there is no border to subtract.

[^who-owns-rows]: The two owners write different values. `TableHeader.setWidth` gives the rows the header's own width; the manager gives them `max(header content width, sum of column widths)`, deliberately wider so a horizontally scrolled cell can translate into view. The manager's write lands second and wins, which is why the branch that corrected `setWidth` to use the content width produced no observable change. Keeping both would leave a setter whose value is always discarded — and it is exactly that arrangement, a component-side propagation shadowed by a manager-side one, that let the height defect sit unexamined next to a width fix. The reverse assignment (manager stops writing the rows, `TableHeader` owns them) is not viable: the row heights depend on `hasParentRow` *and* on the per-column width array, neither of which the header can see from a `setWidth` call.

[^no-visible-symptom]: Worth stating plainly, since it decides how much churn is justified. The clipped strip is `y ∈ [19, 20)` of the header's box, which is precisely where the header's bottom border paints. Children are clipped at the padding box, so nothing of the cell was going to be visible there anyway — and without `overflow: hidden` the cells' backgrounds would paint *over* the divider and break it. The column separators (a 1px stripe on each `ResizeHandle`, `height: 100%`) stop at the content box and the border continues the line, so they meet with no gap. So no user can see this today under any shipped theme, and the fix changes no pixel except the band's extra one. It is worth doing anyway because it is a dozen lines, it removes a silent overrun that only `overflow: hidden` is absorbing, it deletes a setter with no observable effect, and it stops a themed or thickened border from cutting into the header labels. It is not worth expanding beyond that — no restructuring of who lays out the header, and no attempt to make the band configurable.

[^sweep-branch]: `feature/content-box-baseline-sweep` corrects `TableHeader.setWidth` and `FooterRow.setWidth` / `setHeight` to hand their rows `getContentBounds()`, removes six entries from the lint baseline, and adds a `table bands size their inner rows to the content box` block to `content-box-containment.test.ts`. Its changelog entry already names this plan by filename and records the manager-side defect as deliberately left open. Two of its edits are superseded here: the `TableHeader.setWidth` correction (the method goes) and the test case covering it. Its `FooterRow` half is not superseded — it is the component-side counterpart to this plan's footer band change, and the two only compose correctly together.
