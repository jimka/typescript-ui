---
depends-on: [border-region-size-memo]
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts, packages/lib/src/typescript/lib/layout/Border.ts]
---

# Size-hint per-pass memo — Implementation Plan

## Overview

`Component.getPreferredSize()`, `getMinSize()` and `getMaxSize()` each walk the component's whole subtree and none of them remembers the answer. A Loom drag frame on the 2×2 editor grid makes 2,875 such calls, out of 2,969 counted calls of every kind. The campaign's synthesis lists "size hints are never memoised" as one of its recurring defects.

This plan gives every `Component` a small record of its own three size hints, valid for as long as nothing can have changed them, and serves repeat questions from it. The record sits inside [`getPreferredSize`](packages/lib/src/typescript/lib/core/Component.ts#L3553), [`getMinSize`](packages/lib/src/typescript/lib/core/Component.ts#L3720) and [`getMaxSize`](packages/lib/src/typescript/lib/core/Component.ts#L3754) themselves, so no caller changes shape.

**This is not a frame-time change and does not claim to be one.** A runtime ablation of the idea took S1's size-hint calls from 2,875 to 946 and the frame got 0.58 ms *slower*; on S3 it saved 1.29 ms against a 1.04 ms run-to-run drift. The justification is work avoided at flat render time, and the scaling argument behind it: these counts track the component tree, and the resolution is recursive, so the total is roughly O(n·depth) uncached against O(n) memoised.[^scaling]

The ablation also **changed S1's geometry**, and this plan exists to be correct where it was not. Measurement here found the recorded diagnosis incomplete: keying the record on the *frame* is wrong, as the record says, but keying it on the *layout pass* alone is wrong too — a component's size hints can legitimately change part-way through a single pass.[^diagnosis] The record is therefore keyed on the pass **and** on a library-wide counter of writes that could change a size hint.

Line numbers below are as of `master` at 7247b948. The `border-region-size-memo` plan edits `core/Component.ts` first and will shift them; the symbol names are authoritative.

---

## Architecture Decisions

### The record is keyed on the layout pass and a size-hint generation

A record entry carries two numbers: the layout pass it was taken in, and the value of a module-level `sizeHintGeneration` counter at that moment. An entry answers a later question only when **both** still match.

A **layout pass** is one outermost `Component.doLayout()` call — from the moment layout work starts at the top of some component until it returns, including everything it recurses into. This is the definition and the counter [`border-region-size-memo`](plans/border-region-size-memo.md) introduces, reused unchanged; `Component.currentLayoutPass()` returns `0` when no pass is running, and nothing is recorded then.[^depends]

The **size-hint generation** is a single library-wide integer, bumped by every write that could change what any component reports. It is the same device [`Util.textMetricsGeneration()`](packages/lib/src/typescript/lib/core/Util.ts#L294) already gives `Text`, which stashes the counter's value with its measurement and re-measures when the two stop matching.[^generation-precedent]

Worked cases, with the pass numbered 7 and the generation at 12:

| Moment | Pass | Generation | Result |
|---|---|---|---|
| Application code asks a panel for its preferred size, no layout running | 0 | 12 | live read, nothing recorded |
| A host's `doLayout` asks a child for its preferred size, first time | 7 | 12 | live read, recorded as `(7, 12)` |
| Same pass asks the same child again while resolving bounds | 7 | 12 | **served from the record** |
| The host commits the child's rectangle, which lays the child out | 7 | **13** | — |
| Same pass asks the child again after that commit | 7 | 13 | generation moved: live read, recorded as `(7, 13)` |
| A later pass in the same animation frame asks the child | 8 | 13 | pass moved: live read, recorded as `(8, 13)` |

### The generation is bumped at six places

`invalidateSizeHints()` — a module-level function in `core/Component.ts` that increments the counter — is called from:

| Site | Why |
|---|---|
| `doLayout()`, in the `finally` | Laying a subtree out changes what it reports next: a flow re-wraps, a `Text` re-measures at its new width, a foreign-DOM leaf republishes its height. |
| `scheduleLayout()` | The library's own announcement that something changed which layout must react to. Structural changes, manager config, and every setter that relays through `wireChild`'s slots reach it. |
| `writeStyle()` | The single funnel for `minSize`, `maxSize`, `padding`, `border`, `visible` and `displayed` — every layering property a size hint reads. It is already where `_resolvedCache` is cleared. |
| `setInsets()` / `clearInsets()` | Insets feed `getContentInsets()` and `getPerimeterSize()`, which every aggregating manager reads, and neither setter reaches the two sites above. `Tab.doLayout` calls `setInsets` on its strip *inside* a layout pass.[^insets] |
| `setPreferredSize()` / `clearPreferredSize()` | The preferred-size constraint, written on a component that may have no parent and therefore no relay to `scheduleLayout`. |
| `setLayoutManager()` | Swaps the source of all three reports. |

Over-bumping costs cache hits and is never wrong, so a writer that reaches two of these sites is fine. A writer that reaches none of them serves a stale hint — and only for the rest of the layout pass it happened in, because the pass number turns over and nothing is recorded outside a pass.[^exposure]

### A result is recorded only when the generation held still while it was computed

Each getter reads the pass and the generation once on entry, computes, then records only if `sizeHintGeneration` is still the value it read. A computation that bumped the generation part-way — a `Text` lazily re-measuring inside it is the standard case — returns its answer and records nothing.[^entry-exit]

### `Border`'s per-pass region record honours the same generation

[`border-region-size-memo`](plans/border-region-size-memo.md) gives `Border` a record of each region's `{preferred, min, max}` keyed on the pass alone, dropped when `Border.doLayout` returns. That key has the gap this plan's measurement found: a region's subtree can republish its size mid-pass without `Border.doLayout` returning — which is exactly what `Border`'s CENTER region does in Loom, where it holds a `CodeEditor`. `Border.passRecord` gains the generation as a second condition, so the two records never disagree.[^border-consistency]

### The memo is on for every component, in one step, with no opt-in list

No `memoizesSizeHints()` predicate and no staged per-class rollout. The hazard this change carries is temporal — a hint that goes stale *during* a pass — and an opt-in list cannot make a temporal bug safe, only hide it in fewer places.[^no-opt-in]

---

## Internal Structure

New module-level state in `core/Component.ts`, beside the layout-queue state at [:179-183](packages/lib/src/typescript/lib/core/Component.ts#L179):

```ts
// Bumped by every write that could change what a size hint reports. A record
// taken at one value of this counter is stale at any other. Mirrors the
// `Util.textMetricsGeneration()` counter `Text` compares its own measurement
// against.
let sizeHintGeneration: number = 0;

/** Discards every recorded size hint in the library. */
function invalidateSizeHints(): void {
    sizeHintGeneration++;
}
```

One new `@internal` static on `Component`, so `Border` can read the counter from its own module. `typedoc.json` sets `excludeInternal`, so this adds no public surface:

```ts
class Component {
    /** @internal */
    static currentSizeHintGeneration(): number;
}
```

New instance fields on `Component`, beside `_resolvedCache` at [:682](packages/lib/src/typescript/lib/core/Component.ts#L682):

```ts
// This component's own three size reports as computed for one (pass,
// generation) pair. `undefined` means "not asked yet"; `null` is a real
// answer meaning the component reports no size, and is re-served as one.
private _sizeHintPass       : number = 0;
private _sizeHintGeneration : number = 0;
private _sizeHintPreferred  : Size | null | undefined = undefined;
private _sizeHintMin        : Size | null | undefined = undefined;
private _sizeHintMax        : Size | null | undefined = undefined;
```

One private helper:

```ts
/**
 * Re-bases this component's size-hint record onto `(pass, generation)`,
 * discarding the three slots when either number has moved.
 */
private beginSizeHintRecord(pass: number, generation: number): void {
    if (this._sizeHintPass === pass && this._sizeHintGeneration === generation) {
        return;
    }

    this._sizeHintPass       = pass;
    this._sizeHintGeneration = generation;
    this._sizeHintPreferred  = undefined;
    this._sizeHintMin        = undefined;
    this._sizeHintMax        = undefined;
}
```

Each getter takes the same shape. `getMaxSize` in full; `getMinSize` is identical against `_sizeHintMin` and its own `mergeConstraintSize` call:

```ts
getMaxSize(): Size | null {
    const pass       = Component.currentLayoutPass();
    const generation = sizeHintGeneration;

    if (pass !== 0 && this._sizeHintPass === pass && this._sizeHintGeneration === generation
        && this._sizeHintMax !== undefined) {
        return this._sizeHintMax;
    }

    const result = this.mergeConstraintSize(
        this.getMaxSizeConstraint(), this.getLayoutManager().getMaxSize(), Math.min, UNBOUNDED);

    if (pass !== 0 && sizeHintGeneration === generation) {
        this.beginSizeHintRecord(pass, generation);
        this._sizeHintMax = result;
    }

    return result;
}
```

`getPreferredSize` keeps its whole existing body — the constraint-or-manager lookup, the early `null` return, and the `clampPreferredToConstraints` call against the component's *own* min/max constraints — between the same two guards, with the early `null` return recorded like any other answer.

---

## Ordered Implementation Steps

Steps 1–8 are all in `packages/lib/src/typescript/lib/core/Component.ts`.

1. **Add the generation counter and its invalidator.** Next to `let rafHandle: number | null = null;` ([:183](packages/lib/src/typescript/lib/core/Component.ts#L183)), add `sizeHintGeneration` and `invalidateSizeHints()` exactly as in `## Internal Structure`. Then add `static currentSizeHintGeneration(): number` returning the counter, with `@internal` in its JSDoc, next to `static afterNextLayout` ([:7625](packages/lib/src/typescript/lib/core/Component.ts#L7625)).

2. **Bump it when a layout pass's work finishes.** In `doLayout()` ([:7440](packages/lib/src/typescript/lib/core/Component.ts#L7440)), add `invalidateSizeHints();` to the `finally` block `border-region-size-memo` put there, after `layoutPassDepth--`. Do not add a second `try`.

3. **Bump it in `scheduleLayout()`** ([:7566](packages/lib/src/typescript/lib/core/Component.ts#L7566)) — first statement, before `this._layoutDirty = true;`, so a paused component still invalidates.

4. **Bump it in `writeStyle()`** ([:5830](packages/lib/src/typescript/lib/core/Component.ts#L5830)) — on the line after `this._resolvedCache = null;`, with a comment saying the two memos are invalidated by the same writes.

5. **Bump it in the five options-bag writers that reach neither of the above:** `setInsets` ([:2646](packages/lib/src/typescript/lib/core/Component.ts#L2646)), `clearInsets` ([:2671](packages/lib/src/typescript/lib/core/Component.ts#L2671)), `setPreferredSize` ([:3613](packages/lib/src/typescript/lib/core/Component.ts#L3613)), `clearPreferredSize` ([:3641](packages/lib/src/typescript/lib/core/Component.ts#L3641)), and in `setLayoutManager` ([:7348](packages/lib/src/typescript/lib/core/Component.ts#L7348)). Place each call *after* the setter's own same-value early return, so an unchanged write costs no cache; `setLayoutManager` has no such guard, so its call goes just before `return this`.

6. **Add the five record fields** beside `_resolvedCache` ([:682](packages/lib/src/typescript/lib/core/Component.ts#L682)), with the comment from `## Internal Structure`.

7. **Add `beginSizeHintRecord`** immediately above `getPreferredSize` ([:3553](packages/lib/src/typescript/lib/core/Component.ts#L3553)).

8. **Wrap the three getters** — `getPreferredSize` ([:3553](packages/lib/src/typescript/lib/core/Component.ts#L3553)), `getMinSize` ([:3720](packages/lib/src/typescript/lib/core/Component.ts#L3720)), `getMaxSize` ([:3754](packages/lib/src/typescript/lib/core/Component.ts#L3754)) — per `## Internal Structure`. Keep each body verbatim between the guards; in particular keep `getPreferredSize`'s comment explaining why it clamps to its own constraints rather than the merged ones. Extend each method's JSDoc with one sentence saying the answer is recorded for the rest of the layout pass unless something writes, and that the returned `Size` must not be modified by the caller. Do not `{@link}` the private helper or the `@internal` pass accessor from these public doc comments.

9. **`layout/Border.ts` — fold the generation into the region record.** `border-region-size-memo` creates a `passRecord` method and a `_regionSizesPass` field there. Add `private _regionSizesGeneration: number = 0;` beside `_regionSizesPass`, and in `passRecord` read `Component.currentSizeHintGeneration()` alongside `Component.currentLayoutPass()`, clearing `_regionSizes` when *either* number differs from the stored pair. Check: a region record must not survive a `Component.doLayout()` on any component.

10. **Add `packages/lib/tests/component/core/Component.sizeHintMemo.test.ts`** covering every case in `## Expected Behaviour`. Model the scenes on the existing layout suites: `installTestDOM`, a `Container` root, one `Container` per nesting level.

11. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Create | `packages/lib/tests/component/core/Component.sizeHintMemo.test.ts` |

---

## Expected Behaviour

Every case below is unit-testable under the modelled DOM harness. The four marked **(design gate)** are the ones that separate a correct implementation from the ablation's; each was run against a runtime simulation of this design, and against a frame key and a pass key, before this plan was written.[^matrix]

**1. Repeat questions asked with no intervening write collapse into one.** On a `Border`-hosted scene — five regions, each a `Container` of 2–3 leaves, 19 components, driven by one unchanged `root.doLayout()` — the total number of `getPreferredSize` + `getMinSize` + `getMaxSize` calls anywhere in the tree falls from **281 to 265**. On the nested scene of case 9 the same total falls by more than 45%. Assert the direction and a generous bound, not either exact number: both were measured before `border-region-size-memo` landed, and its own record removes some of the same repeats.

**2. Geometry is unchanged.** Every component's committed `(x, y, width, height)` after the pass is identical to what the same scene produces today. For the 19-component Border scene above, the centre region settles at `0,0,310,250` and the north region at `0,0,400,20`.

**3. Nothing is recorded outside a layout pass.** With no layout running: read `host.getPreferredSize()`, add a child, read it again. The second read reflects the new child.

**4. Each pass reads afresh.** Two consecutive `root.doLayout()` calls each make their own live reads; neither serves the other's.

**5. (design gate) A size change between two passes of one animation frame is seen.** A manager that reads its child's preferred height inside `doLayout`; run `root.doLayout()`, then `leaf.setPreferredSize({ width: 100, height: 130 })`, then `root.doLayout()` again. The two readings must be `50` then `130`. A frame-keyed memo reports `50` then `50`.

**6. (design gate) A size change caused by the commit, re-read in the same pass, is seen.** A manager that reads its child's preferred height, calls `commitBounds` on it, then reads it again; the leaf republishes its preferred height from its committed height through an `onSizeChange` listener — the shape `CodeEditor.setAutoHeight` has. The two readings must be `50` then `100`. Both a frame-keyed and a pass-keyed memo report `50` then `50`.

**7. (design gate) A constraint written mid-pass with no `doLayout` following it is seen.** A manager that reads its child's preferred height, writes `setPreferredSize({ width: 100, height: 400 })` on a leaf inside that child, then reads the child again. The two readings must be `50` then `400`. A frame-keyed memo, a pass-keyed memo, and a pass-keyed memo that also drops on every `doLayout` return all report `50` then `50`.

**8. (design gate) Insets written mid-pass are seen.** The same manager, with `setInsets(new Insets(10, 10, 10, 10))` on the child itself in place of the constraint write — the `Tab.doLayout` shape. The two readings must be `50` then `70`. A frame-keyed memo, a pass-keyed memo, and a pass-keyed memo that also drops on every `doLayout` return all report `50` then `50`.

**9. A Loom-shaped drag sweep is byte-identical.** A `Split` of a 30-row tree pane and a 2×2 grid of `Border` editor panes (218 components); twenty frames of a triangle-wave width change on the root. Every component's rectangle on every frame matches the unmemoised run exactly.

**10. `null` is a real answer.** A component whose manager reports `null` preferred size is recorded as `null` and re-served as `null`, not recomputed and not turned into a size.

**11. A throwing layout leaves the counters clean.** Make a pass throw; assert the throw propagates, that `Component.currentLayoutPass()` is `0` afterwards, and that a following pass over the repaired scene produces the normal geometry.

**12. A `Text`'s lazy measurement still happens.** A `Text` whose text is set between two passes reports the new measured width on the second pass. Its `getMinSize` performs the measurement as a side effect, and the record must not suppress a measurement that is genuinely due.

---

## Verification

Run from `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm test` — the full suite (470 files / 7,519 tests before this plan's new file) must stay green. A runtime simulation of this exact design was run against that whole suite with zero failures.[^suite-prevalidated]
- **The suite is not the gate.** The same run under a *pass-keyed* memo — the design this plan rejects, which fails three of the four design gates — was also 470 files and 7,519 tests green. Cases 5–8 of `## Expected Behaviour` are the gate; a `npm test` pass proves nothing about the key.
- `npm run lint` — clean.
- `grep -rnE '\.(width|height)\s*=[^=]' src/typescript/lib --include=*.ts` — 15 hits as of 7247b948, every one a write into a DOM attribute bag, a CSS keyframe bag, or a comment. None assigns into the result of a size hint, and none may. A record serves one `Size` object to several callers, so a caller that modified one would now corrupt the others.[^aliasing]
- `npm run docs:api` — zero warnings.

Then measure in real WebKitGTK against a build that already carries `border-region-size-memo`, using the harness arms the wave-2 sweep used — `work=1` and `widthprobe=1`, plain-bracketed at both ends, on **both** scenarios:

- **S1** (2×2 dock grid, four editors, 2,387 elements) and **S3** (explorer gutter, one editor). The ablation passed on S3 and broke on S1; a design checked only on S3 proves nothing.
- **Geometry is the acceptance gate.** The `widthprobe` width series must be byte-identical to that scenario's plain arms on both scenarios. Not close — identical. Any difference on either scenario fails the change outright; the response is to revert, not to add an exception. The ablation's S1 signature to watch for is the editor height minimum landing at 835 px against plain's 963, and `cmContentH` at 844 against 963.
- **Work avoided is the primary bar.** Counted per-frame work must fall on both scenarios, measured against a baseline that already carries `border-region-size-memo` (which takes S1 from 2,969 to about 2,356 by itself). The ablation's ceiling on S1 was 2,969 → 1,032 counted calls, with size-hint calls specifically at 2,875 → 946; this design reached about 85% of that saving in the modelled scenes, so a result anywhere below roughly 1,900 is in range. A result at or above 2,300 means the generation is being bumped from somewhere unexpected — instrument `invalidateSizeHints`, find the caller, and fix that rather than removing a bump.
- **Frame time must not regress** against the two plain arms. No improvement is expected or claimed: the ablation measured +0.58 ms on S1 and −1.29 ms on S3 against a 1.04 ms drift. A flat result at identical geometry with half the size-hint calls removed passes.

---

## Documentation Impact

None. Every new member is private or `@internal`, and `typedoc.json` sets `excludeInternal`. `scripts/llms/check-coverage.mjs` tracks concrete classes only, so `llms.txt` needs no entry. No barrel or export changes. `docs/concepts/sizing.md` describes what the three hints mean, not how often they are computed, and needs no edit.

---

## Potential Challenges

- **Recording a result computed across a generation bump.** The entry/exit comparison in each getter is what prevents it; a version that re-bases the record on entry and writes unconditionally on exit is subtly wrong. No case in `## Expected Behaviour` isolates this one — it needs a nested read of a *second* hint on the same component mid-computation — so write the two comparisons exactly as `## Internal Structure` gives them.[^entry-exit]
- **The two `sizeHintGeneration` names.** The module counter and the instance field `_sizeHintGeneration` differ by one underscore; the field holds the counter's value at the moment the record was taken. This mirrors `Text._measuredGeneration` against `Util.textMetricsGeneration()`.
- **Subclass overrides are not memoised.** `Text`, `Button`, `Tree`, `Markdown`, `Image`, `PickerColumn`, `FieldSet` and `MarkdownMinimap` override one or more of the three methods; the record sits in `Component`'s body, so an override's own work still runs on every call and only its `super` part is served. That is safe and is the measured behaviour — do not try to hoist the record into the overrides.
- **A bump site placed before a setter's early return** wastes the whole library's records on every unchanged write. Put each call after the guard.
- **`Border`'s record must be changed in the same commit**, or the library holds two memos with different staleness rules for the same question.

---

## Critical Files

- [`plans/border-region-size-memo.md`](plans/border-region-size-memo.md) — the sibling plan this one depends on. It introduces the layout-pass definition, the pass counter and `Component.currentLayoutPass()`, and must be in `plans/implemented/` first.
- [`packages/lib/src/typescript/lib/core/Component.ts:676-682`](packages/lib/src/typescript/lib/core/Component.ts#L676) — `_resolvedCache`, the per-instance memo whose correctness rests on naming every writer that can invalidate it. This plan copies its structure, and step 4 puts the new bump on the line beside its clear.
- [`packages/lib/src/typescript/lib/core/Util.ts:65`](packages/lib/src/typescript/lib/core/Util.ts#L65) and [`:294`](packages/lib/src/typescript/lib/core/Util.ts#L294) — `metricsGeneration` / `textMetricsGeneration()`, the library's existing monotonic generation counter, and the precedent this plan's key follows.
- [`packages/lib/src/typescript/lib/component/input/Text.ts:557`](packages/lib/src/typescript/lib/component/input/Text.ts#L557) and [`:715-780`](packages/lib/src/typescript/lib/component/input/Text.ts#L715) — `needsMeasure`, `getPreferredSize` and `getMinSize`: the generation counter's consumer side, and the library's trickiest size hint (a lazy, side-effecting measurement behind a getter).
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:406`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L406) and [`:570`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L570) — `resolveBounds` and `commitBounds`: the repeated reads the record collapses, and the commit that ends the run of them.
- [`packages/lib/src/typescript/lib/core/Component.ts:4349`](packages/lib/src/typescript/lib/core/Component.ts#L4349) and [`:4417`](packages/lib/src/typescript/lib/core/Component.ts#L4417) — `clampWidth` / `clampHeight`, which run a full merged-size aggregation per axis on every `setWidth` / `setHeight` *before* the unchanged-value early return.
- [`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts:522-604`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522) — `layoutItems` / `arrowRefreshDueThisPass`, the per-pass "must this pass re-derive it" gate this campaign already landed.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* (rule 3) and *Always cache in memory* (rule 2) — a manager that does not report accurate sizes is a bug, and reads return cached state. The record must serve the first rule while following the second.
- [`plans/research/render-review-2026-09-15/97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md) — the sweep this plan answers, its "Re-scored on work avoided" section, and the acceptance numbers.

---

## Non-Goals

- **Making the frame faster.** The measured ceiling for this lever is zero milliseconds at Loom's scale. Any step taken to buy time rather than avoid work is outside this plan.
- **Moving the record into the subclass overrides.** `Text`, `Button` and `Tree` compute their own answers around `super`; covering them needs a protected compute hook on eight classes and is a separate change with its own correctness argument.
- **`resolveBounds`'s four eager reads.** Moving them inside the non-`BOTH` arms is group G11's `box-layout-per-pass-gather`, a different mechanism against the same counts.
- **`clampsToContentSize()` opt-outs** (group G10). The sweep measured its `clamp.once` arm at exactly zero calls removed; it is dropped, not folded in here.
- **Caching a hint across passes.** The record never outlives the pass that filled it. Anything longer needs an invalidation signal for arbitrary subtree mutations, which the framework does not have.
- **Fixing `setInsets`'s missing `scheduleLayout`.** `setInsets` changes a size hint without announcing it to layout, which is arguably a defect in its own right. This plan bumps the generation there and leaves the scheduling behaviour alone.

---

## Notes

[^scaling]: From `plans/research/render-review-2026-09-15/97-wave2-measurement.md`, *Re-scored on work avoided, not milliseconds*: 2,969 counted calls per frame at 2,387 elements, of which 2,875 are size hints, and "the saving therefore grows with document size, which is exactly where this codebase has already been bitten once: the full-document restyle was free at 992 elements and ~195 ms/frame at 21k." The measurements taken for this plan show the same shape from the other end — a 19-component `Border` scene saves 5.7% of its size-hint calls, a 146-component single-editor scene 51.1%, and a 218-component 2×2 editor grid 51.0%. The saving is in the depth of the recursive descents, not in the number of components.

[^diagnosis]: The record in `97-wave2-measurement.md` says the ablation "keyed its memo to the frame, and a frame runs several layout passes with sizes legitimately changing between them", and prescribes "per-**pass** granularity, not per-frame". The first half is confirmed: gate 5 in `## Expected Behaviour` reproduces exactly that failure under a frame key and passes under a pass key. The prescription is incomplete: gates 6, 7 and 8 fail under a pass key too. A single outermost `doLayout()` is not a quiet window — `LayoutManager.commitBounds` calls `setWidth`, `setHeight` and then `doLayout` on each child, and each of those can change what that child reports next, through a `sizechange` listener (`CodeEditor.setAutoHeight` republishes its preferred size from one), through a flow's wrap re-measure (`FlowLayout.setWrappedLineExtent`), or through `Text.setWidth`'s re-measure at the new width. The generation counter is what turns the pass into a sequence of quiet windows.

[^depends]: `border-region-size-memo` adds module-level `layoutPassDepth` / `layoutPassToken` to `core/Component.ts`, maintains them across `doLayout`'s body in a `try`/`finally`, and exposes `@internal static currentLayoutPass(): number`. This plan adds nothing to that machinery and defines no second notion of a pass. Both plans edit `core/Component.ts`, which is why `touches-shared` names it.

[^generation-precedent]: `Util.metricsGeneration` (`core/Util.ts:65`) is a module-level integer bumped once in `invalidateTextMetricsCache` (`:346`); `Text` stashes its value in `_measuredGeneration` at measurement time and compares on every read, which is how it notices a theme change without holding a per-instance subscription. The size-hint generation is the same device with a wider set of writers. The second precedent is `Component._resolvedCache` (`core/Component.ts:682`), whose correctness argument this plan copies in structure: name every writer that could change an answer, invalidate there, and state why nothing else can. The third is `ScrollStrip.arrowRefreshDueThisPass` (`component/container/ScrollStrip.ts:584`), the per-pass re-derivation gate this campaign already landed. A per-pass token alone was considered and rejected; the measured comparison of every candidate key is in the last note of this section.

[^insets]: `Component.setInsets` writes `_options.insets` and a data attribute and returns; it calls neither `scheduleLayout` nor `writeStyle` and fires no relay. `getContentInsets` (`core/Component.ts:2757`) and `getPerimeterSize` (`:3941`) both read the insets, and every aggregating manager adds the perimeter to its report. `Tab`'s `doLayout` calls `this._bar.setInsets(...)` at four call sites (`layout/Tab.ts:2185-2209`) and `clearInsets()` at a fifth (`:2213`), all inside a layout pass, which is the concrete case that makes this bump necessary rather than defensive. `setPadding` / `clearPadding` need no entry of their own: both go through `writeStyle`.

[^exposure]: This is the answer to the blast-radius question. A writer nobody thought of can only serve a stale hint while a layout pass is running, and only until that pass ends: `Component.currentLayoutPass()` returns a new number for the next pass, and returns `0` outside one, where nothing is recorded and every read is live. So the worst case for an unlisted writer is one pass of wrong geometry, self-correcting on the next — not a permanently wrong tree. That bounded exposure, plus gates 5–8 and the byte-identical S1/S3 requirement, is why this plan lands whole rather than behind a per-class opt-in.

[^entry-exit]: Without the exit comparison the design has a real hole. Say `getMinSize` starts at generation 5 and re-bases the record onto 5; while it is computing, a nested `Text` measurement bumps the generation to 6; some nested read of `getMaxSize` on the same component then re-bases the record onto 6 and clears the slots; `getMinSize` returns and writes its slot, and the record now claims a generation-5 answer is a generation-6 one. Reading both numbers on entry and refusing to record unless the generation is unchanged on exit closes it, and costs one integer comparison.

[^border-consistency]: `border-region-size-memo`'s `[^pass-not-frame]` argues that "while the stack is inside a layout pass, nothing else can run and mutate a region's subtree". The measurements for this plan show that is not quite true: `commitBounds` fires `sizechange` listeners, and a listener can mutate anything. The consequence for `Border` is narrower than for the general memo — its record is already dropped when `Border.doLayout` returns, and its regions are read before they are committed — but the CENTER region in Loom is a `CodeEditor` wrapper, which is the exact component that republishes its preferred size from a size-change reaction. Adding the generation to `Border.passRecord`'s key is one condition and removes the question; leaving it out would give the library two memos that answer the same question differently.

[^no-opt-in]: Three reasons, in order of weight. First, the hazard is temporal rather than per-class: every class that went wrong under the ablation went wrong for the same reason — a hint read before a mid-pass write and served after it — and narrowing the set of memoised classes reduces how often that happens without making it correct anywhere. Second, an opt-out predicate nothing overrides is unused public API, which this pre-1.0 library deletes rather than keeps. Third, the value is in the deep recursive descents, and those pass through the plain `Container`s and `Component`s that any opt-in list would have to include anyway. The staging that does exist is sequencing: this plan lands after `border-region-size-memo`, behind its pass counter, and its four design gates run before the WebKit measurement.

[^matrix]: Measured 2026-09-17 against `master` at 7247b948, by simulating each candidate key at runtime over unmodified library source and comparing the readings a probe manager takes against the unmemoised run. Case names match `## Expected Behaviour`: gate 5 is a change between two passes of one frame, gate 6 a change caused by the commit and re-read in the same pass, gate 7 a constraint written mid-pass with no `doLayout` following, gate 8 the same with insets. "Drop on `doLayout`" is a pass key that additionally clears a component's record — and its ancestors' — whenever that component's `doLayout` returns.

    | key | gate 5 | gate 6 | gate 7 | gate 8 | work avoided |
    |---|---|---|---|---|---|
    | none (today) | `50, 130` | `50, 100` | `50, 400` | `50, 70` | — |
    | frame | `50, 50` ✗ | `50, 50` ✗ | `50, 50` ✗ | `50, 50` ✗ | −60.1% |
    | pass | `50, 130` | `50, 50` ✗ | `50, 50` ✗ | `50, 50` ✗ | −55.9% |
    | pass + drop on `doLayout` | `50, 130` | `50, 100` | `50, 50` ✗ | `50, 50` ✗ | −55.9% |
    | **pass + generation (this plan)** | `50, 130` | `50, 100` | `50, 400` | `50, 70` | **−51.0%** |

    The work column is the total of `getPreferredSize` + `getMinSize` + `getMaxSize` calls made anywhere in the tree, summed over twenty drag frames of the 218-component scene in case 9, against 15,462 calls per frame unmemoised. The same scene at 146 components gives −51.1%. Every key in the table produced identical geometry on that scene across all 20 frames and all 218 rectangles — which is why the scene is not the gate and cases 5–8 are.

[^suite-prevalidated]: On 2026-09-17 the design was applied to unmodified library source at runtime — the pass counter around `Component.prototype.doLayout`, the generation counter bumped at the six places in `## Architecture Decisions`, the record behind the three getters with the entry/exit comparison — and the full `packages/lib` suite ran against it: 470 files, 7,519 tests, 2 todo, zero failures. The same run under a pass-keyed memo was also green, which is the reason `## Verification` says in as many words that the suite is not the gate. The simulation did not include the `Border` change in step 9, which is argued separately.

[^aliasing]: `mergeConstraintSize`'s doc comment says "Every branch returns a new object, so callers never receive an alias of the stored constraint or manager size." That remains true of `mergeConstraintSize` itself; what changes is that two callers inside one record window now receive the same object. The library already does this — `Image.getMinSize` (`component/display/Image.ts:931`) returns `this._aspectMinSize` directly — and a search for assignment into a `.width` or `.height` anywhere in the library finds fifteen hits, every one a DOM attribute bag, a CSS keyframe bag, or a comment. The rule to state in the three JSDoc comments is that the caller must not modify the returned `Size`.

---

## Implementation Notes

The design lands as `## Architecture Decisions` and `## Internal Structure`
specify — the generation counter, its six bump sites, the five record fields,
`beginSizeHintRecord`, and the three getters with the entry/exit comparison.
Two things in the plan did not survive contact with what
`border-region-size-memo` actually shipped, and the work-avoided figure is
materially smaller than the plan's. Both are recorded below in full.

**The key was re-derived against the shipped pass token, not applied as
written.** `border-region-size-memo`'s own notes correct its plan: a pass hands
control to consumer code at two points, and the shipped
`Component.currentLayoutPass()` ends its number at each — the `onFirstLayout`
drain and a `sizechange` dispatch from inside a size setter. That is a narrower
token than this plan's `[^matrix]` measured against. Re-running the matrix
against the shipped token, by simulating every candidate key at runtime over
unmodified library source:

| key | gate 5 | gate 6 | gate 7 | gate 8 | deep work | shallow work |
|---|---|---|---|---|---|---|
| none | `50, 130` | `50, 100` | `50, 400` | `50, 70` | — | — |
| the plan's looser pass | `50, 130` | `50, 50` ✗ | `50, 50` ✗ | `50, 50` ✗ | −39.5% | −40.6% |
| the shipped pass | `50, 130` | `50, 100` | `50, 50` ✗ | `50, 50` ✗ | −39.5% | −40.6% |
| the plan's looser pass + generation | `50, 130` | `50, 100` | `50, 400` | `50, 70` | −32.0% | −32.0% |
| **the shipped pass + generation (shipped)** | `50, 130` | `50, 100` | `50, 400` | `50, 70` | **−32.0%** | **−32.0%** |

(That table's work column comes from the pre-audit runtime simulation, on the
earlier `HBox`-rooted scene; the shipped figures are the `Split`-rooted ones
below. The comparison between keys is what the column is for, and it holds.)

Gate 6 is therefore already closed by phase 1, and the plan's row recording a
pass key failing it is stale. Gates 7 and 8 are not: a constraint or an inset
written mid-pass reaches no `doLayout`, fires no `sizechange` and drains no
callback, so nothing ends the pass number and a pass-only key serves the stale
answer. The generation counter is what closes them and it ships. Reverting the counter
to a no-op fails six cases — gates 7 and 8, and cases 13 to 16, the four the
audit added — and leaves every other case green.

**The shipped token costs nothing.** The two generation rows above are not
approximately equal, they are identical to the call — 74,328 on the deep scene
either way. Every point at which the shipped token ends a number mid-pass sits
immediately before a nested `doLayout` that bumps the generation anyway, so the
narrower token removes no cache hit the design was already keeping.

**Work avoided is −31%, not the plan's −51%, and the reason is phase 1, not the
token.** Measured over the same twenty-frame triangle-wave sweep the plan's case
9 describes — a `Split` of a 30-row tree pane and a 2x2 grid of `Border` editor
panes, one of whose regions is collapsible so the sweep drives real gutters —
223 components, against a 48-component single-pane scene: 109,260 → 75,084
calls (**−31.3%**) and 23,204 → 15,844 (**−31.7%**). Run against a baseline with `Border`'s own per-pass region record
disabled — which is the condition the plan's −51.0% and −51.1% were measured in,
on `master` before phase 1 existed — the same scenes give −58.4% and −48.0%. So
the plan's figure reproduces in the plan's own condition; what changed is that
this branch now stacks on a tree where `border-region-size-memo` has already
harvested half of the same repeats (it alone takes the deep scene from 223,328
to 109,368). The two together remove two thirds of the sweep's size-hint calls.
A third is still a third, but the justification is a smaller number than the
plan claims and is stated here rather than smoothed over.

**The bump list is tied to the resolved-style cache, not to the plan's list of
setters.** The table at `## Architecture Decisions` calls `writeStyle()` "the
single funnel for … `minSize`, `maxSize`, `padding`, `border`, `visible` and
`displayed`". It is not a funnel at all: `getMinSizeConstraint` and
`getMaxSizeConstraint` resolve through the *layered* style walk, whose per-key
memo `_resolvedCache` is cleared at six places, only one of which is
`writeStyle`. Three writers reachable from inside a shipped `doLayout` fell
through the gap — `setDisplayed(false)`, whose hiding leg routes through
`setStyleState` and never touches the funnel, while every aggregating manager
iterates `getLaidOutComponents`, which filters on `isDisplayed`
(`Split`, `Tab`, `Card`, `Accordion` and `Border` all undisplay children from
inside their own `doLayout`); a style state carrying a `minSize`, activated
mid-pass; and `cacheBorderSpec`, which drops the cached per-side widths
`getPerimeterSize` reads while writing no CSS at all
(`SplitGutter.setOpaque` calls it from `Split.doLayout`). The first served a
stale aggregate and, through `clampWidth` / `clampHeight`, a stale committed
height.

Rather than lengthen the enumeration, the generation is now moved by a private
`invalidateResolvedStyle()` that replaces every `_resolvedCache = null`, plus
one bump in `cacheBorderSpec` for the one size-hint input that memo does not
cover. That makes the invalidation true by construction — anything that can
change what a style layer resolves to moves both memos together — instead of
true only for as long as the list stays complete. The two explicit bumps the
first audit round added to `setVisible` / `setDisplayed` were removed again as
redundant once `setStyleState` carried them. `cacheBorderSpec` bumps only on a
genuine change, compared the way `setBorder` already compares: `SplitGutter`
has no guard of its own and `Split.doLayout` re-asserts every expanded
divider's border on every pass, so an unconditional bump would throw the
library's records away once per gutter per pass — worth 228 calls a sweep even
on the scene below, which carries one divider. Cases 14, 15 and 16 pin one
writer each, as three further design gates of exactly the gate-7 / gate-8
shape. All three were found by this branch's audit, not by the plan.

**Step 9 is dropped: `Border`'s region record is left keyed on the pass alone.**
`[^border-consistency]` justifies the change with one scenario — a CENTER-region
`CodeEditor` republishing its size from a size-change reaction — and the shipped
pass token ends the pass at exactly that `sizechange` dispatch, which phase 1's
own case 11 already pins. Adding the generation as a second condition was
implemented and priced before being dropped: it takes the deep sweep from 74,216
to 92,136 calls, **+24.1%**, because the generation bumps on every nested
`doLayout` including the ones `Border` itself triggers when it commits its
regions. It would cost most of phase 1's win to guard a case phase 1 already
closed. Consequently `layout/Border.ts` is untouched despite being named in
`touches-shared`, and the `@internal static currentSizeHintGeneration()` step 1
asks for is **not** added — `Border` was its only intended caller, and an
accessor with no callers is what this pre-1.0 library deletes rather than keeps.
What this leaves standing, and the plan's `## Potential Challenges` is right to
have worried about, is that `Border.passRecord` remains exposed to exactly the
gate-7 / gate-8 / case-14 writes the pass number does not close, so the two
records do not answer identically in every case. That residual is inherited from
phase 1 rather than introduced here, and closing it is what costs the 24%.

**The new suite is at `tests/core/`, not `tests/component/core/`.** The plan's
path names a directory that does not exist; `tests/core/` is where the
`Component.*` core suites already live (`ComponentBounds`, `ComponentDefaults`,
`ComponentSetterGuards`).

**Case 1's predicted 281 → 265 no longer happens: the Border scene measures 210
→ 210.** On a nineteen-component five-region scene every repeat is now separated
by a nested `doLayout`, and `border-region-size-memo` has already collapsed the
ones that were not — there is nothing left for this record to save there. Case 1
is therefore two assertions: a direct one, that a question repeated inside one
quiet window consults the layout manager exactly once (two consultations before
this change), and a no-regression bound on the Border scene. The reduction
itself is pinned by case 9, whose bound is a quarter rather than the plan's 45%,
for the reason above.

**Three smaller deviations.** Case 12 reads `Text`'s *preferred* width rather
than its minimum: `Text.getMinSize` deliberately reports a zero width so parent
layouts can compress labels, and both getters run the same lazy `calculateSize`.
Cases 13 to 16 are additions beyond the plan's twelve. Case 13 pins the entry/exit
comparison `## Potential Challenges` says no case isolates, by having a
manager's `getMinSize` bump the generation and take a nested reading mid-
computation; the variant that re-bases on entry and writes on exit
unconditionally fails it, verified by mutation. Cases 14, 15 and 16 are the
three gates described above. And the case-2 scene needs
`spacing: 0` on its `Border` and boxes to land on the plan's stated rectangles.

**`npm run docs:api` reports the same 14 pre-existing warnings phase 1
recorded**, not the zero `## Verification` asks for; this branch adds none, and
nothing it touches renders. `npm test` is 472 files / 7,568 tests / 2 todo,
green. `npm run lint`, `npm run typecheck`, `npm run typecheck:test` and
`npm run build` are clean. The aliasing grep finds exactly the 15 hits the plan
lists, every one a DOM attribute bag, a CSS keyframe bag or a comment.

**The real-WebKitGTK arm of `## Verification` was not run.** The `work=1` /
`widthprobe=1` S1/S3 harness lives in Loom and is not present in any Loom tree
or history reachable from this environment, so no frame-time number and no
`widthprobe` width series exist for this change. What stands in its place is the
deterministic twenty-frame sweep in the modelled DOM harness over both a deep
and a shallow scene, whose acceptance gate is the same one: every component's
rectangle on every frame, digested and compared against the value the same
scenes produced on this branch's start point. Both are byte-identical. That
covers geometry and work avoided; it does not cover frame time, which the plan
neither expects nor claims to move. The WebKit arm remains owed before this is
treated as measured.
