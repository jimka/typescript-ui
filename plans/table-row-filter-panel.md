---
touches-shared:
  - packages/qa/src/harness/ablations.ts
  - packages/qa/tests/ablations.test.ts
  - packages/qa/README.md
  - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
---

# A body row filter for `table-rows` — Implementation Plan

## Overview

G21's `getVisibleRecords` memo is the render-review campaign's largest
unmeasured candidate, and today it cannot be measured at all. A *body row
filter* is a predicate a consumer sets through
[`Table.setRowVisible`](packages/lib/src/typescript/lib/component/table/Table.ts#L551);
with one set,
[`Body.getVisibleRecords`](packages/lib/src/typescript/lib/component/table/Body.ts#L502)
runs it over the store's whole view on every call. No QA panel sets one, so on
every surface measured so far the method took its unfiltered branch and the memo
had next to nothing to remove
([`00-post-campaign-agenda.md`, *Judged again*](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L896)).

This plan builds the missing surface and names the *cells* that settle the
candidate — a cell being one panel, one set of parameters and one drive, run as an
interleave of plain and patched repetitions in a single sitting. `table-rows`
gains a `rowfilter=` parameter that sets a real body row filter. `ablations.ts`
gains a `g21.visible-memo` *ablation* — a runtime patch that applies the memo and
nothing else, so a same-session A/B bounds what a real fix could save; G21's
existing patch bundles the memo with two other changes and cannot do that. And
`## Verification` writes out two cells for the user to run.

Everything lands in `packages/qa` — one panel, two shared builders, one ablation,
the package's vitest suite and `README.md` — plus two corrected sentences in the
campaign's agenda.[^slice] No library file changes.

The plan runs no measurement. Every run opens a full-screen window, so the cells
are steps for the user.

---

## Architecture Decisions

### The row filter is a parameter on `table-rows`, not a new panel

`table-rows` gains `rowfilter=off|title`, defaulting to `off`, which leaves every
run made so far unchanged. The parameter adds no component and changes no
column.[^parameter]

### The predicate tests a job title and admits two rows in five

`rowfilter=title` sets a module-level predicate that admits a record whose
`title` is one of `ROW_FILTER_TITLES` — `Engineer` or `Manager`, two of the five
titles [`tableRows`](packages/qa/src/builders/data.ts#L219) cycles through. At
any scale it admits exactly two rows in five.[^predicate]

### The store filter and the row filter compose, and neither rejects the other

`rowfilter=` and `update=filter` are independent, and the panel refuses no
combination. The store filter shrinks the view the row filter then runs over,
which is visible in the report as `host.storeRecords`:

| `rowfilter` | `update` | What the body's predicate runs over | Rows rendered at n = 10,000 |
|---|---|---|---|
| `off` | `record` | no predicate is set | 10,000 |
| `title` | `record` | the store's whole view, 10,000 records | 4,000 |
| `off` | `filter` | no predicate is set | about 1,667 |
| `title` | `filter` | the department view, about 1,667 records | about 667 |

Neither cell in `## Verification` drives an `update` phase, so neither sets both.[^compose]

### The memo gets its own ablation arm, `g21.visible-memo`

`ABLATIONS` gains `g21.visible-memo`, which applies only the visible-records
memo of `g21.render-pass` by reusing that ablation's own
[`memoiseVisibleRecords`](packages/qa/src/harness/ablations.ts#L1723). The
three-part arm stays as it is.[^own-arm]

### The cells drive `key` and `passes`, at n = 10,000 and n = 900

One drive, `key,passes`, run as two scored cells at the two scales. The
candidate's value is proportional to the store's size, so the pair of cells is
the reading: a win that does not shrink by about eleven times at n = 900 is
session drift, not the arm.[^phases] No `wheel` phase, and no trailing settled
phase.[^no-settle]

### The soundness gate is geometry plus the body's own call count

The cells keep `table-rows`' five geometry labels and add
`--same 'work.getVisibleRecords@TableBody'`, so an arm that changed how often
the body asks for the list is marked `DIFF` even where every rectangle
matches.[^gate]

---

## Public API

### `packages/qa/src/builders/data.ts`

```typescript
/** The job titles `table-rows`' `rowfilter=title` predicate admits: two of the five `tableRows` cycles through, so it keeps 2/5 of the rows. */
export const ROW_FILTER_TITLES: ReadonlySet<string>;
```

### `packages/qa/src/builders/store.ts`

```typescript
/** What `admittedAt` needs of a store: indexed access to its filtered, sorted view. */
export interface IndexedStore<R> {
    getAt(index: number): R | undefined;
}

export function admittedAt<R>(store: IndexedStore<R>, admits: ((record: R) => boolean) | null, index: number): R | undefined;
```

### `packages/qa/src/panels/table-rows.ts`

The four contract exports are unchanged in shape. `build` reads one more
parameter:

| Parameter | Values | Default | What it does |
|---|---|---|---|
| `rowfilter=` | `off`, `title` | `off` | `title` sets the body row filter through `Table.setRowVisible` |

`describe()` gains four fields:

| Field | Value |
|---|---|
| `rowFilter` | the parameter's value, `off` or `title` |
| `storeRecords` | `store.getCount()` — the view the predicate runs over |
| `filteredRows` | how many of those records the predicate admits |
| `bodyRowFilter` | whether the body actually holds a row-visible predicate |

### `packages/qa/src/harness/ablations.ts`

```typescript
ABLATIONS['g21.visible-memo']   // counters: memo.g21.visible-memo.visibleHit
```

---

## Internal Structure

### The predicate and the record a driver starts from (`table-rows.ts`)

The predicate is a module-level function, so its identity never changes during a
run. That is load-bearing: `g21.visible-memo`'s memo key is the store's records
array and the body's predicate, compared by identity, so a predicate rebuilt per
call or per unit would invalidate the memo on every pass.

```typescript
/** `rowfilter=`'s values: `off` sets no row filter, `title` admits `ROW_FILTER_TITLES`. */
const ROW_FILTERS = ['off', 'title'] as const;

function admitsFilteredTitle(record: ModelRecord): boolean {
    return ROW_FILTER_TITLES.has(record.get('title') as string);
}
```

Two existing call sites pick a record by its position in the store's view — the
row `key` starts from ([`:108`](packages/qa/src/panels/table-rows.ts#L108)) and
the row `update=record` rescores
([`:69`](packages/qa/src/panels/table-rows.ts#L69)). Under a row filter a
position in the view is not a rendered row, so both go through `admittedAt`,
which counts only admitted records:

| `admits` | `index` | Returns |
|---|---|---|
| `null` | 3 | `store.getAt(3)` — one call, exactly today's expression |
| the predicate | 0 | the 1st admitted record: view position 0 (`Engineer`) |
| the predicate | 3 | the 4th admitted record: view position 6 (`Manager`) |
| the predicate | 3, in a view with 2 admitted records | the last admitted record |

`admittedAt` walks the view with `getAt` rather than filtering a copy of it, so
it adds no whole-view pass of its own to a phase it is called in.

### The body-filter witness (`table-rows.ts`)

`Table` pushes the predicate to `Body` only in `"normal"` display mode, and
composes it with any quick search first
([`Table.applyRowVisible`](packages/lib/src/typescript/lib/component/table/Table.ts#L676)),
so the panel reports what the body ended up holding rather than what it passed
in. It reads the body's own field, as `markdown-doc` reads the viewer's tracker
([`markdown-doc.ts:163`](packages/qa/src/panels/markdown-doc.ts#L163)):

```typescript
function hasRowFilter(body: object): boolean {
    return typeof (body as unknown as { _rowVisible?: unknown })._rowVisible === 'function';
}
```

### The new ablation (`ablations.ts`)

```typescript
function g21VisibleMemo(tools: HarnessTools): string {
    const name = 'g21.visible-memo';
    const body = tools.findComponent('TableBody');

    if (!body) {
        return 'no TableBody';
    }

    memoiseVisibleRecords(tools, name, tools.ownerProto(body, 'getVisibleRecords')!);

    return 'visible records memoised';
}
```

---

## Ordered Implementation Steps

1. **`packages/qa/src/builders/data.ts` — add `ROW_FILTER_TITLES`.** Place it
   beside `TITLES` ([`:81`](packages/qa/src/builders/data.ts#L81)) as
   `new Set(['Engineer', 'Manager'])`, typed `ReadonlySet<string>`. Its doc
   comment says the two names are the first two of `TITLES`, that `tableRows`
   assigns `TITLES[i % TITLES.length]`
   ([`:225`](packages/qa/src/builders/data.ts#L225)), and that the set therefore
   admits exactly two rows in five at every scale.

2. **`packages/qa/tests/builders.test.ts` — pin the fraction and the link to the
   generator.** In `P10 data`, beside the existing `tableRows` case
   ([`:87`](packages/qa/tests/builders.test.ts#L87)), add one case: every member
   of `ROW_FILTER_TITLES` appears among `tableRows(20)`'s titles, the set holds
   two of the five distinct titles, and `tableRows(20)` has exactly 8 rows whose
   title is in it. The first assertion is the guard that matters — a renamed
   title would otherwise leave the predicate admitting nothing, and every cell
   would silently measure an empty table.

3. **`packages/qa/src/builders/store.ts` — add `IndexedStore` and
   `admittedAt`.** Signature per `## Public API`, behaviour per the table in
   `## Internal Structure`. With `admits === null` it returns `store.getAt(index)`
   and calls nothing else. Otherwise it walks positions from 0, stops at the
   first position the view does not hold, and returns the `index`-th admitted
   record — or the last admitted one when the view holds fewer, and `undefined`
   when it admits none.

4. **`packages/qa/tests/store.test.ts` — cover `admittedAt`.** Add a
   `P19 admittedAt` describe over a stub `IndexedStore` of ten numbers: a null
   `admits` returns the record at that position; the predicate `k % 5 < 2`
   returns positions 0, 1, 5, 6 for indices 0–3; an index past the admitted
   count returns the last admitted record; a predicate admitting none returns
   `undefined`.

5. **`packages/qa/src/panels/table-rows.ts` — read the parameter and set the
   filter.** Add `ROW_FILTERS`, `admitsFilteredTitle` and `hasRowFilter` per
   `## Internal Structure`. In `build`
   ([`:81`](packages/qa/src/panels/table-rows.ts#L81)) read
   `const rowFilter = choice(params, 'rowfilter', ROW_FILTERS, PANEL);` beside
   the existing `update` read, derive
   `const rowVisible = rowFilter === 'title' ? admitsFilteredTitle : null;`, and
   after `table.setFilterRowVisible(true)`
   ([`:97`](packages/qa/src/panels/table-rows.ts#L97)) call
   `table.setRowVisible(rowVisible)` **only when `rowVisible` is not null**, so
   an `off` run behaves exactly as today's runs do. Extend the two existing
   import statements: `ROW_FILTER_TITLES` from `../builders/data.js`,
   `admittedAt` from `../builders/store.js`, and `type { ModelRecord }` from
   `@jimka/typescript-ui/data`.

6. **`table-rows.ts` — route the two position-based call sites.** Replace
   `store.getAt(Math.min(KEY_START_ROW, n - 1))!`
   ([`:108`](packages/qa/src/panels/table-rows.ts#L108)) with
   `admittedAt(store, rowVisible, Math.min(KEY_START_ROW, n - 1))!`, and
   `store.getAt(index % Math.min(UPDATE_ROW_SPAN, n))!`
   ([`:69`](packages/qa/src/panels/table-rows.ts#L69)) with
   `admittedAt(store, rowVisible, index % Math.min(UPDATE_ROW_SPAN, n))!`. Both
   clamps stay exactly as they are. `updateTarget`
   ([`:61`](packages/qa/src/panels/table-rows.ts#L61)) takes the predicate as a
   fourth parameter, and its one call site
   ([`:101`](packages/qa/src/panels/table-rows.ts#L101)) passes `rowVisible`;
   update its doc comment to say the rescored row is one the row filter
   admits.

7. **`table-rows.ts` — the witnesses and the description.** Extend `describe()`
   ([`:126`](packages/qa/src/panels/table-rows.ts#L126)) with the four fields in
   `## Public API`; `filteredRows` is `store.getCount()` when `rowVisible` is
   null and `store.getRecords().filter(rowVisible).length` otherwise. Add one
   sentence to `description`: `rowfilter=title` sets a body row filter through
   `Table.setRowVisible` that admits two titles in five, so `getVisibleRecords`
   filters the whole store view on every call — the state G21's memo needs and
   no panel had. Leave `defaultScale`, `defaultDrive`, `geometry` and
   `installWork` alone.

8. **`packages/qa/tests/mount.test.ts` — cover the parameter.** In
   `P8 panel parameters` ([`:167`](packages/qa/tests/mount.test.ts#L167)), in the
   shape of the existing `update` case
   ([`:173`](packages/qa/tests/mount.test.ts#L173)): `rowfilter=nope` rejects with
   `table-rows: unknown rowfilter "nope" (expected off, title)` before either
   wait. Then two build-only cases that call `module.build(20, …)` and read
   `describe()` without mounting — `table-rows` cannot mount under jsdom, which
   `JSDOM_GAPS` records ([`:148`](packages/qa/tests/mount.test.ts#L148)) — one per
   mode, asserting the numbers in `## Expected Behaviour` 3 and 4.

9. **`packages/qa/src/harness/ablations.ts` — add `g21VisibleMemo`.** Place the
   function beside `g21RenderPass`
   ([`:1699`](packages/qa/src/harness/ablations.ts#L1699)), body per
   `## Internal Structure`, and register `'g21.visible-memo': g21VisibleMemo` in
   `ABLATIONS` ([`:2659`](packages/qa/src/harness/ablations.ts#L2659)) directly
   after the `g21.render-pass` entry
   ([`:2678`](packages/qa/src/harness/ablations.ts#L2678)), under a comment saying
   it is a later arm isolating one part of a W3.0 group. Change nothing in
   `g21RenderPass` or `memoiseVisibleRecords`.

10. **`packages/qa/tests/ablations.test.ts` — register and exercise the new
    arm.** Add `const LATER_ABLATIONS = ['g21.visible-memo'];` beside
    `EARLIER_ABLATIONS` ([`:203`](packages/qa/tests/ablations.test.ts#L203)) and
    include it in `A1`'s expected registry
    ([`:208`](packages/qa/tests/ablations.test.ts#L208)); leave
    `expect(W3_ABLATIONS).toHaveLength(26)` as it is, since the new arm is not a
    W3.0 arm. Add `'g21.visible-memo'` to `ABSENT_ON_CANVAS_IDLE`
    ([`:216`](packages/qa/tests/ablations.test.ts#L216)). Add an
    `A30 g21.visible-memo` describe modelled on `A17`'s first assertions
    ([`:799`](packages/qa/tests/ablations.test.ts#L799)): after mounting
    `treetable-rows` and applying the arm, two `getVisibleRecords` calls return
    the same array and `memo.g21.visible-memo.visibleHit` is at least 1, while
    `skipped.g21.visible-memo.focusSweep` and
    `skipped.g21.visible-memo.requiredEmpty` never appear.

11. **`packages/qa/README.md` — record the parameter and the arm.** Three edits,
    written out in `## Documentation Impact`.

12. **`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` —
    correct two sentences.** In the *Judged again* section, the claim at
    `:953-954` that the unfiltered branch "hands back the store's own array,
    allocating nothing" and the figure at `:961-962` of "22 calls a unit,
    220,000 predicate calls and 22 array allocations". Replacement text in
    `## Documentation Impact`.

13. **Check the package.**

    ```sh
    npm -w packages/qa run typecheck
    npm -w packages/qa run test
    grep -c 'memoiseVisibleRecords' packages/qa/src/harness/ablations.ts   # 3: one definition, two callers
    ```

    Three occurrences means the new arm calls the existing helper rather than
    carrying a second copy of the memo.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/builders/data.ts` |
| Modify | `packages/qa/src/builders/store.ts` |
| Modify | `packages/qa/src/panels/table-rows.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/tests/builders.test.ts` |
| Modify | `packages/qa/tests/store.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |

---

## Expected Behaviour

Unit-testable in the package's own vitest suite. jsdom lays nothing out and
`table-rows` cannot mount there, so every case below reads `build()`,
`describe()` or a stub store:

1. `rowfilter=nope` rejects with
   `table-rows: unknown rowfilter "nope" (expected off, title)`, before either
   mount wait.
2. An absent `rowfilter=` behaves as `off`.
3. At `n = 20` and `rowfilter=off`: `describe()` gives `rowFilter` `off`,
   `storeRecords` 20, `filteredRows` 20 and `bodyRowFilter` `false`.
4. At `n = 20` and `rowfilter=title`: `describe()` gives `rowFilter` `title`,
   `storeRecords` 20, `filteredRows` 8 and `bodyRowFilter` `true`.
5. Every member of `ROW_FILTER_TITLES` is a title `tableRows` produces, and the
   set holds two of the five distinct titles.
6. `admittedAt(store, null, index)` returns `store.getAt(index)` for an index
   inside and outside the view.
7. `admittedAt` with a predicate returns the `index`-th admitted record, the
   last admitted record for an index past the admitted count, and `undefined`
   when none is admitted.
8. `g21.visible-memo` serves a second `getVisibleRecords` call from the memo and
   raises `memo.g21.visible-memo.visibleHit`. It raises no
   `skipped.g21.visible-memo.*` counter: it applies neither of
   `g21.render-pass`'s other two patches.
9. `g21.visible-memo` notes `no TableBody` on a panel that mounts none.
10. `g21.render-pass` is unchanged: `A17` still passes as written.

Verified only in the engine, by the cells in `## Verification`:

11. The row filter reaches the body and admits a middling fraction:
    `host.bodyRowFilter` is `true`, and `host.filteredRows` is 4,000 against
    `host.storeRecords` 10,000 (360 against 900 in the small cell).
12. The plain arm pays the filter on every call: `getVisibleRecords@TableBody`
    is six to seven per unit in both phases, and `getRecords@MemoryStore` is at
    least as large, since every visible-records call reaches the store.
13. The arm collapses the second counter only: `getVisibleRecords@TableBody` is
    unchanged, `getRecords@MemoryStore` falls to about one per unit or less, and
    `memo.g21.visible-memo.visibleHit` accounts for the difference.
14. Geometry is `=` on `table`, `header`, `body` and `cell` in both phases of
    both cells.

---

## Verification

```sh
npm -w packages/qa run typecheck
npm -w packages/qa run test
```

The two cells below open a full-screen window per run and must be run by the
user, in one sitting, in this order. They follow the sweep's scored-cell shape —
`plain-a`, the arm, `plain-b`, the arm again, `plain-c` — and its run-name
grammar, so `qa-ab.py` reads each cell from its prefix.

```sh
FLAGS='work=1&seam=1&geom=1'
P='panel=table-rows&rowfilter=title&update=record&drive=key,passes'
```

### One discarded warm-up run first

```sh
packages/qa/runqa.sh w6warm-trv main "$P&$FLAGS"      # discarded; not part of any cell
```

A cold first run at this scale has read 97.69 ms against 31–36 for the rest of
its sitting. That opens a bracket — the spread between a cell's fastest and
slowest plain run, which an arm's saving has to clear — wide enough to swallow any
saving. The warm-up's name shares no prefix with either cell, so neither analyser sees
it.[^warm]

### Cell `trv` — the memo at n = 10,000

```sh
packages/qa/runqa.sh w6a-trv-plain-a                main "$P&$FLAGS"
packages/qa/runqa.sh w6a-trv-g21.visible-memo-1     main "$P&$FLAGS&abl=g21.visible-memo"
packages/qa/runqa.sh w6a-trv-plain-b                main "$P&$FLAGS"
packages/qa/runqa.sh w6a-trv-g21.visible-memo-2     main "$P&$FLAGS&abl=g21.visible-memo"
packages/qa/runqa.sh w6a-trv-plain-c                main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w6a-trv- --work \
    --before host.storeRecords,host.filteredRows,host.bodyRowFilter
python3 packages/qa/bin/qa-ab.py packages/qa/results w6a-trv- \
    --counter 'work.getRecords@MemoryStore' --same 'work.getVisibleRecords@TableBody'
```

### Cell `t9v` — the same cell at n = 900

```sh
P9="$P&n=900"
packages/qa/runqa.sh w6a-t9v-plain-a                main "$P9&$FLAGS"
packages/qa/runqa.sh w6a-t9v-g21.visible-memo-1     main "$P9&$FLAGS&abl=g21.visible-memo"
packages/qa/runqa.sh w6a-t9v-plain-b                main "$P9&$FLAGS"
packages/qa/runqa.sh w6a-t9v-g21.visible-memo-2     main "$P9&$FLAGS&abl=g21.visible-memo"
packages/qa/runqa.sh w6a-t9v-plain-c                main "$P9&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w6a-t9v- --work \
    --before host.storeRecords,host.filteredRows,host.bodyRowFilter
python3 packages/qa/bin/qa-ab.py packages/qa/results w6a-t9v- \
    --counter 'work.getRecords@MemoryStore' --same 'work.getVisibleRecords@TableBody'
```

### Before either verdict

The table must show `bodyRowFilter` `true` and `filteredRows` well below
`storeRecords` in every run of both cells. If `bodyRowFilter` is `false` the
predicate never reached the body and the cells say nothing about the candidate.
`getVisibleRecords@TableBody` must also be equal in the plain and arm runs — the
`--same` gate — and `memo.g21.visible-memo.visibleHit` above 0 in both arm reps.

### Reading the two cells together

The arm removes all but the first of each unit's filter passes, so its saving is
proportional to the store's size: at n = 900 it should be about an eleventh of
the saving at n = 10,000.

| `trv` (n = 10,000) | `t9v` (n = 900) | Reading |
|---|---|---|
| `win` | `flat`, or a win about an eleventh the size | The O(n) filter is the cost. The memo is a time win and earns a plan. |
| `flat` | `flat` | Filtering 10,000 records six times a unit costs nothing measurable on this engine. G21's memo closes for good, on the surface it was owed. |
| `win` | `win` of about the same size | The cell is measuring session drift, not the arm. Re-run the sitting. |
| `regress` | either | Read the geometry note below first; a real regress voids the candidate. |

`work.getRecords@MemoryStore` will read `win` in every case — it falls from about
six per unit to about one. The campaign's standing rule puts render time first
and work second, and ships a work reduction with a flat clock unless it costs
considerable code complexity, so that half of the question is already settled:
the milliseconds are the new information.

### Reading a geometry `DIFF`

If a phase reports `DIFF(focused)` or `unstable(focused)` while `table`,
`header`, `body` and `cell` are `=`, re-read that cell with
`--allow-diff focused` and record that the known-flaky focus probe, not the arm,
opened it: the same arms read `=` on `focused` at n = 900 and `DIFF` at
n = 10,000 in the sitting of 2026-09-26, and `treetable-rows` showed the same
([`00-post-campaign-agenda.md`, *G21 closed*](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L848)).
A `DIFF` on `cell`, `table`, `header` or `body` is not that, and voids the cell.

### By eye

Under `npm -w packages/qa run dev` (which opens no window of its own), open
`http://localhost:5190/?panel=table-rows&rowfilter=title&n=200`. Every rendered
row's **title** cell must read `Engineer` or `Manager`, the filter row must still
be shown, and the scrollbar must show a shorter document than the same URL with
`rowfilter=off`.

---

## Documentation Impact

`packages/qa/README.md` is the QA app's only reference. Three edits:

- The *URL parameters* table's panel-parameter row
  ([`:186`](packages/qa/README.md#L186) onwards): add `rowfilter=` to the list of
  parameter names beside `update=` and `click=`.
- The *Panels* table's `table-rows` row
  ([`:230`](packages/qa/README.md#L230) onwards): add
  `rowfilter=` `off`, `title` (a body row filter admitting two titles in five,
  through `Table.setRowVisible`) to its *Drivers and parameters* cell, and name
  the four new `describe()` fields there. Leave its *Reproduces* and *Validated*
  cells alone — this plan records no figure.
- *Built-in ablations* ([`:444`](packages/qa/README.md#L444)): below the W3.0
  arms table, whose caption covers W3.0 only, add a one-line lead and a
  single-row table for `g21.visible-memo` — G21, "only the visible-record memo of
  `g21.render-pass`, so a cell can attribute the group's time to that part
  alone".

`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`, *Judged
again*, two corrections:

- At `:953-954`, "with no row filter set it hands back the store's own array,
  allocating nothing" becomes: with no row filter set it hands back
  `store.getRecords()`, which is `this._records.slice()`
  ([`AbstractStore.ts:652`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L652)) —
  a fresh n-element copy per call, not the store's own array. So the unfiltered
  memo already removed one n-element allocation per avoided call at n = 10,000,
  and read flat.
- At `:961-962`, "at n=10,000 and 22 calls a unit, 220,000 predicate calls and 22
  array allocations per unit" becomes: 22 is the phase's whole work counter, not
  the call count; `getVisibleRecords@TableBody` is six to seven per unit, so the
  filter runs 60,000 to 70,000 predicate calls a unit at n = 10,000.

Nothing in `packages/lib/llms.txt` or the library docs changes: no library symbol
moves.

---

## Potential Challenges

- **The `focused` geometry probe is flaky at n = 10,000.** The contingency is
  written into `## Verification`: re-read with `--allow-diff focused` when the
  four stable labels agree, and void the cell when they do not.
- **A memo that served a stale list would be invisible to geometry.** A wrong
  record bound to the same rectangle changes text, not a box. The arm's key is
  the store's records array and the body's predicate, and the panel's predicate
  is a single module-level function, so the only way to serve a stale list is an
  in-place mutation of `_records` — which the library never does. The `--same`
  gate on the call count catches a changed control flow; nothing in this cell
  catches an in-place mutation, and a real fix has to own that
  question.[^mutation]
- **`table-rows` cannot mount under jsdom.** Every new case reads `build()`,
  `describe()` or a stub store; none mounts the panel.
- **`describe()` calls the counted `store.getRecords()` once.** It runs before the
  first phase, and `startCounting` clears every counter at the start of each
  phase, so the call lands in no phase's tally.
- **A tiny `n` admits fewer records than a call site asks for.** `admittedAt`
  clamps to the last admitted record, so `P8`'s `n = 3` build still selects and
  rescores a real row.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/qa/README.md`](packages/qa/README.md) | The panel contract, the parameter rules, the ablation naming scheme and the measurement rules. |
| [`packages/qa/src/panels/table-rows.ts`](packages/qa/src/panels/table-rows.ts) | The panel being extended: its parameter read, its two position-based call sites, its geometry labels and its work counters. |
| [`packages/qa/src/builders/store.ts`](packages/qa/src/builders/store.ts) | Where `admittedAt` goes, beside `awaitStoreView`, and the structural-interface style it follows. |
| [`packages/qa/src/builders/data.ts`](packages/qa/src/builders/data.ts) | `TITLES` and `tableRows`: what `ROW_FILTER_TITLES` must stay in step with. |
| [`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts) | `g21RenderPass` and `memoiseVisibleRecords`: the arm being split, and the memo key the panel's predicate must not break. |
| [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) | `getVisibleRecords` (`:502`), `setRowVisible` (`:813`) and `renderWindow`'s unmounted early return (`:1126`). |
| [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) | `setRowVisible` (`:551`), `composeRowVisible` (`:660`) and `applyRowVisible` (`:676`): what the body actually receives. |
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts) | `getRecords` (`:652`) copies the view, and `getAt` (`:686`) indexes it. |
| [`plans/implemented/qa-surfaces-for-stalled-candidates.md`](plans/implemented/qa-surfaces-for-stalled-candidates.md) | The direct precedent: a plan that adds surfaces and writes the cells out for the user. |
| [`plans/implemented/w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md) | The scored-cell shape, the decision rule, the counter-expression grammar and `g21.render-pass`'s specification. |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) | The measurements this cell follows, the standing rule it is judged under, and the two sentences step 12 corrects. |

---

## Non-Goals

- **Deciding G21.** The plan builds the surface and says what each outcome
  means; the runs and the verdict are the user's.
- **The memo itself, or any other library change.** A candidate that wins here
  becomes its own plan.
- **G21's reopened `applyRequiredEmptyState` guard.** A row filter does not
  change how often that method runs, so these cells cannot price it; it needs its
  own arm and its own cell.
- **`setQuickSearch` as a second `rowfilter` value.** Quick search is the
  library's own row-filter consumer and is equally unmeasured, but it caches each
  record's searchable text in a `WeakMap`
  ([`Table.ts:136`](packages/lib/src/typescript/lib/component/table/Table.ts#L136)),
  so its per-pass cost is a map lookup per record rather than a field test — a
  different candidate, worth its own cell.
- **A row filter on `treetable-rows`.** `TreeBody.getVisibleRecords` never
  consults `_rowVisible`, which its own docs state
  ([`TreeBody.ts:506`](packages/lib/src/typescript/lib/component/table/TreeBody.ts#L506)),
  so a predicate set there would change nothing.
- **A sweep script.** Two cells of five runs are written out;
  `sweeps/w3-0.sh` is pinned by `tests/sweep.test.ts` and belongs to W3.0.
- **Repairing the `focused` probe or `table-rows`' `wheel` phase.** Both are
  known surface defects with their own entries in the agenda; this plan avoids
  the wheel and declares the focus label's contingency.

---

## Notes

[^slice]: The agenda's stated reason for closing the memo — that the unfiltered
    branch "hands back the store's own array, allocating nothing" — is wrong on
    the allocation. `Body.getVisibleRecords` calls `this._store.getRecords()`,
    and `AbstractStore.getRecords` returns `this._records.slice()`
    (`AbstractStore.ts:652-654`); `MemoryStore` does not override it. So even
    with no row filter the method allocates one n-element copy per call, and the
    memo that read flat at n = 10,000 was already removing five or six such
    copies a unit. That matters for what these cells isolate: bulk-copying
    10,000 element slots is provably free on this engine, so whatever the new
    cells show above flat is the predicate calls and the shorter filtered build —
    a different cost class, and the one that has never been measured. The
    measured verdict in the record stands; only its explanation changes.

[^parameter]: The README's own rule decides it: "A panel id fixes the component
    tree. URL parameters such as `grip=` only choose which element or which
    mutation a driver gets ... Two trees are two panel ids, built by one shared
    builder." A row filter changes which records bind to a fixed-size row pool,
    not the tree, and at 40% of 10,000 or 900 rows the admitted list still far
    exceeds the scroll window, so the pool stays full and the census is
    unchanged. `update=filter` is the in-panel precedent for a parameter that
    changes which records render. A separate panel would copy the 12-field
    model, the column list, the selection, the header-cell lookup, the geometry
    labels and the work counters — about 120 lines — and would arrive with no
    baseline of its own, so nothing could be compared against `table-rows`'
    recorded figures. The default stays `off` precisely so those figures, and
    M8's `getVisibleRecords@TableBody` 6.00 per key unit, keep meaning what they
    meant.

[^predicate]: Three constraints pick the field. It must be one no driver on this
    panel writes, which rules out `score` (`update=record`), `department`
    (`update=filter`) and `name` (the sort `click`). It must survive the store
    filter: `tableRows` assigns `DEPARTMENTS[i % 6]` and `TITLES[i % 5]`, and 5
    and 6 are coprime, so within any one department the titles still cycle
    through all five and the predicate still admits two in five. A predicate on
    `id` parity would have failed that test outright — 6 is even, so one
    department holds one parity, and the row filter would have admitted all of a
    department-filtered view or none of it. And it must be representative rather
    than minimal: `record.get(field)` plus a `Set` lookup is what a consumer's
    predicate costs, where an integer modulo would be the cheapest possible one
    and would make a flat reading say nothing about real consumers. The admitted
    fraction is not a compromise on the cost being measured: the predicate runs
    for every record whatever the fraction, so 2/5 buys a middling rendered row
    count at the same per-pass predicate cost as a fraction near 1, while
    staying far from "nearly all" and "nearly none".

[^compose]: Mechanically the two filters are independent: the store filter
    narrows `_records`, and the body's predicate then filters what
    `getRecords()` returns. Rejecting the combination would be the panel
    inventing a rule the library does not have. It is uninformative for *this*
    candidate, because a department view is a sixth of the store and the O(n)
    filter then runs over a sixth as many records — which is why the cells drive
    `key` and `passes` and never `update`. `host.storeRecords` puts the size the
    predicate actually ran over in the report, so a cell run with both set
    reports its own weakness instead of hiding it.

[^own-arm]: The bundled `g21.render-pass` would give the wrong answer for the
    right reason. Its `engaged` test sums every `skipped.*` and `memo.*` counter
    it owns, and `skipped.g21.render-pass.requiredEmpty` alone runs about 107
    times a unit on this panel — so the bundle reads `engaged yes` even in a run
    where the memo never hit once, and its Δms mixes the memo with two parts
    already measured at −0.87 and +0.05 on a 2.77 bracket. A one-part arm makes
    engagement mean "the memo hit" and Δms mean "the memo's time". The name is
    the one the throwaway split used on 2026-09-26, which was measured and not
    kept, so the record and the registry now agree.

[^phases]: `key` and `passes` are the two phases that can resolve the effect.
    Both were flat for every G21 arm at a bracket of 0.05 in the attribution
    sitting, which is the tightest signal-to-noise the panel offers, and
    `passes` units are about 2.3 ms, so six filter passes over 10,000 records
    roughly double them — the largest relative effect available. `update` is the
    worst of the three: 35 ms units on a 2.77 bracket, and it is the phase whose
    earlier −2.2 ms reading turned out to be where its reps fell in the sitting.
    `wheel` is excluded because every wheel phase on this panel voids on
    `geom unstable(cell,focused)` in the plain arm. The scale pair is the second
    half of the reading: everything about the candidate that was already
    measured was identical at n = 900 and n = 10,000, because the table is
    virtualised and the window is fixed, and the row filter is the first thing
    on this panel whose cost is proportional to the store. If the two cells do
    not separate, the cell measured drift.

[^no-settle]: G16, G22 and G25 needed a trailing `idle:4` phase because each
    defers work inside a burst, so their mid-burst rectangles differ by design
    and only the settled state can be gated. A memo defers nothing: every unit
    renders the same window from the same records, so every unit's geometry is
    comparable and the mid-burst exception does not apply.

[^gate]: Because the ablations are installed before the work counters, the
    panel's `countMethod` wrapper sits outside the memo and counts every call,
    hit or miss. So `work.getVisibleRecords@TableBody` is the body's own demand
    for the list, which the memo must not change, while
    `work.getRecords@MemoryStore` is the number of times that demand reached the
    store and paid for a copy and a filter — which is what the arm collapses.
    One counter is the gate and the other is the score, from the same pair the
    panel already installs.

[^warm]: Two traps are on record for this panel at this scale, and the cell
    shape answers one of them on its own. The mirrored order
    (`plain-a`, arm, `plain-b`, arm, `plain-c`) spreads the arm's reps through
    the sitting, which is what turned a −2.22 "win" back into −0.30 when the
    same bundle was re-run with its reps spread rather than clustered. The cold
    start is the other: one plain rep came in at 97.69 ms against 31.69, 35.00
    and 36.54 for the rest, a 66.00 bracket from a single run. A discarded
    warm-up is cheaper than discovering it inside a scored cell. `qa-ab.py`
    reads every `<prefix>*.json` and derives each arm from the file name, so a
    warm-up named inside a cell's prefix would be read as an arm called `warm`
    and would fail the run-name check — hence a name that shares no prefix with
    either cell.

[^mutation]: `getRecords()` returning a copy means a caller may mutate the array
    it gets back today with no consequence. Under the memo two callers would
    share one array, so "no caller mutates the returned array" — checked once for
    W3.0's ablation — stops being an observation and becomes a rule the fix has
    to keep. That is a question for a G21 plan, not for these cells, which read
    an arm whose own predicate and store view are fixed for the length of a run.
