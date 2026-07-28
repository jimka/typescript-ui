// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal state for the one-shot startup font gate. The coalesced
// layout queue in `Component.ts` holds its very first flush while this gate is
// held, so no text is committed at a size measured against the browser's
// fallback font; `Theme.ts` arms the gate when it starts the web-font load and
// releases it when the font set reports that load settled. Not exported from
// `core/index.ts`: this module exists purely to let `Theme.ts`, `Component.ts`
// and the virtualised row views share this bookkeeping without importing each
// other, mirroring
// `core/PendingTransitions.ts`, `core/ClassStyleRules.ts` and
// `core/ComponentDefaults.ts`.

import { DOM } from "~/core/DOM.js";
import type { TimerId } from "~/core/DOM.js";

/**
 * How long the gate may hold the first flush once the main thread is free.
 *
 * @remarks Measured against real activation cost: the framework's two inline
 * font subsets activate in ~1.4 ms and ~0 ms on an idle main thread, so this is
 * over an order of magnitude of headroom. It cannot usefully be much longer —
 * on the failure path this is exactly how long an unlaid-out tree stays on
 * screen, and 50 ms keeps that to roughly three frames.
 */
export const FIRST_LAYOUT_HOLD_MS = 50;

/** Whether the layout queue must still defer its first flush. */
let _held: boolean = false;

/** The bounded release deadline, once a held frame has started it. */
let _deadline: TimerId | null = null;

/**
 * Arms the gate, so the layout queue defers its first flush.
 *
 * @remarks Called once per process, from the theme manager's font set-up, and
 * only when an asynchronous font load actually started — arming with nothing
 * able to release it would leave the gate shut until its deadline.
 */
export function holdFirstLayout(): void {
    _held = true;
}

/**
 * Whether the layout queue must defer its flush and retry on a later frame.
 *
 * @returns `true` while the gate is held.
 */
export function isFirstLayoutHeld(): boolean {
    return _held;
}

/**
 * Starts the bounded release deadline. A no-op once the deadline is running.
 *
 * @remarks Called by the first frame that finds the gate held, not by
 * {@link holdFirstLayout}. An animation frame cannot run until the synchronous
 * startup work has finished, so the first held frame is by construction the
 * first moment the main thread is free — anchoring the deadline there makes it
 * a budget of *available* time. A timer started at arming would instead expire
 * unnoticed during startup and fire the moment the thread yields, racing the
 * font activation it exists to outlast.
 */
export function startFirstLayoutDeadline(): void {
    if (_deadline !== null) {
        return;
    }

    _deadline = DOM.sink.setTimeout(releaseFirstLayout, FIRST_LAYOUT_HOLD_MS);
}

/**
 * Opens the gate and cancels any pending deadline. Idempotent.
 *
 * @remarks Does not kick a flush: while the queue is non-empty a retry frame is
 * always already pending, and when the queue is empty there is nothing to
 * flush.
 */
export function releaseFirstLayout(): void {
    _held = false;

    if (_deadline !== null) {
        DOM.sink.clearTimeout(_deadline);
        _deadline = null;
    }
}
