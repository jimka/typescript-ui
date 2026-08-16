---
touches-shared: [packages/lib/src/typescript/lib/core/DOM.ts, packages/lib/src/typescript/lib/core/Util.ts, packages/lib/src/typescript/lib/core/index.ts, packages/lib/src/typescript/lib/component/input/Text.ts, packages/lib/tests/dom/TestDOM.ts]
---

# Batched Text Measurement — Implementation Plan

## Overview

[`Text.calculateSize()`](packages/lib/src/typescript/lib/component/input/Text.ts#L326) measures its string through [`DOM.source.measureText`](packages/lib/src/typescript/lib/core/DOM.ts#L1964), which appends a probe `<span>` to the document, reads its rectangle, and removes it. The read follows a write with nothing in between, so each call forces the browser to lay the whole document out again. When many `Text` instances go stale together — the common case, described below — the application pays one forced layout per instance.

This plan adds a batched measurement path. A new read-seam method, `DOM.source.measureTexts`, puts one probe per string into a single wrapper element, appends the wrapper once, reads every rectangle, and removes it once — one forced layout for the whole group. `Text` gains a module-level registry of live instances; the first stale `Text` that anyone asks for a size measures **every** stale `Text` through that one call, so the rest of the group is served from cache.

Two situations produce these groups.[^bursts] A **theme reflow** — [`ThemeManager.reflowText()`](packages/lib/src/typescript/lib/core/Theme.ts#L1419) marking every text metric stale and notifying every subscriber — is the largest. A **construction or layout pass** is the other: a container's `getPreferredSize()` recursion reaches each newly built text-bearing child in turn. On the library's own demo application, startup issues **228** separate `measureText` probes in 21 groups, the largest of them 98 probes back to back, costing 39 ms of forced-reflow time.[^startup-measurement]

No call site changes. `getPreferredSize()`, `getMinSize()`, `getBaseline()` and `measure()` keep returning a value synchronously, from the same call, as they do today.

---

## Architecture Decisions

### The batch runs inside `calculateSize`, triggered by the first stale `Text`

`calculateSize()` checks whether this `Text` is about to probe; if so it first measures every stale `Text` in one batched call, then re-checks its own staleness and returns early when the batch already covered it. Nothing becomes asynchronous and no caller is modified.[^why-self-triggering]

### No external flush call, and no changes to the table

Nothing in `VirtualRowView`, `Body`, `ThemeManager` or `flushPendingLayouts` is touched. The trigger above needs no cooperation from the code that creates the group.[^no-flush-site]

### One probe element per string carries its own font styles — no grouping

[`measureTextWidths`](packages/lib/src/typescript/lib/core/DOM.ts#L2016) takes a single shared options bag for every string and returns widths only. The new `measureTexts` instead takes one `{ text, options }` request per string and returns a full `TextMetrics` each, because [`calculateSize`](packages/lib/src/typescript/lib/component/input/Text.ts#L326) needs the width, the height *and* the baseline. Per-string font styles are written onto that string's own probe, so a batch mixing fonts needs no grouping pass.[^per-item-options]

The probes are laid out as `display: inline-block` inside the wrapper. That is load-bearing, not cosmetic:

| Probe shape | `"Show window with wide table (45 columns)!"` at 14 px | `"gjpqy Ay"` at Georgia 22 px italic small-caps, 40 px line-height |
|---|---|---|
| Today's standalone probe (`position: fixed`) | 281 × 16, baseline 13 | 91 × 40, baseline 28 |
| In-wrapper, `display: inline-block` | 281 × 16, baseline 13 | 91 × 40, baseline 28 |
| In-wrapper, plain inline | 281 × **19**, baseline **15** | 91 × **26**, baseline **21** |

### The registry is a module-level set of `WeakRef`s in `Text.ts`

`Text.ts` gains `const _measurableRefs: Set<WeakRef<Text>>`, mirroring [`Glyph.ts:46`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L46), which keeps exactly this kind of iterable registry of live component instances and prunes dead entries as it walks. A `Text` adds itself in its constructor, removes itself in `destructor()`, and the batch prunes any reference whose target the collector already took.[^registry-shape]

### Both measurement paths share one method that writes the staleness flags

The body that turns a natural measurement into preferred size, baseline and minimum floor moves into a new private `applyNaturalMetrics`, which also clears `_measurementDirty` and stamps `_measuredGeneration`. The solo path and the batched path both end there, so a batched participant lands in exactly the state a solo `calculateSize()` would have left it in.[^staleness]

---

## Public API

`packages/lib/src/typescript/lib/core/Util.ts` — new exported interface:

```typescript
/**
 * One string to measure, with the font properties to measure it under.
 */
export interface TextMeasureRequest {
    text: string;
    options?: TextMeasureOptions;
}
```

`packages/lib/src/typescript/lib/core/DOM.ts` — new required `DOMSource` member:

```typescript
/**
 * Measures many strings, each under its own font, in a single document reflow.
 *
 * @param requests - The strings to measure, each with its own font properties.
 * @returns One `TextMetrics` per request, in request order; an empty request
 *   list touches the DOM not at all and returns an empty array.
 */
measureTexts(requests: TextMeasureRequest[]): TextMetrics[];
```

Implemented by `ProductionDOMSource` and by the test harness's `ModelledDOMSource`.

The `Text` **class** gains no public member — the registry field, `wantsBatchedMeasure`, `batchMeasure` and `applyNaturalMetrics` are all private, and the new `destructor` override is protected. `Text.ts` does gain two module-level `@internal` exports for the test harness, mirroring `BorderWidths.ts`'s pair:

```typescript
export function _resetTextMeasurementRegistry(): void;
export function _textMeasurementRegistrySize(): number;
```

---

## Internal Structure

`Text.ts`, module scope — beside the existing `_defaultTextOptions`:

```typescript
/**
 * Registry of `WeakRef<Text>` for every live instance, walked by the batched
 * measurement below so one DOM flush can serve every stale Text at once.
 * `WeakRef` keeps an undisposed Text collectable; dead references are pruned
 * as the walk finds them. Mirrors `Glyph.ts`'s animated-instance registry.
 */
const _measurableRefs: Set<WeakRef<Text>> = new Set();

// Guards against a nested batch: the wrap-aware re-measure inside
// `applyNaturalMetrics` probes the DOM again, and must not restart the walk.
let _batching = false;
```

`Text`, private members:

```typescript
// Registered in the constructor, dropped in destructor(). Held so teardown
// can remove this exact entry rather than searching the set.
private readonly _measureRef: WeakRef<Text> = new WeakRef(this);

/** Whether this Text would issue its own natural-measurement probe now. */
private wantsBatchedMeasure(): boolean {
    return this._autoMeasure && this.needsMeasure() && !!this._options.text;
}

/**
 * Measures `initiator` together with every other stale Text in one DOM flush.
 * A `private static` (rather than a module function) so it can read the other
 * instances' private `measureOptions()` and `_options`.
 */
private static batchMeasure(initiator: Text): void { /* see step 6 */ }

/**
 * Folds a natural (single-line) measurement into preferred size, baseline and
 * minimum floor, and marks this Text measured. The tail of the old
 * `calculateSize` body, shared by the solo and batched paths.
 */
private applyNaturalMetrics(natural: TextMetrics): void { /* see step 5 */ }
```

---

## Ordered Implementation Steps

1. **Add `TextMeasureRequest` to `packages/lib/src/typescript/lib/core/Util.ts`**, immediately after the existing [`TextMetrics`](packages/lib/src/typescript/lib/core/Util.ts#L33) interface, with the shape under `## Public API`. Do not add a `Util.measureTexts` wrapper — `Text` calls `DOM.source` directly, as it already does for `measureText`.

2. **Export the new type** from `packages/lib/src/typescript/lib/core/index.ts`, extending the existing line 12 to `export type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from '~/core/Util.js';`.

3. **Declare `measureTexts` on the `DOMSource` interface** in `packages/lib/src/typescript/lib/core/DOM.ts`, directly below the [`measureTextWidths` declaration at line 998](packages/lib/src/typescript/lib/core/DOM.ts#L998), with the JSDoc under `## Public API`. Add `TextMeasureRequest` to the existing `import type { TextMeasureOptions, TextMetrics } from "~/core/Util.js";` at the top of the file.

4. **Implement `ProductionDOMSource.measureTexts`** directly below [`measureTextWidths` at line 2016](packages/lib/src/typescript/lib/core/DOM.ts#L2016). Return `[]` for an empty request list without touching the DOM. Otherwise build one wrapper `<div>` styled `{ position: "fixed", visibility: "hidden", whiteSpace: "nowrap" }`; for each request, resolve its options through the **same defaults `measureText` uses** (`fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontVariant`, `fontStretch`, `lineHeight`, `maxWidth`) and build a probe `<span>` styled:

   ```typescript
   {
       display:    "inline-block",
       whiteSpace: maxWidth === undefined ? "nowrap" : "pre-wrap",
       width:      maxWidth === undefined ? "" : `${maxWidth}px`,
       fontFamily, fontSize, fontWeight, fontStyle, fontVariant, fontStretch, lineHeight,
   }
   ```

   Set `probe.textContent`, append the zero-size baseline reference `<span>` (`{ display: "inline-block", width: "0", height: "0", verticalAlign: "baseline" }`) inside it exactly as `measureText` does, and append the probe to the wrapper. Append the wrapper to `document.body` **once**, then map over the probes reading `probe.getBoundingClientRect()` and `ref.getBoundingClientRect()` and returning `{ width: Math.ceil(...), height: Math.ceil(...), baseline: Math.round(refTop - probeTop) }`. Remove the wrapper once. Reuse `_applyProbeStyles` for every style write and carry `measureTextWidths`'s "One layout flush" comment. **Do not insert separators between probes** — no `<br>`, no wrapper-per-probe.

5. **Extract `applyNaturalMetrics`.** Steps 5 to 8 all edit `packages/lib/src/typescript/lib/component/input/Text.ts`, ordered so the file typechecks after each one. Move the whole `if (text) { … }` branch body of `calculateSize` into a new private `applyNaturalMetrics(natural: TextMetrics): void` that starts by writing the two staleness fields, then runs the existing arithmetic unchanged:

   ```typescript
   private applyNaturalMetrics(natural: TextMetrics): void {
       this._measurementDirty   = false;
       this._measuredGeneration = Util.textMetricsGeneration();

       const text          = this._options.text!.toString();
       const minLineHeight = Math.ceil(this.getLineHeight() ?? this.readThemeLineHeightPx());
       const height        = this.measuredHeight(text, natural.width, natural.height);

       this._measuredBaseline = natural.baseline;
       this.setCalculatedSize(natural.width, height);

       const autoMinWidth = this.isTruncate()
           ? Math.min(natural.width, TEXT_AUTO_MIN_WIDTH_CAP_PX)
           : natural.width;

       this._measuredMinSize = {
           width:  autoMinWidth,
           height: Math.max(height, minLineHeight),
       };
   }
   ```

   Keep the existing explanatory comments with the lines they explain. `calculateSize` keeps its two staleness writes and its `!this._autoMeasure` early return, and its `if (text)` branch becomes the single line:

   ```typescript
   this.applyNaturalMetrics(DOM.source.measureText(text.toString(), this.measureOptions()));
   ```

   The `else` (empty-text) branch is unchanged. Note the `minLineHeight` local moves *into* `applyNaturalMetrics`; the empty-text branch never used it. At the end of this step the behaviour is identical to before it.

6. **Add `wantsBatchedMeasure` and `batchMeasure`** to `Text`. Nothing calls either yet — step 8 wires them in.

   ```typescript
   private static batchMeasure(initiator: Text): void {
       if (_batching) {
           return;
       }

       const pending: Text[] = [initiator];

       for (const ref of Array.from(_measurableRefs)) {
           const candidate = ref.deref();

           if (!candidate) {
               _measurableRefs.delete(ref);
               continue;
           }

           if (candidate !== initiator && candidate.wantsBatchedMeasure()) {
               pending.push(candidate);
           }
       }

       // Only the initiator is stale — batching would cost a wrapper element
       // to save nothing. Fall through to its own single probe.
       if (pending.length < 2) {
           return;
       }

       _batching = true;

       try {
           const metrics = DOM.source.measureTexts(
               pending.map(participant => ({
                   text:    participant._options.text!.toString(),
                   options: participant.measureOptions(),
               })),
           );

           pending.forEach((participant, i) => participant.applyNaturalMetrics(metrics[i]));
       } finally {
           _batching = false;
       }
   }
   ```

   Build **every** request before issuing the call — a `measureOptions()` that resolves a bound font-size var can itself probe the DOM, and those probes must all land before the batched read, not between its rectangle reads.

   Typing note: `Text` is generic (`Text<TOptions extends TextOptions = TextOptions>`), and `pending`, `initiator` and the registry are all typed with the bare `Text`. A `Text<LinkOptions>` is assignable to `Text<TextOptions>`, the same way `Component<TOptions>` is assignable to the bare `Component` that `Component.ts`'s own module-level `pendingLayouts: Set<Component>` holds. No `any` and no cast is needed anywhere in these steps.

7. **Register and deregister the instance.** Add the `_measureRef` field with its plain initializer (it is never written during the `super()` cascade, so it needs no `declare`), add `_measurableRefs.add(this._measureRef);` to the end of the `Text` constructor body, and add a `destructor` override:

   ```typescript
   protected destructor(): void {
       _measurableRefs.delete(this._measureRef);
       super.destructor();
   }
   ```

8. **Wire the batch into `calculateSize`.** Add the guard at the very top, above the two staleness writes:

   ```typescript
   private calculateSize(): void {
       if (this.wantsBatchedMeasure()) {
           Text.batchMeasure(this);

           // The batch measured this Text — it is no longer stale, and
           // `applyNaturalMetrics` already wrote every derived field.
           if (!this.needsMeasure()) {
               return;
           }
       }

       // … the rest of the method, unchanged from step 5
   }
   ```

9. **Add the test-harness reset** to `Text.ts`, mirroring `BorderWidths.ts`'s pair:

   ```typescript
   /** Empties the measurement registry. For the test harness only. @internal */
   export function _resetTextMeasurementRegistry(): void { _measurableRefs.clear(); }

   /** Number of registered instances; for tests only. @internal */
   export function _textMeasurementRegistrySize(): number { return _measurableRefs.size; }
   ```

   Export both from the same `export { … }` block that already exports `_Text` and `Text`.

10. **Implement `ModelledDOMSource.measureTexts`** in `packages/lib/tests/dom/TestDOM.ts`, directly below [`measureTextWidths` at line 1006](packages/lib/tests/dom/TestDOM.ts#L1006):

    ```typescript
    measureTexts(requests: TextMeasureRequest[]): TextMetrics[] {
        return requests.map(r => this.measureText(r.text, r.options));
    }
    ```

11. **Clear the registry from `installTestDOM`** ([`TestDOM.ts:1431`](packages/lib/tests/dom/TestDOM.ts#L1431)), beside the existing `clearBorderWidths()` call, so one test file's cases cannot drag a previous case's `Text` instances into a batch.

12. **Checkpoint.** From `packages/lib`:
    - `grep -n 'DOM.source.measureText(' src/typescript/lib/component/input/Text.ts` — expect exactly two matches (the solo path in `calculateSize`, and the wrap re-measure in `measuredHeight`).
    - `grep -rn 'measureTexts' src/typescript/ tests/` — expect matches only in `core/DOM.ts`, `component/input/Text.ts` and `tests/dom/TestDOM.ts`.
    - `npm run typecheck`.

13. **Add `packages/lib/tests/component/TextBatchMeasure.test.ts`** covering the unit-testable rows in `## Expected Behaviour`. Follow [`tests/core/BorderWidths.test.ts`](packages/lib/tests/core/BorderWidths.test.ts): `installTestDOM` in `beforeEach`, `DOM.reset()` in `afterEach`, and a counting source installed with `DOM.install({ source: Object.create(DOM.source, { … }) })` wrapping both `measureText` and `measureTexts`.

14. **Update the two documentation pages** named in `## Documentation Impact`.

15. **Run everything in `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/component/TextBatchMeasure.test.ts` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable offline, with a counting source wrapping `measureText` and `measureTexts`:

1. Two auto-measuring `Text`s with non-empty text, both stale, then `getPreferredSize()` on one: **one** `measureTexts` call carrying **two** requests, **zero** `measureText` calls, and both report their own correct preferred size.
2. One stale `Text` alone: **zero** `measureTexts` calls and **one** `measureText` call — the `pending.length < 2` early return.
3. A `Text` with `setAutoMeasure(false)` never appears in a `measureTexts` request list, however many other `Text`s are stale, and its preferred size is unchanged by a batch.
4. A `Text` whose text is `""` never appears in a request list, and its preferred size stays `0 × 0` — the empty-text branch is unchanged.
5. After a batch, every participant's next `getPreferredSize()` issues **no** further probe of either kind.
6. `Util.invalidateTextMetricsCache()` followed by `getPreferredSize()` on one of three live auto-measuring `Text`s produces one `measureTexts` call carrying all **three** requests — this is the theme-reflow group.
7. Requests carry each participant's own options: three `Text`s with different `fontWeight` values produce one call whose three requests carry those three distinct weights.
8. `getBaseline()` and `getMinSize()` trigger a batch on the same terms as `getPreferredSize()` — all three route through `calculateSize`.
9. A `Text` on which `dispose()` was called does not appear in a later batch's request list.
10. `DOM.source.measureTexts([])` returns `[]`.
11. A wrapping `Text` (`truncate: false`, `whiteSpace: "normal"`) given a width narrower than its natural run still reports the taller wrapped height after a batch — `applyNaturalMetrics` runs `measuredHeight`, which re-measures.

Manual verification in the browser (the offline model derives `measureTexts` from `measureText`, so an offline parity assertion would be true by construction and prove nothing):

12. Batched metrics equal today's standalone metrics — same width, height and baseline — across mixed fonts, weights, styles, sizes and line-heights, and for wrapped (`maxWidth`) requests too.
13. Application startup issues far fewer `measureText` probes than today (see `## Verification` for the counter and thresholds), with no visible change to any label's size or position.
14. Switching theme with the demo on screen re-lays every label at the new theme's metrics, as today.

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test
npm run lint          # local/no-raw-dom must pass unchanged: the new probe code is inside the seam
npm run test:lint
npm run docs:api      # must finish with zero warnings
grep -rn 'measureTexts' src/typescript/     # expect only core/DOM.ts and component/input/Text.ts
```

**Probe counter.** `npm run dev` in `packages/lib`, then open the demo with this snippet installed before the application scripts run (DevTools → Sources → Page → add to a *"Run snippet on page load"*, or paste it into the console and reload with the console's *Preserve log* on and re-run against a route change):

```javascript
window.__probes = { single: [], batched: [] };
const append = Node.prototype.appendChild;
Node.prototype.appendChild = function (n) {
    if (n && n.nodeType === 1 && n.style && n.style.position === 'fixed' && n.style.visibility === 'hidden') {
        if (n.tagName === 'SPAN' && n.children.length === 1) window.__probes.single.push(performance.now());
        else if (n.tagName === 'DIV') window.__probes.batched.push(n.children.length);
    }
    return append.call(this, n);
};
```

After the **Misc** page settles, read `window.__probes`. **Counts as fixed:** `single.length` drops from **228** to under **30**, and `batched` shows a handful of entries whose sizes sum to roughly the difference. Today's baseline on the same harness is `single.length === 228` in 21 time-clusters, the largest being 98, 33, 31 and 17 probes.

**Parity.** With the same page open, compare a standalone probe against an in-wrapper probe for a spread of font configurations, including `maxWidth` cases, and assert width, height and baseline all match. This was measured on today's build and matched exactly for every case tried.[^parity-evidence]

**Trace.** Record a page-load performance trace and open the *Forced reflow* insight. `measureText`'s share must fall well below today's **39 ms** of the **77 ms** total. It may still appear — a lone stale `Text` and every wrap re-measure keep using it.

---

## Documentation Impact

No public component API changes. `TextMeasureRequest` and `DOMSource.measureTexts` are new public type surface, both reached through `~/core` and both already carrying the JSDoc under `## Public API`; TypeDoc picks them up from the existing `core/index.ts` export line with no page or catalog edit.

[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) gains an entry under **Breaking changes → Core**, mirroring the `getDocumentSelection()` entry already there: `DOMSource` gains one required member, `measureTexts(requests)`, returning one `TextMetrics` per request measured in a single document reflow; only a consumer implementing its own `DOMSource` is affected.

[`packages/lib/docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md#L107) gains a bullet under *Avoiding layout thrash*: measuring N strings one at a time costs N forced layouts, so the framework measures every stale `Text` through one probe element; a consumer measuring several strings itself should use one `measureTexts` call rather than a `measureText` loop.

The same file's *Disposing Text components* section opens by saying a `Text` "subscribes to `ThemeManager.onThemeChange` on construction". That is no longer how `Text` tracks the theme — [`needsMeasure`](packages/lib/src/typescript/lib/component/input/Text.ts#L390) compares a generation counter instead — and after this plan the sentence has an accurate replacement. Rewrite it to say that a `Text` registers itself in the framework's measurement registry on construction and releases that entry in `destructor()`. The two code examples and the field-versus-child distinction below stay exactly as they are.

---

## Potential Challenges

- **A batch measures a `Text` nobody asked about.** Every participant was already stale and would have measured on its next read, so the work is pulled forward rather than added; only a `Text` disposed or re-dirtied before that read wastes a measurement. No mitigation needed beyond the `_autoMeasure` and empty-text filters in `wantsBatchedMeasure`.
- **The walk is linear in the number of live `Text`s.** Each visited entry costs a `deref()` and two field reads, against a saved forced layout of roughly 0.17 ms; the walk only stops paying for itself past several thousand live instances.[^walk-cost] Table, list and tree cell renderers all call `setAutoMeasure(false)`, so their instances are filtered out on the cheapest possible test.
- **A wrapping participant still probes twice.** `applyNaturalMetrics` calls `measuredHeight`, which re-measures at the laid-out width for a `Text` narrower than its natural run. That second probe is not batched, so a group of wrapping `Text`s still pays one forced layout each for the wrap pass. It is strictly no worse than today (which pays two each), and `truncate: true` — the default — makes a `Text` `nowrap`, so the wrap pass is the exception.
- **Registry entries outlive an undisposed `Text` until a batch prunes them.** `WeakRef` keeps the instance collectable; the entry itself is a small object reclaimed on the next walk. Same trade `Glyph.ts` already makes.
- **`_batching` must be cleared on a throwing measurement.** The `try` / `finally` in step 6 is what guarantees it; without it, one exception disables batching for the rest of the session.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/Text.ts:326-503`](packages/lib/src/typescript/lib/component/input/Text.ts#L326) — `calculateSize`, `needsMeasure`, `measure`, `measureOptions`, `measuredHeight`: everything this plan restructures.
- [`packages/lib/src/typescript/lib/core/DOM.ts:1964-2057`](packages/lib/src/typescript/lib/core/DOM.ts#L1964) — `ProductionDOMSource.measureText` (the probe shape to reproduce) and `measureTextWidths` (the one-flush technique to generalise).
- [`packages/lib/src/typescript/lib/component/display/Glyph.ts:41-116`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L41) — **the precedent** for the registry: a module-level `Set<WeakRef<Glyph>>` (`_animatedRefs`) walked by shared code (`_onReducedMotionChange`), pruning dead references as it goes.
- [`packages/lib/src/typescript/lib/core/BorderWidths.ts`](packages/lib/src/typescript/lib/core/BorderWidths.ts) — the precedent for the `@internal` reset-plus-size pair and its `installTestDOM` call; see also `plans/implemented/table-scroll-forced-reflow.md`.
- [`packages/lib/src/typescript/lib/core/Theme.ts:1409-1423`](packages/lib/src/typescript/lib/core/Theme.ts#L1409) — `onFontsSettled` / `reflowText`, the loop that creates the largest group.
- [`packages/lib/src/typescript/lib/component/button/Button.ts:372`](packages/lib/src/typescript/lib/component/button/Button.ts#L372) — `_onThemeChange`, the per-subscriber recompute that turns that loop into one probe per button.
- [`packages/lib/tests/dom/TestDOM.ts:866-1008`](packages/lib/tests/dom/TestDOM.ts#L866) — `ModelledDOMSource`, its `measureText` model and `measureTextWidths` twin.
- [`packages/lib/tests/core/BorderWidths.test.ts`](packages/lib/tests/core/BorderWidths.test.ts) — the test shape for a module-level registry plus a wrapped counting source.

---

## Non-Goals

- **Table row-pool construction is not a beneficiary.** Every table, list and tree cell renderer calls `setAutoMeasure(false)` on its `Text` — see [`renderer/String.ts:27`](packages/lib/src/typescript/lib/component/table/cell/renderer/String.ts#L27) and the note at [`VirtualRowView.ts:563`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L563) — so `calculateSize` returns before probing and a pooled row measures no text at all. Opening the 45-column demo table issues two `measureText` probes in total, neither from a cell.[^table-evidence] Do not add a batch trigger to `growRowPool` or `Body`, and do not expect this plan to change that screen's open time.
- **Column-width sampling is already batched.** `Table`'s width derivation uses `Util.measureTextWidths` on a three-call budget. It is not converted to `measureTexts`; the existing calls share one font per call, which is exactly what `measureTextWidths` is for.
- **Scroll-time measurement is not addressed** — there is none to address. Wheel-scrolling the open demo table triggers no forced-reflow or DOM-size insight at all; the existing translate, geometry-diff and `will-change` design already handles the steady state.
- **Other forced reflows in the same traces are out of scope** — `getBorderWidths`, `getScrollLeft`, `getScrollMetrics` and `applyPatchTo` all appear alongside `measureText`. Each is a separate read with its own fix.
- **No CSS containment changes** on table rows or cells.
- **`measureText` is not removed.** A lone stale `Text`, and the wrap-aware re-measure, both still use it.

---

## Notes

[^bursts]: The two shapes were identified by recording every probe append at startup and reading the JavaScript stack at each one. The largest group's stack is `ThemeManager.reflowText` → `Button._onThemeChange` → `recomputePreferredSize` → `computePreferredSize` → `HBox.getPreferredSize` → `Text.getPreferredSize` → `calculateSize` → `measureText`, repeated 98 times: the font-settled reflow invalidates the metrics generation for every `Text` at once, then walks its subscriber list, and each subscriber's label measures on its own. The third-largest group's stack is `Tab.resolveBounds` → `MiscPanel.getPreferredSize` → nested `HBox`/`VBox` `getPreferredSize` → `Text.getPreferredSize`, which is the layout-pass shape: one recursion reaching 31 freshly built labels in turn.

[^startup-measurement]: Measured against `master` at `cf842fa1` on the demo application at `localhost:8015`, Misc route, by patching `Node.prototype.appendChild` to record every fixed-position hidden probe append. 228 `measureText` probes, zero `measureTextWidths` calls. Grouping the timestamps with a 2 ms gap threshold gives 21 groups of sizes 98, 33, 31, 17, 9, 8, 8, 7, 3, 2, 2 and ten of size 1 — so four groups account for 78% of all probes. A page-load performance trace attributes 39 ms of its 77 ms total forced-reflow time to `measureText`, alongside `getScrollLeft` (24 ms), `applyPatchTo` (26 ms), `getScrollMetrics` (9 ms), `getThemeVar` (5 ms) and `getBorderWidths` (5 ms).

[^why-self-triggering]: Deferring the measurement was rejected. `getPreferredSize()`, `getMinSize()` and `getBaseline()` are called from inside a layout manager's arrangement arithmetic, which needs the number in the same synchronous call — making any of them asynchronous would mean rewriting every layout manager. An explicit "flush now" call placed ahead of each group was rejected too: it needs a caller that knows a group is coming, and neither `ThemeManager.reflowText` (which fans out to opaque `() => void` subscribers) nor a container's `getPreferredSize()` recursion (which discovers its text-bearing leaves as it descends) can know that. Triggering from the first stale `Text` needs no such knowledge: by the time any one of them is asked, all the others are already stale and already registered, so a single walk finds the whole group.

[^no-flush-site]: This is a deliberate departure from the shape the investigation brief anticipated, which expected the pool build-and-bind pass to call a flush after constructing a batch of cells. Two findings ruled that out. Pooled table rows measure no text at all (see `## Non-Goals`), so there is nothing at that site to flush; and the groups that do exist form inside loops — a theme fan-out and a layout recursion — that cannot enumerate their own text-bearing leaves in advance.

[^per-item-options]: Extending `measureTextWidths` was considered and rejected: it returns `number[]`, and widening its return to `TextMetrics[]` would change an existing method's contract for its three current `Table` call sites, which want widths under one shared font and nothing more. Grouping participants by matching options and issuing one call per group was also considered and rejected — it is real code (a key derivation, a bucket map, a scatter of results back to the right instances) bought nothing, because CSS font properties written on each probe element are already per-element. A group mixing 3 font configurations across 98 strings measured identically to 98 standalone probes, so grouping would only have reduced a solved problem to a partly solved one.

[^registry-shape]: A strong `Set<Text>` was rejected: a module-level strong reference pins every instance for the lifetime of the process, and the framework has a history of exactly this leak shape. `Glyph.ts` already solved it — `WeakRef` entries plus pruning on the walk — so this plan copies that. The one addition over `Glyph`'s version is deregistering in `destructor()`: a disposed-but-not-yet-collected `Text` measured by a batch would call `setCalculatedSize`, which notifies its ancestors and can re-queue a torn-down component for layout. Placing the registry in `Text.ts` rather than a `core/` module — which is where `BorderWidths.ts` puts its equivalent state — is forced: the registry holds `Text` instances, and a `core/` module importing `component/input/Text.js` would invert the layering. `Glyph.ts` sets the precedent for a component file owning module-level registry state.

[^staleness]: `calculateSize` currently writes `_measurementDirty = false` and `_measuredGeneration` at the top, before deciding whether to probe. Moving both writes into `applyNaturalMetrics` is what lets the batched path leave each participant in the identical state, and is why `calculateSize` can use `needsMeasure()` as its "was I covered?" test after the batch returns: a participant comes back clean, the initiator of an under-two-item batch comes back still stale and takes the solo path. The empty-text and `!_autoMeasure` branches keep their own copies of the two writes, since neither reaches `applyNaturalMetrics`.

[^parity-evidence]: Measured on the running demo. Three configurations (14 px system default; bold at the header token size; Georgia 22 px italic small-caps with a 40 px line-height) and five wrapped configurations (`maxWidth` 120, 200, 300 and 400, plus an embedded newline) each produced byte-identical `{width, height, baseline}` from a standalone probe and from an in-wrapper `inline-block` probe. A 98-item mixed-font batch matched its 98 standalone equivalents on every item. Plain inline probes did **not** match, which is why `display: inline-block` is specified in step 4: today's standalone probe carries `position: fixed`, which blockifies it, so an in-wrapper probe has to be given block-ish layout explicitly.

[^walk-cost]: On the same page, 98 separate standalone probes took 8.4–11.7 ms while one batched call covering the same 98 took 2.6–3.1 ms. Against a per-probe cost of roughly 0.17 ms, a walk step costing on the order of 30 ns breaks even at several thousand live instances — and the real saving is larger than that micro-benchmark, because in the recorded trace each probe followed real DOM mutation and forced a full style recalculation rather than the light invalidation the benchmark arranged.

[^table-evidence]: Measured by the same probe counter, clicking *"Show window with wide table (45 columns)!"* on the demo: 2 `measureText` probes — the window title and the `"Filter:"` label, neither inside the table — 3 `measureTextWidths` calls covering 102 strings, and 2 font-size resolution probes. The forced-reflow insight for that interaction attributes 46 ms to those **2** `measureText` calls and 57 ms to the **3** `measureTextWidths` calls, so roughly 20 ms per call: the cost there is the size of each forced layout against a large dirty document, not the number of measurements. Reducing that count is a different problem from this plan's, and cannot be reached by batching two calls.
