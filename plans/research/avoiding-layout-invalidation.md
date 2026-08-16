# Avoiding Layout Invalidation with Manual Layout

A reference for cases where your own code owns layout and the browser should do as little geometry work as possible.

---

## Background: `top`/`left` vs `transform`

| | `top` / `left` | `transform` / `translate` |
|---|---|---|
| Pipeline stage | Layout → Paint → Composite | Composite only |
| Can run off main thread | No | Yes |
| Requires positioning | Yes (`relative`/`absolute`/`fixed`/`sticky`) | No |
| Percentage resolves against | Containing block | Element's own border box |
| Reflected in `offsetTop`/`offsetLeft` | Yes | No |
| Reflected in `getBoundingClientRect()` | Yes | Yes |

`transform` side effects to keep in mind:

- Creates a stacking context (changes `z-index` behaviour).
- Becomes the containing block for `position: fixed` descendants.
- May trigger a compositing layer — occasionally causes text antialiasing shifts.

**Absolute coordinates via transform.** There is no transform variant that takes container-absolute coordinates. Pin the element to the origin so translate values become absolute:

```css
.node {
  position: absolute;
  top: 0;
  left: 0;
  translate: 120px 340px;
}
```

---

## 1. Separate reads from writes

Layout invalidation alone is cheap — the browser marks nodes dirty and recalculates once before paint. The real cost is **forced synchronous layout**: writing a style and then reading geometry in the same frame.

Reads that force a flush: `getBoundingClientRect()`, `offsetWidth`/`offsetHeight`/`offsetTop`/`offsetLeft`, `clientWidth`/`clientHeight`, `scrollTop`/`scrollLeft`/`scrollWidth`, `getComputedStyle()`, `focus()`, `getClientRects()`.

```js
function frame() {
  // READ
  const measurements = nodes.map(n => n.el.getBoundingClientRect());

  // COMPUTE — pure JS, no DOM access
  const positions = layout(measurements);

  // WRITE — no reads after this point
  for (const [el, p] of positions) {
    el.style.translate = `${p.x}px ${p.y}px`;
  }
}
```

Better still with manual layout: keep your own geometry model as the source of truth and read from the DOM only when content-derived sizes actually change.

## 2. Apply `contain` to every node

The single most effective CSS lever. `contain: layout` stops a dirty subtree from propagating upward. `contain: size` means the element's size is independent of its contents, so internal changes can't invalidate anything outside.

```css
.node {
  position: absolute;
  top: 0; left: 0;
  width: 200px; height: 120px;
  contain: strict;              /* layout + size + paint + style */
  translate: var(--x) var(--y);
}
```

Use `contain: layout size` instead of `strict` if contents need to overflow visibly.

## 3. Use the individual transform properties

`translate`, `rotate`, and `scale` are standalone CSS properties. They avoid string concatenation, let you change position without clobbering rotation, and are equally compositor-friendly.

## 4. Explicit pixel sizes — no `auto`, no percentages

Percentages and `auto` create dependency edges between a node, its ancestors, and its contents. Since you compute layout yourself, hand the browser final px values so there is nothing left to resolve.

## 5. `content-visibility: auto` for offscreen nodes

```css
.node {
  content-visibility: auto;
  contain-intrinsic-size: 200px 120px;
}
```

Skips both layout and paint for anything not near the viewport. `contain-intrinsic-size` supplies a placeholder so nothing shifts when the node comes back into view. Effectively virtualization without unmounting.

## 6. Get measurements from observers, not reads

`ResizeObserver` and `IntersectionObserver` deliver geometry asynchronously without forcing a synchronous layout. If content-driven sizing is the only reason you'd call `getBoundingClientRect()`, feed a `ResizeObserver` into your model instead.

`ResizeObserver` callbacks fire after layout but before paint, so writes there are fine — just avoid feedback loops.

## 7. Hand animation to the compositor

```js
el.animate(
  [{ translate: '0 0' }, { translate: '400px 0' }],
  { duration: 300, easing: 'ease-out', fill: 'forwards' }
);
```

Web Animations API with `transform`/`opacity` keyframes runs off the main thread entirely.

## 8. Mutate detached, insert once

Build new nodes into a `DocumentFragment` and insert in a single operation. When removing, detach the subtree root rather than iterating children.

## 9. Use `will-change` sparingly

It removes layer-promotion cost, but every layer consumes GPU memory and too many cost more than they save. Apply on interaction start, remove on end — don't leave it on hundreds of nodes.

---

## Caveats

- **`contain: size` and scrolling.** A size-contained element contributes its declared size to scrollable overflow, not its content's. If you rely on the browser sizing a scroll container, add an explicit spacer sized to your computed content bounds.
- **Layer count.** Compositing is not free. Excessive layer promotion trades layout cost for GPU memory pressure and raster cost.
- **`transform` and fixed descendants.** Any transformed ancestor breaks `position: fixed` on its descendants.

---

## Verifying it works

- **Chrome DevTools → Performance.** "Forced reflow" warnings come with stack traces pointing straight at read-after-write bugs.
- **Flame chart.** Look for multiple purple *Layout* blocks inside a single frame; there should be at most one.
- **Layers panel.** Check that layer count is what you expect, not several hundred.
- **Production canary.** `PerformanceObserver` on `longtask` entries.
