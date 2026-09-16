# AutoCompleteField Store Query and Timer Lifecycle — Implementation Plan

## Overview

`AutoCompleteField` can draw its suggestions from an `AbstractStore` the application owns. Today it gets them by **rewriting that store**: the store branch of `querySuggestions` calls `store.clearFilter()` and then `store.filterBy(...)` on every debounced keystroke ([AutoCompleteField.ts:629-651](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L629-L651)). `clearFilter()` deletes every filter the application set; `filterBy` installs the field's own and never removes it. Each pair of calls emits two `filterchange` and two `datachange` events, so every other `List`, `Table`, or chart bound to the same store rebuilds twice per keystroke. The answer is then read with `store.getRecords()` ([:644](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L644)) on the synchronous side of a view rebuild that is not always synchronous. This plan makes the field compute its suggestions itself and never write to the store.

The same file leaks two timers past disposal. A 200 ms keystroke debounce ([:506-509](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L506-L509)) is cleared only by the next keystroke, and a 150 ms blur timer ([:567-578](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L567-L578)) does not even store its id. Both use the bare global `setTimeout`, and `destructor` clears neither ([:714-718](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L714-L718)). A field disposed while the user is typing — a closed dialog, a torn-down form — therefore fires a callback up to 200 ms later against a dropdown whose DOM handles the disposal already released, and `HandleRegistry.resolve` throws by design on a released handle ([DOM.ts:235-248](packages/lib/src/typescript/lib/core/DOM.ts#L235-L248)). This plan stores both ids, routes both through the DOM seam, and clears both on disposal.

Everything changes inside one source file, `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts`. No public signature changes and no new exported symbol.

---

## Architecture Decisions

### The field matches suggestions in-process and never writes to the store

`querySuggestions`'s store branch builds a `FilterDescriptor`, walks `store.getAll()`, and keeps the records that `matchesFilter(record, descriptor)` accepts. `store.clearFilter()`, `store.filterBy(...)`, and `store.getRecords()` all go. This mirrors how the store itself rebuilds its own view — `AbstractStore.applyView` evaluates each active descriptor with the same `matchesFilter` ([AbstractStore.ts:1913-1917](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1913-L1917)), and `StoreWorker` does the same off-thread ([StoreWorker.ts:67](packages/lib/src/typescript/lib/data/StoreWorker.ts#L67)). The field runs that one evaluator over its own copy instead of asking the store to run it over the shared view.[^why-matchesfilter]

It also brings the field in line with how every other component in this library consumes a store it does not own. `ComboBox.setStore` ([ComboBox.ts:1256-1284](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L1256-L1284)) and `AbstractSelectableList.setStore` ([AbstractSelectableList.ts:1360-1381](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1360-L1381)) subscribe and read; neither writes. `AutoCompleteField` is the only component in the library that mutates a caller's store, and `Header`'s filter-row writes ([Header.ts:1448](packages/lib/src/typescript/lib/component/table/Header.ts#L1448)) are not a counter-example: changing the table's view *is* what a table filter row is for.[^rejected-setfilter]

### Matching runs over every record in the store, not the store's current view

`store.getAll()` returns every record, ignoring active filters and sorting; `store.getRecords()` returns the filtered, sorted view ([AbstractStore.ts:639-650](packages/lib/src/typescript/lib/data/AbstractStore.ts#L639-L650)). The field reads `getAll()`.[^why-getall]

### The descriptor the field already builds is reused unchanged

The store branch already derives a `caseSensitive` flag and a `'contains'` / `'startsWith'` type from `matchMode`, and passes them straight to `filterBy`. That object is a valid `FilterDescriptor` today, so it becomes the argument to `matchesFilter` with no change to how it is built. The mapping stays exactly what it is now:

| `matchMode` | Descriptor `type` / `caseSensitive` | Query `'An'` over `Apple`, `Banana`, `Ant` |
|---|---|---|
| `contains` (default) | `contains` / `false` | `Banana`, `Ant` |
| `startsWith` | `startsWith` / `false` | `Ant` |
| `containsCaseSensitive` | `contains` / `true` | `Ant` |
| `startsWithCaseSensitive` | `startsWith` / `true` | `Ant` |

### Server-side filtering is dropped, because it never reached the dropdown

With `remoteFilter: true`, or with server-side paging configured, `filterBy` triggers a reload after the local view rebuild resolves ([AbstractStore.ts:1606-1622](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1606-L1622)). `querySuggestions` reads and shows its answer before that reload is even started, and the field subscribes to no store event, so the server's filtered result never becomes a suggestion. What a remote-configured store gets today is the cost of the round trip and none of its benefit.[^remote-never-worked]

| Store configuration | Today | After this change |
|---|---|---|
| In-memory, under 1,000 records | App's filters wiped, field's filter left installed, 4 events per keystroke; suggestions correct | No store writes, no events; same suggestions |
| 1,000 or more records, worker available | Same writes; `getRecords()` is read before the off-thread rebuild lands, so the suggestions shown are the previous query's | No store writes; suggestions computed from the record list, which is always current |
| `remoteFilter: true` | Same writes, plus a reload whose server-filtered answer arrives after the suggestions have already been shown, and is never displayed | No writes, no network request; suggestions match over the records already loaded |
| `pageSize` set | Same writes, plus a reset to page 1 and a reload — any other view bound to the store jumps back to page 1 mid-typing | No writes, no page reset, no reload; suggestions match over the loaded page |

A store-backed field therefore suggests from the records the store currently holds. Giving the field a genuine server-query capability needs its own opt-in store API that returns a promise without touching the shared view; it is not in this plan.[^no-store-api]

### Both timers are routed through the DOM seam **and** cleared in `destructor`

Both changes are needed, because each closes a path the other leaves open: routing through the seam is what lets `DOM.reset()` disarm a timer that is still pending, and the `destructor` clear is what stops a disposed field's timer from firing in a running application.[^seam-and-destructor] Routing follows the rule the seam documentation already states: a bare `setTimeout` is not itself a lint violation — `local/no-raw-dom` does not cover timers — but a *deferred callback that will write to an element* belongs on `DOM.sink.setTimeout` / `DOM.sink.clearTimeout` ([dom-seams.md:69-71](packages/lib/docs/concepts/dom-seams.md#L69-L71)). Both of these callbacks do: the debounce ends in `showSuggestions`, which shows the dropdown, and the blur callback reads the active element and hides the dropdown. `Animation` ([Animation.ts:191-192](packages/lib/src/typescript/lib/core/Animation.ts#L191-L192)) and `FirstLayoutGate` ([FirstLayoutGate.ts:70](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L70), [:80-87](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L80-L87)) are the two existing call sites and the shape to copy, down to the `TimerId | null` field type and the null-check-clear-null idiom.

Clearing follows `Header.destructor` ([Header.ts:1746-1757](packages/lib/src/typescript/lib/component/table/Header.ts#L1746-L1757)), which clears its pending filter timer and nulls the field before running the inherited teardown. `StatusBar` and `MenuItem` use the identical shape.

### Each blur clears the pending blur timer before arming a new one

Two blurs in quick succession currently arm two independent timers. Once the id is stored in a single field, the second arm would overwrite the first id and make that first timer unclearable — which is the leak this plan exists to close. So clearing before arming is part of the fix, not tidying.[^blur-clear-first] `onInput` already has this shape; `onBlur` gains it.

---

## Internal Structure

### The store branch of `querySuggestions`

Replaces [AutoCompleteField.ts:636-646](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L636-L646) — the two store mutations and the `getRecords().map().slice()` read. The `caseSensitive` / `filterType` derivation above it ([:630-634](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L630-L634)) and the `query === this.getValue()` staleness guard below it ([:648-650](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L648-L650)) are unchanged.

```typescript
const descriptor: FilterDescriptor = {
    type: filterType,
    field: displayField,
    value: query,
    caseSensitive,
};

const results: string[] = [];

for (const record of store.getAll()) {
    if (results.length >= maxSuggestions) {
        break;
    }

    if (matchesFilter(record, descriptor)) {
        results.push(String(record.get(displayField)));
    }
}
```

The cap is checked before each push rather than applied as a trailing `slice`, so a large store stops as soon as it has enough matches.

### The timer fields and the module constant

```typescript
// Grace period between the inner field losing focus and the dropdown hiding.
// A mouse-down on a suggestion blurs the input before the dropdown's own click
// handler runs, so hiding on the blur itself would pull the row out from under
// the cursor and swallow the pick. Carried over unchanged from the inline
// literal it replaces: it has to outlast a browser's blur → mouseup → click
// sequence, and it is invisible to a user who is genuinely leaving the field.
const BLUR_HIDE_DELAY_MS = 150;
```

```typescript
private _debounceTimer : TimerId | null = null;
private _blurTimer     : TimerId | null = null;
```

`TimerId` (exported from `core/DOM.ts`) is the same type as the current `ReturnType<typeof setTimeout>`; switching to it leaves the file naming no global timer API at all.

### `onBlur` and `destructor`

```typescript
private onBlur(): void {
    if (this._blurTimer !== null) {
        DOM.sink.clearTimeout(this._blurTimer);
        this._blurTimer = null;
    }

    this._blurTimer = DOM.sink.setTimeout(() => {
        this._blurTimer = null;

        const active = DOM.source.getActiveElement();
        const dropEl = this._dropdown.getElement();

        if (dropEl && DOM.source.contains(dropEl, active)) {
            return;
        }

        this._dropdown.hide();
    }, BLUR_HIDE_DELAY_MS);
}
```

```typescript
protected destructor(): void {
    if (this._debounceTimer !== null) {
        DOM.sink.clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
    }

    if (this._blurTimer !== null) {
        DOM.sink.clearTimeout(this._blurTimer);
        this._blurTimer = null;
    }

    this._dropdown.dispose();

    super.destructor();
}
```

`onInput` keeps its existing structure and changes only in three places: its clear becomes `DOM.sink.clearTimeout` and nulls the field, its arm becomes `DOM.sink.setTimeout`, and its callback nulls `_debounceTimer` before calling `querySuggestions(current)`.

---

## Ordered Implementation Steps

This plan carries **two functionalities**, so it produces **two code commits** — the store query (steps 1–6) and the timer lifecycle (steps 7–12) — followed by the documentation commits (step 13). Neither code commit depends on the other; keep them separate even though they edit the same file.

The project works test-first: in each half, the test step comes before the source step and its cases must fail for the right reason before the source changes.

1. In `packages/lib/tests/component/input/AutoCompleteField.test.ts`, add a `describe('AutoCompleteField store-backed suggestions')` block covering `## Expected Behaviour` cases 1–13. Build the store with `new MemoryStore(MODEL, rows)` followed by `store.loadData(rows)`, mirroring `makeStore` in [ComboBox.test.ts:26-31](packages/lib/tests/component/input/ComboBox.test.ts#L26-L31). Drive a query with `field.setValue(q)` then `(field as any).querySuggestions(q)`, and read the result from `vi.spyOn(dropdown, 'show')` / `vi.spyOn(dropdown, 'hide')`, mirroring the paste-debounce block at [:200-227](packages/lib/tests/component/input/AutoCompleteField.test.ts#L200-L227). Use `beforeEach(() => installTestDOM(CONFIG))` and an `afterEach` that disposes the field and calls `DOM.reset()`, as the two existing blocks at [:161](packages/lib/tests/component/input/AutoCompleteField.test.ts#L161) and [:200](packages/lib/tests/component/input/AutoCompleteField.test.ts#L200) do.
2. In the same file, amend the header comment's last sentence ([:6](packages/lib/tests/component/input/AutoCompleteField.test.ts#L6)) — it currently declares the store path out of scope, which the new block contradicts.
3. Run `npm -w packages/lib run test -- AutoCompleteField` and confirm the new cases fail.
4. In `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts`, add `import { FilterDescriptor, matchesFilter } from "~/data/FilterDescriptor.js";` beside the existing `AbstractStore` import at [:6](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L6).
5. Replace the store branch's body per `## Internal Structure`, deleting the `clearFilter` / `filterBy` / `getRecords` calls.
6. Update two JSDoc strings in the same file, so the code commit does not ship a comment its own change falsified: the `store` field of `AutoCompleteFieldOptions` ([:73](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L73)) drops "remote/", and `setStore`'s `@param store` ([:359](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L359)) changes from "The data store to filter." to "The data store to read suggestions from." Describe the in-process matching in prose — `matchesFilter` is not re-exported from `data/index.ts`, so public JSDoc may not `{@link}` it (see `CODE_CONVENTIONS.md`). Then check: `grep -n 'clearFilter(\|filterBy(\|getRecords(' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` — expect zero matches; `npm -w packages/lib run typecheck`; `npm -w packages/lib run test -- AutoCompleteField` — all green. **Commit 1.**
7. In the test file, add a `describe('AutoCompleteField timer teardown')` block covering cases 14–19, using `vi.useFakeTimers()` as the paste-debounce block does.
8. Run the tests and confirm the new cases fail.
9. In `AutoCompleteField.ts`, add `import type { TimerId } from "~/core/DOM.js";` directly below the existing `DOM` import ([:5](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L5)), matching [Animation.ts:5-6](packages/lib/src/typescript/lib/core/Animation.ts#L5-L6). Add the `BLUR_HIDE_DELAY_MS` constant at module level beside `AUTOCOMPLETE_FIELD_CHROME` ([:30](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L30)).
10. Retype `_debounceTimer` to `TimerId | null` and add `_blurTimer : TimerId | null = null` beside it ([:126](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L126)). Leave both as ordinary initialised fields — no setter reachable from `applyOptions` writes either, so the `declare` rule in `CODE_CONVENTIONS.md` does not apply.
11. Route `onInput`'s clear and arm through `DOM.sink`, and null `_debounceTimer` inside the callback. Rewrite `onBlur` and `destructor` per `## Internal Structure`. Extend `destructor`'s JSDoc to say it cancels both pending timers before disposing the dropdown.
12. Check: `grep -n 'setTimeout\|clearTimeout' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` — expect exactly six matches (two in `onInput`, two in `onBlur`, two in `destructor`), every one of them prefixed `DOM.sink.`. Then `npm -w packages/lib run typecheck`, `npm -w packages/lib run lint`, and the full `npm -w packages/lib run test`. **Commit 2.**
13. Documentation, per `## Documentation Impact`: the component doc page and one `next.md` bullet for the store change; a second `next.md` bullet for the timer change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | `packages/lib/tests/component/input/AutoCompleteField.test.ts` |
| Modify | `packages/lib/docs/components/AutoCompleteField.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Nothing is created or deleted. `AbstractStore.ts` and `FilterDescriptor.ts` are read but unchanged; `AbstractStore.filterBy` and `clearFilter` stay as they are, since they are public API for applications even once this field stops calling them.

---

## Expected Behaviour

Cases 1–19 are unit-testable in the offline harness. The manual-verify bullets below them are not, because the harness cannot drive a real focus or pointer sequence.

**Store query** — new `describe` block, fixture rows `[{ id: '1', name: 'Apple' }, { id: '2', name: 'Banana' }, { id: '3', name: 'Cherry' }]` unless a case says otherwise:

1. A query leaves the store's filters untouched. With `{ type: 'neq', field: 'name', value: 'Cherry' }` installed before the query, `store.getActiveFilters()` afterwards still deep-equals that single descriptor.
2. A query emits nothing. Counters registered on `datachange` and `filterchange` before the query are both `0` afterwards — asserted after three `await Promise.resolve()` turns, so a deferred emit is caught too.
3. A query does not change the store's view. `store.getRecords().map(r => r.get('name'))` is identical before and after.
4. Suggestions match the typed query: default `contains`, query `'an'` → `show` called once, with `['Banana']`.
5. Suggestions ignore the application's filters. With `{ type: 'neq', field: 'name', value: 'Banana' }` installed, query `'an'` still yields `['Banana']`.
6. `matchMode: 'startsWith'` over `Apple`, `Banana`, `Ant`: query `'An'` → `['Ant']`; query `'nt'` → `show` not called and `hide` called.
7. `matchMode: 'containsCaseSensitive'` over `Apple`, `Banana`, `Ant`: query `'An'` → `['Ant']`; query `'an'` → `['Banana']`, since `Ant` carries a capital `A`.
8. `maxSuggestions` caps the list: 20 rows whose names all contain `'a'`, `maxSuggestions: 3`, query `'a'` → the shown list has length 3 and holds the first three matching records in store order.
9. An empty result hides instead of showing: query `'zzz'` → `hide` called, `show` not.
10. A record whose display field is `null` is not suggested. Rows `[{ id: '1', name: 'Banana' }, { id: '2', name: null }]`, query `'n'` → `['Banana']`, and the string `'null'` appears nowhere in the shown list.
11. A 1,500-record store answers synchronously and correctly: 1,500 rows named `Item 0`…`Item 1499` plus one `Banana`, query `'anan'` → `show` called once, during the `querySuggestions` call itself, with `['Banana']`.
12. A stale query is discarded: `field.setValue('ab')` then `(field as any).querySuggestions('an')` → neither `show` nor `hide` is called.
13. Static suggestions still take precedence: a field given both `suggestions: ['Apricot']` and the store, query `'ap'` → `['Apricot']`, and `store.getActiveFilters()` is unchanged.

**Timer teardown** — new `describe` block, under `vi.useFakeTimers()`:

14. A field disposed mid-typing fires nothing and throws nothing. Arm the debounce (set a value, then `(field as any).onInput()`), spy on `querySuggestions`, `field.dispose()`, `vi.advanceTimersByTime(500)` → no throw, and the spy records no call after the dispose.
15. A field disposed after a blur fires no hide. Arm with `(field as any).onBlur()`, spy on the dropdown's `hide`, dispose, advance 500 ms → no throw and no `hide` call after the dispose.
16. Undisposed behaviour is unchanged: arming the debounce and letting it elapse calls `querySuggestions` exactly once; arming the blur and letting it elapse calls the dropdown's `hide` exactly once when focus is elsewhere.
17. A second blur before the first elapses leaves exactly one pending timer: two `onBlur()` calls, then advance past 150 ms → `hide` called exactly once.
18. Both timers are scheduled through the seam. With `installTestDOM` active, arming each timer appends a `setTimeout` entry to the recording sink's write log ([TestDOM.ts:763-790](packages/lib/tests/dom/TestDOM.ts#L763-L790)); assert one entry appears for the debounce arm and one for the blur arm.
19. The existing paste-debounce test at [:206](packages/lib/tests/component/input/AutoCompleteField.test.ts#L206) passes unchanged — the recording sink's `setTimeout` delegates to the global timer, so `vi.advanceTimersByTime` still drives it.

**Manual-verify**, in the component showcase (`npm run dev`, port 8015, the **Misc.** section's "Type a fruit…" field):

- Typing opens the dropdown after the debounce, as before.
- Clicking a suggestion with the mouse still selects it — that click lands inside the 150 ms blur window, which is the behaviour `BLUR_HIDE_DELAY_MS` exists to preserve.
- Tabbing out of the field still closes the dropdown.
- Typing fast, then immediately navigating away from the section, produces no console error.

---

## Verification

- `npm -w packages/lib run typecheck` — no new errors.
- `npm -w packages/lib run test` — the whole suite, including cases 1–19 and the untouched existing blocks in `AutoCompleteField.test.ts`.
- `npm -w packages/lib run lint` — clean. The seam timer calls are the sanctioned route, so `local/no-raw-dom` has nothing new to report.
- `grep -n 'clearFilter(\|filterBy(\|getRecords(' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` — zero matches.
- `grep -n 'setTimeout\|clearTimeout' packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` — exactly six matches, all prefixed `DOM.sink.`.
- `npm -w packages/lib run docs:api` — finishes with zero warnings; JSDoc was edited.
- The four manual-verify bullets above, in the showcase's **Misc.** section.

---

## Documentation Impact

- `packages/lib/docs/components/AutoCompleteField.md` — the "Store-backed suggestions" section gains a short paragraph: matching runs in the field, over every record the store holds; the store's filters, sort, view, and page are never touched; and no network request is made, so a store-backed field suggests from the records already loaded. The option table's `store` row gains "read-only — the field never filters or reloads it."
- `packages/lib/docs/reference/changelog/next.md` — two bullets under `## Fixed` → `### Components` (the subsection begins at [:318](packages/lib/docs/reference/changelog/next.md#L318)). One for the store change, saying plainly that a store-backed field no longer clears the application's filters or fires store events while the user types. One for the timer change, saying a field disposed while typing or just after losing focus no longer throws.
- No barrel change and no `llms.txt` change: no new exported symbol, and the one-line capability description of `AutoCompleteField` still holds.
- No API-doc page moves. `matchesFilter` stays an internal helper, unreferenced from any public JSDoc.

---

## Potential Challenges

- **`FilterDescriptor` is a discriminated union and `filterType` is a two-member union.** Annotating the object literal as `FilterDescriptor` is the same assignability check the current `filterBy(...)` argument already passes, so it compiles; if it unexpectedly does not, keep the literal inline at the `matchesFilter` call rather than widening the type.
- **`store.getAll()` copies the record array on every query.** For a very large store that is one allocation per debounced keystroke — far cheaper than the view rebuild, event fan-out, and possible network round trip it replaces, and the match loop stops at `maxSuggestions`. Do not add a non-copying accessor to `AbstractStore` for this.
- **The test file's fields must always be disposed.** Its header comment explains that an undisposed field pins a `TextInput` `"input"` registration to a dead DOM and silently breaks the later real-dispatch test. Dispose in `afterEach`, not at the end of an `it` body, so a thrown assertion still releases it.
- **Case 11's 1,500 rows crosses the store's worker threshold.** That is deliberate — it is the configuration where today's synchronous `getRecords()` read can return the previous query's answer. Seed with `store.loadData(rows)`, which populates the record list synchronously regardless of whether the view rebuild offloads.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts) — the only source file changed.
- [packages/lib/src/typescript/lib/data/FilterDescriptor.ts](packages/lib/src/typescript/lib/data/FilterDescriptor.ts) — the descriptor union and `matchesFilter` ([:91](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L91)), including its rule that a nullish field never matches a substring operator.
- [packages/lib/src/typescript/lib/data/AbstractStore.ts:1913-1917](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1913-L1917) — the precedent this plan mirrors: the store's own view rebuild evaluates each descriptor with `matchesFilter`. Read `getAll` / `getRecords` at [:639-650](packages/lib/src/typescript/lib/data/AbstractStore.ts#L639-L650) and `applyFilterChange` at [:1606-1622](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1606-L1622) too.
- [packages/lib/src/typescript/lib/component/table/Header.ts:1746-1757](packages/lib/src/typescript/lib/component/table/Header.ts#L1746-L1757) — the destructor timer-clear precedent.
- [packages/lib/src/typescript/lib/core/FirstLayoutGate.ts](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts) — the smallest complete example of a seam-routed timer: the named `*_MS` constant ([:26](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L26)), the `TimerId | null` field ([:32](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L32)), the arm ([:70](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L70)), and the clear-and-null ([:80-87](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts#L80-L87)).
- [packages/lib/docs/concepts/dom-seams.md:69-71](packages/lib/docs/concepts/dom-seams.md#L69-L71) — the rule that decides which timers go through the seam.
- [packages/lib/src/typescript/lib/core/DOM.ts:235-248](packages/lib/src/typescript/lib/core/DOM.ts#L235-L248) — `HandleRegistry.resolve`, the throw a leaked timer hits; and `DOM.reset` at [:2825-2837](packages/lib/src/typescript/lib/core/DOM.ts#L2825-L2837), which disarms sink-scheduled timers.
- [packages/lib/tests/component/input/AutoCompleteField.test.ts](packages/lib/tests/component/input/AutoCompleteField.test.ts) — the file both new `describe` blocks join.
- [packages/lib/tests/dom/TestDOM.ts:763-790](packages/lib/tests/dom/TestDOM.ts#L763-L790) — the recording sink's timer methods, which record the op and delegate to the global timer.

---

## Non-Goals

- **A real remote-query capability.** Adding one means a new `AbstractStore` API and a new async path in the field; see `## Architecture Decisions`.
- **Subscribing the field to store events.** It queries on demand and has no rendered list to keep in sync between queries, so there is nothing for a `datachange` handler to do.
- **Removing `AbstractStore.filterBy` / `clearFilter`.** Both stay: they are the public filter API for applications, and this change only stops one component from calling them.
- **Fixing the cross-component `Event` listeners at [AutoCompleteField.ts:163-165](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L163-L165).** The composite listens on its own inner `TextField` with inline arrow functions, against two rules in `ARCHITECTURE.md`. That is known debt belonging to the input-surface plan the cell-editor carve-out names; touching it here would collide with that work.
- **Adding a store-backed `AutoCompleteField` to the component showcase.** The store path is fully covered by cases 1–13, and a new demo is a feature beyond this fix.
- **Changing the debounce or blur delay values.** Both keep the numbers they have; only where they live changes.

---

## Notes

[^why-matchesfilter]: `matchesFilter` is preferred over the field's own private `matches(candidate, query)` predicate, which the static-suggestion branch uses, even though unifying the two branches on one predicate would be shorter. The two disagree on a nullish field: `matchesFilter` rejects a record whose field is `null` or `undefined` ([FilterDescriptor.ts:73-74](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L73-L74)), while `this.matches(String(record.get(field)), query)` would test the literal string `"null"` and could match it. Today's store path goes through `matchesFilter`, so keeping it preserves current behaviour on such records; switching to `matches` would start suggesting `"null"`. On every non-nullish value the two are equivalent — both lower-case each side for the case-insensitive modes, and both test substring or prefix position the same way.

[^why-getall]: `getAll()` rather than `getRecords()`, for two reasons. It preserves today's result set: `querySuggestions` starts by calling `store.clearFilter()`, so the set it searches today is already every record, not the application's view. And it keeps the field's suggestions independent of unrelated UI — with `getRecords()`, a column filter typed into a `Table` elsewhere on the screen would silently shrink an autocomplete's suggestions, which is surprising and undebuggable from the field's own configuration.

[^remote-never-worked]: The ordering is visible in the source. `filterBy` calls `applyFilterChange` ([AbstractStore.ts:1517-1521](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1517-L1521)), which returns `applyView().then(() => { emit('filterchange'); emit('datachange'); if (reload) void this.load(); })` ([:1606-1622](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1606-L1622)). Every one of those steps, including `load()`, happens in a later microtask; `querySuggestions` reads `getRecords()` and calls `showSuggestions` on the current tick. The field registers no store listener, so when the server's answer eventually arrives as a `load` event, nothing is listening. The same read is also stale on a purely local store above the 1,000-record worker threshold, where `applyView` offloads and resolves asynchronously ([:1905-1908](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1905-L1908)).

[^rejected-setfilter]: A narrower fix was considered and rejected: keep writing to the store, but use the keyed `AbstractStore.setFilter(key, descriptor)` ([AbstractStore.ts:1542-1550](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1542-L1550)), which replaces one slot without disturbing other filters. That would stop the field from destroying the application's filters, and it is the right tool for `Header`'s filter row. It fixes neither of the remaining three problems: the field's own descriptor would still sit on the shared view, every bound view would still rebuild on every keystroke, and a remote or paged store would still reload. Suggestion matching is the field's private business; it does not belong in shared state at all.

[^no-store-api]: An opt-in `AbstractStore` query API — something shaped like `queryFor(descriptor): Promise<ModelRecord[]>`, evaluating server-side without touching the shared filter set or view — is the honest way to give this field a remote capability, and would let `querySuggestions` await a real answer. It is a data-layer design of its own, it has exactly one prospective caller today, and it is not needed to fix the defect this plan addresses. Building it here would be speculative work bundled into a bug fix.

[^seam-and-destructor]: Clearing in `destructor` alone leaves the bare global `setTimeout`, so a timer armed before a `DOM.reset()` — how the test harness tears an environment down between cases — is still live and still resolves handles minted against the discarded registry, which is precisely the throw `DOM.reset`'s own comment describes ([DOM.ts:2826-2830](packages/lib/src/typescript/lib/core/DOM.ts#L2826-L2830)). Routing through the seam alone leaves the ordinary case unfixed: disposing a single field in a running application calls no `DOM.reset`, so a sink-scheduled timer still fires against the field's released handles. Each half closes a path the other leaves open.

[^blur-clear-first]: Today `onBlur` calls a bare `setTimeout` and discards the id, so two blurs simply produce two independent timers and both eventually run — wasteful but not broken. Storing the id in a single `_blurTimer` field changes that: without a clear before the arm, the second call overwrites the first id, and the first timer becomes unreachable for `destructor` to cancel. The guard is therefore load-bearing for the disposal fix, not a separate improvement.
