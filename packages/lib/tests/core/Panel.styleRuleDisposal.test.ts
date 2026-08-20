// Regression: Panel's two overlay Scrollbars are appended straight onto the
// panel element with a raw `DOM.sink.appendChild` (installOverlayScrollbars)
// and held only in the private `_scrollbarV` / `_scrollbarH` fields, so they
// are never registered via `addComponent`. `Component.destructor()`'s child
// recursion walks `_components` and so never reaches them, and
// `removeOverlayScrollbars` tore them down with `removeElement()`, which
// removes the DOM element but never disposes the component's own per-instance
// stylesheet rule. See plans/implemented/scrollbar-leak-and-layout-guards.md
// (Bug 1).
import { describe, it, expect, afterEach } from 'vitest';
import { _Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(panel: _Panel): void {
    (panel as unknown as { destructor(): void }).destructor();
}

/** A rendered, laid-out Panel with both overlay scrollbars installed. */
function renderedPanel(): _Panel {
    const panel = new _Panel({ autoScroll: 'both' });

    panel.getElement(true);
    panel.setWidth(300);
    panel.setHeight(300);
    panel.doLayout();

    return panel;
}

describe('Panel — overlay scrollbar style-rule disposal', () => {
    it('B1-1: leaves no per-instance rule behind after a rendered panel is destroyed', () => {
        installTestDOM(CONFIG);

        // Warm-up pass: keeps any process-global rule a class materialises on
        // first use out of the diff below.
        destroy(renderedPanel());

        const before = new Set(_ruleCacheKeys());

        const panel = renderedPanel();

        expect(_ruleCacheKeys().length).toBeGreaterThan(before.size);

        destroy(panel);

        // The contract is total: a destroyed panel must not retain a single new
        // rule on the shared sheet, or the sheet grows without bound across churn.
        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

    it('B1-2: setScrollbarStyle("native") disposes the overlay bars\' rules, and switching back to "overlay" builds fresh ones', () => {
        installTestDOM(CONFIG);

        const panel = renderedPanel();
        const bars  = panel as unknown as {
            _scrollbarV: { getId(): string; _arrowStart: { _glyph: { getId(): string } } } | null;
            _scrollbarH: { getId(): string; _arrowStart: { _glyph: { getId(): string } } } | null;
        };

        const originalVId      = bars._scrollbarV!.getId();
        const originalHId      = bars._scrollbarH!.getId();
        const originalVArrowId = bars._scrollbarV!._arrowStart._glyph.getId();
        const originalHArrowId = bars._scrollbarH!._arrowStart._glyph.getId();

        panel.setScrollbarStyle('native');

        // The original bars' own rules must be gone — not just their elements.
        expect(_ruleCacheKeys().some((key) => key.includes(originalVId))).toBe(false);
        expect(_ruleCacheKeys().some((key) => key.includes(originalHId))).toBe(false);
        expect(_ruleCacheKeys().some((key) => key.includes(originalVArrowId))).toBe(false);
        expect(_ruleCacheKeys().some((key) => key.includes(originalHArrowId))).toBe(false);

        panel.setScrollbarStyle('overlay');
        panel.doLayout();

        // The panel is still usable: a fresh pair of Scrollbars was built and
        // installed. The scrollbar root itself may legitimately end up with no
        // materialised rule of its own now — since
        // plans/implemented/reconciled-write-path-widening.md, its constructor's
        // `setUserSelect("none")` also dedupes onto the framework tier once
        // rendered, and nothing else about a fresh Scrollbar deviates from the
        // class/framework baseline. The thumb is no longer a reliable proxy
        // either — plans/implemented/delegate-class-style-defaults-followups.md
        // moved its resting cursor/backgroundColor onto the shared
        // `.ScrollbarThumb` class rule, so a thumb with no other deviation now
        // materialises no `#id` rule of its own at all. The start arrow button
        // itself is no longer reliable either —
        // plans/implemented/state-tier-rule-dedup-followups.md hoisted its
        // resting `foregroundColor` onto the shared `.ScrollArrowButton` class
        // rule too, so a never-disabled arrow now also materialises no `#id`
        // rule of its own. Its glyph child is the reliable per-instance proxy
        // instead: `Glyph.setFontSize` always writes its own `#id` rule
        // directly (no class-default dedup for that property), and the glyph
        // is only reachable through the scrollbar's own destructor recursion
        // (Scrollbar -> ScrollArrowButton -> Glyph), which is what B1-1/B1-2
        // actually guard.
        expect(bars._scrollbarV).not.toBeNull();
        expect(bars._scrollbarH).not.toBeNull();

        const freshVId      = bars._scrollbarV!.getId();
        const freshHId      = bars._scrollbarH!.getId();
        const freshVArrowId = bars._scrollbarV!._arrowStart._glyph.getId();
        const freshHArrowId = bars._scrollbarH!._arrowStart._glyph.getId();

        expect(freshVId).not.toBe(originalVId);
        expect(freshHId).not.toBe(originalHId);

        expect(_ruleCacheKeys().some((key) => key.includes(freshVArrowId))).toBe(true);
        expect(_ruleCacheKeys().some((key) => key.includes(freshHArrowId))).toBe(true);
    });
});
