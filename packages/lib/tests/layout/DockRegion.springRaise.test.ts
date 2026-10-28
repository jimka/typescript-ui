// dock-reveal-panel-without-focus plan, case S1: the spring-loaded raise a
// region's host window gets while a dragged tab dwells over it activates the
// window without moving keyboard focus. The dwell timer is captured rather than
// run, and the drag is stubbed live, so the case drives the raise directly.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { DockRegion } from '~/layout/DockRegion';
import { Window } from '~/overlay/Window';
import { DragManager } from '~/overlay/DragManager';
import { Button } from '~/component/button/Button';
import { DOM } from '~/core/DOM';
import { installTestDOM, setConnected } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let teardown: Array<() => void> = [];

afterEach(() => {
    teardown.forEach(fn => fn());
    teardown = [];
    vi.restoreAllMocks();
    DOM.reset();
});

describe('DockRegion spring-loaded raise', () => {
    it('S1: raises the host window with focus: false and leaves focus where it was', () => {
        installTestDOM(CONFIG);

        const win    = new Window('Host');
        const region = new Container({});

        win.addComponent(region);
        win.show();

        const dr = new DockRegion(region);

        teardown.push(() => dr.destroy(), () => win.dispose());

        let dwell: (() => void) | null = null;

        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void): number => {
            dwell = cb;

            return 0;
        }) as typeof setTimeout);
        vi.spyOn(DragManager, 'isDragging').mockReturnValue(true);

        const raise   = vi.spyOn(win, 'bringToFront');
        const outside = new Button('Outside').getElement(true)!;

        setConnected(outside, true);
        DOM.sink.focus(outside);

        (dr as unknown as { scheduleSpringRaise(): void }).scheduleSpringRaise();
        dwell!();

        expect(raise).toHaveBeenCalledTimes(1);
        expect(raise).toHaveBeenCalledWith({ focus: false });
        expect(DOM.source.getActiveElement()).toBe(outside);
    });
});
