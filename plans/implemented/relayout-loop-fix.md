# Silent Relayout-Loop Fix — Implementation Plan

## Overview

Several demo/sqladmin panels burn CPU with no interaction and no visible change: the Charts panel pins one core at ~110%, the Complex panel ~13%, the Properties panel ~8%. The cause is a **silent infinite relayout loop**: a component whose `doLayout` (or a path it reaches) mutates its own subtree, and that mutation relays a preferred-size change back up into the same component, which re-arms the rAF layout flush every frame forever. Output is byte-identical each frame, so nothing renders differently — it just spins.

The confirmed instance is **Charts**. `AbstractChart.doLayout()` calls `reserveLegend()` on every pass ([AbstractChart.ts:571](src/typescript/lib/component/chart/AbstractChart.ts#L571)); when the legend is shown, `reserveLegend` unconditionally calls `this._legend.setEntries(...)` ([AbstractChart.ts:620](src/typescript/lib/component/chart/AbstractChart.ts#L620)) with a freshly-mapped array. `ChartLegend.setEntries` ([ChartLegend.ts:163](src/typescript/lib/component/chart/ChartLegend.ts#L163)) unconditionally does `removeAllComponents()` + N× `addComponent(row)`. Each `addComponent`/`insertComponent` fires `this._onPreferredSizeChange?.()` ([Component.ts:4397](src/typescript/lib/core/Component.ts#L4397)); the chart installed that slot on the legend in `wireChild` as `() => { this.scheduleLayout(); this._onPreferredSizeChange?.(); }` ([Component.ts:4302-4314](src/typescript/lib/core/Component.ts#L4302)). So every legend-row add re-dirties the chart, the next rAF re-runs `chart.doLayout()`, and the loop closes. Empirically a 2-entry legend fires exactly 2 `chart.scheduleLayout()` calls per steady-state `doLayout` — the 2 `addComponent` calls in `setEntries` are the loop driver; `setOrientation`'s `setLayoutManager` and `removeAllComponents` added none but still waste an allocation each pass.

The fix is to make the legend's mutators **idempotent** — a re-apply of identical entries/orientation mutates nothing and fires no relay — following the codebase's existing "early-return when the value is unchanged" idiom ([Card.setVisibleComponentId:137-140](src/typescript/lib/layout/Card.ts#L137)). The Charts fix is confirmed and primary. The Complex and Properties panels are the **same bug class but the locus is unconfirmed**; this plan pins them behind a live diagnostic plus a reusable offline self-reschedule detector, and applies the same idempotency gating to whatever the diagnostic confirms.

A red regression test already exists in the main tree — [tests/component/chart/Chart.test.ts:374-393](tests/component/chart/Chart.test.ts#L374), `describe('steady-state layout stability')` → `'does not re-schedule its own layout on a no-op doLayout (relayout-loop guard)'` — currently failing with "Number of calls: 2". It is the primary regression gate and must go green; **do not rewrite it**.

---

## Architecture Decisions

### Gate at the legend, not the chart — lowest level fixes all callers

The idempotency guards go on `ChartLegend.setEntries` and `ChartLegend.setOrientation`, not on `AbstractChart.reserveLegend`. The legend is the component that owns the expensive teardown/rebuild and the size-relay; gating there fixes every current and future caller (a chart, a future direct legend consumer) in one place, and keeps `reserveLegend` a straight-line "reserve the band" method. Gating at the chart instead (skip calling `setEntries` when series+orientation unchanged) would require the chart to cache and diff the legend's derived state — duplicating knowledge the legend already holds — and would leave `setEntries` itself a footgun for any other caller. The existing surface test pins the chart-level *observable* (no self-reschedule) regardless of where the gate lives, so legend-level gating satisfies it.

### Follow the codebase's "unchanged value → early return" setter idiom

The precedent is [Card.setVisibleComponentId:137-140](src/typescript/lib/layout/Card.ts#L137): `if (this._visibleComponentId === id) { return this; }` before any mutation or `scheduleLayout`. The legend guards mirror this exactly — compare the incoming request against the cached state (`_entries`, `_orientation`) at the top of the setter and `return this` before touching the subtree. This is an existing framework pattern, not a new one.

### `setEntries` compares by value (deep-equal the entry fields), `setOrientation` by identity

`reserveLegend` passes a **freshly `.map()`-ed array** every pass ([AbstractChart.ts:620](src/typescript/lib/component/chart/AbstractChart.ts#L620)), so an array-reference `===` check would never hit. The guard must compare **by value**: same length, and for each index equal `name`, equal `color`, and equal *effective* `hidden`. `hidden` is optional (`ChartLegendEntry.hidden?: boolean`, [ChartLegend.ts:26](src/typescript/lib/component/chart/ChartLegend.ts#L26)) and the chart passes `m.hidden` (possibly `undefined`), while the row renderer truthy-tests it (`entry.hidden ? HIDDEN_OPACITY : 1`, [ChartLegend.ts:211](src/typescript/lib/component/chart/ChartLegend.ts#L211)); compare `(a.hidden ?? false) === (b.hidden ?? false)` so `undefined` and `false` are treated identical (they render identically). `setOrientation` takes a string-literal union, so a plain `this._orientation === orientation` identity check is correct and sufficient.

### Static grep under-approximates this bug class — the reliable finder is a runtime detector

The chart's mutation is **indirect**: `doLayout` → `reserveLegend` (helper) → `setEntries`. A textual search for subtree-mutation calls *inside* `doLayout` bodies finds nothing for the chart, because the mutation is one call-level down. This is exactly why the Complex/Properties loci can't be blind-fixed from a grep: the offending mutation may sit behind any helper a layout pass reaches. The reliable detector is the **runtime self-reschedule assertion** the existing chart test already embodies (settle → spy `scheduleLayout` → one `doLayout()` → assert not called). This plan generalises it into a shared helper and drives the diagnostic with it.

### No production dev-mode self-reschedule guard — rejected

Considered: a dev-mode safeguard in `Component` that warns when a component calls `scheduleLayout()` on itself during its own `doLayout`/flush. **Rejected.** It would add a global re-entrancy flag and per-call bookkeeping to the hottest path in the framework (every `scheduleLayout`, every flush), for a diagnostic that the offline `expectNoSelfReschedule` test helper already provides going forward — with zero production cost and no hot-path branch. This violates Simplicity-First (speculative machinery beyond the request) and Surgical-Changes (touching the core layout queue to catch a bug class we can pin in tests). The test helper is the going-forward guard; the fix stays surgical.

### Complex/Properties fixes are contingent on the diagnostic

The Charts fix ships unconditionally. The Complex/Properties fixes are **gated on the diagnostic confirming an actual rAF→doLayout→doLayout loop** (not merely heavier passive rendering). If the diagnostic shows a component self-rescheduling with zero input, apply the same idempotency gating to that component's offending mutator and pin it with `expectNoSelfReschedule`. If the diagnostic shows no self-reschedule (genuinely heavy but terminating layout), that is out of scope for this plan and is reported, not fixed. Prime suspects to investigate first (see `## Ordered Implementation Steps`): the **Table subsystem** (`Body`/`Cell`/`CellRenderer`), since `PropertyGridPanel` is Table-only ([PropertyGridPanel.ts](src/typescript/PropertyGridPanel.ts)) and `ComplexUIPanel` ([ComplexUIPanel.ts](src/typescript/ComplexUIPanel.ts)) is table + input + overlay. `ComboBox.doLayout` ([ComboBox.ts:492](src/typescript/lib/component/input/ComboBox.ts#L492)) and `Row.doLayout` ([Row.ts:455](src/typescript/lib/component/table/Row.ts#L455), a no-op) were already verified **not** to mutate their subtrees — exclude them.

---

## Internal Structure

### `ChartLegend.setEntries` guard (idempotency)

Insert a by-value equality check at the top of `setEntries`, before the `this._entries = ...` assignment and the `removeAllComponents()`/rebuild:

```typescript
setEntries(entries: ChartLegendEntry[]): this {
    if (this.entriesEqual(entries)) {
        return this;
    }

    this._entries = entries.map((e) => ({ ...e }));

    this.removeAllComponents();
    this._rows = [];

    for (const entry of this._entries) {
        const row = this.buildRow(entry);

        this._rows.push(row);
        this.addComponent(row);
    }

    return this;
}

/**
 * Reports whether `candidate` renders identically to the current entries —
 * same length and, per index, equal name, colour, and effective hidden state
 * (`undefined` hidden renders the same as `false`). Lets a no-op re-apply skip
 * the teardown/rebuild that would relay a preferred-size change to the owning
 * chart and re-arm the layout flush.
 *
 * @param candidate - The entries about to be applied.
 *
 * @returns `true` when `candidate` is value-equal to the current entries.
 */
private entriesEqual(candidate: ChartLegendEntry[]): boolean {
    if (candidate.length !== this._entries.length) {
        return false;
    }

    for (let i = 0; i < candidate.length; i++) {
        const a = candidate[i];
        const b = this._entries[i];

        if (a.name !== b.name || a.color !== b.color || (a.hidden ?? false) !== (b.hidden ?? false)) {
            return false;
        }
    }

    return true;
}
```

### `ChartLegend.setOrientation` guard (skip redundant manager allocation)

```typescript
setOrientation(orientation: ChartLegendOrientation): this {
    if (this._orientation === orientation) {
        return this;
    }

    this._orientation = orientation;

    this.applyOrientationLayout();

    return this;
}
```

The constructor already calls `applyOrientationLayout()` once for the default `"vertical"` before `dispatchLegendOptions` runs ([ChartLegend.ts:90-92](src/typescript/lib/component/chart/ChartLegend.ts#L90)), so an early return when `dispatchLegendOptions` re-requests `"vertical"` is safe — the manager is already installed. Only a genuine orientation change (vertical→horizontal) now allocates a new manager.

### Shared test helper `expectNoSelfReschedule`

A new non-`*.test.ts` module (so vitest's `include: ['tests/**/*.test.ts']` does not treat it as a suite — confirmed in [vitest.config.ts:12](vitest.config.ts#L12)):

```typescript
// tests/helpers/layoutStability.ts
import { vi, expect } from 'vitest';
import type { _Component } from '~/core/Component';

/**
 * Asserts a settled component does not re-dirty itself on a no-op relayout — the
 * offline signature of the silent relayout loop. The caller must have realised
 * the component's element and given it a size first; this settles it via
 * `flushLayout()`, then spies `scheduleLayout`, runs one more `doLayout()`, and
 * asserts the spy never fired. The test DOM's `requestAnimationFrame` only
 * records (never fires), so a real loop is detected as a self-reschedule rather
 * than by letting it spin.
 *
 * @param component - A component already mounted (`getElement(true)`) and sized.
 */
export function expectNoSelfReschedule(component: {
    flushLayout(): unknown;
    doLayout(): unknown;
    scheduleLayout(): unknown;
}): void {
    component.flushLayout();

    const spy = vi.spyOn(component, 'scheduleLayout');

    component.doLayout();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
}
```

The existing chart regression test ([Chart.test.ts:374](tests/component/chart/Chart.test.ts#L374)) stays inline as-is (task constraint) and remains the primary gate; the helper generalises the same assertion for the diagnostic phase's new per-suspect tests.

---

## Ordered Implementation Steps

1. **`ChartLegend.setEntries` idempotency.** In [ChartLegend.ts](src/typescript/lib/component/chart/ChartLegend.ts), add the `private entriesEqual(candidate)` helper and the early-return guard at the top of `setEntries` (see `## Internal Structure`). → verify: the new ChartLegend unit test (step 5) goes green; existing "replaces prior rows on a subsequent setEntries" still green.

2. **`ChartLegend.setOrientation` idempotency.** In the same file, add the `if (this._orientation === orientation) { return this; }` early return at the top of `setOrientation`. → verify: existing "accepts entries and orientation through the options bag" still green.

3. **Add the shared helper.** Create `tests/helpers/layoutStability.ts` exporting `expectNoSelfReschedule` (see `## Internal Structure`). → verify: `grep -rn "include" vitest.config.ts` confirms the pattern is `tests/**/*.test.ts` so the helper module is not collected as a suite.

4. **Confirm the primary chart gate is green.** Run the existing red test unchanged. → verify: `npx vitest run tests/component/chart/Chart.test.ts -t "relayout-loop guard"` passes (was "Number of calls: 2", now 0).

5. **Add the lower-level ChartLegend unit test.** In [tests/component/chart/ChartLegend.test.ts](tests/component/chart/ChartLegend.test.ts), add a test in `describe('ChartLegend.setEntries')`: build a legend with entries, capture `legend.getComponents()[0]`, call `setEntries` again with a **fresh but value-equal** array (new object literals, same `name`/`color`/`hidden`), assert `legend.getComponents()[0]` is the **same instance** and `getComponents().length` unchanged. Add a second test: value-equal entries where only `hidden` flips (`undefined`→`true`) **do** rebuild (different instance). → verify: both pass; whole ChartLegend suite green.

6. **Live diagnostic (Chrome DevTools MCP).** With the dev app running (`npm run dev`, http://localhost:8015 per the dev-urls memory), open each of the Complex and Properties panels, take a `performance_start_trace`/`performance_stop_trace` with **no interaction**, and inspect for a repeating rAF→`doLayout`→`doLayout` self-cycle vs. a one-shot settle. Record, per panel: *is there a steady-state self-reschedule with zero input?* → verify: a documented yes/no per panel. If **no** for a panel, that panel is out of scope (report it; do not fabricate a fix).

7. **Pin each confirmed loop offline, then gate it.** For every panel the step-6 trace confirms as a loop, identify the self-rescheduling component (start with the Table subsystem — `Body`/`Cell`/`CellRenderer`; the mutation may be behind a helper a layout pass reaches, so trace the call chain, do not grep-only). Write a red `expectNoSelfReschedule(component)` test against a minimal reproduction of that component (mirror the chart test's mount+size+settle setup), confirm it fails, then apply the **same idempotency gate** — early-return the offending mutator when its input is value-unchanged, using the Card/legend idiom — and confirm the test goes green. → verify: new red→green per confirmed component; no unrelated behaviour changes.

8. **Full regression sweep.** → verify: `npx vitest run tests/component/chart` green; `npx tsc --noEmit` (or the project typecheck) clean; the touched panels re-traced (step 6 method) show a flat idle CPU profile.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/chart/ChartLegend.ts` — `entriesEqual` helper + guards in `setEntries`/`setOrientation` |
| Create | `tests/helpers/layoutStability.ts` — `expectNoSelfReschedule` shared helper |
| Modify | `tests/component/chart/ChartLegend.test.ts` — idempotent-re-apply + hidden-flip tests |
| Modify (conditional) | Whatever component step 6 confirms as a loop (prime suspects: `src/typescript/lib/component/table/{Body,Cell}.ts`, `.../table/cell/renderer/CellRenderer.ts`) — same idempotency gate |
| Create (conditional) | Per-suspect `expectNoSelfReschedule` test alongside that component's existing tests |
| Modify | `tests/component/chart/Chart.test.ts` — the `steady-state layout stability` relayout-loop guard; the primary gate, added verbatim (not rewritten) — see [Implementation Notes](#implementation-notes) for its provenance |

The `steady-state layout stability` regression test in `tests/component/chart/Chart.test.ts` is the primary gate and was **not rewritten** — it was landed verbatim from the pre-existing working-tree draft. See [Implementation Notes](#implementation-notes) for why it appears as a branch addition rather than as an unchanged pre-existing commit.

---

## Expected Behaviour

Unit-testable (offline, via the test DOM harness):

1. **Idempotent `setEntries` (no rebuild).** After a legend renders entries, calling `setEntries` again with a fresh array that is value-equal (same `name`, `color`, effective `hidden`) leaves the exact same row `Component` instances in place — `getComponents()[0]` is identical before and after, and `getComponents().length` is unchanged.
2. **`setEntries` still rebuilds on a real change.** Different length, a changed `name`/`color`, or a flipped effective `hidden` (`undefined`/`false` → `true`) rebuilds the rows (new instances). The existing "replaces prior rows on a subsequent setEntries" test remains green.
3. **Idempotent `setOrientation`.** Re-requesting the current orientation installs **no** new layout manager (no allocation); a genuine change (vertical↔horizontal) installs the matching `VBox`/`HBox` exactly once.
4. **Chart no self-reschedule (primary gate).** A settled `_LineChart` with `showLegend: true`, laid out once more with no state change, does **not** call `chart.scheduleLayout()` — the existing [Chart.test.ts:375](tests/component/chart/Chart.test.ts#L375) test passes (was 2 calls, now 0).
5. **Helper contract.** `expectNoSelfReschedule(component)` on a mounted+sized component passes when a no-op `doLayout()` fires no `scheduleLayout`, and fails (surfacing the loop) when it fires one or more.

Manual / live-verify (Chrome DevTools MCP, http://localhost:8015):

6. **Charts panel idle CPU flat.** With the fix, the Charts demo panel shows no steady-state rAF→doLayout cycle in a no-interaction performance trace; CPU returns to baseline.
7. **Complex/Properties diagnostic.** Each panel's no-interaction trace is classified as *self-rescheduling loop* or *terminating layout*. Only a confirmed loop gets an offline pin + gate (behaviours 1–3 pattern) applied to its component; a terminating-but-heavy panel is reported as out of scope.

---

## Verification

- `npx vitest run tests/component/chart/Chart.test.ts -t "relayout-loop guard"` — the primary gate, red→green.
- `npx vitest run tests/component/chart` — full chart + legend suites green (idempotent-re-apply, hidden-flip, orientation).
- Project typecheck (`npx tsc --noEmit` or the repo's typecheck script) — clean.
- Live: dev app (`npm run dev`) → Charts panel → DevTools performance trace with no interaction → no repeating self-cycle; CPU at baseline. Repeat the trace method on Complex and Properties to classify each and confirm any applied gate flattens its profile.

---

## Potential Challenges

- **The Complex/Properties locus is behind a helper, not in a `doLayout` body.** As with the chart, a grep of `doLayout` bodies will miss it — trace the actual call chain the layout pass reaches, or let `expectNoSelfReschedule` on candidate components find it empirically.
- **A panel may be heavy but not looping.** The diagnostic must distinguish a true self-reschedule from a one-shot expensive settle; only the former is this bug class. Do not gate a mutator that isn't in a loop.
- **`hidden` normalisation.** Treat `undefined` and `false` as equal in `entriesEqual`, matching the truthy render test — otherwise the first re-apply after an all-defined array vs. an omitted-`hidden` array would spuriously rebuild (a partial loop).

---

## Documentation Impact

None. This is an internal bug fix — no exported symbol, signature, option, or public behaviour changes (`setEntries`/`setOrientation` keep their signatures and observable results; only a redundant rebuild is elided). No docs pages reference the changed internals. `npm run docs:build` is not required by this change.

---

## Critical Files

- [src/typescript/lib/component/chart/ChartLegend.ts](src/typescript/lib/component/chart/ChartLegend.ts) — the mutators being gated (`setEntries:163`, `setOrientation:129`, `applyOrientationLayout:147`, `buildRow:196`); `ChartLegendEntry` shape at :20.
- [src/typescript/lib/component/chart/AbstractChart.ts](src/typescript/lib/component/chart/AbstractChart.ts) — `doLayout:558` → `reserveLegend:609` (the per-pass caller); legend wired as a child at `:170`.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — the loop machinery: `scheduleLayout:4777`, `flushLayout:4843`, `flushPendingLayouts:165`, `wireChild:4302` (the `_onPreferredSizeChange` relay), `insertComponent:4359` (fires the relay at :4397).
- [src/typescript/lib/layout/Card.ts:137](src/typescript/lib/layout/Card.ts#L137) — `setVisibleComponentId`, the "unchanged value → early return before scheduleLayout" precedent the guards mirror.
- [tests/component/chart/Chart.test.ts:374](tests/component/chart/Chart.test.ts#L374) — the existing red regression test (primary gate); its `layout()` helper (`:48`) and `CONFIG` (`:15`) show the mount+size+settle setup to reuse.
- [tests/component/chart/ChartLegend.test.ts](tests/component/chart/ChartLegend.test.ts) — where the lower-level idempotency tests go.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — `installTestDOM`; its recording `requestAnimationFrame` never fires the callback, which is why the loop is detected via self-reschedule.

---

## Non-Goals

- **No production dev-mode self-reschedule guard.** Rejected in `## Architecture Decisions` — the offline helper covers the going-forward need without touching the hot layout path.
- **No fix for a panel the diagnostic shows is heavy-but-terminating.** Passive-render cost that doesn't self-reschedule is a different problem; report it, don't gate it here.
- **No change to `AbstractChart.reserveLegend` structure.** The gate lives in the legend; `reserveLegend` stays a straight-line reserve method.
- **No refactor of the existing Chart.test.ts regression test** to use the new helper — it is the pinned primary gate and stays inline.
- **No broadening of `ChartLegend`'s public API** — `entriesEqual` is private; no new options or events.

---

## Implementation Notes

- **Charts fix (steps 1–5) shipped exactly as planned.** `entriesEqual`/the `setEntries`/`setOrientation` guards, the `expectNoSelfReschedule` helper, and the ChartLegend idempotency tests all match the plan's `## Internal Structure` verbatim.
- **Deviation — provenance of the `Chart.test.ts` relayout-loop guard (corrects the plan's Files-table "not modified" claim).** The plan's Overview and Files table assert the red regression test "already exists in the main tree" and that `tests/component/chart/Chart.test.ts` is therefore not modified on this branch. That was true only of an *uncommitted* working-tree draft in a separate checkout — it was never a committed ancestor of this branch, and a git worktree branches from a commit, so it could not be inherited. The orchestrator carried that draft's diff into this worktree before dispatch; the test was then landed **verbatim (not rewritten)** as part of the fix commit `c9182217`, which is why git history shows the `describe('steady-state layout stability', …)` block as a pure branch addition rather than as a pre-existing unchanged commit. The test's content and role (primary gate, must go from "Number of calls: 2" to green) are exactly as the plan specifies; only its provenance differs from the plan's stated premise. Recorded here per the `implement` skill's "Deviating from the plan / record, don't hide it" rule.
- **Step 6 (live diagnostic) deviated from the plan's method and reached a weaker conclusion than "confirmed yes/no."** This worktree's dev server (`npm run dev` on the project's own port 8015) belongs to a different checkout; a second Vite instance was started from this worktree on port 8020 to serve the branch under test. The shared Chrome DevTools MCP browser instance turned out to be used concurrently by sibling `implement` sub-agents working other plans in the same orchestrated batch: a `list_pages` check mid-diagnostic showed the tab selection had been silently switched to another worktree's page (`localhost:8017`), and one `performance_start_trace`/`performance_stop_trace` pair was confirmed to have captured that *other* worktree's page, not this branch's Complex panel — that trace was discarded. After reselecting this worktree's page explicitly before every call, the `performance_start_trace` insights summary reported no named Insights (no long tasks, no forced reflow) for either panel, which is at best a weak negative signal — the tool only surfaces call-tree detail when it flags a specific Insight, and none was flagged for Complex or Properties (nor, as a sanity check, would it necessarily flag a scriptally-cheap-but-frequent rAF loop the way it flags a long task). As a second, independent probe, a `setTimeout(fn, 0)` throughput measurement (ticks completed in a fixed ~1.2 s window, a coarse proxy for main-thread contention) was taken back-to-back on Misc. (baseline), Complex, and Property Grid: Misc. 235 ticks, Complex 224 ticks, Property Grid 157 then 239 ticks on immediate repeat. The one low reading (Property Grid's first sample, taken immediately after the lazy-tab mount) reads as a one-shot construction/settle cost, not a steady-state loop — a repeat measurement on the same tab a few seconds later returned to baseline. None of the three showed the sustained ~30%+ throughput drop that would corroborate a continuous rAF→doLayout self-cycle at the magnitude the plan's ~13%/~8% CPU figures imply.
- **Conclusion: the diagnostic leans "no confirmed loop" for both Complex and Properties, but does not meet the plan's own bar for a "confirmed yes/no."** The plan's specified method (inspect the trace's call tree for a repeating rAF→`doLayout`→`doLayout` pattern) could not be executed as written because the `performance_start_trace` MCP tool only exposes detailed call-tree data when it auto-flags a named Insight, and none was flagged here. The fallback throughput probe is directional, not a rigorous confirm. Per `## Architecture Decisions` ("Complex/Properties fixes are contingent on the diagnostic") and the plan's own instruction not to fabricate a fix without confirmation, **step 7 was not attempted** — no `Body`/`Cell`/`CellRenderer` (or any other component) was touched, and no conditional test/fix was written for either panel. This is reported, not silently skipped: the Complex/Properties CPU cost the plan's Overview cites remains unconfirmed as this bug class and is out of scope for this branch. A follow-up diagnostic run in an isolated (non-shared) browser session, or with OS-level per-process CPU sampling instead of in-page JS proxies, would be needed to reach a conclusive answer.
