// Regression: a mousedown anywhere in the header subtree — including on the
// trailing minimize/maximize/close buttons — started a window move, because
// wireMoveTrigger's subtree listener called onMouseDown unconditionally. A
// press that only meant to click a control button also dragged the window.
// Fixed by vetoing the trigger when the press lands inside a trailing button,
// mirroring the existing targetIsInHeaderControl check onHeaderDoubleClick
// already uses.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Window header move-trigger veto', () => {
    afterEach(() => DOM.reset());

    it('does not start a window move when the press lands on the close button', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const spy = vi.spyOn(win, 'onMouseDown');
        const closeHandle = win.getHeader().getExitButtonElement()!;

        (win as unknown as { onHeaderMouseDown(e: MouseEvent): void })
            .onHeaderMouseDown(makeEvent(closeHandle, 'mousedown') as unknown as MouseEvent);

        expect(spy).not.toHaveBeenCalled();
    });

    it('does not start a window move when the press lands on the minimize or maximize button', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const spy = vi.spyOn(win, 'onMouseDown');
        const header = win.getHeader();
        const handler = (win as unknown as { onHeaderMouseDown(e: MouseEvent): void }).onHeaderMouseDown;

        handler.call(win, makeEvent(header.getMinimizeButtonElement()!, 'mousedown') as unknown as MouseEvent);
        handler.call(win, makeEvent(header.getMaximizeButtonElement()!, 'mousedown') as unknown as MouseEvent);

        expect(spy).not.toHaveBeenCalled();
    });

    it('still starts a window move for a press elsewhere in the header', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const spy = vi.spyOn(win, 'onMouseDown');

        // Any handle that is not inside a trailing button — the header's own
        // element stands in for the title/blank-area region.
        const headerHandle = win.getHeader().getElement()!;

        (win as unknown as { onHeaderMouseDown(e: MouseEvent): void })
            .onHeaderMouseDown(makeEvent(headerHandle, 'mousedown') as unknown as MouseEvent);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not start a window move, and does not maximize on dblclick, when the press lands on the title icon', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const mouseDownSpy = vi.spyOn(win, 'onMouseDown');
        const glyphHandle = win.getHeader().getGlyph()!.getElement(true)!;

        (win as unknown as { onHeaderMouseDown(e: MouseEvent): void })
            .onHeaderMouseDown(makeEvent(glyphHandle, 'mousedown') as unknown as MouseEvent);

        expect(mouseDownSpy).not.toHaveBeenCalled();

        const stateBefore = win.getWindowState();

        (win as unknown as { onHeaderDoubleClick(e: MouseEvent): void })
            .onHeaderDoubleClick(makeEvent(glyphHandle, 'dblclick') as unknown as MouseEvent);

        expect(win.getWindowState()).toBe(stateBefore);
    });
});
