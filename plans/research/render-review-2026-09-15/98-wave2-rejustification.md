# Wave-2 re-justification — G09, G10, G12, G13, G15, and the resize-mode flag

Read-only analysis, 2026-09-17, against `master` (post wave-0 and wave-1 merges).
No source was changed and no implementation plan was written.

## Why this document exists

The 2026-09-15 render-work review produced twenty-nine plan groups
(`99-synthesis.md`) and a ranking. Waves 0 and 1 have since been implemented,
merged and measured, and the measurements contradicted the ranking:

- The synthesis put **G04 `style-write-dedup`** first among the performance
  groups because a stylesheet-rule mutation forces a full-document restyle in
  WebKitGTK (~195 ms/frame at 21k nodes). Ablating every rule write the harness
  can reach, on the one Loom scenario that has any, saved **1.3 ms** — inside
  the control arm's own noise. Loom's trees are 992–2387 nodes, where that
  restyle is free.
- The group ranked *below* it, **G07 `component-setter-guards`**, delivered
  **−17.4 %** on the sidebar drag (70.8 → 58.5 ms/frame). The write counters
  show it removed three same-value writes per frame; the rule write among them
  was worth 1.3 ms. The other ~11 ms came from the **side effects** those
  setters stopped running — `scheduleLayout()` calls, cache invalidations,
  child rebuilds — which no write counter records.

Four of the five wave-2 groups declare a dependency on G04 phrased as *"so the
measurement is not swamped by rule writes"*. That premise is measured false.
Four of them also carry proof targets denominated in writes. This document
re-derives each group's justification in terms of **avoided work**, checks each
group's findings against the code on `master` today, and asks whether Loom's UI
drives the path at all.

Three facts from `00-baseline.md` are treated as established throughout and are
not re-argued: harness absolutes do not survive a session (only same-session A/B
is valid); the rule-write premise is false for Loom's tree sizes; the wave-1 win
came from side effects rather than writes.

---

## Part 1 — Four corrections that apply to every group below

These came out of this pass and change how the remaining evidence should be
read. They are stated first because each one invalidates a piece of reasoning
that appears in more than one group.

### C1. The harness's write counters cannot see most of the library's writes

`installWriteCounters` (`qa-harness.ts`) wraps `CSSStyleDeclaration.setProperty`,
`removeProperty` and `cssText`, `Element.setAttribute` / `removeAttribute`, and
`CSSStyleSheet.insertRule` / `deleteRule`.

The library does not write through any of those for a single property.
`writeDeclaration` (`packages/lib/src/typescript/lib/core/DOM.ts:304-316`):

```typescript
function writeDeclaration(style: CSSStyleDeclaration, key: string, value: string | null): void {
    if (key.includes("-")) {                       // custom properties only
        …setProperty / removeProperty…
    } else if (value === null) {
        (style as unknown as Record<string, string>)[key] = "";
    } else {
        (style as unknown as Record<string, string>)[key] = value;   // ← camelCase assignment
    }
}
```

Every geometry write goes this way. `Component.writeHorizontalGeometry` /
`writeVerticalGeometry` call `setElementStyle("left"|"width"|"top"|"height", …)`
→ `DOM.sink.apply` → `applyPatchTo` → `writeDeclaration(element.style, key, …)`
→ a plain camelCase property assignment. **The counters never see it.**

`ProductionDOMSink.setRuleStyles` (`core/DOM.ts:1667-1692`) splits by key count:

- **multi-key** → `scratch.cssText = rule.style.cssText`, per-key writes onto the
  scratch declaration, then `rule.style.cssText = scratch.cssText` — *visible*,
  and it produces exactly one `inline.cssText.*` plus one `rule.cssText.*`;
- **single-key** → `writeDeclaration(rule.style, key, value)` — *invisible*.

This explains the baseline's numbers exactly. S3's per-frame pair
`inline.cssText.same = 1` + `rule.cssText.same = 1` is **one multi-key rule
write** (the `Accordion`'s four border longhands through `setBorder`) seen twice
through the scratch round-trip. S1's total absence of any style counter, during
a drag that visibly resizes four editors, is not evidence that S1 writes nothing
— it is evidence that S1's writes are all single-property.

**Consequences.**

1. The baseline's conclusion *"per-frame JS work is already gone in the headline
   case … the 104 ms is not JS write churn"* is **not supported by the counters
   it cites**. It may still be true — the wave-1 A/B showing S1 flat at
   103.9 → 102.9 is independent evidence for it — but the seven-counter table is
   not the proof.
2. The `norules` ablation (`dropRuleWrites`) overrides the same three entry
   points, so it dropped **only multi-key rule writes**. Every single-key rule
   write — `setClipPath`, `CollapseButton`'s `transform` and `width` — survived
   the ablation. The measured 1.3 ms is therefore the cost of *one multi-key rule
   write per frame*, not of all rule writes. That does not rescue G04 (1.3 ms is
   still 1.3 ms and the control arm moved 2.1 ms), but any future claim of the
   form "scenario X writes no rules" must be re-established with a counter that
   wraps camelCase assignment.
3. **Any wave-2 proof target expressed as a DOM-write count must be verified in
   the offline vitest probes (which wrap `DOM.sink`), never in the browser
   harness.** The browser harness's role is timing and ablation.

**Fix for the harness, one function:** in `installWriteCounters`, additionally
define accessor pairs on `CSSStyleDeclaration.prototype` for the property names
the library actually writes (`left`, `top`, `width`, `height`, `transform`,
`clipPath`, `willChange`, `opacity`, `visibility`, `display`, `border*`,
`background*`, `clip`), each delegating to the original descriptor and bumping
`rule|inline.<key>.same|changed`. Until that lands, treat absent style counters
as "not measured", not as zero.

### C2. `attr.data-insets.same` is the tab strip, not the gutters

`00-baseline.md` states that this counter "tracks gutter count exactly — 12
(dock-h), 6 (dock-v), 3 (explorer)". It does not. S1 and S2 are the *same tree*
(the harness notes record `4 gutters total` for both) yet report 12 and 6.

`data-insets` is written by `Component`'s style-apply phase on
`setInsets`/`clearInsets`. The per-frame caller is
`TabBar.applyTabButtonStyles` (`component/container/TabBar.ts:2558-2592`), which
sets insets on each tab button, the tool group and the lead widget — three per
strip in Loom's configuration. The counts are **three per `TabBar` laid out in
that frame**:

| scenario | TabBars relaid out per frame | `data-insets` |
|---|---:|---:|
| S1 dock-h (the row gutter; both rows change height, 4 strips) | 4 | 12 |
| S2 dock-v (one row's inner gutter; 2 strips) | 2 | 6 |
| S3 explorer (`tabs=1`, one strip) | 1 | 3 |

This matters twice. It confirms **G15's path is genuinely on Loom's per-frame
drag path** (Q2 below), and it identifies the whole of S1's visible write churn
as G15's target — which wave 1 then removed for free with the `setInsets` guard,
for a measured S1 delta of −1.0 ms (noise). That is a *direct measurement of
what G15's write half is worth on Loom: about one millisecond, already banked.*

### C3. A `Dock` region **is** a `Split`

`00-baseline.md` reasons that S1 cannot exercise slice 06's findings because
"Loom's 2×2 editor grid is a **Dock** grid" rather than a `Split`. `Dock` builds
its split regions as `new Container({ layoutManager: new Split({ orientation }) })`
(`overlay/Dock.ts:826`), and every gutter in every harness scenario is a
`.SplitGutter` (`pickGutter` selects on that class and finds four in S1).

So the reasoning needs narrowing, in a way that matters for G12:

- **`Split.onDrag` is on Loom's path** in every drag scenario, including S1/S2.
- A *nested* `Split` runs its **whole** `doLayout` on a drag frame: the outer
  split's `onDrag` calls `lhs.doLayout()` / `rhs.doLayout()`, and in the 2×2 grid
  each of those is a row `Container` whose manager is an inner `Split`. So
  `recalculateSizes`, `commitPanes`, `setClipPath` and `gutter.setOpaque` all run
  twice per S1 drag frame.
- The *outermost* split's own `doLayout` does **not** run on a drag frame —
  `onDrag` writes the pane sizes directly and calls the two panes' `doLayout`.
  So in S3 (one `Split`, no nesting) `recalculateSizes`/`commitPanes`/`setOpaque`
  are **not** on the drag path at all; they are on the resize path (S4's
  `runResize`, which calls `container.setWidth(); container.doLayout()`).

What remains true is the *measured* part: S1 records zero rule writes the
counters can see, and S3 records one, which wave 1 removed. Given C1, "zero
visible" now means "zero multi-key", so the `setClipPath` and `CollapseButton`
single-key writes in S1 are **unmeasured, not absent**. See the open questions.

### C4. The harness can pre-measure every wave-2 group *before* it is planned

`ABLATIONS` in `qa-harness.ts` monkey-patches live prototypes
(`noopOnOwningProto`) and already carries twelve entries, several of them
work-shaped (`tab.doLayout`, `tree.doLayout`, `accordion.doLayout`,
`card.doLayout`, `scroller.layoutScrollbars`). This is the right instrument for
a side-effect-denominated proof: an ablation that *applies the proposed change
at runtime* gives a same-session A/B of the group's real value in the real
engine, with no library edit and no plan.

Every group below is given such an ablation. **Running that sweep is the
recommended first action of wave 2** — it costs a morning and it is the only
thing that will stop wave 2 repeating wave 1's mis-ranking.

---

## Part 2 — Group by group

### G09 `unchanged-subtree-layout-skip` — **re-justify** (narrow the scope, measure first)

**Q1 — writes or work?** **Work, correctly.** The proof targets are slice 01
probe `PC` (`doLayout` calls below the root on a second identical pass
`[1,1,1,1,1]` → all zero) and slice 05 (a second identical pass over a
31-component tree calls `doLayout` on fewer than 30 descendants). Nothing here is
write-denominated; no rewrite is needed. It is the only one of the five whose
headline metric was already the right shape.

**Status on `master` — open.** `LayoutManager.commitBounds`
(`layout/LayoutManager.ts:570-593`) still ends in an unconditional
`component.doLayout()`. `Component.canSkipUnchangedLayout()`
(`core/Component.ts:4183`) still defaults to `false`, and `Cell`
(`component/table/cell/Cell.ts:256`) is still the only production override.
`Component.applyBounds` (`:4160-4172`) still carries the gate that
`commitBounds` bypasses. Wave 0 and wave 1 changed none of this.

**Q2 — does Loom exercise the path?** Yes, but **much more narrowly than the
group assumes**, and two structural facts cap it:

1. **The largest unchanged-rect subtree on Loom's drag path is placed outside
   `commitBounds`, so the gate cannot reach it.** On a dock-h drag (S1) only
   *heights* change, so each pane's `TabBar` keeps a byte-identical rectangle —
   the ideal skip candidate, four of them per frame. But `Tab.doLayout` places
   the bar by calling `this._bar.placeStrip(x, y, w, h)` directly
   (`layout/Tab.ts:2213-2215`), never through `commitBounds` or `applyBounds`.
   The strip re-runs `prepareStrip` → `applyTabButtonStyles` → `stripThickness`
   → `layoutChrome` every frame regardless of the gate. X3 already recorded that
   `Accordion` bypasses `commitBounds` entirely; `Tab`'s bar is a second bypass
   and it was not recorded.
2. **The skip removes `doLayout()` and nothing else.** `commitBounds` still runs
   `setX`, `setY`, `setTranslate`, `setWillChange`, `setWidth`, `setHeight` —
   and `setWidth`/`setHeight` *clamp before they compare*
   (`Component.setHeight:4384`, `setSize:4095`), so an unchanged commit still
   pays `clampWidth` + `clampHeight` = **four recursive size aggregations per
   child per frame** on any component that clamps to content. G10 is what
   removes those. X3 states this limit; the group's expected-value framing does
   not.

Where it does pay in Loom: subtrees whose rectangle is stable on the axis being
dragged. On a height-only (dock-h) drag that is each `FileEditor`'s
`BorderLayout` NORTH region (the breadcrumbs), four of them; on a width-only
(explorer/dock-v) drag it is the fixed-height chrome. On a genuine window resize
(S4) both axes move and almost nothing is skippable.

**Scenario.** S1 (`mode=filetree&tabs=4&grid=2x2&gutter=dock-h&count=1`) is the
best of the four, because a height-only drag maximises the unchanged-rect
population. S4 (`mode=noproject&resize=120`) is the cleanest *framework-only*
read but the worst case for the skip. No new scenario is needed.

**Q3 — does the G04 dependency survive?** **No.** It is stated as "so the
measurement is not swamped by rule writes and unguarded setters" — pure
measurement cleanliness, and the premise is measured false. The **G07** half of
that dependency is satisfied: G07 has landed. What survives is a *file*
constraint only — `core/Component.ts` is shared with G10 and G16, so those must
be sequenced, not parallelised. A **new, real** dependency replaces the old one:
G10 should land **before** G09, because the clamp work is what caps G09's
saving (see Q2.2), and because measuring G09 on top of an unclamped commit path
will under-read it.

**Q4 — what did waves 0 and 1 already do?** Nothing for this group. Wave 0's
`LayoutManager.componentRemoved` hook and the `Grid`/`HBox`/`VBox`/`Fit`/`Card`
degenerate-input fixes do not touch `commitBounds`; the batched-flush
`try`/`catch` measured free.

**Expected value: unknown until measured.** Do not quote the synthesis's
"how much of the 107 ms is framework recursion" framing as an estimate — it was
explicitly listed as unverified, and the two caps above make it smaller than the
group implies.

**Bounding ablation (run before planning).** Add to `ABLATIONS`:

```
'skip.unchanged': patch LayoutManager.prototype.commitBounds to cache the last
    committed (x, y, w, h, translateX, translateY) per component on a WeakMap and
    skip the terminal `component.doLayout()` when all six are unchanged and
    `component.isLayoutDirty()` is false.
```

That is G09's change, applied at runtime, with no opt-in list — i.e. the
**upper bound** of what the staged opt-in can deliver. Run it interleaved
against the unablated arm on S1 and S4. If the upper bound is under ~3 ms on S1,
G09 does not belong in wave 2 at its stated risk ("highest in the campaign —
every layout manager").

**Rewritten proof target.** Keep probe `PC`, and add a second, harness-side
target that measures what the gate cannot reach:
`doLayout` invocations per drag frame, grouped by class, collected by a new
`count=work` counter that wraps `Component.prototype.doLayout` and
`Component.prototype.scheduleLayout`. Target: on an S1 frame, the four
`TabBar`/`Tab` chains and the four breadcrumb `Border` NORTH regions report
zero. If the `TabBar` chain does not go to zero, that is the evidence that
`Tab.placeStrip` needs its own gate and that G09 as scoped is incomplete.

---

### G10 `content-clamp-opt-out` — **re-justify** (re-scope onto components Loom mounts)

**Q1 — writes or work?** **Work.** The proof target is slice 21 probe `P21.14`:
renderer `getMinSize`/`getMaxSize` per width-changing frame 270 each → ~90 each,
total size-hint calls 1,710 → ~570. That is avoided work and needs no rewrite.
The problem is not the denominator, it is *which components were counted*.

**Status on `master` — partly closed, and the group's premise is wrong.** X4
states that `clampsToContentSize()` "defaults to `true` … and almost nothing
uses it", citing `Cell` as the single override. On `master` there are **six**:

| override | file | returns |
|---|---|---|
| `Container` (inherited by `Panel`, `Dock` regions, every `Container` subclass) | `core/Container.ts:49` | `false` |
| `Body` | `core/Body.ts:269` | `false` |
| `Dialog` | `overlay/Dialog.ts:1352` | `false` |
| `Rail` | `overlay/Rail.ts:1139` | `false` |
| `Cell` | `component/table/cell/Cell.ts:225` | `false` |
| `Component` (base) | `core/Component.ts:4277` | `true` |

`Container.clampsToContentSize() === false` dates from the 2026-07-19 monorepo
conversion — it long pre-dates the campaign. **Every container on Loom's hot
path already opts out.** Slice 01's probe `PH` (which measured a 35 % cut "from
the clamp alone") built its tree from bare `Component`s carrying box managers
(`Panel(VBox) > 4 × Component(HBox) > 3 × Button`), not from `Container`s — so
the 44 % / 35 % figures are an artefact of the probe's tree shape and **must not
be quoted as Loom's exposure.**

**Q2 — does Loom exercise the path?** The group's named files do **not**:
`component/table/cell/renderer/CellRenderer.ts` and
`component/input/AbstractCalendarDropdown.ts`. The synthesis itself records that
Loom "mounts … no `Table` outside dev tooling" and no calendar. So **as scoped,
G10's headline evidence is unreachable in every Loom scenario** — the same
failure mode that killed G04.

But the lever is real in Loom, on components the group does not name. These
`extends Component` (so they clamp to content) *and* are force-sized by their
parent:

| class | file | why it is force-sized | per-frame count in Loom |
|---|---|---|---|
| `TreeRow` | `component/tree/TreeRow.ts:47` | `VirtualRowView.positionRow(slot, targetY, rowWidth)` writes the viewport width into every pooled row | **88 rows** in S3's file tree |
| `SelectableListRow` | `component/list/AbstractSelectableList.ts:330` | same pattern one class over | dropdown-sized |
| `AccordionHeader` | `component/container/AccordionHeader.ts:178` | `Accordion.placeSection` writes the container width | 4 in Loom's Files view |
| `MenuBar` | `component/menubar/MenuBar.ts:61` | Border NORTH region | 1 |

`positionRow` (`component/shared/VirtualRowView.ts`) already gates on
`geomChanged`, so a settled pass is free — but on **every width-changing drag
frame** (S3, S2) `geomChanged` is true for all 88 rows, and each row runs
`setX` + `setTranslate` + `setWidth` + `setHeight`, of which the last two each
resolve `getMaxSize()` **and** `getMinSize()` through the row's own layout
manager and children. That is **≈352 recursive size aggregations per S3 drag
frame**, on the one scenario wave 1 already proved is sensitive (−17.4 %).

The third part of the group's scope — *"`Component` resolves the clamp bounds
once per rectangle instead of four times"* (X4(c), F01.2 tier 1) — **survives
intact and is now worth more than when it was written**, because wave 1's
`setSize` guard clamps *before* it compares:

```typescript
setSize(size: Size): this {
    const width  = this.clampWidth(size.width);     // getMaxSize() + getMinSize()
    const height = this.clampHeight(size.height);   // getMaxSize() + getMinSize()
    if (this._width === width && this._height === height) { return this; }
```

So an unchanged `setSize`/`setWidth`/`setHeight` still pays the full clamp. Wave
1 removed the write and the side effects; it did not remove the four
aggregations. This is the cheapest item in wave 2 and it is contained to
`core/Component.ts`.

**Scenario.** S3 (`mode=filetree&tabs=1&gutter=explorer&count=1`) — 88 rows,
already the campaign's most sensitive scenario. S2 (dock-v, width-changing) as a
second read. No new scenario needed.

**Q3 — does the G04 dependency survive?** G10 never declared one. Its declared
dependency is **G07 (shares `core/Component.ts`)** — a file-sequencing
constraint, and G07 has landed, so it is **satisfied and discharged**. G10 has
no remaining blocker and can go first in wave 2.

**Q4 — what did waves 0 and 1 already do?** Wave 1 made part (c) *more*
valuable (above). Nothing closed any part of the group. Note that the
`Container` opt-out that *does* exist was never a campaign deliverable — the
review simply missed it.

**Expected value.** The clamp-once change (part c): **small but certain**,
contained, and it applies to every commit in the library. The `TreeRow`
opt-out: **unknown until measured, plausibly the largest single item in wave 2
for S3** — 352 aggregations per frame removed on the scenario that moved 12 ms
when three same-value writes went away. The `CellRenderer`/calendar half:
**zero for Loom**, real for the library; keep it in the plan, do not count it in
the wave-2 expected value, and do not measure the group on it.

**Bounding ablation.**

```
'clamp.rows': for the live Tree's row prototype (and SelectableListRow), define
    `clampsToContentSize() { return false }` on the owning prototype.
'clamp.once': patch Component.prototype.setSize to resolve getMinSize()/getMaxSize()
    once and clamp both axes from that pair.
```

**Proof target (already work-denominated — keep, but re-point):** replace probe
`P21.14` with a `count=work` counter on `Component.prototype.getMinSize` /
`getMaxSize`, measured on S3: today ~4 per visible `TreeRow` per width-changing
frame → 0. Pair it with the ms/frame A/B.

---

### G12 `split-border-drag-economy` — **re-justify** (split it; the write half is closed, the work half is real)

This is the group `00-baseline.md` singled out as carrying G04's exposure. It
does — but only in its write half, and that half has already been closed by
wave 1.

**Q1 — writes or work?** **Mixed, and the mix decides the verdict.**

| item | proof as written | denominated in |
|---|---|---|
| F06.1 `setClipPath` per pane/region per pass | probe `Q3b`: rule declarations per unchanged whole-tree pass 18 → 0 | **writes** |
| F06.2 `CollapseButton` `transform`/`width` rewrite | 3 rule declarations per gutter per pass → 0 | **writes** |
| F06.3 clamped drag still re-lays out both subtrees | probe `R1`: `doLayout` across three over-travel frames 6 → 0 | **work** |
| F06.4 `recalculateSizes` ungated | probe `Q5`: `getMinSize`/`getMaxSize` per pane per unchanged pass 4/4 → ≤ 1/1 | **work** |
| F06.5 `Border.getPreferredSize` also asks each region's min | probe `T1`: 5 pref / 8 min per edge region per pass → 1/1 | **work** |
| F06.9 collapse animation commits non-moving participants | — | work |

**Status on `master`.**

- **F06.1 is closed.** `Component.setClipPath` (`core/Component.ts:2945-2950`)
  now caches `_clipPath` and returns early on an unchanged value, and
  `getClipPath()` exists. That is G07's work, delivered under a different group
  number. `Split.commitPanes:2145` and `Border`'s five call sites are unchanged
  but are now no-ops on a settled pass. **Verify-and-delete, do not re-plan.**
- **F06.2 is open in code.** `CollapseButton.setDirection`
  (`component/container/CollapseButton.ts:271-275`) assigns and calls
  `applyRotation()` with no comparison; `setStripMode` (`:237-243`) stores
  nothing to compare against. Both write single-key rule declarations through
  `createStyleRule("").set(...)`. `Split`'s placement loop calls
  `gutter.setOpaque(false)` and `gutter.setCollapseDirection(...)` on every
  expanded divider on every `Split.doLayout` (`layout/Split.ts:2028-2033`).
  **Whether this fires in Loom is unresolved — see the open questions.**
- **F06.3, F06.4, F06.5 are all open.** `Split.onDrag` (`layout/Split.ts:1381-1391`)
  still calls `lhs.doLayout()` / `rhs.doLayout()` unconditionally, gated only on
  `_undisplayedPaneContent`. `Split.doLayout` calls `recalculateSizes()`
  (`:1955`) with no signature gate. `Border.getPreferredSize` (`:857-930`) still
  calls `regionMinSize` alongside `regionPreferredSize` for each of the four
  edges, and `doLayout` repeats both (`:1236/:1241`, `:1288/:1293`, …).

**Q2 — does Loom exercise the path?** **Yes, more than `00-baseline.md`
concluded** — see correction C3. Specifically:

- `Split.onDrag` runs in **every** drag scenario (S1, S2, S3).
- Nested `Split.doLayout` — and therefore `recalculateSizes`, `commitPanes`,
  `setOpaque` — runs **twice per S1 drag frame** (the two row containers).
- `Border` is on Loom's path **four times over in S1**: `FileEditor` is a
  `Container` with `new BorderLayout({ spacing: 0 })`
  (`loom/src/editor/FileEditor.ts:95`), one per editor panel, plus two more in
  `EditorShell` (`:293`, `:389`). Every one of them runs
  `Border.getPreferredSize` → `regionPreferredSize` + `regionMinSize` per region
  per pass.

One caveat on F06.3: **the harness's standard drag never over-travels.**
`runDrag` walks `±step` for `frames/2` each way, so S3's default
`step=3, frames=150` travels 225 px — the sidebar widens and returns without
hitting its minimum, so the clamped-drag frames F06.3 is about never occur.
The harness already supports what is needed: `step=8&frames=150` travels 600 px
and parks past the explorer minimum for most of the sweep. **No new scenario is
required, only new parameters.**

**Q3 — does the G04 dependency survive?** **No, twice over.** It is stated as
"G04 (the seam memo removes the rule writes; this removes the calls and the
layout passes underneath them)". (a) The measurement-cleanliness premise is
measured false. (b) The specific thing it was waiting for — dedup of
`setClipPath` — **already landed inside G07**, so there is nothing left to wait
for. The declared "shares `SplitGutter.ts` with G20 — sequence" constraint is
real but inert: G20 is not in wave 2. **Ordering constraint 4 survives as a
design instruction, not a schedule one**: F06.3's fix is a port of
`Accordion.layoutSections`'s `reflowAll || contentHeight !== oldHeight` gate
(`layout/Accordion.ts:1704-1722`) and `onGutterDrag`'s dead-zone bookkeeping —
slice 08 probe `B1` measured `Accordion` already producing **0** `doLayout`
calls across three over-travel frames. Do not invent a second mechanism.

**Q4 — what did waves 0 and 1 already do?** Wave 1 closed F06.1 outright. It did
not touch F06.2–F06.5, F06.9.

**Verdict and re-scope.** Keep the group, drop F06.1 from it (verify closed),
demote F06.2 to hygiene pending the open question below, and re-title the
remainder around what it actually is: **a work-economy group for `Split` and
`Border`, not a write-dedup group.** It is the highest-confidence of the five,
because it is the only one whose targets are all on a Loom path that is already
proven sensitive.

**Rewritten proof targets (side-effect form).**

| was | becomes |
|---|---|
| probe `Q3b`: rule declarations per unchanged whole-tree pass 18 → 0 | **deleted** — closed by G07; assert it stays at 0 as a regression guard only |
| F06.2: 3 rule declarations per gutter per pass → 0 | `CollapseButton.applyRotation` / `setStripMode` **invocations** per `Split.doLayout` (they would each have triggered one single-key rule mutation plus, for `applyRotation`, a `createStyleRule` lookup), 3 per gutter → 0 |
| probe `R1`: 6 `doLayout` → 0 | **keep** — already work-denominated; extend to count `doLayout` calls *below* each pane, not just on it, since one skipped pane pass removes a whole CodeMirror re-measure |
| probe `Q5`: min/max 4/4 → ≤1/1 | **keep**, and add the side effects those reads drive: `getLayoutConstraints` 43 → ≤ 4 and `paneDirection` 19 → ≤ 4 per 4-pane pass |
| probe `T1`: 5 pref / 8 min per region → 1/1 | **keep**; add that each avoided report is a *recursive* descent into that region's subtree, which for `FileEditor`'s CENTER region is the whole CodeMirror wrapper |

**Bounding ablations.**

```
'split.noop-drag':  patch Split.prototype.onDrag to early-return when the computed
                    dragAmount is 0 (F06.3's fix, applied live).
'split.recalc-gate': patch Split.prototype.recalculateSizes to no-op after the first
                    call per (container, available) pair (the F06.4 upper bound).
'border.region-memo': patch Border.prototype.getPreferredSize/getMinSize to serve a
                    per-pass memo (the F06.5 upper bound).
```

Run `split.noop-drag` on `mode=filetree&tabs=1&gutter=explorer&step=8&frames=150&count=1`
(so the drag actually clamps) and the other two on S1.

---

### G13 `accordion-pass-economy` — **re-justify** (its headline is already closed; what remains is small and cheap)

**Q1 — writes or work?** **Its headline is writes; its residue is work.** The
stated proofs are probe `E2` ("rule declarations per unchanged pass 4 → 0") and
probe `D1` ("declarations per `Split`-gutter-drag frame on the Loom shape
4 → 0") — both write-denominated, both about the same four declarations. Probe
`E1b` (size reports per open section per settled resizable pass, 2 pref + 3 min
+ 3 max → 0/1/1) and probe `A3` (`matchMedia` per pass per open section 1 → 0)
are work-denominated.

**Status on `master` — the headline is closed, measured.** `Accordion.doLayout`
still calls `applyContainerTheming()` (`layout/Accordion.ts:1556`), which calls
`container.setBorder({ border: THEMED_BORDER })` (`:623-635`). Wave 1 guarded
`Component.setBorder` against the four *resolved* side strings, so that call is
now a no-op. This is not an inference: it is the wave-1 A/B. S3's pre-wave-1
counters were

```
attr.data-insets.same = 3 ;  inline.cssText.same = 1 ;  rule.cssText.same = 1
```

and per correction C1 the `inline.cssText`/`rule.cssText` pair **is** a single
multi-key rule write seen twice through `setRuleStyles`'s scratch round-trip —
i.e. exactly the four Accordion border longhands. Post wave 1, all three
counters are absent. **G13's headline number was already delivered, by G07, and
the `norules` ablation prices it at 1.3 ms.**

Still open on `master`:

- **F08.2** — `doLayout` calls `computeShrinkRatio` (`:1575`) and `computeFill`
  (`:1583`) unconditionally before `computeResizableHeights` (`:1591`); probe
  `E1` showed their output changes no rectangle once every open section has a
  stored size, at a cost of 2 pref + 2 min + 2 max recursive reports per open
  section per frame.
- **F08.4** — `openContentHeight` is still called from `computeFill` (`:2192`),
  from `contentHeightFor` (`:1604`) and from the resizable seed (`:2426`), with
  the same arguments.
- **F08.5** — `layoutSections` still evaluates
  `!Animation.isReducedMotion() && contentHeight < oldHeight` in that order
  (`:1704`), so a live `matchMedia` runs per open section per pass.
- F08.10 (manager setter guards), F08.11 (`setHeaderHeight` never relayouts,
  `setAnimationDuration` never reaches the chevron), F08.14 (`detach` leaks) —
  all open, all per-event or correctness, none per-frame.

**Q2 — does Loom exercise the path?** **Yes.** Loom's Files view is an
`Accordion` (`loom/src/shell/EditorShell.ts:638`, `new Accordion({ compact: true, … })`)
inside the explorer pane, so every S3 drag frame runs `Accordion.doLayout`, and
each closed section holds a `Tree`. The harness already carries an
`accordion.doLayout` ablation, so the *whole* manager's per-frame cost can be
bounded in one run today. The scenario is S3 unchanged; to isolate closed
sections, the harness's `expand=<labels>` parameter can open or leave sections
shut.

**Q3 — does the G04 dependency survive?** **No.** It is stated as "G04 for the
measurement to be clean" — the purest form of the invalidated premise, and the
rule write in question is already gone. The second half — "both are measured on
the same Loom sidebar drag [as G12], so sequence them" — **survives and is now
stronger**: same-session A/B is the only valid comparison, and two groups landing
on the same frame cannot be attributed separately. **G12 and G13 must land and be
measured in separate sweeps.**

**Q4 — what did waves 0 and 1 already do?** Wave 1 closed F08.1 (the headline)
and probably part of F08.10 — the manager's `setThemed` still re-applies
unconditionally, but its four rule declarations are now absorbed by
`Component.setBorder`'s guard, so F08.10's own proof target ("0 rule
declarations for a same-value `setThemed`") is already met for the container
border; only the `scheduleLayout()` it fires unconditionally remains.

**Verdict.** Keep the group, but as a **small, cheap, clearly-bounded** item:
F08.2 + F08.4 + F08.5, plus F08.11/F08.14 as correctness riders. Its expected
value on Loom is **one to three milliseconds on S3, unknown until measured** —
one open `Tree` section's worth of recursive size reports per frame, times two
to four sections. F08.5 is a one-token operand swap and should be taken
regardless of what the ablation says.

**Rewritten proof target (side-effect form).** The group's plan should state:
*the four border declarations are already gone; what this group removes is the
`getPreferredSize`/`getMinSize`/`getMaxSize` recursion into each open section's
`Tree`, and one `matchMedia` per open section per frame.* Target, in
`count=work` terms on S3: per open section per drag frame, `getPreferredSize`
2 → 0, `getMinSize` 3 → 1, `getMaxSize` 3 → 1, `openContentHeight` 2 → 1,
`DOM.source.matchMedia` 1 → 0.

**Bounding ablation.**

```
'accordion.seed': patch Accordion.prototype.computeShrinkRatio to return 0 and
                  computeFill to return an empty Map after the second pass
                  (exactly slice 08 probe E1's stub) — the F08.2 upper bound.
```

Slice 08 already proved this leaves every section's rectangle byte-identical, so
the ablation is visually sound and its timing delta is the honest ceiling.

---

### G15 `tab-strip-pass-economy` — **drop from wave 2** (closed, banked, or not on Loom's path)

This is the group that changed most under scrutiny. Each of its seven items was
checked against `master` and against Loom's configuration.

**Q1 — writes or work?** Mostly writes, and mostly already paid.

| item | status on `master` | Loom exposure |
|---|---|---|
| **F07.1** arrow glyphs + 2 stylesheet rules rebuilt per pass | **CLOSED.** `Button.setGlyph` (`component/button/Button.ts`) now opens with `if (this._glyph?.getGlyphName() === name) return this;` — wave 1. The whole `{removeElement:6, createElement:2, createElementNS:8, ensureStyleRule:2, setRuleStyles:2, deleteStyleRule:2, release:6}` op set is gone. `ScrollStrip.layoutArrows:801-802` still calls `setGlyph` unconditionally, but it is now two string comparisons. | was real; now nil |
| **F07.2** `stripThickness()` has no memo, "~10× per pane per frame" | open, but **mis-attributed**. There are exactly **three** call sites on `master` (`layout/Tab.ts:1682`, `:2128`, `component/container/TabBar.ts:2887`). The measured 20 calls for 2 panes are re-entries driven by the *unmemoised size-hint fan-out* (`Tab.ts:1682` sits inside a size report that `Split.recalculateSizes` re-enters 4–8× per pane per pass). A `stripThickness` memo patches the symptom of G12-F06.4 / G11. | real but derivative |
| **F07.3** `applyTabButtonStyles` rewrites insets/writing-mode/text-align per pass | **write half CLOSED and priced.** Correction C2 identifies the baseline's 12/6/3 `attr.data-insets.same` as exactly this call. Wave 1's `Component.setInsets` guard removed them, and the wave-1 S1 A/B measured the removal at **−1.0 ms, i.e. noise.** What remains is one `new Insets(...)` allocation per styled element per pass (3 per strip in Loom). | real, **measured ≈1 ms** |
| **F07.4** `widthMode: "equal"` is quadratic | **not on Loom's path.** The synthesis says "`Dock`'s own stacks take the default"; they do not. `Dock` spreads its `tabOptions` into every stack (`overlay/Dock.ts:812`), and Loom passes `tabOptions: { widthMode: 'content', maxWidth: …, scrollable: true }` (`loom/src/EditorController.ts:112`). | nil |
| **F07.5** `Tab.attach` materialises 9 elements + 7 rules at construction | open; construction-time, not per-frame | nil per frame |
| **F07.6** hidden strip uses `visibility:hidden` | open — `layout/Tab.ts:2119` is `this._bar.setVisible(this._barVisible)`. But **Loom has no hidden tab bar.** `Dock` hides a bar in exactly two places: lazy-factory frames (`overlay/Dock.ts:646`) and the empty state with no placeholder (`:1018`). Loom uses eager `addPanel` (`EditorController.ts:434`, `:573`), not lazy panels, and sets an empty-content placeholder, which takes the `setBarVisible(true)` branch (`:1012`). | nil |
| **F07.9** per-pass allocation churn | open; `Insets` still `extends BaseObject` (UUID per construction) | small |

**Q2 — does Loom exercise the path?** The *path* yes (C2 proves
`applyTabButtonStyles` runs once per strip per drag frame, 1–4 strips). The
*findings*, largely no: the two biggest (F07.1, F07.4) are respectively closed
and unreachable, and the third (F07.3) has been measured at noise.

**Q3 — does the G04 dependency survive?** G15 never declared one. Its declared
dependency was **G07** (`Button.setGlyph`, `setTextAlign`, `Component.setInsets`
guards) — and G07 did not merely unblock G15, it **absorbed most of it**.

**Q4 — what did waves 0 and 1 already do?** F07.1 closed, F07.3's write half
closed and priced at ~1 ms, plus the pre-wave scroll-strip work already removed
the per-frame forced read (`ScrollStrip` now carries `_refreshArrowsThisPass` /
`arrowRefreshDueThisPass`, `component/container/ScrollStrip.ts:534`, `:810`) and
the `.invisible`/`aria-hidden` churn that `Tab.doLayout` and
`TabBar.positionToolGroup` used to produce per frame. `Component.setVisible` is
independently guarded already (`core/Component.ts`).

**Verdict: drop from wave 2.** What is left is library hygiene with no Loom
frame-path claim: the `stripThickness` memo (a symptom patch for G12-F06.4), the
`layoutChrome` thickness parameter, the `setDisplayed` swap for a bar Loom never
hides, the `Tab.attach` construction deferral, and the `Insets` allocations.
Re-home them — the `stripThickness` memo alongside G12/G11 where its real cause
lives, the rest in G29 `dead-surface-and-docs-sweep` or a later hygiene wave.
**Expected value on Loom: approximately zero.** Nothing here has been *proven*
worthless — F07.9's allocations and the `Tab.attach` construction cost are real
— but nothing in it has a measured Loom frame-path effect, and two of its three
headline items are demonstrably closed or unreachable.

*If the user wants G15 kept anyway*, the honest framing is "library hygiene for
consumers who do not set `widthMode: 'content'`", and it should be measured on a
new scenario (`mode=filetree&tabs=12&gutter=explorer&count=1`, which the harness
already supports) with Loom's `widthMode` pin temporarily removed — i.e. on a
configuration Loom does not ship.

---

## Part 3 — The `resizeMode` flag (placed, not re-justified)

`00-agenda.md` Decision 2 adopts `resizeMode: "live" | "outline"` (default
`"live"`), per-instance on `Split`, `Accordion` and `AbstractWindow` plus a
global default through `core/ComponentDefaults.ts`. It is a feature, so it gets
no performance re-justification here. Three placement notes:

1. **Schedule it after G12.** The agenda names `core/PointerDrag.ts` as "the one
   seam" because all four drag owners route through it. That is true for
   *cursor and pointer-event suppression* — `SplitGutter.ts:9` and
   `WindowBorder.ts:7` import `beginViewportDrag`/`endViewportDrag`,
   `Header.ts:11` and `Scrollbar.ts:9` import `beginPointerDrag`/`endPointerDrag`.
   It is **not** where the per-frame relayout happens. The relayout is driven by
   `Split.scheduleDrag`/`flushDrag` (`layout/Split.ts:1412-1437`) and
   `Accordion.scheduleGutterDrag`/`flushGutterDrag` (`:1975-2000`), which slice
   06 F06.10 / slice 08 F08.7 identify as duplicate implementations of one
   mechanism that G12 is already slated to extract into a shared `layout/`-owned
   helper. **That extracted helper is the natural seam for `resizeMode`.**
   Landing G12 first gives the flag one place to live instead of two;
   `PointerDrag` remains the right place to *read* the flag and to hang the
   outline's own drag affordances.
2. **It does not substitute for any wave-2 group, and none of them substitute
   for it.** The agenda says this already; the measurements reinforce it. The
   flag's payoff is the per-frame cost of a gutter drag collapsing to one
   outline move — which is the entirety of what S1/S2/S3 measure. If it ships
   and Loom opts in, **every wave-2 group's Loom-visible benefit on the drag
   scenarios goes to zero**, and their remaining value is the resize path (S4),
   the settle frame, scroll, typing and first render. Measure the wave-2 groups
   with `resizeMode: "live"` explicitly set, as the agenda instructs, and keep
   the two effects separable.
3. **The `pauseLayout` hazard is real and unchanged.** `Component.pauseLayout` /
   `isLayoutPaused` (`core/Component.ts:7373-7380`) are still a public boolean,
   `resumeLayout` still runs a synchronous layout, and `doLayout` /
   `commitElementStyle` both branch on `isLayoutPaused()` (`:7441`, `:7569`), so
   the third objection from `collapsed-panes-leave-render-tree` — widgets read
   the flag for non-layout behaviour — still applies.

**Recommended position: last in wave 2**, after G12 has created the shared drag
seam, and planned in parallel with wave-2 implementation since it is
feature-shaped rather than measurement-shaped.

---

## Part 4 — Revised wave-2 dependency graph and order

### What the declared dependencies become

| group | declared | verdict | what is left |
|---|---|---|---|
| G09 | G04 + G07 ("not swamped by rule writes and unguarded setters"); shares `Component.ts` with G07, G10 | **G04 dissolves** (premise false). **G07 satisfied** (landed). | file sequencing with G10/G16; **new real dependency on G10** (the clamp caps the skip) |
| G10 | G07 (shares `Component.ts`) | **satisfied** (landed) | none — free to go first |
| G12 | G04 ("the seam memo removes the rule writes"); ordering constraint 4; shares `SplitGutter.ts` with G20 | **G04 dissolves twice**: premise false, *and* the specific `setClipPath` dedup already landed in G07. G20 not in wave 2. | ordering constraint 4 survives as a **design** instruction (port `Accordion`'s gate) |
| G13 | G04 ("for the measurement to be clean"); sequence with G12 (same Loom drag) | **G04 dissolves**; **the G12 sequencing survives and is stronger** — same-session A/B cannot attribute two groups landing on one frame | sequence after G12, measured separately |
| G15 | G07 | satisfied — and G07 **absorbed** the group | dropped from wave 2 |

### Graph

```
   ┌─────────────────────────────────────────────────┐
   │  W2.0  ablation pre-measurement sweep           │  no library change
   │        (bounds G09, G10, G12, G13 in one        │  half a day
   │         morning, same-session, interleaved)     │
   └───────────────────────┬─────────────────────────┘
                           │  results decide whether the rest is worth its risk
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   G12 (Split/Border    G10 (clamp-once   [G15 dropped →
   work economy)         + TreeRow opt-out)  residue re-homed
        │                  │                 to G11 / G29]
        │                  ▼
        │              G09 (unchanged-subtree skip)
        │              — after G10, else under-read
        ▼                  ·
   G13 (accordion,         ·  both edit core/Component.ts:
   reduced) — measured     ·  sequence G10 → G09 → (G16 later)
   in its own sweep        ·
        │                  ·
        ▼
   resizeMode feature — after G12's shared drag-flush seam exists
```

`G12 ∥ G10` is safe: disjoint files (`layout/Split.ts`, `layout/Border.ts`,
`layout/CollapseSupport.ts`, `component/container/*` versus `core/Component.ts`).
They must still be **measured** in separate sweeps.

### Recommended order, with honest expected value

| # | item | expected value on Loom | confidence |
|---|---|---|---|
| 0 | **Ablation sweep** (`skip.unchanged`, `clamp.rows`, `clamp.once`, `split.noop-drag`, `split.recalc-gate`, `border.region-memo`, `accordion.seed`) + the C1 counter fix | n/a — it is the measurement | — |
| 1 | **G12** re-scoped: F06.3 no-op drag gate, F06.4 `recalculateSizes` signature gate, F06.5 `Border` per-pass region record, F06.9; F06.1 verified closed; F06.2 hygiene | **unknown until measured, best candidate of the five.** Four `Border`s and two nested `Split`s run per S1 frame; F06.3 removes a whole CodeMirror re-measure per clamped frame | medium-high that it is non-zero; magnitude unknown |
| 2 | **G10** re-scoped: clamp-once in `Component`, `clampsToContentSize() === false` on `TreeRow` / `SelectableListRow` (+ the library-only `CellRenderer`/calendar half) | **unknown until measured; plausibly the largest single item on S3** — ≈352 recursive aggregations per frame removed. The clamp-once half is small but certain and contained | medium |
| 3 | **G09** staged opt-in, after G10 | **unknown until measured, and structurally capped** — the tab strip is placed outside `commitBounds`, and an unchanged commit still pays four clamped setters unless G10 landed. Highest risk in the campaign | low — do not start without the `skip.unchanged` ablation number |
| 4 | **G13** reduced to F08.2 + F08.4 + F08.5 (+ F08.11/F08.14 correctness) | **1–3 ms on S3, unknown until measured.** Headline (4 rule declarations) already closed by G07 and priced at 1.3 ms | medium that it is small and positive |
| — | **G15** | **≈ zero.** F07.1 closed, F07.3 banked at ≈1 ms, F07.4/F07.6 not on Loom's path | high that it is ≈ zero for Loom |
| 5 | **`resizeMode` flag** | feature, not a perf group; if Loom opts in, it dominates every drag number above | — |

**Do not manufacture a total.** Waves 0 and 1 together moved S3 by 12.3 ms and
S1 by ~1 ms, and the single biggest contributor was a group the synthesis ranked
below the one that delivered 1.3 ms. Nothing in wave 2 has a number until it is
A/B'd in one session.

---

## Part 5 — What I could not determine, and what would settle it

1. **Why S1 records no stylesheet-rule writes when `Split.commitPanes` →
   `setClipPath` and `gutter.setOpaque` → `CollapseButton.applyRotation` should
   both fire twice per frame.** Correction C1 supplies a sufficient explanation
   (both are *single-key* rule writes, invisible to the counters), but I could
   not prove it by reading, and a second explanation — the per-instance rule
   never being materialised, which slice 06 probe `P2` observed for bare
   components — is also consistent. **Settled by:** the C1 counter fix (wrap
   camelCase assignment), plus a `count=work` counter on
   `CollapseButton.prototype.applyRotation`, `setStripMode` and
   `Component.prototype.setClipPath`, run on S1 and S3. This decides whether
   F06.2 is worth a line of code.
2. **Whether `Split.doLayout` actually runs on an S1 drag frame.** The code path
   says it must (outer `onDrag` → row `Container.doLayout()` → inner
   `Split.doLayout`), and that is the basis for G12's S1 exposure claim. It is
   inferred, not observed. **Settled by:** a `count=work` counter on
   `Split.prototype.doLayout` and `recalculateSizes` during an S1 drag. If the
   answer is zero, G12's F06.4/F06.5 exposure falls back to S4 (resize) only and
   G12 drops a rank.
3. **The magnitude of every one of the four surviving groups.** None has ever
   been measured in the real engine. **Settled by:** the W2.0 ablation sweep.
   This is the single highest-value action available and it needs no library
   change.
4. **Whether F06.3's clamped-drag frames occur in any harness run.** The
   standard triangle-wave drag travels 225 px and probably never parks past a
   minimum. **Settled by:** one run with `step=8&frames=150` on S3, reading the
   harness's `before`/`notes` for the explorer pane reaching its floor. If it
   does not clamp even then, F06.3 needs a scenario that starts the drag near the
   minimum, which the harness does **not** currently support (it always grabs the
   gutter's current centre) and would need a small `dragFrom=<px>` addition.
5. **Whether `Insets` still mints a UUID per construction** (slice 28: 1,216 ns
   versus 6 ns for a literal). I did not verify `BaseObject`'s constructor on
   `master`. It bears on F07.9, G13's allocation half and X4's "related
   allocation" note. **Settled by:** reading `BaseObject`'s constructor and, if
   the UUID is still eager, one microbenchmark.
6. **Whether `Tab.placeStrip` should get its own unchanged-rect gate.** My claim
   that G09's gate cannot reach the tab strip rests on reading
   `layout/Tab.ts:2213-2215`; I did not confirm that `placeStrip` never routes
   through `applyBounds` further down. **Settled by:** a `count=work` counter on
   `TabBar.prototype.prepareStrip` under the `skip.unchanged` ablation — if it
   stays at 4 per S1 frame, the claim holds.
7. **Whether the six `clampsToContentSize()` overrides cover everything on
   Loom's commit path.** I enumerated them by grep and spot-checked the four
   classes in the table; I did not walk Loom's live tree. **Settled by:** a
   harness snippet that walks `walkComponents()` and tallies
   `clampsToContentSize()` by class name, run on S1 and S3. That also produces
   G10's real opt-in list instead of the synthesis's guessed one.
