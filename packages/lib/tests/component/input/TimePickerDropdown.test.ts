//
// TimePickerDropdown layout coverage. The picker is a fixed-height panel
// (`Fit` → TimeColumns → scrollable PickerColumn cell lists); these tests guard
// the regression where the panel inflated to its full cell content instead of
// holding its fixed height, which both broke the inner column scroll and pushed
// the panel past the viewport. TestDOM gives the layout pass real geometry; the
// internal TimeColumns/columns are reached by `any` cast (not barrel-exported,
// held in private fields) the same way the sibling value-math tests do.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { TimePickerDropdown } from '~/component/input/TimePickerDropdown';
import { PICKER_CELL_HEIGHT } from '~/component/input/PickerColumn';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The panel's fixed outer height (PANEL_HEIGHT in TimePickerDropdown — module
// private, so mirrored here). Far shorter than the stacked hour cells, which is
// the whole point: the columns scroll inside it.
const PANEL_HEIGHT = 220;

/**
 * Materialises and lays out a dropdown at the size `showAt` applies, without the
 * show animation / LayerManager mount. This is exactly the layout path `showAt`
 * runs once the element is on screen: set width/height, then `doLayout`.
 *
 * @param panelWidth - The outer width `showAt` would set (140 / 200).
 * @param showSeconds - Whether to build the third Sec column.
 * @returns The laid-out dropdown, typed `any` for private-field access.
 */
function layOutPanel(panelWidth: number, showSeconds: boolean): any {
    const dd: any = new TimePickerDropdown(() => {}, { showSeconds });

    dd.getElement(true);
    dd.setVisible(true);
    dd.setWidth(panelWidth);
    dd.setHeight(PANEL_HEIGHT);
    dd.doLayout();

    return dd;
}

describe('TimePickerDropdown fixed-height panel', () => {
    afterEach(() => DOM.reset());

    it('holds the fixed panel height instead of inflating to its cell content', () => {
        installTestDOM(CONFIG);

        const dd = layOutPanel(140, false);

        // The 24 stacked hour cells are far taller than PANEL_HEIGHT; the
        // regression let that content min clamp the panel up to ~556px.
        expect(dd.getHeight()).toBe(PANEL_HEIGHT);
    });
});

describe('TimePickerDropdown column scrolling', () => {
    afterEach(() => DOM.reset());

    function hourList(dd: any): any {
        return dd._timeColumns._hourColumn.getCellList();
    }

    it('allocates each column cell list less than its content height so it scrolls', () => {
        installTestDOM(CONFIG);

        const dd   = layOutPanel(140, false);
        const list = hourList(dd);

        const contentHeight = list.getComponents().length * PICKER_CELL_HEIGHT;

        // A positive, sub-content height means the `autoScroll: "y"` surface has
        // overflow to scroll rather than expanding to swallow every cell.
        expect(list.getHeight()).toBeGreaterThan(0);
        expect(list.getHeight()).toBeLessThan(contentHeight);
    });

    it('keeps the panel fixed and the lists scrollable in the seconds variant', () => {
        installTestDOM(CONFIG);

        const dd   = layOutPanel(200, true);
        const list = hourList(dd);

        const contentHeight = list.getComponents().length * PICKER_CELL_HEIGHT;

        expect(dd.getHeight()).toBe(PANEL_HEIGHT);
        expect(list.getHeight()).toBeGreaterThan(0);
        expect(list.getHeight()).toBeLessThan(contentHeight);
    });
});

// Regression: onPointerDown's blanket preventDefault() (added to keep the host
// input from blurring before a cell click lands) also fired for a pointerdown
// on the hour column's overlay Scrollbar. preventDefault()ing a pointerdown
// suppresses the browser's synthesized `mousedown` compatibility event for a
// real mouse pointer, and the Scrollbar thumb/track drag is wired to
// `mousedown` (Scrollbar.ts's `_onDragStart` / `_onTrackClick`) — so the
// scrollbar became undraggable. TestDOM has no selector engine (DOM.source
// .matches is an unconditional `false` stub — see TestDOM.ts), so the actual
// `.Scrollbar`-class match a real browser performs is mocked here the same
// way PanelOverlayScrollbar.test.ts mocks getScrollMetrics; the ancestor walk
// itself (getParentElement) is the harness's real modelled parent/child
// structure, not mocked.
describe('TimePickerDropdown.onPointerDown — scrollbar guard', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    function hourList(dd: any): any {
        return dd._timeColumns._hourColumn.getCellList();
    }

    it('does not preventDefault a pointerdown that lands on the column scrollbar', () => {
        installTestDOM(CONFIG);

        const dd    = layOutPanel(140, false);
        const list  = hourList(dd);
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

    it('still preventDefaults a pointerdown elsewhere in the panel (e.g. a cell)', () => {
        installTestDOM(CONFIG);

        const dd   = layOutPanel(140, false);
        const list = hourList(dd);
        const cell = list.getComponents()[0].getElement(true);

        vi.spyOn(DOM.source, 'matches').mockReturnValue(false);

        const e = makeEvent(cell, 'pointerdown');
        const preventDefault = vi.spyOn(e, 'preventDefault');

        dd.onPointerDown(e);

        expect(preventDefault).toHaveBeenCalled();
    });
});
