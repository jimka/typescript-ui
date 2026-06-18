# DOM seams (`DOMSink` / `DOMSource`)

Every DOM **write** in the framework funnels through one swappable interface, and every DOM **read** through another. The two seams live in [`core/DOM`](/api/core/variables/DOM) and are reached through a single global swap point, `DOM`:

- **`DOM.sink`** — the terminal write primitive. Structural mutations (`createElement`, `appendChild`, `addClass`, `setAttribute`, …), the inline-style flush from `StyleTarget`, native scroll-offset writes (`setScrollLeft`, `setScrollTop`), focus (`focus`, `blur`), and form-control state (`setValue`, `setSelectionRange`) all call `DOM.sink` instead of touching `element.style` / `element.classList` / `element.scrollLeft` / `element.focus()` / `element.value` directly.
- **`DOM.source`** — the read seam. Component geometry, text metrics, theme variables, environment constants, native scroll offsets and box-model sizes (`getScrollLeft`, `getScrollTop`, `getScrollMetrics`, `getOffsetSize`), connection state (`isConnected`), and form-control value (`getValue`) come from `DOM.source` rather than `getBoundingClientRect` / `getComputedStyle` / raw `element.scrollWidth` / `element.value`.

In production both seams are thin pass-throughs ([`ProductionDOMSink`](/api/core/classes/ProductionDOMSink), [`ProductionDOMSource`](/api/core/classes/ProductionDOMSource)) that behave bit-for-bit like the pre-seam direct calls. Tests swap in implementations that record writes and *model* reads, so component geometry and baselines can be asserted offline with no browser.

## Why two interfaces

Writes and reads have different shapes. Writes are fire-and-forget and already buffered by `StyleTarget`; reads are synchronous request/response that must return a value now. Keeping them separate lets a test sink be a pure recorder while a test source is an independent geometry model — and it matches a future worker transport, where writes post one-way but reads must round-trip.

## Swapping the seams

```typescript
import { DOM } from '@jimka/typescript-ui/core';

DOM.install({ sink: myRecordingSink, source: myModelledSource });
// … exercise code that reads/writes the DOM …
DOM.reset();   // restore the production implementations
```

`DOM` is a single mutable-property object — `DOM.sink` / `DOM.source` are the swappable state, mirroring how `ThemeManager` holds the active theme. Production code never calls `install`; it just reads `DOM.sink` / `DOM.source`.

## The read seam is keyed on `Component`

`DOMSource.getViewportRect(component)` takes the owning [`Component`](/api/core/classes/Component), not a raw element. The production source returns `component.getElement()!.getBoundingClientRect()`; a modelled source reproduces the same rectangle from committed layout state — a validated recurrence that walks `getParentComponent()` to the root, summing each level's border, position, translate, and scroll offset plus one injected root mount offset. Because the result is derived from cached state (`getX`, `getY`, `getBorderSize`, `getScrollLeft`, `getTranslateX`, …), it needs no browser layout.

The few reads that target a non-component node — anchor elements, ancestor scroll boxes — use the lower-level `getElementRect(element)` escape hatch instead.

The returned [`Rect`](/api/core/interfaces/Rect) is plain serialisable data (never a live `DOMRect`), with the `top` / `left` / `right` / `bottom` edges filled in so it drops straight into existing anchor-positioning call sites.

## Scroll, box-model, and form-control access is keyed on the element

Unlike `getViewportRect`, the scroll/box-model/value methods are **element-keyed**: they read live DOM facts that no model can derive from committed layout state — native scroll offset, scrollable overflow size, offset box, connection state, input value. They follow the `getElementRect(element)` precedent and take a raw element, so the production side stays a one-liner and a modelled source can answer from recorded or zeroed state. `getScrollMetrics(element)` returns all six scroll/overflow/viewport sizes as one plain [`ScrollMetrics`](/api/core/interfaces/ScrollMetrics) struct (mirroring how `Rect` boxes a `DOMRect`), so a caller that needs several of them — `Panel`'s scroll-shadow ramp reads all six — pays one round-trip, not six.

Scroll **writes** stay one-way: `setScrollLeft` posts the requested offset and never returns. The browser clamps it to the scrollable range, so the cache invariant is restored by a *separate* `getScrollLeft` read of the settled value — keeping the write worker-forwardable while the read-back stays a local source call.

Component-level focus rides the seam through the wrappers: `Component.focus()` / `Component.unfocus()` call `DOM.sink.focus` / `DOM.sink.blur`, so every `someComponent.focus()` call site is already routed without touching the element itself. Only a handful of raw-element focus sites (the dialog focus-trap, which focuses descendants found by `querySelectorAll`) call `DOM.sink.focus` directly.

## What it enables

- **Offline tests.** A modelled source answers geometry from the oracle and text metrics from a baked, font-pinned table, so layout and baseline behaviour can be unit-tested in Node/jsdom without real browser rendering.
- **A lint-checkable discipline.** Raw `getBoundingClientRect` / `getComputedStyle` / structural mutation outside the production implementations is now a grep-able (and eventually lint-able) violation.
- **A worker-ready boundary.** Every source method takes serialisable inputs and returns plain data; every sink method is one-way. The transport itself is out of scope, but the seam is shaped so it can be added without touching call sites.

## Documented production-only holdouts

A handful of reads are irreducibly browser-specific and stay outside the seam, each with an offline fallback:

- `Component.getBorderSize` reads element-specific computed border widths (with a pre-attach spec-string estimate offline).
- `Popover.collectScrollAncestors` reads ancestor `overflow` to find scroll containers.
- `FieldSet.legendClearance` measures the native `<legend>` box, short-circuiting to a fallback when `DOM.source.isModelled()` is true.
- `Util`'s own canvas / probe text-measurement code is the production leaf that `ProductionDOMSource` delegates to.

## Deliberately un-seamed

Some native DOM access is intentionally left outside the seam — these are boundary decisions, not oversights:

- **Event listeners.** `addEventListener` / `removeEventListener` stay raw. The framework's [`Event`](/api/core/classes/Event) class is already the listener abstraction; the remaining raw uses are low-level native hooks (`transitionend` in `Animation`, `matchMedia` in `Glyph`, ancestor `scroll` in `Popover` / `Tooltip`) that the seam would only obscure.
- **DOM traversal.** `querySelector` / `querySelectorAll` / `contains` / `closest` / `matches` / `parentElement` are read-only structural navigation, not measurement or mutation. They have no offline-test or worker payoff, so they stay direct — the dialog focus-trap finds its focusable descendants with `querySelectorAll` and then routes only the resulting `focus()` through the sink.
- **Imperative scroll-into-view.** `scrollIntoView` / `scrollTo` are native one-shot helpers outside the cached scroll model the seam mirrors.
