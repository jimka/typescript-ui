# Menu Anchored Placement & MenuButton — Implementation Plan

## Overview

A menu opened from a trigger button is placed wrongly: it lands *over* the button. [`Menu.toggleFor`](src/typescript/lib/overlay/Menu.ts#L322) is anchored in name only — it forwards to [`show(x, y, …)`](src/typescript/lib/overlay/Menu.ts#L188), which cursor-clamps through `clampIntoViewport` and never flips. For a trigger at the viewport bottom (a `NotificationHistoryButton` in a bottom `StatusBar`) there is no room below, so the clamp slides the panel *up* until its bottom sits at `vp.height - VIEWPORT_MARGIN` — directly over the trigger and under the pointer.

This plan (A) gives `Menu` a rect-anchored placement path that flips above the trigger when the room below is short, keeping plain `show(x, y, …)` unchanged for genuine right-click context menus, and (B) adds `MenuButton` — a `Button` subclass that owns the rect-read / toggle / per-open-rebuild boilerplate — with [`NotificationHistoryButton`](src/typescript/lib/overlay/NotificationHistoryButton.ts#L76) refactored to extend it.

The placement maths is extracted as one new pure function, `positionFlexibleAnchored`, in [`core/OverlayPosition.ts`](src/typescript/lib/core/OverlayPosition.ts#L102) — shared by the new rect-anchored rebuild path and by the existing persistent-mode [`Menu.placeVertically`](src/typescript/lib/overlay/Menu.ts#L776), which already implements exactly this policy privately.

---

## Architecture Decisions

### `positionAnchored` is the wrong primitive for `Menu` — refine the diagnosis

The obvious fix — route `Menu` through the existing [`positionAnchored`](src/typescript/lib/core/OverlayPosition.ts#L102) — does **not** work, and the plan must not attempt it. `positionAnchored` places a **fixed-size** element (its only consumer, [`AnimatedDropdown.placeAnchored`](src/typescript/lib/core/AnimatedDropdown.ts#L354), sets width/height *before* calling it). `Menu` is **size-flexible**: it caps its height to the room on whichever side it lands and scrolls the overflow. Three concrete mismatches:

1. **It returns a coordinate, not a side.** `Menu` must know the room on the side it landed to compute `available` for `applyViewportHeightClamp` *and* the scrollbar `gutter`. Re-deriving `available = vp.height - y - VIEWPORT_MARGIN` from the returned `y` is exactly the bug being fixed: for a flipped menu it measures the wrong side.
2. **Its flip policy is wrong for a scrolling panel.** [`flipAxis`](src/typescript/lib/core/OverlayPosition.ts#L44) flips only when the element **fully fits** on the near side; otherwise it saturates to `max(0, viewportExtent - extent)` or `0` — i.e. *fills the viewport*, covering the trigger. The failing case is precisely a history menu that fits on *neither* side: it must still flip, clamp to the room above, and scroll.
3. **Its `margin` is cross-axis only**; the primary axis honours only `gap`. `Menu`'s `VIEWPORT_MARGIN` must bind on the growth axis, because it participates in the room arithmetic.

`Menu.placeVertically` (persistent mode) **already** implements the correct policy, and its doc comment already names the trap: *"The room is measured against the side the menu actually grows toward — never re-derived from a clamped top."* The fix is therefore to **extract `placeVertically`'s maths into `core/OverlayPosition.ts` as a pure sibling of `positionAnchored`, and route the new rect-anchored rebuild path through it.** `positionAnchored` and `AnimatedDropdown` are left untouched.

### New API shape: change `toggleFor`'s signature to take a `Rect` (breaking, justified)

`toggleFor(openerEl, x, y, configs, onClose?)` becomes `toggleFor(openerEl, anchorRect: Rect, configs, onClose?)`. Not an additive `toggleForRect`, because:

- **Every existing caller already derives `x, y` from a rect** — `SplitButton.ts:232`, `ToolBar.ts:685`, `NotificationHistoryButton.ts:120` all do `DOM.source.getViewportRect(…)` then pass `rect.left, rect.bottom`. There is no pointer-anchored `toggleFor` caller in the repo, in `docs/`, or in the consuming app (sqladmin uses `show()` for its four button menus).
- **`toggleFor`'s documented purpose is a left-click dropdown trigger.** Its `x, y` form is therefore *always* the wrong anchoring for its own contract — a bug surface, not a feature. Keeping both forms would leave the broken one reachable and force a second, redundant code path.
- Migration is three mechanical call sites plus one test line. An additive method would keep dead-wrong code alive for zero benefit.

`show(x, y, …)` is **unchanged in signature and behaviour** — it stays the supported, cursor-anchored, clamp-not-flip call for right-click context menus.

No public non-toggle anchored show (`showForRect`) is added: nothing needs one, and `toggleFor` covers every trigger case. The anchored path is a private `showAnchored`.

### The anchor is a `Rect` parameter, not derived from `openerEl`

`Menu` could read `DOM.source.getElementRect(openerEl)` itself and drop the parameter — but `SplitButton` deliberately passes the **chevron** as `openerEl` (the element excluded from outside-click dismissal) while anchoring the menu to the **whole button**'s rect. The two are different elements; the rect stays an explicit parameter.

### The crux: `available` is decided by the flip, so the primitive returns it

`positionFlexibleAnchored` returns `{ start, available }` — the coordinate **and** the room on the side actually chosen. `Menu` then:

- computes `available` from the primitive (never from the resolved `y`),
- derives `gutter = totalHeight > available ? scrollBarWidth : 0` from it,
- passes it to `applyViewportHeightClamp`.

For a flipped menu the primitive returns `start = nearEdge - Math.min(extent, roomNear)`, so the panel's **bottom** meets the trigger's top even when the content is clamped and scrolls. This is the case that breaks today: a long history menu opened from the viewport bottom.

### Gap and margin values `Menu` passes

`positionFlexibleAnchored` takes **no `gap`**: both `Menu` call paths sit flush against the anchor edge (`anchorRect.bottom`), which is today's behaviour for persistent-mode dropdowns and matches `AnimatedDropdown.placeAnchored`'s `gap: 0`. Do not add a gap parameter — no caller needs one, and `positionAnchored` keeps its own `gap` for `AnimatedDropdown`.

`Menu` passes `margin: VIEWPORT_MARGIN` (= 4, [`Menu.ts:30`](src/typescript/lib/overlay/Menu.ts#L30)) on the growth axis, identical to `placeVertically`'s current arithmetic. The cross axis (x) keeps using `clampIntoViewport(…, VIEWPORT_MARGIN).x`, so the horizontal margin is unchanged from `show()`.

**Naming trap the JSDoc must call out:** `positionAnchored`'s `margin` is *cross-axis*; `positionFlexibleAnchored`'s `margin` is *primary-axis*. Name the new parameter `viewportMargin` and document it.

### `MenuButton` lives in `~/component/button/`

Alongside `Button` / `SplitButton`, exported from `component/button/index.ts`. `SplitButton` already imports `~/overlay/Menu.js`, so the button → overlay direction is established; no new cycle class. `NotificationHistoryButton` **stays** in `~/overlay/` (moving it would break its export path for no gain) and imports `MenuButton`.

### `NotificationHistoryButton` extends `MenuButton` — and collapses to a defaults-bag seed

Its `buildItems()` uses only statics (`Notification.getHistory()`, module-level `formatRelativeTime`) — no `this`. So it becomes a module-level `buildHistoryItems()` passed through the **subclass defaults bag**, and the class reduces to a constructor that seeds `{ glyph, menuItems, scrollToBottomOnShow }` plus an aria label. That collapse *is* the proof the abstraction earns its keep. No protected `buildMenuItems()` hook is added — the defaults bag already carries a per-open provider, so a hook would be a second mechanism for the same job.

### `MenuButton` mirrors `Button`'s constructor **overload pair** — options-only construction must work

An earlier draft of this plan mandated a single, non-overloaded constructor, forcing every options-first construction to pass a dummy `MenuButton(undefined, { … })`. **That was wrong** — it misread the `callable()` constraint, and it is corrected here.

`Callable<T> = T & ((...args: ConstructorParameters<T>) => InstanceType<T>)` ([`core/Callable.ts:10`](src/typescript/lib/core/Callable.ts#L10)) — an **intersection**. `ConstructorParameters<T>` resolves to the **last** overload, which governs only the *call* form; the `new` form keeps the full overload set. `Button` exploits this by declaring the options-only overload **last** ([`Button.ts:430-431`](src/typescript/lib/component/button/Button.ts#L430)), which is exactly what makes the codebase-wide `Button({ … })` idiom typecheck. `MenuButton` declares the same pair, in the same order.

Verified empirically against `tsconfig.lib.json` with a throwaway subclass (results, not predictions):

| Form | Result |
| --- | --- |
| `MenuButton({ glyph, menuItems })` | ✅ typechecks — the options-only call form |
| `new MenuButton("Save", { menuItems })` | ✅ typechecks — `new` sees both overloads |
| `new MenuButton({ menuItems })` | ✅ typechecks |
| `super(undefined, options, { … })` from a subclass | ✅ typechecks — `super()` resolves against overload 1 |
| `MenuButton("Save", { menuItems })` | ❌ `TS2554: Expected 1 arguments, but got 2` |

The last row is **not a regression and must not be "fixed"**: `Button("Save", { glyph })` is *already* the same error today (verified). Text-plus-options construction goes through `new`, exactly as it does for `Button`. Reordering the overloads to rescue it would break `MenuButton({ … })` — the far more common form, and the one the consuming app uses everywhere.

The implementation normalises the overload **before** `super()`, copying [`Button.ts:437-443`](src/typescript/lib/component/button/Button.ts#L437) verbatim in shape. TS ≥ 4.6 permits statements before `super()` provided they never touch `this` — verified to compile with `MenuButton`'s initialized `_menu` / `_boundToggleMenu` fields present.

### An empty item list means "don't open" — enforced in `Menu.toggleFor`, not in `MenuButton`

A provider that resolves to `[]` must **not** open the menu. Today the behaviour is *unspecified* rather than merely awkward: `Menu.show` loops zero configs and mounts a bare ~8px panel (`Insets(4, gutter, 4, 0)` around nothing), which is never a useful thing to put on screen. This also fixes a **latent bug in `SplitButton` today**: `new SplitButton('Save')` with no `menuItems` defaults `_menuItems` to `[]` ([`SplitButton.ts:125`](src/typescript/lib/component/button/SplitButton.ts#L125)), so its chevron currently opens an empty panel.

Making `[]` mean "don't open" strictly *adds* expressiveness — a consumer that wants to explain the emptiness still returns a placeholder row, which is what `NotificationHistoryButton` deliberately does (`[{ text: "No notifications yet", enabled: false }]`, informative for a history menu). Both intents stay sayable; neither is lost.

**The check belongs in `Menu.toggleFor`, after the toggle-shut branch — not in `MenuButton.toggleMenu()`.** Ordering is load-bearing:

- `toggleFor`'s first branch is `if (this._currentOpener === openerEl) { this.hide(); … }`. A `MenuButton`-level bail would return **before** that branch, so a click meant to *close* an already-open menu whose provider now resolves to `[]` would do nothing and strand the panel open. That is precisely the `_currentOpener` desync to avoid.
- Placing it in `toggleFor` also means `_currentOpener` is only ever written on a real show, so a suppressed open leaves no stale opener state and the next press of that opener is a clean open.
- It is `toggleFor`'s contract ("open **for this trigger**") that owns the notion, so `SplitButton` and `ToolBar` are fixed by the same line, and `MenuButton.toggleMenu()` needs no empty check at all.

**A suppressed open still fires `onClose`.** Without it, `SplitButton` breaks: `_toggleMenu` optimistically spins its chevron up *before* calling `toggleFor` and relies on `onClose` to spin it back ([`SplitButton.ts:225-237`](src/typescript/lib/component/button/SplitButton.ts#L225)) — a silent bail would strand the caret pointing up forever. Firing `onClose` is squarely within its documented purpose: *"letting the opener revert an open-state affordance such as a rotated dropdown chevron."*

**`show(x, y, [])` is deliberately left unchanged** (it still mounts the empty panel). The asymmetry is intentional: `toggleFor` is the trigger-anchored path where "the button has decided there is nothing to show" is a real, recurring state a provider must be able to express, whereas `show()` is the cursor-anchored context-menu call whose caller builds items for one specific click and simply would not call it with an empty list. Changing `show()` would alter the one path this plan promises not to regress, for no known caller. If one appears, that is a separate, deliberate change.

### `menuItems` accepts an array **or** a provider

`MenuButtonOptions.menuItems?: MenuItemConfig[] | (() => MenuItemConfig[])` — the same union `Menu`'s own constructor takes ([`Menu.ts:106`](src/typescript/lib/overlay/Menu.ts#L106)), and the same option *name* `SplitButton` uses. The provider form is resolved on **every** open, which is what keeps `NotificationHistoryButton`'s relative times current. A static array still works because rebuild-mode `show()` rebuilds its items per call regardless.

### `SplitButton` and `ToolBar` are not refactored onto `MenuButton`

`SplitButton`'s trigger is its chevron, not its face, and its face owns a separate primary action — it cannot be a `MenuButton`. `ToolBar`'s overflow button is an internal `Button` whose items come from `ToolBar` state. Both only get their `toggleFor` call site migrated to the `Rect` signature. Surgical changes rule.

---

## Public API

```typescript
// src/typescript/lib/core/OverlayPosition.ts — NEW export

/**
 * The chosen coordinate for a size-flexible anchored element, plus the room
 * available on the side it landed on.
 *
 * @category Core
 */
export interface FlexiblePlacement {
    /** Top-left coordinate on the primary axis. */
    start:     number;
    /** Room (px) on the side actually chosen — the caller's height/width cap. */
    available: number;
}

export function positionFlexibleAnchored(
    nearEdge:       number,
    farEdge:        number,
    extent:         number,
    viewportExtent: number,
    viewportMargin: number,
): FlexiblePlacement;
```

```typescript
// src/typescript/lib/overlay/Menu.ts — CHANGED signature (breaking) + CHANGED empty-list behaviour

/**
 * …an empty `configs` opens nothing: the menu is not shown, `onClose` fires once
 * so the opener can revert an open-state affordance, and no opener state is
 * recorded. A repeat press of the *same* opener still closes an open menu — the
 * toggle-shut branch runs before the empty check.
 */
toggleFor(openerEl: Handle, anchorRect: Rect, configs: MenuItemConfig[], onClose?: () => void): this;

// UNCHANGED (signature and behaviour, including `configs: []` mounting an empty panel):
show(x: number, y: number, configs: MenuItemConfig[], onClose?: () => void, excludeEl?: Handle | null): this;
```

```typescript
// src/typescript/lib/component/button/MenuButton.ts — NEW

export interface MenuButtonOptions extends ButtonOptions {
    /** Items for the dropdown, or a provider re-invoked on every open. */
    menuItems?:            MenuItemConfig[] | (() => MenuItemConfig[]);
    /** Open the menu scrolled to the bottom of its item list. Default `false`. */
    scrollToBottomOnShow?: boolean;
}

class MenuButton<TOptions extends MenuButtonOptions = MenuButtonOptions> extends Button<TOptions> {
    // Overload pair mirroring Button's, in Button's order: the options-only form
    // MUST come last so `callable()`'s call signature (ConstructorParameters =
    // last overload) accepts `MenuButton({ … })`. Do not reorder.
    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>);
    constructor(options: TOptions);

    setMenuItems(items: MenuItemConfig[] | (() => MenuItemConfig[])): this;   // cache: this._options.menuItems
    getMenuItems(): MenuItemConfig[] | (() => MenuItemConfig[]) | null;       // folds _defaultOptions
    isScrollToBottomOnShow(): boolean;                                        // folds _defaultOptions, default false

    protected applyOptions(options: TOptions): this;
}

const MenuButtonCallable = callable(MenuButton);
type  MenuButtonCallable<TOptions extends MenuButtonOptions = MenuButtonOptions> = MenuButton<TOptions>;
export {
    MenuButton         as _MenuButton,
    MenuButtonCallable as MenuButton,
};
```

```typescript
// src/typescript/lib/overlay/NotificationHistoryButton.ts — CHANGED base class

export interface NotificationHistoryButtonOptions extends MenuButtonOptions {}

class NotificationHistoryButton extends MenuButton<NotificationHistoryButtonOptions> { /* ctor only */ }
```

Supported construction forms (identical to `Button`'s — consumer call sites depend on this exact set):

```typescript
MenuButton({ glyph: "file-export", menuItems: [ … ] });          // ✅ options-only call form
MenuButton({ menuItems: () => buildItems() });                    // ✅ provider form
new MenuButton("Export", { menuItems: [ … ] });                   // ✅ text + options, via `new`
new MenuButton({ menuItems: [ … ] });                             // ✅
MenuButton("Export", { menuItems: [ … ] });                       // ❌ TS2554 — use `new` (same as Button)
```

No setter is added for `scrollToBottomOnShow`: it is a construction-time option read once when the lazy `Menu` is created (per CODE_CONVENTIONS *Construction*, `setX` is reserved for runtime changes).

---

## Internal Structure

### `positionFlexibleAnchored` (new, `core/OverlayPosition.ts`)

Place it directly after `clampAxis` and before `positionAnchored`. Body — this is `placeVertically`'s current arithmetic, verbatim, with the side effect removed:

```typescript
export function positionFlexibleAnchored(
    nearEdge: number, farEdge: number, extent: number, viewportExtent: number, viewportMargin: number,
): FlexiblePlacement {
    const roomFar  = viewportExtent - farEdge - viewportMargin;
    const roomNear = nearEdge - viewportMargin;

    if (extent <= roomFar || roomFar >= roomNear) {
        return { start: farEdge, available: roomFar };
    }

    return { start: nearEdge - Math.min(extent, roomNear), available: roomNear };
}
```

Doc comment must state: grows from `farEdge`; flips to end at `nearEdge` only when the content overflows the far room **and** the near side is roomier; the returned `available` is the room on the chosen side, so a caller that caps the extent measures the right side; `viewportMargin` binds on **this** axis (unlike `positionAnchored`'s cross-axis `margin`); flush against the anchor (no gap).

### `Menu` — anchor union and placement resolution

Module-private, above the class:

```typescript
/** Where a rebuild-mode menu is anchored: at a cursor point, or against a trigger's rect. */
type MenuAnchor =
    | { kind: "pointer"; x: number; y: number }
    | { kind: "rect";    rect: Rect };

/** A resolved rebuild-mode placement: the panel's top-left plus the height room at it. */
interface MenuPlacement { x: number; y: number; available: number; }

/**
 * Resolves a rebuild-mode panel's placement for `anchor` at `size`. Pointer-anchored
 * menus clamp into the viewport without flipping; rect-anchored menus grow below the
 * trigger and flip above it when the room below is short.
 */
function resolvePlacement(anchor: MenuAnchor, size: Size, vp: Size): MenuPlacement {
    if (anchor.kind === "pointer") {
        const p = clampIntoViewport(anchor.x, anchor.y, size, vp, VIEWPORT_MARGIN);

        return { x: p.x, y: p.y, available: vp.height - p.y - VIEWPORT_MARGIN };
    }

    const v = positionFlexibleAnchored(anchor.rect.top, anchor.rect.bottom, size.height, vp.height, VIEWPORT_MARGIN);

    // ONLY the horizontal clamp is taken from clampIntoViewport. `v.start` is already
    // final: re-clamping it would pin an over-tall flipped menu back to the top margin
    // and let it grow down across the trigger — the bug this path exists to fix.
    const x = clampIntoViewport(anchor.rect.left, v.start, size, vp, VIEWPORT_MARGIN).x;

    return { x, y: v.start, available: v.available };
}
```

`resolvePlacement` is a module function (no `this`), keeping it pure and directly reasoned about; it needs `VIEWPORT_MARGIN`, already module-scoped.

### `Menu.show` → `Menu.showAnchored`

Rename the existing `show` body to `private showAnchored(anchor: MenuAnchor, configs, onClose: (() => void) | null, excludeEl: Handle | null): this` and change **only** its geometry block. Everything before it (item teardown/rebuild, `layOutColumns`, `setWidth(naturalWidth)`, `setMaxSize(MAX_VALUE, MAX_VALUE)`, `getPreferredSize`) and after it (`scheduleLayout`, `LayerManager.mount/register`, `fadeIn`, `_scrollToBottomOnShow`) is untouched. The geometry block at [`Menu.ts:241-271`](src/typescript/lib/overlay/Menu.ts#L241) becomes:

```typescript
const vp = DOM.source.getViewportSize();

// First pass at the natural width resolves the vertical room. Width does not
// affect the vertical placement, so `available` stays correct after the
// scrollbar-gutter widening below; only `x` needs the second pass.
const available = resolvePlacement(anchor, { width: naturalWidth, height: totalHeight }, vp).available;

// When the content is taller than the room on the side the menu lands on,
// `applyViewportHeightClamp` caps the height and the `overflow-y: auto` scrollbar
// engages. Reserve its width as a right inset — and widen the content-sized panel
// to match — so items lay out beside the native scrollbar instead of beneath it.
const gutter = totalHeight > available ? DOM.source.getScrollBarWidth() : 0;

this.setInsets(new Insets(4, gutter, 4, 0));
this.setWidth(naturalWidth + gutter);

const placement = resolvePlacement(anchor, { width: this.getWidth(), height: totalHeight }, vp);

this.setX(placement.x);
this.setY(placement.y);
this.applyViewportHeightClamp(placement.available, totalHeight);
```

Public `show` becomes a two-line forwarder; `toggleFor` forwards with `{ kind: "rect", rect: anchorRect }` and `openerEl` as `excludeEl`.

### `Menu.toggleFor` — the empty-list suppression

The branch order below is the whole point; do not reorder it (see *Architecture Decisions*).

```typescript
toggleFor(openerEl: Handle, anchorRect: Rect, configs: MenuItemConfig[], onClose?: () => void): this {
    this.assertRebuildMode("toggleFor");

    // Same opener fired again while its menu is open: close it. Its pointerdown
    // was excluded from the dismissal, so this click is the toggle-shut. MUST stay
    // ahead of the empty check below — a provider that has since gone empty must
    // still be able to close the panel it opened.
    if (this._currentOpener === openerEl) {
        this.hide();

        return this;
    }

    // Nothing to show: an empty panel is never useful, so open nothing. `onClose`
    // still fires so the opener reverts an optimistic open-state affordance (e.g.
    // SplitButton's spun-up chevron), and `_currentOpener` stays untouched, so the
    // next press of this opener is a fresh open rather than a stale toggle-shut.
    if (configs.length === 0) {
        onClose?.();

        return this;
    }

    // Closed, or open for a different opener: (re)show anchored for this one.
    this.showAnchored({ kind: "rect", rect: anchorRect }, configs, onClose ?? null, openerEl);
    this._currentOpener = openerEl;

    return this;
}
```

An open menu belonging to a *different* opener needs no handling here: pressing another trigger fires a pointerdown outside the open menu's excluded element, so `LayerManager`'s outside-dismissal already ran `hide()` (which nulls `_currentOpener`) before this click lands.

### `Menu.placeVertically` delegates (persistent mode, behaviour-identical)

```typescript
private placeVertically(growTop: number, anchorTop: number, totalHeight: number, viewportHeight: number): number {
    const { start, available } = positionFlexibleAnchored(anchorTop, growTop, totalHeight, viewportHeight, VIEWPORT_MARGIN);

    this.applyViewportHeightClamp(available, totalHeight);

    return start;
}
```

Keep the method (its two `open()` call sites and its existing tests stay valid); only its body changes. Note the argument order flip: `placeVertically(growTop, anchorTop, …)` → `positionFlexibleAnchored(anchorTop /* near */, growTop /* far */, …)`.

### `MenuButton`

```typescript
class MenuButton<TOptions extends MenuButtonOptions = MenuButtonOptions> extends Button<TOptions> {

    // Lazily created on first open and reused across opens; a rebuild-mode Menu
    // rebuilds its items on every toggle, so a provider's output is always current.
    private _menu: Menu | null = null;

    private readonly _boundToggleMenu: () => void = () => { this.toggleMenu(); };

    // Overloads mirror Button's, options-only LAST so the callable call form is
    // `MenuButton({ … })`. See Architecture Decisions before touching the order.
    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>);
    constructor(options: TOptions);
    constructor(
        textOrOptions?:    string | TOptions,
        options?:          TOptions,
        subclassDefaults?: Partial<TOptions>,
    ) {
        // Normalise the overload: a non-string first argument is the options bag.
        // Copied from Button.ts:437-443. Legal before super() because it touches
        // no `this` (TS >= 4.6); the field initializers still run after super().
        let text: string | undefined;

        if (typeof textOrOptions === "string") {
            text = textOrOptions;
        } else if (textOrOptions !== undefined) {
            options = textOrOptions;
        }

        super(text, options, subclassDefaults);

        this.on("action", this._boundToggleMenu);

        // Button wires the listener bag only when it is the directly-constructed
        // class; mirror its instance-identity guard so a MenuButton subclass wires
        // its own bag once, from its own constructor.
        if (Object.getPrototypeOf(this) === MenuButton.prototype) {
            this.applyListeners(options?.listeners);
        }
    }

    /**
     * Toggles the menu anchored under the button's bottom-left corner, flipping
     * above the button when the room below is short. No-op when the button is not
     * yet attached (no anchor rect to read), or when the items resolve to an empty
     * list — `Menu.toggleFor` owns that suppression, so no check is needed here.
     */
    private toggleMenu(): void {
        const el = this.getElement();

        if (!el) {
            return;
        }

        this._menu ??= new Menu().setScrollToBottomOnShow(this.isScrollToBottomOnShow());
        this._menu.toggleFor(el, DOM.source.getViewportRect(this), this.resolveMenuItems());
    }

    /** Resolves the configured items — invoking the provider form on every open. */
    private resolveMenuItems(): MenuItemConfig[] {
        const items = this.getMenuItems();

        if (typeof items === "function") {
            return items();
        }

        return items ?? [];
    }
}
```

Getters fold the defaults bag (CODE_CONVENTIONS *Class-level defaults must survive the getter*):

```typescript
getMenuItems(): MenuItemConfig[] | (() => MenuItemConfig[]) | null {
    return this._options.menuItems ?? this._defaultOptions.menuItems ?? null;
}

isScrollToBottomOnShow(): boolean {
    return this._options.scrollToBottomOnShow ?? this._defaultOptions.scrollToBottomOnShow ?? false;
}
```

`setMenuItems` caches into the options bag (`this._options.menuItems = items`) — no backing field, so no `declare` cascade trap — and `applyOptions` forwards `options.menuItems` to it.

### `NotificationHistoryButton` after the refactor

`buildItems()` becomes module-level `buildHistoryItems(): MenuItemConfig[]` (same body, no `this`). The class body reduces to:

```typescript
constructor(options?: NotificationHistoryButtonOptions) {
    // Seeds live in the defaults bag so a caller's options still win.
    // History is chronological (latest at the bottom), so open scrolled to the
    // bottom; the provider re-runs per open so relative times stay current.
    super(undefined, options, {
        glyph:                "clock-rotate-left",
        menuItems:            buildHistoryItems,
        scrollToBottomOnShow: true,
    });

    this.getAria().setLabel("Notification history");

    // MenuButton wires the bag only for a plain MenuButton; as a subclass we wire
    // our own so a consumer `listeners` option is not silently dropped.
    this.applyListeners(options?.listeners);
}
```

Delete `_menu`, `_boundToggleMenu`, `toggleMenu()`, the `Menu` / `DOM` / `Button` imports, and the `on("action", …)` wiring — all now owned by `MenuButton`. Keep `formatRelativeTime` exported (tests import it).

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/OverlayPosition.ts`** — add `FlexiblePlacement` and `positionFlexibleAnchored` per *Internal Structure*, after `clampAxis`. Both `@category Core`. Do not touch `flipAxis`, `positionAnchored`, or `clampIntoViewport`.
2. **`tests/overlay/OverlayPosition.test.ts`** — add a `describe('positionFlexibleAnchored')` block covering the cases in *Expected Behaviour* §1, following the file's existing `rect()` / `size()` idiom. Run `npx vitest run tests/overlay/OverlayPosition.test.ts` — red until step 1 lands, green after.
3. **`src/typescript/lib/overlay/Menu.ts`** — import `Rect` (from `~/core/DOM.js`), `Size` (from `~/primitive/Size.js`), and `positionFlexibleAnchored`. Add the module-private `MenuAnchor`, `MenuPlacement`, and `resolvePlacement` above the class.
4. **`Menu.ts`** — rename `show`'s body to `private showAnchored(anchor, configs, onClose, excludeEl)`, replace its geometry block per *Internal Structure*, and re-add the public `show(x, y, configs, onClose?, excludeEl?)` forwarder (keeping its `assertRebuildMode("show")` and its existing JSDoc unchanged).
5. **`Menu.ts`** — rewrite `toggleFor` per *Internal Structure → `Menu.toggleFor`*: the `Rect` signature, the empty-list suppression **after** the toggle-shut branch, and the forward to `showAnchored`. Update its JSDoc: replace the `@param x` / `@param y` pair with `@param anchorRect - The trigger's viewport rect (e.g. `DOM.source.getViewportRect(button)`); the menu opens below it and flips above it when the room below is short.`, note the flip in the prose, and document the empty-`configs` contract (opens nothing, fires `onClose`, records no opener).
6. **`Menu.ts`** — rewrite `placeVertically`'s body to delegate to `positionFlexibleAnchored` (watch the near/far argument order). Its doc comment keeps its meaning; trim the arithmetic description now living in the primitive.
7. **`src/typescript/lib/component/button/SplitButton.ts:232`** — `this._menu.toggleFor(this._chevron.getElement(true)!, rect, this._menuItems, () => { this._setChevronOpen(false); })`. The anchor stays the **button's** rect (`DOM.source.getViewportRect(this)`), the opener stays the chevron.
8. **`src/typescript/lib/component/menubar/ToolBar.ts:685`** — `menu.toggleFor(triggerEl, rect, configs);`.
9. **`tests/overlay/Menu.test.ts:49`** — update the mode-guard call to the `Rect` form (build a literal `Rect`; the file has no helper — add a local one mirroring `tests/overlay/OverlayPosition.test.ts`'s `rect()`).
10. **Checkpoint:** `grep -rn 'toggleFor(' src/ tests/ docs/` — every call site passes a rect, none passes two numbers. Then `npm run typecheck && npm run typecheck:test`.
11. **`tests/overlay/Menu.test.ts`** — add a `describe('Menu rect-anchored toggleFor')` block per *Expected Behaviour* §2, plus the §3 regression that pointer `show()` is unchanged. Run `npx vitest run tests/overlay/Menu.test.ts`.
12. **Create `src/typescript/lib/component/button/MenuButton.ts`** per *Public API* + *Internal Structure*. Full JSDoc on the class (with an `@example`), the options interface, and every method; `@category Components`.
13. **`src/typescript/lib/component/button/index.ts`** — `export { MenuButton } from '~/component/button/MenuButton.js';` and `export type { MenuButtonOptions } from '~/component/button/MenuButton.js';`, placed after the `SplitButton` lines.
14. **`src/typescript/lib/overlay/NotificationHistoryButton.ts`** — extend `MenuButton`, widen `NotificationHistoryButtonOptions extends MenuButtonOptions`, move `buildItems` to module-level `buildHistoryItems`, and collapse the constructor per *Internal Structure*. Remove now-orphaned imports (`Button`, `Menu`, `DOM`).
15. **`tests/component/default-options-fallback.test.ts`** — add two registry rows next to the existing `NotificationHistoryButton glyph` row (line 173):
    - `{ label: 'NotificationHistoryButton menuItems', resolve: () => typeof new NotificationHistoryButton().getMenuItems(), expected: 'function' }`
    - `{ label: 'NotificationHistoryButton scrollToBottomOnShow', resolve: () => new NotificationHistoryButton().isScrollToBottomOnShow(), expected: true }`
16. **`tests/component/`** — add `MenuButton.test.ts` per *Expected Behaviour* §4, using `installTestDOM` (see `tests/overlay/Menu.test.ts`'s `CONFIG`).
17. **`src/typescript/MiscPanel.ts`** — no source change required; see *Verification* for the manual repro.
18. **Docs** — apply *Documentation Impact* in full.
19. **Checkpoint:** `npm run lint && npm test && npm run docs:build` (docs must finish with zero warnings).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/core/OverlayPosition.ts` |
| Modify | `src/typescript/lib/overlay/Menu.ts` |
| Create | `src/typescript/lib/component/button/MenuButton.ts` |
| Modify | `src/typescript/lib/component/button/index.ts` |
| Modify | `src/typescript/lib/component/button/SplitButton.ts` |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `src/typescript/lib/overlay/NotificationHistoryButton.ts` |
| Modify | `tests/overlay/OverlayPosition.test.ts` |
| Modify | `tests/overlay/Menu.test.ts` |
| Modify | `tests/component/default-options-fallback.test.ts` |
| Create | `tests/component/MenuButton.test.ts` |
| Create | `docs/components/MenuButton.md` |
| Modify | `docs/components/Menu.md` |
| Modify | `docs/components/NotificationHistoryButton.md` |
| Modify | `docs/components/index.md` |
| Modify | `docs/.vitepress/config.mts` |
| Modify | `scripts/llms/manifest.data.mjs` |
| Modify | `llms.txt` (regenerated — do not hand-edit) |

---

## Expected Behaviour

The framework's `installTestDOM` models viewport size, element rects, and the scrollbar width offline, so **placement is fully unit-testable** — only pixel rendering and pointer gestures need eyes.

### §1 `positionFlexibleAnchored` — unit-testable (pure, no DOM)

Given `viewportExtent = 800`, `viewportMargin = 4`:

| Case | Input (`nearEdge`, `farEdge`, `extent`) | Expected |
| --- | --- | --- |
| Fits below | `(90, 100, 200)` | `{ start: 100, available: 696 }` |
| Overflows below, above roomier → **flips**, fits | `(700, 760, 300)` | `{ start: 400, available: 696 }` (bottom meets `nearEdge`) |
| Overflows **both** sides, above roomier → flips **and** clamps | `(700, 760, 900)` | `{ start: 4, available: 696 }` — the failing status-bar case: top pins at the margin, bottom meets the trigger's top, content scrolls |
| Tie (`roomFar >= roomNear`) with overflow → stays below | `(400, 400, 1000)` | `{ start: 400, available: 396 }` |
| Anchor at the viewport top (`roomNear` negative) | `(0, 30, 200)` | `{ start: 30, available: 766 }` — never flips off-screen |
| Same near/far edge (submenu case) | `(500, 500, 100)` | `{ start: 500, available: 296 }` |

Invariant to assert: in the flip branch `start >= viewportMargin` always, because `start = nearEdge - min(extent, nearEdge - viewportMargin)`.

### §2 `Menu.toggleFor` rect-anchored — unit-testable (`installTestDOM`)

With `viewport: { width: 1280, height: 800 }` and a `Rect` for a 24px-tall trigger flush at the bottom (`top: 772, bottom: 796, left: 100`):

- **A short menu flips above the trigger:** `menu.getY() + menu.getHeight() === 772` (its bottom meets `rect.top`) and `menu.getY() < 772`. Today it lands over the trigger — this is the bug's regression test.
- **A long menu (60 items) flips, clamps, and scrolls:** `menu.getY() === 4`, `menu.getMaxSize()!.height === 772 - 4 = 768`, `menu.getHeight() <= 768`. Its bottom never crosses `rect.top`.
- **A trigger with room below opens below it:** for `rect.top: 100, bottom: 124`, `menu.getY() === 124`.
- **The scrollbar gutter tracks the flipped side:** the 60-item bottom-anchored menu reserves `getInsets().getRight() === DOM.source.getScrollBarWidth()` — `available` came from the room *above*, so the overflow (and therefore the gutter) is detected correctly.
- **Horizontal clamp:** for `rect.left: 1270`, `menu.getX() === 1280 - menu.getWidth() - 4`; the flipped `y` is unaffected by the cross-axis clamp.
- **Toggle identity unchanged:** a second `toggleFor` with the same `openerEl` hides; a different `openerEl` re-shows for it.

**Empty-list suppression** (`toggleFor(el, rect, [])`) — the contract the consuming app's providers depend on:

- **Opens nothing:** `LayerManager.getTopLayer()` is not the menu, and the menu's element is not mounted. Contrast `show(0, 0, [])`, which still mounts (asserted, to pin the deliberate asymmetry).
- **Fires `onClose` exactly once**, so an optimistic affordance is reverted (`toggleFor(el, rect, [], spy)` → `spy` called once).
- **Records no opener:** after a suppressed empty open, `toggleFor(el, rect, [{ text: 'A' }])` **opens** (it must not read as a stale toggle-shut). This is the `_currentOpener` desync guard.
- **The toggle-shut still wins over the empty check:** `toggleFor(el, rect, [{ text: 'A' }])` to open, then `toggleFor(el, rect, [])` → the menu **closes** (and does not stay stranded open). This is the ordering regression test; it fails if the empty check is hoisted above the `_currentOpener` branch.
- **`SplitButton` with no `menuItems`:** clicking the chevron opens no panel and the chevron does not stay spun up (its `onClose` fired). Today it opens an empty ~8px panel.

### §3 `Menu.show(x, y, …)` — unit-testable regression, must not change

- `show(100, 100, items)` with 60 items still yields `getY() === 4` and a capped height (the existing test at `tests/overlay/Menu.test.ts:201` must pass untouched).
- A short menu at `show(100, 100, …)` still places its **top** at `y = 100` — never flipped above the cursor.
- The gutter tests (`tests/overlay/Menu.test.ts:496-580`) pass unchanged.

### §4 `MenuButton` — partly unit-testable

Unit-testable:
- **Construction forms** (pins the overload order the consuming app's call sites need — a typecheck-level assertion, so `npm run typecheck:test` covering the test file is the real guard): `MenuButton({ glyph: 'xmark', menuItems: [{ text: 'A' }] })` compiles and yields a `MenuButton`; `new MenuButton('Export', { menuItems: [] })` compiles. Assert `getMenuItems()` on the options-only form to prove the bag was not swallowed as `text`.
- `new MenuButton({ menuItems: [{ text: 'A' }] })` — `getMenuItems()` returns the array; `setMenuItems(fn)` then `getMenuItems()` returns `fn`.
- **An empty provider opens nothing:** `new MenuButton({ menuItems: () => [] })`, attached and clicked → no menu is mounted, no throw. A subsequent click with a non-empty provider opens normally.
- `isScrollToBottomOnShow()` is `false` by default; `true` for `new NotificationHistoryButton()` (registry row) and for `new MenuButton({ scrollToBottomOnShow: true })`.
- Clicking an **unattached** button (no element) is a no-op — no menu is constructed, no throw.
- A provider is invoked **per open**, not once: toggle open, close, open again → provider called twice (assert with `vi.fn()`; drive via the button's `"action"` path or `click()`).
- `new NotificationHistoryButton()` still resolves `glyph === 'clock-rotate-left'` and, with an empty history, its provider returns the single disabled `"No notifications yet"` placeholder.
- A consumer `listeners: { action: fn }` on `new MenuButton(…)` fires (bag not dropped), and on `new NotificationHistoryButton(…)` fires **exactly once** (not double-wired).

Manual verification (needs a browser):
- The menu visually clears the button's border and is never under the pointer.
- The fade-in plays from the flipped position (no jump).
- `_scrollToBottomOnShow` still lands at the bottom of a flipped, clamped menu (`TestDOM` reports `scrollHeight === clientHeight`, so the offline test can only assert the path runs — see `tests/overlay/Menu.test.ts:545`). The flip does not affect it: it operates on the panel's own scroll after `flushLayout`, and a flipped menu that overflows is clamped to `roomNear`, so `getMaxScrollTop() > 0` exactly as in the unflipped case.

---

## Verification

1. `npm run typecheck` and `npm run typecheck:test` — clean.
2. `npm run lint` — clean (the `no-raw-dom` rule has an empty baseline; `MenuButton` must reach the DOM only via `DOM.source.getViewportRect`).
3. `npm test` — all green, including the new §1–§4 tests and the untouched §3 regressions.
4. `grep -rn 'toggleFor(' src/ tests/ docs/` — every site passes a `Rect`; no two-number call survives.
5. `grep -rn 'getViewportRect' src/typescript/lib/overlay/NotificationHistoryButton.ts` — zero matches (the boilerplate moved to `MenuButton`).
6. `npm run docs:build` — must finish with **zero** TypeDoc warnings (see CODE_CONVENTIONS: public JSDoc may only `{@link}` documented symbols; `resolvePlacement` / `showAnchored` / `MenuAnchor` are internal — describe them in prose, never link them).
7. **Manual smoke** (`npm run dev`, the demo's *Misc* panel): `MiscPanel.ts:1052` adds a `NotificationHistoryButton` to `leftColumn`. Temporarily move that line into a bottom-of-viewport container (or scroll it to the bottom edge / shrink the window until the button is within ~40px of the bottom), press *"Notification — show all types"* several times to build a long history, then open the button. The menu must sit **above** the button with its bottom flush at the button's top edge, must not cover the button, and must scroll to its newest (bottom) entry. Also verify: a `SplitButton` chevron dropdown (same panel) still opens below its button and toggles shut on a second chevron press; the demo's right-click context menus (`MiscPanel.ts:631`, `:658`) still open with their **top-left at the cursor** and clamp — not flip — at the viewport edges.

---

## Documentation Impact

- **Export surface:** `MenuButton` + `MenuButtonOptions` from `src/typescript/lib/component/button/index.ts` (import subpath `@jimka/typescript-ui/component/button`). `NotificationHistoryButton` keeps its `~/overlay/` export path unchanged.
- **New page `docs/components/MenuButton.md`** — model it on `docs/components/SplitButton.md`: an intro linking `[`MenuButton`](/api/component/button/classes/MenuButton)` and `[`Button`](/components/Button)`, a `## Usage` block (`import { MenuButton } from '@jimka/typescript-ui/component/button';`) using the **options-only** form `MenuButton({ glyph: 'file-export', menuItems: [ … ] })`, a `## Menu items` section covering the array-vs-provider union and `setMenuItems` / `getMenuItems` — and stating that **a provider returning `[]` opens nothing**, so a button with nothing to offer is simply inert (return a single `{ enabled: false }` row instead when the emptiness is worth explaining, as `NotificationHistoryButton` does) — a note that the menu opens under the button's bottom-left corner and **flips above it when the room below is short**, and a `## See also` listing `[API: MenuButton]`, `[`Menu`](/components/Menu)`, `[`SplitButton`](/components/SplitButton)`, `[`NotificationHistoryButton`](/components/NotificationHistoryButton)`.
- **`docs/.vitepress/config.mts`** — add `{ text: 'MenuButton', link: '/components/MenuButton' },` to the **Buttons** group (line ~80), after `SplitButton`.
- **`docs/components/index.md`** — add a row to the **Buttons** table after `SplitButton`: `| [`MenuButton`](/api/component/button/classes/MenuButton) | Button whose click opens a dropdown menu, flipping above when the room below is short |`.
- **`docs/components/Menu.md`** — the `toggleFor` paragraph (line 31) and its snippet (line 34) must change to `toggleFor(openerEl, anchorRect, items, onClose?)`, e.g. `menu.toggleFor(trigger.getElement(true), DOM.source.getViewportRect(trigger), items)`; state that the anchored form **flips above the trigger** when the room below is short, that an **empty `items` opens nothing** (and still fires `onClose`) whereas `show()` mounts whatever it is given, and add a pointer to `[`MenuButton`](/components/MenuButton)` as the ready-made wrapper. In `## Notes`, the placement bullet currently reads *"Rebuild-mode menus grow downward from the cursor"* — split it: pointer `show()` grows downward from the cursor and clamps (never flips), while `toggleFor()` and persistent-mode menus grow downward from the anchor and flip upward when there is more room above.
- **`docs/components/NotificationHistoryButton.md`** — update any "extends `Button`" framing to `[`MenuButton`](/components/MenuButton)`, and mention the menu flips above the button in a bottom `StatusBar`.
- **`scripts/llms/manifest.data.mjs`** — add `{ task: "Button whose click opens a dropdown menu", symbol: "MenuButton" },` to the **Inputs / Forms** group, immediately after the `SplitButton` row (line 56). The subpath, summary, and doc link are derived by the generator from the TypeDoc model — do not hand-edit `llms.txt`; run `npm run docs:build` (which chains `docs:api` → `docs:llms`) and commit the regenerated `llms.txt`.
- **Cross-reference link forms** (as used in this repo): API links `[`X`](/api/<subpath>/classes/X)`; doc-page links `[`X`](/components/X)`. Inside source JSDoc, use the same absolute `/api/...` markdown links the existing classes use — not `{@link}` — when pointing at another component.

---

## Potential Challenges

- **Argument order when delegating `placeVertically`.** It takes `(growTop, anchorTop, …)`; `positionFlexibleAnchored` takes `(nearEdge, farEdge, …)` = `(anchorTop, growTop, …)`. Swapping them silently inverts the flip. Mitigation: the three existing `Menu.placeVertically` tests (`tests/overlay/Menu.test.ts:222-265`) pin every branch — they must pass unchanged.
- **Discarding `clampIntoViewport`'s `y` in the rect branch.** Using it would re-break the bug. Mitigation: the §2 "long menu flips, clamps, and scrolls" test fails loudly if it is used, and the code carries the comment from *Internal Structure*.
- **Double-wired `listeners` bag.** If `MenuButton` calls `applyListeners` unguarded while `NotificationHistoryButton` also calls it, a consumer's `action` listener fires twice. Mitigation: the instance-identity guard (`Object.getPrototypeOf(this) === MenuButton.prototype`, mirroring `Button.ts:531`) plus the §4 "fires exactly once" test.
- **Defaults-bag getters.** `menuItems` / `scrollToBottomOnShow` are seeded into `_defaultOptions` by `NotificationHistoryButton` and never dispatched into `_options`, so a non-folding `?? null` getter would silently drop them. Mitigation: the folding getters above and the two mandated rows in `tests/component/default-options-fallback.test.ts`.
- **`MenuButton` generic + `callable()` overload order.** `callable()`'s *call* signature is `ConstructorParameters<T>` = the **last** overload, so the options-only overload must come last or `MenuButton({ … })` stops typechecking and every consumer call site breaks. Mitigation: the order is pinned in *Public API*, in a code comment, and by the construction-form test in *Expected Behaviour* §4. Use `ToolBar`'s generic callable-alias idiom for the `type` alias.
- **The empty check hoisted above the toggle-shut branch.** A tempting "guard clause first" tidy-up in `toggleFor` strands an open menu that can no longer be closed. Mitigation: the ordering regression test in *Expected Behaviour* §2 ("the toggle-shut still wins over the empty check") and the comment on the branch itself.

---

## Critical Files

- [`src/typescript/lib/overlay/Menu.ts`](src/typescript/lib/overlay/Menu.ts) — `show` (188), `toggleFor` (322), `open` (420), `applyViewportHeightClamp` (754), `placeVertically` (776), `VIEWPORT_MARGIN` (30).
- [`src/typescript/lib/core/OverlayPosition.ts`](src/typescript/lib/core/OverlayPosition.ts) — `flipAxis` (44), `clampAxis` (82), `positionAnchored` (102), `clampIntoViewport` (136).
- [`src/typescript/lib/component/button/Button.ts`](src/typescript/lib/component/button/Button.ts) — constructor + `subclassDefaults` (430-531), the `applyListeners` instance-identity guard (531).
- [`src/typescript/lib/component/button/SplitButton.ts`](src/typescript/lib/component/button/SplitButton.ts) — the closest sibling: `menuItems` option/setter/`applyOptions` (42, 151-189), lazy `_menu`, `_toggleMenu` (213-238).
- [`src/typescript/lib/overlay/NotificationHistoryButton.ts`](src/typescript/lib/overlay/NotificationHistoryButton.ts) — the component being collapsed; the `callable()` + `_Name`/`Name` dual export idiom.
- [`tests/overlay/Menu.test.ts`](tests/overlay/Menu.test.ts) — `installTestDOM` config, the `placeVertically` and gutter suites the change must keep green.
- [`tests/overlay/OverlayPosition.test.ts`](tests/overlay/OverlayPosition.test.ts) — the pure-primitive test idiom to follow.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — `callable()` export, typed setters, options-bag-as-cache, `listeners` bag ownership.
- [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) — `declare` cascade trap, defaults-bag getter fold, the `{@link}` docs-build constraint.

---

## Non-Goals

- **Migrating the consuming app (sqladmin, `/home/jika/typescript/sqladmin`).** Its four button-triggered menus that pass `event.clientX/clientY` — `frontend/src/dock/exportButton.ts:34`, `frontend/src/dock/StructurePanel.ts:231`, `frontend/src/dock/StructurePanel.ts:301`, `frontend/src/dock/QueryPanel.ts:274` — should move to `MenuButton`, but that is a **separate plan in a separate repo** (`sqladmin/plans/menubutton-adoption.md`, already written against the API above and gated on this plan shipping plus a library `npm run build:lib`). Do not open it. (Its tree context menus in `NavigatorTree` / `RolesTree` / `QueriesView` are genuine right-click menus and correctly stay on `show()`.)

  Two findings from that plan's investigation, recorded here because they shaped the API: (a) only **one** of the four app sites can actually observe the flip — `StructurePanel`'s Constraints accordion-header tool, which lives in a scrolling `autoScroll` VBox and can reach the viewport bottom; the other three sit in `Placement.NORTH` toolbars pinned to the top, where the no-flip clamp never fired. (b) sqladmin's node-environment vitest cannot import any library UI *value* (`document is not defined`, thrown from `ProgressSpinner.ts:20` at import scope), so **this** repo's `installTestDOM` suites are the only place `MenuButton`/`Menu` placement is automatable — which is why *Expected Behaviour* §1–§4 carry the weight rather than deferring to the consumer.
- **Changing `positionAnchored`, `flipAxis`, or `AnimatedDropdown`.** They serve fixed-size overlays correctly; see *Architecture Decisions*.
- **Changing pointer-anchored `show(x, y, …)` semantics.** Right-click context menus stay cursor-anchored and clamp-not-flip.
- **Refactoring `SplitButton` or `ToolBar` onto `MenuButton`.** Only their `toggleFor` call sites move to the `Rect` signature.
- **Adding a `gap` between the trigger and its menu, or a `menuWidth` option on `MenuButton`.** No caller needs either; `Menu.setMenuWidth` remains available for anyone who does.
- **A public non-toggle anchored show (`showForRect`).** No consumer needs it.
