// Offline coverage for plans/in-progress/table-column-resize-outline-mode.md's
// `## Expected Behaviour` cases T1-T9: how a table's column-resize drag behaves
// in each resize mode. T11-T13 are this suite's own additions, pinning the
// abnormal-termination paths the plan's prose names but leaves untested — a
// window blur, a fresh press over an outline drag still open, and the stale
// dragged-edge index the release now clears. T14-T16 make three of T2's own
// assertions falsifiable: the fixture's content origin and header x are both
// 0, so T2 cannot tell a box that was read from one that was assumed, and
// nothing in T1-T9 reaches the widths the release pins. T17 drives the gesture
// through the real DOM events, which is the only case that exercises the
// `dragend` -> `resizeend` -> `columnresizeend` chain the plan adds; the plan
// verifies that chain with greps alone. T18 pins the session reset a live press
// performs, and T19-T20 the drag being abandoned when another path rebuilds the
// columns out from under it, which the plan does not consider at all — T19-T20
// and T22-T26 one per path that abandons a drag, T27 the ordinary layout pass
// that must not.
//
// The fixture is ColumnResize.test.ts's, verbatim: four `string` columns A/B/C/D
// with `minWidth` 60/100/40/30 at `setWidth(514)` for an available column width
// of 500, and the starting widths planted as [200, 150, 100, 50]. The drag is
// driven through the private `onColumnResizeStart` / `onColumnResize` /
// `onColumnResizeEnd` handlers, as that suite drives it. The frame capture and
// the `afterEach` that unwinds module state are Split.resizeMode.test.ts's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Tooltip } from '~/overlay/Tooltip';
import { setAppResizeMode } from '~/core/ResizeDrag';
import type { ResizeMode } from '~/core/ResizeDrag';
import { Insets } from '~/primitive/Insets';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The `clientX` every drag below presses at. */
const PRESS_X = 1000;

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
    { name: 'd', type: 'string', order: 3 },
]);

/**
 * Four `number` columns. Every column is fixed-width, so the layout manager's
 * `rescaleWidths` returns the widths it was handed untouched — which is what
 * makes this fixture, and not the flexible `string` one, able to tell whether a
 * rebuild abandons a drag on its own or only through `setColumnWidths`' change
 * comparison.
 */
const FIXED_MODEL = new Model([
    { name: 'a', type: 'number', order: 0 },
    { name: 'b', type: 'number', order: 1 },
    { name: 'c', type: 'number', order: 2 },
    { name: 'd', type: 'number', order: 3 },
]);

const SPEC: ColumnSpec = {
    columns: [
        { field: 'a', minWidth: 60 },
        { field: 'b', minWidth: 100 },
        { field: 'c', minWidth: 40 },
        { field: 'd', minWidth: 30 },
    ],
};

/** Same four columns, A given a `maxWidth` so the drag's travel binds. */
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

/** The private drag handlers each case drives. */
type PrivDrag = {
    onColumnResizeStart(colIndex: number, clientX: number): void;
    onColumnResize(colIndex: number, clientX: number): void;
    onColumnResizeEnd(): void;
    resetColumns(): void;
};

describe('Table column resize — outline mode', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;
    let tables:      Table[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        tables      = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        // A drag left mid-flight keeps its bar on screen, and with it the two
        // viewport listeners the bar registers. `Event`'s registration maps are
        // module state DOM.reset() does not clear, so a surviving type map stops
        // the next `addViewportListener` re-registering the base listener
        // against the fresh sink, and the case after this one would hear no
        // keydown at all. Disposing the table runs its destructor, which cancels
        // the session exactly as a real teardown does.
        for (const table of tables) {
            table.dispose();
        }

        vi.restoreAllMocks();
        // core/ResizeDrag.ts's app-wide default is module state DOM.reset()
        // does not touch; T1 sets it.
        setAppResizeMode('live');
        // A header cell attaches a tooltip, which installs `Tooltip`'s own
        // session-long viewport watch — a surviving `keydown` type map of
        // exactly the kind described above.
        Tooltip._stopPointerWatch();
        DOM.reset();
    });

    /** Runs every frame callback still pending since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(0);
        }
    }

    /**
     * Builds a Table over the fixture model, sized to the worked example (500
     * available), with the starting widths planted.
     *
     * @param spec - The column spec; the fixture's four columns by default.
     * @returns The table, registered for disposal in `afterEach`.
     */
    function makeTable(spec: ColumnSpec = SPEC): Table {
        const store = new MemoryStore(MODEL, []);
        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();
        table.setColumnWidths([200, 150, 100, 50]);
        tables.push(table);

        return table;
    }

    /**
     * A table over the fixture model with no box and no planted widths, for the
     * cases that only read its mode. Registered for disposal like every other:
     * an undisposed table leaves entries in `Event`'s per-type registration maps,
     * which stops the next case's `addListener` re-registering the base listener
     * against the fresh sink — and T17, which dispatches real mouse events, then
     * hears nothing.
     *
     * @returns The table.
     */
    function bare(): Table {
        const table = new Table(new MemoryStore(MODEL, []));

        tables.push(table);

        return table;
    }

    /**
     * A store holding `count` records, built through `add` so they exist without
     * an `await` — a `MemoryStore`'s constructor data is not turned into records
     * until `load()` runs.
     *
     * @param count - How many records to add.
     * @returns The store and its records.
     */
    function loaded(count: number): { store: MemoryStore; records: ModelRecord[] } {
        const store = new MemoryStore(MODEL);
        const records = store.add(
            Array.from({ length: count }, (_, i) => ({ a: `a${i}`, b: `b${i}`, c: `c${i}`, d: `d${i}` })),
        );

        return { store, records };
    }

    /**
     * A table of the fixture's shape showing one record as rotated field/value
     * rows, sized and with its widths planted, ready for an outline drag.
     *
     * @param store - The store to bind.
     * @param record - The record to show as field/value rows.
     * @returns The table, in rotated mode and outline resize mode.
     */
    function rotated(store: MemoryStore, record: ModelRecord): Table {
        const table = new Table(store, SPEC);

        tables.push(table);
        table.getElement(true);
        table.setWidth(514);
        table.setHeight(400);
        table.setDisplayMode('rotated');
        table.selectRecord(record);
        table.doLayout();
        flushFrame();
        table.setColumnWidths([200, 150, 100]);
        table.setResizeMode('outline');

        expect(table.getDisplayMode()).toBe('rotated');

        return table;
    }

    /**
     * A table over {@link FIXED_MODEL}, otherwise the fixture's shape. A layout
     * pass over it rescales nothing, so a rebuild that does not abandon the drag
     * itself leaves it running.
     *
     * @returns The table, in outline resize mode.
     */
    function fixedTable(): Table {
        const table = new Table(new MemoryStore(FIXED_MODEL), SPEC);

        tables.push(table);
        table.getElement(true);
        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();
        flushFrame();
        table.setColumnWidths([200, 150, 100, 50]);
        table.setResizeMode('outline');

        return table;
    }

    /**
     * The table's private drag handlers.
     *
     * @param table - The table to reach into.
     * @returns Its three drag entry points.
     */
    function drag(table: Table): PrivDrag {
        return table as unknown as PrivDrag;
    }

    /**
     * The bar the table's drag session has on screen, if any.
     *
     * @param table - The table to read.
     * @returns The outline component, or `null` between drags and in live mode.
     */
    function barOf(table: Table): Component | null {
        return (table as unknown as { _resizeDrag: { _outline: Component | null } })._resizeDrag._outline;
    }

    /**
     * The widths the drag pinned as user-set, keyed by field name.
     *
     * @param table - The table to read.
     * @returns Its pinned-width map.
     */
    function pinnedOf(table: Table): Map<string, number> {
        return (table as unknown as { _pinnedColumnWidths: Map<string, number> })._pinnedColumnWidths;
    }

    /**
     * The element of a rendered header cell's resize handle — the one a real
     * gesture presses.
     *
     * @param table - The table whose first column's handle to reach.
     * @returns The handle's element.
     */
    function handleElementOf(table: Table): Handle {
        const cell = table.getHeader().getColumns()[0] as unknown as { _resizeHandle: Component };

        return cell._resizeHandle.getElement()!;
    }

    /**
     * Presses column 0's right edge at {@link PRESS_X} and moves through
     * `positions`. An outline move needs a drained frame after it — that is when
     * the buffered move reaches the bar; a live move applies synchronously and
     * gets none, keeping ColumnResize.test.ts's shape.
     *
     * @param table - The table to drive.
     * @param positions - The pointer positions to move through.
     * @param mode - The mode the drag is running in.
     */
    function drive(table: Table, positions: number[], mode: ResizeMode): void {
        const priv = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);

        for (const position of positions) {
            priv.onColumnResize(0, position);

            if (mode === 'outline') {
                flushFrame();
            }
        }
    }

    it('T1. resolves its own mode first, then the app-wide default', () => {
        expect(bare().getResizeMode()).toBe('live');

        setAppResizeMode('outline');

        const table = bare();

        expect(table.getResizeMode()).toBe('outline');
        expect(table.setResizeMode('live')).toBe(table);
        expect(table.getResizeMode()).toBe('live');
        expect(table.setResizeMode(null)).toBe(table);
        expect(table.getResizeMode()).toBe('outline');
    });

    it('T2. an outline drag leaves the table alone', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();   // drain the frames the fixture itself queued

        const layout   = vi.spyOn(table, 'doLayout');
        const schedule = vi.spyOn(table, 'scheduleLayout');

        drive(table, [1080], 'outline');

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
        expect(table.getColumnWidthTarget()).toBe(0);
        expect(layout).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();

        const bar = barOf(table)!;
        const box = table.getContentBounds()!;

        expect(DOM.source.getParentElement(bar.getElement()!)).toBe(table.getElement());
        expect(bar.getWidth()).toBe(4);
        expect(bar.getY()).toBe(box.y);
        expect(bar.getHeight()).toBe(box.height);
        expect(bar.getTranslateX()).toBe(80);
        // The bar is centred on the dragged edge: half its 4 px width sits left
        // of the header's own content origin plus the first column's width.
        expect(bar.getX() + 2).toBe(table.getHeader().getX() + table.getHeader().getContentBounds()!.x + 200);
    });

    it('T3. the bar stops where the drag would stop', () => {
        const table = makeTable(specWithAMax(250));

        table.setResizeMode('outline');

        // Column A's own 250 maxWidth binds the travel 50 px out.
        drive(table, [1300], 'outline');

        expect(barOf(table)!.getTranslateX()).toBe(50);
        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);

        drag(table).onColumnResize(0, PRESS_X);
        flushFrame();

        expect(barOf(table)!.getTranslateX()).toBe(0);
        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
    });

    it('T4. a move inside the dead zone leaves the bar where it is', () => {
        const table = makeTable(specWithAMax(250));

        table.setResizeMode('outline');
        drive(table, [1300], 'outline');

        // The capped travel accrued a dead zone the pointer must retrace first.
        drag(table).onColumnResize(0, 1200);
        flushFrame();

        expect(barOf(table)!.getTranslateX()).toBe(50);
    });

    it.each<[ResizeMode]>([
        ['outline'],
        ['live'],
    ])('T5. a %s release lands the columns in the same place', (mode) => {
        const table = makeTable();

        table.setResizeMode(mode);
        flushFrame();   // drain the frames the fixture itself queued

        const schedule = vi.spyOn(table, 'scheduleLayout');

        drive(table, [1080], mode);
        drag(table).onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
        expect(table.getColumnWidthTarget()).toBe(0);
        expect(pinnedOf(table)).toEqual(new Map([['a', 280], ['b', 100], ['c', 70]]));
        // Outline schedules on the release, live on the move: one pass either way.
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(barOf(table)).toBeNull();
    });

    it('T6. a release with no movement commits nothing', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const schedule = vi.spyOn(table, 'scheduleLayout');
        const priv     = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
        expect(schedule).not.toHaveBeenCalled();
    });

    it('T7. Escape cancels and commits nothing', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        drive(table, [1080], 'outline');

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(table.getElement()!, 'keydown', { key: 'Escape' }));

        expect(barOf(table)).toBeNull();

        const priv = drag(table);

        priv.onColumnResize(0, 1200);
        flushFrame();

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);

        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
        expect(barOf(table)).toBeNull();
    });

    it('T8. disposal mid-drag takes the bar down', () => {
        // What a table's disposal leaves behind with no drag in flight: the
        // session-wide watches a `Tooltip` and the like install, which outlive
        // every table. Measured rather than written down, and measured against a
        // table of the fixture's own shape, since the pre-drag total also counts
        // the eight viewport listeners a live table holds — comparing the
        // post-dispose total against that is what the plan's own T8 got wrong.
        const control = makeTable();

        control.dispose();

        const residue = Event.listenerCounts().viewport;
        const table   = makeTable();
        const before  = Event.listenerCounts().viewport;

        table.setResizeMode('outline');
        drive(table, [1080], 'outline');

        // The bar's own two: Escape, and the browser window losing focus.
        expect(Event.listenerCounts().viewport).toBe(before + 2);

        const bar = barOf(table)!;

        table.dispose();

        expect(DOM.source.getParentElement(bar.getElement()!)).toBeNull();
        expect(Event.listenerCounts().viewport).toBe(residue);
    });

    it('T9. an unsized table falls back to live', () => {
        const store = new MemoryStore(MODEL, []);
        const table = new Table(store, SPEC);

        tables.push(table);
        table.getElement(true);
        // No width and no height, so `getContentBounds()` reports no finite
        // height and the bar has no span to draw.
        table.setColumnWidths([200, 150, 100, 50]);
        table.setResizeMode('outline');

        const priv = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResize(0, 1080);

        expect(barOf(table)).toBeNull();
        expect(table.getColumnWidths()[0]).toBe(280);
    });

    it('T11. a browser-window blur cancels and commits nothing', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        drive(table, [1080], 'outline');

        // The offline source has no window object, so `isWindow` is false for
        // every handle; the real browser's window blur is modelled by making it
        // answer true for this one dispatch (see ResizeDrag.test.ts's R9).
        vi.spyOn(DOM.source, 'isWindow').mockReturnValue(true);
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(table.getElement()!, 'blur'));

        expect(barOf(table)).toBeNull();

        drag(table).onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
    });

    it('T12. a fresh press over an open outline drag strands neither bar nor move', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        drive(table, [1080], 'outline');

        const stale = barOf(table)!;
        const priv  = drag(table);

        priv.onColumnResizeStart(0, 2000);

        expect(DOM.source.getParentElement(stale.getElement()!)).toBeNull();
        expect(barOf(table)).not.toBe(stale);

        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);
        expect(barOf(table)).toBeNull();
    });

    it('T13. the release clears the dragged edge, so a later move is inert', () => {
        const table = makeTable();
        const priv  = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResize(0, 1080);
        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);

        priv.onColumnResize(0, 1200);

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
    });

    it('T14. the bar is anchored on the table\'s content box, not its outer box', () => {
        const table = new Table(new MemoryStore(MODEL, []), SPEC);

        tables.push(table);
        table.getElement(true);
        // Insets move the content origin off 0 on both axes, which is what lets
        // the assertions below tell a box that was read from one that was
        // assumed — under the fixture's own zero insets they cannot.
        table.setInsets(new Insets(7, 0, 0, 5));
        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();
        flushFrame();
        // Planted after the drain, since a pass over an inset table rescales the
        // widths to its narrower available band.
        table.setColumnWidths([200, 150, 100, 50]);
        table.setResizeMode('outline');

        drive(table, [1080], 'outline');

        const bar = barOf(table)!;
        const box = table.getContentBounds()!;

        expect(box.y).toBe(7);
        expect(table.getHeader().getX()).toBe(5);
        expect(bar.getY()).toBe(box.y);
        expect(bar.getHeight()).toBe(box.height);
        expect(bar.getX() + 2).toBe(table.getHeader().getX() + table.getHeader().getContentBounds()!.x + 200);
    });

    it('T15. a scrolled header moves the bar with the columns it shows', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();
        table.getHeader().setScrollX(30);
        flushFrame();

        drive(table, [1080], 'outline');

        // The edge sits 200 px into the column band, 30 of which are scrolled
        // out to the left.
        expect(barOf(table)!.getX() + 2)
            .toBe(table.getHeader().getX() + table.getHeader().getContentBounds()!.x + 200 - 30);
        expect(barOf(table)!.getTranslateX()).toBe(80);
    });

    it.each<[ResizeMode]>([
        ['outline'],
        ['live'],
    ])('T16. a %s drag pins every column it touched, including one it moved back', (mode) => {
        const table = makeTable();

        table.setResizeMode(mode);
        // Out and back. The chain is memoryless, so B absorbs the whole return
        // travel and C keeps what it gave up — but A ends where it started, and
        // is still a column the user resized.
        drive(table, [1080, PRESS_X], mode);
        drag(table).onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([200, 180, 70, 50]);
        expect(pinnedOf(table)).toEqual(new Map([['a', 200], ['b', 180], ['c', 70]]));
    });

    it('T17. the handle\'s own mouse gesture drives the whole event chain', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const el = handleElementOf(table);

        // The real path: the handle's mousedown, then the viewport mousemove and
        // mouseup `HeaderCell.onResizeDragStart` installs. Nothing else carries a
        // drag-end signal from the handle up to the table.
        DOM.sink.dispatchEvent(el, makeEvent(el, 'mousedown', { clientX: PRESS_X, button: 0 }));
        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(el, 'mousemove', { clientX: 1080 }));
        flushFrame();

        expect(barOf(table)).not.toBeNull();
        expect(table.getColumnWidths()).toEqual([200, 150, 100, 50]);

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(el, 'mouseup', { button: 0 }));

        expect(barOf(table)).toBeNull();
        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
    });

    it('T18. a live press over an open outline drag takes the stale bar down', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        drive(table, [1080], 'outline');

        const stale = barOf(table)!;
        const priv  = drag(table);

        // The mode is read at each press, so a table switched back to live
        // mid-drag presses live next, and `beginLive` is the only thing that
        // stops the abandoned bar and its buffered move reaching that drag.
        table.setResizeMode('live');
        priv.onColumnResizeStart(0, 2000);

        expect(barOf(table)).toBeNull();
        expect(DOM.source.getParentElement(stale.getElement()!)).toBeNull();

        priv.onColumnResize(0, 2080);

        // Applied at once, measured from the fresh press rather than from the
        // abandoned drag's tracked pointer.
        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
    });

    it('T19. a column hidden mid-drag abandons the drag instead of committing a stale snapshot', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = drag(table);

        // Column C's edge: the travel spills onto D, so the drag's own `moved`
        // set holds index 3 — the column about to disappear.
        priv.onColumnResizeStart(2, PRESS_X);
        priv.onColumnResize(2, 1040);
        flushFrame();

        table.setColumnVisible('d', false);
        flushFrame();

        const rebuilt = table.getColumnWidths().slice();

        expect(rebuilt).toHaveLength(3);
        expect(barOf(table)).toBeNull();

        // The button is still down, so moves keep arriving. The abandoned drag
        // must swallow them rather than reviving as a live one: its tracked
        // pointer never left the press, so a live apply here would jump the
        // edge by the whole travel since.
        priv.onColumnResize(2, 1080);
        flushFrame();

        expect(table.getColumnWidths()).toEqual(rebuilt);

        priv.onColumnResizeEnd();

        // The snapshot was taken against four columns; committing it here would
        // index past the rebuilt set and write back widths for a column the
        // table no longer shows.
        expect(table.getColumnWidths()).toEqual(rebuilt);
        expect([...pinnedOf(table).keys()]).not.toContain('d');
    });

    it('T20. a store swap mid-drag abandons the drag', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResize(0, 1080);
        flushFrame();

        const bar = barOf(table)!;

        table.setStore(new MemoryStore(MODEL, []));

        expect(barOf(table)).toBeNull();
        expect(DOM.source.getParentElement(bar.getElement()!)).toBeNull();

        const rebuilt = table.getColumnWidths().slice();

        priv.onColumnResize(0, 1200);
        flushFrame();

        expect(table.getColumnWidths()).toEqual(rebuilt);

        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual(rebuilt);
        expect(pinnedOf(table).size).toBe(0);
    });

    it('T21. a layout pass that rescales the columns mid-drag abandons it', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResize(0, 1040);
        flushFrame();

        // The container narrows under the drag — a vertical scrollbar appearing
        // on load does the same. The layout manager rescales every column to
        // the new available width, which leaves the drag's press-time snapshot
        // describing widths the table no longer has.
        table.setWidth(414);
        table.doLayout();

        const rescaled = table.getColumnWidths().slice();

        expect(rescaled).not.toEqual([200, 150, 100, 50]);
        expect(barOf(table)).toBeNull();

        priv.onColumnResize(0, 1080);
        flushFrame();
        priv.onColumnResizeEnd();

        // Committing the snapshot here would undo the rescale and leave a
        // width target the container cannot hold.
        expect(table.getColumnWidths()).toEqual(rescaled);
        expect(table.getColumnWidthTarget()).toBe(0);
    });

    /**
     * Presses column 0's right edge in outline mode and moves once, leaving a
     * bar on screen and a resolved snapshot the release would commit.
     *
     * @param table - The table to drive, already in outline mode.
     * @returns Its private drag handlers.
     */
    function openOutlineDrag(table: Table): PrivDrag {
        const priv = drag(table);

        priv.onColumnResizeStart(0, PRESS_X);
        priv.onColumnResize(0, 1080);
        flushFrame();

        expect(barOf(table)).not.toBeNull();

        return priv;
    }

    /**
     * Asserts that the drag was abandoned rather than committed: the bar is
     * gone, a further move does nothing, and the release leaves the widths the
     * mutation produced.
     *
     * @param table - The table whose drag was abandoned.
     * @param priv - Its private drag handlers.
     */
    function expectAbandoned(table: Table, priv: PrivDrag): void {
        const rebuilt = table.getColumnWidths().slice();

        expect(barOf(table)).toBeNull();

        priv.onColumnResize(0, 1200);
        flushFrame();
        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual(rebuilt);
    }

    it('T22. a data-driven re-sample mid-drag abandons it', () => {
        const { store } = loaded(1);
        const table = new Table(store, { ...SPEC, autoSizeColumns: true });

        tables.push(table);
        table.getElement(true);
        table.setWidth(514);
        table.setHeight(400);
        table.doLayout();
        flushFrame();
        table.setColumnWidths([200, 150, 100, 50]);
        table.setResizeMode('outline');

        expect(table.isAutoSizeColumns()).toBe(true);

        const priv = openOutlineDrag(table);

        // An ordinary store mutation. `maybeResampleColumnWidths` clears the
        // widths for the next pass, so the snapshot no longer describes them.
        store.add({ a: 'later', b: 'later', c: 'later', d: 'later' });

        expectAbandoned(table, priv);
    });

    it('T23. switching to the rotated view mid-drag abandons it', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = openOutlineDrag(table);

        table.setDisplayMode('rotated');

        expectAbandoned(table, priv);
    });

    it('T24. re-targeting the rotated record mid-drag abandons it', () => {
        const { store, records } = loaded(2);
        const table = rotated(store, records[0]);
        const priv  = openOutlineDrag(table);

        table.selectRecord(records[1]);

        expectAbandoned(table, priv);
    });

    it('T25. a store change while rotated mid-drag abandons it', () => {
        const { store, records } = loaded(1);
        const table = rotated(store, records[0]);
        const priv  = openOutlineDrag(table);

        store.add({ a: 'later', b: 'later', c: 'later', d: 'later' });

        expectAbandoned(table, priv);
    });

    it('T26. a column reset mid-drag abandons it', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = openOutlineDrag(table);

        // The "Reset columns" entry of the header context menu, which the
        // offline harness cannot open.
        priv.resetColumns();

        expectAbandoned(table, priv);
    });

    it('T27. an ordinary layout pass that changes no width leaves the drag alone', () => {
        const table = makeTable();

        table.setResizeMode('outline');
        flushFrame();

        const priv = openOutlineDrag(table);

        // The columns already sum to the available width, so this pass rescales
        // nothing. Abandoning here would make any unrelated layout during a drag
        // — a hover, a scroll — silently cancel it.
        table.doLayout();

        expect(barOf(table)).not.toBeNull();
        expect(barOf(table)!.getTranslateX()).toBe(80);

        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual([280, 100, 70, 50]);
    });

    it('T28. hiding a column mid-drag abandons it even when no pass rescales', () => {
        const table = fixedTable();
        const priv  = drag(table);

        // Column C's edge again, so the drag's `moved` set holds the index of
        // the column about to go.
        priv.onColumnResizeStart(2, PRESS_X);
        priv.onColumnResize(2, 1040);
        flushFrame();

        expect(barOf(table)).not.toBeNull();

        table.setColumnVisible('d', false);
        flushFrame();

        const rebuilt = table.getColumnWidths().slice();

        expect(rebuilt).toHaveLength(3);
        expect(barOf(table)).toBeNull();

        priv.onColumnResize(2, 1080);
        flushFrame();
        priv.onColumnResizeEnd();

        expect(table.getColumnWidths()).toEqual(rebuilt);
        expect([...pinnedOf(table).keys()]).not.toContain('d');
    });

    it('T29. re-showing a column mid-drag abandons it even when no pass rescales', () => {
        const table = fixedTable();

        table.setColumnVisible('d', false);
        flushFrame();

        const priv = openOutlineDrag(table);

        table.setColumnVisible('d', true);
        flushFrame();

        const rebuilt = table.getColumnWidths().slice();

        expect(rebuilt).toHaveLength(4);
        expectAbandoned(table, priv);

        // A 3-entry snapshot committed onto 4 columns would leave the re-shown
        // column at its floor and the total past the available width.
        expect(table.getColumnWidths().reduce((sum, w) => sum + w, 0)).toBeLessThanOrEqual(table.getAvailableColumnWidth() + 0.5);
    });

    it('T30. a column reset mid-drag abandons it even when no pass rescales', () => {
        const table = fixedTable();
        const priv  = openOutlineDrag(table);

        priv.resetColumns();
        flushFrame();

        expectAbandoned(table, priv);
        expect(pinnedOf(table).size).toBe(0);
    });
});
