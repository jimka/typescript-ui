# Split Pane Seed-from-Preferred + Live Min/Max Constraint — Implementation Plan

## Overview

Change `Split`'s *initial* per-pane sizing from equal division to a **preferred-based seed** (the [`HBox`](src/typescript/lib/layout/HBox.ts) / [`VBox`](src/typescript/lib/layout/VBox.ts) model: each pane starts at its preferred main extent, clamped to its min/max, with leftover slack distributed by `weight`), and make a pane's **min/max a live, hard constraint** that `Split` re-clamps to whenever it changes. Preferred is consulted **once** — a later `setPreferredSize` on a seeded pane does not move it. There is no `sizeToPreferred` opt-in, no preferred-tracking-every-layout, and no drag-write-back-to-preferred; those were the earlier draft's model and are discarded.

Two things do not exist today and are the core of this plan. **(a) Min/max-change reactivity** — [`Component.setMinSize`](src/typescript/lib/core/Component.ts#L2338) / [`setMaxSize`](src/typescript/lib/core/Component.ts#L2411) only write CSS + data attributes; unlike [`setPreferredSize`](src/typescript/lib/core/Component.ts#L2251) they never notify the parent, so a Split never relayouts when a pane's constraint changes. A new `_onConstraintSizeChange` hook (parallel to [`_onPreferredSizeChange`](src/typescript/lib/core/Component.ts#L256), bound in [`addComponent`](src/typescript/lib/core/Component.ts#L4160) / [`insertComponent`](src/typescript/lib/core/Component.ts#L4213) to the parent's `scheduleLayout`, cleared in [`removeComponent`](src/typescript/lib/core/Component.ts#L4321) / [`removeAllComponents`](src/typescript/lib/core/Component.ts#L4337)) fixes this. **(b) Max-clamping in Split** — Split's drag clamps to min only ([`Split.ts:644`](src/typescript/lib/layout/Split.ts#L644)); seeding, resize redistribution, and refill clamp to neither. Split's layout gains a `[min,max]` clamp on each pane's assigned main size at seed and at drag, closing the standing size-constraint-invariant violation (Split is the one manager that still never enforces max).

The mechanism lives in [`layout/Split.ts`](src/typescript/lib/layout/Split.ts) (seeding + clamp) and [`core/Component.ts`](src/typescript/lib/core/Component.ts) (the constraint-change hook). No new public field on `Split` or `SplitOptions`: the surface is the *existing* `preferred` + `weight` + `min`/`max` on `Component` / `LayoutConstraints`, now honoured by Split. The downstream sqladmin `ActivityBar` (a `[sidebar, dock]` horizontal Split that pins via `min = max = RAIL_WIDTH` on collapse and re-opens a `min < max` range on expand) needs exactly these three primitives — two new (seed, min/max clamp+reactivity), one existing ([`setPaneSize`](src/typescript/lib/layout/Split.ts#L291)). Its adoption is a Non-Goal.

---

## Architecture Decisions

### Seed each pane from its preferred main extent, clamped to `[min, max]`, once — the HBox model

On a pane's **first** layout (no `_sizes` entry yet), `Split` seeds its stored main size to `clamp(preferredMain, minMain, maxMain)` instead of an equal share. This mirrors [`HBox.resolveChildWidth`](src/typescript/lib/layout/HBox.ts#L613) / [`VBox.resolveChildHeight`](src/typescript/lib/layout/VBox.ts#L551): read the child's preferred main extent, floor to min, cap to max. A pane whose `getPreferredSize()` is `null` has no preferred to seed from and **falls through to the current equal-division seeding** unchanged (the degradation rule — see *Backward compatibility*).

Because the seed only fires for a pane with no stored size, it is a genuine one-time event: once `_sizes` holds a value, the seeding pass skips the pane, so a later `setPreferredSize` never re-seeds it. This is what makes "preferred is a one-time hint" true without any tracking flag or write-back — the mechanism that killed the old draft's snap-back fights.

### Leftover slack after seeding is distributed by `weight` — HBox-inspired (base + weighted slack), with a size-proportional fallback

After every pane is seeded (or equal-division-defaulted), the pane sizes need not sum to `available`; HBox handles the leftover by giving it to weight cells. Split does the **same in spirit** but not with the same formula, and the implementer must not copy `resolveChildWidth` literally: HBox gives a weight cell `(w/Σw)·remaining` as its **entire** width (it has no pre-existing base to keep), whereas a seeded Split pane already holds a base (its clamped preferred) and receives `seed + (w/Σw)·slack` on top. The distinction matters — copying the HBox cell formula verbatim would discard the seed. The exact rule:

- **Seed pass** writes `clamp(preferred, min, max)` into `_sizes` for first-layout panes with a preferred; equal-division for the rest (existing code).
- **First-layout slack distribution** then reconciles `Σ _sizes` to `available`. When one or more panes carry a **positive `weight`**, the slack `(available − Σseed)` is distributed among the positively-weighted panes in proportion to weight, each result re-clamped via `clampMain` — `size = seed + (weight/Σweight)·slack` (base + weighted slack, HBox-*inspired*). When **no pane carries a positive weight** ("no positive weights anywhere" fallback), the existing uniform `available/Σstored` refill runs, preserving today's proportional behaviour. This keeps a plain preferred-seeded Split filling the container exactly as an equal-seeded one does when the preferreds are equal and no weight is set.

This first-layout pass is mutually exclusive with the existing resize-redistribution block (see *Sequence the layout pipeline* below): the slack pass runs only on first layout (`_lastAvailableMain === 0`), the resize block only on subsequent layouts (`_lastAvailableMain > 0`).

This makes the seed and the resize-redistribution mutually consistent: the seed decides *starting* px; weight decides how *slack and later deltas* are shared — the same division of labour HBox uses (preferred sets the base, weight shares the extra).

### Preferred changes after the seed are ignored; the resize-weight *behaviour* is left fully intact

**This is the reconciliation with the just-merged resize-weight feature, and the precedence is: the merged resize semantics win, unchanged.** The seed is a *first-layout* concern only. Once a pane has a stored `_sizes` value:

- A later `setPreferredSize` fires `_onPreferredSizeChange → scheduleLayout` (existing wiring), which reruns `recalculateSizes` — but the seeding pass skips the now-sized pane, so the relayout is a no-op with respect to that pane's size. Preferred is ignored, as specified.
- A viewport resize runs the **unchanged** weighted-redistribution block ([`Split.ts:1170`](src/typescript/lib/layout/Split.ts#L1170)): [`effectiveResizeWeight`](src/typescript/lib/layout/Split.ts#L362) resolves `setPaneResizeWeight` entry, else the `weight` constraint, else the pane's current stored size (proportional rescale). **No `sizeToPreferred`/tracking neutrality branch is added** — the old draft forced tracked panes to weight 0 here; this plan does not touch `effectiveResizeWeight` at all. Existing consumers are therefore unaffected on resize: the sidebar's explicit `weight: 0` still pins it on viewport resize exactly as today; an unset-weight pane still rescales proportionally.

So the three merged rules are preserved verbatim: **unset weight ⇒ proportional rescale (fallback to stored size); weight 0 ⇒ pinned on viewport resize; all-zero-weights ⇒ uniform refill.** The seed changes only the *first* stored value; every subsequent behaviour is the resize feature's, untouched.

### Min/max is the hard, live constraint — a new `_onConstraintSizeChange` hook plus a Split clamp

Per ARCHITECTURE *Size constraints* rules 1/5/6, a layout manager must never size a component outside `[min, max]`. Split violates this today (its drag clamps min-only; seed/redistribute/refill clamp neither). Two changes:

1. **Reactivity.** `Component` gains a private `_onConstraintSizeChange: (() => void) | null`, fired by **both** `setMinSize` and `setMaxSize` after they write (guarded by the existing no-change early-returns so an identical set is silent). `addComponent`/`insertComponent` bind it to `this.scheduleLayout()` (and re-propagate to the grandparent via the same `_onConstraintSizeChange?.()` chain the preferred hook uses), and `removeComponent`/`removeAllComponents` null it — a mechanical parallel to `_onPreferredSizeChange`. This is the only way a `min = max = RAIL_WIDTH` collapse can trigger a Split relayout; without it the constraint would sit in CSS but the pane would keep its old assigned px until an unrelated layout.

2. **Clamp.** Split clamps each pane's assigned main size to `[min, max]` at the two write sites that set a pane's committed size: the **seed** (already `clamp` per the HBox model above) and the **drag** ([`onDrag`](src/typescript/lib/layout/Split.ts#L628), whose current `Math.max(minLhs, Math.min(total − minRhs, newLhs))` gains a max cap per pane). The resize-redistribution and refill operate on already-clamped stored values and rescale to fill the container; a hard per-pane max there could break the `Σ == available` fill invariant when a maxed pane cannot absorb its share, so the enforced clamp is applied where a pane's size is *chosen* (seed, drag), and the constraint-change hook re-runs the seed-time clamp on the current stored value when min/max moves (see *Implementation*). This matches the framework's existing defence-in-depth: [`clampWidth`](src/typescript/lib/core/Component.ts#L2795) / [`clampHeight`](src/typescript/lib/core/Component.ts#L2858) already re-clamp the committed DOM size to the merged `[min,max]`, so even a redistribution overshoot is corrected at commit — the Split-level clamp keeps `_sizes` bookkeeping honest so the *next* layout starts from an in-range value.

**Constraint-change re-clamp.** When the hook fires, `recalculateSizes` re-clamps every pane's existing `_sizes` entry to its current `[min, max]` before the redistribution pass. A `min = max = W` collapse therefore snaps the stored size to `W`; the freed slack flows to the other panes via the existing refill. This is the piece that makes "min/max is the live constraint" real without a preferred write-back.

### Sequence the layout pipeline so the weight-slack pass never double-distributes

`recalculateSizes` ([`Split.ts:1113`](src/typescript/lib/layout/Split.ts#L1113)) has a strict internal order today, and the new passes must slot into it without perturbing the existing blocks. The current order is: prune `_sizes`/`_collapsed` ([`:1130`](src/typescript/lib/layout/Split.ts#L1130)) → prune `_weights` ([`:1143`](src/typescript/lib/layout/Split.ts#L1143)) → compute `available` ([`:1156`](src/typescript/lib/layout/Split.ts#L1156)) → **resize-redistribution** guarded `_lastAvailableMain > 0 && available > 0 && available !== _lastAvailableMain && _sizes.size > 0` ([`:1170`](src/typescript/lib/layout/Split.ts#L1170)) → equal-division / proportional-steal fallback for sizeless panes ([`:1202`](src/typescript/lib/layout/Split.ts#L1202)) → **uniform `Σ==available` refill** ([`:1248`](src/typescript/lib/layout/Split.ts#L1248)) → update `_lastAvailableMain` (only when `available > 0`) ([`:1265`](src/typescript/lib/layout/Split.ts#L1265)).

The new pipeline inserts the seed and re-clamp after the two prunes, and adds the first-layout weight-slack pass **as a sibling of, and mutually exclusive with, the existing resize-redistribution block**:

```
prune _sizes/_collapsed → prune _weights → compute available
→ seedFromPreferred            (first-layout panes with a preferred; else leave sizeless)
→ constraint re-clamp          (clampMain every already-stored size to current [min,max])
→ AT MOST ONE distribution block:
     • resize-redistribution        guard: _lastAvailableMain  >  0   (EXISTING, unmoved)
     • first-layout weight-slack     guard: _lastAvailableMain === 0 && positive weight exists  (NEW)
→ equal-division / proportional-steal fallback   (sizeless panes; EXISTING, unmoved)
→ uniform Σ==available refill      (trailing reconciler; ALWAYS runs; EXISTING, unmoved)
→ update _lastAvailableMain (available > 0)
```

The two *distribution* blocks (resize-redistribution and first-layout weight-slack) are mutually exclusive by construction: the resize block's own guard already excludes first layout (`_lastAvailableMain > 0`), so the new weight-slack pass — guarded on `_lastAvailableMain === 0` **and** the presence of a positive effective weight — can never co-fire with it. The uniform `Σ==available` refill is **not** an alternative to them; it is the existing *trailing reconciler* that always runs, scaling the post-distribution `_sizes` to sum exactly `available`. When the weight-slack pass ran it already targeted `available`, so the refill is a near-no-op; when neither distribution block fired (a first layout with no positive weight), the refill alone reconciles `Σ` — byte-identical to today's equal-seed path. Because `_lastAvailableMain` is only updated at the tail, the first-layout guard reads a clean `0`; the very first connected layout is thus the only one that can seed and weight-slack.

The insertion of the new weight-slack block relative to the current code: it goes immediately after the existing `if (this._lastAvailableMain > 0 && …)` block ([`Split.ts:1170`](src/typescript/lib/layout/Split.ts#L1170)) closes, before the sizeless-pane fallback ([`:1202`](src/typescript/lib/layout/Split.ts#L1202)); the seed + re-clamp go just after the `_weights` prune ([`:1147`](src/typescript/lib/layout/Split.ts#L1147)) and the `available` computation ([`:1156`](src/typescript/lib/layout/Split.ts#L1156)); the refill ([`:1248`](src/typescript/lib/layout/Split.ts#L1248)) and `_lastAvailableMain` update ([`:1265`](src/typescript/lib/layout/Split.ts#L1265)) are untouched.

**Corrected reasoning about first-layout equality.** The earlier draft claimed first-layout is "identical to the old equal seed." That is true **only for a no-positive-weight configuration.** For a config with a positive `weight`, first-layout is now *weight-influenced* — the slack is shared by weight on the very first pass, which is the correct HBox-like behaviour (base + weighted slack). The existing weight tests still pass not because first-layout is equal, but because they capture `a0`/`b0` **after** the first `doLayout` and assert every later delta **relative to that captured baseline** — a weight-skewed but self-consistent starting point is invisible to a delta assertion. So: first-layout is byte-identical to the old equal seed for no-positive-weight Splits, and weight-influenced (correctly) for positive-weight Splits.

### No new public API on Split; the opt-in is the existing size hints

There is deliberately **no** `Split`/`SplitOptions`/`LayoutConstraints` flag. A pane "opts into" preferred-seeding by simply *having* a preferred size (the common case for a content-sized Panel); it opts into pinning by setting `min = max`; it opts into slack absorption by setting `weight`. All three surfaces already exist. The only new symbol anywhere is the **private** `Component._onConstraintSizeChange` field + its binding — an internal mechanism, not consumer-facing, exactly like `_onPreferredSizeChange`. This satisfies ARCHITECTURE's "compose before specializing" and the plan's simplicity mandate: no speculative configurability.

### Backward compatibility — the degradation rule, the seed gate, and the real blast radius

The seed gate is [`getPreferredSizeConstraint()`](src/typescript/lib/core/Component.ts#L2171) — `return (this._options.preferredSize ?? this._defaultOptions.preferredSize) ?? null;`, the sibling of `getMinSizeConstraint`/`getMaxSizeConstraint` ([`:2273`](src/typescript/lib/core/Component.ts#L2273)/[`:2284`](src/typescript/lib/core/Component.ts#L2284)). Seeding off the *constraint* (not the layout-derived `getPreferredSize()`) is the single most important correctness choice: it keeps content-only panes out of the seed while letting an author-set size in.

**Decision: a class-default preferred DOES seed.** The gate resolves `_options.preferredSize ?? _defaultOptions.preferredSize`, so a component that ships a class-level `_defaultOptions.preferredSize` (e.g. `TextArea` = 200×200) seeds exactly as an explicit `setPreferredSize` does. This is intended, not an accident: a class that defaults a preferred is expressing an intended content size, and Split should honour it. The trade is a real, accepted behaviour change for any Split pane that is a bare instance of such a class. The degradation rule is therefore narrower than "explicit only": **a pane whose `getPreferredSizeConstraint()` is `null` — no explicit *and* no class-default preferred — falls through to the current equal-division seed.**

Backward-compat sweep — components that carry a class-default preferred and are used (or usable) as Split panes:

| Component | Class-default `preferredSize` | Effect as a bare Split pane |
|---|---|---|
| `TextArea` ([`TextArea.ts:31`](src/typescript/lib/component/input/TextArea.ts#L31)) | `{ 200, 200 }` | **Seeds** to `clamp(200, min, max)` |
| `FieldSet` ([`FieldSet.ts:35`](src/typescript/lib/component/container/FieldSet.ts#L35)) | `{ 200, 200 }` | **Seeds** to `clamp(200, min, max)` |
| `Glyph` (display) ([`Glyph.ts:171`](src/typescript/lib/component/display/Glyph.ts#L171)) | `{ 16, 16 }` | **Seeds** to `clamp(16, min, max)` |
| `Image` ([`Image.ts:29`](src/typescript/lib/component/display/Image.ts#L29)) | none in `_defaultImageOptions` (only via explicit option) | Degrades (unless author sets one) |
| `Button` ([`Button.ts`](src/typescript/lib/component/button/Button.ts)) | none — preferred is computed dynamically, no `_defaultOptions.preferredSize` | Degrades |
| `List`, `Slider`, `Text` | none | Degrade |

Actual `Split`/`SplitPanel` consumers in `src/typescript/`, enumerated:

- **`SplitPanel` demo** ([`src/typescript/SplitPanel.ts`](src/typescript/SplitPanel.ts)). Three nested Splits. `mainSplit` (vertical) holds `northComponent` and `southComponent` (bare `Component`, no default preferred → degrade). `northComponent` (Split) holds a `Button` and a `Text` (both no default preferred → degrade, equal). `southComponent` (Split) holds `list` (`List`, `weight: 0`, no preferred → pinned/degrade), a bare `new TextArea()` ([`SplitPanel.ts:55`](src/typescript/SplitPanel.ts#L55)), and a `Slider` (no preferred → degrade). **The `TextArea` pane now seeds to `clamp(200, minWidth, ∞)`** because `TextArea` defaults `preferredSize { 200, 200 }` ([`TextArea.ts:31`](src/typescript/lib/component/input/TextArea.ts#L31)). This is the one visible change across the whole demo set — an accepted, intended change; the demo is **not** byte-identical. All other demo panes carry no `getPreferredSizeConstraint()` and stay equal-division.
- **`MiscPanel` / `TabDemoPanel`** — no `new Split(...)` at the demo level; their splits are created inside `Dock`/`DockRegion` (see below). The `preferredSize`/`weight` literals in those files are dock-spec and table configs, not direct Split pane constraints, so they are unaffected by the seed gate.
- **`main.ts` / `ToolBarPanel`** — no direct Split use (`main.ts` only lazy-tabs `SplitPanel`; `ToolBarPanel` uses `SplitButton`, unrelated).

- **Dock / DockRegion — the load-bearing byte-identical invariant.** `Dock.compileLayout` and `DockRegion.splitOnEdge` build Splits of `Tab` stacks / `Container` regions ([`Dock.ts:578`](src/typescript/lib/overlay/Dock.ts#L578) — enclosing method `compileLayout`; [`DockRegion.ts:445`](src/typescript/lib/layout/DockRegion.ts#L445) — enclosing method `splitOnEdge`); leaves are added with `leafConstraints` ([`Dock.ts:449`](src/typescript/lib/overlay/Dock.ts#L449)), which sets only `closeable`/`glyph`/`tooltip` — no preferred. The pane types are `Container` (with a `Tab`/`Fit`/`Split` layout manager) — components that carry **no** `_defaultOptions.preferredSize`, so `getPreferredSizeConstraint()` returns `null` for every dock leaf and region. Dock therefore **stays byte-identical**: every dock pane degrades to equal division, exactly as today. (Tab/Container panes *do* report a non-null layout-derived `getPreferredSize()` from their content — but the seed reads `getPreferredSizeConstraint()`, not that, so the content width never leaks into the seed.) `getPaneRatios`/`applyPaneRatios` serialization ([`LayoutSerialization.ts:198`](src/typescript/lib/layout/LayoutSerialization.ts#L198)/[`:445`](src/typescript/lib/layout/LayoutSerialization.ts#L445)) operate on `_sizes` after seeding and are unaffected — a restored ratio still overwrites the seed via `applyPaneRatios`.
- **Existing Split tests** ([`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts)). `hostSplit` adds panes with an **explicit** `preferredSize: { width: 50, height: 50 }` ([`:28`](tests/component/layout/Split.test.ts#L28)), so the gate fires and both panes seed to 50 — equal. With no positive weight set at seed time (or equal weights), the seed stays 50/50 and the uniform refill rescales to `available/2` each, matching the old equal seed. The weight-influenced first-layout cases (`weights 1:3`) capture `a0`/`b0` after the *first* `doLayout` and assert deltas against that captured baseline, so they hold regardless of whether first-layout is equal (see *Sequence the layout pipeline* and *Expected Behaviour* cases 6, 6a). Verified case-by-case in *Expected Behaviour*.

### ARCHITECTURE conformance

- **Fixes, not bolts-on, the size-constraint-invariant violation.** Split enforcing max at seed + drag is the missing enforcement the [implemented invariant plan](plans/implemented/size-constraint-invariant.md) explicitly left for Split (it clamped the box managers and re-pointed `clampWidth/Height`, but Split's own drag/seed math was out of that scope). This closes it at the manager, per rule 3 ("a manager that does not report/enforce accurate sizes is a bug — fixed at the manager").
- **Typed setters / `declare` / one-DOM-element.** `_onConstraintSizeChange` is a runtime-only field with no `ComponentOptions` counterpart, initialised to `null` at declaration exactly like `_onPreferredSizeChange` ([`Component.ts:256`](src/typescript/lib/core/Component.ts#L256)) — it is **not** written by any `applyOptions`-dispatched setter (only by the parent binding, post-`super()`), so no `declare` is needed (the `super()`-cascade trap does not apply). No new DOM element, no new attribute. `setMinSize`/`setMaxSize` remain the typed setters; the hook fire is one added line inside each, after the existing DOM writes.

---

## Public API

No consumer-facing API is added or changed. For completeness, the internal mechanism:

### `Component` — new private constraint-change hook (internal)

```typescript
// src/typescript/lib/core/Component.ts — beside _onPreferredSizeChange (L256)
private _onConstraintSizeChange: (() => void) | null = null;
```

Fired at the tail of `setMinSize` and `setMaxSize` (after their existing DOM writes, inside the changed-value path):

```typescript
this._onConstraintSizeChange?.();
```

Bound in `addComponent` / `insertComponent` (beside the `_onPreferredSizeChange` binding):

```typescript
component._onConstraintSizeChange = () => {
    this.scheduleLayout();
    this._onConstraintSizeChange?.();   // re-propagate to the grandparent
};
```

Nulled in `removeComponent` / `removeAllComponents` beside `component._onPreferredSizeChange = null`.

### `Component.getPreferredSizeConstraint()` — existing accessor, now read by Split

Already present ([`Component.ts:2171`](src/typescript/lib/core/Component.ts#L2171)): `return (this._options.preferredSize ?? this._defaultOptions.preferredSize) ?? null;`. Split reads this (not `getPreferredSize()`) to gate seeding. No new `Split` public method, no addition needed.

---

## Internal Structure

### Split seeding pass

A new private method, called in `recalculateSizes` **immediately after** the `_weights` stale-entry prune ([`Split.ts:1147`](src/typescript/lib/layout/Split.ts#L1147)) and `available` is computed, and **before** the distribution branches (per *Sequence the layout pipeline*), so both the fallback and the distribution passes see the seed:

```typescript
// Seed a first-layout pane (no stored size) from its preferred-constraint main
// extent, clamped to [min, max] — the HBox/VBox model. `getPreferredSizeConstraint`
// resolves `_options.preferredSize ?? _defaultOptions.preferredSize`, so a
// class-default preferred (e.g. TextArea 200×200) seeds too. A pane whose
// constraint is null (no explicit and no class-default preferred, e.g. a bare
// dock Container) is left unseeded and picks up the equal-division fallback below,
// keeping docks byte-identical. Runs once per pane: a pane that already has a
// stored size is skipped, so a later setPreferredSize never re-seeds it
// (preferred is a one-time hint).
private seedFromPreferred(components: Array<Component>, horizontal: boolean): void {
    for (const component of components) {
        if (this._sizes.has(component)) {
            continue;                                  // already seeded — ignore preferred
        }

        const preferred = component.getPreferredSizeConstraint();
        if (!preferred) {
            continue;                                  // null constraint → equal-division fallback
        }

        const main = horizontal ? preferred.width : preferred.height;
        this._sizes.set(component, this.clampMain(component, main, horizontal));
    }
}
```

### Per-pane main-axis clamp helper

Shared by the seed and the constraint-change re-clamp:

```typescript
// Clamp a candidate main-axis px to the pane's [min, max] along the split axis.
private clampMain(pane: Component, value: number, horizontal: boolean): number {
    const min = pane.getMinSize();
    const max = pane.getMaxSize();
    const lo  = min ? (horizontal ? min.width : min.height) : 0;
    const hi  = max ? (horizontal ? max.width : max.height) : Number.POSITIVE_INFINITY;

    return Math.min(Math.max(value, lo), hi);   // min wins if min > max (degenerate)
}
```

### Constraint-change re-clamp in `recalculateSizes`

Right after the prune (and after `seedFromPreferred`), re-clamp every already-stored pane so a min/max change that shrank the window snaps the stored size into range before redistribution:

```typescript
for (const component of components) {
    const stored = this._sizes.get(component);
    if (stored !== undefined) {
        this._sizes.set(component, this.clampMain(component, stored, horizontal));
    }
}
```

(`seedFromPreferred` already emits a clamped value, so this is idempotent for a freshly-seeded pane and only bites when a live constraint change moved the bound under an existing size.)

### First-layout weight-slack pass

Runs **only on first layout** and **only when a positive effective weight exists** — the sibling of the existing resize-redistribution block, gated on the opposite side of `_lastAvailableMain`. It sits where the resize block's `if (this._lastAvailableMain > 0 && …)` today ends, as an `else`-side branch (or a separate `if (this._lastAvailableMain === 0 …)`), before the equal-division fallback and the uniform refill:

```typescript
// First-layout slack: after seeding, share (available − Σseed) by weight over the
// positively-weighted panes as `seed + (w/Σw)·slack` (base + weighted slack —
// HBox-inspired, NOT the HBox cell formula, which would drop the seed). Runs only
// on the first connected layout (`_lastAvailableMain === 0`); the resize block
// above owns every subsequent layout. When no pane has a positive weight this
// branch is skipped and the uniform `Σ==available` refill below reconciles the
// sum (byte-identical to the old equal-seed path).
if (this._lastAvailableMain === 0 && available > 0 && this._sizes.size > 0) {
    let weightSum = 0;
    for (const component of components) {
        const w = this.effectiveResizeWeight(component, 0);   // 0 fallback: size does NOT count here
        if (w > 0) { weightSum += w; }
    }

    if (weightSum > 0) {
        let seedTotal = 0;
        for (const component of components) {
            seedTotal += this._sizes.get(component) ?? 0;
        }
        const slack = available - seedTotal;

        for (const component of components) {
            const w = this.effectiveResizeWeight(component, 0);
            if (w > 0) {
                const seed = this._sizes.get(component) ?? 0;
                this._sizes.set(component, this.clampMain(component, seed + slack * (w / weightSum), horizontal));
            }
        }
    }
}
```

Note the `0` fallback passed to `effectiveResizeWeight` here (not the pane's stored size): first-layout slack must go **only** to panes that carry an *actual* positive weight, so an unset-weight pane is not treated as weight-bearing at seed time. This differs from the resize block, which deliberately falls back to stored size for proportional rescale — the two passes have different fallbacks by design. Whatever this branch leaves unreconciled (or when it is skipped) is finished by the existing uniform refill.

### Drag max-clamp

`onDrag`'s clamp gains a per-pane max cap. Today ([`Split.ts:644`](src/typescript/lib/layout/Split.ts#L644)):

```typescript
newLhs = Math.max(minLhs, Math.min(total - minRhs, newLhs));
```

becomes (reading each pane's max along the axis, defaulting to `+Infinity`):

```typescript
const maxLhs = /* lhs max main, or +Infinity */;
const maxRhs = /* rhs max main, or +Infinity */;

// Clamp lhs to its own [min,max] AND to the room its partner's [min,max] leaves,
// keeping the pair's combined size constant.
const loLhs = Math.max(minLhs, total - maxRhs);
const hiLhs = Math.min(maxLhs, total - minRhs);
newLhs = Math.max(loLhs, Math.min(hiLhs, newLhs));
```

This makes `min = max = W` on a pane pin the gutter (it cannot be dragged off `W`), which is the sidebar's collapsed state.

---

## Ordered Implementation Steps

1. **`Component.ts` — constraint-change field.** Add `private _onConstraintSizeChange: (() => void) | null = null;` beside `_onPreferredSizeChange` ([`Component.ts:256`](src/typescript/lib/core/Component.ts#L256)). → verify: `grep -n _onConstraintSizeChange src/typescript/lib/core/Component.ts` — one declaration.
2. **`Component.ts` — fire in `setMinSize`/`setMaxSize`.** Add `this._onConstraintSizeChange?.();` at the tail of each setter (after the `setDataAttribute` line, inside the changed path — the early no-change `return this` above it keeps an identical set silent). → verify: two fire sites.
3. **`Component.ts` — bind in `addComponent`/`insertComponent`.** Beside each `component._onPreferredSizeChange = …` binding ([`:4160`](src/typescript/lib/core/Component.ts#L4160), [`:4213`](src/typescript/lib/core/Component.ts#L4213)) add the `_onConstraintSizeChange` binding that calls `this.scheduleLayout()` then re-propagates. → verify: two bindings.
4. **`Component.ts` — null in `removeComponent`/`removeAllComponents`.** Beside each `component._onPreferredSizeChange = null` ([`:4321`](src/typescript/lib/core/Component.ts#L4321), [`:4337`](src/typescript/lib/core/Component.ts#L4337)) add `component._onConstraintSizeChange = null`. → verify: two nulls.
5. **`Component.ts` — `getPreferredSizeConstraint` (already exists at [`:2171`](src/typescript/lib/core/Component.ts#L2171)).** No change; Split will read it. → verify: `grep -n "getPreferredSizeConstraint" src/typescript/lib/core/Component.ts` — the accessor is present and returns `null` for a pane with no explicit *and* no class-default preferred.
6. **`Split.ts` — `clampMain` helper.** Add the private per-pane axis clamp. → verify: `npx tsc --noEmit`.
7. **`Split.ts` — `seedFromPreferred` pass.** Add the method; call it in `recalculateSizes` right after the `_weights` prune ([`:1147`](src/typescript/lib/layout/Split.ts#L1147)) and the `available` computation, computing `horizontal = this._orientation === "horizontal"`. → verify: seed fires for a pane with a non-null `getPreferredSizeConstraint()` (explicit or class-default) and no stored size; a null-constraint pane stays sizeless.
8. **`Split.ts` — constraint re-clamp loop.** Add the "re-clamp every stored size" loop after `seedFromPreferred`. → verify: a `setMaxSize` shrinking a stored pane clamps it on the next layout.
9. **`Split.ts` — first-layout weight-slack pass.** Add the `_lastAvailableMain === 0`-guarded branch (per *First-layout weight-slack pass*): when a positive effective weight exists, share `(available − Σseed)` over the positively-weighted panes as `seed + (w/Σw)·slack`, each re-clamped via `clampMain`. It is mutually exclusive with the existing `_lastAvailableMain > 0` resize block ([`:1170`](src/typescript/lib/layout/Split.ts#L1170)); when no positive weight exists it is skipped and the existing uniform `Σ==available` refill ([`:1248`](src/typescript/lib/layout/Split.ts#L1248)) reconciles the sum. Do **not** modify the resize block or the refill. → verify: no-positive-weight path byte-identical to today (existing tests green); a first-layout positive-weight pane absorbs the slack; the resize block never co-fires (it is guarded `_lastAvailableMain > 0`).
10. **`Split.ts` — drag max-clamp.** Extend `onDrag`'s clamp ([`:644`](src/typescript/lib/layout/Split.ts#L644)) to read each pane's max and apply the paired `[min,max]` clamp above. → verify: `min = max = W` pins the gutter.
11. **Backward-compat grep + tests.** `npx vitest run tests/component/layout/Split.test.ts` — all existing cases green (the delta-relative weight assertions hold against their captured first-layout baseline). Add the new cases from *Expected Behaviour*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` — `_onConstraintSizeChange` field, fire in `setMinSize`/`setMaxSize`, bind in `addComponent`/`insertComponent`, null in `removeComponent`/`removeAllComponents` (`getPreferredSizeConstraint` already exists — read-only) |
| Modify | `src/typescript/lib/layout/Split.ts` — `clampMain`, `seedFromPreferred`, constraint re-clamp loop, first-layout weight-slack pass, drag max-clamp |
| Modify | `tests/component/layout/Split.test.ts` — new seed / clamp / reactivity cases |

---

## Expected Behaviour

Geometry is modelled offline by the TestDOM harness (`installTestDOM`, `host.setWidth`/`setHeight`, `host.doLayout()`, then `getPaneSize`/`getWidth`), so seeding, clamping, min/max reactivity, weight-slack, and backward-compat are **unit-testable offline**. Only the real pointer gutter-drag + paint is **manual-verify**; `onDrag` itself is callable with a synthetic position offline (the harness models the resulting geometry), so the drag *math* is testable — only the mouse gesture is not.

Horizontal split unless noted; `available` = inner width − gutters.

1. **Seed from explicit preferred** (offline). 2-pane Split; pane[0] `preferredSize.width = 240`, pane[1] `preferredSize.width = 80`, no weights. After `doLayout`, the pane sizes hold ratio 240:80 = 3:1 (uniform refill scales both to fill `available`), **not** equal `available/2`. Assert `getPaneSize(p0)/getPaneSize(p1) ≈ 3` and `p0 + p1 ≈ available`.
2. **Preferred is ignored after the seed** (offline). After (1), `pane[0].setPreferredSize(400, h)` then `host.doLayout()`. `getPaneSize(p0)` is **unchanged** (still the seeded 3:1 value) — the seed does not re-fire for a stored pane.
3. **Seed clamps to max** (offline). pane[0] `preferredSize.width = 500`, `maxSize.width = 200`; pane[1] `preferredSize.width = 100`. Seed clamps p0 to 200, so the stored ratio is 200:100 = 2:1 before refill; assert `getPaneSize(p0)/getPaneSize(p1) ≈ 2`.
4. **Seed clamps to min** (offline). pane[0] `preferredSize.width = 10`, `minSize.width = 150`. Seed floors p0 to 150; assert its share reflects a ≥150 seed relative to the sibling.
5. **Null preferred constraint degrades to equal division** (offline). Both panes are instances of a component with no explicit *and* no class-default preferred (e.g. bare `Component`) — `getPreferredSizeConstraint()` is `null` — so they seed 50/50, byte-identical to pre-feature. Assert equal shares.
6. **Backward-compat: no positive weight ⇒ first-layout is byte-identical to the old equal seed** (offline, the existing-test guarantee). Two panes each `preferredSize 50×50`, **no weight set**. Seed 50/50; no positive weight, so the first-layout weight-slack branch is skipped and the uniform refill scales both to `available/2` — identical to the old equal seed. This is the ratio/`getPaneRatios` case and the `no weights set` / `all weights 0` regression cases: first-layout stays equal only *because there is no positive weight*.
6a. **First-layout with a positive weight is weight-influenced, not equal** (offline, corrects the old draft's case-6 claim). Two panes each `preferredSize 50×50`, `weight 1:3`. Seed 50/50, then the first-layout weight-slack pass shares `(available − 100)` as 1:3, so after the **first** `doLayout` the panes are **not** equal — pane[1] is larger. The existing weight tests capture `a0 = getPaneSize(p0)` / `b0 = getPaneSize(p1)` at exactly this point and assert every later delta (`a0 + 20`, `b0 + 60` after +80) relative to that captured baseline, so they pass regardless of the skew. Assert here that `b0 > a0` on first layout (pinning the weight-influenced seed) and that a subsequent +80 resize splits the delta 1:3 against the captured baseline.
7. **Min/max change triggers relayout (reactivity)** (offline). Seed pane[0] to 240 (ratio-scaled). Then `pane[0].setMinSize(300, 0)` and `setMaxSize(300, UNBOUNDED)` (pin). Without an explicit `doLayout`, the hook schedules a layout; drive it (or `host.doLayout()`) and assert `getPaneSize(p0)` re-clamps toward 300 and the sibling shrinks. Assert the hook is wired: a `setMaxSize` on a mounted pane calls the parent's `scheduleLayout` (spy/observe a layout occurred).
8. **Live min = max pins — `_sizes` guaranteed only with an absorber; committed geometry always** (offline). Which layer guarantees the pin matters: `getPaneSize()` reads `_sizes` ([`Split.ts:306`](src/typescript/lib/layout/Split.ts#L306)), which the uniform refill can scale off the pin; the committed-size `clampWidth`/`clampHeight` backstop ([`Component.ts:2795`](src/typescript/lib/core/Component.ts#L2795)/[`:2858`](src/typescript/lib/core/Component.ts#L2858)) re-corrects the *displayed* width. Two sub-cases:
    - **8a — absorbing neighbor (both layers agree):** pane[0] `min = max = 40`; pane[1] is a positive-weight (or otherwise free) absorber. After the constraint re-clamp, `Σ == available` because the absorber takes the whole delta, so the uniform refill is a **no-op** — then `getPaneSize(p0) == 40` holds and is a valid `_sizes` assertion. Grow the host by +90; pane[0] stays `40`, pane[1] absorbs +90.
    - **8b — no absorber (degenerate):** pane[0] `min = max = 40`, pane[1] also constrained/pinned so nothing can absorb. `Σ` may not equal `available`, so the uniform refill can scale `_sizes[p0]` off 40 — `getPaneSize(p0)` is **not** guaranteed to read 40. The pin is guaranteed only at committed geometry: assert `pane[0].getWidth() == 40` (the `clampWidth` backstop), **not** `getPaneSize(p0)`.
9. **Drag respects max** (offline, math). `onDrag` dragging pane[0]'s gutter past `maxSize.width` caps `getPaneSize(p0)` at its max; dragging below `minSize.width` floors it (existing). The paired clamp keeps `p0 + p1` constant.
10. **Drag with min = max is a no-op** (offline, math). pane[0] `min = max = W`; a synthetic `onDrag` cannot move the gutter off `W`.
11. **Weight distributes leftover slack** (offline). pane[0] `preferredSize.width = 100` `weight: 0`, pane[1] `preferredSize.width = 100` `weight: 1`. Seed 100/100; the slack `(available − 200)` goes entirely to pane[1] (the only positive-weight pane), so `getPaneSize(p1) − getPaneSize(p0) ≈ available − 200`. Confirms seed (base) + weighted slack compose HBox-*inspired* (base kept, slack shared by weight — not the raw HBox cell formula).
11a. **Class-default preferred seeds** (offline, advisory-pinned). A pane that is a bare instance of a class carrying `_defaultOptions.preferredSize` (e.g. `new TextArea()`, default `200×200`) — with **no** explicit `setPreferredSize` — seeds to `clamp(200, min, max)` along the split axis, not equal division. Assert `getPaneSize(textAreaPane)` reflects a 200-based seed relative to a null-constraint sibling (which stays on the equal-division fallback). This pins the SplitPanel-demo behaviour change ([`SplitPanel.ts:55`](src/typescript/SplitPanel.ts#L55)).
12. **`weight: 0` still pins on viewport resize** (offline, regression). The existing `weight 0 pins…` cases pass unchanged — the resize block is untouched.
13. **Serialization round-trip unchanged** (offline). `applyPaneRatios([1, 3])` after seeding overwrites `_sizes`; `getPaneRatios()` returns `0.25 / 0.75` — the seed does not interfere with the ratio surface.
14. **Real gutter drag + paint** (**manual-verify**). In the app, drag a Split gutter where one pane has a `max`; confirm it stops at the max edge and the cursor re-couples on reversal. Seed-from-preferred visible width is eyeballed in the `SplitPanel` demo: the bare `TextArea` pane (class-default `200×200`) now starts wider than it did under equal division; a pane given an explicit preferred likewise seeds to it.
15. **Sidebar collapse round-trip** (**manual-verify**, downstream sqladmin). Out of library scope; the primitives (seed, min/max clamp+reactivity, `setPaneSize`) are the ones this plan ships.

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or `npm run build`) — no errors from the new field/hook/helpers.
- **Unit tests:** `npx vitest run tests/component/layout/Split.test.ts` green, including **every existing** ratio / resize-weight / collapse case (the backward-compat regression guard — they pass because their assertions are delta-relative to the captured first-layout baseline, not because first-layout is equal) plus the new seed/clamp/reactivity cases 1–13, 6a, 11a.
- **Backward-compat grep:** `grep -n "getPreferredSizeConstraint" src/typescript/lib/layout/Split.ts` — the seed reads the *constraint* (`_options.preferredSize ?? _defaultOptions.preferredSize`), not `getPreferredSize()`. Confirm dock leaves stay null-constraint: a `Container` built by `Dock.compileLayout` returns `null` from `getPreferredSizeConstraint()` (no `_defaultOptions.preferredSize` on `Container`), so docks stay equal-division.
- **Manual smoke:** `npm run dev` (http://localhost:8015), open the `SplitPanel` demo — the bare `TextArea` pane now seeds wider (class-default `200×200`) while the other panes (bare `Component`/`Button`/`Text`/`List`/`Slider`, all null-constraint) stay equal-division; drag/resize otherwise as before. Give a demo pane a `max` and drag to see the cap. The sidebar round-trip is verified downstream in sqladmin once adopted.
- **Docs build:** `npm run docs:build` — 0 warnings (no new public JSDoc; the internal hook carries none that `{@link}`s an excluded symbol).

---

## Documentation Impact

No public API changes — `_onConstraintSizeChange` is private and `getPreferredSizeConstraint` mirrors the already-internal `getMinSizeConstraint`/`getMaxSizeConstraint`. If [`docs/concepts/sizing.md`](docs/concepts/sizing.md) or a Split recipe describes Split's initial pane sizing as "equal division," update that sentence to "preferred-based (explicit *or* class-default preferred), clamped to min/max, with equal-division fallback when the pane has no preferred constraint, and min/max enforced live." Confirm with `grep -rln "equal" docs/ | xargs grep -l -i "split"`. The `weight` field JSDoc on `LayoutConstraints` already documents Split's resize semantics and needs no change (they are unchanged); optionally note in prose (not a `{@link}`) that a positive `weight` also absorbs post-seed slack.

---

## Potential Challenges

- **Seed vs. `getPreferredSize()` vs. `getPreferredSizeConstraint()`.** Seeding off the *derived* `getPreferredSize()` would change dock tiling (a content-bearing dock pane reports a non-null derived preferred); the gate must be the *constraint* (`_options.preferredSize ?? _defaultOptions.preferredSize`), which is null for a dock `Container` but non-null for a class-default like `TextArea`. Mitigation: read the existing `getPreferredSizeConstraint()` ([`:2171`](src/typescript/lib/core/Component.ts#L2171)) — this is the single most important correctness choice for backward-compat.
- **Constraint-change hook re-entrancy.** `setMinSize`→`scheduleLayout` is rAF-batched, not synchronous, so a layout that calls `setWidth` (which may internally re-clamp) cannot recurse into the hook. Mitigation: the hook fires only from the public `setMinSize`/`setMaxSize`, never from the committed-size `clampWidth/Height` path.
- **Slack distribution fighting the existing refill / resize block.** The three distribution branches must not double-scale. Mitigation: the first-layout weight-slack pass is guarded `_lastAvailableMain === 0` (mutually exclusive with the resize block's `_lastAvailableMain > 0`); when it runs it adjusts `_sizes` and the trailing uniform refill then finalizes `Σ == available` (a near-no-op because the slack pass already targeted `available`); when it is skipped (no positive weight) the refill alone reconciles the sum. The resize block is never touched. This mirrors `weightSum > 0` vs. the degenerate case already in the resize block, one layout-phase up.
- **Max clamp in redistribution could break `Σ == available`.** A hard max in the redistribution loop can leave the sum short. Mitigation: enforce max at the *choice* sites (seed, drag) and rely on the committed-size `clampWidth`/`clampHeight` backstop ([`Component.ts:2795`](src/typescript/lib/core/Component.ts#L2795)/[`:2858`](src/typescript/lib/core/Component.ts#L2858)) for the redistribution overshoot, keeping `_sizes` honest via the constraint re-clamp — do not add a hard max inside the proportional redistribution.
- **`min = max` degenerate on seed.** If `min > max` (contradictory constraint) `clampMain` returns `min` (min wins), matching the invariant plan's precedence.

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `recalculateSizes` ([:1113](src/typescript/lib/layout/Split.ts#L1113); seed + re-clamp after the `_weights` prune, the `_lastAvailableMain > 0` resize block at [:1170](src/typescript/lib/layout/Split.ts#L1170), the sizeless-pane fallback at [:1202](src/typescript/lib/layout/Split.ts#L1202), the `Σ==available` refill at [:1248](src/typescript/lib/layout/Split.ts#L1248)), `onDrag` ([:628](src/typescript/lib/layout/Split.ts#L628); drag clamp at [:644](src/typescript/lib/layout/Split.ts#L644)), `effectiveResizeWeight` ([:362](src/typescript/lib/layout/Split.ts#L362); read-only — **not** modified), `getPaneSize` ([:306](src/typescript/lib/layout/Split.ts#L306); reads `_sizes`), `transferPaneSize`, `getPaneRatios`/`applyPaneRatios`.
- [`src/typescript/lib/layout/HBox.ts`](src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](src/typescript/lib/layout/VBox.ts) — `resolveChildWidth` ([HBox:613](src/typescript/lib/layout/HBox.ts#L613)) / `resolveChildHeight` ([VBox:551](src/typescript/lib/layout/VBox.ts#L551)): the preferred-then-weight-then-clamp model the seed mirrors.
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `_onPreferredSizeChange` ([:256](src/typescript/lib/core/Component.ts#L256)) and its `addComponent`/`insertComponent` binding ([:4160](src/typescript/lib/core/Component.ts#L4160)/[:4213](src/typescript/lib/core/Component.ts#L4213)) + `removeComponent`/`removeAllComponents` null ([:4321](src/typescript/lib/core/Component.ts#L4321)/[:4337](src/typescript/lib/core/Component.ts#L4337)) — the precedent for the new hook; `setMinSize` ([:2338](src/typescript/lib/core/Component.ts#L2338)) / `setMaxSize` ([:2411](src/typescript/lib/core/Component.ts#L2411)) / `setPreferredSize` ([:2251](src/typescript/lib/core/Component.ts#L2251)); `getMinSizeConstraint`/`getMaxSizeConstraint` ([:2273](src/typescript/lib/core/Component.ts#L2273)/[:2284](src/typescript/lib/core/Component.ts#L2284)) — the pattern for `getPreferredSizeConstraint`.
- [`src/typescript/lib/layout/LayoutConstraints.ts`](src/typescript/lib/layout/LayoutConstraints.ts) — the `weight` field ([:68](src/typescript/lib/layout/LayoutConstraints.ts#L68)), read unchanged by Split's resize block.
- [`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts) — `hostSplit` ([:20](tests/component/layout/Split.test.ts#L20); panes carry an explicit `preferredSize 50×50` at [:28](tests/component/layout/Split.test.ts#L28)) and the existing resize-weight suite to keep green: the no-weight ratio cases stay equal-seeded via the uniform refill, and the positive-weight cases pass because their deltas are relative to the captured first-layout `a0`/`b0` baseline, not to an assumed-equal first layout.
- [`plans/implemented/size-constraint-invariant.md`](plans/implemented/size-constraint-invariant.md) — the merged invariant work; this plan closes the Split-shaped gap it left.
- [`src/typescript/lib/overlay/Dock.ts`](src/typescript/lib/overlay/Dock.ts) / [`src/typescript/lib/layout/DockRegion.ts`](src/typescript/lib/layout/DockRegion.ts) — `leafConstraints` ([Dock.ts:449](src/typescript/lib/overlay/Dock.ts#L449)), the Split-of-Tabs construction in `compileLayout` ([Dock.ts:578](src/typescript/lib/overlay/Dock.ts#L578)), `transferPaneSize` — the byte-identical consumers the null-constraint gate protects (dock `Container` panes carry no `_defaultOptions.preferredSize`).
- [`src/typescript/lib/component/input/TextArea.ts`](src/typescript/lib/component/input/TextArea.ts) ([:31](src/typescript/lib/component/input/TextArea.ts#L31)) / [`FieldSet.ts`](src/typescript/lib/component/container/FieldSet.ts) ([:35](src/typescript/lib/component/container/FieldSet.ts#L35)) / [`display/Glyph.ts`](src/typescript/lib/component/display/Glyph.ts) ([:171](src/typescript/lib/component/display/Glyph.ts#L171)) — the class-default-preferred components that now seed when used as a bare Split pane.
- [`src/typescript/SplitPanel.ts`](src/typescript/SplitPanel.ts) ([:55](src/typescript/SplitPanel.ts#L55)) — the demo whose bare `TextArea` pane is the one visible seed change.

---

## Non-Goals

- **A `sizeToPreferred`/`setPaneTrackPreferred` opt-in, preferred-tracking-every-layout, or drag-write-back to preferred.** The rejected earlier model. Preferred is a one-time seed hint, gated by a non-null `getPreferredSizeConstraint()` (explicit *or* class-default preferred).
- **Changing the resize-weight *behaviour*.** `effectiveResizeWeight` and the weighted-redistribution block are read-only here; unset-weight proportional rescale, `weight: 0` pinning, and the all-zero uniform refill all stay exactly as merged.
- **Seeding docks from content preferred.** The constraint gate reads `getPreferredSizeConstraint()`, which is null for dock `Container` panes, so dock tiling and serialization stay byte-identical. (`SplitPanel` is **not** a Non-Goal here — its bare `TextArea` pane does seed from the class-default preferred; that is an accepted behaviour change, not a preserved one.)
- **sqladmin `ActivityBar` adoption.** Downstream; this plan ships only the library primitives (seed, min/max clamp + reactivity) the sidebar needs.
- **A hard max clamp inside the proportional redistribution/refill.** Enforced at the seed and drag choice-sites plus the committed-size backstop instead, to preserve the `Σ == available` fill invariant.
