//
// Offline coverage for ColumnConfig.renderer — the custom cell-renderer seam.
// A column that supplies a `renderer` factory routes every cell to a
// display-only Cell wrapping a fresh renderer from the factory, overriding both
// the `values` (combo) routing and the field-type switch. Row builds one cell
// per column in its current column window via the private createCellForField,
// so windowing a Row exercises the routing end-to-end.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Row } from '~/component/table/Row';
import { StringCell } from '~/component/table/cell/String';
import { ComboCell } from '~/component/table/cell/Combo';
import { CellRenderer } from '~/component/table/cell/renderer/CellRenderer';
import { LinkCellRenderer } from '~/component/table/cell/renderer/Link';
import { Link } from '~/component/input/Link';
import { Text } from '~/component/input/Text';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig } from '~/component/table/ColumnConfig';
import type { Cell } from '~/component/table/cell/Cell';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([
    { name: 'ref',  type: 'string', order: 0 },
    { name: 'note', type: 'string', order: 1 },
]);

/** A minimal display-only renderer that just caches the value it is given. */
class CapturingRenderer extends CellRenderer<String | null> {
    private _value: String | null = null;

    getValue(): String | null {
        return this._value;
    }

    setValue(value: String | null): void {
        this._value = value ?? null;
    }
}

/** Maps the row's cells to their backing field name via layout constraints. */
function cellsByField(row: Row, columnCount: number): Map<string, Cell<any>> {
    row.setColumnWindow(0, columnCount - 1);

    const map = new Map<string, Cell<any>>();

    for (const cell of row.getComponents() as Cell<any>[]) {
        const field = (row as any).getLayoutConstraints(cell)?.data;

        map.set(field.getName(), cell);
    }

    return map;
}

/** A one-row store so a Row can bind a real record. */
function recordFor(ref: string) {
    const store = new MemoryStore(MODEL, [{ ref, note: 'n' }]);

    store.loadData([{ ref, note: 'n' }]);

    return store.getRecords()[0];
}

describe('ColumnConfig.renderer routing', () => {
    it('routes a column with a renderer to a display-only cell using that renderer', () => {
        let built = 0;
        const configs = new Map<string, ColumnConfig>([
            ['ref', { field: 'ref', renderer: () => { built++; return new CapturingRenderer(); } }],
        ]);

        const cells = cellsByField(new Row(MODEL, undefined, new Set(), configs), 2);

        // The factory built the custom renderer for the `ref` cell; `note` keeps
        // its field-type StringCell.
        expect(built).toBe(1);
        expect(cells.get('ref')!.getRenderer()).toBeInstanceOf(CapturingRenderer);
        expect(cells.get('note')).toBeInstanceOf(StringCell);
    });

    it('pushes the bound value through the custom renderer on construction', () => {
        const configs = new Map<string, ColumnConfig>([
            ['ref', { field: 'ref', renderer: () => new CapturingRenderer() }],
        ]);

        const cells = cellsByField(new Row(MODEL, recordFor('orders'), new Set(), configs), 2);

        expect(cells.get('ref')!.getRenderer().getValue()).toBe('orders');
    });

    it('makes the cell display-only — no editor, never enters edit mode', () => {
        const configs = new Map<string, ColumnConfig>([
            ['ref', { field: 'ref', renderer: () => new CapturingRenderer() }],
        ]);

        const cell = cellsByField(new Row(MODEL, undefined, new Set(), configs), 2).get('ref')!;

        // No pool key and no per-cell editor, so startEdit bails without opening.
        expect(cell.getEditorKey()).toBe(null);
        cell.startEdit();
        expect(cell.isEditing()).toBe(false);
    });

    it('a renderer overrides a `values` (combo) config on the same column', () => {
        const configs = new Map<string, ColumnConfig>([
            ['ref', { field: 'ref', values: ['a', 'b'], renderer: () => new CapturingRenderer() }],
        ]);

        const cell = cellsByField(new Row(MODEL, undefined, new Set(), configs), 2).get('ref')!;

        // Renderer wins over the combo routing.
        expect(cell.getRenderer()).toBeInstanceOf(CapturingRenderer);
        expect(cell).not.toBeInstanceOf(ComboCell);
    });
});

describe('LinkCellRenderer', () => {
    it('caches null and renders empty for a fresh renderer', () => {
        const r = new LinkCellRenderer();

        expect(r.getValue()).toBe(null);
        expect(r.getText().getText()).toBe('');
    });

    it('renders its value as link text and round-trips it through getValue', () => {
        const r = new LinkCellRenderer();

        r.setValue('orders');
        expect(r.getText().getText()).toBe('orders');
        expect(r.getValue()).toBe('orders');
    });

    it('normalises null / undefined to null and renders empty', () => {
        const r = new LinkCellRenderer();

        r.setValue('orders');
        r.setValue(null);
        expect(r.getValue()).toBe(null);
        expect(r.getText().getText()).toBe('');

        r.setValue(undefined as any);
        expect(r.getValue()).toBe(null);
    });

    it('tints the link text (default link colour, overridable)', () => {
        expect(new LinkCellRenderer().getText().getForegroundColor())
            .toBe('var(--ts-ui-link-color, rgb(21, 101, 192))');
        expect(new LinkCellRenderer({ color: 'rgb(1, 2, 3)' }).getText().getForegroundColor())
            .toBe('rgb(1, 2, 3)');
    });

    it('routes through ColumnConfig.renderer to a display-only cell', () => {
        const configs = new Map<string, ColumnConfig>([
            ['ref', { field: 'ref', renderer: () => new LinkCellRenderer() }],
        ]);

        const cell = cellsByField(new Row(MODEL, recordFor('orders'), new Set(), configs), 2).get('ref')!;

        expect(cell.getRenderer()).toBeInstanceOf(LinkCellRenderer);
        expect(cell.getEditorKey()).toBe(null);
        expect((cell.getRenderer() as LinkCellRenderer).getValue()).toBe('orders');
    });

    it('composes a Link, which is still a Text for CellRenderer.doLayout', () => {
        const text = new LinkCellRenderer().getText();

        expect(text).toBeInstanceOf(Link);
        // doLayout gates its vertical centring on `child instanceof Text`.
        expect(text).toBeInstanceOf(Text);
    });

    it('keeps the inner link presentational so the cell never takes tab focus', () => {
        const link = new LinkCellRenderer().getText() as Link;

        // The link does carry a keydown listener — wired unconditionally — but
        // with no tabindex it can never be a keydown target, and handleKeyDown
        // returns early regardless. So the affordance, not the listener, is the
        // contract worth pinning.
        expect(link.isInteractive()).toBe(false);
        expect(link.getAria().getRole()).toBe(null);
        expect(link.getAria().getTabIndex()).toBe(null);
    });

    it('registers no action listener, so a click falls through to the Table', () => {
        const r    = new LinkCellRenderer();
        const link = r.getText() as Link;

        r.setValue('orders');
        link.getElement(true);

        // The renderer only constructs the Link; the click is the Table's to
        // route through "cellclick", so nothing here consumes it.
        expect(() => link.click()).not.toThrow();
        expect(r.getValue()).toBe('orders');
    });
});
