---
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# Staged unchanged-commit layout skip — Implementation Plan

## Overview

[`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L570) ends in an unconditional `component.doLayout()`. Every layout manager in the library commits through it, so a child handed back the exact rectangle it already holds still re-runs its whole subtree's layout. [`Component.applyBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4160) already withholds that pass when the rectangle did not change and the component opted in — but `commitBounds` does not route through it, so the gate fires only inside the table.

This plan puts the same gate on `commitBounds`, keeps it **off by default**, and opts in two audited classes. It also closes two ways a withheld pass could lose work that was genuinely owed.

The change is justified on work avoided, not on frame time. A runtime ablation of the unrestricted idea removed **34.3% of all counted per-frame work on Loom's 2×2 editor grid** — 2,969 calls down to 1,949, about 1,020 avoided per frame from only 8 skipped commits — and the frame got **0.46 ms slower**. No frame-time improvement is expected here and none is claimed.[^no-ms] That same ablation **changed the page's geometry**, and most of this plan is about why.[^ablation-geometry]

Line numbers are as of `master` at `d00ecf9e`.

---

## Architecture Decisions

### Why the ablation's geometry changed

The ablation kept, per component, the last rectangle it had been **asked** for, and skipped the pass when the next request matched it. That is not the same question as "did this component's box move". Anything that resizes a component between two commits — a `sizechange` listener republishing a height, a collapsing `Split` pane, a scrollbar reserve — leaves the live box different from the recorded request, so the next identical request really does resize the component while the record still reads "unchanged". The subtree then keeps the geometry it was laid out at, at a size it no longer has.

Reproduced against unmodified source: a container laid out at 50 px, resized to 120 px out of band, then handed its original 50 px rectangle again. Plain leaves its child at 50. The ablation's key leaves it at **120**.[^probe-a] That is the shape of the break the sweep recorded on the 2×2 grid, where editor height reached 1615 px against plain's 1188.

`Component.writeBounds` ([:4203](packages/lib/src/typescript/lib/core/Component.ts#L4203)) already answers the right question, and its doc comment says why: it reads the fields *after* the setters ran, "so a `setWidth`/`setHeight` that clamped to this component's min or max still reports honestly". This plan copies that.

### `changed` is read from the component after the setters ran

`commitBounds` decides from the component's own geometry before and after the four setters, never from the requested numbers.

A skip is possible only when the component did not move at all — same size, same visual position, no leftover transform. The pre-write comparison `commitBounds` already computes for its transform fast path is the cheap first half of that test; the post-write comparison is the half that catches a clamp.

| Case | Before | Requested | After | `changed` | Pass runs? |
|---|---|---|---|---|---|
| Nothing moved | `0,0,100,50` t=0 | `0,0,100,50` | `0,0,100,50` t=0 | `false` | only if not opted in, or dirty, or no element |
| Height really moved out of band | `0,0,100,120` t=0 | `0,0,100,50` | `0,0,100,50` t=0 | `true` | yes |
| Clamp bites at an unchanged request | `0,0,100,50` t=0 | `0,0,100,50` | `0,0,100,80` t=0 | `true` | yes |
| Pure move (transform fast path) | `0,0,100,50` t=0 | `40,0,100,50` | `0,0,100,50` t=40 | `true` | yes |
| Leftover transform folded back | `0,0,100,50` t=40 | `40,0,100,50` | `40,0,100,50` t=0 | `true` | yes |

Only the first row can skip. The fast path and the skip are therefore mutually exclusive: a component that moves is always laid out.

### The gate lives in one method that three call sites share

`Component` gains an `@internal` `canSkipUnchangedCommit()` holding the whole per-moment answer — opted in, not dirty, has an element. `applyBounds` is rewritten to ask it, `commitBounds` asks it, and the batched layout flush asks it. The gate's meaning is then defined once.[^one-gate]

### The skip stays off by default and is opted into per class

`Component.canSkipUnchangedLayout()` ([:4183](packages/lib/src/typescript/lib/core/Component.ts#L4183)) keeps returning `false`. A class opts in by overriding it to `true` and carrying, in that override's doc comment, the list of writers that can change its subtree's layout without moving its rectangle — with, for each, why the withheld pass costs nothing. [`Cell.canSkipUnchangedLayout`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L230-L258) is the model: seven named writers, each either laying the cell out itself or handled by the host marking cells dirty. That audit is the opt-in's price of entry, and it is what makes the list growable one class at a time.[^why-staged]

### Stage 1 is `MenuBar` and `ToolBar`

[`MenuBar`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L61) and [`ToolBar`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L135) opt in. Both are fixed chrome whose rectangle does not move when a gutter inside the shell is dragged, both own their layout manager, and both hold children that announce an intrinsic-size change all the way up.[^stage-one]

The audit turns up two `ToolBar` writers that change child layout without announcing it: `setOrientation` ([:259](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L259)) swaps the layout manager, and `setFlat` ([:514](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L514)) re-chromes every `Button` child. Each gains a `this.doLayout()` tail, matching `setCompact`, `setOverflow` and `setOverflowSide`, which already end that way.

The list grows by the same route: read the class's writers, fix or document each one, add the override. A consumer's own container subclass opts in the same way — the gate is `protected`, so it is reachable from outside the library.

### `setInsets` and `clearInsets` mark the layout stale

[`Component.setInsets`](packages/lib/src/typescript/lib/core/Component.ts#L2646) and [`clearInsets`](packages/lib/src/typescript/lib/core/Component.ts#L2671) change a layout input and announce nothing — no `scheduleLayout`, no `invalidateLayout`, no relay. Today the next top-down pass applies the new insets; with a gate on that pass, the change can be withheld forever. Both setters gain an `invalidateLayout()` call after their same-value early return.

This is not defensive. It is the single failure the library's own suite catches when the gate is forced on for every component, and the failing test names the mechanism exactly: a header cell's glyph shifts its renderer's inset, the cell lays itself out, and the renderer's commit is skipped because its rectangle never moved.[^insets-evidence]

### The batched flush stops pruning at a link that can skip

`flushPendingLayouts` ([:216](packages/lib/src/typescript/lib/core/Component.ts#L216)) drops a queued component when an ancestor is queued too, because "the ancestor's layout will recurse into it" ([:241-250](packages/lib/src/typescript/lib/core/Component.ts#L241-L250)). A skip is exactly what breaks that promise, and the dropped entry is gone — the queue was snapshotted and cleared, so nothing re-queues it.

The ancestor walk therefore stops at the first link that could skip an unchanged commit, and the queued component keeps its own top-level pass. The cost is at most one redundant pass in a frame where the ancestor did recurse after all.[^flush-alternative]

### Skipping a commit cannot serve a stale size hint

[`size-hint-per-pass-memo`](plans/size-hint-per-pass-memo.md) keys its record on the layout pass plus a library-wide size-hint generation counter, bumped in `doLayout`'s `finally` among five other places. A withheld `doLayout` is one bump that does not happen — which is correct, not a hazard: that bump exists because laying a subtree out changes what it reports next, and a subtree that was not laid out reports what it did before. The effect is more cache hits, never a staler answer.[^generation]

`setInsets` and `clearInsets` are a site both plans write to. Whichever lands second puts its call beside the other's, after the same early return.

---

## Public API

One new member on `Component`, `public` so `LayoutManager` and the module-level layout flush can call it, and `@internal` so it renders nowhere. `typedoc.json` sets `excludeInternal`. This is the shape [`Component.propagateEffectiveVisibility`](packages/lib/src/typescript/lib/core/Component.ts#L2480) already uses, for the same reason — its doc says "public and `@internal` because the flush needs to invoke it on arbitrary instances".

```ts
class Component {
    /** @internal */
    public canSkipUnchangedCommit(): boolean;
}
```

Returns `true` when a commit that moves nothing may withhold this component's layout pass — this class opted in through the protected `canSkipUnchangedLayout()`, no pass is owed (`isLayoutDirty()` is `false`), and the component has an element.

Two protected overrides, neither documented:

```ts
class MenuBar extends Component {
    protected canSkipUnchangedLayout(): boolean;   // true
}

class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Container<TOptions> {
    protected canSkipUnchangedLayout(): boolean;   // true
}
```

---

## Internal Structure

The gate, placed immediately below `canSkipUnchangedLayout` in `core/Component.ts`:

```ts
/** @internal */
public canSkipUnchangedCommit(): boolean {
    return this.canSkipUnchangedLayout() && !this.isLayoutDirty() && this.getElement() !== null;
}
```

`applyBounds` ([:4160](packages/lib/src/typescript/lib/core/Component.ts#L4160)) keeps its body and asks the gate:

```ts
if (changed || !this.canSkipUnchangedCommit()) {
    this.doLayout();
}
```

`commitBounds` ([:570](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L570)) hoists the two translate reads it already makes, then gates the recursion. Everything between `setAutoCommitStyle(false)` and the recursion is unchanged apart from those two hoists:

```ts
component.setAutoCommitStyle(false);

const sizeUnchanged       = component.getWidth() === width && component.getHeight() === height;
const beforeTranslateX    = component.getTranslateX();
const beforeTranslateY    = component.getTranslateY();
const positionUnchanged   = x === component.getX() + beforeTranslateX && y === component.getY() + beforeTranslateY;
const transition          = component.getTransition();
const canFastPath         = sizeUnchanged && !positionUnchanged && (transition === null || transition === "none");
// The only shape a skip is possible for: the box did not move at all. Every
// other shape sets `changed` below without reading anything back.
const mayBeUnchanged      = sizeUnchanged && positionUnchanged;

// ... the existing fast-path / slow-path branch and setWidth / setHeight, verbatim ...

// Read back, not assumed: setWidth / setHeight clamp, so an unchanged request
// can still move the box.
const changed = !mayBeUnchanged
    || component.getWidth()      !== width
    || component.getHeight()     !== height
    || component.getTranslateX() !== beforeTranslateX
    || component.getTranslateY() !== beforeTranslateY;

if (changed || !component.canSkipUnchangedCommit()) {
    component.doLayout();
}

component.setAutoCommitStyle(true);
```

The four read-backs cost nothing on the common path: `!mayBeUnchanged` short-circuits before them.

The flush's ancestor walk ([:243-250](packages/lib/src/typescript/lib/core/Component.ts#L243-L250)) gains one condition:

```ts
while (p) {
    if (dirty.indexOf(p) !== -1) {
        hasDirtyAncestor = true;
        break;
    }

    // A link that may withhold an unchanged commit is a link the ancestor's
    // recursion may not get past, so `c` keeps its own top-level pass.
    if (p.canSkipUnchangedCommit()) {
        break;
    }

    p = p.getParentComponent();
}
```

---

## Ordered Implementation Steps

1. **`core/Component.ts` — add the gate.** Add `canSkipUnchangedCommit()` exactly as in `## Internal Structure`, directly below `canSkipUnchangedLayout` ([:4183](packages/lib/src/typescript/lib/core/Component.ts#L4183)). Mark it `@internal` in its JSDoc and do not `{@link}` it from any public doc comment (CODE_CONVENTIONS.md, *Don't `{@link}` internal symbols from public JSDoc*).

2. **`core/Component.ts` — route `applyBounds` through it.** Replace the condition at [:4165](packages/lib/src/typescript/lib/core/Component.ts#L4165) with `changed || !this.canSkipUnchangedCommit()`. The behaviour is identical. Keep the method's `@remarks` and reword its last sentence to describe the gate in prose — `applyBounds` is public and the new method is `@internal`, so it must not be `{@link}`-ed from there.

3. **`core/Component.ts` — mark the layout stale on an inset write.** In `setInsets` ([:2646](packages/lib/src/typescript/lib/core/Component.ts#L2646)) and `clearInsets` ([:2671](packages/lib/src/typescript/lib/core/Component.ts#L2671)), add `this.invalidateLayout();` after the `setDataAttribute` call — after each setter's same-value early return, never before it. Extend both doc comments with one sentence: insets are a layout input, so the write marks a pass as owed.

4. **`core/Component.ts` — stop the flush pruning at a skippable link.** Add the `p.canSkipUnchangedCommit()` break to the ancestor walk in `flushPendingLayouts` ([:243-250](packages/lib/src/typescript/lib/core/Component.ts#L243-L250)), with the comment from `## Internal Structure`. Leave the loop's structure and the `!hasDirtyAncestor && c.getElement()` guard alone.

5. **`layout/LayoutManager.ts` — gate the recursion.** Rewrite `commitBounds` ([:570](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L570)) per `## Internal Structure`: hoist the two `getTranslate*` reads into consts, add `mayBeUnchanged`, add `changed`, gate `component.doLayout()`. Do not touch the fast-path branch. Add a paragraph to the method's doc comment stating that a commit which moves nothing withholds the pass for a component that opted in through the protected `canSkipUnchangedLayout` gate, and describe that gate in prose rather than `{@link}`-ing it.

6. **`component/menubar/MenuBar.ts` — opt in.** Add `protected canSkipUnchangedLayout(): boolean { return true; }`. Its doc comment lists the writers that change the bar's layout without moving its rectangle and why each is safe: `setMenus` ([:166](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L166)) rebuilds through `disposeAllComponents` and `addComponent`, both of which relay a preferred-size change to every ancestor; a `MenuBarButton` label or glyph change routes through `Button.recomputePreferredSize` → `setPreferredSize`, which fires the same relay; the bar's `HBox` is fixed in its own constructor and never swapped.

7. **`component/menubar/ToolBar.ts` — close two writers, then opt in.** Add `this.doLayout();` before `return this;` in `setOrientation` ([:259](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L259)) and `setFlat` ([:514](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L514)) — `setLayoutManager` and `Button.setFlat` both change layout without announcing it. Then add `protected canSkipUnchangedLayout(): boolean { return true; }` with a doc comment listing: `setCompact`, `setOverflow`, `setOverflowSide`, `setOrientation` and `setFlat`, each of which now lays the bar out itself; `Button` / `ToggleButton` children, whose intrinsic size changes relay to every ancestor; and the caveat that a consumer child which changes its own intrinsic size without calling `setPreferredSize` or `notifyIntrinsicSizeChanged` will not re-flow the overflow set until the bar's rectangle next moves.

8. **Add `packages/lib/tests/core/UnchangedCommitSkip.test.ts`** covering every case in `## Expected Behaviour`. Model the scenes on [`tests/core/ComponentBounds.test.ts`](packages/lib/tests/core/ComponentBounds.test.ts) cases 5–8, which pin the same gate on `applyBounds`: `installTestDOM`, a `Container` root, a probe subclass that overrides `canSkipUnchangedLayout` to `true`, and `vi.spyOn(child, 'doLayout')`.

9. **`packages/lib/docs/concepts/layout-system.md` — extend *The write is diffed*.** Say the same gate now applies to the recursion `LayoutManager.commitBounds` performs, so it covers every layout manager and not only the call sites that use `applyBounds` directly. Keep the existing sentence about the default being `false`.

10. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/docs/concepts/layout-system.md` |
| Create | `packages/lib/tests/core/UnchangedCommitSkip.test.ts` |

---

## Expected Behaviour

Cases 1–8 are unit-testable under the modelled DOM harness. Case 9 is not: the offline sink drops `requestAnimationFrame` callbacks, so the batched flush never runs in tests — it is verified by reading and by the manual check in `## Verification`.

**1. A component that has not opted in is never skipped.** Two consecutive passes over an unchanged `Container` tree call `doLayout` on every descendant both times, and every rectangle matches today's. This is the shipped default for every class except the two in stage 1 and `Cell`.

**2. An opted-in component handed its own rectangle is skipped.** On a `Border`-hosted shell — a four-menu `MenuBar` NORTH, a three-button vertical `ToolBar` WEST, a `Container` CENTER, 32 components in all — a second identical `shell.doLayout()` makes 31 commits today, one per descendant. With stage 1 opted in it makes **3 commits, of which 2 are skipped** — the two bars' own subtrees are never reached, so 28 commits never happen — and all 32 rectangles are byte-identical to the first arm's.[^probe-e]

**3. A clamp that bites at an unchanged request is not skipped.** An opted-in container laid out at 50 px, resized to 120 px out of band, then handed its original 50 px rectangle: its child must end at **50**, not 120. Under the wave-2 ablation's key it ends at 120; this is the case that separates the two designs.

**4. A pure move is not skipped.** Committing an opted-in component at a new position with an unchanged size takes the transform fast path and still lays out. So does a commit that folds a leftover transform back to `(0, 0)`.

**5. `invalidateLayout` between two unchanged commits forces both passes.** The `applyBounds` behaviour that `ComponentBounds.test.ts` case 7 already pins, now also through `commitBounds`.

**6. A component with no element is never skipped.** Mirrors `ComponentBounds.test.ts` case 8.

**7. An inset write marks a pass as owed.** `child.setInsets(new Insets(4, 4, 4, 4))` on an opted-in component, then a commit at its existing rectangle: the pass runs. A repeat `setInsets` with the same four numbers returns early and marks nothing, so a following commit at an unchanged rectangle is skipped again.

**8. A `ToolBar` writer lays the bar out itself.** `setOrientation` and `setFlat` each leave the bar's children re-placed without any further pass, matching `setCompact`'s existing behaviour.

**9. A queued descendant behind a skippable link keeps its own pass.** With an opted-in, clean container between a queued descendant and a queued ancestor, the descendant is not pruned from the flush. Without this, its pass is lost outright: the flush clears the queue before it prunes.[^probe-b]

---

## Verification

Run from `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run lint` — clean.
- `npm test` — the full suite (470 files / 7,519 tests before this plan's new file) must stay green. Every piece of this design was simulated against unmodified source and run through that suite first.[^suite-prevalidated]
- **The suite is not the gate.** A design that is wrong in this area passes it: the sibling size-hint plan's incorrect memo key was green across all 470 files, and the gate forced on for *every* component in the library is one test away from green. Geometry equality measured in the real engine, below, is the gate.
- `npm run docs:api` — zero warnings.
- Manual check for case 9, which the offline harness cannot reach: in a browser, queue a layout on a deep descendant and on the root in the same frame with an opted-in, clean `ToolBar` between them, and confirm the descendant lays out.

Then measure in real WebKitGTK, using the harness arms the wave-2 sweep used — `work=1` and `widthprobe=1`, plain-bracketed at both ends — on **both** scenarios: **S1** (2×2 dock grid, four editors, 2,387 elements) and **S3** (explorer gutter, one editor). Two arms are required, and they answer different questions.

**Arm A — the corrected upper bound. This is the acceptance gate.** Add a harness ablation `skip.unchanged-v2` that patches `Component.prototype.canSkipUnchangedLayout` to return `true`, so every component may skip, and run both scenarios. The library change itself is what is being measured; the patch only removes the opt-in list.

- **Geometry must be byte-identical to that scenario's plain arms, on both scenarios.** Not close — identical. The wave-2 `skip.unchanged` arm was not: watch for the S1 signature, editor height reaching 1615 px against plain's 1188. A difference on either scenario means a second cause is still live and the plan stops until it is found; the response is not to narrow the opt-in list until the symptom disappears.
- **Work avoided must be in the region of the ablation's** −34.3% on S1 (2,969 → 1,949 counted calls, about 8 skipped commits per frame), measured against the same session's plain arms. A much smaller saving means the corrected comparison is refusing skips the ablation took, which is worth understanding before shipping.
- **Frame time must not regress** against the two plain arms. The ablation measured +0.46 ms on S1. Flat is a pass.

**Arm B — what actually ships.** Default opt-ins only.

- Geometry byte-identical on both scenarios, as for any inert change.
- Count the skips. Stage 1 is expected to reach few, possibly zero, of S1's eight: the largest unchanged-rect subtrees on that scene are Loom's own `Container` subclasses, which no library-class opt-in can reach.[^stage-one-reach] A low count is the expected result and not a failure of the mechanism; the number to record is the one Arm A gives.

---

## Documentation Impact

`packages/lib/docs/concepts/layout-system.md`, section *The write is diffed*, describes the gate as belonging to `Component.applyBounds`. Extend it to say the same gate now guards the recursion inside `LayoutManager.commitBounds`, so it reaches every layout manager. No other page mentions `canSkipUnchangedLayout`.

`Component.canSkipUnchangedCommit` is `@internal` and `typedoc.json` sets `excludeInternal`, so it renders on no page; the two class overrides are `protected` and likewise excluded. `scripts/llms/check-coverage.mjs` tracks concrete classes only, so `llms.txt` needs no entry. No barrel or export changes.

---

## Potential Challenges

- **`canSkipUnchangedLayout` and `canSkipUnchangedCommit` differ by one word.** The first is the protected, per-class opt-in; the second is the `@internal` per-moment answer that folds in the dirty flag and the element. Every call site outside `Component` uses the second.
- **Reindenting `commitBounds`.** The fast-path branch and the two size setters move verbatim between the new consts and the new `changed`. Re-read the diff and confirm `setWidth` and `setHeight` still run on both branches and still sit before the gate.
- **An `invalidateLayout()` placed before a setter's early return.** The call in `setInsets` / `clearInsets` goes after the same-value guard, or every no-op inset write costs a skip that was safe to take.
- **The flush change is invisible to the test suite.** The offline sink drops `requestAnimationFrame`, so `flushPendingLayouts` never runs in tests and nothing there will catch a mistake in step 4. Read it carefully and run the manual check.
- **`Cell` already opts in, and step 4 changes how its queued renderers are pruned.** `CellLayoutSkip.test.ts`, `Body.test.ts`, `HeaderColumnWindow.test.ts`, `ColumnWindowSlide.test.ts`, `RowCellCache.test.ts` and `ScrollRebindLayoutEconomy.test.ts` pin the table's layout economy. A red test in any of them points at step 4 or step 3, not at the gate.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts:4139-4212`](packages/lib/src/typescript/lib/core/Component.ts#L4139) — `applyBounds`, `canSkipUnchangedLayout` and `writeBounds`. `writeBounds` is the precedent this plan follows for computing `changed`; `applyBounds` is the precedent for the gate itself.
- [`packages/lib/src/typescript/lib/core/Component.ts:216-270`](packages/lib/src/typescript/lib/core/Component.ts#L216) — `flushPendingLayouts` and its ancestor-pruning walk.
- [`packages/lib/src/typescript/lib/core/Component.ts:2465-2480`](packages/lib/src/typescript/lib/core/Component.ts#L2465) — `propagateEffectiveVisibility`, the precedent for a `public` + `@internal` method the module-level flush calls on arbitrary instances.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:531-593`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L531) — `commitBounds`, its doc comment, and the transform fast path the new comparison must not disturb.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts:230-258`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L230) — the only shipped opt-in, and the model writer audit every new opt-in copies.
- [`packages/lib/tests/core/ComponentBounds.test.ts`](packages/lib/tests/core/ComponentBounds.test.ts) cases 5–10 — the suite that already pins this gate on `applyBounds`; the new tests mirror its shape.
- [`packages/lib/tests/component/table/CellLayoutSkip.test.ts`](packages/lib/tests/component/table/CellLayoutSkip.test.ts) and [`HeaderColumnWindow.test.ts`](packages/lib/tests/component/table/HeaderColumnWindow.test.ts) — the table's layout-economy suites, and the one test in the library that catches an un-announcing layout-input writer.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* — placement is the layout manager's job: `doLayout` assigns each child a position and size within the space the parent gave it. A withheld pass must never leave a child placed against a rectangle it no longer holds.
- [`plans/research/render-review-2026-09-15/97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md), *Re-scored on work avoided, not milliseconds* — the measurement this plan answers, and the acceptance numbers.
- [`plans/research/render-review-2026-09-15/98-wave2-rejustification.md`](plans/research/render-review-2026-09-15/98-wave2-rejustification.md), section G09 — the staged scope, the two structural caps, and the rewritten proof target.

---

## Non-Goals

- **Flipping the base default to `true`.** The forced-on arm exists to prove the comparison is sound, not to ship. Every class that opts in buys it with a writer audit.
- **A gate for `Tab.placeStrip`.** `TabBar.placeStrip` ([`component/container/TabBar.ts:2853`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2853)) writes the four setters and calls `layoutChrome` directly — no `commitBounds`, no `applyBounds`, no `doLayout`. So the four tab strips on an S1 frame re-run their chrome layout whatever this plan does. That is a separate change against a separate cap.[^tabstrip]
- **Making `Text` announce an intrinsic re-measure upward.** `Text.setText` schedules only its immediate parent, so a raw `Text` deep under an opted-in container can change size without that container hearing about it. Replacing those calls with the library's own upward relay was measured and breaks 39 tests; it needs its own plan.[^text-relay]
- **Marking every ancestor when a descendant schedules a layout.** Measured and rejected: it breaks nine table tests, because the table's shipped economy depends on ancestors *not* being marked.[^mark-rejected]
- **Opting in `Container`, `Panel`, `Tree` or any further table class.** `Container` is the base of nearly everything, so opting it in is the unrestricted version under another name; `Panel`, `Tree` and the table classes all override `doLayout` and would each need their own audit. `Cell`'s existing opt-in is untouched.
- **Buying frame time.** The measured ceiling for this lever is zero milliseconds at Loom's scale.

---

## Notes

[^no-ms]: From `plans/research/render-review-2026-09-15/97-wave2-measurement.md`: the `skip.unchanged` arm on S1 measured 59.09 ms against plain arms at 58.71 / 58.56 ms, so +0.46 ms, with counted per-frame work 2,969 → 1,949 (−34.3%) from 8 skipped commits per frame. The saving is the recursion each skip avoids, not the skips themselves — about 1,020 calls for 8 skips. The same document's *Why work avoided matters here even at flat ms* is the scaling argument this plan rests on: the counts track the component tree and the resolution is recursive, and this codebase has already been bitten once by a cost that was free at 992 elements and ~195 ms/frame at 21k.

[^ablation-geometry]: The sweep's geometry column recorded `skip.unchanged` as producing a *different* layout from plain, with editor heights reaching 1615 px against plain's 963–1188. `97-wave2-measurement.md` draws the planning conclusion in as many words: "the naive form of G09's skip … is **not** behaviour-preserving, so those plans would have to earn their correctness rather than assume it."

[^probe-a]: Measured 2026-09-17 against `master` at `d00ecf9e`, by patching `LayoutManager.prototype.commitBounds` at runtime over unmodified library source and comparing three arms on one scene: a `VBox` root holding a `Fit` container holding one 100×50 leaf. The container is laid out (leaf 50), resized to 120 out of band and laid out again (leaf 120), then the root commits the container's original rectangle. Plain: leaf 50. The ablation's key — a `WeakMap` of the last requested `(x, y, w, h, translateX, translateY)` — skips the pass and leaves the leaf at **120**. The post-setter comparison in this plan: leaf 50, no skip, because `setHeight(50)` really did move the box.

[^one-gate]: `applyBounds`'s condition is `changed || !canSkipUnchangedLayout() || isLayoutDirty() || !getElement()`, which is `changed || !(canSkipUnchangedLayout() && !isLayoutDirty() && getElement() !== null)` — the gate, negated. Extracting it is behaviour-preserving for `applyBounds` and is what lets `LayoutManager` and the module-level flush ask the same question: `canSkipUnchangedLayout()` is `protected`, so neither can reach it directly. The alternative, moving the whole commit into `Component`, was rejected: the transform fast path is the layout manager's policy and its documentation lives on `commitBounds`.

[^why-staged]: The unrestricted form is "the highest risk in the campaign — every layout manager" (`98-wave2-rejustification.md`). Three reasons the staging is real rather than ceremonial. First, the hazard is per-class: it is about which writers can change a class's subtree without moving its rectangle, and that is a question with a different answer for every class — the audit is the work, and it cannot be done once for everything. Second, the offline suite cannot referee it: the gate forced on for every component fails exactly one of 7,519 tests, and the sibling size-hint plan's demonstrably wrong memo key failed none. Third, the corrected comparison removes the failure mode the sweep actually measured, but the measurement that would license a blanket flip — byte-identical geometry on both scenes with the gate forced on — has not been taken yet, and Arm A of `## Verification` is where it gets taken.

[^stage-one]: `MenuBar` (`component/menubar/MenuBar.ts:61`) extends `Component`, sets its own `HBox` in its constructor, and holds `MenuBarButton` children; `setMenus` is its only structural writer and rebuilds through `disposeAllComponents` / `addComponent`, and `insertComponent` ends with `this._onPreferredSizeChange?.()`, the relay `wireChild` installs, which calls `scheduleLayout()` on every ancestor. `ToolBar` (`component/menubar/ToolBar.ts:135`) extends `Container` and overrides `doLayout` to reflow overflowed buttons after the base pass; that reflow reads the bar's inner width and its children's preferred widths, both of which are unchanged when the bar's rectangle is unchanged and nothing marked it dirty. A `Button` child's label change reaches `Button.recomputePreferredSize`, which calls `super.setPreferredSize`, which fires the same ancestor relay — the reason the bar is safe where a raw `Text` child would not be.

[^insets-evidence]: With the gate forced on for every component and no other change, the `packages/lib` suite fails exactly one test of 7,519: `HeaderColumnWindow.test.ts` case 35, "setting a glyph straight on a rendered cell re-lays it out, with no reconcile". `HeaderCell.setHeaderGlyph` (`component/table/cell/Header.ts:313`) shifts the renderer's left inset and calls `this.doLayout()`, and its own comment states the mechanism: "an inset only reaches the label through a layout pass — nothing in `setInsets` schedules one." The cell's pass then commits the renderer at an unchanged rectangle, which the gate withholds, and the label never moves. Adding `invalidateLayout()` to `setInsets` / `clearInsets` takes the forced-on suite to 470 files / 7,519 tests green. `invalidateLayout` rather than `scheduleLayout` because its own doc comment describes this exact use: "the cheaper counterpart … for setters that cannot lay out immediately … and only need to make sure a later pass is not withheld." `Tab.doLayout` calls `setInsets` on its strip inside a layout pass, so the cheaper of the two matters.

[^flush-alternative]: Two alternatives were considered. Marking every component between the pruned entry and the dirty ancestor is more precise but needs `flushPendingLayouts` split into a marking pass and a layout pass, because an ancestor earlier in the snapshot would otherwise have already run. Not pruning at all gives up a shipped optimisation for every component, not just the ones behind a skippable link. Breaking the walk is one condition in the existing loop and costs at most one redundant top-level pass, in a frame that was already laying that subtree out.

[^generation]: `size-hint-per-pass-memo` bumps its generation counter in six places, of which `doLayout`'s `finally` is the one a withheld pass removes. Its own justification for that bump is that "laying a subtree out changes what it reports next: a flow re-wraps, a `Text` re-measures at its new width, a foreign-DOM leaf republishes its height" — all consequences of the pass running. A pass that does not run causes none of them, so the missing bump serves no stale answer; it serves the same answers for longer, which is the point of the memo. The other five sites are untouched by this plan. The reverse direction also holds: the two designs never disagree about a component, because this plan's skip depends on `isLayoutDirty()` and the element, neither of which the memo reads.

[^probe-e]: Measured 2026-09-17 against `master` at `d00ecf9e` on a modelled-DOM scene: a `Container` with a `Border` manager, a `MenuBar` of four menus NORTH, a vertical `ToolBar` of three flat `Button`s WEST, an empty `Container` CENTER — 32 components. A second `shell.doLayout()` at an unchanged shell size makes 31 commits with 31 recursions today; with `MenuBar` and `ToolBar` opted in it makes 3 commits, 2 skips and 1 recursion; with the gate forced on for every component, 3 commits and 3 skips. All 32 rectangles are identical across the three arms. The 28 commits that disappear are the two bars' buttons and their label and glyph children.

[^probe-b]: Measured 2026-09-17 on a `Fit` root over a `Fit` container over a `VBox` container. With the middle container opted in and clean and the root's rectangle unchanged, the root's pass skips the middle container and the `VBox`'s scheduled pass is never delivered — it is still reported as layout-dirty afterwards, where the unmodified arm reports it clean. `flushPendingLayouts` snapshots `pendingLayouts` and clears it before pruning, so a pruned entry that the ancestor's recursion then fails to reach is not owed to any later frame.

[^suite-prevalidated]: On 2026-09-17 each piece was applied to unmodified library source at runtime and the full `packages/lib` suite was run against it: 470 files, 7,519 tests, 2 todo. Baseline green. The gated `commitBounds` with the opt-ins as they stand today (`Cell` only): green — the change lands inert, as intended, because the table's cells are placed through `applyBounds` rather than `commitBounds`. The gated `commitBounds` forced on for every component: one failure, `HeaderColumnWindow.test.ts` case 35. The same, plus `invalidateLayout()` in `setInsets` / `clearInsets`: green. `invalidateLayout()` in `setInsets` / `clearInsets` alone: green. The simulation could not cover step 4, the flush change, because the offline sink drops `requestAnimationFrame` and `flushPendingLayouts` is module-private — the suite is neutral on it in both directions.

[^stage-one-reach]: `98-wave2-rejustification.md` identifies the unchanged-rect population on an S1 height drag as "each `FileEditor`'s `BorderLayout` NORTH region (the breadcrumbs), four of them". In Loom that region is `FileBreadcrumbs`, a `Container` subclass in Loom's own source, which no opt-in inside this library can reach. It can opt in for itself — `canSkipUnchangedLayout` is `protected`, so a consumer subclass overrides it exactly as `MenuBar` does — but that is a change in Loom, not here. The library-side number to hold this plan to is therefore Arm A's, not Arm B's.

[^tabstrip]: `98-wave2-rejustification.md` open question 6 asks whether `Tab.placeStrip` really is out of the gate's reach, noting the claim rested on reading `layout/Tab.ts` and was not confirmed further down. Confirmed: `TabBar.placeStrip` (`component/container/TabBar.ts:2853`) is four setter calls followed by `this.layoutChrome(width, height)` and a return. It never calls `applyBounds`, `setBounds` or `doLayout`, so no gate on either of those can reach it, and `Tab.doLayout` reaches the strip only through `placeStrip` (`layout/Tab.ts:2218`). A strip gate would have to be written into `placeStrip` itself.

[^text-relay]: `Text.setText` (`component/input/Text.ts:832`) ends with `(this.getParentComponent() ?? this).scheduleLayout()`, as do its font and wrap setters — the immediate parent only. Slice 01's F01.1 lists this hazard as covered because "`Text`-style intrinsic re-measures … relay through `_onPreferredSizeChange` and so re-dirty the ancestor"; that is not what the code does, and the correction matters because it is what decides whether a container may opt in. Firing `notifyIntrinsicSizeChanged()` — the library's own upward relay, which does mark every ancestor — after `Text`'s setters was simulated over the whole suite and produced 39 failures, across `FirstLayoutGate`, `ScrollStrip`'s resize-resync coalescing, `Chart`'s relayout-loop guard and `TextBatchMeasure`. It is a real question with a real blast radius and it is not this plan's.

[^mark-rejected]: Having `scheduleLayout()` and `invalidateLayout()` mark every ancestor — so that a pass owed anywhere in a subtree is visible at every level above it — was simulated over the whole suite and failed nine tests in six files, all in the table: `CellLayoutSkip.test.ts` 11 and 12, `Body.test.ts`'s column-window diffing, `HeaderColumnWindow.test.ts` 28 and 31, `ColumnWindowSlide.test.ts` 6, `RowCellCache.test.ts` 5 and `ScrollRebindLayoutEconomy.test.ts`. The table's shipped economy depends on a renderer scheduling its own layout *without* marking its cell, which is precisely what the marking removes. The narrower fix in step 4 reaches the same failure mode by a route that leaves the table alone.

---

## Implementation Notes

Steps 1 to 9 land as written, on `feature/size-hint-per-pass-memo` at
`9320c19b` rather than on `master`, with the deviations below. The plan was
drafted before phases 1 to 3 existed, so the interactions with both of them
are re-derived here against the shipped code rather than taken from
`[^generation]`.

**Owed passes the plan's gate did not see.** There are three, one of them
the audit's (round 2), and a skip must never withhold any of them.

- **A queued `onFirstLayout` callback.** A pass run while the element is
  detached clears the flag but keeps the drain for the first connected pass.
  If attaching moved nothing, a skip would hold the callbacks forever. The
  gate refuses while the component's own drain is queued (case 10), and a
  pass that leaves a drain waiting marks its opted-in ancestors (case 10b).
- **The fold-back a size-stable move leaves on the moved child's parent.**
  `commitBounds`'s own doc comment promises that a redundant pass releases a
  settled move's `will-change: transform`. A skip withholds exactly that
  pass, so the promotion stays until the bar next moves. That promotion is the
  idle-CPU hazard `LayoutManager.commitBounds.test.ts` already guards
  (case 11).
- **A pass owed by a descendant and not queued (round 2).** Any
  `invalidateLayout()`, including the inset / constraint / sort / manager
  marks below, inside an opted-in component was lost behind that component's
  skip. Case 7c reproduces it four ways.

All three now go through one `@internal` helper, `markPassOwedAbove()`. It
marks every ancestor whose class opted in, and leaves the others alone: they
are laid out on every commit anyway, and their `isLayoutDirty()` keeps its
meaning. It is called from `invalidateLayout()`, from `commitBounds`'s
fast-path branch, and from `doLayout` when a drain is left waiting. It is
`public` for the same reason the gate is: `LayoutManager` calls it on
arbitrary instances.

This is not the ancestor-marking the plan's `[^mark-rejected]` rejected. That
proposal marked every ancestor on `scheduleLayout()`. Queued passes still go
through the flush (step 4), only mark-only owed passes propagate, and they
propagate only to opted-in links. No ancestor of a table cell is opted in,
and a renderer's `scheduleLayout()` still does not mark its cell, so the
table's economy suites stay green.

Two earlier shapes were dropped:

- Marking the moved child's container from the fast path failed
  `TextBatchMeasure` case b. An `Absolute` child with no position constraint
  commits at `NaN` and takes the fast path on every pass, because
  `NaN !== NaN`, so its non-opted host would never report clean.
- A gate-side scan of the component's direct children for a leftover
  translate, the first audit round's shape, missed a promotion one level
  deeper (case 11b).

`applyBounds` shares the gate. So `Cell`'s skip, too, now also refuses while
a drain is queued or a pass is owed beneath it. That is stricter than the
"identical" step 2 promised, and the suite is green under it.

**The element check is truthiness, not `!== null`.** `getElement()` is typed
`Handle | undefined`, but its by-id lookup returns `null` on a miss, so
either comparison lets through one of the two "no element" values. The gate
uses `!!this.getElement()`, which is what `applyBounds` asked before. Case 6
as the plan wrote it could not catch this: a never-rendered component is
permanently dirty, because `doLayout` clears the flag only when there is an
element, so case 6 passes with the element check deleted. Case 6b pins the
state the check actually exists for: a clean component whose element was
released. The offline `getElementById` does not evict a released node (see
`element-release.test.ts`), so the case models the real document's miss for
that one id.

**Case 9 is automated.** The plan says the offline sink drops
`requestAnimationFrame`, so the flush cannot run in tests.
`LayoutFlushIsolation`, `OnFirstLayout` and `Border.passRecord` already
capture the callback with a spy and invoke it, which runs the real
`flushPendingLayouts`. Case 9 does the same. It passes before any change,
fails with steps 1 to 3 and 5 applied but not step 4, and passes with step 4,
so it replaces the plan's manual browser check. The whole file captures
frames, not just case 9: the module's pending-frame handle is cleared only by
a flush that runs, so one uncaptured `scheduleLayout` earlier in the file
would leave every later case's flush unscheduled.

**Writers the plan's audit did not list.** Reading the two bars' writers
found three more that change a bar's layout without moving its rectangle and
without marking it:

- a child's `setDisplayed`, which reconciles visibility and announces nothing
  to the parent;
- a manager reconfigured through `getLayoutManager()`, since `BoxLayout`'s
  setters are bare field writes;
- the bar's own padding or border. These are style writes, which reach
  `invalidateResolvedStyle` and nothing layout-related.

All three are listed as not covered on both overrides, on `MenuBar.md` and
`ToolBar.md`, and in the `next` changelog, next to the plan's own
intrinsic-size caveat. In each case the consumer must follow the change with
`scheduleLayout()`. The component pages and the changelog go beyond the
plan's `## Documentation Impact` because the override comments are
`protected` and appear on no rendered page.

The audit found three more, all generic writers of the same shape as
`setInsets`, and they are closed the same way, with `invalidateLayout()`:

- `Component.setLayoutManager`, next to the size-hint bump phase 3 put there;
- `Component.sortComponents`;
- `LayoutManager.setLayoutConstraints`, which marks its container. A
  `Spacer`'s `setFlex` / `setFlexWeight` reaches it directly, and `ToolBar.md`
  itself recommends `Spacer.flex()` inside a bar.

Case 7b pins all three; each was red before its fix. The only callers that
write constraints from inside a layout pass are table rows and `Split` /
`Tab` hosts, none of them opted in. Forced on, the suite and the sweeps are
unchanged by the closures. `MenuBar`'s override no longer claims its `HBox`
is "never swapped", which was true only of the class's own code, not of a
consumer.

**`commitBounds` does not reach every manager.** The plan's Overview says
every layout manager in the library commits through it, which contradicts
its own Non-Goal about `TabBar.placeStrip`. The first docs pass repeated the
claim. In fact `Accordion` places its sections with raw setters, `Split`'s
drag path does the same, and `layout/Table` uses `applyBounds` /
`setBounds`. The layout-system page and the changelog now name the managers
that do commit through it: the box, flow, grid, border, fit, card, anchor and
absolute managers, plus `Split` and `Tab` on a settled pass. They also say
that a child placed with raw setters is laid out every time, as before.

**Using phase 3's seam for the third writer was tried and measured.** The
idea was to mark the layout owed wherever `invalidateResolvedStyle` runs.
The suite stayed green apart from this file. But the bars stop skipping on
the first repeat pass, because `Border` calls `setVisible` on each region
after committing it. Under that rule, every visibility or state toggle on an
opted-in component costs it one redundant pass, and case 2's numbers move.
It was left out. A class that writes its own padding or border at runtime
lays itself out instead, the way `ToolBar.setOrientation` now does after
swapping its border.

**Interaction with phase 3's size-hint record.** The record is keyed on
`(layout pass, size-hint generation)`. A withheld pass removes three things.
The generation bump in the `finally` of every `doLayout` the skipped subtree
would have run. Every bump caused by writes those passes would have repeated:
style re-assertions, `setDisplayed`, a changed `cacheBorderSpec`, and the
`setInsets` that `Tab.doLayout` makes. And every pass-number end from a
`sizechange` dispatch or first-layout drain inside that subtree. The skip is
taken only when the subtree's pass would have been a no-op: the box did not
move and no pass is owed. So every one of those removals was a spurious
invalidation. Removing them means more cache hits and never a staler answer.

The other direction runs through one path. The skip reads no memoised hint
except through the clamp inside `setWidth`/`setHeight`, and it reads the
clamp's *result*. A stale minimum would commit the same wrong box with or
without the skip, and the next pass corrects it either way.

If a skip is wrong, meaning an unaudited writer, it is a stale-hint bug as
well as a stale-layout bug. But the stale hint lasts only until the next
outermost pass, which starts a new pass number, while the stale layout lasts
until the component is marked or moved. The layout bug is the one that
matters.

A skip can also expose a missing invalidation elsewhere that an incidental
bump from the withheld pass used to cover. Forcing the gate on for every
component, across the whole suite and across all six sweeps, turned up no
such case in the library.

**Interaction with phase 1's pass token.** The `sizechange` dispatch sits
inside `setWidth`/`setHeight`, before the gate is read, and it ends the pass
number whether or not the pass is later withheld. The gate is read *after*
the setters, so a listener's announced write, which dirties the component
through the relay or `scheduleLayout`, is seen and the pass runs.

In an unchanged commit a dispatch is only possible if a clamp moved the box,
and then `changed` is true. The one remaining shape is a listener that puts
the box back where it was requested. That can skip, correctly: the subtree
was laid out at that box and the box ends there. An unannounced write from
such a listener is the per-class audit's business, the same as any other
writer.

**Measured work avoided, and the −34.3%.** The plan's WebKit sweep was not
run: it lives outside both repositories, and the wave's orchestrator deferred
it to the end of the wave. It is owed before this branch counts as measured. What stands in
for it is the deterministic in-process sweep from cases 12 and 13, run on
three scenes:

- the deep 2x2 editor-grid scene from `Component.sizeHintMemo.test.ts`
  (223 components);
- that file's shallow single-pane scene (48 components);
- a shell: `MenuBar` NORTH, a vertical `ToolBar` WEST and the deep scene
  CENTER (254 components).

Each scene is driven by a 20-frame triangle wave in width and in height.
Counted work is `doLayout` calls plus size-hint calls over one whole sweep.
"plain" was measured on `9320c19b` and again after the change.

| scene | sweep | plain | Arm A (forced on) | Arm B (shipped) |
|---|---|---|---|---|
| deep | width | 83,517 | 26,343 (**−68.5%**, 610 skips) | 83,517 (0%, 0 skips) |
| deep | height | 83,517 | 26,553 (**−68.2%**, 400 skips) | 83,517 (0%, 0 skips) |
| shallow | width | 17,644 | 3,824 (**−78.3%**, 20 skips) | 17,644 (0%, 0 skips) |
| shallow | height | 17,644 | 3,824 (**−78.3%**, 20 skips) | 17,644 (0%, 0 skips) |
| shell | width | 93,933 | 28,719 (**−69.4%**, 706 skips) | 89,996 (**−4.2%**, 21 skips) |
| shell | height | 93,933 | 29,014 (**−69.1%**, 297 skips) | 89,008 (**−5.2%**, 21 skips) |

Geometry is byte-identical to plain on every one of the twelve arm/sweep
pairs. That holds for the visual rectangle (translate folded in) and for the
raw fields. What ships avoids nothing on the dock alone, as `[^stage-one-reach]`
predicted, since no library class there opts in. On a shell carrying the two
bars it avoids 4 to 5 per cent, one bar per frame.

The wave-2 ablation's key (last *requested* rectangle) was also simulated on
the same scenes. It produces the same skips, the same work and the same
geometry as Arm A. No box in these scenes is ever moved out of band, and that
is the only thing that separates the two comparisons (case 3 isolates it). So
these scenes neither reproduce nor refute the −34.3%. That figure remains
untrustworthy: it was measured with the buggy key, on the scene where that key
broke geometry. The real figure for the corrected comparison on S1 is Arm A in
the WebKit harness, still owed along with the frame-time check. These counts
are also not comparable in absolute terms with wave 2's. The counters differ,
and a modelled scene is not Loom's live tree.

**Verification.** `npm test`: 473 files, 7,597 passed, 2 todo. That is the
start point's 472 files and 7,566 passed, plus this file and its 31 cases.

Forced on for every component, the suite fails five tests. Four pin the
default being off: `ComponentBounds` case 5, this file's case 1, and case
13's exact skip count on both sweeps. The fifth is `TextBatchMeasure` case b.
Its `Absolute` child commits at `NaN` and re-takes the fast path on every
pass, and once every class is forced to opt in, that marks its container
owed each time. It is a pre-existing `NaN` edge in `commitBounds` that no
shipped opt-in reaches, since box managers never place at `NaN`.
`HeaderColumnWindow` case 35 and every table layout-economy suite stay
green.

`npm run typecheck`, `npm run typecheck:test`, `npm run lint`,
`npm run test:lint`, `npm run build`, `npm run build:lib`,
`npm run docs:llms:check` and `npm run build:docs` are all clean.
`npm run docs:api` reports the same 14 pre-existing warnings phases 1 and 3
recorded, none of them on a symbol this change touches.

Mutation checks confirm that each guard is load-bearing:

- dropping the read-back fails case 3b;
- the ablation's key fails cases 3, 3b and 4;
- dropping the element check fails case 6b;
- dropping the inset marks fails case 7;
- dropping the flush break fails case 9;
- dropping the drain check fails case 10;
- dropping the fast path's mark fails cases 11 and 11b;
- dropping the mark in `invalidateLayout` fails case 7c;
- dropping `ToolBar`'s two new layout tails fails case 8;
- dropping either opt-in fails cases 2 and 13.
