---
touches-shared: [packages/lib/src/typescript/lib/overlay/Menu.ts]
---

# Menu Overlay Scrollbar — Implementation Plan

## Overview

[`Menu`](packages/lib/src/typescript/lib/overlay/Menu.ts#L90) scrolls an over-tall item list with plain browser overflow: [`enableVerticalScroll`](packages/lib/src/typescript/lib/overlay/Menu.ts#L919) writes `overflow-x: hidden` / `overflow-y: auto` onto the menu's own element and flips the `VBox`'s vertical overflow flag. The user sees the OS scrollbar rather than the framework's own [`Scrollbar`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L519) widget, which every other scrolling surface in the library shows.

This plan moves the item list into a nested `Panel` configured with `autoScroll: "y"`. `Panel` already owns the whole overlay-scrollbar mechanism — an inner clip element, a hidden native bar, a synced `Scrollbar`, and a reserved gutter that shrinks `getInnerSize` so children never lay out under the bar. Nesting a scrolling `Panel` as a region inside another component is established practice here, and [`PopupPanel`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L59)'s own JSDoc already prescribes it — naming `Menu` as it does so — as the fix for a floating panel whose content outgrows its clamped height.

`Menu` keeps every placement decision it makes today. Its own layout manager becomes `Fit` over the one nested panel; the rows move from `Menu` to the panel; the hand-rolled native-scrollbar gutter [`showAnchored` reserves](packages/lib/src/typescript/lib/overlay/Menu.ts#L374) is replaced by a single width rule applied on all three placement paths — including persistent-mode `open()`, which reserves nothing today.

---

## Architecture Decisions

### The item list moves into a nested `Panel` with `autoScroll: "y"`

`Menu` gains one child — a `Panel` built with `{ layoutManager: new VBox({ spacing: 0, stretching: true }), autoScroll: "y", scrollShadows: false, insets: new Insets(4, 0, 4, 0) }` — and lays it out with `Fit`. Every `MenuRow` is added to that panel instead of to `Menu`.[^nested-panel]

[`PopupPanel:59`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L59) states the rule this follows in the codebase's own words: a floating panel whose content routinely overflows should "wrap its content in a `Panel({ autoScroll: "y" })` under a `Fit` layout, whose own gutter machinery insets correctly."

Three components already do exactly that. [`PickerCellList`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L87) is the scrollable cell column inside [`TimePickerDropdown`](packages/lib/src/typescript/lib/component/input/TimePickerDropdown.ts#L63) and `AbstractCalendarDropdown` — floating overlays built on `AnimatedDropdown`, which like `Menu` is a `Component` implementing `DismissableLayer`. [`AbstractSelectableList`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L831) nests one under a `Fit` root, which is the exact shape used here. [`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L707) nests one for its body region.

### `Menu` widens itself by the track width instead of insetting a gutter

The panel reserves the scrollbar's own 12-pixel band internally. `Menu` compensates by widening its committed width by the same 12 pixels when — and only when — the item list will overflow the room at its anchor, so the row content area stays the width `layOutColumns` measured its columns against.[^widen-not-inset]

A single private `applyScrollbarGutterWidth(overflows)` owns that rule and is called from all three placement paths. The `setInsets(new Insets(4, gutter, 4, 0))` write in `showAnchored` is deleted.

### Persistent-mode `open()` gains the same width rule

`open()` reserves nothing today, so a `MenuBar` dropdown taller than the room below its button lays its items under the scrollbar. Both of its branches — the top-level dropdown and the submenu path through `placeVertically` — now call `applyScrollbarGutterWidth` before resolving the horizontal position.[^persistent-gap]

### `Menu`'s own insets move onto the panel

`applyPersistentChrome` and `applyRebuildChrome` stop calling `setInsets`; `Menu` keeps `Component`'s zero-inset default, and the `Insets(4, 0, 4, 0)` moves onto the item panel. The 4-pixel top and bottom bands stay inside the scrolled region exactly as they are today.[^insets-on-panel]

### No new scroll machinery is written

Nothing in `Menu` constructs a `Scrollbar`, listens for a native `"scroll"`, or measures scroll metrics. `Panel` does all of it. `enableVerticalScroll` is deleted outright — `Panel.setAutoScroll("y")` writes the same overflow pair and the same `setOverflowing(false, true)` flag onto the panel's `VBox`.[^no-helper]

---

## Internal Structure

### New state and the one width rule

```typescript
// Assigned in the constructor body, after super() returns. Menu overrides no
// applyOptions, so no `declare` is needed (CODE_CONVENTIONS.md, super() cascade).
private readonly _itemPanel: Panel;

// The content-fit border-box width from layOutColumns(), before any scrollbar
// widening. Cached because a reused menu must widen from its un-widened width,
// not from whatever the previous open left committed.
private _contentFitWidth: number = 0;
```

```typescript
/**
 * Commits the panel width for this open: the content-fit width (or the
 * explicit `setMenuWidth` override), plus the overlay scrollbar's track when
 * the item list will not fit the room at this anchor. The item panel reserves
 * that same track internally, so the extra width lands on the scrollbar band
 * and the rows keep the content width `layOutColumns` measured them against.
 *
 * @param overflows - Whether the content height exceeds the available room.
 */
private applyScrollbarGutterWidth(overflows: boolean): void {
    const base = this._menuWidth ?? this._contentFitWidth;

    this.setWidth(base + (overflows ? TRACK_WIDTH : 0));
}
```

`TRACK_WIDTH` is imported from `~/component/container/Scrollbar.js`, the same internal import [`component/table/Table.ts:20`](packages/lib/src/typescript/lib/component/table/Table.ts#L20) and [`layout/Table.ts:11`](packages/lib/src/typescript/lib/layout/Table.ts#L11) already use.

### Worked width cases

`layOutColumns()` returns a border-box width — the measured content width plus `Menu`'s own 1px left and right border. The item panel sits in `Menu`'s content box with zero left/right insets, and `Panel.getInnerSize` subtracts the reserved track once a bar is showing.

| Case | `layOutColumns()` | `setMenuWidth` | Overflows | `menu.getWidth()` | Row width |
|---|---|---|---|---|---|
| Fits the room at the anchor | 200 | — | no | 200 | 198 |
| Taller than the room at the anchor | 200 | — | yes | 212 | 198 |
| Explicit width, still overflows | 200 | 300 | yes | 312 | 298 |

Keeping the row width identical between rows 1 and 2 is the point of widening rather than insetting.

### Constructor shape

```typescript
this.setLayoutManager(new Fit());

this._itemPanel = new Panel({
    layoutManager: new VBox({ spacing: 0, stretching: true }),
    autoScroll:    "y",
    scrollShadows: false,
    insets:        new Insets(4, 0, 4, 0),
});

this.addComponent(this._itemPanel);
```

`Fit` throws when its container holds more than one child, so a `MenuRow` accidentally left on `this.addComponent(...)` fails loudly rather than silently mis-rendering.

---

## Ordered Implementation Steps

Work test-first: step 1 writes the failing cases, steps 2–11 make them pass.

Line anchors below are against commit `7cd3fa33`. `Menu.ts` had uncommitted edits in flight when this plan was written, so locate every edit by the quoted code, not by line number, and re-read the surrounding method if it has moved.

1. **Rewrite the scroll coverage in [`packages/lib/tests/overlay/Menu.test.ts`](packages/lib/tests/overlay/Menu.test.ts).** Replace the `Menu vertical-scroll scrollbar gutter` block ([L904](packages/lib/tests/overlay/Menu.test.ts#L904)) and the flipped-side case inside `Menu rect-anchored toggleFor` ([L1038](packages/lib/tests/overlay/Menu.test.ts#L1038)) with the cases in *Expected Behaviour → Offline*. Import `TRACK_WIDTH` from `~/component/container/Scrollbar` and drop every `DOM.source.getScrollBarWidth()` and `getInsets().getRight()` assertion about the gutter. Reach the item panel through the public `menu.getComponents()[0]` (cast to `_Panel`), never a private field.
   *Check:* `npm test -- Menu` — the new cases fail, the rest of the file still passes.

2. **`Menu.ts` — imports and fields.** Add `import { Panel } from "~/core/Panel.js";`, `import { Fit } from "~/layout/Fit.js";`, and `import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";`. Add the `_itemPanel` and `_contentFitWidth` fields from *Internal Structure* beside the existing private fields ([L126–L149](packages/lib/src/typescript/lib/overlay/Menu.ts#L126)).

3. **`Menu.ts` — constructor.** In the constructor, replace the `const vbox = new VBox(); … this.setLayoutManager(vbox);` block ([L176–L181](packages/lib/src/typescript/lib/overlay/Menu.ts#L176)) with the *Internal Structure → Constructor shape* block. Keep the existing `applyPersistentChrome` / `applyRebuildChrome` / `buildPersistentItems` calls after it, unchanged in order.

4. **`Menu.ts` — delete `enableVerticalScroll`.** Remove the method ([L919](packages/lib/src/typescript/lib/overlay/Menu.ts#L919)) and both of its call sites in `applyPersistentChrome` ([L893](packages/lib/src/typescript/lib/overlay/Menu.ts#L893)) and `applyRebuildChrome` ([L907](packages/lib/src/typescript/lib/overlay/Menu.ts#L907)). In the same two methods, delete the `this.setInsets(new Insets(4, 0, 4, 0));` line ([L888](packages/lib/src/typescript/lib/overlay/Menu.ts#L888) and [L902](packages/lib/src/typescript/lib/overlay/Menu.ts#L902)) — `Component` defaults to zero insets and the panel now carries the 4px bands.
   *Check:* `grep -n 'setOverflowY\|setOverflowX\|enableVerticalScroll' packages/lib/src/typescript/lib/overlay/Menu.ts` — expect zero matches. (`getScrollBarWidth` survives until step 7.)

5. **`Menu.ts` — add `applyScrollbarGutterWidth`.** Add the private method from *Internal Structure*, placed next to `applyViewportHeightClamp` ([L939](packages/lib/src/typescript/lib/overlay/Menu.ts#L939)).

6. **`Menu.ts` — route the rows to the panel.** In `showAnchored` ([L307](packages/lib/src/typescript/lib/overlay/Menu.ts#L307)) change `this.disposeAllComponents()` to `this._itemPanel.disposeAllComponents()` and `this.addComponent(row)` to `this._itemPanel.addComponent(row)`. Make the same two changes in `rebuildPersistentItems` ([L976](packages/lib/src/typescript/lib/overlay/Menu.ts#L976)) and `buildPersistentItems` ([L991](packages/lib/src/typescript/lib/overlay/Menu.ts#L991)). Leave `this.pauseLayout()` / `this.resumeLayout()` on `Menu` — `resumeLayout` runs `Menu.doLayout()`, which recurses into the panel.

7. **`Menu.ts` — `showAnchored`'s width and gutter.** Replace lines [L348–L351](packages/lib/src/typescript/lib/overlay/Menu.ts#L348) with:
   ```typescript
   this._contentFitWidth = this.layOutColumns();

   const naturalWidth = this._menuWidth ?? this._contentFitWidth;

   this.setWidth(naturalWidth);
   ```
   Then replace the gutter block at [L374–L382](packages/lib/src/typescript/lib/overlay/Menu.ts#L374) (its comment, the `const gutter = …` line, the `setInsets` call and the `setWidth` call) with a single `this.applyScrollbarGutterWidth(totalHeight > available);`. Everything else in the method — the `available` first pass, the `placement` second pass, `applyViewportHeightClamp`, the fade and layer registration — stays exactly as it is.

8. **`Menu.ts` — `buildPersistentItems` caches the width.** Change the closing `this.setWidth(this.layOutColumns());` ([L1029](packages/lib/src/typescript/lib/overlay/Menu.ts#L1029)) to:
   ```typescript
   this._contentFitWidth = this.layOutColumns();

   this.setWidth(this._contentFitWidth);
   ```

9. **`Menu.ts` — `open()` and `placeVertically`.** In `placeVertically` ([L960](packages/lib/src/typescript/lib/overlay/Menu.ts#L960)) insert `this.applyScrollbarGutterWidth(totalHeight > available);` immediately before the existing `this.applyViewportHeightClamp(available, totalHeight);`. In `open()` ([L592](packages/lib/src/typescript/lib/overlay/Menu.ts#L592)):
   - change `const width = this.getWidth();` ([L608](packages/lib/src/typescript/lib/overlay/Menu.ts#L608)) to `const width = this._contentFitWidth;` — a reused menu must measure from its un-widened width;
   - in the **submenu** branch, move the `placeVertically` call *above* the `positionAdjacent` call and pass `this.getWidth()` (not `width`) to `positionAdjacent`, so the horizontal placement sees the just-widened panel;
   - in the **top-level** branch, split the single `positionAnchoredFlexible` call into the same two passes `showAnchored` uses:
     ```typescript
     const available = positionAnchoredFlexible(anchorRect, { width, height: totalHeight }, vp, VIEWPORT_MARGIN).available;

     this.applyScrollbarGutterWidth(totalHeight > available);

     const placement = positionAnchoredFlexible(anchorRect, { width: this.getWidth(), height: totalHeight }, vp, VIEWPORT_MARGIN);

     this.applyViewportHeightClamp(placement.available, totalHeight);
     ```

10. **`Menu.ts` — scroll-to-bottom routes to the panel.** In `showAnchored`'s `_scrollToBottomOnShow` block ([L409–L412](packages/lib/src/typescript/lib/overlay/Menu.ts#L409)) change `this.setScrollTop(this.getMaxScrollTop())` to `this._itemPanel.setScrollTop(this._itemPanel.getMaxScrollTop())`. Keep the `this.flushLayout()` call ahead of it.
    *Check:* `grep -n 'this\.setScrollTop\|this\.getMaxScrollTop' packages/lib/src/typescript/lib/overlay/Menu.ts` — expect zero matches.

11. **`Menu.ts` — JSDoc.** Update the class-level and `applyViewportHeightClamp` comments that describe native overflow so they name the nested scrolling panel instead. Delete the stale reference to `Panel.setAutoScroll` that lived in `enableVerticalScroll`'s doc comment. Do not `{@link}` `Panel` from `Menu`'s public JSDoc beyond the existing rendered-link form already used in the file.

12. **Update the item-teardown coverage.** In `Menu item teardown — disposes every replaced item, separators included` ([L1378](packages/lib/tests/overlay/Menu.test.ts#L1378)) and `Menu custom rows` ([L1466](packages/lib/tests/overlay/Menu.test.ts#L1466)), re-point any assertion that counts or reads `menu.getComponents()` at the item panel's children. Add the structural assertion that `menu.getComponents().length === 1`.
    *Check:* `npm test -- Menu` — green.

13. **Run the neighbouring menu suites.** `npm test -- MenuBar MenuButton MenuRow ColumnVisibilityMenu BodyContextMenu TabBar.contextMenu Split.gutterMenu AbstractWindow.windowMenu` — all green with no edits. Any failure here is a real regression in row routing, not a test to relax.

14. **Docs.** In [`packages/lib/docs/components/Menu.md`](packages/lib/docs/components/Menu.md#L102), amend the scrolling bullet to say the menu shows the framework's own scrollbar (not the OS one) and reserves its track width so no item renders beneath it.
    *Check:* `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/docs/components/Menu.md` |

---

## Expected Behaviour

### Offline (unit-testable)

The recording sink models geometry but has no real layout, so overflow is an injected input: `setScrollExtent(handle, extent)` from [`tests/dom/TestDOM.ts:1613`](packages/lib/tests/dom/TestDOM.ts#L1613), or `vi.spyOn(DOM.source, 'getScrollMetrics')` as [`tests/core/PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts) does.

1. **Structure** — a `Menu` has exactly one child; it is a `Panel` reporting `getAutoScroll() === "y"`, `getScrollbarStyle() === "overlay"`, `getScrollShadows() === false`, and insets `(4, 0, 4, 0)`.
2. **Menu's own insets are zero** — `menu.getInsets().getTop()` and `.getRight()` are both `0`, in both modes.
3. **Rows live on the panel** — after `show(10, 10, configs)` with five items, `menu.getComponents().length === 1` and the item panel holds five children.
4. **No widening when it fits** — ten items shown in the 800px-tall viewport commit a width with no scrollbar allowance. Call that width `naturalWidth`; cases 5–10 measure against it.
5. **Widening when it overflows** — the same ten items shown in a 120px-tall viewport commit `getWidth() === naturalWidth + TRACK_WIDTH`.
6. **Reused menu, fit → scroll** — one instance shown with three items in a 120px viewport commits its fitting width; reshown with all ten items it commits `naturalWidth + TRACK_WIDTH` and a taller height.
7. **Reused menu, scroll → fit** — the reverse of case 6 drops back to the un-widened width; the widening is never sticky.
8. **`setMenuWidth` override still wins** — `setMenuWidth(300)` then an overflowing `show()` commits `300 + TRACK_WIDTH`.
9. **Flipped side** — `toggleFor` against a trigger flush at the viewport bottom with 60 items widens by `TRACK_WIDTH`, because `available` came from the room *above*.
10. **Persistent top-level `open()`** — a `Menu` built with 40 items and opened against an anchor in a 200px-tall viewport commits `naturalWidth + TRACK_WIDTH`; the same instance opened in the 800px viewport commits `naturalWidth`.
11. **`placeVertically` widens too** — driven directly through the test file's existing bracket-access helper ([L55](packages/lib/tests/overlay/Menu.test.ts#L55)), a call whose `totalHeight` exceeds the room it resolves leaves the menu `TRACK_WIDTH` wider; a call whose content fits leaves the width untouched. This is the submenu path.
12. **Height clamp is unchanged** — `placeVertically`'s three existing cases still return the same top coordinate and set the same `getMaxSize().height`.
13. **Row content width** — with `getScrollMetrics` stubbed so the panel's scroll element overflows vertically, one layout pass leaves `itemPanel.getInnerSize()!.width === menu.getWidth() - MENU_BORDER_PX - TRACK_WIDTH` (`MENU_BORDER_PX` is the test file's existing constant for `Menu`'s own left+right border), i.e. the natural content width.
14. **Scrollbar is inside the dismiss subtree** — `DOM.source.contains(menu.getLayerElement()!, itemPanel.getElement()!)` is `true`, so a `pointerdown` anywhere in the scroll region — the scrollbar included — counts as inside the layer and `LayerManager` does not dismiss the menu.
15. **Scroll-to-bottom** — `setScrollToBottomOnShow(true)` followed by an overflowing `show()` throws nothing and leaves `itemPanel.getScrollTop()` a number.
16. **Teardown** — a second `show()` disposes every row from the first, separators and custom rows included, and leaves the item panel alive and still the menu's only child.

### Manual verification in the browser

`npm run dev` (app on `localhost:8015`; start a second server on a spare port if one is already running).

- **Rebuild mode** — MiscPanel's *"Right-click for a tall (scrolling) menu"* button. The menu shows the framework scrollbar, not the OS one. Item text is not clipped and does not run under the bar. The wheel scrolls it; dragging the thumb scrolls it and **does not close the menu**; clicking the track pages. Right-click near the viewport bottom: the menu still flips so its bottom ends at the cursor, and still scrolls.
- **Persistent mode** — MenuBarPanel, with the browser window (or a DevTools device emulation) shrunk to roughly 180px tall. Open the *View* menu: it clamps, shows the framework scrollbar, and its items keep clear of the bar. Hover *Export* in the *File* menu at that size and confirm the submenu still lands flush beside the parent panel.
- **Non-overflowing menus take no extra width** — at full window height, the *File* and *Edit* dropdowns are the same width as before this change and show no scrollbar.
- **Keyboard** — arrow keys still move the highlight through the items and Escape still closes. (The highlight does not scroll into view; that is unchanged — see *Non-Goals*.)
- **Submenu chain** — activating a submenu leaf still closes the whole chain.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — full suite green, in particular `tests/overlay/Menu.test.ts`, `tests/component/menubar/*`, `tests/component/MenuButton.test.ts`, `tests/component/table/ColumnVisibilityMenu.test.ts`, `tests/core/BodyContextMenu.test.ts`, `tests/component/container/TabBar.contextMenu.test.ts`, `tests/component/layout/Split.gutterMenu.test.ts` and `tests/overlay/AbstractWindow.windowMenu.test.ts`.
- `npm run lint` — clean, in particular `local/no-raw-dom` over `Menu.ts`.
- `grep -n 'getScrollBarWidth\|setOverflowY\|enableVerticalScroll' packages/lib/src/typescript/lib/overlay/Menu.ts` — zero matches.
- `npm run docs:api` — zero warnings.
- The manual browser list above.

---

## Documentation Impact

- **No public API changes.** `_itemPanel`, `_contentFitWidth` and `applyScrollbarGutterWidth` are private; no export, barrel entry, or `llms.txt` line moves. `npm run docs:llms` output is unchanged.
- [`packages/lib/docs/components/Menu.md`](packages/lib/docs/components/Menu.md#L102) gains the framework-scrollbar wording in its scrolling bullet.
- **No `docs/reference/migration/next.md` entry.** That page carries breaking changes; nothing is removed or renamed here.[^scroll-accessors]

---

## Potential Challenges

- **Two overflow judgements can disagree by one frame.** `Menu` predicts overflow from `totalHeight > available` to size itself; the panel measures it from live scroll metrics to reserve its gutter. On a rounding disagreement the menu is 12px too wide, or its titles ellipsize 12px early — both cosmetic, both self-correcting on the next open.
- **`Panel` reflows once on the first overflowing layout.** `layoutOverlayScrollbars` reserves the gutter and calls `scheduleLayout`, so rows land at their final width one frame later. The menu's 120ms fade-in covers it; this is `Panel`'s documented one-frame convergence, not new.
- **A row left on `this.addComponent` throws.** `Fit` rejects a second child. Treat any such throw as a missed step-6 edit, not a `Fit` limitation.
- **The min-height propagation is unchanged.** `Menu`'s merged minimum still reaches it as the rows' summed minimum plus the 4+4 inset band — it now arrives via `Fit` → `Panel` → `VBox` instead of straight from `VBox`, and the total is identical, so the viewport height clamp keeps working with no `getMinSize` override anywhere.
- **`MenuBar` reuses one `Menu` per top-level entry.** Every open must re-derive the width from `_contentFitWidth`, never from `getWidth()`, or a menu that scrolled once stays 12px wide forever. That is why step 9 changes `open()`'s `width` read.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/PopupPanel.ts`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L59) — the codebase's own statement of the approach, in the sibling overlay's class JSDoc, naming `Menu` in the same sentence. Read it first; it is not modified.
- [`packages/lib/src/typescript/lib/component/input/PickerColumn.ts`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L87) — the precedent this plan mirrors: `PickerCellList`, a scrollable `Panel({ autoScroll: "y", insets: 0 })` with a stretching `VBox`, hosted inside a floating dropdown overlay.
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L831) — the second precedent, and the one whose shape is copied exactly: a non-`Panel` component laying out one nested scroll `Panel` with `Fit`.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — read but not modified: `setAutoScroll` (L339), `getInnerSize`'s gutter subtraction (L512), `installOverlayScrollbars` (L1042), `layoutOverlayScrollbars` (L1221).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — the file being changed; read `layOutColumns` (L222), `showAnchored` (L307), `open` (L592) and `placeVertically` (L960) in full before editing.
- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L51) — `TRACK_WIDTH` (L51) and `isScrollbarTarget` (L485), whose blanket-`preventDefault` carve-out `Menu` does **not** need.
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts#L309) — `containsAcrossLayers`, the DOM-containment test that keeps a thumb drag from dismissing the menu.
- [`packages/lib/tests/core/PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts) — the offline harness for staging scroll metrics that the new `Menu` cases borrow from.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Compose before specializing*, and *Size constraints: general component vs `Panel`*, which is the rule that lets a tall list sit inside a short scrolling panel.

---

## Non-Goals

- **No horizontal scrolling.** `applyViewportHeightClamp` leaves width unconstrained on purpose and the item panel is `autoScroll: "y"`, so a too-wide title still ellipsizes rather than scrolling.
- **No scroll-edge shadows.** `scrollShadows: false` keeps the menu's appearance as it is; the panel border and drop shadow already frame it.
- **No scroll-into-view on arrow-key focus.** `setFocusedIndex` does not scroll today and does not start to here; adding it is a separate change.
- **No changes to `Panel`, `Scrollbar`, `VBox` or `LayerManager`.** Every mechanism this plan needs already exists on them.
- **No new public API on `Menu`.** The item panel stays private; tests reach it through `getComponents()`.
- **No `isScrollbarTarget` carve-out.** `Menu` installs no blanket `pointerdown` guard, so there is nothing for a scrollbar target to break.[^no-carveout]
- **No change to `Menu`'s placement, flipping, submenu, keyboard, or dismissal behaviour.** Only what paints the scrollbar, and how much width the rows get, changes.

---

## Notes

[^nested-panel]: Three shapes were weighed. *Reimplementing the overlay wiring inside `Menu`* — an inner clip element, a `Scrollbar`, a native `"scroll"` listener, per-pass metric pushes — duplicates roughly 200 lines of `Panel` for one component, and ARCHITECTURE.md's *Compose before specializing* rejects exactly that trade when the arrangement is the substance of the thing. *Changing `Menu`'s base class to `Panel`* avoids the extra nesting level but flips `clampsToContentSize()` from `true` to `false` for the whole class, which is the switch `applyViewportHeightClamp`'s `setMaxSize` + `setHeight` pair currently rides on, and it drags `Container`'s whole option surface into a component that wants none of it. *Nesting a `Panel`* costs one DOM level and two `Scrollbar` instances per menu, is what `PickerCellList`, `AbstractSelectableList._innerPanel` and `Dialog._contentContainer` all already do, and is what `PopupPanel`'s JSDoc already tells a consumer to do.
    The two `Scrollbar` widgets are constructed eagerly, in `Panel.init`, whether or not the menu ever overflows — `Scrollbar.setMetrics` simply hides a bar whose content fits. That is the cost every scrolling `Panel` in the library already pays, and adding a lazier path just for `Menu` would be a new pattern for a bounded population: `MenuBar` holds one persistent menu per top-level entry, `Table`, `TabBar`, `Split`, `SplitButton`, `MenuButton` and `ToolBar` each hold a single reused rebuild-mode instance, and submenus are per-open.

[^widen-not-inset]: Two ways to keep items off the bar were available. *Letting the panel's gutter shrink the rows* needs no width rule at all, but it silently narrows every title column by 12px the moment a menu scrolls, so the same item ellipsizes differently depending on where it was opened — and it would leave `layOutColumns`' title-column arithmetic measuring against a content width the rows never get. *Widening the menu* keeps the row content area at exactly the width the columns were measured against, and is what rebuild mode already did with the native bar's measured width; this plan changes only the number (`DOM.source.getScrollBarWidth()` → `TRACK_WIDTH`) and extends it to the two persistent paths. `TRACK_WIDTH` is a fixed compile-time constant rather than a measured value, so the prediction cannot drift with the platform the way the native probe could.

[^persistent-gap]: `showAnchored` has reserved a native gutter since commit `2596bfb0`; `open()` never did, which is why a `MenuBar` dropdown clamped by a short viewport laid its items under the bar while a context menu did not. The asymmetry is the second half of the reported defect, and it is fixed here rather than left to a follow-up, since both paths now share one rule.

[^insets-on-panel]: Today the 4px top and bottom bands are padding on the element that scrolls, so they scroll away with the content and `VBox.reserveContentFrame` reserves the trailing one at full scroll. Leaving those insets on `Menu` and zeroing the panel would instead pin them as fixed bands outside the scroll viewport and shorten the scrollbar by 8px — a visible change for no gain. Putting them on the panel reproduces the current geometry exactly, because the panel element is the one that scrolls now.

[^no-helper]: [`plans/overlay-scrollbars-non-panel.md`](plans/overlay-scrollbars-non-panel.md) proposes a `core/OverlayScrollbars.ts` helper that gives overlay bars to components whose scroll element belongs to someone else — CodeMirror's `.cm-scroller`, a native `<textarea>`. `Menu` is not that case: it owns its content outright and can host a real `Panel`, which is strictly more capable (it also gets the gutter reservation, which the helper deliberately does not do). This plan neither depends on that one nor blocks it; the two touch disjoint files.

[^scroll-accessors]: `Menu`'s element no longer scrolls, so the inherited `Component.getScrollTop` / `setScrollTop` / `getMaxScrollTop` now report the menu's own (always-zero) offset rather than the item list's. Nothing in the library calls them on a `Menu`, they were never part of `Menu`'s documented surface, and the one test that touched `getScrollTop()` is re-pointed at the item panel in step 1.

[^no-carveout]: `TimePickerDropdown` and `AbstractCalendarDropdown` need `isScrollbarTarget` because each installs a subtree `pointerdown` listener with `prevent: true` to protect the host input from blurring, and `preventDefault()` on a pointerdown suppresses the `mousedown` the thumb drag is wired to. `Menu` installs no `pointerdown` listener at all, and `LayerManager`'s document-level handler only reads the target — it never calls `preventDefault()`. `MenuItem` uses exact-target `mouseover` / `mouseout` / `click` registrations, which a scrollbar target never matches.
