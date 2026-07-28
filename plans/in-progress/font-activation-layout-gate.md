# Font-Activation Layout Gate — Implementation Plan

## Overview

The framework's first layout pass currently measures every piece of text against the browser's fallback font, then re-measures ~43 ms later when the real font activates. That re-measure moves every text box on the page at once, which is visible as a flicker at startup.

This plan adds a **one-shot startup gate**: the coalesced layout queue holds its *first* flush until the web font has activated, so the first geometry the page ever commits is already measured against the real face. The hold is bounded — if activation never reports back, the gate opens on its own after a short deadline and the framework falls back to today's behaviour.

Three pieces change. A new internal module `packages/lib/src/typescript/lib/core/FirstLayoutGate.ts` owns the gate's state. The layout queue in [packages/lib/src/typescript/lib/core/Component.ts:178](packages/lib/src/typescript/lib/core/Component.ts#L178) consults it at the top of its flush. [`ThemeManager`](packages/lib/src/typescript/lib/core/Theme.ts#L1288) arms it when it starts the font load, and releases it when the font set reports the load settled.

A prerequisite ships first: a `DOMSource.startFontLoad` seam that explicitly asks the browser to fetch and activate the font. Without it the gate would wait for a font nobody asked for.

---

## Architecture Decisions

### The gate lives in its own module, not in `Component` or `ThemeManager`

The gate's state goes in a new `core/FirstLayoutGate.ts` holding module-level variables and plain exported functions. `Component.ts` and `Theme.ts` both import it; it imports neither.[^gate-module]

The module is **not** exported from `core/index.ts`, mirroring [packages/lib/src/typescript/lib/core/PendingTransitions.ts:1](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L1) — the framework's existing "shared bookkeeping between two modules that must not import each other" precedent, whose own header names `core/ClassStyleRules.ts` and `core/ComponentDefaults.ts` as the same shape.

### The queue holds by retrying the frame, not by refusing to schedule one

`flushPendingLayouts` checks the gate at the top. When the gate is held it re-requests an animation frame and returns without touching the queues, so the pending set keeps accumulating and retries next frame. Nothing else in the scheduler changes: `scheduleLayout`, `ensureFlushScheduled`, and `afterNextLayout` are untouched.[^frame-retry]

### The release deadline is 50 ms of *idle* time, started at the first held frame

`holdFirstLayout()` starts no timer. The timer starts the first time the queue actually finds the gate held — which is the first animation frame after the synchronous startup work finishes. From that point the gate has 50 ms to be released before it opens itself.[^idle-deadline] [^hold-value]

### The gate is armed only when an asynchronous font load really started

`DOMSource.startFontLoad` returns `true` when it actually kicked off a load, `false` otherwise. `ThemeManager.setTheme` arms the gate only on `true`. The offline `ModelledDOMSource` returns `false`, and so does production on an engine with no CSS Font Loading API — in both cases the gate is never armed and there is nothing to time out.[^arm-signal]

Everything that can open the gate, and what each case costs:

| Situation | What releases the gate | How long the first flush waits |
|---|---|---|
| Normal load, face activates | `loadingdone` → `ThemeManager.onFontsSettled` | activation time (measured: 1.4 ms + ~0 ms) |
| Face is broken or errors | `loadingdone` fires for the errored batch too | one failed activation attempt |
| Engine has no `document.fonts` | never armed — `startFontLoad` returned `false` | 0 |
| Offline tests (`ModelledDOMSource`) | never armed — `startFontLoad` returned `false` | 0 |
| `loadingdone` never fires at all | the 50 ms deadline | 50 ms of idle time |

### Synchronous layout entry points bypass the gate, by design

`flushLayout()` and `resumeLayout()` call `doLayout()` directly and therefore ignore the gate. That is deliberate and documented, not an oversight.[^flush-bypass] `pauseLayout()` is a separate, per-component gate that is unaffected: a paused component never enters the queue, so releasing the font gate does not lay it out.

| Call, while the gate is held | Behaviour |
|---|---|
| `component.scheduleLayout()` | queued; no `doLayout` until release |
| `Component.afterNextLayout(cb)` | `cb` runs after the first post-release flush |
| `component.flushLayout()` | lays out immediately — bypasses the gate |
| `component.resumeLayout()` | lays out immediately — bypasses the gate |
| `component.pauseLayout()` | independent; the component stays out of the queue entirely |

### The metrics cache is invalidated before the gate is released

The `loadingdone` handler runs `ThemeManager.reflowText()` first and `releaseFirstLayout()` second. Reversing the two would let the released flush lay out against text sizes still cached from before the font activated.[^reflow-order]

---

## Public API

### New internal module — `core/FirstLayoutGate.ts`

Not re-exported from `core/index.ts`; internal to the framework.

```typescript
/** How long the gate may hold the first flush once the main thread is free. */
export const FIRST_LAYOUT_HOLD_MS = 50;

/** Arms the one-shot gate. Called once, from ThemeManager's font set-up. */
export function holdFirstLayout(): void;

/** True while the layout queue must keep deferring its first flush. Pure. */
export function isFirstLayoutHeld(): boolean;

/** Starts the bounded release deadline; no-op after the first call, or when the gate is open. */
export function startFirstLayoutDeadline(): void;

/** Opens the gate and cancels the deadline. Idempotent. */
export function releaseFirstLayout(): void;
```

### Changed seam member — `DOMSource.startFontLoad`

```typescript
interface DOMSource {
    /** Starts loading `family` now. Returns true if an async load was started. */
    startFontLoad(family: string): boolean;
}
```

Implemented by `ProductionDOMSource` (packages/lib/src/typescript/lib/core/DOM.ts) and `ModelledDOMSource` (packages/lib/tests/dom/TestDOM.ts).

### Changed internal helper — `Theme.ts`

```typescript
/** Injects the @font-face rules on first call. Returns true if a font load was started. */
function ensureFontLoaded(): boolean;

class ThemeManager {
    /** Named callback for DOM.source.onFontsReady: re-measures, then opens the gate. */
    private static onFontsSettled(): void;
}
```

---

## Internal Structure

### `core/FirstLayoutGate.ts`

```typescript
let _held: boolean = false;
let _deadline: TimerId | null = null;

export function holdFirstLayout(): void {
    _held = true;
}

export function isFirstLayoutHeld(): boolean {
    return _held;
}

export function startFirstLayoutDeadline(): void {
    if (!_held || _deadline !== null) {
        return;
    }

    _deadline = DOM.sink.setTimeout(releaseFirstLayout, FIRST_LAYOUT_HOLD_MS);
}

export function releaseFirstLayout(): void {
    _held = false;

    if (_deadline !== null) {
        DOM.sink.clearTimeout(_deadline);
        _deadline = null;
    }
}
```

`releaseFirstLayout` does not need to kick a flush: whenever the queue is non-empty a retry frame is already pending (see the flush change below), and when the queue is empty there is nothing to flush.

### `Component.ts` — the only scheduler change

At the top of `flushPendingLayouts` ([packages/lib/src/typescript/lib/core/Component.ts:178](packages/lib/src/typescript/lib/core/Component.ts#L178)), immediately after `rafHandle = null;`:

```typescript
    // Startup font gate: hold the very first flush until the web font has
    // activated, so no text is committed at a fallback-derived size. The queues
    // are left intact and retried next frame; the gate opens on activation or
    // on its own bounded deadline.
    if (isFirstLayoutHeld()) {
        startFirstLayoutDeadline();
        ensureFlushScheduled();

        return;
    }
```

### `Theme.ts` — arming and releasing

```typescript
function ensureFontLoaded(): boolean {
    if (_fontInjected) {
        return false;
    }

    _fontInjected = true;

    /* …existing rule construction and <style> append, unchanged… */

    return DOM.source.startFontLoad(MANROPE_FAMILY);
}
```

```typescript
    static setTheme(theme: Theme): void {
        const fontLoadStarted = ensureFontLoaded();

        ThemeManager.scheduleFontReflow();

        if (fontLoadStarted) {
            holdFirstLayout();
        }

        /* …rest of setTheme unchanged… */
    }
```

```typescript
    private static scheduleFontReflow(): void {
        if (ThemeManager.fontReflowScheduled) {
            return;
        }

        ThemeManager.fontReflowScheduled = true;
        DOM.source.onFontsReady(ThemeManager.onFontsSettled);
    }

    /**
     * Runs when a batch of web-font loading settles: refreshes the text
     * metrics, then opens the startup layout gate so the first flush measures
     * against the face that just activated. The order matters — releasing
     * first would flush against the pre-activation cached sizes.
     */
    private static onFontsSettled(): void {
        ThemeManager.reflowText();
        releaseFirstLayout();
    }
```

`ThemeManager.onFontsSettled` is passed as a named static reference (ARCHITECTURE.md's *Listeners must reference a named function*), replacing the current inline arrow at [packages/lib/src/typescript/lib/core/Theme.ts:1331](packages/lib/src/typescript/lib/core/Theme.ts#L1331). Its body reaches state through `ThemeManager.` explicitly, so it needs no `this` binding.

---

## Ordered Implementation Steps

Steps 1–2 are the prerequisite seam. **This code may already be present in the working tree.** If it is, verify it matches what these steps describe — in particular the `boolean` return type, which the working copy may have as `void` — and adjust only the difference rather than rewriting the block.

1. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `startFontLoad(family: string): boolean` to the `DOMSource` interface, directly after `onFontsReady` ([line 1271](packages/lib/src/typescript/lib/core/DOM.ts#L1271)). Document that an `@font-face` rule downloads nothing until rendered content uses it, that this call starts the fetch as soon as the rules are installed, and that the return value says whether a load was started (so a caller can tell whether `onFontsReady` will follow). Implement it on `ProductionDOMSource`, after its `onFontsReady` ([line 2225](packages/lib/src/typescript/lib/core/DOM.ts#L2225)):

    ```typescript
    startFontLoad(family: string): boolean {
        const fonts = document.fonts;

        if (!fonts) {
            return false;
        }

        fonts.load(`14px "${family}"`).catch(() => {});

        return true;
    }
    ```

    The `14px` is required shorthand syntax, not a constraint — one variable face covers every size and the 200–800 weight range. The `.catch` swallows an unavailable face, which `font-display: swap` already covers.

2. **`packages/lib/tests/dom/TestDOM.ts`** — implement `startFontLoad(_family: string): boolean { return false; }` on `ModelledDOMSource`, next to its inert `onFontsReady` (~line 1144). Comment that offline measurement uses baked fonts, so there is nothing to fetch and no gate to arm.

3. **`packages/lib/src/typescript/lib/core/Theme.ts`** — extract the family literal to a module constant `const MANROPE_FAMILY = 'Manrope Variable';` above `_fontInjected` ([line 1203](packages/lib/src/typescript/lib/core/Theme.ts#L1203)) and use it in the injected `@font-face` rule string. Change `ensureFontLoaded` ([line 1216](packages/lib/src/typescript/lib/core/Theme.ts#L1216)) to return `boolean` per the snippet above: `false` on the already-injected early return, and `DOM.source.startFontLoad(MANROPE_FAMILY)` as the tail return after the `<style>` element is appended.

    Check: `grep -n "'Manrope Variable'" packages/lib/src/typescript/lib/core/Theme.ts` — expect exactly one match (the constant).

4. **`packages/lib/tests/dom/fonts-ready.test.ts`** — this file already covers `onFontsReady`. Add or reconcile the `startFontLoad` cases: the load call is made with `14px "Manrope Variable"`; a rejected load does not surface an unhandled rejection; an engine with no `document.fonts` returns `false` and does not throw; a successful call returns `true`; and `ThemeManager.setTheme` triggers the load at rule-install time (using `vi.resetModules()` + dynamic import, because `ensureFontLoaded` is once-guarded). Run `npm run test` — expect green.

5. **Create `packages/lib/src/typescript/lib/core/FirstLayoutGate.ts`** with the state, the constant, and the four functions from *Internal Structure*. Head the file with the SPDX line other `core/` modules carry and a comment explaining the module exists so `Theme.ts` and `Component.ts` can share this state without importing each other — same reason as `core/PendingTransitions.ts`. Import `DOM` and the `TimerId` type from `~/core/DOM.js`. Do **not** add it to `core/index.ts`.

    Check: `grep -n "FirstLayoutGate" packages/lib/src/typescript/lib/core/index.ts` — expect zero matches.

6. **`packages/lib/src/typescript/lib/core/Component.ts`** — import `isFirstLayoutHeld` and `startFirstLayoutDeadline` from `~/core/FirstLayoutGate.js`, and insert the held-branch block from *Internal Structure* at the top of `flushPendingLayouts` ([line 178](packages/lib/src/typescript/lib/core/Component.ts#L178)), right after `rafHandle = null;`. Change nothing else in the scheduler.

    Check: `grep -n "isFirstLayoutHeld" packages/lib/src/typescript/lib/core/Component.ts` — expect exactly two matches (import, use).

7. **`packages/lib/src/typescript/lib/core/Component.ts`** — extend the JSDoc of `flushLayout` ([line 5347](packages/lib/src/typescript/lib/core/Component.ts#L5347)) and `resumeLayout` ([line 5155](packages/lib/src/typescript/lib/core/Component.ts#L5155)) with a `@remarks` noting they lay out synchronously and therefore bypass the startup font gate; describe the gate in prose rather than `{@link}`-ing `FirstLayoutGate`, which is not in the public API docs (CODE_CONVENTIONS.md).

8. **`packages/lib/src/typescript/lib/core/Theme.ts`** — import `holdFirstLayout` and `releaseFirstLayout` from `~/core/FirstLayoutGate.js`. Arm the gate in `setTheme` ([line 1288](packages/lib/src/typescript/lib/core/Theme.ts#L1288)) behind the `fontLoadStarted` result. Replace the inline arrow in `scheduleFontReflow` ([line 1331](packages/lib/src/typescript/lib/core/Theme.ts#L1331)) with the named `ThemeManager.onFontsSettled` reference, and add that private static method calling `reflowText()` then `releaseFirstLayout()` — in that order.

    Check: `grep -rn "holdFirstLayout(" packages/lib/src/typescript/lib/` — expect exactly two matches (the definition and the single call in `setTheme`). More than one call site would break the one-shot rule.

9. **Create `packages/lib/tests/core/FirstLayoutGate.test.ts`** covering rows 1–11 of *Expected Behaviour* — the gate-plus-queue mechanics. Rows 12–14 are theme-side and go in `packages/lib/tests/dom/fonts-ready.test.ts` instead, where the `document.fonts` stub already lives. Mirror the harness in [packages/lib/tests/core/AfterNextLayout.test.ts:33](packages/lib/tests/core/AfterNextLayout.test.ts#L33): `installTestDOM(CONFIG)`, then spy on `DOM.sink.requestAnimationFrame` to capture frame callbacks and drive them by hand. Add `afterEach(() => releaseFirstLayout())` so a test that leaves the gate armed cannot leak into the next one.

10. **Run the full suite and typecheck** — `npm run typecheck && npm run test && npm run lint`. Expect 3259 tests across 242 files, all green, and no new lint errors. A hang or timeout in an unrelated test file means the gate was armed offline: re-check step 2's `return false`.

11. **Live check** — follow `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/FirstLayoutGate.ts` |
| Create | `packages/lib/tests/core/FirstLayoutGate.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Theme.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/dom/fonts-ready.test.ts` |
| Modify, then revert | `packages/docs/index.html` (trace script for the live check only — removed before finishing) |

---

## Expected Behaviour

**Unit-testable** (offline, `installTestDOM` + a spied `requestAnimationFrame`):

1. **Unarmed gate is invisible.** With no `holdFirstLayout()` call, `isFirstLayoutHeld()` is `false` and a component that calls `scheduleLayout()` lays out on the captured frame exactly as it does today.
2. **An armed gate defers the flush.** After `holdFirstLayout()`, a scheduled component does not lay out when the captured frame runs — and still does not lay out on a second and third frame.
3. **A held frame re-requests a frame.** Driving a captured frame while the gate is held leaves a new frame callback captured, so the retry loop keeps running.
4. **A held frame starts the deadline exactly once.** The first held frame records one `setTimeout` of `FIRST_LAYOUT_HOLD_MS` on the sink; subsequent held frames record none.
5. **Release on activation.** `holdFirstLayout()`, drive a frame, `releaseFirstLayout()`, drive a frame → the component lays out once.
6. **Release on the deadline.** `holdFirstLayout()`, drive a frame, advance fake timers by `FIRST_LAYOUT_HOLD_MS`, drive a frame → the component lays out once. (`RecordingDOMSink.setTimeout` delegates to the real timer, so `vi.useFakeTimers()` drives it.)
7. **Release cancels the deadline.** `holdFirstLayout()`, drive a frame, `releaseFirstLayout()`, then advance timers well past the deadline → no error, and the gate stays open (`isFirstLayoutHeld()` is `false`).
8. **Release is idempotent.** Calling `releaseFirstLayout()` twice, or on a never-armed gate, is a no-op.
9. **`flushLayout` bypasses the gate.** With the gate armed, `component.flushLayout()` lays the component out immediately.
10. **`pauseLayout` still wins.** A paused component that calls `scheduleLayout()` never enters the queue, so it does not lay out when the gate is released.
11. **`afterNextLayout` waits for the release.** A callback queued while the gate is held has not run after a held frame, and runs on the first frame after release.
12. **Offline never arms.** `ModelledDOMSource.startFontLoad('Manrope Variable')` returns `false`; `ThemeManager.setTheme` with no `document.fonts` present leaves `isFirstLayoutHeld()` `false`.
13. **Production arms.** With a stub `document.fonts` exposing `load`, a fresh (`vi.resetModules()`) `ThemeManager.setTheme` call leaves `isFirstLayoutHeld()` `true`, and `loadCalls` is `['14px "Manrope Variable"']`.
14. **Re-measure precedes release.** Firing the stub font set's `loadingdone` bumps `Util.textMetricsGeneration()` *and* leaves `isFirstLayoutHeld()` `false`.

**Manual verification** (needs a real browser — see `## Verification`):

15. The first `.TreeRow` element appears **after** the font set's `loadingdone` event.
16. The sidebar label widths committed on that first frame match a fresh canvas probe of the same text in the same font.
17. No visible text re-flow between first paint and steady state.

---

## Verification

- **Typecheck**: `npm run typecheck` — 0 errors.
- **Lint**: `npm run lint` — no new errors. `FirstLayoutGate.ts` touches only `DOM.sink`, so the `local/no-raw-dom` rule stays satisfied.
- **Unit tests**: `npm run test` — the full suite (3259 tests, 242 files) stays green, plus the new `FirstLayoutGate.test.ts` and the extended `fonts-ready.test.ts`.
- **Call-site grep**: `grep -rn "holdFirstLayout(" packages/lib/src/typescript/lib/` — exactly two matches (definition + the one call in `ThemeManager.setTheme`).
- **Barrel grep**: `grep -rn "FirstLayoutGate" packages/lib/src/typescript/lib/core/index.ts` — zero matches.

### Live before/after check

The docs app resolves `@jimka/typescript-ui` to `packages/lib/dist`, so **`npm run build:lib` must run before `npm run docs:dev`** (app on `localhost:5173`) — otherwise the browser is running the old library.

1. **Install the trace.** Temporarily add an inline `<script>` to the `<head>` of `packages/docs/index.html`, *above* the existing `<script type="module" src="/src/main.ts">`. It runs before any framework code, which is what makes the ordering observable. It must record, into `window.__fontTrace`:
    - `loadCalls` — wrap `document.fonts.load` and push `{ font, t: performance.now() }`.
    - `loading` / `loadingdone` — `document.fonts.addEventListener` for both, pushing `performance.now()`.
    - `firstTreeRow` — a `MutationObserver` on `document.documentElement` (`childList`, `subtree`) that, the first time `document.querySelector('.TreeRow')` is non-null, records `performance.now()` **and** a snapshot of each sidebar label's committed width: for every `.TreeRow`, its label element's `getBoundingClientRect().width` plus its `textContent`. Then disconnect.

    If `.TreeRow .Text` selects nothing, print one `.TreeRow`'s `outerHTML` and use whatever class the label element actually carries.

2. **Cold context.** Open `http://localhost:5173/guide` in a **fresh, isolated** browser context (no warm cache, no reused page), let it settle, then read `window.__fontTrace`.

3. **Success criteria.**
    - `firstTreeRow.t > loadingdone` — the first row was never laid out against the fallback face. This is the before/after discriminator: on the current build the ordering is the other way round (measured: first `.TreeRow` at 594 ms, `loadingdone` at 637 ms).
    - `loading` fires early, close to `loadCalls[0].t`, not just before `loadingdone` — confirms `startFontLoad` triggered the fetch rather than the first render doing it.
    - For every snapshotted label: build a canvas 2D context, set its `font` to the label element's computed `font` shorthand, and compare `Math.ceil(ctx.measureText(text).width)` against the snapshotted committed width. Every label must agree within 1 px.

    The width check is the sharp one. The existing `onFontsReady` re-flow already corrects widths a frame or two later, so a *steady-state* width comparison passes both before and after this change; only widths captured at the moment the first row appears distinguish the two.

4. **Revert the trace script** from `packages/docs/index.html` before finishing. `git diff packages/docs/` must be empty.

---

## Documentation Impact

- `DOMSource` is a publicly exported interface, so `startFontLoad` needs a complete JSDoc block — it will render into the generated API reference.
- `core/FirstLayoutGate.ts` is internal and stays out of `core/index.ts`, so it gets no doc page. Because it is not in the public docs, **no public JSDoc may `{@link}` its symbols** — the `flushLayout` / `resumeLayout` remarks describe the gate in prose (CODE_CONVENTIONS.md, *Don't `{@link}` internal symbols from public JSDoc*).
- `npm run docs:api` must finish with **zero warnings**.
- No curated doc page changes: `packages/lib/docs/concepts/dom-seams.md` describes the seam by category and does not enumerate `onFontsReady`, so it needs no `startFontLoad` entry. `packages/lib/llms.txt` indexes consumer-facing components and layouts, which this is not.

---

## Potential Challenges

- **The gate is armed at module-evaluation time, not by app code.** `Body`'s eagerly-initialised static `INSTANCE` ([packages/lib/src/typescript/lib/core/Body.ts:23](packages/lib/src/typescript/lib/core/Body.ts#L23)) calls `ThemeManager.setTheme(ModernTheme)` from its constructor, and ES modules finish evaluating imports before the importing module's body runs. So in `packages/docs/src/main.ts` the gate is armed by the `import { Body }` on line 1, well before `new DocsShell(router)` on line 9 and `Body.init(...)` further down. No app-side change is required, and none should be added.
- **A timer armed at hold time would be useless.** Startup runs ~500 ms of synchronous work; a `setTimeout` started before it expires during that work and fires the instant the thread yields, racing the font activation it was meant to outlast. Starting the deadline at the first held frame is what makes the 50 ms a real idle-time budget — do not "simplify" it back into `holdFirstLayout`.
- **The gate does not replace the existing re-flow.** `onFontsReady` → `reflowText` stays wired and still fires for later font batches. Anything measured early through a `flushLayout` escape hatch is corrected by it, exactly as today.
- **A page with several web-font families** may fire `loadingdone` for another family's batch first, releasing the gate before Manrope activates. That degrades to today's behaviour — the existing re-flow corrects it — and is not worth guarding against.
- **First-layout callbacks are deferred too.** `runFirstLayoutCallbacks` and `afterNextLayout` consumers (focus moves, reveal-on-navigation) run after the release rather than on the first frame. The delay is the same single-digit milliseconds; watch for it if a startup focus behaviour looks off.
- **Offline arming would hang tests.** If `ModelledDOMSource.startFontLoad` ever returned `true`, every offline test driving frames by hand would stall, because the offline sink drops `requestAnimationFrame` callbacks and the deadline would never start. The `return false` in step 2 is load-bearing.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/PendingTransitions.ts](packages/lib/src/typescript/lib/core/PendingTransitions.ts) — the precedent `FirstLayoutGate.ts` mirrors: module-level state plus exported functions, existing purely so two modules can share bookkeeping without importing each other, deliberately absent from `core/index.ts`.
- [packages/lib/src/typescript/lib/core/Component.ts:160-215](packages/lib/src/typescript/lib/core/Component.ts#L160) — the layout queue: `pendingLayouts`, `afterLayoutCallbacks`, `rafHandle`, `ensureFlushScheduled`, `flushPendingLayouts`. The only file-level change is the block at the top of the flush.
- [packages/lib/src/typescript/lib/core/Component.ts:5137-5160](packages/lib/src/typescript/lib/core/Component.ts#L5137) and [:5347](packages/lib/src/typescript/lib/core/Component.ts#L5347) — `isLayoutPaused` / `pauseLayout` / `resumeLayout` and `flushLayout`, the gate's interaction surface.
- [packages/lib/src/typescript/lib/core/Theme.ts:1196-1360](packages/lib/src/typescript/lib/core/Theme.ts#L1196) — `MANROPE_SUBSETS`, `_fontInjected`, `ensureFontLoaded`, `setTheme`, `scheduleFontReflow`, `reflowText`.
- [packages/lib/src/typescript/lib/core/DOM.ts:1245-1275](packages/lib/src/typescript/lib/core/DOM.ts#L1245) and [:2225](packages/lib/src/typescript/lib/core/DOM.ts#L2225) — `onFontsReady`'s interface contract and production implementation, including the documented reason `loadingdone` is used instead of `fonts.ready`. `startFontLoad` sits directly beside both.
- [packages/lib/src/typescript/lib/core/DOM.ts:723-750](packages/lib/src/typescript/lib/core/DOM.ts#L723) — the `requestAnimationFrame` / `setTimeout` / `clearTimeout` / `TimerId` seam members the gate uses.
- [packages/lib/tests/core/AfterNextLayout.test.ts](packages/lib/tests/core/AfterNextLayout.test.ts) — the harness for testing the layout queue offline: spy on `DOM.sink.requestAnimationFrame`, collect callbacks, drive frames manually, drain in `afterEach`.
- [packages/lib/tests/dom/fonts-ready.test.ts](packages/lib/tests/dom/fonts-ready.test.ts) — the existing `document.fonts` stub and the `vi.resetModules()` trick for re-running the once-guarded `ensureFontLoaded`.
- [packages/lib/src/typescript/lib/core/Body.ts:23-70](packages/lib/src/typescript/lib/core/Body.ts#L23) — where `setTheme` is called from, which is what fixes the gate's arming point relative to tree construction.

---

## Non-Goals

- **No loading screen, splash, or app-ready API.** The hold is measured in single-digit milliseconds and bounded at 50 ms. Anything user-visible would be a far larger change for a delay shorter than one frame.
- **No paint suppression during the hold.** Hiding the body until release would be a loading screen by another name, and would trade a short font re-flow for a blank page in the failure case.[^no-paint-suppression]
- **No change to the existing font re-flow.** `onFontsReady` → `reflowText` stays exactly as it is; the gate sits in front of it, not instead of it.
- **No gating of anything but the first flush.** Later font batches, theme switches, and steady-state layout are untouched.
- **No new public API.** Nothing here is meant for consumers to call; `FirstLayoutGate` stays out of `core/index.ts`.

---

## Notes

[^gate-module]: `Component.ts` already imports `ThemeManager` from `Theme.ts` (line 20), so putting the gate's state in `Component.ts` and calling it from `Theme.ts` would create an import cycle between two modules that both do work during startup module evaluation — precisely where a cycle's static-initialisation order becomes load-bearing and fragile. Putting the state in `Theme.ts` instead would make `Component.ts` import a theme module to run its layout queue, which inverts the layering. A third module both can import resolves it with no cycle and no layering inversion, and the codebase already carries three modules created for exactly this reason (`PendingTransitions.ts`, `ClassStyleRules.ts`, `ComponentDefaults.ts`).

[^frame-retry]: The alternative was to short-circuit `ensureFlushScheduled` while the gate is held, so no frames are requested at all. That version needs the release path to know whether the queue is non-empty and to kick a frame itself, which means the gate module has to reach back into `Component.ts`'s queue — a callback registration, or a cycle. Retrying the frame instead keeps the gate module free of any knowledge of the queue: whenever work is pending, a frame is already pending, so release needs to do nothing. The cost is one animation frame per held frame, each doing a boolean check and a re-request — at most three frames on the 50 ms bound.

[^idle-deadline]: Animation-frame callbacks cannot run while the main thread is busy, so the first frame that finds the gate held is by construction the first moment after the synchronous startup work has finished. Anchoring the deadline there means the 50 ms is 50 ms of *available* time, which is what the budget is meant to measure. A timer started when the gate is armed would instead expire silently during the ~500 ms of tree construction and fire the moment the thread yields, in an unspecified order against the font-activation task — a coin flip that would defeat the gate on a large fraction of loads.

[^hold-value]: 50 ms is roughly 3 frames. The activation cost of the two inline faces on an idle main thread was measured at 1.4 ms and ~0 ms, so 50 ms is over an order of magnitude of headroom for a slower machine. The bound cannot usefully be much longer: on the failure path the page has already painted an unlaid-out tree by the first held frame, and the deadline is exactly how long that state persists. 50 ms keeps that worst case to about three frames — comparable to a single dropped frame, and well under the ~100 ms at which a delay starts reading as lag.

[^arm-signal]: The alternative was arming unconditionally and relying on the deadline to open the gate everywhere it does not apply. Offline that fails outright: `RecordingDOMSink.requestAnimationFrame` drops its callback, so no held frame ever runs, so the deadline never starts and the gate stays shut for the life of the process. A separate capability predicate on `DOMSource` (`hasAsyncFontLoading()`) would work but adds a second seam member saying almost the same thing as `startFontLoad`. Returning the answer from the call that has it is one member instead of two. One imprecision is accepted: if the family were already loaded, `fonts.load` resolves without opening a new batch and `loadingdone` may not fire, in which case the deadline releases the gate. `ensureFontLoaded` is once-per-process guarded and the faces are base64-inlined with no cache to hit, so that case does not arise in practice.

[^flush-bypass]: `flushLayout`'s whole contract is "a layout-derived value must be read before the next animation frame". Making it honour the gate would either return stale geometry to a caller that cannot proceed without it, or force it to become asynchronous — a behaviour change for every existing call site. The offline suite also leans on it heavily, since the offline sink never drives the queue. The bypass is safe because it is not a hole in the guarantee: the existing `onFontsReady` → `reflowText` re-measure still corrects anything measured early, exactly as it does today.

[^reflow-order]: `reflowText` calls `Util.invalidateTextMetricsCache()`, which bumps the generation counter that `Text.needsMeasure()` ([packages/lib/src/typescript/lib/component/input/Text.ts:388](packages/lib/src/typescript/lib/component/input/Text.ts#L388)) compares against. This matters because a `Text` can measure itself during construction, long before activation — the gate delays the *layout*, not the measurement. Bumping the generation first marks every one of those cached sizes stale, so the released flush re-measures against the activated face. `reflowText` also notifies theme listeners, which is what puts `Body` back on the queue via its `_onThemeReflow` handler ([packages/lib/src/typescript/lib/core/Body.ts:114](packages/lib/src/typescript/lib/core/Body.ts#L114)) — that too must happen before the release, or the released flush would have nothing queued.

[^no-paint-suppression]: The window in which an unlaid-out tree can be painted is not created by this change: it already exists today between the end of synchronous construction and the first animation frame. The gate can only extend it, and on the normal path it does not extend it at all — `loadingdone` fires as a task in the same drain in which the thread first goes idle, so the gate typically opens before the first frame ever runs. Suppressing paint would guard a case that the 50 ms bound already keeps to about three frames, at the cost of a blank page whenever the gate times out.
