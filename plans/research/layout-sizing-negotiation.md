# Size negotiation: prelayout phase vs. constraint argument

A comparative study of two candidate redesigns for `typescript-ui`'s size-negotiation
model. **This is a research document, not an implementation plan.** It deliberately
lives outside `plans/` proper so `/implement` does not pick it up.

Written against `master` at `4ecbb955`, library version `0.3.0`
([packages/lib/package.json:3](../../packages/lib/package.json)).

All file references are relative to `packages/lib/src/typescript/lib/` unless noted.
Claims about other frameworks (Swing, WPF, Android, Flutter, CSS, AutoLayout) come
from the author's own knowledge and are labelled as such; they are not derived from
anything in this repository.

---

## 0. Recommendation up front

**Adopt Strategy B — add an optional constraint argument to `getPreferredSize`.**

A *single-pass* prelayout over today's argument-less `getPreferredSize()` collects
exactly the same wrong numbers, only earlier. A *multipass* one does better — it
detects the bad first reading and compensates, which is what iterating is for — but
only because the tentative size reaches the child somehow, and with no parameter to
carry it the only route left is mutating the child. That is the constraint argument
implemented as a side effect, inside the phase whose whole promise is that
measurement does not mutate. So a prelayout phase either needs a constraint argument
or needs to smuggle one, which means A is B plus two further changes — separated
measure/arrange, and iterate-to-fixpoint. Those two are what should actually be
compared, and neither earns its cost here. §4.1 works this through.

The single highest-leverage change in the whole codebase is one line:
[`LayoutManager.resolveBounds`](../../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L334)
already holds the cell's `maxWidth`/`maxHeight` when it calls
`component.getPreferredSize()`. Passing them is the entire wiring job for the
top-down half of the protocol, because 36 `placeComponent`/`commitBounds` call sites
funnel through it.

Full reasoning and a staged migration are in §11.

---

## 1. What the framework does today

### 1.1 One recursion, fused

`typescript-ui` is retained-mode and Swing-shaped: every `Component` is
`position: absolute` and is sized by a `LayoutManager` in JavaScript
([ARCHITECTURE.md:66](../../ARCHITECTURE.md), [packages/lib/llms.txt:8](../../packages/lib/llms.txt)).
There is no CSS flow, flexbox, or grid.

Layout is one recursion, not two:

```
Component.doLayout()                      core/Component.ts:5207
  └─ layoutManager.doLayout()             layout/LayoutManager.ts:636 (abstract)
       └─ placeComponent(child, …)        layout/LayoutManager.ts:305
            ├─ resolveBounds(…)           layout/LayoutManager.ts:332
            │    └─ child.getPreferredSize()   ← the bottom-up query
            └─ commitBounds(…)            layout/LayoutManager.ts:471
                 ├─ child.setX/Y/Width/Height
                 └─ child.doLayout()      ← recurse
```

The important structural fact: **the framework already has a measure phase and an
arrange phase.** They are just fused. The bottom-up `getPreferredSize()` recursion
*is* measurement. The top-down `commitBounds → child.doLayout()` recursion *is*
arrangement. The `two-phase-baseline-resolution` plan states this outright and builds
on it — *"the bottom-up `getPreferredSize` recursion is the measure phase, and the
top-down `commitBounds → child.doLayout()` recursion is the placement phase. No new
tree pass is added."*
([plans/two-phase-baseline-resolution.md](../two-phase-baseline-resolution.md))

What is missing is not a phase. It is that the measure phase carries no information
downward.

### 1.2 The query that cannot be answered

```typescript
// core/Component.ts:2666
getPreferredSize(): Size | null
```

No arguments. It asks "how big do you want to be?" with no available-space input.
For any component whose height depends on its width, that question has no answer, so
the component answers for the unwrapped case.

`ARCHITECTURE.md:101` is unambiguous about the consequence: *"A layout manager that
does not report accurate min/preferred/max sizes is a **bug** — fixed at the manager,
never papered over downstream."* By the project's own rule, `HFlow` and `VFlow` are
buggy today, and the bug is not fixable at the manager because the manager is not
given what it needs.

---

## 2. The measured failure, worked in full

`HFlow({ spacing: 8, lineSpacing: 8 })`, eleven children of 190×285, container inner
width 892, no perimeter, no uniform mode.

### 2.1 What `getPreferredSize` reports

[HFlow.ts:71-114](../../packages/lib/src/typescript/lib/layout/HFlow.ts#L71). The loop
at line 87 sums preferred widths and collects heights; there is no width input
anywhere in the method.

| Term | Source | Value |
|---|---|---|
| child widths | `11 × 190` | 2090 |
| item spacing | `8 × (11 − 1)`, line 104 | 80 |
| **reported width** | | **2170** |
| row height | `computeRowHeight([285]×11, [null]×11)`, line 106 → `max(heights)` (LayoutManager.ts:589, no baselines) | 285 |
| **reported height** | | **285** |

### 2.2 What `doLayout` actually produces

[HFlow.ts:232-257](../../packages/lib/src/typescript/lib/layout/HFlow.ts#L232) reads
`container.getInnerSize()` (line 238 — **892 is available right here**) and calls
`groupIntoRows` at line 252. The wrap test is line 289:
`current.contentWidth + spacing + cellWidth > innerWidth`.

| Child | running `contentWidth` | test vs 892 | outcome |
|---|---|---|---|
| 1 | 190 | — (row empty) | row 1, y = 0 |
| 2 | 388 | 190+8+190 = 388 ≤ 892 | row 1 |
| 3 | 586 | 586 ≤ 892 | row 1 |
| 4 | 784 | 784 ≤ 892 | row 1 |
| 5 | 190 | 784+8+190 = 982 **> 892** | wrap → row 2, y = 0+285+8 = **293** |
| 6–8 | 388 / 586 / 784 | ≤ 892 | row 2 |
| 9 | 190 | 982 > 892 | wrap → row 3, y = 293+285+8 = **586** |
| 10–11 | 388 / 586 | ≤ 892 | row 3 |

Three rows. Tops 0 / 293 / 586. Content bottom `586 + 285 = 871`.
Wrapped extent `3 × 285 + 2 × 8 = 871`. ✔ consistent.

### 2.3 The damage

```
reported height   285
actual height     871
clipped           586 px   (overflow: hidden is the framework default)
```

Note the shape of the failure precisely: **the width the answer needs is sitting in
the component.** `container.getInnerSize()` returns 892 at line 238 of `doLayout`, and
`container.getWidth()` returns 892 at any time after the first commit.
`getPreferredSize` declines to consult it. Only the genuinely-first pass has no width.

`VFlow.getPreferredSize` ([VFlow.ts:73](../../packages/lib/src/typescript/lib/layout/VFlow.ts#L73))
is the exact transpose: single-column height, width wrong once a height is imposed.
Its own doc comment already concedes the point — *"This is an approximation."*

---

## 3. Mechanism of each strategy

### 3.1 Strategy A — universal prelayout (measure) phase

**Information flow.** A distinct tree-wide walk before any geometry is written.

```
measure(availableSize)  ──▶ descends, carrying available space
     DesiredSize        ◀── ascends
  [repeat until stable]
arrange(finalRect)      ──▶ descends, writes geometry
```

Nothing is committed during measure. Only after the sizes settle does a positioning
pass run. Measurement decides *how big*; arrangement decides *where*.

**How it fixes the HFlow case.** The parent measures the flow with
`available = { width: 892, height: ∞ }`. `HFlow.measure` runs the same wrap arithmetic
`groupIntoRows` runs today, gets three rows, and returns `DesiredSize = 892 × 871`.
The parent arranges it into an 892×871 rect. Nothing is clipped.

**What it costs.** Every one of the 14 concrete layout managers must be split into a
`measure` and an `arrange`. Every one of the 32 component-level `doLayout` overrides
must be split the same way. The tree walk is a single algorithm, so a node still using
the fused model in the middle of a measure/arrange tree breaks it — that node commits
geometry during what is supposed to be the measure phase, which reintroduces side
effects locally and makes measure non-idempotent for its whole subtree.

### 3.2 Strategy B — constraint argument

**Information flow.** Same single recursion, one extra parameter.

```typescript
getPreferredSize(constraints?: SizeConstraints): Size | null
```

The constraint descends alongside the existing call; the size ascends as it does
today; geometry is still committed by `commitBounds` on the way back down. No new
phase, no new traversal.

**How it fixes the HFlow case.** `resolveBounds`
([LayoutManager.ts:332-451](../../packages/lib/src/typescript/lib/layout/LayoutManager.ts#L332))
already has the cell in hand:

```typescript
// today — LayoutManager.ts:334
const preferredSize = component.getPreferredSize();

// under B
const preferredSize = component.getPreferredSize({ width: maxWidth, height: maxHeight });
```

The flow's host passes `{ width: 892, height: UNBOUNDED }`.
`HFlow.getPreferredSize(constraints)` runs `groupIntoRows` against 892, gets three
rows, and returns `892 × 871`. Same answer as A, same pass.

**What it costs.** In TypeScript an optional parameter added to a base method is
source-compatible in both directions: existing call sites compile unchanged, and an
override declared with *fewer* parameters is still assignable to the base signature.
So all 17 `getPreferredSize` declarations and all ~92 call sites keep compiling on
day one, and managers opt in individually.

---

## 4. Do the two strategies actually differ?

**Your suspicion is correct, and it is the most important observation in this study.**

A *single-pass* prelayout that calls today's argument-less `getPreferredSize()`
gathers `285` for the HFlow. It gathers it before layout instead of during layout.
The number is identical and equally wrong. That phase change buys nothing at all — it
changes *when* a question is asked, not *what* the question is.

A multipass prelayout is a different matter, and §4.1 deals with it separately,
because the answer there is not "buys nothing" but "buys it at a price A cannot
afford".

So Strategy A strictly contains Strategy B:

```
A = B  (constraint descends)
  + separated measure/arrange  (measurement may not commit geometry)
  + iterate-to-fixpoint        (repeat until sizes settle)
```

The comparison as posed is not a fork. It is "B" versus "B plus two things". The real
axes of choice are:

| Axis | Options | Genuinely independent? |
|---|---|---|
| 1. Does measurement receive a constraint? | no / yes | **This is the whole fix.** Effectively yes either way — see §4.1 |
| 2. Is measurement separated from geometry commit? | fused / separated | Yes, independent of axis 1 |
| 3. Single recursion, or iterate to a fixpoint? | single / iterate | Yes, independent of axes 1–2 |

Axis 1 is barely a choice. A design can decline the parameter and let iteration
recover the same information (§4.1), but only by writing the constraint onto the
child between passes — so the constraint descends either way, and the only real
question is whether it does so visibly. Axes 2 and 3 are the actual decision, and
each is separately adoptable. You can have a constraint argument with fused commit
and one pass (that is B). You can have a constraint argument with separated commit
and one pass. You can have all three (that is A).

Restated for the rest of this document:

- **Strategy B** = axis 1 only.
- **Strategy A** = axes 1 + 2 + 3.

§5 evaluates axis 3. §6 evaluates axis 2. Those two sections carry the decision.

### 4.1 The multipass objection, and why it strengthens the case for B

The claim above — that a phase change with no signature change buys nothing — is too
strong against the multipass design, and the objection is right: *the wrong
measurement would be collected and detected here, and compensated for during the
prelayout.* That is precisely what iterating to a fixpoint is for. Pass 1 gathers
`285`, the negotiation assigns `892`, pass 2 re-asks, and the flow now answers `871`.
Convergence does not require the question to change; it requires the loop to run.

So axis 1 is not strictly mandatory. It is one of two ways to get the constraint
downward, and the multipass design picks the other one. The question is what that
other one costs.

**Follow what has to happen on pass 2.** For the flow to answer `871`, something must
have told it about `892` between the passes. There is no parameter, so the only
channel left is the child's own state — `setWidth`, or a published measurement, or
the tentative bounds. Every one of those is a *write to the component being
measured*, performed by the phase that exists to guarantee measurement does not
write. The constraint still descends; it just descends as a mutation instead of an
argument.

That is not a technicality. It is the same quantity, travelling the same direction,
at the same moment — with the type system unable to see it, the call site unable to
name it, and the no-commit rule unable to hold. Compare the two honestly:

| | Constraint as a parameter (B) | Constraint as a mutation (multipass A) |
|---|---|---|
| Where `892` lives | an argument, visible in the signature | a field on the child, written between passes |
| Passes to converge | 1 | ≥ 2, unbounded without a cap (§5.4) |
| Measure-purity | not claimed | claimed, and violated by the mechanism itself |
| Who can see the dependency | the compiler | nobody |

The multipass design therefore does not merely fail to *fix* the side-effect problem
A is sold on (§6.4 already scores that) — it **depends on** the side-effect problem
for its own convergence. A framework cannot both forbid measurement-time mutation and
route its constraints through measurement-time mutation.

**And this is not avoidable by being disciplined,** because some numbers can only be
measured live. `Markdown` learns its height only by writing a width to the real DOM,
flushing, and reading `scrollHeight` back (§6.3). Under the fused model the width is
already committed when the probe runs, so the probe is legal. Under a separated
measure phase there is no committed width yet, so the probe has to speculatively
commit one — a DOM write inside the no-write phase, and then an unwind. The
components that most need the negotiation are exactly the ones whose measurement
cannot be made pure. §11.4 condition 5 states the converse: remove
browser-delegated measurement and A's central promise becomes real.

**The framework already runs this loop, which is the useful part of the objection.**
§5.1 catalogues nine independent equality guards terminating an unbounded fixpoint
that nobody designed — the ninth being the in-flight flow fix itself, which is a
multipass negotiation in miniature: measure at `doLayout`, publish, notify, converge
on the next frame. So the multipass negotiation is not a proposal
— it is the status quo, unnamed, per-component, and differently implemented each
time. What is missing is not the loop but a shared way to hold a measured value and
know when it is stale. `Text._measuredMinSize`, `Markdown._measuredHeight`, and
`FlowLayout._wrappedLineExtent` are three hand-rolled instances of one primitive:
*a cached measurement, keyed on the input that produced it, that invalidates when
that input changes.* Extracting that is worth doing under **either** strategy, is far
smaller than either, and is the piece that makes stage 4 of the migration mechanical
rather than bespoke (§11.3). Under B the key is the constraint, which is exactly the
memo key §10.3 argues for.

---

## 5. Axis 3 — termination

### 5.1 The framework already iterates to a fixpoint

This is not a hypothetical risk being introduced by Strategy A. `typescript-ui`
already runs an unbounded fixpoint iteration, spread across animation frames, and
terminates it purely by scattered value-equality guards.

The canonical instance is the scrollbar gutter
([core/Panel.ts:734-784](../../packages/lib/src/typescript/lib/core/Panel.ts#L734)):

```typescript
if (newRight === this._scrollbarGutter.right && newBottom === this._scrollbarGutter.bottom) {
    return;                                   // ← the fixpoint detector
}

this.setScrollbarGutter(newRight, newBottom);
this.scheduleLayout();                        // ← the iteration step
```

`Panel.getInnerSize` subtracts the gutter (Panel.ts:520-530), so the next pass lays
children out in a narrower box, which may change whether the bar is needed, which
reschedules again. There is no iteration cap anywhere.

Every termination guard currently in the tree:

| Guard | Location | Terminates |
|---|---|---|
| unchanged gutter → no reschedule | Panel.ts:778-780 | scrollbar cascade |
| unchanged preferred size → no relay | Component.ts:2735-2739 | measurement republication |
| unchanged min size → no relay | Component.ts:2855-2858 | constraint republication |
| unchanged max size → no relay | Component.ts:~2896 | constraint republication |
| unchanged overflow flags → no relayout | LayoutManager.ts:204-206 | autoScroll toggle |
| unchanged width → no re-measure | Text.ts:527 | wrap re-measure |
| unchanged width → no re-measure | Markdown.ts:494 | prose re-measure |
| unchanged height → no reschedule | Markdown.ts:559-561 | prose re-measure |
| unchanged extent → no notify | `publishWrappedLineExtent` (in-flight flow plan) | flow re-measure |

Nine equality guards, each load-bearing, each written independently, none coordinated.
Remove any one and the framework spins.

The honest framing of axis 3 is therefore not *"should we introduce iteration?"* but
*"should we make the iteration we already have explicit, centralised, and bounded?"*
That is a genuine point in Strategy A's favour, and the only one that survives §6.

### 5.2 Which cycles are safe

**Monotone cycles terminate.** Wrapping is monotone: narrower ⇒ weakly taller. So
`HFlow` inside a scrolling `Panel` cannot oscillate. Adding the vertical bar narrows
the box, which can only make the flow taller, which can only keep the bar. The flag
latches once and stays.

`VirtualScroller` exploits exactly this and resolves the whole V↔H cascade
arithmetically, in-pass, in a fixed two iterations
([VirtualScroller.ts:291-313](../../packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L291)):

> *"Two iterations are sufficient: each pass can only promote one flag from false to true."*

That is a proof, not a heuristic, and it is the right pattern. `Panel` does the same
job by DOM measurement and rescheduling instead, which is where it loses the bound —
and `scheduleGutterSettleOnShrink` (Panel.ts:600-629) explicitly re-enables the
false direction, letting a latched flag un-latch. A flag that can move both ways is
where a real 2-cycle can live.

### 5.3 Concrete non-monotone cases in *this* codebase

**(a) The shared marker column — a ratchet, i.e. divergence, not oscillation.**

[`ListItem.getMarkerWidth`](../../packages/lib/src/typescript/lib/component/list/ListItem.ts#L163)
carries the diagnosis in its own comment:

> *"`getPreferredSize()` would floor the width at the shared column this item already
> carries, which would ratchet the column wider on every pass and never let it
> shrink."*

The measured input to the fixpoint is contaminated by the fixpoint's previous output.
The code escapes by reading `getPreferredSizeConstraint()` — reaching *behind* the
public accessor to get the raw measurement. Under an explicit re-measuring fixpoint
loop, the naive implementation grows without bound. This is the strongest concrete
argument that "just iterate until settled" is not a safe default in this tree.

**(b) `Table`'s proportional column rescale — a stateful recurrence.**

[`layout/Table.doLayout`](../../packages/lib/src/typescript/lib/layout/Table.ts#L123)
does, on **every** pass:

```typescript
columnWidths = this.rescaleWidths(container, columns, columnWidths, targetWidth);
container.setColumnWidths(columnWidths);
```

`rescaleWidths` (Table.ts:366-399) computes the new widths *from the previous
widths*, proportionally. So pass N+1 is a function of pass N's output, not of the
input constraint alone. With integer rounding, repeated application is not
idempotent — the sequence can drift and, with the scrollbar term in
`getAvailableColumnWidth` (component/table/Table.ts:510-514, which unconditionally
subtracts a full track width whether or not a bar is showing), can cycle. A fixpoint
loop would run this recurrence k times per frame instead of once, amplifying the
drift.

**(c) Content-sized `Grid` tracks with baseline alignment — a genuine cycle.**

`Grid.measureContent` ([Grid.ts:854](../../packages/lib/src/typescript/lib/layout/Grid.ts#L854))
folds `rowAscent + rowDescent` into a `"content"` row's size
([GridTrack.ts:9](../../packages/lib/src/typescript/lib/layout/GridTrack.ts#L9) —
*"the track sizes to its children, using `max(preferred, min)`"*). But a child's
baseline can depend on the height it is given. The `two-phase-baseline-resolution`
plan documents the mechanism with measured numbers: an `HBox` grows past
`rowAscent + rowDescent` to fit a null-baseline child's placed extent
(LayoutManager.ts:589-617), and the parent then reads that surplus as real descent
via `height − baseline`. Measured instance from that plan: a 22px button in a 16px
line makes the zone report height 22 / baseline 13, the parent infers descent 9
against its anchor's 5, resolves a 25px line and pushes the zone down 3 — a 4px clip
in a 21px band.

Loop: track height → child height → child baseline → row ascent/descent → track
height. No monotonicity argument applies. The plan's whole existence is evidence the
loop is real.

**(d) `Markdown` — measurement that must mutate to measure.** See §6.3.

### 5.4 Termination rules and what each costs

| Rule | Cost |
|---|---|
| **Hard iteration cap** | Simple, always terminates. Correctness cost: whatever state the tree is in at pass N is what ships to screen, and you cannot say what that state is. WPF ships exactly this — it throws *"Layout cycle detected"* after 153 iterations, and it fires on real applications (author's own knowledge). A cap converts a hang into a visible wrong layout plus a log line. |
| **Monotonicity by construction** | Correct and bounded, but only applies where you can prove it. Provable here for flow wrapping and for scrollbar latch-on; **not** provable for (a), (b), or (c). |
| **Value-equality fixpoint detection** | What the codebase does today. Correct when the recurrence is a function of its input; wrong when it is stateful (case b) or contaminated (case a), where the equality never trips or trips at a wrong value. |
| **Constraint solver (Cassowary)** | Handles mutual dependency properly. Cost is a step-change in mental model, runtime cost, and debuggability — see §7.6. Out of proportion here. |

**Strategy B needs none of these for its own recursion.** The constraint walk is a
single tree traversal; it cannot loop. B leaves the existing frame-spread iteration
exactly as it is — which is a fair criticism of B, and the answer is that the existing
iteration should get a cheap development-mode pass counter regardless of which
strategy wins. That is a five-line change, independent of everything else here.

**Strategy A must pick one and live with it.** Given cases (a), (b), and (c), it would
have to be a hard cap, because no monotonicity argument covers them and equality
detection demonstrably does not either.

---

## 6. Axis 2 — the side-effect problem

You flagged this as possibly decisive. It is decisive — but not in the direction the
framing suggests. Strategy A's central promise is *"measurement cannot mutate."* In
this framework that promise is unenforceable, and A therefore buys structure it cannot
actually deliver.

### 6.1 How bad it is today

**Reading a child's preferred size can schedule a layout on every ancestor.**

That is not an exaggeration; here is the chain, all verified:

```
HFlow.getPreferredSize()            HFlow.ts:88   →  component.getPreferredSize()
  Text.getPreferredSize()           Text.ts:546-548
    → calculateSize()               Text.ts:324   (when needsMeasure())
      → setCalculatedSize()         Text.ts:347
        → super.setPreferredSize()  Text.ts:313
          → _onPreferredSizeChange  Component.ts:2745
            → wireChild closure     Component.ts:4789-4793
              → parent.scheduleLayout()  AND relay to every ancestor
```

So a manager, mid-way through its own measurement loop, can cause its own container
and every ancestor to be enqueued for another layout. The framework tolerates this
only because `setPreferredSize` early-returns on an unchanged value
(Component.ts:2735-2739), so the second and later passes are silent.

The same happens on the way *down*: `commitBounds` calls `component.setWidth(width)`
(LayoutManager.ts:475), and `Text.setWidth` (Text.ts:521-533) re-measures and
republishes — so **arranging** a child also schedules an ancestor layout.

### 6.2 The full inventory of measurement-time mutation

| # | Site | What it mutates | What stops the loop |
|---|---|---|---|
| 1 | `Text.getPreferredSize` → `calculateSize` (Text.ts:546, 324) | `_measuredBaseline`, `_measuredMinSize`, and `setPreferredSize` → ancestor relay | `needsMeasure()` dirty flag + `setPreferredSize` equality |
| 2 | `Text.setWidth` → `calculateSize` (Text.ts:521) | same | `getWidth() !== previous` |
| 3 | `Markdown.setWidth` → `measureContentHeight` (Markdown.ts:492, 530) | **live DOM**: writes `height:auto`, flushes, reads `scrollHeight`, restores, flushes | `measured === this._measuredHeight` |
| 4 | `AbstractMarkerList.doLayout` → `syncMarkerColumn` (AbstractMarkerList.ts:124, 146) | `setMinSize` on every grandchild `_marker` (ListItem.ts:186) | `setMinSize` equality early return (Component.ts:2855) |
| 5 | `ListItem.getMarkerWidth` (ListItem.ts:163) | calls `getPreferredSize()` purely for its measuring side effect, then bypasses it | — (deliberate bypass) |
| 6 | `layout/Table.doLayout` (Table.ts:125-131) | `container.setColumnWidths(...)` — layout manager writes model state on the owner, every pass | `NaN` guard at Table.ts:109 |
| 7 | `layout/Table.doLayout` (Table.ts:256-264) | direct `DOM.sink.apply` for the header scrollbar cover | — |
| 8 | `Panel.doLayout` (Panel.ts:551, 782) | `commitElementStyle()` mid-pass, then `setScrollbarGutter` + `scheduleLayout` | gutter equality |
| 9 | `component/table/Table.getIntrinsicColumnWidths` (Table.ts:1471) | header text measurement + store sampling, reached from inside `doLayout` | `_autoWidthsSampled` flag |

`AbstractMarkerList.doLayout` even duplicates the pause check, and says why
(AbstractMarkerList.ts:126-129):

> *"The pause check is duplicated from `Component.doLayout` on purpose: without it a
> paused list would still measure and write minimum sizes, and each write would
> schedule a layout on its parent."*

That comment is the author already knowing the model is fragile and patching around it
locally. It is exactly the bug class Strategy A claims to abolish.

### 6.3 Why Strategy A cannot actually abolish it

**`Markdown` breaks the promise structurally, not by convention.**
[Markdown.ts:530-565](../../packages/lib/src/typescript/lib/component/display/Markdown.ts#L530):

```typescript
const restoreHeight = this.getHeight();
this.setElementStyle("height", "auto");
this.commitElementStyle();                                    // ← DOM write #1

const measured = DOM.source.getScrollMetrics(element).scrollHeight + border.top + border.bottom;

this.setElementStyle("height", restoreHeight + "px");
this.commitElementStyle();                                    // ← DOM write #2
```

Markdown's layout is delegated to the browser. The only way to learn its height is to
write a width to the DOM, force a flush, and read back. It is a *mutate-flush-read-
restore* probe. There is no side-effect-free formulation of it.

Worse under A specifically: the probe needs the element to already carry the assigned
width. Under the fused model that width was just committed by `commitBounds`, so
`setWidth` is the natural hook and it works. Under separated measure/arrange, measure
runs *before* any width is committed — so `Markdown.measure` would have to commit a
speculative width to the DOM, in the phase that is by definition not allowed to commit
anything, and then unwind it. **A is actively worse here, not better.**

`Text` is the same shape but cheaper: `DOM.source.measureText` uses an offscreen
probe, so it does not touch the component's own element — but it still writes
`_measuredBaseline`, `_measuredMinSize`, and fires the ancestor relay.

### 6.4 Scoring axis 2 honestly

| Bug class | Strategy A | Strategy B |
|---|---|---|
| Measure writes geometry to *other* components (#4, #6) | **Eliminated structurally** — measure has no geometry-writing API in scope. Real win. | By convention only. Unchanged. |
| Measure writes its own cached measurement (#1, #2) | Convention. Measure must still cache, and caching is a write. | Convention. Unchanged. |
| Measure writes live DOM to measure (#3) | **Cannot be eliminated. Gets worse** — the probe now needs a speculative commit inside the no-commit phase. | Unchanged, and the width arrives as a constraint so the *reason* for the write becomes explicit. |
| Measure triggers an ancestor relay (#1, #2) | Eliminated if measure returns a value instead of publishing one — the biggest single structural gain A offers. | Reduced but not eliminated: once a constraint is available, `Text`/`Markdown`/`HFlow` have no reason to republish, so #1, #2, and the flow plan's `publishWrappedLineExtent` can all be retired. |
| Layout manager writes model state on the owner (#6) | Moves to arrange. Structurally cleaner, but `rescaleWidths`' stateful recurrence (§5.3b) still cannot run in measure, so `Table`'s measurement stays approximate. | Unchanged. |

**Verdict on axis 2.** A eliminates two of five bug classes structurally, cannot touch
two, and makes one worse. That is a real but partial win, and it costs the entire
manager and component layer (§8). It is not decisive in A's favour.

The genuinely useful part of A's discipline is adoptable without A: a
development-mode assertion that no `setX/setY/setWidth/setHeight/setPreferredSize/
setMinSize/setMaxSize` fires while a `getPreferredSize` call is on the stack, driven
by a re-entrancy counter. That catches #1, #2, #4, and #6 as *findings*, costs a
handful of lines, and works identically under either strategy. It is listed in the
migration plan (§11.3, stage 5).

---

## 7. Prior art, and the lesson each teaches

*All of this section is the author's own knowledge, not derived from this repository.*

### 7.1 Java Swing — the inherited model, and its wrapping bug

Swing's `getPreferredSize()` takes no arguments; `typescript-ui` inherited that shape
directly, and inherited the bug with it.

The canonical Swing failure is `JTextArea` with `setLineWrap(true)` inside a
`JScrollPane`. The text area's preferred height depends on its width; the width comes
from the viewport; the viewport sizes itself from the preferred size. The result is
the classic "my text area scrolls horizontally instead of wrapping" bug that has been
asked about on forums for twenty-five years.

Swing's fix is instructive: the `Scrollable` interface, whose
`getScrollableTracksViewportWidth()` returns a **boolean** meaning "force my width to
the viewport's". That is a one-bit constraint channel bolted onto an argument-less
protocol, invented because the protocol could not express the dependency.

**Lesson.** An argument-less preferred size does not stay clean; it grows ad-hoc side
channels. `typescript-ui` has already grown four of them —
`Text.setWidth` re-measure, `Markdown.setWidth` re-measure,
`notifyIntrinsicSizeChanged` (Component.ts:5329), and the in-flight
`publishWrappedLineExtent` — plus a fifth being designed (`imposeBaselineLine`, in
`two-phase-baseline-resolution`). Every one of them exists because the measure call
carries nothing downward. That is the same pathology, at the same point in the
lifecycle, for the same reason.

### 7.2 WPF — Measure / Arrange

`Measure(Size availableSize)` sets `DesiredSize`; `Arrange(Rect finalRect)` sets
`ActualWidth`/`ActualHeight`. Two dirty flags (`InvalidateMeasure`,
`InvalidateArrange`), a global layout queue, measure globally before arrange.
`Double.PositiveInfinity` means unconstrained.

**Got right.** `DesiredSize` is defined as a function of `availableSize` plus content,
which makes it memoisable, and WPF does memoise: an element with an unchanged
`availableSize` and a clean measure flag is skipped entirely.

**What it cost.** Measure must be idempotent and side-effect free, and WPF enforces
this only by convention. Violations are common enough that the framework ships a
runtime detector: after 153 measure/arrange loop iterations it throws
`"Layout cycle detected"`. That exception fires in real applications. WPF is the best
engineered version of Strategy A in wide use, and it still needs a hard cap. §5.4
takes that as given.

### 7.3 Android — MeasureSpec, and double measurement

`onMeasure(int widthMeasureSpec, int heightMeasureSpec)` / `onLayout(...)`. A
`MeasureSpec` packs a *mode* plus a size into a single int, with three modes:

| Mode | Meaning |
|---|---|
| `UNSPECIFIED` | be whatever size you want |
| `AT_MOST` | you may be up to this, less is fine |
| `EXACTLY` | you will be exactly this |

**Got right.** The three modes make explicit what a single "available size" number
leaves ambiguous. For the HFlow case the distinction matters directly: `AT_MOST 892`
means "wrap at 892 and tell me your real height", while `EXACTLY 892` means "you are
892 wide, now tell me the height". They produce the same answer here, but for a
centred or justified flow they do not.

**What it cost.** `LinearLayout` with `weight` measures its children **twice** — once
loosely to find natural sizes, then again with `EXACTLY` after distributing the
leftover. `RelativeLayout` also double-measures. Nested, that is 2^depth measurement
passes, and it is a well-known Android performance pathology. `ConstraintLayout` was
introduced partly to flatten hierarchies specifically to escape it.

**Lesson for this codebase.** Constraint *modes* are worth having, and double-measure
composes multiplicatively. `Grid` already calls `measureContent` six times per pass
(Grid.ts:365, 424, 472, 587, 695, 945) with no memoisation. Any strategy that
multiplies passes multiplies that six.

### 7.4 Flutter — constraints down, sizes up, parent sets position

A `RenderBox` receives `BoxConstraints(minWidth, maxWidth, minHeight, maxHeight)`,
returns a `Size`, and the **parent** then writes the child's offset. Strictly one
pass, O(n).

**Got right.** A child cannot query its own position during layout, and cannot ask
about its siblings. That restriction is not politeness — it is precisely what makes a
single pass sufficient. If a child could read its position, its size could depend on
its position, which depends on its siblings' sizes, and you are back to a fixpoint.
Flutter enforces the ban in the API shape: the offset lives in the parent data, and
the child has no accessor for it during layout. It also has `RelayoutBoundary` — a
subtree under tight constraints does not propagate its dirty flag upward, which is a
real answer to "deep trees are expensive".

Flutter's escape hatches confirm the cost model: `computeMinIntrinsicWidth` and
friends exist, are documented as potentially O(n²), and the framework actively
discourages them. `computeDryLayout` exists specifically so a parent can ask "how big
would you be under these constraints" *without* committing — Flutter's answer to
exactly the problem §6 describes, added as a targeted API rather than a global phase.

**Lesson.** Flutter is Strategy B, taken seriously and with the sibling/position
dependency banned outright. It is the closest match to what `typescript-ui` should
become, and it demonstrates that B is sufficient for a full production layout system
if you are disciplined about what layout is allowed to read.

### 7.5 CSS intrinsic sizing — banning circularity by definition

`min-content`, `max-content`, `fit-content`. The spec defines these as pure functions
of the content, deliberately excluding the available space, so `width: min-content`
can never depend on the used width. Where a dependency would be circular — a
percentage height against an auto-height container — the spec declares the value
behaves as `auto` rather than defining an iteration. Grid and flexbox each get an
explicit multi-step "intrinsic size contribution" algorithm with defined tie-breaks.

**Got right.** Circularity is impossible by construction, not detected at runtime.
There is no cycle detector in a CSS engine because there is no cycle.

**What it cost.** Enormous specification complexity — grid track sizing alone is a
twelve-step algorithm with several internal loops — and years of cross-implementation
disagreement on edge cases (percentage padding in a min-content context, `stretch`
versus `fit-content` interactions).

**Lesson.** "Make circularity impossible" is the strongest possible answer, and you
pay for it once at design time instead of forever at runtime. For a 14-manager
library, the affordable version of this is a documented rule — *a manager's measure
must be a function of its constraint and its children's measures, and nothing else* —
plus the re-entrancy assertion from §6.4.

### 7.6 AutoLayout / Cassowary — the solver end

Apple's AutoLayout compiles declarative constraints into a linear system solved
incrementally by Cassowary, a simplex variant with constraint priorities.

**Got right.** It genuinely handles mutual dependency — "these two views have equal
width" is expressible and solvable, which no down-up protocol can do. It has a
principled story for over- and under-determination via priorities.

**What it cost.** It is slow enough that Apple shipped `UIStackView` (a box layout) to
let developers avoid it for the common case. Debugging is famously poor — the
`"Unable to simultaneously satisfy constraints"` console dump is an industry joke. And
the mental model is a step change: not "how big do you want to be" but "here is a
system of equations."

**The decisive data point:** when Apple designed SwiftUI from scratch, years later,
they did **not** reuse AutoLayout's model. SwiftUI's layout is *parent proposes a
size, child chooses its own size, parent places the child*. That is Strategy B, chosen
deliberately, by the team that had already built and shipped the solver, for their
flagship modern framework.

### 7.7 Summary of the prior art

| Framework | Model | Passes | Termination | Verdict for this codebase |
|---|---|---|---|---|
| Swing | argument-less preferred size | 1 | n/a | The inherited bug. Do not stay here. |
| WPF | Measure(available) / Arrange(rect) | 2 + iterate | hard cap at 153, throws | Strategy A done well; still needs a cap |
| Android | MeasureSpec(mode, size) / onLayout | 2, some containers ×2 | none; cost is 2^depth | Modes are worth stealing; double-measure is not |
| Flutter | BoxConstraints down, Size up | 1 | impossible by API shape | **The target.** Strategy B with the position-read ban |
| CSS | intrinsic sizing, circularity banned | n/a | impossible by spec | The rule to write down |
| AutoLayout | Cassowary solver | solver | priorities | Wrong end of the spectrum; Apple moved off it |

---

## 8. Blast radius, counted

Counts taken from `packages/lib/src/typescript/lib/` on `master` at `4ecbb955`.

### 8.1 The layout layer

**Layout manager hierarchy — 3 abstract classes, 14 concrete managers.**

| Abstract | Location |
|---|---|
| `LayoutManager` | layout/LayoutManager.ts:30 |
| `FlowLayout` | layout/FlowLayout.ts:74 |
| `BoxLayout` | layout/BoxLayout.ts:105 |

| Concrete | Location | overrides `getPreferredSize`? | `doLayout` |
|---|---|---|---|
| `Absolute` | Absolute.ts:22 | no | :40 |
| `Accordion` | Accordion.ts:171 | :1209 | :1509 |
| `Anchor` | Anchor.ts:57 | no | :140 |
| `Border` | Border.ts:53 | :555 | :872 |
| `Card` | Card.ts:25 | :68 | :249 |
| `Fit` | Fit.ts:29 | :86 | :208 |
| `Grid` | Grid.ts:46 | :335 | :661 |
| `HBox` | HBox.ts:32 | :75 | :266 |
| `HFlow` | HFlow.ts:54 | :71 | :232 |
| `Split` | Split.ts:85 | :673 | :1155 |
| `Tab` | Tab.ts:279 | :1311 | :1713 |
| `Table` | Table.ts:40 | no | :90 |
| `VBox` | VBox.ts:32 | :77 | :265 |
| `VFlow` | VFlow.ts:57 | :73 | :227 |

The remaining files in `layout/` are constraints and enums (`LayoutConstraints`,
`GridConstraints`, `AnchorConstraints`, `AccordionConstraints`, `DockRegion`,
`FillType`, `AnchorType`, `GridTrack`, `LayoutSizes`, `CollapseSupport`,
`LayoutSerialization`, `index`), not managers.

### 8.2 Overrides and call sites

| Symbol | Declarations | Textual occurrences | ⇒ call sites |
|---|---|---|---|
| `getPreferredSize` | **17** (2 base + 11 manager + 4 component) | 109 | **92** |
| `getMinSize` | 18 | 94 | 76 |
| `getMaxSize` | 13 | 41 | 28 |
| `doLayout` | **47** (1 abstract + 14 manager + 32 component) | 100 `.doLayout()` calls | 100 |
| `placeComponent` / `commitBounds` | — | 36 | 36 |

`getPreferredSize` declarations in full:

- Base: `Component.ts:2666`, `LayoutManager.ts:112`
- Managers (11): Accordion:1209, Border:555, Card:68, Fit:86, Grid:335, HBox:75,
  HFlow:71, Split:673, Tab:1311, VBox:77, VFlow:73
- Components (4): `Button.ts:1885`, `Image.ts:67`, `Markdown.ts:477`, `Text.ts:546`

The 32 component-level `doLayout` overrides — the heavy hitters for Strategy A:

`Component.ts:5207` (base), `Panel.ts:541`, `AbstractChart.ts:558`,
`FieldSet.ts:242`, `MenuItem.ts:469`, `DiagramView.ts:1339`, `Canvas.ts:307`,
`ProgressBar.ts:178`, `ProgressSpinner.ts:247`, `WebGLCanvas.ts:352`,
`AbstractPickerField.ts:201`, `AutoCompleteField.ts:231`, `ComboBox.ts:491` and `:749`,
`Slider.ts:472`, `Toggle.ts:266`, `AbstractMarkerList.ts:124`,
`AbstractSelectableList.ts:528`, `ToolBar.ts:522`, `table/Body.ts:680`,
`table/Row.ts:455`, `table/cell/Cell.ts:518`, `CellRenderer.ts:78`, `TreeCell.ts:238`,
`Tree.ts:1206`, `AbstractWindow.ts:1839`, `Dialog.ts:334` and `:436`,
`DragGhost.ts:119`, `Notification.ts:608`, `Popover.ts:591`, `Tooltip.ts:619`.

Heaviest by `getPreferredSize()` call density:
`Border.ts` (10), `HBox.ts` (9), `VBox.ts` (8), `Accordion.ts` (6), `TabBar.ts` (6),
`Grid.ts` (5), `Button.ts` (4).

### 8.3 What each strategy has to change

| | Strategy A | Strategy B |
|---|---|---|
| **Signature changes** | 2 new methods (`measure`, `arrange`) on `LayoutManager` + `Component`; both old methods deprecated or reinterpreted | 1 optional parameter on 2 base declarations |
| **Manager rewrites** | **14 of 14**, each split into measure + arrange | **0 required.** Minimum viable set is 4 (HFlow, VFlow, Fit, Card) |
| **Component `doLayout` overrides** | **32**, each split | 0 |
| **`getPreferredSize` call sites** | all 92 reviewed and re-pointed at `measure` | 0 must change; ~1 *should* (LayoutManager.ts:334) |
| **`.doLayout()` call sites** | all 100 reviewed | 0 |
| **`placeComponent`/`commitBounds` sites** | 36 restructured (commit moves out of the measure walk) | 0 |
| **Can it land incrementally?** | **No.** A fused node inside a measure/arrange tree commits geometry during measure, which breaks idempotence for its whole subtree. A compatibility shim keeps both models live and forfeits the guarantee that motivated the change. | **Yes.** TypeScript treats an added optional parameter as compatible in both directions, so every existing override and call site compiles unchanged and managers opt in one at a time. |
| **Test surface at risk** | 257 `*.test.ts`, of which 24 are layout-specific | the 24 layout tests, incrementally |

### 8.4 The one-line lever

Worth isolating, because it is the reason B is cheap:

```typescript
// layout/LayoutManager.ts:332-337, today
protected resolveBounds(component, x, y, maxWidth, maxHeight, fill?, anchor?) {
    const layoutConstraints = this.getLayoutConstraints(component);
    const preferredSize = component.getPreferredSize();   // ← maxWidth/maxHeight in scope, unused
```

The cell extent the child is about to be given is already a local variable at the
exact moment the child is asked how big it wants to be. Passing it is the whole
top-down wiring, and it reaches everything that goes through `placeComponent` — which
is 36 call sites across every manager. `Absolute` bypasses `resolveBounds` by design
(it calls `commitBounds` directly so children can overflow a scroll panel); it would
pass `UNBOUNDED`, which is the correct answer for it anyway.

---

## 9. Interaction with existing machinery

| Mechanism | Location | Under Strategy A | Under Strategy B |
|---|---|---|---|
| `notifyIntrinsicSizeChanged` | Component.ts:5329 | **Preserved**, becomes the `InvalidateMeasure` dirty flag | **Preserved.** It signals a *content* change, which is orthogonal to constraints |
| `Accordion.relayoutHost` | Accordion.ts:882 (7 callers: 376, 442, 548, 914, 933, 2567, 2679) | Absorbed into the dirty-flag system | **Preserved unchanged.** Open/close is content, not constraint |
| `Text.setWidth` re-measure | Text.ts:521-533 | Redundant | **Redundant — retire.** The width arrives as a constraint |
| `Markdown.setWidth` re-measure | Markdown.ts:492-508 | **Worse.** The `scrollHeight` probe needs a committed width, which measure may not commit (§6.3) | **Redundant — retire the trigger.** The probe itself stays, but now runs from a declared constraint rather than a setter side effect |
| `FlowLayout.publishWrappedLineExtent` | in-flight plan | Redundant | **Redundant once B lands.** Becomes the memo cache (§11.3) |
| `Table` owner-stored column widths | component/table/Table.ts:158, 486, 510; layout/Table.ts:123-131 | **Must be preserved but relocated.** The `setColumnWidths` write moves to arrange; `rescaleWidths` reads the previous value, a stateful recurrence measure may not run (§5.3b) | **Preserved as-is.** It is user-adjustable model state (drag path, Table.ts:1396), not a measurement cache |
| Marker column | AbstractMarkerList.ts:146 | Could be absorbed by a second measure pass, but the ratchet (§5.3a) makes that unsafe without redesigning `getMarkerWidth` | **Preserved as-is.** B offers it nothing |
| `Panel` scrollbar gutter | Panel.ts:520-530, 734-784 | **Absorbed.** This is A's cleanest win — the gutter becomes a term in the fixpoint instead of a frame-spread reschedule | Preserved. Should get a pass cap regardless |
| `VirtualScroller` visibility fixpoint | VirtualScroller.ts:291-313 | Redundant — the global fixpoint subsumes the local one | Preserved; already correct and bounded |
| `LayoutManager.inflateForOverflow` | LayoutManager.ts:177 | Preserved | Preserved |
| `Grid.measureContent` ×6 per pass | Grid.ts:854; called 365, 424, 472, 587, 695, 945 | **Must** be memoised — under k iterations the 6× becomes 6k× | **Should** be memoised regardless; the memo key gains the constraint |
| `imposeBaselineLine` (two-phase-baseline plan) | plans/two-phase-baseline-resolution.md | Subsumed — the imposed line becomes one more measure input. A's most genuine architectural win | **Complementary, ships independently.** It is a *different* downward quantity (a line box, not a size) travelling the same recursion |

That last row deserves emphasis, because it is the strongest signal against B in the
whole study. `typescript-ui` is about to acquire a **second** downward-flowing quantity
on a protocol that officially has none. If a third appears, the ad-hoc channels stop
being individually defensible and a general downward-carrying phase starts to look
correct. §11.4 makes that the explicit falsification condition.

---

## 10. Performance

The bar is the project's standing stress test: `MiscPanel`'s slow table
(`packages/lib/src/typescript/MiscPanel.ts`), judged "decently fast with F12 open".

### 10.1 What a pass costs today

A single layout pass on a subtree of n components runs one `getPreferredSize`
recursion interleaved with one `commitBounds` recursion — nominally O(n). Three
things spoil that:

1. **`Grid` measures six times per pass.** `measureContent` (Grid.ts:854) walks every
   child calling both `getPreferredSize()` and `getMinSize()`, and it is called from
   six distinct sites with no memoisation. A grid of 20 children pays 240 size queries
   per pass instead of 40.
2. **`Table` samples the store during layout.** `getIntrinsicColumnWidths`
   (component/table/Table.ts:1471) runs `measureHeaders` + `measureContent` and is
   reached from `layout/Table.initializeWidths` (Table.ts:332) inside `doLayout`. It is
   guarded by `_autoWidthsSampled`, but the guard is a one-shot flag, not a memo.
3. **The size recursion is already known to be a near-exponential hazard.**
   `Component.getPreferredSize` carries this comment (Component.ts:2687-2691):

   > *"`getPreferredSize` is a hot path in the layout-gathering recursion, and the
   > merged maximum runs `Grid.measureContent`, which itself calls children's
   > `getPreferredSize`; clamping to it here would make the recursion re-entrant and
   > exponential in tree depth."*

   The framework dodges the blowup by *not* clamping preferred to the merged max —
   accepting a documented correctness compromise to keep the recursion linear. That is
   how thin the margin already is.

### 10.2 Per-strategy cost

| | Strategy A | Strategy B |
|---|---|---|
| Passes per frame | 2 phases × k iterations | 1 |
| Marginal cost of the fix | k× everything, including Grid's 6× → **6k×** and Table's store sampling × k | ~0. `HFlow.getPreferredSize(constraints)` runs `groupIntoRows`, which is the same O(children) loop it already runs in `doLayout` |
| Deep-tree risk | **Yes.** If any manager double-measures (the Android `LinearLayout` pattern — and `HBox` with weights is exactly that shape), cost is 2^depth × k | No. Single recursion, same depth behaviour as today |
| Memoisation | **Mandatory**, not optional | Recommended, independently useful |

### 10.3 Memoisation, and what the key must be

Under either strategy a measure memo is worth having, but under A it is load-bearing.
The key must be:

```
(constraintWidth, constraintHeight, contentGeneration)
```

The generation counter is non-negotiable, because measurement reads mutable child
state — a memo keyed on the constraint alone returns a stale answer after any content
edit. The codebase already has the pattern and it works:
`Util.textMetricsGeneration()` (used at Text.ts:326 and Text.ts:389) lets every `Text`
invalidate its cached measurement lazily on a theme change without a per-instance
subscription. A structural/content generation is the direct analogue.

WPF's memo is exactly this shape — skip measure when `availableSize` is unchanged and
the measure flag is clean (author's own knowledge). Flutter's is the same idea narrowed
to the common case: a subtree under tight constraints is a `RelayoutBoundary` and its
dirty flag stops there.

### 10.4 Bottom line

Strategy B is performance-neutral on the `MiscPanel` benchmark. Strategy A multiplies a
per-pass cost that is already the framework's known hot spot, by an iteration count
that §5.3 shows cannot be bounded at 2 for this tree, and it does so on a codebase
where the author has already had to compromise correctness once (the unclamped
preferred size) purely to keep the recursion linear.

---

## 11. Recommendation

### 11.1 The call

**Strategy B.** Add `getPreferredSize(constraints?: SizeConstraints)`, thread it
through `resolveBounds`, and let managers opt in.

Strategy A over today's argument-less query is **wrong if it runs one pass** — it
collects the same wrong numbers earlier (§4) — and **self-defeating if it runs
several**, because iteration only converges by writing the constraint onto the child
between passes, which is the measurement-time mutation A exists to forbid (§4.1).
Strategy A as a proper WPF port, with a real constraint on the measure call, is not
wrong. It is disproportionate here:

1. **It contains B anyway** (§4). Whatever else it adds, the constraint argument is the
   part that actually fixes the measured bug — and if A declines to add it, iteration
   has to reintroduce it through the back door (§4.1).
2. **Its central promise is unenforceable** (§6.3). Measurement in this framework
   sometimes *must* mutate the DOM to measure, because `Markdown` delegates to the
   browser. A eliminates two of five side-effect bug classes, cannot touch two, and
   makes one worse.
3. **Its iteration cannot be bounded cheaply** (§5.3). Three concrete non-monotone
   recurrences exist in this tree — the marker-column ratchet, `Table`'s stateful
   proportional rescale, and content-sized `Grid` tracks under baseline alignment. A
   would need a hard cap, which converts a hang into a silently-wrong layout.
4. **It cannot land incrementally** (§8.3), and it lands on 14 managers plus 32
   component `doLayout` overrides plus 36 placement sites, behind 257 test files, with
   one maintainer and a published `0.3.0` API.
5. **B is what a modern framework designed from scratch chooses.** Flutter and SwiftUI
   are both "constraints down, sizes up, parent places" — and SwiftUI is that choice
   made *after* shipping the solver alternative (§7.4, §7.6).

The parts of A worth keeping are keepable without A: the measure-purity *rule*
(§7.5), the re-entrancy assertion (§6.4), and a pass cap on the iteration that already
exists (§5.4).

### 11.2 Design details worth fixing now

**Steal Android's modes.** Do not make `SizeConstraints` a bare `Size`. `AT_MOST 892`
and `EXACTLY 892` are different questions and a justified flow answers them
differently. Either three modes or, following Flutter, a `{ min, max }` pair per axis —
Flutter's `BoxConstraints` encodes all three Android modes without a mode enum
(`min < max` is AT_MOST, `min == max` is EXACTLY, `max == ∞` is UNSPECIFIED). Flutter's
encoding is the better one: fewer concepts, and `UNBOUNDED` already exists in
`primitive/Size.ts`.

**Write the rule down in `ARCHITECTURE.md`.** *A manager's `getPreferredSize` must be a
function of its constraint and its children's `getPreferredSize` — nothing else. It may
not read its own committed geometry, its own position, or a sibling.* That is Flutter's
ban (§7.4) and CSS's non-circularity rule (§7.5) stated as a convention. It is what
keeps the single pass sufficient.

**Extract the measured-value primitive first, and separately.** `Text._measuredMinSize`
/ `_measuredBaseline`, `Markdown._measuredHeight`, and `FlowLayout._wrappedLineExtent`
are three independent hand-rolls of one thing: a cached measurement, keyed on the
input that produced it, invalidated when that input changes, with an equality guard so
an unchanged re-measure raises no relay. Each hand-rolls both halves separately:
`Text` keys on width (Text.ts:527) and guards via `setPreferredSize` equality,
`Markdown` keys on width (Markdown.ts:494) *and* guards on the measured height
(Markdown.ts:559-561), `FlowLayout` has no key at all — it re-measures every pass and
relies solely on extent equality. Four of the nine guards in §5.1 are these three
components. One primitive
replaces all three, is useful under either strategy, and is the difference between
stage 4 being mechanical and being bespoke per component. Under B the key is simply
the constraint, which is the memo key §10.3 already argues for.

**Keep the width answer honest on both axes.** With `AT_MOST 892`, `HFlow` should
report `892 × 871`, not `2170 × 871`. Under an unconstrained call it keeps reporting
`2170 × 285` — which is the correct answer to "how big would you like to be with no
limit". The in-flight flow plan deliberately leaves the main axis at 2170; that is the
right call for a stopgap with no constraint available, and should be revisited when the
constraint exists.

### 11.3 Migration sequence

**Stage 0 — let the in-flight flow plan land.** `flow-layout-width-aware-preferred-size`
publishes the wrapped extent measured in `doLayout` and reports it from
`getPreferredSize`, converging one frame later via `notifyIntrinsicSizeChanged`. It is
a stopgap, it costs a frame of lag, and it is strictly compatible with B — when the
constraint arrives, `HFlow` computes the same number directly and `_wrappedLineExtent`
becomes the memo cache instead of the source of truth. Do not block it.

**Stage 1 — the type and the signature.** Add `SizeConstraints` to `primitive/`. Add the
optional parameter to `Component.getPreferredSize` (Component.ts:2666) and
`LayoutManager.getPreferredSize` (LayoutManager.ts:112). Forward it in the one branch
that matters (Component.ts:2676, `layoutManager.getPreferredSize()`). Nothing behaves
differently yet; every existing override and all 92 call sites still compile.
*Verify:* full test suite green with zero behavioural diffs.

**Stage 2 — the one-line lever.** Change `LayoutManager.resolveBounds` (line 334) to
pass `{ width: maxWidth, height: maxHeight }`. This wires the top-down half for all 36
placement sites at once. Still no behaviour change, because no manager reads the
argument yet.
*Verify:* still zero diffs. This is the checkpoint that proves the plumbing is inert.

**Stage 3 — the pass-through managers.** `Fit` (Fit.ts:86) and `Card` (Card.ts:68) both
delegate through a single `computeSize(sizeOf)` helper; they must forward the constraint
minus the perimeter, or the chain dies one level above every flow. Two small changes,
and they unlock the common `Panel → Fit → HFlow` shape.

**Stage 4 — the reflowing components.** `HFlow` and `VFlow` honour the constraint;
`Text` (Text.ts:546) and `Markdown` (Markdown.ts:477) answer from it instead of from
their `setWidth` side channel. Retire `Text.setWidth`'s re-measure, `Markdown.setWidth`'s
re-measure, and `FlowLayout.publishWrappedLineExtent` one at a time, each behind its own
test.
*Verify:* the HFlow case reports `892 × 871` in a single pass with no
`notifyIntrinsicSizeChanged` relay — assertable offline with `installTestDOM`
(`packages/lib/tests/dom/TestDOM.ts:1379`), which is exactly what makes this migration
tractable for one maintainer.

**Stage 5 — the discipline, and the cap.** Add a development-mode re-entrancy counter
that asserts no size or geometry setter fires while a `getPreferredSize` call is on the
stack. Expect it to fire immediately on `Text` (#1), `AbstractMarkerList` (#4), and
`layout/Table` (#6) — that is the point; it turns §6.2's inventory into a live
worklist. Separately, cap the existing frame-spread iteration with a per-flush pass
counter that warns in development. Both are small and both are worth doing regardless
of which strategy won.

**Stage 6 — the aggregating managers, as needed.** `HBox`, `VBox`, `Border`, `Grid`,
`Split`, `Tab`, `Accordion` forward an apportioned constraint to their children. Do
these on demand, driven by a reported bug, not speculatively. Each is independently
shippable.

**Stage 7 — memoise `Grid`.** Six `measureContent` calls per pass keyed on
`(constraint, generation)`. Independently valuable; do it whenever the `MiscPanel`
benchmark asks for it.

### 11.4 What would have to be true for Strategy A to be the better choice

Stated as falsifiable conditions, so this decision can be revisited on evidence rather
than taste:

1. **A third downward-flowing quantity appears.** Sizes (this study) and baseline line
   boxes (`two-phase-baseline-resolution`) already travel the same recursion by
   different ad-hoc means. A third — an imposed writing mode, a resolved font context, a
   z-context — makes "one general downward phase" cheaper than three special channels.
   *This is the most likely trigger.*
2. **Sibling-coupled sizing becomes a requirement.** The shared marker column
   (`AbstractMarkerList.syncMarkerColumn`) is already a case where a child's size depends
   on a *sibling's* measured size, and it is solved today by mutating siblings during
   layout — the honest signal that B cannot express it. One instance is tolerable as a
   local hack. Three or four (equal-height cards, a shared label column across
   independent `FieldSet`s, cross-panel gutter alignment) make a bounded fixpoint the
   right answer.
3. **The re-entrancy assertion from stage 5 fires constantly and cannot be paid down.**
   If measurement side effects turn out to be pervasive rather than the nine catalogued
   sites, convention is not holding and structure is needed.
4. **The maintainer constraint changes.** A is a multi-week atomic rewrite of the layout
   layer. With a team and a freeze window it is affordable; with one maintainer and a
   published `0.3.0` API it is not.
5. **`Markdown`-style browser-delegated measurement is removed.** As long as any
   component must write DOM to measure itself (Markdown.ts:546-547), A's purity
   guarantee is a fiction and the strongest argument for it evaporates.

None of these hold today. Condition 1 is the one to watch, and the
`two-phase-baseline-resolution` plan is the near miss.
