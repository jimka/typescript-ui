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
import { Event } from '~/core/Event';
import { Checkbox } from '~/component/input/Checkbox';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../../dom/TestDOM';
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

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);

    // `Event` installs one window-level base listener per event type and
    // remembers it across DOM installs, so a listener installed against a
    // previous case's window would leave the checkbox's DOM `change`
    // undelivered — and every commit assertion passing for the wrong reason.
    // Ritual copied from tests/component/input/Slider.test.ts.
    for (const id of Event._registeredComponentIds()) {
        Event.purgeComponent(id);
    }
});
afterEach(() => DOM.reset());

/** The Checkbox the cell's editor renders. */
function editorCheckbox(cell: BooleanCell): Checkbox {
    return cell.getRenderer().getComponents()[0] as Checkbox;
}

/**
 * A mounted BooleanCell whose editor's checkbox element is realized as well.
 * That realization is what lets a dispatched click reach the checkbox's box.
 */
function mountedCell(): BooleanCell {
    const host = new Container({});
    const cell = new BooleanCell();

    host.addComponent(cell);
    host.getElement(true);
    cell.getElement(true);
    editorCheckbox(cell).getElement(true);

    return cell;
}

/** DOM event dispatches of any type recorded on the sink since write index `start`. */
function dispatches(start: number): number {
    return sink.writes.slice(start).filter((w: any) => w.op === 'dispatchEvent').length;
}

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
        expect(commits).toEqual([true]);
    });
});

describe('BooleanCell commit fan-out', () => {
    it('commits once, with the new value, for a click on the checkbox\'s box', () => {
        // CONTRACT: the editor's only user-toggle signal is its checkbox's
        // "action". A click on the box must reach it exactly once.
        const cell     = mountedCell();
        const checkbox = editorCheckbox(cell) as any;
        const commits: Array<Boolean | null> = [];

        cell.setValue(false);
        cell.on('commit', (v: Boolean | null) => commits.push(v));

        Event.fireEvent(checkbox, makeEvent(checkbox._box.getElement(true), 'click', { button: 0 }) as any);

        expect(commits).toEqual([true]);
    });

    it('commits nothing and dispatches nothing for a pooled rebind', () => {
        // CONTRACT: `setValue` is the virtualized body's per-scroll-tick
        // rebind. It is a programmatic write, so it must reach neither the
        // editor's own "action" listener nor any DOM consumer.
        const cell    = mountedCell();
        const commits: Array<Boolean | null> = [];

        cell.on('commit', (v: Boolean | null) => commits.push(v));

        const start = sink.writes.length;
        cell.setValue(true);
        cell.setValue(false);

        expect(cell.getRenderer().getValue()).toBe(false);
        expect(commits).toEqual([]);
        expect(dispatches(start)).toBe(0);
    });

    it('leaves the indeterminate rebind branch silent too', () => {
        const cell    = mountedCell();
        const commits: Array<Boolean | null> = [];

        cell.on('commit', (v: Boolean | null) => commits.push(v));

        const start = sink.writes.length;
        cell.setValue(null);

        expect(editorCheckbox(cell).isIndeterminate()).toBe(true);
        expect(commits).toEqual([]);
        expect(dispatches(start)).toBe(0);

        cell.setReadOnly(true);
        cell.startEdit();

        expect(commits).toEqual([]);
    });
});
