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

## Web Worker for sort and filter

[`AbstractStore`](/api/data/classes/AbstractStore) automatically offloads sort and filter operations to a Web Worker once the dataset crosses **1,000 rows**:

```typescript
store.sort('value', 'desc');               // worker handles it for >1k rows
store.filterBy(r => r.get('value') > 500); // worker handles it for >1k rows
```

You don't configure anything — the worker is created lazily on first use. Below the threshold the round-trip overhead exceeds the work, so operations run synchronously in-process.

::: warning Filter functions are serialised
Custom filter predicates passed to `filterBy` must be **pure functions** with no captured non-serialisable state. They are sent to the worker via structured clone. For richer filter logic, use [`FilterDescriptor`](/api/data/type-aliases/FilterDescriptor) — a serialisable AST that the framework's filter evaluator runs identically on both sides of the worker boundary.
:::

## Disposing Text components

[`Text`](/components/Text) and its subclasses ([`Label`](/components/Label), [`Header`](/components/Header), [`Legend`](/components/Legend)) subscribe to [`ThemeManager.onThemeChange`](/api/core/classes/ThemeManager) on construction so they re-measure on every theme change.

**Custom components that create `Text` instances dynamically and remove them must call `text.dispose()`** to detach the listener:

```typescript
class StatusBar extends Component {
    private message: Text = new Text('');

    constructor() {
        super('div');
        this.addComponent(this.message);
    }

    protected destructor() {
        this.message.dispose();  // detach theme listener
        super.destructor();
    }
}
```

Built-in components attached and removed through the normal `addComponent` / `removeComponent` flow have this handled for you. The leak only appears when you create a `Text` outside that flow.

## Avoiding layout thrash

A few patterns can defeat the rAF coalescing and force multiple layout passes per frame:

- **Reading `getSize()` between sets.** Every `getSize` call forces a flush so the read is up-to-date. If you write, read, write again, you've caused two layout passes. Batch your sets, then read once at the end.
- **Mutating during a layout callback.** Adding or removing components from inside `doLayout` (or a layout-triggered listener) re-enters the layout pass. The framework handles this safely, but the immediate call you triggered won't see the new children — they land on the next frame.
- **Missing `pauseLayout` for large bulk operations.** rAF coalescing helps, but for thousands of changes you'll also pay queue-management overhead. `pauseLayout` skips that.

## CSS rule generation cost

Each component creates one CSS rule for itself on construction (and a second for `:active` state on [`Button`](/components/Button), `.selected` on [`ToggleButton`](/components/ToggleButton), etc.). For a typical app with hundreds of components this is fine. For lists rendering thousands of items, prefer the virtual-scrolling components which reuse a fixed pool of rules.

If you find yourself building a custom virtual list, look at how the table [`Body`](/api/component/table/classes/Body) is implemented — it's the canonical reference. The scroll plumbing is reusable on its own via [`VirtualScroller`](/components/VirtualScroller).

## See also

- [Virtualized lists recipe](/recipes/virtualized-list)
- [Component lifecycle](/concepts/component-lifecycle) — `pauseLayout` / `resumeLayout` API
- [Layout system](/concepts/layout-system) — how `doLayout` actually runs
- [API: AbstractStore](/api/data/classes/AbstractStore) — store-level worker offload
