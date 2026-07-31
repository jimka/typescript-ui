# Compositor-Driven Glyph Animation — Implementation Plan

## Overview

Two independent pieces of work, in one plan because they meet at `Component.setWillChange`. They become two commits.

**Goal 1 — make `Glyph`'s three animations run on the compositor.** An SVG-mode `Glyph` renders its root element as an `<svg>` ([Glyph.ts:256](packages/lib/src/typescript/lib/component/display/Glyph.ts#L256)), and `setAnimated` ([Glyph.ts:466](packages/lib/src/typescript/lib/component/display/Glyph.ts#L466)) puts a `transform`-animating CSS class on that root. Blink refuses to run a transform animation on an SVG element on its compositor thread, so every frame goes through the renderer main thread and re-runs `Layerize` — the per-frame Blink step that decides which parts of the page get their own compositor layer. Its cost scales with the whole document, not with the glyph.[^measured] The fix moves the animation onto a plain HTML element: an SVG-mode `Glyph` gains an HTML `<span>` root with the `<svg>` as a tracked inner child, matching the structure [`AbstractChart.createRootElement`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L517) already uses. Char-mode glyphs already have a `<span>` root and are left alone.

**Goal 2 — `applyStyle` must replay `Component._willChange`.** [`applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4452) wipes the element's inline style and then replays cached fields across six phases. No phase touches `_willChange`, so any `setWillChange` call made before the element renders is silently thrown away. Fix: one replay branch in `applyMiscInlineStyles` ([Component.ts:4638](packages/lib/src/typescript/lib/core/Component.ts#L4638)), plus a regression test.

Neither goal changes a public signature. Goal 1 does change one documented behaviour: `setAnimated` will no longer set `will-change: transform`.

---

## Architecture Decisions

### An SVG glyph's root becomes an HTML `<span>`; the `<svg>` becomes a tracked inner child

`Glyph.createRootElement` stops returning the `<svg>`. It returns the HTML root from `super.createRootElement()` and appends a tracked `<svg><use/></svg>` inside it. The animation class, the duration override, and the play-state all keep targeting `this.getElement()` — which is now an animatable HTML element.[^why-root-swap]

This is the shape [`AbstractChart.createRootElement`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L517-L531) already uses — HTML root, `DOM.sink.createElementNS` child, `this.trackHandle(svg)` — and its own comment says it mirrors `Glyph`. Glyph moves to the same structure.

| | Root element | Inner elements |
|---|---|---|
| SVG glyph, today | `<svg fill="currentColor">` | `<use href="#ts-glyph-xmark"/>` |
| SVG glyph, after | `<span>` | `<svg fill="currentColor"><use href="#ts-glyph-xmark"/></svg>` |
| Char glyph, today and after | `<span>▲</span>` | — |

### Every SVG glyph gets the new structure, not only animated ones

The root tag is fixed at construction, so a shape that depends on whether the glyph is animated would make `setAnimated` called later either silently uncomposited or a DOM rebuild. One structure for every SVG glyph keeps `setAnimated` working at any moment and keeps one code path to test.[^uniform-shape]

### The inner `<svg>` stays a raw tracked element, not a `Component`

ARCHITECTURE.md's *One DOM element per class* rule allows raw children for "trivial non-interactive helpers". The inner `<svg>` qualifies: no id, no listeners, no per-instance CSS rule, no layout participation — it is sized `100%`/`100%` and paints. `Glyph` already owns exactly one such raw child today, the `<use>` node it tracks at [Glyph.ts:683](packages/lib/src/typescript/lib/component/display/Glyph.ts#L683); this adds a second of the same kind.[^one-element-rule]

### `setAnimated` stops setting `will-change: transform`

Remove the `setWillChange("transform")` / `setWillChange(null)` calls at [Glyph.ts:482](packages/lib/src/typescript/lib/component/display/Glyph.ts#L482), [504](packages/lib/src/typescript/lib/component/display/Glyph.ts#L504), [600](packages/lib/src/typescript/lib/component/display/Glyph.ts#L600) and [604](packages/lib/src/typescript/lib/component/display/Glyph.ts#L604).[^drop-will-change]

### `setAnimationDuration` writes the `#id` CSS rule instead of an inline style

Change all five `setElementStyle("animationDuration", …)` calls in `Glyph` to `setElementCSSRule`. This mirrors the sibling [`Component.setAnimationPlayState`](packages/lib/src/typescript/lib/core/Component.ts#L3998), which writes the same kind of animation override into the component's own `#id` rule. It also fixes a live drop: an inline style written before render is wiped by `applyStyle` and never replayed, so `new Glyph("xmark", { animation: "spin", animationDuration: 500 })` loses the 500 ms today.[^duration-rule]

### `applyStyle` replays `_willChange` in `applyMiscInlineStyles` (Goal 2)

`applyMiscInlineStyles` is the phase that already replays the other simple cached inline properties — `_transition` and `_opacity` at [Component.ts:4663-4669](packages/lib/src/typescript/lib/core/Component.ts#L4663-L4669). `_willChange` gets a branch of the same shape, written through `this._inlineStyle.set` so it lands inline, matching what `setWillChange` itself writes.[^why-misc-phase]

---

## Internal Structure

`Glyph.createRootElement` after the change:

```typescript
protected createRootElement(): Handle {
    const root = super.createRootElement();

    if (this._def.kind !== "svg") {
        return root;
    }

    ensureGlyphSprite();
    ensureGlyphSymbolMounted(this._name);

    const svgNs = "http://www.w3.org/2000/svg";
    const svg   = DOM.sink.createElementNS(svgNs, "svg");

    // Fills the root's box so the glyph scales with `preferredSize`. Without an
    // explicit size a replaced <svg> falls back to the user-agent's 300x150 and
    // the root's `overflow: hidden` clips it.
    DOM.sink.apply(svg, {
        style:   { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "block" },
        setAttr: { fill: "currentColor", "aria-hidden": "true", focusable: "false" },
    });

    const use = DOM.sink.createElementNS(svgNs, "use");
    DOM.sink.apply(use, { setAttr: { href: "#" + GLYPH_SYMBOL_ID_PREFIX + this._name } });
    DOM.sink.appendChild(svg, use);
    DOM.sink.appendChild(root, svg);

    this.trackHandle(svg);
    this.trackHandle(use);

    return root;
}
```

The Goal 2 branch, added to `applyMiscInlineStyles` next to the `_transition` branch:

```typescript
// Replay the cached will-change hint. `setWillChange` writes inline, and the
// wipe at the head of `applyStyle` clears it — so a hint set before the element
// rendered (e.g. from `applyOptions` during the super() cascade) is lost
// without this.
if (this._willChange !== null) {
    this._inlineStyle.set("willChange", this._willChange);
}
```

---

## Ordered Implementation Steps

### Goal 1 — composited glyph animation (commit 1)

1. **`packages/lib/tests/component/display/Glyph.test.ts`** — add the failing tests first, covering the `## Expected Behaviour` cases G1–G7. They exercise the new structure and will not pass until steps 2–6 are done.
2. **`packages/lib/src/typescript/lib/component/display/Glyph.ts`** — in `_defaultGlyphOptions` ([Glyph.ts:171](packages/lib/src/typescript/lib/component/display/Glyph.ts#L171)) add `tag: "span"`, and delete the `tag: def.kind === "svg" ? "svg" : "span"` line from the `super()` call in the constructor ([Glyph.ts:256](packages/lib/src/typescript/lib/component/display/Glyph.ts#L256)). Update the neighbouring comment, which says the tag is per-instance.
3. **`Glyph.ts`** — rewrite `createRootElement` ([Glyph.ts:668-689](packages/lib/src/typescript/lib/component/display/Glyph.ts#L668-L689)) to the body in `## Internal Structure`. Update its JSDoc: the root is always an HTML `<span>`; SVG entries paint through a tracked inner `<svg>`.
4. **`Glyph.ts`** — remove the four `setWillChange` calls (lines [482](packages/lib/src/typescript/lib/component/display/Glyph.ts#L482), [504](packages/lib/src/typescript/lib/component/display/Glyph.ts#L504), [600](packages/lib/src/typescript/lib/component/display/Glyph.ts#L600), [604](packages/lib/src/typescript/lib/component/display/Glyph.ts#L604)). Check: `grep -n 'setWillChange' packages/lib/src/typescript/lib/component/display/Glyph.ts` — expect zero matches.
5. **`Glyph.ts`** — change all five `setElementStyle("animationDuration", …)` calls to `setElementCSSRule`: lines [481](packages/lib/src/typescript/lib/component/display/Glyph.ts#L481) and [508](packages/lib/src/typescript/lib/component/display/Glyph.ts#L508) in `setAnimated`, [578](packages/lib/src/typescript/lib/component/display/Glyph.ts#L578) in `setAnimationDuration`, and [601](packages/lib/src/typescript/lib/component/display/Glyph.ts#L601) and [607](packages/lib/src/typescript/lib/component/display/Glyph.ts#L607) in `_syncReducedMotion`. Check: `grep -n 'animationDuration' packages/lib/src/typescript/lib/component/display/Glyph.ts` — every DOM-writing hit is a `setElementCSSRule`.
6. **`Glyph.ts`** — in `setAnimationDuration` ([Glyph.ts:577](packages/lib/src/typescript/lib/component/display/Glyph.ts#L577)) change the guard `this._glyphAnimation !== null` to `this._glyphAnimation != null`. `_glyphAnimation` is a `declare` field with no runtime initializer, so it reads `undefined` on a glyph that was never animated and the strict check treats that as "animated".[^loose-compare] The same loose comparison is already used, and explained, in `onEffectiveVisibilityChange` ([Glyph.ts:548](packages/lib/src/typescript/lib/component/display/Glyph.ts#L548)).
7. **`Glyph.ts`** — update the three JSDoc blocks that describe the old behaviour: the `setAnimated` remark ([Glyph.ts:450-452](packages/lib/src/typescript/lib/component/display/Glyph.ts#L450-L452)) and the `onEffectiveVisibilityChange` remark ([Glyph.ts:536-538](packages/lib/src/typescript/lib/component/display/Glyph.ts#L536-L538)), both of which promise a `will-change` hint; and the class remark about the emitted markup and the root tag ([Glyph.ts:181-189](packages/lib/src/typescript/lib/component/display/Glyph.ts#L181-L189)).
8. Run `npm run typecheck` and `npm run test`. The pre-existing suites that must stay green are `packages/lib/tests/component/display/Glyph.test.ts` and `packages/lib/tests/component/container/TabCloseGlyphCentring.test.ts`.
9. **`packages/lib/docs/components/Glyph.md`** — update the four places that describe the old shape: the `<svg><use/></svg>` sentence at line 5, the usage comment at line 14, the `will-change` sentence at line 71, and the root-tag note at line 77.
10. **`packages/lib/docs/reference/changelog.md`** — add an entry under the current top heading.
11. Run the manual live check in `## Verification`. **This is the step that proves the fix**; the unit tests only pin the structure.

### Goal 2 — replay `will-change` through `applyStyle` (commit 2)

12. **`packages/lib/tests/component/Component.test.ts`** — add a `describe('Component — will-change survives applyStyle')` block covering cases G8–G9. Red before step 13.
13. **`packages/lib/src/typescript/lib/core/Component.ts`** — add the `_willChange` branch to `applyMiscInlineStyles` ([Component.ts:4638](packages/lib/src/typescript/lib/core/Component.ts#L4638)), placed immediately before the `_transition` branch at [Component.ts:4663](packages/lib/src/typescript/lib/core/Component.ts#L4663). Extend that method's JSDoc property list to name `will-change`.
14. Run `npm run typecheck`, `npm run test`, `npm run lint`.
15. **`packages/lib/docs/reference/changelog.md`** — add a separate fix entry.

---

## Files to Create / Modify / Delete

| Action | File | Goal |
|---|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` | 1 |
| Modify | `packages/lib/tests/component/display/Glyph.test.ts` | 1 |
| Modify | `packages/lib/docs/components/Glyph.md` | 1 |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` | 2 |
| Modify | `packages/lib/tests/component/Component.test.ts` | 2 |
| Modify | `packages/lib/docs/reference/changelog.md` | 1 and 2 (one entry each) |

---

## Expected Behaviour

Offline tests use `installTestDOM` from `packages/lib/tests/dom/TestDOM.ts`, which returns the `RecordingDOMSink`. Three read paths matter: `DOM.source.getTagName(handle)` returns the element's tag; `ruleStyleWrites(sink)` (exported from the same module) returns `{ selector, key, value }` rows for every CSS-rule write; and `sink.writes` holds the raw `{ op, args }` log for class and inline-style assertions.

### Goal 1 — unit-testable

| # | Case | Expectation |
|---|---|---|
| G1 | `new Glyph('xmark').getElement(true)` (SVG entry, registered in the test) | `DOM.source.getTagName(root)` is `'SPAN'` |
| G2 | Same glyph | `sink.writes` contains a `createElementNS` with `('http://www.w3.org/2000/svg', 'svg')`, and an `appendChild` whose parent is the root handle and whose child is that svg handle |
| G3 | `new Glyph('unicode-arrow-up').getElement(true)` (char entry) | Root tag is `'SPAN'`; no `createElementNS` recorded; the root receives `{ text: '▲' }` |
| G4 | `new Glyph('xmark', { animation: 'spin' }).getElement(true)` | An `apply` with `addClass: ['ts-ui-glyph-spin']` targets the **root** handle, not the inner svg handle |
| G5 | `new Glyph('xmark', { animation: 'spin', animationDuration: 500 })`, then `getElement(true)` | `ruleStyleWrites(sink)` contains `{ selector: '#' + glyph.getId(), key: 'animationDuration', value: '500ms' }` — the override survives render |
| G6 | `new Glyph('xmark', { animationDuration: 500 })` — duration but no animation | No `animationDuration` row for that selector; `getAnimationDuration()` is `500` |
| G7 | `new Glyph('xmark', { animation: 'spin' })` | `getWillChange()` is `null` (the hint is no longer set) |

The four existing `Glyph animation pauses while hidden` cases ([Glyph.test.ts:165-213](packages/lib/tests/component/display/Glyph.test.ts#L165-L213)) must keep passing unchanged — they are the teardown and reduced-motion-adjacent guard rails.

### Goal 2 — unit-testable

| # | Case | Expectation |
|---|---|---|
| G8 | `new Component({ willChange: 'transform' })`, then `getElement(true)` | Among the `apply` writes on the root handle, the last one carrying a `style.willChange` key comes **after** the `removeAttr: ['style']` write, and its value is `'transform'` |
| G9 | Same component, `getWillChange()` | `'transform'` — unchanged; the cache was never the broken part |

For G8, find the index of the wipe (`w.op === 'apply' && w.args[0] === root && (w.args[1] as {removeAttr?: string[]}).removeAttr?.includes('style')`) and assert a later `apply` on the same handle carries `style.willChange === 'transform'`.

### Manual verification only

| # | Case | How |
|---|---|---|
| M1 | Animated glyphs no longer force a per-frame `Layerize` | The trace procedure in `## Verification` |
| M2 | The three demo glyphs still spin / pulse / beat, at the right size and position | Visual check at `http://localhost:8015`, MiscPanel ([MiscPanel.ts:1490-1492](packages/lib/src/typescript/MiscPanel.ts#L1490-L1492)) |
| M3 | An animated char-mode glyph costs nothing, confirming char glyphs need no change | No animated char glyph exists anywhere — all three demo glyphs (`xmark`, `arrow-right`, `arrow-down`) are SVG entries, and `Scrollbar`'s end-cap arrows are the only char-mode consumers and are never animated. So this is a throwaway diagnostic: temporarily add `new Glyph("unicode-arrow-up", { animation: "spin" })` to the MiscPanel row, re-run the step-11 trace, confirm `Layerize` still is not per-frame, then **revert the edit — it is not committed** |
| M4 | Every non-animated SVG glyph still renders identically | Sweep the demo app: `Button` leading glyphs, `WindowHeader` close ✕, tree row carets, `Scrollbar` end-cap arrows, table header sort glyphs, `MenuItem`, `Checkbox`, `RadioButton`, `ComboBox` caret, `SplitButton` chevron |
| M5 | Table header glyphs still sit correctly | Header cells position the glyph by appending its root element raw and writing `translateY(-50%)` plus an explicit size ([Header.ts:246-256](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L246-L256)) — open a sortable table and confirm the glyph is centred |
| M6 | Button glyph sizing still tracks the title line height | `Button._syncGlyphSize` writes `glyph.setPreferredSize` from `_text.getLineHeight()` ([Button.ts:1285-1311](packages/lib/src/typescript/lib/component/button/Button.ts#L1285-L1311)). Switch themes with a glyph button on screen and confirm the glyph resizes with the text |

---

## Verification

1. `npm run typecheck` — clean.
2. `npm run test` — the new cases pass, nothing regresses.
3. `npm run lint` — clean.
4. `npm run docs:api` — zero warnings (the JSDoc edits in steps 3, 7 and 13 touch documented symbols).
5. `grep -rn 'setWillChange' packages/lib/src/typescript/lib/component/display/Glyph.ts` — zero matches.
6. **The live trace (M1).** Run `npm run dev`, open `http://localhost:8015` **in the user's own Chrome** — not an automation-attached Chromium, which does not reproduce the cost.[^local-chromium] Scroll MiscPanel to the "Animated glyphs:" row so all three glyphs are on screen, click *"Show window with wide table (45 columns)!"* ([MiscPanel.ts:346](packages/lib/src/typescript/MiscPanel.ts#L346)), and maximize the window. With the page otherwise idle, record a DevTools performance trace of about 5 seconds. In the bottom-up view, `Layerize` must no longer appear once per frame. Before the fix it runs ~314 times over 5.46 s at ~3.66 ms each; after the fix its event count must be a handful, not one per frame, and its total self time must be a small fraction of a millisecond per second.
7. **Visual sweep (M2, M4, M5, M6)** across the demo app.

---

## Documentation Impact

- **[`packages/lib/docs/components/Glyph.md`](packages/lib/docs/components/Glyph.md)** — four edits: the emitted-markup sentence (line 5), the usage comment (line 14), the `will-change` sentence in *Animation* (line 71), and the root-tag note (line 77). The root-tag note becomes: the root is always a `<span>`; an SVG entry paints through an inner `<svg>`; the registry name is still fixed at construction.
- **[`packages/lib/docs/reference/changelog.md`](packages/lib/docs/reference/changelog.md)** — two entries, one per commit, under the existing top version heading.[^changelog]
- **[`packages/lib/docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md)** — no edit. Its *Compositor-layer hints* section lists window drag, virtual rows and the table header, and never mentions glyphs.
- **[`packages/lib/llms.txt`](packages/lib/llms.txt)** — no edit. Its `Glyph` row (line 68) describes purpose, not markup.
- No exported symbol is added, renamed or removed, so no barrel, catalog or sidebar entry changes.

---

## Potential Challenges

- **The fix might not work.** The diagnosis says an HTML root will composite where an SVG root will not; that is an inference from a proof-by-elimination, not a direct measurement of the new structure. If step 11's trace still shows one `Layerize` per frame, stop and report the trace rather than layering on further changes — the next thing to test would be whether Blink is refusing for an unrelated reason.
- **The inner `<svg>` must be sized explicitly.** A replaced `<svg>` with no width/height falls back to the user agent's 300×150 and the root's `overflow: hidden` clips it. The `width: 100%; height: 100%; display: block` in `createRootElement` is what prevents that; the existing inline width/height that `render` writes on the root ([Glyph.ts:713-717](packages/lib/src/typescript/lib/component/display/Glyph.ts#L713-L717)) is what those percentages resolve against, so it stays.
- **Consumers that append a glyph's element raw** get a `<span>` where they used to get an `<svg>`: [`Header._mountHeaderGlyph`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L253) and the list `Glyph` renderer ([renderer/Glyph.ts:103](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L103), [:179](packages/lib/src/typescript/lib/component/list/renderer/Glyph.ts#L179)). Neither reads the tag or an SVG-only property — both only append and style through Component setters — so they need no change, but M5 checks the header case in the browser.
- **`setForegroundColor` still has to reach the ink.** The colour now lands on the `<span>` as CSS `color`; the inner `<svg>` keeps `fill="currentColor"` and inherits it. `Header` sets a themed glyph colour this way ([Header.ts:250](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L250)) — M5 covers it.
- **One extra DOM element per SVG glyph.** The wrapper paints nothing — no background, border, text or outline — so it adds a layout box without adding a paint chunk, which is what the `Layerize` cost scales with. Step 11's trace is the check; if paint-chunk count rises measurably, report it.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/component/chart/AbstractChart.ts:517-546`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L517-L546) | The precedent: HTML root, `createElementNS` child, `trackHandle`. Read before writing `createRootElement` |
| [`packages/lib/src/typescript/lib/component/display/Glyph.ts`](packages/lib/src/typescript/lib/component/display/Glyph.ts) | The subject of Goal 1 |
| [`packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts:80-88`](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L80-L88) | The animation that already composites: a plain-`div` `Component` carrying a `transform` keyframe animation |
| [`packages/lib/src/typescript/lib/core/Component.ts:4452-4686`](packages/lib/src/typescript/lib/core/Component.ts#L4452-L4686) | `applyStyle` and its six phases — the subject of Goal 2 |
| [`packages/lib/src/typescript/lib/core/Component.ts:5472-5499`](packages/lib/src/typescript/lib/core/Component.ts#L5472-L5499) | `init`: attaches the inline-style buffer and *then* calls `applyStyle`, which is why an un-replayed field is dropped |
| [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) | `installTestDOM`, `RecordingDOMSink.writes`, `ruleStyleWrites`, `ModelledDOMSource.getTagName` |
| [`packages/lib/tests/component/display/Glyph.test.ts`](packages/lib/tests/component/display/Glyph.test.ts) | Existing Glyph coverage the new cases extend |
| [`plans/implemented/animated-glyphs.md`](plans/implemented/animated-glyphs.md) | Why the animation is a shared class rule and not `Component.setAnimation` — that decision stands |
| [`plans/implemented/will-change-hints.md`](plans/implemented/will-change-hints.md) | The hint's intended lifetime rules, which Goal 1's removal decision rests on |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | *One DOM element per class*, *Defer DOM work to render time*, *All attributes and styles go through typed setters* |

---

## Non-Goals

- **The row pool's `will-change` hint stays.** [`VirtualRowView.ts:349`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L349) promotes pooled rows with `row.setWillChange("transform")`. `setWillChange`'s own remarks name "pool membership" as an acceptable hint lifetime, the hint was measured to cost no CPU, and clearing it after a scroll would need scroll-settle machinery that exists in neither `VirtualRowView.ts` nor `VirtualScroller.ts` — while giving up the first-scroll smoothness the hint is there for. Do not touch it. The same applies to the other `setWillChange` call sites (`Table`, `AbstractWindow`, `AnimatedDropdown`, `Accordion`, `CollapseSupport`).
- **Char-mode glyphs.** Their root is already a `<span>`, which the framework positions absolutely and gives `display: block` — the same kind of box as `ProgressSpinner`'s composited arc `div`. Blink's refusal applies to SVG elements, so a char glyph was never the problem. M3 confirms it.
- **`ProgressSpinner`.** Already composited; measured to cost nothing.
- **The wide table's other costs.** The per-cell build time and the synchronous `doLayout` per mousemove are separate, already-tracked problems. This plan only removes the per-frame `Layerize`.
- **The glyph sprite mechanism.** `ensureGlyphSprite` / `ensureGlyphSymbolMounted` / `<use>` are unchanged.
- **Swapping a Glyph's registry name after construction.** Still unsupported, as documented.

---

## Notes

[^measured]: Established by measurement before this plan; not re-derived here. From an exported Chrome trace with the 45-column table window open and maximized: `Layerize` ran 314 times over 5.46 s — exactly once per frame — at a p50 of 3.61 ms (range 3.14–4.50 ms), for 1,148 ms of self time, about 21% of one core. It is a leaf event with no children. Everything else on the main thread was noise: Commit 26 ms, UpdateLayoutTree 23 ms, PrePaint 20 ms. Proof by elimination on a live page idling at ~25% CPU: pausing only the three SVG glyph animations dropped it to 3–4%, while pausing only the `ProgressSpinner` animation — the same style of keyframes, but rooted on a plain `div` — changed nothing.

[^why-root-swap]: `will-change: transform` was tested as the fix and does not work: the hint was confirmed applied by reading back `getComputedStyle(target).willChange === "transform"` on all four animated targets, and CPU did not move. Layer promotion cannot make the compositor drive an animation it refuses to drive. Two other routes were considered. Moving the animation to an element *inside* the `<svg>` fails for the same reason — an SVG child is still an SVG element. Wrapping the existing absolutely-positioned `<svg>` in an animated sheath fails for a different reason: a `transform` on the sheath makes it the containing block for the absolutely positioned `<svg>` inside it, so the glyph's layout-assigned `top`/`left` would resolve against a zero-sized wrapper and the glyph would jump. Making the wrapper *be* the component's own laid-out root is what avoids that.

[^uniform-shape]: The alternative — build the `<span>` root only when `options.animation` is set — was rejected. `setAnimated` is a documented runtime toggle, so a glyph constructed without an animation and animated later would either animate uncomposited (a silent performance cliff with no way for the caller to know) or need its element torn down and rebuilt mid-life, which the class explicitly does not support. The cost of uniformity is one non-painting `<span>` per SVG glyph.

[^one-element-rule]: The rule's escape hatch for behaviour-bearing sub-elements is "extract it into a `Component` subclass", and the framework has a matching precedent for each side. `ProgressSpinner` takes the Component route for its `_arc` ([ProgressSpinner.ts:80-88](packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts#L80-L88)) because the arc has its own border, border-radius and animation — a per-instance CSS rule. `Component.createFrame` ([Component.ts:1120](packages/lib/src/typescript/lib/core/Component.ts#L1120)) takes the raw route for clip and content frames, described in its JSDoc as "a non-interactive sheath with no id and no listeners"; `VirtualScroller`'s `clipBox` and `rowsContainer` ([VirtualScroller.ts:86-94](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L86-L94)) and `AbstractChart`'s `<svg>` surface do the same. The inner `<svg>` here has no id, no listeners, no CSS rule and no layout of its own, so it belongs on the raw side. This is a deviation from the strictest reading of the rule and is recorded here rather than left implicit.

[^drop-will-change]: Three reasons. The hint's documented purpose is to pre-create a layer so the *first* frame of motion does not pay a promotion cost; a glyph animation is continuous and infinite, so one promotion amortises to nothing. `setWillChange`'s own remarks warn that the hint costs GPU memory and is ignored by browsers past roughly 50–100 elements per page — and `Glyph` is among the most numerous components in the framework, so a page with many animated glyphs is precisely the case that blows the budget and makes the hint counterproductive. And it currently has no effect at all, because of the Goal 2 bug: all four animated targets on the demo page read `willChange: "auto"`. Removing it therefore changes nothing observable today, and Goal 2 stays worth fixing on its own merits regardless.

[^duration-rule]: The `#id` rule (specificity 1,0,0) still beats the `.ts-ui-glyph-<kind>` class rule (0,1,0), so the override wins exactly as the inline style did. The drop it fixes: `init` attaches the inline-style buffer and flushes the construction-time writes ([Component.ts:5483](packages/lib/src/typescript/lib/core/Component.ts#L5483)), then immediately calls `applyStyle` ([Component.ts:5488](packages/lib/src/typescript/lib/core/Component.ts#L5488)), whose first act is `removeAttr: ["style"]`. Anything not replayed by one of the six phases is gone. The `#id` rule is not wiped, and `Glyph`'s `setFontSize` / `setLineHeight` / `setTextAlign` already rely on that to survive construction.

[^why-misc-phase]: The other five phases are wrong for it. `applyBoxAndVisibilityStyles`, `applySizeConstraintStyles`, `applyOverflowStyles` and `applyChromeStyles` each own a named group `will-change` is not part of, and all four write through `writeRuleDeclaration` into the `#id` rule rather than inline. `replayGeometryStyles` is inline but is specifically the geometry replay. `applyMiscInlineStyles` is where the leftover cached inline properties already live.

[^loose-compare]: Concretely, `new Glyph("xmark", { animationDuration: 500 })` with no `animation` writes an orphan `animation-duration: 500ms` today, because `applyOptions` dispatches `animationDuration` before `animation` ([Glyph.ts:634-656](packages/lib/src/typescript/lib/component/display/Glyph.ts#L634-L656)) and `undefined !== null` is `true`. Case G6 pins the fix. This is one character, in a method the plan is already changing, and it is the trap the file's own `onEffectiveVisibilityChange` comment warns about — so it is fixed here rather than left as a known defect in code being touched.

[^changelog]: The changelog has no `Unreleased` section, so plan-driven entries land under the top version heading and the release split is done later from tags. Follow the existing convention rather than inventing a heading.

[^local-chromium]: A locally-attached Chromium was measured running `Layerize` at 0.003 ms where the user's own Chrome ran it at 3.66 ms — roughly a thousandfold difference. GPU, vsync and compositing decisions differ between the two, so a clean trace from the automation browser proves nothing about the browser the problem was reported in. The trace has to come from the user's real Chrome.
