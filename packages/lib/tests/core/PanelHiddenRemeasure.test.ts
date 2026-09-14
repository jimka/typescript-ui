// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for undisplay-inactive-tab-pages.md: `Panel.remeasureScrollMetrics`
 * withholds its live scroll-metric read while the panel is not effectively
 * visible (a `display: none` ancestor reports every metric as zero, which
 * would otherwise clear the reserved scrollbar gutter), and
 * `Panel.onEffectiveVisibilityChange` schedules the withheld catch-up layout
 * on the way back to visible. Case numbers below refer to the plan's
 * `## Expected Behaviour` list (21-23). Mirrors the private-method access
 * idiom of `PanelOverlayScrollbar.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
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
afterEach(() => {
    vi.restoreAllMocks();
    DOM.reset();
});

/** Narrow shape reaching the private remeasure method/gutter without `any`. */
type PanelInternals = {
    _scrollbarGutter: { right: number; bottom: number };
    remeasureScrollMetrics(): void;
    onEffectiveVisibilityChange(effective: boolean): void;
};

function internals(panel: Panel): PanelInternals {
    return panel as unknown as PanelInternals;
}

describe('Panel.remeasureScrollMetrics withholds its read while not effectively visible (case 21)', () => {
    it('leaves the reserved scrollbar gutter at its pre-hide value instead of clearing it to zero', () => {
        const ancestor = new Component({});
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });

        ancestor.addComponent(panel);
        ancestor.getElement(true);
        panel.getElement(true);

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 200, scrollHeight: 300,
            clientWidth: 200, clientHeight: 150,
        });

        internals(panel).remeasureScrollMetrics(); // establishes a non-zero gutter

        const gutterBefore = internals(panel)._scrollbarGutter.right;
        expect(gutterBefore).toBeGreaterThan(0);

        ancestor.setDisplayed(false);
        expect(panel.isEffectivelyVisible()).toBe(false);

        // Simulate the metrics collapsing to zero, as a display: none subtree
        // reports every scroll metric while it has no boxes.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 0, scrollHeight: 0,
            clientWidth: 0, clientHeight: 0,
        });

        internals(panel).remeasureScrollMetrics();

        expect(internals(panel)._scrollbarGutter.right).toBe(gutterBefore);
    });
});

describe('Panel.onEffectiveVisibilityChange schedules the withheld catch-up (case 22)', () => {
    it('schedules a layout on becoming visible, but not on becoming hidden', () => {
        const panel: Panel = new Panel({ autoScroll: 'auto', scrollbarStyle: 'native' });
        panel.getElement(true);

        const scheduleSpy = vi.spyOn(panel, 'scheduleLayout');

        internals(panel).onEffectiveVisibilityChange(false);
        expect(scheduleSpy).not.toHaveBeenCalled();

        internals(panel).onEffectiveVisibilityChange(true);
        expect(scheduleSpy).toHaveBeenCalledTimes(1);
    });
});

describe("A panel with autoScroll: 'none' schedules nothing either way (case 23)", () => {
    it('calls scheduleLayout in neither direction', () => {
        const panel: Panel = new Panel({ autoScroll: 'none' });
        panel.getElement(true);

        const scheduleSpy = vi.spyOn(panel, 'scheduleLayout');

        internals(panel).onEffectiveVisibilityChange(true);
        internals(panel).onEffectiveVisibilityChange(false);

        expect(scheduleSpy).not.toHaveBeenCalled();
    });
});
