---
touches-shared:
  - ARCHITECTURE.md
  - packages/lib/vite.config.ts
  - packages/lib/vite.lib.config.ts
  - packages/docs/vite.config.ts
  - packages/docs/tsconfig.json
  - packages/docs/tests/links.test.ts
  - release-steps.md
---

# Docs, Build and `create-app` Cleanup — Round 2 — Implementation Plan

## Overview

The `workspace-restructure` and `packages-docs` cutovers moved the library into `packages/lib/` and replaced the VitePress site with a Vite app under `packages/docs/`. Documentation, skill docs, build config, and the `create-app` scaffolder still carry pre-restructure paths, commands that no longer exist, and claims that are no longer true.

This plan fixes twelve independent, small items across seven phases: dead links in the repo's own rule documents, a mandated verification command that no `package.json` defines, two false claims in the shipped installation guide, 23 dead links across 17 pages of the shipped documentation corpus, a stale root `NOTICE`, a missing licensing note in the scaffolded starter, duplicated and under-documented monorepo config, three orphans across the two documentation packages, four missing SPDX headers plus the generator that keeps reproducing the gap, and six defects in the `create-app` CLI.

Nothing here changes library behaviour. Two items add real logic and get tests: a guard that walks the authored documentation corpus and fails on a link whose target does not exist ([packages/docs/tests/links.test.ts](packages/docs/tests/links.test.ts)), and the `create-app` CLI argument handling ([packages/create-app/index.js:68](packages/create-app/index.js#L68)).

---

## Architecture Decisions

### Governing-doc links become repo-root-relative `packages/lib/…` paths

[ARCHITECTURE.md:17](ARCHITECTURE.md#L17) already carries the corrected form — `[Events](packages/lib/docs/concepts/events.md)`. The six remaining dead links adopt it. The **target** always gains the `packages/lib/` prefix; the **display text** changes only when the text is itself the old path.

| Line | Before | After |
|---|---|---|
| 87 | `` [`docs/recipes/drag-and-drop.md`](docs/recipes/drag-and-drop.md) `` | `` [`packages/lib/docs/recipes/drag-and-drop.md`](packages/lib/docs/recipes/drag-and-drop.md) `` |
| 128 | `[core/DOM.ts](src/typescript/lib/core/DOM.ts)` | `[core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts)` |

### `npm run docs:build` does not exist — the command is `npm run docs:api`

No `package.json` in the repo defines `docs:build`. [CODE_CONVENTIONS.md:23](CODE_CONVENTIONS.md#L23) already names the real command. The two skill docs that mandate the dead one are corrected to match.[^open-plans-inherit]

### A link with no reachable target becomes a plain backticked name; one with a URL is repointed

`DialogBackdrop`, `AutoCompleteDropdown`, and `ResizeHandle` are module-internal classes exported from no barrel, so TypeDoc will never emit a page for them and no URL exists to point at. Their links become plain backticked names — the treatment [recipes/drag-and-drop.md:105](packages/lib/docs/recipes/drag-and-drop.md#L105) already gives `ARCHITECTURE.md` in prose.[^delink-internal]

`components/Button.md:169`'s `/concepts/architecture` is the opposite case: the page does not exist, but the file it means to cite does, at a public URL. It is repointed at `https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md`, following [components/Glyphs.md:49](packages/lib/docs/components/Glyphs.md#L49), which already links two repo files that way.

### The corpus link guard lives in `links.test.ts` and resolves through the app's own lookups

The guard walks the same nine-group glob [`packages/docs/src/content/pages.ts:51-58`](packages/docs/src/content/pages.ts#L51) uses, and asks the app itself whether each target exists: `apiFileFor` ([api.ts:101-112](packages/docs/src/content/api.ts#L101)) for an `/api/…` path, `getPage` ([pages.ts:106-108](packages/docs/src/content/pages.ts#L106)) for anything else. It mirrors the corpus-walking guards already in [content-constructs.test.ts:190-211](packages/docs/tests/content-constructs.test.ts#L190), which resolve in-page and cross-page fragments but explicitly skip `/api/…`.[^guard-scope]

### `NOTICE` is deleted, not repaired

Nothing in the repo references the root `NOTICE` outside historical plan documents, it is absent from `packages/lib`'s published `files` array, and the project's own licence requires no file by that name. [`packages/lib/THIRD-PARTY-NOTICES.md`](packages/lib/THIRD-PARTY-NOTICES.md) is the live register and both READMEs already point at it.[^notice-delete]

### One shared `keepNames` module for the three in-repo Vite configs; the scaffolder template keeps its own copy

A new `build/keepNames.ts` at the repo root exports the guard; [packages/lib/vite.config.ts:49-52](packages/lib/vite.config.ts#L49), [packages/lib/vite.lib.config.ts:103-106](packages/lib/vite.lib.config.ts#L103), and [packages/docs/vite.config.ts:145-148](packages/docs/vite.config.ts#L145) import it. [packages/create-app/template/vite.config.ts:13-16](packages/create-app/template/vite.config.ts#L13) keeps its literal copy — it ships to a consumer's machine where no repo-root file exists.[^shared-keepnames]

### `packages/docs/tsconfig.json` gains three strictness flags; no shared base tsconfig

`strict: true` already implies `noImplicitAny`, so the real gap is `noImplicitReturns`, `noUnusedLocals`, and `noUnusedParameters`. Those three are added directly.[^no-base-tsconfig]

### `typedoc-vitepress-theme` stays — it is not dead

The finding that the plugin is dead is wrong. Its option presets set `entryFileName: 'index.md'`, which is what produces `core/index.md` and every other module index page; without it TypeDoc emits `README.md` instead and `apiFileFor`, `buildApiNav`, and `MODULE_INDEX_FILES` all break. Only its `typedoc-sidebar.json` artifact is unread. No change to [packages/lib/typedoc.json](packages/lib/typedoc.json).[^theme-alive]

### The two TypeDoc dependency notes land in `docs-conventions.md`

JSON manifests cannot carry comments, so the reason the root `package.json` restates the typedoc trio, and the reason `typedoc-vitepress-theme` must stay, are recorded in [`.claude/skills/_shared/docs-conventions.md`](.claude/skills/_shared/docs-conventions.md) — the repo's only prose home for TypeDoc configuration rules.[^conventions-home]

### The four generated glyph barrels carry the project licence header, not `CC-BY-4.0`

The 2860 generated icon files carry `CC-BY-4.0` because they hold Font Awesome path data. The four barrels hold only `export *` lines and no redistributed asset, so they carry `PolyForm-Noncommercial-1.0.0` like the other 385 hand-written library sources.[^barrel-licence]

### `create-app`'s version lock is documented, not reverted

`packages/create-app` moved from independent versioning (`0.0.1`) to lock-step with the library in commit `f19c076c`, which carries no rationale, and has shipped that way for six releases. npm versions cannot go backwards, so restoring independence is not available. The lock is recorded instead.[^version-lock]

### An empty prompt answer is an error, not a silent current-directory default

`main` currently turns an empty answer into `process.cwd()`. It rejects with `no project directory given (use "." for the current directory)` instead.[^empty-answer]

### `create-app` gets its own CI workflow file

A new `.github/workflows/create-app-tests.yml` mirrors `lib-tests.yml` rather than adding a step to it, so no existing check's name changes.[^new-workflow]

---

## Public API

`packages/create-app/index.js` — the scaffolder's exported surface. Only `parseCliArgs` changes shape.

```js
/**
 * @param {string[]} argv
 * @returns {{ help: boolean, targetDir: string | undefined }}
 * @throws Error - when more than one positional argument is given.
 */
export function parseCliArgs(argv)

/** Unchanged signature; now backed by a Map instead of an object literal. */
export function renameTemplateFile(name)

/** Unchanged signature; prints usage and returns when `--help` / `-h` is given. */
export async function main(argv, ask = promptForTargetDir)
```

`packages/docs/src/content/demos.ts` — `DemoModule` loses its `export` keyword. `DemoEntry`, `getDemo`, `getDemoIds`, and `missingDemoSource` are unchanged.

No library (`packages/lib`) export changes.

---

## Implementation

### The corpus link guard

Appended to [packages/docs/tests/links.test.ts](packages/docs/tests/links.test.ts). `stripCode` / `stripFences` are copied from [content-constructs.test.ts:51-81](packages/docs/tests/content-constructs.test.ts#L51) with a comment naming the origin, matching that file's own deliberate duplication of `routePathFor` and `slugify`.

```ts
const CORPUS = import.meta.glob(
    '../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference,reference/changelog,reference/migration}/*.md',
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Every `](/…)` target on the page, fragment and trailing slash normalized away. */
function internalLinkPaths(source: string): string[] {
    return [...stripCode(source).matchAll(/\]\((\/[^)\s]*)\)/g)]
        .map((match) => match[1].split('#')[0].replace(/\/$/, '') || '/');
}

function resolves(path: string): boolean {
    return isApiPath(path) ? apiFileFor(path) !== null : getPage(path) !== null;
}
```

Worked cases the normalization must produce:

| Authored href | Normalized path | Resolved by | Result |
|---|---|---|---|
| `/concepts/sizing#the-size-invariant` | `/concepts/sizing` | `getPage` | resolves |
| `/layouts/` | `/layouts` | `getPage` | resolves (`layouts/index.md`) |
| `/api/` | `/api` | `apiFileFor` | resolves (`index.md`) |
| `/api/core/namespaces/Animation` | same | `apiFileFor` | resolves (`…/Animation/index.md`) |
| `/api/core/classes/Animation` | same | `apiFileFor` | **fails** — no such file |

### `parseCliArgs` and the help path

```js
const RENAME_MAP = new Map([['_gitignore', '.gitignore']]);

export function renameTemplateFile(name) {
    return RENAME_MAP.get(name) ?? name;
}

export function parseCliArgs(argv) {
    const { values, positionals } = parseArgs({
        args:             argv,
        options:          { help: { type: 'boolean', short: 'h' } },
        allowPositionals: true,
    });

    if (positionals.length > 1) {
        throw new Error(`unexpected extra argument(s): ${positionals.slice(1).join(', ')}`);
    }

    return { help: values.help === true, targetDir: positionals[0] };
}
```

---

## Ordered Implementation Steps

**Precondition for every `packages/docs` test run:** the generated API tree `packages/lib/docs/api/` must exist — it is gitignored and the docs tests read it through the `virtual:typedoc-api` module. If it is missing, generate it with `npm run build:lib && NODE_OPTIONS=--max-old-space-size=12288 npm run docs:api` — the heap pin mirrors [.github/workflows/docs.yml:45-47](.github/workflows/docs.yml#L45), and without it TypeDoc can be OOM-killed on a developer machine.

### Phase 1 — Governing rule documents

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — apply the `packages/lib/` prefix to all six dead links, per the table in `## Architecture Decisions`:
   - line 87 — target and backticked text → `packages/lib/docs/recipes/drag-and-drop.md`
   - line 93 — target and backticked text → `packages/lib/docs/concepts/sizing.md`
   - line 128 — **two links on one line**: `src/typescript/lib/core/DOM.ts` → `packages/lib/src/typescript/lib/core/DOM.ts`, and `docs/concepts/dom-seams.md` → `packages/lib/docs/concepts/dom-seams.md` (leave both display texts)
   - line 214 — target and backticked text → `packages/lib/tests/component/default-options-fallback.test.ts`
   - line 242 — `src/typescript/lib/core/StyleTarget.ts` → `packages/lib/src/typescript/lib/core/StyleTarget.ts` (leave the display text)
   - *Check:* `grep -n '](\(docs\|src\|tests\)/' ARCHITECTURE.md` — expect zero matches.

2. **[.claude/skills/_shared/docs-conventions.md](.claude/skills/_shared/docs-conventions.md)**:
   - After line 3, add one sentence stating that every `docs/` path in this file means `packages/lib/docs/` — the authored Markdown corpus the docs app reads. This disambiguates every bare `docs/…` reference in the file in one line, rather than rewriting each.
   - Line 10 — the clause telling the reader to link a new page in `docs/.vitepress/config.mts` names a file that no longer exists. Replace it with an instruction to add the page to the nav table in `packages/docs/src/content/pages.ts`'s `getNav()`.
   - Line 14 — `npm run docs:build` → `npm run docs:api`.

3. **[.claude/skills/document/SKILL.md](.claude/skills/document/SKILL.md)**:
   - Line 18 — `surface as docs:build warnings` → `surface as docs:api warnings`.
   - Line 24 — both links gain the package directory: `../../../packages/lib/typedoc.json` and `../../../packages/lib/typedoc-callable-plugin.mjs`.
   - Line 28 — `npm run docs:build` → `npm run docs:api`.
   - *Check:* `grep -rn "docs:build" .claude/` — expect zero matches.

### Phase 2 — Shipped documentation

4. **Add the corpus link guard** to [packages/docs/tests/links.test.ts](packages/docs/tests/links.test.ts), using the code in `## Implementation`. Import `getPage` from `../src/content/pages.js` and `apiFileFor`, `isApiPath` from `../src/content/api.js`. One `it.each` case per corpus page; the failure message must name the page and every dangling href.
   - *Check:* `npm -w packages/docs run test` — the new block fails on 17 pages. This is the red half of the cycle.

5. **Fix the 23 dead links** in `packages/lib/docs/`. Every target below was verified against the generated tree.

   | File:line | Old href | New href |
   |---|---|---|
   | `components/BarChart.md:5` | `/api/component/container/classes/Panel` | `/api/core/classes/Panel` |
   | `components/ChartLegend.md:5` | `/api/component/container/classes/Panel` | `/api/core/classes/Panel` |
   | `components/LineChart.md:5` | `/api/component/container/classes/Panel` | `/api/core/classes/Panel` |
   | `components/Markdown.md:111` | `/api/component/container/classes/Panel` | `/api/core/classes/Panel` |
   | `components/Drawer.md:5` | `/api/core/classes/LayerManager` | `/api/core/namespaces/LayerManager` |
   | `components/TreeTable.md:103` | `/api/overlay/variables/DragManager` | `/api/overlay/namespaces/DragManager` |
   | `recipes/drag-and-drop.md:3` | `/api/overlay/variables/DragManager` | `/api/overlay/namespaces/DragManager` |
   | `recipes/drag-and-drop.md:11` | `/api/overlay/variables/DragManager#makedragsource` | `/api/overlay/namespaces/DragManager/functions/makeDragSource` |
   | `recipes/drag-and-drop.md:12` | `/api/overlay/variables/DragManager#makedroptarget` | `/api/overlay/namespaces/DragManager/functions/makeDropTarget` |
   | `recipes/drag-and-drop.md:93` | `/api/overlay/variables/DragManager#cancel` | `/api/overlay/namespaces/DragManager/functions/cancel` |
   | `recipes/drag-and-drop.md:104` | `/api/core/variables/Event#addviewportlistener` | `/api/core/namespaces/Event/functions/addViewportListener` |
   | `recipes/drag-and-drop.md:111` | `/api/overlay/variables/DragManager` | `/api/overlay/namespaces/DragManager` |
   | `components/AutoCompleteField.md:66` | `/api/core/classes/Animation` | `/api/core/namespaces/Animation` |
   | `components/Menu.md:106` | `/api/core/classes/Animation` | `/api/core/namespaces/Animation` |
   | `components/Tooltip.md:56` | `/api/core/classes/Animation` | `/api/core/namespaces/Animation` |
   | `layouts/Tab.md:157` | `/api/core/classes/Animation` | `/api/core/namespaces/Animation` |
   | `layouts/Accordion.md:224` | `/api/layout/type-aliases/LayoutSize` | `/api/layout/interfaces/LayoutSize` |
   | `layouts/Split.md:201` | `/api/layout/type-aliases/LayoutSize` | `/api/layout/interfaces/LayoutSize` |
   | `layouts/DockRegion.md:38` | `/api/layout/type-aliases/DropZone` | `/api/overlay/type-aliases/DropZone` |

   Three become plain backticked names — delete the whole link construct and leave just the backticked symbol:

   | File:line | Removed link |
   |---|---|
   | `components/Drawer.md:39` | `` [`DialogBackdrop`](/api/component/container/classes/DialogBackdrop) `` |
   | `components/AnimatedDropdown.md:11` | `` [`AutoCompleteDropdown`](/api/component/input/classes/AutoCompleteDropdown) `` |
   | `concepts/events.md:177` | `` [`ResizeHandle`](/api/component/table/classes/ResizeHandle) `` |

   One is repointed at GitHub:

   | File:line | Old | New |
   |---|---|---|
   | `components/Button.md:169` | `[ARCHITECTURE.md](/concepts/architecture)` | `[ARCHITECTURE.md](https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md)` |

   - *Check:* `npm -w packages/docs run test` — the guard now passes.

6. **[packages/lib/docs/guide/installation.md:3](packages/lib/docs/guide/installation.md#L3)** — replace the sentence `The package has zero runtime npm dependencies.` with:

   > It declares runtime dependencies that npm installs alongside it — the CodeMirror and Lexical editor stacks, the `d3-array` / `d3-scale` / `d3-shape` charting submodules, `marked`, `prettier`, `sql-formatter`, and the Manrope webfont. `elkjs` is an optional peer dependency, needed only for `DiagramView`'s ELK layout engine.

   Do not state a dependency count.[^no-count]

7. **[packages/lib/docs/guide/installation.md:88-95](packages/lib/docs/guide/installation.md#L88)** — replace the eight table rows with the seven rows from [README.md:87-93](README.md#L87), verbatim, so the two tables stay in lockstep. This drops the `npm run preview` row and corrects `npm run build`, `npm run clean`, and the `dist/` / `dist/lib/` output paths.
   - *Check:* `grep -n 'dist/' packages/lib/docs/guide/installation.md` — every remaining match is prefixed `packages/lib/`.

### Phase 3 — Licensing files

8. **Delete [NOTICE](NOTICE)** at the repo root.
   - *Check:* `grep -rn "\bNOTICE\b" --include=* . | grep -v node_modules | grep -v THIRD-PARTY-NOTICES | grep -v '^./plans/'` — expect zero matches.

9. **[packages/create-app/template/package.json:4](packages/create-app/template/package.json#L4)** — add `"license": "UNLICENSED"` immediately after the `"version": "0.0.0"` line. The scaffolded project is the user's own code; `UNLICENSED` is npm's marker for a package with no grant, and the field keeps `npm install` from warning about its absence.

10. **[packages/create-app/template/README.md](packages/create-app/template/README.md)** — append a `## License` section after the Scripts list:

    > ## License
    >
    > This starter's own code is yours — the generated `package.json` marks it `UNLICENSED`, so pick a licence before you publish it.
    >
    > Its `@jimka/typescript-ui` dependency is **not** open source. It is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/), which permits personal, educational, and other noncommercial use only. **Commercial use is read broadly and includes internal business tooling** — a company building an internal admin app with it needs a commercial licence. Ask at [github.com/jimka/typescript-ui/issues](https://github.com/jimka/typescript-ui/issues).

    - *Check:* `npm -w packages/create-app run test` — `listTemplateRelPaths` enumerates the template dynamically, so no test edit is needed.

### Phase 4 — Monorepo configuration

11. **Create `build/keepNames.ts`** at the repo root:

    ```ts
    /**
     * The minifier guard every in-repo Vite build shares. The framework derives
     * every component's CSS class (and layout-serialization keys) from
     * `this.constructor.name`, so a mangled class identifier yields a short or
     * empty string, `classList.add("")` throws, and the built page blanks.
     *
     * packages/create-app/template/vite.config.ts deliberately keeps its own
     * literal copy — it ships to a consumer's machine where this file does not
     * exist.
     */
    export const keepNamesMinify = {
      compress: { keepNames: { function: true, class: true } },
      mangle:   { keepNames: { function: true, class: true } },
    }
    ```

12. **Route the three in-repo configs through it.** In each file add `import { keepNamesMinify } from '../../build/keepNames.js'` beside the existing imports and replace the four-line `minify: { … }` literal with `minify: keepNamesMinify,`. Keep each site's existing explanatory comment.
    - [packages/lib/vite.config.ts:49-52](packages/lib/vite.config.ts#L49)
    - [packages/lib/vite.lib.config.ts:103-106](packages/lib/vite.lib.config.ts#L103)
    - [packages/docs/vite.config.ts:145-148](packages/docs/vite.config.ts#L145) — also drop the now-wrong last sentence of the comment at line 142 (`Mirror the keepNames guard in vite.config.ts and vite.lib.config.ts.`), since the mirroring is gone.
    - *Check:* `grep -rn "keepNames: { function" --include=*.ts . | grep -v node_modules` — exactly four matches: two in `build/keepNames.ts`, two in `packages/create-app/template/vite.config.ts`.
    - *Check:* `npm run build:lib` succeeds; `npm run build:docs` succeeds.

13. **[packages/docs/src/shell/DocsShell.ts:1](packages/docs/src/shell/DocsShell.ts#L1)** — remove the unused `DOM` and `Panel` imports from the `@jimka/typescript-ui/core` import list. They are the only two violations the new flags surface.

14. **[packages/docs/tsconfig.json](packages/docs/tsconfig.json)** — add `"noImplicitReturns": true`, `"noUnusedLocals": true`, and `"noUnusedParameters": true` to `compilerOptions`. Do **not** add `noImplicitAny`; `strict: true` already implies it.
    - *Check:* `npm -w packages/docs run typecheck` — clean.

15. **[.claude/skills/_shared/docs-conventions.md](.claude/skills/_shared/docs-conventions.md)** — add a `## TypeDoc dependency layout` section before `## typedoc-callable-plugin`, with two bullets:
    - The root [package.json](package.json) restates `typedoc` / `typedoc-plugin-markdown` / `typedoc-vitepress-theme` from [packages/lib/package.json:169-171](packages/lib/package.json#L169) on purpose. `typedoc` must resolve to a **single hoisted** instance at the workspace root; a workspace-local copy produces two instances and the markdown theme fails its `instanceof Reflection` check. Bump both manifests together or not at all — see [workspace-restructure.md:336](plans/implemented/workspace-restructure.md#L336).
    - `typedoc-vitepress-theme` is load-bearing despite nothing reading its `typedoc-sidebar.json`. Its presets set `entryFileName: 'index.md'`, which is what makes TypeDoc emit `core/index.md` rather than `core/README.md`; removing it renames every module index page and breaks the docs app's `apiFileFor`, `buildApiNav`, and `MODULE_INDEX_FILES`.

### Phase 5 — `packages/docs` orphans

16. **[packages/docs/src/content/demos.ts:4](packages/docs/src/content/demos.ts#L4)** — drop the `export` keyword from `DemoModule`. Its only two uses are in the same file (lines 19 and 29); `packages/docs` never emits declarations, so an exported `DemoEntry` may hold a field of an unexported type.[^demo-module]
    - *Check:* `npm -w packages/docs run typecheck` — clean.

17. **Delete [packages/lib/docs/index.md](packages/lib/docs/index.md)** — a VitePress `layout: home` page with a `hero`/`features` frontmatter block. It sits at the corpus root, outside the nine-group glob in [pages.ts:51-58](packages/docs/src/content/pages.ts#L51) and outside the bijection glob in [pages.test.ts:12-14](packages/docs/tests/pages.test.ts#L12), so no route and no test can reach it. The app's `/` route redirects to `/guide` ([packages/docs/src/main.ts:19](packages/docs/src/main.ts#L19)).

18. **Delete `packages/docs/Vitepress example.png`** — tracked, and referenced by nothing.
    - *Check:* `grep -rn "Vitepress example" . | grep -v node_modules` — expect zero matches.

### Phase 6 — SPDX headers and generator hygiene

19. **[packages/lib/scripts/import-fontawesome.ts](packages/lib/scripts/import-fontawesome.ts)** — make the generator emit a header on the barrels it writes. Add a module-level constant beside `renderIconFile`:

    ```ts
    /** Header for the generated barrels: project-licensed index files carrying no Font Awesome asset data. */
    const BARREL_HEADER = "// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0\n\n";
    ```

    Prefix it to both barrel writes: the per-style index at line 93 (`const indexLines = BARREL_HEADER + records.map(…)…`) and `writeTopLevelBarrel`'s `content` at lines 100-103.

20. **Add the same one-line header plus a blank line** to the four existing barrels, which the generator would otherwise only fix on the next Font Awesome re-import:
    - `packages/lib/src/typescript/lib/glyphs/index.ts`
    - `packages/lib/src/typescript/lib/glyphs/solid/index.ts`
    - `packages/lib/src/typescript/lib/glyphs/regular/index.ts`
    - `packages/lib/src/typescript/lib/glyphs/brands/index.ts`
    - *Check:* `for f in $(git ls-files packages/lib/src | grep '\.ts$'); do head -3 "$f" | grep -q SPDX-License-Identifier || echo "$f"; done` — expect zero output.
    - *Check:* `npm run lint` and `npm run typecheck` — unchanged.

21. **[packages/lib/tests/unit/llms-generate.test.ts:212-214](packages/lib/tests/unit/llms-generate.test.ts#L212)** — the test name and comment both say "the 6000 ceiling"; the constant is `TOKEN_BUDGET = 6440` ([generate.mjs:73](packages/lib/scripts/llms/generate.mjs#L73)). Reword both to name the budget without hardcoding a number — e.g. `passes a within-budget document and throws past the ceiling` and `// ceil(28000 / 4) = 7000 tokens, over any ceiling the constant has carried.` The assertions themselves are correct and stay.

### Phase 7 — `create-app`

22. **Add the failing tests first**, in [packages/create-app/tests/scaffold.test.js](packages/create-app/tests/scaffold.test.js), covering every case in `## Expected Behaviour` §CLI.

23. **[packages/create-app/index.js:16,49-51](packages/create-app/index.js#L16)** — replace the `RENAME_MAP` object literal with a `Map` and `renameTemplateFile`'s lookup with `RENAME_MAP.get(name) ?? name`, per `## Implementation`.

24. **[packages/create-app/index.js:62-72](packages/create-app/index.js#L62)** — rewrite `parseCliArgs` per `## Implementation`: declare a `help` boolean option (short `-h`), reject more than one positional, and return `{ help, targetDir }`. Update its JSDoc `@returns` and add `@throws`.

25. **[packages/create-app/index.js:141-144](packages/create-app/index.js#L141)** — in `main`:
    - after `parseCliArgs`, `if (help) { printUsage(); return; }` — a new module-level `printUsage()` writing the usage lines through `console.log`.
    - after resolving `dir`, `if (dir === '') throw new Error('no project directory given (use "." for the current directory)');`.

26. **[release-steps.md:6-7](release-steps.md#L6)** — replace the two `create-app` bullets with unambiguous ones:
    - `packages/create-app/package.json` — the `version` field. This package is deliberately version-locked to the library.
    - `packages/create-app/template/package.json` — the `dependencies["@jimka/typescript-ui"]` range **only**. Its own `version` stays `0.0.0`; it is the scaffolded project's placeholder, not a released version.

27. **[plans/implemented/create-tsui-app.md](plans/implemented/create-tsui-app.md)** — append a bullet to `## Implementation Notes` (line 580) recording that the plan's `### Initial version 0.0.1` decision (lines 50-52) and its `[^initial-version]` footnote (line 538) were reversed: commit `f19c076c` bumped the scaffolder from `0.0.1` to `0.3.0` alongside the library and every release since has kept them locked, with `release-steps.md` now codifying it. Note that npm versions cannot go backwards, so the lock is not reversible.

28. **Create `.github/workflows/create-app-tests.yml`**, mirroring [.github/workflows/lib-tests.yml](.github/workflows/lib-tests.yml) with `name: Test packages/create-app` and a final step `- run: npm -w packages/create-app run test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `ARCHITECTURE.md` |
| Modify | `.claude/skills/_shared/docs-conventions.md` |
| Modify | `.claude/skills/document/SKILL.md` |
| Modify | `packages/docs/tests/links.test.ts` |
| Modify | `packages/lib/docs/components/BarChart.md` |
| Modify | `packages/lib/docs/components/ChartLegend.md` |
| Modify | `packages/lib/docs/components/LineChart.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/Drawer.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/components/AnimatedDropdown.md` |
| Modify | `packages/lib/docs/components/AutoCompleteField.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/components/Tooltip.md` |
| Modify | `packages/lib/docs/components/Button.md` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/recipes/drag-and-drop.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/layouts/Accordion.md` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/layouts/DockRegion.md` |
| Modify | `packages/lib/docs/guide/installation.md` |
| Delete | `NOTICE` |
| Modify | `packages/create-app/template/package.json` |
| Modify | `packages/create-app/template/README.md` |
| Create | `build/keepNames.ts` |
| Modify | `packages/lib/vite.config.ts` |
| Modify | `packages/lib/vite.lib.config.ts` |
| Modify | `packages/docs/vite.config.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/tsconfig.json` |
| Modify | `packages/docs/src/content/demos.ts` |
| Delete | `packages/lib/docs/index.md` |
| Delete | `packages/docs/Vitepress example.png` |
| Modify | `packages/lib/scripts/import-fontawesome.ts` |
| Modify | `packages/lib/src/typescript/lib/glyphs/index.ts` |
| Modify | `packages/lib/src/typescript/lib/glyphs/solid/index.ts` |
| Modify | `packages/lib/src/typescript/lib/glyphs/regular/index.ts` |
| Modify | `packages/lib/src/typescript/lib/glyphs/brands/index.ts` |
| Modify | `packages/lib/tests/unit/llms-generate.test.ts` |
| Modify | `packages/create-app/index.js` |
| Modify | `packages/create-app/tests/scaffold.test.js` |
| Modify | `release-steps.md` |
| Modify | `plans/implemented/create-tsui-app.md` |
| Create | `.github/workflows/create-app-tests.yml` |

---

## Expected Behaviour

### Corpus link guard (unit-testable, `packages/docs`)

The two helpers are tested directly, then swept over every corpus page.

`internalLinkPaths(source)`:

- `'see [x](/concepts/sizing#the-size-invariant)'` yields `['/concepts/sizing']` — the fragment is stripped.
- `'see [x](/layouts/)'` yields `['/layouts']` — the trailing slash is stripped.
- `'see [x](/api/)'` yields `['/api']`.
- `'see [x](https://example.com)'` and `'see [x](#anchor)'` yield `[]` — only absolute site paths are collected.
- A `](/nope)` inside a fenced block or an inline code span yields `[]`.

`resolves(path)`:

- `'/concepts/sizing'` → `true`; `'/layouts'` → `true`; `'/api'` → `true`.
- `'/api/core/namespaces/Animation'` → `true`; `'/api/core/classes/Animation'` → `false`.
- `'/concepts/architecture'` → `false`; `'/nope'` → `false`.

Corpus sweep:

- Before Phase 2 step 5, 17 pages fail, and each failure message names the page and every dangling href on it.
- After Phase 2 step 5, every corpus page passes.

### `create-app` CLI (unit-testable, `packages/create-app`)

- `renameTemplateFile('_gitignore')` returns `'.gitignore'`.
- `renameTemplateFile('index.html')` returns `'index.html'`.
- `renameTemplateFile('constructor')` returns the string `'constructor'` — not `Object`'s constructor. Same for `'toString'` and `'__proto__'`.
- `parseCliArgs([])` returns `{ help: false, targetDir: undefined }`.
- `parseCliArgs(['my-app'])` returns `{ help: false, targetDir: 'my-app' }`.
- `parseCliArgs(['--help'])` returns `{ help: true, targetDir: undefined }` and does not throw. `['-h']` behaves the same.
- `parseCliArgs(['a', 'b'])` throws, and the message names `b`.
- `main(['--help'], ask)` prints usage, never calls `ask`, and scaffolds nothing.
- `main([], ask)` where `ask` resolves `''` rejects with a message containing `no project directory given`, and creates no directory.
- `main([], ask)` where `ask` resolves a path still scaffolds — the existing prompt test keeps passing.

### Manual verification

- `npm run build:docs`, then serve `packages/docs/dist` and click through a repaired page (`/recipes/drag-and-drop`, `/components/Button`) to confirm each fixed link navigates rather than 404s. The guard proves the target file exists; only a browser proves the rendered anchor navigates.
- `node packages/create-app/bin/create-tsui-app.js --help` prints usage and exits 0 — the bin wrapper path is not covered by the unit tests.

---

## Verification

```
npm run typecheck                       # packages/lib, unchanged
npm run lint                            # packages/lib, unchanged
npm test                                # packages/lib suite
npm -w packages/docs run typecheck      # must pass with the three new flags
npm -w packages/docs run test           # corpus link guard included
npm -w packages/create-app run test     # CLI guards included
npm run build:lib                       # shared keepNames module loads
npm run build:docs                      # shared keepNames module loads
```

Grep invariants:

```
grep -n '](\(docs\|src\|tests\)/' ARCHITECTURE.md                     # zero
grep -rn "docs:build" .claude/                                        # zero
grep -rn "Vitepress example" . | grep -v node_modules                 # zero
grep -rn "\bNOTICE\b" --include=* . | grep -v node_modules \
    | grep -v THIRD-PARTY-NOTICES | grep -v '^./plans/'               # zero
for f in $(git ls-files packages/lib/src | grep '\.ts$'); do \
    head -3 "$f" | grep -q SPDX-License-Identifier || echo "$f"; done  # zero
```

---

## Documentation Impact

No library export changes, so `npm run docs:api` has nothing new to emit and no changelog entry is needed — library behaviour is unchanged. The edits to `packages/lib/docs/guide/installation.md` and the 17 corpus pages *are* the documentation fix; they need no further catalog or nav entry, since no page is added or removed from the nine-group corpus. Deleting `packages/lib/docs/index.md` removes no route: it was never globbed by `pages.ts`.

---

## Potential Challenges

- **The generated tree can shift between TypeDoc versions.** Every target in step 5's table was checked against the tree as generated today. If a target no longer resolves, find it with `find packages/lib/docs/api -name '<Symbol>.md' -o -type d -name '<Symbol>'` rather than guessing the kind directory.
- **A Vite config importing a file outside its package root.** Verified working: Vite's config loader bundles relative imports, and `packages/docs`'s tsconfig (which typechecks `vite.config.ts`) resolves `../../build/keepNames.js` to the `.ts` source under `moduleResolution: bundler`.
- **Adding a header line to the glyph barrels changes generated files.** They are regenerated only by `scripts/import-fontawesome.ts`, which step 19 updates first, so the next re-import reproduces the header rather than dropping it.

---

## Critical Files

- [ARCHITECTURE.md:17](ARCHITECTURE.md#L17) — the already-corrected link form the other six copy.
- [README.md:85-93](README.md#L85) — the corrected build-commands table `installation.md` ports.
- [packages/docs/tests/content-constructs.test.ts:51-81,190-211](packages/docs/tests/content-constructs.test.ts#L51) — the corpus-walking guard the new link guard mirrors, and the source of its `stripCode` / `stripFences` helpers.
- [packages/docs/src/content/api.ts:88-112](packages/docs/src/content/api.ts#L88) — `isApiPath` and `apiFileFor`, the lookups the guard resolves through.
- [packages/docs/src/content/pages.ts:51-58,106-108](packages/docs/src/content/pages.ts#L51) — the nine-group glob and `getPage`.
- [plans/implemented/dead-code-and-orphaned-export-cleanup.md:36](plans/implemented/dead-code-and-orphaned-export-cleanup.md#L36) — the "drop the `export` keyword when the owning symbol is module-internal" precedent `DemoModule` follows.
- [plans/implemented/docs-sidebar-index-and-kind-grouping.md:675,724](plans/implemented/docs-sidebar-index-and-kind-grouping.md#L675) — the prior investigation that established `typedoc-vitepress-theme` is load-bearing.
- [packages/lib/THIRD-PARTY-NOTICES.md:25,32,133](packages/lib/THIRD-PARTY-NOTICES.md#L25) — the live third-party register that replaces `NOTICE`.
- [packages/create-app/tests/scaffold.test.js](packages/create-app/tests/scaffold.test.js) — the existing CLI test file the new cases extend.

---

## Non-Goals

- **The root `README.md` is not collapsed into a pointer at `packages/lib/README.md`.** The duplication is load-bearing: `packages/lib/README.md` is what npm publishes on the package page, `README.md` is GitHub's landing page, and the two must carry different relative link targets (`packages/lib/THIRD-PARTY-NOTICES.md` versus `THIRD-PARTY-NOTICES.md`). They already diverge deliberately in three places — the root adds a `npm create` snippet and an 18-line "Repository scripts" section.[^readme-dup]
- **The 33 dead absolute `/api/…` links in the library's own JSDoc are not fixed.** They are the same class of breakage — `packages/lib/src/typescript/lib/core/Component.ts:6978` and 32 siblings still write `/api/overlay/variables/DragManager` and friends — and they regenerate into hundreds of pages under `packages/lib/docs/api/` on every `docs:api`. Fixing them needs a per-site target decision (several name symbols with no API page at all: `PinnedTable`, `AbstractCalendarDropdown`, `SortPriorityBadge`, `Header`, `TreeRow`), which is its own pass. The guard added here deliberately covers only the authored corpus so it passes on completion of this plan.
- **`packages/lib/typedoc.json` is not touched.** `typedoc-vitepress-theme` is not dead; see `## Architecture Decisions`.
- **No shared base tsconfig is introduced.** See `## Architecture Decisions`.
- **`renderIconFile`'s hardcoded `Font Awesome Free 7.2.0` version string** ([import-fontawesome.ts:47-48](packages/lib/scripts/import-fontawesome.ts#L47)) is left as is, even though `writeReadme` interpolates the resolved `version` for the same text. It is a pre-existing inconsistency unrelated to the SPDX gap.
- **The three still-open plans that inherited `npm run docs:build`** — [plans/framework-focus-traversal.md:312,386](plans/framework-focus-traversal.md#L312), [plans/two-phase-baseline-resolution.md:465](plans/two-phase-baseline-resolution.md#L465), [plans/table-column-pinning.md:441,469](plans/table-column-pinning.md#L441) — are not edited. Correcting the skill docs is what stops new plans inheriting it; whoever implements those three will hit the missing script and can substitute `docs:api`.
- **`packages/docs` tests are not added to `lib-tests.yml`.** They require the generated API tree, which only `docs.yml` builds.

---

## Notes

[^open-plans-inherit]: The two skill docs are where the wrong command originates: `.claude/skills/_shared/docs-conventions.md:14` and `.claude/skills/document/SKILL.md:28` both mandate it, and three not-yet-implemented plans copied it from there. Correcting the skill docs stops the propagation; rewriting the three plans is out of scope (see `## Non-Goals`).

[^delink-internal]: Confirmed against the generated tree: `find packages/lib/docs/api -name 'DialogBackdrop.md' -o -name 'AutoCompleteDropdown.md' -o -name 'ResizeHandle.md'` returns nothing. [plans/implemented/dead-code-and-orphaned-export-cleanup.md:38](plans/implemented/dead-code-and-orphaned-export-cleanup.md#L38) records the same three classes as absent from every barrel, which is why TypeDoc never documents them. Repointing the links somewhere else would be inventing a target; leaving them linked leaves three permanent 404s.

[^guard-scope]: `links.test.ts` currently exercises only `resolveDocLink` and `resolveApiLink` against hand-written hrefs, so a corpus link pointing at a page that does not exist has never been checked by anything. `content-constructs.test.ts:201-211` comes closest — it resolves `/path#fragment` links to a heading on the target page — but its own comment says it skips `/api/…` because its `SOURCE_BY_ROUTE` map covers only the authored corpus. Resolving through `apiFileFor` closes exactly that hole. Two alternatives were rejected: extending `content-constructs.test.ts` would have meant widening its glob to the nine-group form, which would newly subject the changelog and migration pages to its raw-HTML, frontmatter, and anchor guards with unknown results; and a guard walking the 700-file generated tree would be slow and would mostly re-check links TypeDoc emits correctly by construction.

[^notice-delete]: Four things were checked. (1) Nothing references it: the only `NOTICE` matches outside `THIRD-PARTY-NOTICES.md` are in `plans/implemented/`. (2) It is not published: `packages/lib/package.json`'s `files` array is `["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md", "THIRD-PARTY-NOTICES.md"]`, and the root manifest is `private: true`. (3) The licence does not require it: PolyForm Noncommercial 1.0.0's `## Notices` clause (LICENSE:26-33) requires redistributing the licence terms and any `Required Notice:` lines — the only such lines in the repo are inside the LICENSE files themselves. A file literally named `NOTICE` is an Apache-2.0 §4(d) convention, and this project is not Apache-licensed. (4) GitHub's licence detection reads `LICENSE`/`LICENCE`/`COPYING`, not `NOTICE`. Meanwhile the file is actively wrong: it lists only Font Awesome, omitting the Manrope (OFL) and d3 (ISC) entries `THIRD-PARTY-NOTICES.md` carries at lines 32 and 133, and its line 8 still points at the pre-restructure `src/typescript/lib/glyphs/`. Bringing it in sync would create a second register to keep synchronised; deleting it leaves one.

[^shared-keepnames]: Feasibility was checked directly rather than assumed. Vite's `loadConfigFromFile` was run against a probe config in `packages/docs` importing `../../build/keepNames.js`; it loaded and produced the expected `minify` object. TypeScript resolution was checked separately by typechecking a copy of the real `packages/docs/vite.config.ts` with the import substituted — clean, because `moduleResolution: bundler` maps the `.js` specifier to the `.ts` source. `packages/lib`'s own tsconfigs include only `src/typescript/lib/**/*` and `tests/**/*`, so its two Vite configs are not typechecked at all and carry no TS risk. Neither package publishes its Vite config (`packages/lib`'s `files` array covers only `dist/lib` and three metadata files), so a repo-root import cannot leak into a tarball. The `create-app` template is the one copy that must stay literal: it is copied verbatim onto a consumer's machine, where `../../build/` does not exist.

[^no-base-tsconfig]: The gap is real but small — three flags, and adding them surfaces exactly two errors, both unused imports on one line of `DocsShell.ts`. A root `tsconfig.base.json` would add a file and an indirection for four shared lines while the two configs legitimately diverge on everything else (`paths` and `removeComments` in the library, `types` and `include` in the docs app). The repo's existing `extends` chains (`packages/lib/tsconfig.lib.json`, `tsconfig.test.json`) are both intra-package, so a cross-package base would be a new pattern, and CLAUDE.md §2 rules out an abstraction for two call sites.

[^theme-alive]: `node_modules/typedoc-vitepress-theme/dist/options/presets.js` sets `{ hidePageHeader: true, entryFileName: 'index.md', out: './api' }`, and `dist/index.js` registers a `MarkdownPageEvent.END` hook that rewrites every relative link's `#anchor` through a VitePress slugifier. `typedoc-plugin-markdown` defaults `entryFileName` to `README.md`, so dropping the theme renames all 24 module index files at once. [plans/implemented/docs-sidebar-index-and-kind-grouping.md:724](plans/implemented/docs-sidebar-index-and-kind-grouping.md#L724) reached the same conclusion and recorded it as a `## Non-Goals` bullet; the residue is only that nothing at the configuration itself says so, which step 15 fixes. `docsRoot` at [typedoc.json:28](packages/lib/typedoc.json#L28) is the theme's own option and stays with it.

[^conventions-home]: Neither note can live where it belongs — `package.json` and `typedoc.json` are JSON. `ARCHITECTURE.md` and `CODE_CONVENTIONS.md` govern framework code, not build configuration. `docs-conventions.md` already owns the TypeDoc setup rules that `document/SKILL.md` defers to, and CLAUDE.md routes every documentation-touching change through the `document` skill, which requires reading it — so it is the one place a person about to bump a typedoc version is told to look.

[^barrel-licence]: Of the 3249 TypeScript files under `packages/lib/src`, 2860 carry `CC-BY-4.0` (the generated Font Awesome icon files, each holding upstream path data) and 385 carry `PolyForm-Noncommercial-1.0.0` (hand-written library source). The four barrels hold only `export *` statements produced by the repo's own generator and redistribute no Font Awesome asset, so `CC-BY-4.0` would over-claim. Directory-level attribution for the whole `glyphs/` tree already lives in `packages/lib/THIRD-PARTY-NOTICES.md` and `packages/lib/LICENSE-FONTAWESOME.md`, so nothing is left under-attributed.

[^no-count]: A number in shipped prose goes stale the first time a dependency is added or dropped — the current count is 28, and nothing checks it. Naming the families conveys the same thing to a reader deciding whether the install is heavy, and stays true across a version bump.

[^demo-module]: `DemoModule` is referenced twice, both inside `demos.ts` (the `DemoEntry.module` field at line 19 and the `MODULES` cast at line 29). No test and no other module imports it. An exported interface may hold a field whose type is not exported as long as declarations are never emitted, and `packages/docs`'s only compile is `tsc -p tsconfig.json --noEmit`. Keeping the export was the alternative — harmless, but it advertises a name no consumer can usefully reach, which is the case `dead-code-and-orphaned-export-cleanup.md` decided against.

[^version-lock]: The lock arrived in commit `f19c076c` ("Update package files and bump version.", 2026-07-27), a bulk release-prep change that moved `packages/create-app`, its template's dependency range, `packages/docs`, and `packages/lib` together, jumping the scaffolder from `0.0.1` straight to `0.3.0`. The commit message gives no reason, and `plans/implemented/create-tsui-app.md:50-52` had recorded independent versioning as a deliberate `## Architecture Decisions` entry. Restoring independence is not an option: `@jimka/create-tsui-app` is published at `0.8.0` and npm forbids republishing below a released version, so the only honest move is to record the reversal where the original decision lives.

[^empty-answer]: Today an empty answer becomes `resolve(process.cwd(), '')`, which is the current directory. In a non-empty directory `scaffold` then throws `target directory "…" is not empty` — a confusing message for someone who just pressed Enter. In an *empty* directory it silently scaffolds in place, which is the surprising case. Rejecting costs one line and keeps the explicit route open: `.` still resolves to the current directory, and the error message says so. Defaulting to a generated name (`create-vite`'s behaviour) was the alternative; it adds a second name-derivation path next to `toValidPackageName` for no gain in a CLI that already accepts a positional argument.

[^readme-dup]: Checked by diffing the two files. They share 77 lines and differ in exactly three places, all of which are correct as they stand: the root adds a "Starting from scratch" `npm create` snippet, adds the whole "Repository scripts" section, and rewrites the third-party-notices link to `packages/lib/THIRD-PARTY-NOTICES.md` because its own relative base is the repo root rather than the package directory. `.github/workflows/docs.yml:27-29` further records that the published `packages/lib/README.md`'s URLs are load-bearing for the npm package page. Replacing the root file with a pointer would delete GitHub's landing page to save syncing a licence paragraph.

[^new-workflow]: `packages/create-app` already has a full test suite (`packages/create-app/tests/scaffold.test.js`, run by `npm -w packages/create-app run test`); it simply never runs on a pull request. `.github/workflows/lib-tests.yml` runs `npm run test`, which the root manifest maps to `npm -w packages/lib run test` only. Adding a step to that workflow would leave its `name: Test packages/lib` inaccurate, and renaming the workflow changes the check title that a branch-protection rule may reference. A separate file adds a new check and renames nothing. `release-steps.md:38` already runs `npm test --workspaces --if-present`, so these tests do run before a release today — the gap is per-PR coverage.
