import { forceGc } from './forceGc.mjs';

// How many collect-then-wait rounds to try before reporting that nothing
// happened. A `FinalizationRegistry` callback runs as a task some time after
// the collection that freed its target, not inside it; one or two rounds is
// the norm, and twenty gives a busy worker room without letting a genuinely
// pinned object stall a test for long.
const MAX_COLLECT_ROUNDS = 20;

// How long each round waits after collecting, in milliseconds, for the
// engine to run any finalization callbacks the collection queued.
const FINALIZATION_WAIT_MS = 10;

/**
 * Collects garbage and waits, round by round, until `done` reports true or
 * the rounds run out.
 *
 * @param done - Checked before each round; ends the wait once it returns `true`.
 */
export async function collectUntil(done: () => boolean): Promise<void> {
    for (let round = 0; round < MAX_COLLECT_ROUNDS && !done(); round++) {
        forceGc();
        await new Promise((resolve) => setTimeout(resolve, FINALIZATION_WAIT_MS));
    }
}

/**
 * Whether the object `make` returns can be garbage-collected once `between`
 * has run — the reachability half of a "this registry does not pin it" case.
 *
 * Watched through a `FinalizationRegistry` rather than a `WeakRef`: creating
 * or dereferencing a `WeakRef` keeps its target alive until the current job
 * ends, so a `WeakRef` probe can report a free object as reachable.
 *
 * @param make - Builds the object; called in a frame of its own, so no local
 *   of the caller keeps it reachable.
 * @param between - Runs after the object is built and before collection, e.g.
 *   the sink swap under test.
 * @returns `true` once the object has been collected, `false` if it survived
 *   every round.
 */
export async function collectedAfter(make: () => object, between: () => void): Promise<boolean> {
    let collected = false;
    const registry = new FinalizationRegistry(() => { collected = true; });

    registry.register(make(), 'target');
    between();

    await collectUntil(() => collected);

    return collected;
}
