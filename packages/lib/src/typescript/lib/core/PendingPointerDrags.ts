// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal registry mapping an owning component's id to the function
// that ends the pointer drag it armed through `beginPointerDrag`.
// `Component.destructor()` consults this immediately after it purges the
// component's `Event` registrations, so a component destroyed part-way through
// a gesture cannot leave the document element wearing `ts-ui-dragging` and a
// pinned cursor — the purge has just removed the viewport listener that would
// otherwise have ended the drag. Keyed by id rather than by the component
// itself: an entry holding the instance would pin it and disarm the GC
// finalizer, which is why `Event`'s own component registry is id-keyed too. Not
// exported from `core/index.ts`: this module exists purely to let
// `PointerDrag.ts` and `Component.ts` share this bookkeeping without importing
// each other, mirroring `core/PendingTransitions.ts`.

/** The function that ends each armed drag, keyed by its owner's component id. */
const armed: Map<string, () => void> = new Map();

/**
 * Records the function that ends `ownerId`'s armed pointer drag. A component
 * can only ever have one drag armed, so a second call replaces the first.
 *
 * @param ownerId - The id of the component that began the drag.
 * @param end - The function that clears the drag's document-element chrome.
 */
export function registerPointerDrag(ownerId: string, end: () => void): void {
    armed.set(ownerId, end);
}

/**
 * Forgets `ownerId`'s record, called when the drag ends normally so a later
 * teardown has nothing left to clear.
 *
 * @param ownerId - The id of the component whose drag has ended.
 */
export function unregisterPointerDrag(ownerId: string): void {
    armed.delete(ownerId);
}

/**
 * Invokes and forgets whatever is recorded for `ownerId`, a no-op when nothing
 * is. Called by `Component.destructor()` for the component being destroyed.
 *
 * @param ownerId - The id of the component being destroyed.
 */
export function endPointerDragFor(ownerId: string): void {
    const end = armed.get(ownerId);

    if (!end) {
        return;
    }

    // Deleted before it is invoked, as `cancelTransitions` does, so a
    // re-entrant call cannot loop.
    armed.delete(ownerId);

    end();
}
