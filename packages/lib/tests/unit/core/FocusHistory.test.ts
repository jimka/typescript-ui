// FocusHistory is a module singleton (mirrors LayerManager), so every test
// disables + clears it in afterEach to avoid leaking trail state into
// sibling tests. focusin/keydown are driven offline via
// DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(...)) — the
// recording sink invokes window-registered viewport listeners, so the real
// Event/FocusHistory code runs unchanged (see TestDOM.ts's dispatchEvent).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FocusHistory, type FocusHistoryChange } from '~/core/FocusHistory';
import { DOM, type Handle } from '~/core/DOM';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { installTestDOM, makeEvent, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Mints a fresh handle, marked connected (live) unless told otherwise. */
function liveHandle(): Handle {
    const handle = DOM.sink.createElement('div');
    setConnected(handle, true);

    return handle;
}

/**
 * Models a user moving real focus to `handle`: sets it as the active element
 * (so `getActiveElement()` reflects it) and dispatches the `focusin` a real
 * browser fires for that move, through the window-registered viewport
 * listeners.
 */
function focusIn(handle: Handle): void {
    DOM.sink.focus(handle);
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'focusin'));
}

/** Dispatches a `keydown` combo through the window-registered viewport listeners; returns the event so preventDefault/stopPropagation can be asserted. */
function keyDown(init: { code: string; altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): { preventDefault: () => void; stopPropagation: () => void } {
    const event = makeEvent(0 as Handle, 'keydown', init) as unknown as { preventDefault: () => void; stopPropagation: () => void };

    vi.spyOn(event, 'preventDefault');
    vi.spyOn(event, 'stopPropagation');
    DOM.sink.dispatchEvent(DOM.source.getWindow(), event as unknown as Event);

    return event;
}

describe('FocusHistory', () => {
    afterEach(() => {
        FocusHistory.disable();
        FocusHistory.clear();
        DOM.reset();
    });

    it('seeds the current active element on enable, so back() has an origin', () => {
        installTestDOM(CONFIG);
        const a = liveHandle();

        DOM.sink.focus(a);
        FocusHistory.enable();

        // Nothing before the seeded entry.
        expect(FocusHistory.canGoBack()).toBe(false);

        const b = liveHandle();
        focusIn(b);

        // Now there IS something before the current entry: the seeded one.
        expect(FocusHistory.canGoBack()).toBe(true);
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('records a focusin on a new element and advances the trail', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        expect(FocusHistory.canGoForward()).toBe(false);

        const b = liveHandle();
        focusIn(b);

        expect(FocusHistory.canGoBack()).toBe(true);
        expect(FocusHistory.canGoForward()).toBe(false);
    });

    it('dedupes consecutive focusin on the same handle into one entry', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        const b = liveHandle();
        focusIn(b);
        focusIn(b); // repeat — must not create a second entry

        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
        // Nothing further back than the seed/first entry.
        expect(FocusHistory.canGoBack()).toBe(false);
    });

    it('truncates the forward branch when a fresh focus follows a back()', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        FocusHistory.back(); // now sitting on `a`, with `b` ahead

        const c = liveHandle();
        focusIn(c); // must drop the orphaned forward branch to `b`

        expect(FocusHistory.canGoForward()).toBe(false);
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('back() re-focuses the previous entry', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('forward() re-does after a back()', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        FocusHistory.back();
        expect(FocusHistory.forward()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    it('skips and drops a stale intermediate entry on back()', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        const stale = liveHandle();
        focusIn(stale);
        setConnected(stale, false); // dies after being recorded

        const c = liveHandle();
        focusIn(c);

        expect(FocusHistory.back()).toBe(true);
        // Skipped the stale entry straight to `a`.
        expect(DOM.source.getActiveElement()).toBe(a);
        // The stale entry is gone: nothing further back than `a`.
        expect(FocusHistory.canGoBack()).toBe(false);
    });

    it('the _navigating guard suppresses ANY focusin fired synchronously during a service-driven focus, not merely a deduped repeat', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const decoy = liveHandle();

        // Real browsers fire `focusin` synchronously inside `element.focus()`.
        // The offline sink's `focus()` does not model that, so this simulates
        // it directly: while back() is mid-call (the guard window), a focusin
        // for a DIFFERENT handle than the navigation target fires. Because it
        // targets a different handle than the current entry, ordinary
        // consecutive-dedupe would NOT catch it — only the `_navigating`
        // guard can, so this isolates the guard's own contribution.
        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            realFocus(handle, options);
            // Dispatch only — NOT the focusIn() helper, which would call
            // DOM.sink.focus again (itself mocked) and recurse infinitely.
            DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(decoy, 'focusin'));
        });

        FocusHistory.back(); // navigates b -> a; the mocked focus() also fires the decoy focusin

        // The decoy must not have been recorded: the forward branch to `b`
        // must still be intact (an unguarded decoy would have truncated it).
        expect(FocusHistory.canGoForward()).toBe(true);
        expect(FocusHistory.forward()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    it('bounds the trail at maxSize, keeping the newest entries', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable({ maxSize: 2 });

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);
        const c = liveHandle();
        focusIn(c);

        // Only 2 entries retained (b, c); a was dropped as the oldest.
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(b);
        expect(FocusHistory.canGoBack()).toBe(false);
    });

    it('canGoBack is honest when the only earlier entries are all stale', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const stale = liveHandle();
        focusIn(stale);
        setConnected(stale, false);

        const b = liveHandle();
        focusIn(b);

        expect(FocusHistory.canGoBack()).toBe(false);
    });

    it('clear() empties the trail and fires "change" with both flags false', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const changes: FocusHistoryChange[] = [];
        const listener = (c: FocusHistoryChange): void => { changes.push(c); };
        FocusHistory.on('change', listener);

        FocusHistory.clear();

        expect(changes).toEqual([{ canGoBack: false, canGoForward: false }]);
        expect(FocusHistory.canGoBack()).toBe(false);
        expect(FocusHistory.canGoForward()).toBe(false);

        FocusHistory.off('change', listener);
    });

    it('a matching keydown combo navigates and calls preventDefault', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const event = keyDown({ code: 'BracketLeft', altKey: true });

        expect(event.preventDefault).toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('a non-matching keydown combo does not navigate or preventDefault', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const event = keyDown({ code: 'KeyB', altKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    // Registrar regression (viewport-event-propagation): FocusHistory must
    // consume only the combos it actually navigates on, not every keydown —
    // otherwise it would silence keydown app-wide as soon as it is enabled.
    it('consumes only its matching combo, not an unrelated keydown', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const matched = keyDown({ code: 'BracketLeft', altKey: true });
        expect(matched.stopPropagation).toHaveBeenCalledTimes(1);

        const unmatched = keyDown({ code: 'KeyB', altKey: true });
        expect(unmatched.stopPropagation).not.toHaveBeenCalled();
    });

    it('suppresses back/forward while the top layer is modal', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const modalLayer: DismissableLayer = {
            getLayerElement: () => null,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        LayerManager.register(modalLayer);

        const event = keyDown({ code: 'BracketLeft', altKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(b); // unchanged

        LayerManager.unregister(modalLayer);
    });

    it('disable() stops observing but preserves the trail', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        FocusHistory.disable();

        const c = liveHandle();
        focusIn(c); // must not be recorded — service is disabled

        const event = keyDown({ code: 'BracketLeft', altKey: true });
        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(c); // unmoved by the inert combo

        // Trail preserved across disable(): the [a, b] trail (cursor on `b`)
        // is untouched by the disabled service's ignored focus move to `c`.
        // back()/forward() are not gated by enablement, so this is checkable
        // directly without re-enabling (which would itself re-seed from the
        // now-current active element, `c`).
        expect(FocusHistory.canGoBack()).toBe(true);
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('fires "change" on record and on navigate with correct flags', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable(); // no active element yet, so nothing is seeded

        const changes: FocusHistoryChange[] = [];
        const listener = (c: FocusHistoryChange): void => { changes.push(c); };
        FocusHistory.on('change', listener);

        const a = liveHandle();
        focusIn(a); // entry #1 — nothing before it yet

        expect(changes.at(-1)).toEqual({ canGoBack: false, canGoForward: false });

        const b = liveHandle();
        focusIn(b); // entry #2 — now `a` is reachable via back()

        expect(changes.at(-1)).toEqual({ canGoBack: true, canGoForward: false });

        FocusHistory.back();
        expect(changes.at(-1)).toEqual({ canGoBack: false, canGoForward: true });

        FocusHistory.off('change', listener);
    });
});
