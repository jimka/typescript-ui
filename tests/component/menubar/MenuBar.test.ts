import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MenuBar } from '~/component/menubar/MenuBar';
import { Component } from '~/core/Component';
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

const MENUS = [
    { label: 'File', items: [{ text: 'New' }, { text: 'Open' }] },
    { label: 'Edit', items: [{ text: 'Undo' }] },
    { label: 'View', items: [{ text: 'Zoom' }] },
];

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Number of child components registered on the bar. */
function childCount(bar: MenuBar): number {
    return (bar as unknown as Component).getComponents().length;
}

describe('MenuBar open-index default', () => {
    it('reports -1 on a fresh bar', () => {
        expect(new MenuBar().getOpenIndex()).toBe(-1);
    });
});

describe('MenuBar setMenus registration', () => {
    it('registers one button child per descriptor', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);

        expect(childCount(bar)).toBe(MENUS.length);
    });
    it('populates from the menus option (options-bag equivalent of setMenus)', () => {
        const bar = new MenuBar({ menus: MENUS });

        expect(childCount(bar)).toBe(MENUS.length);
    });
    it('disposes and rebuilds so the child count tracks the new descriptor list', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        expect(childCount(bar)).toBe(3);

        bar.setMenus([{ label: 'Only', items: [{ text: 'X' }] }]);

        expect(childCount(bar)).toBe(1);
    });
});

describe('MenuBar open / close index tracking', () => {
    it('openMenu(i) sets getOpenIndex to i', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);

        bar.openMenu(1);

        expect(bar.getOpenIndex()).toBe(1);
    });
    it('openMenu out of range is a no-op', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);

        bar.openMenu(99);

        expect(bar.getOpenIndex()).toBe(-1);
    });
    it('closeMenu resets the index to -1', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);

        bar.openMenu(0);
        expect(bar.getOpenIndex()).toBe(0);

        bar.closeMenu();

        expect(bar.getOpenIndex()).toBe(-1);
    });
});

describe('MenuBar outside-click exclusion', () => {
    it('excludes only the opener button, not the whole bar, so empty-bar clicks dismiss', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);

        bar.openMenu(0);

        const priv = bar as unknown as {
            _panels: Array<{ getExcludedElement(): unknown }>;
            _buttons: Component[];
        };
        const excluded = priv._panels[0].getExcludedElement();

        // The opener button is excluded so its own mousedown does not self-close
        // the menu; the bar as a whole is NOT excluded, so a mousedown on empty
        // bar space falls through to the menu's outside-click dismissal.
        expect(excluded).toBe(priv._buttons[0].getElement());
        expect(excluded).not.toBe(bar.getElement());
    });
});

describe('MenuBar ARIA', () => {
    it('reports role="menubar"', () => {
        expect(new MenuBar().getAria().getRole()).toBe('menubar');
    });
});
