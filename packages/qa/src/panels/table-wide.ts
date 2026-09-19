import { Table } from '@jimka/typescript-ui/component/table';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { wideRows } from '../builders/data.js';
import { elementFor } from '../builders/dom.js';
import { awaitStoreView } from '../builders/store.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'table-wide';

/** Value columns, `c1`…`c40`: at their minimum width they overflow any screen, so the table scrolls sideways. */
const WIDE_COLUMNS = 40;

/** Each value column's minimum width: wide enough that forty of them overflow the widest screen. */
const WIDE_MIN_WIDTH_PX = 120;

/** The row selected before `key` runs: a few rows down, as `table-rows` selects. */
const KEY_START_ROW = 3;

export const description = 'Table of n rows (default 2,000) over an id and 40 numeric value columns, each at least 120 px wide, so the columns overflow the screen and the table scrolls sideways. The horizontal counterpart of table-rows, for the header\'s translate per horizontal scroll (G28). No figure is recorded for it yet.';

/** 2,000 rows: enough for the body to virtualise vertically while it scrolls sideways. */
export const defaultScale = 2000;

/** Horizontal wheel-scrolling, which moves the header with the body. */
export const defaultDrive = 'hwheel';

/**
 * Builds a `Table` of `wideRows(n, 40)`.
 *
 * @param n - Rows.
 * @returns The table as root, target of `resize` and `passes`; `afterMount` waits for the store's view, selects a row and gives `hwheel`, `wheel` and `key` the body.
 */
export function build(n: number): PanelBuild {
    const valueFields = Array.from({ length: WIDE_COLUMNS }, (_, k) => `c${k + 1}`);
    const store = new MemoryStore(new Model([{ name: 'id', type: 'number' }, ...valueFields.map((name) => ({ name, type: 'number' as const }))]));

    store.loadData(wideRows(n, WIDE_COLUMNS));

    const table = Table(store, { columns: [{ field: 'id' }, ...valueFields.map((field) => ({ field, minWidth: WIDE_MIN_WIDTH_PX }))] });

    return {
        root: table,
        targets: { passes: table, resize: table },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // At the default scale the store builds its view on a worker, so
            // the record to select and the body's rows both arrive after the
            // mount, not during `build`.
            await awaitStoreView(tools, store, PANEL);

            table.selectRecord(store.getAt(Math.min(KEY_START_ROW, n - 1))!);

            const body = elementFor(tools, table.getBody(), PANEL);

            return {
                hwheel: body,
                wheel: body,
                key: { element: body, keys: ['ArrowRight', 'ArrowLeft'] },
            };
        },
        geometry: { header: table.getHeader(), body: table.getBody() },
        describe: () => ({ rows: n, columns: WIDE_COLUMNS + 1 }),
    };
}
