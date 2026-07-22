// AbstractChart data resolution + the concrete charts' mark sets. Series-model
// resolution, store binding symmetry, and the recorded SVG mark set are offline;
// pixel geometry and live events are manual-verify.
import { describe, it, expect, vi } from 'vitest';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _LineChart } from '~/component/chart/LineChart';
import { _BarChart } from '~/component/chart/BarChart';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';
import { DOM } from '~/core/DOM';
import type { ChartSeriesModel } from '~/component/chart/types';
import type { ElementPatch, Handle } from '~/core/DOM';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Extracts the created-mark tags of a given SVG tag from a recording sink. */
function createdTags(sink: { writes: Array<{ op: string; args: unknown[] }> }, tag: string): number {
    return sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === tag).length;
}

/** Collects the (series, index) tuples from every data-index-carrying patch. */
function dataMarks(sink: { writes: Array<{ op: string; args: unknown[] }> }): Array<{ series: string; index: string }> {
    const marks: Array<{ series: string; index: string }> = [];

    for (const write of sink.writes) {
        if (write.op !== 'apply') {
            continue;
        }

        const patch = write.args[1] as ElementPatch;
        const attr = patch.setAttr;

        if (attr && attr['data-index'] !== undefined) {
            marks.push({ series: attr['data-series'], index: attr['data-index'] });
        }
    }

    return marks;
}

/** Renders and lays a chart out at a fixed size, returning the recording sink. */
function layout(chart: { getElement(create: boolean): unknown; setWidth(n: number): unknown; setHeight(n: number): unknown; doLayout(): unknown }, sink: { writes: Array<{ op: string; args: unknown[] }> }): void {
    chart.getElement(true);
    chart.setWidth(400);
    chart.setHeight(300);
    sink.writes.length = 0;
    chart.doLayout();
}

describe('series-model resolution', () => {
    it('copies an in-memory series verbatim', () => {
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }] });
        const model = (chart as unknown as { _series: ChartSeriesModel[] })._series;

        expect(model.length).toBe(1);
        expect(model[0].name).toBe('A');
        expect(model[0].points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
        expect(model[0].hidden).toBe(false);
    });

    it('getSeries returns a detached copy (mutating it does not touch the model)', () => {
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 0 }] }] });
        const copy = chart.getSeries();

        copy[0].data[0].x = 99;

        expect((chart as unknown as { _series: ChartSeriesModel[] })._series[0].points[0].x).toBe(0);
    });

    it('groups store records into one series per distinct seriesField value', async () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'month', type: 'number' }, { name: 'sales', type: 'number' }, { name: 'region', type: 'string' }]);
        const store = new MemoryStore(model, [
            { id: 1, month: 1, sales: 10, region: 'North' },
            { id: 2, month: 2, sales: 20, region: 'North' },
            { id: 3, month: 1, sales: 5, region: 'South' },
        ]);

        await store.load();

        const chart = new _LineChart({ store, xField: 'month', yField: 'sales', seriesField: 'region' });
        const series = (chart as unknown as { _series: ChartSeriesModel[] })._series;

        expect(series.map((s) => s.name)).toEqual(['North', 'South']);
        expect(series[0].points).toEqual([{ x: 1, y: 10 }, { x: 2, y: 20 }]);
        expect(series[1].points).toEqual([{ x: 1, y: 5 }]);
    });

    it('reads a single series when no seriesField is given', async () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'month', type: 'number' }, { name: 'sales', type: 'number' }]);
        const store = new MemoryStore(model, [{ id: 1, month: 1, sales: 10 }, { id: 2, month: 2, sales: 20 }]);

        await store.load();

        const chart = new _LineChart({ store, xField: 'month', yField: 'sales' });
        const series = (chart as unknown as { _series: ChartSeriesModel[] })._series;

        expect(series.length).toBe(1);
        expect(series[0].points).toEqual([{ x: 1, y: 10 }, { x: 2, y: 20 }]);
    });

    it('an empty store yields zero series without throwing', async () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }]);
        const store = new MemoryStore(model, []);

        await store.load();

        const chart = new _LineChart({ store, xField: 'x', yField: 'y' });

        expect((chart as unknown as { _series: ChartSeriesModel[] })._series).toEqual([]);
    });

    it('preserves a series hidden flag across a store refresh by name', async () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'g', type: 'string' }]);
        const store = new MemoryStore(model, [{ id: 1, x: 0, y: 1, g: 'A' }, { id: 2, x: 0, y: 2, g: 'B' }]);

        await store.load();

        const chart = new _LineChart({ store, xField: 'x', yField: 'y', seriesField: 'g' });
        const series = (chart as unknown as { _series: ChartSeriesModel[] })._series;

        series[0].hidden = true; // hide 'A'

        // A refresh (re-read of the same records) must keep 'A' hidden.
        (chart as unknown as { rebuildFromStore(): void }).rebuildFromStore();

        const after = (chart as unknown as { _series: ChartSeriesModel[] })._series;

        expect(after.find((s) => s.name === 'A')!.hidden).toBe(true);
        expect(after.find((s) => s.name === 'B')!.hidden).toBe(false);
    });
});

describe('store binding symmetry', () => {
    it('unsubscribes the previous store from all four events before binding the next', () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }]);
        const storeA = new MemoryStore(model, []);
        const storeB = new MemoryStore(model, []);
        const offA = vi.spyOn(storeA, 'off');
        const onB = vi.spyOn(storeB, 'on');

        const chart = new _LineChart({ store: storeA, xField: 'x', yField: 'y' });
        chart.setStore(storeB, 'x', 'y');

        expect(offA).toHaveBeenCalledTimes(4);
        expect(onB).toHaveBeenCalledTimes(4);
    });

    it('dispose unbinds the store and clears the binding', () => {
        const model = new Model([{ name: 'id', type: 'number' }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }]);
        const store = new MemoryStore(model, []);
        const off = vi.spyOn(store, 'off');

        const chart = new _LineChart({ store, xField: 'x', yField: 'y' });
        // `_legend` is a registered child (added via `addComponent`), so its
        // teardown is reached through the base class's recursive
        // `destructor()` call, never through its own public `dispose()` —
        // spy on `destructor` to match that contract.
        const legendDestructor = vi.spyOn(
            (chart as unknown as { _legend: { destructor(): void } })._legend as unknown as { destructor(): void },
            'destructor'
        );

        chart.dispose();

        expect(off).toHaveBeenCalledTimes(4);
        expect(chart.getStore()).toBeNull();
        // The internally-owned legend must be disposed too, or its subtree click
        // listener leaks in Event's module-level map.
        expect(legendDestructor).toHaveBeenCalledTimes(1);
    });

    it('dispose releases the last repaint marks (no retained-handle leak)', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], showLegend: false });

        layout(chart, sink);

        const marksBefore = (chart as unknown as { _marks: unknown[] })._marks.length;

        expect(marksBefore).toBeGreaterThan(0);

        const releasesBefore = sink.writes.filter((w) => w.op === 'release').length;
        chart.dispose();
        const releasesAfter = sink.writes.filter((w) => w.op === 'release').length;

        // Every tracked mark is detached-and-released, and the list is emptied.
        // `dispose()` now also fully tears the chart down (its own tracked
        // handles beyond the marks), so the release count only needs to be at
        // least the mark count, not exactly it.
        expect((chart as unknown as { _marks: unknown[] })._marks.length).toBe(0);
        expect(releasesAfter - releasesBefore).toBeGreaterThanOrEqual(marksBefore);
    });
});

describe('hit-testing (hitMark)', () => {
    /** White-box subclass exposing the private hit-test + a dataset-stub helper. */
    class HitChart extends _LineChart {
        public hit(datasets: Record<string, string | undefined>): { series: number; index: number | null } | null {
            // Stub the source seam so the dataset read returns the given attrs for
            // any (fake) event target — the pattern used elsewhere for source reads.
            vi.spyOn(DOM.source, 'isNode').mockReturnValue(true);
            vi.spyOn(DOM.source, 'intern').mockReturnValue(1 as unknown as Handle);
            vi.spyOn(DOM.source, 'getDataset').mockImplementation((_h, key) => datasets[key]);

            return (this as unknown as { hitMark(e: MouseEvent): { series: number; index: number | null } | null })
                .hitMark({ target: {} } as unknown as MouseEvent);
        }
    }

    const seriesFixture = [
        { name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
        { name: 'B', data: [{ x: 0, y: 3 }] },
    ];

    it('resolves a series-only mark (a line path) to a whole-series hit', () => {
        const chart = new HitChart({ series: seriesFixture });

        expect(chart.hit({ series: '0' })).toEqual({ series: 0, index: null });
    });

    it('resolves an indexed mark (a point/bar) to that datum', () => {
        const chart = new HitChart({ series: seriesFixture });

        expect(chart.hit({ series: '0', index: '1' })).toEqual({ series: 0, index: 1 });
    });

    it('returns null for a non-mark target (no data-series)', () => {
        const chart = new HitChart({ series: seriesFixture });

        expect(chart.hit({})).toBeNull();
    });

    it('returns null when the hit series is hidden', () => {
        const chart = new HitChart({ series: seriesFixture });

        (chart as unknown as { _series: ChartSeriesModel[] })._series[0].hidden = true;

        expect(chart.hit({ series: '0', index: '0' })).toBeNull();
    });

    it('returns null when the point index is out of range', () => {
        const chart = new HitChart({ series: seriesFixture });

        expect(chart.hit({ series: '1', index: '5' })).toBeNull();
    });
});

describe('LineChart mark set', () => {
    it('draws one path per visible series and a marker per point with ascending data-index', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }] }], showLegend: false });

        layout(chart, sink);

        expect(createdTags(sink, 'path')).toBe(1);
        expect(createdTags(sink, 'circle')).toBe(3);

        const marks = dataMarks(sink);

        expect(marks.map((m) => m.index)).toEqual(['0', '1', '2']);
        expect(marks.every((m) => m.series === '0')).toBe(true);
    });

    it('omits point markers when showPoints is false', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], showPoints: false, showLegend: false });

        layout(chart, sink);

        expect(createdTags(sink, 'path')).toBe(1);
        expect(createdTags(sink, 'circle')).toBe(0);
    });

    it('draws no marks for a hidden series', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }] }, { name: 'B', data: [{ x: 0, y: 2 }] }], showLegend: false });

        (chart as unknown as { _series: ChartSeriesModel[] })._series[0].hidden = true;

        layout(chart, sink);

        // Only series B's path remains.
        expect(createdTags(sink, 'path')).toBe(1);
    });
});

/** Collects every text-content string written by an apply patch. */
function textMarks(sink: { writes: Array<{ op: string; args: unknown[] }> }): string[] {
    const texts: string[] = [];

    for (const write of sink.writes) {
        if (write.op !== 'apply') {
            continue;
        }

        const patch = write.args[1] as ElementPatch;

        if (patch.text !== undefined) {
            texts.push(patch.text);
        }
    }

    return texts;
}

describe('axis titles', () => {
    it('draws the x/y axis titles when the label options are set', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], xAxisLabel: 'Month', yAxisLabel: 'Sales', showLegend: false });

        expect(chart.getXAxisLabel()).toBe('Month');
        expect(chart.getYAxisLabel()).toBe('Sales');

        layout(chart, sink);

        const texts = textMarks(sink);

        expect(texts).toContain('Month');
        expect(texts).toContain('Sales');
    });

    it('draws no axis titles when the label options are absent', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _LineChart({ series: [{ name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], showLegend: false });

        expect(chart.getXAxisLabel()).toBeNull();

        layout(chart, sink);

        // Tick labels are drawn, but neither of these title strings.
        const texts = textMarks(sink);

        expect(texts).not.toContain('Month');
        expect(texts).not.toContain('Sales');
    });
});

describe('BarChart mark set', () => {
    it('draws one rect per (visible series × point)', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _BarChart({
            series: [
                { name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
                { name: 'B', data: [{ x: 0, y: 3 }, { x: 1, y: 4 }] },
            ],
            showLegend: false,
        });

        layout(chart, sink);

        expect(createdTags(sink, 'rect')).toBe(4);
    });

    it('drops a hidden series bars', () => {
        const sink = installTestDOM(CONFIG);
        const chart = new _BarChart({
            series: [
                { name: 'A', data: [{ x: 0, y: 1 }, { x: 1, y: 2 }] },
                { name: 'B', data: [{ x: 0, y: 3 }, { x: 1, y: 4 }] },
            ],
            showLegend: false,
        });

        (chart as unknown as { _series: ChartSeriesModel[] })._series[1].hidden = true;

        layout(chart, sink);

        expect(createdTags(sink, 'rect')).toBe(2);
    });
});

// A settled chart laid out again with no state change must not dirty itself.
// `doLayout` -> `reserveLegend` rebuilds the legend rows every pass; each
// `addComponent` fires the legend's preferred-size relay, which `wireChild`
// wired to `chart.scheduleLayout()` — re-arming the rAF flush forever and
// pinning the CPU at ~one full relayout per frame with no visible change.
describe('steady-state layout stability', () => {
    it('does not re-schedule its own layout on a no-op doLayout (relayout-loop guard)', () => {
        installTestDOM(CONFIG);

        const chart = new _LineChart({
            series:     [{ name: 'A', data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
            showLegend: true,
        });

        chart.getElement(true);
        chart.setWidth(400);
        chart.setHeight(300);
        chart.flushLayout();

        const scheduleSpy = vi.spyOn(chart, 'scheduleLayout');

        chart.doLayout();

        expect(scheduleSpy).not.toHaveBeenCalled();
    });
});
