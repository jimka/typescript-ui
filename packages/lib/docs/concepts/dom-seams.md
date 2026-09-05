# DOM seams (`DOMSink` / `DOMSource`)

Every DOM **write** in the framework funnels through one swappable interface, and every DOM **read** through another. The two seams live in [`core/DOM`](/api/core/variables/DOM) and are reached through a single global swap point, `DOM`:

- **`DOM.sink`** — the terminal write primitive. A batched `apply(handle, patch)` carries every single-element mutation (style, classes, attributes, dataset, text, scroll offset) as one [`ElementPatch`](/api/core/interfaces/ElementPatch); structural and stateful ops (`createElement`, `appendChild`, `focus`, `setValue`, …) take a [`Handle`](/api/core/type-aliases/Handle). Nothing touches `element.style` / `element.classList` / `element.focus()` directly.
- **`DOM.source`** — the read seam. Component geometry, text metrics, theme variables, environment constants, scroll/box-model facts, and traversal all come from `DOM.source`; every method that once returned a live element now returns a `Handle`, and `intern` converts a raw browser node (an event target) into one.

In production both seams resolve handles against a registry and otherwise behave bit-for-bit like the pre-seam direct calls ([`ProductionDOMSink`](/api/core/classes/ProductionDOMSink), [`ProductionDOMSource`](/api/core/classes/ProductionDOMSource)). Tests swap in implementations that record writes and *model* reads, so component geometry and baselines can be asserted offline with no browser.

## Opaque handles — no element escapes the seam

The seam does not just funnel DOM *access*; it is the only module that ever *holds* a live `Element`/`Node`. Outside `core/DOM.ts` an element is named only by a [`Handle`](/api/core/type-aliases/Handle) — an opaque, serialisable branded `number`. A module-private registry maps each handle to its node (and, via a reverse `WeakMap`, each node back to its one canonical handle, so handle equality reproduces element equality — the focus-trap and event-target identity checks compare handles).

Two minting modes draw the leak-safety line:

- **`retain`** — for nodes the framework *creates* and owns (component roots, clip/content frames, glyph children, overlays). A strong registry entry. Each `Component` records the handles it creates via `trackHandle` and releases them two ways: **eagerly** in `destructor` for deterministic teardown (a `Dialog`/`Window` close), and **on garbage collection** of the `Component` itself, via a module-level `FinalizationRegistry`. The GC path is the load-bearing one: a component removed with `removeComponent` *detaches* but cannot release there (releasing would break `moveComponent`, which re-inserts the same instance) — so reachability is the move-vs-discard signal, and a discarded component's handles free when it is collected. This restores the pre-handle lifecycle where a node lived exactly as long as its `Component`. App-lifetime singletons (the glyph sprite, the theme `<style>`) are deliberately never released.
- **`intern`** — for nodes the *browser* supplies (event targets, `querySelector` results, the active element). A weak (`WeakRef`) entry behind a `FinalizationRegistry`, so interning can never leak even if the handle is never released.

Resolving a released or collected handle **throws**, turning a use-after-free into a loud failure rather than the silent no-op a stale element pointer would give.

`apply(handle, patch)` is the write primitive: one handle resolve performs every mutation in the patch, so a layout commit (width + height + classes + an attribute) costs one registry lookup, not one per write. The per-frame inline-style flush in `StyleTarget` batches its whole dirty bag into a single `apply`. Element attributes have the same batching shape behind `setAutoCommitAttributes`, off by default because attribute writes change behaviour and not only appearance. A fluent `edit(handle).style(…).addClass(…).commit()` builder is sugar for cold call sites.

## Why two interfaces

Writes and reads have different shapes. Writes are fire-and-forget and already buffered by `StyleTarget`; reads are synchronous request/response that must return a value now — `readClipboardText()` is the seam's one asynchronous read, because the `navigator.clipboard` API it wraps has no synchronous form. Keeping them separate lets a test sink be a pure recorder while a test source is an independent geometry model — and it matches a future worker transport, where writes post one-way but reads must round-trip.

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

The few reads that target a non-component node — anchor elements, ancestor scroll boxes — use the lower-level `getElementRect(handle)` escape hatch instead.

The returned [`Rect`](/api/core/interfaces/Rect) is plain serialisable data (never a live `DOMRect`), with the `top` / `left` / `right` / `bottom` edges filled in so it drops straight into existing anchor-positioning call sites.

## Scroll, box-model, and form-control access is keyed on a handle

Unlike `getViewportRect` (which takes the owning `Component`), the scroll/box-model/value methods are **handle-keyed**: they read live DOM facts that no model can derive from committed layout state — native scroll offset, scrollable overflow size, offset box, connection state, input value. They take a `Handle`, so the production side resolves it and stays a one-liner and a modelled source can answer from recorded or zeroed state. `getScrollMetrics(element)` returns all six scroll/overflow/viewport sizes as one plain [`ScrollMetrics`](/api/core/interfaces/ScrollMetrics) struct (mirroring how `Rect` boxes a `DOMRect`), so a caller that needs several of them — `Panel`'s scroll-shadow ramp reads all six — pays one round-trip, not six.

Scroll **writes** stay one-way: `setScrollLeft` posts the requested offset and never returns. The browser clamps it to the scrollable range, so the cache invariant is restored by a *separate* `getScrollLeft` read of the settled value — keeping the write worker-forwardable while the read-back stays a local source call.

Component-level focus rides the seam through the wrappers: `Component.focus()` / `Component.unfocus()` call `DOM.sink.focus` / `DOM.sink.blur`, so every `someComponent.focus()` call site is already routed without touching the element itself. Only a handful of raw-element focus sites (the dialog focus-trap, which focuses descendants found by `querySelectorAll`) call `DOM.sink.focus` directly.

## What it enables

- **Offline tests.** A modelled source answers geometry from the oracle and text metrics from a baked, font-pinned table, so layout and baseline behaviour can be unit-tested in Node/jsdom without real browser rendering.
- **A lint-enforced discipline.** A type-aware ESLint rule (`local/no-raw-dom`) fails the build on *any* raw DOM access — a member call on an `Element`/`Node`/`Document`/`Window`/`CSSStyleSheet`-typed receiver, or a free `document` / `window` / `getComputedStyle` / `matchMedia` global — *and* on *holding* a DOM element type: any `Element`/`Node`/`HTMLElement`/`SVGElement`/`DocumentFragment` annotation, field, or cast outside the seam is an error. A module may name an opaque `Handle`, never an element. The discipline is no longer a convention; it is CI.
- **A worker-ready boundary.** No live element crosses the seam in either direction — every input is a serialisable `Handle` or plain data, and every write is a serialisable `ElementPatch`. The transport itself is out of scope, but the seam is now fully `postMessage`-shaped without touching call sites.

## The seam is total — `core/DOM.ts` is the only module that touches the DOM

Every category that was once a holdout now funnels through the seam: computed border widths and overflow (`getBorderWidths` / `getComputedOverflow`), the `<legend>` box (`getOffsetSize` / `isConnected`), native event listeners (`addListener` / `removeListener` / `dispatchEvent`), DOM traversal (`querySelector` / `contains` / `closest` / `matches` / `getParentElement`), globals (`matchMedia` / `requestAnimationFrame` / `setTimeout` / `clearTimeout` / `getActiveElement` / `getDocumentSelection` / `getDocumentElement` / `getLocationHash` / `setLocationHash` / `replaceLocationHash` / `getLocationPathname` / `getLocationSearch` / `pushHistoryPath` / `replaceHistoryPath`), structural and form-control writes (`setId` / `insertBefore` / `setValue` / `setSelectionRange` / `setSelectedIndex`), and the irreducible text/scrollbar **measurement leaf** — the off-screen probe, the canvas font-metrics context, and the scrollbar-width probe — which now lives inside `ProductionDOMSource` itself.

The result: **`src/typescript/lib/core/DOM.ts` is the single module that reads, writes, or even *holds a reference to* the real DOM.** Everything else routes through `DOM.sink` / `DOM.source` and names elements only by `Handle`. The `local/no-raw-dom` rule enforces this with an empty baseline — any new raw access *or* element-typed declaration is a build error.

The one deliberate exception is `getViewportRect(component)`, which stays keyed on the `Component` (not a handle) because the offline geometry oracle reproduces the rectangle by walking `getParentComponent()` — a `Component` is a framework type, not a DOM type, so it does not breach the boundary. The rule-style path (`setRuleStyles` / `ensureStyleRule`) is also untouched: a `CSSStyleRule` is not an element and never carried a handle.

A few things stay deliberately outside the rule because they are **not DOM interaction**: raw `setTimeout` / `clearTimeout` (timers), `performance.now()` (high-resolution time), and Web Worker entry modules (`self` / `postMessage` are worker-scope messaging, not the document). `scrollIntoView` / `scrollTo` have no call sites today; the rule forbids any future one.

The sink nonetheless *offers* `setTimeout` / `clearTimeout` / `clearAllTimeouts`, for the one case where a timer is not merely a timer: a deferred callback that will write to an element. `Animation`'s transition fallbacks route through the seam so `DOM.reset()` can disarm whatever is still armed — a timer left running across a reset would resolve a handle minted against the previous registry and throw. Timers that touch no element keep their direct calls.
