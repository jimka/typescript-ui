# Installation

`@jimka/typescript-ui` is published on npm and ships ESM bundles and `.d.ts` declarations. It declares runtime dependencies that npm installs alongside it — the CodeMirror and Lexical editor stacks, the `d3-array` / `d3-scale` / `d3-shape` charting submodules, `marked`, `prettier`, `sql-formatter`, and the Manrope webfont. `elkjs` is an optional peer dependency, needed only for `DiagramView`'s ELK layout engine.

The public API is exposed only through **subpath exports** — there is no bare `@jimka/typescript-ui` entry. Import each symbol from its group: `core`, `primitive`, `layout`, `data`, `validation`, or `component/<group>` (where `<group>` is `input`, `button`, `display`, `list`, `container`, `menubar`, `table`, or `tree`).

## Starting a new project

The fastest way to a running app is the scaffolder — it writes a minimal Vite +
TypeScript starter with `@jimka/typescript-ui` already installed:

```bash
npm create @jimka/tsui-app my-app
cd my-app
npm install
npm run dev
```

## Install

To add the library to an existing project instead:

```bash
npm install @jimka/typescript-ui
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
- **Plain `<script type="module">`** — import the ESM build from a CDN that supports per-subpath resolution.

## Theming bootstrap

Theming uses runtime-injected CSS custom properties. There is **no `.css` file to import**. Call [`ThemeManager.setTheme`](/api/core/classes/ThemeManager) once on startup before mounting any component:

```typescript
import { ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(ClassicTheme);
```

See [Theming](/concepts/theming) for details and custom themes.

## Using @jimka/typescript-ui with AI agents

If you use an AI coding assistant, add this line to your project's `CLAUDE.md` or `AGENTS.md` so it discovers the library's capabilities before writing UI code:

```markdown
UI library capability index: https://jimka.github.io/typescript-ui/llms.txt
(offline: node_modules/@jimka/typescript-ui/llms.txt) — read before building any UI with @jimka/typescript-ui.
```

The manifest is a compact, machine-readable catalog of every component, layout, and data-layer class — task, import subpath, and one-line summary — so the assistant reuses what exists instead of reinventing it.

## Development setup

If you are working on the framework itself rather than consuming it:

```bash
git clone https://github.com/jimka/typescript-ui.git
cd typescript-ui
npm install
npm run dev
```

Open `http://localhost:8015`. The demo app renders a tabbed showcase of every layout manager and component.

If instead you are consuming a local checkout of this library from your own app (via a `file:` dependency), see [Linking a local library checkout](/recipes/local-development) for the required Vite configuration.

## Build commands

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on port 8015 (developer component showcase) |
| `npm -w packages/lib run build` | Production bundle of the component showcase to `packages/lib/dist/` |
| `npm run build:lib` | Library bundle (ESM + `.d.ts`) to `packages/lib/dist/lib/` |
| `npm run typecheck` | Strict TypeScript type check (no emit) |
| `npm run docs:dev` | Serve the documentation app locally |
| `npm run build:pages` | Build the full documentation site |
| `npm -w packages/lib run clean` | Delete `packages/lib/dist/` contents |

## Browser support

Tested on **Chrome** and **Firefox**. **Safari** compatibility is not verified.
