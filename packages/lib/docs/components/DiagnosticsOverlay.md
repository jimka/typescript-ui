# DiagnosticsOverlay

[`DiagnosticsOverlay`](/api/diagnostics/classes/DiagnosticsOverlay) is a singleton floating window showing live runtime diagnostics: browser-level numbers (FPS, JS heap, DOM node count, long tasks) beside framework-internal ones (live [`Component`](/api/core/classes/Component) count, layout passes and flush time, DOM/semantic listener registrations, per-instance stylesheet rules). It ships as its own subpath, `@jimka/typescript-ui/diagnostics`, so an app that never imports it never bundles a byte of the overlay UI.

Open it with `DiagnosticsOverlay.open()` — there is no public constructor.

```typescript
import { DiagnosticsOverlay } from '@jimka/typescript-ui/diagnostics';

DiagnosticsOverlay.open();
```

## What each row means

The same explanation is available in-app: hover a row's label or its number for
a tooltip explaining that row. The table below and the overlay's
`ROW_DESCRIPTIONS` constant state the same facts and are edited together.

| Row | Reads | Leak class it catches |
|---|---|---|
| FPS | Frames per second over the last sample window | A busy main thread — falls under load, is not an idle-activity indicator (the overlay's own frame loop keeps the tab painting at its ceiling while open) |
| Frame time | Average / max ms per frame in the window | Same as FPS, in absolute time rather than a rate |
| JS heap | `performance.memory` used / limit, in MB | Steady growth across interactions that should be memory-neutral |
| DOM nodes | `document.querySelectorAll("*").length` | A component or raw element leaking outside the framework's own teardown |
| Long tasks | Cumulative count since `open()`, plus the count in the last window | Main-thread work over 50 ms — jank the FPS/frame-time rows alone can't localise to a cause |
| Components | Live `Component` count (constructed − destroyed) | A `Window`, `Panel`, or other subtree closed/removed without `dispose()` ever reaching every descendant |
| Constructed / disposed | The two raw counters `Components` derives from | Distinguishes "nothing is being constructed any more" from "construction and disposal are both climbing but staying balanced" |
| Layout passes | `doLayout()` calls per second | A setter that unconditionally calls `scheduleLayout()` every pass, pinning the CPU in a relayout loop |
| Layout flush | Average / max ms per coalesced rAF flush | A single pass whose cost balloons — a layout manager doing more work than its tree size justifies |
| DOM listeners | Live `Event.addListener` / `addSubtreeListener` / `addViewportListener` registrations | A component whose `destructor()` doesn't reach `Event.purgeComponent` for every listener it registered |
| Semantic listeners | Live `on()` / `off()` registrations across every `ListenerBag` | The `ListenerBag` equivalent of the DOM listener leak — a re-wired handler that was never unregistered |
| Stylesheet rules | Materialised rule count, split into per-instance / per-class / other | A component held in a field and appended via a raw DOM call instead of `addComponent`, whose per-instance `#id` rule is never disposed |

## Browser support caveats

- **JS heap** reads `unavailable` on any engine without `performance.memory` — every non-Chromium browser. Chromium reports a quantised, cross-origin-isolation-dependent figure; read it as a trend, not a precise number.
- **Long tasks** stay at `0` on an engine without the `"longtask"` `PerformanceObserver` entry type. The overlay feature-detects this and simply never installs the observer — no error, no fallback polling.

## The overlay counts itself

Its own ~30 components, their listeners, and their per-instance rules are inside every framework number. Read the numbers as trends across an interaction (open a `Window` ten times, watch **Components** / **DOM listeners** / **Stylesheet rules** return to roughly where they started) rather than as absolutes. Its twelve rows' hover explanations add a further fixed 96 to **DOM listeners** while the overlay is open (12 rows × 2 targets × 4 listeners each), purged the same way on close.

## API surface

- `DiagnosticsOverlay.open()` — opens the overlay, creating it on first call. Idempotent.
- `DiagnosticsOverlay.close()` — closes it. A no-op while already closed.
- `DiagnosticsOverlay.toggle()` — opens when closed, closes when open. Wire this to your own app shell's keyboard shortcut; the overlay has no built-in key binding (see [Events](/concepts/events) for why a library-owned global listener isn't the framework's pattern).
- `DiagnosticsOverlay.isOpen()` — `true` between an `open()` and its matching `close()`.
- A "Show style audit" button opens [`StyleAuditOverlay`](/components/StyleAuditOverlay), a second window showing the stylesheet dedup audit behind the "Stylesheet rules" row above.

## Notes

- Singleton — there is only ever one diagnostics window on screen, mirroring [`Tooltip`](/components/Tooltip)'s shape.
- The overhead of the pushed counters is one integer increment at seams the framework already runs on every request; the two `performance.now()` calls that time a layout flush only run while the overlay is open.
- The window is fixed-size, with no minimize or maximize affordance — drag the title bar to reposition it, or use `close()` / `toggle()` to dismiss it.

## See also

- [API: DiagnosticsOverlay](/api/diagnostics/classes/DiagnosticsOverlay)
- [Performance](/concepts/performance) — where the overlay fits among the framework's other performance tools
