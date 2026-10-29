// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The year list of a calendar dropdown follows its keyboard highlight. The
// list is a `PickerColumn` swapped in for the day grid. Two of its cells can
// be drawn selected at once: the calendar's own year, and the year the
// keyboard is on (the highlight). The view follows the highlight, in both
// directions, and centres it, which is the picker's rule for the year it
// opens on as well.
//
// Cases follow the year-list table in the `## Implementation Notes` of
// plans/implemented/list-scroll-index-into-view.md: Y1 = on open, Y2–Y8 = a
// key that moves the highlight, Y9–Y13 = a view the user scrolled is left
// alone until the highlight moves, F1 = the same through the field.
//
// Every Y-case runs for both dropdowns that share the year list —
// `DatePickerDropdown` (behind `DateField`) and `DateTimePickerDropdown`
// (behind `DateTimeField`) — and under both scrollbar styles of the cell
// list, since the element that really scrolls differs between them. Keys go
// through `handleKey`, the entry point the host field forwards its keys to.
// F1 runs for both fields and presses real keys in the field's input, which
// pins that forwarding.
//
// The modelled DOM has no layout to measure overflowing content against, so
// the cell list's scroll extent is seeded with `setScrollExtent`. The year
// column and its elements are created the first time the list opens, so the
// fixture opens it once, seeds the extent, closes it and opens it again: the
// second open is the one the cases start from. See the header of
// `tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts`
// for the rest of how offline tests get scroll geometry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateField } from '~/component/input/DateField';
import { DatePickerDropdown } from '~/component/input/DatePickerDropdown';
import { DateTimeField } from '~/component/input/DateTimeField';
import { DateTimePickerDropdown } from '~/component/input/DateTimePickerDropdown';
import { PickerCell, PICKER_CELL_HEIGHT } from '~/component/input/PickerColumn';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, setConnected, setScrollExtent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The legal range the fixture gives the calendar: forty years, so the year
// list has forty cells whatever today's date is.
const FIRST_YEAR = 1990;
const LAST_YEAR  = 2029;
const YEAR_COUNT = LAST_YEAR - FIRST_YEAR + 1;

// The year the calendar shows when the list opens: mid-range, so a move in
// either direction has room and neither end clamps.
const CALENDAR_YEAR = 2010;

// 40 cells of 22 px.
const CONTENT_HEIGHT = YEAR_COUNT * PICKER_CELL_HEIGHT;

// The year list takes the day grid's slot, and the day grid is six rows of
// 24 px with five 2 px gaps (`DAY_GRID_HEIGHT` in AbstractCalendarDropdown.ts).
// Restated here so every expected offset is derived from the contract; case
// Y1 asserts the fixture really has it.
const VIEWPORT_HEIGHT = 6 * 24 + 5 * 2;

// The largest offset: the content's height less the viewport's.
const MAX_OFFSET = CONTENT_HEIGHT - VIEWPORT_HEIGHT;

// Where the user scrolls the list to in the cases about a scrolled view: far
// from every offset a centring call would write in them (374 and above), so a
// list that was brought back cannot be mistaken for one that was left alone.
const USER_SCROLL_OFFSET = 100;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

type CalendarDropdown = DatePickerDropdown | DateTimePickerDropdown;

// The legal range as the two options every dropdown and field here takes.
const RANGE = { minDate: new Date(FIRST_YEAR, 0, 1), maxDate: new Date(LAST_YEAR, 11, 31) };

const DROPDOWNS: Array<{ name: string; build: () => CalendarDropdown }> = [
    { name: 'DatePickerDropdown',     build: () => new DatePickerDropdown(() => {}, RANGE) },
    { name: 'DateTimePickerDropdown', build: () => new DateTimePickerDropdown(() => {}, RANGE) },
];

type CalendarField = DateField | DateTimeField;

const FIELDS: Array<{ name: string; build: () => CalendarField }> = [
    { name: 'DateField',     build: () => new DateField({ ...RANGE, value: new Date(CALENDAR_YEAR, 5, 15) }) },
    { name: 'DateTimeField', build: () => new DateTimeField({ ...RANGE, value: new Date(CALENDAR_YEAR, 5, 15) }) },
];

let frames: FrameRequestCallback[];
let built: Component[];

/** Runs every captured animation frame, including those a frame schedules. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;

        frames = [];

        for (const callback of pending) {
            callback(0);
        }
    }
}

/** The dropdown's year column's cell list. */
function cellList(dropdown: CalendarDropdown): any {
    return (dropdown as any)._yearColumn.getCellList();
}

/** The element of the year list that really scrolls. */
function scroller(dropdown: CalendarDropdown): Handle {
    return cellList(dropdown).getScrollElement();
}

/** How many scroll-offset writes the sink has recorded so far. */
function scrollWrites(): number {
    return (DOM.sink as RecordingDOMSink).writes.filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * The offset that puts `year`'s cell in the middle of the viewport, clamped
 * to the scrollable range: the cell's top, less half of what the viewport has
 * left over once the cell is in it.
 *
 * @param year - The year whose cell is centred.
 * @returns The expected `scrollTop`.
 */
function centredOffset(year: number): number {
    const cellTop = (year - FIRST_YEAR) * PICKER_CELL_HEIGHT;
    const centred = cellTop - (VIEWPORT_HEIGHT - PICKER_CELL_HEIGHT) / 2;

    return Math.min(Math.max(centred, 0), MAX_OFFSET);
}

/** The labels of the year cells drawn selected, in list order. */
function selectedYears(dropdown: CalendarDropdown): string[] {
    return cellList(dropdown).getComponents()
        .filter((cell: Component) => cell instanceof PickerCell && cell.isSelected())
        .map((cell: PickerCell) => cell.getText().valueOf());
}

/**
 * Asserts where the year list is and that `highlight` is in view: the offset
 * on the scrolling element, the same offset remembered by the cell list, the
 * cell list's own element untouched under `"overlay"`, and the highlighted
 * year's cell wholly inside the viewport.
 *
 * @param dropdown - The dropdown under test.
 * @param offset - The expected `scrollTop`.
 * @param highlight - The year the keyboard is on.
 */
function expectView(dropdown: CalendarDropdown, offset: number, highlight: number): void {
    const list          = cellList(dropdown);
    const listElement   = list.getElement();
    const scrollElement = scroller(dropdown);
    const overlay       = list.getScrollbarStyle() === 'overlay';

    expect(scrollElement !== listElement).toBe(overlay);
    expect(DOM.source.getScrollTop(scrollElement)).toBe(offset);
    expect(list.getScrollTop()).toBe(offset);

    if (overlay) {
        expect(DOM.source.getScrollTop(listElement)).toBe(0);
    }

    const cellTop = (highlight - FIRST_YEAR) * PICKER_CELL_HEIGHT;

    expect(cellTop).toBeGreaterThanOrEqual(offset);
    expect(cellTop + PICKER_CELL_HEIGHT).toBeLessThanOrEqual(offset + VIEWPORT_HEIGHT);
}

/**
 * The user presses a key while the host field has focus: the field forwards
 * it to the dropdown's `handleKey`.
 *
 * @param dropdown - The open dropdown.
 * @param key - The key pressed.
 * @returns Whether the dropdown handled the key.
 */
function press(dropdown: CalendarDropdown, key: string): boolean {
    return dropdown.handleKey({ key, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent);
}

/**
 * Scrolls the year list the way the wheel or a scrollbar drag does as far as
 * the calendar is concerned: the view moves and no highlight does.
 *
 * @param dropdown - The dropdown under test.
 * @param offset - The `scrollTop` to move to.
 */
function userScroll(dropdown: CalendarDropdown, offset: number): void {
    DOM.sink.apply(scroller(dropdown), { scrollTop: offset });
}

/**
 * Opens the year list of an open `dropdown`, with the cell list in the given
 * scrollbar style and its content extent known to the model.
 *
 * @param dropdown - The open dropdown.
 * @param style - The cell list's scrollbar style.
 */
function showYearList(dropdown: CalendarDropdown, style: ScrollbarStyle): void {
    // The first open creates the year column and its elements.
    (dropdown as any).openYearScroller();

    cellList(dropdown).setScrollbarStyle(style);
    setScrollExtent(scroller(dropdown), { width: cellList(dropdown).getWidth(), height: CONTENT_HEIGHT });

    // The second open is the one under test: it lays the list out and
    // centres it with the extent in place.
    (dropdown as any).closeYearScroller();
    (dropdown as any).openYearScroller();

    drainFrames();
}

/**
 * Opens `dropdown` on June of `calendarYear` and opens its year list.
 *
 * @param dropdown - The dropdown under test.
 * @param style - The cell list's scrollbar style.
 * @param calendarYear - The year the calendar shows.
 */
function openYearList(dropdown: CalendarDropdown, style: ScrollbarStyle, calendarYear: number = CALENDAR_YEAR): void {
    built.push(dropdown);

    const anchor = new Component();

    built.push(anchor);

    const anchorElement = anchor.getElement(true)!;

    setConnected(anchorElement, true);

    dropdown.showAt(anchorElement, new Date(calendarYear, 5, 15));

    showYearList(dropdown, style);
}

/**
 * The user presses a key in a field's input: a real `keydown` there.
 *
 * @param input - The field's input element.
 * @param key - The key pressed.
 */
function pressInField(input: Handle, key: string): void {
    DOM.sink.dispatchEvent(input, makeEvent(input, 'keydown', { key }));
}

beforeEach(() => {
    installTestDOM(CONFIG);

    frames = [];
    built  = [];

    // A scrolling panel schedules a follow-up layout frame. Capture it, so a
    // case can run it by hand and the teardown can drain what is left.
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });
});

afterEach(() => {
    drainFrames();

    vi.restoreAllMocks();

    for (const component of built) {
        component.dispose();
    }

    DOM.reset();
});

for (const { name, build } of DROPDOWNS) {
    for (const style of ['overlay', 'native'] as const) {
        describe(`${name} year list follows its highlight — ${style} scrollbars`, () => {
            it('Y1: the list opens centred on the calendar\'s year', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                expect(cellList(dropdown).getComponents()).toHaveLength(YEAR_COUNT);
                expect(cellList(dropdown).getInnerSize().height).toBe(VIEWPORT_HEIGHT);
                expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR)]);

                // 2010 is the 21st cell: top 440, less (154 − 22) / 2.
                expectView(dropdown, 374, CALENDAR_YEAR);
            });

            it('Y2: ArrowDown moves the highlight to later years and the view follows each press', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                // Five presses take the highlight 110 px below the calendar's
                // year, which is past the 77 px the viewport shows below its
                // middle: a view left on the calendar's year loses it.
                const expected = [396, 418, 440, 462, 484];

                for (let presses = 1; presses <= expected.length; presses++) {
                    expect(press(dropdown, 'ArrowDown')).toBe(true);

                    const highlight = CALENDAR_YEAR + presses;

                    expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR), String(highlight)]);
                    expectView(dropdown, expected[presses - 1], highlight);
                    expect(expected[presses - 1]).toBe(centredOffset(highlight));
                }
            });

            it('Y3: ArrowUp moves the highlight to earlier years and the view follows each press', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                const expected = [352, 330, 308, 286, 264];

                for (let presses = 1; presses <= expected.length; presses++) {
                    expect(press(dropdown, 'ArrowUp')).toBe(true);

                    const highlight = CALENDAR_YEAR - presses;

                    expect(selectedYears(dropdown)).toEqual([String(highlight), String(CALENDAR_YEAR)]);
                    expectView(dropdown, expected[presses - 1], highlight);
                    expect(expected[presses - 1]).toBe(centredOffset(highlight));
                }
            });

            it('Y4: the highlight is followed back across the calendar\'s year', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                press(dropdown, 'ArrowDown');
                press(dropdown, 'ArrowDown');
                press(dropdown, 'ArrowUp');
                press(dropdown, 'ArrowUp');

                // Back on the calendar's own year: one cell selected again.
                expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR)]);
                expectView(dropdown, 374, CALENDAR_YEAR);

                press(dropdown, 'ArrowUp');

                expectView(dropdown, 352, CALENDAR_YEAR - 1);
            });

            it('Y5: PageDown moves ten years later and the view follows', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                expect(press(dropdown, 'PageDown')).toBe(true);

                // 2020 is the 31st cell: top 660, less 66.
                expectView(dropdown, 594, CALENDAR_YEAR + 10);
            });

            it('Y6: PageUp moves ten years earlier and the view follows', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                expect(press(dropdown, 'PageUp')).toBe(true);

                // 2000 is the 11th cell: top 220, less 66.
                expectView(dropdown, 154, CALENDAR_YEAR - 10);
            });

            it('Y7: End and Home take the highlight and the view to the last and the first year', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                expect(press(dropdown, 'End')).toBe(true);

                // The last cell cannot be centred: the range ends at 880 − 154.
                expectView(dropdown, MAX_OFFSET, LAST_YEAR);

                expect(press(dropdown, 'Home')).toBe(true);

                expectView(dropdown, 0, FIRST_YEAR);
            });

            it('Y8: type-ahead to a later year takes the view to it', () => {
                const dropdown = build();

                openYearList(dropdown, style);

                // "2" and "20" match 2000 first, the 11th cell: top 220, less
                // 66. "202" matches 2020; "2025" is the 36th cell: top 770,
                // less 66.
                press(dropdown, '2');

                expectView(dropdown, 154, 2000);

                press(dropdown, '0');

                expectView(dropdown, 154, 2000);

                press(dropdown, '2');

                expectView(dropdown, 594, 2020);

                press(dropdown, '5');

                expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR), '2025']);
                expectView(dropdown, 704, 2025);
            });

            it('Y9: a view the user scrolled is left alone while the highlight does not move', () => {
                const dropdown = build();

                openYearList(dropdown, style);
                press(dropdown, 'ArrowDown');
                userScroll(dropdown, USER_SCROLL_OFFSET);

                const writesBefore = scrollWrites();

                // A layout pass, a month-arrow click (which re-marks the
                // calendar's year in the open list) and a key the list does
                // not handle: none of them moves the highlight.
                dropdown.doLayout();
                drainFrames();
                (dropdown as any).nextMonth();

                expect(press(dropdown, 'F2')).toBe(false);

                expect(scrollWrites() - writesBefore).toBe(0);
                expect(DOM.source.getScrollTop(scroller(dropdown))).toBe(USER_SCROLL_OFFSET);

                // The month arrow re-marks the calendar's year; the year the
                // keyboard is on stays marked beside it.
                expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR), String(CALENDAR_YEAR + 1)]);
            });

            it('Y10: after the user scrolled away, the next highlight move centres the highlight again', () => {
                const dropdown = build();

                openYearList(dropdown, style);
                press(dropdown, 'ArrowDown');
                press(dropdown, 'ArrowDown');
                userScroll(dropdown, USER_SCROLL_OFFSET);

                press(dropdown, 'ArrowDown');

                // 2013 is the 24th cell: top 506, less 66.
                expectView(dropdown, 440, CALENDAR_YEAR + 3);
            });

            it('Y11: a key at the end of the list, where the highlight cannot move, leaves a scrolled view alone', () => {
                const dropdown = build();

                openYearList(dropdown, style);
                press(dropdown, 'End');
                userScroll(dropdown, USER_SCROLL_OFFSET);

                const writesBefore = scrollWrites();

                // Both keys are the list's own, and neither has anywhere to
                // take the highlight from the last year.
                expect(press(dropdown, 'End')).toBe(true);
                expect(press(dropdown, 'ArrowDown')).toBe(true);
                expect(press(dropdown, 'PageDown')).toBe(true);

                expect(selectedYears(dropdown)).toEqual([String(CALENDAR_YEAR), String(LAST_YEAR)]);
                expect(scrollWrites() - writesBefore).toBe(0);
                expect(DOM.source.getScrollTop(scroller(dropdown))).toBe(USER_SCROLL_OFFSET);

                // The first key that does move it brings the view back.
                press(dropdown, 'ArrowUp');

                expectView(dropdown, MAX_OFFSET, LAST_YEAR - 1);
            });

            it('Y12: a typed digit that matches the year already highlighted leaves a scrolled view alone', () => {
                const dropdown = build();

                openYearList(dropdown, style);
                press(dropdown, '2');
                userScroll(dropdown, USER_SCROLL_OFFSET);

                const writesBefore = scrollWrites();

                // "20" matches 2000 again, the year "2" put the highlight on.
                expect(press(dropdown, '0')).toBe(true);

                expect(scrollWrites() - writesBefore).toBe(0);
                expect(DOM.source.getScrollTop(scroller(dropdown))).toBe(USER_SCROLL_OFFSET);

                // "202" moves it to 2020.
                press(dropdown, '2');

                expectView(dropdown, 594, 2020);

                // Closing the list drops the type-ahead buffer and its idle
                // timer, which would otherwise outlive the test.
                press(dropdown, 'Escape');
            });

            it('Y13: before any key the highlight is the calendar\'s year, so a key that lands on it moves nothing', () => {
                const dropdown = build();

                openYearList(dropdown, style, LAST_YEAR);

                // The list opened on its last year: the range's end.
                expectView(dropdown, MAX_OFFSET, LAST_YEAR);

                userScroll(dropdown, USER_SCROLL_OFFSET);

                const writesBefore = scrollWrites();

                expect(press(dropdown, 'ArrowDown')).toBe(true);
                expect(press(dropdown, 'End')).toBe(true);

                expect(selectedYears(dropdown)).toEqual([String(LAST_YEAR)]);
                expect(scrollWrites() - writesBefore).toBe(0);
                expect(DOM.source.getScrollTop(scroller(dropdown))).toBe(USER_SCROLL_OFFSET);
            });
        });
    }
}

for (const { name, build } of FIELDS) {
    for (const style of ['overlay', 'native'] as const) {
        describe(`${name} forwards its keys to the year list — ${style} scrollbars`, () => {
            it('F1: keys pressed in the field move the highlight and the view follows', () => {
                const field = build();

                built.push(field);

                const fieldElement = field.getElement(true)!;

                setConnected(fieldElement, true);

                const input = (field as any)._input.getElement(true) as Handle;

                // ArrowDown in the closed field opens its calendar.
                pressInField(input, 'ArrowDown');

                const dropdown = (field as any)._dropdown as CalendarDropdown;

                expect(dropdown.isOpen()).toBe(true);

                showYearList(dropdown, style);

                expectView(dropdown, 374, CALENDAR_YEAR);

                for (let presses = 0; presses < 5; presses++) {
                    pressInField(input, 'ArrowDown');
                }

                // 2015 is the 26th cell: top 550, less 66.
                expectView(dropdown, 484, CALENDAR_YEAR + 5);

                pressInField(input, 'PageUp');

                // 2005 is the 16th cell: top 330, less 66.
                expectView(dropdown, 264, CALENDAR_YEAR - 5);
            });
        });
    }
}
