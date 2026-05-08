# Installation

`@jika/typescript-ui` is published on npm and ships ESM, UMD, and `.d.ts` declarations. The package has zero runtime npm dependencies; FontAwesome is an optional peer for [FontAwesomeIcon](/api/classes/FontAwesomeIcon).

## Install

```bash
npm install @jika/typescript-ui
```

For [FontAwesomeIcon](/api/classes/FontAwesomeIcon) glyphs, also install:

```bash
npm install @fortawesome/fontawesome-free
```

## TypeScript configuration

The library uses `.js` extensions in its source imports (these resolve to `.ts` via the bundler). Consumers must set `moduleResolution` to `bundler`, `node16`, or `nodenext` in their `tsconfig.json`:

```json
{
    "compilerOptions": {
        "moduleResolution": "bundler"
    }
}
```

## Bundler setup

The library is bundler-agnostic. Verified configurations:

- **Vite** — works out of the box.
- **Webpack 5 / Rollup** — works with default ESM resolution.
- **Plain `<script type="module">`** — use the UMD bundle from `dist/lib/typescript-ui.umd.js` or import the ESM build from a CDN.

## Theming bootstrap

Theming uses runtime-injected CSS custom properties. There is **no `.css` file to import**. Call [`ThemeManager.setTheme`](/api/classes/ThemeManager) once on startup before mounting any component:

```typescript
import { ThemeManager, DefaultTheme } from '@jika/typescript-ui';

ThemeManager.setTheme(DefaultTheme);
```

See [Theming](/concepts/theming) for details and custom themes.

## Development setup

If you are working on the framework itself rather than consuming it:

```bash
git clone https://github.com/jimka/typescript-ui.git
cd typescript-ui
npm install
npm run dev
```

Open `http://localhost:8015`. The demo app renders a tabbed showcase of every layout manager and component.

## Build commands

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on port 8015 with hot reload |
| `npm run build` | Production bundle of the demo app to `dist/` |
| `npm run build:lib` | Library bundle (ESM + UMD + `.d.ts`) to `dist/lib/` |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | Strict TypeScript type check (no emit) |
| `npm run docs:dev` | Serve this documentation site locally |
| `npm run docs:build` | Build the documentation site |
| `npm run clean` | Delete `dist/` contents |

## Browser support

Tested on **Chrome** and **Firefox**. **Safari** compatibility is not verified.
