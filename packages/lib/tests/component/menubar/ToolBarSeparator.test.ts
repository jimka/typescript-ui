import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolBarSeparator, _ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { UNBOUNDED } from '~/primitive/Size';
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

describe('ToolBarSeparator thickness constant', () => {
    it('pins THICKNESS to 1', () => {
        expect(_ToolBarSeparator.THICKNESS).toBe(1);
    });
});

describe('ToolBarSeparator orientation default', () => {
    it('defaults to vertical', () => {
        expect(new ToolBarSeparator().getOrientation()).toBe('vertical');
    });
    it('reflects an explicit { orientation: "horizontal" }', () => {
        expect(new ToolBarSeparator({ orientation: 'horizontal' }).getOrientation()).toBe('horizontal');
    });
});

describe('ToolBarSeparator vertical size constraints', () => {
    it('sets preferredSize (THICKNESS, 0)', () => {
        const pref = new ToolBarSeparator().getPreferredSize()!;

        expect(pref.width).toBe(1);
        expect(pref.height).toBe(0);
    });
    it('lets maxSize.height grow unbounded', () => {
        const max = new ToolBarSeparator().getMaxSize()!;

        // The constructor passes Number.MAX_VALUE, which the framework clamps to
        // its UNBOUNDED sentinel (Number.MAX_SAFE_INTEGER) — the contract is an
        // unbounded vertical extent, not the literal MAX_VALUE.
        expect(max.width).toBe(1);
        expect(max.height).toBe(UNBOUNDED);
    });
});

describe('ToolBarSeparator horizontal size constraints', () => {
    it('sets preferredSize (0, THICKNESS)', () => {
        const pref = new ToolBarSeparator({ orientation: 'horizontal' }).getPreferredSize()!;

        expect(pref.width).toBe(0);
        expect(pref.height).toBe(1);
    });
    it('lets maxSize.width grow unbounded', () => {
        const max = new ToolBarSeparator({ orientation: 'horizontal' }).getMaxSize()!;

        // Number.MAX_VALUE is clamped to the framework's UNBOUNDED sentinel.
        expect(max.width).toBe(UNBOUNDED);
        expect(max.height).toBe(1);
    });
});

describe('ToolBarSeparator ARIA', () => {
    it('reports role="separator" with a matching aria-orientation and tabIndex -1', () => {
        const sep = new ToolBarSeparator({ orientation: 'horizontal' });
        const aria = sep.getAria();

        expect(aria.getRole()).toBe('separator');
        expect(aria.getOrientation()).toBe('horizontal');
        expect(aria.getTabIndex()).toBe(-1);
    });
});
