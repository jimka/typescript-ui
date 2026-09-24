---
depends-on: [date-roundtrip-and-tab-active-index]
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Tab Order Persistence — Implementation Plan

## Overview

A `Tab` strip the user has drag-reordered does not survive save and restore.
[`serializeLayout`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L341)
writes `TabNode.children` in the container's child order, but a drag reorder
re-sorts the manager's own entries and the strip and leaves the container's
children exactly where they were
([`Tab._onBarReordered:1111-1126`](packages/lib/src/typescript/lib/layout/Tab.ts#L1111)).
So a restore puts every dragged tab back in the order the tabs were *added*,
while [`TabNode.children:99`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L99),
[`LayoutSerialization.md:83`](packages/lib/docs/layouts/LayoutSerialization.md#L83)
and [`Dock.md:199`](packages/lib/docs/components/Dock.md#L199) all promise tab
order.

The fix is on the capture side only: the `Tab` branch of `nodeFor`
([`:260-277`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L260))
orders its kept children by their strip position before writing them. The
restore side already reproduces whatever order it is handed. One source file,
one test file and two documentation pages change; no exported signature does.

This is the follow-up
[`plans/implemented/date-roundtrip-and-tab-active-index.md`](plans/implemented/date-roundtrip-and-tab-active-index.md)
listed as its first `## Non-Goals` bullet, and recorded in
[`00-post-campaign-agenda.md:229-232`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L229).
That merged plan owns the adjacent serialization work — it made
`TabNode.activeIndex` name the active child by identity, and made the restore
re-align that index to the tabs actually placed — and its decisions bind this
one.[^merged-plan-binds]

---

## Architecture Decisions

### The capture reads the strip; the container keeps its own child order

`nodeFor`'s `Tab` branch sorts the children it captures into tab-strip order.
Nothing about `Tab` changes: a drag reorder goes on moving only the strip and
the manager's entries, and the container's children stay in the order they
were added.[^why-not-resort-the-container]

### A child's strip position comes from `Tab.indexOfContent`

The rank each child is sorted by is
[`Tab.indexOfContent(child)`](packages/lib/src/typescript/lib/layout/Tab.ts#L2313),
the public accessor for the index space `setActiveTabIndex` and
`getActiveTabIndex` use. No new `Tab` API is added.[^no-new-accessor]

Sorting by a rank read from the strip is how `Tab` itself re-derives its
content order after a reorder
([`_onBarReordered:1115`](packages/lib/src/typescript/lib/layout/Tab.ts#L1115)
sorts `_contents` by `order.indexOf(a.id)`).

### A child with no strip cell yet is captured last

`indexOfContent` returns `-1` for a child whose tab the next layout pass has
still to create. Such a child ranks after every tabbed child — which is where
[`syncUntabbedChildren:1854-1877`](packages/lib/src/typescript/lib/layout/Tab.ts#L1854)
will place it — and keeps its container position against its untabbed
siblings.[^untabbed-last]

Worked example. The container holds P A B C D; P carries `transient: true`, so
it is never captured; D was added after the last layout pass, so it has no
strip cell; the user dragged C to the front, making the strip **C P A B**.

| Captured child | `indexOfContent` | Rank | Captured at |
|---|---|---|---|
| A | 2 | 2 | 2nd |
| B | 3 | 3 | 3rd |
| C | 0 | 0 | 1st |
| D | −1 | `MAX_SAFE_INTEGER` | 4th |

`children` is therefore `c a b d`.

### The restore side already reproduces a saved order

`populateContainer`'s `Tab` branch
([`:570-598`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L570))
appends each resolvable child in saved order and registers its tab in the same
pass, so after a restore the saved order, the strip order and the container's
child order all agree. No restore-side change.[^restore-already-right]

### A live tab the saved state does not name is not placed

`restoreLayout` rebuilds the strip from the state alone. A tab added after the
save is therefore left out of the restored strip: it is detached and left alive
when the `LayoutFactory` still supplies its id, and disposed with the rest of
the scaffold when it does not. That is today's behaviour for every node kind;
this plan pins it with tests and does not change it.[^unnamed-live-tab]

### No schema change

`TabNode` keeps its shape and `LayoutState.version` stays `1`. A state saved
before this fix carries the container's order and restores to exactly that
order, as it always did.[^no-migration]

---

## Internal Structure

### `LayoutSerialization` — the new ordering helper

Insert between `serializableChildren`'s closing brace
([`:236`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L236))
and `function nodeFor`
([`:238`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L238)).

```typescript
// A child whose strip cell the next layout pass has yet to create reports -1
// from indexOfContent. Rank it past every real strip position so it sorts
// after the tabbed children rather than ahead of all of them.
const UNTABBED_RANK = Number.MAX_SAFE_INTEGER;

/**
 * The serializable children of a {@link Tab} container in tab-strip order —
 * the order the user sees. A drag reorder re-sorts the manager's entries and
 * the strip and never the container's children, so from the first reorder
 * onwards the two orders differ, and the strip is the one a restore has to
 * reproduce.
 *
 * Each kept child is ranked by {@link Tab.indexOfContent} and the list sorted
 * by that rank — the same re-derivation `Tab` performs on its own entries
 * after a reorder. A child with no strip cell yet sorts after every tabbed
 * child, where the next layout pass will place it, and keeps its container
 * position against its untabbed siblings.
 *
 * @param component - The `Tab` container whose children to order.
 * @param manager - The container's `Tab` layout manager.
 * @returns The serializable children, in tab-strip order.
 */
function tabOrderedChildren(component: Component, manager: Tab): Component[] {
    const ranked = serializableChildren(component).map((child, position) => {
        const index = manager.indexOfContent(child);

        return { child, position, rank: index < 0 ? UNTABBED_RANK : index };
    });

    // The container position breaks ties, so untabbed children keep their
    // relative order without the sort having to be a stable one.
    ranked.sort((a, b) => (a.rank - b.rank) || (a.position - b.position));

    return ranked.map(entry => entry.child);
}
```

### `LayoutSerialization` — the amended `Tab` capture branch

Replace [`:260-277`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L260).
Only `kept`'s initializer and the first sentence of the comment change.

```typescript
if (kind === "Tab") {
    const manager = component.getLayoutManager() as Tab;
    const kept    = tabOrderedChildren(component, manager);
    const active  = manager.getActiveContent();

    // The manager's own active index counts tab-strip positions, which include
    // a transient tab and a lazy tab with no content yet, so it does not index
    // `kept`. The active tab is found in `kept` by identity instead, the way
    // Tab keeps its own selection across a reorder. With no captured child
    // active, the first tab is recorded.
    const index = active === null ? -1 : kept.indexOf(active);

    return {
        kind:        "tab",
        children:    kept.map(nodeFor),
        activeIndex: Math.max(0, index),
    };
}
```

---

## Ordered Implementation Steps

Run every command from `packages/lib`.

### Commit 1 — a captured `Tab` records the strip's order

1. **`tests/component/layout/LayoutSerialization.test.ts`** — move the six
   helpers now nested inside
   `describe('serializeLayout of a Tab: the active index names the active child')`
   ([`:539`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L539))
   out to module scope, immediately above that `describe`, beside the existing
   module-scope `instanceFactory`
   ([`:28`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L28)):
   `tabHost`, `panels`, `transient`, `tabRoot`, `activePanelId` and
   `placeholderFirstWithBActive`. Bodies unchanged. A later step adds a third
   `describe` that uses them.
   Check: `npx vitest run tests/component/layout/LayoutSerialization.test.ts`
   — all green, nothing renamed.

2. **Same file** — add a module-scope `reorder` helper beside them, lifting the
   inline reorder in test 5
   ([`:671-674`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L671)):

   ```typescript
   /**
    * Drags the strip cell at `fromIndex` to `toIndex`, the way
    * `tests/layout/Tab.doubleClick.test.ts:163-190` drives one — there is no
    * public reorder entry point, so the bar and the strip's `"reorder"`
    * handler are driven directly.
    *
    * @param tab - The Tab manager whose strip to reorder.
    * @param fromIndex - The strip position of the cell to move.
    * @param toIndex - The strip position to move it to.
    */
   function reorder(tab: Tab, fromIndex: number, toIndex: number): void {
       const bar = (tab as unknown as { _bar: { getEntryIds(): string[]; moveBarEntry(id: string, to: number): unknown } })._bar;
       const id  = bar.getEntryIds()[fromIndex];

       bar.moveBarEntry(id, toIndex);
       (tab as unknown as { _onBarReordered(fromId: string, toIndex: number): void })._onBarReordered(id, toIndex);
   }
   ```

   Rewrite test 5's four inline lines as `reorder(tab, 2, 0);`. Re-run the
   file — still green.

3. **Same file** — rewrite test 5
   ([`:660-682`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L660)).
   Retitle it *"5. a drag-reordered strip captures its children in strip order,
   with the active child by identity"*, delete the two-line comment at
   [`:679-680`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L679)
   that defers the order to this plan, and add, beside the existing
   `activePanelId` assertion, the row-5 expectations from
   *`serializeLayout` of a reordered `Tab`*: `children`'s panel ids and
   `activeIndex`. It fails before step 7.

4. **Same file** — add tests 7–10 to that `describe`, one per remaining row of
   *`serializeLayout` of a reordered `Tab`*. Each asserts
   `root.children.map(child => (child as { panelId: string }).panelId)` and
   `root.activeIndex`. Tests 8–10 fail before step 7; test 7 (the control row,
   never reordered) passes throughout.

5. **Same file** — rename
   `describe('restoreLayout of a Tab node with a skipped leaf')`
   ([`:701`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L701))
   to `describe('restoreLayout of a Tab node: the saved order and the active index')`,
   add `tab: (host.getLayoutManager() as Tab)` to `restoreSkipping`'s return
   object and return type
   ([`:717-752`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L717)),
   and add one `it` per row of *`restoreLayout` of a reordered `TabNode`*.
   Each reads the restored strip back with
   `tab.indexOfContent(byId.<id>)` rather than by re-serializing, so the
   assertion does not depend on the code under test in step 7. The six
   existing tests destructure only `active` and `byId` and are untouched.
   All of these pass before step 7 — the restore side is already correct.

6. **Same file** — add `describe('a reordered Tab strip survives save and
   restore')` at the end of the file, one `it` per row of *save and restore of
   a reordered strip*, using the module-scope helpers from steps 1–2. Every
   row asserts the restored strip's order, so all five fail before step 7.

7. **`src/typescript/lib/layout/LayoutSerialization.ts`** — add `UNTABBED_RANK`
   and `tabOrderedChildren` between
   [`:236`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L236)
   and [`:238`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L238),
   and replace the `Tab` branch of `nodeFor`
   ([`:260-277`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L260)),
   both as in `## Internal Structure`. Leave the misplaced JSDoc block at
   [`:214-221`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L214)
   where it is.

8. **Same file** — change `TabNode.children`'s JSDoc
   ([`:99`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L99))
   to *"Child arrangement nodes, in tab-strip order — the order the user sees,
   which a drag reorder makes differ from the container's own child order."*

9. `npx vitest run tests/component/layout/LayoutSerialization.test.ts` — all
   green, including the six pre-existing tests of the capture `describe` and
   the six of the restore `describe`.

10. `npx vitest run tests/component/layout/ tests/layout/ tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
    — the `Tab` suites and the `Dock` callers of `serializeLayout` /
    `restoreLayout`.

11. `grep -n "serializableChildren(" src/typescript/lib/layout/LayoutSerialization.ts`
    — expect exactly two matches: the declaration and the call inside
    `tabOrderedChildren`. A third means the `Tab` branch still reads the
    container's order.

12. `grep -rn "getComponents()" src/typescript/lib/layout/LayoutSerialization.ts`
    — expect only `serializableChildIndices`, `serializableChildren`,
    `windowContentOf`, `collectLeaves` and `parkLeaves`. None of them is the
    `Tab` capture branch.

### Commit 2 — documentation

13. **`docs/reference/changelog/next.md`** — under `## Fixed` → `### Layouts`,
    directly after the *"A saved `Tab` arrangement now records the tab that was
    actually active"* entry
    ([`:1491-1499`](packages/lib/docs/reference/changelog/next.md#L1491)), add
    an entry in the page's bold-lead-sentence style. It must name: that
    `TabNode.children` was written in the container's child order; that a drag
    reorder moves only the strip and the manager's entries, so a restored strip
    put every dragged tab back where it started; that `TabNode`'s own
    declaration and the [Layout serialization](/layouts/LayoutSerialization)
    page both promised tab order; that the capture now reads the strip; that
    `activeIndex` still names the same panel, though its number changes when a
    reorder moved that panel; that a tab whose strip cell does not exist yet is
    captured after the tabs that have one; and that a state saved before this
    change restores exactly as it did.

14. **`docs/layouts/LayoutSerialization.md`** — replace the `TabNode` row
    ([`:83`](packages/lib/docs/layouts/LayoutSerialization.md#L83)) with
    *"Child nodes in tab-strip order — the order the user sees, which a drag
    reorder makes differ from the container's own child order — plus the
    `activeIndex`."*

15. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`,
    `npm run docs:api`, `npm run docs:llms:check` — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |

---

## Expected Behaviour

Components A, B and C have ids `a`, `b` and `c`; D has id `d`. P is a child
added with `transient: true`. A host is built and sized as `tabHost()` does,
children are added, `host.doLayout()` gives each one its strip cell, and a
reorder is driven by the `reorder` helper of step 2.

Every case below is unit-testable offline. The one thing the harness cannot
exercise is the pointer gesture that produces a reorder — `reorder` drives the
bar and the strip's `"reorder"` handler directly — which the manual step at the
end covers.

### `serializeLayout` of a reordered `Tab`

| # | Container children | Strip | Active | `children` today | `children` after | `activeIndex` after |
|---|---|---|---|---|---|---|
| 5 | A B C | C A B | A | a b c | c a b | 1 |
| 7 | A B C | A B C | A | a b c | a b c | 0 |
| 8 | A B C | B C A | C | a b c | b c a | 1 |
| 9 | P A B C | C P A B | B | a b c | c a b | 2 |
| 10 | A B C D | C A B, D no cell | A | a b c d | c a b d | 1 |

Row 7 is the control: a strip nobody reordered still captures the container's
order. Row 10 adds D with `host.addComponent(d)` and no further `doLayout()`;
its expected order holds whether or not D has a strip cell by capture time,
because an untabbed child ranks last and `syncUntabbedChildren` would have
appended its cell last too.
In every row `children[activeIndex].panelId` names the active child — rows 5
and 8 are where today's `activeIndex` names it only by accident of the
identity lookup the merged plan added.

Tests 1, 2, 3, 4 and 6 of that `describe` keep their present expectations: the
new order leaves each of their captures unchanged.[^existing-rows-unchanged]

### `restoreLayout` of a reordered `TabNode`

Hand-built states through `restoreSkipping`. The factory omits the skipped ids
and `console.warn` is mocked, as the six existing rows do.

| # | Saved `children` | Saved `activeIndex` (names) | Skipped | Restored strip | Active |
|---|---|---|---|---|---|
| 7 | c a b | 1 (`a`) | — | C A B | A |
| 8 | c a b | 2 (`b`) | `c` | A B | B |
| 9 | c a b | 1 (`a`) | `a` | C B | B |
| 10 | c a b | 0 (`c`) | `a` `b` | C | C |

The restored strip is read as `tab.indexOfContent(byId.c) === 0` and so on.
Rows 8–10 restate the merged plan's re-alignment rule against a saved order
that is not the container's: a saved child skipped *ahead of* the active one
moves the selection one slot left (row 8), and a skipped active child hands the
selection to whichever child slid into its slot (rows 9 and 10).

### Save and restore of a reordered strip

Each row builds A B C, reorders to strip **C A B**, activates A, captures
`state = serializeLayout(host)`, then restores.

| # | After the capture | Restored with | Result |
|---|---|---|---|
| 1 | — | `instanceFactory({ a, b, c })` | strip C A B; `getActiveContent()` is A |
| 2 | row 1, then `serializeLayout(host)` again | — | a node equal to `state`: `children` `c a b`, `activeIndex` 1 |
| 3 | `host.addComponent(d)` | `instanceFactory({ a, b, c, d })` | strip C A B; `d.getParentComponent()` is `null`; `d.dispose` was not called |
| 4 | `host.addComponent(d)` | `instanceFactory({ a, b, c })` | strip C A B; `d.dispose` was called |
| 5 | — | `instanceFactory({ b, c })`, `console.warn` mocked | `console.warn` names `a`; strip C B; `getActiveContent()` is B |

Row 2 is the round-trip check: restoring a captured order and capturing it
again yields the same node, so repeated save/restore cycles do not drift.

Row 3 is a tab added after the save, whose factory still knows it: the state
has no slot for D, so D is parked and never re-homed — detached, undisposed.
Row 4 is the same tab with a factory that does not know it: D is never parked,
so `root.disposeAllComponents()` reaches it. Both are unchanged `restoreLayout`
behaviour, pinned so the order fix cannot quietly alter them. Assert row 3 with
`vi.spyOn(d, 'dispose')` and `getParentComponent()`, as
[`L2b:357-362`](packages/lib/tests/component/layout/LayoutSerialization.test.ts#L357)
does; row 4 with the same spy, which calls through by default.

Row 5 is a tab removed before the restore, as a whole flow rather than a
hand-built state: it is restore-table row 9 reached by capture rather than by
hand.

### Manual verification

Not run by the implementer — every demo-app run opens a browser window on the
user's desktop and needs the user's go-ahead. Record it as a documented manual
step.

| Where | How | Shows |
|---|---|---|
| Demo app, **Layout I/O** section ([`LayoutSerializationPanel.ts`](packages/lib/src/typescript/LayoutSerializationPanel.ts)) | Click **Tab layout**, drag the last tab to the front with the pointer, click **Serialize → console**. | `root.children` is in the order the tabs now appear in. Today it is in the order the preset added them, whatever the drag did. |

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — 0 errors.
2. `npm run typecheck:test` — 0 errors.
3. `npx vitest run tests/component/layout/ tests/layout/` — the serialization
   suite this plan extends, plus the `Tab` suites the changed code runs under.
4. `npx vitest run tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.beforeClose.test.ts tests/overlay/Dock.panelPresentation.test.ts tests/overlay/Dock.closeDisposal.test.ts`
   — the `Dock` callers of `serializeLayout` / `restoreLayout`
   ([`Dock.ts:586`](packages/lib/src/typescript/lib/overlay/Dock.ts#L586),
   [`:607`](packages/lib/src/typescript/lib/overlay/Dock.ts#L607)).
5. `npm test` — the full suite, once. The known
   `textRange(...).getClientRects` stderr noise is pre-existing on `master`.
6. `npm run lint`.
7. `npm run docs:api` — record the warning count on `master` first (14 today).
   The count must not grow. `tabOrderedChildren` and `UNTABBED_RANK` are
   module-private and render no page; `{@link Tab.indexOfContent}` in the new
   JSDoc resolves to a public member of a documented class.
8. `npm run docs:llms:check` — unaffected; no new concrete class ships.
9. The grep checks in steps 11 and 12.
10. The manual demo-app step in `## Expected Behaviour`, with the user's
    go-ahead.

---

## Documentation Impact

No new public symbol, so no new page, barrel entry or catalog row, and no
migration note — this is a behaviour fix, not a breaking change.

Rendered JSDoc changes: `TabNode.children` only (step 8).

Pages:

- [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)
  — one `## Fixed` → `### Layouts` entry (step 13), after the two `Tab`
  serialization entries the merged plan added.
- [`docs/layouts/LayoutSerialization.md`](packages/lib/docs/layouts/LayoutSerialization.md)
  — the `TabNode` row (step 14). Its opening line
  ([`:3`](packages/lib/docs/layouts/LayoutSerialization.md#L3)) already says
  "`Tab` order and active index" and needs no change — the code now matches it.
- [`docs/components/Dock.md`](packages/lib/docs/components/Dock.md) is
  unchanged. Its `:199` sentence already promises tab order.

---

## Potential Challenges

- **There is no public way to drive a reorder offline.** The `reorder` helper
  reaches `Tab._bar` and `Tab._onBarReordered`, exactly as
  [`tests/layout/Tab.doubleClick.test.ts:163-190`](packages/lib/tests/layout/Tab.doubleClick.test.ts#L163)
  and the present test 5 already do. Both `TabBar.getEntryIds`
  ([`:1454`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1454))
  and `TabBar.moveBarEntry`
  ([`:2015`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2015))
  are public; only the `_bar` field and the handler are not.
- **Do not drop the tie-break in the comparator.** `(a.rank - b.rank)` alone
  leaves every untabbed child tied, and the order then depends on the engine's
  sort being stable. `|| (a.position - b.position)` makes the comparator total.
- **A misplaced JSDoc block sits where the new function goes.** The block at
  [`:214-221`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L214)
  describes `nodeFor` but sits above `serializableChildren`'s own block. It is
  pre-existing; leave it alone and put `tabOrderedChildren` after
  `serializableChildren`'s closing brace.
- **`restoreSkipping`'s return shape grows.** Adding `tab` to the object and
  its return type is additive; the six existing rows destructure only `active`
  and `byId`.
- **A lazy tab still building has a spinner among the container's children.**
  The spinner has no `ContentEntry` of its own, so it ranks untabbed and is captured
  last instead of at its container position. Both placements are wrong and the
  difference is not this plan's to fix — see `## Non-Goals`.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/date-roundtrip-and-tab-active-index.md`](plans/implemented/date-roundtrip-and-tab-active-index.md) | Owns the adjacent serialization work and names this defect in its `## Non-Goals`. Its item-3 decisions — identity lookup on capture, re-alignment on restore, no schema change — bind this plan. |
| [`layout/LayoutSerialization.ts`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) | `serializableChildren:232` and the `Tab` branch of `nodeFor:260-277` are what change. `populateContainer:570-598` is the restore branch that needs none. |
| [`layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) | `_onBarReordered:1111-1126` is the reorder — and the rank-sort this plan mirrors. `indexOfContent:2313-2315` is the accessor used. `ContentEntry`'s remarks at `:257-264` and `getActiveTabIndex`'s JSDoc at `:2280-2283` document why strip order and container order legitimately differ. `syncUntabbedChildren:1854-1877` is where an untabbed child ends up. |
| [`tests/component/layout/LayoutSerialization.test.ts`](packages/lib/tests/component/layout/LayoutSerialization.test.ts) | The suite to extend: the capture `describe` at `:539`, the restore `describe` at `:701`, `restoreSkipping:717`, and the `dispose`-spy idiom at `:351-362`. |
| [`tests/layout/Tab.doubleClick.test.ts`](packages/lib/tests/layout/Tab.doubleClick.test.ts) | `:163-190` is the reorder-driving pattern the `reorder` helper generalises. |
| [`docs/layouts/LayoutSerialization.md`](packages/lib/docs/layouts/LayoutSerialization.md) | `:3` and `:83` are the promise the code is being made to keep. |

---

## Non-Goals

- **Re-sorting the container's children on a drag reorder.** The two orders are
  documented as separate index spaces, and re-syncing them would contradict a
  contract that shipped with the merged plan.[^why-not-resort-the-container]
- **A public `Tab` accessor for the strip's contents.**[^no-new-accessor]
- **Capturing an unmaterialized lazy tab.** It has no content component at all,
  so it is not a container child and has never been captured. Unchanged.
- **What a build-in-flight spinner does to a capture.** A spinner is a
  container child with no entry of its own, so it is captured as a panel node
  today and still is. Where it lands in the captured order changes as a side
  effect; whether it should be captured at all is a separate defect.
- **Placing a live tab the saved state does not name.** Appending unnamed
  panels to a restored strip would be a new feature, not this fix.
- **A `LayoutState` schema version bump or migration.**[^no-migration]
- **Any `Split` change.** A split's pane order is the container's child order
  and there is no second order to diverge from.
- **Any QA-panel or demo-app change.**

---

## Notes

[^merged-plan-binds]: `date-roundtrip-and-tab-active-index` fixed the *pairing*
    between `TabNode.activeIndex` and `TabNode.children` and explicitly deferred
    the order: "Item 3's lookup by identity stays correct whichever order is
    captured." That is why the capture branch needs no rework beyond its
    `kept` initializer — the identity lookup `kept.indexOf(active)` finds the
    active child wherever it sits. It is also why the present test 5
    (`:660-682`) asserts only which panel `activeIndex` names and carries a
    comment saying the order is an open defect: that comment is what step 3
    deletes.

[^why-not-resort-the-container]: The alternative — having `_onBarReordered`
    also re-sort the container's children, which `Component.sortComponents`
    would make easy — was rejected. Three reasons. `ContentEntry`'s remarks
    (`Tab.ts:257-264`) and `getActiveTabIndex`'s JSDoc (`:2280-2283`) both
    document the two index spaces as deliberately unaligned, because lazy tabs
    materialize out of order; re-syncing them contradicts a contract that
    shipped weeks ago. Child order is a layout input — `sortComponents`
    invalidates the layout, and DOM and focus-traversal order follow the
    children — so every drag would pay for and cause more than it does today,
    which is a re-sort of `_contents` plus a `scheduleLayout()`. And it would
    not remove the serializer's own work: `kept` still has to drop transient
    children and cope with children that have no strip cell yet, so the filter
    and the identity lookup stay either way. The defect is in what the
    serializer reads, so the reader is where it is fixed.

[^no-new-accessor]: A `Tab.getTabContents(): Component[]` returning the entries'
    components in strip order was considered and rejected. `indexOfContent` is
    already the public accessor for that index space and its JSDoc already says
    so, and a new accessor would still need the call site to intersect its
    result with `serializableChildren` — transient children have strip cells,
    and children with no cell yet do not appear in the entries at all. It would
    add public API and move no logic. Ranking each child costs one `findIndex`
    per child; a tab strip holds tens of tabs, and `_onBarReordered` already
    does the same quadratic walk on every reorder.

[^untabbed-last]: The alternative rankings are worse. Leaving `-1` as the rank
    sorts untabbed children ahead of every tabbed one, which is the opposite of
    where `syncUntabbedChildren` puts them on the next pass — so a capture
    taken between an `addComponent` and the next layout would disagree with the
    strip the user is about to see. Dropping untabbed children from the capture
    entirely would break the existing test 6 (`:684-695`), which captures two
    children of a host that was never laid out. `MAX_SAFE_INTEGER` needs no
    tab count, which `Tab` does not expose, and a strip position can never
    reach it.

[^restore-already-right]: `materializeNode` hands `populateContainer` each
    child in `node.children` order; `container.moveComponent(built, undefined,
    …)` appends (`Component.moveComponent:7553` computes `index ??
    this._components.length`), and `tab.createTab(built)` pushes the matching
    entry. So the container's children, the manager's entries and the strip all
    come out in the saved order, and `doLayout`'s `syncUntabbedChildren`
    catch-up finds nothing left to do. The active-index re-alignment the merged
    plan added counts positions in `node.children`, which is now strip order
    rather than container order — the arithmetic is identical either way,
    because it counts saved positions, not live ones.

[^no-migration]: The two orders are indistinguishable in a saved state: a
    `TabNode` carries an array of children and nothing that says which order
    produced it. An old state therefore restores to the order it was written
    in, which is what it always did, and a state written after this fix
    restores to the strip the user arranged. Nothing needs to tell them apart,
    so nothing needs a version bump — the same reasoning the merged plan
    recorded for its own `activeIndex` change.

[^unnamed-live-tab]: `parkLeaves` detaches a leaf only when `factory(id)`
    returns that very instance, and `materializeNode` re-homes a parked leaf
    only when the state names it. A tab added after the save is named by
    neither the state's children nor, therefore, any re-home — so it ends up
    detached and alive (factory knows it) or disposed by
    `root.disposeAllComponents()` (factory does not). This is the same outcome
    a `Split` pane added after a save gets, and it follows from
    `restoreLayout`'s documented park-and-rebuild model: the state is the
    arrangement, and a panel the arrangement has no slot for has no slot.

[^existing-rows-unchanged]: Checked against each. Test 1 and test 2 use strip
    P A B C over container P A B C — the kept ranks are 1, 2, 3, so the order
    is `a b c` either way. Test 3 uses strip A B C P — ranks 0, 1, 2, same.
    Test 4 captures a single child. Test 6's host was never laid out, so both
    children rank `MAX_SAFE_INTEGER` and the position tie-break preserves
    `a b`. Test 5 is the one that changes, and step 3 is where its expectation
    is added.
