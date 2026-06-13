# TabWindow Unfocused State — Implementation Plan

## Overview

Give [`TabWindow`](../src/typescript/lib/core/TabWindow.ts) an unfocused/inactive visual state that mirrors how the standard [`Window`](../src/typescript/lib/core/Window.ts) flattens its header on blur. Today [`TabWindow.paintActive`](../src/typescript/lib/core/TabWindow.ts#L205) is a no-op, so a blurred tab window looks identical to a focused one — unlike `Window`, whose [`WindowHeader.setActive(false)`](../src/typescript/lib/component/container/WindowHeader.ts#L200) drops the gradient and fills flat gray (`--ts-ui-gutter-bg`).

The work has three coupled parts:

1. A new **`Tab` layout option `barIgnoreParentInsets`** (boolean, default `false`). When `true`, [`Tab.doLayout`](../src/typescript/lib/layout/Tab.ts#L1312) grows the tab **bar** to the container's *outer* edges (absorbing the container content inset) while the tab **content** stays inset exactly as today. The bar **absorbs the absorbed parent inset as its own per-side insets**, so [`TabBar.layoutChrome`](../src/typescript/lib/component/container/TabBar.ts#L2482) lays its hand-positioned chrome (clip frame / tool group / scroll arrows) within the bar's *content frame* and the chrome stays flush with the content edge. This mirrors how `Window` adds its header to the Border NORTH region with `ignoreParentInsets: true` ([Window.ts:77-80](../src/typescript/lib/core/Window.ts#L77)), and reuses the same grow-then-push structure `Border` uses at [Border.ts:836-857](../src/typescript/lib/layout/Border.ts#L836).

2. **Implementing `TabWindow.paintActive(active)`** to swap the bar background between the themed focused fill (`--ts-ui-tab-toolbar-bg`) and the flat unfocused fill (`--ts-ui-gutter-bg`), and constructing the window's `Tab` with `barIgnoreParentInsets: true` so the unfocused fill reaches the window edges.

3. **Neutralizing the three control buttons on blur.** The min/max/close tools carry their own opaque base background (`--ts-ui-window-control-bg`, via the `styleRules` at [TabWindow.ts:90-94](../src/typescript/lib/core/TabWindow.ts#L90)). Recoloring only the strip + tool group leaves those three buttons bright while everything around them goes gray; `paintActive` must also flatten the controls on blur and restore them on focus.

`paintActive` is already driven for any window: [`AbstractWindow.onActivate`](../src/typescript/lib/core/AbstractWindow.ts#L631) calls `paintActive` on focus/blur regardless of subclass, so `TabWindow` already receives the calls — only the body is missing.

---

## Where the 4px content inset comes from (grounding)

A live `TabWindow` reports `getContentInsets()` = **L4 T4 R4 B4**, and the tab bar sits ~4px inset from the window edges on all sides. The source is **not** `_defaultWindowOptions` ([AbstractWindow.ts:106-124](../src/typescript/lib/core/AbstractWindow.ts#L106), which sets no `insets`). It is the **Panel default**: [`_defaultPanelOptions.insets = new Insets(4, 4, 4, 4)`](../src/typescript/lib/core/Panel.ts#L99).

Trace: `AbstractWindow extends Panel<WindowOptions>`; its constructor calls `super(options, _defaultWindowOptions)`; `Panel`'s constructor merges `{ ..._defaultPanelOptions, ...(subclassDefaults ?? {}) }`. Because `_defaultWindowOptions` does not override `insets`, the Panel default `Insets(4,4,4,4)` survives into the merged defaults. `getInsets()` returns `_options.insets ?? _defaultOptions.insets` ([Component.ts:1304-1306](../src/typescript/lib/core/Component.ts#L1304)); with no padding ([Component.ts:1344-1346](../src/typescript/lib/core/Component.ts#L1344)), `getContentInsets()` ([Component.ts:1404-1418](../src/typescript/lib/core/Component.ts#L1404)) returns exactly `Insets(4,4,4,4)`.

`Tab.doLayout` reads this via `container.getContentInsets()` ([Tab.ts:1320](../src/typescript/lib/layout/Tab.ts#L1320)) into `baseX = ci.getLeft()` / `baseY = ci.getTop()` ([Tab.ts:1371-1372](../src/typescript/lib/layout/Tab.ts#L1371)). The 4px gap is real and per-side; the feature *is* needed. The geometry below uses these real per-side insets — whatever a future theme/subclass sets them to — never a hardcoded 4.

---

## Architecture Decisions

### Border-aligned geometry: grow the bar outward, then absorb the leading inset as the bar's own inset

The mechanism mirrors `Border.doLayout`'s NORTH `ignoreParentInsets` block ([Border.ts:836-857](../src/typescript/lib/layout/Border.ts#L836), with the ternaries at 837-840) line for line:

- `Border` sets `northX = northY = 0`, grows the cross span to `northWidth = width + L + R`, computes `northInsetTop = containerInsets.getTop()`, places the region child at `(0, 0, northWidth, prefH + northInsetTop)` with `FillType.BOTH`, and pushes the sibling content down with `middleY = northHeight + northInsetTop`.
- `Tab.doLayout` does the same per side: the bar's origin moves to the container's outer corner on its leading edges, its **cross** span grows to the full outer size, its **depth** grows by the absorbed leading inset, and the content start is pushed in by that same absorbed inset.

`Border` gets away with ~4 lines because its region child (`WindowHeader`) is a **self-laying-out `Panel`** placed with `FillType.BOTH`: the child fills the grown rect and reflows its own content through the standard box model honouring its own `getContentInsets()`. `Border` never touches the child's internals.

`TabBar` is **not** a filling child. Its chrome (clip frame, tool group, scroll arrows) is hand-positioned by literal `setX(0)/setY(0)` against a box the code assumes has zero insets — `layoutChrome`'s own comment reads *"insets are 0"* ([TabBar.ts:2479](../src/typescript/lib/component/container/TabBar.ts#L2479)) — and the bar deliberately `clearInsets()` at construction ([TabBar.ts:493](../src/typescript/lib/component/container/TabBar.ts#L493)) to make that true. The chrome overlays are **raw-appended** to the strip element, not children of any layout manager ([TabBar.ts:503-519](../src/typescript/lib/component/container/TabBar.ts#L503)), so growing the bar's rect leaves them pinned to the outward edge.

**Adopted design.** When `barIgnoreParentInsets`, `Tab` grows the bar rect *and* sets the bar's **own insets** to the absorbed parent insets (the bar-edge that faces content gets 0). `layoutChrome` is then made **inset-aware**: it derives its base origin and main span from the bar's *content frame* once, at the top, and every positioner lays out within that frame. Because the bar's depth grew by exactly the absorbed leading inset and the bar now carries that inset, the content frame is the **original** `thickness`-deep region flush with the content edge — chrome lands pixel-identical to today.

This is the Border model translated to a hand-positioned child: `Border` lets the child's box model consume `northInsetTop`; here `layoutChrome` consumes the bar's own inset explicitly, because there is no intermediate layout manager to do it for free.

### `layoutChrome` becomes inset-aware via a single centralized offset

`getInnerSize()` subtracts `getPerimiterSize()` ([Component.ts:2209-2224](../src/typescript/lib/core/Component.ts#L2209)), which is **insets + border + padding** ([Component.ts:2324-2358](../src/typescript/lib/core/Component.ts#L2324), insets at 2336-2348) — so `getInnerSize` *does* subtract insets. That is exactly why `Tab.doLayout`'s `container.getInnerSize()` ([Tab.ts:1319](../src/typescript/lib/layout/Tab.ts#L1319)) already returns an inset-subtracted `cs.width/height`, and `cs.width + L + R` correctly reconstructs the full outer-box cross span. `layoutChrome`, however, needs the bar's *own* per-side insets to offset the hand-positioned chrome — those it reads from `getContentInsets()` ([Component.ts:1404-1418](../src/typescript/lib/core/Component.ts#L1404)), **once**, threading two derived scalars into the existing math:

```typescript
private layoutChrome(width: number, height: number): void {
    const ci        = this.getContentInsets();
    const vertical  = this.isVertical();
    // Leading offset along each axis (the absorbed parent inset the bar now carries).
    const crossLead = vertical ? ci.getLeft() : ci.getTop();   // west:L / east:0 ; north:T / south:0
    const mainLead  = vertical ? ci.getTop()  : ci.getLeft();
    const mainTrail = vertical ? ci.getBottom() : ci.getRight();

    const toolExtent = this._tools.length > 0 ? this.toolGroupMainExtent() : 0;
    const thickness  = this.stripThickness();
    const mainOuter  = vertical ? height : width;
    const mainInner  = mainOuter - mainLead - mainTrail;       // tab region net of the absorbed main-end insets
    // ... existing arrowReserve / endGap math against mainInner (unchanged shape) ...
}
```

The two scalars `crossLead` and `mainLead` are then added to each positioner's cross/main origin, and `mainInner` already nets out `mainLead + mainTrail`. The depth (`thickness`) is unchanged, so the chrome occupies the inner `thickness` band flush with content and the grown band sits outboard (under the resize border, painted bar-color).

**The default-false path is byte-for-byte unchanged**: when `barIgnoreParentInsets` is false the bar's insets stay `clearInsets()`'d to zero, so `ci` is `0,0,0,0`, `crossLead == mainLead == mainTrail == 0`, `mainInner == mainOuter`, and every `+ crossLead` / `+ mainLead` is `+ 0`. This is the invariant gate, and it requires **no** explicit guard — the zero-inset bar produces the original layout automatically.

### Per-positioner inset-awareness — minimal, centralized

`positionClipFrame`, `positionToolGroup`, and `layoutOverflowArrows` are the three **strip-local** positioners pinned at bar-local origin 0. Each gains `crossLead` on its cross origin and `mainLead` on its main origin, and consumes `mainInner` (already net of the main-end insets):

- **`positionClipFrame`** ([TabBar.ts:2008-2028](../src/typescript/lib/component/container/TabBar.ts#L2008)) — `mainSize = mainInner - leadChrome - trailChrome` (unchanged, `mainInner` already netted); cross origin `setX/Y(0)` → `setX/Y(crossLead)`; main origin `setX/Y(leadChrome)` → `setX/Y(leadChrome + mainLead)`.
- **`positionToolGroup`** ([TabBar.ts:2096-2120](../src/typescript/lib/component/container/TabBar.ts#L2096)) — `mainPos = align === "end" ? 0 : mainInner - toolExtent` → `+ mainLead`; cross origin `setX/Y(0)` → `setX/Y(crossLead)`.
- **`layoutOverflowArrows`** ([TabBar.ts:2246-2295](../src/typescript/lib/component/container/TabBar.ts#L2246)) — `leadPos` / `trailPos` → `+ mainLead`; the cross origin `setX(0)` / `setY(0)` → `crossLead`.

**Centralize the offset at the top of `layoutChrome`** (compute `crossLead`/`mainLead`/`mainTrail`/`mainInner` once) and pass the two scalars as extra parameters to those three positioners. `layoutOverflowChrome` ([TabBar.ts:2189-2197](../src/typescript/lib/component/container/TabBar.ts#L2189)) is a pass-through that gates on `_scrollable`/`arrowReserve` — it accepts the two scalars and forwards them to `layoutOverflowArrows` unchanged.

**These positioners need ZERO change** because they read centralized/clip-local values:

- **`positionIndicator`** ([TabBar.ts:2126-2143](../src/typescript/lib/component/container/TabBar.ts#L2126)) — reads the active wrapper's coordinate *within the clip's box* (`wrapper.getX()/getY()`) and is CSS-pinned to the clip's inner edge. The clip frame itself is now offset by `crossLead`/`mainLead`, so the indicator inherits **both** shifts for free. Adding the offset here would double-shift it.
- **`positionCloseButtons`** ([TabBar.ts:2151-2177](../src/typescript/lib/component/container/TabBar.ts#L2151)) — each ✕ is positioned relative to its tab `wrapper`, which lives inside the now-offset clip frame, so it inherits the shift for free.
- **`applyUnderBorder`** ([TabBar.ts:674-693, re-verify](../src/typescript/lib/component/container/TabBar.ts#L674)) — a box-edge CSS `border{Top,Bottom,Left,Right}` set on the strip *box itself* via `this.setBorder({...})`, anchored to the box's content-facing edge. Because the strip box now grows to the content edge, the content-facing border already lands at the content edge on all four sides; there is no depth coordinate to re-pin.
- **`TabIndicator.applyBarGeometry`** ([TabBar.ts:278](../src/typescript/lib/component/container/TabBar.ts#L278)) — a **private method on `TabIndicator`**, not a `TabBar` chrome positioner. It writes the indicator's own absolute CSS (top/bottom/left/right/transform) relative to the **clip element** the indicator is appended to ([TabBar.ts:636](../src/typescript/lib/component/container/TabBar.ts#L636)). Clip-relative, so it rides the clip's shift and needs no change.

So the change is centralized to: the top of `layoutChrome` (compute offsets once) + three one-line origin additions in three positioners + one pass-through signature.

### Why this is genuinely simpler than the bespoke `ChromeInset` it replaces

The previous draft threaded a bespoke `ChromeInset {crossLead, mainLead, mainTrail}` *struct* as an extra parameter down `placeStrip` → `layoutChrome` → `positionClipFrame` / `positionToolGroup` / `layoutOverflowChrome` → `layoutOverflowArrows`, computed in `Tab.doLayout` from the per-side table. The Border-aligned model:

- **Drops the `ChromeInset` type entirely** and the per-side `crossLead`/`mainLead`/`mainTrail` derivation in `Tab.doLayout` — the per-side asymmetry collapses into "the bar carries the inset on its non-content edges; `getContentInsets()` reports them." `Tab.doLayout` just grows the rect and calls `placeStrip` with the bar's insets (or sets them before).
- **Sources the offset from the bar itself** (`this.getContentInsets()` inside `layoutChrome`) instead of plumbing a struct through `placeStrip`. `placeStrip`'s signature is **unchanged** — no new required parameter, so there is no call-site churn beyond `Tab.doLayout`.
- **Reuses the standard box model** the same way `WindowHeader` rides Border's: the absorbed inset becomes a real component inset, conceptually identical to the Window precedent rather than a one-off geometry helper.

It is *not* a literal 4-line change like Border's, because the chrome is hand-positioned — three positioners still take an explicit `+ crossLead` / `+ mainLead`. But it removes a module-internal type, removes the per-side struct construction, removes a `placeStrip` parameter, and grounds the offset in the framework's existing inset semantics. Net: fewer concepts, fewer signatures, same number of one-line origin edits. **This is the recommended direction and the `ChromeInset` type is dropped.**

### Feasibility: bar insets do NOT disturb thickness / preferred-size measurement

`Tab.doLayout` measures the bar *before* placing it: `this._bar.prepareStrip()` then `const thickness = this._bar.stripThickness()` ([Tab.ts:1368-1373](../src/typescript/lib/layout/Tab.ts#L1368)). The decisive question: does giving the bar non-zero insets inflate/deflate `stripThickness()`?

**No.** `stripThickness()` ([TabBar.ts:1732-1756](../src/typescript/lib/component/container/TabBar.ts#L1732)) computes purely from `_compact`/`STRIP_THICKNESS`, `_fixedWidth`, and the buttons'/tool-group's **preferred sizes** — it never reads the bar's own insets or `getInnerSize`. `prepareStrip()` ([TabBar.ts:2437-2446](../src/typescript/lib/component/container/TabBar.ts#L2437)) only syncs orientation, button styles, and ARIA. Neither is inset-sensitive. So `thickness` is the *content-only* strip depth regardless of the bar's insets.

The placement therefore stays consistent **without double-counting**:

- bar depth placed by `Tab.doLayout` = `thickness + leadingInset` (the grown rect),
- bar inset on its outward edge = `leadingInset`,
- bar **content** depth = placed − inset = `(thickness + leadingInset) − leadingInset = thickness` — exactly the measured value `layoutChrome` lays chrome against via the content frame.

`Tab.getPreferredSize` / `composeSize` / `computeTotalMinSize` likewise call `stripThickness()` ([codegraph: `composeSize → stripThickness`, `computeTotalMinSize → stripThickness`]) — all measure from the same inset-free thickness, so the container's preferred/min size is unchanged by the bar insets. **Set the bar insets in `placeStrip` (or `Tab.doLayout`) at placement time, after all measurement has run** — but even if set earlier the measurement is inset-blind, so the ordering is robust either way.

This measurement-coupling check is the audit's known concern, and it resolves **cleanly in favour** of the Border-aligned model: the bar-inset approach is *not* made more complex by measurement, because the strip's thickness measurement is structurally independent of its insets.

### `barIgnoreParentInsets` state lives on `Tab`, not `TabBar`

The option changes **placement geometry** computed by `Tab.doLayout` (the bar's rect within the container *and* the insets handed to the bar), not any standalone bar behaviour. The backing field belongs on `Tab`.

### No `declare` needed for the backing field

The class-field super-cascade trap (`feedback_class_field_super_trap`) applies only to fields written by setters invoked *during* `super()`. `Tab` is a [`LayoutManager`](../src/typescript/lib/layout/LayoutManager.ts), whose constructor takes no options and never calls `applyOptions` during `super()`. `Tab.applyOptions` runs in `Tab`'s **own constructor body** after `super()` returns. A plain `private _barIgnoreParentInsets: boolean = false` initializer survives. (Contrast: `Component` subclasses must use `declare`.)

### Bar background seam: a low-level color forwarder on `Tab`

Add `Tab.setBarBackgroundColor(color: string)` forwarding to a single bar method `TabBar.setBarSurfaceColor(color)`, mirroring the existing `Tab`→`TabBar` forwarding idioms ([`addTool`](../src/typescript/lib/layout/Tab.ts#L706)). Preferred over a semantic `Tab.setBarActive(active)` because the two color *values* are a `TabWindow` concern (a generic `Tab` has no notion of window focus). `setBarSurfaceColor` must cover **both** opaque painted surfaces — the strip Panel itself ([TabBar.ts:492](../src/typescript/lib/component/container/TabBar.ts#L492)) and the tool-group overlay ([TabBar.ts:515](../src/typescript/lib/component/container/TabBar.ts#L515)) — since both are independently filled with `--ts-ui-tab-toolbar-bg`; painting only the Panel leaves the tool group showing the focused color while the rest darkens.

**Advisory (scroll arrows).** A *general* scrollable `Tab` also paints its two scroll-arrow buttons with `--ts-ui-tab-toolbar-bg` ([TabBar.ts:2212](../src/typescript/lib/component/container/TabBar.ts#L2212)) — a third toolbar surface. This is **moot for `TabWindow`** (its `Tab` is `widthMode: "fixed"`, not `scrollable`, so the arrows are never built). For correctness on a hypothetical scrollable extended `Tab`, `setBarSurfaceColor` also recolors `_scrollLeadButton`/`_scrollTrailButton` when they exist; they are built lazily ([ensureScrollArrows, TabBar.ts:2203](../src/typescript/lib/component/container/TabBar.ts#L2203)), so guard with optional-chaining.

### Reuse `--ts-ui-gutter-bg`; no new token

`TabWindow`'s unfocused fill reuses `--ts-ui-gutter-bg` — the same token [`WindowHeader.setActive`](../src/typescript/lib/component/container/WindowHeader.ts#L206) uses — for consistency with `Window` and so theme switches keep both window kinds in step. No dedicated inactive token is introduced. The focused fill is restored to the *themed default* `--ts-ui-tab-toolbar-bg` as a CSS-var string (not a resolved color), so `paintActive(true)` survives live theme changes exactly as `WindowHeader.setActive(true)` re-sets its gradient.

**Advisory (token fallback).** The bar's construction-time default is the full string `"var(--ts-ui-tab-toolbar-bg, #eee)"` ([TabBar.ts:492](../src/typescript/lib/component/container/TabBar.ts#L492), [515](../src/typescript/lib/component/container/TabBar.ts#L515)). When `paintActive(true)` restores the focused color it passes the **same** string `"var(--ts-ui-tab-toolbar-bg, #eee)"` so the restored fill is byte-for-byte the construction default. The blur fill carries an analogous `var(--ts-ui-gutter-bg, rgb(200, 200, 200))` fallback.

### Control-button neutralization on blur — via a new public `Component.setBackground` shorthand setter

`WindowHeader`'s trailing buttons carry **only** `:hover`/`:active` style rules ([WindowHeader.ts:84-91](../src/typescript/lib/component/container/WindowHeader.ts#L84)) — no opaque base background — so they flatten with the header automatically. `TabWindow`'s control buttons instead carry an opaque **base** (`suffix: ""`) rule `background: var(--ts-ui-window-control-bg)` ([TabWindow.ts:90-94](../src/typescript/lib/core/TabWindow.ts#L90)), which is precisely why they stay bright on blur.

**The seam must be public, theme-safe, and win over the construction-time base rule.** `Component.createStyleRule` is `protected` ([Component.ts:553](../src/typescript/lib/core/Component.ts#L553)) and `Button` is not a subclass of `TabWindow`, so calling it on a foreign `Button` from `TabWindow.setControlsActive` is a TypeScript access error. It is also the wrong shape for the token: `--ts-ui-window-control-bg` is a **gradient** in `ClassicTheme` and a **flat color** in Modern/Dark, so the swap must use the CSS `background` **shorthand** — `setBackgroundColor` alone cannot hold a gradient, and a `background-color: transparent` on blur would not hide a gradient set through the `background` shorthand.

**Decision — add a minimal public `Component.setBackground(value: string)` shorthand setter.** Component has no public shorthand setter today — only the longhand `setBackgroundColor`/`setBackgroundImage` at [Component.ts:1436](../src/typescript/lib/core/Component.ts#L1436)/[1479](../src/typescript/lib/core/Component.ts#L1479) — so this is genuinely new. It mirrors `setBackgroundColor`'s structure exactly — idempotency guard, an option-bag backing field (`ComponentOptions.background`), and a deferred DOM write via `setElementCSSRule("background", value)` — but writes the **`background` shorthand** instead of the `background-color` longhand. `setControlsActive` then routes through it:

- **On blur:** `control.setBackground("transparent")` — the shorthand resets **all** background layers (color *and* image), so the Classic gradient disappears too and the unfocused gutter-colored bar surface shows through uniformly.
- **On focus:** `control.setBackground("var(--ts-ui-window-control-bg)")` — the exact construction token, restoring the gradient (Classic) or the flat color (Modern/Dark) uniformly, tracking the theme.

**Why this overrides the construction base rule (no specificity battle).** The construction-time base background was set via the `styleRules: [{ suffix: "", … }]` option, which routes through `createStyleRule("")` → a `StyleRule` whose selector is `#<id>` ([StyleTarget.ts:196](../src/typescript/lib/core/StyleTarget.ts#L196)). `setBackground` → `setElementCSSRule` writes to the component's `_styleRule`, whose selector is **also** `#<id>`. The shared-sheet lookup dedupes by `selectorText` ([StyleTarget.ts:206-224](../src/typescript/lib/core/StyleTarget.ts#L206)), so both resolve to the **same** `CSSStyleRule` — `setBackground` overwrites the *same `background` property on the same rule*, last-write-wins, with no specificity question. It leaves the controls' `border`/`boxShadow` (Classic) and the `:hover`/`:active` rules (separate suffixes → separate rules) fully intact. A small private helper `setControlsActive(active: boolean)` iterating `[_minTool, _maxTool, _closeTool]` keeps `paintActive` terse.

### Color/state values live in `TabWindow`, not `Tab` or the bar

`TabWindow.paintActive` owns both decisions: the bar-color swap (via `Tab.setBarBackgroundColor`) and the control recolor (via its own buttons). The bar's *construction-time* default stays `--ts-ui-tab-toolbar-bg` (unchanged), so a standalone `Tab`/`TabPanel` is byte-for-byte identical. No hardcoded colors enter `TabWindow` — only token strings.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/layout/Tab.ts
export interface TabOptions extends LayoutManagerOptions {
    // ...existing fields...
    /**
     * When true, the tab bar extends to the container's outer edges (ignoring
     * the container's content insets) while the tab content stays inset; the bar
     * absorbs the parent inset as its own inset so its chrome stays flush with the
     * content. Mirrors a Border NORTH region's `ignoreParentInsets`. Defaults to false.
     */
    barIgnoreParentInsets?: boolean;
}

class Tab extends LayoutManager {
    private _barIgnoreParentInsets: boolean = false;   // plain initializer is safe (see decisions)

    setBarIgnoreParentInsets(value: boolean): this;    // caches + getContainer()?.scheduleLayout()
    isBarIgnoreParentInsets(): boolean;
    setBarBackgroundColor(color: string): this;        // forwards to _bar.setBarSurfaceColor
}
```

```typescript
// src/typescript/lib/component/container/TabBar.ts — placeStrip signature UNCHANGED
class TabBar extends Panel {
    placeStrip(x: number, y: number, width: number, height: number): this;   // unchanged
    setBarSurfaceColor(color: string): this;   // strip bg + _toolGroup bg (+ scroll arrows if built)
    // layoutChrome now reads this.getContentInsets() for the offset; no new ChromeInset type.
}
```

```typescript
// src/typescript/lib/core/Component.ts — new public shorthand setter (mirrors setBackgroundColor)
export interface ComponentOptions {
    // ...existing fields...
    background?: string;   // CSS `background` shorthand (color OR gradient/image)
}

class Component {
    setBackground(background: string): this;   // guard + setElementCSSRule("background", background)
    getBackground(): string | null;            // _options.background ?? null
    clearBackground(): this;                    // setElementCSSRule("background", null)
}
```

```typescript
// src/typescript/lib/core/TabWindow.ts
protected paintActive(active: boolean): void {
    this._tab.setBarBackgroundColor(
        active ? "var(--ts-ui-tab-toolbar-bg, #eee)" : "var(--ts-ui-gutter-bg, rgb(200, 200, 200))"
    );
    this.setControlsActive(active);
}

private setControlsActive(active: boolean): void {
    const background = active ? "var(--ts-ui-window-control-bg)" : "transparent";
    for (const button of [this._minTool, this._maxTool, this._closeTool]) {
        button.setBackground(background);   // public shorthand setter; clears all bg layers on "transparent"
    }
}
```

The `background` shorthand setter dispatch is added to `applyOptions` alongside `backgroundColor` ([Component.ts:399](../src/typescript/lib/core/Component.ts#L399)): `if (opts.background !== undefined) this.setBackground(opts.background);`. `getBackground`/`clearBackground` are added for parity with the existing longhand setters; `setControlsActive` itself uses only `setBackground` (blur passes `"transparent"`, which resets all layers without a separate clear call).

`placeStrip`'s signature is **unchanged** — `layoutChrome` sources the offset from the bar's own `getContentInsets()`, so there is no new required parameter and no call-site churn beyond `Tab.doLayout` setting the bar insets.

---

## Internal Structure

### `Tab.doLayout` — grow the bar rect (Border-aligned) and set the bar insets

`ci = container.getContentInsets()`; `L = ci.getLeft()`, `T = ci.getTop()`, `R = ci.getRight()`, `B = ci.getBottom()`. `cs = containerSize`; `baseX/baseY` the existing inset origins; `thickness` the measured strip thickness (inset-blind — see feasibility decision). In the existing `switch (this._bar.getSide())` block ([Tab.ts:1386-1410](../src/typescript/lib/layout/Tab.ts#L1386)), gate on `this._barIgnoreParentInsets`:

- **false** — `toolbar*` exactly as today; bar insets cleared to zero. `content*` untouched.
- **true** — grow the bar per the per-side table below, and set the bar's own insets to the absorbed parent insets (the content-facing edge = 0). `content*` untouched.

Per-side bar rect + bar insets (modeled on Border's NORTH `northX/northY=0`, `northWidth=width+L+R`, `depth += northInsetTop`):

| Side | Bar rect `(x, y, w, h)` | Bar insets `(top, right, bottom, left)` |
|------|--------------------------|------------------------------------------|
| north | `(0, 0, cs.width + L + R, thickness + T)` | `(T, R, 0, L)` |
| south | `(0, baseY + cs.height - thickness, cs.width + L + R, thickness + B)` | `(0, R, B, L)` |
| west  | `(0, 0, thickness + L, cs.height + T + B)` | `(T, 0, B, L)` |
| east  | `(baseX + cs.width - thickness, 0, thickness + R, cs.height + T + B)` | `(T, R, B, 0)` |

The content-facing edge inset is always 0 (north bottom, south top, west right, east left); the bar's other three edges carry the parent insets. Content rects are exactly today's: north `contentY = baseY + thickness, contentH = cs.height - thickness`; south `contentH = cs.height - thickness`; west `contentX = baseX + thickness, contentW = cs.width - thickness`; east `contentW = cs.width - thickness`.

Then `this._bar.placeStrip(toolbarX, toolbarY, toolbarW, toolbarH)` (unchanged signature). Set the bar insets via `this._bar.setInsets(new Insets(...))` (or `clearInsets()` in the false branch) **before** `placeStrip`, so `layoutChrome` reads them.

### `TabBar.layoutChrome` — read the bar's content frame once

Per the *layoutChrome becomes inset-aware* decision: compute `crossLead` / `mainLead` / `mainTrail` from `this.getContentInsets()` and `mainInner = mainOuter - mainLead - mainTrail` at the top, then add `crossLead`/`mainLead` to the three strip-local positioners' origins. `positionIndicator`, `positionCloseButtons`, `applyUnderBorder`, and the indicator-owned `TabIndicator.applyBarGeometry` are untouched (clip-local / box-edge — they inherit the shift). With zero bar insets this reduces to the current body verbatim.

### `setBarSurfaceColor` forwarder

```typescript
setBarSurfaceColor(color: string): this {
    this.setBackgroundColor(color);
    this._toolGroup.setBackgroundColor(color);
    this._scrollLeadButton?.setBackgroundColor(color);    // no-op until arrows exist
    this._scrollTrailButton?.setBackgroundColor(color);
    return this;
}
```

`Tab.setBarBackgroundColor` forwards to it; **no** `scheduleLayout` — a recolor is not a relayout.

---

## Ordered Implementation Steps

1. **`TabBar.ts`** — make `layoutChrome` inset-aware: read `this.getContentInsets()` once at the top, derive `crossLead`/`mainLead`/`mainTrail` and `mainInner = mainOuter - mainLead - mainTrail`. `placeStrip` is unchanged.
2. **`TabBar.ts`** — pass `crossLead`/`mainLead` to the three strip-local positioners — `positionClipFrame`, `positionToolGroup`, and `layoutOverflowChrome` → `layoutOverflowArrows` (the `layoutOverflowChrome` intermediate at [TabBar.ts:2189-2197](../src/typescript/lib/component/container/TabBar.ts#L2189) forwards them) — each adding `mainLead` to its main origin and `crossLead` to its cross origin. Leave `positionIndicator`, `positionCloseButtons`, `applyUnderBorder`, and the indicator-owned `TabIndicator.applyBarGeometry` untouched. Verify the zero-inset path reproduces the current body byte-for-byte.
3. **`TabBar.ts`** — add `setBarSurfaceColor(color)` (strip + `_toolGroup` + optional scroll arrows). Place near the background setup.
4. **`Tab.ts`** — add `barIgnoreParentInsets?: boolean` to `TabOptions` (after `reorderable?:`, [Tab.ts:185](../src/typescript/lib/layout/Tab.ts#L185)) with JSDoc.
5. **`Tab.ts`** — add `private _barIgnoreParentInsets: boolean = false;` to the field block.
6. **`Tab.ts`** — add the `applyOptions` dispatch `if (options.barIgnoreParentInsets !== undefined) { this.setBarIgnoreParentInsets(options.barIgnoreParentInsets); }` (in `applyOptions`, near [Tab.ts:362](../src/typescript/lib/layout/Tab.ts#L362)).
7. **`Tab.ts`** — add typed `setBarIgnoreParentInsets(value)` (cache field, `getContainer()?.scheduleLayout()`, return `this`) and `isBarIgnoreParentInsets()`, following the [`setCompact`](../src/typescript/lib/layout/Tab.ts#L617) shape.
8. **`Tab.ts`** — add `setBarBackgroundColor(color)` forwarder to `_bar.setBarSurfaceColor` (no `scheduleLayout`), following the [`addTool`](../src/typescript/lib/layout/Tab.ts#L706) idiom.
9. **`Tab.ts`** — in `doLayout`, gate the bar-rect growth on `this._barIgnoreParentInsets` within the side switch ([Tab.ts:1386-1410](../src/typescript/lib/layout/Tab.ts#L1386)); set the bar's per-side insets (or `clearInsets()` when false) **before** `placeStrip` ([Tab.ts:1412](../src/typescript/lib/layout/Tab.ts#L1412)). Leave all `content*` untouched.
10. **`Component.ts`** — add `background?: string` to `ComponentOptions` (after `backgroundImage?:`, [Component.ts:113](../src/typescript/lib/core/Component.ts#L113)); add the public `setBackground(value)` (idempotency guard on `_options.background`, `setElementCSSRule("background", value)`, return `this`), `getBackground()`, and `clearBackground()` next to the existing `setBackgroundColor`/`setBackgroundImage` setters ([Component.ts:1436-1496](../src/typescript/lib/core/Component.ts#L1436)); add the `applyOptions` dispatch `if (opts.background !== undefined) this.setBackground(opts.background);` beside the `backgroundColor` line ([Component.ts:399](../src/typescript/lib/core/Component.ts#L399)).
11. **`TabWindow.ts`** — construct the `Tab` with `barIgnoreParentInsets: true` ([TabWindow.ts:74](../src/typescript/lib/core/TabWindow.ts#L74)).
12. **`TabWindow.ts`** — replace the no-op [`paintActive`](../src/typescript/lib/core/TabWindow.ts#L205) body with the bar-color swap (focused `"var(--ts-ui-tab-toolbar-bg, #eee)"`, blurred `"var(--ts-ui-gutter-bg, rgb(200, 200, 200))"`) + `setControlsActive(active)`; add the private `setControlsActive` helper routing each control through the new `button.setBackground(...)`; update both JSDocs (no longer no-ops).
13. **Regression check** — `grep -n "barIgnoreParentInsets" src/typescript/lib/layout/Tab.ts` (expect option, field, setter, getter, applyOptions, doLayout gate); `grep -n "setBackground\b" src/typescript/lib/core/Component.ts` (expect the new shorthand setter, getter, clear, applyOptions dispatch); `grep -n "ChromeInset" src/typescript/lib/component/container/TabBar.ts` (expect **zero** — the type is gone); confirm the zero-inset `layoutChrome` path reproduces the original byte-for-byte.

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Modify | `src/typescript/lib/core/Component.ts` (`ComponentOptions.background`, public `setBackground`/`getBackground`/`clearBackground` shorthand setters, `applyOptions` dispatch) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (inset-aware `layoutChrome` reading `getContentInsets()`, `crossLead`/`mainLead` into the three strip-local positioners, `setBarSurfaceColor`; **no** new type, `placeStrip` unchanged) |
| Modify | `src/typescript/lib/layout/Tab.ts` (option, field, setter/getter, applyOptions, forwarder, doLayout bar-rect grow + bar insets) |
| Modify | `src/typescript/lib/core/TabWindow.ts` (`barIgnoreParentInsets: true`, `paintActive` body, `setControlsActive` via `Button.setBackground`) |

---

## Verification

- `npx tsc --noEmit` (or the project typecheck) — zero errors.
- **Default-path invariant:** with `barIgnoreParentInsets` omitted/false, every `Tab`/`TabPanel` lays out identically — the bar's insets stay zero, so `layoutChrome`'s `crossLead`/`mainLead`/`mainTrail` are all 0 and `mainInner === mainOuter`. Spot-check a `TabPanel` demo screen visually (unchanged): tabs, tool group, indicator, close buttons, and scroll arrows all in their original positions.
- **Manual smoke (TabWindow), focused:** the bar fills `--ts-ui-tab-toolbar-bg` edge-to-edge (no inset gap around the bar), and the tabs/controls/indicator sit flush with the content edge with **no empty bar-colored band** between chrome and content.
- **Manual smoke (TabWindow), blurred:** click another window — the whole bar flattens to `--ts-ui-gutter-bg` reaching the window edges, **and the three control buttons flatten with it** (no bright min/max/close). Refocus restores the themed toolbar fill and the opaque control backgrounds.
- **Theme toggle:** switch theme while a `TabWindow` is blurred and again while focused — both bar states and the control buttons track the theme. Check the **classic** theme specifically: focused controls show the gradient `--ts-ui-window-control-bg`, blurred controls lose *only* the bright fill but keep their border/shadow, and refocus restores the gradient (confirms `setBackground("transparent")` cleared the gradient and the restore re-applied it).
- **Four-side spot check:** a non-window `Tab` with `barIgnoreParentInsets: true` on a padded container (insets > 0), for each `side`, shows the bar flush to the container's outer edge on its own edge with full cross-span, chrome flush with content, and content still inset. Confirm the bar's `getContentInsets()` reports the absorbed parent inset and the chrome lands within the inner `thickness` band.
- **Resize still works:** drag each window edge/corner of a `TabWindow` (see Potential Challenges).
- `npm run docs:build` — 0 errors and 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

`barIgnoreParentInsets`, `setBarIgnoreParentInsets`, `isBarIgnoreParentInsets`, and `setBarBackgroundColor` are new public members of `Tab`; `setBarSurfaceColor` is a new public `TabBar` method; `setBackground`/`getBackground`/`clearBackground` (+ `ComponentOptions.background`) are new public members of the base `Component`. The callable-plugin picks up JSDoc automatically.

- `Component` is exported from `src/typescript/lib/core/index.ts`; `Tab` and `TabBar` from `src/typescript/lib/layout/index.ts` and `src/typescript/lib/component/container/index.ts` respectively (per-subpath barrels; no root barrel).
- Update the Tab catalog page under `docs/layout/` (and its `index.md` if it enumerates options) and the sidebar in `docs/.vitepress/config.mts` only if option lists are spelled out there.
- Note `setBarSurfaceColor` on the `TabBar` page if it enumerates the `Tab`-forwarded surface, and the new `Component.setBackground` shorthand setter on the `Component` page if it enumerates the background setters alongside `setBackgroundColor`/`setBackgroundImage`.
- `TabWindow.paintActive` / `setControlsActive` are `protected`/`private` (no doc surface).

---

## Potential Challenges

- **Bar overlaps resize-border hit areas.** Extended to the outer edge, the bar's grown band covers the inset where the resize borders live. This is the same situation `Window`'s `ignoreParentInsets` header creates, and `Window` resize works: the eight borders are appended in `render()` ([AbstractWindow.ts:1540-1547, re-verify](../src/typescript/lib/core/AbstractWindow.ts#L1540)) *after* the layout-manager bar, so they sit later in DOM and keep their hit area over the overlapping band. **Mitigation:** verify resize on all edges/corners; the corners (diagonal) are outside the bar's main span and stay free regardless.
- **Thickness / preferred-size coupling with bar insets.** Giving the bar real insets could in principle inflate the depth `Tab.doLayout` measures before placement. **Mitigation:** `stripThickness()` and `prepareStrip()` are inset-blind (compute from `STRIP_THICKNESS`/`_fixedWidth`/button preferred sizes), so bar depth = `thickness + leadingInset` and bar content depth = `thickness` with no double-count — confirmed in the feasibility decision; setting the insets at placement time after measurement is doubly safe.
- **Indicator / close-button double-shift.** Both live inside the now-offset clip frame and inherit `crossLead`/`mainLead`; adding the offset to their positioners as well would shift them twice. **Mitigation:** only the three strip-local positioners receive the offset; the clip-local positioners are deliberately left out.
- **Cross-edge sign per side.** `crossLead` is the bar's own content-facing inset, which is 0 on the content-facing edge (north bottom, south top, west right, east left) and the absorbed parent inset on the opposite edge — derived directly from `getContentInsets()`, so the per-side asymmetry is encoded by the bar insets set in `Tab.doLayout`, not by a hand-written branch in `layoutChrome`. **Coupling:** the inset table and the `layoutChrome` cross-offset must be implemented together — the offset `crossLead = vertical ? ci.getLeft() : ci.getTop()` is only correct because `Tab.doLayout` sets the bar's content-facing inset to 0 per side (south: top=0; east: left=0). A non-zero content-facing inset would shift the chrome wrongly. **Mitigation:** the per-side inset table fixes each value; the four-side spot check catches a wrong sign.
- **Recolor triggering a relayout.** `setBarBackgroundColor` / `setBarSurfaceColor` must not `scheduleLayout`. **Mitigation:** forwarders omit the schedule (steps 3, 8).
- **Control recolor must overwrite the construction base, not lose to it.** **Mitigation:** `setBackground` → `setElementCSSRule` and the construction `styleRules` both target the `#<id>` selector, which the shared sheet dedupes by `selectorText` into one `CSSStyleRule`; the write overwrites the same `background` property — no duplicate rule, no specificity tie.
- **Gradient (Classic) vs flat color (Modern/Dark) must both clear on blur.** **Mitigation:** the new setter writes the `background` **shorthand**; `"transparent"` resets *all* layers so the Classic gradient is gone too, and the focus restore re-applies the single token uniformly across themes.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `TabOptions`, field block, `applyOptions`, `setCompact` setter shape, `doLayout` bar/content geometry + bar-inset set, `addTool` forwarder idiom, `stripThickness()` call sites that prove measurement is inset-blind.
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — `placeStrip` (unchanged), `layoutChrome` (made inset-aware), the three strip-local positioners (`positionClipFrame`/`positionToolGroup`/`layoutOverflowArrows`) and the `layoutOverflowChrome` pass-through, the clip-local `positionIndicator`/`positionCloseButtons`, the box-edge `applyUnderBorder`, and the indicator-owned clip-relative `TabIndicator.applyBarGeometry` ([TabBar.ts:278](../src/typescript/lib/component/container/TabBar.ts#L278) — a `TabIndicator` method, not a `TabBar` positioner; read to confirm they need **no** change), `stripThickness()`/`prepareStrip()` (inset-blind measurement), the `clearInsets()` at construction (L493) that the inset-aware path overrides, the strip + `_toolGroup` (+ scroll-arrow) `--ts-ui-tab-toolbar-bg` surfaces.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `ComponentOptions` (L105), the `applyOptions` `backgroundColor` dispatch ([L399](../src/typescript/lib/core/Component.ts#L399)), the longhand `setBackgroundColor`/`setBackgroundImage` setters ([L1436](../src/typescript/lib/core/Component.ts#L1436)/[L1479](../src/typescript/lib/core/Component.ts#L1479)) the new `setBackground` shorthand mirrors, `getInsets`/`getContentInsets` ([L1304](../src/typescript/lib/core/Component.ts#L1304)/[L1404](../src/typescript/lib/core/Component.ts#L1404)) and `getInnerSize` ([L2209](../src/typescript/lib/core/Component.ts#L2209)) + `getPerimiterSize` ([L2324-2358](../src/typescript/lib/core/Component.ts#L2324), insets at 2336-2348) confirming `getInnerSize` *does* subtract insets (so `Tab.doLayout`'s `getInnerSize()` cross span is already inset-subtracted; `layoutChrome` reads `getContentInsets()` for the bar's own offset, not because insets are hidden), `createStyleRule` ([L553](../src/typescript/lib/core/Component.ts#L553), `protected` — why a cross-instance call fails).
- [`src/typescript/lib/core/StyleTarget.ts`](../src/typescript/lib/core/StyleTarget.ts) (lines 196, 206-239) — the `#<id>` selector derivation and `selectorText`-keyed shared-sheet dedupe proving the construction `styleRules` base rule and `setBackground`'s `_styleRule` resolve to the **same** `CSSStyleRule`.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) (lines 836-857) — the `ignoreParentInsets` grow-outward-then-push-child-back precedent the bar-inset model mirrors line-for-line (NORTH: `northX/northY=0`, `northWidth=width+L+R`, `middleY=northHeight+northInsetTop`).
- [`src/typescript/lib/core/TabWindow.ts`](../src/typescript/lib/core/TabWindow.ts) — `Tab` construction (L74), control-button `styleRules` already using the `background` shorthand (L90-98), `paintActive` (L205, currently a no-op).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) (line 99) — `_defaultPanelOptions.insets = Insets(4,4,4,4)`, the source of the 4px content inset.
- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — `onActivate`→`paintActive` (L631), Panel inheritance, resize-border append (L1540-1547, re-verify).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) (lines 84-91, 200-210) — the `setActive` blur treatment mirrored, and the hover-only button rules contrasting with TabWindow's opaque control base.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — `--ts-ui-gutter-bg`, `--ts-ui-tab-toolbar-bg`, `--ts-ui-window-control-bg` token definitions.

---

## Non-Goals

- **No new theme token.** `--ts-ui-gutter-bg` is reused.
- **No semantic `Tab.setBarActive`.** The low-level color forwarder is sufficient; `Tab` stays window-agnostic.
- **No change to standalone `Tab`/`TabPanel` appearance.** Default `barIgnoreParentInsets: false`, zero bar insets, and the unchanged bar default color guarantee identical layout and paint.
- **No `ChromeInset` type.** The bespoke per-side struct is dropped in favour of the bar absorbing the parent inset as its own inset, sourced through `getContentInsets()`.
- **No control-button chrome rework.** On blur only the controls' base `background` is toggled; border/shadow/hover/press rules are left intact, matching how `Window` flattens its header without restyling its header buttons.
