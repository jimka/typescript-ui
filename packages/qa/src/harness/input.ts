// The device-input guard: a measured run drops the real mouse and keyboard, so
// a hand on the machine — or a cursor position the engine re-delivers after a
// layout change — cannot land inside a measured window. A run dispatches every
// event it wants through an event constructor, which the specification leaves
// untrusted, so passing the untrusted ones and dropping the trusted ones splits
// the harness's own input from the machine's exactly. Nothing here runs at
// import time.

/**
 * The device-input types a run drops: the pointer, mouse, wheel and key
 * families — what a person at the machine originates.
 *
 * Engine-made consequences of the harness's own actions are deliberately
 * absent, because a driver depends on each: `beforeinput` and `input`, which
 * `type` gets by asking the engine to insert the text; and `scroll`, which is
 * trusted even after a programmatic scroll and which `scroll-panes` counts.
 */
const GUARDED_TYPES: readonly string[] = [
    'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
    'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'click', 'dblclick', 'contextmenu',
    'wheel',
    'keydown', 'keypress', 'keyup',
];

/** Trusted events dropped so far, by type; `null` while the guard is not installed. */
let dropped: Record<string, number> | null = null;

/**
 * Drops `event` when the engine dispatched it, tallying it under its type, and
 * passes every script-made one through untouched.
 *
 * @param event - The event reaching the guard.
 */
function dropIfTrusted(event: Event): void {
    if (!event.isTrusted || !dropped) {
        return;
    }

    dropped[event.type] = (dropped[event.type] ?? 0) + 1;

    if (event.cancelable) {
        event.preventDefault();
    }

    event.stopImmediatePropagation();
}

/**
 * Installs the guard: one `window` capture listener per guarded type, and an
 * empty tally.
 *
 * The caller must do this before anything mounts. The library registers its own
 * `window` capture listener for an event type the first time something asks for
 * that type; two capture listeners on `window` run in registration order, and
 * `stopImmediatePropagation` stops only the listeners that have not run yet — so
 * a guard registered after the library's is silently useless.
 *
 * @returns A note saying what was installed.
 */
export function installInputGuard(): string {
    dropped = {};

    for (const type of GUARDED_TYPES) {
        window.addEventListener(type, dropIfTrusted, { capture: true, passive: false });
    }

    return `input guard: ${GUARDED_TYPES.length} device-input types dropped at window capture`;
}

/**
 * Removes the guard's listeners and forgets its tally. A measured run ends with
 * the page it ran in, so only the tests need this.
 */
export function removeInputGuard(): void {
    for (const type of GUARDED_TYPES) {
        window.removeEventListener(type, dropIfTrusted, { capture: true });
    }

    dropped = null;
}

/**
 * What the guard dropped, as a run note, so a report says whether anything
 * reached the page and what it was.
 *
 * @returns `input guard: nothing reached the page`, or the dropped types with their counts, largest first.
 */
export function droppedInputNote(): string {
    const counts = Object.entries(dropped ?? {}).sort(([, a], [, b]) => b - a);

    if (counts.length === 0) {
        return 'input guard: nothing reached the page';
    }

    return `input guard: dropped ${counts.map(([type, n]) => `${type}×${n}`).join(', ')}`;
}
