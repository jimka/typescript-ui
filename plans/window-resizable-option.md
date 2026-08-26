---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
---

# Window `resizable` option — Implementation Plan

## Overview

Every floating window is drag-resizable today, with no way to turn that off. This plan adds a `resizable` option to [`WindowOptions`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L110) plus the matching `setResizable` / `isResizable` pair on [`AbstractWindow`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L186). It defaults to `true`, so every existing window keeps behaving exactly as it does now.

The drag-resize interaction has two entry points, and both are gated. The first is the eight `WindowBorder` strips the window builds in its constructor ([AbstractWindow.ts:296-305](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L296)); each strip owns a `mousedown` listener and a resize cursor ([WindowBorder.ts:126-135](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L126)) and calls back into [`AbstractWindow.onResize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1594). The second is the Ctrl-snap affordance, which forwards a press made *near* a strip into that strip's drag flow ([`onSnapMouseDown`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2572)).

The change is confined to `AbstractWindow.ts` and one new test file. `Window` and `TabWindow` both take a plain `WindowOptions` bag and both call `initChrome`, so the option reaches them with no subclass edits.[^subclass-flow]

---

## Architecture Decisions

### The option and its accessors mirror `closeable` / `minimizable` / `maximizable`

`resizable?: boolean` joins the three sibling booleans in `WindowOptions`, defaults to `true` in `_defaultWindowOptions` ([AbstractWindow.ts:149-151](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L149)), and gets `setResizable(value: boolean): this` / `isResizable(): boolean` built exactly like [`setMaximizable` / `isMaximizable`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1365) — the `_options` bag is the cache, and the getter folds the class default.[^options-cache]

### Turning resizing off hides the eight border strips

`setResizable(value)` calls `border.setVisible(value ? null : false)` on each of the eight strips. A hidden strip renders `visibility: hidden`, so it takes no cursor and no hit test: the edge shows the ordinary arrow pointer and a press there lands on whatever sits underneath.[^hide-strips] The restore value is `null` (inherit), never `true`.[^visible-null]

This mirrors [`Accordion.layoutSections`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1704), which hides its drag gutters with `setVisible(false)` when resizable mode is off. Accordion's gutters, like the window's border strips, are handle components appended straight to the container's DOM rather than registered as layout children, so the same seam applies.

### `resizable` is dispatched from `initChrome`, not from `applyOptions`

`applyOptions` writes the caller's value straight into `_options` and dispatches nothing, exactly as it does for the three sibling booleans ([AbstractWindow.ts:411-413](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L411)). The dispatch — `this.setResizable(this.isResizable())` — goes in [`initChrome`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L351) beside `setMaximizable`. Dispatching earlier would throw: `applyOptions` runs inside `super()`, before the constructor body assigns `_borderComponents`.[^late-dispatch]

### Two gates guard the interaction itself

`onResize` early-returns when `isResizable()` is false, beside its existing `getWindowState() !== "normal"` guard. `onSnapKeyDown` early-returns on the same condition, so snap detection never arms on a non-resizable window and its mouse listeners are never attached. `setResizable(false)` additionally calls the existing private `clearSnapState()` to disarm a snap session that is already running.[^gates]

### `resizable` does not touch minimize, maximize, or programmatic sizing

`setResizable(false)` disables the *drag* interaction only. `setWidth` / `setHeight`, `setWindowState("maximized")`, `toggleMaximize`, the viewport-resize refit, and the window chrome's own insets are all unchanged. Nothing about the window's appearance changes: the gutter the strips sit in is part of the window's insets and stays exactly as wide as before.

---

## Public API

```typescript
export interface WindowOptions extends ContainerOptions {
    // …existing fields…
    resizable?: boolean;   // default true (_defaultWindowOptions)
}

abstract class AbstractWindow extends Container<WindowOptions> {
    setResizable(value: boolean): this;
    isResizable(): boolean;
}
```

Backing store: `_options.resizable`; class default `_defaultWindowOptions.resizable = true`; no private field.

---

## Internal Structure

The setter, placed directly after `isMaximizable()` ([AbstractWindow.ts:1377](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1377)):

```typescript
setResizable(value: boolean): this {
    this._options.resizable = value;

    // Hidden strips take no cursor and no hit test, so a non-resizable
    // edge shows the ordinary pointer instead of a resize cursor that
    // silently does nothing. `null` (inherit), not `true`, on the restore
    // branch — see the plan's `visible-null` note.
    for (const border of Object.values(this._borderComponents)) {
        border.setVisible(value ? null : false);
    }

    // Disarm a snap session that armed while the window was still resizable.
    if (!value) {
        this.clearSnapState();
    }

    return this;
}

isResizable(): boolean {
    return this._options.resizable ?? this._defaultOptions.resizable!;
}
```

The two gates, each added as the first statement of its method:

```typescript
onResize(border: WindowBorder, e: MouseEvent): void {
    if (!this.isResizable()) {
        return;
    }

    if (this.getWindowState() !== "normal") {
        return;
    }
    // …unchanged…
}

private onSnapKeyDown(e: KeyboardEvent): void {
    if (!this.isResizable()) {
        return;
    }

    if (!this.isSnapResizeEnabled()) {
        return;
    }
    // …unchanged…
}
```

---

## Ordered Implementation Steps

1. **New file `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts`** — write the eight unit-testable rows of _Expected Behaviour_ first; they fail to compile until step 3 lands, which is the red state. Copy the harness header (`CONFIG`, `installTestDOM`, `afterEach(() => DOM.reset())`) verbatim from [`tests/overlay/AbstractWindow.activate.test.ts:5-20`](packages/lib/tests/overlay/AbstractWindow.activate.test.ts#L5). Reach the private strips with the established cast form, e.g.

   ```typescript
   const borders = (win as unknown as { _borderComponents: Record<string, { isVisible(): boolean | null }> })._borderComponents;
   ```

   (the same shape [`tests/layout/DockRegion.styleRuleDisposal.test.ts:33`](packages/lib/tests/layout/DockRegion.styleRuleDisposal.test.ts#L33) uses). The file imports `Window` from `~/overlay/Window`, `TabWindow` from `~/overlay/TabWindow`, and `WindowBorder, Direction` from `~/component/container/WindowBorder`. Build the fake mouse event as `{ preventDefault: () => { prevented = true; }, clientX: 0, clientY: 0 } as unknown as MouseEvent`, following [`tests/component/list/List.test.ts:34`](packages/lib/tests/component/list/List.test.ts#L34). In the row that lets a resize session start (row 7), end it afterwards with `(win as unknown as { onResizeEnd(): void }).onResizeEnd();` so the viewport `mouseup` / `touchend` / `touchcancel` listeners it registered do not outlive the test — `DOM.reset()` alone does not clear the viewport-listener map.

2. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add `resizable?: boolean;` to `WindowOptions` immediately after `maximizable?:` ([line 121](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L121)), column-aligned with its neighbours, with a JSDoc line saying it enables the drag-to-resize borders and defaults to `true`. Add `resizable: true,` to `_defaultWindowOptions` after `maximizable: true,` ([line 151](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L151)).

3. **`AbstractWindow.ts`** — add `setResizable` / `isResizable` from _Internal Structure_ directly after `isMaximizable()` ([line 1379](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1379)), with JSDoc in the house style of the sibling pair: what the flag does, `@param`, `@returns This window, for method chaining.`
   *Check:* `npm run typecheck` is clean.

4. **`AbstractWindow.ts`** — in `applyOptions`, add `if (options.resizable !== undefined) this._options.resizable = options.resizable;` to the pure-write block at [lines 411-415](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L411), after the `maximizable` line.

5. **`AbstractWindow.ts`** — in `initChrome`, add `this.setResizable(this.isResizable());` after `this.setMaximizable(this.isMaximizable());` ([line 365](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L365)) and before `setMaximizeBounds`.

6. **`AbstractWindow.ts`** — add the `isResizable()` guard as the first statement of `onResize` ([line 1594](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1594)) and of `onSnapKeyDown` ([line 2436](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2436)), per _Internal Structure_. Extend `onSnapKeyDown`'s JSDoc first line to say arming also requires the window to be resizable.

7. **Regression check:** `grep -n "resizable" packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect exactly the option field, the default entry, the `applyOptions` write, the `initChrome` dispatch, the setter/getter pair (plus their JSDoc), and the two guards. Nothing in `Window.ts` or `TabWindow.ts` should need to change: `grep -n "resizable" packages/lib/src/typescript/lib/overlay/Window.ts packages/lib/src/typescript/lib/overlay/TabWindow.ts` — expect only the pre-existing prose in their class JSDoc.

8. Run the full `## Verification` list, then the manual smoke tests.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.resizable.test.ts` |

---

## Expected Behaviour

Rows 1-8 are unit-testable offline under the recording sink; rows 9-12 need a real browser (cursor rendering, hit testing, and a live drag).

| # | Case | Expected | How |
|---|---|---|---|
| 1 | `new Window('W').isResizable()` | `true` | unit |
| 2 | `new Window('W', { resizable: false }).isResizable()` | `false` | unit |
| 3 | `new TabWindow({ resizable: false }).isResizable()` | `false` — the option reaches the second subclass unchanged | unit |
| 4 | Default window, every strip in `_borderComponents` | `isVisible()` is `null` (inherit) | unit |
| 5 | `new Window('W', { resizable: false })`, every strip | `isVisible()` is `false` | unit |
| 6 | `win.setResizable(false)` then `win.setResizable(true)`, every strip | `isVisible()` back to `null` | unit |
| 7 | Resizable window: `win.onResize(new WindowBorder(Direction.EAST), fakeEvent)` | `fakeEvent.preventDefault` called (the gate let it through) | unit |
| 8 | Non-resizable window: same call | `preventDefault` **not** called, and `getWidth()` / `getHeight()` unchanged | unit |
| 9 | Hover each of the eight edges/corners of a non-resizable window | ordinary arrow cursor, no `ns-`/`ew-`/`nwse-`/`nesw-resize` | manual |
| 10 | Drag an edge of a non-resizable window | nothing moves or resizes | manual |
| 11 | Hold Ctrl near an edge of a non-resizable window, then press | no snap glow on any strip; the press does not resize | manual |
| 12 | `setResizable(true)` at runtime on a window opened non-resizable | resize cursors and edge dragging both come back | manual |

Unchanged behaviour to confirm while doing the manual pass: a non-resizable window still moves by its header/bar, still minimizes, still maximizes (including the header double-click), and still shows the same border, shadow, and gutter width as a resizable one.

---

## Verification

- `npm run typecheck` — clean.
- `npm run test` — the full suite, including the new `AbstractWindow.resizable.test.ts`.
- `npm run lint` — clean.
- Manual smoke test: `npm run dev` (app on `localhost:8015`), open the demo shell, and open a window from the **Misc** panel — [`MiscPanel.ts:1148`](packages/lib/src/typescript/MiscPanel.ts#L1148) constructs a `Window` there. Pass `{ resizable: false }` at that call site to walk rows 9-12, then revert — this edit is a scratch change for the manual pass and must not be committed.
- `npm run docs:api` — must finish with zero warnings once the new JSDoc lands.

---

## Documentation Impact

This change is consumer-visible, so **run the `document` skill after the code lands**. Do not hand-edit docs as part of this plan. The surface the skill needs to cover:

- New exported API: `WindowOptions.resizable`, `AbstractWindow.setResizable`, `AbstractWindow.isResizable`.
- Pages describing the affected surface today: [`packages/lib/docs/components/Window.md`](packages/lib/docs/components/Window.md) (its options table, which already lists `minimizable` / `maximizable` / `snapResizeEnabled`), [`packages/lib/docs/components/TabWindow.md`](packages/lib/docs/components/TabWindow.md) (same table), and [`packages/lib/docs/components/AbstractWindow.md`](packages/lib/docs/components/AbstractWindow.md) (its "Resize borders" and "Closeable / minimizable / maximizable" concern rows), plus a changelog entry under `packages/lib/docs/reference/changelog/`.
- `packages/lib/llms.txt` is generated — `npm run docs:llms`. Its two window entries are one-line class summaries with no option detail, so no hand edit is needed there.

---

## Potential Challenges

- **`WindowBorder` declares its own `ownStyleStates`, so it does not inherit `Component`'s `.invisible` entry.** `setVisible` still works on it — the `.invisible` CSS rule matches the universal component token rather than the concrete class name, and `isVisible()` reads `_activeStates` directly for exactly this case ([Component.ts:2028-2040](packages/lib/src/typescript/lib/core/Component.ts#L2028)). Do not "fix" this by adding an `.invisible` entry to `WindowBorder.ownStyleStates`; that list is a whole-list override and adding entries there changes the `:not(...)` guards on `.snap-target`.
- **A strip hidden before its element exists.** `new Window('W', { resizable: false })` hides the strips during construction, before any of them has rendered. `Component.render` replays every recorded state class token onto the fresh element ([Component.ts:6921](packages/lib/src/typescript/lib/core/Component.ts#L6921)), so the hidden state survives to first paint — this is the documented path, not a new one.
- **`_defaultWindowOptions` doubles as `ownClassStyleDefaults`** ([AbstractWindow.ts:190](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L190)). Adding a non-CSS key to that bag is already established there (`closeable`, `minimizable`, `maximizable`, `windowState` all sit in it); the class-tier resolver reads only the keys it knows.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | The only source file changed. Read `WindowOptions`, `_defaultWindowOptions`, the constructor's border block, `applyOptions`, `initChrome`, `setMaximizable`/`isMaximizable`, `onResize`, `onSnapKeyDown`, `clearSnapState`. |
| [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1704) | The precedent: `resizable` option, `isResizable`/`setResizable` pair, and drag handles hidden with `setVisible(false)` when resizable mode is off. |
| [`packages/lib/src/typescript/lib/component/container/WindowBorder.ts`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts) | The strip being hidden — its constructor-time `mousedown` wiring and `dragCursor()`, and its own `ownStyleStates` list. |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L2051) | `setVisible` / `isVisible` semantics, including the tri-state `null` and the render-time state-class replay. |
| [`packages/lib/tests/overlay/AbstractWindow.activate.test.ts`](packages/lib/tests/overlay/AbstractWindow.activate.test.ts) | The harness header the new test file copies. |

---

## Non-Goals

- **No demo-panel change.** No demo panel showcases `closeable` / `minimizable` / `maximizable` with a toggle button today, so adding a resizable toggle would introduce a pattern rather than match one. The manual pass uses a temporary edit at the `MiscPanel` window call site instead.
- **No `WindowBorder` API change.** The strip needs no `enabled` flag of its own; hiding it is enough, and a second disable mechanism inside the strip would be a duplicate switch.
- **No change to minimize, maximize, or the move drag.** Those have their own options and are unaffected by `resizable`.
- **No layout or chrome change.** The insets that form the resize gutter stay the same width whether or not the window is resizable, so a window's size and appearance do not shift when the option is turned off.
- **No serialization work.** Window serialization does not persist `closeable` / `minimizable` / `maximizable` today, and `resizable` follows them.

---

## Notes

[^subclass-flow]: Both concrete windows are declared as `class Window extends AbstractWindow` ([Window.ts:42](packages/lib/src/typescript/lib/overlay/Window.ts#L42)) and `class TabWindow extends AbstractWindow` ([TabWindow.ts:60](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L60)) — neither narrows the options generic nor declares an options interface of its own, so both constructors already accept the widened `WindowOptions`. Both end their constructor with `this.initChrome(options)` ([Window.ts:95](packages/lib/src/typescript/lib/overlay/Window.ts#L95), [TabWindow.ts:113](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L113)), which is where the dispatch is added, so neither needs a forwarding hook. This differs from `AccordionPanel`, which forwards its own `resizable` option into `Accordion.setResizable` ([AccordionPanel.ts:101-102](packages/lib/src/typescript/lib/component/container/AccordionPanel.ts#L101)) — that forwarding exists only because the option crosses from a component to the layout manager it owns, which has no counterpart here.

[^options-cache]: ARCHITECTURE.md's default shape is "the options bag is the cache" — a private backing field is added only when the setter normalises the stored form, which a plain boolean does not. So `resizable` uses `_options.resizable` and needs no `declare` field, and the getter folds the class default (`?? this._defaultOptions.resizable!`) so `new Window('W').isResizable()` reports `true` rather than `null`. This is a deliberate cosmetic divergence from `Accordion`, which keeps a `private _resizable` field ([Accordion.ts:190](packages/lib/src/typescript/lib/layout/Accordion.ts#L190)): `Accordion` is a `LayoutManager`, not a `Component`, so it has no `_options`/`_defaultOptions` pair to cache into. Matching the three sibling booleans on the very same class matters more here than matching the field shape of a different class hierarchy.

[^hide-strips]: Two other seams were considered and rejected. *Not constructing the strips* when `resizable` is false would make `_borderComponents` nullable and force null handling through `doLayout` ([AbstractWindow.ts:1912-1968](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1912)), `renderContent` ([:1981](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1981)), `pickSnapBorder`, and `destructor`, and would make `setResizable(true)` at runtime a build-and-append path — much more code for the same result. *Gating `onResize` alone* leaves every edge painting a resize cursor that does nothing when pressed, which is worse than no affordance at all; the cursor is written at strip construction from `dragCursor()` ([WindowBorder.ts:126](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L126)) and is not conditional on anything the window knows. Hiding the strips removes the cursor and the hit test in one call, because `visibility: hidden` elements are not hit-test targets.

[^visible-null]: `setVisible(true)` would write an explicit `visibility: visible` onto each strip. The window itself starts hidden — its constructor calls `this.setVisible(false)` ([AbstractWindow.ts:323](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L323)) and `show()` reveals it later — and a child with an explicit `visible` overrides a hidden ancestor in CSS, so explicitly-visible strips would paint over a window that is meant to be invisible. `setVisible(null)` records the tri-state "inherit" and serialises to `visibility: inherit` ([ClassStyleRules.ts:277](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L277)), which is what the strips have today.

[^late-dispatch]: `Component`'s constructor calls `applyOptions` from inside `super()`. `AbstractWindow`'s constructor body — which builds `_borderComponents` — has not run at that point, so a `setResizable` call from `applyOptions` would dereference `undefined`. The three sibling booleans hit the same wall for a different reason (their `reflect*` hooks need subclass chrome) and solve it the same way: a pure `_options` write in `applyOptions`, then a dispatch from `initChrome` that folds in the class default. Following that route keeps all four flags initialising through one mechanism.

[^gates]: The `onResize` guard is not redundant with hiding the strips. It ends an in-flight drag: `setResizable(false)` called mid-drag leaves the strip's own viewport `mousemove` listener attached until the pointer is released, and without the guard the window would keep resizing after the option was turned off. The `onSnapKeyDown` guard is the one that matters for the snap path — the snap flow starts by arming on a modifier keydown, and blocking the arm means `_snapEnabled` stays false, the snap mouse listeners are never attached, `_snapTargetBorder` stays null, and `onSnapMouseDown` returns immediately. Gating there rather than at the `attachSnapKeyboardListeners` call in `show()` ([AbstractWindow.ts:678](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L678)) means no attach/detach bookkeeping is needed when `setResizable` toggles after the window is already open; the leftover keydown listener costs one early return per keypress. `clearSnapState()` on the `false` branch covers the one case a gate cannot: snap already armed and highlighting a strip when the option flips.
