// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

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
