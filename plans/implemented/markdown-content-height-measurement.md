# Markdown Content-Height Measurement — Implementation Plan

## Overview

`Markdown` ([src/typescript/lib/component/display/Markdown.ts](src/typescript/lib/component/display/Markdown.ts#L161)) renders a heterogeneous prose subtree (`<h1>`–`<h6>`, `<p>`, `<ul>`/`<ol>`, `<blockquote>`, `<pre>`/`<code>`) but overrides neither `getMinSize` nor `getPreferredSize` and sets no explicit size, so it reports `{0,0}`. That is the documented v1 caveat ([Markdown.ts:148-150](src/typescript/lib/component/display/Markdown.ts#L148)). Because the framework scrolls by *size negotiation*, not native content overflow, a zero-height child never grows past its host: `Fit.computeTotalMinSize` ([Fit.ts:183-197](src/typescript/lib/layout/Fit.ts#L183)) returns the child's `getMinSize()` (`{0,0}`), `LayoutManager.inflateForOverflow` ([LayoutManager.ts:159-170](src/typescript/lib/layout/LayoutManager.ts#L159)) computes `max(panelHeight, 0) = panelHeight`, and the child is fitted to the panel's inner height. The scroll extent never exceeds the viewport, so `MarkdownPanel` ([MarkdownPanel.ts:38-48](src/typescript/MarkdownPanel.ts#L38)) with `setAutoScroll("auto")` shows no scrollbar.

This plan makes `Markdown` measure its own rendered content height at the width it is assigned and fold that height into `getMinSize`/`getPreferredSize`, so it reports a real content extent and scrolls inside *any* size-negotiating scroll host — not just this demo. The measurement mirrors the framework's existing precedent in `Text` ([Text.ts](src/typescript/lib/component/input/Text.ts)) and the display-layer size-reporting idiom in `Header` ([Header.ts:167-176](src/typescript/lib/component/display/Header.ts#L167)): a per-instance measured cache, a dirty flag, deferral of the DOM read to a safe point, and re-measure wired to `ThemeManager.onThemeChange`.

The measurement leaf is a single seam read — `DOM.source.getScrollMetrics(root).scrollHeight` ([DOM.ts:942-949](src/typescript/lib/core/DOM.ts#L942), `ScrollMetrics` at [DOM.ts:58-65](src/typescript/lib/core/DOM.ts#L58)) — which is a **live-only** read (the modelled test source reports `scrollHeight = clientHeight`, i.e. no overflow, at [TestDOM.ts:774-787](tests/dom/TestDOM.ts#L774)). The size-negotiation *fold* it feeds (getMinSize → `Fit.computeTotalMinSize` → `inflateForOverflow`) is fully offline-testable with an injected measured height.

---

## Architecture Decisions

### Measure the rendered subtree via root `scrollHeight`, not per-block `measureText`

Two mechanisms were weighed:

1. **Root-element `scrollHeight` at the assigned width.** `scrollHeight` reports the full scrollable content extent of the whole heterogeneous subtree — every heading size, list indent, blockquote gutter, fenced-code block, and the inter-block margins the browser lays out for free — *regardless* of the element's own (possibly short, clipped) box height. One seam read captures the exact rendered height with zero reimplementation.
2. **Summing per-block `DOM.source.measureText` measurements** (the `Text` approach). `measureText` is modelled offline and wrap-aware via `maxWidth` ([TestDOM.ts:693-724](tests/dom/TestDOM.ts#L693)), so it is offline-testable — but `Text` measures *one* homogeneous run. `Markdown`'s subtree is many blocks at different font sizes/families with margins, padding, list markers, and nested structure; reconstructing its height by re-measuring each block and summing margins would reimplement the browser's block layout. That is fragile and large, and violates *Simplicity First*.

**Decision: option 1.** The heterogeneous block layout is exactly what the browser computes correctly and what a hand-rolled sum would get wrong. The cost is that the measurement leaf is a live-only read; that cost is contained by isolating the read behind a single method and keeping the negotiation fold (which *is* offline-testable) separate from it. No new `DOM.source` method is needed — `getScrollMetrics` already exposes `scrollHeight` on the seam.

### The getters read a cache; the live read happens only post-layout

`Text.getMinSize`/`getPreferredSize` trigger `calculateSize()` (an off-screen probe) lazily on first read. `Markdown` deliberately diverges: its measurement is a `scrollHeight` read on the *own, attached, width-assigned* element, which is unavailable during the pre-attach, pre-width bottom-up negotiation pass and is unsafe to run inside the hot `getMinSize` recursion. So `Markdown.getMinSize`/`getPreferredSize` only **read the cached `_measuredHeight`**; they never perform the live read. The live read runs at three safe points — first connected layout, width change, theme change — each of which commits the pending width to the DOM, reads `scrollHeight`, updates the cache, and schedules a re-layout. This is a two-pass settle identical in shape to `Text`'s wrapping `setWidth` re-measure ([Text.ts:547-560](src/typescript/lib/component/input/Text.ts#L547)): pass 1 fits the child to the host and assigns a width, the measure records the true height, pass 2 inflates.

### Report the measured height through both `getMinSize` and `getPreferredSize`

`Fit.inflateForOverflow` reads the child's **`getMinSize()`** (via `computeTotalMinSize`), so the height *must* be reported there or the panel never grows. `Fit.getPreferredSize` reads the child's **`getPreferredSize()`**, so reporting it there too keeps the panel's own preferred size honest when the panel is itself inside a sizing parent. Only the **height** axis is folded (the flow-dependent axis); the width minimum stays `0`, exactly as `Text` folds only its one-line height floor and deliberately reports zero width ([Text.ts:621-655](src/typescript/lib/component/input/Text.ts#L621)) so parent layouts stay free to assign any width and let the prose reflow.

### No new public option — measured height is framework-managed derived state

The measured height is intrinsic runtime bookkeeping, not consumer configuration, so per [ARCHITECTURE.md](ARCHITECTURE.md) *Three non-negotiable rules* (rule 3 exception) it lives in a private backing field, **not** the `XOptions` bag. `Text` provides a `setAutoMeasure` opt-out because some parents (`Fit`) size a `Text` from the container and its measured size is unused there; `Markdown` has no such case — it *is* the content whose height must drive the scroll host — so no opt-out is added. The existing "set an explicit `preferredSize`" escape hatch is preserved: an explicit `getPreferredSizeConstraint()`/`setMinSize` still wins (the fold only supplies a value when no explicit constraint is set, and folds as a `Math.max` floor for the minimum), so a caller can still override measurement.

### The width flush must be committed before the `scrollHeight` read

A `scrollHeight` read taken immediately after `setWidth` would see stale DOM, because `setWidth` buffers the width write through `setElementStyle` (the recorded *commitBounds/stale-DOM* gotcha). The measure calls the inherited `protected commitElementStyle()` ([Component.ts:1181-1184](src/typescript/lib/core/Component.ts#L1181)) — which flushes the buffered inline width — before reading `scrollHeight`, so the height reflects the just-assigned width.

---

## Public API

No new public exported symbols. The change adds private/protected members to `Markdown` and two overrides of inherited public methods (behaviour change only, signatures unchanged):

```typescript
class Markdown extends Component<MarkdownOptions> {
    // New per-instance derived state (NOT on MarkdownOptions):
    private _measuredHeight: number | null;      // cached content height in px, null until first measure
    private readonly _unsubscribeTheme: () => void; // ThemeManager.onThemeChange handle

    // New behaviour on inherited public methods:
    getMinSize(): Size | null;                    // folds _measuredHeight as a height floor
    getPreferredSize(): Size | null;              // reports _measuredHeight as height when no explicit constraint
    setWidth(width: number): this;                // on width change: re-measure post-commit

    // New lifecycle hook (mirrors Text.dispose):
    dispose(): void;                              // detaches the theme listener

    // New private mechanics:
    private measureContentHeight(): void;         // commitElementStyle(); read scrollHeight; cache; scheduleLayout
}
```

> **Implementation deviations (recorded during build).**
> - **No `_measurementDirty` flag.** The plan modelled one on `Text`, whose getters *lazily* measure when dirty. `Markdown`'s getters instead read the cache directly (a `scrollHeight` read is unsafe in the hot `getMinSize` recursion and needs the element attached + width-assigned), and the triggers (`onFirstLayout`, `setWidth`-on-change, `setMarkdown`, theme) call `measureContentHeight()` directly. A dirty flag would be vestigial, so it was dropped.
> - **Prose wrapping fix (added scope, root cause found via live testing).** `Component` defaults `white-space` to `"nowrap"`, which `Markdown` inherited — the document rendered as unwrapping single lines that overflowed horizontally and never reflowed. The constructor now sets `white-space: normal` + `overflow-wrap: break-word` on the root (fenced code keeps its own `white-space: pre` + self-scroll). This is what makes the height measurement meaningful — it now measures *wrapped* height.
> - **Horizontal scroll: investigated and deliberately not built.** Browser testing showed that once prose wraps, content never overflows horizontally (long tokens break; code self-scrolls) — matching standard Markdown renderers. Folding a measured *width* would require preventing wrapping plus an invasive, offline-untestable min-content probe. Rejected; the demo uses `setAutoScroll("y")`.

`dispose()` mirrors [Text.dispose](src/typescript/lib/component/input/Text.ts#L1260): components that build `Markdown` dynamically and remove it should call it to detach the theme listener.

---

## Internal Structure

Measurement leaf (the only live read), isolated so tests can drive the fold without it:

```typescript
private measureContentHeight(): void {
    const element = this.getElement();
    if (!element) { return; }

    this._measurementDirty = false;
    this.commitElementStyle();                          // flush the buffered width first

    const contentHeight = DOM.source.getScrollMetrics(element).scrollHeight;
    const border        = this.getBorderSize();         // scrollHeight already includes padding
    const measured      = contentHeight + border.top + border.bottom;

    if (measured === this._measuredHeight) { return; }  // idempotent: unchanged height suppresses the notify

    this._measuredHeight = measured;
    (this.getParentComponent() ?? this).scheduleLayout();
}
```

`getMinSize` folds the height as a floor (explicit `setMinSize` still wins via `Math.max`), mirroring `Text.getMinSize`; `getPreferredSize` supplies the height only when there is no explicit `getPreferredSizeConstraint()`. The initial measure is registered via `this.onFirstLayout(() => this.measureContentHeight())` in the constructor ([Component.onFirstLayout:4653](src/typescript/lib/core/Component.ts#L4653)) — the per-instance "mounted and sized" signal, which fires after the first *connected* layout so the element exists, is attached, and has a width. `setMarkdown` and the theme callback set `_measurementDirty` and re-measure (guarded on element existence). `setWidth` re-measures only when the width actually changes.

> Perimeter reconciliation (verify against the live demo): `scrollHeight` on a border-box element is content + padding, excluding border, so the outer height adds only the border via `getBorderSize()`. `getPerimeterSize` sums insets **+ border + padding** ([Component.ts:2582](src/typescript/lib/core/Component.ts#L2582)); using it whole would double-count the padding already inside `scrollHeight`. Confirm the exact term set (insets are framework-reserved space `getInnerSize` subtracts) against the rendered demo height.

---

## Ordered Implementation Steps

1. **Add offline red-green tests for the negotiation fold** in [tests/component/display/Markdown.test.ts](tests/component/display/Markdown.test.ts). With an injected/measured height (set the root element's style height through the recording sink so the modelled `getScrollMetrics` reports it, then call the measure), assert `getMinSize().height` and `getPreferredSize().height` reflect it, and that an explicit `setMinSize`/`preferredSize` still wins. → verify: tests fail (red) before the source change.
2. **Add a Fit-inflation test**: a `Markdown` with an injected measured height, placed in a `Fit` container whose manager has `setOverflowing(false, true)`, lays the child out taller than the container inner height (assert the committed height via the recording sink). → verify: red before, green after.
3. **Implement the measurement mechanics** in `Markdown.ts`: the `_measuredHeight` / `_measurementDirty` fields (declared per the `declare`/init rules — `_measuredHeight` and `_measurementDirty` are not written by a cascade-dispatched setter, so plain initializers are fine), `measureContentHeight()`, the `getMinSize`/`getPreferredSize` overrides, the `setWidth` override, the `onFirstLayout` registration, the `ThemeManager.onThemeChange` subscription + `dispose()`, and the `setMarkdown`/`render` re-measure hooks. → verify: steps 1-2 tests pass.
4. **Update the JSDoc** in `Markdown.ts` (remove the "v1 does not measure flowed-text height" caveat at [lines 148-150](src/typescript/lib/component/display/Markdown.ts#L148); describe the new self-measuring behaviour) and the class-summary. → verify: `grep -n "v1 does not measure" src/typescript/lib/component/display/Markdown.ts` — expect zero matches.
5. **Update the demo JSDoc** in [MarkdownPanel.ts:33-37](src/typescript/MarkdownPanel.ts#L33) (drop "v1 relies on a scroll host for overflow"; the panel still uses a scroll host, but overflow is now driven by the component's measured height). → verify: `grep -n "relies on a scroll host" src/typescript/MarkdownPanel.ts` — expect zero matches.
6. **Update the docs page** [docs/components/Markdown.md](docs/components/Markdown.md) *Sizing* section (lines 46-48): replace "v1 does not measure flowed-text height" with the measured-height behaviour and the remaining explicit-`preferredSize` override note. → verify: `npm run docs:build` finishes with zero warnings.
7. **Typecheck + full suite + build.** → verify: `npm run typecheck`, `npm test`, `npm run build:lib`.
8. **Live-verify the demo scrolls** (see Verification).

Regression checkpoint after step 3: `grep -rn "getScrollMetrics" src/typescript/lib/component/display/Markdown.ts` — expect exactly one call site (the isolated leaf).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [src/typescript/lib/component/display/Markdown.ts](src/typescript/lib/component/display/Markdown.ts) — measurement mechanics, getters, `setWidth`, theme wiring, JSDoc |
| Modify | [src/typescript/MarkdownPanel.ts](src/typescript/MarkdownPanel.ts) — demo JSDoc |
| Modify | [tests/component/display/Markdown.test.ts](tests/component/display/Markdown.test.ts) — negotiation-fold + Fit-inflation tests |
| Modify | [docs/components/Markdown.md](docs/components/Markdown.md) — Sizing section |

---

## Expected Behaviour

### Offline-testable (real red-green geometry via the recording sink + modelled source)

- **Height fold into `getMinSize`.** After a measure records height `H`, `markdown.getMinSize().height === H` (or the explicit `setMinSize` height when larger, via `Math.max`); width minimum stays `0`.
- **Height reported by `getPreferredSize`.** With no explicit `preferredSize`, `getPreferredSize().height === H`. With an explicit `setPreferredSize`/`preferredSize` constraint, that constraint wins (the fold does not override it).
- **`Fit` inflation.** A `Markdown` with measured height `H` in a `Fit` container marked overflowing-Y, where the container inner height `< H`, is laid out at height `H` (child's committed height exceeds the container inner height) — the negotiation path that produces the scrollbar.
- **Idempotent re-measure.** A measure that reads the same `scrollHeight` does not fire a redundant `scheduleLayout` (unchanged-height short-circuit).
- **Empty source.** Empty/blank Markdown measures to the empty root's height (the base/zero case) and reports no spurious extra height.
- **Content change invalidates.** `setMarkdown(longer)` marks the cache dirty and, once re-measured, reports a larger `getMinSize().height`.
- **Theme change invalidates.** A `ThemeManager.onThemeChange` marks dirty and re-measures (assert the listener is subscribed and the dirty flag flips).
- **`dispose()` detaches** the theme listener (a subsequent theme change does not re-measure).

> Offline note: because the modelled `getScrollMetrics` returns `scrollHeight = clientHeight` (no real overflow), the tests inject the height by writing the element's box height through the sink and reading it back through the seam — this exercises the *fold and invalidation wiring* against the real seam, not the browser's block-flow computation.

### Manual / live verify (browser-only; the modelled source cannot produce real content overflow)

- **Real heterogeneous flow → real `scrollHeight`.** In the running app, a `Markdown` document taller than its host produces a `scrollHeight` exceeding the host and a genuine content height.
- **`MarkdownPanel` scrolls.** The demo panel shows a working vertical scrollbar and scrolls through the full document.
- **Reflow on resize.** Narrowing the panel reflows the prose taller and the scroll extent grows (the `setWidth` re-measure path).
- **Font-load / theme reflow.** Switching theme re-measures and re-lays-out at the new height.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new Markdown fold + Fit-inflation tests pass alongside the existing Markdown suite.
- Grep invariants from the Ordered Steps (`v1 does not measure`, `relies on a scroll host`, single `getScrollMetrics` call site).
- `npm run docs:build` — zero warnings (public JSDoc touched).
- `npm run build:lib` — the demo (`MarkdownPanel`) consumes the built lib.
- **Live smoke:** start the dev server (`npm run dev`, http://localhost:8015 per project notes — currently down, start it) and open the Markdown demo panel. Confirm: a vertical scrollbar appears, the panel scrolls through the whole sample document, and narrowing the panel width reflows the prose and grows the scroll extent. Scope DevTools queries to `.MarkdownPanel .Markdown` (multiple components coexist on the page).

---

## Documentation Impact

`Markdown` is consumer-facing and documented. Per the [document conventions](CODE_CONVENTIONS.md):

- **Export surface** unchanged — `Markdown` / `MarkdownOptions` still export from [src/typescript/lib/component/display/index.ts:16-17](src/typescript/lib/component/display/index.ts#L16); no barrel or `typedoc` change.
- **Doc page** [docs/components/Markdown.md](docs/components/Markdown.md) *Sizing* section (lines 46-48) is now inaccurate and must be rewritten to describe self-measurement (place in any scroll host; explicit `preferredSize` still overrides). No new methods are added to the *Common methods* table (the two overrides keep their inherited names/signatures).
- **JSDoc** on `Markdown` (class summary + the sizing caveat) and on `MarkdownPanel` is updated; the docs build must stay warning-free, and JSDoc must not `{@link}` internal/`protected` symbols (`measureContentHeight` is private — describe it in prose).
- No renames/removals, so no `grep -rln '\bMarkdown\b' docs/` cleanup beyond the Sizing rewrite.

---

## Potential Challenges

- **Perimeter double-count.** `scrollHeight` already includes padding; add only border via `getBorderSize()`, not the whole `getPerimeterSize` — verify the exact outer-height arithmetic against the live-rendered demo height.
- **Two-pass settle flicker.** The measure-then-relayout is one frame late (as `Text`'s wrapping re-measure is). If a visible one-frame jump appears, confirm the initial measure rides `onFirstLayout` (post-mount) rather than construction, and that the unchanged-height short-circuit prevents an infinite relayout loop.
- **Stale-DOM read.** Reading `scrollHeight` before `commitElementStyle()` returns the pre-resize height; the flush must precede the read in `measureContentHeight`.
- **Font-load reflow (known gotcha).** A web font that loads *after* first paint changes wrapped-text height but does **not** fire `ThemeManager.onThemeChange`, so the height can be briefly stale — the same limitation the project's deferred app-ready/loading-gate note describes. Out of scope here; flag it, do not add a font-load listener speculatively.
- **`getScrollMetrics` when detached.** The read is guarded on `getElement()` and gated behind `onFirstLayout` (fires only on a *connected* layout); a detached measure is skipped and retried on the connected layout.

---

## Critical Files

- [src/typescript/lib/component/input/Text.ts](src/typescript/lib/component/input/Text.ts) — the measurement precedent: `_measuredMinSize`/`_measurementDirty`/`_measuredBaseline` cache, lazy-deferred probe, `setWidth` re-measure, `getMinSize` fold, `ThemeManager.onThemeChange` wiring, `dispose`.
- [src/typescript/lib/component/display/Header.ts](src/typescript/lib/component/display/Header.ts) — the display-layer size-reporting idiom (`updatePreferredSize` on theme change).
- [src/typescript/lib/layout/Fit.ts](src/typescript/lib/layout/Fit.ts) — `computeTotalMinSize` (reads child `getMinSize`) and `doLayout` inflation.
- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts) — `inflateForOverflow` / `setOverflowing`.
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `getMinSize`/`getPreferredSize`/constraints, `setWidth`, `commitElementStyle`, `onFirstLayout`, `getBorderSize`/`getPerimeterSize`, `clampsToContentSize`.
- [src/typescript/lib/core/DOM.ts](src/typescript/lib/core/DOM.ts) — `getScrollMetrics` / `ScrollMetrics`.
- [tests/dom/TestDOM.ts](tests/dom/TestDOM.ts) — the modelled source boundary (`measureText` modelled; `getScrollMetrics.scrollHeight = clientHeight`).

---

## Non-Goals

- **Per-block `measureText` height reconstruction** — rejected above; the browser's block layout is the source of truth.
- **A `setAutoMeasure` opt-out or any new `MarkdownOptions` field** — `Markdown` is display content that must always report its height; the explicit-`preferredSize` override already covers the override case.
- **A font-load remeasure listener** — deferred (project-wide app-ready/loading-gate concern), not introduced here.
- **Horizontal (width) content measurement** — only the flow-dependent height axis is folded; width stays freely assignable, matching `Text`.
- **Changing the scroll mechanism** — the size-negotiation scroll path (`setAutoScroll` → `inflateForOverflow`) is unchanged; this plan only makes `Markdown` a well-behaved participant in it.
