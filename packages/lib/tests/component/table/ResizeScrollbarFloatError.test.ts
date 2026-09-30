// A table whose columns fit its width must not show a horizontal scrollbar at
// any width it is resized through. Each resize rescales the flexible columns
// proportionally, and for some widths the rescaled widths sum to a hair over
// the width they were scaled to fill (823.0000000000001 against 823). Read as
// overflow, that float error flashed the horizontal bar on for single frames
// mid-drag — shrinking the viewport by a track and dragging the bottom scroll
// shadow up with it — and off again on the next width that summed exactly.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { Component } from '~/core/Component';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reads the body scroller's horizontal bar — private, as no public API exposes it. */
function horizontalBar(table: Table): Component {
    return (table.getBody() as unknown as { _scroller: { _scrollbarH: Component } })._scroller._scrollbarH;
}

describe('Table resize — horizontal scrollbar vs. column-width float error', () => {
    it('never shows the horizontal bar while the rescaled columns fit', async () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
            { name: 'c', type: 'string', order: 2 },
        ]);
        // Enough rows to force the vertical bar, so the columns fill the width
        // left beside it — the "slow table" demo's shape.
        const store = new MemoryStore(model, Array.from({ length: 100 }, (_, i) => ({ a: 'a' + i, b: 'b' + i, c: 'c' + i })));
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setHeight(300);
        table.setWidth(600);
        table.doLayout();

        let overshoots = 0;

        for (let width = 600; width <= 900; width += 7) {
            table.setWidth(width);
            table.doLayout();

            const sum       = table.getColumnWidths().reduce((s, w) => s + w, 0);
            const available = table.getAvailableColumnWidth();

            // Only the fitting case is under test; genuine overflow may show the bar.
            if (sum - available > 0.5) {
                continue;
            }

            if (sum > available) {
                overshoots++;
            }

            expect(horizontalBar(table).isDisplayed(), `width ${width}: sum ${sum} vs ${available}`).toBe(false);
        }

        // Guard: the sweep must actually hit the float-overshoot case, or it
        // proves nothing about it.
        expect(overshoots).toBeGreaterThan(0);
    });
});
