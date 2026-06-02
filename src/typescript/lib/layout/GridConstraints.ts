// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutConstraints } from "~/layout/LayoutConstraints.js";

/**
 * Per-child layout constraints for components added to a {@link Grid} container.
 * Carries optional cell spanning ({@link GridConstraints.rowSpan} /
 * {@link GridConstraints.colSpan}) and explicit cell placement
 * ({@link GridConstraints.col} / {@link GridConstraints.row}).
 *
 * @remarks A child counts as explicitly placed if **either** `col` or `row` is
 * provided; the missing axis defaults to `0`. Explicitly placed children are
 * reserved before any auto-flow, so un-positioned children flow around them.
 * `col` / `row` are 0-based cell indices clamped to the grid's column/row count
 * at read time. `rowSpan` / `colSpan` default to `1` and clamp to the cells
 * remaining from the child's origin.
 *
 * The inherited `fill` ({@link FillType}) and `anchor` ({@link AnchorType})
 * control how the child sits inside its cell and take precedence over the
 * grid's `defaultFill` / `defaultAnchor`: a child with `fill = FillType.NONE`
 * shrinks to its preferred size and parks at its `anchor` even when the grid
 * default is `FillType.BOTH`. Leave them unset to inherit the grid defaults.
 *
 * @category Layouts
 */
export class GridConstraints extends LayoutConstraints {

    /** 0-based explicit column index; clamped to grid bounds at read time. */
    col?: number;

    /** 0-based explicit row index; clamped to grid bounds at read time. */
    row?: number;

    /** Number of rows the child spans. Defaults to `1`. */
    rowSpan?: number;

    /** Number of columns the child spans. Defaults to `1`. */
    colSpan?: number;

    constructor() {
        super();
    }
}
