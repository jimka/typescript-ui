import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Separator, _Separator } from '~/component/container/Separator';
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

describe('Separator orientation default', () => {
    it('defaults to horizontal', () => {
        expect(new Separator().getOrientation()).toBe('horizontal');
    });
    it('reflects an explicit { orientation: "vertical" }', () => {
        expect(new Separator({ orientation: 'vertical' }).getOrientation()).toBe('vertical');
    });
});

describe('Separator thickness constant', () => {
    it('pins THICKNESS to 1', () => {
        expect(_Separator.THICKNESS).toBe(1);
    });
});

describe('Separator horizontal size constraints', () => {
    it('sets preferredSize / minSize / maxSize for the default orientation', () => {
        const sep = new Separator();

        expect(sep.getPreferredSize()).toEqual({ width: 0, height: 1 });
        expect(sep.getMinSize()).toEqual({ width: 0, height: 1 });
        expect(sep.getMaxSize()).toEqual({ width: UNBOUNDED, height: 1 });
    });
});

describe('Separator vertical size constraints', () => {
    it('sets preferredSize / minSize / maxSize for orientation: "vertical"', () => {
        const sep = new Separator({ orientation: 'vertical' });

        expect(sep.getPreferredSize()).toEqual({ width: 1, height: 0 });
        expect(sep.getMinSize()).toEqual({ width: 1, height: 0 });
        expect(sep.getMaxSize()).toEqual({ width: 1, height: UNBOUNDED });
    });
});

describe('Separator ARIA', () => {
    it('reports role="separator" with a matching aria-orientation and tabIndex -1', () => {
        const sep = new Separator({ orientation: 'vertical' });
        const aria = sep.getAria();

        expect(aria.getRole()).toBe('separator');
        expect(aria.getOrientation()).toBe('vertical');
        expect(aria.getTabIndex()).toBe(-1);
    });
});
