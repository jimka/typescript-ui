// Covers the `closeable` window option: it defaults to true, reaches both
// concrete window subclasses, disables (never hides) the user-facing close
// affordance — Window's header exit button and TabWindow's close tool — and
// leaves the programmatic requestClose() path open regardless, per
// AbstractWindow.setCloseable's doc comment ("only programmatically via
// requestClose"). Construction and the gated affordance stay JS-only, so all
// of this is exercised offline under the recording sink.
import { describe, it, expect, afterEach } from 'vitest';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { Button } from '~/component/button/Button';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
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

/** White-box access to TabWindow's private close control tool. */
function closeTool(win: TabWindow): Button {
    return (win as unknown as { _closeTool: Button })._closeTool;
}

describe('AbstractWindow closeable option', () => {
    afterEach(() => DOM.reset());

    it('defaults to true', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.isCloseable()).toBe(true);
    });

    it('reaches Window via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { closeable: false });

        expect(win.isCloseable()).toBe(false);
    });

    it('reaches TabWindow via the constructor option', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ closeable: false });

        expect(win.isCloseable()).toBe(false);
    });

    it('leaves the header exit button enabled and visible by default', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');

        expect(win.getHeader().isCloseable()).toBe(true);
        expect(exitButton(win).isEnabled()).toBe(true);
        expect(exitButton(win).isVisible()).not.toBe(false);
    });

    it('disables, but does not hide, the header exit button when constructed non-closeable', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { closeable: false });

        expect(win.getHeader().isCloseable()).toBe(false);
        expect(exitButton(win).isEnabled()).toBe(false);
        expect(exitButton(win).isVisible()).not.toBe(false);
    });

    it('disables, but does not hide, the TabWindow close tool when constructed non-closeable', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ closeable: false });

        expect(closeTool(win).isEnabled()).toBe(false);
        expect(closeTool(win).isVisible()).not.toBe(false);
    });

    it('re-enables the header exit button when closeable is toggled back on', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { closeable: false });

        win.setCloseable(true);

        expect(win.isCloseable()).toBe(true);
        expect(win.getHeader().isCloseable()).toBe(true);
        expect(exitButton(win).isEnabled()).toBe(true);
    });

    it('re-disables the TabWindow close tool on a re-enable-then-disable round trip', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow();

        win.setCloseable(false);
        expect(closeTool(win).isEnabled()).toBe(false);

        win.setCloseable(true);
        expect(closeTool(win).isEnabled()).toBe(true);
    });

    it('leaves the programmatic requestClose() path open on a non-closeable Window', () => {
        installTestDOM(CONFIG);

        const win = new Window('W', { closeable: false });
        let closed = false;
        win.on('close', () => { closed = true; });

        win.requestClose();

        expect(closed).toBe(true);
    });

    it('leaves the programmatic requestClose() path open on a non-closeable TabWindow', () => {
        installTestDOM(CONFIG);

        const win = new TabWindow({ closeable: false });
        let closed = false;
        win.on('close', () => { closed = true; });

        win.requestClose();

        expect(closed).toBe(true);
    });
});
