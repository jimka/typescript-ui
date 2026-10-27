---
depends-on: [dock-layout-own-windows]
touches-shared:
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/tests/component/layout/LayoutSerialization.test.ts
  - packages/lib/tests/overlay/Dock.lifecycle.test.ts
  - packages/lib/docs/layouts/LayoutSerialization.md
  - packages/lib/docs/components/Dock.md
  - packages/lib/docs/reference/changelog/next.md
---

# TabWindow Layout Restore — Implementation Plan

## Overview

A *strip-mode tear-off* is a [`TabWindow`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L62): a floating window whose own layout manager is a `Tab`, so the window's children are its tabs. Layout save and restore ([`LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts), used by [`Dock.getLayoutState` / `setLayoutState`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L745)) treats every float as a bare `Window` with one content child:

- [`windowContentOf`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L359) returns a window's first non-chrome child. For a `TabWindow` that is its first tab, so [`windowNodeFor`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L370) saves one tab and [`parkLeaves`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L470) parks one tab.
- [`applyWindow`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L690) always builds `new Window(...)`.

A related loss shows up as soon as every tab is captured. A lazy `Dock` panel's identity frame carries its own `Tab` manager ([`resolvePanel`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L813)). The serializer descends into every `Tab`-managed component, so it records the frame's internal children instead of the panel. This happens in the tiled tree today.

Offline probes on this branch (`Dock.lifecycle.test.ts` harness, `TabWindow` holding frames `a`, `b`, `c` with `c` active, `d` tiled):[^probe]

| Case | Saved | After `setLayoutState(saved)` |
|---|---|---|
| 3-tab `TabWindow` | one window node, `content` = panel `a` only, `header` `"C"` | `a` in a bare `Window` titled `"C"`; `b` and `c` still inside the closed `TabWindow`, not disposed; dock emits `close` for `b` and `c` and drops their frames; a second save records only `a` |
| Tiled lazy panel `b` beside `a` | `b` saved as a nested `tab` node of two random ids | frame `b` is **destroyed**; two `no component for panelId "<uuid>"` warnings |
| Plain `serializeLayout` with a 2-tab `TabWindow` (active `y`) | content = panel `x`, header `"y"` | `x` in a bare `Window`; `y` left in the closed `TabWindow` |

This plan records a `TabWindow`'s kind and full tab list, rebuilds it as a `TabWindow`, and lets a caller mark a `Split`/`Tab`-managed component as a single panel. `Dock` uses that to mark its identity frames. Old saved states keep restoring as they do now.

---

## Architecture Decisions

### The window kind is a new optional `WindowNode.windowMode` field, typed `TabDetachWindowMode`

`WindowNode` gains `windowMode?: TabDetachWindowMode` (`"bare" | "strip"`). The save writes `windowMode: "strip"` for a `TabWindow` and omits the field for any other window. On restore, an absent field means `"bare"`: build a `Window`, as every state written so far was restored.[^kind-field] The type is the existing public [`TabDetachWindowMode`](../packages/lib/src/typescript/lib/layout/Tab.ts#L91), the vocabulary `Tab` already uses for "which kind of window a tear-off opens".[^why-mode-type]

`LayoutState.version` stays `1`. Additive optional fields have never bumped it.[^no-version-bump]

### A `"strip"` node's `content` is a `tab` node with one child per tab

A `TabWindow` is captured by passing the window itself to the existing `nodeFor`. Its manager is a `Tab`, so `nodeFor`'s `Tab` branch records every tab in strip order with the active one, exactly as it does for a tiled tab group.[^nodefor-tabwindow] `header` is still written (the active tab's label). A `TabWindow` ignores it on restore, because its title is read live from the active tab. Code that predates this change still gets every tab back.[^forward-compat]

### Restore fills the `TabWindow`'s own `Tab` with the same code that fills a rebuilt tab group

The body of `populateContainer`'s tab branch becomes a helper, `fillTab(container, tab, node, parked, factory)`, that returns how many tabs it placed. `populateContainer` calls it with a fresh `Tab`. The strip path calls it with the `TabWindow` as `container` and the window's own `Tab` as `tab`. This reuses the skipped-tab active-index re-alignment and the `moveComponent`-then-`createTab` order that [`TabWindow.addContent`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts#L395) itself uses.[^why-filltab]

A `"strip"` node's content is normalised before filling:

| Saved `content` | Tabs in the rebuilt `TabWindow` |
|---|---|
| `tab` node `[a, b, c]`, `activeIndex: 2` | `a`, `b`, `c`; `c` active |
| `panel` node `a` (hand-written state) | `a` alone |
| `split` node (hand-written state) | one tab holding the rebuilt split container |
| none, legacy `panelId: "a"` | `a` alone |

When no tab can be placed (every factory call returned `null`), the never-shown `TabWindow` is disposed and no window opens. Each missing panel has already warned.

### A restored `TabWindow` is shown exactly like a restored `Window`

The geometry-and-show tail of `applyWindow` becomes `showRestoredWindow(win, node)` and serves both kinds. The window is built with `{ autoFocus: false }`. The tail applies the normal rect, calls `show()`, applies a minimized/maximized state, then calls `setAutoFocus(true)`. A restored strip window therefore takes no focus when shown and answers later raises like a fresh tear-off, matching the rule this stack set for restored `Window`s.

### `LayoutSerializationOptions` gains `isPanel`; `Dock` marks its identity frames with it

`isPanel?: (component: Component) => boolean` decides whether a component whose layout manager is a `Split` or `Tab` is a single panel. When it returns `true`, the save records the component as a `panel` node keyed by its id, and the restore parks and re-homes the component whole. The serializer is asked only before it descends into a child, never about `root` and never about a window.[^why-ispanel] It follows the `includeWindow` predicate this stack just added: an optional predicate in the same options bag, supplied by `Dock`.

`Dock` passes `isPanel: component => this._frames.get(component.getId()) === component`. That is the identity-frame test [`wireRegion`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1633) already uses to stop the sweep from wiring a lazy frame as a region.

### `Dock` needs no new adoption code for a restored `TabWindow`

`setLayoutState` already schedules a sweep. The sweep's [`subscribeFloatWindows`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1277) walks [`floatWindowsHoldingFrames`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1357), which includes any open window holding a frame. On first sight of the restored `TabWindow` it subscribes `activate`/`close`/`beforeclose`, applies the dock's presentation through `applyTabOptions`, and subscribes the panel lifecycle on the window's `Tab`. [`ownedFloatWindows`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1504) excludes `TabWindow`, so the sweep never wraps its tabs in a region. A strip-mode tear-off goes through the same path today.[^adoption-evidence]

The private `Dock.ownWindowOptions()` is renamed `layoutOptions()`, because it now returns `isPanel` as well as `includeWindow`. `isOwnWindowNode` and `withoutForeignWindows` are unchanged: a strip node's `content` is a `tab` node, which `holdsRegisteredPanel` already walks.

---

## Public API

```typescript
// layout/LayoutSerialization.ts
export interface WindowNode {
    kind:         "window";
    panelId?:     string;
    content?:     LayoutNode;
    /**
     * The kind of window: `"strip"` for a `TabWindow`, whose tab strip is the
     * window, or `"bare"` for a header `Window`. Omitted means `"bare"`.
     * A `"strip"` node's `content` is a `tab` node with one child per tab.
     */
    windowMode?:  TabDetachWindowMode;          // NEW
    header:       string;
    rect:         SerializedRect;
    state:        "normal" | "minimized" | "maximized";
    restoreRect:  SerializedRect | null;
}

export interface LayoutSerializationOptions {
    includeWindow?: (win: AbstractWindow) => boolean;
    /**
     * Marks a component whose layout manager is a `Split` or `Tab` as a single
     * panel. Return `true` to record it as one `panel` node keyed by its id and
     * to park and re-home it whole on restore. Asked before the walk descends
     * into such a component; never asked about `root` or about a window.
     * Default: every `Split`- or `Tab`-managed component is an arrangement.
     */
    isPanel?: (component: Component) => boolean;  // NEW
}
```

`serializeLayout`, `restoreLayout`, `LayoutState` and `LayoutFactory` keep their signatures. No new export: `WindowNode`, `LayoutSerializationOptions` and `TabDetachWindowMode` are already exported from `layout/index.ts`.

---

## Internal Structure

`LayoutSerialization.ts` imports:

```typescript
import { TabWindow } from "~/overlay/TabWindow.js";
import type { TabDetachWindowMode } from "~/layout/Tab.js";
```

The arrangement test and the per-child capture. Add both after `managerKind`; split the current panel branch of `nodeFor` out as `panelNodeFor`:

```typescript
function isArrangement(component: Component, options: LayoutSerializationOptions | undefined): boolean {
    const kind = managerKind(component);

    return (kind === "Split" || kind === "Tab") && options?.isPanel?.(component) !== true;
}

function childNodeFor(child: Component, options: LayoutSerializationOptions | undefined): LayoutNode {
    return isArrangement(child, options) ? nodeFor(child, options) : panelNodeFor(child);
}
```

`nodeFor(component, options)` keeps its `managerKind` switch for the component itself. Its Split branch maps `kept.map(index => childNodeFor(live[index], options))` and its Tab branch maps `kept.map(child => childNodeFor(child, options))`. Its last branch returns `panelNodeFor(component)`; `panelNodeFor` is today's panel-branch body moved verbatim (lines 336–349).

`windowNodeFor(win, options)`:

```typescript
const content = windowContentOf(win);

if (!content) {
    return null;
}

if (win instanceof TabWindow) {
    return {
        kind:        "window",
        windowMode:  "strip",
        content:     nodeFor(win, options),
        header:      win.getTitle(),
        rect:        win.getRect(),
        state:       win.getWindowState(),
        restoreRect: win.getRestoreRect(),
    };
}

return {
    kind:        "window",
    content:     childNodeFor(content, options),
    header:      win.getTitle(),
    rect:        win.getRect(),
    state:       win.getWindowState(),
    restoreRect: win.getRestoreRect(),
};
```

`collectLeaves(component, into, options)` replaces `kind === "Split" || kind === "Tab"` with `isArrangement(child, options)` and passes `options` down. `parkLeaves(root, liveWindows, factory, options)`:

```typescript
collectLeaves(root, leaves, options);

liveWindows.forEach(win => {
    // A TabWindow's children are its tabs.
    if (win instanceof TabWindow) {
        collectLeaves(win, leaves, options);

        return;
    }

    const content = windowContentOf(win);

    if (!content) {
        return;
    }

    if (isArrangement(content, options)) {
        collectLeaves(content, leaves, options);
    } else {
        leaves.push(content);
    }
});
```

`fillTab` is the current tab branch of `populateContainer` (lines 651–674) moved verbatim, with `tab` and `container` taken as parameters and a placed-count return:

```typescript
function fillTab(container: Component, tab: Tab, node: TabNode, parked: Map<string, Component>, factory: LayoutFactory): number {
    let activeIndex = node.activeIndex;
    let placed = 0;

    node.children.forEach((child, index) => {
        const built = materializeNode(child, parked, factory);

        if (built) {
            container.moveComponent(built, undefined, constraintsFor(child));
            tab.createTab(built);
            placed++;
        } else if (index < node.activeIndex) {
            activeIndex--;
        }
    });

    tab.setActiveTabIndex(activeIndex);

    return placed;
}
```

Keep the existing comments of that block with the moved code. `populateContainer`'s else branch becomes: `const tab = new Tab({ reorderable: true, compact: true }); container.setLayoutManager(tab); fillTab(container, tab, node, parked, factory);`.

`applyWindow` becomes a short dispatcher over three helpers:

```typescript
function applyWindow(node: WindowNode, parked: Map<string, Component>, factory: LayoutFactory): void {
    const contentNode = windowContentNode(node);

    if (!contentNode) {
        console.warn("restoreLayout: window node has neither content nor panelId; skipping.");

        return;
    }

    const win = node.windowMode === "strip"
        ? buildStripWindow(contentNode, parked, factory)
        : buildBareWindow(node.header, contentNode, parked, factory);

    if (win) {
        showRestoredWindow(win, node);
    }
}

// node.content ?? the legacy panelId as a one-panel node ?? null (today's lines 693–694).
function windowContentNode(node: WindowNode): LayoutNode | null;

// Today's lines 702–715: materialize, `new Window(header, { autoFocus: false })`,
// moveComponent with constraintsFor(contentNode). Returns null when nothing materialized.
function buildBareWindow(header: string, contentNode: LayoutNode, parked: Map<string, Component>, factory: LayoutFactory): AbstractWindow | null;

function buildStripWindow(contentNode: LayoutNode, parked: Map<string, Component>, factory: LayoutFactory): AbstractWindow | null {
    const tabs: TabNode = contentNode.kind === "tab"
        ? contentNode
        : { kind: "tab", children: [contentNode], activeIndex: 0 };

    // Not shown yet, so filling it (and selecting its active tab) moves no focus.
    const win = new TabWindow({ autoFocus: false });

    if (fillTab(win, win.getLayoutManager() as Tab, tabs, parked, factory) === 0) {
        win.dispose();

        return null;
    }

    return win;
}

// Today's lines 717–734, unchanged: applyRect(normal rect), show(),
// setWindowState when not normal, setAutoFocus(true), with their comments.
function showRestoredWindow(win: AbstractWindow, node: WindowNode): void;
```

`serializeLayout` passes `options` to `nodeFor(root, options)` and to `windowNodeFor` (`.map(win => windowNodeFor(win, options))`). `restoreLayout` passes `options` to `parkLeaves`.

`Dock.ts`, replacing `ownWindowOptions` (line 1374) and its two call sites (lines 746, 777):

```typescript
private layoutOptions(): LayoutSerializationOptions {
    const own = new Set<AbstractWindow>(this.floatWindowsHoldingFrames());

    return {
        includeWindow: (win: AbstractWindow): boolean => own.has(win),
        isPanel:       (component: Component): boolean => this._frames.get(component.getId()) === component,
    };
}
```

JSDoc: "The serialization options for a save or restore of this dock: `includeWindow` accepts only the windows {@link floatWindowsHoldingFrames} lists, taken once when this is called, so a restore asks about the windows as they were before it parked or closed anything; `isPanel` marks this dock's identity frames as panels, so a lazy panel's frame — which carries its own `Tab` — is saved and parked whole."

---

## Ordered Implementation Steps

Tests first: steps 1–3 add the cases in *Expected Behaviour*. Most fail until steps 4–6 land.

1. **`packages/lib/tests/component/layout/LayoutSerialization.test.ts`** — add `import { TabWindow } from '~/overlay/TabWindow';`. After `describe('the includeWindow option', …)` (ends line 1291), add `describe('a tab-strip window', …)` with cases TW1–TW9, then `describe('the isPanel option', …)` with IP1–IP3. Copy the `afterEach` of `describe('the includeWindow option')` (dispose every open window, `vi.restoreAllMocks()`, `DOM.reset()`) into both. Check: TW1–TW5, TW7, TW9 and IP1–IP3 fail now; TW6 and TW8 pass now and guard behaviour that must not change.
2. **`packages/lib/tests/overlay/Dock.lifecycle.test.ts`** — move four items out of `describe("Dock layout state covers only the dock's own windows")` to file level, directly above that `describe`, unchanged and with their JSDoc: `tearOff` (from line 2124), `openWindowHolding` (line 2156), `panelIdsOf` (line 2169) and the `WINDOW_GEOMETRY` constant (line 2187). Leave `settingsWindow`, `twoPanelDock` and `windowPanelIds` where they are. Check: that file still passes unchanged.
3. **Same file** — after that `describe` (ends line 2373), add `describe('Dock layout state of a strip-mode tear-off', …)` with cases DS1–DS8 and two local helpers:
   - `panelDock(ids: string[], lazy: string[] = [])` — `mountDock()`, then for each id `dock.addLazyPanel({ id, title: id.toUpperCase(), content: () => new Component({}) })` when `lazy` includes it, else `dock.addPanel({ id, title: id.toUpperCase(), content: new Component({}) })`; then `dock.doLayout(); flush();`.
   - `stripWindow(dock, ids, activeId)` — `const tw = tearOff(dock, ids[0], false) as TabWindow;` then for each further id: `const frame = frameOf(dock, id); const source = priv(dock).regionForFrame(frame).getLayoutManager() as Tab; tw.createTab(frame); source.removeMovedTab(frame);`. Then `(tw.getLayoutManager() as Tab).setActiveContent(frameOf(dock, activeId)); priv(dock).scheduleSweep(); flush(); tw.doLayout();` and return `tw`.

   Check: DS1–DS8 all fail now (DS8's bare-window half already passes; its strip half does not).
4. **`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`** — per *Internal Structure*: add the two imports; add `windowMode` to `WindowNode` and `isPanel` to `LayoutSerializationOptions` with the JSDoc in *Public API* (link `TabWindow` and `Window` with the file's markdown form, ``[`TabWindow`](/api/overlay/classes/TabWindow)``, and `TabDetachWindowMode` with `{@link TabDetachWindowMode}`, which is public); add `isArrangement`, `childNodeFor`, `panelNodeFor`; thread `options` through `nodeFor`, `windowNodeFor`, `collectLeaves`, `parkLeaves`; extract `fillTab`; split `applyWindow` into `windowContentNode`, `buildBareWindow`, `buildStripWindow`, `showRestoredWindow`. Update JSDoc: `WindowNode`'s class comment adds "A tab-strip window records `windowMode: "strip"`"; `windowNodeFor` says a `TabWindow` is captured whole; `parkLeaves` says it parks every tab of a `TabWindow`; `applyWindow` says a `"strip"` node rebuilds a `TabWindow`. Each new helper gets a JSDoc (description, `@param`, `@returns`). Check: TW1–TW9 and IP1–IP3 pass; the whole of `LayoutSerialization.test.ts` passes.
5. **Check the moved order.** `grep -n "new Tab({ reorderable: true, compact: true })" packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` — exactly one match, in `populateContainer`. `grep -n "setActiveTabIndex" packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` — exactly one match, in `fillTab`.
6. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — rename `ownWindowOptions` to `layoutOptions`, return `isPanel` as in *Internal Structure*, and update its JSDoc and both call sites. In `getLayoutState`'s JSDoc add: "A tab-strip tear-off is recorded with every tab." In `setLayoutState`'s JSDoc add: "A tab-strip tear-off is rebuilt as a tab-strip window with all its tabs." Check: `grep -n "ownWindowOptions" packages/lib/src/typescript/lib/overlay/Dock.ts` — zero matches; DS1–DS8 pass.
7. **Run the regression files** one at a time (see *Verification*). OW1–OW8, `L1`, `LW1`–`LW7`, `H1`/`H2`, *restoreLayout of a Tab node* 1–10 and *a reordered Tab strip survives save and restore* 1–5 must stay green unchanged.
8. **Docs** — the edits in *Documentation Impact*.
9. **Manual check M1** — see *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case is offline-testable under `installTestDOM` unless marked **manual**.

### Plain functions — `describe('a tab-strip window')` in `LayoutSerialization.test.ts`

Setup unless stated, in this order: `{ host: root } = tabHost()` (an empty `Tab` host, so the saved root is an empty `tab` node and restoring it warns about nothing). Components `x`, `y`, `z` have ids `x`, `y`, `z` and names `X`, `Y`, `Z`. `tw = new TabWindow()`; `tw.createTab(x)`; `tw.moveComponent(y, undefined, Object.assign(new LayoutConstraints(), { closeable: false, tooltip: 'TY' }))`; `tw.createTab(y)` (its own move is then a no-op, so `y` keeps those constraints); `tw.createTab(z)`; `(tw.getLayoutManager() as Tab).setActiveTabIndex(1)`; `tw.show()`. The factory is `instanceFactory({ x, y, z })`. No other window is open.

- **TW1 — a `TabWindow` is saved with every tab.** `serializeLayout(root).windows` has one node with `windowMode: 'strip'`, `header: 'Y'`, and `content` a `tab` node whose `children` panel ids are `['x', 'y', 'z']` and whose `activeIndex` is `1`. The `y` child carries `closeable: false` and `tooltip: 'TY'`.
- **TW2 — restore rebuilds a `TabWindow`.** `restoreLayout(root, serializeLayout(root), factory)`: `tw` is not in `AbstractWindow.getOpenWindows()`; exactly one open window, an instance of `TabWindow`, and not `tw`. Its `getComponents()` ids are `['x', 'y', 'z']`; its `Tab`'s `getActiveContent()` is `y`; its `getTitle()` is `'Y'`; `getLayoutConstraints(y)?.closeable` is `false`; none of `x`, `y`, `z` is destroyed; `console.warn` was not called.
- **TW3 — a strip-order reorder survives.** Before saving, call the file's `reorder(tw.getLayoutManager() as Tab, 2, 0)` (strip `z, x, y`) and `setActiveContent(y)` on the same `Tab`. After save and restore the new `TabWindow`'s `Tab.indexOfContent` gives `z` 0, `x` 1, `y` 2, and `y` is active.
- **TW4 — a missing tab is skipped and the active tab is kept.** The factory knows only `y` and `z`. After restore: one warning naming `"x"`; the `TabWindow` holds `y`, `z`; `y` is active.
- **TW5 — a one-tab strip comes back as a `TabWindow`.** Instead of the setup's `tw`, a shown `TabWindow` holding only `x`. Save gives `windowMode: 'strip'` and a `tab` node `[x]`. Restore opens a `TabWindow` holding `x`.
- **TW6 — a bare window records no `windowMode` and restores as `Window`.** Skip the `TabWindow` setup. A shown `Window('Plain')` holds `x`. The saved node has no `windowMode` key (`'windowMode' in node` is `false`); restore opens one window that is an instance of `Window` and not of `TabWindow`.
- **TW7 — content normalisation for a hand-written `"strip"` node.** Restore each of these states, with `root: { kind: 'tab', children: [], activeIndex: 0 }`. The first two rows expect one open `TabWindow`:

  | `windows[0]` (plus `header: 'H'`, `rect`, `state: 'normal'`, `restoreRect: null`) | Tabs, in order | Active |
  |---|---|---|
  | `windowMode: 'strip'`, `content: { kind: 'panel', panelId: 'x' }` | `x` | `x` |
  | `windowMode: 'strip'`, `panelId: 'x'` (no `content`) | `x` | `x` |
  | `windowMode: 'strip'`, `content: { kind: 'tab', children: [panel 'gone', panel 'gone2'], activeIndex: 0 }`, factory without either | no window opens; two warnings | — |
- **TW8 — an old state still restores as before.** The state from TW1 with `windowMode` deleted restores to one `Window` (not a `TabWindow`) whose content is a container with a `Tab` manager holding `x`, `y`, `z`.
- **TW9 — a restored strip window takes no focus and ends with `autoFocus` on.** Skip the `TabWindow` setup. As the existing `L1` case: spy `Component.afterNextLayout`, focus an opener button, restore onto a fresh `Container` a state with `root: { kind: 'tab', children: [], activeIndex: 0 }` and one window `{ windowMode: 'strip', content: tab [panel 'x', panel 'y'], activeIndex 0, header: 'H', rect, state: 'normal', restoreRect: null }`, factory `instanceFactory({ x, y })`, then run the queued callbacks. The opener still holds focus; the new `TabWindow`'s `isAutoFocus()` is `true`.

### Plain functions — `describe('the isPanel option')`

Setup: `{ host: root } = tabHost()`; `a` from `panels()`; `framed` is a `Container` with id `framed` and a `Tab` manager holding a `Component` with id `inner`; `root.addComponent(a)`, `root.addComponent(framed)`, `root.doLayout()`.

- **IP1 — the save records a marked container as one panel.** `serializeLayout(root, { isPanel: c => c === framed }).root` is a `tab` node whose children are panel `a` and panel `framed`.
- **IP2 — the restore parks it whole.** `restoreLayout(root, thatState, instanceFactory({ a, framed }), { isPanel: c => c === framed })`: `framed` is not destroyed, its parent is `root`, `inner`'s parent is still `framed`, and `console.warn` was not called.
- **IP3 — never asked about `root` or a window; default unchanged.** With a shown `TabWindow` holding a `Component` `x` (id `x`) and `isPanel = vi.fn(() => false)`, after `serializeLayout(root, { isPanel })` the spy was called with `framed` and never with `root` or the `TabWindow`. Without the option, `serializeLayout(root).root.children[1].kind` is `'tab'` (today's behaviour).

### Dock — `describe('Dock layout state of a strip-mode tear-off')` in `Dock.lifecycle.test.ts`

Setup unless stated: `dock = panelDock(['a', 'b', 'c', 'd'])`; `tw = stripWindow(dock, ['a', 'b', 'c'], 'c')`; `d` stays tiled. Record `close`, `attach` and `detach` events after the setup.

- **DS1 — save.** `dock.getLayoutState().windows` has one node, `windowMode: 'strip'`, panel ids `['a', 'b', 'c']`, `activeIndex: 2`.
- **DS2 — restore.** `dock.setLayoutState(state); flush();`. `tw` is not open. `openWindowHolding(frameOf(dock, x))` is one and the same `TabWindow` for `a`, `b`, `c`, and is not `tw`. Its `getComponents()` are the frames `a`, `b`, `c` in that order (not wrapped in a region container), its `Tab` has `c` active, and `frameOf(dock, 'd')` is still under `dock.getRootRegion()`. No `close` event fired; `a`, `b`, `c` each received an `attach` naming the new window. Every frame is in `_frames` and not destroyed.
- **DS3 — the dock adopts the restored window.** `dock.setTabOptions({ maxWidth: 250 })` before the restore. After restore + `flush()`: `priv(dock)._floatSubscribed.has(restored)` is `true`; `(restored.getLayoutManager() as Tab).getMaxWidth()` is `250`; `dock.focusPanel('b')` returns `true` and the restored window's `Tab` then has `b` active; `restored.isAutoFocus()` is `true`.
- **DS4 — a second save matches the first.** After DS2, `dock.getLayoutState().windows[0]` has the same `windowMode`, panel ids and `activeIndex` as before the restore.
- **DS5 — a lazy panel in the strip window.** `dock = panelDock(['a', 'b', 'c', 'd'], ['b'])`, same `stripWindow`. The saved strip node's children are three `panel` nodes `a`, `b`, `c` (no nested `tab`). After restore + `flush()`, `frameOf(dock, 'b')` is the same instance as before, not destroyed, and held by the restored `TabWindow`; `console.warn` was not called.
- **DS6 — a one-tab strip window.** `tw = stripWindow(dock, ['a'], 'a')`. After save, restore and `flush()`, `openWindowHolding(frameOf(dock, 'a'))` is a `TabWindow` and is not `tw`.
- **DS7 — a tiled lazy panel survives a restore.** `dock = panelDock(['a', 'b'], ['b'])`, no tear-off. Keep `frame = frameOf(dock, 'b')`. The saved root names panel `b` (no nested `tab`). After `setLayoutState` + `flush()`: `frame.isDestroyed()` is `false`, `frameOf(dock, 'b')` is `frame`, `rootTab(dock).indexOfContent(frame)` is not `-1`, and `console.warn` was not called.
- **DS8 — a bare float holding a split beside a strip window.** `dock = panelDock(['a', 'b', 'c', 'd', 'e'])`. Hand-build the state (geometry as `WINDOW_GEOMETRY`): root a `tab` node `[e]`; window 1 has no `windowMode` and `content` a `split` node (`orientation: 'horizontal'`, `ratios: [0.5, 0.5]`, `collapsed: [false, false]`) of two `tab` nodes `[a]` and `[b]`; window 2 has `windowMode: 'strip'` and `content` a `tab` node `[c, d]` with `activeIndex: 1`. After `setLayoutState` + `flush()`: `openWindowHolding(frameOf(dock, 'a'))` is a `Window` and not a `TabWindow`, and the same window holds `b`; `openWindowHolding(frameOf(dock, 'c'))` is a `TabWindow` holding `c`, `d` with `d` active.

### Manual

- **M1 — real-browser Save / Rearrange / Restore of a strip window.** See *Verification*. Needs real drags and painted windows.

---

## Verification

- `npm run typecheck` (repo root) and, from `packages/lib`, `npm run typecheck:test`.
- From `packages/lib`, one file at a time, never the whole suite (this machine has crashed under heavy test load):
  - `npx vitest run --maxWorkers=2 tests/component/layout/LayoutSerialization.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.lifecycle.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.panelPresentation.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.splitPanel.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.splitResize.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.closeDisposal.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.beforeClose.test.ts`
  - `npx vitest run --maxWorkers=2 tests/component/layout/Split.collapseUndisplay.test.ts`
  - `npx vitest run --maxWorkers=2 tests/unit/import-without-dom.test.ts` (the new `TabWindow` import in `LayoutSerialization.ts`).
- `npm run lint`.
- `npm run docs:api` finishes with zero warnings.
- **M1 (manual).** Start a dev server from the worktree on a free port (`npm run dev`); do not stop a server that is already running, it may serve another worktree. Open the Misc panel and click **Dockable layout (Dock)**. Drag **Explorer** off the strip (a tab-strip window opens). Drag **Search** and **Editor** onto that window's strip, then click **Search** in it. Click **Add async panel** and drag the new **Async** tab onto the same window. Click **Save layout**. Rearrange: drag **Explorer** back into the dock, move the window, close **Editor**. Click **Restore layout**. Expect: one tab-strip window (no title-bar header) at the saved place, holding Explorer, Search, Editor and Async in the saved order with Search active; the dock no longer shows Explorer; the console shows no `restoreLayout: no component` warning and no `[Dock] close:` line for those panels; focus stays on the Restore button. Then drag a tab off the restored window and back to confirm it still re-docks. Repeat once with a Shift-drag tear-off holding a split, and expect that float to come back as a header window.

---

## Documentation Impact

- **`packages/lib/docs/layouts/LayoutSerialization.md`**
  - Add `## Tab-strip windows` after `## Limiting the windows`: a [`TabWindow`](/api/overlay/classes/TabWindow) — the window a tab tear-off opens by default — is saved with `windowMode: "strip"` and a `content` `tab` node holding every tab in strip order with the active one, and is restored as a `TabWindow`. A window saved without `windowMode`, which includes every state saved before this release, restores as a header `Window`.
  - Add `## Panels that use a Split or Tab layout` after that: the walk descends into every `Split`- or `Tab`-managed component; pass `{ isPanel }` to keep one whole. A short fence: `const opts = { isPanel: (c: Component) => myPanels.has(c) }; serializeLayout(root, opts); restoreLayout(root, state, factory, opts);`. One sentence: `isPanel` is never asked about `root` or a window. One sentence: [`Dock`](/components/Dock) uses it for its panels, a lazy one of which carries a `Tab` of its own.
  - *How restore works*, step 3: "Rebuild the container tree from the target state" becomes "Rebuild the container tree and the windows from the target state — a `"strip"` window as a `TabWindow`".
  - Schema table, `WindowNode` row: append "and `windowMode` — `"strip"` for a `TabWindow`, omitted for a header `Window`."
  - The sentence after the table ("Containers the serializer does not recognise …"): append "A `Split`- or `Tab`-managed component is descended into unless `isPanel` marks it as a panel."
- **`packages/lib/docs/components/Dock.md`**, `## Saving and restoring`, after the paragraph "The state covers only this dock's own windows …": add "A tab-strip tear-off comes back as a tab-strip window with every tab, in the saved order, and the same active tab; a Shift-torn mini-dock comes back as a header window. A panel added with `addLazyPanel` is restored like any other."
- **`packages/lib/docs/reference/changelog/next.md`** — three bullets under headings that already exist; add no heading:
  - `## Added` → `### Layouts`, after the `{ includeWindow }` bullet: "**`LayoutSerializationOptions.isPanel`** marks a component whose own layout is a `Split` or `Tab` as one panel: `serializeLayout` records it by its id, and `restoreLayout` parks and re-homes it whole instead of descending into it. See [Panels that use a Split or Tab layout](/layouts/LayoutSerialization#panels-that-use-a-split-or-tab-layout)."
  - `## Fixed` → `### Layouts`, after the nested-splits bullet: "**`serializeLayout` records every tab of a `TabWindow`, and `restoreLayout` rebuilds it as one.** A tab-strip window was saved with its first tab only, as a plain window, and a restore left its other tabs inside the closed window. It is now saved as a `WindowNode` with `windowMode: \"strip\"` and a `tab` node of every tab, and restores as a `TabWindow` with the same active tab. A state saved before this release has no `windowMode` and restores as a `Window`, as before. See [Tab-strip windows](/layouts/LayoutSerialization#tab-strip-windows)."
  - `## Fixed` → `### Overlay`, after the *cover only the dock's own floats* bullet: "**`Dock.setLayoutState` keeps every panel of a tab-strip tear-off, and every lazy panel.** A tear-off holding several tabs came back as a header window with its first tab only; the dock emitted `close` for the others and lost them. A panel added with `addLazyPanel` was destroyed by a restore, which warned `restoreLayout: no component for panelId` for two unknown ids. Both now come back where they were saved. A state saved before this release still lacks those panels; save again to record them. No consumer action is needed. See [Saving and restoring](/components/Dock#saving-and-restoring)."
- No migration entry.[^no-migration]
- `packages/lib/llms.txt`: no change (it tracks classes; this adds two optional fields).

---

## Potential Challenges

- **`docs:api` warnings from the new JSDoc** — link `TabWindow` and `Window` with the markdown form the file already uses, never `{@link}` across modules; `TabDetachWindowMode` is exported, so `{@link TabDetachWindowMode}` resolves.
- **An import cycle through `TabWindow`** — `Tab.ts` already imports `TabWindow`, and `LayoutSerialization.ts` already imports `Tab`, so the module graph gains no new cycle; `import-without-dom.test.ts` confirms the entry points still load.
- **`createTab` in `stripWindow` leaves the source tab** — always follow `tw.createTab(frame)` with `source.removeMovedTab(frame)`, or the source region keeps a stale entry and the sweep re-selects a frame that left it.
- **rAF ordering in the Dock cases** — call `flush()` after every tear-off and every `setLayoutState`, as OW4 does.
- **Worktree tests need dependencies** — symlink the main tree's `node_modules` (root and `packages/lib`) into the worktree before running vitest.

---

## Critical Files

- [`LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) — `WindowNode` (L118), `LayoutSerializationOptions` (L173), `managerKind` (L195), `nodeFor` (L295), `windowContentOf` (L359), `windowNodeFor` (L370), `serializeLayout` (L400), `collectLeaves` (L428), `parkLeaves` (L470), `populateContainer` (L624, the tab branch `fillTab` is cut from), `applyWindow` (L690), `restoreLayout` (L761).
- [`TabWindow.ts`](../packages/lib/src/typescript/lib/overlay/TabWindow.ts) — constructor (L86, its own `Tab` with close-when-empty), `addContent` (L395, the `moveComponent`-then-`createTab` precedent), `isChromeComponent` (L408, every child is a tab).
- [`Tab.ts`](../packages/lib/src/typescript/lib/layout/Tab.ts) — `TabDetachWindowMode` (L91), `removeMovedTab` (L1309), `createTab` (L1787), `detachTabToWindow` (L2632, how a strip tear-off is built), `syncHostWindowCloseable` (L2755).
- [`Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) — `getLayoutState` / `setLayoutState` (L745, L770), `resolvePanel`'s lazy frame (L813), `subscribeFloatWindows` (L1277), `floatWindowsHoldingFrames` (L1357), `ownWindowOptions` (L1374, renamed), `isOwnWindowNode` (L1402), `ownedFloatWindows` (L1504), `wireRegion`'s identity-frame test (L1633, the `isPanel` precedent), `onFloatClosed` (L2187), `applyTabOptions` (L2692).
- [`tests/overlay/Dock.lifecycle.test.ts`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts) — `captureRaf`, `flush`, `mountDock`, `priv`, `frameOf`, `rootTab`; the own-windows `describe` (L2112) with `tearOff` and OW4.
- [`tests/component/layout/LayoutSerialization.test.ts`](../packages/lib/tests/component/layout/LayoutSerialization.test.ts) — `instanceFactory`, `tabHost`, `panels`, `L1` (L1024), the includeWindow `describe` (L1121).
- [`MiscPanel.ts:1253`](../packages/lib/src/typescript/MiscPanel.ts#L1253) — the *Dockable layout (Dock)* demo with Save / Restore and *Add async panel*.

---

## Non-Goals

- **Repairing states already saved with the old shape.** A state saved before this change holds only a strip window's first tab, and a lazy panel as a nested `tab` of internal ids. That information is gone; the user saves again.
- **Bumping `LayoutState.version`.** See [^no-version-bump].
- **Restoring the `TabWindow`'s leading `glyph` option.** A tear-off never sets it, so there is nothing to record.
- **Pruning the closed `TabWindow`'s stale tab entries.** Restore parks the tabs with `removeComponent`, as it does for a bare window's content; the closed window is never shown again.
- **The stale wording in `Dock.md`'s gesture table and the paragraph after it**, which say a tear-off lands in a header `Window` mini-dock. The default has been the tab-strip window for a while; that is a separate docs fix.
- **The plain functions' defaults.** Without `isPanel` the walk descends into every `Split`/`Tab`, as before; `LayoutSerializationPanel.ts` and other plain callers need no edit.

---

## Notes

[^probe]: Probes ran on `feature/dock-layout-own-windows` (f79a9b712) in a throwaway test file under `packages/lib/tests/overlay/`, deleted afterwards. The Dock setup: `mountDock()`-style dock with `a`–`d`; `a` torn off through `Tab.detachTabToWindow(…, forceBare: false)`; `b` and `c` moved in through the window `Tab`'s `dockComponent` plus the source's `removeEntryKeepingContent`. Saved state: `windows: [{ content: { kind: "panel", panelId: "a", … }, header: "C", … }]`. After `setLayoutState`: open windows `["Window:C"]`; frames `b`, `c` had the closed `TabWindow` as parent, were not destroyed, and were no longer in `_frames`; events `close:b, close:c, detach:a, attach:a`. Tiled lazy probe: `addLazyPanel` `b` beside `a`; saved root `tab [panel a, tab [panel <uuid>, panel <uuid>]]`; after restore the frame was destroyed and two `no component for panelId` warnings fired. Plain probe: `TabWindow` with `x`, `y`, active `y`; `serializeLayout` gave `content: panel x, header "y"`; after `restoreLayout`, one `Window`, `y` still parented to the closed `TabWindow`. A manual rebuild (`new TabWindow({ autoFocus: false })`, `moveComponent` with constraints, `Tab.createTab`, `setActiveTabIndex`, `applyRect`, `show`, `setAutoFocus(true)`) gave the right title, active tab, closeable state and rect.

[^kind-field]: The kind cannot be inferred from `content`. A Shift-torn bare `Window` is adopted by the dock as a mini-dock whose content is a one-tab `Tab` region, so it also saves a `tab` node (the probe's second save of the restored bare window recorded exactly `{ kind: "tab", children: [a] }`). A `tab` content therefore means "strip" for one window and "bare mini-dock" for another; only an explicit field tells them apart. "Absent means bare" is the only reading that keeps old states behaving as they did, because the old restore built a `Window` for every node.

[^why-mode-type]: `TabDetachWindowMode` is documented as "how a torn-off tab's floating window hosts its content", with `"strip"` and `"bare"` naming exactly the two window kinds. Reusing it gives the saved state the same words as `Tab.detachWindowMode` and `TabOptions`. A boolean `tabWindow` was considered and rejected: it adds a second vocabulary for the same choice. Writing the field only for `"strip"` keeps a bare window's saved node exactly as this stack writes it today, so stored states of apps that never tear off into strip windows do not change at all.

[^no-version-bump]: `version: 1` has stayed through every additive change to the schema: the `content` tree that replaced `panelId`, and `tooltip`, `closeable`, `disposeOnClose`, `italic`, `modified` on `PanelNode` (the `S2`/`S3` tests pin that old states without them still restore). `windowMode` is optional with a backward-compatible default, the same shape. The type is the literal `1`, so a bump would also be a breaking type change for consumers that type their stored states.

[^nodefor-tabwindow]: `TabWindow`'s children are exactly its tabs: `isChromeComponent` always returns `false`, and the probe saw `getComponents()` = `[a, b, c]` with no tool or resize children. `nodeFor`'s `Tab` branch reads `component.getLayoutManager() as Tab`, ranks children by `indexOfContent` (strip order after a drag reorder) and finds the active child by identity. All of that holds for a `TabWindow` unchanged.

[^forward-compat]: Older library code reading a new state ignores `windowMode` and passes `content` to its `materializeNode`, which builds a container with a `Tab` holding every tab and puts it in a header `Window`. Every tab comes back, in a header window. Saving a `panel` content (today's shape) would lose the other tabs for those readers.

[^why-filltab]: The `TabWindow`'s `Tab` cannot go through `populateContainer` as it stands, because `populateContainer` calls `container.setLayoutManager(new Tab(...))` and would replace the window's own manager (which carries close-when-empty and the control tools). `TabWindow.createTab` cannot be used directly either: it calls `moveComponent(content)` without constraints, and a parked leaf has lost its constraints, so `closeable`, `glyph` and `tooltip` would be dropped. Calling `win.moveComponent(built, undefined, constraintsFor(child))` first makes `createTab`'s own move a no-op (same parent, no index), which is what `fillTab` does through `tab.createTab`. `Tab.createTab` also calls `syncHostWindowCloseable`, so the window's close button follows the restored tabs (disabled when any tab is not closeable), as on a tear-off. `fillTab` runs before `show()`, so selecting the active tab cannot move focus into a window that is not in the document yet.

[^why-ispanel]: Without `isPanel`, capturing every tab breaks for a lazy panel: `nodeFor` would record the lazy frame's own `Tab` as a nested `tab` node of its spinner and content ids, and `collectLeaves` would offer those inner children for parking instead of the frame. The probe shows the frame is then disposed with the old scaffold — in the tiled tree today, and in a strip window once its tabs are captured. The serializer cannot tell a `Dock` frame from a real `Tab` region on its own: both are containers with a `Tab` manager, and only `Dock` knows its frames. Two other routes were rejected. A factory-based test ("a component the factory resolves to itself is a leaf") works for restore but not for `serializeLayout`, which has no factory. Changing the lazy frame to a non-`Tab` layout was rejected in `resolvePanel`'s own comment: a single-child `Fit` faults while the spinner and content overlap. The predicate is general: any application whose panel component uses a `Tab` or `Split` internally has the same problem. It is not asked about `root` (the restore target is never a leaf) or about a window (a window is never a leaf), so it is consulted only in `childNodeFor`, `collectLeaves`'s child loop and `parkLeaves`'s bare-window branch.

[^adoption-evidence]: Read from the code and pinned by DS3. `Dock.panelPresentation.test.ts` *is picked up by the TabWindow a tab tear-off creates later* already proves `subscribeFloatWindows` applies `_tabOptions` to a `TabWindow` on its first sweep. The sweep runs on the next animation frame, before that frame paints, so the default tab presentation is never visible. Before parking, restore detaches every frame from the old `TabWindow`, so when it is then closed, `onFloatClosed` finds no frames in it and emits no `close` — the fix for the probe's spurious `close:b, close:c`. `reconcileHosts` then sees each frame's host change from the old window to the new one and emits `detach` + `attach`, as it already does for a restored bare float (`detach:a, attach:a` in the probe).

[^no-migration]: Nothing a consumer wrote stops working. `windowMode` and `isPanel` are optional additions; old states restore exactly as before; a consumer that reads saved states and expects a strip window's `content` to be a `panel` node would only ever have seen the first tab, which was the bug.
