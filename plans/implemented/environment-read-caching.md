---
depends-on: [w3-0-bounding-sweep]
touches-shared:
  - packages/lib/src/typescript/lib/core/Util.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/concepts/theming.md
  - packages/qa/README.md
  - packages/qa/src/panels/windows.ts
---

# Environment Read Caching — Implementation Plan

## Overview

The library reads two facts about its environment through the DOM seam far more often than they change. A **theme variable** is one of the `--ts-ui-*` CSS custom properties `ThemeManager.setTheme` writes on `:root`. Reading one (`DOM.source.getThemeVar`, [`core/DOM.ts:2448`](packages/lib/src/typescript/lib/core/DOM.ts#L2448)) resolves `:root`'s computed style, which recalculates the document's style whenever a write is pending. The **viewport size** (`DOM.source.getViewportSize`, [`core/DOM.ts:2453`](packages/lib/src/typescript/lib/core/DOM.ts#L2453)) reads `document.documentElement.clientWidth` and `clientHeight`, which force a document layout, for a value that `Math.max` then discards on every desktop engine. W3.0's `g08.env-reads` ablation memoised both reads and ran the minimized-window dock once per task. Environment reads fell 93–97% per `viewport` event on the `windows` panel (41 → 1 at n=8, 15 → 1 at n=4) and per dialog toggle, a `menus` toggle frame got 1.52 ms faster, and geometry was identical ([`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#g08--environment-reads)).

This plan ships that change in three parts:

1. A new framework-internal module, `core/ThemeVars.ts`, caches each theme variable until the next theme change. It sits above the seam, like [`core/BorderWidths.ts`](packages/lib/src/typescript/lib/core/BorderWidths.ts#L71). The four library call sites that read a variable directly move onto it. `Util.invalidateTextMetricsCache()` clears it; `ThemeManager` calls that on every theme change and every settled font batch.
2. `ProductionDOMSource.getViewportSize()` reads the window's inner size first, so no call forces a layout. The viewport gets no cache.
3. The **minimized dock** — the row of minimized windows `AbstractWindow.relayoutMinimizedStack` ([`overlay/AbstractWindow.ts:2775`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2775)) places along the viewport's bottom edge — answers a viewport `resize` through one listener of its own, as `Notification`'s toast stack does, instead of once per minimized window.

No public signature changes. Library paths below are relative to `packages/lib/src/typescript/lib/` unless they start with `packages/`.

---

## Architecture Decisions

### Theme variables are cached above the seam, in a module shaped like `BorderWidths.ts`

`core/ThemeVars.ts` keeps a module-level `Map` from variable name to the value `DOM.source.getThemeVar` returned. It exports a read function, a clear function and a test-only size, and is not exported from `core/index.ts`. This is `core/BorderWidths.ts`'s shape: a module-level cache over one seam read, with a clear the theme path calls. `Util`'s three per-theme variable caches (`linePaddingPx`, `rootFontSizePx`, `boundFontSizePx`, [`core/Util.ts:114`](packages/lib/src/typescript/lib/core/Util.ts#L114)) are the same idea, hand-written for three variables.[^above-seam]

### What reads through the cache

| Read | Call site | After this plan |
|---|---|---|
| A border side's `var(--name)` width, estimated before the element is attached | `Component.estimateBorderSideWidth`, `core/Component.ts:4107` | `readThemeVar` |
| The dock's slot width, `--ts-ui-window-min-dock-width` | `AbstractWindow.getMinDockWidth`, `overlay/AbstractWindow.ts:2741` | `readThemeVar` |
| A `Text`'s bound line-height variable | `Text.readThemeLineHeightPx`, `component/input/Text.ts:341` | `readThemeVar` |
| A spinner's `--ts-ui-font-size` | `readThemeFontSizePx`, `component/display/ProgressSpinner.ts:67` | `readThemeVar` |
| `--ts-ui-line-padding`, `--ts-ui-font-size`, a bound font-size variable | `core/Util.ts:119`, `:141`, `:326` | unchanged: already read once per theme |
| `--ts-ui-font-family`, `--ts-ui-font-size` for the canvas font metrics | `ProductionDOMSource.measureFontMetrics`, `core/DOM.ts:2433` | unchanged: inside the seam, reached only through `Util`'s per-theme cache |

After the change, `DOM.source.getThemeVar(` appears in library source only in `core/ThemeVars.ts` and the three `Util` readers.

### The cache is cleared with the text metrics, and when the installed source changes

`Util.invalidateTextMetricsCache()` ([`core/Util.ts:346`](packages/lib/src/typescript/lib/core/Util.ts#L346)) calls `clearThemeVars()`. `ThemeManager.reflowText` ([`core/Theme.ts:1495`](packages/lib/src/typescript/lib/core/Theme.ts#L1495)) runs it after `setTheme` has written the variables and before the first theme listener runs, and again after each settled font batch. The cache also records the `DOM.source` object it read from, and a read through a different object starts from empty. That covers `DOM.install`, `DOM.reset()` and every `installTestDOM`.[^clear-points]

### When each read is refreshed

A cached theme variable is read again only after one of the rows marked *cleared*. The viewport is never cached. While it holds a docked window (defined below), the dock re-anchors once per `resize` event.

| Event | Theme-variable cache | Viewport read | Minimized dock |
|---|---|---|---|
| A real viewport resize | kept | live: the new size | re-anchored once |
| The QA harness's synthetic `resize` at an unchanged size | kept | live: the same size | re-anchored once, to the same rectangles |
| Browser zoom (fires `resize`) | kept | live, in CSS pixels | re-anchored once |
| A device-pixel-ratio change | kept | live; the CSS-pixel size does not change | — |
| `ThemeManager.setTheme` — a theme switch, or a variable changed at runtime | **cleared**, before any theme listener | — | unchanged: the next relayout reads the new slot width, as today |
| A settled web-font batch | **cleared** | — | — |
| `Util.invalidateTextMetricsCache()` called directly | **cleared** | — | — |
| A `--ts-ui-*` variable changed on `:root` any other way | kept: not seen until one of the three rows above | — | — |
| `DOM.install`, `DOM.reset()`, `installTestDOM` | **cleared** at the next read | answered by the new source | — |

`ThemeManager` has no way to change one variable at runtime except `setTheme` with a new theme, so "a runtime variable change" is the `setTheme` row.[^zoom-dpr]

### The viewport read stops forcing layout, and is not cached

`ProductionDOMSource.getViewportSize()` returns `window.innerWidth || document.documentElement.clientWidth`, and the same for the height. `innerWidth` includes a classic scrollbar, so on a desktop engine it is never smaller than `clientWidth` and was already the value `Math.max` returned. Reading it lays nothing out. A viewport read then costs two property reads, so the plan adds no viewport cache.[^no-viewport-cache]

| `innerWidth` | root `clientWidth` | Before (`Math.max`) | After | Why |
|---|---|---|---|---|
| 1280 | 1265 (a 15 px scrollbar) | 1280 | 1280 | the inner size wins either way |
| 1280 | 1280 | 1280 | 1280 | no scrollbar |
| 0 (no view yet) | 1024 | 1024 | 1024 | the fallback |
| 390 (a pinch-zoomed phone) | 980 | 980 | 390 | the only case that changes: a mobile visual viewport |

### The minimized dock answers a resize through one listener of its own

A **docked window** is a minimized window with no `Rail`, the kind the dock places along the bottom edge. The dock gets one viewport `resize` listener, registered against a static sentinel `Component`, as `Notification` does for its toasts ([`overlay/Notification.ts:112-120`](packages/lib/src/typescript/lib/overlay/Notification.ts#L112), [`:637-667`](packages/lib/src/typescript/lib/overlay/Notification.ts#L637)). `relayoutMinimizedStack` installs it when it has placed at least one docked window and removes it when it has placed none. A minimized window's own `onViewportResize` no longer relays out the dock, and a docked window no longer re-attaches a listener of its own. Inside the relayout, the viewport and the slot width are read once, not once per window.[^stack-listener]

### A disposed window leaves `openWindows`

`AbstractWindow`'s destructor removes the window from the static `openWindows` set and re-anchors the dock if the window was in it, as `Notification`'s destructor does for its own static list ([`overlay/Notification.ts:712-733`](packages/lib/src/typescript/lib/overlay/Notification.ts#L712)). Without this, a window disposed without being closed would be positioned through a released element handle by the dock's listener on the next resize.[^dispose]

### Where the fix follows the ablation, and where it differs

| Aspect | `g08.env-reads` (W3.0) | This plan |
|---|---|---|
| Theme variables: where | patches `DOM.source.getThemeVar` | `core/ThemeVars.ts` above the seam; seam counters and offline tests see the saving |
| Theme variables: cleared by | any `DOM.sink.apply` to the root element | `Util.invalidateTextMetricsCache()` (every `setTheme`, every font batch) and a change of installed source |
| Theme variables: memory | one `Map` entry per name read | same: bounded by the variable names library code and consumers' border specs use |
| Viewport | memoised per task; the first read of each task still forced a layout | never forces a layout; no memo |
| Minimized dock | the static relayout skipped on a repeat within one task | one listener for the dock: once per `resize` event, with no microtask state |
| Reads inside the relayout | one viewport and one slot-width read per window | one of each per relayout |
| Disposed windows | not handled | removed from `openWindows` |

The ablation could ignore test teardown, font batches and the dispose path; a shipped fix cannot. The other two differences — where the cache sits, and how the viewport is read — make the saving visible to the counters and remove the forced layout the memo still paid.[^ablation-diff]

### Scope within G08

**In:** everything the ablation bounded — theme variables, the viewport read, the dock's per-window relayout (F09.6). The four sub-items W3.0 left unbounded are **out**, each for the reason given:

| Sub-item | Belongs here? | Reason |
|---|---|---|
| F09.1, `AbstractWindow.show()` lays the window out before mounting it | no | The cache absorbs its cost: a detached window show reads each variable once per theme instead of over a hundred times. What is left is which border widths the first pass uses — an ordering question with no read cost, for slice 09's window-open plan. |
| F17.4, the calendar dropdown's two detached passes | no | Its reads go through the same border estimate and are absorbed. What is left is the doubled layout pass, slice 17's. |
| `DialogBackdrop`'s `inset: 0` (F09.8) | no | After the reorder its per-resize read forces nothing. What is left is a geometry-write change that needs a typed `inset` setter and touches `Drawer`; it belongs with F09.7 in a dialog-resize plan. |
| `TextField.setBorder`'s gate move (F15.6a) | no | The four discarded reads become cache hits. What is left is arithmetic, not an environment read. |

The group's other items need no work of their own. X10's pre-connect border estimate no longer reads the DOM, since its reads go through the cache; caching the estimate itself is a non-goal. The repeat viewport reads of F09.7, F12.3's viewport half and F16.12 no longer force a layout.[^scope]

### A `min0` geometry label gives the in-engine gate sight of the dock

The QA `windows` panel labels no minimized window, so the geometry gate could not see the dock in W3.0. The panel gains `min0`, the first docked window (dock slot 0), whenever it minimizes at least one.[^min0]

---

## Internal Structure

### `core/ThemeVars.ts` (new)

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal cache over `DOM.source.getThemeVar`. In the browser a
// theme-variable read resolves `:root`'s computed style, which recalculates
// the document's style whenever a write is pending — once per border side per
// layout step for a component laid out before it is attached, and once per
// minimized window per viewport resize for the dock's slot width. Every
// `--ts-ui-*` variable is written inline on `:root` by `ThemeManager.setTheme`
// and by nothing else, so a value read once stays correct until the next theme
// change. Not exported from `core/index.ts` — mirrors `core/BorderWidths.ts`,
// which caches a seam read the same way. See
// plans/implemented/environment-read-caching.md.

import { DOM, type DOMSource } from "~/core/DOM.js";

// Variable name -> the value the seam returned: trimmed, "" when unset.
// Cleared by `clearThemeVars`, which `Util.invalidateTextMetricsCache` calls
// on every theme change and every settled font batch.
const _values: Map<string, string> = new Map();

// The source `_values` was read from. A read through any other installed
// source starts from empty, so `installTestDOM`, `DOM.install` and
// `DOM.reset()` never leave a value read from the previous source.
let _source: DOMSource | null = null;

/**
 * Returns a theme CSS variable's value, reading it through the DOM seam only
 * the first time it is asked for under the active theme and installed source.
 *
 * @param name - The custom-property name, including the leading `--`.
 *
 * @returns The value, trimmed; `""` when the variable is unset.
 */
export function readThemeVar(name: string): string {
    if (_source !== DOM.source) {
        _values.clear();
        _source = DOM.source;
    }

    let value = _values.get(name);

    if (value === undefined) {
        value = DOM.source.getThemeVar(name);
        _values.set(name, value);
    }

    return value;
}

/** Drops every cached value. Called by `Util.invalidateTextMetricsCache`. @internal */
export function clearThemeVars(): void {
    _values.clear();
}

/** Number of cached variables; for tests only. @internal */
export function _themeVarCacheSize(): number {
    return _values.size;
}
```

### `core/Util.ts`

`invalidateTextMetricsCache` gains one call, after `boundFontSizeCache.clear()`:

```typescript
        boundFontSizeCache.clear();
        clearThemeVars();
        metricsGeneration++;
```

Its JSDoc becomes: *Discards every cached text metric (line box, baseline, optical offset, bound font sizes) and every cached theme variable, so the next read re-measures against the active theme font and re-reads the variable.* The `@remarks` gains a second sentence: *Call it also after changing a `--ts-ui-*` variable on `:root` by any means other than `ThemeManager.setTheme`, which calls it itself.* Import `clearThemeVars` from `~/core/ThemeVars.js`.

### `core/DOM.ts`

```typescript
    /** @inheritDoc */
    getViewportSize(): Size {
        // `innerWidth` includes a classic scrollbar, so on a desktop engine it
        // is never smaller than the root's `clientWidth` — the value the old
        // `Math.max` of the two always returned — and reading it lays nothing
        // out, where `clientWidth` forces a document layout. The root's client
        // size is read only where the window reports 0 (no view yet).
        const width  = window.innerWidth  || document.documentElement.clientWidth;
        const height = window.innerHeight || document.documentElement.clientHeight;

        return { width, height };
    }
```

The `DOMSource.getViewportSize` JSDoc ([`core/DOM.ts:1184-1189`](packages/lib/src/typescript/lib/core/DOM.ts#L1184)) becomes: *Returns the current viewport size in pixels: the window's inner size, which includes a classic scrollbar. Reading it forces no layout.*

### `overlay/AbstractWindow.ts`

**Static fields**, after `openWindows` (`:352`):

```typescript
    // Owner for the minimized dock's single viewport `resize` listener.
    // `Event.addViewportListener` binds a listener to a `Component`, but the
    // handler is static — one for the whole dock, not one per docked window —
    // so a single stable sentinel owns it, mirroring `Notification`'s
    // `resizeListenerOwner`. `relayoutMinimizedStack`, which runs after every
    // change to the set of minimized windows, installs and removes it.
    private static readonly stackResizeListenerOwner: Component = new Component();
    private static stackResizeListenerInstalled: boolean = false;
```

**The dock's handler and its install pair**, placed directly after `relayoutMinimizedStack`:

```typescript
    /**
     * Viewport `resize` handler for the minimized dock: re-anchors every
     * minimized window to the viewport's bottom edge, once per event.
     */
    private static onStackViewportResize(): void {
        AbstractWindow.relayoutMinimizedStack();
    }

    /** Installs the dock's viewport `resize` listener, if it is not already installed. */
    private static installStackResizeListener(): void {
        if (AbstractWindow.stackResizeListenerInstalled) {
            return;
        }

        Event.addViewportListener(AbstractWindow.stackResizeListenerOwner, "resize", AbstractWindow.onStackViewportResize);

        AbstractWindow.stackResizeListenerInstalled = true;
    }

    /** Removes the dock's viewport `resize` listener, if it is installed. */
    private static uninstallStackResizeListener(): void {
        if (!AbstractWindow.stackResizeListenerInstalled) {
            return;
        }

        Event.removeViewportListener(AbstractWindow.stackResizeListenerOwner, "resize", AbstractWindow.onStackViewportResize);

        AbstractWindow.stackResizeListenerInstalled = false;
    }
```

**`relayoutMinimizedStack`** keeps its name and its per-window writes; the reads move out of the loop and the listener follows the count of docked windows:

```typescript
    /**
     * Re-positions every minimized window into a gap-free row along the bottom
     * of the viewport. Runs after any change to the open/minimized set, and on
     * every viewport `resize` through the dock's own listener, which it
     * installs while the row holds a docked window and removes once it holds
     * none.
     */
    private static relayoutMinimizedStack(): void {
        let index          = 0;
        let docked         = 0;
        let dockWidth      = 0;
        let viewportHeight = 0;

        for (const win of AbstractWindow.openWindows) {
            if (win.getWindowState() !== "minimized") {
                continue;
            }

            // Read once per relayout, not per window: neither can change
            // between two windows of the same row.
            if (index === 0) {
                dockWidth      = win.getMinDockWidth();
                viewportHeight = DOM.source.getViewportSize().height;
            }

            const headerHeight = win.chromeHeight() || CHROME_HEIGHT_FLOOR_PX;
            const x = index * (dockWidth + SNAP_DOCK_GAP_PX);
            const y = viewportHeight - headerHeight;

            win.setAutoCommitStyle(false);
            win.setX(x);
            win.setY(y);
            win.setWidth(dockWidth);
            win.setHeight(headerHeight);
            win.doLayout();
            win.setAutoCommitStyle(true);

            index++;

            if (win._rail === null) {
                docked++;
            }
        }

        if (docked > 0) {
            AbstractWindow.installStackResizeListener();
        } else {
            AbstractWindow.uninstallStackResizeListener();
        }
    }
```

**`onViewportResize`** (`:3052`): the minimized branch returns without relaying out the dock, and the maximized branch loses its trailing `AbstractWindow.relayoutMinimizedStack()` call (`:3076`):

```typescript
    private onViewportResize(): void {
        const state = this.getWindowState();

        // A minimized window is placed by the dock's own listener.
        if (state === "minimized") {
            return;
        }

        if (state === "normal") {
            this.fitNormalWindowToViewport();

            return;
        }

        const rect = this.computeMaximizeRect();
        this.setAutoCommitStyle(false);
        this.setX(rect.x);
        this.setY(rect.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
        this.doLayout();
        this.setAutoCommitStyle(true);
    }
```

**`destructor`** (`:1110`) gains, as its first statement:

```typescript
        // `openWindows` outlives every teardown, and the dock writes
        // setX/setY to each minimized entry — so a window disposed without
        // being closed must leave the set here, as Notification's destructor
        // does for its toasts, and the dock closes the gap it leaves.
        if (AbstractWindow.openWindows.delete(this)) {
            AbstractWindow.relayoutMinimizedStack();
        }
```

---

## Ordered Implementation Steps

1. **Write `packages/lib/tests/core/ThemeVars.test.ts`** with cases T1–T12 of *Expected Behaviour*. Run `npx vitest run tests/core/ThemeVars.test.ts` from `packages/lib`: it fails, because the module does not exist.
2. **Create `core/ThemeVars.ts`** exactly as in *Internal Structure*. Check: T1–T3 and T9 pass.
3. **`core/Util.ts`**: import `clearThemeVars` from `~/core/ThemeVars.js`, call it in `invalidateTextMetricsCache` after `boundFontSizeCache.clear()`, and update that function's JSDoc as in *Internal Structure*. Check: T4–T8 pass.
4. **Route the four call sites** onto `readThemeVar`, importing it from `~/core/ThemeVars.js` in each file:
   - `core/Component.ts:4107`: `const resolved = readThemeVar(varName);`
   - `overlay/AbstractWindow.ts:2741`: `const cssVar = readThemeVar("--ts-ui-window-min-dock-width");`
   - `component/input/Text.ts:341`: `const raw = readThemeVar(this._lineHeightCSSVar);`
   - `component/display/ProgressSpinner.ts:67`: `const raw = readThemeVar("--ts-ui-font-size");` — keep the `DOM` import, which `:249` still uses.

   Check: `grep -rn "DOM.source.getThemeVar(" packages/lib/src` prints exactly four lines — `core/ThemeVars.ts` once and `core/Util.ts` three times. T10–T12 pass.
5. **Write `packages/lib/tests/dom/viewport-size.test.ts`** (cases V1–V3, `// @vitest-environment jsdom`). V1 fails: the root's client size is read twice. Then change `ProductionDOMSource.getViewportSize` and the `DOMSource.getViewportSize` JSDoc in `core/DOM.ts` as in *Internal Structure*. Check: V1–V3 pass; `grep -n "Math.max(document.documentElement.client" packages/lib/src/typescript/lib/core/DOM.ts` prints nothing.
6. **Rewrite `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`** (cases W1–W9) **and create `packages/lib/tests/overlay/AbstractWindow.minimizedStackResize.test.ts`** (case S1, the only case in its file). Both fail.
7. **`overlay/AbstractWindow.ts`**, in this order:
   1. Add the two static fields after `openWindows` (`:352`).
   2. Replace `relayoutMinimizedStack`'s JSDoc and body (`:2771-2796`) and add `onStackViewportResize`, `installStackResizeListener` and `uninstallStackResizeListener` after it.
   3. In the docked branch of `setWindowState`, the `animateRect` completion (`:1302-1306`) loses `this.attachViewportResizeListener();` and keeps `this.setBodyHostDisplayed(false);` and `AbstractWindow.relayoutMinimizedStack();`.
   4. Replace the comment above `this.attachViewportResizeListener();` in the `"normal"` branch (`:1257-1260`) with: *Neither a docked nor a rail-minimized window keeps its own resize listener — the dock answers resizes for the docked ones through its own — so re-attach it here, and the restored window resumes tracking viewport resizes.*
   5. Replace `onViewportResize` (`:3052-3077`) as in *Internal Structure*. Its JSDoc (`:3044-3051`) drops the clause about re-anchoring the minimized stack. `attachViewportResizeListener`'s JSDoc (`:3017-3022`) drops the same clause and ends *Bound from `show`, and dropped while the window is minimized; idempotent.*
   6. Add the `openWindows` removal as the destructor's first statement (`:1110`).

   Check: W1–W9 and S1 pass; `grep -n "attachViewportResizeListener();" packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` prints three lines (`show`, the `"normal"` branch, the maximize completion).
8. **Run the whole suite**: `npm test`. No other test should change. In particular `tests/component/input/TextThemeReflow.test.ts` ("re-resolves the bound font size exactly once") reads through `Util`, which this plan does not route, and `tests/component/input/single-line-width-preservation.test.ts` calls `setTheme` after mocking `getThemeVar`, which clears the cache. A failure elsewhere means a read the test expects live is now cached: report it rather than loosening the assertion.
9. **QA panel** `packages/qa/src/panels/windows.ts`:
   - `geometry` (`:216`) gains `min0`, only when a window is minimized: `geometry: { win0: windows[0], bare, pinned, southStrip: southStrip.target, header0: windows[0].getHeader(), ...(minimized > 0 ? { min0: windows[n - minimized] } : {}) },`
   - In `description` (`:63`), replace the F09.6 clause with: `F09.6 (fixed: the minimized dock re-anchors once per resize event): getViewportSize one per open window plus one each for the dock, Body and the toast per viewport unit, and getThemeVar 0;`
10. **QA README** `packages/qa/README.md`, the `windows` row (`:333`). The labels column gains `` `min0` (the first docked window, when one is minimized) ``. In the reproduction column, the sentence beginning "M22, F09.6" becomes:

    > M22, F09.6 (fixed): `viewport` with `seam=1` gives `seam.source.getViewportSize` one per open window plus one each for the dock, `Body` and the toast — 10 at the default `n=8` — and `getThemeVar` 0; before the fix it was at least 16 (`before.host.minimized`²).

    Leave the *Validated* column as it is.
11. **Docs**: the entries of *Documentation Impact*.
12. **Verify**: every step of *Verification* except the in-engine A/B.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ThemeVars.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Util.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/ProgressSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Create | `packages/lib/tests/core/ThemeVars.test.ts` |
| Create | `packages/lib/tests/dom/viewport-size.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.minimizedStackResize.test.ts` |
| Modify | `packages/qa/src/panels/windows.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |

---

## Expected Behaviour

### `tests/core/ThemeVars.test.ts` — unit, node (modelled DOM)

Setup, in `beforeEach`: build a fresh config object `CONFIG` whose `themeVars` include `'--ts-ui-test-width': '3px'`, `'--ts-ui-test-border': '2px solid red'` and `'--ts-ui-input-border': '1px solid #ccc'` (T4 mutates it), `installTestDOM(CONFIG)`, then `spy = vi.spyOn(DOM.source, 'getThemeVar')` (pass-through). Reads are counted from the spy's installation, so a case's count includes construction. `afterEach`: `vi.restoreAllMocks()`, `ThemeManager.setTheme(ModernTheme)`, `DOM.reset()` — the order `tests/core/BorderWidths.test.ts` uses. "Reads of X" below means `spy` calls whose argument is X.

| # | Steps | Expected |
|---|---|---|
| T1 | `readThemeVar('--ts-ui-test-width')` twice | both `'3px'`; 1 read |
| T2 | `readThemeVar('--ts-ui-test-unset')` twice | both `''`; 1 read — an unset variable is cached too |
| T3 | `readThemeVar` of two different names | 2 reads |
| T4 | read `--ts-ui-test-width`; set `CONFIG.themeVars['--ts-ui-test-width'] = '5px'`; read again | `'3px'` both times; 1 read — a change outside `setTheme` is not seen |
| T5 | T4, then `ThemeManager.setTheme(ModernTheme)`, then read | `'5px'`; 2 reads |
| T6 | read; `Util.invalidateTextMetricsCache()`; read | 2 reads |
| T7 | read; `DOM.install({ source: Object.create(DOM.source, { getThemeVar: { value: () => '9px' } }) })`; read | second read returns `'9px'` |
| T8 | read; `DOM.reset()`; `installTestDOM` with `'--ts-ui-test-width': '7px'`; read | `'7px'` |
| T9 | read two names; `clearThemeVars()` | `_themeVarCacheSize()` is 0 |
| T10 | a `Panel` with a `VBox` layout holding three plain `Component`s; all four `setBorder('var(--ts-ui-test-border)')`; never rendered, so every element is detached; `panel.doLayout()` | reads of `--ts-ui-test-border`: exactly 1; every one of the four `getBorderSize()` returns 2 on each side |
| T11 | `new TextField()` twice | reads of `--ts-ui-input-border`: exactly 1 across both (today 8 per construction) |
| T12 | with `DOM.sink.requestAnimationFrame` and `globalThis.setTimeout` mocked to return 0 (as `AbstractWindow.minimizedViewportResize.test.ts` does), `new Window('A').show()` then `new Window('B').show()` | reads of `--ts-ui-window-control-border`: at most 1 across both (today over a hundred per show) |

### `tests/dom/viewport-size.test.ts` — unit, jsdom (production source)

Each case sets `window.innerWidth` / `innerHeight` with `Object.defineProperty(window, …, { configurable: true, value })`, and defines `clientWidth` / `clientHeight` as configurable counting getters directly on `document.documentElement`. `beforeEach` saves `window`'s two original descriptors (`Object.getOwnPropertyDescriptor`), and `afterEach` restores them and deletes the two own properties from `document.documentElement`, whose originals live on `Element.prototype`.

| # | `innerWidth`, `innerHeight` | root `clientWidth`, `clientHeight` | `DOM.source.getViewportSize()` | Root client reads |
|---|---|---|---|---|
| V1 | 1280, 800 | 1265, 785 | `{ width: 1280, height: 800 }` | 0 |
| V2 | 0, 0 | 1265, 785 | `{ width: 1265, height: 785 }` | 2 |
| V3 | 1280, 0 | 1265, 785 | `{ width: 1280, height: 785 }` | 1 (`clientHeight` only) |

### `tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` — unit, node (rewritten)

`beforeEach` keeps the file's config, `installTestDOM` and the `requestAnimationFrame` / `setTimeout` mocks, and adds the reduced-motion mock `tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts:43` uses — `vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} })` — so every state change commits synchronously. `afterEach`: clear `openWindows`, then call `relayoutMinimizedStack()` once so the dock's listener is removed, then `vi.restoreAllMocks()` and `DOM.reset()`.

The helper `resizeViewport(height)` sets `config.viewport.height` and calls `(AbstractWindow as unknown as { onStackViewportResize(): void }).onStackViewportResize()`. "The flag" is `(AbstractWindow as unknown as { stackResizeListenerInstalled: boolean }).stackResizeListenerInstalled`, and "the relayout spy" is `vi.spyOn(AbstractWindow as unknown as { relayoutMinimizedStack(): void }, 'relayoutMinimizedStack')`.

| # | Steps | Expected |
|---|---|---|
| W1 | show and minimize one window; `resizeViewport(800)`; note `y1`; `resizeViewport(500)` | `getY()` is `y1 - 300` (the file's existing assertion) |
| W2 | before any minimize; after minimizing one shown window; after `setWindowState('normal')` on it | the flag reads `false`, `true`, `false` |
| W3 | minimize two shown windows; restore one; close the other with `onExitAction()` | the flag reads `true` after the restore and `false` after the close |
| W4 | minimize a shown window; restore it | its `_viewportResizeBound` reads `false` while minimized and `true` after the restore |
| W5 | minimize a shown window; install the relayout spy; call its own `onViewportResize()` | the relayout spy is not called |
| W6 | show one window and minimize another; maximize the first; install the relayout spy; call the maximized window's own `onViewportResize()` | the relayout spy is not called (today: once) |
| W7 | show a window, attach a `Rail` built and mounted as `tests/overlay/Rail.test.ts` does, minimize it (the rail path); call `relayoutMinimizedStack()` | the flag reads `false` |
| W8 | minimize one shown window; `dispose()` it without closing | `AbstractWindow.getOpenWindows()` no longer contains it; the flag reads `false` |
| W9 | minimize two shown windows A then B; `dispose()` A | B's `getX()` is 0 (it moved to slot 0) |

### `tests/overlay/AbstractWindow.minimizedStackResize.test.ts` — unit, node, one case

The case dispatches a real `resize`, so it lives alone in its file: `Event`'s viewport listener map is module-level and attaches its window listener only for a type's first registration, which `tests/overlay/Notification.resize.test.ts:1-15` records.

| # | Steps | Expected |
|---|---|---|
| S1 | with the reduced-motion, `requestAnimationFrame` and `setTimeout` mocks of W1: show seven windows, minimize the first four; note each minimized window's `getY()`; then install the relayout spy and pass-through spies on `DOM.source.getViewportSize` and `getThemeVar`, and dispatch one window `resize` with `DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(DOM.source.getWindow(), 'resize'))` | the relayout spy: 1 call (today 4); `getViewportSize`: 4 calls — one for the dock and one per open window (today 19); `getThemeVar`: 0 calls (today 2,864: 2,848 border estimates and the dock's 16 slot-width reads); every minimized window's `getY()` unchanged |

### Manual — in-engine (the orchestrator)

Geometry `=` on every labelled rectangle, `min0` included, in every cell of the A/B under *Verification*, and the readings of its *Expected readings* table. Only the engine can show that the viewport read no longer forces a layout: the `mt` cell's frame time is that check.

---

## Verification

1. `npm run typecheck`, `npm -w packages/lib run typecheck:test`, `npm test`, `npm run lint`.
2. `npm run build:lib`, then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`. The W3.0 ablation tests must pass unchanged: case A7 in `packages/qa/tests/ablations.test.ts` calls the seam directly and wraps the static `relayoutMinimizedStack`, which keeps its name.
3. `npm run docs:api`: the 14 warnings `master` already has, and no new one.
4. `npm run docs:llms:check` passes. No class or namespace summary line changes, so `llms.txt` needs no regeneration.
5. The greps of steps 4, 5 and 7.

### In-engine A/B — the orchestrator runs this, never the implementer

Every run opens a full-screen window; run it only with the user's go-ahead. `<BASE_SHA>` is the commit the fix branch was created from (`git merge-base feature/environment-read-caching master`, taken before the merge). From the root of the checkout that holds the fix, so both arms load the same QA page and its `min0` label:

```sh
git worktree add .worktrees/_g08-base <BASE_SHA> --detach
ln -sfn "$PWD/node_modules" .worktrees/_g08-base/node_modules
(cd .worktrees/_g08-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g08-base/packages/lib"
npm run build:lib
```

Then this script, saved anywhere outside the repository and run from the repository root:

```bash
#!/bin/bash
# G08 in-engine A/B: the base build (wt) against the fix (main), one session.
# Each cell runs base-a, fix-1, base-b, fix-2, base-c: the base arm at both
# ends, each arm's runs symmetric about the cell's centre, so a linear drift
# cancels. Every run opens a full-screen window.
set -u
RUNQA=packages/qa/runqa.sh
SESSION=${G08_SESSION:-s1}
FLAGS='work=1&seam=1&geom=1'

wtab() {
    local cell=$1 params=$2 step build arm rep

    for step in wt:base:a main:fix:1 wt:base:b main:fix:2 wt:base:c; do
        IFS=: read -r build arm rep <<< "$step"
        "$RUNQA" "g08$SESSION-$cell-$arm-$rep" "$build" "$params&$FLAGS" || exit 1
    done
}

wtab w8v 'panel=windows&drive=viewport'
wtab w4v 'panel=windows&n=4&drive=viewport'
wtab wdlg 'panel=windows&drive=toggle:120'
wtab mt 'panel=menus&drive=toggle'
```

These are the four W3.0 cells that bounded G08 (batch `b13`), with the same parameters. 20 runs, about 4 minutes. A stopped script is re-run for the failing cell under a new `G08_SESSION`.

**Reading a cell.** Run `python3 packages/qa/bin/qa-table.py packages/qa/results g08s1-<cell>- --seam --work`. The first row, `base-a`, is the geometry reference.

- **bracket** = the largest minus the smallest `avg` of the three `base` rows.
- **Δms** = the mean of the two `fix` rows minus the mean of the three `base` rows.
- A `win` is Δms < −bracket; a `regress` is Δms > +bracket.

`qa-ab.py` does not apply: it scores ablation arms, and requires every non-plain arm to name its `abl=`.

**Expected readings**, per unit. The base column is W3.0's plain mean, for orientation only: the session's own base runs are the reference. "Forced reads" is what the ablation's counter stood for — environment reads that reach the engine's style or layout — and on the fix it is 0 by construction; the seam columns are what `qa-table.py` prints.[^readings]

| Cell | Phase | Base ms | Fix ms | `getViewportSize` base → fix | `getThemeVar` base → fix | work/u base → fix | sink/u base → fix | Forced reads: base → W3.0 arm → fix |
|---|---|---|---|---|---|---|---|---|
| `w8v` | viewport ×150 | 17.4 | flat | 25.00 → 10.00 | 16.00 → 0 | 15,883 → ≈ 7,555 | 1,157 → ≈ 533 | 41 → 1.01 → 0 |
| `w4v` | viewport ×150 | 17.3 | flat | 11.00 → 8.00 | 4.00 → 0 | 6,049 → ≈ 4,661 | 429 → ≈ 325 | 15 → 1.01 → 0 |
| `wdlg` | toggle ×120 | 29.0 | flat | 0.05 → 0.05 | 1.20 → ≤ 0.05 | 18.1 → 18.1 | 15.3 → 15.3 | 1.25 → 0.04 → 0 |
| `mt` | toggle ×150 | 35.1 | ≈ 33.6 | 1.00 → 1.00 | 0 → 0 | 886.8 → 886.8 | 456.7 → 456.7 | 1.00 → 0.50 → 0 |

**Pass criteria:**

1. **Geometry `=` on every row of every cell**, `min0` included. This is the gate; any `DIFF` fails the change, whatever the timing.
2. **`mt` reads `win`**, near −1.5 ms (W3.0's arm: −1.52). A `flat` here means `innerWidth` still forces a layout in this WebKitGTK build: stop, record it, and report before merging.
3. **`w8v`**: `getViewportSize` is the base value minus 15.00, `getThemeVar` ≤ 0.02, and work/u and sink/u each fall by at least 40% (W3.0's arm: −52% and −54%).
4. **`w4v`**: `getViewportSize` is the base value minus 3.00, `getThemeVar` ≤ 0.02, and work/u and sink/u each fall by at least 15% (W3.0's arm: −23% and −24%).
5. **`wdlg`**: `getThemeVar` ≤ 0.05.
6. **No cell reads `regress`.**

Record the readings in `plans/research/render-review-2026-09-15/` beside `96-w3-0-bounding-sweep.md`, and add the fix's `w8v` and `mt` figures to the *Validated* cells of the `windows` and `menus` rows in `packages/qa/README.md`.

---

## Documentation Impact

- **`core/index.ts`**: no change. `core/ThemeVars.ts` is framework-internal, like `core/BorderWidths.ts`, so no public JSDoc may `{@link}` it (`CODE_CONVENTIONS.md`, *Don't `{@link}` internal symbols*). `Util.invalidateTextMetricsCache`'s new JSDoc describes the cache in prose only.
- **`docs/reference/changelog/next.md`**:
  - *Changed → Core*, two entries:
    - **Theme variables are read once per theme.** The library reads a few `--ts-ui-*` variables in script — a component's border width before its element is attached, a minimized window's dock-slot width, a spinner's font size, a `Text`'s bound line-height variable — and each read used to resolve `:root`'s computed style, recalculating the document's style whenever a write was pending (a window's first layout did so over a hundred times). Each variable is now read once per `ThemeManager.setTheme` and served from memory until the next one or the next settled font batch. A variable changed on `:root` any other way is not seen by these reads until then; call `Util.invalidateTextMetricsCache()` after such a change.
    - **`DOMSource.getViewportSize()` no longer forces a document layout.** The production source read the root element's client size beside the window's inner size and kept the larger, which on a desktop engine is always the inner size. It now reads the inner size, and the root's client size only where the window reports 0. The value is unchanged on desktop engines; on a pinch-zoomed phone it is now the visual viewport's size.
  - *Changed → Overlay* (a new sub-section after *Changed → Layouts*): **Minimized windows re-anchor once per viewport resize.** Each window docked along the bottom used to re-lay out the whole dock on every `resize`, so M docked windows cost M² window layouts per event; the dock now answers a resize through one listener of its own.
  - *Fixed → Overlay*: **A window disposed without being closed stayed in `AbstractWindow.getOpenWindows()`** and kept its dock slot. It now leaves the list, and the dock closes the gap.
- **`docs/concepts/theming.md`**, *Theme change listeners* (`:230`): after the first paragraph, add — *The library itself reads a handful of theme variables in script, such as a window's minimized dock-slot width, and it reads each one once per `setTheme`. A `--ts-ui-*` variable changed on `:root` by any other means is not seen by those reads until the next `setTheme`; call `Util.invalidateTextMetricsCache()` after such a change.* Link it as `` [`Util.invalidateTextMetricsCache()`](/api/core/namespaces/Util/functions/invalidateTextMetricsCache) ``, the docs' link form for a namespace function (`concepts/performance.md:174` links `Animation.materialize` the same way).
- **`packages/qa/README.md`**: the `windows` row, per step 10.

---

## Potential Challenges

- **`innerWidth` might still lay out in some host.** It lays out a parent document for a subframe, and Chromium lays out a mobile page with a viewport meta tag; a top-level desktop page does neither. The `mt` cell is the in-engine check (pass criterion 2).
- **At a non-100% browser zoom `innerWidth` and the root's `clientWidth` can round apart by a pixel.** The old `Math.max` took the larger, the new code takes `innerWidth`. The QA runs are at 100% zoom; nothing in the library depends on that last pixel.
- **A consumer who changes `--ts-ui-*` on `:root` outside `setTheme` sees stale reads.** This is the contract `Util`'s text metrics already have; the changelog and `theming.md` give the remedy.
- **`Event`'s viewport listener map outlives `DOM.reset()`.** A test that dispatches a real `resize` must be alone in its file, which is why S1 has its own file and W1–W9 call the dock's handler directly.
- **The dock's sentinel is constructed at module load**, as `Notification`'s is. `tests/unit/import-without-dom.test.ts` covers the overlay entry point, so a failure there shows at once.
- **The G18 draft `plans/text-measurement-without-reflow.md` edits the same `Util.invalidateTextMetricsCache` and `Text.ts`.** Whichever lands second keeps both calls in `invalidateTextMetricsCache` (their order does not matter), and re-runs step 4's grep so any `DOM.source.getThemeVar` left in `Text.ts` goes through `readThemeVar`.

---

## Critical Files

- [`core/BorderWidths.ts`](packages/lib/src/typescript/lib/core/BorderWidths.ts) — the module shape `ThemeVars.ts` copies: a module-level cache over one seam read, a clear, a test-only size, not exported from `core/index.ts`.
- [`core/Util.ts:52-70`](packages/lib/src/typescript/lib/core/Util.ts#L52), [`:106-146`](packages/lib/src/typescript/lib/core/Util.ts#L106), [`:296-353`](packages/lib/src/typescript/lib/core/Util.ts#L296) — the per-theme variable caches and `invalidateTextMetricsCache`.
- [`core/Theme.ts:1405-1436`](packages/lib/src/typescript/lib/core/Theme.ts#L1405), [`:1480-1500`](packages/lib/src/typescript/lib/core/Theme.ts#L1480) — `setTheme` writes the variables, then `reflowText` clears the caches before any listener runs.
- [`core/DOM.ts:1176-1189`](packages/lib/src/typescript/lib/core/DOM.ts#L1176), [`:2446-2458`](packages/lib/src/typescript/lib/core/DOM.ts#L2446), [`:2911-2955`](packages/lib/src/typescript/lib/core/DOM.ts#L2911) — the two reads, and `DOM.install` / `DOM.reset`.
- [`overlay/Notification.ts:112-120`](packages/lib/src/typescript/lib/overlay/Notification.ts#L112), [`:614-667`](packages/lib/src/typescript/lib/overlay/Notification.ts#L614), [`:712-733`](packages/lib/src/typescript/lib/overlay/Notification.ts#L712) — the sentinel-owned static listener and the destructor the dock copies.
- [`core/LayerManager.ts:168-176`](packages/lib/src/typescript/lib/core/LayerManager.ts#L168), [`:849-865`](packages/lib/src/typescript/lib/core/LayerManager.ts#L849) — the same sentinel pattern.
- [`overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `openWindows` (`:352`), `show` (`:812-830`), `onExitAction` (`:1061-1080`), `destructor` (`:1110-1137`), `setWindowState` (`:1222-1330`), `computeDockRect` (`:2599`), `getMinDockWidth` (`:2740`), `relayoutMinimizedStack` (`:2775`), the viewport-resize block (`:3015-3077`).
- [`tests/core/BorderWidths.test.ts`](packages/lib/tests/core/BorderWidths.test.ts) — a source wrapper through `DOM.install`, and the `afterEach` order.
- [`tests/overlay/Notification.resize.test.ts`](packages/lib/tests/overlay/Notification.resize.test.ts) — dispatching a real `resize`, and why such a test lives alone in its file.
- [`tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts:37-49`](packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts#L37) — the reduced-motion mock.
- [`packages/qa/src/panels/windows.ts`](packages/qa/src/panels/windows.ts) and the `windows` row of [`packages/qa/README.md`](packages/qa/README.md).
- [`96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#g08--environment-reads) and [`plans/implemented/w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md) (*Status Pass*, `g08.env-reads`).

---

## Non-Goals

- **F09.1, F17.4, `DialogBackdrop`'s `inset: 0` with F09.7, and `TextField`'s gate move** — see *Scope within G08*.
- **Caching the pre-connect border estimate in `_borderWidths`** (X10's other half). Its reads are cached now; a provisional third border-width state would save string parsing no cell measures.
- **`Body.getElement()` re-reading `document.body`** (F03.15). It forces nothing, and no arm bounded it.
- **A viewport cache**, per task or per `resize` dispatch: after the reorder a viewport read costs two property reads, so neither would save anything worth its invalidation (see *The viewport read stops forcing layout, and is not cached*).
- **Skipping a dock relayout that would place every window where it already is.** The dock still lays out its windows once per event at an unchanged size; skipping that is layout economy the ablation did not bound.
- **Rail-minimized windows in the dock.** Found while planning, not verified in the engine: `relayoutMinimizedStack` and `computeDockSlotIndex` (`:2757`) count every minimized window, rail-minimized ones included, so each holds a dock slot and is moved into it, hidden, by every relayout. This plan keeps that membership exactly.

---

## Addendum: Measured Counts

Per unit, from the raw W3.0 results (`.worktrees/w3-0-bounding-sweep/packages/qa/results/w3s1-b13-*.json`); every plain run of a cell gave the same counts.

| Cell | Arm | avg ms | `getViewportSize` | `getThemeVar` | work/u | sink/u | Ablation's own counters |
|---|---|---|---|---|---|---|---|
| `w8v` | plain | 17.3–17.7 | 25 | 16 | 15,883 | 1,157 | — |
| `w8v` | `g08.env-reads` | 17.2–17.5 | 13 | 4 | 7,555 | 533 | viewport hit 12, miss 1; themeVar hit 3.99; minStack skipped 3 |
| `w4v` | plain | 17.3–17.4 | 11 | 4 | 6,049 | 429 | — |
| `w4v` | `g08.env-reads` | 17.3–17.4 | 9 | 2 | 4,661 | 325 | viewport hit 8, miss 1; themeVar hit 1.99; minStack skipped 1 |
| `wdlg` | plain | 28.7–29.4 | 0.05 | 1.20 | 18.1 | 15.3 | — |
| `mt` | plain | 34.9–35.4 | 1.00 | 0 | 886.8 | 456.7 | — |
| `mt` | `g08.env-reads` | 33.4–33.9 | 1.00 | 0 | 886.8 | 456.7 | viewport hit 0.5, miss 0.5 |

`w8v`'s 25 viewport reads are the dock's 16 (four minimized windows, each re-running the four-window relayout) plus seven open windows, `Body` and the toast. After this plan: the dock's 1 plus those nine, 10. `w4v`: 4 + 7 → 1 + 7, so 11 → 8.

Offline, on `master`'s library with the modelled DOM (a throwaway probe, not part of this plan), one dispatched `resize` with four minimized windows and three open ones, under reduced motion:

| Handles | `getViewportSize` | `getThemeVar` | Relayouts |
|---|---|---|---|
| every one connected | 19 | 16, all `--ts-ui-window-min-dock-width` | 4 |
| detached (the test DOM's default, S1's setup) | 19 | 2,864: 2,848 `--ts-ui-window-control-border`, 16 `--ts-ui-window-min-dock-width` | 4 |

The minimized windows sat at y = 772 (800 − a 28 px header) before and after. A detached `Window('Bare').show()` read theme variables 124 times, and a second window's show read `--ts-ui-window-control-border` 172 times. `new TextField()` read theme variables 9 times, and a second one 8 times.

---

## Notes

[^above-seam]: Three reasons put the cache above the seam rather than inside `ProductionDOMSource`, where the scrollbar width is cached (`core/DOM.ts:13`, `:2460-2494`). First, the QA app's seam counters wrap `DOM.source`, so a cache inside the source still counts every call; the in-engine A/B could not see the saving. Second, every offline test runs the modelled source, so a production-only cache would never be exercised offline, while the campaign's proofs for this group are seam counts taken offline: slice 01's 152 → ≤ 4 per detached pass, slice 09's 516 → ≤ 5 per window show, slice 15's 8 → ≤ 4 per `TextField`. Third, the scrollbar width never changes during a session, and a theme variable does, so its invalidation belongs with the theme's other derived caches in `Util`, above the seam. The G18 draft (`plans/text-measurement-without-reflow.md`) makes the same choice for text measurement, in `core/TextMeasure.ts`. The three `Util` readers are left alone: they already read once per theme, and routing them would remove no read.

[^clear-points]: `setTheme` is the only writer of the library's `--ts-ui-*` variables. It writes `themeToVars(theme)` inline on `:root` (`core/Theme.ts:1415-1417`), and an inline declaration outranks every stylesheet rule without `!important`, so no media query can change one either. A grep for `--ts-ui-` writes finds no other writer. Clearing inside `invalidateTextMetricsCache` puts the clear before the first theme listener, where `Util`'s own caches already are. `BorderWidths.ts` instead registers `ThemeManager.onThemeChange` at import, which depends on import order, and here would also make an import cycle (`Theme.ts` → `Util.ts` → `ThemeVars.ts` → `Theme.ts`). A settled font batch also clears the cache; that is harmless, since the next read of each variable costs one style read. The ablation cleared on any `DOM.sink.apply` to the root element. `PointerDrag` writes the root's inline style at every drag start and end (`core/PointerDrag.ts:54`, `:75`), so that hook clears for nothing, and it misses a change of source. Keying on the source object costs one reference comparison per read. A new `installTestDOM` builds a new `ModelledDOMSource`, `DOM.reset()` a new `ProductionDOMSource`, and a `BorderWidths.test.ts`-style wrapper (`Object.create(DOM.source, …)`) is a new object too. `vi.spyOn(DOM.source, …)` keeps the object; both tests that spy on `getThemeVar` call `setTheme` after installing the spy. The QA app installs its counting proxy once per run, so a run's first read of each variable after that is a miss.

[^zoom-dpr]: An unregistered custom property's computed value is its token text, so zoom and the device-pixel ratio never change a theme variable; the library registers none (no `@property` or `CSS.registerProperty` in `packages/lib/src`). `innerWidth` is in CSS pixels at any zoom, as `clientWidth` was, and browser zoom fires `resize`. A canvas surface follows the device-pixel ratio through its own `matchMedia` watch (`component/display/AbstractCanvasSurface.ts:79-92`), which this plan does not touch.

[^no-viewport-cache]: WebKit's `LocalDOMWindow::innerWidth` updates layout only in a *parent* document, and only for a subframe; a top-level page — MiniBrowser, every Tauri host — lays nothing out. Chromium's `innerWidth` lays out only a subframe's parent or a mobile page with a viewport meta tag. So what the ablation's memo saved was forced layouts, and the reorder removes all of them, including the one per task the memo still paid. Two caches were considered on top and rejected. A memo per task (the ablation's shape) would be the library's first microtask-scoped state, to save a few property reads per task. Placed in the production source, it would be invisible to every counter; placed above the seam, it would serve a stale size to four test files that change the modelled viewport and call a resize handler in the same task (`AbstractWindow.minimizedViewportResize`, `AbstractWindow.normalViewportResize`, `AbstractWindow.maximizeRestoreViewportClamp`, `DialogViewportResize`). A share per `resize` dispatch — every read during one dispatch sees one value — would be sound and visible to counters, but needs a type-specific scope in `Event`'s generic viewport dispatcher and all 30 `getViewportSize` call sites moved onto a new reader, again to save property reads. So the seam still counts one viewport read per listener per event (10 per `w8v` unit); what it no longer counts is a forced layout.

[^stack-listener]: Today a docked window re-attaches its own `resize` listener when its dock animation ends (`overlay/AbstractWindow.ts:1304`), and each such listener's minimized branch runs the whole-dock relayout (`:3054-3058`); a maximized window's listener runs it once more (`:3076`). M docked windows therefore cost M relayouts per event, each laying out M windows and reading the viewport and slot width M times: W3.0's `w8v` plain arm, four docked, read `getViewportSize` 25 and `getThemeVar` 16 and did 15,883 units of work per event. `Notification.resizeListenerOwner`, `LayerManager`'s `_listenerOwner` and `FocusHistory`'s `_owner` (`core/FocusHistory.ts:64-67`) are the library's three sentinel-owned static listeners; `Notification`'s and `LayerManager`'s are installed with their first member and removed with their last, which is the dock's lifecycle too. The relayout decides because it already runs after every change to the minimized set — close (`:1080`) and every state change's completion (`:1264`, `:1305`, `:1322`) — so it always knows whether a docked window exists. Only docked windows count: a rail-minimized window detaches its listener and never re-attaches it while minimized (`:1272`), so a dock holding only rail windows is not re-anchored on a resize today, and still is not. The one resize behaviour that changes is a maximized window's: it no longer re-anchors a dock that holds only hidden rail windows. The ablation's once-per-task wrapper was rejected for the same reason as the viewport memo: microtask state, where a listener is once per event by construction and also removes M − 1 dispatches that would do nothing.

[^dispose]: Today the destructor (`overlay/AbstractWindow.ts:1110-1137`) never removes the window from `openWindows`; only `onExitAction` does (`:1076`). A window disposed without being closed stays in the set, but its own listeners go with it, because `Event` drops a disposed component's registrations. Once the dock owns the listener, a disposed docked window left in the set would be written through its released element handle on the next resize — the case `Notification`'s destructor guards for its own static list. `close()` still removes the window before its destructor runs, so the new code finds nothing to do on that path. The side effect is that `AbstractWindow.getOpenWindows()` no longer lists a disposed window, which `LayoutSerialization` also reads (`layout/LayoutSerialization.ts:342`, `:678`); the changelog records it under *Fixed*.

[^ablation-diff]: The ablation was a runtime patch for one sweep in one engine: it could keep its caches forever, ignore the test harness, and wrap a static method in a microtask guard. A shipped fix has to be torn down between tests, cleared by the theme path it lives beside, and correct for a window that is disposed rather than closed. None of the differences changes what the page lays out: the cached values are the ones the live reads return within a theme, and the dock places every window at the rectangle it placed it at before.

[^scope]: The rule is the W3.0 plan's: an ablation bounds a group, and a sub-item it left unbounded "stays in the group's plan if the group is planned" — unless, once the bounded part lands, what is left of it is not this group's kind of work. F09.1's evidence is the offline probe in *Addendum: Measured Counts* (over a hundred reads of one variable per detached window show; with the cache, at most one per theme), which meets slice 09's own proof target of ≤ 5 reads per show. The calendar's two detached passes are `component/input/AbstractCalendarDropdown.ts:688-718`. `DialogBackdrop.resize()` has two callers (`overlay/Dialog.ts:1245`, `overlay/Drawer.ts:640`), and ARCHITECTURE.md's typed-setter rule means `inset` needs its own setter. `TextField.setBorder` computes the discarded height at `component/input/TextField.ts:109`, before its `if (pref)` gate; with the cache that line reads nothing from the DOM.

[^min0]: The panel's labels are `win0`, `bare`, `pinned`, `southStrip` and `header0` — all open windows or their parts — so W3.0's gate could not have caught a dock placed differently; the ablation shared the blind spot. `openWindows` holds windows in `show()` order, and the panel shows `windows` first and minimizes the last ⌊n/2⌋, so `windows[n - minimized]` holds slot 0. At `n=1` nothing is minimized and the label is left out.

[^readings]: The base and W3.0-arm columns come from *Addendum: Measured Counts*. The fix's seam columns follow from the design: the dock's M² viewport reads become one per event (−15 at M=4, −3 at M=2), its slot-width read is a cache hit from mount onward, and every other listener still reads the viewport once. Its work and sink columns are the ablation's arm's: the ablation ran the dock's relayout once per task, which in these cells is once per event (the `viewport` driver dispatches each `resize` inside one animation-frame callback), and the listeners this plan removes did no counted work. `wdlg`'s theme-variable reads come from each dialog's controls estimating their borders at construction; the windows' own form fields read the same variables at mount, so the dialog finds them cached. `mt` keeps its two viewport reads per open, but neither forces a layout any more, which is where the ablation's 1.52 ms came from: it served the second read, taken after the menu's row rebuild, from the first.

---

## Implementation Notes

Implemented as planned, with one source change the plan did not call for — a
guard in `show()` the audit surfaced, described below. The greps of *Ordered
Implementation Steps* 4, 5 and 7 all report what the plan says they should:
`DOM.source.getThemeVar(` survives in `core/ThemeVars.ts` once and
`core/Util.ts` three times, `Math.max(document.documentElement.client` is gone
from `core/DOM.ts`, and `attachViewportResizeListener();` is left at three
call sites (`show`, the `"normal"` branch, the maximize completion). Six
things are worth recording.

Verification steps 1-5 of *Verification* all pass: `npm run typecheck`,
`npm -w packages/lib run typecheck:test`, `npm test` (504 files, 8,367 tests),
`npm run lint`, `npm run build:lib` with `npm -w packages/qa run typecheck`
and `npm -w packages/qa run test` (344 tests, A7 included), `npm run docs:api`
at the 14 warnings `master` already has and no new one, and
`npm run docs:llms:check`.

**The G18 overlap landed first, and both clears are kept.**
`plans/implemented/text-measurement-without-reflow.md` is in this branch's
history, so `Util.invalidateTextMetricsCache` already called
`clearTextMeasureCache()`; `clearThemeVars()` was added beside it rather than
in place of it, and that function's JSDoc now names both the text measurements
and the theme variables. *Potential Challenges*' step-4 grep was re-run
afterwards: `component/input/Text.ts` reads its bound line-height variable
through `readThemeVar`, with no `DOM.source.getThemeVar` left anywhere in it.

**The changelog's *Changed → Overlay* sub-section already existed**, added by
`plans/implemented/drag-resize-outline-mode.md` earlier in this stack, so the
minimized-dock entry joined it instead of opening a new one as *Documentation
Impact* assumed.

**The QA panel's `geometry` map had gained `resizeOutline`** from that same
plan, so `min0` was appended after it rather than after `header0`. The
conditional spread and the label itself are the plan's.

**Running `npm -w packages/qa run typecheck` inside a worktree needs a local
package link.** Node resolves `@jimka/typescript-ui` by walking up to the main
checkout's `node_modules`, so the QA package typechecks against whatever
`packages/lib/dist` that checkout last built — stale here, and it failed on
`Body.setResizeMode`, a symbol unrelated to this plan. An untracked
`node_modules/@jimka/typescript-ui -> ../../packages/lib` symlink inside the
worktree points it at this branch's own build; with it, `npm run build:lib`
then `npm -w packages/qa run typecheck` and `npm -w packages/qa run test` are
clean (344 tests, including A7's `g08.env-reads` arm, which still finds
`relayoutMinimizedStack` under its own name).

**The audit found one path the plan's design missed, and it needed a sixth
source change — a guard in `show()`.** Footnote `[^stack-listener]` reasons
that `relayoutMinimizedStack` "runs after every change to the minimized set",
and lists close and the three state-change completions. A window constructed
with `windowState: "minimized"` reaches none of them: `initChrome` calls
`setWindowState(this.getWindowState())`, which short-circuits because the
state is already current, so `show()` added the window to `openWindows`
without the dock ever learning of it. With the window's own minimized branch
now returning, nothing answered a resize — the window stayed where it was,
where before this plan its own listener relaid the dock out. `show()`
therefore calls `installStackResizeListener()` for an already-minimized,
rail-less window, and case **W10** in
`tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` pins it.

Installing the listener is deliberately *not* a relayout, though the plan
gives the relayout sole ownership of the install. A first attempt did relayout
there, and a second audit round caught what that costs: the window has had
none of the docked branch's preparation — no captured `_restoreRect`, no
relaxed minimum size, no hidden body host — so placing it in a dock slot
clamps it to its 200x200 minimum at `show`, and a restore before any resize
then hands back that clamped rect instead of the rect it was constructed with.
Probed against `b9c159a3`, the guard as it now stands reproduces the base's
geometry exactly on every path: `100,100 600x400` after `show`,
`0,572 200x200` after a resize to 600, and `100,100 600x400` for a
show-then-restore with no resize in between. So only the listener changes
hands, which is why this needs no changelog entry of its own beyond the
minimized-dock one already there. That a construct-minimized window is not
docked until the first resize, and is clamped to its minimum when it is, is a
pre-existing defect on both sides of this branch and is not this plan's to
fix.

A sibling path, `setWindowState("minimized")` before `show()`, was probed and
left alone: it throws `Component doesn't seem to be rendered` from
`animateRect`'s synchronous commit on `b9c159a3` too, so it is unsupported
independently of this plan.

**The in-engine A/B is pending, and is the user's to run** — every run opens a
full-screen window. The base is this branch's start point, the tip of the
wave-3 stack, **not** `git merge-base` with `master` (that is `37606021`,
far behind the stack). Use:

```sh
git worktree add .worktrees/_g08-base b9c159a3683cfb3f9897b0acf4d2a8be40c32085 --detach
ln -sfn "$PWD/node_modules" .worktrees/_g08-base/node_modules
(cd .worktrees/_g08-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g08-base/packages/lib"
npm run build:lib
```

then the `wtab` script of *Verification → In-engine A/B* unchanged, and read
each cell with `python3 packages/qa/bin/qa-table.py packages/qa/results
g08s1-<cell>- --seam --work` against that section's six pass criteria.
That subsection's closing paragraph — recording the readings beside
`96-w3-0-bounding-sweep.md` and filling the *Validated* cells of the `windows`
and `menus` rows in `packages/qa/README.md` — waits on that run.

Offline, the saving the A/B should confirm is already visible in the seam
counts: `tests/overlay/AbstractWindow.minimizedStackResize.test.ts` (S1) pins
one dispatched `resize` with four docked and three open windows at one dock
relayout, four `getViewportSize` calls and zero `getThemeVar` calls, against
the plan's recorded 4, 19 and 2,864 before the change.
