// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { LineChart, BarChart } from '@jimka/typescript-ui/component/chart';
import type { ChartSelectionEvent } from '@jimka/typescript-ui/component/chart';

/** Monthly-sales model for the store-bound line chart, split by region. */
const SalesModel = new Model([
    { name: 'id',     type: 'number' },
    { name: 'month',  type: 'number' },
    { name: 'sales',  type: 'number' },
    { name: 'region', type: 'string' },
]);

/**
 * Demo panel for the charting family: a store-bound
 * [`LineChart`](/api/component/chart/classes/LineChart) (monthly sales split
 * into two regional series, with point markers and a monotone curve) beside an
 * in-memory [`BarChart`](/api/component/chart/classes/BarChart) (quarterly
 * figures for two products, grouped). Both show the legend (click an entry to
 * toggle its series), a hover tooltip, and click-to-select. A theme switch
 * recolours everything with no reload.
 */
class ChartDemoPanel extends Panel {

    constructor() {
        super();

        this.setLayoutManager(new HBox({ mode: 'equal', spacing: 12, stretching: true }));

        this.addComponent(this.buildLineChart());
        this.addComponent(this.buildBarChart());
    }

    /**
     * Builds the store-bound line chart and kicks off the store load; the chart
     * rebuilds itself from the `load` event.
     *
     * @returns The line chart.
     */
    private buildLineChart(): LineChart {
        const store = new MemoryStore(SalesModel, [
            { id: 1, month: 1, sales: 30, region: 'North' },
            { id: 2, month: 2, sales: 45, region: 'North' },
            { id: 3, month: 3, sales: 38, region: 'North' },
            { id: 4, month: 4, sales: 55, region: 'North' },
            { id: 5, month: 1, sales: 20, region: 'South' },
            { id: 6, month: 2, sales: 28, region: 'South' },
            { id: 7, month: 3, sales: 50, region: 'South' },
            { id: 8, month: 4, sales: 42, region: 'South' },
        ]);

        const chart = new LineChart({
            store,
            xField:         'month',
            yField:         'sales',
            seriesField:    'region',
            curved:         true,
            xAxisLabel:     'Month',
            yAxisLabel:     'Sales',
            legendPosition: 'right',
            listeners:      { selection: (e: ChartSelectionEvent) => this.reportSelection('LineChart', e) },
        });

        void store.load();

        return chart;
    }

    /**
     * Builds the in-memory grouped bar chart.
     *
     * @returns The bar chart.
     */
    private buildBarChart(): BarChart {
        return new BarChart({
            series: [
                { name: 'Widgets', data: [{ x: 1, y: 12 }, { x: 2, y: 19 }, { x: 3, y: 15 }, { x: 4, y: 22 }] },
                { name: 'Gadgets', data: [{ x: 1, y: 9 }, { x: 2, y: 14 }, { x: 3, y: 20 }, { x: 4, y: 11 }] },
            ],
            grouped:        true,
            xAxisLabel:     'Quarter',
            yAxisLabel:     'Units',
            legendPosition: 'bottom',
            listeners:      { selection: (e: ChartSelectionEvent) => this.reportSelection('BarChart', e) },
        });
    }

    /**
     * Logs a selection event so the demo surfaces click-to-select behaviour.
     *
     * @param source - The chart that fired the event.
     * @param event - The selection payload.
     */
    private reportSelection(source: string, event: ChartSelectionEvent): void {
        console.log(`${source} selected ${event.seriesName} (${event.point.x}, ${event.point.y})`);
    }
}

const ChartDemoPanelCallable = callable(ChartDemoPanel);
type ChartDemoPanelCallable = ChartDemoPanel;
export {
    ChartDemoPanel         as _ChartDemoPanel,
    ChartDemoPanelCallable as ChartDemoPanel
};
