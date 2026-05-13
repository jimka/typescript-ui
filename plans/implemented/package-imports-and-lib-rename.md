# Package-Name Imports + Rename `Base/` → `lib/`

## Context

Today, every file in [src/typescript/](src/typescript/) imports via relative paths (e.g. `./Base/layout/HBox.js`, `./Base/component/Button.js`). The library is published as `@jimka/typescript-ui` (see [package.json:2](package.json#L2)). Two intertwined changes are wanted:

1. **Use the package name `@jimka/typescript-ui` when developing**, so demo panels read like real consumer code and switching to the published package is a no-op.
2. **Rename the `Base/` directory to `lib/`**, preserved as a `git mv` so file history isn't lost.

Two distinct populations of files exist in the repo:

1. **Demo / showcase files** at the root of [src/typescript/](src/typescript/) — `main.ts`, `LayoutTestPanel.ts`, and ~16 `*Panel.ts` files. These are *consumers* of the library and naturally fit the `@jimka/typescript-ui` alias.
2. **Library internals** under [src/typescript/Base/](src/typescript/Base/) (to become `src/typescript/lib/`). These cross-reference each other directly and should NOT route through the public barrel — doing so would be a circular self-import and would only expose publicly re-exported symbols. They get a shorter convenience alias `~/` → `src/typescript/lib/` instead, to be adopted incrementally as files are touched.

## Git rename detection — important constraint

Git doesn't record renames; it *detects* them at diff time by comparing file contents (default threshold ~50% similarity). To guarantee rename detection across the ~140-file `Base/` directory, the rename must happen as a **pure move with no content edits to the moved files in the same commit**.

This forces a two-commit sequence:

- **Commit 1** — pure rename: `git mv src/typescript/Base src/typescript/lib`. Files inside the directory are byte-identical to their `Base/` versions, so `git log --follow` and `git blame` survive cleanly. The only edits in this commit are to files *outside* `Base/` (config files and demo files) that reference the old path.
- **Commit 2** — aliases + demo conversion. Modifies configs and demos. `lib/` internals are not touched.

Doing both at once risks dropping the similarity below the rename-detection threshold for some files and silently fragmenting history.

## Approach

### Commit 1 — Rename `Base/` → `lib/`

This commit is purely structural. Build behavior is unchanged. After it lands, `git log --follow src/typescript/lib/Component.ts` should show the full history of `Base/Component.ts`.

**Step 1.1 — Move the directory:**

```bash
git mv src/typescript/Base src/typescript/lib
```

`git mv` records the rename in the index. Files inside are not touched; their *relative* imports (e.g. `./Component.js`, `../Util.js`, `./layout/HBox.js`) remain valid because they're relative to each file's own location, and the directory was moved as a unit.

**Step 1.2 — Update config files that reference `Base`:**

- [vite.lib.config.ts:5](vite.lib.config.ts#L5) — change `entry: 'src/typescript/Base/index.ts'` → `entry: 'src/typescript/lib/index.ts'`
- [tsconfig.lib.json:6](tsconfig.lib.json#L6) — change `"rootDir": "src/typescript/Base"` → `"rootDir": "src/typescript/lib"`
- [tsconfig.lib.json:9](tsconfig.lib.json#L9) — change `"include": ["src/typescript/Base/**/*"]` → `"include": ["src/typescript/lib/**/*"]`

**Step 1.3 — Update demo files' `./Base/...` imports to `./lib/...`:**

The ~18 demo files (listed under Commit 2) all reference `./Base/...`. Mechanical find-and-replace: `from "./Base/` → `from "./lib/`. The files themselves are NOT being renamed, so these show up as plain modifications in the diff — they don't interfere with rename detection of the actual moved files.

**Step 1.4 — Verify rename detection (before committing):**

```bash
git status                                              # should show "renamed:" entries for Base → lib files
git diff --stat HEAD                                    # confirms rename detection
```

After committing:

```bash
git log --follow src/typescript/lib/Component.ts        # should show pre-rename history
```

If any file in `lib/` shows as `deleted` + `new file` instead of `renamed`, content drift slipped in — investigate before committing.

**Step 1.5 — Verify the build still works** (before committing):

```bash
npm run typecheck
npm run build
npm run build:lib
```

Commit message suggestion: `Rename Base/ to lib/ (pure git mv, no content changes)`.

### Commit 2 — Add path aliases and convert demos

Now that the directory is `lib/`, set up the aliases.

**[tsconfig.json](tsconfig.json)** — add `baseUrl` and `paths`:

```jsonc
{
    "compilerOptions": {
        // ... existing options ...
        "baseUrl": ".",
        "paths": {
            "@jimka/typescript-ui": ["src/typescript/lib/index.ts"],
            "~/*": ["src/typescript/lib/*"]
        }
    }
}
```

**[vite.config.ts](vite.config.ts)** — add `resolve.alias` matching the tsconfig paths:

```ts
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  publicDir: 'src/resources',
  resolve: {
    alias: {
      '@jimka/typescript-ui': fileURLToPath(new URL('./src/typescript/lib/index.ts', import.meta.url)),
      '~': fileURLToPath(new URL('./src/typescript/lib', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 8015,
  },
})
```

**Do NOT modify [vite.lib.config.ts](vite.lib.config.ts) or [tsconfig.lib.json](tsconfig.lib.json) further.** The library build's entry is `lib/index.ts` and `include` is `lib/**/*` only — no demo panels are bundled, so the `@jimka/typescript-ui` alias is irrelevant there. Adding it would risk a self-referential resolve during the library build. The `~/` alias is also unnecessary for the lib build since internal files use relative paths.

### Convert demo files to `@jimka/typescript-ui`

Rewrite imports in these 19 files to pull from `@jimka/typescript-ui` instead of `./lib/...` (paths having been updated to `./lib/` in Commit 1):

- [src/typescript/main.ts](src/typescript/main.ts)
- [src/typescript/LayoutTestPanel.ts](src/typescript/LayoutTestPanel.ts)
- [src/typescript/HBoxPanel.ts](src/typescript/HBoxPanel.ts)
- [src/typescript/VBoxPanel.ts](src/typescript/VBoxPanel.ts)
- [src/typescript/BorderPanel.ts](src/typescript/BorderPanel.ts)
- [src/typescript/RowPanel.ts](src/typescript/RowPanel.ts)
- [src/typescript/ColumnPanel.ts](src/typescript/ColumnPanel.ts)
- [src/typescript/FitPanel.ts](src/typescript/FitPanel.ts)
- [src/typescript/SplitPanel.ts](src/typescript/SplitPanel.ts)
- [src/typescript/GridPanel.ts](src/typescript/GridPanel.ts)
- [src/typescript/AccordionPanel.ts](src/typescript/AccordionPanel.ts)
- [src/typescript/TabPanel.ts](src/typescript/TabPanel.ts)
- [src/typescript/MenuBarPanel.ts](src/typescript/MenuBarPanel.ts)
- [src/typescript/MiscPanel.ts](src/typescript/MiscPanel.ts)
- [src/typescript/BindingPanel.ts](src/typescript/BindingPanel.ts)
- [src/typescript/ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts)
- [src/typescript/MultiSelectListPanel.ts](src/typescript/MultiSelectListPanel.ts)
- [src/typescript/BaselinePanel.ts](src/typescript/BaselinePanel.ts)
- [src/typescript/perf/Benchmark.ts](src/typescript/perf/Benchmark.ts) — also imports from the library

Cross-demo imports (e.g. `import { HBoxPanel } from "./HBoxPanel.js"` in `main.ts`) **stay relative** — those aren't part of the library.

**Pattern (example for HBoxPanel.ts):**

After Commit 1 (rename only):
```ts
import { HBox } from "./lib/layout/HBox.js";
import { LayoutTestPanel } from "./LayoutTestPanel.js";
import { callable } from "./lib/Callable.js";
```

After Commit 2 (alias conversion):
```ts
import { HBox, callable } from "@jimka/typescript-ui";
import { LayoutTestPanel } from "./LayoutTestPanel.js";
```

**Pattern (example for main.ts):**

After Commit 2:
```ts
import { Body, Tab, Model, MemoryStore, Util } from "@jimka/typescript-ui";
// ...
import { HBoxPanel } from "./HBoxPanel.js";  // unchanged
```

**Pre-condition to check during conversion:** every symbol used in a demo file must already be re-exported from `src/typescript/lib/index.ts`. Spot checks confirmed coverage for the common ones (`HBox`, `VBox`, `Border`, `callable`, `Component`, `Button`, `Model`, `MemoryStore`, etc.). For any symbol that isn't exported, two options:

1. Add the missing export to `lib/index.ts` (preferred — it's part of the public API the demos use anyway).
2. Leave that single import relative.

Resolve case-by-case during the conversion.

**Note on file extensions:** the existing imports use the `.js` suffix (TypeScript-with-bundler convention for source files). After conversion, `@jimka/typescript-ui` should NOT carry a `.js` suffix — it's a bare module specifier, not a path. The `~/...` alias paths keep the `.js` suffix to match the rest of the codebase.

### Do not convert `lib/` internals yet

The `~/` alias is set up but no `lib/**` files are rewritten in this pass. Adopt it incrementally when touching files. Rationale:

- ~140 files to churn for zero functional change.
- Relative paths in `lib/` are rarely deeper than `./` or `../` since the directory is shallow (`lib/`, `lib/layout/`, `lib/component/`, `lib/data/`, `lib/validation/`).
- A one-shot rewrite would obscure git blame for the entire internal codebase.

If a sweep is later desired, it's a mechanical find-and-replace and can be done independently as a third commit.

## Critical files

**Commit 1 — rename:**
- All files under [src/typescript/Base/](src/typescript/Base/) → `src/typescript/lib/` (via `git mv`, no content changes)
- [vite.lib.config.ts](vite.lib.config.ts) — update `entry` path
- [tsconfig.lib.json](tsconfig.lib.json) — update `rootDir` and `include`
- 19 demo files — `./Base/` → `./lib/` in import strings

**Commit 2 — aliases + demo conversion:**
- [tsconfig.json](tsconfig.json) — add `baseUrl` + `paths`
- [vite.config.ts](vite.config.ts) — add `resolve.alias`
- Same 19 demo files — `./lib/...` → `@jimka/typescript-ui`

**Not modified (intentionally):**
- [vite.lib.config.ts](vite.lib.config.ts) after Commit 1 — no alias resolution needed for the lib build
- [tsconfig.lib.json](tsconfig.lib.json) after Commit 1 — same
- Any file under `src/typescript/lib/` — internals keep relative imports

## Verification

**After Commit 1 (rename):**

1. `git status` shows `renamed:` entries for every moved file (not `deleted` + `new file`). Spot-check after commit with `git log --follow src/typescript/lib/Component.ts` — should show history pre-dating the rename.
2. `npm run typecheck` passes.
3. `npm run build` succeeds.
4. `npm run build:lib` succeeds (proves `tsconfig.lib.json` + `vite.lib.config.ts` updates are correct).
5. `npm run dev` and click through every tab — each panel renders exactly as before.

**After Commit 2 (aliases + conversion):**

6. `npm run typecheck` passes. This confirms `paths` resolution works and every symbol pulled from `@jimka/typescript-ui` exists in the barrel.
7. `npm run dev` and re-test every tab — runtime behavior identical, confirming Vite's `resolve.alias` matches the tsconfig.
8. `npm run build` and `npm run build:lib` both succeed.
9. **Sanity check on the alias:** in HBoxPanel.ts, temporarily rename `HBox` → `HBoxXYZ`. Typecheck should fail with a clear "no exported member" error pointing at `@jimka/typescript-ui`. Revert.

## Open question (post-implementation)

When this library is eventually published and installed in a separate consumer project, the demo files would resolve `@jimka/typescript-ui` from `node_modules` automatically — meaning the demos could in principle become a published examples package. Out of scope for this change but worth noting.
