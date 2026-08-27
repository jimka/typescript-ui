// Covers the window-context-menu plan's case 27: a leading widget that opts
// back into pointer events (the window-menu-triggering leading glyph) must
// be vetoed from the bar's move/double-click triggers like the tool group
// and tab wrappers already are, or a press on it would also drag the host
// window. The bar's own blank area must still trigger the move.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

describe('TabBar leading widget chrome veto', () => {
    it('vetoes the move trigger for a press on the leading widget, but not for a press on the bar itself', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        const widget = new Component();
        bar.setLeadingWidget(widget);

        const onEmptyPress = vi.fn();
        bar.installMoveTrigger(onEmptyPress);

        const barEl = bar.getElement(true)!;
        const widgetEl = widget.getElement(true)!;

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(widgetEl, 'mousedown', { button: 0 }));
        expect(onEmptyPress).not.toHaveBeenCalled();

        // Any handle not inside the bar's chrome (tool group, tabs, leading
        // widget) counts as the blank draggable area — the bar's own root
        // element stands in for it, mirroring
        // Window.headerMoveTrigger.test.ts's identical trick.
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(barEl, 'mousedown', { button: 0 }));
        expect(onEmptyPress).toHaveBeenCalledTimes(1);

        bar.dispose();
    });
});
