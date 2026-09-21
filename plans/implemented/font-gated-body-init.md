---
depends-on: [body-lazy-singleton]
touches-shared:
  - packages/lib/src/typescript/lib/core/Theme.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
  - packages/qa/src/mount.ts
---

# Font-gated Body bootstrap — Implementation Plan

## Overview

An app built on this library measures its text against the wrong font. The QA
app's `menus` panel reports the first `.MenuBarButton` as **44 px** wide in
WebKitGTK where it should be **39**, and 150 units of ordinary layout work never
correct it — only a manual `ThemeManager.setTheme` does.[^measured] The cause is
an ordering one. `Body`'s constructor is the only thing that applies the default
theme, which is what injects the bundled Manrope `@font-face` rules and starts
the face loading
([`core/Body.ts:196`](packages/lib/src/typescript/lib/core/Body.ts#L196) →
[`core/Theme.ts:1416`](packages/lib/src/typescript/lib/core/Theme.ts#L1416)).
Since that constructor now runs on the first `Body.init()` call, and the
documented idiom is `Body.init({ components: [root] })`, every app builds and
measures its whole component tree *before* the font exists.

This plan makes `Body.init` an awaited startup bootstrap instead: it applies the
theme, starts the face loading, and resolves once the face is live or a bounded
deadline expires. `components` leaves `BodyOptions`, so an app can no longer
structurally build its tree first — it awaits `Body.init`, then builds, then
adds. Because nothing is constructed until the face is live, the startup layout
gate that used to race the font
([`core/FirstLayoutGate.ts`](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts))
has nothing left to hold and is deleted along with the render- and
scroll-deferral it drove in `Tree` and the table body.

The change is small in the library — one new framework-internal module, three
edited core files, three stripped component files — and wide in its call sites:
every `Body.init` in the monorepo's four apps, nine documentation fragments, and
the two unreleased reference pages that describe the behaviour this supersedes.

---

## Architecture Decisions

### `Body.init` becomes the awaited startup bootstrap

`Body.init(options)` returns `Promise<Body>`. Its synchronous half is unchanged
— it reaches the singleton (which applies the theme, injects the `@font-face`
rules and starts the face loading), rebinds the element buffers and dispatches
`options`. It then awaits the font and resolves with the
instance.[^why-await-not-reorder]

The wait always settles, on whichever of three things comes first: the font set
reporting a batch of loads settled, a bounded deadline, or the discovery that no
asynchronous font load is possible in this host at all.

| Host / condition | `DOM.source.startFontLoad` | What settles the wait | `Body.init` resolves |
|---|---|---|---|
| Browser, face activates | `true` | the font set's `loadingdone` | on activation (~1.4 ms)[^activation-cost] |
| Browser, face never activates | `true` | the 50 ms deadline | 50 ms after the load started |
| Browser with no CSS Font Loading API | `false` | the same call, immediately | on the next microtask |
| Offline modelled source (`vitest`) | `false` | the same call, immediately | on the next microtask |

`Body.init` never rejects. A face that fails to download still fires
`loadingdone`, and a face that reports nothing at all is covered by the
deadline.

### `components` leaves `BodyOptions`

`BodyOptions` becomes `extends Omit<ComponentOptions, "components">`. Every
other field stays — `layoutManager`, `favicon`, `nativeContextMenu`,
`backgroundColor` and the rest are all safe to apply before any component
exists. A surviving `Body.init({ components: […] })` is a compile error, which
is the loud half of the migration signal.[^why-omit]

### `Body.getInstance()` keeps its synchronous contract

`getInstance()` is unchanged: same signature, still constructs the singleton on
first call, still applies the theme and starts the font load through that
constructor. It offers no font guarantee — it is the accessor for reaching a
body that is already mounted, and every one of its callers is
synchronous.[^getinstance-sync]

Called before `Body.init` has resolved, it hands back a usable body. Text
measured from a tree built at that point is measured against the browser's
fallback face; the `loadingdone` re-measure still corrects it afterwards, and
the warning below names the fix.

### The wait is built above the DOM seam, not inside it

`DOMSource.startFontLoad` keeps returning `boolean` and `DOMSource.onFontsReady`
keeps its callback shape. The promise is assembled above them, in a new
framework-internal module
[`core/FontActivation.ts`](packages/lib/src/typescript/lib/core/FontActivation.ts),
from the existing pair plus one `DOM.sink.setTimeout`. No seam member changes,
so neither host implementation nor its tests move.[^seam-untouched]

`core/FontActivation.ts` imports nothing. That is what lets `core/DOM.ts` read
it for the warning below without a cycle, and it mirrors the module family the
codebase already uses for state two modules must share without importing each
other — `core/PendingTransitions.ts`, `core/ClassStyleRules.ts`,
`core/ComponentDefaults.ts`, and the `core/FirstLayoutGate.ts` this replaces.

### The startup layout gate is deleted; the font reflow is kept

`core/FirstLayoutGate.ts` and every consumer go: the `isFirstLayoutHeld()` check
in [`core/Component.ts:270`](packages/lib/src/typescript/lib/core/Component.ts#L270),
and the render- and scroll-deferral cluster it drove in
[`component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts),
`component/tree/Tree.ts` and `component/table/Body.ts`. With the tree built
after activation there is no first flush left to hold.[^delete-the-gate]

What survives is `ThemeManager`'s `onFontsReady` → `reflowText()` tail. A later
batch of faces still settles after startup — the Latin-Ext subset stays lazy,
and an app may load a face of its own — and each such batch must still
invalidate the shared text-metrics cache and re-flow every subscribed `Text`.

### One warning when text is measured before the font settles

`ProductionDOMSource`'s three measurement methods emit a single `console.warn`
the first time one of them runs while the startup font wait is unsettled. The
compile error above only catches an app that used `components`; an app that
builds its tree from `Body.getInstance()` gets no compile-time signal at all and
would keep the silent wrong-pixel bug.[^why-warn]

### What `body-lazy-singleton` decided, and what this replaces

`plans/implemented/body-lazy-singleton.md` stands in full on its own goal — no
DOM access at import, `./core` importable with no `document`, and
`packages/lib/tests/unit/import-without-dom.test.ts` green with an empty
exception set. Its lazy singleton, its `ThemeManager.themeApplied` flag and its
`_applyDefaultTheme()` door are all kept unchanged.

What this plan replaces is that plan's answer to the timing consequence. Its
*Expected Behaviour 8* accepted that "components built before the first `Body`
touch re-measure once", and its migration note prescribed a bare
`Body.getInstance()` as the remedy for a jsdom suite. Awaiting `Body.init`
removes the ordering instead of compensating for it, so that note is rewritten
rather than extended, and the two QA jsdom primes it added keep only their
narrower reason.[^lazy-singleton-delta]

---

## Public API

```typescript
// core/Body.ts
export interface BodyOptions extends Omit<ComponentOptions, "components"> {
    favicon?: string | false;
    nativeContextMenu?: boolean;
}

class Body extends Component<BodyOptions> {
    static init(options?: BodyOptions): Promise<Body>;   // was: (options?) => Body
    static getInstance(): Body;                          // unchanged
}
```

```typescript
// core/FontActivation.ts — framework-internal; NOT exported from core/index.ts
export const FONT_ACTIVATION_DEADLINE_MS = 50;

export function isFontActivated(): boolean;
export function whenFontActivated(): Promise<void>;
export function noteFontActivated(): void;
```

Removed: the whole of `core/FirstLayoutGate.ts` (`FIRST_LAYOUT_HOLD_MS`,
`holdFirstLayout`, `isFirstLayoutHeld`, `startFirstLayoutDeadline`,
`releaseFirstLayout`); four `protected` members of `VirtualRowView`
(`deferRenderWhileFirstLayoutHeld`, `wasRenderDeferred`, `finishResumedRender`,
`renderWindowIfDeferred`); and its private `holdScrollWhileFirstLayoutHeld` /
`applyPendingScroll` pair. None is exported from a package entry point.

`ensureFontLoaded()` in `core/Theme.ts` changes from `(): boolean` to `(): void`
— it is module-private.

---

## Internal Structure

`core/FontActivation.ts` in full:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal state for the one-shot startup font wait. `Theme.ts`
// settles it — on the font set's `loadingdone`, on the bounded deadline it
// arms beside the load, or immediately where no asynchronous load is possible
// at all. `Body.ts` awaits it, so an app builds its component tree against the
// face it will keep rather than racing it. `DOM.ts` reads it to warn once
// about a measurement taken before then. Not exported from `core/index.ts`:
// this module exists purely to let those three share this bookkeeping without
// importing each other, mirroring `core/PendingTransitions.ts`,
// `core/ClassStyleRules.ts` and `core/ComponentDefaults.ts`. It imports
// nothing, so `core/DOM.ts` can read it with no import cycle.

/**
 * How long the startup bootstrap may wait for the face once the main thread is
 * free.
 *
 * @remarks Carried over from the startup layout gate this replaces, with its
 * measurement intact: the framework's two inline font subsets activate in
 * ~1.4 ms and ~0 ms on an idle main thread, so this is over an order of
 * magnitude of headroom. It cannot usefully be much longer — on the failure
 * path this is exactly how long an app's startup is stalled before it may
 * build anything.
 */
export const FONT_ACTIVATION_DEADLINE_MS = 50;

/** Whether the startup font wait has settled. */
let _activated: boolean = false;

/** The promise handed to waiters, created on the first {@link whenFontActivated}. */
let _pending: Promise<void> | null = null;

/** `_pending`'s resolve function, held until the wait settles. */
let _settle: (() => void) | null = null;

/**
 * Whether the startup font wait has settled — the face is active, its deadline
 * expired, or no asynchronous load was ever possible here.
 *
 * @returns `true` once the wait has settled.
 */
export function isFontActivated(): boolean {
    return _activated;
}

/**
 * Returns a promise that resolves when the startup font wait settles. Never
 * rejects.
 *
 * @returns A promise for the settled wait.
 *
 * @remarks Call only once a theme has been applied — `setTheme` is what arms
 * the deadline, so a call made before it could wait on nothing. `Body.init`
 * guarantees the ordering by reaching the singleton first.
 */
export function whenFontActivated(): Promise<void> {
    if (_activated) {
        return Promise.resolve();
    }

    if (!_pending) {
        _pending = new Promise<void>(resolve => { _settle = resolve; });
    }

    return _pending;
}

/**
 * Settles the wait and releases every waiter. Idempotent — a second font batch
 * settling later is a no-op here.
 */
export function noteFontActivated(): void {
    if (_activated) {
        return;
    }

    _activated = true;

    const settle = _settle;

    _settle = null;
    settle?.();
}
```

`core/Theme.ts` — the deadline and the two paths that end the wait:

```typescript
// The bounded deadline armed beside the font load, so a face that never
// reports back cannot stall an app's startup. Cleared when activation wins.
let _fontDeadline: TimerId | null = null;

/** Ends the startup font wait, cancelling the deadline if it is still armed. */
function finishFontActivation(): void {
    if (_fontDeadline !== null) {
        DOM.sink.clearTimeout(_fontDeadline);
        _fontDeadline = null;
    }

    noteFontActivated();
}
```

`ensureFontLoaded()`'s tail, replacing today's `return DOM.source.startFontLoad(…)`:

```typescript
    if (!DOM.source.startFontLoad(MANROPE_FAMILY)) {
        // This source cannot load a face asynchronously, so nothing will ever
        // report back and the face already in use is the final one.
        finishFontActivation();

        return;
    }

    _fontDeadline = DOM.sink.setTimeout(finishFontActivation, FONT_ACTIVATION_DEADLINE_MS);
```

`core/Body.ts` — `init`'s body. Everything down to the `await` runs
synchronously on the calling tick, so a caller that does not await still gets
its options applied immediately:

```typescript
    static async init(options: BodyOptions = {}): Promise<Body> {
        const instance = Body.getInstance();

        instance.reattachElementBuffers();
        instance.applyOptions(options);

        if (options.favicon === undefined) {
            instance.setFavicon(DEFAULT_FAVICON);
        }

        if (options.nativeContextMenu === undefined) {
            instance.setNativeContextMenu(false);
        }

        await whenFontActivated();

        return instance;
    }
```

`core/DOM.ts` — the one-shot warning, beside the existing module-level probe
helpers:

```typescript
// One-shot guard for the early-measurement warning below.
let _earlyMeasureWarned: boolean = false;

/**
 * Warns once when a string is measured before the startup font wait settled,
 * which means it is sized against the browser's fallback face and will move
 * when the real one arrives.
 */
function _warnEarlyMeasure(): void {
    if (_earlyMeasureWarned || isFontActivated()) {
        return;
    }

    _earlyMeasureWarned = true;

    console.warn(
        "typescript-ui: text was measured before the startup font settled, so it is sized against "
        + "the browser's fallback face. Await Body.init(...) before building components.",
    );
}
```

---

## Ordered Implementation Steps

Run library commands from `packages/lib` unless a step says otherwise. Steps 1
and 2 are expected to fail; step 3 onward makes them pass.

1. **`packages/lib/tests/core/StartupTextMetrics.test.ts` — the invariant, new
   file (red).** Port the working probe at
   `/tmp/claude-1000/-home-jika-typescript-loom/830a3250-2ae3-4aa7-9de8-6a3af9d923eb/scratchpad/StartupTextMetrics.test.ts`
   **verbatim** apart from three things: replace its `// SCRATCH INVESTIGATION
   PROBE — delete before commit.` header with a real one describing the
   invariant, point its two relative imports at `'../dom/font-metrics.test-font.json'`
   and `'../dom/TestDOM'`, and keep the rest — the `primeTheme` parameter, the
   `ThemeManager.setTheme` and `DOM.source.measureText` / `measureTexts` spies,
   the fresh module graph, and both cases — exactly as written. Run
   `npx vitest run tests/core/StartupTextMetrics.test.ts` — expect
   `measures no text before the theme has been applied` to fail with
   `expected [ 'File', 'New' ] to deeply equal []` and the control case to pass.
   This is the red that proves the probe sees the bug; step 5 rewrites the file
   to the new contract.

2. **`packages/lib/tests/core/Body.test.ts` — the new contract.** Add three
   cases to the `Body.init` describe, and convert its existing case:

   - Existing case at `:26` — `Body.init({ layoutManager: fit, components: [child] })`
     becomes `const body = await Body.init({ layoutManager: fit });` followed by
     `body.addComponent(child);`; make the `it` callback `async`. The three
     assertions stand.
   - **B6. resolves with the singleton.** `await Body.init({})` is
     `Body.getInstance()`.
   - **B7. applies its options synchronously.** Call `Body.init({ layoutManager: fit })`
     without awaiting, then assert `Body.getInstance().getLayoutManager()` is
     `fit` on the same tick; `await` the promise afterwards so the case leaves
     nothing pending.
   - **B8. `components` is not a `BodyOptions` field.** One line under a
     `// @ts-expect-error` comment: `Body.init({ components: [new Component({})] });`.

   Convert `B5`'s `FreshBody.init({ components: [button] })` at `:107` to
   `FreshBody.init({})` — the case is about the theme-change fan-out reaching a
   pre-built component, not about the mount.

   B8 is the red one here: `npm run typecheck:test` fails today with an unused
   `@ts-expect-error` directive, and stops failing once step 5 removes the
   field. B6 and B7 pass either way, because `await` passes a non-promise
   straight through — they are standing guards on the contract, not red-green
   drivers.

3. **Create `packages/lib/src/typescript/lib/core/FontActivation.ts`** exactly
   as given in `## Internal Structure`. Verify: `npm run typecheck` clean.

4. **`packages/lib/src/typescript/lib/core/Theme.ts` — swap the gate for the
   wait.**
   - Line 22: replace the `~/core/FirstLayoutGate.js` import with
     `import { FONT_ACTIVATION_DEADLINE_MS, noteFontActivated } from '~/core/FontActivation.js';`
     and add `import type { TimerId } from '~/core/DOM.js';`.
   - Beside `_fontInjected` (line 1270): add the `_fontDeadline` declaration and
     the `finishFontActivation` function from `## Internal Structure`.
   - `ensureFontLoaded` (lines 1288–1315): change the return type to `void`,
     drop the two `return false;` statements in favour of a bare `return;`, and
     replace the final `return DOM.source.startFontLoad(MANROPE_FAMILY);` with
     the block from `## Internal Structure`. Rewrite its `@returns` tag as a
     `@remarks` sentence saying the call starts the load and arms the bounded
     deadline, or settles the wait at once where no asynchronous load is
     possible.
   - `setTheme` (lines 1372–1381): replace
     `const fontLoadStarted = ensureFontLoaded();` with `ensureFontLoaded();`
     and delete the `if (fontLoadStarted) { holdFirstLayout(); }` block and its
     comment. `ThemeManager.scheduleFontReflow();` stays where it is.
   - `onFontsSettled` (lines 1456–1459): `releaseFirstLayout()` →
     `finishFontActivation()`. Update its `@remarks` to say the order is
     load-bearing because the awaited bootstrap must resolve against refreshed
     metrics.

   Verify: `npm run typecheck` clean.

5. **`packages/lib/src/typescript/lib/core/Body.ts` — the awaited bootstrap.**
   - Line 14: `BodyOptions extends Omit<ComponentOptions, "components">`, with a
     one-line comment saying `components` is omitted because the tree must be
     built after `init` resolves.
   - Add `import { whenFontActivated } from "~/core/FontActivation.js";`.
   - Replace `init`'s body (lines 89–112) with the one from
     `## Internal Structure`, and rewrite its JSDoc: it now resolves once the
     theme's web font is active or a bounded deadline expires, and the caller
     builds its component tree after awaiting it. Keep both inline comments
     about the favicon and native-menu defaults.
   - Class JSDoc (lines 35–41) and `getInstance`'s JSDoc (lines 49–56): replace
     the `Body.init({ layoutManager: Fit(), components: [shell] })` example with

     ```typescript
     const body = await Body.init({ layoutManager: Fit() });

     body.addComponent(shell);
     ```

     and say plainly that `getInstance()` does not wait for the font.
   - **`packages/lib/tests/core/StartupTextMetrics.test.ts` — rewrite to the new
     contract.** Step 1's `Body.init({ layoutManager: Fit(), components: [bar] })`
     no longer compiles. Replace the `primeTheme` parameter with
     `awaitInit: boolean` and the mount with:

     ```typescript
     if (awaitInit) {
         // The documented pattern: bootstrap, then build, then add.
         const body = await Body.init({ layoutManager: Fit() });
         const bar  = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'New' }] }] });

         body.addComponent(bar);
     } else {
         // The superseded pattern, kept so the probe cannot pass vacuously.
         const bar = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'New' }] }] });

         (await Body.init({ layoutManager: Fit() })).addComponent(bar);
     }
     ```

     The two cases become `runApp(true)` records `[]` and `runApp(false)`
     records `['File', 'New']`. Drop the `releaseFirstLayout()` import from the
     `afterEach`, keeping its `vi.restoreAllMocks()` and `vi.resetModules()`.

   Verify: `npm run typecheck` clean; `npx vitest run tests/core/StartupTextMetrics.test.ts tests/core/Body.test.ts` green.

6. **Delete `packages/lib/src/typescript/lib/core/FirstLayoutGate.ts`** and
   strip `packages/lib/src/typescript/lib/core/Component.ts`: remove the import
   at line 7, and the `if (isFirstLayoutHeld()) { … }` block plus its comment at
   lines 266–275 of `flushPendingLayouts`.

7. **`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` —
   remove the deferral cluster.** Delete each member whole, from its JSDoc
   opener to its closing brace: the import (line 7); the five fields and their
   comments (lines 81–89); the `holdScrollWhileFirstLayoutHeld` guard in
   `setScrollX` (line 181) and in `setScrollY` (line 201), leaving each setter's
   `resetWheelEase()` call and its delegate; `holdScrollWhileFirstLayoutHeld`
   itself (lines 199–256); `applyPendingScroll` (lines 257–285); the
   `isFirstLayoutHeld()` block and comment inside `scrollRowIntoView` (lines
   826–835); and the four methods `deferRenderWhileFirstLayoutHeld`,
   `wasRenderDeferred`, `finishResumedRender` and `renderWindowIfDeferred`
   (lines 694–792). Keep every other member in that range — `_rowLayoutOwed`,
   `_rowWidthMoved` and `_resizeSettleHandle` belong to the resize-settle relay,
   not to this cluster.

8. **`packages/lib/src/typescript/lib/component/tree/Tree.ts` — three call
   sites.**
   - Line 2080: delete the `if (this.deferRenderWhileFirstLayoutHeld()) { return; }` block.
   - Lines 2160–2166: delete the whole `if (this.finishResumedRender()) { this._updateActiveDescendant(); }`
     block and its comment. It exists only to redo what a deferred pass skipped.
   - Lines 2292–2300: replace the `if (!this.renderWindowIfDeferred()) { this.renderWindow(); }`
     block and its comment with a bare `this.renderWindow();`.

9. **`packages/lib/src/typescript/lib/component/table/Body.ts` — four call
   sites.**
   - Lines 1059–1064: delete the `if (this.wasRenderDeferred()) { return; }`
     block and its comment from `onScrollerTick`, leaving the two `emit` calls
     under their `if (this._scroller)` guard.
   - Lines 1114–1124: delete the whole `doLayout()` override and its JSDoc — its
     only content besides `super.doLayout()` is `renderWindowIfDeferred()`.
   - Line 1158: delete the `if (this.deferRenderWhileFirstLayoutHeld()) { return; }` block.
   - Lines 1170–1178: delete the `this.finishResumedRender();` call and its
     comment.

   Verify: `npm run typecheck` and `npx eslint src` clean. Grep checkpoint from
   the repository root:
   `grep -rn 'FirstLayoutGate\|isFirstLayoutHeld\|renderWindowIfDeferred\|finishResumedRender\|wasRenderDeferred' packages/lib/src` —
   expect zero matches.

10. **Delete `packages/lib/tests/core/FirstLayoutGate.test.ts`.** Every one of
    its 28 cases is conditioned on an explicit `holdFirstLayout()`; none asserts
    anything that survives the gate.[^gate-tests]

11. **`packages/lib/tests/dom/fonts-ready.test.ts` — replace the gate describe.**
    Replace the `ThemeManager — startup layout gate` describe (lines 168–243)
    with a `ThemeManager — startup font wait` describe carrying four cases, each
    in a fresh module graph the way the deleted ones were (`vi.resetModules()`
    then dynamic imports of `~/core/Theme` **and** `~/core/FontActivation` from
    that same graph):

    - settles on `loadingdone`: `isFontActivated()` is `false` after
      `setTheme`, `true` after `fontSet.completeLoadBatch()`.
    - settles at once when the engine cannot load fonts asynchronously
      (`Reflect.deleteProperty(document, 'fonts')`): `isFontActivated()` is
      `true` immediately after `setTheme`.
    - refreshes the text metrics before it settles — the existing third case,
      re-aimed: sample `isFontActivated()` from inside an `onThemeChange`
      listener registered after `setTheme`, and assert it reads `false` there
      while `Util.textMetricsGeneration()` has grown by the time the batch
      completes.
    - settles on the deadline: with `vi.useFakeTimers()` and a batch that never
      completes, `vi.advanceTimersByTime(FONT_ACTIVATION_DEADLINE_MS)` settles
      it.

    Then add a `Body.init — awaited bootstrap` describe with three cases:
    resolves only after `completeLoadBatch()` (record settlement in a `.then`
    and drain microtasks to prove it was pending before); resolves without
    waiting when `document.fonts` is absent; and a second `Body.init({})`
    resolves with the same instance. Change the existing `Body — web font
    download` describe's `afterEach` to drop its `releaseFirstLayout` import.

    Verify: `npx vitest run tests/dom/fonts-ready.test.ts` green.

12. **`packages/lib/src/typescript/lib/core/DOM.ts` — the one-shot warning.**
    Add `import { isFontActivated } from "~/core/FontActivation.js";` beside the
    existing type imports, the `_earlyMeasureWarned` guard and `_warnEarlyMeasure`
    helper from `## Internal Structure` beside `_applyProbeStyles`, and a
    `_warnEarlyMeasure();` call as the first statement of `ProductionDOMSource`'s
    `measureText` (line 2219), `measureTextWidths` (line 2271) and `measureTexts`
    (line 2315). `ModelledDOMSource` gets none — offline measurement is against
    baked metrics and the invariant is pinned directly by step 1.

    Add a case to `tests/dom/fonts-ready.test.ts`: with `document.fonts` stubbed
    idle and a `vi.spyOn(console, 'warn')`, a `measureText` through a fresh
    `ProductionDOMSource` warns exactly once, and warns no further after
    `completeLoadBatch()`.

13. **Remaining library test call sites.** In `tests/core/BodyContextMenu.test.ts`
    (10 sites) and `tests/core/Favicon.test.ts` (5 sites), every `Body.init(…)`
    is configuration-only and may stay unawaited — no lint rule forbids a
    floating promise here — except the four that read the returned value
    (`BodyContextMenu.test.ts:69`, `:130`, `Favicon.test.ts:107`, `:116`), which
    become `const body = await Body.init(…)` in an `async` callback. In
    `tests/component/table/HeaderThemeReflow.test.ts:154`, replace
    `Body.init({ layoutManager: new Fit(), components: [table] })` with
    `(await Body.init({ layoutManager: new Fit() })).addComponent(table)` and
    make the callback `async`.

    Verify: `npm test` green.

14. **`packages/lib/src/typescript/main.ts` — the demo app.** Line 49:
    `Body.init({ layoutManager });` → `await Body.init({ layoutManager });`. The
    module already uses top-level `await` (line 144), and every panel is built
    lazily by `router.start()` further down, so no reordering is needed.

15. **`packages/qa/src/mount.ts` — mount after the bootstrap.** In `mountPanel`,
    move the mount above the build and split it:

    ```typescript
    const body  = await Body.init({ layoutManager: Fit() });
    const n     = parseScale(params.get('n'), module.defaultScale);
    const build = module.build(n, params);

    body.addComponent(build.root);
    ```

    Then update the two jsdom primes' comments, keeping the `Body.getInstance()`
    calls: `packages/qa/tests/panels.test.ts:22-28` (the file also calls
    `module.build(…)` directly at `:76`, `:104` and `:122`, so the prime is still
    what themes those trees) and `packages/qa/tests/mount.test.ts:18-23`. Both
    comments currently say "`mountPanel` builds a panel before it calls
    `Body.init`", which is no longer true; say instead that the prime applies the
    default theme before any tree this file builds outside `mountPanel`.

16. **`packages/docs/src/main.ts` — the docs app.** Move `const shell = new DocsShell(router)`
    (line 9) below a new `const body = await Body.init({ layoutManager: Fit() })`,
    replace line 22 with `body.addComponent(shell)`, and leave `router.start()`
    last with its comment intact. Then convert the twelve `Body.init({ layoutManager: Fit(), components: [x] })`
    calls in `packages/docs/tests/DocsSidebar.test.ts` (11) and
    `DocsContent.test.ts` (1) to
    `const body = await Body.init({ layoutManager: Fit() }); body.addComponent(x);`,
    making each enclosing callback `async`. Update the three comments that name
    the `components` option — `DocsSidebar.test.ts:54-58` and
    `DocsContent.test.ts:63`, `:148`.

17. **`packages/create-app/template/src/main.ts` — the scaffold.** This is the
    shape the documentation teaches, so it uses an async entry function rather
    than top-level `await`, which a consumer's bundler may not allow:

    ```typescript
    import { Body } from '@jimka/typescript-ui/core'
    import { Fit } from '@jimka/typescript-ui/layout'
    import { Header } from '@jimka/typescript-ui/component/display'

    async function main(): Promise<void> {
        const body = await Body.init({ layoutManager: Fit() })

        body.addComponent(Header('Hello from typescript-ui'))
    }

    void main()
    ```

18. **Documentation — the nine mount fragments.** Apply one transformation
    everywhere a snippet builds a component and then mounts it: hoist an
    `await Body.init()` above the build, and turn the mount line into an
    `addComponent` call.

    | Before | After |
    |---|---|
    | `const bar = MenuBar([…]);`<br>`Body.init({ components: [bar] });` | `const body = await Body.init();`<br>`const bar  = MenuBar([…]);`<br>`body.addComponent(bar);` |

    The fragments: `docs/guide/index.md:23`, `docs/components/MenuBar.md:29`,
    `docs/components/Window.md:25`, `docs/components/TabWindow.md:19`,
    `docs/recipes/crud-table.md:47`, `docs/recipes/custom-theme.md:47`,
    `docs/recipes/keyboard-shortcuts.md:35`,
    `docs/recipes/virtualized-list.md:28`, and
    `docs/recipes/floating-window.md:57`.

    Two of them open with a `ThemeManager.setTheme(…)` line —
    `docs/guide/index.md` and `docs/recipes/custom-theme.md`, whose section is
    titled *Apply at startup*. That line stays **above** the `await Body.init()`
    it now precedes: a theme chosen before the body is first reached is still
    honoured, and choosing it there is also what starts the font load earliest.

19. **Documentation — `packages/lib/docs/components/Body.md`.** The page is
    rewritten around the new contract:
    - Intro (line 3): `Body.init` is the awaited bootstrap; it resolves once the
      theme's web font is active.
    - Usage (lines 10–20) and Mounting (lines 23–36): the awaited shape, and
      `Body.init` "returns a promise for the singleton" rather than "returns
      it". Delete the sentence "`components` **appends** — calling `init` twice
      adds both sets of children rather than replacing the first", and say
      instead that a later `init` applies further options and resolves
      immediately. Extend the `getInstance()` paragraph: it never waits for the
      font, so build components only after `init` resolves.
    - Favicon (lines 40–50) and Context menu (lines 65–74) snippets: prefix each
      `Body.init(…)` with `await` and drop `components` from the three that
      carry it.
    - Notes (line 81): the Singleton bullet gains "…and `Body.init` resolves
      once the theme's web font is active or a 50 ms deadline expires, so text
      built after it is measured against the face the page keeps."

20. **Documentation — `packages/lib/docs/concepts/theming.md:23`.** The sentence
    "Because `Body` calls `setTheme` on construction, any app that mounts the
    framework gets Manrope automatically" gains a second clause: awaiting
    `Body.init` is what lets the first measurement see the face.

21. **Documentation — the llms rule.** In
    `packages/lib/scripts/llms/manifest.data.mjs:246`, rewrite convention 4 as:
    "Mount with `const body = await Body.init({ layoutManager })`, then
    `body.addComponent(root)` — build components only after `init` resolves; use
    `Body.getInstance()` only to reach the body afterwards." Then run
    `npm run docs:llms` from the repository root and commit the regenerated
    `packages/lib/llms.txt`.

22. **Documentation — `packages/lib/docs/reference/changelog/next.md`.**
    - Under `## Breaking changes` → `### Core`, a new entry: `Body.init` returns
      `Promise<Body>` and `BodyOptions.components` is removed; an app awaits the
      bootstrap and then adds its tree, because the singleton's construction is
      what applies the theme, injects the bundled `@font-face` rules and starts
      the face loading — so a tree built first is measured against the browser's
      fallback face.
    - Under `## Changed` → `### Core`, a second entry: the first layout pass no
      longer waits for the web font, because the bootstrap does. Name what goes
      with it — `Tree` and the table body no longer defer their render passes or
      hold a programmatic scroll during startup, and a post-layout callback
      registered during startup runs on the first frame again — and name what
      stays: a later batch of faces still refreshes the text metrics.
    - Revise the existing `Body` singleton entry (lines 28–41): its last clause
      describes `Body.init({ components: [shell] })` and the jsdom re-measure
      remedy, neither of which survives. Replace that clause with a pointer to
      the new breaking entry.

23. **Documentation — `packages/lib/docs/reference/migration/next.md`.** Replace
    the section "A jsdom suite that builds components before `Body.init()` must
    reach the body first" (lines 62–88) with "Mounting is awaited, and
    `BodyOptions.components` is gone". It carries, in this order: what changed
    and why, in two sentences (the singleton's construction is what applies the
    theme and starts the bundled face loading, so a tree built before that is
    measured against the browser's fallback face); this before/after pair, which
    is also the shape step 17's scaffold uses:

    ```typescript
    // Before
    const shell = buildAppShell();

    Body.init({ layoutManager: Fit(), components: [shell] });

    // After
    async function main(): Promise<void> {
        const body = await Body.init({ layoutManager: Fit() });

        body.addComponent(buildAppShell());
    }

    void main();
    ```

    then the note that `Body.getInstance()` is unchanged and does not wait for
    the font; and one paragraph for the jsdom case — a suite that must build
    before mounting calls `Body.getInstance()` first, as before. Add a short
    second section for the removed startup layout gate, stating that the 0.4.0
    caveats about `flushLayout()` / `resumeLayout()` and held scrolls during
    startup no longer apply.

24. **Full verification.** Run the `## Verification` block end to end.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/FontActivation.ts` |
| Create | `packages/lib/tests/core/StartupTextMetrics.test.ts` |
| Delete | `packages/lib/src/typescript/lib/core/FirstLayoutGate.ts` |
| Delete | `packages/lib/tests/core/FirstLayoutGate.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/main.ts` |
| Modify | `packages/lib/tests/core/Body.test.ts` |
| Modify | `packages/lib/tests/core/BodyContextMenu.test.ts` |
| Modify | `packages/lib/tests/core/Favicon.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderThemeReflow.test.ts` |
| Modify | `packages/lib/tests/dom/fonts-ready.test.ts` |
| Modify | `packages/qa/src/mount.ts` |
| Modify | `packages/qa/tests/panels.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/docs/src/main.ts` |
| Modify | `packages/docs/tests/DocsSidebar.test.ts` |
| Modify | `packages/docs/tests/DocsContent.test.ts` |
| Modify | `packages/create-app/template/src/main.ts` |
| Modify | `packages/lib/docs/components/Body.md` |
| Modify | `packages/lib/docs/components/MenuBar.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/TabWindow.md` |
| Modify | `packages/lib/docs/guide/index.md` |
| Modify | `packages/lib/docs/recipes/crud-table.md` |
| Modify | `packages/lib/docs/recipes/custom-theme.md` |
| Modify | `packages/lib/docs/recipes/keyboard-shortcuts.md` |
| Modify | `packages/lib/docs/recipes/virtualized-list.md` |
| Modify | `packages/lib/docs/recipes/floating-window.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/llms.txt` (generated by `npm run docs:llms`) |

---

## Expected Behaviour

Unit-testable, in the offline modelled harness unless a case says jsdom:

1. **No string is measured before the theme has been applied.** In a fresh
   module graph, `const body = await Body.init({ layoutManager: Fit() })`, then
   `const bar = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'New' }] }] })`,
   then `body.addComponent(bar)` records no `DOM.source.measureText` /
   `measureTexts` call taken before `ThemeManager.setTheme` ran.
2. **The probe is not vacuous.** The same app with the `MenuBar` built before
   the `await` records `['File', 'New']`.
3. **`Body.init` resolves with the singleton.** `await Body.init({})` is
   `Body.getInstance()`.
4. **Options are applied on the calling tick.** `Body.init({ layoutManager: fit })`
   leaves `Body.getInstance().getLayoutManager()` as `fit` synchronously, before
   the promise settles.
5. **`components` is not a `BodyOptions` field.** `Body.init({ components: [c] })`
   is a compile error — pinned by a `@ts-expect-error` line that
   `npm run typecheck:test` fails on if the error disappears.
6. **Offline runs never wait.** With the modelled source, `isFontActivated()` is
   `true` immediately after the first `setTheme`, and `Body.init` resolves on the
   next microtask. No suite hangs and no deadline timer is armed.
7. **jsdom — the wait settles on activation.** With an idle `document.fonts`
   stub, `Body.init({})` is still pending after two microtask drains and
   resolves once `loadingdone` fires.
8. **jsdom — the wait settles on the deadline.** With a batch that never
   completes, the promise resolves after `FONT_ACTIVATION_DEADLINE_MS` of fake
   time.
9. **jsdom — no Font Loading API, no wait.** With `document.fonts` deleted,
   `Body.init({})` resolves on the next microtask.
10. **A second `init` resolves immediately** and hands back the same instance.
11. **The metrics refresh precedes the settle.** Sampled from inside a
    theme-change listener during the `loadingdone` reflow, `isFontActivated()`
    still reads `false`.
12. **A later font batch still re-flows.** A second `loadingdone` after startup
    invalidates `Util.textMetricsGeneration()` — the existing
    `ThemeManager — font-swap reflow` case stays green.
13. **jsdom — one warning, once.** A `ProductionDOMSource.measureText` taken
    before the wait settles writes exactly one `console.warn`; a second call
    writes none, and no call after `loadingdone` writes any.
14. **Every public entry point still imports with no DOM.**
    `tests/unit/import-without-dom.test.ts` stays green with an empty exception
    set — `body-lazy-singleton`'s guarantee is untouched.
15. **A component built before `init` still gets one theme-change callback.**
    `Body.test.ts`'s B5, with `init({})` in place of `init({ components: [button] })`.
16. **Nothing defers a layout flush.**
    `grep -rn 'FirstLayoutGate\|isFirstLayoutHeld' packages/lib/src` returns
    nothing, and the table and tree suites stay green without their deferral
    paths.

Manual verification — **the implementer must not run any of these.** Each seizes
the physical desktop or needs a person at a browser:

17. **The in-engine check that confirms the fix.** Run the QA app's `menus`
    panel with `geom=1` under MiniBrowser or the Tauri host. Every unit's
    `geometry.menubarButton` must read **39 px** wide — the value
    `packages/qa/README.md:324` records as the C24 baseline
    (`4,4,39,28`) — against the **44** the same panel reports on
    `feature/body-lazy-singleton` and its tip.
18. **The demo app still mounts and is themed.** `npm run dev` in
    `packages/lib`, opened by a person: the shell renders in Manrope with Modern
    colours, and `MiscPanel`'s theme-cycle button still switches themes.
19. **The docs app still mounts.** `npm run docs:dev`, opened by a person.

---

## Verification

From the repository root unless stated:

- `npm run typecheck` — clean.
- `cd packages/lib && npx tsc -p tsconfig.test.json --noEmit` — clean. This is
  what enforces Expected Behaviour 5.
- `cd packages/lib && npx eslint src` — clean.
- `npm test` — the whole library suite green, `tests/unit/import-without-dom.test.ts`
  included with all 24 entry points importable.
- `grep -rn 'FirstLayoutGate\|isFirstLayoutHeld\|holdFirstLayout\|releaseFirstLayout\|renderWindowIfDeferred\|finishResumedRender\|wasRenderDeferred' packages/ | grep -v 'docs/reference/\|docs/api/'`
  — zero matches. The released `0.4.0` reference pages keep their historical
  text and are the reason for the filter.
- `grep -rn 'components: \[' packages/lib/docs packages/qa/src packages/docs/src packages/lib/src packages/create-app/template | grep 'Body\.init'`
  — zero matches.
- `cd packages/lib && npm run build` — the demo app builds, which is what proves
  its top-level `await` survives the Vite target.
- `npm run build:lib` — builds; prerequisite for the QA run below.
- `cd packages/qa && npm run typecheck && npx vitest run --dir tests` — green.
  **Never start the QA dev server, a panel window, MiniBrowser or a Tauri
  command.**
- `cd packages/docs && npm run typecheck && npx vitest run && npm run build` —
  green. The suite needs the generated API tree at `packages/lib/docs/api`; run
  `npm run docs:api` first if it is absent.[^docs-resolution]
- `npm run docs:api` — finishes with no new warning naming `Body`,
  `ThemeManager` or `FontActivation`.
- `npm run docs:llms:check` — the coverage gate passes; run `npm run docs:llms`
  and commit the regenerated `llms.txt`.

---

## Documentation Impact

- `packages/lib/docs/components/Body.md` — the page that teaches the idiom;
  rewritten in step 19.
- `packages/lib/docs/guide/index.md`, `docs/components/MenuBar.md`,
  `Window.md`, `TabWindow.md`, and the five recipes named in step 18 — one
  mount fragment each.
- `packages/lib/docs/concepts/theming.md:23` — one clause (step 20).
- `packages/lib/scripts/llms/manifest.data.mjs:246` and the regenerated
  `packages/lib/llms.txt` — convention 4 (step 21).
- `packages/lib/docs/reference/changelog/next.md` — one new breaking entry, one
  new changed entry, and a revision of the unreleased `Body` singleton entry
  (step 22).
- `packages/lib/docs/reference/migration/next.md` — the jsdom section is
  replaced, not extended, and a second section covers the removed layout gate
  (step 23).
- **No change** to `packages/lib/docs/reference/troubleshooting.md:34`: its
  `Body.getInstance()` reference is about tree reachability, which is unchanged.
- **No change** to the released `changelog/0.4.0.md` / `migration/0.4.0.md`
  pages, which describe the gate as it shipped.
- **No new TypeDoc surface.** `core/FontActivation.ts` is not exported from
  `core/index.ts`, so its members never render; per
  [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) nothing in public JSDoc may
  `{@link}` them — `Body.init`'s JSDoc describes the wait in prose instead.

---

## Potential Challenges

- **An app that never awaits loses its old safety net.** Deleting the gate means
  a tree built from a bare `Body.getInstance()` measures against the fallback
  face until the `loadingdone` reflow. Mitigation: the compile error on
  `components`, the migration note, and the one-shot warning together make that
  path loud rather than silent.
- **Fresh-module-graph tests must re-import `TestDOM`.** A `vi.resetModules()`
  graph gets its own `~/core/DOM`, so a statically imported `installTestDOM`
  installs into the wrong copy and the fresh `Body` throws
  `document is not defined`. The same applies to `~/core/FontActivation`: a
  statically imported `isFontActivated` reads a different module instance.
  Mitigation: import both inside each case, as steps 1 and 11 show.
- **`packages/docs` resolves the library through the root `node_modules`
  symlink.** Unlike `packages/qa`, it has no vite alias to this checkout, so
  from a worktree its suite exercises the *main* tree's `dist`. Mitigation:
  symlink `packages/docs/node_modules/@jimka/typescript-ui` at this worktree's
  `packages/lib` and clear the vite cache before trusting that run.
- **Top-level `await` in the two Vite apps.** `packages/lib/src/typescript/main.ts`
  already uses it, so the demo is proven; the docs app is not. Mitigation: the
  `npm run build` step in each package's verification is what catches a target
  that rejects it.
- **Deleting 705 lines of gate tests.** Mitigation: every case in the file arms
  the gate explicitly before asserting, so there is no non-gate assertion to
  relocate.[^gate-tests]
- **jsdom never exercises the deadline by itself.** jsdom implements no
  `document.fonts`, so every jsdom suite settles the wait immediately.
  Mitigation: the deadline case in step 11 drives the stub and fake timers
  explicitly.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Theme.ts:1288-1315`](packages/lib/src/typescript/lib/core/Theme.ts#L1288)
  and [`:1369-1470`](packages/lib/src/typescript/lib/core/Theme.ts#L1369) —
  `ensureFontLoaded`, `setTheme`, `_applyDefaultTheme`, `scheduleFontReflow`,
  `onFontsSettled` and `reflowText`. Read all six together before editing any.
- [`packages/lib/src/typescript/lib/core/FirstLayoutGate.ts`](packages/lib/src/typescript/lib/core/FirstLayoutGate.ts) —
  the module being replaced. Its header comment, its four-function shape and the
  reasoning behind `FIRST_LAYOUT_HOLD_MS = 50` all carry over to
  `core/FontActivation.ts`.
- [`packages/lib/src/typescript/lib/core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts) —
  the precedent for a framework-internal state module kept out of
  `core/index.ts` so two modules can share bookkeeping without importing each
  other. `core/FontActivation.ts` copies its header-comment shape.
- [`packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts:401`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L401)
  and [`:513-544`](packages/lib/src/typescript/lib/component/diagram/ElkLayoutEngine.ts#L513) —
  the precedent for one-shot async work memoised in a nullable `Promise` field
  so every overlapping caller settles on one outcome.
- [`packages/lib/src/typescript/lib/core/Animation.ts:328`](packages/lib/src/typescript/lib/core/Animation.ts#L328) —
  `afterTransition`, the precedent for an event that may never fire backed by a
  bounded fallback timer that fires the completion exactly once.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:694-792`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L694) —
  the deferral cluster being removed; read it whole before deleting any part.
- [`plans/implemented/body-lazy-singleton.md`](plans/implemented/body-lazy-singleton.md) —
  the branch this supersedes in part. Its *Architecture Decisions* and
  *Implementation Notes* say what must be preserved.
- [`packages/qa/README.md:324`](packages/qa/README.md#L324) — the `menus`
  panel's recorded C24 geometry, `menubarButton` at `4,4,39,28`, which
  Expected Behaviour 17 checks against.

---

## Non-Goals

- **Changing the DOM seam.** `DOMSource.startFontLoad` and
  `DOMSource.onFontsReady` keep their signatures and their two implementations;
  a consumer's custom `DOMSource` needs no change.
- **Making `getInstance()` async, private, or font-aware.** It has consumers in
  three packages and in the documentation, and every one of them is synchronous.
- **Diagnosing why the old recovery chain failed in WebKitGTK.** The design
  removes the dependency on it rather than explaining it; that question stays
  open and is not this plan's to close.
- **Changing the bundled font payload** — which subsets ship, when the Latin-Ext
  subset loads, or the `font-display: swap` declaration.
- **Adding a `Body.dispose()` or reset door for tests.** Speculative API nothing
  asks for; `body-lazy-singleton` already ruled it out.
- **Updating the render-review research records** under
  `plans/research/render-review-2026-09-15/`. They record decisions taken, not
  the current API.
- **Editing the Loom app**, which lives in its own repository and takes its own
  commit. Loom is the reference consumer for the shape this plan moves to and it
  does need a small change: `/home/jika/typescript/loom/src/main.ts:40` calls
  `Body.init({ layoutManager: Fit(), favicon: APP_FAVICON })` at module scope
  without awaiting it, and builds its shell inside an async `start()` (`:51`)
  that adds it with `Body.getInstance().addComponent(shell)` at `:72`. Move that `init` call
  to the first line of `start()` as `const body = await Body.init({ layoutManager: Fit(), favicon: APP_FAVICON })`,
  and add the shell through `body` instead of `Body.getInstance()`. Loom is
  unaffected by today's bug only because its shell happens to be built after
  several unrelated `await`s; awaiting the bootstrap is what makes that a
  guarantee rather than luck. Nothing else in Loom uses `components`.

---

## Notes

[^measured]: Measured in WebKitGTK/MiniBrowser, one fresh process per run,
    150 samples per arm, reading the bounding rect of the first
    `.MenuBarButton` through the QA app's `menus` panel. `master` and the nine
    branches below `feature/body-lazy-singleton` in the eleven-branch stack all
    report 39; `feature/body-lazy-singleton` and the stack tip report 44.
    Driving four theme switches on `feature/body-lazy-singleton` gives the
    per-unit sequence `[44, 39, 39, 39]` — the page starts wrong and snaps to
    the right width on the first `ThemeManager.setTheme`, then stays. 150 units
    of ordinary layout work never correct it on their own.

[^why-await-not-reorder]: Reordering inside `Body.init` cannot work, and this
    was probed rather than assumed. Building a `MenuBar` and mounting it records
    `["File","New"]` measured during `new MenuBar(…)` and `[]` during
    `Body.init`, so applying the theme at the top of `init` changes nothing —
    the measurements already happened. Nor is the font *token* the lever. With
    Manrope absent, at 13.3333px, the string "File" measures 22.30 under
    `system-ui, sans-serif`, 22.30 under `"Manrope Variable", sans-serif` and
    22.30 under bare `sans-serif`; only `serif` differs, at 25.66. Every
    fallback stack resolves to the same face, so writing the theme's
    `font-family` earlier moves no pixels. What moves them is the real face
    being active, which is why the bootstrap waits for activation rather than
    for the token.

[^activation-cost]: Waiting is nearly free because the two Manrope subsets ship
    as `data:font/woff2;base64,…` inside the built bundle — Vite library mode
    inlines them, so there is no network request. The cost measured for the
    deleted gate was ~1.4 ms and ~0 ms on an idle main thread, which is what the
    50 ms deadline was sized against and why it carries over unchanged.

[^why-omit]: Three ways to retire the option were considered. Leaving
    `components` in place and documenting "don't use it" keeps the bug
    available and silent. Deprecating it with a runtime warning delays the fix
    a release for an unreleased API. `Omit` makes every surviving call site a
    compile error at the exact line that needs to change, which is the loudest
    signal available and costs one type operator. `Omit<ComponentOptions,
    "components">` still satisfies `Component<TOptions extends ComponentOptions>`,
    because every field of `ComponentOptions` is optional; and
    `Component.applyOptions` reads `options.components` off the constraint
    ([`core/Component.ts:1001`](packages/lib/src/typescript/lib/core/Component.ts#L1001)),
    which stays legal and simply never fires for a `Body`.

[^getinstance-sync]: `Body.getInstance()` is called from
    `packages/qa/src/harness/tree.ts:17`, `packages/qa/tests/mount.test.ts`,
    `packages/docs/tests/DocsSidebar.test.ts:59`, three `packages/lib` test
    files and Loom's own `start()`, and is taught by `docs/components/Body.md`,
    `docs/reference/troubleshooting.md:34` and llms rule 4. Making it return a
    promise would break every one of them for no gain: an app that has already
    awaited `Body.init` needs no second guarantee, and an app that has not is
    the case the warning addresses. Keeping it synchronous also preserves its
    value as the jsdom prime — a suite that genuinely must build before mounting
    calls it first and gets the theme applied, exactly as
    `body-lazy-singleton`'s migration note prescribed.

[^seam-untouched]: Building the promise above the seam is what makes both hosts
    work with no new stub and no hang. `ModelledDOMSource.startFontLoad` already
    returns `false` and `onFontsReady` is already inert offline
    ([`tests/dom/TestDOM.ts:1410`](packages/lib/tests/dom/TestDOM.ts#L1410)), so
    the offline path settles inside `ensureFontLoaded` and arms no timer at all
    — nothing can be left waiting. `ProductionDOMSource.startFontLoad` already
    swallows its rejection, which is why the wait needs no error channel. And
    `tests/dom/fonts-ready.test.ts`'s six existing seam cases keep passing
    untouched, because neither member's contract moves. The alternative —
    promoting `startFontLoad` to return `Promise<void>` — would change a
    documented public seam, force every consumer `DOMSource` to implement it,
    and reintroduce the rejection handling the boolean deliberately avoids.

[^delete-the-gate]: Keeping the gate as a residual safety net was considered and
    rejected on three grounds. First, under the new contract it is dead: it arms
    inside `setTheme` and releases on the same `loadingdone` the bootstrap
    awaits, so in the documented pattern nothing exists to lay out during the
    window it holds. Second, keeping it means two independent bounded holds with
    the same 50 ms constant racing each other on startup, which is harder to
    reason about than one. Third, it does not work where it matters: the 44 px
    measurement above is taken with the gate armed and its `reflowText`
    recovery chain wired, and neither corrects the committed width in
    WebKitGTK. Retaining a mechanism that is dead on the good path and proven
    ineffective on the bad one has no case, and the pre-1.0 rule is that code
    with no callers is deleted rather than kept. The removal also clears a
    confound:
    the unexplained WebKitGTK failure no longer sits between the fix and the
    pixels.

[^why-warn]: The warning is recommended rather than merely permitted because the
    compile-time signal has a gap. Dropping `components` catches every app that
    used the documented idiom, but an app that writes
    `const shell = build(); Body.getInstance().addComponent(shell);` compiles
    cleanly and keeps the bug. That shape is not hypothetical — it is half of
    Loom's current `main.ts`. `ProductionDOMSource`'s three measurement methods
    are the right seam because measurement is scattered across four modules
    above them (`component/input/Text.ts`, `component/chart/ChartAxis.ts`,
    `core/Util.ts`, `overlay/Tooltip.ts`), so guarding the source is three call
    sites instead of nine. `core/FontActivation.ts` importing nothing is what
    makes that reachable from `core/DOM.ts` without a cycle. The cost on the
    settled path is two boolean reads per measurement, against a canvas
    `measureText`. `ModelledDOMSource` is deliberately left out so offline
    suites stay quiet; the offline invariant is pinned by
    `tests/core/StartupTextMetrics.test.ts` instead.

[^lazy-singleton-delta]: `body-lazy-singleton`'s decisions that stand,
    unchanged: the lazy singleton mirroring `Tooltip`'s accessor;
    `ThemeManager.themeApplied` as a private flag written only by `setTheme`;
    `_applyDefaultTheme()` as the framework-internal door so a theme chosen
    before the body is reached is kept; `getInstance()` staying public; and
    `tests/setup/node-setup.ts` keeping its top-level DOM install. The decision
    this plan replaces is its *The default theme now lands after an app has
    built its tree* — accepted there as a one-off re-measure, now understood to
    be the cause of a wrong committed width in WebKitGTK. Its two consequences
    are handled differently: the `components` option that made the ordering
    structural is removed rather than documented, and the jsdom remedy moves
    from its migration note into step 23's replacement section. The two QA
    primes that plan added stay, but `packages/qa/tests/panels.test.ts`'s is now
    load-bearing only for its three direct `module.build(…)` calls, and
    `mount.test.ts`'s is belt-and-braces once `mountPanel` awaits the bootstrap.

[^gate-tests]: `packages/lib/tests/core/FirstLayoutGate.test.ts` imports
    `holdFirstLayout` and calls it explicitly in every case that asserts
    anything, including the eleven that drive `Tree` and the table body through
    their deferral paths (`holds a virtual row view that renders at
    element-creation time`, `renders a held table body once the release drives
    its layout`, `applies a horizontal offset held while the gate was up`, and
    so on). Each asserts what happens *while the gate is held*, so with nothing
    able to arm it there is no residual assertion to preserve. The ordinary,
    ungated behaviours those cases lean on — `setScrollX` / `setScrollY`
    delegating to the scroller, `scrollRowIntoView` revealing a row,
    `Tree.renderWindow` running once per layout — are covered by the existing
    `tests/component/tree` and `tests/component/table` suites, which must stay
    green through steps 7–9.

[^docs-resolution]: Recorded while implementing `body-lazy-singleton`, and still
    true: `packages/docs` has no vite alias to the local library, unlike
    `packages/qa`, so from a worktree
    its suite resolves `@jimka/typescript-ui` through the root `node_modules`
    symlink into the **main checkout's** `dist`. A green docs run in a worktree
    therefore proves nothing about this branch's library until that symlink is
    bridged by hand.

## Implementation Notes

Four departures from the plan as written, all recorded rather than designed
around. The design itself needed no departure: `## Internal Structure`'s three
bodies (`FontActivation.ts`, `Theme.ts`'s deadline pair, `Body.init`'s new
body) went in verbatim, and the deletions in steps 6–10 matched the cited line
ranges exactly.

Manual verification items 17–19 (the in-engine `menus` panel check, `npm run
dev`, and `npm run docs:dev`, each requiring a person at a browser or the
physical desktop) are **not** performed here and remain outstanding for the
user, per this run's own hard constraint against starting MiniBrowser, a Tauri
command, or a dev server.

- **`StartupTextMetrics.test.ts`'s ported spy callbacks needed real parameter
  types, not `never`.** Step 1 says to port the scratch probe "verbatim apart
  from three things" (the header comment and two import paths). Copied
  verbatim, the three `vi.spyOn(...).mockImplementation` callbacks typed their
  parameters as `never` (`(theme: never) =>`, `(text: never, options: never)
  =>`, `(requests: never) =>`), which fails `npm run typecheck:test` under
  `strictFunctionTypes` — a mock whose parameter is narrower than the spied
  method's own is not assignable to it — and no `never`-typed mock exists
  anywhere else in the suite. Retyped the three callbacks against the real
  signatures (`Theme` from `~/core/Theme`; `TextMeasureOptions` /
  `TextMeasureRequest` from `~/core/Util`, both type-only imports so the
  fresh-module-graph pattern is unaffected), matching the pattern every other
  `vi.spyOn(...).mockImplementation` in the suite already uses (e.g.
  `FocusHistory.test.ts`'s `(handle: Handle, options?: …)`). Behaviour is
  unchanged; only the annotations move.

- **`Body.test.ts`'s three new `Body.init` cases needed `Favicon._reset()` in
  `afterEach`.** Step 2 adds three cases to the same `describe('Body.init',
  …)` block that previously ran only one, none in a fresh module graph.
  `Body.init`'s default-favicon install writes through `Favicon`'s own
  module-level cached link handle, which survives across cases in the same
  block; once a second and third case each call `installTestDOM` (swapping the
  fake DOM out from under that stale handle) and then `Body.init`, the write
  throws `TestHandleTable: handle N is not registered`. Added
  `Favicon._reset()` to the describe's `afterEach`, mirroring the identical
  hazard `BodyContextMenu.test.ts` already documents and guards the same way.

- **The llms manifest's convention-4 rewording needed trimming to fit the
  token budget.** Step 21's literal replacement text pushed
  `packages/docs/public/llms.txt` to ~8016 tokens, over the generator's
  8010-token budget (`assertBudget` in `scripts/llms/generate.mjs`).
  Shortened to "Mount with `const body = await Body.init({ layoutManager
  })`, then `body.addComponent(root)`; use `Body.getInstance()` only to reach
  the body afterwards." — drops the "build components only after `init`
  resolves" clause the code shape already implies — which lands at ~8004
  tokens, with headroom to spare.

- **Four files carried stale prose naming the deleted gate, beyond what
  their own numbered steps called for — a wording fix, not a design
  change.** `Component.ts`'s `flushLayout()` and `resumeLayout()` JSDoc
  (step 6's file, but step 6's own instruction covers only the
  `FirstLayoutGate` import and the `isFirstLayoutHeld()` block inside
  `flushPendingLayouts`) both described "the startup hold that keeps the
  first coalesced flush waiting for the web font to activate" — the exact
  mechanism steps 6–9 remove — so both `@remarks` blocks are rewritten to
  describe the awaited-bootstrap ordering instead. `fonts-ready.test.ts`
  (step 11's file, but step 11's instruction replaces only the
  `ThemeManager — startup layout gate` describe) had a test title in a
  different, untouched describe (`ModelledDOMSource.startFontLoad`) still
  naming "the gate"; reworded to match. `tests/dom/TestDOM.ts` is the one
  genuinely out-of-table file: its own `ModelledDOMSource.startFontLoad` doc
  comment named the gate too, and is reworded the same way.
  `HeaderThemeReflow.test.ts` (step 13's file, but step 13's instruction
  covers only its `Body.init` call) justified the `flushLayout()` beneath it
  as a bypass of a first layout "held pending font activation"; reworded to
  name the mocked-out frame that file actually installs, which is what makes
  the bypass necessary once the gate is gone. (The `DocsSidebar.test.ts` /
  `DocsContent.test.ts` comment rewordings are not part of this deviation —
  they are exactly what step 16 itself specifies.)
