//
// Coverage for the List `horizontalScrolling` seam — the opt-in that scrolls an
// over-long row instead of ellipsising it.
//
// Two invariants carry the feature, and both are easy to break silently:
//
//   1. The row's natural width must reach the column's *overflow inflation*
//      without becoming a *minimum*. A minimum propagates outward (VBox.getMinSize
//      → the scroll Panel → the list's Fit → Component.clampWidth), which would
//      widen the List element inside its host rather than scroll within it.
//   2. With the option off, nothing may measure. A list has always scrolled Y, so
//      `inflateForOverflow` calls `computeTotalMinSize` on every layout of every
//      list; an ungated natural-width scan would put a text measure per row into
//      all of them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _List } from '~/component/list/List';
import { ListItemRenderer } from '~/component/list/ListItemRenderer';
import { GlyphListItemRenderer } from '~/component/list/renderer/Glyph';

/** The row's own horizontal padding, both sides — the floor of any natural width. */
const ROW_PADDING_X_TOTAL = 16;

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const LONG  = 'SELECT customer_id, order_total FROM sales.orders WHERE region = 42';
const SHORT = 'a';

/** The list's inner scroll panel. */
function innerPanel(list: unknown): any {
    return (list as any)._innerPanel;
}

/** The inner panel's ListRowColumn. */
function column(list: unknown): any {
    return innerPanel(list).getLayoutManager();
}

describe('List horizontalScrolling', () => {
    it('defaults to off, leaving the scroll panel on the Y axis only', () => {
        const list = new _List({ items: [LONG] });

        expect(list.isHorizontalScrolling()).toBe(false);
        expect(innerPanel(list).getAutoScroll()).toBe('y');
    });

    it('turning it on opens the X axis, and turning it back off closes it', () => {
        const list = new _List({ items: [LONG] });

        list.setHorizontalScrolling(true);
        expect(list.isHorizontalScrolling()).toBe(true);
        expect(innerPanel(list).getAutoScroll()).toBe('auto');

        list.setHorizontalScrolling(false);
        expect(list.isHorizontalScrolling()).toBe(false);
        expect(innerPanel(list).getAutoScroll()).toBe('y');
    });

    it('is settable from the construction-time option', () => {
        const list = new _List({ items: [LONG], horizontalScrolling: true });

        expect(list.isHorizontalScrolling()).toBe(true);
        expect(innerPanel(list).getAutoScroll()).toBe('auto');
    });

    it('while on, the column inflates to the widest row and rows stay minimum-free', () => {
        const list = new _List({ items: [SHORT, LONG], horizontalScrolling: true });

        const widest = Math.max(...(list as any)._rowPool.map((r: any) => r.getNaturalWidth()));
        expect(widest).toBeGreaterThan(0);
        expect(column(list).computeTotalMinSize().width).toBe(widest);

        // The inflation must NOT have travelled out as a constraint — that is what
        // would widen the List inside its host instead of scrolling in it.
        for (const row of (list as any)._rowPool) {
            expect(row.getMinSize()?.width ?? 0).toBe(0);
        }

        expect(innerPanel(list).getMinSize()?.width ?? 0).toBe(0);
        expect(list.getMinSize()?.width ?? 0).toBeLessThanOrEqual(100);
    });

    it('a longer label reports a wider natural width than a short one', () => {
        const list = new _List({ items: [SHORT, LONG], horizontalScrolling: true });

        const [shortRow, longRow] = (list as any)._rowPool;
        expect(longRow.getNaturalWidth()).toBeGreaterThan(shortRow.getNaturalWidth());
    });

    it('the glyph renderer bills the icon gutter on top of its label', () => {
        const bare  = new GlyphListItemRenderer();
        const iconed = new GlyphListItemRenderer();

        bare.update({ item: { key: 'a', label: 'Alpha' }, index: 0 });
        iconed.update({ item: { key: 'a', label: 'Alpha', glyph: 'unicode-arrow-up' }, index: 0 });

        expect(iconed.getContentWidth()).toBeGreaterThan(bare.getContentWidth());
    });

    it('a renderer that does not override getContentWidth reports no intrinsic width', () => {
        // The base contract: a custom renderer written before this option existed
        // keeps working — it just never extends the scroll extent, so its rows
        // stay at the viewport width and nothing scrolls.
        class Custom extends ListItemRenderer {
            update(): void { /* paints nothing measurable */ }
            layoutChildren(): void { /* no children */ }
        }

        const list = new _List({
            items:               [LONG, SHORT],
            horizontalScrolling: true,
            rendererFactory:     () => new Custom(),
        });

        expect(new Custom().getContentWidth()).toBe(0);
        // Only the rows' own padding, never a content width.
        expect(column(list).computeTotalMinSize().width).toBe(ROW_PADDING_X_TOTAL);
    });

    it('with the option off, the column never measures a renderer', () => {
        const list = new _List({ items: [LONG, SHORT] });

        let measured = 0;
        for (const row of (list as any)._rowPool) {
            const renderer = row._renderer;
            const original = renderer.getContentWidth.bind(renderer);
            renderer.getContentWidth = () => { measured += 1; return original(); };
        }

        // A list has always scrolled Y, so this runs on every layout — it must not
        // drag a per-row text measure along with it.
        expect(column(list).computeTotalMinSize().width).toBe(0);
        expect(measured).toBe(0);
    });

    it('with the option on, the column does measure the rows', () => {
        const list = new _List({ items: [LONG, SHORT], horizontalScrolling: true });

        let measured = 0;
        for (const row of (list as any)._rowPool) {
            const renderer = row._renderer;
            const original = renderer.getContentWidth.bind(renderer);
            renderer.getContentWidth = () => { measured += 1; return original(); };
        }

        column(list).computeTotalMinSize();
        expect(measured).toBe(2);
    });
});
