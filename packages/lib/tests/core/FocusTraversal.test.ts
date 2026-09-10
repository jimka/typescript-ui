// FocusTraversal is a module singleton (mirrors FocusHistory/PanelNavigation),
// so every test disables it in afterEach. The keydown/focusin wiring is driven
// offline via DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(...)) —
// the recording sink invokes window-registered viewport listeners, so the real
// Event/FocusTraversal code runs unchanged (see FocusHistory.test.ts /
// PanelNavigation.test.ts, the precedents this mirrors). `getTabStops`'s
// candidates come from the seeded `querySelectorAll(root, FOCUSABLE_SELECTOR)`
// result — there is no real selector engine offline (see
// Border.panelNavigation.test.ts, which seeds the same way for `findFocusable`).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FocusTraversal } from '~/core/FocusTraversal';
import { FOCUSABLE_SELECTOR } from '~/core/Focusable';
import { DOM, type Handle } from '~/core/DOM';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { installTestDOM, setConnected, setQuerySelectorAllResult, setRenderedVisible, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

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

/** Marks `handle` disabled, read by `findFocusable`'s `hasAttribute` filter. */
function markDisabled(handle: Handle): void {
    DOM.sink.edit(handle).attr('disabled', 'true').commit();
}

/** Marks `handle` a Tab-key owner, mirroring `Component.setTabKeyOwner(true)`. */
function markTabKeyOwner(handle: Handle): void {
    DOM.sink.edit(handle).attr('data-ts-ui-tab-key-owner', 'true').commit();
}

/** Seeds `root`'s FOCUSABLE_SELECTOR match set to exactly `stops`, all connected and rendered. */
function seedStops(root: Handle, stops: Handle[]): void {
    setQuerySelectorAllResult(root, FOCUSABLE_SELECTOR, stops);
}

/**
 * `DOM.source.getBody()` mints a fresh stub handle on every offline call (there
 * is no live singleton `document.body` to hand back) — fine for production,
 * where the real body is always the same node, but the service resolves its
 * root fresh on every `getTabStops()`/`next()`/`previous()`/keydown call, so a
 * test that seeds against one `getBody()` result and later exercises one of
 * those needs every call within the test to agree. Pins it for the rest of the
 * test and returns the pinned handle.
 */
function stableBody(): Handle {
    const body = DOM.source.getBody();
    vi.spyOn(DOM.source, 'getBody').mockReturnValue(body);

    return body;
}

/** Dispatches a keydown through the window-registered viewport listeners; returns the event (with `preventDefault`/`stopPropagation` spied) so the disposition can be asserted. */
function dispatchKeyDown(init: { key: string; shiftKey?: boolean }): { preventDefault: () => void; stopPropagation: () => void } {
    const event = makeEvent(0 as Handle, 'keydown', {}) as unknown as { preventDefault: () => void; stopPropagation: () => void } & Record<string, unknown>;
    event.key = init.key;
    event.shiftKey = !!init.shiftKey;

    vi.spyOn(event, 'preventDefault');
    vi.spyOn(event, 'stopPropagation');
    DOM.sink.dispatchEvent(DOM.source.getWindow(), event as unknown as Event);

    return event;
}

/**
 * Dispatches a `focusin` at `target` through the window-registered viewport
 * listeners, mirroring `dispatchKeyDown`. `DOM.sink.focus()` alone does not
 * fire one offline (it only records the focused handle), so a test exercising
 * `onFocusIn` must dispatch this in addition to (immediately after) that call.
 */
function dispatchFocusIn(target: Handle): void {
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(target, 'focusin'));
}

afterEach(() => {
    FocusTraversal.disable();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('FocusTraversal.getTabStops', () => {
    it('returns document order for a flat container of three buttons', () => {
        installTestDOM(CONFIG);
        const root = liveHandle();
        const a = liveHandle(); const b = liveHandle(); const c = liveHandle();
        seedStops(root, [a, b, c]);

        expect(FocusTraversal.getTabStops(root)).toEqual([a, b, c]);
    });

    it('omits a disabled candidate', () => {
        installTestDOM(CONFIG);
        const root = liveHandle();
        const a = liveHandle(); const b = liveHandle();
        markDisabled(b);
        seedStops(root, [a, b]);

        expect(FocusTraversal.getTabStops(root)).toEqual([a]);
    });

    it('omits a candidate under a display:none / visibility:hidden ancestor', () => {
        installTestDOM(CONFIG);
        const root = liveHandle();
        const a = liveHandle(); const hiddenAncestor = liveHandle(); const b = liveHandle();
        setRenderedVisible(hiddenAncestor, false);
        DOM.sink.appendChild(hiddenAncestor, b);
        seedStops(root, [a, b]);

        expect(FocusTraversal.getTabStops(root)).toEqual([a]);
    });

    it('with no layer registered, the root is <body>; with a modal layer registered, the root is that layer\'s element', () => {
        installTestDOM(CONFIG);
        const body = stableBody();
        const bodyStop = liveHandle();
        seedStops(body, [bodyStop]);

        expect(FocusTraversal.getTabStops()).toEqual([bodyStop]);

        const layerEl = liveHandle();
        const modalStop = liveHandle();
        seedStops(layerEl, [modalStop]);

        const modal: DismissableLayer = { getLayerElement: () => layerEl, getDismissMode: () => 'modal', requestClose: () => {} };
        LayerManager.register(modal);

        expect(FocusTraversal.getTabStops()).toEqual([modalStop]);

        LayerManager.unregister(modal);
    });
});

describe('FocusTraversal.next / previous', () => {
    it('next() from the last stop returns false on a <body> root and wraps to the first stop on a modal root', () => {
        installTestDOM(CONFIG);
        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);
        DOM.sink.focus(b);

        expect(FocusTraversal.next()).toBe(false);

        const layerEl = liveHandle();
        seedStops(layerEl, [a, b]);
        DOM.sink.focus(b);

        const modal: DismissableLayer = { getLayerElement: () => layerEl, getDismissMode: () => 'modal', requestClose: () => {} };
        LayerManager.register(modal);

        expect(FocusTraversal.next()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);

        LayerManager.unregister(modal);
    });

    it('previous() moves focus backward from the active stop', () => {
        installTestDOM(CONFIG);
        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);
        DOM.sink.focus(b);

        expect(FocusTraversal.previous()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('next() with nothing focused lands on the first stop', () => {
        installTestDOM(CONFIG);
        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);

        expect(FocusTraversal.next()).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(a);
    });
});

describe('FocusTraversal keydown arbitration', () => {
    it('Tab outside an owner moves focus and calls preventDefault', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);
        DOM.sink.focus(a);

        const event = dispatchKeyDown({ key: 'Tab' });

        expect(DOM.source.getActiveElement()).toBe(b);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('Tab at the last stop of an unclaimed <body> root does not preventDefault, letting the browser move focus to its own chrome', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);
        DOM.sink.focus(b);

        const event = dispatchKeyDown({ key: 'Tab' });

        expect(DOM.source.getActiveElement()).toBe(b); // unchanged
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('Tab inside an owner does nothing — the owner keeps the key', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const owner = liveHandle();
        markTabKeyOwner(owner);
        const inside = liveHandle();
        DOM.sink.appendChild(owner, inside);
        seedStops(body, [inside]);
        DOM.sink.focus(inside);

        dispatchKeyDown({ key: 'Tab' });

        expect(DOM.source.getActiveElement()).toBe(inside);
    });

    it('Escape inside an owner sets the release flag without moving focus; the next Tab then moves focus past the owner\'s element', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const before = liveHandle();
        const owner = liveHandle();
        const inside = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, inside);
        markTabKeyOwner(owner);
        seedStops(body, [before, inside, after]);
        DOM.sink.focus(inside);

        const escapeEvent = dispatchKeyDown({ key: 'Escape' });
        expect(DOM.source.getActiveElement()).toBe(inside); // unchanged
        // LayerManager owns Escape (it closes the topmost non-modal layer on
        // it); the service must never preventDefault it, or an Escape inside
        // an editor nested in a dialog would stop closing the dialog too.
        expect(escapeEvent.preventDefault).not.toHaveBeenCalled();

        dispatchKeyDown({ key: 'Tab' });
        expect(DOM.source.getActiveElement()).toBe(after);
    });

    it('Escape release falls back to the first stop of the root when the owner contains no focusable stop of its own (the CodeEditor/MarkdownEditor case)', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const before = liveHandle();
        const owner = liveHandle();
        // Focused, but not itself a seeded stop — mirrors CodeMirror's
        // .cm-content, which FOCUSABLE_SELECTOR never matches (see the plan's
        // Implementation Notes), so `owner` has no focusable descendant that
        // stopAfterOwner's DOM-order scan can find.
        const insideNonStop = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, insideNonStop);
        markTabKeyOwner(owner);
        seedStops(body, [before, after]); // neither stop is inside `owner`
        DOM.sink.focus(insideNonStop);

        dispatchKeyDown({ key: 'Escape' });
        dispatchKeyDown({ key: 'Tab' });

        expect(DOM.source.getActiveElement()).toBe(before);
    });

    it('Shift+Tab release falls back to the last stop of the root when the owner contains no focusable stop of its own', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const before = liveHandle();
        const owner = liveHandle();
        const insideNonStop = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, insideNonStop);
        markTabKeyOwner(owner);
        seedStops(body, [before, after]);
        DOM.sink.focus(insideNonStop);

        dispatchKeyDown({ key: 'Escape' });
        dispatchKeyDown({ key: 'Tab', shiftKey: true });

        expect(DOM.source.getActiveElement()).toBe(after);
    });

    it('a focusin that stays inside the same owner (a cell editor cancelling back to the body, say) does not clear the release — the next Tab still consumes it', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const before = liveHandle();
        const owner = liveHandle();
        const inside = liveHandle();
        const stillInside = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, inside);
        DOM.sink.appendChild(owner, stillInside);
        markTabKeyOwner(owner);
        seedStops(body, [before, inside, stillInside, after]);
        DOM.sink.focus(inside);

        dispatchKeyDown({ key: 'Escape' });

        // Focus moves elsewhere within the SAME owner — e.g. Table's cell
        // editor cancel path re-focusing the body — before the user gets to
        // press Tab.
        DOM.sink.focus(stillInside);
        dispatchFocusIn(stillInside);

        dispatchKeyDown({ key: 'Tab' });
        expect(DOM.source.getActiveElement()).toBe(after);
    });

    it('a focusin to an element outside the owner clears the release — a subsequent Tab is treated as unarmed', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const owner = liveHandle();
        const inside = liveHandle();
        const outside = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, inside);
        markTabKeyOwner(owner);
        seedStops(body, [inside, outside, after]);
        DOM.sink.focus(inside);

        dispatchKeyDown({ key: 'Escape' });

        // Focus moves outside the owner by some other means (a mouse click,
        // say) before Tab is pressed.
        DOM.sink.focus(outside);
        dispatchFocusIn(outside);

        dispatchKeyDown({ key: 'Tab' });
        expect(DOM.source.getActiveElement()).toBe(after); // ordinary next-stop from `outside`, not owner-relative
    });

    it('Shift+Tab after the release flag moves focus to the last stop before the owner\'s element', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const before = liveHandle();
        const owner = liveHandle();
        const inside = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, inside);
        markTabKeyOwner(owner);
        seedStops(body, [before, inside, after]);
        DOM.sink.focus(inside);

        dispatchKeyDown({ key: 'Escape' });
        // A real Shift+Tab keystroke fires two keydowns — the bare Shift key
        // first, then Tab with shiftKey: true — so the release must survive
        // the Shift keydown on its own, not just a synthetic combined event.
        dispatchKeyDown({ key: 'Shift' });
        dispatchKeyDown({ key: 'Tab', shiftKey: true });

        expect(DOM.source.getActiveElement()).toBe(before);
    });

    it('any other key clears a pending release flag', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const body = stableBody();
        const owner = liveHandle();
        const inside = liveHandle();
        const after = liveHandle();
        DOM.sink.appendChild(owner, inside);
        markTabKeyOwner(owner);
        seedStops(body, [inside, after]);
        DOM.sink.focus(inside);

        dispatchKeyDown({ key: 'Escape' });
        dispatchKeyDown({ key: 'ArrowDown' }); // expires the release

        dispatchKeyDown({ key: 'Tab' });
        expect(DOM.source.getActiveElement()).toBe(inside); // owner kept it — flag was gone
    });

    it('disable() leaves a subsequent Tab entirely unhandled', () => {
        installTestDOM(CONFIG);
        FocusTraversal.enable();

        const a = liveHandle(); const b = liveHandle();
        const body = stableBody();
        seedStops(body, [a, b]);
        DOM.sink.focus(a);

        FocusTraversal.disable();
        dispatchKeyDown({ key: 'Tab' });

        expect(DOM.source.getActiveElement()).toBe(a);
    });
});

describe('FocusTraversal.isEnabled', () => {
    it('is false until enable() and true after; disable() flips it back', () => {
        installTestDOM(CONFIG);
        expect(FocusTraversal.isEnabled()).toBe(false);
        FocusTraversal.enable();
        expect(FocusTraversal.isEnabled()).toBe(true);
        FocusTraversal.disable();
        expect(FocusTraversal.isEnabled()).toBe(false);
    });
});
