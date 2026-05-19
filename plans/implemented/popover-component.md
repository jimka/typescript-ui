# Popover Component — Implementation Plan

## Overview

Add a `Popover` class to `src/typescript/lib/core/Popover.ts` — an anchored, non-modal floating bubble with a directional arrow tail, optional title, body content, and optional action buttons. The component reuses the floating-overlay patterns already established by [`Tooltip`](../src/typescript/lib/core/Tooltip.ts), [`Menu`](../src/typescript/lib/core/Menu.ts), and [`Notification`](../src/typescript/lib/core/Notification.ts): viewport-positioned element appended to `document.documentElement`, fade-in/out via `Animation.play`, theme-driven chrome.

**Naming verdict.** The conventional UI name for this widget is **Popover** — used by Apple HIG, Material Design, Bootstrap (alongside "callout"), and React Aria / Radix. "Tooltip" is *wrong* here: a tooltip is an ephemeral hover hint with no interactive content; a popover is a richer, click-or-programmatically-shown bubble that can hold a title, body, and buttons. "Callout" and "SpeechBubble" are reasonable alternatives but lose to "Popover" on industry-convention recognition. **Class name: `Popover`.**

`Popover` extends [`Panel`](../src/typescript/lib/core/Panel.ts#L39) so authors can drop arbitrary children inside via `addComponent`; the `setTitle` / `setBody` / `addAction` convenience setters are sugar over the same container surface. Positioning is anchor-relative (`attachToElement(HTMLElement)` / `attachToComponent(Component)`); placement supports `"top" | "bottom" | "left" | "right" | "auto"` with `"auto"` flipping to the side with the most viewport space. Dismiss behaviour is selectable: `"click-outside"` (default, reusing Menu's outside-click pattern at [Menu.ts:107-120](../src/typescript/lib/core/Menu.ts#L107-L120)), `"blur"`, or `"manual"`.

---

## Architecture Decisions

### Popover extends Panel — not Component

`Panel` ([Panel.ts:39](../src/typescript/lib/core/Panel.ts#L39)) is the natural base for a container that needs default insets (4px breathing room around children) and the standard child-management API. Tooltip extends `Component` because it owns its single `Text` child and disables pointer events on the inner element; Popover instead wants users to compose freely — title, body component, action buttons, or any arbitrary subtree. Extending `Panel` keeps that surface natural and inherits the options-bag cascade.

### Singleton-free, instance-owned lifecycle — like Menu, not Tooltip

`Tooltip` is a process-wide singleton ([Tooltip.ts:53](../src/typescript/lib/core/Tooltip.ts#L53)) because only one cursor-following hint should ever be visible. Popovers are anchored to specific triggers and can coexist (e.g. nested popovers in a wizard). Each `Popover` is a regular instance: `new Popover()`, `show()`, `hide()`, `dispose()` — mirroring the per-instance lifecycle of `Menu` ([Menu.ts:58-120](../src/typescript/lib/core/Menu.ts#L58-L120)).

### Anchor model — element or component, with reposition on resize/scroll

`attachToElement(el: HTMLElement)` records the raw anchor element. `attachToComponent(c: Component)` extracts the component's element via `c.getElement(true)` and delegates to `attachToElement`. While the popover is open, listeners fire on `window` `resize` and on each scrollable ancestor's `scroll` event (walked once at `show()` time via `getBoundingClientRect()` ancestor traversal) to call a private `_reposition()`. This matches Tooltip's `Util.getViewportSize()` clamp pattern ([Tooltip.ts:137-142](../src/typescript/lib/core/Tooltip.ts#L137-L142)) but adds the scroll-ancestor listener set because popovers, unlike cursor-tracked tooltips, are anchored to DOM that may scroll away.

### Placement with "auto" flip — measure once at show time

`setPlacement("top" | "bottom" | "left" | "right" | "auto")`. Default `"auto"`. On `show()`, after the popover element is in the DOM but before the fade-in, compute the anchor's `getBoundingClientRect()` and the popover's own measured size, then:
- `"auto"`: pick the side with the greatest available space (top vs bottom vs left vs right) and apply.
- Explicit side: apply that side; if it would overflow the viewport, fall back to the opposite side with a console warning. No silent flip — explicit placement is honoured unless physically impossible.

The chosen side is stored in a private `_resolvedPlacement` field so the arrow component can read it during arrow positioning.

### Arrow tail — CSS-clipped square, no SVG

A small 8×8 child `Component` (`_arrowComponent`) with `background-color` matching `--ts-ui-popover-bg`, a 1px border in `--ts-ui-popover-border` on two adjacent sides, and a `transform: rotate(45deg)` produces a diamond that visually reads as a triangle once the popover body clips half of it via `overflow` boundary. No SVG dependency, no extra theme token beyond what the bubble already needs (arrow size is one new token: `--ts-ui-popover-arrow-size`).

The arrow's position along the popover edge is set in `doLayout()`:
- For top/bottom placement: arrow sits horizontally so its centre aligns with the anchor's horizontal centre — clamped to keep the arrow within the popover's horizontal extent minus its size.
- For left/right placement: same, but vertically.

This decouples lateral position from anchor centre, so popovers shifted to stay on-screen still have the arrow pointing to the anchor (the original ask in the user spec). The pattern is novel inside the framework — no existing component does directional tail positioning — so it's documented inline in the source.

### Dismiss modes — three named strategies, default click-outside

`setDismissOn("click-outside" | "blur" | "manual")`. Implementation per mode:
- **`"click-outside"`** (default): use `Event.addViewportListener(this, "mousedown", handler)` and close when the target is not contained in either the popover element or the anchor element. Direct port of [Menu.ts:107-119](../src/typescript/lib/core/Menu.ts#L107-L119). The anchor is excluded so a second click on the trigger button doesn't immediately re-close — the caller's own click handler then re-opens.
- **`"blur"`**: register `focusout` on the popover element with a `relatedTarget`-not-contained check. Fires when keyboard focus leaves the popover subtree.
- **`"manual"`**: no listeners; caller drives `hide()` explicitly. Used by integration code that owns its own dismissal logic.

### Animated open/close — local fade helper, mark consolidation as follow-up

There is no `AnimatedDropdown` helper in the codebase today (verified — `plans/dropdown-fade-animation.md` does not exist; no shared fade utility currently lives in `core/`). Each floating overlay rolls its own fade: [Tooltip.ts:156-197](../src/typescript/lib/core/Tooltip.ts#L156-L197), [Menu.ts:325-366](../src/typescript/lib/core/Menu.ts#L325-L366), [Notification.ts:208-221](../src/typescript/lib/core/Notification.ts#L208-L221).

Build a small local `_fadeIn` / `_fadeOutAndDetach` pair on `Popover`, structurally identical to Menu's at [Menu.ts:325-366](../src/typescript/lib/core/Menu.ts#L325-L366), plus a 4px translate toward the anchor during entry (`translateY(4px)` on top placement, `translateY(-4px)` on bottom, etc.) so the bubble visually emerges from the trigger. Note in `## Non-Goals` that consolidating the three (Tooltip/Menu/Notification) plus this fourth into an `AnimatedDropdown` helper is a worthwhile follow-up plan, but the consolidation is its own refactor and would expand this plan's scope.

### Non-modal — explicitly no focus trap, no backdrop

Popovers do not trap focus or backdrop the page. Modal floating windows use [`Dialog`](../src/typescript/lib/core/Dialog.ts). The dismiss-on-blur mode is the closest thing to focus management and is opt-in only. Document in `## Non-Goals`.

### Title / body / action conveniences — sugar over addComponent

`setTitle(text)` lazily creates a `_titleComponent: Text` child styled as bold/larger. `setBody(content)` accepts either a string (lazily wraps in a `Text`) or a `Component` (uses directly). `addAction(label, onClick)` lazily creates a `_actionsRow: Panel` with an `HBox` layout manager and appends a `Button`. Power users who want a complex composition skip the conveniences and use `addComponent` directly. The internal title/body/actions are rebuildable (`clearTitle()`, `clearActions()`) and `setBody` replaces the previous body.

### Z-index — between Window and Tooltip

`Window` starts at 9000, `Menu` persistent at 9999, context Menu at 10000, `Tooltip` at 10001, `Notification` at 10002, `Dialog` higher still. Popovers should sit above floating windows and persistent menus but below tooltips (a tooltip on a popover button still needs to win) and below modal dialogs. **Z-index: 9998.** Below persistent menus by one — a popover triggered from a menubar button should not occlude the menubar's own dropdown (that's a pathological case; the menubar normally closes its menu when a popover opens, but the layering invariant should still hold).

### Internal-only public class, callable wrapper for `new`-free construction

Follow the established pattern from [Menu.ts:682-687](../src/typescript/lib/core/Menu.ts#L682-L687) and [Panel.ts:58-63](../src/typescript/lib/core/Panel.ts#L58-L63): declare `class Popover extends Panel`, wrap with `callable()`, export `_Popover` and `Popover` (the callable wrapper). TypeDoc's callable plugin promotes the docs back to `/api/core/classes/Popover.md`.

---

## Public API (TypeScript Signatures)

```typescript
export type PopoverPlacement = "top" | "bottom" | "left" | "right" | "auto";
export type PopoverDismissMode = "click-outside" | "blur" | "manual";

export interface PopoverOptions extends PanelOptions {
    placement? : PopoverPlacement;       // default "auto"
    dismissOn? : PopoverDismissMode;     // default "click-outside"
    showArrow? : boolean;                // default true
    title?     : string;                 // optional, sets the title row at construct time
}

class Popover extends Panel<PopoverOptions> {
    constructor(options?: PopoverOptions);

    setPlacement(p: PopoverPlacement): this;
    getPlacement(): PopoverPlacement;

    setDismissOn(mode: PopoverDismissMode): this;
    getDismissOn(): PopoverDismissMode;

    setShowArrow(value: boolean): this;
    isShowArrow(): boolean;

    setTitle(text: string | null): this;
    getTitle(): string | null;
    clearTitle(): this;

    setBody(content: Component | string): this;
    getBody(): Component | null;

    addAction(label: string, onClick: () => void): this;
    clearActions(): this;

    attachToElement(el: HTMLElement): this;
    attachToComponent(c: Component): this;

    show(): this;
    hide(): this;
    isOpen(): boolean;

    dispose(): void;
}
```

**Cached fields** (private): `_placement`, `_resolvedPlacement`, `_dismissOn`, `_showArrow`, `_title`, `_titleComponent`, `_bodyComponent`, `_actionsRow`, `_anchorElement`, `_arrowComponent`, `_isOpen`, `_dismissing`, `_onViewportMouseDown`, `_onWindowResize`, `_scrollAncestors`, `_onScroll`.

**Options-bag forwarding** — per CLAUDE.md and the options-bag pattern: every option in `PopoverOptions` must route to its typed setter in the constructor's `super()` cascade. The `Panel` super-cascade handles inherited options (`insets`, `tag`, etc.); the new `placement`, `dismissOn`, `showArrow`, `title` get a switch inside `Popover`'s own constructor, calling `setPlacement` / `setDismissOn` / `setShowArrow` / `setTitle` respectively.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-popover-bg` | `rgb(255, 255, 255)` | `rgb(50, 50, 55)` | Bubble background |
| `--ts-ui-popover-color` | `rgb(0, 0, 0)` | `rgb(230, 230, 235)` | Body text colour |
| `--ts-ui-popover-border` | `rgb(200, 200, 200)` | `rgb(90, 90, 100)` | Bubble + arrow border |
| `--ts-ui-popover-shadow` | `2px 4px 12px rgba(0, 0, 0, 0.18)` | `2px 4px 12px rgba(0, 0, 0, 0.55)` | Bubble drop shadow |
| `--ts-ui-popover-radius` | `6px` | `6px` | Bubble corner radius |
| `--ts-ui-popover-padding` | `12px` | `12px` | Bubble inner padding (overrides Panel's default insets) |
| `--ts-ui-popover-arrow-size` | `8px` | `8px` | Arrow diamond side length |

Token entries required in four `Theme.ts` blocks: the `Theme` interface ([Theme.ts:157-204 region](../src/typescript/lib/core/Theme.ts#L157-L204)), `DefaultTheme` ([Theme.ts:353+ region](../src/typescript/lib/core/Theme.ts#L353)), `DarkTheme` ([Theme.ts:507+ region](../src/typescript/lib/core/Theme.ts#L507)), and `themeToVars` ([Theme.ts:617-621 region](../src/typescript/lib/core/Theme.ts#L617-L621)).

Theme interface block to add (slot it near the `tooltip` / `notification` group):
```typescript
popover: {
    background: string;
    color     : string;
    border    : string;
    shadow    : string;
    radius    : string;
    padding   : string;
    arrowSize : string;
};
```

---

## Internal Structure

```
document.documentElement
  └── <div id="...">   ← Popover root (Panel, z-index 9998, position fixed)
        ├── _titleComponent     (Text, optional, top)
        ├── _bodyComponent      (Component | Text, middle)
        ├── _actionsRow         (Panel + HBox, optional, bottom)
        └── _arrowComponent     (Component, 8×8, rotated 45°, absolutely positioned along edge)
```

The popover is a single-element overlay — the arrow is a sibling child of the title/body/actions, not a separate DOM root. The arrow's positioning is set inline (left/top in pixels) in `doLayout()` after the title/body/actions have been laid out vertically. The four content children stack via a `VBox` layout manager on the popover root; the arrow is positioned absolutely using `setX` / `setY` outside the layout flow (set `arrow.setIncludedInLayout(false)` so VBox skips it — or wrap in a sibling absolutely-positioned overlay child; pick whichever the existing layout API supports — see Critical Files).

**Arrow placement math** (run in `doLayout()` after `_resolvedPlacement` is known):
```
const anchorRect = _anchorElement.getBoundingClientRect();
const popoverX   = getX();
const popoverY   = getY();
const arrowSize  = parseInt(getComputedStyle(...).--ts-ui-popover-arrow-size);

// Anchor centre in viewport coords:
const ax = anchorRect.left + anchorRect.width  / 2;
const ay = anchorRect.top  + anchorRect.height / 2;

// Arrow position in popover-local coords, clamped to popover extent:
if (_resolvedPlacement === "bottom") {
    arrow.setX(clamp(ax - popoverX - arrowSize/2, 4, getWidth() - arrowSize - 4));
    arrow.setY(-arrowSize / 2);
} else if (_resolvedPlacement === "top") {
    arrow.setX(clamp(ax - popoverX - arrowSize/2, 4, getWidth() - arrowSize - 4));
    arrow.setY(getHeight() - arrowSize / 2);
}
// ...mirror for left/right
```

---

## Ordered Implementation Steps

1. **Add theme tokens.** Extend `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars` in [Theme.ts](../src/typescript/lib/core/Theme.ts) with the seven `popover` keys per the table above. Slot the interface entry between `tooltip` ([Theme.ts:157](../src/typescript/lib/core/Theme.ts#L157)) and `notification` ([Theme.ts:164](../src/typescript/lib/core/Theme.ts#L164)). Run `npx tsc --noEmit` — expect zero new errors.

2. **Create `src/typescript/lib/core/Popover.ts`.** Skeleton class extending `_Panel<PopoverOptions>`. Constructor cascades options to typed setters. Apply chrome via theme tokens: `setBackgroundColor("var(--ts-ui-popover-bg)")`, `setForegroundColor`, `setBorder` (1px solid, popover-border var), `setShadow`, `setBorderRadius`, `setZIndex(9998)`, `setContain("layout paint")`. Apply VBox layout manager so title/body/actions stack vertically.

3. **Implement placement + arrow geometry.** `_resolvePlacement()` runs at `show()` time: for `"auto"`, pick the side with most viewport space using `Util.getViewportSize()` ([Util usage in Tooltip.ts:137](../src/typescript/lib/core/Tooltip.ts#L137)) and the anchor rect. For explicit placements, honour unless it overflows the viewport; then fall back to opposite side with `console.warn`. Position the popover root via `setX` / `setY` after measuring own preferred size — mirrors [Menu.ts:262-278](../src/typescript/lib/core/Menu.ts#L262-L278).

4. **Implement arrow component.** 8×8 child with `transform: rotate(45deg)`, background matches bubble, two adjacent sides bordered. Positioned in `doLayout()` per the math in `## Internal Structure`. Skip when `_showArrow === false`.

5. **Wire dismiss modes.** Reuse `Event.addViewportListener` / `removeViewportListener` for `"click-outside"` (port from [Menu.ts:185, 198](../src/typescript/lib/core/Menu.ts#L185)). For `"blur"`, register a `focusout` listener via `Event.addListener(this, "focusout", ...)` with a `relatedTarget`-contained check. Detach all listeners in `hide()` and `dispose()`. Both checks must also exclude the anchor element so clicks/blur-loss to the anchor don't immediately re-close after re-open.

6. **Add local fade helper.** Private `_fadeIn(el)` / `_fadeOutAndDetach()` modelled on [Menu.ts:325-366](../src/typescript/lib/core/Menu.ts#L325-L366). Entry adds a 4px translate toward the anchor (sign depends on `_resolvedPlacement`). Exit reverses. Mark in source comment that this is duplicated logic across Tooltip/Menu/Notification/Popover — consolidation is a follow-up.

7. **Add reposition listeners.** On `show()`: collect scrollable ancestors of `_anchorElement` (walk parent chain checking `overflow` computed style), register `scroll` on each plus `resize` on `window`. All three call a debounced `_reposition()` that re-runs `_resolvePlacement` and updates `setX` / `setY` plus arrow position. On `hide()`: detach all.

8. **Implement convenience setters.** `setTitle` / `clearTitle`: lazy-construct/dispose `_titleComponent: Text`. `setBody`: wrap string in a `Text` or use the component directly; replace previous body. `addAction(label, onClick)` / `clearActions`: lazy-construct `_actionsRow: Panel` with HBox, append `Button` instances.

9. **Export from core.** Add to [src/typescript/lib/core/index.ts](../src/typescript/lib/core/index.ts):
   ```typescript
   export { Popover } from '~/core/Popover.js';
   export type { PopoverOptions, PopoverPlacement, PopoverDismissMode } from '~/core/Popover.js';
   ```

10. **Apply callable wrapper.** End of `Popover.ts`:
    ```typescript
    const PopoverCallable = callable(Popover);
    type PopoverCallable<TOptions extends PopoverOptions = PopoverOptions> = Popover;
    export { Popover as _Popover, PopoverCallable as Popover };
    ```
    Mirrors [Menu.ts:682-687](../src/typescript/lib/core/Menu.ts#L682-L687).

11. **JSDoc with cross-bucket markdown links.** Per CLAUDE.md: same-bucket references use `{@link}`, cross-bucket references use markdown links. `Popover` cites `Panel` (same bucket — `{@link Panel}`), `Component` (same bucket — `{@link Component}`), `Button` (cross-bucket → `component/button` — `[`Button`](/api/component/button/classes/Button)`), `Text` (cross-bucket → `component/input` — `[`Text`](/api/component/input/classes/Text)`).

12. **Demo at `http://localhost:8015`.** Add a Popover demo panel: a row of four buttons in the four viewport corners, each opening a Popover with `placement: "auto"` so the flip logic is exercised in every corner. A fifth centre button uses `placement: "right"` to verify explicit placement. Include one with `addAction("Confirm", ...)` + `addAction("Cancel", ...)` to verify the action-row layout.

13. **Theme-toggle and reduced-motion verification.** Toggle the app's theme — popover bubble, arrow, shadow, and body text must repaint correctly with no stale colours. DevTools `Rendering → Emulate CSS media feature → prefers-reduced-motion: reduce` — popover should appear instantly with no fade or translate.

14. **`npm run docs:build`.** Expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

15. **`graphify update .`** to refresh the knowledge graph with the new file.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/Popover.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` (4 blocks: `Theme`, `DefaultTheme`, `DarkTheme`, `themeToVars`) |
| Modify | `src/typescript/lib/core/index.ts` (add `Popover` + type re-exports) |
| Modify | `src/typescript/main.ts` (register demo panel) |
| Create | `docs/components/popover.md` (curated page; alphabetical insertion in sidebar) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry under "Core") |
| Modify | `docs/components/index.md` or equivalent catalog (new entry) |

---

## Verification

- `npx tsc --noEmit` — zero new errors above baseline.
- `npx vite build` succeeds.
- `grep -n 'extends Panel' src/typescript/lib/core/Popover.ts` — expect exactly one match (the class declaration).
- `grep -rn 'new Popover\|Popover(' src/typescript/main.ts` — the demo panel constructs at least one instance.
- Manual smoke at `http://localhost:8015`:
  - Four-corner demo: each Popover flips to the side with most space (top-left → opens bottom-right, etc.).
  - Explicit `placement: "right"` demo: opens to the right; resize viewport so right is too narrow and confirm console-warned fallback to left.
  - `dismissOn: "click-outside"`: clicking outside closes; clicking the anchor button does not immediately re-close (anchor exclusion works).
  - `dismissOn: "blur"`: tabbing focus out of the popover closes it.
  - `dismissOn: "manual"`: only programmatic `hide()` closes it.
  - Scroll the page while a popover is open — popover follows its anchor.
  - Resize the window — popover repositions.
  - `addAction` row: buttons fire their `onClick`.
  - Arrow points at anchor centre even when the popover body is shifted laterally to stay on-screen.
- Theme toggle: light ↔ dark — bubble, border, shadow, arrow, and text colours all update without page reload.
- `prefers-reduced-motion: reduce` (DevTools emulation): no fade, no translate, instant show/hide.
- `npm run docs:build` — 0 errors and 0 link warnings (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).
- `graphify update .` refreshes the graph without errors.

---

## Documentation Impact

- **Per-subpath barrel:** `src/typescript/lib/core/index.ts` (there is no root barrel — the new symbol is `Popover` plus type re-exports `PopoverOptions`, `PopoverPlacement`, `PopoverDismissMode`).
- **Curated docs page:** add `docs/components/popover.md` (or `docs/core/popover.md` if the docs site groups by bucket — check the existing layout for `docs/components/menu.md` and follow the same convention). Update the components catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- **Cross-bucket JSDoc references:** `Button`, `Text`, and any other cross-bucket symbols cited in Popover's JSDoc use markdown link form (`[`Foo`](/api/<subpath>/classes/Foo)`), not `{@link}` — per CLAUDE.md, `{@link}` only resolves inside the same entry-point bundle.
- **TypeDoc callable promotion:** because the export form is `callable(Popover)` aliased to `Popover`, the custom `typedoc-callable-plugin.mjs` will automatically promote the rendered docs from `/api/core/variables/Popover.md` to `/api/core/classes/Popover.md`. No plugin change required.

---

## Potential Challenges

- **Arrow on the layout boundary.** The arrow needs to visually straddle the popover edge (half inside, half outside). Setting `overflow: visible` (the default for a Panel) handles this, but care is needed not to clip the arrow with `setContain("layout paint")` — `paint` containment would clip the arrow. Mitigation: use `setContain("layout")` only on the popover root, not `"layout paint"`.
- **`overflow` walk for scroll-ancestor detection.** Computing scrollable ancestors requires `getComputedStyle(node).overflow` per ancestor up to `document.documentElement`. Mitigation: run this once at `show()`, cache the list in `_scrollAncestors`, detach on `hide()`. Same pattern used by popular libraries (Floating UI's `getScrollParents`).
- **Anchor element removed from DOM while popover is open.** The anchor's `getBoundingClientRect()` returns zeros; the popover ends up at `(0, 0)`. Mitigation: detect zero-rect in `_reposition` and call `hide()`.
- **`will-change` priming for the fade-in translate.** The 4px translate is a `transform` change. Per the will-change-hints convention ([plans/implemented/will-change-hints.md](implemented/will-change-hints.md)), set `setWillChange("transform, opacity")` at the start of `_fadeIn`, clear it in the `transitionend` finish callback. Mirrors the accordion-animation-polish pattern.
- **Dismiss-on-blur with mouse-only users.** A popover opened by mouse without focus moving into it has no focused descendant, so `focusout` never fires. Mitigation: when `setDismissOn("blur")` is the active mode, `show()` calls `focus()` on the popover root (with `tabindex="-1"` set on it) so subsequent focus loss is detectable.
- **Z-index 9998 below persistent menus (9999).** A popover triggered from inside an open menu would render under the menu. Mitigation: rare in practice; if it bites, callers should close their menu before opening a popover. Document but don't engineer for it.
- **Fade-helper duplication.** Four floating overlays now own near-identical fade code (Tooltip, Menu, Notification, Popover). Mitigation: tag the source comment in Popover with `// TODO(consolidation): see plans/dropdown-fade-animation.md when it lands` so the cleanup is discoverable. Don't expand this plan to also do the consolidation.

---

## Critical Files

- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — base class; options-bag forwarding pattern at lines 49-55.
- [src/typescript/lib/core/Menu.ts](../src/typescript/lib/core/Menu.ts) — closest pattern reference: anchor-relative positioning at lines 226-293, viewport mousedown handler at lines 107-119, fade helpers at lines 325-366, callable wrapper at lines 682-687.
- [src/typescript/lib/core/Tooltip.ts](../src/typescript/lib/core/Tooltip.ts) — viewport-coord positioning + clamp pattern at lines 128-142, `attachToElement` API shape at lines 310-342.
- [src/typescript/lib/core/Notification.ts](../src/typescript/lib/core/Notification.ts) — `Animation.play` translate + opacity pattern at lines 208-221 and 439-444.
- [src/typescript/lib/core/Dialog.ts](../src/typescript/lib/core/Dialog.ts) — modal-overlay sibling whose patterns we deliberately do **not** reuse (non-modal vs modal). Read to confirm the non-overlap.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — token blocks (interface around lines 157-204, `DefaultTheme` around 353, `DarkTheme` around 507, `themeToVars` around 617-621).
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `setIncludedInLayout` for the arrow-outside-flow trick; `setWillChange` for the fade transform priming.
- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — `addViewportListener` / `removeViewportListener` semantics (used by Menu for outside-click).
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — `Animation.play` signature; `Animation.isReducedMotion()` for the reduced-motion short-circuit.
- [plans/implemented/modal-dialog.md](implemented/modal-dialog.md) — modal floating-component patterns; sibling design for contrast.
- [plans/implemented/will-change-hints.md](implemented/will-change-hints.md) — compositor pre-promotion pattern for the fade transform.

---

## Non-Goals

- **Not a Tooltip.** Tooltips are ephemeral hover hints with no interactive content — `Tooltip` already covers that case. Popover targets the richer, click-triggered, interactive bubble.
- **No focus trap.** Popovers are non-modal by design. Modal containment is `Dialog`'s job; conflating the two muddies both APIs.
- **No backdrop.** Same reason as no focus trap. A semi-modal backdrop would put Popover in the awkward middle ground between Dialog (full modal) and Menu (free dismissal).
- **No automatic placement re-flip mid-animation.** If the user resizes the viewport during the fade-in such that the resolved side no longer fits, the popover honours its already-chosen side until the next `show()`. Re-flipping mid-animation would jitter the arrow.
- **No `AnimatedDropdown` consolidation in this plan.** The four-way duplication (Tooltip/Menu/Notification/Popover) is real and worth a refactor, but doing it inside this plan would balloon scope and risk regressions in three shipped components. Track separately.
- **No virtual-anchor support.** Some popover libraries support a synthetic `{ getBoundingClientRect: () => ... }` anchor (e.g. follow-the-cursor menus). Out of scope; revisit if a real consumer asks.
- **No arrow-hidden border-radius adjustment.** When `showArrow: false`, the bubble keeps its standard radius rather than morphing into a different shape. Simpler; matches user expectation.
- **No persistent anchor binding across `hide()`/`show()` cycles by default.** Each `show()` re-reads the anchor rect and re-resolves placement. Callers who want the anchor remembered across cycles call `attachToElement` once at construction and just toggle `show()`/`hide()`.
