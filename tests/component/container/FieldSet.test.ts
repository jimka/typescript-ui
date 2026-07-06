import { describe, it, expect, afterEach } from 'vitest';
import { FieldSet } from '~/component/container/FieldSet';
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

// Mirrors FieldSet.LEGEND_CLEARANCE_FALLBACK — the constant the modelled
// (no-browser) source short-circuits to because there is no native <legend>
// box to measure (FieldSet.legendClearance, L203).
const LEGEND_CLEARANCE_FALLBACK = 16;

describe('FieldSet title', () => {
    afterEach(() => DOM.reset());

    it('round-trips the constructor title and setTitle', () => {
        installTestDOM(CONFIG);

        const fs = new FieldSet('Details');

        expect(fs.getTitle()).toBe('Details');

        fs.setTitle('Advanced');

        expect(fs.getTitle()).toBe('Advanced');
    });

    it('defaults the title to the empty string', () => {
        installTestDOM(CONFIG);

        expect(new FieldSet().getTitle()).toBe('');
    });
});

describe('FieldSet perimeter and size', () => {
    afterEach(() => DOM.reset());

    it('adds the legend clearance fallback to the perimeter top', () => {
        installTestDOM(CONFIG);

        const fs = new FieldSet('Group');

        // Offline the border resolves to 0 width and there is no padding, so the
        // base perimeter top is exactly the top inset. The legend clearance
        // fallback (16) is added on top. Derive the base from the live insets so
        // the assertion tracks the default inset, not a captured number.
        const insetTop = fs.getInsets()!.getTop();

        expect(fs.getPerimeterSize().top).toBe(insetTop + LEGEND_CLEARANCE_FALLBACK);
    });

    it('surfaces the default minSize / preferredSize through the getters', () => {
        installTestDOM(CONFIG);

        const fs = new FieldSet();

        // Subclass defaults: preferredSize 200x200, minSize 100x100. The legend
        // augmentation to minSize is a no-op offline because the empty legend
        // reports no min width (the documented fallback branch returns base
        // min unchanged), so getMinSize equals the base 100x100.
        expect(fs.getPreferredSize()).toEqual({ width: 200, height: 200 });
        expect(fs.getMinSize()).toEqual({ width: 100, height: 100 });
    });
});
