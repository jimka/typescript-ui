---
touches-shared: [packages/lib/docs/reference/changelog/next.md]
---

# Dialog Focus Restore to a Disposed Opener — Implementation Plan

## Overview

When a `Dialog` closes, it returns focus to the element that had focus when it opened. `open()` stores that element as a DOM handle in `_previousFocus` ([overlay/Dialog.ts:963](packages/lib/src/typescript/lib/overlay/Dialog.ts#L963)). `hide()`'s `finalize` then calls `DOM.sink.focus(this._previousFocus)` unguarded, and only afterwards resolves the `show()` promise ([overlay/Dialog.ts:1417-1423](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1417)).

If the opener was disposed while the dialog was open, its handle has been released. `DOM.sink.focus` resolves the handle through the registry, which throws `DOM handle <n> is not registered` ([core/DOM.ts:2271](packages/lib/src/typescript/lib/core/DOM.ts#L2271)). The throw skips the resolve, so `show()` never settles and any `finally` after the caller's `await` never runs. SQLAdmin hits this on every successful create-tab *Execute*: the action closes the tab that holds the *Review SQL…* button that opened the dialog, and one error banner leaks per run.

The fix is local to `Dialog`: skip the focus restore when the stored handle is no longer live, and settle the promise in a `finally` so a failed restore can never strand it. Tests go in [tests/overlay/Dialog.test.ts](packages/lib/tests/overlay/Dialog.test.ts); a changelog entry goes in [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md) and a sentence in [docs/components/Dialog.md](packages/lib/docs/components/Dialog.md). Ships in 0.11.0.

---

## Architecture Decisions

### Liveness check — `isRegistered` then `isConnected`, as `Tooltip` does

Before focusing, `Dialog` checks `DOM.source.isRegistered(handle) && DOM.source.isConnected(handle)`. This mirrors the remembered-anchor guard in `Tooltip._onAnchorWatch` ([overlay/Tooltip.ts:132](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L132)). `DOM.source.isRegistered` ([core/DOM.ts:1534](packages/lib/src/typescript/lib/core/DOM.ts#L1534)) is the seam's documented query for "a handle held across time that may not have survived". No new DOM API is added.[^liveness-helper]

The two checks must run in that order: `isConnected` itself resolves the handle and throws on a released one.

| Opener state at close | `isRegistered` | `isConnected` | Restore? |
|---|---|---|---|
| Still mounted | `true` | `true` | Yes — focus the opener |
| Disposed (handle released) | `false` | not called | No |
| Detached but not disposed (e.g. its panel removed from the page, kept for reuse) | `true` | `false` | No |
| Nothing was focused at open (`_previousFocus === null`) | not called | not called | No |

### Fallback when the opener is gone — leave focus on the page

When the opener is not live, `Dialog` makes no focus call. The dialog's own element has already been removed by then, so the browser has put focus on the document body. The dialog does not pick a substitute target.[^fallback]

### Settle the promise in a `finally`

`finalize` wraps the focus restore in `try { … } finally { … }` and resolves `_resolvePromise` in the `finally`. A restore that still throws for some other reason keeps throwing — the error stays visible — but `show()` resolves with the caller's result regardless.[^finally-not-catch]

Resolving in the `finally` does not change what callers see. A `Promise` resolve only queues the caller's continuation, and that continuation runs after `finalize` returns, so an `await dialog.show()` still resumes with focus already restored.

### Scope — only `Dialog` has the defect

Every other `DOM.sink.focus` call on a handle kept across time is already guarded, and no other overlay restores an opener's focus.

| Site | Handle source | Status |
|---|---|---|
| `Dialog` finalize ([overlay/Dialog.ts:1418](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1418)) | `_previousFocus`, stored at `open()` | **Unguarded — fixed here** |
| `FocusHistory` `revealAndFocus` ([core/FocusHistory.ts:157](packages/lib/src/typescript/lib/core/FocusHistory.ts#L157)) | trail entries | Guarded: `navigate` runs `pruneStale` (`isLiveHandle`) first |
| `SpatialNavigation` `tryFocusCandidates` ([core/SpatialNavigation.ts:628](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L628)) | `_lastFocus` memory | Guarded: `focusCandidates` drops a non-live recorded handle ([core/Focusable.ts:191](packages/lib/src/typescript/lib/core/Focusable.ts#L191)) |
| `Dialog` `focusFirst` / `onTab` / `stepPastOwner`, `FocusTraversal.focusStop`, `Component.focus` / `restoreReleasedState` | queried in the same call, or the component's own element | Not stored — no risk |
| `Menu`, `Popover`, `PopupPanel`, `Drawer`, `Window` / `AbstractWindow`, `Notification` | — | Do not store or restore an opener's focus |

---

## Internal Structure

`finalize` in `hide()` ([overlay/Dialog.ts:1407-1424](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1407)) becomes:

```ts
const finalize = (): void => {
    this._finalizing = true;

    this._backdrop.destroy();
    this.removeElement();
    this.destructor();

    LayerManager.unregister(this);
    untrapWheel(this);

    try {
        this.restorePreviousFocus();
    } finally {
        if (this._resolvePromise) {
            this._resolvePromise(result);
            this._resolvePromise = null;
        }
    }
};
```

New private method on `Dialog`, placed directly after `hide()`:

```ts
/**
 * Returns focus to the element that held it when the dialog opened. Skipped
 * when nothing was focused then, or when that element has since been
 * disposed or removed from the page — focus is then left where the browser
 * put it. Clears the stored handle either way.
 */
private restorePreviousFocus(): void {
    const previous = this._previousFocus;

    this._previousFocus = null;

    if (previous === null) {
        return;
    }

    // The handle was stored at open() and may have been released since (the
    // opener disposed while the dialog was open). Ask first: every other read
    // of a released handle throws. isRegistered must come first, because
    // isConnected itself throws on a released handle.
    const live = DOM.source.isRegistered(previous) && DOM.source.isConnected(previous);

    if (!live) {
        return;
    }

    DOM.sink.focus(previous);
}
```

The liveness result goes into a local before the `if`, per the project's no-call-in-`if`-condition rule.

---

## Ordered Implementation Steps

1. **Write the failing tests** in [tests/overlay/Dialog.test.ts](packages/lib/tests/overlay/Dialog.test.ts). Add a new `describe('Dialog — focus restore on close', …)` block directly after the existing `describe('Dialog — hide under reduced motion', …)` block (line 1210). Cover every case in `## Expected Behaviour` (cases 1–6). Setup for each test:
   - `installTestDOM(CONFIG)`, then force reduced motion so `hide()` finalizes synchronously: `vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} })` (the same line the reduced-motion block uses).
   - Build the opener (every case except case 4, which builds none): `const opener = new Button({ text: 'Open' }); const openerEl = opener.getElement(true)!; setConnected(openerEl, true); DOM.sink.focus(openerEl);`. The modelled DOM reads every handle as disconnected until `setConnected` says otherwise.
   - **Then** install a focus spy that behaves like production for released handles: `const focus = vi.spyOn(DOM.sink, 'focus').mockImplementation((handle) => { if (!DOM.source.isRegistered(handle)) { throw new Error(\`DOM handle ${handle} is not registered\`); } });`. Install it after `installTestDOM` (which swaps `DOM.sink`) and after the opener's own `DOM.sink.focus`, so the spy only sees the dialog's calls.[^test-spy]
   - Open with `const promise = dialog.show();` and record settlement with `let settled: DialogResult | null = null; void promise.then(r => { settled = r; });`. After `hide`, `await Promise.resolve();` once, then assert on `settled`. Do not `await promise` directly — against the unfixed code that would hang until the test timeout instead of failing.
   - `afterEach(() => { vi.restoreAllMocks(); DOM.reset(); })`, matching the neighbouring blocks.
   - Add `setConnected` to the existing `../dom/TestDOM` import and `DialogResult` to the existing type import from `~/overlay/Dialog`.
   - Check: `npx vitest run tests/overlay/Dialog.test.ts` from `packages/lib` — cases 2 and 5 fail (the reported bug), case 3 fails (the spy is called with the detached handle), and case 6 fails (the handle is never cleared); cases 1 and 4 pass.
2. **Add `restorePreviousFocus()`** to `Dialog` in [overlay/Dialog.ts](packages/lib/src/typescript/lib/overlay/Dialog.ts), directly after `hide()`, exactly as in `## Internal Structure`.
3. **Rewrite `finalize`** inside `hide()` ([overlay/Dialog.ts:1407-1424](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1407)) as in `## Internal Structure`: replace the `if (this._previousFocus !== null) { DOM.sink.focus(this._previousFocus); }` block and the following resolve block with the `try`/`finally`. Leave everything above them in `finalize` unchanged.
   - Check: `grep -n "DOM.sink.focus(this._previousFocus)" packages/lib/src/typescript/lib/overlay/Dialog.ts` — expect zero matches.
4. **Update `hide()`'s JSDoc** ([overlay/Dialog.ts:1393-1401](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1393)). Replace the description with: "Dismisses the dialog with a brief fade-and-scale animation, returns focus to the element that had it when the dialog opened (unless that element has since been disposed or removed from the page), and resolves the promise — even if restoring focus fails." Keep the `@param` and `@remarks` as they are. Do not `{@link}` the private method.
5. **Run the tests again** — all six cases in the new block pass, and the rest of `Dialog.test.ts` still passes.
6. **Add a sentence to** [docs/components/Dialog.md](packages/lib/docs/components/Dialog.md), in `### Keyboard`, as a new paragraph right after the first one (the one ending "so focus cannot reach the page behind the dialog.", line 149): "When the dialog closes, focus returns to the element that had it when the dialog opened. If that element was disposed or removed from the page while the dialog was open, focus stays on the page instead."
7. **Add the changelog entry** in [docs/reference/changelog/next.md](packages/lib/docs/reference/changelog/next.md), as the last bullet under `## Fixed` → `### Overlay`:

   ```markdown
   - **A `Dialog` whose opener is disposed while it is open now closes cleanly
     and resolves `show()`.** On close, a dialog returns focus to the element
     that had it when the dialog opened. If that element had been disposed in
     the meantime — a button in a tab the dialog's own action closed, say — the
     restore threw `DOM handle <n> is not registered`, and the promise `show()`
     returned never resolved, so code after the `await`, a `finally` included,
     never ran. The dialog now skips the restore when that element is gone or
     no longer on the page, leaving focus on the page, and resolves `show()`
     even if restoring focus fails. No consumer action is needed.
   ```

8. **Run the full verification** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/lib/docs/components/Dialog.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases run under reduced motion, so `hide()` finalizes synchronously. "Focus spy" is the production-like spy from step 1. All are unit-testable.

1. **Live opener is refocused.** Opener mounted and connected; `show()`, then `hide('confirm')`. The focus spy is called exactly once, with `openerEl`. The promise resolves `'confirm'`.
2. **Disposed opener — the reported bug.** `show()`, then `opener.dispose()`, then `hide('confirm')`. `hide` does not throw. The focus spy is never called with `openerEl`. The promise resolves `'confirm'` (checked through `settled` after one `await Promise.resolve()`).
3. **Detached opener.** `show()`, then `setConnected(openerEl, false)`, then `hide('cancel')`. The focus spy is not called. The promise resolves `'cancel'`.
4. **Nothing focused at open.** Build no opener and focus nothing, so `DOM.source.getActiveElement()` is `null` when `show()` runs. `hide('confirm')`: the focus spy is not called; the promise resolves `'confirm'`.
5. **A failing restore still resolves.** Opener live. Replace the spy's implementation with one that always throws `new Error('boom')`. `expect(() => dialog.hide('confirm')).toThrow('boom')` — the error stays visible. The promise still resolves `'confirm'`.
6. **The stored handle is cleared.** After case 1's `hide`, `(dialog as any)._previousFocus` is `null`.

Manual (not reachable by the modelled DOM): the SQLAdmin repro in `## Verification`.

---

## Verification

From `packages/lib`:

- `npm run typecheck`
- `npm run lint`
- `npm test` — includes the new `Dialog — focus restore on close` block.
- `npm run docs:api`

Manual, in SQLAdmin against this build (run `npm run build:lib`, then point SQLAdmin's symlink override at this worktree's built `dist/lib`):

1. Navigator → *Create schema* (or table, view) → fill the form → *Review SQL…* → *Execute*.
2. The create tab closes and the navigator refreshes. The browser console shows no `DOM handle <n> is not registered` error.
3. Repeat twice. No stale error banner remains anywhere — `SqlPreviewDialog`'s `finally { errorBanner.dispose() }` now runs.
4. Open any dialog from a button that stays on screen (e.g. a confirm), close it with *Cancel*, and check that focus is back on that button.

---

## Critical Files

- [packages/lib/src/typescript/lib/overlay/Dialog.ts](packages/lib/src/typescript/lib/overlay/Dialog.ts) — `open()` (line 962), `hide()` and its `finalize` (lines 1402-1424), `destructor()` (line 1467).
- [packages/lib/src/typescript/lib/overlay/Tooltip.ts:122-135](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L122) — the liveness guard this plan mirrors.
- [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) — `isRegistered` contract (line 1525-1534) and production `focus` (line 2271).
- [packages/lib/tests/overlay/Dialog.test.ts](packages/lib/tests/overlay/Dialog.test.ts) — `TestDialog`, `CONFIG`, and the reduced-motion block (line 1210) the new tests copy their setup from.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — `setConnected`, and the modelled `focus` / `release` / `isRegistered`.

---

## Non-Goals

- **No change to the bare-`dispose()` path.** A dialog disposed without `hide()` resolves `'close'` in `destructor()` and has never restored focus; that stays as is.
- **No smarter fallback target** (a lower stacked dialog, the next tab, a nearest surviving ancestor). The code that disposed the opener knows where focus should go; the dialog does not.
- **No new `DOM` API** and no change to `isLiveHandle` or the modelled `isConnected`.
- **No change to other overlays.** The scope table shows none of them has the defect.

---

## Notes

[^liveness-helper]: `core/Focusable.ts` also has `isLiveHandle` ([core/Focusable.ts:46](packages/lib/src/typescript/lib/core/Focusable.ts#L46)), used by `FocusHistory` and `SpatialNavigation`. It was not chosen for two reasons. It detects a released handle by catching whatever `isConnected` throws, which also swallows unrelated errors, while `isRegistered` asks the question directly. And the modelled test DOM's `isConnected` does not throw for a released handle — it reads a connectivity set that `release` never clears — so `isLiveHandle` would call a disposed opener "live" in tests, and case 2 would keep failing after the fix for a model reason rather than a code reason. `isRegistered` reads the stub table, which `release` does clear, so the model and production agree. The Tooltip guard is also exactly what the SQLAdmin report recommends.

[^fallback]: Substitutes considered and rejected: (a) focus the next layer down in `LayerManager` — `DismissableLayer` has no "take focus" method, and reaching into a lower `Dialog`'s private `focusFirst` would couple instances; (b) walk up to the opener's nearest surviving ancestor — the ancestor chain cannot be read from a released handle, so it would have to be captured at `open()` for a rare case; (c) explicitly focus `document.body` — the browser already does this when the focused element is removed, so the call adds nothing. In the SQLAdmin case the tab close is what disposed the opener, and the `Dock` owns moving focus to a surviving panel.

[^finally-not-catch]: A `catch` that swallows the error was rejected. The seam's design keeps a genuine use of a released handle loud (see `isRegistered`'s doc in `core/DOM.ts`: "It is not a licence to skip `resolve`'s failure"). With the liveness check in place, a throw from the restore would be a real bug worth seeing; the `finally` only makes sure it can no longer strand the caller's `await`. Moving the resolve above the restore without a `try` was also considered — it has the same observable effect, but a later edit could reorder it back without noticing; the `try`/`finally` states the rule in the code.

[^test-spy]: The modelled `DOM.sink.focus` just records the handle as focused and never resolves it, so without the spy the unfixed code would not throw in tests and case 2 would pass against the bug. The spy reproduces production's `resolve` failure for released handles, using the model's `isRegistered` (which `release` updates). The spy also replaces the model's focus recording, so tests assert on spy calls, not on `DOM.source.getActiveElement()`.
