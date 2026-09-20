// @vitest-environment jsdom
//
// The store-view wait. A store of 1,000 records or more builds its view on a
// worker, so `loadData` leaves the view empty and the store fires `load` only
// once the worker answers; a panel that reads its store, selects a row or
// looks up a cell before then reads an empty view.
//
// jsdom has no worker, so nothing here can reproduce that timing: under jsdom
// every store builds its view synchronously, and mounting a panel proves
// nothing about the worker path. These cases pin the contract instead.
//
// What they prove: `awaitStoreView` resolves only once the store reports
// records, waits frames afterwards for the rows to render, stops listening
// either way, and fails with the panel's name when no `load` ever arrives;
// and every store-backed panel awaits it before it touches its store or the
// tree, so an empty view holds `afterMount` open instead of being measured.
//
// What they do not prove: that the worker path itself works. Only a run in
// the engine, where `StoreWorkerClient` has a worker, exercises it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { awaitStoreView } from '../src/builders/store.js';
import type { ViewedStore } from '../src/builders/store.js';
import type { HarnessTools } from '../src/harness/types.js';
import { loadPanel } from '../src/panels.js';

/** The panel a case names in its errors. */
const LABEL = 'table-rows';

/** Longer than any cap the wait sets, so the fake clock always reaches the timeout. */
const PAST_THE_CAP_MS = 60_000;

/** The scale the panels are built at: small enough to be quick, as the mount smoke uses. */
const SMOKE_SCALE = 3;

/** Every panel whose root is backed by a store, and so reads a view the worker may not have built yet. */
const STORE_PANELS = ['table-rows', 'treetable-rows', 'list-items', 'chart-dashboard'];

afterEach(() => {
    vi.useRealTimers();
});

/**
 * A store whose view is filled by hand.
 *
 * @returns The store, `fill(count)` to set the view's size and fire `load`, and how many listeners it still holds.
 */
function fakeStore(): { store: ViewedStore; fill(count: number): void; listenerCount(): number } {
    const listeners = new Set<() => void>();
    let count = 0;

    const store: ViewedStore = {
        getCount: (): number => count,
        on: (_event: 'load', listener: () => void): unknown => listeners.add(listener),
        off: (_event: 'load', listener: () => void): unknown => listeners.delete(listener),
    };

    return {
        store,
        fill: (records: number): void => {
            count = records;

            for (const listener of [...listeners]) {
                listener();
            }
        },
        listenerCount: (): number => listeners.size,
    };
}

/**
 * Harness tools with only what the wait and the panels use. `waitFrames`
 * records the frames it was asked for and stays pending until `release` is
 * called, so a test can tell a caller that awaits it from one that does not;
 * `elementOf` answers as the real one does for a component that was never
 * mounted.
 *
 * @returns The tools, the frames asked for, and `release`, which settles every held wait.
 */
function heldTools(): { tools: HarnessTools; frames: number[]; release(): void } {
    const frames: number[] = [];
    const held: Array<() => void> = [];

    const tools = {
        waitFrames: (count: number): Promise<void> => {
            frames.push(count);

            return new Promise<void>((resolve) => held.push(resolve));
        },
        elementOf: (): HTMLElement | null => null,
    };

    return {
        tools: tools as unknown as HarnessTools,
        frames,
        release: (): void => {
            for (const resolve of held.splice(0)) {
                resolve();
            }
        },
    };
}

/**
 * Watches a promise without holding up the test, and without leaving a
 * rejection unhandled.
 *
 * @param promise - The promise to watch.
 * @returns Whether it has settled yet.
 */
function watch(promise: Promise<unknown>): () => boolean {
    let settled = false;

    void promise.then(() => {
        settled = true;
    }, () => {
        settled = true;
    });

    return (): boolean => settled;
}

/**
 * Lets every queued microtask and macrotask run, so a promise that can settle
 * has settled by the time it returns.
 */
async function flush(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('P12 awaitStoreView', () => {
    it('waits for the rows to render when the view is already built', async () => {
        const { store, fill, listenerCount } = fakeStore();
        const { tools, frames, release } = heldTools();

        fill(3);

        const settled = watch(awaitStoreView(tools, store, LABEL));

        await flush();
        // The view is there, so nothing was listened for — but the frames the
        // rows need to render are still waited for.
        expect(listenerCount()).toBe(0);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toBeGreaterThan(0);
        expect(settled()).toBe(false);

        release();
        await flush();

        expect(settled()).toBe(true);
    });

    it('holds until a load fills the view, then waits for the rows', async () => {
        const { store, fill, listenerCount } = fakeStore();
        const { tools, frames, release } = heldTools();
        const settled = watch(awaitStoreView(tools, store, LABEL));

        await flush();
        expect(listenerCount()).toBe(1);
        expect(frames).toEqual([]);
        expect(settled()).toBe(false);

        fill(2600);
        await flush();
        // The view arrived, so the listener is gone and the render wait has begun.
        expect(listenerCount()).toBe(0);
        expect(frames).toHaveLength(1);
        expect(settled()).toBe(false);

        release();
        await flush();

        expect(settled()).toBe(true);
    });

    it('ignores a load that leaves the view empty', async () => {
        const { store, fill, listenerCount } = fakeStore();
        const { tools, frames } = heldTools();
        const settled = watch(awaitStoreView(tools, store, LABEL));

        fill(0);
        await flush();

        expect(settled()).toBe(false);
        expect(frames).toEqual([]);
        expect(listenerCount()).toBe(1);
    });

    it('fails with the panel\'s name when no load arrives', async () => {
        vi.useFakeTimers();

        const { store, listenerCount } = fakeStore();
        const { tools } = heldTools();
        const waiting = awaitStoreView(tools, store, LABEL);
        const failed = expect(waiting).rejects.toThrow(`${LABEL}: the store's view is still empty`);

        await vi.advanceTimersByTimeAsync(PAST_THE_CAP_MS);
        await failed;

        expect(listenerCount()).toBe(0);
    });
});

describe('P13 store-backed panels await the view', () => {
    it.each(STORE_PANELS)('%s awaits the store view before it reads its store or the tree', async (id) => {
        const module = await loadPanel(id);
        const build = module!.build(SMOKE_SCALE, new URLSearchParams());
        const { tools, frames, release } = heldTools();
        const mounting = build.afterMount!(tools) as Promise<Record<string, unknown>>;
        const settled = watch(mounting);

        await flush();
        // Held by the wait: nothing was mounted, so had `afterMount` gone
        // straight to its element lookups it would have settled by now.
        expect(frames.length).toBeGreaterThan(0);
        expect(settled()).toBe(false);

        release();

        // Past the wait, the lookups run and fail on the unmounted tree —
        // which is what shows the wait, not a hang, is what held it.
        await expect(mounting).rejects.toThrow(`${id}: no element matches`);
    });
});
