# Panel Auto-Scroll — Implementation Plan

## Overview

[`Panel`](../src/typescript/lib/core/Panel.ts) is currently a thin [`Component`](../src/typescript/lib/core/Component.ts) subclass whose only behaviour is a 4-pixel inset default ([Panel.ts:25-27](../src/typescript/lib/core/Panel.ts#L25-L27)). When children's preferred sizes exceed the Panel's allocated rect the content silently clips because `Component` defaults `overflow: "hidden"` ([Component.ts:258](../src/typescript/lib/core/Component.ts#L258)). The framework already exposes per-axis overflow setters — `setOverflowX` / `setOverflowY` ([Component.ts:1944-1980](../src/typescript/lib/core/Component.ts#L1944-L1980)) backed by the cached `overflowX` / `overflowY` fields ([Component.ts:180-181](../src/typescript/lib/core/Component.ts#L180-L181)) — but no high-level "let this Panel scroll when it overflows" affordance.

This plan adds a single typed setter, `setAutoScroll(mode)`, on `Panel`. The mode value translates to per-axis `overflow` writes plus a `scrollbar-gutter` style hint. No new class, no new files, native browser scrollbars only.

---

## Architecture Decisions

### Flag on `Panel`, not a new `ScrollPanel` class

A `ScrollPanel` subclass would force callers to remember a new container identity for what is really a one-property toggle. The "should this container scroll when it overflows" question is a setting of the container, not its identity. A flag also means every existing `Panel` subclass — `Window`, `Dialog`, layout-helper panels — inherits the capability without each one re-deriving from a new base. This matches the user's stated leaning and avoids forcing a refactor on consumers who construct `Panel`s today.

### `AutoScrollMode` string union, not a boolean

A boolean (`setAutoScroll(true)`) collapses four reasonable cases — both-axes auto, x-only, y-only, always-on — into one. The string union `"none" | "auto" | "x" | "y" | "both"` is the same character count at the call site and lets the implementation cover all four without follow-up API. `"none"` is the explicit "no, don't scroll" value so the setter also doubles as the reset path.

### Native CSS overflow for v1; reject the project's custom `Scrollbar` for now

[`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts) and [`VirtualScroller`](../src/typescript/lib/component/container/VirtualScroller.ts) are purpose-built for components that own their own scroll state — transform-driven virtual lists (table body, tree) where the owner re-renders a visible window in response to wheel/touch and pushes viewport/content metrics into the bar ([Scrollbar.ts:30-46](../src/typescript/lib/component/container/Scrollbar.ts#L30-L46)). Wiring them up requires a `renderWindow` callback, content-size tracking, and the wheel/touch/momentum handling that `VirtualScroller` already encapsulates.

A generic `Panel` has none of that machinery and shouldn't grow it just to scroll a few overflowing children. Native CSS `overflow: auto` costs zero extra DOM, ships with kinetic scrolling, accessibility, and keyboard support, and works the day the setter lands.

Trade-offs accepted:
- Native scrollbars don't pick up the framework's theme tokens; they render with browser chrome. Acceptable for v1.
- Native arrow-button decoration (cf. the parallel `scrollbar-arrow-buttons` plan, which targets the custom `Scrollbar`) won't apply to native overflow. Acceptable: that plan can also extend to Panel by adding `setScrollbarStyle("themed")` later.

A `setScrollbarStyle("native" | "themed")` knob is **not** added in this plan. It's the natural follow-up if/when consistent theming becomes a requirement, but adding it now is speculative configurability.

### Layout interaction — children get preferred size, Panel lets it overflow

When `autoScroll` is anything other than `"none"`, the Panel's layout no longer caps children to the Panel's own allocated rect. Children render at their preferred size and the Panel's native scroll viewport handles the overflow. This is a behavioural change for any subclass whose `doLayout` currently relies on children being clipped to the allocated rect — verify subclasses don't depend on the clipping side-effect during the implementation step.

The layout manager itself doesn't need new code: `Absolute` and the other layouts already lay children out at their preferred sizes by default; the existing `setOverflowX/Y("hidden")` is what masks the overflow today, and switching that to `"auto"` exposes it as scrollable area without any other layout intervention.

### Reserve scrollbar gutter with `scrollbar-gutter: stable`

In `"auto"` mode the native scrollbar appears only when needed, and on appearance it eats viewport width — potentially triggering a re-layout if children's widths depended on the available viewport. Setting CSS `scrollbar-gutter: stable` reserves the gutter unconditionally, so the viewport width stays constant whether the scrollbar is currently visible or not. Browser support is recent (Chromium 94+, Firefox 97+, Safari 18.2+) — acceptable for the project's target browser baseline; document the requirement in the JSDoc.

In `"none"` mode the gutter is cleared (no scrollbar ever appears, no reservation needed). In `"both"` mode the scrollbar is always visible so reservation is moot; leaving the property unset is fine but writing it doesn't hurt — for code simplicity, set it whenever `mode !== "none"`.

### Backward compatibility

`_autoScroll` defaults to `"none"` and the constructor doesn't write the overflow fields unless `applyOptions` sees an explicit `autoScroll` option. Existing `Panel` instances keep `Component`'s `overflow: "hidden"` default and continue to clip — zero behaviour change for current callers.

---

## Public API (TypeScript Signatures)

```ts
// New in src/typescript/lib/core/Panel.ts
export type AutoScrollMode = "none" | "auto" | "x" | "y" | "both";

export interface PanelOptions extends ComponentOptions {
    tag?:        string;
    autoScroll?: AutoScrollMode;
}

class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions> {
    setAutoScroll(mode: AutoScrollMode): this;
    getAutoScroll(): AutoScrollMode;
    clearAutoScroll(): this;   // equivalent to setAutoScroll("none")
}
```

Cached backing field: `private _autoScroll: AutoScrollMode = "none";`.

Re-export `AutoScrollMode` from the `core` barrel ([src/typescript/lib/core/index.ts:12-13](../src/typescript/lib/core/index.ts#L12-L13)) next to the existing `Panel` / `PanelOptions` exports.

---

## Internal Structure

The setter writes the cached field, dispatches to the existing per-axis `setOverflowX` / `setOverflowY` setters (so the regular `styleRule` queue + `commitCSSRule` path runs), and toggles `scrollbar-gutter` via the same `setElementCSSRule` plumbing those setters use ([Component.ts:631-639](../src/typescript/lib/core/Component.ts#L631-L639)):

```ts
private _autoScroll: AutoScrollMode = "none";

setAutoScroll(mode: AutoScrollMode): this {
    this._autoScroll = mode;
    switch (mode) {
        case "none": this.setOverflowX("hidden").setOverflowY("hidden"); break;
        case "auto": this.setOverflowX("auto").setOverflowY("auto");     break;
        case "x":    this.setOverflowX("auto").setOverflowY("hidden");   break;
        case "y":    this.setOverflowX("hidden").setOverflowY("auto");   break;
        case "both": this.setOverflowX("scroll").setOverflowY("scroll"); break;
    }
    // Reserve gutter so an auto-appearing scrollbar doesn't reflow children.
    this.setElementCSSRule("scrollbarGutter", mode === "none" ? null : "stable");
    return this;
}

getAutoScroll(): AutoScrollMode {
    return this._autoScroll;
}

clearAutoScroll(): this {
    return this.setAutoScroll("none");
}
```

`applyOptions` override on `Panel` (calling `super.applyOptions(options)` first per the cascade contract at [Component.ts:295-298](../src/typescript/lib/core/Component.ts#L295-L298)):

```ts
protected applyOptions(options: TOptions): this {
    super.applyOptions(options);
    if (options.autoScroll !== undefined) this.setAutoScroll(options.autoScroll);
    return this;
}
```

`Panel` does not currently override `applyOptions` — it relies on `Component`'s default plus the constructor's options-bag merge ([Panel.ts:49-55](../src/typescript/lib/core/Panel.ts#L49-L55)). Adding the override is the minimum needed to wire the new option through; no other dispatches move.

---

## Theme Tokens

None. Native scrollbars render with browser chrome; theming them is out of scope. A future `setScrollbarStyle("themed")` follow-up would introduce tokens at that time.

---

## Ordered Implementation Steps

1. **Add `AutoScrollMode` type + `autoScroll?` field to `PanelOptions`** in [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — verify: typecheck clean.
2. **Add `_autoScroll` cached field, `setAutoScroll` / `getAutoScroll` / `clearAutoScroll` methods** to the `Panel` class body — verify: typecheck clean, methods chainable.
3. **Override `applyOptions`** on `Panel` to dispatch `options.autoScroll` to the setter — verify: constructing `new Panel({ autoScroll: "auto" })` produces a panel whose `getAutoScroll()` returns `"auto"`.
4. **Re-export `AutoScrollMode`** from [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — verify: `import { AutoScrollMode } from "ts-ui/core"` resolves.
5. **JSDoc the new setter/getter/clearer + the `AutoScrollMode` type + the `autoScroll?` option field** — explain mode semantics, the `scrollbar-gutter: stable` behaviour, and the children-render-at-preferred-size implication. Same-bucket reference to `Panel` uses `{@link Panel}`; cross-bucket reference (none here) would use markdown links per CLAUDE.md.
6. **Manual smoke screen** — add a Panel-of-overflow to `src/typescript/MiscPanel.ts` (or whichever demo screen the user picks) with `setAutoScroll("auto")` and visibly oversized children. Toggle through `"none"` / `"auto"` / `"x"` / `"y"` / `"both"` to confirm each scrolls / clips correctly.
7. **Verify no regression in `Panel` subclasses** (`Window`, `Dialog`, layout helpers) — `grep -rln 'extends Panel\|extends _Panel' src/typescript/lib` and spot-check each subclass's `doLayout`/`applyOptions` for any assumption that children fit inside the allocated rect.
8. **Run `npm run docs:build`** — expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
9. **Run `graphify update .`** to refresh the knowledge graph.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — add `AutoScrollMode`, `autoScroll?` option, setter/getter/clearer, `_autoScroll` field, `applyOptions` override |
| Modify | [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — re-export `AutoScrollMode` |
| Modify | [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — demo screen showing each `AutoScrollMode` value |

No files to create or delete.

---

## Verification

- `npm run typecheck` clean.
- Demo screen at `http://localhost:8015` (per the `MiscPanel` smoke screen):
  - Panel with default `autoScroll` (`"none"`) clips oversized children — no scrollbar.
  - `setAutoScroll("auto")` shows a vertical and/or horizontal scrollbar only when children spill.
  - `setAutoScroll("x")` shows horizontal only; vertical overflow clips.
  - `setAutoScroll("y")` shows vertical only; horizontal overflow clips.
  - `setAutoScroll("both")` shows both scrollbars unconditionally.
  - `clearAutoScroll()` returns the panel to clipping behaviour.
- Theme-toggle: scrollbars render with browser chrome in both themes (documented limitation).
- `grep -rn 'setAutoScroll\|AutoScrollMode' src/typescript/lib/core/Panel.ts` — both symbols defined exactly once.
- `npm run docs:build` — 0 errors, 0 link warnings.
- `graphify update .` runs to completion.

---

## Documentation Impact

- `Panel` lives in the `core` subpath barrel ([src/typescript/lib/core/index.ts:12-13](../src/typescript/lib/core/index.ts#L12-L13)). Add `export type { AutoScrollMode } from '~/core/Panel.js';` next to the existing `PanelOptions` re-export.
- No curated doc page for `Panel` exists under `docs/core/`; the typedoc-generated `/api/core/classes/Panel` page picks up the new methods automatically once `npm run docs:build` is run.
- JSDoc cross-references inside `Panel` stay same-bucket, so `{@link Component}` / `{@link AutoScrollMode}` resolve directly — no markdown-link rewriting needed.
- No renames or removals; no `grep` over `docs/` required.

---

## Potential Challenges

- **`scrollbar-gutter: stable` browser support** — Chromium 94+, Firefox 97+, Safari 18.2+. On older Safari the property is ignored and the auto-appearing scrollbar can reflow children on first appearance. Mitigation: document in the setter JSDoc; consumers who need older Safari support can pre-emptively use `setAutoScroll("both")` to keep the bar always visible.
- **Subclass layout assumptions** — any `Panel` subclass whose `doLayout` assumes children fit inside the allocated rect may behave unexpectedly when overflow becomes scrollable. Mitigation: the `grep` step audits subclasses; the default `"none"` keeps existing behaviour for callers that don't opt in.
- **Custom `Scrollbar` collision** — components like `Table` that already use the project's [`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts) overlay on top of their own scrolling machinery should NOT also be set to `autoScroll != "none"` on their host Panel — that would stack two scrollbars. Mitigation: documented in the setter JSDoc; not enforced in code because the framework can't tell the difference.
- **Focus / tabbing behaviour into scrolled content** — native scroll viewports change which descendants are visible mid-tab-order; not new to this plan but worth confirming on the smoke screen.

---

## Critical Files

- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — the file being modified; current state is the constructor + insets default only.
- [src/typescript/lib/core/Component.ts:180-181](../src/typescript/lib/core/Component.ts#L180-L181) — `overflowX` / `overflowY` cached fields.
- [src/typescript/lib/core/Component.ts:1944-1980](../src/typescript/lib/core/Component.ts#L1944-L1980) — `setOverflowX` / `setOverflowY` implementations the new setter calls into.
- [src/typescript/lib/core/Component.ts:295-330](../src/typescript/lib/core/Component.ts#L295-L330) — `applyOptions` cascade contract: subclass overrides must call `super.applyOptions(options)` first.
- [src/typescript/lib/core/Component.ts:631-639](../src/typescript/lib/core/Component.ts#L631-L639) — `setElementCSSRule` plumbing used to write `scrollbar-gutter`.
- [src/typescript/lib/component/container/Scrollbar.ts](../src/typescript/lib/component/container/Scrollbar.ts) and [VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — the custom scrollbar infrastructure that this plan deliberately does **not** wire into Panel.
- [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts) — `core` barrel for the new type re-export.
- [plans/implemented/will-change-hints.md](implemented/will-change-hints.md) — precedent for adding a single typed setter + option-field + cached-field triple to `Component` / subclasses.

---

## Non-Goals

- **Themed scrollbar styling.** The project's custom [`Scrollbar`](../src/typescript/lib/component/container/Scrollbar.ts) is not wired up here. A follow-up `setScrollbarStyle("native" | "themed")` is the natural extension point but is speculative without a concrete consistency requirement today.
- **Arrow-button decoration on Panel scrollbars.** The parallel `scrollbar-arrow-buttons` plan targets the custom `Scrollbar` and does not flow through to native overflow.
- **Programmatic scroll API on Panel.** No `setScrollX` / `setScrollY` / `scrollIntoView` wrappers in this plan — the native element's `scrollTop` / `scrollLeft` / `scrollIntoView` are already available via `getElement()` for callers that need them.
- **Auto-scroll-on-content-change observers.** No `ResizeObserver` or mutation-driven re-evaluation; native overflow handles this for free.
- **Removing or deprecating `setOverflowX` / `setOverflowY`.** They stay as the low-level escape hatch.
