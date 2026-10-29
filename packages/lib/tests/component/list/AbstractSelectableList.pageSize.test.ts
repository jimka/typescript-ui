// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `PageUp` / `PageDown` in a `List` move by the number of whole rows the
// scroll viewport shows, and by at least one row. The viewport is the inner
// panel's box inside its border, less the band a visible scrollbar occupies —
// not the list's outer height, which counts that band and would make a page
// one row too long, so that one row per page is never shown whole.
//
// Cases L1–L3 of plans/implemented/scroll-reveal-geometry-fixes.md. See the
// header of `AbstractSelectableList.scrollIndexIntoView.test.ts` for how
// offline tests get scroll geometry and why the teardown stops two static
// watches.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _List } from '~/component/list/List';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, setConnected, setScrollExtent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The list's fixed row height (`ROW_HEIGHT_PX` in AbstractSelectableList.ts),
// restated here so the page sizes below are derived from the contract.
const ROW_HEIGHT = 22;

const LIST_WIDTH = 200;

// Ten rows and 10 px: the outer height holds ten whole rows, and the viewport
// under a horizontal scrollbar — 218 px with a 12 px overlay bar, 215 px with
// a 15 px native one — holds nine.
const TALL_LIST_HEIGHT = 10 * ROW_HEIGHT + 10;

// The viewport height L1 expects under each style: 230 less the bar's band.
const BANDED_VIEWPORT_HEIGHT = { overlay: 218, native: 215 } as const;

// Content past the list's box on both axes: twice its width, and 40 rows.
const WIDE_CONTENT = { width: 440, height: 40 * ROW_HEIGHT };

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

/** The list's inner scroll panel. */
function innerPanel(list: _List): any {
    return (list as any)._innerPanel;
}

/**
 * The user presses a key while `el` has focus: a real `keydown` there.
 *
 * @param el - The focused element.
 * @param key - The key pressed.
 */
function press(el: Handle, key: string): void {
    DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key }));
}

/**
 * Renders `list` at `height`, and focuses it.
 *
 * @param list - The list under test.
 * @param height - The list's outer height.
 * @param style - The inner panel's scrollbar style; the list's default when omitted.
 * @param scrollExtent - A content extent to seed on the scrolling element
 *   before the first sized layout, for a case that needs a scrollbar's band.
 * @returns The list's element.
 */
function mount(list: _List, height: number, style?: ScrollbarStyle, scrollExtent?: { width: number; height: number }): Handle {
    built.push(list);

    if (style) {
        innerPanel(list).setScrollbarStyle(style);
    }

    const el = list.getElement(true)!;

    setConnected(el, true);

    if (scrollExtent) {
        setScrollExtent(innerPanel(list).getScrollElement(), scrollExtent);
    }

    list.setWidth(LIST_WIDTH);
    list.setHeight(height);
    list.doLayout();

    drainFrames();

    DOM.sink.focus(el);

    return el;
}

/** `count` items labelled `Row 0` … */
function rows(count: number): string[] {
    return Array.from({ length: count }, (_, index) => 'Row ' + index);
}

beforeEach(() => {
    installTestDOM(CONFIG);

    frames = [];
    built  = [];

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
    describe('List page size under a horizontal scrollbar — ' + style + ' scrollbars', () => {
        it('L1: the scroll viewport is the list less the scrollbar\'s band: nine whole rows, not ten', () => {
            const list = new _List({ items: rows(40), horizontalScrolling: true });

            mount(list, TALL_LIST_HEIGHT, style, WIDE_CONTENT);

            const viewportHeight = innerPanel(list).getScrollViewportRect().height;

            expect(viewportHeight).toBe(BANDED_VIEWPORT_HEIGHT[style]);
            expect(Math.floor(viewportHeight / ROW_HEIGHT)).toBe(9);
            expect(Math.floor(list.getHeight() / ROW_HEIGHT)).toBe(10);
        });

        it('L2: PageDown and PageUp move nine rows', () => {
            const list = new _List({ items: rows(40), horizontalScrolling: true });
            const el   = mount(list, TALL_LIST_HEIGHT, style, WIDE_CONTENT);

            // The first navigation key enters the list on row 0.
            press(el, 'ArrowDown');
            expect(list.getFocusedIndex()).toBe(0);

            press(el, 'PageDown');
            expect(list.getFocusedIndex()).toBe(9);

            press(el, 'PageDown');
            expect(list.getFocusedIndex()).toBe(18);

            press(el, 'PageUp');
            expect(list.getFocusedIndex()).toBe(9);
        });
    });
}

describe('List page size with no scrollbar band', () => {
    it('L3: a list that shows five whole rows moves five', () => {
        const list = new _List({ items: rows(30) });
        const el   = mount(list, 5 * ROW_HEIGHT);

        press(el, 'ArrowDown');
        expect(list.getFocusedIndex()).toBe(0);

        press(el, 'PageDown');
        expect(list.getFocusedIndex()).toBe(5);

        press(el, 'PageDown');
        expect(list.getFocusedIndex()).toBe(10);

        press(el, 'PageUp');
        expect(list.getFocusedIndex()).toBe(5);
    });

    // Beyond the plan's table. The page size is a measurement of the scroll
    // viewport, and only the two page keys need it: every other navigation
    // key measures the viewport once, for the reveal of the row it lands on.
    it('L4: only PageUp and PageDown measure the viewport for a page size', () => {
        const list     = new _List({ items: rows(30) });
        const el       = mount(list, 5 * ROW_HEIGHT);
        const measured = vi.spyOn(innerPanel(list), 'getScrollViewportRect');

        for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home']) {
            measured.mockClear();

            press(el, key);

            expect(measured).toHaveBeenCalledTimes(1);
        }

        for (const key of ['PageDown', 'PageUp']) {
            measured.mockClear();

            press(el, key);

            expect(measured).toHaveBeenCalledTimes(2);
        }
    });
});
