// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
import { AnchorType } from "~/layout/AnchorType.js";
import { GridTrack } from "~/layout/GridTrack.js";
import { GridConstraints } from "~/layout/GridConstraints.js";
import { Size } from "~/primitive/Size.js";
import { Insets } from "~/primitive/Insets.js";
import { Component } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Grid}.
 *
 * @category Layouts
 */
export interface GridOptions extends LayoutManagerOptions {
    rows?:    number;
    columns?: number;
    spacing?: number;

    /** Grid-wide fill applied to children that don't set their own `fill`. Default {@link FillType.BOTH}. */
    defaultFill?: FillType;

    /** Grid-wide anchor applied to non-filling children that don't set their own `anchor`. Default {@link AnchorType.CENTER}. */
    defaultAnchor?: AnchorType;

    /** When `true`, children are baseline-aligned per row (column/row tracks still apply; children use preferred height). Default `false`. */
    baselineAlign?: boolean;

    /** Per-column sizing tracks; see {@link GridTrack}. */
    columnTracks?: GridTrack[];

    /** Per-row sizing tracks; see {@link GridTrack}. */
    rowTracks?: GridTrack[];
}

/**
 * A layout manager that tiles children in a uniform grid of equal-sized cells.
 * Row and column counts can be configured explicitly or left at `0` for auto-calculation.
 *
 * @category Layouts
 */
class Grid extends LayoutManager {

    private _rows: number = 0;
    private _columns: number = 0;
    private _spacing: number = 5;
    private _defaultFill: FillType = FillType.BOTH;
    private _defaultAnchor: AnchorType = AnchorType.CENTER;
    private _baselineAlign: boolean = false;
    private _columnTracks: GridTrack[] = [];
    private _rowTracks: GridTrack[] = [];

    constructor(options?: GridOptions) {
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link GridOptions} bag, dispatching grid dimensions, spacing,
     * default fill/anchor, and baseline alignment after the inherited
     * LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: GridOptions): void {
        super.applyOptions(options);

        if (options.rows !== undefined) {
            this.setRows(options.rows);
        }

        if (options.columns !== undefined) {
            this.setColumns(options.columns);
        }

        if (options.spacing !== undefined) {
            this.setComponentSpacing(options.spacing);
        }

        if (options.defaultFill !== undefined) {
            this.setDefaultFill(options.defaultFill);
        }

        if (options.defaultAnchor !== undefined) {
            this.setDefaultAnchor(options.defaultAnchor);
        }

        if (options.baselineAlign !== undefined) {
            this.setBaselineAlign(options.baselineAlign);
        }

        if (options.columnTracks !== undefined) {
            this.setColumnTracks(options.columnTracks);
        }

        if (options.rowTracks !== undefined) {
            this.setRowTracks(options.rowTracks);
        }
    }

    /**
     * Returns the grid-wide default fill applied to children that don't set
     * their own `fill` constraint.
     *
     * @returns The default {@link FillType} (initially {@link FillType.BOTH}).
     */
    getDefaultFill(): FillType {
        return this._defaultFill;
    }

    /**
     * Sets the grid-wide default fill. Each child overrides this with its own
     * {@link GridConstraints} `fill`; otherwise this value drives whether the
     * child fills its cell.
     *
     * @param fill - The default fill strategy for children without their own `fill`.
     */
    setDefaultFill(fill: FillType): this {
        this._defaultFill = fill;

        return this;
    }

    /**
     * Returns the grid-wide default anchor applied to non-filling children that
     * don't set their own `anchor` constraint.
     *
     * @returns The default {@link AnchorType} (initially {@link AnchorType.CENTER}).
     */
    getDefaultAnchor(): AnchorType {
        return this._defaultAnchor;
    }

    /**
     * Sets the grid-wide default anchor. Each child overrides this with its own
     * {@link GridConstraints} `anchor`; otherwise this value positions a
     * non-filling child within its cell.
     *
     * @param anchor - The default anchor for children without their own `anchor`.
     */
    setDefaultAnchor(anchor: AnchorType): this {
        this._defaultAnchor = anchor;

        return this;
    }

    /**
     * Returns whether children are baseline-aligned per row.
     *
     * @returns `true` if per-row baseline alignment is enabled.
     */
    isBaselineAlign(): boolean {
        return this._baselineAlign;
    }

    /**
     * Sets whether children are baseline-aligned per row. When `true`, the
     * column/row tracks still size each cell (so a `"content"` column hugs its
     * content), each row uses the natural heights of its children, and
     * components are baseline-aligned within the row, mirroring
     * [`HBox`](/api/layout/classes/HBox)'s baseline-aware placement. Orthogonal
     * to {@link Grid.setDefaultFill} — baseline alignment owns the vertical axis
     * while fill/anchor still drive the horizontal axis.
     *
     * @param baselineAlign - Pass `true` to enable per-row baseline alignment.
     */
    setBaselineAlign(baselineAlign: boolean): this {
        this._baselineAlign = baselineAlign;

        return this;
    }

    /**
     * Returns the configured number of rows, or `0` if the grid auto-calculates row count.
     *
     * @returns The row count.
     */
    getRows() {
        return this._rows;
    }

    /**
     * Sets the number of rows. Pass `0` to let the grid auto-calculate.
     *
     * @param rows - The desired row count, or `0` for automatic.
     */
    setRows(rows: number) : this {
        this._rows = rows;

        return this;
    }

    /**
     * Returns the gap, in pixels, between adjacent cells (horizontally and vertically).
     *
     * @returns The current spacing in pixels.
     */
    getComponentSpacing() {
        return this._spacing || 0;
    }

    /**
     * Sets the gap, in pixels, between adjacent cells. Applied both horizontally
     * (between columns) and vertically (between rows).
     *
     * @param spacing - Spacing in pixels. Falsy values are treated as `0`.
     */
    setComponentSpacing(spacing: number) : this {
        this._spacing = spacing || 0;

        return this;
    }

    /**
     * Returns the configured number of columns, or `0` if the grid auto-calculates column count.
     *
     * @returns The column count.
     */
    getColumns() {
        return this._columns;
    }

    /**
     * Sets the number of columns. Pass `0` to let the grid auto-calculate.
     *
     * @param columns - The desired column count, or `0` for automatic.
     */
    setColumns(columns: number) : this {
        this._columns = columns;

        return this;
    }

    /**
     * Returns the per-column sizing tracks.
     *
     * @returns The configured column tracks; empty when columns size uniformly.
     */
    getColumnTracks(): GridTrack[] {
        return this._columnTracks;
    }

    /**
     * Sets the per-column sizing tracks. When fewer tracks are supplied than the
     * grid has columns, the missing tracks default to `{ mode: "weight", value: 1 }`.
     *
     * @param tracks - The column tracks; see {@link GridTrack}.
     */
    setColumnTracks(tracks: GridTrack[]): this {
        this._columnTracks = tracks;

        return this;
    }

    /**
     * Returns the per-row sizing tracks.
     *
     * @returns The configured row tracks; empty when rows size uniformly.
     */
    getRowTracks(): GridTrack[] {
        return this._rowTracks;
    }

    /**
     * Sets the per-row sizing tracks. When fewer tracks are supplied than the
     * grid has rows, the missing tracks default to `{ mode: "weight", value: 1 }`.
     *
     * @param tracks - The row tracks; see {@link GridTrack}.
     */
    setRowTracks(tracks: GridTrack[]): this {
        this._rowTracks = tracks;

        return this;
    }

    /**
     * Returns the computed cell count for the current component list as `{width: rows, height: columns}`.
     *
     * @returns An object with `width` (row count) and `height` (column count), or `undefined` if no container is attached.
     *
     * @remarks The property names `width` and `height` are repurposed here to
     * carry column and row counts rather than pixel dimensions —
     * `result.width` is the column count, `result.height` is the row count.
     */
    getColRowCount() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let componentCount = components.length;

        let rows = 0;
        let columns = 0;

        if (!this._rows && !this._columns) {
            columns = Math.floor(Math.sqrt(componentCount));
            rows = Math.ceil(componentCount / columns);
        } else if (this._rows && this._columns) {
            rows = this._rows;
            columns = this._columns;
        } else if (this._columns) {
            columns = this._columns;
            rows = Math.ceil(componentCount / columns);
        } else {
            rows = this._rows;
            columns = Math.ceil(componentCount / rows);
        }

        return {
            width: columns,
            height: rows
        };
    }

    /**
     * Returns the preferred size. With tracks declared, this is the sum of the
     * per-track preferred extents (fixed tracks their value, content *and*
     * weight tracks their measured content — wide/tall enough to show every
     * cell at its natural size) plus spacing. Track-less grids keep the uniform
     * `maxChildPreferred * count` estimate.
     *
     * @returns The preferred `{width, height}`, or `null` if no container is attached.
     */
    getPreferredSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let maxCellWidth = 0;
        let maxCellHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getPreferredSize();

            if (size) {
                maxCellWidth  = Math.max(maxCellWidth,  size.width);
                maxCellHeight = Math.max(maxCellHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let cols = colRowCount ? colRowCount.width  : 1;
        let rows = colRowCount ? colRowCount.height : 1;
        let spacing = this.getComponentSpacing();

        const content = this.measureContent(components, cols, rows);

        let innerWidth = this._columnTracks.length > 0
            ? this.trackAxisExtent(this._columnTracks, cols, content.columns, true)
            : maxCellWidth * cols;

        let innerHeight = this._rowTracks.length > 0
            ? this.trackAxisExtent(this._rowTracks, rows, content.rows, true)
            : maxCellHeight * rows;

        innerWidth  += Math.max(0, cols - 1) * spacing;
        innerHeight += Math.max(0, rows - 1) * spacing;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the minimum size. With tracks declared, this is the sum of the
     * per-track minima (fixed tracks their value, content tracks their measured
     * content, weight tracks `0`) plus spacing — matching what `doLayout`
     * actually lays out, so a host no longer over-reserves space the way the
     * uniform `maxChildMin * count` estimate did. Track-less grids keep that
     * uniform estimate.
     *
     * @returns The minimum `{width, height}`, or `null` if no container is attached.
     */
    getMinSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let maxCellWidth = 0;
        let maxCellHeight = 0;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMinSize();

            if (size) {
                maxCellWidth  = Math.max(maxCellWidth,  size.width);
                maxCellHeight = Math.max(maxCellHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let cols = colRowCount ? colRowCount.width  : 1;
        let rows = colRowCount ? colRowCount.height : 1;
        let spacing = this.getComponentSpacing();

        const content = this.measureContent(components, cols, rows);

        let innerWidth = this._columnTracks.length > 0
            ? this.trackAxisExtent(this._columnTracks, cols, content.columns, false)
            : maxCellWidth * cols;

        let innerHeight = this._rowTracks.length > 0
            ? this.trackAxisExtent(this._rowTracks, rows, content.rows, false)
            : maxCellHeight * rows;

        innerWidth  += Math.max(0, cols - 1) * spacing;
        innerHeight += Math.max(0, rows - 1) * spacing;

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
    }

    /**
     * Returns the maximum size the grid can usefully occupy: the sum of the
     * per-track maxima plus inter-cell spacing and the container perimeter. A
     * `fixed` track contributes its pixel value, a `content` track its measured
     * content, and a `weight` track is unbounded — so any weight track makes the
     * whole axis unbounded (the grid can absorb arbitrary slack there). With no
     * tracks on an axis the fallback is `cols * maxChildMax` (the uniform-cell
     * estimate), where a child's `null`/sentinel maximum counts as unbounded.
     *
     * @returns The maximum `{width, height}`, or `null` if no container is attached.
     */
    getMaxSize(): Size | null {
        let container = this.getContainer();
        if (!container) {
            return null;
        }

        let perimiterSize = container.getPerimiterSize();

        let outerWidth = perimiterSize.left + perimiterSize.right;
        let outerHeight = perimiterSize.top + perimiterSize.bottom;

        let components = container.getComponents();

        let colRowCount = this.getColRowCount();
        let cols = colRowCount ? colRowCount.width  : 1;
        let rows = colRowCount ? colRowCount.height : 1;
        let spacing = this.getComponentSpacing();

        const content = this.measureContent(components, cols, rows);

        const innerWidth = this._columnTracks.length > 0
            ? this.trackAxisMax(this._columnTracks, cols, content.columns)
            : cols * this.maxChildExtent(components, true);

        const innerHeight = this._rowTracks.length > 0
            ? this.trackAxisMax(this._rowTracks, rows, content.rows)
            : rows * this.maxChildExtent(components, false);

        const saturate = (value: number): number => Math.min(value, Number.MAX_SAFE_INTEGER);

        return {
            width:  saturate(innerWidth  + Math.max(0, cols - 1) * spacing + outerWidth),
            height: saturate(innerHeight + Math.max(0, rows - 1) * spacing + outerHeight)
        };
    }

    /**
     * Sums the per-track maxima along one axis: a `fixed` track contributes its
     * pixel value, a `content` track its measured content size, and a `weight`
     * track is unbounded — the first weight track saturates the axis to
     * `Number.MAX_SAFE_INTEGER`, since a flex track can grow without limit. A
     * missing track defaults to `weight`, matching {@link trackAxisExtent}.
     *
     * @param tracks - The declared tracks for this axis.
     * @param count - The number of columns (or rows) to size.
     * @param contentSizes - Measured content maxima per track.
     * @returns The summed maximum extent for the axis, excluding spacing.
     */
    private trackAxisMax(tracks: GridTrack[], count: number, contentSizes: number[]): number {
        let total = 0;

        for (let i = 0; i < count; i += 1) {
            const track = tracks[i] ?? { mode: "weight" as const, value: 1 };

            if (track.mode === "fixed") {
                total += track.value ?? 0;
            } else if (track.mode === "content") {
                total += contentSizes[i] ?? 0;
            } else {
                return Number.MAX_SAFE_INTEGER;
            }
        }

        return total;
    }

    /**
     * Returns the largest per-child maximum extent across all children on one
     * axis, for the uniform-cell (no-track) fallback. A child whose maximum is
     * `null` or at the unbounded sentinel makes the whole axis unbounded, so the
     * result saturates to `Number.MAX_SAFE_INTEGER`.
     *
     * @param components - The grid's children.
     * @param horizontal - `true` to read each child's max width, `false` for height.
     * @returns The largest child maximum, or `Number.MAX_SAFE_INTEGER` when any
     *   child is unbounded.
     */
    private maxChildExtent(components: Component[], horizontal: boolean): number {
        let largest = 0;

        for (const component of components) {
            const max = component.getMaxSize();

            if (!max) {
                return Number.MAX_SAFE_INTEGER;
            }

            const extent = horizontal ? max.width : max.height;

            if (extent >= Number.MAX_SAFE_INTEGER) {
                return Number.MAX_SAFE_INTEGER;
            }

            largest = Math.max(largest, extent);
        }

        return largest;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * width is `cols * maxChildMinWidth + (cols-1) * spacing`; height is
     * `rows * maxChildMinHeight + (rows-1) * spacing`. Used by `doLayout` to
     * inflate the working size when the host has opted into `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent or has no children.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return { width: 0, height: 0 };
        }

        const colRowCount = this.getColRowCount();
        const cols = colRowCount ? colRowCount.width  : 1;
        const rows = colRowCount ? colRowCount.height : 1;
        const spacing = this.getComponentSpacing();

        let maxCellWidth = 0;
        let maxCellHeight = 0;

        for (const component of components) {
            const min = component.getMinSize();
            if (min) {
                maxCellWidth  = Math.max(maxCellWidth,  min.width);
                maxCellHeight = Math.max(maxCellHeight, min.height);
            }
        }

        const content = this.measureContent(components, cols, rows);

        // When tracks are declared, the axis minimum is the sum of per-track
        // minima — a `fixed` track needs its fixed value, a `content` track its
        // measured content, and a `weight` track nothing (it flexes to fill
        // slack and clips oversized children, so it imposes no intrinsic floor).
        // This keeps a child that the grid is meant to *clip* (e.g. an oversized
        // child in a fixed column) from inflating the whole grid's min width.
        // With no tracks on an axis, fall back to the uniform `maxChild*count`
        // estimate so non-track grids still drive universal scroll unchanged.
        const widthMin = this._columnTracks.length > 0
            ? this.trackAxisExtent(this._columnTracks, cols, content.columns, false)
            : cols * maxCellWidth;

        const heightMin = this._rowTracks.length > 0
            ? this.trackAxisExtent(this._rowTracks, rows, content.rows, false)
            : rows * maxCellHeight;

        return {
            width:  widthMin  + Math.max(0, cols - 1) * spacing,
            height: heightMin + Math.max(0, rows - 1) * spacing,
        };
    }

    /**
     * Sums the per-track extents along one axis: a `fixed` track contributes its
     * pixel value and a `content` track its measured content size. A `weight`
     * track contributes its measured content when `includeWeightContent` is
     * `true` (the *preferred* extent — wide enough to show its content at
     * natural size) and `0` otherwise (the *minimum* extent — a flex track can
     * shrink to nothing). A missing track (when the list is shorter than
     * `count`) defaults to `weight`, matching `resolveTracks`' weight default.
     *
     * @param tracks - The declared tracks for this axis.
     * @param count - The number of columns (or rows) to size.
     * @param contentSizes - Measured content maxima per track.
     * @param includeWeightContent - Whether weight tracks contribute their
     *   measured content (preferred extent) rather than `0` (minimum extent).
     * @returns The summed extent for the axis, excluding spacing.
     */
    private trackAxisExtent(tracks: GridTrack[], count: number, contentSizes: number[], includeWeightContent: boolean): number {
        let total = 0;

        for (let i = 0; i < count; i += 1) {
            const track = tracks[i] ?? { mode: "weight" as const, value: 1 };

            if (track.mode === "fixed") {
                total += track.value ?? 0;
            } else if (track.mode === "content") {
                total += contentSizes[i] ?? 0;
            } else if (includeWeightContent) {
                total += contentSizes[i] ?? 0;
            }
        }

        return total;
    }

    /**
     * Tiles all children in a grid of equal-sized cells, left-to-right then top-to-bottom.
     *
     * @remarks Each cell is sized by the column/row tracks; how a child sits
     * inside its cell is driven by the child's own `fill`/`anchor`
     * ([`GridConstraints`](/api/layout/classes/GridConstraints)) falling back to
     * the grid's {@link Grid.setDefaultFill}/{@link Grid.setDefaultAnchor}
     * (default {@link FillType.BOTH}, so children fill their cells out of the
     * box). When {@link Grid.setBaselineAlign} is enabled, the column/row tracks
     * still size each cell (a `"content"` column hugs its content), each row
     * uses the natural heights of its children, and components are
     * baseline-aligned within their row, mirroring
     * [`HBox`](/api/layout/classes/HBox)'s baseline-aware placement. Baseline
     * mode auto-flows by `colSpan`; explicit `col`/`row` and `rowSpan > 1` are
     * not supported.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerInsets = container.getContentInsets();
        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let colRowCount = this.getColRowCount();
        let cols = colRowCount ? colRowCount.width  : 1;
        let rows = colRowCount ? colRowCount.height : 1;
        let spacing = this.getComponentSpacing();

        // Universal scroll: see HBox.doLayout for the rationale. Inflates the
        // working size to the children's combined minSize on the axes the
        // host has marked as overflowing.
        if (this.isOverflowingX() || this.isOverflowingY()) {
            const totalMin = this.computeTotalMinSize();
            const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
            const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;

            containerSize = { width: w, height: h };
        }

        if (!this._baselineAlign) {
            this.layoutOccupancy(components, cols, rows, containerSize, containerInsets, spacing);

            return;
        }

        // Baseline mode honours the same per-track column/row sizing as the
        // occupancy path — so a "content" column hugs its titles instead of
        // taking a uniform 1/cols share — plus colSpan auto-flow, then
        // baseline-aligns each row's children within the row (mirroring HBox).
        // Explicit col/row placement and rowSpan > 1 are not supported here.
        const content    = this.measureContent(components, cols, rows);
        const colExtents = this.resolveTracks(this._columnTracks, cols, containerSize.width,  spacing, content.columns);
        const rowExtents = this.resolveTracks(this._rowTracks,    rows, containerSize.height, spacing, content.rows);

        type BaselineCell = {
            component: Component;
            col:       number;
            colSpan:   number;
            height:    number;
            baseline:  number | null;
        };

        const perRow: BaselineCell[][] = Array.from({ length: rows }, () => []);

        let flowCol = 0;
        let flowRow = 0;

        for (const component of components) {
            if (flowRow >= rows) {
                break;
            }

            const cons    = this.getLayoutConstraints(component) as GridConstraints | undefined;
            const colSpan = Math.min(Math.max(1, cons?.colSpan ?? 1), cols);
            const size    = component.getPreferredSize();

            perRow[flowRow].push({
                component,
                col:      flowCol,
                colSpan,
                height:   size ? size.height : 0,
                baseline: component.getBaseline(),
            });

            flowCol += colSpan;

            if (flowCol >= cols) {
                flowCol = 0;
                flowRow += 1;
            }
        }

        let y = containerInsets.getTop();

        for (let row = 0; row < rows; row += 1) {
            const rowCells = perRow[row];

            const { rowAscent, rowDescent } = this.computeRowMetrics(
                rowCells.map(cell => cell.height),
                rowCells.map(cell => cell.baseline),
            );

            for (const cell of rowCells) {
                let x = containerInsets.getLeft();
                for (let i = 0; i < cell.col; i += 1) {
                    x += (colExtents[i] ?? 0) + spacing;
                }

                let width = (cell.colSpan - 1) * spacing;
                for (let i = cell.col; i < cell.col + cell.colSpan; i += 1) {
                    width += colExtents[i] ?? 0;
                }

                let cellY: number;

                if (rowAscent !== null) {
                    cellY = cell.baseline !== null
                        ? y + (rowAscent - cell.baseline)
                        : y + this.nullChildY(cell.height, rowAscent, rowDescent);
                } else {
                    cellY = y;
                }

                this.placeComponent(
                    cell.component,
                    x,
                    cellY,
                    width,
                    cell.height,
                    this._defaultFill,
                    this._defaultAnchor
                );
            }

            const baselineHeight = rowAscent !== null ? rowAscent + rowDescent : 0;

            y += Math.max(rowExtents[row] ?? 0, baselineHeight) + spacing;
        }
    }

    /**
     * Resolves a track list into per-track pixel extents along one axis.
     *
     * @param tracks - The declared tracks; missing tracks (when shorter than
     *   `count`) default to `{ mode: "weight", value: 1 }`.
     * @param count - The number of columns (or rows) to size.
     * @param available - The inner extent of the container along this axis.
     * @param spacing - The inter-cell gap, in pixels.
     * @param contentSizes - Measured content maxima per track, used for `"content"` tracks.
     * @returns A `number[count]` of pixel extents.
     *
     * @remarks Fixed tracks keep their `value`; content tracks keep their measured
     * size; the remaining space is split among weight tracks in proportion to their
     * weights. When no weight track exists the remaining space is left unused.
     */
    private resolveTracks(tracks: GridTrack[], count: number, available: number, spacing: number, contentSizes: number[]): number[] {
        const inner = available - Math.max(0, count - 1) * spacing;

        const resolved: number[] = new Array(count).fill(0);

        let fixedSum = 0;
        let contentSum = 0;
        let weightSum = 0;

        for (let i = 0; i < count; i += 1) {
            const track = tracks[i] ?? { mode: "weight" as const, value: 1 };

            if (track.mode === "fixed") {
                resolved[i] = track.value ?? 0;
                fixedSum += resolved[i];
            } else if (track.mode === "content") {
                resolved[i] = contentSizes[i] ?? 0;
                contentSum += resolved[i];
            } else {
                weightSum += Math.max(0, track.value ?? 1);
            }
        }

        const remaining = Math.max(0, inner - fixedSum - contentSum);

        if (weightSum > 0) {
            for (let i = 0; i < count; i += 1) {
                const track = tracks[i] ?? { mode: "weight" as const, value: 1 };

                if (track.mode === "weight") {
                    resolved[i] = remaining * (Math.max(0, track.value ?? 1) / weightSum);
                }
            }
        }

        return resolved;
    }

    /**
     * Measures the content maxima of single-track-spanning children, per column
     * and per row, for `"content"` track sizing.
     *
     * @param components - The container's children.
     * @param cols - The column count.
     * @param rows - The row count.
     * @returns `{ columns, rows }` arrays of per-track content maxima.
     *
     * @remarks Each child contributes `max(preferred, min)` so a child that only
     * set a min size still widens (or heightens) its track. A child contributes to
     * a column only when its `colSpan` is `1`, and to a row only when its `rowSpan`
     * is `1` — multi-track spanners are not distributed in v1. Because content
     * measurement is independent of cell placement, the maxima are folded by
     * explicit-or-flow position when known, else by document-order column/row.
     */
    private measureContent(components: Component[], cols: number, rows: number): { columns: number[]; rows: number[] } {
        const columns: number[] = new Array(cols).fill(0);
        const rowSizes: number[] = new Array(rows).fill(0);

        let flowCol = 0;
        let flowRow = 0;

        for (const component of components) {
            const cons = this.getLayoutConstraints(component) as GridConstraints | undefined;
            const preferred = component.getPreferredSize();
            const min = component.getMinSize();

            const w = Math.max(preferred ? preferred.width : 0, min ? min.width : 0);
            const h = Math.max(preferred ? preferred.height : 0, min ? min.height : 0);

            const colSpan = Math.max(1, cons?.colSpan ?? 1);
            const rowSpan = Math.max(1, cons?.rowSpan ?? 1);

            let c: number;
            let r: number;

            if (cons && (cons.col != null || cons.row != null)) {
                c = Math.min(Math.max(cons.col ?? 0, 0), Math.max(0, cols - 1));
                r = Math.min(Math.max(cons.row ?? 0, 0), Math.max(0, rows - 1));
            } else {
                c = flowCol;
                r = flowRow;

                flowCol += colSpan;

                if (flowCol >= cols) {
                    flowCol = 0;
                    flowRow += rowSpan;
                }
            }

            if (colSpan === 1 && c < cols) {
                columns[c] = Math.max(columns[c], w);
            }

            if (rowSpan === 1 && r < rows) {
                rowSizes[r] = Math.max(rowSizes[r], h);
            }
        }

        return { columns, rows: rowSizes };
    }

    /**
     * Tiles children using the occupancy-grid algorithm: explicitly-placed
     * children are reserved first, then the remaining children auto-flow into the
     * free cells, with per-track sizing and per-cell clip-vs-place.
     *
     * @param components - The container's children.
     * @param cols - The column count.
     * @param rows - The row count.
     * @param containerSize - The container's (possibly overflow-inflated) inner size.
     * @param insets - The container's insets, supplying the cell origin offset.
     * @param spacing - The inter-cell gap, in pixels.
     */
    private layoutOccupancy(components: Component[], cols: number, rows: number, containerSize: Size, insets: Insets, spacing: number): void {
        const content = this.measureContent(components, cols, rows);

        const colExtents = this.resolveTracks(this._columnTracks, cols, containerSize.width, spacing, content.columns);
        const rowExtents = this.resolveTracks(this._rowTracks, rows, containerSize.height, spacing, content.rows);

        const occupancy: boolean[][] = [];

        for (let r = 0; r < rows; r += 1) {
            occupancy.push(new Array(cols).fill(false));
        }

        const owners: Array<Array<string | null>> = [];

        for (let r = 0; r < rows; r += 1) {
            owners.push(new Array(cols).fill(null));
        }

        const placeAt = (component: Component, r: number, c: number, rowSpan: number, colSpan: number): void => {
            let x = insets.getLeft();

            for (let i = 0; i < c; i += 1) {
                x += colExtents[i] + spacing;
            }

            let y = insets.getTop();

            for (let i = 0; i < r; i += 1) {
                y += rowExtents[i] + spacing;
            }

            let w = (colSpan - 1) * spacing;

            for (let i = c; i < c + colSpan; i += 1) {
                w += colExtents[i] ?? 0;
            }

            let h = (rowSpan - 1) * spacing;

            for (let i = r; i < r + rowSpan; i += 1) {
                h += rowExtents[i] ?? 0;
            }

            const min = component.getMinSize();

            if (min && (min.width > w || min.height > h)) {
                // The child's own `min-width` / `min-height` keep its box from
                // shrinking to the cell on the overflowing axis, so clip it with
                // a cell-sized frame. Honour the grid's fill/anchor on whichever
                // axis the child *does* fit — `resolveBounds` yields the
                // fill/anchor-placed box — and override only the overflowing axis
                // to the child's natural extent (its preferred size, falling back
                // to min) so the content renders at full size up to the clip edge
                // rather than at a cramped preferred that drops fill. The frame is
                // anchored at the cell; the child commits at the resolved offset
                // within it (0 on an overflowing axis, since `resolveBounds`
                // applies no anchor displacement when the child exceeds the cell).
                const resolved = this.resolveBounds(component, x, y, w, h, this._defaultFill, this._defaultAnchor);
                const pref = component.getPreferredSize();

                const childWidth  = min.width  > w ? (pref ? pref.width  : min.width)  : resolved.width;
                const childHeight = min.height > h ? (pref ? pref.height : min.height) : resolved.height;

                component.setClipFrame(x, y, w, h);
                this.commitBounds(component, resolved.x - x, resolved.y - y, childWidth, childHeight);
            } else {
                // The child fits: resolve its bounds honouring its own
                // fill/anchor over the grid defaults, then commit the result so
                // a non-filling child shrinks and anchors within its cell.
                const resolved = this.resolveBounds(component, x, y, w, h, this._defaultFill, this._defaultAnchor);

                component.clearClipFrame();
                this.commitBounds(component, resolved.x, resolved.y, resolved.width, resolved.height);
            }
        };

        // Pass 1 — reserve explicitly-positioned children.
        for (const component of components) {
            const cons = this.getLayoutConstraints(component) as GridConstraints | undefined;

            if (!cons || (cons.col == null && cons.row == null)) {
                continue;
            }

            const c = Math.min(Math.max(cons.col ?? 0, 0), Math.max(0, cols - 1));
            const r = Math.min(Math.max(cons.row ?? 0, 0), Math.max(0, rows - 1));
            const colSpan = Math.min(Math.max(1, cons.colSpan ?? 1), cols - c);
            const rowSpan = Math.min(Math.max(1, cons.rowSpan ?? 1), rows - r);

            for (let rr = r; rr < r + rowSpan; rr += 1) {
                for (let cc = c; cc < c + colSpan; cc += 1) {
                    if (occupancy[rr][cc]) {
                        console.warn(`Grid: ${component.getId()} overlaps ${owners[rr][cc]} at cell (${rr},${cc})`);
                    }

                    occupancy[rr][cc] = true;
                    owners[rr][cc] = component.getId();
                }
            }

            placeAt(component, r, c, rowSpan, colSpan);
        }

        // Pass 2 — auto-flow the remaining children into free cells.
        for (const component of components) {
            const cons = this.getLayoutConstraints(component) as GridConstraints | undefined;

            if (cons && (cons.col != null || cons.row != null)) {
                continue;
            }

            const colSpan = Math.min(Math.max(1, cons?.colSpan ?? 1), cols);
            const rowSpan = Math.min(Math.max(1, cons?.rowSpan ?? 1), rows);

            const slot = this.findFreeCell(occupancy, rows, cols, rowSpan, colSpan);

            if (!slot) {
                continue;
            }

            for (let rr = slot.r; rr < slot.r + rowSpan; rr += 1) {
                for (let cc = slot.c; cc < slot.c + colSpan; cc += 1) {
                    occupancy[rr][cc] = true;
                    owners[rr][cc] = component.getId();
                }
            }

            placeAt(component, slot.r, slot.c, rowSpan, colSpan);
        }
    }

    /**
     * Scans the occupancy grid in row-major order for the first top-left cell
     * whose `rowSpan`×`colSpan` block is entirely free.
     *
     * @param occupancy - The `boolean[rows][cols]` occupancy map.
     * @param rows - The row count.
     * @param cols - The column count.
     * @param rowSpan - The block height to fit.
     * @param colSpan - The block width to fit.
     * @returns The free block's top-left `{ r, c }`, or `null` if none fits.
     */
    private findFreeCell(occupancy: boolean[][], rows: number, cols: number, rowSpan: number, colSpan: number): { r: number; c: number } | null {
        for (let r = 0; r + rowSpan <= rows; r += 1) {
            for (let c = 0; c + colSpan <= cols; c += 1) {
                let free = true;

                for (let rr = r; rr < r + rowSpan && free; rr += 1) {
                    for (let cc = c; cc < c + colSpan; cc += 1) {
                        if (occupancy[rr][cc]) {
                            free = false;

                            break;
                        }
                    }
                }

                if (free) {
                    return { r, c };
                }
            }
        }

        return null;
    }
}

const GridCallable = callable(Grid);
type GridCallable = Grid;
export {
    Grid         as _Grid,
    GridCallable as Grid
};
