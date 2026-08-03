# Cell Chrome-Setter Idempotence — Implementation Plan

## Overview

This plan closes out the investigation opened by SQLAdmin's field notes into a
direction-sensitive cost in horizontal table scrolling, left open by
`table-scroll-forced-reflow`. That plan removed a forced-reflow penalty and
confirmed it fixed; a residual was found afterward where a **steady** 120px/frame
scroll cost 19.7ms/frame but the same delta **oscillating** (+120/−120
alternating) cost 343ms/frame — a ~17× gap — with a standing, unverified guess
that it came from the 0.4.0 column-recycling mechanism
([`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L273),
[`Header.reconcileColumnCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L485),
the shared
[`CellGeometryCache`](packages/lib/src/typescript/lib/component/table/CellGeometry.ts))
behaving asymmetrically with scroll direction.

**That hypothesis is refuted.** Direct instrumentation of the recycling path —
described under `## Addendum: What Was Measured` — never reproduces anything
close to a 17× gap in the library's own demo, across a mixed-type table, a
purpose-built homogeneous 60-column table, and an artificially inflated
stylesheet. The real, measured direction sensitivity is a modest ~1.3–1.8×,
fully explained by ordinary column-boundary-crossing arithmetic: a fixed
round-trip delta crosses a deterministic number of column boundaries every
time, while a monotonically accumulating scroll's crossings fluctuate
frame-to-frame between the floor and ceiling of that same average. There is no
cache-thrashing, no wrong-cell-recycled defect, and no free-list mismanagement.

**What actually dominates the per-frame cost, in both directions, is a real
defect:** [`Cell.setBaseBackground`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L309)
is called for **every rendered cell on every column-window reconcile** — not
just retargeted ones — by both
[`Row.setColumnWindow`](packages/lib/src/typescript/lib/component/table/Row.ts#L379)
and
[`Header.reconcileColumnCells`](packages/lib/src/typescript/lib/component/table/Header.ts#L577),
by design (`## Architecture Decisions` in `table-column-virtualization.md`
requires it, so a recycled cell can never keep a trace of its previous
column). `setBaseBackground` unconditionally calls the private
[`Cell._applyStateTint`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L323),
which unconditionally calls
[`Component.clearShadow`](packages/lib/src/typescript/lib/core/Component.ts#L2448)
(or `setShadow`) to resolve the required-empty outline. Unlike every sibling
chrome setter in the same file —
[`setBackgroundColor`](packages/lib/src/typescript/lib/core/Component.ts#L2054),
[`setBorderRadius`](packages/lib/src/typescript/lib/core/Component.ts#L2394) /
[`clearBorderRadius`](packages/lib/src/typescript/lib/core/Component.ts#L2409),
[`setTouchAction`](packages/lib/src/typescript/lib/core/Component.ts#L2352) /
[`clearTouchAction`](packages/lib/src/typescript/lib/core/Component.ts#L2367)
— `setShadow` and `clearShadow` carry no idempotence guard against the cached
`_options.shadow` value, so every reconcile rewrites a shared-stylesheet
`boxShadow` declaration for the whole rendered window even when nothing
changed. Measured directly: a single one-column window slide, on a table with
no required or group-colored columns configured, fires ~380 provably-no-op
`{"boxShadow":"none"}` writes into the shared stylesheet.

The fix is two missing guard clauses in
[`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts),
mirroring the pattern its own sibling setters already use. Nothing in the
column-recycling mechanism changes.

---

## Architecture Decisions

### The direction-sensitive-recycling hypothesis is refuted, not extended

`CellGeometryCache.apply` and `Row.setColumnWindow` were instrumented directly
(hit/miss counts, retarget counts) rather than reasoned about from the source.
Oscillation causes at most ~2× more geometry-cache misses than a steady
advance at the same delta — proportional to genuinely extra column-boundary
crossings, not an identity-churn defect.[^refutation-evidence] No change is
made to `Row.ts`, `Header.ts`, `Body.ts`, `CellGeometry.ts`, or `Table.ts`.

### The fix is the missing idempotence guard on `setShadow` / `clearShadow`, not a change to `_applyStateTint`

The guard belongs on the primitive setters in `core/Component.ts`, not on
`Cell.setBaseBackground` or `Cell._applyStateTint`. Gating `setBaseBackground`
on whether its own `color` argument changed would be **wrong**, not just
narrower: `_applyStateTint`'s output depends on `_readOnly` and
`_requiredEmpty` too, so the same `color` argument can legitimately need a
different resolved shadow. Gating at `setShadow` / `clearShadow` themselves —
comparing against the final CSS value each already caches in
`_options.shadow` — is correct regardless of which upstream path reached
them, and matches exactly how `setBackgroundColor`
([Component.ts:2054](packages/lib/src/typescript/lib/core/Component.ts#L2054))
and `clearBorderRadius`
([Component.ts:2409](packages/lib/src/typescript/lib/core/Component.ts#L2409))
already guard.[^why-not-cell] This also fixes every other `setShadow` /
`clearShadow` call site in the framework (editors, `Header`'s focus
underline, `Menu`, `Popover`, `Dialog`, `Notification`, and others), not only
the table's.

### The redundant-write fix does not, by itself, close the reported gap — and the plan says so

Removing ~90% of the redundant `setRuleStyles` calls cuts wall-clock frame
time by only ~10–12%, proving call count is not what dominates; browser-side
style-recalculation cost — confirmed to scale with total shared-stylesheet
size, independent of this bug — dominates instead.[^recalc-dominant] That
remaining, sheet-size-dependent cost is the domain of the sibling
stylesheet-leak investigation (`plans/table-tab-close-residual-leak.md`
and the `dock-disposes-tab-content` / `component-purges-event-listeners`
chain this branch already carries), not of this plan. This plan fixes the one
concrete, verifiable defect it found and states plainly that it is not the
whole story.

---

## Internal Structure

Current (`core/Component.ts`):

```typescript
setShadow(shadow: string): this {
    this._options.shadow = shadow;
    this.setElementCSSRule("boxShadow", shadow);

    return this;
}

clearShadow(): this {
    this._options.shadow = undefined;
    this.setElementCSSRule("boxShadow", "none");

    return this;
}
```

Fixed, matching `clearBorderRadius`'s existing guard shape exactly:

```typescript
setShadow(shadow: string): this {
    if (this._options.shadow === shadow) {
        return this;
    }

    this._options.shadow = shadow;
    this.setElementCSSRule("boxShadow", shadow);

    return this;
}

clearShadow(): this {
    if (this._options.shadow === undefined) {
        return this;
    }

    this._options.shadow = undefined;
    this.setElementCSSRule("boxShadow", "none");

    return this;
}
```

---

## Ordered Implementation Steps

1. **Add the guard to `setShadow`** ([Component.ts:2435](packages/lib/src/typescript/lib/core/Component.ts#L2435)): insert `if (this._options.shadow === shadow) { return this; }` as the first statement, before the existing body. Check: `npm run typecheck`.

2. **Add the guard to `clearShadow`** ([Component.ts:2448](packages/lib/src/typescript/lib/core/Component.ts#L2448)): insert `if (this._options.shadow === undefined) { return this; }` as the first statement, before the existing body.

3. **Update the JSDoc** on both methods to note they are idempotent — a repeat call with the same (or, for `clearShadow`, already-absent) value writes nothing — matching `clearBorderRadius`'s doc style. Do not change the public signatures.

4. **Add offline regression coverage in `tests/component/Component.test.ts`**, in a new `describe('Component — setShadow / clearShadow idempotence', ...)` block styled after the existing `describe('Component — destructor disposes style rules', ...)` block at [Component.test.ts:368](packages/lib/tests/component/Component.test.ts#L368) (`beforeEach(() => installTestDOM(DOM_CONFIG)); afterEach(() => DOM.reset());`, `const sink = DOM.sink as RecordingDOMSink;`). Cover the four cases in `## Expected Behaviour`, using `ruleStyleWrites(sink)` from [`tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts#L757) filtered to `key === 'boxShadow'`.

5. **Add the Cell-specific regression in `tests/component/table/cell/Cell.test.ts`**, inside the existing `describe('Cell background/cursor/outline state precedence', ...)` block ([Cell.test.ts:92](packages/lib/tests/component/table/cell/Cell.test.ts#L92)), right after the existing `'setRequiredEmpty is idempotent...'` case at [Cell.test.ts:154](packages/lib/tests/component/table/cell/Cell.test.ts#L154). This pins the exact reported path: `setBaseBackground` (not `setRequiredEmpty`) reaching `clearShadow` with nothing to change.

6. **Run the full verification** in `## Verification`, including the browser control that repeats the steady-vs-oscillating measurement.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Cell.test.ts` |

---

## Expected Behaviour

Unit-testable offline (`installTestDOM` + `RecordingDOMSink`, per the existing
`Component.test.ts` / `Cell.test.ts` patterns):

1. `setShadow('x')` on a rendered component, then `setShadow('x')` again: the second call produces zero additional `setRuleStyles` writes with a `boxShadow` key (assert via `ruleStyleWrites(sink)`), and `getShadow()` still reports `'x'`.
2. `setShadow('x')` then `setShadow('y')`: the second call **does** write — a changed value is never swallowed.
3. `clearShadow()` on a component that never had a shadow set: zero `boxShadow` writes reach the sink, and `getShadow()` reports `null`.
4. `setShadow('x')` then `clearShadow()` then `clearShadow()` again: the first `clearShadow()` writes `boxShadow: 'none'`; the second writes nothing additional.
5. (Cell-specific) On an `editableCell()` with no group color and no required-empty state, calling `cell.setBaseBackground(null)` twice in a row — mirroring what `Row.setColumnWindow`'s Pass 3 does on every reconcile for an unretargeted, ungrouped cell — produces a `setShadow`/`clearShadow` call (spy) only on the first call, not the second.
6. (Existing, must stay green) `tests/component/table/cell/Cell.test.ts`'s `'setRequiredEmpty is idempotent'` case and the full `'Cell background/cursor/outline state precedence'` block — the guard must not change any of read-only/required-empty/base-background precedence, only suppress a redundant re-write of the same resolved value.

Manual verification (browser only — this is a frame-timing effect the offline
harness cannot model):

7. The steady-vs-oscillating control under `## Verification` shows the same
   ~90% cut in redundant `setRuleStyles` calls, and a modest (not dramatic)
   wall-clock improvement, on both the library's own 45-column demo table and
   a rebuild of SQLAdmin's `wide.cols_60` if available — confirming the fix's
   effect matches what this plan predicts rather than closing the full gap.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test          # includes the new Component.test.ts / Cell.test.ts cases
npm run lint          # local/require-content-bounds and local/no-raw-dom must pass unchanged
npm run test:lint
npm run docs:api      # must finish with zero warnings
grep -n 'this._options.shadow ===' src/typescript/lib/core/Component.ts   # expect two matches (setShadow, clearShadow)
```

Also re-run the `table-scroll-forced-reflow` branch's own baseline before
making changes, and again after, to confirm no regression: the `BorderWidths`
cache tests, the Content Box demo's manual check, and
`local/require-content-bounds`'s empty baseline.

**Steady-vs-oscillating control (repeats this investigation's own finding
so the fix is checkable the same way the defect was found).** `npm run dev`
in `packages/lib`, open the demo, go to **Misc**, click *"Show window with
wide table (45 columns)!"*. In the console — this drives
`VirtualScroller.setScrollX` directly rather than dispatching `WheelEvent`s,
because real wheel input first passes through `SmoothScroller`'s
frame-rate-independent easing loop, which does not correspond 1:1 with a
single dispatched event and would confound the timing.[^smooth-scroller-confound]

```javascript
const scrollerMod = await import('/src/typescript/lib/component/container/VirtualScroller.ts');
const domMod      = await import('/src/typescript/lib/core/DOM.ts');

const ruleStats = { calls: 0 };
const origSetRuleStyles = domMod.DOM.sink.setRuleStyles.bind(domMod.DOM.sink);
domMod.DOM.sink.setRuleStyles = (...args) => { ruleStats.calls++; return origSetRuleStyles(...args); };

const origSetScrollX = scrollerMod.VirtualScroller.prototype.setScrollX;
scrollerMod.VirtualScroller.prototype.setScrollX = function (x) { window.__scroller = this; return origSetScrollX.call(this, x); };

document.querySelector('td').dispatchEvent(new WheelEvent('wheel', { deltaX: 10, bubbles: true, cancelable: true }));
await new Promise(r => requestAnimationFrame(r));

const sweep = async (pattern) => {  // pattern: 'steady' | 'oscillating'
    const s = window.__scroller;
    const base = 1500;
    s.setScrollX(base);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    let x = base;
    const frames = [];
    for (let i = 0; i < 40; i++) {
        const before = ruleStats.calls;
        const t0 = performance.now();
        x = pattern === 'steady' ? x + 120 : (i % 2 === 0 ? base + 120 : base);
        s.setScrollX(x);
        await new Promise(r => requestAnimationFrame(r));
        frames.push({ ms: performance.now() - t0, rw: ruleStats.calls - before });
    }
    const total = frames.reduce((a, f) => a + f.ms, 0);
    return { avgMs: Math.round(total / 40 * 10) / 10, avgRuleWrites: Math.round(frames.reduce((a, f) => a + f.rw, 0) / 40) };
};

console.log('steady:      ', await sweep('steady'));
console.log('oscillating: ', await sweep('oscillating'));
```

**Before this fix**, on this investigation's own run (dev build, clean
~2100-rule shared stylesheet): `steady` ≈ 28.0ms/frame, 387 rule-writes/frame;
`oscillating` ≈ 47.0ms/frame, 526 rule-writes/frame (ratio ≈1.7×, not the
field-reported 17×). **After this fix**, expect rule-writes to drop ~90% in
both patterns (steady ≈44/frame, oscillating ≈174/frame) and wall time to
drop only modestly (steady ≈24–25ms/frame, oscillating ≈43–44ms/frame) — the
steady-vs-oscillating **ratio stays roughly the same** (≈1.7–1.8×), which is
the expected, correct outcome: this fix removes waste, not the residual,
non-pathological direction sensitivity described in `## Non-Goals`.

---

## Potential Challenges

- **A caller relying on `setShadow` always re-writing, even with an unchanged value, would silently stop working.** No such caller exists: `setShadow` / `clearShadow` only ever affect the element's own `boxShadow` declaration, and every other chrome setter in the same file already behaves this way with no reported issue. Verify with the full `npm run test` suite, not just the two new test files, since `setShadow` has ~20 call sites across the framework (editors, `Header`, `Menu`, `Popover`, `Dialog`, `Notification`, `Slider`, `Toggle`, and others).
- **The fix could look like it "didn't work" if judged by wall-clock time alone.** `## Verification`'s expected numbers are stated explicitly (a large rule-write drop, a small time drop) so this isn't mistaken for a failed fix.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts:2054-2453`](packages/lib/src/typescript/lib/core/Component.ts#L2054) — `setBackgroundColor`, `setBorderRadius`/`clearBorderRadius`, `setTouchAction`/`clearTouchAction` (the guarded precedent), `setShadow`/`clearShadow` (the fix site).
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts:309-342`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L309) — `setBaseBackground`, `_applyStateTint` (the call chain that reaches the defect; not edited).
- [`packages/lib/src/typescript/lib/component/table/Row.ts:371-384`](packages/lib/src/typescript/lib/component/table/Row.ts#L371) — `setColumnWindow`'s Pass 3, which calls `setBaseBackground` unconditionally for every rendered cell every reconcile (by design; not edited).
- [`packages/lib/src/typescript/lib/component/table/Header.ts:485-586`](packages/lib/src/typescript/lib/component/table/Header.ts#L485) — `reconcileColumnCells`'s equivalent Pass 3 (not edited).
- [`packages/lib/src/typescript/lib/component/table/CellGeometry.ts`](packages/lib/src/typescript/lib/component/table/CellGeometry.ts) — the cell-keyed geometry cache the refuted hypothesis targeted; read to confirm it is direction-agnostic by construction (keyed on cell identity, not slot or direction).
- [`plans/table-scroll-forced-reflow.md`](plans/table-scroll-forced-reflow.md) — the direct precedent for this plan's measurement discipline (A/B via live-patching, `## Addendum: What Was Measured` shape, dev-vs-prod caveat).
- [`plans/implemented/table-column-virtualization.md`](plans/implemented/table-column-virtualization.md) and [`plans/implemented/table-header-column-virtualization.md`](plans/implemented/table-header-column-virtualization.md) — establish the "re-apply every per-column property on every reconcile, unconditionally" invariant that makes `setBaseBackground` fire on every rendered cell; this plan does not weaken that invariant.
- [`packages/lib/tests/component/Component.test.ts:368-396`](packages/lib/tests/component/Component.test.ts#L368) — the `installTestDOM` + `RecordingDOMSink` pattern the new tests follow.
- [`packages/lib/tests/component/table/cell/Cell.test.ts:92-163`](packages/lib/tests/component/table/cell/Cell.test.ts#L92) — the existing state-precedence suite the new Cell-specific case extends; its `'setRequiredEmpty is idempotent'` case already documents the intended contract this plan actually delivers.
- [`packages/lib/tests/dom/TestDOM.ts:757-776`](packages/lib/tests/dom/TestDOM.ts#L757) — `ruleStyleWrites`, the assertion helper both new test cases use.
- [`packages/lib/src/typescript/lib/core/SmoothScroller.ts`](packages/lib/src/typescript/lib/core/SmoothScroller.ts) — the wheel-input easing loop that confounds a naive `WheelEvent`-per-frame measurement harness; read before writing any new browser-timing script against this table.

---

## Non-Goals

- **No change to the column-recycling mechanism** (`Row.setColumnWindow`, `Header.reconcileColumnCells`, `CellGeometryCache`, `computeColumnWindow`, `COLUMN_BUFFER`). The investigation refutes a defect there; there is nothing to fix.
- **No change to `SmoothScroller` or wheel/touch input handling.** It was investigated as a possible source of the reported gap (a naive per-wheel-tick timing harness can wildly under- or over-count actual render passes) and ruled out as a *measurement* confound, not a *product* defect — its own steady-state easing behaves correctly.
- **Closing the full field-reported gap.** This plan fixes one confirmed, real defect. The dominant remaining per-frame cost is browser style-recalculation scaling with total shared-stylesheet size (confirmed in `## Addendum: What Was Measured`), which is the stylesheet-leak family of defects' domain (`plans/table-tab-close-residual-leak.md` and the Dock-disposal chain), not this plan's.
- **Guarding `setOutline` / `clearOutline`.** Grep confirms they have the same missing-guard shape as `setShadow` / `clearShadow` ([Component.ts:2472](packages/lib/src/typescript/lib/core/Component.ts#L2472), [Component.ts:2485](packages/lib/src/typescript/lib/core/Component.ts#L2485)), but nothing on the table's per-frame scroll path calls them, so fixing them here would be an unrelated, unverified change riding along on this plan's evidence. Worth a follow-up, not part of this one.

---

## Addendum: What Was Measured

All figures from the library's own demo (`packages/lib`, `npm run dev`),
MiscPanel's *"Show window with wide table (45 columns)!"* (400 rows, ~30
rendered rows, `autoSizeColumns: true`, mixed string/number/date/boolean
columns), unless noted otherwise. Every control drives
`VirtualScroller.setScrollX` directly (captured via a patched
`VirtualScroller.prototype.setScrollX`), not `WheelEvent` dispatch — see
`SmoothScroller`'s easing loop, below.

**The `WheelEvent`-per-frame harness does not measure what it looks like it
measures.** `VirtualScroller`'s wheel handler
([`consumeWheel`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L29))
feeds `SmoothScroller.scrollBy`, which *accumulates* the delta into a moving
target and eases toward it over a `requestAnimationFrame` chain independent
of the dispatching code (`SMOOTH_FACTOR = 0.75`: each frame closes ~25% of the
remaining gap). Dispatching one `WheelEvent` and awaiting one
`requestAnimationFrame` does not correspond to "one render pass" — the
easing loop may still be mid-flight, or may have already finished, depending
on timing unrelated to the dispatch. Confirmed directly: dispatching a
`+120/−120`-alternating `WheelEvent` sequence at one dispatch per
`requestAnimationFrame` over 700ms of wall-clock time produced **zero**
`Body.renderWindow` calls, because the two deltas cancel at the *target*
level before the easing loop ever significantly moves — the opposite of
"expensive." This is why every control below bypasses `SmoothScroller`
entirely via direct `setScrollX` calls, matching what "a fixed 120px/frame
delta" in the field notes most plausibly means.

**Refuting the recycling-identity hypothesis.** `CellGeometryCache.apply` and
`Row.setColumnWindow` were patched to count hits/misses and window changes.
At a fixed 120px delta, on a clean ~2100-rule stylesheet:

| Pattern | avg ms/frame | avg `setRuleStyles`/frame | Geometry-cache misses on a changed frame |
|---|---|---|---|
| steady advance | 28.0 | 387 | ~30 (≈1 column × ~30 rows) |
| oscillating (+120/−120) | 47.0 | 526 | ~59 (≈2 columns × ~30 rows) |

Ratio ≈1.7×, not 17×. The miss-count difference (~2×) is exactly what a fixed
120px round-trip against ~111px-wide columns predicts: a round trip
deterministically crosses ~2 column boundaries every time, while a
monotonically accumulating advance's crossings fluctuate between 1 and 2 as
fractional progress accrues. Rebuilt against a **purpose-built homogeneous
60-column, all-`string`-type table** (maximising the cell-recycling free
list's ambiguity, since every column shares one reuse key) — same
qualitative result, ratio ≈1.1–1.7×, never approaching a pathological
blowup. There is no evidence of cache-thrashing or misdirected recycling.

**Sheet-size dependence is real but direction-neutral.** Inflating the demo's
shared `<style id="Base">` stylesheet from 2,392 to 17,392 rules (15,000
synthetic `.__dummy_N` rules, no code change) roughly doubled cost in *both*
directions: steady 28.9→56.0ms/frame (1.94×), oscillating 33.9→82.8ms/frame
(2.44×). A symmetric multiplier cannot, by itself, explain a directional
gap — but it independently confirms LIBRARY_NOTES's previously-unconfirmed
second hypothesis ("plain style-recalculation cost scaling with the shared
stylesheet's rule count, regardless of any read").

**Finding the real defect.** `DOM.sink.setRuleStyles` was patched to record
call-site stack traces and payloads. A single one-column window slide, on the
demo table (no required or group-colored columns configured — every write
below is provably a no-op), produced:

| Call site | Count | Payload |
|---|---|---|
| `DateCell.commitCSSRule` ← `setElementCSSRule("boxShadow", ...)` | 87 | `{"boxShadow":"none"}` |
| `BooleanCell.commitCSSRule` ← same | 87 | `{"boxShadow":"none"}` |
| `StringCell.commitCSSRule` ← same | 87 | `{"boxShadow":"none"}` |
| `NumberCell.commitCSSRule` ← same | 87 | `{"boxShadow":"none"}` |
| `HeaderCell.commitCSSRule` ← same | 33 | `{"boxShadow":"none"}` |

381 redundant writes from one slide. Traced to `Row.setColumnWindow`'s Pass 3
and `Header.reconcileColumnCells`'s equivalent pass calling
`Cell.setBaseBackground` for every rendered cell every reconcile (by design),
cascading through the unguarded `_applyStateTint` → `Component.clearShadow`.

**Before / after, live-patched with the guard from this plan** (clean
~2100-rule sheet, same 40-frame direct-`setScrollX` sweep):

| | avg ms/frame (steady) | avg rule-writes/frame (steady) | avg ms/frame (oscillating) | avg rule-writes/frame (oscillating) |
|---|---|---|---|---|
| before | 28.0 | 387 | 47.0 | 526 |
| after | 24.5 | 44 | 43.5 | 174 |
| change | −12.5% | −88.7% | −7.4% | −66.9% |

Rule-writes drop ~90%; wall time drops only ~10%. The steady-vs-oscillating
ratio is unchanged by the fix (1.68× before, 1.78× after) — direct proof the
redundant-write bug was never the source of the directional gap, only of the
absolute waste. The dominant remaining cost is the sheet-size-dependent
recalculation confirmed above, out of this plan's scope.

---

## Notes

[^refutation-evidence]: Full instrumentation methodology and numbers in
    `## Addendum: What Was Measured`. In short: `CellGeometryCache.prototype.apply`
    and the raw `_Row.prototype.setColumnWindow` (imported directly from the
    dev server's module URLs so the exact runtime classes are patched, not a
    copy) were wrapped to count cache hits/misses and window-changed calls.
    Across a mixed-type 45-column table, a homogeneous 60-column table, and
    both a normal and a 17,000-rule-inflated stylesheet, oscillation never
    produced more than ~2× the geometry-cache misses of a steady advance at
    the same delta — proportional to genuinely extra column crossings, never
    a runaway multiplier.

[^why-not-cell]: A narrower fix — have `Cell.setBaseBackground` compare its
    `color` argument against the cached `_baseBackground` before calling
    `_applyStateTint` — was considered and rejected. It would only suppress
    the write when `color` itself is unchanged, but `_applyStateTint`'s
    shadow output also depends on `_readOnly` and `_requiredEmpty`, which
    `setBaseBackground` does not see. A cell whose `color` argument repeats
    but whose `_requiredEmpty` flag changed between calls would then wrongly
    skip a shadow write it needs. Guarding at `setShadow` / `clearShadow`
    themselves compares the actual value about to be written, which is
    correct regardless of which upstream state changed it, and is the
    approach every sibling chrome setter in `core/Component.ts` already
    takes.

[^recalc-dominant]: Measured by live-patching the guard into the running page
    and re-running the same instrumented sweep used to characterise the
    defect — see the "Before / after" table in `## Addendum: What Was
    Measured`. An ~89% cut in `setRuleStyles` call count produced only a
    ~10–12% cut in wall-clock frame time, which is inconsistent with call
    count being the dominant cost and consistent with the separately-measured
    sheet-size-inflation result (a 7.3× larger stylesheet, zero code change,
    roughly doubled cost in both directions).

[^smooth-scroller-confound]: `core/SmoothScroller.ts`'s `step()` method calls
    `this._target.write(...)` — which triggers the owner's `_onScroll` (and
    so a full `Body.renderWindow` pass) — on every animation frame the easing
    loop is mid-flight, independent of how many `WheelEvent`s were dispatched
    or when. A harness that dispatches one `WheelEvent` and awaits exactly
    one `requestAnimationFrame` per logical "test frame" therefore measures
    an arbitrary, timing-dependent slice of the easing loop's real work, not
    one render pass. This was discovered by comparing a wheel-driven
    oscillating sweep (near-zero measured cost, because a `+120/−120`
    sequence cancels at the target level before the loop moves far) against
    a direct-`setScrollX` oscillating sweep (the real, reproducible ~1.7×
    cost characterised in this plan) — the two harnesses disagree by more
    than an order of magnitude on the same nominal input, which is why every
    control in this plan drives `setScrollX` directly.
