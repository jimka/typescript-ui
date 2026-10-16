// Which components are spatial-navigation groups out of the box. A group is
// one row or column of related controls: the control chord (`Ctrl+Alt`+arrow)
// searches along it before looking elsewhere. The four classes below are the
// library's rows of controls; a plain Component or Panel is not a row and
// must stay unmarked, or every panel would become a search level.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import { ToolBar } from '~/component/menubar/ToolBar';
import { MenuBar } from '~/component/menubar/MenuBar';
import { TabBar } from '~/component/container/TabBar';
import { AccordionHeader } from '~/component/container/AccordionHeader';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('navigation group defaults', () => {
    it('a ToolBar is a navigation group, and renders the marker attribute', () => {
        const bar = new ToolBar();

        expect(bar.isNavigationGroup()).toBe(true);
        expect(bar.getDataAttribute('ts-ui-navigation-group')).toBe('true');
    });

    it('a MenuBar is a navigation group, and renders the marker attribute', () => {
        const bar = new MenuBar();

        expect(bar.isNavigationGroup()).toBe(true);
        expect(bar.getDataAttribute('ts-ui-navigation-group')).toBe('true');
    });

    it('a TabBar is a navigation group, and renders the marker attribute', () => {
        const bar = new TabBar();

        expect(bar.isNavigationGroup()).toBe(true);
        expect(bar.getDataAttribute('ts-ui-navigation-group')).toBe('true');
    });

    it('an AccordionHeader is a navigation group, and renders the marker attribute', () => {
        const header = new AccordionHeader('x');

        expect(header.isNavigationGroup()).toBe(true);
        expect(header.getDataAttribute('ts-ui-navigation-group')).toBe('true');
    });

    it('an AccordionHeader is not a region-chord target — the region chord must not stop at every header', () => {
        expect(new AccordionHeader('x').isNavigationTarget()).toBe(false);
    });

    it('a plain Component and a plain Panel are not navigation groups', () => {
        expect(new Component().isNavigationGroup()).toBe(false);
        expect(new Panel().isNavigationGroup()).toBe(false);
    });

    it('an explicit navigationGroup: false overrides the class default', () => {
        const bar = new ToolBar({ navigationGroup: false });

        expect(bar.isNavigationGroup()).toBe(false);
        expect(bar.getDataAttribute('ts-ui-navigation-group')).toBeUndefined();
    });
});
