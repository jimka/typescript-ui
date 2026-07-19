// Regression coverage for the cross-window dock raise. Two reported regressions:
//
//   1. Hovering a dragged panel over a backgrounded float's *tab bar* did not
//      bring that window to front (hovering its *body* did) — the strip had no
//      spring-loaded raise. The bar now emits "dockhover" after a dwell and the
//      Tab raises its window.
//   2. Dropping a panel onto a strip raised only an auto-created tear-off strip's
//      window, via the narrow hostWindow() resolver. A re-dock into a tiled dock
//      living in an ordinary Window therefore never raised that window. The Tab
//      now resolves the full ancestor window for both paths.
//
// The DOM-level drag (hit-testing, the dwell timer firing) is not exercisable
// under the recording sink, so these tests drive the bar's window-agnostic
// "dockhover" / "dockrequested" events directly — the seam the fix wired — and
// assert the Tab raises the ancestor Window. Before the fix: "dockhover" had no
// listener at all, and "dockrequested" called hostWindow() (null here, as the
// strip is not a tear-off), so neither raised the window and both tests fail.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { Window } from '~/overlay/Window';
import { tabDragRegistry } from '~/overlay/DragManager';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// A Tab region sitting inside an ordinary Window — the tiled-dock situation. Its
// _closeHostWindowWhenEmpty is false, so the old hostWindow() resolver returned
// null and never raised; ancestorWindow() must still find the Window.
function tabInWindow(): { win: Window; tab: Tab; region: Container; bar: any } {
    const win    = new Window('Host');
    const region = new Container({ layoutManager: new Tab() });

    win.addComponent(region);

    const tab = region.getLayoutManager() as Tab;
    const bar = (tab as unknown as Record<string, any>)._bar;

    return { win, tab, region, bar };
}

afterEach(() => {
    vi.restoreAllMocks();
    tabDragRegistry.clear();
    DOM.reset();
});

describe('Tab cross-window dock raise', () => {
    it('raises the strip\'s ancestor Window when the bar reports a dock-hover dwell', () => {
        installTestDOM(CONFIG);

        const { win, bar } = tabInWindow();
        const spy = vi.spyOn(win, 'bringToFront');

        bar.emit('dockhover');

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('raises the strip\'s ancestor Window when a foreign tab is dropped on the bar', () => {
        installTestDOM(CONFIG);

        const { win, bar } = tabInWindow();

        // A foreign content the strip resolves from the shared drag registry.
        const foreignHost = new Container({});
        const foreign     = new Component({});

        foreignHost.addComponent(foreign);
        tabDragRegistry.set(foreign.getId(), foreign);

        const spy = vi.spyOn(win, 'bringToFront');

        bar.emit('dockrequested', foreign.getId(), 0);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('is a silent no-op for a dock-hover on a strip with no ancestor Window', () => {
        installTestDOM(CONFIG);

        const tab = new Tab();

        new Container({ layoutManager: tab });

        const bar = (tab as unknown as Record<string, any>)._bar;

        expect(() => bar.emit('dockhover')).not.toThrow();
    });
});
