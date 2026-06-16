# npm Package Publishing — Implementation Plan

## Overview

The package is **already configured** for a multi-subpath, ESM-only npm release. `package.json` ([package.json:7-80](../package.json#L7)) defines a complete `exports` subpath map (`./core`, `./primitive`, `./layout`, `./data`, `./validation`, `./component/*`, `./glyphs`, `./glyphs/solid|regular|brands`, and a `./glyphs/*` wildcard) with `import` + `types` conditions per entry, a `files` whitelist ([package.json:81-84](../package.json#L81)), `sideEffects: false` ([package.json:85](../package.json#L85)), and `"type": "module"`. There is deliberately **no** `main`/`module`/`types`/`.` root entry — consumers import per subpath. `vite.lib.config.ts` builds those subpaths with `formats: ['es']` and `emptyOutDir: false`; `tsconfig.lib.json` emits `.d.ts` to `dist/lib/types` first. This scaffolding is correct and must not be re-architected.

The genuinely remaining publish work is narrow: the `README.md` "Quick install" example imports a **non-existent** `DefaultTheme` from a **non-existent** bare root entry ([README.md:34-40](../README.md#L34)) and mis-describes the build as "ESM + UMD" ([README.md:87](../README.md#L87)); the `sideEffects: false` claim needs to be reconciled with the fact that importing `Body` runs `ThemeManager.setTheme(ModernTheme)` at module-eval time ([Body.ts:21,39](../src/typescript/lib/core/Body.ts#L21)); the FontAwesome license shipping needs confirmation and the README's `NOTICE` reference fixing; and `version`/publish-access need finalising. No build-config or `exports`-map changes are required.

This plan **supersedes** the prior `npm-package.md`, which was built on a wrong model (it invented `src/typescript/Base/index.ts`, `main`/`module`/`types` fields, a UMD format, a `.` root export, `CSS.setRootVariables()`, `DefaultTheme`, and a FontAwesome *peer dependency*). None of those exist; do not reintroduce them.

---

## Architecture Decisions

### Keep the ESM-only multi-subpath model — no root entry

Settled. The `exports` map is per-subpath barrel only ([package.json:7-80](../package.json#L7)); there is no `.` key, no `main`/`module`/`types`, and `vite.lib.config.ts` declares `formats: ['es']` ([vite.lib.config.ts:40](../vite.lib.config.ts#L40)) with one chunk per `src/typescript/lib/*/index.ts` barrel plus a `globSync` over `glyphs/**/*.ts` ([vite.lib.config.ts:9-14,24-39](../vite.lib.config.ts#L9)). This plan changes none of that. All README/doc examples must use real subpaths (`@jimka/typescript-ui/core`, `.../component/button`, `.../glyphs/solid/<name>`), never a bare root import.

### `build:lib` ordering and `emptyOutDir: false` are intentional — leave them

`build:lib` runs `tsc -p tsconfig.lib.json && vite build --config vite.lib.config.ts` ([package.json:89](../package.json#L89)). `tsc` (with `emitDeclarationOnly`, `declarationDir: dist/lib/types`, `rootDir: src/typescript/lib`, [tsconfig.lib.json:3-9](../tsconfig.lib.json#L3)) writes the `.d.ts` tree **first**; Vite then writes the `.es.js` chunks into the **same** `dist/lib` with `emptyOutDir: false` ([vite.lib.config.ts:43-44](../vite.lib.config.ts#L43)) so it does **not** wipe the freshly-emitted types. Inverting the order or flipping `emptyOutDir` to `true` would delete the `.d.ts` files and break the `types` conditions in `exports`. The prior plan's `rimraf dist/lib && tsc … && vite …` with `emptyOutDir: true` is wrong twice over and must not be adopted. If a clean rebuild is wanted, the existing `npm run clean` (`rimraf dist/*`, [package.json:97](../package.json#L97)) runs *before* `build:lib`, not interleaved.

### `sideEffects` must become an allow-list, not blanket `false`

`package.json:85` currently asserts `sideEffects: false`, but `core/Body.ts` declares `private static readonly INSTANCE: Body = new Body()` ([Body.ts:21](../src/typescript/lib/core/Body.ts#L21)) and that private constructor calls `ThemeManager.setTheme(ModernTheme)` ([Body.ts:39](../src/typescript/lib/core/Body.ts#L39)), which writes CSS custom properties onto `document.documentElement`/`document.body` and injects an `@font-face` `<style>` via `ensureFontLoaded` ([Theme.ts:955-976,1021-1041](../src/typescript/lib/core/Theme.ts#L955)). The static initializer runs the first time the `Body` module is evaluated — i.e. **on import** of `@jimka/typescript-ui/core`. That is a real, intended DOM side effect (it is what makes the framework themed out of the box), and it is the only module-level side effect in `lib/` (a top-level `new …`/`document.` scan finds only `Body.ts`).

`sideEffects: false` tells bundlers every module is pure and droppable when its exports look unused. For a consumer who imports another `./core` symbol but not `Body`, an aggressive bundler could conclude `Body.ts` is dead and tree-shake away the theme bootstrap, leaving an unthemed page. The fix is to scope the claim to the emitted chunk that actually contains `Body`:

```jsonc
"sideEffects": ["**/core.es.js"]
```

Vite bundles `Body` *into* `core.es.js` (it does not emit a per-file `Body.js`), so a `["**/Body.js"]` glob would match nothing and silently behave like `false`. Pinning `core.es.js` keeps the other 20+ subpath chunks (`primitive.es.js`, `layout.es.js`, the per-glyph chunks, …) tree-shakeable while guaranteeing the import-time theme bootstrap survives. The conservative fallback is `"sideEffects": true` (whole package marked side-effectful — safe, but forgoes cross-subpath tree-shaking). The implementer must confirm the emitted chunk name against the real bundle (verification step 5) and pick accordingly; do **not** leave it at `false`.

### FontAwesome is bundled data, not a dependency

The ~2,860 glyphs are TypeScript path-data constants under `src/typescript/lib/glyphs/{solid,regular,brands}/` ([glyphs/index.ts:1-3](../src/typescript/lib/glyphs/index.ts#L1)), compiled into the published `dist/lib/glyphs/**` chunks. There is no `@fortawesome/*` runtime/peer dependency and none should be added. The CC BY 4.0 obligation is met by shipping `LICENSE-FONTAWESOME.md`, which is already in the `files` array ([package.json:83](../package.json#L83)). The only runtime/declared dependency is `@fontsource-variable/manrope` ([package.json:118](../package.json#L118)), consumed by the font bootstrap in `Theme.ts`.

### Version and publish access

The package is scoped (`@jimka/typescript-ui`) and sits at `0.0.0` ([package.json:1-3](../package.json#L1)). Scoped packages default to private on the npm registry, so the first publish needs `npm publish --access public`. Bump `version` to a real release number (recommend `0.1.0` for a first public preview, reflecting the not-yet-1.0 API surface; `1.0.0` only if the API is being committed to as stable). This plan does not prescribe the exact number — it must be a deliberate human choice at publish time — but it must not stay `0.0.0`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `package.json` — fix `sideEffects` (see decision above); bump `version` off `0.0.0`; optionally add `NOTICE` to the `files` array (see README fix) |
| Modify | `README.md` — fix the Quick-install import example, the build-format description, and the third-party-license reference |
| None   | `vite.lib.config.ts` — correct as-is; do not touch |
| None   | `tsconfig.lib.json` — correct as-is; do not touch |
| None   | `exports` map / `files` whitelist (other than the optional `NOTICE` line) — correct as-is |

No new config files. Do **not** create `.npmignore` — the `files` whitelist ([package.json:81-84](../package.json#L81)) already governs the tarball, and a whitelist is stricter and self-consistent; a parallel blacklist invites drift.

---

## README fixes (exact)

The current example ([README.md:33-41](../README.md#L33)) is broken three ways: it imports from the bare root `@jimka/typescript-ui` (no `.` export exists, so it will not resolve), it imports `DefaultTheme` (does not exist — the real themes are `BaseTheme`/`ClassicTheme`/`DarkTheme`/`ModernTheme`, exported from `core/Theme.ts` via the `./core` barrel, [core/index.ts:45](../src/typescript/lib/core/index.ts#L45)), and it calls `ThemeManager.setTheme(DefaultTheme)` with the missing symbol. Note also that `Body.getInstance()` ([Body.ts:28-30](../src/typescript/lib/core/Body.ts#L28)) already applies `ModernTheme` on import, so the explicit `setTheme` call is only needed to *override* the default theme.

Replace with real subpath imports and real symbols, e.g.:

```typescript
import { Body, Window, ThemeManager, DarkTheme } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';

// Optional: ModernTheme is applied automatically when core is imported.
// Call setTheme only to switch themes (e.g. dark mode):
ThemeManager.setTheme(DarkTheme);

const body = Body.getInstance();
// … add top-level components to `body`
```

(`Window` is exported from `./core` at [core/index.ts:24](../src/typescript/lib/core/index.ts#L24); `Button` from `./component/button` at the button barrel.) The implementer should keep the example minimal and verify each imported name resolves against its subpath barrel before finalising.

Other README corrections:
- [README.md:87](../README.md#L87): the `build:lib` row says "(ESM + UMD + `.d.ts`)" — drop "UMD"; the library is ESM-only (`formats: ['es']`). Replace with "(ESM + `.d.ts`)".
- [README.md:97](../README.md#L97): "see [NOTICE](NOTICE)" — `NOTICE` is **not** in the published `files` array, so this link is dead in the tarball. Either (a) point it at `LICENSE-FONTAWESOME.md` (which *is* shipped and carries the full CC BY 4.0 attribution, [LICENSE-FONTAWESOME.md:1-28](../LICENSE-FONTAWESOME.md#L1)), or (b) add `"NOTICE"` to the `files` array so the existing reference resolves. Prefer (a): `LICENSE-FONTAWESOME.md` already restates the attribution standalone and is the canonical shipped file. `NOTICE` and the top-level `LICENSE` remain in-repo for source consumers (npm always ships `LICENSE` automatically regardless of the `files` array).

The Glyphs section ([README.md:43-79](../README.md#L43)) already uses correct subpath imports (`@jimka/typescript-ui/component/display`, `@jimka/typescript-ui/glyphs/solid/<name>`) and needs no change.

---

## Ordered Implementation Steps

1. **README import example.** Rewrite [README.md:33-41](../README.md#L33) to the real-subpath form above. → verify: every imported symbol (`Body`, `Window`, `ThemeManager`, a real theme, `Button`) appears in its subpath barrel — `grep -n 'DarkTheme\|ThemeManager\|Window\|Body' src/typescript/lib/core/index.ts` and `grep -n 'Button' src/typescript/lib/component/button/index.ts`.
2. **README build-format + license lines.** Fix [README.md:87](../README.md#L87) (drop UMD) and [README.md:97](../README.md#L97) (re-point to `LICENSE-FONTAWESOME.md`, or add `NOTICE` to `files`). → verify: `grep -n 'UMD' README.md` returns nothing; the third-party-license link names a file in `files` or an npm-auto-shipped file.
3. **`sideEffects`.** Change [package.json:85](../package.json#L85) per the _Architecture Decisions_ outcome chosen in verification step 5 (`"**/core.es.js"` — the bundled chunk containing `Body` — or `true` if chunk-scoping proves unreliable; never leave it `false`). → verify: `node -e "console.log(require('./package.json').sideEffects)"` is not `false`.
4. **Version.** Bump `version` off `0.0.0` ([package.json:2](../package.json#L2)) to the chosen release number. → verify: `npm pkg get version` is not `"0.0.0"`.
5. **Build + tarball inspection** (see Verification). → verify: `npm run build:lib` succeeds and `npm pack` lists only `dist/lib/**` + `LICENSE-FONTAWESOME.md` + `package.json` + `README.md` (+ `LICENSE`, auto-added by npm).

---

## Verification

1. **Build end-to-end.** `npm run clean && npm run build:lib`. Expect `dist/lib/` to contain one `<name>.es.js` (+ `.es.js.map`) per `exports` entry — `core.es.js`, `primitive.es.js`, `layout.es.js`, `data.es.js`, `validation.es.js`, `component/{input,button,display,list,container,menubar,table,tree}.es.js`, `glyphs/index.es.js`, `glyphs/{solid,regular,brands}/index.es.js`, and per-glyph chunks — plus a parallel `dist/lib/types/**/*.d.ts` tree (e.g. `dist/lib/types/core/index.d.ts`). Confirm the `.d.ts` survived the Vite pass (proves the `emptyOutDir: false` ordering held).
2. **Subpath resolution.** For each `exports` key, confirm the referenced `import` and `types` files exist on disk after build: `node -e "const e=require('./package.json').exports; for (const k in e){for (const c of ['import','types']){const p=e[k][c]; if(!p.includes('*')) require('fs').accessSync(p)}}"` exits 0.
3. **Tarball contents.** `npm pack` (not `--dry-run`, so the tarball is produced and can be untarred) then `tar -tzf jimka-typescript-ui-*.tgz`. Assert: includes `package/dist/lib/...`, `package/LICENSE-FONTAWESOME.md`, `package/package.json`, `package/README.md`, and `package/LICENSE`; **excludes** `src/`, `*.config.ts`, `tsconfig*.json`, `.claude/`, `.codegraph/`, `docs/`, `node_modules/`. Delete the tgz afterward.
4. **Import smoke (resolution + side effect).** In a scratch ESM file resolving against the built package (e.g. `npm link` or a relative `exports`-aware import in a jsdom/Vite harness), `import { Body } from '@jimka/typescript-ui/core'` and assert `document.documentElement.style.getPropertyValue('--ts-ui-…')` is populated — proving the import-time theme bootstrap fires. This is the empirical check behind the `sideEffects` decision.
5. **`sideEffects` correctness.** Inspect the built output to confirm the chunk name that contains `Body`'s static-INSTANCE bootstrap (expected `dist/lib/core.es.js`) and verify the `"**/core.es.js"` glob in step 3 of the Ordered Steps matches it. A per-file `"**/Body.js"` glob will not — `Body` is folded into `core.es.js`, not emitted standalone. If the chunk name differs or scoping proves unreliable, fall back to `"sideEffects": true`. Re-run step 4 to confirm the bootstrap still fires under a tree-shaking consumer build (a tiny Vite app importing one unrelated `./core` symbol, then asserting the theme var is set).
6. **Docs build unaffected.** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning), confirming the README/doc edits introduced no broken links.

---

## Documentation Impact

No public API symbols change, so no per-subpath barrel or curated `docs/<group>/` page moves. The consumer-facing change is documentation-only:

- `README.md` — the install/usage example and license/build lines (this plan's core edit).
- The hosted docs' [Installation & TypeScript setup](https://jimka.github.io/typescript-ui/guide/installation) page lives in-repo at [docs/guide/installation.md](../docs/guide/installation.md). It is **already correct** — it documents subpath-only exports ([installation.md:5](../docs/guide/installation.md#L5)), the real `ThemeManager.setTheme(ClassicTheme)` call from `@jimka/typescript-ui/core` ([installation.md:44-45](../docs/guide/installation.md#L44)), and the `moduleResolution: "bundler"` requirement ([installation.md:21](../docs/guide/installation.md#L21)). No change needed; this is the canonical example the corrected `README.md` should be brought in line with (not the reverse).

---

## Potential Challenges

- **`sideEffects` glob vs. bundled output.** Because Vite bundles each subpath into a single `*.es.js`, a per-file `"**/Body.js"` glob matches nothing in `dist/lib` and silently behaves like `false`; scope the glob to the bundled chunk that contains `Body` (`"**/core.es.js"`) instead. Mitigation: verification step 5 inspects the real bundle to confirm the chunk name; fall back to `"sideEffects": true` for the package if scoping proves unreliable — correctness of the theme bootstrap beats marginal cross-subpath tree-shaking.
- **First scoped publish defaults to private.** Mitigation: use `npm publish --access public` on the first publish; thereafter access is remembered.
- **Stale `dist/lib` across builds.** With `emptyOutDir: false`, renamed/deleted source modules can leave orphan chunks. Mitigation: always `npm run clean` before a release `build:lib` (do not bake `rimraf` into `build:lib` itself — that would race the tsc/vite ordering).
- **`@fontsource-variable/manrope` must resolve at consumer build time.** It is a real `dependency` ([package.json:118](../package.json#L118)) imported by the font bootstrap; npm install pulls it transitively, so no action — just don't accidentally demote it to devDependencies.

---

## Critical Files

- [package.json](../package.json) — `exports` map (7-80), `files` (81-84), `sideEffects` (85), scripts (86-101), deps (117-119). The only file whose values change.
- [vite.lib.config.ts](../vite.lib.config.ts) — multi-entry ESM build, `emptyOutDir: false`, glyph `globSync`. Read to understand output layout; do not edit.
- [tsconfig.lib.json](../tsconfig.lib.json) — `.d.ts` emit config. Read; do not edit.
- [src/typescript/lib/core/Body.ts](../src/typescript/lib/core/Body.ts) — the eager `INSTANCE` + import-time `setTheme` that drives the `sideEffects` decision.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — `ThemeManager.setTheme`/`getTheme` (1021-1050), `ensureFontLoaded` (955-976), real theme symbols; confirms the README symbol fix.
- [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — the `./core` barrel; source of truth for which symbols a `./core` import example may name.
- [README.md](../README.md) — the file being corrected.
- [LICENSE-FONTAWESOME.md](../LICENSE-FONTAWESOME.md) / [NOTICE](../NOTICE) — third-party attribution; only the former is in `files`.

---

## Non-Goals

- **No `.` root entry, root barrel, `main`/`module`/`types`, or UMD output.** Settled design — the package is ESM-only multi-subpath.
- **No `exports`-map, `vite.lib.config.ts`, or `tsconfig.lib.json` restructuring.** They are correct.
- **No `.npmignore`.** The `files` whitelist already governs the tarball.
- **No FontAwesome npm (peer or runtime) dependency.** Glyphs ship as bundled data under CC BY 4.0; only `LICENSE-FONTAWESOME.md` is required.
- **No `CHANGELOG.md`, CI release workflow, or `prepublishOnly` automation.** Out of scope for this pass; the manual `npm run clean && npm run build:lib && npm publish --access public` flow is sufficient for the first release. (Revisit only if the maintainer asks.)
