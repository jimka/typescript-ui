// The toast stack's response to a viewport resize, in its own file.
//
// `Event`'s viewportListenerMap is module-level state and the window listener
// is attached only when a type is first registered (core/Event.ts), while
// `DOM.reset()` replaces the sink without clearing that map. Once an earlier
// case in the same file has registered "resize" against a stale window handle,
// a later registration silently never re-attaches and no dispatch reaches it —
// the same reasoning `tests/dom/viewport-consume.test.ts` records for itself.
// Vitest gives each test file a fresh module registry, so the dispatching case
// below is deterministic here and would not be beside the toast cases in
// `Notification.test.ts`.
//
// A resize is driven by mutating the config object the test handed
// `installTestDOM` — `ModelledDOMSource.getViewportSize` reads it live — and
// then dispatching a window-level `resize` through the sink.
import { describe, it, expect, afterEach } from 'vitest';
import { Notification } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** The viewport a toast is first shown against. */
const START_VIEWPORT = { width: 1280, height: 800 };

/** The viewport the window is resized to: narrower and shorter on both axes. */
const RESIZED_VIEWPORT = { width: 1000, height: 600 };

// The toast's own box and margin, mirrored from `Notification`'s private
// constants so the expected corner below is derived rather than guessed.
const TOAST_WIDTH_PX  = 320;
const TOAST_HEIGHT_PX = 64;
const TOAST_MARGIN_PX = 16;

function config(): {
    rootMountOffset: { x: number; y: number };
    viewport:        { width: number; height: number };
    scrollBarWidth:  number;
    fontMetrics:     typeof fontMetrics;
    themeVars:       Record<string, string>;
} {
    return {
        rootMountOffset: { x: 0, y: 0 },
        viewport:        { ...START_VIEWPORT },
        scrollBarWidth:  15,
        fontMetrics,
        themeVars:       {},
    };
}

/** Where the single live toast belongs in `viewport`'s bottom-right corner. */
function corner(viewport: { width: number; height: number }): { x: number; y: number } {
    return {
        x: viewport.width  - TOAST_WIDTH_PX  - TOAST_MARGIN_PX,
        y: viewport.height - TOAST_MARGIN_PX - TOAST_HEIGHT_PX,
    };
}

/** The live toast stack; the constructor is private, so it is reached statically. */
function activeToasts(): Notification[] {
    return (Notification as unknown as { activeNotifications: Notification[] }).activeNotifications;
}

/** The toast most recently shown. */
function liveToast(): Notification {
    const active = activeToasts();

    return active[active.length - 1];
}

/** Completes a toast's dismissal, the step the exit animation ends on. */
function finishDismiss(toast: Notification): void {
    (toast as unknown as { finishDismiss(): void }).finishDismiss();
}

/** Dispatches a window-level `resize` at the modelled window. */
function dispatchResize(): void {
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(DOM.source.getWindow(), 'resize'));
}

describe('Notification (viewport resize)', () => {
    afterEach(() => {
        // A persistent toast outlives its case, and the static stack outlives
        // the DOM — drain it so the next case starts with no live listener.
        for (const toast of [...activeToasts()]) {
            toast.dispose();
        }

        DOM.reset();
    });

    it('re-stacks every live toast into the new bottom-right corner', () => {
        const cfg = config();

        installTestDOM(cfg);

        // Duration 0 keeps the toast alive: the move must happen with no
        // `show` and no dismissal in between, purely from the resize.
        Notification.show('toast', 'info', 0);

        const toast = liveToast();
        const start = corner(START_VIEWPORT);

        expect(toast.getX()).toBe(start.x);
        expect(toast.getY()).toBe(start.y);

        cfg.viewport = { ...RESIZED_VIEWPORT };
        dispatchResize();

        const resized = corner(RESIZED_VIEWPORT);

        expect(toast.getX()).toBe(resized.x);
        expect(toast.getY()).toBe(resized.y);
    });

    it('installs one viewport listener for the whole stack, not one per toast', () => {
        installTestDOM(config());

        const before = Event.listenerCounts().viewport;

        Notification.show('first', 'info', 0);

        const afterFirst = Event.listenerCounts().viewport;

        Notification.show('second', 'info', 0);

        expect(afterFirst).toBe(before + 1);
        expect(Event.listenerCounts().viewport).toBe(afterFirst);
    });

    it('removes the listener with the last toast, dismissed or disposed', () => {
        installTestDOM(config());

        const before = Event.listenerCounts().viewport;

        Notification.show('dismissed', 'info', 0);

        expect(Event.listenerCounts().viewport).toBe(before + 1);

        finishDismiss(liveToast());

        expect(Event.listenerCounts().viewport).toBe(before);

        // A toast disposed directly never reaches `finishDismiss`, so the
        // destructor's own list-leave has to release the listener too.
        Notification.show('disposed', 'info', 0);
        liveToast().dispose();

        expect(Event.listenerCounts().viewport).toBe(before);
    });
});
