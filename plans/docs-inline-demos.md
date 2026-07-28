# Inline Live Demos in the Docs App — Implementation Plan

## Overview

The docs app renders each page as a single `Markdown` component inside a `Fit` layout ([packages/docs/src/shell/DocsContent.ts:79-84](packages/docs/src/shell/DocsContent.ts#L79)). This plan replaces that with an ordered list of **blocks** — prose segments and live demo blocks — stacked in a `VBox` inside the same scrolling pane, so a real, interactive framework component can sit between two paragraphs of a documentation page.

This plan builds only the machinery: the authoring marker, the demo registry, the demo block's chrome, and the teardown path. It ships exactly one reference demo to prove the machinery end to end. Writing the per-component demo catalogue is a separate plan.

Everything lives in `packages/docs`, plus one marker block added to the corpus page [packages/lib/docs/components/Button.md:3](packages/lib/docs/components/Button.md#L3). **No library code changes** — `Markdown` already measures its own prose height and reports it through `getMinSize` / `getPreferredSize` ([packages/lib/src/typescript/lib/component/display/Markdown.ts:455-489](packages/lib/src/typescript/lib/component/display/Markdown.ts#L455)), which is what makes a stack of prose segments size correctly inside a scroll host.[^no-lib-change]

---

## Architecture Decisions

### A page is an ordered list of blocks, split at render time

`DocsContent.showSource` stops calling `setMarkdown` on one long-lived `Markdown` and instead splits the source into blocks, then builds one child component per block into a `VBox`.[^why-blocks]

The split happens inside `showSource` ([packages/docs/src/shell/DocsContent.ts:164-167](packages/docs/src/shell/DocsContent.ts#L164)), which is the tail every one of `showPath`'s five branches already funnels through. `pages.ts` is not touched: authored pages, cached API pages, fetched API pages, the not-found view, and the fetch-error view all take the same path, and a source with no markers yields exactly one markdown block.[^split-at-showsource]

### The authoring marker is a pair of HTML comments wrapping a fallback

A demo is marked in the `.md` source by an open marker, a **fallback region**, and a close marker — each marker a line containing only an HTML comment:

```markdown
<!-- demo: button-basic -->
> **Live demo** — two `Button`s side by side, interactive in the documentation app.
> [Open the Button page](https://jimka.github.io/typescript-ui/components/Button)
<!-- /demo -->
```

Both marker lines must start at column 0 and must be the whole line. Every other Markdown consumer — GitHub, npm, a CommonMark renderer — hides HTML comments and renders the fallback, so the shipped corpus under `packages/lib/docs/` reads as a complete document everywhere. The docs app does the reverse: it drops the fallback and substitutes the live demo.[^why-comment]

The fallback is required rather than decorative. A demo will usually sit under its own heading (`## Example`), and with an invisible marker alone that heading is followed by nothing at all on GitHub and npm — a visibly broken page, which is worse than the demo simply being absent.[^why-fallback]

The close marker is mandatory. "No placeholder" is written as an empty region — an open marker on one line, the close marker on the next — rather than as a second, unpaired grammar for the same construct.

| Line | Marker? | Why |
|---|---|---|
| `<!-- demo: button-basic -->` | opens | id matches `[a-z0-9-]+` |
| `<!--demo:button-basic-->` | opens | surrounding whitespace is optional |
| `<!-- /demo -->` | closes | ends the fallback region |
| `<!--/demo-->` | closes | surrounding whitespace is optional |
| `> <!-- demo: button-basic -->` | no | not at column 0 (a blockquote line) |
| `<!-- demo: Button Basic -->` | no | id charset is lowercase, digits, hyphen |
| `<!-- a note -->` | no | not a `demo:` comment |
| `Text <!-- demo: x --> more` | no | the comment is not the whole line |

Two constraints on what a fallback may contain, both forced by the existing corpus guard:

- **No heading.** `content-constructs.test.ts`'s `headingIds` reads raw source ([packages/docs/tests/content-constructs.test.ts:110-123](packages/docs/tests/content-constructs.test.ts#L110)), so a heading inside a dropped region would satisfy a `](#anchor)` link in the guard while the docs app never renders that heading — the guard would then *accept* a link that dangles in the app.
- **Links must be absolute `https://` URLs.** The fallback is only ever read where the docs app's routes do not exist, so a root-relative `/components/Button` is dead exactly where the fallback matters. These links never reach `linkResolver`, which is correct.

### A demo is a module in `packages/docs/src/demos/`, resolved by two eager globs

The marker id `button-basic` resolves to `packages/docs/src/demos/button-basic.ts`. That module exports a `height` and a `create()` factory. A registry module globs the directory twice — once for the modules, once with `?raw` for their source text — mirroring the eager `?raw` glob `pages.ts` already uses for the corpus ([packages/docs/src/content/pages.ts:42-46](packages/docs/src/content/pages.ts#L42)).

Both globs are eager, so resolving a demo is synchronous.[^eager-globs]

### The source shown is the source executed

The "show source" panel renders the `?raw` text of the very module whose `create()` built the live component, wrapped in a ` ```typescript ` fence and passed to a `Markdown` component. There is no second copy of the code to drift.

This matters because nothing in the repo compiles the fenced code in `packages/lib/docs/**/*.md`. `packages/lib`'s `typecheck` script compiles `tsconfig.lib.json` (source only) and `docs:api` runs TypeDoc over source; no script extracts or compiles a fence.[^fences-untypechecked] A demo module, by contrast, sits under `packages/docs/src` and is compiled by `npm -w packages/docs run typecheck`.

### The demo declares its own live-area height

Each demo module exports `height: number`, the pixel height of its live area. `DocsDemo` applies it as both the `minSize.height` and the `preferredSize.height` of the panel holding the live component.[^why-declared-height]

### Every block is disposed on navigation, then the pane is emptied

`showBlocks` calls `dispose()` on each outgoing block, clears its tracking array, calls `removeAllComponents()`, and only then builds the new blocks. This is the exact order `MenuBar.setMenus` uses ([packages/lib/src/typescript/lib/component/menubar/MenuBar.ts:145-163](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L145)) and that `Menu.rebuildPersistentItems` repeats ([packages/lib/src/typescript/lib/overlay/Menu.ts:900-913](packages/lib/src/typescript/lib/overlay/Menu.ts#L900)).

That dispose-then-empty order is load-bearing: `removeAllComponents` does **not** dispose ([packages/lib/src/typescript/lib/core/Component.ts:4987-4995](packages/lib/src/typescript/lib/core/Component.ts#L4987)), and `dispose()` does not unparent, so calling only one of the two leaks either the component tree or its DOM element, stylesheet rules, and theme subscriptions.[^dispose-order]

### A demo block stops the docs app's link interception at its own boundary

`DocsContent` intercepts clicks on `<a>` elements anywhere in its subtree ([packages/docs/src/shell/DocsContent.ts:239-293](packages/docs/src/shell/DocsContent.ts#L239)). A demo may legitimately contain an `<a>` — a `Link` component, or a nested `Markdown`. `DocsDemo` marks its own element with `data-docs-demo="true"`, and `closestAnchor`'s upward walk returns `null` the moment it crosses an element carrying that attribute.[^why-not-stop]

A click inside a demo therefore reaches the demo's own components normally and never drives the docs router.

### Fragment scrolling is unchanged

`applyFragment` / `onScrollToFragment` / `scrollToHeading` ([packages/docs/src/shell/DocsContent.ts:179-322](packages/docs/src/shell/DocsContent.ts#L179)) need no edit. `scrollToHeading` looks the id up document-wide, rejects a hit outside the pane, and computes the scroll delta from rects — none of which cares how many components the page is made of. `onScrollToFragment`'s `this.flushLayout()` recurses into every displayed descendant, so every prose block has measured its height before the scroll offset is computed.

One consequence needs guarding: `Markdown` dedupes repeated heading slugs per render pass ([packages/lib/src/typescript/lib/component/display/Markdown.ts:665-680](packages/lib/src/typescript/lib/component/display/Markdown.ts#L665)), and each block is now its own render pass. On a page split into blocks, two identical heading texts in different blocks would both claim the bare slug. A corpus test forbids a repeated heading slug on any page carrying a demo marker.[^slug-guard]

### `_requestToken` keeps its current job

`_requestToken` ([packages/docs/src/shell/DocsContent.ts:57](packages/docs/src/shell/DocsContent.ts#L57)) still guards only the API-page fetch. Because both demo globs are eager, `showBlocks` is fully synchronous: it runs inside whichever `showPath` branch called it, after that branch's token check. No demo can be constructed on behalf of a superseded navigation.

---

## Public API

No library (`packages/lib`) export changes. The symbols below are new exports of the private `packages/docs` package.

```typescript
// packages/docs/src/content/blocks.ts

/** Matches a demo's open marker line, capturing its id. */
export const DEMO_OPEN: RegExp;

/** Matches a demo's close marker line, which ends its fallback region. */
export const DEMO_CLOSE: RegExp;

/** One piece of a documentation page: a run of prose, or a live demo. */
export type DocBlock =
    | { kind: 'markdown'; source: string }
    | { kind: 'demo';     id: string };

/**
 * Splits a page's Markdown source into its ordered blocks. The fallback
 * region between a demo's open and close marker is dropped: it exists for
 * renderers that cannot run the demo, and the app renders the demo instead.
 */
export function splitBlocks(source: string): DocBlock[];
```

```typescript
// packages/docs/src/content/demos.ts
import type { Component } from '@jimka/typescript-ui/core';

/** The shape every module in `src/demos/` must export. */
export interface DemoModule {
    /** Pixel height of the demo's live area. */
    height: number;
    /** Builds the demo's component tree. Called once per page render. */
    create(): Component;
}

/** A resolved demo: its factory module plus that module's own source text. */
export interface DemoEntry {
    module: DemoModule;
    source: string;
}

/** Resolves a marker id to its demo, or `null` when no module matches. */
export function getDemo(id: string): DemoEntry | null;

/** Every registered demo id, sorted. */
export function getDemoIds(): string[];

/** Markdown shown in place of a demo whose id resolves to no module. */
export function missingDemoSource(id: string): string;
```

```typescript
// packages/docs/src/shell/DocsDemo.ts
import { Panel } from '@jimka/typescript-ui/core';
import type { PanelOptions } from '@jimka/typescript-ui/core';

class DocsDemo extends Panel {
    constructor(entry: DemoEntry, options?: PanelOptions);
}

const DocsDemoCallable = callable(DocsDemo);
type  DocsDemoCallable = DocsDemo;
export {
    DocsDemo         as _DocsDemo,
    DocsDemoCallable as DocsDemo,
};
```

```typescript
// packages/docs/src/demos/button-basic.ts — the shape every demo module follows
import type { Component } from '@jimka/typescript-ui/core';

export const height: number = 64;
export function create(): Component;
```

---

## Internal Structure

### `splitBlocks`

Scan the source line by line. A non-marker line appends to the current prose buffer. An open-marker line flushes the buffer (dropping it when it holds only whitespace), pushes a demo block, then consumes and discards every line up to and including the close marker.

```typescript
const DEMO_OPEN  = /^<!--\s*demo:\s*([a-z0-9-]+)\s*-->$/;
const DEMO_CLOSE = /^<!--\s*\/demo\s*-->$/;
```

That inner consume loop is the same shape `expandContainers` already uses for a `:::` body ([packages/docs/src/content/containers.ts:40-45](packages/docs/src/content/containers.ts#L40)) — scan to the closing delimiter, then step past it — and it inherits the same unterminated-open behaviour: the region runs to end of source. A corpus test forbids that (case 20), so an author who omits the close marker fails a test rather than silently losing the tail of a page.

A close marker with no open before it is not a marker at all — it stays in the prose buffer, where the renderer hides it as an ordinary comment.

Worked example — input on the left, blocks on the right:

| Input lines | Blocks |
|---|---|
| `# Button` / *blank* / `Intro.` / *blank* / `<!-- demo: button-basic -->` / `> Live demo` / `<!-- /demo -->` / *blank* / `## Usage` | `markdown "# Button\n\nIntro.\n"`, then `demo "button-basic"`, then `markdown "\n## Usage"` — the `> Live demo` line appears in neither |
| `Just prose.` | `markdown "Just prose."` (byte-identical) |
| `<!-- demo: a -->` / `<!-- /demo -->` / `<!-- demo: b -->` / `<!-- /demo -->` | `demo "a"`, then `demo "b"` — no empty prose block between |

A source with no marker yields exactly one markdown block whose `source` is byte-identical to the input, mirroring `expandContainers`'s byte-identical guarantee for source with no `:::` ([packages/docs/src/content/containers.ts:19-53](packages/docs/src/content/containers.ts#L19)).

Note the pass order: `expandContainers` runs first, in `pages.ts` ([packages/docs/src/content/pages.ts:81](packages/docs/src/content/pages.ts#L81)), so `splitBlocks` sees container-expanded source. A `::: tip` inside a fallback region is therefore already a blockquote by the time it is discarded — harmless, since the region is dropped whole.

### `DocsContent.showBlocks`

```typescript
private showBlocks(blocks: DocBlock[]): void {
    for (const block of this._blocks) {
        block.dispose();
    }

    this._blocks.length = 0;
    this.removeAllComponents();

    for (const block of blocks) {
        this._blocks.push(this.buildBlock(block));
    }

    for (const component of this._blocks) {
        this.addComponent(component);
    }

    this.scheduleLayout();
}
```

`buildBlock` returns `new Markdown(block.source, { linkResolver: this.resolveLink })` for a prose block. For a demo block it resolves the id: a hit becomes `new DocsDemo(entry)`, a miss becomes `new Markdown(missingDemoSource(block.id))`.

### `DocsDemo`

A `Panel` laid out by `VBox({ stretching: true })` with three children, in order. It keeps `BoxLayout`'s default 5px spacing — that is the block's own internal chrome gap, and is unrelated to the `spacing: 0` the pane's outer `VBox` uses between blocks.

| Child | What it is | Constraint |
|---|---|---|
| `_stage` | `Panel` with `Fit()`, `autoScroll: 'both'`, a border, and `minSize`/`preferredSize` height from `entry.module.height`; holds `entry.module.create()` | (none — stretched) |
| `_toggle` | `ToggleButton('Show source')` | `{ anchor: AnchorType.EAST }` |
| `_source` | `Markdown` holding the fenced module source, `displayed: false` | (none — stretched) |

`anchor: AnchorType.EAST` is per-child cross-axis align-self: it overrides the box's global `stretching` for that one child, so the button keeps its natural width and pins to the column's right edge ([packages/lib/src/typescript/lib/layout/LayoutConstraints.ts:38-48](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L38)).

Two module-level label constants carry the button's two states:

```typescript
const SHOW_SOURCE_LABEL = "Show source";
const HIDE_SOURCE_LABEL = "Hide source";
```

The toggle handler, plus the two stable references it needs (the same class-property idiom `DocsContent` uses for `handleLinkClick`):

```typescript
private readonly handleToggleSource:  () => void = () => this.onToggleSource();
private readonly handleSourceMeasured: () => void = () => { this.notifyIntrinsicSizeChanged(); };

private onToggleSource(): void {
    const shown = this._toggle.isSelected();

    this._source.setDisplayed(shown);
    this._toggle.setText(shown ? HIDE_SOURCE_LABEL : SHOW_SOURCE_LABEL);
    this.notifyIntrinsicSizeChanged();

    Component.afterNextLayout(this.handleSourceMeasured);
}
```

Two relays are needed, not one. `setDisplayed` neither schedules a layout nor tells the parent the block now wants a different height ([packages/lib/src/typescript/lib/core/Component.ts:1777-1794](packages/lib/src/typescript/lib/core/Component.ts#L1777)), so the first `notifyIntrinsicSizeChanged` starts the pass. But the source view's prose height is only measured once it has actually laid out, and that measure schedules *this block's* layout, not the pane's ([packages/lib/src/typescript/lib/component/display/Markdown.ts:559-565](packages/lib/src/typescript/lib/component/display/Markdown.ts#L559)). `handleSourceMeasured` — a stable reference calling `notifyIntrinsicSizeChanged()` again — runs after that flush and folds the measured height into the pane's scroll extent.

---

## Ordered Implementation Steps

1. **Create `packages/docs/src/content/blocks.ts`.** Define `DocBlock`, the `DEMO_OPEN` and `DEMO_CLOSE` regexes, and `splitBlocks`. Lead the file with a module header comment documenting the paired marker syntax, why the delimiters are HTML comments, why the fallback region exists and is dropped, and the two authoring constraints on its contents (no heading, absolute links only) — mirroring the header of [packages/docs/src/content/containers.ts:1-7](packages/docs/src/content/containers.ts#L1), which is where the `:::` authoring syntax is documented today.
   *Check:* `npm -w packages/docs run typecheck` passes.

2. **Create `packages/docs/tests/blocks.test.ts`** covering the `splitBlocks` cases in `## Expected Behaviour` (1-13). Run it before step 3 exists — it must pass against step 1 alone.
   *Check:* `npm -w packages/docs test -- blocks` green.

3. **Create `packages/docs/src/demos/button-basic.ts`.** Export `height: number = 64` (with a comment saying it is one row of default-height buttons plus room around the frame) and `create(): Component` building a `Panel({ layoutManager: HBox(), components: [Button('Save'), Button('Cancel')] })`. Construct nothing at module scope — only inside `create()`.
   *Check:* `npm -w packages/docs run typecheck` passes.

4. **Create `packages/docs/src/content/demos.ts`.** Two eager globs over `'../demos/*.ts'` — one plain (module namespaces, cast to `Record<string, DemoModule>` the way `pages.ts` casts its raw glob), one with `{ query: '?raw', import: 'default' }`. Key both by the file's basename without `.ts`. Export `DemoModule`, `DemoEntry`, `getDemo`, `getDemoIds`, `missingDemoSource`.
   *Check:* `npm -w packages/docs run typecheck` passes; step 6's test exercises it.

5. **Add the marker block to `packages/lib/docs/components/Button.md`,** after the opening paragraph (currently line 3) and before `## Usage`, separated from both by a blank line. It is the worked example every later demo is authored against, so write the full paired form with a real fallback:

   ```markdown
   <!-- demo: button-basic -->
   > **Live demo** — two `Button`s side by side, interactive in the documentation app.
   > [Open the Button page](https://jimka.github.io/typescript-ui/components/Button)
   <!-- /demo -->
   ```

   This lands before the registry test so that test is never knowingly red.
   *Check:* `npm -w packages/docs test` still green — the existing corpus guards must not trip on the comments or the blockquote. Confirm in a Markdown preview that only the blockquote is visible (case 29).

6. **Create `packages/docs/tests/demos.test.ts`** covering cases 14-22. It globs the corpus independently — the same pattern `content-constructs.test.ts` uses ([packages/docs/tests/content-constructs.test.ts:7-11](packages/docs/tests/content-constructs.test.ts#L7)) — so the corpus↔registry bijection is a real cross-check. Cases 20-22 walk each page's lines with the same two regexes `blocks.ts` exports, so the guard and the splitter cannot disagree about what a marker is.
   *Check:* `npm -w packages/docs test` green, including cases 16 and 17 in both directions.

7. **Create `packages/docs/src/shell/DocsDemo.ts`** per `## Internal Structure`. Wrap with `callable()` on export, as `DocsContent` and `DocsShell` do. Call `this.setDataAttribute('docs-demo', 'true')` in the constructor body. Wire the toggle through the options `listeners: { action: this.handleToggleSource }` bag with a named class-property reference, mirroring `DocsContent`'s `handleLinkClick` idiom ([packages/docs/src/shell/DocsContent.ts:65](packages/docs/src/shell/DocsContent.ts#L65)).
   *Check:* `npm -w packages/docs run typecheck` passes.

8. **Rewrite the render path in `packages/docs/src/shell/DocsContent.ts`.**
   - Swap the `Fit()` default for `VBox({ stretching: true, spacing: 0 })` in the `super(...)` call, and drop the now-unused `Fit` import. `spacing: 0` because each `Markdown` segment already carries the browser's default paragraph margins inside its measured height, so any box spacing would double the gutter between blocks.
   - Replace the `_markdown` field with `private readonly _blocks: Component[] = [];` and delete its construction from the constructor. `Event.addSubtreeListener` stays.
   - Change `showSource` to `this.showBlocks(splitBlocks(source));` followed by the unchanged `this.applyFragment(this._targetFragment);`.
   - Add `showBlocks` and `buildBlock` per `## Internal Structure`.
   - In `closestAnchor`, return `null` as soon as the walk reaches an element with `data-docs-demo` — check that before the `A` tag test.
   *Check:* `grep -n '_markdown' packages/docs/src/shell/DocsContent.ts` — expect zero matches. `npm -w packages/docs run typecheck` passes.

9. **Build and exercise.** `npm run build:lib`, then `npm run docs:dev`, then walk `## Verification`'s manual checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/docs/src/content/blocks.ts` |
| Create | `packages/docs/src/content/demos.ts` |
| Create | `packages/docs/src/demos/button-basic.ts` |
| Create | `packages/docs/src/shell/DocsDemo.ts` |
| Create | `packages/docs/tests/blocks.test.ts` |
| Create | `packages/docs/tests/demos.test.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/lib/docs/components/Button.md` |

---

## Expected Behaviour

Cases 1-22 are unit-testable in `packages/docs/tests/`. Cases 23-29 need a browser: `packages/docs` has no component tests at all, because its `shell/` modules construct components at import time and need a DOM — a split the package documents in [packages/docs/src/content/notFound.ts:1-6](packages/docs/src/content/notFound.ts#L1).

**`splitBlocks`**

1. Source with no marker yields exactly one `markdown` block whose `source` is byte-identical to the input.
2. A marker pair as the first lines yields a single `demo` block — the empty leading prose segment is dropped.
3. Prose, marker pair, prose yields three blocks in that order, prose segments keeping their own text.
4. Two adjacent marker pairs yield two `demo` blocks with no empty `markdown` block between them.
5. The fallback region is dropped: its text appears in no block's `source`, and the prose block following the close marker starts at the line after it.
6. An empty fallback region (open marker immediately followed by close marker) yields the same blocks as case 5 minus the dropped text.
7. A multi-line fallback containing blank lines, a blockquote, and a fenced block is dropped whole — the fence's contents never leak into a prose block.
8. `> <!-- demo: x -->` and `  <!-- demo: x -->` stay inside the prose block — a marker must start at column 0. The same holds for an indented `<!-- /demo -->`, which therefore does *not* close a region.
9. `<!-- demo: Button Basic -->` stays prose — the id charset is `[a-z0-9-]+`.
10. `<!-- unrelated -->` and `Text <!-- demo: x --> more` stay prose.
11. A `<!-- /demo -->` with no open marker before it stays prose.
12. An unterminated open marker consumes the rest of the source: the demo block is emitted and no prose block follows it. (Documented, not desirable — case 20 forbids it in the corpus.)
13. An unknown id still yields a `demo` block: resolution belongs to the registry, not the splitter.

**Registry and corpus guards**

14. `getDemo('button-basic')` returns an entry whose `module.height` is a number, whose `module.create` is a function, and whose `source` contains `export function create`.
15. `getDemo('no-such-demo')` returns `null`.
16. Every `<!-- demo: … -->` marker in the corpus resolves through `getDemo`.
17. Every id in `getDemoIds()` appears in at least one corpus marker.
18. No page containing a marker has two headings that slugify to the same id.
19. `missingDemoSource('x')` contains `x` and names the missing demo.
20. Every corpus page's open and close markers balance, in order: no close before an open, no two opens in a row, and none left open at end of page.
21. No fallback region in the corpus contains a heading line (`^#{1,6} `) — it would enter `content-constructs.test.ts`'s `headingIds` while never rendering in the app.
22. Every link inside a corpus fallback region is an absolute `https://` URL, never a root-relative docs route.

**Live behaviour (manual)**

23. `/components/Button` renders the intro paragraph, then a bordered live area holding two working buttons, then `## Usage` — in that order, with no gap large enough to read as a break in the prose, and with no trace of the fallback's placeholder text.
24. Clicking a button inside the demo does nothing to the URL and does not re-render the page.
25. "Show source" reveals the demo module's TypeScript inside a code block, relabels itself "Hide source", and grows the pane's scrollbar; clicking again collapses it and shrinks the scrollbar back.
26. Loading `/components/Button#theming` directly scrolls to the Theming heading, with the demo rendered above it.
27. Navigating `/components/Button` → `/components/Label` → back, ten times, leaves the document's element count and total CSS-rule count flat.
28. A prose link on the page (e.g. `[Button](/api/component/button/classes/Button)`) still routes client-side, with no full page reload.

**Fallback rendering (manual, outside the app)**

29. `packages/lib/docs/components/Button.md` in a plain CommonMark renderer — VS Code's Markdown preview, and GitHub once pushed — shows the placeholder with both comment lines hidden, and its link opens the published Button page.

---

## Verification

Run from the repo root, in order:

```bash
npm run build:lib                     # packages/docs resolves @jimka/typescript-ui to dist/
npm -w packages/docs run typecheck
npm -w packages/docs test             # cases 1-22
npm run build:docs
```

Then `npm run docs:dev` and open `http://localhost:5173/typescript-ui/components/Button` for cases 23-26 and 28. Open `packages/lib/docs/components/Button.md` in a Markdown preview for case 29.

**Leak check (case 27).** In DevTools, with the Button page showing:

```js
const snap = () => [
    document.querySelectorAll('*').length,
    [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0),
];
```

Record `snap()`, navigate away and back ten times through the sidebar, record `snap()` again. Both numbers must match the first reading. A rising CSS-rule count is the signature of a component held in a field and never disposed; a rising element count is the signature of a missing `removeAllComponents`. This project has shipped both bugs before, so treat a non-flat reading as a blocker, not a rounding artefact.

Also confirm the corpus guard still passes untouched — both markers are HTML comments, and `content-constructs.test.ts`'s raw-HTML assertion matches only `<tag>` forms, never `<!--`:

```bash
npm -w packages/docs test -- content-constructs
```

---

## Documentation Impact

No library export changes, so no TypeDoc, barrel, or `packages/lib/docs/**` page changes beyond the single marker block in `packages/lib/docs/components/Button.md`. `packages/lib/llms.txt` is unaffected — it indexes library capabilities, and none change.

The marker syntax, the fallback region, and the two constraints on a fallback's contents are documented in `packages/docs/src/content/blocks.ts`'s module header. A module header is where this repo documents docs-app authoring syntax: `containers.ts`'s header is the only documentation of the `:::` container transform.

---

## Potential Challenges

- **A demo module's `create()` throws and blanks the page.** No `try`/`catch` is added: a throwing factory is a code bug, caught by review and by the demo appearing broken the first time it is opened. Swallowing it would hide the bug from the author. A *missing* id is different — it is a mismatch between two independently edited artefacts, so it renders `missingDemoSource` and fails case 16.
- **A fallback drifts out of step with the demo it stands in for.** Nothing can check that prose describes a component tree, and generating the fallback from the module was rejected (see [^why-fallback]). The mitigation is to keep fallbacks short and structural — what the demo shows, plus a link — rather than describing behaviour that will change. A one-line fallback that says the demo exists never goes stale; a paragraph enumerating its buttons does.
- **Every demo is bundled eagerly into the docs app.** With one demo this is noise; with a full catalogue the docs bundle grows to include most of the library. Revisit lazy loading when the catalogue lands, not here.
- **A demo whose own content minimum exceeds its declared `height` makes the stage taller.** That is the framework's size contract working correctly (a manager must never compress a child below its minimum). The remedy is to raise `height` or give the demo's root a smaller minimum — not to fight the layout.
- **Rebuilding every block on navigation costs more than the old `setMarkdown`.** A page is a handful of blocks and navigation is user-paced; if a very long API page ever measurably regresses, the fix is to reuse a prose block when the incoming page has the same single-block shape, which the block list makes easy to add later.

---

## Critical Files

- [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts) — the file being rewritten; read `showPath`'s five branches, `_requestToken`, `applyFragment`, and `closestAnchor` in full before editing.
- [packages/docs/src/content/pages.ts:42-46](packages/docs/src/content/pages.ts#L42) — the eager `?raw` glob and the `as Record<string, string>` cast the demo registry mirrors.
- [packages/docs/src/content/containers.ts](packages/docs/src/content/containers.ts) — the precedent for a corpus authoring syntax transformed in the app, and for documenting it in a module header.
- [packages/docs/src/content/notFound.ts:1-6](packages/docs/src/content/notFound.ts#L1) — the documented `content/` (pure, testable) versus `shell/` (component-building, untestable) split that decides where each new module goes.
- [packages/lib/src/typescript/lib/component/menubar/MenuBar.ts:145-163](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L145) — the dispose-then-`removeAllComponents`-then-rebuild order `showBlocks` copies.
- [packages/lib/src/typescript/lib/component/display/Markdown.ts:426-565](packages/lib/src/typescript/lib/component/display/Markdown.ts#L426) — `setMarkdown`, the size reports, and `measureContentHeight`'s parent-scheduling behaviour that forces the second relay in `onToggleSource`.
- [packages/lib/src/typescript/lib/layout/VBox.ts:217-293](packages/lib/src/typescript/lib/layout/VBox.ts#L217) — `computeTotalMinSize` and `doLayout`; this is what turns the stacked blocks' minimums into the pane's scroll extent.
- [packages/lib/src/typescript/lib/layout/LayoutConstraints.ts:38-48](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L38) — per-child cross-axis `anchor` as align-self, used to right-align the toggle.
- [packages/docs/tests/content-constructs.test.ts](packages/docs/tests/content-constructs.test.ts) — the corpus-guard test style the new marker tests follow, and the raw-HTML assertion the marker must not trip.
- [ARCHITECTURE.md](ARCHITECTURE.md) — absolute positioning, the size-constraint contract, typed setters, `callable()` export, and the rule that a component never listens on another component through `Event`.

---

## Non-Goals

- **Writing the demo catalogue.** Exactly one reference demo ships here, to prove the machinery. Per-component demos are a separate plan.
- **A standalone gallery route.** Demos are inline in the existing pages; that placement is settled.
- **Lazy demo loading.** Eager globs keep block construction synchronous, which is what keeps `_requestToken`'s job unchanged.
- **Syntax highlighting the shown source.** The fence renders through the same `Markdown` viewer as every other code block on the page, so it matches the surrounding prose for free. Pulling `CodeEditor` into the docs bundle to highlight a read-only panel is not worth the weight.
- **Editing or re-running a demo in the page.** The source panel is read-only.
- **Screenshot fallbacks.** A rendered image of the demo would be a richer placeholder, but `content-constructs.test.ts:158` fails any corpus page containing `![…](…)`, so it would mean relaxing a guard — and a checked-in screenshot silently rots as the component and theme change. The fallback stays text.
- **Generating the fallback from the demo module.** A script that materialises placeholder prose into the corpus would need its own up-to-date check and a second authoring path. One hand-written blockquote per demo is cheaper than the generator that would keep it honest.
- **Any change to the library's code or public API** (`packages/lib/src`, its barrels, its TypeDoc config). The one file touched under `packages/lib` is the Markdown corpus page `docs/components/Button.md`. If a library change turns out to be unavoidable, stop and re-plan rather than widening a library API mid-implementation.

---

## Notes

[^no-lib-change]: Four library capabilities this plan needs already exist and are public: `Component.dispose()` ([Component.ts:716](packages/lib/src/typescript/lib/core/Component.ts#L716)), `Component.notifyIntrinsicSizeChanged()` ([Component.ts:5310](packages/lib/src/typescript/lib/core/Component.ts#L5310)), `Component.afterNextLayout()` ([Component.ts:5335](packages/lib/src/typescript/lib/core/Component.ts#L5335)), and `Markdown`'s width-dependent height measurement. `VBox`'s `computeTotalMinSize` already sums child minimums for a scrolling host, and `Markdown.getMinSize` already reports `{ width: 0, height: measured }`, so a column of prose segments grows a `Panel` with `autoScroll: 'y'` exactly as one long `Markdown` does today. Nothing was found that the library cannot express.

[^why-blocks]: The framework is retained-mode: every `Component` is absolutely positioned and sized by a `LayoutManager`, and `Markdown` builds its prose through the DOM sink into its own single element. There is no seam that would let a `Component` be interleaved into that flowed HTML, and creating one would mean a `Component` whose geometry is decided by CSS flow — the exact thing ARCHITECTURE.md's *Positioning is always absolute* forbids. Splitting the page instead keeps every piece a normal absolutely-positioned child of a normal layout manager. Two alternatives were rejected: (a) a placeholder element inside the `Markdown` output that a demo is positioned over, which would require tracking the placeholder's flowed rect every layout and re-deriving the prose height around it; (b) rendering demos in an `<iframe>`, which would need a second framework bootstrap, a second stylesheet, and its own resize plumbing per demo.

[^split-at-showsource]: The alternative was pre-splitting in `pages.ts`, so `DocPage` carried `blocks` instead of `source`. It was rejected because `showPath`'s other four branches do not go through `pages.ts` at all — a fetched API page, the session cache, the not-found view, and the fetch-error view all produce a bare string. Splitting at `showSource` gives one code path for all five and leaves `pages.ts`, its type, and its whole test file untouched.

[^why-comment]: The corpus is shipped documentation, read raw by GitHub, npm, and anything indexing `packages/lib/docs/`. An HTML comment is CommonMark-standard and hidden by every renderer, so the two delimiters add no visible artefact while the content between them renders normally. A `::: demo <id>` container was considered, since `containers.ts` already parses `:::` blocks in this corpus — but that syntax is VitePress-specific and renders as literal `::: demo button-basic` text in any other renderer, which is precisely the noise to avoid. Note also that `content-constructs.test.ts`'s existing raw-HTML guard matches `<tag>` forms only ([content-constructs.test.ts:150](packages/docs/tests/content-constructs.test.ts#L150)), so both comment lines pass it unchanged.

[^why-fallback]: An invisible marker alone is not neutral outside the docs app: a demo that sits under its own `## Example` heading leaves that heading with nothing beneath it on GitHub and npm, which reads as a broken page rather than as a page missing an optional extra. The paired form costs one closing line per demo and one `while` loop in the splitter, and it makes the corpus self-contained everywhere it is read. Two alternatives were rejected. Rendering the fallback in the app *as well as* the demo would duplicate the content, since a good placeholder says what the demo below it shows. Deriving the fallback from the demo module at build time would need a generator, a corpus-is-up-to-date check, and a second place a demo can be edited — more machinery than one hand-written blockquote deserves.

[^eager-globs]: `import.meta.glob` with `eager: true` returns the module namespaces directly, so the registry is a plain synchronous map lookup. Importing a library component bundle at module scope needs no DOM — verified by importing `@jimka/typescript-ui/component/button` in bare Node — so the registry, and the tests that import it, run under vitest's default node environment like the rest of `packages/docs/tests`. Lazy (`eager: false`) globs were rejected: they would make demo resolution a promise, adding a second asynchronous branch that `_requestToken` would have to guard and that could resolve after the page it belongs to was replaced. The cost is bundle size, which one demo does not make interesting.

[^fences-untypechecked]: Checked directly. `packages/lib`'s `typecheck` is `tsc -p tsconfig.lib.json --noEmit` over `src`; `docs:api` is TypeDoc over source; `docs:llms` reads a hand-written manifest. `packages/lib/scripts/` holds ESLint rules, a font-metrics generator, a handle-seam proof, a FontAwesome importer, and the llms generator — nothing that extracts fences. No test reads `packages/lib/docs/**` except `llms-generate.test.ts`, which checks the manifest. So a fenced example in the corpus is never compiled by anything, and several are known to be broken.

[^why-declared-height]: A demo's root component has no intrinsic flow height — its size comes from its layout manager, and many demos (a `Table`, a `Tab`, a scrolling `List`) want a viewport rather than a content fit, so there is no height to derive. Reading `create()`'s `getPreferredSize()` before layout was rejected: it is `null` or wrong for most managers until the component has been sized, and it cannot be checked offline. Keeping the number in the demo module rather than in the marker keeps the demo's definition in one file, so an author tuning the height edits one place.

[^dispose-order]: `removeAllComponents` unwires each child and empties the array without ever calling `destructor` ([Component.ts:4987](packages/lib/src/typescript/lib/core/Component.ts#L4987)) — deliberately, because a removed child may be re-parented by a move. `dispose()` runs the destructor, which recursively destroys children, releases theme subscriptions, detaches the layout manager, removes the element, and disposes the component's stylesheet rules ([Component.ts:716-830](packages/lib/src/typescript/lib/core/Component.ts#L716)) — but leaves the parent's `_components` array pointing at the corpse. Both calls are therefore required, and disposing first is the order `MenuBar` and `Menu` both use. This repo has two recorded teardown-leak classes — a theme-listener leak that leaked a whole window tree per close, and a stylesheet-rule leak from components held in a field and never disposed — which is why the leak check is a numbered verification step rather than a closing note.

[^why-not-stop]: The framework's return-disposition protocol offers a cleaner-looking option — `DocsDemo` registers a subtree listener on itself and returns `true`, ending the dispatcher's ancestor walk before `DocsContent` sees the click. It was rejected because returning `true` calls `evnt.stopPropagation()` ([Event.ts:76-80](packages/lib/src/typescript/lib/core/Event.ts#L76)) on a listener installed at **window capture** ([Event.ts:60-64](packages/lib/src/typescript/lib/core/Event.ts#L60)), which kills the event before it reaches the target — so any demo containing a component with its own native listener (a code editor, a rich-text editor) would silently stop working. Bounding the walk in `closestAnchor` costs one attribute read per hop and has no effect on the event itself. Marking the block with `data-docs-demo` is a data-carrying attribute in the sense ARCHITECTURE.md permits — a framework-internal marker, like the `layout` attribute `setLayoutManager` mirrors onto its element — and `setDataAttribute` buffers writes made before the element exists, so calling it from the constructor is safe.

[^slug-guard]: Today one `Markdown` renders the whole page, so its per-render dedupe map turns a second `## Options` into `options-1`, and `content-constructs.test.ts`'s `headingIds` helper reproduces that page-wide numbering to validate `#anchor` links. Once a page is several `Markdown` instances, each gets a fresh map, and two blocks can both emit the bare slug — `getElementById` then resolves the fragment to whichever comes first in the document. Rather than teach the corpus guard about block boundaries (which would make it *accept* a link that lands on the wrong heading), the new test simply forbids the ambiguity on any page that carries a marker. Threading one counter across a page's blocks was rejected: it would mean a new public API on `Markdown` purely to serve the docs app.
