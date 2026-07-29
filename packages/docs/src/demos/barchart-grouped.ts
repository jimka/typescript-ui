import type { Component } from '@jimka/typescript-ui/core';
import { BarChart } from '@jimka/typescript-ui/component/chart';

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
 * An in-memory, grouped `BarChart` over two product series; hover a bar
 * for its tooltip, click a legend entry to toggle that series.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const chart = BarChart({
        series: [
            {
                name: 'Widgets',
                data: [{ x: 1, y: 12 }, { x: 2, y: 19 }, { x: 3, y: 15 }, { x: 4, y: 22 }],
            },
            {
                name: 'Gadgets',
                data: [{ x: 1, y: 9 }, { x: 2, y: 14 }, { x: 3, y: 20 }, { x: 4, y: 11 }],
            },
        ],
        grouped:    true,
        xAxisLabel: 'Quarter',
        yAxisLabel: 'Units',
    });

    return chart;
}
