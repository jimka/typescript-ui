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
//
// focus-history-can-go-back-follows-focus plan, cases J5–J9, and J10 and J11
// from its review: the two flags and `"change"` against the focus events
// jsdom fires by itself, and against the order in which a real `Dialog`,
// `PopupPanel`, `Menu` and `Popover` register, move focus and unregister.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { FocusHistory, type FocusHistoryChange } from '~/core/FocusHistory';
import { LayerManager } from '~/core/LayerManager';
import { Container } from '~/core/Container';
import { Button } from '~/component/button/Button';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { PopupPanel } from '~/overlay/PopupPanel';
import { Popover } from '~/overlay/Popover';

let host: Container;
let a: Button;
let b: Button;
let c: Button;
// Built by a case, disposed by the teardown when the case did not get as far
// as closing it: a layer left registered would stop every later case's
// recording.
let menu:   Menu | null       = null;
let dialog: Dialog | null     = null;
let panel:  PopupPanel | null = null;
// Every popover a case opened; one that a focus move closed is still disposed
// by the teardown.
const popovers: Popover[] = [];
// The payloads `collect` has received in the running case.
let changes: FocusHistoryChange[] = [];

/** The shared `"change"` listener; the teardown unsubscribes it. */
function collect(change: FocusHistoryChange): void {
    changes.push(change);
}

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

/**
 * Opens a popover of dismiss mode `dismissOn` from `A`. A `"blur"` one is
 * closed by `LayerManager`'s own `focusin` handler, in the middle of the
 * focus move that leaves it.
 */
function openPopoverFromA(dismissOn: 'blur' | 'manual'): Popover {
    // jsdom lays nothing out, and a popover whose anchor has an empty rect
    // closes at once. (10, 10) and 50 x 20: any rect with an area will do.
    real(a).getBoundingClientRect = (): DOMRect => new DOMRect(10, 10, 50, 20);

    const opened = new Popover({ dismissOn, showArrow: false });

    popovers.push(opened);
    opened.attachToComponent(a);
    opened.show();

    return opened;
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
    changes = [];
});

afterEach(() => {
    vi.useRealTimers();
    FocusHistory.off('change', collect);
    FocusHistory.disable();
    FocusHistory.clear();
    menu?.dispose();
    menu = null;
    dialog?.dispose();
    dialog = null;
    panel?.dispose();
    panel = null;

    for (const popover of popovers) {
        popover.dispose();
    }

    popovers.length = 0;
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
        // No walk starts while the dialog is open, so both flags are false.
        expect(FocusHistory.canGoBack()).toBe(false);
        expect(FocusHistory.canGoForward()).toBe(false);

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

describe('FocusHistory flags and "change" with real focus events and real layers', () => {
    it('J5: a blur from code fires "change" for the single stop focus has left', () => {
        FocusHistory.enable();
        real(a).focus();
        FocusHistory.on('change', collect);

        real(a).blur();

        expect(document.activeElement).toBe(document.body);
        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);

        expect(FocusHistory.back()).toBe(true);
        expect(document.activeElement).toBe(real(a));

        expect(changes).toEqual([
            { canGoBack: true,  canGoForward: false },
            { canGoBack: false, canGoForward: false },
        ]);
    });

    it('J6: a dialog turns both flags false as it opens, and gives them back as it closes', async () => {
        vi.useFakeTimers();
        walkToMiddle();
        FocusHistory.on('change', collect);

        // Without a glyph, as in J4.
        const opened = new Dialog({ title: 'T', message: 'M', buttons: [{ text: 'OK', result: 'confirm' }] });

        dialog = opened;

        const closed = opened.show();

        // Before any timer has run: the dialog has registered and has not
        // taken focus yet, so no focus event stands behind this.
        expect(changes).toEqual([{ canGoBack: false, canGoForward: false }]);

        // 500 ms: past the dialog's first layout, after which it takes focus.
        await vi.advanceTimersByTimeAsync(500);

        expect(FocusHistory.canGoBack()).toBe(false);
        expect(FocusHistory.canGoForward()).toBe(false);

        opened.hide('close');

        // 1000 ms: past the dialog's close animation, after which it
        // unregisters and returns focus to its opener.
        await vi.advanceTimersByTimeAsync(1000);
        await closed;

        dialog = null;

        expect(document.activeElement).toBe(real(b));

        expect(changes).toEqual([
            { canGoBack: false, canGoForward: false },
            { canGoBack: true,  canGoForward: true },
        ]);
    });

    // The case only the layer watch can pass: jsdom fires no focus event when
    // the dialog's element leaves the document, and with the opener gone no
    // focus move follows the close.
    it('J7: a dialog whose opener was removed while it was open still fires "change" as it closes', async () => {
        vi.useFakeTimers();
        FocusHistory.enable();
        real(a).focus();
        real(b).focus();
        FocusHistory.on('change', collect);

        // Without a glyph, as in J4.
        const opened = new Dialog({ title: 'T', message: 'M', buttons: [{ text: 'OK', result: 'confirm' }] });

        dialog = opened;

        const closed = opened.show();

        // 500 ms: past the dialog's first layout, after which it takes focus.
        await vi.advanceTimersByTimeAsync(500);

        host.removeComponent(b);
        b.dispose();

        opened.hide('close');

        // 1000 ms: past the dialog's close animation, after which it
        // unregisters and finds no opener to return focus to.
        await vi.advanceTimersByTimeAsync(1000);
        await closed;

        dialog = null;

        expect(document.activeElement).toBe(document.body);
        expect(FocusHistory.canGoBack()).toBe(true);

        expect(changes).toEqual([
            { canGoBack: false, canGoForward: false },
            { canGoBack: true,  canGoForward: false },
        ]);

        expect(FocusHistory.back()).toBe(true);
        expect(document.activeElement).toBe(real(a));
    });

    it('J8: a popup panel closed with focus inside it leaves canGoBack() true', async () => {
        vi.useFakeTimers();
        FocusHistory.enable();
        real(a).focus();
        FocusHistory.on('change', collect);

        const apply = new Button({ text: 'Apply' });

        // 120 x 60: room for the one button. The size plays no part in what
        // the case asserts; a panel needs one to lay out.
        const opened = new PopupPanel({ components: [apply], preferredSize: { width: 120, height: 60 } });

        panel = opened;

        const opener = DOM.source.intern(real(a));

        opened.toggleFor(opener, DOM.source.getElementRect(opener));

        // 500 ms: past the panel's opening animation.
        await vi.advanceTimersByTimeAsync(500);

        // A panel takes no focus as it opens, and a transient layer changes
        // neither flag.
        expect(document.activeElement).toBe(real(a));
        expect(changes).toEqual([]);

        real(apply).focus();

        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);

        opened.hideAnimated();

        // 1000 ms: past the panel's closing animation, after which it
        // unregisters. It does not return focus to its opener.
        await vi.advanceTimersByTimeAsync(1000);

        expect(document.activeElement).toBe(document.body);
        expect(LayerManager.getTopLayer()).toBeNull();
        expect(FocusHistory.canGoBack()).toBe(true);
        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);

        expect(FocusHistory.back()).toBe(true);
        expect(document.activeElement).toBe(real(a));

        expect(changes).toEqual([
            { canGoBack: true,  canGoForward: false },
            { canGoBack: false, canGoForward: false },
        ]);
    });

    it('J9: canGoBack() is true under a keyboard-opened menu, though the menu takes focus back from back()', () => {
        FocusHistory.enable();
        real(b).focus();
        FocusHistory.on('change', collect);

        const opened = openMenuFromKeyboard();

        expect(document.activeElement).toBe(real(opened));
        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);

        // The menu's keyboard session holds focus: the stop is counted, and
        // refuses.
        expect(FocusHistory.back()).toBe(false);
        expect(document.activeElement).toBe(real(opened));

        key(document.activeElement!, { key: 'Escape' });

        expect(document.activeElement).toBe(real(b));

        expect(changes).toEqual([
            { canGoBack: true,  canGoForward: false },
            { canGoBack: false, canGoForward: false },
        ]);
    });

    // J10 and J11 are beyond the plan's cases, found by its review. A "blur"
    // popover unregisters inside the focus move that closes it. That is no
    // modal layer opening or closing, so the move alone reports the flags.
    it('J10: a walk that closes a "blur" popover fires "change" once', () => {
        FocusHistory.enable();
        real(a).focus();
        real(b).focus();
        FocusHistory.back(); // [A*, B]

        const opened = openPopoverFromA('blur');

        expect(LayerManager.getTopLayer()).toBe(opened);
        expect(document.activeElement).toBe(real(a));

        FocusHistory.on('change', collect);

        expect(FocusHistory.forward()).toBe(true);
        expect(document.activeElement).toBe(real(b));
        expect(LayerManager.getTopLayer()).toBeNull();
        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);
    });

    it('J11: a focus move that closes a "blur" popover fires "change" once, also when the layers hear of the move first', () => {
        // A layer open since before enable() puts `LayerManager`'s `focusin`
        // listener ahead of the service's, so the popover unregisters before
        // the service has recorded the move.
        const kept = openPopoverFromA('manual');

        FocusHistory.enable();
        real(a).focus();
        real(b).focus();
        FocusHistory.back(); // [A*, B]

        const opened = openPopoverFromA('blur');

        expect(LayerManager.getTopLayer()).toBe(opened);

        FocusHistory.on('change', collect);

        real(c).focus(); // [A, C*]

        expect(LayerManager.getTopLayer()).toBe(kept);
        expect(changes).toEqual([{ canGoBack: true, canGoForward: false }]);
    });
});
