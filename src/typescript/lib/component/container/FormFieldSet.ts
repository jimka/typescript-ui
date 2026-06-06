// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Grid } from "~/layout/Grid.js";
import { GridConstraints } from "~/layout/GridConstraints.js";
import { GridTrack } from "~/layout/GridTrack.js";
import { Text } from "~/component/input/Text.js";
import { _FieldSet, FieldSetOptions } from "~/component/container/FieldSet.js";
import { callable } from "~/core/Callable.js";

/**
 * Default inter-cell spacing (px) for the internal form grid. Mirrors the
 * hand-rolled Binding demo's `spacing: 8` so a {@link FormFieldSet} matches the
 * reference labelled-form look without the caller restating it.
 */
const FIELD_SPACING_DEFAULT = 8;

/**
 * A title/field pair: a label and the input it labels.
 *
 * @category Components
 */
export interface FormFieldDescriptor {

    /** Label text rendered as a baseline-aligned `Text`. */
    title: string;

    /** The input/component placed beside the label. */
    component: Component;
}

/**
 * One row of a {@link FormFieldSet}: either an array of pairs (one per logical
 * column, left-to-right; a short array leaves trailing columns empty), or a
 * single component that spans every column (status lines, button bars).
 *
 * @category Components
 */
export type FormRowDescriptor =
    | FormFieldDescriptor[]
    | { component: Component; fullWidth: true };

/**
 * Construction-time options for {@link FormFieldSet}.
 *
 * @category Components
 */
export interface FormFieldSetOptions extends FieldSetOptions {

    /** Logical title/field columns laid side by side. Default `1`. */
    columns?: number;

    /** Inter-cell spacing in px for the internal grid. Default mirrors the demo's `8`. */
    fieldSpacing?: number;

    /** Declarative rows, applied in order at construction via the same path as `addRow`. */
    rows?: FormRowDescriptor[];
}

/**
 * Subclass defaults layered under the caller's options. Clears the base
 * FieldSet's fixed 200x200 preferred size: a form is exactly as large as its
 * computed grid content, so the fixed value would otherwise pad a short form
 * with dead space at the bottom. With it cleared, `Component.getPreferredSize`
 * falls through to the internal grid, whose `getPreferredSize` already adds the
 * legend clearance and insets.
 */
const _defaultFormFieldSetOptions: Partial<FormFieldSetOptions> = {
    preferredSize: undefined,
};

/**
 * A {@link FieldSet} whose content is a baseline-aligned form of title/field
 * pairs, generalising the hand-rolled labelled-form pattern from the Binding
 * demo into a reusable container.
 *
 * The body is a single [`Grid`](/api/layout/classes/Grid) in
 * `baselineAlign` mode with `2 × columns` grid-columns: each logical column is
 * a content-sized title track followed by a weight-sized input track, so titles
 * hug their text while inputs share a common right edge per column. Pairs flow
 * left-to-right and wrap to a new row when the current one fills; a full-width
 * row spans every column via [`GridConstraints`](/api/layout/classes/GridConstraints)
 * `colSpan`.
 *
 * @category Components
 */
class FormFieldSet extends _FieldSet {

    /** Logical title/field column count (the grid has `2 ×` this many grid-columns). */
    private _columns: number;

    /** The internal baseline grid; its `rows`/`rowTracks` grow as rows are added. */
    private _grid: Grid;

    /** Next free grid-column on the current flow row (0-based, in grid-columns). */
    private _flowCol: number = 0;

    /** Running grid-row count, pushed into the grid's `rows` + `rowTracks`. */
    private _rowCount: number = 0;

    /**
     * Builds the form, installs the internal baseline grid, and replays any
     * declarative `rows`.
     *
     * @param title - The legend title (forwarded to {@link FieldSet}).
     * @param options - Form structure: `columns`, `fieldSpacing`, `rows`.
     * @param subclassDefaults - Defaults a subclass layers under the caller's options.
     */
    constructor(title: string = "", options?: FormFieldSetOptions, subclassDefaults?: Partial<FormFieldSetOptions>) {
        super(title, options, { ..._defaultFormFieldSetOptions, ...(subclassDefaults ?? {}) });

        this._columns = options?.columns ?? 1;

        this._grid = new Grid({
            baselineAlign: true,
            columns:       2 * this._columns,
            spacing:       options?.fieldSpacing ?? FIELD_SPACING_DEFAULT,
            columnTracks:  this.buildColumnTracks(),
            rows:          0,
            rowTracks:     [],
        });

        this.setLayoutManager(this._grid);

        if (options?.rows) {
            this.applyRows(options.rows);
        }
    }

    /**
     * Appends one title/field pair into the next free logical column, flowing to
     * a new row when the current one fills.
     *
     * @param title - Label text placed in the content (title) column.
     * @param component - The input placed in the weight (field) column.
     * @returns This component, for method chaining.
     */
    addField(title: string, component: Component): this {
        this.openRow();

        this.addComponent(new Text(title));
        this.addComponent(component);

        this._flowCol += 2;

        if (this._flowCol >= 2 * this._columns) {
            this._flowCol = 0;
        }

        return this;
    }

    /**
     * Appends a full row of pairs (one per logical column; trailing columns are
     * left empty for a short array).
     *
     * @param fields - The pairs to place across the row, left-to-right.
     * @returns This component, for method chaining.
     */
    addRow(fields: FormFieldDescriptor[]): this {
        this.finishRow();

        for (const field of fields) {
            this.addField(field.title, field.component);
        }

        this.finishRow();

        return this;
    }

    /**
     * Appends a component spanning every column on its own row.
     *
     * @param component - The component to span the full form width.
     * @returns This component, for method chaining.
     */
    addFullWidthRow(component: Component): this {
        this.finishRow();
        this.openRow();

        const constraints = new GridConstraints();
        constraints.colSpan = 2 * this._columns;

        this.addComponent(component, constraints);

        return this;
    }

    /**
     * Returns the configured logical column count.
     *
     * @returns The number of side-by-side title/field columns.
     */
    getColumns(): number {
        return this._columns;
    }

    /**
     * Builds the `2 × columns` grid-column tracks: for each logical column a
     * content-sized title track (hugs its text) followed by a weight-sized input
     * track (takes the slack so inputs share a right edge).
     *
     * @returns The column tracks for the internal grid.
     */
    private buildColumnTracks(): GridTrack[] {
        const tracks: GridTrack[] = [];

        for (let column = 0; column < this._columns; column++) {
            tracks.push({ mode: "content" });
            tracks.push({ mode: "weight", value: 1 });
        }

        return tracks;
    }

    /**
     * Replays the declarative `rows` option through the same add path as the
     * imperative API, so construction and runtime calls share one code path.
     *
     * @param rows - The declarative row descriptors to apply, in order.
     */
    private applyRows(rows: FormRowDescriptor[]): void {
        for (const row of rows) {
            if (Array.isArray(row)) {
                this.addRow(row);
            } else {
                this.addFullWidthRow(row.component);
            }
        }
    }

    /**
     * Opens a new flow row when the first cell of one is about to be added,
     * bumping the running row count and growing the grid so its baseline
     * auto-flow does not stop short of the new row.
     */
    private openRow(): void {
        if (this._flowCol === 0) {
            this._rowCount++;
            this.growRows();
        }
    }

    /**
     * Pads any partially-filled flow row with empty spacer cells so the next row
     * starts at grid-column 0. The spacers carry no preferred size, contributing
     * 0 to the grid's content measurement.
     */
    private finishRow(): void {
        if (this._flowCol === 0) {
            return;
        }

        const remaining = 2 * this._columns - this._flowCol;

        for (let cell = 0; cell < remaining; cell++) {
            this.addComponent(new Component());
        }

        this._flowCol = 0;
    }

    /**
     * Re-sizes the grid's row count and row tracks to the running row total.
     * Every row track is `content`-sized so inputs keep their natural height.
     */
    private growRows(): void {
        this._grid.setRows(this._rowCount);
        this._grid.setRowTracks(Array.from({ length: this._rowCount }, () => ({ mode: "content" as const })));
    }
}

const FormFieldSetCallable = callable(FormFieldSet);
type FormFieldSetCallable = FormFieldSet;
export {
    FormFieldSet         as _FormFieldSet,
    FormFieldSetCallable as FormFieldSet
};
