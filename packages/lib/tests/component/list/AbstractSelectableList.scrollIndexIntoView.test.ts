// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A `List` or `MultiSelectList` scrolls its focused row into view. The rows
// sit in an inner `Panel` with `autoScroll: "y"`, and which element of that
// panel really scrolls depends on its scrollbar style: the panel's own element
// under `"native"`, a second element inside it under `"overlay"`, the default.
// Every case therefore runs once per style and asserts three things about the
// offset: the scrolling element carries it, the panel's remembered offset
// (`getScrollTop()`) agrees with it, and under `"overlay"` the panel's own
// element was never written.
//
// Cases follow the `## Expected Behaviour` tables of
// plans/implemented/list-scroll-index-into-view.md: G = fixture, R = the
// nearest-edge rule, K = triggers, C = the keyboard context menu.
//
// The modelled DOM gives the cases their scroll geometry as follows.
//
//   - The viewport height is the size the test commits. `getInnerSize()` is
//     cached component state, so nothing is injected. The model has no border
//     box for the list's 1 px border, so the inner panel is the list's height.
//   - The recording sink stores each `scrollTop` / `scrollLeft` write on the
//     element's stub and `DOM.source.getScrollTop` reads it back. It does NOT
//     clamp, unlike a browser, so a wrong target shows as a wrong number.
//   - A scroll the browser made on its own (a touch pan, a drag of a native
//     scrollbar) is a write straight on the scrolling element, which goes
//     around `Panel.setScrollTop` and leaves the remembered offset stale.
//   - A visible scrollbar's band needs `setScrollExtent` on the scrolling
//     element BEFORE the first sized layout: the panel's layout pass then
//     reserves the band. A layout pass that commits nothing new does not
//     re-measure, so a later seed has no effect.
//
// Every case dispatches real events through `Event`'s window-level handlers;
// the teardown disposes every component a test built (see the header of
// `tests/overlay/Menu.keyboardSession.test.ts`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';
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

// The list's fixed row height (`ROW_HEIGHT_PX` in AbstractSelectableList.ts),
// restated here so every expected offset is derived from the contract and not
// read back from the code.
const ROW_HEIGHT = 22;

const ITEM_COUNT = 30;

// 30 rows of 22 px.
const CONTENT_HEIGHT = ITEM_COUNT * ROW_HEIGHT;

const LIST_WIDTH = 200;

// Five whole rows, so a row's "fully visible" boundary falls on a row edge
// and `PageDown` moves five rows.
const LIST_HEIGHT = 5 * ROW_HEIGHT;

// The largest offset: the content's height less the viewport's.
const MAX_OFFSET = CONTENT_HEIGHT - LIST_HEIGHT;

// `Row 0` … `Row 28`, then `Zulu`: the one item a type-ahead `z` can land on.
const ITEMS = Array.from({ length: ITEM_COUNT }, (_, index) => index === ITEM_COUNT - 1 ? 'Zulu' : 'Row ' + index);

// A content width past the list's, for the case that needs a horizontal bar.
const WIDE_CONTENT_WIDTH = 440;

/** The two styles a scrolling `Panel` draws its scrollbar in. */
type ScrollbarStyle = 'overlay' | 'native';

type AnyList = _List | _MultiSelectList;

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

/** The list's inner scroll panel. */
function innerPanel(list: AnyList): any {
    return (list as any)._innerPanel;
}

/** The element of the inner panel that really scrolls. */
function scroller(list: AnyList): Handle {
    return innerPanel(list).getScrollElement();
}

/**
 * Scrolls the list the way the browser does on its own: a write straight on
 * the scrolling element, which `Panel.setScrollTop` never hears of.
 *
 * @param list - The list to scroll.
 * @param patch - The offsets to write.
 */
function nativeScroll(list: AnyList, patch: { scrollTop?: number; scrollLeft?: number }): void {
    DOM.sink.apply(scroller(list), patch);
}

/** How many scroll-offset writes the sink has recorded so far. */
function scrollWrites(): number {
    return (DOM.sink as RecordingDOMSink).writes.filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * Asserts the list's vertical offset: on the scrolling element, in the
 * panel's remembered offset, and — under `"overlay"` — that the panel's own
 * element was left at 0. It first asserts that the scrolling element is the
 * one the panel's style implies, so the overlay check cannot be skipped by a
 * fixture whose two elements turn out to be the same.
 *
 * @param list - The list under test.
 * @param offset - The expected `scrollTop`.
 */
function expectOffset(list: AnyList, offset: number): void {
    const panel         = innerPanel(list);
    const panelElement  = panel.getElement();
    const scrollElement = scroller(list);
    const overlay       = panel.getScrollbarStyle() === 'overlay';

    expect(scrollElement !== panelElement).toBe(overlay);
    expect(DOM.source.getScrollTop(scrollElement)).toBe(offset);
    expect(panel.getScrollTop()).toBe(offset);

    if (overlay) {
        expect(DOM.source.getScrollTop(panelElement)).toBe(0);
    }
}

/**
 * The user presses a key while `el` has focus: a real `keydown` there.
 *
 * @param el - The focused element.
 * @param key - The key pressed.
 * @param init - Modifier keys held.
 */
function press(el: Handle, key: string, init: { shiftKey?: boolean } = {}): void {
    DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key, ...init }));
}

/**
 * Renders `list` at the fixture size with the given scrollbar style, and
 * focuses it.
 *
 * @param list - The list under test.
 * @param style - The inner panel's scrollbar style.
 * @param scrollExtent - A content extent to seed on the scrolling element
 *   before the first sized layout, for a case that needs a scrollbar's band.
 * @returns The list's element.
 */
function mount(list: AnyList, style: ScrollbarStyle, scrollExtent?: { width: number; height: number }): Handle {
    built.push(list);

    innerPanel(list).setScrollbarStyle(style);

    const el = list.getElement(true)!;

    setConnected(el, true);

    if (scrollExtent) {
        setScrollExtent(scroller(list), scrollExtent);
    }

    list.setWidth(LIST_WIDTH);
    list.setHeight(LIST_HEIGHT);
    list.doLayout();

    drainFrames();

    DOM.sink.focus(el);

    return el;
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
    describe('List scrolls its focused row into view — ' + style + ' scrollbars', () => {
        it('G0: the fixture has a five-row viewport, and the scrolling element the style implies', () => {
            const list = new _List({ items: ITEMS });

            mount(list, style);

            expect(innerPanel(list).getInnerSize().height).toBe(LIST_HEIGHT);
            expect(scroller(list) === innerPanel(list).getElement()).toBe(style === 'native');
        });

        // Row `i` spans `i * 22` to `i * 22 + 22`. With offset `s` and a
        // 110 px viewport: a row that starts above `s` lands on the top edge,
        // one that ends below `s + 110` lands on the bottom edge, and one
        // inside is left alone. R6–R9 start from an offset the panel never
        // heard of, so they also pin the fresh read of the offset.
        const NEAREST_EDGE_CASES: Array<{ id: string; before: number; row: number; after: number; why: string }> = [
            { id: 'R1', before: 0,   row: 2,  after: 0,   why: 'inside the view' },
            { id: 'R2', before: 0,   row: 4,  after: 0,   why: 'ends exactly on the bottom edge' },
            { id: 'R3', before: 0,   row: 5,  after: 22,  why: 'below: bottom edge' },
            { id: 'R4', before: 0,   row: 29, after: 550, why: 'below: bottom edge' },
            { id: 'R5', before: 550, row: 24, after: 528, why: 'above: top edge' },
            { id: 'R6', before: 300, row: 14, after: 300, why: 'inside 300–410' },
            { id: 'R7', before: 300, row: 13, after: 286, why: 'cut by the top edge' },
            { id: 'R8', before: 300, row: 18, after: 308, why: 'cut by the bottom edge' },
            { id: 'R9', before: 300, row: 12, after: 264, why: 'above: top edge' },
        ];

        for (const { id, before, row, after, why } of NEAREST_EDGE_CASES) {
            it(`${id}: from offset ${before}, focusing row ${row} leaves offset ${after} (${why})`, () => {
                const list = new _List({ items: ITEMS });

                mount(list, style);
                nativeScroll(list, { scrollTop: before });

                const writesBefore = scrollWrites();

                list.setFocusedIndex(row);

                expect(list.getFocusedIndex()).toBe(row);
                expectOffset(list, after);
                expect(scrollWrites() - writesBefore).toBe(after === before ? 0 : 1);
            });
        }

        it('K1: End focuses the last row and scrolls it onto the bottom edge', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'End');

            expect(list.getFocusedIndex()).toBe(ITEM_COUNT - 1);
            expectOffset(list, MAX_OFFSET);
        });

        it('K2: Home after End focuses the first row and scrolls back to the top', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'End');

            // Without this the case would pass on a list that never scrolls.
            expectOffset(list, MAX_OFFSET);

            press(el, 'Home');

            expect(list.getFocusedIndex()).toBe(0);
            expectOffset(list, 0);
        });

        it('K3: ArrowDown scrolls only once the focused row would leave the view, and ArrowUp back inside it does not', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            // The first press lands on row 0; the sixth on row 5, the first
            // row below the five-row view.
            for (let presses = 0; presses < 6; presses++) {
                press(el, 'ArrowDown');
            }

            expect(list.getFocusedIndex()).toBe(5);
            expectOffset(list, ROW_HEIGHT);

            press(el, 'ArrowUp');

            expect(list.getFocusedIndex()).toBe(4);
            expectOffset(list, ROW_HEIGHT);
        });

        it('K4: PageDown and PageUp keep the focused row in view', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'ArrowDown');

            expect(list.getFocusedIndex()).toBe(0);
            expectOffset(list, 0);

            // A page is five rows. Row 5 spans 110–132: bottom edge, 132 − 110.
            press(el, 'PageDown');

            expect(list.getFocusedIndex()).toBe(5);
            expectOffset(list, 22);

            // Row 10 spans 220–242: bottom edge, 242 − 110.
            press(el, 'PageDown');

            expect(list.getFocusedIndex()).toBe(10);
            expectOffset(list, 132);

            // Row 5 starts at 110, above the view at 132: top edge.
            press(el, 'PageUp');

            expect(list.getFocusedIndex()).toBe(5);
            expectOffset(list, 110);
        });

        it('K5: type-ahead scrolls to the row it focuses and selects nothing', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'z');

            expect(list.getFocusedIndex()).toBe(ITEM_COUNT - 1);
            expect(list.getSelectedIndex()).toBe(-1);
            expectOffset(list, MAX_OFFSET);
        });

        it('K6: a MultiSelectList follows the focused row while Shift+ArrowDown extends the selection', () => {
            const list = new _MultiSelectList({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'ArrowDown');

            for (let presses = 0; presses < 6; presses++) {
                press(el, 'ArrowDown', { shiftKey: true });
            }

            // Row 6 spans 132–154: bottom edge, 154 − 110.
            expect(list.getFocusedIndex()).toBe(6);
            expectOffset(list, 44);
        });

        it('K7: a row move leaves the horizontal offset of a horizontally scrolling list alone', () => {
            const list = new _List({ items: ITEMS, horizontalScrolling: true });
            const el   = mount(list, style);

            nativeScroll(list, { scrollLeft: 100 });
            press(el, 'End');

            expect(DOM.source.getScrollLeft(scroller(list))).toBe(100);
            expect(innerPanel(list).getScrollLeft()).toBe(100);
            expectOffset(list, MAX_OFFSET);
        });

        it('K8: a visible horizontal scrollbar\'s band is not counted as viewport', () => {
            const list = new _List({ items: ITEMS, horizontalScrolling: true });
            const el   = mount(list, style, { width: WIDE_CONTENT_WIDTH, height: CONTENT_HEIGHT });

            // The band's thickness differs between the two styles, so the
            // viewport is read from the panel instead of being restated.
            const viewportHeight = innerPanel(list).getInnerSize().height;

            expect(viewportHeight).toBeLessThan(LIST_HEIGHT);

            // Pin the viewport against something other than the value the
            // list itself reads. Under "overlay" the panel sizes its inner
            // scrolling element to the viewport, so that element's client
            // height is the same number. Under "native" the model does not
            // take a native bar out of an element's client height, so the
            // band is checked against the configured OS scrollbar width.
            if (style === 'overlay') {
                expect(DOM.source.getScrollMetrics(scroller(list)).clientHeight).toBe(viewportHeight);
            } else {
                expect(viewportHeight).toBe(LIST_HEIGHT - CONFIG.scrollBarWidth);
            }

            press(el, 'End');

            expectOffset(list, CONTENT_HEIGHT - viewportHeight);
        });

        it('K9: a list that is not displayed moves its focus but neither scrolls nor forgets its offset', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'End');
            list.setDisplayed(false);

            const writesBefore = scrollWrites();

            list.setFocusedIndex(0);

            expect(list.getFocusedIndex()).toBe(0);
            expect(scrollWrites() - writesBefore).toBe(0);
            expect(innerPanel(list).getScrollTop()).toBe(MAX_OFFSET);
        });

        it('K10: an index outside the items scrolls nothing', () => {
            const list = new _List({ items: ITEMS });
            const el   = mount(list, style);

            press(el, 'End');

            const writesBefore = scrollWrites();

            list.setFocusedIndex(-1);
            list.setFocusedIndex(ITEM_COUNT);

            expect(scrollWrites() - writesBefore).toBe(0);
            expectOffset(list, MAX_OFFSET);
        });

        it('K12: a key a host forwards through handleKey scrolls like one pressed on the list', () => {
            const list = new _List({ items: ITEMS });

            mount(list, style);

            // The entry point `ComboBox` forwards its dropdown's keys to.
            const end      = { key: 'End', preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
            const consumed = list.handleKey(end);

            expect(consumed).toBe(true);
            expectOffset(list, MAX_OFFSET);
        });

        it('C1: Shift+F10 scrolls a focused row that was out of view back in, and the menu point is under it', () => {
            const list      = new _List({ items: ITEMS });
            const el        = mount(list, style);
            const emissions: Array<{ index: number; event: MouseEvent }> = [];

            list.on('contextmenu', (index, event) => emissions.push({ index, event }));

            press(el, 'End');
            nativeScroll(list, { scrollTop: 0 });

            press(el, 'F10', { shiftKey: true });
            DOM.sink.dispatchEvent(el, makeEvent(el, 'contextmenu', { clientX: 100, clientY: 60 }));

            expect(emissions).toHaveLength(1);
            expect(emissions[0].index).toBe(ITEM_COUNT - 1);
            expectOffset(list, MAX_OFFSET);

            const lastRow  = (list as any)._rowPool[ITEM_COUNT - 1] as Component;
            const rowRect  = DOM.source.getViewportRect(lastRow);
            const listRect = DOM.source.getViewportRect(list);

            // The point is the row's own bottom edge, not the list's edge it
            // would be clamped to if the row were still out of view.
            expect(emissions[0].event.clientY).toBe(rowRect.bottom);
            expect(rowRect.top).toBeGreaterThanOrEqual(listRect.top);
            expect(rowRect.bottom).toBeLessThanOrEqual(listRect.bottom);
        });
    });
}

describe('List scrolls its focused row into view — never rendered', () => {
    it('K11: focusing a row of a list that was never rendered moves the focus and writes nothing', () => {
        const list = new _List({ items: ITEMS });

        built.push(list);

        expect(() => list.setFocusedIndex(20)).not.toThrow();
        expect(list.getFocusedIndex()).toBe(20);
        expect(innerPanel(list).getScrollTop()).toBe(0);
        expect(scrollWrites()).toBe(0);
    });
});
