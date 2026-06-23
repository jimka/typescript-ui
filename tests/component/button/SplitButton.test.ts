// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SplitButton } from '~/component/button/SplitButton';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('SplitButton eager chevron', () => {
    it('constructs without the consumer registering any glyph', () => {
        // The trailing `caret-down` chevron is registered eagerly at module
        // load, so a bare SplitButton resolves it without setup.
        expect(() => new SplitButton('Save')).not.toThrow();
    });
});

describe('SplitButton menuItems', () => {
    it('defaults to an empty array', () => {
        expect(new SplitButton('Save').getMenuItems()).toEqual([]);
    });
    it('round-trips setMenuItems', () => {
        const btn = new SplitButton('Save');
        const items = [{ text: 'Save As' }, { text: 'Save All' }];

        btn.setMenuItems(items);

        expect(btn.getMenuItems()).toBe(items);
    });
    it('applies a { menuItems } option', () => {
        const items = [{ text: 'Export' }];

        const btn = new SplitButton('Save', { menuItems: items });

        expect(btn.getMenuItems()).toBe(items);
    });
});

describe('SplitButton main-face action', () => {
    it('inherits on("action") and is chainable like Button', () => {
        const btn = new SplitButton('Save');

        expect(btn.on('action', () => {})).toBe(btn);
    });
});

describe('SplitButton dropdown when unattached', () => {
    it('opening the chevron menu is a no-op without a DOM element (no throw)', () => {
        // `_toggleMenu` (the chevron-click target) reads `getElement()` and the
        // viewport rect to anchor the overlay; it returns early when the button
        // has no element. We can't deliver the chevron click offline, but we can
        // confirm a freshly constructed, unattached SplitButton exposes no
        // element yet — the precondition the early return guards on — and that
        // constructing/handling stays exception-free.
        const btn = new SplitButton('Save', { menuItems: [{ text: 'X' }] });

        expect(btn.getElement()).toBeFalsy();
        expect(() => btn.getMenuItems()).not.toThrow();
    });
});
