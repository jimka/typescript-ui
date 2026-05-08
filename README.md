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
import { Body, Window, Button, ThemeManager, DefaultTheme } from '@jimka/typescript-ui';

ThemeManager.setTheme(DefaultTheme);

const win = new Window();
win.setHeaderText('Hello');
win.show();
```

## Repository scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on port 8015 (demo app) |
| `npm run build` | Production bundle of the demo app to `dist/` |
| `npm run build:lib` | Library bundle (ESM + UMD + `.d.ts`) to `dist/lib/` |
| `npm run typecheck` | Strict TypeScript type check (no emit) |
| `npm run docs:dev` | Serve the documentation site locally |
| `npm run docs:build` | Build the documentation site |
| `npm run clean` | Delete `dist/` contents |

## License

Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Free for personal and educational use; commercial use is not permitted.
