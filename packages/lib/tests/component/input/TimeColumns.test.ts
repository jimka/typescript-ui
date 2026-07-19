//
// TimeColumns value-math coverage. TimeColumns is internal — not barrel-exported
// — so it is imported by module path. Its public contract is the onChange tuple
// emitted by the constructor callback; onUnitSelected and cellLabel are reached
// by capturing that callback and (for cellLabel) an `any` cast confined to this
// file. No TestDOM: the value math runs without a layout pass.
import { describe, it, expect } from 'vitest';
import { TimeColumns } from '~/component/input/TimeColumns';

/**
 * Drives a unit selection through the private onUnitSelected and returns the
 * emitted (h, m, s) tuple. The columns wire each cell's click to
 * onUnitSelected; cast to invoke it directly without a DOM click.
 */
function selectUnit(
    tc: TimeColumns,
    unit: 'hours' | 'minutes' | 'seconds',
    value: number,
): [number, number, number] {
    (tc as any).onUnitSelected(unit, value);

    return lastEmitted;
}

let lastEmitted: [number, number, number] = [-1, -1, -1];

function makeColumns(showSeconds = false): TimeColumns {
    lastEmitted = [-1, -1, -1];

    return new TimeColumns(
        (h, m, s) => {
            lastEmitted = [h, m, s];
        },
        { showSeconds },
    );
}

describe('TimeColumns onUnitSelected defaulting', () => {
    it('defaults minutes (and seconds) to 0 when only an hour is picked', () => {
        const tc = makeColumns(false);

        const tuple = selectUnit(tc, 'hours', 9);

        // The consumer always receives a complete time; unset units default to 0.
        expect(tuple).toEqual([9, 0, 0]);
    });

    it('always emits 0 seconds when showSeconds is false', () => {
        const tc = makeColumns(false);

        selectUnit(tc, 'hours', 8);
        const tuple = selectUnit(tc, 'minutes', 15);

        expect(tuple).toEqual([8, 15, 0]);
    });

    it('emits the picked seconds when showSeconds is true', () => {
        const tc = makeColumns(true);

        selectUnit(tc, 'hours', 8);
        selectUnit(tc, 'minutes', 15);
        const tuple = selectUnit(tc, 'seconds', 30);

        expect(tuple).toEqual([8, 15, 30]);
    });
});

describe('TimeColumns setTime seeding', () => {
    it('seeds the backing fields from a Date and clears them on null', () => {
        const tc = makeColumns(false);

        tc.setTime(new Date(2025, 0, 1, 7, 45));
        // After seeding, picking a new minute keeps the seeded hour.
        const tuple = selectUnit(tc, 'minutes', 20);

        expect(tuple).toEqual([7, 20, 0]);

        // Clearing resets every unit to -1; picking an hour now defaults the rest.
        tc.setTime(null);
        const cleared = selectUnit(tc, 'hours', 3);
        expect(cleared).toEqual([3, 0, 0]);
    });
});

describe('TimeColumns cellLabel', () => {
    it('formats a value as a two-digit label and maps -1 to null', () => {
        const tc = makeColumns(false);

        // cellLabel is private; cast to reach it.
        const label = (v: number): string | null => (tc as any).cellLabel(v);

        expect(label(-1)).toBe(null);
        expect(label(5)).toBe('05');
        expect(label(12)).toBe('12');
    });
});
