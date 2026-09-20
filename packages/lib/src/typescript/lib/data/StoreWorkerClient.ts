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
// could not be decoded, or its first request went unanswered — is *retired*:
// terminated, every outstanding request rejected, and never rebuilt.

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
}

/**
 * How long the worker's *first* request may go unanswered before the worker is
 * declared dead. It bounds worker startup and its first answer, not a sort:
 * only the first request is timed, because once the worker has answered, a long
 * wait is real work rather than a dead script. Five seconds is far more than a
 * `blob:` worker needs to boot and take its first snapshot, and expiring it
 * early costs only the offload, since the in-process path builds the same view.
 */
const WORKER_PROBE_TIMEOUT_MS = 5000;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending: Map<number, Pending> = new Map();

// Set once the worker is proven dead; never cleared, so a retired worker is
// never rebuilt.
let workerRetired = false;
// Set by the first reply of any kind. Until then the worker is unproven and
// its first request is timed.
let workerProven = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancels the startup probe, if one is armed. Called by the first reply of any
 * kind and by retirement, so a dead worker leaves no timer behind.
 */
function clearProbeTimer(): void {
    if (probeTimer !== null) {
        clearTimeout(probeTimer);
        probeTimer = null;
    }
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
    clearProbeTimer();

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

/** Retires a worker that booted but never answered — the failure neither error event covers. */
function handleProbeTimeout(): void {
    retireWorker(`its first request went unanswered for ${WORKER_PROBE_TIMEOUT_MS}ms`);
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
        // Any reply proves the script ran, including one whose requestId is
        // unknown, so the startup probe is done either way.
        workerProven = true;
        clearProbeTimer();

        const { requestId, indices, error } = e.data;
        const p = pending.get(requestId);
        if (!p) return;

        pending.delete(requestId);

        if (error) {
            p.reject(new Error(error));
        } else {
            p.resolve(indices);
        }
    };

    return worker;
}

function send(message: any): Promise<number[] | undefined> {
    const w = ensureWorker();
    if (!w) {
        return Promise.reject(new Error("Worker unavailable"));
    }

    const requestId = nextRequestId++;
    message.requestId = requestId;

    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });

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
        // never left cannot expire the probe and retire a healthy worker.
        if (!workerProven && probeTimer === null) {
            probeTimer = setTimeout(handleProbeTimeout, WORKER_PROBE_TIMEOUT_MS);
        }
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
        return send({ type: "snapshot", storeId, records }).then(() => undefined);
    },

    /**
     * Combined filter + sort in a single round-trip. Either spec may be omitted.
     * The sort spec carries the field's `fieldType` so the worker's comparator
     * stays in parity with the main thread's (locale-aware strings, timestamp
     * dates).
     */
    sortFilter(
        storeId: string,
        sort?: { field: string; direction: Direction; fieldType?: FieldType },
        filter?: FilterDescriptor,
    ): Promise<number[]> {
        return send({ type: "sortFilter", storeId, sort, filter }).then(idx => idx ?? []);
    },
};
