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

/** Seeds the panel's last-seen content extent (as a prior layout pass would). */
function seedLastExtent(panel: _Panel, width: number, height: number): void {
    (panel as unknown as { _lastContentExtent: { width: number; height: number } })._lastContentExtent = { width, height };
}

/**
 * Lights a shadow edge so `showsScrollAffordance` reports an on-screen scroll
 * affordance — the offline DOM models no overflow, so this stands in for the
 * gutter/shadow a real overflowing pass would have left.
 */
function seedAffordance(panel: _Panel): void {
    (panel as unknown as { _shadowEdges: { top: number; bottom: number; left: number; right: number } })._shadowEdges = { top: 0, bottom: 50, left: 0, right: 0 };
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

    it('schedules a follow-up when nested content shrinks (preferred extent drops) with the child count unchanged', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.addComponent(new Component());

        // A prior overflowing pass left an affordance on screen and recorded a
        // far taller content extent; the direct child count is unchanged because
        // the shrink happened inside a descendant (the FilterDialog case).
        seedAffordance(panel);
        seedLastExtent(panel, 10_000, 10_000);
        seedLastCount(panel, 1);

        const spy = vi.spyOn(panel, 'scheduleLayout');

        settle(panel);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not read the extent (nor schedule) when no scroll affordance is showing', () => {
        const panel = new _Panel({ autoScroll: 'y' });
        panel.addComponent(new Component());

        // Extent would look shrunk, but with no affordance on screen there is
        // nothing stale to settle, so the extent path is skipped entirely.
        seedLastExtent(panel, 10_000, 10_000);
        seedLastCount(panel, 1);

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
