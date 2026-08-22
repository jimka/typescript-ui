// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Regression coverage for the `.pressed`-class redesign that replaced native
// `:active` (see Button.ts:377-388): the pressed state is now entirely
// JS-driven off real pointerdown/pointerover/pointerout/pointerup/
// pointercancel/mousedown/keydown/keyup/blur delivery, so it needs the real
// dispatcher rather than calling private handlers directly — a
// private-handler-only test would never have caught the primary-button-
// filtering regressions this class was built to fix, nor the drag-away-to-
// cancel regression a `setPointerCapture`-based tracking mechanism caused
// (see the plan at plans/in-progress/primary-button-interaction-filtering.md
// / plans/implemented/ once landed).
//
// Event.ts keeps module-level listener state that DOM.reset() does not
// clear (see Button.test.ts's "Button action listener registration"
// comment): `installBaseListener` only attaches its native window listener
// on a type's first registration, and that installation is not undone
// between tests. Every scenario below therefore lives in ONE test sharing
// ONE installTestDOM() window — a second test creating a fresh window would
// silently receive nothing for a type Event.ts already believes installed.
import { describe, it, expect, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { SplitButton } from '~/component/button/SplitButton';
import { TabButton } from '~/component/button/TabButton';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** True when `w` is an `addClass`/`removeClass` write touching the "pressed"
 *  token — `setStyleState` (core/Component.ts) toggles a state's DOM token
 *  via `addClass`/`removeClass`, not the `toggleClass` shape this file used
 *  to check. */
function touchesPressed(w: RecordingDOMSink['writes'][number]): boolean {
    if (w.op !== 'apply') {
        return false;
    }

    const patch = w.args[1] as { addClass?: readonly string[]; removeClass?: readonly string[] };

    return !!(patch.addClass?.includes('pressed') || patch.removeClass?.includes('pressed'));
}

/** True when the last write touching the "pressed" token on `handle` added it
 *  (rather than removed it). */
function isPressed(sink: RecordingDOMSink, handle: Handle): boolean {
    const writes = sink.writes.filter(w => w.args[0] === handle && touchesPressed(w));
    const last = writes[writes.length - 1];
    const patch = last?.args[1] as { addClass?: readonly string[] } | undefined;

    return !!patch?.addClass?.includes('pressed');
}

/**
 * True when ANY write touching the "pressed" token has ever targeted
 * `handle`. Unlike {@link isPressed}, this distinguishes "never touched"
 * from "last write said false" — needed where the claim under test is that a
 * handle is never written to at all, which a plain `isPressed(...) === false`
 * check would pass vacuously for regardless of whether the code under test ran.
 */
function hasPressedWrite(sink: RecordingDOMSink, handle: Handle): boolean {
    return sink.writes.some(w => w.args[0] === handle && touchesPressed(w));
}

/** Number of `setPointerCapture` calls the sink has recorded so far, across all handles. */
function capturedPointerCount(sink: RecordingDOMSink): number {
    return sink.writes.filter(w => w.op === 'setPointerCapture').length;
}

/** Number of writes touching the "pressed" token the sink has recorded so far, across all handles. */
function pressedWriteCount(sink: RecordingDOMSink): number {
    return sink.writes.filter(touchesPressed).length;
}

/** Dispatches `type` on `handle` with `init`, returning the preventDefault call count. */
function dispatchCounting(handle: Handle, type: string, init: Parameters<typeof makeEvent>[2]): number {
    let prevents = 0;
    const evt = makeEvent(handle, type, init);
    (evt as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

    DOM.sink.dispatchEvent(handle, evt);

    return prevents;
}

describe('Button pressed state — real dispatcher delivery', () => {
    it('covers the primary/aux/keyboard/blur/boundary/descendant press matrix', () => {
        const sink = installTestDOM(CONFIG);

        // No pointer capture is ever acquired by the redesigned press
        // tracking — checked once up front and re-checked at points where a
        // capture-based design would have called it, so a regression back to
        // `setPointerCapture` shows up immediately rather than only in the
        // one spot a prior version of this test happened to check.
        expect(capturedPointerCount(sink)).toBe(0);

        // --- primary press sets .pressed; release clears it ---
        const btn = new Button('Save');
        const el  = btn.getElement(true)!;

        DOM.sink.dispatchEvent(el, makeEvent(el, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, el)).toBe(true);
        expect(capturedPointerCount(sink)).toBe(0);

        DOM.sink.dispatchEvent(el, makeEvent(el, 'pointerup', { button: 0, pointerId: 1 }));
        expect(isPressed(sink, el)).toBe(false);

        // --- pointercancel also clears a held press ---
        DOM.sink.dispatchEvent(el, makeEvent(el, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, el)).toBe(true);

        DOM.sink.dispatchEvent(el, makeEvent(el, 'pointercancel', { button: 0, pointerId: 1 }));
        expect(isPressed(sink, el)).toBe(false);

        // --- a right- or middle-click pointerdown never shows the pressed
        // visual, and neither must preventDefault a pointerdown — that would
        // suppress its synthesized mousedown compatibility event, which
        // Tooltip.hide() and AbstractWindow's bring-to-front depend on for a
        // non-primary press landing on a descendant Button.
        const rightPointerdownPrevents  = dispatchCounting(el, 'pointerdown', { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
        expect(isPressed(sink, el)).toBe(false);
        expect(rightPointerdownPrevents).toBe(0);

        const middlePointerdownPrevents = dispatchCounting(el, 'pointerdown', { button: 1, pointerId: 1, clientX: 0, clientY: 0 });
        expect(isPressed(sink, el)).toBe(false);
        expect(middlePointerdownPrevents).toBe(0);

        // --- a right-click mousedown is left alone (no autoscroll concern
        // for the right button, and Tooltip/AbstractWindow's own button:"any"
        // mousedown listeners must still see it fire).
        const rightMousedownPrevents = dispatchCounting(el, 'mousedown', { button: 2, clientX: 0, clientY: 0 });
        expect(rightMousedownPrevents).toBe(0);

        // --- a middle-click MOUSEDOWN (not pointerdown) is where the
        // autoscroll-icon default is actually suppressed — preventDefault()
        // on a plain mousedown carries no compatibility-event side effect, so
        // this doesn't stop Tooltip/AbstractWindow's own mousedown listeners
        // from also seeing the same event.
        const middleMousedownPrevents = dispatchCounting(el, 'mousedown', { button: 1, clientX: 0, clientY: 0 });
        expect(middleMousedownPrevents).toBe(1);

        // --- held Space sets .pressed; keyup clears it ---
        DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key: ' ' }));
        expect(isPressed(sink, el)).toBe(true);

        DOM.sink.dispatchEvent(el, makeEvent(el, 'keyup', { key: ' ' }));
        expect(isPressed(sink, el)).toBe(false);

        // --- focus leaving mid-hold (Tab, alt-tab, …) also clears it — native
        // `:active`, which .pressed replaces, clears on blur; `_onSpaceUp`
        // alone only fires on a matching keyup, which never comes here.
        DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key: ' ' }));
        expect(isPressed(sink, el)).toBe(true);

        DOM.sink.dispatchEvent(el, makeEvent(el, 'blur', {}));
        expect(isPressed(sink, el)).toBe(false);

        // --- boundary tracking: dragging off the button clears the visual
        // without ending the press, and dragging back on restores it — this
        // is the core drag-away-to-cancel mechanism, since a release outside
        // never re-shows .pressed and native `click` computation (unmodified
        // by this design) refuses to fire for it. A `pointerout` whose
        // `relatedTarget` is a descendant of the button (an internal move,
        // not a boundary crossing) must produce no write at all.
        const boundaryBtn = new Button('Boundary');
        const boundaryEl  = boundaryBtn.getElement(true)!;
        const outsideEl   = new Button('Elsewhere').getElement(true)!;

        DOM.sink.dispatchEvent(boundaryEl, makeEvent(boundaryEl, 'pointerdown', { button: 0, pointerId: 7, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, boundaryEl)).toBe(true);

        DOM.sink.dispatchEvent(boundaryEl, makeEvent(boundaryEl, 'pointerout', { pointerId: 7, relatedTarget: outsideEl }));
        expect(isPressed(sink, boundaryEl)).toBe(false);

        const pressedWritesBeforeInternalMove = pressedWriteCount(sink);
        DOM.sink.dispatchEvent(boundaryEl, makeEvent(boundaryEl, 'pointerout', { pointerId: 7, relatedTarget: boundaryEl }));
        expect(hasPressedWrite(sink, boundaryEl)).toBe(true); // from the real leave above; this asserts no NEW write below
        expect(pressedWriteCount(sink)).toBe(pressedWritesBeforeInternalMove);

        DOM.sink.dispatchEvent(boundaryEl, makeEvent(boundaryEl, 'pointerover', { pointerId: 7, buttons: 1 }));
        expect(isPressed(sink, boundaryEl)).toBe(true);

        // --- stale-press recovery: the primary button was released outside
        // the browser window, so no pointerup ever reached the viewport
        // listener. The next pointerover on the button, seeing `buttons`
        // clear, heals it — and removes the now-stale viewport registrations.
        const removeListenerWritesBefore = sink.writes.filter(w => w.op === 'removeListener').length;
        DOM.sink.dispatchEvent(boundaryEl, makeEvent(boundaryEl, 'pointerover', { pointerId: 7, buttons: 0 }));
        expect(isPressed(sink, boundaryEl)).toBe(false);
        expect(sink.writes.filter(w => w.op === 'removeListener').length).toBeGreaterThan(removeListenerWritesBefore);

        // --- a distinct, still-held pointerId is unaffected by a different
        // pointerId's release — proves the pointerId gate is real rather than
        // passing by coincidence.
        const crossBtn = new Button('Cross');
        const crossEl  = crossBtn.getElement(true)!;

        DOM.sink.dispatchEvent(crossEl, makeEvent(crossEl, 'pointerdown', { button: 0, pointerId: 11, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, crossEl)).toBe(true);

        DOM.sink.dispatchEvent(crossEl, makeEvent(crossEl, 'pointerup', { button: 0, pointerId: 99 }));
        expect(isPressed(sink, crossEl)).toBe(true);

        DOM.sink.dispatchEvent(crossEl, makeEvent(crossEl, 'pointerup', { button: 0, pointerId: 11 }));
        expect(isPressed(sink, crossEl)).toBe(false);

        // --- a press landing on a descendant with its own re-enabled
        // pointer-events (SplitButton's chevron) now DOES set .pressed on
        // the containing button — subtree dispatch reproduces the ancestor-
        // bubbling native `:active` always showed for such a descendant, and
        // closing this previously-accepted gap costs nothing now that no
        // pointer capture is acquired to conflict with the chevron's own
        // independent click routing.
        const split     = new SplitButton('Save');
        const splitEl    = split.getElement(true)!;
        const chevronEl  = (split as unknown as { _chevron: { getElement(create?: boolean): Handle } })
            ._chevron.getElement(true);

        DOM.sink.dispatchEvent(chevronEl, makeEvent(chevronEl, 'pointerdown', { button: 0, pointerId: 21, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, splitEl)).toBe(true);
        expect(capturedPointerCount(sink)).toBe(0);

        DOM.sink.dispatchEvent(chevronEl, makeEvent(chevronEl, 'pointerup', { button: 0, pointerId: 21 }));
        expect(isPressed(sink, splitEl)).toBe(false);

        // --- a Button nested inside another Button's element (the close ✕
        // TabButton overlays on itself) now shows pressed on BOTH: each
        // Button instance tracks its own boundary state independently, with
        // no shared OS-level resource (like pointer capture) for the two to
        // conflict over, so subtree dispatch lets the ancestor's own tracking
        // see the descendant's press too — a return to :active's pre-branch
        // ancestor-bubbling behaviour, not a new regression.
        const tab      = new TabButton('Tab', { closeable: true });
        const tabEl    = tab.getElement(true)!;
        const closeEl  = tab.getCloseButton()!.getElement(true)!;

        DOM.sink.dispatchEvent(closeEl, makeEvent(closeEl, 'pointerdown', { button: 0, pointerId: 31, clientX: 0, clientY: 0 }));
        expect(isPressed(sink, closeEl)).toBe(true);
        expect(isPressed(sink, tabEl)).toBe(true);

        DOM.sink.dispatchEvent(closeEl, makeEvent(closeEl, 'pointerup', { button: 0, pointerId: 31 }));
        expect(isPressed(sink, closeEl)).toBe(false);
        expect(isPressed(sink, tabEl)).toBe(false);

        // No pointer capture was acquired anywhere in this whole scenario.
        expect(capturedPointerCount(sink)).toBe(0);

        // --- disposing mid-press purges the press-scoped viewport
        // registrations `_onPointerDown` added, via Component.destructor's
        // existing Event.purgeComponent call. Same shared window as every
        // other case above — a fresh installTestDOM() here would silently
        // receive no "pointerdown" delivery at all (see the file header).
        const disposableBtn = new Button('Disposable');
        const disposableEl  = disposableBtn.getElement(true)!;

        DOM.sink.dispatchEvent(disposableEl, makeEvent(disposableEl, 'pointerdown', { button: 0, pointerId: 41, clientX: 0, clientY: 0 }));
        expect(Event._registeredComponentIds()).toContain(disposableBtn.getId());

        disposableBtn.dispose();
        expect(Event._registeredComponentIds()).not.toContain(disposableBtn.getId());
    });
});
