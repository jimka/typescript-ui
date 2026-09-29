# Demo Blocks Aligned to the Prose Column — Implementation Plan

## Overview

The docs site renders a page as a stack of blocks: prose `Markdown` segments and live `DocsDemo` demos, all children of one `VBox` inside the scrolling content pane ([packages/docs/src/shell/DocsContent.ts:140](packages/docs/src/shell/DocsContent.ts#L140)). Every prose block is given a 32px left margin ([DocsContent.ts:432](packages/docs/src/shell/DocsContent.ts#L432), applied at [:435](packages/docs/src/shell/DocsContent.ts#L435) and [:440](packages/docs/src/shell/DocsContent.ts#L440)), but the `DocsDemo` on that same line 440 is built with no margin at all. A demo therefore sits flush against the pane's left edge while the text above and below it is indented. The same block carries no vertical margin either, so its separation from the element above it is whatever that element's own bottom margin happens to leave — sometimes nothing.

This plan gives a demo block the same left margin the prose blocks get, plus a top and bottom gap of its own. The whole change is one function body and two module constants in **one file**, `packages/docs/src/shell/DocsContent.ts`; `DocsDemo.ts` is not touched. One test file gains cases and one is added.

No `packages/lib` code changes: `Component` already accepts `padding` as an `Insets` option ([Component.ts:132](packages/lib/src/typescript/lib/core/Component.ts#L132), dispatched at [:958](packages/lib/src/typescript/lib/core/Component.ts#L958)), `DocsDemo`'s constructor already takes an options bag ([DocsDemo.ts:54](packages/docs/src/shell/DocsDemo.ts#L54)), and `VBox` already places a child at its container's content-inset origin ([VBox.ts:479](packages/lib/src/typescript/lib/layout/VBox.ts#L479)).

---

## Architecture Decisions

### The left inset comes out of the reading measure, not outside it

`DocsDemo`'s `maxSize.width` stays exactly `resolveProseMeasureWidth()` ([DocsDemo.ts:57](packages/docs/src/shell/DocsDemo.ts#L57)) and the 32px left inset sits **inside** that cap. Nothing is added to the measure.[^inset-inside]

Write `M` for `resolveProseMeasureWidth()` and `P` for the pane's inner width. Every framework component is `box-sizing: border-box` ([ClassStyleRules.ts:128](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L128)), so a width cap bounds the *outer* box and padding is taken out of it.

| Block | Outer box, pane-relative | Content box — what the reader sees | Right edge |
|---|---|---|---|
| prose `Markdown` | `[0, min(P, M)]` — stretched by `VBox`, capped by its own CSS `max-width: M` | `[32, min(P, M)]` | `min(P, M)` |
| `DocsDemo` today | `[0, min(P, M)]` — capped by `maxSize.width = M` | `[0, min(P, M)]` — no padding | `min(P, M)` |
| `DocsDemo` after this plan | `[0, min(P, M)]` — `maxSize.width` unchanged | `[32, min(P, M)]` ✓ matches the prose | `min(P, M)` ✓ |
| `DocsDemo` with the inset added *outside* (`maxSize.width = M + 32`) | `[0, min(P, M + 32)]` | `[32, min(P, M + 32)]` | `min(P, M + 32)` ✗ 32px past the prose |

### The inset is applied where the prose blocks already get theirs

`DocsContent.buildBlock` ([:431-441](packages/docs/src/shell/DocsContent.ts#L431)) passes the demo's padding, the same way it passes the prose blocks' padding today. `DocsDemo.ts` is not modified.[^where-applied]

The precedent is the library's own `MarkdownViewer`, which indents its prose the same way — a `padding: new Insets(0, 0, 0, PROSE_LEFT_MARGIN_PX)` on a `Markdown` whose own CSS `max-width` caps the measure ([MarkdownViewer.ts:50](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L50) and [:174](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L174)). Same channel (`padding`, not `insets`), same relationship to the measure.

### The demo block carries its own top and bottom gap

The demo's padding also sets a top and bottom inset, so the block never touches the element above or below it whatever that element is.[^own-gap]

| Gap above the demo | Today | After |
|---|---|---|
| the block above ends with an element carrying a `1em` bottom margin | that `1em` alone | that `1em` plus the demo's own `1em` — the same two-margin gap two adjacent prose blocks show |
| the block above ends with an element carrying no bottom margin | nothing; the demo touches it | the demo's own `1em` |

### The vertical gap is a fixed pixel constant

`DEMO_BLOCK_GAP_PX = 14` — `1em` at the theme's 14px base font size — declared beside `PROSE_LEFT_MARGIN_PX` in `DocsContent.ts`.[^fixed-px]

---

## Implementation

Two module constants in [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts). The existing `PROSE_LEFT_MARGIN_PX` doc comment ([:24-30](packages/docs/src/shell/DocsContent.ts#L24)) is amended — "each prose block" becomes "each block", and the measure relationship is recorded, because that relationship is the thing a later reader is most likely to get wrong:

```ts
/**
 * Left margin kept on each block's own content box, so the reading column
 * starts indented from the pane's edge the way text sits on a printed page
 * or in a word processor, rather than flush against it — mirrors
 * `MarkdownViewer`'s own `PROSE_LEFT_MARGIN_PX`.
 *
 * The margin is taken *out of* the reading measure, never added outside it.
 * A prose `Markdown` caps its own element at `--ts-ui-md-max-measure`, and
 * every framework component is `box-sizing: border-box`, so this padding
 * already sits inside that cap: the text is `measure - 32` wide, starting
 * 32px in. A `DocsDemo` keeps the same relationship — its `maxSize.width`
 * stays the bare `resolveProseMeasureWidth()` — so both columns are the
 * same width and start at the same x. Widening a demo's `maxSize` by this
 * margin would push its right edge 32px past the prose.
 */
const PROSE_LEFT_MARGIN_PX = 32;

/**
 * Vertical gap a demo block keeps above and below itself. A `DocsDemo` is a
 * component tree, not prose, so it carries none of the `1em` block margin a
 * rendered `<p>` / `<pre>` / `<ul>` contributes inside its own `Markdown`
 * block's measured height — and the pane stacks blocks with `spacing: 0`
 * (see the `VBox` above). Without this the block's separation from what
 * precedes it is whatever that block's last element happens to leave.
 * `14` is that same `1em` at the theme's 14px base font size
 * (`Theme.font.size`'s default), so a demo reads at the prose's rhythm.
 */
const DEMO_BLOCK_GAP_PX = 14;
```

`buildBlock` gains one arm. The demo branch stops being a ternary tail, because it now needs an options bag of its own:

```ts
    private buildBlock(block: DocBlock): Component {
        const proseMargin = new Insets(0, 0, 0, PROSE_LEFT_MARGIN_PX);

        if (block.kind === 'markdown') {
            return new Markdown(block.source, { linkResolver: this.resolveLink, padding: proseMargin });
        }

        const entry = getDemo(block.id);

        if (entry === null) {
            return new Markdown(missingDemoSource(block.id), { padding: proseMargin });
        }

        return new DocsDemo(entry, {
            padding: new Insets(DEMO_BLOCK_GAP_PX, 0, DEMO_BLOCK_GAP_PX, PROSE_LEFT_MARGIN_PX),
        });
    }
```

The missing-demo fallback keeps `proseMargin`: it is rendered prose and brings its own margins.

---

## Ordered Implementation Steps

**Do not start the docs dev server, `vite preview`, the QA app, or anything else that opens a window.** Every check below is offline. The visual checks in `## Expected Behaviour` are for the user to run, not the implementer.

1. **Prepare the worktree.** From the worktree root: `npm install`, then `npm run build:lib` (the docs tests import this checkout's library *build*, aliased by `libraryBuildPlugin` in [packages/docs/vite.config.ts](packages/docs/vite.config.ts)), then `npm run docs:api`. Without the generated API tree, 4 of the 12 docs test files fail to load at all with `TypeDoc API tree not found at …/packages/lib/docs/api`.[^api-tree]

2. **Baseline the suite.** `npm -w packages/docs run test` — expect `12 passed (12)`, 2612 tests. Confirm `tests/libraryResolution.test.ts` is among the passes: that file is the guard proving the Vite alias resolved *this* checkout's build rather than the main tree's, so no later result in this worktree is trustworthy without it.

3. **Write the demo-block cases, red first.** In [packages/docs/tests/DocsContent.test.ts](packages/docs/tests/DocsContent.test.ts), rename the `describe` at [:210](packages/docs/tests/DocsContent.test.ts#L210) from `'DocsContent prose left margin'` to `'DocsContent block insets'` (its scope widens), extend the existing case at [:211](packages/docs/tests/DocsContent.test.ts#L211) with U1's three new assertions, then add U2 and U3 from `## Expected Behaviour`, verbatim. Run `npx vitest run tests/DocsContent.test.ts` from `packages/docs`. Expect U1 and U3 to pass and U2 to fail at its `getLeft()` line with `expected undefined to be 32` — today `getPadding()` returns `null` on a demo block, so every inset read comes back `undefined`. U2's `getDataAttribute('docs-demo')` line passes even now, which is what confirms the block under test really is the `DocsDemo` and not the fallback. U3 pins the fallback arm this plan must not change.

4. **Make U2 green.** In [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts): amend the `PROSE_LEFT_MARGIN_PX` doc comment and add `DEMO_BLOCK_GAP_PX` below it, then rewrite `buildBlock` — both exactly as in `## Implementation`. Add one sentence to `buildBlock`'s own JSDoc ([:421-430](packages/docs/src/shell/DocsContent.ts#L421)): every block gets the reading column's left margin, and a demo block gets a vertical gap as well because it brings no prose margins of its own. Re-run `npx vitest run tests/DocsContent.test.ts` — all cases pass.

5. **Add the measure guard.** Create [packages/docs/tests/DocsDemo.test.ts](packages/docs/tests/DocsDemo.test.ts) with U4 from `## Expected Behaviour`, verbatim, header comment included. Run `npx vitest run tests/DocsDemo.test.ts` — it passes on arrival, because `DocsDemo.ts` is correct as it stands.

6. **Prove U4 can fail.** Temporarily change [DocsDemo.ts:57](packages/docs/src/shell/DocsDemo.ts#L57) to `maxSize: { width: resolveProseMeasureWidth() + 32, height: UNBOUNDED },`. Re-run `npx vitest run tests/DocsDemo.test.ts` and confirm it fails with `expected 672 to be 640`. **Revert the change** and re-run to confirm green. `git diff packages/docs/src/shell/DocsDemo.ts` must come back empty.

7. **Check the change is confined.** From the worktree root, `git status --porcelain` lists exactly three paths: `packages/docs/src/shell/DocsContent.ts`, `packages/docs/tests/DocsContent.test.ts`, `packages/docs/tests/DocsDemo.test.ts`. `grep -n 'proseMargin' packages/docs/src/shell/DocsContent.ts` returns exactly three lines — the declaration and the two prose uses. `grep -rn 'PROSE_LEFT_MARGIN_PX\|DEMO_BLOCK_GAP_PX' packages/docs/src/` returns only `DocsContent.ts`: neither constant leaks into `DocsDemo.ts`, which would be a circular import.

8. **Run the gates.** `npm -w packages/docs run typecheck`, then `npm -w packages/docs run test` (expect `12 passed` plus the new file, so `13 passed (13)`), then `npm run build:docs`.

9. **Hand the visual checks to the user.** Report M1–M7 from `## Expected Behaviour` with the page paths spelled out. Do not run them.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/tests/DocsContent.test.ts` |
| Create | `packages/docs/tests/DocsDemo.test.ts` |

---

## Expected Behaviour

### Unit-testable

**U1 — a prose block keeps the left margin and gains no vertical inset.** The case already exists at [DocsContent.test.ts:211](packages/docs/tests/DocsContent.test.ts#L211); the three `getTop` / `getRight` / `getBottom` assertions are the new lines.

```ts
    it('gives a markdown block a left margin, so prose reads like a page rather than sitting flush against the pane edge', () => {
        mockPage('/prose-margin', '# A\n\ntext\n');
        content = new DocsContent(router);

        content.showPath('/prose-margin', '');

        expect(content.getTextColumnReference()?.getPadding()?.getLeft()).toBe(32);
        expect(content.getTextColumnReference()?.getPadding()?.getTop()).toBe(0);
        expect(content.getTextColumnReference()?.getPadding()?.getRight()).toBe(0);
        expect(content.getTextColumnReference()?.getPadding()?.getBottom()).toBe(0);
    });
```

**U2 — a demo block gets the same left margin plus its own vertical gap.** A page whose first lines are a marker pair yields a single `demo` block, so `getTextColumnReference()` is the `DocsDemo` itself; `button-basic` is a registered demo id, and `getDemo` is not mocked in this file.

```ts
    it('gives a demo block the prose left margin plus a vertical gap of its own, so it reads as part of the column and never butts against the block above', () => {
        mockPage('/demo-block', '<!-- demo: button-basic -->\n> fallback\n<!-- /demo -->\n');
        content = new DocsContent(router);

        content.showPath('/demo-block', '');

        const block = content.getTextColumnReference();

        expect(block?.getDataAttribute('docs-demo')).toBe('true');
        expect(block?.getPadding()?.getLeft()).toBe(32);
        expect(block?.getPadding()?.getTop()).toBe(14);
        expect(block?.getPadding()?.getBottom()).toBe(14);
        expect(block?.getPadding()?.getRight()).toBe(0);
    });
```

**U3 — a missing-demo fallback gets the prose insets, not the demo block's.**

```ts
    it('gives a missing-demo fallback the prose insets, since it is rendered prose and brings its own margins', () => {
        mockPage('/missing-demo', '<!-- demo: no-such-demo -->\n> fallback\n<!-- /demo -->\n');
        content = new DocsContent(router);

        content.showPath('/missing-demo', '');

        const block = content.getTextColumnReference();

        expect(block?.getDataAttribute('docs-demo')).toBeUndefined();
        expect(block?.getPadding()?.getLeft()).toBe(32);
        expect(block?.getPadding()?.getTop()).toBe(0);
        expect(block?.getPadding()?.getBottom()).toBe(0);
    });
```

**U4 — a demo block caps its width at the bare resolved measure.** The whole of the new `packages/docs/tests/DocsDemo.test.ts`:

```ts
// @vitest-environment jsdom
//
// DocsDemo builds library components (Panel, ToggleButton, Markdown) through
// the library's production DOM seam as it is constructed — same reason
// DocsContent.test.ts and demos.test.ts need a real DOM (see their own top
// comments). `resolveProseMeasureWidth` is mocked because jsdom lays nothing
// out, so the real off-screen probe resolves to 0 and an assertion against
// it would hold for any arithmetic the constructor did to it.
import { describe, it, expect, vi } from 'vitest';
import { Panel } from '@jimka/typescript-ui/core';
import { DocsDemo } from '../src/shell/DocsDemo.js';
import type { DemoEntry } from '../src/content/demos.js';

const measure = vi.hoisted(() => ({ value: 640 }));

vi.mock('../src/shell/proseWidth.js', () => ({
    resolveProseMeasureWidth: () => measure.value,
}));

// A stand-in demo whose stage content is a bare Panel: this file asserts on
// the block's own geometry, not on any real demo's tree. A type-only import
// of DemoEntry keeps demos.ts (and its eager glob over every demo module)
// out of this file.
const entry: DemoEntry = { module: { height: 120, create: () => new Panel() }, source: 'source text' };

describe('DocsDemo prose measure', () => {
    it('caps its width at the bare resolved measure, so the prose left margin comes out of the measure instead of pushing the block past the prose', () => {
        const demo = new DocsDemo(entry);

        expect(demo.getMaxSizeConstraint()?.width).toBe(640);

        demo.dispose();
    });
});
```

### Which mutation each assertion catches

Every pinned number is non-zero except the deliberate `0` assertions in U1 and U3, whose non-zero counterpart — the demo's `14` — is pinned in U2 in the same file. No assertion compares a demo's offset against a prose block's, so none can pass by both sides being zero.

| Mutation of a shipped line | Caught by |
|---|---|
| The `padding` bag is missing from the `new DocsDemo(...)` call — today's state | U2 `getLeft()`: `expected undefined to be 32` (confirmed against the unchanged source) |
| `proseMargin` is passed to the demo instead of its own `Insets` | U2 `getTop()` and `getBottom()`: `expected 0 to be 14` |
| `new Insets(DEMO_BLOCK_GAP_PX, 0, 0, PROSE_LEFT_MARGIN_PX)` — bottom dropped | U2 `getBottom()` |
| `new Insets(0, 0, DEMO_BLOCK_GAP_PX, PROSE_LEFT_MARGIN_PX)` — top dropped | U2 `getTop()` |
| A right inset is added, pulling the demo's right edge off the prose's | U2 `getRight()` |
| `PROSE_LEFT_MARGIN_PX` is changed, or the demo's left inset is taken from some other number | U1 and U2 `getLeft()`, both pinned at 32 |
| The demo's vertical insets are given to the prose blocks too, doubling every prose gutter | U1 `getTop()` and `getBottom()` |
| The missing-demo fallback is given the demo insets | U3 `getTop()` and `getBottom()` |
| The fallback arm is built as a `DocsDemo` | U3 `getDataAttribute('docs-demo')` |
| `DocsDemo.ts:57` becomes `resolveProseMeasureWidth() + 32` — the inset added *outside* the measure | U4: `expected 672 to be 640` (confirmed by running the mutation) |

### Manual — for the user to run

No test in this suite can see any of these: jsdom computes no geometry, so nothing below is reachable from an assertion.[^why-manual] The user runs the docs site and checks each page.

**M1 — `/layouts/Absolute`, both demos.** This page carries two, with different elements above them: the first (`absolute-placement`) sits right after the ASCII-art code fence; the second (`absolute-sizing`) right after the sentence *"`setSizing` switches the mode at runtime and marks the container's layout pass as owed."* For each: the bordered stage's **left** edge sits on the same vertical line as the first character of the paragraphs around it, and its **right** edge on the same line as the prose's right edge.

**M2 — the same two demos, gap above.** Each has a clear gap above it, and the two gaps read the same, even though one follows a code fence and the other a paragraph. Neither demo touches the element above it.

**M3 — `/components/Table`, the `table-cell-types` demo.** It follows a bulleted list (last bullet: *"The boolean variant has no separate edit cycle…"*). Same left and right alignment as M1, and a visible gap between the last bullet and the demo's top border.

**M4 — `/layouts/Tab`, the `tab-strip` demo.** It follows a `::: tip Composed from a TabBar` callout. There is a visible gap between the callout's bottom edge and the demo's top border.

**M5 — cold load.** Hard-reload `/layouts/Absolute` so the web font loads fresh. `DocsDemo` re-resolves the measure once the font settles, and the left inset is a constant, so once the page has reflowed both edges still line up — nothing shifts out of alignment between the fallback face and the real one.

**M6 — narrow window.** Shrink the window until the content pane is narrower than the reading measure. Prose and demos shrink together and stay aligned on both edges; no horizontal scrollbar appears on the pane.

**M7 — "Show source".** Click a demo's *Show source* toggle. The button's right edge still sits on the prose's right edge; the revealed source panel's left edge sits on the same left line as the stage above it; the page's scroll extent grows as before.

---

## Verification

Offline only. **Nothing here may open a window** — no `npm run docs:dev`, no `vite preview`, no QA app.

- `npm install` && `npm run build:lib` && `npm run docs:api` from the worktree root (step 1 — the last of the three is what lets the docs suite load at all).
- `npm -w packages/docs run typecheck` — clean.
- `npm -w packages/docs run test` — `13 passed (13)` files, with `tests/libraryResolution.test.ts` green, which is what certifies the library the run resolved.
- The mutation proof in step 6: U4 fails with `expected 672 to be 640` under the mutation, passes after the revert, and `git diff packages/docs/src/shell/DocsDemo.ts` is empty.
- The greps in step 7.
- `npm run build:docs` — succeeds.
- `packages/lib` is untouched, so its suite is not a gate for this plan.
- M1–M7 above, run by the user.

---

## Documentation Impact

None. `packages/docs` is a private workspace with no exported API, no `llms.txt` entry, and no doc page describing the content pane's own layout. Numbered changelog pages record library changes; a docs-site layout fix does not get an entry in `packages/lib/docs/reference/changelog/next.md`.

---

## Potential Challenges

- **The docs suite will not even load in a fresh worktree.** Four of twelve files import `src/content/api.ts`, which resolves a virtual module built from the generated API tree, and a worktree has none. Mitigation: `npm run docs:api` in step 1; the failure message names the same command.[^api-tree]
- **The theme-change re-resolution cannot be unit-tested.** Calling `ThemeManager.setTheme` under jsdom throws inside `ToggleButton`'s own theme listener — `measureFontMetrics` needs a canvas 2D context jsdom does not provide. Mitigation: M5 covers it, and `DocsDemo.ts` is unchanged, so that path behaves exactly as it does today.
- **Reaching for `PROSE_LEFT_MARGIN_PX` from `DocsDemo.ts` would be a circular import.** `DocsContent.ts` already imports `DocsDemo.ts` ([:17](packages/docs/src/shell/DocsContent.ts#L17)). Mitigation: the constants stay in `DocsContent.ts` and the padding is passed in; the grep in step 7 checks it.
- **`getPadding()` returns `null`, not a zero `Insets`, when no padding is set.** A missing padding therefore surfaces as `expected undefined to be 32` rather than `expected 0 to be 32`. Both fail; no mitigation needed, but do not "fix" the optional chaining into something that swallows it.

---

## Critical Files

- [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts) — the only source file changed. Read its header comments at [:24-30](packages/docs/src/shell/DocsContent.ts#L24) and [:35-54](packages/docs/src/shell/DocsContent.ts#L35): they state the layout model this plan extends.
- [packages/docs/src/shell/DocsDemo.ts](packages/docs/src/shell/DocsDemo.ts) — the block's own `maxSize` ([:57](packages/docs/src/shell/DocsDemo.ts#L57)), the theme re-resolution ([:60-62](packages/docs/src/shell/DocsDemo.ts#L60)) and its rationale ([:43-52](packages/docs/src/shell/DocsDemo.ts#L43)), and the `options` parameter the padding arrives through ([:54](packages/docs/src/shell/DocsDemo.ts#L54)). **Not modified.**
- [packages/docs/src/shell/proseWidth.ts](packages/docs/src/shell/proseWidth.ts) — how the measure becomes a number, and why a probe is used rather than parsing `ch`.
- [packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts:50](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L50), [:174](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L174) — the precedent the approach mirrors: the same 32px, through `padding`, inside the same CSS measure cap.
- [packages/lib/src/typescript/lib/component/display/Markdown.ts:841-846](packages/lib/src/typescript/lib/component/display/Markdown.ts#L841) — `setMaxMeasure` writes `max-width` onto the component's **own** element. With `box-sizing: border-box` this is what puts the prose padding inside the measure.
- [packages/lib/src/typescript/lib/layout/VBox.ts:476-531](packages/lib/src/typescript/lib/layout/VBox.ts#L476) — cross-axis placement: a child is placed at the container's content-inset left and sized to `min(inner width, child max width)`, which is both why the demo is flush left today and why padding fixes it. [:277-283](packages/lib/src/typescript/lib/layout/VBox.ts#L277) shows the working size comes from `getInnerSize()` and the origin from `getContentInsets()`.
- [packages/lib/src/typescript/lib/core/Component.ts:2930-2943](packages/lib/src/typescript/lib/core/Component.ts#L2930) (`getContentInsets`) and [:4244-4277](packages/lib/src/typescript/lib/core/Component.ts#L4244) (`getPerimeterSize`) — padding shifts the child origin and is subtracted from the usable width, which is what makes a top inset grow the block's reported height instead of being swallowed.
- [packages/docs/tests/DocsContent.test.ts:1-80](packages/docs/tests/DocsContent.test.ts#L1) and [:210-220](packages/docs/tests/DocsContent.test.ts#L210) — the harness (jsdom, `mockPage`, the `afterEach` teardown) and the existing left-margin case to extend.
- [plans/implemented/docs-inline-demos.md](plans/implemented/docs-inline-demos.md) — the demo block's design: why the pane uses `spacing: 0`, why the toggle is anchored `EAST`, and why the block stops link interception at its own boundary.

---

## Non-Goals

- **Full-bleed demos with only the vertical gap fixed**, and **restructuring `DocsDemo` into a captioned figure.** Both were considered and rejected; the demo matches the prose column. Do not reopen either.
- **Any change to `DocsDemo.ts`.** Its `maxSize` is already right; step 6 mutates it only to prove a test can fail, and reverts.
- **Any change to the pane's `VBox({ stretching: true, spacing: 0 })`** ([DocsContent.ts:140](packages/docs/src/shell/DocsContent.ts#L140)). Prose blocks carry their own margins inside their measured height, so a box `spacing` would double every gutter on the page.
- **Any `packages/lib` change.** `MarkdownViewer`'s own duplicate `PROSE_LEFT_MARGIN_PX` stays where it is; de-duplicating it across the package boundary is separate work.
- **Changing `resolveProseMeasureWidth` or the `--ts-ui-md-max-measure` token.** Whether the probe's `ch` resolves against exactly the same font as a `Markdown` element's is pre-existing behaviour on both edges, unaffected either way.
- **Making the vertical gap font-relative.** See [^fixed-px].

---

## Notes

[^inset-inside]: The two candidate readings differ by exactly 32px on the right edge, and the table in the decision shows which one is right. The deciding fact is that `Markdown` caps its **own element** — `this.setElementCSSRule("maxWidth", … "var(--ts-ui-md-max-measure, 70ch)")` at [Markdown.ts:844](packages/lib/src/typescript/lib/component/display/Markdown.ts#L844), re-asserted from `applyStyle` at [:879](packages/lib/src/typescript/lib/component/display/Markdown.ts#L879) — and that the framework emits `box-sizing: border-box` for every component as a baseline declaration ([ClassStyleRules.ts:128](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L128), [:230](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L230)). A border-box `max-width` bounds the padding box, so a prose block's 32px padding-left is spent *inside* the 70ch cap: the text is `measure - 32` wide and starts 32px in. `DocsDemo`'s side of the same arithmetic runs through the JS layout engine rather than CSS — `maxSize.width` bounds the value handed to `setWidth`, which is the border-box width ([`clampWidth`, Component.ts:4734](packages/lib/src/typescript/lib/core/Component.ts#L4734); `Container` clamps to its own explicit constraint, [Container.ts:49](packages/lib/src/typescript/lib/core/Container.ts#L49)) — and `getInnerSize` then subtracts the padding from what the inner `VBox` may fill. Same result on both sides: content `measure - 32`, starting at 32. Keeping `maxSize.width` as the bare measure has a second payoff: the theme-change handler at [DocsDemo.ts:60-62](packages/docs/src/shell/DocsDemo.ts#L60), which re-resolves the measure once the web font settles, needs no matching arithmetic and so cannot fall out of step with the constructor. Adding the margin outside the measure would have required the same `+ 32` in both places, and a later edit to one of them would have silently misaligned the block.

[^where-applied]: `DocsDemo.ts` cannot import `PROSE_LEFT_MARGIN_PX` from `DocsContent.ts`, because `DocsContent.ts` already imports `DocsDemo.ts` ([:17](packages/docs/src/shell/DocsContent.ts#L17)) — that would be a cycle. Moving the constant to a third module (`proseWidth.ts` is the plausible one) was considered and dropped: it turns a one-file fix into an edit across three files, and it would put the number a mocked test module owns into the same module the test mocks, making a "padding is 32" assertion assert the mock's own value. Passing the padding from `buildBlock` instead keeps the whole column geometry — both blocks' left margin and the demo's gap — visible at one call site, which is also what the existing comment at [:24-30](packages/docs/src/shell/DocsContent.ts#L24) already describes. `padding` is used rather than the framework's `insets` because both feed the layout identically (`getContentInsets` sums them, [Component.ts:2930](packages/lib/src/typescript/lib/core/Component.ts#L2930)) and `padding` is what the sibling call on the same line and `MarkdownViewer`'s precedent both use.

[^own-gap]: The pane stacks blocks with `spacing: 0` ([DocsContent.ts:140](packages/docs/src/shell/DocsContent.ts#L140)) because a prose `Markdown`'s measured height already contains its own block margins, so a box spacing would double every gutter (`plans/implemented/docs-inline-demos.md`, step 6). A `DocsDemo` brings no such margins — its children are a `Panel`, a `ToggleButton` and a hidden `Markdown` — so with `spacing: 0` its only separation is whatever the block above it leaves, which is why the gap is there on some pages and not others. A top and bottom inset moves that from "inherited from the neighbour" to "owned by the block". The insets also really grow the block's box rather than being absorbed: `VBox`'s size reports add the container's perimeter, and `getPerimeterSize` counts padding ([Component.ts:4244-4277](packages/lib/src/typescript/lib/core/Component.ts#L4244)), so the pane allocates the extra height and the stage keeps the `entry.module.height` it asked for. The `EAST`-anchored toggle stays right-aligned to the same content box the stage fills, since `crossPlacement` anchors within `[contentInsets.left, contentInsets.left + innerWidth]`.

[^fixed-px]: `1em` is the block margin the browser gives a `<p>`, `<pre>` and `<ul>`, and the margin `Markdown`'s own multi-column fence rule declares. `ThemeManager.setTheme` writes `theme.font.size ?? '14px'` as the `font-size` on `<html>` ([Theme.ts:1424](packages/lib/src/typescript/lib/core/Theme.ts#L1424)) and the docs app sets no theme of its own, so `1em` is 14px there. A probe-resolved, font-relative gap — the technique `proseWidth.ts` uses for the measure — was rejected on two counts: the existing left margin is already a fixed 32px that does not track the font, so a font-relative vertical gap would be the inconsistent one; and the padding is built in `buildBlock`, which the pane does not re-run on a theme change, so a resolved value would go stale exactly where the measure does not. If a visual check says the gap reads too tight or too loose, `DEMO_BLOCK_GAP_PX` is the single line to change.

[^api-tree]: `packages/lib/docs/api` is generated and gitignored, so a fresh worktree has none, and `packages/docs/vite.config.ts`'s `typedocApi` plugin throws at module-load time when it is missing. This was confirmed in a clean worktree: without the tree, `api.test.ts`, `links.test.ts` and two others fail to load while the remaining eight files pass; with it, all twelve pass and 2612 tests run. `npm run docs:api` writes roughly 190MB. A symlink to the main checkout's tree also works and takes no time, since this plan's tests never read the tree's contents — only its presence is required — but a stale tree would mislead any later work that does read it, so prefer the real command.

[^why-manual]: The docs suite runs under jsdom, which never lays anything out: `getBoundingClientRect` returns zeroes, so `resolveProseMeasureWidth`'s probe measures 0 and no rendered edge, gap or overlap is observable. That is the reason U4 mocks the measure to a non-zero 640 rather than asserting against the real probe — against the real probe, both `resolveProseMeasureWidth()` and `resolveProseMeasureWidth() + 32` would be compared to 0 and 32, which happens to catch that one mutation but reads as nonsense and tells a later reader nothing. Everything that is about appearance — whether the demo reads as part of the column, whether the gap looks like a paragraph break — is in M1–M7 instead.
