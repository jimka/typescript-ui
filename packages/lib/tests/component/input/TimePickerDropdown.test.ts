//
// TimePickerDropdown layout coverage. The picker is a fixed-height panel
// (`Fit` → TimeColumns → scrollable PickerColumn cell lists); these tests guard
// the regression where the panel inflated to its full cell content instead of
// holding its fixed height, which both broke the inner column scroll and pushed
// the panel past the viewport. TestDOM gives the layout pass real geometry; the
// internal TimeColumns/columns are reached by `any` cast (not barrel-exported,
// held in private fields) the same way the sibling value-math tests do.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
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
