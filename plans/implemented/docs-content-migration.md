---
touches-shared:
    - packages/docs/src/content/pages.ts
    - packages/docs/src/shell/DocsSidebar.ts
    - packages/docs/src/shell/DocsContent.ts
    - packages/docs/src/shell/DocsShell.ts
    - packages/docs/tests/pages.test.ts
---

# Docs Content Migration (Phase 2) — Implementation Plan

## Overview

`packages/docs` is the dogfooded documentation app shipped by [`plans/implemented/packages-docs.md`](plans/implemented/packages-docs.md) and deployed as a preview at `/typescript-ui/next/`. It registers 16 of the 154 authored pages in [`packages/lib/docs/`](packages/lib/docs/) — all of `guide/` and `concepts/`. This plan registers the remaining 138: `components/` (92), `layouts/` (17), `data/` (7), `recipes/` (15), `reference/` (7).

The app reads `packages/lib/docs/` in place through `import.meta.glob`, so no Markdown is copied or transformed at rest. Registering a section means widening one glob pattern in [`packages/docs/src/content/pages.ts:36`](packages/docs/src/content/pages.ts#L36) and adding its entries to the hand-authored nav table in the same file.

**A survey of what those 138 pages actually contain decides the size of this phase, and the answer is that it is small.** The corpus uses no VitePress construct the app cannot already render. This plan changes **no library source file**: it touches four modules in `packages/docs`, two tests, and three lines across two authored Markdown pages.

---

## Survey: what the 138 remaining pages use

Counted over `components/ layouts/ data/ recipes/ reference/` with fenced blocks and inline-code spans stripped first, so a tag or symbol quoted inside backticks is not miscounted as live syntax.[^survey-method]

### Constructs that are absent

| Construct | Occurrences |
|---|---|
| `::: code-group` / tabbed blocks | 0 |
| Custom containers beyond `tip` / `warning` / `info` (`danger`, `details`, `raw`) | 0 |
| Frontmatter of any kind | 0 |
| Vue components (`<Badge>`, `<script setup>`, `{{ }}`) | 0 |
| Emoji shortcodes | 0 |
| Footnotes | 0 |
| Task lists | 0 |
| Images | 0 |
| Strikethrough, `==highlight==`, MathML / `$…$` | 0 |
| Horizontal rules, setext headings, definition lists | 0 |
| Code fences with meta (`{1,3}`, `:line-numbers`) | 0 |
| Relative (`./`, `../`) or `.md`-suffixed site links | 0 |
| Autolinks (`<https://…>`), HTML entities, `<br>` | 0 |

### Constructs that are present and already render

| Construct | Occurrences | Files | Status |
|---|---|---|---|
| GFM pipe tables | 1,287 rows | 96 | Supported (`markdown-tables`) |
| Column alignment (`:---:`) | 2 | 2 | Supported — `alignmentClass` at [`Markdown.ts:192`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L192) |
| Escaped pipes (`\|`) in cells | 36 | 17 | Supported — marked emits an `escape` token, the inline fallback writes its text |
| `::: tip` / `::: warning` | 4 | 4 | Transformed app-side by `expandContainers` |
| Fenced code indented inside a list item | 14 | 2 | Supported — `appendListItem` walks block tokens |
| Ordered lists | 31 | 6 | Supported |
| Heading depths | `#` 138, `##` 841, `###` 68 | — | Supported |

### The two real gaps

| Gap | Occurrences | Files |
|---|---|---|
| Raw inline HTML (`<kbd>`) rendered as literal tag text | 4 elements | `components/MarkdownEditor.md:64` |
| A bare `#anchor` link whose target slug the viewer never emits | 1 | `components/DiagramView.md:119` |

Both are fixed in the authored Markdown, not in the library. The reasoning is in *Two content fixes, no dialect change*.

### Link resolution after this phase

1,848 site-internal links appear in the 138 pages. 1,091 of them point into `/api/` — the TypeDoc reference, which a separate plan owns — so they land on the not-found view. Every one of the other 757 resolves once this phase registers the five sections.

| Link target prefix | Occurrences | Resolves after this phase |
|---|---|---|
| `/api/…` | 1,091 | No — see `## Non-Goals` |
| `/components/…` | 433 | Yes |
| `/layouts/…` | 117 | Yes |
| `/data/…` | 93 | Yes |
| `/concepts/…` | 61 | Yes (already registered) |
| `/recipes/…` | 33 | Yes |
| `/reference/…` | 12 | Yes |
| `/guide/…` | 8 | Yes (already registered) |

Of the 43 bare `#anchor` links in the whole corpus, 42 already match a heading `id` the viewer emits; the one that does not is the `DiagramView.md` gap above.[^slug-not-github]

---

## Architecture Decisions

### This phase changes no library source

The survey found nothing in the 138 pages that the `Markdown` viewer cannot render, so the parity contract between `Markdown` and `MarkdownEditor` is never engaged.[^parity-untouched] Do not edit `packages/lib/src/typescript/lib/component/`; `## Verification` has a `git diff` check that enforces it.

### Two content fixes, no dialect change

The four `<kbd>` elements become inline code, and the `DiagramView.md` heading is reworded so its slug is the same under both slug generators. Adding raw-HTML support to the viewer is rejected outright.[^no-raw-html] Changing `slugify` to match GitHub's rules is also rejected — it would break more authored anchors than it fixes.[^slug-not-github]

### The sidebar becomes a three-level tree, with only the active page's branch expanded

Each of the seven sections is one top-level tree node; config.mts's sidebar groups become its children. `DocsSidebar` drops `expandAll()` and instead calls `Tree.revealByPredicate` from `select(path)`, which expands exactly the ancestors of the page being shown.[^reveal-not-expand-all]

### The nav table stays hand-authored, and a bijection test replaces eyeballing it

`getNav()` keeps its literal entry list copied from [`config.mts`](packages/lib/docs/.vitepress/config.mts) rather than deriving labels from page headings — the Phase 1 decision, for the same reason.[^hand-authored-labels] What changes is the guard: at 154 entries, a new test asserts that the set of nav paths and the set of globbed page paths are identical.[^bijection-holds]

### The survey's findings are frozen as a test over the corpus

A new `packages/docs/tests/content-constructs.test.ts` re-runs the survey's absence checks on every registered page. It is the reason a future doc page cannot quietly introduce a construct the viewer drops.[^guard-test-value]

### The not-found view names the API reference specially

A route under `/api/` gets its own message pointing at the published VitePress reference, because that one prefix accounts for 1,091 of the links a reader can click.[^api-not-found]

### Markdown stays eagerly globbed

The glob keeps `eager: true`, so all 154 pages are inlined into the bundle and every navigation is instant.[^eager-glob]

---

## Public API

### `packages/docs/src/content/pages.ts`

`NavGroup` gains an optional nested-group list. `NavEntry`, `DocPage`, `getPage`, and `getNav` keep their current signatures.

```typescript
/** A sidebar section: a titled group of entries, optionally holding subgroups. */
export interface NavGroup {
    title:   string;
    /** Pages sitting directly under this group's node, rendered first. */
    pages:   NavEntry[];
    /** Nested subgroups, rendered after `pages`. Two levels deep at most. */
    groups?: NavGroup[];
}
```

### `packages/docs/src/shell/DocsSidebar.ts`

```typescript
class DocsSidebar extends Panel {
    /** Reveals and selects the tree node for `path`. Resolves once the reveal has re-rendered. */
    select(path: string): Promise<void>;
}
```

`select` becomes `async` because `Tree.revealByPredicate` is. `DocsShell.showPath` calls it as `void this._sidebar.select(path)` — it has nothing to await.

---

## Internal Structure

### Which sections the tree shows, and in what order

Seven top-level nodes, in this order:

| Order | Section node label | Where the label comes from |
|---|---|---|
| 1 | Guide | `config.mts` nav, line 28 |
| 2 | Concepts | first sidebar group's `text`, line 46 |
| 3 | Components | `config.mts` nav, line 29 |
| 4 | Layouts | `config.mts` nav, line 30 |
| 5 | Data | `config.mts` nav, line 31 |
| 6 | Recipes | `config.mts` nav, line 32 |
| 7 | Reference | first sidebar group's `text`, line 252 |

### How a section's config.mts sidebar becomes tree nodes

**The rule: a section's *first* sidebar group is unwrapped — its pages hang directly off the section node. Every later group becomes a child group node holding its own pages.** The rule has no exceptions across the seven sections.

| Section | `config.mts` sidebar groups | Resulting tree |
|---|---|---|
| Guide | `Guide`[Introduction, Installation, Mental model] | `Guide` → 3 pages |
| Data | `Data layer`[Overview, Model, …] | `Data` → 7 pages |
| Layouts | `Layouts`[Overview, Constraints], `Layout managers`[13], `Docking`[1], `Serialization`[1] | `Layouts` → 2 pages, then `Layout managers`, `Docking`, `Serialization` |
| Components | `Components`[Catalog], `Core`[13], `Buttons`[9], … | `Components` → Catalog, then `Core`, `Buttons`, … (13 subgroups) |

In `NavGroup` terms, an unwrapped first group's items go in `pages` and every later group goes in `groups`.

### Transcribing an entry

Each `{ text, link }` in `config.mts` becomes one `NavEntry`. The label is copied verbatim; the path is the link with any trailing slash removed, because the router normalizes a trailing slash away before `getPage` ever sees the path.

| `config.mts` | `NavEntry` |
|---|---|
| `{ text: 'Catalog', link: '/components/' }` | `{ path: '/components', label: 'Catalog' }` |
| `{ text: 'Table internals', link: '/components/TableInternals' }` | `{ path: '/components/TableInternals', label: 'Table internals' }` |
| `{ text: 'Linking a local library checkout', link: '/recipes/local-development' }` | `{ path: '/recipes/local-development', label: 'Linking a local library checkout' }` |

### Building the tree nodes (`DocsSidebar.ts`)

```typescript
private buildGroupNode(group: NavGroup): TreeNode {
    return {
        label:    group.title,
        children: [
            ...group.pages.map((page) => this.buildPageNode(page)),
            ...(group.groups ?? []).map((child) => this.buildGroupNode(child)),
        ],
    };
}
```

`buildPageNode` is today's leaf construction: `{ label: page.label, data: page.path }`, recorded in `_nodesByPath`.

### Stripping code before scanning source (`content-constructs.test.ts`)

The guard test must not flag a tag or a `:::` marker quoted inside backticks or a fenced block. Strip both, longest-first, before matching:

```typescript
function stripCode(source: string): string {
    return source
        .replace(/^([ \t]*)```[\s\S]*?^\1```[ \t]*$/gm, '')   // fenced blocks, incl. indented
        .replace(/`[^`\n]*`/g, '');                            // inline code spans
}
```

---

## Ordered Implementation Steps

### Content fixes in `packages/lib/docs/`

1. **`packages/lib/docs/components/MarkdownEditor.md`**, line 64 — replace each `<kbd>X</kbd>` with `` `X` ``. Four replacements on one line.
   - Check: `grep -rn '<kbd' packages/lib/docs/` — expect zero matches.
2. **`packages/lib/docs/components/DiagramView.md`** — reword the heading at line 76 from `## Compound / container nodes` to `## Compound and container nodes`, and update the link at line 119 from `(#compound--container-nodes)` to `(#compound-and-container-nodes)`.
   - Check: `grep -n 'compound' packages/lib/docs/components/DiagramView.md` — the only remaining hits are the new heading and the new link, and their slugs agree.

### Docs app: registration and navigation

3. **`packages/docs/src/content/pages.ts`** — widen the `import.meta.glob` pattern at line 36 to `'../../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference}/*.md'`. Every section directory is flat, so a single `*.md` level is enough; `api/` and the root `index.md` stay out.
   - Check: `getPage('/components/Table')` is non-null once step 5's test runs.
4. Same file — add the optional `groups` field to `NavGroup` per `## Public API`.
5. Same file — rewrite `getNav()` to return the seven groups of *Which sections the tree shows*, transcribing every `{ text, link }` from [`config.mts:38-261`](packages/lib/docs/.vitepress/config.mts#L38) per *Transcribing an entry* and nesting per *How a section's config.mts sidebar becomes tree nodes*. Keep the existing `requirePage` sweep at the end, extending it to walk nested `groups` as well as `pages`.
   - Check: 154 entries total. `npm -w packages/docs run test` fails loudly on any path typo, because `requirePage` throws.

### Docs app: sidebar

6. **`packages/docs/src/shell/DocsSidebar.ts`** — replace `buildNodes`'s single `map` with the recursive `buildGroupNode` / `buildPageNode` pair from `## Internal Structure`.
7. Same file — delete the `this._tree.expandAll()` call, and make `select` `async`: on a `_nodesByPath` hit, `await this._tree.revealByPredicate((data) => data === path)` before `this._tree.selectNode(node)`. A miss still returns without touching the tree.
8. Same file — raise `SIDEBAR_WIDTH` from 260 to 320 and update its comment: the longest label is now `Linking a local library checkout`, sitting one indent level deeper than any Phase 1 label.
9. **`packages/docs/src/shell/DocsShell.ts`** — change `this._sidebar.select(path)` to `void this._sidebar.select(path)`, since `select` now returns a promise the shell has no reason to await.

### Docs app: not-found view

10. **`packages/docs/src/shell/DocsContent.ts`** — in `notFoundSource`, return a distinct source for a path starting with `/api/`: a heading, one sentence saying the generated API reference is not part of this preview, and a link to `https://jimka.github.io/typescript-ui/api/`. Every other path keeps today's message verbatim.
    - Check: confirm that URL returns HTTP 200 before hard-coding it (`curl -sI https://jimka.github.io/typescript-ui/api/`). If it does not, link the site root instead.

### Tests

11. **`packages/docs/tests/pages.test.ts`** — replace the `getNav` group-title assertion (which pins the two Phase 1 groups) with the seven-section list, and add the nav↔glob bijection and section-page-count cases from `## Expected Behaviour`. Keep every `getPage` case unchanged.
12. **`packages/docs/tests/content-constructs.test.ts`** (new) — glob the same pattern as `pages.ts` with `{ query: '?raw', import: 'default', eager: true }`, run each source through the `stripCode` helper in `## Internal Structure`, and assert the *Constructs that are absent* list plus the two closed gaps. Report the offending file path in every failure message; a bare `expect(matches).toHaveLength(0)` names no file and is useless to whoever trips it.
    - Check: `npm -w packages/docs run test` — green.

### Verification pass

13. Run every command in `## Verification`, then walk the manual list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/docs/src/content/pages.ts` |
| Modify | `packages/docs/src/shell/DocsSidebar.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/tests/pages.test.ts` |
| Create | `packages/docs/tests/content-constructs.test.ts` |
| Create | `packages/docs/src/content/notFound.ts` (added during implementation — see `## Implementation Notes` 3) |

No file under `packages/lib/src/` appears. That is the intended outcome of the survey, not an omission.

---

## Expected Behaviour

### Page registry — unit-testable in `pages.test.ts`

- `getPage('/components/Table')`, `getPage('/layouts/HBox')`, `getPage('/data/store')`, `getPage('/recipes/crud-table')`, and `getPage('/reference/faq')` each return a page with non-empty `source`.
- `getPage('/components')` resolves to `components/index.md` — the section index, with no trailing slash.
- `getPage('/api/core/classes/Component')` returns `null`; `api/` is not globbed.
- `getPage('/nope')` returns `null`.

### Nav table — unit-testable in `pages.test.ts`

- `getNav()` returns exactly seven groups, titled `Guide`, `Concepts`, `Components`, `Layouts`, `Data`, `Recipes`, `Reference`, in that order.
- Flattening `getNav()` over both `pages` and nested `groups` yields exactly 154 entries, all distinct.
- **Bijection:** the set of flattened nav paths equals the set of `getPage`-resolvable paths. A page present in one and absent from the other fails, naming the path.
- Per-section entry counts are Guide 3, Concepts 13, Components 92, Layouts 17, Data 7, Recipes 15, Reference 7.
- `Components` has 13 nested `groups`; `Layouts` has 3; `Recipes` has 5; the other four sections have none.
- No nav path ends in `/`.
- No nav label contains a backtick — the Phase 1 regression guard, now covering 154 labels.

### Content guard — unit-testable in `content-constructs.test.ts`

Over every registered page's raw source, with `stripCode` applied first:

- No raw HTML tag matches `</?[a-zA-Z][a-zA-Z0-9]*\b[^>]*>`.
- No image (`![…](…)`), footnote reference (`[^…]`), task list item (`- [ ]` / `- [x]`), strikethrough (`~~`), or `==highlight==`.
- No `<script`, `<Badge`, or `{{ … }}`.
- Every `:::`-opening line names `tip`, `warning`, or `info`.
- No source begins with a `---` frontmatter block.
- Every bare `#anchor` link resolves to a heading on the same page, using the same slug rule the viewer applies: lowercase, every run of non-alphanumerics collapsed to one hyphen, ends trimmed, with a `-N` suffix on the Nth repeat of a slug.

### Manual verification (browser required)

- `npm -w packages/docs run dev` opens on the Guide index, and the sidebar shows seven collapsed section nodes.
- Clicking `Components` → `Table` → `Table` expands only that branch and renders the page; the other twelve Components subgroups stay collapsed.
- `components/Table.md`, the heaviest registered page, renders its tables with no clipped column and no console error.
- `components/MarkdownEditor.md` shows the keyboard-shortcut bullet with no literal `<kbd>` text anywhere.
- `components/DiagramView.md`'s *Compound and container nodes* link scrolls the pane to that heading.
- `layouts/Tab.md` shows both its containers as titled blockquotes, with the inline code in the `Composed from a TabBar` title rendered as code and no literal `:::` on the page.
- A `/api/…` link (e.g. from any component page's first paragraph) shows the API-reference message, not the generic not-found message.
- Reloading directly on `#/recipes/drag-and-drop` lands on that page with the sidebar branch expanded and the entry selected.
- Deep-linking to a path with a fragment, e.g. `/concepts/sizing#the-size-invariant`, lands at the **top** of the Sizing page — the fragment is dropped, by design (see `## Non-Goals`).

---

## Verification

```bash
npm -w packages/docs run typecheck
npm -w packages/docs run test          # pages + nav bijection + content guard
npm run build:lib
npm run build:docs

# No library source touched — the survey's whole point.
git diff --name-only master -- packages/lib/src/                       # expect zero lines
git diff --name-only master -- packages/lib/docs/ | grep -v -E 'components/(MarkdownEditor|DiagramView)\.md'   # expect zero lines

# The VitePress site still builds from the two edited pages.
npm run docs:build
```

`docs:build` needs roughly 5 GB of heap and the repo script pins it; if it exits 137 the machine is out of memory, not the change.

Then `npm -w packages/docs run dev` and walk the manual list. Note the `packages/docs/dist/assets/*.js` size before and after: the bundle grows by roughly 650 KiB of inlined Markdown (about 240 KiB today), which is expected — see `## Potential Challenges`.

---

## Documentation Impact

No public API changes, so no doc page needs an update on that account. The two authored Markdown edits are consumer-facing doc content and are already the subject of steps 1-2; both keep rendering correctly under VitePress, which is what `npm run docs:build` in `## Verification` confirms.

`llms.txt` is generated from the TypeDoc model and the curated seam by `packages/lib/scripts/llms/generate.mjs`; no curated symbol changes, so no regeneration is required.

---

## Potential Challenges

- **Transcribing 154 nav entries by hand invites a typo.** `requirePage` throws at module load on a path that resolves to no page, and the bijection test catches a page that exists but was never listed. Between them, both directions of error fail the test run.
- **The bundle grows by ~650 KiB of inlined Markdown.** Expected and accepted; the alternative is in `## Non-Goals`. Record the before/after `dist/assets` size so the growth is a measured number rather than a surprise.
- **`revealByPredicate` never collapses a branch.** Browsing several sections leaves all of them expanded, converging on the old `expandAll()` behaviour within one session. `Tree` exposes no public per-node collapse, and adding one is out of scope.
- **`select` is now async and called from a synchronous route handler.** The `void` in step 9 is deliberate; do not make `DocsShell.showPath` or the route handlers async, because `router.start()` must apply the first route synchronously or the first frame shows the wrong page.
- **The guard test can misfire on a future page that legitimately quotes a tag.** `stripCode` removes fenced and inline code first, so quoting `` `<div>` `` is safe; writing a bare `<div>` is what fails, which is the intent.
- **A wide table clips.** It does not: `Markdown` wraps every table in a `maxWidth: 100%; overflow-x: auto` frame ([`Markdown.ts:133`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L133)), and fenced code has its own `overflow: auto`. Confirm on `components/Table.md` in the manual pass rather than assuming.

---

## Critical Files

- [`packages/docs/src/content/pages.ts`](packages/docs/src/content/pages.ts) — the glob (36), `routePathFor` (52), and the hand-authored `getNav` (119) this plan widens.
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — `buildNodes` (75) and `select` (61), both rewritten.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `notFoundSource` (17), and the click handler that already routes `#/` and `#` hrefs.
- [`packages/lib/docs/.vitepress/config.mts`](packages/lib/docs/.vitepress/config.mts) — lines 27-35 (section labels) and 62-261 (the five sidebars to transcribe). The authoritative source for every label; the file has exactly 154 links with no duplicate and no orphan.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `revealByPredicate` (276) and `selectNode` (229). Read them; do not edit them.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `slugify` (209) is the slug rule the guard test reimplements. Read only; changing it is rejected in `## Architecture Decisions`.
- [`packages/docs/src/content/containers.ts`](packages/docs/src/content/containers.ts) — the `:::` transform the four remaining containers rely on. Unchanged.
- [`packages/docs/tests/pages.test.ts`](packages/docs/tests/pages.test.ts) — the existing case style the new cases follow.
- [`plans/implemented/packages-docs.md`](plans/implemented/packages-docs.md) — the app's architecture, and the `## Non-Goals` entry this plan discharges.

---

## Non-Goals

- **The TypeDoc API reference.** `plans/docs-typedoc-reference.md` owns it. Until it lands, all 1,091 `/api/…` links show the API-reference not-found message.
- **Cutover to the site root**, including the SPA `404.html` and re-homing `llms.txt`. `plans/docs-cutover.md` owns it and depends on this plan.
- **Cross-page `#fragment` navigation.** 178 links use the `/path#fragment` form; the fragment is dropped and the reader lands at the top of the correct page, as `packages-docs` decided. Honouring it needs either fragment support in the library `Router` or an app-side pending-fragment buffer that still breaks on a direct reload — a plan of its own, best paired with the in-page outline.
- **Lazy page loading.** Switching the glob to `eager: false` would trade ~650 KiB of initial download for an async `getPage`, rippling through `DocsContent.showPath`, `DocsShell`, and the route handlers. Not worth it while the whole corpus is smaller than one bundled dependency.
- **Per-node collapse control in the sidebar.** `Tree` has no public expand/collapse-one-node API; adding one is a library change with its own docs and tests.
- **Section landing pages and a top nav bar.** VitePress switches sidebars per section; this app shows one tree instead. A `nav` bar mirroring `config.mts:27-35` is a separate UI decision.
- **The `layout: home` landing page**, search, syntax highlighting, and the in-page outline — all still owned by later phases as listed in `packages-docs`.
- **Rewriting doc content for the new renderer.** Only the two lines named in steps 1-2 change; the survey found no other page that needs it.

---

## Implementation Notes

Two regexes specified in `## Internal Structure` had to be corrected during implementation. Both changes keep the plan's intent; they fix snippets that would have failed against the real corpus.

**1. `stripCode`'s inline-code regex.** The plan specified ``/`[^`\n]*`/g``, which only matches single-backtick spans. `packages/lib/docs/components/Markdown.md:37-38` uses a double-backtick span (`` `inline code` ``) and a four-backtick span (```` ``` ````) to quote literal backticks, and the same table cells quote raw HTML tags (`<strong>`, `<code>`, `<pre>`). Against that page the plan's regex desynchronises and leaves `<pre>` and `<code>` in the stripped output, so the *no raw HTML tag* guard fails on a page that is entirely correct — a false positive on the very construct the plan's `[^no-raw-html]` footnote says is safe to quote. The first attempted fix was ``/(`+)[\s\S]*?\1/g``, and it was **not sufficient** — an audit caught it. Capturing the opening run is not enough, because a run of N backticks can close against the first N backticks of a *longer* run. On `components/MarkdownEditor.md:53` (`` | Fenced code | ` ``` ` fence | ``) the 1-backtick opener closed against the head of the ``` run and the scan swallowed 12 lines, hiding a "raw HTML is not part of the dialect" paragraph and a `## Formatting` heading from every assertion in the file — on the very page whose `<kbd>` gap motivated this phase. The shipped form is ``/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g``, whose lookarounds require the closing run to be a whole run, which is CommonMark's own rule. Three cases in `describe('stripCode removes only the code it should')` pin this, and the full corpus passes with the 12 previously-hidden lines now actually being checked.

**2. The `:::` container check is line-based, not a multiline regex.** Matching `/^:::\s*(\w+)/gm` over the whole source lets `\s*` run past a bare closing `:::` line's newline and capture the next paragraph's first word as a container type. The check therefore splits on newlines and tests each line independently. The reasoning is repeated as a comment at the call site so the next person does not "simplify" it back.

**3. `notFoundSource` moved from `shell/DocsContent.ts` to a new `content/notFound.ts`.** Step 10 placed it in `DocsContent.ts`, and it was implemented there. An audit then found a correctness bug in it — the `/api/` predicate missed the bare `/api` route (see below) — and pinning the fix with a test proved impossible from `shell/`: importing `DocsContent.ts` constructs components at import time and throws `ReferenceError: document is not defined` under the docs package's node test environment. That is precisely why every other pure source transform in this app already lives in `src/content/` (`containers.ts`, `links.ts`, `pages.ts`) and why nothing in `shell/` has unit tests. Moving the function follows that existing split rather than inventing anything; the alternative was to leave a known-wrong branch covered only by a manual step. The file list in `## Files to Create / Modify / Delete` therefore gains one row, `Create packages/docs/src/content/notFound.ts`.

Everything else follows the plan as written. No library source was touched.

### Audit findings fixed after implementation

- **The corpus guard's heading-id rule did not match the viewer's.** `headingIds` was fed `stripCode`'d source, so inline code was deleted from heading text before slugifying, while `Markdown.appendHeading` slugifies `token.text` with the backticked text intact. The rules disagreed on 23 of the 154 pages, so the guard would have false-failed a correctly authored anchor and passed a dead one. Heading ids now come from a fence-only strip. The corpus still passes under the corrected rule, which confirms the authored anchors were right all along.
- **The API-reference not-found message never fired for `/api`.** `normalizePath` collapses the trailing slash on the corpus's `/api/` links, so the predicate `startsWith('/api/')` was false for exactly the links the special case existed to serve. The plan's own wording ("a path starting with `/api/`") is the proximate cause.

## Notes

[^survey-method]: The counts come from scanning the 138 files after removing fenced code blocks (including list-indented ones) and inline code spans. Stripping matters: a naive grep reports 122 HTML tags across 62 files, 26 `==` hits, and 6 emoji-shortcode hits, and every one of those is a false positive — `` `<div>` `` quoted in prose, `===` inside a TypeScript sample, and `:hover:not(:active)` in a CSS selector. After stripping, the real totals are 8 tag occurrences (four `<kbd>` pairs) in one file, and zero of everything else. The same strip is what `content-constructs.test.ts` codifies, so the plan's numbers and the test's rule are the same rule.

[^parity-untouched]: `Markdown` (the viewer) and `MarkdownEditor` (the Lexical editor whose value is a Markdown string) must support the same syntax subset, or a document that renders in the viewer is destroyed by an editor round-trip. The contract binds any change that adds or removes *surface syntax*. This plan adds none: it registers files, restructures a nav table, and edits two lines of authored prose. Nothing new can be authored and nothing new must round-trip, so the editor, its transformer array, `EDITOR_NODES`, the editor theme, and `docs/components/MarkdownEditor.md`'s dialect statement all stay as they are.

[^no-raw-html]: Supporting `<kbd>` would mean giving the viewer a raw-HTML path, which is surface syntax and therefore drags an editor transformer along under the parity contract. It also contradicts a promise the library makes to consumers: `docs/components/Markdown.md:5` states there is no HTML-string assignment path, "so untrusted Markdown can never inject markup", and line 64 documents raw HTML as deliberately falling through to plain text. Rewriting four `<kbd>` elements as inline code costs one line and keeps both properties. VitePress renders inline code on that line perfectly well; the only loss is `<kbd>`'s keycap styling on the VitePress site.

[^slug-not-github]: `slugify` at [`Markdown.ts:209`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L209) collapses every run of non-alphanumerics to a single hyphen; `github-slugger`, which VitePress uses, strips non-word characters and then maps each remaining space to a hyphen, so a heading like `Compound / container nodes` yields `compound--container-nodes` there and `compound-container-nodes` here. The docblock's "GitHub/VitePress-compatible" claim is therefore inexact. Fixing it was measured rather than assumed: against the 43 bare `#anchor` links authored across all 154 pages, the current rule leaves 1 unresolved and GitHub's rule would leave 8 — the authors wrote most anchors in the collapsed form. Switching would also contradict the shipped `Markdown.test.ts` case that pins "no doubled hyphens" for `### setX() / getX()`. Rewording the one heading fixes the single mismatch and keeps both sites working, since `Compound and container nodes` slugifies identically under either rule.

[^reveal-not-expand-all]: `expandAll()` was right for 16 pages; at 154 it produces a flat wall in which the 92 `components/` entries drown everything else. `Tree.revealByPredicate` ([`Tree.ts:276`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L276)) already expands exactly the ancestors on the path to a matching node and scrolls it into view, testing the predicate against each node's `data` payload — which `DocsSidebar` already sets to the route path. So the behaviour needs no library change, only the removal of the `expandAll()` call and an `await` in `select`. Two alternatives were rejected: a top nav bar with a per-section sidebar (faithful to VitePress, but it introduces a second navigation concept and a new component for a preview app), and leaving `expandAll()` in place (no code, but the sidebar becomes unusable). Note `revealByPredicate` never collapses, so expansion accumulates across a session; that is listed in `## Potential Challenges` rather than fixed, because `Tree` exposes no per-node collapse.

[^hand-authored-labels]: Phase 1 first derived sidebar labels from each page's first `# ` heading and had to reverse it: three headings differ from the config.mts title, and one (`DOM seams (`DOMSink` / `DOMSource`)`) leaked literal backticks into a plain tree label. The same hazards are present in the new sections — `recipes/drag-and-drop.md`'s heading is ``Drag-and-drop with `DragManager` `` against the config title `Drag-and-drop`, and `components/TableInternals.md` is titled `Table internals` in the sidebar. `config.mts` is the authoritative label source, so it stays the transcription source.

[^bijection-holds]: Verified before writing this plan: the five section sidebars plus Guide and Concepts contain exactly 154 `link:` entries, all distinct, and `packages/lib/docs/{guide,concepts,components,layouts,data,recipes,reference}` contains exactly 154 `.md` files. Every config link has a file and every file has a config link. The bijection therefore holds at authoring time and the test only has to keep it holding.

[^guard-test-value]: The survey is the expensive part of this plan and it decays the moment someone writes a new doc page. Encoding its conclusions as assertions turns a one-time measurement into a standing rule: a page that adds a `::: details` block, an image, or a raw tag fails `npm -w packages/docs run test` with the offending file named, instead of silently rendering as literal text in the app while looking fine in VitePress.

[^api-not-found]: Without the special case, roughly three in five clickable links in the app land on a message saying the page "has not been migrated to this preview yet", which reads as the app being broken rather than as one deliberately deferred surface. Naming the API reference and linking the published one turns the commonest dead end into a useful signpost, for about three lines in `notFoundSource`.

[^eager-glob]: The 138 remaining pages total 646 KiB of Markdown, on top of the 117 KiB already inlined — roughly a 650 KiB increase over a bundle that is 240 KiB today. Uncompressed that looks large; over the wire it is a few tens of kilobytes more after gzip, downloaded once, after which every page transition is a synchronous map lookup with no loading state anywhere in the app. Going lazy would make `getPage` return a promise and push async handling into `DocsContent`, `DocsShell`, and both route handlers — real complexity for a site whose entire text corpus is smaller than one chart dependency.
