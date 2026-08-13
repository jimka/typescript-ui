---
touches-shared:
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
---

# Tree Expand-Click Trigger — Implementation Plan

## Overview

`Tree` ([packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts)) currently expands or collapses a row two ways: clicking its caret always toggles it (`_handleClick`, [Tree.ts:1092-1099](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1092)), and double-clicking anywhere else on a non-leaf row's body also toggles it — "the file-explorer convention" (`_handleDblClick`, [Tree.ts:1194-1207](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1194)). This plan adds an option-bag flag, `expandTrigger`, that lets a consumer switch the row-body trigger from a double click to a single click — the IDE-sidebar convention — while leaving the caret's own single-click toggle untouched.

The change is confined to `Tree.ts`, its test file, its barrel export, the default-options-fallback registry, and its docs page — no other file in the tree hierarchy (`TreeRow`, `TreeNode`, the renderers) needs to change, and the table-layer `TreeTable` / `TreeBody` are a separate, untouched hierarchy.

---

## Architecture Decisions

### `expandTrigger?: "dblclick" | "click"` on `TreeOptions`, mirroring `TreeRowOverflow`

The option is a two-value string-literal type, `TreeExpandTrigger`, following the exact shape `TreeRowOverflow` already establishes on this same class ([Tree.ts:38](packages/lib/src/typescript/lib/component/tree/Tree.ts#L38)): a module-level `export type Tree{Name} = "a" | "b"`, a matching `TreeOptions` field, a class-level default in `_defaultTreeOptions`, and a `getExpandTrigger()` / `setExpandTrigger()` pair with no separate backing field (the options bag is the cache, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s default setter shape). The default is `"dblclick"`, so an untouched `Tree` behaves exactly as it does today.[^enum-not-bool]

### The caret always toggles on a single click, in both modes

`expandTrigger` governs only whether the row's *body* (everything outside the caret) responds to a click. The caret keeps unconditionally toggling on a single click — `_handleClick`'s existing caret branch ([Tree.ts:1092-1099](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1092)) is unchanged.[^caret-unconditional]

### A plain click on an expandable row's body selects, then toggles — only in `"click"` mode, and only for the unmodified branch

`_handleClick`'s three selection branches ([Tree.ts:1108-1125](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1108)) already gate on modifier keys. The new toggle is added only to the final `else` branch — the one that calls `_selectAtIndex(clickedIdx)` — so a plain click both selects and toggles, while Ctrl/Cmd-click and an anchored Shift-click keep their existing multi-select and range-select meaning and never toggle. Because that branch is also reached by a Shift-click with no prior anchor (the `if (e.shiftKey && this._anchorNode)` guard fails and falls through), such a click toggles too in `"click"` mode — it behaves as a plain click today, and the new toggle inherits that unchanged.

| Click | Node | Anchor set? | `expandTrigger` | Branch taken | Toggles? |
|---|---|---|---|---|---|
| Plain | expandable | — | `"dblclick"` (default) | `_selectAtIndex` (else) | No |
| Plain | expandable | — | `"click"` | `_selectAtIndex` (else) | Yes |
| Plain | leaf | — | `"click"` | `_selectAtIndex` (else) | No — leaf is not expandable |
| Ctrl/Cmd-click | expandable | — | `"click"` | ctrl/cmd branch | No |
| Shift-click | expandable | yes | `"click"` | `_extendSelectionTo` | No |
| Shift-click | expandable | no | `"click"` | `_selectAtIndex` (else) | Yes — same branch as a plain click |
| Caret click | expandable | — | either | early return, before selection branches | Yes — unconditional |

### `_handleDblClick` skips its own row-body toggle when `expandTrigger` is `"click"`

`_handleDblClick` already skips its toggle when the click landed on the caret, because `_handleClick` fired `_onToggle` once per click of the pair and toggling a third time would flip the net state ([Tree.ts:1194-1199](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1194)). The same reasoning now applies to the row body whenever `expandTrigger` is `"click"`: each of the two clicks already toggled it there too, via the branch above. The row-body toggle condition widens: instead of just checking that the click was not on the caret, it now also requires `expandTrigger` to still be `"dblclick"`. The `"dblclick"` event itself keeps firing unconditionally on every real double-click, in both modes — it is not renamed, gated, or duplicated for single-click activation.[^dblclick-unchanged]

| Gesture | `expandTrigger` | What happens | Net expansion change |
|---|---|---|---|
| Double-click, row body, expandable | `"dblclick"` (default) | click 1 selects; click 2 selects (no-op); native dblclick emits `"dblclick"` and toggles once | Flips once |
| Double-click, row body, expandable | `"click"` | click 1 selects + toggles; click 2 selects (no-op) + toggles back; native dblclick emits `"dblclick"`, toggle skipped | Unchanged |
| Double-click, caret | either | click 1 toggles; click 2 toggles back; native dblclick emits `"dblclick"`, toggle skipped (unchanged from today) | Unchanged |

### No new single-click activation event

The task is to move the expand/collapse *trigger*, not to add an activation channel. `"dblclick"` remains the only activation event and keeps firing solely on a genuine double-click, regardless of `expandTrigger`. A leaf row's plain click in `"click"` mode does exactly what it does today — select, nothing else.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/tree/Tree.ts

/** Which click gesture on a row's body expands or collapses it. Default `"dblclick"`. */
export type TreeExpandTrigger = "dblclick" | "click";

export interface TreeOptions extends ComponentOptions {
    rowOverflow?: TreeRowOverflow;

    /** Which click gesture on a row's body expands/collapses it. Default `"dblclick"`. See {@link TreeExpandTrigger}. */
    expandTrigger?: TreeExpandTrigger;

    listeners?: { /* unchanged */ };
}

class Tree extends VirtualRowView<TreeRow, TreeOptions> {
    getExpandTrigger(): TreeExpandTrigger;
    setExpandTrigger(expandTrigger: TreeExpandTrigger): this;
}
```

No new field, no new event. `getExpandTrigger()` folds `this._options.expandTrigger ?? this._defaultOptions.expandTrigger ?? "dblclick"`, matching `getRowOverflow()`'s shape exactly ([Tree.ts:179-181](packages/lib/src/typescript/lib/component/tree/Tree.ts#L179)).

`packages/lib/src/typescript/lib/component/tree/index.ts` re-exports `TreeExpandTrigger` as a type, alongside `TreeRowOverflow`.

---

## Internal Structure

`_handleClick`'s final branch ([Tree.ts:1123-1125](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1123)) gains the toggle:

```typescript
} else {
    this._selectAtIndex(clickedIdx);

    if (this.getExpandTrigger() === "click" && this._isExpandable(node)) {
        this._onToggle(node);
    }
}
```

`_handleDblClick`'s toggle condition ([Tree.ts:1205-1207](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1205)) widens by one clause:

```typescript
if (!onToggle && this._isExpandable(node) && this.getExpandTrigger() === "dblclick") {
    this._onToggle(node);
}
```

---

## Ordered Implementation Steps

Every step is in [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) unless stated otherwise. Line numbers are as of writing; find the symbol by name if they have drifted.

1. **Add the `TreeExpandTrigger` type.** After `TreeRowOverflow` ([Tree.ts:38](packages/lib/src/typescript/lib/component/tree/Tree.ts#L38)), add the type alias and its one-line JSDoc from `## Public API`.

2. **Widen `TreeOptions`.** After the `rowOverflow` field ([Tree.ts:71-72](packages/lib/src/typescript/lib/component/tree/Tree.ts#L71)), add the `expandTrigger?: TreeExpandTrigger;` field with its doc comment from `## Public API`. Leave `listeners` untouched — no new event.

3. **Seed the default.** In `_defaultTreeOptions` ([Tree.ts:89-94](packages/lib/src/typescript/lib/component/tree/Tree.ts#L89)), add `expandTrigger: "dblclick",` after `rowOverflow: "scroll",`.

4. **Dispatch it in `applyOptions`.** In `applyOptions` ([Tree.ts:164-172](packages/lib/src/typescript/lib/component/tree/Tree.ts#L164)), after the `rowOverflow` dispatch, add:
   ```typescript
   if (options.expandTrigger !== undefined) {
       this.setExpandTrigger(options.expandTrigger);
   }
   ```

5. **Add the getter/setter.** Directly after `setRowOverflow` ([Tree.ts:191-195](packages/lib/src/typescript/lib/component/tree/Tree.ts#L191)), add `getExpandTrigger()` / `setExpandTrigger()`, mirroring `getRowOverflow()` / `setRowOverflow()`'s JSDoc depth and the folding-getter shape from `## Public API`.

6. **Extend `_handleClick`'s JSDoc.** In its `@remarks` block ([Tree.ts:1075-1080](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1075)), after the three-bullet modifier list, add one paragraph: when {@link getExpandTrigger} is `"click"`, a plain click (no modifiers) on an expandable row's body also toggles its expansion after selection is applied; Ctrl/Cmd-click and Shift-click never toggle; the caret always toggles regardless of this setting.

7. **Add the toggle to `_handleClick`.** Replace the final `else` branch ([Tree.ts:1123-1125](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1123)) with the version in `## Internal Structure`.

8. **Extend `_handleDblClick`'s JSDoc.** In its `@remarks` block ([Tree.ts:1168-1173](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1168)), add one sentence: when {@link getExpandTrigger} is `"click"`, the row-body toggle below is skipped too, for the same reason the caret's is — each click of the pair already toggled it via `_handleClick`.

9. **Widen `_handleDblClick`'s toggle-skip comment and condition.** Extend the existing comment ([Tree.ts:1194-1199](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1194)) to state the row-body case alongside the caret case, then replace the `if` ([Tree.ts:1205-1207](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1205)) with the version in `## Internal Structure`.

10. **Barrel export.** In [packages/lib/src/typescript/lib/component/tree/index.ts:4](packages/lib/src/typescript/lib/component/tree/index.ts#L4), add `TreeExpandTrigger` to the `export type { TreeOptions, TreeEvent, TreeRowOverflow }` line.

11. **Checkpoint.** `grep -n 'getExpandTrigger()' packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect exactly 3 matches: the getter's own definition, the call in `_handleClick`, the call in `_handleDblClick`.

12. **Default-options registry row.** In [packages/lib/tests/component/default-options-fallback.test.ts:373](packages/lib/tests/component/default-options-fallback.test.ts#L373), add a row immediately after the `Tree rowOverflow` row: `{ label: 'Tree expandTrigger', resolve: () => new Tree().getExpandTrigger(), expected: 'dblclick' }`, matching the file's column alignment.

13. **Add the unit tests.** In [packages/lib/tests/component/tree/Tree.test.ts](packages/lib/tests/component/tree/Tree.test.ts), add the test groups covering every case in `## Expected Behaviour`, following the two existing conventions in that file: the offline `describe('Tree rowOverflow', …)` block ([Tree.test.ts:1058-1094](packages/lib/tests/component/tree/Tree.test.ts#L1058)) for the getter/setter/default tests, and the mounted `describe('Tree — ctrl/cmd-click selection event fires only on a real change', …)` block ([Tree.test.ts:1285-1319](packages/lib/tests/component/tree/Tree.test.ts#L1285)) — its `mount()` helper, `installTestDOM(CONFIG)` / `DOM.reset()` pair, `p._flatRows[0].node`, `p._rowPool.find(...)`, and `p._handleClick(makeEvent(el, 'click', { ctrlKey: true }))` shape — for the click/dblclick-dispatch tests. `_handleDblClick` has no existing test coverage at all; the new tests are this behavior's first regression net, for both the default mode and the new mode.

14. **Update the docs.** Per `## Documentation Impact`.

15. **Run the checks.** Per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/index.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All of the following are reachable offline: `_handleClick` and `_handleDblClick` are invoked directly with a `makeEvent(...)`-built `MouseEvent`, the same white-box pattern the existing ctrl/cmd-click test already uses — no real DOM event dispatch is needed. Use `fruitTree()`'s root nodes (`'Hello'`, expandable; `'World'`, a leaf) as fixtures.

**Getter/setter/default (offline, no DOM):**

- `new _Tree().getExpandTrigger()` returns `'dblclick'`.
- `new _Tree({ expandTrigger: 'click' }).getExpandTrigger()` returns `'click'`.
- `tree.setExpandTrigger('click')` changes what `getExpandTrigger()` returns.
- The default-options-fallback registry row (step 12) passes.

**`_handleClick` — row body (mounted, per the Architecture Decisions table):**

- Default mode (`'dblclick'`): a plain click on `'Hello'`'s row body selects it and leaves `_expandedNodes` untouched (regression check — this must keep working unchanged).
- `'click'` mode: a plain click on `'Hello'`'s row body selects it **and** adds it to `_expandedNodes`; the same click on an already-expanded `'Hello'` removes it.
- `'click'` mode: a plain click on `'World'`'s (leaf) row body selects it; `_expandedNodes` stays empty.
- `'click'` mode: a Ctrl-click (or Cmd/`metaKey`) on `'Hello'`'s row body toggles its *selection* membership only; `_expandedNodes` stays untouched.
- `'click'` mode: a Shift-click on `'Hello'`'s row body **with an anchor already set** range-selects only; `_expandedNodes` stays untouched.
- `'click'` mode: a Shift-click on `'Hello'`'s row body **with no anchor set** behaves like a plain click — selects and toggles.
- In every mode, a click on the caret still toggles unconditionally (existing behavior — regression check).

**`_handleDblClick` — row body (mounted):**

- Default mode: a synthetic `_handleDblClick(makeEvent(rowEl, 'dblclick'))` on `'Hello'`'s row body emits `"dblclick"` with the node and toggles `_expandedNodes` once (first-ever coverage of this pre-existing path).
- `'click'` mode: driving a full double-click — `_handleClick` twice (selecting/toggling on each), then `_handleDblClick` once — emits `"dblclick"` but leaves `_expandedNodes` in the same membership state it had before the gesture (the two `_handleClick` toggles cancel out; `_handleDblClick` itself does not toggle).
- Either mode: a double-click on a leaf row's body emits `"dblclick"` and never touches `_expandedNodes`.
- Either mode: a double-click on the caret emits `"dblclick"` and does not toggle a third time (existing behavior — regression check).

**Manual verification (not exercised by the offline harness — a real double vs. single click delivered through the browser's own event timing):**

- In the library demo app (`npm run dev` in `packages/lib`), temporarily construct a tree with `expandTrigger: 'click'` (e.g. edit the `Tree` at [ContentBoxPanel.ts:562](packages/lib/src/typescript/ContentBoxPanel.ts#L562), or run it from the browser console) and confirm a single click on a folder row's body both selects and expands/collapses it, a real double-click does not double-toggle, and Ctrl/Shift-click still only affect selection. Revert the temporary edit afterward.
- Confirm the default (no `expandTrigger` passed) still requires a double-click to toggle a row's body, matching today's behavior, in both the library demo and the docs sidebar.

---

## Verification

From `packages/lib`:

- `npm run typecheck` — the library build's type check.
- `npm run typecheck:test && npx vitest run tests/component/tree/Tree.test.ts tests/component/default-options-fallback.test.ts` — the new and existing tests.
- `npm run test` — the full library suite.
- `npm run lint` — local ESLint rules.
- `npm run docs:api` — must finish with zero warnings (the new public JSDoc must not `{@link}` a private symbol, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- `grep -n 'getExpandTrigger()' src/typescript/lib/component/tree/Tree.ts` — expect 3 matches (step 11).
- `grep -n 'TreeExpandTrigger' src/typescript/lib/component/tree/index.ts` — expect 1 match, the type re-export.

Manual smoke tests: the two bullets at the end of `## Expected Behaviour`.

---

## Documentation Impact

- **Barrel** — `TreeExpandTrigger` re-exported as a type from [packages/lib/src/typescript/lib/component/tree/index.ts](packages/lib/src/typescript/lib/component/tree/index.ts), beside `TreeRowOverflow`.
- **`packages/lib/docs/components/Tree.md`** — add a row to the *Common methods* table ([Tree.md:105](packages/lib/docs/components/Tree.md#L105)), directly after the `getRowOverflow()` / `setRowOverflow()` row: `getExpandTrigger()` / `setExpandTrigger(mode)` — Get/set which click gesture on a row's body expands it (see [Expand trigger](#expand-trigger)). Add a new `## Expand trigger` section after `## Row overflow` ([Tree.md:107-117](packages/lib/docs/components/Tree.md#L107)), matching that section's structure: explain the `"dblclick"` default, show `Tree({ expandTrigger: 'click' })`, and state that Ctrl/Cmd-click and an anchored Shift-click never toggle, only a plain click does, while the caret always toggles regardless.
- **`packages/lib/docs/reference/changelog/next.md`** — under the existing `## Added` → `### Tree` section ([next.md:46-63](packages/lib/docs/reference/changelog/next.md#L46)), add one bullet in the house style (bold lead, description, closing "No consumer action is needed.") for the new `expandTrigger` option and its default.
- **`packages/lib/llms.txt`** — no change. It is built from a curated manifest plus each symbol's first JSDoc paragraph; `Tree`'s class-level summary is untouched.

---

## Potential Challenges

- **Two `renderWindow()` passes per click, in `"click"` mode.** `_selectAtIndex` and `_onToggle` (via `_expand`/`_collapse`) each call `renderWindow()` internally; calling both from the same `_handleClick` invocation runs the pass twice before the browser paints. No visible effect, and no other call site in this file batches across two such calls either — not addressed here.
- **`_handleDblClick` had no test coverage before this plan.** Step 13's default-mode dblclick test is new baseline coverage, not just coverage for the added mode — treat a failure there as a possible pre-existing bug, not just a regression from this change.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/tree/Tree.ts](packages/lib/src/typescript/lib/component/tree/Tree.ts) — read `_handleClick`, `_handleDblClick`, `_onToggle`, `_isExpandable`, `getRowOverflow`/`setRowOverflow`, and `applyOptions` in full first.
- [packages/lib/tests/component/tree/Tree.test.ts](packages/lib/tests/component/tree/Tree.test.ts) — the `rowOverflow` describe block and the ctrl/cmd-click mounted describe block are the two templates for the new tests; `makeEvent`/`installTestDOM` come from `../../dom/TestDOM`.
- [packages/lib/tests/component/default-options-fallback.test.ts](packages/lib/tests/component/default-options-fallback.test.ts) — the default-resolution registry this change must add a row to, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) (*Class-level defaults must survive the getter*).
- [plans/implemented/tree-expand-observability.md](plans/implemented/tree-expand-observability.md) — the most recent plan to widen `Tree`'s public surface; its caret-vs-body double-toggle-skip reasoning (its `[^drop-loading-guard]`-adjacent discussion of `_handleDblClick`) is the direct precedent this plan extends.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Three non-negotiable rules for every DOM write* (the options-bag-is-the-cache setter shape) and *Event handling* (why no new event is needed here).
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the default-resolution registry rule.

---

## Non-Goals

- **No new single-click activation event.** `"dblclick"` stays the only activation event, tied to a real double-click, in both modes. See *No new single-click activation event* above.
- **No change to keyboard navigation.** `ArrowRight` / `ArrowLeft` already toggle directly via `_onToggle` ([Tree.ts:1024-1069](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1024)) and are orthogonal to which mouse gesture triggers a click-driven toggle.
- **No change to the caret's own toggle behavior.** It stays an unconditional single-click affordance in both modes.
- **No change to `TreeBody` / `TreeTable`.** They are a separate table-layer hierarchy with their own expansion state, untouched by this plan.
- **No click-timing delay to disambiguate a genuine single click from the first half of a double-click.** The two-clicks-cancel-out behavior in the worked table above already makes one unnecessary.[^dblclick-unchanged]

---

## Notes

[^enum-not-bool]: A boolean (`expandOnClick: boolean`) was considered and rejected in favor of matching `TreeRowOverflow`'s established shape. Both read the same at the call site (`{ expandTrigger: "click" }` vs `{ expandOnClick: true }`), but the string-literal form is what this exact class already uses for its other two-way row-interaction setting, and it names both values instead of leaving the "off" state to be inferred from a negated flag.

[^caret-unconditional]: Making the caret's toggle conditional on `expandTrigger` would remove the one interaction that reliably expands a row in `"click"` mode's own edge cases — e.g. a Ctrl-click on the row body, which must not toggle (see the decision above). Keeping the caret unconditional means there is always at least one direct, unambiguous way to toggle a row regardless of `expandTrigger` or modifier keys, matching how the caret already behaves identically under both the caret-click and double-click paths today.

[^dblclick-unchanged]: Changing what `"dblclick"` fires for, or adding a parallel single-click event, would be new public surface nobody asked for and would need its own decision about payload and timing semantics. Leaving `"dblclick"` exactly as it is — an activation signal tied to the real DOM double-click gesture — means an existing consumer's `on("dblclick", …)` handler keeps working unchanged no matter which `expandTrigger` a `Tree` is constructed with. The alternative of adding a click-count debounce (waiting ~250ms after a single click to see if a second one follows before committing the toggle) was also rejected: because `_handleClick`'s two toggles during a real double-click already net to zero (see the second worked table), `"click"` mode does not need the debounce to look correct on a real double-click — the debounce would add a timer, cleanup, and a perceptible expand delay for no behavioral gain.
