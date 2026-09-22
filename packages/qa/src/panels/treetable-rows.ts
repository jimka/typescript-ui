import { TreeTable } from '@jimka/typescript-ui/component/table';
import { MemoryStore, Model } from '@jimka/typescript-ui/data';
import { folderRows, FOLDER_ROWS_PER_ROOT } from '../builders/data.js';
import { elementFor, requireElement } from '../builders/dom.js';
import { awaitStoreView } from '../builders/store.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'treetable-rows';

/** Rows `update` cycles through: the first ten, which start visible. */
const UPDATE_ROW_SPAN = 10;

/** `update`'s size base: above every generated size, so every write changes the value. */
const SIZE_BASE = 100_000;

/** The row selected before `key` runs: a few rows down, so both arrow keys move the selection. */
const KEY_START_ROW = 3;

/** The name column's minimum width: room for three levels of indent and a file name. */
const NAME_MIN_WIDTH_PX = 200;

export const description = 'TreeTable of n root folders (default 200), each with 3 subfolders of 3 files: 13n rows. Reproduces slice 22 F22.5 (TreeBody.getVisibleRecords allocates a fresh array per call, six per keystroke): 6 per ArrowDown; and F22.3 (a collapse re-mints a caret Glyph per visible branch row and never disposes the old one): under toggle, ensureStyleRule, setRuleStyles, createElement and removeElement are equal — one caret minted and one detached per visible branch row — and that path deletes no rule. A long phase does show deleteStyleRule, but it follows elapsed time rather than toggles: those deletes are the collector reaching the dropped glyphs, so the leak is bounded by GC rather than permanent.';

/** 200 roots: 2,600 rows, a tree table that virtualises and scrolls. */
export const defaultScale = 200;

/** Collapsing and expanding every row, the path F22.3 names. */
export const defaultDrive = 'toggle';

/**
 * Builds a `TreeTable` over `folderRows(n)`.
 *
 * @param n - Root folders.
 * @returns The tree table as root, target of `resize`, `passes`, `toggle` (collapse all, then expand all) and `update` (one row's size); `afterMount` waits for the store's view, expands everything, selects a row and gives `wheel`, `key` and `click` their elements.
 */
export function build(n: number): PanelBuild {
    const rows = FOLDER_ROWS_PER_ROOT * n;

    const model = new Model([
        { name: 'id', type: 'number' },
        { name: 'parentId', type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'size', type: 'number' },
        { name: 'modified', type: 'datetime' },
        { name: 'kind', type: 'string' },
    ]);

    const store = new MemoryStore(model);

    store.loadData(folderRows(n));

    // Only the listed columns: the id and parent fields are structure, not content.
    const treeTable = TreeTable(store, {
        idField: 'id',
        parentField: 'parentId',
        treeColumn: 'name',
        columns: [{ field: 'name', minWidth: NAME_MIN_WIDTH_PX }, { field: 'size' }, { field: 'modified' }, { field: 'kind' }],
        appendUnlisted: false,
    });

    return {
        root: treeTable,
        targets: {
            resize: treeTable,
            passes: treeTable,
            toggle: function collapseOrExpandAll(index: number): void {
                if (index % 2 === 0) {
                    treeTable.collapseAll();
                } else {
                    treeTable.expandAll();
                }
            },
            update: function resizeRecord(index: number): void {
                store.getAt(index % Math.min(UPDATE_ROW_SPAN, rows))!.set('size', SIZE_BASE + index);
            },
        },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // 13n rows is over the threshold at the default scale, so the
            // store builds its view on a worker: there is nothing to expand,
            // select or look up until it arrives.
            await awaitStoreView(tools, store, PANEL);

            treeTable.expandAll();
            treeTable.selectRecord(store.getAt(Math.min(KEY_START_ROW, rows - 1))!);

            const body = elementFor(tools, treeTable.getBody(), PANEL);

            return {
                wheel: body,
                key: { element: body, keys: ['ArrowDown', 'ArrowUp'] },
                // A size cell: a plain cell, not a row's expand toggle.
                click: { elements: [requireElement(body, '.NumberCell', PANEL)] },
            };
        },
        geometry: { table: treeTable, header: treeTable.getHeader(), body: treeTable.getBody(), focused: '.Cell.focused' },
        describe: () => ({ roots: n, rows }),
        installWork: (tools: HarnessTools): string[] => [tools.countMethod(treeTable.getBody(), 'getVisibleRecords'), tools.countMethod(store, 'getRecords')],
    };
}
