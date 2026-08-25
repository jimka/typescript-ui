# Component Counter Residual Investigation — Implementation Plan

## Overview

`DiagnosticsOverlay` shows a live "Constructed / disposed" reading (`_constructedDisposed`, [`DiagnosticsOverlay.ts:105`](packages/lib/src/typescript/lib/diagnostics/DiagnosticsOverlay.ts#L105)) backed by [`Diagnostics.counters().componentsConstructed`/`componentsDestroyed`](packages/lib/src/typescript/lib/core/Diagnostics.ts#L36). `componentsConstructed` increments once per `Component` instance, unconditionally, at the end of the base constructor ([`Component.ts:737`](packages/lib/src/typescript/lib/core/Component.ts#L737)). `componentsDestroyed` increments once per `destructor()` call, guarded so a repeated call on the same instance never double-counts ([`Component.ts:969-972`](packages/lib/src/typescript/lib/core/Component.ts#L969)):

```typescript
if (!this._destroyed) {
    this._destroyed = true;
    Diagnostics.noteComponentDestroyed();
}
```

A prior debugging session (this repo, 2026-08-25) found that repeatedly calling the in-browser benchmark `window.bench.benchRowSelect()` ([`Benchmark.ts:439-459`](packages/lib/src/typescript/perf/Benchmark.ts#L439), which builds a 10,000-row `Table` via `mountTable`, cycles `table.selectRecord(...)` twenty times, then calls `unmountTable` → `table.dispose()`, [`Benchmark.ts:100-134`](packages/lib/src/typescript/perf/Benchmark.ts#L100)) leaves the live "Components" count net **+1 per call**, with "Constructed / disposed" showing the matching one-more-constructed-than-disposed delta. A Chrome heap snapshot (forced GC) confirmed this does **not** correspond to any retained object — after many cycles, live `Table`/`Row`/`Cell` instance counts stay flat. So some component is constructed during a `Table` build or teardown cycle and never has `destructor()` called on it, even though nothing else holds a reference — it is garbage-collected normally, but the counter itself is wrong.

This is the same failure shape (and the same investigation day) as an already-fixed defect in the Table family — a component held in a private field and never registered through `addComponent()`, so `Component.destructor()`'s recursive teardown over `this._components` ([`Component.ts:1012-1015`](packages/lib/src/typescript/lib/core/Component.ts#L1012)) never reaches it. [`plans/implemented/table-tab-close-residual-leak.md`](plans/implemented/table-tab-close-residual-leak.md) found and fixed six instances of exactly this pattern in the Table/Menu family, including `Table._columnContextMenu` itself. **That fix used a stylesheet-rule diff as its oracle** (`_ruleCacheKeys()`, per [`dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts)), which is structurally blind to a component that is constructed and discarded **without ever acquiring a DOM element** — per this project's "Defer DOM work to render time" rule (ARCHITECTURE.md), a `Component`'s CSS/DOM materialises only at render, so an unrendered instance leaves zero stylesheet residue to diff, no matter what happens to it. That gap is a plausible reason this counter can still drift even though every previously-known raw-appended-child leak in the Table construction path is now fixed — but it is a hypothesis to verify, not an assumed answer.

The root cause is **not known**. This plan's first job is to find it; the fix design in the later steps is written as a decision procedure conditioned on what that investigation finds, per this project's debugging convention (CLAUDE.md §5: root-cause first, never fix blind).

---

## Architecture Decisions

### Investigate before designing a fix

The three plausible fix shapes — a missing `addComponent()` registration, a legitimately-unregistered field missing an explicit `dispose()` call, or a transient helper that should never have been counted as a "component" — imply different, incompatible code changes. Committing to one before naming the actual construction site risks fixing a symptom (or a component that was never broken) while the counter keeps drifting. `## Ordered Implementation Steps` therefore separates a **find-the-site phase** (steps 1-7) from a **fix phase** (steps 8+) whose exact edit is decided by what phase one finds, using the decision table below.

### Candidates already ruled out by this plan's own investigation

Reading `Table`'s construction and teardown path end-to-end already rules out every currently-known instance of the raw-appended-child pattern, so the implementer does not need to re-check these:

| Candidate | Why it's not the cause |
|---|---|
| `Table._columnContextMenu` (eager `Menu` field, [`Table.ts:214`](packages/lib/src/typescript/lib/component/table/Table.ts#L214)) | `Table.destructor()` explicitly disposes it ([`Table.ts:1643-1650`](packages/lib/src/typescript/lib/component/table/Table.ts#L1643)), fixed by `table-tab-close-residual-leak.md`. |
| `Body._editorPool` (`CellEditorPool`) | Lazily constructs an editor only on the first real edit gesture ([`CellEditorPool.ts:86-102`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L86)); `benchRowSelect` only selects rows, never starts an edit, so no editor is ever constructed in this repro. |
| Column-width / header-text measurement (`Table.measureHeaders`/`measureContent`, [`Table.ts:2281-2323`](packages/lib/src/typescript/lib/component/table/Table.ts#L2281)) | Routes through `Util.measureTextWidths` → `DOM.source.measureText`, which probes with a raw `HTMLElement` appended and removed directly ([`DOM.ts:19`](packages/lib/src/typescript/lib/core/DOM.ts#L19), `_applyProbeStyles`) — no `Component` is ever constructed for a measurement. |
| `VirtualRowView`'s pooled rows (`growRowPool`, [`VirtualRowView.ts:327-358`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L327)) | Every row `growRowPool` builds is pushed into `_rowPool`, and `VirtualRowView.destructor()` explicitly iterates `_rowPool` and disposes every entry plus the scroller ([`VirtualRowView.ts:133-141`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L133)) — construct and dispose counts for the pool stay matched by construction. |
| `Header`'s raw-appended `_menuButton` ([`Header.ts:317-318`](packages/lib/src/typescript/lib/component/table/Header.ts#L317)) | Appended via `super.addComponent(this._menuButton)`, which *does* push it into `_components` — it is a normal registered child despite bypassing `Header`'s own narrowed `addComponent` override. |

None of these construct-and-discard a component during a plain `new Table(store)` → mount → `selectRecord()` × N → `dispose()` cycle. The residual construction site is somewhere else.

### Investigate offline first; fall back to the live benchmark only if the offline harness doesn't reproduce it

`packages/lib/tests/core/Diagnostics.test.ts` and `packages/lib/tests/component/dispose-full-teardown.test.ts` already establish the pattern for building, laying out, and disposing a `Table` entirely under the offline test harness (`installTestDOM` + a modelled `DOM.source`/`DOM.sink`), reading `Diagnostics.counters()` directly with no `requestAnimationFrame` wait and no timing noise. Reproduce there first.[^offline-risk]

### Name the exact construction site via temporary stack-trace instrumentation

Comparing `Diagnostics.counters()` before/after narrower and narrower slices of the repro (`## Ordered Implementation Steps`, step 4) can localise *which phase* — construction, first layout, one of the twenty `selectRecord` calls, or `dispose()` — introduces the drift, but not *which class*. Once localised, temporarily instrument `Component`'s constructor and the `noteComponentDestroyed()` call site to record each construction's id and stack trace, and delete the record on a matching destroy; whatever id is left over after the localised repro runs once names the exact class and call site (`## Internal Structure` gives the exact snippet). This instrumentation is a debugging aid — added in step 5, read in step 6, and reverted in the same step before any fix is written. It must never reach the committed diff.

### The fix follows from what the instrumentation finds

| What step 6 finds | What it means | The fix |
|---|---|---|
| **A.** The class is meant to be a normal child (it renders, and belongs under some container's `_components`) but nothing ever calls `addComponent()` on it. | A registration bug — the destructor recursion should reach it but can't. | Register it through `addComponent()` (or the owning class's own narrowed override), the same way every other Table-family child already is (e.g. [`Row.addComponent`](packages/lib/src/typescript/lib/component/table/Row.ts#L359), [`Header.addRow`](packages/lib/src/typescript/lib/component/table/Header.ts#L687)). |
| **B.** The class is legitimately never a registered child — a `LayerManager`-mounted overlay, or a raw-appended single element under the one-DOM-element-per-class rule (ARCHITECTURE.md) — but its owner never disposes it. | A missing owner-side cleanup call, the exact pattern `table-tab-close-residual-leak.md` fixed six times over. | Add one line to the owner's `destructor()` disposing the field, mirroring `VirtualRowView.destructor()`'s `_rowPool` loop and `Table.destructor()`'s `_columnContextMenu.dispose()` (`## Internal Structure` gives the shape). If the owning class has no covering row yet in `dispose-full-teardown.test.ts`'s `REGISTRY`, add one mirroring the existing `Table` row — but only when the object actually renders and can leave a stylesheet-rule residue; if it never acquires an element, that registry's oracle cannot see it either way and a row there would prove nothing. |
| **C.** The object is a one-shot, non-rendering helper — constructed, used for a JS-only computation, and discarded without ever calling `getElement(true)`. | It was never a "component" in the sense this counter measures; making it a `Component` subclass at all pays `Diagnostics.noteComponentConstructed()`'s cost and the base class's whole lifecycle contract for no reason. | Narrow the fix to that one construction site: stop constructing it as a `Component` subclass (a plain object/function is enough for a value it never renders). Do not add a synthetic `dispose()` call just to balance the counter — that would hide a real design smell instead of fixing it. |

Classify using this table before writing any fix code (step 7); do not assume the shape ahead of time.

---

## Internal Structure

**Temporary instrumentation** (step 5; reverted by step 6 before any fix lands) — added at the two existing counter call sites:

```typescript
// packages/lib/src/typescript/lib/core/Component.ts — TEMPORARY, revert before fixing.
// In the constructor, replacing the existing `Diagnostics.noteComponentConstructed();` line:
Diagnostics.noteComponentConstructed();
_liveConstructions.set(this.getId(), { ctorName: this.constructor.name, stack: new Error().stack });

// In destructor(), inside the existing `if (!this._destroyed) { ... }` block:
if (!this._destroyed) {
    this._destroyed = true;
    Diagnostics.noteComponentDestroyed();
    _liveConstructions.delete(this.getId());
}

// Module-level scratch map, declared once near the top of Component.ts:
const _liveConstructions = new Map<string, { ctorName: string; stack: string | undefined }>();
// Read after the localised repro runs once, e.g. from the throwaway test:
//   import { _liveConstructions } from "~/core/Component.js";  (temporary export, also reverted)
//   console.log([...( _liveConstructions as any)._liveConstructions ?? _liveConstructions]);
```

Keep it this simple — a `Map` keyed by `getId()` (already unique per live component) with an eager delete on dispose is enough to find the one surviving entry after a single localised repro run. Export it temporarily (or just `console.log` its contents directly from a temporary line at the end of the repro test) so the throwaway test can read it; both the export and the log line are reverted in step 6.

**Branch B fix shape**, mirroring `Table.destructor()` / `VirtualRowView.destructor()`:

```typescript
// Shape only — the actual owner class, field name, and null-guard depend on step 6's finding.
protected destructor(): void {
    this._theField?.dispose();   // or `this._theField.dispose();` if the field is non-nullable, like Table._columnContextMenu

    super.destructor();
}
```

---

## Ordered Implementation Steps

**Baseline first.** Run `npm run test` in `packages/lib` and confirm it is green before any change.

1. Create a throwaway offline investigation test at `packages/lib/tests/core/_tmp-counter-repro.test.ts` (deleted in step 10 — never committed as part of the final diff). Mirror `Diagnostics.test.ts`'s harness setup (`installTestDOM`, `Diagnostics._reset()` in `beforeEach`, `DOM.reset()` in `afterEach`) and `dispose-full-teardown.test.ts`'s `Table` construction idiom. Build a `Table` with the same field shape `Benchmark.buildPersonStore` uses (id: number, name/city/country: string, balance: number — matching column-type variety matters if the drift turns out to be type-specific) and ~30 records, so a real row pool populates:
   ```typescript
   const model = new Model([
       { name: "id", type: "number" }, { name: "name", type: "string" },
       { name: "city", type: "string" }, { name: "country", type: "string" },
       { name: "balance", type: "number" },
   ]);
   const store = new MemoryStore(model, /* 30 rows shaped like Benchmark.buildPersonStore */);
   await store.load();

   const table = new Table(store);
   table.getElement(true);
   table.setWidth(600);
   table.setHeight(400);
   table.doLayout();

   const before = Diagnostics.counters();
   const records = store.getRecords();
   for (let i = 0; i < 20; i++) {
       table.selectRecord(records[i % 10]);
   }
   table.dispose();
   const after = Diagnostics.counters();

   console.log("delta:", (after.componentsConstructed - after.componentsDestroyed) - (before.componentsConstructed - before.componentsDestroyed));
   ```
   Run it (`npx vitest run packages/lib/tests/core/_tmp-counter-repro.test.ts` from `packages/lib`). A nonzero logged delta confirms the offline harness reproduces the drift.

2. **If step 1 does not reproduce a nonzero delta**, fall back to the live browser: `npm run dev` in `packages/lib` (serves at `localhost:8015` per the project's dev server), open a page via the chrome-devtools MCP tools, and run `window.bench.benchRowSelect()` several times through `evaluate_script`, reading the "Components" / "Constructed / disposed" rows in `DiagnosticsOverlay` (opened from the app's menu bar — see its `open()` wiring referenced from `MenuBar.ts`) before/after each call. If the live run reproduces it but the offline one does not, the divergence is between the modelled and production `DOM.source`/`DOM.sink` (see footnote); investigate from there using the same bisection and instrumentation approach as steps 4-6, applied to `benchRowSelect`'s real call sequence instead of the throwaway test. The rest of these steps assume the offline repro from step 1 worked; adapt the same logic to the live harness if not.

3. Confirm the repro is stable: run step 1's test three times in a row (or three iterations of the outer loop within one run) and confirm the logged delta is the same nonzero value each time, not noise.

4. Bisect within the throwaway test to localise which phase introduces the drift. Comment out (or make conditional) each of these in turn, re-running after each change, and record the delta at each step:
   - Construct + `getElement(true)` + `setWidth`/`setHeight` + `doLayout()`, then `dispose()` immediately — **no** `selectRecord` calls, **zero** records in the store.
   - Same, but with the ~30-record store loaded (so the row pool actually populates).
   - Same, plus the 20 `selectRecord` calls.

   The first row where a nonzero delta appears is the phase responsible. If the delta already appears in the zero-record case, the cause is in `Table`'s construction or its very first (empty) layout, not in row rendering or selection — narrow steps 5-6 to that much smaller construction path instead of the full repro.

5. In the phase identified by step 4, add the temporary instrumentation from `## Internal Structure` to `packages/lib/src/typescript/lib/core/Component.ts`. Re-run the narrowed repro (just the localised phase, once).

6. Read the logged `_liveConstructions` contents: exactly one entry should remain (the disposal loop deletes every matched pair). Record its `ctorName` and stack trace — this names the exact class and the exact call site that constructs it. **Revert the `Component.ts` instrumentation now** (`git diff` the file and back it out, or `git checkout -- packages/lib/src/typescript/lib/core/Component.ts` if nothing else in it changed yet) before writing any fix.

7. Classify the finding against the three-branch table in `## Architecture Decisions`. Read the owning class's current construction and disposal code (the exact file/line from step 6) before deciding — don't infer the branch from the class name alone.

8. Apply the fix for the matching branch:
   - **Branch A**: add the missing `addComponent()` (or route through the owner's existing add path) at the construction site. Verify with `table.getComponents()` (or the narrower container's own `getComponents()`) including the previously-missing child after construction.
   - **Branch B**: add a `destructor()` override (or extend an existing one) on the owning class per the snippet in `## Internal Structure`, placed near the field's other lifecycle methods, matching the placement convention `table-tab-close-residual-leak.md` used (e.g. near the method that first creates/uses the field).
   - **Branch C**: change the one construction site to stop building a `Component` subclass; keep the change scoped to that call site only — do not touch other constructors of the same class if it is legitimately used as a real, rendering component elsewhere.

9. Add a permanent regression test to `packages/lib/tests/core/Diagnostics.test.ts`, inside the existing `'Diagnostics — Component construction/destruction'` describe block, numbered `'10. a Table mount/select/dispose cycle leaves construct/destroy balanced'` (matching the file's existing numbering convention). Reuse the exact localised repro from steps 1-4 (whichever phase step 4 identified — the full cycle if the drift only appeared there, or the narrower construction-only case if it appeared earlier) by adapting it out of `_tmp-counter-repro.test.ts`, which is still present at this point. Assert the delta is zero, and run the cycle **twice in a row** inside the same test (build/dispose, then build/dispose again) asserting zero each time — a single cycle can't distinguish "always balanced" from "this class's construct/destroy pair happens to cancel out only from a state a first cycle sets up."

10. Delete `packages/lib/tests/core/_tmp-counter-repro.test.ts` — its content is now folded into step 9's permanent test.

11. **If branch B applied and the owning class had no existing row in `packages/lib/tests/component/dispose-full-teardown.test.ts`'s `REGISTRY`**, add one, mirroring the existing `Table` row's shape (`getElement(true)`, drive whatever real trigger materialises the field, then let the row's implicit `dispose()` + `_ruleCacheKeys()` check run). Update the file's header comment's re-derived `protected destructor(` count (`grep -rn '^\s*protected destructor(' packages/lib/src/typescript/lib`) to match, per that comment's own stated convention — do not leave it stale.

12. Regression checkpoint: re-run `npx vitest run packages/lib/tests/core/Diagnostics.test.ts packages/lib/tests/component/dispose-full-teardown.test.ts` and confirm both pass, including the new/extended cases.

13. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create, then delete (steps 1, 10) | `packages/lib/tests/core/_tmp-counter-repro.test.ts` |
| Modify, then revert (steps 5, 6) | `packages/lib/src/typescript/lib/core/Component.ts` (temporary instrumentation only) |
| Modify | `packages/lib/tests/core/Diagnostics.test.ts` |
| Modify (only if branch B and no covering row exists) | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify — **named by step 6/7's finding, not fixed in advance**[^unknown-fix-file] | the owning class's source file |

---

## Expected Behaviour

- **A `Table` mount → row-select × N → dispose cycle leaves `componentsConstructed - componentsDestroyed` unchanged** (the counter's stated contract) — unit-testable, per step 10's new `Diagnostics.test.ts` case. Assert across two consecutive cycles, not just one.
- **Every existing `Diagnostics.test.ts` case (1-9) stays green** — the fix must not touch how a simple, already-correct construct/destroy pair is counted.
- **Branch A**: the previously-unregistered child appears in its container's `getComponents()` after construction, and is destroyed exactly once when the container is disposed (mirrors `Diagnostics.test.ts` case 3's "recursive disposal counts the whole subtree" shape).
- **Branch B**: the field's `dispose()` is called exactly once per owner disposal, even if the owner is disposed twice (idempotent, per `Component.dispose()`'s documented contract) — mirrors case 2.
- **Branch C**: after the fix, the call site no longer increments `componentsConstructed` at all for that value — confirm via the same instrumentation technique (temporarily reapplied) or by direct code inspection that no `Component` subclass is constructed there any more.
- **Manual verification (not unit-testable — the original symptom was observed live):** open the demo app (`npm run dev` in `packages/lib`), open `DiagnosticsOverlay` from the app's menu bar, and call `window.bench.benchRowSelect()` from the console five to ten times in a row. Before the fix, "Constructed / disposed" drifts by +1 net per call; after the fix, both numbers return to their pre-call values (accounting only for whatever the overlay's own components add, which stays constant across calls).

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green, including the new/extended `Diagnostics.test.ts` and (if applicable) `dispose-full-teardown.test.ts` cases.
- `git diff packages/lib/src/typescript/lib/core/Component.ts` shows **no** leftover instrumentation (the temporary `_liveConstructions` map, its export, and the two log/set/delete lines from `## Internal Structure` are gone) — confirm by inspection before committing.
- `git status` confirms `packages/lib/tests/core/_tmp-counter-repro.test.ts` was deleted, not left behind.
- Step 12's regression-checkpoint test run.
- The manual verification in `## Expected Behaviour`, against the demo app's own `DiagnosticsOverlay` — this is the authoritative check, since it reproduces the original symptom exactly.
- `npm run build:lib` — succeeds.

---

## Potential Challenges

- **The offline harness might not reproduce the drift at all** (see the offline/live divergence footnote). Mitigation: step 2's live-browser fallback, using the same bisection and instrumentation logic against `benchRowSelect`'s real call sequence instead of the throwaway test.
- **The instrumentation log could be noisy** — a 30-row table with 5 columns constructs on the order of a few hundred `Cell`/`Row`/`Text` instances during initial layout, so a map dump after the *unnarrowed* repro would be hard to read by eye. Mitigation: step 4's bisection must land on as narrow a repro as possible (ideally the zero-record construct/dispose case) *before* step 5 adds instrumentation, so the surviving-entry count stays small enough to inspect directly.
- **Branch C's fix could ripple if the same class is legitimately used as a real, rendering component elsewhere.** Mitigation: step 8's branch-C instruction explicitly scopes the change to the one construction site named by step 6, not the class's other constructors.
- **A stale `dispose-full-teardown.test.ts` re-derived count** (its header comment already notes the count was out of date even before `table-tab-close-residual-leak.md` touched it). Mitigation: step 11 re-greps and updates it as part of this plan, rather than trusting the comment's existing number.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — the constructor (`noteComponentConstructed`, line 737), `destructor()` (the `_destroyed` guard and `_components` recursion, lines 957-1102), and `addComponent`/`insertComponent` (line 6180 on).
- [`packages/lib/src/typescript/lib/core/Diagnostics.ts`](packages/lib/src/typescript/lib/core/Diagnostics.ts) — the counters and `_reset()`/`counters()` this plan's tests read.
- [`packages/lib/src/typescript/perf/Benchmark.ts`](packages/lib/src/typescript/perf/Benchmark.ts) — `mountTable`/`unmountTable`/`benchRowSelect`, the original repro.
- [`packages/lib/tests/core/Diagnostics.test.ts`](packages/lib/tests/core/Diagnostics.test.ts) — the counter-testing harness and numbering convention this plan's new case extends.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the established registry pattern for "a raw-field, non-registered-child component must be disposed explicitly by its owner"; read its header comment before adding a row.
- [`plans/implemented/table-tab-close-residual-leak.md`](plans/implemented/table-tab-close-residual-leak.md) — the precedent this plan's Branch B follows: the exact bug shape in the exact same component family, six owners fixed the same way, using the same registry test file.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:133-141`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L133) — a second, already-correct example of the Branch B disposal shape (row pool + scroller), useful as a second reference alongside `Table.destructor()`.

---

## Non-Goals

- **Re-auditing the stylesheet-rule leak this plan's "Candidates already ruled out" table cites.** `table-tab-close-residual-leak.md` and the earlier window-chrome/row-pool/header-cell fixes are complete; this plan does not re-verify them beyond the specific candidates checked above.
- **A live SQLAdmin or other downstream re-measurement.** This plan's manual verification targets the library's own demo app only.
- **Fixing any other `DiagnosticsCounters` field** (`bagListenersAdded`/`Removed`, `layoutPasses`, `layoutFlushes`, etc.) — out of scope; this plan is scoped to `componentsConstructed`/`componentsDestroyed` only.
- **A `package.json` version bump or changelog entry.** No prior plan in this family added one for an internal counter/disposal fix (`table-tab-close-residual-leak.md`'s own `## Files to Create / Modify / Delete` has none); this plan follows the same precedent.

---

## Implementation Notes

**Root cause found (Branch B):** `Button._titleColumn` (`Button.ts:790`), plus its lazily-created
siblings `_innerRow`/`_outerColumn` and the lazily-created `_description`, are only *sometimes*
registered children of `_content`. `_rebuildContentRow()` empties `_content`'s tree on every rebuild
and selectively re-populates it based on the button's current description/orientation topology — for
any button that never shows a description (the common case, including `TableHeaderMenuButton`, the
table header's column-options trigger), `_titleColumn` never becomes a registered child at all, so
the base `Component.destructor()`'s recursive `_components` teardown never reaches it. Confirmed via
the plan's stack-trace instrumentation technique: a zero-record `Table` construct/dispose cycle left
exactly one leftover live construction whose stack terminated at `Header.ts:317` → `new
TableHeaderMenuButton` → `Button`'s constructor line `this._titleColumn = new Component();`.

**Fix scope widened slightly beyond the single instrumented stack trace.** Step 6/7 evidenced
`_titleColumn` specifically; reading `_rebuildContentRow()` in full (per `## Architecture Decisions`'
"read the owning class's current construction and disposal code") showed `_innerRow`, `_outerColumn`,
and `_description` share the exact same "conditionally detached, no owner disposal" shape in the same
method — same mechanism, same owner, same one-line idempotent fix. Disposing only `_titleColumn`
while knowingly leaving three structurally-identical siblings unfixed in the same commit would have
been an incomplete patch, so `Button.destructor()` disposes all four.

**Step 11's `dispose-full-teardown.test.ts` registry row was skipped, per the plan's own carve-out.**
`_titleColumn` never acquires a DOM element in the failing topology (it's never added to the tree, so
`getElement(true)` is never called on it) — the registry's stylesheet-rule-diff oracle (`_ruleCacheKeys`)
is structurally blind to it regardless of whether a `Button` row exists, exactly as `## Architecture
Decisions`' Branch B row anticipates ("if it never acquires an element, that registry's oracle cannot
see it either way and a row there would prove nothing"). The regression coverage for this bug lives
entirely in the new `Diagnostics.test.ts` case (raw counter deltas, not stylesheet residue). Left the
file's re-derived `protected destructor(` count untouched too: it was already significantly stale
before this change (comment says 35, `grep -rn '^\s*protected destructor(' packages/lib/src/typescript/lib`
already returns 54 pre-fix) — a pre-existing gap the comment itself disclaims responsibility for
("several later, unrelated plans... have added `destructor()` overrides without a corresponding row
here... a pre-existing gap this plan did not introduce and did not close").

**Diagnostics.test.ts case 10's methodology deviates from the plan's literal step-1/9 snippet.** The
plan's illustrated before/after snapshot (captured *after* construction, *before* the select-loop/
dispose) measures `M - K` (new constructions minus new destructions across that window), which
evaluates to `leaks - N` where `N` is the live component count at the snapshot — dominated by `-N`
regardless of leaks, so it can't distinguish a healthy cycle from a one-component leak by itself.
The permanent test instead compares the *absolute* `componentsConstructed - componentsDestroyed`
balance across consecutive full cycles (a healthy cycle contributes exactly 0 to that balance), which
directly detects a per-cycle leak. It also needed a warm-up cycle (mirroring
`dispose-full-teardown.test.ts`'s own warm-up-pass idiom) to absorb the Tooltip singleton's one-time,
expected construction cost (any Button's `destructor()` calls `Tooltip.detach()` → `Tooltip.hide()`
→ `Tooltip.getInstance()` unconditionally, even when the tooltip was never shown) out of the asserted
per-cycle deltas — that singleton is intentionally never disposed, matching the same file's other
process-global-state exemption.

**No documentation/changelog commit** — matches `table-tab-close-residual-leak.md`'s own precedent
for this exact class of fix and this plan's `## Non-Goals`.

**Manual verification performed live**, per `## Expected Behaviour`: a worktree-local dev server
(port 8019, separate from the user's own session on 8015) served this fix, and `window.bench
.benchRowSelect()` was driven 13 times via `chrome-devtools` against the demo app's `DiagnosticsOverlay`.
"Components" stayed flat at 821 throughout (constructed and destroyed both grew by identical amounts
per batch), confirming the live symptom is gone.

---

## Notes

[^offline-risk]: The one place offline and live could legitimately diverge is text/geometry measurement: `Benchmark.mountTable` waits a real `requestAnimationFrame` and lets `TableLayout` run its first pass against real `getBoundingClientRect`/`measureText` results, while the offline harness's modelled `DOM.source` answers those calls synthetically from `installTestDOM`'s font-metrics fixture. If step 1's offline repro shows a zero delta where the live benchmark shows +1, the cause is somewhere in that measurement path specifically, and step 2's live fallback is not just a convenience — it is required to reach the actual bug.

[^unknown-fix-file]: The exact class and file are determined by step 6's stack-trace instrumentation, not by this plan in advance — see `## Architecture Decisions`' "Investigate before designing a fix". Naming a specific file here without having run that step would be a guess this plan is explicitly structured to avoid.
