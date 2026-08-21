//
// Regression: VirtualRowView builds its pooled rows in growRowPool and appends
// each row's element straight to the scroller's rows container with a raw
// DOM.sink.appendChild, holding the rows only in the private `_rowPool` array.
// The rows are never registered through addComponent, so the recursive teardown
// in Component.destructor — which walks `_components` — never reached them, and
// neither the rows nor their cells (which ARE registered on their Row) ever had
// their per-instance `#uuid` rules deleted.
//
// Because the pool lives on the shared base, the leak hit Table, TreeTable and
// Tree alike, and scaled with cell count: measured live on master, one open and
// close of the 45-column demo window retained 5594 orphaned `#uuid` rules
// against an 875-rule baseline, while the DOM element count returned to
// baseline. That is the surviving half of the "progressively slower each time I
// open and close the window" report.
//
// Tested at two levels per the debug skill: once on the shared base through
// Body (the mechanism), and once through a Tree (the sibling subclass), so a
// refactor that relocates the fix still has to keep both honest.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import type { Body } from '~/component/table/Body';
import { Tree } from '~/component/tree/Tree';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
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

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
], 'a');

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(component: object): void {
    (component as { destructor(): void }).destructor();
}

/**
 * Rules materialised since `before` that name one of `owners` and survived a
 * teardown. Scoped to the given components on purpose: a destroyed view still
 * leaves unrelated per-instance rules behind (its header cells), which this
 * fix does not address — see the residual-leak note in
 * plans/table-performance.md. Asserting the total would fail for reasons that
 * have nothing to do with the row pool.
 */
function survivingRulesFor(owners: Array<{ getId(): string }>): string[] {
    return _ruleCacheKeys().filter((key) => owners.some((owner) => key.includes(owner.getId())));
}

/**
 * Builds a rendered, laid-out Table whose body has actually grown its row
 * pool. The pool grows inside `Body.renderWindow`, which needs a committed
 * height to compute a non-zero pool target — a bare `new Body(store)` never
 * builds a row, and a leak assertion against it would pass vacuously.
 */
async function renderedTable(): Promise<Table> {
    const store = new MemoryStore(MODEL, [
        { a: 'r1a', b: 'r1b' },
        { a: 'r2a', b: 'r2b' },
        { a: 'r3a', b: 'r3b' },
    ]);

    await store.load();

    const table = new Table(store);

    table.getElement(true);   // materialise → init() builds the scroller
    table.setWidth(400);
    table.setHeight(200);     // committed height → a row pool worth growing
    table.doLayout();

    return table;
}

/** The pooled rows the table's body is holding. */
function poolOf(table: Table): Array<{ getId(): string }> {
    const body = (table as unknown as { _body: Body })._body;

    return (body as unknown as { _rowPool: Array<{ getId(): string }> })._rowPool;
}

describe('VirtualRowView — pooled-row disposal on teardown', () => {

    it('disposes a table body\'s pooled rows, not just the view element', async () => {
        const table = await renderedTable();

        // Capture the pooled rows before teardown. `Row` itself queues no
        // per-instance declaration (its visuals are inline styles or shared
        // class rules), so it correctly gets no `#uuid` rule to leak at all
        // (see plans/implemented/suppress-empty-style-rules.md) — the
        // assertion below still pins that a destructor reaching only the
        // view's element wouldn't leave a stray row rule behind, mirroring
        // the Tree case below. The cells sibling test is what actually
        // proves the destructor recursion reaches the pooled rows, since a
        // cell is only destroyed transitively through its owning row.
        const rows = [...poolOf(table)];

        expect(rows.length).toBeGreaterThan(0);

        destroy(table);

        expect(survivingRulesFor(rows)).toEqual([]);
    });

    it('disposes the cells inside each pooled row', async () => {
        const table = await renderedTable();

        // Cells ARE registered on their Row via addComponent, so they ride the
        // row's own recursive teardown. They are the bulk of the leak: the
        // 45-column demo window retained roughly one rule per cell per cycle.
        const cells = poolOf(table).flatMap(
            (row) => (row as unknown as { _components: Array<{ getId(): string; setRequiredEmpty(v: boolean): void }> })._components,
        );

        expect(cells.length).toBeGreaterThan(0);

        // A freshly-built cell now carries zero declarations of its own —
        // background/border/foreground all resolve as class defaults (see
        // plans/implemented/table-cell-class-style-defaults.md) — so the
        // positive control below needs a real per-instance rule to exist
        // before disposal can be proven non-vacuous. `setRequiredEmpty`
        // writes a `boxShadow` declaration straight to the cell's own
        // `#id` rule via `setShadow`.
        cells.forEach((cell) => cell.setRequiredEmpty(true));
        expect(survivingRulesFor(cells).length).toBeGreaterThan(0);

        destroy(table);

        expect(survivingRulesFor(cells)).toEqual([]);
    });

    it('disposes a tree\'s pooled rows through the same shared base', () => {
        // The sibling subclass, so a refactor that relocates the fix onto Body
        // still has to keep Tree honest. Nodes are required: an empty tree
        // flattens to zero rows and never grows a pool at all.
        const tree = new Tree();

        tree.setNodes([
            { label: 'Fruits', children: [{ label: 'Apple' }, { label: 'Banana' }] },
            { label: 'Vegetables' },
        ]);

        tree.getElement(true);
        tree.setWidth(400);
        tree.setHeight(200);
        tree.doLayout();

        const rows = [...(tree as unknown as { _rowPool: Array<{ getId(): string }> })._rowPool];

        expect(rows.length).toBeGreaterThan(0);

        destroy(tree);

        expect(survivingRulesFor(rows)).toEqual([]);
    });
});
