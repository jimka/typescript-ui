---
touches-shared:
  - packages/lib/src/typescript/lib/core/OverlayPosition.ts
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/src/typescript/lib/overlay/index.ts
  - packages/lib/src/typescript/lib/component/button/index.ts
  - packages/lib/tests/component/default-options-fallback.test.ts
  - packages/lib/src/typescript/MiscPanel.ts
  - packages/lib/scripts/llms/manifest.data.mjs
  - packages/lib/llms.txt
  - packages/docs/src/content/pages.ts
---

# PopupPanel and PopupButton — Implementation Plan

## Overview

Two new components let a consumer build a custom popup without writing overlay plumbing. `PopupPanel` is a floating panel that sizes itself to its content, places itself against a trigger rect, caps its height to the room available there, and dismisses through the shared layer machinery. `PopupButton` is a `Button` whose click toggles such a panel and keeps the ARIA state in sync.

`PopupPanel` extends [`AnimatedDropdown`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L64), which already owns the open/close lifecycle, the fade, the portal mount, and the [`DismissableLayer`](packages/lib/src/typescript/lib/core/LayerManager.ts#L41) contract. `PopupPanel` adds only what `AnimatedDropdown` deliberately leaves to its hosts: content measurement, placement, and the height cap. `PopupButton` mirrors [`MenuButton`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L194) — the existing "button that toggles an overlay" component — with a `PopupPanel` in place of a `Menu`.

The work also lifts one piece of placement math out of [`Menu`](packages/lib/src/typescript/lib/overlay/Menu.ts#L62) into the shared primitive module [`core/OverlayPosition.ts`](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L174), so `Menu` and `PopupPanel` resolve a content-sized anchored placement through one function.

---

## Architecture Decisions

### PopupPanel extends AnimatedDropdown — no strategy hook, no rename

`PopupPanel` is a new subclass of `AnimatedDropdown`. `AnimatedDropdown` is left exactly as it is: its `placeAnchored` stays a fixed-size vertical placement, and its four existing subclasses (`AutoCompleteDropdown`, `ComboBoxDropdown`, `TimePickerDropdown`, `AbstractCalendarDropdown`) are unaffected.[^extends-dropdown]

`Popover` is the library's other composable anchored overlay, and it is not the vehicle for this: its bubble geometry, its lack of a height cap, and its lower z-band are all wrong for a trigger-anchored panel.[^why-not-popover]

Placement stays an ordinary overridable method rather than a pluggable strategy object. `PopupPanel` exposes `protected resolvePlacement(anchorRect, size, viewport)`, which a subclass overrides when it needs different geometry — the same extension shape `Menu` and `Popover` already use by owning a placement method of their own.[^no-strategy]

### Placement uses the size-flexible primitive, not `placeAnchored`

`PopupPanel` resolves its position through `positionAnchoredFlexible`, a new function in [`core/OverlayPosition.ts`](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L174) that returns both the coordinate and the room available on the side the panel landed on. It does not call `AnimatedDropdown.placeAnchored`.[^flexible-placement]

`Menu` composes the same two primitives by hand today in its private `resolvePlacement` ([Menu.ts:62](packages/lib/src/typescript/lib/overlay/Menu.ts#L62)). That private helper is deleted and both of its call sites route through the new shared function, so the two panels cannot drift apart.[^menu-dedupe]

### PopupPanel owns its height cap and its `maxSize`

Every open recomputes `maxSize` from the room at the anchor and commits the measured content height, so an over-tall panel is capped and scrolls instead of running off-screen. A consumer who wants a fixed size sets `preferredSize` in the options bag; `maxSize` belongs to the panel.[^maxsize-owned]

### PopupButton is a Button subclass; `PopupPanel.toggleFor` is the general seam

`PopupButton extends Button`, mirroring `MenuButton`. Any other trigger — a table header cell, a toolbar overflow chevron, a tree row — calls `PopupPanel.toggleFor(openerEl, anchorRect)` directly, which is how [`ToolBar`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L727) already drives a `Menu` without being a button.[^button-subclass]

### The `panel` option takes an instance or a factory, resolved once

`PopupButtonOptions.panel` accepts a built `PopupPanel` or a function returning one, mirroring `MenuButtonOptions.menuItems`' array-or-provider union ([MenuButton.ts:16](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L16)). A factory is invoked once, on first open, and the result is reused — unlike `menuItems`, whose provider re-runs on every open.[^panel-union]

The button owns whichever panel it resolved: it disposes that panel in its destructor and when `setPanel` replaces it.[^ownership]

### ARIA: `role="dialog"` on the panel, `aria-haspopup="dialog"` on the button

The panel reports `role="dialog"`, matching [`Popover`](packages/lib/src/typescript/lib/overlay/Popover.ts#L211). The button reports `aria-haspopup="dialog"` and toggles `aria-expanded`, matching [`MenuBarButton`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L113). On each open the panel takes `aria-labelledby` from the opener's id, as [`Menu.open`](packages/lib/src/typescript/lib/overlay/Menu.ts#L606) does, and the button points `aria-controls` at the panel's id, as [`AutoCompleteField`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L132) does.

### Chrome reuses the existing floating-panel tokens

`PopupPanel` defaults to the same four chrome values every `AnimatedDropdown` subclass already uses — `--ts-ui-autocomplete-bg`, `--ts-ui-input-border`, `--ts-ui-border-radius`, `--ts-ui-autocomplete-shadow`. No new theme group.[^chrome-tokens]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/OverlayPosition.ts — additions

/** A resolved size-flexible placement: the top-left plus the room at it. */
export interface AnchoredFlexiblePlacement {
    x:         number;
    y:         number;
    /** Room (px) on the vertical side the element landed on — the caller's height cap. */
    available: number;
}

export function positionAnchoredFlexible(
    anchorRect: Rect,
    size:       Size,
    viewport:   Size,
    margin:     number,
): AnchoredFlexiblePlacement;
```

```typescript
// packages/lib/src/typescript/lib/overlay/PopupPanel.ts — new file

export interface PopupPanelOptions extends AnimatedDropdownOptions {}

class PopupPanel<TOptions extends PopupPanelOptions = PopupPanelOptions>
    extends AnimatedDropdown<TOptions> {

    constructor(options?: PopupPanelOptions, subclassDefaults?: Partial<PopupPanelOptions>);

    /** Measures, places, caps, mounts, fades in, lays out. */
    showAt(anchorRect: Rect): this;

    /** Opens for `openerEl`, or closes when `openerEl` already opened it. */
    toggleFor(openerEl: Handle, anchorRect: Rect): this;

    /** Override: clears the opener identity, then defers to the base fade-out. */
    hideAnimated(): this;

    /** Placement override point. Defaults to `positionAnchoredFlexible`. */
    protected resolvePlacement(anchorRect: Rect, size: Size, viewport: Size): AnchoredFlexiblePlacement;
}

const PopupPanelCallable = callable(PopupPanel);
type  PopupPanelCallable<TOptions extends PopupPanelOptions = PopupPanelOptions> = PopupPanel<TOptions>;
export {
    PopupPanel         as _PopupPanel,
    PopupPanelCallable as PopupPanel,
};
```

`PopupPanelOptions` adds no fields of its own — it is a named extension point, exactly like [`ContainerOptions`](packages/lib/src/typescript/lib/core/Container.ts#L15) and `AutoCompleteDropdownOptions`. Content, layout, insets, and a pinned size all come from the inherited `ComponentOptions` fields (`layoutManager`, `components`, `insets`, `preferredSize`).

```typescript
// packages/lib/src/typescript/lib/component/button/PopupButton.ts — new file

export interface PopupButtonOptions extends ButtonOptions {
    /** The popup to toggle: a built panel, or a factory called once on first open. */
    panel?: PopupPanel | (() => PopupPanel);
}

class PopupButton<TOptions extends PopupButtonOptions = PopupButtonOptions>
    extends Button<TOptions> {

    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>);
    constructor(options: TOptions);

    setPanel(panel: PopupPanel | (() => PopupPanel)): this;
    getPanel(): PopupPanel | (() => PopupPanel) | null;

    /** Resolves (and caches) the configured panel; null when none is configured. */
    protected ensurePanel(): PopupPanel | null;
    protected destructor(): void;
}
```

State-bearing property routing for `panel`: setter `setPanel`, getter `getPanel`, options field `PopupButtonOptions.panel`, cache `this._options.panel`. The resolved instance lives in a private `_resolvedPanel` field, off the options bag, because it is framework bookkeeping rather than consumer configuration.

### Consumer usage

```typescript
import { PopupButton } from '@jimka/typescript-ui/component/button';
import { PopupPanel } from '@jimka/typescript-ui/overlay';
import { VBox } from '@jimka/typescript-ui/layout';
import { Button } from '@jimka/typescript-ui/component/button';
import { Checkbox } from '@jimka/typescript-ui/component/input';

const filters = PopupButton('Filters', {
    panel: () => PopupPanel({
        layoutManager: VBox({ spacing: 4, stretching: true }),
        components: [
            Checkbox({ label: 'Show archived' }),
            Checkbox({ label: 'Only mine' }),
            Button('Apply', { listeners: { action: applyFilters } }),
        ],
    }),
});

toolbar.addComponent(filters);
```

A trigger that is not a `Button` drives the same panel directly:

```typescript
const panel = PopupPanel({ layoutManager: VBox(), components: [ /* … */ ] });

panel.toggleFor(headerCell.getElement(true)!, DOM.source.getViewportRect(headerCell));
```

---

## Internal Structure

`PopupPanel.showAt` — the measure / place / cap / mount / lay out sequence. The ordering is load-bearing and is spelled out in the step list; this is the shape:

```typescript
showAt(anchorRect: Rect): this {
    // Realise the element before any layout pass: getInnerSize() is null while
    // detached, so a Fit-style manager would size children to 0 on first open.
    this.getElement(true);

    // A reused panel still carries the previous open's height cap; clear it
    // before measuring or the content is capped at the old room.
    this.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE });

    const preferred = this.getPreferredSize();
    const width     = preferred?.width  ?? this.getWidth();
    const height    = preferred?.height ?? this.getHeight();
    const viewport  = DOM.source.getViewportSize();
    const placement = this.resolvePlacement(anchorRect, { width, height }, viewport);

    this.setWidth(width);
    this.setMaxSize({ width: Number.MAX_VALUE, height: Math.max(0, placement.available) });
    this.setHeight(height);
    this.setX(placement.x);
    this.setY(placement.y);

    this.showAnimated();
    this.doLayout();

    return this;
}
```

`positionAnchoredFlexible` composes the two existing primitives — the same pair `Menu.resolvePlacement` composes today:

```typescript
export function positionAnchoredFlexible(anchorRect, size, viewport, margin) {
    const v = positionFlexibleAnchored(anchorRect.top, anchorRect.bottom, size.height, viewport.height, margin);
    const x = positionAligned(anchorRect.left, anchorRect.right, size.width, viewport.width, margin);

    // `available` is the room on the side the panel actually landed on — never
    // re-derive it from `v.start`, which measures the wrong side after a flip.
    return { x, y: v.start, available: v.available };
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/OverlayPosition.ts`** — add the exported `AnchoredFlexiblePlacement` interface and the `positionAnchoredFlexible` function shown in *Internal Structure*, placed after `positionFlexibleAnchored`. Both carry `@category Core`, matching the file's other exports. Verify: `npm run typecheck`.

2. **`packages/lib/tests/overlay/OverlayPosition.test.ts`** — add a `describe('positionAnchoredFlexible')` block covering the four placement rows in *Expected Behaviour* (below, flip-above, cap, right-align flip). These are pure-function tests: no DOM. Verify: `npm test -- OverlayPosition`.

3. **`packages/lib/src/typescript/lib/overlay/Menu.ts`** — delete the private `MenuPlacement` interface (lines 36-37) and the private `resolvePlacement` function (lines 49-70), then call `positionAnchoredFlexible(anchorRect, size, vp, VIEWPORT_MARGIN)` at both former call sites in `showAnchored` (lines 352 and 366). Fix the imports, which the deletion orphans: line 7 becomes `import { positionAnchoredFlexible, positionFlexibleAnchored } from "~/core/OverlayPosition.js";` — `positionAligned` was used only by the deleted function, while `positionFlexibleAnchored` is still used by `placeVertically` (line 914) — and the `Size` type import (line 11) goes, since the deleted signature was its only user. Verify: `grep -n 'resolvePlacement\|MenuPlacement\|positionAligned\|primitive/Size' packages/lib/src/typescript/lib/overlay/Menu.ts` — expect zero matches; `npm run lint` clean; `npm test -- Menu` green.

4. **`packages/lib/tests/overlay/PopupPanel.test.ts`** — write the failing tests first, from *Expected Behaviour* cases 1-8. Use the `installTestDOM` harness with the standard `CONFIG` copied from [`tests/overlay/AnimatedDropdown.test.ts`](packages/lib/tests/overlay/AnimatedDropdown.test.ts#L17) (viewport 1280×800), and drain `LayerManager` in `afterEach` the way that file does — the manager is a module singleton and is not reset by `DOM.reset()`.

5. **`packages/lib/src/typescript/lib/overlay/PopupPanel.ts`** — new file. Implement:
   - `PopupPanelOptions extends AnimatedDropdownOptions` with no fields, `@category Components`.
   - A module constant `VIEWPORT_MARGIN = 4`, documented as the pixels kept between a clamped panel and the viewport edge (same value and reason as `Menu`'s).
   - The constructor: `constructor(options?: PopupPanelOptions, subclassDefaults?: Partial<PopupPanelOptions>)`, forwarding an inline defaults bag spread with `...(subclassDefaults ?? {})` — copy the shape from [`AbstractCalendarDropdown`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L515). Defaults: `layoutManager: new VBox({ stretching: true })`, `insets: new Insets(4, 4, 4, 4)`, `backgroundColor: "var(--ts-ui-autocomplete-bg, rgb(255, 255, 255))"`, `border: "var(--ts-ui-input-border)"`, `borderRadius: "var(--ts-ui-border-radius, 4px)"`, `shadow: "var(--ts-ui-autocomplete-shadow, 2px 4px 8px rgba(0,0,0,0.15))"`. The layout manager is constructed inline in the call, never hoisted to a module constant, so each panel gets its own.
   - Constructor body: `this.getAria().setRole("dialog")`, `this.setContain("layout")`, and the vertical-scroll trio `setOverflowX("hidden")`, `setOverflowY("auto")`, `this.getLayoutManager()?.setOverflowing(false, true)` — the `"y"` case of `Panel.setAutoScroll`, whose call shape is [`Panel.ts:382`](packages/lib/src/typescript/lib/core/Panel.ts#L382). Reading the manager back through `getLayoutManager()` (rather than the local default) is what makes the flag land on a caller-supplied manager too.
   - `private _currentOpener: Handle | null = null;` — a plain initializer is correct here; no cascade-dispatched setter writes it.
   - `showAt`, `toggleFor`, the `hideAnimated` override, and `protected resolvePlacement` per *Public API* and *Internal Structure*. `toggleFor` calls `setAnchorElement(openerEl)` before `showAt` so the manager excludes the trigger from its outside-pointerdown test, and sets `aria-labelledby` from `DOM.source.getId(openerEl)` when that id is non-empty.
   - The `callable()` export pair.

   Verify: step 4's tests pass; `npm run lint`.

6. **`packages/lib/src/typescript/lib/overlay/index.ts`** — export `PopupPanel` and the `PopupPanelOptions` type, next to the existing `Popover` lines.

7. **`packages/lib/tests/component/default-options-fallback.test.ts`** — add four registry rows for `PopupPanel`'s `backgroundColor`, `border`, `borderRadius`, and `shadow`, alongside the existing `Popover` chrome rows (lines 362-364). Every class that defaults a field needs rows here. Verify: `npm test -- default-options-fallback`.

8. **`packages/lib/tests/component/button/PopupButton.test.ts`** — write the failing tests first, from *Expected Behaviour* cases 9-15. Drive the toggle through the private method by bracket access (`(btn as any).togglePopup()`), the way [`tests/component/MenuButton.test.ts`](packages/lib/tests/component/MenuButton.test.ts#L139) does; do not add a second `.click()`-driven test file, for the reason documented at the top of that file.

9. **`packages/lib/src/typescript/lib/component/button/PopupButton.ts`** — new file. Implement:
   - `PopupButtonOptions extends ButtonOptions` with the `panel` field, `@category Components`.
   - The two-overload constructor and the string-or-options normalisation copied verbatim in shape from [`MenuButton`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L68), including the `Object.getPrototypeOf(this) === PopupButton.prototype` guard around `this.applyListeners(options?.listeners)`.
   - Constructor body: `this.on("action", this._boundTogglePopup)`, `this.getAria().setHasPopup("dialog")`, `this.getAria().setExpanded(false)`.
   - `declare private _resolvedPanel: PopupPanel | null;` — declared bare, with `this._resolvedPanel ??= null;` in the constructor body after `super()`. `setPanel` is dispatched from `applyOptions` during the `super()` cascade and writes this field, so a plain initializer would run afterwards and wipe it.[^declare-field]
   - `setPanel` / `getPanel` / `applyOptions` mirroring `setMenuItems` / `getMenuItems` / `applyOptions` in `MenuButton`. `setPanel` disposes the previously resolved panel and clears `_resolvedPanel` before writing `this._options.panel`.
   - `protected ensurePanel()`: returns the cached instance; otherwise reads `getPanel()`, returns `null` when nothing is configured, calls the value when it is a function, caches the result, wires `panel.setCloseHandler(this._boundClosePopup)`, and sets `this.getAria().setControls(panel.getId())`.
   - `private togglePopup()`: bail when `getElement()` is null **before** resolving the panel, so an unattached button constructs nothing; bail when `ensurePanel()` returns null; then `panel.toggleFor(el, DOM.source.getViewportRect(this))` and `this.getAria().setExpanded(panel.isOpen())`.
   - `private closePopup()`: `this._resolvedPanel?.hideAnimated()` then `this.getAria().setExpanded(false)`. This is the thunk the layer manager invokes on an outside click or Escape, so it must drive the close itself — `setCloseHandler` replaces the default `hideAnimated`, it does not merely observe it.
   - `protected destructor()`: dispose `_resolvedPanel`, null it, then `super.destructor()`. Carry `MenuButton.destructor`'s comment: the panel is a `LayerManager`-mounted overlay, never a registered child, so the base class's child recursion cannot reach it.

   Verify: step 8's tests pass; `npm run lint`.

10. **`packages/lib/src/typescript/lib/component/button/index.ts`** — export `PopupButton` and the `PopupButtonOptions` type, after the `MenuButton` lines.

11. **`packages/lib/src/typescript/MiscPanel.ts`** — add a `PopupButton` to the demo app immediately after the animated-dropdowns row (the `rightColumn.addComponent(fieldsRow)` call at line 1756), so the manual checks have something to click. A `PopupButton("Filters", { panel: () => new PopupPanel({ … }) })` with two checkboxes and an Apply button is enough. Match the file's imperative style; add the two imports.

12. **Documentation** — see *Documentation Impact*. Finish with `npm run docs:llms` to regenerate `packages/lib/llms.txt`.

13. **Full verification** — `npm run typecheck && npm test && npm run lint && npm run docs:api`. The docs build must end with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/overlay/PopupPanel.ts` |
| Create | `packages/lib/src/typescript/lib/component/button/PopupButton.ts` |
| Create | `packages/lib/tests/overlay/PopupPanel.test.ts` |
| Create | `packages/lib/tests/component/button/PopupButton.test.ts` |
| Create | `packages/lib/docs/components/PopupPanel.md` |
| Create | `packages/lib/docs/components/PopupButton.md` |
| Modify | `packages/lib/src/typescript/lib/core/OverlayPosition.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/index.ts` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/tests/overlay/OverlayPosition.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/AnimatedDropdown.md` |
| Modify | `packages/lib/docs/components/MenuButton.md` |
| Modify | `packages/lib/docs/components/Popover.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (regenerated) |
| Modify | `packages/docs/src/content/pages.ts` |

---

## Expected Behaviour

Cases 1-8 are `PopupPanel`; 9-15 are `PopupButton`. All are unit-testable against the `installTestDOM` harness unless marked otherwise.

**Placement.** Viewport 1280×800, `VIEWPORT_MARGIN` 4. "Content" is the panel's measured preferred size; "committed height" is what `getHeight()` returns after `showAt`. In a test, pin the content size with `preferredSize` in the options bag — `getPreferredSize` returns an explicit constraint ahead of the layout manager's report, so the numbers below are reproducible without building children.

| Anchor rect | Content | x | y | Committed height | Why |
|---|---|---|---|---|---|
| left 100, right 180, top 100, bottom 124 | 200×300 | 100 | 124 | 300 | fits below; left edges align |
| left 100, right 180, top 700, bottom 724 | 200×300 | 100 | 400 | 300 | 72 px below vs 696 above: flips, bottom flush with the anchor top |
| left 100, right 180, top 700, bottom 724 | 200×900 | 100 | 4 | 696 | flips, then caps to the room above and scrolls |
| left 1200, right 1270, top 100, bottom 124 | 200×300 | 1070 | 124 | 300 | left alignment overflows: right edges align instead |

1. Each row above holds after `panel.showAt(rect)`.
2. Every row sets `maxSize.height` to the room at the chosen side (672, 696, 696, 672 top to bottom). Row 3 is the only one where that cap bites — the committed height equals the cap, and `overflow-y: auto` on the panel scrolls the remaining content.
3. A second `showAt` with a *taller* content set does not inherit the previous open's cap: the panel re-measures and re-caps from the room at the new anchor.
4. `showAt` on a panel whose layout manager reports no preferred size falls back to the panel's current `getWidth()` / `getHeight()` and still places and mounts without throwing.
5. `panel.isOpen()` is `true` immediately after `showAt` and `false` immediately after `hideAnimated`.

**Toggle identity.**

| Gesture | State before | Result |
|---|---|---|
| `toggleFor(buttonEl, rect)` | closed | opens anchored at `rect`; the opener is recorded and excluded from outside-click dismissal |
| `toggleFor(buttonEl, rect)` again | open for `buttonEl` | closes; the opener is forgotten |
| `toggleFor(otherEl, otherRect)` | open for `buttonEl` | re-shows anchored at `otherRect` for `otherEl` |
| `hideAnimated()` then `toggleFor(buttonEl, rect)` | open for `buttonEl` | opens (the close forgot the opener, so this is not read as a toggle-shut) |

6. Each row above holds.
7. `toggleFor` sets the panel's `aria-labelledby` to the opener's id when the opener element has one, and leaves it untouched when it does not.
8. `requestClose()` — the advisory the layer manager calls on an outside pointerdown or Escape — closes the panel and clears the opener when no close handler is installed.

**PopupButton.**

| `panel` option | First toggle | Second toggle |
|---|---|---|
| a `PopupPanel` instance | that instance opens | same instance closes |
| `() => PopupPanel({ … })` | factory called once; result opens | same instance closes; factory not called again |
| omitted | nothing opens; the `"action"` event still fires | unchanged |

9. Each row above holds.
10. Toggling a button that is not attached to the DOM is a no-op: no panel is constructed (a factory is not called), nothing registers with `LayerManager`, and nothing throws.
11. The button reports `aria-haspopup="dialog"` from construction and `aria-expanded="false"`; the flag flips to `"true"` on open and back to `"false"` on close.
12. After the panel is first resolved, the button's `aria-controls` holds the panel's id.
13. An outside dismissal — driving `panel.requestClose()` directly in a test — closes the panel *and* returns the button to `aria-expanded="false"`, because the button installed its own close thunk.
14. `setPanel` with a new value disposes the previously resolved panel; `getPanel` returns the configured instance-or-factory, or `null` when nothing was configured.
15. Disposing the button disposes the resolved panel.

**Manual verification** (the offline harness cannot exercise these):

- The entrance and exit fades, and that a rapid re-open mid-fade keeps the panel on screen.
- Clicking the button while its popup is open closes it rather than reopening it — this runs through the layer manager's window-level capture handler, which the harness does not drive.
- A popup taller than the room shows a working native scrollbar.
- Escape closes the popup and returns focus behaviour to normal.

Exercise all four in the demo app (`npm run dev`, `localhost:8015`) using the `PopupButton` added to `MiscPanel` in step 11.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new `PopupPanel` / `PopupButton` / `OverlayPosition` suites pass, and the existing `Menu` suite (1439 lines) passes unchanged, which is what pins the step-3 refactor as behaviour-preserving.
- `grep -n 'resolvePlacement\|MenuPlacement\|positionAligned\|primitive/Size' packages/lib/src/typescript/lib/overlay/Menu.ts` — zero matches.
- `npm run lint` — clean, including the `local/no-raw-dom` and `require-subclass-defaults` rules.
- `npm run docs:api` — zero warnings (public JSDoc may only `{@link}` symbols that appear in the API docs).
- `npm run docs:llms` — regenerates `packages/lib/llms.txt`; the diff should contain only the two new capability rows.
- Manual smoke test in the demo app per *Expected Behaviour*.

---

## Documentation Impact

- **Export surface**: `PopupPanel` + `PopupPanelOptions` from `~/overlay/index.ts` (consumer subpath `@jimka/typescript-ui/overlay`); `PopupButton` + `PopupButtonOptions` from `~/component/button/index.ts` (`@jimka/typescript-ui/component/button`).
- **New pages**: `packages/lib/docs/components/PopupPanel.md` and `packages/lib/docs/components/PopupButton.md`. Follow [`MenuButton.md`](packages/lib/docs/components/MenuButton.md)'s shape: one-paragraph intro linking the API page, a `## Usage` block, a section per notable behaviour (placement, height cap and scrolling, dismissal, ARIA), and a `## See also` list. `PopupPanel.md` must state the scrollbar caveat from *Potential Challenges* and the `maxSize`-is-owned rule.
- **Nav entries**: `packages/docs/src/content/pages.ts` — add `{ path: '/components/PopupPanel', label: 'PopupPanel' }` to `componentsCore` after the `Popover` entry (line 170), and `{ path: '/components/PopupButton', label: 'PopupButton' }` to `componentsButtons` after the `MenuButton` entry (line 179).
- **Capability manifest**: `packages/lib/scripts/llms/manifest.data.mjs` — add `{ task: "Custom popup panel anchored to a trigger", symbol: "PopupPanel" }` and `{ task: "Button whose click opens a custom popup panel", symbol: "PopupButton" }`, the second next to the `MenuButton` row (line 58). Then regenerate with `npm run docs:llms`; never hand-edit `llms.txt`.
- **Cross-references**: add a `See also` link to `PopupPanel` in `docs/components/Popover.md` and in `docs/components/AnimatedDropdown.md` (the latter should say that a ready-made content-sized popup exists, so a consumer does not subclass `AnimatedDropdown` by reflex); add a `PopupButton` link to `docs/components/MenuButton.md`'s `See also`.

---

## Potential Challenges

- **The native scrollbar overlaps content when the panel scrolls.** `PopupPanel` reserves no scrollbar gutter, so children stretched to the full inner width run under the bar at the trailing edge. Mitigation: document it, and point a consumer whose popup routinely overflows at wrapping the content in a `Panel({ autoScroll: "y" })` under a `Fit` layout, whose own gutter machinery insets correctly.[^no-gutter]
- **A content minimum taller than the room defeats the height cap.** `clampHeight` applies the maximum first and the minimum second ([Component.ts:3496](packages/lib/src/typescript/lib/core/Component.ts#L3496)), so a panel whose children report minimum heights summing above the available room keeps that larger height and overflows the viewport instead of scrolling. This is the framework's stated rule for an over-constrained child, not a defect in the cap. Mitigation: document that popup content should leave its minimum heights unset, and note the workaround — wrap the content in a `Panel`, which clamps to its explicit constraints only.
- **A layout manager swapped in after construction loses the overflow flag.** The constructor calls `setOverflowing(false, true)` once on whichever manager is in effect. Mitigation: pass `layoutManager` in the options bag, which is the project's construction convention anyway; document that a later `setLayoutManager` needs the flag re-applied.
- **`setPanel` during the `super()` cascade.** `applyOptions` dispatches `setPanel`, which writes `_resolvedPanel`; a plain field initializer would run after `super()` and silently wipe it. Mitigation: the `declare` + `??= null` shape spelled out in step 9.
- **The layer manager is a module singleton across tests.** A test that opens a panel and never closes it leaks a registered layer into the next test. Mitigation: drain in `afterEach`, copying the pattern from `tests/overlay/AnimatedDropdown.test.ts`.
- **Two panels sharing one button, or one panel shared by two buttons.** The ownership rule is one panel per button; a shared panel would be disposed by whichever button tears down first. Mitigation: state the rule in the `PopupButton` class doc comment.

---

## Critical Files

| File | Why |
|---|---|
| [`core/AnimatedDropdown.ts`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L64) | The base class: lifecycle, fade, layer registration, `setCloseHandler` / `setAnchorElement`, `isOpen` |
| [`overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts#L289) | The precedent for content measurement, the height cap, `toggleFor`'s opener identity, and native vertical scroll on a non-`Panel` overlay |
| [`component/button/MenuButton.ts`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L50) | The precedent `PopupButton` mirrors: constructor overloads, lazy panel, options routing, destructor |
| [`core/OverlayPosition.ts`](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L174) | The placement primitives and the flip/align/clamp semantics the new function composes |
| [`core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts#L41) | The dismissal contract, the anchor exclusion, and the z-index bands |
| [`overlay/Popover.ts`](packages/lib/src/typescript/lib/overlay/Popover.ts#L153) | The nearest existing composable overlay — read it to see why its geometry does not cover this case |
| [`component/input/AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L485) | The second host-drives-a-dropdown precedent: `ensureDropdown`, `setCloseHandler`, `setAnchorElement` |
| [`core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L382) | The `setOverflowing` call shape replicated for the panel's vertical scroll |
| [`component/menubar/MenuBarButton.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L113) | The trigger-side ARIA precedent |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) / [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) | Typed setters, options-bag caching, `callable()` export, the `declare` cascade rule |

---

## Non-Goals

- **Migrating `Menu` or `Popover` onto `PopupPanel`.** Both already share the fade and the layer machinery, and each owns geometry `PopupPanel` cannot express.[^no-migration]
- **A pluggable placement-strategy object on `AnimatedDropdown`.** Placement is a method; overriding it is the extension point.
- **New theme tokens.** `PopupPanel` reuses the existing floating-panel chrome values.
- **A scrollbar gutter.** See *Potential Challenges* for the caveat and the escape hatch.
- **Keyboard navigation inside the panel.** `AnimatedDropdown.handleKey` already exists as the hook; a generic popup's content owns its own focus model.
- **A docs demo module** under `packages/docs/src/demos/`. That set is curated — 61 demos across 97 component pages, and `MenuButton` has none; the `MiscPanel` demo added in step 11 covers manual verification.
- **Opening a popup at a cursor point rather than a trigger rect.** A zero-size rect at the cursor already works through the same code path, as `Menu.show` demonstrates; no separate entry point is added.

---

## Notes

[^extends-dropdown]: Three shapes were considered. **Absorbing `AnimatedDropdown` into a renamed `PopupPanel`** would touch four subclasses (`AutoCompleteDropdown`, `ComboBoxDropdown`, `TimePickerDropdown`, `AbstractCalendarDropdown`), `AbstractPickerField`'s `TDropdown` type parameter, the `core` barrel, the API docs page, and the demo app — churn with no behavioural gain. **Generalizing `placeAnchored` into a pluggable strategy** solves a problem nobody has: reading all four subclasses shows each does the identical four-step dance (set content, `setWidth`/`setHeight` from its own math, `placeAnchored(rect)`, `showAnimated()`), so no existing subclass wants a different strategy, and `PopupPanel` does not want `placeAnchored` at all (see the flexible-placement note). **Subclassing** costs one new file and changes nothing that already works. What the four subclasses rely on from the base — `showAnimated` / `hideAnimated`, `isOpen`, `handleKey`, `setAnimated` / `setDurationMs` / `setTranslatePx`, `setCloseHandler`, `setAnchorElement`, `placeAnchored`, the `Position.FIXED` constructor call, and the destructor's fade cancellation — is untouched by this plan.

[^no-strategy]: A strategy object would be a new pattern in this codebase. Every floating surface today owns a placement *method* and composes the pure primitives in `core/OverlayPosition.ts` inside it: `AnimatedDropdown.placeAnchored`, `Menu.resolvePlacement` plus `Menu.placeVertically`, `Popover.resolvePlacement` plus `Popover._reposition`. The shared thing is the primitive, not an interface. Following that keeps a future `Menu` or `Popover` migration open — either could subclass `PopupPanel` and override `resolvePlacement` — without inventing a seam now.

[^flexible-placement]: `AnimatedDropdown.placeAnchored` calls `positionAnchored(…, { axis: "vertical" })`, which is the **fixed-size** path: it returns only a coordinate, so a panel too tall for the room is positioned to stay on screen and simply overflows the viewport, with the overflowing content unreachable. `positionFlexibleAnchored` is the **size-flexible** path and additionally returns `available`, the room on the side the element actually landed on, which is exactly the height cap a content-sized panel needs. `Menu` already uses it for the same reason. The distinction is documented at [OverlayPosition.ts:174](packages/lib/src/typescript/lib/core/OverlayPosition.ts#L174): re-deriving the room from the resolved coordinate measures the wrong side after a flip.

[^menu-dedupe]: `Menu.resolvePlacement` and `PopupPanel`'s placement are the same six lines — `positionFlexibleAnchored` on the vertical axis, `positionAligned` on the horizontal, with the `available` from the vertical result. Leaving both in place means two copies of a rule whose subtlety (which side `available` measures) is already the subject of a warning comment. The refactor is mechanical, the two call sites are in one private method's callers, and `Menu.test.ts` covers the behaviour, so the risk is low and the alternative is a duplicate that will drift.

[^maxsize-owned]: `Menu` hits the same requirement and solves it the same way, including the "clear the previous open's cap before measuring" step at [Menu.ts:341](packages/lib/src/typescript/lib/overlay/Menu.ts#L341) — a reused panel that skipped the clear would be capped at the *previous* open's room and would never grow back. Because `PopupPanel` inherits `Component`'s `clampsToContentSize()` (true), `setMaxSize` followed by `setHeight` produces exactly the cap-and-scroll behaviour; a `Container` or `Panel` base would not, since those clamp only to explicit constraints. Preserving a consumer's own `maxSize` across opens was rejected: it needs a snapshot of the pre-cap value, and any other writer of `maxSize` then leaks staleness into the snapshot. `preferredSize` is the supported way to pin a size and composes correctly with the cap.

[^button-subclass]: A helper attachable to any `Button` was considered and rejected on two grounds. It has no teardown hook, so nothing would dispose the panel when the button goes away — and `MenuButton` disposes its `Menu` precisely because a `LayerManager`-mounted panel is not a registered child and the base destructor's recursion cannot reach it. It would also have to reach into the button's lifecycle from outside, and ARCHITECTURE.md's event rules make a component's own named surface the contract. Every existing trigger in the library is a `Button` subclass (`MenuButton`, `SplitButton`, `NotificationHistoryButton`) or a host that calls the panel's toggle method directly (`ToolBar`, `AbstractPickerField`), and `toggleFor` keeps that second route open for non-button triggers.

[^panel-union]: `menuItems`' provider re-runs per open because it produces *data* that should reflect current state, and `Menu` rebuilds its rows from that data each time. A panel is a live component with its own state and children; calling the factory again would build a second component and orphan the first. Resolving once matches `AbstractPickerField.ensureDropdown`, which calls its `createDropdown()` hook exactly once per field. The factory form still earns its place over an instance-only option: it defers construction (and the child components inside it) until the popup is first opened, which is why `MenuButton` builds its `Menu` lazily too.

[^ownership]: The alternative — the consumer owns the panel and must dispose it — leaks by default, because the natural call site (`panel: () => PopupPanel({ … })`) hands the consumer no reference to dispose. `MenuButton.destructor` already establishes button-owns-panel for this exact relationship. The cost is that a panel shared between two buttons is disposed by the first teardown, which the class doc comment calls out.

[^chrome-tokens]: `TimePickerDropdown`, `ComboBoxDropdown`, and `AbstractCalendarDropdown` all use this same four-value set, so a `PopupPanel` sitting next to a `ComboBox` dropdown matches it exactly. A new `--ts-ui-popup-*` group would mean a new `Theme.ts` interface group, light and dark values, a mapping entry, and a theming-docs row — surface that buys nothing until someone wants popups themed apart from dropdowns. The `autocomplete` prefix is a legacy name for what is in practice the shared dropdown-panel chrome; renaming that token family is a separate, broader change.

[^declare-field]: `CODE_CONVENTIONS.md`'s rule: any field a cascade-dispatched setter writes must be declared bare with `declare`, because a class-field initializer runs *after* `super()` returns and would overwrite the value the setter wrote during the cascade. `Popover` uses the same shape and seeds its declared fields with `??=` in its constructor body ([Popover.ts:221](packages/lib/src/typescript/lib/overlay/Popover.ts#L221)).

[^no-gutter]: `Menu` reserves the bar's width by writing its own insets ([Menu.ts:363](packages/lib/src/typescript/lib/overlay/Menu.ts#L363)) — safe there because `Menu` owns its insets outright. `PopupPanel`'s insets belong to the consumer, so the same move would clobber them, and tracking a pre-gutter snapshot to add and remove the reservation reintroduces exactly the stale-snapshot failure mode described in the `maxSize` note. Overlaying the trailing edge is also the divergence the framework already accepts elsewhere: the pending overlay-scrollbars work for `CodeEditor` and `TextArea` documents that neither can inset its scroll viewport and that content passes under the bar. Absolutely-positioned children are laid out against the padding box, which the scrollbar does not shrink, so the overlap is inherent to any non-`Panel` scroll host in this framework.

[^no-migration]: Both migrations were costed against the actual code. `Menu` is 1187 lines with two disjoint modes (rebuild and persistent), a submenu chain with its own left/right flip against the parent panel, a column-alignment pass that computes the panel width from item metrics, per-open item teardown and rebuild, an opener-exclusion field, and a scroll-to-bottom-on-show mode; its 1439-line test file pins that behaviour. `Popover` is 1022 lines whose distinctive mass — a rotated-square arrow tail that straddles the panel edge and re-points at the anchor centre on every layout, edge-based placement with centring, and reposition listeners on every scrollable ancestor — is untouched by anything `PopupPanel` provides. What the two would inherit from a shared base is the fade and the layer registration, and they already share both: the fade through the `fadeShow` / `fadeHideAndDetach` free functions, the dismissal and z-stamp through `LayerManager`. So a migration would move risk without removing duplication. Nothing here forecloses it later: `resolvePlacement` is a protected override point, and `PopupPanel` adds no private coupling a subclass would have to fight.

[^why-not-popover]: `Popover` with `showArrow: false` was considered as the ready-made answer and does not fit. It centres the bubble on the anchor edge and always keeps a ~12 px arrow gap, where a trigger popup must sit flush and left-aligned under its trigger and flip its alignment at the viewport edge; changing that geometry would move every existing popover. It never caps its height, so a tall popup is clamped into the viewport with its content cut off rather than scrolled. And it registers in the Popover z-band, below dropdowns, so a popup opened from a toolbar would paint under an unrelated open dropdown. `PopupPanel` is the dropdown-geometry sibling of `Popover`; both are thin skins over the same layer and fade primitives.
