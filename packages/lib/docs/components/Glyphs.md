# Glyphs

This page documents the icon registration system. For the `Glyph` component itself see [Glyph](/api/component/display/classes/Glyph).

## Explicit registration

The library ships the Font Awesome Free 7.2.0 corpus (~2,860 icons across `solid`, `regular`, `brands`) as tree-shakable per-icon TypeScript modules. The runtime registry starts empty — every glyph used in your app must be registered before it can be looked up by name.

```ts
import { Glyph } from '@jimka/typescript-ui/component/display';
import { xmark } from '@jimka/typescript-ui/glyphs/solid/xmark';

Glyph.register(xmark);

new Glyph("xmark");
```

## Import paths

Two import styles:

- **Per-style (preferred)** — `@jimka/typescript-ui/glyphs/solid/<identifier>` — guarantees one path string in the bundle.
- **Bulk (namespaced)** — `import { solid, regular, brands } from '@jimka/typescript-ui/glyphs'` — then `Glyph.register(solid.xmark)`. Tree-shaking-friendly when the bundler is strict.

## Identifier sanitization

JS doesn't permit hyphens or digit-leading identifiers in `import` names. The codegen output sanitizes:

| FA name | JS identifier |
|---------|---------------|
| `arrow-right` | `arrow_right` |
| `500px` | `_500px` |
| `42-group` | `_42_group` |
| `try` | `_try` (reserved word) |

The `name` string used at runtime (`new Glyph("arrow-right")`) is always the original FA name.

## Library-internal glyphs

Some library components register their own glyphs at module load. Consumers do not need to re-register these:

- `Tree` — registers `caret-down`, `caret-right` for row-toggle chevrons.
- `Notification` — registers `circle-info`, `circle-check`, `triangle-exclamation`, `circle-exclamation`, and `xmark` for severity badges and the close button.

Components that accept a glyph name as a parameter (Button, MenuItem, Window header, Dialog, IconText, IconLabel, etc.) leave registration to the caller.

## Licensing

Font Awesome Free icons are CC BY 4.0 (© Fonticons, Inc.). The full attribution is in `LICENSE-FONTAWESOME.md` at the package root and propagates through the npm tarball. See [LICENSE-FONTAWESOME.md](https://github.com/jimka/typescript-ui/blob/master/packages/lib/LICENSE-FONTAWESOME.md) and [THIRD-PARTY-NOTICES.md](https://github.com/jimka/typescript-ui/blob/master/packages/lib/THIRD-PARTY-NOTICES.md) for the full attribution text.
