// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Main-thread client for the StoreWorker. Lazily constructs a single Worker
// instance shared across all stores; routes requests by requestId so concurrent
// stores don't crosstalk. The worker's source travels inside this chunk, so
// nothing is fetched to start it.
//
// `isAvailable()` is false whenever there is no live worker to offload to, and
// the AbstractStore caller reads it before dispatching and does the work
// itself. Two different things make it false. A worker that cannot be
// constructed at all — no `Worker` in a test environment or server-side, a
// Content-Security-Policy that refuses a `blob:` worker — simply leaves the
// client without one; the next call tries to construct it again. A worker that
// was constructed and then proved dead — its script failed to run, a reply
// could not be decoded, or it answered nothing for the whole deadline while a
// reply was owed — is *retired*: terminated, every outstanding request
// rejected, and never rebuilt. That deadline grows with the dataset, so a long
// sort of a very large store is given room a small store's request is not.

import { FilterDescriptor } from "~/data/FilterDescriptor.js";
import type { FieldType } from "~/data/Field.js";

// Vite-specific worker import. The `?worker&inline` suffix tells Vite to bundle
// the module as a Web Worker entry and embed its source in this chunk, started
// from a `blob:` URL at runtime — a published library cannot ask the consuming
// app to serve a file only the library ships. The default export is the Worker
// constructor.
// @ts-ignore — Vite resolves this at build time; tsc on its own can't.
import StoreWorkerCtor from "~/data/StoreWorker.js?worker&inline";

type Direction = "asc" | "desc";

type Response = { requestId: number; indices?: number[]; error?: string };

interface Pending {
    resolve: (indices: number[] | undefined) => void;
    reject: (err: Error) => void;
    /** Records in the snapshot this request works over; sizes the silence deadline. */
    records: number;
}

/**
 * The deadline's fixed part: how long the worker may say nothing before the
 * dataset-sized allowance is added. It covers worker startup and the queue
 * ahead of a request, not the work itself, and is far more than a `blob:`
 * worker needs to boot and take its first snapshot.
 */
const SILENCE_BASE_MS = 5000;

/**
 * The deadline's per-record part, per 1,000 records of the largest snapshot
 * outstanding. Twenty milliseconds per thousand is ten times the slowest thing
 * the worker's own code can do to a record — a locale-aware string sort
 * measured at 1.7 µs per record over a million of them — which leaves at least
 * a tenfold margin at every store size, to absorb an engine slower than the one
 * it was measured on.
 */
const SILENCE_MS_PER_1000_RECORDS = 20;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending: Map<number, Pending> = new Map();

// Set once the worker is proven dead; never cleared, so a retired worker is
// never rebuilt.
let workerRetired = false;

// Armed whenever a reply is owed, restarted by every reply. Null when nothing
// is outstanding.
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
// How long the armed timer will run, and how much silence was already counted
// before it was armed. Their sum is how long the worker has said nothing.
let armedFor = 0;
let quietSoFar = 0;
// Records last snapshotted per store, so a sortFilter can be sized by the
// snapshot it runs over. Never pruned; one number per store.
const snapshotSizes: Map<string, number> = new Map();

/**
 * Cancels the silence clock, if one is armed, and forgets what it had counted.
 * Called by every reply — which restarts it — and by retirement, so a dead
 * worker leaves no timer behind.
 */
function clearSilenceTimer(): void {
    if (silenceTimer !== null) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }

    armedFor   = 0;
    quietSoFar = 0;
}

/**
 * The deadline the outstanding set currently warrants, sized by its largest
 * snapshot.
 *
 * @returns How long the worker may stay silent while it owes these replies.
 */
function silenceDeadlineMs(): number {
    let worst = 0;

    for (const p of pending.values()) {
        if (p.records > worst) {
            worst = p.records;
        }
    }

    return SILENCE_BASE_MS + Math.ceil(worst / 1000) * SILENCE_MS_PER_1000_RECORDS;
}

/**
 * Starts the silence clock when a reply is owed and none is running. A dispatch
 * that joins a stretch of silence already being timed changes nothing here: if
 * it warrants a longer deadline than the one armed, it is given the difference
 * when that one expires — a page that keeps dispatching would otherwise hold a
 * wedged worker's clock open forever.
 */
function armSilenceTimer(): void {
    if (silenceTimer !== null || pending.size === 0) {
        return;
    }

    quietSoFar   = 0;
    armedFor     = silenceDeadlineMs();
    silenceTimer = setTimeout(handleSilenceTimeout, armedFor);
}

/**
 * Retires the worker for the life of the page: terminates it, rejects every
 * outstanding request, and makes every later `isAvailable()` false so no
 * caller pays a round trip that cannot succeed. Idempotent — the first of
 * several failures is the one that reports.
 *
 * @param reason - What proved the worker dead; it goes into the rejection and the warning.
 */
function retireWorker(reason: string): void {
    if (workerRetired) {
        return;
    }

    workerRetired = true;
    clearSilenceTimer();

    const dead = worker;

    worker = null;
    dead?.terminate();

    const error = new Error(`StoreWorker retired (${reason}); sort and filter run on the main thread`);

    for (const p of pending.values()) {
        p.reject(error);
    }

    pending.clear();
    console.warn(error.message);
}

/** Retires the worker when its script fails to load or fails to run. */
function handleWorkerError(): void {
    retireWorker("the worker script failed to run");
}

/**
 * Retires the worker when a reply cannot be deserialised. Such an event carries
 * no requestId, so nothing else could ever settle the request it belonged to.
 */
function handleWorkerMessageError(): void {
    retireWorker("a reply could not be decoded");
}

/**
 * Retires a worker that has said nothing for the whole deadline while owing a
 * reply — the failure neither error event covers — unless a bigger request
 * joined after the clock started, which is given the rest of its own allowance
 * first. The extension is applied here rather than at that dispatch, so the
 * silence a retirement reports is always measured from the last reply.
 */
function handleSilenceTimeout(): void {
    silenceTimer = null;

    const quiet  = quietSoFar + armedFor;
    const wanted = silenceDeadlineMs();

    if (wanted > quiet) {
        quietSoFar   = quiet;
        armedFor     = wanted - quiet;
        silenceTimer = setTimeout(handleSilenceTimeout, armedFor);

        return;
    }

    retireWorker(`it answered nothing for ${quiet}ms with ${pending.size} outstanding`);
}

function ensureWorker(): Worker | null {
    if (workerRetired) return null;
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;

    try {
        worker = new (StoreWorkerCtor as any)() as Worker;
    } catch {
        worker = null;
        return null;
    }

    worker.onerror = handleWorkerError;
    worker.onmessageerror = handleWorkerMessageError;

    worker.onmessage = (e: MessageEvent<Response>) => {
        const { requestId, indices, error } = e.data;
        const p = pending.get(requestId);

        if (p) {
            pending.delete(requestId);
        }

        // Any reply proves the worker's event loop is still turning, including
        // one whose requestId is unknown, so the clock restarts for whatever is
        // left. The delete comes first so the new deadline is sized on it.
        clearSilenceTimer();
        armSilenceTimer();

        if (!p) {
            return;
        }

        if (error) {
            p.reject(new Error(error));
        } else {
            p.resolve(indices);
        }
    };

    return worker;
}

function send(message: any, records: number): Promise<number[] | undefined> {
    const w = ensureWorker();
    if (!w) {
        return Promise.reject(new Error("Worker unavailable"));
    }

    const requestId = nextRequestId++;
    message.requestId = requestId;

    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject, records });

        try {
            w.postMessage(message);
        } catch (error) {
            // The message never left — a record that will not structured-clone
            // is the usual cause. That settles this request and nothing else:
            // the worker is healthy, so drop the entry rather than leave one
            // behind that only a retirement could ever reject.
            pending.delete(requestId);

            throw error;
        }

        // Armed only once a request is really outstanding, so a message that
        // never left cannot expire the deadline and retire a healthy worker.
        armSilenceTimer();
    });
}

export const StoreWorkerClient = {
    /**
     * Whether the offload is worth attempting: a worker can be constructed in
     * this runtime and has not been retired. A `false` here means the caller
     * must do the work itself — nothing else will.
     *
     * @returns true when a live worker is available.
     */
    isAvailable(): boolean {
        return ensureWorker() !== null;
    },

    /**
     * Ships a fresh snapshot of plain record data to the worker for the given storeId.
     * Subsequent sort/filter requests run against this snapshot until replaced.
     */
    snapshot(storeId: string, records: Array<Record<string, any>>): Promise<void> {
        snapshotSizes.set(storeId, records.length);

        return send({ type: "snapshot", storeId, records }, records.length).then(() => undefined);
    },

    /**
     * Combined filter + sort in a single round-trip. Either spec may be omitted.
     * The sort spec carries the field's `fieldType` so the worker's comparator
     * stays in parity with the main thread's (locale-aware strings, timestamp
     * dates).
     *
     * @remarks
     * The request is sized by the snapshot it runs over, so the silence
     * deadline grows with the dataset being sorted. A store whose snapshot
     * never went out is sized at zero — the base deadline alone — which is a
     * guard rather than a path, since the caller always snapshots first.
     */
    sortFilter(
        storeId: string,
        sort?: { field: string; direction: Direction; fieldType?: FieldType },
        filter?: FilterDescriptor,
    ): Promise<number[]> {
        return send({ type: "sortFilter", storeId, sort, filter }, snapshotSizes.get(storeId) ?? 0)
            .then(idx => idx ?? []);
    },
};
