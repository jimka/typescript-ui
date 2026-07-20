---
depends-on: [markdown-tables, hash-router]
touches-shared:
    - packages/lib/src/typescript/lib/component/display/Markdown.ts
    - packages/lib/tests/component/display/Markdown.test.ts
    - packages/lib/tests/component/markdown-editor.test.ts
    - packages/lib/docs/components/Markdown.md
---

# Dogfooded Docs Site (Phase 1) — Implementation Plan

## Overview

`packages/docs` is meant to become the project's documentation site, built with `@jimka/typescript-ui` itself and consuming it through the package `exports` map. Today it is a 9-line proof-of-seam: [`packages/docs/src/main.ts`](packages/docs/src/main.ts) renders one `Header` carrying two counts read from the TypeDoc model by the `virtual:typedoc-summary` plugin in [`packages/docs/vite.config.ts:14`](packages/docs/vite.config.ts#L14). It has no router, no content, no navigation.

The site it must eventually replace is [`packages/lib/docs/`](packages/lib/docs/), served by VitePress. That replacement is a multi-phase migration, not one plan.[^migration-scale]

This plan is **Phase 1 only**. It adds two viewer-only `Markdown` capabilities, builds the app shell on top of the library's `Router`, renders the 15 real pages of `guide/` + `concepts/` from the existing Markdown **unmodified**, and deploys the result as a **preview at `/typescript-ui/next/` alongside the live VitePress site**. No cutover. Every URL in the published `packages/lib/README.md` keeps resolving because nothing about the current deployment changes.

**This plan is blocked on two prerequisite plans, `markdown-tables` and `hash-router`.** The 15-page content slice cannot render without GFM table support, and table support is not a viewer-only change.[^table-blocking] Navigation is the library `Router` shipped by `hash-router`, reached at `@jimka/typescript-ui/router`; the docs app writes no router of its own.[^router-is-library]

The two library gaps this plan closes, verified against the source:

1. **No heading anchors.** [`appendHeading`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L488) emits no `id`, so `#fragment` deep links cannot work.
2. **Every link opens a new tab.** [`appendLink`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L670) hardcodes `target="_blank"`. The docs contain 2,122 site-internal links; each would open a blank tab pointing at a non-existent path.

---

## Architecture Decisions

### The viewer and the editor share one Markdown dialect — a governing constraint

`Markdown` (the read-only viewer) and `MarkdownEditor` (the Lexical WYSIWYG whose value is a Markdown string) are two halves of one contract: **any syntax feature added to one must be added to the other**. An asymmetry is a data-loss bug — content that renders in the viewer but has no editor transformer is destroyed on an editor load→edit→serialize cycle.[^parity-sources]

A change to the viewer's token switch must therefore land together with the matching change in the transformer array, `EDITOR_NODES`, the editor theme's class rules, and both doc pages.

### Heading `id`s and `linkResolver` are viewer-only — verified, not assumed

Both changes in this plan were checked against the parity contract and neither engages it, because neither alters the Markdown surface syntax.[^viewer-only-check] Phase 1 may therefore ship them while tables stay out.

### Tables are a separate plan, sequenced first

GFM tables become `plans/markdown-tables.md`, covering the viewer and editor halves together, and **must land before this plan starts** — the frontmatter records the dependency.[^table-cost] That plan also owns an open design question about GFM column alignment, so **this plan asserts nothing about alignment** and its `## Expected Behaviour` contains no alignment case.

### Phase 1 ships a preview, not a cutover

VitePress keeps the site root; the new app is copied into `next/` inside the same Pages artifact. The eight published-README URLs under `https://jimka.github.io/typescript-ui/` must keep resolving and cannot be changed retroactively — they are frozen in npm `0.1.0`.[^published-urls]

### Hash routing in Phase 1 — because the root `404.html` slot is taken

Phase 1 uses hash routing (`/typescript-ui/next/#/guide/installation`): it needs no server rewrite and does not contend for the site-root `404.html`, which VitePress owns while VitePress is the live site.[^pages-404] The library `Router` is hash-only, so this is what it already does; the Phase 2 move to the History API is a library change, listed as a non-goal by `hash-router` itself.

### Navigation is the library `Router`, driven by two patterns

The docs app constructs `Router` from `@jimka/typescript-ui/router` and registers exactly two patterns: `/` for the default page and the catch-all `/*` for every real page. Both handlers call one method, `DocsShell.showPath`, because the 15 pages are data in `pages.ts` rather than 15 separate routes.[^two-patterns]

The library normalizes a path before matching, which strips a trailing slash: `#/guide/` becomes `/guide`. Route paths in this app therefore carry **no** trailing slash, and the default path is `/guide`.[^no-trailing-slash]

### The in-app href form is one local function, not a local router

`DocsContent`'s link resolver needs to turn a site path into an in-app href (`/guide/installation` → `#/guide/installation`). That is a one-line `hashHref` in `packages/docs/src/content/links.ts`, next to the resolver that uses it. The app owns no other part of the URL encoding — reading and writing the hash belong to `Router`.[^no-local-router]

### Markdown content migrates as-is — the app reads `packages/lib/docs/` directly

`packages/docs` loads the `.md` files straight out of `packages/lib/docs/` with Vite's `import.meta.glob(..., { query: '?raw' })`. No copying, no transformation at rest.[^direct-read]

### `linkResolver` is a consumer-configurable option with a back-compatible default

A `linkResolver` callback on `MarkdownOptions` lets the app suppress the new tab and rewrite the href. Its default resolver returns `{ external: true }` for everything, preserving today's behaviour.[^resolver-default]

Per [ARCHITECTURE.md](ARCHITECTURE.md) *All attributes and styles go through typed setters*, `linkResolver` gets a typed `setLinkResolver` / `getLinkResolver` pair cached in the options bag, forwarded from `applyOptions`. The getter folds the module-level default (`return this._options.linkResolver ?? defaultLinkResolver`) rather than returning `null`. `linkResolver` is **not** seeded in a `_defaultOptions` bag, so it needs no row in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts).

### The app intercepts link clicks on its own subtree

The content panel owns the `Markdown` child it constructed, so the panel registers `Event.addSubtreeListener(this, "click", …)` **on itself** and inspects the event target's `href`.[^listen-on-self]

Interception is load-bearing, not a convenience. A bare in-page href such as `#custom-themes` changes the hash natively, which would hand `Router` a path with no page behind it. Cancelling that click is the only place the app can stop it.[^interception-load-bearing]

### VitePress `:::` containers are transformed in the app, not supported in the library

The docs app pre-processes `::: tip` / `::: warning` / `::: info` blocks into a blockquote with a bold title before handing the source to `Markdown`. Five of the 15 Phase-1 pages use the syntax (10 occurrences).[^containers-app-level]

### The app shell mirrors the demo app's composition

The shell follows [`packages/lib/src/typescript/main.ts`](packages/lib/src/typescript/main.ts), the repo's existing example of an app built on the library through the package `exports` map: `Body` + `Border`, with `Tree` for the sidebar and a `Panel` with `setAutoScroll("y")` holding a `Markdown`, as [`MarkdownPanel.ts`](packages/lib/src/typescript/MarkdownPanel.ts) already does.[^shell-precedent]

---

## Public API

### Library — `packages/lib/src/typescript/lib/component/display/Markdown.ts`

```typescript
/** How a link href should be rendered: the final href, and whether it leaves the site. */
export interface MarkdownLinkResolution {
    href:     string;
    external: boolean;
}

/** Maps an authored Markdown href to its rendered form. */
export type MarkdownLinkResolver = (href: string) => MarkdownLinkResolution;

export interface MarkdownOptions extends ComponentOptions {
    markdown?:     string;
    linkResolver?: MarkdownLinkResolver;
}

class Markdown extends Component<MarkdownOptions> {
    setLinkResolver(resolver: MarkdownLinkResolver): this;
    getLinkResolver(): MarkdownLinkResolver;
}
```

Backing state: `this._options.linkResolver`. Module-level `defaultLinkResolver` returns `{ href, external: true }`.

**No `MarkdownEditor` API changes** — see *Heading `id`s and `linkResolver` are viewer-only*.

### Docs app — `packages/docs/src/content/links.ts`

```typescript
import type { MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';

/** Builds the in-app href for a site path: "/guide/x" -> "#/guide/x". */
export function hashHref(path: string): string;

/**
 * Maps an authored doc href to its rendered form, by kind: a route ("/…") is
 * rewritten through `hashHref` with any fragment stripped, an in-page reference
 * ("#…") passes through non-external, everything else is external.
 */
export function resolveDocLink(href: string): MarkdownLinkResolution;
```

`path` is always a leading-slash site path (`/guide/installation`), never the URL encoding. `hashHref` is the app's only piece of URL encoding; `Router` owns the rest.

### Docs app — `packages/docs/src/content/pages.ts`

```typescript
export interface DocPage  { path: string; title: string; source: string; }
export interface NavGroup { title: string; pages: DocPage[]; }

export function getPage(path: string): DocPage | null;
export function getNav(): NavGroup[];
```

---

## Internal Structure

### Heading slugs (`Markdown.ts`)

```typescript
// GitHub/VitePress-compatible slug: lowercase, non-alphanumerics collapsed to
// single hyphens, ends trimmed. Duplicates within one render get a "-N" suffix
// so every id on the page is unique.
function slugify(text: string): string;
```

The dedupe counter is a `Map<string, number>` local to one render pass (reset at the top of `appendBlockTokens`' caller), never a field — it must not survive a `setMarkdown` re-render.

### Route ⇄ file mapping

`import.meta.glob` keys arrive as `../../../lib/docs/guide/installation.md`. Strip the prefix and the `.md`, and map a trailing `index` to the directory root:

| Glob key | Route path |
|---|---|
| `.../guide/index.md` | `/guide` |
| `.../guide/installation.md` | `/guide/installation` |
| `.../concepts/theming.md` | `/concepts/theming` |

An `index.md` maps to the directory path with **no** trailing slash, matching what `Router` hands the handler — see *Navigation is the library `Router`, driven by two patterns*.

Titles come from the first `# ` heading in the source; that is authored in every one of the 15 files.

### Link resolution in the docs app

An authored href falls into one of three kinds, and the kind decides both the rendered href and whether the link opens a tab:

- **Route** — starts with `/`. The form every VitePress doc link uses (2,122 occurrences). Rewritten through `hashHref`.
- **In-page** — starts with `#`. A reference to a heading on the page being read. Passed through unchanged and **not** marked external.
- **External** — everything else (`http:`, `mailto:`). Passed through, marked external.

| Authored href | Kind | `resolveDocLink` result |
|---|---|---|
| `/concepts/sizing` | route | `{ href: "#/concepts/sizing", external: false }` |
| `/guide/` | route | `{ href: "#/guide/", external: false }` |
| `/guide/mental-model#jsx-shaped-without-jsx` | route | `{ href: "#/guide/mental-model", external: false }` |
| `#custom-themes` | in-page | `{ href: "#custom-themes", external: false }` |
| `https://example.com` | external | `{ href: "https://example.com", external: true }` |
| `mailto:x@example.com` | external | `{ href: "mailto:x@example.com", external: true }` |

A route href is `hashHref(href)` with any `#fragment` **stripped first**, because a fragment left on the path makes the whole string one unmatchable route segment.[^strip-fragment] `hashHref` does not strip the trailing slash of `/guide/` — `Router` normalizes it away when the click is navigated.

An in-page href stays as authored and is classified non-external, which is what keeps `target="_blank"` off it. It resolves against the heading `id`s **this plan's step 1 adds** — `#custom-themes` finds the heading `slugify` gave that id and scrolls the content pane to it. The click handler owns that scroll (step 9), because the pane is an `autoScroll` Panel and native fragment scrolling does not drive a Panel's scroll offset.[^in-page-scroll]

A route href with no matching page still renders as a link; the content pane shows the not-found view when clicked.[^unmigrated-links]

### Router wiring (`main.ts`)

```typescript
const router = new Router();
const shell  = new DocsShell(router);

function showDefaultPage(): void {
    shell.showPath(DEFAULT_PATH);                    // "/guide"
}

function showRoutedPage(_params: RouteParams, path: string): void {
    shell.showPath(path);
}

router.register("/",  showDefaultPage);
router.register("/*", showRoutedPage);

Body.init({ layoutManager: Fit(), components: [shell] });

router.start();
```

`router` is constructed before `shell` so `DocsShell` can take it, and the patterns are registered afterwards so their handlers can reach `shell`. Everything above runs at module scope in one synchronous pass, so `start()` applies the first route before the first layout frame.[^start-placement]

---

## Ordered Implementation Steps

**Preconditions:** both prerequisite plans are implemented and merged. Confirm before starting.

- `plans/markdown-tables.md` — `grep -n 'case "table"' packages/lib/src/typescript/lib/component/display/Markdown.ts` and `grep -rn 'TABLE' packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts` must **both** return a match. One without the other means the dialect is asymmetric and the parity contract is already violated; stop and fix that first.
- `plans/hash-router.md` — `grep -n '"./router"' packages/lib/package.json` must return a match, and `packages/lib/src/typescript/lib/router/Router.ts` must exist.

### Library: viewer-only `Markdown` additions

1. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — add module-level `slugify(text: string): string` and thread a per-render `Map<string, number>` dedupe counter into `appendHeading` (line 488), which now writes `setAttr: { id }` alongside its existing `addClass`.
2. Same file — add `MarkdownLinkResolution`, `MarkdownLinkResolver`, `defaultLinkResolver`, the `linkResolver` field on `MarkdownOptions` (line 125), the `setLinkResolver` / `getLinkResolver` pair, and the `applyOptions` forward. Rewrite `appendLink` (line 670) to call the resolver and set `target`/`rel` **only** when `external` is true.
3. **`packages/lib/tests/component/display/Markdown.test.ts`** — add the heading-id and link-resolver cases from `## Expected Behaviour`, reusing the existing `createdTags` / `textWrites` / `attrWrites` helpers. The existing link test (line 119) **must stay green unchanged** — it is the back-compatibility guard on `defaultLinkResolver`.
4. **`packages/lib/tests/component/markdown-editor.test.ts`** — add the dialect round-trip guard from `## Expected Behaviour`. It touches no editor source.[^parity-guard-purpose]
   - Check: `npm -w packages/lib run test` — green, with the pre-existing link test untouched.
5. **`packages/lib/docs/components/Markdown.md`** — document heading `id` emission under "Supported syntax", and add `linkResolver` to the construction options table plus `setLinkResolver`/`getLinkResolver` to "Common methods". Do **not** touch the tables row; `markdown-tables` owns it.
   - Do **not** edit `markdownTransformers.ts`, `editorNodes.ts`, `editorTheme.ts`, or `docs/components/MarkdownEditor.md` in this plan.[^no-editor-edits]

### Docs app: shell, routing, content

6. **`packages/docs/src/content/containers.ts`** (new) — export `expandContainers(source: string): string`, converting `::: tip Title` … `:::` blocks into `> **Title**` + blockquoted body. Handle a container with no title by using the type word capitalised.
7. **`packages/docs/src/content/pages.ts`** (new) — `import.meta.glob('../../../lib/docs/{guide,concepts}/*.md', { query: '?raw', import: 'default', eager: true })`, then build the `DocPage` registry per *Route ⇄ file mapping*, running each source through `expandContainers`. Hand-author the `NavGroup[]` for `getNav()` mirroring the `/guide/` and `/concepts/` sidebar sections of [`config.mts:38-60`](packages/lib/docs/.vitepress/config.mts#L38) — same titles, same order. Each `NavGroup` page carries the route path from *Route ⇄ file mapping*, so the Guide index is `/guide`, not `/guide/`.
   - Verify the relative depth of the glob against the file's own location before moving on; `pages.ts` sits at `packages/docs/src/content/`, so `../../../lib/docs/` resolves to `packages/lib/docs/`.
8. **`packages/docs/src/content/links.ts`** (new) — the two functions in `## Public API`. `hashHref(path)` returns `"#" + path`; `resolveDocLink` classifies into the three kinds and produces every row of the table in *Link resolution in the docs app*. A route href has any `#fragment` cut before `hashHref` is applied — `href.split("#")[0]`. Pure — no imports from the shell. Verify: `grep -c 'external: true' src/content/links.ts` — the external branch is the only one that sets it.
9. **`packages/docs/src/shell/DocsContent.ts`** (new) — a `Panel` with `Fit` and `setAutoScroll("y")` holding one `Markdown` configured with `resolveDocLink` from `links.ts`. Takes the `Router` as a constructor argument. Public `showPath(path: string)` calls `getPage`, then `setMarkdown(page.source)` or a short not-found source, and resets the scroll offset to the top. Registers `Event.addSubtreeListener(this, "click", this.handleLinkClick)` — a named method — which reads the target's `href` and branches on its first two characters:
   - starts with `#/` — a route. Call `router.navigate` with the leading `#` stripped, and prevent the default.
   - starts with `#` but not `#/` — an in-page reference. Prevent the default, then scroll to the heading: `DOM.source.querySelector(this.getElement(), '#' + id)`, and on a hit set the pane's scroll offset so the heading sits at its top — the heading's `getRect().top` minus the pane's own `getRect().top`, added to the current `getScrollTop()`, passed to `setScrollTop`. A miss scrolls nowhere. Without this branch the browser writes the hash itself and the router is handed an unmatchable path.[^interception-load-bearing]
   - anything else — leave it to the browser.
10. **`packages/docs/src/shell/DocsSidebar.ts`** (new) — a `Panel` wrapping a `Tree`; takes the `Router` as a constructor argument. `setNodes` built from `getNav()`, `on("selection", …)` routing to `router.navigate(path)`. Public `select(path: string)` so a URL-driven change reflects in the tree. `select` may call `navigate` freely — the feedback loop stops in the browser, not here.[^loop-fix]
11. **`packages/docs/src/shell/DocsShell.ts`** (new) — a `Panel` with `Border`, taking the `Router` and passing it to both children: a `Header` north, `DocsSidebar` west with a fixed preferred width, `DocsContent` centre, and a `StatusBar` south (from `@jimka/typescript-ui/component/container`) whose message is `` `${moduleCount} modules · ${symbolCount} documented symbols` `` read from `virtual:typedoc-summary`. Public `showPath(path: string)` forwards to `DocsContent.showPath` and `DocsSidebar.select`, so the route handlers have one method to call.
12. **`packages/docs/src/main.ts`** — replace the proof-of-seam body with the block in *Router wiring (`main.ts`)*: construct the `Router`, build the shell, register the `/` and `/*` patterns, mount with `Body.init({ layoutManager: Fit(), components: [shell] })`, then `router.start()`. Keep that order — `start()` must run after the tree is built and before the first layout frame.[^start-placement] Declare `DEFAULT_PATH` as `"/guide"`. The `virtual:typedoc-summary` import moves out of `main.ts` into `DocsShell.ts` (step 11); it must keep exactly one consumer.[^typedoc-consumer]
    - Check: `grep -n 'getInstance' packages/docs/src/main.ts` — expect zero matches.
13. **`packages/docs/index.html`** — set `<title>` to `@jimka/typescript-ui`. The `#app` div is unused (the framework mounts on `Body`); remove it.
14. **`packages/docs/vite.config.ts`** — change `base` to `'/typescript-ui/next/'`, and add `server: { fs: { allow: ['../..'] } }` so the dev server may read `packages/lib/docs/`. Leave the `keepNames` minify guard and the `typedocSummary` plugin exactly as they are.
    - Check: `npm run build:docs` succeeds and `packages/docs/dist/index.html` references `/typescript-ui/next/assets/…`.

### Typechecking, tests, and deployment

15. **`packages/docs/src/env.d.ts`** — add `/// <reference types="vite/client" />` above the existing `virtual:typedoc-summary` declaration so `import.meta.glob` is typed. Keep the virtual-module declaration.
16. **`packages/docs/package.json`** — add `"typecheck": "tsc -p tsconfig.json --noEmit"` and `"test": "vitest run"`, and add `"typescript": "^6.0.3"` plus `"vitest": "^4.1.9"` to `devDependencies`, matching the library's pins. `packages/docs` has neither a typecheck nor a test harness today.[^docs-harness]
17. **`packages/docs/tests/`** (new) — `containers.test.ts`, `pages.test.ts`, `links.test.ts` covering the *Docs app — unit-testable* list. These modules run under vitest's default node environment with no DOM harness.[^node-testable] Do **not** unit-test the shell modules — they construct components and belong to the manual-verification list.
    - Check: `npm -w packages/docs run test` — green.
18. **`packages/docs/tsconfig.json`** — add `"tests"` to `include` so the new tests typecheck, and add `"types": ["vite/client"]` in place of the current empty `types` array.
19. **`.github/workflows/docs.yml`** — add `npm -w packages/docs run typecheck` and `npm -w packages/docs run test` before the existing `npm run build:docs` step (line 50). After it, add a step copying `packages/docs/dist` to `packages/lib/docs/.vitepress/dist/next`. Update the comment block above `build:docs`: it is no longer "built but deliberately not deployed" — it now deploys to `/next/` as a preview while VitePress keeps the site root. Do **not** change the `upload-pages-artifact` path at line 56.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Create | `packages/docs/src/content/containers.ts` |
| Create | `packages/docs/src/content/pages.ts` |
| Create | `packages/docs/src/content/links.ts` |
| Create | `packages/docs/src/shell/DocsShell.ts` |
| Create | `packages/docs/src/shell/DocsSidebar.ts` |
| Create | `packages/docs/src/shell/DocsContent.ts` |
| Create | `packages/docs/tests/containers.test.ts` |
| Create | `packages/docs/tests/pages.test.ts` |
| Create | `packages/docs/tests/links.test.ts` |
| Modify | `packages/docs/src/main.ts` |
| Modify | `packages/docs/src/env.d.ts` |
| Modify | `packages/docs/index.html` |
| Modify | `packages/docs/vite.config.ts` |
| Modify | `packages/docs/package.json` |
| Modify | `packages/docs/tsconfig.json` |
| Modify | `.github/workflows/docs.yml` |

No editor **source** file appears in this table — only `markdown-editor.test.ts`, which adds a guard without changing behaviour.[^no-source-omission]

---

## Expected Behaviour

### Library — unit-testable in `Markdown.test.ts`

- `## Some Heading` emits `id="some-heading"` on the `<h2>`.
- Two headings with identical text emit `id="dup"` and `id="dup-1"`.
- A heading whose text is punctuation-heavy (`### setX() / getX()`) emits a slug with no leading, trailing, or doubled hyphens.
- Calling `setMarkdown` twice with the same single-heading source yields the same `id` both times — the dedupe counter does not survive a re-render.
- With **no** `linkResolver`, `[a](https://example.com)` still emits `href`, `target="_blank"`, `rel="noopener noreferrer"` — unchanged from today.
- With a resolver returning `{ href: "#/guide/", external: false }`, the `<a>` carries that `href` and **no** `target` and **no** `rel` attribute.
- `getLinkResolver()` on a freshly constructed `Markdown` returns the default resolver, not `null`.

### Parity guard — unit-testable in `markdown-editor.test.ts`

- A document exercising the full dialect (heading, paragraph, bold, italic, inline code, fenced code, both list kinds, blockquote, link) survives `new MarkdownEditor(src).getValue()` unchanged modulo the existing `normalize` helper. The headless harness in [`tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) already supports `setValue`/`getValue` conversion with no DOM.
- A link's `[text](url)` form is byte-identical after the round-trip.

### Docs app — unit-testable

- `expandContainers` turns `::: tip Title\nbody\n:::` into a blockquote whose first line is `**Title**` and whose remaining lines are the body.
- `expandContainers` on a titleless `::: warning` uses `**Warning**`.
- `expandContainers` leaves source containing no `:::` byte-identical.
- `getPage('/guide/installation')` returns a page whose `source` is non-empty and whose `title` is the file's first `# ` heading.
- `getPage('/guide')` resolves to `guide/index.md`.
- `getPage('/nope')` returns `null`.
- `getNav()` returns two groups, `Guide` and `Concepts`, whose page paths all resolve through `getPage`.
- No path returned by `getNav()` ends in `/` — the trailing slash would never match a router-normalized path.
- `hashHref('/guide/installation')` returns `'#/guide/installation'`.
- `resolveDocLink` produces each row of the table in *Link resolution in the docs app*.
- `resolveDocLink` marks **only** an `http:`/`mailto:` href external. A `#anchor` href is not external, so it renders without `target="_blank"`.
- `resolveDocLink('/guide/mental-model#jsx-shaped-without-jsx')` returns `'#/guide/mental-model'` — the fragment is dropped, and the result is a path `getPage` resolves. Guard against the regression where the fragment rides along and the whole string becomes one unmatchable segment.
- `resolveDocLink('#custom-themes')` returns `'#custom-themes'` unchanged — `hashHref` is not applied, so no `#/` prefix appears.

### Manual verification (browser required)

- `npm -w packages/docs run dev` renders the shell: header, sidebar tree with Guide and Concepts groups, content pane showing the Guide index. An empty hash lands there, which is the `/` route.
- Clicking a sidebar node navigates, updates the URL hash, and scrolls the content pane to the top. Clicking the **same** node again changes nothing and adds no history entry.
- The browser back button returns to the previous page and the sidebar selection follows.
- Reloading on `#/concepts/theming` lands on that page directly, and its 97 table rows render as real tables — behaviour inherited from `markdown-tables`, verified here because this is the heaviest page in the slice.
- The five `:::`-using concepts pages show titled blockquotes, with no literal `:::` text anywhere.
- A route link like `/concepts/sizing` navigates in-place; an external `https://` link opens in a new tab.
- A link into a not-yet-migrated section (e.g. `/components/Button`, common across these pages) shows the not-found view naming the path, not a blank pane or a new tab.
- `concepts/theming.md` carries 13 bare `#anchor` links — the densest in the slice. Clicking *Custom themes* scrolls the content pane to that heading, opens no tab, changes no URL hash, and does not show the not-found view. `concepts/construction.md` and `guide/index.md` link to `/guide/mental-model#jsx-shaped-without-jsx`; clicking one lands at the **top** of the Mental model page — the right page, fragment ignored.[^anchor-counts]
- The content pane scrolls vertically for pages taller than the viewport.

---

## Verification

```bash
npm -w packages/lib run typecheck
npm -w packages/lib run lint
npm -w packages/lib run test          # Markdown heading-id / linkResolver + the dialect round-trip guard
npm run build:lib                     # must emit dist/lib/router.es.js — the docs app imports it
npm -w packages/docs run typecheck    # new — vite build alone does not typecheck
npm -w packages/docs run test         # new — containers / pages / links unit tests
npm run build:docs                    # packages/docs compiles against the built library

# Parity invariant: this plan must not have touched the shared dialect.
# NOTE (see "Implementation Notes"): diffed against feature/hash-router, the
# branch's actual start point, not master — this branch's history already
# contains markdown-tables' legitimate editor changes.
git diff --name-only feature/hash-router -- packages/lib/src/typescript/lib/component/editor/   # expect zero lines
git diff --name-only feature/hash-router -- packages/lib/docs/components/MarkdownEditor.md       # expect zero lines
```

Then `npm -w packages/docs run dev` and walk the manual list above. Confirm the published-URL guarantee by inspecting the workflow diff: `upload-pages-artifact`'s `path` is unchanged, so the VitePress build still occupies the site root.

---

## Documentation Impact

`Markdown` is exported from `@jimka/typescript-ui/component/display` via [`packages/lib/src/typescript/lib/component/display/index.ts:16`](packages/lib/src/typescript/lib/component/display/index.ts#L16); the new symbols ride that same export and need no barrel change. Its doc page is [`packages/lib/docs/components/Markdown.md`](packages/lib/docs/components/Markdown.md), already in the components sidebar at [`config.mts:121`](packages/lib/docs/.vitepress/config.mts#L121) — no new sidebar entry.

[`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) needs **no** edit, and the `git diff` check above enforces that.[^editor-doc-untouched] `markdown-tables` is the plan that must move "tables" from line 56's exclusion list into line 5's dialect.

`llms.txt` regeneration is not required: the manifest derives summaries from the TypeDoc model and the curated seam, and no curated symbol is renamed or removed.

---

## Potential Challenges

- **Starting before `markdown-tables` lands.** The content slice is table-heavy — `guide/installation.md` has 10 table rows and `concepts/theming.md` has 97 — so the docs app would demo badly and the manual-verification list could not pass. The precondition grep at the top of `## Ordered Implementation Steps` is the gate.
- **Drifting into the editor "while you're there".** An opportunistic transformer edit would put a dialect change in a plan that has no coverage for one. The two `git diff --name-only` checks in `## Verification` catch it.
- **Vite dev server refuses to read outside the package root.** `packages/lib/docs/` is outside `packages/docs/`; without `server.fs.allow` the raw glob 404s in dev while building fine. Step 14 sets it.
- **The heading-slug dedupe counter leaking across renders.** If the counter is a field rather than a per-render local, a `setMarkdown` re-render produces `-1`, `-2` suffixes on ids that were unique the first time. Keep it local to the render pass; the fourth `## Expected Behaviour` case pins it.
- **Sidebar ↔ router feedback loop.** `Tree.on("selection")` fires on programmatic selection too, so a URL-driven `select()` re-enters `router.navigate()`. That second `navigate` writes the hash value already there, which fires no `hashchange`, so the cycle stops after one bounce.[^loop-fix]
- **The `@jimka/typescript-ui/router` subpath must be built before the docs app compiles.** `packages/docs` resolves the library through its `exports` map, so a stale `dist/lib` with no `router.es.js` fails at import. `npm run build:lib` sits before `npm run build:docs` in `## Verification` for that reason.
- **Most in-page links land on the not-found view in Phase 1.** Only 15 of 154 pages exist, so a link to `/components/Button` cannot resolve. The not-found view must name the path and say the page is not yet migrated, rather than looking like a bug.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `appendHeading` (488), `appendLink` (670), `MarkdownOptions` (125), the token switch (467).
- [`packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts) — the codified viewer/editor dialect contract. **Read it to confirm this plan changes nothing in it**, not to edit it.
- [`packages/lib/src/typescript/lib/component/editor/editorNodes.ts`](packages/lib/src/typescript/lib/component/editor/editorNodes.ts) — the node registration the dialect depends on; same instruction.
- [`packages/lib/docs/components/MarkdownEditor.md`](packages/lib/docs/components/MarkdownEditor.md) — lines 5 and 56, the consumer-facing statement of the dialect; same instruction.
- [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) — the `RecordingDOMSink` helpers (`createdTags`, `textWrites`, `attrWrites`) every new assertion should reuse; the link test at 119 to leave untouched.
- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — the headless `setValue`/`getValue` harness and its `normalize` helper, reused by the parity guard.
- [`packages/lib/src/typescript/lib/router/Router.ts`](packages/lib/src/typescript/lib/router/Router.ts) — `register`, `start`, `navigate`, `getPath`, and the path normalization that strips the trailing slash. Created by `hash-router`; read it, do not edit it.
- [`packages/lib/docs/concepts/routing.md`](packages/lib/docs/concepts/routing.md) — the router's consumer-facing contract, including the specificity rule that makes `/` beat `/*` for the empty hash.
- [`packages/lib/src/typescript/main.ts`](packages/lib/src/typescript/main.ts) — the precedent for an app built on the library through the package `exports` map, and (after `hash-router`) the worked example of `Router` construction, registration, and `start()` placement.
- [`packages/lib/src/typescript/lib/core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts) — `init` (49) is the mount idiom step 12 uses; `getInstance` is only for reaching an already-mounted body.
- [`packages/lib/src/typescript/MarkdownPanel.ts`](packages/lib/src/typescript/MarkdownPanel.ts) — the precedent for a scrolling `Fit` panel hosting a `Markdown`.
- [`packages/lib/docs/.vitepress/config.mts`](packages/lib/docs/.vitepress/config.mts) — lines 38-60 are the exact sidebar shape `getNav()` must mirror.
- [`packages/docs/vite.config.ts`](packages/docs/vite.config.ts) — the `keepNames` minify guard; breaking it makes every component render as `[object Object]`.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — typed setters, options-bag caching, named listener functions, listening only on self.

---

## Non-Goals

Each is a later phase, not a stretch goal for this one.

- **GFM tables in the viewer and editor** — the `markdown-tables` prerequisite plan this one depends on. Covers the viewer's `case "table"` + `appendTable`, the `@lexical/table` runtime dependency, a hand-written table transformer, node/theme/class-rule registration, the insert-table command surface, an explicit decision on column-alignment round-trip fidelity, and the corrections to `markdownTransformers.ts`'s docblock and `MarkdownEditor.md` lines 5/56.
- **Cutover to `/typescript-ui/` root.** Phase 1 deploys to `/next/` only; VitePress keeps every published README URL. The cutover phase moves the app to the root and installs the SPA `404.html` fallback in the slot VitePress vacates. Whether it also adds a History mode to the library `Router` is that phase's decision; `hash-router` lists History mode as a non-goal.
- **Migrating `components/`, `layouts/`, `data/`, `recipes/`, `reference/`** — 139 further pages; a content-volume phase once the 15-page slice proves the rendering.
- **The TypeDoc API reference surface.** 234 exported symbols across 17 entry points, currently generated as Markdown by `typedoc-plugin-markdown` + `typedoc-vitepress-theme`. Rendering it from `typedoc-model.json` through the `virtual:typedoc-summary` seam is its own phase, and by far the largest.
- **Search.** VitePress ships a ~39 MB local full-text index; the library has no search facility, so this needs both an index build step and a UI.
- **Syntax highlighting of fenced code.** 449 `typescript` blocks currently render as unhighlighted `<pre>` — correct and readable, just plainer than Shiki. A read-only `CodeEditor` (which supports `readOnly` and has a language registry) is the likely vehicle, but one CodeMirror instance per fence needs its own performance decision.
- **`llms.txt` generation from the new app.** It is generated by `packages/lib/scripts/llms/generate.mjs` into `docs/public/`, which VitePress deploys at the site root; it keeps working untouched until the cutover phase, which must re-home the output.
- **In-page outline / table of contents.** VitePress's `outline: { level: [2, 3] }`. The heading `id`s this phase adds are the prerequisite; the outline UI is not built here.
- **Homepage hero.** `docs/index.md` uses VitePress's `layout: home` frontmatter, which has no equivalent; the landing page is designed in a later phase.
- **Light/dark theme toggle parity.** The library has `ThemeManager` and ships themes, but wiring a persisted user toggle is separate work.
- **Images, raw HTML, strikethrough, highlight, and task lists in the dialect.** No doc page uses images or raw HTML (0 occurrences), and each of the rest would need a matching editor transformer under the parity contract. Their plain-text fallback stays as-is.

---

## Addendum: The cost of GFM tables

Adding tables to the viewer is contained: a `case "table"` in the token switch at [`Markdown.ts:467`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L467) plus an `appendTable` builder mirroring `appendList`. The editor half is not contained, and the parity contract means the two must ship together. Investigated cost:

- **`@lexical/table` is not installed.** The library depends on `@lexical/{code,history,link,list,markdown,rich-text,selection,utils}` — no table package. Adding it is a new **runtime** dependency on the published package, not a devDependency.
- **No published Markdown table transformer exists.** `@lexical/markdown` 0.46 ships none and does not import `@lexical/table`; Lexical's official table transformer lives only in the playground source, which is not a published artifact. It must be **hand-written**: a multiline element transformer with a pipe-row `regExp`, a `replace()` that builds `TableNode`/`TableRowNode`/`TableCellNode`, and an `export()` that re-serializes GFM pipe syntax.
- **Node, theme, and class-rule registration.** `TableNode`/`TableRowNode`/`TableCellNode` into [`EDITOR_NODES`](packages/lib/src/typescript/lib/component/editor/editorNodes.ts#L22), matching keys into `EDITOR_THEME`, and new `StyleRule`s in `ensureMarkdownEditorClassRules` ([`editorTheme.ts:38`](packages/lib/src/typescript/lib/component/editor/editorTheme.ts#L38)).
- **A new interaction surface.** The editor's block commands are shaped as [`setBlockType(type: MarkdownBlockType)`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L594) — a flat enum that cannot model "insert a 3×2 table". Insert-table, cell navigation, and row/column add-remove are a new command shape with their own UX decisions, not an extra enum member.
- **An open fidelity question.** GFM column alignment (`|:---:|`) has no representation on a plain `TableCellNode`. Without custom node state it is dropped on round-trip. The table plan must either carry alignment through custom state or declare alignment unsupported in **both** halves.

**A correction the `markdown-tables` plan must make:** the `markdownTransformers.ts` docblock claims Lexical's preset "also carries `STRIKETHROUGH`, `HIGHLIGHT`, `CHECK_LIST`, and table/image transformers". The strikethrough/highlight/checklist part is right; the table claim is false for the installed `@lexical/markdown` 0.46, which exports only `TRANSFORMERS`, `ELEMENT_TRANSFORMERS`, and `MULTILINE_ELEMENT_TRANSFORMERS` and has no dependency on `@lexical/table`. The comment understates the cost of tables and should be fixed when they land.

---

## Notes

[^migration-scale]: [`packages/lib/docs/`](packages/lib/docs/) is 154 authored Markdown files, ~100,000 words, plus a TypeDoc-generated `api/` tree covering 234 exported symbols across 17 entry points, served by a VitePress config with nav, per-section sidebars, local full-text search, and Shiki highlighting ([`packages/lib/docs/.vitepress/config.mts`](packages/lib/docs/.vitepress/config.mts)). Replacing that in one step is not achievable, and [`.github/workflows/docs.yml:19`](.github/workflows/docs.yml#L19) records why the last attempt was reverted: pointing Pages at `packages/docs` "published an empty shell whose every sub-route 404s".

[^table-blocking]: 99 of the 154 doc pages contain tables (1,433 rows; `concepts/theming.md` alone has 97), including `guide/installation.md`, which is inside the Phase-1 slice. Table support is not viewer-only under the parity contract, so it cannot be folded into this plan — see *Tables are a separate plan, sequenced first*.

[^router-is-library]: The point of `packages/docs` is that it is built with `@jimka/typescript-ui` and dogfoods it, so a hand-rolled router inside the app would be the app demonstrating the opposite of its purpose — and a second routing implementation to keep in step with the library's. `hash-router` ships everything this app needs: pattern registration with `:param` and `*`, specificity ranking, `start()` / `stop()`, `navigate(path, { replace })`, `getPath()`, and `on("navigate" | "nomatch")`, with all hash access going through the DOM seam.

[^parity-sources]: The rule is already codified in three places, which are the dialect's source of truth. [`markdownTransformers.ts:17`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L17) defines the curated transformer array as "the exact subset of Markdown the read-only `Markdown` viewer renders", deliberately narrower than Lexical's full preset, and its docblock carries the transformer→viewer-token mapping symbol by symbol. [`docs/components/MarkdownEditor.md:5`](packages/lib/docs/components/MarkdownEditor.md#L5) states the same contract for consumers, and line 56 names tables among the constructs excluded "so the editor's output always round-trips cleanly through the viewer".

[^viewer-only-check]: Heading `id`s add a rendered DOM attribute derived from heading text. The source `## Foo` is byte-identical before and after; there is nothing new to author and nothing to round-trip, and `HEADING` in the transformer array already covers `#`…`######`. `linkResolver` rewrites an `href` at render time; the source `[t](url)` is unchanged and the existing `LINK` transformer already round-trips it. The parity contract governs the syntax subset, so a change confined to how an already-supported token is rendered leaves the editor untouched.

[^table-cost]: The full cost breakdown — the missing `@lexical/table` runtime dependency, the hand-written transformer, node/theme/class-rule registration, the new insert-table command surface, and the unresolved GFM column-alignment fidelity question — is in `## Addendum: The cost of GFM tables`. It is a plan's worth of work with an open design question at its centre; folding it in here would make Phase 1 two features under one title.

[^published-urls]: The published `packages/lib/README.md` is frozen in npm `0.1.0` and links to eight URLs under `https://jimka.github.io/typescript-ui/`. All eight were verified live (HTTP 200) at write time. They cannot be changed retroactively, so the cheapest guarantee that they keep resolving is to not touch the thing serving them. Deploying to `next/` instead makes Phase 1 shippable and reviewable in a browser with zero risk to the published surface.

[^pages-404]: GitHub Pages behaviour was checked, not assumed. `curl` against `https://jimka.github.io/typescript-ui/definitely-not-a-real-page` returns HTTP 404 with a VitePress-generated 404 page body (`<meta name="generator" content="VitePress v1.6.4">`). That shows unknown paths really do 404, and that Pages serves *the site's own* `404.html` rather than GitHub's default — so the standard SPA fallback (ship a copy of `index.html` as `404.html`) works on this host, with the browser booting the app and the router reading the path while the HTTP status stays 404. That fallback needs the site-root `404.html`, which VitePress owns; overwriting it would break VitePress's own 404 page while VitePress is still the live site.

[^two-patterns]: One registration per page would mean 15 hand-written routes duplicating the registry `pages.ts` already builds from `import.meta.glob`, and a sixteenth every time a page is migrated in a later phase. Two patterns keep the page list in one place. The catch-all also makes the router's `"nomatch"` event unreachable in this app — `/*` matches every path — so the not-found view is driven by `getPage` returning `null` inside `showPath`, not by a `nomatch` listener. Registering `/` separately rather than folding it into `/*` is what gives the empty hash its own handler: `hash-router` normalizes an empty hash to `/`, and its specificity rule ranks a pattern that has ended above a catch-all, so `/` wins over `/*` for that path.

[^no-trailing-slash]: `hash-router`'s normalization table pins `"#/settings/"` → `/settings`, and the handler only ever sees the normalized form. Keying `pages.ts` on `/guide/` would therefore mean `getPage` never matched the Guide index. Authored Markdown still contains `/guide/` links — VitePress's directory-index form — but those reach `getPage` only after a `navigate` has normalized them, so `hashHref` can pass them through untouched.

[^no-local-router]: A local `Router.ts` wrapping or duplicating the library one was rejected: it would give the app two objects that both claim to own the hash, and the reason a wrapper looked attractive — isolating the URL encoding for a later History-mode swap — is served better by the library owning the encoding outright. What is genuinely app-specific is the *href string* a rendered `<a>` carries, and that is one line.

[^direct-read]: Reading the files in place means there is no second source of truth. VitePress keeps serving the same files unchanged, so both sites stay in sync for free through the whole multi-phase migration, and there is no reconciliation step at cutover.

[^resolver-default]: The app needs internal links to both stop opening a new tab and carry a rewritten in-app href, so hover-status and middle-click behave; one resolver callback gives both. Defaulting to `{ external: true }` preserves today's behaviour exactly, so the existing link test stays green and published `0.1.0` behaviour is unchanged for anyone not passing the option.

[^listen-on-self]: Registering `Event.addSubtreeListener` on the panel itself stays inside the ARCHITECTURE rule that `Event` APIs are for listening on self. It is not the forbidden pattern of calling `Event.addListener(otherComponent, …)`.

[^containers-app-level]: `:::` containers are VitePress-specific syntax, not CommonMark, so they do not belong in a general-purpose `Markdown` component. Adding them to the viewer would drag a matching editor transformer along under the parity contract, for a dialect nothing outside VitePress uses. An app-level content adapter is the right home for a foreign dialect and costs the editor nothing.

[^shell-precedent]: Per ARCHITECTURE *Compose before specializing*, the shell is composition of existing components: no new `LayoutManager` and no new library component.

[^unmigrated-links]: Landing on the not-found view is the common case in Phase 1, since the 15 migrated pages link freely into the 139 not-yet-migrated ones. That is the intended outcome for a link whose *target* is missing — `/components/Button` routes correctly and finds no page. It is not the intended outcome for a link the app failed to route at all, which is what the fragment-stripping and in-page rules exist to prevent. A link to `/guide/mental-model#jsx-shaped-without-jsx` must reach the Mental model page; that page is one of the 15.

[^strip-fragment]: `hash-router`'s `normalizePath` splits on `/` and knows nothing about `#`. Left in place, `/guide/mental-model#jsx-shaped-without-jsx` becomes the single segment `mental-model#jsx-shaped-without-jsx`, which matches no page and falls to the catch-all — so a link pointing at a migrated page would show the not-found view. Four such links exist in the Phase 1 slice, three of them aimed at `guide/mental-model`. The fragment is dropped rather than honoured: the reader lands at the top of the right page instead of at the right heading. Carrying it through would mean threading it past `navigate` into `showPath` and scrolling after the new source has laid out — real machinery for four links, and a scope increase this phase does not need. Same-page anchors scroll because the target is already rendered when the click arrives; cross-page ones do not, and that asymmetry is deliberate.

[^in-page-scroll]: This works in Phase 1 only because step 1 is already adding heading `id`s for other reasons — the ids an in-page link needs are a by-product of work the plan does anyway, so the remaining cost is the scroll arithmetic in one click branch. Nothing new is needed from the library: `querySelector`, `getRect`, `getScrollTop`, and `setScrollTop` all exist on the DOM seam and on `Component` ([DOM.ts:1064](packages/lib/src/typescript/lib/core/DOM.ts#L1064), [Component.ts:3283](packages/lib/src/typescript/lib/core/Component.ts#L3283), [:3320](packages/lib/src/typescript/lib/core/Component.ts#L3320)). Scrolling is computed rather than delegated to the browser because the content pane is an `autoScroll` Panel whose offset the framework owns; a native fragment jump would move the document, not the Panel.

[^interception-load-bearing]: Worth stating because the interception otherwise looks redundant: a real `<a href="#/guide/x">` changes the hash natively and `Router`'s `hashchange` listener would pick it up with no JavaScript at all. That reasoning holds only for route hrefs. For `#custom-themes` the native behaviour is the bug — the browser writes `#custom-themes`, `Router` normalizes it to `/custom-themes`, the catch-all matches, `getPage` returns null, and the reader is thrown off the page they were reading onto the not-found view. Only a cancelled click stops it.

[^anchor-counts]: Counted in the Phase 1 slice: 13 bare `#anchor` links across `guide/` and `concepts/`, all but one in `concepts/theming.md`, plus 4 of the `/path#fragment` form. Both shapes are checked here because both are silent failures — the link renders normally and misbehaves only on click.

[^start-placement]: Layout in this framework is coalesced onto one animation frame, so synchronous module-scope code runs entirely before the first layout pass. Calling `start()` at the end of that pass means the routed page is already showing when the frame runs — no flash of the default page. `hash-router` documents the same constraint for the demo app and warns that a top-level `await` placed above `start()` reintroduces the flash; `packages/docs/src/main.ts` has no `await`, and must not grow one above `router.start()`.

[^parity-guard-purpose]: The guard exists so that a future viewer change which *does* alter the dialect fails in this test rather than silently shipping an asymmetry.

[^no-editor-edits]: Neither change in this plan alters the Markdown dialect, so the parity contract is satisfied by leaving the editor alone. An edit to the editor's source or docs would be out of scope and unreviewable against this plan.

[^typedoc-consumer]: With no consumer, Vite tree-shakes the plugin's `load` away and CI silently stops verifying that the TypeDoc model is readable — which is the entire reason [`docs.yml:50`](.github/workflows/docs.yml#L50) builds this package.

[^docs-harness]: `vite build` does not typecheck, so without the `typecheck` script the new modules ship untypechecked. `packages/docs` has no test harness at all today, so without the `test` script the *Docs app* behaviours cannot be red-greened.

[^node-testable]: `containers.ts`, `pages.ts`, and `links.ts` are pure — no `document` access at import scope. `pages.ts`'s `import.meta.glob` is resolved by vitest's Vite pipeline. `links.ts` imports only a type from the library, which erases at compile time, so it pulls no component module in.

[^no-source-omission]: The absence of editor source files is the intended outcome of the parity check in `## Architecture Decisions`, not an omission.

[^loop-fix]: The library `Router` does not special-case an unchanged path — it writes the hash unconditionally, and the browser is what breaks the cycle: assigning `location.hash` a value it already holds fires no `hashchange` and adds no history entry. `hash-router`'s worked example relies on the same mechanism for its `Tab` round trip, and its unit list pins it ("`navigate` to the path already in the hash writes the same value, so no `hashchange` fires and no handler re-runs"). A re-entrancy flag in `DocsSidebar` would therefore be dead code.

[^editor-doc-untouched]: Line 5 of `MarkdownEditor.md` enumerates the dialect as "headings, paragraphs, bold, italic, inline code, ordered/unordered lists, blockquotes, fenced code, and links", and line 56 lists what is excluded. Heading `id`s and `linkResolver` add nothing to either list, because neither is a syntax construct.

---

## Implementation Notes

- **Editor-untouched diff checked against `feature/hash-router`, not `master`.** This branch's actual start point is the tip of the already-chained Phase 1 stack (`master → feature/markdown-tables → feature/hash-router → feature/packages-docs`), and `feature/hash-router`'s history already contains `markdown-tables`' legitimate edits to `packages/lib/src/typescript/lib/component/editor/` and `MarkdownEditor.md` line 56 (adding the tables row). Diffing against `master` would therefore show those files as changed for reasons that have nothing to do with this plan. `## Verification` above and the check below are written against `feature/hash-router`; both are empty as required.

- **`MarkdownLinkResolution`/`MarkdownLinkResolver` needed an explicit barrel re-export.** `## Public API` declares both as `export`ed from `Markdown.ts`, but per the project's export-surface convention a new public symbol also needs a matching re-export from the subpath barrel (`component/display/index.ts`) — otherwise TypeDoc resolves the type reference on `MarkdownOptions.linkResolver` but excludes its own page, producing an unresolved-link warning. Added the re-export; `docs:build` now reports 0 warnings for these symbols. Also dropped two `{@link defaultLinkResolver}` JSDoc references (the resolver itself is intentionally unexported) in favour of prose, per the "don't `{@link}` an internal symbol from public JSDoc" rule.

- **`packages/docs` needed `@types/node` to typecheck.** `tsconfig.json` already `include`d `vite.config.ts`, which imports `node:fs`/`node:url`, but `packages/docs` had no `typecheck` script before this plan so the gap was never exercised. Added `@types/node` as a devDependency and `"node"` alongside `"vite/client"` in `types` — not called for in `## Ordered Implementation Steps`, but required for `tsc -p tsconfig.json --noEmit` to pass at all.

- **The worktree's `node_modules` had to be installed from scratch.** Despite the setup note claiming it was already present, none of `node_modules`, `packages/lib/node_modules`, or `packages/docs/node_modules` existed at the start of this run. `npm install` at the repo root (workspaces hoist to a single root `node_modules`) resolved it; no lockfile or dependency version changed beyond the additions this plan's own steps call for.

- **Sidebar selection is not cleared when a route resolves to the not-found view.** `DocsSidebar.select` only acts on a path present in the nav table (`_nodesByPath`); a route with no migrated page (e.g. `/components/Button`) leaves whatever sidebar item was previously selected highlighted while the content pane shows the not-found view. Not a violation of any `## Expected Behaviour` line — the manual-verification list only requires the not-found view to name the path, which it does — but worth flagging as a rough edge for a later phase alongside the other `## Non-Goals`.

- **Manual verification performed live** (dev server + chrome-devtools, per the escape hatch in the `implement` skill's Test-first discipline for behaviour the automated harness can't exercise): initial route render (header, sidebar, Guide index content, status bar counts); sidebar click → hash update, content swap, and selection tracking; browser back button restoring the previous page and sidebar selection; direct reload on `#/concepts/theming` (table-heavy, 0 console errors); an in-page `#custom-themes` anchor scrolling the content pane to that heading with no hash change and no new tab; a route link with a `#fragment` (`/guide/mental-model#jsx-shaped-without-jsx`) resolving to `#/guide/mental-model` with the fragment dropped; an external `https://` link carrying `target="_blank" rel="noopener noreferrer"`; and the not-found view naming `/components/Button`. The only console message observed across the whole session was a harmless `favicon.ico` 404 (no favicon asset exists; outside this plan's scope).
