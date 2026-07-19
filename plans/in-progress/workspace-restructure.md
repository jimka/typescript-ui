---
touches-shared: [package.json, packages/lib/package.json]
---

# Workspace Restructure — Implementation Plan

## Overview

Convert this single-package repo into an **npm workspaces monorepo** ("clean move" variant) and scaffold a new, minimal docs app. Today the whole project is one package at the repo root: the library source at [`src/typescript/lib`](src/typescript/lib), a Vite dev/demo harness ([`src/typescript/main.ts`](src/typescript/main.ts) + 28 `*Panel.ts` + [`src/typescript/perf`](src/typescript/perf)), the TypeDoc + VitePress docs pipeline, and the tests, all governed by one [`package.json`](package.json), three `tsconfig*.json`, two `vite*.config.ts`, [`typedoc.json`](typedoc.json), [`typedoc-callable-plugin.mjs`](typedoc-callable-plugin.mjs), and [`scripts/llms`](scripts/llms).

The restructure moves **everything library-related into `packages/lib/`** — source, tests, all build/doc configs, the VitePress docs tree, and the dev/demo harness — and makes the **repo root a private workspace orchestrator** that builds nothing itself but delegates to workspaces. It then adds **`packages/docs/`**, a new minimal Vite app that consumes the built `@jimka/typescript-ui` package through the workspace symlink and reads the TypeDoc JSON model at build time. The library package **`@jimka/typescript-ui`** keeps its `name`, its full 23-subpath `exports` map, its `dist/lib` output shape, and its `files` array **byte-identical**, so no downstream consumer's `import` statements change.

The move is deliberately **edit-light**: because every lib config file moves *together with* the source tree it references, and each build script runs with its cwd inside `packages/lib`, nearly all relative paths inside those configs stay valid unchanged. The real edits are confined to the two `package.json` files, one added guard-alias block, the new `packages/docs` files, [`.gitignore`](.gitignore), and [`.github/workflows/docs.yml`](.github/workflows/docs.yml).

This plan is the **structural restructure plus a minimal building docs shell only**. The elaborate per-component documentation information architecture is a separate follow-up (`docs-app-component-pages.md`) — see Non-Goals.

---

## Architecture Decisions

### Workspace layout — "clean move"

Root `package.json` becomes a **private workspaces root** (`"private": true`, `"workspaces": ["packages/lib", "packages/docs"]`) that orchestrates but is never published. The current library becomes `packages/lib/` — its own package, still named `@jimka/typescript-ui`, still publishable (**not** marked `private`, **no** `workspaces` field). The entire lib toolchain moves *with* the source into `packages/lib/`: `tsconfig.json` / `tsconfig.lib.json` / `tsconfig.test.json`, `vite.config.ts` / `vite.lib.config.ts` / `vitest.config.ts`, the tsc-alias step (already inside `build:lib`), `typedoc.json`, `typedoc-callable-plugin.mjs`, `scripts/`, `eslint.config.js`, `llms.txt`, `LICENSE-FONTAWESOME.md`, `index.html`, and the `tests/` and `docs/` trees. Because config + referenced tree move as a unit and scripts run with cwd `packages/lib`, the relative paths inside them (`src/typescript/lib/...`, `docs/api`, `scripts/llms/...`) resolve unchanged. **Rationale:** moving the config alongside the code it points at is what keeps this a near-mechanical `git mv` instead of a path-rewrite of dozens of fields.

### The library package preserves its published contract exactly

`packages/lib/package.json` is the *current* root `package.json` verbatim except for provenance — same `name`, `version`, `exports` (all 23 subpaths → `dist/lib/*.es.js` + `dist/lib/types/**`), `files: ["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md"]`, `sideEffects`, `scripts`, `dependencies`, `devDependencies`, `peerDependencies`. All `exports`/`files` paths are package-root-relative, so with the package root now at `packages/lib/` and the build writing to `packages/lib/dist/lib`, the map still resolves. **Rationale:** the hard invariant is that consumers see no change; the cheapest way to guarantee that is to not touch the fields that define the surface.

### The VitePress docs tree lives under the lib package

The `docs/` tree (hand-authored markdown + [`docs/.vitepress/config.mts`](docs/.vitepress/config.mts)) and the TypeDoc pipeline are tightly coupled: `docs:api` (TypeDoc) generates markdown + the sidebar + the ~105 MB JSON model *into* `docs/api`, and `docs:llms` reads `docs/api/typedoc-model.json` and probes `docs/components/*.md`. Moving `docs/` into `packages/lib/docs/` keeps `typedoc.json`'s `out: docs/api` / `json: docs/api/typedoc-model.json` / `docsRoot: docs`, the VitePress config's relative sidebar read, and `generate.mjs`'s `docs/public/llms.txt` output all valid **without edits** (cwd = `packages/lib`). **Rationale:** co-locating the self-documentation with the package it documents dissolves the cross-package path problem entirely; the alternative (docs at root, typedoc in `packages/lib`) forces brittle `../../docs` references.

### The docs app consumes the *built* package via the workspace symlink — no publish

`packages/docs/` depends on `@jimka/typescript-ui` (declared `"@jimka/typescript-ui": "*"`). `npm ci` at the workspace root creates a `node_modules/@jimka/typescript-ui` symlink → `packages/lib/`, so `import { Button } from "@jimka/typescript-ui/component/button"` in the docs app resolves through the **same `exports` map real consumers use**, landing on `packages/lib/dist/lib/component/button.es.js`. There is **no `npm publish` anywhere** — the workspace symlink plus the `exports` map resolves the built artifact directly. **Consequence:** `build:lib` must run before the docs app builds (encoded in CI order). **Rationale:** exercising the real published resolution path in-repo de-risks the follow-up and catches any `exports`-map breakage immediately.

### The dev/demo harness stays inside `packages/lib` (Decision 3, Option B)

The demo app (`main.ts` + 28 `*Panel.ts` + `perf/` + `index.html` + `vite.config.ts`) moves into `packages/lib` and stays a **dev-only** app there (it is not in the `files` array, so it never ships). `npm run dev` → `npm -w packages/lib run dev` serves it via the existing `vite.config.ts`, whose `@jimka/typescript-ui/*` aliases resolve to **lib source** (`.ts`) — preserving HMR-against-source and today's exact dev behaviour. **Rejected — Option A (migrate the harness into `packages/docs`):** the docs app is deliberately a *built-dist* consumer (previous decision); folding a source-aliased demo into it would contradict that and couple two resolution modes in one app. **Rejected — a third `packages/playground`:** more scaffolding (own `package.json`, aliases reaching back into `../lib/src`, a declared lib dep) for no benefit this restructure needs. The 28-panel → showcase migration is deferred to the follow-up; the interim home is `packages/lib`, where `npm run dev` keeps working.

### `vite.lib.config.ts` gets explicit `@jimka/*` → source aliases (workspace-symlink guard)

Today's lib source imports its own sibling subpaths (`@jimka/typescript-ui/core`, etc. — e.g. [`layout/Border.ts`](src/typescript/lib/layout/Border.ts), [`component/button/Button.ts`](src/typescript/lib/component/button/Button.ts)), and the Vite lib build currently resolves these to **source** (verified: with `dist/lib` deleted, `vite build --config vite.lib.config.ts` still succeeds). Once workspaces adds a `node_modules/@jimka/typescript-ui` → `packages/lib` symlink, Vite's bare-specifier resolution *could* start preferring that symlink's `exports` (→ `dist/lib`, i.e. the build's own stale output) over source. To make resolution deterministic and identical to today, **add the same `@jimka/typescript-ui/*` → source alias block that `vite.config.ts` already carries** to `vite.lib.config.ts`. **Rationale:** an explicit alias wins over node resolution, so the lib build provably bundles source regardless of the symlink — a one-block, well-justified safeguard, not a behaviour change.

### Pages is swapped atomically; VitePress is retained but dropped from CI

The GitHub Pages deploy currently builds VitePress (`docs:build`) and uploads `docs/.vitepress/dist`. This plan repoints CI to build `packages/docs` and upload `packages/docs/dist`, in the **same workflow edit** that stops building VitePress — an atomic swap, so a green Pages run is never left half-migrated. VitePress source (`packages/lib/docs/**`, its config, the `docs:build` script, and the `NODE_OPTIONS` heap pin) is **retained**, not deleted: it stays buildable locally and is the reference material the follow-up IA plan mines. The public URL stays `https://jimka.github.io/typescript-ui/` because `packages/docs` sets Vite `base: '/typescript-ui/'`. **Consequence:** between this plan and the follow-up, the deployed site is the minimal shell (rich hand-authored content is retained in-repo but not deployed) — an accepted, temporary tradeoff of retiring VitePress. **Rationale:** an atomic artifact-path swap is the only sequencing that satisfies "Pages never broken between commits" while the shell has less content than VitePress.

---

## Public API

**No public API changes.** The library's `name`, `exports` map, and type surface are preserved byte-identical; this is a hard invariant, verified below. No consumer `import` specifier changes.

---

## Ordered Implementation Steps

Do the moves with `git mv` (preserves history; keeps the tree tracked). Run each checkpoint before proceeding. All commands assume repo root unless stated.

### Phase 1 — Create the workspace skeleton

1. **Create `packages/lib/` and `packages/docs/` directories.** `mkdir -p packages/lib packages/docs/src`.

2. **Move the library source, tests, and dev harness into `packages/lib`:**
   - `git mv src packages/lib/src`
   - `git mv tests packages/lib/tests`
   - `git mv index.html packages/lib/index.html`
   - Checkpoint: `ls packages/lib/src/typescript/lib/core/index.ts` exists; `ls packages/lib/src/typescript/main.ts` exists.

3. **Move all lib configs and tooling into `packages/lib` (edit-in-place happens in later steps, not here):**
   - `git mv tsconfig.json tsconfig.lib.json tsconfig.test.json packages/lib/`
   - `git mv vite.config.ts vite.lib.config.ts vitest.config.ts packages/lib/`
   - `git mv typedoc.json typedoc-callable-plugin.mjs packages/lib/`
   - `git mv eslint.config.js packages/lib/`
   - `git mv scripts packages/lib/scripts`
   - `git mv llms.txt packages/lib/llms.txt`
   - `git mv LICENSE-FONTAWESOME.md packages/lib/LICENSE-FONTAWESOME.md`
   - Note: `typedoc.html.json` at the repo root is **untracked** (a scratchpad artifact) — leave it; do not move it.

4. **Move the VitePress docs tree into `packages/lib`:**
   - `git mv docs packages/lib/docs`
   - Checkpoint: `ls packages/lib/docs/.vitepress/config.mts` exists.

### Phase 2 — Split `package.json`

5. **Create `packages/lib/package.json` as the current root `package.json` verbatim.** Copy the existing root `package.json` content into `packages/lib/package.json` unchanged — same `name`, `version`, `exports`, `files`, `sideEffects`, `scripts`, `dependencies`, `devDependencies`, `peerDependencies`, `peerDependenciesMeta`, `type`, `description`, `license`. Do **not** add `"private"` and do **not** add a `workspaces` field.
   - Checkpoint (byte-identical surface): `diff <(git show HEAD:package.json | jq -S '{name,exports,files,sideEffects}') <(jq -S '{name,exports,files,sideEffects}' packages/lib/package.json)` — expect **empty output**.

6. **Rewrite the root `package.json` as a private orchestrator.** Replace its content with:
   ```json
   {
     "name": "@jimka/typescript-ui-monorepo",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "workspaces": ["packages/lib", "packages/docs"],
     "scripts": {
       "dev": "npm -w packages/lib run dev",
       "build:lib": "npm -w packages/lib run build:lib",
       "typecheck": "npm -w packages/lib run typecheck",
       "test": "npm -w packages/lib run test",
       "lint": "npm -w packages/lib run lint",
       "docs:api": "npm -w packages/lib run docs:api",
       "docs:llms": "npm -w packages/lib run docs:llms",
       "docs:build": "npm -w packages/lib run docs:build",
       "build:docs": "npm -w packages/docs run build",
       "build:pages": "npm run build:lib && npm run docs:api && npm run build:docs"
     }
   }
   ```
   Keep the root `.npmrc` (`legacy-peer-deps=true`) at the repo root — it applies workspace-wide.

7. **Reinstall to materialise the workspace symlink.** Remove the old root `node_modules` and `package-lock.json`, then `npm ci` is not valid pre-lock; run `npm install` once to regenerate the lockfile with the workspace graph. Verify the self-symlink: `ls -la node_modules/@jimka/typescript-ui` → points to `packages/lib`.
   - Checkpoint: `npm -w packages/lib run typecheck` passes (proves `~/*` + `@jimka/*` tsconfig aliases still resolve to source under the new path).

### Phase 3 — Guard the lib build resolution

8. **Add the `@jimka/typescript-ui/*` → source alias block to `packages/lib/vite.lib.config.ts`.** Copy the alias entries from `packages/lib/vite.config.ts` (the `@jimka/typescript-ui/component/*`, bare-subpath, and `glyphs` regex aliases, each `sub(...)`-style resolving to `src/typescript/lib/...`) into `vite.lib.config.ts`'s `resolve.alias`, keeping its existing `~` alias. Use the same `fileURLToPath(new URL('./src/typescript/lib/...', import.meta.url))` form so paths are relative to the config file.
   - Checkpoint (from clean output): `rm -rf packages/lib/dist/lib && npm -w packages/lib run build:lib`, then confirm the emitted files match the `exports` map: `ls packages/lib/dist/lib/core.es.js packages/lib/dist/lib/types/core/index.d.ts` exist, and `ls packages/lib/dist/lib/*.es.js | wc -l` is unchanged from a pre-move baseline.

### Phase 4 — Scaffold the minimal docs app

9. **Create `packages/docs/package.json`:**
   ```json
   {
     "name": "@jimka/typescript-ui-docs",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview"
     },
     "dependencies": {
       "@jimka/typescript-ui": "*"
     },
     "devDependencies": {
       "vite": "^8.0.16"
     }
   }
   ```

10. **Create `packages/docs/vite.config.ts`** with `base: '/typescript-ui/'` and a small build-time plugin that reads the TypeDoc JSON model and exposes only a summary count (never the 105 MB blob) as a virtual module:
    ```ts
    import { defineConfig, type Plugin } from 'vite'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath, URL } from 'node:url'

    const MODEL = fileURLToPath(new URL('../lib/docs/api/typedoc-model.json', import.meta.url))
    const VIRTUAL = 'virtual:typedoc-summary'

    // Reads the TypeDoc JSON model at build time and emits ONLY a small summary
    // (module + documented-symbol counts). The full ~105 MB model never enters
    // the client bundle. Proves the docs app can load the model — the seam the
    // follow-up per-symbol IA builds on.
    function typedocSummary(): Plugin {
      return {
        name: 'typedoc-summary',
        resolveId: (id) => (id === VIRTUAL ? '\0' + VIRTUAL : null),
        load(id) {
          if (id !== '\0' + VIRTUAL) return null
          let model
          try {
            model = JSON.parse(readFileSync(MODEL, 'utf8'))
          } catch {
            throw new Error(`TypeDoc model not found at ${MODEL} — run \`npm run docs:api\` first.`)
          }
          const modules = model.children ?? []
          const symbols = modules.reduce((n: number, m: any) => n + (m.children?.length ?? 0), 0)
          return `export const moduleCount = ${modules.length};\nexport const symbolCount = ${symbols};\n`
        },
      }
    }

    export default defineConfig({
      base: '/typescript-ui/',
      plugins: [typedocSummary()],
      build: { outDir: 'dist', emptyOutDir: true },
    })
    ```

11. **Create `packages/docs/index.html`** with `<div id="app"></div>` and `<script type="module" src="/src/main.ts"></script>`.

12. **Create `packages/docs/src/main.ts`** that imports at least one component from the built package and renders it, and displays the model counts — proving both the `exports`-map consumption and the model read:
    ```ts
    import { Body } from '@jimka/typescript-ui/core'
    import { Label } from '@jimka/typescript-ui/component/display'
    import { moduleCount, symbolCount } from 'virtual:typedoc-summary'

    const body = Body.getInstance()
    body.add(new Label({ text: `typescript-ui docs — ${moduleCount} modules, ${symbolCount} documented symbols` }))
    ```
    Adjust the exact component/API to a valid current constructor if `Label`/`Body.add` differ — the implementer must confirm against `packages/lib/src/typescript/lib/core/index.ts` and `component/display/index.ts` that the chosen component imports and renders; the requirement is only "import + render one real component from `@jimka/typescript-ui`."

13. **Create `packages/docs/tsconfig.json`** (minimal): `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "types": [] }, "include": ["src", "vite.config.ts"] }`. Add an ambient `declare module 'virtual:typedoc-summary'` in a `packages/docs/src/env.d.ts` so the virtual import typechecks.
    - Checkpoint: `npm run build:lib && npm run docs:api && npm -w packages/docs run build` → `packages/docs/dist/index.html` exists and the build logged the counts without error.

### Phase 5 — gitignore, CI, and docs pointers

14. **Update `.gitignore`** for the relocated generated paths: change `docs/api` → `packages/lib/docs/api`, `docs/.vitepress/dist` → `packages/lib/docs/.vitepress/dist`, `docs/.vitepress/cache` → `packages/lib/docs/.vitepress/cache`, `docs/public/llms.txt` → `packages/lib/docs/public/llms.txt`. The bare `dist` entry already covers `packages/lib/dist` and `packages/docs/dist`; `coverage` and `node_modules` are unchanged. Keep `.worktrees/`.

15. **Update `.github/workflows/docs.yml`** — atomic swap of the build + artifact:
    - Replace the single `- run: npm run docs:build` step with three steps (keeping the `NODE_OPTIONS` env on the TypeDoc + docs build steps, since TypeDoc still emits the ~105 MB model):
      ```yaml
      - run: npm run build:lib
      - run: npm run docs:api
        env:
          NODE_OPTIONS: --max-old-space-size=12288
      - run: npm run build:docs
        env:
          NODE_OPTIONS: --max-old-space-size=12288
      ```
    - Change `upload-pages-artifact` `path:` from `docs/.vitepress/dist` to `packages/docs/dist`.
    - Keep the `master`/`workflow_dispatch` triggers, the `permissions`/`concurrency` blocks, `configure-pages`, `upload-pages-artifact`, `deploy-pages`, and the `deploy` job unchanged.
    - Leave a comment noting the `NODE_OPTIONS` pin and the retained `docs:build` (VitePress) script are removable once VitePress source is deleted in the follow-up.

16. **Update documentation pointers** (see Documentation Impact): the `llms.txt` link in root [`CLAUDE.md`](CLAUDE.md) → `packages/lib/llms.txt`, and any `npm run` path references in [`README.md`](README.md) that assume a root single package.

### Phase 6 — Full verification

17. Run the full Verification checklist below from a clean install.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `package.json` (rewrite as private workspace orchestrator) |
| Create | `packages/lib/package.json` (current root `package.json`, verbatim) |
| Move | `src/` → `packages/lib/src/` |
| Move | `tests/` → `packages/lib/tests/` |
| Move | `docs/` → `packages/lib/docs/` |
| Move | `scripts/` → `packages/lib/scripts/` |
| Move | `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.test.json` → `packages/lib/` |
| Move | `vite.config.ts`, `vite.lib.config.ts`, `vitest.config.ts` → `packages/lib/` |
| Move | `typedoc.json`, `typedoc-callable-plugin.mjs` → `packages/lib/` |
| Move | `eslint.config.js`, `index.html`, `llms.txt`, `LICENSE-FONTAWESOME.md` → `packages/lib/` |
| Modify | `packages/lib/vite.lib.config.ts` (add `@jimka/*` → source alias block) |
| Create | `packages/docs/package.json` |
| Create | `packages/docs/vite.config.ts` |
| Create | `packages/docs/index.html` |
| Create | `packages/docs/src/main.ts` |
| Create | `packages/docs/src/env.d.ts` |
| Create | `packages/docs/tsconfig.json` |
| Modify | `.gitignore` (relocate generated `docs/*` ignore paths under `packages/lib/`) |
| Modify | `.github/workflows/docs.yml` (build order + artifact path) |
| Modify | `CLAUDE.md` (`llms.txt` pointer → `packages/lib/llms.txt`) |
| Modify | `README.md` (path references, if any) |
| Regenerate | `package-lock.json` (workspace graph) |

No source files under `packages/lib/src/typescript/lib` are edited; no consumer-facing surface changes.

---

## Expected Behaviour

Concrete, checkable outcomes (all manually/CLI-verifiable — this restructure adds no unit-testable logic):

- **Published surface unchanged.** `packages/lib/package.json`'s `name` is `@jimka/typescript-ui`; its `exports` has the same 23 subpath keys mapping to `./dist/lib/*.es.js` + `./dist/lib/types/**`; its `files` is `["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md"]` — all byte-identical to the pre-move root `package.json`.
- **Library builds to the same shape.** `npm run build:lib` emits `packages/lib/dist/lib/core.es.js` … and `packages/lib/dist/lib/types/core/index.d.ts` …, matching every `exports` target, from a clean `dist/lib`.
- **Existing test/typecheck/lint suites pass** unchanged: `npm run typecheck`, `npm test`, `npm run lint` all green (they run inside `packages/lib` via delegation).
- **Dev app still runs.** `npm run dev` serves the demo harness on port 8015 with all 28 tabs, HMR against lib source.
- **Docs app builds and consumes the built package.** `npm run build:pages` produces `packages/docs/dist/index.html`; the page imports and renders a real `@jimka/typescript-ui` component and displays non-zero module/symbol counts read from the TypeDoc model.
- **Pages base preserved.** `packages/docs/dist` asset URLs are prefixed `/typescript-ui/`, so the deployed site URL stays `https://jimka.github.io/typescript-ui/`.
- **Self-imports resolve to source in the lib build** regardless of the workspace symlink (guaranteed by the added `@jimka/*` aliases in `vite.lib.config.ts`).
- **VitePress still builds locally.** `npm run docs:build` produces `packages/lib/docs/.vitepress/dist` (retained, not deployed by CI).

---

## Verification

From a clean checkout of the branch:

1. **Install + symlink:** `rm -rf node_modules package-lock.json && npm install` → succeeds; `ls -la node_modules/@jimka/typescript-ui` resolves to `packages/lib`.
2. **Surface invariant (byte-identical `name` + `exports` + `files`):**
   `diff <(git show HEAD~N:package.json | jq -S '{name,exports,files,sideEffects}') <(jq -S '{name,exports,files,sideEffects}' packages/lib/package.json)` → **empty** (with `HEAD~N` = the pre-restructure commit).
3. **Library build (from clean):** `rm -rf packages/lib/dist && npm run build:lib` → succeeds; spot-check `node -e "import('@jimka/typescript-ui/core').then(m=>console.log(Object.keys(m).length))"` prints a count (proves `exports` resolution end-to-end).
4. **Typecheck / tests / lint:** `npm run typecheck && npm test && npm run lint` → all green.
5. **Dev app:** `npm run dev`, open `http://localhost:8015`, confirm the tab strip renders and a couple of panels open (manual — UI/geometry, not unit-testable).
6. **Full Pages build:** `npm run build:pages` → `packages/docs/dist/index.html` exists; grep the built HTML/JS for the base prefix `/typescript-ui/` on asset URLs; open `packages/docs/dist` under a static server with that base and confirm the rendered component + counts appear (manual).
7. **VitePress still works:** `npm run docs:build` → `packages/lib/docs/.vitepress/dist/index.html` exists.
8. **Dry CI parity:** run the three workflow commands in order (`npm run build:lib`, `npm run docs:api`, `npm run build:docs`) from a clean `npm ci` to mirror the runner.

---

## Documentation Impact

- **`llms.txt` relocates to `packages/lib/llms.txt`** (required — it is in the lib's `files` array, so it must sit inside the package root for publish; `generate.mjs` already writes it there when run with cwd `packages/lib`). Update the pointer in root [`CLAUDE.md`](CLAUDE.md) (`[llms.txt](llms.txt)` → `[packages/lib/llms.txt](packages/lib/llms.txt)`). The library-capability-index guidance is unchanged; only the path moves.
- **`README.md`** — audit for `npm run` examples or paths that assume a single root package; update any that break (e.g. references to `src/typescript`). The `build:lib` → `dist/lib/` row stays accurate relative to the lib package.
- **No public-API doc pages change** — no exported symbol is renamed, added, or removed, so the TypeDoc-generated component/layout pages and the `docs:llms` catalog are unaffected in content (only their generation cwd moves).
- The rich VitePress content under `packages/lib/docs/**` is retained but **not deployed** until the follow-up; this is called out in Non-Goals so the gap is intentional, not a regression to chase.

---

## Potential Challenges

- **sqladmin (external consumer) migrates to the *published* npm package — not an in-repo symlink repoint.** sqladmin today consumes `@jimka/typescript-ui` via a `file:../../typescript-ui` dependency that npm resolves as a symlink to this repo's built `dist/lib`. Rather than repoint that symlink at `packages/lib/`, sqladmin switches to the **published** `@jimka/typescript-ui@^0.1.0` from npm — owned by the follow-up plan `publish-0-1-0.md`, which covers both the publish and the sqladmin dependency swap. **Consequence:** this restructure introduces **no** cross-repo coupling to fix; the sqladmin migration is sequenced *after the publish*, not after this plan, and the previously-feared "sqladmin resolves to a non-package directory" window never occurs. (Do not touch sqladmin from this repo.)
- **Workspace symlink could shadow lib self-imports to stale `dist`.** Mitigated by the explicit `@jimka/*` → source aliases added to `vite.lib.config.ts` (Architecture Decision); verify with the clean-`dist` build check (Step 8).
- **TypeDoc model is ~105 MB.** The docs-app plugin reads it in Node at build time (fine) but must never inline it into the client bundle — the plugin returns only counts. TypeDoc generation itself remains memory-heavy, so the `NODE_OPTIONS=--max-old-space-size=12288` pin stays on the `docs:api` CI step.
- **`npm install` vs `npm ci` at conversion time.** The existing `package-lock.json` predates the workspace graph, so the first conversion needs `npm install` to regenerate the lock; CI keeps using `npm ci` afterward against the regenerated lock. Commit the regenerated `package-lock.json`.
- **Deployed-site content shrinks to the shell between this plan and the follow-up.** Accepted tradeoff of the atomic VitePress→docs-app swap; the rich content is retained in-repo and restored by `docs-app-component-pages.md`.
- **`.gitignore` paths for generated docs output** must be relocated (Step 14) or the ~105 MB model and VitePress dist could get accidentally committed.

---

## Critical Files

- [`package.json`](package.json) — the surface being split; its `exports`/`files`/`name` are the preserved contract.
- [`tsconfig.json`](tsconfig.json) — the `~/*` (lib-internal) and `@jimka/typescript-ui/*` (consumer-style → source) path aliases; both stay valid post-move (relative to `packages/lib`).
- [`vite.config.ts`](vite.config.ts) — the dev/test alias block whose `@jimka/*` → source entries the guard step copies into `vite.lib.config.ts`.
- [`vite.lib.config.ts`](vite.lib.config.ts) — the lib bundle build; the only lib config edited (alias guard).
- [`typedoc.json`](typedoc.json) + [`typedoc-callable-plugin.mjs`](typedoc-callable-plugin.mjs) — the model/markdown generator; relative `entryPoints`/`tsconfig`/`plugin`/`out` all preserved by moving with the tree.
- [`scripts/llms/generate.mjs`](scripts/llms/generate.mjs) — reads `docs/api/typedoc-model.json`, writes `llms.txt` + `docs/public/llms.txt`; all cwd-relative, preserved.
- [`docs/.vitepress/config.mts`](docs/.vitepress/config.mts) — VitePress config with `base: '/typescript-ui/'`, the base the new docs app must match.
- [`.github/workflows/docs.yml`](.github/workflows/docs.yml) — the Pages pipeline being repointed.

---

## Non-Goals

- **The full documentation information architecture** — category tree, per-component pages (showcase + API + recommended usage), per-symbol slicing of the TypeDoc JSON, resizable layout-manager demos with child components, automated coverage tracking from the JSON registry — is **out of scope**. It is the separate follow-up plan **`docs-app-component-pages.md`**. This plan delivers only a minimal building shell that proves the seam (import + render one component; read the model at build time).
- **Migrating the 28 `*Panel.ts` demo files into the docs app as showcases** — deferred to the follow-up; their interim home is `packages/lib` where `npm run dev` keeps them runnable.
- **Deleting VitePress** (`packages/lib/docs/**`, its config, the `docs:build` script, the `NODE_OPTIONS` heap pin) — retained as follow-up reference material; removal is a later step once the docs app reaches content parity.
- **Editing sqladmin** — sqladmin's move onto the published `@jimka/typescript-ui@^0.1.0` is owned by `publish-0-1-0.md`, not this plan.
- **The CLI scaffolder package** (`packages/create-app`, `@jimka/create-tsui-app`) — a third workspace sibling added by the follow-up plan `create-tsui-app.md`. This plan scaffolds only `packages/lib` + `packages/docs`; the root `workspaces` array (Step 6) is the extension point where the third package is later appended. Do **not** pre-add its entry here — an entry for a nonexistent `packages/create-app` dir would break `npm install`.
