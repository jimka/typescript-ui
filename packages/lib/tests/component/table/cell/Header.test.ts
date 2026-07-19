// HeaderCell label composition: the required asterisk and the sort arrow are
// two independent suffixes appended to the base title by a shared
// `_renderTitle` so setting one never clobbers the other. Pure text
// composition — the test DOM is installed because HeaderCell's constructor
// builds child components, but no render/measure is needed to read the text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { HeaderCell } from '~/component/table/cell/Header';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reads the composed label off the header cell's renderer. */
function label(cell: HeaderCell): string {
    return cell.getRenderer().getText().getText().toString();
}

describe('HeaderCell required asterisk + sort arrow composition', () => {
    it('shows only the base title when neither required nor sorted', () => {
        const cell = new HeaderCell('Name', 'name');

        expect(label(cell)).toBe('Name');
    });

    it('setRequired(true) appends the asterisk suffix', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);

        expect(label(cell)).toBe('Name *');
    });

    it('setSortState appends the sort arrow suffix, independent of required', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setSortState('asc');
        expect(label(cell)).toBe('Name ▲');

        cell.setSortState('desc');
        expect(label(cell)).toBe('Name ▼');
    });

    it('required + sorted shows both markers, asterisk before the arrow', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('asc');

        expect(label(cell)).toBe('Name * ▲');
    });

    it('clearSortState removes the arrow but keeps the asterisk', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('asc');
        cell.clearSortState();

        expect(label(cell)).toBe('Name *');
    });

    it('setRequired(false) removes the asterisk, keeping an active sort arrow', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('desc');
        cell.setRequired(false);

        expect(label(cell)).toBe('Name ▼');
    });
});
