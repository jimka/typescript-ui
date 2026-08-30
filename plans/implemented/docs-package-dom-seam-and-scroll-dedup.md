---
touches-shared:
  - packages/lib/src/typescript/lib/component/display/index.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/tests/diagnostics/StyleAudit.regression.test.ts
---

# Docs-package DOM seam and heading-scroll dedup — Implementation Plan

## Overview

An audit of `packages/docs` and the three library components it consumes (`Markdown`, `MarkdownViewer`, `MarkdownMinimap`) turned up two structural defects and a batch of smaller ones. This plan fixes all of them.

The two load-bearing items: [`packages/docs/src/shell/proseWidth.ts:18`](packages/docs/src/shell/proseWidth.ts#L18) measures an off-screen probe with raw `document` calls, the only raw-DOM site in `packages/docs`; and ~60 lines of heading-scroll tracking are duplicated character-for-character between [`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts:395`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L395) and [`packages/docs/src/shell/DocsContent.ts:588`](packages/docs/src/shell/DocsContent.ts#L588). The duplication is extracted into a new shared `HeadingScrollTracker` in `packages/lib`.

The smaller items: `DocsContent`'s `ListenerBag` is never registered for teardown; `MarkdownMinimap` writes its card chrome through constructor setters instead of class defaults; `Markdown` can strand a queued fenced-code upgrade when a hidden subtree is re-shown at rest; plus a batch of stale doc comments, two dead line-number citations, and one dead ESLint ignore entry.

---

## Architecture Decisions

### The shared tracker is a plain class in `component/display/`, exported from that barrel

The duplicated fields and methods move into a new `HeadingScrollTracker` class at `packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts`, exported from [`packages/lib/src/typescript/lib/component/display/index.ts:18`](packages/lib/src/typescript/lib/component/display/index.ts#L18)'s barrel alongside `findActiveHeading`.[^tracker-location] `DocsContent` and `MarkdownViewer` each keep their own private `scrollToHeading` / `onNativeScroll` methods as three-line wrappers that resolve the scroll element and delegate.

That arrangement mirrors the sharing already in place for `findActiveHeading` ([`Markdown.ts:1891`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1891)): a `Handle`-taking helper, published through the `component/display` barrel so both packages can reach it.

### The tracker reaches its host through a structural interface plus one callback

`HeadingScrollTracker` needs three things from its host: the current scroll offset, a way to set it, and a way to announce an active-heading change. The first two come from a `HeadingScrollHost` interface that `Component` already satisfies with public `getScrollTop` / `setScrollTop`. The third is a constructor callback the host supplies as a stable arrow field.[^host-shape]

`HeadingScrollHost` is modelled directly on `HeadingScrollSource` ([`MarkdownMinimap.ts:23`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L23)) — a structural interface a scroll-owning host satisfies, so the shared piece never depends on a concrete class. The two are distinct and both stay: `HeadingScrollSource` is what a *minimap* subscribes to; `HeadingScrollHost` is what the *tracker* reads scroll offsets from.

### `scrollToHeading` moves too, superseding an earlier Non-Goal

`plans/implemented/markdown-viewer-floating-minimap-and-controls.md` has a Non-Goal declining to share `scrollToHeading`. That Non-Goal is superseded here: `scrollToHeading` writes the same two fields the tracker owns, so leaving it behind would force the tracker to expose setters for both.[^supersede-nongoal]

### `proseWidth.ts` is rewritten against `DOM.sink` / `DOM.source`

The probe is built, styled, appended, measured, removed, and released entirely through the DOM seam — the sequence [`TableExporter.ts:210`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L210) already uses for its transient `<a>`. `DocsContent` is the in-package precedent that the seam is reachable from `packages/docs` at all ([`DocsContent.ts:523`](packages/docs/src/shell/DocsContent.ts#L523), [`:595`](packages/docs/src/shell/DocsContent.ts#L595), [`:639`](packages/docs/src/shell/DocsContent.ts#L639)).

`ARCHITECTURE.md`'s DOM-seam rules apply to `packages/docs` because `CLAUDE.md` scopes them to every code change in the repo. No lint rule catches this file: `local/no-raw-dom` is scoped to `src/typescript/lib/**` inside `packages/lib` ([`packages/lib/eslint.config.js`](packages/lib/eslint.config.js)), and `packages/docs` has no ESLint config or lint script at all. Giving `packages/docs` one is out of scope (see `## Non-Goals`).

### `MarkdownMinimap`'s chrome moves to a shared constant used in both class-default roles

The three constructor chrome calls become a module-level `MARKDOWN_MINIMAP_CHROME` bag, spread into `_defaultMarkdownMinimapOptions` *and* declared as `ownClassStyleDefaults`. Both are required: `backgroundColor` reaches the element only through the class rule, while `borderRadius` / `shadow` are dispatched from `_defaultOptions` by `Component.applyChromeOptions` and deduped against the class rule at flush.[^chrome-both-roles]

The split-constant shape follows `AUTOCOMPLETE_FIELD_CHROME` ([`AutoCompleteField.ts:30`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L30), used at [`:41`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L41)). A separate constant is needed rather than reusing the whole defaults bag the way `RailHandle` and `AccordionHeader` do, because `_defaultMarkdownMinimapOptions` also carries `minSize` / `maxSize`, which are `StyleBag` keys and would otherwise land in the class CSS rule.

### `Markdown` drains the viewport queue on the visibility edge

[`Markdown.onViewportPass:1278`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1278) returns early while the component is not effectively visible, leaving `_awaitingViewportKickoffs` populated and `_viewportPassScheduled` back at `false`. [`onEffectiveVisibilityChange:1322`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1322) drains only `_awaitingVisibilityKickoffs`. A subtree re-shown at rest therefore leaves in-range fenced blocks as un-upgraded `<pre>` placeholders until some later scroll or resize.[^stranded-trace] The fix is one added `this.scheduleViewportPass()` call on the visible edge, after the existing visibility-queue drain.

---

## Public API

Two new exports from `@jimka/typescript-ui/component/display`.

```typescript
/**
 * Structural interface a scroll-owning host exposes so a HeadingScrollTracker
 * can read and write its scroll offset without depending on Component.
 */
export interface HeadingScrollHost {
    getScrollTop(): number;
    setScrollTop(value: number): unknown;
}
```

```typescript
export class HeadingScrollTracker {
    constructor(host: HeadingScrollHost, onActiveHeadingChange: (headingId: string | null) => void);

    setHeadings(headings: MarkdownHeading[]): void;
    getHeadings(): MarkdownHeading[];

    /** Resolves the active heading from the pane's current scroll position. */
    trackScroll(scrollElement: Handle): void;

    /** Scrolls the host so `id`'s heading sits at the pane's top, and pins it active. */
    scrollToHeading(scrollElement: Handle, id: string): void;
}
```

`setScrollTop` returns `unknown` so `Component`'s chaining `setScrollTop(value): this` satisfies it, matching how `HeadingScrollSource` types its own `on` / `off` returns.

No public API is added, removed, or changed on `MarkdownViewer`, `MarkdownMinimap`, `DocsContent`, or `Markdown`.

---

## Internal Structure

### `HeadingScrollTracker` private state and the shared emit guard

```typescript
private readonly _host: HeadingScrollHost;
private readonly _onActiveHeadingChange: (headingId: string | null) => void;
private _headings: MarkdownHeading[] = [];
private _lastActiveHeadingId: string | null = null;
private _pendingClickScrollTop: number | null = null;

/** Fires the change callback only when the resolved id actually differs. */
private setActiveHeading(id: string | null): void {
    if (id === this._lastActiveHeadingId) {
        return;
    }

    this._lastActiveHeadingId = id;
    this._onActiveHeadingChange(id);
}
```

`trackScroll` and `scrollToHeading` both end in `this.setActiveHeading(id)` — the one place the two copies expressed the same guard in two different shapes (`if (id === last) return;` versus `if (id !== last) { … }`).

`_pendingClickScrollTop` is the pin: the scroll offset `scrollToHeading` last landed the pane on, held so a native scroll arriving at that exact offset is recognised as the click's own echo and skips re-deriving the active heading from geometry. It clears the moment the live `scrollTop` reads anything else.

`setHeadings` replaces `_headings` and touches nothing else. It must **not** reset `_lastActiveHeadingId` or the pin: neither current copy resets them on a page change, and this plan is behaviour-preserving.

### Host wrapper shape (identical in both classes)

```typescript
private readonly handleActiveHeadingChange: (headingId: string | null) => void =
    (id) => this.emit("activeheadingchange", id);

private readonly _tracker: HeadingScrollTracker =
    new HeadingScrollTracker(this, this.handleActiveHeadingChange);

private onNativeScroll(): void {
    const scrollElement = this.getScrollElement();

    if (scrollElement) {
        this._tracker.trackScroll(scrollElement);
    }
}

private scrollToHeading(id: string): void {
    const scrollElement = this.getScrollElement();

    if (scrollElement) {
        this._tracker.scrollToHeading(scrollElement, id);
    }
}
```

`handleActiveHeadingChange` must be declared **above** `_tracker` — field initialisers run in declaration order, and `_tracker`'s initialiser reads the callback field.

---

## Ordered Implementation Steps

### Phase 1 — Route `proseWidth.ts` through the DOM seam

1. In [`packages/docs/src/shell/proseWidth.ts`](packages/docs/src/shell/proseWidth.ts), add `import { DOM } from '@jimka/typescript-ui/core';` and replace the function body:

   ```typescript
   export function resolveProseMeasureWidth(): number {
       const body  = DOM.source.getBody();
       const probe = DOM.sink.createElement('div');

       DOM.sink.apply(probe, {
           style: {
               position:   'fixed',
               visibility: 'hidden',
               width:      'var(--ts-ui-md-max-measure, 70ch)',
           },
       });

       DOM.sink.appendChild(body, probe);

       const width = DOM.source.getElementRect(probe).width;

       DOM.sink.removeChild(body, probe);
       DOM.sink.release(probe);

       return Math.ceil(width);
   }
   ```

   The `release` call is required: `DOM.sink.createElement` retains the handle strongly in the seam's registry, and only `release` drops it.

2. Fix the same file's stale doc comment. The paragraph beginning "Shared by {@link DocsDemo} … and `DocsContent`" names a second consumer that no longer exists — the only caller is [`DocsDemo.ts:61`](packages/docs/src/shell/DocsDemo.ts#L61) and [`:65`](packages/docs/src/shell/DocsDemo.ts#L65). Replace that paragraph with a single-consumer statement, e.g. *"Used by `DocsDemo` so a demo block's right edge lines up with the prose column around it."*

3. Check: `grep -rn 'document\.\|\.style\.\|getBoundingClientRect' packages/docs/src/` — expect exactly two matches, both inside prose comments (`demos/dialog-basic.ts:32`, `demos/markdownviewer-basic.ts:20`), and none in `shell/proseWidth.ts`.

### Phase 2 — Register `DocsContent`'s listener bag

4. In [`packages/docs/src/shell/DocsContent.ts:105`](packages/docs/src/shell/DocsContent.ts#L105), wrap the bag:

   ```typescript
   private readonly _listeners: ListenerBag<DocsContentEvent> = this.registerListenerBag(new ListenerBag<DocsContentEvent>());
   ```

   This matches [`MarkdownViewer.ts:123`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L123), [`MarkdownMinimap.ts:132`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L132), [`CodeEditor.ts:224`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L224), and [`MarkdownEditor.ts:348`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L348).

5. Check: `grep -rn 'new ListenerBag' packages/lib/src packages/docs/src | grep -v registerListenerBag` — expect exactly five matches, all in non-`Component` classes (`AbstractStore`, `Router`, `FocusHistory`, `Binding`, `ButtonGroup`).

### Phase 3 — Extract `HeadingScrollTracker`

6. Create `packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts` with the SPDX header, `HeadingScrollHost`, and `HeadingScrollTracker` per `## Public API` and `## Internal Structure`. Move the two method bodies verbatim from [`MarkdownViewer.ts:395-459`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts#L395), substituting `this._host.getScrollTop()` / `this._host.setScrollTop(…)` for the two `this.` calls, taking `scrollElement` as a parameter instead of calling `getScrollElement()`, and ending both in `this.setActiveHeading(id)`. Imports: `DOM` and `Handle` from `~/core/DOM.js`; `findActiveHeading` and `MarkdownHeading` from `~/component/display/Markdown.js`. Carry over the explanatory comments from both existing copies (the live-`scrollTop` read in `trackScroll`, the mark-immediately rationale in `scrollToHeading`).

7. Add to [`packages/lib/src/typescript/lib/component/display/index.ts`](packages/lib/src/typescript/lib/component/display/index.ts), next to the `findActiveHeading` export:

   ```typescript
   export { HeadingScrollTracker } from '~/component/display/HeadingScrollTracker.js';
   export type { HeadingScrollHost } from '~/component/display/HeadingScrollTracker.js';
   ```

8. In [`MarkdownViewer.ts`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts): delete `_headings` (108), `_lastActiveHeadingId` (111), and `_pendingClickScrollTop` with its doc comment (113-121). Leave `_widthIndex` / `_zoomIndex` (109-110) alone. Add `handleActiveHeadingChange` and `_tracker` among the arrow fields, after line 131 and in that order. Replace the bodies of `onNativeScroll` (395-422) and `scrollToHeading` (436-459) with the wrappers; keep both method names and both doc comments, rewriting each to say the work is delegated to `HeadingScrollTracker`.

9. In the same file's constructor (156-159), replace the two `this._headings` writes with a local:

   ```typescript
   const headings = extractMarkdownHeadings(options?.markdown ?? "");

   this._tracker.setHeadings(headings);
   ```

   and pass `headings` to `this._minimap.setHeadings(...)`. Apply the same shape in `setMarkdown` (239-245).

10. Fix `MarkdownViewer`'s now-unused imports: drop `DOM` (line 17), drop `findActiveHeading` from line 21, and drop `MarkdownHeading` from line 22. Add `HeadingScrollTracker` from `~/component/display/HeadingScrollTracker.js`. Update the class doc comment (82-96) so the sentence about computing the active heading "the same way" names `HeadingScrollTracker` as the shared owner.

11. In [`DocsContent.ts`](packages/docs/src/shell/DocsContent.ts): delete `_headings` with its comment (107-109), `_lastActiveHeadingId` with its comment (111-113), and `_pendingClickScrollTop` with its comment (115-120). Add the same two arrow/tracker fields (after line 138, `handleActiveHeadingChange` first), and the same two wrapper bodies for `scrollToHeading` (588-617) and `onNativeScroll` (627-654). In `emitOutline` (386-392), replace `this._headings = headings;` with `this._tracker.setHeadings(headings);`.

12. In the same file, drop `findActiveHeading` from the line-5 import and add `HeadingScrollTracker`. Keep `DOM` and `MarkdownHeading` — both are still used. Rewrite the class doc comment's closing sentence (48-53): it currently says the class duplicates `MarkdownViewer`'s technique locally rather than sharing it; it now shares `HeadingScrollTracker`.

13. Update the three `viewer._headings` reads in [`packages/lib/tests/component/display/MarkdownViewer.test.ts`](packages/lib/tests/component/display/MarkdownViewer.test.ts) (lines 250, 294, 340) to `viewer._tracker.getHeadings()`.

14. Add one test to the `MarkdownViewer.setMarkdown` describe block in the same file: after `viewer.setMarkdown(...)`, assert `viewer._tracker.getHeadings().map((h) => h.text)` equals the new source's headings.

15. Check: `grep -rn '_pendingClickScrollTop\|_lastActiveHeadingId' packages/lib/src packages/docs/src` — expect matches only in `HeadingScrollTracker.ts`.

### Phase 4 — Drain the viewport queue when a subtree is re-shown

16. In [`Markdown.ts:1322`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1322), restructure `onEffectiveVisibilityChange` so the early return gates on `effective` alone, the visibility-queue drain becomes conditional, and `this.scheduleViewportPass()` runs last:

    ```typescript
    protected onEffectiveVisibilityChange(effective: boolean): void {
        super.onEffectiveVisibilityChange(effective);

        if (!effective) {
            return;
        }

        if (this._awaitingVisibilityKickoffs.length > 0) {
            const queued = this._awaitingVisibilityKickoffs;

            this._awaitingVisibilityKickoffs = [];

            for (const entry of queued) {
                this.startCodeEditorImport(entry);
            }
        }

        this.scheduleViewportPass();
    }
    ```

    Ordering is load-bearing: draining the visibility queue can push newly-checked entries into `_awaitingViewportKickoffs`, and `scheduleViewportPass` must run after that. `scheduleViewportPass` ([`:1251`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1251)) already no-ops on an empty queue or an in-flight pass, so the added call costs nothing in the common case.

17. Update the method's doc comment to say it flushes both queues.

18. Add two tests to the `Markdown fenced code block — CodeEditor upgrade wiring` describe block in [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts), using the file's existing `buildCodeHostTrio` helper and `Component.flushEffectiveVisibility()` (both already used at lines 359 and 369):

    - Push a synthetic entry onto `_awaitingViewportKickoffs`, spy on `Markdown.prototype`'s private `scheduleViewportPass`, call `md.setDisplayed(true)` then `Component.flushEffectiveVisibility()`, and assert the spy was called.
    - Assert the same spy is *not* called for `anyMd.onEffectiveVisibilityChange(false)`, mirroring the existing guard-clause test at line 365.

### Phase 5 — Hoist `MarkdownMinimap`'s chrome to the class tier

19. In [`MarkdownMinimap.ts`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts), add a module-level constant above `_defaultMarkdownMinimapOptions` (107), carrying the three values currently written at lines 150-152 and the existing "opaque card surface lives on the outer panel" comment:

    ```typescript
    const MARKDOWN_MINIMAP_CHROME: Partial<MarkdownMinimapOptions> = {
        backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
        shadow:          "var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))",
        borderRadius:    "var(--ts-ui-border-radius, 4px)",
    };
    ```

20. Spread it into `_defaultMarkdownMinimapOptions` (first, so the existing keys still read clearly), and add `protected static readonly ownClassStyleDefaults: StyleBag = MARKDOWN_MINIMAP_CHROME;` as the class's first member, above `_tree` (131). Import `StyleBag` as a type from `~/core/ClassStyleRules.js`.

21. Delete the three setter calls at lines 150-152. Leave `setLayoutManager` (155) alone — it is not part of this change.

22. Add three rows to the registry in [`packages/lib/tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), beside the existing `MarkdownMinimap` rows (417-419), in the rendered form the file's other chrome rows use (`const m = new MarkdownMinimap({}); m.getElement(true); return m.getShadow();` and so on for `getBackgroundColor` / `getBorderRadius`) — the `TabCloseButton borderRadius (rendered)` row at line 321 is the model. Each expects the matching literal from `MARKDOWN_MINIMAP_CHROME`.

23. Run [`packages/lib/tests/diagnostics/StyleAudit.regression.test.ts`](packages/lib/tests/diagnostics/StyleAudit.regression.test.ts) and read the reported redundant-rule count. If it dropped below `STYLE_AUDIT_DUPLICATE_CEILING` (currently `81`), lower the constant to the new count — it is a ratchet.

### Phase 6 — Doc-comment and dead-citation fixes

24. [`Markdown.ts:1874-1875`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1874): change "Mirrors `DocsContent.scrollToHeading`'s lookup technique in the read direction" to name `HeadingScrollTracker.scrollToHeading`. Keep it in backticks, not `{@link}` — `findActiveHeading` is public JSDoc and the docs build warns on links it cannot render.

25. [`packages/docs/src/content/apiMarkdown.ts:7-8`](packages/docs/src/content/apiMarkdown.ts#L7): the block-token default branch is now `Markdown.ts:1448`, in `appendBlockToken`. Update the citation.

26. [`packages/docs/src/content/pages.ts:76-77`](packages/docs/src/content/pages.ts#L76): "authored in every one of the 15 Phase-1 pages" is stale — the glob matches 181 pages today, every one of which has a `# ` heading. Drop the number rather than replacing it: rewrite as *"authored in every page in the corpus"*.

27. [`packages/docs/src/content/demos.ts:57-64`](packages/docs/src/content/demos.ts#L57): add a line to `getDemoIds`'s JSDoc marking it a deliberate test-only export, mirroring `KIND_LABELS` at [`api.ts:26`](packages/docs/src/content/api.ts#L26). Its only caller is [`packages/docs/tests/demos.test.ts:72`](packages/docs/tests/demos.test.ts#L72) ("has every `getDemoIds()` id appear in at least one corpus marker"). Suggested wording: *"Exported so the demo-catalogue coverage test can check every registered id against the page corpus's own `<!-- demo: id -->` markers."*

28. [`packages/lib/eslint.config.js:13`](packages/lib/eslint.config.js#L13): remove `"docs/.vitepress/cache/**"` from the `ignores` array, leaving `["dist/**", "node_modules/**"]`. No `.vitepress` directory exists under `packages/lib/docs/` and no VitePress script remains. Leave the `typedoc-vitepress-theme` plugin in [`packages/lib/typedoc.json`](packages/lib/typedoc.json) alone — it is a deliberate keep (see `## Non-Goals`).

29. [`packages/lib/docs/components/MarkdownViewer.md`](packages/lib/docs/components/MarkdownViewer.md), "Construction" section: add one sentence after the options table noting that the source is passed as the `markdown` option, unlike `Markdown` / `CodeEditor` / `MarkdownEditor`, which each take it as a positional first argument. No code change — see `## Non-Goals`.

30. Add a changelog entry to [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) under an `## Added` heading for `HeadingScrollTracker` / `HeadingScrollHost`, and a `## Fixed` entry for the stranded fenced-code upgrade.

31. In [`packages/lib/docs/components/MarkdownViewer.md`](packages/lib/docs/components/MarkdownViewer.md)'s "Scroll tracking" section, add one sentence naming `HeadingScrollTracker` as the shared implementation, so the new export is discoverable from prose.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/eslint.config.js` |
| Modify | `packages/lib/tests/component/display/MarkdownViewer.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify (only if the count drops — Step 23) | `packages/lib/tests/diagnostics/StyleAudit.regression.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownViewer.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/docs/src/shell/proseWidth.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/src/content/apiMarkdown.ts` |
| Modify | `packages/docs/src/content/pages.ts` |
| Modify | `packages/docs/src/content/demos.ts` |

---

## Expected Behaviour

### `HeadingScrollTracker` (unit-testable via `MarkdownViewer`, offline)

| Case | Outcome |
|---|---|
| Pane scrolls, resolved heading differs from last | Change callback fires once with the new id |
| Pane scrolls again, resolved heading unchanged | Callback does not fire again |
| `scrollToHeading(id)` for an id inside the pane | Host's `setScrollTop` lands the heading at the pane top; callback fires with `id` |
| `scrollToHeading(id)` for an id not in the document, or outside the pane | No scroll, no callback |
| Native scroll immediately after `scrollToHeading`, live `scrollTop` unchanged | No callback — the pin holds, even when a later heading ties for the top-crossing position |
| Native scroll after a genuine further scroll | The pin clears; geometry-driven tracking resumes |
| `setHeadings(next)` | Subsequent `trackScroll` resolves against `next`; `getHeadings()` returns it. The pin and the last-active id are left untouched |

These are the behaviours the existing `MarkdownViewer scroll tracking` suite (from line 243) and `DocsContent activeheadingchange` suite (from line 221) already assert. Both must keep passing with only the three `_headings` reads changed.

### `Markdown` visibility edge (unit-testable, offline)

| Case | Outcome |
|---|---|
| `_awaitingViewportKickoffs` non-empty, component becomes effectively visible | `scheduleViewportPass` is called; the pass runs on the next flush and upgrades every in-range entry with no scroll or resize required |
| `onEffectiveVisibilityChange(false)` | Neither queue is drained and no pass is scheduled |
| Both queues non-empty, component becomes visible | Visibility queue drains first, then a pass is scheduled — an entry the drain pushed into the viewport queue is covered by that pass |
| Both queues empty, component becomes visible | No pass scheduled (`scheduleViewportPass` no-ops) |

### `MarkdownMinimap` chrome (unit-testable, offline)

`new MarkdownMinimap({}).getBackgroundColor()` / `getShadow()` / `getBorderRadius()` return the same three values they return today. A caller-supplied `backgroundColor` / `shadow` / `borderRadius` option still wins. The rendered card looks unchanged; only which CSS rule carries the declarations moves.

### `resolveProseMeasureWidth` (manual verification only)

Returns the same pixel width as before for a given theme. Not unit-testable here: `packages/docs` tests run against jsdom, which reports a zero-width rect for any element, so the probe measures `0` there with or without this change.

---

## Verification

Run from the repository root, in order — `packages/docs` resolves `@jimka/typescript-ui` through the workspace symlink to `packages/lib/dist/`, so the library must be rebuilt before the docs package can see `HeadingScrollTracker`.

1. `npm -w packages/lib run typecheck`
2. `npm -w packages/lib run test` — the full suite, including the updated `MarkdownViewer`, `Markdown`, `default-options-fallback`, and `StyleAudit.regression` files.
3. `npm -w packages/lib run lint` — must report **no errors** and no new `local/no-element-style` warnings beyond the pre-existing ones.
4. `npm run docs:api` — must finish with **zero** warnings (the new exports render TypeDoc pages; per `CODE_CONVENTIONS.md` their JSDoc may only `{@link}` other public symbols).
5. `npm run build:lib`
6. `npm -w packages/docs run typecheck`
7. `npm -w packages/docs run test`
8. `grep -rn 'document\.\|\.style\.\|getBoundingClientRect' packages/docs/src/` — exactly two matches, both prose comments (`demos/dialog-basic.ts:32`, `demos/markdownviewer-basic.ts:20`).
9. `grep -rn 'new ListenerBag' packages/lib/src packages/docs/src | grep -v registerListenerBag` — five matches, none in a `Component` subclass.
10. `grep -rn '\.vitepress' packages/lib/eslint.config.js` — zero matches.

**Manual smoke test** (`npm run docs:dev`, http://localhost:5173):

- Open a page carrying an inline demo (any page with a `<!-- demo: … -->` marker) and confirm the demo block's right edge still lines up with the prose column — this exercises the rewritten `resolveProseMeasureWidth`.
- Scroll a long page and confirm the floating minimap's highlighted row follows the heading at the top of the pane; click a minimap row and confirm the pane jumps to it and the row stays selected.
- Open a page with a fenced code block far below the fold, navigate away to another page and back, then confirm the block renders as a live `CodeEditor` without scrolling — the Phase-4 fix.
- Confirm the minimap card still shows its opaque background, drop shadow, and rounded corners over scrolled prose.

If a worktree is used for implementation, symlink its `node_modules` to the main tree's before running any of the above.

---

## Documentation Impact

`HeadingScrollTracker` and `HeadingScrollHost` are new exports from `packages/lib/src/typescript/lib/component/display/index.ts` → the `@jimka/typescript-ui/component/display` entry point, so TypeDoc renders them at `/api/component/display/classes/HeadingScrollTracker` and `/api/component/display/interfaces/HeadingScrollHost`.

No new documentation page and no sidebar or catalog entry: `findActiveHeading` and `extractMarkdownHeadings` — the existing shared helper exports in this family — have no page of their own either, and are covered in prose on the component pages that use them. `HeadingScrollTracker` gets the same treatment via the one sentence added to `MarkdownViewer.md`'s "Scroll tracking" section (Step 31), plus the `next.md` changelog entry (Step 30). No `packages/lib/scripts/llms/manifest.data.mjs` entry — that manifest indexes task-to-component mappings, not helper exports.

No renames or removals, so no `grep -rln '\bOldName\b' docs/` sweep is needed.

---

## Potential Challenges

- **Field-initialiser ordering in both hosts.** `_tracker`'s initialiser reads `this.handleActiveHeadingChange`; declaring `_tracker` first leaves the callback `undefined`. Declare the arrow field above it in both classes.
- **`MarkdownViewer` imports go stale.** Removing the two method bodies orphans `DOM`, `findActiveHeading`, and the `MarkdownHeading` type import; Step 10 removes all three explicitly.
- **`packages/docs` cannot see the new export until `build:lib` runs.** A `packages/docs` typecheck before Step 5 of `## Verification` fails with an unresolved import; that is expected, not a defect in the change.
- **`ownClassStyleDefaults` widens `MarkdownMinimap`'s rendered class list** to include its ancestor class names, per `ARCHITECTURE.md`'s hierarchy-aware class tier. Nothing publishes a `.FloatingPanel` or `.Panel` rule, so no style changes; a consumer stylesheet keyed on the rendered class list would see extra names.
- **The `StyleAudit` ceiling is a ratchet, not an assertion of the exact count.** A drop is expected but its size is not predictable from reading the code; read the actual number off the run rather than guessing (Step 23).

---

## Critical Files

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Minimize direct DOM access*, *CSS writes go through `StyleRule` / `InlineStyle`*, *Component CSS tiers and state-rule dedup*, *Class-level defaults must survive the getter*.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `DOMSink.createElement` / `appendChild` / `removeChild` / `release` / `apply` (lines 490-600), `DOMSource.getElementRect` (992), `getBody` (1318), the `ElementPatch` shape (133), and `Handle` (111).
- [`packages/lib/src/typescript/lib/component/table/TableExporter.ts:210`](packages/lib/src/typescript/lib/component/table/TableExporter.ts#L210) — the create/append/measure/remove/release sequence Phase 1 mirrors.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — the seam calls at 523, 529, 564, 595-604, 639, and both duplicated methods.
- [`packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts`](packages/lib/src/typescript/lib/component/display/MarkdownViewer.ts) — the source of the extracted code.
- [`packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts:23`](packages/lib/src/typescript/lib/component/display/MarkdownMinimap.ts#L23) — `HeadingScrollSource`, the structural-host-interface precedent.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts:1891`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1891) — `findActiveHeading`, the barrel-exported shared-helper precedent, plus the viewport/visibility machinery at 1170-1340.
- [`packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts:30`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L30) — `AUTOCOMPLETE_FIELD_CHROME`, the split chrome-constant precedent for Phase 5.
- [`packages/lib/src/typescript/lib/core/Component.ts:840`](packages/lib/src/typescript/lib/core/Component.ts#L840) — `applyChromeOptions`, which decides how a class-default `borderRadius` / `shadow` reaches the element; and `registerListenerBag` at 917.

---

## Non-Goals

- **No ESLint config for `packages/docs`.** The package has none today and no `lint` script; adding a config, wiring the type-aware `local/no-raw-dom` rule against a second tsconfig, and triaging whatever else it reports is its own piece of work.
- **No removal of `typedoc-vitepress-theme`.** Only the stale `docs/.vitepress/cache/**` ESLint ignore goes. The plugin is still load-bearing for the generated API tree's `index.md` filenames — see the footnote in `plans/implemented/docs-sidebar-index-and-kind-grouping.md`.
- **No positional `markdown` argument for `MarkdownViewer`.** The inconsistency with `Markdown` / `CodeEditor` / `MarkdownEditor` is documented rather than removed: `MarkdownViewer` is a container whose options bag is its whole documented surface, and a second construction form would need docs, tests, and a changelog entry to buy nothing a caller cannot already write.
- **`DocsContent` does not become a `MarkdownViewer`.** Its multi-block, demo-interspersed composition is unrelated; only the scroll-tracking duplication is removed.
- **No change to `MarkdownMinimap`'s painted appearance** (its rendered class list does widen — see `## Potential Challenges`), to the active-heading resolution rule in `findActiveHeading`, or to any public event name or payload.

---

## Implementation Notes

**`MARKDOWN_MINIMAP_CHROME` had to carry `minSize`/`maxSize`, not just `backgroundColor`/`shadow`/`borderRadius` as originally specified.** The plan's stated reason for a separate constant — "`_defaultMarkdownMinimapOptions` also carries `minSize` / `maxSize`, which are `StyleBag` keys and would otherwise land in the class CSS rule" — doesn't hold: landing in the class CSS rule is exactly what `TextArea`, `AbstractSelectableList`, `AbstractChart`, and `Table` already do for their own `minSize` via the same `ownClassStyleDefaults` mechanism, and it's the *correct* behaviour, not a defect to avoid.

The real constraint is narrower: `MarkdownMinimapOptions` inherits `FloatingPanelOptions.margin: number`, which conflicts with `StyleBag.margin?: string | null`, so the *whole* `_defaultMarkdownMinimapOptions` bag can't be assigned to `ownClassStyleDefaults: StyleBag` directly (unlike the classes above, none of which extend a `margin`-as-`number` interface) — a separate, narrowly-typed constant is still needed, just not narrowed to only the three chrome properties.

Implementing the plan exactly as specified (a 3-key `MARKDOWN_MINIMAP_CHROME`) surfaced a real regression, caught by the existing `MarkdownMinimap.test.ts` suite: `getMinSizeConstraint()` silently dropped from `{160, 0}` to `{0, 0}` once the class started participating in the style-hierarchy cascade (`chainParticipates`), because `ensureClassStyleRule`'s class-tier authored bag then comes from `ownClassStyleDefaults` alone, not the full `_defaultOptions` — a `StyleBag` key absent from `ownClassStyleDefaults` falls back to the framework baseline (`minSize: {0, 0}`) instead of this class's own default, regardless of what `_defaultOptions` still holds. `minSize`/`maxSize` were added to `MARKDOWN_MINIMAP_CHROME` (now `Pick<MarkdownMinimapOptions, "backgroundColor" | "shadow" | "borderRadius" | "minSize" | "maxSize">`) to fix it. No new test was needed: the regression was already pinned by two pre-existing tests in the `MarkdownMinimap height cap` describe block — `getMinSizeConstraint()` returning `{160, 0}` and an HBox-shrink test asserting `getWidth() >= 160` — both of which this plan's commits leave untouched. This dropped the live-gallery duplicate-rule count from 81 to 68 (`STYLE_AUDIT_DUPLICATE_CEILING` updated accordingly, per Step 23's own ratchet instruction) — `min-width`/`min-height`/`max-width`/`max-height` now dedupe against a shared `.MarkdownMinimap` class rule instead of each instance's own `#id` rule.

**Manual verification of `resolveProseMeasureWidth` (Phase 1), performed as the plan's `## Expected Behaviour` and `## Verification` sections require** (jsdom reports a zero-width rect regardless of this change, so no automated test can cover it): ran `npm run docs:dev`, loaded `/typescript-ui/components/Header` in a real Chromium tab at 1280×900, and read both the rendered `DocsDemo` stage's `getBoundingClientRect()` and the prose paragraph above it's via `evaluate_script`. The stage's right edge (`1008px`) matched the prose column's right edge (`1007.1875px`) to within a sub-pixel rounding difference. As a second check, a raw `document.createElement`/`getBoundingClientRect` probe (the pre-change technique, run inline in the same page) measured the same `--ts-ui-md-max-measure` token at `683.1875px`, and `Math.ceil` of that is `684px` — exactly the stage's rendered width (`1008 - 324 = 684`) — confirming the `DOM.sink`/`DOM.source` rewrite is pixel-identical to the raw-DOM version it replaced. No console errors during the check (one pre-existing, unrelated `CodeEditor` auto-height warning from a prior plan).

---

## Notes

[^tracker-location]: `component/shared/` was considered and rejected. It is explicitly not barrel-exported — both `VirtualRowView.ts` and `reduceModifierSelection.ts` carry an `@internal Not barrel-exported` tag — and `DocsContent` lives in a different package that can only reach `packages/lib` through the published `exports` map. Putting the tracker there would make one of the two consumers unable to import it, which is the whole point of the extraction. `component/display/` is also where its only dependency (`findActiveHeading`) and both its consumers already live.

[^host-shape]: Three shapes were considered. (a) A single host interface covering all three needs fails: `Component.getScrollElement()` and `Component.emit()` are both `protected`, and a protected member cannot satisfy a structural interface requiring a public one — satisfying it would mean widening two classes' public surface for an internal wiring detail. (b) Four constructor callbacks (scroll-element resolver, get, set, change) works but is heavy at the call site. (c) The chosen split: the two genuinely public `Component` methods come free through `HeadingScrollHost`, the scroll element is passed per call the way `findActiveHeading(scrollElement, headings)` already does, and only the change notification needs a callback — one stable arrow field per host, the same shape `MarkdownMinimap.handleActiveHeadingChange` already uses.

[^supersede-nongoal]: The superseded Non-Goal reads: *"No shared extraction of `DocsContent.scrollToHeading`'s scroll-to logic. `MarkdownViewer`'s own click-to-scroll handler duplicates the same small technique locally rather than refactoring existing, working, unrelated `DocsContent` code to share it."* Its stated reason was avoiding a refactor of unrelated code as a side effect of shipping a feature — that constraint does not apply to a plan whose stated purpose is the dedup. The Non-Goal also covered only `scrollToHeading`; `onNativeScroll` and the three fields were duplicated by the same feature without any rationale recorded at all. Splitting them now would leave the tracker owning `_pendingClickScrollTop` and `_lastActiveHeadingId` while a host method outside it writes both, which is worse than either the current duplication or a clean move.

[^chrome-both-roles]: The two properties travel by different routes, which is why one bag serving both roles is required rather than either alone. `Component.applyOptions` dispatches `backgroundColor` only from `options`, never from `_defaultOptions`, so a class default for it reaches the element solely through the class-tier rule that `ownClassStyleDefaults` generates. `borderRadius` and `shadow` go the other way: `applyChromeOptions` reads `this._defaultOptions` and calls the setter, which caches into the instance layer and defers the dedup against the class rule to flush time — so they need the entry in `_defaultMarkdownMinimapOptions` for `clearBorderRadius()` / `clearShadow()` suppression to keep working, and the entry in `ownClassStyleDefaults` for the flush-time dedup to have something to match against and skip.

[^stranded-trace]: The full sequence: a fenced block below the lookahead cutoff queues into `_awaitingViewportKickoffs` and arms the scroll/resize watch. The subtree is then hidden. A scroll or resize arriving while hidden schedules a pass, which clears `_viewportPassScheduled` and returns at the visibility check with the queue intact — so nothing is scheduled any more, even though the watch is still armed. The subtree is re-shown with no further scroll or resize: `onEffectiveVisibilityChange(true)` looks only at `_awaitingVisibilityKickoffs`, finds it empty, and returns. The queued entry is now in range but nothing will look at it. `Component.afterNextLayout` calls `ensureFlushScheduled()` itself, so the added `scheduleViewportPass()` drives its own flush and the pass really does run at rest.
