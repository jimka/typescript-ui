import { describe, it, expect, vi, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
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

/** Three-entry strip (a active), matching the existing TabBar suite's fixture. */
function threeEntryBar(): TabBar {
    const bar = new TabBar();
    bar.createBarEntry('a', 'Alpha');
    bar.createBarEntry('b', 'Beta');
    bar.createBarEntry('c', 'Gamma');
    return bar;
}

afterEach(() => DOM.reset());

describe('TabBar — width-mode contract', () => {
    it('defaults widthMode to equal and round-trips setWidthMode', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getWidthMode()).toBe('equal');
        bar.setWidthMode('fixed');
        expect(bar.getWidthMode()).toBe('fixed');
    });

    it('defaults fixedWidth to 120 and round-trips setFixedWidth', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getFixedWidth()).toBe(120);
        bar.setFixedWidth(200);
        expect(bar.getFixedWidth()).toBe(200);
    });

    it('defaults maxWidth to null and round-trips setMaxWidth incl. clearing to null', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getMaxWidth()).toBeNull();
        bar.setMaxWidth(150);
        expect(bar.getMaxWidth()).toBe(150);
        bar.setMaxWidth(null);
        expect(bar.getMaxWidth()).toBeNull();
    });
});

describe('TabBar — layout-flag setters round-trip', () => {
    it('side defaults north, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getSide()).toBe('north');
        bar.setSide('south');
        expect(bar.getSide()).toBe('south');
    });

    it('orientation defaults horizontal, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getOrientation()).toBe('horizontal');
        bar.setOrientation('vertical-cw');
        expect(bar.getOrientation()).toBe('vertical-cw');
    });

    it('align defaults start, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getAlign()).toBe('start');
        bar.setAlign('end');
        expect(bar.getAlign()).toBe('end');
    });

    it('textAlign defaults center, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getTextAlign()).toBe('center');
        bar.setTextAlign('start');
        expect(bar.getTextAlign()).toBe('start');
    });

    it('scrollable defaults false, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.isScrollable()).toBe(false);
        bar.setScrollable(true);
        expect(bar.isScrollable()).toBe(true);
    });

    it('compact defaults false, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.isCompact()).toBe(false);
        bar.setCompact(true);
        expect(bar.isCompact()).toBe(true);
    });

    it('reorderable defaults false, round-trips', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.isReorderable()).toBe(false);
        bar.setReorderable(true);
        expect(bar.isReorderable()).toBe(true);
    });

    it('setUnderBorderFullWidth pins the value away from the theme default', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        bar.setUnderBorderFullWidth(false);
        expect(bar.isUnderBorderFullWidth()).toBe(false);
        bar.setUnderBorderFullWidth(true);
        expect(bar.isUnderBorderFullWidth()).toBe(true);
    });
});

describe('TabBar — setActiveVisual vs setActiveEntry', () => {
    it('setActiveEntry moves the active id and emits tabpressed', () => {
        installTestDOM(CONFIG);
        const bar = threeEntryBar();
        const spy = vi.fn();
        bar.on('tabpressed', spy);

        bar.setActiveEntry('b');

        expect(bar.getActiveEntryId()).toBe('b');
        expect(spy).toHaveBeenCalledWith('b');
    });

    it('setActiveVisual moves the active id WITHOUT emitting tabpressed', () => {
        installTestDOM(CONFIG);
        const bar = threeEntryBar();
        const spy = vi.fn();
        bar.on('tabpressed', spy);

        bar.setActiveVisual('c');

        expect(bar.getActiveEntryId()).toBe('c'); // visual re-select still commits the active id…
        expect(spy).not.toHaveBeenCalled();        // …but fires no selection event
    });

    it('setActiveVisual with an unknown id is a no-op', () => {
        installTestDOM(CONFIG);
        const bar = threeEntryBar(); // active 'a'
        bar.setActiveVisual('nope');
        expect(bar.getActiveEntryId()).toBe('a');
    });
});

describe('TabBar — content id / button id', () => {
    it('getEntryButtonId returns the per-entry button id, and "" for an unknown id', () => {
        installTestDOM(CONFIG);
        const bar = threeEntryBar();
        expect(bar.getEntryButtonId('a')).not.toBe('');
        expect(bar.getEntryButtonId('a')).not.toBe(bar.getEntryButtonId('b')); // distinct per entry
        expect(bar.getEntryButtonId('missing')).toBe('');
    });

    it('setEntryContentId is chainable and a no-op for an unknown id', () => {
        installTestDOM(CONFIG);
        const bar = threeEntryBar();
        expect(bar.setEntryContentId('a', 'content-a')).toBe(bar);
        expect(() => bar.setEntryContentId('missing', 'content-x')).not.toThrow();
    });
});

describe('TabBar — tools & leading widget', () => {
    it('addTool / removeTool are chainable', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        const tool = new Component();
        expect(bar.addTool(tool)).toBe(bar);
        expect(bar.removeTool(tool)).toBe(bar);
    });

    it('leading widget round-trips including clearing to null', () => {
        installTestDOM(CONFIG);
        const bar = new TabBar();
        expect(bar.getLeadingWidget()).toBeNull();
        const widget = new Component();
        bar.setLeadingWidget(widget);
        expect(bar.getLeadingWidget()).toBe(widget);
        bar.setLeadingWidget(null);
        expect(bar.getLeadingWidget()).toBeNull();
    });
});
