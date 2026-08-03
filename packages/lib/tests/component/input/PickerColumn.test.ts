//
// PickerColumn / PickerCell value-math coverage. Both are imported by module
// path (PickerColumn is not barrel-exported). PickerCell.handleClick is private
// and wired as a click listener; cast to invoke it directly (the offline sink
// runs no event loop). No TestDOM: selection state is read back without a
// layout pass.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PickerCell, PickerCellList, PickerColumn } from '~/component/input/PickerColumn';
import { Component } from '~/core/Component';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { DOM } from '~/core/DOM';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('PickerCell selected state', () => {
    it('round-trips setSelected/isSelected', () => {
        const cell = new PickerCell('05', () => {});
        expect(cell.isSelected()).toBe(false);

        cell.setSelected(true);
        expect(cell.isSelected()).toBe(true);

        cell.setSelected(false);
        expect(cell.isSelected()).toBe(false);
    });
});

describe('PickerCell disabled click guard', () => {
    it('runs the click callback when enabled', () => {
        let clicks = 0;
        const cell = new PickerCell('05', () => {
            clicks += 1;
        });

        // handleClick is private; cast to invoke the same path the click
        // listener routes through (the offline sink fires no real events).
        (cell as any).handleClick();

        expect(clicks).toBe(1);
    });

    it('suppresses the click callback while disabled', () => {
        let clicks = 0;
        const cell = new PickerCell('05', () => {
            clicks += 1;
        });

        cell.setDisabled(true);
        expect(cell.isDisabled()).toBe(true);

        (cell as any).handleClick();

        expect(clicks).toBe(0);
    });

    it('runs the callback again once re-enabled', () => {
        let clicks = 0;
        const cell = new PickerCell('05', () => {
            clicks += 1;
        });

        cell.setDisabled(true);
        cell.setDisabled(false);
        (cell as any).handleClick();

        expect(clicks).toBe(1);
    });
});

describe('PickerColumn setSelectedValue', () => {
    function columnWithCells(): { column: PickerColumn; cells: PickerCell[] } {
        const column = new PickerColumn('Hour');
        const cells  = ['00', '05', '10'].map(label => new PickerCell(label, () => {}));

        cells.forEach(cell => column.addCell(cell));

        return { column, cells };
    }

    it('selects exactly the cell whose label matches and clears the rest', () => {
        const { column, cells } = columnWithCells();

        column.setSelectedValue('05');

        expect(cells.map(c => c.isSelected())).toEqual([false, true, false]);
    });

    it('clears every cell on setSelectedValue(null)', () => {
        const { column, cells } = columnWithCells();

        column.setSelectedValue('05');
        column.setSelectedValue(null);

        expect(cells.map(c => c.isSelected())).toEqual([false, false, false]);
    });

    it('clears all cells when the value matches no label', () => {
        const { column, cells } = columnWithCells();

        column.setSelectedValue('99');

        expect(cells.some(c => c.isSelected())).toBe(false);
    });
});

describe('PickerCellList getMinSize (scroll surface)', () => {
    it('drops the vertical content minimum but keeps the horizontal one', () => {
        const list = new PickerCellList();

        // Two stacked children with a real content minimum — the runtime
        // situation the text cells create (each cell floors at its one-line
        // height, so the inherited VBox min sums to the full content height).
        // Plain Components carry the explicit minimum without triggering text
        // measurement, so no TestDOM is needed.
        const a = new Component();
        const b = new Component();
        a.setMinSize({ width: 40, height: 22 });
        b.setMinSize({ width: 40, height: 22 });
        list.addComponent(a);
        list.addComponent(b);

        const min = list.getMinSize();

        expect(min).not.toBeNull();
        // Vertical content min is dropped so the parent column can shrink the
        // list below its content and the `autoScroll: "y"` surface scrolls
        // instead of inflating the fixed-height picker panel past the viewport.
        expect(min!.height).toBe(0);
        // Horizontal min is preserved so the column still reserves label width.
        expect(min!.width).toBe(40);
    });
});

// Regression: clearCells only detached the old cells via removeAllComponents,
// leaking each cell's per-instance style rule every time the year scroller
// (or any other clearCells caller) rebuilds its cell list.
describe('PickerColumn.clearCells — disposes replaced cells', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    it('evicts the old cells\' style rules on clearCells', () => {
        const column = new PickerColumn('Hour');
        const cells  = ['00', '05', '10'].map(label => new PickerCell(label, () => {}));

        cells.forEach(cell => column.addCell(cell));
        cells.forEach(cell => cell.getElement(true));

        const ids = cells.map(cell => cell.getId());
        expect(ids.some(id => _ruleCacheKeys().some(key => key.startsWith('#' + id)))).toBe(true);

        column.clearCells();

        expect(ids.some(id => _ruleCacheKeys().some(key => key.startsWith('#' + id)))).toBe(false);
    });
});
