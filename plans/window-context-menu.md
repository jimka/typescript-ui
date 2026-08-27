---
depends-on: []
touches-shared:
  - packages/lib/src/typescript/lib/core/LayerManager.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/overlay/windowControls.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Window Context Menu — Implementation Plan

## Overview

Clicking the icon at the top-left of a window opens a system menu: minimize, maximize, always-on-top, lock, close. Both window kinds get it — [`Window`](packages/lib/src/typescript/lib/overlay/Window.ts) (title-bar header) and [`TabWindow`](packages/lib/src/typescript/lib/overlay/TabWindow.ts) (tab-strip chrome) — from one implementation on their shared base, [`AbstractWindow`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts). Each subclass only wires its own icon's click to the base's `openWindowMenu`, the same division of labour `reflectMaximizeState` and `reflectMinimizable` already use.

Three of the five actions already exist on the base: `toggleMinimize` ([`AbstractWindow.ts:1180`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1180)), `toggleMaximize` ([`AbstractWindow.ts:1318`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1318)), and `requestClose` ([`AbstractWindow.ts:820`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L820)). Two are new: **always on top**, which needs a new z-index band in [`LayerManager`](packages/lib/src/typescript/lib/core/LayerManager.ts) plus a way to move an already-registered layer into it, and **lock**, which freezes both window drags — drag-to-move and drag-to-resize — behind a new `locked` option.

The icon is decorative today: it sits inside `pointer-events: none` wrappers in both window kinds, so a press falls through to the drag-to-move gesture. Making it clickable means re-enabling pointer events on the icon alone, and vetoing it from the move and double-click-maximize gestures the way the trailing control buttons already are.

---

## Architecture Decisions

### The menu is a rebuild-mode `Menu` opened with `toggleFor`

`AbstractWindow` owns one lazily-created rebuild-mode [`Menu`](packages/lib/src/typescript/lib/overlay/Menu.ts) and opens it with [`toggleFor(openerEl, anchorRect, configs)`](packages/lib/src/typescript/lib/overlay/Menu.ts#L407), passing a freshly built config array on every open. This mirrors [`SplitButton._toggleMenu`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L235) exactly — a lazy `this._menu ??= new Menu()`, a rect from `DOM.source.getViewportRect(component)`, and the trigger element as the toggle identity.[^toggle-not-show]

Rebuilding per open is also what keeps the checkable rows honest: `checked` is re-read from the window at the moment the menu opens, so no listener or refresh hook is needed.[^live-state]

### Checkable rows are `CheckboxMenuRow` factories

"Always on top" and "Lock position" are `{ row: () => new CheckboxMenuRow({ text, checked }) }` configs, following [`Table.buildColumnMenuItems`](packages/lib/src/typescript/lib/component/table/Table.ts#L1765) and [`Split.openGutterMenu`](packages/lib/src/typescript/lib/layout/Split.ts#L1090). `Menu` applies the `"context-menu"` CSS-variable prefix to a factory-built row itself ([`Menu.ts:279`](packages/lib/src/typescript/lib/overlay/Menu.ts#L279)), so nothing here sets it. A `CheckboxMenuRow` leaves the menu open on toggle, so the user can flip both switches in one open.

### Capability flags follow the header buttons: minimize and maximize hide, close disables

`WindowHeader.setMinimizable` / `setMaximizable` call `setVisible` on their buttons, while `setCloseable` calls `setEnabled` ([`WindowHeader.ts:355-406`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L355)); `TabWindow`'s control tools do the same ([`TabWindow.ts:186-206`](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L186)). The menu rows copy that split — the Minimize and Maximize rows are omitted entirely, and the Close row renders with `enabled: false`.

| Window configuration | Rows, top to bottom |
| --- | --- |
| defaults, state `"normal"` | Minimize · Maximize · ─ · Always on top · Lock position · ─ · Close |
| `minimizable: false` | Maximize · ─ · Always on top · Lock position · ─ · Close |
| `resizable: false` — gates both `isMinimizable()` and `isMaximizable()`[^resizable-master] | Always on top · Lock position · ─ · Close |
| `closeable: false` | Minimize · Maximize · ─ · Always on top · Lock position · ─ · Close *(disabled)* |

The leading separator is pushed only when at least one row precedes it, so the `resizable: false` row list does not open with a stray rule — the guard [`Table.buildColumnMenuItems`](packages/lib/src/typescript/lib/component/table/Table.ts#L1781) already uses.

### The Minimize and Maximize labels read "Restore" in the matching state

Each label is derived from `getWindowState()` at build time, mirroring the glyph swap [`Window.reflectMaximizeState`](packages/lib/src/typescript/lib/overlay/Window.ts#L207) already performs on the header buttons. `"minimized"` and `"maximized"` are mutually exclusive, so at most one row ever reads "Restore".

| `getWindowState()` | Row 1 label | Row 2 label |
| --- | --- | --- |
| `"normal"` | Minimize | Maximize |
| `"minimized"` | **Restore** | Maximize |
| `"maximized"` | Minimize | **Restore** |

### Always on top is a new `LayerManager` band, moved into by a new `setBand`

`LayerManager.Band` gains `PinnedWindow: 9400`, between `Window` (9000) and `Popover` (9800).[^band-value] A new `LayerManager.setBand(layer, band)` moves an already-registered layer's node — and its descendant layers — into a different band and re-stamps them from the shared ascending counter. `AbstractWindow.getBand()` returns `Band.PinnedWindow` while `isAlwaysOnTop()` is true, so a window constructed pinned registers straight into the band, and `setAlwaysOnTop` calls `setBand` for a window that is already open.

Two pinned windows still stack against each other normally: `bringToFront` re-stamps from each node's own `band`, so a raise inside the pinned band works exactly as it does inside the window band.

### `register` links a new layer under the frontmost layer, not the last-registered one

[`register`](packages/lib/src/typescript/lib/core/LayerManager.ts#L211) currently treats the last entry in `_stack` as "the layer this one was opened from", and a nested layer inherits that layer's band. With one window band that always produced a correct result, because a later registration always drew a higher counter. A second root band breaks that match: a pinned window can sit visually in front of a window that registered after it, and a menu opened inside the pinned window would inherit the *other* window's band and paint behind its own opener. `register` therefore picks the registered layer with the highest current z-index instead.[^frontmost]

### Lock freezes both window drags and is not routed through `resizable`

`setLocked(true)` vetoes `startMoveFrom` and `onResize`, hides the eight resize strips, and disarms the snap-resize detector; `setLocked(false)` restores whatever `resizable` allows. It deliberately does **not** call `setResizable`, because `resizable` is the master switch for the minimize and maximize affordances ([`isMinimizable`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1381)) — routing lock through it would strip the header buttons and the menu's own Minimize and Maximize rows every time the user locked a window.[^lock-not-resizable]

Hiding the strips (rather than leaving them visible and vetoing the drag) is the precedent [`setResizable`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1426) sets: a hidden strip takes no cursor and no hit test, so a frozen edge shows the ordinary pointer instead of a resize cursor that silently does nothing.

| `resizable` | `locked` | Resize strips | Border resize | Drag-to-move |
| --- | --- | --- | --- | --- |
| `true` | `false` | shown | yes | yes |
| `true` | `true` | hidden | no | no |
| `false` | `false` | hidden | no | yes |
| `false` | `true` | hidden | no | no |

### The window icon becomes interactive; the surrounding chrome stays pass-through

Only the icon element itself opts back into pointer events. Its `pointer-events: none` ancestors (`WindowHeader._titleRow` and its `Fit` cell, `TabBar._leadGroup`) are untouched, so the rest of the title area keeps behaving as a drag handle. Both gesture paths that would otherwise also fire on an icon press are vetoed: `Window` adds the icon to the containment check its header `mousedown` and `dblclick` handlers already run, and `TabBar.isBarChromeTarget` adds the leading widget to the chrome set that suppresses the bar's move and double-click triggers.

`TabWindow`'s icon is already a `Button` — pointer-inert until now, so it starts reaching `.pressed` and `:hover` for the first time. [`WindowLeadGlyphButton`](packages/lib/src/typescript/lib/overlay/windowControls.ts#L95) therefore declares its own `ownStyleStates`.[^lead-glyph-states] `Window`'s icon is a plain `Glyph` inside the title row and stays one; it gets `cursor: pointer` so it still reads as clickable.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/LayerManager.ts

export namespace LayerManager {
    /** Gains one entry: `PinnedWindow`, between `Window` and `Popover`. */
    export const Band = {
        Window:       Z_BAND_WINDOW,        //  9000
        PinnedWindow: Z_BAND_PINNED_WINDOW, //  9400  — new
        Popover:      Z_BAND_POPOVER,       //  9800
        Dropdown:     Z_BAND_DROPDOWN,      // 10000
        Dialog:       Z_BAND_DIALOG,        // 11000
        Tooltip:      Z_BAND_TOOLTIP,       // 12000
    } as const;

    /**
     * Moves an already-registered top-level layer (and every layer opened from
     * it) into `band`, re-stamping each from the ascending counter so the moved
     * subtree lands on top of its new band. No-op for an unregistered layer or
     * one already in `band`.
     */
    export function setBand(layer: DismissableLayer, band: number): void;
}
```

```typescript
// packages/lib/src/typescript/lib/overlay/AbstractWindow.ts

export interface WindowOptions extends ContainerOptions {
    // …existing fields unchanged…

    /** Keeps the window above every unpinned window. Defaults to `false`. */
    alwaysOnTop?: boolean;
    /** Freezes the window: no drag-to-move and no drag-to-resize. Defaults to `false`. */
    locked?:      boolean;
}

export abstract class AbstractWindow extends Container<WindowOptions> implements DismissableLayer {
    setAlwaysOnTop(value: boolean): this;
    isAlwaysOnTop(): boolean;

    setLocked(value: boolean): this;
    isLocked(): boolean;

    /** Opens (or toggle-shuts) the window's system menu anchored under `opener`. */
    protected openWindowMenu(opener: Component): void;
}
```

```typescript
// packages/lib/src/typescript/lib/component/container/WindowHeader.ts

class WindowHeader extends Header {
    /** Fires when the title icon is clicked. A second call replaces the listener. */
    addTitleGlyphClickListener(listener: () => void): this;
}
```

State-bearing property routing (per ARCHITECTURE.md's three DOM-write rules):

| Property | Options field | Cache | Getter | Setter |
| --- | --- | --- | --- | --- |
| always on top | `WindowOptions.alwaysOnTop` | `this._options.alwaysOnTop` | `isAlwaysOnTop()` folds `this._defaultOptions.alwaysOnTop` | `setAlwaysOnTop(value)` |
| locked | `WindowOptions.locked` | `this._options.locked` | `isLocked()` folds `this._defaultOptions.locked` | `setLocked(value)` |

Both default to `false` in `_defaultWindowOptions` ([`AbstractWindow.ts:146`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L146)), alongside `closeable` / `minimizable` / `resizable`.

---

## Internal Structure

`LayerManager` — the band move reuses the existing re-stamp walk, which gains an optional band override:

```typescript
/** Re-stamps `node`'s subtree; `band`, when given, also moves every node into it. */
function restampSubtree(node: LayerNode, band?: number): void {
    const walk = (n: LayerNode): void => {
        if (band !== undefined) {
            n.band = band;
        }

        n.zIndex = n.band + (++_zCounter);
        n.layer.onZIndexChanged?.(n.zIndex);

        for (const child of n.children) {
            walk(child);
        }
    };

    walk(node);
}

/** The registered layer painting in front of every other — highest current stamp. */
function frontmostNode(): LayerNode | null {
    let front: LayerNode | null = null;

    for (const node of _stack) {
        if (front === null || node.zIndex > front.zIndex) {
            front = node;
        }
    }

    return front;
}
```

`register` then reads `const parent = layer.isLayerRoot?.() ? null : frontmostNode();` in place of its current `_stack[_stack.length - 1]` lookup. Nothing else in the module changes: `getTopLayer` and `topmostInputLayer` keep their stack-order meaning.

`AbstractWindow` — the effective resize gate and the single place the strips' visibility is written:

```typescript
/** True when a border drag may run: resizable and not frozen by the lock. */
private canResize(): boolean {
    return this.isResizable() && !this.isLocked();
}

/** Shows or hides the eight strips from the effective gate, and disarms a live snap session. */
private applyResizeBorderVisibility(): void {
    const enabled = this.canResize();

    // `null` (inherit), not `true`, on the restore branch — see setResizable's
    // own note: an explicit `true` would override the window's hidden state
    // while it is still being constructed.
    for (const border of Object.values(this._borderComponents)) {
        border.setVisible(enabled ? null : false);
    }

    if (!enabled) {
        this.clearSnapState();
    }
}
```

`AbstractWindow` — menu assembly:

```typescript
private buildWindowMenuItems(): MenuItemConfig[] {
    const items: MenuItemConfig[] = [];
    const state = this.getWindowState();

    if (this.isMinimizable()) {
        items.push({
            text:   state === "minimized" ? "Restore" : "Minimize",
            action: this._boundToggleMinimize,
        });
    }

    if (this.isMaximizable()) {
        items.push({
            text:   state === "maximized" ? "Restore" : "Maximize",
            action: this._boundToggleMaximize,
        });
    }

    if (items.length > 0) {
        items.push({ separator: true });
    }

    items.push(
        {
            row: () => {
                const row = new CheckboxMenuRow({ text: "Always on top", checked: this.isAlwaysOnTop() });

                row.on("action", () => { this.setAlwaysOnTop(row.isChecked()); });

                return row;
            },
        },
        {
            row: () => {
                const row = new CheckboxMenuRow({ text: "Lock position", checked: this.isLocked() });

                row.on("action", () => { this.setLocked(row.isChecked()); });

                return row;
            },
        },
        { separator: true },
        { text: "Close", enabled: this.isCloseable(), action: this._boundRequestClose },
    );

    return items;
}
```

---

## Ordered Implementation Steps

Each numbered step is one edit plus its check. Test steps come immediately **before** the code step they cover, so each pair is a red-green cycle: the test step's check is expected to fail, the code step's check to pass. A test naming a symbol that does not exist yet fails at `npm run typecheck:test` — that is the red phase, not a mistake.

1. **`packages/lib/tests/overlay/LayerManager.test.ts`** — extend the existing suite, reusing its `fakeLayer` / `register` helpers and the draining `afterEach`:
   - `setBand` moves a registered root's stamp into the new band and calls `onZIndexChanged` with the new value.
   - `setBand` on an unregistered layer, and on a layer already in that band, does nothing (no `onZIndexChanged` call).
   - `setBand` moves a child layer registered under that root into the same new band.
   - A layer registered while a higher-banded root is open inherits *that* root's band, not the last-registered root's.
   - Check: `npm run typecheck:test` fails — `LayerManager.setBand` and `Band.PinnedWindow` do not exist yet.

2. **`packages/lib/src/typescript/lib/core/LayerManager.ts`** — add the band and the move primitive.
   - Add `const Z_BAND_PINNED_WINDOW: number = 9400;` beside the other band constants, with a comment saying it holds always-on-top windows above ordinary ones and below `Popover`, and that inserting it halves the counter headroom the `Window` band had.
   - Add `PinnedWindow: Z_BAND_PINNED_WINDOW,` to the exported `Band` object, between `Window` and `Popover`. Update the `Band` JSDoc, which currently says "four z-index bands".
   - Add the optional `band` parameter to `restampSubtree` exactly as in `## Internal Structure`.
   - Add the exported `setBand(layer, band)`: look the node up in `_nodeByLayer`, return when absent or when `node.band === band`, else call `restampSubtree(node, band)`.
   - Add the private `frontmostNode()` helper and use it for `parent` inside `register`.
   - Update `bandFor`'s and `DismissableLayer.getBand`'s JSDoc where they say a nested layer inherits the band of "the current topmost layer" — it is now the frontmost one.
   - Check: `npm run typecheck` clean, `npx vitest run tests/overlay/LayerManager.test.ts` green.

3. **`packages/lib/tests/overlay/AbstractWindow.alwaysOnTop.test.ts`** — new file, modelled on `AbstractWindow.resizable.test.ts` (same `CONFIG`, same `installTestDOM`). Covers `## Expected Behaviour` cases 14–18.
   - Check: `npm run typecheck:test` fails — `isAlwaysOnTop` does not exist yet.

4. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the `alwaysOnTop` option.
   - Add `alwaysOnTop?: boolean;` to `WindowOptions` with JSDoc, and `alwaysOnTop: false` to `_defaultWindowOptions`.
   - In `applyOptions`, write the caller value pure: `if (options.alwaysOnTop !== undefined) this._options.alwaysOnTop = options.alwaysOnTop;` — beside the existing `resizable` line.
   - Add `isAlwaysOnTop()` (folding getter) and `setAlwaysOnTop(value)` which writes `this._options.alwaysOnTop` then calls `LayerManager.setBand(this, this.getBand())`.
   - Change `getBand()` to `return this.isAlwaysOnTop() ? LayerManager.Band.PinnedWindow : LayerManager.Band.Window;` and update its JSDoc.
   - Check: `npm run typecheck` clean, `npx vitest run tests/overlay/AbstractWindow.alwaysOnTop.test.ts` green.

5. **`packages/lib/tests/overlay/AbstractWindow.locked.test.ts`** — new file, same template, plus the white-box `borders()` probe copied from `AbstractWindow.resizable.test.ts`. Covers cases 20–24.
   - Check: `npm run typecheck:test` fails — `isLocked` does not exist yet.

6. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the `locked` option and its vetoes.
   - Add `locked?: boolean;` to `WindowOptions` with JSDoc, and `locked: false` to `_defaultWindowOptions`.
   - In `applyOptions`, write the caller value pure beside `resizable`.
   - Add the private `canResize()` and `applyResizeBorderVisibility()` from `## Internal Structure`.
   - Replace the strip loop and the `if (!value) this.clearSnapState();` block inside `setResizable` with a single `this.applyResizeBorderVisibility()` call. Leave its two `reflect*` calls alone.
   - Add `isLocked()` (folding getter) and `setLocked(value)`: write `this._options.locked`, then call `this.applyResizeBorderVisibility()`. It must **not** touch `reflectMinimizable` / `reflectMaximizable`.
   - In `initChrome`, add `this.setLocked(this.isLocked());` directly after the existing `this.setResizable(this.isResizable());` line.
   - Add `if (this.isLocked()) { return; }` to `startMoveFrom`, after the existing `getWindowState() !== "normal"` guard.
   - Change `onResize`'s opening guard from `if (!this.isResizable())` to `if (!this.canResize())`.
   - Change `onSnapKeyDown`'s opening guard from `if (!this.isResizable())` to `if (!this.canResize())`.
   - Check: `npm run typecheck` clean, `npx vitest run tests/overlay/AbstractWindow.locked.test.ts` green, and `grep -n "isResizable()" packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` shows no hit inside `onResize` or `onSnapKeyDown` — the surviving call sites are `initChrome`, `isMinimizable`, `isMaximizable`, `canResize`, and the `isResizable` definition itself.

7. **`packages/lib/tests/overlay/AbstractWindow.windowMenu.test.ts`** — new file covering cases 1–8 and 10–11. Capture the built configs by stubbing the private `_windowMenu`'s `toggleFor` through a typed probe, mirroring [`Split.gutterMenu.test.ts`](packages/lib/tests/component/layout/Split.gutterMenu.test.ts)'s `SplitProbe` pattern. Assert the `Window` and `TabWindow` glyph-click entry points too — those two stay red until steps 13 and 16.
   - Check: `npm run typecheck:test` fails — `openWindowMenu` does not exist yet.

8. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the menu.
   - Import `Menu`, `MenuItemConfig` (from `~/component/container/MenuItem.js`) and `CheckboxMenuRow`.
   - Add `private _windowMenu: Menu | null = null;` and the three bound action fields (`_boundToggleMinimize`, `_boundToggleMaximize`, `_boundRequestClose`), following the existing `_boundOnBringToFront` idiom.
   - Add `private buildWindowMenuItems(): MenuItemConfig[]` from `## Internal Structure`.
   - Add `protected openWindowMenu(opener: Component): void`: read `opener.getElement()`, return when absent, then `this._windowMenu ??= new Menu();` and `this._windowMenu.toggleFor(openerEl, DOM.source.getViewportRect(opener), this.buildWindowMenuItems());`.
   - In `destructor()`, before `super.destructor()`, add `this._windowMenu?.dispose(); this._windowMenu = null;` with a comment matching [`Table.destructor`](packages/lib/src/typescript/lib/component/table/Table.ts#L1648)'s: the menu is a `LayerManager`-mounted panel, never a registered child, so the base's child recursion cannot reach it.
   - Check: `npm run typecheck` clean; `npx vitest run tests/overlay/AbstractWindow.windowMenu.test.ts` green except the two glyph-click cases.

9. **`packages/lib/tests/component/button/WindowControlButton.classStyleHoisting.test.ts`** — add one row asserting `.WindowLeadGlyphButton.pressed` and `.WindowLeadGlyphButton:hover` carry the window-control active and hover background tokens, mirroring the file's existing `WindowControlButton` state rows.
   - Check: the new row fails — those two rules do not exist yet.

10. **`packages/lib/src/typescript/lib/overlay/windowControls.ts`** — make the leading glyph a real button.
    - Add the hover/pressed keys to `_defaultWindowLeadGlyphOptions`, mirroring `_defaultWindowControlOptions` but with `pressedShadow: "none"` and `hoverShadow: "none"` (this button's resting shadow is `none`): `pressedForegroundColor: "var(--ts-ui-text-color, black)"`, `pressedBackgroundColor` / `pressedBackgroundImage: "var(--ts-ui-window-control-active-bg)"`, `hoverBackgroundColor` / `hoverBackgroundImage: "var(--ts-ui-window-control-hover-bg)"`.
    - Give `WindowLeadGlyphButton` an `ownStyleStates` array with the same two entries `WindowControlButton` declares, reading the new keys.
    - Delete `button.setPointerEvents("none");` from `createWindowLeadGlyphButton` (the local `button` variable then has one use — return `new WindowLeadGlyphButton(glyph)` directly).
    - Update the `WindowLeadGlyphButton` class JSDoc and the `createWindowLeadGlyphButton` JSDoc: it is the window's system-menu trigger, not a decorative pass-through.
    - Check: `npx vitest run tests/component/button/WindowControlButton.classStyleHoisting.test.ts` green, including the file's existing row 4 — its resting assertions read the `:not(.pressed):not(:hover)` selector, which is unchanged because both state selectors were already resolved from `Button`'s own list.

11. **`packages/lib/tests/component/container/TabBar.leadingWidgetChrome.test.ts`** — new file. Build a `TabBar`, `setLeadingWidget(button)`, `installMoveTrigger(spy)`, render, then dispatch a `mousedown` on the widget's element and assert the spy did not fire; dispatch one on the bar's own element and assert it did (case 27).
    - Check: the first assertion fails — the leading widget is not yet chrome.

12. **`packages/lib/src/typescript/lib/component/container/TabBar.ts`** — veto the leading widget from the bar gestures.
    - In `isBarChromeTarget`, after the tool-group check, add a containment test against `this._leadWidget?.getElement()`.
    - Update that method's JSDoc and the `@remarks` on `setLeadingWidget` ([`TabBar.ts:1264-1269`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1264)), which currently state the leading widget is deliberately outside the `isBarChromeTarget` chrome set. The hosting group stays pointer-transparent; a widget that opts back into pointer events now handles its own presses and is vetoed from the move and double-click triggers.
    - Check: `npx vitest run tests/component/container/TabBar.leadingWidgetChrome.test.ts` green.

13. **`packages/lib/src/typescript/lib/overlay/TabWindow.ts`** — wire the leading glyph.
    - Add `private readonly _boundOnLeadGlyphAction: () => void = () => this.onLeadGlyphAction();` and `private onLeadGlyphAction(): void { this.openWindowMenu(this._leadGlyphBtn); }`.[^named-listener]
    - After `this._leadGlyphBtn = createWindowLeadGlyphButton(...)`, add `this._leadGlyphBtn.on("action", this._boundOnLeadGlyphAction);`.
    - Check: the `TabWindow` glyph-click case in `AbstractWindow.windowMenu.test.ts` goes green.

14. **`packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts`** — add case 26 alongside the existing trailing-button cases: a `mousedown` whose target is the title icon does not call `onMouseDown`, and a `dblclick` on the same target leaves `getWindowState()` unchanged.
    - Check: the two new cases fail — the icon is not yet vetoed.

15. **`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`** — make the title icon clickable.
    - Import `DOM` (the file currently imports only the `Handle` type from it).
    - In `setGlyph`, replace `glyph.setPointerEvents("none")` with `glyph.setPointerEvents("auto")` and add `glyph.setCursor("pointer")`; update the surrounding comment, which calls the glyph decorative and pointer-through.
    - Add `private _titleGlyphClickListener: (() => void) | null = null;`, a bound `_boundOnHeaderClick` field, and a private `onHeaderClick(e)` that interns `e.target`, returns unless it is inside `this._titleGlyph?.getElement()`, and otherwise invokes `this._titleGlyphClickListener`.
    - Add `addTitleGlyphClickListener(listener)`: register `Event.addSubtreeListener(this, "click", this._boundOnHeaderClick)` **only when `_titleGlyphClickListener` is still `null`**, then store the listener. Registering unconditionally would stack a duplicate subtree listener on a second call.
    - Check: `npm run typecheck`.

16. **`packages/lib/src/typescript/lib/overlay/Window.ts`** — wire the header icon and veto it from the header gestures.
    - Rename the private `targetIsInTrailingButton` to `targetIsInHeaderControl` (two call sites: `onHeaderMouseDown`, `onHeaderDoubleClick`) and push `this._header.getGlyph()?.getElement()` into the handle array it scans. Update its JSDoc and the two call-site comments that name trailing buttons.
    - Update the header comment of `packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts`, which names the old method.
    - Add `private readonly _boundOnTitleGlyphClick: () => void = () => this.onTitleGlyphClick();` and `private onTitleGlyphClick(): void`, which reads `this._header.getGlyph()` and calls `this.openWindowMenu(glyph)` when it is non-null.
    - In the constructor, beside the existing `addMaximizeButtonListener` / `addHeaderDoubleClickListener` calls, add `this._header.addTitleGlyphClickListener(this._boundOnTitleGlyphClick);`.
    - Check: `grep -rn "targetIsInTrailingButton" packages/lib` returns nothing, and `npx vitest run tests/overlay/AbstractWindow.windowMenu.test.ts tests/overlay/Window.headerMoveTrigger.test.ts` is fully green.

17. **Docs** — see `## Documentation Impact`.
    - Check: `npm run docs:api` finishes with zero warnings.

18. **Full pass** — `npm run typecheck && npm run lint && npm test`.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Window.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/TabWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/windowControls.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.windowMenu.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.locked.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.alwaysOnTop.test.ts` |
| Create | `packages/lib/tests/component/container/TabBar.leadingWidgetChrome.test.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Modify | `packages/lib/tests/overlay/Window.headerMoveTrigger.test.ts` |
| Modify | `packages/lib/tests/component/button/WindowControlButton.classStyleHoisting.test.ts` |
| Modify | `packages/lib/docs/components/AbstractWindow.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/TabWindow.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Each case is marked *unit* (offline, under the recording sink and modelled read source) or *manual* (needs a real browser — pointer hit-testing, cursors, painted z-order).

**Menu contents**

1. *unit* — A default `Window` builds seven configs in order: Minimize, Maximize, separator, "Always on top" row factory, "Lock position" row factory, separator, Close.
2. *unit* — `minimizable: false` drops the Minimize config; `maximizable: false` drops the Maximize config. The remaining list still starts with a real row, never a separator.
3. *unit* — `resizable: false` drops both (because `isMinimizable()` and `isMaximizable()` are gated on it) and the list starts with the "Always on top" row.
4. *unit* — `closeable: false` keeps the Close config and sets `enabled: false` on it. `locked: true` changes the list not at all — Minimize, Maximize and Close are all still listed and enabled.
5. *unit* — Labels follow the state table above: `"minimized"` → row 1 reads "Restore"; `"maximized"` → row 2 reads "Restore"; `"normal"` → neither does.
6. *unit* — The "Always on top" and "Lock position" rows are built with `checked` equal to `isAlwaysOnTop()` / `isLocked()` at open time: toggling the window's state and re-opening yields the opposite `checked` value.

**Menu actions**

7. *unit* — Invoking the Minimize config's `action` calls `toggleMinimize()`; Maximize's calls `toggleMaximize()`; Close's calls `requestClose()`.
8. *unit* — Firing the "Always on top" row's `action` after checking it calls `setAlwaysOnTop(true)`; unchecking calls `setAlwaysOnTop(false)`. Same for "Lock position" and `setLocked`.
9. *manual* — Toggling either checkable row leaves the menu open; activating Minimize, Maximize, or Close closes it.

**Menu opening**

10. *unit* — `openWindowMenu` on an unrendered opener returns without creating a `Menu`.
11. *unit* — A `Window` whose icon was removed with `win.getHeader().clearGlyph()` opens nothing on a header click (there is no opener element).
12. *manual* — Clicking the title icon opens the menu under it; clicking the same icon again closes it; clicking elsewhere dismisses it. Both window kinds.
13. *manual* — A menu opened inside an always-on-top window paints above that window, with a second, unpinned window also open.

**Always on top**

14. *unit* — `isAlwaysOnTop()` defaults to `false`; the `alwaysOnTop` option reaches both `Window` and `TabWindow`.
15. *unit* — `getBand()` returns `Band.Window` by default and `Band.PinnedWindow` when always-on-top.
16. *unit* — For a shown window, `setAlwaysOnTop(true)` raises `LayerManager.getZIndex(win)` above the pinned band base; `setAlwaysOnTop(false)` returns it below it.
17. *unit* — With window A pinned and window B unpinned and both shown, `B.bringToFront()` leaves `getZIndex(A) > getZIndex(B)`.
18. *unit* — Two pinned windows still reorder against each other: after `A.bringToFront()` then `B.bringToFront()`, `getZIndex(B) > getZIndex(A)`, and both stay above an unpinned peer.
19. *manual* — A pinned window visually stays over an unpinned one that is clicked and dragged over it.

**Lock**

20. *unit* — `isLocked()` defaults to `false`; the `locked` option reaches both `Window` and `TabWindow`.
21. *unit* — `setLocked(true)` hides all eight border strips (`isVisible()` is `false`); `setLocked(false)` restores them to `null` (inherit) — but only when `isResizable()`; a `resizable: false` window's strips stay `false` through both calls.
22. *unit* — `onResize(border, event)` on a locked window makes no geometry change (`getWidth()` / `getX()` unchanged), the same assertion `AbstractWindow.resizable.test.ts` makes for a non-resizable window.
23. *unit* — `startMoveFrom(event)` on a locked window registers no viewport `mousemove` / `mouseup` listeners and leaves `getX()` / `getY()` unchanged.
24. *unit* — Locking does **not** change `isMinimizable()` / `isMaximizable()` / `isCloseable()`. (The menu's own copy of this rule is case 4.)
25. *manual* — A locked window cannot be dragged by its title bar or tab strip, shows no resize cursor on its edges, and both gestures return after unlocking.

**Icon does not double-fire the chrome gestures**

26. *unit* — `Window.onHeaderMouseDown` with a target inside the title icon does not call `onMouseDown`, and `Window.onHeaderDoubleClick` with the same target does not change `getWindowState()`. A target on the header itself still does both.
27. *unit* — A `mousedown` on a `TabBar`'s leading widget does not invoke the `installMoveTrigger` callback; one on the bar's blank area still does.
28. *manual* — Double-clicking the title icon does not maximize the window; double-clicking the title bar beside it still does.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean, with no new baseline entries (this change adds no raw DOM access and no new `setElement*` call sites).
- `npm test` — the whole suite, including the four new and three extended test files.
- `grep -rn "targetIsInTrailingButton" packages/lib` — zero matches after step 16.
- `npm run docs:api` — zero warnings (CODE_CONVENTIONS.md requires this after any public JSDoc change).
- Manual pass, in `npm run dev` at `http://localhost:8015`:
  - *Misc* panel → **"Show window with title glyph"** → click the arrow icon at the top-left. Walk cases 12, 19, 25, 28.
  - *Tab* demo panel ([`packages/lib/src/typescript/TabDemoPanel.ts`](packages/lib/src/typescript/TabDemoPanel.ts)) → drag a tab off the **first** strip (it keeps the default `detachWindowMode: "strip"`, so the tear-off is a `TabWindow`) → click the leading glyph in the new window's bar. Walk cases 12, 25, 28 again, and confirm the glyph now has a hover fill matching the trailing controls.
  - Open two windows, pin one from its menu, raise the other, and confirm the pinned one stays in front (case 19); then open a table's column context menu inside the pinned window and confirm it paints above the window (case 13).

---

## Documentation Impact

- **[`packages/lib/docs/components/Window.md`](packages/lib/docs/components/Window.md)** — add `alwaysOnTop` and `locked` rows to the options table (after `resizable`), and a short "Title-icon menu" section listing the five entries and the hide/disable gating.
- **[`packages/lib/docs/components/TabWindow.md`](packages/lib/docs/components/TabWindow.md)** — the same two option rows, and a sentence in the bar-anatomy list noting the leading glyph now opens the window menu.
- **[`packages/lib/docs/components/AbstractWindow.md`](packages/lib/docs/components/AbstractWindow.md)** — add a **Window menu** row to the "What the base owns" table (the base builds the item list and opens the panel; each subclass wires its own icon), and extend the **Z-order** row to name the pinned band. Note in the resize-borders row that `locked` also hides the strips, and that unlike `resizable` it leaves minimize and maximize alone.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — one entry under `## Added` → `### Components` covering the window menu, `alwaysOnTop`, and `locked`; one under `## Changed` → `### Core` for the new `LayerManager.Band.PinnedWindow` and `LayerManager.setBand`, and for `register` now linking a nested layer under the frontmost layer rather than the last-registered one.
- `llms.txt` is generated from the doc pages' component descriptions, which do not change — no regeneration needed.
- No new exported symbol crosses a package entry point: `LayerManager` is already exported from `core/index.ts`, and the window classes are already exported from `overlay`. No barrel edits.

---

## Potential Challenges

- **`pointer-events: auto` on a child of a `pointer-events: none` parent.** This is the mechanism the whole icon-click depends on, and it is not exercised anywhere else in the library. It is standard CSS (a descendant re-enables hit-testing independently of its ancestor), but it is browser behaviour the offline harness cannot prove — case 12 is the manual check that it works.
- **The double-click that opens then closes the menu.** Two fast clicks on the icon toggle the menu open and shut; the `dblclick` veto in step 13 stops that pair from also maximizing the window. Watch for the case where the second click lands after the menu has covered the icon — the click then lands on the menu, not the icon, and the menu handles it normally.
- **Counter headroom in the window bands.** The pinned band sits 400 above the window band, so a session that registers more than ~400 layers could let a window stamp reach into the pinned range. That is the same bet the existing 800-pixel `Window`→`Popover` gap already makes, halved; no code guards it. Do not narrow the gap further.
- **`initChrome` ordering.** `setLocked` must be dispatched from `initChrome`, not `applyOptions` — `_borderComponents` does not exist during the `super()` cascade. Putting the call anywhere before the strips are built silently throws.
- **`Menu` disposal on window close.** A window closed while its menu is open must not leave a registered layer behind. `Menu.destructor` unregisters itself, so `this._windowMenu?.dispose()` in `AbstractWindow.destructor` is sufficient — but the call must be there, because the menu is never a registered child.

---

## Critical Files

| File | Why |
| --- | --- |
| [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts) | `register` / `bandFor` / `bringToFront` / `restampSubtree` — the band inheritance rule the new band must not break. |
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | The option-bag and reflect-hook conventions every new flag follows, and every gesture entry point the lock vetoes. |
| [`packages/lib/src/typescript/lib/component/button/SplitButton.ts`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L235) | The precedent for the whole open path: lazy `Menu`, `getViewportRect`, `toggleFor` with the trigger element. |
| [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts#L1666) | `showColumnMenu` / `buildColumnMenuItems` — per-open config rebuild, `CheckboxMenuRow` factories, the separator guard, and the `destructor` disposal comment. |
| [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts#L1090) | `openGutterMenu` — the second checkable-menu precedent, and the "Lock gutter" label over a differently-named API. |
| [`packages/lib/src/typescript/lib/component/container/WindowHeader.ts`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts) | `setCloseable` vs `setMinimizable` (disable vs hide), `addHeaderDoubleClickListener` (listen-on-self plus target filter), and `setGlyph`'s glyph swap. |
| [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1307) | `isBarChromeTarget` and the leading-group pointer-transparency contract. |
| [`packages/lib/src/typescript/lib/overlay/windowControls.ts`](packages/lib/src/typescript/lib/overlay/windowControls.ts) | `WindowControlButton.ownStyleStates` — the shape `WindowLeadGlyphButton` copies. |
| [`packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`](packages/lib/tests/overlay/AbstractWindow.resizable.test.ts) | The template for the two new option test files, including the white-box border probe. |

---

## Non-Goals

- **Keyboard access to the menu.** No Alt+Space shortcut and no focus ring on the icon. The `Menu` panel's own arrow-key roving highlight works once the menu is open; getting there is pointer-only.
- **A right-click context menu on the title bar.** The trigger is the icon click only, as specified.
- **Moving or resizing a locked window programmatically.** `setX` / `setWidth` / `toggleMaximize` / `setWindowState` keep working while locked; the lock gates the two user drag gestures, nothing else. Persisting the lock through layout serialization is likewise out.
- **Blocking the Shift-drag re-dock gesture while locked.** That gesture moves the window's *content* onto another tab strip; it is not a window move.
- **Changing what `getTopLayer` or the Escape handler consider topmost.** Only `register`'s parent lookup moves to frontmost-by-z; the dismissal walk and Escape targeting keep their stack-order semantics.
- **A shared always-on-top group or "pin all" affordance.** One flag per window.

---

## Notes

[^toggle-not-show]: `toggleFor` rather than `show(x, y, …)`: it excludes the opener from the menu's outside-click dismissal and remembers it, so a second click on the icon closes the panel instead of producing the close-then-reopen flash a bare `show()` gives. `Table` and `Split` use `show()` because their menus are right-click menus, which should reposition on a repeat trigger rather than close — see `Menu.toggleFor`'s own JSDoc for the distinction. `ToolBar`'s overflow button (`ToolBar.ts:748`) documents the same choice for the same reason.

[^live-state]: `Menu`'s `_itemsProvider` re-resolution is the *persistent*-mode mechanism, for a menu built once and reopened. A rebuild-mode menu already tears down and rebuilds its whole item list from the `configs` argument on every `show` / `toggleFor` call (`Menu.showAnchored`), so passing `this.buildWindowMenuItems()` per open is the rebuild-mode equivalent and needs no provider.

[^resizable-master]: `isMinimizable()` and `isMaximizable()` both return `false` whenever `isResizable()` is `false` — `resizable` is the documented master switch for both affordances. The menu reads the same effective getters the header buttons do, so a non-resizable window's menu drops both rows without any extra rule.

[^band-value]: 9400 puts the pinned band midway between `Window` (9000) and `Popover` (9800). The module's existing comment explains that the 200–1000 gap between bands is headroom for the shared monotonic `_zCounter`, on the assumption a session opens far fewer unrelated layers than that. Splitting the 800-pixel gap leaves 400 on each side, inside the range the existing bands already bet on. Placing the band above `Popover` or `Dropdown` was rejected: an always-on-top window must still sit under a dropdown or dialog opened from anywhere, which is exactly what the existing ascending order encodes.

[^frontmost]: A window-local "re-raise on every other window's `bringToFront`" workaround was rejected in favour of a real band — it would have to hook every raise of every peer, and two pinned windows would then fight over the top slot. Given the band, the `register` change is not optional polish: with one root band, "the layer registered last" and "the layer painting in front" were the same layer, and the band-inheritance rule silently depended on that. With two root bands they diverge, and a nested layer would inherit a band that paints behind its own opener. Reading the frontmost stamp restores the property the single band provided for free. `getTopLayer` and `topmostInputLayer` keep their stack-order meaning because they answer a different question (which layer owns Escape and keyboard routing), and changing that would alter dismissal behaviour well outside this feature.

[^lock-not-resizable]: The name is "Lock position" but the behaviour is "freeze this window" — both the title-bar drag-to-move and the resize-border drag. This is a deliberate product decision, not an oversimplification of a position-only lock. Naming a menu row for the user's mental model while the underlying API says something more precise is the existing house style: `Split`'s gutter menu shows "Lock gutter" over `SplitGutter.setMovable(false)`. The option is called `locked` rather than `movable` because it governs two gestures, not one. It is a separate flag from `resizable` because `resizable` doubles as the master switch for the minimize and maximize affordances, so folding lock into it would strip the header buttons — and the menu's own Minimize and Maximize rows — every time a window was locked.

[^lead-glyph-states]: `WindowLeadGlyphButton` extends `Button` and today declares no `ownStyleStates`, which the class comment justifies by the button being pointer-inert: it can never reach `.pressed` or `:hover`. Once it opens the menu that premise is gone, and the hierarchy-aware state resolution would hand it `Button`'s generic raised pressed/hover chrome — a grey raised box appearing under a transparent title icon. Declaring the same two entries `WindowControlButton` declares, with the resting `shadow: "none"` pinned into both, keeps the icon flat and makes its hover fill match the trailing minimize/maximize/close controls it is already a size and inset peer of. The resolved guard suffix is unchanged (`:not(.pressed):not(:hover)`), because both selectors were already resolved from `Button`'s list — so the existing hoisting test's resting-tier assertions still hold.

[^named-listener]: New listener registrations use a bound field plus a named method, per ARCHITECTURE.md's *Listeners must reference a named function*. The three adjacent `this._minTool.on("action", () => …)` lines in `TabWindow`'s constructor predate that rule and are left alone. The one exception is inside the `MenuItemConfig.row` factories, where the `row.on("action", …)` closure has to capture the row the factory just built — `Table.buildColumnMenuItems` and `Split.openGutterMenu` both do exactly this, and a named method could only express it by threading the row back in through a parameter.
