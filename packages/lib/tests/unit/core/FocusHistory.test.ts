// FocusHistory is a module singleton (mirrors LayerManager), so every test
// disables + clears it in afterEach to avoid leaking trail state into
// sibling tests. focusin/keydown are driven offline via
// DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(...)) — the
// recording sink invokes window-registered viewport listeners, so the real
// Event/FocusHistory code runs unchanged (see TestDOM.ts's dispatchEvent).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FocusHistory, type FocusHistoryChange } from '~/core/FocusHistory';
import { FocusReveal } from '~/core/FocusReveal';
import { DOM, type Handle } from '~/core/DOM';
import { LayerManager, type DismissableLayer, type LayerDismissMode } from '~/core/LayerManager';
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

// The service's documented default trail length (`FocusHistoryOptions.maxSize`),
// which the module does not export.
const DEFAULT_MAX_SIZE = 50;

// Every layer a case registers through `register`, so the draining afterEach
// can remove it. LayerManager is a module singleton: a layer that outlives its
// case would stop every later case's recording or accelerator.
const registered: DismissableLayer[] = [];

/** Registers `layer` with LayerManager and tracks it for the drain. */
function register(layer: DismissableLayer): void {
    LayerManager.register(layer);
    registered.push(layer);
}

/** A fake layer of dismiss mode `mode` with an element of its own. Not registered. */
function layerWith(mode: LayerDismissMode): { layer: DismissableLayer; element: Handle } {
    const element = liveHandle();

    const layer: DismissableLayer = {
        getLayerElement: () => element,
        getDismissMode:  () => mode,
        requestClose:    () => {},
    };

    return { layer, element };
}

/** Mints a live handle inside `parent` — a control of the layer `parent` is the element of. */
function controlIn(parent: Handle): Handle {
    const handle = liveHandle();

    DOM.sink.appendChild(parent, handle);

    return handle;
}

/**
 * Moves focus to `handle` with no `focusin`: models focus sitting on
 * something that was never recorded, such as a table cell, or `<body>` after
 * the focused control was removed.
 */
function focusSilently(handle: Handle): void {
    DOM.sink.focus(handle);
}

/** Dispatches the default back chord, `Alt+[`. */
function altBracketLeft(): { preventDefault: () => void; stopPropagation: () => void } {
    return keyDown({ code: 'BracketLeft', altKey: true });
}

describe('FocusHistory', () => {
    afterEach(() => {
        // Drain in reverse registration order; unregister is idempotent.
        for (let i = registered.length - 1; i >= 0; i--) {
            LayerManager.unregister(registered[i]);
        }

        registered.length = 0;

        FocusHistory.disable();
        FocusHistory.clear();
        // configure() outlives disable() and clear(): without this, the case
        // that bounds the trail at two entries would bound every later one.
        FocusHistory.configure({ maxSize: DEFAULT_MAX_SIZE });
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

    it('navigate skips an entry that cannot take focus, without dropping it from the trail', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const middle = liveHandle();
        focusIn(middle);
        const c = liveHandle();
        focusIn(c);

        // `middle` refuses focus (unlike a stale entry, it stays connected) —
        // the offline stand-in for a container that cannot be revealed.
        const realFocus = DOM.sink.focus.bind(DOM.sink);
        const spy = vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            if (handle === middle) {
                return;
            }

            realFocus(handle, options);
        });

        // back(): c -> middle (refused, skipped) -> a (succeeds).
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
        // Nothing revealable before `a`.
        expect(FocusHistory.canGoBack()).toBe(false);

        // Un-refuse `middle` and prove it is still in the trail — forward()
        // lands ON it rather than jumping straight to `c`.
        spy.mockRestore();
        expect(FocusHistory.forward()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(middle);
    });

    it('navigate returns false and leaves the trail position unchanged when nothing in that direction can take focus', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        // Nothing can ever take focus — no entry before `b` is reachable.
        vi.spyOn(DOM.sink, 'focus').mockImplementation(() => {});

        expect(FocusHistory.back()).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    it('reveals the target before focusing it', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const order: string[] = [];

        vi.spyOn(FocusReveal, 'reveal').mockImplementation((target: Handle) => {
            order.push('reveal');

            return DOM.source.isConnected(target);
        });

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            order.push('focus');
            realFocus(handle, options);
        });

        expect(FocusHistory.back()).toBe(true);
        expect(order).toEqual(['reveal', 'focus']);
    });

    it('passes preventScroll: true to the service-driven focus', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const spy = vi.spyOn(DOM.sink, 'focus');

        expect(FocusHistory.back()).toBe(true);
        expect(spy).toHaveBeenCalledWith(a, { preventScroll: true });
    });

    it('the _navigating guard suppresses ANY focusin fired synchronously during a service-driven reveal or focus, not merely a deduped repeat', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        const decoy = liveHandle();

        // Real browsers fire `focusin` synchronously inside `element.focus()`,
        // and a revealer's own state change (a tab select, say) can likewise
        // move focus mid-reveal. The offline sink models neither directly, so
        // both are simulated here: while back() is mid-call (the guard
        // window), a focusin for a DIFFERENT handle than the navigation
        // target fires from each phase — reveal and focus. Because it targets
        // a different handle than the current entry, ordinary
        // consecutive-dedupe would NOT catch it — only the `_navigating`
        // guard can, so this isolates the guard's own contribution.
        vi.spyOn(FocusReveal, 'reveal').mockImplementation((target: Handle) => {
            DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(decoy, 'focusin'));

            return DOM.source.isConnected(target);
        });

        const realFocus = DOM.sink.focus.bind(DOM.sink);
        vi.spyOn(DOM.sink, 'focus').mockImplementation((handle: Handle, options?: { preventScroll?: boolean }) => {
            realFocus(handle, options);
            // Dispatch only — NOT the focusIn() helper, which would call
            // DOM.sink.focus again (itself mocked) and recurse infinitely.
            DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(decoy, 'focusin'));
        });

        FocusHistory.back(); // navigates b -> a; both the mocked reveal() and focus() fire the decoy focusin

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

        register(modalLayer);

        const event = keyDown({ code: 'BracketLeft', altKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(b); // unchanged

        LayerManager.unregister(modalLayer);
    });

    // modal-dialog-focus-trap plan, case H1: the old test asked whether the
    // *top* layer was modal, which is false as soon as a menu or a dropdown is
    // open above a dialog — and the accelerator then walked to a control of
    // the page behind it.
    it('suppresses back/forward while a modal layer is open beneath another layer', () => {
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
        const menuLayer: DismissableLayer = {
            getLayerElement: () => null,
            getDismissMode:  () => 'click-outside',
            requestClose:    () => {},
        };

        register(modalLayer);
        register(menuLayer);

        const event = keyDown({ code: 'BracketLeft', altKey: true });

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(b); // unchanged

        LayerManager.unregister(menuLayer);
        LayerManager.unregister(modalLayer);
    });

    // Case H2: the API does not reveal an entry behind the modal — a reveal
    // selects tabs and expands regions of a page nobody can reach. The walk
    // no longer tests each entry: it does not start while a modal is open.
    it('back() skips, without revealing, an entry behind the topmost modal layer', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const behind = liveHandle();
        focusIn(behind);

        const layerEl = liveHandle();
        const inside  = liveHandle();
        DOM.sink.appendChild(layerEl, inside);

        const modalLayer: DismissableLayer = {
            getLayerElement: () => layerEl,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        register(modalLayer);
        focusIn(inside);

        const reveal = vi.spyOn(FocusReveal, 'reveal');

        // An earlier case's spy on the same method is handed back with its
        // call history, so start from none.
        reveal.mockClear();

        expect(FocusHistory.back()).toBe(false);
        expect(reveal).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(inside);

        LayerManager.unregister(modalLayer);
        reveal.mockRestore();

        // With the modal closed the same entry is reachable again.
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(behind);
    });

    // focus-history-transient-layers plan, case S5. Nothing inside a modal
    // layer is a stop, so the trail holds nothing to walk between there.
    it('S5: back() does not walk between the controls of a modal layer', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const modal = layerWith('modal');

        register(modal.layer);

        const first  = controlIn(modal.element);
        const second = controlIn(modal.element);

        focusIn(first);
        focusIn(second);

        expect(FocusHistory.back()).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(second);
    });

    // The forward half of the same rule: the trail is out of reach while a
    // modal layer is open.
    it('forward() moves and reveals nothing while a modal layer is open', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);
        const b = liveHandle();
        focusIn(b);

        FocusHistory.back(); // [a*, b]

        const modal = layerWith('modal');

        register(modal.layer);

        const control = controlIn(modal.element);

        focusIn(control);

        const reveal = vi.spyOn(FocusReveal, 'reveal');

        reveal.mockClear();

        expect(FocusHistory.forward()).toBe(false);
        expect(reveal).not.toHaveBeenCalled();
        expect(DOM.source.getActiveElement()).toBe(control);

        reveal.mockRestore();
    });

    // A layer that keeps its element between two openings — a `Drawer` does —
    // can hold a stop recorded while it was no part of a modal. Opened again
    // as a modal layer, or from one, that stop is inside the modal's scope,
    // not behind it. The trail is out of reach all the same.
    it('back() does not reach a stop recorded in a layer that is open again as a modal layer', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        const manual = layerWith('manual');
        const field  = controlIn(manual.element);

        register(manual.layer);
        focusIn(field);
        focusIn(a); // [a, field, a*]
        LayerManager.unregister(manual.layer);

        const reopened: DismissableLayer = {
            getLayerElement: () => manual.element,
            getDismissMode:  () => 'modal',
            requestClose:    () => {},
        };

        register(reopened);
        focusIn(field);

        expect(FocusHistory.back()).toBe(false);
        expect(FocusHistory.forward()).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(field);

        // The trail is as the modal found it: the current stop is still `a`.
        LayerManager.unregister(reopened);

        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('back() does not reach a stop recorded in a layer that is open again from a modal layer', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        const manual = layerWith('manual');
        const field  = controlIn(manual.element);

        register(manual.layer);
        focusIn(field);
        focusIn(a); // [a, field, a*]
        LayerManager.unregister(manual.layer);

        const modal   = layerWith('modal');
        const control = controlIn(modal.element);

        register(modal.layer);
        // No anchor, so it links under the modal layer and is in its scope.
        register(manual.layer);
        focusIn(control);

        expect(LayerManager.isBehindModal(field)).toBe(false);
        expect(FocusHistory.back()).toBe(false);
        expect(DOM.source.getActiveElement()).toBe(control);
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
        // now-current active element, `c`). Focus has left the current stop,
        // so the first back() returns to it and the second goes on to `a`
        // (focus-history-transient-layers plan, case W9).
        expect(FocusHistory.canGoBack()).toBe(true);
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(b);
        expect(FocusHistory.back()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('does not record a focusin landing inside a table cell, while a plain element still records', () => {
        installTestDOM(CONFIG);
        FocusHistory.enable();

        const a = liveHandle();
        focusIn(a);

        const td = DOM.sink.createElement('td');
        setConnected(td, true);
        const cellInput = DOM.sink.createElement('div'); // an in-cell editor's inner control
        DOM.sink.appendChild(td, cellInput);
        setConnected(cellInput, true);

        focusIn(cellInput); // lands inside a <td> — must not be recorded

        expect(FocusHistory.canGoBack()).toBe(false); // trail still just [a]

        const b = liveHandle();
        focusIn(b); // a plain element — still records

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

    // focus-history-transient-layers plan, cases S1–S13. A stop is a place
    // that stays: a control of the page, of a window, of a non-modal drawer.
    // A transient layer (a menu, a dropdown, a popover) and a modal layer (a
    // dialog, a modal drawer) are gone once closed, so nothing in one is
    // recorded.
    describe('what is recorded', () => {
        const transientModes: LayerDismissMode[] = ['click-outside', 'blur'];

        it.each(transientModes)('S1/S2: a control inside a "%s" layer is not a stop', (mode) => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            const transient = layerWith(mode);

            register(transient.layer);
            focusIn(controlIn(transient.element));

            expect(FocusHistory.canGoBack()).toBe(false);

            LayerManager.unregister(transient.layer);

            const b = liveHandle();
            focusIn(b);

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('S3: a control inside a "manual" layer is a stop', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            const manual = layerWith('manual');

            register(manual.layer);
            focusIn(controlIn(manual.element));

            expect(FocusHistory.canGoBack()).toBe(true);
            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('S4: nothing is a stop while a modal layer is open, inside it or not', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            const modal = layerWith('modal');

            register(modal.layer);
            focusIn(controlIn(modal.element));

            expect(FocusHistory.canGoBack()).toBe(false);

            // An element in no layer at all: a field application code appended
            // to the document by hand, which a modal does not make inert.
            focusIn(liveHandle());

            expect(FocusHistory.canGoBack()).toBe(false);
        });

        it('S6: a control of a "manual" layer opened from a modal layer is not a stop', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            const modal  = layerWith('modal');
            const manual = layerWith('manual');

            register(modal.layer);
            register(manual.layer);
            focusIn(controlIn(manual.element));

            expect(FocusHistory.canGoBack()).toBe(false);
        });

        it('S7: opening and closing a transient layer keeps the forward part of the trail', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);
            const c = liveHandle();
            focusIn(c);

            FocusHistory.back(); // [a, b*, c]

            const transient = layerWith('click-outside');

            register(transient.layer);
            focusIn(controlIn(transient.element));

            // A menu returns focus to its invoker before it unregisters.
            focusIn(b);
            LayerManager.unregister(transient.layer);

            expect(FocusHistory.canGoForward()).toBe(true);
            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(c);
        });

        it('S8: opening and closing a modal layer keeps the forward part of the trail', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);
            const c = liveHandle();
            focusIn(c);

            FocusHistory.back(); // [a, b*, c]

            const modal = layerWith('modal');

            register(modal.layer);
            focusIn(controlIn(modal.element));

            // A dialog unregisters before it returns focus to its opener.
            LayerManager.unregister(modal.layer);
            focusIn(b);

            expect(FocusHistory.canGoForward()).toBe(true);
            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(c);
        });

        it('S9: the control that opened a transient layer is in the trail once', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            const transient = layerWith('click-outside');

            register(transient.layer);
            focusIn(controlIn(transient.element));
            focusIn(b);
            LayerManager.unregister(transient.layer);

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
            expect(FocusHistory.canGoBack()).toBe(false);
        });

        it.each(['body', 'html'])('S10: enable() does not seed the trail with <%s>', (tag) => {
            installTestDOM(CONFIG);

            // What a browser reports as the focused element when nothing has
            // focus. The modelled DOM mints a new handle on each getBody()
            // call, so the case builds its own.
            const root = DOM.sink.createElement(tag);

            setConnected(root, true);
            DOM.sink.focus(root);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            expect(FocusHistory.canGoBack()).toBe(false);
        });

        const closingModes: LayerDismissMode[] = ['modal', 'click-outside'];

        it.each(closingModes)('S11: enable() does not seed the trail with a control of a "%s" layer', (mode) => {
            installTestDOM(CONFIG);

            const open    = layerWith(mode);
            const control = controlIn(open.element);

            register(open.layer);
            DOM.sink.focus(control);
            FocusHistory.enable();
            LayerManager.unregister(open.layer);

            const a = liveHandle();
            focusIn(a);

            expect(FocusHistory.canGoBack()).toBe(false);
        });

        it('S12: a focus move into a transient layer fires no "change"', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const changes: FocusHistoryChange[] = [];
            const listener = (c: FocusHistoryChange): void => { changes.push(c); };
            FocusHistory.on('change', listener);

            const a = liveHandle();
            focusIn(a);

            const transient = layerWith('click-outside');

            register(transient.layer);
            focusIn(controlIn(transient.element));

            expect(changes).toEqual([{ canGoBack: false, canGoForward: false }]);

            FocusHistory.off('change', listener);
        });

        it('S13: a page control focused from an open transient layer is a stop', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            const transient = layerWith('click-outside');

            register(transient.layer);
            focusIn(controlIn(transient.element));

            // A menu row's action focuses a field of the page.
            const f = liveHandle();
            focusIn(f);

            expect(DOM.source.getActiveElement()).toBe(f);
            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);

            // Going back lands on `b` whether or not `f` was recorded: an
            // unrecorded `f` would have left `b` the current stop. Only the
            // way forward again shows that `f` is in the trail.
            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(f);
        });

        it('enable() does not seed the trail with a control inside a table cell', () => {
            installTestDOM(CONFIG);

            const td = DOM.sink.createElement('td');

            setConnected(td, true);

            const cellEditor = controlIn(td);

            DOM.sink.focus(cellEditor);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            expect(FocusHistory.canGoBack()).toBe(false);
        });
    });

    // Cases K1–K4. The accelerators stand down while any modal or transient
    // layer is open, and leave the key to the application; the two modal cases
    // are further up.
    describe('the accelerators while a layer is open', () => {
        const transientModes: LayerDismissMode[] = ['click-outside', 'blur'];

        it.each(transientModes)('K1/K2: Alt+[ does nothing while a "%s" layer is open', (mode) => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            register(layerWith(mode).layer);

            const event = altBracketLeft();

            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopPropagation).not.toHaveBeenCalled();
            expect(DOM.source.getActiveElement()).toBe(b);
        });

        it.each(transientModes)('Alt+] does nothing while a "%s" layer is open', (mode) => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            FocusHistory.back(); // [a*, b]
            register(layerWith(mode).layer);

            const event = keyDown({ code: 'BracketRight', altKey: true });

            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopPropagation).not.toHaveBeenCalled();
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('K3: Alt+[ walks the trail while only a "manual" layer is open', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            register(layerWith('manual').layer);

            const event = altBracketLeft();

            expect(event.preventDefault).toHaveBeenCalled();
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('K4: Alt+[ walks the trail again once the transient layer has closed', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            const transient = layerWith('click-outside');

            register(transient.layer);

            const whileOpen = altBracketLeft();

            expect(whileOpen.preventDefault).not.toHaveBeenCalled();
            expect(DOM.source.getActiveElement()).toBe(b);

            LayerManager.unregister(transient.layer);

            const afterClose = altBracketLeft();

            expect(afterClose.preventDefault).toHaveBeenCalled();
            expect(DOM.source.getActiveElement()).toBe(a);
        });
    });

    // Cases W1–W8. Focus can sit on something that is no stop: a table cell, a
    // control of a layer, or <body> after the focused control was removed.
    // Going back from there returns to the current stop first.
    describe('walking when focus has left the current stop', () => {
        it('W1: back() returns to the current stop first, then to the one before', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            focusSilently(liveHandle());

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('W2: back() lands on the stop before one that was removed while it had focus', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);
            const d = liveHandle();
            focusIn(d);

            setConnected(d, false);
            focusSilently(liveHandle());

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
        });

        it('W3: forward() still goes to the stop after the current one', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            FocusHistory.back(); // [a*, b]
            focusSilently(liveHandle());

            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
        });

        // The fourth row of the plan's "Going back" table: the current stop is
        // not the last one, and returning to it keeps what lies ahead.
        it('back() returns to a current stop that is not the last one, and keeps the forward part', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            FocusHistory.back(); // [a*, b]
            focusSilently(liveHandle());

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
            expect(FocusHistory.canGoBack()).toBe(false);
            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
        });

        // "change" fires after every navigation, also one that returns to the
        // current stop. The position did not move, so the flags are the same.
        it('back() to the current stop fires "change" with the flags unchanged', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            focusSilently(liveHandle());

            const changes: FocusHistoryChange[] = [];
            const listener = (c: FocusHistoryChange): void => { changes.push(c); };
            FocusHistory.on('change', listener);

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
            expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);

            FocusHistory.off('change', listener);
        });

        it('W4: back() returns to a single stop, though canGoBack() describes the trail and is false', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);

            focusSilently(liveHandle());

            expect(FocusHistory.canGoBack()).toBe(false);
            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });

        it('W8: back() is not held back by an open transient layer', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);

            register(layerWith('click-outside').layer);

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });
    });

    // Cases W5–W7. A stop that left the document between two visits to one
    // control would leave that control in the trail twice in a row.
    describe('a stop repeated next to itself', () => {
        it('W5: is merged when the stop between the two visits is gone', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const x = liveHandle();
            focusIn(x);
            focusIn(a);

            setConnected(x, false);

            expect(FocusHistory.back()).toBe(false);
            expect(DOM.source.getActiveElement()).toBe(a);
            expect(FocusHistory.canGoBack()).toBe(false);
        });

        it('W6: is merged ahead of the current stop too', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const x = liveHandle();
            focusIn(x);
            focusIn(a);
            const c = liveHandle();
            focusIn(c);

            FocusHistory.back();
            FocusHistory.back();
            FocusHistory.back(); // [a*, x, a, c]

            expect(DOM.source.getActiveElement()).toBe(a);

            setConnected(x, false);

            expect(FocusHistory.forward()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(c);
        });

        it('W7: is kept when a live stop lies between the two visits', () => {
            installTestDOM(CONFIG);
            FocusHistory.enable();

            const a = liveHandle();
            focusIn(a);
            const b = liveHandle();
            focusIn(b);
            focusIn(a);

            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(b);
            expect(FocusHistory.back()).toBe(true);
            expect(DOM.source.getActiveElement()).toBe(a);
        });
    });
});
