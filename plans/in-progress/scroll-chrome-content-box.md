---
touches-shared:
  - packages/lib/scripts/eslint/require-content-bounds.baseline.json
  - packages/lib/tests/component/content-box-containment.test.ts
  - packages/lib/src/typescript/ContentBoxPanel.ts
  - packages/lib/docs/reference/changelog.md
---

# Scroll Chrome Lays Out In The Content Box — Implementation Plan

## Overview

Three pieces of scroll chrome place their children against their own outer box instead of their content box. All three are suppressed in the `local/require-content-bounds` lint baseline, and all three are fixed here:

- [`VirtualScroller.layoutScrollbars`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L394) reads `this._owner.getWidth()` / `getHeight()` and puts the two `Scrollbar` widgets at `outer - trackW`. The bars are appended to the owner's element, so on a bordered owner they land a border-width past the edge and are clipped.
- [`ScrollStrip.layoutContent`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L510) reads `this.getHeight()` / `getWidth()`, places the inner clip at origin 0, and hands the same extents to [`ScrollStrip.layoutArrows`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L549), which places the two paging arrows.
- [`Scrollbar.setMetrics`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L569) puts the end arrow at `outer - TRACK_WIDTH`, and the private [`getTrackLength`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L712) measures the thumb's travel from the same outer read.

The rule being applied is the one [`docs/concepts/sizing.md`](packages/lib/docs/concepts/sizing.md) states under *Inner size vs outer size*: because every component is absolutely positioned, a child's containing block is already its parent's padding box, so a child written to `(0, 0)` and sized to the outer box starts inside the border and overruns the far edge, where `overflow: hidden` clips it. The rectangle to place children in is [`Component.getContentBounds()`](packages/lib/src/typescript/lib/core/Component.ts#L2953) — origin from `getContentInsets()`, extent from `getInnerSize()`.

None of the three components carries a border under any shipped theme, so every change here is expected to be pixel-identical today. That expectation is proved rather than assumed: each new case has a borderless arm pinned to literal numbers, and the existing geometry suites for all three classes must pass unmodified.[^why-latent]

---

## Architecture Decisions

### The precedent is commit `3f954d39`, and this follows its code shape

Each placing method opens with `const box = this.getContentBounds() ?? { x: 0, y: 0, width: …, height: … };` and reads every origin and extent off `box`. The fallback applies only before the element exists, when `getContentBounds()` returns `null`.

Every existing call site has this shape; the closest are [`tree/TreeRow.ts:203`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L203) and [`list/renderer/Label.ts:106`](packages/lib/src/typescript/lib/component/list/renderer/Label.ts#L106), which are the two that place children from a method other than `doLayout` — the same situation all three sites here are in.[^precedent]

### `VirtualScroller`'s effective viewport is measured in the owner's content box

`layoutScrollbars` is not fixable on its own. It sizes the vertical bar to `effH` and the horizontal bar to `effW`, and both come from the private [`computeScrollbarVisibility`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L294), which reads the owner's outer box too. So `computeScrollbarVisibility` reads the content box as well, and every consumer of the effective viewport moves with it.[^eff-viewport]

### `VirtualScroller`'s clip box takes the content box's origin as well as its extent

The clip box is sized from `effW` / `effH`, so its extent changes with the decision above. Its origin — hard-coded `top: 0; left: 0` at construction — moves to the content-box origin in the same write, so the rows, the scroll shadows and the two bars all sit in one rectangle.[^clip-origin]

### `ScrollStrip.layoutArrows` takes the rectangle instead of two extents

`layoutArrows(bandMain, thickness, reserve)` becomes `layoutArrows(box, reserve)`, where `box` is the rectangle `layoutContent` already resolved. **The arrows are the silent half of this site.** The lint rule cannot see `layoutArrows`: it places children from delegated arguments and names no box of its own, so it is not baselined and never was. Fixing `layoutContent` alone would leave the arrows against the outer box with a green build — the rule's own header comment names this method as a known blind spot.[^silent-arrows]

### `Scrollbar` resolves its content box once, projected onto the scroll axis

`Scrollbar` gets one private `axisBox()` returning `{ origin, extent, crossOrigin, crossExtent }` — the content box with the scroll axis already picked. `setMetrics`, `getTrackLength`, `getTrackOrigin` and `_onTrackClick` all read it.

This is a stated divergence from the inline-`box` precedent above: four methods need the same rectangle, and the file already spells the axis pick as an `isVertical() ? this.getHeight() : this.getWidth()` ternary three times over. One accessor removes all three; four inline copies of the resolution plus its fallback would remove none.[^axis-box]

### The track is measured in the content box, and the thumb starts at the content-box origin

Answering the question the three `Scrollbar` methods have to answer coherently:

| Quantity | Today | After |
|---|---|---|
| Track length | `outer - inset` | `axis.extent - inset` |
| Track origin (thumb + hit test) | `arrowsEnabled ? TRACK_WIDTH : 0` | `axis.origin + (arrowsEnabled ? TRACK_WIDTH : 0)` |
| End-arrow position | `outer - TRACK_WIDTH` | `axis.origin + axis.extent - TRACK_WIDTH` |
| Start-arrow position | `(0, 0)`, written in `buildArrows` | content-box origin, written in `setMetrics` |
| Thumb cross-axis | `THUMB_INSET`, `TRACK_WIDTH - 2 * THUMB_INSET` | `axis.crossOrigin + THUMB_INSET`, `axis.crossExtent - 2 * THUMB_INSET` |

`_thumb`, `_arrowStart` and `_arrowEnd` are all registered children of the `Scrollbar` (added by `super.addComponent` in the constructor and in `buildArrows`), so all three need the origin offset. There is no separate track component — the track is the `Scrollbar`'s own element, painted by its background.[^who-is-a-child]

Folding the origin into `getTrackOrigin()` keeps its two callers consistent: `setThumbPos` uses it as a placement origin, and `_onTrackClick` subtracts it from a click coordinate to get back into track-relative space. A mouse `offsetX` / `offsetY` is already measured from the padding box, which is the same space the children live in, so the two agree.

### The arrows' and thumb's cross-axis writes move from the constructor into `setMetrics`

`buildArrows` and the constructor run before the element exists, so `getContentBounds()` returns `null` there and no content box is available. The writes that need one move to `setMetrics`, which already positions the end arrow for exactly this reason. The constructor's `(0, 0)` seeds stay as the pre-metrics placeholder.

### No component grows to absorb its own border

`Tooltip` gained its border in the precedent commit so its label kept the width it measured. Nothing here does that: a bordered `Scrollbar` keeps its 12px outer width and its track narrows, and a bordered `Tree` keeps its committed size and its viewport shrinks. The rule under fix is containment, not sizing.[^no-growth]

### Removing a site's baseline key is part of its fix

Each of the three keys comes out of [`require-content-bounds.baseline.json`](packages/lib/scripts/eslint/require-content-bounds.baseline.json) in the same step as the code change. `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src`, run from `packages/lib`, lists the unsuppressed set.

---

## Internal Structure

### `VirtualScroller` — the resolution, inlined in both methods that need it

```typescript
const box = this._owner.getContentBounds()
         ?? { x: 0, y: 0, width: this._owner.getWidth() || 0, height: this._owner.getHeight() || 0 };
```

`computeScrollbarVisibility` uses `box.width` / `box.height` in place of `outerW` / `outerH`. `layoutScrollbars` additionally uses `box.x` / `box.y`:

```typescript
this._scrollbarV.setX(box.x + Math.max(0, box.width - trackW));
this._scrollbarV.setY(box.y);
this._scrollbarV.setHeight(effH);

this._scrollbarH.setX(box.x);
this._scrollbarH.setY(box.y + Math.max(0, box.height - trackW));
this._scrollbarH.setWidth(effW);

DOM.sink.apply(this._clipBox, { style: {
    left:   box.x + "px",
    top:    box.y + "px",
    width:  effW + "px",
    height: effH + "px",
} });
```

`setY` on the vertical bar and `setX` on the horizontal bar are new writes — today both axes are left at their `0` default, which is the same number whenever the owner has no insets or padding.

### `ScrollStrip` — one resolution, passed down

A module-private type alias in `ScrollStrip.ts` names the rectangle for `layoutArrows`'s parameter:

```typescript
/** The rectangle `getContentBounds()` returns, passed from layoutContent to layoutArrows. */
type ContentBox = { x: number; y: number; width: number; height: number };

layoutContent(reserve: number, endGap: number): this {
    const box = this.getContentBounds()
             ?? { x: 0, y: 0, width: this.getWidth() || 0, height: this.getHeight() || 0 };
    const vertical  = this.isVertical();
    const bandMain  = vertical ? box.height : box.width;
    const thickness = vertical ? box.width  : box.height;
    const clipMain  = bandMain - 2 * reserve;
    // … clip placement offset by box.x / box.y …
    this.layoutItems();
    this.layoutArrows(box, reserve);

    return this;
}
```

`layoutArrows(box, reserve)` re-derives `bandMain` / `thickness` from `box` and offsets every write: `trailPos = (vertical ? box.y : box.x) + bandMain - reserve`, cross-axis origin `box.x` (vertical) or `box.y` (horizontal), lead arrow at `box.y` / `box.x`.

### `Scrollbar` — the axis-projected accessor

```typescript
/**
 * The content box projected onto the scroll axis: `origin` and `extent` run
 * along it, `crossOrigin` and `crossExtent` across it. Falls back to the outer
 * box while the element does not exist yet.
 */
private axisBox(): { origin: number; extent: number; crossOrigin: number; crossExtent: number } {
    const box = this.getContentBounds()
             ?? { x: 0, y: 0, width: this.getWidth() || 0, height: this.getHeight() || 0 };

    return this.isVertical()
        ? { origin: box.y, extent: box.height, crossOrigin: box.x, crossExtent: box.width  }
        : { origin: box.x, extent: box.width,  crossOrigin: box.y, crossExtent: box.height };
}
```

`_onTrackClick`'s touch branch measures its click from `DOM.source.getViewportRect(this)`, whose top-left is the **border** box, while the mouse branch's `offsetX` / `offsetY` is measured from the **padding** box. Subtract the leading border side in the touch branch so both branches produce a padding-box coordinate before they are compared against `axisBox()`.

---

## Ordered Implementation Steps

Test-first: each code step has its red case written first, in the suite named in step 1.

1. **Extend [`tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts) with three `describe` blocks** — `VirtualScroller`, `ScrollStrip.layoutContent`, `Scrollbar.setMetrics` — following the file's existing style: components stay detached, an explicit literal border, literal expected rectangles, and a borderless arm proving today's numbers are unchanged. Use the cases in `## Expected Behaviour` verbatim. Add a local helper for reading the inline style a raw handle has accumulated, since the `VirtualScroller` clip box is not a `Component` and has no `getX()` to read:

   ```typescript
   /** The accumulated inline style a raw handle has been written, last write wins. */
   function styleOf(sink: RecordingDOMSink, handle: Handle): Record<string, string | null> {
       const style: Record<string, string | null> = {};

       for (const write of sink.writes) {
           if (write.op === 'apply' && write.args[0] === handle) {
               Object.assign(style, (write.args[1] as { style?: Record<string, string | null> }).style ?? {});
           }
       }

       return style;
   }
   ```

   `installTestDOM(CONFIG)` returns the sink; `RecordingDOMSink` is exported from `../dom/TestDOM` and `Handle` from `~/core/DOM`. The clip box is `scroller.ownedHandles()[0]`.
   Verify: `npx vitest run tests/component/content-box-containment.test.ts` — every case whose component carries a border fails, and every borderless arm passes.

2. **Fix `VirtualScroller`** (`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`): inline the content-box resolution in `computeScrollbarVisibility` (~L294) and `layoutScrollbars` (~L394) per `## Internal Structure`; update both methods' doc comments to say the viewport and the bars are measured in the owner's content box.
   Verify: the `VirtualScroller` block of the new suite is green.

3. **Fix `ScrollStrip`** (`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts`): resolve the box in `layoutContent` (~L510), offset the clip, change `layoutArrows`'s signature to `(box, reserve)` (~L549) and offset every arrow write. Update three doc comments — the class docstring (~L76), `layoutContent`'s (which says "The band is the strip's own width/height", no longer true) and `layoutArrows`'s parameter list.
   Verify: the `ScrollStrip` block is green; `grep -n 'layoutArrows(' packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` shows the call and the declaration, both on the new two-argument signature.

4. **Fix `Scrollbar`** (`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`): add `axisBox()`; route `getTrackLength` (~L712), `getTrackOrigin` (~L724), `setMetrics` (~L569) and `_onTrackClick` (~L862) through it per the table in `## Architecture Decisions`; move the start-arrow position and the thumb's cross-axis size and origin into `setMetrics`; subtract the leading border in `_onTrackClick`'s touch branch.
   Verify: the `Scrollbar` block is green.
   Checkpoint: `grep -n 'this.getHeight() : this.getWidth()' packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — expect zero matches. The file has three of them today, at L604, L713 and L889.

5. **Remove the three keys** from `packages/lib/scripts/eslint/require-content-bounds.baseline.json`: `ScrollStrip.layoutContent`, `Scrollbar.setMetrics`, `VirtualScroller.layoutScrollbars`. Leave the other entries alone.
   Verify: from `packages/lib`, `npx eslint src` reports only the one pre-existing `local/forward-super-options` error in `table/cell/renderer/Link.ts` (that error is on master and is not this plan's to fix). `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` no longer lists any of the three.

6. **Add a fourth row to the Content Box demo panel** (`packages/lib/src/typescript/ContentBoxPanel.ts`), per `## Expected Behaviour`'s manual cases: `buildScrollChromeRow()`, added after `buildRowRendererRow()` in the constructor, holding a bordered `Tree`, a bordered `ScrollStrip` and a bordered `Scrollbar`. Extend the panel's class doc comment to name the three. `ScrollStrip` has no `doLayout` of its own — its owner drives it — so the strip needs a host:

   ```typescript
   /** Drives a bordered ScrollStrip the way an owner does: size the band, then lay its content. */
   class BorderedStripHost extends Container {
       private _strip: ScrollStrip = new ScrollStrip({ border: BORDER, scrollable: true });

       constructor() {
           super();
           for (const label of STRIP_ITEMS) {
               this._strip.addItem(Button({ text: label }));
           }
           this.addComponent(this._strip);
       }

       doLayout(): this {
           const box = this.getContentBounds() ?? { x: 0, y: 0, width: 0, height: 0 };

           this._strip.setX(box.x);
           this._strip.setY(box.y);
           this._strip.setWidth(box.width);
           this._strip.setHeight(STRIP_HEIGHT);

           const reserve = this._strip.arrowReserve(this.predictedItemsExtent(), box.width);

           this._strip.layoutContent(reserve, 0);

           return this;
       }
   }
   ```

   `predictedItemsExtent()` sums each item's `getPreferredSize()?.width ?? 0`. `STRIP_ITEMS` must be long enough that the sum exceeds the FieldSet's width by more than the 1px slop, or `arrowReserve` returns 0 and no arrow is drawn — which is the thing under test. The `getContentBounds()` read is not optional: `eslint src` covers the demo app, and reading `getWidth()` here would trip the same rule this plan is clearing.
   Verify: `npm run dev`, open the **Content Box** tab, walk the manual checks.

7. **Run the full suite and the type check** (`## Verification`).

8. **Update the two documents.** In `packages/lib/docs/components/ScrollStrip.md`, find every description of `layoutContent` sizing the clip to "the band minus the gutters" (`grep -n 'band minus the gutters' packages/lib/docs/components/ScrollStrip.md`) and say the band's content box instead. In `packages/lib/docs/reference/changelog.md`, add a `### Fixed` entry under the existing `## 0.4.0` heading, next to the bordered-components entry. That entry ends with "Twelve sites are baselined" — re-count from the baseline file rather than subtracting by hand, because concurrent branches are removing keys too.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/scripts/eslint/require-content-bounds.baseline.json` |
| Modify | `packages/lib/tests/component/content-box-containment.test.ts` |
| Modify | `packages/lib/src/typescript/ContentBoxPanel.ts` |
| Modify | `packages/lib/docs/components/ScrollStrip.md` |
| Modify | `packages/lib/docs/reference/changelog.md` |

---

## Expected Behaviour

`TRACK_WIDTH` is 12, `THUMB_INSET` 2 and `THUMB_MIN_SIZE` 30 — read them off the class (`new Scrollbar('vertical').getTrackWidth()`) rather than hard-coding, as `tests/component/container/VirtualScroller.test.ts` already does for the track width.

### Offline-testable

**VirtualScroller — a bordered owner keeps both bars and the clip box inside its content box.** Owner is a detached `Container`, 200 × 400, `2px solid black`, no padding. Content 100 × 1000.

| Thing | Today | After the fix |
|---|---|---|
| Content box | — | `(0, 0, 196, 396)` |
| `effW` / `effH` | 188 / 400 | 184 / 396 |
| Vertical bar | `x 188`, `y 0`, `height 400` | `x 184`, `y 0`, `height 396` |
| Horizontal bar | `x 0`, `y 388`, `width 188` | `x 0`, `y 384`, `width 184` |
| Clip box | `left 0`, `top 0`, `188 × 400` | `left 0`, `top 0`, `184 × 396` |

Today the vertical bar's right edge lands at 200 against a 196-wide padding box and its bottom at 400 against 396.

**VirtualScroller — the borderless arm is unchanged.** A 196 × 396 owner with `border: none` produces exactly the bordered arm's numbers above.

**VirtualScroller — a padded owner offsets the whole rectangle.** Owner 200 × 400, no border, `padding: 5`, same 100 × 1000 content: content box `(5, 5, 190, 390)`; `effW` 178 and `effH` 390; vertical bar at `x 183, y 5, height 390`; horizontal bar at `x 5, y 383, width 178`; clip box `left 5px, top 5px, 178 × 390`.

**ScrollStrip — a bordered strip keeps its clip and both arrows inside its content box.** Horizontal strip, 300 × 30, `2px solid black`, `layoutContent(24, 0)` with `scrollable: true`.

| Thing | Today | After the fix |
|---|---|---|
| Content box | — | `(0, 0, 296, 26)` |
| Inner clip | `(24, 0, 252, 30)` | `(24, 0, 248, 26)` |
| Lead arrow | `(0, 0, 24, 30)` | `(0, 0, 24, 26)` |
| Trail arrow | `(276, 0, 24, 30)` | `(272, 0, 24, 26)` |

The trail arrow is the one the lint rule cannot see, and today its right edge is at 300 against a 296-wide padding box.

**ScrollStrip — the borderless arm is unchanged.** A 296 × 26 strip with `border: none` and the same `layoutContent(24, 0)` produces the bordered arm's numbers.

**ScrollStrip — vertical orientation.** A `{ orientation: 'vertical' }` strip, 30 × 300, `2px` border, `layoutContent(24, 0)`: clip `(0, 24, 26, 248)`, lead arrow `(0, 0, 26, 24)`, trail arrow `(0, 272, 26, 24)`.

**Scrollbar — a bordered bar keeps its thumb and both arrows inside its content box.** Vertical bar, outer 12 × 200, `2px solid black`, arrows enabled, `setMetrics(200, 1000, 0)`.

| Thing | Today | After the fix |
|---|---|---|
| Content box | — | `(0, 0, 8, 196)` |
| Track length | 176 | 172 |
| Thumb size | 35 | 34 |
| Thumb main-axis position | `y 12` | `y 12` |
| Thumb cross-axis | `x 2`, `width 8` | `x 2`, `width 4` |
| Start arrow | `(0, 0)` | `(0, 0)` |
| End arrow | `y 188` | `y 184` |

Today the end arrow's bottom edge is at 200 against a 196-tall padding box, and the thumb's right edge at 10 against an 8-wide one.

**Scrollbar — main-axis parity with a shorter borderless bar.** A 12 × 196 bar with `border: none` and the same metrics gives the same track length, thumb size, thumb `y` and end-arrow `y` as the bordered arm. The cross axis differs by design: the borderless bar's thumb is 8 wide at `x 2`, which is today's number and what a shipped theme renders.

**Scrollbar — arrows disabled.** Vertical bar, outer 12 × 200, `2px` border, `arrowsEnabled: false`, `setMetrics(200, 1000, 0)`: track length 196, thumb `y 0`, thumb size 39.

**Nothing else moves.** These suites pin today's geometry with borderless components and must pass unmodified: `tests/component/container/VirtualScroller.test.ts`, `tests/component/container/Scrollbar.test.ts`, `tests/component/container/ScrollbarArrow.test.ts`, `tests/component/container/ScrollStrip.test.ts`, the four `TabBar.*.test.ts` files, `tests/component/tree/Tree.test.ts` and `tests/component/table/Body.test.ts`. `ScrollStrip.layoutContent` has no geometry test today, so its borderless arm from this plan is its only regression net.

### Manual browser check

`npm run dev`, **Content Box** tab, the new fourth row. None of this is reachable offline: the modelled DOM source reports zero border widths for a connected element, and the eye-check is precisely whether real pixels are clipped.

- **Bordered `Tree`.** A `Tree({ border: BORDER })` with enough nodes to overflow vertically and one label long enough to overflow horizontally. Both scrollbars sit fully inside the frame, the frame is unbroken all the way round, and the two bars meet at the inside corner rather than running under the border.
- **Bordered `ScrollStrip`.** A `ScrollStrip({ border: BORDER, scrollable: true })` with enough buttons to overflow, driven by a small local host whose `doLayout` sizes the strip inside its own `getContentBounds()` and then calls `arrowReserve` + `layoutContent`. Both chevron arrows sit inside the frame with no shaved edge, and clicking each one pages the items.
- **Bordered `Scrollbar`.** A `Scrollbar({ border: BORDER })` 200px tall, fed `setMetrics(200, 1000, 300)` from `onFirstLayout`. Both arrow caps and the thumb sit inside the frame; dragging the thumb tracks the pointer to both ends of the track; clicking the track above and below the thumb pages in the right direction; clicking an arrow cap steps rather than paging.

---

## Verification

Run from `packages/lib` unless noted.

1. `npx vitest run tests/component/content-box-containment.test.ts` — every new case green.
2. `npx vitest run` — full suite green, with no edits to any existing test.
3. `npx tsc --noEmit` — clean.
4. `npx eslint src` — only the pre-existing `local/forward-super-options` error in `table/cell/renderer/Link.ts`.
5. `REQUIRE_CONTENT_BOUNDS_IGNORE_BASELINE=1 npx eslint src` — none of the three sites appears.
6. `node scripts/eslint/require-content-bounds.test.mjs` — the rule's own tests still pass (the rule is not modified, but the baseline file it reads is).
7. `npm run docs:api` from the repo root — zero warnings.
8. The manual checks above, on `npm run dev` (port 8015), **Content Box** tab.

---

## Documentation Impact

No exported signature changes: `layoutScrollbars`, `layoutContent` and `setMetrics` keep their parameters, and `layoutArrows` and `axisBox` are private.

- [`packages/lib/docs/components/ScrollStrip.md`](packages/lib/docs/components/ScrollStrip.md) describes `layoutContent` as sizing the clip to "the band minus the gutters". Every such phrase becomes "the band's content box minus the gutters"; `grep -n 'band minus the gutters'` finds them.
- [`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md) gains a `### Fixed` entry under `## 0.4.0` (version 0.3.0 is the last tag, so 0.4.0 is the in-flight section). Say what changed, that all three are borderless under every shipped theme and so pixel-identical today, and that a consumer who borders a `Tree`, a `ScrollStrip` or a `Scrollbar` gets chrome that stays inside the frame. Re-count the baselined-sites number from the file.
- [`packages/lib/docs/concepts/sizing.md`](packages/lib/docs/concepts/sizing.md) already states the rule correctly and needs no edit.

---

## Potential Challenges

- **The baseline file is being edited on other branches at the same time.** `feature/content-box-baseline-sweep`, `feature/menuitem-border-aware-centring` and `feature/table-cell-content-box` each remove their own keys. Remove only the three keys named in step 5 and resolve a merge conflict by taking the union of the removals.
- **`content-box-containment.test.ts` and `ContentBoxPanel.ts` are shared with those branches too.** Both are append-only here — three new `describe` blocks and one new row method — so a conflict is a positional one, not a semantic one.
- **The lint rule will not catch a future regression at any of these three sites.** Its `getContentBounds()` escape is whole-method, so once a method reads the content box anywhere the rule stops looking at it — and `Scrollbar`'s `axisBox()` removes the outer read from the placing methods entirely. The rule's header already says it is a guard rather than a proof; the guard that remains is the borderless-arm test, which is why every case is pinned to literal numbers rather than to containment alone.
- **`getContentBounds()` now runs on the scroll path.** `computeScrollbarVisibility` is called on every scroll tick and `Scrollbar.getTrackLength` on every thumb-drag mousemove. Neither adds a DOM read: `getBorderSize()` memoises into `_borderWidths` once the element is connected and invalidates on `setBorder` and on a theme change. The added cost is one object allocation and a few subtractions.
- **`Absolute` does not re-offset children.** `Scrollbar`'s children are laid out by the default `Absolute` manager, which re-commits each child at its own `getX()` / `getY()` without adding the container's insets, so folding the content-box origin into the child's position does not double-count.
- **A child's own min-size clamp can beat a literal.** `Component.setWidth` / `setHeight` clamp to the child's merged minimum, so a `ScrollStrip` arrow told to be 26px tall commits more if the `Button`'s own content-derived minimum is larger. If a literal in `## Expected Behaviour` disagrees with the run, check `button.getMinSize()` before changing any code, and record the clamped value in the test with a comment — the precedent suite does exactly this for `TreeRow`'s 16px toggle, which commits 16 where it is given 20.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getContentBounds` (L2953), `getContentInsets` (L2004), `getInnerSize` (L2921), `getBorderSize` (L2985).
- Commit `3f954d39` — the precedent. Read the `TreeRow.layoutChildren` and `list/renderer/Label.ts` hunks (`git show 3f954d39 -- packages/lib/src/typescript/lib/component/tree/TreeRow.ts packages/lib/src/typescript/lib/component/list/renderer/Label.ts`).
- [`packages/lib/tests/component/content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts) — the suite to extend, and the source of the two oracles and the detached-layout helper.
- [`packages/lib/scripts/eslint/require-content-bounds.js`](packages/lib/scripts/eslint/require-content-bounds.js) — the header comment lists what the rule cannot see, including `ScrollStrip.layoutArrows` by name.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — the only `VirtualScroller` owner; `table/Body` and `tree/Tree` are its two subclasses.
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `layoutChrome` (L2602) and `positionClipFrame` (L2272) are the only in-library caller of `ScrollStrip.layoutContent`.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `installTestDOM` returns the recording sink whose `writes` the clip-box assertion reads.
- [`packages/lib/src/typescript/ContentBoxPanel.ts`](packages/lib/src/typescript/ContentBoxPanel.ts) — the demo panel to extend, and the source of the `BORDER` constant and the `BorderedRowTree` subclass pattern.

---

## Non-Goals

- **The baselined sites this plan does not own.** `MenuItem.constructor`, `Cell.alignEditorWithContent` and `Notification.doLayout` belong to concurrent branches; whatever else is still in the baseline file when this lands stays there.
- **`Panel.layoutOverlayScrollbars`.** It derives its viewport from `DOM.source.getScrollMetrics(panelEl).clientWidth` / `clientHeight` — the padding box — so it is already border-correct and is not baselined. It ignores the panel's own padding, which is a separate question about whether an overlay bar should hug the panel edge or the content edge.
- **The virtual-window row counts.** The `this.getHeight()` / `this.getWidth()` reads in `VirtualRowView` (L316, L571), `Body` (L732, L1519) and `Tree` (L1062) size the *window* from the owner's outer box, so a bordered owner renders at most one extra row. Those rows go inside the clip box and are clipped there; this is a render-count question, not a placement one.
- **`TabBar.layoutChrome`.** It derives its main-axis extent from the outer `width` / `height` it is handed and subtracts `getContentInsets()`, so it is inset-aware but not border-aware. The bar's theme border sits on the cross axis, so nothing is wrong today, and it is a fourth site with its own arithmetic.
- **Growing any component to absorb its own border** — see the decision above.
- **The `Scrollbar`'s pinned `TRACK_WIDTH` cross-axis size.** A bordered bar's track narrows rather than the bar widening. Making the outer width follow the border is a sizing change with its own gutter-reservation consequences in `Panel` and `VirtualScroller`.

---

## Notes

[^why-latent]: Verified rather than taken on trust. No shipped theme in `packages/lib/src/typescript/lib/core/themes/` gives any of the three a border: the theme files are token bags, borders reach a component through a `setBorder` call, and `grep -n 'setBorder\|clearBorder'` over `table/Body.ts`, `tree/Tree.ts`, `ScrollStrip.ts` and `Scrollbar.ts` finds none. All three also default to zero insets and no padding — `Component`'s default bag has `insets: ZERO_INSETS` (`core/ComponentDefaults.ts:18`), `Container` keeps it, and `ScrollStrip`'s constructor calls `clearInsets()` over `Panel`'s `Insets(4, 4, 4, 4)`. With no border, no insets and no padding, `getContentBounds()` returns `{ 0, 0, outerW, outerH }`, which is exactly what the code reads today. The one nuance is `TabBar`: it does border itself, but it positions the strip through `positionClipFrame`, which already offsets by `getContentInsets()`, and its border sits on the cross axis. The strip it owns is unbordered.

[^precedent]: Commit `3f954d39` fixed eleven sites this way and added `Component.getContentBounds()` for them to share. Its distinguishing feature is that the origin comes from `getContentInsets()` and the extent from `getInnerSize()` — a border shrinks the rectangle without moving its origin, because the containing block is already the padding box. Eighteen call sites exist today and every one inlines `const box = this.getContentBounds() ?? …` at the top of the placing method; none introduces a helper. Two shapes appear for the null case: an early `return` (`MenuItem.layoutTexts`, `Dialog`) and a fallback literal (`TreeRow`, the four row renderers, `TreeCellRenderer`). The fallback is chosen here because it is what the rule's own diagnostic message tells an implementer to write, and because all three sites here can be called by an owner that has not rendered yet.

[^eff-viewport]: `computeScrollbarVisibility` returns `effW` / `effH`, which feed six things: both bars' lengths, the clip box's size, the scroll clamps in `setScrollX` / `setScrollY` / `clampAxis` / `clampToContent`, the scroll-shadow ramps in `updateShadows`, and the public `getViewportWidth()` that `Tree` uses to size fill-width rows. Leaving it on the outer box while moving the bars to the content box would be incoherent in a directly visible way: the vertical bar would be positioned inside the border but sized to the full outer height, so it would overrun the bottom edge by the border width — the same defect one axis over. Measuring the effective viewport in the content box is also the semantically right answer, since the visible area for rows genuinely is the content box. The scroll clamps move with it: a bordered owner can scroll a border-width further, which is correct because it can see a border-width less.

[^clip-origin]: The extent has to change regardless — `effW` / `effH` are content-box-derived after the decision above. The origin is the discretionary half, and it moves for two reasons. First, `getContentBounds()` is a rectangle and the rule the codebase states is "place children inside it", not "size children to it"; taking the extent and discarding the origin is the half-fix the lint rule's header warns produces meaningless green. Second, it is the only thing that makes a padded owner behave: a border does not move the origin (the containing block is the padding box), but insets and padding do, and `Tree` and `Body` both accept an `insets` option from any consumer. The constructor's `top: 0; left: 0` stays as the pre-layout default and `layoutScrollbars` overwrites both.

[^silent-arrows]: The rule reports a method that *places a child* while *naming a box it must not place against*. `layoutArrows` places children — `button.setX`, `setY`, `setWidth`, `setHeight` — but names no box: `bandMain` and `thickness` arrive as parameters. The rule's header comment lists this as the first of its four deliberate gaps and cites this exact method: "a method that places children from *delegated* arguments names no box the rule can see (`ScrollStrip.layoutArrows(bandMain, thickness, reserve)` is handed its owner's extents by the baselined `layoutContent`)". Changing the signature to take the rectangle does not make the rule see it either — a parameter is still a parameter. What it does is make the delegation state what it is passing, so the next reader of `layoutArrows` sees a content box rather than two anonymous numbers.

[^axis-box]: Four methods need the rectangle: `setMetrics` needs all four components, `getTrackLength` the main extent, `getTrackOrigin` the main origin, and `_onTrackClick` the main origin and extent. Two of those are called outside a layout pass — `getTrackLength` from `_onDragMove` and `getTrackOrigin` from `_onTrackClick` — so they cannot be handed a box by `setMetrics` and must resolve their own. Inlining would put four copies of the resolution and its fallback in one file. The accessor also absorbs the `isVertical() ? this.getHeight() : this.getWidth()` ternary that appears at L604, L713 and L889 today, which is a net reduction: the file loses more axis-picking than it gains in accessor. Per `_shared/pattern-conformance.md` this is a stated divergence from the inline precedent, not an unexplained one; `VirtualScroller` and `ScrollStrip`, which need one or two resolutions, keep the inline shape.

[^who-is-a-child]: Checked rather than assumed. `_thumb` is created in the constructor and added with `super.addComponent(this._thumb)` (L399); `_arrowStart` and `_arrowEnd` are created in `buildArrows` and added the same way (L432, L440). All three are therefore real registered children whose elements are appended into the `Scrollbar`'s own element, so their containing block is the `Scrollbar`'s padding box and all three need the origin offset. There is no `_track` field at all — the track is the `Scrollbar` element itself, painted by `setBackgroundColor("var(--ts-ui-scrollbar-track, …)")` in the constructor, so it needs nothing. The `Absolute` manager that lays these children out re-commits each at its own `getX()` / `getY()` (`layout/Absolute.ts`) and `LayoutManager.commitBounds` writes the coordinate through unchanged, so nothing offsets them a second time.

[^no-growth]: `Tooltip` grew in the precedent commit because its outer box was derived from a text measurement that did not include the border, so the label lost width it had already measured. Nothing here is in that position: a `Scrollbar`'s cross-axis extent is the `TRACK_WIDTH` constant rather than a measurement, and a `Tree`'s and a `ScrollStrip`'s outer size is assigned by their parent's layout manager. Growing any of them would change what the parent reserved, which is a sizing decision with consequences in `Panel`'s gutter arithmetic and in `TabBar`'s band placement — out of proportion to a defect that has no symptom under any shipped theme.
