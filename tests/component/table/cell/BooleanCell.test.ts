//
// Regression coverage for boolean-cell vertical centering. The Body force-sizes
// every cell to the row height (see Body.bindAndPositionRows). A BooleanCell's
// checkbox carries a hard 16x16 max; if the cell clamps its committed height
// down to that content-derived max it sits shorter than the row, pinned to the
// top, and the checkbox no longer centers vertically. A Cell fits the geometry
// its host allocates, so it must accept the forced height like a Container does.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { Container } from '~/core/Container';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { BooleanCell } from '~/component/table/cell/Boolean';
import { BooleanEditor } from '~/component/table/cell/editor/Boolean';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('BooleanCell fills the row height', () => {
    function mountedCell(): BooleanCell {
        const host = new Container({});
        const cell = new BooleanCell();

        host.addComponent(cell);
        host.getElement(true);
        cell.getElement(true);

        return cell;
    }

    it('adopts a forced height taller than the checkbox max instead of clamping to it', () => {
        // CONTRACT: the cell fits its host's allocation. The checkbox's 16x16
        // max must not become the cell's ceiling.
        const cell = mountedCell();

        cell.setHeight(24);

        expect(cell.getHeight()).toBe(24);
    });

    it('centers the checkbox renderer vertically within the forced cell height', () => {
        const cell = mountedCell();

        cell.setWidth(80);
        cell.setHeight(24);
        cell.doLayout();

        const renderer = cell.getRenderer();

        // The 16px-tall checkbox editor sits centered: equal gap above and below.
        expect(renderer.getHeight()).toBe(16);
        expect(renderer.getY()).toBe((cell.getHeight() - renderer.getHeight()) / 2);
    });
});

describe('BooleanCell read-only', () => {
    function mountedCell(): BooleanCell {
        const host = new Container({});
        const cell = new BooleanCell();

        host.addComponent(cell);
        host.getElement(true);
        cell.getElement(true);

        return cell;
    }

    it('forwards read-only to the checkbox editor so user toggles are rejected', () => {
        const cell = mountedCell();
        const editor = cell.getRenderer() as BooleanEditor;

        expect(editor.isReadOnly()).toBe(false);

        cell.setReadOnly(true);
        expect(editor.isReadOnly()).toBe(true);

        cell.setReadOnly(false);
        expect(editor.isReadOnly()).toBe(false);
    });

    it('startEdit is a no-op while read-only (covers dblclick / keyboard toggle)', () => {
        const cell = mountedCell();
        const commits: Array<Boolean | null> = [];

        cell.on('commit', (v: Boolean | null) => commits.push(v));

        cell.setReadOnly(true);
        cell.startEdit();
        expect(commits).toEqual([]);

        cell.setReadOnly(false);
        cell.startEdit();
        expect(commits).toHaveLength(1);
    });
});
