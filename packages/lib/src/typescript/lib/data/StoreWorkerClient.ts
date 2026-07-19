// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Main-thread client for the StoreWorker. Lazily constructs a single Worker
// instance shared across all stores; routes requests by requestId so concurrent
// stores don't crosstalk. Falls back gracefully if Worker isn't available
// (test environment, server-side, etc.) — the AbstractStore caller checks
// `isAvailable()` before dispatching.

import { FilterDescriptor } from "~/data/FilterDescriptor.js";
import type { FieldType } from "~/data/Field.js";

// Vite-specific worker import. The `?worker` suffix tells Vite to bundle the
// module as a Web Worker entry. The default export is the Worker constructor.
// @ts-ignore — Vite resolves this at build time; tsc on its own can't.
import StoreWorkerCtor from "~/data/StoreWorker.js?worker";

type Direction = "asc" | "desc";

type Response = { requestId: number; indices?: number[]; error?: string };

interface Pending {
    resolve: (indices: number[] | undefined) => void;
    reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending: Map<number, Pending> = new Map();

function ensureWorker(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;

    try {
        worker = new (StoreWorkerCtor as any)() as Worker;
    } catch {
        worker = null;
        return null;
    }

    worker.onmessage = (e: MessageEvent<Response>) => {
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
        w.postMessage(message);
    });
}

export const StoreWorkerClient = {
    /**
     * @returns true when a worker can be constructed in this runtime.
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
