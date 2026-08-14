---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Native Context-Menu Suppression — Implementation Plan

## Overview

The browser's own right-click menu currently appears anywhere a component has not wired its own `contextmenu` handler. Suppression is opt-in and scattered: [`CollapseButton.onContextMenu`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L352), [`Tree._handleContextMenu`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1190), [`DiagramView._handleContextMenu`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1593), [`AbstractSelectableList.handleRowContextMenu`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1677), the table header cells, and `TabBar`'s per-tab listener each suppress it locally. Everywhere else — empty page background, panels, labels, text inputs — the native menu shows.

This plan makes suppression the framework default, wired once from [`Body.init`](packages/lib/src/typescript/lib/core/Body.ts#L75). A new `BodyOptions.nativeContextMenu` field (default `false`) decides whether the native menu is allowed; when it is not, `Body` registers a single `contextmenu` viewport listener that returns `{ prevent: true }` and nothing else. Every component that already handles `contextmenu` keeps working untouched, because a `preventDefault` from one window-level listener does not stop another window-level listener from running.

The change is confined to [`core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts), one new test file, and four documentation files. No component changes.

---

## Architecture Decisions

### Wire the listener from `Body.init`, not the constructor

`Body`'s registration happens in the static `Body.init` entry point, gated on the caller not having supplied `nativeContextMenu`. The private constructor runs eagerly at module import from the static field initializer at [`Body.ts:39`](packages/lib/src/typescript/lib/core/Body.ts#L39), which is too early.[^init-not-constructor]

This mirrors the favicon default at [`Body.ts:79-85`](packages/lib/src/typescript/lib/core/Body.ts#L79) exactly — same gate (`options.X === undefined`), same location, same reason recorded in the comment there.

### The registered state is derived from the options bag, not a second field

`setNativeContextMenu` reads `this._options.nativeContextMenu === false` to know whether the listener is currently registered, then adds or removes only on an actual transition. There is no separate `_listening` boolean.[^derived-flag]

The guarded add/remove itself is the established shape: [`MenuBar.openMenu`/`closeMenu`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L256) and [`Markdown.armViewportWatch`/`disarmViewportWatch`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1177) both guard `Event.addViewportListener` / `removeViewportListener` so a repeat call cannot double-register. The guard is not optional here: `addViewportListener` pushes into an array with no de-duplication ([`Event.ts:605`](packages/lib/src/typescript/lib/core/Event.ts#L605)), and `removeViewportListener` splices on an unchecked `indexOf` ([`Event.ts:633`](packages/lib/src/typescript/lib/core/Event.ts#L633)), so removing a listener that was never added removes whatever is last in the array.

### The handler returns `{ prevent: true }` — never a stop

The handler returns the disposition `{ prevent: true }`, so the dispatcher calls `preventDefault()` and nothing else. It never calls `preventDefault()` itself, and never returns `stop`.[^prevent-only]

### The handler is a plain prototype method

`onContextMenu` is declared as a normal private method and passed as `this.onContextMenu`, not as an arrow-function class field like the neighbouring `_onViewportResize` at [`Body.ts:171`](packages/lib/src/typescript/lib/core/Body.ts#L171).[^prototype-method] The dispatcher invokes it with the component bound as `this` ([`Event.ts:227`](packages/lib/src/typescript/lib/core/Event.ts#L227)), so no binding is needed. This follows [`Markdown.handleViewportChange`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1208), which documents the same choice for the same API.

### `nativeContextMenu` defaults to `false`, and is live at runtime

The option is named for what it enables, so `false` (the default) means the native menu is suppressed and `true` restores it. `setNativeContextMenu(boolean)` applies the change immediately at any point after `Body.init`, which is also the escape hatch for an app that mounts without calling `Body.init`.[^default-false]

---

## Public API

```typescript
export interface BodyOptions extends ComponentOptions {
    favicon?: string | false;

    /**
     * Whether the browser's own right-click menu is allowed. Defaults to
     * `false` — `Body.init` suppresses the native menu page-wide, so only
     * menus the library or the app opens on `contextmenu` ever appear.
     * `true` restores the browser's menu everywhere.
     */
    nativeContextMenu?: boolean;
}
```

```typescript
class Body extends Component<BodyOptions> {
    /** Allows (`true`) or suppresses (`false`) the browser's native right-click menu page-wide. */
    setNativeContextMenu(allowed: boolean): this;

    /** Whether the browser's native right-click menu is allowed. Defaults to `false`. */
    getNativeContextMenu(): boolean;
}
```

| Member | Backing store | Options field |
|---|---|---|
| `setNativeContextMenu` / `getNativeContextMenu` | `this._options.nativeContextMenu` | `BodyOptions.nativeContextMenu` |

`Body` has no `_defaultBodyOptions` bag and must not gain one — the default is dispatched from `Body.init`, exactly as `favicon` is. Do **not** add a row to [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts); `Body` has no row today and this change does not give it one.

---

## Implementation

The setter's whole job is the transition. The listener is registered exactly when `this._options.nativeContextMenu === false`:

```typescript
setNativeContextMenu(allowed: boolean): this {
    // The listener is registered exactly when the option reads `false`;
    // `undefined` means "not configured yet", so nothing is registered.
    const listening = this._options.nativeContextMenu === false;

    this._options.nativeContextMenu = allowed;

    if (!allowed && !listening) {
        Event.addViewportListener(this, "contextmenu", this.onContextMenu);
    } else if (allowed && listening) {
        Event.removeViewportListener(this, "contextmenu", this.onContextMenu);
    }

    return this;
}
```

Worked transitions — the first column is `this._options.nativeContextMenu` on entry:

| Before | Call | Listener action | After |
|---|---|---|---|
| `undefined` | `setNativeContextMenu(false)` | add | `false` |
| `undefined` | `setNativeContextMenu(true)` | none | `true` |
| `false` | `setNativeContextMenu(false)` | none | `false` |
| `false` | `setNativeContextMenu(true)` | remove | `true` |
| `true` | `setNativeContextMenu(false)` | add | `false` |

The handler carries no state:

```typescript
private onContextMenu(): Event.ListenerResult {
    return { prevent: true };
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/Body.ts` — add the option field.** Add `nativeContextMenu?: boolean` to `BodyOptions` (after `favicon`), with the JSDoc from `## Public API`.

2. **`Body.ts` — add `setNativeContextMenu` / `getNativeContextMenu`.** Place them after `getFavicon` ([`Body.ts:126`](packages/lib/src/typescript/lib/core/Body.ts#L126)), using the body from `## Implementation`. `getNativeContextMenu` returns `this._options.nativeContextMenu ?? false`. Both carry full JSDoc (description, `@param`, `@returns`). `Body.ts` already imports the `Event` namespace at line 5 — no new import.

3. **`Body.ts` — add the `onContextMenu` handler.** A private prototype method returning `{ prevent: true }`, placed next to `_onViewportResize` ([`Body.ts:171`](packages/lib/src/typescript/lib/core/Body.ts#L171)). Its JSDoc must state that it returns a disposition rather than calling `preventDefault()`, and that it deliberately does not stop propagation.

4. **`Body.ts` — dispatch the option from `applyOptions`.** In `applyOptions` ([`Body.ts:91`](packages/lib/src/typescript/lib/core/Body.ts#L91)), after the `favicon` line, add `if (options.nativeContextMenu !== undefined) this.setNativeContextMenu(options.nativeContextMenu);`.

5. **`Body.ts` — dispatch the default from `static init`.** In `Body.init` ([`Body.ts:75`](packages/lib/src/typescript/lib/core/Body.ts#L75)), after the existing `favicon` default block, add the matching block: `if (options.nativeContextMenu === undefined) { this.INSTANCE.setNativeContextMenu(false); }`. Give it its own comment above, stating the same reason the favicon block's comment gives — the default cannot come from `applyOptions`, which also runs during the singleton's construction at module import. Leave the favicon comment as it is.

6. **`Body.ts` — update the class JSDoc.** The `static init` doc comment lists what `init` does beyond applying options ("Also installs the browser-tab icon…"); add the context-menu suppression to that list.

7. **Create `packages/lib/tests/core/BodyContextMenu.test.ts`.** A dedicated file — the isolation constraint in `## Potential Challenges` is why. Cover every unit-testable case in `## Expected Behaviour`, following [`tests/dom/viewport-consume.test.ts`](packages/lib/tests/dom/viewport-consume.test.ts) for the dispatch shape and [`tests/core/Favicon.test.ts`](packages/lib/tests/core/Favicon.test.ts) for the `installTestDOM` + `Body.init` setup. The `afterEach` must be `Body.getInstance().setNativeContextMenu(true); DOM.reset();` — in that order.

8. **Run the full test suites** — `npm test` at the repo root and `npm -w packages/docs run test`. `Favicon.test.ts`, `Body.test.ts`, and `packages/docs/tests/DocsSidebar.test.ts` all call `Body.init` repeatedly and now register the listener; confirm none regress.

9. **Docs.** Apply every edit in `## Documentation Impact`.

10. **Checkpoint.** `grep -rn "nativeContextMenu" packages/lib/src packages/lib/tests packages/lib/docs` — expect hits only in `core/Body.ts`, the new test file, `docs/components/Body.md`, and `docs/reference/changelog/next.md`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Create | `packages/lib/tests/core/BodyContextMenu.test.ts` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/recipes/right-click-menu.md` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable (all in the new `BodyContextMenu.test.ts`):

1. **Suppressed by default.** After `Body.init({})`, dispatching a `contextmenu` event calls `preventDefault()` on it exactly once.
2. **Opt-in restores the native menu.** After `Body.init({ nativeContextMenu: true })`, dispatching a `contextmenu` event calls `preventDefault()` zero times, and the sink records no `addListener` write for `"contextmenu"`.
3. **Explicit `false` matches the default.** `Body.init({ nativeContextMenu: false })` behaves identically to case 1.
4. **Repeat `init` registers once.** Two `Body.init({})` calls produce exactly one `addListener` sink write for `"contextmenu"`, and one dispatched event is prevented once, not twice.
5. **Runtime enable removes the listener.** With suppression active, `setNativeContextMenu(true)` records exactly one `removeListener` write for `"contextmenu"`, and a subsequent dispatch is not prevented.
6. **Enabling when nothing is registered is a no-op.** Calling `setNativeContextMenu(true)` while the option is already `true` (or still unconfigured) records no `removeListener` write for `"contextmenu"` at all. This is the case that would otherwise trip `removeViewportListener`'s unchecked `indexOf`.
7. **Toggling round-trips.** `false` → `true` → `false` yields exactly two `addListener` and one `removeListener` writes for `"contextmenu"`, and the final state prevents a dispatched event.
8. **Getter reports the effective value.** `getNativeContextMenu()` is `false` before any configuration, `true` after `Body.init({ nativeContextMenu: true })`, and `false` again after `setNativeContextMenu(false)`.
9. **A component's own handler still runs.** With suppression active, register an exact-target listener on a child `Component` (`Event.addListener(child, "contextmenu", handler)` — exact-target routing matches on the event target's id, so no DOM parent chain has to be built) and dispatch `makeEvent(child.getElement(true)!, "contextmenu")`. The handler runs *and* the event is prevented once: the global handler returns no stop disposition, so it cannot consume the event. Place this case last in the file and call `Event.removeListener(child, "contextmenu", handler)` before it ends, so the exact-target window handler is uninstalled and cannot leak into a later case the way the viewport one would.

Manual verification (run `npm run dev`, app on `localhost:8015`):

10. Right-clicking empty page background, a `Panel`, a `Text`, or a `TextField` shows no browser menu.
11. Right-clicking a `Table` column header still opens the framework column menu; right-clicking a `Split` gutter chevron still opens the gutter menu; right-clicking a `Tree` node row still fires its `"contextmenu"`; right-clicking a `TabBar` tab button still opens the tab menu.
12. Right-clicking a `Tree` **below** its last row, or `DiagramView`'s empty canvas, now shows nothing where it previously showed the browser's menu. This is the intended change, not a regression.
13. Temporarily changing the demo app's mount at [`main.ts:47`](packages/lib/src/typescript/main.ts#L47) to `Body.init({ layoutManager, nativeContextMenu: true })` restores the browser menu everywhere, including on a `TextField` (spellcheck / cut / copy / paste). Revert the edit afterwards.

---

## Verification

- `npm run typecheck` (repo root) — clean.
- `npm test` (repo root; runs `packages/lib`) and `npm -w packages/docs run test` — the new `BodyContextMenu.test.ts` passes and no existing test regresses; pay particular attention to `tests/core/Favicon.test.ts`, `tests/core/Body.test.ts`, and `packages/docs/tests/DocsSidebar.test.ts`, each of which calls `Body.init` many times per file.
- `npm run docs:api` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable one). The new public field and accessors add JSDoc, so this is the check that catches a bad `{@link}`.
- `npm run build:docs` — clean VitePress build. There is no `docs:build` script in this repo; `npm run build:pages` runs the whole chain if you want it end to end.
- Manual smoke test per cases 10–13, in the demo app's Misc panel (which has its own `contextmenu` demo buttons at [`MiscPanel.ts:894`](packages/lib/src/typescript/MiscPanel.ts#L894) and [`MiscPanel.ts:922`](packages/lib/src/typescript/MiscPanel.ts#L922)) and the Table / Split / Tree panels.

---

## Documentation Impact

`Body` and `BodyOptions` are already exported from the `core` subpath barrel and already have an API page, so no barrel or sidebar change is needed — the new field and accessors are picked up by TypeDoc from their JSDoc.

- **[`packages/lib/docs/components/Body.md`](packages/lib/docs/components/Body.md)** — add a `## Context menu` section after `## Favicon`, mirroring its shape: `Body.init` suppresses the browser's right-click menu page-wide; `Body.init({ nativeContextMenu: true })` restores it; `Body.getInstance().setNativeContextMenu(false)` is the call for an app that mounts without `Body.init` (the parallel of the `Favicon.install()` note at line 61). State the consequence plainly — a `TextField`'s native editing menu goes away too. Add a matching bullet under `## Notes`.
- **[`packages/lib/docs/recipes/right-click-menu.md:66`](packages/lib/docs/recipes/right-click-menu.md#L66)** — the note currently reads "`e.preventDefault()` is required to suppress the browser's native context menu." Rewrite it: `Body.init` already suppresses the native menu page-wide, so `preventDefault()` is what keeps the handler correct for an app that opted back in with `nativeContextMenu: true`. Link to [Body](/components/Body).
- **[`packages/lib/docs/components/DiagramView.md:121`](packages/lib/docs/components/DiagramView.md#L121)** — the row ends "A right-click on empty canvas is left to the browser." Qualify it: `DiagramView` does not suppress it there, but `Body`'s page-wide default does unless the app set `nativeContextMenu: true`.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — one bullet appended under the existing `## Changed` → `### Core` heading. It is a behaviour change consumers can see: the browser's right-click menu no longer appears in an app that mounts with `Body.init`, including on text inputs; opt back in with `Body.init({ nativeContextMenu: true })`. Follow the surrounding entries' bold-lead-sentence style and end with the consumer-action note.

`packages/lib/llms.txt` is generated from `scripts/llms/manifest.data.mjs` and needs no change — it indexes capabilities and hard rules, and this adds neither a new symbol to reach for nor a rule a feature author must follow.

---

## Potential Challenges

- **Test isolation across cases in one file.** `Event`'s `viewportListenerMap` is module-level state that `DOM.reset()` does not clear, and `installTestDOM` mints a fresh window handle each time — so a registration made in one case is invisible to the next case's sink and blocks re-registration. The header comment on [`tests/dom/viewport-consume.test.ts:13-20`](packages/lib/tests/dom/viewport-consume.test.ts#L13) documents this. Mitigation: the new tests live in their own file, and the `afterEach` calls `Body.getInstance().setNativeContextMenu(true)` *before* `DOM.reset()`, which empties the `"contextmenu"` entry so the next case re-registers cleanly against its own sink.
- **A component that wants the native menu can no longer get it.** Suppression is page-wide and `preventDefault` cannot be undone by a later listener, so `nativeContextMenu: true` is the only escape and it is all-or-nothing. Mitigation: documented in `Body.md` and the changelog entry; a per-component override is a `## Non-Goals`.
- **Text inputs lose their native editing menu.** Right-clicking a `TextField` no longer offers cut / copy / paste / spellcheck. Mitigation: called out explicitly in `Body.md` and the changelog so a consumer who needs it knows to opt back in; keyboard cut/copy/paste is unaffected.
- **`removeViewportListener` misbehaves on an unregistered listener.** `indexOf` returns `-1` and `splice(-1, 1)` then drops the array's last entry ([`Event.ts:633`](packages/lib/src/typescript/lib/core/Event.ts#L633)). Mitigation: the setter's `listening` guard means `removeViewportListener` is only ever called when the listener is registered. Do not "fix" `Event.ts` as part of this plan.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Body.ts`](packages/lib/src/typescript/lib/core/Body.ts) — the file being changed; read the `favicon` pattern (`static init` at 75, `applyOptions` at 91, `setFavicon`/`getFavicon` at 110/126) end to end first, since this feature copies its shape.
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `captureOpts` (60), `applyDisposition` (71), `baseViewportListener` (212), `addViewportListener` (581), `removeViewportListener` (618).
- [`packages/lib/src/typescript/lib/component/menubar/MenuBar.ts:256`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L256) — the guarded add/remove precedent.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts:1177-1210`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1177) — the same guard plus the prototype-method-not-arrow-field rule for a viewport listener.
- [`packages/lib/src/typescript/lib/component/container/CollapseButton.ts:352`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L352) — a component `contextmenu` handler that must keep working unchanged.
- [`packages/lib/tests/dom/viewport-consume.test.ts`](packages/lib/tests/dom/viewport-consume.test.ts) — the offline dispatch pattern and the test-isolation warning.
- [`packages/lib/tests/core/Favicon.test.ts`](packages/lib/tests/core/Favicon.test.ts) — how a `Body.init`-dispatched default is asserted against `sink.writes`.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `record` (381), `writes` (368), `dispatchEvent` (607), `makeEvent` (1431).

---

## Non-Goals

- **No changes to any component's `contextmenu` handling.** `Tree`, `DiagramView`, `AbstractSelectableList`, `CollapseButton`, `TabBar`, the table header cells, and `SplitGutter` are untouched; their local `preventDefault` becomes redundant under the default but stays correct and stays needed under `nativeContextMenu: true`.
- **No per-component or per-element opt-out.** The toggle is page-wide on `Body`. A component-level "allow the native menu here" API would need the global handler to hit-test every event, which is cost and surface this feature does not need.
- **No fix to `removeViewportListener`'s `indexOf === -1` splice.** It is a pre-existing hazard, guarded at this call site; fixing `Event.ts` is out of scope.
- **No suppression for apps that never call `Body.init`.** They opt out of the documented mount path; `Body.getInstance().setNativeContextMenu(false)` is the one-line fix, exactly as `Favicon.install()` is for the icon.

---

## Implementation Notes

**`BodyContextMenu.test.ts`'s `afterEach` needed one more call than the plan specified.** The plan mandated `Body.getInstance().setNativeContextMenu(true); DOM.reset();`, in that order. Every `Body.init({})` call in the new tests leaves `favicon` unconfigured, so it installs the default favicon as a side effect; `Favicon` caches the handle it wrote through in module-level state (`Favicon._link`), which survives across `it` blocks in the same file. That handle does not resolve against the fresh `TestHandleTable` `DOM.reset()` installs for the next case, so the second test to reach `Body.init` threw `TestHandleTable: handle N is not registered`. Added `Favicon._reset()` as the first statement in the `afterEach` — the exact guard `tests/core/Favicon.test.ts` already uses, for the reason its own doc comment states: "a suite that resets the DOM between cases must reset this too." No production code or public API changed; this is test-file-only.

---

## Notes

[^init-not-constructor]: `Body`'s private constructor runs from the static field initializer `private static readonly INSTANCE: Body = new Body()` at module import — before an app has had a chance to pass options, and before a test harness has installed its DOM seams. Registering from the constructor would therefore attach the window listener to whatever sink happened to be installed at import time and would ignore `nativeContextMenu` entirely. `Body` already hit this with the favicon and solved it the same way; the comment at `Body.ts:79-82` states the reasoning. The instance-level `protected init()` at `Body.ts:154` is no better — it is called from that same constructor.

[^derived-flag]: A separate `_listening` boolean would duplicate information the options bag already holds, and it would land on the wrong side of the `super()`-cascade rule in `CODE_CONVENTIONS.md`: `setNativeContextMenu` is reachable from `applyOptions`, which runs inside `super()`, so the field would have to be declared bare with `declare` and would then read `undefined` rather than `false` until first written — a `boolean`-typed field that is not a boolean. Deriving `listening` from `this._options.nativeContextMenu === false` removes the field and the trap together, and keeps the options bag as the single cache that ARCHITECTURE.md's "always cache in memory" rule asks for. `MenuBar` and `Markdown` keep real fields because their listening state is independent of any option (menu open, render queue non-empty); here it is a pure function of the option, so this is the same guard sourced from the existing cache rather than a different design.

[^prevent-only]: Two rules meet here. ARCHITECTURE.md's event section requires a DOM-routed listener to tell the dispatcher what to do by return value rather than calling `stopPropagation()`/`preventDefault()` itself, and `applyDisposition` (`Event.ts:71`) is what turns `{ prevent: true }` into the `preventDefault()` call. Returning a stop would be actively harmful: the same event is delivered to `Event`'s other window-capture handler, which is what routes `contextmenu` to `Tree`, `DiagramView`, `TabBar`, and the table header cells. `stopPropagation()` does not prevent other listeners on the same node from running (nothing in the library calls `stopImmediatePropagation`), so the two handlers coexist regardless of which registered first — but returning `{ stop: true }` would still cut short the subtree dispatcher's ancestor walk for any component whose listener had not yet run. `preventDefault()` from either handler is idempotent, so a component that also prevents the default costs nothing. Passivity is not a concern: `contextmenu` is not in `Event.ts`'s `PASSIVE_TYPES`, so `captureOpts` registers it with `passive: false` and `preventDefault()` takes effect.

[^prototype-method]: An arrow-function class field is initialised after `super()` returns. `setNativeContextMenu` is dispatchable from `applyOptions`, which runs inside `super()`, so an arrow field would read `undefined` at that moment and `addViewportListener`'s falsy-argument guard would silently drop the registration after a `console.trace`. A prototype method exists before the constructor runs and has stable identity across calls, which `removeViewportListener` needs to find it. `Markdown.handleViewportChange` documents this same reasoning for the same API.

[^default-false]: Naming the option for the thing it enables (`nativeContextMenu`) rather than the thing it does (`suppressNativeContextMenu`) avoids a double negative at the call site: `nativeContextMenu: true` reads as "let the browser's menu through", where `suppressNativeContextMenu: false` has to be decoded. The default is `false` because the request is that native menus be opt-in. The runtime setter is not speculative surface — it is the documented route for an app that mounts without `Body.init`, and it is what lets the test file reset the registration between cases.
