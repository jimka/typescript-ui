---
depends-on: [workspace-restructure]
touches-shared: [packages/lib/package.json]
---

# Prepare `@jimka/typescript-ui@0.1.0` Release (Reversible, Pre-Publish) — Implementation Plan

## Overview

The **reversible, local half** of the first public release: guard the manifest, ship the license/readme, prove the packed surface, and verify the real downstream consumer (sqladmin) against the **exact bytes** that would be published — all **without touching the npm registry** and without permanently altering sqladmin. This plan **stops before any `npm publish`**. The immutable half — the actual publish, the `v0.1.0` tag, and sqladmin's permanent `^0.1.0` migration — is a separate follow-up plan, [`plans/publish-0-1-0.md`](plans/publish-0-1-0.md), which consumes the artifact this plan produces.

This is a **split** of the original combined plan (its Phases 1–2 become this plan, plus one new consumer-verification phase; its Phases 3–4 become `publish-0-1-0.md`). It operates on the **post-`workspace-restructure` layout**: the library package is `packages/lib/package.json` (the current root [`package.json`](package.json) moved verbatim), built via `npm run build:lib` to `packages/lib/dist/lib`. All paths are inside `packages/lib` unless stated otherwise.

The package is `@jimka/typescript-ui` — **scoped**, so npm publishes it **private by default**; `version` is already `0.1.0`; `files` is `["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md"]` ([package.json:101-105](package.json#L101)); `exports` has 23 subpaths ([package.json:7-100](package.json#L7)); the build script is `build:lib` ([package.json:113](package.json#L113)). There is **no** `publishConfig` and **no** `prepublishOnly` today (verified — grep returns nothing).

Why the split, and why the consumer verification is a first-class phase: sqladmin has always consumed this package through a **live symlink** ([`frontend/package.json:14`](/home/jika/typescript/sqladmin/frontend/package.json#L14): `"file:../../typescript-ui/packages/lib"`), so the real *packaged* surface (the `files` array + the 23-subpath `exports` map resolved against the packed layout) and the consumer's build against a *copied* (non-symlink) package have **never** been exercised. `npm pack` output is byte-identical to what `npm publish` uploads, so verifying sqladmin against the kept `.tgz` gives full pre-publish confidence with the registry untouched — and, if a problem surfaces, the author can edit the lib, rebuild, re-pack, reinstall, and re-verify without ever burning the immutable `0.1.0`.

---

## Architecture Decisions

### Public scoped publish — encode `publishConfig.access`, don't rely on a flag

`@jimka/typescript-ui` is scoped (`@jimka/…`), so `npm publish` defaults to **restricted (private)** and fails on a free account, or silently publishes private on a paid one. Add `"publishConfig": { "access": "public" }` to `packages/lib/package.json` so the eventual first `npm publish` (in `publish-0-1-0.md`) goes public without a forgotten `--access public` flag. **Rationale:** a forgotten `--access public` is the single most common first-scoped-publish failure; baking it into the manifest makes the outcome independent of how the publish command is typed. This plan does not publish, but the guard belongs here — it is part of preparing the manifest, and `npm publish --dry-run` (Step 4) reads it to report public.

**Public access ≠ open-source license.** The package's `license` is `LicenseRef-PolyForm-Noncommercial-1.0.0` ([package.json:5](package.json#L5)) — PolyForm Noncommercial 1.0.0, a source-available *noncommercial* license. `access: public` only controls registry *visibility/installability*; the noncommercial license still governs *use*. This is intended (the author's choice); it is noted here only so the implementer does not confuse "public npm access" with "open source" and does not "fix" the license.

### Build guard — `prepublishOnly` rebuilds `dist/lib`

`dist/lib` is built and **gitignored**, so a future publish tarball would ship whatever happens to be on disk — which may be empty, partial (a clean checkout has no `dist`), or stale. Add `"prepublishOnly": "npm run build:lib"` (the exact existing build script — `tsc -p tsconfig.lib.json && tsc-alias -p tsconfig.lib.json && vite build --config vite.lib.config.ts`, [package.json:113](package.json#L113)) so a later `npm publish` rebuilds `dist/lib` first. **Rationale:** `0.1.0` is immutable — a botched publish (empty or stale `dist/lib`) can only be corrected by burning a `0.1.1` bump; the guard makes shipping a bad tarball impossible. **Note the lifecycle boundary:** npm runs `prepublishOnly` on `npm publish` **only** — **not** on `npm pack`. So the pack-based verification below cannot rely on it and must run `npm run build:lib` explicitly first. The guard's job is to protect the real `npm publish`, which happens in `publish-0-1-0.md`, not here. (`prepublishOnly` is used rather than `prepack` per this plan's mandate; `prepack` would also cover pack but is out of scope to introduce.)

### Ship a LICENSE and README inside the package

npm **always** includes `package.json`, `README(.md)`, and `LICENSE`/`LICENCE` in a tarball **regardless of the `files` array — but only if those files exist in the package root.** Post-restructure, `packages/lib` may have neither: `workspace-restructure` keeps `README.md` and `LICENSE` at the repo root (it moves `LICENSE-FONTAWESOME.md` but not `LICENSE`, and only edits root `README.md`). Packing from `packages/lib` as-is would produce a package with **no LICENSE** (unacceptable for a source-available noncommercial license — the license *text is the grant*) and a **blank npm page** (no README). Copy both into `packages/lib` before packing: `packages/lib/LICENSE` and `packages/lib/README.md`. **Rationale:** for an immutable first public release, the license text and the npm landing page are load-bearing; they cost one `cp` each and ship automatically once present. (The root `README.md`'s existing install/usage guidance and its `llms.txt` pointer apply verbatim to consumers, so the root copy is the correct source.)

### Verify the packed surface before the publish — resolution, not execution

A mandatory core check. Three layers, all run from `packages/lib` (this plan performs no publish):

1. **`npm run build:lib`** (explicit — `npm pack` does not run `prepublishOnly`), then **`npm publish --dry-run`** and **`npm pack`** operate on that freshly built `dist/lib`.
2. **Tarball file-list assertion.** The tarball must contain exactly the `files` array (`dist/lib/**`, `llms.txt`, `LICENSE-FONTAWESOME.md`) **plus npm's always-included set** (`package.json`, `README.md`, `LICENSE`). Nothing else (no `src/`, no configs, no `tests/`, no VitePress `docs/`). The "always-included set" is *expected*, not a leak — the check asserts `files` ⊆ tarball and that no out-of-`files` tree (`src`, `docs`, `tests`, `*.config.*`, `tsconfig*`) appears.
3. **Install the packed `.tgz` into a throwaway scratch dir and resolve two real subpaths** from the `exports` map against the **packed** layout — proving end-to-end resolution against the shipped files, not source. Use `import.meta.resolve('@jimka/typescript-ui/core')` and `import.meta.resolve('@jimka/typescript-ui/component/button')`, and assert each resolves to a file that exists under `node_modules/@jimka/typescript-ui/dist/lib/`.

**Resolve, do not import.** typescript-ui UI modules touch `document` at import scope (a documented project invariant — `core.es.js` is even listed in `sideEffects`), so *executing* them under plain Node (`node -e "import('…/core')"`) throws `document is not defined` — a false failure that says nothing about packaging. `import.meta.resolve` (stable in Node ≥ 20; CI uses Node 22) walks the `exports` map and the packed files **without evaluating** the module, which is exactly what "does the packaged surface resolve" asks. **Choice of subpaths:** `core` is the bare-package entry every consumer hits; `component/button` proves a nested `component/*` key resolves. Avoid `component/diagram` (pulls the optional `elkjs` peer) so the scratch check needs no extra install.

### Keep the tarball — it is the artifact the consumer phase and the follow-up consume

Unlike a throwaway pack check, this plan **keeps** `packages/lib/jimka-typescript-ui-0.1.0.tgz` after Step 6. It is the byte-identical stand-in for the published package, consumed by Phase 3 (sqladmin verification) and available to iterate against. Do **not** delete it. (The original combined plan deleted the tgz after its scratch check; this plan explicitly overrides that — the tgz is the deliverable that makes pre-publish consumer verification possible.)

### Verify the real consumer against the exact bytes — before publishing (the reason for the split)

Because sqladmin has only ever consumed the library through a **symlink**, no one has proven the library works when installed as a **copied, non-symlink** package the way the registry would deliver it. `npm install <tarball>` **extracts** the `.tgz` into `node_modules` as a real directory — a copy, exactly as the published package appears — so pointing sqladmin's dependency at the kept `.tgz` reproduces the published-consumer situation precisely, without publishing. **Decision:** run sqladmin's frontend build + typecheck and drive the app against the tarball, then **revert sqladmin to exactly as found**. This is the whole point of the split: catch a packaging/consumer problem while `0.1.0` is still un-minted and correctable by a rebuild-and-repack loop. The **permanent** `^0.1.0` migration is explicitly *not* done here — it belongs to `publish-0-1-0.md`, after the publish, because `^0.1.0` is uninstallable until `0.1.0` is live on the registry.

### No publish, no tag, no permanent consumer change — handed off to `publish-0-1-0.md`

This plan is deliberately registry-free and non-destructive: it leaves the package fully guarded, its packed surface proven, and the real consumer verified against the exact bytes — but it does **not** run `npm publish`, does **not** create the `v0.1.0` git tag, and does **not** permanently repoint sqladmin. Those three irreversible actions are the entire content of the follow-up plan [`plans/publish-0-1-0.md`](plans/publish-0-1-0.md), which begins from the artifact and manifest state this plan produces. Publishing is a Non-Goal here (see Non-Goals).

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

### Phase 2 — Packed-surface verification (no publish)

4. **Build, then dry-run publish.** From `packages/lib`: `npm run build:lib` (explicit — `npm pack` in Step 5 does not run `prepublishOnly`), then `npm publish --dry-run`. Expect the dry-run to print the tarball contents and a "would publish" summary with **access: public**. Do not proceed if it reports restricted/private access or a build error. (This is a dry run — it contacts nothing and uploads nothing.)

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
   Expect two `OK …` lines resolving under `node_modules/@jimka/typescript-ui/dist/lib/`. **Do not** attempt `node -e "import('@jimka/typescript-ui/core')"` — DOM side effects at import scope make it throw `document is not defined`, a false failure. Clean up **only the scratch dir**: `rm -rf "$SCRATCH"`. **KEEP** `packages/lib/jimka-typescript-ui-0.1.0.tgz` — do NOT delete it; Phase 3 installs it into sqladmin.

### Phase 3 — Pre-publish consumer verification against the local tarball (EXTERNAL repo)

> **This phase runs in `/home/jika/typescript/sqladmin`, not typescript-ui.** It temporarily points sqladmin at the kept `.tgz`, verifies the app end-to-end, then **reverts sqladmin to exactly as found**. The registry is never touched, and no sqladmin change is committed.

Preconditions: Phase 2 passed and `packages/lib/jimka-typescript-ui-0.1.0.tgz` still exists.

7. **Point sqladmin's frontend at the tarball.** In `/home/jika/typescript/sqladmin/frontend`, edit [`package.json`](/home/jika/typescript/sqladmin/frontend/package.json) line 14, changing
   `"@jimka/typescript-ui": "file:../../typescript-ui/packages/lib"`
   →
   `"@jimka/typescript-ui": "file:../../typescript-ui/packages/lib/jimka-typescript-ui-0.1.0.tgz"`.
   A `file:` spec pointing at a `.tgz` makes npm **extract** it into `node_modules` as a real copied directory (not a symlink) — reproducing exactly how the published package would appear. Leave `elkjs: "^0.9.3"` (line 15) unchanged.

8. **Remove the stale symlink and install.** From `/home/jika/typescript/sqladmin/frontend`:
   - `rm -rf node_modules/@jimka/typescript-ui` — deletes the current symlink (`node_modules/@jimka/typescript-ui -> ../../../../typescript-ui/packages/lib`, verified) so npm re-resolves from the tarball rather than keeping the old `file:` link.
   - `npm install` — extracts the tgz and updates `package-lock.json`.
   - Confirm it's now a real directory, not a symlink: `test -L node_modules/@jimka/typescript-ui && echo SYMLINK || echo REAL-DIR` → expect `REAL-DIR`; and `node_modules/@jimka/typescript-ui/dist/lib/core.es.js` exists.

9. **Build and typecheck the frontend.** From `/home/jika/typescript/sqladmin/frontend`:
   - `npm run build` (`tsc --noEmit && vite build`) — green, with all `@jimka/typescript-ui/*` subpath imports resolving against the extracted package.
   - `npm run typecheck` (`tsc --noEmit`) — green. (Note `build` already includes the same `tsc --noEmit`; running `typecheck` is the explicit standalone confirmation.)

10. **Drive the app to confirm it renders.** Use the sqladmin **`verify` skill** (`Skill(verify)` — it launches Postgres/backend/frontend as needed and drives the app in a browser). Confirm the UI loads and renders without console errors against the extracted `0.1.0` package. **Login uses Host `sqladmin-db`** (Database `sqladmin`, user `sqladmin`, password `sqladmin`) — the default `localhost` is rejected.

11. **Iterate if a problem surfaces (registry stays untouched).** If Step 9 or 10 reveals a library packaging/consumer defect, fix it in typescript-ui, then re-run from `packages/lib`: `npm run build:lib` → `npm pack` (overwrites the same `jimka-typescript-ui-0.1.0.tgz`), then back in sqladmin `frontend` re-run `rm -rf node_modules/@jimka/typescript-ui && npm install`, and re-verify Steps 9–10. Repeat until green. **`0.1.0` is never published during iteration** — only the local tgz changes.

12. **Revert sqladmin to exactly as found.** Once verified, undo every temporary sqladmin change so the repo is left pristine (uncommitted, since nothing here is committed):
    - `git -C /home/jika/typescript/sqladmin checkout -- frontend/package.json frontend/package-lock.json` — restores the `file:../../typescript-ui/packages/lib` dependency and lockfile.
    - `cd /home/jika/typescript/sqladmin/frontend && npm install` — re-establishes the original **symlink** to the sibling checkout.
    - Confirm restored: `test -L node_modules/@jimka/typescript-ui && echo SYMLINK-RESTORED` → expect `SYMLINK-RESTORED`; and `git -C /home/jika/typescript/sqladmin status --short frontend/` shows no changes.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/package.json` (add `publishConfig.access` + `prepublishOnly` script) |
| Create | `packages/lib/LICENSE` (copy of repo-root `LICENSE`, if not already present) |
| Create | `packages/lib/README.md` (copy of repo-root `README.md`, if not already present) |
| Create (kept) | `packages/lib/jimka-typescript-ui-0.1.0.tgz` (the packed artifact — **kept**, not deleted; consumed by Phase 3 and by `publish-0-1-0.md`) |
| Temporary (external, reverted) | `/home/jika/typescript/sqladmin/frontend/package.json` (`file:` symlink → `file:` tarball, then reverted) |
| Temporary (external, reverted) | `/home/jika/typescript/sqladmin/frontend/package-lock.json` (regenerated, then reverted) |

No library source, `exports`, `files`, `name`, or `version` changes. No git tag. No `npm publish`.

---

## Expected Behaviour

Concrete, checkable outcomes (all CLI/manual — this plan adds no unit-testable logic):

- **Manifest guards present.** `packages/lib/package.json` has `publishConfig.access === "public"` and `scripts.prepublishOnly === "npm run build:lib"`; no duplicate of either existed before.
- **Dry-run reports public.** After an explicit `npm run build:lib`, `npm publish --dry-run` (from `packages/lib`) prints tarball contents and reports **public** access — never restricted. Nothing is uploaded.
- **Tarball = `files` + npm-always set, nothing more.** `npm pack` yields a tgz containing exactly `dist/lib/**`, `llms.txt`, `LICENSE-FONTAWESOME.md`, `package.json`, `README.md`, `LICENSE` — and **no** `src/`, `tests/`, `docs/`, `*.config.*`, or `tsconfig*`.
- **Every `exports` target is in the tarball.** Each `import` path in the 23-subpath map (e.g. `dist/lib/core.es.js`, `dist/lib/component/button.es.js`, `dist/lib/glyphs/index.es.js`) and its matching `types/**` `.d.ts` is present.
- **Packed subpaths resolve.** In a scratch install of the tgz, `import.meta.resolve` of `@jimka/typescript-ui/core` and `@jimka/typescript-ui/component/button` each returns a URL to an existing file under `node_modules/@jimka/typescript-ui/dist/lib/` — without executing the module.
- **Tarball kept.** `packages/lib/jimka-typescript-ui-0.1.0.tgz` still exists after Phase 2.
- **Consumer verified against exact bytes.** With sqladmin's frontend pointed at the tarball, `node_modules/@jimka/typescript-ui` is a **real directory** (not a symlink) at `0.1.0`; `npm run build` and `npm run typecheck` pass; the app launches and renders without console errors (manual, via the `verify` skill, Host `sqladmin-db`).
- **sqladmin left pristine.** After Phase 3, `frontend/package.json` reads `"@jimka/typescript-ui": "file:../../typescript-ui/packages/lib"` again, `node_modules/@jimka/typescript-ui` is a symlink again, and `git status` in sqladmin shows no changes.
- **Registry untouched.** No `npm publish` ran; `@jimka/typescript-ui@0.1.0` is not on the registry as a result of this plan.

---

## Verification

Run in order; this plan never publishes.

1. **Manifest:** `grep -n publishConfig packages/lib/package.json` and `grep -n prepublishOnly packages/lib/package.json` each show exactly the added lines; `ls packages/lib/LICENSE packages/lib/README.md` both exist.
2. **Packaged surface (core check):** from `packages/lib`, `npm run build:lib`, then `npm publish --dry-run` (reports public), then `npm pack` + the `tar -tzf … | sort` assertions (Steps 4–5), then the scratch-install `node verify.mjs` (Step 6). All green; the `.tgz` is kept.
3. **Consumer (external, against the tarball):** in `sqladmin/frontend` pointed at the tgz, `test -L node_modules/@jimka/typescript-ui` → REAL-DIR; `npm ls @jimka/typescript-ui` → `0.1.0`; `npm run build && npm run typecheck` green; app renders via `Skill(verify)` (Host `sqladmin-db`).
4. **Revert (external):** after verification, `git -C /home/jika/typescript/sqladmin checkout -- frontend/package.json frontend/package-lock.json` + `npm install`; confirm the symlink is restored and `git status --short frontend/` is clean.

---

## Potential Challenges

- **`dist/lib` is partial/absent on a clean checkout.** `npm pack`/`--dry-run` do **not** trigger `prepublishOnly`, so Phase 2 builds explicitly first (Step 4). The guard only protects the real `npm publish` (in `publish-0-1-0.md`).
- **Executing modules under Node throws on `document`.** Verification must **resolve**, not import (Architecture Decision); a `node -e import()` attempt is a false failure, not a packaging bug.
- **Deleting the tgz too early.** The original combined plan deleted the pack artifact; this plan **keeps** it — Phase 3 and the follow-up depend on it. Only the scratch dir is removed in Step 6.
- **sqladmin stale symlink.** If `frontend/node_modules/@jimka/typescript-ui` isn't removed before `npm install`, npm may keep the old `file:` symlink instead of extracting the tarball. Remove it explicitly (Step 8), then confirm it's a real directory.
- **Forgetting to revert sqladmin.** The tarball `file:` spec and regenerated lockfile must not be committed or left in place — Step 12 restores both via `git checkout` + `npm install`, and confirms a clean `git status`. The permanent `^0.1.0` migration is `publish-0-1-0.md`'s job, not this one.
- **`elkjs` peer version drift** (lib `^0.10.0` optional peer vs sqladmin `^0.9.3`, line 15). The peer is optional, so npm won't hard-error; the two subpaths verified in Step 6 (`core`, `component/button`) avoid `component/diagram` and its `elkjs` pull. Leave sqladmin's `elkjs` unchanged for this verification; any bump is out of scope here.

---

## Critical Files

- [`package.json`](package.json) — the current root manifest that `workspace-restructure` copies verbatim into `packages/lib/package.json`; the surface being prepared (`name`, `version 0.1.0`, `files`, 23-subpath `exports`, `build:lib` script). No `publishConfig`/`prepublishOnly` today.
- [`LICENSE`](LICENSE) — PolyForm Noncommercial 1.0.0; must ship inside the package (copied to `packages/lib/LICENSE`).
- [`README.md`](README.md) — the npm landing page and install/usage guidance; copied to `packages/lib/README.md`.
- [`plans/workspace-restructure.md`](plans/workspace-restructure.md) — the dependency; establishes that the library package moves to `packages/lib/` with `name`/`version`/`exports`/`files` byte-identical and builds via `npm run build:lib` to `packages/lib/dist/lib`.
- [`plans/publish-0-1-0.md`](plans/publish-0-1-0.md) — the follow-up that consumes this plan's kept tarball and guarded manifest to perform the immutable half: `npm publish`, the `v0.1.0` tag, and sqladmin's permanent `^0.1.0` migration.
- [`/home/jika/typescript/sqladmin/frontend/package.json`](/home/jika/typescript/sqladmin/frontend/package.json) — the external consumer; line 14 `"@jimka/typescript-ui": "file:../../typescript-ui/packages/lib"` (a symlink) is what Phase 3 temporarily repoints at the tarball and then restores. Scripts: `build` = `tsc --noEmit && vite build`, `typecheck` = `tsc --noEmit`.
- [`/home/jika/typescript/sqladmin/.claude/skills/verify/SKILL.md`](/home/jika/typescript/sqladmin/.claude/skills/verify/SKILL.md) — the `verify` skill driving the sqladmin app end-to-end; documents the `sqladmin-db` login host used in Step 10.

---

## Non-Goals

- **Publishing** — no `npm publish`, not even `--dry-run` beyond the read-only verification report. `0.1.0` is not minted by this plan. The actual publish is [`plans/publish-0-1-0.md`](plans/publish-0-1-0.md).
- **The `v0.1.0` git tag** — created in the follow-up, alongside the publish.
- **sqladmin's permanent `^0.1.0` migration** — this plan only *temporarily* installs the tarball and then reverts sqladmin to its original `file:` symlink. The permanent `file:` → `^0.1.0` swap and its commit belong to `publish-0-1-0.md`, after `0.1.0` is live (`^0.1.0` is uninstallable before then).
- **Release automation** — no tag-triggered publish workflow, npm-token/OIDC pipeline, changesets, or `semantic-release`. The guards live in the manifest.
- **A CHANGELOG or versioning convention** — none exists in the repo; not introduced here.
- **Any library API, `exports`, `files`, `name`, or `version` change** — the prepared surface is exactly the restructure-preserved one; this plan only adds `publishConfig` + `prepublishOnly` and ships LICENSE/README.
- **Bumping `elkjs` in sqladmin** — the optional peer drift is flagged, not changed, during verification.
- **Editing the `workspace-restructure` structure** — this plan consumes its output (`packages/lib`) and does not re-open its decisions.

---

## Implementation Notes

Deviations and findings from the actual run (recorded per the `implement` skill; not a redesign).

### Tarball location — worktree, not the main tree

All build/pack work ran inside the `/implement` worktree (`.worktrees/prepare-0-1-0-release`), so the kept artifact is `.worktrees/prepare-0-1-0-release/packages/lib/jimka-typescript-ui-0.1.0.tgz`, and Phase 3 pointed sqladmin at that path rather than the plan's `packages/lib/…tgz`. Equivalent verification — a byte-identical `npm pack` of the same freshly built `dist/lib`. `*.tgz` is **not** gitignored, so the artifact was deliberately **not** copied into the main tree (it would dirty `git status`); it is a build artifact and is not committed. The follow-up `publish-0-1-0` rebuilds/repacks via `prepublishOnly` and does not depend on this specific file.

### elkjs peer ERESOLVE — the plan's "optional peer won't hard-error" premise was wrong

The Potential-Challenges / Non-Goals assumption that the `elkjs` peer drift is benign is **incorrect**. `peerOptional` is optional only in *presence* — when the peer *is* installed at an incompatible version, npm enforces the range. Installing the tarball (an extracted copy, as the registry delivers it) into sqladmin (`elkjs@^0.9.3`) **hard-errors with ERESOLVE** against the lib's `peerOptional elkjs@^0.10.0`. Crucially, the **symlink** install does *not* hit this (npm doesn't enforce `peerOptional` for a linked directory dep) — so it is specifically a **published/registry-consumer** problem, exactly what `publish-0-1-0`'s permanent `^0.1.0` migration will encounter. Verified sqladmin builds/typechecks/renders against the tarball via `npm install --legacy-peer-deps`, and cleanly (no flag) after bumping sqladmin's `elkjs` to `^0.10.0`. **Per user decision, the fix is to bump sqladmin's `elkjs` to `^0.10.0` (keeping the lib's `^0.10.0` peer), done as part of `publish-0-1-0`'s migration — not here** (this plan reverts sqladmin pristine at `elkjs@^0.9.3`). `publish-0-1-0.md` should carry the `elkjs` bump alongside the `file:` → `^0.1.0` swap.

### Diagram-empty detour during Phase 3 — stale vite dev cache, not a packaging/lib defect

While driving sqladmin against the tarball (Phase 3, Step 10), the schema/database diagram rendered edges but no table nodes. Root-caused to a **stale vite dev-server cache** (`node_modules/.vite`), not a packaging or library defect: the lib builds both node components and lays them out correctly (confirmed by instrumentation), and a **production build renders the diagram** (tables `orders`/`customers` with FK cardinality markers). The workspace restructure changed sqladmin's dependency path, but vite's URL-keyed cache was never invalidated. Clearing `.vite` + restarting the dev server resolved it — no code change. Not a release blocker; recorded in project memory.

### Worktree build needs node_modules

`build:lib` in the worktree required deps; `node_modules` was symlinked to the main tree's install per project convention, rather than a fresh `npm install`.
