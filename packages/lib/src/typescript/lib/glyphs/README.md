# Font Awesome Free Glyphs

Generated from Font Awesome Free 7.2.0 by `scripts/import-fontawesome.ts`. Do not edit by hand — re-run the script.

## Identifier sanitization

Filenames are translated to JavaScript identifiers with two rules:

1. Replace every `-` with `_`. So `arrow-right.svg` → `arrow_right`.
2. If the first character is a digit, prefix with `_`. So `500px.svg` → `_500px`, `42-group.svg` → `_42_group`.

The original (hyphenated, digit-leading) name is preserved as the `name` field on each `NamedGlyphDef`, so the registry key matches the upstream FA name.

## Import patterns

Namespaced bulk import (recommended for registering many icons at once):

```ts
import { solid } from "@jimka/typescript-ui/glyphs";

Glyph.register(solid.xmark);
Glyph.register(solid.arrow_right);
```

Per-style import (avoids loading other styles):

```ts
import { xmark, arrow_right } from "@jimka/typescript-ui/glyphs/solid";
```

Per-icon import (smallest unit, lets bundlers tree-shake):

```ts
import { xmark } from "@jimka/typescript-ui/glyphs/solid/xmark.js";
```

The top-level barrel uses `export * as solid` / `regular` / `brands` so identifiers that collide across styles (e.g. `heart`) stay distinct.

## License

Each generated icon file carries:

```
// SPDX-License-Identifier: CC-BY-4.0
// Source: Font Awesome Free 7.2.0, https://fontawesome.com/license/free
// © Fonticons, Inc.
```

See [`LICENSE-FONTAWESOME.md`](../../../../LICENSE-FONTAWESOME.md) and [`NOTICE`](../../../../NOTICE) at the repo root for full attribution.
