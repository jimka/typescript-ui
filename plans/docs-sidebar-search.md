# Docs Sidebar Search — Implementation Plan

## Overview

Add a persistent search box above the docs app's sidebar tree, filtering the nav tree in place as the user types. Two product decisions are already made and are not revisited here: the box lives inline above the tree (not a command palette or a separate route), and it matches only each page's title and heading text — not full page body/prose.

The change is confined to one file, [packages/docs/src/shell/DocsSidebar.ts](packages/docs/src/shell/DocsSidebar.ts): a `Panel` that builds a `Tree` from `getNav()`'s seven authored-page sections plus an API-reference branch from `getApiNav()`, and tracks `_nodesByPath: Map<string, TreeNode>` for router-driven selection ([packages/docs/src/shell/DocsSidebar.ts:25-54](packages/docs/src/shell/DocsSidebar.ts#L25-L54)). `Tree` ([packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts)) has no filter or highlight facility of its own — a `grep -n "filter\|highlight\|search" Tree.ts` finds nothing — so filtering rebuilds the `TreeNode[]` array passed to `Tree.setNodes`, the same way `DocsSidebar` already builds it fresh from `getNav()`/`getApiNav()`.

No `packages/lib` source changes. Every component this plan needs — `TextField`, `Border`, `Placement`, `extractMarkdownHeadings` — is already exported and already used elsewhere in `packages/docs`, so no library rebuild step is needed before testing this in the running app.

---

## Architecture Decisions

### The search index is built once, at `DocsSidebar` construction, from data already in memory

`pages.ts` eagerly globs every authored page's Markdown source at module load (`import.meta.glob(..., { eager: true })`, [packages/docs/src/content/pages.ts:51-58](packages/docs/src/content/pages.ts#L51-L58)), and `extractMarkdownHeadings` — already shipped for the header minimap — computes a page's headings from that source with no DOM and no I/O ([packages/lib/src/typescript/lib/component/display/Markdown.ts:1498-1504](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1498-L1504)). `DocsSidebar` builds the search index synchronously in its constructor, right after building the tree, mirroring how `_nodesByPath` is already populated once and never rebuilt.[^eager-index]

### The API-reference branch is searchable by title only, not by heading

An authored page's Markdown is already in memory; an API reference page's is not — `fetchApiPage` fetches each generated page over the network on demand, one request per page ([packages/docs/src/content/api.ts:180-198](packages/docs/src/content/api.ts#L180-L198)). This plan indexes every API tree node's own `label` (`ApiNavNode.label`, already computed by `getApiNav()` with no I/O) but does not fetch page bodies to extract API "headings".[^api-title-only]

### Filtering rebuilds `TreeNode[]` by walking the already-built tree, not by re-deriving it from `getNav()`/`getApiNav()`

`DocsSidebar` already builds one `TreeNode[]` tree from `getNav()` and `getApiNav()` in `buildNodes()` ([packages/docs/src/shell/DocsSidebar.ts:85-90](packages/docs/src/shell/DocsSidebar.ts#L85-L90)). This plan stores that result once (`_fullNodes`) and filters it with a pure recursive function operating on the `TreeNode` shape alone — the same function handles the authored-page branch and the API-reference branch identically, since by that point both are the same `TreeNode[]` shape. A group node with no matching descendant and no title/heading match of its own is dropped; the search index (below) is what a node's own match test reads.

### A node's own text is a match target only when it has a navigable path

`NavGroup.path` is optional — a pure grouping node like the top-level "Components" section has no page of its own ([packages/docs/src/content/pages.ts:26-41](packages/docs/src/content/pages.ts#L26-L41)), and neither does a pure `ApiNavNode` directory (e.g. a module's "Classes" kind grouping, `path: null`). Clicking such a node does nothing — `DocsSidebar.onSelection` already returns early when `node.data === undefined` ([packages/docs/src/shell/DocsSidebar.ts:159-161](packages/docs/src/shell/DocsSidebar.ts#L159-L161)) — so matching text against it would surface a "result" the user can't open. Only a `TreeNode` whose `data` is a string participates in its own match test; a pathless group still survives filtering when one of its descendants matches.

### Matching compares the query against both the tree's displayed label and the page's authored `# ` title

`DocPage.title` — the text of a page's first `# ` heading — is computed by `pages.ts` today but never read anywhere outside the file that builds it (`grep -rn "\.title\b" packages/docs/src` finds only `pages.ts`'s own sort comparator). The tree's own label (`NavEntry.label` / `NavGroup.title`) is hand-authored and differs from that heading text for three pages, by `pages.ts`'s own documented reason.[^dual-title-match] Both strings go into the match test for an authored page.

### Matching is a case-insensitive substring test — no fuzzy or word-split matching

`AutoCompleteField` already filters a suggestion list the same way, by default: lower-case both sides and test `includes` ([packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts:556-568](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L556-L568)). This plan follows that default (`'contains'`) mode exactly — no per-word AND-matching, no fuzzy scoring, no ranking.[^substring-match]

### The search box is a `Border` `NORTH` region above the tree in `CENTER`, mirroring `TablePanel`'s toolbar

`DocsSidebar` currently lays out its single `Tree` child with `Fit()` ([packages/docs/src/shell/DocsSidebar.ts:41-45](packages/docs/src/shell/DocsSidebar.ts#L41-L45)). `TablePanel` already docks a fixed toolbar above a virtualized, space-filling component the identical way: `new Border()`, toolbar in `Placement.NORTH`, the space-filling component in `Placement.CENTER` ([packages/lib/src/typescript/lib/component/table/TablePanel.ts:51,82-83](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L51-L83)). `Border`'s `NORTH` region stretches to the container's full width regardless of the child's own preferred width — the same reason `DocsShell`'s `Header` already spans the full app width in its own `NORTH` region — so the search field needs no explicit width override.

### A router-driven `select(path)` call always clears an active filter first

`Tree.selectNode` no-ops when the target node is not in the tree's *currently flattened* set ([packages/lib/src/typescript/lib/component/tree/Tree.ts:218-249](packages/lib/src/typescript/lib/component/tree/Tree.ts#L218-L249)), and a filtered branch's rebuilt group nodes are new object instances, not the same references `_nodesByPath` stored for the full tree. Left unguarded, a navigation that lands outside the filtered set — the minimap, an in-page link, the browser's back button — would silently select or expand nothing.[^select-clears-filter] `select()` therefore clears the search field and restores `_fullNodes` first, whenever the field is non-empty, before its existing `revealByPredicate`/`selectNode` calls.

### Typing filters; clicking (or Tab+Enter into an existing row) selects — no new keyboard affordance

`Tree` already handles keyboard selection of its rows ([packages/lib/src/typescript/lib/component/tree/Tree.ts:743](packages/lib/src/typescript/lib/component/tree/Tree.ts#L743)); this plan adds no Escape-to-clear and no arrow-key hand-off from the search field into the tree.[^type-then-click]

---

## Internal Structure

`SearchEntry` and three new private fields on `DocsSidebar`:

```typescript
/** One tree node's searchable text, keyed by its route path. */
interface SearchEntry {
    /** The node's own displayed label, plus the page's authored `#` title for an authored page. */
    titles:   string[];
    /** Heading text from the page's source; always `[]` for an API-reference node. */
    headings: string[];
}

class DocsSidebar extends Panel {
    private readonly _searchField:  TextField;
    private readonly _fullNodes:    TreeNode[];
    private readonly _searchIndex:  Map<string, SearchEntry>;

    private readonly handleQueryChange: () => void = () => this.onQueryChange();
}
```

Index construction walks the already-built tree once, deciding per node whether it is an authored page (fetch title + headings) or an API node (title only), via `isApiPath` ([packages/docs/src/content/api.ts:88-90](packages/docs/src/content/api.ts#L88-L90)):

```typescript
private buildSearchIndex(nodes: TreeNode[]): Map<string, SearchEntry> {
    const index = new Map<string, SearchEntry>();

    const visit = (node: TreeNode): void => {
        if (typeof node.data === 'string') {
            index.set(node.data, this.searchEntryFor(node.data, node.label));
        }
        (node.children ?? []).forEach(visit);
    };

    nodes.forEach(visit);

    return index;
}

private searchEntryFor(path: string, label: string): SearchEntry {
    if (isApiPath(path)) {
        return { titles: [label], headings: [] };
    }

    const page = getPage(path)!; // pages.ts's requireAll() already guarantees this resolves.

    return {
        titles:   [label, page.title],
        headings: extractMarkdownHeadings(page.source).map((h) => h.text),
    };
}
```

Filtering and matching:

```typescript
private matchesQuery(path: string, query: string): boolean {
    const entry = this._searchIndex.get(path);
    if (!entry) return false;

    return entry.titles.some((t) => t.toLowerCase().includes(query))
        || entry.headings.some((h) => h.toLowerCase().includes(query));
}

private filterNodes(nodes: TreeNode[], query: string): TreeNode[] {
    const kept: TreeNode[] = [];

    for (const node of nodes) {
        const filteredChildren = node.children ? this.filterNodes(node.children, query) : [];
        const selfMatches = typeof node.data === 'string' && this.matchesQuery(node.data, query);

        if (!selfMatches && filteredChildren.length === 0) {
            continue;
        }

        kept.push(filteredChildren.length > 0 ? { ...node, children: filteredChildren } : node);
    }

    return kept;
}

private onQueryChange(): void {
    const query = this._searchField.getValue().trim().toLowerCase();

    if (query === '') {
        this._tree.setNodes(this._fullNodes);
        return;
    }

    this._tree.setNodes(this.filterNodes(this._fullNodes, query));
    this._tree.expandAll();
}
```

`select()` gains a filter-clearing guard at the top, before its existing reveal-and-select body:

```typescript
async select(path: string): Promise<void> {
    const node = this._nodesByPath.get(path);

    if (node) {
        if (this._searchField.getValue() !== '') {
            this._searchField.setValue('');
            this._tree.setNodes(this._fullNodes);
        }

        await this._tree.revealByPredicate((data) => data === path);
        this._tree.selectNode(node);
    }
}
```

Constructor: build the tree data first, then the two child components, then lay them out:

```typescript
constructor(router: Router, options?: PanelOptions) {
    super(options, {
        layoutManager: Border(),
        preferredSize: { width: SIDEBAR_WIDTH, height: 0 },
        insets: new Insets(0, 0, 0, 0)
    });

    this._router = router;

    this._fullNodes   = this.buildNodes();
    this._searchIndex = this.buildSearchIndex(this._fullNodes);

    this._searchField = new TextField({
        placeholder: 'Search docs…',
        padding:     new Insets(6, 8, 6, 8),
    });
    this._searchField.on('action', this.handleQueryChange);

    this._tree = new Tree();
    this._tree.setNodes(this._fullNodes);
    this._tree.on('selection', this.handleSelection);

    this.addComponent(this._searchField, { placement: Placement.NORTH });
    this.addComponent(this._tree,        { placement: Placement.CENTER });
}
```

`getValue`/`setValue`/`on("action", …)` are inherited from `TextInput` ([packages/lib/src/typescript/lib/component/input/TextInput.ts:201,493,505](packages/lib/src/typescript/lib/component/input/TextInput.ts#L201-L505)); `"action"` is documented there as firing on every keystroke (the native `input` DOM event), and `setValue`/`setText` writes the DOM element's value directly (`DOM.sink.setValue`, [packages/lib/src/typescript/lib/component/input/TextInput.ts:474-484](packages/lib/src/typescript/lib/component/input/TextInput.ts#L474-L484)) with no synthetic `input` dispatch — so `select()`'s `setValue('')` does not re-enter `onQueryChange`.

`buildNodes()`, `buildGroupNode()`, `buildPageNode()`, `buildApiNode()`, and `_nodesByPath` are unchanged.

---

## Ordered Implementation Steps

1. **`packages/docs/src/shell/DocsSidebar.ts` — imports.** Replace `import { Fit } from '@jimka/typescript-ui/layout';` with `import { Border } from '@jimka/typescript-ui/layout';`. Add a new line `import { TextField } from '@jimka/typescript-ui/component/input';`. Add a new line `import { extractMarkdownHeadings } from '@jimka/typescript-ui/component/display';` (no existing import from that module in this file). Change `import { Insets } from '@jimka/typescript-ui/primitive';` to `import { Insets, Placement } from '@jimka/typescript-ui/primitive';`. Change `import { getNav } from '../content/pages.js';` to `import { getNav, getPage } from '../content/pages.js';`. Change `import { API_PREFIX, getApiNav } from '../content/api.js';` to `import { API_PREFIX, getApiNav, isApiPath } from '../content/api.js';`.
2. **Add the `SearchEntry` interface** at module scope, above the `DocsSidebar` class, per `## Internal Structure`.
3. **Add the three new private fields** (`_searchField`, `_fullNodes`, `_searchIndex`) and the `handleQueryChange` stable-handler field, per `## Internal Structure`. `_searchField` and `_searchIndex` have no initializer (assigned in the constructor body, like the existing `_router`/`_tree` fields); `_fullNodes` likewise.
4. **Add `buildSearchIndex` and `searchEntryFor`** as new private methods, per `## Internal Structure`. Added before the constructor changes below so step 6's constructor body has something to call.
5. **Add `matchesQuery`, `filterNodes`, and `onQueryChange`** as new private methods, per `## Internal Structure`. Same reason as step 4.
6. **Rewrite the constructor** per `## Internal Structure`: `layoutManager` becomes `Border()`; `_fullNodes` is assigned from `buildNodes()`; `_searchIndex` is assigned from `buildSearchIndex(_fullNodes)` (added in step 4); `_searchField` is constructed and wired to `handleQueryChange` via `on('action', …)`; both `_searchField` and `_tree` are added via `addComponent` with `Placement.NORTH` / `Placement.CENTER`.
7. **Update `select()`** to clear an active filter before its existing `revealByPredicate`/`selectNode` calls, per `## Internal Structure`. The existing body (the `revealByPredicate` + `selectNode` pair, and the doc comment above it) is otherwise unchanged.
8. **`packages/docs/tests/DocsSidebar.test.ts` (new file)** — build per `## Expected Behaviour` below, mirroring `DocsMinimap.test.ts`'s harness (real `jsdom`, `Body.init` + `flushLayout()` for anything that needs a connected DOM; a bare `new DocsSidebar(router)` for anything that doesn't).
9. Run `npm run typecheck` in `packages/docs` — zero errors. `grep -n "Fit()" packages/docs/src/shell/DocsSidebar.ts` — expect zero matches (the old layout manager is gone).
10. Run `npm test` in `packages/docs` — the new `DocsSidebar.test.ts` cases pass; no existing test references `DocsSidebar` today (`grep -rln "DocsSidebar" packages/docs/tests` before this step — expect zero matches), so no regression risk there.
11. Manual verification per `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/docs/src/shell/DocsSidebar.ts` |
| Create | `packages/docs/tests/DocsSidebar.test.ts` |

---

## Expected Behaviour

Matching (worked examples, all case-insensitive substring):

| Query | Matches because | Result |
|---|---|---|
| `install` | Substring of the title `Installation` at `/guide/installation` | that page's node shown; `Guide` ancestor kept |
| `BASELINE` | Case-insensitive substring of a heading text on some page | that page's node shown, even though its own title doesn't contain it |
| `button` | Substring of the API node label `Button` | the API tree's `Button` node shown, with its ancestor module/kind groups kept |
| `xyzzy` | Not a substring of any indexed title or heading | the tree renders with zero nodes |
| `` (empty, or after clearing) | — | the full, unfiltered tree is shown, fully collapsed |

`DocsSidebar` (unit-testable, mirroring `DocsMinimap.test.ts`'s harness — `sidebar.getComponents()` returns `[searchField, tree]` in `addComponent` order):

- Typing a query matching one page's title shows a tree (`tree.getNodes()`) containing only that page's node and its ancestor group nodes; a sibling page under the same group that doesn't match is absent from the ancestor's `children`.
- Typing a query matching only a page's heading text (not its title) still surfaces that page's node.
- A group node with no matching descendant and no title/heading match of its own does not appear anywhere in the filtered tree.
- A group node whose own page matches, but none of whose children match, appears with an empty (or `undefined`) `children` — filtering does not pull in non-matching siblings just because their parent matched.
- Typing a query with no matches anywhere sets the tree to zero nodes (`tree.getNodes()` is `[]`).
- Clearing the field back to `''` restores `tree.getNodes()` to the exact `_fullNodes` array the sidebar built at construction.
- After a non-empty query, `Tree.expandAll` is called (spy-verified) so matching nodes are immediately visible with no manual expansion.
- A query matching an API-reference node's label filters that branch in, exactly like an authored page.
- A query that is a substring only of an API-reference page's Markdown body (not its label) does not match — headings/body are out of scope for the API branch.
- Calling `select(path)` while the search field holds a non-empty value clears the field (`getValue()` becomes `''`) and resets the tree to `_fullNodes` before revealing/selecting `path` — including when `path` is not present in whatever was filtered a moment earlier.
- Calling `select(path)` while the search field is already empty leaves the field untouched and does not call `Tree.setNodes` — the existing reveal-and-select behaviour is unchanged from before this plan.

Manual verification only (real browser layout/typing, not exercised by the offline `jsdom` harness):

- The search box renders above the tree, spanning the sidebar's full width, matching `Header`'s own full-width look in the app shell.
- Typing in the box filters the visible tree live, on every keystroke.
- Clicking a filtered result navigates to that page and the search box clears, showing the full tree with that page selected.

---

## Verification

1. `npm run typecheck` in `packages/docs` — zero errors.
2. `npm test` in `packages/docs` — the new `DocsSidebar.test.ts` cases from `## Expected Behaviour` pass; existing suite unaffected.
3. `npm run dev` in `packages/docs` (per `project_dev_urls.md` — docs on `localhost:5173`) and manually exercise the three "Manual verification only" bullets above, including at least one query that matches only a heading (not a title) and one that matches only an API symbol's label.

---

## Potential Challenges

- **Re-filtering on every keystroke is a synchronous, unindexed scan.** `AutoCompleteField` already does the same (`.filter(s => this.matches(s, query))` on every query change) over its own suggestion list with no debounce; the docs nav tree (a few hundred authored + API nodes) is well within the same performance envelope. No debounce is added.
- **`expandAll()` only expands nodes with already-loaded children.** Every `TreeNode` this plan's tree ever builds has real, eagerly-populated `children` — neither `getNav()` nor `getApiNav()` produces a lazy (`loadChildren`) node — so this is a non-issue here, but would need reconsideration if a future lazy branch were added to the sidebar.

---

## Critical Files

- [packages/docs/src/shell/DocsSidebar.ts](packages/docs/src/shell/DocsSidebar.ts) — the file this plan modifies; `buildNodes`/`buildGroupNode`/`buildPageNode`/`buildApiNode`/`_nodesByPath`/`select`/`onSelection` all stay as-is except where noted.
- [packages/docs/src/content/pages.ts](packages/docs/src/content/pages.ts) — `DocPage`/`NavGroup`/`NavEntry`, `getPage`, and the eager `RAW_SOURCES` glob the search index reads from.
- [packages/docs/src/content/api.ts](packages/docs/src/content/api.ts) — `ApiNavNode`, `getApiNav`, `isApiPath`, `fetchApiPage` (cited as the reason API bodies are out of scope).
- [packages/lib/src/typescript/lib/component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `extractMarkdownHeadings`/`MarkdownHeading`, reused unchanged.
- [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `setNodes`, `expandAll`, `selectNode`, `revealByPredicate` — confirms there is no built-in filter facility and pins the exact selection/reveal semantics `select()`'s filter-clearing guard depends on.
- [packages/lib/src/typescript/lib/component/tree/TreeNode.ts](packages/lib/src/typescript/lib/component/tree/TreeNode.ts) — the `TreeNode` shape `filterNodes` operates on.
- [packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts) — `matches` (556-568), the precedent for case-insensitive substring matching.
- [packages/lib/src/typescript/lib/component/table/TablePanel.ts](packages/lib/src/typescript/lib/component/table/TablePanel.ts) — the `Border` NORTH-toolbar / CENTER-content precedent.
- [packages/docs/tests/DocsMinimap.test.ts](packages/docs/tests/DocsMinimap.test.ts) — the test harness (`Body.init`, `flushLayout`, `getComponents()`) `DocsSidebar.test.ts` mirrors.
- [ARCHITECTURE.md](ARCHITECTURE.md) — "Positioning is always absolute" (why `Border` and not a new layout mechanism) and construction-options-bag conventions.

---

## Non-Goals

- **Full page body / prose search.** Out per the locked-in product scope — titles and headings only.
- **A command palette or separate search route.** Out per the locked-in product scope — inline sidebar filter only.
- **Heading-level results or deep-linking a match to its specific heading fragment.** Filtering surfaces the matching *page*, at the same granularity the tree already shows; it does not add a finer heading-level result list or navigate past the page's own top.
- **API-reference body/heading search.** API page Markdown is fetched lazily, per page, over the network (`fetchApiPage`); eagerly fetching every generated page to index its headings is new I/O this plan's "reuse what's already loaded" principle rejects.
- **Fuzzy or ranked/scored matching.** Plain case-insensitive substring only, mirroring `AutoCompleteField`'s existing default.
- **Escape-to-clear the search field, or arrow-key hand-off from the field into the tree.** Type-to-filter-then-click is the whole v1 interaction model.
- **A dedicated "no results" empty-state message.** `Tree` has no empty-state slot today; a blank filtered tree is the v1 signal for "nothing matched."
- **Preserving each branch's pre-filter expand/collapse state across a filter-then-clear cycle.** Clearing the query always returns to the fully-collapsed tree `Tree.setNodes` already produces — the same state a fresh page load starts from.

---

## Notes

[^eager-index]: The alternative — building the index lazily on first keystroke — was rejected because the data it needs (every authored page's Markdown source) is already resident in memory the moment `pages.ts` is imported; deferring the (cheap, synchronous) index build to first keystroke would only add a branch with no benefit, since there is no I/O to defer.

[^api-title-only]: A middle ground — eagerly fetching every generated API page just for headings — was rejected: the app's own status bar already reports the scale (`moduleCount()`/`symbolCount()`, [packages/docs/src/content/api.ts:326-337](packages/docs/src/content/api.ts#L326-L337)), and fetching that many pages over the network at sidebar-construction time would materially slow the app's startup for a feature whose product scope was explicitly narrowed to titles and headings, not full-text. Label-only matching for API nodes was chosen over excluding the API branch entirely because `getApiNav()`'s labels are already computed with zero marginal I/O, and "find this class by name" is one of the most common reasons to search API docs at all.

[^dual-title-match]: `packages/docs/src/content/pages.ts`'s own `NavEntry` doc comment: "The label is hand-authored from the VitePress sidebar (config.mts) rather than taken from the page's `# ` heading, because the two differ for three pages and a heading may carry inline Markdown (e.g. backticks) that must not leak into a plain tree label." Matching on `DocPage.title` alone would miss a query that matches only the label a user actually sees in the tree, for those three pages; matching on the label alone would miss a query against the page's real heading text for the same three. Indexing both closes that gap for the cost of one extra array entry per page — no dedup logic is added, since a duplicate string in `titles` changes no match outcome.

[^select-clears-filter]: Concretely: if the tree is showing a filtered branch and the user clicks a `Link` in the rendered Markdown, or the minimap, or presses the browser's back button, `DocsShell.showPath` calls `this._sidebar.select(path)` unconditionally ([packages/docs/src/shell/DocsShell.ts:93-95](packages/docs/src/shell/DocsShell.ts#L93-L95)) for whatever `path` the navigation lands on — a path that was never typed into the search field and may not be present anywhere in the currently filtered tree. Without the guard, `revealByPredicate`'s depth-first walk over the filtered `_nodes` would simply not find it (returning `null`, expanding no ancestors), and `selectNode` would then no-op silently per its own documented contract — the sidebar would show neither the right selection nor any error, just a stale filtered list with nothing highlighted. Clearing the filter first sidesteps this rather than trying to special-case "is `path` present in the filtered set" — it also means `_nodesByPath` and `Tree`'s internal `_flatRows` are always checked against the exact same `_fullNodes` array they were built from, so no node-identity mismatch (a filtered branch's `{ ...node, children }` copies are structurally equal but not `===` the originals `_nodesByPath` stored) can arise at all.

[^substring-match]: A per-word AND-match (so `"tree filter"` would match a page containing "filter" and "tree" anywhere, not as one substring) and fuzzy/typo-tolerant matching were both considered and rejected for v1: neither is needed to satisfy "titles and headings only," both add real implementation surface (tokenizing, scoring, tie-breaking) that this plan's own product scope doesn't ask for, and the codebase's only existing search-like feature already ships the simpler behavior in production.

[^type-then-click]: Both considered affordances are real, standard patterns elsewhere (e.g. a command palette's arrow-key result navigation), but neither was asked for by the two locked-in product decisions, and `Tree`'s own keyboard handling already lets a user reach a filtered row via Tab and its existing arrow/Enter selection once focus is inside the tree. Backspacing the field to empty already restores the full tree, covering "I want to undo my search" with no new code.
