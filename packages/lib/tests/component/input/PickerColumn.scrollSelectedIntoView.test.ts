// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `PickerColumn.scrollSelectedIntoView` puts the selected cell in the middle
// of the cell list's viewport, clamped to the scrollable range. It is what
// opens a calendar's year list on the calendar's year. The cell list is a
// `Panel` with `autoScroll: "y"`, and which of its elements really scrolls
// depends on its scrollbar style, so every case runs once per style and
// asserts the offset on the scrolling element, in the panel's remembered
// offset (`getScrollTop()`), and — under `"overlay"` — that the panel's own
// element was never written.
//
// `scrollCellIntoView` is the same centring for a cell the caller names. A
// calendar's year list needs it: two of its cells can be selected at once,
// the calendar's year and the year the keyboard is on, and the view has to
// follow the second.
//
// Cases P1–P7 follow the `PickerColumn` table of
// plans/implemented/list-scroll-index-into-view.md, and P8–P13 the table in
// its `## Implementation Notes`. See the header of
// `tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts`
// for how the modelled DOM is given scroll geometry.
//
// The module path is used because `PICKER_CELL_HEIGHT` is not barrel-exported.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PickerCell, PickerColumn, PICKER_CELL_HEIGHT } from '~/component/input/PickerColumn';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, setConnected, setScrollExtent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const FIRST_YEAR = 1990;

// `1990` … `2029`.
const CELL_COUNT = 40;

const COLUMN_WIDTH = 100;

// Seven whole cells, so the middle of the viewport is a cell edge plus half a
// cell and every expected offset below is a whole number.
const COLUMN_HEIGHT = 7 * PICKER_CELL_HEIGHT;

// 40 cells of 22 px.
const CONTENT_HEIGHT = CELL_COUNT * PICKER_CELL_HEIGHT;

// Where every case starts, written straight on the scrolling element, so a
// case in which the method writes nothing cannot pass by accident.
const START_OFFSET = 300;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

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

/** The element of the column's cell list that really scrolls. */
function scroller(column: PickerColumn): Handle {
    return (column.getCellList() as any).getScrollElement();
}

/** How many scroll-offset writes the sink has recorded so far. */
function scrollWrites(): number {
    return (DOM.sink as RecordingDOMSink).writes.filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * The cell of `column` labelled `label`.
 *
 * @param column - The column to search.
 * @param label - The cell's text.
 * @returns The cell.
 */
function cellLabelled(column: PickerColumn, label: string): PickerCell {
    const cell = column.getCellList().getComponents().find(
        child => child instanceof PickerCell && child.getText().valueOf() === label,
    );

    return cell as PickerCell;
}

/**
 * Asserts the column's vertical offset: on the scrolling element, in the cell
 * list's remembered offset, and — under `"overlay"` — that the cell list's own
 * element was left at 0.
 *
 * @param column - The column under test.
 * @param style - The cell list's scrollbar style.
 * @param offset - The expected `scrollTop`.
 */
function expectOffset(column: PickerColumn, style: ScrollbarStyle, offset: number): void {
    const cellList = column.getCellList();

    expect(DOM.source.getScrollTop(scroller(column))).toBe(offset);
    expect(cellList.getScrollTop()).toBe(offset);

    if (style === 'overlay') {
        expect(DOM.source.getScrollTop(cellList.getElement()!)).toBe(0);
    }
}

/**
 * Builds a column of the forty year cells with `selected` highlighted,
 * renders it at the fixture size with the given scrollbar style, and moves it
 * to the start offset the way the browser scrolls on its own.
 *
 * @param style - The cell list's scrollbar style.
 * @param selected - The label of the cell to select, or `null` for none.
 * @returns The mounted column.
 */
function mountYearColumn(style: ScrollbarStyle, selected: string | null): PickerColumn {
    const column = new PickerColumn(null);

    built.push(column);

    for (let index = 0; index < CELL_COUNT; index++) {
        column.addCell(new PickerCell(String(FIRST_YEAR + index), () => {}));
    }

    column.setSelectedValue(selected);
    column.getCellList().setScrollbarStyle(style);

    const el = column.getElement(true)!;

    setConnected(el, true);

    // Before the first sized layout: see the list test's header.
    setScrollExtent(scroller(column), { width: COLUMN_WIDTH, height: CONTENT_HEIGHT });

    column.setWidth(COLUMN_WIDTH);
    column.setHeight(COLUMN_HEIGHT);
    column.doLayout();

    drainFrames();

    DOM.sink.apply(scroller(column), { scrollTop: START_OFFSET });

    return column;
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
    describe('PickerColumn centres a cell — ' + style + ' scrollbars', () => {
        // The target is `cellTop − (154 − 22) / 2`, clamped to 0–726 (the
        // content's 880 less the viewport's 154).
        const CENTRING_CASES: Array<{ id: string; selected: string; cellTop: number; after: number; why: string }> = [
            { id: 'P1', selected: '2020', cellTop: 660, after: 594, why: 'centred' },
            { id: 'P2', selected: '1990', cellTop: 0,   after: 0,   why: 'clamped to the start' },
            { id: 'P3', selected: '2029', cellTop: 858, after: 726, why: 'clamped to the end' },
            { id: 'P4', selected: '1993', cellTop: 66,  after: 0,   why: 'exactly at the start' },
            { id: 'P5', selected: '1994', cellTop: 88,  after: 22,  why: 'the first cell that can be centred' },
        ];

        for (const { id, selected, cellTop, after, why } of CENTRING_CASES) {
            it(`${id}: with ${selected} selected (cell top ${cellTop}) the list scrolls to ${after} (${why})`, () => {
                const column   = mountYearColumn(style, selected);
                const cellList = column.getCellList();

                expect(cellList.getInnerSize()!.height).toBe(COLUMN_HEIGHT);

                column.scrollSelectedIntoView();

                expectOffset(column, style, after);
            });
        }

        it('P6: with no cell selected nothing is written', () => {
            const column       = mountYearColumn(style, null);
            const writesBefore = scrollWrites();

            column.scrollSelectedIntoView();

            expect(scrollWrites() - writesBefore).toBe(0);
            expect(DOM.source.getScrollTop(scroller(column))).toBe(START_OFFSET);
        });

        it('P8: with two cells selected, scrollSelectedIntoView centres the first', () => {
            const column = mountYearColumn(style, '2000');

            cellLabelled(column, '2020').setSelected(true);

            column.scrollSelectedIntoView();

            // 2000 is the 11th cell: top 220, less (154 − 22) / 2.
            expectOffset(column, style, 154);
        });

        it('P9: scrollCellIntoView centres the cell it is given, whichever cells are selected', () => {
            const column = mountYearColumn(style, '2000');
            const later  = cellLabelled(column, '2020');

            later.setSelected(true);

            column.scrollCellIntoView(later);

            // 2020 is the 31st cell: top 660, less 66. The first selected
            // cell, 2000, is 440 px above it and out of view.
            expectOffset(column, style, 594);
        });

        it('P10: scrollCellIntoView clamps to the scrollable range, and does not need the cell to be selected', () => {
            const column = mountYearColumn(style, null);

            column.scrollCellIntoView(cellLabelled(column, '2029'));

            expectOffset(column, style, 726);

            column.scrollCellIntoView(cellLabelled(column, '1990'));

            expectOffset(column, style, 0);
        });

        it('P13: a column that is not displayed neither scrolls nor forgets its offset', () => {
            const column   = mountYearColumn(style, '2020');
            const cellList = column.getCellList();

            column.scrollSelectedIntoView();

            expectOffset(column, style, 594);

            // An element without a layout box reports its offsets and its
            // scroll range as 0 and ignores a scroll write, so a call made
            // now could only record a wrong offset for the column to come
            // back at.
            column.setDisplayed(false);
            column.setSelectedValue('2000');

            const writesBefore = scrollWrites();

            column.scrollSelectedIntoView();
            column.scrollCellIntoView(cellLabelled(column, '1990'));

            expect(scrollWrites() - writesBefore).toBe(0);
            expect(cellList.getScrollTop()).toBe(594);
        });

        it('P11: scrollCellIntoView ignores a cell that belongs to another column', () => {
            const column       = mountYearColumn(style, '2000');
            const other        = mountYearColumn(style, null);
            const writesBefore = scrollWrites();

            column.scrollCellIntoView(cellLabelled(other, '2020'));

            expect(scrollWrites() - writesBefore).toBe(0);
            expect(DOM.source.getScrollTop(scroller(column))).toBe(START_OFFSET);
        });
    });
}

describe('PickerColumn centres a cell — never rendered', () => {
    it('P7: a column that was never rendered writes nothing', () => {
        const column = new PickerColumn(null);

        built.push(column);

        column.addCell(new PickerCell('2020', () => {}));
        column.setSelectedValue('2020');

        expect(() => column.scrollSelectedIntoView()).not.toThrow();
        expect(scrollWrites()).toBe(0);
    });

    it('P12: scrollCellIntoView on a column that was never rendered writes nothing', () => {
        const column = new PickerColumn(null);
        const cell   = new PickerCell('2020', () => {});

        built.push(column);

        column.addCell(cell);

        expect(() => column.scrollCellIntoView(cell)).not.toThrow();
        expect(scrollWrites()).toBe(0);
    });
});
