# Performance

Most apps built on the framework run comfortably without performance work. This page covers the few cases that need attention and the levers the framework gives you when they come up.

## Layout coalescing

Setters call an internal `scheduleLayout()` rather than running `doLayout()` synchronously. The queue flushes once per animation frame; multiple changes within the same frame coalesce into one layout pass. Components whose ancestor is also scheduled get pruned because the ancestor's pass will recurse into them.

In practice this means you can call `setPreferredSize` on hundreds of components in a tight loop and pay for one layout pass, not hundreds.

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

## Virtual scrolling

[`Table`](/components/Table) and [`Tree`](/components/Tree) both render only the rows visible in the viewport plus a small buffer. The mechanics:

- A fixed pool of table [`Row`](/api/component/table/classes/Row) (or tree row) components.
- Scrolling is JS-owned via a [`VirtualScroller`](/components/VirtualScroller): the rows live inside a container whose `translate3d` transform exposes the requested viewport, and two custom [`Scrollbar`](/components/Scrollbar) overlays drive `scrollX` / `scrollY`. Wheel, touch (with 2D fling momentum), and keyboard navigation all funnel through the same `setScrollY` / `setScrollX` entry points.
- Pool slots are rebound to new data via `setData()` only when their data index changes — DOM nodes stay in place and only their bound data shifts.

This gives constant memory and constant frame time regardless of dataset size. A 100,000-row table has the same performance characteristics as a 100-row table for the rows currently on screen.

See the [Virtualized lists recipe](/recipes/virtualized-list) for an end-to-end example.

## Compositor-layer hints

Elements that animate via `translate3d` (table rows during scroll, the header during horizontal scroll, windows during drag) are promoted to their own compositor layer the first time the browser sees the transform actually change. That first frame pays a layer-creation cost the next frames don't — visible as a brief "settle" tick at the start of motion.

[`Component.setWillChange`](/api/core/classes/Component#setwillchange) pre-creates the layer by writing `will-change: transform` (or any other CSS `will-change` value). The framework calls it automatically:

- **Window drag** — set on `mousedown`, cleared on `mouseup`. The first dragged frame is layer-ready.
- **Virtual table / tree rows** — set when a row joins the pool, cleared when it leaves. Pool size is bounded by the visible window plus buffer, so the hint count stays well under the browser threshold.
- **Table header** — set once for the Table's lifetime, since the header is always the scroll-mirror target.

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

You don't configure anything — the worker is created lazily on first use. Below the threshold the round-trip overhead exceeds the work, so operations run synchronously in-process.

::: warning Filter functions are serialised
Custom filter predicates passed to `filterBy` must be **pure functions** with no captured non-serialisable state. They are sent to the worker via structured clone. For richer filter logic, use [`FilterDescriptor`](/api/data/type-aliases/FilterDescriptor) — a serialisable AST that the framework's filter evaluator runs identically on both sides of the worker boundary.
:::

## Disposing Text components

[`Text`](/components/Text) and its subclasses ([`Label`](/components/Label), [`Legend`](/components/Legend)) subscribe to [`ThemeManager.onThemeChange`](/api/core/classes/ThemeManager) on construction so they re-measure on every theme change.

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

Each component creates one CSS rule for itself the first time it renders. Construction itself is JS-only — no stylesheet inserts, no forced layout, no `document.body` probes — so building a detached subtree before attaching it to the live document is cheap and predictable. The rule materialises during the first `render()` pass (typically driven by `Component.addComponent` or `Window.show`). [`Button`](/components/Button) (`:active`), [`ToggleButton`](/components/ToggleButton) (`.selected`), and similar pseudo-state classes add a second rule each on top of that. For a typical app with hundreds of components this is fine. For lists rendering thousands of items, prefer the virtual-scrolling components which reuse a fixed pool of rules.

**A table's row pool is fixed size; the cells inside a row are not.** Sliding the column window rebuilds a cell — and its stylesheet rule — whenever the column entering the window doesn't share a type with the column that just left in the same row. A wide table with several column types crosses this on most single-column scroll steps, since neighbouring columns often differ. The freed cell's rule is deleted immediately, so nothing about this carries over between passes: scrolling across the same column range twice costs the same both times. If you need scrolling that stays cheap across many distinct column types, the lever is fewer type transitions between adjacent columns, not repetition — the framework has no per-column cache to warm.

If you find yourself building a custom virtual list, look at how the table [`Body`](/api/component/table/classes/Body) is implemented — it's the canonical reference. The scroll plumbing is reusable on its own via [`VirtualScroller`](/components/VirtualScroller).

## See also

- [Virtualized lists recipe](/recipes/virtualized-list)
- [Component lifecycle](/concepts/component-lifecycle) — `pauseLayout` / `resumeLayout` API
- [Layout system](/concepts/layout-system) — how `doLayout` actually runs
- [API: AbstractStore](/api/data/classes/AbstractStore) — store-level worker offload
