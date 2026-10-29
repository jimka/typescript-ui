// @vitest-environment jsdom
//
// window-focus-on-show plan, cases J1–J4. Real windows against the REAL
// production DOM source (the `jsdom` pragma keeps `tests/setup/node-setup.ts`
// from installing the modelled DOM), where `element.focus()` fires `focusin`.
// The offline cases in `AbstractWindow.focus.test.ts` model the order in which
// a window registers, takes focus and returns it; these pin it with a real
// `FocusHistory`, a real `Dialog` and a real `Menu`.
//
// jsdom does not enforce `inert`, so J3 passes only because the window reads
// its own inert attribute before it moves focus.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { FocusHistory } from '~/core/FocusHistory';
import { Container } from '~/core/Container';
import { Button } from '~/component/button/Button';
import { Menu } from '~/overlay/Menu';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { Window } from '~/overlay/Window';
import type { AbstractWindow } from '~/overlay/AbstractWindow';

let host: Container;
let a: Button;
let b: Button;
// Built by a case, disposed by the teardown when the case did not get as far
// as closing it: a layer left registered would stop every later case's focus.
let win:    AbstractWindow | null = null;
let dialog: Dialog | null         = null;
let menu:   Menu | null           = null;

/** The real element a component rendered. */
function real(component: { getId(): string }): HTMLElement {
    return document.getElementById(component.getId())!;
}

/**
 * Lets the window's first layout flush and its animations settle. The fake
 * clock stands in for the two animation frames and the zero timeout.
 */
async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(500);
}

beforeEach(() => {
    vi.useFakeTimers();

    // jsdom has no canvas, and a window's header glyphs measure their font
    // through one.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        font: '',
        measureText: () => ({
            width: 8,
            actualBoundingBoxAscent: 8,
            actualBoundingBoxDescent: 2,
            fontBoundingBoxAscent: 10,
            fontBoundingBoxDescent: 3,
        }),
    } as never);

    host = new Container();
    a = new Button({ text: 'A' });
    b = new Button({ text: 'B' });
    host.addComponent(a);
    host.addComponent(b);
    DOM.sink.appendChild(DOM.source.getBody(), host.getElement(true)!);
    a.getElement(true);
    b.getElement(true);
    host.flushLayout();
});

afterEach(() => {
    FocusHistory.disable();
    FocusHistory.clear();
    win?.dispose();
    win = null;
    dialog?.dispose();
    dialog = null;
    menu?.dispose();
    menu = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // The jsdom environment never swaps the DOM between cases, so reset it:
    // every module forgets this case's state, Menu's and Tooltip's watches
    // among them.
    DOM.reset();
});

describe('A window taking focus with real layers', () => {
    it('J1: show() leaves focus alone until the window has laid out', async () => {
        real(a).focus();

        const opened = new Window('W');

        win = opened;
        opened.show();

        expect(document.activeElement).toBe(real(a));

        await flush();

        expect(document.activeElement).toBe(real(opened));
    });

    it('J2: closing returns focus to the opener and leaves no trail to walk back', async () => {
        FocusHistory.enable();
        real(a).focus();

        const opened = new Window('W');

        win = opened;
        opened.show();
        await flush();

        expect(document.activeElement).toBe(real(opened));

        opened.requestClose();
        await flush();

        win = null;

        expect(document.activeElement).toBe(real(a));
        expect(FocusHistory.canGoBack()).toBe(false);
        expect(FocusHistory.back()).toBe(false);
    });

    it('J3: a window shown under a dialog is inert and leaves focus in the dialog', async () => {
        const opened = new Dialog({ title: 'T', message: 'M', buttons: [{ text: 'OK', result: 'confirm' }] });

        dialog = opened;
        void opened.show();
        await flush();

        expect(real(opened).contains(document.activeElement)).toBe(true);

        const floating = new Window('W');

        win = floating;
        floating.show();
        await flush();

        expect(real(floating).hasAttribute('inert')).toBe(true);
        expect(real(opened).contains(document.activeElement)).toBe(true);
    });

    it('J4: a window shown from a keyboard-opened menu row takes focus, and gives it back to the invoker', async () => {
        const opened = new Window('W');
        const menuRow = new Menu();

        menu = menuRow;
        win  = opened;

        real(b).focus();
        real(b).dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
        menuRow.show(10, 10, [{ text: 'Open', action: () => { opened.show(); } }]);

        expect(real(menuRow).contains(document.activeElement)).toBe(true);

        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await flush();

        expect(document.activeElement).toBe(real(opened));

        opened.requestClose();
        await flush();

        win = null;

        expect(document.activeElement).toBe(real(b));
    });
});
