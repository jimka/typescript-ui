// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle, ElementPatch } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Tooltip } from "~/overlay/Tooltip.js";
import { ThemeManager } from "~/core/Theme.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { AbstractStore, StoreEvent } from "~/data/AbstractStore.js";
import { drawAxis, measureAxisMargin, DEFAULT_TICK_COUNT } from "~/component/chart/ChartAxis.js";
import { tickFormatter } from "~/component/chart/Scale.js";
import type { ChartScale } from "~/component/chart/Scale.js";
import { ChartLegend } from "~/component/chart/ChartLegend.js";
import type {
    ChartPoint,
    ChartSeries,
    ChartSeriesModel,
    ChartSelectionEvent,
    MarkFactory,
    PlotRect,
} from "~/component/chart/types.js";

/** The SVG namespace URI for every mark the chart creates through the sink. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** The store events a bound chart subscribes to (mirrors ComboBox's binding). */
const STORE_EVENTS: readonly StoreEvent[] = ["load", "add", "remove", "datachange"];

/** Size of the categorical palette; series colours cycle within it. */
const PALETTE_SIZE = 8;

/** Padding (px) reserved above the plot so the top gridline/label has headroom. */
const TOP_PAD = 10;

/** Padding (px) reserved right of the plot so the last x label is not clipped. */
const RIGHT_PAD = 12;

/** Gap (px) between the plot and a docked legend. */
const LEGEND_GAP = 8;

/** Extra band (px) reserved for an axis title beyond the tick labels. */
const AXIS_LABEL_BAND = 18;

/** Radius (px) of the selection ring drawn around a clicked point. */
const SELECTION_RING_RADIUS = 6;

/** Where the legend docks relative to the plot. */
export type ChartLegendPosition = "top" | "right" | "bottom";

/** Custom events an {@link AbstractChart} emits. */
type ChartEvent = "selection";

/**
 * Construction-time listener bag for a chart's custom events. A type alias (not
 * an interface) so it carries the implicit index signature `applyListeners`
 * requires.
 *
 * @category Components
 */
export type ChartListeners = {
    selection?: (event: ChartSelectionEvent) => void;
};

/**
 * Construction-time options common to every chart type.
 *
 * @category Components
 */
export interface AbstractChartOptions extends PanelOptions {
    /** In-memory series data (mutually exclusive with the store path). */
    series?: ChartSeries[];
    /** Store whose records supply the data (with the field options below). */
    store?: AbstractStore;
    /** Record field read for each point's `x` (store path). */
    xField?: string;
    /** Record field read for each point's `y` (store path). */
    yField?: string;
    /** Record field whose distinct values split records into series (store path). */
    seriesField?: string;
    /** Whether the legend is shown; defaults to `true`. */
    showLegend?: boolean;
    /** Where the legend docks; defaults to `"right"`. */
    legendPosition?: ChartLegendPosition;
    /** Optional x-axis title. */
    xAxisLabel?: string;
    /** Optional y-axis title. */
    yAxisLabel?: string;
    /** Construction-time listener bag for the `"selection"` event. */
    listeners?: ChartListeners;
}

// A sensible default envelope: a fixed preferred size, plus a small min so
// the Panel can shrink (it clamps only to its explicit min/max).
const _defaultAbstractChartOptions: Partial<AbstractChartOptions> = {
    preferredSize: { width: 400, height: 300 },
    minSize:       { width: 80, height: 60 },
};

/**
 * Shared SVG-first foundation for the chart family. An `AbstractChart` is a
 * `Panel` whose root `<div>` hosts a single raw `<svg>` drawing surface (a
 * tracked child created through the DOM sink, mirroring `Glyph`); axes,
 * gridlines, and series marks are SVG children drawn into that surface, never
 * framework components. Interactive HTML chrome — the legend — stays a real
 * child component positioned in `doLayout`.
 *
 * The computational layer (scales, ticks, path generation) delegates to pure
 * d3 submodules; all rendering, layout, interaction, and theming are native.
 * Concrete subtypes fill in the scale-building, series-drawing, and
 * point-anchor hooks.
 *
 * @typeParam O - The subtype's options interface.
 *
 * @remarks Abstract, so it is deliberately **not** wrapped with `callable()` (a
 * base with abstract members cannot be constructed); the concrete `LineChart` /
 * `BarChart` subclasses carry the callable export.
 *
 * @category Components
 */
export abstract class AbstractChart<O extends AbstractChartOptions = AbstractChartOptions> extends Panel<O> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAbstractChartOptions;

    private _listeners: ListenerBag<ChartEvent> = this.registerListenerBag(new ListenerBag<ChartEvent>());

    /** The resolved series model (points + hidden flag), rebuilt on data change. */
    protected _series: ChartSeriesModel[] = [];

    /**
     * Flattens the points of every visible series, for domain computation.
     *
     * @returns The visible points.
     */
    protected visiblePoints(): ChartPoint[] {
        return this._series.filter((m) => !m.hidden).flatMap((m) => m.points);
    }

    /** The clicked point, drawn with a selection ring; `null` when none. */
    protected _selectedPoint: { series: number; index: number } | null = null;

    private _boundStore: AbstractStore | null = null;
    private _xField: string = "x";
    private _yField: string = "y";
    private _seriesField: string | undefined = undefined;
    private readonly _onStoreRefresh: () => void = () => this.rebuildFromStore();

    private readonly _legend: ChartLegend = new ChartLegend();
    private _themeCleanup: (() => void) | null = null;

    // The raw SVG surface and its mark groups (created at first render, so null
    // until then). Groups paint back-to-front in creation order: axis/grid,
    // then series, then the selection overlay.
    private _svg: Handle | null = null;
    private _axisGroup: Handle | null = null;
    private _seriesGroup: Handle | null = null;
    private _overlayGroup: Handle | null = null;

    // Every mark created since the last repaint, with its parent group, so a
    // repaint can detach and release each one (an unreleased handle pins the
    // detached node in the registry — the Glyphs sprite-leak lesson).
    private _marks: Array<{ parent: Handle; handle: Handle }> = [];

    // The plot rectangle and scales from the last layout, cached so pointer
    // hit-testing (which runs outside layout, on every mousemove) can map the
    // cursor into data space without rebuilding them. Null until first layout.
    protected _plot: PlotRect | null = null;
    protected _xScale: ChartScale | null = null;
    protected _yScale: ChartScale | null = null;

    /**
     * Builds the chart shell: the legend child, the default size envelope, the
     * interaction listeners, and the theme subscription. Chart-specific options
     * are dispatched from the constructor body (not `applyOptions`) so the
     * `ListenerBag` and legend exist first.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Optional subclass default options.
     */
    constructor(options?: O, subclassDefaults?: Partial<O>) {
        super(options, { ..._defaultAbstractChartOptions, ...(subclassDefaults ?? {}) } as Partial<O>);

        this.addComponent(this._legend);
        this._legend.on("toggle", this.handleLegendToggle);

        Event.addSubtreeListener(this, "mousemove", this.handlePointerMove);
        Event.addSubtreeListener(this, "mouseout", this.handlePointerOut);
        Event.addSubtreeListener(this, "click", this.handlePointerClick);

        // Re-measure axis margins when the font changes (the label widths shift).
        this._themeCleanup = ThemeManager.onThemeChange(() => this.scheduleLayout());

        this.dispatchChartOptions(options);
    }

    /**
     * Dispatches the chart-specific options through their setters. Store and
     * in-memory series are mutually exclusive construction paths.
     *
     * @param options - The construction options, or `undefined`.
     */
    private dispatchChartOptions(options?: O): void {
        if (!options) {
            return;
        }

        if (options.store !== undefined) {
            this.setStore(options.store, options.xField ?? "x", options.yField ?? "y", options.seriesField);
        } else if (options.series !== undefined) {
            this.setSeries(options.series);
        }

        if (options.showLegend !== undefined) {
            this.setShowLegend(options.showLegend);
        }

        if (options.legendPosition !== undefined) {
            this.setLegendPosition(options.legendPosition);
        }

        if (options.xAxisLabel !== undefined) {
            this.setXAxisLabel(options.xAxisLabel);
        }

        if (options.yAxisLabel !== undefined) {
            this.setYAxisLabel(options.yAxisLabel);
        }

        this.applyListeners(options.listeners);
    }

    // ── Data ────────────────────────────────────────────────────────────────

    /**
     * Replaces the chart's data with an in-memory series array, resolving it
     * into the internal model (points copied, `hidden` flags preserved by name)
     * and repainting.
     *
     * @param series - The series to render.
     *
     * @returns This chart, for method chaining.
     */
    setSeries(series: ChartSeries[]): this {
        this._series = this.resolveModel(series);

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the chart's series as plain `ChartSeries` (points copied out of
     * the internal model).
     *
     * @returns The current series.
     */
    getSeries(): ChartSeries[] {
        return this._series.map((m) => ({
            name:  m.name,
            data:  m.points.map((p) => ({ x: p.x, y: p.y })),
            color: m.color,
        }));
    }

    /**
     * Binds the chart to a store, reading each point from the given fields and
     * (optionally) splitting records into series by `seriesField`. Unsubscribes
     * any previous store from all four data events before binding the next (no
     * listener accumulation), then rebuilds the model and repaints.
     *
     * @param store - The store to bind.
     * @param xField - Record field for each point's `x`.
     * @param yField - Record field for each point's `y`.
     * @param seriesField - Optional field whose values split records into series.
     *
     * @returns This chart, for method chaining.
     */
    setStore(store: AbstractStore, xField: string, yField: string, seriesField?: string): this {
        if (this._boundStore) {
            for (const event of STORE_EVENTS) {
                this._boundStore.off(event, this._onStoreRefresh);
            }
        }

        this._boundStore = store;
        this._xField = xField;
        this._yField = yField;
        this._seriesField = seriesField;

        for (const event of STORE_EVENTS) {
            store.on(event, this._onStoreRefresh);
        }

        this.rebuildFromStore();

        return this;
    }

    /**
     * Returns the bound store, or `null` when the chart uses in-memory series.
     *
     * @returns The bound store, or `null`.
     */
    getStore(): AbstractStore | null {
        return this._boundStore;
    }

    /**
     * Rebuilds the series model from the bound store's current records, grouping
     * by `seriesField` when configured, and repaints. Preserves each series'
     * hidden flag by name. An empty store yields zero series (no throw).
     */
    private rebuildFromStore(): void {
        if (!this._boundStore) {
            return;
        }

        this._series = this.resolveModel(this.seriesFromStore(this._boundStore));

        this.scheduleLayout();
    }

    /**
     * Reads the store's records into `ChartSeries`, splitting them into one
     * series per distinct `seriesField` value (in first-seen order) when that
     * field is configured, or a single series otherwise.
     *
     * @param store - The bound store.
     *
     * @returns The series read from the store.
     */
    private seriesFromStore(store: AbstractStore): ChartSeries[] {
        const records = store.getRecords();

        if (records.length === 0) {
            return [];
        }

        if (this._seriesField === undefined) {
            return [{
                name: this._yField,
                data: records.map((r) => ({ x: Number(r.get(this._xField)), y: Number(r.get(this._yField)) })),
            }];
        }

        const groups = new Map<string, ChartPoint[]>();

        for (const record of records) {
            const key = String(record.get(this._seriesField));
            const point: ChartPoint = { x: Number(record.get(this._xField)), y: Number(record.get(this._yField)) };
            const bucket = groups.get(key);

            if (bucket) {
                bucket.push(point);
            } else {
                groups.set(key, [point]);
            }
        }

        return Array.from(groups, ([name, data]) => ({ name, data }));
    }

    /**
     * Resolves a `ChartSeries` list into the internal model — points copied,
     * colour carried, and the `hidden` flag preserved from the current model by
     * series name so a data refresh does not un-hide a toggled series.
     *
     * @param series - The source series.
     *
     * @returns The resolved series model.
     */
    private resolveModel(series: ChartSeries[]): ChartSeriesModel[] {
        const prevHidden = new Map(this._series.map((m) => [m.name, m.hidden]));

        return series.map((s) => ({
            name:   s.name,
            points: s.data.map((p) => ({ x: p.x, y: p.y })),
            color:  s.color,
            hidden: prevHidden.get(s.name) ?? false,
        }));
    }

    // ── Chrome ──────────────────────────────────────────────────────────────

    /**
     * Shows or hides the legend and repaints.
     *
     * @param value - `true` to show the legend, `false` to hide it.
     *
     * @returns This chart, for method chaining.
     */
    setShowLegend(value: boolean): this {
        this._options.showLegend = value;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns whether the legend is shown (defaults to `true`).
     *
     * @returns `true` when the legend is shown.
     */
    isShowLegend(): boolean {
        return this._options.showLegend ?? true;
    }

    /**
     * Sets which edge the legend docks to and repaints.
     *
     * @param position - The legend edge.
     *
     * @returns This chart, for method chaining.
     */
    setLegendPosition(position: ChartLegendPosition): this {
        this._options.legendPosition = position;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the legend dock edge (defaults to `"right"`).
     *
     * @returns The legend position.
     */
    getLegendPosition(): ChartLegendPosition {
        return this._options.legendPosition ?? "right";
    }

    /**
     * Sets the x-axis title (reserving a margin band for it) and repaints.
     *
     * @param label - The axis title.
     *
     * @returns This chart, for method chaining.
     */
    setXAxisLabel(label: string): this {
        this._options.xAxisLabel = label;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the x-axis title, or `null` when unset.
     *
     * @returns The x-axis title, or `null`.
     */
    getXAxisLabel(): string | null {
        return this._options.xAxisLabel ?? null;
    }

    /**
     * Sets the y-axis title (reserving a margin band for it) and repaints.
     *
     * @param label - The axis title.
     *
     * @returns This chart, for method chaining.
     */
    setYAxisLabel(label: string): this {
        this._options.yAxisLabel = label;

        this.scheduleLayout();

        return this;
    }

    /**
     * Returns the y-axis title, or `null` when unset.
     *
     * @returns The y-axis title, or `null`.
     */
    getYAxisLabel(): string | null {
        return this._options.yAxisLabel ?? null;
    }

    // ── Events ──────────────────────────────────────────────────────────────

    /**
     * Registers a `"selection"` listener, fired when a datum is clicked.
     *
     * @param event - The `"selection"` event.
     * @param listener - The callback invoked with the selection payload.
     *
     * @returns This chart, for method chaining.
     */
    on(event: "selection", listener: (event: ChartSelectionEvent) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered `"selection"` listener.
     *
     * @param event - The `"selection"` event.
     * @param listener - The exact callback reference to remove.
     *
     * @returns This chart, for method chaining.
     */
    off(event: "selection", listener: (event: ChartSelectionEvent) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every `"selection"` listener with the payload.
     *
     * @param event - The `"selection"` event.
     * @param payload - The selection payload.
     */
    protected emit(event: ChartEvent, payload: ChartSelectionEvent): void {
        this._listeners.fire(event, payload);
    }

    // ── Rendering surface ─────────────────────────────────────────────────────

    /**
     * Creates the root `<div>` plus the tracked `<svg>` drawing surface and its
     * mark groups (axis, series, overlay), mirroring `Glyph.createRootElement`'s
     * raw-SVG-through-the-sink pattern.
     *
     * @returns The root element handle.
     */
    protected createRootElement(): Handle {
        const root = super.createRootElement();

        const svg = DOM.sink.createElementNS(SVG_NS, "svg");
        DOM.sink.apply(svg, { style: { position: "absolute", left: "0", top: "0", overflow: "visible" } });
        DOM.sink.appendChild(root, svg);
        this.trackHandle(svg);
        this._svg = svg;

        this._axisGroup = this.createGroup(svg);
        this._seriesGroup = this.createGroup(svg);
        this._overlayGroup = this.createGroup(svg);

        return root;
    }

    /**
     * Creates a tracked `<g>` group appended to the SVG surface.
     *
     * @param svg - The SVG surface handle.
     *
     * @returns The group handle.
     */
    private createGroup(svg: Handle): Handle {
        const group = DOM.sink.createElementNS(SVG_NS, "g");
        DOM.sink.appendChild(svg, group);
        this.trackHandle(group);

        return group;
    }

    // ── Layout ────────────────────────────────────────────────────────────────

    /**
     * Lays the chart out: sizes the SVG surface to the inner box, reserves the
     * legend band, measures the axis margins, computes the plot rectangle,
     * builds the final scales, and repaints. Reads only the cached inner size
     * (no live geometry), so the stale-DOM hazard does not arise.
     *
     * @returns This chart, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const inner = this.getInnerSize();

        if (!inner || !this._svg) {
            return this;
        }

        const origin = this.getPerimeterSize();

        this.sizeSurface(inner);

        const plotOuter = this.reserveLegend(inner, origin);
        const plot = this.computePlot(plotOuter);
        const scales = this.buildScales(plot);

        this._plot = plot;
        this._xScale = scales.x;
        this._yScale = scales.y;

        this.repaint(plot, scales.x, scales.y);

        return this;
    }

    /**
     * Sizes and positions the SVG surface to cover the inner content box, with a
     * user-space viewBox matching so marks are drawn in inner-box pixels.
     *
     * @param inner - The inner content size.
     */
    private sizeSurface(inner: { width: number; height: number }): void {
        const origin = this.getPerimeterSize();

        DOM.sink.apply(this._svg!, {
            setAttr: { width: String(inner.width), height: String(inner.height), viewBox: `0 0 ${inner.width} ${inner.height}` },
            style:   { position: "absolute", left: `${origin.left}px`, top: `${origin.top}px`, overflow: "visible" },
        });
    }

    /**
     * Reserves the legend's band on its docked edge and positions the legend
     * child there, returning the remaining rectangle for the plot. Hides the
     * legend (and reserves nothing) when it is off or there are no series.
     *
     * @param inner - The inner content size.
     * @param origin - The perimeter origin offset (inset + border + padding).
     *
     * @returns The rectangle left for the plot, in SVG user space.
     */
    private reserveLegend(inner: { width: number; height: number }, origin: { left: number; top: number }): PlotRect {
        const full: PlotRect = { x: 0, y: 0, width: inner.width, height: inner.height };

        if (!this.isShowLegend() || this._series.length === 0) {
            this._legend.setVisible(false);

            return full;
        }

        this._legend.setVisible(true);
        this._legend.setOrientation(this.getLegendPosition() === "right" ? "vertical" : "horizontal");
        this._legend.setEntries(this._series.map((m, i) => ({ name: m.name, color: this.seriesColor(i, m), hidden: m.hidden })));

        const pref = this._legend.getPreferredSize() ?? { width: 120, height: 60 };
        const position = this.getLegendPosition();

        if (position === "right") {
            const band = Math.min(pref.width, inner.width / 2);
            this.placeLegend(origin, inner.width - band, 0, band, inner.height);

            return { x: 0, y: 0, width: inner.width - band - LEGEND_GAP, height: inner.height };
        }

        const band = Math.min(pref.height, inner.height / 2);

        if (position === "top") {
            this.placeLegend(origin, 0, 0, inner.width, band);

            return { x: 0, y: band + LEGEND_GAP, width: inner.width, height: inner.height - band - LEGEND_GAP };
        }

        this.placeLegend(origin, 0, inner.height - band, inner.width, band);

        return { x: 0, y: 0, width: inner.width, height: inner.height - band - LEGEND_GAP };
    }

    /**
     * Positions the legend child at an inner-box rectangle, offset by the
     * perimeter origin so its coordinates align with the SVG surface.
     *
     * @param origin - The perimeter origin offset.
     * @param x - The rectangle's inner-box x.
     * @param y - The rectangle's inner-box y.
     * @param width - The rectangle width.
     * @param height - The rectangle height.
     */
    private placeLegend(origin: { left: number; top: number }, x: number, y: number, width: number, height: number): void {
        this._legend.setX(origin.left + x);
        this._legend.setY(origin.top + y);
        this._legend.setWidth(width);
        this._legend.setHeight(height);
        this._legend.doLayout();
    }

    /**
     * Computes the plot rectangle inside `plotOuter` by subtracting the measured
     * axis margins. Measures margins from provisional scales built against
     * `plotOuter` — the tick *values* (hence label widths) are range-independent,
     * so this one extra scale build breaks the margin↔layout feedback loop.
     *
     * @param plotOuter - The rectangle left after the legend band.
     *
     * @returns The plot rectangle for the series marks.
     */
    private computePlot(plotOuter: PlotRect): PlotRect {
        const provisional = this.buildScales(plotOuter);
        const xFormat = tickFormatter(provisional.x, DEFAULT_TICK_COUNT);
        const yFormat = tickFormatter(provisional.y, DEFAULT_TICK_COUNT);

        const leftMargin = measureAxisMargin("left", provisional.y, yFormat, DEFAULT_TICK_COUNT)
            + (this._options.yAxisLabel ? AXIS_LABEL_BAND : 0);
        const bottomMargin = measureAxisMargin("bottom", provisional.x, xFormat, DEFAULT_TICK_COUNT)
            + (this._options.xAxisLabel ? AXIS_LABEL_BAND : 0);

        return {
            x:      plotOuter.x + leftMargin,
            y:      plotOuter.y + TOP_PAD,
            width:  Math.max(0, plotOuter.width - leftMargin - RIGHT_PAD),
            height: Math.max(0, plotOuter.height - bottomMargin - TOP_PAD),
        };
    }

    /**
     * Clears the previous marks and redraws the axes (with y-gridlines), the
     * series, and the selection ring from scratch.
     *
     * @param plot - The plot rectangle.
     * @param xScale - The x scale.
     * @param yScale - The y scale.
     */
    private repaint(plot: PlotRect, xScale: ChartScale, yScale: ChartScale): void {
        this.clearMarks();

        const axis = this.markFactory(this._axisGroup!);

        drawAxis(axis, "left", yScale, plot, { tickCount: DEFAULT_TICK_COUNT, format: tickFormatter(yScale, DEFAULT_TICK_COUNT), grid: true });
        drawAxis(axis, "bottom", xScale, plot, { tickCount: DEFAULT_TICK_COUNT, format: tickFormatter(xScale, DEFAULT_TICK_COUNT), grid: false });

        this.drawAxisTitles(axis, plot);
        this.drawSeries(plot, xScale, yScale);
        this.drawSelection(plot, xScale, yScale);
    }

    /**
     * Draws the optional x/y axis titles centred on their axes.
     *
     * @param create - The mark factory bound to the axis group.
     * @param plot - The plot rectangle.
     */
    private drawAxisTitles(create: MarkFactory, plot: PlotRect): void {
        const labelFill = { fill: "var(--ts-ui-chart-label)" };

        if (this._options.xAxisLabel) {
            create("text", {
                setAttr: { x: String(plot.x + plot.width / 2), y: String(plot.y + plot.height + AXIS_LABEL_BAND + TOP_PAD), "text-anchor": "middle", "dominant-baseline": "hanging" },
                style:   labelFill,
                text:    this._options.xAxisLabel,
            });
        }

        if (this._options.yAxisLabel) {
            const cx = plot.x - AXIS_LABEL_BAND * 2;
            const cy = plot.y + plot.height / 2;

            create("text", {
                setAttr: { x: String(cx), y: String(cy), "text-anchor": "middle", "dominant-baseline": "middle", transform: `rotate(-90 ${cx} ${cy})` },
                style:   labelFill,
                text:    this._options.yAxisLabel,
            });
        }
    }

    /**
     * Draws the selection ring around the currently selected point, if any and
     * its series is visible.
     *
     * @param plot - The plot rectangle.
     * @param xScale - The x scale.
     * @param yScale - The y scale.
     */
    private drawSelection(plot: PlotRect, xScale: ChartScale, yScale: ChartScale): void {
        if (!this._selectedPoint) {
            return;
        }

        const model = this._series[this._selectedPoint.series];

        if (!model || model.hidden || this._selectedPoint.index >= model.points.length) {
            return;
        }

        const anchor = this.pointPixel(plot, xScale, yScale, this._selectedPoint.series, this._selectedPoint.index);

        if (!anchor) {
            return;
        }

        this.createMark(this._overlayGroup!, "circle", {
            setAttr: { cx: String(anchor.x), cy: String(anchor.y), r: String(SELECTION_RING_RADIUS) },
            style:   { fill: "none", stroke: "var(--ts-ui-chart-selection)", "stroke-width": "2" },
        });
    }

    // ── Mark bookkeeping ───────────────────────────────────────────────────────

    /**
     * Returns a {@link MarkFactory} bound to a group, so a caller (e.g. the axis
     * renderer) creates marks that flow through this chart's centralised
     * clear/release bookkeeping.
     *
     * @param group - The parent group handle.
     *
     * @returns A factory creating tracked marks in that group.
     */
    private markFactory(group: Handle): MarkFactory {
        return (tag, patch) => this.createMark(group, tag, patch);
    }

    /**
     * Creates one SVG mark, applies a patch, appends it to a group, and tracks
     * it for release on the next repaint.
     *
     * @param parent - The parent group handle.
     * @param tag - The SVG element tag.
     * @param patch - The patch to apply.
     *
     * @returns The created mark handle.
     */
    private createMark(parent: Handle, tag: string, patch: ElementPatch): Handle {
        const mark = DOM.sink.createElementNS(SVG_NS, tag);
        DOM.sink.apply(mark, patch);
        DOM.sink.appendChild(parent, mark);
        this._marks.push({ parent, handle: mark });

        return mark;
    }

    /**
     * Creates a series mark in the series group, for subclass `drawSeries`
     * implementations.
     *
     * @param tag - The SVG element tag.
     * @param patch - The patch to apply.
     *
     * @returns The created mark handle.
     */
    protected seriesMark(tag: string, patch: ElementPatch): Handle {
        return this.createMark(this._seriesGroup!, tag, patch);
    }

    /** Detaches and releases every mark created since the last repaint. */
    private clearMarks(): void {
        for (const { parent, handle } of this._marks) {
            DOM.sink.removeChild(parent, handle);
            DOM.sink.release(handle);
        }

        this._marks.length = 0;
    }

    // ── Interaction ────────────────────────────────────────────────────────────

    /**
     * On pointer move over a mark carrying series/index data attributes, shows a
     * tooltip for that datum; hides it when the pointer is over blank space.
     *
     * @param event - The mouse-move event.
     */
    private handlePointerMove = (event: MouseEvent): void => {
        const hit = this.resolveHit(event);

        if (!hit) {
            Tooltip.hide();

            return;
        }

        const model = this._series[hit.series];
        // A whole-series mark (a line path, no point index) shows the series name
        // only; an indexed mark (a point marker or bar) shows the datum.
        const text = hit.index === null
            ? model.name
            : `${model.name}: (${model.points[hit.index].x}, ${model.points[hit.index].y})`;

        Tooltip.show(text, event.clientX, event.clientY);
    };

    /**
     * Hides the tooltip when the pointer truly leaves the chart. The subtree
     * `mouseout` also fires when the pointer crosses *between* internal marks
     * (a point marker onto the line path, say); hiding then would blank the
     * tooltip at every internal boundary, so a move whose `relatedTarget` is
     * still inside the chart is ignored.
     *
     * @param event - The mouse-out event.
     */
    private handlePointerOut = (event: MouseEvent): void => {
        const related = event.relatedTarget;
        const root = this.getElement();

        if (root && DOM.source.isNode(related) && DOM.source.contains(root, DOM.source.intern(related))) {
            return;
        }

        Tooltip.hide();
    };

    /**
     * On a click on a mark carrying series/index data attributes, selects that
     * datum (drawing a selection ring) and emits `"selection"`.
     *
     * @param event - The click event.
     */
    private handlePointerClick = (event: MouseEvent): void => {
        const hit = this.resolveHit(event);

        // Selection needs a concrete point — a whole-series mark (line path,
        // null index) carries no datum to select.
        if (!hit || hit.index === null) {
            return;
        }

        this.selectPoint(hit.series, hit.index);
    };

    /**
     * Toggles a series' visibility from a legend click and repaints.
     *
     * @param index - The toggled series index.
     */
    private handleLegendToggle = (index: number): void => {
        const model = this._series[index];

        if (model) {
            model.hidden = !model.hidden;

            this.scheduleLayout();
        }
    };

    /**
     * Resolves a pointer event to the datum (or whole series) it targets, or
     * `null` for a miss. The default reads the series/index data attributes off
     * the event's target mark ({@link hitMark}); subtypes whose marks are hard
     * to land on precisely (a thin line path) override this with a geometric
     * proximity test.
     *
     * @param event - The pointer event.
     *
     * @returns The hit `{ series, index }` (`index` null for a whole-series mark), or `null`.
     */
    protected resolveHit(event: MouseEvent): { series: number; index: number | null } | null {
        return this.hitMark(event);
    }

    /**
     * Maps a viewport (client) coordinate to the SVG surface's user space, whose
     * viewBox matches the inner-box pixels 1:1. Returns `null` before the surface
     * exists. Used by geometric hit-testing to place the cursor in mark space.
     *
     * @param clientX - The viewport x coordinate.
     * @param clientY - The viewport y coordinate.
     *
     * @returns The point in SVG user space, or `null`.
     */
    protected clientToSurface(clientX: number, clientY: number): { x: number; y: number } | null {
        if (!this._svg) {
            return null;
        }

        const rect = DOM.source.getElementRect(this._svg);

        return { x: clientX - rect.x, y: clientY - rect.y };
    }

    /**
     * Reads the series/index data attributes off the event's target mark. A mark
     * carrying only `data-series` (a line path) resolves to a whole-series hit
     * (`index: null`); a mark carrying `data-index` too (a point marker or bar)
     * resolves to that datum. Returns `null` when the target is not a series
     * mark, its series is hidden, or its index is out of range — so a series with
     * no point markers (`showPoints: false`) still hovers at the series level via
     * its path.
     *
     * @param event - The pointer event.
     *
     * @returns The hit `{ series, index }` (`index` null for a whole-series mark), or `null`.
     */
    private hitMark(event: MouseEvent): { series: number; index: number | null } | null {
        if (!DOM.source.isNode(event.target)) {
            return null;
        }

        const target = DOM.source.intern(event.target);
        const seriesRaw = DOM.source.getDataset(target, "series");

        if (seriesRaw === undefined) {
            return null;
        }

        const series = Number(seriesRaw);
        const model = this._series[series];

        if (!model || model.hidden) {
            return null;
        }

        const indexRaw = DOM.source.getDataset(target, "index");

        if (indexRaw === undefined) {
            return { series, index: null };
        }

        const index = Number(indexRaw);

        if (index >= model.points.length) {
            return null;
        }

        return { series, index };
    }

    /**
     * Selects a datum, repaints with the selection ring, and emits `"selection"`.
     *
     * @param series - The datum's series index.
     * @param index - The datum's index within its series.
     */
    protected selectPoint(series: number, index: number): void {
        this._selectedPoint = { series, index };

        this.scheduleLayout();

        const model = this._series[series];

        this.emit("selection", { series, index, point: model.points[index], seriesName: model.name });
    }

    // ── Colour resolution ──────────────────────────────────────────────────────

    /**
     * Resolves a series' mark colour: its explicit override, or the theme's
     * categorical palette slot for its index (cycling within the palette).
     *
     * @param index - The series index.
     * @param model - The series model.
     *
     * @returns A CSS colour or `var(--ts-ui-chart-series-N)` binding.
     */
    protected seriesColor(index: number, model: ChartSeriesModel): string {
        return model.color ?? `var(--ts-ui-chart-series-${(index % PALETTE_SIZE) + 1})`;
    }

    // ── Subtype hooks ──────────────────────────────────────────────────────────

    /**
     * Builds the x and y scales for the given plot rectangle. Reads the visible
     * series to compute domains; the subtype selects the scale kinds.
     *
     * @param plot - The plot rectangle whose edges form the pixel ranges.
     *
     * @returns The x and y scales.
     */
    protected abstract buildScales(plot: PlotRect): { x: ChartScale; y: ChartScale };

    /**
     * Draws the series marks into the series group (via {@link seriesMark}),
     * carrying `data-series` / `data-index` for hit-testing and binding colours
     * to the palette variables. Hidden series draw nothing.
     *
     * @param plot - The plot rectangle.
     * @param xScale - The x scale.
     * @param yScale - The y scale.
     */
    protected abstract drawSeries(plot: PlotRect, xScale: ChartScale, yScale: ChartScale): void;

    /**
     * Returns the pixel anchor of a datum (for the selection ring) in SVG user
     * space, or `null` when it cannot be resolved.
     *
     * @param plot - The plot rectangle.
     * @param xScale - The x scale.
     * @param yScale - The y scale.
     * @param series - The datum's series index.
     * @param index - The datum's index within its series.
     *
     * @returns The pixel anchor, or `null`.
     */
    protected abstract pointPixel(plot: PlotRect, xScale: ChartScale, yScale: ChartScale, series: number, index: number): { x: number; y: number } | null;

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /**
     * Unbinds the store, removes the theme subscription, and hides any open
     * tooltip. Call when the chart is permanently removed.
     */
    protected destructor(): void {
        if (this._boundStore) {
            for (const event of STORE_EVENTS) {
                this._boundStore.off(event, this._onStoreRefresh);
            }

            this._boundStore = null;
        }

        if (this._themeCleanup) {
            this._themeCleanup();
            this._themeCleanup = null;
        }

        // Release the last repaint's marks. They deliberately bypass
        // `trackHandle` (only the <svg> and its groups are tracked, and released
        // by the destructor), and `release` is non-recursive, so without this
        // every mark stays pinned in the handle registry — the Glyphs sprite-leak
        // lesson at final teardown, not just per repaint.
        this.clearMarks();

        // `_legend` is registered via `addComponent`, so `super.destructor()`'s
        // child recursion below already disposes it — an explicit call here
        // would run `ChartLegend.destructor()` a second time.
        Tooltip.hide();

        super.destructor();
    }
}
