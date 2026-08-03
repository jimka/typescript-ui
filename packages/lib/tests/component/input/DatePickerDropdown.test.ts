//
// Regression: buildDayGrid only detached the previous month's cells via
// removeAllComponents, leaking each PickerDay / PickerBlankCell's per-instance
// style rule on every month-arrow navigation. DatePickerDropdown drives
// AbstractCalendarDropdown.buildDayGrid, which has no test file of its own
// today; mirrors TimePickerDropdown.test.ts's installTestDOM + any-cast setup
// to reach the protected day-grid internals.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { DatePickerDropdown } from '~/component/input/DatePickerDropdown';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('AbstractCalendarDropdown.buildDayGrid — disposes replaced day cells', () => {
    afterEach(() => DOM.reset());

    it('evicts the previous month\'s day/blank cell style rules on rebuild', () => {
        installTestDOM(CONFIG);

        const dd: any = new DatePickerDropdown(() => {});

        dd.buildDayGrid();

        const firstCells: any[] = dd._dayGrid.getComponents();
        firstCells.forEach((cell) => cell.getElement(true));
        const ids: string[] = firstCells.map((cell) => cell.getId());

        expect(ids.some((id) => _ruleCacheKeys().some((key) => key.startsWith('#' + id)))).toBe(true);

        // Mirrors a month-arrow navigation, which also calls buildDayGrid again.
        dd.buildDayGrid();

        expect(ids.some((id) => _ruleCacheKeys().some((key) => key.startsWith('#' + id)))).toBe(false);
    });
});
