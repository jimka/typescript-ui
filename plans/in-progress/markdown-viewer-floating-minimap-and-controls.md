# Markdown Viewer — Floating Minimap and Controls — Implementation Plan

## Overview

This plan hoists the docs-app-local heading outline (`DocsMinimap`) into a reusable `packages/lib` component, converts its rows from a flat `Link` list to a `Tree`, and turns it into a floating panel that sits over the markdown prose instead of beside it. It adds live scroll-tracking so the outline highlights whatever heading is currently on screen, and adds a floating control cluster for adjusting the viewer's reading width and zoom.

None of this can float without something to pin it to a corner. [`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) already does exactly that for its own zoom/fit/reset buttons, by hand, using [`Anchor`](packages/lib/src/typescript/lib/layout/Anchor.ts) — and nothing else in `packages/lib` formalizes the technique. This plan extracts it into a new `FloatingPanel` component, refactors `DiagramView` onto it, and builds the new minimap and viewer controls on top of the same primitive, so the codebase ends up with one corner-pinning mechanism instead of two.

The new minimap and controls compose around a new `MarkdownViewer` component (`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`), which wraps a single [`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L473) instance. The docs app's own content pane, [`DocsContent`](packages/docs/src/shell/DocsContent.ts), is a stack of *several* `Markdown` blocks plus live demos — it does not fit `MarkdownViewer`'s single-instance shape — so `DocsShell` wires the relocated minimap directly against `DocsContent` instead of adopting `MarkdownViewer` wholesale. Both integrations share the same scroll-tracking contract.

---

## Architecture Decisions

### One corner-pinning primitive: `FloatingPanel`

A new class, `FloatingPanel` (`packages/lib/src/typescript/lib/component/container/FloatingPanel.ts`), extends `Panel` and adds two options: `corner` (`"top-left" | "top-right" | "bottom-left" | "bottom-right"`) and `margin` (pixels). It derives and owns one `AnchorConstraints` instance from those two options and exposes it via `getAnchorConstraints()`. A consumer whose own layout manager is already `Anchor` adds a `FloatingPanel` the same way `DiagramView` adds its controls today: `host.addComponent(panel, panel.getAnchorConstraints())`.

`FloatingPanel` does not install `Anchor` on its host and does not touch the host's other children — it only turns "which corner, how much margin" into the `AnchorConstraints` object `Anchor.doLayout()` already knows how to read.[^floatingpanel-scope] It carries no default background, border, or shadow — plain, edge-to-edge, `insets: new Insets(0, 0, 0, 0)` — so wrapping `DiagramView`'s existing bare button cluster in one changes nothing visible.[^diagram-no-regress] A consumer that wants a visible floating "card" (the minimap, the viewer controls) styles its own `FloatingPanel` subclass or instance with the normal `Component` setters, the same way any other `Panel` gets a background or shadow.

### `MarkdownViewer` composes `Markdown` + minimap + controls; `DocsContent` does not adopt it

`MarkdownViewer` (new, `packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`) is a `Panel` whose own layout manager is `Anchor` and whose `autoScroll` is `"y"`. It holds one `Markdown` child, stretched to the viewer's width via `AnchorConstraints` (`left: 0, right: 0`, no vertical edges — see *Internal Structure*), plus a `MarkdownMinimap` pinned top-right and a viewer-controls `FloatingPanel` pinned bottom-right, both added after the `Markdown` child so they paint over it in DOM order.[^paint-order]

This is the generic, single-document case: any consumer embedding one `Markdown` instance gets the floating minimap and controls for free by using `MarkdownViewer` instead of `Markdown` directly. `DocsContent` cannot be that consumer — it stacks several `Markdown` blocks and live demo components per page (`DocsContent.buildBlock`, [DocsContent.ts:272-280](packages/docs/src/shell/DocsContent.ts#L272-L280)) — so rebuilding it as a `MarkdownViewer` would mean tearing apart working, page-composition logic that has nothing to do with this feature.[^docscontent-shape] Instead, `DocsShell` wraps the *existing* `DocsContent` in a small Anchor-managed container and pins the relocated minimap over it directly (step 9 below). `DocsContent` gains the same `activeheadingchange` event `MarkdownViewer` exposes, so both feed the same minimap contract.

The viewer-property controls (width, zoom) are `MarkdownViewer`-only. They call `Markdown.setMaxMeasure` / `Markdown.setFontScale` on the one `Markdown` child `MarkdownViewer` owns; `DocsContent`'s multiple blocks have no single "the" instance to drive, and the docs app does not currently ask for these controls, so `DocsShell` does not build that cluster.

### Scroll-tracking lives on the scroll-owning `Panel`, not on `Markdown`

The active heading cannot be computed from outside the scroll-owning component. `Component.getScrollElement()` is `protected`, and `Panel`'s default `scrollbarStyle: "overlay"` ([Panel.ts:111-117](packages/lib/src/typescript/lib/core/Panel.ts#L111-L117)) means the element that actually scrolls is often an id-less inner div, not the panel's own element — so an outside caller has no correct element to measure against even if it could reach one. Only the scroll-owning `Panel` itself has the access to do this correctly.

So the scroll-owning component computes its own active heading and emits it, mirroring `Panel`'s own scroll-shadow feature, which already listens to its own native scroll this way: `Event.addSubtreeListener(this, "scroll", handler)` ([Panel.ts:816-833](packages/lib/src/typescript/lib/core/Panel.ts#L816-L833)) — subtree, not exact-target, because in overlay-scrollbar mode the scroll fires on that id-less inner element. `"scroll"` is a first-class DOM-routed event type in this framework already (`PASSIVE_TYPES` in [Event.ts:58](packages/lib/src/typescript/lib/core/Event.ts#L58) lists it), so no new capability is needed in `Event`. `MarkdownViewer` and `DocsContent` each wire this listener on themselves — legal, since `Event.addSubtreeListener(this, …)` is always "listen on self," never on another component (ARCHITECTURE.md, *A component must not listen to another component's events through Event*).

The computed heading id is exposed through a typed event, not a raw scroll offset, because the geometry computation itself needs the same protected access — pushing it out to a consumer would just recreate the access problem one level up. `MarkdownMinimap` therefore consumes a small structural interface, `HeadingScrollSource`, rather than depending on `Markdown`, `Panel`, or `DocsContent` concretely:

```typescript
export interface HeadingScrollSource {
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
}
```

Both `MarkdownViewer` and `DocsContent` satisfy this structurally. The event fires only when the computed id actually changes, mirroring `Body.renderWindowPass`'s own scroll-derived emit guard ([Body.ts:940-945](packages/lib/src/typescript/lib/component/table/Body.ts#L940-L945)), so a `MarkdownMinimap` listener isn't asked to reselect an already-selected row on every scroll tick.

### Minimap rows come from `Tree`; navigation stays outside the minimap

`MarkdownMinimap` builds a real `TreeNode[]` hierarchy from the flat `MarkdownHeading[]` list (see *Internal Structure*) and hosts it in a `Tree`, mirroring [`DocsSidebar`](packages/docs/src/shell/DocsSidebar.ts#L87-L99)'s own construction (`Tree({ backgroundColor: "transparent", … })`, `setNodes`, `on("selection", …)`). Unlike today's `DocsMinimap`, which holds a `Router` and calls `router.navigate` itself ([DocsMinimap.ts:97-99](packages/docs/src/shell/DocsMinimap.ts#L97-L99)), the new `MarkdownMinimap` takes no `Router` at all — that would force a routing dependency onto every consumer, most of whom have none. It emits a semantic `"select"` event carrying just the clicked heading's id, exactly as `Tree` itself emits `"selection"` without knowing what a caller does with it ([DocsSidebar.onSelection](packages/docs/src/shell/DocsSidebar.ts#L320-L338) is the precedent: it owns the `router.navigate` call, `Tree` does not). `DocsShell` keeps that call; `MarkdownViewer` instead scrolls its own `Markdown` to the heading.

### Tree's background stays opaque; the minimap supplies its own frame

`Tree`'s default `backgroundColor` (`var(--ts-ui-input-bg, rgb(255,255,255))`) is deliberately opaque, and that is the right call for a panel floating over dense prose — a translucent tree would be unreadable against text scrolling underneath it. `MarkdownMinimap` gives its own `Tree` child `backgroundColor: "transparent"` (matching `DocsSidebar`'s own usage) and puts the opaque surface, plus a shadow and rounded corners, on itself instead, so there is exactly one opaque box, not two stacked ones.[^tree-bg-precedent]

### Heading-depth cutoff: `maxHeadingDepth`, default `3`

`MarkdownMinimapOptions.maxHeadingDepth` (default `3`) is the deepest heading depth shown; a heading at or past `maxHeadingDepth + 1` is dropped from the tree entirely, not merely hidden. The default hides h4 and deeper, per the existing follow-up request. See *Internal Structure* for the exact algorithm and worked example.

### `DiagramView` refactor is behavior-preserving

`buildControls()` currently does `this._controls = new Component(); this._controls.setLayoutManager(new VBox()); …` ([DiagramView.ts:1729-1741](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1729-L1741)), and the constructor separately builds an `AnchorConstraints` with `.right = CONTROLS_MARGIN; .bottom = CONTROLS_MARGIN` ([DiagramView.ts:341-344](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L341-L344)). This becomes `this._controls = new FloatingPanel({ corner: "bottom-right", margin: CONTROLS_MARGIN, layoutManager: new VBox() })`, added via `this.addComponent(this._controls, this._controls.getAnchorConstraints())`. `Anchor.doLayout()` resolves a `FloatingPanel`'s extent from its own `getPreferredSize()` exactly as it did for the old plain `Component` — the four buttons' stacked `VBox` preferred size is unchanged — so the committed geometry is byte-identical.[^diagram-no-regress] `DiagramView`'s own `setLayoutManager(new Anchor())` ([DiagramView.ts:315](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L315)) is untouched — `FloatingPanel` never installs a layout manager on its host.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/container/FloatingPanel.ts
export type FloatingPanelCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface FloatingPanelOptions extends PanelOptions {
    /** Which corner of the host's inner box to pin to. Default `"top-right"`. */
    corner?: FloatingPanelCorner;
    /** Pixel distance from the two corner edges. Default `12`. */
    margin?: number;
}

// Generic (mirroring Panel<TOptions extends PanelOptions>) so a subclass like
// MarkdownMinimap can extend FloatingPanel<MarkdownMinimapOptions> and inherit
// getAnchorConstraints() typed against its own wider options.
class FloatingPanel<TOptions extends FloatingPanelOptions = FloatingPanelOptions> extends Panel<TOptions> {
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);
    getCorner(): FloatingPanelCorner;
    setCorner(value: FloatingPanelCorner): this;
    getMargin(): number;
    setMargin(value: number): this;
    /** The AnchorConstraints instance this panel owns; pass to `host.addComponent(panel, panel.getAnchorConstraints())`. */
    getAnchorConstraints(): AnchorConstraints;
}
```

```typescript
// packages/lib/src/typescript/lib/component/display/Markdown.ts — additions to the existing class
export interface MarkdownOptions extends ComponentOptions {
    markdown?: string;
    linkResolver?: MarkdownLinkResolver;
    /** Per-instance override of the prose column's max width (e.g. `"60ch"`, `60`). `null`/omitted uses the theme's `--ts-ui-md-max-measure` default. */
    maxMeasure?: string | number | null;
    /** Multiplies the prose's base font size; headings scale with it via their own relative sizing. Default `1`. */
    fontScale?: number;
}

class Markdown {
    // existing members unchanged, plus:
    setMaxMeasure(value: string | number | null): this;
    getMaxMeasure(): string | number | null;
    setFontScale(value: number): this;
    getFontScale(): number;
}

/** Resolves which heading in `headings` is at or nearest above `scrollElement`'s viewport top. */
export function findActiveHeading(scrollElement: Handle, headings: MarkdownHeading[]): string | null;
```

```typescript
// packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts
export interface HeadingScrollSource {
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
}

export type MarkdownMinimapEvent = "select";

export interface MarkdownMinimapOptions extends FloatingPanelOptions {
    /** Deepest heading depth shown; deeper headings are dropped entirely. Default `3`. */
    maxHeadingDepth?: number;
    /** The scroll-owning source whose active-heading changes drive the highlighted row. */
    scrollSource?: HeadingScrollSource;
    listeners?: {
        select?: (headingId: string) => void;
    };
}

class MarkdownMinimap extends FloatingPanel<MarkdownMinimapOptions> {
    constructor(options?: MarkdownMinimapOptions, subclassDefaults?: Partial<MarkdownMinimapOptions>);
    setHeadings(headings: MarkdownHeading[]): this;
    getMaxHeadingDepth(): number;
    on(event: "select", listener: (headingId: string) => void): this;
    off(event: "select", listener: (headingId: string) => void): this;
}
```

```typescript
// packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts
export interface MarkdownViewerOptions extends PanelOptions {
    markdown?: string;
    linkResolver?: MarkdownLinkResolver;
    /** Default `3`, forwarded to the internal MarkdownMinimap. */
    maxHeadingDepth?: number;
    /** Default `true`. */
    showMinimap?: boolean;
    /** Default `true`. */
    showControls?: boolean;
}

class MarkdownViewer extends Panel<MarkdownViewerOptions> implements HeadingScrollSource {
    constructor(options?: MarkdownViewerOptions, subclassDefaults?: Partial<MarkdownViewerOptions>);
    /** Read-only escape hatch; change content via {@link setMarkdown}, not by calling `getMarkdown().setMarkdown(...)` directly — that would desync the minimap. */
    getMarkdown(): Markdown;
    /** Replaces the rendered source, recomputes headings, and refreshes the minimap. */
    setMarkdown(markdown: string): this;
    setMinimapVisible(value: boolean): this;
    isMinimapVisible(): boolean;
    setControlsVisible(value: boolean): this;
    isControlsVisible(): boolean;
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
}
```

```typescript
// packages/docs/src/shell/DocsContent.ts — additions to the existing class
class DocsContent {
    // existing "outlinechange" surface unchanged, plus:
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): this;
}
```

---

## Internal Structure

### Why `left: 0, right: 0` alone gives `Markdown` its natural height

`Anchor.resolveAxis` ([Anchor.ts:109-132](packages/lib/src/typescript/lib/layout/Anchor.ts#L109-L132)) computes each axis independently. With both `left` and `right` set, the X axis stretches between them, ignoring the child's own preferred width. With neither `top` nor `bottom` set, the Y axis falls through to `extent = size ?? preferred` — the child's *own* preferred height, not zero and not a stretch — so `MarkdownViewer`'s `Markdown` child reports its true (tall) content height via `Markdown.measureContentHeight`, overflows `MarkdownViewer`'s box, and `MarkdownViewer`'s own `autoScroll: "y"` scrolls that overflow natively. No special-case handling is needed in either `Anchor` or `Markdown` — this is `Anchor`'s existing, unmodified behavior.

### Building the minimap's tree from a flat heading list

`MarkdownMinimap.setHeadings` walks the flat, document-ordered `MarkdownHeading[]` once with a depth stack, building `TreeNode[]` roots and, in the same pass, a `Map<string, string | null>` from every heading id (shown or not) to the nearest ancestor id that *is* shown — used to resolve an active-heading event that lands on a hidden heading.

```
roots: TreeNode[] = []
stack: { depth: number, node: TreeNode }[] = []
nodesById: Map<string, TreeNode> = new Map()          // shown nodes only
nearestShown: Map<string, string | null> = new Map()  // every heading id, hidden or not

for heading in headings (document order):
    while stack.length > 0 and stack.top.depth >= heading.depth:
        stack.pop()

    ancestorId = stack.length > 0 ? stack.top.node.data : null
    shown = heading.depth <= maxHeadingDepth

    if shown:
        node = { label: heading.text, data: heading.id, children: [] }
        if stack.length > 0: stack.top.node.children.push(node) else roots.push(node)
        nodesById.set(heading.id, node)
        nearestShown.set(heading.id, heading.id)
        stack.push({ depth: heading.depth, node })
    else:
        nearestShown.set(heading.id, ancestorId !== null ? nearestShown.get(ancestorId) : null)
```

A heading whose depth skips a level relative to its predecessor (h1 then h3, no h2) nests under the nearest shallower ancestor still on the stack, matching how the existing `DocsSidebar` nav tree and typical outline UIs treat a skipped level.

Worked example, `maxHeadingDepth = 3`:

| # | heading (depth) | shown? | tree position |
|---|---|---|---|
| 1 | Introduction (1) | yes | root |
| 2 | Getting Started (2) | yes | child of Introduction |
| 3 | Install (3) | yes | child of Getting Started |
| 4 | Advanced flags (4) | **no** | dropped; `nearestShown.get("advanced-flags") === "install"` |
| 5 | Usage (2) | yes | child of Introduction |

Resulting tree:

```
Introduction
├─ Getting Started
│  └─ Install
└─ Usage
```

`setHeadings` calls `this._tree.setNodes(roots)` then `this._tree.expandAll()` once, so every shown node is already in `Tree`'s flattened, visible set — `selectNode` can then run synchronously on every `activeheadingchange` tick without the async `revealByPredicate` dance `DocsSidebar.select` needs for its lazily-loaded API subtree ([DocsSidebar.ts:115-127](packages/docs/src/shell/DocsSidebar.ts#L115-L127)).

`handleActiveHeadingChange(id)`: if `id === null`, no-op (leave the last selection standing — matches how most outline widgets behave above the first heading). Otherwise resolve `resolvedId = nearestShown.get(id) ?? null`; if `resolvedId` is non-null, `const node = nodesById.get(resolvedId); if (node) this._tree.selectNode(node);`.

### Finding the active heading from scroll position

`findActiveHeading` (in `Markdown.ts`, exported, used by both `MarkdownViewer` and `DocsContent`) mirrors `DocsContent.scrollToHeading`'s existing lookup technique ([DocsContent.ts:426-443](packages/docs/src/shell/DocsContent.ts#L426-L443)) in the read direction: the active heading is the last one, in document order, whose top edge is at or above the scroll container's own top.

```typescript
export function findActiveHeading(scrollElement: Handle, headings: MarkdownHeading[]): string | null {
    const paneTop = DOM.source.getElementRect(scrollElement).top;
    let active: string | null = null;

    for (const heading of headings) {
        const el = DOM.source.getElementById(heading.id);
        if (!el || !DOM.source.contains(scrollElement, el)) {
            continue;
        }
        if (DOM.source.getElementRect(el).top <= paneTop) {
            active = heading.id;
        } else {
            break; // headings are in document order; every later one is further below
        }
    }

    return active;
}
```

Worked example — viewport top at document coordinate 500, headings rendered at Introduction@100, Getting Started@600, Install@900:

| pane top | last heading with `top <= paneTop` | active |
|---|---|---|
| 500 | Introduction (100) | `"introduction"` |
| 650 | Getting Started (600) | `"getting-started"` |
| 950 | Install (900) | `"install"` |

`MarkdownViewer` and `DocsContent` each call `findActiveHeading(this.getScrollElement()!, this._headings)` from their own `Event.addSubtreeListener(this, "scroll", …)` handler, and emit `"activeheadingchange"` only when the result differs from the previous tick's.

### Viewer-property control presets

`MarkdownViewer`'s controls step through two fixed preset arrays rather than exposing continuous sliders, mirroring `DiagramView`'s own discrete zoom-in/zoom-out step buttons rather than a slider:

```typescript
const WIDTH_PRESETS_CH = [60, 70, 90];      // narrow / default / wide — 70 matches the theme's own 70ch default
const ZOOM_PRESETS     = [0.85, 1.0, 1.15, 1.3];
const DEFAULT_WIDTH_INDEX = 1;
const DEFAULT_ZOOM_INDEX  = 1;
```

`MarkdownViewer` keeps `_widthIndex` / `_zoomIndex`, both starting at their default index. "Width narrower" / "width wider" move `_widthIndex` by one, clamped to `[0, WIDTH_PRESETS_CH.length - 1]` (mirroring `DiagramView.clampZoom`'s clamp-don't-throw behaviour), then call `this._markdown.setMaxMeasure(WIDTH_PRESETS_CH[_widthIndex] + "ch")`. "Zoom out" / "zoom in" do the same against `ZOOM_PRESETS` and `this._markdown.setFontScale(...)`. "Reset" sets both indices back to their default index **and** calls `this._markdown.setMaxMeasure(null)` / `this._markdown.setFontScale(1)` — clearing the override entirely, not re-applying `WIDTH_PRESETS_CH[1]` — so a page that never touched the controls and a page that stepped away and reset both end up reading the live theme default, not a snapshot of it taken at build time.

| action | `_widthIndex` before → after | `setMaxMeasure` call |
|---|---|---|
| wider (from default) | 1 → 2 | `setMaxMeasure("90ch")` |
| wider again | 2 → 2 (clamped) | `setMaxMeasure("90ch")` (no-op write) |
| reset | 2 → 1 | `setMaxMeasure(null)` |

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/container/FloatingPanel.ts`** — new file. `FloatingPanel<TOptions extends FloatingPanelOptions = FloatingPanelOptions> extends Panel<TOptions>` (generic, mirroring `Panel`'s own `<TOptions extends PanelOptions>` shape, so `MarkdownMinimap` can extend `FloatingPanel<MarkdownMinimapOptions>`), class default `insets: new Insets(0, 0, 0, 0)`, corner default `"top-right"`, margin default `12`. Constructor builds and stores one `AnchorConstraints` from the resolved corner/margin. `setCorner` / `setMargin` early-return on an unchanged value (mirroring `Component.setBackgroundColor`'s guard), otherwise mutate the stored `AnchorConstraints`' fields in place and call `this.getParent()?.scheduleLayout()`. Export via `packages/lib/src/typescript/lib/component/container/index.ts` (`FloatingPanel`, `FloatingPanelOptions`, `FloatingPanelCorner`).
   Verify: `grep -n "getAnchorConstraints" packages/lib/src/typescript/lib/component/container/FloatingPanel.ts` shows the method; typecheck passes.

2. **`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`** — refactor `buildControls()` (lines 1729-1741) to construct `this._controls` as a `FloatingPanel({ corner: "bottom-right", margin: CONTROLS_MARGIN, layoutManager: new VBox() })` instead of a plain `Component`. Replace the constructor's `controlsConstraints` block (lines 341-344) with `this.addComponent(this._controls, this._controls.getAnchorConstraints())`. Remove the now-unused `AnchorConstraints` import (line 21) — confirm with `grep -n "AnchorConstraints" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` returning zero matches. `Anchor` import (line 20) stays.
   Verify: `npm test -- DiagramView` in `packages/lib` — every existing assertion in `DiagramView.test.ts` (visibility toggle, `getComponents()` length 4, corner-pin geometry at lines 992-1055) still passes unmodified.

3. **`packages/lib/tests/component/diagram/DiagramView.test.ts`** — add one new test asserting `view._controls.getInsets()` is `new Insets(0, 0, 0, 0)` (or equivalently that `view._controls.getWidth()`/`getHeight()` match the pre-refactor values), guarding against `FloatingPanel`'s `Panel` ancestry silently reintroducing `Panel`'s own default `4px` insets ([Panel.ts:111-117](packages/lib/src/typescript/lib/core/Panel.ts#L111-L117)) and shifting the cluster.

4. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add `maxMeasure` and `fontScale` to `MarkdownOptions` (after `linkResolver`, lines 360-373). Add a private `_maxMeasure: string | null = null` field. Replace the constructor's unconditional `this.setElementCSSRule("maxWidth", "var(--ts-ui-md-max-measure, 70ch)")` (line 546) with `this.setMaxMeasure(this._options.maxMeasure ?? null);`, and add `this.setFontScale(this._options.fontScale ?? 1);` alongside it. Add the four new methods:
   - `setMaxMeasure(value: string | number | null): this` — writes `this._options.maxMeasure = value` (so `getMaxMeasure` reflects the raw call), normalizes a `number` to `` `${value}ch` `` into `_maxMeasure`, then writes `this.setElementCSSRule("maxWidth", this._maxMeasure ?? "var(--ts-ui-md-max-measure, 70ch)")`.
   - `getMaxMeasure(): string | number | null` — returns `this._options.maxMeasure ?? null`.
   - `setFontScale(value: number): this` — writes `this.setElementCSSRule("fontSize", value === 1 ? null : (value * 100) + "%")`; stores `this._options.fontScale = value`.
   - `getFontScale(): number` — returns `this._options.fontScale ?? 1`.
   Add the exported `findActiveHeading` function near `extractMarkdownHeadings` (after line 1504).
   Verify: `new Markdown('# T', { maxMeasure: 60 }).getMaxMeasure()` returns `60`; the rendered element's `maxWidth` style resolves to `"60ch"`.

5. **`packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts`** — new file, per *Public API* and *Internal Structure*. Constructor builds the internal `Tree({ backgroundColor: "transparent" })`, sets this panel's own `backgroundColor` (e.g. `var(--ts-ui-input-bg, rgb(255,255,255))`, matching `Tree`'s own default so the visual weight is familiar) plus a shadow/border-radius, and adds the `Tree` filling its content box (`Fit` layout manager — a `FloatingPanel` needing exactly one filling child is the same shape `Fit` already exists for). Wires `this._tree.on("selection", this.handleSelection)` → `this.emit("select", node.data as string)`. If `options.scrollSource` is given, wires `scrollSource.on("activeheadingchange", this.handleActiveHeadingChange)` in the constructor and `scrollSource.off(...)` in an overridden `destructor()` (calling `super.destructor()` last, mirroring `DiagramView.destructor`'s own cleanup-then-super order).
   Verify: unit tests below.

6. **`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`** — new file, per *Public API*, *Architecture Decisions*, and *Viewer-property control presets*.
   - Constructor: `super(options, { layoutManager: new Anchor(), autoScroll: "y" })`. Build `this._markdown = new Markdown(options?.markdown, { linkResolver: options?.linkResolver })` and add it with an `AnchorConstraints` where only `left = 0, right = 0` are set (no top/bottom — see *Internal Structure*, "Why `left: 0, right: 0` alone gives `Markdown` its natural height"). Compute `this._headings = extractMarkdownHeadings(options?.markdown ?? "")`.
   - Build `this._minimap = new MarkdownMinimap({ scrollSource: this, maxHeadingDepth: options?.maxHeadingDepth, corner: "top-right" })`, call `this._minimap.setHeadings(this._headings)`, add it via `this.addComponent(this._minimap, this._minimap.getAnchorConstraints())`, and wire `this._minimap.on("select", this.handleMinimapSelect)` where `handleMinimapSelect(id)` scrolls `this` to that heading using the same `getElementById` + `getElementRect` + `setScrollTop` technique as `DocsContent.scrollToHeading` ([DocsContent.ts:426-443](packages/docs/src/shell/DocsContent.ts#L426-L443)), kept local to this class per *Non-Goals* (no shared extraction).
   - Build `this._controls` as a `FloatingPanel({ corner: "bottom-right", layoutManager: new VBox({ spacing: 4 }) })` holding the width-narrower/wider, zoom-out/in, and reset buttons from *Viewer-property control presets*, wired to step `_widthIndex`/`_zoomIndex` and call `this._markdown.setMaxMeasure`/`setFontScale` as specified there. Add it the same way as the minimap.
   - Add a private `ListenerBag<"activeheadingchange">` field and the matching `on`/`off`/`emit` overloads (same shape as `DocsContent`'s, step 8). Add a private `_lastActiveHeadingId: string | null = null` field. Wire `Event.addSubtreeListener(this, "scroll", this.handleNativeScroll)` in the constructor; `handleNativeScroll` computes `findActiveHeading(this.getScrollElement()!, this._headings)` and calls `this.emit("activeheadingchange", id)` only when it differs from `_lastActiveHeadingId`, updating the field first.
   - `setMarkdown(markdown: string): this` — calls `this._markdown.setMarkdown(markdown)`, recomputes `this._headings`, and calls `this._minimap.setHeadings(this._headings)`, keeping the minimap in sync with content changed after construction.
   - `setMinimapVisible`/`isMinimapVisible`, `setControlsVisible`/`isControlsVisible` — mirror `DiagramView.setControlsVisible`/`isControlsVisible`'s exact shape ([DiagramView.ts:1779-1784](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1779-L1784)), toggling `this._minimap`/`this._controls`'s own `setVisible`.
   Verify: unit tests below.

7. **`packages/lib/src/typescript/lib/component/display/index.ts`** — now that both new files exist, export `findActiveHeading`, `MarkdownMinimap`, `MarkdownMinimapOptions`, `MarkdownMinimapEvent`, `HeadingScrollSource`, `MarkdownViewer`, `MarkdownViewerOptions`, mirroring the existing `Markdown` export block (lines 15-17).
   Verify: `grep -n "MarkdownViewer" packages/lib/src/typescript/lib/component/display/index.ts` shows the export; typecheck passes.

8. **`packages/docs/src/shell/DocsContent.ts`** — add a private `_headings: MarkdownHeading[] = []` field, set at the top of `emitOutline` ([DocsContent.ts:227-232](packages/docs/src/shell/DocsContent.ts#L227-L232)) before the `emit` call. Widen `_listeners: ListenerBag<"outlinechange">` to `ListenerBag<"outlinechange" | "activeheadingchange">`. Add the `on`/`off`/`emit` overloads for `"activeheadingchange"` (mirroring the existing `"outlinechange"` overloads at lines 106-134, the same multi-overload shape `DiagramView.on` already uses at [DiagramView.ts:1284-1290](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1284-L1290)). Add `Event.addSubtreeListener(this, "scroll", this.handleNativeScroll)` in the constructor, alongside the existing `'click'` subtree listener (line 94). Add a private `_lastActiveHeadingId: string | null = null` field and a `handleNativeScroll` method computing `findActiveHeading(this.getScrollElement()!, this._headings)` (imported from `@jimka/typescript-ui/component/display`) and emitting `"activeheadingchange"` only when the id changed.
   Verify: new tests in step 11.

9. **`packages/docs/src/shell/DocsShell.ts`** — remove the `_minimap` `Placement.EAST` region ([DocsShell.ts:60-65, 76](packages/docs/src/shell/DocsShell.ts#L60-L76)) and the `DocsMinimap` import. Change the `_minimap` field's declared type from `DocsMinimap` to `MarkdownMinimap` ([DocsShell.ts:35](packages/docs/src/shell/DocsShell.ts#L35)). Wrap `this._content` in a new `Component({ layoutManager: new Anchor() })` added at `Placement.CENTER` in place of `this._content` directly; inside it, add `this._content` first (`AnchorConstraints` with `left: 0, right: 0, top: 0, bottom: 0` — full stretch), then `this._minimap = new MarkdownMinimap({ scrollSource: this._content, corner: "top-right" })` (import from `@jimka/typescript-ui/component/display`) — drop the old construction's `backgroundColor`/`border` options entirely; `MarkdownMinimap` supplies its own floating-card chrome — added via `this._minimap.getAnchorConstraints()`. Keep the existing `this._content.on('outlinechange', this.handleOutlineChange)` wiring unchanged. Add `this._minimap.on('select', this.handleMinimapSelect)` where `handleMinimapSelect(id: string): void { this._router.navigate(this._router.getPath() + '#' + id); }` — the exact logic `DocsMinimap.handleRowClick` had ([DocsMinimap.ts:97-99](packages/docs/src/shell/DocsMinimap.ts#L97-L99)).
   Verify: `grep -rn "DocsMinimap" packages/docs/src` returns zero matches outside the deleted files.

10. **Delete `packages/docs/src/shell/DocsMinimap.ts`** and **`packages/docs/tests/DocsMinimap.test.ts`** — fully superseded by `MarkdownMinimap`.

11. **New tests**:
    - `packages/lib/tests/component/container/FloatingPanel.test.ts` — corner→`AnchorConstraints` mapping for all four corners; `setCorner`/`setMargin` mutate the same constraints object in place; default insets are zero.
    - `packages/lib/tests/component/display/Markdown.test.ts` — add cases for `setMaxMeasure`/`getMaxMeasure` (string, number, `null` reverting to the theme var) and `setFontScale`/`getFontScale`; add cases for `findActiveHeading` per the worked example in *Internal Structure*.
    - `packages/lib/tests/component/display/MarkdownMinimap.test.ts` — tree-building from the worked example (including the skipped-level and hidden-heading-climb cases); `"select"` fires with the clicked heading's id; `activeheadingchange` from a `scrollSource` selects the resolved node; disposing removes the `scrollSource` listener.
    - `packages/lib/tests/component/display/MarkdownViewer.test.ts` — minimap and controls are present by default and hidden via `setMinimapVisible(false)`/`setControlsVisible(false)`; width/zoom buttons step `_widthIndex`/`_zoomIndex` and call `Markdown.setMaxMeasure`/`setFontScale` with the clamped preset values (including the at-bounds no-op case); reset clears both overrides to `null`/`1` rather than re-applying the default preset; clicking a minimap row scrolls to that heading; `setMarkdown` refreshes the minimap's headings.
    - `packages/docs/tests/DocsContent.test.ts` — append cases: `activeheadingchange` fires with the topmost visible heading id as the pane scrolls; it does not re-fire when the computed id is unchanged.
    Verify: `npm test` in `packages/lib` and in `packages/docs`, both green.

12. **Documentation** — per *Documentation Impact* below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/container/FloatingPanel.ts` |
| Create | `packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` |
| Create | `packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts` |
| Create | `packages/lib/tests/component/container/FloatingPanel.test.ts` |
| Create | `packages/lib/tests/component/display/MarkdownMinimap.test.ts` |
| Create | `packages/lib/tests/component/display/MarkdownViewer.test.ts` |
| Create | `packages/lib/docs/components/FloatingPanel.md` |
| Create | `packages/lib/docs/components/MarkdownMinimap.md` |
| Create | `packages/lib/docs/components/MarkdownViewer.md` |
| Create | `packages/docs/src/demos/markdownviewer-basic.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/index.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/tests/DocsContent.test.ts` |
| Modify | `packages/docs/src/content/pages.ts` (nav entries for the new doc pages) |
| Delete | `packages/docs/src/shell/DocsMinimap.ts` |
| Delete | `packages/docs/tests/DocsMinimap.test.ts` |

---

## Expected Behaviour

- **Corner mapping.** `FloatingPanel({ corner: "top-left", margin: 8 })` → `AnchorConstraints { top: 8, left: 8 }`; `"bottom-right"` → `{ bottom: 8, right: 8 }`; the other two corners follow the same pattern. Unit-testable.
- **`setCorner`/`setMargin` are idempotent no-ops on an unchanged value** (no `scheduleLayout()` call) — mirrors `Component.setBackgroundColor`'s guard. Unit-testable.
- **Tree-building drops out-of-depth headings entirely**, not just visually — per the worked example in *Internal Structure*, a depth-4 heading under `maxHeadingDepth: 3` has no row and no children of its own survive under it as orphans. Unit-testable.
- **A heading that skips a depth level nests under the nearest shallower ancestor still on the stack.** Unit-testable with an h1→h3 sequence.
- **An `activeheadingchange` landing on a hidden heading id highlights its nearest shown ancestor**, not nothing and not the wrong sibling. Unit-testable using the worked example's `"advanced-flags"` → `"install"` resolution.
- **`activeheadingchange(null)` is a no-op** — the previously selected row stays selected. Unit-testable.
- **`findActiveHeading` returns the last heading (document order) whose top is at or above the pane's own top**, and `null` when the pane's top is above every heading. Unit-testable per the worked example.
- **`activeheadingchange` fires only when the resolved id changes** between scroll ticks, even though the underlying native `"scroll"` event fires far more often. Unit-testable by dispatching multiple synthetic scroll events with the geometry unchanged and asserting the listener was called once.
- **`MarkdownMinimap.on("select", …)` fires with the clicked row's heading id** when a `Tree` row is clicked; unrelated `Tree` internals (expand/collapse carets) are not exposed. Unit-testable.
- **Disposing `MarkdownMinimap` removes its listener from `scrollSource`** — firing `activeheadingchange` on the (still-alive) source afterward does not throw and does not touch the disposed tree. Unit-testable.
- **`Markdown.setMaxMeasure(null)` reverts to the theme default** (`var(--ts-ui-md-max-measure, 70ch)`), not to a hardcoded `70ch` — a theme change after `setMaxMeasure(null)` still takes effect. Unit-testable by asserting the written CSS value is the var reference, not a resolved pixel/ch number.
- **`Markdown.setFontScale(1)` clears the inline `fontSize` override** (writes `null`) rather than writing `"100%"` — keeps the rendered style identical to never having called it. Unit-testable.
- **`MarkdownViewer`'s width/zoom buttons step `_widthIndex`/`_zoomIndex` through `WIDTH_PRESETS_CH`/`ZOOM_PRESETS`, clamped at the array bounds** (a fourth "wider" click past `90ch` re-applies `90ch` rather than erroring or going out of bounds) — per the worked example in *Viewer-property control presets*. Unit-testable.
- **`MarkdownViewer`'s reset button clears both overrides** (`setMaxMeasure(null)`, `setFontScale(1)`) and resets both indices to their default, rather than re-applying the default preset value — a live theme change after reset still takes effect, matching `setMaxMeasure(null)`'s own behaviour above. Unit-testable.
- **`MarkdownViewer.setMarkdown` refreshes the minimap** — headings recomputed from the new source are what `MarkdownMinimap` shows next, not the construction-time set. Unit-testable.
- **`MarkdownViewer`'s minimap and controls default to visible** and can each be hidden independently via `setMinimapVisible(false)` / `setControlsVisible(false)` without affecting the other. Unit-testable.
- **`DiagramView`'s controls cluster geometry and `insets` are unchanged** by the `FloatingPanel` refactor — the added regression test in step 3. Unit-testable.
- **Live scroll tracking in the browser** (the minimap's highlighted row follows the visible heading as a user scrolls the real page) needs manual verification — synthetic scroll events in a unit test can exercise `findActiveHeading` and the change-guarded emit, but the end-to-end native-scroll-to-highlighted-row loop through a real browser scrollbar is not exercisable by the existing jsdom-based test harness (see `DocsMinimap.test.ts`'s own comment on why it needs a real, connected DOM).
- **Visual placement (top-right minimap, bottom-right controls, over the prose, not beside it) and the minimap's frosted-card legibility over scrolled text** need manual verification via a running docs app / demo page.

---

## Verification

- `npm run typecheck` (or the project's equivalent) in `packages/lib` and `packages/docs` — zero errors.
- `npm test` in `packages/lib` — `FloatingPanel.test.ts`, `MarkdownMinimap.test.ts`, `MarkdownViewer.test.ts`, updated `Markdown.test.ts`, updated `DiagramView.test.ts` all green; no other suite regresses.
- `npm test` in `packages/docs` — updated `DocsContent.test.ts` green; `DocsMinimap.test.ts` removed, not merely skipped.
- `grep -rn "DocsMinimap" packages/docs/src packages/docs/tests` — zero matches.
- `grep -n "AnchorConstraints" packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — zero matches (import removed; `Anchor` import still present).
- `npm run docs:api` in `packages/lib` — zero warnings (per CODE_CONVENTIONS.md's `{@link}` rule, check every new public JSDoc only links other public symbols).
- Manual: run the docs app (`npm run docs:dev`), open a long page, confirm the minimap floats top-right over the prose, highlights the visible section while scrolling, and clicking a row navigates and scrolls correctly; confirm `DiagramView`'s zoom/fit/reset cluster is pixel-identical to before the refactor.
- Manual: exercise a `MarkdownViewer` demo, toggling width/zoom buttons and confirming the prose column and font scale change, and reset restores both.

---

## Documentation Impact

- `packages/lib/docs/components/FloatingPanel.md`, `MarkdownMinimap.md`, `MarkdownViewer.md` — new narrative pages, following the existing `DiagramView.md` / `Anchor.md` shape (short intro, `## Usage` code block, `<!-- demo: … -->` marker where applicable).
- `packages/lib/docs/components/Markdown.md` — add a short section documenting `setMaxMeasure` / `setFontScale`.
- `packages/lib/scripts/llms/manifest.data.mjs` — add `{ task: …, symbol: "FloatingPanel" }` under "Containers / Windows", and `{ task: …, symbol: "MarkdownMinimap" }` / `{ task: …, symbol: "MarkdownViewer" }` near the existing `Markdown` entry ([manifest.data.mjs](packages/lib/scripts/llms/manifest.data.mjs), mirroring the `{task, symbol}` shape at lines 47-49 / 106-109); regenerate `llms.txt` via its `npm run` script rather than hand-editing the generated file.
- `packages/docs/src/demos/markdownviewer-basic.ts` — new demo backing the `MarkdownViewer.md` (and, via the same marker id, `FloatingPanel.md`) live-demo block, per the `DemoModule` contract in `packages/docs/src/content/demos.ts`.
- `packages/docs/src/content/pages.ts` — add nav entries for the three new doc pages, alongside the existing `Markdown` / `DiagramView` entries.
- `DiagramView.md` needs **no** changes — its public API (`setControlsVisible`, `on(...)`, etc.) is unchanged by the refactor.
- No changes needed to `docs/concepts/sizing.md` or `docs/concepts/dom-seams.md` — nothing here changes a documented sizing rule or the DOM seam surface itself.

---

## Potential Challenges

- **`Markdown.setFontScale` relies on nested prose elements using relative (em/%) font sizing** so a root `font-size` scales everything proportionally. `HEADING_CLASS`'s own rule only sets `fontWeight` ([Markdown.ts:201-207](packages/lib/src/typescript/lib/component/display/Markdown.ts#L201-L207)), leaving heading size to the browser's UA default (which is em-relative) — a good sign, but confirm no other prose class rule (code, table, list) sets an absolute pixel font-size that would resist scaling; fix any that do as part of this step, not as a follow-up.
- **`FloatingPanel`'s corner math runs inside whatever insets its host carries** (a `Panel`'s default `4px`) — this is expected, existing `Anchor` behavior, not a bug, but double-check the visual margin (`corner margin + host insets`) reads correctly for `MarkdownViewer`'s own default insets.
- **Global heading-id uniqueness.** `findActiveHeading` and the existing `DocsContent.scrollToHeading` both assume every heading id on a page is unique via `document.getElementById`; a page with two independently-rendered `Markdown` blocks that happen to produce the same slug (each block's own `nextHeadingId` counter restarts at zero) could collide. This is a pre-existing property of `extractMarkdownHeadings`/`Markdown`'s id scheme, not introduced by this plan, and out of scope to fix here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — the precedent for the corner-pinning technique (`buildControls`, `setControlsVisible`, the `AnchorConstraints` block) that `FloatingPanel` formalizes and this file is refactored onto.
- [`packages/lib/src/typescript/lib/layout/Anchor.ts`](packages/lib/src/typescript/lib/layout/Anchor.ts) and [`AnchorConstraints.ts`](packages/lib/src/typescript/lib/layout/AnchorConstraints.ts) — the layout mechanism `FloatingPanel` wraps; read `resolveAxis` before touching corner math.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — `installScrollShadows`/`removeScrollShadows` (self-listening native `"scroll"` precedent) and `_defaultPanelOptions` (the `4px` insets regression trap for `FloatingPanel`/`DiagramView`).
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — the `Tree` construction and `on("selection", …)` → `router.navigate` pattern `MarkdownMinimap` and `DocsShell` mirror.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `scrollToHeading` (the geometry technique `findActiveHeading` inverts) and the existing `ListenerBag<"outlinechange">` shape being widened.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `MarkdownOptions`, the constructor's `maxWidth` write being replaced, and `MarkdownHeading`/`extractMarkdownHeadings`.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `setNodes`, `expandAll`, `selectNode`, `on("selection", …)`.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `onScrollerTick`/`renderWindowPass`'s changed-value emit guard, mirrored by the new `activeheadingchange` emit.

---

## Non-Goals

- **`DocsContent` does not become a `MarkdownViewer`.** Its multi-block, demo-interspersed composition is unrelated pre-existing structure; only its scroll-tracking surface is extended.
- **No width/zoom controls for the docs app.** `MarkdownViewer`'s viewer-property buttons are a `packages/lib` capability, not wired into `DocsShell` — the docs app has no stated need for them and DocsContent has no single `Markdown` instance for them to act on.
- **No fix for the pre-existing cross-block heading-id collision risk** (see *Potential Challenges*) — out of scope for this feature.
- **No shared extraction of `DocsContent.scrollToHeading`'s scroll-to logic.** `MarkdownViewer`'s own click-to-scroll handler duplicates the same small technique locally rather than refactoring existing, working, unrelated `DocsContent` code to share it.
- **No z-index changes anywhere.** Both floating panels rely on DOM paint order (added after the content they float over), matching `DiagramView`'s existing controls cluster; no `setZIndex` call is introduced.
- **No IntersectionObserver.** Scroll-tracking uses the existing `Event.addSubtreeListener(this, "scroll", …)` + geometry-read approach throughout; no new DOM-seam capability is added.

---

## Implementation Notes

- **`packages/lib/tests/dom/TestDOM.ts`** — not in the plan's Files table, but a fix here was required to make the plan's own `findActiveHeading` test (in `Markdown.test.ts`) and the `MarkdownViewer`/`DocsContent` scroll-tracking tests possible at all. `Markdown` renders every heading's `id` through a generic `DOM.sink.apply(heading, { addClass: [...], setAttr: { id } })` patch, not the dedicated `setId` sink call. The modelled `ModelledDOMSource.getElementById` only ever looked up ids indexed by that dedicated `setId` path, so `DOM.source.getElementById(headingId)` — which `findActiveHeading` depends on — returned `null` for every Markdown-rendered heading offline, even though the identical code resolves correctly in production (a real `getElementById` finds an id however it was set). Fixed by having `RecordingDOMSink.apply` also index a `setAttr.id` write, closing this pre-existing modelling gap. No production-code equivalent is needed: `ProductionDOMSink` just calls the real `setAttribute`, which `document.getElementById` already sees regardless of which sink method wrote it.

- **Follow-up round, after live use surfaced three problems with the shipped design**: (1) `MarkdownMinimap` needed to grow with its content and never show its own internal scrollbar — `Tree.getPreferredSize()` was changed from a hardcoded `{200,300}` default to computing height live from the flattened row count (falling back to an explicit `preferredSize` constraint when set), and `MarkdownMinimap` gained an "On this page" header row and a smaller (`0.85em`) row-label font via `Tree.setRendererFactory`/`LabelTreeNodeRenderer.getLabel()`. A height cap (`500px`) plus `autoScroll: "y"` was added as a fallback once a real outline (docs API pages routinely exceed 33 headings) proved the content-derived height needed a ceiling — set via class defaults (`_defaultMarkdownMinimapOptions`), not imperative setter calls, so a caller-supplied `maxSize`/`autoScroll` still wins. (2) `DocsShell`'s minimap stopped floating over `DocsContent` entirely — a docked, non-floating layout reads better for a page-navigation TOC than an overlay — so `DocsShell` docked it in a plain `HBox` beside `DocsContent`, and `DocsContent` gained a `getPreferredSize()` override capping its width to the resolved reading measure (`packages/docs/src/shell/proseWidth.ts`, `resolveProseMeasureWidth`, extracted as a shared helper from `DocsDemo`'s pre-existing identical probe) so the `HBox` naturally placed the minimap immediately after the text instead of at the pane's far edge. **Reverted after a second live trial**: docked-in-`HBox` was tried live and found worse than floating, so `DocsShell` went back to the original `Anchor`-managed floating composition — `DocsContent.getPreferredSize()` and `proseWidth`'s docs-side usage in that class were removed again, and `DocsContent` instead grew a `getTextColumnReference(): Component | null` accessor (returning its first block, re-read live rather than cached since {@link DocsContent.showBlocks} replaces `_blocks` wholesale on every navigation) for `DocsShell` to hug against via the `placeNextTo` mechanism design (3) below already built for `MarkdownViewer`. `DocsShell` gained the same `doLayout` override shape as `MarkdownViewer` (re-hugs after every layout pass) plus an `outlinechange`-triggered `Component.afterNextLayout` call, needed because `DocsContent.showBlocks`'s own `scheduleLayout()` re-lays-out only its own unchanged bounds and never bubbles a layout pass up to `DocsShell` — without that second hook, a page navigation would leave the hug stale against the outgoing (disposed) block. (3) `MarkdownViewer`'s minimap — the one consumer that *is* still floating and does still need to hug `Markdown`'s real rendered width (CSS `max-width`, not a JS layout constraint) — went through two designs: the first gave `MarkdownMinimap` a `textColumn` constructor option and a `doLayout` override that repositioned itself against its own parent's just-committed layout. An audit found this pattern had no precedent in the codebase (every other self-positioning component exposes an owner-called placement verb — `TabBar`'s strip placement, `Menu`'s anchored placement — not a child fighting its parent's layout from inside its own `doLayout`) plus several correctness bugs (a `null` text column left `X` as `NaN`; the corner-fallback math omitted the host's content-inset origin; the DOM-rect reads raced the framework's `commitBounds`/`setAutoCommitStyle` write-batching). Replaced with the current design: a public `MarkdownMinimap.placeNextTo(textColumn: Component | null): this` that `MarkdownViewer` calls from its own `doLayout` override (after `super.doLayout()`, once every sibling for that pass has flushed) and directly after `stepWidth`/`stepZoom`/`resetViewerProperties`, since `Markdown.setMaxMeasure`/`setFontScale` write a CSS rule and schedule no layout of their own.

- **Bug fix, after live use surfaced a double scrollbar plus a clipped header**: the `autoScroll: "y"` class default added above (for the height cap) turned out to be a mistake — `Tree` is already a virtualized, self-scrolling list (its own row pool plus scrollbar overlays), so marking the outer panel's own axis as overflowing too told `BoxLayout.computeShrink` (`layout/BoxLayout.ts`) to skip shrinking `Tree` to fit, leaving `Tree` laid out at its full uncapped content height (measured live at ~4872px on a heading-dense page) with both the outer panel and `Tree` then scrolling that same content independently — a genuine double scrollbar, confirmed live via `.PanelOverlayScroller`'s own scrollbar and `Tree`'s own scrollbar both `display:block` simultaneously. Fixed by dropping `autoScroll` from the class default entirely: without it, `computeShrink` correctly shrinks `Tree` down to whatever's left under the `500px` cap, and `Tree`'s own scrolling takes over from there — one scrollbar, not two. Separately, the header row's `padding: new Insets(8, 12, 4, 12)` had been passed directly to the header `Text`, but `Text.getPreferredSize()` (`component/input/Text.ts`) reports only raw font-metric measurements and never folds in its own CSS padding — the only such usage in the codebase; every other place pads a wrapping `Component` instead. VBox was allocating the header row just its bare line height, and the real CSS padding then clipped into that too-small box. Fixed by wrapping the header `Text` in a plain `Component` (`layoutManager: new Fit()`, carrying the padding) instead of padding the `Text` directly. Also bumped the panel's default preferred width from `Tree`'s generic content-agnostic `200px` to a `MarkdownMinimap`-specific `240px` (via a `getPreferredSize` override mirroring `Tree.ts`/`DocsContent.ts`'s own content-derived-height-with-explicit-override-escape pattern), since heading labels tend to run longer than a typical `Tree` row elsewhere in this codebase.

- **Bug fix: selection flicker/reselect race between click-driven selection and scroll-tracking**. Live testing surfaced two symptoms sharing one root cause in `Markdown.ts`'s `findActiveHeading` (called by both `MarkdownViewer.onNativeScroll` and `DocsContent.onNativeScroll`): (1) clicking a heading — especially a first leaf under a branch — would immediately flicker back to the heading just above it; (2) clicking the very last heading would scroll to the bottom but then reselect whatever heading was topmost, not the one clicked. Root-caused live: (1) `scrollToHeading`'s delta is computed from sub-pixel-precise `getBoundingClientRect()` reads, but the native `scrollTop` it's applied through rounds the requested value, landing the clicked heading a fraction of a pixel (measured: 0.4375px) past the pane's top — `findActiveHeading`'s strict `<=` comparison then fails and falls back to the previous heading. (2) a heading near the document's end can have less than a full viewport of content below it, so `scrollToHeading`'s naive uncapped delta computes a target scroll position past the container's max, which clamps — the clicked heading lands far short of the pane's top (measured: 1856px), and `findActiveHeading` (correctly, per its literal contract) resolves to whichever heading actually is topmost at the clamped position, which can be far earlier than the one clicked. Fixed both in the one shared function: a 1px tolerance on the top-crossing comparison (absorbs the rounding case), plus a special case that treats the last heading as active once `DOM.source.getScrollMetrics` reports the pane has scrolled to its maximum (handles the clamping case) — fixing both `MarkdownViewer` and `DocsContent`'s call sites at once. `packages/lib/tests/dom/TestDOM.ts` gained a `setScrollExtent` helper (mirroring the existing `setBorderInset` "explicit injected input" pattern) so the clamped-scroll case is genuinely testable offline, since the modelled DOM previously had no way to represent `scrollHeight > clientHeight` at all.

- **Feature + bug fix: long heading labels read as "rendered under the scrollbar."** Investigation (confirmed live via DOM measurement and source reading of `VirtualScroller.computeScrollbarVisibility`'s two-pass fixed-point reservation) found no actual pixel overlap — `Tree`'s scrollbar-gutter reservation is correct. The real issue: `Tree` deliberately grows every row to the widest label ever seen (`_maxContentWidth`) to support horizontal scrolling, and `LabelTreeNodeRenderer.layoutChildren` then always sized its label to that same natural width — so the label's own box was never narrower than its content, meaning `text-overflow: ellipsis` never had room to trigger, and a too-long label just hard-clipped flush against the scrollbar track with zero gap or "…" cue. Added a new `Tree` option, `rowOverflow: "scroll" | "clip"` (default `"scroll"`, preserving today's behaviour) — `"clip"` caps every row at the effective viewport width instead of growing to fit content, and `LabelTreeNodeRenderer.layoutChildren` now clamps its label to `Math.min(getContentWidth(), width)` (a no-op under `"scroll"`, since rows there are never narrower than their content). `MarkdownMinimap` opts into `rowOverflow: "clip"` — an outline is read, not scrolled sideways to see in full. While wiring this, found and fixed a genuine, separate, pre-existing `Text.ts` bug: `Text`'s `truncate` constructor option (needed to get the ellipsis CSS onto `LabelTreeNodeRenderer`'s label) was being silently clobbered back to its field-initializer default (`null`/unset) by `_textOverflow`'s and `_truncate`'s own class-field initializers, which run immediately after `super()`'s options cascade already dispatched `setTruncate` — the same construction-order hazard the adjacent `_fontSizeCSSVar` comment already documents, just not worked around for this field pair. An interim fix (`declare private` on both fields, erasing their post-`super()` write under `useDefineForClassFields`) closed the clobbering but left `isTruncate()`/`getTextOverflow()` as the only two Text getters backed by a dedicated field rather than `_options`/`_defaultOptions` — inconsistent with every sibling getter (`getTextAlign`, `getFontFamily`, etc.) in the same file, and flagged as such on review. Fixed at the root instead: dropped both fields entirely; `isTruncate()` and `getTextOverflow()` now resolve through `_options`/`_defaultOptions` like their siblings, and `textOverflow` was folded into `applyStyle`'s existing getter-driven CSS recompute (alongside `fontFamily`/`textAlign`/etc.) for the same reason those are there. `applyOptions`'s `setTruncate` dispatch stays unconditional (documented inline) — unlike every other option in that method, it can't be gated on an explicit value, because it also drives `whiteSpace`/`overflow`, and those two ride Component's own field-backed render-time phases (`applyMiscInlineStyles`/`applyOverflowStyles`), which have no truncate-aware default fallback the way getter-backed properties do.

---

## Notes

[^floatingpanel-scope]: An alternative considered was a wrapping "host" component that owns `Anchor` itself and exposes `setContent()` / `addOverlay()`. It was rejected because `DiagramView`'s existing content child (`_contentHost`) is deliberately *unconstrained* — it free-floats via a pan/zoom transform, not a stretch-to-fill placement — so a `setContent()` API that assumes full-bleed stretching would not fit `DiagramView`'s actual composition. Keeping `FloatingPanel` scoped to "just the overlay panel, plus the corner-to-`AnchorConstraints` math" lets each host keep placing its own main content however it already does.

[^diagram-no-regress]: `Anchor.resolveAxis` computes a child's extent as `size ?? preferred` regardless of whether the child is a plain `Component` or a `Panel`, and regardless of `Panel`'s own content-vs-explicit-minimum clamping rule (`Component.clampsToContentSize()`) — `Anchor` never asks a child to shrink below what this formula returns, so switching `_controls`' concrete class from `Component` to `FloatingPanel` (a `Panel` subclass) changes nothing about the *committed* size, only its default `insets`, which `FloatingPanel`'s own zero-inset default cancels back to today's behavior.

[^docscontent-shape]: `DocsContent.buildBlock` renders a `demo` block as a `DocsDemo`, not a `Markdown` — a page with even one inline demo has no single `Markdown` instance for a `MarkdownViewer` wrapper to own, and forcing that shape onto `DocsContent` would mean either flattening demos into `Markdown` (impossible, they're live components) or giving `MarkdownViewer` a multi-child content mode it has no other consumer for.

[^paint-order]: Every framework `Component` is `position: absolute` with no explicit `z-index` by default; a later sibling in DOM/tree order paints over an earlier one. `DiagramView` already relies on this (`_contentHost` added before `_controls`), so `MarkdownViewer` adds its `Markdown` child first and both floating panels after it, with no `setZIndex` call needed.

[^tree-bg-precedent]: Project memory already flags `AbstractSelectableList`'s (and so `Tree`'s) opaque default background as something that can mask an ancestor's intended background when nested inside another panel expecting to show through. The floating-minimap case is the inverse: the opacity is wanted, just on the *outer* `FloatingPanel` frame rather than duplicated on the inner `Tree` too.
