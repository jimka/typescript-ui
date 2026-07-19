// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";

/**
 * Body-level bookkeeping shared by every component that drags a handle against
 * the viewport — a split gutter, a window border, a table column edge.
 *
 * Two things have to happen together for the duration of such a drag, which is
 * why they live in one call rather than at each drag site:
 *
 * 1. `<body>` stops taking pointer events, so the drag can't snag on whatever
 *    the pointer passes over.
 * 2. The document element holds the drag cursor. This is the half that is easy
 *    to miss: suppressing (1) also takes body's whole subtree — the drag handle
 *    included — out of hit-testing, so nothing there resolves a cursor any more
 *    and the pointer reverts to the default arrow mid-drag. The document
 *    element stays hit-testable and is what the cursor falls back to, so it has
 *    to carry the cursor instead.
 */

/**
 * Suppresses body pointer events and pins `cursor` for the duration of a drag.
 * Pair every call with {@link endPointerDrag}.
 *
 * @param cursor - The CSS cursor to hold until the drag ends, normally the one
 *   the handle shows on hover so the two can't disagree.
 */
export function beginPointerDrag(cursor: string): void {
    DOM.sink.apply(DOM.source.getBody(), { style: { pointerEvents: "none" } });
    DOM.sink.apply(DOM.source.getDocumentElement(), { style: { cursor } });
}

/**
 * Restores body pointer events and hands the cursor back to whatever the
 * pointer is actually over. Safe to call without a matching
 * {@link beginPointerDrag} — it only clears inline values.
 */
export function endPointerDrag(): void {
    DOM.sink.apply(DOM.source.getBody(), { style: { pointerEvents: "" } });
    DOM.sink.apply(DOM.source.getDocumentElement(), { style: { cursor: "" } });
}
