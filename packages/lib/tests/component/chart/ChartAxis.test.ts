// Axis rendering is native (no d3-axis): drawAxis walks the scale's ticks and
// emits SVG marks through a MarkFactory. These assert the recorded mark set —
// tick count, label strings, orientation-specific attributes — and the margin
// arithmetic. Pixel geometry is manual-verify.
import { describe, it, expect } from 'vitest';
import { drawAxis, measureAxisMargin, DEFAULT_TICK_COUNT } from '~/component/chart/ChartAxis';
import { linearScale, bandScale, tickFormatter, scaleTicks } from '~/component/chart/Scale';
import type { MarkFactory, PlotRect } from '~/component/chart/types';
import type { Handle, ElementPatch } from '~/core/DOM';

/** A recording MarkFactory: captures every created mark for assertions. */
function recorder(): { create: MarkFactory; marks: Array<{ tag: string; patch: ElementPatch }> } {
    const marks: Array<{ tag: string; patch: ElementPatch }> = [];
    const create: MarkFactory = (tag, patch) => {
        marks.push({ tag, patch });

        return 0 as unknown as Handle;
    };

    return { create, marks };
}

const PLOT: PlotRect = { x: 40, y: 10, width: 300, height: 200 };

describe('drawAxis', () => {
    it('draws a bottom band axis: one axis line, and a tick + label per category', () => {
        const scale = bandScale(['Q1', 'Q2', 'Q3'], [PLOT.x, PLOT.x + PLOT.width]);
        const { create, marks } = recorder();

        drawAxis(create, 'bottom', scale, PLOT, { tickCount: DEFAULT_TICK_COUNT, format: tickFormatter(scale, DEFAULT_TICK_COUNT), grid: false });

        const texts = marks.filter((m) => m.tag === 'text');
        const lines = marks.filter((m) => m.tag === 'line');

        // One axis line + one tick line per category.
        expect(lines.length).toBe(1 + 3);
        // One label per category, in order.
        expect(texts.map((t) => t.patch.text)).toEqual(['Q1', 'Q2', 'Q3']);
        // Bottom labels are centre-anchored.
        expect(texts[0].patch.setAttr!['text-anchor']).toBe('middle');
    });

    it('draws gridlines when requested (one extra line per tick)', () => {
        const scale = bandScale(['a', 'b'], [PLOT.x, PLOT.x + PLOT.width]);
        const withoutGrid = recorder();
        const withGrid = recorder();

        drawAxis(withoutGrid.create, 'bottom', scale, PLOT, { tickCount: DEFAULT_TICK_COUNT, format: tickFormatter(scale, DEFAULT_TICK_COUNT), grid: false });
        drawAxis(withGrid.create, 'bottom', scale, PLOT, { tickCount: DEFAULT_TICK_COUNT, format: tickFormatter(scale, DEFAULT_TICK_COUNT), grid: true });

        const gridDelta = withGrid.marks.filter((m) => m.tag === 'line').length
            - withoutGrid.marks.filter((m) => m.tag === 'line').length;

        expect(gridDelta).toBe(2); // one gridline per category
    });

    it('draws a left linear axis with end-anchored labels matching the ticks', () => {
        const scale = linearScale([0, 100], [PLOT.y + PLOT.height, PLOT.y]);
        const format = tickFormatter(scale, DEFAULT_TICK_COUNT);
        const { create, marks } = recorder();

        drawAxis(create, 'left', scale, PLOT, { tickCount: DEFAULT_TICK_COUNT, format, grid: true });

        const texts = marks.filter((m) => m.tag === 'text');
        const expectedLabels = (scaleTicks(scale, DEFAULT_TICK_COUNT) as number[]).map(format);

        expect(texts.map((t) => t.patch.text)).toEqual(expectedLabels);
        expect(texts[0].patch.setAttr!['text-anchor']).toBe('end');
    });
});

describe('measureAxisMargin', () => {
    it('grows with longer y-axis label strings', () => {
        const scale = linearScale([0, 100], [0, 200]);
        const shortFmt = () => '1';
        const longFmt = () => '1,000,000,000';

        const shortMargin = measureAxisMargin('left', scale, shortFmt, DEFAULT_TICK_COUNT);
        const longMargin = measureAxisMargin('left', scale, longFmt, DEFAULT_TICK_COUNT);

        expect(longMargin).toBeGreaterThan(shortMargin);
    });

    it('reserves a constant one-line height for a bottom axis', () => {
        const scale = bandScale(['a', 'b', 'c'], [0, 300]);
        const margin = measureAxisMargin('bottom', scale, tickFormatter(scale, DEFAULT_TICK_COUNT), DEFAULT_TICK_COUNT);

        expect(margin).toBeGreaterThan(0);
    });
});
