//
// Regression: rebuildParentCells only detached the old ParentHeaderCells via
// removeAllComponents, leaking each one's per-instance style rule on every
// rebuild (e.g. every setHiddenColumns call on a grouped-column table).
// Mirrors HeaderColumnWindow.test.ts's grouped-column Table setup and
// HeaderCell.disposal.test.ts's _ruleCacheKeys idiom.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnConfig } from '~/component/table/ColumnConfig';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('TableHeader.rebuildParentCells — disposes replaced parent cells', () => {
    it('evicts the old ParentHeaderCell\'s style rule when setHiddenColumns rebuilds the row', async () => {
        const columns: ColumnConfig[] = [
            // A `groupColor` keeps this cell's own `#id` rule materialised (a
            // colourless group cell no longer writes a rule at all — its
            // background/shadow both dedupe against `.ParentHeaderCell`'s
            // class-tier defaults; see plans/implemented/misc-component-css-dedup.md).
            { field: 'c0', group: 'A', groupColor: 'red' },
            { field: 'c1', group: 'A', groupColor: 'red' },
            { field: 'c2' },
        ];
        const model = new Model([
            { name: 'c0', type: 'string', order: 0 },
            { name: 'c1', type: 'string', order: 1 },
            { name: 'c2', type: 'string', order: 2 },
        ], 'c0');
        const store = new MemoryStore(model, []);
        await store.load();

        const table = new Table(store, { columns });
        table.setWidth(600);
        table.setHeight(400);
        table.doLayout();

        const header = table.getHeader();
        const parentCellsBefore = header.getParentRow().getComponents();
        // One run for the grouped c0/c1 pair, one blank run for ungrouped c2.
        expect(parentCellsBefore.length).toBe(2);

        const oldCell = parentCellsBefore[0];
        oldCell.getElement(true);
        const id = oldCell.getId();

        expect(_ruleCacheKeys().some(key => key.startsWith('#' + id))).toBe(true);

        header.setHiddenColumns(new Set(['c2']));

        expect(_ruleCacheKeys().some(key => key.startsWith('#' + id))).toBe(false);
    });
});
