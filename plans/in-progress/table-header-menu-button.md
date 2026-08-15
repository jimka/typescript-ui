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

The strip already exists. `TableHeader.getScrollbarCover()`
([Header.ts:504](packages/lib/src/typescript/lib/component/table/Header.ts#L504))
creates a raw `<div>` — the cover — that masks the vertical-scrollbar
reservation band so the header gradient stays continuous, and
[layout/Table.ts:269](packages/lib/src/typescript/lib/layout/Table.ts#L269)
positions it on every pass. The new button is placed in that same band, over
the column-header row, and paints on top of the cover.

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

### The button is a flat, compact, glyph-only `Button` with a pinned glyph

Options: `flat: true`, `compact: true`, `glyph: "ellipsis-v"`,
`text: "Column options"`, `showText: false`. `Button` renders the title blank
while keeping it alive as the hover tooltip and the reflected `aria-label`
([Button.ts:1053](packages/lib/src/typescript/lib/component/button/Button.ts#L1053)).
`getAria().setHasPopup("menu")` is set imperatively, as `ToolBar` does.

The glyph box is pinned with `pinGlyphSize(MENU_BUTTON_GLYPH_PX)`, value `8`,
because the button has to fit inside the scrollbar reservation band. A button
in this configuration measures `glyph + 6` per axis — 2px of compact inset and
1px of transparent frame on each side — so a pinned `8` gives a 14px button
inside a 15px band.[^glyph-pin]

`pinGlyphSize` — not `getGlyph().setPreferredSize(...)` — is the correct lever.
It sets the authoritative opt-out flag, so a later theme change cannot re-track
the glyph to the (blank) title's line height and grow it
([Button.ts:1438](packages/lib/src/typescript/lib/component/button/Button.ts#L1438)).
`SpinButton` pins its chevron to the same `8` for the same reason
([SpinButton.ts:110](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L110)).

### The layout writes the button's rect at its own preferred size

`layout/Table.doLayout` centres the button in the reservation band, over the
column-header row, and sizes it to `button.getPreferredSize()`.

Sizing it to anything else would be undone. `TableHeader` uses the default
`Absolute` layout manager
([Absolute.ts:40](packages/lib/src/typescript/lib/layout/Absolute.ts#L40)),
which re-commits every child at `preferredSize ?? size` whenever the
header lays out. The rows survive that because they report a `null` preferred
size, so `Absolute` falls back to their committed size; a `Button` reports a
real one. Writing the same numbers the header's own manager would write keeps
the two passes in agreement.[^absolute-agreement]

Worked example, using the values the offline test harness pins (native
scrollbar width `15`, a 400×300 table whose header content box is `398 × 20`
with no parent row):

| Value | Expression | Result |
|---|---|---|
| band left edge | `headerBox.x + headerBox.width - trackW` | `0 + 398 - 15` = `383` |
| button size | `getPreferredSize()` (glyph `8` + perimeter `6`) | `14 × 14` |
| button `x` | band left `+ floor((trackW - w) / 2)` | `383 + 0` = `383` |
| button `y` | `headerBox.y + parentRowHeight + floor((columnHeight - h) / 2)` | `0 + 0 + 3` = `3` |

The button therefore spans x `383…397` inside a header content box ending at
`398`, and y `3…17` inside a 20px column-header row.

### The button is always present, exactly like the cover

No visibility condition. The band the button sits in is reserved
unconditionally: `Table.getAvailableColumnWidth`
([Table.ts:773](packages/lib/src/typescript/lib/component/table/Table.ts#L773))
subtracts the scrollbar width from the columns' space whether or not the body
actually overflows, and the cover is positioned on every pass the header block
runs. Making the button conditional would put it out of step with the strip it
lives in.[^always-on]

### The button paints above the cover at `zIndex: 2`

The cover hard-codes `z-index: 1` so it paints above the header's inner rows.
The cover is appended to the header element on the first layout pass, which is
*after* the button's element, so an equal z-index would let the cover paint
over the button. `zIndex: 2` puts the button above both.[^z-order]

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

---

## Internal Structure

Module scope in `Header.ts`:

```typescript
Glyph.register(ellipsis_v);

const MENU_BUTTON_GLYPH:    string = "ellipsis-v";
const MENU_BUTTON_LABEL:    string = "Column options";
const MENU_BUTTON_GLYPH_PX: number = 8;
const MENU_BUTTON_Z_INDEX:  number = 2;
```

Fields and constructor wiring (the bound-listener field mirrors the existing
`_boundOnStoreFilterChange` at
[Header.ts:127](packages/lib/src/typescript/lib/component/table/Header.ts#L127)):

```typescript
private _menuButton: Button;
private _boundOnMenuButtonAction: () => void = () => this.onMenuButtonAction();

// …in the constructor body, after the three rows are added:
this._menuButton = new Button({
    glyph:     MENU_BUTTON_GLYPH,
    text:      MENU_BUTTON_LABEL,
    showText:  false,
    flat:      true,
    compact:   true,
    zIndex:    MENU_BUTTON_Z_INDEX,
    listeners: { action: this._boundOnMenuButtonAction },
});
this._menuButton.pinGlyphSize(MENU_BUTTON_GLYPH_PX);
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

Placement in `layout/Table.doLayout`, immediately after the existing cover
write and inside the same `if (container.isHeaderVisible() …)` block:

```typescript
const menuButton = header.getMenuButton();
const buttonSize = menuButton.getPreferredSize() ?? { width: trackW, height: columnHeight };

menuButton.setAutoCommitStyle(false);
menuButton.setX(headerBox.x + headerBox.width - trackW + Math.floor((trackW - buttonSize.width) / 2));
menuButton.setY(headerBox.y + parentRowHeight + Math.floor((columnHeight - buttonSize.height) / 2));
menuButton.setWidth(buttonSize.width);
menuButton.setHeight(buttonSize.height);
menuButton.setAutoCommitStyle(true);
```

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
   still inside the header `if`. Reuse the already-computed `trackW`,
   `headerBox`, `parentRowHeight`, and `columnHeight` — do not recompute any of
   them. Do not touch the cover write. Check: `npm run typecheck` passes.

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
5. **The button sits inside the column-header row's vertical span.** With
   `columnRow = header.getComponents()[1]`:
   `button.getY() >= columnRow.getY()` and
   `button.getY() + button.getHeight() <= columnRow.getY() + columnRow.getHeight()`.
6. **A parent-header row pushes it down.** On a table whose columns declare
   `group` (so `hasParentRow()` is true), case 5 still holds — the button
   tracks the column row, not the top of the band.
7. **A header-level layout does not move or resize it.** Snapshot
   `{x, y, width, height}` after `table.doLayout()`, call `header.doLayout()`,
   and assert the rect is identical. This pins the agreement with the header's
   own `Absolute` manager.
8. **Clicking emits the table-wide context-menu event.** With a listener on
   `header.on("columncontextmenu", fn)`, dispatching a click on the button
   calls it once with `("", rect.left, rect.bottom)` where
   `rect = DOM.source.getViewportRect(button)` — field name empty, coordinates
   from the button's rect, not from the event.
9. **Accessible name and popup role.**
   `button.getAria().getLabel() === "Column options"` and the button reports
   `aria-haspopup="menu"`.

Manual verification only (needs a real browser — see *Verification*):

10. The button is visible in the gutter above the vertical scrollbar, aligned
    with the column headers, and its glyph is neither clipped by the button's
    own bounds nor bleeding over the last column or the header's right edge.
11. Hovering shows the flat hover frame and the "Column options" tooltip.
12. Clicking opens the same menu a right-click on a header cell opens, in the
    same position relative to the button.
13. Tabbing to the button and pressing Enter opens the menu under the button
    (not at the top-left of the window).
14. Scrolling the table horizontally does not move the button, and header cells
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
  2px of ink width. Behaviour 10 is the gate; if it reads as a smudge rather
  than three dots, raise the pin as far as the band allows and re-check.
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
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) —
  `showColumnMenu` (L1647) and its listener (L304); read only, do not edit.
- [`packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts`](packages/lib/src/typescript/lib/component/table/cell/renderer/Filter.ts) —
  the other in-table glyph-only button, for the `flat` + `compact` +
  `showText: false` combination.
- [`packages/lib/tests/component/container/CollapseButton.test.ts`](packages/lib/tests/component/container/CollapseButton.test.ts) —
  the offline click-dispatch idiom and its ordering constraint.
- [`packages/lib/tests/component/content-box-containment.test.ts:1599`](packages/lib/tests/component/content-box-containment.test.ts#L1599) —
  the existing cover-geometry tests, which must keep passing untouched.

---

## Non-Goals

- **No change to the menu itself.** `showColumnMenu`, `buildColumnMenuItems`,
  and the column dialog are untouched; the button opens whatever the right-click
  path opens.
- **No change to the scrollbar cover.** Its styling, its lazy creation, and its
  geometry write stay exactly as they are, along with the tests covering them.
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
    overflow trigger.

[^no-menubutton]: `MenuButton` — a `Button` subclass that owns a `Menu` and
    opens it under itself — looks like a fit and is not one. It would have to
    be handed the item list, which is built by `Table.showColumnMenu` from
    `Table`'s own state (resolved columns, hidden set, filter-row flag, export
    flag, display mode). Either the header grows a dependency on all of that,
    or `Table` grows a second menu instance beside `_columnContextMenu` with a
    second disposal path. Firing the existing event keeps the menu's ownership
    exactly where it is and adds no state anywhere.

[^glyph-pin]: A flat, compact, glyph-only `Button` measures `glyph + 6` per
    axis: 2px compact insets on each side
    (`BUTTON_COMPACT_INSETS_GLYPH`, [Button.ts:193](packages/lib/src/typescript/lib/component/button/Button.ts#L193))
    plus the 1px transparent frame `_applyFlatChrome` reserves on each side so
    the hover border does not shift the content. The blank title contributes
    nothing: an empty `Text` reports a `0 × 0` preferred size
    ([Text.ts:365](packages/lib/src/typescript/lib/component/input/Text.ts#L365)),
    so the glyph alone drives both axes. Left unpinned, the glyph tracks the
    title's line height (~18px), giving a ~24px button — far wider than the
    ~15px band, and `Button` clamps itself up to its content minimum, so the
    layout could not shrink it. `8` gives a 14px button inside a 15px band and
    matches the value `SpinButton` already uses for a chevron in an 11px cell.

[^absolute-agreement]: `Component.doLayout` runs the container's layout
    manager, and `TableHeader` never sets one, so it gets the default
    `Absolute`. `Absolute.doLayout` calls `commitBounds` with
    `preferredSize ?? size ?? 0` for every child
    ([LayoutManager.ts:484](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L484)),
    and the header schedules a layout whenever a child is added or it is
    resized. The three `Row` children are immune because a `Row` has no
    explicit preferred size and its own default `Absolute` manager reports
    `null`, so the fallback returns the size the table layout committed. A
    `Button` derives a real preferred size from its content, so the two passes
    would fight unless the table layout writes that same size — which is what
    the plan does. Pushing an explicit `setPreferredSize` from the layout
    manager on each pass was the alternative; it would let the button fill the
    whole band, but it makes a layout manager the author of a grandchild's
    preferred size, a shape that appears nowhere in this codebase.

[^always-on]: The reservation is unconditional by construction:
    `getAvailableColumnWidth` is `innerSize.width - getScrollBarWidth()` with no
    overflow test, and every consumer of it (column sizing, the resize drag, the
    cover) inherits that. So the strip is empty and reserved even on a table
    short enough to need no vertical scrollbar, and a button that appeared and
    vanished with the scrollbar would be the odd one out — as well as needing an
    overflow signal the header does not have.

[^z-order]: The cover's own comment records that it needs `z-index: 1` to paint
    above the header's inner rows. The button cannot simply match it: element
    order breaks ties between equal z-indexes, the cover is created lazily on
    the first layout pass, and the button's element is created when the header
    renders — so the cover is the *later* sibling and would win the tie. `2`
    settles it in one number. `Component`'s base default is `0` and is only
    written inline when non-zero, so nothing else in the header competes.

[^glyph-name]: `glyphs/solid/ellipsis_v.ts` and
    `glyphs/solid/ellipsis_vertical.ts` are two registry entries with different
    names and byte-identical `viewBox` and `path` data — there is no alias or
    re-export between them, so either name renders the same three dots. This
    plan picks `ellipsis-v` because it is the one the library itself already
    uses for an "opens a menu" affordance (`ToolBar`'s overflow trigger);
    `ellipsis-vertical` appears only in a demo panel. Following the library's
    own use keeps one glyph name for one meaning.
