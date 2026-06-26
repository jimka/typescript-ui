---
touches-shared: ["src/typescript/lib/component/container/TabBar.ts"]
---

# ScrollStrip — Reusable Overflow-Scrolling Button Rail — Implementation Plan

## Overview

Extract the axis-generalised overflow-scrolling machinery currently embedded in [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) into a standalone, reusable `ScrollStrip` component, then have `TabBar` consume it — deleting the duplicated machinery from `TabBar`. `ScrollStrip` is a clip frame (overflow:hidden, native scroll) that lays a row (north/south) or column (west/east) of child buttons via an `HBox`/`VBox`, shows lead/trail arrow buttons in reserved gutters when the children overflow, pages by one item per arrow click, disables arrows at the scroll limits, and exposes a "reveal item N into view" operation.

The new file lives at `src/typescript/lib/component/container/ScrollStrip.ts`, exported from the container barrel [`src/typescript/lib/component/container/index.ts`](../src/typescript/lib/component/container/index.ts). `TabBar` keeps its tab-specific overlays (selection indicator, reorder bar, drop tint, close buttons, tool group, leading widget) and delegates only the scroll/clip/arrow responsibility.

The success criterion is **net complexity reduction**: the lines deleted from `TabBar` plus the lines added to `ScrollStrip` must total fewer than the lines removed, *and* `ScrollStrip` must be genuinely reusable (ToolBar/breadcrumb/chip rails later). The investigation below establishes that this is achievable **only if the clip-frame boundary is drawn carefully** — the machinery is entangled enough that a naive "move the methods" extraction would either drag the tab overlays into `ScrollStrip` or leave the arrows behind. The chosen boundary (see Architecture Decisions) resolves this.

A sibling plan (`extract-tabbutton`) also modifies `TabBar.ts`; hence the `touches-shared` frontmatter.

---

## Investigation Findings — the current machinery

The scroll/clip responsibility in `TabBar` spans these fields and methods (line numbers at write time):

**Fields** ([TabBar.ts:464–530](../src/typescript/lib/component/container/TabBar.ts#L464)):
- `_tabClip: Panel` (464) — the clip frame. **Critically, it is a `Panel`, not a bare `Component`**, and it hosts *both* the scrolling tab wrappers (its box children, added via `_tabClip.addComponent`) *and* three raw-appended overlays: `_indicator`, `_dropTint`, `_reorderBar` ([init, TabBar.ts:734–737](../src/typescript/lib/component/container/TabBar.ts#L734)).
- `_scrollable: boolean` (489), `_scrollLeadButton: Button | null` (525), `_scrollTrailButton: Button | null` (526), `_scrollToSelected: boolean` (530).

**Constants** ([TabBar.ts:74,83](../src/typescript/lib/component/container/TabBar.ts#L74)): `SCROLL_ARROW_SIZE = 24`, `SCROLL_ARROW_STEP = 80`.

**Methods** (≈250 lines, [TabBar.ts:2199–2742](../src/typescript/lib/component/container/TabBar.ts#L2199)):

| Method | Lines | Role |
|---|---|---|
| `computeArrowReserve` | 2199–2206 | Per-end gutter (0 or `SCROLL_ARROW_SIZE`) given overflow. |
| `layoutOverflowChrome` | 2472–2480 | `setOverflow("hidden")` + dispatch to arrows or hide. |
| `ensureScrollArrows` | 2486–2516 | Lazily build the two arrow `Button`s, style them, wire `action`, raw-append. |
| `layoutOverflowArrows` | 2532–2581 | Show/position/size the arrows in their gutters; set glyphs per axis; call `refreshScrollArrows`. |
| `hideOverflowArrows` | 2586–2589 | Hide both arrows. |
| `clipScroll` | 2597–2601 | Read native main-axis offset (`getScrollTop`/`getScrollLeft`). |
| `clipScrollMax` | 2609–2613 | Read native main-axis max (`getMaxScrollTop`/`getMaxScrollLeft`). |
| `setClipScroll` | 2621–2627 | Write native main-axis offset. |
| `refreshScrollArrows` | 2634–2648 | Enable/disable arrows from live scroll position (1px slop). |
| `scrollStepExtent` | 2659–2663 | Per-click step ≈ one tab; falls back to `SCROLL_ARROW_STEP`. |
| `scrollLeadClicked` / `scrollTrailClicked` | 2669–2679 | Arrow `action` handlers → `scrollStrip(±step)`. |
| `scrollStrip` | 2689–2692 | `setClipScroll(clipScroll() + delta)` then `refreshScrollArrows`. |
| `revealSelectedIfRequested` | 2701–2742 | One-shot reveal of item N: live-rect delta against the clip rect, applied to native offset. |

**Entanglement with the layout pass.** `layoutChrome` ([TabBar.ts:2799–2851](../src/typescript/lib/component/container/TabBar.ts#L2799)) interleaves scroll concerns with tab-specific chrome in one pass: it computes `arrowReserve` (2825), sizes the clip frame between tool/lead/arrow reservations via `positionClipFrame` (2828), runs `applyTabWidths` + `_tabClip.doLayout()` (2830–2831), calls `_tabClip.syncScrollOffsets()` (2839) to resync the cache after a width-driven native clamp, calls `revealSelectedIfRequested` (2844), then positions the tab-specific overlays (2846–2849) and finally `layoutOverflowChrome` (2850). The arrow gutters, the clip-frame rectangle, and the tab-width/end-align math are *co-derived* from the same `mainInner`/`toolExtent`/`leadExtent` quantities.

**Other call sites that touch the arrows directly:**
- `setBarSurfaceColor` ([704–705](../src/typescript/lib/component/container/TabBar.ts#L704)) recolours `_scrollLeadButton`/`_scrollTrailButton`.
- `containsTarget`-style hit test ([1232–1242](../src/typescript/lib/component/container/TabBar.ts#L1232)) checks the arrow elements.
- `setScrollable` (1024), `setCompact` (1055), side-switch (1737), `refresh`/clear (916–920) set `_scrollToSelected` / reset scroll.
- `applyTabWidths` ([1992–2017](../src/typescript/lib/component/container/TabBar.ts#L1992)) flips the clip box to `"preferred"` + `setOverflowing` when `_scrollable`.
- `syncToolbarOrientation` ([2098–2105](../src/typescript/lib/component/container/TabBar.ts#L2098)) swaps the clip box `HBox`↔`VBox`.

The cached native-scroll API used throughout lives on `Component` ([Component.ts:2890–3000](../src/typescript/lib/core/Component.ts#L2890)): `getScrollLeft`/`getScrollTop`, `getMaxScrollLeft`/`getMaxScrollTop`, `setScrollLeft`/`setScrollTop`, `syncScrollOffsets`. `_tabClip` is a `Panel`, which inherits these.

---

## Architecture Decisions

### The clip-frame boundary: ScrollStrip owns the clip frame and accepts overlay children

This is the crux. The clip frame (`_tabClip`) currently hosts the scrolling content (tab wrappers, its box children) **and** three overlays (`_indicator`, `_dropTint`, `_reorderBar`) that must scroll/clip *with* the content — they share the wrappers' coordinate space ([TabBar.ts:727–737](../src/typescript/lib/component/container/TabBar.ts#L727)). Two boundaries are possible:

- **(A) ScrollStrip owns only the scrolling content.** TabBar would keep its own clip frame for the overlays, and the arrows + native scroll would have to coordinate across two frames. This splits the single source of truth for the scroll offset and forces the overlays into a separate scrolled element — re-introducing the very duplication we're deleting. **Rejected.**
- **(B) ScrollStrip owns the clip frame, exposes it for overlay children, and owns the arrows + scroll.** TabBar adds its tab wrappers through ScrollStrip's content API and raw-appends its indicator/reorder/drop-tint into ScrollStrip's clip element, exactly as it does today with `_tabClip`. The arrows and native scroll stay a single source of truth inside ScrollStrip. **Chosen.**

Boundary (B) is what makes the extraction a net win: ScrollStrip absorbs the clip `Panel`, the box-orientation swap, the arrow build/layout/enable, the native-scroll read/write, the per-item step, and the reveal — while TabBar keeps every tab-specific overlay untouched by appending them into the clip element ScrollStrip exposes.

Concretely, ScrollStrip **is** the clip frame: `class ScrollStrip extends Panel<ScrollStripOptions>`. Its own element is the `overflow:hidden` clip box (one DOM element per class — the clip frame is the class's element, not a nested child). The arrows are its own child `Button` components, raw-appended to its element and positioned in reserved gutters. Content buttons are added via `addItem` (delegating to `Panel.addComponent`, so they are box children). Overlays are accepted via a `getClipElement()` seam returning the clip `Handle` for raw-append.

### ScrollStrip does NOT own the strip's outer band geometry

In TabBar the *outer* band (the strip rectangle, tool-group slot, leading-widget slot, end-align gap, indicator/close positioning) is co-derived with the arrow reserve inside `layoutChrome`. ScrollStrip must not absorb that tab-specific geometry. Instead ScrollStrip exposes the two primitives the outer pass needs:

- `arrowReserve(): number` — `SCROLL_ARROW_SIZE` when overflowing along the main axis (given the content/region extents the owner passes), else 0. TabBar calls this to reserve the gutters before it positions the clip frame, exactly as `computeArrowReserve` does today.
- `layoutArrows(reserve, ...)` / `setContentBox(x, y, w, h)` style placement — TabBar positions ScrollStrip's frame and tells it where the gutters are; ScrollStrip lays its arrows into them.

The owner stays responsible for *where* the clip frame sits and how wide the tab region is; ScrollStrip is responsible for *the scrolling behaviour inside that frame and the arrows in the gutters it's told to use*. This keeps each component single-responsibility and avoids dragging tool-group/lead-widget/end-align logic into the reusable component.

### Orientation as an enum, not a side

TabBar carries a richer `TabSide` (north/south/west/east) + `TabOrientation` (text rotation). ScrollStrip needs only the scroll axis. It takes a 2-value orientation `ScrollStripOrientation = "horizontal" | "vertical"` (horizontal = HBox, main axis X; vertical = VBox, main axis Y). TabBar maps `isVertical()` → the ScrollStrip orientation. This is the minimal axis abstraction; rotation/side stay TabBar's concern.

### Arrows keep TabBar's current glyphs and the existing token; ScrollStrip defines no new tokens

The arrows use registry glyphs `"angle-left"`/`"angle-right"` (horizontal) and `"angle-up"`/`"angle-down"` (vertical), already used by `ensureScrollArrows`/`layoutOverflowArrows`. Their background uses the existing `--ts-ui-tab-toolbar-bg` CSS variable ([Theme.ts:956](../src/typescript/lib/core/Theme.ts#L956), backing `theme.tab.toolbar.background`). **No new theme tokens.** Per CODE_CONVENTIONS, ScrollStrip should not hard-code a *tab* token as its default; instead the arrow background is a `setArrowBackground(color)` setter (cached `_arrowBackground`, `XOptions.arrowBackground`) so a consumer themes the arrows. TabBar passes `"var(--ts-ui-tab-toolbar-bg, #eee)"` when it constructs/recolours the strip, preserving `setBarSurfaceColor`'s recolour path. This keeps the reusable component token-agnostic while preserving exact current appearance.

### `callable()` export + per-subpath barrel

ScrollStrip follows the `_Name`/`Name` alias pattern ([ARCHITECTURE.md:229](../ARCHITECTURE.md)): `const ScrollStripCallable = callable(ScrollStrip); export { ScrollStrip as _ScrollStrip, ScrollStripCallable as ScrollStrip }`. Exported from the **container** barrel `src/typescript/lib/component/container/index.ts` (sits beside `Scrollbar`, `VirtualScroller`, `TabBar`). No root barrel.

### "Compose before specializing" — note the principle is not yet in ARCHITECTURE.md

The brief cites an ARCHITECTURE.md "Compose before specializing" section as the justification for this extraction. **That section does not currently exist in [ARCHITECTURE.md](../ARCHITECTURE.md)** (verified against its heading list). The closest existing guidance is *One DOM element per class* ([ARCHITECTURE.md:37](../ARCHITECTURE.md)) and the `Panel` vs general-`Component` carve-out ([ARCHITECTURE.md:88](../ARCHITECTURE.md)). The extraction still stands on its own merits (net line reduction + a reusable component replacing duplicated machinery), but the implementer should **not** cite a non-existent section. If the principle is to be codified, that is a separate doc change out of scope here.

### Listeners reference named functions

ScrollStrip wires its arrow `action` handlers to bound named fields (`scrollLeadClicked` / `scrollTrailClicked` arrow-function properties), exactly as TabBar does today ([ARCHITECTURE.md:21](../ARCHITECTURE.md), listener rule). No inline closures on the arrow buttons.

---

## Public API (TypeScript Signatures)

```typescript
export type ScrollStripOrientation = "horizontal" | "vertical";

export interface ScrollStripOptions extends PanelOptions {
    orientation?: ScrollStripOrientation;   // default "horizontal"
    scrollable?:  boolean;                    // default true (arrows on overflow); false = clip only
    arrowBackground?: string;                 // arrow button bg; default transparent-ish framework default
    arrowStep?:   number;                     // per-click fallback step (px); default SCROLL_ARROW_STEP
}

class ScrollStrip extends Panel<ScrollStripOptions> {
    constructor(options?: ScrollStripOptions);

    // Content (box children — the scrolling row/column).
    addItem(item: Component): this;
    removeItem(item: Component): this;
    moveItem(item: Component, toIndex: number): this;

    // Overlay seam: the clip element, for raw-appended overlays that must
    // scroll/clip with the content (TabBar's indicator/reorder/drop-tint).
    getClipElement(forceCreate?: boolean): Handle | null;

    // Orientation / mode (cached backing fields + option forwarding).
    setOrientation(orientation: ScrollStripOrientation): this;  // _orientation
    getOrientation(): ScrollStripOrientation;
    setScrollable(value: boolean): this;                        // _scrollable
    isScrollable(): boolean;
    setArrowBackground(color: string): this;                    // _arrowBackground
    setArrowStep(px: number): this;                            // _arrowStep

    // Geometry: owner reserves gutters, then places the frame + arrows.
    // `contentExtent` is the predicted main-axis extent of the items; `regionExtent`
    // is the main-axis space available for items (net of the owner's own chrome).
    arrowReserve(contentExtent: number, regionExtent: number): number;  // 0 or SCROLL_ARROW_SIZE
    // Positions/sizes/enables the two arrows into the gutters of the given band.
    layoutArrows(mainOrigin: number, mainExtent: number, crossOrigin: number,
                 thickness: number, reserve: number): void;

    // The reveal operation: bring item-N (by its laid-out element) into view.
    // One-shot is the owner's concern (TabBar's _scrollToSelected); ScrollStrip
    // exposes the imperative reveal and the owner gates it.
    revealItem(itemElement: Handle): void;

    // Native-scroll passthrough on the main axis (single source of truth).
    mainScroll(): number;
    setMainScroll(value: number): void;
    refreshArrows(): void;            // enable/disable from live offset
    syncScrollOffsets(): this;        // inherited from Component; re-exposed for clarity if needed
}

const ScrollStripCallable = callable(ScrollStrip);
type ScrollStripCallable = ScrollStrip;
export { ScrollStrip as _ScrollStrip, ScrollStripCallable as ScrollStrip };
```

New DOM/state properties (cached setter + backing field + option):

| Setter | Backing field | Option |
|---|---|---|
| `setOrientation` | `_orientation` | `orientation` |
| `setScrollable` | `_scrollable` | `scrollable` |
| `setArrowBackground` | `_arrowBackground` | `arrowBackground` |
| `setArrowStep` | `_arrowStep` | `arrowStep` |

Internal-only fields: `_leadArrow: Button | null`, `_trailArrow: Button | null` (lazily built), `_box`-orientation derived from `_orientation`.

---

## Internal Structure

ScrollStrip's element **is** the clip frame: `overflow:hidden`, an `HBox`/`VBox` layout manager (swapped on `setOrientation`, mirroring `syncToolbarOrientation`), transparent background, cleared insets. The two arrows are child `Button`s raw-appended to the element (above the box children via `setZIndex`, as today). The native scroll lives on the element's cached scroll API.

- `arrowReserve(content, region)` = `_scrollable && content > region + 1 ? SCROLL_ARROW_SIZE : 0` (the `+1` slop from `computeArrowReserve`).
- `mainScroll`/`setMainScroll`/`refreshArrows`/`revealItem` are the renamed `clipScroll`/`setClipScroll`/`refreshScrollArrows`/`revealSelectedIfRequested`, axis-switched on `_orientation` instead of `isVertical()`. `revealItem` takes the item element as a parameter (TabBar passes the active wrapper's element) instead of reaching into `activeEntry()`.
- `layoutArrows` is the renamed `layoutOverflowArrows`, minus the tool/lead/align math — the owner passes the resolved band (`mainOrigin`, `mainExtent`, `crossOrigin`, `thickness`, `reserve`); ScrollStrip derives `leadPos = mainOrigin` and `trailPos = mainOrigin + mainExtent - reserve`.
- `setArrowStep` floors the per-click step; the "≈ one tab" refinement (`scrollStepExtent` reading the first tab's predicted extent) stays in TabBar, which passes its computed step into `setMainScroll` via the arrow handlers — see below.

**Step ownership.** `scrollStepExtent` reads `predictedTabExtent(this._entries[0].button)` — pure tab knowledge. ScrollStrip cannot compute "one tab". Resolution: ScrollStrip's arrow handlers page by `_arrowStep` (the fallback floor), and TabBar overrides per-click distance by setting `_arrowStep` to the live one-tab extent before layout, *or* (cleaner) ScrollStrip exposes a `stepProvider?: () => number` option the arrow handlers consult at click time. **Chosen:** `arrowStep` is a number option for the simple reuse case; TabBar passes a `() => this.scrollStepExtent()` via a `setStepProvider(fn)` setter so the step tracks the live font. This keeps tab-specific extent math in TabBar while the paging mechanic lives in ScrollStrip.

---

## What moves, what stays — net-complexity ledger

**Deleted from TabBar** (≈250 lines of methods + 6 fields/constants):
`computeArrowReserve`, `layoutOverflowChrome`, `ensureScrollArrows`, `layoutOverflowArrows`, `hideOverflowArrows`, `clipScroll`, `clipScrollMax`, `setClipScroll`, `refreshScrollArrows`, `scrollLeadClicked`, `scrollTrailClicked`, `scrollStrip`, `revealSelectedIfRequested`, plus `SCROLL_ARROW_SIZE`, `SCROLL_ARROW_STEP`, `_scrollLeadButton`, `_scrollTrailButton`. The clip-box orientation swap in `syncToolbarOrientation` and the `setOverflow("hidden")` initialisation move into ScrollStrip.

**Stays in TabBar (thinner consumer surface):**
- `_tabClip` becomes a `ScrollStrip` (was a `Panel`). Tab wrappers added via `_tabClip.addItem`; indicator/reorder/drop-tint raw-appended to `_tabClip.getClipElement()`.
- `_scrollable`/`_scrollToSelected` stay as TabBar state (they gate *when* to reveal — a tab-policy concern), forwarded to `_tabClip.setScrollable(...)`. `_scrollToSelected` one-shot logic stays; it calls `_tabClip.revealItem(activeWrapperElement)` instead of the deleted local method.
- `scrollStepExtent` stays (tab extent math) and is wired in via `_tabClip.setStepProvider(() => this.scrollStepExtent())`.
- `layoutChrome` keeps the *outer* geometry but calls `_tabClip.arrowReserve(predictTabsExtent(), available)` for the gutter and `_tabClip.layoutArrows(...)` for arrow placement, replacing `computeArrowReserve` + `layoutOverflowChrome`.
- `setBarSurfaceColor` calls `_tabClip.setArrowBackground(color)` instead of poking the two button fields.
- `containsTarget` hit test queries via the clip element / a `ScrollStrip.containsArrow(target)` helper instead of the two arrow fields.
- `applyTabWidths`'s `box.setOverflowing` + `_tabClip.doLayout` + `syncScrollOffsets` stay (they drive tab widths, a tab concern), now operating on the ScrollStrip's box.

**Net:** TabBar sheds ~250 method lines + the arrow fields/constants. ScrollStrip is ~180–210 lines (the same logic, axis-generalised on an `orientation` field, plus the small public API surface and `callable` boilerplate). The delta is a real reduction *and* yields a reusable component — the win is the reuse, not the raw line count, which is roughly break-even to modestly negative. **If, during implementation, the step-provider / band-placement seam proves to need more than ~3 small methods to keep `layoutChrome` working, reassess whether the boundary is still a net win before proceeding** (see Potential Challenges).

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/container/ScrollStrip.ts`.** `class ScrollStrip extends Panel<ScrollStripOptions>`. Move `SCROLL_ARROW_SIZE`/`SCROLL_ARROW_STEP` constants in. Constructor: set `overflow:hidden`, transparent bg, cleared insets, the HBox/VBox per `_orientation`; dispatch options through typed setters. → verify: `npx tsc --noEmit` compiles the new file in isolation (no TabBar edits yet).
2. **Port the scroll/clip/arrow methods** from TabBar into ScrollStrip, axis-switched on `_orientation`: `arrowReserve`, `ensureArrows` (was `ensureScrollArrows`, glyphs + `setArrowBackground`), `layoutArrows`, `hideArrows`, `mainScroll`/`setMainScroll`/`mainScrollMax`, `refreshArrows`, `revealItem(itemElement)`, the two arrow handlers + paging via `_arrowStep`/step-provider. Add `addItem`/`removeItem`/`moveItem` (delegate to `addComponent`/`removeComponent`/`moveComponent`), `getClipElement`, `setStepProvider`, `setOrientation` (swap the box). → verify: `npx tsc --noEmit`.
3. **`callable()` export + barrel.** Add the `_ScrollStrip`/`ScrollStrip` alias export; add `export { ScrollStrip }` + `export type { ScrollStripOptions, ScrollStripOrientation }` to `src/typescript/lib/component/container/index.ts`. → verify: import resolves; `npx tsc --noEmit`.
4. **Rewire TabBar to consume ScrollStrip.** Change `_tabClip: Panel` → `_tabClip: ScrollStrip`. Constructor: pass `{ orientation, scrollable: false }` defaults, `setArrowBackground("var(--ts-ui-tab-toolbar-bg, #eee)")`, `setStepProvider(() => this.scrollStepExtent())`. `init`: raw-append indicator/dropTint/reorderBar into `_tabClip.getClipElement(true)`. Replace `addComponent`/`removeComponent`/`moveComponent` calls with `addItem`/`removeItem`/`moveItem`. → verify: `npx tsc --noEmit`.
5. **Delete the moved machinery from TabBar:** the 13 methods, the two arrow fields, the two constants. Re-point the survivors: `layoutChrome` → `_tabClip.arrowReserve(...)` + `_tabClip.layoutArrows(...)`; `applyTabWidths`/`syncToolbarOrientation` operate on the ScrollStrip box (orientation swap moves into `_tabClip.setOrientation`); `_scrollToSelected` flush → `_tabClip.revealItem(activeWrapperEl)`; `setBarSurfaceColor` → `_tabClip.setArrowBackground`; `containsTarget` → ScrollStrip arrow check. → verify: `grep -n "_scrollLeadButton\|_scrollTrailButton\|ensureScrollArrows\|SCROLL_ARROW" src/.../TabBar.ts` returns zero; `npx tsc --noEmit`.
6. **Run the test suite + typecheck.** → verify: `npm test` green, `npx tsc --noEmit` clean.
7. **Manual smoke** (offline-untestable behaviour): tab strips on all four sides overflow, arrows appear/page/disable, reveal-on-select works, reorder/indicator/close still scroll with the content. → verify: in the demo app (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` (barrel export) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (delete machinery, consume ScrollStrip) |
| Modify | `docs/.vitepress/config.mts`, `docs/components/index.md` (new component page — see Documentation Impact) |
| Create | `docs/components/scroll-strip.md` (curated page) |

---

## Expected Behaviour

**Unit-testable offline** (pure logic, no DOM events/geometry):
- `arrowReserve(content, region)` returns `SCROLL_ARROW_SIZE` when `scrollable` and `content > region + 1`; `0` when not scrollable, or when `content ≤ region + 1` (the slop boundary: `content == region + 1` → 0; `content == region + 2` → reserve).
- `setOrientation("vertical")` swaps the box to `VBox`; `"horizontal"` → `HBox`; a no-op when already that orientation (no new box instance).
- `setScrollable(false)` → `arrowReserve` always 0.
- `addItem`/`removeItem`/`moveItem` change the box child set/order (assert via the component list).
- `setArrowStep`/`setStepProvider` resolve the per-click delta (provider wins when set).

**Manual-verify (DOM scroll/geometry/events — the offline harness can't exercise native scroll or rects):**
- Arrows appear only on overflow; lead disabled at offset 0, trail disabled at the last page (1px slop).
- Lead/trail click pages by one item (step-provider value) and re-evaluates arrow enable state.
- `revealItem` nudges the minimum to bring a partially-clipped item fully into view; a fully-visible item → no scroll.
- Horizontal and vertical orientations both clip, scroll, and place arrows in the correct gutters.
- **In TabBar:** indicator, reorder bar, drop tint, and close buttons all scroll/clip *with* the tabs (they live in the clip element); tool group and leading widget stay fixed outside it; `setBarSurfaceColor` recolours the arrows; all four sides behave identically to pre-change.

Derive tests from the contract above (signatures + the slop/boundary semantics), **not** from current output.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm test` — green (new ScrollStrip unit tests for the offline-testable behaviours above; existing TabBar/Tab tests unchanged and passing).
- `grep -rn "SCROLL_ARROW\|_scrollLeadButton\|_scrollTrailButton\|ensureScrollArrows\|layoutOverflowArrows\|revealSelectedIfRequested" src/typescript/lib/component/container/TabBar.ts` — expect zero matches.
- Manual smoke on the **Tab demo** screen (the screen exercising overflowing strips on north/south/west/east, reorder, close, tools, leading widget): arrows page/disable, reveal-on-select, overlays scroll with content. Toggle the theme (light/dark) — arrow background tracks `--ts-ui-tab-toolbar-bg`.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbol** `ScrollStrip` (+ `ScrollStripOptions`, `ScrollStripOrientation`): re-export from the `component/container` barrel (done in Step 3). Add `@category Components`. Verify it lands in `docs/api/components/index.md` (or the container group's index) after `npm run docs:build`.
- **New component page** `docs/components/scroll-strip.md`: short usage (a horizontal rail of buttons that scrolls on overflow), the orientation option, the reveal method. Link it in `docs/.vitepress/config.mts` sidebar and add it to `docs/components/index.md` catalog.
- **JSDoc cross-bucket:** ScrollStrip's JSDoc may `{@link Panel}`/`{@link Button}` only if they're in the same bucket; otherwise use the markdown-link form (`[\`Button\`](/api/.../Button)`). Do not `{@link}` any TabBar-internal symbol.
- TabBar's public API is unchanged (no consumer-visible TabBar surface moves), so no TabBar doc edits beyond a possible one-line mention that the strip is now ScrollStrip-backed (optional).

---

## Potential Challenges

- **Step-provider seam:** if wiring `scrollStepExtent` through `setStepProvider` proves clumsier than a plain `arrowStep` number, fall back to TabBar setting `_tabClip.setArrowStep(this.scrollStepExtent())` immediately before each layout — mitigation: both paths are tiny, pick whichever keeps `layoutChrome` shortest.
- **Reveal timing:** `revealSelectedIfRequested` runs *after* `_tabClip.doLayout()` + `syncScrollOffsets()` so it reads laid-out rects. TabBar must preserve that ordering when it calls `_tabClip.revealItem(...)` — mitigation: keep the `syncScrollOffsets` call in `layoutChrome` right before the reveal, exactly as today.
- **Overlay z-order:** indicator (z 2) sits below the arrows (z 3); the arrows are now ScrollStrip-owned children appended to its element, while the overlays are appended to the clip element — confirm the arrow z-index still wins over the scrolled content and indicator after the re-parent. Mitigation: keep the arrows' `setZIndex(3)` and verify in the smoke test.
- **Net-line break-even:** if the consumer seam balloons, the extraction may not reduce raw lines (it still wins on reuse) — mitigation: reassess at Step 5 per the ledger note; the reusability is the load-bearing justification, not line count.
- **Box `setOverflowing` ownership:** `applyTabWidths` calls `box.setOverflowing(!vertical, vertical)` on the clip box — that box now lives inside ScrollStrip. TabBar reaches it via `_tabClip.getLayoutManager()`. Mitigation: keep that call in TabBar (it's tab-width policy) operating on the ScrollStrip's box, or expose a thin `setMainOverflowing(bool)` on ScrollStrip if the cast is ugly.

---

## Critical Files

- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — source of the machinery; read 456–740 (fields/construction/init), 1024–1077 (`setScrollable`/`setCompact`), 1980–2105 (`applyTabWidths`/`syncToolbarOrientation`), 2199–2851 (the scroll methods + `layoutChrome`).
- [`src/typescript/lib/core/Component.ts:2884–3010`](../src/typescript/lib/core/Component.ts#L2884) — the cached native-scroll API ScrollStrip relies on.
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — the base class (clamps to explicit min/max, lets overflow clip/scroll — exactly the clip-frame contract).
- [`src/typescript/lib/component/container/index.ts`](../src/typescript/lib/component/container/index.ts) — the barrel to export from.
- [`src/typescript/lib/core/Theme.ts:252–262,956–957`](../src/typescript/lib/core/Theme.ts#L252) — the `tab.toolbar` tokens / `--ts-ui-tab-toolbar-bg` var the arrows use.
- [`ARCHITECTURE.md:37,88,229`](../ARCHITECTURE.md) — one-element-per-class, Panel vs Component, `callable()` export.

---

## Non-Goals

- **ToolBar is not refactored.** ToolBar solves overflow via collapse-to-menu (`_overflowButton`/`_overflowMenu`, [ToolBar.ts:136–137](../src/typescript/lib/component/menubar/ToolBar.ts#L136)). ScrollStrip is the reusable scroll-rail alternative and is *designed* to be consumable by ToolBar/breadcrumb/chip rails later — but porting ToolBar (or any other consumer) onto it is explicitly out of scope here. This plan extracts the component and proves it via the TabBar consumer only.
- **No new theme tokens.** Arrows reuse the existing `--ts-ui-tab-toolbar-bg` via TabBar; ScrollStrip stays token-agnostic with a `setArrowBackground` setter.
- **No `TabPanel` rebuild.** The wider "rebuild TabPanel from VBox/HBox+Card" rewrite was rejected as relocating complexity; this plan does only the ScrollStrip extraction.
- **No "Compose before specializing" doc change.** That ARCHITECTURE.md section does not exist; codifying it is a separate task.
- **Tab-specific overlays stay in TabBar.** Indicator, reorder bar, drop tint, close buttons, tool group, leading widget, end-align/tool/lead band geometry remain TabBar's responsibility — ScrollStrip only hosts them in its clip element and owns the scroll/arrow mechanic.
