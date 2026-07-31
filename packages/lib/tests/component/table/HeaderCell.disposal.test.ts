//
// Regression: HeaderCell builds three child components — the resize handle, the
// sort-priority badge and (optionally) a header glyph — holds each in a private
// field, and side-loads their elements with a raw DOM.sink.appendChild. The
// side-loading is deliberate: they are position:absolute overlays, and
// registering them through addComponent would let the cell's Card layout hide
// them as non-visible siblings of the renderer. But it means they are never in
// `_components`, so Component.destructor's recursion never reaches them and
// their per-instance `#uuid` rules outlive the cell.
//
// This is the same bug class as the fixed row-pool leak
// (tests/component/shared/VirtualRowView.poolDisposal.test.ts) and is the
// residue that fix left behind: measured live, it scales with COLUMN count
// rather than cell count — roughly 22 retained rules per open/close cycle at 3
// columns and 102 at 45. Retained rules are not inert: style-recalc cost scales
// with the size of the sheet, so every leaked cycle makes later frames dearer.
//
// The glyph is covered twice: once on teardown, and once on a swap, since
// _mountHeaderGlyph replaces the instance and previously dropped the old one
// without disposing it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
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
    { name: 'c', type: 'string', order: 2 },
], 'a');

type Owner = { getId(): string };

/** Calls the protected destructor, as an owning window does when it closes. */
function destroy(component: object): void {
    (component as { destructor(): void }).destructor();
}

/** Rules still on the sheet that belong to one of `owners`. */
function survivingRulesFor(owners: Owner[]): string[] {
    return _ruleCacheKeys().filter((key) => owners.some((owner) => key.includes(owner.getId())));
}

async function renderedTable(): Promise<Table> {
    const store = new MemoryStore(MODEL, [{ a: 'r1a', b: 'r1b', c: 'r1c' }]);

    await store.load();

    const table = new Table(store);

    table.getElement(true);
    table.setWidth(400);
    table.setHeight(200);
    table.doLayout();

    return table;
}

/** The header's cells, and the three children each one side-loads. */
function headerCells(table: Table): Array<Record<string, Owner | null>> {
    return (table.getHeader() as unknown as { getColumns(): Array<Record<string, Owner | null>> })
        .getColumns();
}

function sideLoadedChildren(table: Table): Owner[] {
    const out: Owner[] = [];
    for (const cell of headerCells(table)) {
        for (const key of ['_resizeHandle', '_priorityBadge', '_headerGlyphInstance']) {
            const child = cell[key];
            if (child) {
                out.push(child);
            }
        }
    }

    return out;
}

describe('HeaderCell — side-loaded child disposal', () => {

    it('disposes the resize handle and priority badge on teardown', async () => {
        const table    = await renderedTable();
        const children = sideLoadedChildren(table);

        // Three columns, each side-loading a handle and a badge.
        expect(children.length).toBeGreaterThanOrEqual(6);
        expect(survivingRulesFor(children).length).toBeGreaterThan(0);

        destroy(table);

        expect(survivingRulesFor(children)).toEqual([]);
    });

    it('disposes a mounted header glyph on teardown', async () => {
        const table = await renderedTable();
        const cell  = headerCells(table)[0] as unknown as { setHeaderGlyph(n: string | null): unknown };

        cell.setHeaderGlyph('unicode-arrow-up');

        const glyph = (cell as unknown as Record<string, Owner | null>)._headerGlyphInstance;

        expect(glyph).not.toBeNull();
        expect(survivingRulesFor([glyph!]).length).toBeGreaterThan(0);

        destroy(table);

        expect(survivingRulesFor([glyph!])).toEqual([]);
    });

    it('disposes the previous glyph when the header glyph is swapped', async () => {
        const table = await renderedTable();
        const cell  = headerCells(table)[0] as unknown as
            { setHeaderGlyph(n: string | null): unknown } & Record<string, Owner | null>;

        cell.setHeaderGlyph('unicode-arrow-up');

        const first = cell._headerGlyphInstance;

        expect(first).not.toBeNull();

        // Swapping must not silently strand the old instance's rules: a header
        // whose glyph changes with sort state would leak one per change.
        cell.setHeaderGlyph('unicode-arrow-down');

        expect(cell._headerGlyphInstance).not.toBe(first);
        expect(survivingRulesFor([first!])).toEqual([]);
    });
});
