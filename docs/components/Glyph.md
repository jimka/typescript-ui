# Glyph

[`Glyph`](/api/component/display/classes/Glyph) renders a small icon from the framework's curated registry. Each registry entry is either an SVG path or a single Unicode character; both forms follow `currentColor`, so a `Glyph` inherits the surrounding text colour for free.

SVG path data is mounted **once** into a hidden `<svg>` sprite on `document.body`. Every Glyph instance referencing the same name emits `<svg><use href="#ts-glyph-…"/></svg>`, so two `Glyph('times')` calls don't duplicate the path string in the DOM.

The framework is self-contained — the glyphs it needs ship with the library, and there is no peer dependency for icons.

## Usage

```typescript
import { Glyph } from '@jimka/typescript-ui/component/display';

// SVG entry — renders as <svg><use href="#ts-glyph-times"/></svg>
const close = Glyph('times');

// Unicode entry — renders as <span>▶</span>
const arrow = Glyph('arrow-right');

panel.addComponent(close);
panel.addComponent(arrow);
```

## Registry

The registry lives in `src/typescript/lib/component/display/Glyphs.ts`. Add a glyph by adding one property to the frozen object — no build-time tooling, no metadata parsing.

| Name | Kind | Notes |
| --- | --- | --- |
| `times` | SVG | Close / dismiss `×` |
| `arrow-right` | Unicode `▶` | Collapsed tree node / disclosure |
| `arrow-down` | Unicode `▼` | Expanded tree node / disclosure |

## Where Glyph is used

The following components consume the registry by name:

- [`WindowHeader`](/api/component/container/classes/WindowHeader) — close button (always `times`), and an optional title-icon slot exposed via `setGlyph(name)` and the `glyph` option.
- [`Button`](/api/component/button/classes/Button) — optional leading glyph via `setGlyph(name)` or the `glyph` option. Inherited by [`ToggleButton`](/api/component/button/classes/ToggleButton) and pre-seeded with `times` on [`TabCloseButton`](/api/component/button/classes/TabCloseButton).
- [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) — optional leading glyph via `setGlyph(name)` or the `glyph` option.
- [`Tree`](/api/component/tree/classes/Tree) row toggles — `arrow-down` when expanded, `arrow-right` when collapsed. The row never sees the raw character; the registry decides the look.
- [`IconText`](/api/component/display/classes/IconText) / [`IconLabel`](/api/component/display/classes/IconLabel) — small composites pairing a glyph with a [`Text`](/api/component/input/classes/Text) or `<label>`.
- Table cells via the `glyph` field type — see [`GlyphCell`](/api/component/table/classes/GlyphCell) and [`GlyphRenderer`](/api/component/table/classes/GlyphRenderer).

## Animation

Glyphs can play one of three named, continuous animations — `spin`, `pulse`, `beat` — by toggling a CSS class on the root element. The names mirror FontAwesome's `fa-spin` / `fa-pulse` / `fa-beat` vocabulary.

```typescript
const g = Glyph('xmark');
g.setAnimated('spin');   // 360 degree rotate
g.setAnimated('pulse');  // 8-step rotate (faux-loading tick)
g.setAnimated('beat');   // transform-scale pulse
g.clearAnimated();       // stop
```

| Kind | Use | Default duration |
| --- | --- | --- |
| `spin` | Loading and refresh affordances | `--ts-ui-glyph-spin-duration` (2000ms) |
| `pulse` | Mechanical faux-loading tick | `--ts-ui-glyph-pulse-duration` (1000ms) |
| `beat` | Notification dots, attention nudges | `--ts-ui-glyph-beat-duration` (1000ms) |

The duration is theme-token-driven — set the CSS custom property to retune the active speed without touching call sites. Per-instance overrides are available via `setAnimationDuration(ms)`; pass `0` to clear and fall back to the token.

Animation is presentation state, not registry state — the same `xmark` glyph can spin in one panel and stay static in another without two registry entries.

Reduced-motion is honoured: when the OS reports `prefers-reduced-motion: reduce`, `setAnimated(kind)` caches the request but does not mount the class. A module-level listener re-applies (or removes) the class live should the OS preference flip. While motion is active, `will-change: transform` is set; it is cleared when motion stops.

`setAnimated` coexists with the inherited `Component.setAnimation(value: string)` raw shorthand setter; the two APIs are independent. Prefer `setAnimated` for the three named kinds.

## Notes

- The underlying root tag (`<svg>` or `<span>`) is decided once at construction from the registry entry's `kind`. To swap glyph, discard the instance and create a new one.
- Default preferred size is 16×16.
- Passing an unknown name throws at construction: `Glyph('nope')` → `Error("Unknown glyph: nope")`.
- Colour follows the cascade — set `setForegroundColor(...)` on the Glyph or any ancestor.

## See also

- [API: Glyph](/api/component/display/classes/Glyph)
- [`IconText`](/api/component/display/classes/IconText) — Glyph paired with a standalone Text label.
- [`IconLabel`](/api/component/display/classes/IconLabel) — Glyph paired with a form-control `<label for="…">`.
