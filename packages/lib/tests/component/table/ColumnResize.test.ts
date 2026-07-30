// Offline coverage for plans/table-chained-column-resize.md's
// `## Expected Behaviour` — the nearest-first chained drag, table
// growth/shrink past an exhausted chain, the dead zone, and the widened
// total surviving a later layout. Cases are numbered to match the plan.
//
// Fixture: four `string` columns (A/B/C/D) with `minWidth` 60/100/40/30 and
// no declared `maxWidth` (case 10 gives A a `maxWidth` of its own). The
// offline harness reserves a 15px scrollbar track, and Table's own 1px border
// on each side additionally eats 2px of the outer width, so `setWidth(517)`
// (not the plan's literal 515 — see the implementation note this plan file
// carries) yields the worked example's available width of 500. Drag is
// driven through the private `onColumnResizeStart` / `onColumnResize`
// handlers, mirroring the pattern at
// packages/lib/tests/component/layout/Accordion.resizable.test.ts:186.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let frames: Array<FrameRequestCallback>;

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
});

// Drain any frame a test left pending so the module-level rafHandle resets to
// null (flushPendingLayouts clears it) — otherwise a test that schedules but
// never flushes would block the next test's frame from being captured.
afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

/** Invokes every animation-frame callback captured since the last flush (the layout pass). */
function flushFrame(): void {
    const pending = frames;
    frames = [];
    for (const cb of pending) {
        cb(0);
    }
}

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
    { name: 'd', type: 'string', order: 3 },
]);

/** Same four columns, A given a `maxWidth` of 250 for the dead-zone case. */
function specWithAMax(maxWidth: number): ColumnSpec {
    return {
        columns: [
            { field: 'a', minWidth: 60, maxWidth },
            { field: 'b', minWidth: 100 },
            { field: 'c', minWidth: 40 },
            { field: 'd', minWidth: 30 },
        ],
    };
}

const SPEC: ColumnSpec = {
    columns: [
        { field: 'a', minWidth: 60 },
        { field: 'b', minWidth: 100 },
        { field: 'c', minWidth: 40 },
        { field: 'd', minWidth: 30 },
    ],
};

type PrivDrag = {
    onColumnResizeStart(colIndex: number, clientX: number): void;
    onColumnResize(colIndex: number, clientX: number): void;
};

/** Builds a Table over the fixture model, sized to the worked example (500 available), with the starting widths planted. */
function makeTable(spec: ColumnSpec = SPEC): Table {
    const store = new MemoryStore(MODEL, []);
    const table = new Table(store, spec);

    table.getElement(true);
    table.setWidth(517);
    table.setHeight(400);
    table.doLayout();
    table.setColumnWidths([200, 150, 100, 50]);

    return table;
}

function drag(table: Table): PrivDrag {
    return table as unknown as PrivDrag;
}

describe('Table column resize — chained distribution', () => {
    it('1. the chain spills past the first neighbour', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1080);

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
    });

    it('2. no stall at the first neighbour\'s minimum', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1060);

        expect(table.getColumnWidths()).toEqual([260, 100, 90, 50]);
    });

    it('3. two frames chain the same way as one', () => {
        const stepped = makeTable();
        const steppedPriv = drag(stepped);

        steppedPriv.onColumnResizeStart(0, 1000);
        steppedPriv.onColumnResize(0, 1040);
        steppedPriv.onColumnResize(0, 1080);

        const single = makeTable();
        const singlePriv = drag(single);

        singlePriv.onColumnResizeStart(0, 1000);
        singlePriv.onColumnResize(0, 1080);

        expect(stepped.getColumnWidths()).toEqual(single.getColumnWidths());
    });
});

describe('Table column resize — table growth', () => {
    it('4. growth past an exhausted chain', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200);

        expect(table.getColumnWidths()).toEqual([400, 100, 40, 30]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(570);
        expect(table.getColumnWidthTarget()).toBe(570);
    });

    it('5. growth with no chain left at all', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // row 1
        priv.onColumnResize(0, 1250); // row 2 — +50 more

        expect(table.getColumnWidths()).toEqual([450, 100, 40, 30]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(620);
        expect(table.getColumnWidthTarget()).toBe(620);
    });

    it('6. give-back comes first on reversal', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // row 1
        priv.onColumnResize(0, 1250); // row 2
        priv.onColumnResize(0, 1220); // row 3 — -30

        expect(table.getColumnWidths()).toEqual([420, 100, 40, 30]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(590);
        expect(table.getColumnWidthTarget()).toBe(590);
    });

    it('7. give-back then chain growth', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // row 1
        priv.onColumnResize(0, 1250); // row 2
        priv.onColumnResize(0, 1220); // row 3
        priv.onColumnResize(0, 1100); // row 4 — -120

        expect(table.getColumnWidths()).toEqual([300, 130, 40, 30]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(500);
        expect(table.getColumnWidthTarget()).toBe(0);
    });

    it('8. the total never falls below the available width', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // row 1
        priv.onColumnResize(0, 1250); // row 2
        priv.onColumnResize(0, 1220); // row 3
        priv.onColumnResize(0, 1100); // row 4 — state now [300, 130, 40, 30], total 500

        priv.onColumnResizeStart(0, 2000);
        priv.onColumnResize(0, 1800); // -200

        const widths = table.getColumnWidths();

        expect(widths.reduce((s, w) => s + w, 0)).toBe(500);
        expect(widths[2]).toBe(40);
        expect(widths[3]).toBe(30);
    });

    it('9. the last column\'s right edge grows and shrinks the table', () => {
        // Continues from row 4's state ([300, 130, 40, 30], total 500) per the
        // worked example — rows 5 and 6 are the last column's own handle.
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // row 1
        priv.onColumnResize(0, 1250); // row 2
        priv.onColumnResize(0, 1220); // row 3
        priv.onColumnResize(0, 1100); // row 4 — [300, 130, 40, 30], total 500

        priv.onColumnResizeStart(3, 1000);
        priv.onColumnResize(3, 1040); // row 5 — +40, no right chain

        expect(table.getColumnWidths()).toEqual([300, 130, 40, 70]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(540);
        expect(table.getColumnWidthTarget()).toBe(540);

        priv.onColumnResizeStart(3, 2000);
        priv.onColumnResize(3, 1900); // row 6 — -100

        const widths = table.getColumnWidths();

        expect(widths).toEqual([300, 130, 40, 30]);
        expect(widths.reduce((s, w) => s + w, 0)).toBe(500);
        expect(table.getColumnWidthTarget()).toBe(0);
    });
});

describe('Table column resize — no scavenging while the table overflows', () => {
    /**
     * Grows the table past its available width without touching the right
     * chain: the last column's own handle has no columns to its right, so
     * `[200, 150, 100, 50]` becomes `[200, 150, 100, 150]` — total 600 against
     * an available 500, i.e. a horizontal scrollbar showing while every column
     * right of column 0 still has shrink room left.
     */
    function overflowingTable(): Table {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(3, 1000);
        priv.onColumnResize(3, 1100);

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 150]);
        expect(table.getColumnWidthTarget()).toBe(600);

        return table;
    }

    it('21. growing an edge widens the table instead of scavenging', () => {
        const table = overflowingTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1050);

        expect(table.getColumnWidths()).toEqual([250, 150, 100, 150]);
        expect(table.getColumnWidthTarget()).toBe(650);
    });

    it('22. shrinking an edge narrows the table instead of feeding the right chain', () => {
        const table = overflowingTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 950);

        expect(table.getColumnWidths()).toEqual([150, 150, 100, 150]);
        expect(table.getColumnWidthTarget()).toBe(550);
    });

    it('23. scavenging resumes once the table fits again', () => {
        const table = overflowingTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1050);  // case 21's state: [250, 150, 100, 150], total 650
        // -200 of travel: 150 gives the growth back (total down to the
        // available 500), the remaining 40 of A's shrink room is scavenged by
        // B, and the last 10 is dead zone (A is at its 60 minWidth).
        priv.onColumnResize(0, 850);

        expect(table.getColumnWidths()).toEqual([60, 190, 100, 150]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(500);
        expect(table.getColumnWidthTarget()).toBe(0);
    });
});

describe('Table column resize — dead zone', () => {
    it('10. blocked travel must be retraced', () => {
        const table = makeTable(specWithAMax(250));
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // A hits its 250 maxWidth; B absorbs the rest

        expect(table.getColumnWidths()).toEqual([250, 100, 100, 50]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(500);

        priv.onColumnResize(0, 1100); // still inside the dead zone

        expect(table.getColumnWidths()).toEqual([250, 100, 100, 50]);

        priv.onColumnResize(0, 1000); // retraces past the dead zone, A shrinks back

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
    });
});

describe('Table column resize — the widened total survives', () => {
    function grownTable(): Table {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // case 4: [400, 100, 40, 30], total 570

        return table;
    }

    it('11. a second layout does not undo the growth', () => {
        const table = grownTable();

        table.doLayout();

        expect(table.getColumnWidths()).toEqual([400, 100, 40, 30]);
        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBe(570);
    });

    it('12. resizing the container', () => {
        const table = grownTable();

        table.setWidth(817); // available 800, per the border/scrollbar note above
        table.doLayout();

        expect(table.getColumnWidths().reduce((s, w) => s + w, 0)).toBeCloseTo(800, 5);

        table.setWidth(517); // back to the fixture's available width of 500
        table.doLayout();

        const widths = table.getColumnWidths();

        expect(widths[0]).toBeCloseTo(400, 5);
        expect(widths[1]).toBeCloseTo(100, 5);
        expect(widths[2]).toBeCloseTo(40, 5);
        expect(widths[3]).toBeCloseTo(30, 5);
        expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(570, 5);
    });

    it('13. re-initialisation clears the target', () => {
        const table = grownTable();

        expect(table.getColumnWidthTarget()).toBe(570);

        const otherStore = new MemoryStore(MODEL, []);
        table.setStore(otherStore);

        expect(table.getColumnWidthTarget()).toBe(0);
    });
});

describe('Table column resize — layout coalescing', () => {
    it('30. no layout runs during the moves', () => {
        const table = makeTable();
        const priv  = drag(table);

        flushFrame(); // drain the frames the fixture itself queued

        const doLayoutSpy = vi.spyOn(table, 'doLayout');

        priv.onColumnResizeStart(0, 1000);
        for (let i = 1; i <= 50; i++) {
            priv.onColumnResize(0, 1000 + i);
        }

        expect(doLayoutSpy).not.toHaveBeenCalled();
    });

    it('31. one layout runs for the whole burst', () => {
        const table = makeTable();
        const priv  = drag(table);

        flushFrame();

        const doLayoutSpy = vi.spyOn(table, 'doLayout');

        priv.onColumnResizeStart(0, 1000);
        for (let i = 1; i <= 50; i++) {
            priv.onColumnResize(0, 1000 + i);
        }
        flushFrame();

        expect(doLayoutSpy).toHaveBeenCalledTimes(1);
    });

    it('32. a dead-zone move schedules nothing', () => {
        const table = makeTable(specWithAMax(250));
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1200); // A hits its 250 maxWidth; B absorbs the rest — case 10's setup
        flushFrame();

        const scheduleLayoutSpy = vi.spyOn(table, 'scheduleLayout');

        priv.onColumnResize(0, 1100); // still inside the dead zone

        expect(scheduleLayoutSpy).not.toHaveBeenCalled();
        expect(table.getColumnWidths()).toEqual([250, 100, 100, 50]);
    });

    it('33. a coalesced burst still invalidates the body\'s geometry cache', () => {
        const table = makeTable();
        const priv  = drag(table);

        flushFrame();

        const before = (table.getBody() as any)._lastColumnWidths;

        priv.onColumnResizeStart(0, 1000);
        priv.onColumnResize(0, 1100);
        priv.onColumnResize(0, 1150);
        priv.onColumnResize(0, 1200);
        flushFrame();

        const after = (table.getBody() as any)._lastColumnWidths;

        expect(after).not.toBe(before);
        expect(after).toEqual(table.getColumnWidths());
    });
});
