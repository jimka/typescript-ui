# npm Package Publishing — Implementation Plan

## Overview

The codebase already has significant scaffolding for library publishing: `package.json` defines `main`, `module`, `types`, and an `exports` map; `vite.lib.config.ts` configures Vite library mode; and `tsconfig.lib.json` is configured to emit only declarations. The work is mostly refinement and gap-filling rather than greenfield setup.

Key characteristics:
- All styling is CSS-custom-property-based, injected at runtime via `ThemeManager.setTheme()`. There are no `.css` files to bundle or distribute.
- The framework has zero runtime npm dependencies.
- Library entry is `src/typescript/Base/index.ts` exporting ~80 public symbols.
- Build is already split: `vite build` (app/demo) vs. `vite build --config vite.lib.config.ts` (library).

---

## Package Configuration Decisions

### Build output formats

**Produce both ESM and UMD.** The current `vite.lib.config.ts` already does this (`formats: ['es', 'umd']`):
- ESM (`typescript-ui.es.js`) for Vite/Rollup/webpack 5 consumers using tree-shaking
- UMD (`typescript-ui.umd.js`) for CJS-style environments and legacy script-tag usage

A separate CJS format is unnecessary — UMD is a superset of CJS.

### TypeScript declarations

Generate `.d.ts` files via `tsc -p tsconfig.lib.json` (already in the `build:lib` script). Gaps to fix:
1. Add `"declarationMap": true` so IDE "Go to Definition" navigates to original `.ts` source.
2. Confirm `declarationDir` matches what the `exports` map and `types` field reference (`dist/lib/types/index.d.ts`).

### CSS bundling

**None needed.** All theming is injected via `CSS.setRootVariables()` at runtime by `ThemeManager.setTheme()`. Consumers must call `ThemeManager.setTheme(DefaultTheme)` once on startup — this replaces the traditional "import the framework CSS" step. The README must document this prominently.

### `package.json` — `exports` map

Add a `types` condition and `default` fallback for maximum compatibility:

```json
"exports": {
  ".": {
    "types":   "./dist/lib/types/index.d.ts",
    "import":  "./dist/lib/typescript-ui.es.js",
    "require": "./dist/lib/typescript-ui.umd.js",
    "default": "./dist/lib/typescript-ui.es.js"
  }
}
```

The `types` condition must appear before `import`/`require` in the object (TypeScript 5+ with `"moduleResolution": "bundler"` or `"node16"/"nodenext"`).

### `files` field

`"files": ["dist/lib"]` is correct — only the compiled library output is published. Keep it and complement with `.npmignore` for defence-in-depth.

### `sideEffects`

`"sideEffects": false` is correct. Merely importing the library does not write to the DOM — consumers must explicitly call `setTheme()`. This is safe and beneficial for tree-shaking.

### `peerDependencies`

FontAwesome is already an optional peer. No change needed.

---

## Build Setup Changes

### `vite.lib.config.ts` — add `emptyOutDir` and `rollupOptions`

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        lib: {
            entry   : 'src/typescript/Base/index.ts',
            name    : 'TypescriptUI',
            formats : ['es', 'umd'],
            fileName: (format) => `typescript-ui.${format}.js`,
        },
        outDir    : 'dist/lib',
        emptyOutDir: true,         // ensures stale files are cleared
        sourcemap : true,
        minify    : 'oxc',
        rollupOptions: {
            external: [],          // no npm deps to externalize today
            output  : { globals: {} },
        },
    },
});
```

`emptyOutDir: true` prevents stale `.d.ts` files from renamed or deleted source modules accumulating between builds.

### `tsconfig.lib.json` — add `declarationMap` and tighten paths

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration"        : true,
    "declarationDir"     : "dist/lib/types",
    "declarationMap"     : true,
    "emitDeclarationOnly": true,
    "rootDir"            : "src/typescript/Base",
    "outDir"             : "dist/lib/types"
  },
  "include": ["src/typescript/Base/**/*"]
}
```

### `package.json` script changes

Change `build:lib` to clean before building:

```json
"build:lib":      "rimraf dist/lib && tsc -p tsconfig.lib.json && vite build --config vite.lib.config.ts",
"prepublishOnly": "npm run build:lib"
```

`prepublishOnly` ensures the library is always rebuilt before `npm publish`.

### `.npmignore`

```
src/
*.config.ts
*.config.js
tsconfig*.json
.trunk/
.vscode/
.claude/
graphify-out/
tests/
```

---

## Versioning Strategy

Use **Semantic Versioning** (`MAJOR.MINOR.PATCH`):
- Component additions or new exports → `MINOR` bump
- Any removal or rename of an exported symbol → `MAJOR` bump
- Bug fixes with no API change → `PATCH` bump

Tag releases in git with `v1.0.0` etc. and maintain a `CHANGELOG.md`.

For a scoped package (`@jika/typescript-ui`), `npm publish --access public` is required on the first publish (scoped packages default to private on npm).

---

## Ordered Implementation Steps

1. **Verify the current build works end-to-end.** Run `npm run build:lib` and confirm `dist/lib/` contains `typescript-ui.es.js`, `typescript-ui.umd.js`, and `dist/lib/types/index.d.ts`.

2. **Fix `tsconfig.lib.json`.** Add `"declarationMap": true` and `"outDir": "dist/lib/types"`. Re-run `tsc -p tsconfig.lib.json` to confirm `.d.ts.map` files appear.

3. **Update `vite.lib.config.ts`.** Add `emptyOutDir: true` and the `rollupOptions` block. Rebuild and verify output is clean.

4. **Update `package.json`.**
   - Add `"types"` condition to the `exports` map (before `import`/`require`).
   - Update `build:lib` to include `rimraf dist/lib &&`.
   - Add `"prepublishOnly": "npm run build:lib"`.
   - Confirm `"files": ["dist/lib"]` is present.

5. **Create `.npmignore`.** Exclude source dirs, config files, and tooling dirs.

6. **Update `README.md`.** Add a "Getting Started" section covering:
   - `npm install @jika/typescript-ui`
   - The mandatory `ThemeManager.setTheme(DefaultTheme)` call
   - A minimal usage example with `Body`, `HBox`, and `Button`
   - TypeScript version requirements (5+ recommended; 4.7+ minimum with `"moduleResolution": "node16"`)

7. **Dry-run publish.** Run `npm pack --dry-run` and inspect the file list to confirm only `dist/lib/` and top-level metadata files (`package.json`, `README.md`, `LICENSE`) are included.

8. **Publish.** Run `npm publish --access public` for the public npm registry, or update `.npmrc` for a private registry.

---

## Resulting `package.json` Structure

```json
{
  "name": "@jika/typescript-ui",
  "version": "1.0.0",
  "description": "A web-based layout manager and UI component framework written in TypeScript.",
  "license": "LicenseRef-PolyForm-Noncommercial-1.0.0",
  "main":   "dist/lib/typescript-ui.umd.js",
  "module": "dist/lib/typescript-ui.es.js",
  "types":  "dist/lib/types/index.d.ts",
  "exports": {
    ".": {
      "types":   "./dist/lib/types/index.d.ts",
      "import":  "./dist/lib/typescript-ui.es.js",
      "require": "./dist/lib/typescript-ui.umd.js",
      "default": "./dist/lib/typescript-ui.es.js"
    }
  },
  "files": ["dist/lib"],
  "sideEffects": false,
  "scripts": {
    "dev":           "vite",
    "build":         "vite build",
    "build:lib":     "rimraf dist/lib && tsc -p tsconfig.lib.json && vite build --config vite.lib.config.ts",
    "prepublishOnly":"npm run build:lib",
    "preview":       "vite preview",
    "typecheck":     "tsc --noEmit",
    "doc":           "typedoc --out dist/docs src/typescript",
    "clean":         "rimraf dist/*"
  },
  "peerDependencies": {
    "@fortawesome/fontawesome-free": ">=5.0.0"
  },
  "peerDependenciesMeta": {
    "@fortawesome/fontawesome-free": { "optional": true }
  },
  "devDependencies": {
    "concurrently": "^6.3.0",
    "rimraf": "^3.0.2",
    "typedoc": "^0.27.0",
    "typescript": "^6.0.3",
    "vite": "^8.0.0"
  }
}
```

---

## Key Design Decisions Summary

| Question | Decision | Reason |
|---|---|---|
| Output formats | ESM + UMD | ESM for modern bundlers with tree-shaking; UMD covers CJS/legacy |
| TypeScript declarations | `tsc --emitDeclarationOnly` into `dist/lib/types/` | Separates declarations from JS; maps to `types` field |
| CSS bundling | None needed | All styles are JS-injected CSS custom properties via `ThemeManager` |
| `sideEffects` | `false` | Importing the module makes no DOM writes |
| Demo vs library build | Two separate Vite configs | `vite.config.ts` for the app/demo, `vite.lib.config.ts` for the npm package |
| `files` field | `["dist/lib"]` only | Whitelist approach; excludes source, config, and demo app output |

---

## Critical Files

- `/home/jika/typescript/typescript/package.json`
- `/home/jika/typescript/typescript/vite.lib.config.ts`
- `/home/jika/typescript/typescript/tsconfig.lib.json`
- `/home/jika/typescript/typescript/src/typescript/Base/index.ts`
