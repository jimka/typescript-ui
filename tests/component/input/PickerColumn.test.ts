//
// PickerColumn / PickerCell value-math coverage. Both are imported by module
// path (PickerColumn is not barrel-exported). PickerCell.handleClick is private
// and wired as a click listener; cast to invoke it directly (the offline sink
// runs no event loop). No TestDOM: selection state is read back without a
// layout pass.
import { describe, it, expect } from 'vitest';
import { PickerCell, PickerColumn } from '~/component/input/PickerColumn';

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
