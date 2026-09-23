---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
---

# List and Tree Row Economy — Implementation Plan

## Overview

Three pieces of work in `List`, `MultiSelectList` and `Tree` scale with row count and change nothing. This plan removes all three. It is G24 of the render-performance campaign ([`99-synthesis.md:2002`](plans/research/render-review-2026-09-15/99-synthesis.md#L2002)), which W3.0 — the bounding sweep run before wave 3 — measured as **plan it** ([`96-w3-0-bounding-sweep.md:161`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L161)):

| Waste | Where | W3.0 reading |
|---|---|---|
| One arrow key rewrites the `class` attribute of **every** list row, though only the old and the new focused row change | `SelectableListRow.setSelected` / `setFocused` / `applyRowClass` ([`AbstractSelectableList.ts:506-679`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L506)) | `list-items` key: 604 → 8 sink writes per key at n=300, 6,004 → 8 at n=3,000 |
| Every `Tree.doLayout` re-renders the row window, even when nothing changed | `Tree.doLayout` ([`Tree.ts:2277-2287`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L2277)) | `tree-nodes` passes: 288 → 2 counted calls per pass |
| An arrow key clamped at the end of a list fires `change` although the selection did not move | `AbstractSelectableList.moveFocus` ([`AbstractSelectableList.ts:2176-2192`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2176)) | `list-items` at n=1: 1.0 event dispatch per key |

Frame time did not move in W3.0, because arrow-key frames are vsync-bound at these sizes. The work does grow with the number of rows, so it is scored on work avoided.

The change touches two library files, `component/list/AbstractSelectableList.ts` and `component/tree/Tree.ts`, plus one JSDoc line in `component/shared/selectionsEqual.ts`. `TreeRow.ts` and the tree renderers are not touched. Library paths in link text below are relative to `packages/lib/src/typescript/lib/`.

---

## Architecture Decisions

### Scope: what this plan takes from G24

The synthesis groups ten findings under G24. This plan takes the three W3.0 bounded — F18.1, F18.6(1) and F18.7 — with the two the same code removes (F18.12, F16.2(b)) and the one the tree change needs to stay correct (F18.13).

| Sub-item | In or out | Short reason |
|---|---|---|
| F18.1 — every row's class rewritten per key | **in** | the list-rows half |
| F18.12 — the whole-attribute class write can drop framework tokens | **in** | removed by the same change |
| F18.6(1) — `Tree.doLayout` re-renders unconditionally | **in** | the tree-window half |
| F18.13 — `Tree.setRowOverflow` schedules nothing | **in** | the `doLayout` change below would otherwise leave it waiting |
| F18.7 — a no-op move fires `change` | **in**, for navigation keys only | the no-op move |
| F16.2(b) — the row writes on an open `ComboBox` | **in** | it is F18.1's guard |
| F18.3 — tree labels measured one string at a time | **out** | waits for G18[^out-f18-3] |
| F18.5(2) — marker lists renumber every item on append | **out** | no panel, construction-time only[^out-f18-5] |
| F18.10 — `rowOverflow: "clip"` still accumulates a content width | **out** | no panel; an unchanged pass no longer reaches it[^out-f18-10] |
| F16.2(a) — `ComboBox` re-commits the list's selection on every arrow key (the status pass's "arrow-key half") | **out** | this plan already makes the re-commit write nothing[^out-f16-2] |
| F18.6(2) — the selection sweep runs twice per selection change | **out** | no cell measures it; it writes nothing[^out-f18-6b] |
| F18.2 — lists are not virtualised (908 writes per unchanged pass) | **out** | a separate lever, not bounded by W3.0[^out-f18-2] |
| F18.1's second half — the scroll read after the writes | **out** | now follows 6 writes, not 603[^out-scroll-read] |

### List rows toggle one class token per changed state

`SelectableListRow.setSelected`, `setFocused` and `setEnabled` return early when the value equals the row's cached state. A changed value toggles a single class token through `Component.setStyleState(".selected" | ".focused" | ".disabled", …)` instead of rewriting the whole `class` attribute. `applyRowClass` and the row's `render()` override are deleted. This is how `TreeRow` rows already carry `.selected` and `.focused` ([`Tree.ts:2006-2029`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L2006)), and `setEnabled` already guards on its cached field ([`AbstractSelectableList.ts:559-570`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L559)).[^token-precedent]

The hand-written `.SelectableListRow.selected` / `.focused` / `.disabled` rules ([`AbstractSelectableList.ts:253-309`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L253)) stay exactly as they are; they match the toggled tokens. The states are **not** added to `ownStyleStates`.[^no-declared-state]

The row constructor writes `aria-selected="false"` once, so every unselected row keeps the attribute it carries today even though the early return skips the first `setSelected(false)`.[^aria-seed]

`refreshRowVisualState` keeps its loop over every row. Each row now compares its own state, so the loop writes to the DOM only for rows that changed.[^loop-kept]

Which rows a gesture writes to, with the list at row 5 (selected and focused):

| Gesture | Rows written | Writes |
|---|---|---|
| `ArrowDown` (`List`) | 5, 6 | row 5: `aria-selected="false"`, remove `selected`, remove `focused`; row 6: `aria-selected="true"`, add `selected`, add `focused`; list root: `aria-activedescendant` |
| `Shift`+`ArrowDown` (`MultiSelectList`, anchor 5) | 5, 6 | row 5: remove `focused`; row 6: `aria-selected="true"`, add `selected`, add `focused`; list root: `aria-activedescendant` |
| `Ctrl`+`ArrowDown` (focus only) | 5, 6 | row 5: remove `focused`; row 6: add `focused`; list root: `aria-activedescendant` |
| `ArrowDown` on the last row | none | nothing |

### A navigation key that leaves the selection as it was fires nothing

`moveFocus` copies the selection set before the reducer runs, and calls `notifyUserChange` only when `selectionsEqual(before, this._selectedSet)` is false. This mirrors `Tree._notifySelectionChange` ([`Tree.ts:1668-1674`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1668)) and `Body.notifySelectionChange` ([`Body.ts:2387-2393`](packages/lib/src/typescript/lib/component/table/Body.ts#L2387)), which use the same helper.

Only navigation keys change. A click, `Enter` or `Space` on the row that is already selected still fires `change` and `action`.[^nav-only]

A clamped move still runs the repaint, the `aria-activedescendant` update and the scroll check. When nothing moved the first two write nothing, and the scroll check costs one read.[^keep-scroll]

| Case (`List`) | Selection before → after | `change` / `action` |
|---|---|---|
| row 2 of 3, `ArrowDown` | {2} → {2} | none (was 1) |
| row 2 of 3, `ArrowUp` | {2} → {1} | 1 |
| focus 4, selection {5}, `ArrowDown` | {5} → {5} | none (was 1) |
| row 2 selected, `Enter` or a click on row 2 | {2} → {2} | 1, unchanged |

### `Tree.doLayout` re-renders only when the tree's box changed

`renderWindow` records the box it read — the tree's outer height and its content box from `getContentBounds()` — in a new private field `_renderedBox`. `doLayout` runs the base pass, then calls `renderWindow` only when the current box differs from `_renderedBox`, or when there is no record yet. Every other caller of `renderWindow` still renders unconditionally.

The precedent is the size-change check `Panel.doLayout` makes before its remeasure ([`Panel.ts:664`](packages/lib/src/typescript/lib/core/Panel.ts#L664)) and `DiagramView.anchorCentreAcrossResize` ([`DiagramView.ts:1760`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1760)): each records the size its last pass used and acts only on a change. `Tree` already does the same for its row width (`_lastRowWidth`, [`Tree.ts:2139`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L2139)).[^gate-seam]

| Last render read | This `doLayout` sees | Renders? |
|---|---|---|
| height 120, content box 0,0,300,120 | the same | no |
| the same | width 340 | yes |
| the same | padding 4 on every side: content box 4,4,292,112 | yes |
| an unsized tree (height `NaN`) | `NaN` again | yes — `NaN` never equals itself |
| nothing yet (`null`) | anything | yes |

The box is the only render input a layout pass brings.[^box-key] *Addendum: Render Entry Points* lists every other input and the call that renders after changing it. Two paths used to rely on a later `doLayout` instead of rendering, and now render themselves:

- `setRowOverflow` re-renders when the element exists, as `setRendererFactory` does ([`Tree.ts:1059-1061`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1059)).
- The Ctrl/Cmd-click branch of `_handleClick` ([`Tree.ts:1893-1905`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1893)) calls `renderWindow()` after its sweep, as `_selectAtIndex` does, so rows whose `selected` flag flipped are rebound at once.[^two-leaks]

A node changed in place without `notifyNodeChanged` is no longer picked up by an unrelated layout pass. The docs already require the call; the changelog says so.[^in-place]

### How the shipped change differs from the W3.0 ablations

The ablations in [`ablations.ts:1992-2047`](packages/qa/src/harness/ablations.ts#L1992) proved the saving with identical geometry, but they could ignore what a shipped change cannot.

| Ablation | Shipped change | Why it differs |
|---|---|---|
| `g24.list-rows`: `setSelected` / `setFocused` return early on an unchanged value; a changed one still rewrites the whole `class` attribute through `applyRowClass` | the same early return, also on `setEnabled`; a changed value toggles one token; `applyRowClass` is deleted; the constructor seeds `aria-selected` | the ablation was installed after mount, when every row already carried `aria-selected`; a guard active from construction needs the seed. The whole-attribute rewrite is F18.12's hazard. The write count is the same, 8 per key |
| `g24.tree-window`: `renderWindow` does nothing at all — sound only under the `passes` driver | `doLayout` skips `renderWindow` when the box is unchanged; every other caller still renders; `setRowOverflow` and Ctrl-click render themselves | a shipped gate must never swallow a render another path needs. On `passes` the effect is identical: 2 counted calls per pass |
| F18.7: a counter-only read, no arm | `moveFocus` suppresses the notification when the selection membership is unchanged | clicks and `Enter` / `Space` keep firing, which the read did not have to decide |

Memory: one five-number record per `Tree`, and one copy of the selection set per navigation key, as `Tree._selectAtIndex` already makes.[^snapshot-cost]

### Correctness risks, settled

| Risk | How the plan settles it | Pinned by |
|---|---|---|
| A reused row carries a stale state | A row's cached state is written only together with its token and its ARIA attribute, so the early return compares against what the row shows. `syncRows` reuses list rows through the same setters. Tree rows keep the whole-pool selection sweep on every render. | cases 3, 7 |
| Selection ranges | Each row compares its own state, so a range change writes exactly the rows entering or leaving it. `selectionsEqual` compares membership, so a range that resolves to the same set fires nothing. | cases 8, 14 |
| Keyboard focus | `.focused` goes through the same guarded setter. `aria-activedescendant` is still written on every move, and `Aria` drops an unchanged value. | cases 1, 13 |
| `aria-*` on the rows | `aria-selected` is written with the token and seeded at construction; the `aria-disabled` path is unchanged. | cases 1, 5 |
| The tree's row window after an expand, a collapse or a data change | Those paths call `renderWindow` themselves; only `doLayout` checks the box. | case 20; *Addendum: Render Entry Points* |

### Land after `glyph-name-setter`

The two plans share no source file. This plan does not edit `TreeRow.ts`, `tree/renderer/IconLabel.ts` or `tests/component/tree/Tree.test.ts`; its tree tests go in a new file. The shared files are the changelog and the QA README's `tree-nodes` row, which both orchestrator records extend. Land `glyph-name-setter` first; this plan then rebases with no conflict in code.[^land-order]

---

## Public API

No signature changes. Behaviour changes on existing public surface:

- `List` / `MultiSelectList` — a navigation key (`ArrowUp` / `ArrowDown` / `Home` / `End` / `PageUp` / `PageDown`, with or without `Shift`) that leaves the selection membership unchanged fires no `change`, `action` or `binding`. A click, `Enter` and `Space` are unchanged. `ComboBox` inherits this: an arrow key at either end of its open list no longer fires the combo's own `change`.
- `Tree.doLayout()` — re-renders the rows only when the tree's outer height or content box changed since the last render.
- `Tree.setRowOverflow(mode)` — takes effect immediately on a rendered tree.
- `Tree` Ctrl/Cmd-click — rebinds the toggled row at once, so its renderer's `update` sees the new `selected`.

Private additions in `Tree.ts`: the module-level `interface RenderedBox`, the field `_renderedBox`, and the methods `noteRenderedBox()` and `boxChangedSinceRender()`. `_renderedBox` is framework bookkeeping, so it gets no `TreeOptions` field (ARCHITECTURE.md's third DOM-write rule).

---

## Internal Structure

### `SelectableListRow` (in `AbstractSelectableList.ts`)

Constructor, directly after `this.getAria().setRole("option");` ([`:375`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L375)):

```typescript
// Every row starts unselected. Writing that once here keeps
// `aria-selected="false"` on every unselected row, now that `setSelected`
// skips a value the row already holds — its first call included.
this.getAria().setSelected(false);
```

The three setters:

```typescript
setSelected(value: boolean): this {
    if (value === this._selected) {
        return this;
    }

    this._selected = value;
    this.getAria().setSelected(value);
    this.setStyleState(".selected", value);

    return this;
}

setFocused(value: boolean): this {
    if (value === this._focused) {
        return this;
    }

    this._focused = value;
    this.setStyleState(".focused", value);

    return this;
}

setEnabled(value: boolean): this {
    if (this._enabled === value) {
        return this;
    }

    this._enabled = value;
    this.getAria().setDisabled(!value);
    this.setCursor(value ? "pointer" : "default");
    this.setStyleState(".disabled", !value);

    return this;
}
```

Delete `render()` ([`:581-592`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L581)) and `applyRowClass()` ([`:652-679`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L652)) with their JSDoc. `Component.init` adds a state toggled before render as a class token ([`Component.ts:8160`](packages/lib/src/typescript/lib/core/Component.ts#L8160)), which is what the `render()` override did by hand. The import on line 22 becomes `import { type StyleBag } from "~/core/ClassStyleRules.js";`.

### `AbstractSelectableList.moveFocus`

```typescript
protected moveFocus(idx: number, ctrl: boolean, shift: boolean): void {
    this._focusedIndex = idx;

    const commit = !ctrl && this._selectFollowsFocus;
    const before = commit ? new Set(this._selectedSet) : null;

    if (commit) {
        this.reduceSelection(idx, { ctrl: false, shift });
    }

    this.refreshRowVisualState();
    this.updateActiveDescendant();
    this.scrollIndexIntoView(idx);

    if (before !== null && !selectionsEqual(before, this._selectedSet)) {
        this.notifyUserChange();
    }
}
```

Add `import { selectionsEqual } from "~/component/shared/selectionsEqual.js";`.

### `Tree`

Module level, after `interface FlatRow` ([`:56`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L56)):

```typescript
/**
 * The box a row-window render read: the tree's outer height, which sizes the
 * row window, and its content box, which places the rows, the scrollbars and
 * the clip box.
 */
interface RenderedBox {
    height:  number;
    content: { x: number; y: number; width: number; height: number };
}
```

Field, beside `_lastRowWidth` ([`:220`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L220)), with a comment saying what it is and that `doLayout` compares against it:

```typescript
private _renderedBox        : RenderedBox | null                                      = null;
```

A plain initializer is safe: only `renderWindow` writes the field, and it needs an element, which no `super()`-cascade setter creates — the same reason `_lastRowWidth` has one.

Methods, placed after `renderWindow`:

```typescript
/** Records the box this render reads, for {@link boxChangedSinceRender}. */
private noteRenderedBox(): void {
    const content = this.getContentBounds();

    this._renderedBox = content === null ? null : { height: this.getHeight(), content };
}

/**
 * Whether the tree's box differs from the one the last render read. An
 * unsized tree's `NaN` height never equals itself, so it always reads as changed.
 */
private boxChangedSinceRender(): boolean {
    const last    = this._renderedBox;
    const content = this.getContentBounds();

    return last === null
        || content === null
        || last.height         !== this.getHeight()
        || last.content.x      !== content.x
        || last.content.y      !== content.y
        || last.content.width  !== content.width
        || last.content.height !== content.height;
}
```

`renderWindow`, directly after its early return ([`:2076-2078`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L2076)):

```typescript
this.noteRenderedBox();
```

`doLayout`:

```typescript
doLayout(): this {
    if (this.isLayoutPaused()) {
        return this;
    }

    super.doLayout();

    if (this.boxChangedSinceRender()) {
        this.renderWindow();
    }

    return this;
}
```

`setRowOverflow`:

```typescript
setRowOverflow(rowOverflow: TreeRowOverflow): this {
    this._options.rowOverflow = rowOverflow;

    if (this.getElement()) {
        this.renderWindow();
    }

    return this;
}
```

The Ctrl/Cmd-click branch of `_handleClick` gains one line:

```typescript
this._anchorNode = node;
this._focusNode = node;
this._updateSelectionStyle();
this.renderWindow();
this._notifySelectionChange(before);
```

---

## Ordered Implementation Steps

1. **Record the base commit.** In the implementation worktree, before any edit: `git rev-parse HEAD`. Write the SHA into this plan's *Implementation Notes*. The orchestrator builds it as the A/B's `wt` arm.

2. **Row tests, red first.** Create `packages/lib/tests/component/list/RowStateEconomy.test.ts` with *Expected Behaviour* cases 1–8. Rewrite `tests/component/list/RowFrameworkClass.test.ts` per case 9. Run both files: cases 1–4, 6 and 8 fail today; case 9 passes before and after.

3. **`SelectableListRow`** in `component/list/AbstractSelectableList.ts`, per *Internal Structure*: the constructor seed, the three setters, delete `render()` and `applyRowClass()`, narrow the `ClassStyleRules.js` import. JSDoc:
   - the class doc ([`:318-330`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L318)) adds that the selected, focused and disabled states are class tokens toggled one at a time;
   - `setSelected`, `setFocused` and `setEnabled` say they toggle the `selected` / `focused` / `disabled` token and do nothing for an unchanged value.

   Check: `grep -n 'applyRowClass\|COMPONENT_CLASS\|setElementAttribute("class"' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` → no matches. Step 2's files pass.

4. **No-op navigation tests, red first.** Add cases 10–14 to `RowStateEconomy.test.ts` and case 15 to `tests/component/input/ComboBoxDropdownClose.test.ts`. Cases 10, 13, 14 and 15 fail today.

5. **`moveFocus`** in `AbstractSelectableList.ts`, per *Internal Structure*, with the import. Its JSDoc ([`:2160-2175`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2160)) adds: the change notification fires only when the selection set changed, so a move that leaves it as it was — a key clamped at the first or last row — fires nothing. In `component/shared/selectionsEqual.ts`, the `@internal` line becomes "Shared by `Tree`, `Body` and `AbstractSelectableList`; not barrel-exported." Check: step 4's cases pass; `tests/component/list/List.test.ts`, `MultiSelectList.test.ts`, `tests/component/input/ComboBox*.test.ts` and `AutoComplete*.test.ts` pass unchanged.

6. **Tree tests, red first.** Create `packages/lib/tests/component/tree/RenderPassEconomy.test.ts` with cases 16–23. Copy its frame capture — the `beforeEach` / `afterEach` pair, `runFrames` and `makeSettledTree` — from `tests/component/tree/ResizeLayoutEconomy.test.ts:35-149`: a settle relay left armed leaks into the next test. Keep the sink `installTestDOM` returns. Cases 16, 17 and 20–23 fail today.

7. **`Tree`** in `component/tree/Tree.ts`, per *Internal Structure*: `RenderedBox`, `_renderedBox`, `noteRenderedBox`, `boxChangedSinceRender`, the line in `renderWindow`, `doLayout`, `setRowOverflow`, the Ctrl-click line. JSDoc:
   - `doLayout`'s `@remarks` ([`:2268-2276`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L2268)): a layout-manager-driven change to the tree's size, padding or border re-renders the row window; a pass that leaves the tree's box as the last render found it renders nothing, since every other change renders through the call that made it;
   - `setRowOverflow` ([`:296-303`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L296)): takes effect immediately on a rendered tree.

   Touch nothing else in `Tree.ts`, and nothing in `TreeRow.ts` or the renderers. Check: step 6's file passes; `ResizeLayoutEconomy.test.ts`, `ResizeLayoutEconomyRealtime.test.ts`, `TreeFontReflow.test.ts` and `Tree.test.ts` pass unchanged.

8. **Full suite.** `npm test`. Any failure outside the files above is a finding for *Implementation Notes*, not an assertion to loosen.

9. **Docs and changelog**, per *Documentation Impact*.

10. **Verification** — everything in *Verification* except the in-engine A/B, which the orchestrator runs.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts` |
| Create | `packages/lib/tests/component/list/RowStateEconomy.test.ts` |
| Modify | `packages/lib/tests/component/list/RowFrameworkClass.test.ts` |
| Modify | `packages/lib/tests/component/input/ComboBoxDropdownClose.test.ts` |
| Create | `packages/lib/tests/component/tree/RenderPassEconomy.test.ts` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/MultiSelectList.md` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/list-and-tree-row-economy.md` (step 1's SHA, in *Implementation Notes*) |

---

## Expected Behaviour

All cases 1–23 are unit tests under the offline test DOM (`installTestDOM`). The recording sink records `Event.fireEvent`'s `dispatchCustomEvent` as op `dispatchEvent`. Pass keys to `list.handleKey(e)` with the stub `key()` helper from `ComboBoxDropdownClose.test.ts:25-27`, extended with `ctrlKey`, `metaKey`, `shiftKey` and `altKey` fields. "Folded class tokens" means a helper `classTokens(sink, handle): Set<string>` that walks `sink.writes` in order for `apply` writes on `handle`: `setAttr.class` replaces the set, `addClass` adds, `removeClass` deletes.

**Row writes** (`tests/component/list/RowStateEconomy.test.ts`). Fixture: a rendered `_List` of 300 string items, `setWidth(300)`, `setHeight(400)`, `doLayout()`, then `setSelectedIndex(5, false)`.

1. One `ArrowDown` records exactly these writes, in order:

   | # | Op | Target | Payload |
   |---|---|---|---|
   | 1 | `apply` | row 5 | `{ setAttr: { "aria-selected": "false" } }` |
   | 2 | `apply` | row 5 | `{ removeClass: ["selected"] }` |
   | 3 | `apply` | row 5 | `{ removeClass: ["focused"] }` |
   | 4 | `apply` | row 6 | `{ setAttr: { "aria-selected": "true" } }` |
   | 5 | `apply` | row 6 | `{ addClass: ["selected"] }` |
   | 6 | `apply` | row 6 | `{ addClass: ["focused"] }` |
   | 7 | `apply` | list root | `{ setAttr: { "aria-activedescendant": <row 6's id> } }` |
   | 8 | `dispatchEvent` | list root | `change` |

2. The same key on a 3,000-item list records the same 7 `apply` and 1 `dispatchEvent`.
3. On a rendered row, `setSelected(row.isSelected())`, `setFocused(row.isFocused())` and `setEnabled(row.isEnabled())` each record no write.
4. From render onward — construction, selection changes, disabling a row — no `apply` carrying `setAttr.class` is recorded on any row handle.
5. After render every row reads `aria-selected` `"false"` through `DOM.source.getAttribute(handle, 'aria-selected')`, except the selected row, which reads `"true"`.
6. `new _List({ items: ['a', 'b', 'c'], selectedIndex: 2 })`, then `getElement(true)`: row 2's folded class tokens contain `ts-ui-component`, `SelectableListRow`, `selected` and `focused`, and `isStyleState('.selected')` is true.
7. A reused row: `setSelectedIndex(2, false)`, then `setItems(['x', 'y', 'z'])`. Row 2's folded tokens no longer contain `selected` or `focused`, and its `aria-selected` reads `"false"`.
8. A `_MultiSelectList` of 5 items, rendered and sized as in case 1's fixture. `End`, then `Shift`+`ArrowUp`: rows 3 and 4 carry `selected`, row 3 `focused`. Then `Shift`+`ArrowDown`: of the rows, only 3 and 4 record writes — row 3 loses `selected` and `focused` and reads `aria-selected` `"false"`, row 4 gains `focused`.

**Row framework class** (`tests/component/list/RowFrameworkClass.test.ts`)

9. Replace `lastClassTokens` with the `classTokens` fold. The three class cases keep their assertions against the folded set: after `setSelectedIndex(0, false)` row 0 contains `ts-ui-component` and `selected`; a disabled row contains `disabled`, `SelectableListRow` and `ts-ui-component`, an enabled one does not contain `disabled`; `setItemEnabled(1, true)` removes `disabled`. The cursor assertions and the rule-order case are unchanged. Retitle the first case to "keeps `ts-ui-component` through a selection change".

**No-op navigation** (`tests/component/list/RowStateEconomy.test.ts`)

10. A 1-item `_List`, rendered and sized as in case 1's fixture, with `setSelectedIndex(0, false)`. Each of `ArrowDown`, `ArrowUp`, `Home`, `End` and `PageDown` records no `apply` and no `dispatchEvent`, and calls no `change` or `action` listener.
11. A 3-item `_List` at row 2: `ArrowUp` fires `change` and `action` once each and selects row 1.
12. A 3-item `_List` at row 2: `Enter` fires `change` and `action` once each. `(list as any).handleRowClick(2, { ctrlKey: false, metaKey: false, shiftKey: false })` fires them once more.
13. A 6-item `_List` with `setSelectedIndex(5, false)` and then `setFocusedIndex(4)`: `ArrowDown` moves the focus to 5 and fires no `change`.
14. A 4-item `_MultiSelectList`: `End` fires one `change`. `Shift`+`ArrowDown` then fires none, and `Ctrl`+`ArrowUp` fires none.

**`ComboBox`** (`tests/component/input/ComboBoxDropdownClose.test.ts`)

15. A new case: `new ComboBox()`, `setItems(['a', 'b', 'c'])`, `on('change', …)`, `openDropdown()`. `ArrowDown` twice selects index 2 and fires `change` twice. A third `ArrowDown` fires none and leaves the dropdown open. `Enter` then closes it.

**Tree render pass** (`tests/component/tree/RenderPassEconomy.test.ts`). Fixture, unless a case says otherwise: `makeSettledTree(20, 300, 120)` from `ResizeLayoutEconomy.test.ts`, with `vi.spyOn(tree as any, 'renderWindow')` installed after it settles. Each case calls `mockClear()` on the spy right before the call it measures.

16. `tree.doLayout()` with nothing changed: `renderWindow` is not called, and no sink write is recorded.
17. `setWidth(340)`, then `doLayout()`: `renderWindow` is called once. A second `doLayout()` calls it no more.
18. `setHeight(168)`, then `doLayout()`: `renderWindow` is called once, and more rows are displayed than before.
19. `setPadding(new Insets(4, 4, 4, 4))`, then `doLayout()`, the outer size unchanged: `renderWindow` is called once.
20. Each of these calls `renderWindow` with no `doLayout`, and a `doLayout()` right after it calls `renderWindow` no more: `selectNode(node)`, `setScrollY(48)`, `setNodes(nodes)`, `notifyNodeChanged(node)` for a visible node, `setRendererFactory(() => new LabelTreeNodeRenderer())`, and — on a separately mounted tree of one branch with two children — `expandNode(branch)`.
21. A tree mounted as `Tree.test.ts`'s *rowOverflow* cases mount it — width 100, height 24, one node labelled `'Hello World '.repeat(12).trim()` — has a row wider than 100. `setRowOverflow('clip')` with no `doLayout` caps the row at or below 100; `setRowOverflow('scroll')` widens it again.
22. `rowB` is the pool row bound to the second flat row's node. With `vi.spyOn(rowB.getRenderer(), 'update')`, `(tree as any)._handleClick(makeEvent(rowB.getElement(), 'click', { ctrlKey: true }))` calls `update` with `expect.objectContaining({ node, selected: true })` during the click; a second Ctrl-click calls it with `selected: false`. The `"selection"` event still fires once per click.
23. `new _Tree().doLayout()` before render does not throw and records nothing. After `getElement(true)`, `setWidth(300)`, `setHeight(120)` and `setNodes(…)`, a `doLayout()` does not call `renderWindow`.

**Manual, in the engine** — the orchestrator's A/B in *Verification*. The geometry gate samples the list's and the tree's own rectangles, not their rows; cases 1–23 carry row correctness.[^geometry-blind]

---

## Verification

**Implementer:**

- `npm run typecheck` — 0 errors.
- `npm test` — all green; cases 1–23 are the new coverage.
- `npm run lint` — 0 errors.
- The grep check in step 3.
- `npm run build:lib`.
- `npm run docs:api` — no warning beyond `master`'s 14 pre-existing ones. The bar is "no new warning", not zero.
- `npm run docs:llms:check` — passes. No class summary changes.
- **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/*.sh`, MiniBrowser or the Tauri host.** Each opens a full-screen window.

**Orchestrator — the in-engine A/B, with the user's go-ahead.** Same session, MiniBrowser, `work=1&seam=1&geom=1` on every run. The four W3.0 cells that bounded G24 are each run base, fix, base, fix, base. Two geometry-check cells, the deep and the shallow shell, are run base, fix, base.[^ab-shape]

1. Build the base arm — `runqa.sh`'s `wt` arm — from the SHA recorded in step 1, per [`packages/qa/README.md:87-99`](packages/qa/README.md#L87):

   ```sh
   cd /home/jika/typescript/typescript-ui
   git worktree add .worktrees/_g24-base <base-sha> --detach
   ln -sfn "$PWD/node_modules" .worktrees/_g24-base/node_modules
   (cd .worktrees/_g24-base/packages/lib && npm run build:lib)
   export QA_WT_LIB="$PWD/.worktrees/_g24-base/packages/lib"
   ```

2. Build the fix arm — the `main` arm — with `npm run build:lib` in the implementation worktree.
3. From the implementation worktree, run in this order. Stop at the first non-zero exit and re-run that cell whole.

   ```sh
   F='work=1&seam=1&geom=1'
   LI3="panel=list-items&drive=key&$F"
   LI30="panel=list-items&n=3000&drive=key&$F"
   LI1="panel=list-items&n=1&drive=key&$F"
   TNQ="panel=tree-nodes&drive=passes&$F"
   SDQ="panel=shell-deep&drive=passes&$F"
   SSQ="panel=shell-shallow&drive=passes&$F"
   packages/qa/runqa.sh g24-li3-base-a  wt   "$LI3"
   packages/qa/runqa.sh g24-li3-fix-1   main "$LI3"
   packages/qa/runqa.sh g24-li3-base-b  wt   "$LI3"
   packages/qa/runqa.sh g24-li3-fix-2   main "$LI3"
   packages/qa/runqa.sh g24-li3-base-c  wt   "$LI3"
   packages/qa/runqa.sh g24-li30-base-a wt   "$LI30"
   packages/qa/runqa.sh g24-li30-fix-1  main "$LI30"
   packages/qa/runqa.sh g24-li30-base-b wt   "$LI30"
   packages/qa/runqa.sh g24-li30-fix-2  main "$LI30"
   packages/qa/runqa.sh g24-li30-base-c wt   "$LI30"
   packages/qa/runqa.sh g24-li1-base-a  wt   "$LI1"
   packages/qa/runqa.sh g24-li1-fix-1   main "$LI1"
   packages/qa/runqa.sh g24-li1-base-b  wt   "$LI1"
   packages/qa/runqa.sh g24-li1-fix-2   main "$LI1"
   packages/qa/runqa.sh g24-li1-base-c  wt   "$LI1"
   packages/qa/runqa.sh g24-tnq-base-a  wt   "$TNQ"
   packages/qa/runqa.sh g24-tnq-fix-1   main "$TNQ"
   packages/qa/runqa.sh g24-tnq-base-b  wt   "$TNQ"
   packages/qa/runqa.sh g24-tnq-fix-2   main "$TNQ"
   packages/qa/runqa.sh g24-tnq-base-c  wt   "$TNQ"
   packages/qa/runqa.sh g24-sdq-base-a  wt   "$SDQ"
   packages/qa/runqa.sh g24-sdq-fix-1   main "$SDQ"
   packages/qa/runqa.sh g24-sdq-base-b  wt   "$SDQ"
   packages/qa/runqa.sh g24-ssq-base-a  wt   "$SSQ"
   packages/qa/runqa.sh g24-ssq-fix-1   main "$SSQ"
   packages/qa/runqa.sh g24-ssq-base-b  wt   "$SSQ"
   ```

   26 runs, about seven minutes.
4. Read each cell. The first run listed, `base-a`, is the geometry reference.

   ```sh
   for c in li3 li30 li1; do python3 packages/qa/bin/qa-table.py packages/qa/results g24-$c- --seam; done
   for c in tnq sdq ssq; do python3 packages/qa/bin/qa-table.py packages/qa/results g24-$c- --seam --work; done
   ```

5. Score the four scored cells with W3.0's decision rule ([`w3-0-bounding-sweep.md:114-160`](plans/implemented/w3-0-bounding-sweep.md#L114)), the three `base` runs standing for its plain arms. The bracket is the largest `base` average minus the smallest; Δms is the mean `fix` average minus the mean `base` average; `work` is read on the cell's counter below.

**Expected readings**, per unit. The counts are deterministic, so both `fix` runs must match to the hundredth. The `base` column is W3.0's plain reading on `83cfb0d7`, and the `base` runs must reproduce it unless a plan that landed since changed that count. The `fix` values of `li3`, `li30`, `li1` and `tnq` do not depend on the base; a shell cell's `fix` is its `base` minus 2.00.

| Cell | Counter | `base` | `fix` |
|---|---|---|---|
| `li3` (n=300, key) | sink/u | 604.00 (`apply` 603, `dispatchCustomEvent` 1) | **8.00** (`apply` 7, `dispatchCustomEvent` 1) |
| `li30` (n=3,000, key) | sink/u | 6,004.00 (`apply` 6,003, `dispatchCustomEvent` 1) | **8.00** |
| `li1` (n=1, key) | sink/u | 3.00 (`apply` 2, `dispatchCustomEvent` 1) | **0.00** |
| `tnq` (passes) | work/u | 288.00 (`setStyleState@TreeRow` 186, `getPreferredSize@Text` 90, the scrollbars' min/max hints 10, `doLayout@Tree` 1, `getLaidOutComponents@Tree` 1) | **2.00** (`doLayout@Tree` 1, `getLaidOutComponents@Tree` 1) |
| `tnq` (passes) | sink/u | 1.00 | 0.00 |
| `sdq` (shell-deep passes, check) | `seam.sink.apply` | 361.00 | 359.00; `doLayout@Tree` 2.00 in both arms |
| `ssq` (shell-shallow passes, check) | `seam.sink.apply` | 268.00 | 266.00; `doLayout@Tree` 2.00 in both arms |

- **Sources.** The list cells read 3.00 source calls in both arms (`intern`, `getId` and `getScrollMetrics`, 1.00 each).
- **Shells.** In `sdq` and `ssq`, work/u also falls by at least 20.00: the two trees' scrollbar hints, 10 per tree as in `tnq`.[^shell-delta]
- **Geometry.** `=` in every run of every cell, on every label.
- **Verdict.** `work` is `win` in all four scored cells. Frame time is not predicted: the list cells are vsync-bound (W3.0 read them flat), and `tnq` read −0.10 ms against a 0.04 bracket. A `regress`, a geometry `DIFF`, or a count off this table stops the merge and returns to this plan.
- **Record.** Append the readings to the `list-items` and `tree-nodes` rows' *Validated* cells in `packages/qa/README.md`, as the W3.0 baseline lines there are written; the shell check goes in the `tree-nodes` line.
- **Clean up.** `git worktree remove .worktrees/_g24-base`.

---

## Documentation Impact

**TSDoc** (steps 3, 5, 7): `SelectableListRow` class doc and its three setters (internal); `AbstractSelectableList.moveFocus` (protected); `Tree.doLayout` remarks and `Tree.setRowOverflow` (public); `selectionsEqual` (internal). No `{@link}` to a private member from public JSDoc. Nothing new is exported.

**Doc pages**

- [`docs/components/List.md`](packages/lib/docs/components/List.md#L42), after the Keyboard table: "A navigation key that leaves the selection where it was — `ArrowDown` on the last row, `Home` on the first — fires no `change`. `Enter`, `Space` and a click fire it even on the row already selected, since a host such as [`ComboBox`](/components/ComboBox) treats them as the user's pick."
- [`docs/components/MultiSelectList.md`](packages/lib/docs/components/MultiSelectList.md#L40), after the Selection model table's disabled-row sentence: "A navigation key that leaves the selection as it was — `Shift`-`ArrowDown` on the last row, say — fires no `change`."
- [`docs/components/Tree.md`](packages/lib/docs/components/Tree.md#L104), after the *Updating nodes* table: "The tree repaints its rows when one of these methods, a gesture, a scroll or a change to the tree's own size asks it to. A layout pass that leaves the tree's size as it was repaints nothing, so a node changed in place stays as drawn until `notifyNodeChanged(node)`."

**Changelog** — [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md):

- *Changed › Components*: **Moving the selection in a `List` or `MultiSelectList` writes only to the rows whose state changed.** A row toggles its `selected`, `focused` and `disabled` class tokens one at a time instead of rewriting its whole `class` attribute, and skips a state it already shows: one arrow key on a 300-item list went from 603 attribute writes to 7. No consumer action is needed.
- *Changed › Components*: **A navigation key that leaves a `List` or `MultiSelectList` selection as it was no longer fires `change` or `action`** — an `ArrowDown` on the last row, a `Home` on the first, a `Shift`-`ArrowDown` that extends nothing. A click, `Enter` or `Space` on the row already selected still fires, since [`ComboBox`](/components/ComboBox) and [`AutoCompleteField`](/components/AutoCompleteField) treat those as the user's pick; an open `ComboBox` no longer fires its own `change` for an arrow key at either end of its list. `Tree` and the table body already stayed silent for an unchanged selection. A listener that used the repeat as a key signal needs a `keydown` listener instead.
- *Changed › Components*: **A layout pass that leaves a `Tree`'s size unchanged no longer re-renders its rows.** It re-renders when the tree's size, padding or border changed since its last render; every change the tree makes itself — expanding, selecting, scrolling, `setNodes`, `notifyNodeChanged`, a theme change — still renders at once. A node changed in place must be announced with `notifyNodeChanged(node)`, as documented: an unrelated layout pass used to pick such a change up by accident and no longer does.
- *Fixed › Components*: **`Tree.setRowOverflow()` takes effect at once, and a Ctrl-click (Cmd-click) rebinds the row it toggles.** `setRowOverflow` stored the new mode and waited for an unrelated layout pass to apply it. A Ctrl-click repainted the row's highlight but left its renderer's `selected` context stale until the next render; a custom `TreeNodeRenderer` that reads `selected` now sees the change at once. No consumer action is needed.

No migration note: no signature changes, and the 0.3.0 entry for the same change in `Tree` and the table body ([`0.3.0.md:50`](packages/lib/docs/reference/changelog/0.3.0.md#L50)) carried none.

**QA record** — the orchestrator's *Validated* lines, *Verification* above. The `list-items` and `tree-nodes` descriptions keep naming the findings they were built to reproduce.

---

## Potential Challenges

- **A render the `doLayout` box check swallows.** Geometry cannot see it. Cases 16–23 pin every path in *Addendum: Render Entry Points*; any new state a future change adds to `renderWindow` must render through the call that changes it.
- **Tests reading the whole `class` attribute.** Only `RowFrameworkClass.test.ts` does; a full-suite run of a runtime prototype of this plan failed nowhere else.
- **A settle relay leaking between tree tests.** `Component.afterNextLayout` keeps one module-level frame; copy `ResizeLayoutEconomy.test.ts`'s capture and drain it in `afterEach`, or a later test's settle never fires.
- **Tempting to diff `refreshRowVisualState`.** Keep the loop; the rows' guards already skip every unchanged row.
- **Tempting to declare the row states in `ownStyleStates`.** Don't: it would add class-tier rules and `#id:not(…)` guards next to the existing hand-written ones.
- **`setStyleState` advances the size-hint generation on each real toggle** (four per key). No layout pass runs inside a key handler, so nothing re-measures because of it.

---

## Critical Files

- `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — `SelectableListRow` (`:318-722`), `syncRows` / `refreshRowVisualState` (`:1693-1759`), `handleRowClick` (`:1804`), `moveFocus` / `commitFocusedRow` (`:2160-2210`).
- `packages/lib/src/typescript/lib/component/tree/Tree.ts` — `_notifySelectionChange` / `_selectAtIndex` (`:1668-1716`), the precedent; `_handleClick` (`:1866`), `_updateSelectionStyle` (`:2006`), `renderWindow` (`:2074`), `doLayout` (`:2277`).
- `packages/lib/src/typescript/lib/component/tree/TreeRow.ts:49-100` — the pooled-row `setStyleState` precedent (read only; not edited).
- `packages/lib/src/typescript/lib/core/Component.ts:6686-6716` and `:8154-8177` — `setStyleState`, and the render-time token catch-up.
- `packages/lib/src/typescript/lib/core/Panel.ts:650-672` and `component/diagram/DiagramView.ts:1760-1785` — the size-change precedents.
- `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` — `onScrollerTick`, the resize settle relay, `onThemeReflow`.
- `packages/lib/src/typescript/lib/component/input/ComboBox.ts:200-230`, `:1066-1087` and `component/input/AutoCompleteDropdown.ts:116-135` — why clicks and `Enter` keep firing.
- `packages/lib/tests/component/tree/ResizeLayoutEconomy.test.ts` — the frame capture to copy.
- `packages/qa/src/harness/ablations.ts:1992-2047` — the two ablations.
- `packages/qa/README.md:87-99` and `plans/implemented/w3-0-bounding-sweep.md` *The decision rule* — the A/B recipe and scoring.

---

## Non-Goals

- **Opting `Tree` or `SelectableListRow` into `canSkipUnchangedLayout`.** With this plan, an unchanged `Tree.doLayout` does only the base pass, which makes `Tree` a candidate for G09's staged opt-in audit (`unchanged-commit-opt-ins`); the audit decides.
- **`aria-activedescendant` on a Ctrl-click in `Tree`.** Found while planning: the Ctrl-click branch moves the focus node but never calls `_updateActiveDescendant`, unlike every other selection path. Pre-existing and separate from render economy.
- **`Tree.md`'s `collapseAll()`.** The *Common methods* table lists a method `Tree` does not have (slice 18 F18.11). Pre-existing.

---

## Addendum: Render Entry Points

Every input `renderWindow` reads, what changes it, and what renders afterwards. Only the box reaches the tree through `doLayout`; the last two rows are the paths this plan makes render.

| Input | Changed by | Renders through |
|---|---|---|
| `_flatRows`, `_maxContentWidth` | `_flatten` | `setNodes` ([`:386-388`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L386), or `init` when not yet rendered); `_reflattenAndRender` ([`:1132`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1132)) from `expandAll`, `_expandPathTo`, `_commitStructureChange` (insert / remove / `setChildren`), `_expand`, `_collapse`, `_loadAndExpand`, both load settles |
| `_expandedNodes`, `_loadingNodes` | the same paths | the same `_reflattenAndRender` |
| `_selectedNodes`, `_focusNode` | `selectNode`, `_selectAtIndex`, `_extendSelectionTo`, `_pruneDetachedState` | `renderWindow` at `:633`, `:1713`, `:1739`; `_reflattenAndRender` |
| `_boundIndices` sentinel | `setNodes`, `notifyNodeChanged`, `setRendererFactory`, `onThemeReflow` | `renderWindow` at `:388`, `:520`, `:1060`; `VirtualRowView.onThemeReflow` ([`VirtualRowView.ts:606-610`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L606)) |
| scroll offset | the scroller, `setScrollY`, `scrollRowIntoView` | `onScrollerTick` ([`VirtualRowView.ts:124`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L124)) |
| owed child layout after a resize burst | the settle relay | `flushResizeSettle` ([`VirtualRowView.ts:572-589`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L572)) |
| outer height, content box | the parent's layout; `setPadding`, `setBorder` | **`doLayout`, gated on `_renderedBox`** |
| `getRowOverflow()` | `setRowOverflow` | **`setRowOverflow` itself** (new) |
| `_selectedNodes` via Ctrl-click | `_handleClick` | **`_handleClick` itself** (new) |

Node content changed in place (`label`, `data`, `hasChildren`) is announced with `notifyNodeChanged`, per `Tree.md`'s *Updating nodes*.

## Addendum: Offline Evidence

A runtime prototype of this plan — the three row setters, the constructor seed, `moveFocus`, the `doLayout` gate, `setRowOverflow` and the Ctrl-click line, patched onto the prototypes in a throwaway probe — gave:

| Probe | Today | Prototype |
|---|---|---|
| one arrow key, n=300 | 603 `apply` + 1 dispatch | 7 `apply` + 1 dispatch (case 1's table, write for write) |
| one arrow key, n=3,000 | 6,003 + 1 | 7 + 1 |
| one arrow key, n=1 | 2 + 1 | 0 + 0 |
| 10 unchanged `Tree.doLayout()`, 28 visible rows | 10 `apply` | 0 |
| an open `ComboBox`, `ArrowDown` at the last item | one combo `change` | none; `ArrowUp` and `Enter` as before |
| Ctrl-click, custom renderer | no `update` call | `update` with `selected: true` |

The offline counts equal W3.0's engine counts for the same cells. With the prototype applied under the library's full suite (8,038 tests), the only failures were the two `setAttr.class` cases in `RowFrameworkClass.test.ts`, which case 9 rewrites, and two failures that are the probe's own set-up or fail without it.

---

## Notes

[^out-f18-3]: F18.3 batches the tree renderers' text measurement into one `measureTexts` call. Its saving is the forced layout each separate measurement costs, and G18 (`text-measurement-without-reflow`) replaces that forced layout with a canvas width, after which batching saves little; the synthesis already made G24 depend on G18 for this item alone. It also needs a bind/measure split in `_bindAndMeasure` and edits to both tree renderers' `update`, next to `glyph-name-setter`'s icon edits in `IconLabel.ts`. No W3.0 cell bounded it. Re-measure it once G18 lands.

[^out-f18-5]: F18.5(2) is `AbstractMarkerList` renumbering every item on each append — construction and data-refresh cost in bulleted and numbered lists, which no QA panel mounts. F18.5(1), the `Text.setText` same-value guard, has landed ([`Text.ts:837`](packages/lib/src/typescript/lib/component/input/Text.ts#L837)), so each redundant renumber is now a guarded call, not a DOM write.

[^out-f18-10]: Under `rowOverflow: "clip"`, `_bindAndMeasure` still folds each visible row's cached content width into a maximum nobody reads. No panel uses clip mode, and after this plan an unchanged pass no longer reaches `_bindAndMeasure` at all; on a real render the waste is one comparison per visible row.

[^out-f16-2]: On an open `ComboBox`, one arrow key ran two row refreshes: the list's own, and a second when `ComboBox.setSelectedIndex` re-commits the same index into the list (F16.2(a)). This plan's row guards make the second refresh write nothing, since every row already holds its state, so F16.2(a) would now remove only N guarded calls. Skipping the re-commit also skips resetting the list's anchor and focus to that index, a behaviour change no panel could check. F16.2(b), the row guard, is this plan's list half.

[^out-f18-6b]: `_selectAtIndex`, `_extendSelectionTo` and `selectNode` sweep the pool's selection style themselves and then again inside `renderWindow`. Both sweeps are `setStyleState` and `Aria` calls that write nothing when unchanged. No W3.0 cell measures a tree selection change, and narrowing the in-render sweep to rebound slots would make `.focused` depend on every focus change sweeping by hand.

[^out-f18-2]: `list-items · passes` reads 908 sink writes per unchanged pass, because every list row and renderer is laid out on every pass. Slice 18's cheap option — an unchanged-rectangle guard in `SelectableListRow.doLayout`, or a `canSkipUnchangedLayout` opt-in — is layout-commit work of G09's kind, and no W3.0 cell bounded it for G24. Virtualising the list is a separate, larger plan.

[^out-scroll-read]: `scrollIndexIntoView` reads the panel's scroll metrics after the row writes, which can force a style recalculation. After this plan the read follows six class and ARIA writes instead of 603, none of which moves geometry, and the W3.0 arm with the same order read frame time flat. Moving the read ahead of the writes would reorder a scroll write before the class writes for no measured gain.

[^token-precedent]: `setStyleState` returns early on an unchanged state and writes a single `addClass` or `removeClass` token ([`Component.ts:6686-6706`](packages/lib/src/typescript/lib/core/Component.ts#L6686)); `Tree._updateSelectionStyle` drives `TreeRow`'s `.selected` and `.focused` through it on pooled rows that are rebound to different nodes. The row's cached `_selected` / `_focused` / `_enabled` fields are written only by these setters, together with the token and the ARIA attribute, so the cache always equals what the row shows — which is what makes the guard safe on a row reused for a different item by `syncRows`. The alternative, keeping `applyRowClass` behind the guards exactly as the ablation did, leaves the whole-attribute rewrite that would drop a framework-owned token such as `.invisible` (F18.12) and writes a longer attribute per change.

[^no-declared-state]: A state declared in `ownStyleStates` gets a generated class-tier rule and a resting-tier `#id:not(…)` guard, which would sit beside the hand-written `.SelectableListRow.selected` / `.focused` / `.disabled` rules whose registration order `RowFrameworkClass.test.ts` pins (hover, then selected, then disabled). Toggling an undeclared state only adds or removes its token — how `TreeRow`'s `.focused` works — and the existing rules match the token.

[^aria-seed]: Today every row gets `aria-selected="false"` from its first `setSelected(false)` in `syncRows`, because `Aria` has no value yet. With the guard, that first call returns early (the field already reads `false`), so without the seed an unselected row would carry no `aria-selected` at all. The ablation did not face this: it was installed after mount, when every row already had the attribute.

[^loop-kept]: The list is not virtualised, so the row pool is the item array; a refresh that touched only the old and new rows would need a second record of what each row shows, which the rows' own fields already are. What the loop still costs is two boolean comparisons per row per key, with no DOM access.

[^nav-only]: Slice 18 proposed silencing clicks and `Enter` / `Space` too, as `Tree` and the table body do. For a list those are activations: `ComboBoxDropdown` closes on the list's `action` after a click or `Enter` ([`ComboBox.ts:226`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L226), `:1081-1087`), and `AutoCompleteDropdown` commits the suggestion from it ([`AutoCompleteDropdown.ts:129-135`](packages/lib/src/typescript/lib/component/input/AutoCompleteDropdown.ts#L129)). A click or `Enter` on the row already selected must still close the combo — `ComboBoxDropdownClose.test.ts` pins `Enter`. A navigation key is not an activation, and it was the only no-op W3.0 measured.

[^keep-scroll]: `Tree` still scrolls the focused row into view on a clamped key (`_selectAtIndex` runs its whole path and only the event is suppressed); a list scrolled away with the wheel brings its focused row back the same way. With the row guards the repaint writes nothing, and `Aria` drops an unchanged `aria-activedescendant`, so returning early would save only the one scroll-metrics read.

[^snapshot-cost]: The copy is made only when the key commits, and costs the size of the selection. The reducer (`reduceModifierSelection`) and the disabled-row filter in `MultiSelectList.reduceSelection` already walk the selection or the range on every such key, so the copy adds no new order of cost.

[^gate-seam]: The synthesis proposed a signature of every input inside `renderWindow`. `renderWindow` reads about a dozen inputs and has seventeen callers; a signature that missed one would silently skip a render, the class of bug where a wrong memo key once passed every test. Every caller except `doLayout` already calls it because it changed something, so only `doLayout` needs to learn whether anything changed, and a layout pass can change only the box. Opting `Tree` into `canSkipUnchangedLayout` instead would not reach a direct `doLayout()` call — which is how the `passes` driver and any consumer relayout reach it — and belongs to G09's audit.

[^box-key]: `renderWindow` reads the tree's outer height (the row window's size), and `getContentBounds()` inside `VirtualScroller` (the viewport width, the scrollbars and the clip box). The content box moves with the size, the border and the padding. A border measured before the element connects is an estimate that is replaced on connection, so the recorded box also catches that. The outer width is read only through the content box.

[^two-leaks]: Both relied on an unrelated `doLayout` to finish their work. `setRowOverflow` wrote the mode and waited; a runtime switch would otherwise never apply until the tree was resized. The Ctrl-click branch updated the highlight and `aria-selected` but not the rows' bound `selected` flag, so a renderer reading `selected` saw the old value until the next render — which, with the gate, might never come. A probe confirmed both before and after.

[^in-place]: An in-place change to `hasChildren` made `TreeRow.isBoundTo` report a different binding on the next render, so any layout pass used to rebind the row by accident. `Tree.md`'s *Updating nodes* has always required `notifyNodeChanged` for exactly this; the changelog entry names it, as the `MenuBar` / `ToolBar` opt-in entry in the same file names the equivalent for bars.

[^land-order]: The order is a preference, not a dependency, so `depends-on` does not name `glyph-name-setter`. It was drafted first, and neither plan's A/B cells move under the other: an unchanged tree pass and a list arrow key rebind no glyph, and a tree toggle's glyph census is untouched by the `doLayout` gate. Keeping this plan's tree tests out of `Tree.test.ts` leaves the changelog and the QA README as the only files both edit, and both only append.

[^geometry-blind]: The `list-items` and `tree-nodes` panels label only the list and the tree themselves, and the shells label the sidebar's `files`, `outline` and `history`; no label is a row. A swallowed render or a wrong class token would leave every label where it was. Row state is therefore carried by cases 1–23 and by the exact per-unit counts, which would move on any extra or missing write. The shell cells supply what the lesson asks for: geometry equality in a deep and a shallow panel, both of which mount two `Tree`s and a `List`.

[^ab-shape]: `qa-ab.py` scores an arm only when its name is its run's `abl=` parameter, and judges engagement from the arm's own `skipped.` / `memo.` / `dose.` counters, which a library build has neither of. So this A/B uses the `wt` / `main` pair that `glyph-name-setter` and `same-value-style-write-filter` use, read with `qa-table.py`, whose geometry column compares every run with the first listed. Three base runs around two fix runs give the bracket three samples and cancel a linear drift across the cell, as W3.0's mirrored order did; the shell cells only gate geometry and counts, so W3.0's check-cell shape suffices.

[^shell-delta]: On an unchanged pass a tree's only DOM write is `VirtualScroller.layoutScrollbars`' clip-box patch — `tnq` reads exactly 1.00 — and its only counted calls beyond its own `doLayout` are the scrollbar hints and one label size read per visible row. Both shell trees are rendered and laid out on every pass (`doLayout@Tree` 2.00, `files` and `history` sized 270 × 1,773 and 270 × 480 in W3.0's `sdq`), so each pass loses two clip-box writes and at least twenty hint calls. The row-label reads depend on how many rows each tree shows, so they are not predicted.

---

## Implementation Notes

**Base commit (step 1).** `9cd902a15595171cb0b0dd6badc7f44e9ff82c52` — the tip
of `feature/glyph-name-setter`, which this branch starts from as *Land after
`glyph-name-setter`* asks. That is the SHA the A/B's `wt` arm is built from.

**The in-engine A/B has not been run.** Every cell in *Verification* opens a
full-screen MiniBrowser window, which the implementation run is not permitted
to do, so the whole orchestrator block is still owed. It is to be run in one
session, from this worktree, with the base arm built as:

```sh
cd /home/jika/typescript/typescript-ui
git worktree add .worktrees/_g24-base 9cd902a15595171cb0b0dd6badc7f44e9ff82c52 --detach
ln -sfn "$PWD/node_modules" .worktrees/_g24-base/node_modules
(cd .worktrees/_g24-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g24-base/packages/lib"
```

and then the 26 `packages/qa/runqa.sh` runs, the two `qa-table.py` reads, the
scoring and the *Validated* lines in `packages/qa/README.md` exactly as
*Verification* steps 2-5 list them. Until that runs, the saving is carried by
the offline counts alone: case 1 records the plan's 7 `apply` + 1 dispatch at
n=300 and case 2 the same at n=3,000, against the 604 writes the same fixture
recorded before the change — which is W3.0's `li3` plain reading, write for
write.

**Every other *Verification* item passed.** `npm run typecheck` 0 errors;
`npm test` 8,342 passed across 501 files; `npm run lint` 0 errors; step 3's
grep finds no `applyRowClass` / `COMPONENT_CLASS` / `setElementAttribute("class"`
left in `AbstractSelectableList.ts`; `npm run build:lib` clean;
`npm run docs:api` "Found 0 errors and 14 warnings", the pre-existing count;
`npm run docs:llms:check` "Coverage OK ... 0 unaccounted for". The red/green
pattern the plan predicted held exactly: cases 1-4, 6 and 8 failed before the
row change, 10, 13, 14 and 15 before `moveFocus`, and 16, 17 and 20-23 before
the `Tree` change — no other case failed at any point.

**Deviation: the new test files dispose their fixtures.** `Event`'s
window-level base-listener bookkeeping is module state that survives
`DOM.reset()`, so a list or combo left alive keeps `"change"` marked installed
against the previous case's window handle and silently kills the *next* case's
DOM-routed dispatch — the gotcha `ComboBoxDropdownClose.test.ts`'s own file
header documents, which only bites once a file holds more than one such case.
`Component.destructor` calls `Event.purgeComponent`, so disposing the fixture
in `afterEach` clears it. `RowStateEconomy.test.ts` therefore tracks and
disposes every list it mounts (cases 11, 12, 14 and 15 fail without it), and
case 15 adds the same disposal to `ComboBoxDropdownClose.test.ts`'s existing
case, which the plan described as an untouched file gaining one new case.
`RenderPassEconomy.test.ts` inherits the disposal from the frame capture it
copies.

**Detail: the dispatch row of case 1's table is asserted by type, not target.**
The recording sink records `dispatchCustomEvent` as `('dispatchEvent', type)` —
the event type only, with no target handle (`TestDOM.ts`'s `dispatchEvent`), so
the table's "list root" column for write 8 has nothing to compare against. The
assertion pins the op and the `change` type in its exact position in the write
order, which is what the row carries.
