import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MenuBar } from '~/component/menubar/MenuBar';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
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
    it('re-resolves a provider-sourced dropdown on each open, tracking current state', () => {
        const bar = new MenuBar();

        // A provider (not a fixed array) supplies the dropdown's items; the label
        // and enabled state flip between opens to mimic app state changing.
        let ready = false;
        const provider = vi.fn(() => [{ text: ready ? 'Export' : 'Nothing', enabled: ready }]);

        bar.setMenus([{ label: 'Tools', items: provider }]);
        bar.getElement(true);

        // A provider defers its build to open() — nothing runs at setMenus time.
        expect(provider).not.toHaveBeenCalled();

        bar.openMenu(0);
        expect(provider).toHaveBeenCalledTimes(1);
        const firstItem = (bar as any)._panels[0]._menuItems[0];
        expect(firstItem._config.text).toBe('Nothing');
        expect(firstItem._config.enabled).toBe(false);

        bar.closeMenu();
        ready = true;
        bar.openMenu(0);
        expect(provider).toHaveBeenCalledTimes(2);
        const rebuiltItem = (bar as any)._panels[0]._menuItems[0];
        expect(rebuiltItem._config.text).toBe('Export');
        expect(rebuiltItem._config.enabled).toBe(true);
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

describe('MenuBar key yielding', () => {
    // Invokes the private `_onKeyDown` handler directly with a makeEvent(...)
    // sentinel, mirroring Tree.test.ts's `_handleClick(makeEvent(...))` and
    // DiagramView.test.ts's identical pattern for testing a private
    // DOM-event handler offline. `_onKeyDown` is registered as a viewport
    // listener (Event.addViewportListener), whose window-level registration
    // is gated on module state that outlives DOM.reset() and this file's own
    // earlier tests (several open a menu without closing it) — so a real
    // window dispatch is not reliably routed here; calling the handler
    // directly exercises the same guard logic without depending on that
    // shared, cross-test registration state.
    //
    // Because the call is direct, the dispatcher's disposition-translation
    // layer (`applyDisposition`, which turns a returned `{ prevent: true }`
    // into an actual `event.preventDefault()` call) never runs — so
    // "does not preventDefault" is asserted on `_onKeyDown`'s own returned
    // disposition (its documented contract) rather than on the event object.
    function keyDown(bar: MenuBar, target: ReturnType<typeof DOM.sink.createElement>, key: string): Event.ListenerResult {
        const event = makeEvent(target, 'keydown', { key });

        return (bar as any)._onKeyDown(event);
    }

    it('ArrowDown with the event target outside the panel moves the focused index and returns a stop+prevent disposition (unchanged behaviour)', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);
        bar.openMenu(0);

        const panel   = (bar as any)._panels[0];
        const outside = DOM.sink.createElement('div');

        const result = keyDown(bar, outside, 'ArrowDown');

        expect(panel.getFocusedIndex()).toBe(0);
        expect(result).toEqual({ stop: true, prevent: true });

        bar.closeMenu();
    });

    it('ArrowDown with the event target inside the open panel leaves the focused index unchanged and returns no disposition', () => {
        const bar = new MenuBar();

        bar.setMenus(MENUS);
        bar.getElement(true);
        bar.openMenu(0);

        const panel   = (bar as any)._panels[0];
        const panelEl = panel.getElement(true)!;

        const result = keyDown(bar, panelEl, 'ArrowDown');

        expect(panel.getFocusedIndex()).toBe(-1);
        expect(result).toBeUndefined();

        bar.closeMenu();
    });
});
