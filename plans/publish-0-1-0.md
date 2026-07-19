---
depends-on: [workspace-restructure]
touches-shared: [packages/lib/package.json]
---

# Publish `@jimka/typescript-ui@0.1.0` — Implementation Plan

## Overview

The first public npm publish of the library, plus migrating the sqladmin consumer off its `file:` symlink onto the published version. This plan operates on the **post-`workspace-restructure` layout**: the library package is `packages/lib/package.json` (the current root [`package.json`](package.json) moved verbatim), built via `npm run build:lib` to `packages/lib/dist/lib`. All paths below are inside `packages/lib` unless stated. The publish is small in code — two `package.json` fields plus a LICENSE/README copy — but the *core of the plan is the pre-publish verification*: because sqladmin has always consumed this package through a live symlink, the real *packaged* surface (the `files` array + the 23-subpath `exports` map resolved against the packed layout) has **never** been exercised, and `0.1.0` is immutable once it lands.

The package is `@jimka/typescript-ui` — **scoped**, so npm publishes it **private by default**; `version` is already `0.1.0`; `files` is `["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md"]` ([package.json:101-105](package.json#L101)); `exports` has 23 subpaths ([package.json:7-100](package.json#L7)); the build script is `build:lib` ([package.json:113](package.json#L113)). There is **no** `publishConfig` and **no** `prepublishOnly` today (verified — grep returns nothing). There is no release/publish GitHub workflow (`.github/workflows/` contains only `docs.yml`) and no CHANGELOG or release convention in the repo.

This plan makes two guarded edits to `packages/lib/package.json`, ensures the package ships a LICENSE and README, verifies the packed surface end-to-end **before** the immutable publish, performs the publish, then documents the external sqladmin migration.

---

## Architecture Decisions

### Public scoped publish — encode `publishConfig.access`, don't rely on a flag

`@jimka/typescript-ui` is scoped (`@jimka/…`), so `npm publish` defaults to **restricted (private)** and fails on a free account, or silently publishes private on a paid one. Add `"publishConfig": { "access": "public" }` to `packages/lib/package.json` so the very first `npm publish` goes public without a forgotten `--access public` flag. **Rationale:** a forgotten `--access public` is the single most common first-scoped-publish failure; baking it into the manifest makes the outcome independent of how the publish command is typed.

**Public access ≠ open-source license.** The package's `license` is `LicenseRef-PolyForm-Noncommercial-1.0.0` ([package.json:5](package.json#L5)) — PolyForm Noncommercial 1.0.0, a source-available *noncommercial* license. `access: public` only controls registry *visibility/installability*; the noncommercial license still governs *use*. This is intended (the author's choice); it is noted here only so the implementer does not confuse "public npm access" with "open source" and does not "fix" the license.

### Build guard — `prepublishOnly` rebuilds `dist/lib`

`dist/lib` is built and **gitignored**, so the publish tarball ships whatever happens to be on disk — which may be empty, partial (a clean checkout has no `dist`), or stale. Add `"prepublishOnly": "npm run build:lib"` (the exact existing build script — `tsc -p tsconfig.lib.json && tsc-alias -p tsconfig.lib.json && vite build --config vite.lib.config.ts`, [package.json:113](package.json#L113)) so `npm publish` rebuilds `dist/lib` first. **Rationale:** `0.1.0` is immutable — a botched publish (empty or stale `dist/lib`) can only be corrected by burning a `0.1.1` bump; the guard makes shipping a bad tarball impossible. **Note the lifecycle boundary:** npm runs `prepublishOnly` on `npm publish` **only** — **not** on `npm pack`. So the pack-based verification below cannot rely on it and must run `npm run build:lib` explicitly first; the guard's job is to protect the real `npm publish` (Ordered Step 8), which the verification proves against a manually-built, then re-guard-built, `dist/lib`. (`prepublishOnly` is used rather than `prepack` per this plan's mandate; `prepack` would also cover pack but is out of scope to introduce.)

### Ship a LICENSE and README inside the package

npm **always** includes `package.json`, `README(.md)`, and `LICENSE`/`LICENCE` in a tarball **regardless of the `files` array — but only if those files exist in the package root.** Post-restructure, `packages/lib` has neither: `workspace-restructure` keeps `README.md` and `LICENSE` at the repo root (it moves `LICENSE-FONTAWESOME.md` but not `LICENSE`, and only edits root `README.md`). Publishing from `packages/lib` as-is would ship a package with **no LICENSE** (unacceptable for a source-available noncommercial license — the license text is the grant) and a **blank npm page** (no README). Copy both into `packages/lib` before publishing: `packages/lib/LICENSE` and `packages/lib/README.md`. **Rationale:** for an immutable first public release, the license text and the npm landing page are load-bearing; they cost one `cp` each and ship automatically once present. (The root `README.md`'s existing install/usage guidance and its `llms.txt` pointer apply verbatim to consumers, so the root copy is the correct source.)

### Verify the packed surface before the immutable publish — resolution, not execution

The mandatory core check. Three layers, all run from `packages/lib` **before** `npm publish`:

1. **`npm run build:lib`** (explicit — `npm pack` does not run `prepublishOnly`), then **`npm publish --dry-run`** and **`npm pack`** operate on that freshly built `dist/lib`.
2. **Tarball file-list assertion.** The tarball must contain exactly the `files` array (`dist/lib/**`, `llms.txt`, `LICENSE-FONTAWESOME.md`) **plus npm's always-included set** (`package.json`, `README.md`, `LICENSE`). Nothing else (no `src/`, no configs, no `tests/`, no VitePress `docs/`). The "always-included set" is *expected*, not a leak — the check asserts `files` ⊆ tarball and that no out-of-`files` tree (`src`, `docs`, `tests`, `*.config.*`, `tsconfig*`) appears.
3. **Install the packed `.tgz` into a throwaway scratch dir and resolve two real subpaths** from the `exports` map against the **packed** layout — proving end-to-end resolution against the shipped files, not source. Use `import.meta.resolve('@jimka/typescript-ui/core')` and `import.meta.resolve('@jimka/typescript-ui/component/button')`, and assert each resolves to a file that exists under `node_modules/@jimka/typescript-ui/dist/lib/`.

**Resolve, do not import.** typescript-ui UI modules touch `document` at import scope (a documented project invariant — `core.es.js` is even listed in `sideEffects`), so *executing* them under plain Node (`node -e "import('…/core')"`) throws `document is not defined` — a false failure that says nothing about packaging. `import.meta.resolve` (stable in Node ≥ 20; CI uses Node 22) walks the `exports` map and the packed files **without evaluating** the module, which is exactly what "does the packaged surface resolve" asks. **Choice of subpaths:** `core` is the bare-package entry every consumer hits; `component/button` proves a nested `component/*` key resolves. Avoid `component/diagram` (pulls the optional `elkjs` peer) so the scratch check needs no extra install.

### No automated publish workflow for 0.1.0 — the guards live in the manifest

No release/publish workflow or release convention exists in the repo (only `docs.yml`). The two guards (`publishConfig.access` + `prepublishOnly`) live in `package.json`, so they protect a **manual** `npm publish` exactly as they would a CI one. A first, one-off `0.1.0` cut does not justify standing up an OIDC/npm-token release pipeline, tag-triggered workflow, or changesets tooling. **Decision:** publish manually from `packages/lib` (`npm publish`), and mark the release with a git tag `v0.1.0` (the minimal, reversible convention — establishes a marker a future automated pipeline can build on). This is the minimal approach; adding release automation is a Non-Goal. **Rationale:** mirror the repo's current convention (there is none → do the least that is safe), rather than inventing machinery a first publish doesn't need.

### Consumer version range — `^0.1.0` and 0.x caret semantics

sqladmin depends via `^0.1.0`. During **0.x**, caret is special: `^0.1.0` permits `0.1.x` (patches) but **not** `0.2.0`. In 0.x a **breaking** change bumps the **minor** (0.2.0), which `^0.1.0` deliberately excludes; a backward-compatible fix bumps the **patch** (0.1.1), which it accepts. **Rationale:** documented here so the sqladmin range is understood as "auto-accept 0.1.x patches, hold at the 0.1 line," not as normal 1.x caret.

---

## Public API

**No library API changes.** `name`, `version`, `exports`, and the type surface are untouched. The only manifest additions are `publishConfig` and a `prepublishOnly` script:

```jsonc
// added to packages/lib/package.json
"publishConfig": { "access": "public" },
// added to the "scripts" object
"prepublishOnly": "npm run build:lib"
```

---

## Ordered Implementation Steps

All steps run with cwd `packages/lib` unless noted. Prerequisite: `workspace-restructure` is merged (the package exists at `packages/lib`).

### Phase 1 — Manifest guards and packaged files

1. **Add `publishConfig` to `packages/lib/package.json`.** Insert a top-level `"publishConfig": { "access": "public" }` (e.g. adjacent to `"license"`). Do not duplicate — confirm first with `grep -n publishConfig packages/lib/package.json` (expect no existing match).

2. **Add `prepublishOnly` to the `scripts` object** in `packages/lib/package.json`: `"prepublishOnly": "npm run build:lib"`. Confirm no existing `prepublishOnly`/`prepack` with `grep -nE 'prepublish|prepack' packages/lib/package.json` (expect none before this edit).

3. **Ensure the package ships a LICENSE and README.** From the repo root: `cp LICENSE packages/lib/LICENSE` and `cp README.md packages/lib/README.md` (only if `packages/lib/LICENSE` / `packages/lib/README.md` don't already exist — check first; `workspace-restructure` may or may not have placed them). Checkpoint: `ls packages/lib/LICENSE packages/lib/README.md` both exist.

### Phase 2 — Pre-publish verification (before the immutable publish)

4. **Build, then dry-run publish.** From `packages/lib`: `npm run build:lib` (explicit — `npm pack` in Step 5 does not run `prepublishOnly`), then `npm publish --dry-run`. Expect the dry-run to print the tarball contents and a "would publish" summary with **access: public**. Do not proceed if it reports restricted/private access or a build error.

5. **Pack and assert the file list.** From `packages/lib` (after Step 4's build): `npm pack` → produces `jimka-typescript-ui-0.1.0.tgz`. Inspect: `tar -tzf jimka-typescript-ui-0.1.0.tgz | sort`. Assert:
   - Present: `package/package.json`, `package/README.md`, `package/LICENSE`, `package/llms.txt`, `package/LICENSE-FONTAWESOME.md`, and `package/dist/lib/**` (including `core.es.js`, `component/button.es.js`, and `types/**`).
   - **Absent** (no out-of-`files` tree leaked): grep the list for `package/src/`, `package/tests/`, `package/docs/`, `package/*.config.*`, `package/tsconfig` — each must return **zero** matches.
   - Cross-check `dist/lib` completeness against `exports`: every `import` target in the `exports` map (e.g. `dist/lib/core.es.js`, `dist/lib/component/button.es.js`, `dist/lib/glyphs/index.es.js`, `dist/lib/types/core/index.d.ts`) appears in the tarball.

6. **Scratch-install and resolve two subpaths against the packed layout.** In the session scratch dir (not the repo):
   ```bash
   SCRATCH="$(mktemp -d)"
   cd "$SCRATCH"
   npm init -y >/dev/null
   npm install /home/jika/typescript/typescript-ui/packages/lib/jimka-typescript-ui-0.1.0.tgz
   cat > verify.mjs <<'EOF'
   import { existsSync } from 'node:fs'
   import { fileURLToPath } from 'node:url'

   for (const sub of ['@jimka/typescript-ui/core', '@jimka/typescript-ui/component/button']) {
     const url = import.meta.resolve(sub)          // walks the exports map; does NOT execute the module
     const path = fileURLToPath(url)
     if (!existsSync(path)) throw new Error(`resolved but missing on disk: ${sub} -> ${path}`)
     if (!path.includes('/node_modules/@jimka/typescript-ui/dist/lib/')) {
       throw new Error(`resolved outside packed dist/lib: ${sub} -> ${path}`)
     }
     console.log(`OK ${sub} -> ${path}`)
   }
   EOF
   node verify.mjs
   ```
   Expect two `OK …` lines resolving under `node_modules/@jimka/typescript-ui/dist/lib/`. **Do not** attempt `node -e "import('@jimka/typescript-ui/core')"` — DOM side effects at import scope make it throw `document is not defined`, a false failure. Clean up: `rm -rf "$SCRATCH"` and delete the `.tgz` in `packages/lib`.

### Phase 3 — Publish (immutable)

7. **Authenticate to npm** if not already: `npm whoami` (expect the account owning the `@jimka` scope) or `npm login`.

8. **Publish.** From `packages/lib`: `npm publish` (no `--access` flag needed — `publishConfig` supplies it; `prepublishOnly` rebuilds `dist/lib`). Expect success and **public** access.

9. **Confirm the published package.** `npm view @jimka/typescript-ui version` → `0.1.0`; `npm view @jimka/typescript-ui` shows the README and the file list matching Step 5.

10. **Tag the release.** From the repo root: `git tag v0.1.0 && git push origin v0.1.0` (marker only; see Architecture Decisions).

### Phase 4 — sqladmin migration (external repo — sequenced AFTER the publish)

See the dedicated section below; runs in `/home/jika/typescript/sqladmin`, only after Step 9 confirms `0.1.0` is live.

---

## External repo: `/home/jika/typescript/sqladmin` — not built from typescript-ui

This section is executed in the **sqladmin** repository by the implementer, **after** `@jimka/typescript-ui@0.1.0` is confirmed live on npm (you cannot install `^0.1.0` before it exists). Do not run it from typescript-ui.

sqladmin's [`frontend/package.json`](/home/jika/typescript/sqladmin/frontend/package.json) currently declares (verified, line 14):

```json
"@jimka/typescript-ui": "file:../../typescript-ui",
```

npm resolves that `file:` spec as a **symlink**: `frontend/node_modules/@jimka/typescript-ui -> ../../../../typescript-ui` (verified via `readlink`). The migration swaps this live symlink for the published tarball, whose bundled `dist/lib` is what sqladmin already consumes today (sqladmin imports the built `dist/lib`, not source).

**Steps (in `/home/jika/typescript/sqladmin/frontend`):**

1. **Edit `frontend/package.json`:** change the dependency to `"@jimka/typescript-ui": "^0.1.0"` (see 0.x caret semantics above — accepts `0.1.x`, holds at the 0.1 line).
2. **Remove the stale symlink** so npm re-resolves from the registry: `rm -rf node_modules/@jimka/typescript-ui` (the `@jimka` dir may be left; npm recreates it). Removing it avoids npm keeping the old `file:` link.
3. **Install:** `npm install` — pulls the published package (with its bundled `dist/lib` and its `dependencies`) and updates `package-lock.json`. Confirm `node_modules/@jimka/typescript-ui` is now a **real directory** (`test -L` returns false), and `npm ls @jimka/typescript-ui` shows `0.1.0`.
4. **Verify the frontend still builds/typechecks:** `npm run build` (`tsc --noEmit && vite build`) and `npm run typecheck` — both green, with all `@jimka/typescript-ui/*` subpath imports resolving.
5. **Verify the app still renders** — launch the frontend and confirm the UI loads without console errors (manual; per sqladmin's usual run flow).
6. **Commit** the `package.json` + `package-lock.json` change in the sqladmin repo.

**Note — `elkjs` peer.** The library declares `elkjs` as an **optional** peer at `^0.10.0` ([package.json:188-194](package.json#L188)); sqladmin's `frontend/package.json` pins `elkjs: ^0.9.3` (line 15). Because the peer is optional, npm will not hard-error, but the versions diverge. If the schema-diagram (`component/diagram`) features are used, bump sqladmin's `elkjs` to `^0.10.0` to match; otherwise it can be left and revisited. Flag, don't silently change beyond the dependency swap.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/package.json` (add `publishConfig.access` + `prepublishOnly` script) |
| Create | `packages/lib/LICENSE` (copy of repo-root `LICENSE`, if not already present) |
| Create | `packages/lib/README.md` (copy of repo-root `README.md`, if not already present) |
| — (external) | `/home/jika/typescript/sqladmin/frontend/package.json` (`file:` → `^0.1.0`) |
| — (external) | `/home/jika/typescript/sqladmin/frontend/package-lock.json` (regenerated by `npm install`) |

No library source, `exports`, `files`, `name`, or `version` changes.

---

## Expected Behaviour

Concrete, checkable outcomes (all CLI/manual — this plan adds no unit-testable logic):

- **Manifest guards present.** `packages/lib/package.json` has `publishConfig.access === "public"` and `scripts.prepublishOnly === "npm run build:lib"`; no duplicate of either existed before.
- **Dry-run reports public.** After an explicit `npm run build:lib`, `npm publish --dry-run` (from `packages/lib`) prints tarball contents and reports **public** access — never restricted.
- **Tarball = `files` + npm-always set, nothing more.** `npm pack` yields a tgz containing exactly `dist/lib/**`, `llms.txt`, `LICENSE-FONTAWESOME.md`, `package.json`, `README.md`, `LICENSE` — and **no** `src/`, `tests/`, `docs/`, `*.config.*`, or `tsconfig*`.
- **Every `exports` target is in the tarball.** Each `import` path in the 23-subpath map (e.g. `dist/lib/core.es.js`, `dist/lib/component/button.es.js`, `dist/lib/glyphs/index.es.js`) and its matching `types/**` `.d.ts` is present.
- **Packed subpaths resolve.** In a scratch install of the tgz, `import.meta.resolve` of `@jimka/typescript-ui/core` and `@jimka/typescript-ui/component/button` each returns a URL to an existing file under `node_modules/@jimka/typescript-ui/dist/lib/` — without executing the module.
- **Published.** After publish, `npm view @jimka/typescript-ui version` is `0.1.0`, access is public, and the npm page shows the README.
- **sqladmin migrated.** sqladmin `frontend/package.json` reads `"@jimka/typescript-ui": "^0.1.0"`; `node_modules/@jimka/typescript-ui` is a real directory at `0.1.0` (not a symlink); `npm run build`, `npm run typecheck` pass; the app renders (manual).

---

## Verification

Run in order; do not publish (Step 3 below) until Steps 1–2 pass.

1. **Manifest:** `grep -n publishConfig packages/lib/package.json` and `grep -n prepublishOnly packages/lib/package.json` each show exactly the added lines; `ls packages/lib/LICENSE packages/lib/README.md` both exist.
2. **Packaged surface (the core check):** from `packages/lib`, run `npm publish --dry-run`, then `npm pack` + the `tar -tzf … | sort` assertions (Ordered Steps 4–5), then the scratch-install `node verify.mjs` (Ordered Step 6). All three green.
3. **Publish + confirm:** `npm publish` from `packages/lib` succeeds public; `npm view @jimka/typescript-ui version` → `0.1.0`; `git tag v0.1.0` pushed.
4. **sqladmin (external, after Step 3):** in `sqladmin/frontend`, `npm ls @jimka/typescript-ui` → `0.1.0` and not a symlink; `npm run build && npm run typecheck` green; app renders (manual).

---

## Potential Challenges

- **`dist/lib` is partial/absent on a clean checkout.** `prepublishOnly` rebuilds before `npm publish`; `npm pack`/`--dry-run` do **not** trigger it, so the verification builds explicitly first (Ordered Step 4). Never publish from a stale tree by a path that skips the script.
- **Scoped-private default.** Without `publishConfig.access`, `npm publish` fails (free) or ships private (paid). Encoded in the manifest so the flag can't be forgotten (Architecture Decision).
- **Executing modules under Node throws on `document`.** Verification must **resolve**, not import (see the decision); a `node -e import()` attempt is a false failure, not a packaging bug.
- **Immutability.** `0.1.0` cannot be re-published; a mistake costs a `0.1.1` bump. This is why all verification precedes the publish and the pack is exercised end-to-end first.
- **sqladmin stale symlink.** If `frontend/node_modules/@jimka/typescript-ui` isn't removed before `npm install`, npm may keep the old `file:` link. Remove it explicitly (external Step 2), then confirm it's a real directory.
- **`elkjs` peer version drift** (lib `^0.10.0` optional vs sqladmin `^0.9.3`). Optional peer → no hard error; bump sqladmin only if diagram features are used (flagged, not auto-changed).
- **Ordering.** The sqladmin migration cannot run before the publish — `^0.1.0` is uninstallable until `0.1.0` is live. Sequenced as Phase 4 / external Step, after Ordered Step 9.

---

## Critical Files

- [`package.json`](package.json) — the current root manifest that `workspace-restructure` copies verbatim into `packages/lib/package.json`; the surface being published (`name`, `version 0.1.0`, `files`, 23-subpath `exports`, `build:lib` script). No `publishConfig`/`prepublishOnly` today.
- [`LICENSE`](LICENSE) — PolyForm Noncommercial 1.0.0; must ship inside the package (copied to `packages/lib/LICENSE`).
- [`README.md`](README.md) — the npm landing page and install/usage guidance; copied to `packages/lib/README.md`.
- [`plans/workspace-restructure.md`](plans/workspace-restructure.md) — the dependency; establishes that the library package moves to `packages/lib/` with `name`/`version`/`exports`/`files` byte-identical and builds via `npm run build:lib` to `packages/lib/dist/lib`.
- [`/home/jika/typescript/sqladmin/frontend/package.json`](/home/jika/typescript/sqladmin/frontend/package.json) — the external consumer; line 14 `"@jimka/typescript-ui": "file:../../typescript-ui"` is what the migration replaces with `"^0.1.0"`.

---

## Non-Goals

- **Release automation** — no tag-triggered publish workflow, npm-token/OIDC pipeline, changesets, or `semantic-release`. A first one-off `0.1.0` is published manually; the guards live in the manifest (Architecture Decision). Adding CI publishing is a later, separate concern.
- **A CHANGELOG or versioning convention** — none exists in the repo; not introduced here.
- **Any library API, `exports`, `files`, or version change** — the published surface is exactly the restructure-preserved one; this plan only adds `publishConfig` + `prepublishOnly` and ships LICENSE/README.
- **Editing the `workspace-restructure` structure** — this plan consumes its output (`packages/lib`) and does not re-open its decisions.
- **Bumping past `0.1.0` or publishing `0.1.1+`** — out of scope; the `0.x` caret note is guidance for the consumer range only.
