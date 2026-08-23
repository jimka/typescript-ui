# Debug & Diagnostics Overlay — Implementation Plan

## Overview

A developer building an app on this library gets no way to see, at runtime, how many components are alive, how much layout work each frame costs, or whether stylesheet rules are piling up. This plan adds one: a floating **Diagnostics** window a developer opens with `DiagnosticsOverlay.open()`, showing live browser-level numbers (FPS, JS heap, DOM node count, long tasks) beside framework-internal ones (live `Component` count, layout passes and flush time, active listener registrations, per-instance stylesheet rules).

The framework numbers are the point. Every one of them corresponds to a leak class this codebase has actually shipped and fixed — a `Window` close that left its whole tree, DOM and CSS behind; per-instance rules surviving a component held in a field and appended with a raw `appendChild`; a setter that called `scheduleLayout()` on every layout pass and pinned the CPU. Those bugs were each found by hand. The overlay turns them into a number that visibly climbs.

Instrumentation is added at five existing seams: `Component`'s constructor and [`destructor`](packages/lib/src/typescript/lib/core/Component.ts#L882), [`doLayout`](packages/lib/src/typescript/lib/core/Component.ts#L6454), the module-level [`flushPendingLayouts`](packages/lib/src/typescript/lib/core/Component.ts#L187), and [`ListenerBag.add`/`remove`](packages/lib/src/typescript/lib/core/ListenerBag.ts#L32). Two further numbers are read straight off registries that already exist — [`Event`'s three listener maps](packages/lib/src/typescript/lib/core/Event.ts#L175) and [`StyleTarget`'s `_ruleCache`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L188) — with no instrumentation at all. The overlay UI itself ships behind a new `@jimka/typescript-ui/diagnostics` subpath and is composed from `Window`, `Panel`, `LabeledGrid`, `Header` and `Text`.

---

## Architecture Decisions

### Derive where a live registry exists; push a counter only where none does

Each metric is sourced by one of two mechanisms, and which one applies is decided by a single question: does the framework already keep a live structure holding the thing being counted?[^derive-vs-push]

| Metric | Live registry already exists? | Mechanism |
|---|---|---|
| Stylesheet rules | yes — `_ruleCache` ([`StyleTarget.ts:188`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L188)) | derived: new `styleRuleCounts()` walks its keys |
| DOM-routed listeners | yes — `listenerMap` / `subtreeListenerMap` / `viewportListenerMap` ([`Event.ts:175`](packages/lib/src/typescript/lib/core/Event.ts#L175)) | derived: new `Event.listenerCounts()` sums bucket lengths |
| Live components | no | pushed: increment in `Component`'s constructor, decrement in `destructor()` |
| Semantic (`on`/`off`) listeners | no — each bag's `_buckets` is private and per-instance | pushed: increment/decrement in `ListenerBag.add`/`remove` |
| Layout passes, flush time | no | pushed: increment in `doLayout()`, timed pair in `flushPendingLayouts` |

A derived reading cannot drift from the thing it reports, so it is always preferred. A pushed counter is only introduced where deriving would mean building a new global registry — which is itself a leak risk, because a registry that holds components keeps them alive.

### Pushed counters live in one leaf module, `core/Diagnostics.ts`

`core/Diagnostics.ts` holds the pushed integer counters and the timing flag, and **imports nothing**. `Component.ts` and `ListenerBag.ts` import it and call into it; it never imports them back.[^leaf-module] The derived readers stay in the modules that own their registries (`Event.ts`, `StyleTarget.ts`), and the assembler that combines all six sources lives in `diagnostics/DiagnosticsSampler.ts`, a leaf nothing else imports.

### The overlay is a static-only singleton `Window`, mirroring `Tooltip`

`DiagnosticsOverlay` extends `Window`, has a private constructor, holds a `private static instance`, and is driven entirely through `open()` / `close()` / `toggle()` / `isOpen()`. This is `Tooltip`'s shape exactly — private constructor at [`Tooltip.ts:146`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L146), `private static instance` at [`Tooltip.ts:78`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L78), and the documented `callable()`-wrap exemption at [`Tooltip.ts:66`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L66) — including that exemption, since there is no public `new DiagnosticsOverlay()` surface to wrap.[^singleton-precedent]

### The overlay ships behind its own subpath export

The UI (`DiagnosticsOverlay`, `DiagnosticsSampler`) lives under `src/typescript/lib/diagnostics/` and is published as `@jimka/typescript-ui/diagnostics`. A consumer who never imports that specifier never bundles a byte of it.[^subpath-treeshake] The pushed counters in `core/Diagnostics.ts` do ship inside the always-loaded `core` chunk, because `Component` imports them. Shipping the counters everywhere is deliberate: it is what lets a developer open the overlay against a deployed production build and read real numbers, rather than only against a special build.

### Only the layout *timer* is gated; the counters always run

The four pushed counters are unconditional integer increments at seams the framework already runs. The two `performance.now()` calls that time a layout flush are gated behind `Diagnostics.isTimingEnabled()`, which `DiagnosticsSampler.start()` sets and `stop()` clears. With the overlay closed, the added cost per animation frame is one boolean read.[^gating]

### Layout time is measured once per flush, never per component

`flushPendingLayouts` takes exactly two timestamps — one before the dirty-component loop, one after the post-layout callbacks — for the whole frame's layout work. It never times individual `doLayout()` calls and never reads DOM geometry inside the measured region, so the measurement adds no forced style or layout recalculation to the pass it is measuring.[^timing-perturbation]

### DOM node counting goes through a new `DOMSource.countElements()`

`document` is a lint-flagged global under `local/no-raw-dom` ([`no-raw-dom.js:78`](packages/lib/scripts/eslint/no-raw-dom.js#L78)), scoped to `src/typescript/lib/**` with `core/DOM.ts` as the sole exemption ([`eslint.config.js:113`](packages/lib/eslint.config.js#L113)). So the node count gets a new `DOMSource` read method rather than a raw `document.querySelectorAll('*')` call. The existing `querySelectorAll(root, selector)` seam method is **not** reused: it returns `Handle[]`, so counting through it would intern every node in the document into the handle registry on every sample.[^count-elements]

`performance.memory` and `PerformanceObserver` are read directly, not through the seam. Neither is lint-flagged (`Performance` extends `EventTarget`, which the rule deliberately excludes), `performance.now()` is already called directly from `core/Animation.ts` and `core/SmoothScroller.ts`, and both APIs are feature-detected — which doubles as the offline story, since neither is usable under the node-environment test harness and the code takes its graceful-degradation path there with no stub needed.

### The overlay is composed from existing components, not new DOM

The window body is a `Panel` with `autoScroll: "y"` holding one [`LabeledGrid`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts#L76) — the chrome-less baseline-aligned title/field grid the library already provides — whose rows are a `Text` value per metric, split by two full-width `Header` rows ("Browser", "Framework"). No new `Component` subclass beyond `DiagnosticsOverlay` itself, and no bespoke CSS.[^ui-composition]

---

## Public API

### `core/Diagnostics.ts` — new, exported from `@jimka/typescript-ui/core`

```typescript
export interface DiagnosticsCounters {
    componentsConstructed: number;
    componentsDestroyed:   number;
    bagListenersAdded:     number;
    bagListenersRemoved:   number;
    layoutPasses:          number;
    layoutFlushes:         number;
    layoutFlushTotalMs:    number;
    layoutFlushMaxMs:      number;
}

export namespace Diagnostics {
    export function noteComponentConstructed(): void;
    export function noteComponentDestroyed(): void;
    export function noteBagListenerAdded(): void;
    export function noteBagListenerRemoved(): void;
    export function noteLayoutPass(): void;
    export function noteLayoutFlush(durationMs: number): void;

    export function isTimingEnabled(): boolean;
    /** Enabling also zeroes `layoutFlushes` / `layoutFlushTotalMs` / `layoutFlushMaxMs`. */
    export function setTimingEnabled(enabled: boolean): void;

    export function counters(): DiagnosticsCounters;

    /** @internal Test-only: zeroes every counter and clears the timing flag. */
    export function _reset(): void;
}
```

### `core/Event.ts` — added to the existing namespace

```typescript
export interface ListenerCounts {
    exact:    number;
    subtree:  number;
    viewport: number;
    total:    number;
}

export function listenerCounts(): ListenerCounts;
```

### `core/StyleTarget.ts` — new module-level export

```typescript
export interface StyleRuleCounts {
    instance: number;   // selectors starting `#`
    class:    number;   // selectors starting `.`
    other:    number;   // verbatim `scope: "selector"` rules
    total:    number;
}

export function styleRuleCounts(): StyleRuleCounts;
```

### `core/DOM.ts` — one new `DOMSource` member

```typescript
interface DOMSource {
    /** Total element count in the document. `0` when no selector engine is available. */
    countElements(): number;
}
```

### `diagnostics/DiagnosticsSampler.ts` — new

```typescript
export interface FrameworkCounts {
    components:            number;   // constructed − destroyed
    componentsConstructed: number;
    componentsDestroyed:   number;
    layoutPasses:          number;
    layoutFlushes:         number;
    layoutFlushTotalMs:    number;
    layoutFlushMaxMs:      number;
    domListeners:          Event.ListenerCounts;
    semanticListeners:     number;   // bagListenersAdded − bagListenersRemoved
    styleRules:            StyleRuleCounts;
}

/** Reads every framework counter once. No timing, no DOM reads — offline-safe. */
export function readFrameworkCounts(): FrameworkCounts;

export interface DiagnosticsSample {
    fps:                number;
    frameTimeMs:        number;
    frameTimeMaxMs:     number;
    heapUsedMB:         number | null;
    heapLimitMB:        number | null;
    domNodes:           number;
    longTasks:          number;   // cumulative since start()
    longTasksRecent:    number;   // within this sample window
    components:         number;
    componentsConstructed: number;
    componentsDestroyed:   number;
    layoutPassesPerSec: number;
    layoutFlushAvgMs:   number;
    layoutFlushMaxMs:   number;
    domListeners:       number;   // the `total` of Event.ListenerCounts, flattened
    semanticListeners:  number;
    styleRules:         StyleRuleCounts;
}

export interface DiagnosticsSamplerOptions {
    /** Sample window length in ms. Default `500`. */
    intervalMs?: number;
    onSample:    (sample: DiagnosticsSample) => void;
}

export class DiagnosticsSampler {
    constructor(options: DiagnosticsSamplerOptions);
    start(): void;      // idempotent; sets Diagnostics.setTimingEnabled(true)
    stop(): void;       // idempotent; clears the timing flag
    isRunning(): boolean;
}
```

`DiagnosticsSampler` is not a `Component`, so it is not `callable()`-wrapped.

### `diagnostics/DiagnosticsOverlay.ts` — new

```typescript
export class DiagnosticsOverlay extends Window {
    private constructor();

    static open(): void;
    static close(): void;
    static toggle(): void;
    static isOpen(): boolean;
}
```

---

## Internal Structure

### Selector bucketing in `styleRuleCounts()`

`_selectorOf` ([`StyleTarget.ts:193`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L193)) builds every cached selector, so the first character is a total classifier:

| Cached selector | Bucket | Why |
|---|---|---|
| `#a3f2` | instance | `scope: "component"` prepends `#` |
| `#a3f2.pressed` | instance | same, with a suffix appended |
| `.Button.pressed` | class | `scope: "class"` prepends `.` |
| `.Scrollbar::-webkit-scrollbar` | class | same, with a pseudo-element suffix |
| `:where(.ts-ui-component)` | other | `scope: "selector"` is verbatim |

```typescript
export function styleRuleCounts(): StyleRuleCounts {
    let instance = 0;
    let cls      = 0;
    let other    = 0;

    for (const selector of _ruleCache.keys()) {
        if      (selector.startsWith("#")) instance += 1;
        else if (selector.startsWith(".")) cls      += 1;
        else                               other    += 1;
    }

    return { instance, class: cls, other, total: instance + cls + other };
}
```

### The destroy guard on `Component`

`Component.destructor()` is documented idempotent and is genuinely called twice on some paths (an explicit `dispose()` on a child a parent later destroys). A bare decrement would double-count, so a new private `_destroyed` flag makes the decrement fire once. The flag changes no control flow — nothing early-returns on it, and the rest of `destructor()` still runs on every call exactly as it does today:

```typescript
// In destructor(), immediately after `pendingLayouts.delete(this);`
if (!this._destroyed) {
    this._destroyed = true;
    Diagnostics.noteComponentDestroyed();
}
```

`private _destroyed: boolean = false;` takes a plain initializer, not `declare`: no `applyOptions`-dispatched setter writes it, and `destructor()` never runs during the `super()` cascade.

### Flush timing in `flushPendingLayouts`

```typescript
function flushPendingLayouts() {
    rafHandle = null;

    if (isFirstLayoutHeld()) { /* unchanged early return */ }

    const timed   = Diagnostics.isTimingEnabled();
    const started = timed ? performance.now() : 0;

    // ... existing snapshot, dirty loop, and callback loop, unchanged ...

    if (timed) {
        Diagnostics.noteLayoutFlush(performance.now() - started);
    }
}
```

The font-gate early return stays above the timer, so a held first flush is not recorded as a zero-cost one.

### The sampler's frame loop

One `DOM.sink.requestAnimationFrame` chain does all the timing. Frame deltas come from the callback's own timestamp argument, so no extra clock read happens per frame. Every sample window the loop reads the framework counters, the DOM node count, and the heap, then calls `onSample`.

Bound-handler fields follow the existing idiom at [`Window.ts:54`](packages/lib/src/typescript/lib/overlay/Window.ts#L54) — a `private readonly _boundX` field wrapping a named method — so no inline closure is passed to `requestAnimationFrame` or to the `PerformanceObserver`.

Long-task detection is feature-gated on the entry type actually being supported:

```typescript
if (typeof PerformanceObserver !== "undefined"
    && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    this._observer = new PerformanceObserver(this._boundLongTasks);
    this._observer.observe({ entryTypes: ["longtask"] });
}
```

Heap reading degrades to `null` where `performance.memory` is absent (every non-Chromium browser, and the node test environment):

```typescript
const memory = (performance as unknown as {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
}).memory;
```

### The overlay's component tree

```
DiagnosticsOverlay (Window, header "Diagnostics", 320 × 460 at 24,24)
└─ Panel { autoScroll: "y", layoutManager: VBox({ stretching: true }) }   placement: CENTER
   └─ LabeledGrid { columns: 1 }
      ├─ full-width  Header("Browser")
      ├─ "FPS"                     → Text
      ├─ "Frame time"              → Text
      ├─ "JS heap"                 → Text
      ├─ "DOM nodes"               → Text
      ├─ "Long tasks"              → Text
      ├─ full-width  Header("Framework")
      ├─ "Components"              → Text
      ├─ "Constructed / disposed"  → Text
      ├─ "Layout passes"           → Text
      ├─ "Layout flush"            → Text
      ├─ "DOM listeners"           → Text
      ├─ "Semantic listeners"      → Text
      └─ "Stylesheet rules"        → Text
```

Each value `Text` is held in a private field and updated with `setText` from the `onSample` callback. Value formatting:

| Row | Sample value | Rendered |
|---|---|---|
| FPS | `59.4` | `59` |
| Frame time | avg `16.8`, max `31.2` | `16.8 ms (max 31.2)` |
| JS heap | `48.2` / `2048.0` | `48.2 / 2048.0 MB` |
| JS heap | `null` | `unavailable` |
| Long tasks | `12` cumulative, `1` recent | `12 (+1)` |
| Components | `1284` live | `1284` |
| Constructed / disposed | `9340` / `8056` | `9340 / 8056` |
| Layout passes | `142.0` per second | `142 /s` |
| Layout flush | avg `2.41`, max `9.13` | `2.41 ms (max 9.13)` |
| Stylesheet rules | `1210` instance, `192` class, `3` other | `1405 (1210 inst / 192 cls)` |

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/core/Diagnostics.ts`.** Module-level `let` counters plus a `let timingEnabled = false`, and the `Diagnostics` namespace from `## Public API`. `setTimingEnabled(true)` zeroes `layoutFlushes`, `layoutFlushTotalMs` and `layoutFlushMaxMs`; `setTimingEnabled(false)` leaves them. `noteLayoutFlush(ms)` increments `layoutFlushes`, adds to `layoutFlushTotalMs`, and raises `layoutFlushMaxMs` when `ms` exceeds it. `counters()` returns a fresh object. Mark `_reset` `@internal`. The file must import nothing — verify with `grep -c '^import' packages/lib/src/typescript/lib/core/Diagnostics.ts` — expect `0`.

2. **Export from `packages/lib/src/typescript/lib/core/index.ts`.** Add `export { Diagnostics } from '~/core/Diagnostics.js';` and `export type { DiagnosticsCounters } from '~/core/Diagnostics.js';`.

3. **Instrument `packages/lib/src/typescript/lib/core/Component.ts`.** Four edits:
   - Import `Diagnostics` from `~/core/Diagnostics.js`.
   - Add `private _destroyed: boolean = false;` beside the other lifecycle flags (near `_pendingRematerialize`, ~line 490).
   - Constructor ([:643](packages/lib/src/typescript/lib/core/Component.ts#L643)): append `Diagnostics.noteComponentConstructed();` as the **last** statement, after the `this.applyOptions(...)` dispatch.
   - `destructor()` ([:882](packages/lib/src/typescript/lib/core/Component.ts#L882)): insert the guarded decrement from `## Internal Structure` immediately after `pendingLayouts.delete(this);`.

4. **Count layout passes.** In `doLayout()` ([:6454](packages/lib/src/typescript/lib/core/Component.ts#L6454)), insert `Diagnostics.noteLayoutPass();` immediately after the `if (this.isLayoutPaused()) return this;` early return, so a paused component is not counted.

5. **Time layout flushes.** Edit `flushPendingLayouts` ([:187](packages/lib/src/typescript/lib/core/Component.ts#L187)) exactly as shown in `## Internal Structure`. Check: `grep -n 'performance.now' packages/lib/src/typescript/lib/core/Component.ts` — expect exactly two matches, both inside `flushPendingLayouts`.

6. **Instrument `packages/lib/src/typescript/lib/core/ListenerBag.ts`.** Import `Diagnostics`; call `Diagnostics.noteBagListenerAdded()` after `bucket.push(listener)` in `add` ([:32](packages/lib/src/typescript/lib/core/ListenerBag.ts#L32)); call `Diagnostics.noteBagListenerRemoved()` inside the `if (idx >= 0)` branch of `remove` ([:50](packages/lib/src/typescript/lib/core/ListenerBag.ts#L50)), after the `splice`. Do **not** count a duplicate `add` that the caller's own guard rejects — `ListenerBag.add` has no such guard today, so every `add` call counts.

7. **Add `Event.listenerCounts()`** to `packages/lib/src/typescript/lib/core/Event.ts`. Export the `ListenerCounts` interface inside the namespace. All three maps ([:175](packages/lib/src/typescript/lib/core/Event.ts#L175)) share one shape — `Map<type, Map<componentId, CompFunc>>` — so one private helper summing `compFunc.listeners.length` over a single map serves all three; `listenerCounts()` calls it once per map and adds the results into `total`.

8. **Add `styleRuleCounts()`** to `packages/lib/src/typescript/lib/core/StyleTarget.ts`, exactly as shown in `## Internal Structure`, placed beside the existing `_ruleCacheKeys` ([:242](packages/lib/src/typescript/lib/core/StyleTarget.ts#L242)). Export `StyleRuleCounts` and `styleRuleCounts` from `core/index.ts` alongside the existing `StyleTarget` exports (line 43-44).

9. **Add `countElements()` to the DOM seam.** Declare it on the `DOMSource` interface in `packages/lib/src/typescript/lib/core/DOM.ts` (beside `querySelectorAll`, [:1219](packages/lib/src/typescript/lib/core/DOM.ts#L1219)); implement in `ProductionDOMSource` ([:1949](packages/lib/src/typescript/lib/core/DOM.ts#L1949)) as `return document.querySelectorAll("*").length;`; implement in `ModelledDOMSource` (`packages/lib/tests/dom/TestDOM.ts`, [:875](packages/lib/tests/dom/TestDOM.ts#L875)) as `return 0;` with the same "no selector engine offline" comment its `querySelectorAll` stub ([:1189](packages/lib/tests/dom/TestDOM.ts#L1189)) carries. Check: `npm run typecheck:test` — a missing implementation is a compile error.

10. **Create `packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts`.** `readFrameworkCounts()` first (pure, offline-safe), then the `DiagnosticsSampler` class per `## Internal Structure`. `start()` is a no-op when already running; it sets `Diagnostics.setTimingEnabled(true)`, installs the long-task observer when supported, seeds the window start from the first frame, and begins the rAF chain. `stop()` is a no-op when not running; it cancels the pending frame via `DOM.sink.cancelAnimationFrame`, disconnects the observer, and calls `Diagnostics.setTimingEnabled(false)`. The first sample after `start()` computes `layoutPassesPerSec` against a zero baseline; that is correct, since `setTimingEnabled(true)` zeroed the flush aggregates.

11. **Create `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts`.** The private constructor calls `super("Diagnostics", { … })`, sets `setX(24) / setY(24) / setWidth(320) / setHeight(460)`, builds the tree from `## Internal Structure`, adds the body `Panel` with `{ placement: Placement.CENTER }` (importing `Placement` from `~/primitive/Placement.js`), and constructs its `DiagnosticsSampler` with `onSample` pointing at a named private method. Then, precisely:
    - `private teardown()` — idempotent: `this._sampler.stop()`, and `DiagnosticsOverlay.instance = null` when `instance === this`.
    - `static open()` — when `instance` is null, construct, assign `instance`, `show()`, `_sampler.start()`; then `instance.bringToFront()` either way.
    - `static close()` — when `instance` is non-null, capture it in a local, then call the local's `onExitAction()`.
    - `override onExitAction()` — `this.teardown()` **first**, then `super.onExitAction()`, so `isOpen()` is already `false` while the close animation runs.
    - `override destructor()` — `this.teardown()` (the safety net for a direct `dispose()` that bypassed `onExitAction`), then `super.destructor()`.
    - `static isOpen()` — `DiagnosticsOverlay.instance !== null`.
    - `static toggle()` — `isOpen() ? close() : open()`.

    Carry the `callable()`-exemption comment from [`Tooltip.ts:66`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L66), reworded for this class.

12. **Create `packages/lib/src/typescript/lib/diagnostics/index.ts`** exporting `DiagnosticsOverlay`, `DiagnosticsSampler`, `readFrameworkCounts`, and the `DiagnosticsSample` / `DiagnosticsSamplerOptions` / `FrameworkCounts` types.

13. **Register the subpath in all four resolution registries** (a directory subpath needs every one before it resolves):
    - `packages/lib/tsconfig.json` `paths`: `"@jimka/typescript-ui/diagnostics": ["./src/typescript/lib/diagnostics/index.ts"]` (after the `router` entry, line 19). `tsconfig.lib.json` and `tsconfig.test.json` both extend this file, so no further edit.
    - `packages/lib/vite.config.ts` alias list (after the `router` entry, line 27).
    - `packages/lib/vite.lib.config.ts`: both the alias list and the `build.lib.entry` map (`'diagnostics': r('diagnostics/index.ts')`).
    - `packages/lib/package.json` `exports`: a `"./diagnostics"` entry pointing at `./dist/lib/diagnostics.es.js` and `./dist/lib/types/diagnostics/index.d.ts`.

    Check: `npm run build:lib` produces `dist/lib/diagnostics.es.js`.

14. **Add the dev-app entry point.** In `packages/lib/src/typescript/MiscPanel.ts`, add a `Button("Show diagnostics overlay")` whose `"action"` listener calls `DiagnosticsOverlay.open()`, beside the existing window-opening buttons (~line 221). This is the manual-verification screen.

15. **Add `packages/lib/typedoc.json` entry point** `"src/typescript/lib/diagnostics/index.ts"` after the `router` entry.

16. **Write the tests** listed in `## Verification`.

17. **Documentation** per `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/Diagnostics.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsSampler.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts` |
| Create | `packages/lib/src/typescript/lib/diagnostics/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ListenerBag.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/tsconfig.json` |
| Modify | `packages/lib/vite.config.ts` |
| Modify | `packages/lib/vite.lib.config.ts` |
| Modify | `packages/lib/package.json` |
| Modify | `packages/lib/typedoc.json` |
| Create | `packages/lib/tests/core/Diagnostics.test.ts` |
| Create | `packages/lib/tests/diagnostics/DiagnosticsSampler.test.ts` |
| Create | `packages/lib/tests/diagnostics/DiagnosticsOverlay.test.ts` |
| Create | `packages/lib/docs/components/DiagnosticsOverlay.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated, not hand-edited) |
| Modify | `packages/docs/src/content/pages.ts` |

---

## Expected Behaviour

### Counters — unit-testable

1. **Construction counts once.** After `Diagnostics._reset()`, constructing three bare `Component`s leaves `counters().componentsConstructed === 3` and `componentsDestroyed === 0`.
2. **Disposal counts once, even when repeated.** `c.dispose(); c.dispose();` leaves `componentsDestroyed === 1`.
3. **Recursive disposal counts the whole subtree.** A parent with two children disposed once leaves `componentsDestroyed === 3`.
4. **A never-disposed component is not deducted.** Dropping a reference without calling `dispose()` leaves `componentsConstructed − componentsDestroyed` unchanged — the leak signal the overlay exists to show.
5. **Bag counters track add/remove.** Two `add` calls then one `remove` leave `bagListenersAdded === 2`, `bagListenersRemoved === 1`.
6. **A `remove` for a listener that was never registered counts nothing.** `bagListenersRemoved` stays `0`.
7. **`setTimingEnabled(true)` zeroes the flush aggregates, `setTimingEnabled(false)` does not.** After `noteLayoutFlush(4)`, calling `setTimingEnabled(false)` still reads `layoutFlushes === 1` and `layoutFlushTotalMs === 4`; a following `setTimingEnabled(true)` reads `0` for both. Neither call touches `componentsConstructed`, `componentsDestroyed`, `bagListeners*` or `layoutPasses`.
8. **`noteLayoutFlush` accumulates and tracks the maximum.** `noteLayoutFlush(2)` then `noteLayoutFlush(5)` then `noteLayoutFlush(3)` gives `layoutFlushes === 3`, `layoutFlushTotalMs === 10`, `layoutFlushMaxMs === 5`.
9. **`layoutPasses` rises with real layout passes** and does **not** rise for a component whose `pauseLayout()` is in effect.

### Derived readings — unit-testable

10. **`Event.listenerCounts()` rises on registration and falls on removal.** Registering one exact-target and one subtree listener gives `exact === 1`, `subtree === 1`, `total === 2`; removing both returns every field to `0`.
11. **Disposing a component clears its DOM listener registrations.** After `dispose()`, `listenerCounts().total` is back to its pre-registration value — `destructor()` already calls `Event.purgeComponent`.
12. **`styleRuleCounts()` buckets by selector shape** exactly as the table in `## Internal Structure` shows: a materialised `{ scope: "component", name: "x" }` rule lands in `instance`, `{ scope: "class", name: "Foo", suffix: ".pressed" }` in `class`, `{ scope: "selector", name: ":where(.ts-ui-component)" }` in `other`, and `total` is their sum.
13. **Disposing a rule removes it from the counts.** `rule.dispose()` drops `total` by one.
14. **`DOM.source.countElements()` returns `0` under the modelled source** and a positive integer under `ProductionDOMSource` with a real document (a `// @vitest-environment jsdom` test, mirroring `tests/dom/fonts-ready.test.ts`).

### Sampler — partly unit-testable

15. **`readFrameworkCounts()` is pure.** Calling it twice with nothing in between returns equal values, and calling it never changes any counter.
16. **`components` is the difference.** With `componentsConstructed === 10` and `componentsDestroyed === 4`, `readFrameworkCounts().components === 6`.
17. **`start()` / `stop()` are idempotent and flip the timing flag.** `start(); start();` leaves `isRunning() === true` and `Diagnostics.isTimingEnabled() === true`; `stop(); stop();` leaves both `false`.
18. **No sample is emitted before a full window elapses** — the offline `RecordingDOMSink.requestAnimationFrame` drops its callback, so `onSample` must never have fired after `start()` in an offline test.
19. **The frame loop itself is manual-verify only** (FPS, frame time, long tasks, heap, DOM node count all need a real browser).

### Overlay — unit-testable except the rendered readout

20. **`open()` is idempotent.** Two `open()` calls leave exactly one window in `AbstractWindow.getOpenWindows()` matching the overlay.
21. **`isOpen()` tracks the lifecycle.** `false` initially, `true` after `open()`, `false` immediately after `close()` — not only after the close animation finishes.
22. **`toggle()` alternates** between the two states.
23. **`close()` stops the sampler.** `Diagnostics.isTimingEnabled()` is `false` after `close()`.
24. **Open-then-close leaks no stylesheet rules.** Collecting the overlay's subtree ids before close, `_ruleCacheKeys()` afterward contains none of them — the same assertion shape as `tests/overlay/Notification.styleRuleDisposal.test.ts`.
25. **A direct `dispose()` on the instance also clears the static slot,** so a following `open()` builds a fresh window rather than reusing a destroyed one.
26. **The rendered numbers and their formatting are manual-verify** (see `## Verification`).

---

## Verification

- `npm --workspace packages/lib run typecheck` and `npm --workspace packages/lib run typecheck:test` — both clean.
- `npm --workspace packages/lib run lint` — clean. In particular no new `local/no-raw-dom` error: `grep -rn 'document\.' packages/lib/src/typescript/lib/diagnostics/` must return nothing.
- `npm --workspace packages/lib test` — the three new test files plus the existing suite green.
- `grep -c '^import' packages/lib/src/typescript/lib/core/Diagnostics.ts` — expect `0` (the leaf rule).
- `npm --workspace packages/lib run build:lib` — emits `dist/lib/diagnostics.es.js` and `dist/lib/types/diagnostics/index.d.ts`.
- `npm --workspace packages/lib run docs:api` — zero warnings.
- `npm --workspace packages/lib run docs:llms` — regenerates `llms.txt` with the new row; do not hand-edit that file.
- **Overhead check.** In the dev app's devtools console, run `bench.benchComponentInit(10000)` on `master` and on the branch. The per-component figure must not move outside its run-to-run spread. This is the concrete test of "no meaningful cost when the overlay is closed".
- **Manual smoke test** — dev app at `localhost:8015`, **Misc.** section, the new *Show diagnostics overlay* button:
  1. Every row shows a number within a second of opening; JS heap reads `unavailable` in Firefox and a figure in Chrome.
  2. Open the **Table** demo with a large store and scroll: *Layout passes* and *Frame time* both rise, *Layout flush* max climbs.
  3. Open and close a `Window` from the Misc. panel ten times: *Components*, *DOM listeners* and *Stylesheet rules* return to roughly their pre-open values rather than stepping up each cycle.
  4. Close the overlay and reopen it: the readouts resume, and *Layout flush* max has reset.
  5. Drag and resize the overlay window; it behaves like any other `Window`.

---

## Documentation Impact

- **Barrel / export surface.** `core/index.ts` gains `Diagnostics`, `DiagnosticsCounters`, `StyleRuleCounts`, `styleRuleCounts`; `Event.ListenerCounts` rides along with the existing `Event` export. The new `diagnostics/index.ts` is a new public entry point registered in `package.json`, `tsconfig.json`, both Vite configs, and `typedoc.json`.
- **New page** `packages/lib/docs/components/DiagnosticsOverlay.md`, following the shape of `docs/components/Tooltip.md` (a static-only singleton): what each row means, which leak class it catches, the browser-support caveats for heap and long tasks, and the `open()` / `close()` / `toggle()` surface. Register it in `packages/docs/src/content/pages.ts` in the `componentsCore` list, after the `Tooltip` entry.
- **`docs/concepts/performance.md`** gains a short *Diagnostics overlay* section after *Layout coalescing*, linking the page and naming the two numbers most worth watching (layout passes per second for a relayout loop, stylesheet rules for a rule leak).
- **`scripts/llms/manifest.data.mjs`** gains a row in the *Overlays* group: `{ task: "Live runtime diagnostics window (FPS, heap, components, layout, listeners, CSS rules)", symbol: "DiagnosticsOverlay" }`. Regenerate `llms.txt` with `npm run docs:llms`.
- **`docs/reference/changelog/next.md`**: an `## Added` section describing the overlay and the new subpath, plus a bullet under the existing `## Breaking changes` → `### Core` heading — `DOMSource` gains one required member, `countElements()`, which affects only a consumer implementing its own `DOMSource`. This mirrors the `DOMSink.clearDocumentSelection()` note already there.

---

## Potential Challenges

- **The sampler's own rAF chain pins the frame rate.** Requesting a frame every frame keeps the browser painting at the display refresh rate, so an idle app reads at its ceiling. Mitigation: document in the overlay's doc page that FPS is a *drop* indicator (it falls when the main thread is busy), not an idle-activity one.
- **The overlay counts itself.** Its own ~30 components, their listeners and their per-instance rules are inside every framework number. Mitigation: the doc page states the roughly constant offset; the numbers are meant to be read as trends across an interaction, not absolutes.
- **The overlay perturbs layout timing.** Writing 13 `Text` values twice a second schedules a layout on the overlay's grid, so *Layout flush* includes a small self-inflicted cost. Mitigation: keep the tree to labels only (no table, no chart), and update at 2 Hz rather than per frame.
- **`_destroyed` adds a field to every `Component`.** One boolean on a class that already carries ~50 fields. Mitigation: none needed, but the field is private and diagnostics-only — do not grow it into a general lifecycle flag without a separate decision.
- **`countElements()` is a real document scan.** On a 5 000-node page it costs about a millisecond, twice a second, and only while the overlay is open. Mitigation: it runs once per sample window, never per frame.
- **`performance.memory` reports a quantised, cross-origin-isolated-dependent figure.** Mitigation: label the row `JS heap` rather than implying precision, and render `unavailable` when absent.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| [`packages/lib/src/typescript/lib/core/Component.ts:174-240`](packages/lib/src/typescript/lib/core/Component.ts#L174) | The layout queue and `flushPendingLayouts`, where the flush timer goes. |
| [`packages/lib/src/typescript/lib/core/Component.ts:643`](packages/lib/src/typescript/lib/core/Component.ts#L643), [`:882`](packages/lib/src/typescript/lib/core/Component.ts#L882), [`:6454`](packages/lib/src/typescript/lib/core/Component.ts#L6454) | Constructor, `destructor`, `doLayout` — the three counter seams. |
| [`packages/lib/src/typescript/lib/core/ListenerBag.ts`](packages/lib/src/typescript/lib/core/ListenerBag.ts) | 101 lines; `add` and `remove` are the only edits. |
| [`packages/lib/src/typescript/lib/core/StyleTarget.ts:184-244`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L184) | `_ruleCache`, `_selectorOf`, `disposeStyleRule`, and the existing `_ruleCacheKeys` helper the new counter sits beside. |
| [`packages/lib/src/typescript/lib/core/Event.ts:175-180`](packages/lib/src/typescript/lib/core/Event.ts#L175), [`:437-510`](packages/lib/src/typescript/lib/core/Event.ts#L437) | The three listener maps and the `CompFunc` shape `listenerCounts()` walks. |
| [`packages/lib/src/typescript/lib/overlay/Tooltip.ts:60-200`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L60) | **The precedent** for the static-only singleton and its `callable()` exemption. |
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:625`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L625), [`:847`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L847), [`:908`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L908) | `show()`, `onExitAction()`, `destructor()` — the window lifecycle the overlay hooks. |
| [`packages/lib/src/typescript/lib/component/container/LabeledGrid.ts`](packages/lib/src/typescript/lib/component/container/LabeledGrid.ts) | The row descriptors (`LabeledFieldDescriptor`, the `fullWidth` variant) the readout is built from. |
| [`packages/lib/src/typescript/lib/core/DOM.ts:1219`](packages/lib/src/typescript/lib/core/DOM.ts#L1219), [`:1320`](packages/lib/src/typescript/lib/core/DOM.ts#L1320) | `querySelectorAll`'s declaration (where `countElements` is declared) and `onFontsReady` (the precedent for a non-geometry `DOMSource` member). |
| [`packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts) | The exact shape of the rule-leak assertion the overlay's own teardown test copies. |
| [`packages/lib/src/typescript/StyleAuditPanel.ts`](packages/lib/src/typescript/StyleAuditPanel.ts) | The existing in-app stylesheet-audit view; its selector classification is the model for `styleRuleCounts()`'s buckets. |
| [`packages/lib/eslint.config.js:96-115`](packages/lib/eslint.config.js#L96) | Why `document` must go through the seam inside `lib/` but not in the demo panels. |

---

## Non-Goals

- **A built-in keyboard shortcut.** The `Event` API is self-only — a component may only register listeners on itself (ARCHITECTURE.md, *A component must not listen to another component's events through `Event`*) — so a library-owned global key binding would need some component to own it while the overlay is closed, and there is no such owner. Consumers wire their own key from their app shell and call `DiagnosticsOverlay.toggle()`.
- **An FPS or heap sparkline.** `Canvas` could draw one, but a numeric readout answers the question; a history graph adds a per-frame draw to the thing being measured.
- **A component-tree inspector or per-component drill-down.** That is a different tool with a different cost profile; this overlay reports aggregate counters only.
- **A build-time `__DEV__` strip.** The library ships one ESM build with no dev/prod define anywhere in `src/typescript/lib` — introducing one for this feature would be a new pattern. The subpath export already keeps the UI out of a bundle that never imports it.
- **Deducting garbage-collected components from the live count.** `componentsConstructed − componentsDestroyed` deliberately counts a component that was dropped without `dispose()`. Making that number GC-accurate would need a second `FinalizationRegistry` and would hide exactly the leak the counter exists to expose.
- **Retiring `StyleAuditPanel`.** Its per-rule duplication breakdown is a different question from the overlay's aggregate rule count; it stays as it is.
- **Persisting overlay position or size across reloads.**

---

## Notes

[^derive-vs-push]: The alternative — pushing every metric through `Diagnostics`, including rules and DOM listeners — was rejected because it duplicates state that already exists and can therefore drift from it. `_ruleCache.size` *is* the rule count; a parallel counter incremented in `_ruleFor` and decremented in `disposeStyleRule` would silently disagree the first time a code path bypassed one of them, and a diagnostics number that lies is worse than no number. The converse — building a global registry of live `Component`s or `ListenerBag`s so those could be derived too — was rejected because a registry holding components keeps them alive, which is precisely the failure mode this overlay is meant to detect. A `WeakRef` + `FinalizationRegistry` registry would avoid the pinning but adds an allocation per bag and makes the count depend on GC timing.

[^leaf-module]: `Event.ts` already imports `Component.ts`, and `Component.ts` will import `Diagnostics.ts`. Had `Diagnostics.ts` also imported `Event.ts` to fold the derived readings into one `snapshot()` call, the result would be a `Component → Diagnostics → Event → Component` cycle. ES modules tolerate a cycle whose usage is confined to function bodies, but it makes module-initialisation order load-bearing for no gain. Keeping `Diagnostics.ts` importless and putting the assembler in `diagnostics/DiagnosticsSampler.ts` — a module nothing else imports — makes the cycle structurally impossible.

[^singleton-precedent]: `Notification` and `Body` are the other two static-surface singletons in the library. `Notification` was not chosen as the model because it manages a *collection* of transient instances rather than one persistent instance, and `Body` is a process-wide root created eagerly at module load. `Tooltip` matches on every axis that matters here: one lazily created instance, a private constructor, no public construction surface, and an explicit written-down exemption from the `callable()` rule for exactly that reason.

[^subpath-treeshake]: `package.json` marks only `**/core.es.js` and the editor languages file as having side effects, so a bundler is already free to drop unused exports from the other chunks. Relying on that alone was rejected: a consumer who imports anything from `@jimka/typescript-ui/overlay` pulls in the overlay chunk, and whether the diagnostics window survives tree-shaking then depends on their bundler's precision. A separate entry point removes the question — the code is in a chunk that is never fetched.

[^gating]: Measured against the existing `Benchmark.benchComponentInit` baseline, one namespace call that increments a module-level integer is far below the per-component construction cost, which is dominated by `resolveClassDefaults`, the `StyleRule` allocation and the `applyOptions` cascade. The gated pair is different in kind: `performance.now()` is a real clock read, and running two of them unconditionally on every animation frame for the life of every app is a cost imposed on consumers who will never open the overlay. One boolean read is not.

[^timing-perturbation]: Three things would corrupt the measurement and are avoided. Timing each `doLayout()` call individually would put two clock reads inside a recursion that runs thousands of times per frame in a large table, which is a large enough perturbation to change the number it reports. Reading DOM geometry inside the timed region would force a style/layout recalculation that the untimed pass would not have paid. And starting the timer before the font gate's early return ([`Component.ts:194`](packages/lib/src/typescript/lib/core/Component.ts#L194)) would record held first-flushes as near-zero samples, dragging the average down at exactly the moment startup cost matters most.

[^count-elements]: `DOM.source.querySelectorAll(root, "*")` would work and needs no new seam member, but it returns `Handle[]`, which means interning every element in the document into the module-private handle registry on every sample — thousands of registry entries twice a second, on a registry whose growth is itself one of the things the overlay is supposed to help diagnose. `countElements()` returns a number and interns nothing. Its offline implementation returns `0`, matching `ModelledDOMSource.querySelectorAll`'s existing "no selector engine offline" stance rather than inventing a modelled count that no offline test could meaningfully assert against.

[^ui-composition]: A `TabPanel` split into "Browser" and "Framework" tabs was considered and rejected: half the numbers would be hidden at any moment, and the interesting readings are the correlated ones — layout passes rising while frame time rises. Two `Header` rows inside one scrolling `LabeledGrid` gives the same grouping with everything visible. A `Table` bound to a `Store` was also rejected: it would make each sample a store reload, adding materially more layout work per update than 13 `setText` calls, in the component whose whole job is to measure layout work.
