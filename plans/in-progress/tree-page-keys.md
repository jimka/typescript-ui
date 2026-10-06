---
depends-on: [scroll-reveal-geometry-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts    # feature/spatial-navigation-redesign adds eight lines below its imports
  - packages/lib/docs/concepts/accessibility.md               # also edited by feature/spatial-navigation-redesign and the sibling plans dialog-aria-semantics, nested-scroll-reveal, focus-history-transient-layers
  - packages/lib/docs/reference/changelog/next.md             # also edited by all four
---

# Tree Page Keys — Implementation Plan

## Overview

`PageUp` and `PageDown` do nothing in a [`Tree`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L229). Its key handler does not list them, so it returns without handling the key and the browser's own default is left to run.[^today] `List`, `MultiSelectList`, `Table` and `TreeTable` all move by a page. SQLAdmin's database navigator is a large `Tree`, so the gap is met daily.

This plan makes three changes. All are in the library; the first two are in `Tree.ts`.

1. **`Tree` pages.** `PageDown` / `PageUp` move the current row by one page, select it and scroll it into view. With `Shift` they extend the selection.
2. **A `Shift` move with no anchor starts a range.** Today `Shift+ArrowDown` pressed three times in a tree with nothing selected leaves one row selected, not three. The new `Shift+PageDown` would have the same fault.
3. **The docs catch up with the code.** Keys that work but are not written down get written down, and one sentence that promises a behaviour the code never had is corrected.

No public API changes. `TreeTable` needs no code: it already pages.

Three terms are used throughout.

- The **current row** is the row the keyboard is on. `Tree` keeps it in `_focusNode`, draws the focus ring on it and names it with `aria-activedescendant`. The tree's own element holds DOM focus; rows never do.
- The **anchor** is the fixed end of a `Shift` range: the row last selected by a plain click or a plain key. `Tree` keeps it in `_anchorNode` and returns it from `getSelectedNode()`.
- A **page** is the number of whole rows the scroll viewport shows, and at least one. [`VirtualRowView.computePageSize()`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L287) returns it.

The plan rests on a survey of every collection widget's keys against its docs and its WAI-ARIA pattern. The full widget × key table is in [the addendum](#addendum-keyboard-survey). What the survey found:

| # | Finding | Kind | This plan |
|---|---|---|---|
| 1 | `Tree` ignores `PageUp` / `PageDown` | missing key | adds them |
| 2 | `Tree`: a `Shift` move with no anchor never starts a range | a documented key that misbehaves | fixes it |
| 3 | `TreeTable` already pages, through the table body it extends | no gap | pins it with tests |
| 4 | `TreeTable.md` says `ArrowLeft` / `ArrowRight` fall back to moving the current cell; they never do | documented, not implemented | corrects the sentence; the behaviour is a Non-Goal |
| 5 | `MultiSelectList`: `Shift` and `Ctrl` work with `Home`, `End`, `PageUp`, `PageDown`, `Space` and `Enter`; only the arrow keys are documented | implemented, not documented | documents them |
| 6 | `List`: `Ctrl` with a navigation key moves focus without selecting; not documented | implemented, not documented | documents it |
| 7 | Accordion headers handle `ArrowUp` / `ArrowDown` / `Home` / `End`; no page says so | implemented, not documented | documents them |
| 8 | Every other gap needs a design decision | — | listed in `## Non-Goals` with the evidence |

Every line number in this plan is that of commit `27c9b7157`, the tip of `feature/scroll-reveal-geometry-fixes`.

---

## Architecture Decisions

### `Tree` pages the way the table body does — current row ± one page, then reveal

The two new branches in [`Tree._onKeyDown`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1890) compute a target row and hand it to the same two methods the `Home` / `End` branch uses. The target is the current row's index plus or minus `this.computePageSize()`, clamped to the first and last visible row. With no current row, the target is the first row.

The arithmetic mirrors [`Body.onKeyDown`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3063), which does the same for `Table` and `TreeTable`. `Tree` and `Body` both extend `VirtualRowView`, so `computePageSize()` is already the tree's own inherited method.[^page-from-current]

For a tree of 60 rows that shows 5 (120 px high, 24 px rows):

| Current row | Key | New current row | Why |
|---|---|---|---|
| none | `PageDown` or `PageUp` | 0 | no current row: the first row, as for the arrow keys |
| 0 | `PageDown` | 5 | 0 + 5 |
| 10 | `PageUp` | 5 | 10 − 5 |
| 3 | `PageUp` | 0 | clamped at the first row |
| 57 | `PageDown` | 59 | clamped at the last row |
| 59 | `PageDown` | 59 | already last: nothing moves |

`PageUp` and `PageDown` are not part of the WAI-ARIA tree pattern. They are the library's own convention for a scrolling list of rows.[^not-apg]

### Selection follows through the tree's two existing move methods

A plain page key calls [`_selectAtIndex(target)`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1815). A page key with `Shift` calls [`_extendSelectionTo(target)`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1844). No selection, scroll or ARIA code is added: those two methods already select, scroll the row into view, render, update `aria-activedescendant` and fire `"selection"` only when the selection changed.

`Tree` is always multi-select, so `Shift` always extends. The new branches read `e.shiftKey` and no other modifier, like the arrow, `Home` and `End` branches beside them.[^modifiers]

### A handled key is prevented and never stopped — also at the first and last row

`_onKeyDown` already ends with `return { prevent: true };` for every key in its `navigable` set. `PageUp` and `PageDown` join that set and get the same result. *Prevented* means the browser's default action does not run. *Not stopped* means the key still reaches listeners on the tree's ancestors.

| State | Key | Tree's current row | `preventDefault` | An ancestor's `keydown` listener |
|---|---|---|---|---|
| row 10 of 60 | `PageDown` | moves to 15 | called | runs |
| last row | `PageDown` | stays | called | runs |
| first row | `PageUp` | stays | called | runs |
| empty tree | `PageDown` | — | not called | runs |
| any key while `SpatialNavigation.claimsKey(e)` is true | — | stays | not called | runs |

`List` does the same: [`handleNavigationKey`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2176) calls `preventDefault()` before it clamps, and its caller returns no stop. The table body returns `{ prevent: true }` after clamping too.[^prevent-not-stop]

### A `Shift` move with no anchor is a plain move

`_extendSelectionTo(index)` gains one rule. When no anchor is among the visible rows, the method calls `_selectAtIndex(index)` and returns. The row becomes the anchor, and the next `Shift` move extends from it.

"No anchor among the visible rows" covers three states: nothing was ever selected, the anchor's node was removed, and the anchor is hidden under a collapsed node.

| Start | Keys | Selection today | Selection with this plan |
|---|---|---|---|
| nothing selected | `Shift+ArrowDown` ×3 | row 0, then row 1, then row 2 — one row each time | row 0, then 0–1, then 0–2 |
| nothing selected | `Shift+PageDown` ×2 (5 rows per page) | (key ignored) | row 0, then 0–5 |
| anchor on row 2, current row 2 | `Shift+PageDown` | (key ignored) | 2–7 |

The rule mirrors the tree's own [`_handleClick`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2015), where a `Shift`-click with no anchor is a plain click.[^anchor-rule]

### `TreeTable` gets tests, not code

[`TreeBody.onKeyDown`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L929) handles `ArrowLeft` and `ArrowRight` and passes every other key to `Body.onKeyDown`, which pages. The new test file pins that behaviour so a later change to either class cannot drop it unseen.[^treetable-inherits]

`Shift` does not extend in a `Table` or `TreeTable`: their arrow keys always select one row, and so do their page keys. This plan does not change that.

### One new test file, with real key events

All cases go in a new `packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts`. It mirrors [`KeyboardContextMenu.test.ts`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L176) in the same folder: the same `Tree` and `TreeBody` fixtures, real `keydown` events through `DOM.sink.dispatchEvent`, and the same teardown.[^one-test-file]

### The accessibility page gains one section, placed before "Building an accessible custom widget"

The new section, `## Keys in trees, lists and tables`, holds a small widget × key table and the prevented-not-stopped rule. It goes directly above the line `## Building an accessible custom widget`. No existing line of the page is edited.[^a11y-spot]

### This plan and `feature/spatial-navigation-redesign` merge without a hand edit

`feature/spatial-navigation-redesign` is unmerged and independent of this plan, and the user will merge both. The edits here are kept inside two methods of `Tree.ts`, far from that branch's hunk.

| File | `spatial-navigation-redesign` changes | This plan changes | Expected on merge |
|---|---|---|---|
| `component/tree/Tree.ts` | adds an import and a `registerNavigationLandingRing('[role="tree"]')` call below the imports (line 17) | `getSelectedNode` JSDoc (:619), `_extendSelectionTo` (:1839–1866), `_onKeyDown` (:1878–1921) | clean; this plan's line numbers shift by +8 if that branch merges first, so find each symbol by name |
| `docs/concepts/accessibility.md` | the tab-strip paragraph (:76–82) and the "Spatial focus navigation" section | one new section above `## Building an accessible custom widget` (:245) | clean: the two are separated by the unchanged code example that ends the spatial section |
| `docs/reference/changelog/next.md` | a `### Core` block under `## Changed`, entries under `## Added` → `### Core` | two entries at the end of `## Fixed` → `### Components` | clean against that branch; a sibling plan that appends at the same spot conflicts — keep both entries |
| `component/table/Body.ts`, `TabBar.ts`, `AccordionHeader.ts` | small additions | nothing | no overlap |

`feature/spatial-navigation-redesign` starts a spatial move level with the row named by the tree's `aria-activedescendant`. `_selectAtIndex` and `_extendSelectionTo` already update that attribute, so a move made after `PageDown` starts from the row `PageDown` landed on. Nothing in `feature/spatial-navigation-redesign` needs an edit.[^merge]

---

## Internal Structure

### `Tree._onKeyDown` — two edits

The `navigable` line ([:1893](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1893)) becomes:

```typescript
        const navigable = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp']);
```

Two branches are inserted after the `End` branch (which ends on line 1921) and before `} else if (e.key === 'ArrowRight') {` (line 1923). The result reads:

```typescript
        } else if (e.key === 'End') {
            const last = flatRows.length - 1;
            e.shiftKey ? this._extendSelectionTo(last) : this._selectAtIndex(last);

        } else if (e.key === 'PageDown') {
            const next = focusIdx < 0 ? 0 : Math.min(focusIdx + this.computePageSize(), flatRows.length - 1);
            e.shiftKey ? this._extendSelectionTo(next) : this._selectAtIndex(next);

        } else if (e.key === 'PageUp') {
            const prev = focusIdx < 0 ? 0 : Math.max(focusIdx - this.computePageSize(), 0);
            e.shiftKey ? this._extendSelectionTo(prev) : this._selectAtIndex(prev);

        } else if (e.key === 'ArrowRight') {
```

`computePageSize()` is called inside the two branches only, so no other key asks for it.

### `Tree._extendSelectionTo` — the whole method after the edit

```typescript
    /**
     * Extends the range selection from `_anchorNode` to `index`, moving only the focus end.
     * With no anchor among the visible rows there is no range to extend, and
     * the call is a plain {@link _selectAtIndex}: the row at `index` becomes
     * the anchor.
     *
     * @param index - Zero-based index into `_flatRows` for the new focus position.
     */
    private _extendSelectionTo(index: number): void {
        if (index < 0 || index >= this._flatRows.length) {
            return;
        }

        const anchorIdx = this._anchorNode
            ? this._flatRows.findIndex(r => r.node === this._anchorNode)
            : -1;

        // No anchor among the visible rows — none set yet, its node removed,
        // or hidden under a collapsed node — so there is no range to extend.
        // The move is a plain one, as a Shift-click with no anchor is a plain
        // click.
        if (anchorIdx < 0) {
            this._selectAtIndex(index);

            return;
        }

        // As in `_selectAtIndex`: only a keyboard move can reach an entering row.
        this.settleRowMotionIfEntering(index);

        const before = new Set(this._selectedNodes);

        this._rangeSelect(anchorIdx, index);
        this._focusNode = this._flatRows[index].node;

        this._updateSelectionStyle();
        this._scrollIntoView(index);
        this.renderWindow();
        this._updateActiveDescendant();
        this._notifySelectionChange(before);
    }
```

Only the top half changes: the `anchorIdx` fallback moves from `: index` to `: -1`, the early return is new, and `_rangeSelect` takes `anchorIdx` directly. The last five calls are untouched.

---

## Ordered Implementation Steps

Work test-first. Step 1 writes the tests and watches the right ones fail; steps 2–3 make them pass.

1. **New test file.** Create `packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts` with the harness in `## Verification` and every case in `## Expected Behaviour`.

   Run `cd packages/lib && npx vitest run tests/component/shared/KeyboardRowNavigation.test.ts`.

   Check: P1–P5, S1–S3, E2–E4, E6–E9 and A1–A5 fail. E1, E5 and TT1–TT4 pass, because today's code already behaves that way there.

2. **`Tree._onKeyDown`.** In [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1890):
   - Make the two edits in `## Internal Structure`.
   - In the method's JSDoc, add a bullet after the `Home` / `End` bullet (line 1886): `` * - `PageDown` / `PageUp` — move down/up by one page of rows (plain) or extend range by a page (Shift); not part of the ARIA pattern, they follow `List` and the table body ``. Wrap it to the file's comment width.

   Check: P1–P5, S1–S3, E2–E4 and E6–E9 pass. A1–A5 still fail.

3. **`Tree._extendSelectionTo` and `getSelectedNode`.** In the same file:
   - Replace [`_extendSelectionTo`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1844) and its JSDoc (lines 1839–1866) with the block in `## Internal Structure`.
   - In the JSDoc of [`getSelectedNode`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L624) (line 619), replace "(the last node selected by a plain click or arrow key without Shift)" with "(the last node selected by a plain click or a navigation key without Shift, or by one with Shift while there was no anchor to extend from)". Re-wrap the sentence.

   Check: every case in the new file passes.

4. **Neighbouring tests.** `cd packages/lib && npx vitest run tests/component/tree tests/component/shared tests/component/table/TreeBody.test.ts tests/component/display`. Check: all pass, with no edit to an existing test file.

5. **Grep checks**, from `packages/lib`:
   - `grep -n "'PageDown'\|'PageUp'" src/typescript/lib/component/tree/Tree.ts` — exactly three lines: the `navigable` line and the two branch conditions.
   - `grep -n "this.computePageSize()" src/typescript/lib/component/tree/Tree.ts` — exactly two lines.
   - `grep -n "anchorIdx < 0 ? index" src/typescript/lib/component/tree/Tree.ts` — no output.
   - `git diff --stat -- src` — one file, `component/tree/Tree.ts`.

6. **Docs and changelog.** Make the edits in `## Documentation Impact`.

7. **Full verification.** Run the commands and the manual cases in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/shared/KeyboardRowNavigation.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/MultiSelectList.md` |
| Modify | `packages/lib/docs/layouts/Accordion.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`VirtualRowView.ts`, `Body.ts`, `TreeBody.ts`, `AbstractSelectableList.ts`, `MultiSelectList.ts`, `Accordion.ts` and every existing test file are not edited.

---

## Expected Behaviour

Every numbered case is testable offline unless it is in the *Needs manual verification* table. Offline means the modelled DOM (`installTestDOM`), which has no layout engine.

### How offline tests get row geometry

| Input | Where it comes from offline |
|---|---|
| the tree's viewport height | the tree's committed size: `tree.getElement(true)`, then `setWidth(200)` and `setHeight(120)`, then `setNodes(…)`. The `VirtualScroller` computes its viewport from those; no rectangle is staged. `(tree as any)._scroller.getViewportHeight()` reads it back |
| the row height | fixed: 24 px in a `Tree`, 20 px in a table body offline |
| a horizontal scrollbar | one label wider than the tree. Use `'Hello World Hello World Hello World Hello World Hello World'`, as [`Tree.test.ts:1255`](../packages/lib/tests/component/tree/Tree.test.ts#L1255) does; the scroller then takes the bar's 12 px track out of the viewport |
| the scroll position | `(tree as any)._scroller.getScrollY()`. `(tree as any).setScrollY(n)` writes it |
| a key press | `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key, shiftKey }))` on the widget's own element, after `DOM.sink.focus(el)` |

### Fixtures and readers

- **`F60`** — 60 root nodes `{ label: 'Node ' + i }`, tree 200 × 120. Five rows fit, so a page is 5.
- **`mountTree(nodes, height = 120)`** — `track(new _Tree())`, `getElement(true)`, `setConnected(el, true)`, `setWidth(200)`, `setHeight(height)`, `setNodes(nodes)`, `(tree as any).renderWindow()`, `DOM.sink.focus(el)`. This is the `beforeEach` of [`KeyboardContextMenu.test.ts:201`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L201) as a function.
- **`press(el, key, init?)`** — dispatches the key and returns how many times its `preventDefault` ran. Replace the event's `preventDefault` with a counter before dispatch, as `contextMenu()` does in that file ([:123](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L123)).
- **current row** — the index of `(tree as any)._focusNode` in the test's own copy of the node array; −1 when it is `null`.
- **selection** — `tree.getSelectedNodes()` mapped to those indices, sorted. "2–7" below means rows 2 to 7 inclusive.
- **anchor** — `tree.getSelectedNode()`.

### `Tree` — paging (fixture `F60`)

Each case starts from a fresh tree with no current row unless it names an earlier case.

| # | Keys, in order | Current row after each | Selection after each | `scrollY` after each |
|---|---|---|---|---|
| P1 | `PageDown`, `PageDown`, `PageDown` | 0, 5, 10 | [0], [5], [10] | 0, 24, 144 |
| P2 | P1, then `PageUp`, `PageUp`, `PageUp` | 5, 0, 0 | [5], [0], [0] | 120, 0, 0 |
| P3 | `End`, `PageDown`, `PageUp` | 59, 59, 54 | [59], [59], [54] | 1320, 1320, 1296 |
| P4 | `PageUp` | 0 | [0] | 0 |

| # | Also assert |
|---|---|
| P5 | In P1–P4 every `PageDown` and `PageUp` press calls `preventDefault` exactly once. A `"selection"` listener runs once per press that changed the selection: 3 times in P1, and not for the third press of P2 nor the second press of P3. After each press, `tree.getAria().getActiveDescendant()` equals `(tree as any)._focusPoolRow().getId()` |

### `Tree` — paging with `Shift` (fixture `F60`)

| # | Keys, in order | Current row after each | Selection after each | `scrollY` after each | Anchor |
|---|---|---|---|---|---|
| S1 | `ArrowDown` ×3, then `Shift+PageDown`, `Shift+PageDown` | 2, then 7, 12 | [2], then 2–7, 2–12 | 0, then 72, 192 | row 2 throughout |
| S2 | S1, then `Shift+PageUp` ×3 | 7, 2, 0 | 2–7, [2], 0–2 | 168, 48, 0 | row 2 throughout |
| S3 | S2, then `PageDown` | 5 | [5] | 24 | row 5 |

### `Tree` — edges

| # | Given | Then |
|---|---|---|
| E1 | `mountTree([])`; `PageDown`, `PageUp` | neither press calls `preventDefault`; nothing is selected; no `"selection"` event |
| E2 | three root nodes; `PageDown`, `PageDown`, `PageUp` | current row 0, 2, 0; `scrollY` stays 0 |
| E3 | `F60` nodes at height 10 (less than one row) | `(tree as any).computePageSize()` is 1; `PageDown`, `PageDown` → current row 0, 1 |
| E4 | 60 nodes, the first labelled with the wide label above, the rest `'H'` | the viewport height is 108 and `computePageSize()` is 4; `PageDown`, `PageDown` → current row 0, 4; `scrollY` 0, 12 |
| E5 | `F60`; `vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true)`; `PageDown` | `preventDefault` not called; no current row; no `"selection"` event |
| E6 | `F60`; `Home`; `(tree as any).setScrollY(600)`; `PageDown` | current row 5; `scrollY` 120 — the page is counted from the current row, not from what is in view |
| E7 | nodes `A` (children `a0`–`a3`), `B`, `C`, `D`; `tree.expandNode(A)` before `renderWindow()`; `ArrowDown`, `PageDown`, `PageDown` | the selected node is `A`, then `B`, then `D` — a page counts visible rows at any depth: 8 rows, 5 per page |
| E8 | `F60` tree added to a `new Container()` whose element is rendered and connected, with `Event.addSubtreeListener(parent, 'keydown', spy)`; `PageDown`, `End`, `PageDown` | the spy ran three times, with keys `PageDown`, `End`, `PageDown`; each press called `preventDefault` once. Remove the listener at the end of the test |
| E9 | a `new _Tree()` never rendered, `setNodes` of 10 nodes; `(tree as any)._onKeyDown({ key: 'PageDown', shiftKey: false })` twice | `computePageSize()` is 1; the selected node is row 0, then row 1 |

### `Tree` — a `Shift` move with no anchor

| # | Given | Then |
|---|---|---|
| A1 | `F60`; `Shift+ArrowDown` ×3 | selection [0], then 0–1, then 0–2; the anchor is row 0 after each press; three `"selection"` events |
| A2 | `F60`; `Shift+PageDown` ×2 | selection [0], then 0–5; the anchor is row 0 |
| A3 | `F60`; `Shift+End` | selection [59]; the anchor is row 59 |
| A4 | ten root nodes, with `all = [...nodes]` kept by the test; `ArrowDown`, `Shift+ArrowDown` ×2; then `tree.removeNode(all[0])`; then `Shift+ArrowDown` ×2 | before the removal: selection `all[0..2]`, anchor `all[0]`. After it: `getSelectedNode()` is `null`. After the next press: selection [`all[3]`], anchor `all[3]`. After the last: selection `all[3]`, `all[4]` |
| A5 | nodes `A` (children `a0`, `a1`), `B`, `C`; `tree.expandNode(A)`; `ArrowDown` ×2 (current row `a0`); `(tree as any)._onToggle(A)` to collapse it; `Shift+ArrowDown` ×2 | after the first press: selection [`A`], anchor `A`. After the second: selection `A`, `B`, anchor `A` |

The existing cases for an anchored and an unanchored `Shift`-click ([`Tree.test.ts:3962–3990`](../packages/lib/tests/component/tree/Tree.test.ts#L3962)) pass without an edit.

### `TreeTable` — already paging (pinned, not changed)

Fixture `TB60`: the model, spec and mounting of case TB2 in [`KeyboardContextMenu.test.ts:717`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L717), with 60 root records `{ id: i + 1, parent: null, name: 'r' + i }`, body 300 × 100, `renderWindow(300, [100, 100, 100])`. The current row is `(body as any).getVisibleRecords().indexOf(body.getSelectedRecord())`.

| # | Given | Then |
|---|---|---|
| TT1 | `TB60` | `(body as any)._scroller.getViewportHeight()` is 88; `(body as any).computePageSize()` is 4 |
| TT2 | `ArrowDown`, `PageDown`, `PageDown`, `PageUp` | current row 0, 4, 8, 4; `scrollY` after the last three presses 12, 92, 80 |
| TT3 | `End`, `PageDown` | current row 59, 59; each press calls `preventDefault` once |
| TT4 | TT3, then `Shift+PageUp` | current row 55; `body.getSelectedRecords()` has one record |

### Needs manual verification

On the demo app (`npm run dev`), in Chromium. These check what the modelled DOM cannot: the browser's own default action, real focus, and what is painted.

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/misc` → "Show large tree (variable-width rows)" | click a row; `PageDown` ×4, then `PageUp` ×4 | each press moves the highlighted row by the number of whole rows the tree shows; the landed row is fully visible above the horizontal scrollbar; nothing behind the window scrolls |
| MV2 | same window | hold `PageDown` until the last row, then press it again; `PageUp` once | the highlight stops on the last row and nothing else scrolls; `PageUp` moves up one page |
| MV3 | same window | click a row; `Shift+PageDown` ×2, `Shift+PageUp` ×1 | the selection grows by two pages from the clicked row, then shrinks by one |
| MV4 | `#/content-box`, "Tree (VirtualScroller)" | click `src`; `PageDown`, `PageUp` | the landed row is fully visible inside the border; the demo page behind the tree does not scroll |
| MV5 | `#/misc`, the large tree window, reopened | press `Tab` until the tree has focus, without clicking a row; `Shift+ArrowDown` ×3 | three rows are selected |
| MV6 | `#/misc` → "Show window with tree table!" | click a row; `PageDown`, `PageUp` | as before this plan: the current row moves by one page |
| MV7 | optional, SQLAdmin against `npm run build:lib` | click a node in the database navigator; `PageDown`, `PageUp`, `Shift+PageDown` | the current node moves by a page and the Properties panel follows it, as it does for the arrow keys. No SQLAdmin change is needed[^sqladmin] |

---

## Verification

Harness for the new test file, copied from [`KeyboardContextMenu.test.ts:28–174`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L28):

- Node environment. The same `CONFIG`, the `built` array and `track()`.
- `beforeEach`: `installTestDOM(CONFIG)`, `built = []`.
- `afterEach`: `vi.restoreAllMocks()`, dispose every tracked component, `Menu._stopInputWatch()`, `Tooltip._stopPointerWatch()`, then `DOM.reset()`. A `Tree` starts `Menu`'s input watch when it is built, and a registration left behind makes the next test's dispatches vanish.
- In E8, track the parent `Container` and not the tree: disposing the parent disposes the tree.

The Tree, anchor, edge and `TreeTable` cases were run as a throwaway prototype against a temporary copy of the change before this plan was written.[^prototype]

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. The commands of steps 1 and 4.
4. `npm test` — the whole suite.
5. `npm run lint`
6. `npm run build:lib`, `npm run docs:api`, `npm run docs:llms:check`
7. `npm -w packages/docs run test` — it needs the two builds of item 6 first.
8. The MV cases, on `npm run dev`.

Grep checks: the four of step 5.

---

## Documentation Impact

**Exports.** None. No symbol is added, renamed or removed, so no barrel, API page or `llms.txt` entry changes; `docs:llms:check` confirms it.

**JSDoc.** The three comment edits of steps 2 and 3. `getSelectedNode` is public: its comment names no private symbol.

**Catalogue.** `plans/dom-only-state-inventory.md` needs no entry: no DOM-only state and no listener is added.

### `docs/components/Tree.md` — [`## Keyboard`](../packages/lib/docs/components/Tree.md#L133)

Insert one row after the `Home` / `End` row (line 142):

```markdown
| `PageUp` / `PageDown` | Move up / down by one page — the number of whole rows the tree shows — and select that row. With `Shift`, extend the selection instead. With no current row yet, the first press lands on the first row. |
```

Add two paragraphs directly below the table:

```markdown
`Shift` extends from the anchor: the row last selected by a plain click or a plain key press, which [`getSelectedNode()`](/api/component/tree/classes/Tree#getselectednode) returns. With no anchor among the visible rows — nothing selected yet, the anchor's node removed, or the anchor under a collapsed node — a `Shift` move is a plain move, and the row it lands on becomes the anchor.

A key in the table is the tree's own even when the current row cannot move: `PageDown` on the last row changes nothing, and the browser does not scroll what is behind the tree. See [Keys in trees, lists and tables](/concepts/accessibility#keys-in-trees-lists-and-tables).
```

### `docs/components/TreeTable.md` — [`## Keyboard`](../packages/lib/docs/components/TreeTable.md#L82)

Replace the last paragraph of the section (line 89, "When the focused row has no tree-specific meaning for the key … the inherited column-navigation behaviour runs.") with:

```markdown
With a current row, `ArrowLeft` / `ArrowRight` act on the tree only. Where the key has no tree meaning — `ArrowRight` on a leaf, `ArrowLeft` on a top-level leaf or collapsed branch — it does nothing and the current cell stays in its column; `Tab` / `Shift+Tab` move along the row. With no current row yet, the two keys move the current column as in a `Table`.
```

### `docs/components/List.md` — [`## Keyboard`](../packages/lib/docs/components/List.md#L30)

Insert one row after the `PageUp` / `PageDown` row (line 38):

```markdown
| `Ctrl` (or `Cmd`) with any of the six keys above | Move focus without changing the selection. `Enter` or `Space` then selects the focused row. |
```

### `docs/components/MultiSelectList.md` — [`## Selection model`](../packages/lib/docs/components/MultiSelectList.md#L28)

Replace the two rows for `Shift`-`ArrowUp` / `Shift`-`ArrowDown` and `Ctrl`-`ArrowUp` / `Ctrl`-`ArrowDown` (lines 35–36) with four:

```markdown
| `Shift` with `ArrowUp` / `ArrowDown` / `Home` / `End` / `PageUp` / `PageDown` | Extend the selection from the anchor row to the row the key lands on. |
| `Ctrl` with the same six keys | Move focus without changing the selection. |
| `Ctrl`-`Space` / `Ctrl`-`Enter` | Toggle the focused row's selection without affecting others. |
| `Shift`-`Space` / `Shift`-`Enter` | Extend the selection from the anchor row to the focused row. |
```

### `docs/layouts/Accordion.md` — new section

Insert directly above `## Fill mode` (line 112):

```markdown
## Keyboard

Each header's title button is a Tab stop. With a title button focused:

| Key | Behaviour |
| --- | --- |
| `Enter` / `Space` | Open or close the section. |
| `ArrowDown` / `ArrowUp` | Move focus to the next / previous header, wrapping at the ends. |
| `Home` / `End` | Move focus to the first / last header. |

The arrow keys, `Home` and `End` act only while a title button holds focus. A header tool and the content of an open section keep those keys for themselves.
```

### `docs/concepts/accessibility.md` — new section

Insert directly above `## Building an accessible custom widget` (line 245):

```markdown
## Keys in trees, lists and tables

A [`Tree`](/components/Tree#keyboard), a [`List`](/components/List#keyboard) or [`MultiSelectList`](/components/MultiSelectList#selection-model), and the body of a [`Table`](/components/Table#keyboard) or [`TreeTable`](/components/TreeTable#keyboard) are each one Tab stop. The widget's own element holds focus, and these keys move its current row:

| Key | `Tree` | `List`, `MultiSelectList` | `Table` | `TreeTable` |
| --- | --- | --- | --- | --- |
| `ArrowUp` / `ArrowDown` | previous / next row | previous / next row | previous / next row | previous / next row |
| `Home` / `End` | first / last row | first / last row | first / last row | first / last row |
| `PageUp` / `PageDown` | up / down one page | up / down one page | up / down one page | up / down one page |
| `ArrowLeft` / `ArrowRight` | collapse / expand, or to the parent / first child | — | previous / next cell | collapse / expand, or to the parent / first child |
| `Enter` / `Space` | — | select the focused row | edit the current cell | edit the current cell |
| Printable character | — | type-ahead | — | — |
| `Shift+F10` / ContextMenu key | menu for the current row | menu for the focused row | menu for the current cell | menu for the current cell |

A page is the number of whole rows the widget shows, and at least one. The key moves the current row that far and scrolls it into view by the least distance. `Shift` with a row key extends the selection in a `Tree` and a `MultiSelectList`.

A key in the table is the widget's own even when the current row cannot move: `PageDown` on the last row changes nothing, and the browser does not scroll the page behind the widget. The key is not stopped, so a `keydown` listener on an ancestor still receives it. An empty widget leaves the keys in the table alone.
```

### `docs/reference/changelog/next.md`

Append two entries at the end of `## Fixed` → `### Components`, after the entry that begins "**A `MarkdownViewer` minimap click lands on the heading**" (line 434) and before `### Core`.[^fixed-not-added]

- **A `Tree` pages with `PageUp` / `PageDown`.** Say that the keys did nothing in a tree and left the browser to scroll whatever was behind it; that they now move the current row by one page — the number of whole rows the tree shows — select it and scroll it into view; that with `Shift` they extend the selection, like the arrow keys and `Home` / `End`; and that `Table`, `TreeTable`, `List` and `MultiSelectList` already paged. One behaviour changes: a focused tree now takes the two keys, so they no longer scroll a panel around it; a `keydown` listener on an ancestor still receives them. End with "No consumer action is needed."
- **A `Tree`'s `Shift`+arrow starts a range when there is no anchor.** Say that with nothing selected — or after the anchor's node was removed, or hidden by a collapse — `Shift` with an arrow key, `Home` or `End` selected one row at a time and never built a range, and `getSelectedNode()` returned `null` beside a non-empty selection; and that such a move is now a plain move whose row becomes the anchor, as a `Shift`-click with no anchor already was. End with "No consumer action is needed."

---

## Potential Challenges

- **Line numbers move if `feature/spatial-navigation-redesign` merges first.** That branch adds eight lines near the top of `Tree.ts`. Find `_onKeyDown`, `_extendSelectionTo` and `getSelectedNode` by name.
- **A real-event test that leaks a listener breaks the next test silently.** Use the teardown in `## Verification` exactly, and remove E8's subtree listener inside the test.
- **`computePageSize()` is `protected`.** `Tree` calls it as its own inherited method; tests reach it through an `any` cast, as `Body.test.ts` does.
- **The early return in `_extendSelectionTo` must come before `settleRowMotionIfEntering`.** `_selectAtIndex` settles the motion itself, so the order in the snippet avoids doing it twice.
- **A held `PageDown` fires one `"selection"` per repeat,** as a held arrow key does. A consumer that fetches on `"selection"`, as SQLAdmin's navigator does, sees the same event rate as today; nothing here adds throttling.
- **`accessibility.md` and `changelog/next.md` are edited by other unmerged work.** This plan adds a whole section and two list entries and edits no existing line. Keep both sides in a merge.
- **The pending plan `directional-panel-navigation` adds a guard as the first statement of `Tree._onKeyDown`,** two lines above the `navigable` line this plan edits. The two changes do not share a line.

---

## Critical Files

- [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L1890) — `_onKeyDown` (:1890), its `navigable` set (:1893) and `Home` / `End` branches (:1916–1921); `_selectAtIndex` (:1815); `_extendSelectionTo` (:1844); `_scrollIntoView` (:1874); `_handleClick`'s `Shift` rule (:2015); `getSelectedNode` (:624); `_revealFocusRow` (:2098) and `_focusPoolRow` (:2214), read only; the `keydown` registration (:2481).
- [`component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3063) — read only: the page branches of `onKeyDown` (:3063–3068). **The precedent for the paging arithmetic.**
- [`component/shared/VirtualRowView.ts`](../packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L287) — read only: `computePageSize` (:287), `scrollRowIntoView` (:1125), `settleRowMotionIfEntering` (:962).
- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2165) — read only: `handleNavigationKey` (:2165) and its `preventDefault()` before the clamp (:2176). **The precedent for prevented-not-stopped.**
- [`component/table/TreeBody.ts`](../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L929) — read only: `onKeyDown` (:929), which passes the page keys to `Body`.
- [`tests/component/shared/KeyboardContextMenu.test.ts`](../packages/lib/tests/component/shared/KeyboardContextMenu.test.ts#L176) — the harness and both fixtures the new test file copies.
- [`tests/component/tree/Tree.test.ts`](../packages/lib/tests/component/tree/Tree.test.ts#L1246) — the viewport-height fixtures (:1246) and the `Shift`-click cases (:3962).
- [`plans/implemented/scroll-reveal-geometry-fixes.md`](implemented/scroll-reveal-geometry-fixes.md) — the dependency: it made a page "the whole rows the scroll viewport shows".
- `ARCHITECTURE.md`, *Event handling* — a listener states its disposition by return value: `{ prevent: true }` prevents and does not stop.

---

## Non-Goals

Each item below is a gap the survey found that needs a design decision first. The evidence is given so the decision can be made later without repeating the survey. *Probed* means run offline with real `keydown` events.

- **`Enter` to activate a tree node.** The pattern gives `Enter` that job. `Tree` has one activation signal, `"dblclick"`, fired only by a double-click ([`_handleDblClick`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2129)). SQLAdmin's navigator opens a table from `"dblclick"` alone (`frontend/src/navigator/NavigatorTree.ts:151`), so from the keyboard "open" is reachable only through the Shift+F10 menu. The decision: fire `"dblclick"` from a key, or add an `"action"` event.
- **Moving the current row without selecting it in a `Tree`: `Ctrl`+arrow, `Space` / `Ctrl+Space` to toggle, `Ctrl+A`.** `MultiSelectList` has this model. In a `Tree`, `Ctrl+ArrowDown` is a plain `ArrowDown` today (probed), so adopting it changes an existing key.
- **Type-ahead in a `Tree`.** The pattern recommends it. `List`'s type-ahead moves the focus mark and never the selection ([`handleTypeAhead`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2295)). A `Tree` key cannot move the current row without selecting it and firing `"selection"`, so type-ahead waits on the item above.
- **`*` to expand a tree node's siblings.** The pattern marks it optional. On lazy nodes it would start one `loadChildren` call per sibling.
- **Keys pressed with `Alt`, `Ctrl` or `Meta`.** `Tree`, `List` and the table body act on a navigation key whatever else is held: `Alt+ArrowDown` in a `Tree` moves the row and is prevented (probed). Only `Menu` leaves such chords alone ([`onPanelKeyDown`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1567)). The new page keys follow the tree's arrow keys; a rule for all widgets is its own change.
- **A current row hidden by a collapse.** Collapsing a node from its caret leaves the current row, the anchor and the selection on a hidden child (probed). The next key then starts from the first row; the pattern moves focus to the collapsed parent.
- **Moving between cells with `ArrowLeft` / `ArrowRight` in a `TreeTable`.** With a current row those keys act on the tree only and never move the current cell (probed); `TreeTable.md` claimed a fallback that `TreeBody` has never had. The treegrid pattern ties the two meanings to which cell is current. This plan corrects the sentence and leaves the behaviour.
- **`Table`: `Home` / `End` within the row, `Ctrl+Home` / `Ctrl+End`, `Shift`+arrow, `Ctrl+A`.** The grid pattern uses `Home` / `End` for the row's first and last cell. `Table` uses them for the first and last row and documents that. `Shift` is ignored by the row keys, and a table has two selections — rows and a cell range — so which one `Shift` would extend is undecided.
- **`Home` / `End` on a tab strip, and `ArrowUp` / `ArrowDown` on a vertical one.** The pattern marks `Home` / `End` optional. [`TabBar.onToolbarKeyDown`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L3463) hears keys from the whole strip, strip tools included, and falls back to the active tab when a tool has focus; `Home` / `End` there would take the caret keys from a text-entry tool, the fault `ToolBar` was fixed for. A west or east strip still navigates with `ArrowLeft` / `ArrowRight` and writes no `aria-orientation`.
- **`Home` / `End` in a `ToolBar`.** `RovingTabIndex` has `moveTo`, `moveNext` and `movePrev` and does not skip a disabled member, so `Home` onto a disabled first button would move nothing.
- **Type-ahead in a `Menu`, and `Home` / `End` in a host-driven dropdown.** Both are optional in the pattern. `Menu.handleKey` is documented as handling four keys and returning `false` for the rest.
- **Keys in the time picker's columns.** The hour, minute and second columns of `TimeField` and `DateTimeField` handle no key at all: `TimePickerDropdown` does not override `AnimatedDropdown.handleKey` (which returns `false`), and a `PickerCell` takes no focus. The field's text input is the keyboard path. No doc promises otherwise.
- **`MenuBar`, `ComboBox` and the calendar day grid.** Read in passing, not surveyed key by key. `MenuBar.md` and `ComboBox.md` have no Keyboard table.
- **Paging the view without moving the current row.** `List` and the table body move the current row, and so does this plan.
- **The demo app, the docs app and SQLAdmin.** SQLAdmin's navigator inherits the keys from `Tree` and needs no change.

---

## Addendum: Keyboard survey

Method: each widget's key handler was read at `27c9b7157`, and the entries marked *probed* were also run offline with real `keydown` events. "Pattern" is the WAI-ARIA Authoring Practices pattern for the widget's role. "Documented" names where the docs promise the key.

### `Tree` — role `tree`, always `aria-multiselectable`; docs: `Tree.md` → Keyboard

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `ArrowUp` / `ArrowDown` | tree | yes | yes | ok |
| `ArrowLeft` / `ArrowRight` | tree | yes | yes | ok |
| `Home` / `End` | tree | yes | yes | ok |
| `Shift` + the four row keys | tree, multi-select | yes, but with no anchor it never starts a range (probed) | yes: "extend the selection" | defect — fixed here |
| `PageUp` / `PageDown` | not in the pattern; library convention | no: not prevented, nothing moves (probed) | no | gap — added here |
| `Enter` | tree: activate | no | no | Non-Goal |
| `Ctrl`+arrow, `Space`, `Ctrl+Space`, `Ctrl+A` | tree, multi-select | no; `Ctrl+ArrowDown` acts as `ArrowDown` (probed) | no | Non-Goal |
| Type-ahead | tree: recommended | no | no | Non-Goal |
| `*` | tree: optional | no | no | Non-Goal |
| `Shift+F10` / ContextMenu key | — | yes | yes | ok |

### `TreeTable` — role `treegrid`; docs: `TreeTable.md` → Keyboard

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `ArrowUp` / `ArrowDown`, `Home` / `End`, `Enter`, `Space`, `Tab`, `Shift+F10` | treegrid | yes, inherited from the table body | yes | ok |
| `PageUp` / `PageDown` | treegrid | yes, inherited (probed: 4 rows per page in an 88 px viewport) | yes | ok — pinned here |
| `ArrowLeft` / `ArrowRight` on a branch, or to the parent / first child | treegrid | yes | yes | ok |
| `ArrowLeft` / `ArrowRight` where the tree has no use for the key | treegrid: move one cell | consumed, nothing moves (probed) | "the inherited column-navigation behaviour runs" | documented, not implemented — sentence corrected here; behaviour is a Non-Goal |
| `ArrowLeft` / `ArrowRight` with no current row | — | moves the current column (probed) | not stated | documented here |

### `List` / `MultiSelectList` — role `listbox`; docs: `List.md` → Keyboard, `MultiSelectList.md` → Selection model

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `ArrowUp` / `ArrowDown` | listbox | yes | yes | ok |
| `Home` / `End` | listbox: optional | yes | yes | ok |
| `PageUp` / `PageDown` | not in the pattern; library convention | yes | yes | ok |
| `Enter` / `Space` | listbox | yes | yes | ok |
| Type-ahead, `Escape` to clear it | listbox: recommended | yes | yes | ok |
| `Ctrl` + a navigation key, in a `List` | — | yes: focus moves, selection stays (probed) | no | doc defect — fixed here |
| `Shift` / `Ctrl` + `ArrowUp` / `ArrowDown`, in a `MultiSelectList` | listbox, multi-select | yes | yes | ok |
| `Shift` / `Ctrl` + `Home` / `End` / `PageUp` / `PageDown`, in a `MultiSelectList` | listbox, multi-select | yes (probed) | no | doc defect — fixed here |
| `Ctrl+Space` / `Ctrl+Enter` toggle, `Shift+Space` / `Shift+Enter` extend, in a `MultiSelectList` | listbox, multi-select | yes (probed) | no | doc defect — fixed here |
| `Ctrl+A`, in a `MultiSelectList` | listbox: optional | yes | yes | ok |
| `Shift+F10` / ContextMenu key | — | yes | yes | ok |

### `Table` body — role `grid`; docs: `Table.md` → Keyboard

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `ArrowUp` / `ArrowDown`, `ArrowLeft` / `ArrowRight` | grid | yes | yes | ok |
| `PageUp` / `PageDown` | grid | yes | yes | ok |
| `Home` / `End` | grid: first / last cell in the row | first / last row | yes, as implemented | differs from the pattern by design — Non-Goal |
| `Ctrl+Home` / `Ctrl+End` | grid: first / last cell of the grid | same as `Home` / `End` | no | Non-Goal |
| `Enter`, `Space`, `Tab` / `Shift+Tab` | grid, editing | yes | yes | ok |
| `Ctrl/Cmd+C` / `X` / `V` | — | yes | yes | ok |
| `Shift`+arrow to extend, `Ctrl+A` | grid: optional | no: `Shift` is ignored, one row is selected (probed on the tree-table body) | not promised | Non-Goal |
| `Shift+F10` / ContextMenu key | — | yes | yes | ok |

### Tab strip — role `tablist`; docs: `accessibility.md` → RovingTabIndex, `layouts/Tab.md`

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `ArrowLeft` / `ArrowRight` | tabs | yes: wraps and activates | yes, on the accessibility page | ok |
| `Delete` | tabs: optional | yes, on a closeable tab | yes | ok |
| `Enter` / `Space` | tabs | yes, a native button | — | ok |
| `Home` / `End` | tabs: optional | no | no | Non-Goal |
| `ArrowUp` / `ArrowDown` on a vertical strip | tabs, vertical | no | no | Non-Goal |

### `Menu` — role `menu`; docs: `Menu.md` → Keyboard

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| Keyboard-opened context menu: `↓` / `↑`, `Home` / `End`, `Enter` / `Space`, `→` / `←`, `Tab`, `Escape` | menu | yes | yes | ok |
| Host-driven dropdown: `↓` / `↑`, `Enter` / `Space` | menu | yes | yes | ok |
| Host-driven dropdown: `Home` / `End` | menu: optional | no | "returns `false` for every other key" | consistent — Non-Goal |
| Type-ahead | menu: optional | no | no | Non-Goal |

### Accordion headers — accordion pattern; docs: none before this plan

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| `Enter` / `Space` | accordion | yes: the title is a `Button` | no | doc defect — fixed here |
| `ArrowDown` / `ArrowUp` | accordion: optional | yes, wrapping ([`onHeaderKeyDown`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L2887)) | no | doc defect — fixed here |
| `Home` / `End` | accordion: optional | yes | no | doc defect — fixed here |

### Picker columns — the time columns of `TimeField` / `DateTimeField`

| Key | Pattern | Implemented | Documented | Verdict |
|---|---|---|---|---|
| any | none fits; nearest is listbox | no key is handled | none promised | Non-Goal |

---

## Notes

[^today]: Probed offline at `27c9b7157` with a real `keydown` on a focused 60-row tree: `ArrowDown` called `preventDefault` once and moved the row; `PageDown` called it zero times and changed nothing. The handler's `navigable` set holds six keys and `PageDown` is not one, so it returns `undefined`. What the browser then does was not measured: with the tree's element focused, its default action for `PageDown` is to scroll the nearest scrolling ancestor, or to do nothing when there is none.

[^page-from-current]: The page is counted from the current row, not from the rows in view. When the current row has been wheeled out of view, `PageDown` moves five rows from where the current row is and scrolls back to it (case E6). `List` and the table body do the same, and the reveal that follows is the least-scroll rule `scroll-reveal-geometry-fixes` gave all three. The other model — scroll the view by a page and put the current row at the same height in it — was not taken: it would make `Tree` the one widget that pages differently, and would need a second scroll path beside `scrollRowIntoView`. `computePageSize()` reads the scroller's viewport height, which that dependency made exact under a border and a horizontal scrollbar; without a scroller it returns 1.

[^not-apg]: The WAI-ARIA tree and listbox patterns define the arrow keys, `Home`, `End` and type-ahead, and the tree pattern adds `Enter` and `*`. Neither lists `PageUp` or `PageDown`. The grid and treegrid patterns do. The library already pages its `List`, and every desktop tree view pages, so the keys are added as the library's convention and the docs do not claim the ARIA pattern for them.

[^modifiers]: The arrow, `Home` and `End` branches do not look at `Ctrl`, `Alt` or `Meta`, so `Ctrl+ArrowDown` and `Alt+ArrowDown` act as `ArrowDown` today (probed). Guarding only the two new keys would give one handler two rules, and guarding all eight would change existing keys. Both are left for the cross-widget decision named in `## Non-Goals`. The one chord the handler does stand down for is the one `SpatialNavigation.claimsKey` reports, and its guard is the first statement of the method, ahead of the new branches.

[^prevent-not-stop]: `PageDown` on the last row could instead be left for a parent to scroll. The library does not do that: its rule for keys is the opposite of its rule for the wheel. An unconsumed wheel scroll passes to the parent. A navigation key the widget owns is prevented whether or not anything moved: `List` calls `preventDefault()` before it clamps, the table body returns `{ prevent: true }` after clamping, and the tree's own `End`-then-`ArrowDown` is prevented (probed). None of them stops the event, so an ancestor's subtree listener still runs (probed for the tree, case E8). Leaving the key alone only at the last row would make the page behind jump at the moment a held `PageDown` reaches the end.

[^anchor-rule]: `_extendSelectionTo` falls back to the target row as a stand-in anchor when it finds none, but never stores it, so every later `Shift` move finds no anchor again and selects a single row. Probed: `Shift+ArrowDown` ×3 on a fresh tree gave selections [0], [1], [2] with `getSelectedNode()` `null` throughout. `Tree.md` promises "With `Shift`, extend the selection instead". The fix puts the rule in `_extendSelectionTo` and not in `_onKeyDown`, so the six `Shift` keys and the `Shift`-click path share it: `_handleClick` already tests `this._anchorNode` before it calls the method, but an anchor hidden under a collapsed node passes that test. Storing the stand-in anchor without calling `_selectAtIndex` was the other option; it would duplicate the five calls that method ends with.

[^treetable-inherits]: Probed offline on a `TreeBody` of 60 root records, 300 × 100: the viewport is 88 px high, the page 4 rows, and `ArrowDown`, `PageDown`, `PageDown`, `PageUp` gave rows 0, 4, 8, 4. `TreeTable.md` already lists `PageUp` / `PageDown` among the inherited keys. No existing test presses a page key on a focused table or tree-table body; the only page-key cases are for a cell that is being edited.

[^one-test-file]: `Tree.test.ts` resets the DOM after each test but does not dispose what a test built, and it calls `_onKeyDown` directly with a hand-made object. The page-key cases need real events to count `preventDefault` calls and to show that an ancestor still hears the key, and real events need the dispose-and-stop teardown `KeyboardContextMenu.test.ts` documents in its header. A file per widget was considered; the `Tree` and `TreeBody` fixtures are a few lines each and the contract tested is the same one.

[^a11y-spot]: Three sibling plans drafted from the same commit edit this page, and `feature/spatial-navigation-redesign` rewrites its tab-strip paragraph and its "Spatial focus navigation" section. A whole new section between two headings none of them touch merges cleanly. The "Keyboard-only" bullet under `## Testing` would be the natural place for a clause about paging, but it is one long line that `modal-dialog-focus-trap` already rewrote and the sibling plans are likely to touch, so it is left alone.

[^merge]: Checked against the branch's diff from its merge base with this plan's base (`87c5ff0cc`). Its `Tree.ts` hunk is eight added lines after the last import. Its `SpatialNavigation.ts` reads the origin's `aria-activedescendant` to find the current row and calls nothing on `Tree`. Its landing ring is a stylesheet rule keyed on `[role="tree"]` plus a marker attribute the service writes; no key handler is involved.

[^sqladmin]: Read at `/home/jika/typescript/sqladmin`, branch `main`. `NavigatorTree` extends `ExplorerTreeBase`, which extends the library `Tree`. It subscribes to `"selection"`, `"dblclick"`, `"contextmenu"`, `"expand"`, `"collapse"` and `"loaderror"`, registers no `keydown` listener and never mentions `PageUp` or `PageDown`. Its `"selection"` listener shows the first selected node in the Properties panel, which is what it already does for each arrow key. SQLAdmin gets the keys when it moves to the library release that carries them.

[^fixed-not-added]: The changelog files a keyboard key that should have worked under `## Fixed`: the entry "Shift+F10 opens the context menu of the current tree row, list row or table cell" is there, not under `## Added`. No API is added here, so both entries follow that precedent.

[^prototype]: The two edits were applied to a scratch copy of `Tree.ts` in the planning worktree and every number in `## Expected Behaviour` was read from a run of the cases against it, then checked against the arithmetic (when the landed row was out of view, `scrollY` after a downward page is `(row + 1) × 24 − 120`, and after an upward one `row × 24`). The test file itself was then written out and run three times: against the base it failed and passed exactly as step 1 says, after the `_onKeyDown` edit alone only A1–A5 failed, and after both edits all of it passed. With both edits in place the command of step 4 passed unedited (38 files, 1008 tests), and `tsc` and `eslint` were clean on `Tree.ts`. The copy was discarded. The probe files, the test file and the diff are kept in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/tree-page-keys/`.

---

## Implementation Notes

Built on `feature/dialog-aria-semantics` (`7669472c7`), the tip of the chain `feature/context-menu-keyboard-operation` → `feature/table-tree-keyboard-context-menu` → `feature/modal-dialog-focus-trap` → `feature/list-scroll-index-into-view` → `feature/scroll-reveal-geometry-fixes` → `feature/dialog-aria-semantics`, off local `master` (`e23c8f0c3`). The plan was drafted one branch lower, at `27c9b7157`.

### What differed on the base

`feature/dialog-aria-semantics` did not touch `Tree.ts`, `Body.ts`, `TreeBody.ts`, `VirtualRowView.ts`, `AbstractSelectableList.ts` or `KeyboardContextMenu.test.ts`. Every `Tree.ts` line number in the plan matched.

| File | What the newer base changed | Effect here |
|---|---|---|
| `docs/concepts/accessibility.md` | a "Dialogs and windows" section and three more lines above the insertion point | `## Building an accessible custom widget` is at line 248, not 245; the new section was placed by heading |
| `docs/reference/changelog/next.md` | 81 lines of entries | the `MarkdownViewer` minimap entry that ends `## Fixed` → `### Components` is at line 499, not 434; the two entries were appended after it, before `### Core` |
| `plans/in-progress/` | the directory did not exist on the base | created for the move |

### Deviations from the plan

1. **Two code commits and three documentation commits, not one of each.** The plan's overview lists three changes, and each stands on its own: the page keys, the `Shift`-anchor fix (which also changes the arrow keys, `Home`, `End` and the `Shift`-click), and docs for keys of other widgets that no code here touches. The commits follow that split. The test file is shared: its `a Shift move with no anchor` block and the header line that names it ride in the second code commit. Each code commit was checked alone — at the first, the file's 17 cases pass and typecheck is clean.
2. **Cases beyond the plan's tables**, all in `KeyboardRowNavigation.test.ts`:
   - *Every `Shift` key, pinned as a pair.* One table-driven case per row: `Shift+ArrowDown`, `Shift+ArrowUp`, `Shift+Home`, `Shift+End`, `Shift+PageDown` and `Shift+PageUp` as the first press on a fresh tree, each followed by a second `Shift` key. The first press is a plain move whose row becomes the anchor; the second extends from it; two `"selection"` events. Eight rows, so that `End` is followed by each of `ArrowUp`, `Home` and `PageUp`.
   - *A `Shift`-click with the anchor hidden under a collapsed node*, in three cases: the default `expandTrigger`, `"click"`, and with `Ctrl` held as well. Without `Ctrl` the click is a plain one: the clicked row is selected, becomes the anchor and, in `"click"` mode, toggles; the next `Shift`-click extends from it and toggles nothing. With `Ctrl` it is a `Ctrl`-click. See deviation 9 for the code behind the last two.
   - *An empty tree inside a container.* `PageDown` and `PageUp` are not prevented and the container's subtree listener hears both. E1 covers the first half; this adds the second.
   - S1–S3 also assert `aria-activedescendant` and the `preventDefault` count, which the plan asks of P1–P4 only.
3. **Expected scroll positions are written as arithmetic, not as the plan's literals.** `(row + 1) × 24 − viewport height` after a downward move onto a row below the view, `row × 24` after an upward one. The values are the plan's. E6 writes its scroll position as `25 × 24`, which is the plan's 600.
4. **E9 tracks its tree for disposal.** The plan's case builds a `Tree` it never renders and does not say to track it. A `Tree` starts `Menu`'s input watch when it is built, so it is disposed like every other.
5. **`getSelectedNode`'s JSDoc and `Tree.md`'s anchor paragraph say more than the plan's text.** The plan defines the anchor as the row last selected by a plain click or a plain key. A `Ctrl`/`Cmd`-click and `selectNode()` set it too, and so does a `Shift`-click with no anchor; and the JSDoc's "or null if there is no selection" is untrue once the anchor's node is removed, which case A4 pins. Both texts now list every way the anchor is set, and the JSDoc's `@returns` says when it is `null`. The review found the omissions; the code they describe predates this plan.
6. **The changelog entries differ from the plan's text in three places.** The plan says `getSelectedNode()` returned `null` beside a non-empty selection in all three states; with the anchor hidden by a collapse it returned the hidden node, so the entry says "Unless a collapse had hidden the anchor". The `Shift` entry also records what deviation 9 changes for a `Shift`-click. The page-keys entry adds that a tree tall enough to show all its rows, inside a scrolling panel, now moves to its last or first row: its page is every row, where the browser used to scroll the panel by a page.
7. **`Tree` has no single-select mode.** It always writes `aria-multiselectable="true"` and has no option to turn range selection off, so the `Shift` cases cannot be repeated for a single-select tree. `Table` and `TreeTable`, where `Shift` does not extend, are pinned by TT4.
8. **No demo was added.** `#/misc` → "Show large tree (variable-width rows)" and `#/content-box` → "Tree (VirtualScroller)" already show a long tree and a bordered one with a horizontal scrollbar, and the plan lists the demo app under Non-Goals.

9. **`_handleClick` is edited, and a private helper is added — a third and fourth site in `Tree.ts`.** The plan left `_handleClick` alone: it tests `this._anchorNode` before it calls `_extendSelectionTo`, so a `Shift`-click whose anchor a collapse has hidden reached the new early return and was selected like a plain click. But it never reached the toggle that a plain click makes when `expandTrigger` is `"click"`, and that a `Shift`-click with no anchor set does make (`Tree.md`, *Expand trigger*; `Tree.test.ts`, "a Shift-click … with no anchor set behaves like a plain click"). The review called it half a plain click. `_handleClick` now asks the same question `_extendSelectionTo` asks — is the anchor among the visible rows — through `_visibleAnchorIndex()`, which both methods call, and takes its plain-click branch when the answer is no. Consequences:
   - With `expandTrigger: "click"`, a `Shift`-click on an expandable row whose anchor is hidden or removed toggles it. In the default mode nothing changes beyond what the plan already changed.
   - A `Shift`+`Ctrl`-click with a hidden anchor takes the `Ctrl` branch, as one with no anchor set always has: it toggles the clicked row in the selection and makes it the anchor. On the base it replaced the selection with the clicked row. This is the rule of the shared ladder in `component/shared/reduceModifierSelection.ts` ("shift with no anchor + ctrl" toggles). One case pins it, and `Tree.md` and the changelog entry say so.
   - `_handleClick`'s JSDoc and `Tree.md`'s *Expand trigger* paragraph say "no anchor among the visible rows".
   - Step 5's grep checks still give three lines, two lines, no output and one file.
   - The edit is far from the lines `feature/spatial-navigation-redesign` adds below the imports; the dry run below was repeated with it in place and came out the same.

   **Decided by the user on 2026-10-10:** the behaviour change is accepted. A `Shift`-click whose anchor is hidden is a plain click, and a `Shift`+`Ctrl`-click with a hidden anchor is a `Ctrl`-click.

10. **Two sentences the plan gave verbatim are scoped to the keys that move the row.** The plan's "A key in the table is the widget's own even when the current row cannot move" (`accessibility.md`) and its twin in `Tree.md` cover every row of the table above them, and two of those rows do not fit: a `List` does not prevent a type-ahead key, and `Shift+F10` with no current row is left to the browser. Both now begin "A key that moves the current row". Three more of the plan's sentences were tightened for the same kind of reason: the table's lead-in in `accessibility.md` says the widget "takes these keys", not that they all move the current row; its last sentence adds that a disabled or read-only `List` or `MultiSelectList` leaves the keys alone, as an empty widget does; and `TreeTable.md` says "a top-level leaf or a top-level collapsed branch", since a collapsed branch deeper down moves to its parent.

No existing test was edited, and none changed its expected value.

### Verification

Run at the branch tip, one suite at a time.

| Check | Result |
|---|---|
| `npm run typecheck`, `typecheck:test` | clean |
| `npm run lint` | clean |
| `vitest run` in `packages/lib` | 555 files, 9701 passed, 2 todo |
| step 4's neighbouring folders | 38 files, 1020 passed, no existing file edited |
| `npm run docs:api` | no warnings |
| `npm run docs:llms:check` | 108 catalogued, 121 excluded, 0 unaccounted for |
| `npm run build:lib` | built |
| `vitest run` in `packages/docs`, after the two builds | 13 files, 2615 passed |
| step 5's four grep checks | three lines, two lines, no output, one file |

The new file against the base, before any code: 25 of its 31 cases failed. The six that passed are E1, E5, the empty tree in a container and the three `TreeTable` cases, as step 1 predicts. After the `_onKeyDown` edit alone, the 14 anchor cases failed and nothing else. Two more cases came out of the review. The `Shift`-click in `"click"` mode failed on its toggle assertion until `_handleClick` was edited. The `Shift`+`Ctrl`-click case was written after that edit and passed at once; against the base it would give [`C`] where it expects `a0` and `C`. The file ends with 33 cases.

**In a browser.** Chromium, driven through the chrome-devtools MCP against this worktree's dev server on port 8047, with real key presses. Firefox and WebKit were not run. The table is from the run before the review. After the review's edits the large tree was driven again: a fresh tree focused by `Tab`, `Shift+ArrowDown` ×2 → 0–1, `Shift+PageDown` → 0–18, a plain click on row 5 → [5], `PageDown` → 22, `Shift+PageDown` → 22–39. The browser tool cannot hold `Shift` during a click, so the three `Shift`-click cases are covered offline only.

| Plan case | Where | Seen |
|---|---|---|
| MV1 | `#/misc`, the large tree: 628 rows, a 427 px viewport above the horizontal scrollbar, 17 whole rows | click row 5; `PageDown` ×4 → rows 22, 39, 56, 73, each flush above the horizontal scrollbar; the views were rows 6–22, 23–39, 40–56 and 57–73, so no row was skipped. `PageUp` ×4 → 56, 39, 22, 5, each at the top of the view. Every press prevented; nothing else scrolled |
| MV2 | same | `End` → row 627; `PageDown` stays, prevented, nothing scrolls; `PageUp` → 610; `ArrowDown`, `PageDown` → clamps to 627. At the top, `PageUp` from row 5 → 0, and again → stays |
| — | same, a branch collapsed | `ArrowLeft` on "Section 0", `PageDown` → row 17 is "Item 2.5"; expanded again, `PageDown` from row 0 → row 17 is "Item 1.3" |
| MV3 | same | anchor on row 2; `Shift+PageDown` ×2 → 2–19, then to 36; `Shift+PageUp` → the current row is 19, at the top of the view, and rows 20–35, the rest of the view, are no longer selected |
| MV5 | same, window reopened, focus by `Tab`, no row clicked | `Shift+ArrowDown` ×3 → [0], 0–1, 0–2. In a second fresh window: `Shift+PageDown` ×2 → [0], 0–17 |
| MV4 | `#/content-box`, "Tree (VirtualScroller)": a 2 px border, both scrollbars, a 104 px viewport, 4 whole rows, 12 rows | click `src`; `PageDown` → rows 4, 8, 11, then stays; `PageUp` → 7 and on to 0. A row landed on from above is flush above the horizontal scrollbar; one landed on from below starts 2 px inside the border. The demo page's own scroller stayed at 0 of 382 px, with the tree itself partly below the fold |
| MV6 | `#/misc`, the tree table | click `lib`; `PageDown` → the last row, `PageUp` → the first; both prevented. The demo's seven rows fit one page, so this shows the clamp only; a move of a whole page is pinned offline by TT2 |
| MV7 | SQLAdmin | not driven. Read at `main`: no file under `frontend/src` mentions `PageUp` or `PageDown`; `NavigatorTree` and `ExplorerTreeBase` register no `keydown` listener; the rail's one subtree `keydown` listener (`shell/refreshTool.ts`) acts on `Alt+R` only, and the document-level accelerator prevents only its own chords; nothing calls `getSelectedNode()`. No SQLAdmin change is needed |

### Merge dry run against `feature/spatial-navigation-redesign`

`git merge-tree --write-tree` of this branch with `feature/spatial-navigation-redesign` (`28eb38020`); merge base `e23c8f0c3`.

- `component/tree/Tree.ts` merges without a conflict. The merged file has that branch's import and `registerNavigationLandingRing('[role="tree"]')` call below the imports and this plan's three edits, which sit 8 lines lower.
- The new `## Keys in trees, lists and tables` section and the two changelog entries merge without a conflict.
- Three files conflict: `docs/concepts/accessibility.md` (one hunk), `docs/reference/changelog/next.md` (two hunks) and `core/Panel.ts` (one hunk). The same four hunks, at the same lines, come out of a dry run of the base `feature/dialog-aria-semantics` against that branch. None is in a line this plan wrote.

| Conflict | Sides | Resolution |
|---|---|---|
| `accessibility.md`, "Spatial focus navigation": the paragraph that begins "The service stands down while a transient overlay" | the chain changed "a dialog's focus trap" to "a modal layer's focus containment" in its first sentence; that branch replaced its second sentence with "Inside a non-modal window the chords stay inside that window, and chords pressed in the page behind it never enter it." | the chain's first sentence, then that branch's second |
| `changelog/next.md`, end of `## Changed` → `### Components` | the chain appended the entry "A `Tab` strip's descriptor tools have an accessible name"; that branch added a `### Core` block of two entries at the same spot | keep both: the entry, a blank line, then the `### Core` block |
| `changelog/next.md`, `## Added` → `### Core` | the chain appended four entries (`LayerManager`'s modal-scope API, `setInertAttribute`, `Panel`'s `getScrollViewportRect` / `revealSpan`, `Aria`'s `describedby` trio); that branch appended three (`navigationGroup`, `FocusRevealer.getScrollViewportElement`, `LayerManager.getLayerContaining`) | keep all seven; no two describe the same symbol |
| `core/Panel.ts`, above `revealDescendant` | the chain inserted `getScrollViewportRect`, `revealSpan` and `revealSpanWithin` and rewrote the opening of `revealDescendant`'s JSDoc; that branch inserted `getScrollViewportElement` at the same spot and left the JSDoc as it was | keep all four methods. The JSDoc must describe the body that survives the merge, and `scroll-reveal-geometry-fixes` rewrote that body; this belongs to the merge of that plan with the spatial branch and was not taken further here |

### Candidates for one follow-up plan

Every gap the survey recorded and this plan left. The evidence is in `## Non-Goals` and the addendum; each line names the decision that is open.

| Gap | Evidence | Decision needed |
|---|---|---|
| `Enter` does not activate a tree node | `"dblclick"` is the tree's one activation signal and only a double-click fires it; SQLAdmin's navigator opens a table from it alone, so the keyboard reaches "open" only through the Shift+F10 menu | fire `"dblclick"` from the key, or add an `"action"` event |
| No way to move a tree's current row without selecting it: `Ctrl`+arrow, `Space` / `Ctrl+Space`, `Ctrl+A` | `Ctrl+ArrowDown` is a plain `ArrowDown` today (probed) | adopting `MultiSelectList`'s model changes an existing key |
| No type-ahead in a `Tree` | `List`'s type-ahead moves the focus mark and never the selection; a tree key cannot move the current row without selecting it | waits on the row above |
| No `*` to expand a tree node's siblings | optional in the pattern; on lazy nodes it starts one `loadChildren` per sibling | whether to add it, and what it does for lazy nodes |
| `Alt`, `Ctrl` and `Meta` chords are taken as plain keys | `Alt+ArrowDown` in a `Tree` moves the row and is prevented (probed); `List` and the table body do the same; only `Menu` stands down | one rule for all widgets. The new page keys follow the tree's arrow keys |
| A current row hidden by a collapse | collapsing from the caret leaves the current row, the anchor and the selection on a hidden child (probed); the next key starts from the first row | the pattern moves focus to the collapsed parent. This plan fixes only what a `Shift` move does from that state |
| `ArrowLeft` / `ArrowRight` never move the current cell in a `TreeTable` with a current row | consumed where the tree has no use for the key (probed); `TreeTable.md` claimed a fallback `TreeBody` never had, and now says what happens | the treegrid pattern ties the two meanings to which cell is current |
| `Table`: `Home` / `End` within the row, `Ctrl+Home` / `Ctrl+End`, `Shift`+arrow, `Ctrl+A` | `Home` / `End` go to the first and last row, as documented; `Shift` is ignored by the row keys (probed on the tree-table body, pinned by TT4) | a table has two selections, rows and a cell range; which one `Shift` extends |
| No `Home` / `End` on a tab strip; no `ArrowUp` / `ArrowDown` on a vertical one | `TabBar.onToolbarKeyDown` hears keys from the whole strip, strip tools included; a west or east strip writes no `aria-orientation` | `Home` / `End` there would take the caret keys from a text-entry tool, the fault `ToolBar` was fixed for |
| No `Home` / `End` in a `ToolBar` | `RovingTabIndex` has `moveTo`, `moveNext`, `movePrev` and does not skip a disabled member | what `Home` does when the first button is disabled |
| No type-ahead in a `Menu`; no `Home` / `End` in a host-driven dropdown | `Menu.handleKey` is documented as handling four keys | both are optional in the pattern |
| The time picker's columns take no key | `TimePickerDropdown` does not override `AnimatedDropdown.handleKey`, and a `PickerCell` takes no focus; the field's text input is the keyboard path | whether the columns become a keyboard target at all |
| `MenuBar`, `ComboBox` and the calendar day grid were not surveyed key by key | `MenuBar.md` and `ComboBox.md` have no Keyboard table | survey them first |
| Paging the view without moving the current row | `List`, the table body and now `Tree` all move the current row | whether any widget wants the other model |
| `Tree._onKeyDown` is an eight-branch ladder of about 60 lines | past the code conventions' 30-line guide; the shape predates this plan, which added two branches the plan gave verbatim | split it when the tree's next keys land. Left here: the pending `directional-panel-navigation` plan and this one both edit the method, and a restructure would make every one of those merges a hand edit |
| The shared ladder trusts an anchor that is not in view | read, not run: `reduceModifierSelection` tests only `anchor !== null`; with an anchor record that is not among the visible records `indexOf` gives -1 and the range loop would add `at(-1)` to the selection. `Tree`'s visible-anchor test is the stricter rule | whether a `Table` or `MultiSelectList` can reach that state, and the same guard there if so |
| An anchored `Shift`-click looks its anchor up twice | `_handleClick` asks `_visibleAnchorIndex()` and `_extendSelectionTo` asks again: two scans of the visible rows per click | pass the index along when the ladder is next restructured; not worth a signature change here |
| `Tree` keeps its own selection ladder beside the shared one | `component/shared/reduceModifierSelection.ts` is the ladder `MultiSelectList` and the table body share; its header states the rule this plan gave `Tree`: `Shift` with no anchor is a plain select whose target becomes the anchor, and with `Ctrl` as well a toggle | move `Tree` onto it in the plan that gives a tree `Ctrl`+arrow and `Space` |

Two things seen while verifying, neither caused by this plan and neither changed:

- Before any key was pressed, the large-tree demo's rows container held three empty `treeitem` elements at the top, displayed, beside its 22 bound rows; the bordered demo tree showed three unnamed `treeitem`s in the accessibility snapshot too. Rows a later scroll left unbound were `display: none`. A click on row 0 still reached it. Seen, not investigated.
- A `Tree` row is as wide as the widest label, so in a tree with a horizontal scrollbar a row's centre can lie outside the viewport. It affects only tools that click an element's centre.
