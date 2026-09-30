// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins plans/implemented/tree-expand-collapse-animation.md's TreeTable
// row-motion cases (`## Expected Behaviour`, T1-T6). `TreeBody.setExpanded`
// commits synchronously (as `TreeExpandMotion.test.ts` pins for `Tree`), then
// the shared `VirtualRowView` row motion animates the toggled block over
// `Body`'s render pass.
//
// Frame-and-clock harness copied from TreeExpandMotion.test.ts: the offline
// sink drops requestAnimationFrame outright, so it is captured and driven by
// hand, and performance.now() is mocked to a controllable `clock` so
// Animation.tween's elapsed-time math is exact.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Animation } from '~/core/Animation';
import { Table } from '~/component/table/Table';
import { TreeTable } from '~/component/table/TreeTable';
import { TreeBody } from '~/component/table/TreeBody';
import { Row } from '~/component/table/Row';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import { TreeCellRenderer } from '~/component/table/cell/renderer/TreeCell';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let frames: Map<number, FrameRequestCallback> = new Map();
let nextHandle = 0;
let clock = 0;
let tables: Table[] = [];
let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
    frames = new Map();
    nextHandle = 0;
    clock = 0;
    tables = [];

    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    (DOM.sink as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
        const handle = ++nextHandle;
        frames.set(handle, cb);
        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});

afterEach(() => {
    for (const table of tables) {
        table.dispose();
    }
    runFrames();
    vi.restoreAllMocks();
    DOM.reset();
});

function runFrame(now: number): void {
    clock = now;

    const pending = frames;
    frames = new Map();

    for (const callback of pending.values()) {
        callback(now);
    }
}

function runFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        const pending = frames;
        frames = new Map();

        for (const callback of pending.values()) {
            callback(clock);
        }
    }
}

/** Jumps the clock far past any running tween's duration and drives one frame. */
function settle(): void {
    runFrame(clock + 100_000);
}

const MODEL = new Model([
    { name: 'id',     type: 'number', order: 0 },
    { name: 'parent', type: 'number', order: 1 },
    { name: 'name',   type: 'string', order: 2 },
], 'id');

const SPEC = { idField: 'id', parentField: 'parent', treeColumn: 'name', columns: [{ field: 'name', minWidth: 100 }] };

interface Fixture {
    A: number; B: number; b1: number; b2: number; b3: number; C: number; D: number;
    store: MemoryStore;
}

/** `A B{b1 b2 b3} C D`, ids 1-7, every node collapsed. */
function fixtureStore(): Fixture {
    const store = new MemoryStore(MODEL, []);

    store.loadData([
        { id: 1, parent: null, name: 'A' },
        { id: 2, parent: null, name: 'B' },
        { id: 3, parent: 2,    name: 'b1' },
        { id: 4, parent: 2,    name: 'b2' },
        { id: 5, parent: 2,    name: 'b3' },
        { id: 6, parent: null, name: 'C' },
        { id: 7, parent: null, name: 'D' },
    ]);

    return { A: 1, B: 2, b1: 3, b2: 4, b3: 5, C: 6, D: 7, store };
}

interface BodyPrivate {
    _rowPool:      Row[];
    _boundIndices: number[];
    _scroller:     { getScrollY(): number } | null;
    getRowHeight(): number;
    _previousFocusedCell: { getId(): string } | null;
}

function asPrivate(body: TreeBody): BodyPrivate {
    return body as unknown as BodyPrivate;
}

/** Mounts a 300-wide TreeTable, `rows` visible rows tall, over the fixture. */
function mountFixture(rows: number = 5): { table: TreeTable; body: TreeBody; fx: Fixture; H: number } {
    const fx    = fixtureStore();
    const table = new TreeTable(fx.store, SPEC);

    tables.push(table);

    const body = table.getBody();
    const H    = asPrivate(body).getRowHeight();

    table.getElement(true);
    table.setWidth(300);
    table.setHeight(rows * H);
    table.doLayout();

    return { table, body, fx, H };
}

function recordFor(fx: Fixture, id: number): ModelRecord {
    return fx.store.getById(id)!;
}

/** The pool row currently bound (and displayed) to `id`, or `undefined`. */
function rowFor(body: TreeBody, fx: Fixture, id: number): Row | undefined {
    const p = asPrivate(body);

    return p._rowPool.find((row, i) => p._boundIndices[i] >= 0 && row.getData()?.get('id') === id);
}

function isDisplayed(body: TreeBody, fx: Fixture, id: number): boolean {
    return rowFor(body, fx, id) !== undefined;
}

/** Drives `key` through the body's own keydown handler, as a keypress would. */
function pressKey(body: TreeBody, key: string): void {
    (body as unknown as { onKeyDown(e: Partial<KeyboardEvent>): void }).onKeyDown({ key, preventDefault: (): void => {} });
}

function treeCellOf(row: Row): TreeCellRenderer<any> {
    return row.getTreeCell()!.getRenderer() as TreeCellRenderer<any>;
}

describe('TreeTable — expand/collapse row motion', () => {

    it('T1: setExpanded commits synchronously and every row sits at index*rowHeight before any frame', () => {
        const { table, body, fx, H } = mountFixture();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);

        expect(table.isExpanded(recordFor(fx, fx.B))).toBe(true);
        expect(body.getFlatRecords()).toHaveLength(7);

        const p = asPrivate(body);
        for (let i = 0; i < p._rowPool.length; i++) {
            if (p._boundIndices[i] < 0) { continue; }
            expect(p._rowPool[i].getTranslateY()).toBe(p._boundIndices[i] * H);
        }
    });

    it('T2: at half the tween duration, positions follow the slide formula with H = body.getRowHeight()', () => {
        const { table, body, fx, H } = mountFixture();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);
        runFrame(1000); // r = 0.
        runFrame(1100); // r = 0.5.

        expect(rowFor(body, fx, fx.b1)!.getTranslateY()).toBeCloseTo(2 * H - 0.5 * 3 * H);
        expect(rowFor(body, fx, fx.b2)!.getTranslateY()).toBeCloseTo(3 * H - 0.5 * 3 * H);
        expect(rowFor(body, fx, fx.b3)!.getTranslateY()).toBeCloseTo(4 * H - 0.5 * 3 * H);
        expect(rowFor(body, fx, fx.C)!.getTranslateY()).toBeCloseTo(5 * H - 0.5 * 3 * H);
        expect(rowFor(body, fx, fx.D)!.getTranslateY()).toBeCloseTo(6 * H - 0.5 * 3 * H);
    });

    it('T3: a collapse motion turns the toggle at once and disables the pointer on the leaving rows', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);

        runFrame(1000); // first collapse frame: renders the motion row list, children bound again.

        const bRow = rowFor(body, fx, fx.B)!;
        expect(bRow.getAria().getExpanded()).toBe(false);
        expect(treeCellOf(bRow).getToggle()!.getTransform()).toBe('rotate(0deg)');
        expect(rowFor(body, fx, fx.b1)?.getPointerEvents()).toBe('none');
        expect(rowFor(body, fx, fx.b2)?.getPointerEvents()).toBe('none');
        expect(rowFor(body, fx, fx.b3)?.getPointerEvents()).toBe('none');
    });

    /**
     * Asserts `.focused` sits on a cell of the row bound to `id`, and
     * `aria-activedescendant` names that same cell — read straight after a
     * frame, with no manual refresh of either.
     */
    function expectFocusOn(body: TreeBody, fx: Fixture, id: number): void {
        const focusedCell = asPrivate(body)._previousFocusedCell;

        expect(focusedCell).not.toBeNull();
        expect(rowFor(body, fx, id)!.getComponents().some(c => c === (focusedCell as unknown as object))).toBe(true);
        expect(body.getAria().getActiveDescendant()).toBe(focusedCell!.getId());
    }

    // Both T4 cases mount ten rows tall (header included), so `End` needs no
    // scroll and the toggle's commit leaves the scroll offset alone (a
    // clamped scroll would snap the toggle instead of animating it).
    it('T4: a collapse keeps .focused and aria-activedescendant on the anchor row below the block, mid-motion and settled', () => {
        const { table, body, fx } = mountFixture(10);

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        // `End` selects D the way a user would, which also points
        // aria-activedescendant at D's focused cell.
        pressKey(body, 'End');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.D));

        const tweenSpy = vi.spyOn(Animation, 'tween');

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);
        expect(tweenSpy).toHaveBeenCalledOnce();

        runFrame(1000); // first collapse frame: switches the pool to the motion row list.
        runFrame(1100); // mid-collapse: D is still below the (still-bound) leaving block.
        expectFocusOn(body, fx, fx.D);

        settle();
        expectFocusOn(body, fx, fx.D);
    });

    it('T4: an expand keeps .focused and aria-activedescendant on the anchor row below the block, mid-motion and settled', () => {
        const { table, body, fx } = mountFixture(10);

        pressKey(body, 'End');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.D));

        const tweenSpy = vi.spyOn(Animation, 'tween');

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);
        expect(tweenSpy).toHaveBeenCalledOnce();

        // The expand's commit moved D three pool slots down; the frames' own
        // render passes must carry both indicators with it.
        runFrame(1000);
        runFrame(1100);
        expectFocusOn(body, fx, fx.D);

        settle();
        expectFocusOn(body, fx, fx.D);
    });

    /**
     * Asserts the pool renders the committed flat list at its final state:
     * every displayed row is bound to the record at its flat index and sits
     * at `index * H`, and no pool row carries an opacity or pointer-events.
     */
    function expectFinalRender(body: TreeBody, H: number): void {
        const p    = asPrivate(body);
        const flat = body.getFlatRecords();

        for (let i = 0; i < p._rowPool.length; i++) {
            const row = p._rowPool[i];

            expect(row.getOpacity()).toBeNull();
            expect(row.getPointerEvents()).toBeNull();

            if (p._boundIndices[i] < 0) { continue; }
            expect(row.getData()).toBe(flat[p._boundIndices[i]].record);
            expect(row.getTranslateY()).toBe(p._boundIndices[i] * H);
        }
    }

    /** Everything a frame could change on the pool: binding, position, opacity, pointer. */
    function poolSnapshot(body: TreeBody): unknown[] {
        const p = asPrivate(body);

        return p._rowPool.map((row, i) => [
            p._boundIndices[i], row.getData(), row.getTranslateY(), row.getOpacity(), row.getPointerEvents(),
        ]);
    }

    const STOPPERS: Array<[string, (table: TreeTable, fx: Fixture) => void, number]> = [
        ['expandToDepth(1)', (table) => { table.expandToDepth(1); }, 7],
        ['collapseAll()',    (table) => { table.collapseAll(); },    4],
        ['expandAll()',      (table) => { table.expandAll(); },      7],
        // A parent-field change: b3 moves from under B to the root level.
        ['a store change of a parent field', (_table, fx) => { recordFor(fx, fx.b3).set('parent', null); }, 7],
    ];

    it.each(STOPPERS)('T5: %s stops a running motion and renders final in the same call', (_name, act, flatLength) => {
        const { table, body, fx, H } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        runFrame(0);
        runFrame(80); // motion running, mid-flight.

        const tweenSpy = vi.spyOn(Animation, 'tween');

        act(table, fx);

        expect(tweenSpy).not.toHaveBeenCalled();
        expect(body.getFlatRecords()).toHaveLength(flatLength);
        expectFinalRender(body, H);

        const before = poolSnapshot(body);
        runFrame(100);
        runFrames();
        settle();
        expect(poolSnapshot(body)).toEqual(before);
        expect(tweenSpy).not.toHaveBeenCalled();
    });

    it('keeps aria-rowcount at the committed visible count on every frame of a collapse', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();
        expect(body.getAria().getRowCount()).toBe(7);

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);
        expect(body.getAria().getRowCount()).toBe(4);

        for (const now of [1000, 1050, 1100, 1150, 1200]) {
            runFrame(now);
            expect(body.getAria().getRowCount()).toBe(body.getFlatRecords().length);
        }
    });

    it('rows below a collapsing block announce their committed aria-rowindex; the leaving rows keep theirs', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        const leaving = [fx.b1, fx.b2, fx.b3];
        const before  = leaving.map(id => rowFor(body, fx, id)!.getAria().getRowIndex());

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);

        for (const now of [1000, 1100]) {
            runFrame(now);

            // Committed list `A B C D`; +2 is the 1-based index past the header row.
            expect(rowFor(body, fx, fx.A)!.getAria().getRowIndex()).toBe(2);
            expect(rowFor(body, fx, fx.B)!.getAria().getRowIndex()).toBe(3);
            expect(rowFor(body, fx, fx.C)!.getAria().getRowIndex()).toBe(4);
            expect(rowFor(body, fx, fx.D)!.getAria().getRowIndex()).toBe(5);
            expect(leaving.map(id => rowFor(body, fx, id)!.getAria().getRowIndex())).toEqual(before);
        }
    });

    it('rows below a collapsing block show their committed zebra stripe; the leaving rows keep theirs', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        const striped = (id: number): boolean => rowFor(body, fx, id)!.isStyleState('.stripe');
        const leaving = [fx.b1, fx.b2, fx.b3];
        const before  = leaving.map(striped);

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);

        for (const now of [1000, 1100]) {
            runFrame(now);

            // Committed list `A B C D`: odd committed indexes (B, D) carry the stripe.
            expect([fx.A, fx.B, fx.C, fx.D].map(striped)).toEqual([false, true, false, true]);
            expect(leaving.map(striped)).toEqual(before);
        }
    });

    // -----------------------------------------------------------------------
    // Scroll-into-view mid-motion. `Body.scrollToRecord` and keyboard
    // navigation compute their target from committed row positions, so they
    // settle a running motion first — but only when they will actually move
    // the scroll offset. With the target already in view the motion keeps
    // playing.
    // -----------------------------------------------------------------------

    /** Leaf ids appended after the fixture's `D` by {@link mountLongFixture}. */
    const LEAF_IDS = Array.from({ length: 20 }, (_, i) => 8 + i);

    /**
     * Mounts the fixture with 20 more root leaves (`L0..L19`, ids 8-27) after
     * `D`, five rows tall (header included) — long enough that a committed
     * row can sit outside the viewport.
     */
    function mountLongFixture(): { table: TreeTable; body: TreeBody; fx: Fixture; H: number } {
        const mounted = mountFixture();

        mounted.fx.store.add(LEAF_IDS.map((id, i) => ({ id, parent: null, name: 'L' + i })));

        return mounted;
    }

    /** Expands B and settles, then leaves a collapse of B mid-motion. */
    function startCollapse(table: TreeTable, body: TreeBody, fx: Fixture): void {
        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);
        runFrame(1000);
        runFrame(1050);

        expect(isMotionRunning(body)).toBe(true);
    }

    function isMotionRunning(body: TreeBody): boolean {
        return (body as unknown as { isRowMotionRunning(): boolean }).isRowMotionRunning();
    }

    /** Asserts the motion was settled: final render, leaving rows gone, and no later frame changes the pool. */
    function expectSettled(body: TreeBody, fx: Fixture, H: number): void {
        expect(isMotionRunning(body)).toBe(false);
        [fx.b1, fx.b2, fx.b3].forEach(id => expect(isDisplayed(body, fx, id)).toBe(false));
        expectFinalRender(body, H);

        const before = poolSnapshot(body);

        runFrame(clock + 50);
        settle();
        expect(poolSnapshot(body)).toEqual(before);
    }

    /** Asserts the collapse is still playing: running, with its leaving rows still rendered. */
    function expectStillAnimating(body: TreeBody, fx: Fixture): void {
        expect(isMotionRunning(body)).toBe(true);
        [fx.b1, fx.b2, fx.b3].forEach(id => expect(isDisplayed(body, fx, id)).toBe(true));
    }

    /** Asserts the row bound to `id` renders fully inside the body's viewport. */
    function expectRenderedInView(body: TreeBody, fx: Fixture, id: number, H: number): void {
        const top = rowFor(body, fx, id)!.getTranslateY()! - asPrivate(body)._scroller!.getScrollY();

        expect(top).toBeGreaterThanOrEqual(0);
        expect(top + H).toBeLessThanOrEqual(body.getHeight());
    }

    it('scrollToRecord mid-collapse settles the motion when it has to scroll', () => {
        const { table, body, fx, H } = mountLongFixture();

        startCollapse(table, body, fx);
        body.scrollToRecord(recordFor(fx, LEAF_IDS[5])); // committed row 9.

        expect(asPrivate(body)._scroller!.getScrollY()).toBe(9 * H);
        expectSettled(body, fx, H);
        expectRenderedInView(body, fx, LEAF_IDS[5], H);
    });

    it('scrollToRecord mid-collapse keeps the motion running when the offset would not change', () => {
        const { table, body, fx } = mountLongFixture();

        startCollapse(table, body, fx);
        body.scrollToRecord(recordFor(fx, fx.A)); // committed row 0: already the top.

        expect(asPrivate(body)._scroller!.getScrollY()).toBe(0);
        expectStillAnimating(body, fx);
    });

    it('scrollToRecord settles and renders even when the scroller clamps its target back to the current offset', () => {
        const { table, body, fx, H } = mountLongFixture();
        const scroller = asPrivate(body)._scroller!;

        // Scrolled to the bottom of the collapsed list, B's collapse leaves
        // the offset alone (so it animates), and a scroll to the last record
        // clamps back to that same committed maximum.
        body.setScrollY(1_000_000);
        const maxScroll = scroller.getScrollY();
        expect(maxScroll).toBeGreaterThan(0);

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();
        expect(scroller.getScrollY()).toBe(maxScroll);

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);
        runFrame(1000);
        runFrame(1050);
        expect(isMotionRunning(body)).toBe(true);

        body.scrollToRecord(recordFor(fx, LEAF_IDS[19]));

        expect(scroller.getScrollY()).toBe(maxScroll);
        expect(isMotionRunning(body)).toBe(false);
        expectFinalRender(body, H);
    });

    it('scrollToRecord mid-collapse near the list end lands on the committed offset in one step', () => {
        const { table, body, fx, H } = mountLongFixture();
        const scroller = asPrivate(body)._scroller!;

        body.setScrollY(1_000_000);
        const maxScroll = scroller.getScrollY(); // the collapsed list's maximum.

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();
        body.setScrollY(10 * H);

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);
        runFrame(1000);
        runFrame(1050);
        expect(isMotionRunning(body)).toBe(true);

        // Every offset the rows container is moved to, in order.
        const offsets: number[] = [];
        const transform = vi.spyOn(scroller as unknown as { updateTransform(): void }, 'updateTransform');
        transform.mockImplementation(function (this: { getScrollY(): number }) {
            offsets.push(this.getScrollY());
        });

        // Committed row 23: past the collapsed list's maximum, but inside the
        // taller content the motion's last frame left on the scroller.
        body.scrollToRecord(recordFor(fx, LEAF_IDS[19]));

        expect(offsets).toEqual([maxScroll]);
        expect(scroller.getScrollY()).toBe(maxScroll);
        expectSettled(body, fx, H);
    });

    it('scrollToRecord mid-expand near the list end scrolls to its committed offset, not the pre-expand maximum', () => {
        const { table, body, fx, H } = mountFixture();
        const scroller = asPrivate(body)._scroller!;

        // Scrolled to the bottom of the collapsed list, an expand's first
        // frame (r = 0) keeps the pre-expand content height on the scroller.
        body.setScrollY(1000);
        const maxScroll = scroller.getScrollY();
        expect(maxScroll).toBeGreaterThan(0);

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);
        runFrame(1000);
        expect(isMotionRunning(body)).toBe(true);

        body.scrollToRecord(recordFor(fx, fx.D)); // committed row 6, the last.

        expect(scroller.getScrollY()).toBeGreaterThan(maxScroll);
        expect(isMotionRunning(body)).toBe(false);
        expectFinalRender(body, H);
        expectRenderedInView(body, fx, fx.D, H);
    });

    it('keyboard navigation mid-collapse settles the motion when it has to scroll', () => {
        const { table, body, fx, H } = mountLongFixture();

        startCollapse(table, body, fx);
        pressKey(body, 'End'); // the last leaf, committed row 23.

        expect(body.getSelectedRecord()).toBe(recordFor(fx, LEAF_IDS[19]));
        expectSettled(body, fx, H);
        expectRenderedInView(body, fx, LEAF_IDS[19], H);
    });

    it('keyboard navigation mid-collapse keeps the motion running when the new row is already in view', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        pressKey(body, 'Home');
        pressKey(body, 'ArrowDown');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.B));

        clock = 1000;
        pressKey(body, 'ArrowLeft'); // collapses B, keeping it the anchor.
        expect(table.isExpanded(recordFor(fx, fx.B))).toBe(false);
        runFrame(1000);
        runFrame(1050);

        pressKey(body, 'ArrowDown'); // C: committed row 2, in view.

        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.C));
        expect(asPrivate(body)._scroller!.getScrollY()).toBe(0);
        expectStillAnimating(body, fx);
    });

    // -----------------------------------------------------------------------
    // A keyboard move onto a row an expand is still fading in settles the
    // motion, so the selection tint and focus ring land on a row rendered
    // final.
    // -----------------------------------------------------------------------

    /** Selects B, then expands it with ArrowRight and plays the motion to +60ms. */
    function startKeyboardExpand(table: TreeTable, body: TreeBody, fx: Fixture): void {
        pressKey(body, 'Home');
        pressKey(body, 'ArrowDown');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.B));

        clock = 1000;
        pressKey(body, 'ArrowRight');
        expect(table.isExpanded(recordFor(fx, fx.B))).toBe(true);
        runFrame(1000);
        runFrame(1060);

        expect(isMotionRunning(body)).toBe(true);
        expect(rowFor(body, fx, fx.b1)!.getOpacity()).toBeLessThan(1);
    }

    /** Asserts no motion is left and no later frame changes the pool. */
    function expectNoMotionLeft(body: TreeBody, H: number): void {
        expect(isMotionRunning(body)).toBe(false);
        expectFinalRender(body, H);

        const before = poolSnapshot(body);

        runFrame(clock + 50);
        expect(poolSnapshot(body)).toEqual(before);
        settle();
        expect(poolSnapshot(body)).toEqual(before);
    }

    it('ArrowDown mid-expand onto an entering child settles the motion, so the child renders final', () => {
        const { table, body, fx, H } = mountFixture(10);

        startKeyboardExpand(table, body, fx);
        pressKey(body, 'ArrowDown');

        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.b1));
        expect(rowFor(body, fx, fx.b1)!.getOpacity()).toBeNull();
        expectFocusOn(body, fx, fx.b1);
        expectNoMotionLeft(body, H);
    });

    it('ArrowRight on the expanding row mid-expand moves into its entering first child and settles the motion', () => {
        const { table, body, fx, H } = mountFixture(10);

        startKeyboardExpand(table, body, fx);
        pressKey(body, 'ArrowRight'); // B is expanded now: moves focus to b1.

        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.b1));
        expectFocusOn(body, fx, fx.b1);
        expectNoMotionLeft(body, H);
    });

    it('a keyboard move to a row outside the expanding block keeps the motion playing', () => {
        const { table, body, fx } = mountFixture(10);

        startKeyboardExpand(table, body, fx);
        pressKey(body, 'ArrowUp'); // A: above the block, in view.

        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.A));
        expect(isMotionRunning(body)).toBe(true);
        expect(rowFor(body, fx, fx.b1)!.getOpacity()).toBeLessThan(1);
    });

    // -----------------------------------------------------------------------
    // Snap rules, mirroring Tree's M9-M11.
    // -----------------------------------------------------------------------

    /** Mounts a five-row TreeTable over one root branch `E` (id 1) with `childCount` leaf children, collapsed. */
    function mountSingleBranch(childCount: number): { table: TreeTable; body: TreeBody; E: ModelRecord } {
        const store = new MemoryStore(MODEL, []);

        store.loadData([
            { id: 1, parent: null, name: 'E' },
            ...Array.from({ length: childCount }, (_, i) => ({ id: 2 + i, parent: 1, name: 'c' + i })),
        ]);

        const table = new TreeTable(store, SPEC);

        tables.push(table);

        const body = table.getBody();

        table.getElement(true);
        table.setWidth(300);
        table.setHeight(5 * asPrivate(body).getRowHeight());
        table.doLayout();

        return { table, body, E: store.getById(1)! };
    }

    it('a block that exactly fills the viewport animates; one row taller snaps', () => {
        const probe        = mountSingleBranch(1);
        const viewportRows = Math.ceil(probe.body.getHeight() / asPrivate(probe.body).getRowHeight());

        const tweenSpy = vi.spyOn(Animation, 'tween');

        const fits = mountSingleBranch(viewportRows);
        fits.table.setExpanded(fits.E, true);
        expect(tweenSpy).toHaveBeenCalledTimes(1);

        tweenSpy.mockClear();

        const overflows = mountSingleBranch(viewportRows + 1);
        overflows.table.setExpanded(overflows.E, true);
        expect(tweenSpy).not.toHaveBeenCalled();
        expect(overflows.table.isExpanded(overflows.E)).toBe(true);
    });

    it('a collapse whose commit clamps the scroll offset snaps instead of animating', () => {
        const store = new MemoryStore(MODEL, []);

        store.loadData([
            ...Array.from({ length: 20 }, (_, i) => ({ id: 1 + i, parent: null, name: 'r' + i })),
            { id: 21, parent: null, name: 'Z' },
            { id: 22, parent: 21,   name: 'z1' },
            { id: 23, parent: 21,   name: 'z2' },
            { id: 24, parent: 21,   name: 'z3' },
        ]);

        const table = new TreeTable(store, SPEC);
        tables.push(table);

        const body = table.getBody();
        const H    = asPrivate(body).getRowHeight();

        table.getElement(true);
        table.setWidth(300);
        table.setHeight(5 * H);
        table.doLayout();

        const Z = store.getById(21)!;

        clock = 0;
        table.setExpanded(Z, true);
        settle(); // 24 flat rows now.

        body.setScrollY(24 * H); // scrolled to (past) the end.
        const scrollBefore = asPrivate(body)._scroller!.getScrollY();

        const tweenSpy = vi.spyOn(Animation, 'tween');
        table.setExpanded(Z, false); // collapsing drops 3 rows, so the commit re-clamps the scroll offset.

        expect(tweenSpy).not.toHaveBeenCalled();
        expect(asPrivate(body)._scroller!.getScrollY()).toBeLessThan(scrollBefore);
        expect(body.getFlatRecords()).toHaveLength(21);
        expectFinalRender(body, H);
    });

    it('reduced motion commits the final state with no tween', () => {
        vi.spyOn(Animation, 'isReducedMotion').mockReturnValue(true);
        const { table, body, fx, H } = mountFixture();
        const tweenSpy = vi.spyOn(Animation, 'tween');

        table.setExpanded(recordFor(fx, fx.B), true);

        expect(tweenSpy).not.toHaveBeenCalled();
        expect(rowFor(body, fx, fx.b1)!.getTranslateY()).toBe(2 * H);
        expectFinalRender(body, H);
    });

    // -----------------------------------------------------------------------
    // Leaving rows are hidden from assistive technology while they play.
    // -----------------------------------------------------------------------

    /** The pool rows currently carrying `aria-hidden="true"`. */
    function hiddenRows(body: TreeBody): Row[] {
        return asPrivate(body)._rowPool.filter(row => row.getAria().getHidden() === true);
    }

    /**
     * The pool rows carrying any `aria-hidden` at all. A revealed row has the
     * attribute removed, not set to `"false"`, so this is empty once no row
     * is hidden.
     */
    function rowsWithAriaHidden(body: TreeBody): Row[] {
        return asPrivate(body)._rowPool.filter(row => row.getAria().getHidden() !== null);
    }

    it('leaving rows are aria-hidden on every collapse frame, and no two visible rows share an aria-rowindex', () => {
        const { table, body, fx } = mountFixture();

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false);

        for (const now of [1000, 1050, 1100, 1150]) {
            runFrame(now);

            const p        = asPrivate(body);
            const leaving  = [fx.b1, fx.b2, fx.b3].map(id => rowFor(body, fx, id)!);
            const exposed  = p._rowPool.filter((row, i) => p._boundIndices[i] >= 0 && row.getAria().getHidden() !== true);
            const indexes  = exposed.map(row => row.getAria().getRowIndex());

            expect(hiddenRows(body)).toEqual(expect.arrayContaining(leaving));
            expect(hiddenRows(body)).toHaveLength(3);
            expect(new Set(indexes).size).toBe(indexes.length);
        }
    });

    it('an expand hides no row: its entering rows are committed', () => {
        const { table, body, fx } = mountFixture();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);

        for (const now of [1000, 1100]) {
            runFrame(now);
            expect(rowsWithAriaHidden(body)).toEqual([]);
        }
    });

    it('the leaving rows are revealed again when the collapse settles', () => {
        const { table, body, fx } = mountFixture();

        startCollapse(table, body, fx);
        expect(hiddenRows(body)).toHaveLength(3);

        settle();
        expect(rowsWithAriaHidden(body)).toEqual([]);
    });

    it('the leaving rows are revealed again when a structural change stops the collapse', () => {
        const { table, body, fx } = mountFixture();

        startCollapse(table, body, fx);
        expect(hiddenRows(body)).toHaveLength(3);

        table.expandAll(); // stops the motion; b1-b3 stay bound, now as committed rows.

        expect(isDisplayed(body, fx, fx.b1)).toBe(true);
        expect(rowsWithAriaHidden(body)).toEqual([]);
    });

    it('a leaving row\'s slot rebound to another record mid-motion is revealed again', () => {
        const { table, body, fx, H } = mountLongFixture();

        startCollapse(table, body, fx);

        const leavingRows = hiddenRows(body);
        expect(leavingRows).toHaveLength(3);

        body.setScrollY(10 * H); // b1-b3 scroll out of the window; their slots rebind.

        const p         = asPrivate(body);
        const reboundTo = leavingRows.filter(row => p._boundIndices[p._rowPool.indexOf(row)] >= 0);

        expect(isMotionRunning(body)).toBe(true);
        expect(reboundTo.length).toBeGreaterThan(0);
        reboundTo.forEach(row => expect([fx.b1, fx.b2, fx.b3]).not.toContain(row.getData()!.get('id')));
        expect(rowsWithAriaHidden(body)).toEqual([]);
    });

    it('aria-activedescendant never names a hidden leaving row, even when the anchor is inside the collapsing block', () => {
        const { table, body, fx } = mountFixture(10);

        clock = 0;
        table.setExpanded(recordFor(fx, fx.B), true);
        settle();

        pressKey(body, 'Home');
        pressKey(body, 'ArrowDown');
        pressKey(body, 'ArrowDown');
        pressKey(body, 'ArrowDown');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.b2));

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), false); // programmatic: the anchor stays b2.

        for (const now of [1000, 1050, 1100, 1150]) {
            runFrame(now);

            const hiddenIds = hiddenRows(body).flatMap(row => [row.getId(), ...row.getComponents().map(c => c.getId())]);

            expect(hiddenRows(body)).toHaveLength(3);
            expect(hiddenIds).not.toContain(body.getAria().getActiveDescendant());
        }
    });

    it('an anchor that is itself a separator record keeps aria-activedescendant with the focus ring on every motion frame', () => {
        const { table, body, fx } = mountFixture(10);
        const separator = recordFor(fx, fx.D);

        // Only a programmatic selection can anchor on a separator record.
        body.setRowSeparator(record => record === separator ? { label: 'SEP', color: null } : null);
        body.selectRecord(separator);
        (body as unknown as { renderWindow(): void }).renderWindow();

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);

        for (const now of [1000, 1050, 1100]) {
            runFrame(now);

            const ring = asPrivate(body)._previousFocusedCell;

            expect(ring).not.toBeNull();
            expect(asPrivate(body)._rowPool.find(row => row.getComponents().includes(ring as never))!.isSeparator()).toBe(true);
            expect(body.getAria().getActiveDescendant()).toBe(ring!.getId());
        }
    });

    it('motion frames re-point aria-activedescendant from the pool, without the full record-list lookup', () => {
        const { table, body, fx } = mountFixture(10);

        pressKey(body, 'End');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.D));

        const fullLookup = vi.spyOn(body as unknown as { _updateActiveDescendant(): void }, '_updateActiveDescendant');

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);
        runFrame(1000);
        runFrame(1100);
        expectFocusOn(body, fx, fx.D);

        settle();
        expectFocusOn(body, fx, fx.D);
        expect(fullLookup).not.toHaveBeenCalled();
    });

    it('motion frames refresh the focus ring from the pool, rebuilding the record list only for the render itself', () => {
        const { table, body, fx } = mountFixture(10);

        pressKey(body, 'End');
        expect(body.getSelectedRecord()).toBe(recordFor(fx, fx.D));

        clock = 1000;
        table.setExpanded(recordFor(fx, fx.B), true);
        runFrame(1000);

        const lookups = vi.spyOn(body as unknown as { getVisibleRecords(): ModelRecord[] }, 'getVisibleRecords');

        runFrame(1100);
        expectFocusOn(body, fx, fx.D);
        expect(lookups).toHaveBeenCalledTimes(1);
    });

    it('T6: a plain Table is unaffected — getRenderedRecords returns the visible records it is given', () => {
        const model = new Model([{ name: 'v', type: 'string', order: 0 }]);
        const store = new MemoryStore(model, [{ v: 'x' }]);
        const table = new Table(store);
        tables.push(table);

        const body = table.getBody() as unknown as { getRenderedRecords(v: ModelRecord[]): ModelRecord[] };
        const visible: ModelRecord[] = [];

        expect(body.getRenderedRecords(visible)).toBe(visible);
    });
});
