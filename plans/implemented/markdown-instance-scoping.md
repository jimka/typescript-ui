---
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts
---

# Markdown instance scoping and hidden measurement — Implementation Plan

## Overview

Two correctness bugs from the render-review register, both in
[component/display/Markdown.ts](packages/lib/src/typescript/lib/component/display/Markdown.ts),
one of them reaching into
[component/display/HeadingScrollTracker.ts](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts).

**C18 — a theme change while a `Markdown` is undisplayed permanently caches
height 0.** `measureContentHeight` checks only that the element exists
([Markdown.ts:1043-1047](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1043)),
so it measures a `display:none` element, where every live geometry read
reports zero. `setWidth` only re-measures when the assigned width actually
changed
([Markdown.ts:972-983](packages/lib/src/typescript/lib/component/display/Markdown.ts#L972)),
and no width changes on a re-show, so the zero sticks forever. The fix is a
visibility guard in `measureContentHeight` plus a re-measure scheduled from
`onEffectiveVisibilityChange`
([Markdown.ts:1471-1493](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1471)),
which today drains only the two code-upgrade queues.

**C19 — two `Markdown` previews of documents sharing a heading name break each
other's outline.** Heading ids are deduped only within one render
([Markdown.ts:426-433](packages/lib/src/typescript/lib/component/display/Markdown.ts#L426),
written at
[Markdown.ts:1627](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1627))
but land in the one document-wide id space, and both readers resolve them with
a document-wide `getElementById` followed by a `contains` check —
`findActiveHeading`
([Markdown.ts:2223-2225](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2223))
and `HeadingScrollTracker.scrollToHeading`
([HeadingScrollTracker.ts:109-113](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L109)).
In the second pane the lookup returns the *first* pane's element, `contains`
rejects it, and that pane's minimap neither highlights nor responds to clicks.
The fix resolves each heading inside the scrolling pane it belongs to, through
the root-scoped `DOM.source.querySelector` the seam already provides. Rendered
ids do not change.

Both bugs are reached from ordinary use: two Dock panes previewing two Markdown
files, and a preview left on an inactive page across a theme toggle.

---

## Architecture Decisions

### C19 is fixed by scoping the lookup, not by scoping the ids

Heading ids keep their current format. `findActiveHeading` and
`HeadingScrollTracker.scrollToHeading` each resolve a heading by querying
inside the scroll-owning element they are already handed, instead of querying
the whole document and then filtering.[^why-not-prefix]

The precedent is
[Glyphs.ts:153-171](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L153):
`_addSymbolToSprite` and `_removeSymbolFromSprite` both resolve an id *within
one subtree* with `DOM.source.querySelector(root, …)` over a value passed
through `DOM.source.escapeSelector`. This plan follows that shape and deviates
in exactly one respect — the selector is `[id="…"]` rather than
`#…`.[^why-attribute-selector]

| Heading source | Rendered `id` | Selector passed to `DOM.source.querySelector` |
|---|---|---|
| `## Some Heading` | `some-heading` | `[id="some-heading"]` |
| `## Dup` (the second one in the document) | `dup-1` | `[id="dup-1"]` |
| `## 2026 Roadmap` | `2026-roadmap` | `[id="2026-roadmap"]` — `#2026-roadmap` is not a valid selector |

The behaviour that changes, for two panes whose documents share a heading name
— pane A rendered first, pane B second:

| Pane | Headings rendered | `findActiveHeading` today | After this change |
|---|---|---|---|
| A | `alpha`, `shared` | `shared` | `shared` |
| B | `beta`, `shared` | `beta` — `getElementById("shared")` returns A's element, and `contains(B, …)` rejects it | `shared` |

### The selector is built by one shared helper

A new module-level `headingSelector(id)` in `Markdown.ts` is the single place
the read-side selector is formed, and both call sites use it. That mirrors
`nextHeadingId`
([Markdown.ts:426](packages/lib/src/typescript/lib/component/display/Markdown.ts#L426)),
which its own doc comment calls "the single place a heading's slug is deduped"
for the two write-side callers. The helper is exported from `Markdown.ts` but
not from the `component/display` barrel, the way `mapFenceLangToEditorId`
already is
([Markdown.ts:2253-2256](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2253)).[^precedent-helper-export]

### C18's guard goes inside `measureContentHeight`, not at its callers

`measureContentHeight` returns early while the component is not effectively
visible. Placing the guard in the method covers all five of its callers at
once, including the `setMarkdown` path
([Markdown.ts:913](packages/lib/src/typescript/lib/component/display/Markdown.ts#L913))
that the phase-2 status pass flagged as the same bug's second door.[^why-guard-in-measure]

The precedent is one method away in the same file: `resyncCodeEditorWidths`
([Markdown.ts:1281-1291](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1281))
returns early on `!isEffectivelyVisible()`, and its `@remarks` already spells
out the same reasoning — a hidden subtree reads zero, and `setWidth`'s
changed-guard means a re-show never re-runs the method.

| Moment | Effectively visible | `measureContentHeight` | Reported height |
|---|---|---|---|
| `setWidth` during a layout pass | yes | runs | re-measured |
| theme toggle while on an inactive `Card` page | no | skipped | last good height kept (today: 0, permanently) |
| `setMarkdown` while on an inactive page | no | skipped | last good height kept (today: 0, permanently) |
| the page is shown again | yes | scheduled, runs on the next layout flush | re-measured |

### The re-measure is scheduled from the visibility hook, not performed in it

`onEffectiveVisibilityChange` fires once whenever this component's effective
visibility changes. On the *rising edge* — the call where `effective` is `true`,
the only signal a re-show gives — the hook gains one line,
`this.scheduleContentMeasure()`, placed after the visibility-kickoff drain and
before the existing `scheduleViewportPass()` call. The hook never calls
`measureContentHeight()` directly.[^why-scheduled-measure] The added line is
unconditional: every rising edge schedules a
measure.[^why-unconditional-remeasure]

`scheduleContentMeasure`
([Markdown.ts:1548-1555](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1548))
is the file's own existing deferral, already used by `loadCodeEditorUpgrade`
and `handleCodeEditorHeightChange`; it coalesces a burst of calls into one
`measureContentHeight` per layout flush. The hook itself mirrors
`AbstractCanvasSurface.onEffectiveVisibilityChange`
([AbstractCanvasSurface.ts:452-455](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L452)),
the reconcile-on-the-edge pattern `Markdown`'s own doc comment already cites.

### The two-pane case is proved in jsdom, not in the modelled harness

C19's regression test is a new `// @vitest-environment jsdom` file running
against the production DOM seam. The modelled offline source cannot express it:
its `querySelector` ignores the `root` argument entirely and returns only what
a test seeded globally for that selector string
([TestDOM.ts:1306-1314](packages/lib/tests/dom/TestDOM.ts#L1306)), so two roots
can never resolve to two different elements there.[^why-jsdom]

The precedent is
[tests/core/FocusTraversalCompositeWidgets.test.ts](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts),
whose header gives the same reason for the same pragma, and
[packages/docs/tests/DocsContent.test.ts](packages/docs/tests/DocsContent.test.ts),
which already drives `findActiveHeading` and `scrollToHeading` through real
elements under jsdom.

### The existing offline suites seed the selector instead of changing the harness

Ten staging sites across two offline suites resolve heading handles and stage
their rects. Each gains a `setQuerySelectorResult(headingSelector(id), handle)`
call so the modelled source can answer the lookup the production code now
makes. The modelled source itself is left alone.[^why-seed-offline]

---

## Public API

No exported signature changes. `findActiveHeading` and
`HeadingScrollTracker.scrollToHeading` keep their parameter lists; both already
take the scroll-owning element they will now scope to.

One new module-level function in
`packages/lib/src/typescript/lib/component/display/Markdown.ts`, declared
without the `export` keyword and exported from the file's trailing
`export { … }` block — the same shape `mapFenceLangToEditorId` uses
([Markdown.ts:148](packages/lib/src/typescript/lib/component/display/Markdown.ts#L148),
exported at
[Markdown.ts:2253-2256](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2253)):

```typescript
/**
 * The selector that resolves a heading element by id *within one pane's
 * subtree* — the read-side counterpart to `nextHeadingId`, which writes the
 * id. An attribute selector rather than `#id`, because a heading slug is
 * author content and may start with a digit, which `#` cannot carry without
 * a `CSS.escape` the seam's documented fallback does not provide.
 *
 * @param id - The heading id, as rendered onto the element.
 * @returns A selector matching exactly that id.
 *
 * @internal
 */
function headingSelector(id: string): string;
```

It is **not** added to
[component/display/index.ts:20](packages/lib/src/typescript/lib/component/display/index.ts#L20)
— consumers of the scoped lookup are `HeadingScrollTracker.ts` and the test
suites, both of which import from `~/component/display/Markdown.js` directly.

---

## Ordered Implementation Steps

1. **Add the helper.** In
   `packages/lib/src/typescript/lib/component/display/Markdown.ts`, add a plain
   (unexported-at-declaration) `function headingSelector(id: string): string`
   returning `` `[id="${DOM.source.escapeSelector(id)}"]` ``, with the JSDoc from
   `## Public API`. Place it immediately after `nextHeadingId`
   ([Markdown.ts:426-433](packages/lib/src/typescript/lib/component/display/Markdown.ts#L426)),
   its write-side counterpart. Add `headingSelector` to the `export { … }` block
   at [Markdown.ts:2250-2256](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2250),
   beside `mapFenceLangToEditorId` and under the same "not re-exported from the
   package barrel" comment. Do **not** touch `component/display/index.ts`.
   *Check:* `npm run typecheck` passes; `npm --prefix packages/lib run test`
   is still fully green (nothing calls the helper yet).

2. **Seed the offline `Markdown` suite.** In
   `packages/lib/tests/component/display/Markdown.test.ts`:
   - add `headingSelector` to the existing `~/component/display/Markdown` import
     ([line 2](packages/lib/tests/component/display/Markdown.test.ts#L2));
   - add `setQuerySelectorResult` to the existing `../../dom/TestDOM` import
     ([line 12](packages/lib/tests/component/display/Markdown.test.ts#L12));
   - inside `stageHeadings`' `forEach`
     ([lines 901-905](packages/lib/tests/component/display/Markdown.test.ts#L901)),
     after the existing `DOM.sink.apply(headingHandle, …)` call, add
     `setQuerySelectorResult(headingSelector(heading.id), headingHandle);`.

   *Check:* `npm --prefix packages/lib run test -- Markdown.test` is green
   (the seeds sit unused until step 5 switches the lookup).

3. **Seed the offline `MarkdownViewer` suite.** In
   `packages/lib/tests/component/display/MarkdownViewer.test.ts`:
   - import `headingSelector` from `~/component/display/Markdown` and
     `setQuerySelectorResult` from `../../dom/TestDOM`;
   - add a file-local helper beside `SOURCE`
     ([line 16](packages/lib/tests/component/display/MarkdownViewer.test.ts#L16)):

     ```typescript
     /** Stages a rendered heading's top and seeds the pane-scoped selector the offline source needs to resolve it. */
     function stageHeading(id: string, top: number): void {
         const handle = DOM.source.getElementById(id)!;

         DOM.sink.apply(handle, { style: { left: '0px', top: `${top}px`, width: '10px', height: '10px' } });
         setQuerySelectorResult(headingSelector(id), handle);
     }
     ```

   - replace each of the ten `DOM.sink.apply(DOM.source.getElementById(…)!, { style: … })`
     heading-staging lines with a `stageHeading(…)` call: lines
     [304](packages/lib/tests/component/display/MarkdownViewer.test.ts#L304),
     [331-332](packages/lib/tests/component/display/MarkdownViewer.test.ts#L331),
     [337](packages/lib/tests/component/display/MarkdownViewer.test.ts#L337),
     [371](packages/lib/tests/component/display/MarkdownViewer.test.ts#L371),
     [378-379](packages/lib/tests/component/display/MarkdownViewer.test.ts#L378),
     and [417-419](packages/lib/tests/component/display/MarkdownViewer.test.ts#L417).
     Keep every surrounding explanatory comment exactly where it is. Leave the
     `viewer._content.getElement(true)` pane stubs at lines 295 and 367 alone —
     those stage the pane, not a heading.

   *Check:* `npm --prefix packages/lib run test -- MarkdownViewer.test` is green.

4. **Write the C19 regression tests (red).** Create
   `packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts` with
   `// @vitest-environment jsdom` as the first line, plus a header comment
   explaining the pragma in the terms
   [FocusTraversalCompositeWidgets.test.ts](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts)
   uses. Mount each `Markdown`'s element with
   `DOM.sink.appendChild(DOM.source.getBody(), el)`. Cover cases J1-J4 from
   `## Expected Behaviour`.
   *Check:* J1 and J2 fail; J3 and J4 pass.

5. **Scope the two lookups (green).**
   - In `Markdown.ts`, `findActiveHeading`
     ([lines 2223-2227](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2223)),
     replace the `getElementById` + `contains` pair with
     `const el = DOM.source.querySelector(scrollElement, headingSelector(heading.id));`
     and the guard `if (!el) { continue; }`.
   - In `HeadingScrollTracker.ts`, `scrollToHeading`
     ([lines 109-113](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L109)),
     replace the same pair with
     `const heading = DOM.source.querySelector(scrollElement, headingSelector(id));`
     and the guard `if (!heading) { return; }`. Add `headingSelector` to that
     file's existing `~/component/display/Markdown.js` value import
     ([line 5](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L5)).

   *Check:* `grep -rn 'DOM.source.getElementById' packages/lib/src/typescript/lib/component/display/` — expect zero matches.
   All four suites green: the new jsdom file, `Markdown.test`,
   `MarkdownViewer.test`, and `npm -w packages/docs run test`.

6. **Update the two lookups' doc comments.** In `findActiveHeading`'s JSDoc
   ([Markdown.ts:2193-2213](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2193)),
   change the `@param scrollElement` description to say it is both the pane top
   the headings are compared against **and** the subtree they are resolved
   within, and add one sentence: a heading whose id is not inside
   `scrollElement` is skipped, so two panes rendering documents that share a
   heading name no longer resolve each other's elements. Make the matching edit
   to `scrollToHeading`'s JSDoc
   ([HeadingScrollTracker.ts:96-107](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L96)).
   Keep both comments' existing "mirrors the other one's technique"
   cross-references true.

7. **Write the C18 regression tests (red).** Append cases H1-H3 from
   `## Expected Behaviour` to the end of the
   `describe('Markdown content-height measurement', …)` block in
   `Markdown.test.ts`, after the last existing test
   ([ends at line 1569](packages/lib/tests/component/display/Markdown.test.ts#L1569))
   — the block-local `heightWrites` helper
   ([line 1533](packages/lib/tests/component/display/Markdown.test.ts#L1533))
   and the module-level `stubScrollHeight`
   ([line 1365](packages/lib/tests/component/display/Markdown.test.ts#L1365))
   are both in scope there. Drive visibility with
   `md.setDisplayed(false)` / `md.setDisplayed(true)` followed by
   `Component.flushEffectiveVisibility()`, as
   [Markdown.test.ts:698-699](packages/lib/tests/component/display/Markdown.test.ts#L698)
   already does; run the deferred measure by spying on `Component.afterNextLayout`
   and invoking the recorded callback, as
   [Markdown.test.ts:2169-2179](packages/lib/tests/component/display/Markdown.test.ts#L2169)
   already does.
   *Check:* H1, H2 and H3 all fail.

8. **Guard the measure and schedule the re-measure (green).** In `Markdown.ts`:
   - `measureContentHeight`
     ([lines 1044-1047](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1044)):
     widen the early return to
     `if (!element || !this.isEffectivelyVisible()) { return; }`. The guard goes
     **before** the `commitElementStyle()` call at line 1056, so a hidden
     component is charged no sink writes at all.
   - `onEffectiveVisibilityChange`
     ([lines 1478-1492](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1478)):
     after the `_awaitingVisibilityKickoffs` drain block and *before* the
     existing ordering comment and `this.scheduleViewportPass()` call, add
     `this.scheduleContentMeasure();` with a comment saying what it recovers (a
     theme change, a `setMarkdown`, or a first layout that ran while this
     subtree was hidden) and why nothing else does (no width changes on a
     re-show, so `setWidth`'s changed-guard never fires).

   *Check:* H1-H3 green, and the whole `Markdown.test` file green — in
   particular the two existing theme tests
   ([lines 1463](packages/lib/tests/component/display/Markdown.test.ts#L1463)
   and [1483](packages/lib/tests/component/display/Markdown.test.ts#L1483)),
   whose unparented `Markdown` is effectively visible and so is unaffected.

9. **Update the two measurement doc comments.** Extend
   `measureContentHeight`'s `@remarks`
   ([Markdown.ts:1034-1042](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1034))
   with the new skip and its recovery path, in the same terms
   `resyncCodeEditorWidths`'s `@remarks`
   ([Markdown.ts:1274-1279](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1274))
   already uses. Extend `onEffectiveVisibilityChange`'s doc comment
   ([Markdown.ts:1459-1470](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1459))
   to name the scheduled re-measure alongside the two queue drains it already
   describes.

10. **Documentation.** Add the two `## Fixed` → `### Components` entries from
    `## Documentation Impact` to
    [packages/lib/docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md),
    and the two one-sentence clarifications to
    [Markdown.md:67](packages/lib/docs/components/Markdown.md#L67) and
    [MarkdownViewer.md:53](packages/lib/docs/components/MarkdownViewer.md#L53).

11. **Run the full gate** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts` |
| Create | `packages/lib/tests/component/display/MarkdownHeadingScoping.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/display/MarkdownViewer.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownViewer.md` |

---

## Expected Behaviour

### C19 — heading resolution is scoped to the pane (J1-J4)

All four are unit-testable, in the new jsdom suite. Use pane A = `# Alpha\n\n# Shared`
rendered first and pane B = `# Beta\n\n# Shared` rendered second, both mounted
into the real document, each `Markdown`'s own root element standing in as the
scroll element. jsdom performs no layout, so every rect reads zero and
`findActiveHeading` resolves the *last* heading that passes — which is exactly
what makes the collision visible.

- **J1 — each pane resolves its own heading.**
  `findActiveHeading(rootA, headingsA)` is `"shared"`, and
  `findActiveHeading(rootB, headingsB)` is `"shared"`. Today the second call
  returns `"beta"`: `getElementById("shared")` hands back pane A's element and
  `contains(rootB, …)` rejects it, so pane B's last heading is skipped.
- **J2 — a minimap click works in the second pane.** A `HeadingScrollTracker`
  over a stub `HeadingScrollHost` for pane B, told to
  `scrollToHeading(rootB, "shared")`, fires its active-heading callback with
  `"shared"`. Today the callback never fires — the method returns early at the
  `contains` check, so the click silently no-ops.
- **J3 — scoping does not widen.** `findActiveHeading(rootB, [{ id: "alpha", text: "Alpha", depth: 1 }])`
  is `null`: `alpha` exists in the document, but not inside pane B.
- **J4 — a heading id that starts with a digit resolves.** A pane rendering
  `# 2026 Roadmap` resolves `"2026-roadmap"`, and the call does not throw. This
  guards the selector form: jsdom ships no `CSS` object, so
  `DOM.source.escapeSelector` takes its regex fallback and leaves the leading
  digit unescaped, which a `#`-prefixed selector could not survive.

Unchanged and already covered: the six geometry cases in
`describe('findActiveHeading')`
([Markdown.test.ts:891-973](packages/lib/tests/component/display/Markdown.test.ts#L891)),
the four viewer-level cases in `MarkdownViewer.test.ts`, and the scroll-tracking
cases in `packages/docs/tests/DocsContent.test.ts`. Rendered heading ids are
unchanged, so the id tests
([Markdown.test.ts:171-209](packages/lib/tests/component/display/Markdown.test.ts#L171))
and the `extractMarkdownHeadings` parity test
([Markdown.test.ts:263-278](packages/lib/tests/component/display/Markdown.test.ts#L263))
stay green untouched.

### C18 — a hidden `Markdown` is not measured, and is re-measured on re-show (H1-H3)

All three are unit-testable, in `Markdown.test.ts`. The modelled source reports
`scrollHeight === clientHeight` and cannot model a `display:none` subtree
reading zero, so each case stubs the seam read and asserts on the *reported
height* and on the *sink writes charged to the component* rather than on real
geometry.

- **H1 — a theme change while undisplayed neither measures nor writes.**
  Measure 300 at width 300, `setDisplayed(false)` and flush, re-stub the seam
  read to a different height, toggle the theme (and restore it). `getMinSize().height`
  is still 300, and `heightWrites(...)` over the writes made since the toggle is
  empty — no `height: auto` probe, no restore. Today the component measures
  through the toggle and caches whatever the hidden element reports.
- **H2 — the rising edge recovers a height that went stale while hidden.** A
  test of its own, repeating H1's setup: measure 300, hide, flush, re-stub the
  seam read to 700, toggle and restore the theme. Then `setDisplayed(true)`,
  `Component.flushEffectiveVisibility()`, and run the callback recorded by a
  `Component.afterNextLayout` spy. `getMinSize().height` becomes 700.
- **H3 — a `setMarkdown` that lands while hidden is recovered the same way.**
  Measure 300, hide, re-stub the seam read to 700, `setMarkdown('# A\n\nmore prose')`
  — `getMinSize().height` is still 300. Show, flush, run the deferred callback —
  it becomes 700.

Needs manual verification (the offline harness cannot produce a real
`display:none` geometry read, and the existing suite header already parks the
`height:auto` collapse as manual-verify only):

- **M1 — the recorded Loom reproduction.** Open a Markdown preview, switch to
  the source page so the `Card` undisplays the preview, toggle the theme, switch
  back. The preview must report its real height and scroll through the whole
  document. This is the case the register recorded as reporting height 0 and
  refusing to scroll.
- **M2 — two Dock panes previewing two files that share a heading name.** Each
  pane's minimap must highlight as that pane scrolls, and a click on either
  pane's minimap row must scroll that pane.

---

## Verification

Offline gate, all from the repository root:

```
npm run typecheck
npm --prefix packages/lib run typecheck:test
npm run lint
npm run test
npm -w packages/docs run test
npm run docs:api          # must finish with zero warnings — public JSDoc changed
npm run docs:llms:check
```

Targeted, while iterating:

```
npm --prefix packages/lib run test -- Markdown.test
npm --prefix packages/lib run test -- MarkdownViewer.test
npm --prefix packages/lib run test -- MarkdownHeadingScoping
```

Grep invariants:

```
grep -rn 'DOM.source.getElementById' packages/lib/src/typescript/lib/component/display/    # expect zero matches
grep -rn 'headingSelector' packages/lib/src/typescript/lib/component/display/index.ts      # expect zero matches
```

Manual checks — **each opens a full-screen window and must not be run without
the user's explicit go-ahead:**

- M1 and M2 above, in Loom.
- No-regression pass on the two QA witnesses, per
  [packages/qa/README.md](packages/qa/README.md)'s recorded baselines:
  `markdown-doc` must still hit M13 (`passes` with `seam=1` gives
  `seam.source.getElementRect` 2.00) and `markdown-editor` must still hit M19
  (`handleChange@MarkdownEditor` 1.00 per `type` unit). Neither panel mounts two
  `Markdown` instances or hides one, so neither can reproduce C18 or C19 — they
  are regression witnesses for the paths this change touches, not proof of the
  fixes.

---

## Documentation Impact

No symbol moves and no barrel entry changes: `headingSelector` is `@internal`
and stays out of
[component/display/index.ts](packages/lib/src/typescript/lib/component/display/index.ts),
so it never reaches the TypeDoc surface and cannot trip the
"links to X which is not included in the documentation" rule.

[packages/lib/docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md),
under `## Fixed` → `### Components`, two entries in the house style (bold
one-line summary, then what went wrong, then what changed, then whether a
consumer must act):

- **Two `Markdown` previews of documents that share a heading name no longer
  break each other's outline.** Heading ids are unique within one render but
  land in the one document-wide id space, and heading tracking resolved them
  with a document-wide lookup; in the second preview every heading resolved to
  the first preview's element and was discarded, so that preview's minimap
  never highlighted and its rows did not respond to clicks. Both readers now
  resolve a heading inside the scrolling pane they were given. Rendered ids,
  `extractMarkdownHeadings` and `#fragment` links are unchanged; no consumer
  action is needed.
- **A theme change while a `Markdown` is on a hidden page no longer leaves it
  reporting a height of zero.** The content-height measurement ran against a
  `display:none` element, where every geometry read reports zero, and nothing
  re-measured on the way back: a re-show changes no width, which is the only
  thing that previously triggered a re-measure. The measurement is now skipped
  while the component is not effectively visible and re-run once it becomes
  visible again, so the last good height stands in the meantime. The same
  recovery covers a `setMarkdown` that lands while hidden. No consumer action
  is needed.

[Markdown.md:67](packages/lib/docs/components/Markdown.md#L67) — after the
existing sentence about `-N` suffixes keeping ids unique within one render, add
one sentence: uniqueness is per render, not per page, so two `Markdown`
instances on one page can render the same id, and anything resolving a heading
element should scope the lookup to the instance's own subtree rather than
searching the whole document.

[MarkdownViewer.md:53](packages/lib/docs/components/MarkdownViewer.md#L53) — add
a clause to the heading-tracking paragraph: the lookup is scoped to the viewer's
own scrolling pane, so several viewers on one page track independently even when
their documents share heading names.

---

## Potential Challenges

- **The offline `querySelector` is seeded-only, so an unseeded staging site goes
  silently null rather than failing loudly.** Steps 2 and 3 seed all ten sites,
  and both the production code and the seeds build the selector with the same
  `headingSelector` helper, so the key cannot drift apart.
- **jsdom ships no `CSS` object at all.** `DOM.source.escapeSelector` therefore
  takes its regex fallback
  ([DOM.ts:2197-2206](packages/lib/src/typescript/lib/core/DOM.ts#L2197)), which
  does not escape a leading digit. The `[id="…"]` form is valid regardless;
  case J4 pins it.
- **A `Markdown` whose first layout runs while hidden now reports no measured
  height at all, rather than zero.** `getMinSize` and `getPreferredSize` already
  return the inherited base when `_measuredHeight` is `null`
  ([Markdown.ts:928-962](packages/lib/src/typescript/lib/component/display/Markdown.ts#L928)),
  which is the honest "not measured yet" answer; the rising edge then measures
  it for real.
- **The rising-edge measure runs on every show, including one where nothing
  changed.** `measureContentHeight` already suppresses the re-layout when the
  measured height is unchanged
  ([Markdown.ts:1091-1093](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1091)),
  so an unchanged page switch costs one coalesced forced read and no layout pass.
- **`findActiveHeading` is on a hot path** — up to one lookup per heading per
  native scroll event, per visible viewer. A scoped `querySelector` is a subtree
  walk where `getElementById` was a map hit. That cost is accepted here and
  removed wholesale by the separate `markdown-heading-scroll-cache` work, which
  replaces the per-tick lookup with handles captured at render time; do not
  pre-empt it in this plan.

---

## Critical Files

Read before implementing:

- [component/display/Glyphs.ts:153-198](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L153)
  — the precedent for a root-scoped id lookup through
  `DOM.source.querySelector` + `DOM.source.escapeSelector`.
- [component/display/Markdown.ts:1267-1291](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1267)
  — `resyncCodeEditorWidths` and its `@remarks`: the in-file precedent for the
  visibility guard, with the `setWidth`-changed-guard reasoning already spelled
  out.
- [component/display/Markdown.ts:1459-1493](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1459)
  — `onEffectiveVisibilityChange` as it stands, including the load-bearing
  ordering comment the new call must sit above.
- [component/display/AbstractCanvasSurface.ts:452-455](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L452)
  — the reconcile-on-the-edge shape `Markdown`'s hook already cites.
- [core/DOM.ts:1347-1354](packages/lib/src/typescript/lib/core/DOM.ts#L1347) and
  [core/DOM.ts:1084-1091](packages/lib/src/typescript/lib/core/DOM.ts#L1084)
  — the `querySelector` and `escapeSelector` seam contracts.
- [tests/dom/TestDOM.ts:1306-1314](packages/lib/tests/dom/TestDOM.ts#L1306) and
  [tests/dom/TestDOM.ts:1743-1745](packages/lib/tests/dom/TestDOM.ts#L1743)
  — the modelled `querySelector` and the `setQuerySelectorResult` seeding helper.
- [tests/core/FocusTraversalCompositeWidgets.test.ts:1-43](packages/lib/tests/core/FocusTraversalCompositeWidgets.test.ts#L1)
  — the jsdom-pragma component-test precedent, including the `mount` helper.
- [packages/docs/tests/DocsContent.test.ts:147-260](packages/docs/tests/DocsContent.test.ts#L147)
  — the existing jsdom suite that drives both changed lookups end to end.
- [tests/component/display/Markdown.test.ts:1352-1371](packages/lib/tests/component/display/Markdown.test.ts#L1352)
  — the measurement suite's header and `stubScrollHeight`, which state what is
  offline-inexpressible and why the new assertions are sink-write based.
- [tests/component/EffectiveVisibility.test.ts:1-30](packages/lib/tests/component/EffectiveVisibility.test.ts#L1)
  — how `Component.flushEffectiveVisibility()` is driven offline.

---

## Non-Goals

- **Instance-prefixed heading ids.** Rendered ids keep their current format —
  see *C19 is fixed by scoping the lookup, not by scoping the ids* and its
  footnote.
- **Caching heading handles or heading offsets.** Publishing each heading's
  `Handle` from the render walk, and resolving the active heading from a cached
  offset by binary search, belongs to the separate
  `markdown-heading-scroll-cache` work. That change alters a public signature
  and a public interface; this plan alters neither.
- **Re-syncing live code-editor widths on the rising edge.** A theme change
  while hidden also leaves every upgraded `CodeEditor` at a width computed from
  the old theme's `ch` metric. `resyncCodeEditorWidths`' own `@remarks`
  documents skipping as intended and "leaves the last-good width intact" as the
  accepted outcome, and the register does not carry it. It is a distinct defect;
  leave the method alone.
- **Changing the modelled DOM source.** Making the offline `querySelector`
  root-aware would touch shared test infrastructure every suite depends on.
- **Changing the QA panels or their recorded baselines.** Neither panel mounts
  two `Markdown` instances or hides one; adding either would leave an
  unbaselined panel that this plan cannot run.

---

## Notes

[^why-not-prefix]: Prefixing each heading id with the component id was the other
    candidate, and it is rejected because the current id format is load-bearing
    in four places that would all break. (1) `extractMarkdownHeadings` is a
    public export whose whole contract is that it computes the ids *without
    building any DOM* — `MarkdownHeading.id` is documented at
    `Markdown.ts:2099` as "byte-identical to the `id` `Markdown` renders" — so a
    per-instance prefix would force an instance argument onto a pure function
    and break every consumer of it (`MarkdownViewer`, `MarkdownMinimap`,
    `DocsSidebar`). (2) Heading ids are URL fragments: `DocsShell.showPath(path,
    fragment)` and `DocsContent.onScrollToFragment` navigate to them, and
    `DocsContent`'s own comment at `:475-479` notes that the *browser* resolves
    a fragment against the rendered id natively on a cold load. Every existing
    deep link would stop working, and no prefix is stable across reloads.
    (3) In-document anchor links go through the same ids —
    `DocsContent.resolveLink:534` turns an authored `[x](#anchor)` into
    `path#anchor`. (4) Five existing tests pin the exact rendered id strings
    (`Markdown.test.ts:171-209`, `:263-278`), and `Markdown.md:67` documents the
    scheme to consumers. The scoped lookup costs none of that: it changes two
    guard clauses and no rendered output.

[^why-attribute-selector]: `Glyphs` uses `` `#${DOM.source.escapeSelector(id)}` ``
    and can, because glyph ids are library-controlled and carry a fixed
    alphabetic prefix. Heading ids are author content: `## 2026 Roadmap`
    slugifies to `2026-roadmap`, and `#2026-roadmap` is not a valid selector —
    `querySelector` throws `SyntaxError` rather than returning `null`. In
    production `CSS.escape` would rescue it (`\32 026-roadmap`), but the seam's
    `escapeSelector` documents a fallback for engines without `CSS`
    (`DOM.ts:2197-2206`), and that fallback — `value.replace(/[^\w-]/g, …)` —
    leaves a leading digit alone. jsdom is exactly such an engine: it exposes no
    `CSS` object at all, so the regression suite would throw where a browser
    would not. `[id="…"]` is valid for every id string under both paths, and
    `CSS.escape`'s own output stays correct inside a quoted attribute value
    (`"\32 026-roadmap"` unescapes to `2026-roadmap`), so the helper is right
    whichever branch `escapeSelector` takes. A slug can also be empty (a heading
    of pure punctuation); `[id=""]` is valid, where a bare `#` is not.

[^precedent-helper-export]: Duplicating the one-line template at both call sites
    was the alternative. It is rejected for the same reason `nextHeadingId`
    exists rather than two copies of the slug-plus-counter logic: the read side
    and the write side have to agree on the id exactly, and a second copy is a
    place for them to drift. Exporting it also lets the offline suites seed the
    *same* selector string the production code will pass, instead of
    hand-writing a key that can silently stop matching. `HeadingScrollTracker`
    already imports `findActiveHeading` from `~/component/display/Markdown.js`
    directly, so the import direction is unchanged and no cycle is introduced —
    `Markdown.ts` must not import from `HeadingScrollTracker.ts`, which is why
    the helper cannot live there.

[^why-guard-in-measure]: `measureContentHeight` has five callers — the
    `onFirstLayout` seed (`:746`), `setMarkdown` (`:913`), `setWidth` (`:979`),
    `onThemeChanged` (`:992`) and `onScheduledMeasure` (`:1566`). Guarding at
    `onThemeChanged` alone would close the recorded reproduction and leave the
    `setMarkdown` door open, which the phase-2 status pass explicitly flagged.
    Guarding inside the method closes all five at once and needs one edit. The
    guard sits before the first `commitElementStyle()` call so a hidden
    component is charged no sink writes either — the F25.6 probe measured 12
    writes charged to a hidden `Markdown` on one theme toggle. Skipping the
    style commit is safe: a hidden component is not laid out, and
    `LayoutManager.commitBounds` re-enables auto-commit at the end of the pass
    that does assign a width (`LayoutManager.ts:638`), which flushes whatever
    that pass queued (`Component.ts:1950-1956`).

[^why-scheduled-measure]: Calling `measureContentHeight()` directly from the
    rising edge can reproduce the bug it is meant to fix. The edge fires from
    the module-level rAF-coalesced visibility flush (`Component.ts:361-371`),
    whose position relative to the rAF-coalesced *layout* flush is not fixed —
    both are separate `requestAnimationFrame` registrations. Worse, the
    ancestor that un-hid this subtree (a `Card` or `Tab` page) has its own style
    writes buffered, and `commitElementStyle()` flushes only *this* component's
    inline style (`Component.ts:1964-1970`), so a synchronous `scrollHeight`
    read there can still land against a subtree the engine still has at
    `display:none` and cache 0 all over again. `scheduleContentMeasure` defers
    the read to `Component.afterNextLayout`, which runs after the layout pass
    that commits the re-shown geometry, and coalesces a burst of edges into one
    measure. Registering it *before* `scheduleViewportPass()` also fixes the
    order of the two deferred callbacks: the measure's reflow can move a queued
    code block relative to the fold, and the viewport pass should see the
    settled geometry rather than re-running a flush later — which is the same
    reason `onScheduledMeasure` already re-schedules a viewport pass after
    measuring.

[^why-unconditional-remeasure]: Tracking whether anything actually changed while
    hidden — a dirty flag set by `onThemeChanged` and `setMarkdown` when the
    guard fires — would skip the measure on a show where nothing moved. It is
    not worth the extra state: a page switch already costs a full layout pass,
    `measureContentHeight` suppresses its own re-layout when the height is
    unchanged, and a flag is one more thing to keep in sync with a fifth caller
    added later.

[^why-jsdom]: The modelled source's `querySelector` ignores its `root` argument
    and answers from a single global selector→handle map, so seeding it for two
    roots is impossible: the second seed overwrites the first, and both panes
    resolve to the same element whether the fix is present or not. A test
    written there would pass against the broken code. The alternative —
    teaching the modelled source a real root-scoped id lookup — means turning
    its single-valued `_byId` map into a multimap and reworking `getElementById`
    alongside it, in shared infrastructure every suite depends on, and it would
    prove the fix against a model written in the same change. jsdom runs the
    production seam against real elements with real `contains` and real
    selector matching, so the assertion is about the library rather than about
    the harness. jsdom performs no layout, but the two-pane collision does not
    need any: every rect reads zero, `findActiveHeading` walks to the last
    heading that passes, and that last heading is the colliding one.

[^why-seed-offline]: The ten seeded sites are all *fixtures*, not assertions:
    each already resolves a heading handle and stages its rect, and the seed is
    one more line beside that. The suites' own subject matter is unaffected —
    they pin `findActiveHeading`'s top-crossing and max-scroll rules and the
    viewer's `activeheadingchange` emission, none of which this change touches.
    Scoping itself is proved by the jsdom suite and by
    `packages/docs/tests/DocsContent.test.ts`, which already runs both changed
    lookups against real elements, so nothing is left resting only on the
    seeded model.

---

## Implementation Notes

Implemented as planned — no step was skipped or redesigned. Four things the
plan did not anticipate are recorded here.

**The `[id="…"]` selector form is load-bearing for the fix itself, not only
for the leading-digit case.** The plan justified it against `#id` solely on
the grounds that a slug may start with a digit
(*[^why-attribute-selector]*). Verified during implementation: jsdom's
selector engine resolves an `#id` selector through the document's id map and
then filters by containment, so `paneB.querySelector('#shared')` returns
`null` outright when an *earlier* element in the document carries the same
id — the exact collision this plan is about. A deliberate revert of
`headingSelector` to the `#` form failed J1 and J2 as well as J4, where the
plan predicted only J4. `[id="…"]` performs a real subtree walk and is
correct under both engines, so the plan's choice stands; only its stated
reason was incomplete.

**H1's "charged no writes" assertion is driven through the component's own
`onThemeChanged`, not the global `ThemeManager` broadcast.** Every live
`Markdown` subscribes to `ThemeManager` and none of the earlier tests in
`Markdown.test.ts` dispose theirs, so one broadcast re-measures every
instance the file has ever built (218 `height: auto` writes were observed).
Because `installTestDOM` restarts handle numbering per test, those writes
carry handle values that collide with the test's own, and no per-handle
filter can separate them. H1 therefore keeps the real broadcast for its
height assertion — the half that reads this object — and calls this
component's own theme handler for the write assertion. That handler is the
same door C18 comes through: `ThemeManager.onThemeChange` invokes exactly
it. The assertion was confirmed non-vacuous by removing the guard, which
produced `['auto', '300px']` — the probe and its restore.

**No test pins the guard's position relative to `commitElementStyle()`.**
The plan places the guard ahead of that call so a hidden component is
charged no sink writes at all (*[^why-guard-in-measure]*), and the
implementation does so. Moving the guard to just after the call was tried
and left H1 green: at that point in this scenario nothing is queued, so the
commit writes nothing observable. The placement rests on the plan's
reasoning rather than on a regression test.

**`npm run docs:api` does not finish with zero warnings, and did not before
this change.** `## Verification` asks for zero. The start point (`121ce9db`)
reports `0 errors and 14 warnings`, and so does this branch — the same 14,
none naming a symbol this plan touches. `headingSelector` stays `@internal`
and out of the barrel as designed, so it adds no TypeDoc surface. The
achievable invariant is "no new warnings", which holds.

**Offline gate.** Measured at the start point: 478 test files, 7783 passed +
2 todo. On this branch: 479 files, 7790 passed + 2 todo — exactly J1-J4 plus
H1-H3, in one new file. `typecheck`, `typecheck:test`, `lint`,
`packages/docs` tests (2601) and `docs:llms:check` are all clean. M1 and M2
remain unproven: both need a real browser, and neither was run.
