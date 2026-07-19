---
depends-on: [workspace-restructure, publish-0-1-0]
touches-shared: [package.json]
---

# `@jimka/create-tsui-app` Scaffolder — Implementation Plan

## Overview

Add a third workspace sibling, `packages/create-app/`, publishing the CLI package **`@jimka/create-tsui-app`**. Invoked as `npm create @jimka/tsui-app <target-dir>` (npm rewrites `create @jimka/tsui-app` → the `@jimka/create-tsui-app` package's `bin`), it writes a minimal, runnable typescript-ui starter to disk. The generated project's `package.json` declares `"@jimka/typescript-ui": "^0.1.0"` and installs it **from npm** — so this plan is only end-to-end testable after [`publish-0-1-0.md`](plans/publish-0-1-0.md) lands `0.1.0`.

This plan sits on top of two others. It consumes the npm-workspaces monorepo established by [`workspace-restructure.md`](plans/workspace-restructure.md) — the private root orchestrator ([package.json](package.json)) with its explicit `workspaces` array (`["packages/lib", "packages/docs"]`, restructure Step 6), whose Non-Goal bullet ([workspace-restructure.md:328](plans/workspace-restructure.md#L328)) explicitly reserves `packages/create-app` / `@jimka/create-tsui-app` as the third sibling this plan appends. The generated starter mirrors the `packages/docs` scaffold shape (restructure Steps 9–13). It mirrors [`publish-0-1-0.md`](plans/publish-0-1-0.md)'s scoped-public publish conventions (`publishConfig.access: public`) for publishing the scaffolder itself.

The **one shared-file edit** is appending `"packages/create-app"` to the root `workspaces` array — safe because `depends-on` sequences this plan after the restructure, so the directory exists when `npm install` reads the array.

---

## Architecture Decisions

### The CLI never imports the library — it only writes files

The scaffolder writes template files to disk; the *generated project* is what depends on `@jimka/typescript-ui`. The CLI's own `dependencies` are therefore **empty** (zero runtime deps). This is the standard `create-*` shape (Vite's `create-vite` ships templates as data, imports nothing from the framework) and keeps the published scaffolder tiny and framework-version-agnostic — it always writes `^0.1.0` regardless of its own version.

### Zero runtime dependencies — Node built-ins for args and prompts

Prompts and arg parsing use `node:util`'s `parseArgs` and `node:readline` only. **Rationale / precedent:** the repo's Node tooling is written as plain zero-dep ESM scripts ([scripts/llms/generate.mjs](scripts/llms/generate.mjs), [scripts/eslint/*.mjs](scripts/eslint)); there is **no** prompt library anywhere in the root `devDependencies` (no `prompts`/`inquirer`/`enquirer`). Adding one would introduce a precedent the repo doesn't have. The only interaction needed is "ask for the target dir when omitted" — a single `readline` question. (`vitest` is added as a **devDependency** for the unit tests; it does not ship and is not a runtime dep.)

### Plain ESM JavaScript, no build step

The CLI is authored as plain ESM `.js` (like [scripts/llms/generate.mjs](scripts/llms/generate.mjs) — the repo's convention for Node tooling), **not** TypeScript-plus-build. **Rationale:** a published `create-*` bin must run directly via `node` the moment npm fetches it; a build step would add a `prepublishOnly` compile and a gitignored `dist`. Because the source is committed and shipped as-is, the scaffolder needs **no build guard** (unlike `packages/lib`, whose `prepublishOnly` in [publish-0-1-0.md](plans/publish-0-1-0.md) exists only because its `dist/lib` is gitignored). The scoped-public `publishConfig` guard still applies.

### Templates are real files under `template/`, copied with a rename step

Starter files live as real files under `packages/create-app/template/` (not inlined heredocs), copied recursively to the target dir. The git-ignore file is stored as **`_gitignore`** and renamed to `.gitignore` on copy. **Rationale (known npm gotcha):** npm **force-excludes** a file literally named `.gitignore` from every published tarball regardless of the `files` array, so a template shipped as `.gitignore` would silently vanish from the published package; the `_gitignore` → `.gitignore` rename (the same convention `create-vite` uses) is the standard workaround. The `files` array ships `template/` and `bin/` (plus `index.js`) so the published scaffolder actually contains its templates. The nested `template/package.json` is inert data, **not** a workspace member, because the root `workspaces` array lists packages explicitly (not via glob).

### The generated starter mirrors `packages/docs`, rendering one real component

The starter is the minimal Vite-app shape the restructure's `packages/docs` establishes (`index.html` with `#app`, `src/main.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`), minus the docs-only TypeDoc virtual-module plumbing. `src/main.ts` imports and renders a **verified-current** component — mirroring the `FitPanel` idiom ([src/typescript/FitPanel.ts](src/typescript/FitPanel.ts)): `Body.getInstance().setLayoutManager(new Fit())` then `addComponent(new Header('…'))`. This is the same "import + render one real `@jimka/typescript-ui` component" requirement the restructure's docs `main.ts` step carries ([workspace-restructure.md:195](plans/workspace-restructure.md#L195)); `Fit` guarantees the single child fills the viewport, so the render is visibly correct without hardcoded sizes (leaning on library defaults per project conventions).

### The starter's `vite.config.ts` must preserve class/function names when minifying

**Critical, non-obvious.** typescript-ui derives every component's CSS class (and layout-serialization keys) from `this.constructor.name`; if the production minifier mangles class names, `constructor.name` returns a short/empty string and `classList.add("")` throws, **blanking the built page**. The library's own build configs guard this ([vite.config.ts:47-50](vite.config.ts#L47), [vite.lib.config.ts:67-69](vite.lib.config.ts#L67)). Vite 8 (Rolldown/oxc) minifies by default, so the generated `vite.config.ts` **must** carry the same `build.rollupOptions.output.minify` keepNames block, or `npm run build` produces a broken bundle. This is encoded verbatim in the template with an explanatory comment.

### The scaffolder is itself publishable — scoped-public, executable bin

A `create-*` tool must be on npm for `npm create` to fetch it. Mirror [publish-0-1-0.md](plans/publish-0-1-0.md)'s scoped-publish convention: `"publishConfig": { "access": "public" }` (scoped packages default to restricted; baking it in avoids a forgotten `--access public`). The `bin` entry (`bin/create-tsui-app.js`) carries a `#!/usr/bin/env node` shebang and is committed with the executable bit set.

### Initial version `0.0.1`

The scaffolder versions **independently** of the library — its version says nothing about which library version it scaffolds (it always writes `^0.1.0`). It ships as `0.0.1` to mark it honestly as a brand-new, minimal, unproven first cut, decoupled from the library's `0.1.0` line. (Rejected `0.1.0`: it would falsely imply lock-step with the library's version.)

### Root `workspaces` array gains `packages/create-app`

The one shared edit: append `"packages/create-app"` to the root [package.json](package.json) `workspaces` array (the extension point the restructure reserved). Safe because this plan is sequenced after the restructure via `depends-on`, so the directory exists when `npm install` reads the array. Do **not** touch the root `scripts` — the scaffolder's own scripts run via `npm -w packages/create-app run <script>`.

---

## Public API

The CLI exposes a `bin`, plus pure helpers exported from `index.js` for unit testing:

```js
// packages/create-app/index.js — exported pure helpers (no fs/prompt side effects)

/** Convert an arbitrary target-dir name into a valid npm package name. */
export function toValidPackageName(input: string): string

/** Map a template filename to its on-disk name (`_gitignore` → `.gitignore`). */
export function renameTemplateFile(name: string): string

/** True when a target directory's entry list permits scaffolding (empty). */
export function isEmpty(entries: string[]): boolean

/** Parse argv into `{ targetDir }` (undefined when omitted). Uses node:util parseArgs. */
export function parseCliArgs(argv: string[]): { targetDir: string | undefined }

// Side-effectful (not pure-unit-tested; exercised by the manual E2E path):
/** Write the template to `targetDir`, applying renames + package-name substitution. */
export async function scaffold(targetDir: string): Promise<void>
/** CLI entry: parse args, prompt if needed, call scaffold, print next steps. */
export async function main(argv: string[]): Promise<void>
```

`RENAME_MAP` (module-private): `{ _gitignore: '.gitignore' }`; `renameTemplateFile` returns the mapped name or the input unchanged.

---

## Internal Structure

`index.js` holds the pure helpers, the `scaffold` writer, and a `main`. `bin/create-tsui-app.js` is a thin executable wrapper:

```js
#!/usr/bin/env node
import { main } from '../index.js'
main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1) })
```

`scaffold(targetDir)` steps (side-effectful):
1. Resolve `targetDir` to an absolute path; read its entries if it exists.
2. If it exists and `!isEmpty(entries)` → throw `Error('target directory "<dir>" is not empty')`.
3. `mkdir` recursive; recursively copy `template/` → target, computing each destination filename via `renameTemplateFile` (so `_gitignore` lands as `.gitignore`).
4. Post-process the copied `package.json`: parse it, set `name` = `toValidPackageName(basename(targetDir))`, write it back (the single template-variable substitution).
5. Print next-step instructions (`cd <dir>`, `npm install`, `npm run dev`).

`main(argv)`: `const { targetDir } = parseCliArgs(argv)`; if `targetDir` is undefined, prompt once via `node:readline` (`Project directory:`); then `await scaffold(resolved)`.

The template dir is resolved relative to the module: `fileURLToPath(new URL('./template', import.meta.url))`.

---

## Ordered Implementation Steps

Prerequisite: `workspace-restructure` is merged (`packages/lib`, `packages/docs`, and the private root orchestrator exist). All paths are repo-root-relative unless stated.

### Phase 1 — Scaffolder package skeleton

1. **Create `packages/create-app/package.json`:**
   ```json
   {
     "name": "@jimka/create-tsui-app",
     "version": "0.0.1",
     "description": "Scaffold a minimal typescript-ui starter project.",
     "license": "LicenseRef-PolyForm-Noncommercial-1.0.0",
     "type": "module",
     "bin": { "create-tsui-app": "bin/create-tsui-app.js" },
     "files": ["index.js", "bin", "template"],
     "publishConfig": { "access": "public" },
     "engines": { "node": ">=20" },
     "scripts": {
       "test": "vitest run"
     },
     "dependencies": {},
     "devDependencies": {
       "vitest": "^4.1.9"
     }
   }
   ```
   (`dependencies` empty — the CLI uses Node built-ins only; `vitest` version mirrors root [package.json](package.json).)

2. **Create `packages/create-app/index.js`** with the pure helpers, `scaffold`, and `main` per `## Public API` and `## Internal Structure`. Use `node:util` `parseArgs` (in `parseCliArgs`), `node:fs` (`existsSync`, `readdirSync`, `mkdirSync`, `cpSync` with `{ recursive: true }` — or a manual recursive walk that applies `renameTemplateFile` per entry), `node:path`, `node:url` (`fileURLToPath`), and `node:readline` (in `main`). Every function carries a JSDoc comment per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
   - `toValidPackageName`: lowercase, trim, replace whitespace/invalid chars with `-`, strip leading `.`/`_` and leading/trailing `-` (npm name rules).
   - `renameTemplateFile`: return `RENAME_MAP[name] ?? name`.
   - `isEmpty`: `entries.length === 0`.
   - `parseCliArgs`: first positional → `targetDir`.

3. **Create `packages/create-app/bin/create-tsui-app.js`** (the shebang wrapper from `## Internal Structure`), then make it executable: `chmod +x packages/create-app/bin/create-tsui-app.js`. Confirm the bit is staged: `git update-index --chmod=+x packages/create-app/bin/create-tsui-app.js` if git didn't pick it up.

### Phase 2 — Template (the generated starter)

Create these under `packages/create-app/template/`, mirroring the `packages/docs` scaffold shape (restructure Steps 9–13):

4. **`template/package.json`** (placeholder `name` — overwritten by `scaffold`'s substitution):
   ```json
   {
     "name": "typescript-ui-app",
     "private": true,
     "version": "0.0.0",
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "vite build",
       "preview": "vite preview"
     },
     "dependencies": {
       "@jimka/typescript-ui": "^0.1.0"
     },
     "devDependencies": {
       "vite": "^8.0.16"
     }
   }
   ```
   (`vite ^8.0.16` matches root [package.json](package.json); `@jimka/typescript-ui ^0.1.0` per `publish-0-1-0`'s caret semantics.)

5. **`template/index.html`** — `#app` div + module script:
   ```html
   <!DOCTYPE html>
   <html>
     <head>
       <meta charset="UTF-8" />
       <title>typescript-ui app</title>
     </head>
     <body>
       <div id="app"></div>
       <script type="module" src="/src/main.ts"></script>
     </body>
   </html>
   ```

6. **`template/src/main.ts`** — import + render one real component (verified against [core/index.ts](src/typescript/lib/core/index.ts), [layout/index.ts](src/typescript/lib/layout/index.ts), [component/display/index.ts](src/typescript/lib/component/display/index.ts); mirrors [FitPanel.ts](src/typescript/FitPanel.ts)):
   ```ts
   import { Body } from '@jimka/typescript-ui/core'
   import { Fit } from '@jimka/typescript-ui/layout'
   import { Header } from '@jimka/typescript-ui/component/display'

   const body = Body.getInstance()
   body.setLayoutManager(new Fit())
   body.addComponent(new Header('Hello from typescript-ui'))
   ```

7. **`template/vite.config.ts`** — with the mandatory keepNames minify guard (Architecture Decision; mirrors [vite.config.ts:47-50](vite.config.ts#L47)):
   ```ts
   import { defineConfig } from 'vite'

   export default defineConfig({
     build: {
       rollupOptions: {
         output: {
           // typescript-ui derives each component's CSS class name from
           // `this.constructor.name`, so the minifier must keep class/function
           // names — otherwise the production build blanks the page. Mirrors
           // the library's own build config.
           minify: {
             compress: { keepNames: { function: true, class: true } },
             mangle:   { keepNames: { function: true, class: true } },
           },
         },
       },
     },
   })
   ```

8. **`template/tsconfig.json`** (minimal, mirrors restructure Step 13):
   ```json
   {
     "compilerOptions": {
       "target": "ESNext",
       "module": "ESNext",
       "moduleResolution": "bundler",
       "strict": true,
       "types": []
     },
     "include": ["src", "vite.config.ts"]
   }
   ```

9. **`template/_gitignore`** (renamed to `.gitignore` on scaffold):
   ```
   node_modules
   dist
   ```

10. **`template/README.md`** — a few lines: what the project is, `npm install`, `npm run dev`, `npm run build`.

### Phase 3 — Unit tests

11. **Create `packages/create-app/test/scaffold.test.js`** (vitest, mirroring the pure-helper import style of [tests/unit/llms-generate.test.ts](tests/unit/llms-generate.test.ts)): import the pure helpers from `../index.js` and cover the cases in `## Expected Behaviour`. Run with `npm -w packages/create-app run test` → green.

### Phase 4 — Wire into the workspace

12. **Append `"packages/create-app"` to the root [package.json](package.json) `workspaces` array** (the only shared edit): `["packages/lib", "packages/docs", "packages/create-app"]`. Do not edit root `scripts`.

13. **Reinstall to register the workspace:** from the repo root, `npm install`. Confirm the workspace is linked: `npm ls -w packages/create-app` shows `@jimka/create-tsui-app@0.0.1` and no errors; `test -e node_modules/@jimka/create-tsui-app` (self-symlink) exists.

### Phase 5 — Publish verification (pack surface) + manual E2E

14. **Pack-surface check** (from `packages/create-app`): `npm pack --dry-run` — assert the tarball contains `package/index.js`, `package/bin/create-tsui-app.js`, `package/template/**` (including `package/template/_gitignore`, NOT `.gitignore`), `package/package.json`; and that the bin is present. `npm publish --dry-run` reports **public** access.

15. **Manual E2E (only after `@jimka/typescript-ui@0.1.0` is published — see [publish-0-1-0.md](plans/publish-0-1-0.md)):** run the bin against a scratch dir, `npm install` in the output (pulls published `^0.1.0` from npm), then `npm run build`. Detailed in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/create-app/package.json` |
| Create | `packages/create-app/index.js` (pure helpers + `scaffold` + `main`) |
| Create | `packages/create-app/bin/create-tsui-app.js` (executable shebang wrapper) |
| Create | `packages/create-app/template/package.json` |
| Create | `packages/create-app/template/index.html` |
| Create | `packages/create-app/template/src/main.ts` |
| Create | `packages/create-app/template/vite.config.ts` |
| Create | `packages/create-app/template/tsconfig.json` |
| Create | `packages/create-app/template/_gitignore` |
| Create | `packages/create-app/template/README.md` |
| Create | `packages/create-app/test/scaffold.test.js` |
| Modify | `package.json` (root) — append `"packages/create-app"` to `workspaces` |
| Regenerate | `package-lock.json` (workspace graph) |

No library source, `exports`, `files`, `name`, or `version` changes.

---

## Expected Behaviour

**Unit-testable (pure helpers — [tests/unit/llms-generate.test.ts](tests/unit/llms-generate.test.ts) style):**

- **`toValidPackageName`** lowercases and dash-replaces: `"My App"` → `"my-app"`; `"Foo/Bar"` → `"foo-bar"`; strips a leading dot/underscore (`"_x"` → `"x"`); an already-valid name passes through (`"my-app"` → `"my-app"`).
- **`renameTemplateFile`** maps `"_gitignore"` → `".gitignore"` and returns every other name unchanged (`"index.html"` → `"index.html"`, `"package.json"` → `"package.json"`). No other name is rewritten.
- **`isEmpty`** is `true` for `[]` and `false` for any non-empty entry list (`["index.html"]` → `false`).
- **`parseCliArgs`** returns `{ targetDir: "my-app" }` for `["my-app"]` and `{ targetDir: undefined }` for `[]`.

**Manual / integration (needs fs + a published `0.1.0`; not an automated unit test):**

- **Refuse-if-nonempty.** `scaffold` on an existing non-empty dir throws `target directory … is not empty` and writes nothing.
- **Rename applied on disk.** After scaffolding into an empty dir, the output contains `.gitignore` (from `_gitignore`) and no file literally named `_gitignore`.
- **Name substitution.** The generated `package.json` `name` equals `toValidPackageName(basename(targetDir))`, and its `dependencies["@jimka/typescript-ui"]` is `"^0.1.0"`.
- **Published-tarball surface.** `npm pack` of the scaffolder includes `index.js`, `bin/`, and `template/**` (with `template/_gitignore`); publish access is public.
- **End-to-end (post-`0.1.0`).** `npm create @jimka/tsui-app my-app` (or running the local bin) → `cd my-app && npm install` (pulls published `^0.1.0`) → `npm run build` succeeds and `dist/index.html` exists; `npm run dev` serves a page rendering the `Header` (manual — UI/geometry, not unit-testable).

---

## Verification

1. **Unit tests:** `npm -w packages/create-app run test` → all pure-helper cases green.
2. **Workspace registration:** from repo root, `npm install` succeeds; `npm ls -w packages/create-app` shows `@jimka/create-tsui-app@0.0.1`.
3. **Bin is executable with a shebang:** `head -1 packages/create-app/bin/create-tsui-app.js` is `#!/usr/bin/env node`; `test -x packages/create-app/bin/create-tsui-app.js`.
4. **Pack surface:** `cd packages/create-app && npm pack --dry-run` lists `index.js`, `bin/create-tsui-app.js`, `template/…` including `template/_gitignore` (and **not** `.gitignore`); `npm publish --dry-run` reports **public** access.
5. **Local scaffold smoke (no publish needed):** run `node packages/create-app/bin/create-tsui-app.js "$SCRATCH/my-app"` into a scratch dir; confirm `$SCRATCH/my-app/.gitignore` exists, no `_gitignore` remains, and `my-app/package.json` `name` is `my-app` with `@jimka/typescript-ui: ^0.1.0`. Re-running into the now-non-empty dir errors with "not empty".
6. **End-to-end (MANUAL — only after `@jimka/typescript-ui@0.1.0` is live on npm per [publish-0-1-0.md](plans/publish-0-1-0.md)):** in the scaffolded `my-app`, `npm install` (resolves `^0.1.0` from the registry), then `npm run build` → `dist/index.html` exists; `npm run dev` and open the page → the `Header` renders, no console errors. This path **cannot** run before `0.1.0` is published and is not an automated test.

---

## Potential Challenges

- **`.gitignore` stripped from tarballs.** Mitigated by storing `_gitignore` and renaming on copy (Architecture Decision); the pack-surface check (Verification 4) asserts `_gitignore` ships and `.gitignore` does not.
- **Minified production build blanks the page** if the keepNames guard is missing. Mitigated by shipping the `build.rollupOptions.output.minify` block in `template/vite.config.ts` (Step 7); verified by the manual `npm run build` + render (Verification 6).
- **E2E can't run pre-publish.** `^0.1.0` is uninstallable until `0.1.0` is on npm; the E2E path is explicitly marked manual/post-publish (`depends-on: publish-0-1-0`). The local scaffold smoke (Verification 5) covers everything *except* the registry install.
- **Executable bit not preserved by git.** Set it explicitly (Step 3, `chmod +x` / `git update-index --chmod=+x`).
- **Nested `template/package.json` mistaken for a workspace.** Avoided because the root `workspaces` array is an explicit list, not a glob (Architecture Decision).

---

## Critical Files

- [package.json](package.json) — root orchestrator; the `workspaces` array is the single shared edit (append `packages/create-app`).
- [plans/workspace-restructure.md](plans/workspace-restructure.md) — establishes the monorepo, the reserved `packages/create-app` slot ([:328](plans/workspace-restructure.md#L328)), and the `packages/docs` scaffold shape (Steps 9–13) the generated starter mirrors.
- [plans/publish-0-1-0.md](plans/publish-0-1-0.md) — the scoped-public publish conventions this scaffolder mirrors, and the reason the E2E path is post-`0.1.0`.
- [src/typescript/FitPanel.ts](src/typescript/FitPanel.ts) — the `setLayoutManager(new Fit())` + `addComponent(child)` idiom the starter's `main.ts` mirrors.
- [src/typescript/lib/core/index.ts](src/typescript/lib/core/index.ts), [src/typescript/lib/layout/index.ts](src/typescript/lib/layout/index.ts), [src/typescript/lib/component/display/index.ts](src/typescript/lib/component/display/index.ts) — barrels confirming `Body`, `Fit`, `Header` are valid current exports.
- [vite.config.ts](vite.config.ts) (lines 47-50) — the keepNames minify block the starter's `vite.config.ts` reproduces.
- [scripts/llms/generate.mjs](scripts/llms/generate.mjs) — the repo's plain-ESM zero-dep Node-tooling precedent the CLI follows.
- [tests/unit/llms-generate.test.ts](tests/unit/llms-generate.test.ts) — the pure-helper vitest precedent the scaffolder's unit tests mirror.

---

## Non-Goals

- **A build step for the CLI** — it ships plain committed ESM; no TypeScript compile, no `dist`, no `prepublishOnly` build guard (unlike `packages/lib`).
- **A prompt/UI library** (`prompts`, `inquirer`, …) — the single "target dir" question uses `node:readline`; no runtime deps.
- **Template variants / flags** (`--template react`, TypeScript-vs-JS toggles, git init, package-manager detection) — one minimal starter only.
- **Rich starter content** — the generated app renders exactly one component; multi-panel showcases are out of scope.
- **Release automation for the scaffolder** — published manually like `publish-0-1-0`; no tag-triggered workflow.
- **Editing the root `scripts`, CI, or `publish-0-1-0`/`workspace-restructure` decisions** — this plan only appends to `workspaces` and adds the new package.
