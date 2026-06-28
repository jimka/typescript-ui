// Table surfaces the body's selection changes on its own "selectionchange"
// event so consumers (e.g. a delete action) can react without reaching into the
// private body.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

const MODEL = new Model([{ name: 'a', type: 'string', order: 0 }], 'a');

describe('Table selectionchange event', () => {
    it('forwards the body selection on its own event', async () => {
        const store = new MemoryStore(MODEL, [{ a: '1' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);

        const seen: number[] = [];
        table.on('selectionchange', (records: ModelRecord[]) => seen.push(records.length));

        // selectRecord on the body is the canonical mutation; addRow / clicks all
        // route through it. Triggering it must surface on the Table's event.
        const priv = table as unknown as { _body: { selectRecord(r: ModelRecord | null): void } };
        priv._body.selectRecord(store.getAll()[0]);
        priv._body.selectRecord(null);

        expect(seen).toEqual([1, 0]);
    });
});
