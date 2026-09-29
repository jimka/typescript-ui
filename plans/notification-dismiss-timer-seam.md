---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - plans/research/render-review-2026-09-15/01-phase2-status-pass.md
---

# Notification Auto-Dismiss Timer Seam — Implementation Plan

## Overview

`Notification` arms its auto-dismiss with the bare global `setTimeout`, so `DOM.reset()` cannot cancel it. The timer's callback is `() => this.dismiss()`, and `dismiss()` writes through the toast's element handle — a handle the reset has already discarded. Two arm sites and two clear sites are involved: [`startTimer`](packages/lib/src/typescript/lib/overlay/Notification.ts#L466) at `:466`, [`restartTimer`](packages/lib/src/typescript/lib/overlay/Notification.ts#L505) at `:505`, and the `clearTimeout` calls at [`:478`](packages/lib/src/typescript/lib/overlay/Notification.ts#L478) and [`:571`](packages/lib/src/typescript/lib/overlay/Notification.ts#L571). The field is declared at [`:145`](packages/lib/src/typescript/lib/overlay/Notification.ts#L145).

All four sites move onto the `DOMSink` seam, which already owns `setTimeout` / `clearTimeout` / `clearAllTimeouts` ([core/DOM.ts:1080-1094](packages/lib/src/typescript/lib/core/DOM.ts#L1080)) and which `DOM.reset()` sweeps ([core/DOM.ts:3327-3338](packages/lib/src/typescript/lib/core/DOM.ts#L3327)). `Notification.destructor()` also gains a clear of its own, because the seam sweep only helps when something calls `DOM.reset()`, and disposing a live toast today leaves its timer armed.

The defect is dormant: the suite is green with the bug present, because the 3 s default duration outlasts every test file. That makes the prescribed verification the risky part of this plan, so `## Expected Behaviour` names, for every case, which mutation of which shipped line turns it red.[^dormant] The change touches one source file, one new test file, the changelog, and the research record.

---

## Findings

Measured on `master` (`467ffb4e`) with a throwaway probe run under the offline harness. Every number below was observed, not inferred.

| # | Fact | Why the plan needs it |
|---|---|---|
| 1 | `Notification.show('msg', 'info', 3000)` records **zero** seam timer ops today. | After the fix it records exactly one, so `## Expected Behaviour` E1 can assert an exact list rather than a "contains". |
| 2 | `Date.now()` advances with `vi.advanceTimersByTime` under a plain `vi.useFakeTimers()`. | The pause/resume arithmetic is already deterministic offline, which is why it keeps `Date.now()` (see *Architecture Decisions*). |
| 3 | With the bug present, a toast's dismiss callback **does** run after `DOM.reset()` — one call, every time. | E5 is red on `master`, so it is a real pin and not a vacuous one. |
| 4 | `DOM.reset()` leaves `_dismissTimer` holding a **dead id**, not `null`. | An assertion on `_dismissTimer === null` after a reset would be red with the fix too; the plan forbids it. |
| 5 | `toast.dispose()` leaves the timer armed, and it fires. | The `destructor()` clear is a real gap, and E7 is red on `master`. |
| 6 | 51 toasts shown the way `NotificationHistory.test.ts`'s cap case shows them, then `DOM.reset()`: **51 of 51** callbacks fire. | E8 reproduces most of the research record's "about 60 per run" — that one case accounts for 51 of them. |
| 7 | `restartTimer` early-returns while `_dismissTimer` is non-`null`, so a toast whose timer the reset swept can never be resumed. | Recorded in *Potential Challenges*; it is accepted, not fixed. |
| 8 | A toast shown while a pause hold is open arms its timer and clears it again immediately, ending with `_dismissTimer === null`. | A stray hold left by an earlier case would make E1 fail confusingly, which is why the new test file zeroes the hold counters. |
| 9 | `Notification.show(msg, type, 0)` arms nothing. | E9, the persistent-toast regression guard. |

---

## Architecture Decisions

### Both arm sites and both clear sites move onto the `DOMSink` seam

`_dismissTimer` becomes a `TimerId | null`, armed with `DOM.sink.setTimeout` and cleared with `DOM.sink.clearTimeout` at every site. `DOM.reset()` then cancels a dismiss that is still waiting. The precedent is [`AutoCompleteField`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L136), whose two timers already take this exact shape — field type at `:136`, arm at `:518`, clears at `:505` / `:742` / `:747` — and [`TableHeader`](packages/lib/src/typescript/lib/component/table/Header.ts#L297), which got the same change for the same reason in `plans/implemented/test-suite-health.md`.[^why-seam]

### `destructor()` clears the timer too

`Notification.destructor()` ([Notification.ts:712](packages/lib/src/typescript/lib/overlay/Notification.ts#L712)) gains a guarded `DOM.sink.clearTimeout` of `_dismissTimer` before it cancels the animations. Disposing a live toast currently leaves the timer armed, and it fires.[^destructor-gap] The precedent is [`AutoCompleteField.destructor`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L740), which clears both of its seam timers the same way.

### The pause/resume arithmetic keeps `Date.now()`

`startTimer`, `pauseTimer` and `restartTimer` keep reading `Date.now()` directly. No clock joins the seam.[^keep-date-now]

The arithmetic itself does not change. Shown against a toast opened with `Notification.show(msg, type, 3000)`:

| Sequence | `_remainingDuration` after | Seam op |
|---|---|---|
| `show` | 3000 | `setTimeout 3000` |
| 1000 ms elapse, then a hover hold is taken | 2000 | `clearTimeout` |
| that hover hold is released (no clamp) | 2000 | `setTimeout 2000` |
| `pauseAll()` with no time elapsed | 3000 | `clearTimeout` |
| `resumeAll()` (clamped to `MIN_RESUMED_MS`) | 8000 | `setTimeout 8000` |
| `show(msg, type, 3000)` while a hold is already open | 3000 | `setTimeout 3000`, then `clearTimeout` |
| `show(msg, type, 0)` | 0 | nothing armed |

### Nothing else in `Notification` changes

`Notification` holds no other bare timer and no other uncancelled async.[^rest-of-notification] The static stack, the hold counters and the detail dialog's promise are left alone, and each is listed in `## Non-Goals` with its reason.

### The eleven bare timers elsewhere in the library stay put

Eleven other arm sites across nine files still call the global `setTimeout`. They are enumerated in [*Addendum: The bare timers that remain*](#addendum-the-bare-timers-that-remain) and none is touched here. The recommendation that follows from their number — make the seam enforced rather than conventional, through a lint rule — is worked out there and belongs to its own plan.[^third-instance]

### The pins observe a recorded seam op and a suppressed callback

Two assertion shapes carry the whole verification, both taken from `test-suite-health`'s `ColumnFilterRow` pins, which hold up.[^pin-shapes]

1. **Recorded op.** Read `RecordingDOMSink.writes`, keep the `setTimeout` / `clearTimeout` entries, and assert the exact sequence of ops and delays. Reverting an arm or clear site to the global makes the entry vanish.
2. **Suppressed callback.** Replace the toast's own `dismiss` with a recording no-op — the `spyOnDismiss` helper in `## Internal Structure` — then reset or dispose, then advance the clock, then assert the spy was never called. The armed closure is `() => this.dismiss()`, so it looks the method up on the instance when it fires and finds the spy.

The spy must be given an empty implementation. The real `dismiss()` writes through a handle the reset has discarded, so calling through would throw out of `vi.advanceTimersByTime` and the red run would report a crash instead of a failed assertion.

### Commit grouping

| Commit | Bucket | Contents |
|---|---|---|
| 1 | code | Steps 1-6: the seam routing, E1-E6 / E8-E10 in the new test file, and the superseded comment in `Notification.test.ts` |
| 2 | code | Steps 7-9: the `destructor()` clear, and E7 |
| 3 | documentation | Step 10: the changelog entry |
| 4 | bookkeeping | Step 11: the research-record update |

The two code commits are separate because they are two functionalities against one field: routing the timer so a reset can sweep it, and clearing it so a dispose does not need one. Each is independently pinnable — commit 1 by E1-E6 and E8, commit 2 by E7 alone.

---

## Internal Structure

`Notification` after the change. Four lines move onto the seam and one block is new; nothing else in the class is edited.

```typescript
import type { Handle, TimerId } from "~/core/DOM.js";          // :20, TimerId added

private _dismissTimer: TimerId | null = null;                  // :145

// startTimer, :466
this._dismissTimer = DOM.sink.setTimeout(() => this.dismiss(), ms);

// pauseTimer, :478
DOM.sink.clearTimeout(this._dismissTimer);

// restartTimer, :505
this._dismissTimer = DOM.sink.setTimeout(() => this.dismiss(), this._remainingDuration);

// dismiss, :571
DOM.sink.clearTimeout(this._dismissTimer);
```

The new block at the top of `destructor()` ([:712](packages/lib/src/typescript/lib/overlay/Notification.ts#L712)), before the two animation cancels:

```typescript
// An auto-dismiss still waiting would fire against the element handles
// released below. `dismiss()` clears it on the normal path; this covers a
// dispose that arrives from an owner instead.
if (this._dismissTimer !== null) {
    DOM.sink.clearTimeout(this._dismissTimer);
    this._dismissTimer = null;
}
```

The new test file's fixture. The two deviations from the sibling `Notification` test files are the fake clock and the teardown, both explained in the comments the implementer should keep:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Notification } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The toast duration every case below opens with. */
const DISMISS_MS = 3000;

/** `MIN_RESUMED_MS`, mirrored from `Notification` so E2's clamp is derived rather than guessed. */
const MIN_RESUMED_MS = 8000;

let sink: RecordingDOMSink;

type NotificationStatics = {
    activeNotifications: Notification[];
    history:             unknown[];
    modalCount:          number;
    hoverCount:          number;
};

/** The class's private static state; the constructor is private, as in the sibling files. */
function statics(): NotificationStatics {
    return Notification as unknown as NotificationStatics;
}

/** The toast most recently shown. */
function liveToast(): Notification {
    const active = statics().activeNotifications;

    return active[active.length - 1];
}

/** A toast's private dismiss entry point, replaced by a recording no-op. */
function spyOnDismiss(toast: Notification): MockInstance<() => void> {
    return vi.spyOn(toast as unknown as { dismiss(): void }, 'dismiss').mockImplementation(() => {});
}

/**
 * A toast's own pause/resume pair. `resumeAllTimers(false)` — the unclamped
 * resume — is reachable only from `releaseHoverHold`, which needs a synthesized
 * `mouseover`/`mouseout` pair, so E3 drives the instance methods the hover path
 * calls instead.
 */
function timerControls(toast: Notification): { pauseTimer(): void; restartTimer(clampMin: boolean): void } {
    return toast as unknown as { pauseTimer(): void; restartTimer(clampMin: boolean): void };
}

/** The seam timer ops recorded since `from`, as `['setTimeout', 3000]`-style pairs. */
function timerOps(sink: RecordingDOMSink, from: number): Array<[string, unknown]> {
    return sink.writes
        .slice(from)
        .filter(w => w.op === 'setTimeout' || w.op === 'clearTimeout')
        .map(w => [w.op, w.op === 'setTimeout' ? w.args[0] : null] as [string, unknown]);
}

beforeEach(() => {
    sink = installTestDOM(CONFIG);

    // The static stack, the history ring and the two hold counters all outlive
    // DOM.reset(), so a case that ends with a live toast would otherwise leak
    // into the next one. A leaked hold matters most: a toast shown while a hold
    // is open clears its own timer immediately, which would make E1 fail for a
    // reason that has nothing to do with the seam.
    statics().activeNotifications = [];
    statics().history             = [];
    statics().modalCount          = 0;
    statics().hoverCount          = 0;

    vi.useFakeTimers();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    DOM.reset();
});
```

---

## Ordered Implementation Steps

"Run the file" below means, from `packages/lib`, `npx vitest run tests/overlay/Notification.dismissTimer.test.ts` — the single-file form [`test-suite-health`](plans/implemented/test-suite-health.md) used. Never invoke `vitest` with a bare `--root`. Full-suite commands run from the worktree root. Nothing in this plan opens a window: no `packages/qa/runqa.sh`, no MiniBrowser, no Tauri `qa-host`, no `npm run dev`.

**Commit 1 — the seam routing**

1. **Create the test file, red first.** Create `packages/lib/tests/overlay/Notification.dismissTimer.test.ts` with the fixture from `## Internal Structure` and cases E1-E6 and E8-E10 from `## Expected Behaviour`. Model the file header comment on [`Notification.resize.test.ts:1-15`](packages/lib/tests/overlay/Notification.resize.test.ts#L1): say that the auto-dismiss timer gets its own file because it is the only `Notification` concern that needs a fake clock, and that it supersedes [`Notification.test.ts:1-16`](packages/lib/tests/overlay/Notification.test.ts#L1)'s claim that auto-dismiss needs a real-DOM harness.

   Run the file. Expect E1-E6 and E8 to fail and E9-E10 to pass. If any of E1-E6 or E8 passes here, stop and report: that case is pinning nothing.
2. **Correct the superseded comment.** In [`packages/lib/tests/overlay/Notification.test.ts`](packages/lib/tests/overlay/Notification.test.ts), the header's `SCOPE` note says the entrance animation and the auto-dismiss "need a real-DOM (jsdom-event or browser) harness". Narrow that to the entrance animation alone and point the auto-dismiss half at `Notification.dismissTimer.test.ts`. Change nothing else in the file.
3. **Route the field and the four sites.** In [`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts), make exactly the five edits in `## Internal Structure`'s first block: add `TimerId` to the existing type import at `:20`, retype the field at `:145`, and change `:466`, `:478`, `:505` and `:571` to their `DOM.sink.` forms. Change nothing else.
4. Check: `grep -n 'setTimeout\|clearTimeout' packages/lib/src/typescript/lib/overlay/Notification.ts` — four matches, every one a `DOM.sink.` call.
5. Run the file. E1-E6 and E8-E10 all pass.
6. `npm run typecheck` and `npm test`, both from the worktree root. Both clean. Commit (code).

**Commit 2 — the destructor clear**

7. **Add E7, red first.** Append E7 from `## Expected Behaviour` to the new test file. Run the file: E7 fails.
8. **Clear the timer in `destructor()`.** Insert the block from `## Internal Structure` at the top of `Notification.destructor()` ([:712](packages/lib/src/typescript/lib/overlay/Notification.ts#L712)), above `this._showAnimation?.cancel();`.
9. Run the file: all of E1-E10 pass. Then `npm test` from the worktree root. Commit (code).

**Commit 3 — changelog**

10. [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) is currently empty apart from its preamble. Append a `## Fixed` heading and a `### Overlay` subheading under it — the section names [`0.10.0.md:814`](packages/lib/docs/reference/changelog/0.10.0.md#L814) and [`:1792`](packages/lib/docs/reference/changelog/0.10.0.md#L1792) use — then one entry, following the shape of the `Table` filter-row entry at [`0.10.0.md:1612-1620`](packages/lib/docs/reference/changelog/0.10.0.md#L1612):

   ```markdown
   ## Fixed

   ### Overlay

   - **`DOM.reset()` now cancels a `Notification`'s pending auto-dismiss, and
     disposing a toast cancels its own.** The toast's auto-dismiss timer used
     the bare global `setTimeout`, which `DOM.reset()` cannot reach, so a suite
     that showed a toast and then reset the DOM had the dismiss run afterwards
     and animate the toast out through handles the reset had discarded. The
     timer now goes through `DOM.sink`, like `AutoCompleteField`'s and the
     table filter row's, and `Notification`'s destructor clears a timer a
     dispose would otherwise have left armed. No consumer action is needed.
   ```

   Commit (documentation).

**Commit 4 — research record**

11. In [`plans/research/render-review-2026-09-15/01-phase2-status-pass.md:456-458`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L456), replace the **Open: `Notification.startTimer`** bullet with a settled one in the style the rest of that list uses: a bold "Fixed by `plans/notification-dismiss-timer-seam.md` (2026-09-29):" lead-in, the cause in one sentence, and the measured 51-of-51 figure from `## Findings` row 6. Change no other bullet. Commit (bookkeeping).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Create | `packages/lib/tests/overlay/Notification.dismissTimer.test.ts` |
| Modify | `packages/lib/tests/overlay/Notification.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

`Notification.test.ts` gets one change only, in step 2: a header comment claiming the auto-dismiss timer needs a real-DOM harness, which the new file disproves.

---

## Expected Behaviour

Every case is offline-testable; none needs a browser. The mutations the cases are graded against:

| Id | Mutation of a shipped line |
|---|---|
| M1 | `startTimer` ([:466](packages/lib/src/typescript/lib/overlay/Notification.ts#L466)) back to the bare `setTimeout` |
| M2 | `restartTimer` ([:505](packages/lib/src/typescript/lib/overlay/Notification.ts#L505)) back to the bare `setTimeout` |
| M3 | `pauseTimer` ([:478](packages/lib/src/typescript/lib/overlay/Notification.ts#L478)) back to the bare `clearTimeout` |
| M4 | `dismiss` ([:571](packages/lib/src/typescript/lib/overlay/Notification.ts#L571)) back to the bare `clearTimeout` |
| M5 | the new `destructor()` clear deleted |

E1-E8 are defect pins: each is red on `master` and red again under the mutation named. E9-E11 are regression guards — they pass on `master` too, and exist to catch a fix that cancels too much.

| # | Case | Assertion | Catches |
|---|---|---|---|
| E1 | `show('msg', 'info', 3000)` | `timerOps(sink, 0)` equals `[['setTimeout', 3000]]` | M1 |
| E2 | `show(…, 3000)`, then `Notification.pauseAll()`, then `Notification.resumeAll()` | `timerOps(sink, 0)` equals `[['setTimeout', 3000], ['clearTimeout', null], ['setTimeout', MIN_RESUMED_MS]]` | M2, M3 |
| E3 | `show(…, 3000)`, advance 1000 ms, then `timerControls(toast).pauseTimer()` and `.restartTimer(false)` | `timerOps(sink, 0)` equals `[['setTimeout', 3000], ['clearTimeout', null], ['setTimeout', 2000]]` | M2, M3 |
| E4 | `show(…, 3000)`, note `sink.writes.length` as `before`, then the toast's own `dismiss()` | `timerOps(sink, before)` contains exactly one `clearTimeout` entry | M4 |
| E5 | `show(…, 3000)`, spy on the toast's `dismiss`, `DOM.reset()`, advance 4000 ms | the spy was never called | M1 |
| E6 | `show(…, 3000)`, `pauseAll()`, `resumeAll()`, spy on `dismiss`, `DOM.reset()`, advance 9000 ms | the spy was never called | M2 |
| E7 | `show(…, 3000)`, spy on `dismiss`, `toast.dispose()`, advance 4000 ms | the spy was never called | M5 |
| E8 | 51 `show(msg)` calls at the 3000 ms default, a spy per toast, `DOM.reset()`, advance 10 000 ms | none of the 51 spies was called | M1, at the scale `NotificationHistory.test.ts`'s cap case reaches |
| E9 | `show('msg', 'info', 0)` | `timerOps(sink, 0)` is empty and `_dismissTimer` is `null` | guard: a persistent toast must still arm nothing |
| E10 | `show(…, 3000)`, advance 3000 ms, then advance 300 ms more | after the first advance the toast is still in the static stack; after the second it is gone | guard: the dismiss must still happen on time, and its own 240 ms animation fallback must still complete |
| E11 | the whole suite | `npm test` green with no `is not registered`, `Unhandled` or `Errors` line | guard: see `## Verification` |

E2's `8000` and E3's `2000` are exact, not approximate: `vi.useFakeTimers()` drives `Date.now()`, so the elapsed term in `pauseTimer`'s subtraction is exactly what the test advanced (`## Findings` row 2). E2 has no elapsed time, so its remainder is the full 3000 and `MIN_RESUMED_MS` clamps it to 8000; E3 advances 1000 first, so its remainder is 2000 and the unclamped path keeps it.

Two assertions are forbidden. Neither can pass, with the fix or without it.

- `_dismissTimer === null` after `DOM.reset()`. The sweep cancels the host timer and does not touch the owner's field, so the field still holds a dead id (`## Findings` row 4).
- `_dismissTimer === null` after a `restartTimer` that followed a reset. `restartTimer` early-returns on the non-`null` field, so nothing is re-armed and nothing is nulled (`## Findings` row 7).

---

## Verification

1. `npm run typecheck` from the worktree root — clean.
2. `npm test` from the worktree root — green. Run it **three times**; each run must report every test passing and no `Errors` line.
3. `grep -n 'setTimeout\|clearTimeout' packages/lib/src/typescript/lib/overlay/Notification.ts` — four matches, all `DOM.sink.` calls.
4. **Mutation check, one mutation at a time.** For each of M1-M5 in `## Expected Behaviour`: apply it, run the file (`npx vitest run tests/overlay/Notification.dismissTimer.test.ts` from `packages/lib`), confirm the cases its row names go red, then revert it. Five mutations, five reverts, and the file green again at the end. This is the step that proves the pins are not vacuous; do not skip it and do not substitute reasoning for it. Record the observed red set per mutation in the implementation notes.
5. `npm run lint` from the worktree root — no new findings. The library's `local/*` rules do not cover timers today, so this only confirms nothing else regressed.
6. `npm run docs:api` — the existing 14 warnings, and no new one. No public JSDoc changes here, so the count must be unchanged.
7. Nothing opened a window during any of the above.

`npm run build:lib`, the `packages/qa` suite and `docs:llms:check` are not needed: no public API, no manifest entry and no built artefact changes.

---

## Documentation Impact

- One `## Fixed` → `### Overlay` entry in [`changelog/next.md`](packages/lib/docs/reference/changelog/next.md) (step 10). `DOM.install` / `DOM.reset` are public test support ([dom-seams.md:27-35](packages/lib/docs/concepts/dom-seams.md#L27)), so a consumer's own suite sees this change.
- No change to [`docs/concepts/dom-seams.md`](packages/lib/docs/concepts/dom-seams.md). Its closing paragraph already states the rule this change follows — the sink offers timers "for the one case where a timer is not merely a timer: a deferred callback that will write to an element" — and naming each component that qualifies would be a list that rots.[^no-seam-doc]
- No change to [`docs/components/Notification.md`](packages/lib/docs/components/Notification.md) or [`llms.txt`](packages/lib/llms.txt). Every symbol touched is private; the public surface is identical.
- One clause of [`tests/overlay/Notification.test.ts`](packages/lib/tests/overlay/Notification.test.ts)'s header comment becomes false and is corrected (step 2).

---

## Potential Challenges

- **A dead id survives the sweep.** `clearAllTimeouts()` cancels the host timer but cannot null an owner's field, so `_dismissTimer` still holds an id after `DOM.reset()`. Every consequence is confined to a reset environment: `pauseTimer` and `dismiss` pass the dead id to `DOM.sink.clearTimeout`, which ignores an unknown id, and `restartTimer` declines to re-arm. Accepted, and the two assertions it makes impossible are listed in `## Expected Behaviour`.
- **The new file's teardown must not dispose its toasts.** [`Notification.resize.test.ts:82-90`](packages/lib/tests/overlay/Notification.resize.test.ts#L82) drains the static stack by disposing every live toast, which is right for that file because its toasts are persistent and their DOM is intact. Here most cases end with the DOM reset out from under a live toast, and disposing one would restack the survivors through released handles. Blank the static fields instead, as [`NotificationHistory.test.ts:25-28`](packages/lib/tests/overlay/NotificationHistory.test.ts#L25) does.
- **The spy has to be installed after `show()` and before the reset.** `show()` creates the toast, so there is nothing to spy on before it; and the spy is what keeps the red run from throwing, so it must be in place before the clock advances.
- **E8 leaves 51 entries in the static stack.** The `beforeEach` blanking handles it. Do not add a teardown that walks the stack.
- **`vi.restoreAllMocks()` before `vi.useRealTimers()`.** Both orderings work, but [`Animation.test.ts:67-71`](packages/lib/tests/core/Animation.test.ts#L67) sets the precedent: restore, real timers, reset. Follow it so this file and `Animation.test.ts`, the library's other fake-clock suite, read the same.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/Notification.ts`](packages/lib/src/typescript/lib/overlay/Notification.ts) — the whole change. `startTimer` / `pauseTimer` / `restartTimer` at `:463-506`, `dismiss` at `:563`, `destructor` at `:712`.
- [`packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts) — the precedent: `TimerId | null` field at `:136`, `DOM.sink.setTimeout` at `:518`, and the `destructor()` clear at `:740`.
- [`packages/lib/src/typescript/lib/component/table/Header.ts:297`](packages/lib/src/typescript/lib/component/table/Header.ts#L297) and `:1404` — the same fix, as `test-suite-health` shipped it.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — the `TimerId` alias at `:343`, the sink's timer contract at `:1080-1094`, and `reset()` at `:3327`.
- [`packages/lib/tests/dom/TestDOM.ts:865-891`](packages/lib/tests/dom/TestDOM.ts#L865) — `RecordingDOMSink`'s timers. It records each op and delegates to the global, which is what makes both pin shapes work offline.
- [`packages/lib/tests/setup/node-setup.ts:57-61`](packages/lib/tests/setup/node-setup.ts#L57) — the global `afterEach(DOM.reset)` that turns the fix into a suite-wide safety net.
- [`packages/lib/tests/overlay/Notification.test.ts:37-46`](packages/lib/tests/overlay/Notification.test.ts#L37) — the `liveToast()` helper and the private-static access pattern the new file reuses.
- [`packages/lib/tests/overlay/Notification.resize.test.ts:1-15`](packages/lib/tests/overlay/Notification.resize.test.ts#L1) and [`Notification.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Notification.styleRuleDisposal.test.ts) — the concern-scoped sibling-file naming and header-comment style the new file follows.
- [`packages/lib/tests/component/table/ColumnFilterRow.test.ts:476-503`](packages/lib/tests/component/table/ColumnFilterRow.test.ts#L476) — the two pins this plan's assertion shapes come from.
- [`plans/implemented/animation-timer-cancellation.md`](plans/implemented/animation-timer-cancellation.md) and [`plans/implemented/test-suite-health.md`](plans/implemented/test-suite-health.md) — the mechanism and the pin, respectively.

---

## Non-Goals

- **Routing the eleven remaining bare timers through the seam.** Each needs its own judgement about whether its callback reaches an element, and several sit in drag paths no offline test drives. They are inventoried in the addendum below and belong to the lint-rule plan named there.
- **Adding a lint rule in this plan.** A rule plus a baseline plus a rule test is a bigger change than the one defect it would police here, and it would land with eleven baseline entries and no fixes. It is the right follow-up, not part of this one.
- **Clearing `Notification`'s static state on `DOM.reset()`.** `activeNotifications`, `history`, `hoverCount` and `modalCount` all outlive a reset, and `restack()` writes `setX`/`setY` to whatever is still in the list. That is a real hazard, already worked around in three test files, but it is a static-lifetime defect rather than a timer defect, and fixing it means deciding whether the library may reach into a class's statics from `DOM.reset()` at all. Recorded, not changed.
- **`Notification.showDetail`'s `dialog.show().then(...)`.** It is uncancelled async, but the promise always settles: [`Dialog.destructor:1368-1371`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1368) resolves it on every teardown path, so the modal hold is always released. Its one residual effect — a `resumeAll()` landing after a `DOM.reset()` and re-arming the stack's timers — is exactly what this plan makes cancellable.
- **A timer-leak assertion in test teardown.** Rejected in `animation-timer-cancellation`'s own `## Non-Goals` for the same reason it would fail here: tests legitimately end with a toast nobody dismissed.
- **Any change to the dismiss animation, the entrance animation, or `Animation` itself.** Already cancelled from `destructor()` by `animation-timer-cancellation`.

---

## Addendum: The bare timers that remain

Every `setTimeout` arm site in `packages/lib/src/typescript/lib` that does not route through the seam, after this plan lands. Demo panels (`src/typescript/*Panel.ts`) and `perf/Benchmark.ts` are excluded — neither ships.

| Site | Delay | Does the callback reach an element? | Cleared in a teardown hook? |
|---|---|---|---|
| [`overlay/Tooltip.ts:721`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L721) — `Tooltip.showTimer` | hover delay | Yes — `Tooltip.show()` mounts and positions the tooltip, and the callback reads `component.getElement()` first | Cancelled by the arming component's `detach`, not by a reset |
| [`overlay/Tooltip.ts:1027`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L1027) — `att.showTimer` | hover delay | Yes — same `Tooltip.show()` | Cleared on `mouseout` only |
| [`component/container/StatusBar.ts:260`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L260) — `_messageTimer` | caller's | Yes — `_messageText.setText(...)` | Yes, `destructor` at `:357` |
| [`component/input/AbstractCalendarDropdown.ts:1548`](packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L1548) — `_yearTypeTimer` | idle delay | Yes — `resetYearTypeBuffer()` repaints the year cells | Cleared on the next keystroke |
| [`component/container/MenuItem.ts:319`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L319) — `_submenuTimer` | 150 ms | Indirectly — `_onOpenSubmenu(this)` builds and positions a submenu | Yes, `destructor` at `:540` |
| [`component/container/TabBar.ts:3214`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3214) — `_springRaiseTimer` | dwell | Indirectly, and only while a drag is live | Cleared on leave/drop |
| [`layout/DockRegion.ts:172`](packages/lib/src/typescript/lib/layout/DockRegion.ts#L172) — `_raiseTimer` | dwell | Indirectly, and only while a drag is live | Cleared on leave/drop/teardown |
| [`core/AutoRepeat.ts:91`](packages/lib/src/typescript/lib/core/AutoRepeat.ts#L91) — `_handle` | decaying | Depends on the consumer's `_onTick` | Owner-driven stop |
| [`component/table/cell/Header.ts:677`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L677) | 0 ms | No — it assigns one boolean field | Not cleared, and does not need to be |
| [`data/StoreWorkerClient.ts:130`](packages/lib/src/typescript/lib/data/StoreWorkerClient.ts#L130) and `:197` — `silenceTimer` | watchdog | No — a worker-silence watchdog, no DOM | Cleared on each message |

Ten rows, eleven arm sites: `Tooltip` and `StoreWorkerClient` contribute two each. Three of the eleven are already provably fine — the table header cell's 0 ms flag reset and the store worker's two watchdog arms touch no element, which is the documented reason a timer may stay off the seam. The other eight qualify for the seam by the rule [`dom-seams.md`](packages/lib/docs/concepts/dom-seams.md) already states, and the two `Tooltip` sites are the strongest candidates: a tooltip's show callback resolves an element handle after a delay measured in hundreds of milliseconds, and neither site has a teardown hook a `DOM.reset()` could stand in for.

That is the finding worth acting on. Three separate bug hunts have now each found one instance of this defect (`Animation`, `AutoCompleteField` / `TableHeader`, `Notification`), and each was found by chasing a symptom rather than by review. The convention is not holding, so the follow-up should make the seam enforced: a `local/no-raw-timer` ESLint rule over `src/typescript/lib/**`, with a `scripts/eslint/no-raw-timer.baseline.json` listing the sites above and a `scripts/eslint/no-raw-timer.test.mjs` beside its five siblings. The baseline machinery already exists — [`scripts/eslint/no-raw-dom.baseline.json`](packages/lib/scripts/eslint/no-raw-dom.baseline.json) and [`update-baseline.mjs`](packages/lib/scripts/eslint/update-baseline.mjs), wired to `npm run lint:baseline` — so the rule ships allow-listing today's sites and shrinks as each is converted or exempted with a comment. `local/no-raw-dom` deliberately excludes timers today ([`dom-seams.md`](packages/lib/docs/concepts/dom-seams.md), closing section), so this is a new rule rather than an extension of that one.

---

## Notes

[^dormant]: The suite is green today with the bug present, which is what makes this plan unusually exposed to a verification that cannot fail. An assertion that a toast dismisses after its duration passes with or without the fix, and so does an assertion that the suite is green. The nine-plan batch before this one shipped twelve such assertions. The defence here is the mutation table in `## Expected Behaviour` plus `## Verification` step 4, which applies each mutation and requires the named cases to go red — and `## Findings` rows 3, 5 and 6, which are the same check run ahead of time on `master`, where every pin is already red.

[^why-seam]: `DOM.reset()` is documented public test support that promises to cancel deferred callbacks ([dom-seams.md:27-35](packages/lib/docs/concepts/dom-seams.md#L27)), and it cannot see a timer armed on the global. `Notification.dismiss()` clears the timer on the normal path, so the gap is never about a toast dismissing itself; it is about a toast abandoned mid-countdown. Rejected alternative: leave the arm sites alone and have `dismiss()` check whether its handle is still live before writing. That reintroduces the silent-no-op-on-use-after-free design `animation-timer-cancellation` rejected in its own notes, and it would only paper over the symptom inside `Notification` while `DOM.reset()` stayed unable to reach the timer.

[^destructor-gap]: Measured: showing a toast at the 3 s default, then calling `dispose()`, then advancing the clock, invokes `dismiss()` once. `dismiss()` then reads `getElement()`, which the destructor has already cleared, so it re-enters `finishDismiss()` and re-runs `restack()` from a corpse. Under the production seam in a Node suite the `getElementById` read throws outright. Every sibling with a timer clears it in its teardown hook — `AutoCompleteField` at `:740`, `StatusBar` at `:357`, `MenuItem` at `:540`, and `TableHeader` — and `Notification` is the one that does not. The seam routing alone does not close this: it makes a reset able to sweep the timer, but a dispose with no reset after it leaves the timer live.

[^keep-date-now]: Three reasons, in order of weight. First, the arithmetic is already deterministic offline: a plain `vi.useFakeTimers()` fakes `Date` as well as the timers, so `Date.now()` moves exactly as far as a test advances the clock — which is why E2's 8000 and E3's 2000 are exact values rather than tolerances. Second, `Date.now()` is not DOM. The seam's contract is that every DOM write is a `DOM.sink` call and every DOM read a `DOM.source` call over opaque handles; a wall clock is neither, and the same paragraph of `dom-seams.md` that carves timers out of `local/no-raw-dom` carves out `performance.now()` beside them. The sink carries `setTimeout` only because a deferred callback can write to an element — reading the clock cannot. Third, when a test does need to drive a library clock read directly, [`List.test.ts:340-348`](packages/lib/tests/component/list/List.test.ts#L340) establishes `vi.spyOn(Date, 'now')` as the way, and [`DateField.test.ts:289`](packages/lib/tests/component/input/DateField.test.ts#L289) establishes `vi.useFakeTimers({ toFake: ["Date"] })` for freezing it alone. A seam clock would add a third mechanism and a new sink member for no gain.

[^rest-of-notification]: Checked, not assumed. The file's only other timer references are the field declaration and the four call sites this plan changes. `animateIn` and `dismiss` use `Animation.play`, whose fallback timers `animation-timer-cancellation` already put on the seam and whose handles `Notification.destructor` already cancels. `scheduleLayout()` defers through the framework's own per-frame coalescer, which routes through `DOM.sink.requestAnimationFrame` and which `Component.destructor` drops the component from. `restack`, `onViewportResize`, `installResizeListener` and `uninstallResizeListener` are synchronous. `pauseAll`, `resumeAll`, `acquireHoverHold`, `releaseHoverHold`, `pauseAllTimers` and `resumeAllTimers` are counter arithmetic plus a loop over the static stack; the only async they can reach is a fresh `restartTimer`, which this plan puts on the seam. That leaves `showDetail`'s promise, handled in `## Non-Goals`.

[^pin-shapes]: `test-suite-health`'s two pins were checked rather than trusted, because this plan copies their shape. [`ColumnFilterRow.test.ts:476`](packages/lib/tests/component/table/ColumnFilterRow.test.ts#L476) asserts the recorded `setTimeout` op and its 200 ms delay; reverting the arm site removes the entry entirely, so the assertion compares `[]` against `[200]` and is red by construction. [`:492`](packages/lib/tests/component/table/ColumnFilterRow.test.ts#L492) types into a filter cell, resets the DOM, advances the clock and asserts the store filter is still `null`; reverting the arm site lets the debounce fire, and [`AbstractStore.setFilter:1573`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1573) writes `_activeFilters` synchronously while [`getFilter:1625`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1625) reads it synchronously, so the assertion fails on the next line rather than swallowing the error. That matches what the plan itself recorded observing in its step 1. Neither pin is vacuous, so both shapes carry over: E1-E4 are the first, E5-E8 the second. The one adaptation is the `mockImplementation(() => {})` on the dismiss spy — the table's version can let the debounce call through because the store write is observable state, whereas a toast's dismiss has no observable state of its own and would throw if allowed to run.

[^third-instance]: The survey behind the addendum, and the reason it stops at a recommendation instead of acting: eleven sites is too many to convert blind in a plan whose subject is one toast, and eight of them qualify for the seam on the same rule `Notification` does. Converting them one plan at a time is what produced three separate bug hunts for one defect class, so the follow-up's job is the rule, not the conversions. The addendum names the rule, the baseline file and the rule test, all three modelled on `local/no-raw-dom`'s existing machinery.

[^no-seam-doc]: `test-suite-health` made the same call for `TableHeader` and wrote it down: the rule sentence in `dom-seams.md` already covers any timer whose callback writes to an element, so a new instance of that rule is not a doc change. The alternative — appending `Notification` to the sentence that names `Animation` — would produce a list needing revision every time another site converts, and the addendum above says eight more are candidates.
