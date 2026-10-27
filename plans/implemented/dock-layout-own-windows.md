---
depends-on: [split-deferred-pane-ratios]
touches-shared:
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/src/typescript/lib/layout/index.ts
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/tests/component/layout/LayoutSerialization.test.ts
  - packages/lib/tests/overlay/Dock.lifecycle.test.ts
  - packages/lib/docs/components/Dock.md
  - packages/lib/docs/layouts/LayoutSerialization.md
  - packages/lib/docs/reference/changelog/next.md
---

# Dock Layout Own Windows — Implementation Plan

## Overview

[`serializeLayout`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L380) records every open window except one that hosts `root`. [`restoreLayout`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L722) parks the leaves of, and closes, every open window except a host of `root`. Both read the global `Window.getOpenWindows()` list. [`Dock.getLayoutState` / `setLayoutState`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L743) call them unchanged, so a dock's save captures windows it does not own and its restore closes them.

An auditor's probe, re-run for this plan:[^probe]

| Setup | `getLayoutState().windows` | After `setLayoutState(state)` |
|---|---|---|
| Dock in the page + `Window('Settings')` holding component `settings-form` | `["Settings"]` | no window open; warns `restoreLayout: no component for panelId "settings-form"` |
| Two docks; dock 1 tore `xa` off into a `TabWindow`, dock 2 tore `ya` off into a bare `Window` | dock 2 records both floats | dock 1's float is closed; warns for `"xa"` |

In the Loom editor, restoring a saved dock layout would close every other open window.

This plan gives `serializeLayout` and `restoreLayout` an optional options bag with an `includeWindow` predicate. Without it, both functions keep their documented whole-app behaviour. `Dock` passes a predicate that accepts only its own floats, and drops saved window nodes that name none of its panels before restoring.

---

## Architecture Decisions

### The predicate travels in a trailing optional options bag on the plain functions

`serializeLayout(root, options?)` and `restoreLayout(root, state, factory, options?)` take a new `LayoutSerializationOptions` interface with one optional field, `includeWindow`. This follows the library's free-function precedent, a trailing `options?: XOptions` argument: [`fadeShow(component, options?: FadeOptions)`](../packages/lib/src/typescript/lib/core/OverlayFade.ts#L52) and [`measureTextMetrics(text, options?: TextMeasureOptions)`](../packages/lib/src/typescript/lib/core/TextMeasure.ts#L586).[^why-option]

### A window that hosts `root` is never offered to `includeWindow`

Both functions find their windows through one new private helper, `floatWindows(root, options)`. It applies the existing host exclusion first and asks `includeWindow` only about the windows left. So the host rule holds whatever the predicate returns.

### Leaves are parked only from `root` and the included windows

`restoreLayout` already parks leaves only from the windows it is about to close (`liveWindows`). That list is now the filtered one. A leaf the factory knows that sits in an excluded window is not parked. If the state names it, the restore moves it out of that window through the factory, as it does any unparked leaf; otherwise it stays where it is.[^foreign-leaves]

### A dock owns the floats that hold one of its frames — `floatWindowsHoldingFrames`

An *identity frame* is the container `Dock` wraps each panel's content in; it carries the panel id and moves with the panel. `Dock` builds its predicate from the existing [`floatWindowsHoldingFrames`](../packages/lib/src/typescript/lib/overlay/Dock.ts#L1343): open windows holding one of this dock's identity frames, excluding the window the dock lives in. It covers both float kinds, the strip-mode `TabWindow` tear-off and the bare `Window` mini-dock. A new private method `ownWindowOptions()` takes that list once, as a `Set`, when it is called, and returns `{ includeWindow: win => own.has(win) }`.[^why-holding-frames]

How the rule sorts the edge cases:

| Open window | Owned by dock D? | Why |
|---|---|---|
| D's strip-mode `TabWindow` tear-off | yes | holds a D frame |
| D's bare `Window` float (Shift-tear) | yes | holds a D frame |
| The window D itself lives in | no | `floatWindowsHoldingFrames` excludes it, and `floatWindows` excludes it again as `root`'s host |
| An app `Window('Settings')` | no | holds no D frame |
| A float of a second dock E | no | holds only E frames |
| A float of a dock nested inside one of D's panels | no | holds only the inner dock's frames |
| D's float holding the panel that contains a nested dock | yes for D, no for the nested dock (it is that dock's host) | holds a D frame |
| A D float that holds no frame at this moment (emptied, about to close) | no | holds no D frame; its own auto-close removes it[^empty-float] |

### `setLayoutState` drops a saved window node that names none of the dock's panels, silently

A state saved before this change can hold window nodes for windows the dock never owned. `setLayoutState` passes `restoreLayout` a copy of the state whose `windows` keeps only the nodes that name at least one panel id registered in this dock (`_panels.has(id)`). The dropped nodes produce no warning, and the windows they describe are neither rebuilt nor closed.[^legacy-silent]

| Saved window node | Panels registered in the dock | Result |
|---|---|---|
| `content` tab `[a, b]` | `a`, `b` | kept, rebuilt |
| `content` tab `[a, gone]` | `a`, `b` | kept; `gone` warns once, as today |
| `content` panel `settings-form` (an app window) | `a`, `b` | dropped, no warning |
| `content` tab `[zz]` (another dock's float) | `a`, `b` | dropped, no warning, no empty window opened |
| `content` tab `[]` (an empty float, legacy) | `a`, `b` | dropped |
| legacy `panelId: "a"`, no `content` | `a`, `b` | kept, rebuilt |
| neither `content` nor `panelId` | `a`, `b` | dropped (the plain function would warn and skip it) |

`content` wins over `panelId` when both are present, matching [`applyWindow`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L655). The check reads the registry and never calls `resolvePanel`.[^no-resolve] The caller's `state` object is not mutated.

### The factory warning

After this change a fresh `Dock` save names only the dock's own panels, so `restoreLayout: no component for panelId` fires for a dock only when one of its own saved panels is no longer registered. That per-leaf warning is unchanged, in the tiled tree and in a kept float. The plain functions warn exactly as today.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/layout/LayoutSerialization.ts

/**
 * Options for {@link serializeLayout} and {@link restoreLayout}.
 *
 * @category Layouts
 */
export interface LayoutSerializationOptions {
    /**
     * Decides which open windows belong to the layout's floating-window plane.
     * Called once for each open window when the call starts, before anything is
     * parked or closed. A window that hosts `root` is never offered. Return
     * `true` to capture the window (`serializeLayout`), or to park its leaves and
     * close it (`restoreLayout`). Default: every open window except a host of
     * `root`.
     */
    includeWindow?: (win: AbstractWindow) => boolean;
}

export function serializeLayout(root: Component, options?: LayoutSerializationOptions): LayoutState;

export function restoreLayout(root: Component, state: LayoutState, factory: LayoutFactory, options?: LayoutSerializationOptions): void;
```

`packages/lib/src/typescript/lib/layout/index.ts` adds `LayoutSerializationOptions` to its existing `export type { … } from '~/layout/LayoutSerialization.js'` line.

`Dock.getLayoutState(): LayoutState` and `Dock.setLayoutState(state: LayoutState): this` keep their signatures; only their behaviour and JSDoc change. No state-bearing property is added.

---

## Internal Structure

`LayoutSerialization.ts` — new private helper, placed directly after `hostsComponent`:

```typescript
/**
 * The open windows that make up `root`'s floating-window plane: every open
 * window except one that hosts `root`, narrowed by `options.includeWindow`
 * when given. A host window is excluded before the predicate is asked.
 *
 * @param root - The layout root being serialized or restored.
 * @param options - The caller's options, if any.
 * @returns The float windows, in open order.
 */
function floatWindows(root: Component, options: LayoutSerializationOptions | undefined): AbstractWindow[] {
    const includeWindow = options?.includeWindow;

    return Window.getOpenWindows().filter(win =>
        !hostsComponent(win, root) && (includeWindow === undefined || includeWindow(win)));
}
```

`serializeLayout` replaces `Window.getOpenWindows().filter(win => !hostsComponent(win, root))` with `floatWindows(root, options)`. `restoreLayout` replaces its `liveWindows` initialiser the same way. Nothing else in either body changes.

`Dock.ts` — the two public methods:

```typescript
getLayoutState(): LayoutState {
    return serializeLayout(this.getRootRegion(), this.ownWindowOptions());
}

setLayoutState(state: LayoutState): this {
    this._frameRegion.clear();
    restoreLayout(
        this.getRootRegion(),
        this.withoutForeignWindows(state),
        (id: string) => this.resolvePanel(id),
        this.ownWindowOptions(),
    );
    this.scheduleSweep();

    return this;
}
```

`ownWindowOptions()` runs as an argument, so the owned set is taken before `restoreLayout` parks or closes anything.

`Dock.ts` — four new private methods, placed directly after `floatWindowsHoldingFrames`:

```typescript
private ownWindowOptions(): LayoutSerializationOptions {
    const own = new Set<AbstractWindow>(this.floatWindowsHoldingFrames());

    return { includeWindow: (win: AbstractWindow): boolean => own.has(win) };
}

private withoutForeignWindows(state: LayoutState): LayoutState {
    return { ...state, windows: state.windows.filter(node => this.isOwnWindowNode(node)) };
}

private isOwnWindowNode(node: WindowNode): boolean {
    if (node.content) {
        return this.holdsRegisteredPanel(node.content);
    }

    return node.panelId !== undefined && this._panels.has(node.panelId);
}

private holdsRegisteredPanel(node: LayoutNode): boolean {
    if (node.kind === "panel") {
        return this._panels.has(node.panelId);
    }

    return node.children.some(child => this.holdsRegisteredPanel(child));
}
```

Each gets a JSDoc per CODE_CONVENTIONS (description, `@param`, `@returns`). JSDoc on these private members may name `floatWindowsHoldingFrames` and `resolvePanel` in prose or `{@link}`; they are not rendered.

---

## Ordered Implementation Steps

Tests first: steps 1–2 write the cases from *Expected Behaviour*; they fail to compile or fail until steps 3–6 land.

1. **`packages/lib/tests/component/layout/LayoutSerialization.test.ts`** — add `describe('the includeWindow option', …)` directly after `describe('a window that hosts the root is not a float', …)` with cases LW1–LW6. Copy that block's `afterEach` (dispose open windows, `vi.restoreAllMocks()`, `DOM.reset()`). Import `type LayoutSerializationOptions` only if a case needs the type. Check: LW3, LW4 and LW6 fail now. LW1 and LW2 pin today's default and pass; LW5 also passes, because the runtime ignores the extra argument, and guards the host rule from here on.
2. **`packages/lib/tests/overlay/Dock.lifecycle.test.ts`** — add `describe("Dock layout state covers only the dock's own windows", …)` directly after `describe('Dock layout state of a dock inside a window', …)` with cases OW1–OW8. Reuse the file-level helpers `captureRaf`, `flush`, `mountDock`, `priv`, `frameOf`, `floatPanel`, `sourceTabEntryId`; the file's own `afterEach` already clears the window registry. Add inside the new `describe` two local helpers: `settingsWindow()` (a shown `Window('Settings')` holding a `Component` with id `settings-form`) and `tearOff(dock, id, bare)` (calls the source `Tab`'s private `detachTabToWindow(entryId, frame, 100, 100, bare)` exactly as the existing `TO1` test does, then `flush()`, and returns `AbstractWindow.getOpenWindows().at(-1)!`). Check: OW1, OW2, OW3, OW5, OW6 and OW7 fail now. OW4 and OW8 pass now and pin behaviour the change must keep.
3. **`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`** — add the `LayoutSerializationOptions` interface after the `LayoutFactory` type. Add `floatWindows` after `hostsComponent`. Give `serializeLayout` and `restoreLayout` the trailing `options?` parameter and route both through `floatWindows`. Update both JSDocs: add `@param options - …`; in `serializeLayout`'s description and in `restoreLayout`'s `@remarks` sentence "closes every open window except one that hosts `root`", add "or, with `includeWindow`, only the windows it accepts". Link `AbstractWindow` in the interface JSDoc with the file's markdown form, ``[`AbstractWindow`](/api/overlay/classes/AbstractWindow)``, not `{@link}` (cross-module). Check: LW1–LW6 pass.
4. **`packages/lib/src/typescript/lib/layout/index.ts`** — append `LayoutSerializationOptions` to the `export type { LayoutState, … LayoutFactory }` line. Check: `grep -n LayoutSerializationOptions packages/lib/src/typescript/lib/layout/index.ts` — one match.
5. **`packages/lib/src/typescript/lib/overlay/Dock.ts`** — extend the import on line 13 to `import { serializeLayout, restoreLayout, LayoutState, LayoutNode, WindowNode, LayoutSerializationOptions } from "~/layout/LayoutSerialization.js";`. Replace the bodies of `getLayoutState` and `setLayoutState` as in *Internal Structure*. Add `ownWindowOptions`, `withoutForeignWindows`, `isOwnWindowNode` and `holdsRegisteredPanel` after `floatWindowsHoldingFrames`.
6. **`Dock.ts` JSDoc** — `getLayoutState`: "Captures the current arrangement: the tiled tree and the floats that hold one of this dock's panels. Other open windows, including another dock's floats and the window this dock lives in, are not recorded." `setLayoutState`: add "Only this dock's own floats are closed and rebuilt; every other open window is left alone. A saved window that names none of this dock's registered panels — a state saved before the dock scoped its windows can hold one — is skipped without a warning." Keep the existing region-ledger paragraph. Check: OW1–OW8 pass; LW1–LW6 still pass.
7. **Run the regression files**, one at a time, from `packages/lib` (see *Verification*). The existing host-window cases (`H1`, `H2`, *Dock layout state of a dock inside a window*), `D6`, `L1` and *fires no moved for surviving panels on a setLayoutState restore* must stay green unchanged.
8. **Docs** — make the edits listed in *Documentation Impact*.
9. **Manual check** — the browser steps in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/index.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is offline-testable under `installTestDOM` unless marked **manual**. A probe confirmed a nested dock and both tear-off kinds work offline with the lifecycle file's `mountDock` + `flush` setup.[^probe]

### Plain functions — `describe('the includeWindow option')` in `LayoutSerialization.test.ts`

Setup unless stated, created in this order: `root` is a page-level `Container` with a `Tab` manager holding panel `a`; `settings` is a shown `Window('Settings')` holding a `Component` with id `settings-form`; `float` is a shown `Window('Float')` holding panel `b`. The factory is `instanceFactory({ a, b })`.

- **LW1 — default save is unchanged.** `serializeLayout(root).windows.map(w => w.header)` is `['Settings', 'Float']`.
- **LW2 — default restore is unchanged.** `restoreLayout(root, serializeLayout(root), instanceFactory({ a, b }))`: `settings` is no longer in `AbstractWindow.getOpenWindows()`, and `console.warn` was called once with a message containing `"settings-form"`.
- **LW3 — save keeps only accepted windows.** `serializeLayout(root, { includeWindow: w => w !== settings }).windows.map(w => w.header)` is `['Float']`.
- **LW4 — restore leaves an excluded window alone.** With the LW3 state and the same option: `settings` is still open, `settings-form`'s parent is still `settings`, `float` is closed, one new window titled `Float` holds `b`, and `console.warn` was not called.
- **LW5 — the host is never offered.** `root` lives in a shown `Window('Host')`, built inline the way the other block's `rootInWindow` builds it (that helper is local to its `describe`); no other window is open; `includeWindow` is a `vi.fn(() => true)`. `serializeLayout(root, { includeWindow }).windows` is `[]`, the spy was never called with the host, and after `restoreLayout(root, state, factory, { includeWindow })` the host is still the only open window.
- **LW6 — a factory-known leaf in an excluded window is not parked.** `Window('Other')` holds `b`; the state's root is a tab node `[a, b]` with `windows: []`; the factory knows `a` and `b`; `includeWindow: () => false`. After `restoreLayout`, `b`'s parent is `root`, `Other` is still open, and `console.warn` was not called.

### Dock — `describe("Dock layout state covers only the dock's own windows")` in `Dock.lifecycle.test.ts`

Setup unless stated: a `mountDock()` dock with panels `a` and `b`, laid out and flushed.

- **OW1 — the auditor's probe, save.** With `settingsWindow()` open, `dock.getLayoutState().windows` is `[]`.
- **OW2 — the auditor's probe, restore.** `dock.setLayoutState(dock.getLayoutState())`, then `flush()`: the Settings window is still in `AbstractWindow.getOpenWindows()`, `settings-form`'s parent is still that window, and `console.warn` was not called.
- **OW3 — an own bare float is still saved and rebuilt.** `floatPanel(dock, 'a')` plus `settingsWindow()`. The state has one window node and it names `a`. After `setLayoutState(state)` + `flush()`: Settings is open, the old float is not, a new window holds `frameOf(dock, 'a')`, and saving again gives one window node.
- **OW4 — a strip-mode `TabWindow` tear-off is owned.** `tearOff(dock, 'a', false)` returns a `TabWindow`. The state has one window node naming `a`. After restore + `flush()`, that `TabWindow` is no longer open and a new window holds frame `a`.
- **OW5 — two docks leave each other's floats alone.** Docks `d1` (panels `xa`, `xb`) and `d2` (`ya`, `yb`). `w1 = floatPanel(d1, 'xa')`, `w2 = tearOff(d2, 'ya', false)`. `d2.getLayoutState().windows` names only `ya`. After `d2.setLayoutState(…)` + `flush()`, `w1` is open and holds frame `xa`. Then after `d1.setLayoutState(d1.getLayoutState())` + `flush()`, frame `ya` is still in an open window. `console.warn` was never called.
- **OW6 — nested docks.** `inner` is a `mountDock()` dock with `ia`, `ib`; `outer` is a sized `Dock` with panels `outer` (content `inner`) and `o2`; both laid out and flushed. `fw = tearOff(inner, 'ia', true)`. `outer.getLayoutState().windows` is `[]`; after `outer.setLayoutState(…)` + `flush()`, `fw` is open and holds frame `ia`; `inner.getLayoutState().windows` names `ia`.
- **OW7 — a legacy state with foreign windows.** `settingsWindow()` open. `state` is `dock.getLayoutState()` with two nodes pushed onto `windows`: `{ kind: 'window', panelId: 'settings-form', header: 'Settings', … }` and `{ kind: 'window', content: { kind: 'tab', children: [{ kind: 'panel', panelId: 'zz' }], activeIndex: 0 }, header: 'Float', … }`. Each `…` is `rect: { x: 10, y: 10, width: 300, height: 200 }, state: 'normal', restoreRect: null`, as in the `L1` restore test. After `setLayoutState(state)` + `flush()`: `console.warn` was not called, the open windows are exactly `[settings]`, and `state.windows` still has length 2 (not mutated).
- **OW8 — an own float with a missing panel still warns.** A hand-built state: `root` is a tab node holding only panel `b`, and `windows` is one node (fields as in OW7) whose `content` is a tab `[a, gone]`. After `setLayoutState(state)` + `flush()`: `console.warn` was called once, with a message containing `"gone"`, and a new window holds frame `a`. The root names only `b` so that `a` is placed once.

No dedicated test covers a dock float that is empty at save or restore time: to the ownership rule it is the same as the Settings window, which OW1/OW2 cover.

### Manual

- **M1 — real-browser Save / Restore leaves other windows open.** See *Verification*. Needs a real browser: a real tear-off drag, Shift-tear and painted windows.

---

## Verification

- `npm run typecheck` (repo root) and, from `packages/lib`, `npm run typecheck:test`.
- From `packages/lib`, one file at a time, never the whole suite (this machine has crashed under full test load):
  - `npx vitest run --maxWorkers=2 tests/component/layout/LayoutSerialization.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.lifecycle.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.closeDisposal.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.splitResize.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.panelPresentation.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.beforeClose.test.ts`
  - `npx vitest run --maxWorkers=2 tests/overlay/Dock.splitPanel.test.ts`
  - `npx vitest run --maxWorkers=2 tests/component/layout/Split.collapseUndisplay.test.ts`
- `npm run lint`.
- `npm run docs:api` finishes with zero warnings.
- Grep: `grep -rn "getOpenWindows()" packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` — exactly one match, inside `floatWindows`.
- **M1 (manual).** Start the dev server (`npm run dev`) from the worktree on a free port; do not stop a server already running (it may serve another worktree). In the app, open the Misc panel and click **Dockable layout (Dock)** twice, giving two docks in two windows. Open one more unrelated demo window. In dock 1, drag one tab off (a `TabWindow`) and Shift-drag another off (a bare `Window` float). In dock 2, drag one tab off. Click dock 1's **Save layout**, move dock 1's floats, then click **Restore layout**. Expect: the unrelated window, dock 2's window and dock 2's float stay open and unchanged; dock 1's floats come back at their saved places; the console shows no `restoreLayout: no component` warning. Repeat Save / Restore in dock 2 and expect dock 1's floats untouched.

---

## Documentation Impact

- **`packages/lib/docs/layouts/LayoutSerialization.md`**
  - Add a section `## Limiting the windows` after `## Restoring — runtime layout switching` (before `## The state schema`). Content: by default both functions cover every open window except a host of `root`; pass `{ includeWindow }` to limit the floating-window plane to the windows a predicate accepts — it is asked once per open window when the call starts, never about the host. A short fence: `const mine = new Set(myFloats); serializeLayout(root, { includeWindow: w => mine.has(w) }); restoreLayout(root, state, factory, { includeWindow: w => mine.has(w) });`. One sentence on leaves: a leaf in an excluded window is not parked; when the state names it, the restore moves it into place through the factory. One sentence: `Dock` uses this to save and restore only its own floats.
  - Line 32 ("Open windows are gathered from …"): append "— or only the ones `includeWindow` accepts (see [Limiting the windows](#limiting-the-windows))."
  - Step 2 of *How restore works* (line 62): "close every open window except one that hosts `root`" becomes "close every open window except one that hosts `root` (only those `includeWindow` accepts, when given)".
  - *See also*: add [`LayoutSerializationOptions`](/api/layout/interfaces/LayoutSerializationOptions) beside the two function links.
- **`packages/lib/docs/components/Dock.md`**, `## Saving and restoring`: after the paragraph that ends "…sourcing each panel from the registry by `id`:" and its code fence, add a paragraph: the state covers only this dock's own windows — the floats that hold one of its panels, whether a tab-strip tear-off or a Shift-torn mini-dock. Other application windows, another dock's floats (including those of a dock nested in one of its panels) and the window the dock itself sits in are not recorded, and `setLayoutState` leaves them open. A saved window that names none of the dock's registered panels — which a state saved before this release can contain — is skipped without a warning.
- **`packages/lib/docs/reference/changelog/next.md`** — two bullets under headings that already exist; add no new heading:
  - Under `## Added` → `### Layouts`, after the `Tab.removeMovedTab` bullet: "**`serializeLayout` and `restoreLayout` take `{ includeWindow }`**, a predicate that limits the windows they capture, park and close to the ones it accepts. Without it both cover every open window except a host of the layout, as before. See [Limiting the windows](/layouts/LayoutSerialization#limiting-the-windows)."
  - Under `## Fixed` → `### Overlay`, after the *Disposing a `Dock`…* bullet: "**`Dock.getLayoutState` and `Dock.setLayoutState` cover only the dock's own floats.** A save recorded every open window — application windows, dialogs, another dock's floats — and a restore closed them all, warning `restoreLayout: no component for panelId` for each. Both now cover only the floats holding one of the dock's panels. A state saved before this release can still name other windows; a restore skips those without a warning and leaves the windows open. No consumer action is needed. See [Saving and restoring](/components/Dock#saving-and-restoring)."
- No migration entry: nothing a consumer wrote stops working.[^no-migration]
- `packages/lib/llms.txt` needs no change: its coverage check tracks classes, and this adds an interface.

---

## Potential Challenges

- **`docs:api` warnings from the new interface's JSDoc** — link `AbstractWindow` with the markdown form already used for `Window` in this file, and export the interface from `layout/index.ts` in the same change.
- **OW5/OW6 depend on rAF ordering** — call `flush()` after every tear-off and after every `setLayoutState`, as the existing `D6` test does.
- **A test window left open leaks into the next test** — the lifecycle file's `afterEach` clears the window registry; in `LayoutSerialization.test.ts` copy the `afterEach` of `describe('a window that hosts the root is not a float')`, which disposes every open window.
- **Worktree tests need dependencies** — symlink the main tree's `node_modules` (root and `packages/lib`) into the worktree before running vitest.

---

## Critical Files

- [`LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) — `serializeLayout` (L380), `parkLeaves` (L451), `hostsComponent` (L498), `materializeNode`'s warning (L563), `applyWindow` (L655), `restoreLayout` (L722).
- [`Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) — `getLayoutState` / `setLayoutState` (L743, L763), `resolvePanel` (L789), `floatWindowsHoldingFrames` (L1343, the precedent), `ownedFloatWindows` (L1430, the narrower list not to use), `windowContains` (L1450).
- [`OverlayFade.ts:52`](../packages/lib/src/typescript/lib/core/OverlayFade.ts#L52) — the trailing-options-bag precedent for free functions.
- [`tests/overlay/Dock.lifecycle.test.ts`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts) — helpers `captureRaf`, `flush`, `mountDock`, `floatPanel`, `sourceTabEntryId`; the `TO1` tear-off call; *Dock layout state of a dock inside a window*.
- [`tests/component/layout/LayoutSerialization.test.ts`](../packages/lib/tests/component/layout/LayoutSerialization.test.ts) — `instanceFactory`, `rootInWindow`, `H1` / `H2`.
- [`MiscPanel.ts:1253`](../packages/lib/src/typescript/MiscPanel.ts#L1253) — the *Dockable layout (Dock)* demo with Save / Restore buttons.

---

## Non-Goals

- **Changing the plain functions' default.** The user decided they keep whole-app behaviour. The other callers stay on the default and need no edit: `LayoutSerializationPanel.ts` (demo buttons), `Split.collapseUndisplay.test.ts`, and the existing `LayoutSerialization.test.ts` cases. No file under `packages/docs` or `packages/qa` calls either function, and Loom calls only the `Dock` methods.
- **Capturing every tab of a multi-tab `TabWindow`.** A pre-existing bug, separate from ownership: `windowContentOf` takes a `TabWindow`'s first frame as its whole content, so a strip-mode float with tabs `a` and `b` saves only `a`. On restore `b` is left inside the closed `TabWindow`.[^tabwindow-bug] Restore also rebuilds every float as a bare `Window`, never a `TabWindow`. Both need their own plan.
- **The stale *Panel identity* section of `LayoutSerialization.md`** (it says ids come from the constraint `name`; the code reads `getId()`). Unrelated to this change; left as is.

---

## Notes

[^probe]: Offline probes in a detached worktree at `24ac10f22`, file deleted afterwards. The Settings case reproduced the auditor's result exactly. In the two-dock case, `d2.setLayoutState(d2.getLayoutState())` closed `d1`'s `TabWindow` and warned `no component for panelId "xa"`. A second probe stubbed `AbstractWindow.getOpenWindows` to return only `floatWindowsHoldingFrames()` during the call, which is what this plan's predicate does. With it, a nested dock worked offline: the outer dock recorded no window, its restore kept the inner float open with its tabs, and the inner dock recorded its float. Tearing off the outer panel that holds the inner dock gave the outer dock one float, which the inner dock treated as its host and did not list.

[^why-option]: Scoping inside `Dock` alone is not possible. `serializeLayout` returns `WindowNode`s with no link back to the window objects, so `Dock` cannot filter its output reliably. On restore, the closing happens inside `restoreLayout` before `Dock` gets control back. A module-only export (exported from `LayoutSerialization.ts` but not from `layout/index.ts`) would work but would add a hidden second entry point. An app with two independent layout roots, each with its own floats, has the same need as `Dock`. A predicate rather than a window list keeps "open, and not the host" inside the functions, so a caller cannot pass a closed window or the host by mistake. ARCHITECTURE.md's options-bag rules govern component `XOptions`; for free functions the codebase's practice is the trailing optional bag cited above.

[^foreign-leaves]: The other choice was to keep parking from every window and close only the included ones. A parked leaf that the state does not name is removed from its window and never re-homed, so that choice would silently pull content out of a window the caller asked to leave alone. For `Dock` the case cannot arise: a window holding one of its frames is owned by definition, and the factory resolves only the dock's own frames. So the "parking leaves that live in foreign windows" edge case is empty for a dock.

[^why-holding-frames]: `Dock` has two lists. `ownedFloatWindows` (L1430) leaves out `TabWindow`s because the sweep does not adopt them into a region tree. Using it would leave a strip-mode tear-off (the default tear-off) open after a restore while the restore moved its frames into the rebuilt layout. `floatWindowsHoldingFrames` is the list the dock already uses for its float subscriptions, `focusPanel`'s float lookup and the frontmost-float focus fallback, so save and restore now agree with the rest of the dock about which floats are its own. The set is taken once per call because `restoreLayout` asks the predicate before it parks anything, and because a `Set` lookup avoids re-walking every frame's ancestors for every window.

[^empty-float]: A dock float holds no frame only briefly. A `TabWindow` closes itself when its last tab leaves (`setCloseHostWindowWhenEmpty(true)`). A bare float is closed by `Dock.pruneRegion` → `closeFloatIfEmpty` when its last region empties. Before this change, a save at that moment recorded the float with an empty content node, and restoring that opened an empty window. Now it is not recorded, and a restore does not race the float's own close by closing it a second time.

[^legacy-silent]: The four choices for a foreign node in an old state were: rebuild it, close the real window, warn, or skip silently. Rebuilding is wrong: the dock's factory cannot supply another owner's content, and the plain code opens an empty window for a region-tree node. Closing is the bug being fixed. A warning has nothing for the user to act on: the real window is still open and untouched, and nothing in the layout is lost. Loom persists its dock layout to disk, so a warning would repeat on every start until the next save, and the next save writes a clean state anyway. A dock's own float whose panel is gone still warns per leaf (OW8), so the useful signal stays.

[^no-resolve]: `resolvePanel` builds a panel's frame on first call and, for a lazy panel, starts its content factory. Using it as an ownership test would materialise panels the restore may not even place. `_panels.has(id)` is the same registry check `resolvePanel` makes first, without side effects.

[^no-migration]: The only behaviour a consumer loses is a dock restore closing windows it does not own, which is the bug. The plain functions' default is unchanged and the new parameter is optional.

[^tabwindow-bug]: Probe at `24ac10f22`: a strip-mode `TabWindow` holding frames `a` and `b` serialized as one window node whose `content` was panel `a`. After `setLayoutState`, the only open window was a bare `Window` holding `a`; frame `b` was undisposed, still parented to the closed `TabWindow`, and out of the dock. `windowContentOf` returns the first non-chrome child, and `TabWindow.isChromeComponent` returns `false` for every child, so for a `TabWindow` the "content" is its first tab.

---

## Implementation Notes

- **Changelog wording (Fixed → Overlay).** The plan's bullet listed "dialogs" among the windows a dock save recorded, and said the restore warned "for each". `Dialog` extends `Component`, not `AbstractWindow`, so it never appears in `getOpenWindows()` and was never recorded or closed. The shipped bullet drops "dialogs" and says the restore warned "for each panel it could not rebuild in them", which is what `materializeNode` does (one warning per unknown leaf, none for a window with no content).
- **Test helpers.** Beyond the plan's `settingsWindow()` and `tearOff()`, the Dock block adds local helpers `twoPanelDock(ids)`, `openWindowHolding(node)`, `panelIdsOf(node)`, `windowPanelIds(state)` and a `WINDOW_GEOMETRY` constant, and `settingsWindow()` returns `{ win, form }` so OW2 can check the form's parent. `tearOff` finds the source `Tab` through the dock's `regionForFrame` rather than `rootTab`, so it works for any region. The LW block shares its setup through a local `rootSettingsAndFloat()`. No assertion differs from *Expected Behaviour*.
- **Red/green as predicted.** Before the code change LW3, LW4, LW6 and OW1, OW2, OW3, OW5, OW6, OW7 failed; LW1, LW2, LW5, OW4 and OW8 passed.
- **Docs tests in the worktree.** `packages/docs` resolved `@jimka/typescript-ui` to the main tree's `packages/lib` through the symlinked root `node_modules`; a gitignored link `packages/docs/node_modules/@jimka/typescript-ui → ../../../lib` made it use this worktree's build.
- **M1 (manual), run in Chrome against a dev server on port 8033 started from this worktree.** Two *Dockable layout (Dock)* windows plus the *Show window with image!* window. Drags were driven by synthetic pointer and mouse events dispatched at `document.elementFromPoint` targets (the DevTools drag tool cannot hold Shift), not by a physical mouse; window moves, plain tear-offs and the Shift tear-off all took effect. Dock 1 tore *Explorer* off into a headerless `TabWindow` and Shift-tore *Editor* into a titled bare float; dock 2 tore *Search* off. Dock 1 **Save**, both floats moved, **Restore**: the two floats were replaced by new windows at their saved positions (300,800 and 700,1000); the image window, dock 2's window and dock 2's *Search* float were the same DOM nodes at unchanged positions. Dock 2 **Save**, its float moved, **Restore**: its float came back at (1300,150); dock 1's two floats, both dock windows and the image window were the same nodes, unmoved. The console had no warnings or errors throughout. As the plan's Non-Goals say, a restored strip tear-off comes back as a bare `Window`.
- **Audit fixes.** LW6's state names `b` in the root, so it passed whether or not a refused window's leaf was parked; LW7 adds the case where the state does not name it and checks `b` stays in its window, undisposed (it fails when `restoreLayout` parks from every non-host window). The code commit's message and the changelog bullet now say the old restore left the window hosting the dock open, the changelog states the legacy-state skip as Dock.md does (a saved window naming none of the dock's registered panels), and the `includeWindow` JSDoc says it is called for each open window that does not host `root`.
