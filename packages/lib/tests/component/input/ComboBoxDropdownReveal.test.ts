// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A `ComboBox` dropdown opens on its selected option: the row is scrolled into
// view by the least distance, the way a later arrow key scrolls, so an option
// below the first page opens flush with the dropdown's bottom edge. Opening
// fires neither `"change"` nor `"action"`.
//
// Cases C1–C3 of plans/implemented/scroll-reveal-geometry-fixes.md.
//
// Kept in its own file for the reason given at the top of
// `ComboBoxDropdownClose.test.ts`: an undisposed combo in a shared file breaks
// later `"change"` dispatch. See the header of
// `tests/component/list/AbstractSelectableList.scrollIndexIntoView.test.ts`
// for how offline tests get scroll geometry.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComboBox } from '~/component/input/ComboBox';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The dropdown's fixed row height (`COMBOBOX_DROPDOWN_ROW_HEIGHT_PX`) and its
// height cap (`COMBOBOX_DROPDOWN_MAX_HEIGHT_PX`), restated here so the expected
// offset is derived from the contract and not read back from the code.
const ROW_HEIGHT      = 22;
const DROPDOWN_HEIGHT = 200;

const OPTION_COUNT = 40;

const OPTIONS = Array.from({ length: OPTION_COUNT }, (_, index) => 'Option ' + index);

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

/** The list inside the combo's dropdown. */
function dropdownList(combo: ComboBox): any {
    return (combo as any)._dropdown.getList();
}

/** The scroll panel of the list inside the combo's dropdown. */
function innerPanel(combo: ComboBox): any {
    return dropdownList(combo)._innerPanel;
}

/** The element of that panel that really scrolls. */
function scroller(combo: ComboBox): Handle {
    return innerPanel(combo).getScrollElement();
}

/**
 * Builds a 160 × 24 combo box of forty options with `selectedIndex` selected
 * silently.
 *
 * @param selectedIndex - The option to select, or -1 for none.
 * @returns The mounted combo box.
 */
function mountCombo(selectedIndex: number): ComboBox {
    const combo = new ComboBox();

    built.push(combo);

    combo.setItems(OPTIONS);

    const el = combo.getElement(true)!;

    setConnected(el, true);

    combo.setWidth(160);
    combo.setHeight(24);
    combo.doLayout();

    drainFrames();

    combo.setSelectedIndex(selectedIndex, false);

    return combo;
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

describe('ComboBox dropdown opens on its selected option', () => {
    it('C1: an option below the first page opens flush with the bottom edge, and nothing fires', () => {
        const combo    = mountCombo(30);
        const onChange = vi.fn();
        const onAction = vi.fn();

        combo.on('change', onChange);
        combo.on('action', onAction);

        combo.openDropdown();

        expect(innerPanel(combo).getScrollViewportRect().height).toBe(DROPDOWN_HEIGHT);

        // Option 30 is the 31st row and ends at 31 × 22 = 682; the viewport
        // is 200 high, so it ends on the bottom edge at 482.
        const expected = 31 * ROW_HEIGHT - DROPDOWN_HEIGHT;

        expect(expected).toBe(482);
        expect(innerPanel(combo).getScrollTop()).toBe(expected);
        expect(DOM.source.getScrollTop(scroller(combo))).toBe(expected);

        expect(dropdownList(combo).getFocusedIndex()).toBe(30);
        expect(dropdownList(combo).getSelectedIndex()).toBe(30);

        expect(onChange).not.toHaveBeenCalled();
        expect(onAction).not.toHaveBeenCalled();
    });

    it('C2: an option on the first page leaves the dropdown at the top', () => {
        const combo = mountCombo(2);

        combo.openDropdown();

        expect(innerPanel(combo).getScrollTop()).toBe(0);
        expect(DOM.source.getScrollTop(scroller(combo))).toBe(0);
    });

    it('C3: with no selection the dropdown opens at the top with no row focused', () => {
        const combo = mountCombo(-1);

        combo.openDropdown();

        expect(innerPanel(combo).getScrollTop()).toBe(0);
        expect(dropdownList(combo).getFocusedIndex()).toBe(-1);
    });

    // Beyond the plan's table: the same dropdown is shown again each time the
    // combo opens. Its element is taken out of the document when it closes
    // and comes back scrolled to the top, while the list's panel still
    // remembers the offset it was left at.
    it('C4: reopened, the dropdown is on its selected option again', () => {
        const combo = mountCombo(30);

        combo.openDropdown();

        expect(innerPanel(combo).getScrollTop()).toBe(482);

        // The combo's own close, which a click on it or `Escape` ends in.
        (combo as any).closeDropdown();

        expect((combo as any)._dropdown.isOpen()).toBe(false);

        // What a re-mounted element reports.
        DOM.sink.apply(scroller(combo), { scrollTop: 0 });

        expect(innerPanel(combo).getScrollTop()).toBe(482);

        combo.openDropdown();

        expect(DOM.source.getScrollTop(scroller(combo))).toBe(482);
        expect(innerPanel(combo).getScrollTop()).toBe(482);
    });
});
