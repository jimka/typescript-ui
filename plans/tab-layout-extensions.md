---
depends-on:
  - component-move-helper.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
---

# Tab Layout Extensions — Implementation Plan

## Overview

Six related capabilities are added to the [`Tab`](../src/typescript/lib/layout/Tab.ts) layout manager and surfaced through [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts): (1) start/end tab-button alignment, (2) tab-strip placement on any of the four sides with text-orientation control on the vertical sides, (3) tool buttons pinned at the far end of the strip, (4) scroll-on-overflow for the tab buttons reusing the HBox/VBox shrink-to-min-then-overflow mechanism, (5) **within-strip drag-and-drop reordering** of tab headers, and (6) **compact tab buttons** with reduced insets. They are one cohesive change because they all touch the same construction path: the toolbar `Component` ([Tab.ts:222](../src/typescript/lib/layout/Tab.ts#L222)), its inner `HBox` ([Tab.ts:251](../src/typescript/lib/layout/Tab.ts#L251)), the per-tab `wrapper`/`ToggleButton` built in `buildTabEntry` ([Tab.ts:727](../src/typescript/lib/layout/Tab.ts#L727)), the `doLayout` placement of the toolbar + content area ([Tab.ts:1119-1191](../src/typescript/lib/layout/Tab.ts#L1119)), and the per-side border theming in [`Theme.ts`](../src/typescript/lib/core/Theme.ts).

Features 5 and 6 share the same main-axis abstraction the side/orientation features introduce: the reorder insertion bar and its slot math run along the strip's main axis (X for north/south, Y for west/east), and the compact insets feed the same `applyTabWidths` clamp. Reorder is consolidated here from the sibling plan [`tab-detach-redock.md`](tab-detach-redock.md), which retains only tear-off detach / re-dock and now **depends on** this plan for the reorder wiring (see the Architecture Decision below).

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

### This plan OWNS the tab reorder wiring; the detach plan depends on it

Within-strip drag-reorder is implemented here, not in the sibling [`tab-detach-redock.md`](tab-detach-redock.md). That plan keeps only the **tear-off detach**, **re-dock**, and **cross-strip dock** features plus the `TabDragData` cross-plan contract and the source-side `onDragEnd` hook; it now `depends-on` this plan and reuses the drag sources, the single toolbar drop target, the `TabReorderBar` overlay, and `reorderTab` that this plan installs rather than duplicating them. **Decision:** this plan introduces `reorderable` / `setReorderable` / `isReorderable`, `installTabDnD` / `teardownTabDnD`, the `TabReorderBar` nested overlay, and `reorderTab`. The detach plan layers its detach/dock branches onto the same `makeDropTarget` `onDrop` and the same drag-source registrations, so the two plans must not both define the option triad or the DnD install path — this one is canonical.

### Reorder composes with `tabSide` / `tabOrientation` — the insertion bar follows the main axis

The sibling plan assumed a north-only strip and drew a **vertical** insertion line positioned by `clientX` against each wrapper's `getX()+width/2`. That breaks for west/east strips, where the strip stacks vertically. **Decision:** `TabReorderBar` and its placement are generalised to the strip's **main axis** rather than hard-coded to X/width. For north/south the bar is a vertical line placed by the main-axis (X) coordinate; for west/east it is a horizontal line placed by the main-axis (Y) coordinate. The `onDragOver` slot math reads `clientX` for north/south and `clientY` for west/east, comparing against each wrapper's main-axis offset + half its main-axis extent — reusing the **same main-axis abstraction** introduced for `applyTabWidths`/`doLayout` above. `TabReorderBar.placeAt(mainAxisCoord)` writes the bar's leading-edge offset and cross-axis extent (full strip thickness) from the active side. This keeps reorder feedback correct on all four sides with one code path.

### Compact tabs shrink the wrapper insets, applied via a tracked class — not a token swap

The tab button's breathing room is **not** a theme token: `buildTabEntry` hard-codes it as `tabButton.setInsets(new Insets(0, rightInset + 4, 0, 8))` ([Tab.ts:774-775](../src/typescript/lib/layout/Tab.ts#L774)), where `rightInset` already varies with `closeable`. There is no `--ts-ui-tab-button-padding` var in `themeToVars`. **Decision:** `compact` is a boolean that selects a *smaller* inset tuple when building each tab button — the same computed-insets code path, with the constant breathing room reduced (e.g. `2` instead of the `4`/`8` magic numbers, documented as named constants `TAB_BUTTON_INSET` / `TAB_BUTTON_INSET_COMPACT`). Because the choice is read at button-build time and re-read when `compact` changes, no new theme token is invented (preferring this plan's "do not add tokens unless verification proves it necessary" discipline). The setter caches `_compact` and re-applies on the next `doLayout` (it may run during `super()` via `applyOptions` before the toolbar/buttons exist — per the Setters-must-defer-DOM-work trap): `doLayout` already iterates every entry, so it re-derives and writes each button's insets from `_compact` there rather than the setter mutating DOM inline. Insets feed `recomputePreferredSize` (`Button.setInsets`, [Button.ts:972](../src/typescript/lib/component/button/Button.ts#L972)), so the narrower box flows naturally into `applyTabWidths`' main-axis clamp with no extra wiring.

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

`Tab` gains four placement properties plus `compact` and `reorderable`, each with the typed-setter + cached-field + `TabOptions` field triad. Backing fields declared with explicit types; `applyOptions` dispatches each only when the option is `!== undefined` (mirroring the existing `tabWidthMode` block at [Tab.ts:299-313](../src/typescript/lib/layout/Tab.ts#L299)):

```typescript
class Tab extends LayoutManager {
    private _tabSide: TabSide = "north";
    private _tabAlign: TabAlign = "start";
    private _tabOrientation: TabOrientation = "horizontal";
    private _tabOverflowMode: TabOverflowMode = "none";
    private _compact: boolean = false;
    private _reorderable: boolean = false;

    setTabSide(side: TabSide): this;        getTabSide(): TabSide;
    setTabAlign(align: TabAlign): this;     getTabAlign(): TabAlign;
    setTabOrientation(o: TabOrientation): this; getTabOrientation(): TabOrientation;
    setTabOverflowMode(m: TabOverflowMode): this; getTabOverflowMode(): TabOverflowMode;

    /** Toggles reduced tab-button insets (denser strip). */
    setCompact(value: boolean): this;       isCompact(): boolean;

    /** Toggles within-strip drag-reorder of tab headers. */
    setReorderable(value: boolean): this;   isReorderable(): boolean;

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
    /** Reduce tab-button insets for a denser strip. Defaults to `false`. */
    compact?: boolean;
    /** Enable within-strip header drag-reorder. Defaults to `false`. */
    reorderable?: boolean;
}
```

Each placement setter caches the value, then `this.getContainer()?.scheduleLayout()` — **no DOM work in the setter** (it may run during `super()` via `applyOptions` before the toolbar element exists; see the Setters-must-defer-DOM-work trap). `setTabOrientation` must apply `writing-mode` to existing tab-button elements; it caches the value and re-applies on the next `doLayout` (which already runs per pass), not inline. `setCompact` likewise caches `_compact` and lets `doLayout` re-derive every button's insets — it must not touch DOM inline (same defer trap; the buttons may not exist when `applyOptions` runs during `super()`).

`setReorderable` is the one setter that does non-layout work: it installs or tears down the drag sources + toolbar drop target via `installTabDnD()` / `teardownTabDnD()`. It guards on the element existing (the toolbar element is created in `attach`, [Tab.ts:538-555](../src/typescript/lib/layout/Tab.ts#L538)) — when called during `super()` it only caches `_reorderable`, and `attach` performs the install when `_reorderable` is already set. `isReorderable()` returns the cached flag.

`TabPanel` gets the matching forwarders, following the existing `setTabWidthMode` pattern at [TabPanel.ts:213-226](../src/typescript/lib/component/container/TabPanel.ts#L213):

```typescript
class TabPanel<...> extends Panel<TOptions> {
    setTabSide(side: TabSide): this;        getTabSide(): TabSide;
    setTabAlign(align: TabAlign): this;     getTabAlign(): TabAlign;
    setTabOrientation(o: TabOrientation): this; getTabOrientation(): TabOrientation;
    setTabOverflowMode(m: TabOverflowMode): this; getTabOverflowMode(): TabOverflowMode;
    setCompact(value: boolean): this;       isCompact(): boolean;
    setReorderable(value: boolean): this;   isReorderable(): boolean;
    addTabTool(button: Component): this;
}

interface TabPanelOptions extends PanelOptions {
    // ...existing...
    tabSide?: TabSide;
    tabAlign?: TabAlign;
    tabOrientation?: TabOrientation;
    tabOverflowMode?: TabOverflowMode;
    tabTools?: Component[];
    compact?: boolean;
    reorderable?: boolean;
}
```

Each `TabPanel` forwarder delegates to `this.getTabManager().setX(...)` / `getX()` and returns `this` (or the value), exactly like the existing `setTabWidthMode` at [TabPanel.ts:213-225](../src/typescript/lib/component/container/TabPanel.ts#L213). `TabPanel`'s constructor dispatches each `options?.tabX !== undefined` / `options?.compact !== undefined` / `options?.reorderable !== undefined` block exactly like the existing ones at [TabPanel.ts:85-99](../src/typescript/lib/component/container/TabPanel.ts#L85), and loops `options?.tabTools` into `addTabTool`.

---

## Theme Tokens

No new tokens are strictly required: per-side borders already exist via [`tabButtonSideVars`](../src/typescript/lib/core/Theme.ts#L551), and side placement only changes *which* sides carry the visible border, which is consumer/theme-driven through the same `--ts-ui-tab-button-border-{top,right,bottom,left}` vars already emitted at [Theme.ts:630](../src/typescript/lib/core/Theme.ts#L630). The under-border (`--ts-ui-tab-toolbar-border`) is the rule between strip and content; on south/west/east it moves to the corresponding inner edge — this is handled by `applyUnderBorder` choosing the border side from `_tabSide`, **reusing the existing token**, not adding one.

One **optional** token only if arrow buttons need themed chrome distinct from the toolbar background — defer unless the implementation shows the default toolbar/button tokens are insufficient:

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-tab-scroll-arrow-bg` | `transparent` | `transparent` | Background of the overflow scroll arrows (falls back to toolbar bg) |

If added, it lands in `Theme` (under `tab`), `ClassicTheme`/`ModernTheme` (`DefaultTheme`), `DarkTheme`, and `themeToVars` ([Theme.ts:626-638](../src/typescript/lib/core/Theme.ts#L626)). **Preference: do not add it** unless verification shows the arrows are invisible against the strip — keep the change surgical.

**Reorder and compact add no tokens.** The `TabReorderBar` insertion line reuses the existing `--ts-ui-drag-reorder-color` ([Theme.ts:880](../src/typescript/lib/core/Theme.ts#L880)) — confirmed present, no addition. Compact tabs vary the JS-computed wrapper insets (`buildTabEntry` already hard-codes them at [Tab.ts:774-775](../src/typescript/lib/layout/Tab.ts#L774); there is no `--ts-ui-tab-button-padding` var), so they introduce no token either.

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

**Compact insets.** Name the two breathing-room constants the wrapper insets are built from (the current `4` / `8` magic numbers at [Tab.ts:774-775](../src/typescript/lib/layout/Tab.ts#L774)) as `TAB_BUTTON_INSET` and a smaller `TAB_BUTTON_INSET_COMPACT`, then derive each button's `Insets` from `_compact` at build time. `doLayout` re-applies the chosen insets to every entry's button each pass (cheap; the loop already runs), so `setCompact` only caches `_compact` + `scheduleLayout()`. The narrower box flows through `Button.setInsets`→`recomputePreferredSize` ([Button.ts:972-976](../src/typescript/lib/component/button/Button.ts#L972)) into `applyTabWidths`' main-axis clamp with no extra code.

**Reorder DnD wiring.** New private members on `Tab`:

```typescript
private _reorderable: boolean = false;
private _reorderBar: TabReorderBar = new TabReorderBar();      // main-axis insertion line
private _dndTeardowns: Array<() => void> = [];                 // source + target teardown fns
private _dragMouseTarget: EventTarget | null = null;          // captured mousedown target for close-button veto
private _dragInsertIndex: number = -1;                        // slot computed in onDragOver, read in onDrop
```

`TabReorderBar extends Component` mirrors `TabIndicator` ([Tab.ts:139-210](../src/typescript/lib/layout/Tab.ts#L139)): constructed with `setBackgroundColor("var(--ts-ui-drag-reorder-color)")`, `setPointerEvents("none")`, `setZIndex(2)`, raw-appended to the toolbar element in `attach` next to `_indicator` so the toolbar's box never allocates it a cell. `placeAt(mainAxisCoord, thickness)` sets the bar's leading-edge offset on the strip's **main axis** and its **cross-axis** extent to the strip thickness, then shows it; `hide()` on drag leave / drop. For north/south it draws a 2px-wide vertical line at X; for west/east a 2px-tall horizontal line at Y (driven by the same side helper `doLayout`/`applyTabWidths` use).

`installTabDnD()` (called from `setReorderable(true)` and from `attach` when `_reorderable`): for each existing entry, `DragManager.makeDragSource(entry.wrapper, …)` — the **wrapper** (not the inner `ToggleButton`), which already owns the cell geometry the slot math needs — with `dragData` carrying the entry's tab and an `onDragStart` that vetoes the gesture (returns `false`) when the captured mousedown target was inside the entry's close button. The close-button mousedown target is recorded by a plain `mousedown` subtree listener on the wrapper (since `DragEventDetail` carries no DOM target, [DragManager.ts:24-33](../src/typescript/lib/core/DragManager.ts#L24)), read once in `onDragStart`, then cleared. Then one `DragManager.makeDropTarget(this._toolbar, …)` whose `accepts` tests the drag is a tab header, whose `onDragOver` computes the insertion slot, positions `_reorderBar`, and **returns `null`** (suppressing the manager's own horizontal `ReorderIndicator`, [DragManager.ts:75](../src/typescript/lib/core/DragManager.ts#L75)), `onDragLeave` hides the bar, and `onDrop` calls `reorderTab`. Every teardown closure (`makeDragSource`/`makeDropTarget` each return `() => void`) is pushed into `_dndTeardowns`. When a tab is added while `_reorderable`, register the new entry's source too (hook into `buildTabEntry`/`createTab`).

`teardownTabDnD()` runs and clears `_dndTeardowns`, detaches `_reorderBar`; called from `detach` ([Tab.ts:560](../src/typescript/lib/layout/Tab.ts#L560)) and from `setReorderable(false)`.

Slot math (`onDragOver`) reads the **main-axis** cursor coordinate (`clientX` for north/south, `clientY` for west/east) relative to the toolbar element, and walks `_tabs` comparing it against each `wrapper`'s main-axis offset + half its main-axis extent — the first wrapper whose midpoint is past the cursor is the slot; default is `_tabs.length` (trailing edge). The result is cached in `_dragInsertIndex` and the bar placed at that boundary; `onDragOver` returns `null`.

```typescript
reorderTab(fromIdx, toIdx):
    splice _tabs (move the entry),
    this._toolbar.moveComponent(wrapper, toIdx),   // moveComponent: dependency component-move-helper.md
    recompute _selectedTabIndex by entry identity (find the formerly-selected TabEntry after the splice),
    scheduleLayout()
```

`moveComponent(child, index?, constraints?): this` is **not yet on `Component`** — it is provided by [`component-move-helper.md`](component-move-helper.md) (a hard `depends-on`; see frontmatter). Its same-parent path reorders the wrapper among the toolbar's children; this plan treats it as a given primitive and does not re-specify it.

---

## Ordered Implementation Steps

1. **Add the option-type unions** (`TabSide`, `TabAlign`, `TabOrientation`, `TabOverflowMode`) to `Tab.ts`, each with JSDoc + `@category Layouts`, beside `TabWidthMode`. Add the matching optional fields to `TabOptions`, plus `compact?: boolean` and `reorderable?: boolean`.

2. **Add backing fields + typed setters/getters** to `Tab` for the four placement options, plus `_compact`/`setCompact`/`isCompact`, `addTabTool`/`removeTabTool` and a private `_tabTools: Component[]` and tool-group child. Placement + `compact` setters cache + `scheduleLayout()` only — no DOM. Dispatch all from `applyOptions`. → verify: `npx tsc --noEmit` clean.

3. **Make `applyUnderBorder` side-aware** — choose the bordered edge from `_tabSide`, reusing `--ts-ui-tab-toolbar-border`. → verify: north still draws bottom rule.

4. **Generalise `applyTabWidths`** to a main-axis abstraction: clamp width for north/south, height for west/east; when `_tabOverflowMode !== "none"` skip the `"equal"`→`"fill"` collapse and instead set the inner box to `"preferred"` + `setOverflowing` on the main axis.

5. **Compact insets:** name the `TAB_BUTTON_INSET` / `TAB_BUTTON_INSET_COMPACT` constants; build each tab button's `Insets` from `_compact` in `buildTabEntry`, and re-derive + re-apply them per entry in `doLayout` so `setCompact` toggles live. → verify: `compact: true` visibly narrows the strip; `applyTabWidths` clamp still fits.

6. **Rework `doLayout`** into a side switch for toolbar + content placement; subtract the tool-group extent from `available`; apply `writing-mode` to tab-button elements per `_tabOrientation`; position the tool group and the alignment spacer. Keep the indicator/close-button hand-placement working per side (indicator slides along the main axis; for vertical sides it pins to the inner edge and slides vertically). → verify: each side renders in `TabDemoPanel`.

7. **Add the overflow chrome:** `"scrollbar"` sets toolbar element overflow `auto` on the main axis; `"arrows"` adds two arrow `Button`s (leading/trailing) that scroll the toolbar element and hide when no overflow. Reuse the box's `reserveContentFrame`. → verify: a strip with many tabs scrolls instead of compressing when `tabOverflowMode !== "none"`.

8. **Add the `TabReorderBar` nested class** (mirror `TabIndicator`), raw-append its element in `attach` next to `_indicator`. Make `placeAt(mainAxisCoord, thickness)` and `hide()` main-axis-aware (vertical line for north/south, horizontal for west/east). → verify: `npx tsc --noEmit` clean.

9. **Add `_reorderable` field + `setReorderable`/`isReorderable`,** the `_dndTeardowns`/`_dragMouseTarget`/`_dragInsertIndex` private members, and dispatch `reorderable` from `applyOptions`. Implement `installTabDnD` / `teardownTabDnD`: per-wrapper `makeDragSource` (close-button mousedown-capture + `onDragStart` veto), one `_toolbar` `makeDropTarget` (`accepts`, main-axis `onDragOver` slot math + `_reorderBar.placeAt` + return `null`, `onDragLeave` hides bar, `onDrop` → `reorderTab`). Install from `attach` when `_reorderable` and from `setReorderable(true)`; tear down from `detach` and `setReorderable(false)`. Register new entries' sources when a tab is added while `_reorderable` (hook `buildTabEntry`/`createTab`). → verify: `npx tsc --noEmit` clean.

10. **Implement `reorderTab(fromIdx, toIdx)`** using `this._toolbar.moveComponent(wrapper, toIdx)` (from `component-move-helper.md`); splice `_tabs`, fix `_selectedTabIndex` by entry identity, `scheduleLayout()`. → verify: dragging a header left/right reorders it and keeps it selected.

11. **Forward everything through `TabPanel`** — setters/getters for the four placement options plus `setCompact`/`isCompact` and `setReorderable`/`isReorderable`, options dispatch in the constructor, `tabTools` loop. → verify: `npx tsc --noEmit` clean.

12. **Barrels:** export the four new types from `src/typescript/lib/layout/index.ts` (the `Tab` `export type {...}` line). `compact`/`reorderable` are plain `boolean` fields needing no new type export. `TabDragData` is **not** added here — it stays in the detach plan's barrel work. `TabPanelOptions` already re-exported — no new container symbol. → verify: `grep -n "TabSide" src/typescript/lib/layout/index.ts`.

13. **Demo:** extend `src/typescript/TabDemoPanel.ts` with examples of each side, alignment, orientation, a tool button, an overflowing scrollable strip, a `compact: true` strip, and a `reorderable: true` strip.

14. **Docs:** update per the Documentation Impact section.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Tab.ts` (all six features, `TabReorderBar`, DnD wiring, compact insets) |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` (forwarders incl. `setCompact`/`setReorderable`) |
| Modify | `src/typescript/lib/core/Theme.ts` (only if the optional arrow token is added; otherwise `applyUnderBorder` change is in `Tab.ts`) |
| Modify | `src/typescript/lib/layout/index.ts` (export the four new type unions) |
| Modify | `src/typescript/TabDemoPanel.ts` (demo coverage) |
| Modify | `docs/layouts/Tab.md`, `docs/components/TabPanel.md` (curated pages) |

Reorder consumes `DragManager.makeDragSource`/`makeDropTarget` ([DragManager.ts:165,182](../src/typescript/lib/core/DragManager.ts#L165)) as-is — **no `DragManager.ts` change here**; the source-side `onDragEnd` hook that the tear-off feature needs stays in [`tab-detach-redock.md`](tab-detach-redock.md). `moveComponent` is provided by the `component-move-helper.md` dependency — not edited here.

---

## Verification

- `npx tsc --noEmit` — zero errors.
- `grep -n "TabSide\|TabAlign\|TabOrientation\|TabOverflowMode" src/typescript/lib/layout/index.ts` — all four exported.
- `grep -n "ts-ui-drag-reorder-color\|ts-ui-tab-button-padding" src/typescript/lib/core/Theme.ts` — the reorder colour exists; no tab-button-padding token is added.
- Manual smoke in `TabDemoPanel` (dev server, see MEMORY dev URLs): each of north/south/west/east renders the strip on the correct edge; `start`/`end` move the tab group to the correct extreme on every side; west/east `vertical-cw`/`vertical-ccw` rotate text the opposite directions and the buttons remain clickable on the painted glyph (hit-test check); a tool button sits at the end opposite the tabs and survives `start`/`end` flips; with `tabOverflowMode: "scrollbar"` a long strip scrolls (thin scrollbar) instead of compressing; with `"arrows"` the arrow buttons appear only when overflowing and scroll the strip.
- **Compact:** `compact: true` produces a visibly denser strip; with `closeable` tabs the ✕ still clears the label.
- **Reorder:** with `reorderable: true`, dragging a header along the strip shows the insertion bar at slot boundaries (vertical for north/south, **horizontal** for west/east); on release the tab moves and stays selected; a small drag on the ✕ closes/no-ops rather than reordering; reorder works on all four sides.
- Theme toggle (light/dark/classic): the under-border moves to the correct edge per side, per-side button borders still resolve, and the reorder bar recolours from `--ts-ui-drag-reorder-color`.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **New public symbols** (`TabSide`, `TabAlign`, `TabOrientation`, `TabOverflowMode`): re-export from the `layout` subpath barrel `src/typescript/lib/layout/index.ts` (no root barrel). `@category Layouts` on each. They land under `docs/api/layout/type-aliases/` after build. `compact` and `reorderable` are plain `boolean` options needing no new exported type.
- **New `Tab`/`TabPanel` methods/options** (`setCompact`/`isCompact`, `setReorderable`/`isReorderable`, and their option fields) appear automatically in the generated `docs/api/` pages once JSDoc'd.
- **Curated pages:** update `docs/layouts/Tab.md` (side/align/orientation/overflow + a compact and a reorder section) and `docs/components/TabPanel.md` (the forwarders incl. `setCompact`/`setReorderable`). Both are already linked in `docs/.vitepress/config.mts` ([sidebar entries at config.mts:126,154](../docs/.vitepress/config.mts)) — no new sidebar entry needed since no new page is created. The reorder section should cross-reference the tear-off/detach gestures documented by [`tab-detach-redock.md`](tab-detach-redock.md) without duplicating them. JSDoc on the DnD path references `DragManager` (core bucket) with a markdown link, not `{@link}`, per the cross-bucket rule.
- **Cross-bucket JSDoc:** `TabPanel` (component bucket) referencing the new layout types must use the markdown-link form, e.g. ``[`TabSide`](/api/layout/type-aliases/TabSide)``, not `{@link}` (per docs-conventions cross-bucket rule).
- No renames or removals.

---

## Potential Challenges

- **`writing-mode` survives `applyStyle`.** Like the indicator's bar geometry ([Tab.ts:189-209](../src/typescript/lib/layout/Tab.ts#L189)), an inline `writing-mode` written outside a tracked setter is wiped by `Component.applyStyle`. Mitigation: write it through a tracked element-style setter, or re-apply it in `doLayout` each pass (which already re-runs and re-positions everything).
- **Vertical preferred-size measurement.** Tab buttons measure their preferred size from content; `writing-mode` swaps the reported width/height. Mitigation: chosen `writing-mode` (not `transform`) makes the browser report rotated metrics, so `applyTabWidths` clamps the correct axis without manual swap math — but confirm `ToggleButton.getPreferredSize` reflects the rotated box before relying on it.
- **Indicator + close buttons per side.** The selection bar and close buttons are hand-positioned for north today. Mitigation: drive their main-axis offset from a side helper so they track the active wrapper on every side; for vertical sides the indicator pins to the inner edge and uses height for its extent.
- **Scroll frame vs indicator overlay.** `reserveContentFrame` re-parents children into a content frame; the raw-appended `_indicator` overlay must not be swept into it. Mitigation: the indicator is raw-appended to the toolbar element, not enrolled as a box child, so the frame (built from `getComponents()`) already excludes it — verify after wiring overflow.
- **`equal`-mode collapse vs overflow.** The existing `"equal"`→`"fill"` collapse ([Tab.ts:466](../src/typescript/lib/layout/Tab.ts#L466)) directly contradicts scroll-on-overflow. Mitigation: gate the collapse on `_tabOverflowMode === "none"`; when scrolling is on, leave buttons at preferred and let the box overflow.
- **Reorder slot math on vertical sides.** The sibling plan hard-coded `clientX` + wrapper width; west/east strips need `clientY` + wrapper height. Mitigation: drive both the slot comparison and `TabReorderBar.placeAt` from the same main-axis helper `applyTabWidths`/`doLayout` already use; never read X/width directly.
- **Reorder bar vs the scroll content-frame.** When `tabOverflowMode !== "none"`, `reserveContentFrame` re-parents box children into a content frame; `_reorderBar` (like `_indicator`) is raw-appended to the toolbar element, not a box child, so the frame built from `getComponents()` excludes it — verify after wiring both, same as the indicator note above.
- **`moveComponent` is an unmet dependency.** `reorderTab` calls `this._toolbar.moveComponent(...)`, which does not exist until `component-move-helper.md` lands. Mitigation: declared as a `depends-on` in frontmatter; `/implement` must order that plan first. Confirm its same-parent path actually reorders the wrapper (the reorder smoke test covers it).
- **Close-button drag veto.** `makeDragSource` installs a subtree mousedown listener, so a press on the ✕ would otherwise start a drag. Mitigation: capture `e.target` via a plain `mousedown` subtree listener on the wrapper into `_dragMouseTarget`, and return `false` from `onDragStart` when it was inside the close button; clear it afterward (`DragEventDetail` carries no DOM target).
- **Compact insets vs close-button reservation.** The right inset already reserves `CLOSE_BUTTON_SIZE + 4` for the ✕ ([Tab.ts:774](../src/typescript/lib/layout/Tab.ts#L774)); compact must shrink only the non-reserved breathing room, not the ✕ clearance, or the glyph overlaps the label. Mitigation: reduce the additive `TAB_BUTTON_INSET` term, keep the `CLOSE_BUTTON_SIZE` reservation intact.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — the whole change; read `doLayout`, `applyTabWidths`, `buildTabEntry`, `applyUnderBorder`, the `TabIndicator` `applyStyle` replay.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the shrink-to-min-then-overflow `doLayout` and `computeTotalMinSize`; `BoxMode`/`BoxOverflowSizing` option-type style.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `setOverflowing`/`isOverflowingX/Y`, `reserveContentFrame`, `placeComponent`.
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — `setAutoScroll` → `setOverflowing` forwarding and the `AutoScrollMode` union (option-type precedent).
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `tabButtonSideVars` ([551](../src/typescript/lib/core/Theme.ts#L551)), `themeToVars` ([566](../src/typescript/lib/core/Theme.ts#L566)), the `tab` block ([177](../src/typescript/lib/core/Theme.ts#L177)).
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — forwarder pattern ([setTabWidthMode at 213](../src/typescript/lib/component/container/TabPanel.ts#L213), constructor dispatch at 85).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `DragEventDetail` (24, `clientX/clientY/dragData/sourceId`), `DragSourceOptions.onDragStart` (40-47), `DropTargetOptions` (`accepts`/`onDragOver`→number|null/`onDragLeave`/`onDrop`, 63-80), `makeDragSource` (165) / `makeDropTarget` (182) returning `() => void`.
- [`plans/component-move-helper.md`](component-move-helper.md) — the `moveComponent(child, index?, constraints?): this` primitive `reorderTab` calls (hard dependency).
- [`plans/tab-detach-redock.md`](tab-detach-redock.md) — the sibling plan that now depends on this one for reorder; tear-off detach / re-dock / cross-strip dock and the `TabDragData` contract live there.
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts#L600) — `installRowDnD`: the canonical `makeDragSource`+`makeDropTarget` consumer idiom + teardown-bag pattern to mirror for `installTabDnD`.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts#L972) — `setInsets`→`recomputePreferredSize`, the path compact insets feed.
- `CODE_CONVENTIONS.md` / `ARCHITECTURE.md` — typed-setter triad, one-element-per-class, render-time DOM deferral, magic-number documentation (strip thickness, writing-mode constants, `TAB_BUTTON_INSET` / `TAB_BUTTON_INSET_COMPACT`).

---

## Non-Goals

- **Tear-off detach, re-dock, and cross-strip dock.** Dragging a tab *out* of its strip into a floating `Window`, dropping it back, or moving it to another strip is owned by [`tab-detach-redock.md`](tab-detach-redock.md), which depends on this plan's reorder wiring. This plan covers only **within-strip** reorder; the `TabDragData` cross-plan contract and the source-side `onDragEnd` hook stay in the detach plan.
- **Per-tab side/orientation overrides.** Side/orientation are strip-wide.
- **Animating side transitions.** Switching `tabSide` at runtime re-lays out without a transition; the existing fade/indicator animations are unchanged.
- **Replacing the content-area overflow path.** The host `Panel.setAutoScroll` content-scroll logic at [Tab.ts:1172-1182](../src/typescript/lib/layout/Tab.ts#L1172) stays; tab-strip scrolling is a separate, strip-local mechanism.
- **A new arrow-button component.** Reuse the existing `Button`/`Glyph`; only add a theme token if verification proves the arrows are invisible.
