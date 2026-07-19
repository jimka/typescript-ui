---
depends-on: [workspace-restructure, prepare-0-1-0-release]
---

# Publish `@jimka/typescript-ui@0.1.0` — Implementation Plan

## Overview

The **irreversible half** of the first public release: run the actual `npm publish` of `@jimka/typescript-ui@0.1.0` to the public npm registry, mark it with the `v0.1.0` git tag, then **permanently** migrate the sqladmin consumer off its `file:` symlink onto the published `^0.1.0`. This plan is the direct continuation of [`plans/prepare-0-1-0-release.md`](plans/prepare-0-1-0-release.md) and does **not** repeat any of its work.

**All preparation and verification are already done in `prepare-0-1-0-release` — do not redo them here.** That sibling plan has already: added `"publishConfig": { "access": "public" }` and `"prepublishOnly": "npm run build:lib"` to `packages/lib/package.json`; copied `LICENSE` and `README.md` into `packages/lib`; built and packed the library and asserted the packed surface end-to-end (tarball file-list ⊆ `files` + npm's always-included set, and two `exports` subpaths resolving under the packed `dist/lib`); **kept** the artifact `packages/lib/jimka-typescript-ui-0.1.0.tgz`; and verified sqladmin's frontend building, typechecking, and rendering against that exact tarball, then **reverted sqladmin to its original `file:../../typescript-ui` symlink state**. This plan starts from that guarded, proven manifest and consumes none of that effort again — its whole job is the two irreversible actions the prepare plan deliberately stopped short of.

`0.1.0` is **immutable**. Once `npm publish` succeeds, that version can never be re-uploaded or changed — a mistake (empty/stale `dist/lib`, wrong access, missing README) can only be corrected by burning a `0.1.1` bump. Because the packed surface and the real consumer were both already proven in `prepare-0-1-0-release`, the remaining risk is confined to the publish transaction itself, which is what this plan focuses on.

---

## Architecture Decisions

### Verification is already complete — this plan only publishes and migrates

`prepare-0-1-0-release` performed the entire pre-publish gauntlet (manifest guards, LICENSE/README, packed-surface assertions, and consumer verification against the byte-identical `.tgz`) and left the registry untouched. **This plan does not re-run any of it.** It assumes the manifest at `packages/lib/package.json` already carries `publishConfig.access` + `prepublishOnly`, and that `packages/lib/LICENSE` / `packages/lib/README.md` exist. The only new actions are the immutable ones: `npm publish`, the `v0.1.0` tag, and sqladmin's permanent dependency swap. **Rationale:** the split exists precisely so the reversible, correctable work is finished and confirmed *before* the un-mintable `0.1.0` is cut; folding the checks back in here would duplicate the sibling and blur the "everything correctable is already done" guarantee.

### `prepublishOnly` rebuilds `dist/lib` fresh at publish time — independent of the kept tarball

`dist/lib` is built and **gitignored**, so the bytes on disk at publish time may be stale relative to source. The `prepublishOnly` guard (`npm run build:lib` — `tsc -p tsconfig.lib.json && tsc-alias -p tsconfig.lib.json && vite build --config vite.lib.config.ts`) added by `prepare-0-1-0-release` runs on `npm publish` **only** (not on `npm pack`), so the published tarball is **rebuilt from current source** as part of the publish transaction. **Consequence:** the publish does not ship the kept `packages/lib/jimka-typescript-ui-0.1.0.tgz` — it builds and packs afresh. The kept tarball was the prepare plan's verification artifact; the guarantee that the published tarball is current comes from the guard, not from reusing that file. **Rationale:** an immutable first publish must ship a provably-fresh `dist/lib`; the manifest guard makes that automatic regardless of disk state.

### Public scoped publish — no `--access` flag needed

`@jimka/typescript-ui` is scoped, so `npm publish` defaults to **restricted (private)**. `prepare-0-1-0-release` already encoded `"publishConfig": { "access": "public" }` in the manifest, so a bare `npm publish` goes public with no `--access public` flag to forget. **Public access ≠ open-source license:** the `license` is `LicenseRef-PolyForm-Noncommercial-1.0.0` (PolyForm Noncommercial 1.0.0, source-available *noncommercial*); `access: public` controls only registry visibility/installability, not use. Do not "fix" the license — this is intended.

### No automated publish workflow for 0.1.0 — manual publish, git-tag marker

No release/publish workflow or release convention exists in the repo (`.github/workflows/` has only `docs.yml`); there is no CHANGELOG. A first one-off `0.1.0` cut does not justify standing up an OIDC/npm-token release pipeline, a tag-triggered workflow, or changesets. **Decision:** publish manually from `packages/lib` (`npm publish`), and mark the release with a git tag `v0.1.0` — the minimal, reversible convention that establishes a marker a future automated pipeline can build on. **Rationale:** mirror the repo's current convention (there is none → do the least that is safe) rather than inventing machinery a first publish doesn't need. Adding release automation is a Non-Goal.

### Consumer version range — `^0.1.0` and 0.x caret semantics

sqladmin migrates to `^0.1.0`. During **0.x**, caret is special: `^0.1.0` permits `0.1.x` (patches) but **not** `0.2.0`. In 0.x a **breaking** change bumps the **minor** (0.2.0), which `^0.1.0` deliberately excludes; a backward-compatible fix bumps the **patch** (0.1.1), which it accepts. **Rationale:** documented so the sqladmin range reads as "auto-accept 0.1.x patches, hold at the 0.1 line," not as normal 1.x caret.

---

## Public API

**No library API changes, and no manifest changes in this plan.** `name`, `version`, `exports`, `files`, and the type surface are untouched; `publishConfig` and `prepublishOnly` were already added by `prepare-0-1-0-release`. This plan publishes the existing surface and migrates one external consumer — it edits no library source or manifest.

---

## Ordered Implementation Steps

Prerequisite: `prepare-0-1-0-release` is complete — `packages/lib/package.json` carries `publishConfig.access` + `prepublishOnly`, `packages/lib/LICENSE` / `packages/lib/README.md` exist, and both the packed surface and sqladmin (against the kept `.tgz`) were verified and sqladmin reverted to its `file:` symlink. This plan does **not** re-verify those; if in doubt that the prepare plan ran, stop and run it first rather than re-deriving its checks here.

### Phase 1 — Publish (immutable), from `packages/lib`

All steps in this phase run with cwd `packages/lib` unless noted.

1. **Authenticate to npm.** `npm whoami` — expect the account that owns the `@jimka` scope. If not logged in (or the wrong user), `npm login` and re-check. Do not proceed under an account without publish rights to `@jimka`.

2. **Publish.** From `packages/lib`: `npm publish`. No `--access` flag is needed — `publishConfig.access: public` supplies it. `prepublishOnly` runs first and rebuilds `dist/lib` from current source, so the uploaded tarball is guaranteed fresh (it is built and packed anew, independent of the kept verification `.tgz`). Expect success and **public** access in the output. **This is the irreversible step — `0.1.0` cannot be re-published.** Distinguish a `prepublishOnly` build failure (aborts the publish before upload — safe to fix and retry) from a completed upload (final).

3. **Confirm the published package.** `npm view @jimka/typescript-ui version` → `0.1.0`; `npm view @jimka/typescript-ui` shows **public** access, the README present, and a file list consistent with the packed surface `prepare-0-1-0-release` asserted (`dist/lib/**`, `llms.txt`, `LICENSE-FONTAWESOME.md`, `package.json`, `README.md`, `LICENSE`). If anything is wrong, it can only be fixed by a later `0.1.1` — note it and stop; do not attempt to re-publish `0.1.0`.

4. **Tag the release.** From the repo root: `git tag v0.1.0 && git push origin v0.1.0` — a marker only (see Architecture Decisions), not a trigger for any workflow.

5. **Delete the leftover verification tarball.** From the repo root: `rm -f packages/lib/jimka-typescript-ui-0.1.0.tgz` — the kept artifact from `prepare-0-1-0-release`. It is gitignored/untracked so it was never committed, but remove it so it is not mistaken for a shipped artifact. The published package was built fresh by `prepublishOnly`, not from this file.

### Phase 2 — sqladmin permanent migration (EXTERNAL repo, AFTER publish confirms live)

See the dedicated section below; runs in `/home/jika/typescript/sqladmin`, only after Step 3 confirms `0.1.0` is live on the registry (`^0.1.0` is uninstallable before then).

---

## External repo: `/home/jika/typescript/sqladmin` — permanent migration to `^0.1.0`

This section is executed in the **sqladmin** repository, **after** `@jimka/typescript-ui@0.1.0` is confirmed live on npm (Phase 1 Step 3). Do not run it from typescript-ui. Unlike `prepare-0-1-0-release`'s temporary, reverted tarball install, **this is the permanent swap and it is committed** in the sqladmin repo.

sqladmin's [`frontend/package.json`](/home/jika/typescript/sqladmin/frontend/package.json) currently declares (verified, line 14):

```json
"@jimka/typescript-ui": "file:../../typescript-ui",
```

npm resolves that `file:` spec as a **symlink**: `frontend/node_modules/@jimka/typescript-ui -> ../../../../typescript-ui` (verified via `readlink`). Prepare's temporary tarball verification has already been reverted, so sqladmin is back in exactly this symlink state at the start of this phase. The migration swaps the live symlink for the published package pulled from the registry — a real installed directory, whose bundled `dist/lib` is what sqladmin already consumes today (sqladmin imports the built `dist/lib`, not source).

**Steps (in `/home/jika/typescript/sqladmin/frontend`):**

1. **Edit `frontend/package.json`:** change the dependency to `"@jimka/typescript-ui": "^0.1.0"` (see 0.x caret semantics above — accepts `0.1.x`, holds at the 0.1 line). Leave `elkjs: "^0.9.3"` (line 15) unchanged.

2. **Remove the stale symlink** so npm re-resolves from the registry rather than keeping the old `file:` link: `rm -rf node_modules/@jimka/typescript-ui` (the parent `@jimka` dir may remain; npm recreates the child).

3. **Install from the registry:** `npm install` — pulls the published `@jimka/typescript-ui@0.1.0` (with its bundled `dist/lib` and its `dependencies`) and updates `package-lock.json`. Confirm it is now a **real directory**, not a symlink: `test -L node_modules/@jimka/typescript-ui && echo SYMLINK || echo REAL-DIR` → expect `REAL-DIR`; and `npm ls @jimka/typescript-ui` → `0.1.0`.

4. **Build and typecheck the frontend:** `npm run build` (`tsc --noEmit && vite build`) and `npm run typecheck` (`tsc --noEmit`) — both green, with all `@jimka/typescript-ui/*` subpath imports resolving against the installed registry package.

5. **Verify the app renders** — drive the sqladmin app end-to-end via the sqladmin **`verify` skill** (`Skill(verify)`), confirming the UI loads and renders without console errors against the installed `0.1.0` package. **Login uses Host `sqladmin-db`** (Database `sqladmin`, user `sqladmin`, password `sqladmin`) — the default `localhost` is rejected.

6. **Commit** the `frontend/package.json` + `frontend/package-lock.json` change in the sqladmin repo — this is the **permanent** migration (unlike prepare's reverted tarball install). Commit only these two files.

**Note — `elkjs` peer drift.** The library declares `elkjs` as an **optional** peer at `^0.10.0` (`packages/lib/package.json`); sqladmin's `frontend/package.json` pins `elkjs: "^0.9.3"` (line 15). Because the peer is optional, npm will not hard-error, but the versions diverge. If the schema-diagram (`component/diagram`) features are used, bump sqladmin's `elkjs` to `^0.10.0` to match; otherwise leave it and revisit. Flag, don't silently change beyond the dependency swap.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Delete | `packages/lib/jimka-typescript-ui-0.1.0.tgz` (leftover verification artifact from `prepare-0-1-0-release`; untracked) |
| — (external) | `/home/jika/typescript/sqladmin/frontend/package.json` (`file:../../typescript-ui` → `^0.1.0`) |
| — (external) | `/home/jika/typescript/sqladmin/frontend/package-lock.json` (regenerated by `npm install`) |

No library source, manifest (`package.json`), `exports`, `files`, `name`, or `version` changes in this repo — those (including the `publishConfig`/`prepublishOnly` guards) belong to `prepare-0-1-0-release`. The only new git object in this repo is the `v0.1.0` tag.

---

## Expected Behaviour

Concrete, checkable outcomes (all CLI/manual — this plan adds no unit-testable logic):

- **Published.** After `npm publish` from `packages/lib`, `npm view @jimka/typescript-ui version` is `0.1.0`, access is **public**, and the npm page shows the README. The tarball was rebuilt fresh by `prepublishOnly`, not taken from the kept `.tgz`.
- **Tagged.** `git tag` lists `v0.1.0`; `git ls-remote --tags origin` shows `v0.1.0` pushed.
- **Leftover artifact removed.** `packages/lib/jimka-typescript-ui-0.1.0.tgz` no longer exists after Phase 1.
- **sqladmin permanently migrated.** sqladmin `frontend/package.json` reads `"@jimka/typescript-ui": "^0.1.0"`; `node_modules/@jimka/typescript-ui` is a **real directory** at `0.1.0` (not a symlink); `npm run build` and `npm run typecheck` pass; the app renders (manual, via `verify`, Host `sqladmin-db`); and the `package.json` + `package-lock.json` change is committed in the sqladmin repo.

---

## Verification

Run in order; the publish (Step 2) is irreversible.

1. **Authenticated:** `npm whoami` → the `@jimka` scope owner.
2. **Publish + confirm (immutable):** `npm publish` from `packages/lib` succeeds with **public** access; `npm view @jimka/typescript-ui version` → `0.1.0`; the README and file list are present on the registry.
3. **Tag:** `git tag v0.1.0 && git push origin v0.1.0`; confirm via `git ls-remote --tags origin | grep v0.1.0`.
4. **Cleanup:** `packages/lib/jimka-typescript-ui-0.1.0.tgz` is deleted.
5. **sqladmin (external, after Step 2):** in `sqladmin/frontend`, `test -L node_modules/@jimka/typescript-ui` → REAL-DIR; `npm ls @jimka/typescript-ui` → `0.1.0`; `npm run build && npm run typecheck` green; app renders via `Skill(verify)` (Host `sqladmin-db`); `frontend/package.json` + `frontend/package-lock.json` committed.

---

## Potential Challenges

- **Immutability.** `0.1.0` cannot be re-published; a mistake costs a `0.1.1` bump. This is why all correctable verification was completed in `prepare-0-1-0-release` before this plan runs — here, only publish under a confirmed-authenticated account and confirm the result.
- **Scoped-private default.** Without `publishConfig.access`, `npm publish` fails (free) or ships private (paid). The guard was already encoded by `prepare-0-1-0-release`, so a bare `npm publish` goes public — no `--access` flag to forget.
- **Stale `dist/lib` at publish time.** `prepublishOnly` rebuilds `dist/lib` from source as part of `npm publish`, so the uploaded tarball is fresh regardless of disk state and independent of the kept `.tgz`. Do not publish by a path that skips the script (e.g. do not hand-upload the kept tarball).
- **Ordering.** The sqladmin migration cannot run before the publish — `^0.1.0` is uninstallable until `0.1.0` is live. Sequenced as Phase 2 / external, after Phase 1 Step 3.
- **sqladmin stale symlink.** If `frontend/node_modules/@jimka/typescript-ui` isn't removed before `npm install`, npm may keep the old `file:` link. Remove it explicitly (external Step 2), then confirm it is a real directory.
- **`elkjs` peer drift** (lib `^0.10.0` optional vs sqladmin `^0.9.3`). Optional peer → no hard error; bump sqladmin only if diagram features are used (flagged, not auto-changed).

---

## Critical Files

- [`plans/prepare-0-1-0-release.md`](plans/prepare-0-1-0-release.md) — the completed prerequisite; it added the `publishConfig`/`prepublishOnly` guards and LICENSE/README to `packages/lib`, proved the packed surface, and verified sqladmin against the kept `.tgz` then reverted it. This plan starts from that state and re-does none of it.
- [`plans/workspace-restructure.md`](plans/workspace-restructure.md) — the base dependency; establishes that the library package lives at `packages/lib/` with `name`/`version 0.1.0`/`exports`/`files` byte-identical and builds via `npm run build:lib` to `packages/lib/dist/lib`.
- `packages/lib/package.json` — the surface being published (`@jimka/typescript-ui`, `version 0.1.0`, `files`, 23-subpath `exports`, `build:lib`); already carries `publishConfig.access` + `prepublishOnly` from `prepare-0-1-0-release`. Not edited by this plan.
- [`/home/jika/typescript/sqladmin/frontend/package.json`](/home/jika/typescript/sqladmin/frontend/package.json) — the external consumer; line 14 `"@jimka/typescript-ui": "file:../../typescript-ui"` (a symlink) is what the migration permanently replaces with `"^0.1.0"`. Scripts: `build` = `tsc --noEmit && vite build`, `typecheck` = `tsc --noEmit`.
- [`/home/jika/typescript/sqladmin/.claude/skills/verify/SKILL.md`](/home/jika/typescript/sqladmin/.claude/skills/verify/SKILL.md) — the `verify` skill driving the sqladmin app end-to-end; documents the `sqladmin-db` login host used in the migration's render check.

---

## Non-Goals

- **Preparation and verification** — the manifest guards (`publishConfig` + `prepublishOnly`), the LICENSE/README copy, the packed-surface assertions, and the pre-publish consumer verification against the `.tgz` are all done in [`plans/prepare-0-1-0-release.md`](plans/prepare-0-1-0-release.md), not repeated here.
- **Release automation** — no tag-triggered publish workflow, npm-token/OIDC pipeline, changesets, or `semantic-release`. `0.1.0` is published manually; the guards live in the manifest. Adding CI publishing is a later, separate concern.
- **A CHANGELOG or versioning convention** — none exists in the repo; not introduced here.
- **Any library API, manifest, `exports`, `files`, `name`, or `version` change** — the published surface is exactly the restructure-preserved, prepare-guarded one; this plan performs the publish, the tag, and the consumer migration only.
- **Bumping past `0.1.0` or publishing `0.1.1+`** — out of scope; the `0.x` caret note is guidance for the consumer range only.
- **Bumping `elkjs` in sqladmin** — the optional peer drift is flagged, not changed, during migration.
- **Editing the `workspace-restructure` or `prepare-0-1-0-release` outputs** — this plan consumes them and does not re-open their decisions.
