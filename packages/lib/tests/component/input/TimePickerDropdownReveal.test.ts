// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A time picker opens on its selected time: each column that has a cell for
// the value opens with that cell in view. The columns are `PickerColumn`s, so
// the cell is centred — the column's own rule, the one a calendar's year list
// opens by — and clamped to the scrollable range. Only opening scrolls: a pick
// re-highlights in place and leaves a column the user scrolled where it is.
//
// Cases TP1–TP9 of the `## Implementation Notes` of
// plans/implemented/scroll-reveal-geometry-fixes.md, an addition to that plan.
//
// `TimePickerDropdown.showAt` is the one entry point every host opens the
// picker through: `TimeField`, the `TimeField` embedded in a
// `DateTimePickerDropdown`, and the table's time cell editor. TP1–TP8 call it
// directly and run under both scrollbar styles of the cell lists, since the
// element that really scrolls differs between them. TP9 goes through a
// `TimeField` with real key presses, which pins that the field opens its
// picker that way.
//
// The modelled DOM has no layout to measure overflowing content against, so
// each cell list's scroll extent is seeded with `setScrollExtent`. See the
// header of `tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts`
// for the rest of how offline tests get scroll geometry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimeField } from '~/component/input/TimeField';
import { TimePickerDropdown } from '~/component/input/TimePickerDropdown';
import { PickerCell, PICKER_CELL_HEIGHT } from '~/component/input/PickerColumn';
import type { PickerColumn } from '~/component/input/PickerColumn';
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

// A cell list's viewport: the panel's fixed 220 px (`PANEL_HEIGHT` in
// TimePickerDropdown.ts) less its 4 px insets top and bottom, the column's
// 18 px header and the 2 px gap under it. The model has no border box for the
// panel's 1 px border. Restated here so every expected offset is derived from
// the contract; case TP1 asserts the fixture really has it.
const VIEWPORT_HEIGHT = 220 - 4 - 4 - 18 - 2;

// 24 hour cells; 12 minute or second cells, one per five.
const HOUR_CELLS = 24;
const STEP_CELLS = 12;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

type ColumnName = 'hour' | 'minute' | 'second';

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

/** One of the picker's columns; the second column is null without `showSeconds`. */
function column(dropdown: TimePickerDropdown, name: ColumnName): PickerColumn {
    return (dropdown as any)._timeColumns['_' + name + 'Column'];
}

/** A column's cell list. */
function cellList(dropdown: TimePickerDropdown, name: ColumnName): any {
    return column(dropdown, name).getCellList();
}

/** The element of a column's cell list that really scrolls. */
function scroller(dropdown: TimePickerDropdown, name: ColumnName): Handle {
    return cellList(dropdown, name).getScrollElement();
}

/** How many writes the sink has recorded so far: the mark `scrollWrites` counts from. */
function writeMark(): number {
    return (DOM.sink as RecordingDOMSink).writes.length;
}

/**
 * How many scroll-offset writes the sink recorded after `from`.
 *
 * @param from - A mark taken with {@link writeMark}.
 * @returns The number of `apply` writes carrying `scrollTop` or `scrollLeft`.
 */
function scrollWrites(from: number): number {
    return (DOM.sink as RecordingDOMSink).writes.slice(from).filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * The offset that puts the cell at `index` in the middle of the viewport,
 * clamped to the scrollable range: the cell's top, less half of what the
 * viewport has left over once the cell is in it.
 *
 * @param index - The cell's position in its column.
 * @param cells - How many cells the column holds.
 * @returns The expected `scrollTop`.
 */
function centredOffset(index: number, cells: number): number {
    const cellTop = index * PICKER_CELL_HEIGHT;
    const centred = cellTop - (VIEWPORT_HEIGHT - PICKER_CELL_HEIGHT) / 2;
    const largest = cells * PICKER_CELL_HEIGHT - VIEWPORT_HEIGHT;

    return Math.min(Math.max(centred, 0), largest);
}

/**
 * Asserts where a column is and that its selected cell is in view: the offset
 * on the scrolling element, the same offset remembered by the cell list, the
 * cell list's own element untouched under `"overlay"`, and the cell at
 * `index` selected and wholly inside the viewport.
 *
 * @param dropdown - The dropdown under test.
 * @param name - The column.
 * @param offset - The expected `scrollTop`.
 * @param index - The position of the cell that must be selected and in view.
 */
function expectColumn(dropdown: TimePickerDropdown, name: ColumnName, offset: number, index: number): void {
    const list          = cellList(dropdown, name);
    const listElement   = list.getElement();
    const scrollElement = scroller(dropdown, name);
    const overlay       = list.getScrollbarStyle() === 'overlay';

    expect(scrollElement !== listElement).toBe(overlay);
    expect(DOM.source.getScrollTop(scrollElement)).toBe(offset);
    expect(list.getScrollTop()).toBe(offset);

    if (overlay) {
        expect(DOM.source.getScrollTop(listElement)).toBe(0);
    }

    const cell = list.getComponents()[index] as PickerCell;

    expect(cell.isSelected()).toBe(true);

    const cellTop = index * PICKER_CELL_HEIGHT;

    expect(cellTop).toBeGreaterThanOrEqual(offset);
    expect(cellTop + PICKER_CELL_HEIGHT).toBeLessThanOrEqual(offset + VIEWPORT_HEIGHT);
}

/**
 * Gives each column the given scrollbar style and makes its content extent
 * known to the model.
 *
 * @param dropdown - A dropdown whose elements exist.
 * @param style - The cell lists' scrollbar style.
 */
function prepareColumns(dropdown: TimePickerDropdown, style: ScrollbarStyle): void {
    const names: ColumnName[] = column(dropdown, 'second') ? ['hour', 'minute', 'second'] : ['hour', 'minute'];

    for (const name of names) {
        const cells = name === 'hour' ? HOUR_CELLS : STEP_CELLS;

        cellList(dropdown, name).setScrollbarStyle(style);
        setScrollExtent(scroller(dropdown, name), { width: 60, height: cells * PICKER_CELL_HEIGHT });
    }
}

/** An element on the page for a dropdown to anchor to. */
function anchorElement(): Handle {
    const anchor = new Component();

    built.push(anchor);

    const element = anchor.getElement(true)!;

    setConnected(element, true);

    return element;
}

/**
 * Builds a time picker with its columns in `style`, ready for `showAt`.
 *
 * @param style - The cell lists' scrollbar style.
 * @param showSeconds - Whether the picker has a seconds column.
 * @returns The dropdown, not yet shown.
 */
function buildPicker(style: ScrollbarStyle, showSeconds: boolean = false): TimePickerDropdown {
    // Not animated, so closing takes the element out at once and a case can
    // reopen the picker in the same task.
    const dropdown = new TimePickerDropdown(() => {}, { showSeconds, animated: false });

    built.push(dropdown);

    dropdown.getElement(true);

    prepareColumns(dropdown, style);

    return dropdown;
}

/**
 * A time today.
 *
 * @param hours - The hour, 0–23.
 * @param minutes - The minute.
 * @param seconds - The second.
 * @returns The date.
 */
function at(hours: number, minutes: number, seconds: number = 0): Date {
    return new Date(2026, 0, 15, hours, minutes, seconds);
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

for (const style of ['overlay', 'native'] as const) {
    describe('TimePickerDropdown opens on its selected time — ' + style + ' scrollbars', () => {
        it('TP1: 09:30 opens with the hour and the minute centred', () => {
            const dropdown = buildPicker(style);

            dropdown.showAt(anchorElement(), at(9, 30));

            expect(cellList(dropdown, 'hour').getInnerSize().height).toBe(VIEWPORT_HEIGHT);
            expect(cellList(dropdown, 'minute').getInnerSize().height).toBe(VIEWPORT_HEIGHT);
            expect(VIEWPORT_HEIGHT).toBe(192);

            // `09` is the 10th hour cell: top 198, less (192 − 22) / 2 = 85.
            expectColumn(dropdown, 'hour', 113, 9);
            expect(centredOffset(9, HOUR_CELLS)).toBe(113);

            // `30` is the 7th minute cell: top 132, less 85.
            expectColumn(dropdown, 'minute', 47, 6);
            expect(centredOffset(6, STEP_CELLS)).toBe(47);
        });

        it('TP2: a time near the end of both columns opens at their largest offsets', () => {
            const dropdown = buildPicker(style);

            dropdown.showAt(anchorElement(), at(23, 55));

            // 24 × 22 − 192 and 12 × 22 − 192: the last cell cannot be centred.
            expectColumn(dropdown, 'hour', 336, 23);
            expectColumn(dropdown, 'minute', 72, 11);
        });

        it('TP3: reopened on an early time, the columns come back to the top', () => {
            const dropdown = buildPicker(style);
            const anchor   = anchorElement();

            dropdown.showAt(anchor, at(23, 55));
            dropdown.hideAnimated();

            dropdown.showAt(anchor, at(2, 5));

            // `02` and `05` are within the first half viewport: clamped to 0.
            expectColumn(dropdown, 'hour', 0, 2);
            expectColumn(dropdown, 'minute', 0, 1);
        });

        it('TP4: reopened on the same time after the element came back at the top, the columns are centred again', () => {
            const dropdown = buildPicker(style);
            const anchor   = anchorElement();

            dropdown.showAt(anchor, at(9, 30));
            dropdown.hideAnimated();

            // A dropdown's element is taken out of the document when it closes
            // and comes back scrolled to the top, while each cell list still
            // remembers the offset it was centred at.
            DOM.sink.apply(scroller(dropdown, 'hour'),   { scrollTop: 0 });
            DOM.sink.apply(scroller(dropdown, 'minute'), { scrollTop: 0 });

            expect(cellList(dropdown, 'hour').getScrollTop()).toBe(113);

            dropdown.showAt(anchor, at(9, 30));

            expectColumn(dropdown, 'hour', 113, 9);
            expectColumn(dropdown, 'minute', 47, 6);
        });

        it('TP5: a minute with no cell of its own leaves the minute column alone', () => {
            const dropdown = buildPicker(style);

            // Where the minute column happens to be before the picker opens.
            DOM.sink.apply(scroller(dropdown, 'minute'), { scrollTop: 50 });

            dropdown.showAt(anchorElement(), at(9, 33));

            expectColumn(dropdown, 'hour', 113, 9);

            const selectedMinutes = cellList(dropdown, 'minute').getComponents()
                .filter((cell: PickerCell) => cell.isSelected());

            expect(selectedMinutes).toHaveLength(0);
            expect(DOM.source.getScrollTop(scroller(dropdown, 'minute'))).toBe(50);
            expect(cellList(dropdown, 'minute').getScrollTop()).toBe(0);
        });

        it('TP6: with no time selected the columns stay where they are', () => {
            const dropdown = buildPicker(style);

            // Where the columns happen to be before the picker opens. Offsets
            // are compared, not writes counted: the first layout pass puts
            // each column's cells in a content frame and writes the offsets
            // it found back around that move.
            DOM.sink.apply(scroller(dropdown, 'hour'),   { scrollTop: 50 });
            DOM.sink.apply(scroller(dropdown, 'minute'), { scrollTop: 50 });

            dropdown.showAt(anchorElement(), null);

            for (const name of ['hour', 'minute'] as const) {
                const selected = cellList(dropdown, name).getComponents()
                    .filter((cell: PickerCell) => cell.isSelected());

                expect(selected).toHaveLength(0);
                expect(DOM.source.getScrollTop(scroller(dropdown, name))).toBe(50);
                expect(cellList(dropdown, name).getScrollTop()).toBe(0);
            }
        });

        it('TP7: the seconds column opens on its selected second too', () => {
            const dropdown = buildPicker(style, true);

            dropdown.showAt(anchorElement(), at(9, 30, 45));

            expectColumn(dropdown, 'hour', 113, 9);
            expectColumn(dropdown, 'minute', 47, 6);

            // `45` is the 10th second cell: top 198, less 85 is 113, past the
            // largest offset of a 12-cell column, 72.
            expectColumn(dropdown, 'second', 72, 9);
        });

        it('TP8: a pick does not scroll a column the user scrolled', () => {
            const dropdown = buildPicker(style);

            dropdown.showAt(anchorElement(), at(9, 30));

            // The user scrolls the hour column to its end, then clicks `17`.
            DOM.sink.apply(scroller(dropdown, 'hour'), { scrollTop: 336 });

            const mark = writeMark();
            const cell = cellList(dropdown, 'hour').getComponents()[17] as PickerCell;

            DOM.sink.dispatchEvent(cell.getElement()!, makeEvent(cell.getElement()!, 'click', { button: 0 }));

            expect(cell.isSelected()).toBe(true);
            expect(scrollWrites(mark)).toBe(0);
            expect(DOM.source.getScrollTop(scroller(dropdown, 'hour'))).toBe(336);
            expect(DOM.source.getScrollTop(scroller(dropdown, 'minute'))).toBe(47);
        });

        it('TP9: a TimeField opens its picker on the field\'s time', () => {
            const field = new TimeField({ value: at(9, 30), dropdownAnimated: false });

            built.push(field);

            const fieldElement = field.getElement(true)!;

            setConnected(fieldElement, true);

            const input = (field as any)._input.getElement(true) as Handle;

            // ArrowDown in the closed field opens its picker. The picker and
            // its elements are created by that first open, so the columns are
            // prepared after it, and the open under test is the second.
            DOM.sink.dispatchEvent(input, makeEvent(input, 'keydown', { key: 'ArrowDown' }));

            const dropdown = (field as any)._dropdown as TimePickerDropdown;

            expect(dropdown.isOpen()).toBe(true);

            prepareColumns(dropdown, style);

            DOM.sink.dispatchEvent(input, makeEvent(input, 'keydown', { key: 'Escape' }));

            expect(dropdown.isOpen()).toBe(false);

            // Back at the top, as a re-mounted element is.
            DOM.sink.apply(scroller(dropdown, 'hour'),   { scrollTop: 0 });
            DOM.sink.apply(scroller(dropdown, 'minute'), { scrollTop: 0 });

            DOM.sink.dispatchEvent(input, makeEvent(input, 'keydown', { key: 'ArrowDown' }));

            expect(dropdown.isOpen()).toBe(true);

            expectColumn(dropdown, 'hour', 113, 9);
            expectColumn(dropdown, 'minute', 47, 6);
        });
    });
}
