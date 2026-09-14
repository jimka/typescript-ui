---
touches-shared: [packages/lib/src/typescript/lib/core/Panel.ts, packages/lib/src/typescript/lib/core/ScrollShadow.ts, packages/lib/src/typescript/lib/component/container/VirtualScroller.ts]
---

# Scroll-Shadow Edge Strips — Implementation Plan

## Overview

The position-aware scroll-edge shadow is painted today by **one overlay element the size of the whole scroll viewport**, carrying four blurred inset `box-shadow` layers — one per edge — from the shared recipe in [`ScrollShadow.scrollShadowBoxShadow()`](packages/lib/src/typescript/lib/core/ScrollShadow.ts#L61). Two owners create such an overlay: [`VirtualScroller`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L101) (transform-scrolled virtual lists — `Tree`, table bodies) and [`Panel`](packages/lib/src/typescript/lib/core/Panel.ts#L1271) (native `overflow` scrolling). Every frame such an element repaints or resizes, the browser re-blurs each lit layer across the whole viewport-sized box. On a software-rendering browser that dominates frame cost.[^measurements]

This plan keeps the overlay element but **strips its shadow**, turning it into an inert host, and paints each edge's cue on its own **thin strip** pinned inside that host: full length along its edge, one shadow-extent thick across it, carrying exactly **one** layer of today's recipe. Blurred area per frame drops from four viewport-sized boxes to four 12-pixel bands, and the visual result is the same soft cast shadow.

The recipe stays in [`core/ScrollShadow.ts`](packages/lib/src/typescript/lib/core/ScrollShadow.ts), which grows one builder that creates and appends the four strips for either owner; `scrollShadowBoxShadow()` is deleted. Both owners migrate together. No public API changes: `Panel`'s `scrollShadows` option, every setter and getter, and the per-edge gating helpers (`scrollShadowEdgeValue`, `scrollShadowRamp`, `quantizeShadowEdge`) keep their current behaviour and signatures.

---

## Architecture Decisions

### The overlay element stays as a shadow-free strip host; the four strips are its children

Neither owner loses its overlay element. It keeps its position, its size, its `pointer-events: none`, and — in `Panel` — its `position: sticky` pinning and its load-bearing size, but no longer carries a `box-shadow`. The four strips become its only children, absolutely positioned inside it.[^host-stays]

This mirrors [`CodeEditor.mountFlashOverlay()`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2583): a raw, id-less, pointer-transparent decorative `div`, created through `DOM.sink.createElement`, styled once with a single `DOM.sink.apply({ style })`, appended with `DOM.sink.appendChild`, and registered with `trackHandle` so teardown releases it. The strips follow that shape exactly.

### Strips are pinned by CSS and never positioned or sized by JavaScript

Each strip is pinned to its own edge of the host with `left`/`right`/`top`/`bottom` and given a fixed thickness on its own axis. The host already tracks the live viewport in both owners, so a resize re-lays every strip with no JavaScript geometry write at all — **no strip moves, and no strip resizes.**[^no-js-geometry]

| Strip | Pinned by | Fixed extent | Shadow layer |
|---|---|---|---|
| top | `top: 0; left: 0; right: 0` | `height: 12px` | `inset 0 12px 12px -12px var(--ts-ss-top, transparent)` |
| bottom | `bottom: 0; left: 0; right: 0` | `height: 12px` | `inset 0 -12px 12px -12px var(--ts-ss-bottom, transparent)` |
| left | `left: 0; top: 0; bottom: 0` | `width: 12px` | `inset 12px 0 12px -12px var(--ts-ss-left, transparent)` |
| right | `right: 0; top: 0; bottom: 0` | `width: 12px` | `inset -12px 0 12px -12px var(--ts-ss-right, transparent)` |

### Strip thickness is one shadow extent (12px)

`SCROLL_SHADOW_STRIP_PX` is a new module constant in `ScrollShadow.ts` set to `SCROLL_SHADOW_EXTENT_PX`. A 12px strip reproduces today's fade: the shadow's geometric edge lands exactly on the strip's own edge in both cases, so all that is ever visible is blur bleeding inward, and 12px contains that bleed down to under 3% of the edge's peak alpha.[^thickness] One manual check confirms no visible cut where a strip ends (see `## Verification`); the constant is the single knob if it ever fails.

### The host keeps the `--ts-ss-*` writes; the strips inherit them

Custom properties inherit, so each strip's `var(--ts-ss-<edge>, transparent)` resolves from the value the owner writes on the host. Both owners' `setShadowEdge` — the quantise-then-write path at [`VirtualScroller.setShadowEdge`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L494) and [`Panel.setShadowEdge`](packages/lib/src/typescript/lib/core/Panel.ts#L1407) — is therefore **unchanged**: still one write, still to the host, still one element per frame.[^inherit-on-host]

### `ScrollShadow.ts` grows the strip builder both owners call

`scrollShadowBoxShadow()` is replaced by an exported `appendScrollShadowStrips(host)` that creates, styles, and appends the four strips through the DOM seam and returns their handles; each owner then tracks the returned handles its own way. The per-edge geometry and the per-edge shadow layer live in one module-private list beside it, so the two owners can never drift apart.[^shared-builder] A module that creates elements through the seam has precedent in [`Glyphs.ts:115`](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L115).

### Both owners migrate in the same change

The overlay shape, the recipe, and the cost are identical in `VirtualScroller` and `Panel`, and one shared builder serves both. Migrating one and leaving the other would keep a viewport-sized blur on half the library's scroll surfaces and leave `ScrollShadow.ts` exporting two recipes.

---

## Internal Structure

### `core/ScrollShadow.ts`

New imports: `DOM` and the `Handle` type from `~/core/DOM.js`.

```typescript
/**
 * Thickness of each edge strip along its own axis. One extent is enough: the
 * strip's shadow edge sits on the strip's own border, so only the blur's
 * inward bleed is ever visible, and that is spent within `extent`px.
 */
const SCROLL_SHADOW_STRIP_PX = SCROLL_SHADOW_EXTENT_PX;

/** Per-edge strip style: the pinning geometry plus that edge's single inset shadow layer. */
function scrollShadowStripStyles(): readonly Record<string, string>[] {
    const extent = SCROLL_SHADOW_EXTENT_PX + "px";
    const thick  = SCROLL_SHADOW_STRIP_PX  + "px";

    return [
        { position: "absolute", top:    "0", left: "0", right:  "0", height: thick, boxShadow: `inset 0 ${extent} ${extent} -${extent} var(--ts-ss-top, transparent)`    },
        { position: "absolute", bottom: "0", left: "0", right:  "0", height: thick, boxShadow: `inset 0 -${extent} ${extent} -${extent} var(--ts-ss-bottom, transparent)` },
        { position: "absolute", left:   "0", top:  "0", bottom: "0", width:  thick, boxShadow: `inset ${extent} 0 ${extent} -${extent} var(--ts-ss-left, transparent)`   },
        { position: "absolute", right:  "0", top:  "0", bottom: "0", width:  thick, boxShadow: `inset -${extent} 0 ${extent} -${extent} var(--ts-ss-right, transparent)` },
    ];
}

export function appendScrollShadowStrips(host: Handle): readonly Handle[] {
    const strips: Handle[] = [];

    for (const style of scrollShadowStripStyles()) {
        const strip = DOM.sink.createElement("div");

        DOM.sink.apply(strip, { style });
        DOM.sink.appendChild(host, strip);
        strips.push(strip);
    }

    return strips;
}
```

Returned order is always top, bottom, left, right. The strips carry no `pointer-events` of their own — the property inherits, and both hosts already declare `pointer-events: none`.

### `component/container/VirtualScroller.ts`

One new field beside [`_shadowOverlay`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L57), assigned in the constructor right after the host is appended:

```typescript
private _shadowStrips   : readonly Handle[] = [];
// in the constructor, after `DOM.sink.appendChild(clipBox, shadowOverlay)` — and the
// host's own style bag loses its `boxShadow` entry:
this._shadowStrips = appendScrollShadowStrips(shadowOverlay);
```

`ownedHandles()` returns `[clipBox, rowsContainer, shadowOverlay, ...strips]` — clip box first, rows container second, so the tests that index into it positionally keep working.[^owned-order] The owner's `initScroller` already tracks whatever that method returns, so the strips are released with the owner and `dispose()` needs no change. The host stays the clip box's last child, so the strips still paint above the rows.

### `core/Panel.ts`

One new field beside [`_shadowOverlay`](packages/lib/src/typescript/lib/core/Panel.ts#L202). It **must** be `declare`d and seeded in `applyOptions`, next to the existing `this._shadowOverlay = null;` seed at [`Panel.applyOptions:344`](packages/lib/src/typescript/lib/core/Panel.ts#L344): `setScrollShadows` is dispatched from `applyOptions` during the `super()` cascade and its teardown branch iterates this field, so a plain `= []` initialiser would both leave it `undefined` at that first dispatch and clobber the seeded value afterwards.[^declare-trap]

```typescript
declare private _shadowStrips: readonly Handle[];
// applyOptions, beside the existing overlay/handler seeds:
this._shadowStrips = [];
```

`createScrollShadowOverlay` drops `boxShadow` from the host's style bag and appends the strips after the host is in the DOM. The host keeps its `zIndex: 1`, so the strips still paint above the content frame:

```typescript
this._shadowStrips = appendScrollShadowStrips(overlay);

for (const strip of this._shadowStrips) {
    this.trackHandle(strip);
}
```

`removeScrollShadows` releases them inside its existing `if (this._shadowOverlay)` block, before the host itself, mirroring [`Component.disposeFrame`](packages/lib/src/typescript/lib/core/Component.ts#L1508):

```typescript
for (const strip of this._shadowStrips) {
    DOM.sink.removeElement(strip);
    this.untrackHandle(strip);
    DOM.sink.release(strip);
}
this._shadowStrips = [];
```

### What does not change

Everything below keeps its current code and behaviour; the implementer must not touch it.

| Area | Why it is unaffected |
|---|---|
| Host sizing — `resolveShadowOverlaySize` / `applyShadowOverlaySize` / `resizeScrollShadowOverlay` ([Panel:1013](packages/lib/src/typescript/lib/core/Panel.ts#L1013), [:1027](packages/lib/src/typescript/lib/core/Panel.ts#L1027), [:1348](packages/lib/src/typescript/lib/core/Panel.ts#L1348)) | The host is still sized to the viewport box minus the overlay gutter; the strips follow it by CSS |
| `Panel.remeasureScrollMetrics` ([:1077](packages/lib/src/typescript/lib/core/Panel.ts#L1077)) and its read-after-write ordering | The host is still the panel's only in-flow child and still the only thing flooring its `scrollHeight`; absolutely-positioned strips inside it add no flow box and no overflow |
| `Panel`'s `position: sticky` host pinning ([:1282](packages/lib/src/typescript/lib/core/Panel.ts#L1282)) | A sticky box is a containing block for absolute descendants, so the strips pin to it |
| `VirtualScroller.layoutScrollbars`' clip-box resize ([:446](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L446)) | The host is still `width/height: 100%` of the clip box |
| Edge maths and gating — `scrollShadowRamp`, `scrollShadowEdgeValue`, `quantizeShadowEdge`, `ScrollShadowEdges`, both `updateShadows`/`updateScrollShadows`, both `setShadowEdge`, `scrollableAxes`, `showsScrollAffordance` | Unchanged: still whole-percent quantisation, still `null` at zero so the layer falls back to `transparent`, still one property write per changed edge on the host |
| `PanelOptions.scrollShadows`, `setScrollShadows`/`getScrollShadows`, `Theme.scroll.shadowColor` | No API or token change |

---

## Ordered Implementation Steps

1. **`core/ScrollShadow.ts` — add the strip builder.** Import `DOM` and `type { Handle }` from `~/core/DOM.js`. Add `SCROLL_SHADOW_STRIP_PX`, the module-private `scrollShadowStripStyles()`, and the exported `appendScrollShadowStrips(host)` exactly as in `## Internal Structure`. Leave `scrollShadowBoxShadow()` in place for now so the tree keeps compiling. Check: `npm run typecheck` → 0 errors.

2. **`core/ScrollShadow.ts` — update the module and constant doc comments.** The module header (lines 3–12) describes "the box-shadow recipe" and one overlay element per owner; `SCROLL_SHADOW_EXTENT_PX`'s comment (line 25) mentions "the overlay's four-shadow geometry". Reword both for the strip shape: one strip per edge, each carrying one layer of the recipe, each gated by its own custom property inherited from the host. Do not restate the reasoning that belongs in this plan.

3. **`component/container/VirtualScroller.ts` — migrate.** Replace `scrollShadowBoxShadow` in the import at [line 10](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L10) with `appendScrollShadowStrips`. Add the `_shadowStrips` field. Delete the `boxShadow` entry from the host's style bag ([line 109](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L109)) and assign `this._shadowStrips = appendScrollShadowStrips(shadowOverlay);` after the `DOM.sink.appendChild(clipBox, shadowOverlay)` call. Keep the creation inline in the constructor — this file builds every element that way; do not extract a helper method.

4. **`component/container/VirtualScroller.ts` — extend `ownedHandles()`.** Return `[this._clipBox, this._rowsContainer, this._shadowOverlay, ...this._shadowStrips]` and correct the doc comment, which says "the two created container handles (clip box and rows container)" and is already stale by one element. Check: `grep -n 'ownedHandles' -A3 packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` shows the clip box first.

5. **`component/container/VirtualScroller.ts` — update the overlay comment block** at [lines 93–100](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L93): it currently explains the four-layer `box-shadow` on the overlay. Say instead that the element is an inert host carrying the per-edge custom properties, and that the four strips inside it paint the edges.

6. **`core/Panel.ts` — migrate.** Replace `scrollShadowBoxShadow` in the import at [line 14](packages/lib/src/typescript/lib/core/Panel.ts#L14) with `appendScrollShadowStrips`. Add `declare private _shadowStrips: readonly Handle[];` beside `_shadowOverlay` ([line 202](packages/lib/src/typescript/lib/core/Panel.ts#L202)) with a comment pointing at the same super-cascade reason the neighbouring fields give, and seed `this._shadowStrips = [];` in `applyOptions` beside `this._shadowOverlay = null;` ([line 344](packages/lib/src/typescript/lib/core/Panel.ts#L344)).

7. **`core/Panel.ts` — create the strips.** In `createScrollShadowOverlay` ([line 1271](packages/lib/src/typescript/lib/core/Panel.ts#L1271)): drop the `boxShadow` entry (and its comment) from the `_shadowOverlayStyle.setMany` bag, then after the existing `trackHandle(overlay)` call, append the strips and `trackHandle` each, as in `## Internal Structure`. Update the method's doc comment, which promises "four blurred inset edge shadows" on the overlay.

8. **`core/Panel.ts` — release the strips.** In `removeScrollShadows` ([line 1308](packages/lib/src/typescript/lib/core/Panel.ts#L1308)), inside the existing `if (this._shadowOverlay)` block and **before** the host's own `removeElement`/`untrackHandle`/`release`, add the strip loop and reset `this._shadowStrips = []`. Check: `grep -n '_shadowStrips' packages/lib/src/typescript/lib/core/Panel.ts` — six sites (declaration, `applyOptions` seed, the assignment and the track loop in `createScrollShadowOverlay`, the release loop and the reset in `removeScrollShadows`), and no other method touches the field.

9. **Delete `scrollShadowBoxShadow()`** from `core/ScrollShadow.ts`. Check: `grep -rn 'scrollShadowBoxShadow' packages/` → zero matches. Then `npm run typecheck` and `npm run lint` → 0 errors.

10. **`packages/lib/tests/component/container/VirtualScroller.test.ts` — add a strip describe block.** Capture the sink (`const sink = installTestDOM(CONFIG)`), build a scroller with the existing `makeScroller` helper, and assert the cases in `## Expected Behaviour` 1–2. Reuse the `styleOf(sink, handle)` accumulator from [`content-box-containment.test.ts:1042`](packages/lib/tests/component/content-box-containment.test.ts#L1042) (copy it into this file, as each test file declares its own helpers) and read `appendChild` writes from `sink.writes` to find the host's children.

11. **New test file `packages/lib/tests/core/PanelScrollShadowStrips.test.ts`** for `## Expected Behaviour` 3–4. Mirror [`PanelOverlayScrollbar.test.ts`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L85)'s `CONFIG` / `stubMetrics` / `internals` / `lastStyle` idiom, widening its internals interface with `_shadowStrips: readonly Handle[]`. Build panels with `new _Panel({ autoScroll: 'auto' })` + `panel.getElement(true)`, and reach the protected teardown through the established cast — `(panel as unknown as { destructor(): void }).destructor();`, as [`Panel.styleRuleDisposal.test.ts:29`](packages/lib/tests/core/Panel.styleRuleDisposal.test.ts#L29) does.

12. **`docs/reference/changelog/next.md` — add the entry** under `## Fixed` → `### Core` ([line 154](packages/lib/docs/reference/changelog/next.md#L154)), per `## Documentation Impact`.

13. **Run the full gate:** `npm run typecheck`, `npm test`, `npm run lint`, `npm run docs:api` (zero warnings), then the manual checks in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`packages/lib/src/typescript/lib/core/ScrollShadow.ts`](packages/lib/src/typescript/lib/core/ScrollShadow.ts) — `SCROLL_SHADOW_STRIP_PX`, `scrollShadowStripStyles`, `appendScrollShadowStrips`; delete `scrollShadowBoxShadow`; doc comments |
| Modify | [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts) — `_shadowStrips`, host loses `boxShadow`, strip creation, `ownedHandles`, comments |
| Modify | [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — `_shadowStrips` (declared + seeded), host loses `boxShadow`, strip creation in `createScrollShadowOverlay`, strip release in `removeScrollShadows`, comments |
| Modify | [`packages/lib/tests/component/container/VirtualScroller.test.ts`](packages/lib/tests/component/container/VirtualScroller.test.ts) — strip creation + `ownedHandles` coverage |
| Create | `packages/lib/tests/core/PanelScrollShadowStrips.test.ts` — strip creation, release, re-install coverage |
| Modify | [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) — one `## Fixed` → `### Core` entry |

No file is deleted.

---

## Expected Behaviour

### Unit-testable (offline, `installTestDOM` + the recording sink)

1. **`VirtualScroller` creates exactly four strips as children of the shadow host.** After constructing a scroller, the `appendChild` writes whose parent is `ownedHandles()[2]` (the host) are four, in top, bottom, left, right order, and each child's accumulated style matches its row of the table in `## Architecture Decisions` — one `boxShadow` naming only that edge's `--ts-ss-<edge>` property, `position: absolute`, its three pinning offsets, and its one fixed extent. The host's own accumulated style carries **no** `boxShadow` key.

2. **`ownedHandles()` reports seven handles, clip box first.** `[clipBox, rowsContainer, host, top, bottom, left, right]`. Index 0 stays the clip box — [`content-box-containment.test.ts`](packages/lib/tests/component/content-box-containment.test.ts#L1088) reads it positionally.

3. **A scrolling `Panel` creates the same four strips, tracked as owned handles.** For `new _Panel({ autoScroll: 'auto' })` rendered with `getElement(true)`, `_shadowStrips` has four entries, each appended to `_shadowOverlay`, each styled as in case 1; the host's style has no `boxShadow`. A `new _Panel()` (default `autoScroll: 'none'`) creates no host and no strips (`_shadowStrips` is empty).

4. **Disabling the shadows releases every strip; re-enabling creates four fresh ones.** `setScrollShadows(false)` on a rendered scrolling panel records a `release` for each strip handle and empties `_shadowStrips`; a following `setScrollShadows(true)` leaves exactly four strips, not eight. Same for `destructor()` (which routes through `removeScrollShadows`) — four releases, then an empty `_shadowStrips`.

5. **Edge lighting is unchanged.** The existing assertions keep passing verbatim: [`VirtualScroller.test.ts`'s shadow describe](packages/lib/tests/component/container/VirtualScroller.test.ts#L171) (bottom lit at the origin, top lit at the extreme, right lit on horizontal overflow, nothing lit when content fits) and [`PanelScrollChaining.test.ts`](packages/lib/tests/core/PanelScrollChaining.test.ts#L141) (no fade on a clipped axis). Both read the `_shadowEdges` cache, which this change does not touch.

### Manual-verify (paint output and live resize are not exercisable offline)

6. **Visual parity per edge, both owners, both themes.** Each lit edge reads as the same soft cast shadow hugging its border and fading over the same distance as on `master` — in a `Tree` (`VirtualScroller`) and in a scrolling `Panel`, in the light and the dark theme.

7. **No visible cut where a strip ends.** At the 12px mark the fade reaches the surrounding colour smoothly — no band edge, no line. Dark theme is the harsher case.

8. **Corners still darken once, not twice.** Where two edges are lit at a shared corner, the overlap looks as it does on `master` (the two strips overlap there exactly as the two shadow layers did).

9. **A viewport shorter than 24px still paints both edges.** Top and bottom strips overlap rather than being clamped — the same outcome as today's two overlapping layers on one small element. No special case is added for it.

10. **Repaint cost is at most the shadows-disabled cost.** See `## Verification`.

---

## Verification

**Automated.** `npm run typecheck` → 0 errors. `npm test` (typechecks the test project, then `vitest run`) → green, including the new cases. `npm run lint` → 0 errors. `npm run docs:api` → 0 warnings (the typedoc "unsupported TypeScript version" note is the one accepted exception).

**Grep invariants.**

- `grep -rn 'scrollShadowBoxShadow' packages/` → zero matches.
- `grep -n 'boxShadow' packages/lib/src/typescript/lib/core/Panel.ts packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` → zero matches (both hosts lost the property; nothing else in either file sets one).
- `grep -rn 'appendScrollShadowStrips' packages/lib/src/typescript/lib/` → one definition, two imports, two call sites.

**Manual visual (cases 6–9).** `npm run dev` → <http://localhost:8015>.

- `VirtualScroller`: the **Misc.** section's "Show tree component" button opens a `Tree` in a window; shrink the window until the tree overflows, then scroll to mid-list so top and bottom are lit at once. "Show window with table (slow)!" gives the same check on a table body, with four edges lit when scrolled mid-content on both axes.
- `Panel`: the same section's `autoScroll` columns and mode-switch buttons give a natively scrolling panel; scroll to mid-content and check each edge.
- Repeat both with the dark theme (the same section's theme-cycle button, [`MiscPanel.ts:900`](packages/lib/src/typescript/MiscPanel.ts#L900)), which is where a clipped blur tail would show first.
- Case 9: shrink the tree window until the list viewport is under about 24px tall. Both the top and the bottom cue must still paint, overlapping, rather than one disappearing.
- Compare against the same two screens on `master` — screenshot each edge before and after at the same size and theme, and compare side by side rather than from memory.

**Perf A/B (case 10).** In the demo page's console, with the slow-table window open and scrolled mid-content, run:

```js
// Light every edge in the page: the owners write --ts-ss-* on their own host when an
// edge is lit and remove it when it is not, so a root value lights whatever is unlit.
for (const e of ['top', 'bottom', 'left', 'right']) {
    document.documentElement.style.setProperty(`--ts-ss-${e}`, 'rgba(0, 0, 0, 0.28)');
}

const gaps = f => new Promise(done => { const g = []; let last = performance.now(), i = 0;
    (function step(now) { g.push(now - last); last = now;
        if (++i < f) requestAnimationFrame(step); else done(g.slice(1)); })(performance.now()); });

const avg = g => +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(2);

async function wheelBurst(frames = 120) {
    const t = document.querySelector('.Row, .TreeRow');
    const r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const g = []; let last = performance.now(), i = 0;
    return new Promise(done => (function step(now) { g.push(now - last); last = now;
        t.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y,
            deltaY: i < frames / 2 ? 40 : -40, deltaMode: 0 }));
        if (++i < frames) requestAnimationFrame(step); else done(g.slice(1)); })(performance.now()));
}

const lit = avg(await wheelBurst());                     // strips painting
const kill = document.createElement('style');
kill.textContent = 'div[style*="inset"] { box-shadow: none !important; }';
document.head.appendChild(kill);                         // shadows off, same DOM
const off = avg(await wheelBurst());
console.log({ idle: avg(await gaps(60)), lit, off });
```

Pass: `lit` is within about 1ms of `off`. The same script run against a `master` build (where the selector matches the single viewport-sized overlay instead of the strips) gives the before number, which should be clearly worse than both.[^ab-caveat] The measurements this plan rests on came from a Vite-injected harness driving the real WebKitGTK app, kept at `/tmp/claude-1000/-home-jika-typescript-loom/830a3250-2ae3-4aa7-9de8-6a3af9d923eb/scratchpad/qa-harness.ts`; reach for it only if the gutter-drag numbers themselves need reproducing.

---

## Documentation Impact

No public symbol changes, so no typedoc page, sidebar entry, or catalog row moves: `core/ScrollShadow.ts` is not re-exported from any barrel, `appendScrollShadowStrips` and `scrollShadowBoxShadow` are both internal to the library build, and `PanelOptions.scrollShadows` keeps its documented meaning. `llms.txt` indexes no scroll-shadow entry, so it needs no edit.

- **Doc comments** are the substance of this change's documentation: the `ScrollShadow.ts` module header and `SCROLL_SHADOW_EXTENT_PX` comment (steps 1–2), `VirtualScroller`'s overlay comment block and `ownedHandles` doc (steps 4–5), `Panel.createScrollShadowOverlay`'s doc comment (step 7). The repo's [CLAUDE.md](CLAUDE.md) requires the **`document` skill** for writing them — use it, don't hand-write them.
- **[`docs/concepts/theming.md:111`](packages/lib/docs/concepts/theming.md#L111)** needs no change: its claim that the fade depth is a framework constant and only the colour is themed stays true.
- **[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L154)** gets one entry under `## Fixed` → `### Core`, in the voice the neighbouring perf entries use: a scrolling `Panel` and a virtual list (`Tree`, table body) no longer re-blur a viewport-sized shadow on every frame they repaint or resize; the cue now paints on four thin per-edge strips, so the shadow costs its own 12px band instead of the whole viewport. Visually identical; no consumer action is needed.

---

## Potential Challenges

- **A strip escaping the host's box would break `Panel`'s scroll metrics.** The host is the panel's only in-flow child and its height alone floors the element's `scrollHeight`, which [`remeasureScrollMetrics`](packages/lib/src/typescript/lib/core/Panel.ts#L1077) depends on. Mitigation: every strip is pinned inside the host with `left`/`right`/`top`/`bottom` and never given a size in JavaScript, so it cannot extend past the host; box shadows never contribute to overflow at all.
- **`_shadowStrips` is written during the `super()` cascade in `Panel`.** A plain `= []` initialiser both leaves the field `undefined` for the cascade-time `setScrollShadows` dispatch and reverts the seeded value afterwards. Mitigation: `declare` plus the `applyOptions` seed, exactly as the neighbouring `_shadowOverlay` does (step 6).
- **Releasing the host without releasing its children would leak handles.** `DOM.sink.removeElement(host)` detaches the subtree but the registry still holds each strip's handle. Mitigation: the strip loop in `removeScrollShadows` untracks and releases each one first (step 8), and case 4 pins it.
- **A stale `boxShadow` left on either host would keep the whole cost.** Mitigation: the `grep -n 'boxShadow'` invariant in `## Verification` must come back empty for both owner files.
- **The 12px thickness is a visual judgement, not a proof.** Mitigation: manual case 7, in the dark theme; `SCROLL_SHADOW_STRIP_PX` is the single constant to raise if a cut is visible.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/ScrollShadow.ts`](packages/lib/src/typescript/lib/core/ScrollShadow.ts) — the shared recipe and the gating helpers that stay unchanged.
- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts) — host creation (lines 93–112), `ownedHandles` (164–175), the clip-box resize (446), `updateShadows`/`setShadowEdge` (471–502).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) — the shadow field block (196–212), the `applyOptions` seeds (341–350), the host size/edge resolve-and-apply pairs (1013–1064), `remeasureScrollMetrics` (1077), `init` (1137), `destructor` (1170), and the install/create/remove/update/set-edge chain (1243–1415).
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:2583`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2583) — `mountFlashOverlay`, the precedent this change mirrors for a tracked, statically-styled decorative element.
- [`packages/lib/src/typescript/lib/core/Component.ts:1184`](packages/lib/src/typescript/lib/core/Component.ts#L1184) — `trackHandle`/`untrackHandle` (1184, 1221) and `createFrame`/`disposeFrame` (1487, 1508), the create-and-release discipline the `Panel` side follows.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:120`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L120) — `initScroller`, the only consumer of `ownedHandles()`, which tracks whatever it returns.
- [`packages/lib/tests/core/PanelOverlayScrollbar.test.ts:85`](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L85) — the `internals`/`lastStyle` idiom the new `Panel` test file mirrors, plus the host-sizing assertions that must keep passing.

---

## Non-Goals

- **No gradient rewrite.** A `linear-gradient` strip measured the same as a shadow strip, so the cast-shadow look stays.
- **No new configuration.** The extent stays a framework constant, the thickness stays derived from it, and there is no per-edge enable, no themed depth, no new `PanelOptions` field.
- **No change to the edge maths.** Ramp distance, whole-percent quantisation, the `null`-at-zero fallback, and the per-axis suppression all stay exactly as they are.
- **No `Scrollbar` or gutter changes.** The overlay bars and their reservations are untouched; the strips inherit their inset from the host they sit in.
- **No new demo screen.** Verification uses the existing **Misc.** section; the library's demo gains nothing for this change.

---

## Notes

[^measurements]: Real WebKit Web Inspector timelines from a Tauri app on WebKitGTK (software-rendered under WSLg) showed the frame difference during a `Split` gutter drag over a populated `Tree` was entirely `paint`: 64–89ms per frame with the tree populated versus 16–24ms with it empty, with layout and script unchanged. Ablation in a real WebKitGTK harness isolated it to this overlay. Average ms per frame (gutter drag / wheel scroll; idle floor ≈17ms): stock overlay with the typical one or two edges lit **87.2 / 37.6**; stock overlay with all four lit **122.7 / 42.7** (cost scales with lit layers); four 12px strips each with one layer, all four lit **69.2 / 27.8**; the same strips with a `linear-gradient` instead **66.7 / 27.1**; shadow removed entirely **66.0 / 27.0**. Moving the overlay outside the clip box (110.0) and de-compositing the rows (131.3) both made it worse, so neither placement nor compositing is the factor — only the blurred area is. The gradient variant's tie with the shadow variant is why the cast-shadow look is kept.

[^host-stays]: Three reasons, any one of which would be enough. **Invalidation scope:** the per-scroll write is a custom property, and a custom property change invalidates style for everything that could inherit it. Written on a host with four children, that is five elements; written on `VirtualScroller`'s clip box (the alternative if the strips were appended there directly), it would be the entire rows subtree — every pooled row, every frame. **`Panel`'s metrics invariant:** the host is the panel's only in-flow child, so its height alone floors the element's `scrollHeight`, and `remeasureScrollMetrics` is built around sizing it before reading. Keeping it keeps that whole analysis valid with no re-derivation. **Diff size:** the host keeps its sizing path, its `sticky` pinning, its `pointer-events`, its `zIndex`, and its identity in the tests that assert on `_shadowOverlay`'s width and height. This also matches what was measured — the harness injection that produced the 69.2/27.8 numbers left the overlay in place with `box-shadow: none` and appended strips beside it.

[^no-js-geometry]: This is the whole reason a strip is pinned rather than placed. `Panel` resizes its host today with one `setMany({ width, height })` and positions it not at all (`position: sticky` does that on the compositor); `VirtualScroller`'s host is `width/height: 100%` of a clip box that `layoutScrollbars` already resizes. Pinning each strip to the host's edges inherits both, so the per-resize write count stays exactly what it is today and no strip needs its own geometry state. The framework's `Scrollbar` widgets are positioned explicitly (`setX`/`setY`/`setHeight`) because they are `Component`s, and every `Component` is placed by its parent's layout manager in absolute coordinates. A strip is not a `Component` — it is a raw decorative child, the category ARCHITECTURE.md's *One DOM element per class* explicitly allows to stay a raw node — so CSS pinning is available to it, and `CodeEditor.mountFlashOverlay`'s `inset: 0` is the same move.

[^thickness]: Take the top layer, `inset 0 12px 12px -12px COLOR`. The shadow rect is the element's box expanded by 12px on every side (spread `-12`) and then shifted down 12px, so its top edge lands exactly on the element's own top edge while its other three edges fall outside the element. The geometric shadow region inside the element is therefore empty, and everything visible is the blur bleeding inward from that coincident edge — which is equally true of a 12px-tall strip and of a viewport-tall box, because the other three edges of the shadow rect clear the strip too (the spread expands 12px, matching the strip's own thickness). CSS blurs with a Gaussian of standard deviation half the blur radius, so with blur 12 the bleed is σ=6: about 50% of peak alpha at the edge, 16% at 6px, 2.3% at 12px. A 12px strip therefore clips the tail at 2.3% of a peak that is itself at most 0.18 alpha (light) or 0.55 (dark) — under 1/255 and about 3/255 of a step respectively. Doubling the thickness to 24px would take the clip point to 0.13% but also double the blurred area, spending part of the win the strips exist for, so it was rejected; the manual dark-theme check plus the single constant is the cheaper insurance.

[^inherit-on-host]: The alternative — writing each edge's property directly on its own strip — would invalidate one element per edge instead of five, but it needs a per-edge handle map in both owners (`Panel` additionally needs four `InlineStyle` buffers or a switch to raw patches) and changes `setShadowEdge`'s signature in both. Four style recalcs of empty 12px divs per changed edge is not worth that, and keeping the write on the host is also what leaves the existing `setShadowEdge` code, cache, and tests untouched.

[^owned-order]: Two readers index into `ownedHandles()` positionally: [`content-box-containment.test.ts:1088`](packages/lib/tests/component/content-box-containment.test.ts#L1088) and its two sibling cases take `[0]` as the clip box, and the new `VirtualScroller` test takes `[2]` as the host. Appending the strips after the existing three keeps both stable. `VirtualRowView.initScroller` iterates rather than indexing, so it needs no change.

[^declare-trap]: CODE_CONVENTIONS.md's *Fields written during the `super()` cascade* rule. `Component`'s constructor calls `applyOptions`, which dispatches `setScrollShadows`, which calls `refreshScrollShadows`, which calls `removeScrollShadows` whenever shadows are off or `autoScroll === "none"` — the class default. That runs inside `super()`, before any subclass field initialiser, so an `= []` initialiser would leave the teardown loop iterating `undefined` on the way in and would then overwrite whatever the cascade wrote on the way out. `_shadowOverlay` and `_shadowScrollHandler` already carry exactly this treatment and comment at [`Panel.ts:196–203`](packages/lib/src/typescript/lib/core/Panel.ts#L196).

[^shared-builder]: The two owners' creation code is identical mechanics (create four divs, style each, append each to a host) with call-site-specific bookkeeping (`Panel` tracks each handle on the component; `VirtualScroller` hands them to its owner through `ownedHandles`). That is the case CLAUDE.md §2 exempts from its no-abstraction rule — "separating reusable mechanics from call-site-specific writes" — and `ScrollShadow.ts` already exists to be the one place this visual lives. Keeping only the style table shared and duplicating the create/append loop was the alternative; it saves the module an import of `DOM` and buys nothing else.

[^ab-caveat]: The A/B is only as discriminating as the browser's rendering path. On a GPU-composited desktop Chrome the stock overlay may already be cheap, and all three numbers can land within noise — that outcome shows the strips are at worst neutral there, not that the fix does nothing. The regression is a software-rendering one (WebKitGTK under WSLg, "Disabled hardware acceleration because GTK failed to initialize GL"), which is where every reference number above was taken.

---

## Implementation Notes

- **A strip's fixed-extent axis needed a `max-height`/`max-width: 100%` clamp the plan didn't specify.** `## Internal Structure`'s `scrollShadowStripStyles()` pins each strip on only three of its four edges — e.g. the top strip is `top: 0; left: 0; right: 0; height: 12px`, with no `bottom` pin — relying on the fixed extent for the fourth. `## Potential Challenges`' mitigation for "a strip escaping the host's box" claims this is safe because "every strip is pinned inside the host with `left`/`right`/`top`/`bottom` and never given a size in JavaScript," but that's true of only three sides; on a host shorter (or narrower) than `SCROLL_SHADOW_STRIP_PX` — reachable for `Panel` during a transient tiny-layout state (a near-collapsed `Split` pane, a settling resize, or an overlay-scrollbar panel whose gutter inset alone exceeds its client box) — the strip's own border box extends past the host's. The box-shadow this plan replaces never had this failure mode: an inset shadow cannot paint outside its own element's border box, however far its blur reaches, and box-shadow is explicitly excluded from a box's *scrollable* overflow (only real boxes contribute to that). A real `div` that overflows its containing block does contribute, and for `Panel` the host is a descendant of the panel's own scrolling element — so an escaping strip could add spurious scrollable overflow to the panel itself, feeding `remeasureScrollMetrics`/`resolveNativeGutter` a `scrollHeight` taller than reality and reserving a gutter, or scrollbar, for overflow that doesn't exist.

  Fixed by adding `maxHeight: "100%"` (top/bottom strips) or `maxWidth: "100%"` (left/right strips) alongside the existing fixed `height`/`width` in `scrollShadowStripStyles()`. Combined with an explicit `height`/`width`, `max-height`/`max-width` resolves to `min(extent, hostSize)` on that axis — the strip still reaches the full `12px` on any host that offers it, and now clamps to whatever a shorter host actually has instead of overflowing it. This reproduces `## Expected Behaviour` case 9's intended outcome (both edges still paint, overlapping, on a sub-24px viewport) without ever growing the strip's box past the host's, and stays pure CSS with no JavaScript geometry, preserving the `## Architecture Decisions` invariant that strips are "pinned by CSS and never positioned or sized by JavaScript." Found and fixed during this branch's `audit` loop; the fix folds into the original code commit.
