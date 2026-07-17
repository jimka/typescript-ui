---
depends-on:
  - split-weight-pin-refill
  - accordion-resize-weight
touches-shared:
  - src/typescript/lib/layout/Split.ts
  - src/typescript/lib/layout/Accordion.ts
---

# Layout State API — Implementation Plan

## Overview

A consuming app wants to persist and restore `Split` gutter positions, `Accordion` section open/closed state, and `Accordion` section sizes across sessions. This plan adds the library API that makes it possible: a commit-grained change event per manager, a weight-aware capture surface, and a restore option per manager.

**This plan lands third.** Both [`plans/split-weight-pin-refill.md`](plans/split-weight-pin-refill.md) and [`plans/accordion-resize-weight.md`](plans/accordion-resize-weight.md) are hard dependencies (see the `depends-on` frontmatter) — not for tidiness, but because this plan's central decision *is* the pin vocabulary they introduce:

- `split-weight-pin-refill` adds `Split.isResizePinnedMain(pane)` — the predicate this plan's capture reads to decide a pane's persisted unit. Without it, the refill also silently rescales the very weight-0 panes this plan persists as px (verified drift: 418 → 368 → 334 → 309 across three viewport cycles), so a px round trip would be measuring a moving target.
- `accordion-resize-weight` adds `Accordion.effectiveWeight(component)` and `_resizePinned`, and **defines** what a pinned section is. It also invalidates the previous revision of this plan's `_resizeFactor` decision (see `## Architecture Decisions`).

Line numbers below are against **master**; both dependencies shift them. Locate every site by symbol name, not by line.

Three gaps, all still open on master:

1. **No change notification.** `Split.onDrag` ([Split.ts:737](src/typescript/lib/layout/Split.ts#L737)) mutates `_sizes` and notifies nobody; `Split.setPaneCollapsed` ([Split.ts:236](src/typescript/lib/layout/Split.ts#L236)) and `setPaneCollapsedImmediate` ([Split.ts:663](src/typescript/lib/layout/Split.ts#L663)) fire nothing; `Accordion.onGutterDrag` ([Accordion.ts:1669](src/typescript/lib/layout/Accordion.ts#L1669)) fires nothing. `Split` has no `on()` surface and no `listeners` option at all. There is no drag-**end** signal anywhere: `SplitGutter` emits `dragstart` / `drag` / `collapse` but its `onDragStop` ([SplitGutter.ts:521](src/typescript/lib/component/container/SplitGutter.ts#L521)) emits nothing.
2. **Accordion section sizes are unreachable.** `_resizeSizes` ([Accordion.ts:184](src/typescript/lib/layout/Accordion.ts#L184)) is private with no getter or setter — confirmed by `accordion-resize-weight.md`'s `## Public API`, which defers the accessor to this plan. The original deferral is [plans/implemented/accordion-resizable-sections.md:255](plans/implemented/accordion-resizable-sections.md#L255): *"`Split` exposes `getPaneRatios`/`applyPaneRatios`; an equivalent for the accordion is not part of this plan (add later if a consumer needs to save layout)."* This is that later.
3. **No declarative size restore.** `SplitOptions.collapsedPanes` ([Split.ts:29](src/typescript/lib/layout/Split.ts#L29)) restores collapse declaratively; there is no size twin on either manager.

Already supported and **not** redesigned here: `Accordion` open/closed state (`sectiontoggle` for save at [Accordion.ts:21](src/typescript/lib/layout/Accordion.ts#L21); `AccordionConstraints.initiallyOpen` for restore, read at [Accordion.ts:1193](src/typescript/lib/layout/Accordion.ts#L1193)); `Split` collapse capture (`isPaneCollapsed`) and non-animating restore (`setPaneCollapsedImmediate`).

Everything here is additive. `getPaneRatios` / `applyPaneRatios` keep their exact current semantics (see the two-surfaces decision).

---

## Architecture Decisions

### Units: the unit follows the weight — a resize-pinned pane/section persists as px, everything else as a ratio

**This is the central decision, and it is a per-entry split, not a wholesale choice.**

A weight-0 pane exists *precisely so it does not scale with the viewport*. With `split-weight-pin-refill` landed, dragging such a pane to 400px and resizing the window keeps it at 400px — so restoring it by ratio on the next session would reintroduce the exact viewport dependence the weight exists to remove, and would contradict the app's own live behaviour. Ratios are right for panes that *share slack* and exactly backwards for pinned ones.

Conversely, ratios stay right for weighted entries, and that is measured, not assumed: `accordion-resize-weight.md` records the app's accordion holding **72.6 / 27.4 exactly** across 900 → 700 → 500 → 900 with a lossless round trip. Both managers rescale the weighted set to the live budget on every layout, so a weighted entry's stored px is a viewport-dependent number whose only durable content is its ratio.

So each entry carries its own unit, and the predicate is the dependencies' own:

- **`Split`** — px iff `isResizePinnedMain(pane)` (i.e. `effectiveResizeWeight(pane, WEIGHT_UNSET_PROBE) === 0`: an **explicit** `weight: 0` constraint or `setPaneResizeWeight(pane, 0)`). An unset weight resolves flexible → ratio.
- **`Accordion`** — px iff `effectiveWeight(component) === 0` (i.e. `weight` unset or `0` **and** `setFillHeight` off). This is verbatim the definition `accordion-resize-weight.md`'s `## Public API` hands over.

Both predicates are private methods on the manager itself, so the capture calls them directly — no visibility change, and the unit rule can never disagree with the layout that enforces it.

**Ratios normalise over the weighted subset only, not over all entries.** A pinned entry's px and a weighted entry's stored value live at different scales (see the `_resizeFactor` decision), so normalising them together yields a meaningless number. Ratios sum to 1.0 across the *ratio* entries; px entries stand alone.

### The `_resizeFactor` decision, re-derived — normalisation no longer dissolves it, the unit tag does

The previous revision of this plan asserted that `_resizeFactor` "cancels under normalisation" because it is *"one scalar applied to the whole set"*. **`accordion-resize-weight.md` makes that false and the assertion is withdrawn.** Under its `distributeWithinConstraints`, a resize-pinned section is held at its stored px (**scale 1**) and removed from the budget *before* the proportional pass; only the remaining free set carries `_resizeFactor`. Two scales, so `stored_i / Σstored ≠ rendered_i / Σrendered` for a mixed open set, and a whole-set normalisation is now incoherent.

Re-derived against the true model, three things hold — and the first two are why the mixed-unit design works at all:

1. **A pinned section's stored value *is* its px.** The pin block writes `heights.set(i, clampSectionHeight(c, _resizeSizes.get(c)))` — rendered `==` stored, modulo the min/max clamp. And `onGutterDrag`'s new per-section scale (`_resizePinned.has(c) ? 1 : _resizeFactor`) writes a dragged pin back at scale 1. So capturing `_resizeSizes` raw for a pinned section captures px, exactly. No `_resizeFactor` multiply.
2. **`_resizeFactor` is still one scalar across the *free* set**, so it still cancels *within* the ratio subset. `stored_i / Σ_free stored == rendered_i / Σ_free rendered`. Subset normalisation is therefore exact.
3. **Capture still reads `_resizeSizes` raw, never rendered heights.** Unchanged from the previous revision and for the unchanged reason: `distributeWithinConstraints`' clamp loop pins a section at its min/max and drops it from `free`, so its *rendered* height is off its stored ratio. `_resizeSizes` is never rewritten by a layout ([Accordion.ts:2088](src/typescript/lib/layout/Accordion.ts#L2088): *"a drag is the only thing that changes the ratio itself"*), so the raw read is the stable one and a transient clamp never gets baked into saved state.

The failure mode this guards is unchanged and severe: get the scale wrong and untouched sections silently rescale on the next layout — which is why `onGutterDrag` divides by the factor in the first place.

### Two surfaces on `Split`, deliberately: `getPaneRatios` is *arrangement*, `getPaneSizes` is *persistence*

`getPaneRatios` / `applyPaneRatios` are `LayoutSerialization`'s surface ([LayoutSerialization.ts:212](src/typescript/lib/layout/LayoutSerialization.ts#L212), [:459](src/typescript/lib/layout/LayoutSerialization.ts#L459)) for same-session topology switching: the viewport does not change across a switch, so a weight-agnostic whole-set ratio is exactly right there, and it is public, documented, and tested. Changing its return type or its normalisation would break it. It stays **byte-for-byte semantically untouched**.

`getPaneSizes` / `applyPaneSizes` are the new cross-session surface: weight-aware, mixed-unit. The two answer different questions, so they are two methods rather than one contorted one. The rule for consumers: **`LayoutSerialization` uses ratios; an app persisting across reloads uses `getPaneSizes`.**

`Accordion` gets **only** the `getSectionSizes` / `applySectionSizes` pair — it has no `LayoutSerialization` involvement (that module recognises `Split` / `Tab` / `Window` only), so a ratio-only Accordion surface would have no caller. The previous revision's `getSectionRatios` / `applySectionRatios` / `sectionRatios` are dropped in favour of the size-shaped names; nothing shipped, so nothing breaks.

### The payload is `LayoutSize[]` — one self-describing array, persisted verbatim

`emit("paneresize", this.getPaneSizes())` / `emit("sectionresize", this.getSectionSizes())`, where:

```typescript
interface LayoutSize { unit: "px" | "ratio"; value: number; }
```

The listener persists the array directly with no follow-up read — the property that made the previous payload decision right, preserved through the units change. A bare notification would force a racy `getPaneSizes()` call after the manager may have moved on.

Rejected alternatives:

- **Two parallel arrays** (`{ sizes: number[], pinned: boolean[] }`) — two things to length-check, two things to keep in step, and a consumer can trivially pair them wrong.
- **An untagged `number[]` plus a separate unit query** — the app would have to re-derive the unit rule the library already owns, and a save/read race reopens.

One tagged array keeps the existing whole-array discard rule working unchanged, JSON round-trips as-is, and lets the drain validate the saved unit against the live weight (below). Two fields is not baroque.

### Stale-state discard also checks the **unit**, not just the length

Extending the previous revision's rule rather than replacing it. A pending array restores only when:

> `saved.length === liveUnits.length`, `length > 0`, every entry has a finite `value >= 0`, **every entry's `unit` equals the live unit at that index**, and at least one entry has `value > 0`. Otherwise the whole array is **discarded** and the manager falls back to its normal first-layout sizing, exactly as though no option were passed.

The unit check is the load-bearing addition. A length check cannot catch the case where the app edits a pane's weight in code (`weight: 0` → `weight: 1`) between releases: the saved px would land on a now-weighted pane and be read as a ratio, or vice versa. The saved state describes a *different layout configuration*, so it is discarded whole — the same reasoning as the length check, which cannot trust an index→child mapping once the child count moved.

Whole-array discard, not per-entry repair, for that same reason.

**The strict/lenient split is preserved exactly as before.** Every entry point that carries *persisted* state is strict: `SplitOptions.paneSizes`, `Split.applyPaneSizes`, `AccordionOptions.sectionSizes`, and `Accordion.applySectionSizes` — all four validating through the one `isRestorableSizes` call in their shared drain or setter. `applyPaneRatios` alone stays **lenient**, unchanged: it is documented and tested as *"treated as relative weights (re-normalised internally), so a caller that dropped a pane on restore can pass a short or non-unit array"* ([Split.ts:600-613](src/typescript/lib/layout/Split.ts#L600), [Split.test.ts:75](tests/component/layout/Split.test.ts#L75)), and it serves `LayoutSerialization`, not persistence. Tightening it would be breaking and would fix nothing this plan cares about.

### Restore is a **pending option drained on first layout**, mirroring `collapsedPanes`

Unchanged from the previous revision, and unaffected by the units change. Panes/sections are not resolvable from indices until the container has children, and `applyOptions` runs while the manager is still detached (`getContainer()` is `null`), so an option cannot apply eagerly. The in-file precedent is `_pendingCollapsed` ([Split.ts:63](src/typescript/lib/layout/Split.ts#L63)) drained by `applyPendingCollapsed` ([Split.ts:1134](src/typescript/lib/layout/Split.ts#L1134)) from `doLayout`. Both managers copy it: `SplitOptions.paneSizes` → `_pendingSizes`, `AccordionOptions.sectionSizes` → `_pendingSectionSizes`.

`Component.afterNextLayout` / `onFirstLayout` stay **rejected**: they solve the same problem one layer out, at the cost of diverging from the sibling option three lines away in the same file, and a `LayoutManager` is not a `Component`.

**px and ratio entries cannot fight, because there is exactly one array, one drain, and one write per manager.** `fromLayoutSizes` converts the whole array to stored values in a single pass; there is no second pass for a second unit and therefore no ordering between them.

### A restore lands at scale 1: the weighted entries are seeded against `budget − Σpx`

The one arithmetic subtlety, and it is what makes a restore a no-op for the very next layout rather than something the manager has to reconcile.

Both managers subtract the pins first and rescale only what is left:

- `Split`'s refill (post-`split-weight-pin-refill`): `flexibleScale = (budget − weightPinnedTotal) / flexibleTotal`.
- `Accordion`'s `distributeWithinConstraints` (post-`accordion-resize-weight`): pins leave the budget, then `freeFactor = remaining / freeStored`.

So writing `stored = ratio × (budget − Σpx)` for the weighted entries makes `Σflexible == budget − Σpx`, hence **scale exactly 1** on both — the restored geometry renders as saved with no rescale. This is why the base is `budget − Σpx` and not `budget`: seeding against the whole budget would leave the weighted set over-sized by the pins' share and rely on the refill to shrink it back, which works but writes stored values that no longer mean what the next capture would read.

When the container is not yet laid out, or the pins alone overrun the budget, the base falls back to `1`. That is safe rather than approximate: both managers' rescale passes are scale-invariant over the weighted set, so a unit base lands on the same rendering one pass later. It mirrors `applyPaneRatios`'s existing unit-base fallback ([Split.ts:637-638](src/typescript/lib/layout/Split.ts#L637)).

A px entry is always written verbatim, at any budget. Clamping to the pane's `[min, max]` is left to the managers' existing clamp passes, which already own it.

### `getPaneSizes` / `getSectionSizes` report pending state

Unchanged in spirit from the previous revision, narrowed in scope. A capture taken after a restore but before the draining layout would otherwise return the live (unrestored) state and let the app overwrite good saved state with garbage. Both new getters return the pending array when one is undrained and restorable.

`getPaneRatios` does **not** gain this — it is the arrangement surface, and teaching it about a mixed-unit pending array would leak persistence semantics into `LayoutSerialization`'s contract for no caller's benefit.

### Events follow the `ListenerBag` + typed `on`/`off`/`emit` idiom

Both managers emit **framework-custom** events (not DOM-routed), so per [ARCHITECTURE.md](ARCHITECTURE.md) *Event handling* they get a string-literal `XEvent` union, a private `ListenerBag<XEvent>`, one-line `on`/`off` forwarders, and a `protected emit`. The precedent is twofold and in-repo: [`SplitGutter:117-467`](src/typescript/lib/component/container/SplitGutter.ts#L117) (union + bag + typed overloads on a `Component`) and [`Accordion:178,952-984`](src/typescript/lib/layout/Accordion.ts#L178) (the same shape on a `LayoutManager`, which is what `Split` is). `Split` mirrors `Accordion` exactly.

### Construction-time listener bags are dispatched inline from `applyOptions`, **not** via `applyListeners`

`Component.applyListeners` does not exist on `LayoutManager`. `Accordion.applyOptions` ([Accordion.ts:279](src/typescript/lib/layout/Accordion.ts#L279)) therefore loops the bag inline and calls `this.on(event, listener)`. `Split` copies that block verbatim.

This is safe — and the `super()`-cascade rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does **not** apply — because `LayoutManager`'s constructor takes no options: both managers call `this.applyOptions(options)` from their own **constructor body** ([Split.ts:86](src/typescript/lib/layout/Split.ts#L86), [Accordion.ts:224](src/typescript/lib/layout/Accordion.ts#L224)), after `super()` has returned and after class-field initializers have run. So `_listeners` and every new `_pending*` field are live by then and take **plain initializers**, not `declare`. (`accordion-resize-weight.md` reaches the same conclusion for its `_resizePinned` field.)

### Granularity: one commit-grained resize event per manager, emitted at drag END

Unchanged. A drag fires per pointer-move frame; persisting every frame is waste, and the decision lives in the library so every consumer benefits. `SplitGutter` already distinguishes `dragstart` from `drag` but has **no** drag-end signal — `onDragStop` ([SplitGutter.ts:521](src/typescript/lib/component/container/SplitGutter.ts#L521)) tears down its viewport listeners silently. So the precedent to *extend* is the gutter's own union: add `"dragend"` alongside `"dragstart"`/`"drag"`, emitted from `onDragStop`. `Split` listens to it and re-emits `"paneresize"`. `Accordion` already owns a private `onGutterDragEnd` ([Accordion.ts:1814](src/typescript/lib/layout/Accordion.ts#L1814)) wired to viewport `mouseup`/`touchend`/`touchcancel` — it emits `"sectionresize"` from there. Per-frame `drag` stays unexposed on the managers; a consumer wanting live feedback can already listen on the gutter.

### Identity: index↔Component mapping is confined to the capture and the drain

`_sizes` / `_resizeSizes` are keyed by `Component` (reorder-safe); the persisted array is index-based. The mapping happens in two places per manager — the capture and the drain — and both always walk `container.getComponents()` in child order, the same list `getPaneRatios` ([Split.ts:502](src/typescript/lib/layout/Split.ts#L502)) reads. **Not** `getLaidOutComponents()`: that list omits non-displayed children, so it would silently shift indices. (`applyPendingCollapsed`'s use of the laid-out list is pre-existing and untouched.)

### Size math is extracted to a pure, DOM-free module

`src/typescript/lib/layout/LayoutSizes.ts` imports nothing and owns the `LayoutSize` vocabulary plus every pure operation on it — capture (`toLayoutSizes`), restore (`fromLayoutSizes`), validation (`isRestorableSizes`), and the whole-set normalisation `getPaneRatios` already needs (`normalizeRatios`). Both managers reduce to "resolve the live units, hand the module the raw stored numbers".

This is the seam that makes the logic unit-testable without a DOM, and it is where the plan puts the intelligence so neither manager can drift from the other. It is named `LayoutSizes`, not `LayoutRatios`, because it carries px as well as ratios.

The **types** (`LayoutSize`, `LayoutSizeUnit`) are exported from `layout/index.ts` — a consumer cannot type a persisted array without them, and exporting them lets public JSDoc `{@link LayoutSize}` legally. The **functions** stay unexported internal mechanics, so per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) no public JSDoc may name them. Tests reach them by deep path (`~/layout/LayoutSizes`), the same way the existing layout tests import `~/layout/Split`.

### Container resize does NOT emit a resize event

Unchanged, and the dependencies strengthen it. Post-fix, a container resize moves neither a pinned entry's px (held) nor a weighted entry's ratio (invariant under the rescale) — so `getPaneSizes()` returns the same array before and after, and there is nothing new to persist. A viewport resize is not user intent to re-save. Only a drag (and, for `Split`, a collapse toggle) emits.

---

## Public API

### `src/typescript/lib/layout/LayoutSizes.ts` (new; types public, functions internal)

```typescript
/**
 * How a persisted {@link LayoutSize} entry is measured.
 *
 * @category Layouts
 */
export type LayoutSizeUnit = "px" | "ratio";

/**
 * One pane's or section's persisted size. `px` entries are absolute and
 * restored verbatim; `ratio` entries are a share of the space left after the
 * px entries, and sum to ~1.0 across the ratio entries of one array.
 *
 * @category Layouts
 */
export interface LayoutSize {
    unit:  LayoutSizeUnit;
    value: number;
}

// --- internal (not exported from layout/index.ts) ---

/** Builds the capture: px entries verbatim, ratio entries normalised over the ratio subset. */
export function toLayoutSizes(units: LayoutSizeUnit[], stored: number[]): LayoutSize[];

/** Converts a captured array back to stored values against a main-axis budget. */
export function fromLayoutSizes(sizes: LayoutSize[], budget: number): number[];

/** Whether a persisted array is safe to restore against the live per-index units. */
export function isRestorableSizes(sizes: LayoutSize[], units: LayoutSizeUnit[]): boolean;

/** Normalises `count` relative weights to ratios summing to 1.0; equal split when none is positive. */
export function normalizeRatios(values: number[], count: number): number[];
```

### `src/typescript/lib/component/container/SplitGutter.ts`

```typescript
export type SplitGutterEvent = "dragstart" | "drag" | "dragend" | "collapse";

export interface SplitGutterOptions extends ComponentOptions {
    // …existing fields unchanged…
    listeners?: {
        dragstart?: (position: number) => void;
        drag?:      (position: number) => void;
        dragend?:   () => void;          // NEW
        collapse?:  () => void;
    };
}

class SplitGutter extends Component<SplitGutterOptions> {
    on(event: "dragend", listener: () => void): this;          // NEW overload
    protected emit(event: "dragend"): void;                    // NEW overload
}
```

`off(event: SplitGutterEvent, listener: Function)` needs no change — it is already keyed on the union.

### `src/typescript/lib/layout/Split.ts`

```typescript
export type SplitEvent = "paneresize" | "panecollapse";

export type PaneResizeCallback   = (sizes: LayoutSize[]) => void;
export type PaneCollapseCallback = (index: number, collapsed: boolean) => void;

export interface SplitOptions extends LayoutManagerOptions {
    orientation?:    AxisOrientation;
    collapsedPanes?: number[];
    /** Pane sizes to restore on first layout; discarded whole when stale. */
    paneSizes?:      LayoutSize[];                             // NEW
    listeners?: {                                              // NEW
        paneresize?:   PaneResizeCallback;
        panecollapse?: PaneCollapseCallback;
    };
}

class Split extends LayoutManager {
    private _listeners: ListenerBag<SplitEvent> = new ListenerBag<SplitEvent>();
    private _pendingSizes: LayoutSize[] | null = null;

    /**
     * The panes' sizes in child order, one entry per pane: a resize-pinned pane
     * (explicit `weight: 0`) reports `px`, every other pane reports its `ratio`
     * of the space the px panes leave. Returns the pending `paneSizes` when one
     * is still undrained; `[]` when detached.
     */
    getPaneSizes(): LayoutSize[];                              // NEW

    /**
     * Restores sizes captured by getPaneSizes. Discarded whole unless every
     * entry's unit matches the live pane's weight (see the discard rule).
     */
    applyPaneSizes(sizes: LayoutSize[]): this;                 // NEW

    on(event: "paneresize",   listener: PaneResizeCallback): this;
    on(event: "panecollapse", listener: PaneCollapseCallback): this;
    on(event: SplitEvent,     listener: Function): this;

    off(event: SplitEvent, listener: Function): this;

    protected emit(event: "paneresize",   sizes: LayoutSize[]): void;
    protected emit(event: "panecollapse", index: number, collapsed: boolean): void;
    protected emit(event: SplitEvent,     ...payload: unknown[]): void;

    // NEW private:
    private paneSizeUnits(components: Component[]): LayoutSizeUnit[];  // isResizePinnedMain → "px" | "ratio"
    private onDragEnd(): void;                                         // emits "paneresize"
    private applyPendingSizes(): void;                                 // drains _pendingSizes
}
```

**Unchanged**: `getPaneRatios(): number[]` and `applyPaneRatios(ratios: number[]): this` keep their exact semantics and their lenient contract — `LayoutSerialization`'s surface. `getPaneRatios` is refactored onto `normalizeRatios` (same math, single-sourced) and gains no pending awareness. `getPaneSize(pane)` / `setPaneSize(pane, size)` are unchanged and reused: `applyPaneSizes` writes through `setPaneSize`.

**Depends on** `split-weight-pin-refill`'s private `isResizePinnedMain(pane: Component): boolean`.

### `src/typescript/lib/layout/Accordion.ts`

```typescript
export type AccordionEvent = "sectiontoggle" | "sectionresize";

export type SectionResizeCallback = (sizes: LayoutSize[]) => void;

export interface AccordionOptions extends LayoutManagerOptions {
    // …existing fields unchanged…
    /**
     * Section sizes to restore on the first resizable layout; discarded whole
     * when stale. Only meaningful with `resizable`.
     */
    sectionSizes?: LayoutSize[];                               // NEW
    listeners?: {
        sectiontoggle?: SectionToggleCallback;
        sectionresize?: SectionResizeCallback;                 // NEW
    };
}

class Accordion extends LayoutManager {
    private _pendingSectionSizes: LayoutSize[] | null = null;

    /**
     * The sections' content sizes in child order, one entry per section, open
     * or closed: a resize-pinned section (effective weight `0`) reports `px`,
     * every other section reports its `ratio` of the space the px sections
     * leave. Returns the pending `sectionSizes` when one is still undrained;
     * `[]` when detached.
     */
    getSectionSizes(): LayoutSize[];                           // NEW

    /**
     * Restores sizes captured by getSectionSizes, applied on the next layout
     * that can resolve the open budget. Discarded whole unless every entry's
     * unit matches the live section's weight.
     */
    applySectionSizes(sizes: LayoutSize[]): this;              // NEW

    on(event: "sectiontoggle", listener: SectionToggleCallback): this;
    on(event: "sectionresize", listener: SectionResizeCallback): this;  // NEW overload

    protected emit(event: "sectionresize", sizes: LayoutSize[]): void;  // NEW overload

    // NEW private:
    private sectionSizeUnits(components: Component[]): LayoutSizeUnit[];  // effectiveWeight === 0 → "px"
    private applyPendingSectionSizes(components: Component[], openBudget: number): void;
}
```

**Depends on** `accordion-resize-weight`'s private `effectiveWeight(component: Component): number`.

### Consumer contract summary

This is the contract the dependent app plan builds against.

| State | Save | Restore |
|---|---|---|
| Split pane sizes | `split.on("paneresize", (sizes: LayoutSize[]) => …)` | `new Split({ paneSizes })` — or `split.applyPaneSizes(sizes)` |
| Split collapse | `split.on("panecollapse", (index, collapsed) => …)` | `new Split({ collapsedPanes })` *(existing)* |
| Accordion section sizes | `accordion.on("sectionresize", (sizes: LayoutSize[]) => …)` | `new Accordion({ sectionSizes })` — or `accordion.applySectionSizes(sizes)` |
| Accordion open/closed | `accordion.on("sectiontoggle", (index, open) => …)` *(existing)* | `new AccordionConstraints(label, initiallyOpen)` *(existing)* |

Contract notes the app plan must honour:

- **Persist the `LayoutSize[]` verbatim.** It is JSON-safe. Do not unwrap it to numbers — the unit is what makes the restore correct, and the drain validates it.
- **A restore is all-or-nothing.** A stale array (wrong length, or a unit that no longer matches the pane's weight) is discarded silently and the layout falls back to its normal first-layout sizing. The app needs no versioning or migration for shape changes of this kind.
- **`LayoutSize` / `LayoutSizeUnit` import from `@jimka/typescript-ui/layout`.**
- **`AccordionPanel` consumers** reach all of it through the documented [`getAccordion()`](src/typescript/lib/component/container/AccordionPanel.ts#L148) accessor.
- **Do not use `getPaneRatios` / `applyPaneRatios` for session persistence** — they are `LayoutSerialization`'s weight-agnostic arrangement surface and will restore a pinned pane at the wrong px.

---

## Internal Structure

### `LayoutSizes.ts`

```typescript
export function toLayoutSizes(units: LayoutSizeUnit[], stored: number[]): LayoutSize[] {
    const clean      = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);
    const ratioCount = units.filter(unit => unit === "ratio").length;

    let ratioTotal = 0;

    for (let idx = 0; idx < units.length; idx += 1) {
        if (units[idx] === "ratio") {
            ratioTotal += clean(stored[idx]);
        }
    }

    return units.map((unit, idx) => {
        if (unit === "px") {
            return { unit, value: clean(stored[idx]) };
        }

        // Equal split among the ratio entries when none carries a stored size —
        // the same fallback `normalizeRatios` applies to a whole-set capture.
        return { unit, value: ratioTotal > 0 ? clean(stored[idx]) / ratioTotal : 1 / ratioCount };
    });
}

export function fromLayoutSizes(sizes: LayoutSize[], budget: number): number[] {
    let pxTotal    = 0;
    let ratioTotal = 0;
    let ratioCount = 0;

    for (const size of sizes) {
        if (size.unit === "px") {
            pxTotal += size.value;
        } else {
            ratioTotal += size.value;
            ratioCount += 1;
        }
    }

    // Seed the weighted entries against what the px entries leave, so both
    // managers' rescale passes land on scale 1 and the restore renders as saved.
    // Fall back to a unit base when the container is unsized or the px entries
    // alone overrun it: both managers are scale-invariant over the weighted set,
    // so the next layout's rescale lands on the same rendering one pass later.
    const room = budget > 0 ? Math.max(0, budget - pxTotal) : 0;
    const base = room > 0 ? room : 1;

    return sizes.map(size => {
        if (size.unit === "px") {
            return size.value;
        }

        return ratioTotal > 0 ? (size.value / ratioTotal) * base : base / ratioCount;
    });
}

export function isRestorableSizes(sizes: LayoutSize[], units: LayoutSizeUnit[]): boolean {
    if (units.length === 0 || sizes.length !== units.length) {
        return false;
    }

    const valid = sizes.every((size, idx) =>
        size != null
        && size.unit === units[idx]
        && Number.isFinite(size.value)
        && size.value >= 0);

    return valid && sizes.some(size => size.value > 0);
}

export function normalizeRatios(values: number[], count: number): number[] {
    const weights: number[] = [];

    for (let idx = 0; idx < count; idx += 1) {
        const value = values[idx];

        weights.push(Number.isFinite(value) && value > 0 ? value : 0);
    }

    const sum = weights.reduce((total, weight) => total + weight, 0);

    return sum > 0 ? weights.map(weight => weight / sum) : weights.map(() => 1 / count);
}
```

### `Split.paneSizeUnits` + `getPaneSizes` + `applyPaneSizes`

```typescript
private paneSizeUnits(components: Component[]): LayoutSizeUnit[] {
    // The unit follows the weight, resolved by the same predicate the refill
    // uses — so a pane the layout holds at its px is the pane persisted as px.
    return components.map(pane => (this.isResizePinnedMain(pane) ? "px" : "ratio"));
}

getPaneSizes(): LayoutSize[] {
    const container = this.getContainer();

    if (!container) {
        return [];
    }

    const components = container.getComponents();

    if (components.length === 0) {
        return [];
    }

    const units = this.paneSizeUnits(components);

    // An undrained restore has not reached `_sizes` yet; reporting the live
    // state here would let a save overwrite the very state being restored.
    if (this._pendingSizes !== null && isRestorableSizes(this._pendingSizes, units)) {
        return this._pendingSizes.map(size => ({ ...size }));
    }

    return toLayoutSizes(units, components.map(pane => this._sizes.get(pane) ?? 0));
}

applyPaneSizes(sizes: LayoutSize[]): this {
    const container = this.getContainer();

    if (!container) {
        return this;
    }

    const components = container.getComponents();
    const units      = this.paneSizeUnits(components);

    if (!isRestorableSizes(sizes, units)) {
        return this;
    }

    const innerSize = container.getInnerSize();
    const main      = innerSize ? (this._orientation === "horizontal" ? innerSize.width : innerSize.height) : 0;
    const available = Math.max(0, main - this.gutterTotal(components.length));
    const stored    = fromLayoutSizes(sizes, available);

    components.forEach((pane, idx) => this.setPaneSize(pane, stored[idx]));

    // Match `applyPaneRatios`: rebase so the next `recalculateSizes` treats the
    // freshly-written sizes as the baseline instead of double-rescaling them.
    this._lastAvailableMain = available > 0 ? available : 1;

    container.scheduleLayout();

    return this;
}
```

### `Split.applyPendingSizes` — drained from `doLayout`

```typescript
private applyPendingSizes(): void {
    const pending = this._pendingSizes;

    if (pending === null) {
        return;
    }

    this._pendingSizes = null;

    // `applyPaneSizes` re-validates against the live units and discards a stale
    // array whole, so the drain needs no check of its own.
    this.applyPaneSizes(pending);
}
```

### `Accordion.sectionSizeUnits` + `getSectionSizes` + `applySectionSizes`

```typescript
private sectionSizeUnits(components: Component[]): LayoutSizeUnit[] {
    // `effectiveWeight === 0` is `accordion-resize-weight`'s definition of a
    // resize-pinned section: `weight` unset or 0, with `fillHeight` off.
    return components.map(component => (this.effectiveWeight(component) === 0 ? "px" : "ratio"));
}

getSectionSizes(): LayoutSize[] {
    const container = this.getContainer();

    if (!container) {
        return [];
    }

    const components = container.getComponents();

    if (components.length === 0) {
        return [];
    }

    const units = this.sectionSizeUnits(components);

    if (this._pendingSectionSizes !== null && isRestorableSizes(this._pendingSectionSizes, units)) {
        return this._pendingSectionSizes.map(size => ({ ...size }));
    }

    // `_resizeSizes` raw — never `getHeight()`, never `× _resizeFactor`. A
    // pinned section's stored value is already its px (scale 1); the factor
    // cancels within the ratio subset; and a rendered height would bake in a
    // transient min/max clamp that the stored value deliberately does not carry.
    return toLayoutSizes(units, components.map(component => this._resizeSizes.get(component) ?? 0));
}

applySectionSizes(sizes: LayoutSize[]): this {
    // Deferred, not immediate: the correct base is `openBudget`, which only
    // `computeResizableHeights` can resolve. The option and this setter share
    // one drain, one base, and one discard rule.
    this._pendingSectionSizes = sizes.map(size => ({ ...size }));

    this.getContainer()?.scheduleLayout();

    return this;
}
```

### `Accordion.applyPendingSectionSizes` — drained from `computeResizableHeights`

```typescript
private applyPendingSectionSizes(components: Component[], openBudget: number): void {
    const pending = this._pendingSectionSizes;

    if (pending === null) {
        return;
    }

    this._pendingSectionSizes = null;

    const units = this.sectionSizeUnits(components);

    if (!isRestorableSizes(pending, units)) {
        return;
    }

    const stored = fromLayoutSizes(pending, openBudget);

    for (let idx = 0; idx < components.length; idx += 1) {
        // A zero-size section is *removed* rather than stored as 0, so it falls
        // back to the legacy `openContentHeight + fill` seed below instead of
        // taking a zero share of the budget.
        if (stored[idx] > 0) {
            this._resizeSizes.set(components[idx], stored[idx]);
        } else {
            this._resizeSizes.delete(components[idx]);
        }
    }
}
```

Call site — inside `computeResizableHeights`, between `const openBudget = containerSize.height - headerTotal;` ([Accordion.ts:2140](src/typescript/lib/layout/Accordion.ts#L2140)) and the existing seed loop, so a restored section is never overwritten by the seed (which only writes when `!_resizeSizes.has(component)`).

The three early returns above that point (`!this._resizable`, `!containerSize`, `openIndices.length === 0`) leave the array pending — correct: it drains on the first layout that can resolve a budget.

---

## Ordered Implementation Steps

**Prerequisite:** `plans/implemented/split-weight-pin-refill.md` and `plans/implemented/accordion-resize-weight.md` are both implemented. → verify before starting: `grep -n 'isResizePinnedMain' src/typescript/lib/layout/Split.ts` and `grep -n 'effectiveWeight\|_resizePinned' src/typescript/lib/layout/Accordion.ts` — both must hit. If either misses, stop: this plan's capture cannot compile.

1. **Create `src/typescript/lib/layout/LayoutSizes.ts`.** SPDX header, no imports. Export `LayoutSizeUnit`, `LayoutSize` (both JSDoc'd with `@category Layouts`), and the four functions per `## Internal Structure`, each with a full JSDoc block. → verify: `grep -c "^import" src/typescript/lib/layout/LayoutSizes.ts` — expect `0`.

2. **`SplitGutter.ts` — add the `dragend` event.** Widen `SplitGutterEvent` ([:18](src/typescript/lib/component/container/SplitGutter.ts#L18)) to include `"dragend"`; add `dragend?: () => void` to the `listeners` bag ([:69](src/typescript/lib/component/container/SplitGutter.ts#L69)); add the `on(event: "dragend", …)` overload ([:431](src/typescript/lib/component/container/SplitGutter.ts#L431)) and the `emit(event: "dragend")` overload ([:462](src/typescript/lib/component/container/SplitGutter.ts#L462)); in `onDragStop` ([:521](src/typescript/lib/component/container/SplitGutter.ts#L521)) call `this.emit("dragend")` as the **last** statement, after `endPointerDrag()`. Update the `on()` JSDoc's `@param event` prose to describe `"dragend"` (fires on mouseup/touchend/touchcancel ending a drag). → verify: `npm run typecheck`.

3. **`Split.ts` — imports and event surface.** Import `ListenerBag` from `~/core/ListenerBag.js`, and `LayoutSize`, `LayoutSizeUnit`, `toLayoutSizes`, `fromLayoutSizes`, `isRestorableSizes`, `normalizeRatios` from `~/layout/LayoutSizes.js`. Above `SplitOptions` ([:26](src/typescript/lib/layout/Split.ts#L26)) add the exported `SplitEvent` union, `PaneResizeCallback`, and `PaneCollapseCallback` types (each JSDoc'd, `@category Layouts`), mirroring [Accordion.ts:21,97](src/typescript/lib/layout/Accordion.ts#L21). Add `paneSizes?: LayoutSize[]` and the `listeners?` bag to `SplitOptions`. Add the fields `private _listeners: ListenerBag<SplitEvent> = new ListenerBag<SplitEvent>();` and `private _pendingSizes: LayoutSize[] | null = null;` next to `_pendingCollapsed` ([:63](src/typescript/lib/layout/Split.ts#L63)) — plain initializers, **not** `declare` (see the cascade decision). Add `on` / `off` / `emit` copying the shape of [Accordion.ts:952-984](src/typescript/lib/layout/Accordion.ts#L952). → verify: `npm run typecheck`.

4. **`Split.applyOptions`** ([:97](src/typescript/lib/layout/Split.ts#L97)) — after the `collapsedPanes` block, add `if (options.paneSizes !== undefined) { this._pendingSizes = options.paneSizes.map(size => ({ ...size })); }` (deep-copy the entries, matching the `collapsedPanes` line's copy above it), then the `listeners` dispatch loop copied verbatim from [Accordion.ts:279-289](src/typescript/lib/layout/Accordion.ts#L279).

5. **`Split.getPaneRatios` — single-source the ratio math only.** In `getPaneRatios` ([:496](src/typescript/lib/layout/Split.ts#L496)), replace the `sum > 0 ? … : …` tail with `return normalizeRatios(sizes, components.length);`. **Change nothing else about it** — no pending awareness, no unit awareness; it stays `LayoutSerialization`'s arrangement surface. In `applyPaneRatios` ([:615](src/typescript/lib/layout/Split.ts#L615)), replace the `weights`/`sum`/`norm` trio with `const norm = normalizeRatios(ratios, count);` and leave its lenient contract and JSDoc intact. → verify: `npx vitest run tests/component/layout/Split.test.ts tests/component/layout/LayoutSerialization.test.ts` — every existing ratio test passes **unmodified**.

6. **`Split.paneSizeUnits` / `getPaneSizes` / `applyPaneSizes`.** Add all three per `## Internal Structure`, next to `getPaneRatios` / `applyPaneRatios` ([:496-649](src/typescript/lib/layout/Split.ts#L496)). `applyPaneSizes` writes through the existing public `setPaneSize` ([:308](src/typescript/lib/layout/Split.ts#L308)) rather than touching `_sizes` directly. JSDoc all three, including the two-surfaces note on `getPaneSizes` (*"for cross-session persistence; `getPaneRatios` is the arrangement surface"*). → verify: `npm run typecheck`.

7. **`Split.applyPendingSizes`.** Add the private method per `## Internal Structure`, next to `applyPendingCollapsed` ([:1134](src/typescript/lib/layout/Split.ts#L1134)). In `doLayout`, insert `this.applyPendingSizes();` immediately **after** `this.recalculateSizes();` and **before** `this.applyPendingCollapsed(components);` ([:952-953](src/typescript/lib/layout/Split.ts#L952)) — `recalculateSizes` would otherwise re-seed `_sizes` and reset `_lastAvailableMain` over the restore.

8. **`Split` — emit `panecollapse`.** In `setPaneCollapsed` ([:236](src/typescript/lib/layout/Split.ts#L236)), add `this.emit("panecollapse", index, collapsed);` immediately after `this._collapsed.set(pane, collapsed)` ([:258](src/typescript/lib/layout/Split.ts#L258)) — the method already early-returns when `current === collapsed`, so it self-guards. In `setPaneCollapsedImmediate` ([:663](src/typescript/lib/layout/Split.ts#L663)), add the same line after its `this._collapsed.set(pane, collapsed)` ([:685](src/typescript/lib/layout/Split.ts#L685)), before `container.scheduleLayout()`.

9. **`Split` — emit `paneresize`.** Add `private onDragEnd(): void { this.emit("paneresize", this.getPaneSizes()); }` next to `onDrag` ([:737](src/typescript/lib/layout/Split.ts#L737)). In `doLayout`'s gutter-creation block ([:928-942](src/typescript/lib/layout/Split.ts#L928)), add exactly `gutter.on("dragend", () => this.onDragEnd());` — an arrow delegating to a named method, mirroring [Accordion.ts:1562](src/typescript/lib/layout/Accordion.ts#L1562) rather than the surrounding legacy `function`/`me` closures, which are left untouched. → verify: `npm run typecheck`.

10. **`Accordion.ts` — event + option surface.** Import `LayoutSize`, `LayoutSizeUnit`, `toLayoutSizes`, `fromLayoutSizes`, `isRestorableSizes` from `~/layout/LayoutSizes.js`. Widen `AccordionEvent` ([:21](src/typescript/lib/layout/Accordion.ts#L21)) to `"sectiontoggle" | "sectionresize"`. Add the exported `SectionResizeCallback` type next to `SectionToggleCallback` ([:97](src/typescript/lib/layout/Accordion.ts#L97)). Add `sectionSizes?: LayoutSize[]` and `sectionresize?: SectionResizeCallback` to `AccordionOptions` ([:104,124](src/typescript/lib/layout/Accordion.ts#L104)). Add `private _pendingSectionSizes: LayoutSize[] | null = null;` next to `_resizeSizes` ([:184](src/typescript/lib/layout/Accordion.ts#L184)). Add the `on(event: "sectionresize", …)` and `emit(event: "sectionresize", sizes: LayoutSize[])` overloads ([:952,981](src/typescript/lib/layout/Accordion.ts#L952)). The existing `applyOptions` listener loop ([:279](src/typescript/lib/layout/Accordion.ts#L279)) already iterates `Object.keys(listeners)` and needs **no** change; add `if (options.sectionSizes !== undefined) { this._pendingSectionSizes = options.sectionSizes.map(size => ({ ...size })); }` alongside the other option blocks. → verify: `npm run typecheck`.

11. **`Accordion.sectionSizeUnits` / `getSectionSizes` / `applySectionSizes`.** Add all three per `## Internal Structure`, next to `isSectionOpen` ([:938](src/typescript/lib/layout/Accordion.ts#L938)). `sectionSizeUnits` calls `accordion-resize-weight`'s `effectiveWeight`. JSDoc all three; `getSectionSizes`'s remarks must state that it reads `_resizeSizes` raw and why (the three reasons in the `_resizeFactor` decision).

12. **`Accordion.applyPendingSectionSizes`.** Add the private method per `## Internal Structure` next to `computeResizableHeights` ([:2104](src/typescript/lib/layout/Accordion.ts#L2104)), and call it from inside `computeResizableHeights` between `const openBudget = containerSize.height - headerTotal;` ([:2140](src/typescript/lib/layout/Accordion.ts#L2140)) and the `for (const i of openIndices)` seed loop ([:2142](src/typescript/lib/layout/Accordion.ts#L2142)). **Do not touch `distributeWithinConstraints` or `onGutterDrag`** — `accordion-resize-weight` owns both, and its comments encode its own ordering.

13. **`Accordion` — emit `sectionresize`.** In `onGutterDragEnd` ([:1814](src/typescript/lib/layout/Accordion.ts#L1814)), capture `const wasDragging = this._dragUpper !== null;` as the first statement, and after `this._dragLower = null;` add `if (wasDragging) { this.emit("sectionresize", this.getSectionSizes()); }`. Extend the method's JSDoc to note it emits, including on the `detach()` mid-drag path ([:1010](src/typescript/lib/layout/Accordion.ts#L1010)), which calls it before `_resizeSizes` is cleared. → verify: `npm run typecheck`.

14. **`src/typescript/lib/layout/index.ts`** — add `export type { LayoutSize, LayoutSizeUnit } from '~/layout/LayoutSizes.js';`; add `SplitEvent`, `PaneResizeCallback`, `PaneCollapseCallback` to the existing `SplitOptions` type-export line ([:41](src/typescript/lib/layout/index.ts#L41)); add `SectionResizeCallback` to the existing `Accordion` type export ([:16](src/typescript/lib/layout/index.ts#L16)). Export **only** the types from `LayoutSizes` — no functions. → verify: `grep -n "LayoutSizes" src/typescript/lib/layout/index.ts` — expect exactly one line, and no `toLayoutSizes`/`fromLayoutSizes`/`isRestorableSizes`/`normalizeRatios` anywhere in the file.

15. **Tests** — see `## Verification`.

16. **Docs** — see `## Documentation Impact`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/layout/LayoutSizes.ts` |
| Create | `tests/unit/layout/LayoutSizes.test.ts` |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `src/typescript/lib/layout/index.ts` |
| Modify | `tests/component/layout/Split.test.ts` |
| Modify | `tests/component/layout/Accordion.resizable.test.ts` |
| Modify | `docs/layouts/Split.md` |
| Modify | `docs/layouts/Accordion.md` |
| Modify | `docs/reference/changelog.md` |

---

## Expected Behaviour

### Pure logic — unit-testable with no DOM (`tests/unit/layout/LayoutSizes.test.ts`)

1. `normalizeRatios([1, 3], 2)` → `[0.25, 0.75]`; sum is `1.0`.
2. `normalizeRatios([2, 6], 2)` → `[0.25, 0.75]` — already-relative input normalises identically.
3. `normalizeRatios([0, 0], 2)` → `[0.5, 0.5]`; `normalizeRatios([1, -5, NaN, Infinity], 4)` → `[1, 0, 0, 0]`; `normalizeRatios([1], 3)` → `[1, 0, 0]`; `normalizeRatios([1, 2], 0)` → `[]`.
4. **`toLayoutSizes` — px entries verbatim, ratios over the ratio subset only.** `toLayoutSizes(["px", "ratio", "ratio"], [400, 100, 300])` → `[{px,400}, {ratio,0.25}, {ratio,0.75}]`. The `400` must **not** enter the ratio denominator — this is the whole-set-normalisation bug the `_resizeFactor` decision forbids.
5. **`toLayoutSizes` all-px** — `toLayoutSizes(["px","px"], [200, 300])` → `[{px,200},{px,300}]`; no ratio entries, nothing normalised.
6. **`toLayoutSizes` ratio fallback** — `toLayoutSizes(["px","ratio","ratio"], [400, 0, 0])` → the two ratio entries are `0.5` each (equal split when none is stored).
7. **`toLayoutSizes` sanitises** — `toLayoutSizes(["px","ratio"], [NaN, -3])` → `[{px,0},{ratio,1}]` (the lone ratio entry falls back to the equal split of one).
8. **`fromLayoutSizes` seeds the weighted set against `budget − Σpx`.** `fromLayoutSizes([{px,400},{ratio,0.25},{ratio,0.75}], 1200)` → `[400, 200, 600]` — px verbatim, ratios over the remaining 800.
9. **`fromLayoutSizes` round-trips `toLayoutSizes`.** For units `["px","ratio","ratio"]` and stored `[400, 200, 600]` at budget `1200`: `fromLayoutSizes(toLayoutSizes(units, stored), 1200)` deep-equals `[400, 200, 600]`.
10. **`fromLayoutSizes` unit-base fallback.** Budget `0` (detached) → px entries stay verbatim and ratio entries sum to `1`: `fromLayoutSizes([{px,400},{ratio,0.25},{ratio,0.75}], 0)` → `[400, 0.25, 0.75]`.
11. **`fromLayoutSizes` when px overruns the budget** — `fromLayoutSizes([{px,400},{ratio,1}], 300)` → `[400, 1]`: `room <= 0` so the unit base applies and the manager's own yield/rescale reconciles.
12. **`isRestorableSizes` accepts a matching array** — `isRestorableSizes([{px,400},{ratio,1}], ["px","ratio"])` → `true`.
13. **`isRestorableSizes` rejects a length mismatch** — `([{ratio,1}], ["px","ratio"])` → `false`; `([{px,1},{ratio,1}], ["px"])` → `false`.
14. **`isRestorableSizes` rejects a unit mismatch** — `([{ratio,0.5},{ratio,0.5}], ["px","ratio"])` → `false`. This is the weight-changed-in-code case a length check cannot catch.
15. **`isRestorableSizes` rejects bad values** — `([{px,NaN},{ratio,1}], …)` → `false`; `([{px,-1},{ratio,1}], …)` → `false`; `([{px,0},{ratio,0}], …)` → `false` (no positive entry); `([], [])` → `false`.

### Split — unit-testable via the offline DOM harness (`tests/component/layout/Split.test.ts`, existing `installTestDOM` / `hostSplit` / `emptyHost` shape)

16. **`getPaneRatios` / `applyPaneRatios` are untouched.** Every existing test in the file passes **unmodified**, as does `LayoutSerialization.test.ts`. If any needs relaxing, the two-surfaces decision was misapplied.
17. **`getPaneSizes` units follow the weight.** `emptyHost(1200, 300)`; `side` added `{ weight: 0 }`, `body` added `{ weight: 1 }`, `extra` added with **no** weight. After `doLayout()`: `getPaneSizes()` is `[{unit:"px"}, {unit:"ratio"}, {unit:"ratio"}]` — an **unset** weight is flexible, only an explicit `0` is px.
18. **`getPaneSizes` reports the pinned pane's px and the rest as a subset ratio.** Same host; `side` at 400px stored, `body`/`extra` sharing the remaining 800 equally → `[{px,400},{ratio,0.5},{ratio,0.5}]`. The ratios must sum to `1.0` **excluding** the px pane.
19. **A `setPaneResizeWeight(pane, 0)` imperative pin also reports px** — the unit resolves through `isResizePinnedMain`, so the imperative and declarative pins agree.
20. **Round trip at a different viewport is exact for the pin.** Host 1200 wide, `side` `{weight: 0}` dragged to 400, `body` `{weight: 1}`. Capture. Rebuild the same Split at host width **800** with `new Split({ paneSizes: captured })`; after `doLayout()`, `side.getWidth()` is **exactly 400** and `body` takes the rest. *(This is the decision's whole point: a ratio restore would give 267.)*
21. **Round trip preserves the weighted panes' ratio.** Three panes: `side` `{weight:0}` at 400, `a`/`b` `{weight:1}` at 3:1. Capture at host 1200, restore at host 800 → `side` is 400, and `a : b` is still 3:1 within the remaining space.
22. **A restore is scale-1: no rescale on the next layout.** After the draining `doLayout()`, a second `doLayout()` with no size change leaves every pane's width **identical** (asserts the `budget − Σpx` base, not merely the eventual convergence).
23. **Stale `paneSizes` is discarded whole — length.** `new Split({ paneSizes: [{px,400},{ratio,1}] })` hosted with **3** panes → after `doLayout()`, the normal first-layout sizing, with no trace of `400`.
24. **Stale `paneSizes` is discarded whole — unit.** A saved `[{ratio,0.5},{ratio,0.5}]` restored into a Split whose pane 0 is now `{ weight: 0 }` (live units `["px","ratio"]`) → discarded; normal first-layout sizing.
25. **`paneSizes: [{px,0},{ratio,0}]` is discarded** (no positive entry) → normal first-layout sizing.
26. **`getPaneSizes` is readable before the draining layout.** `new Split({ paneSizes })` + hosted, `getPaneSizes()` **before** any layout deep-equals the option array.
27. **Drain is once-only.** After the first `doLayout()`, `applyPaneSizes(other)` then a second `doLayout()` reflects `other`; the option does not re-apply.
28. **A container resize does not move the capture.** Lay out, capture, `host.setWidth(800)`, `doLayout()`, capture again → the two arrays deep-equal (the pin's px held, the ratios invariant). Zero `paneresize` events fire.
29. **`panecollapse` fires on `setPaneCollapsed`.** Listener receives `(index, true)` then `(index, false)`; a redundant `setPaneCollapsed(i, true)` on an already-collapsed pane fires **nothing** (the existing `current === collapsed` early return).
30. **`panecollapse` fires on `setPaneCollapsedImmediate`** with `(index, collapsed)`. It does **not** fire when the call is a no-op because the pane has no serving gutter (`collapsible: false`) — the existing guard returns first.
31. **`paneresize` fires once at drag end with the post-drag sizes.** Drive the private handlers as the existing tests do: `(split as any).onDragStart(host, gutter, 0)`, `.onDrag(host, gutter, 40)`, then `(split as any)._gutters[0].onDragStop()`. The listener fires exactly once, and its payload deep-equals a subsequent `getPaneSizes()`.
32. **`drag` alone fires no `paneresize`.** `onDragStart` + three `onDrag` calls with no `onDragStop` → zero `paneresize` events (the per-frame save the design exists to avoid).
33. **`listeners` bag is equivalent to `on`**, and **`off` removes the listener** — a removed `paneresize` callback is not invoked on the next drag end.

### Accordion — unit-testable via the offline DOM harness (`tests/component/layout/Accordion.resizable.test.ts`, existing `hostAccordion` / `content` / `constraints` shape)

34. **`getSectionSizes` units follow the weight.** The `accordion-resize-weight` fixture: `tree` `{weight: 1}`, `insp` **unweighted**, `fillHeight` off, resizable on, host 300×900. After `doLayout()`: `getSectionSizes()` is `[{unit:"ratio"}, {unit:"px"}]`, and the `insp` entry's value is **exactly 220** (its stored px, held at scale 1 by the pin block).
35. **`setFillHeight(true)` flips the unpinned section to `ratio`.** Same fixture with `acc.setFillHeight(true)` → both entries are `ratio`, because `effectiveWeight` resolves the unset weight to `1`. Asserts the unit rule reads `effectiveWeight`, not the raw constraint.
36. **`getSectionSizes` is scale-honest under `_resizeFactor ≠ 1`.** Reuse the 3-open-sections-no-weight fixture at [Accordion.resizable.test.ts:305](tests/component/layout/Accordion.resizable.test.ts#L305) where stored scale ≠ rendered scale: the entries derive from `_resizeSizes`, **not** from `getHeight()`. Add a min/max-clamped section and assert its captured entry reflects its *stored* value, not its clamped rendered height.
37. **Round trip at a different viewport is exact for the pin.** Fixture #34. Capture at host height 900; rebuild with `new Accordion({ resizable: true, sectionSizes: captured })` at host height **500**; after `doLayout()`, `insp.getHeight()` is **exactly 220** and `tree` takes the rest. *(Pre-`accordion-resize-weight` this read 109.9.)*
38. **Round trip preserves the weighted sections' ratio.** Three open sections, one unweighted pin plus two `{weight: 1}` dragged to 3:1. Capture at 900, restore at 500 → the pin holds its px and the two weighted sections are still 3:1 within the remainder.
39. **A restore is scale-1.** After the draining `doLayout()`, a second `doLayout()` with no size change leaves every section's height identical.
40. **A drag survives the round trip.** Fixture #34: `onGutterDragStart(0, 500)`, `onGutterDrag(0, 400)`, `onGutterDragEnd()` → `insp` is 320. Capture; restore into a fresh accordion at host height 700 → `insp` is exactly **320** (the pin holds whatever px the drag gave it, per `accordion-resize-weight`'s contract).
41. **Stale `sectionSizes` is discarded whole** — a 2-entry array against 3 sections, and a unit-mismatched array (saved `ratio` where the live section is now unweighted), both leave the normal fill-seeded layout exactly as if no option were passed.
42. **`applySectionSizes` is strict too** — the setter and the option share the drain, so a 2-entry array against 3 sections is discarded whole.
43. **`getSectionSizes` reads back before the draining layout** — immediately after `applySectionSizes(x)`, `getSectionSizes()` deep-equals `x`.
44. **A zero-value section falls back to the legacy seed.** An entry with `value: 0` (alongside a positive sibling, so the array is restorable) is *removed* from `_resizeSizes` at drain, so `computeResizableHeights` seeds it from `openContentHeight + fill`; its rendered height is ≥ its min.
45. **`sectionSizes` on a non-resizable accordion stays pending, then applies.** `new Accordion({ sectionSizes })` + `doLayout()` (no restore — `computeResizableHeights` returns early); then `setResizable(true)` + `doLayout()` → the sizes apply.
46. **`sectionresize` fires once at drag end.** `onGutterDragStart(0, 0)`, `.onGutterDrag(0, 30)`, `.onGutterDragEnd()` → exactly one event whose payload deep-equals `getSectionSizes()`. Three drag frames with no end → zero events.
47. **`onGutterDragEnd` without a live drag is silent** — calling it with `_dragUpper === null` fires nothing (the `wasDragging` guard, exercised by `detach()`).
48. **`sectiontoggle` is untouched** — the existing toggle tests pass unchanged, and opening/closing a section fires no `sectionresize`.
49. **A closed section keeps its entry.** Close a section; `getSectionSizes()` still reports its frozen entry with its configured unit; reopen → its height returns to the pre-close value. (`accordion-resize-weight` #7 pins the layout half; this pins the capture half.)

### Manual verification (the harness cannot drive real pointer input or a real viewport resize)

50. **Real gutter drag → one save.** Drag a `Split` gutter with the mouse in the demo app: `paneresize` fires exactly **once**, on mouse release, not per frame. Same for an `Accordion` resizable gutter → `sectionresize`.
51. **Touch drag** — `touchend` and `touchcancel` both end the drag and emit exactly one event.
52. **Collapsed strip is not draggable** — mousedown on a collapsed `SplitGutter` strip emits neither `dragstart` nor `dragend` (the existing `_opaque` guard at [SplitGutter.ts:500](src/typescript/lib/component/container/SplitGutter.ts#L500)).
53. **`Border`'s fixed gutters never emit `dragend`** — `movable: false` means the `mousedown` wiring is never installed.
54. **Restore across a real reload at a different window size**: a weight-0 sidebar dragged to 400px comes back at **400px**, not a scaled fraction; the weighted panes come back at their saved proportions.
55. **Collapse animation is unaffected** — `setPaneCollapsed` still animates; the added `emit` does not perturb `runCollapse`.

---

## Verification

- `npm run typecheck`
- `npm run lint` — the `local/no-raw-dom` rule must stay green; `LayoutSizes.ts` touches no DOM.
- `npx vitest run tests/unit/layout/LayoutSizes.test.ts` — behaviours 1-15.
- `npx vitest run tests/component/layout/Split.test.ts` — behaviours 16-33. **No existing test is edited**; the `split-weight-pin-refill` regression cases must stay green.
- `npx vitest run tests/component/layout/Accordion.resizable.test.ts tests/component/layout/Accordion.manager.test.ts` — behaviours 34-49. **No existing test is edited**; the `accordion-resize-weight` regression cases must stay green.
- `npx vitest run tests/component/layout/LayoutSerialization.test.ts` — the `normalizeRatios` refactor must not move the serialization round-trip.
- `npx vitest run` — full suite, **208 files / 2459 tests**. *(Use `npx vitest run`, not `npm test`: `npm test` gates on `typecheck:test`, which fails on master with two pre-existing `leaves.smoke.test.ts` errors unrelated to this work — see `## Non-Goals`.)*
- `grep -A14 'getSectionSizes(): LayoutSize\[\]' src/typescript/lib/layout/Accordion.ts | grep -c '_resizeFactor\|getHeight()'` — expect `0`. `getSectionSizes` reads `_resizeSizes` raw; a hit here is the scale bug the `_resizeFactor` decision exists to prevent.
- `grep -c '_resizeFactor' src/typescript/lib/layout/Accordion.ts` — unchanged from the count `accordion-resize-weight` leaves behind. This plan adds no `_resizeFactor` reader.
- `npm run docs:build` — must finish with **zero** warnings. `LayoutSize` / `LayoutSizeUnit` are exported so public JSDoc may `{@link}` them; the four functions are not, so no public JSDoc may name them.
- Manual: behaviours 50-55 in the demo app's `Split` and `Accordion` (resizable) pages.

---

## Documentation Impact

- **`docs/layouts/Split.md`** — add `paneSizes` and `listeners` rows to the options table. Add a `## Saving and restoring layout` section covering `on("paneresize")` / `on("panecollapse")` → `paneSizes` / `collapsedPanes`, and stating the two rules a consumer needs: **the unit follows the weight** (a `weight: 0` pane persists as px because it is the pane that deliberately does not scale with the viewport; every other pane persists as a ratio of what is left), and **`getPaneRatios` / `applyPaneRatios` are the arrangement surface used by [`LayoutSerialization`](/api/layout/functions/serializeLayout), not the session-persistence surface**. Note `paneresize` fires once per completed drag.
- **`docs/layouts/Accordion.md`** — add `sectionSizes` and the `sectionresize` listener to the options table ([:50-52](docs/layouts/Accordion.md#L50)); extend `## Resizable sections` ([:111](docs/layouts/Accordion.md#L111)) with `getSectionSizes` / `applySectionSizes` and the same unit rule, cross-referencing the `weight` semantics `accordion-resize-weight` documents there. Note `sectionSizes` is only meaningful with `resizable`. `## Toggle callback` ([:147](docs/layouts/Accordion.md#L147)) stays as-is and gains a cross-link to the new resize event.
- **`docs/reference/changelog.md`** — a new bullet under `## Unreleased (pre-1.0)`, in the same **"Accordion resizable sections and weighted fill"** section `accordion-resize-weight` extends: *"**Layout state can now be persisted across sessions.** [`Split`](/api/layout/classes/Split) emits `paneresize` / `panecollapse` and [`Accordion`](/api/layout/classes/Accordion) emits `sectionresize`, each once per completed gesture; `Split.getPaneSizes` / `applyPaneSizes`, `Accordion.getSectionSizes` / `applySectionSizes`, and the matching `paneSizes` / `sectionSizes` options round-trip the result. Each entry carries its own unit: a resize-pinned (`weight: 0`) pane or section persists as **px**, everything else as a **ratio** of the space the pinned entries leave — so a pinned pane restores at the size it was left at regardless of the window size on reload. Saved state whose length or units no longer match the live layout is discarded whole."* Additive only — no entry in the breaking **"API naming harmonization"** section.
- **Export surface**: `layout/index.ts` (`@jimka/typescript-ui/layout`) gains `LayoutSize`, `LayoutSizeUnit`, `SplitEvent`, `PaneResizeCallback`, `PaneCollapseCallback`, `SectionResizeCallback`. `SplitGutterEvent` is already exported and merely widens.
- **`llms.txt`**: no change and no regeneration — it is manifest-driven ([`scripts/llms/manifest.data.mjs`](scripts/llms/manifest.data.mjs)) and keyed by component, and no new component or doc page is added.
- **`docs/api/**`** — regenerated by `npm run docs:build`; never hand-edited.
- No renames or removals of shipped symbols, so no `grep -rln '\bOldName\b' docs/` sweep is needed.

---

## Potential Challenges

- **Both dependencies must be implemented first, and the failure is silent-ish.** `isResizePinnedMain` and `effectiveWeight` are private methods this plan calls; without them the capture does not compile (a loud failure), but a *partial* dependency — say `accordion-resize-weight` landed without its `_resizePinned` drag-scale fix — would compile and silently mis-scale a dragged pin. Mitigation: the prerequisite `grep` gate at the top of `## Ordered Implementation Steps`, and behaviour 40 (drag → round trip) fails loudly if the drag scale is wrong.
- **Line numbers in this plan are stale by construction.** Both dependencies edit `Split.ts` and `Accordion.ts` before this lands. Mitigation: every step names the enclosing symbol; locate by name and treat the line as a hint.
- **A pinned entry whose pin was *yielding* at capture time carries a scaled value.** When the pins alone overrun the budget, `resizePinnedSections` returns `[]`, `_resizePinned` is empty, and a concurrent drag writes that section at `/_resizeFactor` — while `getSectionSizes` still tags it `px` (the unit follows the *configured* weight, deliberately, so a momentarily-tiny window cannot permanently downgrade a pin to a ratio). The round trip stays lossless in that configuration (nothing is held at scale 1, so everything rescales proportionally and the ratios survive); the value is only off if the window later grows enough for the pin to start holding. This is narrow (drag *while* the pins overrun), self-heals on the next drag at a normal size, and the alternative — reading `_resizePinned` for the unit — is strictly worse, because it would flip the saved unit based on transient viewport state and lose the px for good. Mitigation: accept and document; do not make the capture read `_resizePinned`.
- **`applyPaneSizes` calls `container.scheduleLayout()`, and the drain calls it from inside `doLayout`.** This schedules one redundant follow-up pass on startup. It terminates (the second pass finds `_pendingSizes === null`) and the sizes already render in the draining pass. Mitigation: accept it, exactly as `applyPaneRatios` already does; do **not** add a re-entrancy flag.
- **Drain order inside `Split.doLayout` is load-bearing.** `applyPendingSizes` must run *after* `recalculateSizes()` (which re-seeds `_sizes` and resets `_lastAvailableMain`) and *before* `computeMainAxisSizes` reads `_sizes`. Mitigation: the single insertion point named in step 7.
- **`getComponents()` vs `getLaidOutComponents()`.** Mixing them shifts every index when a child is non-displayed. Mitigation: every new index↔Component site uses `getComponents()`, matching `getPaneRatios`; `applyPendingCollapsed` keeps its pre-existing laid-out list untouched.
- **Two ratio-ish surfaces on `Split` invite conflation.** A future reader may "unify" `getPaneRatios` and `getPaneSizes`. Mitigation: the two-surfaces decision names the caller of each; behaviour 16 fails if `getPaneRatios` is changed.
- **`Accordion.detach()` calls `onGutterDragEnd()` mid-drag.** The new emit fires there, with a still-valid container (`super.detach()` and the `_resizeSizes.clear()` both run after). Mitigation: keep the call order in `detach` exactly as it is ([Accordion.ts:1010](src/typescript/lib/layout/Accordion.ts#L1010)) and do not move the emit outside the `wasDragging` guard.
- **`SplitGutter` is shared with `Border`.** Widening the event union is additive, and `Border` passes `movable: false` so no drag wiring is ever installed. Mitigation: none needed; behaviour 53 pins it.
- **`Split`'s gutter block uses legacy `function`/`me` closures.** Mitigation: the new `dragend` wiring uses the current idiom (arrow → named method, per [Accordion.ts:1562](src/typescript/lib/layout/Accordion.ts#L1562)); do not refactor the neighbouring lines — surgical changes only.

---

## Critical Files

- [`plans/split-weight-pin-refill.md`](plans/split-weight-pin-refill.md) — **dependency.** Its `isResizePinnedMain` (and the `WEIGHT_UNSET_PROBE` fallback rationale) is the predicate behind every `"px"` unit on `Split`. Read its *"The refill needs a separate predicate"* and *"The soft pin resolves through `effectiveResizeWeight` with a positive fallback"* decisions before writing `paneSizeUnits`.
- [`plans/accordion-resize-weight.md`](plans/accordion-resize-weight.md) — **dependency.** Its `effectiveWeight`, `_resizePinned`, pin block, and per-section drag scale are the machinery this plan captures. Its `## Public API` hands over the "a section is resize-pinned iff `effectiveWeight === 0`" definition; its `## Potential Challenges` records the `_resizeFactor` invalidation this plan's decision answers.
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `SplitOptions` (:26), `_sizes`/`_collapsed`/`_pendingCollapsed` (:42-63), `applyOptions` (:97), `setPaneCollapsed` (:236), `setPaneSize`/`getPaneSize` (:308-325), `effectiveResizeWeight` (:379), `getPaneRatios` (:496), `applyPaneRatios` (:615) — note its `_lastAvailableMain` rebase and unit-base fallback, which `applyPaneSizes` mirrors — `setPaneCollapsedImmediate` (:663), `onDrag` (:737), `doLayout` gutter block (:921-947) and the `recalculateSizes`/`applyPendingCollapsed` pair (:952), `applyPendingCollapsed` (:1134), `recalculateSizes` (:1224).
- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — **the precedent for the whole event + options shape** (`AccordionEvent` :21, `SectionToggleCallback` :97, `listeners` bag :124, `_listeners` :178, the inline bag dispatch :279, `on`/`off`/`emit` :952-984). Also the scale machinery: `_resizeSizes` (:184), `_resizeFactor` (:192), `onGutterDrag` (:1669) and its stored-scale write (:1753), `onGutterDragEnd` (:1814), `computeResizableHeights` (:2104), `distributeWithinConstraints` (:2180). **Read every comment in the last two before editing** — they encode prior fixes and their own ordering.
- [`src/typescript/lib/component/container/SplitGutter.ts`](src/typescript/lib/component/container/SplitGutter.ts) — the event-union precedent (:18, :69, :431-467) and `onDragStop` (:521), the emission site.
- [`src/typescript/lib/layout/LayoutSerialization.ts`](src/typescript/lib/layout/LayoutSerialization.ts) — `SplitNode.ratios` (:70) and its `applyPaneRatios` (:459) / `setPaneCollapsedImmediate` (:463) restore path. The reason `getPaneRatios`/`applyPaneRatios` stay untouched.
- [`src/typescript/lib/layout/LayoutConstraints.ts`](src/typescript/lib/layout/LayoutConstraints.ts) — the `weight` field's per-manager doc table (:66-78), which both dependencies extend and which the unit rule reads.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Event handling* (the two-surface split, the `listeners`-bag rule).
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — the `super()`-cascade `declare` rule (why it does **not** apply here) and the no-`{@link}`-internal rule.
- [`tests/component/layout/Split.test.ts`](tests/component/layout/Split.test.ts) — the `installTestDOM` / `hostSplit` / `emptyHost` harness and the private-handler drag idiom.
- [`tests/component/layout/Accordion.resizable.test.ts`](tests/component/layout/Accordion.resizable.test.ts) — `hostAccordion` / `content` / `constraints`, and the stored-vs-rendered-scale fixture at :305.

---

## Non-Goals

- **The consuming app's persistence.** No store, no localStorage keys, no call-site wiring, no debounce policy — [`sqladmin/plans/layout-persistence.md`](../../sqladmin/plans/layout-persistence.md) owns all of it. `## Public API` is the contract it builds against.
- **Implementing either dependency.** `isResizePinnedMain`, `effectiveWeight`, `_resizePinned`, the refill cascade, the pin block, and the `fillWeight` → `weight` rename all belong to the two plans in `depends-on`. This plan adds no weight semantics of its own — it only *reads* the predicates they define.
- **Changing `getPaneRatios` / `applyPaneRatios` semantics.** `LayoutSerialization`'s surface; the `normalizeRatios` refactor is the only edit, and it is behaviour-preserving.
- **Redesigning Accordion open/closed state.** `sectiontoggle` + `initiallyOpen` already cover save and restore.
- **A ratio-only Accordion surface** (`getSectionRatios` / `applySectionRatios` / a `sectionRatios` option). Superseded by the size-shaped pair before anything shipped; `Accordion` has no `LayoutSerialization` caller that would want ratios-over-all.
- **Exposing per-frame `drag` on `Split` / `Accordion`.** Consumers wanting live feedback listen on `SplitGutter` directly. The managers expose commit-grained events only.
- **Emitting a resize event on container resize.** Post-dependencies, a resize moves neither a pin's px nor a ratio; there is nothing new to persist.
- **Persisting resize weights themselves.** Weights are app configuration set at build time, not user state; `split-resize-weights.md` already ruled serializing them out of scope, and a weight change between releases is exactly what the discard rule is meant to detect.
- **Serializing `Accordion` state through `LayoutSerialization`.** That module recognises `Split`/`Tab`/`Window` only; adding an `AccordionNode` is a separate topology question and is not needed for the consuming app, which holds direct manager references.
- **New `AccordionPanel` options** (`onSectionResize`, `sectionSizes` passthrough). [`getAccordion()`](src/typescript/lib/component/container/AccordionPanel.ts#L148) is the documented accessor and already reaches the whole surface.
- **Exporting `LayoutSizes`' functions from the barrel.** Internal mechanics; only the `LayoutSize` / `LayoutSizeUnit` types are public, because a consumer must be able to type a persisted array.
- **Fixing the pre-existing `leaves.smoke.test.ts` typecheck errors** that block `npm test` on master. Unrelated and outside this change's blast radius.
- **The Dialog auto-focus bug** — unrelated, out of scope.

---

## Implementation Notes

- **The `applyOptions` listener-dispatch loop needs a cast once a manager has two-or-more event keys.** The plan's step 4 (Split) and step 10 (Accordion, "needs no change") both call for the plain `for (const event of Object.keys(listeners)) { this.on(event, listener); }` loop copied from Accordion's pre-existing single-key (`sectiontoggle`-only) form. With a second key added — `panecollapse`/`paneresize` on `Split`, `sectionresize` on `Accordion` — `event`'s type widens to the union of both event names and `listener`'s type widens to the union of both callback types, and TypeScript's overload resolution does not distribute a union call across separate `on` overloads: `tsc` rejects the call (`No overload matches this call`). This is the exact problem `Component.applyListeners` already solves for `Component` subclasses via `(this as any).on(event, fn)`, documented in its own JSDoc as sound because `event` and `listener` are still a matched pair from the same options key — `LayoutManager` has no `applyListeners`, so both `Split.applyOptions` and `Accordion.applyOptions` apply that identical cast inline, with a comment pointing at the precedent. No behaviour change, no new pattern — the existing codebase idiom for this exact situation, applied where the plan's literal "no change" instruction turned out not to compile.
- **`getSectionSizes`'s remarks originally `{@link}`ed the private `applyPendingSectionSizes`**, which the docs build correctly flagged (*"linked to X which was resolved but is not included in the documentation"*) since `applySectionSizes` — the enclosing public method — renders. Reworded to describe the behaviour in prose instead, per `CODE_CONVENTIONS.md`'s no-`{@link}`-internal-symbols rule; not a rule the plan overlooked, just a link that slipped past a first draft.
- **The plan's `grep -c '_resizeFactor' src/typescript/lib/layout/Accordion.ts` verification check reads 11, not the pre-plan baseline of 9.** Both new hits are in `getSectionSizes`'s own JSDoc remarks — text the plan's step 11 explicitly requires (*"must state that it reads `_resizeSizes` raw and why (the three reasons in the `_resizeFactor` decision)"*), not a new code reader. The behavioural check the same Verification section pairs it with (`grep -A14 'getSectionSizes(): LayoutSize\[\]' ... | grep -c '_resizeFactor\|getHeight()'`, scoped to the function body) reads `0`, confirming `getSectionSizes` itself never reads `_resizeFactor`. The whole-file count is a coarser proxy that happens to also match JSDoc prose; recorded here rather than treated as a fixable deviation, since fixing it would mean omitting the very explanation the plan asked for.
- **`npm run docs:build`'s final `vitepress build docs` step was OOM-killed in the implementation sandbox** (a `NODE_OPTIONS=--max-old-space-size=12288` client+server bundle build against a 15 GiB host) — a sandbox resource ceiling, not a content problem. The preceding `docs:api` (TypeDoc) step, which is what actually validates the JSDoc this plan added, completed cleanly at **0 errors, 163 warnings** — exactly the pre-existing baseline, confirming zero new warnings from this plan's public JSDoc.
