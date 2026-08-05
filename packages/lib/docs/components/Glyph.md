# Glyph

[`Glyph`](/api/component/display/classes/Glyph) renders a small icon from the framework's curated registry. Each registry entry is either an SVG path or a single Unicode character; both forms follow `currentColor`, so a `Glyph` inherits the surrounding text colour for free.

SVG path data is mounted **once** into a hidden `<svg>` sprite on `document.body`. Every Glyph instance referencing the same name emits `<span><svg><use href="#ts-glyph-…"/></svg></span>`, so two `Glyph('times')` calls don't duplicate the path string in the DOM.

The framework is self-contained — the glyphs it needs ship with the library, and there is no peer dependency for icons.

<!-- demo: glyph-gallery -->
> **Live demo** — six named `Glyph`s in an `HFlow`, plus a button cycling
> one glyph through `spin` / `pulse` / `beat` / none.
> [Open the Glyph page](https://jimka.github.io/typescript-ui/components/Glyph)
<!-- /demo -->

## Usage

```typescript
import { Glyph } from '@jimka/typescript-ui/component/display';

// SVG entry — renders as <span><svg><use href="#ts-glyph-times"/></svg></span>
const close = Glyph('times');

// Unicode entry — renders as <span>▶</span>
const arrow = Glyph('arrow-right');

panel.addComponent(close);
panel.addComponent(arrow);
```

## Registry

The registry lives in `src/typescript/lib/component/display/Glyphs.ts`. Add a glyph by adding one property to the frozen object — no build-time tooling, no metadata parsing.

The registry starts empty except for four eagerly-registered built-in Unicode-triangle glyphs (prefixed `unicode-` so user-registered `arrow-*` SVG glyphs never collide with them). All other glyphs — including SVG icons like `xmark` and `circle-check` — are registered on demand by the components that use them (or by your own code).

| Name | Kind | Notes |
| --- | --- | --- |
| `unicode-arrow-up` | Unicode `▲` | Scrollbar vertical start arrow |
| `unicode-arrow-down` | Unicode `▼` | Scrollbar vertical end arrow |
| `unicode-arrow-left` | Unicode `◀` | Scrollbar horizontal start arrow |
| `unicode-arrow-right` | Unicode `▶` | Scrollbar horizontal end arrow |

## Where Glyph is used

The following components consume the registry by name:

- [`WindowHeader`](/api/component/container/classes/WindowHeader) — close button (always `xmark`), and an optional title-icon slot exposed via `setGlyph(name)` and the `glyph` option.
- [`Button`](/api/component/button/classes/Button) — optional leading glyph via `setGlyph(name)` or the `glyph` option. Inherited by [`ToggleButton`](/api/component/button/classes/ToggleButton) and pre-seeded with `xmark` on [`TabCloseButton`](/api/component/button/classes/TabCloseButton).
- [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) — optional leading glyph via `setGlyph(name)` or the `glyph` option.
- [`Tree`](/api/component/tree/classes/Tree) row toggles — `caret-down` when expanded, `caret-right` when collapsed. The row never sees the raw character; the registry decides the look.
- [`Scrollbar`](/api/component/container/classes/Scrollbar) end-cap arrow buttons (on by default; suppress via `arrowsEnabled: false`) — `unicode-arrow-up` / `unicode-arrow-down` on vertical bars; `unicode-arrow-left` / `unicode-arrow-right` on horizontal bars.
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

Reduced-motion is honoured: when the OS reports `prefers-reduced-motion: reduce`, `setAnimated(kind)` caches the request but does not mount the class. A module-level listener re-applies (or removes) the class live should the OS preference flip.

The animation class lands on the glyph's HTML root, which is what lets the browser run the `transform` keyframes on its compositor thread. An animation mounted on an SVG element cannot composite, and the browser then rebuilds its layer assignment on every frame at a cost that scales with the whole page — so an animated glyph would get steadily more expensive as the rest of the screen filled up. No `will-change` hint is set: the hint cannot make an animation compositable, and glyphs are numerous enough that hinting each one would push a page past the count where browsers ignore the hint.

`setAnimated` coexists with the inherited `Component.setAnimation(value: string)` raw shorthand setter; the two APIs are independent. Prefer `setAnimated` for the three named kinds.

## Notes

- The root element is a `<span>` for both registry kinds; an SVG entry paints through an inner `<svg>`. The registry name is fixed at construction — to swap glyph, discard the instance and create a new one.
- Default preferred size is 16×16.
- Passing an unknown name throws at construction: `Glyph('nope')` → `Error("Unknown glyph: nope")`.
- Colour follows the cascade — set `setForegroundColor(...)` on the Glyph or any ancestor.

## See also

- [API: Glyph](/api/component/display/classes/Glyph)
- [`IconText`](/api/component/display/classes/IconText) — Glyph paired with a standalone Text label.
- [`IconLabel`](/api/component/display/classes/IconLabel) — Glyph paired with a form-control `<label for="…">`.
