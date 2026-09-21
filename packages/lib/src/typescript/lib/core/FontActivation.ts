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
