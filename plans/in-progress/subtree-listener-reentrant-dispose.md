---
depends-on:
  - component-purges-event-listeners
  - dock-disposes-tab-content
touches-shared:
  - packages/lib/src/typescript/lib/core/Event.ts
---

# Subtree Listener Survives Same-Event Reentrant Dispose — Implementation Plan

## Overview

Closing a `Dock`/`Tab` tab can throw `Uncaught Error: DOM handle <n> is not registered (released or never minted)` from inside the click that closed it. [`Event.ts`'s `baseListener`](packages/lib/src/typescript/lib/core/Event.ts#L129) walks the clicked element's ancestor chain to dispatch subtree listeners ([Event.ts:167-187](packages/lib/src/typescript/lib/core/Event.ts#L167)), calling [`DOM.source.getId`](packages/lib/src/typescript/lib/core/DOM.ts#L2360) and [`DOM.source.getParentElement`](packages/lib/src/typescript/lib/core/DOM.ts#L2235) at each step. Both resolve their handle through [`HandleRegistry.resolve`](packages/lib/src/typescript/lib/core/DOM.ts#L235), which throws when the handle was already released. `Tab.closeEntry` (added by `plans/implemented/dock-disposes-tab-content.md`) disposes a tab's content synchronously, inside the very click handler that closed the tab — so when that same click is also the event `baseListener` is mid-way through dispatching, the walk can reach a handle that disposal just released, and throws instead of finishing the walk.

This is a distinct defect from the one `plans/implemented/component-purges-event-listeners.md` fixed. That plan stops a *disposed* component's registration from firing on a *later*, unrelated event. This plan fixes a different case: the registration itself fires correctly, but the ancestor walk then trips over a handle a handler released earlier in the *same* dispatch — reentrancy within one event, not staleness across events.

The reproduction is broad because it needs only two ordinary, independently-shipped ingredients present anywhere on the page at once: some component (e.g. `Table`'s `Body`/`Header`, which register `Event.addSubtreeListener(this, "click"/"contextmenu", …)`) holding a subtree listener for the event type, and a click that synchronously disposes a component along that same click's own bubble path — which is exactly what a tab's close (✕) button does since `dock-disposes-tab-content` shipped. The library's own internal components are enough to trigger it; no consumer code is required. Confirmed against the real 0.4.1 package by a consumer app's investigation (`/home/jika/typescript/sqladmin/LIBRARY_NOTES.md`, "Closing any panel with a live subtree listener throws on the next matching event") — the app stays usable afterward, but the console error is thrown on ordinary use.

Two concrete crash shapes were confirmed empirically against the real production DOM seam (`@vitest-environment jsdom`, mirroring [`tests/dom/handle-registry.test.ts`](packages/lib/tests/dom/handle-registry.test.ts)) while drafting this plan — see `## Architecture Decisions` and `## Expected Behaviour`.

---

## Architecture Decisions

### The ancestor walk becomes tolerant of a handle released mid-dispatch; teardown stays synchronous and eager

Of the two directions posed for this fix — defer disposal until the event finishes bubbling, or make the walk resilient to a handle a disposal already released — this plan makes the walk resilient. Teardown keeps running synchronously, inside the handler that triggered it, exactly as it does today.[^why-not-defer]

### Guard both `DOM.source` reads inside the loop; each catch ends the walk cleanly

[`baseListener`'s ancestor loop](packages/lib/src/typescript/lib/core/Event.ts#L167-L187) makes exactly two calls that resolve a handle: `DOM.source.getId(handle)` ([Event.ts:169](packages/lib/src/typescript/lib/core/Event.ts#L169)) and `DOM.source.getParentElement(handle)` ([Event.ts:186](packages/lib/src/typescript/lib/core/Event.ts#L186)). Both are wrapped in `try`/`catch`; the `catch` clause `return`s from `baseListener`, ending the walk the same way reaching the root (`handle === null`) already does. This mirrors [`FocusHistory.ts`'s `isLive`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L82-L92) — the codebase's existing precedent for exactly this shape of problem: "A GC-collected weak handle throws on resolve inside the DOM seam; that is treated as stale too," via a `try { return DOM.source.isConnected(handle); } catch { return false; }` wrapper around the single seam call that can throw.[^precedent-search]

### No change to `core/DOM.ts`

The fix is scoped entirely to `baseListener`'s loop. `HandleRegistry` / `intern` / `resolve` / `release` are unchanged, and no new `DOMSource` method is added.[^no-dom-change]

---

## Implementation

`packages/lib/src/typescript/lib/core/Event.ts`, inside `baseListener` ([Event.ts:167-187](packages/lib/src/typescript/lib/core/Event.ts#L167)):

```typescript
let handle: Handle | null = targetHandle;
while (handle) {
    let id: string;

    try {
        id = DOM.source.getId(handle);
    } catch {
        // `handle` was released by a disposal that ran synchronously earlier
        // in this same event's dispatch — the exact-target listener phase
        // above (a click that disposes its own target, e.g. a tab's close
        // button), or a subtree listener on a nearer ancestor already
        // visited by this same walk, disposing itself or a not-yet-visited
        // ancestor. Nothing further up this chain can be resolved through
        // this handle either, so the walk ends here instead of throwing.
        // Mirrors FocusHistory.isLive's identical guard around a stale focus
        // handle (core/FocusHistory.ts:82-92).
        return;
    }

    if (id) {
        let compFunc = subtreeListeners.get(id);
        if (compFunc) {
            for (let listener of compFunc.listeners) {
                if (applyDisposition(evnt, listener.apply(compFunc.component, [evnt]))) {
                    propagationStopped = true;
                }
            }
        }
    }

    if (propagationStopped) {
        return;
    }

    try {
        handle = DOM.source.getParentElement(handle);
    } catch {
        // Same reentrancy hazard as above, at the climb-to-parent step: the
        // listeners that just ran on `handle` (immediately above) can
        // themselves have disposed the component `handle` belongs to.
        return;
    }
}
```

No other line in `baseListener` changes. The exact-target phase above the subtree walk ([Event.ts:144-156](packages/lib/src/typescript/lib/core/Event.ts#L144)) needs no guard: it reads `targetHandle` once, before any handler in this dispatch has run, so that handle is always live at that point.

---

## Ordered Implementation Steps

1. Create `packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts` with `// @vitest-environment jsdom` at the top of the file, mirroring [`tests/dom/handle-registry.test.ts`](packages/lib/tests/dom/handle-registry.test.ts)'s harness: cast `DOM.sink` / `DOM.source` to `ProductionDOMSink` / `ProductionDOMSource`, `afterEach(() => DOM.reset())`. Build each test's DOM tree with real `Component` instances — `new Component({})`, `component.getElement(true)` to render, `DOM.sink.appendChild(parentHandle, childHandle)` to assemble the ancestor chain, `DOM.sink.appendChild(DOM.source.getBody(), rootHandle)` to mount it — then dispatch a real event via `document.getElementById(target.getId())!.dispatchEvent(new MouseEvent(type, { bubbles: true }))`. Register `window.addEventListener('error', (e) => { caught = e; e.preventDefault(); })` before each dispatch to capture jsdom's reported exception: an exception thrown inside a native event listener does not propagate through `dispatchEvent()`'s own call stack (confirmed while drafting this plan) — jsdom's `reportException` (`node_modules/jsdom/lib/jsdom/living/helpers/runtime-script-errors.js`) dispatches a synchronous `error` event on `window` instead, mirroring the real browser's "report the exception" algorithm. Cover cases **EV1**–**EV4** from `## Expected Behaviour`. **EV1** and **EV2** reproduce the crash and fail (report a caught `error` event) before step 2; **EV3** and **EV4** pin the unaffected happy path and pass both before and after.

2. `packages/lib/src/typescript/lib/core/Event.ts` — wrap the two `DOM.source` calls inside `baseListener`'s ancestor loop in `try`/`catch` per `## Implementation`. Re-run step 1's tests — green.

3. Regression checkpoint: `npm run test` — full suite green, particular attention to `packages/lib/tests/unit/core/Event.test.ts` and `packages/lib/tests/dom/handle-registry.test.ts`.

4. `packages/lib/docs/reference/changelog/next.md` — replace "Nothing here yet." with a `## Fixed` heading, a `### Core` group, and one bullet per `## Documentation Impact`.

5. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Create | `packages/lib/tests/dom/event-subtree-reentrant-dispose.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable under the real production DOM seam via `@vitest-environment jsdom`, per `## Ordered Implementation Steps`, step 1 — no manual-only case is needed for the fix itself, since (unlike the offline modelled harness) production `release()` genuinely evicts the handle and makes a later resolve throw, which is exactly the condition this plan closes.[^jsdom-vs-offline] One manual smoke check is still worth running to close the loop with the original report.

- **EV1 — an exact-target listener disposing its own click target does not crash the subtree walk.** An ancestor `outer` registers `Event.addSubtreeListener(outer, type, spy)`; its DOM child `child` registers `Event.addListener(child, type, () => child.dispose())`. Dispatch `type` on `child`'s element. No `error` event fires on `window`; `spy` is not called (the target is gone before the walk starts, so there is nothing to walk up from).
- **EV2 — a subtree listener disposing its own component ends the walk without crashing.** Three-level chain `outer` (subtree listener `spy`) → `middle` (subtree listener `() => middle.dispose()`) → `target` (no listener). Dispatch `type` on `target`'s element. No `error` event fires; `spy` is not called — a subtree listener that disposes its own component forgoes any farther ancestor's subtree listeners for that one event, since the handle needed to keep climbing from it is gone.
- **EV3 — normal multi-level subtree dispatch is unaffected.** Three-level chain `outer` → `middle` → `target`, each with a subtree listener appending its own name to an `order` array, none disposing anything. Dispatch `type` on `target`'s element. No `error` event fires; `order` is exactly `['target', 'middle', 'outer']`.
- **EV4 — a `{ stop: true }` (or `true`) disposition at a nearer ancestor still prevents a farther one from firing.** Chain `outer` (subtree listener `spy`) → `middle` (subtree listener returning `true`) → `target` (no listener). Dispatch `type` on `target`'s element. No `error` event fires; `middle`'s listener is called once; `spy` is not called.

**Manual verification** (closes the loop with the original report; not required to pin the fix itself, which EV1/EV2/EV4/EV5 already do against the real DOM seam):

- In a real browser (the demo app, or SQLAdmin against a symlinked local build of this checkout), open a table tab (so `Table`'s `Body`/`Header` subtree listeners are live) and close it via the tab's ✕. No console error. Repeat closing several tabs in a row, including via the right-click context menu's **Close**, **Close others**, and **Close all**.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green, per step 3.
- `npm run build:lib` — succeeds.
- Manual: the browser check in `## Expected Behaviour`.

---

## Documentation Impact

No public API change — `baseListener` is a private, unexported function, and no `DOMSource`/`Event` signature changes. `packages/lib/docs/reference/changelog/next.md` gains one `## Fixed` → `### Core` bullet: a component disposed synchronously by a handler running during an event's own dispatch — most commonly, a tab's close button disposing the tab's content — no longer throws `DOM handle <n> is not registered` when that same event's subtree-listener walk reaches the released handle; the walk now ends cleanly at that point instead. No migration entry: this changes no signature and no consumer-visible contract other than "no longer throws." Once a version is cut, this bullet moves onto that version's own changelog page per `next.md`'s own stated workflow; this plan does not name a version number or touch any `package.json`.

---

## Potential Challenges

- **An unqualified `catch` could mask an unrelated exception.** Mitigation: both guarded calls delegate to `HandleRegistry.resolve` ([DOM.ts:235-249](packages/lib/src/typescript/lib/core/DOM.ts#L235)), whose only two throw conditions are "not registered (released or never minted)" and "refers to a collected node" — both mean the handle is stale, which is exactly the condition the walk should stop on. `FocusHistory.isLive` catches just as broadly for the same reason.
- **EV2's limitation is real, not a workaround.** A subtree listener that disposes its own component forecloses any farther ancestor's subtree listeners for that one event — there is no way to keep climbing from a handle whose registry entry is gone. This is the correct, minimal behaviour for an edge case that used to crash outright; it is not a regression against any documented contract.
- **`component-purges-event-listeners`'s own reentrancy note stays valid.** Its Potential Challenges section already covers a handler disposing its own component mid-dispatch from the *purge*'s side ("the purge deletes whole map entries rather than splicing that [listeners] array, so the in-flight iteration completes normally"). This plan's change is scoped to the separate ancestor-climbing loop and does not touch that iteration.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `baseListener` (129), the exact-target phase (144-156), the ancestor-climbing loop this plan changes (167-187).
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `HandleRegistry.resolve` (235), `.release` (259), `.intern` (212); `ProductionDOMSource.getId` (2360), `.getParentElement` (2235). Read-only context; nothing here changes.
- [`packages/lib/src/typescript/lib/core/FocusHistory.ts:82-92`](packages/lib/src/typescript/lib/core/FocusHistory.ts#L82) — `isLive`, the precedent this plan's guard mirrors.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `destructor` (756-864); `flushPendingLayouts`'s disposal guard (203-224), the closest same-file precedent for "an earlier entry's synchronous disposal must not crash the rest of the same pass," done there via a proactive `c.getElement()` check rather than try/catch because that guard's invalidation signal doesn't throw.
- [`packages/lib/tests/dom/handle-registry.test.ts`](packages/lib/tests/dom/handle-registry.test.ts) — the `@vitest-environment jsdom` + real production-seam harness this plan's new test file mirrors, and the existing "release drops the entry and makes a later resolve throw" case that is the direct evidence production `release()` behaves differently from the offline `RecordingDOMSink`.
- [`packages/lib/tests/core/DisposedPendingLayout.test.ts`](packages/lib/tests/core/DisposedPendingLayout.test.ts) — the sibling "earlier entry's disposal invalidates a later one in the same synchronous pass" guard, and its comment (lines 87-94) on why the *offline* harness can't pin that guard's throw-avoidance directly — the reason this plan's own tests use the jsdom environment instead.
- `plans/implemented/component-purges-event-listeners.md`, especially `[^placement]` — why the purge runs first in `destructor()`, and the library's established preference for guarding call sites over deferring teardown.
- `plans/implemented/dock-disposes-tab-content.md` — made `Tab.closeEntry` synchronously dispose content, which is what exposes this defect.

---

## Non-Goals

- **Deferring any disposal to a microtask or animation frame.** Rejected in `## Architecture Decisions`; see `[^why-not-defer]`.
- **Changing `HandleRegistry`, `intern`, `resolve`, or `release` in `core/DOM.ts`.** The fix is fully scoped to `Event.ts`'s dispatch site. See `[^no-dom-change]`.
- **A dedicated test for a farther, not-yet-visited ancestor disposed by a nearer one's listener (not self-dispose).** Confirmed while drafting this plan that this case does not throw today and is unaffected by this change — see `[^no-dom-change]`. Nothing here needs fixing or pinning by this plan.
- **A patch to 0.4.1.** The shipped 0.4.1 does not have this fix; per `## Documentation Impact`, this change accumulates in `next.md` for whatever release is cut next (0.4.2), following on from `component-purges-event-listeners`, not as a hotfix to the prior release.

---

## Notes

[^why-not-defer]: Two things independently rule out deferring `Tab.closeEntry`'s (or any) disposal until after the current event finishes bubbling. First, no precedent for it exists: `Event.ts` and `Component.ts` have no `queueMicrotask` or "run after the current dispatch settles" mechanism anywhere — the only deferral pattern in `Component.ts` is the `requestAnimationFrame`-coalesced `pendingLayouts` / `pendingVisibility` queues (Component.ts:162-233), which defer a *redundant recomputation*, not a disposal contract, and introducing a new deferral shape for this would be inventing a pattern rather than following one. Second, and more concretely, deferring would contradict the library's own settled reasoning and break existing coverage: `component-purges-event-listeners.md`'s `[^placement]` footnote explains that its purge runs *first* in `destructor()` specifically so no later part of that same synchronous call can leave a registration that fires against a handle the *rest* of that same `destructor()` call is about to release — the fix keeps teardown synchronous and closes the gap by guarding what runs after it, not by spreading teardown across turns. `dock-disposes-tab-content.md` is built on the same assumption throughout: its own test cases (T1, D1, D2, N1) assert, synchronously after `closeTab()` / `removePanel()` returns, that the closed content's stylesheet rules are already gone — deferred disposal would turn every one of those into a false negative until the deferred turn ran. Guarding the walk is strictly smaller and carries none of this risk.

[^precedent-search]: Searched `core/Event.ts`, `core/Component.ts`, and `core/DOM.ts` for any existing "handle might be stale, check first" pattern before choosing this shape. `Component.ts`'s `flushPendingLayouts` (203-224) and its sibling `flushPendingVisibility` guard the identical class of hazard — an earlier entry's synchronous disposal invalidating a later one in the same pass — but do it with a proactive boolean check (`c.getElement()`), because a disposed `Component`'s `getElement()` simply returns `undefined`; there is nothing to catch. `Event.ts`'s own `baseListener` has no such boolean predicate available for a raw `Handle` — the DOM seam only signals "released" by throwing — so the shape has to differ from `flushPendingLayouts` even though the underlying principle (don't let an earlier disposal in this same pass crash the rest of it) is the same one. `FocusHistory.ts`'s `isLive` (82-92) is the closer match: it faces the exact same "the seam only tells you via a throw" constraint, for a conceptually identical reason (a handle recorded earlier might have gone stale by the time it's read again), and solves it with `try { … } catch { return false; }` around the one seam call that can throw. No other DOM-seam call site in `core/` (checked every `getParentElement` call outside `DOM.ts` itself) sits inside a walk that can be reentered by a disposal the walk's own dispatch triggered, so `FocusHistory.isLive` is the only structurally comparable precedent, and this plan follows its shape rather than inventing a new one.

[^no-dom-change]: Confirmed empirically while drafting this plan (via a throwaway `@vitest-environment jsdom` script against the real `ProductionDOMSink`/`ProductionDOMSource`, run and then discarded — not part of this plan's deliverable) that exactly two distinct call sites throw during real reentrant dispatch: `DOM.source.getId(targetHandle)` at the top of the loop, when the click's own target was disposed by the exact-target listener phase that ran just before the walk started; and `DOM.source.getParentElement(handle)` at the bottom of the loop, when a subtree listener disposes its own component during its own handler. A third candidate case — a *nearer* ancestor's subtree listener disposing a *farther*, not-yet-visited ancestor (not itself) — was tested the same way and does **not** throw: `ProductionDOMSource.getParentElement` (DOM.ts:2235) calls `HandleRegistry.intern` (DOM.ts:212) fresh on the raw parent node every time, and `intern` mints a new handle for any live node whose previous handle was released rather than failing — so the walk simply keeps going under a new handle number for that ancestor, and finds no listener to run because `component-purges-event-listeners` already purged its `subtreeListenerMap` entry when it was disposed. This is why guarding exactly the two calls inside the loop is sufficient, and why no change to `HandleRegistry`/`intern`/`resolve` is needed: the registry already tolerates a released-then-rereferenced node everywhere except where a *specific stale handle number* already held in a variable is reused directly, which is exactly what the two guarded calls close off.

[^jsdom-vs-offline]: `packages/lib/tests/unit/core/Event.test.ts` explicitly documents that it asserts bookkeeping only, "NOT real event delivery, since the modelled source exposes no live tree" — the offline `RecordingDOMSink.release()` (used by `installTestDOM`) records the call but does not evict its stub table, so a released handle keeps resolving offline and a throw-based test would pass vacuously (this exact limitation is why `DisposedPendingLayout.test.ts`'s comparable guard, lines 87-94, is verified live rather than by a unit test). `handle-registry.test.ts` sidesteps this by running under `@vitest-environment jsdom` against the real `ProductionDOMSink`/`ProductionDOMSource`, where `release()` genuinely evicts the registry entry and a later resolve genuinely throws ("release drops the entry and makes a later resolve throw"). This plan's new test file uses the same real environment for the same reason, which is what makes EV1/EV2/EV4/EV5 automated rather than manual-only.
