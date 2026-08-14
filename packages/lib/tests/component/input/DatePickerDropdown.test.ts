//
// Regression: buildDayGrid only detached the previous month's cells via
// removeAllComponents, leaking each PickerDay / PickerBlankCell's per-instance
// style rule on every month-arrow navigation. DatePickerDropdown drives
// AbstractCalendarDropdown.buildDayGrid, which has no test file of its own
// today; mirrors TimePickerDropdown.test.ts's installTestDOM + any-cast setup
// to reach the protected day-grid internals.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
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

// Regression: the year scroller (opened via the month-label click) is a
// PickerColumn — the same scrollable-cell-list building block TimePickerDropdown
// uses — so it carries the same overlay Scrollbar. onPointerDown's blanket
// preventDefault() (added to keep the host input from blurring before a cell
// click lands) also fired for a pointerdown on that scrollbar; preventDefault()ing
// a pointerdown suppresses the browser's synthesized `mousedown` compatibility
// event the Scrollbar's thumb/track drag is wired to, making it undraggable.
// TestDOM has no selector engine (DOM.source.matches is an unconditional
// `false` stub), so the `.Scrollbar`-class match a real browser performs is
// mocked here, mirroring TimePickerDropdown.test.ts's equivalent coverage.
describe('AbstractCalendarDropdown.onPointerDown — scrollbar guard (year scroller)', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    function openYearScroller(): any {
        const dd: any = new DatePickerDropdown(() => {});

        dd.getElement(true);
        dd.setVisible(true);
        dd.openYearScroller();

        return dd;
    }

    it('does not preventDefault a pointerdown that lands on the year column\'s scrollbar', () => {
        installTestDOM(CONFIG);

        const dd    = openYearScroller();
        const list  = dd._yearColumn.getCellList();
        const bar   = list._scrollbarV;
        const thumb = bar._thumb.getElement(true);
        const root  = bar.getElement(true);

        vi.spyOn(DOM.source, 'matches').mockImplementation(
            (h: unknown, selector: string) => selector === '.Scrollbar' && h === root
        );

        const e = makeEvent(thumb, 'pointerdown');
        const preventDefault = vi.spyOn(e, 'preventDefault');

        dd.onPointerDown(e);

        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('still preventDefaults a pointerdown on a year cell', () => {
        installTestDOM(CONFIG);

        const dd   = openYearScroller();
        const list = dd._yearColumn.getCellList();
        const cell = list.getComponents()[0].getElement(true);

        vi.spyOn(DOM.source, 'matches').mockReturnValue(false);

        const e = makeEvent(cell, 'pointerdown');
        const preventDefault = vi.spyOn(e, 'preventDefault');

        dd.onPointerDown(e);

        expect(preventDefault).toHaveBeenCalled();
    });
});
