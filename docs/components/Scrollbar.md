# Scrollbar

[`Scrollbar`](/api/component/container/classes/Scrollbar) is a custom virtual scrollbar overlay for components that own their own scroll state and don't expose native browser scrolling. It's the visible UI half of [`VirtualScroller`](/components/VirtualScroller), but exposed as a standalone primitive so you can build your own scroll surface.

The owner pushes viewport / content metrics in via `setMetrics`, the bar renders a thumb sized to the viewport-to-content ratio, and user input on the thumb (drag) or track (tap to page) flows back out via a scroll listener.

Available in vertical (default) and horizontal orientations.

## Usage

The minimal contract: instantiate, position over your content area, push metrics whenever the scroll state changes, and subscribe to user-driven scroll changes.

```typescript
import { Scrollbar } from '@jimka/typescript-ui/component/container';
const bar = Scrollbar('vertical');
// Owner sizes and positions the track on the cross axis:
bar.setHeight(400);                 // track length on the scroll axis
bar.setX(container.getWidth() - 12);// place on the right edge

bar.addScrollListener((position) => {
    // user dragged the thumb or clicked the track — react here
    contentEl.scrollTop = position;
});

// When the scroll state changes (resize, programmatic scroll, data load, ...)
// push the new metrics:
bar.setMetrics(
    viewportHeight, // visible window in pixels along the scroll axis
    contentHeight,  // total scrollable content in pixels along the scroll axis
    scrollPosition, // current scroll offset in pixels
);
```

The scrollbar hides itself automatically when `contentSize <= viewportSize`.

## Horizontal orientation

```typescript
const bar = Scrollbar('horizontal');
bar.setWidth(800);                          // primary axis = width
bar.setY(container.getHeight() - 12);       // cross axis = bottom edge
bar.addScrollListener(x => contentEl.scrollLeft = x);
bar.setMetrics(viewportWidth, contentWidth, scrollX);
```

The track-width constant (12 px) is shared across orientations and exposed via `getTrackWidth()`.

## Common methods

| Method | Purpose |
| --- | --- |
| `setMetrics(viewport, content, position)` | Push the current scroll state; recomputes thumb size and position. |
| `addScrollListener(fn)` / `removeScrollListener(fn)` | Subscribe to user-driven scroll changes (`fn(position)`). |
| `getTrackWidth()` | The fixed cross-axis dimension in pixels (use it for owner-side layout reservation). |
| `getOrientation()` | `"vertical"` or `"horizontal"`. |
| `setArrowsEnabled(b)` / `isArrowsEnabled()` | Toggle end-cap arrow buttons (see below). |
| `setArrowStep(px)` / `getArrowStep()` | Per-click scroll step in pixels for the arrow buttons. |

## Behavior

- **Thumb drag** — mouse and touch supported; viewport-level listeners pick up the drag even when the pointer leaves the thumb.
- **Track click / tap** — pages the scroll position by one viewport along the scroll axis, in the direction of the click relative to the thumb.
- **Hover** — the thumb darkens on `mouseover`, restores on `mouseout`.
- **Auto-hide** — `setMetrics` toggles display based on whether content overflows the viewport.

## Arrow buttons

Optional classic OS-style arrow buttons at each end of the track. Disabled by default to preserve the minimalist look; opt in via the new [`ScrollbarOptions`](/api/component/container/interfaces/ScrollbarOptions) bag passed as the constructor's second argument:

```typescript
const bar = Scrollbar('vertical', { arrowsEnabled: true, arrowStep: 60 });
```

- **Step** — each click scrolls by `arrowStep` pixels (default `40`, roughly two rows at default font size).
- **Hold-repeat** — press and hold an arrow to fire ticks at an accelerating cadence (400 ms initial interval, ×0.75 per tick, floored at 40 ms — the same cadence as [`SpinButton`](/api/component/input/classes/SpinButton)).
- **Disabled at edges** — when scroll is already at the top / left, the start arrow dims to `--ts-ui-scrollbar-arrow-disabled-color` and ignores clicks; same for the end arrow at the bottom / right.
- **Track-length** — when arrows are on, the thumb travel range and the track-click paging hit-test exclude the two `getTrackWidth()`-sized arrow regions. `setMetrics` keeps the thumb sized against the inner track length, not the outer bar.
- **Runtime toggle** — `setArrowsEnabled(true|false)` is supported. The arrow components are built or torn down on the fly and `setMetrics` is re-run with the cached viewport / content / scroll-position triple so the thumb recomputes against the new track length.

## Theming

| CSS variable | Default |
| --- | --- |
| `--ts-ui-scrollbar-track`                 | `rgba(0, 0, 0, 0.04)` |
| `--ts-ui-scrollbar-thumb`                 | `rgba(0, 0, 0, 0.35)` |
| `--ts-ui-scrollbar-thumb-hover`           | `rgba(0, 0, 0, 0.55)` |
| `--ts-ui-scrollbar-arrow-bg`              | `transparent` |
| `--ts-ui-scrollbar-arrow-color`           | `rgba(0, 0, 0, 0.55)` |
| `--ts-ui-scrollbar-arrow-disabled-color`  | `rgba(0, 0, 0, 0.18)` |
| `--ts-ui-scrollbar-arrow-hover-bg`        | `rgba(0, 0, 0, 0.06)` |

The arrow tokens are wired via inline `var(..., fallback)` writes on the arrow elements, not through the [`Theme`](/api/core/interfaces/Theme) interface — same pattern as the existing track / thumb tokens.

## See also

- [API: Scrollbar](/api/component/container/classes/Scrollbar)
- [`VirtualScroller`](/components/VirtualScroller) — bundles two Scrollbars with rows-container transform and wheel / touch / momentum handlers
- The table [`Body`](/api/component/table/classes/Body) and [`Tree`](/components/Tree) — the in-tree consumers
