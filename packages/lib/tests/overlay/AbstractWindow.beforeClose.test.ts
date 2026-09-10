// Pins AbstractWindow's vetoable "beforeclose" event and the requestClose() /
// onExitAction() split it introduces — the same guarded/unguarded shape
// Tab.renameAndVeto.test.ts already pins for "beforetabclose"/closeTab.
// Modelled on that file's veto tests and on AbstractWindow.closeable.test.ts's
// exitButton() accessor and CONFIG.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { WindowCloseController } from '~/overlay/AbstractWindow';
import { Button } from '~/component/button/Button';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** White-box access to Window's private header exit button. */
function exitButton(win: Window): Button {
    return (win.getHeader() as unknown as { _exitButton: Button })._exitButton;
}

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched click DOM event is used — see the file-level note in
// CollapseButton.test.ts / Link.test.ts: Event's window-level base listener is
// armed once per event TYPE for the lifetime of this module and is not
// re-armed by a later installTestDOM() call unless the component holding it is
// disposed first.
describe('AbstractWindow beforeclose (real DOM dispatch)', () => {
    afterEach(() => DOM.reset());

    it('a veto registered on a Window also stops its header exit button, not just requestClose()', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const button = exitButton(win);
        const handle = button.getElement(true)!;
        let closed = false;

        win.on('close', () => { closed = true; });
        win.on('beforeclose', (c: WindowCloseController) => c.preventDefault());

        Event.fireEvent(button, makeEvent(handle, 'click') as any);

        expect(closed).toBe(false);

        win.dispose();
    });
});

describe('AbstractWindow beforeclose (programmatic)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('a veto keeps the window open and "close" never fires', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const closeSpy = vi.fn();

        win.on('close', closeSpy);
        win.on('beforeclose', (c: WindowCloseController) => c.preventDefault());

        win.requestClose();

        expect(closeSpy).not.toHaveBeenCalled();
    });

    it('no beforeclose listener closes normally', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const closeSpy = vi.fn();

        win.on('close', closeSpy);

        win.requestClose();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('onExitAction() is unguarded — a veto does not stop it', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const closeSpy = vi.fn();

        win.on('close', closeSpy);
        win.on('beforeclose', (c: WindowCloseController) => c.preventDefault());

        win.onExitAction();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('closeable and beforeclose are independent: a non-closeable window still closes via requestClose()', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { closeable: false });
        const closeSpy = vi.fn();

        win.on('close', closeSpy);

        win.requestClose();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });
});
