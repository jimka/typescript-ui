# Tree Row Toggle Rebind Performance — Implementation Plan

## Overview

Expanding or collapsing any node in a [`Tree`](packages/lib/src/typescript/lib/component/tree/Tree.ts) currently costs work proportional to how many *other* expandable rows happen to be visible, not just the row(s) that actually changed. A direct measurement (mutation observer around real toggle clicks, ~250-node tree, 47 branch nodes) found collapsing a folder that leaves few expandable rows on screen cost 4 DOM nodes added/4 removed, 2 icons rebuilt; re-expanding the *same* folder (bringing ~20 expandable rows back into view) cost 103 added/103 removed, 19 icons rebuilt — same logical operation, ~25× the cost, purely because of how many unrelated rows were on screen. Toggling a single leaf-level branch deep in a dense area paid the same ~100-node, ~20-icon cost as the big folder re-expand.

Two mechanisms combine to make every toggle pay for these unrelated rows, both unconditional blanket-invalidation with no comparison against what a row already correctly shows:

1. [`TreeRow.setRowData`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L169-L215) disposes and reconstructs the expand/collapse caret `Glyph` on *every* call that binds a row with children — even when the row's `hasChildren`/`expanded`/`loading` triple is identical to what it was last bound with.
2. [`Tree._reflattenAndRender`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L719-L724) — the render path behind every expand/collapse/lazy-load transition — calls `this._boundIndices.fill(-1)` and `this.invalidateGeom()` unconditionally, marking every pooled row "unbound" and every cached row geometry "stale." The subsequent [`renderWindow`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1331-L1401) pass then rebuilds and repositions every visible row through [`_bindAndMeasure`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1413-L1441) / [`_positionRows`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1453-L1465), regardless of whether that row's slot ends up bound to the same node at the same position it already had.

This plan fixes both, entirely inside `Tree.ts` and `TreeRow.ts` — no change to the shared [`VirtualRowView`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) base that `table/Body.ts` also extends, and no change to `Body.ts` itself.

---

## Architecture Decisions

### The caret fix mirrors the codebase's own compare-then-rebuild pattern

`TreeRow.setRowData` gains a memoized "last bound" snapshot and skips disposing/reconstructing the toggle `Glyph` when the new `hasChildren`/`expanded`/`loading` triple matches the snapshot. This is not a new pattern: [`IconLabelTreeNodeRenderer.update`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L91-L110) already does exactly this for a tree row's own content icon (`_currentGlyph`, compared at [IconLabel.ts:94](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L94)), and [`GlyphListItemRenderer.update`](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L89-L110) does the identical thing for a list row's icon — its own doc comment ([Glyph.ts:41](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L41)) even states it is "matching the pattern `TreeRow` uses for its toggle," which is currently untrue and becomes true once this ships.

### Rebind gating moves from index identity to content identity

`Tree._bindAndMeasure` currently decides whether to call `setRowData` by comparing `_boundIndices[i]` (the data index a pool slot was bound to last render) against the data index it needs this render. That works for a pure scroll — [`alignPoolWindow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377-L393) rotates the pool arrays so a slot's index tracks the same underlying row across a scroll tick — but a reflatten changes *which* node sits at a given data index, so index equality stops meaning "this slot already shows the right thing."

The fix replaces the index check with a content check owned by `TreeRow` itself: a new public `isBoundTo(node, depth, hasChildren, expanded, siblingCount, posInSet, selected, loading)` query, backed by the same "last bound" snapshot the caret fix adds, reports whether a call to `setRowData` with these exact arguments would be a pure no-op. `_bindAndMeasure` calls `setRowData` only when it would not.[^why-not-flatrow-diff] This also makes `_reflattenAndRender`'s and `setNodes`'s blanket `this._boundIndices.fill(-1); this.invalidateGeom();` unnecessary: a row whose slot's content genuinely changed is caught by `isBoundTo` regardless of what `_boundIndices` says, and a row whose target Y/width/height genuinely changed is already caught by [`positionRow`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L406-L428)'s own per-slot geometry cache comparison — `invalidateGeom()` only forces that comparison to report "changed" for rows that didn't actually move. `Tree.renderWindow` already has its own, narrower `invalidateGeom()` call ([Tree.ts:1383-1386](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1383-L1386)) that fires specifically when the shared row width changes, so width-driven geometry staleness stays covered independently of this change.

`_boundIndices` itself is not removed: `growRowPool`, `alignPoolWindow`, and `hideExcessPoolRows` (all inherited from `VirtualRowView`, shared with `Body`) still read and rotate it, so `Tree` keeps writing `this._boundIndices[i] = dataIndex` on every bind pass — it simply stops being the signal `Tree` reads to decide whether a bind is needed.

### `setRendererFactory` keeps its blanket invalidation

[`Tree.setRendererFactory`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L638-L653) replaces every pooled row's renderer instance (`row.setRenderer(factory())`). The fresh renderer has no cached icon or label text, so every visible row genuinely needs a real `setRowData` call regardless of whether its bound node/state changed — renderer identity is not one of the eight values `isBoundTo` compares, so applying the same optimization here would silently leave freshly-swapped renderers blank. This call site is rare (an explicit API call, not a per-toggle hot path), so it is left exactly as it is today: `this._boundIndices.fill(-1); this.invalidateGeom();` before the next `renderWindow()`.

### ARIA writes stay unconditional inside `setRowData`, confirmed not assumed

`setRowData`'s four ARIA calls (`setLevel`/`setExpanded`/`setSetSize`/`setPosInSet`) route through [`Aria`](packages/lib/src/typescript/lib/core/Aria.ts)'s private `setAttribute` ([Aria.ts:789-792](packages/lib/src/typescript/lib/core/Aria.ts#L789-L792)) into [`Component.setElementAttribute`](packages/lib/src/typescript/lib/core/Component.ts#L1690-L1701) and [`ElementAttributes.set`](packages/lib/src/typescript/lib/core/ElementAttributes.ts#L30-L38). `ElementAttributes.set` writes to the DOM sink unconditionally whenever attached — it does not compare against the previously stored value before writing. So these four writes are not internally deduped, and calling `setRowData` at all always re-issues all four, whether or not any of the four ARIA-relevant values actually changed. This is unaffected by this plan either way: `setRowData`'s own body keeps these four calls exactly as-is. What changes is how *often* `setRowData` itself is called — the `isBoundTo` gate in `_bindAndMeasure` — so a row untouched by a toggle no longer pays for these four writes at all, while a row that does get rebound (because at least one of the eight compared values changed) pays the same four writes it always did.

---

## Public API

```typescript
// TreeRow — new public method
isBoundTo(
    node: TreeNode,
    depth: number,
    hasChildren: boolean,
    expanded: boolean,
    siblingCount: number,
    posInSet: number,
    selected: boolean,
    loading: boolean,
): boolean;
```

`setRowData`'s own signature and return type (`this`) are unchanged.

---

## Internal Structure

### `TreeRow` — new cached fields

Added directly below the existing `_node`/`_depth` fields ([TreeRow.ts:69-70](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L69-L70)):

```typescript
private _node:     TreeNode | null = null;
private _depth:    number          = 0;

// Snapshot of everything setRowData() last bound this row to. isBoundTo()
// compares against it so Tree can skip a rebind that would be a no-op.
private _hasChildren:  boolean = false;
private _expanded:     boolean = false;
private _siblingCount: number  = 0;
private _posInSet:     number  = 0;
private _selected:     boolean = false;
private _loading:      boolean = false;
```

### `TreeRow.isBoundTo` (new, placed immediately before `setRowData`)

```typescript
isBoundTo(node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean, siblingCount: number, posInSet: number, selected: boolean, loading: boolean): boolean {
    return node === this._node
        && depth === this._depth
        && hasChildren === this._hasChildren
        && expanded === this._expanded
        && siblingCount === this._siblingCount
        && posInSet === this._posInSet
        && selected === this._selected
        && loading === this._loading;
}
```

A freshly constructed row has `_node === null`, which can never equal a real `TreeNode`, so its first `isBoundTo` call always reports `false` regardless of the other fields' defaults — no separate "never bound" sentinel is needed.

### `TreeRow.setRowData` — current vs. fixed

Current ([TreeRow.ts:169-215](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L169-L215)):

```typescript
setRowData(node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean, siblingCount: number, posInSet: number, selected: boolean, loading: boolean): this {
    this._node = node;
    this._depth = depth;

    if (this._toggle) {
        this._toggle.dispose();
        this._toggle = null;
    }

    if (this._spinner) {
        this._spinner.dispose();
        this._spinner = null;
    }

    if (loading) {
        const spinner = new ProgressSpinner();
        this._spinner = spinner;
        const el = this.getElement();
        if (el) { DOM.sink.appendChild(el, spinner.getElement(true)!); }
    } else if (hasChildren) {
        const toggle = new Glyph(expanded ? "caret-down" : "caret-right");
        toggle.setCursor("pointer");
        toggle.clearInsets();
        toggle.getAria().setHidden(true);
        this._toggle = toggle;
        const el = this.getElement();
        if (el) { DOM.sink.appendChild(el, toggle.getElement(true)!); }
    }

    this._renderer.update({ node, depth, expanded, selected, hasChildren });

    this.getAria().setLevel(depth + 1);
    this.getAria().setExpanded(hasChildren ? expanded : null);
    this.getAria().setSetSize(siblingCount);
    this.getAria().setPosInSet(posInSet);

    return this;
}
```

Fixed — the toggle/spinner block is gated on whether the triple that determines the caret's visual state actually changed; the snapshot fields are always updated so `isBoundTo` stays accurate:

```typescript
setRowData(node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean, siblingCount: number, posInSet: number, selected: boolean, loading: boolean): this {
    const toggleUnchanged = hasChildren === this._hasChildren
        && expanded === this._expanded
        && loading === this._loading;

    this._node         = node;
    this._depth        = depth;
    this._hasChildren  = hasChildren;
    this._expanded     = expanded;
    this._siblingCount = siblingCount;
    this._posInSet     = posInSet;
    this._selected     = selected;
    this._loading      = loading;

    if (!toggleUnchanged) {
        if (this._toggle) {
            this._toggle.dispose();
            this._toggle = null;
        }

        if (this._spinner) {
            this._spinner.dispose();
            this._spinner = null;
        }

        if (loading) {
            const spinner = new ProgressSpinner();
            this._spinner = spinner;
            const el = this.getElement();
            if (el) { DOM.sink.appendChild(el, spinner.getElement(true)!); }
        } else if (hasChildren) {
            const toggle = new Glyph(expanded ? "caret-down" : "caret-right");
            toggle.setCursor("pointer");
            toggle.clearInsets();
            toggle.getAria().setHidden(true);
            this._toggle = toggle;
            const el = this.getElement();
            if (el) { DOM.sink.appendChild(el, toggle.getElement(true)!); }
        }
    }

    this._renderer.update({ node, depth, expanded, selected, hasChildren });

    this.getAria().setLevel(depth + 1);
    this.getAria().setExpanded(hasChildren ? expanded : null);
    this.getAria().setSetSize(siblingCount);
    this.getAria().setPosInSet(posInSet);

    return this;
}
```

A transition into or out of `loading` always has `loading` differ, so `toggleUnchanged` is always `false` across a spinner⇄caret swap — the swap keeps working exactly as before, just no longer running redundantly when neither `loading` nor `hasChildren`/`expanded` moved.

### `Tree._bindAndMeasure` — current vs. fixed

Current ([Tree.ts:1413-1441](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1413-L1441)): `selected` is computed only inside the `if (wasRebound)` branch, and `wasRebound` comes from `this._boundIndices[i] !== dataIndex`.

Fixed:

```typescript
private _bindAndMeasure(firstRow: number, windowSize: number): { reboundFlags: boolean[], maxContentWidth: number } {
    const reboundFlags: boolean[] = new Array(windowSize);
    let maxContentWidth = 0;

    for (let i = 0; i < windowSize; i++) {
        const row         = this._rowPool[i];
        const dataIndex   = firstRow + i;
        const flatRow     = this._flatRows[dataIndex];
        const hasChildren = this._isExpandable(flatRow.node);
        const expanded    = this._expandedNodes.has(flatRow.node);
        const loading     = this._loadingNodes.has(flatRow.node);
        const selected    = this._selectedNodes.has(flatRow.node);

        const wasRebound = !row.isBoundTo(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet, selected, loading);

        if (wasRebound) {
            row.setRowData(flatRow.node, flatRow.depth, hasChildren, expanded, flatRow.siblingCount, flatRow.posInSet, selected, loading);
        }

        this._boundIndices[i] = dataIndex;
        reboundFlags[i] = wasRebound;

        const cw = row.getContentWidth(INDENT_PX);
        if (cw > maxContentWidth) {
            maxContentWidth = cw;
        }
    }

    return { reboundFlags, maxContentWidth };
}
```

`_positionRows` ([Tree.ts:1453-1465](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1453-L1465)) is unchanged — it already consumes `reboundFlags` exactly as produced here, and `positionRow`'s own geometry-cache comparison is untouched.

---

## Ordered Implementation Steps

1. **`TreeRow.ts`** — add the six new private fields shown in `## Internal Structure`, directly below the existing `_node`/`_depth` fields ([TreeRow.ts:69-70](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L69-L70)).

2. **`TreeRow.ts`** — add the `isBoundTo` method shown above, immediately before `setRowData` ([TreeRow.ts:169](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L169)), with a JSDoc block in this file's existing style (see `getNode`/`getDepth` just above it for the tone: one sentence, `@param`/`@returns`).

3. **`TreeRow.ts`** — replace `setRowData`'s body with the fixed version in `## Internal Structure`. Keep the existing per-parameter JSDoc; add one `@remarks` sentence noting the toggle/spinner block is skipped when `hasChildren`/`expanded`/`loading` match the last bind, mirroring `IconLabelTreeNodeRenderer.update`'s own `@remarks` wording style ([IconLabel.ts:42-47](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L42-L47)).
   Check: `grep -n "toggleUnchanged" packages/lib/src/typescript/lib/component/tree/TreeRow.ts` — expect exactly one match (the declaration).

4. **`Tree.ts`** — in `_bindAndMeasure` ([Tree.ts:1413-1441](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1413-L1441)), hoist `selected` out of the removed `if` block and replace the `wasRebound` computation as shown in `## Internal Structure`. Move `this._boundIndices[i] = dataIndex;` so it runs unconditionally, every iteration.

5. **`Tree.ts`** — in `_reflattenAndRender` ([Tree.ts:719-724](packages/lib/src/typescript/lib/component/tree/Tree.ts#L719-L724)), delete the `this._boundIndices.fill(-1);` and `this.invalidateGeom();` lines, leaving `this._flatten(); this.renderWindow();`. Update its JSDoc: replace "forces a full rebind of the pool so every row reflects the current expanded/loading state" with wording reflecting that each row rebinds only if `TreeRow.isBoundTo` reports it changed.

6. **`Tree.ts`** — in `setNodes` ([Tree.ts:255-273](packages/lib/src/typescript/lib/component/tree/Tree.ts#L255-L273)), delete the same two lines from inside the `if (this.getElement())` block, leaving only `this.renderWindow();`.

7. **`Tree.ts`** — in `setRendererFactory` ([Tree.ts:638-653](packages/lib/src/typescript/lib/component/tree/Tree.ts#L638-L653)), leave the existing `this._boundIndices.fill(-1); this.invalidateGeom();` untouched, but add a one-line comment above them: `// Renderer identity isn't part of TreeRow.isBoundTo's comparison, so every row needs a real rebind here — see "setRendererFactory keeps its blanket invalidation" in the plan.` (or the equivalent once the plan is in `plans/implemented/`).
   Check: `grep -n "_boundIndices.fill(-1)" packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect exactly one match, inside `setRendererFactory`.

8. **`Tree.test.ts`** — add the TreeRow-level and Tree-level tests from `## Expected Behaviour` below.

9. Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |

---

## Expected Behaviour

All of the following are unit-testable offline or with `installTestDOM` (per `packages/lib/tests/dom/TestDOM.ts`, already used throughout `Tree.test.ts`); none needs a real browser. `caret-down`/`caret-right` are registered automatically by importing `TreeRow.ts` ([TreeRow.ts:16](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L16)), so no extra `Glyph.register` setup is needed for these cases.

**`TreeRow.isBoundTo` / toggle memoization** (construct a `new _TreeRow()` directly, call `getElement(true)` to materialize it, call `setRowData` directly — no mounted `Tree` needed, mirroring how `packages/lib/tests/component/list/renderer.test.ts` tests `GlyphListItemRenderer` standalone):

1. A fresh row's first `setRowData(node, 0, true, false, 1, 1, false, false)` (a collapsed branch) constructs a toggle `Glyph` whose `getGlyphName()` is `'caret-right'`.
2. Re-binding the same row with the *same* `hasChildren`/`expanded`/`loading` (only `selected` flips) leaves `getToggle()` returning the identical `Glyph` instance (`toBe`, not `toEqual`) — nothing was disposed or reconstructed.
3. Re-binding with `expanded: true` (only `expanded` changes) swaps the toggle to a *different* `Glyph` instance (`not.toBe` the original) whose `getGlyphName()` is `'caret-down'`.
4. Re-binding with `loading: true` (was `false`) disposes the toggle (`getToggle()` becomes `null`) and appends a spinner; a subsequent re-bind with `loading: false, hasChildren: true` disposes the spinner and reconstructs a toggle again.
5. `isBoundTo(...)` called with the exact arguments just passed to `setRowData` returns `true`; changing any *one* of the eight arguments (test each independently: `node`, `depth`, `hasChildren`, `expanded`, `siblingCount`, `posInSet`, `selected`, `loading`) makes it return `false`.

| Field flipped from the last bind | `isBoundTo(...)` |
|---|---|
| none — identical arguments | `true` |
| `node` (different `TreeNode`) | `false` |
| `expanded` only | `false` |
| `selected` only | `false` |

**Tree-level integration** (mounted tree, following the `mount()` / `installTestDOM(CONFIG)` / `DOM.reset()` pattern in the existing `describe('Tree virtual-scroll — characterization', ...)` block, [Tree.test.ts:1129-1259](packages/lib/tests/component/tree/Tree.test.ts#L1129-L1259)):

6. Build a tree of several sibling branch nodes, each with one child, all initially collapsed and all visible in the viewport (e.g. 10 branches, tall enough viewport, mirroring `bigTree`'s shape at [Tree.test.ts:1133-1135](packages/lib/tests/component/tree/Tree.test.ts#L1133-L1135) but with children instead of leaves). Toggle one branch in the middle to expanded. Assert, via `vi.spyOn` on every pool row's `setRowData` (the same idiom as the existing "a single-row scroll rebinds and repositions only the entering row" test, [Tree.test.ts:1240-1258](packages/lib/tests/component/tree/Tree.test.ts#L1240-L1258)): `setRowData` is called only for the toggled row and the newly-inserted child row — every other pool row's `setRowData` spy has zero calls. Additionally capture an unrelated branch row's `getToggle()` reference before the toggle and assert it is the *same* instance afterward (the literal "does not reconstruct an unrelated row's Glyph" case).
7. Same fixture, but expand the *last* branch in the list (nothing below it, so no other row's position changes). Spy on `setTranslate` for every pool row; assert only the toggled row's own row and the newly-inserted child row receive a `setTranslate` call — every row before the toggled one gets zero.
8. `setNodes()` called with a wholly new node array (different `TreeNode` object identities, some previously-expanded-equivalent labels) still fully rebinds every visible row: spy on `setRowData` across the pool before/after a second `setNodes()` call and assert every visible slot's spy was called at least once (node identity differs for all of them, so `isBoundTo` cannot report an unwarranted no-op).
9. `setRendererFactory()` still forces a real rebind of every visible row (unaffected by this change): spy on `setRowData` across the pool, call `setRendererFactory(() => new LabelTreeNodeRenderer())` on an already-rendered tree, and assert every visible slot's spy was called exactly once.
10. (Existing, must stay green, no code change needed) [Tree.test.ts:1240-1258](packages/lib/tests/component/tree/Tree.test.ts#L1240-L1258)'s single-row-scroll test and [Tree.test.ts:393-411](packages/lib/tests/component/tree/Tree.test.ts#L393-L411)'s `_onToggle` flat-row-count test.

Manual smoke-check (optional, not a substitute for the above — this project's own convention for a small change, per the root `CLAUDE.md`'s "re-read the diff... run tests" step): `npm run dev` in `packages/lib`, open a demo page using `Tree` with a reasonably deep/wide dataset, expand and collapse a few nodes, confirm no visible flicker or missing carets.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test              # includes the new Tree.test.ts cases
npx vitest run tests/component/tree/Tree.test.ts   # fast path while iterating
npm run lint
npm run test:lint
npm run docs:api          # isBoundTo is a new public method; must finish with zero warnings
grep -n "_boundIndices.fill(-1)" packages/lib/src/typescript/lib/component/tree/Tree.ts   # expect exactly one match (setRendererFactory)
grep -n "toggleUnchanged" packages/lib/src/typescript/lib/component/tree/TreeRow.ts       # expect exactly one match
```

---

## Potential Challenges

- **`TreeRow.init()` doesn't re-append `_toggle`/`_spinner` on an element release-and-rebuild** — a pre-existing, separately catalogued gap.[^init-gap] Because this plan makes `setRowData` fire less often, a row whose element is released and rebuilt while `isBoundTo` reports it unchanged now goes longer, on average, before a real `setRowData` call happens to re-append a missing toggle. This is not a regression this plan introduces (the gap exists today, independent of this change) and fixing `TreeRow.init()` is out of scope here — it belongs to the future release-and-rebuild work the catalogue feeds. Flagged so a reviewer doesn't mistake it for new-in-this-plan.
- **`isBoundTo` and the cache-writing block in `setRowData` must stay in lockstep.** A future field added to what `setRowData` binds (a ninth parameter, say) that isn't added to both the snapshot fields and `isBoundTo`'s comparison would silently reintroduce stale rows — worse than the performance bug this plan fixes. Mitigation: the two are placed adjacent in the file, and `isBoundTo`'s JSDoc cross-references `setRowData`.
- **The "prefix rows don't reposition" test (`## Expected Behaviour` #7) must use a fixture where the pool/window size is easy to reason about exactly** — pick an explicit small node count and viewport height so `computePoolTarget`'s `SCROLL_BUFFER` padding doesn't leave the test guessing at which slots are in play.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/tree/TreeRow.ts`](packages/lib/src/typescript/lib/component/tree/TreeRow.ts) — the fix site for the caret-churn half.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](packages/lib/src/typescript/lib/component/tree/Tree.ts) — the fix site for the blanket-invalidation half (`_bindAndMeasure`, `_reflattenAndRender`, `setNodes`, `setRendererFactory`).
- [`packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts:91-110`](packages/lib/src/typescript/lib/component/tree/renderer/IconLabel.ts#L91-L110) — `IconLabelTreeNodeRenderer.update`, the precedent for the compare-then-rebuild pattern.
- [`packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts:89-110`](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L89-L110) — `GlyphListItemRenderer.update`, a second instance of the same precedent, whose own doc comment names `TreeRow`'s toggle as the (currently unmet) sibling pattern.
- [`packages/lib/tests/component/list/renderer.test.ts:64-118`](packages/lib/tests/component/list/renderer.test.ts#L64-L118) — the existing test idiom (`toBe`/`not.toBe` on a cached icon instance) the new `TreeRow` tests follow.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:377-455`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L377-L455) — `alignPoolWindow`, `positionRow`, `hideExcessPoolRows`, `invalidateGeom`: read to confirm none of them need to change and that `positionRow`'s own geometry-cache comparison is what makes dropping the blanket `invalidateGeom()` calls safe. Not edited.
- [`packages/lib/tests/component/tree/Tree.test.ts:1129-1259`](packages/lib/tests/component/tree/Tree.test.ts#L1129-L1259) — the `mount()`/`installTestDOM` pattern and the existing single-row-scroll spy test the new integration tests extend.
- [`packages/lib/tests/component/tree/Tree.test.ts:230-253`](packages/lib/tests/component/tree/Tree.test.ts#L230-L253) — the `TreePrivate`/`asPrivate` offline-testing idiom, if any new test needs private-surface access beyond what's public.

---

## Non-Goals

- **No change to `VirtualRowView.ts` or `table/Body.ts`.** The fix is fully expressible inside `Tree.ts`/`TreeRow.ts` using the protected fields `Tree` already inherits; extending the same content-based diffing to `Body`'s row/cell pooling is a separate, larger investigation this plan does not attempt.
- **No logic change to `setRendererFactory`'s blanket invalidation** — kept intentionally; see `## Architecture Decisions`. Step 7 only adds a one-line explanatory comment inside it, in the same `Tree.ts` file already being modified for the other three call sites.
- **No fix to `TreeRow.init()`'s missing `_toggle`/`_spinner` re-append on element release-and-rebuild** — pre-existing, catalogued separately, out of scope here; see `## Potential Challenges`.
- **No change to renderer-level costs** (e.g. `IconLabelTreeNodeRenderer.update`'s unconditional label `setText`/`measure` calls). Out of scope: the reported bug and this plan's fix are specifically about the toggle caret and the pool's rebind gating, not renderer internals — and the renderer's own icon-churn behavior already follows the correct pattern today.

---

## Implementation Notes

**Step 6's removal of `setNodes`'s blanket invalidation was a real regression, caught by audit, and reverted.** The plan's Step 6 removes `setNodes`'s `this._boundIndices.fill(-1); this.invalidateGeom();` on the theory that it's as unnecessary there as it is in `_reflattenAndRender`/the collapse/expand path — but `setNodes` has a different, stronger contract than a reflatten: its own JSDoc says it "replaces the root nodes... and re-renders," and a real, load-bearing consumer idiom (`packages/docs/src/shell/DocsSidebar.ts:94,121,312`; Loom's `FileTree.ts:436`, `node.children = children; this.setNodes(this.getNodes())`) calls it with the *same* node object references, mutated in place, specifically to force a refresh. `isBoundTo` has no way to see a mutation to a node it already holds a reference to — it only compares reference identity, not content — so with Step 6 applied exactly as written, `setNodes(sameNodes)` after mutating a node's `label` in place silently stopped re-running that row's `renderer.update()`, leaving the mutated label unrendered (confirmed empirically: 0 `setRowData` calls, stale label). `setNodes` now keeps its blanket `_boundIndices.fill(-1); this.invalidateGeom();` exactly as it was before this plan — the same treatment `setRendererFactory` already gets and for the identical underlying reason (content can change behind an identity `isBoundTo` sees as unchanged) — while `_reflattenAndRender` (expand/collapse/lazy-load, which never hands in new or externally-mutable node data) keeps the plan's optimization. A new test (`Tree.test.ts`, `'setNodes() called again with the SAME node objects (content mutated in place) still re-renders the change'`) pins the corrected contract. `TreeRow.setRenderer` also now clears its bound-node snapshot (`this._node = null`) so `isBoundTo` can't report a stale match against a just-swapped renderer's absent content, independent of whichever caller's own invalidation bookkeeping; `Tree.ts`'s class-level JSDoc and `docs/components/Tree.md` were updated to describe the current content-identity mechanism instead of the removed index-identity one.

**`_bindAndMeasure`'s rebind decision needed a forced-rebind sentinel beyond `isBoundTo` alone, or `setRendererFactory` would silently stop working.** The plan's own `## Architecture Decisions` states `setRendererFactory` "is left exactly as it is today: `this._boundIndices.fill(-1); this.invalidateGeom();`" specifically so every visible row still gets a real `setRowData` call — but the plan's specified `_bindAndMeasure` body decides `wasRebound` purely from `!row.isBoundTo(...)`, which never reads `_boundIndices` at all. Verified empirically (a throwaway spec spying on `TreeRow.prototype.setRowData` across a `setRendererFactory()` call, deleted before this commit): with the plan's code exactly as written, every row's `isBoundTo` reports "unchanged" (the renderer swap touches none of the eight compared values), so `setRowData` is never called and a freshly-swapped renderer never receives its first `update()` — rows go blank, precisely the failure the Architecture Decision says this call site must avoid. The fix ORs the `isBoundTo` check with `this._boundIndices[i] === -1`: `_reflattenAndRender`/`setNodes` no longer touch `_boundIndices` at all (so this sentinel never fires for a reflatten, preserving the plan's targeted optimization), while `setRendererFactory`'s still-`.fill(-1)`'d indices force every visible row to rebind, matching both the Architecture Decision's stated intent and the `## Expected Behaviour` #9 test. Recorded here rather than as a plan edit per this skill's "deviation you had to make" — the fix is additive to, not a rewrite of, the specified `_bindAndMeasure`.

**`## Expected Behaviour` #6's exact call-count claim does not hold for a middle-branch toggle, and the committed test asserts the corrected, verified claim instead.** Pool slots are bound by flat-row *position* (`dataIndex = firstRow + i`), not by node identity, and neither `alignPoolWindow` (a no-op when `firstRow` is unchanged, which it is for an in-place expand/collapse) nor anything else relocates a slot's assigned index to follow "its" node when a reflatten inserts rows ahead of it. So toggling a *middle* branch does give every row after the insertion point a genuinely different node at its slot's dataIndex, and `isBoundTo` correctly reports each of those as changed — `setRowData` **is** called on them (verified empirically: 4 calls, not 2, for a 6-branch tree with the 4th branch toggled). The performance property this plan actually delivers for those rows is narrower than "no `setRowData` call": their expensive toggle `Glyph` dispose/reconstruct is still elided whenever the new node's `hasChildren`/`expanded`/`loading` triple happens to match what that slot last showed (true here, since every branch is a uniform collapsed-branch-with-one-child shape) — confirmed by capturing a shifted-into row's `getToggle()` instance before and after. The committed test (`Tree.test.ts`, `'Tree — rebind gating after a reflatten (isBoundTo)'`) asserts exactly this: zero `setRowData` calls on a row strictly *before* the toggle point, and toggle-`Glyph` identity preserved on a row *after* it whose slot ends up showing a different, same-shaped node.

**`## Expected Behaviour` #7's claim that "the toggled row's own row" receives a `setTranslate` call is also inaccurate, for a related reason: a slot's on-screen Y offset is `dataIndex * ROW_HEIGHT`, a pure function of pool-slot index and `firstRow` — never of which node currently occupies it.** Toggling the *last* branch changes no slot's `dataIndex`, so no pre-existing row's position changes at all (verified empirically: every pre-existing slot showed zero `setTranslate` calls); only the freshly-grown pool row for the newly-revealed child ever receives a first-time position write, and that row didn't exist before the toggle to spy on. The committed test asserts the verified property — zero `setTranslate` calls across every pre-existing pool row — rather than the plan's stated two-row split.

**The `## Verification` section's `grep -n "toggleUnchanged" ... # expect exactly one match` is imprecise but not wrong in the way that matters.** The fixed `setRowData` (as the plan itself specifies in `## Internal Structure`) both declares `const toggleUnchanged = ...` and later reads it in `if (!toggleUnchanged)`, so a literal `grep -n` reports two lines, not one. The declaration itself is unique, matching the check's own parenthetical ("the declaration") — implemented exactly as specified, this discrepancy is just the check's wording, not a code defect.

**The `## Verification` section's `grep -n "_boundIndices.fill(-1)" ... # expect exactly one match, inside setRendererFactory` no longer holds either, as a direct consequence of the `setNodes` revert above.** There are now two matches: `setRendererFactory` (as the plan's Step 7 intended) and `setNodes` (restored to its pre-plan behavior). Both are genuine, intentional forced-rebind call sites under the finished design, not a leftover.

**Two hand-authored docs pages outside the plan's `## Files to Create / Modify / Delete` table — `docs/concepts/performance.md`'s "Virtual scrolling" section and `docs/recipes/virtualized-list.md`'s "Why this works" section — described `Tree`'s pool-rebind mechanism identically to `Table`/`Body`'s (including citing `setData()`, which isn't even `Tree`'s method name — that's `setRowData()`).** Caught in a third audit round, since these are the project's dedicated performance-characteristics reference and recipe pages and thus directly on-topic for a performance-fix plan even though the plan itself didn't name them. Both now describe `Tree`'s actual `isBoundTo`-gated, content-identity mechanism, distinct from `Table`/`Body`'s unchanged index-identity gating, which they still describe accurately.

---

## Notes

[^why-not-flatrow-diff]: A narrower-looking alternative — diff the old `_flatRows` array against the new one by data index and invalidate only the slots whose node identity changed at that index — was considered and rejected. It has a real correctness gap: the node whose `expanded`/`loading` flag is the actual reason for the reflatten typically *stays at the same index* (only its descendants shift), so an index-keyed node-identity diff would see the same node at the same index and wrongly conclude nothing changed for that row — the toggled row's own caret would never flip. A per-row content comparison (`isBoundTo`) does not have this gap: it compares against what the row itself was last bound to, so the toggled node's own row is caught by its `expanded`/`loading` value changing, and every other row is caught (or correctly skipped) by the same mechanism, with no special-casing needed for `expandAll`/`revealByPredicate`'s multi-node case either.

[^init-gap]: [`plans/dom-only-state-inventory.md`](plans/dom-only-state-inventory.md), the `TreeRow` row (citing `TreeRow.ts:139-177,258-269`): `TreeRow.init()` re-appends `this._renderer` but has no `if (this._toggle)`/`if (this._spinner)` guard re-appending those, unlike the parallel guarded pattern in `list/renderer/Glyph.ts` and `tree/renderer/IconLabel.ts`. That document is a read-only reference catalogue (not itself an implementation plan) feeding a not-yet-drafted future plan (`plans/component-element-release.md`, referenced but not yet created) — nothing here depends on it, but this plan changes how long the gap stays open in practice, which is worth a reviewer knowing.
