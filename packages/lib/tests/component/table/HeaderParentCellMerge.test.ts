//
// Regression: rebuildParentCells used to give every ungrouped column its own
// blank ParentHeaderCell, even when several ungrouped columns sat next to
// each other — the parent-header band then showed a bordered box per
// ungrouped column, reading as if each were its own one-column group.
// Adjacent ungrouped columns now share one blank spanning cell, mirroring
// how adjacent same-group columns already merge.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig } from '~/component/table/ColumnConfig';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function makeTable(columns: ColumnConfig[]): Table {
    const model = new Model(
        columns.map((c, i) => ({ name: c.field, type: 'string' as const, order: i })),
        columns[0].field,
    );
    const store = new MemoryStore(model, []);

    const table = new Table(store, { columns });
    table.setWidth(600);
    table.setHeight(400);
    table.doLayout();

    return table;
}

describe('TableHeader.rebuildParentCells — merges adjacent ungrouped columns', () => {
    it('two adjacent ungrouped columns share one blank cell, not one each', () => {
        const table = makeTable([
            { field: 'c0' },
            { field: 'c1' },
            { field: 'c2', group: 'G' },
        ]);

        const cells = table.getHeader().getParentRow().getComponents();

        expect(cells.length).toBe(2); // [blank spanning c0+c1, "G" spanning c2]
    });

    it('a run of many ungrouped columns after a group still produces one blank cell', () => {
        const table = makeTable([
            { field: 'c0', group: 'G' },
            { field: 'c1', group: 'G' },
            { field: 'c2' },
            { field: 'c3' },
            { field: 'c4' },
            { field: 'c5' },
        ]);

        const cells = table.getHeader().getParentRow().getComponents();

        expect(cells.length).toBe(2); // ["G" spanning c0+c1, blank spanning c2-c5]
    });

    it('ungrouped columns separated by a group stay two separate blank cells', () => {
        const table = makeTable([
            { field: 'c0' },
            { field: 'c1', group: 'G' },
            { field: 'c2' },
        ]);

        const cells = table.getHeader().getParentRow().getComponents();

        expect(cells.length).toBe(3); // [blank c0, "G" c1, blank c2] — not adjacent, no merge
    });
});
