---
depends-on: [tree-row-toggle-rebind-perf]
touches-shared: [packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts]
---

# Tree Row Pool Identity Reconciliation — Implementation Plan

## Overview

A `Tree` pool slot is assigned its content by absolute position: [`Tree._bindAndMeasure`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1426) binds slot `i` to `_flatRows[firstRow + i]` on every render pass. Expanding or collapsing a node inserts or removes a run of rows in `_flatRows`, which shifts every row below the change point to a different flat index — so a node that is still on screen, unchanged, and already correctly rendered arrives at a *different pool slot* from the one that was holding it. That slot's own content is different, [`TreeRow.isBoundTo`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L183) correctly reports a mismatch, and the row is rebound.

Measured on the current code with a search-result-shaped tree (one folder, 47 file branches, 4 leaf matches each — 236 flat rows, a 600px viewport holding a 30-row window): collapsing one file branch near the top of the window rebinds **27 of the 30 visible rows** and tears down and rebuilds **12 expand/collapse caret `Glyph` instances**. Re-expanding it costs exactly the same again. Only the three rows *above* the toggle point are spared.[^measurement]

This plan makes a pool slot follow its node. Each render pass that runs after a reflatten matches the pool against the new flat rows by `TreeNode` object identity and permutes the pool bookkeeping arrays so a node that is still visible keeps the slot — and therefore the DOM element, the renderer's cached text, and the caret `Glyph` — it already had. Only a slot whose node genuinely entered or left the window, or whose node's own state changed, is rebound.

The reconciliation itself lands on the shared [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) base, beside the scroll-rotation primitive it complements; `Tree` supplies the identity and is its only caller. `table/Body.ts` is not modified and does not call it.[^why-not-body] There are no public API changes.

---

## Architecture Decisions

### Slots are matched to nodes through a hash map, not a longest-common-subsequence diff

The reconciliation builds a `Map` from node to the slot currently holding it, looks up each window position's node once, and permutes the pool arrays into the resulting order. It is O(window + pool) with no sequence diffing.[^why-no-lcs]

This mirrors [`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L461-L651), which already solves the same problem one level down: when the rendered column window moves, it matches surviving cells to their columns through a `Map` keyed by field name (pass 1, [Row.ts:532-542](packages/lib/src/typescript/lib/component/table/Row.ts#L532-L542)), recycles leftovers by key (pass 2), refreshes the per-column state a shift invalidates even for a survivor (pass 3, [Row.ts:582-605](packages/lib/src/typescript/lib/component/table/Row.ts#L582-L605)), and finishes by reordering the children into the new slot order ([Row.ts:626-629](packages/lib/src/typescript/lib/component/table/Row.ts#L626-L629)). No LCS anywhere.

### A pure scroll keeps the existing rotation; only a reflatten takes the keyed path

`Tree` gains a private `_flatRowsDirty` flag, set by [`_flatten`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L699) and cleared by the render pass that consumes it. `renderWindow` calls the new keyed reconciliation when the flag is set and the existing [`alignPoolWindow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377) rotation when it is not.[^two-paths]

This two-path shape also has a precedent in the column machinery: `Body` computes a slide plan ([`computeColumnWindowSlidePlan`](packages/lib/src/typescript/lib/component/table/Body.ts#L1190)) and `Row` takes a cheap edge-only path ([`reconcileWindowSlide`](packages/lib/src/typescript/lib/component/table/Row.ts#L708)) when the window merely slid, falling back to the full keyed reconciliation otherwise ([Row.ts:507-515](packages/lib/src/typescript/lib/component/table/Row.ts#L507-L515)).

### The reconciliation moves slots; it does not decide rebinds

`_bindAndMeasure`'s rebind condition — `this._boundIndices[i] === -1 || !row.isBoundTo(...)` ([Tree.ts:1453-1454](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1453-L1454)) — is not touched. The reconciliation only changes *which* slot a node's render lands in; whether that slot is rebound is still decided afterwards, by the same two checks. Every case the prior plan settled therefore survives unchanged: `setNodes` with in-place-mutated nodes, `setRendererFactory`, and the inherited `onThemeReflow` all still blanket-reset `_boundIndices` to `-1`, and a reconciliation that finds no reusable slot leaves the pool exactly as it is today.[^sentinel-reuse]

### Only a still-bound slot is reusable

The reconciliation skips any slot whose `_boundIndices` entry is `-1` when building its node-to-slot map. That value is the forced-rebind sentinel `_bindAndMeasure` already reads: it marks a slot the last pass never bound (freshly grown by [`growRowPool`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L327)), one that scrolled out and was hidden (by [`hideExcessPoolRows`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L436)), or one a caller deliberately invalidated. Matching such a slot would hand its node back to it without the rebind it is owed.

---

## Internal Structure

### `VirtualRowView` — module-scope helper, beside `rotateLeft`

```typescript
/**
 * Reorders `arr` in place so `arr[i]` becomes what was at `arr[order[i]]`.
 * `order` must be a permutation of `arr`'s own indices.
 */
function reorder<T>(arr: T[], order: number[]): void {
    const source = arr.slice();

    for (let i = 0; i < order.length; i++) {
        arr[i] = source[order[i]];
    }
}
```

### `VirtualRowView.reconcilePoolByKey` (new `protected`, placed immediately after `alignPoolWindow`)

```typescript
protected reconcilePoolByKey(
    firstRow: number,
    windowSize: number,
    keyAtRow: (dataIndex: number) => object,
    keyInSlot: (slot: number) => object | null,
): void {
    const n = this._rowPool.length;

    // Recorded even when nothing else happens, so the next pure-scroll
    // `alignPoolWindow` derives its rotation from this pass's window.
    this._lastWindowStart = firstRow;

    if (n === 0 || windowSize === 0) {
        return;
    }

    const heldBy = new Map<object, number>();

    for (let slot = 0; slot < n; slot++) {
        if (this._boundIndices[slot] < 0) {
            continue;
        }

        const key = keyInSlot(slot);

        if (key !== null && !heldBy.has(key)) {
            heldBy.set(key, slot);
        }
    }

    const order = new Array<number>(n).fill(-1);
    const taken = new Array<boolean>(n).fill(false);
    let   matches = 0;

    for (let i = 0; i < windowSize; i++) {
        const slot = heldBy.get(keyAtRow(firstRow + i));

        if (slot !== undefined && !taken[slot]) {
            order[i]    = slot;
            taken[slot] = true;
            matches++;
        }
    }

    if (matches === 0) {
        return;
    }

    // Every unmatched window position, and every slot past the window, takes
    // the next unclaimed slot. Which one it gets does not matter: an
    // unmatched position is rebound either way.
    let next = 0;

    for (let i = 0; i < n; i++) {
        if (order[i] !== -1) {
            continue;
        }

        while (taken[next]) {
            next++;
        }

        order[i]    = next;
        taken[next] = true;
    }

    reorder(this._rowPool, order);
    reorder(this._boundIndices, order);
    reorder(this._rowGeom, order);
    reorder(this._rowDisplayed, order);
}
```

All four parallel arrays are reordered together — `_rowGeom` in particular, so [`positionRow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L406)'s cached geometry still describes the row that is actually in the slot.

### Worked example — expanding the middle of six collapsed branches

Six branch nodes `n0…n5`, each with one child, all visible and collapsed, one pool slot each (`r0…r5`). Expanding `n3` inserts `n3c` and grows the pool by one fresh slot `r6`.

| Window position | Node needed | Slot holding it before | `order[i]` |
|---|---|---|---|
| 0–3 | `n0`, `n1`, `n2`, `n3` | `r0`, `r1`, `r2`, `r3` | 0, 1, 2, 3 |
| 4 | `n3c` | none (new node) | 6 (leftover fill) |
| 5 | `n4` | `r4` | 4 |
| 6 | `n5` | `r5` | 5 |

Resulting pool order `[r0, r1, r2, r3, r6, r4, r5]`. The bind pass then rebinds exactly two rows: `r3` (its `expanded` flipped, so its caret swaps to `caret-down`) and `r6` (a fresh slot, `_boundIndices` `-1`). `r4` and `r5` keep their nodes, their renderers' cached text, and their caret `Glyph` instances, and pay only a translate — they moved one row down the screen.

Today the same toggle rebinds four rows: `r3`, plus `r4` and `r5` — each handed the node one place further along than the one it already showed — plus the freshly grown `r6`.

### `Tree` — new private field, placed directly below `_flatRows` ([Tree.ts:133](packages/lib/src/typescript/lib/component/tree/Tree.ts#L133))

```typescript
// Set by `_flatten`, cleared by the render pass that consumes it. Tells
// `renderWindow` whether the pool has to be re-matched to its nodes by
// identity (a reflatten moved rows between flat positions) or can take the
// base's cheap scroll rotation (the row set is unchanged; only the window
// moved). Framework-managed bookkeeping, so per ARCHITECTURE.md's third
// DOM-write rule it gets no `TreeOptions` field and no public setter.
private _flatRowsDirty      : boolean                                                 = false;
```

### `Tree.renderWindow` — the one changed line ([Tree.ts:1368](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1368))

`this.alignPoolWindow(win.firstRow);` becomes:

```typescript
// A pure scroll leaves `_flatRows` untouched, so every slot's node shifts
// by the same amount and the base's rotation is the cheapest correct
// answer. A reflatten moves rows by differing amounts either side of the
// change point, so which slot keeps which node has to be resolved by node
// identity instead.
if (this._flatRowsDirty) {
    this._flatRowsDirty = false;

    this.reconcilePoolByKey(
        win.firstRow,
        win.windowSize,
        (dataIndex) => this._flatRows[dataIndex].node,
        (slot) => this._rowPool[slot].getNode(),
    );
} else {
    this.alignPoolWindow(win.firstRow);
}
```

All of `renderWindow`'s early returns run before this branch, so a pass that returns early leaves `_flatRowsDirty` set and whichever pass eventually gets through still takes the keyed path.

---

## Ordered Implementation Steps

1. **`VirtualRowView.ts`** — add the `reorder` helper below `rotateLeft` ([VirtualRowView.ts:12-15](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L12-L15)), with the JSDoc shown in `## Internal Structure`.

2. **`VirtualRowView.ts`** — add `reconcilePoolByKey` immediately after `alignPoolWindow` ([VirtualRowView.ts:377-393](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377-L393)), exactly as shown in `## Internal Structure`. Give it a JSDoc block in this file's existing style: one-sentence summary, `@param` for each of the four parameters, and an `@remarks` paragraph stating (a) that it is the structural-change counterpart to `alignPoolWindow`'s scroll rotation, (b) that a slot whose `_boundIndices` entry is `-1` is deliberately not reusable, and (c) that it decides slot assignment only — the caller's own bind pass still decides whether a slot is rebound.
   Check: `grep -c "_lastWindowStart" packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — expect 4 (it is 3 before this step: the field declaration and `alignPoolWindow`'s read and write).

3. **`VirtualRowView.ts`** — extend the class-level JSDoc's list of shared primitives ([VirtualRowView.ts:36-40](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L36-L40)) with `{@link reconcilePoolByKey}`, and note in the same sentence that `Tree` is currently its only caller.

4. **`Tree.ts`** — add the `_flatRowsDirty` field shown in `## Internal Structure`, directly below `_flatRows` ([Tree.ts:133](packages/lib/src/typescript/lib/component/tree/Tree.ts#L133)).

5. **`Tree.ts`** — in `_flatten` ([Tree.ts:699-723](packages/lib/src/typescript/lib/component/tree/Tree.ts#L699-L723)), set `this._flatRowsDirty = true;` immediately after `this._flatRows = [];`.

6. **`Tree.ts`** — replace `renderWindow`'s `this.alignPoolWindow(win.firstRow);` ([Tree.ts:1368](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1368)) with the branch shown in `## Internal Structure`. Nothing else in `renderWindow` changes; `_bindAndMeasure` and `_positionRows` are not touched at all.
   Check: `grep -c "_flatRowsDirty" packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect 4 (the declaration, `_flatten`'s write, and `renderWindow`'s test and clear, on two lines).

7. **`Tree.ts`** — update two doc comments to describe the new mechanism:
   - The class JSDoc's pooling sentence ([Tree.ts:105-108](packages/lib/src/typescript/lib/component/tree/Tree.ts#L105-L108)) — a pool slot now follows its node across an expand/collapse, and rebinds only when what it was last bound to actually changed.
   - `_reflattenAndRender`'s JSDoc ([Tree.ts:725-733](packages/lib/src/typescript/lib/component/tree/Tree.ts#L725-L733)) — the render pass first re-matches slots to nodes by identity, then rebinds only the slots whose content changed.

8. **`Tree.test.ts`** — update the existing middle-branch test and add the new cases from `## Expected Behaviour`. The two assertions in `'toggling a middle branch never rebinds a row entirely before it, …'` ([Tree.test.ts:1384-1413](packages/lib/tests/component/tree/Tree.test.ts#L1384-L1413)) that pin the *old* behaviour must change: `expect(rowsByLabel['n5'].getNode()).toBe(nodes[4])` becomes `toBe(nodes[5])`, and the test's name and comment must be rewritten to describe a slot that follows its node. Everything else in that `describe` block stays as it is.
   Check: `grep -n "toBe(nodes\[4\])" packages/lib/tests/component/tree/Tree.test.ts` — expect zero matches.

9. **Docs** — apply the four edits in `## Documentation Impact`.

10. Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/recipes/virtualized-list.md` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline with `installTestDOM(CONFIG)`, the pattern the whole of `Tree.test.ts` already uses. None needs a real browser.

### `reconcilePoolByKey` — the base primitive

Exercised through a mounted `Tree`, the idiom the existing `describe('Tree virtual-scroll — characterization', …)` block ([Tree.test.ts:1222-1352](packages/lib/tests/component/tree/Tree.test.ts#L1222-L1352)) already uses for `computeVisibleWindow`, `growRowPool`, `hideExcessPoolRows` and `invalidateGeom`. Add cases 1–5 as a new `describe` block placed immediately after that characterization block.[^tests-live-in-tree-test]

1. Given a five-slot pool whose first four slots hold keys `A B C D` with `_boundIndices` `0 1 2 3` and whose fifth is unbound (`-1`), reconciling a five-row window whose keys are `A B X C D` produces the pool order `A B <the unbound slot> C D` — the slots holding `C` and `D` each move one position later, and all four parallel arrays (`_rowPool`, `_boundIndices`, `_rowGeom`, `_rowDisplayed`) are reordered identically.
2. With every `_boundIndices` entry set to `-1`, reconciling leaves all four arrays byte-for-byte unchanged (nothing was reusable).
3. A key that is in the window but whose only holder has `_boundIndices` `-1` is not matched — that slot stays where it is and is not treated as a survivor.
4. Reconciling at `firstRow = 5` and then calling `alignPoolWindow(6)` rotates the pool by exactly one, proving the reconciliation recorded the window start the rotation derives its delta from.
5. `windowSize === 0`, and an empty pool, both return without throwing and leave the arrays unchanged.

### `Tree` — behaviour across a toggle

Cases 6–10 and 12 use the `branchTree(n)` / `mountBranches(n, height)` helpers already in `describe('Tree — rebind gating after a reflatten (isBoundTo)', …)` ([Tree.test.ts:1360-1488](packages/lib/tests/component/tree/Tree.test.ts#L1360-L1488)), with 6 branches and a `7 * ROW_HEIGHT` viewport — the fixture the worked example in `## Internal Structure` walks through. Cases 11 and 13 each need their own fixture, described with them. All go in that same `describe` block.

6. Expanding the middle branch `n3` rebinds exactly two rows across the whole pool: the row bound to `n3`, and the fresh slot that takes `n3c`. Every other pool row's `setRowData` spy has zero calls.
7. After that toggle, the row that held `n4` still reports `getNode() === nodes[4]`, and the row that held `n5` still reports `getNode() === nodes[5]`. Both return the identical `Glyph` instance from `getToggle()` that they returned before the toggle.
8. After that toggle, the row bound to `n3` has a *different* `Glyph` instance whose `getGlyphName()` is `'caret-down'`. This is the case an index-keyed diff would miss: `n3` does not move, so only its own state change catches it.
9. Collapsing `n3` again rebinds exactly one row — the row bound to `n3`, whose caret returns to `'caret-right'`. The rows for `n4` and `n5` are not rebound in either direction.
10. Across the expand in case 6, the rows for `n4` and `n5` each receive a `setTranslate` call — they moved one row down the screen — while the rows for `n0`–`n2` receive none.[^translate-goes-up] Assert `_lastRowWidth` is unchanged across the toggle first, exactly as the neighbouring last-branch test does at [Tree.test.ts:1428-1435](packages/lib/tests/component/tree/Tree.test.ts#L1428-L1435): a width change calls `invalidateGeom()` and repositions every row, which would make this case pass or fail for an unrelated reason.

11. **Economy at realistic scale.** Build one folder containing 47 file branches of 4 leaves each (236 flat rows), `expandAll()`, scroll to `60 * ROW_HEIGHT`, then toggle an expanded file branch sitting inside the window. Assert the total `setRowData` call count across the whole pool is at most 6, and that at least 25 of the 31 pool rows return the identical `getToggle()` result they returned before the toggle. On the current code the same fixture rebinds 27 rows and replaces 12 toggle glyphs, leaving only 19 unchanged.[^measurement]

12. **Selection and focus survive.** Call `selectNode` on a node below the toggle point, then expand a branch above it. `getSelectedNodes()` and `getSelectedNode()` still report that node; the pool row whose `getNode()` returns it still carries the `.selected` style state; and the tree's `aria-activedescendant` still names that same row's id, because the row kept the node.

13. **A lazy load still repaints its own row.** `expandNodeAsync` on a lazy node writes `node.children` in place and flips `loading` `true`→`false` and `expanded` `false`→`true`; the node keeps its slot through the reconciliation and is still rebound, so its spinner is replaced by a `caret-down` toggle.

### Existing behaviour that must stay green, unchanged

14. `'a single-row scroll rebinds and repositions only the entering row'` ([Tree.test.ts:1333-1351](packages/lib/tests/component/tree/Tree.test.ts#L1333-L1351)) — one rebind, one reposition. This is the rotation path and proves it was not disturbed.
15. `'toggling the last branch repositions no pre-existing row …'` ([Tree.test.ts:1415-1439](packages/lib/tests/component/tree/Tree.test.ts#L1415-L1439)) — nothing follows the last branch, so no surviving row moves and the reposition count stays zero.
16. `'setNodes() with wholly new node identities still rebinds every visible row'`, `'setNodes() called again with the SAME node objects (content mutated in place) still re-renders the change'`, and `'setRendererFactory() still forces a real rebind of every visible row'` ([Tree.test.ts:1441-1487](packages/lib/tests/component/tree/Tree.test.ts#L1441-L1487)) — all three reset `_boundIndices` to `-1`, so the reconciliation matches nothing and returns early.
17. The whole of `packages/lib/tests/component/table/` — `Body.ts` is not modified and never calls the new method.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test
npx vitest run tests/component/tree/Tree.test.ts                      # fast path while iterating
npx vitest run tests/component/table/ tests/component/shared/         # Body and the shared base must be untouched
npm run lint
npm run test:lint
npm run docs:api                                                      # Tree's public JSDoc changed; must finish with zero warnings
grep -c "_flatRowsDirty" src/typescript/lib/component/tree/Tree.ts                       # expect 4
grep -n  "reconcilePoolByKey" src/typescript/lib/component/table/Body.ts                 # expect zero matches
grep -c  "alignPoolWindow" src/typescript/lib/component/table/Body.ts                    # expect 1, unchanged
grep -nE "alignPoolWindow|reconcilePoolByKey" src/typescript/lib/component/tree/Tree.ts  # expect 2: the else branch and the keyed call
git diff --stat -- src/typescript/lib/component/table/                                   # expect empty
```

Manual smoke check (not automatable — this is real-browser rendering): `npm run dev` in `packages/docs`, open the `Tree` component page, expand and collapse branches in the middle of a scrolled, densely expanded tree. Confirm no visible flicker, no missing or stale carets, no row rendering the wrong label, and that the selection highlight stays on the selected node as rows shift.

---

## Documentation Impact

No exported symbol changes, so there is no API-page or barrel work. Four hand-authored pages describe the pooling mechanism this plan changes and must be updated with it:

| File | Edit |
|---|---|
| `packages/lib/docs/concepts/performance.md` (the `Tree` sentence in "Virtual scrolling", line 48) | Add that a slot now follows its node across an expand/collapse, so a row that is still on screen keeps its DOM element and pays only a reposition. |
| `packages/lib/docs/recipes/virtualized-list.md` (the `Tree` paragraph in "Why this works", line 41) | Same point, one sentence, linking to the performance page as it already does. |
| `packages/lib/docs/components/Tree.md` ("Custom row renderers", line 138) | "when the slot is mapped to a different node" is now the uncommon case — say a slot keeps its node across an expand/collapse and its renderer is only re-`update`d when the slot is genuinely handed different content. |
| `packages/lib/docs/reference/changelog/next.md` ("Fixed" → "Components") | New bullet below the existing `Tree` toggle-rebind entry, describing the reduced cost of a toggle in the middle of a scrolled tree, and stating that no consumer action is needed. |

Both `Table`/`Body` descriptions on the performance and recipe pages stay exactly as they are — `Body` still binds purely by data index.

---

## Potential Challenges

- **The reconciliation and `_bindAndMeasure`'s rebind condition must stay in agreement about what `-1` means.** A future change that stops writing `-1` into `_boundIndices` for hidden or freshly grown slots would silently make stale slots reusable. Mitigation: `reconcilePoolByKey`'s JSDoc states the dependency, and Expected Behaviour cases 2 and 3 fail loudly if the sentinel stops being honoured.
- **The four parallel arrays must be reordered together.** Reordering `_rowPool` without `_rowGeom` would leave `positionRow` comparing a row against another row's cached geometry and silently skipping a needed translate. Mitigation: one `reorder` call per array, adjacent, plus Expected Behaviour case 1 asserting all four moved identically.
- **Transform writes go up while rebinds go down.** Rows below a change point now move on screen instead of being re-rendered in place, so their `setTranslate` count rises.[^translate-goes-up] Mitigation: Expected Behaviour case 10 pins the new reposition pattern explicitly, so it is a documented consequence rather than a surprise in a later audit.
- **A `Tree` consumer that mutates a node in place and relies on an unrelated toggle to repaint it will stop seeing the repaint.** That was never a supported contract — `setNodes` is the documented refresh path and keeps its blanket invalidation — but the accidental repaint does disappear.[^narrowed-accident]

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — the pool bookkeeping arrays, `alignPoolWindow` (the sibling the new primitive sits beside), `growRowPool` / `hideExcessPoolRows` (where the `-1` sentinel is written), and `positionRow` (whose geometry cache is one of the four arrays being reordered).
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — `renderWindow`, `_flatten`, `_bindAndMeasure`, `_positionRows`.
- [`packages/lib/src/typescript/lib/component/table/Row.ts:461-651`](packages/lib/src/typescript/lib/component/table/Row.ts#L461-L651) — `Row.setColumnWindow`, the precedent this plan's algorithm mirrors: match by stable key through a `Map`, recycle leftovers, refresh what a shift invalidates for survivors, then permute into the new order.
- [`packages/lib/src/typescript/lib/component/table/Row.ts:708`](packages/lib/src/typescript/lib/component/table/Row.ts#L708) — `reconcileWindowSlide`, the precedent for keeping a cheap specialised path (here, the scroll rotation) alongside the general keyed one.
- [`packages/lib/src/typescript/lib/component/table/Body.ts:1389-1473`](packages/lib/src/typescript/lib/component/table/Body.ts#L1389-L1473) — `bindAndPositionRows`. Read to confirm `Body` binds purely by data index and derives `setStripe` / `computeRowAria` from that index, which is why it is left alone. Not edited.
- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts:156-192`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L156-L192) — `getNode` (the identity the reconciliation reads out of a slot) and `isBoundTo` (the rebind check that still runs afterwards).
- [`plans/implemented/tree-row-toggle-rebind-perf.md`](plans/implemented/tree-row-toggle-rebind-perf.md) — the shipped plan this one builds on, in particular its `## Implementation Notes` on why `setNodes` and `setRendererFactory` keep their blanket invalidation.
- [`packages/lib/tests/component/tree/Tree.test.ts:1222-1488`](packages/lib/tests/component/tree/Tree.test.ts#L1222-L1488) — the characterization and rebind-gating blocks the new tests extend, and the two assertions Step 8 changes.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), "Three non-negotiable rules for every DOM write", rule 3 — why `_flatRowsDirty` is a private field and not a `TreeOptions` entry.

---

## Non-Goals

- **No change to `table/Body.ts` or to `TreeBody`.** `Body` binds slots purely by data index and derives per-slot state (`setStripe`, `computeRowAria`) from that index, and every structural change it sees already arrives through a blanket `_boundIndices.fill(-1)`. Making it benefit is a separate investigation with editing, cell ranges and separators in the blast radius.[^why-not-body]
- **No change to `_bindAndMeasure`, `_positionRows`, or `TreeRow`.** The rebind decision and the row-level content comparison are exactly what the prior plan shipped and are deliberately left alone.
- **No shape-aware leftover assignment.** When a window position has no surviving slot, it takes the next unclaimed one rather than hunting for a leftover whose caret shape happens to match the one `setRowData` is about to want. Chasing that would be speculative complexity for a case the rebind already handles correctly.
- **No renderer-level work.** `IconLabelTreeNodeRenderer.update`'s own costs are unchanged and out of scope, as they were in the prior plan.

---

## Implementation Notes

- **Manual smoke check performed and passing.** `## Verification`'s manual step calls for `packages/docs`, but that app's own west sidebar (`DocsSidebar.ts`) already mounts a real, deep `Tree` — the API reference nav alone is 807 symbols — so it stood in for the Tree component page's own small demo tree, which is too shallow to virtualize. Built up a densely-expanded, scrolled sidebar tree (`component` → `editor`/`table`/`container` and their `Classes` groups), selected a leaf node (`MarkdownEditor`), then toggled sibling branches above it via the caret only (not the row body, which also reselects). Confirmed, by comparing each visible row's DOM element `id` before and after: every row below the toggle kept its exact `id`↔label pairing and only translated by whole `ROW_HEIGHT` multiples; the selected row's element, `aria-selected`, background highlight, and the tree's `aria-activedescendant` all survived unchanged; a large collapse (`table`'s 41-class `Classes` group) while scrolled mid-tree left the visible window gap-free and duplicate-free before and after. Matches Expected Behaviour cases 6, 7, 10, and 12 in a real browser, not just the offline harness.
- **Pitfall for a future manual check of this app**: `packages/lib`'s `package.json` `exports` map points at `./dist/lib/...`, and `packages/docs`'s dev server resolves `@jimka/typescript-ui` by walking up to whichever ancestor `node_modules` provides that package — in a `git worktree`, that is the **main working tree's** `node_modules` (worktrees don't get their own `npm install`), pointing at the *main tree's* `packages/lib`, not the worktree's. Running `npm run dev` in a worktree's `packages/docs` therefore silently serves the main tree's stale prebuilt library, no matter what the worktree's own source says. Confirmed via `performance.getEntriesByType('resource')` in the browser, which showed the loaded `Tree-*.js` chunk's path resolving outside the worktree. Worked around for this check only, not committed: a worktree-local `node_modules/@jimka/typescript-ui` symlink to the worktree's own `packages/lib`, plus `npm run build:lib` there to populate `dist/lib`. Both were removed after the check.

---

## Notes

[^measurement]: Reproduced offline against this branch's code with a throwaway `vitest` spec (written, run, and deleted during planning — not committed). Fixture: one folder node containing 47 file-branch nodes of 4 leaves each, `setNodes` + `expandAll()`, width 300, height 600, scrolled to `60 * ROW_HEIGHT`. That yields 236 flat rows, a 30-row window and a 31-slot pool. Toggling `file12` — the second expanded file branch inside the window — produced 27 `setRowData` calls across the pool, 12 toggle `Glyph` instances replaced, and 26 slots left showing a different node; re-expanding produced identical counts. Zero `setTranslate` calls, because today a slot is pinned to a screen position and its content scrolls through it. This is the offline counterpart of the live-browser measurement that motivated the work (a ~250-node search-result tree under a mutation observer: ~60-100 DOM nodes added and removed, ~9-16 SVG icons rebuilt, ~600-900 attribute writes, 60-100ms per toggle in desktop Chrome). The live numbers are cited as reported motivation; the offline counts above are the ones this plan's Expected Behaviour is written against.

[^why-no-lcs]: A longest-common-subsequence (or longest-increasing-subsequence) diff — React's, Vue 3's, and Svelte's keyed-list algorithms — exists to minimise the number of DOM `insertBefore` moves, because in a document-ordered list a move is a real cost. This pool has no document order to preserve: every row is positioned by a `translate3d` on its own compositor layer, and `growRowPool` appends elements in creation order and never reorders them ([VirtualRowView.ts:335-357](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L335-L357)). Permuting a JS array costs the same whatever the permutation, so nothing is gained by minimising moves — the only quantity that matters is how many window positions get a slot whose content already matches, and a plain hash join maximises that by construction, in O(window + pool). A specialised algorithm exploiting the fact that an expand or collapse inserts or removes one *contiguous* run was also considered and rejected: it would need `_expand` / `_collapse` / `_loadAndExpand` to thread the change point and row delta through `_flatten` into `renderWindow`, and the assumption breaks for `expandAll` and `revealByPredicate`, which open several branches in a single pass. The hash join handles every one of those uniformly with no extra state.

[^two-paths]: The two paths are a cost and risk decision, not a correctness one — for a pure scroll the keyed reconciliation would produce an equivalent permutation, since every surviving node shifts by the same delta. The reasons to keep them separate: `alignPoolWindow`'s rotation is the already-shipped, already-tested scroll path and a fling runs it every frame, whereas the keyed path allocates a `Map` and three arrays per call. Confining that allocation to a reflatten — a user gesture, not a frame — keeps the scroll hot path exactly as it is today. `_flatRowsDirty` is set in `_flatten`, which has only two call sites ([Tree.ts:276](packages/lib/src/typescript/lib/component/tree/Tree.ts#L276) in `setNodes` and [Tree.ts:735](packages/lib/src/typescript/lib/component/tree/Tree.ts#L735) in `_reflattenAndRender`), so every path that can move a row between flat positions is covered and nothing else is.

[^sentinel-reuse]: The `-1` forced-rebind sentinel already carries exactly the meaning the reconciliation needs, which is why no new invalidation channel is introduced. `setNodes` ([Tree.ts:279-280](packages/lib/src/typescript/lib/component/tree/Tree.ts#L279-L280)), `setRendererFactory` ([Tree.ts:660-661](packages/lib/src/typescript/lib/component/tree/Tree.ts#L660-L661)) and the inherited `onThemeReflow` ([VirtualRowView.ts:571-575](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L571-L575)) all fill `_boundIndices` with `-1` before rendering. The reconciliation then finds no reusable slot, returns having only recorded the window start, and every slot is rebound exactly as it is today — including the in-place-node-mutation case the prior plan's audit found and pinned with a regression test.

[^translate-goes-up]: The change inverts which resource a structural update spends. Today a pool slot is pinned to a screen position and the content scrolls through it: zero translates, 27 rebinds on the measured fixture. Afterwards a slot follows its node and moves with it: roughly 26 translates, around 5 rebinds. The trade is favourable because a rebind runs `renderer.update()` (a text write plus a re-measure), four ARIA attribute writes that `ElementAttributes.set` does not dedupe, and — for 12 of those 27 rows — a `Glyph` teardown and SVG reconstruction, whereas a translate is a single write to a property the base already pre-promotes to its own compositor layer precisely so it stays "composite-only (avoids layout/paint per scroll tick)" ([VirtualRowView.ts:340-346](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L340-L346)). The per-row `layoutChildren` call is a wash: `_positionRows` already runs it when either the row was rebound or its geometry changed, so roughly the same number of rows run it either way.

[^why-not-body]: `Body` was read in full before deciding, and three things separate its row model from `Tree`'s. First, `_boundIndices` is not just a rebind cache there — it is the slot-to-data-index map that ten other methods read, including `_boundIndices.indexOf(anchorIdx)` for the editor and active-descendant lookups ([Body.ts:2601](packages/lib/src/typescript/lib/component/table/Body.ts#L2601), [2634](packages/lib/src/typescript/lib/component/table/Body.ts#L2634), [2865](packages/lib/src/typescript/lib/component/table/Body.ts#L2865)). Second, `Body` derives per-slot state from the *index* rather than the record — `row.setStripe(dataIndex % 2 === 1)` and `computeRowAria(row, dataIndex)` ([Body.ts:1439-1441](packages/lib/src/typescript/lib/component/table/Body.ts#L1439-L1441)) — so a slot reused for the same record at a shifted index would still need a survivor-refresh pass, and the "no work at all" win `Tree` gets does not exist. Third, every structural change `Body` sees already arrives through a blanket invalidation: `onStoreChange` fills `_boundIndices` with `-1` ([Body.ts:481-483](packages/lib/src/typescript/lib/component/table/Body.ts#L481-L483)), as does `invalidateRowBindings` ([Body.ts:610-612](packages/lib/src/typescript/lib/component/table/Body.ts#L610-L612)), which is what `TreeBody.setExpanded` calls. A reconciliation would therefore match nothing until each of those resets is first re-justified one at a time — the same audit the prior `Tree` plan needed, but with open cell editors, cell-range selection and separator rows in scope, and with sorting (which permutes everything, so identity matching gains little) as the most common case. The primitive is nevertheless placed on the shared base rather than inside `Tree`, because the knowledge it encodes — that four parallel arrays and the private `_lastWindowStart` must move in lockstep — is the base's, not `Tree`'s. `Tree` supplies the identity; `Body` simply does not call it.

[^narrowed-accident]: Today, a toggle anywhere above a row hands that row's slot a different node, which forces a `setRowData` and so re-runs `renderer.update()` — repainting any in-place mutation to the node's own fields as a side effect. After this change the row keeps its slot and that accidental repaint no longer happens. It was never a contract: `setNodes` is the documented refresh path for in-place mutation, keeps its blanket invalidation for exactly this reason, and is what the known consumers of the idiom call (`packages/docs/src/shell/DocsSidebar.ts`, and Loom's `FileTree.ts` doing `node.children = children; this.setNodes(this.getNodes())`). Recorded so a reviewer recognises the narrowing as intended rather than as a regression.

[^tests-live-in-tree-test]: The base-primitive cases go in `Tree.test.ts` rather than a new file under `tests/component/shared/`. The existing shared-directory file, `VirtualRowView.poolDisposal.test.ts`, tests its mechanism through both subclasses because both exercise it; `reconcilePoolByKey` has exactly one caller, so testing it through `Tree` is where the behaviour actually lives, and the characterization block in `Tree.test.ts` already pokes base primitives (`computeVisibleWindow`, `computePoolTarget`, `growRowPool`, `hideExcessPoolRows`, `invalidateGeom`) the same way.
