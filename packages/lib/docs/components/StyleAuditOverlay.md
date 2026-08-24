# StyleAuditOverlay

[`StyleAuditOverlay`](/api/diagnostics/classes/StyleAuditOverlay) is a singleton floating window showing the stylesheet dedup audit: per-instance (`#id`-scoped) rules on the framework's shared stylesheet whose declaration body duplicates another instance's, ranked by bytes wasted. It shares the `@jimka/typescript-ui/diagnostics` subpath with [`DiagnosticsOverlay`](/components/DiagnosticsOverlay), which imports it directly to wire its "Show style audit" button — so an app that imports `DiagnosticsOverlay` bundles this window's code too, including its `Table` and `MemoryStore` dependencies, whether or not it ever calls `StyleAuditOverlay.open()` itself. An app that imports neither symbol from the subpath bundles neither.

Open it with `StyleAuditOverlay.open()` — there is no public constructor.

```typescript
import { StyleAuditOverlay } from '@jimka/typescript-ui/diagnostics';

StyleAuditOverlay.open();
```

## Relation to DiagnosticsOverlay

[`DiagnosticsOverlay`](/components/DiagnosticsOverlay)'s "Stylesheet rules" row and this window both read the same module rule cache, so they never disagree about what is currently materialised — they just report it at different granularity. `DiagnosticsOverlay` shows one bucketed total (how many rules are per-instance vs per-class vs other); this window shows the per-rule detail behind the per-instance bucket — which bodies repeat, how many times, and how many bytes a shared class-level rule could reclaim. Open both together with `DiagnosticsOverlay`'s own "Show style audit" button, or `StyleAuditOverlay.open()` directly.

## Manual snapshot, not a live sampler

Unlike `DiagnosticsOverlay`'s twice-a-second readout, this window computes the audit once when opened and again only when you click **Refresh** — scanning every cached rule and string-comparing declaration bodies is real work, and a duplicate-rule count is not the kind of number that benefits from sub-second liveness the way FPS or heap does. Switch tabs or open more windows to populate more components, then click Refresh to see the updated numbers.

## The window counts itself

Its own `Button`, `Table`, and row components add `#id` rules to the very cache it audits, so opening it and clicking Refresh includes its own chrome in the results — the same self-counting `DiagnosticsOverlay` already documents for its own numbers.

## API surface

- `StyleAuditOverlay.open()` — opens the overlay, creating it on first call. Idempotent.
- `StyleAuditOverlay.close()` — closes it. A no-op while already closed.
- `StyleAuditOverlay.toggle()` — opens when closed, closes when open.
- `StyleAuditOverlay.isOpen()` — `true` between an `open()` and its matching `close()`.

## Notes

- Singleton — there is only ever one style-audit window on screen, mirroring [`DiagnosticsOverlay`](/components/DiagnosticsOverlay)'s own shape.
- Positioned to the right of `DiagnosticsOverlay`'s own window (at `x: 360`, vs. `DiagnosticsOverlay`'s `x: 24` / `width: 320`), so the two do not fully overlap when both are open.
- The same audit is also embedded, without the window chrome, in the demo app's own "Style Audit" tab.

## See also

- [API: StyleAuditOverlay](/api/diagnostics/classes/StyleAuditOverlay)
- [DiagnosticsOverlay](/components/DiagnosticsOverlay) — the runtime diagnostics window this one is opened alongside
