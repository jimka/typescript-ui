// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal registry mapping a live element `Handle` to the cancel
// functions of the `Animation.play` transitions still running against it.
// `Component.destructor()` consults this immediately before it releases its
// handles, so a deferred write queued by `play`'s two-frame entrance dance —
// or the `transition: null` reset its completion performs — never lands on a
// handle already returned to the pool. Not exported from `core/index.ts`:
// this module exists purely to let `Animation.ts` and `Component.ts` share
// this bookkeeping without importing each other, mirroring
// `core/ClassStyleRules.ts` and `core/ComponentDefaults.ts`.

import type { Handle } from "~/core/DOM.js";

/** Cancel functions of the transitions still running against each handle. */
const running: Map<Handle, Set<() => void>> = new Map();

/**
 * Records a transition's cancel function against the handle it animates.
 *
 * @param handle - The element handle the transition is writing to.
 * @param cancel - The transition's own cancel function.
 */
export function registerTransition(handle: Handle, cancel: () => void): void {
    let cancels = running.get(handle);

    if (!cancels) {
        cancels = new Set();
        running.set(handle, cancels);
    }

    cancels.add(cancel);
}

/**
 * Forgets a transition's cancel function, called once it finishes or is
 * cancelled through its own handle so completed work never accumulates.
 *
 * @param handle - The element handle the transition was writing to.
 * @param cancel - The transition's own cancel function.
 */
export function unregisterTransition(handle: Handle, cancel: () => void): void {
    const cancels = running.get(handle);

    if (!cancels) {
        return;
    }

    cancels.delete(cancel);

    if (cancels.size === 0) {
        running.delete(handle);
    }
}

/**
 * Invokes and forgets every cancel function registered for `handle`. Called
 * by `Component.destructor()` immediately before the handle is released.
 *
 * @param handle - The element handle about to be released.
 */
export function cancelTransitions(handle: Handle): void {
    const cancels = running.get(handle);

    if (!cancels) {
        return;
    }

    running.delete(handle);

    for (const cancel of cancels) {
        cancel();
    }
}
