// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/* eslint-disable local/no-raw-dom -- Web Worker entry: self/postMessage are worker-scope messaging, not DOM. */
//
// Worker entry point for AbstractStore sort/filter offload. Runs in a Web Worker
// context (Vite imports it via `?worker` query). Owns a per-store snapshot of
// plain record data so sort/filter can run without re-shipping the dataset on
// every operation. Returns sorted indices into the snapshot — main thread maps
// them back to ModelRecord instances itself.

import { FilterDescriptor, matchesFilter } from "~/data/FilterDescriptor.js";

type Direction = "asc" | "desc";

type StoreSnapshot = Array<Record<string, any>>;

type Request =
    | { type: "snapshot";   storeId: string; records: StoreSnapshot;            requestId: number }
    | { type: "sort";       storeId: string; field: string; direction: Direction; requestId: number }
    | { type: "filter";     storeId: string; descriptor: FilterDescriptor;       requestId: number }
    | { type: "sortFilter"; storeId: string; sort?: { field: string; direction: Direction };
                            filter?: FilterDescriptor;                           requestId: number };

type Response = { requestId: number; indices?: number[]; error?: string };

const snapshots: Map<string, StoreSnapshot> = new Map();

function sortIndices(records: StoreSnapshot, indices: number[], field: string, direction: Direction): void {
    indices.sort((ai, bi) => {
        const av = records[ai] ? records[ai][field] : undefined;
        const bv = records[bi] ? records[bi][field] : undefined;

        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;

        const cmp = av < bv ? -1 : av > bv ? 1 : 0;

        return direction === "asc" ? cmp : -cmp;
    });
}

self.onmessage = (e: MessageEvent<Request>) => {
    const msg = e.data;

    try {
        if (msg.type === "snapshot") {
            snapshots.set(msg.storeId, msg.records);
            (self as any).postMessage({ requestId: msg.requestId } as Response);
            return;
        }

        const records = snapshots.get(msg.storeId);
        if (!records) {
            (self as any).postMessage({ requestId: msg.requestId, error: "No snapshot for storeId " + msg.storeId } as Response);
            return;
        }

        let indices: number[] = [];
        for (let i = 0; i < records.length; i++) {
            indices.push(i);
        }

        if (msg.type === "filter" || (msg.type === "sortFilter" && msg.filter)) {
            const descriptor = msg.type === "filter" ? msg.descriptor : msg.filter!;
            indices = indices.filter(i => matchesFilter(records[i], descriptor));
        }

        if (msg.type === "sort" || (msg.type === "sortFilter" && msg.sort)) {
            const sortSpec = msg.type === "sort"
                ? { field: msg.field, direction: msg.direction }
                : msg.sort!;
            sortIndices(records, indices, sortSpec.field, sortSpec.direction);
        }

        (self as any).postMessage({ requestId: msg.requestId, indices } as Response);
    } catch (err: any) {
        (self as any).postMessage({ requestId: msg.requestId, error: String(err?.message ?? err) } as Response);
    }
};
