// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

/** A LayoutConstraints carrying a closeable flag (and optional name). */
function closeable(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.closeable = true;

    return c;
}

/** Builds a TabBar with three entries: a, b, c (no constraints). */
function threeEntryBar(): TabBar {
    const bar = new TabBar();

    bar.createBarEntry('a', 'Alpha');
    bar.createBarEntry('b', 'Beta');
    bar.createBarEntry('c', 'Gamma');

    return bar;
}

describe('TabBar entry tracking', () => {
    afterEach(() => DOM.reset());

    it('makes the first entry active and joins later entries inactive', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        expect(bar.getActiveEntryId()).toBe('a');
    });

    it('returns ids in strip order as a defensive copy', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();
        const ids = bar.getEntryIds();

        expect(ids).toEqual(['a', 'b', 'c']);

        ids.push('mutated');

        // The returned array is a copy; mutating it must not affect the strip.
        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
    });

    it('setActiveEntry updates the active id; unknown id is a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.setActiveEntry('b');

        expect(bar.getActiveEntryId()).toBe('b');

        bar.setActiveEntry('nope');

        expect(bar.getActiveEntryId()).toBe('b');
    });
});

describe('TabBar moveBarEntry', () => {
    afterEach(() => DOM.reset());

    it('clamps a huge destination to the last slot', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('a', 99);

        expect(bar.getEntryIds()).toEqual(['b', 'c', 'a']);
    });

    it('treats dest === from as a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('b', 1);

        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
    });

    it('reorders to an interior slot', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.moveBarEntry('c', 0);

        expect(bar.getEntryIds()).toEqual(['c', 'a', 'b']);
    });
});

describe('TabBar removeBarEntry', () => {
    afterEach(() => DOM.reset());

    it('resets active to null when the removed entry was active', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // 'a' is active

        bar.removeBarEntry('a');

        expect(bar.getEntryIds()).toEqual(['b', 'c']);
        expect(bar.getActiveEntryId()).toBeNull();
    });

    it('leaves the active id unchanged when a non-active entry is removed', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // 'a' is active

        bar.removeBarEntry('b');

        expect(bar.getEntryIds()).toEqual(['a', 'c']);
        expect(bar.getActiveEntryId()).toBe('a');
    });

    it('treats an unknown id as a no-op', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        bar.removeBarEntry('nope');

        expect(bar.getEntryIds()).toEqual(['a', 'b', 'c']);
        expect(bar.getActiveEntryId()).toBe('a');
    });
});

describe('TabBar entry metadata', () => {
    afterEach(() => DOM.reset());

    it('reflects name and closeable, with documented defaults for unknown ids', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('x', 'Xavier', closeable());
        bar.createBarEntry('y', 'Yvonne'); // no constraints → not closeable

        expect(bar.getEntryName('x')).toBe('Xavier');
        expect(bar.isEntryCloseable('x')).toBe(true);
        expect(bar.isEntryCloseable('y')).toBe(false);

        // Documented defaults for an unknown id.
        expect(bar.getEntryName('missing')).toBe('');
        expect(bar.isEntryCloseable('missing')).toBe(false);
    });
});
