// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DefaultCell } from "~/component/table/cell/Default.js";
import { callable } from "~/core/Callable.js";

/**
 * A non-interactive body row that labels a contiguous run of a rotated
 * table's field/value rows sharing the same {@link Column.getGroup} name.
 * Constructed once per visible group run by `Table` (private
 * `rebuildRotatedStore` / `computeGroupRuns`) and mounted by `Row.renderSeparator`
 * in place of the row's usual three field/value/filler cells; the whole row
 * is sized to `rowWidth` by `Body.bindAndPositionRows`, so this cell spans it
 * directly rather than via the `spanFrom`/`spanTo` column-summing
 * {@link ParentHeaderCell} uses.
 *
 * @category Components
 */
class GroupSeparatorCell extends DefaultCell {

    private _color: string | null;

    /**
     * Constructs a separator cell for one group run.
     *
     * @param text - The group label to display.
     * @param color - Optional CSS color string for the cell's background;
     *   `null` renders a transparent background with just the top divider.
     */
    constructor(text: string, color: string | null) {
        super("td");

        this._color = color;

        const renderer = this.getRenderer();
        renderer.getText().setFontWeight("bold");
        renderer.getText().setText(text);
        renderer.setUserSelect("none");
        renderer.getText().setUserSelect("none");
        renderer.setCursor("default");

        this.setBackgroundColor(color ?? "transparent");

        // A body row has no inherited header-band surface (unlike
        // ParentHeaderCell, which relies on the Header's own gradient), so
        // an uncolored separator still needs its own boundary — a single
        // top divider in the same token the header's own dividers use.
        this.setShadow("inset 0 1px 0 0 var(--ts-ui-table-header-border, rgba(0, 0, 0, 0.2))");
    }

    /**
     * Returns the optional background color this separator adopts.
     *
     * @returns The CSS color string, or `null` when the separator shows
     *   only its top divider.
     */
    getColor(): string | null {
        return this._color;
    }
}

const GroupSeparatorCellCallable = callable(GroupSeparatorCell);
type GroupSeparatorCellCallable = GroupSeparatorCell;
export {
    GroupSeparatorCell         as _GroupSeparatorCell,
    GroupSeparatorCellCallable as GroupSeparatorCell
};
