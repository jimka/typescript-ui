import { describe, it, expect, afterEach, vi } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Glyph } from '~/component/display/Glyph';
import { file } from '~/glyphs/solid/file';
import { file_lines } from '~/glyphs/solid/file_lines';
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

/** A LayoutConstraints carrying a glyph name. */
function glyphed(name: string): LayoutConstraints {
    const c = new LayoutConstraints();

    c.glyph = name;

    return c;
}

/** Reaches TabBar's private `_entries`, the same private surface other suites cast through. */
function barEntries(bar: TabBar): Array<{ id: string; button: TabButton }> {
    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton }> })._entries;
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

/** The private surface this suite reaches into for wrapper/indicator geometry. */
type Wrapper = { getX(): number; getTranslateX(): number };
type BarInternals = {
    _entries: Array<{ id: string; button: Wrapper }>;
    _indicator: { getTranslateX(): number };
};

describe('TabBar selection indicator tracks the active tab across a same-count reorder', () => {
    afterEach(() => DOM.reset());

    it('keeps the indicator glued to the active tab after moveBarEntry reshuffles slots', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar(); // a, b, c
        bar.getElement(true);
        bar.setActiveEntry('b'); // middle tab, so a reorder actually displaces it

        bar.placeStrip(0, 0, 300, 30); // first placement: slow path, indicator lands correctly

        const { _entries, _indicator } = bar as unknown as BarInternals;
        const wrapper = _entries.find(e => e.id === 'b')!.button;

        expect(_indicator.getTranslateX()).toBe(wrapper.getX() + wrapper.getTranslateX());

        // Move 'c' to the front: same tab COUNT, so the strip's equal-width mode
        // keeps every wrapper's width unchanged — only positions shift. 'b'
        // (still active) slides from slot 1 to slot 2, a size-stable move that
        // LayoutManager.commitBounds now drives via translate.
        bar.moveBarEntry('c', 0);
        bar.placeStrip(0, 0, 300, 30);

        expect(_indicator.getTranslateX()).toBe(wrapper.getX() + wrapper.getTranslateX());
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

describe('TabBar busy state', () => {
    afterEach(() => DOM.reset());

    it('setEntryBusy(id, true) marks the entry busy; setEntryBusy(id, false) clears it', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);

        expect(bar.isEntryBusy('a')).toBe(true);

        bar.setEntryBusy('a', false);

        expect(bar.isEntryBusy('a')).toBe(false);
    });

    it('setEntryBusy on an unknown id is a no-op and chainable; isEntryBusy is false', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        expect(bar.setEntryBusy('nope', true)).toBe(bar);
        expect(bar.isEntryBusy('nope')).toBe(false);
    });

    it('removeBarEntry clears the busy read for that id', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);
        bar.removeBarEntry('a');

        expect(bar.isEntryBusy('a')).toBe(false);
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

describe('TabBar glyph', () => {
    // 'file' / 'file-lines' are SVG-kind glyphs, so (per Glyph.test.ts's
    // convention) each case registers them and this cleans up afterward to
    // avoid leaking into the global registry.
    afterEach(() => {
        Glyph.unregister('file');
        Glyph.unregister('file-lines');
        DOM.reset();
    });

    it('7 — setEntryGlyph on an unknown id is a no-op and chainable; getEntryGlyph is null', () => {
        installTestDOM(CONFIG);

        const bar = threeEntryBar();

        expect(bar.setEntryGlyph('nope', 'file')).toBe(bar);
        expect(bar.getEntryGlyph('nope')).toBeNull();
        expect(barEntries(bar).every(e => e.button.getGlyph() === null)).toBe(true);
    });

    it('8 — swapping the active entry\'s glyph leaves it active and selected', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = threeEntryBar(); // 'a' is active

        bar.setEntryGlyph('a', 'file');

        expect(bar.getActiveEntryId()).toBe('a');
        expect(barEntries(bar)[0].button.isSelected()).toBe(true);
    });

    it('9 — swapping a closeable entry\'s glyph leaves its close button instance untouched', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());

        const before = barEntries(bar)[0].button.getCloseButton();

        bar.setEntryGlyph('a', 'file');

        expect(barEntries(bar)[0].button.getCloseButton()).toBe(before);
    });

    it('10 — swapping a busy entry\'s glyph leaves it busy', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.setEntryBusy('a', true);

        bar.setEntryGlyph('a', 'file');

        expect(bar.isEntryBusy('a')).toBe(true);
    });

    it('13 — setEntryGlyph disposes the glyph it replaces', () => {
        installTestDOM(CONFIG);
        Glyph.register(file, file_lines);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', glyphed('file'));

        const fn = vi.fn();
        barEntries(bar)[0].button.getGlyph()!.onDestroy(fn);

        bar.setEntryGlyph('a', 'file-lines');

        expect(fn).toHaveBeenCalled();
        expect(bar.getEntryGlyph('a')).toBe('file-lines');
    });

    it('14 — clearEntryGlyph disposes the glyph it removes', () => {
        installTestDOM(CONFIG);
        Glyph.register(file);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', glyphed('file'));

        const fn = vi.fn();
        barEntries(bar)[0].button.getGlyph()!.onDestroy(fn);

        bar.clearEntryGlyph('a');

        expect(fn).toHaveBeenCalled();
        expect(bar.getEntryGlyph('a')).toBeNull();
    });
});
