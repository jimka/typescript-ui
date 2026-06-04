# Scroll Edge Shadows — Implementation Plan

## Overview

Scrollable `Panel`s currently clip overflowing content with a hard edge: hidden content meets the viewport border with no visual cue that more exists. This plan adds a **position-aware shadow gradient** on each edge where scrolling can still proceed — top shadow appears once scrolled down from the top, hides at the top extreme; same per-axis logic for bottom/left/right.

The behaviour belongs on `Panel`, the class that owns `autoScroll` ([`Panel.setAutoScroll`](../src/typescript/lib/core/Panel.ts#L150)). The autoScroll element is the panel's **own** element with native CSS `overflow` ([`Panel.setAutoScroll:153`](../src/typescript/lib/core/Panel.ts#L153)); its children are wrapped in a persistent **content frame** ([`Component.setContentFrame:740`](../src/typescript/lib/core/Component.ts#L740)) installed by [`LayoutManager.reserveContentFrame:189`](../src/typescript/lib/layout/LayoutManager.ts#L189). Shadows are wired into `Panel` so they are **on by default for every `autoScroll !== "none"` panel** — no per-call-site opt-in — with a single `scrollShadows` escape hatch to disable.

Touches: [`Panel.ts`](../src/typescript/lib/core/Panel.ts) (state, listeners, edge logic), [`Theme.ts`](../src/typescript/lib/core/Theme.ts) + the three theme files (one colour token), [`Event.ts`](../src/typescript/lib/core/Event.ts) (already supports passive `scroll`).

---

## Architecture Decisions

### Live on `Panel`, not `Component` or `LayoutManager`

`Panel` is the sole owner of `autoScroll` and already runs `measureScrollbarGutter` post-layout against the live scroll geometry ([`Panel.doLayout:258`](../src/typescript/lib/core/Panel.ts#L258)). The shadow state is a pure function of the same `scrollTop/scrollHeight/clientHeight` reads, so it is cheapest to compute in the same place that already touches them. `LayoutManager` owns the content frame but not the overflow-mode decision, and `Component` has no scroll concept — putting it there would over-generalise (violating CLAUDE.md §2). Decision: all new state and methods land on `Panel`.

### Overlay element pinned by transform, not pseudo-elements or `box-shadow`

Four independent edge fades are needed; `::before`/`::after` give only two. A `box-shadow` is a single rectangle, not a per-edge gradient, and any pseudo-element or absolutely-positioned child on the scroll element is **clipped by `overflow: auto`** and scrolls away with the content. The shadows must stay pinned to the *visible viewport* (the padding box), not the scroll content.

Decision: append one non-interactive **shadow overlay** `<div>` as the last child of the panel element, built through the existing frame-sheath discipline (id-less, listener-free, deferred-style buffer — mirroring [`Component.createFrame:695`](../src/typescript/lib/core/Component.ts#L695) / `_clipFrame` / `_contentFrame`). It carries `pointer-events: none` so it never intercepts clicks, and is re-pinned to the viewport each scroll via `transform: translate(scrollLeft, scrollHeight…)` so it tracks the scroll port without being clipped. The four edge fades are painted as four `linear-gradient` background layers on this one element; **which fades are visible is driven entirely by toggling CSS classes** (`.ts-scroll-shadow-top` etc.), so the per-scroll handler does class writes + one transform, never a restyle. One element, four data-driven layers — consistent with the one-element-per-class rule (the overlay is a presentational sheath, like the clip/content frames, not a logical child component).

Rationale for transform-pin over `position: sticky`: sticky reliably pins only along one axis per element and needs a sized flow context; a single overlay translated by the live scroll offset covers all four edges deterministically and stays on the compositor.

### Wire listeners once, in `init` — never per layout pass

`Event.addListener` appends to a per-type list and the project has bitten itself stacking duplicate listeners (memory: *Re-wiring stacks duplicate listeners*; CODE_CONVENTIONS "wire once"). The `scroll` listener is registered exactly once, in an `init` override after the element exists, and the bound handler reference is cached so it is never re-added. `setAutoScroll` only flips a boolean + class state; it does not touch listeners.

### `scroll` already routes through the framework event seam as passive + capture

`Event.addListener(panel, "scroll", …)` installs a single window-level **capture-phase** handler ([`Event.installBaseListener:48`](../src/typescript/lib/core/Event.ts#L48)). `scroll` does not bubble, but capture phase descends window→target, so the panel's own scroll reaches the dispatcher, matched by exact target id ([`Event.baseListener:96`](../src/typescript/lib/core/Event.ts#L96)). `scroll` is already in `PASSIVE_TYPES` ([`Event.ts:40`](../src/typescript/lib/core/Event.ts#L40)), so the listener is passive automatically — no main-thread scroll-blocking. We route through `Event.addListener` (not a raw `addEventListener`) per ARCHITECTURE §Event handling ("components own their event surface"), exposed as a small `addScrollListener`/`removeScrollListener` pair on `Component` mirroring [`Component.addMouseDownListener:3811`](../src/typescript/lib/core/Component.ts#L3811).

### Re-use the post-layout DOM-read seam; never read geometry inside a bare `doLayout`

The edge state needs `scrollTop/scrollHeight/clientHeight`. `Panel.doLayout` already calls `commitElementStyle()` before reading scroll geometry precisely because `commitBounds` runs layout with `autoCommitStyle === false` and the new size hasn't reached the DOM (memory: *commitBounds runs doLayout with stale DOM*; [`Panel.doLayout:268`](../src/typescript/lib/core/Panel.ts#L268)). The shadow update reads the same metrics, so it is invoked from the **same point**, right after `measureScrollbarGutter()`, where the DOM is already flushed. The per-scroll path reads from an already-settled DOM, so no extra commit is needed there.

### Suppress entirely when content does not overflow

When neither axis overflows (`scrollHeight <= clientHeight && scrollWidth <= clientWidth`) all four edge classes are off, so the overlay paints nothing. When `autoScroll === "none"` the overlay is never created at all. This is the natural outcome of the edge logic — no special-case branch beyond the `"none"` guard.

### `will-change: transform` only while a scroll-shadow panel is live

Per the will-change memory (precision tool, ~50–100/page budget), the overlay — a permanent scroll-mirror target with no stop lifecycle — gets `will-change: transform` set once when it is created and left set, matching the documented "permanent scroll-mirror target" exception (one per scrollable panel). It is **not** sprinkled on the panel element itself.

---

## Public API (TypeScript Signatures)

### `Panel` (new option + setter/getter)

```typescript
export interface PanelOptions extends ComponentOptions {
    tag?:        string;
    autoScroll?: AutoScrollMode;

    /**
     * When true (the default), an `autoScroll` panel paints a fading edge
     * shadow on each side where hidden content can still be scrolled into
     * view. Set false to suppress the shadows. Ignored while
     * `autoScroll === "none"` (a non-scrolling panel never shows them).
     */
    scrollShadows?: boolean;
}

class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions> {
    // declare — class-field super-cascade trap (mirrors _autoScroll); seeded in applyOptions.
    declare private _scrollShadows:      boolean;
    declare private _shadowOverlay:      HTMLElement | null;
    declare private _shadowOverlayStyle: InlineStyle;
    declare private _onScroll:           (() => void) | null;   // cached bound handler — wire once

    setScrollShadows(enabled: boolean): this;
    getScrollShadows(): boolean;
}
```

`/implement` enforces: `scrollShadows` forwarded in `applyOptions` (always-dispatch through `setScrollShadows`, mirroring the `setAutoScroll` cascade at [`Panel.applyOptions:122`](../src/typescript/lib/core/Panel.ts#L122)); `_scrollShadows` is the cached backing field; `PanelOptions.scrollShadows` is the options field.

### `Component` (new event helpers — thin, mirror the mousedown pair)

```typescript
addScrollListener(listener: Function): this;     // Event.addListener(this, "scroll", listener)
removeScrollListener(listener: Function): this;  // Event.removeListener(this, "scroll", listener)
```

These are generic and reusable (any component can observe its own scroll), so they live on `Component` next to [`addMouseDownListener:3811`](../src/typescript/lib/core/Component.ts#L3811), not on `Panel`. No new cached field — listener bookkeeping lives in `Event.ts` as for mousedown.

---

## Theme Tokens

One colour token. The fade is a `linear-gradient` from this colour to transparent; its size/extent is a framework-fixed constant (not themed), matching how the focus indicator fixes width framework-side and themes only colour ([`Theme.ts:121`](../src/typescript/lib/core/Theme.ts#L121)).

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-scroll-shadow-color` | `rgba(0, 0, 0, 0.18)` | `rgba(0, 0, 0, 0.55)` | Start colour of each edge fade gradient (fades to `transparent`). |

Blocks to edit:
- `Theme` interface ([`Theme.ts:25`](../src/typescript/lib/core/Theme.ts#L25)) — add a `scroll: { shadowColor: string }` block.
- `themeToVars` ([`Theme.ts:556`](../src/typescript/lib/core/Theme.ts#L556)) — add `'--ts-ui-scroll-shadow-color': theme.scroll.shadowColor` near the tail ([`Theme.ts:684`](../src/typescript/lib/core/Theme.ts#L684) region).
- `ClassicTheme.ts`, `ModernTheme.ts`, `DarkTheme.ts` ([`src/typescript/lib/core/themes/`](../src/typescript/lib/core/themes/)) — add the `scroll` block (light value in Classic/Modern, dark value in Dark).

---

## Internal Structure

### Overlay creation (in the `init` override, after `super.init`)

Built once per panel, only when `_scrollShadows` and `autoScroll !== "none"`. Mirrors `createFrame`:

```typescript
// id-less, listener-free presentational sheath
this._shadowOverlay = document.createElement("div");
this._shadowOverlayStyle.attach(this._shadowOverlay);
this._shadowOverlayStyle.setMany({
    position:      "absolute",
    left:          "0px",
    top:           "0px",
    pointerEvents: "none",
    willChange:    "transform",        // permanent scroll-mirror target (will-change budget: 1/panel)
    // four edge gradients, each gated to transparent until its edge class turns it on:
    backgroundRepeat: "no-repeat",
    // gradients + sizes painted via a stylesheet class on the panel element (see below)
});
element.appendChild(this._shadowOverlay);  // last child → paints above content frame
```

The four edge fades are declared **in a static StyleRule / stylesheet keyed off classes on the panel element** so the per-scroll path toggles class names rather than rewriting four `background-image` strings. Sketch of the rule set (one-time, framework stylesheet):

```css
/* base: overlay covers the viewport box, all fades off */
.Panel > [data-scroll-shadow] { background-image: none; }
.Panel.ts-shadow-top    > [data-scroll-shadow] { /* top fade layer */ }
.Panel.ts-shadow-bottom > [data-scroll-shadow] { /* bottom fade layer */ }
.Panel.ts-shadow-left   > [data-scroll-shadow] { /* left fade layer */ }
.Panel.ts-shadow-right  > [data-scroll-shadow] { /* right fade layer */ }
```

Each layer is `linear-gradient(<dir>, var(--ts-ui-scroll-shadow-color), transparent)` with a fixed extent (e.g. `12px`) on the relevant edge.

### Per-update logic (`updateScrollShadows`)

```typescript
private updateScrollShadows(): void {
    if (this._autoScroll === "none" || !this._scrollShadows) {
        return;                       // overlay absent or disabled
    }
    const el = this.getElement();
    if (!el || !this._shadowOverlay) {
        return;
    }
    const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = el;

    // Pin the overlay to the current viewport (it lives inside the scroll port).
    this._shadowOverlayStyle.setMany({
        width:     clientWidth  + "px",
        height:    clientHeight + "px",
        transform: `translate(${scrollLeft}px, ${scrollTop}px)`,
    });

    // Edge state → class toggles (cheap; no restyle).
    el.classList.toggle("ts-shadow-top",    scrollTop  > 0);
    el.classList.toggle("ts-shadow-bottom", scrollTop  + clientHeight < scrollHeight - 1);
    el.classList.toggle("ts-shadow-left",   scrollLeft > 0);
    el.classList.toggle("ts-shadow-right",  scrollLeft + clientWidth  < scrollWidth  - 1);
}
```

The `- 1` epsilon absorbs sub-pixel rounding at the scroll extreme. The `width/height/transform` writes are the only per-scroll style mutations and stay on the compositor (`willChange: transform`).

### Invocation points

- **Scroll:** the cached `_onScroll` handler (registered once via `addScrollListener` in `init`) → `updateScrollShadows()`.
- **Layout / content-size / scrollbar-gutter change:** end of [`Panel.doLayout:258`](../src/typescript/lib/core/Panel.ts#L258), after `measureScrollbarGutter()` (DOM already flushed by the existing `commitElementStyle()` at [`:268`](../src/typescript/lib/core/Panel.ts#L268)).
- **Mode/toggle change:** `setAutoScroll` and `setScrollShadows` call `updateScrollShadows()` (after creating/leaving the overlay) so flipping to/from `"none"` clears stale edge classes.

---

## Ordered Implementation Steps

1. **`Component.ts` — add `addScrollListener` / `removeScrollListener`** next to [`addMouseDownListener:3811`](../src/typescript/lib/core/Component.ts#L3811), each delegating to `Event.addListener`/`removeListener` with type `"scroll"`. Regression: `grep -n 'addScrollListener' src/typescript/lib/core/Component.ts` → two methods.

2. **`Theme.ts` — add the token.** Add `scroll: { shadowColor: string }` to the `Theme` interface ([:25](../src/typescript/lib/core/Theme.ts#L25)); add `'--ts-ui-scroll-shadow-color': theme.scroll.shadowColor` to `themeToVars` ([:556](../src/typescript/lib/core/Theme.ts#L556)). Regression: typecheck flags all three theme files as missing the `scroll` member — next step fixes them.

3. **`ClassicTheme.ts`, `ModernTheme.ts`, `DarkTheme.ts` — add `scroll` block** with the light value (Classic/Modern) and dark value (Dark). Regression: `npm run typecheck` → 0 errors (interface satisfied).

4. **`Panel.ts` — declare state.** Add `declare private _scrollShadows`, `_shadowOverlay`, `_shadowOverlayStyle` (`= new InlineStyle()` is fine here — it is runtime-only, no super-cascade hazard, but follow the existing `declare` style for the boolean to dodge the trap), `_onScroll`. Import `InlineStyle`.

5. **`Panel.ts` — `applyOptions`.** After the `setAutoScroll` dispatch ([:122](../src/typescript/lib/core/Panel.ts#L122)), always dispatch `this.setScrollShadows(opts.scrollShadows ?? true)`. Seed `_shadowOverlay = null` / `_onScroll = null` before first use (mirror the `setScrollbarGutter(0,0)` seeding at [:115](../src/typescript/lib/core/Panel.ts#L115)).

6. **`Panel.ts` — `setScrollShadows` / `getScrollShadows`.** Setter caches `_scrollShadows`, ensures or hides the overlay, and calls `updateScrollShadows()`. When disabled, remove the four edge classes from the element.

7. **`Panel.ts` — `init` override.** Call `super.init(element)`, then (if `autoScroll !== "none"` and shadows enabled) create the overlay (§Internal Structure), register the cached `_onScroll` via `addScrollListener` **once**, and run an initial `updateScrollShadows()`. Guard against double-wiring with the cached handler.

8. **`Panel.ts` — `setAutoScroll`.** At the end of [`setAutoScroll:188`](../src/typescript/lib/core/Panel.ts#L188), call `updateScrollShadows()` so a `"none"` transition strips edge classes and a transition *into* scrolling lights them up. (Overlay creation happens lazily in `init`/`setScrollShadows`; `setAutoScroll` may run pre-DOM, where `updateScrollShadows` early-returns harmlessly.)

9. **`Panel.ts` — `doLayout`.** After `this.measureScrollbarGutter();` ([:269](../src/typescript/lib/core/Panel.ts#L269)) add `this.updateScrollShadows();`. The preceding `commitElementStyle()` guarantees fresh geometry.

10. **`Panel.ts` — `updateScrollShadows`** (private) per §Internal Structure.

11. **Framework stylesheet — edge-fade classes.** Add the `.Panel.ts-shadow-*` gradient rules (and the base `pointer-events:none` overlay marker) wherever the framework's static component CSS lives (locate the existing scrollbar/focus rules; if rules are emitted per-component via `StyleRule`, register them once on the overlay's style buffer instead). Regression: visually confirm gradients fade to transparent.

12. **`index.ts` barrels — no new exports needed** beyond what's re-exported: `PanelOptions` is already re-exported ([`core/index.ts:14`](../src/typescript/lib/core/index.ts#L14)); the new option field rides along. `addScrollListener` is a method on the already-exported `Component`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — state, `applyOptions`, `setAutoScroll`, `setScrollShadows`/`getScrollShadows`, `init`, `doLayout`, `updateScrollShadows` |
| Modify | [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `addScrollListener` / `removeScrollListener` |
| Modify | [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `scroll.shadowColor` in `Theme` + `themeToVars` |
| Modify | [`src/typescript/lib/core/themes/ClassicTheme.ts`](../src/typescript/lib/core/themes/ClassicTheme.ts) |
| Modify | [`src/typescript/lib/core/themes/ModernTheme.ts`](../src/typescript/lib/core/themes/ModernTheme.ts) |
| Modify | [`src/typescript/lib/core/themes/DarkTheme.ts`](../src/typescript/lib/core/themes/DarkTheme.ts) |
| Modify | framework static CSS / `StyleRule` registration site (edge-fade `.ts-shadow-*` rules — locate the existing scrollbar/focus rule sheet during step 11) |
| Modify | [`docs/concepts/theming.md`](../docs/concepts/theming.md) — token table row |
| Modify | [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) — only if a new concept anchor is added |

No files created or deleted.

---

## Verification

- **Typecheck:** `npm run typecheck` → 0 errors (the three themes must satisfy the new `Theme.scroll` member).
- **Listener-once invariant:** `grep -n 'addScrollListener' src/typescript/lib/core/Panel.ts` → exactly one registration site (inside `init`, guarded by the cached `_onScroll`). Confirm `setAutoScroll`/`setScrollShadows`/`doLayout` never call `addScrollListener`.
- **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (the lone acceptable warning is typedoc's "unsupported TypeScript version").
- **Manual smoke — `MiscPanel`:** the demo already builds `autoScroll: 'auto'` columns ([`MiscPanel.ts:153`](../src/typescript/MiscPanel.ts#L153)) and an autoScroll-mode button row ([:947](../src/typescript/MiscPanel.ts#L947)); the slow/large table there is the project's standing overflow stress case (memory: *Perf benchmark: MiscPanel slow table*). On `npm run dev` (http://localhost:8015):
  - Scroll the left column down → top fade appears, bottom fade present until the end, then vanishes at the bottom. Repeat horizontally for a wide table (`autoScroll: 'x'`/`'both'`).
  - Resize the window so content stops overflowing → all fades vanish; `autoScroll: 'none'` → no overlay at all.
  - Click through content *under* a fade → clicks land (overlay `pointer-events: none`).
  - Toggle `ThemeManager.setTheme(DarkTheme)` → fade colour follows the token.
  - With DevTools (F12) open, the table stays "decently fast" while scrolling — confirm the scroll path does class toggles + one transform, no layout thrash (no forced reflow warnings in the Performance panel).

---

## Documentation Impact

- **`docs/concepts/theming.md`:** add a token-table row for `scroll.shadowColor` / `--ts-ui-scroll-shadow-color` next to the existing rows ([:28–46](../docs/concepts/theming.md#L28)).
- **`PanelOptions` API page** ([`docs/api/core/interfaces/PanelOptions.md`](../docs/api/core/interfaces/PanelOptions.md)) regenerates from the JSDoc on the new `scrollShadows` field — no hand edit, but verify it lands after `npm run docs:build`.
- **`Panel` / `Component` API pages** regenerate for the new setter/getter and `addScrollListener`/`removeScrollListener`; ensure each has `@returns`/`@param` JSDoc so typedoc emits clean entries.
- **Cross-bucket links:** all new symbols live in the `core` bucket alongside `Panel`/`Component`/`Theme`, so `{@link …}` resolves intra-bucket — no markdown-link form needed.
- **No new curated page / recipe / sidebar entry** — this is a behaviour addition to an existing class, not a new component.

---

## Potential Challenges

- **Overlay clipped or scrolling with content.** Mitigation: the overlay is a direct child of the scroll element, `position: absolute`, re-pinned each scroll via `transform: translate(scrollLeft, scrollTop)` so it tracks the viewport; verify it is not accidentally placed inside the *content frame* (it must be a sibling of the content frame, appended directly to the panel element after the content frame).
- **Content-frame interaction.** `reserveContentFrame` re-parents children into `_contentFrame` ([`Component.setContentFrame:759`](../src/typescript/lib/core/Component.ts#L759)); the shadow overlay must be appended to the **panel element**, not the content frame, and must be excluded from the child-reparent loop (it is — that loop walks `this._components`, and the overlay is a raw id-less node, not a registered `Component`).
- **Pre-DOM dispatch.** `setAutoScroll`/`setScrollShadows` can run during the super-cascade before the element exists; `updateScrollShadows` and overlay creation early-return when `getElement()` is null, and `init` does the real wiring. Mirror the existing `declare`/seed discipline at [`Panel.applyOptions:115`](../src/typescript/lib/core/Panel.ts#L115) to dodge the class-field super-cascade trap.
- **Sub-pixel scroll extremes.** Some browsers report `scrollTop + clientHeight` a fraction short of `scrollHeight`; the `- 1` epsilon prevents a phantom bottom/right fade at the true end.
- **Listener cleanup.** If panels are destroyed/re-rendered, the cached `_onScroll` must be removed via `removeScrollListener` on teardown to avoid a stale entry; check whether `Panel`/`Component` has a `destroy`/`dispose` hook and hook in there (investigate during implementation — if none exists, the existing components leak similarly and this matches precedent, so flag rather than invent one).
- **macOS overlay scrollbars.** `clientWidth/Height` already exclude overlay scrollbars (which reserve no space), so the transform-pin and edge math are correct there; no special branch needed (parallels `measureScrollbarGutter`'s `trackW === 0` short-circuit at [`Panel.ts:306`](../src/typescript/lib/core/Panel.ts#L306)).

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — owner of `autoScroll`, `doLayout` post-layout seam, the `declare`/seed cascade pattern to mirror.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `createFrame`/`_clipFrame`/`_contentFrame` sheath pattern ([:695–846](../src/typescript/lib/core/Component.ts#L695)), `addMouseDownListener` pair to mirror ([:3811](../src/typescript/lib/core/Component.ts#L3811)), `init`/`render` pipeline ([:3871](../src/typescript/lib/core/Component.ts#L3871)), `setWillChange` ([:3099](../src/typescript/lib/core/Component.ts#L3099)).
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `addListener` capture-phase + `PASSIVE_TYPES` ([:40](../src/typescript/lib/core/Event.ts#L40), [:213](../src/typescript/lib/core/Event.ts#L213)) confirming `scroll` routes passively.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `reserveContentFrame` ([:189](../src/typescript/lib/layout/LayoutManager.ts#L189)) so the overlay is placed relative to the content frame correctly.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) + [`themes/`](../src/typescript/lib/core/themes/) — token plumbing.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — the autoScroll demo + stress table for smoke testing.

---

## Non-Goals

- **No shadows on the custom `Scrollbar` / `VirtualScroller` widgets.** Those manage their own scroll state and explicitly must not stack native overflow ([`Panel.setAutoScroll` remarks:145](../src/typescript/lib/core/Panel.ts#L145)); edge fades there are separate future work, out of scope.
- **No configurable fade size, blur, or per-edge enable.** A single boolean escape hatch plus one colour token is the locked minimal surface (CLAUDE.md §2). Fade extent is a framework constant.
- **No animated fade-in/out of the shadows themselves.** Class toggle is instantaneous; a CSS `transition` on the overlay opacity could be added later but is not requested.
