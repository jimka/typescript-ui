# Test Coverage for the List and Tree Component Subsystems — Implementation Plan

## Overview

This plan adds Vitest coverage for the `list/` and `tree/` component subsystems under
[`src/typescript/lib/component/list/`](../src/typescript/lib/component/list/) and
[`src/typescript/lib/component/tree/`](../src/typescript/lib/component/tree/). Both are DOM-backed stateful
components, unlike the pure-logic units already covered under `tests/unit/`. The tests live alongside the
existing component suites in `tests/component/`, mirroring the `// @vitest-environment jsdom` + `~/...` import
convention used by [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) and the merged
layout suites under [`tests/component/layout/`](../tests/component/layout/).

The central insight that shapes scope: **the high-value selection / item-management logic is observable through
public getters without ever rendering to a real DOM.** `List` / `MultiSelectList` populate `_items`, the
selection `Set<number>`, and the anchor / focus indices entirely inside `setItems` / `setValue` / `setValues` /
`setSelectedIndex`, all reachable through `getValue()`, `getItems()`, `getSelectedIndex()`,
`getFocusedIndex()`. Construction does **not** require a browser — rows are `Component`s whose `getElement()`
returns `undefined` until rendered, and every selection setter guards its DOM writes behind a
`this.getElement()` / pool-presence check. This is why the bulk of the plan targets the list selection model
and item bookkeeping, and treats full row/icon rendering as a low-priority non-goal.

The tree is the harder case: its selection and expand/collapse state (`_expandedNodes`, `_selectedNodes`,
`_anchorNode`, `_focusNode`, `_flatRows`) is mutated almost entirely from **private** handlers (`_onToggle`,
`_handleClick`, `_onKeyDown`, `_flatten`), and the public commit paths (`setNodes`, keyboard, click) only take
effect once `getElement()` exists and a `VirtualScroller` is wired in `init()`. The plan grounds the tree tests
in the narrow set of behaviours that *are* publicly observable after `setNodes` — selection getters returning
`null` / `[]`, node identity preservation, the renderer-factory contract — plus the genuinely pure
`TreeNodeRenderContext` shape, and honestly scopes the private expand/collapse and keyboard reducers out (they
need either the heavy render harness or `@ts-expect-error` private pokes, both flagged as non-goals).

---

## Architecture Decisions

### Test the selection model through the public contract, not the protected reducer

`reduceSelection` (single-select in [`List.ts:135`](../src/typescript/lib/component/list/List.ts#L135),
multi-select in [`MultiSelectList.ts:199`](../src/typescript/lib/component/list/MultiSelectList.ts#L199)) is
`protected` and only fires from `handleRowClick` / the keyboard reducer, both of which require a rendered
element. Rather than synthesise click events through the offline DOM seam (which cannot deliver real
`MouseEvent`s — `RecordingDOMSink.dispatchEvent` only records the type), the plan exercises the **same
selection arithmetic** through the public surface that bypasses the element guard:

- Single-select semantics → `setSelectedIndex(idx)` and `setValue(key)`, asserting `getValue()` /
  `getSelectedIndex()`.
- Multi-select set semantics (replace / union / clear) → `setValues([...])`, `getSelectedRecords()`,
  `setSelectedRecords(...)`, asserting `getValue()` (sorted-by-row keys) and the anchor parked at
  `Math.max(...selected)`.

For the **modifier-key reducer paths** (ctrl-toggle, shift-range-extend, the shift-across-a-gap fill) that have
no public entry point, the plan uses a minimal in-test subclass that widens `reduceSelection` to public — a
white-box seam local to the test file, not a production change. This keeps the verbatim
`Body.onRowClick`-ported branch logic under test (the `lo..hi` inclusive fill, the `!ev.ctrl` clear, the anchor
move on ctrl) without faking DOM events.

### Drive the type-ahead clock deterministically

`handleTypeAhead` ([`AbstractCustomList.ts:1325`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1325))
times its 700ms buffer reset off `Date.now()`. Tests that assert the buffer-accumulation vs. reset boundary use
Vitest's `vi.useFakeTimers()` + `vi.setSystemTime(...)` (or `vi.spyOn(Date, 'now')`) so the
`TYPE_AHEAD_TIMEOUT_MS` window is exercised at its exact edge rather than racing wall-clock. `handleTypeAhead`
is `protected`; reach it through the same test-local subclass widening, or through the public `handleKey(e)`
entry point with a synthetic `{ key, ctrlKey: false, altKey: false }` `KeyboardEvent`-shaped object — `handleKey`
*is* public and routes printable single chars to the buffer, and it only requires `_items.length > 0`, not a
rendered element.

### Tree tests assert the public post-`setNodes` contract; private reducers are out of scope

`setNodes` ([`Tree.ts:129`](../src/typescript/lib/component/tree/Tree.ts#L129)) clears every selection/expansion
set and stores the node array verbatim — both observable through `getNodes()`, `getSelectedNode()` (→ `null`),
`getSelectedNodes()` (→ `[]`). The renderer-factory swap (`setRendererFactory` / `getRendererFactory`,
[`Tree.ts:254`](../src/typescript/lib/component/tree/Tree.ts#L254)) is observable without rendering. These form
the tree's testable public surface offline. The private `_flatten` / `_isExpandable` / `_onToggle` /
`_rangeSelect` / `_onKeyDown` logic — the genuinely interesting expand/collapse and range arithmetic — is
**not** reachable without either (a) a rendered element + live `VirtualScroller` to deliver the subtree-click /
keydown listeners wired in `init()`, or (b) `@ts-expect-error`-style private member pokes. Option (a) is a
heavy integration harness this plan declines; option (b) couples tests to private names. The plan therefore
covers the private flatten/expand logic **only** through a single documented white-box block that calls
`_flatten` / `_onToggle` via a typed `as unknown as { ... }` cast, clearly fenced and commented as
private-surface testing, and otherwise scopes it to non-goals. `TreeNode` is an interface (no class methods to
test); its parent/child/depth semantics are an emergent property of `_flatten`, covered in that fenced block.

### Assert contract-derived expected behaviour, never current output — surface divergence with `it.fails`

Per the project test methodology: every assertion encodes what the JSDoc / inline contract *says* should
happen, computed independently of running the code. Where the implementation is observed to diverge from its
stated contract, the test is **not** rewritten to match the code. Instead it is left asserting the correct
(contract-derived) expectation and marked `it.fails(...)` with a comment naming the suspected bug and the
file:line, so the divergence is visible in the suite rather than silently conformed to. Candidate divergences
to probe (each must be confirmed against the source during implementation, not assumed):

- `MultiSelectList.getValue()` ordering after a `setValues` whose keys arrive out of row order — the contract
  says "sorted by row order" ([`MultiSelectList.ts:127`](../src/typescript/lib/component/list/MultiSelectList.ts#L127));
  verify the sort is by index, not by key string.
- `AbstractCustomList.getSelectedIndex()` anchor-fallback: after `setValues(["2","0"])` the anchor parks at the
  **max** index (2), but `getSelectedIndex` returns the anchor when it is in the set — confirm it returns 2, not
  the `Math.min` fallback ([`AbstractCustomList.ts:771`](../src/typescript/lib/component/list/AbstractCustomList.ts#L771)).
- `List.getValue()` on an empty/cleared selection returns `""` not `undefined`
  ([`List.ts:117`](../src/typescript/lib/component/list/List.ts#L117)).
- `setItems` auto-key collision: a string appended after an explicit-keyed item index-keys by position and can
  duplicate an earlier explicit key; `setValue` resolves to the first match
  ([`AbstractCustomList.ts:608`](../src/typescript/lib/component/list/AbstractCustomList.ts#L608) remarks).

### No golden DOM snapshots — assert structural and relational invariants

No test compares serialized DOM, pixel geometry, or class-string output. Assertions are over: selected-index
sets, the sorted key array `getValue()` returns, the anchor/focus indices, item count and key/label pairs from
`getItems()`, ARIA-role/multiselectable wiring (asserted via the recorded sink writes only where it is the unit
under test), and — for the numbered/bulleted lists — the `list-style-type` value passed to the style setter,
not its rendered marker glyphs.

---

## Test Targets and Per-Target Behaviour

### Priority 1 — `MultiSelectList` selection model (`tests/component/list/MultiSelectList.test.ts`)

The richest near-pure logic. Construct without rendering; assert through `getValue()` / `getSelectedRecords()`.

- **Construction + `selectedIndices` option**: `new MultiSelectList({ items: [...], selectedIndices: [1,3] })`
  → `getValue()` returns the keys at rows 1 and 3; out-of-range indices in the option array are silently
  dropped ([`MultiSelectList.ts:290`](../src/typescript/lib/component/list/MultiSelectList.ts#L290) bounds
  guard); anchor parks at `Math.max` of the applied set.
- **`setValues` replace semantics**: clears the prior set, selects exactly the rows whose key is in `values`;
  `getValue()` returns them sorted by row index; anchor → max selected index, or `null` when `values` selects
  nothing.
- **`setValues([])` clears**: empty selection, anchor `null`, `getValue()` → `[]`.
- **`reduceSelection` plain** (via test-local subclass widening): replaces selection with `{idx}`, anchor and
  focus collapse to `idx`.
- **`reduceSelection` ctrl-toggle**: toggles membership of `idx`; an already-selected `idx` is removed; anchor
  moves to `idx` either way.
- **`reduceSelection` shift-range with anchor set**: fills `[min(anchor,idx) .. max(anchor,idx)]` inclusive;
  without ctrl it clears first (pure range), with ctrl it unions onto the existing set. **Shift across a gap**
  (anchor 1, shift-click 4 with rows 0..5) selects exactly {1,2,3,4} — assert the inclusive fill and that 0/5
  stay unselected.
- **shift with no anchor** (`_anchorIndex === null`): falls through to the plain branch (single select), per
  the `ev.shift && this._anchorIndex !== null` guard.
- **`selectAll` / Ctrl+A**: selects every row, anchor 0, focus last index; no-op on an empty list
  ([`MultiSelectList.ts:263`](../src/typescript/lib/component/list/MultiSelectList.ts#L263)). Exercise via the
  public `handleKeyDown` path is blocked by the element guard; reach `selectAll` through the test-local
  subclass.
- **`getSelectedRecords` / `setSelectedRecords`**: with a store bound, assert the round-trip selects the rows
  whose backing records match, relying on the parallel `_items` / `store.getRecords()` ordering. Use a
  `MemoryStore` constructed with inline `data` (its constructor calls `proxy.setData` synchronously — no
  `load()` await needed for a pre-seeded store, but `setStore` calls `refreshFromStore` immediately so `_items`
  is populated at bind time).
- **`getValue` / `setValue` Bindable alias**: `setValue` delegates to `setValues`; assert identical behaviour.

### Priority 1 — `List` single-selection model (`tests/component/list/List.test.ts`)

- **`setItems` auto-keying**: a string array yields `{key: String(i), label}`; assert `getItems()` pairs.
- **`setItemsArray` keeps explicit keys** verbatim (no index clobber).
- **`addItem`** appends with `key: String(length-at-append)`; assert key + ordering, and the documented
  collision case when appending after explicit-keyed items.
- **`setValue(key)`**: selects the first row whose `key` matches; unknown key is a no-op leaving selection
  unchanged (mirrors native `<select>` — assert via `setValue("nope")` after a known selection).
- **`getValue()` empty**: returns `""` when nothing selected or index out of range.
- **`setSelectedIndex(idx, false)`**: sets the single anchor, focus follows, no `change` fired; negative /
  out-of-range clears to anchor `null`, focus `-1` ([`AbstractCustomList.ts:798`](../src/typescript/lib/component/list/AbstractCustomList.ts#L798)).
- **`reduceSelection` ignores modifiers** (single-select): ctrl/shift produce the same `{idx}` result as plain
  (via test-local subclass).
- **Construction option dispatch order**: `new List({ items, selectedIndex })` selects the row at construction
  (the constructor tail dispatches `selectedIndex` after `super()` builds the pool,
  [`List.ts:44`](../src/typescript/lib/component/list/List.ts#L44)); `value` / `selectedItem` options resolve
  by key.

### Priority 2 — `AbstractCustomList` shared logic (folded into the List suite or a dedicated file)

Tested through `List` as the concrete vehicle (the abstract class is never instantiated):

- **`setItems` reset invariant**: replacing items clears selection / anchor / focus
  ([`AbstractCustomList.ts:646`](../src/typescript/lib/component/list/AbstractCustomList.ts#L646)).
- **`getItems()` returns a copy** — mutating the returned array does not affect the list.
- **`getFocusedIndex()` default** is `-1` before any navigation.
- **Type-ahead** (deterministic clock, via `handleKey` or subclass): within the 700ms window successive keys
  accumulate (`"b"` then `"a"` → prefix `"ba"`), jumping focus to the first label starting with the prefix;
  after the timeout the buffer resets so a lone later key searches fresh. Assert `getFocusedIndex()` only —
  type-ahead never mutates selection.
- **`setStore` rebind**: binding to a new store de-registers the prior handlers (assert no double-refresh by
  swapping stores and checking item count reflects only the new store).
- **`refreshFromStore` selection survival**: a store reload that keeps the selected key re-selects it; a reload
  that drops the key clears selection and parks focus at row 0
  ([`AbstractCustomList.ts:891`](../src/typescript/lib/component/list/AbstractCustomList.ts#L891)).

### Priority 2 — Bulleted / Numbered lists + item styles (`tests/component/list/MarkedList.test.ts`)

`AbstractListComponent` delegates selection to the **native** seam (`DOM.sink.setSelectedIndex` /
`DOM.source.getSelectedIndex`), which the offline source stubs to `-1` — so selection getters are *not*
meaningfully testable offline here. Scope this file to the style/marker contract and child-type restriction:

- **`BulletedList` defaults** to `BulletedListItemStyle.DISC`, renders a `<ul>`; `NumberedList` defaults to
  `NumberedListItemStyle.DECIMAL`, renders an `<ol>` (assert via the tag passed to the constructor / the
  `getStyle()` getter, [`AbstractListComponent.ts:79`](../src/typescript/lib/component/list/AbstractListComponent.ts#L79)).
- **`setStyle`** updates `getStyle()` and writes the `list-style-type` CSS rule with the enum's string value
  (`"disc"`, `"decimal-leading-zero"`, etc.) — assert the value handed to `setElementCSSRule`, not a rendered
  marker. The enum-value sequencing (the "numbered marker sequence" of interest) is the CSS
  `list-style-type` token itself; assert each enum member maps to its documented CSS keyword.
- **`itemStyle` / `selectedIndex` options** dispatch through `applyOptions`.
- **`ListItem`** stores its `key` and `value`; `getKey()` returns the key; `applyStyle()` is a no-op (returns
  `this`); the `text` option overrides the positional `value`
  ([`ListItem.ts:56`](../src/typescript/lib/component/list/ListItem.ts#L44)).
- Enum completeness: `NumberedListItemStyle` / `BulletedListItemStyle` members map to their exact CSS strings
  (cheap, pure, guards against accidental rename).

### Priority 3 — `Tree` public contract (`tests/component/tree/Tree.test.ts`)

- **Construction**: ARIA role `tree`, `tabIndex 0`, `multiselectable true` wired (assert via the recorded sink
  writes under `installTestDOM`, or via the `getAria()` accessor if it exposes getters — confirm during
  implementation); default preferred size `200×300`.
- **`setNodes` / `getNodes`**: stores the array by reference (`getNodes()` returns the same array identity);
  clears selection so `getSelectedNode()` → `null` and `getSelectedNodes()` → `[]`.
- **`setNodes` resets prior selection**: after seeding a selection through the white-box block (below), a
  fresh `setNodes` returns selection getters to empty.
- **Renderer factory**: default `getRendererFactory()` produces a `LabelTreeNodeRenderer`;
  `setRendererFactory(f)` swaps it and `getRendererFactory()` returns `f`; the swap is observable before any
  render.
- **`on` / `off` / `emit` listener bag**: register a `"selection"` listener, fire `emit` through a test-local
  subclass widening (`emit` is `protected`), assert the listener receives the payload; `off` removes it.

### Priority 3 (fenced white-box) — Tree flatten / expand traversal

A single clearly-commented block that reaches the private flatten/toggle surface via
`const tree = new Tree() as unknown as { _flatten(): void; _onToggle(n: TreeNode): void; _flatRows: ... }`:

- **`_flatten` depth + posInSet**: a two-level tree with an expanded parent flattens to
  `[root(depth0,pos1), child(depth1,pos1), child(depth1,pos2), sibling(depth0,pos2)]`; `siblingCount` equals
  the count at each level; collapsed parents contribute only themselves.
- **`_isExpandable`**: a node with non-empty `children` is expandable; an empty-`children` eager node is not; a
  `hasChildren: true` lazy node is expandable before its children exist
  ([`Tree.ts:292`](../src/typescript/lib/component/tree/Tree.ts#L292)).
- **`_onToggle` collapse/expand**: toggling an expanded node removes it from `_expandedNodes` and shrinks
  `_flatRows`; toggling a collapsed eager node grows it. (Lazy `loadChildren` async expansion is a non-goal —
  it needs the render loop and promise plumbing.)

If, during implementation, the private surface proves too brittle to assert cleanly (e.g. `_flatten` is a no-op
without a wired scroller), demote this entire block to a non-goal and note why — do not force it.

### Priority 4 (honestly low value) — renderers and `TreeNodeRenderContext`

- **`TreeNodeRenderContext`** is a plain interface — a compile-time-only shape; a runtime test adds little.
  Cover it implicitly through the renderer `update` tests rather than a standalone file.
- **`LabelTreeNodeRenderer.update` / `getContentWidth`**: under `installTestDOM` with the baked font table,
  `update({ node: {label: "Banana"}, ... })` then `getContentWidth()` returns the measured label width
  (`measureText` sums baked advances). This *does* work offline because `Text.measure()` routes through
  `DOM.source.measureText`. Assert the width is the sum of the baked advances for the label string — a
  relational invariant, not a golden pixel value.
- **`IconLabelTreeNodeRenderer` glyph swap**: a resolver returning a different name on successive `update`s
  constructs a fresh `Glyph`; assert `getContentWidth()` reflects `ICON_WIDTH + labelWidth`. Glyph DOM
  swap detail is a non-goal.

---

## Internal Structure

Test-local subclass seam used by the list suites (illustrative — keep it minimal, one per file that needs it):

```typescript
// White-box seam: widen the protected reducer / type-ahead to public so the
// modifier-key branches can be exercised without faking DOM MouseEvents.
class TestMultiSelectList extends MultiSelectList {
    public reduce(idx: number, ev: { ctrl: boolean; shift: boolean }) { this.reduceSelection(idx, ev); }
    public all() { this.selectAll(); }
}
```

The deterministic clock for type-ahead:

```typescript
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });
// advance: (Date.now as Mock).mockReturnValue(800)  // past TYPE_AHEAD_TIMEOUT_MS
```

Note: `callable(MultiSelectList)` wraps the export; subclass the **underlying** class via the `_MultiSelectList`
named export (`import { _MultiSelectList } from '~/component/list/MultiSelectList'`) so `extends` sees the real
class, not the callable proxy — confirm the `_`-prefixed export is importable during implementation.

---

## Ordered Implementation Steps

1. Create `tests/component/list/` and `tests/component/tree/` directories.
2. **`tests/component/list/MultiSelectList.test.ts`** — Priority 1 multi-select model. Construct lists with
   inline `items`; assert `getValue()` / anchor / focus through the public + test-local-subclass surface. Add
   the store round-trip tests with an inline-`data` `MemoryStore`. → verify: `npx vitest run
   tests/component/list/MultiSelectList.test.ts` green (minus any deliberate `it.fails`).
3. **`tests/component/list/List.test.ts`** — Priority 1 single-select + Priority 2 `AbstractCustomList` shared
   logic (item keying, `getItems` copy, type-ahead with the faked clock, store refresh survival). → verify:
   suite green.
4. **`tests/component/list/MarkedList.test.ts`** — Bulleted/Numbered/`ListItem`/enum-mapping. Assert
   `getStyle()` + the CSS value handed to the style setter; do **not** assert native selection (stubbed `-1`
   offline). → verify: suite green.
5. **`tests/component/tree/Tree.test.ts`** — Priority 3 public contract + the fenced white-box flatten/toggle
   block. Gate the white-box block behind the "demote to non-goal if brittle" check. → verify: suite green.
6. **Renderer coverage** — fold `LabelTreeNodeRenderer` / `IconLabelTreeNodeRenderer` `getContentWidth` tests
   into `tests/component/tree/Tree.test.ts` or a sibling `Renderers.test.ts`, under `installTestDOM` with the
   baked font JSON. → verify: suite green.
7. For every assertion that fails, **stop and investigate** whether the expectation or the code is wrong; if
   the code diverges from its contract, leave the assertion contract-correct and mark it `it.fails(...)` with a
   `// BUG: <file>:<line> — <what the contract says vs. what happens>` comment. Never edit `src/` to make a test
   pass (this is a test-authoring plan; production changes are out of scope).
8. Run the full suite (`npx vitest run`) to confirm no cross-file harness leakage (each `installTestDOM` test
   pairs with `DOM.reset()` in `afterEach`). → verify: whole suite green, only intended `it.fails` reported.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `tests/component/list/MultiSelectList.test.ts` |
| Create | `tests/component/list/List.test.ts` |
| Create | `tests/component/list/MarkedList.test.ts` |
| Create | `tests/component/tree/Tree.test.ts` |
| Create (optional) | `tests/component/tree/Renderers.test.ts` (else folded into `Tree.test.ts`) |

No source files are modified. No production API changes.

---

## Verification

- `npx vitest run tests/component/list tests/component/tree` — all new suites pass; any `it.fails` entries are
  intentional and each carries a `// BUG:` comment.
- `npx vitest run` — full suite still green; no harness bleed between files (the `installTestDOM` /
  `DOM.reset()` pairing is present wherever the modelled source is installed).
- `npx tsc --noEmit` (or the project's typecheck script) — test files type-check; the test-local subclass seams
  compile against the `_`-prefixed underlying-class exports.
- Coverage spot-check: `npx vitest run --coverage tests/component/list tests/component/tree` should show the
  selection setters, `setItems` / `addItem` / `setValues` / `setSelectedIndex`, the type-ahead reducer, and the
  list-style setters covered; the virtual-scroll render window and lazy-load paths remain uncovered by design
  (see Non-Goals).

---

## Potential Challenges

- **Callable wrapper vs. `extends`**: the public list/tree exports are `callable(...)` proxies; subclassing for
  white-box seams must import the `_`-prefixed real class. Mitigation: confirm `_MultiSelectList` / `_List` /
  `_Tree` are importable and named in each module's export block (they are, per the export tails read during
  planning).
- **Offline DOM gaps**: `ModelledDOMSource` stubs `getSelectedIndex`/`getSelectedOptionDataset` to `-1` /
  `undefined`, so `AbstractListComponent` (native-select-backed) selection is not assertable offline.
  Mitigation: scope the marked-list suite to style/child-type only, stated in Non-Goals.
- **Private tree state**: the interesting expand/collapse arithmetic lives in private handlers behind an
  element + `VirtualScroller`. Mitigation: the fenced white-box block plus the explicit "demote if brittle"
  escape hatch keeps the plan honest rather than forcing fragile pokes.
- **Type-ahead timing flake**: real `Date.now()` would make the 700ms boundary racy. Mitigation: mock
  `Date.now` per the Internal Structure block.
- **Synthetic `KeyboardEvent` shape**: `handleKey` reads `e.key`, `e.ctrlKey`, `e.metaKey`, `e.altkey`,
  `e.preventDefault()`. Under jsdom a real `new KeyboardEvent("keydown", { key: "b" })` works; prefer it over a
  hand-rolled object so `preventDefault` exists.

---

## Critical Files

Implementer must read before writing tests:

- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) —
  the selection set, item array, type-ahead, store binding; the bulk of the testable logic.
- [`src/typescript/lib/component/list/MultiSelectList.ts`](../src/typescript/lib/component/list/MultiSelectList.ts)
  and [`List.ts`](../src/typescript/lib/component/list/List.ts) — the concrete reducers.
- [`src/typescript/lib/component/list/AbstractListComponent.ts`](../src/typescript/lib/component/list/AbstractListComponent.ts),
  [`ListItem.ts`](../src/typescript/lib/component/list/ListItem.ts), and the two style enums.
- [`src/typescript/lib/component/tree/Tree.ts`](../src/typescript/lib/component/tree/Tree.ts) — selection /
  expansion sets, `_flatten`, the public getters.
- [`tests/dom/TestDOM.ts`](../tests/dom/TestDOM.ts) — `installTestDOM` config + the modelled source's offline
  behaviour (what it stubs vs. models).
- [`tests/dom/geometry.test.ts`](../tests/dom/geometry.test.ts) — canonical `installTestDOM` + `DOM.reset()`
  pattern and the baked-font config.
- [`tests/component/Component.test.ts`](../tests/component/Component.test.ts) and
  [`tests/component/layout/HBox.test.ts`](../tests/component/layout/HBox.test.ts) — the jsdom-pragma +
  no-harness-needed pattern for pure-state assertions.
- [`src/typescript/MultiSelectListPanel.ts`](../src/typescript/MultiSelectListPanel.ts) — canonical intended
  usage of `setItems` / store binding / `getSelectedRecords` / Binding integration.

---

## Non-Goals

- **Full virtual-scroll render window** (`_renderWindow`, `_computeVisibleWindow`, `_growRowPool`,
  `_positionRows`, `_bindAndMeasure`) — requires a wired `VirtualScroller` and a real viewport; integration-test
  territory, not unit. Out by design; explicitly uncovered.
- **Lazy `loadChildren` async expansion** (`_loadAndExpand`, the loading-spinner affordance, the orphaned-resolve
  guard) — needs the render loop plus promise/timer choreography; disproportionate setup for the payoff here.
- **Real click / keyboard event delivery through the DOM seam** — `RecordingDOMSink.dispatchEvent` only records
  the event type and cannot deliver a `MouseEvent` with modifier flags to `_handleClick` / `handleRowClick`;
  the modifier-key reducers are covered through the public/test-local-subclass surface instead.
- **`AbstractListComponent` (native-select) selection getters** — `getSelectedIndex` / `getSelectedValue` route
  through the native seam, stubbed offline; not assertable without a real `<select>`.
- **Rendered marker glyphs / icon DOM** — bullet discs, ordinal numerals, and icon SVG output are browser
  rendering concerns; tests assert the `list-style-type` token and content-width arithmetic instead.
- **Pixel-geometry golden snapshots** of any row, toggle, or label — explicitly excluded per the methodology.
