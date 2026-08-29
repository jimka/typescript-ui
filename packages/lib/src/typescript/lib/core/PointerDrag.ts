// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { StyleRule } from "~/core/StyleTarget.js";

/**
 * Body-level bookkeeping shared by every component that drags a handle against
 * the viewport — a split gutter, a window border, a table column edge, a
 * scrollbar thumb.
 *
 * Two things have to happen together for the duration of such a drag, which is
 * why they live in one call rather than at each drag site:
 *
 * 1. Every direct child of `<html>` stops taking pointer events, so the drag
 *    can't snag on whatever the pointer passes over. This is `<body>` plus
 *    anything a `Window`, `Drawer`, or `LayerManager`-hosted overlay (Dialog,
 *    Menu, Notification, Popover) appends straight to `document.documentElement`
 *    rather than into `<body>` — suppressing only `<body>` would leave those
 *    subtrees hit-testable, letting a drag that passes over a window's own
 *    content (not just ordinary page content) steal the cursor back.
 * 2. The document element holds the drag cursor. This is the half that is easy
 *    to miss: suppressing (1) also takes every suppressed subtree — the drag
 *    handle included — out of hit-testing, so nothing there resolves a cursor
 *    any more and the pointer reverts to the default arrow mid-drag. The
 *    document element itself is deliberately left out of the suppression and
 *    is what the cursor falls back to, so it has to carry the cursor instead.
 */

const DRAGGING_CLASS = "ts-ui-dragging";

// Module-singleton shared rule, mirroring ensureFrameworkStyleRule in
// ClassStyleRules.ts: created once, on the first drag, and never disposed.
let _suppressRuleCreated = false;

function ensureSuppressRule(): void {
    if (_suppressRuleCreated) {
        return;
    }

    _suppressRuleCreated = true;

    new StyleRule({
        scope:  "selector",
        name:   "html." + DRAGGING_CLASS + " > *",
        styles: { pointerEvents: "none" },
    });
}

/**
 * Suppresses pointer events on every direct child of `<html>` and pins
 * `cursor` on `<html>` itself for the duration of a drag. Pair every call
 * with {@link endPointerDrag}.
 *
 * @param cursor - The CSS cursor to hold until the drag ends, normally the one
 *   the handle shows on hover so the two can't disagree.
 */
export function beginPointerDrag(cursor: string): void {
    ensureSuppressRule();

    DOM.sink.apply(DOM.source.getDocumentElement(), {
        addClass: [DRAGGING_CLASS],
        style:    { cursor },
    });
}

/**
 * Restores pointer events and hands the cursor back to whatever the pointer
 * is actually over. Safe to call without a matching {@link beginPointerDrag}
 * — it only clears the class and the inline cursor.
 */
export function endPointerDrag(): void {
    DOM.sink.apply(DOM.source.getDocumentElement(), {
        removeClass: [DRAGGING_CLASS],
        style:       { cursor: "" },
    });
}

/**
 * Wires the standard viewport drag lifecycle: registers `moveListener` for
 * both `mousemove` and `touchmove`, `stopListener` for `mouseup`, `touchend`,
 * and `touchcancel` (all via `Event.addViewportListener`), then calls
 * `beginPointerDrag(cursor)`. Pair with `endViewportDrag` using the exact
 * same `component`/`moveListener`/`stopListener` references.
 */
export function beginViewportDrag(
    component:    Component,
    moveListener: Event.Listener,
    stopListener: Event.Listener,
    cursor:       string,
): void {
    Event.addViewportListener(component, 'mouseup', stopListener);
    Event.addViewportListener(component, 'touchend', stopListener);
    Event.addViewportListener(component, 'touchcancel', stopListener);
    Event.addViewportListener(component, 'mousemove', moveListener);
    Event.addViewportListener(component, 'touchmove', moveListener);

    beginPointerDrag(cursor);
}

/**
 * Removes the five viewport listeners `beginViewportDrag` registered and
 * calls `endPointerDrag()`. `moveListener`/`stopListener` must be the same
 * function references passed to the matching `beginViewportDrag` call.
 */
export function endViewportDrag(
    component:    Component,
    moveListener: Event.Listener,
    stopListener: Event.Listener,
): void {
    Event.removeViewportListener(component, 'mouseup', stopListener);
    Event.removeViewportListener(component, 'touchend', stopListener);
    Event.removeViewportListener(component, 'touchcancel', stopListener);
    Event.removeViewportListener(component, 'mousemove', moveListener);
    Event.removeViewportListener(component, 'touchmove', moveListener);

    endPointerDrag();
}
