# VirtualScroller

[`VirtualScroller`](/api/component/container/classes/VirtualScroller) is the shared scroll machinery for transform-based virtual lists. It is what the table's [`Body`](/api/component/table/classes/Body) and [`Tree`](/components/Tree) compose internally; you can compose it directly if you are building your own virtual-scroll surface.

It owns four things on behalf of the owner component:

1. A **rows container** `<div>` whose `translate3d` transform exposes the requested viewport.
2. A **vertical** [`Scrollbar`](/components/Scrollbar) overlay on the right edge.
3. A **horizontal** Scrollbar overlay along the bottom edge.
4. **Wheel** and **touch** handlers (with 2-axis fling momentum) that drive `setScrollX` / `setScrollY` and trigger an owner-supplied `onScroll` callback.

The owner sets `overflow:hidden` on its element so the browser doesn't try to scroll natively, then constructs a VirtualScroller from its `init()`.

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VirtualScroller } from '@jimka/typescript-ui/component/container';
class MyList extends Component {
    private scroller: VirtualScroller | null = null;
    // ... pool, geometry, data ...

    constructor() {
        super();
        this.setOverflow("hidden");
    }

    protected init(element?: HTMLElement): void {
        super.init(element);
        const el = element || this.getElement();
        if (!el) return;

        this.scroller = new VirtualScroller(this, el, () => this.renderWindow());

        this.renderWindow();
    }

    private renderWindow(): void {
        if (!this.scroller) return;
        const scroller = this.scroller;

        const contentH = this.totalRows * ROW_HEIGHT;
        const contentW = /* row width */ 0;

        // 1. Loose-clamp scroll positions against the new content sizes
        //    before reading them for the window calc.
        scroller.clampToContent(contentW, contentH);

        const scrollY = scroller.getScrollY();
        const firstRow = Math.floor(scrollY / ROW_HEIGHT);
        // ... compute window, grow pool inside scroller.getRowsContainer(),
        //     bind rows, position rows via translateY(dataIndex * ROW_HEIGHT) ...

        // 2. Tight-clamp + position the scrollbars.
        scroller.layoutScrollbars(contentW, contentH);
    }
}
```

## API

| Method | Purpose |
| --- | --- |
| `getRowsContainer()` | The `<div>` to append pool rows into. |
| `getScrollX()` / `getScrollY()` | Current scroll positions. |
| `setScrollX(x)` / `setScrollY(y)` | Clamp against last-known content size, update transform, fire `onScroll`. |
| `clampToContent(w, h)` | Loose clamp using full viewports. Call at the start of `renderWindow`. |
| `layoutScrollbars(w, h)` | Tight clamp using effective viewports (cross-axis scrollbar reservation), then position scrollbars + push metrics. Call at the end of `renderWindow`. |

## Behavior

- **Wheel** — `deltaY` → vertical scroll, `deltaX` → horizontal scroll. `shift+wheel` without explicit `deltaX` is converted to horizontal.
- **Touch drag** — 1:1 finger movement updates both axes simultaneously.
- **Fling momentum** — on release, velocity is sampled from the last ~80 ms of touchmoves and decayed at `0.95` per frame; each axis stops independently when it falls below threshold or hits a scroll boundary. A finger pause longer than 50 ms before release suppresses momentum.
- **Cross-axis reservation** — when both scrollbars are visible, each shortens its primary-axis length by the other's track width so they don't overlap in the bottom-right corner.

## When to use this

Reach for `VirtualScroller` when you're building a custom virtual list that:

- Has a known fixed row height (or row positions you can compute from a data index).
- Maintains a row pool.
- Wants the same scroll UX as `Table` and `Tree`.

If your component is "a static list of N items," prefer a standard layout container — virtual scrolling is overkill below ~1k rows. See [Virtual scrolling](/concepts/performance#virtual-scrolling).

## See also

- [API: VirtualScroller](/api/component/container/classes/VirtualScroller)
- [`Scrollbar`](/components/Scrollbar) — the visible scrollbar primitive used inside
- The table [`Body`](/api/component/table/classes/Body) and [`Tree`](/components/Tree) — the in-tree consumers
- [Virtualized lists recipe](/recipes/virtualized-list)
- [Performance › Virtual scrolling](/concepts/performance#virtual-scrolling)
