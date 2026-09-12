// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { LayerManager } from "~/core/LayerManager.js";

/**
 * CSS selector matching every element the framework treats as focusable.
 * Copied verbatim from `Dialog`'s former private constant, which now imports
 * this one instead of keeping its own copy.
 */
export const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Whether `handle` still resolves to a connected element. Resolving a
 * released handle throws inside the seam; that counts as dead too.
 *
 * @param handle - The handle to check.
 */
export function isLiveHandle(handle: Handle): boolean {
    try {
        return DOM.source.isConnected(handle);
    } catch {
        return false;
    }
}

/**
 * Yields `start`, then its ancestors in order, stopping right after yielding
 * `documentElement`. Bounded there rather than at `<body>` because a
 * `LayerManager`-portaled overlay (a `Window`, a `Dialog`, a `Menu`, …) mounts
 * directly on `documentElement`, bypassing `<body>` entirely — a walk bounded
 * at `<body>` would run past it into the `document` node itself, which has no
 * `hasAttribute`. Shared by every marker-attribute ancestor search in
 * `FocusTraversal` and `SpatialNavigation`.
 *
 * @param start - The element to start the walk from (yielded first).
 */
export function* ancestorsToDocument(start: Handle): Generator<Handle> {
    const documentElement = DOM.source.getDocumentElement();

    for (let h: Handle | null = start; h !== null; h = DOM.source.getParentNode(h)) {
        yield h;

        if (h === documentElement) {
            return;
        }
    }
}

/**
 * Yields `handle`'s ancestors, excluding `handle` itself and stopping before
 * `bound` — and before `documentElement` too, for the same portaled-overlay
 * reason as {@link ancestorsToDocument}, since a caller's `bound` (typically
 * the current {@link focusScopeRoot}) is not guaranteed to be an ancestor of
 * `handle` at all.
 *
 * @param handle - The element to walk up from.
 * @param bound - The ancestor to stop before reaching (exclusive).
 */
export function* ancestorsBefore(handle: Handle, bound: Handle): Generator<Handle> {
    const documentElement = DOM.source.getDocumentElement();

    for (let h = DOM.source.getParentNode(handle);
        h !== null && h !== bound && h !== documentElement;
        h = DOM.source.getParentNode(h)) {
        yield h;
    }
}

/**
 * The topmost registered layer's element, or `<body>` when no layer is open.
 */
export function focusScopeRoot(): Handle {
    const top = LayerManager.getTopLayer();
    const layerElement = top?.getLayerElement() ?? null;

    return layerElement ?? DOM.source.getBody();
}

/**
 * Enabled focusable elements inside `root`, in DOM order — `root` itself
 * first if it is focusable (a leaf pane component, such as a `TextArea`,
 * renders as the bare `<textarea>` with no wrapper, so `root` and the
 * candidate are the same element), then its focusable descendants.
 * `querySelectorAll` alone would miss that leaf case, since it searches only
 * descendants — the same reasoning behind `Dialog.requestedFocusElement`'s
 * `matches` check before falling back to `querySelector`.
 *
 * @param root - The element to search inside.
 */
export function findFocusable(root: Handle): Handle[] {
    const descendants = DOM.source.querySelectorAll(root, FOCUSABLE_SELECTOR)
        .filter(handle => !DOM.source.hasAttribute(handle, "disabled"));

    if (DOM.source.matches(root, FOCUSABLE_SELECTOR) && !DOM.source.hasAttribute(root, "disabled")) {
        return [root, ...descendants];
    }

    return descendants;
}

/**
 * `findFocusable(root)` filtered to elements that are actually rendered.
 *
 * @param root - The element to search inside.
 */
export function visibleFocusable(root: Handle): Handle[] {
    return findFocusable(root).filter(handle => DOM.source.isRenderedVisible(handle));
}

/**
 * `findFocusable(root)`, with a still-valid `recorded` handle promoted to the
 * front. `recorded` is dropped when it is missing, disconnected, or no longer
 * inside `root` — in each case the ordinary DOM-order list is returned as is.
 *
 * @param root - The element to search inside.
 * @param recorded - The previously-focused handle to prefer, if still live.
 */
export function focusCandidates(root: Handle, recorded: Handle | undefined): Handle[] {
    const focusable = findFocusable(root);

    if (recorded === undefined || !isLiveHandle(recorded) || !DOM.source.contains(root, recorded)) {
        return focusable;
    }

    return [recorded, ...focusable.filter(handle => handle !== recorded)];
}
