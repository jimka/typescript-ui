// Covers the new AbstractWindow "activate" event, emitted from onActivate(true)
// when the window becomes the active layer (raise / focus). Construction stays
// JS-only and onActivate is driven directly — no live paint or layer manager —
// so the emit can be asserted offline under the recording sink.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
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

describe('AbstractWindow "activate" event', () => {
    afterEach(() => DOM.reset());

    it('fires once from onActivate(true)', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const spy = vi.fn();

        win.on('activate', spy);
        win.onActivate(true);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not fire from onActivate(false)', () => {
        installTestDOM(CONFIG);

        const win = new Window('W');
        const spy = vi.fn();

        win.on('activate', spy);
        win.onActivate(false);

        expect(spy).not.toHaveBeenCalled();
    });
});
