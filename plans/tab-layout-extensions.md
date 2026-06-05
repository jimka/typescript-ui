# Tab Layout Extensions — Implementation Plan

## Overview

Four related capabilities are added to the [`Tab`](../src/typescript/lib/layout/Tab.ts) layout manager and surfaced through [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts): (1) start/end tab-button alignment, (2) tab-strip placement on any of the four sides with text-orientation control on the vertical sides, (3) tool buttons pinned at the far end of the strip, and (4) scroll-on-overflow for the tab buttons reusing the HBox/VBox shrink-to-min-then-overflow mechanism. They are one cohesive change because they all touch the same construction path: the toolbar `Component`, its inner `HBox`, the `doLayout` placement of the toolbar + content area, and the per-side border theming in [`Theme.ts`](../src/typescript/lib/core/Theme.ts).

Today the strip is hard-wired to the top: `doLayout` parks `_toolbar` at `containerInsets.top`, runs it full-width, and places the visible content beneath it ([Tab.ts:1119-1191](../src/typescript/lib/layout/Tab.ts#L1119)). The toolbar's inner layout is a horizontal `HBox` ([Tab.ts:251](../src/typescript/lib/layout/Tab.ts#L251)). Width mode `"equal"` already shrinks-to-fit and collapses to `"fill"` when tabs overflow ([Tab.ts:466-475](../src/typescript/lib/layout/Tab.ts#L466)); there is no scroll path — long strips currently rely on the toolbar's own clipping (see the `doLayout` comment at [Tab.ts:1165](../src/typescript/lib/layout/Tab.ts#L1165)).

Per-side tab-button borders are already themed via [`tabButtonSideVars`](../src/typescript/lib/core/Theme.ts#L551) and applied in `buildTabEntry` ([Tab.ts:738-767](../src/typescript/lib/layout/Tab.ts#L738)), so side placement reuses that machinery rather than inventing new border tokens.

---

## Architecture Decisions

### Tool buttons belong in the `Tab` layout manager, not `TabPanel`

The tool-button slot must occupy real space in the tab strip at the end opposite the tab buttons, and the strip's available width for tabs (`available` at [Tab.ts:1130](../src/typescript/lib/layout/Tab.ts#L1130)) must subtract that slot — both are layout-pass concerns the manager already owns. `TabPanel` has no handle on the toolbar `Component` or its `HBox`; pushing the feature there would force `TabPanel` to reach through `getTabManager()` for every geometry decision and duplicate the side/orientation logic. The manager already owns analogous overlay children (the `_indicator`, the per-tab close buttons) and positions them by hand in `doLayout`, so a tool-button group is the same shape of responsibility. **Decision:** add the tool buttons as a second laid-out child inside `_toolbar` (a small `Component` running its own `HBox`), owned and positioned by `Tab`. `TabPanel` gets a thin `addTabTool(button)` / `tabTools` options forwarder, mirroring the existing `addTab` convenience wrappers, but holds no layout logic.

### Alignment composes with side via the inner box, not a second container

`"start"` / `"end"` is a *main-axis* alignment of the tab-button group within the strip. The cleanest expression that survives all four sides is: keep the tab buttons in their own `HBox`/`VBox` group child, and place that group child at the leading edge (`start`) or trailing edge (`end`) of the strip during `doLayout`, with the leftover space empty (or holding the tool group at the always-opposite end). "start" = the strip's leading edge in reading order (left for north/south, top for west/east); "end" = trailing edge. Tool buttons always sit at the opposite extreme regardless of alignment, so when tabs are `"end"`-aligned the tools sit at the leading edge. This keeps alignment a pure placement decision and avoids a flex-justify abstraction the framework doesn't have. **Note:** alignment is meaningful only when the tabs don't fill the strip — in `"fill"` width mode (and in `"equal"` after it collapses to fill) the group spans the whole strip and alignment is a no-op, matching the existing "leftover space empty" behaviour documented at [Tab.ts:39-41](../src/typescript/lib/layout/Tab.ts#L39).

### Vertical tabs use CSS `writing-mode`, not `transform: rotate`

West/east placement with vertical text needs the tab buttons rotated 90°. `transform: rotate()` does **not** reflow layout — the element keeps its horizontal box, so the `HBox`/measurement code would still see the un-rotated width/height and hit-testing would be offset from the painted glyph. CSS `writing-mode: vertical-rl` / `vertical-lr` (with `text-orientation`) genuinely rotates the *layout box*: the browser reports the rotated width/height through `getBoundingClientRect`, so the existing preferred-size measurement and the roving-tabindex hit targets stay correct with no manual transform math. Clockwise vs counter-clockwise is selected by `vertical-rl` (CW, text reads top-to-bottom on the right side) vs `vertical-lr` + a 180° flip, or more simply `vertical-rl` vs `vertical-lr`; the two modes map to the requested CW/CCW. **Decision:** vertical orientation is a `writing-mode` applied to each tab button's element (via a tracked element-style setter that survives `applyStyle`), and the strip's inner box swaps to `VBox` when the side is west/east. `transform` is rejected for the hit-test/measurement breakage. Horizontal-text-on-vertical-side ("horizontal" orientation) keeps the buttons un-rotated and just stacks them vertically in a `VBox`.

### Scroll/overflow reuses the box overflow mechanism wholesale

The requested overflow behaviour — shrink toward minSize, then once minSize no longer fits switch to preferred and overflow — is *exactly* what `HBox`/`VBox` preferred-mode `doLayout` already does when `isOverflowingX/Y()` is set ([HBox.ts:660-680](../src/typescript/lib/layout/HBox.ts#L660)), gated by the host's `Panel.setAutoScroll` forwarding `setOverflowing` to the manager ([Panel.ts:244-252](../src/typescript/lib/core/Panel.ts#L244)). **Decision:** the tab toolbar's inner box is the thing that overflows. When tab scrolling is enabled, the manager (a) switches the inner box to `"preferred"` mode and calls `setOverflowing(true,false)` (or `(false,true)` for vertical sides) on it, (b) makes the toolbar `Component` itself the scroll viewport. Two presentations of the overflow are offered via a `tabOverflowMode` option: `"scrollbar"` sets the toolbar's `overflow` to `auto` on the main axis (thin native scrollbar, reusing `reserveContentFrame` via the box's existing call); `"arrows"` keeps the toolbar `overflow: hidden` and adds leading/trailing arrow buttons that scroll the toolbar element's `scrollLeft`/`scrollTop`. Both share the same box-overflow sizing; only the chrome differs. The existing content-area overflow path at [Tab.ts:1172-1182](../src/typescript/lib/layout/Tab.ts#L1172) is for the *content panel* and is untouched — tab-strip scrolling is independent of `Panel.setAutoScroll` on the host.

### A single `applyTabWidths` rewrite, not four parallel branches

`applyTabWidths` already centralises every width mode. Side, alignment, and overflow all feed into it (vertical sides clamp *height* not width; overflow disables the `"equal"`→`"fill"` collapse so buttons keep preferred size and scroll instead). **Decision:** generalise `applyTabWidths` to a main-axis abstraction (read the inner box's `setMode`/`setOverflowing`, set min/max on the axis that matters for the current side) rather than adding side-specific copies.

---

## Public API (TypeScript Signatures)

New option-type unions in `Tab.ts`, declared in the existing `TabWidthMode` style (string-literal unions, `@category Layouts`):

```typescript
/** Where the tab strip sits relative to the content area. */
export type TabSide = "north" | "south" | "west" | "east";

/** Main-axis alignment of the tab-button group within the strip. */
export type TabAlign = "start" | "end";

/**
 * Text orientation for tab buttons on the vertical sides (west/east).
 * Ignored for north/south.
 */
export type TabOrientation = "horizontal" | "vertical-cw" | "vertical-ccw";

/** How an overflowing tab strip is scrolled. `"none"` keeps today's compress-to-fit. */
export type TabOverflowMode = "none" | "scrollbar" | "arrows";
```

`Tab` gains four DOM-affecting properties, each with the typed-setter + cached-field + `TabOptions` field triad. Backing fields declared with explicit types; `applyOptions` dispatches each only when the option is `!== undefined` (mirroring the existing `tabWidthMode` block at [Tab.ts:299-313](../src/typescript/lib/layout/Tab.ts#L299)):

```typescript
class Tab extends LayoutManager {
    private _tabSide: TabSide = "north";
    private _tabAlign: TabAlign = "start";
    private _tabOrientation: TabOrientation = "horizontal";
    private _tabOverflowMode: TabOverflowMode = "none";

    setTabSide(side: TabSide): this;        getTabSide(): TabSide;
    setTabAlign(align: TabAlign): this;     getTabAlign(): TabAlign;
    setTabOrientation(o: TabOrientation): this; getTabOrientation(): TabOrientation;
    setTabOverflowMode(m: TabOverflowMode): this; getTabOverflowMode(): TabOverflowMode;

    /** Adds a tool button at the far end of the strip (opposite the tabs). */
    addTabTool(button: Component): this;
    /** Removes a previously-added tool button. */
    removeTabTool(button: Component): this;
}

interface TabOptions extends LayoutManagerOptions {
    // ...existing...
    tabSide?: TabSide;
    tabAlign?: TabAlign;
    tabOrientation?: TabOrientation;
    tabOverflowMode?: TabOverflowMode;
    tabTools?: Component[];
}
```

Each setter caches the value, then `this.getContainer()?.scheduleLayout()` — **no DOM work in the setter** (it may run during `super()` via `applyOptions` before the toolbar element exists; see the Setters-must-defer-DOM-work trap). `setTabOrientation` must apply `writing-mode` to existing tab-button elements; it caches the value and re-applies on the next `doLayout` (which already runs per pass), not inline.

`TabPanel` gets the matching forwarders, following the existing `setTabWidthMode` pattern at [TabPanel.ts:213-226](../src/typescript/lib/component/container/TabPanel.ts#L213):

```typescript
class TabPanel<...> extends Panel<TOptions> {
    setTabSide(side: TabSide): this;        getTabSide(): TabSide;
    setTabAlign(align: TabAlign): this;     getTabAlign(): TabAlign;
    setTabOrientation(o: TabOrientation): this; getTabOrientation(): TabOrientation;
    setTabOverflowMode(m: TabOverflowMode): this; getTabOverflowMode(): TabOverflowMode;
    addTabTool(button: Component): this;
}

interface TabPanelOptions extends PanelOptions {
    // ...existing...
    tabSide?: TabSide;
    tabAlign?: TabAlign;
    tabOrientation?: TabOrientation;
    tabOverflowMode?: TabOverflowMode;
    tabTools?: Component[];
}
```

`TabPanel`'s constructor dispatches each `options?.tabX !== undefined` block exactly like the existing ones at [TabPanel.ts:85-99](../src/typescript/lib/component/container/TabPanel.ts#L85), and loops `options?.tabTools` into `addTabTool`.

---

## Theme Tokens

No new tokens are strictly required: per-side borders already exist via [`tabButtonSideVars`](../src/typescript/lib/core/Theme.ts#L551), and side placement only changes *which* sides carry the visible border, which is consumer/theme-driven through the same `--ts-ui-tab-button-border-{top,right,bottom,left}` vars already emitted at [Theme.ts:630](../src/typescript/lib/core/Theme.ts#L630). The under-border (`--ts-ui-tab-toolbar-border`) is the rule between strip and content; on south/west/east it moves to the corresponding inner edge — this is handled by `applyUnderBorder` choosing the border side from `_tabSide`, **reusing the existing token**, not adding one.

One **optional** token only if arrow buttons need themed chrome distinct from the toolbar background — defer unless the implementation shows the default toolbar/button tokens are insufficient:

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-tab-scroll-arrow-bg` | `transparent` | `transparent` | Background of the overflow scroll arrows (falls back to toolbar bg) |

If added, it lands in `Theme` (under `tab`), `ClassicTheme`/`ModernTheme` (`DefaultTheme`), `DarkTheme`, and `themeToVars` ([Theme.ts:626-638](../src/typescript/lib/core/Theme.ts#L626)). **Preference: do not add it** unless verification shows the arrows are invisible against the strip — keep the change surgical.

---

## Internal Structure

**Strip composition.** The toolbar keeps its current role but its inner box becomes orientation-aware. Inside `_toolbar`, three logical regions, each a child laid out by the toolbar's own box (`HBox` for north/south, `VBox` for west/east):

1. tab-button group (the existing per-tab `wrapper`s),
2. a flexible empty gap,
3. the tool-button group.

Rather than introduce a third nested container, the simplest expression that matches the codebase: keep the per-tab wrappers as direct toolbar children (as today), and make the **tool group** a single trailing child + use placement order to realise alignment. The existing `_indicator` overlay and close-button hand-placement show the manager already mixes laid-out children with hand-positioned overlays, so `doLayout` can:

- For `start` align: tab wrappers lead, tool group trails (natural order).
- For `end` align: hand-position tab wrappers at the trailing edge after the box runs, OR (cleaner) set the tab group's leading offset. Prefer driving alignment by the box: when `end`, insert the tool group *first* and a flexible spacer, then tabs — but the framework Spacer/weight path (`HBox` preferred-mode `weight` cells, [HBox.ts:697](../src/typescript/lib/layout/HBox.ts#L697)) gives a weighted gap for free. **Decision:** realise the gap with a zero-content weighted spacer child so the box positions everything; alignment flips whether the spacer sits before or after the tab group.

**Vertical sides.** When `_tabSide` is west/east, the toolbar's box is a `VBox`, the toolbar is sized to a fixed *width* (the strip thickness) and full container *height*, and each tab button's element gets `writing-mode: vertical-rl` (cw) or `vertical-lr` (ccw); horizontal orientation leaves writing-mode unset. The `setPreferredSize(0, 30)` strip-thickness seed at [Tab.ts:255](../src/typescript/lib/layout/Tab.ts#L255) becomes side-aware (thickness on the cross axis).

**`doLayout` placement.** Generalise the toolbar-then-content placement at [Tab.ts:1119-1191](../src/typescript/lib/layout/Tab.ts#L1119) into a side switch:

- north: toolbar at top, content below (current).
- south: content at top, toolbar at bottom.
- west: toolbar at left (fixed width), content to the right.
- east: content at left, toolbar at right.

The `available` computation at [Tab.ts:1130](../src/typescript/lib/layout/Tab.ts#L1130) subtracts the tool-group extent and (for vertical sides) reads height instead of width.

**Scroll viewport.** When `_tabOverflowMode !== "none"`: switch the inner box to `"preferred"` mode, call `box.setOverflowing(mainAxisX, mainAxisY)`, and set the toolbar element's overflow on the main axis (`auto` for `"scrollbar"`, `hidden` + arrows for `"arrows"`). The box's `reserveContentFrame` ([LayoutManager.ts:189](../src/typescript/lib/layout/LayoutManager.ts#L189)) then sizes the scrollable content frame to the buttons' extent. Arrow buttons scroll `_toolbar.getElement().scrollLeft/scrollTop`.

---

## Ordered Implementation Steps

1. **Add the option-type unions** (`TabSide`, `TabAlign`, `TabOrientation`, `TabOverflowMode`) to `Tab.ts`, each with JSDoc + `@category Layouts`, beside `TabWidthMode`. Add the matching optional fields to `TabOptions`.

2. **Add backing fields + typed setters/getters** to `Tab` for all four, plus `addTabTool`/`removeTabTool` and a private `_tabTools: Component[]` and tool-group child. Setters cache + `scheduleLayout()` only — no DOM. Dispatch from `applyOptions`. → verify: `npx tsc --noEmit` clean.

3. **Make `applyUnderBorder` side-aware** — choose the bordered edge from `_tabSide`, reusing `--ts-ui-tab-toolbar-border`. → verify: north still draws bottom rule.

4. **Generalise `applyTabWidths`** to a main-axis abstraction: clamp width for north/south, height for west/east; when `_tabOverflowMode !== "none"` skip the `"equal"`→`"fill"` collapse and instead set the inner box to `"preferred"` + `setOverflowing` on the main axis.

5. **Rework `doLayout`** into a side switch for toolbar + content placement; subtract the tool-group extent from `available`; apply `writing-mode` to tab-button elements per `_tabOrientation`; position the tool group and the alignment spacer. Keep the indicator/close-button hand-placement working per side (indicator slides along the main axis; for vertical sides it pins to the inner edge and slides vertically). → verify: each side renders in `TabDemoPanel`.

6. **Add the overflow chrome:** `"scrollbar"` sets toolbar element overflow `auto` on the main axis; `"arrows"` adds two arrow `Button`s (leading/trailing) that scroll the toolbar element and hide when no overflow. Reuse the box's `reserveContentFrame`. → verify: a strip with many tabs scrolls instead of compressing when `tabOverflowMode !== "none"`.

7. **Forward everything through `TabPanel`** — setters/getters, options dispatch in the constructor, `tabTools` loop. → verify: `npx tsc --noEmit` clean.

8. **Barrels:** export the four new types from `src/typescript/lib/layout/index.ts` (the `Tab` `export type {...}` line). `TabPanelOptions` already re-exported — no new container symbol. → verify: `grep -n "TabSide" src/typescript/lib/layout/index.ts`.

9. **Demo:** extend `src/typescript/TabDemoPanel.ts` with examples of each side, alignment, orientation, a tool button, and an overflowing scrollable strip.

10. **Docs:** update per the Documentation Impact section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` (only if the optional arrow token is added; otherwise `applyUnderBorder` change is in `Tab.ts`) |
| Modify | `src/typescript/lib/layout/index.ts` (export the four new type unions) |
| Modify | `src/typescript/TabDemoPanel.ts` (demo coverage) |
| Modify | `docs/layouts/Tab.md`, `docs/components/TabPanel.md` (curated pages) |

---

## Verification

- `npx tsc --noEmit` — zero errors.
- `grep -n "TabSide\|TabAlign\|TabOrientation\|TabOverflowMode" src/typescript/lib/layout/index.ts` — all four exported.
- Manual smoke in `TabDemoPanel` (dev server, see MEMORY dev URLs): each of north/south/west/east renders the strip on the correct edge; `start`/`end` move the tab group to the correct extreme on every side; west/east `vertical-cw`/`vertical-ccw` rotate text the opposite directions and the buttons remain clickable on the painted glyph (hit-test check); a tool button sits at the end opposite the tabs and survives `start`/`end` flips; with `tabOverflowMode: "scrollbar"` a long strip scrolls (thin scrollbar) instead of compressing; with `"arrows"` the arrow buttons appear only when overflowing and scroll the strip.
- Theme toggle (light/dark/classic): the under-border moves to the correct edge per side and per-side button borders still resolve.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbols** (`TabSide`, `TabAlign`, `TabOrientation`, `TabOverflowMode`): re-export from the `layout` subpath barrel `src/typescript/lib/layout/index.ts` (no root barrel). `@category Layouts` on each. They land under `docs/api/layout/type-aliases/` after build.
- **New `TabPanel` methods/options** appear automatically in the generated `docs/api/component/container/` pages once JSDoc'd.
- **Curated pages:** update `docs/layouts/Tab.md` (side/align/orientation/overflow sections) and `docs/components/TabPanel.md` (the forwarders). Both are already linked in `docs/.vitepress/config.mts` ([sidebar entries at config.mts:126,154](../docs/.vitepress/config.mts)) — no new sidebar entry needed since no new page is created.
- **Cross-bucket JSDoc:** `TabPanel` (component bucket) referencing the new layout types must use the markdown-link form, e.g. ``[`TabSide`](/api/layout/type-aliases/TabSide)``, not `{@link}` (per docs-conventions cross-bucket rule).
- No renames or removals.

---

## Potential Challenges

- **`writing-mode` survives `applyStyle`.** Like the indicator's bar geometry ([Tab.ts:189-209](../src/typescript/lib/layout/Tab.ts#L189)), an inline `writing-mode` written outside a tracked setter is wiped by `Component.applyStyle`. Mitigation: write it through a tracked element-style setter, or re-apply it in `doLayout` each pass (which already re-runs and re-positions everything).
- **Vertical preferred-size measurement.** Tab buttons measure their preferred size from content; `writing-mode` swaps the reported width/height. Mitigation: chosen `writing-mode` (not `transform`) makes the browser report rotated metrics, so `applyTabWidths` clamps the correct axis without manual swap math — but confirm `ToggleButton.getPreferredSize` reflects the rotated box before relying on it.
- **Indicator + close buttons per side.** The selection bar and close buttons are hand-positioned for north today. Mitigation: drive their main-axis offset from a side helper so they track the active wrapper on every side; for vertical sides the indicator pins to the inner edge and uses height for its extent.
- **Scroll frame vs indicator overlay.** `reserveContentFrame` re-parents children into a content frame; the raw-appended `_indicator` overlay must not be swept into it. Mitigation: the indicator is raw-appended to the toolbar element, not enrolled as a box child, so the frame (built from `getComponents()`) already excludes it — verify after wiring overflow.
- **`equal`-mode collapse vs overflow.** The existing `"equal"`→`"fill"` collapse ([Tab.ts:466](../src/typescript/lib/layout/Tab.ts#L466)) directly contradicts scroll-on-overflow. Mitigation: gate the collapse on `_tabOverflowMode === "none"`; when scrolling is on, leave buttons at preferred and let the box overflow.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — the whole change; read `doLayout`, `applyTabWidths`, `buildTabEntry`, `applyUnderBorder`, the `TabIndicator` `applyStyle` replay.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the shrink-to-min-then-overflow `doLayout` and `computeTotalMinSize`; `BoxMode`/`BoxOverflowSizing` option-type style.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `setOverflowing`/`isOverflowingX/Y`, `reserveContentFrame`, `placeComponent`.
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` → `setOverflowing` forwarding and the `AutoScrollMode` union (option-type precedent).
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `tabButtonSideVars` ([551](../src/typescript/lib/core/Theme.ts#L551)), `themeToVars` ([566](../src/typescript/lib/core/Theme.ts#L566)), the `tab` block ([177](../src/typescript/lib/core/Theme.ts#L177)).
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — forwarder pattern.
- `CODE_CONVENTIONS.md` / `ARCHITECTURE.md` — typed-setter triad, one-element-per-class, render-time DOM deferral, magic-number documentation (strip thickness, writing-mode constants).

---

## Non-Goals

- **Reordering or dragging tabs.** Out of scope; alignment/side are static layout decisions.
- **Per-tab side/orientation overrides.** Side/orientation are strip-wide.
- **Animating side transitions.** Switching `tabSide` at runtime re-lays out without a transition; the existing fade/indicator animations are unchanged.
- **Replacing the content-area overflow path.** The host `Panel.setAutoScroll` content-scroll logic at [Tab.ts:1172-1182](../src/typescript/lib/layout/Tab.ts#L1172) stays; tab-strip scrolling is a separate, strip-local mechanism.
- **A new arrow-button component.** Reuse the existing `Button`/`Glyph`; only add a theme token if verification proves the arrows are invisible.
