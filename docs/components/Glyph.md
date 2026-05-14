# Glyph

[`Glyph`](/api/component/display/classes/Glyph) renders a small icon from the framework's curated registry. Each registry entry is either an SVG path or a single Unicode character; both forms follow `currentColor`, so a `Glyph` inherits the surrounding text colour for free.

SVG path data is mounted **once** into a hidden `<svg>` sprite on `document.body`. Every Glyph instance referencing the same name emits `<svg><use href="#ts-glyph-…"/></svg>`, so two `new Glyph('times')` calls don't duplicate the path string in the DOM.

::: tip Why not FontAwesome?
[`FontAwesomeIcon`](/api/component/display/classes/FontAwesomeIcon) requires the FontAwesome script to be loaded by the host page. `Glyph` is self-contained — the framework ships the glyphs it needs and no peer dependency is involved.
:::

## Usage

```typescript
import { Glyph } from '@jimka/typescript-ui/component/display';

// SVG entry — renders as <svg><use href="#ts-glyph-times"/></svg>
const close = new Glyph('times');

// Unicode entry — renders as <span>▶</span>
const arrow = new Glyph('arrow-right');

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

## Notes

- The underlying root tag (`<svg>` or `<span>`) is decided once at construction from the registry entry's `kind`. To swap glyph, discard the instance and create a new one.
- Default preferred size is 16×16, matching [`FontAwesomeIcon`](/api/component/display/classes/FontAwesomeIcon).
- Passing an unknown name throws at construction: `new Glyph('nope')` → `Error("Unknown glyph: nope")`.
- Colour follows the cascade — set `setForegroundColor(...)` on the Glyph or any ancestor.

## See also

- [API: Glyph](/api/component/display/classes/Glyph)
- [`FontAwesomeIcon`](/api/component/display/classes/FontAwesomeIcon) — the FontAwesome-backed alternative
