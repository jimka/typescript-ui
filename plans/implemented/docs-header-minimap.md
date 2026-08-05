# Header Minimap for the Docs App — Implementation Plan

## Overview

Add a clickable outline of the current page's headings to the docs app (`packages/docs`), shown as a column to the right of the rendered Markdown content. It stays in place while the content pane scrolls, and clicking an entry jumps to that heading — the same way clicking an in-page `#fragment` link already does.

The docs app's `DocsShell` ([packages/docs/src/shell/DocsShell.ts:18](packages/docs/src/shell/DocsShell.ts#L18)) lays out a `Header` (north), `DocsSidebar` (west), `DocsContent` (center), and `StatusBar` (south) in a `Border` layout. This plan adds a fifth region, `DocsMinimap`, in the `Border`'s `EAST` slot — a sibling of the scrolling content pane, not a child of it, so it never scrolls with the content.

Heading data does not exist anywhere today outside the rendered DOM: `Markdown` ([packages/lib/src/typescript/lib/component/display/Markdown.ts:441](packages/lib/src/typescript/lib/component/display/Markdown.ts#L441)) builds each heading's `id` internally in `appendHeading` and never exposes the list. This plan adds a small pure export, `extractMarkdownHeadings`, that computes the same `{ id, text, depth }` data straight from Markdown source text — reusing the exact id-generation logic `appendHeading` already uses, so the ids match what the rendered `<h1>`–`<h6>` elements get.

Click-to-navigate reuses the existing in-page-link mechanism verbatim: `DocsContent.onLinkClick`'s bare-`#fragment` branch already routes a heading-link click through `Router.navigate` ([packages/docs/src/shell/DocsContent.ts:312-314](packages/docs/src/shell/DocsContent.ts#L312-L314)), which lands back in `DocsShell.showPath` → `DocsContent.showPath` → `scrollToHeading`. The minimap calls `Router.navigate` the same way — no new scroll code.

---

## Architecture Decisions

### The minimap is a `Border` `EAST` region, not a `Position.FIXED` overlay

`DocsShell`'s outer container already uses the `Border` layout manager, which supports `EAST` alongside the `WEST` region `DocsSidebar` already occupies ([packages/lib/src/typescript/lib/layout/Border.ts:53](packages/lib/src/typescript/lib/layout/Border.ts#L53)). Adding `DocsMinimap` as a fifth `Border` region gives it exactly the two properties the request needs — a fixed position to the right of the content, immune to the content pane's own scrolling — with no new layout mechanism.[^not-fixed]

### `extractMarkdownHeadings` is a new pure export on `Markdown.ts`, not a DOM read

`Markdown` computes each heading's `id` during `appendHeading` from a per-render `headingIds` dedupe map ([packages/lib/src/typescript/lib/component/display/Markdown.ts:1051-1064](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1051-L1064)), but never stores or exposes the resulting list — the map is discarded once the render pass ends. This plan factors the slug-plus-dedupe step `appendHeading` already does into a shared private helper, `nextHeadingId`, and adds a new pure exported function, `extractMarkdownHeadings(source)`, that walks `marked`'s token tree the same way `appendBlockToken` does for headings and produces the same ids, without touching the DOM or waiting on `Markdown`'s deferred render lifecycle.[^pure-extraction]

### Click-to-navigate calls `Router.navigate`, mirroring the existing fragment-link handler

`DocsContent.onLinkClick` already turns a bare `#fragment` href click into `this._router.navigate(this._router.getPath() + '#' + href.slice(1))` ([packages/docs/src/shell/DocsContent.ts:312-314](packages/docs/src/shell/DocsContent.ts#L312-L314)), which round-trips through `DocsShell.showPath` and ends at `DocsContent.scrollToHeading`. A minimap row click calls `Router.navigate` the identical way. This keeps the URL, browser history, and the sidebar's route-reflection all in sync with a minimap click exactly as they already are with an in-page link click — no second scroll code path to keep in sync with the first.

### `DocsContent` exposes a new `"outlinechange"` custom event

`DocsMinimap` needs to know the current page's headings, but only `DocsContent` — which resolves and renders page source — has that data. This is a framework-custom event (state `DocsContent` derives, not a real DOM event), so it follows the `on`/`off`/`emit` + `ListenerBag` shape `Video` uses for its own re-emitted events ([packages/lib/src/typescript/lib/component/display/Video.ts:102](packages/lib/src/typescript/lib/component/display/Video.ts#L102), `on`/`off`/`emit` at lines 439-464). `DocsShell` subscribes with a stable named-handler field, mirroring `DocsContent`'s own `handleLinkClick` / `handleScrollToFragment` idiom ([packages/docs/src/shell/DocsContent.ts:72-77](packages/docs/src/shell/DocsContent.ts#L72-L77)).

### `DocsMinimap` mirrors `DocsSidebar`'s shape

`DocsMinimap` is a new `Panel` subclass in `packages/docs/src/shell/`, not a `packages/lib` component — nothing here is reusable outside this one app shell. It follows `DocsSidebar`'s constructor shape (`constructor(router: Router, options?: PanelOptions)`, a fixed `preferredSize.width` for its `Border` column) ([packages/docs/src/shell/DocsSidebar.ts:37-54](packages/docs/src/shell/DocsSidebar.ts#L37-L54)) and `DocsContent.showBlocks`'s dispose-then-empty-then-rebuild sequence for replacing its rows on every `setHeadings` call ([packages/docs/src/shell/DocsContent.ts:182-199](packages/docs/src/shell/DocsContent.ts#L182-L199)).

Each row is a [`Link`](packages/lib/src/typescript/lib/component/input/Link.ts) — a clickable, keyboard-activatable text component with its own `"action"` event, the same shape `DocsSidebar`'s selection wiring already leans on for click affordances elsewhere in the shell. Indentation per heading depth reuses `Tree`'s own per-level constant, `INDENT_PX = 16` ([packages/lib/src/typescript/lib/component/tree/Tree.ts:24](packages/lib/src/typescript/lib/component/tree/Tree.ts#L24)), so the minimap's nesting reads at the same visual scale as the sidebar's tree. Each row wraps rather than clips a long heading, the same fix `Markdown`'s own constructor applies to its prose column for the same reason — a narrow fixed-width column with unwrapped text overflows and clips ([packages/lib/src/typescript/lib/component/display/Markdown.ts:497-503](packages/lib/src/typescript/lib/component/display/Markdown.ts#L497-L503)).

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/display/Markdown.ts

export interface MarkdownHeading {
    id:    string;
    text:  string;
    depth: number;
}

export function extractMarkdownHeadings(source: string): MarkdownHeading[];
```

```typescript
// packages/lib/src/typescript/lib/component/display/index.ts (barrel additions)

export { extractMarkdownHeadings } from '~/component/display/Markdown.js';
export type { MarkdownHeading } from '~/component/display/Markdown.js';
```

```typescript
// packages/docs/src/shell/DocsContent.ts (additions)

class DocsContent extends Panel {
    on(event: "outlinechange", listener: (headings: MarkdownHeading[]) => void): this;
    off(event: "outlinechange", listener: (headings: MarkdownHeading[]) => void): this;
    protected emit(event: "outlinechange", headings: MarkdownHeading[]): void;
}
```

```typescript
// packages/docs/src/shell/DocsMinimap.ts (new)

class DocsMinimap extends Panel {
    constructor(router: Router, options?: PanelOptions);
    setHeadings(headings: MarkdownHeading[]): void;
}
```

`DocsMinimap` takes no `listeners` option — it has no `on()` surface of its own; it only consumes `Router` and `MarkdownHeading[]`.

---

## Internal Structure

`DocsMinimap` carries three private fields: `private readonly _router: Router;`, `private _headings: MarkdownHeading[] = [];` (the last list passed to `setHeadings`), and `private readonly _rows: Link[] = [];` (the currently-built row components, rebuilt on every `setHeadings` call).

`nextHeadingId` is extracted from `appendHeading` so both the DOM-building path and `extractMarkdownHeadings` compute identical ids from identical inputs:

```typescript
// Shared by appendHeading and extractMarkdownHeadings — the single place a
// heading's slug is deduped against ids already used earlier in the same
// render/extraction pass.
function nextHeadingId(text: string, headingIds: Map<string, number>): string {
    const slug = slugify(text);
    const seen = headingIds.get(slug) ?? 0;

    headingIds.set(slug, seen + 1);

    return seen === 0 ? slug : `${slug}-${seen}`;
}
```

`appendHeading`'s existing four lines that build `slug`/`seen`/`id` are replaced by one call: `const id = nextHeadingId(token.text, headingIds);`.

`extractMarkdownHeadings` walks the same block-token shapes `appendBlockToken` recurses into for headings — top-level headings, headings nested in a blockquote, and headings nested in a list item (a loose list item can contain a block-level heading token, the same case `appendListItem` recurses into via `appendBlockToken`) — so it finds every heading `appendBlockTokens` would actually render, not just the top-level ones:

```typescript
function collectHeadings(tokens: Token[], headingIds: Map<string, number>, out: MarkdownHeading[]): void {
    for (const token of tokens) {
        if (token.type === "heading") {
            const heading = token as Tokens.Heading;
            const depth = Math.min(Math.max(heading.depth, HEADING_MIN_DEPTH), HEADING_MAX_DEPTH);

            out.push({ id: nextHeadingId(heading.text, headingIds), text: heading.text, depth });
        } else if (token.type === "blockquote") {
            collectHeadings((token as Tokens.Blockquote).tokens, headingIds, out);
        } else if (token.type === "list") {
            for (const item of (token as Tokens.List).items) {
                collectHeadings(item.tokens, headingIds, out);
            }
        }
    }
}

export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
    const headings: MarkdownHeading[] = [];

    collectHeadings(lexer(source), new Map<string, number>(), headings);

    return headings;
}
```

`DocsContent.emitOutline` computes the full-page heading list by concatenating `extractMarkdownHeadings` over every `markdown` block, in document order, skipping `demo` blocks (a live demo's rendered content is not statically knowable):

```typescript
private emitOutline(blocks: DocBlock[]): void {
    const headings = blocks.flatMap((block) =>
        block.kind === 'markdown' ? extractMarkdownHeadings(block.source) : []);

    this.emit('outlinechange', headings);
}
```

Called from `showSource`, before `showBlocks`:

```typescript
private showSource(source: string): void {
    const blocks = splitBlocks(source);

    this.emitOutline(blocks);
    this.showBlocks(blocks);
    this.applyFragment(this._targetFragment);
}
```

`DocsMinimap.rebuild` disposes its previous rows, then builds one `Link` per heading, indented by depth:

```typescript
private rebuild(): void {
    for (const row of this._rows) {
        row.dispose();
    }

    this._rows.length = 0;
    this.removeAllComponents();

    for (const heading of this._headings) {
        const row = new Link(heading.text, {
            padding:   new Insets(0, 0, 0, (heading.depth - 1) * MINIMAP_INDENT_PX),
            listeners: { action: () => this.handleRowClick(heading.id) },
        });

        row.setWhiteSpace('normal');
        this._rows.push(row);
        this.addComponent(row);
    }

    this.scheduleLayout();
}

private handleRowClick(id: string): void {
    this._router.navigate(this._router.getPath() + '#' + id);
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/display/Markdown.ts`** — Extract `nextHeadingId(text, headingIds)` as a private module-level function (placed near `slugify`) and rewrite `appendHeading`'s id computation to call it. Behaviour must be unchanged: `npm run test -- Markdown` (in `packages/lib`) still passes with no edits to the existing test file.
2. Add `export interface MarkdownHeading { id: string; text: string; depth: number; }` and `export function extractMarkdownHeadings(source: string): MarkdownHeading[]` per `## Internal Structure` above, placed after `appendHeading`'s class definition ends (module scope, alongside `mapFenceLangToEditorId`).
3. **`packages/lib/src/typescript/lib/component/display/index.ts`** — Add the two barrel export lines from `## Public API`.
4. **`packages/lib/tests/component/display/Markdown.test.ts`** — Add a `describe('extractMarkdownHeadings', …)` block covering the cases in `## Expected Behaviour` below.
5. Run `npm run build:lib` (in `packages/lib`) — the docs app resolves `@jimka/typescript-ui` from `dist/`, so a stale `dist/` would silently hide every change below from the docs app.
6. **`packages/docs/src/shell/DocsContent.ts`** — Add `private readonly _listeners: ListenerBag<"outlinechange"> = new ListenerBag<"outlinechange">();` (mirrors `Video`'s `_listeners` field), the `on`/`off`/`emit` trio from `## Public API`, and `emitOutline` from `## Internal Structure`. Change `showSource` to build `blocks` once, call `emitOutline(blocks)`, then pass the same `blocks` into `showBlocks(blocks)` (replacing the current `this.showBlocks(splitBlocks(source))` call). Import `MarkdownHeading` and `extractMarkdownHeadings` from `@jimka/typescript-ui/component/display`, and `ListenerBag` from `@jimka/typescript-ui/core`.
7. **`packages/docs/src/shell/DocsMinimap.ts`** (new file) — Build `DocsMinimap` per `## Public API` and `## Internal Structure`: constructor takes `(router: Router, options?: PanelOptions)`, stores `_router`, sets up `layoutManager: VBox({ spacing: 2 })`, `autoScroll: 'y'`, and a fixed `preferredSize: { width: MINIMAP_WIDTH, height: 0 }` (mirror `DocsSidebar`'s `SIDEBAR_WIDTH` constant shape, with its own documented value — e.g. `220`, wide enough for a two-word heading at the deepest indent before wrapping). Define `MINIMAP_INDENT_PX = 16` as a module constant with a comment citing `Tree.INDENT_PX` as the value it matches. `setHeadings` stores the array and calls `rebuild()`.
8. **`packages/docs/src/shell/DocsShell.ts`** — Construct `this._minimap = new DocsMinimap(router, { backgroundColor: "#f6f6f7", border: { borderLeft: "1px solid var(--ts-ui-statusbar-border, rgb(220, 220, 220))" } })` (mirrors `_sidebar`'s own background/border options, mirrored on the opposite edge). Add a private stable field `handleOutlineChange: (headings: MarkdownHeading[]) => void = (headings) => this.onOutlineChange(headings);` and a private method `onOutlineChange(headings: MarkdownHeading[]): void { this._minimap.setHeadings(headings); }`, mirroring `DocsContent`'s own named-handler idiom. Call `this._content.on('outlinechange', this.handleOutlineChange)` in the constructor, after `_content` is constructed. Add `this.addComponent(this._minimap, { placement: Placement.EAST });` alongside the other four `addComponent` calls. Import `DocsMinimap` and `MarkdownHeading` (the latter from `@jimka/typescript-ui/component/display`).
9. Run `npm run typecheck` in both `packages/lib` and `packages/docs` — zero errors.
10. Run `npm test` in `packages/lib` (covers step 4) and `npm test` in `packages/docs` — no existing test touches `DocsContent`/`DocsShell`/`DocsSidebar` today (`grep -rln "DocsContent\|DocsShell\|DocsMinimap" packages/docs/tests` — expect zero matches before this step), so no regression risk there; this step only guards the lib-side heading extraction and the existing docs suite (`blocks.test.ts` et al.).
11. Manual verification per `## Verification` below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/index.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Create | `packages/docs/src/shell/DocsMinimap.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |

---

## Expected Behaviour

`extractMarkdownHeadings` (unit-testable, no DOM):

| Input | Output |
|---|---|
| `"# A\n\n## B\n"` | `[{ id: 'a', text: 'A', depth: 1 }, { id: 'b', text: 'B', depth: 2 }]` |
| `"## Overview\n\n## Overview\n"` | `[{ id: 'overview', ... }, { id: 'overview-1', ... }]` — same dedupe rule as `Markdown`'s existing "dedupes identical heading text" test |
| `"####### Too Deep\n"` | `[{ id: 'too-deep', text: 'Too Deep', depth: 6 }]` — clamps like `appendHeading` |
| `"> ## Quoted Heading\n"` | `[{ id: 'quoted-heading', text: 'Quoted Heading', depth: 2 }]` — found inside a blockquote |
| `""` or `"Just prose.\n"` | `[]` |

- The ids `extractMarkdownHeadings` produces for a given source string are byte-identical to the `id` attribute `Markdown` renders onto the corresponding `<h1>`–`<h6>` element for that same source (both go through `nextHeadingId`). Covered by comparing `extractMarkdownHeadings` output against `Markdown`'s existing DOM-id tests' fixtures.

`DocsContent` (unit-testable with the existing DOM test harness, mirroring `Markdown.test.ts`'s `installTestDOM` setup):

- Calling `showPath('/some-page', '')` on a page whose source has two headings fires `"outlinechange"` exactly once, with both headings in document order.
- A page whose source has no headings fires `"outlinechange"` with `[]`, not by skipping the event.
- A page built from `markdown`, `demo`, `markdown` blocks (per `splitBlocks`) yields a heading list that is the concatenation of the two `markdown` blocks' headings only, in document order — the `demo` block contributes nothing.
- Calling `showPath('/some-page', 'some-fragment')` a second time with the *same* path (a fragment-only navigation) does **not** fire `"outlinechange"` again — `showSource` (and therefore `emitOutline`) only runs on the re-render branch of `showPath`.

`DocsMinimap` (unit-testable with the DOM test harness):

- `setHeadings([{ id: 'a', text: 'A', depth: 1 }, { id: 'b', text: 'B', depth: 2 }])` builds two `Link` rows, added in order, the second indented `16`px more than the first (`(2-1) * 16`).
- A second `setHeadings` call disposes the previous rows before building the new ones — no leaked components across page navigations.
- `setHeadings([])` clears any previously shown rows and leaves the pane empty (not hidden — the column stays visible, just with nothing in it).
- Clicking (or pressing Enter on) a row for heading `id: 'usage'` while the router's current path is `/components/Button` calls `router.navigate('/components/Button#usage')` — matches `DocsContent.onLinkClick`'s bare-fragment branch (`router.getPath() + '#' + fragment`).

Manual verification only (real DOM geometry / visual, not exercised by the offline test harness):

- On a page with several headings, scrolling the content pane down leaves the minimap column visually fixed in place — it does not move or disappear.
- Clicking a minimap row scrolls the content pane so that heading sits at the top of the pane (the same visual result `scrollToHeading` already produces for an authored in-page link).
- The minimap column's background/border reads as part of the app chrome, matching the sidebar's own treatment on the opposite edge.

---

## Verification

1. `npm run typecheck` in `packages/lib` and in `packages/docs` — zero errors.
2. `npm test` in `packages/lib` — the new `extractMarkdownHeadings` tests and the existing `Markdown` suite both pass.
3. `npm test` in `packages/docs` — existing suite unaffected; add the `DocsContent`/`DocsMinimap` cases from `## Expected Behaviour` if the offline DOM harness supports it (per `Markdown.test.ts`'s pattern); note any case that harness can't cover as a manual check instead.
4. `npm run build:lib` in `packages/lib`, then `npm run dev` in `packages/docs` (per `project_dev_urls.md` — docs on `localhost:5173`) and manually exercise the three bullets under "Manual verification only" above on a real multi-heading page (e.g. an API reference page or a longer authored guide).
5. `npm run docs:api` in `packages/lib` — zero warnings, confirming the new `{@link}`-free JSDoc on `MarkdownHeading`/`extractMarkdownHeadings` doesn't introduce a broken-link warning.

---

## Documentation Impact

`extractMarkdownHeadings` and `MarkdownHeading` are new public exports from `@jimka/typescript-ui/component/display`. TypeDoc picks them up automatically from the barrel re-export (`docs:api`); no hand-written doc page references them elsewhere, so no cross-reference updates are needed. `DocsMinimap` and the `DocsContent.on('outlinechange', …)` surface are docs-app-internal (not part of the published package), so they carry no TypeDoc obligation — plain JSDoc for the implementer's own benefit is enough.

---

## Potential Challenges

- **Cross-block duplicate heading ids.** `Markdown`'s dedupe map is local to one render pass, i.e. one `DocBlock`. A page with two separate `markdown` blocks (split apart by a `demo` block) that each happen to contain the same heading text produces the same `id` twice in the DOM — a pre-existing limitation, not something this plan introduces or fixes. `extractMarkdownHeadings` reproduces it faithfully (each block gets its own fresh `headingIds` map, matching `buildBlock`'s one-`Markdown`-instance-per-block construction), so the minimap's behaviour matches whatever `scrollToHeading`'s existing `getElementById` lookup already does for that page (jumps to the first match). Do not attempt to dedupe across blocks — that would make the minimap's ids diverge from the DOM's real ids.
- **Long single-word headings.** Row wrapping (`setWhiteSpace('normal')`) handles ordinary multi-word overflow but not a single unbreakably long word — `Markdown`'s own prose column additionally sets `overflow-wrap: break-word` for exactly this case via its own `setElementCSSRule` (a `protected` method `DocsMinimap` cannot call on a `Link` it doesn't own). Accepted as a minor, low-probability cosmetic edge case for heading text; not fixed in this plan.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `appendHeading`, `slugify`, the token-walking shape `extractMarkdownHeadings` mirrors.
- [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts) — `showPath`/`showSource`/`onLinkClick`/`scrollToHeading`, the flow the minimap's click-to-navigate and outline data both plug into.
- [packages/docs/src/shell/DocsShell.ts](packages/docs/src/shell/DocsShell.ts) — the `Border` composition the new `EAST` region joins.
- [packages/docs/src/shell/DocsSidebar.ts](packages/docs/src/shell/DocsSidebar.ts) — the shape `DocsMinimap` mirrors (fixed-width `Panel` in a `Border` region, `constructor(router, options)`).
- [packages/lib/src/typescript/lib/component/display/Video.ts](packages/lib/src/typescript/lib/component/display/Video.ts) — the `on`/`off`/`emit` + `ListenerBag` shape `DocsContent`'s new `"outlinechange"` event follows.
- [packages/lib/src/typescript/lib/component/input/Link.ts](packages/lib/src/typescript/lib/component/input/Link.ts) — the row component.
- [packages/docs/src/content/blocks.ts](packages/docs/src/content/blocks.ts) — `DocBlock`/`splitBlocks`, which `emitOutline` consumes.
- [ARCHITECTURE.md](ARCHITECTURE.md) — "Positioning is always absolute" and the `Position.FIXED` carve-out list, which motivates the `Border`-region decision.

---

## Non-Goals

- **Active-heading highlighting.** The request is a clickable, always-visible heading list — not a scroll-position-driven "you are here" indicator. That is a natural follow-on but is not designed or implemented here.
- **Resizing or collapsing the minimap column.** `DocsSidebar`'s `WEST` region is a plain fixed-width, non-collapsible `Border` region (no `collapsible: true` constraint); the new `EAST` region matches that, with no gutter or collapse affordance.
- **Fixing the cross-block duplicate-heading-id limitation** described in `## Potential Challenges` — pre-existing, out of scope.
- **Extracting headings from live demo content.** `DocsDemo` blocks render arbitrary live widgets, not static Markdown; their content (if any looks like a heading) is not discoverable without executing them, and is not attempted here.

---

## Notes

[^not-fixed]: `Position.FIXED` in this framework is reserved for viewport-anchored, typically ephemeral overlays — `AnimatedDropdown`, `Popover`, `Notification`, `Dialog`, `DialogBackdrop` (see ARCHITECTURE.md, "Positioning is always absolute") — things that pop over the page's stacking context on demand and get dismissed. The minimap is the opposite: a persistent part of the page's own layout, always present, laid out alongside the content rather than above it. A `Border` `EAST` region already gives "doesn't scroll with the content pane" for free, since it is a sibling of the scrolling `CENTER` region rather than a descendant of it — no viewport-escaping behaviour is needed to satisfy "always visible, doesn't scroll away."

[^pure-extraction]: The alternative considered was reading the heading list back off the rendered DOM (e.g. querying every `<h1>`–`<h6>` inside `DocsContent`'s element after a page renders). That was rejected: `Markdown`'s render is deferred (construction stays JS-only; DOM is built at first render/layout, see `Markdown`'s own class doc), so `DocsContent` would need to wait for a layout flush before it could compute the outline, adding a timing dependency the pure, source-text-only approach doesn't need. Computing straight from the Markdown source also makes `extractMarkdownHeadings` trivially unit-testable with plain strings, no DOM harness required.

---

## Implementation Notes

- **`DocsMinimap`'s `VBox` needs `stretching: true`.** `## Internal Structure` specifies `layoutManager: VBox({ spacing: 2 })`. Built as written, each row sizes to its own unwrapped single-line preferred width instead of the panel's full content width — `stretching` defaults to `false` in `BoxLayout` (`packages/lib/src/typescript/lib/layout/BoxLayout.ts:111`). A short heading at a deep indent (e.g. "Usage", "Theming") then has less width than even one word needs, so `setWhiteSpace('normal')` wraps it character-by-character and the fixed-height row clips everything past the first two character-lines with a trailing ellipsis — confirmed live via a running `npm run dev` + Chrome DevTools check on `/components/Button`, which has both short and long headings. Fixed by passing `stretching: true` alongside `spacing: 2`, matching `DocsContent`'s own `VBox({ stretching: true, spacing: 0 })` for the identical reason (`## Architecture Decisions"`'s "wraps rather than clips" requirement). Re-verified live after the fix: every heading, short and long, renders fully wrapped with no clipping.

- **The `extractMarkdownHeadings` "clamps a too-deep heading" test case, as specified in `## Expected Behaviour`, does not hold.** The table gives `"####### Too Deep\n"` (7 `#`s) → `[{ id: 'too-deep', text: 'Too Deep', depth: 6 }]`. In practice `marked`'s ATX-heading tokenizer only recognizes 1–6 leading `#`s (CommonMark spec); a 7th `#` makes `lexer()` emit a `"paragraph"` token, not a `"heading"` token with `depth: 7` — confirmed directly against `marked`'s `lexer()`. So this input was never going to reach `appendHeading`'s depth-clamp branch either (the DOM render treats it as a `<p>`, not a clamped `<h6>`); there is no realistic Markdown source that produces a heading token outside `[1, 6]`, since the tokenizer itself won't emit one. The depth-clamp code in `collectHeadings` is kept as written (mirroring `appendHeading`'s own defensive clamp, per `## Internal Structure`), but the test was changed to assert the input yields `[]` — the same "not a heading" outcome the DOM path produces for it — rather than the plan's literal (unreachable) expectation.

- **`packages/docs`'s `node_modules/@jimka/typescript-ui` needed a manual symlink to this worktree's own `packages/lib`.** This worktree has no root-level `npm install` of its own; Node's module resolution walked up past `.worktrees/docs-header-minimap/` into the main tree's `node_modules`, which points at the *main tree's* `packages/lib/dist` — so `npm run typecheck` in `packages/docs` reported `extractMarkdownHeadings`/`MarkdownHeading` as missing even after this worktree's own `npm run build:lib`, until `packages/docs/node_modules/@jimka/typescript-ui` was symlinked directly to `../../packages/lib` (gitignored, not part of the diff). Matches the previously-documented "a server in `.worktrees/` resolves the package to the main tree's `packages/lib`" gotcha, now confirmed for `tsc` as well as a dev server.

- **`collectHeadings` needed a new helper, `inlineText`, not specified in `## Internal Structure`.** The plan's snippet puts `text: heading.text` into each `MarkdownHeading` — `heading.text` is `marked`'s *raw source substring* for the heading line, still carrying inline Markdown syntax (backticks, `**`, `[]()`, …), whereas `appendHeading`'s DOM render calls `appendInlineTokens(heading, token.tokens)`, which strips that syntax and renders plain formatted content. Built as the plan specified, `DocsMinimap`'s rows showed literal Markdown syntax for any heading with inline markup (confirmed live: `/concepts/dom-seams`'s "DOM seams (`DOMSink` / `DOMSource`)" heading rendered with visible backticks) — a real corpus case (32 headings across the authored docs carry inline markup), not a hypothetical. Fixed by adding `inlineText(tokens)`, a pure recursive flattener over a heading's inline token tree (`text`/`strong`/`em`/`codespan`/`link`, mirroring the cases `appendInlineToken` handles), and using it for `MarkdownHeading.text` while `nextHeadingId` continues to slugify the raw `heading.text` — the id-parity property (`## Expected Behaviour`'s last bullet) is unaffected, since `appendHeading` never changed what it slugifies. Verified by rendering 9 heading sources spanning every inline case (`strong`, `em`, `codespan`, `link`, nested `link`-in-`strong`, `del`, `image`, `br`, `escape`, an HTML entity) through `Markdown` and comparing each against `extractMarkdownHeadings`'s output — byte-identical in every case.
