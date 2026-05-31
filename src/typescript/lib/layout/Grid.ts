// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions } from "~/layout/LayoutManager.js";
import { FillType } from "~/layout/FillType.js";
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
    rows?:       number;
    columns?:    number;
    spacing?:    number;
    stretching?: boolean;

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
    private _stretching: boolean = true;
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
     * and stretching after the inherited LayoutManager defaults.
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

        if (options.stretching !== undefined) {
            this.setStretching(options.stretching);
        }

        if (options.columnTracks !== undefined) {
            this.setColumnTracks(options.columnTracks);
        }

        if (options.rowTracks !== undefined) {
            this.setRowTracks(options.rowTracks);
        }
    }

    /**
     * Returns whether children stretch to fill their cells.
     *
     * @returns `true` if stretching is enabled (default).
     */
    isStretching(): boolean {
        return this._stretching;
    }

    /**
     * Sets whether children stretch to fill their cells. When `false`, each row
     * uses the natural heights of its children and components are
     * baseline-aligned within the row.
     *
     * @param stretching - Pass `false` to enable per-row baseline alignment instead of stretching.
     */
    setStretching(stretching: boolean): this {
        this._stretching = stretching;

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
     * Returns the maximum size: the minimum child maximum size multiplied by the computed row/column counts, plus inter-cell spacing.
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

        let innerWidth = Number.MAX_SAFE_INTEGER;
        let innerHeight = Number.MAX_SAFE_INTEGER;

        for (let idx in components) {
            let component = components[idx];
            let size = component.getMaxSize();

            if (size) {
                innerWidth = Math.min(innerWidth, size.width);
                innerHeight = Math.min(innerHeight, size.height);
            }
        }

        let colRowCount = this.getColRowCount();
        let spacing = this.getComponentSpacing();

        if (colRowCount) {
            innerWidth = innerWidth * colRowCount.width + Math.max(0, colRowCount.width - 1) * spacing;
            innerHeight = innerHeight * colRowCount.height + Math.max(0, colRowCount.height - 1) * spacing;
        }

        return {
            width: innerWidth + outerWidth,
            height: innerHeight + outerHeight
        };
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
     * @remarks When stretching is enabled (default) cells are equal-sized and each
     * child fills its cell. When stretching is disabled, columns remain uniform-width
     * but each row uses the natural heights of its children and components are
     * baseline-aligned within their row, mirroring [`HBox`](/api/layout/classes/HBox)'s baseline-aware placement.
     */
    doLayout() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let components = container.getComponents();
        let containerInsets = container.getInsets();
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

        let totalHSpacing = Math.max(0, cols - 1) * spacing;
        let totalVSpacing = Math.max(0, rows - 1) * spacing;
        let columnWidth   = (containerSize.width  - totalHSpacing) / cols;
        let columnHeight  = (containerSize.height - totalVSpacing) / rows;

        if (this._stretching) {
            this.layoutOccupancy(components, cols, rows, containerSize, containerInsets, spacing);

            return;
        }

        let y = containerInsets.getTop();

        for (let row = 0; row < rows; row += 1) {
            const rowComponents: Component[] = [];
            const rowHeights: number[] = [];
            const rowBaselines: Array<number | null> = [];

            for (let col = 0; col < cols; col += 1) {
                const idx = row * cols + col;
                if (idx >= components.length) {
                    break;
                }

                const component = components[idx];
                const size = component.getPreferredSize();

                rowComponents.push(component);
                rowHeights.push(size ? size.height : 0);
                rowBaselines.push(component.getBaseline());
            }

            const { rowAscent, rowDescent } = this.computeRowMetrics(rowHeights, rowBaselines);

            let x = containerInsets.getLeft();

            for (let i = 0; i < rowComponents.length; i += 1) {
                const component = rowComponents[i];
                const height = rowHeights[i];

                let cellY: number;

                if (rowAscent !== null) {
                    const b = rowBaselines[i];

                    if (b !== null) {
                        cellY = y + (rowAscent - b);
                    } else {
                        cellY = y + this.nullChildY(height, rowAscent, rowDescent);
                    }
                } else {
                    cellY = y;
                }

                this.placeComponent(
                    component,
                    x,
                    cellY,
                    columnWidth,
                    height,
                    FillType.BOTH
                );

                x += columnWidth + spacing;
            }

            y += columnHeight + spacing;
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
                // shrinking to the cell, so clip it with a cell-sized frame:
                // the frame takes the cell rect and clips, the child parks at
                // (0, 0) inside it at its (min-floored) natural size.
                component.setClipFrame(x, y, w, h);
                this.commitBounds(component, 0, 0, w, h);
            } else {
                component.clearClipFrame();
                this.placeComponent(component, x, y, w, h, FillType.BOTH);
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
