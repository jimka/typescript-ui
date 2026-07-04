//
// Offline coverage for Panel.scheduleGutterSettleOnShrink — the follow-up
// re-measure that clears a reserved scrollbar gutter + scroll shadow after the
// panel's content shrinks.
//
// The offline DOM models no overflow (getScrollMetrics reports scrollHeight ===
// clientHeight), so the visual gutter/shadow transition itself cannot be
// reproduced here. What IS testable — and what this pins — is the scheduling
// contract: a child-count decrease on an autoScroll panel schedules exactly one
// follow-up layout pass, it does not loop, and a "none" panel never schedules.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
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
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** Invokes the private settle scheduler. */
function settle(panel: _Panel): void {
    (panel as unknown as { scheduleGutterSettleOnShrink(): void }).scheduleGutterSettleOnShrink();
}

/** Seeds the panel's last-seen child count (as a prior layout pass would). */
function seedLastCount(panel: _Panel, n: number): void {
    (panel as unknown as { _lastChildCount: number })._lastChildCount = n;
}

describe('Panel — gutter/shadow settle on shrink', () => {
    it('schedules one follow-up pass after a child-count decrease (autoScroll)', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.addComponent(new Component());

        // A prior pass saw two children; now one remains.
        seedLastCount(panel, 2);
        const spy = vi.spyOn(panel, 'scheduleLayout');

        settle(panel);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not loop — the follow-up pass (unchanged count) schedules nothing', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.addComponent(new Component());

        seedLastCount(panel, 2);
        const spy = vi.spyOn(panel, 'scheduleLayout');

        settle(panel);                       // 1 < 2 → shrank → schedules
        settle(panel);                       // 1 === 1 → no shrink → no schedule
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not schedule when the child count grows or holds', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.addComponent(new Component());
        panel.addComponent(new Component());

        seedLastCount(panel, 1);             // grew from 1 to 2
        const spy = vi.spyOn(panel, 'scheduleLayout');

        settle(panel);
        expect(spy).not.toHaveBeenCalled();
    });

    it('never schedules for a non-scrolling ("none") panel', () => {
        const panel = new _Panel({ autoScroll: 'none' });
        panel.addComponent(new Component());

        seedLastCount(panel, 3);             // shrank, but nothing to settle
        const spy = vi.spyOn(panel, 'scheduleLayout');

        settle(panel);
        expect(spy).not.toHaveBeenCalled();
    });
});
