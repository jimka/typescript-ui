---
touches-shared:
  - src/typescript/lib/layout/Accordion.ts
---

# Accordion Resize Weight — Implementation Plan

## Overview

`Accordion` in `resizable` mode rescales **every** open section proportionally when the container resizes, ignoring `fillWeight` entirely. `fillWeight` is honoured once — at the first layout, where [`computeResizableHeights:2146`](src/typescript/lib/layout/Accordion.ts#L2146) seeds `_resizeSizes` from `openContentHeight + fill` — and never again: [`distributeWithinConstraints:2180`](src/typescript/lib/layout/Accordion.ts#L2180) scales the stored px by a single `openBudget / storedTotal` factor and nothing consults a weight at resize time.

`Split` has the concept `Accordion` lacks: [`effectiveResizeWeight:379`](src/typescript/lib/layout/Split.ts#L379) resolves a pane's **container-resize** weight and the delta-distribution block in `recalculateSizes` consumes it, so `weight: 0` pins a pane's px. This plan gives `Accordion` the same concept by **reusing its existing weight constraint** — no second weight option — and **renames `fillWeight` to the inherited `weight`**, which `AccordionConstraints` already carries from [`LayoutConstraints:78`](src/typescript/lib/layout/LayoutConstraints.ts#L78).

Measured in the consuming app (sqladmin's `TreeExplorerView`: tree `fillWeight: 1`, inspector unweighted at preferred 220px), the inspector reads 219.4 / 164.7 / 109.9 at viewport heights 900 / 700 / 500 — a fixed 72.6%/27.4% ratio at every height instead of a held 220px. The design below was **implemented, run against the full suite (208 files / 2459 tests, all green), and reverted**; the bug and the fix were both reproduced offline in the `installTestDOM` harness (pre-fix the inspector reads 167.6 instead of 220).

---

## Architecture Decisions

### `weight` is resolved through one shared helper — the precedent is `Split.effectiveResizeWeight`

`Split` single-sources its weight resolution in `effectiveResizeWeight` and calls it from **both** the first-layout slack block and the container-resize delta block ([Split.ts:379](src/typescript/lib/layout/Split.ts#L379)). [`plans/split-weight-pin-refill.md`](plans/split-weight-pin-refill.md) reinforces this: it routes its new pin predicate through the same resolver *specifically* so the refill "can never disagree with the delta block again — which is the whole bug".

`Accordion` mirrors that exactly. The resolution currently inlined at [Accordion.ts:1986-1987](src/typescript/lib/layout/Accordion.ts#L1986) is extracted to a private `effectiveWeight(component)` and called from **both** `computeFill` (the seed/fill path, unchanged behaviour) and the new resize-pin tiering. Two readers, one resolver — the same shape, for the same reason.

### An unset weight means `0` — and `setFillHeight` is the existing opt-out

**This is the central decision.** `Accordion` reads `?? 0` today ([:1986](src/typescript/lib/layout/Accordion.ts#L1986)) and the public docs say so: *"`0`/omitted sits at preferred height"*. `Split` deliberately reads the **raw** constraint so an unset pane falls through to a proportional fallback, and its JSDoc calls this out explicitly ([Split.ts:370-372](src/typescript/lib/layout/Split.ts#L370)): *"unset is `undefined`, not the box managers' `?? 0`"*.

The two managers therefore **cannot** be symmetric on both the name and the unset semantics. **Accordion keeps `?? 0`** — it stays symmetric with `HBox`/`VBox` (*"unset is treated as `0` — no share"*, [LayoutConstraints:70](src/typescript/lib/layout/LayoutConstraints.ts#L70)) and **`Split` is the documented outlier**, which its own JSDoc already frames as such. Three managers read `?? 0`; one reads raw. That is the honest split, and the base `weight` doc is already a per-manager semantics table with room for a third entry.

Crucially, "unset → 0 → pinned" is **not** a naked pin: `effectiveWeight` resolves an unset weight to `1` when `setFillHeight` is on. So `setFillHeight(true)` is the already-existing, already-documented one-call escape hatch meaning "every open section is flexible". Nothing new is invented for the degenerate case.

### The all-unweighted degenerate case is byte-for-byte unchanged — the pin tiering does not engage

The stated risk was that "unset → pinned" makes an all-unweighted resizable accordion degenerate to all-pinned. **It does not**, because `resizePinnedSections` returns an empty array when **no** open section is weighted, so the whole open set falls through to today's proportional rescale unchanged. This mirrors [`split-weight-pin-refill.md`](plans/split-weight-pin-refill.md)'s finding that its all-weight-0 branch *"is exactly the uniform proportional rescale"* — the degenerate fill and the legacy rescale are the same arithmetic.

Measured blast radius across the whole repo — only a **mixed** accordion (at least one weighted **and** at least one unweighted open section, `fillHeight` off) changes behaviour:

| Site | Config | Effect |
|---|---|---|
| `Accordion.resizable.test.ts` fill-invariant / rescale / min-floor / collapse blocks | all unweighted | **no flexible mass → unchanged** |
| `Accordion.resizable.test.ts:354-355`, sqladmin `QueriesView.ts:136-137` | all weight `1` | **all flexible → unchanged** |
| `Accordion.resizable.test.ts:368+` | `setFillHeight(true)` | **all resolve to 1 → unchanged** |
| `AccordionDemoPanel.ts:99` | `singleOpen: true` **and** `setFillHeight(true)` | **never >1 open section; no gutters → unchanged** |
| sqladmin `ExplainDiagramPanel.ts:146` | mixed, but **not** `resizable` | **resizable-only change → unchanged** |
| sqladmin `treeExplorerView.ts:80` | **mixed + resizable** | **fixed** — the bug |

`AccordionDemoPanel` is the only demo accordion in `src/typescript/*DemoPanel.ts`. Verified empirically: the full suite passes with **zero test-assertion edits** (only the mechanical `fillWeight` → `weight` rename in test helpers).

### Rename `fillWeight` → the inherited `weight` — DECIDED, and it deletes a field rather than adding one

`AccordionConstraints extends LayoutConstraints`, which **already declares `weight?: number`** ([:78](src/typescript/lib/layout/LayoutConstraints.ts#L78)). So the rename is not "pick a nicer name" — it **deletes `AccordionConstraints.fillWeight` and uses the field the class already inherits**, making `getLayoutConstraints(x)?.weight` read identically in `Accordion`, `Split`, `HBox`, and `VBox`.

- **The name becomes honest.** Post-fix the constraint does the same double duty `Split`'s `weight` does (first-layout distribution **and** container-resize weight). `fillWeight` would name only half of it.
- **The base doc is already a per-manager table.** [`LayoutConstraints.weight`](src/typescript/lib/layout/LayoutConstraints.ts#L66) already reads *"read differently by two managers"* and documents HBox/VBox's `?? 0` against Split's raw read. Accordion becomes the third entry — extending an established pattern, not straining it.
- **Breaking renames have explicit precedent.** `docs/reference/changelog.md:26` carries a whole **"API naming harmonization (breaking — renamed methods, events, and classes)"** section (`getPerimiterSize` → `getPerimeterSize`, `Header` → `TableHeader`, event renames), including a standing bullet that *"Consumers of the built `dist/lib` (e.g. the `sqladmin` app) … will need the same rename pass"*. `docs/reference/migration.md` states the package is `0.0.0` pre-release with *"None"* compatibility — *"anything in a `0.x.y` release may change without a migration note"*. The cost of this rename is at its lifetime minimum.

`setFillHeight` / `isFillHeight` and the "fill mode" docs keep their names — fill mode is a distinct concept (the opt-in default weight), and renaming it is out of scope (see `## Non-Goals`).

### Pins hold their stored px; the weighted sections absorb the whole change

`Accordion` has no `_lastAvailableMain` twin and rescales stored → budget every layout, which is why the round trip is lossless (900 → 500 → 900 recovers exactly). That property is worth keeping, so the design **does not** adopt `Split`'s delta model and **does not** rewrite `_resizeSizes` on resize — the existing invariant that *"a drag is the only thing that changes the ratio itself"* ([:2088](src/typescript/lib/layout/Accordion.ts#L2088)) stands.

Instead the pinned sections are held at their stored px and removed from the budget **before** the existing proportional loop runs; the loop then divides the remainder across the weighted sections exactly as it does today. Consequence, stated deliberately: **at container-resize time a weight is a pin flag (`0` vs positive), not a ratio** — the weighted sections split the remainder in proportion to their *stored* sizes, not their weights, which is what preserves a drag-established ratio among them without any new state. Weight magnitude still governs the seed/fill split in `computeFill`.

### Pins yield when the budget cannot hold them

Gate: if the pinned total alone exceeds `openBudget`, `resizePinnedSections` returns empty and the whole set rescales proportionally. This mirrors `Split`'s documented contract ([Split.ts:335-337](src/typescript/lib/layout/Split.ts#L335)), quoted in [`split-weight-pin-refill.md`](plans/split-weight-pin-refill.md): *"pure pinning holds only while the container is large enough."* Accordion's yield is a proportional rescale of everything (rather than Split's flexible→0) because Accordion's clamp loop already floors each section at its min, which Split's refill has no equivalent of.

### A drag stays authoritative, and a weight-0 section is still draggable

Mirrors `Split`: **weight governs container resize, not drag.** `onGutterDrag` is untouched apart from its `_resizeSizes` write, so a pinned section drags normally. After a drag the pin holds whatever px the drag gave it — which is the correct reading of "pin", and it falls out for free rather than being special-cased.

The one required change is the stored-scale conversion at [:1753](src/typescript/lib/layout/Accordion.ts#L1753). `_resizeFactor` is documented as `rendered == stored × _resizeFactor` — a **single** scalar. With pins held at scale `1` and the weighted set at `_resizeFactor`, that is no longer global, so the drag must divide each section by *its own* scale. A new `_resizePinned` set records exactly which components the last `distributeWithinConstraints` held at scale 1; the drag reads it. Verified: this reproduces a drag exactly on the next layout (pinned `stored × 1 == rendered`; for the weighted set `Σrendered_f / (Σrendered_f / F) == F`, so each lands back on `rendered_f`).

---

## Public API

Renamed — **breaking**. No new options, setters, or events.

```typescript
// src/typescript/lib/layout/AccordionConstraints.ts
export class AccordionConstraints extends LayoutConstraints {
    label: string;
    initiallyOpen?: boolean;
    tools?: Component[];
    // fillWeight?: number;   ← DELETED; use the inherited LayoutConstraints.weight
}
```

```typescript
// src/typescript/lib/component/container/AccordionPanel.ts
export interface AccordionSectionConfig {
    label:          string;
    component:      Component;
    initiallyOpen?: boolean;
    glyph?:         string;
    tools?:         Component[];
    weight?:        number;   // was: fillWeight
}

class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Container<TOptions> {
    addSection(component: Component, label: string, initiallyOpen?: boolean, glyph?: string, tools?: Component[], weight?: number): this;   // 6th param renamed
}
```

**Reading and restoring a pinned section's size** (the downstream persistence question — this plan does **not** implement it): there is no public accessor for a section's px size on `master`. `_resizeSizes` is private with no getter, and the only public read is the section content component's own `getHeight()`. [`plans/layout-state-api.md`](plans/layout-state-api.md) owns adding `Accordion.getSectionRatios()` / `applySectionRatios()`; per the user's decision a weight-0 section must persist as **px**, not a ratio, so that plan's ratio surface is **not** sufficient for a pinned section and must grow a px-shaped path. This plan's contribution is the definition: **a section is resize-pinned iff `effectiveWeight(component) === 0`** — i.e. its `weight` constraint is unset or `0` *and* `setFillHeight` is off.

---

## Internal Structure

### New field, beside `_resizeFactor` ([Accordion.ts:192](src/typescript/lib/layout/Accordion.ts#L192))

```typescript
// The open sections distributeWithinConstraints last held at their stored px
// (scale 1) instead of scaling by _resizeFactor. Read by onGutterDrag, which
// must divide each dragged section's rendered height by its own stored scale —
// _resizeFactor is no longer one global scalar once a pin is held.
private _resizePinned: Set<Component> = new Set<Component>();
```

### `effectiveWeight` — replaces the inline resolution at [:1986-1987](src/typescript/lib/layout/Accordion.ts#L1986)

```typescript
/**
 * Resolves an open section's effective weight — its explicit `weight`
 * constraint, or a default of `1` when {@link setFillHeight} is on so every
 * unweighted open section counts equally. `0` means unweighted: the section
 * takes no share of the container's leftover height, and in resizable mode it
 * holds its px across a container resize instead of rescaling with the rest.
 *
 * Reads the constraint as `?? 0`, matching the box managers — unlike `Split`,
 * where an unset weight falls through to a proportional fallback.
 *
 * @param component - The open section's content component.
 * @returns The effective weight; `0` when the section is unweighted.
 */
private effectiveWeight(component: Component): number {
    const explicit = this.getLayoutConstraints(component)?.weight ?? 0;

    return explicit > 0 ? explicit : (this._fillHeight ? 1 : 0);
}
```

Note it reads `getLayoutConstraints(component)?.weight` — no `as AccordionConstraints` cast, because `weight` lives on the `LayoutConstraints` base.

### `resizePinnedSections` + `clampSectionHeight`, beside `fillHeadroom` ([:2017](src/typescript/lib/layout/Accordion.ts#L2017))

```typescript
/**
 * The open sections that hold their stored px across a container resize —
 * those with an effective weight of `0`, so only the weighted sections absorb
 * the change. Returns empty (so the whole open set rescales proportionally, as
 * it always has) in the two cases where pinning cannot apply: no open section
 * is weighted, so there is nothing to absorb the change; or the pins alone
 * overrun the budget, where a pin must yield because geometry has to fill the
 * container — mirroring `Split.setPaneResizeWeight`'s contract that a pin holds
 * only while the container is large enough.
 *
 * @param components - The container's content components, section-ordered.
 * @param openIndices - Indices of the open sections.
 * @param openBudget - The height available to the open sections' content.
 * @returns The pinned sections' indices, or an empty array.
 */
private resizePinnedSections(components: Component[], openIndices: number[], openBudget: number): number[] {
    const pinned: number[] = [];
    let flexible = 0;
    let pinnedTotal = 0;

    for (const i of openIndices) {
        if (this.effectiveWeight(components[i]) > 0) {
            flexible += 1;
        } else {
            pinned.push(i);
            pinnedTotal += this.clampSectionHeight(components[i], this._resizeSizes.get(components[i]) ?? 0);
        }
    }

    if (flexible === 0 || pinnedTotal > openBudget) {
        return [];
    }

    return pinned;
}

/**
 * Clamps a candidate content height to a section's `[min, max]`, so a pin is
 * held within the same bounds the proportional pass enforces.
 *
 * @param component - The open section's content component.
 * @param value - The candidate content height in px.
 * @returns The clamped content height.
 */
private clampSectionHeight(component: Component, value: number): number {
    const min = component.getMinSize();
    const max = component.getMaxSize();

    return Util.clamp(value, min ? min.height : 0, max ? max.height : Number.POSITIVE_INFINITY);
}
```

`Util.clamp` mirrors [`Split.clampMain:392`](src/typescript/lib/layout/Split.ts#L392). It requires a new `import { Util } from "~/core/Util.js";` in `Accordion.ts`.

### The pin block — inserted into `distributeWithinConstraints` ([:2180](src/typescript/lib/layout/Accordion.ts#L2180))

Goes **after** `let freeFactor = 1;` and **before** the `// At most one section is pinned per pass…` comment. The existing loop body is **not** touched: a pinned section is simply already out of `free` with its height already subtracted from `remaining`, which is precisely the shape the loop's own min/max pinning already uses.

```typescript
// Resize-pinned sections hold their stored px and leave the budget before the
// proportional pass, so only the weighted sections absorb a container resize.
// Empty unless the open set is mixed (some weighted, some not) — with no
// weighted section the whole set rescales proportionally, exactly as before.
this._resizePinned.clear();

for (const i of this.resizePinnedSections(components, openIndices, openBudget)) {
    const height = this.clampSectionHeight(components[i], this._resizeSizes.get(components[i]) ?? 0);

    heights.set(i, height);
    remaining -= height;
    free.delete(i);
    this._resizePinned.add(components[i]);
}
```

### The drag's stored-scale write — replaces [:1752-1753](src/typescript/lib/layout/Accordion.ts#L1752)

```typescript
const component = components[openIndices[pos]];
// A pinned section renders at its stored px (scale 1); every other open
// section renders at stored × _resizeFactor. Dividing by the wrong one
// silently rescales the whole open set on the next layout.
const scale = this._resizePinned.has(component) ? 1 : this._resizeFactor;

openHeightByIndex.set(openIndices[pos], newHeights[pos]);
this._resizeSizes.set(component, newHeights[pos] / scale);
```

---

## Ordered Implementation Steps

Work test-first: step 1 lands the failing regression test; steps 2-6 make it pass; step 7 is the rename.

1. **Add the failing regression test** to [tests/component/layout/Accordion.resizable.test.ts](tests/component/layout/Accordion.resizable.test.ts), in a new `describe('Accordion resizable — weight-0 sections hold their px on container resize', …)` block after the `rescale on container resize` block ([:145](tests/component/layout/Accordion.resizable.test.ts#L145)). Use `## Expected Behaviour` #1. → verify: `npx vitest run tests/component/layout/Accordion.resizable.test.ts` — **fails** with the inspector at ~167.6 instead of 220. Do not proceed until it fails for that reason.

2. **`Accordion.ts` — add the `Util` import** after the `DOM` import ([:14](src/typescript/lib/layout/Accordion.ts#L14)): `import { Util } from "~/core/Util.js";`

3. **`Accordion.ts` — add `_resizePinned`** directly below `_resizeFactor` ([:192](src/typescript/lib/layout/Accordion.ts#L192)), with the comment from `## Internal Structure`. A plain initializer, **not** `declare` — `Accordion` calls `applyOptions` from its constructor **body** after `super()` returns ([:224](src/typescript/lib/layout/Accordion.ts#L224)), so the cascade trap in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply.

4. **`Accordion.ts` — add `effectiveWeight`** immediately above `fillHeadroom` ([:2017](src/typescript/lib/layout/Accordion.ts#L2017)), then **replace** the two inline lines in `computeFill` ([:1984-1987](src/typescript/lib/layout/Accordion.ts#L1984)) — the `// Explicit fillWeight wins;…` comment, the `const explicit = …` line, and the `const weight = …` line — with the single line `const weight = this.effectiveWeight(components[i]);`. → verify: `npx vitest run tests/component/layout/Accordion.manager.test.ts` — still green (this step is a pure extraction; the fill tests pin it).

5. **`Accordion.ts` — add `resizePinnedSections` and `clampSectionHeight`** immediately after `effectiveWeight`, with the JSDoc from `## Internal Structure`.

6. **`Accordion.ts` — insert the pin block** into `distributeWithinConstraints` ([:2180](src/typescript/lib/layout/Accordion.ts#L2180)) and **replace the drag's stored-scale write** ([:1752-1753](src/typescript/lib/layout/Accordion.ts#L1752)), both per `## Internal Structure`.

   **Leave every other comment and block in `distributeWithinConstraints`, `computeResizableHeights`, `layoutSections`, and `onGutterDrag` exactly as they are** — they encode prior fixes and justify their own ordering. Do not reorder anything. Then extend the two JSDocs:
   - `distributeWithinConstraints` ([:2153-2179](src/typescript/lib/layout/Accordion.ts#L2153)) — after the *"Splits `openBudget` across the open sections in proportion to their stored sizes…"* opening sentence, add: *"An unweighted open section (effective weight `0`) is first held at its stored px and removed from the budget, so only the weighted sections absorb a container resize; the split falls back to rescaling the whole set when no section is weighted or the pins overrun the budget."*
   - The `_resizeFactor` field comment ([:185-192](src/typescript/lib/layout/Accordion.ts#L185)) — append: *"Applies to the weighted sections only; a resize-pinned section renders at scale 1 (see `_resizePinned`)."*

   → verify: the step-1 test passes; `npx vitest run tests/component/layout/` is green.

7. **The rename**, in this order:
   1. [AccordionConstraints.ts](src/typescript/lib/layout/AccordionConstraints.ts) — **delete** the `fillWeight?: number;` field and its whole JSDoc block ([:23-33](src/typescript/lib/layout/AccordionConstraints.ts#L23)). Add nothing: `weight` is inherited.
   2. [LayoutConstraints.ts](src/typescript/lib/layout/LayoutConstraints.ts) — extend the `weight` JSDoc ([:66-77](src/typescript/lib/layout/LayoutConstraints.ts#L66)). Change *"read differently by two managers"* to *"three managers"* and add, after the HBox/VBox sentence: *"[`Accordion`](/api/layout/classes/Accordion) reads it the same way (`?? 0`) as an open section's share of the container's leftover height, defaulting to `1` when `Accordion.setFillHeight` is on; under `Accordion.setResizable` a `0` section additionally holds its px across a container resize while the weighted sections absorb the change."*
   3. [AccordionPanel.ts](src/typescript/lib/component/container/AccordionPanel.ts) — rename `AccordionSectionConfig.fillWeight` → `weight` ([:31](src/typescript/lib/component/container/AccordionPanel.ts#L31)) and its JSDoc ([:25-30](src/typescript/lib/component/container/AccordionPanel.ts#L25)); `addSection`'s 6th param and its `@param` tag ([:123-133](src/typescript/lib/component/container/AccordionPanel.ts#L123)); the constructor's `addSection` call ([:106](src/typescript/lib/component/container/AccordionPanel.ts#L106)). Retarget both `{@link AccordionConstraints.fillWeight}` references to `{@link LayoutConstraints.weight}` — and **add `import { LayoutConstraints } from "~/layout/LayoutConstraints.js";`** if `{@link}` resolution needs it; if TypeDoc still warns, replace the link with prose per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) *Don't `{@link}` internal symbols*.
   4. Remaining `Accordion.ts` prose comments naming `fillWeight` ([:188](src/typescript/lib/layout/Accordion.ts#L188), [:524](src/typescript/lib/layout/Accordion.ts#L524), [:554](src/typescript/lib/layout/Accordion.ts#L554), [:1387](src/typescript/lib/layout/Accordion.ts#L1387), and the `computeFill` JSDoc at [:1938-1948](src/typescript/lib/layout/Accordion.ts#L1938)) → `weight`.
   5. Test helpers: the `constraints(label, open, fillWeight?)` signatures in [Accordion.manager.test.ts:42](tests/component/layout/Accordion.manager.test.ts#L42) and [Accordion.resizable.test.ts:48](tests/component/layout/Accordion.resizable.test.ts#L48), `oneOpen`'s param ([Accordion.manager.test.ts:238](tests/component/layout/Accordion.manager.test.ts#L238)), the `section()` helper ([AccordionPanel.test.ts:209](tests/component/container/AccordionPanel.test.ts#L209)), and the inline comments naming `fillWeight`. **Rename only — do not touch any assertion.**

   → verify: `grep -rn '\bfillWeight\b' src/ tests/ docs/ --include=*.ts --include=*.md | grep -v docs/api/` — expect matches **only** in `docs/reference/changelog.md`'s historical entries (see step 8).

8. **Docs** — [docs/layouts/Accordion.md](docs/layouts/Accordion.md) (`fillWeight` at :49, :107, :109; the resizable-sections paragraph at :121) and a new `docs/reference/changelog.md` entry. Details in `## Documentation Impact`. **Do not hand-edit `docs/api/**`** — it is generated.

9. **Full suite:** `npx vitest run` — 208 files / 2459 tests, all green. *(Use `npx vitest run`, not `npm test`: `npm test` gates on `typecheck:test`, which fails on master with two pre-existing `leaves.smoke.test.ts` errors unrelated to this work.)*

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/Accordion.ts` |
| Modify | `src/typescript/lib/layout/AccordionConstraints.ts` |
| Modify | `src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` |
| Modify | `tests/component/layout/Accordion.resizable.test.ts` |
| Modify | `tests/component/layout/Accordion.manager.test.ts` |
| Modify | `tests/component/container/AccordionPanel.test.ts` |
| Modify | `docs/layouts/Accordion.md` |
| Modify | `docs/reference/changelog.md` |

---

## Expected Behaviour

All cases are **unit-testable** offline. Follow the file's existing idiom: `installTestDOM(CONFIG)`, `afterEach(() => DOM.reset())`, the `hostAccordion` / `content` / `constraints` fixtures, and `HEADER = 30`. Drag cases drive the private handlers directly (`(acc as any).onGutterDragStart(0, y)`), as the existing drag tests do.

1. **The regression — a weight-0 section holds its px across viewport resizes.** The sqladmin `TreeExplorerView` shape: host 300 wide, `tree` preferred/min height 96 with `weight: 1`; `insp` preferred 220, min 50, **no weight**. At host heights 900 → 700 → 500 → 900, one `doLayout()` each: `insp.getHeight()` must be **exactly 220** at every height, and `tree + insp` must equal `height − 2 × HEADER` at every height. *(Verified pre-fix: 220 → 167.6 → 115.2; verified post-fix: 220 at all four.)*

2. **Drag stays authoritative, and the pin then holds the dragged px.** Same fixture at host height 900. `onGutterDragStart(0, 500)`, `onGutterDrag(0, 400)` (drag up 100), `onGutterDragEnd()` → `insp` is 320 (the drag moved it despite weight 0 — weight governs container resize, not drag). Then `setHeight(700)` + `doLayout()` → `insp` is still **exactly 320**, and `tree + insp` equals `700 − 2 × HEADER`. *(Verified pre-fix: 243.8; post-fix: 320.)*

3. **The all-unweighted degenerate case is unchanged.** [Accordion.resizable.test.ts:124](tests/component/layout/Accordion.resizable.test.ts#L124) (`open heights rescale proportionally, preserving the seeded ratio`, both sections unweighted) and the whole `fill invariant` block ([:95-121](tests/component/layout/Accordion.resizable.test.ts#L95), all sections unweighted) must pass **unmodified** apart from the mechanical helper rename. No test assertion may be relaxed — if one needs to be, the design was misapplied.

4. **`setFillHeight` makes every section flexible.** Same fixture as #1 but `acc.setFillHeight(true)`: `insp` must **not** hold 220 — it rescales proportionally with `tree`, because `effectiveWeight` resolves its unset weight to `1`. This is the documented opt-out and the guard against the `?? 0` read being applied where `fillHeight` should win.

5. **All-weighted is unchanged.** Two open sections both `weight: 1`, host 400 → 200: heights rescale proportionally and sum to the budget. Nothing pins.

6. **A pin yields when the budget cannot hold it.** Fixture #1 shrunk to host height 200 (budget 140 < the 220 pin): the pins yield and the whole set rescales, so `tree + insp` still equals `200 − 2 × HEADER` and `tree.getHeight()` is at least its 96 min. Asserts the `pinnedTotal > openBudget` gate.

7. **Section toggle and reopen are undisturbed.** [Accordion.resizable.test.ts:165](tests/component/layout/Accordion.resizable.test.ts#L165) (`closing a section rescales the others and retains its stored size for reopen`) must pass **unmodified**. Add a mixed-weight case: fixture #1 plus a third `weight: 1` section; close the **pinned** `insp`, `doLayout()`, reopen it, `doLayout()` → `insp` is back at 220 (its closed `_resizeSizes` entry stays frozen and untouched by the pin block, which only visits open indices).

8. **A pin is clamped to its own min/max.** Fixture #1 with `insp.setMaxSize(0, 150)`: the pin is held at **150**, not its 220 stored size, and the weighted `tree` takes the rest. Asserts `clampSectionHeight` is applied to the pin, not just to the proportional pass.

---

## Verification

- `npx vitest run tests/component/layout/Accordion.resizable.test.ts tests/component/layout/Accordion.manager.test.ts tests/component/container/AccordionPanel.test.ts` — 79 existing tests plus the new ones. **No existing assertion is edited** (helper renames only).
- `npx vitest run` — full suite, **208 files / 2459 tests**. This design was validated against it with zero failures.
- `npx tsc --noEmit -p .` — no **new** errors. Pre-existing on master and to be ignored: `AccordionDemoPanel.ts(282)` `fontWeight`, `tests/component/container/leaves.smoke.test.ts(127-128)`, `DiagramView.test.ts` unused vars, `OnFirstLayout.test.ts` unused import, and the `vite*.config.ts` `@types/node` errors.
- `npx eslint src/typescript/lib/layout/Accordion.ts src/typescript/lib/layout/AccordionConstraints.ts src/typescript/lib/component/container/AccordionPanel.ts` — clean.
- `grep -rn '\bfillWeight\b' src/ tests/ docs/ --include=*.ts --include=*.md | grep -v docs/api/` — matches only in `docs/reference/changelog.md`'s historical entries.
- `grep -n '_resizeFactor' src/typescript/lib/layout/Accordion.ts` — the field, its two writes/reads in `distributeWithinConstraints`, and exactly **one** read in `onGutterDrag`, guarded by `_resizePinned`.
- `npm run docs:build` — must finish with **zero warnings** (public JSDoc changed on `LayoutConstraints.weight`, `AccordionConstraints`, and `AccordionPanel`). This regenerates `docs/api/**`.
- **Manual verify** (the harness cannot drive real pointer events or a real viewport resize): in the demo app, `AccordionDemoPanel` — toggle `Resizable: ON`, `Single-open: OFF`, `Fill: OFF`, open several sections, drag a gutter, then resize the browser window. Every section rescales proportionally (the demo sets no per-section weight, so nothing pins) and the dragged ratio is preserved. This is the degenerate-path smoke test — the mixed path has no demo (see `## Non-Goals`).

---

## Documentation Impact

The renamed constraint is public API on two export surfaces: `AccordionConstraints` / `LayoutConstraints` via `src/typescript/lib/layout/index.ts`, and `AccordionSectionConfig` / `AccordionPanel` via `src/typescript/lib/component/container/index.ts`. No barrel changes — no symbol is added or removed from an export, only a field renamed.

- **[`docs/layouts/Accordion.md`](docs/layouts/Accordion.md)** — the doc page for this manager.
  - `:49` — the `fillHeight` options-table row: *"sharing it by `fillWeight`"* → *"sharing it by `weight`"*.
  - `:107` — the *Fill mode* paragraph: retarget `[`fillWeight`](/api/layout/classes/AccordionConstraints#fillweight)` → `[`weight`](/api/layout/classes/LayoutConstraints#weight)` (the field moved to the base class, so the API link target changes too).
  - `:109` — same rename in the *"`fillWeight` can also be set without `fillHeight`"* sentence.
  - `:121` — the *Resizable sections* paragraph. Rename, **and correct the now-false claim**: it currently ends *"and rescales proportionally when the container is resized."* Replace that clause with: *"On a container resize only the weighted sections absorb the change — an unweighted section (`weight` unset or `0`, with `fillHeight` off) holds its px, so a section sized to its content stays at that size as the viewport grows and shrinks. With no weighted section, or when the pinned sections alone would overrun the container, the whole open set rescales proportionally as before. A gutter drag is unaffected: an unweighted section still drags freely, and the pin then holds whatever px the drag gave it."*
  - Add a `weight` row to the [Constraints](docs/layouts/Accordion.md) table if one exists for `AccordionConstraints` — check at implementation time; `fillWeight` had no dedicated section beyond the prose above.
- **[`docs/reference/changelog.md`](docs/reference/changelog.md)** — two entries under `## Unreleased (pre-1.0)`:
  1. Extend the existing **"API naming harmonization (breaking — renamed methods, events, and classes; no behaviour change)"** section (`:26`) with a bullet: *"**`AccordionConstraints.fillWeight` is renamed to the inherited [`LayoutConstraints.weight`](/api/layout/classes/LayoutConstraints#weight)** (and `AccordionSectionConfig.fillWeight` → `weight`, plus `AccordionPanel.addSection`'s 6th parameter). `AccordionConstraints` already inherited `weight` from its base, so the field is removed rather than renamed in place — `Accordion` now reads the same constraint `HBox`/`VBox`/`Split` do. Same semantics for fill; see the behaviour entry below for the resize half."* The section's standing *"Consumers of the built `dist/lib` (e.g. the `sqladmin` app) … will need the same rename pass"* bullet already covers the app.
  2. A new bullet in the existing **"Accordion resizable sections and weighted fill"** section (`:14`): *"**A resizable `Accordion` now honours `weight` on container resize (behaviour fix).** Previously every open section rescaled proportionally when the container resized, so a section left at its preferred height drifted with the viewport and `weight` was honoured only on the first layout. An open section with an effective weight of `0` — `weight` unset or `0`, with [`setFillHeight`](/api/layout/classes/Accordion#setfillheight) off — now holds its px and the weighted sections absorb the whole change, matching how [`Split`](/api/layout/classes/Split) has always read `weight: 0`. An accordion with no weighted open section, and one whose pinned sections alone overrun the container, rescale proportionally exactly as before; `setFillHeight(true)` opts every section back into rescaling. A gutter drag is unchanged and stays authoritative."*
- **`docs/api/**`** — regenerated by `npm run docs:build`. **Never hand-edited.** The build must finish with zero warnings; `LayoutConstraints.weight`, `AccordionConstraints`, and `AccordionPanel.addSection` all have public JSDoc changes, and every `{@link}` must resolve to a symbol that appears in the public docs per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).
- **[`docs/reference/migration.md`](docs/reference/migration.md)** — **no change.** It states the framework is `0.0.0` with *"Pre-1.0 compatibility: None"* and that the page starts tracking only once `1.0.0` ships.

---

## Potential Challenges

- **Collision with [`plans/layout-state-api.md`](plans/layout-state-api.md) — semantic, not textual. THIS PLAN SHOULD LAND FIRST.** That plan inserts an `applyPendingSectionRatios` drain into `computeResizableHeights`, between `const openBudget = …` ([:2140](src/typescript/lib/layout/Accordion.ts#L2140)) and the seed loop. **This plan does not touch `computeResizableHeights`'s body at all** — its changes are in `distributeWithinConstraints` and `onGutterDrag` — so there is no textual conflict at the insertion point. The real conflict is a **claim**: that plan's decision *"Accordion's `_resizeFactor` is dissolved by normalising"* rests on `_resizeFactor` being *"one scalar applied to the whole set"* so that `stored_i / Σstored == rendered_i / Σrendered`. This plan makes that false for a mixed open set — a pin renders at scale 1 while the weighted set renders at `_resizeFactor` — so `getSectionRatios`' stored ratios no longer equal the rendered ratios. Landing this first means that plan is written against the true model; landing it second means silently shipping a broken ratio-capture decision. It also aligns with the user's downstream decision that pinned sections persist as **px, not ratios** — which requires this plan's definition of "pinned" to exist first. Mitigation: implement this plan, then revise `layout-state-api.md`'s `_resizeFactor` decision before implementing it.
- **The rename breaks the consuming app (sqladmin) at three call sites** — [`frontend/src/shell/treeExplorerView.ts:80`](../../sqladmin/frontend/src/shell/treeExplorerView.ts#L80), [`frontend/src/shell/QueriesView.ts:136-137`](../../sqladmin/frontend/src/shell/QueriesView.ts#L136), [`frontend/src/dock/ExplainDiagramPanel.ts:146-147`](../../sqladmin/frontend/src/dock/ExplainDiagramPanel.ts#L146) — all passing `fillWeight:` in an `AccordionSectionConfig`. Each is a one-word change to `weight:`, caught by `tsc` (the field is not in the interface, so it is a hard error, not a silent drop). sqladmin consumes the built `dist/lib`, so the app breaks only after `npm run build:lib`. The changelog already carries a standing bullet for exactly this class of break. **This plan does not edit the app** — the app owns its own plans.
- **sqladmin's `TreeExplorerView` needs no behaviour change** — its inspector already **omits** `fillWeight`, so it pins for free and the fix delivers its stated intent (*"the tree seeds at fill, the inspector at its preferred 220px"*) verbatim. Its sibling `QueriesView` (both sections `weight: 1`) and `ExplainDiagramPanel` (mixed, but **not** resizable) are behaviourally untouched. Mitigation: none needed — flagged so the rename pass is not mistaken for a behaviour port.
- **The `?? 0` vs raw-constraint read is the whole design, and it is invisible if reversed.** Reading the constraint raw (Split's way) would make no section ever pin and the bug would persist silently with every test still green. Mitigation: Expected Behaviour #1 fails loudly; the `effectiveWeight` JSDoc states the divergence from `Split` and why.
- **`_resizeFactor` is no longer a single global scalar.** Dividing a pinned section's dragged height by `_resizeFactor` (the old line) rescales the whole open set on the next layout — the exact failure the field's own comment warns about. Mitigation: `_resizePinned` is populated in the same block that holds the pins, so the two cannot drift; Expected Behaviour #2 is the guard.
- **An over-constrained mixed accordion can still overflow** — pin 220 + a weighted section whose min exceeds the remainder sums past the budget. The gate only catches `pinnedTotal > openBudget`, not `pinnedTotal + Σmin > openBudget`. This is deliberate and matches [ARCHITECTURE.md](ARCHITECTURE.md) *Size constraints* rule 7 and [`split-weight-pin-refill.md`](plans/split-weight-pin-refill.md)'s *"Over-constrained containers stay the component's problem"*: the manager assigns the space and the component's own `clampHeight` backstops the display. Do not add a min-aware gate — it introduces hysteresis and diverges from `Split`.

---

## Critical Files

- [`src/typescript/lib/layout/Accordion.ts`](src/typescript/lib/layout/Accordion.ts) — `_resizeSizes` (:184), `_resizeFactor` (:185-192), `setFillHeight` (:521-540), `setResizable` (:551-569), `doLayout`'s fill/resize call chain (:1381-1423), `layoutSections` (:1426-1446), `onGutterDrag` (:1647-1769), `computeFill` (:1932-2006), `computeResizableHeights` (:2081-2151), `distributeWithinConstraints` (:2153-2243). **Read every comment in the last four before editing** — they encode prior fixes and justify their own ordering.
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — the precedent: `setPaneResizeWeight` and its pin contract (:326-351), `effectiveResizeWeight` and its raw-constraint JSDoc (:365-381), `clampMain` (:392-399), `isPinnedMain` (:401-418).
- [`src/typescript/lib/layout/LayoutConstraints.ts`](src/typescript/lib/layout/LayoutConstraints.ts) — the `weight` field and its per-manager doc table (:66-78). The rename's target; `AccordionConstraints` already inherits it.
- [`plans/split-weight-pin-refill.md`](plans/split-weight-pin-refill.md) — the `Split` analog of this bug. Establishes the pin vocabulary (hard `min == max` vs soft weight-0), that the two must not be merged, and that an all-pinned set degenerates to the uniform proportional rescale. Read before designing anything here.
- [`plans/layout-state-api.md`](plans/layout-state-api.md) — its `_resizeFactor` decision (:43-50) is invalidated by this plan; see `## Potential Challenges`. Do not implement any of it here.
- [`tests/component/layout/Accordion.resizable.test.ts`](tests/component/layout/Accordion.resizable.test.ts) — the harness idiom (`CONFIG`, `HEADER`, `hostAccordion`, `content`, `constraints`, `DOM.reset()`) and the fill-invariant / rescale / collapse blocks the change must keep green.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Size constraints: who is responsible for what*, rules 1/6/7 and the manager-vs-component clamp split.

---

## Non-Goals

- **A second, separate resize-weight option.** The user's decision, and the design vindicates it: `weight` carries both duties exactly as `Split`'s does.
- **Renaming `setFillHeight` / `isFillHeight` / the "fill mode" docs.** Fill mode is a distinct concept (the opt-in default weight) and is not what this bug is about.
- **Honouring weight *magnitude* at container-resize time.** At resize a weight is a pin flag; the weighted sections split the remainder by their stored sizes, which preserves a drag-established ratio with no new state. Magnitude still governs the seed/fill split.
- **Adopting `Split`'s delta-distribution model** (`stored + delta × w/wSum` against a `_lastAvailableMain`). Accordion's rescale-to-budget model is idempotent and makes the resize round trip lossless; the fix does not need a delta.
- **A public accessor for `_resizeSizes`, or ratio/px persistence.** Owned by [`plans/layout-state-api.md`](plans/layout-state-api.md) and sqladmin's `plans/layout-persistence.md`. This plan only defines what "pinned" means.
- **Editing the consuming app.** sqladmin's rename pass is its own repo's work.
- **A demo for the mixed-weight path.** `AccordionDemoPanel` is `singleOpen` + `fillHeight`, so it cannot exercise a pin; adding a section-weight demo control is scope creep on an unrelated panel.
- **Fixing the pre-existing `leaves.smoke.test.ts` typecheck errors** that block `npm test` on master. Unrelated (`MenuItem`), and outside this change's blast radius.
- **Refactoring the min/max clamp loop** in `distributeWithinConstraints`. The pin block is inserted before it and reuses its exact shape; the loop body stays byte-for-byte.
