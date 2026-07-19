// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/* eslint-disable local/no-raw-dom -- Web Worker entry: self/postMessage are worker-scope messaging, not DOM. */
//
// Worker entry point for AbstractStore sort/filter offload. Runs in a Web Worker
// context (Vite imports it via `?worker` query). Owns a per-store snapshot of
// plain record data so sort/filter can run without re-shipping the dataset on
// every operation. Returns sorted indices into the snapshot — main thread maps
// them back to ModelRecord instances itself.

import { FilterDescriptor, matchesFilter } from "~/data/FilterDescriptor.js";
import { compareValues } from "~/data/compareValues.js";
import type { FieldType } from "~/data/Field.js";

type Direction = "asc" | "desc";

type StoreSnapshot = Array<Record<string, any>>;

type Request =
    | { type: "snapshot";   storeId: string; records: StoreSnapshot;            requestId: number }
    | { type: "sortFilter"; storeId: string; sort?: { field: string; direction: Direction; fieldType?: FieldType };
                            filter?: FilterDescriptor;                           requestId: number };

type Response = { requestId: number; indices?: number[]; error?: string };

const snapshots: Map<string, StoreSnapshot> = new Map();

function sortIndices(records: StoreSnapshot, indices: number[], field: string, direction: Direction, fieldType?: FieldType): void {
    indices.sort((ai, bi) => {
        const av = records[ai] ? records[ai][field] : undefined;
        const bv = records[bi] ? records[bi][field] : undefined;

        const cmp = compareValues(av, bv, fieldType);

        // Nulls sort last regardless of direction: leave a null-involving result
        // un-negated, applying direction only to a non-null comparison. This
        // mirrors the main-thread comparator in AbstractStore.applyView().
        if (av == null || bv == null) {
            return cmp;
        }

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

        if (msg.filter) {
            indices = indices.filter(i => matchesFilter(records[i], msg.filter!));
        }

        if (msg.sort) {
            sortIndices(records, indices, msg.sort.field, msg.sort.direction, msg.sort.fieldType);
        }

        (self as any).postMessage({ requestId: msg.requestId, indices } as Response);
    } catch (err: any) {
        (self as any).postMessage({ requestId: msg.requestId, error: String(err?.message ?? err) } as Response);
    }
};
