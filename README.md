# typescript-ui

A web-based layout manager and UI component framework written in TypeScript. Provides desktop-style user interfaces in the browser using absolute positioning, with a rich set of reusable components and layout algorithms.

> **Notice:** Developed and tested on Chrome. Firefox and Safari compatibility is not verified.

## Documentation

Full documentation lives at **<https://jimka.github.io/typescript-ui/>** *(deployed via GitHub Pages on push to `master`)*.

For local development of the docs site:

```bash
npm run docs:dev
```

Highlights:

- [Installation & TypeScript setup](https://jimka.github.io/typescript-ui/guide/installation) — `npm install @jimka/typescript-ui` plus `moduleResolution: "bundler"` notes.
- [Mental model](https://jimka.github.io/typescript-ui/guide/mental-model) — absolute positioning, `doLayout()`, why this is not React.
- [Components](https://jimka.github.io/typescript-ui/components/) — full catalog (50+).
- [Layouts](https://jimka.github.io/typescript-ui/layouts/) — `Border`, `Split`, `Tab`, `Grid`, and 13 more.
- [Data layer](https://jimka.github.io/typescript-ui/data/) — `Model`, `Store`, `Proxy`, `Binding`.
- [Theming](https://jimka.github.io/typescript-ui/concepts/theming) — runtime-switchable design tokens.
- [API reference](https://jimka.github.io/typescript-ui/api/) — TypeDoc-generated browser of every public class.

## Quick install

```bash
npm install @jimka/typescript-ui
```

```typescript
import { Window, ThemeManager, DarkTheme } from '@jimka/typescript-ui/core';

// ModernTheme is applied automatically when the core module is imported.
// Call setTheme only to switch themes (e.g. dark mode):
ThemeManager.setTheme(DarkTheme);

const win = new Window('Hello');
win.show();
```

## Glyphs

This library ships ~2,860 SVG icons from [Font Awesome Free 7.2.0](https://fontawesome.com/license/free) (CC BY 4.0). Icons are **opt-in by explicit registration** — the runtime registry starts empty so the bundler can tree-shake away unused icons.

```ts
import { Glyph } from '@jimka/typescript-ui/component/display';
import { xmark } from '@jimka/typescript-ui/glyphs/solid/xmark';
import { pen_to_square } from '@jimka/typescript-ui/glyphs/solid/pen_to_square';
import { plus } from '@jimka/typescript-ui/glyphs/solid/plus';

Glyph.register(xmark, pen_to_square, plus);

new Glyph("xmark");           // renders the X icon
new Glyph("pen-to-square");   // renders the edit pencil
new Glyph("plus");            // renders the plus icon
```

The string passed to `new Glyph(name)` is the upstream Font Awesome name (with hyphens). The JS identifier is sanitized: `-` becomes `_` and identifiers starting with a digit get a leading `_` (so `arrow-right` exports as `arrow_right`, `500px` as `_500px`, `try` as `_try`).

### Migration from the previous curated registry

If you were using the previous 19-icon curated registry, switch to these latest-FA names:

| Old | New |
|-----|-----|
| `times`, `close` | `xmark` |
| `edit` | `pen-to-square` |
| `info-circle` | `circle-info` |
| `check-circle` | `circle-check` |
| `exclamation-triangle`, `warning` | `triangle-exclamation` |
| `exclamation-circle`, `error` | `circle-exclamation` |
| `question-circle` | `circle-question` |
| `search` | `magnifying-glass` |
| `cog` | `gear` |
| `home` | `house` |

Library components that internally use glyphs (Tree row chevrons, Notification badges) register their own dependencies automatically — consumers only need to register the glyphs they reference directly.

## Repository scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on port 8015 (demo app) |
| `npm run build` | Production bundle of the demo app to `dist/` |
| `npm run build:lib` | Library bundle (ESM + `.d.ts`) to `dist/lib/` |
| `npm run typecheck` | Strict TypeScript type check (no emit) |
| `npm run docs:dev` | Serve the documentation site locally |
| `npm run docs:build` | Build the documentation site |
| `npm run clean` | Delete `dist/` contents |

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Free for personal and educational use; commercial use is not permitted.

Third-party material redistributed with this project (Font Awesome Free icons) is covered by its own license — see [LICENSE-FONTAWESOME.md](LICENSE-FONTAWESOME.md) for attribution and license details.
