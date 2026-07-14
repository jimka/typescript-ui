// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Fit } from "~/layout/Fit.js";
import { LabeledGrid, LabeledGridOptions, LabeledFieldDescriptor } from "~/component/container/LabeledGrid.js";
import { _FieldSet, FieldSetOptions } from "~/component/container/FieldSet.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link LabeledFieldSet}.
 *
 * @category Components
 */
export interface LabeledFieldSetOptions extends FieldSetOptions, LabeledGridOptions {}

/**
 * Subclass defaults layered under the caller's options. Clears the base
 * FieldSet's fixed 200x200 preferred size and fixed 100x100 min size: a
 * labeled fieldset is exactly as large as its computed grid content, so the
 * fixed values would otherwise pad a short form with dead space (preferred)
 * or force a min floor no tiny form needs (min). With both cleared,
 * `Component.getPreferredSize` / `getMinSize` fall through to the internal
 * grid (forwarded through the `Fit` layout), whose reports already add the
 * legend clearance and insets.
 */
const _defaultLabeledFieldSetOptions: Partial<LabeledFieldSetOptions> = {
    preferredSize: undefined,
    minSize:       undefined,
};

/**
 * A {@link FieldSet} whose content is a baseline-aligned form of title/field
 * pairs, generalising the hand-rolled labelled-form pattern from the Binding
 * demo into a reusable container.
 *
 * `LabeledFieldSet` composes a {@link LabeledGrid} inside its `<fieldset>`
 * chrome via a `Fit` layout: `LabeledFieldSet` = a `LabeledGrid` inside a
 * `FieldSet`. Use a bare `LabeledGrid` directly when the baseline-aligned
 * form layout is wanted without the fieldset border/legend.
 *
 * @category Components
 */
class LabeledFieldSet extends _FieldSet {

    /** The internal chrome-less grid this fieldset composes. */
    private _labeledGrid: LabeledGrid;

    /**
     * Builds the fieldset chrome and installs an internal {@link LabeledGrid}
     * via a `Fit` layout.
     *
     * @param title - The legend title (forwarded to {@link FieldSet}).
     * @param options - Form structure: `columns`, `fieldSpacing`, `rows`.
     * @param subclassDefaults - Defaults a subclass layers under the caller's options.
     */
    constructor(title: string = "", options?: LabeledFieldSetOptions, subclassDefaults?: Partial<LabeledFieldSetOptions>) {
        super(title, options, { ..._defaultLabeledFieldSetOptions, ...(subclassDefaults ?? {}) });

        this._labeledGrid = new LabeledGrid({
            columns:      options?.columns,
            fieldSpacing: options?.fieldSpacing,
            rows:         options?.rows,
        });

        this.setLayoutManager(new Fit());
        this.addComponent(this._labeledGrid);
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
        this._labeledGrid.addField(title, component);

        return this;
    }

    /**
     * Appends a full row of pairs (one per logical column; trailing columns are
     * left empty for a short array).
     *
     * @param fields - The pairs to place across the row, left-to-right.
     * @returns This component, for method chaining.
     */
    addRow(fields: LabeledFieldDescriptor[]): this {
        this._labeledGrid.addRow(fields);

        return this;
    }

    /**
     * Appends a component spanning every column on its own row.
     *
     * @param component - The component to span the full form width.
     * @returns This component, for method chaining.
     */
    addFullWidthRow(component: Component): this {
        this._labeledGrid.addFullWidthRow(component);

        return this;
    }

    /**
     * Returns the configured logical column count.
     *
     * @returns The number of side-by-side title/field columns.
     */
    getColumns(): number {
        return this._labeledGrid.getColumns();
    }

    /**
     * Typed accessor for the internally-composed {@link LabeledGrid}. Use it
     * to inspect the grid's cells directly (e.g. `getGrid().getComponents()`).
     *
     * @returns The wrapped `LabeledGrid` instance.
     */
    getGrid(): LabeledGrid {
        return this._labeledGrid;
    }
}

const LabeledFieldSetCallable = callable(LabeledFieldSet);
type LabeledFieldSetCallable = LabeledFieldSet;
export {
    LabeledFieldSet         as _LabeledFieldSet,
    LabeledFieldSetCallable as LabeledFieldSet
};
