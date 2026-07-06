# AI-Agent Capability Manifest (`/llms.txt`) — Implementation Plan

## Overview

Create a tiered, `/llms.txt`-style **capability manifest** at the repo root (`llms.txt`) so AI agents building apps against `@jimka/typescript-ui` — or developing the library — can cheaply discover what already exists and stop reinventing features. The library ships ~50+ components, 13 layout managers (plus the `DockRegion` edge-drop primitive), and a data layer, documented across ~139 authored VitePress pages plus ~570 TypeDoc-generated API pages under `docs/api/**`, but has **no compact index** an agent can scan in one read. Agents currently grep blindly.

The manifest solves this with progressive disclosure: one small always-loaded root document (Mental model → Capabilities catalog → Conventions → Drill-down pointers → Dev appendix) that points into the *existing* detailed docs. It is **generated with a curated seam**: a build script derives the per-component columns (import subpath, one-line summary, doc link) from a TypeDoc JSON model so they can never drift from source, while the task phrasings, groupings, mental-model prose, and convention rules are hand-authored in one data file the generator merges in.

New files: `scripts/llms/generate.mjs` (generator), `scripts/llms/manifest.data.mjs` (hand-authored seam), `llms.txt` (generated output). Wiring lives in [`package.json:106`](package.json#L106) (`scripts.docs:build`, new `docs:llms`, `files`) and [`typedoc.json`](typedoc.json) (a new `"json"` key emitting the model alongside the markdown `out`). Discoverability spans five surfaces: the in-repo [`CLAUDE.md:3`](CLAUDE.md#L3) pointer plus four consumer-facing ones (a [`README.md`](README.md) callout, a [`docs/guide/installation.md`](docs/guide/installation.md) paste-in snippet, the npm-shipped `llms.txt` copy via `package.json` `files`, and the hosted `docs/public/llms.txt`) — see §Consumer Discoverability.

---

## Architecture Decisions

### Generation source — TypeDoc JSON model, emitted in the existing `docs:api` run

Three candidate sources were evaluated against the real repo:

- **Parse `docs/api/**/*.md`** — the generated markdown. Rejected: brittle. The per-class page (`docs/api/component/button/classes/Button.md`) carries the summary as a free-text paragraph *after* a `Defined in:` line, mixed with `@example` blocks, `## Extends`, etc. Extraction is regex-scraping presentation output that the markdown plugin's formatting can change under us. Also gitignored, so it only exists after a build — no worse than JSON there, but far less structured.
- **Read barrels + generated `.d.ts`** — gives exports and subpaths but no JSDoc summary without a second TS parse; reimplements what TypeDoc already does.
- **TypeDoc JSON model — CHOSEN.** Verified end-to-end against the **full 14-entry-point** repo config (TypeDoc 0.28.19): `npx typedoc --json <file>` (run alongside the markdown theme) emits the structured JSON **and** the markdown theme output **in a single invocation** (confirmed: `json generated at …` + `markdown generated at …` both fired). So adding `"json"` to `typedoc.json` costs **zero extra TypeDoc runs** — the expensive parse already happens in `docs:api`. The JSON is fully structured:
  - Root (`kind: 1`) → one Module per entry point (`kind: 2`). **`Module.name` is the full export subpath** — the 14 verified names are the entry-point subset of the `package.json` `exports` keys (the `exports` map also carries `./glyphs/*` wildcard keys, which are not TypeDoc entry points and so produce no module): `"component/button"`, `"component/container"`, `"component/display"`, `"component/input"`, `"component/list"`, `"component/menubar"`, `"component/table"`, `"component/tree"`, `"core"`, `"data"`, `"layout"`, `"overlay"`, `"primitive"`, `"validation"`. **The subpath is therefore read directly off the owning module — no directory parsing.**
  - Modules are emitted **alphabetically** (the order above), *not* in `entryPoints` order. This does not affect the manifest: rows render in curated-seam order (see the merge model), so output is deterministic regardless of module ordering.
  - Each exported class is `kind: 128`; interfaces are `kind: 256`. Each carries `comment.summary` (an array of `{kind:"text"|"code", text}` parts — the leading JSDoc). `sources[0].fileName` exists but is **not** used for subpath resolution (it is the full `src/typescript/lib/component/button/Button.ts` path, and the subpath already comes from the owning module).

  **Subpath resolution = the owning module's `name`, full stop.** The generator walks each Module and, for every `kind: 128`/`kind: 256` child, records `(module.name, symbol.name) → { subpath: module.name, node }`. There is **no `fileName` parsing, no prefix-matching, and no flat by-name map** — because bare symbol names collide across modules (verified: `Body` in both `component/table` and `core`; `TreeNode` in both `component/tree` and `data`; `BorderOptions` in both `layout` and `primitive`), a flat `Map<name,node>` would silently keep whichever module was walked last and mis-resolve a curated row's subpath with no error. Keying by `(module, symbol)` makes same-named symbols in different modules distinct. This also fully resolves re-export fragility: a symbol re-exported into a barrel is reported under *that barrel's* module, which is exactly the subpath consumers import it from — the module is the source of truth for "where do I import this," which is what the catalog row needs.

### Merge model — curated spine, generated columns, fail-loud on drift

The generator does **not** dump all ~570 API symbols. The hand-authored seam (`manifest.data.mjs`) is the **spine**: it lists, per task-group, the exact set of components that belong in the anti-reinvention catalog (~50 rows), each as `{ task, symbol }` plus optional `{ doc }` override. Because a bare symbol name can exist in more than one module, each entry **may also carry `{ subpath }`** (a `package.json` `exports` key, e.g. `"core"`) to disambiguate; it is required only for the handful of colliding names (`Body`, `TreeNode`, `BorderOptions`, …) and omitted otherwise. The generator resolves each `symbol` against the `(module, symbol)` index to fill the columns (import subpath = the owning module, one-line summary) and derives the doc link, then renders the row.

**Fail-loud drift check:** for each curated entry the generator asserts the symbol resolves to **exactly one** `(module, symbol)` match — **zero** matches (renamed/removed symbol) *and* **more than one** match with no `{ subpath }` disambiguator (an ambiguous colliding name) both **fail the build**, naming the symbol. So renaming, removing, or newly-colliding a component surfaces immediately as a broken manifest build rather than silent staleness. This is the anti-drift guarantee: names live in the curated file, everything else is derived.

### Link form — two variants, one per output, from a single row set

The manifest has two audiences with two link needs, and the same byte-string cannot serve both: a **coding agent** reading the committed root `llms.txt` from a checkout wants filesystem-relative `.md` paths it can `Read`; a **web agent** fetching the hosted `docs/public/llms.txt` at `https://jimka.github.io/typescript-ui/llms.txt` needs site URLs, because the VitePress site (base `/typescript-ui/`, `cleanUrls`) serves *pages* at `/typescript-ui/components/Button` and does **not** serve the raw `docs/*.md` sources or `ARCHITECTURE.md` — so a filesystem link followed over HTTP is a 404. The generator therefore renders each row through a single link function `linkFor(target, mode)` parameterized by `mode: "fs" | "site"`, and emits both files from the *same* resolved row set in one pass (no duplicated content, no extra resolution):

- **`fs` mode → root `llms.txt`** (coding agents): repo-relative authored paths — `docs/components/Button.md`, `docs/concepts/sizing.md`, `docs/layouts/VBox.md`, `docs/data/store.md`; API drill-down `docs/api/**/*.md`; internals `ARCHITECTURE.md`. Directly `Read`-able. (Unchanged from the prior design.)
- **`site` mode → `docs/public/llms.txt`** (web agents): VitePress base + `cleanUrls` URLs — strip the `docs/` prefix and the `.md` suffix, prepend `https://jimka.github.io/typescript-ui/`. So `docs/components/Button.md` → `https://jimka.github.io/typescript-ui/components/Button`; `docs/concepts/sizing.md` → `…/concepts/sizing`. **API pages are served** (verified: the typedoc-markdown output under `docs/api/**` is part of the VitePress build — it renders to `docs/.vitepress/dist/api/component/button/classes/Button.html` and is wired into the site nav (`/api/`) and sidebar in `docs/.vitepress/config.mts`), so `docs/api/component/button/classes/Button.md` → `https://jimka.github.io/typescript-ui/api/component/button/classes/Button`. **`ARCHITECTURE.md` is not on the site at all**, so its `site`-mode link points at the GitHub blob URL instead: `https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md` (same fallback for any repo-root doc the site doesn't publish).

`linkFor` derives both forms from one canonical target (the repo-relative `.md` path, or the `ARCHITECTURE.md` sentinel), so a curated `{ doc }` override or auto-derived page is written once and both schemes fall out mechanically. The generator verifies each canonical `.md` path exists on disk and **warns** (does not fail) if one is missing, so a catalog entry can precede its dedicated page.

### Output is fully generated — no hand-edits in `llms.txt`

`llms.txt` carries a first-line comment: `<!-- GENERATED by scripts/llms/generate.mjs from scripts/llms/manifest.data.mjs — do not edit by hand -->`. All human-authored content (mental-model prose, task phrasings, convention rules, appendix) lives *only* in `manifest.data.mjs`. Regeneration therefore never clobbers curated work — there is nothing curated in the output to clobber.

### Commit policy — the root `llms.txt` is committed; the hosted copy is generated

The root `llms.txt` is **committed to git**, not gitignored. The plan's primary goal — an in-repo agent (and the `CLAUDE.md` pointer) finding the manifest — requires it to be present in a **fresh checkout**, before anyone runs a build. A stale committed copy is prevented by a **build/CI drift check** (`npm run docs:api && npm run docs:llms && git diff --exit-code llms.txt` — `docs:api` first so the parsed TypeDoc model exists, then fail if regeneration changed the committed file; see Verification), which is the same anti-staleness contract the generated-in-build design already relies on. The second copy, `docs/public/llms.txt`, is a pure build artifact for hosting and **is gitignored** (VitePress copies it to the site root at build time; committing it would duplicate the root file). So: **committed** = `llms.txt`, `scripts/llms/*`; **gitignored** = `docs/public/llms.txt`, `docs/api/typedoc-model.json`.

### Token budget — hard ceiling of 6000 tokens, enforced in the generator

Target well under 6k tokens. Estimated content (fs file): mental model ~220, ~50 catalog rows × ~50 = ~2500, 7 conventions ~320, drill-down pointers ~140, dev appendix ~120, headers/glue ~200 → **~3500 tokens**, comfortable margin under the 6000 ceiling. The `site` file (`docs/public/llms.txt`) is **larger and is the binding budget check**: its cleanUrls/GitHub-blob URLs run ~30 chars longer per link than the fs paths — ~375 extra tokens across the ~50 rows plus the prose links — so it lands at **~3900 tokens**, still well under the ceiling. The generator estimates tokens as `Math.ceil(chars / 4)` and **fails the build if either file exceeds 6000**, printing the count. This keeps the always-loaded cost bounded as the catalog grows.

---

## `llms.txt` section format (representative skeleton)

The generator emits exactly this shape. `«…»` marks generated values; everything else is curated prose from `manifest.data.mjs`. The skeleton below is the **`fs`-mode** output (root `llms.txt`); the hosted `docs/public/llms.txt` is identical except every link is rewritten to `site` mode — shown in the contrasting snippet after the block.

```markdown
<!-- GENERATED by scripts/llms/generate.mjs from scripts/llms/manifest.data.mjs — do not edit by hand -->
# @jimka/typescript-ui — capability manifest for AI agents

> Read this before building any UI feature against this library, so you use what
> exists instead of reinventing it. Open the linked pages for detail.

## Mental model
This is a layout-driven, retained-mode framework — closer to Java Swing than to
React or HTML flow. No flexbox, no CSS grid, no document flow: every Component is
absolutely positioned and sized in JS by a LayoutManager. Construct declaratively
with the callable + options-bag idiom (`Panel({ layoutManager: VBox(), components: [...] })`).
Theming is token-based; DOM events go through the `Event` class, semantic events
through `on`/`off`. Full orientation: docs/guide/mental-model.md.

## Capabilities (use these — do not rebuild them)
Organized by task. Columns: task → symbol · import subpath · summary · docs.

### Layouts
- Stack children vertically → **VBox** · `@jimka/typescript-ui/layout` · «Lays out children in a single vertical column.» · docs/layouts/VBox.md
- Split view with a draggable divider → **Split** · `@jimka/typescript-ui/layout` · «…» · docs/layouts/Split.md

### Inputs / Forms
- Push button → **Button** · `@jimka/typescript-ui/component/button` · «A push button component with a text label and configurable pressed-state appearance.» · docs/components/Button.md

### Data / Tables / Trees
- Editable data grid / spreadsheet-style table → **Table** · `@jimka/typescript-ui/component/table` · «…» · docs/components/Table.md

### Overlays
- Floating draggable window → **Window** · `@jimka/typescript-ui/overlay` · «…» · docs/components/Window.md

### Data layer
- In-memory record collection backing a table/list → **Store** · `@jimka/typescript-ui/data` · «…» · docs/data/store.md

## Conventions (hard rules)
1. Never use CSS flex/grid or `position: relative` — arrange children with a
   LayoutManager (HBox/VBox/Border/Grid/Split/…). → docs/concepts/layout-system.md
2. Size via setMinSize/setPreferredSize/setMaxSize honoring min ≤ preferred ≤ max;
   scrolling needs a Panel with setAutoScroll, not overflow CSS. → docs/concepts/sizing.md
3. Construct with the callable + options-bag idiom, not post-construction setters. → docs/recipes/component-options.md
4. DOM events go through `Event.addListener(this, …)`; semantic events through
   `on`/`off`/`emit`. Never call `addEventListener`. → docs/concepts/events.md
5. Theme through design tokens, never hardcoded colors. → docs/concepts/theming.md
6. … (7 total)

## Drill down
- Component detail & options → docs/components/, docs/layouts/
- Full generated API → docs/api/  (e.g. docs/api/component/button/classes/Button.md)
- Framework internals & binding rules → ARCHITECTURE.md

## Developing the library
Building the library itself (not just apps against it): read ARCHITECTURE.md
(event surfaces, one-DOM-element-per-class, absolute positioning, size-constraint
contract, typed-setter rules) and CODE_CONVENTIONS.md. Concepts index: docs/concepts/.
```

The hosted `docs/public/llms.txt` renders the identical rows and prose with `site`-mode links — **including the mental-model, drill-down, and dev-appendix links, which are `{{…}}` placeholders resolved through `linkFor`, not baked-in paths**. The same sections become:

```markdown
## Mental model
… Full orientation: https://jimka.github.io/typescript-ui/guide/mental-model.

- Push button → **Button** · `@jimka/typescript-ui/component/button` · «A push button component…» · https://jimka.github.io/typescript-ui/components/Button
- Stack children vertically → **VBox** · `@jimka/typescript-ui/layout` · «…» · https://jimka.github.io/typescript-ui/layouts/VBox

## Drill down
- Component detail & options → https://jimka.github.io/typescript-ui/components/, https://jimka.github.io/typescript-ui/layouts/
- Full generated API → https://jimka.github.io/typescript-ui/api/  (e.g. …/api/component/button/classes/Button)
- Framework internals & binding rules → https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md

## Developing the library
Building the library itself: read https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md
and https://github.com/jimka/typescript-ui/blob/master/CODE_CONVENTIONS.md. Concepts index: https://jimka.github.io/typescript-ui/concepts/.
```

Every link in the hosted file is an `https://` URL — **zero `docs/…` filesystem paths survive** (an asserted check; see Expected Behaviour).

The example rows above use **verified** real symbols, real `package.json` `exports` subpaths, and real doc pages (`docs/components/Button.md`, `docs/components/Table.md`, `docs/components/Window.md`, `docs/layouts/VBox.md`, `docs/data/store.md` all exist; their site URLs resolve under `cleanUrls`, and the API pages serve from the VitePress build). The `Button` summary shown is the actual first paragraph of its class JSDoc as it appears in the TypeDoc JSON.

---

## Generator design

### `scripts/llms/manifest.data.mjs` — hand-authored seam (the only file a human edits)

Plain ESM data module (matches the repo's `scripts/*.mjs` convention). Exports:

```js
export const groups = [
  { name: "Layouts", entries: [
    { task: "Stack children vertically", symbol: "VBox" },
    { task: "Split view with a draggable divider", symbol: "Split" },
    // …
  ]},
  { name: "Containers / Windows", entries: [ /* … */ ] },
  { name: "Inputs / Forms",       entries: [ /* … */ ] },
  { name: "Data / Tables / Trees",entries: [ /* … */ ] },
  { name: "Display",              entries: [ /* … */ ] },
  { name: "Overlays",             entries: [ /* … */ ] },
  { name: "Data layer",           entries: [
    { task: "In-memory record collection backing a table/list", symbol: "Store", doc: "docs/data/store.md" },
    { task: "Node in a tree store", symbol: "TreeNode", subpath: "data", doc: "docs/data/store.md" }, // subpath disambiguates the component/tree TreeNode
    // …
  ]},
];

export const conventions = [
  { rule: "Never use CSS flex/grid or `position: relative` — arrange children with a LayoutManager (HBox/VBox/Border/Grid/Split/…).", doc: "docs/concepts/layout-system.md" },
  // 5–8 total
];

// Prose blocks with STRUCTURED link targets, never baked-in paths. Each `{{key}}`
// placeholder names a target the generator rewrites through linkFor(target, mode),
// so the same block renders fs paths in llms.txt and site URLs in docs/public/llms.txt.
export const mentalModel =
  `This is a layout-driven, retained-mode framework … Full orientation: {{guide/mental-model}}.`;

export const drillDown =
  `- Component detail & options → {{components/}}, {{layouts/}}\n` +
  `- Full generated API → {{api/}}\n` +
  `- Framework internals & binding rules → {{ARCHITECTURE}}`;

export const devAppendix =
  `Building the library itself: read {{ARCHITECTURE}} and {{CODE_CONVENTIONS}}. Concepts index: {{concepts/}}.`;

// The set of link targets the placeholders may reference (canonical repo-relative form).
// A directory target (trailing slash) resolves to the docs section root; ARCHITECTURE /
// CODE_CONVENTIONS are repo-root docs (GitHub-blob URL in site mode). linkFor handles all.
export const proseTargets = {
  "guide/mental-model": "docs/guide/mental-model.md",
  "components/":        "docs/components/",
  "layouts/":          "docs/layouts/",
  "concepts/":         "docs/concepts/",
  "api/":              "docs/api/",
  "ARCHITECTURE":      "ARCHITECTURE.md",
  "CODE_CONVENTIONS":  "CODE_CONVENTIONS.md",
};
```

`doc` is an **optional override**: omit it for components with a `docs/components/<Name>.md` or `docs/layouts/<Name>.md` page (auto-derived); supply it for data-layer symbols and anything whose page name differs from the symbol. `subpath` is an **optional disambiguator** (a `package.json` `exports` key): required only when the bare `symbol` name exists in more than one module (`Body`, `TreeNode`, `BorderOptions`), omitted otherwise.

**No prose block bakes in a link.** `mentalModel`, `drillDown`, and `devAppendix` reference links only through `{{target}}` placeholders resolved against `proseTargets`; the generator rewrites each placeholder through `linkFor(target, mode)` per output (step 7). This is what lets the hosted `docs/public/llms.txt` carry site URLs in its mental-model / drill-down / appendix sections instead of dead `docs/…` filesystem paths.

### `scripts/llms/generate.mjs` — generator

Small, single-purpose ESM script following [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (JSDoc on each function, named helpers, no magic numbers without a documented `const`). Flow:

1. **Load inputs.** `import` the seam module; `JSON.parse` the TypeDoc model (path from a `const MODEL_PATH = "docs/api/typedoc-model.json"`).
2. **Build the `(module, symbol)` index.** Walk `model.children` (each a Module whose `name` is the full export subpath). For every `kind: 128` class / `kind: 256` interface child, record `index.get(module.name).set(symbol.name, node)` (a `Map<subpath, Map<name, node>>`), capturing `comment.summary`. The subpath is the module name itself — no `fileName` parsing, no prefix-matching.
3. **Resolve each curated symbol.** For an entry `{ symbol, subpath? }`, collect every `(module, symbol)` pair whose symbol name matches. If `subpath` is given, select that module. Assert **exactly one** surviving match: **zero** (renamed/removed) or **>1 without a `subpath`** (ambiguous collision) **throws**, naming the symbol. The import subpath is `@jimka/typescript-ui/<module.name>`.
4. **Summarize.** Join the resolved node's `comment.summary` parts: `text` verbatim, `code` re-wrapped in backticks, and `inline-tag` parts (e.g. `{@link Foo}`, which TypeDoc emits as a distinct part kind) rendered as their `.text` field — so a first paragraph containing an inline `{@link}` keeps that word instead of silently dropping it. Take the **first paragraph** (up to the first blank line), collapse newlines to spaces, trim. Cap at ~140 chars with an ellipsis so no row bloats the budget.
5. **Resolve the canonical doc target.** For each row use `entry.doc` if given; else probe `docs/components/<symbol>.md` then `docs/layouts/<symbol>.md`; the first that exists on disk wins. Store the canonical repo-relative path. Warn if none exists. The prose blocks' targets come pre-declared in `proseTargets` (canonical form already), so no per-row probing is needed for them.
6. **`linkFor(target, mode)` — the one link function.** Given a canonical target and `mode`, returns:
   - `"fs"` → the repo-relative path verbatim — a page (`docs/components/Button.md`, `ARCHITECTURE.md`) or a section root (`docs/components/`, `docs/api/`).
   - `"site"` → for any `docs/**` target (page *or* directory), strip the `docs/` prefix and any `.md` suffix and prepend `const SITE_BASE = "https://jimka.github.io/typescript-ui/"` (cleanUrls) — so `docs/components/Button.md` → `…/components/Button` and `docs/components/` → `…/components/`; for a repo-root doc **not published on the site** (`ARCHITECTURE.md`, `CODE_CONVENTIONS.md`), return `const GITHUB_BLOB = "https://github.com/jimka/typescript-ui/blob/master/"` + the path. All targets — per-row `doc`, per-convention `doc`, and every `proseTargets` entry — flow through this one function, so no link is authored twice and none is baked in.
7. **Render both variants.** Build the row set once (resolved subpath, summary, canonical target per entry). Render the document twice through a `render(rows, mode)` that (a) calls `linkFor(row.target, mode)` per row/convention and (b) interpolates each prose block by replacing every `{{key}}` placeholder with `linkFor(proseTargets[key], mode)` — so the mental-model / drill-down / appendix links are **mode-resolved, not mode-neutral**. `fsDoc = render(rows, "fs")`, `siteDoc = render(rows, "site")`. (The one genuinely mode-neutral string is the intro "Open the linked pages" line, which contains no link.)
8. **Budget check.** Estimate tokens per file (`Math.ceil(text.length / 4)`); throw if either exceeds `const TOKEN_BUDGET = 6000`. The **`site` file is the binding check** — its cleanUrls/GitHub-blob URLs run ~30 chars longer per link than the fs paths (~375 extra tokens across ~50 rows + prose), so it is the larger of the two; it still lands well under the ceiling (~3900 vs the fs file's ~3500).
9. **Write** `fsDoc` → `llms.txt` (repo root, committed) and `siteDoc` → `docs/public/llms.txt` (generated hosted copy), creating `docs/public/` if absent.

No new runtime dependency — Node's `fs`/`path` plus the already-present TypeDoc JSON.

### Build-hook wiring

Two edits, ordered so the JSON model always exists before the generator runs:

- **`typedoc.json`** — add `"json": "docs/api/typedoc-model.json"`. Confirmed to coexist with the markdown theme in one run; `docs/api/` is already gitignored and already hosts JSON siblings (`typedoc-sidebar.json`), so nothing new leaks into git or the VitePress content scan (VitePress only renders `.md`).
- **`package.json`** — add `"docs:llms": "node scripts/llms/generate.mjs"` and chain it into `docs:build` **after** `docs:api` (which produces the JSON) and before the VitePress build:
  `"docs:build": "npm run docs:api && npm run docs:llms && NODE_OPTIONS=--max-old-space-size=6144 vitepress build docs"`.

`docs:llms` can also be run standalone during development after any `docs:api`, for a fast regenerate without the full VitePress build.

---

## Maintaining the curated seam

The human-authored content is confined to `scripts/llms/manifest.data.mjs`. Adding a component to the catalog = add one `{ task, symbol }` line to the right group. Adding/adjusting a rule = edit the `conventions` array. Because the generator throws on an unresolved `symbol`, the seam stays honest: a stale name breaks `docs:build`. The initial ~50-entry catalog is drafted by walking the barrels (`src/typescript/lib/*/index.ts`) and the docs sidebar, one task-phrased row per user-facing component; internal/abstract exports (`AbstractInput`, `AbstractWindow`, `BaseObject`, `DragManager`, …) are deliberately omitted — the catalog is task-facing, not an export dump.

---

## Ordered Implementation Steps

1. **`typedoc.json`** — add `"json": "docs/api/typedoc-model.json"`. → verify: `npm run docs:api` then `ls docs/api/typedoc-model.json` exists and is valid JSON.
2. **`scripts/llms/manifest.data.mjs`** — author `mentalModel`, `groups` (6–7 groups, ~50 entries), `conventions` (5–8 rules), `drillDown`, `devAppendix`. Ground every task phrasing in a real barrel export and every convention in an `ARCHITECTURE.md` rule + a `docs/concepts/*` page. Add a `subpath` disambiguator to any entry whose bare symbol name collides across modules (`Body`, `TreeNode`, `BorderOptions`).
3. **`scripts/llms/generate.mjs`** — implement the flow above (load, `(module, symbol)` index keyed by the owning module's full-subpath `name`, resolve-exactly-one-match, summarize, canonical doc target, `linkFor(target, mode)`, `render(rows, mode)` for both `fs` and `site`, budget) and write `fsDoc` → `llms.txt` and `siteDoc` → `docs/public/llms.txt`, creating `docs/public/` if absent. → verify: both files written; they differ **only** in link scheme (fs paths vs `https://jimka.github.io/typescript-ui/…` URLs), identical row/prose text otherwise.
4. **`.gitignore`** — add `docs/public/llms.txt` (generated hosted copy). The root `llms.txt` is **committed** — do not add it to `.gitignore`.
5. **`package.json`** — add `docs:llms` script; insert it into `docs:build` after `docs:api`; add `"llms.txt"` to `files`.
6. **Generate & inspect** — `npm run docs:api && npm run docs:llms`; open `llms.txt`, confirm every row has a real subpath, a non-empty summary, and an `fs`-mode `docs/…md` link; confirm the printed token estimate is under budget; open `docs/public/llms.txt` and confirm the same rows carry `https://jimka.github.io/typescript-ui/…` (cleanUrls) links and the `ARCHITECTURE.md` link is the GitHub blob URL.
7. **`CLAUDE.md`** — add the in-repo discoverability pointer (above).
8. **`README.md`** — add the "AI agents: start here" callout at the top of `## Documentation`.
9. **`docs/guide/installation.md`** — add the "Using @jimka/typescript-ui with AI agents" subsection with the paste-in snippet.
10. **Full build check** — `npm run docs:build` completes and regenerates both `llms.txt` copies; confirm `docs/public/llms.txt` is present for the VitePress build to deploy, and `git diff --exit-code llms.txt` is clean (committed copy matches regeneration).
11. **Drift-guard check** — (a) temporarily rename a `symbol` in the seam to a bogus name → generator throws (zero matches); (b) temporarily set a colliding `symbol` (`Body`) with no `subpath` → generator throws (ambiguous, >1 match); revert both.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `scripts/llms/manifest.data.mjs` — hand-authored capability spine + conventions + prose |
| Create | `scripts/llms/generate.mjs` — generator (TypeDoc JSON → `fs`-mode `llms.txt` + `site`-mode `docs/public/llms.txt` via one `linkFor` function) |
| Create | `llms.txt` — generated `fs`-link output at repo root; **committed** (present in fresh checkout), regenerated by the build with a drift check |
| Create | `docs/public/llms.txt` — generated `site`-link hosted copy, **gitignored**; VitePress deploys it at the site root URL (new `docs/public/` dir) |
| Modify | `typedoc.json` — add `"json": "docs/api/typedoc-model.json"` |
| Modify | `package.json` — add `docs:llms` script; chain into `docs:build` after `docs:api`; add `"llms.txt"` to `files` |
| Modify | `.gitignore` — ignore `docs/public/llms.txt` (generated); root `llms.txt` stays committed |
| Modify | `CLAUDE.md` — add the in-repo capability-index pointer line |
| Modify | `README.md` — add the "AI agents: start here" callout in `## Documentation` |
| Modify | `docs/guide/installation.md` — add the consumer AI-agent snippet subsection |

`docs/api/typedoc-model.json` is a build artifact under the already-gitignored `docs/api/` — not committed, not listed above.

---

## CLAUDE.md pointer edit

Add one bullet to the top **`# Coding Guidelines`** list in [`CLAUDE.md`](CLAUDE.md), as a new first item (it should be seen before the skill rules), exact wording:

```markdown
- **Library capability index: [`llms.txt`](llms.txt) — read before building any UI feature**, so you use existing components/layouts instead of reinventing them.
```

Rationale for placement: the `# Coding Guidelines` list is the first thing in `CLAUDE.md` every session loads, so the pointer is guaranteed seen. It is a discovery instruction, matching the list's imperative "ALWAYS" style.

---

## Consumer Discoverability

The `CLAUDE.md` pointer above serves agents **developing this library** (Claude Code auto-loads `CLAUDE.md`/`AGENTS.md`). It does nothing for agents **consuming** `@jimka/typescript-ui` from npm in a separate repo: nothing auto-loads an arbitrary `llms.txt`, the file lives only at *this* repo's root, and — verified — `package.json` `files` is `["dist/lib", "LICENSE-FONTAWESOME.md"]`, so the root `llms.txt` does **not** currently ship to npm. Four additions, best-first, put the manifest where a downstream agent will actually find it. None of them change `llms.txt`'s content or token budget — they only control where copies land and how they're surfaced.

### 1. Host it at the docs-site root — `https://jimka.github.io/typescript-ui/llms.txt`

The `/llms.txt` convention is that the file lives at a **site root**, which is where web-capable agents look. The docs site deploys from VitePress (`base: '/typescript-ui/'`, `cleanUrls`), and VitePress copies everything under **`docs/public/`** to the site root verbatim. That directory does **not** exist yet (verified — `docs/.vitepress/` has only `config.mts`, `cache/`, `dist/`), so it must be created.

**Approach (recommended): the generator renders both variants in one pass.** `generate.mjs` builds the row set once, then renders `fsDoc` (fs links) → `llms.txt` (repo root, for in-repo agents) and `siteDoc` (site links) → `docs/public/llms.txt` (for hosting) — see the link-scheme decision and generator steps. This is preferred over a separate copy step in `package.json`: both variants come from the same resolved rows and prose in the same run (so their capability content can't diverge — only the links differ by design), it needs no shell portability, and the budget check runs on each before its write. The docs-site copy deploys automatically because `docs:build` already runs the VitePress build after `docs:llms`, and GitHub Pages redeploys on push to `master` (per `README.md`).

`docs/public/llms.txt` is a generated artifact and is **gitignored** (the root `llms.txt` is the committed copy — see the commit-policy decision above). Add the specific-file entry `docs/public/llms.txt` to `.gitignore` rather than ignoring all of `docs/public/`, leaving that directory open for hand-authored static assets later.

### 2. README callout — "AI agents: start here"

Add a prominent one-liner at the top of the existing **`## Documentation`** section in [`README.md`](README.md) (which already documents the hosted site and a highlights list), immediately under the `## Documentation` heading and before the "Full documentation lives at…" line, exact wording:

```markdown
> **AI agents:** start at the machine-readable capability manifest — **<https://jimka.github.io/typescript-ui/llms.txt>** (also at `node_modules/@jimka/typescript-ui/llms.txt` after install). It indexes every component, layout, and data-layer class so you build with what exists instead of reinventing it.
```

A blockquote makes it visually distinct from the human-facing highlights list that follows.

### 3. Ship it in the npm package

Add `"llms.txt"` to `package.json` `files` so the manifest lands at `node_modules/@jimka/typescript-ui/llms.txt` — a stable, offline path a consumer's agent (or the snippet below) can point at without network access. `files` becomes `["dist/lib", "llms.txt", "LICENSE-FONTAWESOME.md"]`. Its **primary value is the offline capability catalog** (task → symbol → import subpath → summary), which is fully self-contained. One caveat to state: the packaged file is the committed **fs-variant**, whose drill-down links are repo-relative (`docs/components/Button.md`, `ARCHITECTURE.md`) — those paths do **not** ship in the tarball (`files` carries only `dist/lib` + `llms.txt`), so from inside `node_modules` they don't resolve. For drill-down, a consuming agent should follow the **hosted** URLs (the README callout and the paste-in snippet both point there); the local copy is the offline index, the hosted copy is the linkable one. Because `llms.txt` is generated by `docs:build` and *not* by `build:lib`, note the ordering caveat too: a publish must run after a `docs:llms`/`docs:build` so the file exists to be packed (call this out in the release step; no code enforces it).

### 4. Paste-in snippet for the consumer's own `CLAUDE.md` / `AGENTS.md`

Document a copy-paste line adopters add to *their* project's agent instructions, in [`docs/guide/installation.md`](docs/guide/installation.md) (verified to exist) under a short new subsection, e.g. `## Using @jimka/typescript-ui with AI agents`:

```markdown
If you use an AI coding assistant, add this line to your project's `CLAUDE.md` or `AGENTS.md`:

> UI library capability index: https://jimka.github.io/typescript-ui/llms.txt
> (offline: node_modules/@jimka/typescript-ui/llms.txt) — read before building any UI with @jimka/typescript-ui.
```

This is the only piece that lands in the adopter's auto-loaded instruction file, closing the loop the hosted URL and npm copy alone can't (nothing auto-reads `llms.txt`; a line in `CLAUDE.md`/`AGENTS.md` does get auto-loaded).

---

## Expected Behaviour

All behaviours are **unit/CLI-verifiable** (the generator is a pure Node script — no UI, no DOM, no browser); none need manual visual verification beyond eyeballing the output once.

- **Subpath resolution.** The import subpath is the resolved symbol's owning module name: `Button` → `@jimka/typescript-ui/component/button`; `VBox` → `@jimka/typescript-ui/layout`; `Store` → `@jimka/typescript-ui/data`. No `fileName` parsing is involved.
- **Collision handling.** `TreeNode` (present in both `component/tree` and `data`) with `subpath: "data"` resolves to `@jimka/typescript-ui/data`; the same entry without a `subpath` throws (ambiguous, >1 match).
- **Summary extraction.** For `Button`, the emitted summary is `A push button component with a text label and configurable pressed-state appearance.` (first paragraph, `\n` collapsed, `@example` block excluded). A `code`-kind part re-wraps in backticks.
- **Doc-link resolution.** A symbol with `docs/components/<Name>.md` gets that link; a `data`-layer entry with `doc: "docs/data/store.md"` uses the override; a symbol with no page and no override emits a warning and no link.
- **Drift guard.** An entry whose `symbol` is absent from the TypeDoc JSON throws a build error naming the missing symbol.
- **Budget guard.** If the rendered document estimates over 6000 tokens, the generator throws, printing the estimate.
- **Determinism.** Re-running the generator on the same inputs reproduces each output file byte-for-byte (`llms.txt` matches its prior `llms.txt`, `docs/public/llms.txt` matches its prior self — the two files are *not* identical to each other, differing by link scheme; groups and entries render in seam order, no timestamps).
- **Link-scheme split.** The root `llms.txt` carries `fs`-mode links (`docs/components/Button.md`, `ARCHITECTURE.md`) throughout — rows, conventions, **and** the mental-model / drill-down / dev-appendix prose. `docs/public/llms.txt` carries the corresponding `site`-mode links in all of those places (`https://jimka.github.io/typescript-ui/components/Button`, section roots like `…/components/`, and the GitHub blob URL for `ARCHITECTURE.md` / `CODE_CONVENTIONS.md`). The two files' non-link text is otherwise identical.
- **Site variant has zero filesystem paths.** Because every prose link is a `{{target}}` placeholder resolved through `linkFor`, no baked-in `docs/…` path survives into the hosted file. **Testable:** `grep -c 'docs/' docs/public/llms.txt` returns `0` (a raw `docs/` path anywhere means a prose block leaked a baked-in link). The fs file, by contrast, has `docs/…` on nearly every line. *Assumption:* this presumes no curated component's first-paragraph summary literally contains the substring `docs/` (true across the current curated set); if one ever does, scope the grep to line-leading/`→ ` link positions instead.
- **Coexistence.** `npm run docs:api` still produces the full markdown API tree *and* the JSON model in one TypeDoc run.

---

## Verification

- **Automatable:**
  - `npm run docs:api && ls -l docs/api/typedoc-model.json` → JSON emitted alongside markdown.
  - `npm run docs:api && npm run docs:llms` → exits 0; prints token estimate under 6000; writes both `llms.txt` (fs links) and `docs/public/llms.txt` (site links).
  - Spot-grep `llms.txt` for the three example subpaths and confirm each catalog row matches `task → **Symbol** · @jimka/typescript-ui/… · summary · docs/…`; grep `docs/public/llms.txt` for `https://jimka.github.io/typescript-ui/` on every row and the GitHub blob URL on the `ARCHITECTURE.md` link.
  - **Site-variant has zero fs paths:** `grep -c 'docs/' docs/public/llms.txt` → `0` (any raw `docs/…` path means a prose block leaked a baked-in link instead of resolving a `{{target}}` through `linkFor`). Guards the mental-model / drill-down / dev-appendix sections specifically. Assumes no curated summary contains the literal substring `docs/` (holds for the current curated set).
  - Link-resolution check: extract every `docs/…md` / `ARCHITECTURE.md` path from the canonical (fs) `llms.txt` and assert each exists on disk (a shell one-liner, or fold into the generator's warn pass).
  - Drift-guard: bogus `symbol` → generator throws (zero matches); colliding `symbol` with no `subpath` → generator throws (ambiguous) (step 11).
  - **Committed-copy staleness (build/CI drift check):** `npm run docs:api && npm run docs:llms && git diff --exit-code llms.txt` → non-zero exit if the committed root `llms.txt` no longer matches regeneration. `docs:api` runs first so the TypeDoc JSON the generator parses exists on a clean checkout (`docs:llms` alone would hard-error on the missing model). Only the committed `llms.txt` is diffed: `docs/public/llms.txt` is gitignored and regenerated in the same pass from the identical row set, so a clean `llms.txt` transitively assures the hosted copy is current — there is no tracked hosted copy to drift. Add this to the docs CI step so a stale commit fails the build.
  - `npm run docs:build` → completes with both `llms.txt` copies regenerated (confirms the hook ordering).
  - Pack check: `npm pack --dry-run` lists `llms.txt` in the tarball contents (confirms the `files` addition ships it).
  - Deploy-path check: after `docs:build`, `docs/.vitepress/dist/llms.txt` exists (VitePress copied `docs/public/llms.txt` to the site root, so the hosted URL resolves once deployed).
- **Manual (one-time):** read `llms.txt` top-to-bottom for phrasing quality and that the mental-model paragraph matches `docs/guide/mental-model.md`; confirm the README callout and installation snippet render correctly in the docs preview (`npm run docs:dev`).

---

## Documentation Impact

No public API changes (no exported symbol added, renamed, or removed), so no `docs/api/**` or barrel impact and no cross-reference churn. The change is purely additive discoverability surface:

- **`README.md`** — new "AI agents: start here" callout in the existing `## Documentation` section, linking the hosted `llms.txt` URL and noting the `node_modules` copy.
- **`docs/guide/installation.md`** — new "Using @jimka/typescript-ui with AI agents" subsection with the paste-in `CLAUDE.md`/`AGENTS.md` snippet. No sidebar entry needed (it is a subsection of an existing sidebar page).
- **`llms.txt`** — the manifest is itself a documentation artifact; it is **committed** (present in a fresh checkout) and regenerated by `docs:build`, with a CI drift check (`git diff --exit-code llms.txt`) preventing a stale commit. `docs/public/llms.txt` is the gitignored hosted copy of the same content. Content is driven by the curated seam (`scripts/llms/manifest.data.mjs`) and source JSDoc, per the generator design above — no manual upkeep of the output itself.
- **Hosted deploy** — `docs/public/llms.txt` publishes at `https://jimka.github.io/typescript-ui/llms.txt` via the existing GitHub Pages flow (push to `master`); no CI/workflow change required.

---

## Potential Challenges

- **Same-named symbols across modules** (`Body`, `TreeNode`, `BorderOptions`). Resolved by the `(module, symbol)` index plus the exactly-one-match assertion: a curated entry for such a name must carry a `subpath` disambiguator, and omitting it fails the build rather than silently picking the wrong module.
- **Re-exported symbols** are a non-issue with the module-based resolver: TypeDoc reports a symbol under the barrel module it is exported from, which *is* the import subpath a consumer uses — so the subpath is correct by construction regardless of where the source file lives.
- **TypeDoc JSON size** (~97 MB for the full 14 entry points, measured). It is a transient build artifact under gitignored `docs/api/`; only parsed, never committed.
- **Summary quality varies** — some class JSDocs lead with mechanics, not a one-liner. Mitigation: the 140-char cap keeps rows bounded; a poor summary is a signal to improve the *source* JSDoc (which also improves the API docs), not to hand-edit `llms.txt`.
- **Publish ordering** — `llms.txt` is produced by `docs:build`, not `build:lib`, so a publish run that skips docs would pack an absent/stale file. Mitigation: run `npm run docs:llms` (or `docs:build`) before `npm pack`/`npm publish`; the `npm pack --dry-run` verification catches an omission.

---

## Critical Files

- [`typedoc.json`](typedoc.json) — entry points (= the 14 code subpaths), plugin set; where `"json"` is added.
- [`typedoc-callable-plugin.mjs`](typedoc-callable-plugin.mjs) — promotes `callable()`-wrapped consts back to classes, so the JSON's `kind: 128` class nodes (with summaries) exist for every public component. The generator relies on this having run.
- [`package.json`](package.json) — `exports` (subpath SSOT) and `scripts` (hook wiring).
- `src/typescript/lib/*/index.ts` — export barrels; the source for drafting the curated catalog.
- `docs/guide/mental-model.md`, `docs/concepts/index.md` — ground the mental-model prose and convention links.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the rules the conventions section distills and the appendix links.

---

## Non-Goals

- **No per-method / per-option detail** in the manifest — that is what `docs/components/*` and `docs/api/**` already provide; the manifest only routes agents there.
- **No second published web artifact** — one root `llms.txt`; the dev material is a short appendix, not a separate doc.
- **No exhaustive symbol dump** — the catalog is a curated, task-organized ~50-row set, not all ~570 API symbols.
- **No runtime/library-code changes** — this touches only `scripts/`, config, `llms.txt`, and `CLAUDE.md`; no `src/` behavior changes.
- **No separate scheduled/nightly regeneration job** — the drift check (`git diff --exit-code llms.txt`) rides the existing docs CI step that already runs `docs:api`/`docs:llms`; no new pipeline, cron, or standalone workflow is added.
