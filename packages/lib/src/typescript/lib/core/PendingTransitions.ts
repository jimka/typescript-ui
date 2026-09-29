// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal registry mapping a live element `Handle` to the cancel
// functions of the `Animation.play` transitions and `Animation.afterTransition`
// waits still running against it. `Component.destructor()` consults this
// immediately before it releases its handles, so a deferred write queued by
// `play`'s two-frame entrance dance — or the `transition: null` reset its
// completion performs, or the `transitionend` removal an abandoned
// `afterTransition` wait still owes — never lands on a handle already returned
// to the pool. It also answers, for a transition about to finish, whether a
// later one on the same element is still running through the `transition` rule
// it is about to clear — the per-handle set is insertion-ordered, so "another
// transition started after this one" is a question the registry already holds
// the answer to. Not exported from `core/index.ts`:
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
 * Returns whether another transition has been registered against `handle`
 * since `cancel` was — i.e. whether the transition `cancel` belongs to has
 * been superseded by a later one on the same element.
 *
 * @param handle - The element handle the transition is writing to.
 * @param cancel - The transition's own cancel function.
 *
 * @returns `true` when a transition registered after this one is still live.
 */
export function isSupersededTransition(handle: Handle, cancel: () => void): boolean {
    const cancels = running.get(handle);

    if (!cancels) {
        return false;
    }

    let found = false;

    for (const registered of cancels) {
        if (found) {
            return true;
        }

        if (registered === cancel) {
            found = true;
        }
    }

    return false;
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
