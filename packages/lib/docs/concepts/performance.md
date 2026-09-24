# Performance

Most apps built on the framework run comfortably without performance work. This page covers the few cases that need attention and the levers the framework gives you when they come up.

## Layout coalescing

Setters call an internal `scheduleLayout()` rather than running `doLayout()` synchronously. The queue flushes once per animation frame; multiple changes within the same frame coalesce into one layout pass. Components whose ancestor is also scheduled get pruned because the ancestor's pass will recurse into them.

In practice this means you can call `setPreferredSize` on hundreds of components in a tight loop and pay for one layout pass, not hundreds.

## Diagnostics overlay

[`DiagnosticsOverlay`](/components/DiagnosticsOverlay) opens a floating window with live browser-level numbers (FPS, JS heap, DOM node count, long tasks) beside framework-internal ones (live `Component` count, layout passes and flush time, listener registrations, stylesheet rule count):

```typescript
import { DiagnosticsOverlay } from '@jimka/typescript-ui/diagnostics';

DiagnosticsOverlay.open();
```

The two numbers most worth watching for a suspected regression: **layout passes per second**, for a relayout loop (a setter that unconditionally schedules layout on every pass); and **stylesheet rules**, for a rule leak (a component held outside the tree whose per-instance rule never gets disposed). It ships as its own subpath, so an app that never imports `@jimka/typescript-ui/diagnostics` bundles none of the overlay UI — see the component page for the full row-by-row breakdown and browser-support caveats.

## pauseLayout / resumeLayout

For bulk mutations that span multiple frames or need explicit grouping:

```typescript
panel.pauseLayout();
for (const item of largeArray) {
    panel.addComponent(buildItem(item));
}
panel.resumeLayout(); // single doLayout pass at the end
```

`pauseLayout()` blocks the rAF queue from running on this component (and its subtree). `resumeLayout()` runs a synchronous `doLayout()` and re-enables scheduling.

Use this when:

- You're mutating dozens or hundreds of components in one logical operation.
- You want to guarantee a single layout pass without relying on rAF coalescing.

## Outline resizing

Dragging a [`Split`](/layouts/Split) gutter, a resizable [`Accordion`](/layouts/Accordion) gutter or a window edge lays out again on every frame: the whole subtree beside the gutter re-measures and re-places, which on the QA shells costs 25–60 ms per frame against a 9–17 ms idle frame. The content reflowing under the pointer is the point of that cost, but it is a cost, and a pane hosting a code editor or a wide table pays it a hundred times over one drag.

`resizeMode: 'outline'` trades the reflow for one composited write per frame: the drag moves a thin, pre-promoted outline to where the edge will land, and the layout runs once, on release.

```typescript
await Body.init({ layoutManager: Fit(), resizeMode: 'outline' });   // app-wide
const split = Split({ orientation: 'horizontal', resizeMode: 'outline' });   // or per owner
```

Nothing is paused while the drag runs — the real layout simply is not written — so no component's [`pauseLayout`](#pauselayout-resumelayout) flag changes and no widget sees `isLayoutPaused()` flip. What it does not cover: table column resize, which stays live; a window moved by its header, which already only translates; and the OS window frame under Tauri, which is not the library's drag.

## Virtual scrolling

[`Table`](/components/Table) and [`Tree`](/components/Tree) both render only the rows visible in the viewport plus a small buffer. The mechanics:

- A fixed pool of table [`Row`](/api/component/table/classes/Row) (or tree row) components.
- Scrolling is JS-owned via a [`VirtualScroller`](/components/VirtualScroller): the rows live inside a container whose `translate3d` transform exposes the requested viewport, and two custom [`Scrollbar`](/components/Scrollbar) overlays drive `scrollX` / `scrollY`. Wheel, touch (with 2D fling momentum), and keyboard navigation all funnel through the same `setScrollY` / `setScrollX` entry points.
- Pool slots are rebound to new data only when needed, not on every scroll tick: a `Table` row calls `setData()` when its pool slot's data index changes — DOM nodes stay in place and only their bound data shifts. A `Tree` slot follows its node across an expand/collapse instead of following a shifted flat position, so a row that is still on screen keeps its DOM element and pays only a reposition; the row calls `setRowData()` only when what it was last bound to (its node, depth, expanded/loading state, and a few other tracked values) has actually changed.

This gives constant memory and constant frame time regardless of dataset size. A 100,000-row table has the same performance characteristics as a 100-row table for the rows currently on screen.

See the [Virtualized lists recipe](/recipes/virtualized-list) for an end-to-end example.

## Inactive tab and card pages leave the render tree

[`Tab`](/layouts/Tab) and [`Card`](/layouts/Card) undisplay (`display: none`) the pages they aren't currently showing, rather than merely hiding them (`visibility: hidden`) — an inactive page's subtree drops out of the render tree entirely, so the browser has nothing to style or lay out for it on every resize or reflow around the visible page. Native scroll positions are captured before the flip and restored once the page is shown again.

One consequence for consumers: a `display: none` subtree reports every live geometry read (bounding rect, scroll metrics) as zero. Code that needs a page's actual size or scroll position must select that page first — reading it while its tab or card slot isn't the active one returns zeroes, not the last real value.

## Collapsed panes and regions leave the render tree

[`Split`](/layouts/Split) and [`Border`](/layouts/Border) do the same for a collapsed pane or edge region, one level down: once the collapse animation settles, the pane's or region's *direct children* are undisplayed, while the pane or region itself — its full-size box, clipped away behind the collapse strip — and the collapse/expand animation stay exactly as before. The children come back synchronously before an expand animation starts, and their native scroll positions are restored once it settles. The split's or border's own size reports keep the collapsed pane or region at the size it reported the instant before its content left, so nothing around it re-flows.

The animation itself only re-lays out what moves. A pane or region whose box ends where it started — the collapsing one, which keeps its full size and only clips, and any neighbour the freed space does not reach — is laid out once for the end state and left alone for the rest of the animation.

A pane or region that is a general `Component` with a box layout manager — rather than a `Container` — keeps its box too: the manager suspends the component's content-derived size clamp while its children are out, since a childless box manager would otherwise report a bare-perimeter maximum and clamp every box write away. And because the content leaves the render tree, keyboard focus inside it is dropped when the collapse settles — a clip-path alone never blurred it — exactly as for an inactive `Tab` page.

Two consequences follow. While a pane or region stays collapsed, the split or border owns the displayed state of the direct children it took out — it never runs the pane's or region's own layout manager itself in the meantime, and a child something else puts back (that manager running a layout of its own included) is taken out again on the split's or border's next idle layout — and it puts back exactly those on expand: a child you had undisplayed yourself *before* the collapse (a `Card`'s inactive page, say) stays undisplayed across the round trip. And a pane or region removed from its manager while collapsed keeps its children undisplayed — re-home it by calling `setDisplayed(true)` on them yourself, as with a page removed from a `Tab` or `Card`. The one exception is the manager itself going away: when a `Split` or `Border` is detached from its container (a manager swap, or the container's disposal during a `restoreLayout`), it puts back every recorded child it still owns or that was parked with no owner, so no content is stranded by a tear-down it cannot see the end of.

## Motion writes the element's inline style

[`Component.setTranslate`](/api/core/classes/Component#settranslate) and [`Component.setTransform`](/api/core/classes/Component#settransform) write the element's inline `transform` — one value, the translate first — never a stylesheet rule, like `setX` / `setY`, [`setOpacity`](/api/core/classes/Component#setopacity) and [`setWillChange`](/api/core/classes/Component#setwillchange). Drive per-frame or per-event motion through them. A setter that writes the component's stylesheet rule instead, such as a colour, a border or a cursor, makes WebKitGTK restyle the whole document on every call, even when nothing else changed.

## Compositor-layer hints

Elements that animate via `translate3d` (table rows during scroll, the header during horizontal scroll, windows during drag) are promoted to their own compositor layer the first time the browser sees the transform actually change. That first frame pays a layer-creation cost the next frames don't — visible as a brief "settle" tick at the start of motion.

[`Component.setWillChange`](/api/core/classes/Component#setwillchange) pre-creates the layer by writing `will-change: transform` (or any other CSS `will-change` value). The framework calls it automatically:

- **Window drag** — set on `mousedown`, cleared on `mouseup`. The first dragged frame is layer-ready.
- **Virtual table / tree rows** — set when a row joins the pool, cleared when it leaves. Pool size is bounded by the visible window plus buffer, so the hint count stays well under the browser threshold.
- **Table header** — set once for the Table's lifetime, since the header is always the scroll-mirror target.
- **Resize outline** — set when an outline drag starts; the outline is removed when it ends.

Custom code that drives its own continuous motion can use the same setter:

```typescript
panel.setWillChange("transform");   // before motion starts
// ... setTranslate calls ...
panel.setWillChange(null);          // when motion ends, to release the layer
```

The hint costs GPU memory and is ignored by browsers past a per-page threshold (~50–100 elements), so set it only over the active-motion lifetime and clear it promptly. For permanent scroll targets (one or two per page) it can be left set for the component's lifetime.

## Web Worker for sort and filter

[`AbstractStore`](/api/data/classes/AbstractStore) automatically offloads sort and filter operations to a Web Worker once the dataset crosses **1,000 rows**:

```typescript
store.sort('value', 'desc');               // worker handles it for >1k rows
store.filterBy({ type: 'gt', field: 'value', value: 500 }); // worker handles it for >1k rows
```

You don't configure anything — the worker is created lazily on first use, and its code ships inside the library's own bundle, so nothing is fetched to start it. Below the threshold the round-trip overhead exceeds the work, so operations run synchronously in-process.

The offload also fails safe. Where no worker can be started at all, every store sorts and filters on the main thread, exactly as it does below the threshold — but the two ways that can happen behave differently. An engine without `Worker` reaches that state silently, on every attempt, since rediscovering the answer costs nothing. A Content-Security-Policy that forbids both `blob:` and `data:` workers is discovered once, on the first store that crosses the threshold: it is warned about once, through `console.warn` naming the browser's own refusal, and never retried, since the refusal belongs to the document and cannot change while the page lives. A worker that does start and then proves dead — its script fails to run, a reply cannot be decoded, or it answers nothing for a whole deadline while a reply is owed — is retired for the rest of the page with a `console.warn` naming the reason, and every store falls back the same way. That deadline grows with the dataset: five seconds plus a further allowance for every thousand records the worker is holding, so a genuinely long sort of a very large store is not mistaken for a dead script. Falling back costs main-thread time on a large dataset, and it gains correctness: the in-process path applies every active sorter, where the worker protocol carries only the primary one. Nothing else is emitted — by the time application code could react, the view is already built and correct.

Nothing you write ever runs inside the worker. Filters cross the boundary as [`FilterDescriptor`](/api/data/type-aliases/FilterDescriptor) values — a serialisable AST that the framework's filter evaluator runs identically on both sides — and a sorter carrying a comparator function of your own keeps its store on the main thread instead.

## Disposing Text components

[`Text`](/components/Text) and its subclasses ([`Label`](/components/Label), [`Legend`](/components/Legend)) register themselves in the framework's measurement registry on construction, and release that entry in `destructor()`.

**A `Text` added as a registered child needs no explicit cleanup** — its owner's own teardown recurses into every registered child and releases each one's theme subscription automatically:

```typescript
class StatusBar extends Component {
    private message: Text = Text('');

    constructor() {
        super('div');
        this.addComponent(this.message);
    }
}
```

**A `Text` held only in a field — never passed to `addComponent` — is unreachable by that recursion**, so its owner must dispose it explicitly. Do this from a `protected destructor()` override, not `dispose()`: `destructor()` is the hook that always runs, including when an ancestor's teardown recurses into this component, while `dispose()` only runs when something calls it directly.

```typescript
class StatusBar extends Component {
    private tooltip: Text = Text('');  // never added as a child

    protected destructor(): void {
        this.tooltip.dispose();  // detach theme listener
        super.destructor();
    }
}
```

## Avoiding layout thrash

A few patterns can defeat the rAF coalescing and force multiple layout passes per frame:

- **Reading `getSize()` between sets.** Every `getSize` call forces a flush so the read is up-to-date. If you write, read, write again, you've caused two layout passes. Batch your sets, then read once at the end.
- **Mutating during a layout callback.** Adding or removing components from inside `doLayout` (or a layout-triggered listener) re-enters the layout pass. The framework handles this safely, but the immediate call you triggered won't see the new children — they land on the next frame.
- **Missing `pauseLayout` for large bulk operations.** rAF coalescing helps, but for thousands of changes you'll also pay queue-management overhead. `pauseLayout` skips that.
- **A style or layout read landing after a stylesheet-rule write, in the same task.** This makes every later rule write in that task dramatically more expensive — roughly proportional to the number of rules on the shared sheet — regardless of which kind of read it is (`getComputedStyle`, `getBoundingClientRect`, `offsetWidth`, `scrollLeft`, …). A render pass that writes many rules and also reads geometry mid-pass pays this on every write after the first read. Batch reads ahead of the frame's first rule write, or serve them from a cache keyed on the read's inputs, so a repeated read never lands mid-write.
- **A text measurement through the DOM probe costs a forced layout.** The framework measures a single line of text in a font a canvas reproduces without any layout — on a canvas, under the font the page resolves, checked against the probe once per font — and serves a repeated measurement from a cache, so [`Text`](/components/Text), [`Util.measureTextWidth`](/api/core/namespaces/Util/functions/measureTextWidth) and [`Util.measureTextWidths`](/api/core/namespaces/Util/functions/measureTextWidths) cost no layout in the common case. A wrap width, text with leading, trailing or repeated whitespace, and a font the canvas cannot reproduce still use the probe; the framework batches every stale `Text` into one probe call, and a consumer measuring several of those strings itself should use one [`DOMSource.measureTexts`](/api/core/interfaces/DOMSource) call rather than a `measureText` loop. `<body>` typography the canvas cannot reproduce — `letter-spacing`, `text-rendering: optimizeLegibility`, font features — keeps every measurement on the probe. The cache is cleared on every theme change and every settled font load; after changing typography outside `ThemeManager` — a `:root` variable, `<body>` letter-spacing, an app's own font load — call [`Util.invalidateTextMetricsCache()`](/api/core/namespaces/Util/functions/invalidateTextMetricsCache).

## Deferring expensive panel construction

When a [`Tab`](/layouts/Tab) layout has more than a handful of panels, building all of them up-front delays first paint for content the user may never visit. [`Tab.addLazyTab`](/api/layout/classes/Tab) registers a tab button immediately and runs the panel factory only on first activation:

```typescript
layout.addLazyTab(() => new HeavyPanel(), 'Heavy');
```

Subsequent activations reuse the cached instance, so scroll position and form state are preserved. See [Tab » Lazy panel construction](/layouts/Tab#lazy-panel-construction) for details.

The same yield-and-fade lifecycle is available for floating windows whose content is expensive to build via [`Window.setContentFactory`](/api/overlay/classes/Window): the window opens immediately with a spinner in its content area, the factory runs after a two-rAF yield, and the built tree fades in over the spinner.

```typescript
const win = Window('Heavy');
win.setSize({ width: 800, height: 600 });
win.setContentFactory(() => new HeavyContent());
win.show();
```

`setContentFactory` accepts an optional second argument that fires after the built component has been attached, laid out, and faded in — use it for work that must happen against a rendered subtree, such as kicking off an async data load whose loading spinner is rendered by the content itself:

```typescript
win.setContentFactory(
    () => TablePanel(store),
    () => void store.load()
);
win.show();
```

Running `store.load()` before the callback would emit `loadingchange: true` before `TablePanel` had subscribed (and before the table had a size for its overlay spinner to mount against). The `onReady` callback is the supported hook for any "after content is on screen" side effect.

Both code paths share [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize), which composes the spinner mount, two-rAF yield, factory invocation, and cross-fade in one call.

## CSS rule generation cost

Each component creates one CSS rule for itself the first time it renders. Construction itself is JS-only — no stylesheet inserts, no forced layout, no `document.body` probes — so building a detached subtree before attaching it to the live document is cheap and predictable. The rule materialises during the first `render()` pass (typically driven by `Component.addComponent` or `Window.show`). [`Button`](/components/Button) (`.pressed`), [`ToggleButton`](/components/ToggleButton) (`.selected`), and similar pseudo-state classes add a second rule each on top of that. For a typical app with hundreds of components this is fine. For lists rendering thousands of items, prefer the virtual-scrolling components which reuse a fixed pool of rules.

**A table's row pool is fixed size; the cells inside a row are not.** Sliding the column window rebuilds a cell — and its stylesheet rule — whenever the column entering the window doesn't share a type with the column that just left in the same row. A wide table with several column types crosses this on most single-column scroll steps, since neighbouring columns often differ. The freed cell's rule is deleted immediately, so nothing about this carries over between passes: scrolling across the same column range twice costs the same both times. If you need scrolling that stays cheap across many distinct column types, the lever is fewer type transitions between adjacent columns, not repetition — the framework has no per-column cache to warm.

If you find yourself building a custom virtual list, look at how the table [`Body`](/api/component/table/classes/Body) is implemented — it's the canonical reference. The scroll plumbing is reusable on its own via [`VirtualScroller`](/components/VirtualScroller).

## See also

- [Virtualized lists recipe](/recipes/virtualized-list)
- [Component lifecycle](/concepts/component-lifecycle) — `pauseLayout` / `resumeLayout` API
- [Layout system](/concepts/layout-system) — how `doLayout` actually runs
- [API: AbstractStore](/api/data/classes/AbstractStore) — store-level worker offload
