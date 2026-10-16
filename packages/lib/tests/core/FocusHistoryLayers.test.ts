// @vitest-environment jsdom
//
// focus-history-transient-layers plan, cases J1–J4. Real components against
// the REAL production DOM source (the `jsdom` pragma keeps
// `tests/setup/node-setup.ts` from installing the modelled DOM, as in
// `FocusTraversalCompositeWidgets.test.ts`), where `element.focus()` fires
// `focusin`. The offline cases in `tests/unit/core/FocusHistory.test.ts` only
// model the order in which a layer registers, takes focus, unregisters and
// returns focus. These pin it for a real `Menu` and a real `Dialog`, and with
// it that opening and closing either leaves the trail as it was.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { FocusHistory } from '~/core/FocusHistory';
import { LayerManager } from '~/core/LayerManager';
import { Container } from '~/core/Container';
import { Button } from '~/component/button/Button';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { _Dialog as Dialog } from '~/overlay/Dialog';

let host: Container;
let a: Button;
let b: Button;
let c: Button;
// Built by a case, disposed by the teardown when the case did not get as far
// as closing it: a layer left registered would stop every later case's
// recording.
let menu:   Menu | null   = null;
let dialog: Dialog | null = null;

/** The real element a component rendered. */
function real(component: { getId(): string }): HTMLElement {
    return document.getElementById(component.getId())!;
}

/** Dispatches a real, cancellable `keydown` on `target` and returns it. */
function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

    target.dispatchEvent(event);

    return event;
}

/** Presses `Alt+[`, the default back chord, on the focused element. */
function altBracketLeft(): KeyboardEvent {
    return key(document.activeElement!, { code: 'BracketLeft', key: '[', altKey: true });
}

/**
 * Focuses `A`, `B`, `C` and steps back once, so the trail is `[A, B*, C]`
 * with focus on `B` and a forward part to lose.
 */
function walkToMiddle(): void {
    FocusHistory.enable();
    real(a).focus();
    real(b).focus();
    real(c).focus();
    FocusHistory.back();

    expect(document.activeElement).toBe(real(b));
    expect(FocusHistory.canGoForward()).toBe(true);
}

/**
 * Opens a context menu from the keyboard on `B`. The menu is built before the
 * key is dispatched: `Menu`'s watch for the last input starts with the first
 * menu built, and it is the key press that makes the menu take focus.
 */
function openMenuFromKeyboard(): Menu {
    const opened = new Menu();

    menu = opened;
    key(real(b), { key: 'F10', shiftKey: true });
    // (10, 10): any point of the viewport will do. A context menu is shown at
    // the pointer, and nothing here depends on where that is.
    opened.show(10, 10, [{ text: 'One' }, { text: 'Two' }]);

    return opened;
}

beforeEach(() => {
    host = new Container();
    a = new Button({ text: 'A' });
    b = new Button({ text: 'B' });
    c = new Button({ text: 'C' });
    host.addComponent(a);
    host.addComponent(b);
    host.addComponent(c);
    DOM.sink.appendChild(DOM.source.getBody(), host.getElement(true)!);
    a.getElement(true);
    b.getElement(true);
    c.getElement(true);
    host.flushLayout();
});

afterEach(() => {
    vi.useRealTimers();
    FocusHistory.disable();
    FocusHistory.clear();
    menu?.dispose();
    menu = null;
    dialog?.dispose();
    dialog = null;
    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();
    document.body.innerHTML = '';
});

describe('FocusHistory with a real menu and a real dialog', () => {
    it('J1: a keyboard-opened menu takes focus and leaves the forward part of the trail', () => {
        walkToMiddle();

        const opened = openMenuFromKeyboard();

        expect(document.activeElement).toBe(real(opened));
        expect(FocusHistory.canGoForward()).toBe(true);
    });

    it('J2: Alt+[ with the menu open moves nothing and leaves the key alone', () => {
        walkToMiddle();

        const opened = openMenuFromKeyboard();
        const event  = altBracketLeft();

        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(real(opened));
        expect(LayerManager.getTopLayer()).toBe(opened);
    });

    it('J3: Escape returns focus to the invoker, which is in the trail once', () => {
        walkToMiddle();
        openMenuFromKeyboard();

        key(document.activeElement!, { key: 'Escape' });

        expect(document.activeElement).toBe(real(b));
        expect(LayerManager.getTopLayer()).toBeNull();
        expect(FocusHistory.canGoForward()).toBe(true);

        expect(FocusHistory.back()).toBe(true);
        expect(document.activeElement).toBe(real(a));
    });

    it('J4: a dialog opened and closed leaves the trail as it was', async () => {
        vi.useFakeTimers();
        walkToMiddle();

        // The button is given without a glyph: a preset button carries one,
        // and placing a glyph measures the font on a canvas, which jsdom
        // does not have.
        const opened = new Dialog({ title: 'T', message: 'M', buttons: [{ text: 'OK', result: 'confirm' }] });

        dialog = opened;

        const closed = opened.show();

        // 500 ms: past the dialog's first layout, after which it takes focus.
        await vi.advanceTimersByTimeAsync(500);

        expect(real(opened).contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(real(b));
        expect(FocusHistory.canGoForward()).toBe(true);

        opened.hide('close');

        // 1000 ms: past the dialog's close animation, after which it
        // unregisters and returns focus to its opener.
        await vi.advanceTimersByTimeAsync(1000);
        await closed;

        // A dialog disposes itself as it closes, so the teardown has nothing
        // left to do for it.
        dialog = null;

        expect(LayerManager.hasModalLayer()).toBe(false);
        expect(document.activeElement).toBe(real(b));
        expect(FocusHistory.canGoForward()).toBe(true);

        expect(FocusHistory.back()).toBe(true);
        expect(document.activeElement).toBe(real(a));
    });
});
