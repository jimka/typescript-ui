---
touches-shared:
  - packages/lib/src/typescript/lib/component/table/Header.ts
  - packages/lib/src/typescript/lib/layout/Table.ts
---

# Table Header Column-Menu Button — Implementation Plan

## Overview

A `Table`'s column menu — show/hide columns, reset columns, the filter-row
toggle, CSV/JSON export — opens today only by right-clicking a header cell.
Nothing on screen says so. This plan adds a small icon button that opens the
same menu, placed in the empty strip at the header's right edge above the
vertical scrollbar.

The strip already exists. At the start of this work, `TableHeader.
getScrollbarCover()` created a raw `<div>` — the cover — that masked the
vertical-scrollbar reservation band so the header gradient stayed
continuous, positioned by `layout/Table.ts` on every pass. The new button
is placed in that same band, sized to exactly fill it on both axes. By the
end of this work (`## Implementation Notes`, deviation 3) the button fully
replaces the cover — carrying its own background and divider — and
`getScrollbarCover()` is removed; see that section for why, and the
changelog's *Breaking changes* entry for the consumer-facing note.

Three files change: `Header.ts` (owns the button and the click handler),
`layout/Table.ts` (positions it), plus a new test file. `Table.ts` is not
touched — the button fires the header's existing `"columncontextmenu"` event,
which `Table` already listens to
([Table.ts:304](packages/lib/src/typescript/lib/component/table/Table.ts#L304)).

---

## Architecture Decisions

### The button is a `TableHeader` child, added through `super.addComponent`

`TableHeader` builds the button in its constructor and appends it with
`super.addComponent(button)`, bypassing its own `addComponent(row: Row)`
override.[^child-not-cover] It is appended **last**, after the three `Row`
children, so the fixed child indices in `getParentRow()` (index 0),
`getColumns()` (index 1), and `getFilterRow()` (index 2) keep resolving to the
rows.

The precedent is `ToolBar._createOverflowAffordance`
([ToolBar.ts:364](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L364)),
which adds its glyph-only "more" `Button` the same way — `super.addComponent`
past a narrowed public `addComponent`, with `getAria().setHasPopup("menu")` and
a menu it opens on click. That method is the closest existing solution to this
problem and this plan follows its shape.

### The button reuses the existing `"columncontextmenu"` event

Clicking the button calls a private `TableHeader.onMenuButtonAction()`, which
emits `"columncontextmenu"` with an empty field name — exactly what a
right-click on a parent-header cell already emits
([Header.ts:812](packages/lib/src/typescript/lib/component/table/Header.ts#L812)).
`Table` already routes that event to `showColumnMenu(x, y)`, which ignores the
field name because the menu is table-wide. No change to `Table.ts` is needed or
allowed.[^no-menubutton]

### The menu is anchored to the button's own rect, not to the click coordinates

`onMenuButtonAction` reads `DOM.source.getViewportRect(button)` and emits
`(rect.left, rect.bottom)`, so the menu opens flush under the button.

A keyboard activation is why. A `<button>` activated with Enter or Space
dispatches a synthetic click whose `clientX` / `clientY` are `0`, which would
open the menu in the viewport's top-left corner. The button's own rect is
correct for both input methods. `Menu.show` flips the menu per axis when the
room runs short ([Menu.ts:216](packages/lib/src/typescript/lib/overlay/Menu.ts#L216)),
so a button at the table's right edge still gets a menu inside the viewport.

### The button is a flat, compact, glyph-only `Button` with a pinned glyph, sized to exactly fill the reservation band

Options: `flat: true`, `compact: true`, `glyph: "ellipsis-v"`,
`text: "Column options"`, `showText: false`. `Button` renders the title blank
while keeping it alive as the hover tooltip and the reflected `aria-label`
([Button.ts:1053](packages/lib/src/typescript/lib/component/button/Button.ts#L1053)).
`getAria().setHasPopup("menu")` is set imperatively, as `ToolBar` does.

The button also fully replaces what used to be a separate, non-interactive
scrollbar-reservation cover (`## Implementation Notes`, deviation 3): it
carries the header's own background
(`setBackgroundColor`/`setBackgroundImage(TABLE_HEADER_BG)`) and a left
divider matching the column-cell border, applied as an *inset shadow* rather
than via `setBorder` — flat chrome already reserves a 1px transparent border
on every side for its hover/pressed geometry, and overwriting just one side
of that via `setBorder` would fight the framework's own chrome state rather
than compose with it. `ParentHeaderCell` uses the same inset-shadow technique
for its own dividers.

The glyph box is pinned with `pinGlyphSize(glyphPx)`, where `glyphPx =
getScrollBarWidth() - MENU_BUTTON_CHROME_PX` — computed once per
`TableHeader`, in its constructor, rather than a fixed pixel count. A button
in this configuration measures `glyph + MENU_BUTTON_CHROME_PX` (`6`) per
axis — 2px of compact inset and 1px of transparent frame on each side — so
the glyph is pinned to whatever leaves the button's total width exactly
equal to the native scrollbar width. On the offline test harness's pinned
`15px` scrollbar width this works out to a `9px` glyph in a `15px`
button.[^glyph-pin]

`pinGlyphSize` — not `getGlyph().setPreferredSize(...)` — is the correct lever.
It sets the authoritative opt-out flag, so a later theme change cannot re-track
the glyph to the (blank) title's line height and grow it
([Button.ts:1438](packages/lib/src/typescript/lib/component/button/Button.ts#L1438)).

### The layout sizes the button to exactly fill the reservation band, on both axes

`layout/Table.doLayout` sizes the button to the full reservation band on
both axes — width `trackW` (the native scrollbar width), height
`headerBox.height` — and positions it flush with the header's right edge,
spanning top to bottom over the *entire* header band (`headerBox.y` to
`headerBox.y + headerBox.height`), parent-header row included when one is
present. (Two earlier revisions live in `## Implementation Notes`: the
button originally only spanned the column-header row; a later revision
spanned the full band but was still centred inside it at a narrower,
glyph-derived width, alongside a separate cover `<div>` that supplied the
background. Both `y`/`height` and now `x`/`width` fill the band exactly, and
the separate cover is gone — the button supplies its own background.)

Neither axis is content-derived any more, so both are re-pinned every pass
via `Button.setPreferredSize`, which permanently opts a button out of its
own auto-sizing pipeline once called (see that method's doc comment).
Without this, `TableHeader`'s default `Absolute` layout manager
([Absolute.ts:40](packages/lib/src/typescript/lib/layout/Absolute.ts#L40)),
which re-commits every child at `preferredSize ?? size` whenever the header
lays out, would snap the button back down to its glyph-derived square the
next time it runs — visibly shrinking it.[^absolute-agreement]

Positioning the button's outer rect via raw `setX`/`setY`/`setWidth`/
`setHeight` — mirroring how `layout/Table.doLayout` already positions
`header`/`body`/`footer`/the three rows — is not, on its own, enough to make
the button's own content appear: `Button` needs its **own** `doLayout()` to
run so its internal `Fit` layout can position `_content` (and the glyph
inside it). The rows don't need this because their cells are positioned by
a separate, explicit mechanism (`_cellGeom.apply` in `positionColumnCells` /
etc.), bypassing each row's own layout manager entirely — there is no
equivalent mechanism for the button's content, so `layout/Table.doLayout`
calls `menuButton.doLayout()` explicitly after committing its rect, mirroring
what `LayoutManager.commitBounds` does for every other parent-positions-child
relationship in this codebase. Omitting this call was a bug caught in live
browser review, not something the offline test suite's original assertions
exercised — see `## Implementation Notes`.

Worked example, using the values the offline test harness pins (native
scrollbar width `15`, a 400×300 table whose header content box is `398 × 20`
with no parent row):

| Value | Expression | Result |
|---|---|---|
| band left edge / button `x` | `headerBox.x + headerBox.width - trackW` | `0 + 398 - 15` = `383` |
| button width | `trackW` | `15` |
| button `y` | `headerBox.y` | `0` |
| button height | `headerBox.height` | `20` |

The button therefore spans x `383…398` — flush with the header's right edge,
no slack on either side — and y `0…20`, the full band. With a parent-header
row present, `headerBox.height` grows to `40` and the button spans the same
`0…40`, covering both rows.

### The button is always present

No visibility condition. The band the button sits in is reserved
unconditionally: `Table.getAvailableColumnWidth`
([Table.ts:773](packages/lib/src/typescript/lib/component/table/Table.ts#L773))
subtracts the scrollbar width from the columns' space whether or not the body
actually overflows, and the button is positioned on every pass the header
block runs. A button that appeared and vanished with the scrollbar would need
an overflow signal the header does not have.[^always-on]

### The button paints above the header's inner rows at `zIndex: 1`

The header's inner rows are Components at `z-index: 0` — an implicit
stacking context — so a plain sibling with `z-index: auto` paints beneath
them. `zIndex: 1` is enough to beat that. An earlier revision needed `2` to
also beat a separate cover `<div>`'s own `z-index: 1`; that cover is gone
(`## Implementation Notes`, deviation 3), so beating the rows alone is
enough now.[^z-order]

### The `ellipsis-v` glyph is registered at module load

`Header.ts` calls `Glyph.register(ellipsis_v)` at module scope, mirroring
[ToolBar.ts:24](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L24)
and [Table.ts:46](packages/lib/src/typescript/lib/component/table/Table.ts#L46),
so the button resolves its glyph without the consumer registering anything.
The registry has two vertical-ellipsis entries, `ellipsis-v` and
`ellipsis-vertical`; this plan uses `ellipsis-v`.[^glyph-name]

---

## Public API

```typescript
class TableHeader extends Component {
    /** The button that opens the column context menu. */
    getMenuButton(): Button;
}
```

No new options, no new events. `TableHeaderEvent` is unchanged — the button
reuses `"columncontextmenu"`.

**Removed** (`## Implementation Notes`, deviation 3): `TableHeader.
getScrollbarCover(): Handle`. The button now fully replaces the cover it
used to sit beside — see the changelog's *Breaking changes* entry.

---

## Internal Structure

Module scope in `Header.ts`:

```typescript
Glyph.register(ellipsis_v);

const MENU_BUTTON_GLYPH:     string = "ellipsis-v";
const MENU_BUTTON_LABEL:     string = "Column options";
const MENU_BUTTON_CHROME_PX: number = 6;
const MENU_BUTTON_Z_INDEX:   number = 1;
```

Fields and constructor wiring (the bound-listener field mirrors the existing
`_boundOnStoreFilterChange` at
[Header.ts:127](packages/lib/src/typescript/lib/component/table/Header.ts#L127)):

```typescript
private _menuButton: Button;
private _boundOnMenuButtonAction: () => void = () => this.onMenuButtonAction();

// …in the constructor body, after the three rows are added:
const glyphPx = Math.max(1, DOM.source.getScrollBarWidth() - MENU_BUTTON_CHROME_PX);

this._menuButton = new Button({
    glyph:     MENU_BUTTON_GLYPH,
    text:      MENU_BUTTON_LABEL,
    showText:  false,
    flat:      true,
    compact:   true,
    zIndex:    MENU_BUTTON_Z_INDEX,
    listeners: { action: this._boundOnMenuButtonAction },
});
this._menuButton.pinGlyphSize(glyphPx);
this._menuButton.setBackgroundColor(TABLE_HEADER_BG);
this._menuButton.setBackgroundImage(TABLE_HEADER_BG);
this._menuButton.setShadow("inset 1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))");
this._menuButton.getAria().setHasPopup("menu");
super.addComponent(this._menuButton);
```

Handler:

```typescript
private onMenuButtonAction(): void {
    const rect = DOM.source.getViewportRect(this._menuButton);

    this.emit("columncontextmenu", "", rect.left, rect.bottom);
}
```

Placement in `layout/Table.doLayout`, inside the same
`if (container.isHeaderVisible() …)` block that positions the header's rows:

```typescript
const trackW     = DOM.source.getScrollBarWidth();
const menuButton = header.getMenuButton();
const buttonSize = { width: trackW, height: headerBox.height };

menuButton.setPreferredSize(buttonSize);
menuButton.setAutoCommitStyle(false);
menuButton.setX(headerBox.x + headerBox.width - trackW);
menuButton.setY(headerBox.y);
menuButton.setWidth(buttonSize.width);
menuButton.setHeight(buttonSize.height);
menuButton.doLayout();
menuButton.setAutoCommitStyle(true);
```

`setPreferredSize` re-pins both of the button's dimensions every pass (see
*The layout sizes the button to exactly fill the reservation band, on both
axes* above); `doLayout()` cascades into the button's own `Fit` layout so its
content — the glyph — is actually positioned, not just sized (see the same
section).

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/table/Header.ts` — imports and
   module constants.** Add imports for `Button`
   (`~/component/button/Button.js`), `Glyph` (`~/component/display/Glyph.js`),
   and `ellipsis_v` (`~/glyphs/solid/ellipsis_v.js`). Add the
   `Glyph.register(ellipsis_v)` call at module scope and the four constants
   from *Internal Structure*, each with a doc comment explaining its value —
   `MENU_BUTTON_GLYPH_PX` must record that `glyph + 6` has to stay under the
   native scrollbar width, and `MENU_BUTTON_Z_INDEX` must record that it has to
   beat the cover's `1`. Check: `npm run typecheck` passes.

2. **`Header.ts` — fields.** Add `private _menuButton: Button;` and
   `private _boundOnMenuButtonAction: () => void = () => this.onMenuButtonAction();`
   beside the existing `_scrollbarCover` / `_boundOnStoreFilterChange` fields.
   Neither field needs `declare`: nothing writes them during the `super()`
   cascade.

3. **`Header.ts` — construct and add the button.** In the constructor body,
   after `this.addRow(filterRow)` and before `this.rebuildCells()`, build the
   button exactly as in *Internal Structure* and append it with
   `super.addComponent(this._menuButton)`. Comment why `super.` is used (the
   class's own `addComponent` is narrowed to `Row`) and why it is appended last
   (the row accessors index children positionally).

4. **`Header.ts` — accessor and handler.** Add `getMenuButton(): Button`
   (public, JSDoc'd, placed next to `getScrollbarCover`) and the private
   `onMenuButtonAction()` from *Internal Structure*. The handler's JSDoc states
   that the anchor is the button's own rect so keyboard activation works, and
   that the empty field name matches the parent-header-cell path.

5. **`Header.ts` — correct the event's JSDoc.** In the `on()` overload block
   ([Header.ts:306-309](packages/lib/src/typescript/lib/component/table/Header.ts#L306)),
   the `"columncontextmenu"` description says the field name is empty "when the
   click landed on a parent-header cell". Extend it to also name the
   column-menu button. This is the only edit to an existing source comment.

6. **`packages/lib/src/typescript/lib/layout/Table.ts` — position the button.**
   Insert the block from *Internal Structure* directly after the existing
   `DOM.sink.apply(cover, …)` call
   ([layout/Table.ts:271-278](packages/lib/src/typescript/lib/layout/Table.ts#L271)),
   still inside the header `if`. Reuse the already-computed `trackW` and
   `headerBox` — do not recompute either. Do not touch the cover write.
   Check: `npm run typecheck` passes.

7. **`packages/lib/tests/component/table/HeaderMenuButton.test.ts` — new test
   file.** Write the cases in *Expected Behaviour*. Copy the `CONFIG` /
   `installTestDOM` / `DOM.reset()` preamble from
   [`Header.disposal.test.ts`](packages/lib/tests/component/table/Header.disposal.test.ts).
   The click-dispatch case **must be the first `describe` block in the file**
   and must dispatch exactly one real event, per the constraint documented at
   the top of
   [`CollapseButton.test.ts`](packages/lib/tests/component/container/CollapseButton.test.ts):
   `Event`'s window-level listener is armed once per event type per module.

8. **Fit check.** Run the tests. If the "button fits inside the reservation
   band" case fails, the button is wider than the native scrollbar width:
   lower `MENU_BUTTON_GLYPH_PX` by 2 until it passes, and say so in the final
   report rather than relaxing the assertion.

9. **Docs.** Update `packages/lib/docs/components/Table.md` (lines 261 and
   266 both describe the menu as right-click-only) and add an entry under
   *Added* in `packages/lib/docs/reference/changelog/next.md`. See
   *Documentation Impact*.

10. **Full verification.** Run the commands in *Verification*, including the
    browser check — the feature is not done without it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Create | `packages/lib/tests/component/table/HeaderMenuButton.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable offline (the harness models `getScrollBarWidth`, geometry, and
`getViewportRect`):

1. **The header exposes the button.** `header.getMenuButton()` returns a
   `Button` whose parent component is the header.
2. **Child indices are unchanged.** After construction,
   `header.getParentRow()`, `header.getComponents()[1]`, and
   `header.getFilterRow()` still return the three `Row` children, and
   `header.getComponents()[3]` is the button.
3. **The button sits inside the reservation band.** After `table.doLayout()`,
   with `box = header.getContentBounds()!` and
   `trackW = DOM.source.getScrollBarWidth()`:
   `button.getX() >= box.x + box.width - trackW` and
   `button.getX() + button.getWidth() <= box.x + box.width`.
4. **The button fits the band.** `button.getWidth() <= trackW`, and
   `button.getWidth() === button.getPreferredSize()!.width` (same for height).
5. **The button spans the full header band, matching the scrollbar cover.**
   With `box = header.getContentBounds()!`: `button.getY() === box.y` and
   `button.getHeight() === box.height`.
6. **A parent-header row grows the band and the button still spans it.** On
   a table whose columns declare `group` (so `hasParentRow()` is true), case
   5 still holds against the taller `box.height` — the button covers both
   the parent-header row and the column-header row, not just the latter.
7. **The button's own content is actually laid out.** After
   `table.doLayout()`, `button.getGlyph()!.getY()` is a finite number, not
   `NaN` — proving `menuButton.doLayout()` ran and the button's internal
   `Fit` layout positioned the glyph, rather than merely sizing the button's
   outer box and leaving its content uncommitted (see *Potential
   Challenges*).
8. **A header-level layout does not move or resize it.** Snapshot
   `{x, y, width, height}` after `table.doLayout()`, call `header.doLayout()`,
   and assert the rect is identical. This pins the agreement with the header's
   own `Absolute` manager.
9. **Clicking emits the table-wide context-menu event.** With a listener on
   `header.on("columncontextmenu", fn)`, dispatching a click on the button
   calls it once with `("", rect.left, rect.bottom)` where
   `rect = DOM.source.getViewportRect(button)` — field name empty, coordinates
   from the button's rect, not from the event.
10. **Accessible name and popup role.**
   `button.getAria().getLabel() === "Column options"` and the button reports
   `aria-haspopup="menu"`.

Manual verification only (needs a real browser — see *Verification*):

11. The button is visible in the gutter above the vertical scrollbar, spanning
    the full header band height (both the parent-header row and the
    column-header row, when a parent row is present), and its glyph is
    neither clipped by the button's own bounds nor bleeding over the last
    column or the header's right edge.
12. Hovering shows the flat hover frame and the "Column options" tooltip.
13. Clicking opens the same menu a right-click on a header cell opens, in the
    same position relative to the button.
14. Tabbing to the button and pressing Enter opens the menu under the button
    (not at the top-left of the window).
15. Scrolling the table horizontally does not move the button, and header cells
    still disappear cleanly under the band.

---

## Verification

- `npm run typecheck`
- `npm run test` — includes the new `HeaderMenuButton.test.ts`
- `npm run lint`
- `npm run docs:api` — must finish with zero warnings (public JSDoc changed)
- **Browser check — required, not optional.** Start the demo app with
  `npm run dev` (http://localhost:8015), open the **Misc.** section, and
  inspect any of its tables. Confirm behaviours 10–14 above, and capture a
  screenshot of the header's right edge at normal zoom. A green typecheck and
  green tests do **not** establish that this feature works: the whole risk is
  whether a glyph-only button reads correctly inside a ~15px strip, and only a
  running browser answers that.

---

## Documentation Impact

- **API docs** are generated from JSDoc. `TableHeader` is exported from
  `packages/lib/src/typescript/lib/component/table/index.ts:25`, so the new
  public `getMenuButton()` needs a complete JSDoc block with `@returns`. Do not
  `{@link}` any private member from it.
- **`packages/lib/docs/components/Table.md`** describes the menu as
  right-click-only in two places — line 261 ("Right-click a column header to
  toggle column visibility via a context menu") and line 266 ("The column
  header's right-click context menu…"). Add the button as the second way in,
  naming where it sits (the strip above the vertical scrollbar) and its label.
  Line 213, which tells users to right-click to reveal the filter row, can name
  the button the same way.
- **`packages/lib/docs/reference/changelog/next.md`** gets an entry under an
  `### Table` heading in the *Added* section: the column menu now has a visible
  opener; right-click keeps working unchanged.

---

## Potential Challenges

- **The button may not fit the band on every platform.** The band is the
  native scrollbar width, which varies (~15–17px on Windows/Linux Chrome). The
  pinned glyph keeps the button at `glyph + 6`; step 8 lowers the pin if the
  measured width exceeds it.
- **Platforms with overlay scrollbars report a width of `0`.** The band
  collapses, and the centred button straddles the header's right edge with half
  of it clipped. The whole reservation model already degenerates there (the
  cover collapses too), so this plan does not add a special case — note it if
  the browser check is run on such a platform.
- **The glyph is small.** An 8px box on a 1:4 vertical ellipsis leaves about
  2px of ink width. Behaviour 11 is the gate; if it reads as a smudge rather
  than three dots, raise the pin as far as the band allows and re-check.
- **Committing a child's outer rect via raw setters does not, on its own, lay
  out that child's own content.** `layout/Table.doLayout` positions
  `header`/`body`/`footer`/the three rows this way, and none of them need
  more: the rows' cells are positioned by a separate explicit mechanism
  (`_cellGeom.apply`), not by each row's own layout manager. The button has
  no such mechanism — its glyph is positioned only by `Button`'s own internal
  `Fit` layout, which runs only when something calls `menuButton.doLayout()`.
  Every other parent-positions-child relationship in this codebase gets that
  call for free from `LayoutManager.commitBounds`; a raw-setter block like
  this one has to call it explicitly, or the button renders with a correctly
  sized, correctly positioned *outer* box and an invisible, uncommitted
  glyph — exactly what a first, `doLayout()`-less version of this plan's
  code sample shipped, caught only by a live browser check, since the
  offline harness's original assertions never inspected the glyph's own
  committed position. Behaviour 7 is the regression guard.
- **A second click re-opens rather than closes the menu.** `Menu.show` is a
  reposition-on-repeat call, and the button's own pointerdown dismisses the
  open menu just before the click re-shows it. This is identical to
  right-clicking the header twice today; fixing it needs `Menu.toggleFor` and a
  change to `Table.showColumnMenu`, which is out of scope.
- **The offline harness arms one window-level listener per event type per
  module.** A click-dispatching test placed after other tests in the same file
  can silently stop receiving events. Step 7 pins the ordering rule.

---

## Critical Files

Read before implementing:

- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) —
  the class being extended. `getScrollbarCover` (L504) for the band and its
  z-order comment, `addRow` / `addComponent` (L546, L559) for the narrowed
  child type, `wireCell` (L856) and `rebuildParentCells` (L812) for how
  `"columncontextmenu"` is emitted today, `_boundOnStoreFilterChange` (L127)
  for the bound-listener field idiom.
- [`packages/lib/src/typescript/lib/component/menubar/ToolBar.ts`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts) —
  **the precedent this plan mirrors.** `_createOverflowAffordance` (L364) and
  the module-level `Glyph.register` (L24).
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) —
  the header block (L153-279); `headerBox`, `parentRowHeight`, `columnHeight`,
  and the cover write the new code sits beside.
- [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) —
  `pinGlyphSize` (L1438), `_resolveInsets` (L1846) for how `flat` + `compact` +
  glyph-only resolves to 2px insets, `_applyFlatChrome` for the 1px transparent
  frame flat reserves, `_reflectAccessibleName` (L1053) and `_rebuildTooltip`
  (L996) for what `showText: false` buys.
- [`packages/lib/src/typescript/lib/layout/Absolute.ts`](packages/lib/src/typescript/lib/layout/Absolute.ts) —
  why the committed size must equal the preferred size.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) —
  `commitBounds` (L484): the codebase's standard "commit a child's rect, then
  cascade into its own `doLayout()`" pattern, which `layout/Table.ts`'s
  raw-setter block has to replicate explicitly for the button (see
  *Potential Challenges*).
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) —
  `showColumnMenu` (L1647) and its listener (L304); read only, do not edit.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts) —
  the other in-table glyph-only button, for the `flat` + `compact` +
  `showText: false` combination.
- [`packages/lib/tests/component/container/CollapseButton.test.ts`](packages/lib/tests/component/container/CollapseButton.test.ts) —
  the offline click-dispatch idiom and its ordering constraint.
- ~~`packages/lib/tests/component/content-box-containment.test.ts:1599` — the
  existing cover-geometry tests, which must keep passing untouched.~~
  Superseded — those two tests covered `getScrollbarCover()`, which no
  longer exists (`## Implementation Notes`, deviation 3); the equivalent
  coverage now lives in `HeaderMenuButton.test.ts`.

---

## Non-Goals

- **No change to the menu itself.** `showColumnMenu`, `buildColumnMenuItems`,
  and the column dialog are untouched; the button opens whatever the right-click
  path opens.
- ~~**No change to the scrollbar cover.**~~ Superseded — see `## Implementation
  Notes`, deviation 3. Once the button was widened to exactly fill the same
  band the cover occupied, the cover became permanently, pixel-perfectly
  hidden behind it; kept only for API stability, it was removed instead,
  along with its dedicated tests, after confirming (via `grep`) it had no
  consumer inside this repo beyond `layout/Table.ts` and its own tests. This
  is a breaking change, recorded in the changelog's *Breaking changes*
  section — `TableHeader.getScrollbarCover()` is a public method shipped in
  v0.4.0.
- **No option to hide or relabel the button.** Nothing asked for one, and a
  configurable affordance is speculative surface.
- **No special case for rotated display mode.** While rotated,
  `showColumnMenu` shows export-only entries, or returns without opening
  anything when `setExportMenuEnabled(false)` was also called. The button
  inherits both behaviours because it shares the event path; in that one
  combination it is a visible no-op, exactly as right-clicking the header is a
  no-op there today. Diverging would need new state pushed from `Table` into
  the header.
- **No toggle-shut on a repeat click.** See *Potential Challenges*.
- **No right-click handling on the button itself.** Right-clicking the button
  does nothing; left-click and keyboard activation are the affordance.

---

## Notes

[^child-not-cover]: Three shapes were considered for the button's home. Making
    the existing cover `<div>` interactive was rejected: it is deliberately a
    raw, `pointer-events: none` presentational node, and giving it hover, focus,
    and keyboard behaviour would turn it into a component in all but name —
    against the one-DOM-element-per-class rule, which says a sub-element needing
    its own behaviour is extracted into a `Component`. Adding the button to the
    `Table` rather than the header was rejected because the band is the
    header's own content box; a `Table` child would need the header's geometry
    re-derived at a second site. Adding it as a fourth `Row` child was rejected
    because a `Row` is a cell container, not a control host. What remains is a
    plain non-`Row` child of the header, which is what `ToolBar` does with its
    overflow trigger. This reasoning held even once the cover was removed
    (`## Implementation Notes`, deviation 3): the button absorbed the cover's
    *visual* responsibilities, but the cover itself was deleted rather than
    made interactive — the one-DOM-element-per-class rule was never
    revisited, only the number of elements needed to satisfy it.

[^no-menubutton]: `MenuButton` — a `Button` subclass that owns a `Menu` and
    opens it under itself — looks like a fit and is not one. It would have to
    be handed the item list, which is built by `Table.showColumnMenu` from
    `Table`'s own state (resolved columns, hidden set, filter-row flag, export
    flag, display mode). Either the header grows a dependency on all of that,
    or `Table` grows a second menu instance beside `_columnContextMenu` with a
    second disposal path. Firing the existing event keeps the menu's ownership
    exactly where it is and adds no state anywhere.

[^glyph-pin]: A flat, compact, glyph-only `Button` measures
    `glyph + MENU_BUTTON_CHROME_PX` per axis: 2px compact insets on each side
    (`BUTTON_COMPACT_INSETS_GLYPH`, [Button.ts:193](packages/lib/src/typescript/lib/component/button/Button.ts#L193))
    plus the 1px transparent frame `_applyFlatChrome` reserves on each side so
    the hover border does not shift the content — `6` total. The blank title
    contributes nothing: an empty `Text` reports a `0 × 0` preferred size
    ([Text.ts:365](packages/lib/src/typescript/lib/component/input/Text.ts#L365)),
    so the glyph alone drives both axes. Left unpinned, the glyph tracks the
    title's line height (~18px), giving a ~24px button — wider than the
    ~15-17px band, and `Button` clamps itself up to its content minimum, so
    the layout could not shrink it back down. Rather than a fixed pixel
    count, the pin is computed from the actual measured scrollbar width
    (`getScrollBarWidth() - MENU_BUTTON_CHROME_PX`) so the glyph fills
    whatever room the platform's native scrollbar actually leaves, instead of
    landing narrower than the button that now has to match it exactly
    (`## Implementation Notes`, deviation 3).

[^absolute-agreement]: `Component.doLayout` runs the container's layout
    manager, and `TableHeader` never sets one, so it gets the default
    `Absolute`. `Absolute.doLayout` calls `commitBounds` with
    `preferredSize ?? size ?? 0` for every child
    ([LayoutManager.ts:484](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L484)),
    and the header schedules a layout whenever a child is added or it is
    resized. The three `Row` children are immune because a `Row` has no
    explicit preferred size and its own default `Absolute` manager reports
    `null`, so the fallback returns the size the table layout committed. A
    `Button` derives a real preferred size from its content by default, so
    the two passes would fight unless something keeps them in agreement.

    `layout/Table.ts` calls `menuButton.setPreferredSize({ width: trackW,
    height: headerBox.height })` every pass, pinning *both* dimensions —
    an earlier revision pinned height alone and let width come from the
    button's natural glyph-derived size, which worked only because that
    natural size happened to be close to (but under) `trackW`; once the
    glyph pin itself became `trackW`-derived (deviation 3), pinning both
    dimensions explicitly is simpler than keeping the two computations in
    sync implicitly. This is safe specifically *because* `Button.
    setPreferredSize` permanently flips a `_consumerSetPreferredSize` flag
    that makes `recomputePreferredSize` a no-op from then on (see that
    method's doc comment) — the override sticks and nothing internal to
    `Button` (a theme change, a future `setGlyph`) can silently claw either
    dimension back down between layout passes. `commitBounds` itself never
    calls `setPreferredSize` — the rows don't need it, since their `null`
    preferred size already defers to whatever the table layout wrote. The
    button is the first case in this codebase where a layout manager does
    become the author of a grandchild's preferred size; it is accepted here
    as the direct, sanctioned consequence of a component whose desired
    footprint the component's own content can't derive.

[^always-on]: The reservation is unconditional by construction:
    `getAvailableColumnWidth` is `innerSize.width - getScrollBarWidth()` with no
    overflow test, and every consumer of it (column sizing, the resize drag, the
    button) inherits that. So the strip is empty and reserved even on a table
    short enough to need no vertical scrollbar, and a button that appeared and
    vanished with the scrollbar would be the odd one out — as well as needing an
    overflow signal the header does not have.

[^z-order]: The header's inner rows are Components at `z-index: 0` — an
    implicit stacking context — so a plain sibling with `z-index: auto`
    paints beneath them. `zIndex: 1` beats that. An earlier revision needed
    `2`: a separate cover `<div>` also hard-coded `z-index: 1` to beat the
    rows, was created lazily (so its element came *after* the button's in DOM
    order, winning any tie at equal z-index), and had to be beaten in turn.
    That cover is gone (`## Implementation Notes`, deviation 3), so beating
    the rows alone — `1` — is enough now. `Component`'s base default is `0`
    and is only written inline when non-zero, so nothing else in the header
    competes.

[^glyph-name]: `glyphs/solid/ellipsis_v.ts` and
    `glyphs/solid/ellipsis_vertical.ts` are two registry entries with different
    names and byte-identical `viewBox` and `path` data — there is no alias or
    re-export between them, so either name renders the same three dots. This
    plan picks `ellipsis-v` because it is the one the library itself already
    uses for an "opens a menu" affordance (`ToolBar`'s overflow trigger);
    `ellipsis-vertical` appears only in a demo panel. Following the library's
    own use keeps one glyph name for one meaning.

---

## Implementation Notes

Two deviations from the plan as originally written, both found and resolved
during implementation — before the plan's own audit step, via a live
browser check plus follow-up review of the running result:

1. **Bug: the plan's original `layout/Table.ts` code sample never made the
   glyph visible.** The original *Internal Structure* block committed the
   button's outer rect with raw `setX`/`setY`/`setWidth`/`setHeight` calls
   and stopped there — mirroring how `header`/`body`/`footer`/the three rows
   are positioned a few lines above. That mirror doesn't hold for a `Button`:
   the rows' cells are positioned by a separate explicit mechanism
   (`_cellGeom.apply`), never touching each row's own layout manager, while
   a button's glyph is positioned only by the button's *own* `doLayout()`
   running its internal `Fit` layout. Nothing in the original code ever
   called `menuButton.doLayout()`, so the button rendered with a correctly
   sized, correctly positioned outer box and a glyph that was sized (`8×8`,
   from `pinGlyphSize`) but never actually placed — no `left`/`top` ever
   committed on its element, so nothing painted. Offline, the original
   `HeaderMenuButton.test.ts` never caught this: its assertions covered the
   button's own outer geometry, ARIA, and click wiring, none of which
   exercise the glyph's committed position. The bug surfaced only once the
   feature was checked in a real browser, per this skill's browser-check
   requirement. Fixed by calling `menuButton.doLayout()` after committing
   its rect — the same "commit, then cascade" step
   `LayoutManager.commitBounds` performs for every other parent-positions-
   child relationship in this codebase — and by adding an offline regression
   test (`button.getGlyph()!.getY()` is a finite number, not `NaN`, after
   `table.doLayout()`) so a future regression fails offline instead of
   requiring a browser check to notice. See *The layout sizes the button to
   exactly fill the reservation band, on both axes* and the `[^absolute-
   agreement]` footnote.

2. **Design change: the button spans the full header band, not just the
   column-header row.** The plan as originally written confined the button
   to the column-header row's vertical span, pushed below the parent-header
   row when one is present. After seeing the shipped button live, the
   button was asked to instead span the *entire* header band — parent row
   and column row together — matching the scrollbar cover's own rect
   exactly on that axis. This changes `y` from `headerBox.y +
   parentRowHeight + …` to `headerBox.y`, and `height` from a
   `columnHeight`-derived, glyph-centred value to `headerBox.height`
   directly. Because the button's height is no longer something `Button`'s
   own content-derived preferred-size pipeline can produce, `layout/
   Table.ts` now calls `menuButton.setPreferredSize({ width, height:
   headerBox.height })` every pass — `Button.setPreferredSize` permanently
   opts the button out of its own auto-sizing pipeline once called, which is
   what keeps `TableHeader`'s `Absolute` layout manager from snapping the
   button's height back down to its glyph-derived square on a later
   header-level layout. This is a reversal of the original plan's rejection
   of exactly this lever (the original `[^absolute-agreement]` footnote
   called an explicit `setPreferredSize` override "a shape that appears
   nowhere in this codebase"); the footnote has been rewritten to record why
   that tradeoff changed. Verified live: the button's rect becomes pixel-
   identical to the cover's on the y/height axes (both `y:210, height:40` in
   the checked example) with no visible doubling or seam, since the button
   is transparent at rest and paints above the cover only via its glyph and
   (on hover/focus) its own chrome.

3. **Design change: the cover `<div>` is removed; the button widens to
   exactly fill the reservation band and absorbs the cover's visual role.**
   After deviation 2 landed, the button's rect matched the cover's on the
   y/height axes but was still narrower and centred on x/width — a flat,
   compact `Button` measures `glyph + 6`, and the `8`px glyph pin from the
   original design gave a `14`px button centred inside the cover's `15`px
   band, with the transparent-at-rest button relying entirely on the opaque
   cover underneath for the header-gradient background and the column-cell
   left divider. Live review asked whether the cover was still needed, given
   the button already fully overlapped it. It wasn't, functionally: grepping
   the repo confirmed `getScrollbarCover()` had no consumer besides
   `layout/Table.ts` and its own two tests in
   `content-box-containment.test.ts` — but the method is a stable, public
   part of the API surface, shipped in the already-released v0.4.0, so
   removing it is a genuine (if narrow) breaking change, not a pure internal
   simplification. Asked directly, the answer was to remove it anyway and
   accept the breaking-change cost, in exchange for one fewer DOM node and a
   bigger, less cramped glyph.

   Three changes followed:

   - **The glyph pin is now computed, not a fixed literal.** `MENU_BUTTON_
     GLYPH_PX = 8` is replaced by `MENU_BUTTON_CHROME_PX = 6` (the fixed
     per-side chrome overhead) and a per-`TableHeader` computation,
     `Math.max(1, DOM.source.getScrollBarWidth() - MENU_BUTTON_CHROME_PX)`,
     run once in the constructor. `getScrollBarWidth()` is memoized after
     its first call in the process, so this costs nothing beyond the first
     `TableHeader` built. On the offline harness's pinned `15`px scrollbar
     width this yields a `9`px glyph (was a fixed `8`px) — one pixel bigger,
     matching how much wider the button itself became.
   - **The button gets its own permanent background and left divider.**
     `setBackgroundColor`/`setBackgroundImage(TABLE_HEADER_BG)`, called once
     after construction, persist through every later theme change: `flat`
     chrome's own background handling (`_applyFlatChrome`) only touches the
     *resting* background once, during the `super()` cascade, before these
     calls run, and nothing afterward re-invokes it (a theme change re-runs
     `_rebuildContentRow`/`recomputePreferredSize` via `Button._onThemeChange`,
     neither of which touches background, border, or shadow). The left
     divider is an inset shadow — `setShadow("inset 1px 0 0 0 var(--ts-ui-
     table-resize-handle-color, …)")`, the same technique
     `ParentHeaderCell` uses for its own dividers — rather than `setBorder`,
     because flat chrome already reserves a 1px transparent border on every
     side (`_applyFlatChrome`'s `"1px solid transparent"`) to keep the
     hover/pressed frame from shifting the centred glyph, and `setBorder`
     replaces the whole `BorderOptions` bag rather than patching one side —
     doing that would have discarded the transparent frame's *other* three
     sides from `Button`'s own tracked border state (even though the
     already-applied inline styles for those sides happen to survive in the
     DOM untouched, since `setElementCSSRules` only writes the keys it's
     given). A `setShadow` call touches a completely different CSS property
     and state slot, so it can't collide with `flat`'s border management at
     all.
   - **The layout no longer reads the button's own preferred width; it
     writes `trackW` directly.** `buttonWidth = menuButton.getPreferredSize()
     ?.width ?? trackW` and the centring offset `Math.floor((trackW -
     buttonSize.width) / 2)` are both gone — now that the glyph pin makes the
     button's natural width equal `trackW` by construction, and the layout
     unconditionally overrides *both* dimensions via `setPreferredSize`
     every pass regardless (see the rewritten `[^absolute-agreement]`
     footnote), reading the "natural" width back was already redundant; it
     is simpler to just always write `trackW`.

   The two `content-box-containment.test.ts` tests covering the cover's own
   border/padding-offset geometry (`getScrollbarCover()` no longer exists to
   test) were replaced with two equivalent tests in `HeaderMenuButton.test.ts`
   asserting the same regression class — a header border shrinking the
   content box, and header padding offsetting its origin — against
   `button.getX()`/`getY()`/`getWidth()`/`getHeight()` directly, computed
   from `header.getContentBounds()` rather than copied as literals from the
   old test's specific column setup. The two tests asserting the button fit
   *inside* the band (`getWidth() <= trackW`, `getX() >=` the band's left
   edge) were tightened to exact equality, since "fits inside" was a weaker
   invariant than what the button actually guarantees now. Verified live:
   the button measures `15`px wide (was `14`), the cover `<div>` no longer
   exists in the DOM, the glyph is visibly bigger, the left divider still
   renders via the inset shadow, and the column-menu still opens in the same
   place on click. Full offline suite (300 files, 4786 tests) and typecheck
   both pass unchanged.
