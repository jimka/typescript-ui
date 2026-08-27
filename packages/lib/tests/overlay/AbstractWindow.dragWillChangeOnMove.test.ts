// Regression: pressing a window's header promoted the whole window to its own
// compositor layer immediately on mousedown, even for a plain click with no
// drag movement. Chromium rasterizes a promoted layer against its own
// snapped origin, which visibly nudged descendant content (sub-pixel-
// positioned glyph icons, e.g. table row checkboxes) by up to 1px until the
// layer was released on mouseup — a flash that a plain click has no business
// producing. Fixed by deferring the will-change promotion from startMoveFrom
// (mousedown) to the first onDrag call (the first actual pointer movement),
// so a click that never moves the pointer never promotes the layer.
import { describe, it, expect, afterEach } from 'vitest';
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

describe('AbstractWindow drag will-change promotion', () => {
    afterEach(() => DOM.reset());

    it('does not promote a compositor layer on a plain click with no movement', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const headerHandle = win.getHeader().getElement()!;

        win.onMouseDown(makeEvent(headerHandle, 'mousedown', { clientX: 100, clientY: 20 }) as unknown as MouseEvent);

        expect(win.getWillChange()).toBeNull();

        win.onMouseUp();

        expect(win.getWillChange()).toBeNull();
    });

    it('promotes a compositor layer once the pointer actually moves, and releases it on mouseup', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        win.getElement(true);

        const headerHandle = win.getHeader().getElement()!;

        win.onMouseDown(makeEvent(headerHandle, 'mousedown', { clientX: 100, clientY: 20 }) as unknown as MouseEvent);
        win.onDrag(makeEvent(headerHandle, 'mousemove', { clientX: 105, clientY: 20 }) as unknown as MouseEvent);

        expect(win.getWillChange()).toBe('transform');

        win.onMouseUp();

        expect(win.getWillChange()).toBeNull();
    });
});
