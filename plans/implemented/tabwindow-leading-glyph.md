---
touches-shared:
  - src/typescript/lib/component/container/TabBar.ts
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/core/TabWindow.ts
depends-on:
  - window-tab-header
---

# TabWindow Leading Window Glyph — Implementation Plan

## Overview

Give [`TabWindow`](../src/typescript/lib/core/TabWindow.ts) a leading window glyph (title icon) pinned to the start of its tab bar, mirroring the leading title glyph an ordinary [`Window`](../src/typescript/lib/core/Window.ts) shows in its [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts). Today `TabWindow` builds a headerless [`Tab`](../src/typescript/lib/layout/Tab.ts) and adds three trailing control tools ([`TabWindow.ts:104-106`](../src/typescript/lib/core/TabWindow.ts#L104)); it never reads `options.glyph` (the option exists on `WindowOptions` at [`AbstractWindow.ts:79`](../src/typescript/lib/core/AbstractWindow.ts#L79) and is cascaded into `_options.glyph` at [`AbstractWindow.ts:313`](../src/typescript/lib/core/AbstractWindow.ts#L313)) and shows no icon.

The chrome lives in [`TabBar`](../src/typescript/lib/component/container/TabBar.ts), the strip Panel owned by `Tab` and hand-laid-out in [`layoutChrome`](../src/typescript/lib/component/container/TabBar.ts#L2509). The bar already has a trailing tool group (`_toolGroup`, [`TabBar.ts:449`](../src/typescript/lib/component/container/TabBar.ts#L449)) positioned at the strip end *opposite* the tabs — its main position flips with `_align` ([`positionToolGroup` TabBar.ts:2128](../src/typescript/lib/component/container/TabBar.ts#L2128)), so it cannot serve a fixed leading edge. This plan adds a **dedicated, align-independent leading slot** to `TabBar` holding one decorative `Glyph`, reserves its main extent in `layoutChrome` exactly the way the trailing `toolExtent` and per-end `arrowReserve` are reserved, and threads a forwarder seam `TabWindow.setGlyph` → `Tab.setBarLeadingGlyph` → `TabBar.setLeadingGlyph` with a `window-maximize` default.

This builds on the just-merged `barIgnoreParentInsets` / `TabWindow.paintActive` work on branch `feature/window-tab-header`; the new lead extent must compose with the inset-aware `crossLead` / `mainLead` / `mainTrail` offsets and `mainInner = mainOuter - mainLead - mainTrail` ([`layoutChrome` TabBar.ts:2515-2524](../src/typescript/lib/component/container/TabBar.ts#L2515)).

---

## Architecture Decisions

### A single raw-appended decorative `Glyph`, not a leading Panel

The trailing slot is a `Panel` (`_toolGroup`) because it hosts *multiple* buttons in a stretching box and must fill its reserved slot ([`TabBar.ts:447-449`](../src/typescript/lib/component/container/TabBar.ts#L447), [`512`](../src/typescript/lib/component/container/TabBar.ts#L512)). The leading slot holds exactly **one** icon, so wrapping it in a Panel + box adds machinery for nothing. Add a single `_leadGlyph: Glyph | null`, raw-appended to the strip element next to `_tabClip` / `_toolGroup` in [`init`](../src/typescript/lib/component/container/TabBar.ts#L641) (built lazily on first `setLeadingGlyph`, the way scroll arrows are built lazily in `ensureScrollArrows`), and hand-positioned in `layoutChrome`. A `Glyph` already self-sizes rigidly: `Glyph.setPreferredSize` pins min == pref == max ([`Glyph.ts:280-286`](../src/typescript/lib/component/display/Glyph.ts#L280)), and a standalone `Glyph` is **not** a `Button`, so it carries no `_syncGlyphSize` theme-reactive resizing — its size is exactly what we set. Confirmed: nothing in `Glyph.ts` re-reads a theme token for size.

### Leading extent reserved symmetrically to `toolExtent`, independent of `_align`

`layoutChrome` currently computes `toolExtent` (trailing, [`TabBar.ts:2521`](../src/typescript/lib/component/container/TabBar.ts#L2521)) and `arrowReserve` (per-end, [`2531`](../src/typescript/lib/component/container/TabBar.ts#L2531)), then `available = mainInner - toolExtent - 2 * arrowReserve` ([`2532`](../src/typescript/lib/component/container/TabBar.ts#L2532)). Add a `leadExtent` reserved at the leading (start) edge **always**, regardless of `_align`. The clip frame, tool group, scroll arrows, and `endAlignGap` math all shift their leading origin past `leadExtent`. Because `leadExtent` is `0` whenever no leading glyph is set, every existing call site reduces to `+ 0` and the default path is byte-for-byte unchanged — the same guarantee the absent-tool-group path already relies on (`toolExtent = 0` when `_tools.length === 0`).

### Decorative glyph: `pointer-events: none`

The bar's empty-area press is the window-move trigger ([`Tab.installBarMoveTrigger` Tab.ts:801](../src/typescript/lib/layout/Tab.ts#L801) → `TabBar.installMoveTrigger`), vetoed only over real chrome (`isBarChromeTarget`, [`TabBar.ts:1084`](../src/typescript/lib/component/container/TabBar.ts#L1084)). The leading glyph is *not* interactive, so rather than enrol it in `isBarChromeTarget` we make it transparent to pointers — `glyph.setPointerEvents("none")` — exactly as `WindowHeader` does for its title row / title glyph ([`WindowHeader.ts:71`](../src/typescript/lib/component/container/WindowHeader.ts#L71), [`164`](../src/typescript/lib/component/container/WindowHeader.ts#L164)). A press on the glyph then falls through to the empty-area move trigger, matching the header's draggable-icon feel. `isBarChromeTarget` is left untouched.

### Glyph is transparent over the recolored bar surface

`paintActive` recolors the bar via `Tab.setBarBackgroundColor` → `TabBar.setBarSurfaceColor`, which paints the strip, `_toolGroup`, and scroll arrows ([`TabBar.ts:622-626`](../src/typescript/lib/component/container/TabBar.ts#L622)). The leading glyph paints with `currentColor` and no background (a `Glyph` sets no background of its own), so the focused/unfocused surface fill shows through it untouched. Deliberately **do not** add `_leadGlyph` to `setBarSurfaceColor` — it must stay transparent, like the `_tabClip` (also absent from that method).

### `Tab` gets no `leadingGlyph` option; `TabWindow` sets it imperatively

`TabWindow` is the only consumer, and it already wires its strip imperatively (`addTool`, `setCloseHostWindowWhenEmpty`). Adding a `leadingGlyph` field to `TabOptions` + `Tab.applyOptions` would be speculative configurability for a single call site (CLAUDE.md §2). `TabWindow` calls `this._tab.setBarLeadingGlyph(...)` in its constructor after building the `Tab`, the same shape as its existing `addTool` calls. The `TabBar.setLeadingGlyph` / `Tab.setBarLeadingGlyph` seam is the public surface; no option is added.

### `TabWindow.setGlyph` for parity with `Window.setGlyph`

`Window` exposes a public `setGlyph` ([`Window.ts:130`](../src/typescript/lib/core/Window.ts#L130)) for runtime icon changes. Mirror it: `TabWindow.setGlyph(glyph)` forwards to `this._tab.setBarLeadingGlyph(glyph)`, so callers get the same API on both window kinds.

---

## Public API (TypeScript Signatures)

```typescript
// TabBar.ts — new leading-glyph slot, symmetric to the trailing tool group.
class TabBar extends Panel<TabBarOptions> {
    private _leadGlyph: Glyph | null;   // null until setLeadingGlyph is first called
    // Sets or clears the always-leading decorative window glyph. `null` removes it.
    setLeadingGlyph(name: string | null): this;
    // Returns the current leading Glyph, or null when none is set.
    getLeadingGlyph(): Glyph | null;
}
```

```typescript
// Tab.ts — forwarder, mirroring addTool / setBarBackgroundColor.
class Tab extends LayoutManager<TabOptions> {
    setBarLeadingGlyph(name: string | null): this;   // → _bar.setLeadingGlyph(name)
}
```

```typescript
// TabWindow.ts — parity with Window.setGlyph; reads options.glyph with a default.
class TabWindow extends AbstractWindow {
    setGlyph(glyph: string): this;   // → _tab.setBarLeadingGlyph(glyph)
}
```

No new `XOptions` field (see _Architecture Decisions_ — `TabWindow` reads the existing `WindowOptions.glyph`).

---

## Internal Structure

### `TabBar.setLeadingGlyph` (lazy build, mirrors `ensureScrollArrows` + `WindowHeader.setGlyph`)

```
setLeadingGlyph(name):
    if name === null:
        if _leadGlyph: detach its element, _leadGlyph = null
        scheduleLayout(); return this
    if _leadGlyph already exists: discard it (a Glyph's tag is fixed at
        construction — Glyph.ts:180-182 — so swapping name means a new instance)
    glyph = new Glyph(name)
    glyph.setPreferredSize(LEAD_GLYPH_SIZE, LEAD_GLYPH_SIZE)  // pins min==pref==max
    glyph.setPointerEvents("none")
    glyph.setZIndex(1)                                        // above tab wrappers, like _toolGroup
    if rendered (getElement() truthy): getElement(true).appendChild(glyph.getElement(true))
    _leadGlyph = glyph
    scheduleLayout(); return this
```

`init` also appends `_leadGlyph` if it was set before first render (mirrors the deferred reorder install at [`TabBar.ts:662`](../src/typescript/lib/component/container/TabBar.ts#L662) and the raw appends at [`651-652`](../src/typescript/lib/component/container/TabBar.ts#L651)).

`LEAD_GLYPH_SIZE` — a module constant of `16` (the `Glyph` default, [`Glyph.ts:167`](../src/typescript/lib/component/display/Glyph.ts#L167)), matching the header title glyph and fitting inside the compact 24px / normal 30px strip thickness band (`STRIP_THICKNESS` constants at [`TabBar.ts:63-66`](../src/typescript/lib/component/container/TabBar.ts#L63)).

### `leadGlyphMainExtent()` (mirrors `toolGroupMainExtent`, [`TabBar.ts:1954`](../src/typescript/lib/component/container/TabBar.ts#L1954))

```
private leadGlyphMainExtent(): number {
    if (!_leadGlyph) return 0
    pref = _leadGlyph.getPreferredSize()           // pinned square, always present
    base = isVertical() ? pref.height : pref.width
    return base + LEAD_GLYPH_GAP                    // size + trailing gap before tabs
}
```

`LEAD_GLYPH_GAP` — a small main-axis pad (e.g. `8`, matching the header title-row `HBox` spacing at [`WindowHeader.ts:69`](../src/typescript/lib/component/container/WindowHeader.ts#L69)) so the first tab does not butt against the icon. Folded into `leadExtent`, never into the glyph's own size.

### `positionLeadGlyph(thickness, crossLead, mainLead)` (mirrors `positionToolGroup`, [`TabBar.ts:2119`](../src/typescript/lib/component/container/TabBar.ts#L2119))

The glyph sits at main origin `0 + mainLead`, cross-centred in the thickness band so a 16px icon floats in the 24/30px strip (the tool group *fills* the thickness via a stretching box; a lone icon should be centred, not stretched):

```
private positionLeadGlyph(thickness, crossLead, mainLead):
    if !_leadGlyph: return
    g = _leadGlyph.getPreferredSize()          // square LEAD_GLYPH_SIZE
    crossOffset = crossLead + round((thickness - g.height_or_width_on_cross) / 2)
    if vertical:
        _leadGlyph.setX(crossOffset); _leadGlyph.setY(mainLead)
    else:
        _leadGlyph.setX(mainLead); _leadGlyph.setY(crossOffset)
    // No width/height set — the Glyph's pinned preferredSize sizes it.
```

---

## Implementation — `layoutChrome` main-axis composition

The single load-bearing change. Current code ([`TabBar.ts:2515-2547`](../src/typescript/lib/component/container/TabBar.ts#L2515)):

```typescript
const toolExtent  = this._tools.length > 0 ? this.toolGroupMainExtent() : 0;
const mainInner   = mainOuter - mainLead - mainTrail;
const arrowReserve = this.computeArrowReserve(mainInner, toolExtent);
const available    = mainInner - toolExtent - 2 * arrowReserve;
const endGap       = this.endAlignGap(available);
this.positionClipFrame(toolExtent, arrowReserve, endGap, thickness, mainInner, crossLead, mainLead);
```

New code introduces `leadExtent` and threads it through:

```typescript
const toolExtent  = this._tools.length > 0 ? this.toolGroupMainExtent() : 0;
const leadExtent  = this.leadGlyphMainExtent();          // 0 when no leading glyph
const mainInner   = mainOuter - mainLead - mainTrail;
const arrowReserve = this.computeArrowReserve(mainInner, toolExtent + leadExtent);
const available    = mainInner - toolExtent - leadExtent - 2 * arrowReserve;
const endGap       = this.endAlignGap(available);
this.positionClipFrame(toolExtent, leadExtent, arrowReserve, endGap, thickness, mainInner, crossLead, mainLead);
this.applyTabWidths(available);
...
this.positionToolGroup(mainInner, toolExtent, thickness, crossLead, mainLead);   // unchanged: tools stay at the opposite end
this.positionLeadGlyph(thickness, crossLead, mainLead);                          // NEW: always at leading origin
...
this.layoutOverflowChrome(mainInner, toolExtent, leadExtent, thickness, arrowReserve, crossLead, mainLead);
```

**`computeArrowReserve`** ([`TabBar.ts:2005`](../src/typescript/lib/component/container/TabBar.ts#L2005)) compares predicted tab extent against `mainInner - toolExtent`. The leading glyph also eats into the tab region, so pass `toolExtent + leadExtent` as the second argument — the signature/body already subtracts that one number (`mainInner - toolExtent`), so rename the param to `reserved` (semantic only) or pass the sum without renaming. The plan passes the sum.

**`available`** subtracts `leadExtent` once (it is reserved at one end only), giving `available = mainInner - toolExtent - leadExtent - 2 * arrowReserve`.

**`endAlignGap`** ([`TabBar.ts:2101`](../src/typescript/lib/component/container/TabBar.ts#L2101)) takes `available` directly — already net of `leadExtent` — so it needs **no** change; the trailing-aligned tabs correctly start after the reserved leading band.

**`positionClipFrame`** ([`TabBar.ts:2029-2049`](../src/typescript/lib/component/container/TabBar.ts#L2029)) gains a `leadExtent` parameter and folds it into the leading origin and span. Current:

```typescript
const toolsLead   = this._align === "end";
const leadChrome  = (toolsLead ? toolExtent : 0) + arrowReserve;
const trailChrome = (toolsLead ? 0 : toolExtent) + arrowReserve;
const mainSize    = mainInner - leadChrome - trailChrome;
```

New — the always-leading glyph adds to `leadChrome` regardless of `toolsLead`:

```typescript
const toolsLead   = this._align === "end";
const leadChrome  = leadExtent + (toolsLead ? toolExtent : 0) + arrowReserve;
const trailChrome = (toolsLead ? 0 : toolExtent) + arrowReserve;
const mainSize    = mainInner - leadChrome - trailChrome;   // == mainInner - leadExtent - toolExtent - 2*arrowReserve == available
```

The clip frame's leading origin is then `leadChrome + mainLead` (the existing [`setX` line 2043](../src/typescript/lib/component/container/TabBar.ts#L2043) / [`setY` line 2038](../src/typescript/lib/component/container/TabBar.ts#L2038)) — already correct once `leadChrome` includes `leadExtent`.

**`layoutOverflowArrows`** ([`TabBar.ts:2273-2322`](../src/typescript/lib/component/container/TabBar.ts#L2273)) positions the leading scroll arrow at `leadPos = (toolsLead ? toolExtent : 0) + mainLead` ([`2295`](../src/typescript/lib/component/container/TabBar.ts#L2295)). The leading glyph reserves before the arrow, so the leading arrow shifts past it: `leadPos = leadExtent + (toolsLead ? toolExtent : 0) + mainLead`. The trailing arrow position ([`2296`](../src/typescript/lib/component/container/TabBar.ts#L2296)) is anchored to `mainInner` / `mainInner - toolExtent` and is **unaffected** by a leading reservation, so it is unchanged. Thread `leadExtent` through `layoutOverflowChrome` → `layoutOverflowArrows`.

**`positionToolGroup`** is unchanged: the trailing tools always sit at the end opposite the tabs, never overlapping the leading glyph.

### Default-path invariance

With no leading glyph, `_leadGlyph === null` ⇒ `leadGlyphMainExtent()` returns `0` ⇒ `leadExtent === 0`. Then `leadChrome` gains `+ 0`, `available` loses `- 0`, `computeArrowReserve` receives `toolExtent + 0`, and `leadPos` gains `+ 0`. Every existing `Tab` / `TabPanel` lays out identically — the same structural guarantee as the `toolExtent === 0` (no tools) path today.

### `stripThickness` is untouched

`stripThickness` ([`TabBar.ts:1751`](../src/typescript/lib/component/container/TabBar.ts#L1751)) derives the cross-axis band from `STRIP_THICKNESS`/`_fixedWidth` and the *cross* extents of tab buttons and tools. A 16px leading glyph fits within the 24/30px band and must **not** widen it — so it is deliberately excluded from `stripThickness`, exactly as the lead glyph sits *within* the existing thickness like the tools' main-axis contribution does. Confirmed `stripThickness` only reads tool **cross** extent for the vertical-strip case ([`1768-1772`](../src/typescript/lib/component/container/TabBar.ts#L1768)); a centred square icon never exceeds the band, so no change is needed there.

---

## Ordered Implementation Steps

1. **`TabBar.ts` — fields + constants.** Add `private _leadGlyph: Glyph | null = null;` near `_toolGroup` ([`TabBar.ts:449`](../src/typescript/lib/component/container/TabBar.ts#L449)). Add module constants `LEAD_GLYPH_SIZE = 16` and `LEAD_GLYPH_GAP = 8` near `STRIP_THICKNESS` ([`63-66`](../src/typescript/lib/component/container/TabBar.ts#L63)). Ensure `Glyph` is imported (check existing imports; `Button` is imported for scroll arrows so the import block exists).
2. **`TabBar.ts` — `setLeadingGlyph` / `getLeadingGlyph`.** Add per _Internal Structure_, lazy-building the `Glyph`, setting `setPreferredSize`, `setPointerEvents("none")`, `setZIndex(1)`, appending to the strip element when rendered, and `scheduleLayout()`. `null` detaches and clears.
3. **`TabBar.ts` — `init` deferred append.** In [`init`](../src/typescript/lib/component/container/TabBar.ts#L641), after the existing `_toolGroup` append ([`652`](../src/typescript/lib/component/container/TabBar.ts#L652)), append `_leadGlyph`'s element if it was set before first render.
4. **`TabBar.ts` — `leadGlyphMainExtent` + `positionLeadGlyph`.** Add both helpers per _Internal Structure_, alongside `toolGroupMainExtent` / `positionToolGroup`.
5. **`TabBar.ts` — `layoutChrome` threading.** Compute `leadExtent`; pass `toolExtent + leadExtent` to `computeArrowReserve`; subtract `leadExtent` in `available`; add a `leadExtent` parameter to `positionClipFrame`, `layoutOverflowChrome`, and `layoutOverflowArrows` and fold it into `leadChrome` / `leadPos` per _Implementation_; call `positionLeadGlyph` after `positionToolGroup`.
6. **`Tab.ts` — forwarder.** Add `setBarLeadingGlyph(name: string | null): this` next to `addTool` ([`Tab.ts:749`](../src/typescript/lib/layout/Tab.ts#L749)), forwarding to `this._bar.setLeadingGlyph(name)` and `this.getContainer()?.scheduleLayout()` (matching `addTool`).
7. **`TabWindow.ts` — apply glyph + default + `setGlyph`.** In the constructor, after the `addTool` calls ([`TabWindow.ts:104-106`](../src/typescript/lib/core/TabWindow.ts#L104)) and before `initChrome`, set the leading glyph: `this._tab.setBarLeadingGlyph(this._options.glyph ?? "window-maximize")` (mirror `WindowHeader`'s explicit-wins-else-default at [`WindowHeader.ts:104-106`](../src/typescript/lib/component/container/WindowHeader.ts#L104)). Note `_options.glyph` is already populated by the super cascade ([`AbstractWindow.ts:313`](../src/typescript/lib/core/AbstractWindow.ts#L313)), exactly as `Window` reads it at [`Window.ts:89`](../src/typescript/lib/core/Window.ts#L89). Add a public `setGlyph(glyph: string): this` forwarding to `this._tab.setBarLeadingGlyph(glyph)`.
8. **Verify glyph registration.** `window-maximize` is registered by `WindowHeader.ts` ([`19`](../src/typescript/lib/component/container/WindowHeader.ts#L19)) via `Glyph.register(window_maximize, ...)`, and `TabWindow` already references `glyph: "window-maximize"` on its max control ([`TabWindow.ts:97`](../src/typescript/lib/core/TabWindow.ts#L97)) — so it is registered globally and needs **no new import in `TabWindow.ts`**. Confirm with the grep in _Verification_.
9. **Default-path regression check.** `grep` / type-check confirm the no-glyph path is unchanged (see _Verification_).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/TabBar.ts` |
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/core/TabWindow.ts` |

---

## Verification

- **Typecheck:** `npm run build` (or the project's `tsc` task) — 0 errors.
- **Glyph registration:** `grep -rn 'Glyph.register' src/typescript/lib/component/container/WindowHeader.ts` — confirm `window_maximize` is registered; no new `import` needed in `TabWindow.ts`.
- **Default-path invariance:** open any non-window `TabPanel` demo screen (the Tab demo); with no leading glyph the strip, tabs, tools, and scroll arrows must be visually and pixel-identically positioned to before. (Scope DevTools queries to the specific panel class — many `TabPanel`s coexist.)
- **Leading glyph appears:** `new TabWindow()` shows a `window-maximize` icon at the start of the bar; `new TabWindow({ glyph: "..." })` shows the override; `win.setGlyph("...")` swaps it at runtime.
- **Move trigger intact:** pressing the bar's blank area still moves the window, and a press *on the glyph* falls through to move (glyph is `pointer-events: none`).
- **Focus recolor shows through:** blur the window — `paintActive(false)` flattens the bar; the glyph stays painted over the flat surface (transparent background), matching the controls.
- **Scroll-arrow composition:** a narrow `TabWindow` with many tabs (if `scrollable`) shows the leading scroll arrow *after* the glyph, not under it; trailing arrow and tools unchanged.
- **Docs:** `npm run docs:build` — 0 errors / 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

- `TabBar`, `Tab`, and `TabWindow` are exported from their per-subpath barrels (`src/typescript/lib/component/container/index.ts`, `src/typescript/lib/layout/index.ts`, `src/typescript/lib/core/index.ts` — there is no root barrel). The new methods are additions on already-exported classes, so no new barrel entry is needed.
- Add JSDoc on `TabBar.setLeadingGlyph` / `getLeadingGlyph`, `Tab.setBarLeadingGlyph`, and `TabWindow.setGlyph` per the project JSDoc convention (`@param`, `@returns`, `@remarks` mirroring `WindowHeader.setGlyph` / `Window.setGlyph`).
- Update the curated `TabWindow` page under `docs/core/` (and its catalog `index.md`) to mention the leading window glyph and the `glyph` option, cross-referencing `Window`'s title icon. Cross-bucket references (`Window`, `WindowHeader`, `Glyph`) use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **`getContentInsets` timing.** `layoutChrome` reads `getContentInsets()` for `crossLead`/`mainLead`/`mainTrail` ([`TabBar.ts:2515-2519`](../src/typescript/lib/component/container/TabBar.ts#L2515)); the leading glyph's origin reuses the same `mainLead`/`crossLead`, so it inherits the `barIgnoreParentInsets` offsets for free — verify the glyph lands inside the grown bar's content frame, not at the absolute strip edge.
- **Glyph cross-centring vs the band.** The lone icon is centred in the thickness, unlike the stretching tool group; if the icon looks high/low against the tabs' baseline, adjust the cross offset (the `Glyph` baseline anchor at [`Glyph.ts:298-302`](../src/typescript/lib/component/display/Glyph.ts#L298) is for inline baseline alignment, not used here — this is a hand-positioned overlay).
- **`scheduleLayout` availability.** `TabBar.setLeadingGlyph` calls `scheduleLayout()`; confirm `TabBar` (a `Panel`) has it — `addTool`/`removeTool` already call it ([`TabBar.ts:1045`](../src/typescript/lib/component/container/TabBar.ts#L1045)), so it exists.

---

## Critical Files

- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — `_toolGroup` ([`449`](../src/typescript/lib/component/container/TabBar.ts#L449)), `init` raw-appends ([`641-667`](../src/typescript/lib/component/container/TabBar.ts#L641)), `toolGroupMainExtent` ([`1954`](../src/typescript/lib/component/container/TabBar.ts#L1954)), `computeArrowReserve` ([`2005`](../src/typescript/lib/component/container/TabBar.ts#L2005)), `positionClipFrame` ([`2029`](../src/typescript/lib/component/container/TabBar.ts#L2029)), `endAlignGap` ([`2101`](../src/typescript/lib/component/container/TabBar.ts#L2101)), `positionToolGroup` ([`2119`](../src/typescript/lib/component/container/TabBar.ts#L2119)), `layoutOverflowArrows` ([`2273`](../src/typescript/lib/component/container/TabBar.ts#L2273)), `setBarSurfaceColor` ([`622`](../src/typescript/lib/component/container/TabBar.ts#L622)), `layoutChrome` ([`2509`](../src/typescript/lib/component/container/TabBar.ts#L2509)), `stripThickness` ([`1751`](../src/typescript/lib/component/container/TabBar.ts#L1751)).
- [`src/typescript/lib/component/display/Glyph.ts`](../src/typescript/lib/component/display/Glyph.ts) — `setPreferredSize` pin ([`280`](../src/typescript/lib/component/display/Glyph.ts#L280)), default `preferredSize` ([`167`](../src/typescript/lib/component/display/Glyph.ts#L167)), fixed-tag-at-construction remark ([`180-182`](../src/typescript/lib/component/display/Glyph.ts#L180)).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `addTool` ([`749`](../src/typescript/lib/layout/Tab.ts#L749)), `setBarBackgroundColor` ([`780`](../src/typescript/lib/layout/Tab.ts#L780)), `installBarMoveTrigger` ([`801`](../src/typescript/lib/layout/Tab.ts#L801)).
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — constructor ([`71-109`](../src/typescript/lib/core/TabWindow.ts#L71)), `paintActive` ([`207`](../src/typescript/lib/core/TabWindow.ts#L207)).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — glyph dispatch ([`89-91`](../src/typescript/lib/core/Window.ts#L89)), `setGlyph` ([`130`](../src/typescript/lib/core/Window.ts#L130)).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — default glyph ([`104-106`](../src/typescript/lib/component/container/WindowHeader.ts#L104)), `setGlyph` ([`157`](../src/typescript/lib/component/container/WindowHeader.ts#L157)), `pointer-events:none` ([`71`](../src/typescript/lib/component/container/WindowHeader.ts#L71), [`164`](../src/typescript/lib/component/container/WindowHeader.ts#L164)), registration ([`19`](../src/typescript/lib/component/container/WindowHeader.ts#L19)).
- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — `glyph` option ([`79`](../src/typescript/lib/core/AbstractWindow.ts#L79)), cascade into `_options.glyph` ([`313`](../src/typescript/lib/core/AbstractWindow.ts#L313)).

---

## Non-Goals

- **No `Tab` / `TabBar` / `TabPanel` `leadingGlyph` option.** Only `TabWindow` needs the leading icon, and it sets it imperatively; a construction option would be speculative configurability (CLAUDE.md §2).
- **No second tool group / multi-element leading slot.** The leading slot holds exactly one decorative `Glyph`; if multiple leading controls are ever needed, that is a separate change.
- **No theme token or new glyph asset.** Reuses the already-registered `window-maximize`; the glyph size is a local constant, not a theme variable.
- **No change to `stripThickness`, `positionToolGroup`, the trailing tools, or `isBarChromeTarget`.** The glyph fits the existing band and is pointer-transparent.
