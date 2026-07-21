---
touches-shared:
    - packages/docs/vite.config.ts
    - packages/docs/src/env.d.ts
    - packages/docs/src/content/links.ts
    - packages/docs/src/shell/DocsContent.ts
    - packages/docs/src/shell/DocsSidebar.ts
    - packages/docs/src/shell/DocsShell.ts
    - packages/docs/tests/links.test.ts
---

# API Reference in the Docs App — Implementation Plan

## Overview

`packages/docs` renders 15 authored Markdown pages today and nothing from the generated API reference. Every link an authored page carries into `/api/…` — 1,243 of them across `packages/lib/docs/` — lands on the not-found view. This plan makes the whole generated reference reachable inside the app.

The reference is produced by `npm run docs:api` (TypeDoc + `typedoc-plugin-markdown` + `typedoc-vitepress-theme`, configured in [`packages/lib/typedoc.json`](packages/lib/typedoc.json)) into the git-ignored tree `packages/lib/docs/api/`: 696 Markdown files, 29 MB, plus a 115 MB `typedoc-model.json` and a 57 KB `typedoc-sidebar.json`. The app **renders the generated Markdown**, fetched one page at a time from a static copy; it does not render from the JSON model.[^why-markdown]

Four seams already exist and are reused: the `virtual:` module plugin in [`packages/docs/vite.config.ts:12`](packages/docs/vite.config.ts#L12), the app-level source transform in [`packages/docs/src/content/containers.ts`](packages/docs/src/content/containers.ts), the `Markdown` link-resolver hook wired at [`packages/docs/src/shell/DocsContent.ts:48`](packages/docs/src/shell/DocsContent.ts#L48), and the two router patterns in [`packages/docs/src/main.ts`](packages/docs/src/main.ts). `main.ts` is **not** modified: the catch-all `/*` already routes `/api/…`.

---

## Architecture Decisions

### The generated Markdown is rendered; the JSON model is not

`packages/lib/docs/api/**/*.md` is the input. `typedoc-model.json` is used for nothing after this plan and stops being read at build time.[^why-markdown]

### API Markdown is served as static files and fetched per page, never bundled

A Vite plugin serves the `api/` tree in dev and copies it into `dist/api/` at build. The app fetches one `.md` file per navigation. The bundler never parses the 29 MB of Markdown.[^static-not-bundled]

This is the decision that keeps build memory flat. It also **removes** the 115 MB `JSON.parse` that [`vite.config.ts:20`](packages/docs/vite.config.ts#L20) performs today, which is the single largest memory item in the `build:docs` step.[^memory-budget]

### One virtual module, renamed to `virtual:typedoc-api`

The plugin at [`vite.config.ts:12`](packages/docs/vite.config.ts#L12) is renamed from `typedocSummary` to `typedocApi` and its virtual module from `virtual:typedoc-summary` to `virtual:typedoc-api`. It emits four exports: the API file list, the navigation tree, and the two counts the status bar already shows.[^rename]

Two different generated artifacts feed it, each for what it is authoritative about:

| Emitted export | Derived from | Why that source |
|---|---|---|
| `apiFiles` | a recursive directory walk of `packages/lib/docs/api` | complete — every page is reachable even if the sidebar omits it |
| `apiNav` | `packages/lib/docs/api/typedoc-sidebar.json` | carries TypeDoc's own ordering and labels |
| `moduleCount`, `symbolCount` | `typedoc-sidebar.json` | replaces the 115 MB model read |

### Routes come from the existing catch-all — no new route patterns

`main.ts` keeps exactly the two patterns it has (`/` and `/*`). An API route such as `/api/core/classes/Component` reaches `DocsShell.showPath` through `/*` like any other path, and `DocsContent` decides what to render. No registration scales with the 696 pages.[^no-new-routes]

### A route maps to a file by a fixed rule, checked against the emitted file list

Route → file is pure string work; the emitted `apiFiles` list is only consulted to confirm the file exists.

| Route | File under `packages/lib/docs/api/` |
|---|---|
| `/api` | `index.md` |
| `/api/core` | `core/index.md` |
| `/api/core/classes/Component` | `core/classes/Component.md` |
| `/api/component/button` | `component/button/index.md` |
| `/api/core/namespaces/Animation` | `core/namespaces/Animation/index.md` |
| `/api/nope` | *(no file — not-found view)* |

The rule: strip the `/api` prefix; try `<rest>.md`, then `<rest>/index.md`; an empty rest means `index.md`.

### Links inside API pages resolve against the current page's directory

Generated pages link to each other with **relative `.md` paths** (`../../../core/classes/Component.md`). Authored prose links to API pages with **absolute extension-less paths** (`/api/core/classes/Component`). A new `resolveApiLink(href, baseDir)` in `links.ts` handles the first form; the existing `resolveDocLink` already handles the second.[^two-link-forms]

`baseDir` is the directory of the file currently rendered, e.g. `component/button/classes`.

| Rendered file | Authored href | Resolved route | Result href |
|---|---|---|---|
| `component/button/classes/Button.md` | `../../../core/classes/Component.md` | `/api/core/classes/Component` | `#/api/core/classes/Component` |
| `core/index.md` | `classes/Panel.md` | `/api/core/classes/Panel` | `#/api/core/classes/Panel` |
| `core/classes/Component.md` | `../../index.md` | `/api` | `#/api` |
| `core/classes/Component.md` | `/api/layout/classes/Tab` | `/api/layout/classes/Tab` | `#/api/layout/classes/Tab` |
| `core/classes/Component.md` | `#setscrollleft` | *(in-page)* | `#setscrollleft`, not external |
| `core/classes/Component.md` | `https://github.com/…` | *(external)* | unchanged, external |

### `***` separators are stripped in the app, not added to the viewer

The generated tree contains 38,990 lines that are exactly `***`. The `Markdown` viewer has no `hr` case, so [`Markdown.ts:648`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L648) renders each one as the literal text `***`. A new `normalizeApiMarkdown` in the docs app removes them before the source reaches the viewer.[^hr-app-level]

### Navigation is a third sidebar root, driven by `typedoc-sidebar.json`

`DocsSidebar` gains an **API Reference** root alongside Guide and Concepts. Its children mirror `typedoc-sidebar.json` with TypeDoc's category level flattened away.[^flatten-categories]

```
API Reference                       → /api
  component                         (group, no page)
    button                          → /api/component/button
      Button                        → /api/component/button/classes/Button
      ButtonOptions                 → /api/component/button/interfaces/ButtonOptions
      …
  core                              → /api/core
    Animation                       → /api/core/namespaces/Animation
      …
    Component                       → /api/core/classes/Component
    …
```

### The sidebar reveals the active path instead of expanding everything

[`DocsSidebar.ts:46`](packages/docs/src/shell/DocsSidebar.ts#L46)'s `expandAll()` call is removed. `select(path)` calls [`Tree.revealByPredicate`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L276), which expands every ancestor on the path to the matching node and scrolls it into view, then selects it.[^reveal-not-expandall]

### Fetching makes `showPath` asynchronous, guarded by a request token

`DocsContent.showPath` stays synchronous for an authored page (its source is bundled) and starts a fetch for an API page. A monotonic request token discards a response whose navigation has been superseded, and a `Map` caches fetched sources for the session.[^async-guard]

The pane keeps showing the previous page until the new source arrives. There is no loading placeholder.[^no-placeholder]

---

## Public API

No library API changes. Everything is inside `packages/docs`.

### `packages/docs/src/env.d.ts`

```typescript
declare module 'virtual:typedoc-api' {
  /** Every generated API page, as a path relative to packages/lib/docs/api. */
  export const apiFiles: string[];
  /** TypeDoc's own navigation tree, normalized to app routes. */
  export const apiNav: ApiNavNode[];
  export const moduleCount: number;
  export const symbolCount: number;

  export interface ApiNavNode {
    label:    string;
    /** The route this entry opens, or null for a grouping-only entry. */
    path:     string | null;
    children: ApiNavNode[];
  }
}
```

`virtual:typedoc-summary` is deleted from this file.

### `packages/docs/src/content/api.ts` (new)

```typescript
/** Route path prefix every API page lives under. */
export const API_PREFIX: string;                       // "/api"

/** True when `path` is inside the API reference. */
export function isApiPath(path: string): boolean;

/** The generated file for `path`, or null when no page exists. */
export function apiFileFor(path: string): string | null;

/** The route for a file path — the inverse of `apiFileFor`. */
export function apiRouteFor(file: string): string;

/** The directory part of a file path, "" for a file at the tree root. */
export function apiDirOf(file: string): string;

/** Fetches an API page's Markdown, normalized. Rejects on a non-OK response. */
export function fetchApiPage(file: string): Promise<string>;

/** The API Reference sidebar root, ready for Tree.setNodes. */
export function getApiNav(): ApiNavNode[];
```

### `packages/docs/src/content/apiMarkdown.ts` (new)

```typescript
/** Removes constructs the library Markdown viewer cannot render. */
export function normalizeApiMarkdown(source: string): string;
```

### `packages/docs/src/content/links.ts`

```typescript
/**
 * Resolves a link authored inside a generated API page. `baseDir` is the
 * directory of the page being rendered, e.g. "component/button/classes".
 */
export function resolveApiLink(href: string, baseDir: string): MarkdownLinkResolution;
```

`hashHref` and `resolveDocLink` keep their current signatures.

---

## Internal Structure

### The Vite plugin (`packages/docs/vite.config.ts`)

Three responsibilities, one plugin named `typedoc-api`:

```typescript
const API_DIR = fileURLToPath(new URL('../lib/docs/api', import.meta.url))
```

1. **`load`** — emits `apiFiles` (recursive walk of `API_DIR`, `.md` only, POSIX separators, sorted), `apiNav` (from `typedoc-sidebar.json`), and the two counts. A missing `API_DIR` or `typedoc-sidebar.json` throws the same shape of error the plugin throws today: *"…not found at X — run `npm run docs:api` first."*
2. **`configureServer`** — a middleware serving `.md` files out of `API_DIR` in dev.
3. **`closeBundle`** — `cpSync(API_DIR, <outDir>/api, { recursive: true, filter })`, where `filter` rejects `typedoc-model.json` and `typedoc-sidebar.json`.

The dev middleware matches the request URL with the app's `base` optionally present, because Vite may or may not have stripped it by the time a custom middleware runs:

```typescript
// "/typescript-ui/next/api/core/classes/Component.md" and
// "/api/core/classes/Component.md" must both resolve to
// <API_DIR>/core/classes/Component.md.
const API_URL = /^(?:\/typescript-ui\/next)?\/api\/(.+\.md)$/
```

A resolved path is rejected unless it stays inside `API_DIR` after `resolve()`, so a `..` in the URL cannot read outside the tree.

### Sidebar-JSON normalization (in the plugin)

`typedoc-sidebar.json` entries carry VitePress links. Convert each to a route, and drop the category level:

| Sidebar `link` | Route |
|---|---|
| `/api/component/button/classes/Button.md` | `/api/component/button/classes/Button` |
| `/api/component/button/` | `/api/component/button` |
| `/api/core/namespaces/Animation/` | `/api/core/namespaces/Animation` |
| *(absent)* | `null` |

A node is a **category** when it has `items` and **no** `link` and its parent is a module. Its children are spliced into the parent in order, and the category node itself is dropped. The top-level `component` node also has no `link`, but its parent is the root, so it is kept as a grouping node.

Counts, over the parsed sidebar:

- `symbolCount` — entries whose `link` ends in `.md`.
- `moduleCount` — entries whose `link` ends in `/` and does **not** contain `/namespaces/`.

### `apiFileFor` (`packages/docs/src/content/api.ts`)

```typescript
const FILES = new Set(apiFiles);

export function apiFileFor(path: string): string | null {
    if (!isApiPath(path)) return null;

    const rest = path.slice(API_PREFIX.length).replace(/^\//, '');
    const direct = rest === '' ? 'index.md' : rest + '.md';

    if (FILES.has(direct)) return direct;

    const index = rest === '' ? null : rest + '/index.md';

    return index !== null && FILES.has(index) ? index : null;
}
```

### `resolveApiLink` (`packages/docs/src/content/links.ts`)

Three branches, in this order — the first match wins:

1. `href` starts with `#` — in-page, returned unchanged and non-external.
2. `href` starts with `/` — an absolute site path; delegate to `resolveDocLink`.
3. `href` ends in `.md` — a relative generated link. Join it onto `baseDir`, resolve `.`/`..` segments, then `apiRouteFor` and `hashHref`.

Anything else is external, returned unchanged.

Path joining is plain segment arithmetic — split both on `/`, drop `.`, pop on `..`:

| `baseDir` | `href` | Joined file | Route |
|---|---|---|---|
| `component/button/classes` | `../../../core/classes/Component.md` | `core/classes/Component.md` | `/api/core/classes/Component` |
| `core` | `classes/Panel.md` | `core/classes/Panel.md` | `/api/core/classes/Panel` |
| `core/classes` | `../../index.md` | `index.md` | `/api` |

### `DocsContent` state and flow

```typescript
private _linkBaseDir:  string | null = null;   // null while an authored page is shown
private _requestToken: number        = 0;
private readonly _apiSources: Map<string, string> = new Map();

// Stable reference, mirroring handleLinkClick at DocsContent.ts:33.
private readonly resolveLink: (href: string) => MarkdownLinkResolution =
    (href) => (this._linkBaseDir === null
        ? resolveDocLink(href)
        : resolveApiLink(href, this._linkBaseDir));
```

`showPath(path)`:

1. `const token = ++this._requestToken;`
2. `getPage(path)` hits — set `_linkBaseDir = null`, show the source, return.
3. `apiFileFor(path)` misses — set `_linkBaseDir = null`, show the not-found source, return.
4. The file is in `_apiSources` — set `_linkBaseDir = apiDirOf(file)`, show the cached source, return.
5. Otherwise start `fetchApiPage(file)`. On resolve, cache it; then if `token === this._requestToken`, set `_linkBaseDir` and show it. On reject, if the token still matches, show an error source naming the path.

`_linkBaseDir` is always assigned **before** `setMarkdown`, because the viewer calls the resolver during that render.

"Show the source" is the existing pair: `this._markdown.setMarkdown(source)` then `this.setScrollTop(0)`.

---

## Ordered Implementation Steps

**Precondition.** `packages/lib/docs/api/` is git-ignored and may be stale or absent. Run `npm run build:lib && npm run docs:api` from the repo root first, and confirm `packages/lib/docs/api/typedoc-sidebar.json` and `packages/lib/docs/api/router/index.md` both exist — `router` is an entry point in `typedoc.json` that a stale tree will be missing.

1. **`packages/docs/vite.config.ts`** — rename `typedocSummary` to `typedocApi` and `VIRTUAL` to `'virtual:typedoc-api'`. Replace the `MODEL` constant with `API_DIR`. Implement `load` per *The Vite plugin*: the recursive `.md` walk, the sidebar parse and normalization, and the two counts. Delete the `readFileSync` of `typedoc-model.json`.
   - Check: `grep -n 'typedoc-model' packages/docs/vite.config.ts` — expect zero matches.
2. **`packages/docs/vite.config.ts`** — add the `configureServer` middleware and the `closeBundle` copy, both per *The Vite plugin*.
3. **`packages/docs/src/env.d.ts`** — replace the `virtual:typedoc-summary` declaration with the `virtual:typedoc-api` block from `## Public API`.
4. **`packages/docs/src/shell/DocsShell.ts`** — change the import at line 7 to `from 'virtual:typedoc-api'`. Nothing else in that file changes; the status-bar message keeps its wording.
   - Check: `grep -rn 'typedoc-summary' packages/docs/` — expect zero matches.
5. **`packages/docs/src/content/apiMarkdown.ts`** (new) — `normalizeApiMarkdown(source)`: drop every line that is exactly `***` after trimming. Leave everything else byte-identical.
6. **`packages/docs/src/content/api.ts`** (new) — the functions in `## Public API`. `fetchApiPage` builds its URL as `` `${import.meta.env.BASE_URL}api/${file}` ``, `fetch`es it, throws on `!response.ok`, and returns `normalizeApiMarkdown(await response.text())`. `getApiNav` returns the `apiNav` import unchanged.
7. **`packages/docs/src/content/links.ts`** — add `resolveApiLink` per *`resolveApiLink`*, with the segment-joining helper as a module-private function. Do not change `hashHref` or `resolveDocLink`.
8. **`packages/docs/src/shell/DocsContent.ts`** — add the three fields and the `resolveLink` reference from *`DocsContent` state and flow*; pass `resolveLink` to `Markdown` at line 48 in place of `resolveDocLink`; rewrite `showPath` (line 60) as the five-step flow. Extract the two-line "show the source" pair into a private `render(source: string)` so all five branches share it.
9. **`packages/docs/src/shell/DocsSidebar.ts`** — append a third root node, `{ label: 'API Reference', data: '/api', children: … }`, built from `getApiNav()` by mapping each `ApiNavNode` to a `TreeNode` (`label`, `data: path ?? undefined`, `children`). Record every node with a non-null `path` in `_nodesByPath`. Delete the `expandAll()` call at line 46. Rewrite `select(path)` to call `revealByPredicate`, then `selectNode` on the returned node, discarding the result when `path` is no longer the most recent argument.
   - Check: `grep -n 'expandAll' packages/docs/src/shell/DocsSidebar.ts` — expect zero matches.
10. **`packages/docs/tests/apiMarkdown.test.ts`** (new), **`packages/docs/tests/api.test.ts`** (new), **`packages/docs/tests/links.test.ts`** — the cases in `## Expected Behaviour`. `links.test.ts` gains a `describe('resolveApiLink')` block; its existing blocks stay unchanged.
    - Check: `npm -w packages/docs run test` — green.
11. **`packages/docs/package.json`** — no change. **`packages/docs/tsconfig.json`** — no change.
12. From the repo root: `npm run build:lib`, `npm -w packages/docs run typecheck`, `npm -w packages/docs run test`, `npm run build:docs`.
    - Check: `ls packages/docs/dist/api/core/classes/Component.md` exists, and `ls packages/docs/dist/api/typedoc-model.json` does **not**.
13. **`.github/workflows/docs.yml`** — extend the comment above the `build:docs` step to record that `packages/docs/dist` now also carries a copy of the generated API Markdown. No step is added or reordered: `docs:build` already runs `docs:api` before `build:docs`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/docs/vite.config.ts` |
| Modify | `packages/docs/src/env.d.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/src/shell/DocsSidebar.ts` |
| Modify | `packages/docs/src/content/links.ts` |
| Modify | `packages/docs/tests/links.test.ts` |
| Modify | `.github/workflows/docs.yml` |
| Create | `packages/docs/src/content/api.ts` |
| Create | `packages/docs/src/content/apiMarkdown.ts` |
| Create | `packages/docs/tests/api.test.ts` |
| Create | `packages/docs/tests/apiMarkdown.test.ts` |

No file in `packages/lib` is touched. `packages/docs/src/main.ts` and `packages/docs/src/content/pages.ts` are not touched.

---

## Expected Behaviour

### `normalizeApiMarkdown` — *unit, `apiMarkdown.test.ts`*

- `"a\n\n***\n\nb"` becomes `"a\n\n\n\nb"` — the `***` line is removed, surrounding blank lines are not.
- A source with no `***` line is returned byte-identical.
- A fenced block containing a line `***` is **also** stripped. This is accepted: no generated page has one.[^fence-hr]
- `"**bold**"` and `"***emphasis***"` are untouched — only a line that is exactly `***` matches.

### `api.ts` route ⇄ file mapping — *unit, `api.test.ts`*

Assert every row of the table in *A route maps to a file by a fixed rule*, plus:

- `isApiPath('/api')` and `isApiPath('/api/core')` are true; `isApiPath('/guide')` and `isApiPath('/apiary')` are false.
- `apiRouteFor('index.md')` is `/api`; `apiRouteFor('core/index.md')` is `/api/core`; `apiRouteFor('core/classes/Component.md')` is `/api/core/classes/Component`.
- `apiRouteFor(apiFileFor(r))` returns `r` for every route in the emitted nav tree that has a non-null `path`. This is the round-trip guard and it exercises the real generated data.
- `apiDirOf('core/classes/Component.md')` is `core/classes`; `apiDirOf('index.md')` is `''`.
- No two entries in `apiFiles` map to the same route — a collision between `X.md` and `X/index.md` would make one page unreachable.
- Every `path` in `getApiNav()` resolves through `apiFileFor` to a non-null file.

### `resolveApiLink` — *unit, `links.test.ts`*

Assert every row of the table in *Links inside API pages resolve against the current page's directory* and every row in the joining table under *`resolveApiLink`*, plus:

- `resolveApiLink('#setscrollleft', 'core/classes')` returns `{ href: '#setscrollleft', external: false }` — no `#/` prefix, so it stays an in-page reference.
- `resolveApiLink('https://github.com/x', 'core/classes')` is external and unchanged.
- `resolveApiLink('/concepts/sizing', 'core/classes')` returns `{ href: '#/concepts/sizing', external: false }` — an absolute path leaves the API tree and goes through the authored-page rule.
- `resolveApiLink('Component.md', '')` returns `{ href: '#/api/Component', external: false }` — an empty `baseDir` does not produce a leading `/`.

### `DocsContent` — *manual verification (browser)*

Fetching, rendering, and scrolling are not exercisable by the node test harness.

- Navigating to `#/api` shows the module index, and each of its 17-plus links opens the matching module page.
- `#/api/core/classes/Component` renders with no literal `***` anywhere on the page.
- On that page, a member cross-link (e.g. to `ComponentOptions`) navigates in-app; a `Defined in:` GitHub link opens a new tab; the breadcrumb `core` link at the top opens `#/api/core`.
- From `#/guide/mental-model`, a `/api/core/classes/Component` link navigates in-app to that page.
- Reloading directly on `#/api/component/button/classes/Button` renders the page — the route resolves without a prior in-app navigation.
- Navigating away and back to a previously viewed API page renders from cache with no network request (DevTools Network panel).
- Clicking two API pages in quick succession leaves the **second** one showing.
- `#/api/nope` shows the not-found view naming `/api/nope`.
- Every API page opens scrolled to the top.
- Record the time from click to painted content for `#/api/overlay/classes/NotificationHistoryButton`, the largest generated page at 198 KB. Note it in the implementation notes.[^largest-page]

### `DocsSidebar` — *manual verification (browser)*

- On first load at `#/guide`, the Guide root is expanded and Concepts and API Reference are collapsed.
- Expanding API Reference shows `component`, `core`, `data`, `layout`, `overlay`, `primitive`, `router`, `validation` — no `Components` or `Other` category level anywhere.
- Navigating to `#/api/component/button/classes/Button` by clicking a link in the content pane expands API Reference → `component` → `button`, selects `Button`, and scrolls it into view.
- Clicking `core` in the tree opens `#/api/core`; clicking `component` (a grouping node with no page) only expands.
- The sidebar scrolls; no row is clipped horizontally at the deepest level.

---

## Verification

```bash
npm run build:lib
npm run docs:api                      # regenerate; the tree is git-ignored and may be stale
npm -w packages/docs run typecheck
npm -w packages/docs run test
npm run build:docs

grep -rn 'typedoc-summary' packages/docs/          # expect zero matches
grep -n  'typedoc-model'   packages/docs/vite.config.ts   # expect zero matches
grep -n  'expandAll'       packages/docs/src/shell/DocsSidebar.ts   # expect zero matches
ls packages/docs/dist/api/core/classes/Component.md        # exists
ls packages/docs/dist/api/typedoc-model.json 2>/dev/null   # must NOT exist
du -sh packages/docs/dist                                  # expect ~30 MB, dominated by api/
```

Then `npm -w packages/docs run dev` and walk both manual lists above.

Build memory: run `npm run build:docs` and confirm it completes without a `NODE_OPTIONS` heap pin. It must, because the plugin no longer parses a 115 MB file and the bundler never sees the API Markdown.

---

## Documentation Impact

None. No library symbol is added, renamed, or removed, so no page under `packages/lib/docs/` changes and `packages/lib/llms.txt` is unaffected. `packages/lib/typedoc.json` is not touched, so the VitePress site's own API section is byte-identical.

---

## Potential Challenges

- **A stale or absent `packages/lib/docs/api/` tree.** It is git-ignored, and the copy on this machine predates the `router` entry point. The plugin throws a named error when the tree or the sidebar JSON is missing, and the precondition in `## Ordered Implementation Steps` regenerates it.
- **Deep sidebar rows overflowing 260 px.** `API Reference → component → button → Button` is depth 4, which `Tree`'s 16 px indent puts at 64 px before the label. `Tree` scrolls horizontally, so a long symbol name clips rather than breaks; the manual check calls it out. Widen `SIDEBAR_WIDTH` if it reads badly.
- **A 198 KB page rendered in one pass.** The generated pages inline every inherited member, so the largest is 198 KB of Markdown. Rendering is a single synchronous `setMarkdown`. The manual list records the measured time so a follow-up has a number to work from.
- **The Pages artifact grows by ~29 MB.** `packages/docs/dist` is copied into the VitePress output by [`docs.yml:52`](.github/workflows/docs.yml#L52). That is well inside the artifact limit, and the tree compresses heavily, but it is a real size change worth noticing in the first CI run.
- **`resolveApiLink` is called once per link on a page with thousands of links.** It is pure string work with no allocation beyond two `split` calls, so it stays negligible; do not add caching for it.
- **Inline angle brackets in generated prose.** Generated headings carry escaped forms like `Class: Component\<TOptions\>`, which render as text. An unescaped `<X>` outside a code fence would be parsed as inline HTML and dropped by the viewer. None was found in the current tree; if one appears, it is a `normalizeApiMarkdown` case, not a viewer change.

---

## Critical Files

- [`packages/docs/vite.config.ts`](packages/docs/vite.config.ts) — the existing `typedocSummary` plugin (line 12) this plan rewrites, and the `keepNames` minify guard below it that must not be touched.
- [`packages/docs/src/content/containers.ts`](packages/docs/src/content/containers.ts) — the precedent for an app-level source transform of a dialect the library viewer does not support. `normalizeApiMarkdown` mirrors its shape and its header comment style.
- [`packages/docs/src/content/links.ts`](packages/docs/src/content/links.ts) — `resolveDocLink`'s three-branch classification, which `resolveApiLink` extends rather than replaces.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `showPath` (line 60), the `Markdown` construction (line 48), and the stable-reference field idiom at line 33 that `resolveLink` copies.
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — `buildNodes` (line 75), `_nodesByPath`, `select` (line 63), and the `expandAll` call (line 46) to delete.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts:276`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L276) — `revealByPredicate`: expands ancestors and scrolls into view, but does **not** select. Read its doc comment before wiring `select`.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts:648`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L648) — the block-token default branch that renders an unsupported token's raw text; this is why `***` must be stripped upstream.
- [`packages/lib/docs/api/typedoc-sidebar.json`](packages/lib/docs/api/typedoc-sidebar.json) — the nav source. Inspect its real shape before writing the normalizer.
- [`plans/implemented/packages-docs.md`](plans/implemented/packages-docs.md) — the app's architecture, the two-route decision, and the link-resolution rules this plan builds on.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — listening only on self, named listener functions, options-bag caching.

---

## Non-Goals

- **Migrating the 138 remaining authored pages.** `plans/docs-content-migration.md` owns that. This plan does not touch `pages.ts` and adds no authored page; the only change it makes to the Guide and Concepts roots is dropping `expandAll`.
- **Cutover to the site root**, including `404.html` and `llms.txt` re-homing. `plans/docs-cutover.md` owns that. `base` stays `/typescript-ui/next/`.
- **`Router.getHref`.** `plans/router-href.md` is unimplemented and will change `resolveDocLink`'s signature. `resolveApiLink` delegates to `resolveDocLink` for absolute paths, so it inherits that change for free when `router-href` lands; nothing here anticipates it.
- **Search over the API surface.** The library has no search facility and the reference is the surface that most needs one, but an index build plus a UI is its own plan.
- **An in-page outline for API pages.** A 198 KB class page is where a member outline pays off most, and heading `id`s already exist to drive one. It is UI work with no dependency on this plan.
- **Changing `typedoc.json`.** Trimming inherited members would shrink the largest pages, but the config is shared with the live VitePress site and any change there alters the deployed reference.
- **Rendering from `typedoc-model.json`.** Rejected — see the footnote on the first architecture decision.
- **Syntax highlighting inside the generated `ts` fences.** Already a non-goal of `packages-docs.md`; the reference adds volume, not a new requirement.
- **Prefetching or a service worker.** A per-page fetch off a static host is fast enough, and the session cache already covers re-visits.

---

## Notes

[^why-markdown]: Two inputs were compared. **The generated Markdown** already contains everything a reader needs — signatures in fenced `ts` blocks (`useCodeBlocks: true`), expanded objects and parameters, inherited members, type parameters, resolved cross-links, and `Defined in:` source links — because `typedoc-plugin-markdown` produced it. Rendering it needs a route⇄file map, a link resolver, and one line-filter: roughly 200 lines of app code. **The JSON model** is 115 MB and holds TypeDoc reflections, not prose: turning it into a page means reimplementing the plugin's type printer, signature formatter, inheritance resolution, and cross-reference resolver — that is the plugin's entire job, thousands of lines, and it would drift from the VitePress site's rendering of the same symbols. The model also costs more than a gigabyte of heap to parse. The only thing the model offers that the Markdown does not is structured querying (a future search index), and that can be built later from a purpose-built extract rather than by rendering from the model. Model-driven rendering is rejected.

[^static-not-bundled]: The alternative is `import.meta.glob('…/api/**/*.md', { query: '?raw' })` without `eager`, which is how `pages.ts` reads authored content. It was rejected on build cost: Rollup would take 696 Markdown files totalling 29 MB through the module graph and emit 696 hashed chunks, holding all of it in memory at once. Serving the files as static assets keeps them out of the module graph entirely, so the build cost is one recursive `cpSync`. It also makes transfer proportional to what the reader opens rather than to the size of the reference.

[^memory-budget]: `docs:build` pins `NODE_OPTIONS=--max-old-space-size=12288` and OOM-kills on memory-constrained machines. That pin is for VitePress and TypeDoc, and this plan does not change it. The separate `build:docs` step, which is what this plan touches, currently parses a 115 MB JSON file for two integers — roughly 1.5 GB of peak heap for a value the 57 KB sidebar file also yields. Removing that parse is why the target after this plan is a `build:docs` that needs no heap pin at all, despite the reference growing from zero pages to 696.

[^rename]: The module now carries a file list and a navigation tree, so `summary` is no longer what it is. Keeping the old name would leave the one virtual module in the app misnamed for the rest of its life, and the rename is mechanical: one import in `DocsShell.ts`, one declaration in `env.d.ts`, two constants in `vite.config.ts`. `packages-docs.md`'s note that the virtual module must keep at least one consumer still holds — `DocsShell` and `api.ts` are both consumers after this plan, so tree-shaking cannot silently drop the build-time read.

[^no-new-routes]: `packages-docs.md` chose two patterns precisely so that page count and route count stay decoupled, and the API surface is the case that decision was made for: 696 pages, zero new registrations. `Router`'s specificity ranking is untouched, so `/` still beats `/*` for the empty hash. Registering `/api/*` as a third pattern was considered and dropped — it would rank above `/*` and need its own handler, for no behaviour the `getPage` / `apiFileFor` branch inside `showPath` does not already give.

[^two-link-forms]: The two forms exist because they were authored by different producers. `typedoc-plugin-markdown` emits filesystem-relative links so the generated tree is browsable on disk. Human-authored prose uses VitePress's absolute site paths, and there are 1,243 of them; the most frequent are `/api/core/classes/Component` (28) and `/api/layout/classes/Tab` (27). Because that authored form is already `/`-prefixed, `resolveDocLink`'s existing route branch handles it with no change — which is why this plan adds a function rather than modifying one. A third form appears inside JSDoc prose that TypeDoc copies verbatim into generated pages, so an API page can carry an absolute `/api/…` link too; branch 2 of `resolveApiLink` covers it.

[^hr-app-level]: Adding an `hr` case to the viewer would be a Markdown *syntax* change, and `packages-docs.md`'s parity contract then requires a matching `MarkdownEditor` transformer, node registration, and theme rule — a library change with an editor half, to render a decorative rule. `***` is a member separator that the heading structure already communicates, so removing it loses nothing. `containers.ts` set the precedent for handling a construct the viewer does not support at the app level.

[^flatten-categories]: TypeDoc groups each module's symbols under category headings, but the only categories in this project's output are `Components`, `Core`, and `Other`, and 11 of the 17 modules have either one category or a one-entry `Other`. Keeping the level would add a tree depth that carries almost no information and push symbol rows to depth 5. Flattening preserves TypeDoc's ordering — classes, then interfaces, then type aliases — which is the part of the grouping readers actually use.

[^reveal-not-expandall]: `expandAll()` on a tree that now contains roughly 700 nodes produces a 700-row flat list, which is the flat sidebar this plan exists to avoid. `Tree` has no public single-node expand method, but `revealByPredicate` does exactly what is needed — expand the ancestors of one node and scroll it into view — and it is already the library's answer to "jump to this object". Its doc comment warns it is O(nodes) and not for a hot path; one call per navigation is not a hot path. It also never collapses anything, so a branch the reader opened stays open. The visible cost is that Concepts no longer starts expanded, which is the correct default once the tree has a third, much larger root.

[^async-guard]: Without a token, a slow fetch for page A resolving after a fast fetch for page B would overwrite B with A, and the URL would disagree with the pane. The token is compared, not cancelled, because `fetch` cancellation via `AbortController` would add a second failure mode (an abort rejection to distinguish from a real network error) for no gain — a discarded response still populates the cache, which makes a later visit to that page instant.

[^no-placeholder]: A `# Loading…` placeholder would flash on every API navigation for the ~20 ms a local static fetch takes, which reads as a flicker rather than as feedback. Keeping the previous page visible is what a browser does during a navigation and needs no extra state. The cost is that a genuinely slow fetch looks like nothing happened; the error branch covers the case where it fails outright.

[^fence-hr]: A line-based filter cannot tell a fenced block from prose without tracking fence state, and tracking it would be the only stateful part of the transform. The generated tree was checked: all 38,990 `***` lines are member separators, and no fenced block in the tree contains one. If a future doc comment introduces one, the symptom is a missing line inside a code sample, and the fix is to teach the filter about fences at that point.

[^largest-page]: The number matters for a later decision — whether API pages need progressive or section-lazy rendering — and there is no way to get it except by measuring. Recording it costs one DevTools reading during the manual pass and saves a future plan from guessing. Nothing in this plan is contingent on the result.

---

## Implementation Notes

**Category flattening generalizes recursively, one level deeper than the plan's examples show.** The freshly generated `typedoc-sidebar.json` has a level the plan's survey didn't record: under `core`, `overlay`, and a few other modules, TypeDoc emits domain categories (`Core`, `Data`, `Theme`, `Util`, `Other`) that contain **namespaces** (`Animation`, `Event`, …) which themselves carry a further category level (`Interfaces`, `Functions`). The plan's flatten rule ("a node with no `link` and `items`, whose parent is a module") is written for one level. The implementation in `vite.config.ts`'s `flattenItems` applies the identical no-link-plus-items test **recursively at every depth** rather than only directly under a module: any node lacking a `link` but carrying `items` is spliced away in favour of its (recursively flattened) children, at any nesting depth, while a node **with** a `link` is never flattened — only its own subtree is. This is a generalization of the stated rule, not a different one: it reduces to the plan's exact examples wherever the tree is only one level deep, and it extends the same "a category carries no information the heading structure doesn't already give" rationale to the namespace/category level the plan hadn't seen. The one exemption named in the plan — a top-level entry with no `link` (`component`) stays as a grouping node rather than being flattened away — is preserved by only ever flattening a node's *children*, never a node passed in from its own parent's top-level array.

**`grep -n 'typedoc-model' packages/docs/vite.config.ts` still matches once, by design.** The plan's verification section expects zero matches, written against step 1 ("delete the `readFileSync` of `typedoc-model.json`"). Step 2's own `closeBundle` spec requires the copy filter to reject `typedoc-model.json` by name, which necessarily keeps the filename as a literal string in the file. The implementation follows the *Internal Structure* section literally: there is no `readFileSync`, no `JSON.parse`, and no read of the model anywhere — the sole remaining occurrence is the `closeBundle` filter's exclusion check, which is the mechanism that keeps the model out of `dist/`. Treating this as a false positive on the grep rather than removing the filter (which would let the 115 MB model leak into the build output).

**Reconciling the `/api/` `notFoundSource` special case (task integration point 4).** Before this plan, `DocsContent.notFoundSource` treated every `/api/...` path as unregistered and pointed the reader at the published VitePress reference. Now that `/api/...` is a real, registered route, that branch only fires for a path `apiFileFor` cannot resolve to a generated file (a typo, a removed symbol, `/api/nope`). Its message was rewritten from "The generated API reference is not part of this preview" (now false — real API pages render in this app) to `` `${path}` does not match a page in the generated API reference. `` — naming the path per the existing convention, without the now-inaccurate claim about the preview. A second, new not-found-shaped message (`fetchErrorSource`) was added for the distinct case of a *known* file whose `fetch` rejected (network failure), so a transient fetch error reads differently from "this page doesn't exist."

**Click-to-paint measurement for the largest generated page** (`/api/overlay/classes/NotificationHistoryButton`, ~202 KB): measured client-side via `performance.now()` around the click plus an `requestAnimationFrame` poll for the rendered `<h1>`, to avoid the MCP round-trip latency that would otherwise contaminate the number. Two trials each: **dev server** (`npm run dev`, unbundled/transformed on the fly) — 858 ms and 928 ms; **production preview** (`npm run build:docs` + `vite preview`) — 284 ms and 525 ms. The dominant cost in every trial is `Markdown.setMarkdown` parsing and rendering ~200 KB of Markdown into DOM (headings, code fences, cross-links) synchronously in one pass — not the network fetch, which is a same-host static file and negligible by comparison; a second (cache-hit) visit to the same page costs about the same as the first, confirming the fetch itself isn't the bottleneck. This is exactly the number the plan's `[^largest-page]` footnote anticipated a follow-up would need to decide whether large API pages warrant progressive or section-lazy rendering; nothing in this plan is contingent on it.

**Manual verification** (`DocsContent` and `DocsSidebar` checklists) was carried out against both the dev server and the production `dist/` build via `mcp__chrome-devtools__*`, using a genuinely fresh tab (`new_page`) for the first-load sidebar-state checks, since a same-origin hash-only navigation does not reset in-page JS state (confirmed empty `localStorage`/`sessionStorage`, so the persistence is purely the live `Tree` instance, not a storage-backed feature). All items in both manual checklists passed, including the request-token race guard (clicking the largest page then a small page in quick succession leaves the small page's content showing, and the discarded large-page fetch never overwrites it once it resolves later) and the fetch-cache guard (`list_network_requests` showed no duplicate `.md` GET on a revisited API page).

**`closeBundle` needed a `command === 'build'` guard the plan didn't specify.** Running `npm -w packages/docs run test` showed Vitest resolves this same `vite.config.ts` to drive its own transform pipeline, and while doing so stubs `build.outDir` to a sentinel `'dummy-non-existing-folder'` rather than the real `dist`. Without a guard, `closeBundle` fired during every test run and copied the 30 MB API tree into that sentinel path inside `packages/docs/`. `typedocApi()` now captures `command` from `configResolved` and returns early in `closeBundle` unless `command === 'build'` — the standard way a Vite plugin restricts a build-only side effect, and not specific to this plugin's shape. Confirmed fixed: a full `test` run no longer creates the sentinel directory, and `npm run build:docs` still copies the tree into the real `dist/api` correctly.

**Pre-existing, out-of-scope finding:** every generated page's `Defined in:` GitHub link is wrong on this machine — it embeds the working-directory-relative path including the `.worktrees/docs-typedoc-reference/` prefix (e.g. `.worktrees/docs-typedoc-reference/packages/lib/src/typescript/lib/core/Component.ts:297`) instead of the repo-relative path, because TypeDoc's `docs:api` run resolves source paths from the worktree's own root. This is a `typedoc.json` / generation-environment concern, explicitly out of this plan's scope (`## Non-Goals`: "Changing `typedoc.json`"), predates this plan, and is unrelated to the route/link-resolution work here — flagged for a separate fix, not addressed.

**Sidebar ordering: the generated tree is sorted, reversing this plan's `[^flatten-categories]` claim in part.** That footnote justified flattening categories partly on the grounds that "flattening preserves TypeDoc's ordering — classes, then interfaces, then type aliases — which is the part of the grouping readers actually use". Reviewing the result in a browser showed the opposite: kind-order puts `Button`, `MenuButton` and `SplitButton` ahead of `ButtonEvent` and `ButtonOptions`, so a reader scanning for a name has to know a symbol's kind before they can find it. `getApiNav` now sorts each level — grouping nodes first, then pages, each run alphanumerically by label (`numeric` collation so `Foo2` precedes `Foo10`, `sensitivity: 'base'` so a lowercase function name interleaves with class names rather than forming its own block).

The sort is deliberately confined to this machine-generated tree. The authored sections registered by `docs-content-migration` keep their hand-curated `config.mts` order, because there the sequence carries meaning that alphabetising would destroy — `Overview` opens Concepts, `Introduction` precedes `Installation`, and `Catalog` is Components' index rather than an entry to be sorted among its subgroups. Two recursive cases in `api.test.ts` pin the ordering across all 600+ nodes and assert the sort neither drops nor duplicates one.
