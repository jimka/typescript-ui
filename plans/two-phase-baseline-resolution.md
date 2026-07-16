---
depends-on: [statusbar-baseline-alignment]
touches-shared: [tests/dom/TestDOM.ts]
---

# Two-Phase Baseline Resolution — Implementation Plan

## Overview

Baseline propagation is upward-only. A child reports one scalar (`getBaseline()`), a baseline-aware manager folds those into `rowAscent` ([LayoutManager.ts:538](src/typescript/lib/layout/LayoutManager.ts#L538)), and an `HBox` container republishes its own `rowAscent` upward ([HBox.ts:45-65](src/typescript/lib/layout/HBox.ts#L45)). That half works: sibling `HBox`es do align to each other. The missing half is downward — the *line box* the row resolves is never handed back to the children, so a nested container centres its null-baseline children (`nullChildY`, [LayoutManager.ts:522-526](src/typescript/lib/layout/LayoutManager.ts#L522)) against its **own local** line and freezes the placement before the parent has resolved the real one.

This plan closes the gap with a resolve step wired between the two recursions the framework **already runs**: the bottom-up `getPreferredSize` recursion is the measure phase, and the top-down `commitBounds → child.doLayout()` recursion ([LayoutManager.ts:453-463](src/typescript/lib/layout/LayoutManager.ts#L453)) is the placement phase. No new tree pass is added. The protocol is one new additive query (`getBaselineMetrics(): {ascent, descent} | null`) plus one transient per-layout push (`imposeBaselineLine`).

It touches `primitive/Baseline.ts` (new), `Component`, `LayoutManager`, `HBox`, `Grid`, and `HFlow`. `getBaseline()` and all 17 of its overrides are **unchanged**.

---

## Measured Inputs — treat as established fact

Every leaf number below is measured, from [plans/statusbar-baseline-alignment.md](plans/statusbar-baseline-alignment.md) *Measured Baseline Data* (test font `ascent 13` / `descent 3` / font box `16`; `--ts-ui-font-size: 14px`, `--ts-ui-line-padding: 2px`). Do not re-derive them; assert against them.

| Widget | preferred | `getBaseline()` |
|---|---|---|
| `Text("Hello")` plain | 33×16 | 13 |
| `Text("Hello")` + `centerInHeight(21)` | 33×21 | 16 |
| `Glyph` default | 16×16 | 13 |
| `Button({glyph, flat, compact})` + `pinGlyphSize(14)` | 20×20 (min 20×20) | `null` |

The row arithmetic in *Expected Behaviour* is derived from these by hand. If a leaf metric has drifted, fix the leaf table's consumer, not the protocol.

---

## Architecture Decisions

### The defect is not the scalar — it is that a container's height carries a frozen null-child artifact

Worth pinning precisely, because it dictates the whole API shape. The parent infers a child's descent as `height − baseline`, and for **every leaf and every composite in this library that inference is correct** — it is exactly CSS's inline-block rule. It breaks in exactly one place: a manager that folds a row. `HBox.getPreferredSize` sets its height via `computeRowHeight` ([HBox.ts:118](src/typescript/lib/layout/HBox.ts#L118)), which grows the box past `rowAscent + rowDescent` to fit a null-baseline child's *placed extent* ([LayoutManager.ts:586-597](src/typescript/lib/layout/LayoutManager.ts#L586)). That surplus is an artifact of the **local** line, but `height − baseline` reads it as real descent.

Measured instance (statusbar plan, Shape B): the right zone folds to `rowAscent 13 / rowDescent 3` = a 16px line, `nullChildY` centres the 22px button against it at `y=0`, so the zone's height becomes 22 and its baseline stays 13. The parent infers descent `22 − 13 = 9` against its anchor's 5, resolves a 25px line, and pushes the zone down 3 — a 4px clip in a 21px band. Nothing about that chain is arithmetically wrong; the zone simply answered a question it could not yet answer.

Consequence: **only `HBox` needs a real metrics override.** That is why the API below is a one-class change rather than a 20-component migration.

### The protocol — three steps, zero new passes

`BaselineMetrics = { ascent, descent }` serves as both the up-report and the down-imposed line. One type, both directions.

1. **Measure (up).** `getBaselineMetrics()` reports content that is **line-box independent**: baseline-bearing content only. Null-baseline children contribute *nothing* — their placement depends on the line, so they cannot help define it. `computeRowMetrics` already skips them ([LayoutManager.ts:542-555](src/typescript/lib/layout/LayoutManager.ts#L542)); that skip is now load-bearing, not incidental.
2. **Resolve.** A manager uses the line it was **given**, or resolves one locally if it was given none. A manager that was given no line is the root of its baseline chain, and a root's local resolve *is* the correct resolve. This is CSS's line-box ownership, expressed without a new concept.
3. **Impose (down).** Before reading a child's preferred size or placing it, the parent pushes the resolved line onto every baseline-bearing child and pushes `null` onto the rest. The child's manager then centres its own null children against the real line.

Cost per layout: one extra `getBaselineMetrics()` sweep per baseline-aware manager. On a leaf that is `getBaseline()` + `getPreferredSize()` — both already called later in the same pass, both memoized (`Text` caches on `_measurementDirty`, [Text.ts:441-447](src/typescript/lib/component/input/Text.ts#L441)). On a container it recurses, but the recursion stops at the first manager reporting no baseline, so it is bounded by the baseline chain, not the tree. **Do not add a per-pass metrics cache** — that is speculative, and the framework already re-queries geometry on every layout.

### `getBaselineMetrics()` is additive; `getBaseline()` does not change shape

`getBaseline(): number | null` is overridden by `Text`, `Glyph`, `Button`, `TextInput`, `TextArea`, `ComboBox`, `Toggle`, `Slider`, `NumberSpinner`, `ProgressBar`, `ProgressSpinner`, `Header`, `MenuItem`, `AbstractBooleanInput`, `AbstractPickerField`, `AutoCompleteField`, `AbstractSelectableList` — 17 overrides over `Component`'s base, 18 declarations in all. **Not one of them changes.**

The derivation direction is the decision: `getBaselineMetrics()` derives *from* `getBaseline()`, never the reverse. `Component.getBaselineMetrics()` returns `{ ascent: getBaseline(), descent: getPreferredSize().height − ascent }`. That is not a stopgap — per the first decision it is the *right* answer for every component except a row-folding manager, so the only override in the codebase is `HBox.getContentBaselineMetrics()`. Reversing the direction (`getBaseline()` derived from `getBaselineMetrics()`) would recurse infinitely through the existing overrides and would force all 17 to migrate for zero gain.

The composite pattern documented at [Component.ts:2693-2720](src/typescript/lib/core/Component.ts#L2693) — `wrapInnerBaseline(child.getBaseline())` — is untouched and stays the way a composite delegates.

### `getContentBaselineMetrics()` reports local; `getContentBaseline()` reports effective

The single subtlety in the whole plan, and the implementer must not conflate them:

- **`getContentBaselineMetrics()`** — always the **local** fold, ignoring any imposed line. The parent calls it to *resolve* the line; if it echoed the imposed line back, the resolve would be self-referential.
- **`getContentBaseline()`** — the **effective** ascent: `imposed?.ascent ?? localAscent`. The parent calls it to *place* the container (`y = rowAscent − childBaseline`). Under an imposed line the child's baseline equals the row's, so it lands at `y = 0` — its content box coincides with the line box, which is what makes its null children centre correctly.

### A baseline-aligned container's box becomes the line box — and the imposed line is chrome-relative

Direct consequence of the above: once a line is imposed, a nested baseline-aligned container's content box spans the whole line box rather than hugging its own content. Its content does **not** move relative to the baseline; only the box grows. This is a real, visible change for a nested container carrying a background or border (it now paints over the full line height). Accepted: growing the box is precisely what gives the null child room to centre.

`Component.imposeBaselineLine(line)` **unwraps the chrome** before handing the line to the manager — `{ ascent: line.ascent − perimeter.top, descent: line.descent − perimeter.bottom }`, each floored at 0. It is the exact inverse of `wrapInnerBaseline`, and it is what keeps a chromed nested container's *outer* box flush with the line instead of hanging above the row top by `perimeter.top`.

Rejected alternative: grow the box only when the container actually has a null-baseline child. It looks minimal but is bimodal, and it breaks two levels down (a level-1 `HBox` with no null direct child must still forward the line to a level-2 `HBox` that has one, whose growth would then burst level-1's box). A uniform rule recurses; a conditional one needs a whole extra subtree query.

### Stretching stays fully out — no change

`getContentBaseline()` returns `null` while stretching ([HBox.ts:46-48](src/typescript/lib/layout/HBox.ts#L46)) and `layoutPreferredMode` forces `rowAscent: null` ([HBox.ts:476-478](src/typescript/lib/layout/HBox.ts#L476)). Both stay.

A stretching `HBox` fills every child to the band, so no child has a placed baseline and the container has none either — it is a null child in its parent's row, centred, exactly as today. Should it still help resolve its siblings' line? No: a component with no baseline contributes nothing to a line **by definition**, and that is already the rule for every null child. Should it *consume* an imposed line? No: stretching has no null-child centring to correct — it fills everything. Stretching is an explicit "I fill the band" declaration and two-phase gives it nothing to say. This is the "delete compensation, don't add more" direction landing for free.

Corollary the statusbar plan needs: two-phase does **not** rescue the status bar's current Shape A (nested **and** stretching). Removing the `setStretching(true)` calls is still mandatory there.

### Do not enable cross-axis `CENTER` — it is orthogonal

`crossPlacement` treats cross-axis `CENTER` as inert, deliberately: "each box's default cross placement is more specific than geometric centring" ([BoxLayout.ts:430-434](src/typescript/lib/layout/BoxLayout.ts#L430), returned `null` at [:485-511](src/typescript/lib/layout/BoxLayout.ts#L485)).

The tempting read is that a real resolved line box makes per-child cross `CENTER` well-defined. It does not change anything: `CENTER` was never geometrically *undefined* — `(crossExtent − naturalCross) / 2` has always been computable. Its inertness is a **policy** about whether a per-child anchor may override the box's default placement. Two-phase changes what the line *is*; it says nothing about that policy. Enabling it would touch every `HBox` and `VBox` in the library for a decision this plan produced no evidence about. Out — see *Non-Goals*.

### `centerInHeight` stays — it is the library's strut, and two-phase cannot replace it

The standing preference is to delete compensation rather than add it, so this was tested hard. `centerInHeight(21)` ([Text.ts:1041](src/typescript/lib/component/input/Text.ts#L1041)) is used as a line-box anchor in `StatusBar`, [`PaginationBar.ts:96`](src/typescript/lib/component/display/PaginationBar.ts#L96), [`VideoPlayer.ts:609`](src/typescript/lib/component/display/VideoPlayer.ts#L609), and `MenuItem`. **Every call site survives, unedited.**

Two-phase resolves a line *from content*. Declaring a line box **taller than the content** is a different act, and it is exactly what CSS's strut does — `line-height` on the block seeds the line box before any child is folded in. `centerInHeight` is this library's strut, and it is on `Text` for a hard reason: half-leading a 21px line box down to a baseline of 16 needs the font's ascent/descent, and only a `Text` has measured them.

Rejected alternative: an `HBox({ lineHeight: 21 })` strut option seeding the fold. It cannot work — a manager has no font, so a bare `21` gives it no way to split into `{ascent, descent}`. The idiom is not compensation; it is the only place the metrics exist.

### Relationship to `statusbar-baseline-alignment` — coexist, and do not revert the flattening

Stated plainly, because the honest answer is more interesting than the expected one.

**Two-phase does make the status bar's nesting work.** Shape B (nested, un-stretched) becomes equivalent to Shape C (flattened): the outer row would resolve a 21px line, impose it on the right zone, and the zone would centre the pinned button at `0.5` instead of `0` and report a baseline of 16 instead of 13. The measured 25px demand collapses to 21. So flattening is **not required for correctness** once this lands.

It should nonetheless **land, and stay**:

1. It is a hard dependency. Its step 1 fixes `ModelledDOMSource.measureText` ([tests/dom/TestDOM.ts:742-773](tests/dom/TestDOM.ts#L742)), which ignores `options.lineHeight` and so measures `centerInHeight(21)` as 16px/13. Without it **nothing in this plan is testable offline** — the canonical test's whole point is a deep 16 anchor against a shallow 13.
2. It fixes a shipped bug now, on a smaller diff, against the layout code this plan then rewrites. Reversed order means rewriting `HBox` under a bar that is still broken.
3. Two-phase does not touch Shape A. The bar stretches today; the `setStretching(true)` deletions are still required.
4. Flattening is correct on its own merits, not expedient: it deletes two `Container`s and two `HBox`es, which is what *Compose before specializing* in [ARCHITECTURE.md](ARCHITECTURE.md) asks for. Two-phase demotes it from *necessary* to *a simplification* — a strictly better justification, not a dead one.

**Do not revert it, and do not re-nest the zones to demonstrate this capability.** The payoff lands elsewhere and better: after this plan, a *consumer* who adds a nested-`HBox` widget to the flattened bar aligns correctly, which today they would not.

### Prior art — what to borrow and what to refuse

**CSS inline layout — borrow the model.** Children report ascent/descent; the line is `max(ascent)` / `max(descent)`; the box that owns the line resolves it; the strut seeds it. That is the whole protocol. **Refuse**: the `vertical-align` value set (this library has exactly two placements — on the baseline, and centred in the line for null-baseline children — and `nullChildY`'s doc already commits to that), browser-level half-leading (already handled inside `Text`/`measureText`), and line *wrapping* (an `HBox` is one non-wrapping line by definition; `HFlow` owns wrapping and each of its lines is its own root).

**Swing — borrow only the premise** that a container can query a child's baseline. **Refuse `getBaseline(w, h)`**: making the baseline a function of the allocated box forces the parent to guess a size before it can ask — precisely the circularity two-phase exists to avoid. `getBaseline()` here reads a memoized measurement instead. **Refuse `BaselineResizeBehavior`**: it exists so Swing's `GroupLayout` can *predict* baseline drift across resizes without re-querying. This framework re-queries every layout anyway, so the enum would be dead metadata bolted onto 20+ components.

---

## Public API

New primitive, in a new file `src/typescript/lib/primitive/Baseline.ts`, mirroring `Size.ts`'s shape:

```typescript
/** @category Util */
export interface BaselineMetrics {
    ascent:  number;
    descent: number;
}
```

Re-exported from `src/typescript/lib/primitive/index.ts`:

```typescript
export type { BaselineMetrics } from '~/primitive/Baseline.js';
```

On `Component` (`src/typescript/lib/core/Component.ts`):

```typescript
getBaselineMetrics(): BaselineMetrics | null;          // public; default derives from getBaseline()
imposeBaselineLine(line: BaselineMetrics | null): this; // public; unwraps chrome, forwards to the manager
protected unwrapOuterLine(line: BaselineMetrics | null): BaselineMetrics | null;
```

On `LayoutManager` (`src/typescript/lib/layout/LayoutManager.ts`):

```typescript
getContentBaselineMetrics(): BaselineMetrics | null;                 // default derives from getContentBaseline()
setImposedBaselineLine(line: BaselineMetrics | null): void;          // public: the parent manager drives it
protected getImposedBaselineLine(): BaselineMetrics | null;
protected imposeRowLine(components: Component[], line: BaselineMetrics | null): void;
protected computeRowHeight(heights: number[], baselines: Array<number | null>, line?: BaselineMetrics | null): number;  // widened
```

On `HBox` (`src/typescript/lib/layout/HBox.ts`) — the only override in the codebase:

```typescript
getContentBaselineMetrics(): BaselineMetrics | null;   // real fold; ignores the imposed line
getContentBaseline(): number | null;                   // now returns the EFFECTIVE ascent
```

No state-bearing consumer-configurable property is added, so no `XOptions` field: the imposed line is transient per-layout state the parent manager drives, exactly like `_overflowing` ([LayoutManager.ts:41](src/typescript/lib/layout/LayoutManager.ts#L41)) — which is the precedent for a public setter with a `protected` getter. Per [ARCHITECTURE.md](ARCHITECTURE.md) *"Three non-negotiable rules"* rule 3, framework-managed state stays **off** the options bag.

**`setImposedBaselineLine` must NOT call `doLayout()`.** `setOverflowing` does ([LayoutManager.ts:192](src/typescript/lib/layout/LayoutManager.ts#L192)); this one is called *from inside* a layout pass, so triggering one would recurse forever.

---

## Internal Structure

`Component` — the default derivation and the chrome unwrap:

```typescript
getBaselineMetrics(): BaselineMetrics | null {
    const ascent = this.getBaseline();

    if (ascent === null) {
        return null;
    }

    const preferred = this.getPreferredSize();

    return { ascent, descent: preferred ? Math.max(0, preferred.height - ascent) : 0 };
}

imposeBaselineLine(line: BaselineMetrics | null): this {
    this.getLayoutManager()?.setImposedBaselineLine(this.unwrapOuterLine(line));

    return this;
}

protected unwrapOuterLine(line: BaselineMetrics | null): BaselineMetrics | null {
    if (line === null) {
        return null;
    }

    const perimeter = this.getPerimeterSize();

    return {
        ascent:  Math.max(0, line.ascent  - perimeter.top),
        descent: Math.max(0, line.descent - perimeter.bottom),
    };
}
```

`LayoutManager` — the default metrics, the transient line, and the shared impose helper:

```typescript
// Transient per-layout state: the line box the PARENT manager resolved, pushed
// down through `Component.imposeBaselineLine` before it reads this container's
// preferred size or places it. `null` means "no line was given" — i.e. this
// manager is the root of its baseline chain and resolves its own.
private _imposedBaselineLine: BaselineMetrics | null = null;

getContentBaselineMetrics(): BaselineMetrics | null {
    const ascent = this.getContentBaseline();

    if (ascent === null) {
        return null;
    }

    const preferred = this.getPreferredSize();
    const perimeter = this.getContainer()?.getPerimeterSize();
    const inner     = preferred && perimeter ? preferred.height - perimeter.top - perimeter.bottom : null;

    return { ascent, descent: inner === null ? 0 : Math.max(0, inner - ascent) };
}

setImposedBaselineLine(line: BaselineMetrics | null): void {
    // No doLayout() here, unlike setOverflowing: this is called from inside a
    // layout pass, so re-triggering one would recurse forever.
    this._imposedBaselineLine = line;
}

protected getImposedBaselineLine(): BaselineMetrics | null {
    return this._imposedBaselineLine;
}

/**
 * Pushes the row's resolved line onto its baseline-bearing children and clears
 * it on the rest. Call after resolving the line and BEFORE reading any child's
 * preferred size or baseline — both are line-dependent for a nested container.
 */
protected imposeRowLine(components: Component[], line: BaselineMetrics | null): void {
    for (const component of components) {
        component.imposeBaselineLine(component.getBaselineMetrics() === null ? null : line);
    }
}
```

`computeRowHeight` gains an optional pre-resolved line; the local fold stays the fallback:

```typescript
protected computeRowHeight(heights: number[], baselines: Array<number | null>, line?: BaselineMetrics | null): number {
    const { rowAscent, rowDescent } = line
        ? { rowAscent: line.ascent as number | null, rowDescent: line.descent }
        : this.computeRowMetrics(heights, baselines);

    // ... body unchanged from LayoutManager.ts:574-599
}
```

`HBox` — the two faces of the baseline, and the shared resolve:

```typescript
getContentBaselineMetrics(): BaselineMetrics | null {
    if (this.isStretching()) {
        return null;
    }

    const container = this.getContainer();
    if (!container) {
        return null;
    }

    const heights: number[] = [];
    const baselines: Array<number | null> = [];

    for (const component of container.getLaidOutComponents()) {
        const size = component.getPreferredSize();

        heights.push(size ? size.height : 0);
        baselines.push(component.getBaseline());
    }

    const { rowAscent, rowDescent } = this.computeRowMetrics(heights, baselines);

    return rowAscent === null ? null : { ascent: rowAscent, descent: rowDescent };
}

getContentBaseline(): number | null {
    const local = this.getContentBaselineMetrics();

    if (local === null) {
        return null;
    }

    return this.resolveRowLine(local).ascent;
}

/**
 * The line this row lays out against: the one the parent imposed, or this row's
 * own fold when none was imposed (this row is the root of its baseline chain).
 * A row with no baseline-bearing content is not part of any line and keeps its
 * local (null) fold regardless of what was imposed.
 */
private resolveRowLine(local: BaselineMetrics): BaselineMetrics {
    return this.getImposedBaselineLine() ?? local;
}
```

The reordering inside `layoutPreferredMode` / `layoutEqualMode` / `getPreferredSize` / `getMinSize` is the same four beats everywhere:

```
1. metrics = components.map(c => c.getBaselineMetrics())     // line-independent
2. line    = imposed ?? fold(metrics)                        // null when no metric is non-null
3. imposeRowLine(components, line)                           // BEFORE step 4
4. sizes/heights/baselines = components.map(...)             // now line-aware
5. place with rowChildY(top, h, b, line.ascent, line.descent)
```

Today's code runs 4 before 2. **That inversion is the bug.**

---

## Ordered Implementation Steps

Each step is a self-contained edit with a cheap check. Do not start until `statusbar-baseline-alignment` is in `plans/implemented/` — step 1 of that plan is what makes any of this testable.

1. **Create `src/typescript/lib/primitive/Baseline.ts`** with the `BaselineMetrics` interface from *Public API*. Copy the SPDX header and `@category Util` tag style from [`primitive/Size.ts:1-11`](src/typescript/lib/primitive/Size.ts#L1). Export it from [`primitive/index.ts`](src/typescript/lib/primitive/index.ts) with `export type { BaselineMetrics } from '~/primitive/Baseline.js';`, placed beside the existing `Size` export.

   Checkpoint: `npx tsc --noEmit` — clean.

2. **Add `getBaselineMetrics`, `imposeBaselineLine`, `unwrapOuterLine` to `Component`** (`src/typescript/lib/core/Component.ts`), per *Internal Structure*, immediately after `wrapInnerBaseline` (ends at [:2720](src/typescript/lib/core/Component.ts#L2720)) so the wrap/unwrap pair reads together. Do **not** touch `getBaseline()` at [:2687](src/typescript/lib/core/Component.ts#L2687).

   Checkpoint: `grep -rn 'getBaseline(): number | null' src/typescript/lib/ | wc -l` — unchanged at **18**.

3. **Add the `LayoutManager` half** (`src/typescript/lib/layout/LayoutManager.ts`): the `_imposedBaselineLine` field beside `_overflowing` ([:41](src/typescript/lib/layout/LayoutManager.ts#L41)), and `getContentBaselineMetrics` / `setImposedBaselineLine` / `getImposedBaselineLine` / `imposeRowLine` beside `getContentBaseline` ([:614](src/typescript/lib/layout/LayoutManager.ts#L614)). Widen `computeRowHeight` ([:571](src/typescript/lib/layout/LayoutManager.ts#L571)) with the optional third `line` parameter; its body is otherwise byte-identical.

   Carry the "no `doLayout()`" comment verbatim — it is the one thing that turns a re-entrant infinite loop into a correct pass.

   Checkpoint: `npx vitest run tests/component/layout/` — all pass. Nothing calls the new methods yet, so this step must be inert.

4. **`HBox.getContentBaselineMetrics` + `getContentBaseline` + `resolveRowLine`** (`src/typescript/lib/layout/HBox.ts`), per *Internal Structure*. `getContentBaselineMetrics` is the old `getContentBaseline` body ([:45-65](src/typescript/lib/layout/HBox.ts#L45)) returning both halves of `computeRowMetrics` instead of dropping `rowDescent`; the stretching guard moves into it unchanged. `getContentBaseline` becomes the four-line effective-ascent shim.

   Rewrite `getContentBaseline`'s JSDoc: it now returns the **effective** ascent (the imposed line's, or the local fold's), and the sentence about aligning "by the same baseline its own children align to" still holds — it is just now the *row's* baseline when a parent resolved one. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) *"Don't `{@link}` internal symbols from public JSDoc"*, describe `resolveRowLine` / `computeRowMetrics` in prose; do not link them.

5. **Rewire `HBox.layoutPreferredMode`** ([:420-535](src/typescript/lib/layout/HBox.ts#L420)) to the four beats. Concretely: before the existing `for (const component of components)` loop at [:434](src/typescript/lib/layout/HBox.ts#L434), collect `metrics`, fold them into a local line, resolve against the imposed one, and call `imposeRowLine`. Then leave the existing loop as-is — its `getPreferredSize()` / `getBaseline()` calls at [:436](src/typescript/lib/layout/HBox.ts#L436) and [:468](src/typescript/lib/layout/HBox.ts#L468) now return line-aware values for free.

   Replace the `rowAscent`/`rowDescent` ternary at [:476-478](src/typescript/lib/layout/HBox.ts#L476) with the resolved line (still `{ rowAscent: null, rowDescent: 0 }` while stretching — see *Architecture Decisions*). `rowChildY` ([:647](src/typescript/lib/layout/HBox.ts#L647)) is unchanged.

   When stretching, skip the metrics collection and the `imposeRowLine` call entirely — a stretched row neither resolves nor imposes.

6. **Rewire `HBox.layoutEqualMode`** ([:309-360](src/typescript/lib/layout/HBox.ts#L309)) identically. The stretch branch returns early at [:322](src/typescript/lib/layout/HBox.ts#L322) already, so only the non-stretch tail below it changes: fold + resolve + `imposeRowLine` before the loop at [:328](src/typescript/lib/layout/HBox.ts#L328), then use the resolved line at [:335](src/typescript/lib/layout/HBox.ts#L335).

7. **Rewire `HBox.getPreferredSize` and `getMinSize`** ([:75-126](src/typescript/lib/layout/HBox.ts#L75), [:137-188](src/typescript/lib/layout/HBox.ts#L137)). Same four beats, then pass the resolved line as `computeRowHeight`'s third argument at [:118](src/typescript/lib/layout/HBox.ts#L118) and [:180](src/typescript/lib/layout/HBox.ts#L180). This is why the impose is not confined to `doLayout`: an ancestor measuring the tree (a scroll host, `getMinSize`) must see line-aware child heights too.

   Both methods gain a side effect (imposing lines on children). Document it in their JSDoc in one sentence — it is intentional, idempotent, and the alternative (a parallel `getPreferredHeightInLine(line)` sizing API) doubles the sizing surface.

   Checkpoint: `npx vitest run` — the whole suite. Expect failures **only** in `tests/component/layout/HBox.test.ts` / `Grid.test.ts` / `HFlow.test.ts` assertions that pin a *nested* container's height (the box now spans the line box — see *Architecture Decisions*). Update those to the new expected geometry; a failure anywhere else means the wiring diverged.

8. **`Grid`: impose per row** (`src/typescript/lib/layout/Grid.ts`). Two sites, both already computing the row's metrics:
   - [`:742-745`](src/typescript/lib/layout/Grid.ts#L742) in `doLayout` — after `computeRowMetrics`, call `this.imposeRowLine(rowCells.map(cell => cell.component), rowAscent === null ? null : { ascent: rowAscent, descent: rowDescent })`, then re-read each cell's `height`/`baseline` before placing (a cell that is a nested `HBox` reports different values once the line lands).
   - [`:921-926`](src/typescript/lib/layout/Grid.ts#L921) in `measureContent` — same impose, so the measured row size matches what `doLayout` places.

   Grid is **not** the hard case it looks like. It never overrides `getContentBaseline`, so it reports a `null` baseline upward and is therefore always the **root** of its baseline chain — it never receives a line it must reconcile against several rows. Each row is an independent line box, resolved locally, imposed locally. The two-dimensional case adds nothing to the protocol. Guard both sites on `this._baselineAlign`, matching [:903](src/typescript/lib/layout/Grid.ts#L903).

9. **`HFlow`: impose per line** (`src/typescript/lib/layout/HFlow.ts`), in `placeRows` after `computeRowMetrics` at [:330](src/typescript/lib/layout/HFlow.ts#L330), guarded on `this._itemAlign === "baseline"`. Same reasoning as `Grid`: `HFlow` reports a `null` content baseline (documented at [docs/layouts/HFlow.md:177](docs/layouts/HFlow.md#L177)), so each wrapped line is its own root.

   **`FlowLayout.ts` needs no change.** Its `crossOffset` ([:411-431](src/typescript/lib/layout/FlowLayout.ts#L411)) only *consumes* the `rowAscent`/`rowDescent` its caller passes; `VFlow` has no baselines at all.

   Checkpoint: `grep -c 'computeRowMetrics' src/typescript/lib/layout/*.ts` and `grep -c 'imposeRowLine' src/typescript/lib/layout/*.ts` — every `computeRowMetrics` call site that drives placement (HBox ×2, Grid ×2, HFlow ×1) has a matching `imposeRowLine`. `HBox.getContentBaselineMetrics`'s call is the one deliberate exception: it is the line-independent up-report and must **not** impose.

10. **Add the tests** from *Expected Behaviour* to a new `tests/component/layout/HBox.baseline.test.ts`. Follow the offline idiom exactly: the `CONFIG` shape from [tests/dom/baseline.test.ts:8-19](tests/dom/baseline.test.ts#L8) (the font vars are required — the existing `HBox.test.ts` installs no DOM at all), `installTestDOM(CONFIG)` + `afterEach(() => { DOM.reset(); Util.invalidateTextMetricsCache(); })`, and the layout-driving idiom from `tests/component/display/ProgressBar.test.ts:135-147` (`getElement(true)`, `setWidth`/`setHeight`, `doLayout()`, assert on children).

11. **Update the docs** per *Documentation Impact*.

12. **Run the checkpoints** in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/primitive/Baseline.ts` |
| Modify | `src/typescript/lib/primitive/index.ts` |
| Modify | `src/typescript/lib/core/Component.ts` |
| Modify | `src/typescript/lib/layout/LayoutManager.ts` |
| Modify | `src/typescript/lib/layout/HBox.ts` |
| Modify | `src/typescript/lib/layout/Grid.ts` |
| Modify | `src/typescript/lib/layout/HFlow.ts` |
| Create | `tests/component/layout/HBox.baseline.test.ts` |
| Modify | `tests/component/layout/HBox.test.ts` (only if an existing assertion pins a nested container's height) |
| Modify | `tests/component/layout/Grid.test.ts` (same) |
| Modify | `tests/component/layout/HFlow.test.ts` (same) |
| Modify | `docs/layouts/HBox.md` |
| Modify | `docs/concepts/sizing.md` |

---

## Expected Behaviour

### Unit-testable

Layout maths is pure and runs offline once `statusbar-baseline-alignment` step 1 lands: `installTestDOM` swaps in a modelled source answering every metric from `tests/dom/font-metrics.test-font.json`, with no browser and no jsdom ([tests/dom/baseline.test.ts:1-2](tests/dom/baseline.test.ts#L1)). **Every number below is derived by hand from the measured leaf table in *Measured Inputs*.** Write them as tests before touching the source.

1. **`getBaselineMetrics()` derives from `getBaseline()` for a leaf.** `new Text('Hello')` reports `{ ascent: 13, descent: 3 }` (33×16, baseline 13). With `centerInHeight(21)`: `{ ascent: 16, descent: 5 }`. A `Button({glyph, flat, compact})` with `pinGlyphSize(14)` reports `null`. Pins the default derivation and the null passthrough.

2. **THE CANONICAL CASE — three sibling `HBox`es share one baseline with no clipping.** An outer `HBox` (non-stretching) holding three `Component`s, each with a non-stretching `HBox` layout:
   - **A** — `Text('Hello')` plain.
   - **B** — `Text('Hello')` + `centerInHeight(21)` (the deep anchor).
   - **C** — `Glyph` + `Button({glyph, flat, compact})` with `pinGlyphSize(14)` (the null-baseline child).

   Set the outer to `setWidth(400)`, `doLayout()`. Assert:
   - The outer row's `getPreferredSize().height === 21` — the resolved line `ascent 16 + descent 5`. **Fails at 23 today** (C reports height 20 / baseline 13, so the outer infers descent 7).
   - A, B and C each report `getBaseline() === 16` and `getPreferredSize().height === 21`, and each is placed at `y === 0`.
   - The absolute baseline of A's `Text`, B's `Text` and C's `Glyph` — `child.getY() + parent.getY() + child.getBaseline()` — is **16 for all three**.
   - C's `Button` spans `y = 0.5 .. 20.5` (`nullChildY(20, 16, 5) = max(0, (21−20)/2)`), so **every** child of every zone satisfies `y + height <= 21`. Assert by iteration, not hard-coded rows.

   Today: C resolves a local 16px line, centres the button at `y = 0`, reports height 20 / baseline 13, is placed at `y = 3`, and the button lands at `3..23` in a 21px row — misaligned by 3 and clipping 2. This single test is the reason the plan exists.

3. **`getContentBaselineMetrics()` is line-independent; `getContentBaseline()` is not.** For zone C above: before any layout, `getContentBaselineMetrics()` is `{ ascent: 13, descent: 3 }` (the `Glyph`'s; the `Button` contributes nothing). After `imposeBaselineLine({ ascent: 16, descent: 5 })`, `getContentBaselineMetrics()` is **still** `{ ascent: 13, descent: 3 }` while `getContentBaseline()` is now **16**. The exact distinction the resolve depends on.

4. **A null-baseline child contributes nothing to the line.** Add a second `Button({glyph, flat, compact})` with `pinGlyphSize(14)` to zone B. B's `getContentBaselineMetrics()` stays `{ ascent: 16, descent: 5 }`; the outer line stays 21 and every baseline stays at 16.

5. **A row with no baseline-bearing child is never given a line.** An outer `HBox` holding a `Text('Hello')` and a zone containing only two pinned glyph `Button`s: the zone's `getBaselineMetrics()` is `null`, so it is centred as a null child (`nullChildY(20, 13, 3) = 0`) and `getImposedBaselineLine()` on its manager is `null` after `doLayout()`.

6. **Chrome is unwrapped out of the imposed line.** Give zone C `new Insets(2, 0, 1, 0)`. Its manager's imposed line becomes `{ ascent: 14, descent: 4 }` (`16 − 2`, `5 − 1`), its `getBaseline()` stays **16** (`wrapInnerBaseline(14)`), its outer height stays **21**, and it is still placed at `y === 0`. Without the unwrap it would hang 2px above the row top.

7. **Stretching disables the protocol entirely.** With the outer `HBox` at `setStretching(true)`: every zone's `getContentBaselineMetrics()` is `null`, no line is imposed (each zone's `getImposedBaselineLine()` is `null` after `doLayout()`), and every zone is top-aligned and filled to the row height. Byte-identical to today — the direct regression guard for the "stretching stays out" decision.

8. **A `Grid` row resolves and imposes its own line.** A `Grid({ rows: 1, columns: 2, baselineAlign: true })` whose cells are zones B and C from case 2: both report `getBaseline() === 16`, the row's height is 21, and C's `Button` lands at `0.5 .. 20.5`. Proves the per-row case needs nothing beyond the shared helper.

9. **`Grid` is always a baseline-chain root.** A `Grid({ baselineAlign: true })` nested in an `HBox` row still reports `getBaseline() === null` (its layout does not override `getContentBaseline`), so the `HBox` centres it as a null child and never imposes a line on it. Pins the conclusion that Grid's two-dimensional case does not complicate the protocol.

10. **`HFlow({ itemAlign: 'baseline' })` imposes per wrapped line.** Two zones on one wrapped line align at 16 with the line resolved from both, exactly as case 2.

11. **`VBox` is unchanged.** A `VBox` whose first child is a `Text('Hello')` + `centerInHeight(21)` still reports `getContentBaseline() === 16` and `getContentBaselineMetrics()` derives descent from its **full column height minus 16**, not from a fold. Guards that `VBox` was left alone (see *Non-Goals*).

12. **Nothing regresses on a flat row.** Every existing test in `tests/component/layout/HBox.test.ts`, `Grid.test.ts`, `HFlow.test.ts`, `VBox.test.ts`, `FlowLayout.test.ts` and `VFlow.test.ts` passes — except assertions that pin a *nested* baseline-aligned container's height, which legitimately change (see behaviour 2: zone C is now 21 tall, not 20). Any other failure is a bug in the wiring.

### Manual visual verification

The harness models metrics but not font rasterisation, and it cannot see paint:

- **The box-growth change** (see *Architecture Decisions*): `npm run dev`, then sweep the demo for a nested baseline-aligned container carrying a **background or border** inside a non-stretching `HBox` row — its box now paints over the full line height rather than hugging its text. Confirm nothing looks wrong; the content must not move, only the box.
- **`StatusBar`:** open the *Misc* panel's table window ([src/typescript/MiscPanel.ts:518](src/typescript/MiscPanel.ts#L518)). The bar is flat after `statusbar-baseline-alignment`, so this is a pure no-regression check — the message stays centred and unclipped.
- **`MenuItem`, `PaginationBar`, `VideoPlayer`:** all use `centerInHeight` against a non-stretching row and are the idiom this plan preserves. Confirm each still aligns; a shift here means the strut decision broke.
- **Theme sweep:** light / dark / classic. The line resolves through `--ts-ui-line-padding`, so a difference between themes indicates a token regression, not a layout one.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — the **whole** suite. `computeRowHeight`'s widened signature is shared by `HBox`, `Grid` and `HFlow`, and `Component.getBaselineMetrics` is on every component, so a stray edit surfaces far from `tests/component/layout/`.
- `grep -rn 'getBaseline(): number | null' src/typescript/lib/ | wc -l` — **18**, unchanged. Zero of the existing overrides may be touched.
- `grep -rn 'centerInHeight' src/typescript/lib/` — unchanged at `MenuItem.ts` (×4), `PaginationBar.ts`, `VideoPlayer.ts`, `Dialog.ts`, `StatusBar.ts`, plus the definition and example in `Text.ts`. This plan deletes **no** call site — see the strut decision.
- `grep -rn 'crossPlacement\|crossAnchorEdge' src/typescript/lib/layout/BoxLayout.ts` — unchanged. Cross-axis `CENTER` stays inert.
- `grep -n 'isStretching' src/typescript/lib/layout/HBox.ts` — still guards `getContentBaselineMetrics`, `layoutEqualMode`, and the `rowAscent` ternary in `layoutPreferredMode`.
- `grep -rn 'setImposedBaselineLine' src/typescript/lib/` — no call site outside `Component.imposeBaselineLine`; the manager-level setter is never reached directly from another manager.
- `grep -rn 'doLayout' src/typescript/lib/layout/LayoutManager.ts` — `setImposedBaselineLine` must **not** appear near one.
- `npm run docs:build` — zero warnings (repo rule for touched public JSDoc).
- `npm run build:lib` before any sqladmin check — **never** `npm run build`.
- Manual checks per *Expected Behaviour → Manual visual verification*.

---

## Documentation Impact

`BaselineMetrics` is a new **exported** type, so it renders a TypeDoc page. It is exported from `src/typescript/lib/primitive/index.ts` → the `@jimka/typescript-ui/primitive` entry point (`package.json` `"./primitive"`), landing at `/api/primitive/interfaces/BaselineMetrics`. `Component.getBaselineMetrics` / `imposeBaselineLine` and `LayoutManager.getContentBaselineMetrics` / `setImposedBaselineLine` are public and render on their existing class pages. No sidebar or catalog entry is needed — `docs/.vitepress/config.mts` lists pages, and the `/api/**` tree is generated.

Two prose pages **already describe behaviour the code does not have**, and this plan replaces that behaviour, so both must be rewritten rather than patched:

- **[docs/layouts/HBox.md:153](docs/layouts/HBox.md#L153)** claims `HBox` "augments [the baseline] with half the tallest null-baseline child" and that "the row's preferred height grows to `ascent + descent` where `ascent` and `descent` each take the larger of the text-baseline contribution and the null-child half-height." Neither is true today (`nullChildY` clamps at 0 and `computeRowHeight` grows the *row*, never the ascent) and neither is true after. Replace with the two-phase model: children report `{ascent, descent}` from baseline-bearing content only; the outermost baseline-aware row resolves the line as `max(ascent)` / `max(descent)`; that line propagates down so a nested row centres its null-baseline children against the **real** line rather than a local guess; the row's height is `ascent + descent`, grown only to fit a null child that exceeds it. Keep the CSS `vertical-align` analogy at [:146](docs/layouts/HBox.md#L146) and [:151](docs/layouts/HBox.md#L151) — two-phase makes it *more* accurate, not less. Line [:155](docs/layouts/HBox.md#L155) (stretching skips baseline alignment) stays true verbatim.
- **[docs/concepts/sizing.md:102](docs/concepts/sizing.md#L102)** repeats the same wrong "each side accommodates … half the tallest null-baseline child" claim. Rewrite to match, and add one sentence at [:98](docs/concepts/sizing.md#L98) introducing `getBaselineMetrics()` as the richer report `getBaseline()` is now derived from, with `getBaseline()` still the override point for components.
- **[docs/layouts/Grid.md:109](docs/layouts/Grid.md#L109)** says `baselineAlign` uses "the same alignment rules as HBox" and links `/layouts/HBox#baseline-alignment`. Still true and still the right cross-reference — **no change**, it inherits the rewrite above.
- **[docs/layouts/HFlow.md:177](docs/layouts/HFlow.md#L177)** documents HFlow's `null` content baseline. Still true and now load-bearing (it is why each HFlow line is a baseline-chain root) — **no change**.

`llms.txt` needs no entry: no new component or capability a consumer composes with, only a protocol under existing layouts.

---

## Potential Challenges

- **The impose must precede the read.** `imposeRowLine` has to run before the loop that calls `getPreferredSize()` / `getBaseline()` on the children, because a nested container's answers to both are line-dependent. Today's code reads first. Getting this order wrong produces no error — just today's geometry — so behaviour 2's `height === 21` assertion is the tripwire.
- **`getPreferredSize` / `getMinSize` gain a side effect.** They impose lines on children. This is deliberate (an ancestor measuring the tree must see line-aware heights), idempotent, and documented in their JSDoc; the alternative is a parallel `getPreferredHeightInLine(line)` sizing surface, which doubles the sizing API for the same result.
- **A stale imposed line reports a stale height.** The line is re-imposed on every measure and every layout by the owning row, and cleared to `null` on any child whose metrics are `null`, so a detached or re-parented child falls back to a local resolve — today's behaviour, which is a graceful degradation rather than a wrong answer. Do not try to clear it from `Component.removeComponent`; the next pass overwrites it.
- **`setImposedBaselineLine` must not trigger a layout.** `setOverflowing` ([LayoutManager.ts:185-193](src/typescript/lib/layout/LayoutManager.ts#L185)) is its structural twin and *does* call `doLayout()`. Copying that line here is an infinite recursion, because this setter is called from inside a layout pass.
- **A nested container's box grows to the line box.** Real and visible when the container has a background or border. Accepted and argued in *Architecture Decisions*; the manual sweep is the check, and behaviour 2 pins the new geometry (zone C: 21 tall, not 20).
- **A stock `flat`+`compact` glyph-only `Button` is 22×22 with a hard 22×22 minimum** and clips in any band under 22 — pre-existing, documented by `statusbar-baseline-alignment`, and **not** fixed here. It interacts with this protocol only as an illustration of the rule "a null-baseline child larger than the line box clamps to the line top and overflows below" (`nullChildY`'s existing documented contract). Use `pinGlyphSize(14)` in every test so the 1px clip does not mask a real assertion failure.
- **`Grid.measureContent` and `Grid.doLayout` must impose identically**, or the measured row size and the placed row diverge and the content overflows the box the parent sized from it — the exact failure [Grid.ts:913-918](src/typescript/lib/layout/Grid.ts#L913)'s comment already warns about.

---

## Critical Files

- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts) — `nullChildY` (522), `computeRowMetrics` (538), `computeRowHeight` (571), `getContentBaseline` (614), `_overflowing`/`setOverflowing` (41, 185) as the precedent for the imposed line, `commitBounds` (453) as the top-down recursion the impose rides.
- [src/typescript/lib/layout/HBox.ts](src/typescript/lib/layout/HBox.ts) — `getContentBaseline` (45), `getPreferredSize` (75), `getMinSize` (137), `layoutEqualMode` (309), `layoutPreferredMode` (420), the stretching ternary (476), `rowChildY` (647).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `getBaseline` (2687) and `wrapInnerBaseline` (2708), whose inverse `unwrapOuterLine` is; `getPerimeterSize` (2635); `doLayout` (4675), `scheduleLayout` (4768), `flushLayout` (4834), `pauseLayout`/`resumeLayout` (4631/4642) — the lifecycle this protocol must not add a pass to.
- [src/typescript/lib/layout/BoxLayout.ts](src/typescript/lib/layout/BoxLayout.ts) — `_stretching` (111), `crossPlacement` (447) and its doc (430-434), `crossAnchorEdge` (485). Read to understand why cross-axis `CENTER` stays inert; do not edit.
- [src/typescript/lib/layout/Grid.ts](src/typescript/lib/layout/Grid.ts) — `doLayout`'s per-row metrics (742), `measureContent`'s (921), the `_baselineAlign` guards (684, 903).
- [src/typescript/lib/layout/VBox.ts:36-68](src/typescript/lib/layout/VBox.ts#L36) — `getContentBaseline` forwards the **first** child's baseline verbatim. Read to confirm VBox's descent genuinely is `height − baseline`, so it needs no override; do not edit.
- [src/typescript/lib/layout/FlowLayout.ts:411-431](src/typescript/lib/layout/FlowLayout.ts#L411) — `crossOffset` consumes the line its caller resolves; confirms `FlowLayout` needs no change.
- [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) — `getBaseline` (441), `centerInHeight` (1041): the library's strut, and the only place font ascent/descent exist.
- [plans/statusbar-baseline-alignment.md](plans/statusbar-baseline-alignment.md) — the measured data, and the hard dependency (its step 1 fixes the harness).
- [tests/dom/baseline.test.ts:1-19](tests/dom/baseline.test.ts#L1) and [tests/component/display/ProgressBar.test.ts:129-157](tests/component/display/ProgressBar.test.ts#L129) — the offline `CONFIG` and layout-driving idioms.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *"Size constraints: who is responsible for what"* (rule 3: a manager that misreports its sizes is a bug fixed **at the manager** — this plan is that fix) and *"No cosmetic insets or padding"* (trace a misplacement to its layout cause: here, a missing downward pass).

---

## Non-Goals

- **`VBox` does not consume or forward the imposed line.** A `VBox` is a line-box terminator: its first child carries the baseline, the rest is block content below it, and its descent genuinely *is* `height − baseline`. Forwarding the line to its first child would be CSS-correct but no measured defect demands it. **Named gap:** `HBox → VBox → HBox(with a null-baseline child)` still misaligns. A follow-on plan — *vbox-baseline-line-forwarding* — would forward the line to the first row only, and should be written when a real component hits it.
- **Cross-axis `CENTER` stays inert.** Argued in *Architecture Decisions*: its inertness is a placement **policy**, not a geometry gap, and two-phase produces no evidence about it. Enabling it touches every `HBox` and `VBox`.
- **No `HBox({ lineHeight })` strut option.** A manager has no font, so it cannot split a bare pixel value into `{ascent, descent}`. `Text.centerInHeight` is and stays the strut.
- **No per-pass metrics cache.** The added cost is one memoized virtual call per child along the baseline chain. Optimising before a profile says so is speculative.
- **No changes to any `getBaseline()` override.** All 18 are correct; the whole point of the additive shape is that they never move.
- **The 22×22 glyph-only `Button` is not fixed here.** Pre-existing, owned and documented by `statusbar-baseline-alignment`, and orthogonal to the protocol.
- **No `StatusBar` change, and no revert of its flattening.** Argued in *Architecture Decisions*: two-phase makes the flattening a simplification rather than a necessity, which is a better reason to keep it, not a reason to undo it. Do not re-nest the zones to exercise this capability — `tests/component/layout/HBox.baseline.test.ts` is where the three-sibling case lives.
- **No sqladmin change.**
