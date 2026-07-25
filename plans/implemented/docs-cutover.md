---
depends-on: [docs-content-migration, docs-typedoc-reference]
touches-shared:
    - .github/workflows/docs.yml
    - packages/docs/vite.config.ts
    - packages/docs/src/main.ts
    - packages/docs/src/content/links.ts
    - packages/docs/src/shell/DocsContent.ts
    - packages/docs/tests/links.test.ts
    - packages/lib/docs/concepts/routing.md
---

# Docs Cutover — Implementation Plan

## Overview

`packages/docs` is a documentation app built with `@jimka/typescript-ui` itself. It ships today as a **preview** at `https://jimka.github.io/typescript-ui/next/` — [`vite.config.ts:32`](packages/docs/vite.config.ts#L32) sets `base: '/typescript-ui/next/'`, and [`docs.yml:55`](.github/workflows/docs.yml#L55) copies its build output into a `next/` subdirectory of the VitePress site that owns the root.

This plan promotes the app to the site root and retires VitePress. Four things change together: the app's base path becomes `/typescript-ui/`, the library `Router` gains a History mode so the app can serve the path-shaped URLs the site already publishes, a `404.html` SPA fallback is installed in the slot VitePress vacates, and the generated site copy of `llms.txt` is re-homed from `packages/lib/docs/public/` into `packages/docs/public/` so it keeps its URL.

The published `packages/lib/README.md` ships inside the npm tarball for `0.1.0` and `0.1.1` and cannot be changed retroactively. Nine URLs under `https://jimka.github.io/typescript-ui/` are frozen in it, and roughly two hundred more are emitted into the hosted `llms.txt`. Every one of them is a **path** URL, and every one must keep resolving. That constraint is what decides the routing mode.[^frozen-urls]

---

## Architecture Decisions

### The site moves to History routing — hash URLs cannot serve the frozen links

The library `Router` gains a History mode, and the docs app uses it. A frozen URL such as `https://jimka.github.io/typescript-ui/guide/installation` then resolves to that exact page with no rewriting, because the app reads `location.pathname` directly.[^why-history]

Hash routing was Phase 1's choice and is kept as the `Router` default, so nothing else that uses the router changes.

### `Router` owns the mode and the base; the app owns neither

`RouterOptions` gains `mode` (`"hash"` by default) and `base` (`"/"` by default, used only in History mode). Two methods become the only place URL shape is known: `getHref(path)` turns a route path into the href an `<a>` should carry, and `getPath(href?)` turns a URL back into a route path.[^router-owns-url]

The docs app passes `import.meta.env.BASE_URL` as the base, so the dev server and the deployed site agree without a second constant.[^base-url]

### `navigate` must apply the route itself in History mode — and must no-op on an unchanged path

`history.pushState` fires no event, so History-mode `navigate` calls the route handler itself after writing the URL. Before doing either, it compares the target path with the current one and returns early when they are equal.[^navigate-guard]

The early return is not an optimization. `DocsSidebar.select` calls `navigate` from inside the `Tree` selection listener that `navigate` itself triggers; in hash mode the browser breaks that cycle by firing no `hashchange` on a same-value write. History mode has no such brake, so without the guard the second `navigate` re-enters the handler and recurses without end.

### The DOM seam grows three methods, mirroring the hash three

`DOMSource.getLocationPathname()`, `DOMSink.pushHistoryPath(url)`, and `DOMSink.replaceHistoryPath(url)` are added next to the existing `getLocationHash` / `setLocationHash` / `replaceLocationHash` ([`DOM.ts:622`](packages/lib/src/typescript/lib/core/DOM.ts#L622), [`:1069`](packages/lib/src/typescript/lib/core/DOM.ts#L1069)). The offline test harness models them the same way it already models the hash, so History mode is unit-testable with no browser.[^seam-precedent]

### The SPA fallback is a `404.html` copy of `index.html`, written by a Vite plugin

GitHub Pages serves the site's own `404.html` for any path with no file behind it. Shipping a byte copy of `index.html` under that name makes every unknown path boot the app, which then reads the path and renders the right page.[^spa-fallback]

A small `spaFallback()` plugin in [`packages/docs/vite.config.ts`](packages/docs/vite.config.ts) writes the copy at the end of the build, mirroring where the existing `typedocSummary()` plugin lives. A workflow-level `cp` was rejected: the plugin also gives `vite preview` the fallback, which is what the review gate exercises.

### `llms.txt` keeps its URL by moving its output directory, not its link scheme

[`generate.mjs:36`](packages/lib/scripts/llms/generate.mjs#L36) writes the hosted variant to `docs/public/llms.txt` (relative to `packages/lib`), which VitePress publishes at the site root. `SITE_OUT` changes to `../docs/public/llms.txt`, which resolves to `packages/docs/public/llms.txt` — Vite's public directory, copied verbatim to the root of `packages/docs/dist`.

`SITE_BASE` and the link builder [`linkFor`](packages/lib/scripts/llms/generate.mjs#L207) are **not** touched. Every URL the manifest emits stays byte-identical, which is only true because the site keeps path URLs.[^llms-tradeoff]

### VitePress is deleted, TypeDoc's configuration is not

[`packages/lib/docs/.vitepress/config.mts`](packages/lib/docs/.vitepress/config.mts) is the whole VitePress installation — one file. It is deleted, along with the `vitepress` devDependency and the `docs:dev` / `docs:build` / `docs:preview` scripts.

[`packages/lib/typedoc.json`](packages/lib/typedoc.json) and both TypeDoc plugins stay exactly as they are. `typedoc-vitepress-theme` declares no dependency on `vitepress`, so removing the site does not disturb `docs:api`.[^typedoc-untouched]

The authored Markdown under `packages/lib/docs/` is untouched — the app reads those files directly, as it has since Phase 1.

### The user reviews the app in a browser before the workflow changes

Step 15 is a stop. Nothing that alters the deployment is done until the user has seen the app at its production base in a browser and said to continue.[^review-gate]

---

## Public API

### `packages/lib/src/typescript/lib/router/Router.ts`

```typescript
/** Where a {@link Router} reads and writes the route: the URL hash, or the path. */
export type RouterMode = "hash" | "history";

export interface RouterOptions {
    /** Defaults to `"hash"`. */
    mode?:   RouterMode;
    /** Path prefix the site is served under, e.g. `"/typescript-ui/"`. History mode only; defaults to `"/"`. */
    base?:   string;
    routes?: Record<string, RouteHandler>;
    listeners?: Partial<{
        navigate: (match: RouteMatch) => void;
        nomatch:  (path: string) => void;
    }>;
}

class Router {
    /** The href an `<a>` for `path` should carry, in this router's mode and base. */
    getHref(path: string): string;

    /** The route path for `href`, or — with no argument — for the current URL. */
    getPath(href?: string): string;
}
```

Backing state: private readonly `_mode` and `_base`, assigned in `applyOptions`. Neither gets a setter — both are construction-only, like the compiled route table.[^no-setters]

### `packages/lib/src/typescript/lib/router/RoutePattern.ts` (internal to `router/`, not exported from the barrel)

```typescript
/** Normalizes a base to leading-and-trailing-slash form: `""`, `"/"`, `"x"` all become `"/"`, `"/x"`. */
export function normalizeBase(base: string): string;

/** Removes `base` from the front of a URL path, then normalizes what is left. */
export function stripBase(base: string, pathname: string): string;

/** Joins a normalized base and a normalized path into a URL path. */
export function joinBase(base: string, path: string): string;
```

### `packages/lib/src/typescript/lib/core/DOM.ts`

```typescript
interface DOMSource {
    /** The current `location.pathname`, boxed so the raw global never escapes the seam. */
    getLocationPathname(): string;
}

interface DOMSink {
    /** `history.pushState` with `url`, pushing a history entry. Fires no event. */
    pushHistoryPath(url: string): void;

    /** `history.replaceState` with `url`, replacing the current history entry. Fires no event. */
    replaceHistoryPath(url: string): void;
}
```

### `packages/docs/src/content/links.ts`

```typescript
/**
 * Maps an authored doc href to its rendered form: a route ("/…") goes through
 * `router.getHref` with any fragment stripped, an in-page reference ("#…")
 * passes through non-external, everything else is external.
 */
export function resolveDocLink(href: string, router: Router): MarkdownLinkResolution;
```

`hashHref` is deleted.[^hashhref-deleted]

---

## Internal Structure

### Base handling

`normalizeBase` gives every base a leading and a trailing slash, so `stripBase` and `joinBase` can both assume that shape.

| `base` | `normalizeBase(base)` |
|---|---|
| `"/typescript-ui/"` | `/typescript-ui/` |
| `"/typescript-ui"` | `/typescript-ui/` |
| `"typescript-ui"` | `/typescript-ui/` |
| `"/"` | `/` |
| `""` | `/` |

`stripBase` removes the prefix and normalizes the remainder through the existing `normalizePath`. A path that does not start with the base is normalized as-is rather than rejected.

| `base` | `pathname` | `stripBase` |
|---|---|---|
| `/typescript-ui/` | `/typescript-ui/` | `/` |
| `/typescript-ui/` | `/typescript-ui` | `/` |
| `/typescript-ui/` | `/typescript-ui/guide/installation` | `/guide/installation` |
| `/typescript-ui/` | `/typescript-ui/components/` | `/components` |
| `/typescript-ui/` | `/elsewhere` | `/elsewhere` |
| `/` | `/guide` | `/guide` |

`joinBase` is the inverse: the normalized base minus its trailing slash, then the normalized path.

| `base` | `path` | `joinBase` |
|---|---|---|
| `/typescript-ui/` | `/guide/installation` | `/typescript-ui/guide/installation` |
| `/typescript-ui/` | `/` | `/typescript-ui/` |
| `/` | `/guide` | `/guide` |

`joinBase(base, "/")` must yield the base **with** its trailing slash, so the site root href is `/typescript-ui/` and not `/typescript-ui`.

### `getHref` and `getPath`

`getHref` runs its input through the same `normalizePath` → `splitPath` → `encodeURIComponent` chain `navigate` uses today ([`Router.ts:150`](packages/lib/src/typescript/lib/router/Router.ts#L150)), then formats it for the mode. `getPath(href)` is its inverse; `getPath()` with no argument reads the current URL through the seam.

| mode | base | `getHref("/guide/installation")` | `getPath` of that href |
|---|---|---|---|
| `hash` | — | `#/guide/installation` | `/guide/installation` |
| `history` | `/typescript-ui/` | `/typescript-ui/guide/installation` | `/guide/installation` |
| `history` | `/` | `/guide/installation` | `/guide/installation` |
| `hash` | — | `getHref("/guide/")` → `#/guide` | `/guide` |
| `history` | `/typescript-ui/` | `getHref("/a b")` → `/typescript-ui/a%20b` | `/a b` |

`getPath()` with no argument reads `DOM.source.getLocationHash()` in hash mode and `DOM.source.getLocationPathname()` in History mode, then normalizes — through `stripBase` in History mode. A percent-encoded segment is decoded on the way back, so `getHref` and `getPath` round-trip.

### `navigate` in History mode

```typescript
// History mode only. Hash mode keeps today's body unchanged.
const target = normalizePath(path);

if (target === this.getPath()) {
    return this;                       // same-value write: no history entry, no handler
}

const url = this.getHref(target);

if (options?.replace === true) {
    DOM.sink.replaceHistoryPath(url);
} else {
    DOM.sink.pushHistoryPath(url);
}

this.applyCurrentRoute();              // pushState fires no event; apply it ourselves
```

`start()` installs a `popstate` listener instead of `hashchange` in History mode, and `stop()` removes the same one. Both listener registrations go through `DOM.sink.addListener(DOM.source.getWindow(), …)`, as the hash listener already does ([`Router.ts:116`](packages/lib/src/typescript/lib/router/Router.ts#L116)).

### Link click interception in `DocsContent`

[`DocsContent.ts:93`](packages/docs/src/shell/DocsContent.ts#L93) branches today on an href starting with `#/`. Under History mode a route href is a path, so the branch keys on the router instead.

| clicked `<a href>` | action |
|---|---|
| `/typescript-ui/guide/installation` | `preventDefault`; `router.navigate(router.getPath(href))` |
| `/typescript-ui/` | `preventDefault`; `router.navigate("/")` |
| `#custom-themes` | `preventDefault`; scroll the pane to the heading with that id |
| `https://example.com` | left to the browser (opens in a new tab) |
| any of the above with Ctrl, Cmd, Shift or Alt held, or a non-primary button | left to the browser |

An href counts as a route when it starts with the router's base — `href === base` or `href.startsWith(base)`, using `import.meta.env.BASE_URL`. The modifier-key check is new and comes first: a route href is now a real URL, so Ctrl-click must be allowed to open it in a new tab.[^modifier-keys]

### Deployment pipeline after the cutover

```
npm run build:pages
  = build:lib          →  packages/lib/dist/lib
  → docs:api           →  packages/lib/docs/api/  (TypeDoc model + markdown)
  → docs:llms          →  packages/lib/llms.txt + packages/docs/public/llms.txt
  → build:docs         →  packages/docs/dist/  (index.html, 404.html, llms.txt, assets)
```

The workflow uploads `packages/docs/dist` as the Pages artifact. VitePress no longer runs.

### Where each frozen URL lands

| Frozen URL (path under `https://jimka.github.io/typescript-ui/`) | Served by | Resolves because |
|---|---|---|
| `llms.txt` | real file in `dist/` | `docs:llms` writes it into `packages/docs/public/` |
| `` (site root) | `dist/index.html`, HTTP 200 | path `/` — the app's default route |
| `guide/installation` | `404.html` → app | route `/guide/installation` |
| `guide/mental-model` | `404.html` → app | route `/guide/mental-model` |
| `components/` | `404.html` → app | trailing slash normalizes to `/components` |
| `layouts/` | `404.html` → app | normalizes to `/layouts` |
| `data/` | `404.html` → app | normalizes to `/data` |
| `concepts/theming` | `404.html` → app | route `/concepts/theming` |
| `api/` | `404.html` → app | normalizes to `/api` |

The six section and page routes come from `docs-content-migration`; `/api` comes from `docs-typedoc-reference`. Step 1 checks all of them before anything else is done.[^frozen-status]

---

## Ordered Implementation Steps

### Preconditions

1. **Confirm both prerequisite plans have landed.** `plans/implemented/docs-content-migration.md` and `plans/implemented/docs-typedoc-reference.md` must both exist. Then start the dev server (`npm -w packages/docs run dev`) and confirm each of these paths renders a real page, not the not-found view: `/guide/installation`, `/guide/mental-model`, `/components`, `/layouts`, `/data`, `/concepts/theming`, `/api`. A miss here means the cutover would 404 a published README link; stop and report rather than continuing.
2. **Check whether `Router.getHref` already exists** — `grep -n 'getHref' packages/lib/src/typescript/lib/router/Router.ts`. `plans/router-href.md` introduces it in hash-only form. If it is already there, later steps extend it rather than adding it; if it is not, they add it in the mode-aware form given in `## Public API`. Either way the end state is the same.

### Library: History mode

3. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `getLocationPathname()` to the `DOMSource` interface (beside `getLocationHash` at line 1069) and to `ProductionDOMSource` (beside line 1930): `return location.pathname;`. Add `pushHistoryPath(url)` and `replaceHistoryPath(url)` to the `DOMSink` interface (beside `replaceLocationHash` at line 630) and to `ProductionDOMSink` (beside line 1519): `history.pushState(null, "", url)` and `history.replaceState(null, "", url)`. Document on both sink methods that they fire no event.
4. **`packages/lib/tests/dom/TestDOM.ts`** — add `_locationPathname` (initial `'/'`) plus `locationPathname()` / `setLocationPathname()` to `TestHandleTable`, next to the hash pair at line 272. Add `pushHistoryPath` / `replaceHistoryPath` to `RecordingDOMSink` next to `setLocationHash` (line 463): each records under its own op name and writes the modelled pathname, and — unlike the hash pair — dispatches **nothing**. Add `getLocationPathname()` to `ModelledDOMSource` next to line 954.
5. **`packages/lib/src/typescript/lib/router/RoutePattern.ts`** — add `normalizeBase`, `stripBase`, and `joinBase` per `## Public API`, built on the existing `normalizePath` / `splitPath`. Keep them unexported from the barrel; the file docblock already states that rule.
6. **`packages/lib/src/typescript/lib/router/Router.ts`** —
   - Add `RouterMode`, `RouterOptions.mode`, `RouterOptions.base`; store `_mode` (default `"hash"`) and `_base` (default `"/"`, run through `normalizeBase`) in `applyOptions`, before the `routes` loop so a route registered from the bag sees them set.
   - Add or extend `getHref(path)` per *`getHref` and `getPath`*.
   - Widen `getPath()` to `getPath(href?: string)`.
   - Rewrite `navigate` so the hash branch keeps today's body and the History branch is the block in *`navigate` in History mode*.
   - Make `start()` / `stop()` register and remove `popstate` in History mode, `hashchange` in hash mode. Keep one stable bound reference per listener so add and remove pair up.
   - Update the class docblock: it says "Maps the URL hash to a single top-level app section" — it now maps the URL hash **or path**.
   - Check: `npm -w packages/lib run test -- router` — the whole existing suite stays green untouched, because `mode` defaults to `"hash"`.
7. **`packages/lib/tests/unit/router/RoutePattern.test.ts`** — add the `normalizeBase` / `stripBase` / `joinBase` rows from *Base handling* as cases.
8. **`packages/lib/tests/unit/router/Router.test.ts`** — add a History-mode describe block covering the *Library — unit-testable* list in `## Expected Behaviour`. Drive back-navigation with `DOM.sink.pushHistoryPath(url)` followed by `DOM.sink.dispatchCustomEvent(DOM.source.getWindow(), 'popstate')`.
   - Check: `npm -w packages/lib run typecheck && npm -w packages/lib run test` — green.
9. **`packages/lib/docs/concepts/routing.md`** — rewrite the "Why hash mode" section (line 5) into a mode section: hash stays the default and needs no server rewrite; History mode needs the host to serve the app for unknown paths, and on GitHub Pages that means a `404.html` copy of `index.html`. Document `mode`, `base`, `getHref`, and `getPath(href?)`, and state plainly that `pushState` fires no event so `navigate` applies the route itself.

### Docs app: base, hrefs, fallback

10. **`packages/docs/vite.config.ts`** — change `base` (line 32) to `'/typescript-ui/'`. Add a `spaFallback()` plugin whose `closeBundle` copies `dist/index.html` to `dist/404.html`, with a comment naming the GitHub Pages behaviour it exists for. Leave the `keepNames` minify guard and `typedocSummary()` untouched.
11. **`packages/docs/src/main.ts`** — construct the router as `new Router({ mode: 'history', base: import.meta.env.BASE_URL })`. Everything else in the file — the two patterns, `Body.init`, the trailing `router.start()` — stays exactly as it is.
12. **`packages/docs/src/content/links.ts`** — delete `hashHref`; give `resolveDocLink` a second parameter `router: Router` and make its route branch `router.getHref(href.split('#')[0])`. The in-page and external branches are unchanged.
13. **`packages/docs/src/shell/DocsContent.ts`** — rewrite `onLinkClick` (line 76) per *Link click interception in `DocsContent`*: modifier/button check first, then in-page `#…`, then base-prefixed route, then fall through to the browser. Pass the router into `resolveDocLink` at the `Markdown` construction on line 48.
14. **`packages/docs/tests/links.test.ts`** — rewrite against `resolveDocLink(href, router)` with a real `Router` built as `new Router({ mode: 'history', base: '/typescript-ui/' })`, covering the *Docs app — unit-testable* list. Delete the `hashHref` describe block and the "does not strip the trailing slash" case, which no longer holds: `getHref` normalizes `/guide/` to `/typescript-ui/guide`.
    - Check: `npm -w packages/docs run typecheck && npm -w packages/docs run test` — green.
    - Check: `grep -rn 'hashHref' packages/docs/` — expect zero matches.

### Review gate

15. **STOP — the user reviews the app in a browser before anything about the deployment changes.** Run both, and hand the user the URLs:
    - `npm -w packages/docs run dev` → `http://localhost:5173/typescript-ui/` — clicking through pages, the sidebar, in-page anchors, external links, and the browser back button.
    - `npm run docs:llms && npm -w packages/docs run build && npm -w packages/docs run preview` → the production base with the real `404.html` and the real `llms.txt` in place. Confirm `packages/docs/dist/404.html` and `packages/docs/dist/llms.txt` both exist, and that a deep link typed straight into the address bar (`/typescript-ui/concepts/theming`) renders that page.

    Do not proceed to step 16 until the user says to continue. If the user asks for presentation changes, make them and re-run this gate.

### Re-home `llms.txt` and cut the deployment over

16. **`packages/lib/scripts/llms/generate.mjs`** — change `SITE_OUT` (line 36) to `"../docs/public/llms.txt"` and update its JSDoc comment: the file is published by the docs app's public directory, not by VitePress. Update the same claim in the module docblock (lines 11-14) and the `SITE_BASE` comment (line 41), which names VitePress's `base` + `cleanUrls`. Leave `SITE_BASE`'s value and `linkFor` alone.
    - Check: `npm -w packages/lib run docs:llms && ls packages/docs/public/llms.txt` — the file exists, and `grep -c 'jimka.github.io' packages/docs/public/llms.txt` is unchanged from the count before the edit.
17. **`.gitignore`** — repoint line 16 from `packages/lib/docs/public/llms.txt` to `packages/docs/public/llms.txt`. Drop lines 13-14 (`packages/lib/docs/.vitepress/dist`, `.../cache`), which no longer name anything that can exist.
18. **`package.json` (root)** — add `docs:llms` into `build:pages` (line 17) so it reads `npm run build:lib && npm run docs:api && npm run docs:llms && npm run build:docs`. Delete the `docs:build` script (line 15). Add `"docs:dev": "npm -w packages/docs run dev"`.
19. **`packages/lib/package.json`** — delete the `docs:dev`, `docs:build`, and `docs:preview` scripts (lines 138-140) and the `vitepress` devDependency (line 174). Leave `typedoc`, `typedoc-plugin-markdown`, and `typedoc-vitepress-theme`.
    - Check: `npm install` then `npm run docs:api` — TypeDoc still succeeds with `vitepress` gone.
20. **Delete `packages/lib/docs/.vitepress/config.mts`** — the directory's only file, so the directory goes with it.
    - Check: `grep -rn "vitepress" --include="*.json" --include="*.yml" . | grep -v node_modules | grep -v package-lock` — only `packages/lib/typedoc.json`'s plugin entry remains.
21. **`.github/workflows/docs.yml`** — replace the build job's run steps with: `npm ci`; `npm -w packages/docs run typecheck`; `npm -w packages/docs run test`; `npm run build:pages` carrying `NODE_OPTIONS: --max-old-space-size=12288`; then `configure-pages` and `upload-pages-artifact` with `path: packages/docs/dist`. Delete the `cp … dist/next` step (line 55) and the separate `docs:build` / `build:docs` steps. Rewrite the two comment blocks (lines 27-40 and 47-51): the docs app is now the site, the `/next/` preview is gone, VitePress no longer runs, and the heap pin exists for TypeDoc's ~105 MB model.
    - Check: `grep -n 'vitepress\|next' .github/workflows/docs.yml` — expect zero matches.

### Documentation and manifest follow-through

22. **`packages/lib/scripts/llms/manifest.data.mjs`** — line 125's task text reads "Map the URL hash to a top-level app section"; change it to "Map the URL to a top-level app section".
23. **Regenerate and commit the manifest** — `npm run docs:api && npm -w packages/lib run docs:llms`, then commit the updated `packages/lib/llms.txt`. Its `Router` row picks up both the new task text and the reworded class docblock from step 6.
24. **`README.md` (root)** — line 16 tells a contributor to run `npm -w packages/lib run docs:dev`; change it to `npm run docs:dev`. In the script table, replace the two rows at lines 110-111 with one: `npm run docs:dev` — "Serve the documentation app locally" — plus a `npm run build:pages` row for the full site build. The `https://jimka.github.io/…` links at lines 9 and 21-27 are **not** touched; they are the URLs this plan preserves.
25. **`CODE_CONVENTIONS.md`** — lines 19 and 23 tell the reader to run `npm run docs:build` for the zero-warning TypeDoc check. That script is gone; the check is TypeDoc's, so both become `npm run docs:api`.
26. **`packages/lib/docs/guide/installation.md`** — the script table at lines 93-94 lists `npm run docs:dev` / `npm run docs:build`. Update to `npm run docs:dev` ("Serve the documentation app locally") and `npm run build:pages` ("Build the full documentation site"). This is authored content the app renders, so re-check the page in the browser afterwards.

### Final verification

27. Run everything in `## Verification`. After the branch merges to `master` and Pages redeploys, walk the live check — `curl -I` every row of *Where each frozen URL lands*, and open two of them in a browser to confirm the app renders the right page. If any fails, revert the merge: VitePress comes back with it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/router/RoutePattern.ts` |
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/unit/router/RoutePattern.test.ts` |
| Modify | `packages/lib/tests/unit/router/Router.test.ts` |
| Modify | `packages/lib/docs/concepts/routing.md` |
| Modify | `packages/lib/docs/guide/installation.md` |
| Modify | `packages/lib/scripts/llms/generate.mjs` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated) |
| Modify | `packages/lib/package.json` |
| Modify | `packages/docs/vite.config.ts` |
| Modify | `packages/docs/src/main.ts` |
| Modify | `packages/docs/src/content/links.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/tests/links.test.ts` |
| Modify | `.github/workflows/docs.yml` |
| Modify | `.gitignore` |
| Modify | `package.json` |
| Modify | `package-lock.json` (regenerated by `npm install`) |
| Modify | `README.md` |
| Modify | `CODE_CONVENTIONS.md` |
| Delete | `packages/lib/docs/.vitepress/config.mts` |

`packages/lib/README.md` is deliberately absent: its URLs are the thing being preserved, and every one of them still resolves.

---

## Expected Behaviour

### Library — unit-testable in `RoutePattern.test.ts`

- `normalizeBase`, `stripBase`, and `joinBase` produce every row of the three tables in *Base handling*.
- `joinBase(base, "/")` keeps the base's trailing slash: `joinBase("/typescript-ui/", "/")` is `/typescript-ui/`.

### Library — unit-testable in `Router.test.ts`

- A router constructed with no `mode` behaves exactly as today: the entire existing suite passes unchanged.
- In History mode with base `/typescript-ui/`, `getPath()` returns `/guide` when the modelled pathname is `/typescript-ui/guide`, `/` when it is `/typescript-ui/`, and `/` when it is `/typescript-ui`.
- In History mode, `getHref("/guide/installation")` returns `/typescript-ui/guide/installation`; in hash mode it returns `#/guide/installation`.
- `getPath(getHref(p))` returns the normalized `p` for `/guide`, `/guide/`, `/a b`, and `/`, in both modes.
- In History mode, `navigate("/settings")` records one `pushHistoryPath` write of `/typescript-ui/settings` and calls the matching handler once.
- In History mode, `navigate("/settings", { replace: true })` records `replaceHistoryPath`, not `pushHistoryPath`.
- In History mode, `navigate` to the path already current records **no** write and calls **no** handler. Assert the handler call count is unchanged — this is the guard that stops the sidebar recursion.
- In History mode, a `popstate` dispatched at the window handle after the modelled pathname changes calls the newly matching handler and emits `"navigate"`.
- In History mode, `start()` registers a `popstate` listener and no `hashchange` listener; `stop()` removes it. In hash mode the reverse holds.
- In History mode with base `/`, `getHref("/guide")` is `/guide` and `getPath()` reads the pathname unchanged.

### Docs app — unit-testable in `links.test.ts`

Fixture router: `new Router({ mode: 'history', base: '/typescript-ui/' })`.

- `resolveDocLink('/concepts/sizing', router)` returns `{ href: '/typescript-ui/concepts/sizing', external: false }`.
- `resolveDocLink('/guide/', router)` returns `{ href: '/typescript-ui/guide', external: false }` — the trailing slash is normalized away, which is a change from Phase 1.
- `resolveDocLink('/guide/mental-model#jsx-shaped-without-jsx', router)` returns `{ href: '/typescript-ui/guide/mental-model', external: false }`.
- `resolveDocLink('#custom-themes', router)` returns `{ href: '#custom-themes', external: false }` — unchanged, and not base-prefixed.
- `resolveDocLink('https://example.com', router)` and `resolveDocLink('mailto:x@example.com', router)` pass through unchanged with `external: true`.

### Build output — checkable without a browser

- `packages/docs/dist/404.html` exists and is byte-identical to `packages/docs/dist/index.html`.
- `packages/docs/dist/llms.txt` exists and its `jimka.github.io` link count matches `packages/lib/llms.txt`'s row count.
- `packages/docs/dist/index.html` references `/typescript-ui/assets/…`, with no `/next/` anywhere in `dist/`.

### Manual verification (browser required)

- On the dev server at `/typescript-ui/`, the app renders the default page and the address bar shows a **path**, never a `#`.
- Clicking a sidebar entry changes the path, swaps the content, and adds one history entry. Clicking the same entry again changes nothing and adds no entry.
- The browser back and forward buttons move between pages and the sidebar selection follows.
- Typing `/typescript-ui/concepts/theming` straight into the address bar of the `vite preview` server renders that page.
- An in-page `#anchor` link scrolls the content pane and leaves the path unchanged.
- Ctrl-click (Cmd-click on macOS) on a sidebar or in-content route link opens that page in a new tab instead of navigating in place.
- An external `https://` link still opens in a new tab.
- After deployment: every row of *Where each frozen URL lands* resolves, and `https://jimka.github.io/typescript-ui/llms.txt` returns the manifest with HTTP 200.

---

## Verification

```bash
npm -w packages/lib run typecheck
npm -w packages/lib run lint
npm -w packages/lib run test           # router History mode + the whole existing hash suite
npm run build:lib
npm -w packages/docs run typecheck
npm -w packages/docs run test
npm run build:pages                    # build:lib → docs:api → docs:llms → build:docs

# Build-output checks
test -f packages/docs/dist/404.html && diff -q packages/docs/dist/index.html packages/docs/dist/404.html
test -f packages/docs/dist/llms.txt
grep -rn 'next/' packages/docs/dist/index.html          # expect zero matches
grep -rn 'hashHref' packages/docs/                      # expect zero matches
grep -rn 'vitepress' --include='*.json' --include='*.yml' . | grep -v node_modules | grep -v package-lock
                                                        # expect only typedoc.json's plugin entry

# TypeDoc must still finish clean with vitepress uninstalled
npm run docs:api                                        # zero warnings
```

Then `npm -w packages/docs run preview` and walk the *Manual verification* list. `npm run docs:api` is the zero-warning JSDoc gate that `npm run docs:build` used to be — `CODE_CONVENTIONS.md` is updated to say so in step 25.

---

## Documentation Impact

`Router` is exported from `@jimka/typescript-ui/router` via [`packages/lib/src/typescript/lib/router/index.ts`](packages/lib/src/typescript/lib/router/index.ts); `RouterMode` rides that same barrel export alongside `RouterEvent` and `RouteMatch`, so no new subpath or barrel entry is needed. `RoutePattern.ts`'s three new functions stay internal to `router/` and are not exported.

[`packages/lib/docs/concepts/routing.md`](packages/lib/docs/concepts/routing.md) is the consumer-facing page and is rewritten in step 9 — its "Why hash mode" section currently ends with "There is no `pushState` mode", which becomes false.

The capability manifest changes in two places: `manifest.data.mjs`'s `Router` task text, and the summary the generator derives from `Router`'s class docblock. Both flow into `packages/lib/llms.txt` on regeneration (step 23), and the committed copy must be re-committed.

`packages/lib/README.md` is **not** edited. Its links are the constraint this plan is built around.

---

## Potential Challenges

- **`pushState` fires no event.** Forgetting the explicit `applyCurrentRoute()` in History-mode `navigate` produces a URL that changes while the page does not. Pinned by the "records one `pushHistoryPath` and calls the handler once" case.
- **Unbounded recursion through the sidebar.** `DocsSidebar.select` calls `navigate` from inside the selection listener `navigate` triggers. Hash mode is saved by the browser's same-value no-op; History mode is saved only by the early return in `navigate`. That case is in `## Expected Behaviour` for exactly this reason.
- **Deep links return HTTP 404.** GitHub Pages serves `404.html` with the 404 status even though the app renders correctly. Browsers do not care; `curl -I` and link checkers do. Accepted, and it is what the site already does for unknown paths today.
- **`llms.txt` missing from the build.** `vite build` copies `packages/docs/public/` only if it exists, and it is created by `docs:llms`. Running `build:docs` without `docs:llms` first silently drops the file — which is why step 18 puts `docs:llms` inside `build:pages` and the review gate runs it explicitly.
- **Memory.** The VitePress build was the ~5 GB step that has been OOM-killed on this machine; it is gone. `docs:api` still emits a ~105 MB TypeDoc model, so the heap pin stays on the one remaining build step.
- **Ordering of the `.vitepress` deletion.** Deleting the config before the workflow stops calling `docs:build` breaks the deploy. The deletion (step 20) and the workflow rewrite (step 21) therefore ship in one branch, and no intermediate commit is deployable on its own — merge the branch whole, never cherry-pick part of it.
- **`import.meta.env.BASE_URL` under vitest.** It is `/` in tests, so `links.test.ts` must build its fixture router with an explicit base rather than reading the env var, or the expected hrefs will not match.

---

## Critical Files

- [`plans/implemented/packages-docs.md`](plans/implemented/packages-docs.md) — Phase 1. Its `## Non-Goals` names this work; its `[^pages-404]` footnote is the measured evidence that GitHub Pages serves the site's own `404.html`.
- [`packages/lib/src/typescript/lib/router/Router.ts`](packages/lib/src/typescript/lib/router/Router.ts) — `navigate` (149), `getPath` (167), `start` (107), `stop` (127), `applyOptions` (240).
- [`packages/lib/src/typescript/lib/router/RoutePattern.ts`](packages/lib/src/typescript/lib/router/RoutePattern.ts) — `normalizePath` (35) and `splitPath` (54), which the three new base helpers build on, and the docblock stating the file is internal to `router/`.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the hash trio at 622/630/1069 and their implementations at 1514/1519/1930: the shape the three new methods copy.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — the modelled hash state (272) and `RecordingDOMSink.setLocationHash` (463), which show how modelled location state and its event dispatch are wired.
- [`packages/lib/tests/unit/router/Router.test.ts`](packages/lib/tests/unit/router/Router.test.ts) — the `installTestDOM` harness shape every new History-mode case reuses.
- [`packages/lib/scripts/llms/generate.mjs`](packages/lib/scripts/llms/generate.mjs) — `SITE_OUT` (36), `SITE_BASE` (42), `linkFor` (207). Read `linkFor` to confirm this plan changes no emitted URL.
- [`packages/docs/vite.config.ts`](packages/docs/vite.config.ts) — `base` (32), the `typedocSummary()` plugin the new plugin sits beside, and the `keepNames` minify guard that must not be disturbed.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `onLinkClick` (76), the `linkResolver` wiring (48), and the in-page scroll helper the handler calls.
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — `select` (61) and the selection listener (92): the loop the `navigate` guard has to stop.
- [`.github/workflows/docs.yml`](.github/workflows/docs.yml) — the whole build job.
- [`plans/router-href.md`](plans/router-href.md) — if unimplemented, its `getHref` naming and normalization table are the design this plan adopts; if implemented, it is the method being extended.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — DOM access only through the seam, named listener methods, JSDoc on every public method.

---

## Non-Goals

- **A designed landing page.** `https://jimka.github.io/typescript-ui/` resolves to the app's existing default route, which is what the frozen README link needs. A hero page replacing VitePress's `layout: home` is separate work.
- **Redirects from `/typescript-ui/next/`.** The preview URL was never published anywhere; it simply stops existing.
- **Changing what `llms.txt` says or links to.** Only its output directory moves.
- **`typedoc.json`, `typedoc-plugin-markdown`, and `typedoc-vitepress-theme`.** How the API reference is generated and rendered belongs to `docs-typedoc-reference`.
- **Content, navigation, and page coverage.** Owned by `docs-content-migration`. This plan assumes its routes exist and checks for them in step 1.
- **Search.** VitePress's local full-text index disappears with VitePress. Replacing it needs both an index build step and a UI.
- **A `mode` setter on `Router`.** Both `mode` and `base` are construction-only.
- **Serving deep links with an HTTP 200.** That needs a host with rewrite rules, not GitHub Pages.

---

## Notes

[^frozen-urls]: Enumerated from [`packages/lib/README.md`](packages/lib/README.md): line 9 links `https://jimka.github.io/typescript-ui/llms.txt`; line 11 links the site root; lines 15-21 link `guide/installation`, `guide/mental-model`, `components/`, `layouts/`, `data/`, `concepts/theming`, and `api/`. The root [`README.md`](README.md) carries the same nine at lines 9 and 21-27, but it is not published to npm, so only the `packages/lib` copy is frozen. On top of those, the hosted `llms.txt` emits one `SITE_BASE`-prefixed URL per catalog row plus the section roots — around two hundred links of the form `https://jimka.github.io/typescript-ui/components/Button`. Those are regenerated on every deploy, so their *shape* is not frozen the way the README is; keeping it constant is nevertheless free under this plan and would not be under hash routing.

[^why-history]: Hash routing at the site root cannot serve a path URL. `https://jimka.github.io/typescript-ui/guide/installation` has no file behind it, so Pages serves `404.html`; the app boots with an empty hash and shows the default page. The reader asked for the installation guide and got the front page — a silent wrong answer, worse than a 404. The alternative considered was a redirect shim in `404.html` that rewrites `location` to `/typescript-ui/#/guide/installation` (the widely used `spa-github-pages` trick). It works, and it needs no library change. It was rejected on three counts: every published link then bounces through a visible URL rewrite and lands on a URL that does not match the one the reader followed; `llms.txt` would have to start emitting `#/`-shaped URLs, changing roughly two hundred links and the `linkFor` builder; and the docs app exists to dogfood the library, so shipping a workaround in the app instead of the capability in the library is the opposite of its purpose. History mode costs one options field, two seam-backed methods, and three pure helpers — all of it unit-testable offline through the existing modelled DOM harness.

[^router-owns-url]: Phase 1 already drew this line: [`packages-docs.md`](plans/implemented/packages-docs.md) decided "the app owns no other part of the URL encoding — reading and writing the hash belong to `Router`", leaving the app one line, `hashHref`. Under History mode that one line becomes base-joining plus percent-encoding, which must agree exactly with what `getPath` will parse back. Duplicating it in the app is how the two drift. `plans/router-href.md` reaches the same conclusion independently for the hash-only case and even names this plan's need: "One method then knows the encoding, so a future History mode changes one place."

[^base-url]: Vite sets `import.meta.env.BASE_URL` from the `base` config field and serves the dev server under it too, so `http://localhost:5173/typescript-ui/` and the deployed site produce identical hrefs from identical code. Hardcoding `/typescript-ui/` in the app would give the dev server a base the router disagrees with.

[^navigate-guard]: `history.pushState` and `replaceState` deliberately do not fire `popstate` — only user-driven history traversal does. Hash mode gets its handler call for free from `hashchange`, which is why today's `navigate` ends after writing the hash. The early return preserves the contract the hash implementation gets from the browser and that [`hash-router`](plans/implemented/hash-router.md) documented: "Writing the path already in the hash is a same-value write: it fires no `hashchange` and re-runs no handler." Keeping that sentence true in both modes is what lets `DocsSidebar`'s comment — "Freely re-enters `Router.navigate` through the selection listener" — stay correct.

[^seam-precedent]: [`ARCHITECTURE.md`](ARCHITECTURE.md) requires all DOM access to go through `DOM.sink` / `DOM.source`, and the router already obeys it for the hash. The payoff is concrete rather than theoretical: [`RecordingDOMSink.setLocationHash`](packages/lib/tests/dom/TestDOM.ts#L463) models the hash write *and* the conditional `hashchange` dispatch, which is how the existing router suite exercises the full navigation round trip with no browser. Modelling `pathname` the same way makes every History-mode behaviour in `## Expected Behaviour` a plain unit test. The modelled sink dispatches nothing on a history write, which mirrors the browser exactly.

[^spa-fallback]: Measured during Phase 1 and recorded in its `[^pages-404]` footnote: a request for a non-existent path under `https://jimka.github.io/typescript-ui/` returns HTTP 404 carrying the *site's own* `404.html`, not GitHub's default page. So a `404.html` that is a copy of `index.html` boots the app for every unknown path. The app's asset URLs are absolute (`/typescript-ui/assets/…`, from `base`), so the same copy works at any URL depth without a `<base>` tag. Phase 1 could not use this because VitePress owned the root `404.html`; retiring VitePress frees the slot.

[^llms-tradeoff]: This is the second half of the routing decision. `linkFor` builds every hosted link as `SITE_BASE + path` — `https://jimka.github.io/typescript-ui/components/Button` — and [`llms-generate.test.ts:162`](packages/lib/tests/unit/llms-generate.test.ts#L162) pins that shape. Under History routing those URLs stay correct with no change to the generator, its tests, or any copy an agent has already fetched. Under hash routing every one of them would have to become `…/#/components/Button`, changing the builder, its tests, and the meaning of every previously fetched copy of the manifest.

[^typedoc-untouched]: Checked rather than assumed: `typedoc-vitepress-theme`'s `package.json` declares one peer dependency, `typedoc-plugin-markdown`, and no dependency on `vitepress`. It writes a `typedoc-sidebar.json` beside the generated Markdown; whether anything still consumes that file is `docs-typedoc-reference`'s question, not this plan's. Step 19's check runs `docs:api` after `vitepress` is uninstalled to confirm the removal empirically.

[^review-gate]: The user asked for this explicitly: they want to see the app's presentation in a browser before it replaces VitePress. Placing the gate after the app changes and before the deployment changes is what makes it real — at that point the app is fully functional at its production base and the live site is still VitePress, so "not yet" costs nothing but the branch staying open.

[^no-setters]: `Router` is a plain class with an options bag rather than a `Component`, so the typed-setter rule in `ARCHITECTURE.md` — which governs DOM attributes and styles — does not reach it. Changing mode or base after `start()` would mean re-reading the URL under new rules and re-dispatching, for a capability nothing needs: an app is served under one base in one mode.

[^hashhref-deleted]: `hashHref` returns `'#' + path`, which is hash-mode-only and unencoded. Under History mode there is nothing left for it to do, and `Router.getHref` covers both modes with the encoding included. `plans/router-href.md` deletes the same function for the same reason, so implementing that plan first or not changes nothing about the end state here.

[^modifier-keys]: Phase 1's handler cancels every route click unconditionally. That was survivable while route hrefs were hash fragments, since a new tab on `…/next/#/guide/x` is an odd thing to want. A base-prefixed path href is an ordinary link, and readers Ctrl-click ordinary links in documentation constantly. The check has to come before the in-page branch too, so a modified click on `#anchor` also falls through to the browser.

[^frozen-status]: The step-1 check is the only place this plan can catch a missing route before it becomes a 404 on a published README link. It is deliberately a manual browser check rather than a grep: whether a path renders depends on the route table *and* the page registry, and only the running app knows both.

---

## Implementation Notes

This run implemented Ordered Implementation Steps 1–14 only (Preconditions
through "Docs app: base, hrefs, fallback") and stopped at the Step 15 review
gate, by design — that step requires a human to look at the running app in a
real browser and say "continue," which this run had no way to do. Steps
16 onward (llms.txt re-home, deployment cutover, VitePress deletion) were not
started.

Three deviations from the plan's literal text, all needed to reach a working
implementation:

- **`Router._mode` / `_base` are not `readonly`.** The plan's `## Public API`
  says "Backing state: private readonly `_mode` and `_base`, assigned in
  `applyOptions`." That combination does not typecheck under this project's
  `strict` config: TypeScript's `strictPropertyInitialization` only permits a
  `readonly` field to be written from the literal constructor body or a field
  initializer, not from a method the constructor merely calls (confirmed with
  a standalone `tsc --strict` repro before touching the real file) —
  `applyOptions` is exactly such a method, and existing `Router` code already
  calls it that way for every other option. The fields are plain private
  fields instead (`private _mode!: RouterMode;`), assigned once in
  `applyOptions` and never reassigned after. The externally-visible contract
  the plan cares about — no public setter, mode/base fixed for the router's
  lifetime — holds exactly as specified; only the internal `readonly` keyword
  is dropped.
- **`resolveApiLink` also gained a `router: Router` parameter.** The plan's
  `## Public API` only specifies the new `resolveDocLink(href, router)`
  signature. But `resolveApiLink` (same file, `links.ts`) calls `hashHref`
  directly for its relative-`.md`-link branch and delegates to
  `resolveDocLink(href)` for its absolute-path branch — both call sites break
  once `hashHref` is deleted and `resolveDocLink` requires a second argument.
  Per the plan's own footnote `[^hashhref-deleted]`, "Under History mode there
  is nothing left for [`hashHref`] to do," so the fix is `resolveApiLink`
  taking `router` and using `router.getHref(...)` / `resolveDocLink(href,
  router)` in its place. `DocsContent.ts`'s `resolveLink` closure passes
  `this._router` to whichever resolver it calls, and `links.test.ts`'s
  existing `resolveApiLink` cases were updated to pass the fixture router and
  expect base-joined hrefs instead of hash hrefs — none of the assertions'
  *shape* changed, only the URL form each one expects.
- **`vite.config.ts`'s `API_URL` dev-middleware regex also changed.** The
  regex hardcoded the old base: `/^(?:\/typescript-ui\/next)?\/api\/(.+\.md)$/`,
  matching a request either bare or prefixed with the Phase-1 preview path.
  Since `docs:api` fetches now go out under the new base
  (`${import.meta.env.BASE_URL}api/...`, per `packages/docs/src/content/
  api.ts`), the regex was updated to `/^(?:\/typescript-ui)?\/api\/(.+\.md)$/`
  so the dev-server middleware that serves generated API Markdown keeps
  matching. Left unmentioned by step 10, but required by the same base change
  step 10 makes.

One environment note, not a plan-file deviation: this worktree has no
`node_modules` of its own (worktrees don't get a fresh `npm install`), so
`npm`/Vite resolve `node_modules` by walking up to the main tree's, whose
`@jimka/typescript-ui` symlink points at the *main tree's* `packages/lib` —
not this worktree's edited copy. A local override symlink,
`packages/docs/node_modules/@jimka/typescript-ui` → `../../../lib`, was
created so `packages/docs`'s typecheck/build/test actually exercise this
branch's library code. It is untracked (`node_modules` is gitignored) and
worktree-local; anyone continuing this work in the same worktree should
either keep it or reproduce it before trusting a docs-app check.

One pre-existing, unrelated test failure was found and left alone:
`packages/docs/tests/api.test.ts`'s `symbolCount() is 683` fails with
"expected 690 to be 683" on a completely clean `master` checkout too (verified
by running `npm run docs:api` and the same test directly against `master`,
before any of this plan's edits existed) — a hardcoded documented-symbol count
that has drifted out of sync with the library's growth, unrelated to routing.
It is not in this plan's `## Files to Create / Modify / Delete` table and was
not touched.

---

This run implemented Ordered Implementation Steps 16–27 (re-homing
`llms.txt`, cutting the deployment over, VitePress removal, and the
manifest/documentation follow-through), completing the plan.

One deviation, needed to reach `npm run docs:api`'s zero-warning requirement
(the step 19 check and the `## Verification` block both run it):

- **`packages/lib/src/typescript/lib/router/index.ts` gains a `RouterMode`
  type export.** The plan's `## Documentation Impact` section states
  "`RouterMode` rides that same barrel export alongside `RouterEvent` and
  `RouteMatch`, so no new subpath or barrel entry is needed" — but `RouterMode`
  was never actually added to the barrel's `export type { … }` list in step 6
  (it only exists as an unexported-from-the-barrel type in `Router.ts`).
  Running `docs:api` after step 16 surfaced this concretely: TypeDoc emitted
  "`RouterMode` … is referenced by `router.RouterOptions.mode` but not
  included in the documentation," which is exactly the class of warning
  `CODE_CONVENTIONS.md`'s `{@link}` rule exists to prevent, applied here to a
  type reference rather than a `{@link}`. Adding `RouterMode` to
  `router/index.ts`'s `export type { … }` list (alongside `RouteParams`,
  `RouteHandler`, `RouterEvent`, `RouteMatch`, `RouterOptions`) resolved it
  with zero other changes — the type's shape and its `## Public API` listing
  were already correct; only its barrel visibility was missing. This also
  shifted `packages/docs/tests/api.test.ts`'s `symbolCount()` baseline
  mismatch by exactly one (690 → 691 documented symbols against the
  hardcoded-683 literal), confirmed by toggling the export off and back on
  and re-running `docs:api`; the mismatch itself remains the pre-existing,
  unrelated baseline recorded above.

Regenerating `packages/lib/llms.txt` (step 23) after this fix and the step 22
task-text edit produced exactly one changed line — the `Router` catalog
row's task text — confirming no other emitted content moved.

The `.worktrees/docs-cutover/packages/docs/node_modules/@jimka/typescript-ui`
override symlink recorded above was blown away by step 19's `npm install`, as
anticipated, and was recreated immediately afterward; every subsequent
docs-app typecheck/build/test in this run ran against the recreated symlink.

Step 20's inline check text ("only `packages/lib/typedoc.json`'s plugin entry
remains") undercounts by one match: `packages/lib/package.json`'s
`typedoc-vitepress-theme` devDependency line also contains the substring
`vitepress` and is matched by the same grep, because step 19 explicitly keeps
that dependency ("Leave `typedoc`, `typedoc-plugin-markdown`, and
`typedoc-vitepress-theme`"). Both matches are the plan's intended end state;
the check's prose just didn't anticipate its own grep matching the kept
dependency's name. No `vitepress` (the actual site generator package) remains
anywhere in the tree outside `node_modules`/`package-lock.json`.

Local build-output verification (the parts of step 27 that don't require a
live deployment): `packages/docs/dist/404.html` is byte-identical to
`packages/docs/dist/index.html`; `packages/docs/dist/llms.txt` exists (88
`jimka.github.io` links, unchanged from a control generation at the old
output path before the step-16 edit); no `next/` or `hashHref` matches
anywhere in `packages/docs/dist/index.html` or `packages/docs/`; `docs:api`
finishes with zero warnings post-`vitepress`-removal. A `vite preview` smoke
check via chrome-devtools confirmed the production build boots at
`/typescript-ui/` and that `/typescript-ui/concepts/theming`, typed directly
into the address bar, renders the Theming page (not the default route) with
no console errors — the same behaviour the step-15 review gate already
confirmed for the pre-cutover build, now re-confirmed against the real
`404.html`/`llms.txt` artifacts step 15's second bullet asked for.

The plan's step 27 live-deployment check — `curl -I` every row of *Where each
frozen URL lands* against `https://jimka.github.io/typescript-ui/` after the
branch merges to `master` and Pages redeploys — could not be run from this
worktree; nothing is deployed yet. It remains a manual step for whoever merges
the branch.
