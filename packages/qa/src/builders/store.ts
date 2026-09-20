// Waiting for a store-backed panel's data. A store of 1,000 records or more
// builds its view on a worker, and `loadData` then defers its `load` event
// until the worker answers, so right after `build()` the view is empty and
// the component over it has no rows. A panel that reads its store, selects a
// record or looks up a cell must wait here first — in `afterMount`, which
// `mountPanel` awaits.

import type { HarnessTools } from '../harness/types.js';

/** What the wait needs of a store: the size of its view, and the `load` signal that says the view is built. */
export interface ViewedStore {
    getCount(): number;
    on(event: 'load', listener: () => void): unknown;
    off(event: 'load', listener: () => void): unknown;
}

/**
 * How long to wait for the view. The wait ends as soon as the store fires
 * `load`, so this only bounds a store that never answers; ten seconds is
 * `mount.ts`'s paint cap, for the same reason — a cold worker module on the
 * first run of a page.
 */
const VIEW_TIMEOUT_MS = 10_000;

/**
 * Frames waited after the view arrives, so the rows exist before a panel
 * selects one or looks one up: one for the refresh the store's `load`
 * schedules, one for the layout flush that refresh schedules, one spare.
 * `drivers.ts`' `SETTLE_FRAMES` counts the same three.
 */
const RENDER_FRAMES = 3;

/**
 * Resolves on the first `load` that leaves the view non-empty. A `load` that
 * leaves it empty is ignored, so a store that reloads keeps the wait open.
 *
 * @param store - The store to listen to.
 * @param label - Names the panel in the error.
 * @returns A promise that resolves once the view holds records.
 * @throws Error - `<label>: the store's view is still empty …` when no such `load` arrives in time.
 */
function viewLoaded(store: ViewedStore, label: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        /** Stops listening and cancels the timeout, whichever of the two settled the promise. */
        function stopWaiting(): void {
            clearTimeout(timer);
            store.off('load', onViewLoad);
        }

        /** Settles the wait once the view holds records. */
        function onViewLoad(): void {
            if (store.getCount() === 0) {
                return;
            }

            stopWaiting();
            resolve();
        }

        const timer = setTimeout(() => {
            stopWaiting();
            reject(new Error(`${label}: the store's view is still empty ${VIEW_TIMEOUT_MS}ms after loadData; the store never fired load`));
        }, VIEW_TIMEOUT_MS);

        store.on('load', onViewLoad);
    });
}

/**
 * Waits until `store`'s view holds records and the component over it has had
 * frames to render them.
 *
 * An empty view means the worker has not answered yet: every panel loads at
 * least one record, so a store that reports none is a store still building
 * its view.
 *
 * @param tools - The harness tools, for `waitFrames`.
 * @param store - The store the panel built.
 * @param label - Names the panel in the error.
 * @throws Error - `<label>: the store's view is still empty …` when the view never arrives, rather than hanging until the run's own timeout.
 */
export async function awaitStoreView(tools: HarnessTools, store: ViewedStore, label: string): Promise<void> {
    if (store.getCount() === 0) {
        await viewLoaded(store, label);
    }

    await tools.waitFrames(RENDER_FRAMES);
}
