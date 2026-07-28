import type { Component } from '@jimka/typescript-ui/core';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { LineChart } from '@jimka/typescript-ui/component/chart';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 320 is the plot, its axes, and the legend.
 */
export const height: number = 320;

/**
 * A store-bound `LineChart` over two regional sales series; click a legend
 * entry to toggle that series, click a point to select it.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const model = new Model([
        { name: 'id',     type: 'number' },
        { name: 'month',  type: 'number' },
        { name: 'sales',  type: 'number' },
        { name: 'region', type: 'string' },
    ]);

    const store = new MemoryStore(model, [
        { id: 1, month: 1, sales: 30, region: 'North' },
        { id: 2, month: 2, sales: 45, region: 'North' },
        { id: 3, month: 3, sales: 38, region: 'North' },
        { id: 4, month: 4, sales: 55, region: 'North' },
        { id: 5, month: 1, sales: 20, region: 'South' },
        { id: 6, month: 2, sales: 28, region: 'South' },
        { id: 7, month: 3, sales: 50, region: 'South' },
        { id: 8, month: 4, sales: 42, region: 'South' },
    ]);

    const chart = LineChart({
        store,
        xField:      'month',
        yField:      'sales',
        seriesField: 'region',
        curved:      true,
        xAxisLabel:  'Month',
        yAxisLabel:  'Sales',
    });

    void store.load();

    return chart;
}
