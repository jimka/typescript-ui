---
depends-on:
  - displayed-layout-participation
touches-shared:
  - src/typescript/lib/layout/Tab.ts
---

# Extract a reusable `TabBar` Component out of the `Tab` layout manager — Implementation Plan

## Overview

[`Tab`](../src/typescript/lib/layout/Tab.ts#L502) is a ~3500-line `LayoutManager` that does two jobs at once: it renders the *tab bar* (the toolbar strip, the tab buttons, the selection indicator, the reorder bar, the tool group, overflow scroll arrows, and all the tab DnD) **and** it manages the *content* (the single selected child panel, lazy-load/materialize, content swapping, the body frame). This plan extracts the first job into a standalone, reusable **`TabBar`** Component, leaving `Tab` as a thinner content manager that owns a `TabBar` and reacts to its events.

**Motivation (rule of three).** The codebase deliberately kept `Tab` as one manager (memory: *Tab kept intentionally as one manager*). That call is revisited now because a concrete second consumer exists: the follow-up [`window-tab-header.md`](window-tab-header.md) (*Strip-Mode Tear-off Window Tab-Header*) needs the *bar* — the working tab-DnD surface, the tool group, the reorder bar, the selection indicator, overflow scrolling — promoted to a window's title bar **without** the content machinery (no selected-panel, no lazy-load, no content frame). A reusable `TabBar` gives that follow-up the bar to compose, and dissolves the latent `Window`↔`Tab` cycle by making `TabBar` a pure dependency sink (zero `Window` import).

This is a **strictly behavior-preserving refactor**: every existing behavior — tab select, reorder DnD, dock, tear-off to window in `"strip"` and `"bare"` modes, overflow scroll, `addTool`, closeable tabs, the tab context menu, roving tabindex, the selection indicator, and the strip-mode host-window helpers — must be pixel- and event-identical before and after. `TabBar` is the highest-risk extraction in the repo; correctness preservation is the top success criterion. The new file lives at [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) and exports through the container barrel. Tab construction-time options and the `TabPanel` wrapper are unchanged.

---

## Architecture Decisions

### `TabBar` honours the `displayed` flag on its entries (folded in from `displayed-layout-participation.md`)

This is the one **intentional behaviour addition** layered onto the otherwise-strictly-behaviour-preserving refactor, and the reason this plan `depends-on` [`displayed-layout-participation.md`](displayed-layout-participation.md) (which adds `Component.isDisplayed()` / `getLaidOutComponents()`). That plan made every other layout manager honour `displayed`; `Tab`'s share was **deliberately carved out and deferred to here**, because gating the strip's `_tabs`-iterating width/extent math (`tabModeExtent`, `applyTabWidths`, `predictTabsExtent`, `positionCloseButtons`, the ARIA loop) is pervasive surgery on exactly the code this plan re-homes into `TabBar` — doing it in the displayed plan would mean implementing it twice on moving code.

So as part of the extraction, `TabBar` must honour `isDisplayed()` on the content child behind each `BarEntry`:
- **Hide a non-displayed entry's button** in the strip, and skip it in the bar's width/extent/placement math so the strip reclaims the space (the natural place is the `BarEntry` rendering/measure pass `TabBar` now owns).
- **`Tab` reselects a displayed sibling** when the active tab's content is hidden, through the existing active-selection funnel (`onTabPressed` / `setActiveTabIndex`), so the content area never shows a `display:none` panel.

The `getLaidOutComponents()` accessor applies on the *content* side (`Tab`'s own children); the bar gates per `BarEntry` against its content child's `isDisplayed()`. Verify with the same hide-a-tab / hide-the-active-tab smoke checks the displayed plan specified for `TabDemoPanel`.

### `TabBar` is a `Panel` subclass — the Component that *was* `Tab._toolbar`

`Tab` is a `LayoutManager`, which is **not** a `Component` ([`LayoutManager`](../src/typescript/lib/layout/LayoutManager.ts#L29) extends `BaseObject`). It cannot itself render a DOM element. Today it builds the bar chrome out of *four* Components it raw-appends to the container in [`attach`](../src/typescript/lib/layout/Tab.ts#L1579) (`element.appendChild(this._toolbar.getElement(true))`, then `_clipFrame`, `_toolGroup`, `_indicator`, `_reorderBar`) and hand-positions in [`doLayout`](../src/typescript/lib/layout/Tab.ts#L2618).

`TabBar` **is** the toolbar element. It replaces today's [`private _toolbar: Panel`](../src/typescript/lib/layout/Tab.ts#L507): a `Panel` subclass (`class TabBar extends Panel<TabBarOptions>`) whose single owned DOM element is the strip toolbar, and which internally owns `_clipFrame`, `_buttonGroup`, `_rovingTabIndex`, `_indicator`, `_reorderBar`, `_toolGroup`, and the scroll arrows as today (raw-appended into its own element, exactly as `attach` does now — moved into `TabBar.init()`/its constructor). `Panel` is the right base for the same reason `_toolbar` is a `Panel` today (comment at [Tab.ts:504](../src/typescript/lib/layout/Tab.ts#L504)): `Panel.clampsToContentSize()` is `false`, so it accepts the full container extent rather than shrinking to the tab buttons' content max.

**Ownership / DOM placement / lifecycle.** `Tab` keeps a `private _bar: TabBar` field. In `Tab.attach`, instead of building four elements, `Tab` does `container.getElement(true).appendChild(this._bar.getElement(true))` (one append; `TabBar` raw-appends its own internals in its own ctor/init). The content panels remain the container's *real* children (`container.getComponents()`) exactly as today — `TabBar` is a chrome overlay sibling, never enrolled as a container child, never returned from `getComponents()`. This is identical to how `_toolbar` lives today (raw-appended, hand-positioned, invisible to the container's child list); the only change is that the four-element subtree is now encapsulated behind one Component. `Tab.detach` calls `this._bar.detach()`-equivalent teardown (DnD teardown + element removal) — see *Teardown* below.

**Positioning.** `Tab.doLayout` keeps computing the strip rectangle (the `switch (this._side)` band math at [Tab.ts:2695](../src/typescript/lib/layout/Tab.ts#L2695)) and the content rectangle. It positions the bar with a single call `this._bar.placeStrip(toolbarX, toolbarY, toolbarW, toolbarH)` (a new `TabBar` method that runs `setX/setY/setWidth/setHeight` then the bar's *internal* layout of clip-frame/tool-group/indicator/arrows — i.e. everything `doLayout` does between [Tab.ts:2721](../src/typescript/lib/layout/Tab.ts#L2721) and [Tab.ts:2754](../src/typescript/lib/layout/Tab.ts#L2754)). The content-placement tail of `doLayout` (the visible-component sizing, `placeComponent`, and the cross-tab fade at [Tab.ts:2756–2810](../src/typescript/lib/layout/Tab.ts#L2756)) **stays in `Tab`**, because it concerns the content child, not the bar.

### Directory: `component/container/` (not `layout/`)

`TabBar` is a `Component`, not a `LayoutManager`. Every Component widget lives under `component/` and exports through a `component/<sub>` barrel; `layout/` holds only `LayoutManager` subclasses. `TabBar` is a container-flavoured widget (a strip that hosts tab cells), so it belongs in [`component/container/`](../src/typescript/lib/component/container/index.ts) next to its sibling chrome widgets (`WindowHeader`, `Scrollbar`, `SplitGutter`, `TabPanel`). `Tab` stays in `layout/`. This matches the [docs-conventions](../.claude/skills/_shared/docs-conventions.md) bucket rule (`component/<sub>` barrel; `@category Components`).

### `TabEntry` splits into a bar-entry and a content-entry, keyed by a shared id

[`TabEntry`](../src/typescript/lib/layout/Tab.ts#L287) today bundles both sides: `wrapper`/`button`/`closeButton`/`contextMenuListener`/`name`/`constraints` (BAR) and `component`/`factory`/`spinner`/`state` (CONTENT). After the split:

- **`TabBar` owns `BarEntry`** = `{ id, wrapper, button, closeButton?, name, constraints?, contextMenuListener }` plus a per-entry DnD-source teardown. This is everything the bar needs to render a cell, run its DnD, and report which cell was acted on. `BarEntry` holds **no** content reference.
- **`Tab` owns `ContentEntry`** = `{ id, component, factory, spinner, state }` — the lazy-load state machine and the live content. `id` is a stable string minted when a tab is created and passed to `TabBar.createBarEntry(id, name, constraints)`; `Tab` keys its `ContentEntry[]` by the same `id`.

**Why a shared id rather than each side holding the other's half.** The two arrays must stay index-aligned through reorder, dock, close, and tear-off. A shared id (rather than cross-references) means `TabBar` can emit *"the cell with id X was pressed / wants to reorder from slot i to j / wants to tear off"* and `Tab` resolves its `ContentEntry` by id — no `TabBar→component` pointer (which would re-introduce content knowledge into the bar) and no `Tab→wrapper` pointer (which would re-introduce DOM knowledge into the content side). The id is the seam. `TabBar` exposes ordered id access (`getEntryIds(): string[]`, `getActiveEntryId()`) so `Tab` can re-derive its content order after a bar-driven reorder. The `name` lives on `BarEntry` (the bar renders it and the context menu reads it); `constraints.closeable` is consulted by **both** sides, so `constraints` rides on `BarEntry` (the bar needs it for the close button and context-menu "Close" gate) and `Tab` reads closeable through a `TabBar.isEntryCloseable(id)` accessor for `syncHostWindowCloseable` — avoiding a duplicated copy.

This keeps each class single-responsibility and means `window-tab-header.md` can drive a `TabBar` with **no** `ContentEntry` at all (a bar with cells but no managed content), which is exactly the standalone case it needs.

### Cross-seam communication: custom semantic events (`ListenerBag`) from `TabBar` → `Tab`

Per [ARCHITECTURE.md](../ARCHITECTURE.md#L11) the event split is by origin. `TabBar`→`Tab` notifications are framework-custom semantic events (they are *not* raw DOM events — the bar has already interpreted a DOM `click`/`drop`/release into a semantic intent), so they use the full `on`/`off`/`emit` + `ListenerBag<TabBarEvent>` shape with a string-literal union. Internally, `TabBar` still wires its own DOM listeners through the `Event` class on `this` (the tab button `"action"`, the toolbar `keydown`, the `mousedown` veto-capture, the `contextmenu` subtree) — those stay exactly as today, just relocated into `TabBar`.

`TabBar` reads the three cross-seam flows ([selection](../src/typescript/lib/layout/Tab.ts#L1468), [reorder](../src/typescript/lib/layout/Tab.ts#L3301), [tear-off](../src/typescript/lib/layout/Tab.ts#L3017)) and emits this event union (**refined during implementation** — the plan invited verifying the seam before committing to the set; see the two notes below):

```
type TabBarEvent =
    | "tabpressed"       // a tab cell was activated (id) — Tab swaps content, runs lazy-load
    | "reordered"        // an in-strip reorder committed (fromId, toIndex) — Tab re-derives ContentEntry order from getEntryIds()
    | "tabclose"         // a cell's ✕ was clicked (id) — Tab removes content + emits its own "tabclose"
    | "dockrequested"    // a foreign tab was dropped here (componentId, slot) — Tab docks the content
    | "tabdragstart"     // a cell's drag committed (id) — Tab registers its live content in tabDragRegistry
    | "tearoffrequested" // a cell was released over empty space (id, clientX, clientY, forceBare) — Tab tears off (if its content is ready)
    | "detached";        // a cell's drag was released onto a target (id) — Tab drops its ContentEntry IFF the content left this container
```

**Why these and not the prompt's candidate set.** The prompt floated `tabpressed`/`reorder`/`tearoffrequested`/`backgroundpress`. Reading the flows refined it:

- `backgroundpress` is **dropped**: today's `Tab` has no empty-toolbar-press handler; only `window-tab-header.md` adds one, and it does so by wiring `Event.addListener(this._toolbar, "mousedown", …)` *from Tab* against the bar's element. Post-extraction that becomes a `TabBar`-owned concern; this plan exposes the seam needed (see below) but adds **no** behavior, so no `backgroundpress` event is emitted today. (Noted as a relocation for the follow-up — see *window-tab-header.md relocations*.)
- The dock/close/detach intents are **added** because they are real cross-seam transitions buried in today's DnD code ([`dropTabHeader`](../src/typescript/lib/layout/Tab.ts#L2936) → `dockComponent`; [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3405); [`onTabDragEnd`](../src/typescript/lib/layout/Tab.ts#L2979) → `removeEntryKeepingContent`). After the split the *bar* detects them (it owns the DnD) but the *content* must act (re-parent, remove, close the window), so each becomes an event.

**Two seam refinements discovered while reading the DnD code (both keep the bar content-agnostic):**

- **`tabdragstart` was added, replacing the source-side registry write.** Today [`makeTabDragSource`](../src/typescript/lib/layout/Tab.ts#L2850)'s `onDragStart` registers the live content in the module-level `tabDragRegistry` (keyed by the content's component id) so a *foreign* strip's drop can resolve it; `onTabDragEnd` deletes it. The registry holds a live `Component`, which the bar must not touch. Registering *eagerly* (on materialize) instead of per-drag is **not** behaviour-equivalent — a dock re-registers the same content id in the destination strip, and the source strip's later removal would then delete the destination's fresh entry. So the per-drag timing must be preserved: `TabBar`'s drag-source `onDragStart` (after its own close-button veto) emits `tabdragstart(id)`, and `Tab` synchronously registers its content; `Tab` deletes on the drag-end events. The `componentId` the bar puts on the `TabDragData` comes from a per-`BarEntry` `contentId` *string* (`""` until the content materializes), which `Tab` keeps current via `TabBar.setEntryContentId(id, contentId)` — a string, not a content pointer.
- **The bar's `"empty"` event was dropped.** A `TabBar` never removes a cell on its own — `createBarEntry` / `removeBarEntry` / `moveBarEntry` are all driven *by `Tab`* (from its `tabclose` / `detached` / `tearoffrequested` handlers). So `Tab` already knows the moment `_contents` hits zero and emits its own `"empty"` directly; a bar→Tab `"empty"` relay would be redundant. (The bar still exposes `getEntryIds()` so `Tab` can observe emptiness, but no event is needed.)

### Event closures are relocated verbatim, not converted to named-method references

[ARCHITECTURE.md §"Listeners must reference a named function"](../ARCHITECTURE.md#L19) forbids inline-arrow listeners. Today's `Tab` wires many **per-entry** closures that capture the specific entry/button — `tabButton.on("action", () => this.onTabPressed(tabButton))`, the per-wrapper `contextmenu` handler, the per-close-button `"action"` — plus a handful of strip-level inline arrows (`keydown`, the scroll-arrow `"action"`s, the `mousedown` veto-capture). Converting the per-entry closures to bare named-method references is **not** mechanically possible without changing the closure model (the `"action"` payload does not carry which button fired), and doing so on the repo's highest-risk file would trade behaviour-preservation for style. This extraction therefore **relocates every event closure verbatim** (the strip-level handlers now self-listen — `Event.addSubtreeListener(this, …)` — because `TabBar` *is* the element `Tab` used to reach into). Bringing the closures into named-method conformance is explicitly deferred (it is pre-existing debt the extraction neither worsens nor is obligated to fix under the surgical-change rule), and is a clean follow-up once parity is proven.

**Where state is shared rather than evented.** Two reads cross the seam synchronously rather than as events: `TabBar.isEntryCloseable(id)` (for `syncHostWindowCloseable`) and `TabBar.getEntryIds()` / `getActiveEntryId()` (for serialization and post-reorder content ordering). These are pull-style accessors, not push events, because `Tab` needs them on demand (during a layout/serialize), not as a notification.

### `Tab` keeps selection, content, lazy-load, dock, tear-off, and the host-window helpers

`Tab` remains the owner of: `_selectedTabIndex` semantics (now driven by `"tabpressed"`), [`getVisibleComponent`](../src/typescript/lib/layout/Tab.ts#L1634), [`createTab`](../src/typescript/lib/layout/Tab.ts#L1910) / `addLazyTab` / [`materializeAsync`](../src/typescript/lib/layout/Tab.ts#L2001), [`dockComponent`](../src/typescript/lib/layout/Tab.ts#L3089), [`detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L3017) **including the `new Window(...)`**, [`fillWindowWithStrip`](../src/typescript/lib/layout/Tab.ts#L3059), and the host-window helpers [`hostWindow`](../src/typescript/lib/layout/Tab.ts#L3161) / [`closeHostWindowIfEmpty`](../src/typescript/lib/layout/Tab.ts#L3179) / [`syncHostWindowCloseable`](../src/typescript/lib/layout/Tab.ts#L3193) and the [`_closeHostWindowWhenEmpty`](../src/typescript/lib/layout/Tab.ts#L592) flag.

The host-window helpers **stay in `Tab`**, not `TabBar`. They bridge a bar gesture to a content/window action: they walk `getContainer().getParentComponent()` up to a `Window`, call `win.requestClose()` / `win.setCloseable(...)`. `TabBar` must have **zero `Window` knowledge** (the dependency-sink requirement), so anything touching `Window` is disqualified from the bar. This also keeps `window-tab-header.md` correct: it calls `syncHostWindowCloseable` / `closeHostWindowIfEmpty` / `hostWindow` / `fillWindowWithStrip` **from `Tab`**, and adds `installWindowControls` / `installWindowMoveTrigger` / `syncHostWindowTitle` also on `Tab` — all of which continue to live on `Tab` after this extraction. No relocation of those is forced.

The `Window` import is **removed from `TabBar`** and **retained on `Tab`** (for `detachTabToWindow` / `fillWindowWithStrip`). `TabBar` imports neither `Window` nor `Tab`.

### `recordMouseTarget` DnD veto, `_dragShiftHeld`, and `_clipFrame` move to `TabBar`

The veto-capture ([`recordMouseTarget`](../src/typescript/lib/layout/Tab.ts#L2827), the `_dragMouseTarget`/`_dragShiftHeld` fields), the per-wrapper drag sources ([`makeTabDragSource`](../src/typescript/lib/layout/Tab.ts#L2850)), the single drop target ([`makeTabDropTarget`](../src/typescript/lib/layout/Tab.ts#L2894)), the reorder-slot math ([`updateReorderSlot`](../src/typescript/lib/layout/Tab.ts#L3209) / [`slotBoundary`](../src/typescript/lib/layout/Tab.ts#L3258) / [`dropReorder`](../src/typescript/lib/layout/Tab.ts#L3280)), `_clipFrame`, `_reorderBar`, `stripId`, and the `_dndTeardowns` array all move to `TabBar` — they are pure bar mechanics over the bar's own elements. `TabBar` resolves the dragged cell to its `BarEntry` locally; on drag-end it decides reorder-vs-foreign-drop-vs-tear-off and emits the corresponding event. The `_dragShiftHeld` capture stays where the `mousedown` is captured (the bar), and rides out on the `"tearoffrequested"` payload as `forceBare`.

`window-tab-header.md`'s move-trigger arbitration (its `installWindowMoveTrigger` early-returns when `e.target` is inside a tab wrapper / `_toolGroup` / `_clipFrame`, "mirroring `recordMouseTarget`") therefore now keys off elements that live **inside `TabBar`**. Because that wiring is `Tab`-side (it needs `win`), `TabBar` must expose the bar's element regions for the target test — see the relocation note below.

### `TabBar` is independently instantiable and window-agnostic

`TabBar`'s constructor takes a `TabBarOptions` bag (the bar-only subset of today's `TabOptions`: `widthMode`, `maxWidth`, `fixedWidth`, `underBorderFullWidth`, `side`, `align`, `orientation`, `scrollable`, `compact`, `reorderable`, `textAlign`, `tools`, plus its own `listeners`). It has no container/content dependency: a consumer can `new TabBar({...})`, append its element anywhere, call `createBarEntry(...)`, and wire `bar.on("tabpressed", …)`. The content-coupled options (`detachWindowMode`) and the `tabclose`/`empty` *content* semantics stay on `Tab`/`TabOptions`. This is the standalone surface `window-tab-header.md` composes.

### CODE_CONVENTIONS / ARCHITECTURE compliance

- **`callable()` wrapping + barrel** — `TabBar` exported as `export { TabBar as _TabBar, TabBarCallable as TabBar }`; added to [`component/container/index.ts`](../src/typescript/lib/component/container/index.ts) with `TabBarOptions` / `TabBarEvent`.
- **Typed setters + `XOptions`** — each migrated bar property keeps its typed setter (`setWidthMode`, `setSide`, `setAlign`, `setOrientation`, `setScrollable`, `setCompact`, `setReorderable`, `setMaxWidth`, `setFixedWidth`, `setUnderBorderFullWidth`, `setTextAlign`) with its cached backing field, now on `TabBar`, and a matching `TabBarOptions` field forwarded in `applyOptions`. `Tab` keeps thin forwarders (`Tab.setSide(s) → this._bar.setSide(s)` + content relayout) so `TabPanel` and `TabOptions` are byte-for-byte unchanged.
- **`Event` class for DOM, `on`/`off`/`emit` + `ListenerBag` for custom** — as above. The `TabBar`→`Tab` notifications use the full `on`/`off`/`emit` + `ListenerBag<TabBarEvent>` shape; the strip's own DOM listeners (the tab button `"action"`, the toolbar `keydown`, the `mousedown` veto-capture, the `contextmenu` subtree) self-listen via `Event.addSubtreeListener(this, …)` since `TabBar` *is* the element `Tab` used to reach into. Per the [the named-function rule](../ARCHITECTURE.md#L19), the per-entry inline-arrow closures are **relocated verbatim, not converted** — see the dedicated decision *Event closures are relocated verbatim* above for why (the closure model can't become bare named-method references without restructuring, and that is deferred to keep this extraction behaviour-preserving).
- **One element per class** — `TabBar` owns exactly one element (the toolbar); `_clipFrame`/`_toolGroup`/`_indicator`/`_reorderBar`/scroll arrows are child `Component`s it composes (same as today, where they were already separate Components). `TabIndicator` and `TabReorderBar` (today private module classes in Tab.ts) **move to TabBar.ts** as private module classes — they are bar-only.
- **JSDoc on every public member**, `@category Components`.
- **No new theme tokens** — the bar reuses every existing `--ts-ui-tab-*` token verbatim.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/component/container/TabBar.ts

/** Events emitted by a TabBar to its content owner. */
export type TabBarEvent =
    "tabpressed" | "reordered" | "tabclose" | "dockrequested" | "tabdragstart" | "tearoffrequested" | "detached";

export interface TabBarOptions extends PanelOptions {
    widthMode?: TabWidthMode;
    maxWidth?: number | null;
    fixedWidth?: number;
    underBorderFullWidth?: boolean;
    side?: TabSide;
    align?: TabAlign;
    orientation?: TabOrientation;
    scrollable?: boolean;
    compact?: boolean;
    reorderable?: boolean;
    textAlign?: TabTextAlign;
    tools?: Component[];
    listeners?: {
        tabpressed?:       (id: string) => void;
        reordered?:        (fromId: string, toIndex: number) => void;
        tabclose?:         (id: string) => void;
        dockrequested?:    (componentId: string, slot: number) => void;
        tabdragstart?:     (id: string) => void;
        tearoffrequested?: (id: string, clientX: number, clientY: number, forceBare: boolean) => void;
        detached?:         (id: string) => void;
    };
}

class TabBar extends Panel<TabBarOptions> {
    constructor(options?: TabBarOptions);

    // Cell lifecycle (the bar half of TabEntry). `id` is supplied by the owner.
    createBarEntry(id: string, name: string, constraints?: LayoutConstraints): this;
    removeBarEntry(id: string): this;                 // bar-only teardown (button group, roving, listeners, wrapper)
    getEntryIds(): string[];                          // current order
    getActiveEntryId(): string | null;
    setActiveEntry(id: string): this;                 // programmatic select that funnels through onTabPressed → emits "tabpressed"
    setActiveVisual(id: string): this;                // visual-only re-select (button state + indicator), no emit/roving — for post-close reselection
    isEntryCloseable(id: string): boolean;
    getEntryName(id: string): string;                 // the cell's label — Tab reads it for the tear-off window title
    getEntryButtonId(id: string): string;             // the tab button's id — Tab sets the content panel's aria-labelledby to it
    setEntryContentId(id: string, contentId: string): this; // owner pushes the content's component id (drag payload + button aria-controls)
    moveBarEntry(id: string, toIndex: number): this;  // used by the owner's dock path

    // Layout entry point called by Tab.doLayout with the strip rectangle.
    placeStrip(x: number, y: number, width: number, height: number): this;
    stripThickness(): number;                         // the cross-axis extent Tab needs for its band math

    // Tools (migrated verbatim).
    addTool(button: Component): this;
    removeTool(button: Component): this;

    // Bar-property setters/getters (migrated from Tab; cached + XOptions-forwarded).
    setWidthMode(mode: TabWidthMode): this;           getWidthMode(): TabWidthMode;
    setMaxWidth(px: number | null): this;             getMaxWidth(): number | null;
    setFixedWidth(px: number): this;                  getFixedWidth(): number;
    setUnderBorderFullWidth(full: boolean): this;     isUnderBorderFullWidth(): boolean;
    setSide(side: TabSide): this;                     getSide(): TabSide;
    setAlign(align: TabAlign): this;                  getAlign(): TabAlign;
    setOrientation(o: TabOrientation): this;          getOrientation(): TabOrientation;
    setScrollable(v: boolean): this;                  isScrollable(): boolean;
    setCompact(v: boolean): this;                     isCompact(): boolean;
    setReorderable(v: boolean): this;                 isReorderable(): boolean;
    setTextAlign(a: TabTextAlign): this;              getTextAlign(): TabTextAlign;

    // Custom-event surface (overloads per event; ListenerBag-backed).
    on(event: TabBarEvent, listener: Function): this;
    off(event: TabBarEvent, listener: Function): this;
    protected emit(event: TabBarEvent, ...payload: unknown[]): void;
}
```

`Tab` keeps its existing public surface (`TabOptions`, `TabEvent`, all the `setX`/`getX` tab setters, `createTab`, `addLazyTab`, `addTool`/`removeTool`, `setActiveTabIndex`/`getActiveTabIndex`, `on`/`off`/`emit`) — each tab setter and `addTool` becomes a thin forwarder to `this._bar`. **No `Tab` public signature changes**, so `TabPanel` and `LayoutSerialization` need no edits.

`TabWidthMode` / `TabSide` / `TabAlign` / `TabOrientation` / `TabTextAlign` stay exported from `Tab.ts` (the layout barrel already re-exports them); `TabBar` imports them from `~/layout/Tab.js`. (They are pure string-literal type aliases — importing a type from `Tab.ts` into `TabBar.ts` introduces **no** runtime `Tab`→`TabBar` cycle, because types are erased; verify with the typecheck.)

---

## Internal Structure

**DOM tree (unchanged shape, re-homed under `TabBar`):**

```
container element
├─ TabBar element  (the toolbar — was Tab._toolbar)        ← Tab raw-appends this one node
│   ├─ _clipFrame element (overflow:hidden tab region)
│   │   ├─ tab wrapper × N  (button + optional ✕ overlay)
│   │   ├─ _indicator (raw-appended overlay)
│   │   └─ _reorderBar (raw-appended overlay)
│   ├─ _toolGroup element (hand-positioned tool overlay)
│   └─ scroll arrow buttons (lazily built)
└─ content child × N  (the container's real children — owned/placed by Tab)
```

**`Tab.doLayout` after the split (sketch):**

```
// owned-child catch-up + lazy-kick + hide-all + ARIA  (CONTENT — stays)
// compute strip band + content rect via switch(this._side)  (stays — uses _bar.stripThickness())
this._bar.placeStrip(toolbarX, toolbarY, toolbarW, toolbarH);  // BAR — bar lays out its own internals
// visible-component sizing + placeComponent + cross-tab fade  (CONTENT — stays)
```

**`"tabpressed"` flow:** bar's tab `"action"` → `TabBar.onTabPressed` (sets button-group/roving/indicator-intent, emits `"tabpressed"(id)`) → `Tab` handler sets `_selectedTabIndex` to that id's content index, kicks lazy-load, schedules content relayout. (Today's [`onTabPressed`](../src/typescript/lib/layout/Tab.ts#L1468) splits: the roving/scroll-to-selected half is bar; the lazy-materialize + content half is `Tab`.)

**Tear-off flow:** bar's [`onTabDragEnd`](../src/typescript/lib/layout/Tab.ts#L2979) with `dropped === false` emits `"tearoffrequested"(id, clientX, clientY, _dragShiftHeld)`; `Tab` resolves the content by id and runs today's [`detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L3017) body verbatim (including `new Window` and `fillWindowWithStrip`), then the bar drops its `BarEntry` via the `"detached"` path. The `dropped === true` + content-moved-out case emits `"detached"(id)` so `Tab` drops the `ContentEntry`.

---

## Ordered Implementation Steps

1. **Create `TabBar.ts` skeleton** — `class TabBar extends Panel<TabBarOptions>`, `callable()` export, `TabBarOptions`/`TabBarEvent`. Move `TabIndicator` and `TabReorderBar` module classes from `Tab.ts` into `TabBar.ts`. Move the bar constants (`CLOSE_BUTTON_SIZE`, `CLOSE_GLYPH_SIZE`, `TAB_BUTTON_INSET`(`_COMPACT`), `STRIP_THICKNESS`(`_COMPACT`), `SCROLL_ARROW_SIZE`, `SCROLL_ARROW_STEP`, `TAB_FADE_DURATION_MS` is shared — keep a copy or import). Register the angle glyphs here.

2. **Migrate bar fields + bar setters** — move `_clipFrame`, `_buttonGroup`, `_rovingTabIndex`, `_indicator`, `_reorderBar`, `_tools`, `_toolGroup`, scroll-arrow fields, `_widthMode`/`_maxWidth`/`_fixedWidth`/`_underBorderFullWidth`(`FromTheme`)/`_side`/`_align`/`_orientation`/`_scrollable`/`_compact`/`_textAlign`/`_reorderable`/`_dndTeardowns`/`_dragMouseTarget`/`_dragShiftHeld`/`_dragInsertIndex`/`_themeCleanup` and their setters/getters into `TabBar`. The bar element setup (toolbar HBox/bg/under-border/clip-frame/tool-group wiring, theme-change subscription) moves from `Tab`'s constructor + `attach` into `TabBar`'s constructor/`init`. → verify: `tsc` passes for `TabBar.ts` in isolation (no `Tab`/`Window`/content references remain). **grep invariant:** `grep -n 'Window' src/typescript/lib/component/container/TabBar.ts` → zero matches.

3. **Migrate bar mechanics** — move `buildTabEntry` (→ `createBarEntry`), `wireComponentAria`'s *button-side* (the `setControls`/`getId` half stays bar; the component-side ARIA stays in `Tab` via an `id→element` callback or is re-wired by `Tab` when content arrives — pick the callback), the whole width/extent math (`stripThickness`, `tabModeExtent`, `applyTabWidths`, `buttonMainExtent`/`buttonCrossExtent`, `computeTabButtonInsets`/`computeToolButtonInsets`, `clampWrapperMain`, `isRotatedText`, `isVertical`), the toolbar-positioning helpers (`syncToolbarOrientation`, `toolGroupMainExtent`, `predictTabsExtent`/`predictedTabExtent`, `computeArrowReserve`, `positionClipFrame`, `applyTabButtonStyles`, `endAlignGap`, `positionToolGroup`, `positionIndicator`, `positionCloseButtons`, `layoutOverflowChrome`/`ensureScrollArrows`/`layoutOverflowArrows`/`hideOverflowArrows`, `clipScroll`/`clipScrollMax`/`setClipScroll`/`refreshScrollArrows`/`scrollStrip`/`revealSelectedIfRequested`), the DnD (`installTabDnD`/`teardownTabDnD`/`makeTabDragSource`/`makeTabDropTarget`/`isTabHeaderDrag`/`dropTabHeader`/`stripId`/`onTabDragEnd`/`updateReorderSlot`/`slotBoundary`/`dropReorder`/`reorderTab`), the context menu (`openTabMenu` + `_contextMenu`), and `onToolbarKeyDown`. Wire all the DOM listeners through `Event.addListener(this, …)` on `TabBar`. → verify: `TabBar.placeStrip` reproduces every position write that `Tab.doLayout` made between toolbar-place and content-place.

4. **Define the event seam** — in the migrated mechanics, replace each cross-seam call with an `emit`: `onTabPressed`→`emit("tabpressed", id)`; `dropReorder`/`reorderTab`→`emit("reordered", fromId, toIndex)` (the bar still does its own `_clipFrame.moveComponent`; `Tab` reorders `ContentEntry[]`); close-button `"action"`→`emit("tabclose", id)`; `dropTabHeader` foreign branch→`emit("dockrequested", componentId, slot)`; `onTabDragEnd` not-dropped→`emit("tearoffrequested", id, x, y, forceBare)`, dropped→`emit("detached", id)`; drag committed (after the close-button veto)→`emit("tabdragstart", id)`. The bar emits **no** `"empty"` event — it never removes a cell on its own (all removals are owner-driven), so `Tab` emits its own `"empty"` directly when `_contents` hits zero. Add `on`/`off`/`emit` overloads + `ListenerBag<TabBarEvent>`.

5. **Add `TabBar` cell/order accessors** — `getEntryIds`, `getActiveEntryId`, `setActiveEntry`, `isEntryCloseable`, `moveBarEntry`, `removeBarEntry`. These let `Tab` resolve content by id and keep order aligned.

6. **Reduce `Tab` to a content manager that owns a `_bar: TabBar`** — replace `_toolbar`/the four bar elements with `private _bar: TabBar`. `Tab.attach`: append `this._bar.getElement(true)` to the container; subscribe to the seven `TabBar` events with named handlers. `Tab.detach`: unsubscribe, tear the bar down (DnD teardown + element removal + theme cleanup — now `TabBar`-internal, exposed via a `TabBar.dispose()`/`detach()` method), call `super.detach()`. `Tab.doLayout`: keep the owned-child catch-up, lazy-kick, hide-all/ARIA, band math, `this._bar.placeStrip(...)`, then the content-place tail. Define `ContentEntry` and re-key `_tabs`→content entries by id. `createTab`/`addLazyTab`/`materializeAsync`/`getVisibleComponent`/`composeSize`/`computeTotalMinSize`/`dockComponent`/`removeEntryKeepingContent`/`detachTabToWindow`/`fillWindowWithStrip`/host-window helpers/`closeTab`/`selectNextTab`/`setActiveTabIndex`/`getActiveTabIndex` stay in `Tab`, rewired to call the bar for cell ops and resolve content by id. Each tab setter/`addTool`/`removeTool` becomes a forwarder to `_bar` (+ `scheduleLayout` where it did before). → verify: `tsc -p tsconfig.lib.json --noEmit` → 0 errors.

7. **Barrel + docs** — add `TabBar` to `component/container/index.ts` (`@category Components`); curated page `docs/components/TabBar.md`, sidebar entry, `docs/components/index.md` catalog row; note in `docs/layouts/Tab.md` that the bar chrome is now a composable `TabBar`. → verify: `npm run docs:build` → 0 errors, 0 link warnings.

8. **Regression checkpoints** — `grep -n 'Window' src/typescript/lib/component/container/TabBar.ts` → 0; `grep -n '_toolbar\b' src/typescript/lib/layout/Tab.ts` → 0 (renamed to `_bar`); smoke-test the demo (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | src/typescript/lib/component/container/TabBar.ts |
| Modify | src/typescript/lib/layout/Tab.ts |
| Modify | src/typescript/lib/component/container/index.ts |
| Create | docs/components/TabBar.md |
| Modify | docs/components/index.md |
| Modify | docs/.vitepress/config.mts |
| Modify | docs/layouts/Tab.md |

(`TabPanel.ts` and `LayoutSerialization.ts` are **not** modified — `Tab`'s public surface is unchanged.)

---

## Verification

- **Typecheck:** `tsc -p tsconfig.lib.json --noEmit` → 0 errors.
- **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Window-agnostic invariant:** `grep -n 'Window\|~/core/Window' src/typescript/lib/component/container/TabBar.ts` → zero matches; `grep -n '~/layout/Tab' src/typescript/lib/component/container/TabBar.ts` → only `import type` of the string-literal aliases.
- **Cycle check:** confirm `TabBar` imports neither `Tab` (value) nor `Window`, so it is a leaf dependency sink.
- **Runtime smoke ([`TabDemoPanel`](../src/typescript/TabDemoPanel.ts)):**
  - **First `TabPanel`** (strip-mode tear-off, `reorderable: true`, default `detachWindowMode: "strip"`, ~[L134](../src/typescript/TabDemoPanel.ts#L134)): tab select, in-strip reorder DnD, dock a foreign tab in, tear a tab off → a strip-mode window opens at the release point; emptied source behaves as before; closeable ✕ and the right-click tab context menu work; roving tabindex (ArrowLeft/Right) cycles tabs; the selection indicator slides; overflow scroll arrows appear and scroll when the strip overflows; `addTool` buttons stay pinned trailing.
  - **Second `TabPanel`** (`detachWindowMode: "bare"`, ~[L168](../src/typescript/TabDemoPanel.ts#L168)): tear-off opens a bare window (content fills the body); Ctrl-drag re-dock works.
  - Scope DevTools queries to `.TabDemoPanel .TabPanel` (multiple TabPanels coexist).
- **Theme toggle:** switch Modern/Classic/Dark → the strip under-border default tracks the theme exactly as before (the `_themeCleanup` subscription now lives in `TabBar`).

---

## Documentation Impact

- **New public symbol `TabBar`** (+ `TabBarOptions`, `TabBarEvent`): re-export from `component/container/index.ts`; `@category Components`; verify it lands under `docs/api/component/container/` (callable-promoted from `variables/` to `classes/` by `typedoc-callable-plugin.mjs`).
- **New component page** `docs/components/TabBar.md`: describe the standalone bar (cells, events, tools, side/align/scroll), with the cross-bucket link form `[\`Tab\`](/api/layout/classes/Tab)` (different bucket). Link it in `docs/.vitepress/config.mts` and add a catalog row to `docs/components/index.md`.
- **`docs/layouts/Tab.md`:** add one line that the tab-bar chrome is a composable `TabBar` (cross-bucket link), and that `Tab` now composes it — no consumer-facing behaviour change.
- JSDoc on every `TabBar` public member.

---

## Potential Challenges

- **Index/id alignment across reorder+dock+close+tear-off.** The shared-id seam must hold the two arrays consistent; mitigation: `Tab` always re-derives content order from `TabBar.getEntryIds()` after a `"reordered"`/`"dockrequested"` rather than mirroring index math independently.
- **`onTabPressed` is dual-purpose today** (roving/scroll-to-selected + lazy-materialize/content). Splitting it must keep both halves firing in the same order; mitigation: bar does its half then emits, `Tab`'s handler does the content half synchronously — same sequence as today's single method.
- **`commitBounds`/`doLayout` stale-DOM trap (memory).** `placeStrip` reads element rects inside the bar's own `doLayout`; preserve today's `commitElementStyle`/auto-commit ordering exactly when relocating the positioning helpers.
- **`setReorderable` deferred-install timing.** Today `attach` re-runs `installTabDnD` if `reorderable` was set during `super()` (Tab.ts:1603). In `TabBar` the toolbar element exists earlier (it *is* the bar), so the deferral simplifies — but verify a `TabBar({reorderable:true})` installs DnD on first render, not before the element exists (defer to `init` per the *setter-defer-DOM-work* memory).
- **`applyStyle` replay (memory).** `TabIndicator`/`TabReorderBar` already override `applyStyle` / use tracked setters; moving them verbatim preserves that — don't "tidy" the replay overrides.
- **Subtree-listener leak parity.** `removeBarEntry`/`closeTab` must still tear down the wrapper's `contextmenu` subtree listener (Tab.ts:3141/3430) — keep `contextMenuListener` on `BarEntry` and remove it on bar-side teardown.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — the whole file is the source of the split; especially `TabEntry` (L287), the bar fields (L504–592), `attach`/`detach` (L1579/L1613), `onTabPressed`/`setActiveTabIndex` (L1468/L1512), `buildTabEntry` (L1735), `createTab` (L1910), `doLayout` (L2618, band math L2695, bar-place L2721–2754, content-place L2756–2810), the DnD region (L2820–3003), `detachTabToWindow`/`fillWindowWithStrip`/`dockComponent`/`removeEntryKeepingContent`/host-window helpers (L3017–3201), reorder (L3209–3330), `closeTab`/`selectNextTab` (L3405–3483).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `attach`/`detach`/`doLayout`/`placeComponent`/`commitBounds`; confirms a `LayoutManager` is not a `Component`.
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — the `Tab`-wrapping panel that must stay unchanged; confirms which `Tab` setters are forwarded.
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts), [`StatusBar.ts`](../src/typescript/lib/component/container/StatusBar.ts) — sibling `Panel`-based chrome widgets; the `callable()` + `XOptions` + barrel template.
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `makeDragSource`/`makeDropTarget`/`tabDragRegistry`/`TabDragData`; the DnD surface the bar keeps using.
- [`src/typescript/lib/component/container/index.ts`](../src/typescript/lib/component/container/index.ts), [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — export surfaces.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — strip-mode first `TabPanel` (~L134) and bare-mode second (~L168), the smoke surface.

---

## Non-Goals

- **`window-tab-header.md` (the tear-off window tab-header)** — the *separate follow-up* that justifies this extraction. `TabWindowHeader`, the tear-off coordinator, `installWindowControls` / `installWindowMoveTrigger` / `syncHostWindowTitle`, the `_windowTabHeader` flag, `Window.setHeaderCollapsed` / `startMoveFrom`, and any `Window` wiring are **out of scope** here. This plan only makes `TabBar` standalone and window-agnostic so that follow-up can compose it.
- **window-tab-header.md relocations (informational — that plan is NOT edited).** After this extraction, several `Tab.ts` internals it cites move to `TabBar`: `recordMouseTarget` (the DnD veto, ~L2827), the tab wrappers as DragManager drag sources, the `_clipFrame` drop target, the selection indicator, the reorder bar, overflow scrolling, `addTool`/`_toolGroup`, `onTabPressed`'s roving/scroll half, and `reorderTab`. The follow-up's `installWindowMoveTrigger` arbitration (early-return when `e.target` is inside a tab wrapper / `_toolGroup` / `_clipFrame`) will therefore key off `TabBar`-internal elements and must wire its toolbar `mousedown` through a `TabBar`-exposed seam (e.g. a `TabBar` `"backgroundpress"` event or a `getStripElement()` region test) rather than reaching the bar element directly — that follow-up adds that seam. What stays on `Tab` and remains correct for the follow-up: `fillWindowWithStrip`, `hostWindow`, `syncHostWindowCloseable`, `closeHostWindowIfEmpty`, `closeHostWindowWhenEmpty`, `detachTabToWindow`, and the planned `installWindowControls` / `syncHostWindowTitle` (all `Window`-touching → `Tab`-side). The follow-up's three `syncHostWindowCloseable` call sites (`createTab`, `removeEntryKeepingContent`, `closeTab`) and its `onTabPressed` title hook all remain on `Tab`.
- **Behavioural changes of any kind** — no new gestures, no new options, no styling changes. Pure relocation.
- **Splitting `Tab` further** (e.g. a separate content manager) — out of scope; `Tab` stays the content manager.
