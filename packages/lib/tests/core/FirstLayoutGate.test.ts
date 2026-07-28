//
// Coverage for the one-shot startup font gate.
//
// The first layout pass would otherwise measure every piece of text against the
// browser's fallback font and commit those sizes, then move every text box at
// once when the real face activates a few milliseconds later. The gate holds
// that first coalesced flush until the font has activated, so the first
// geometry the page commits is already correct.
//
// The hold has to be bounded: if activation never reports back, the gate opens
// on its own so the page cannot be left unlaid-out. The deadline is started by
// the first *held frame* rather than by arming, because an animation frame
// cannot run until the synchronous startup work is finished — anchoring there
// is what makes the budget a real idle-time budget.
//
// The offline DOM's requestAnimationFrame is a no-op recorder, so these spy on
// it to capture the flush callback and drive it deterministically, mirroring
// tests/core/AfterNextLayout.test.ts.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { VBox } from '~/layout/VBox';
import { Fit } from '~/layout/Fit';
import { DOM } from '~/core/DOM';
import { _Tree } from '~/component/tree/Tree';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import {
    FIRST_LAYOUT_HOLD_MS,
    holdFirstLayout,
    isFirstLayoutHeld,
    releaseFirstLayout,
} from '~/core/FirstLayoutGate';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

/** Tree's fixed row height, mirrored from Tree.ts. */
const ROW_HEIGHT = 24;

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('FirstLayoutGate', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    // Release before draining: a test that left the gate armed would otherwise
    // hold its own cleanup frame, leaving the module-level rafHandle set and
    // blocking the next test from capturing a frame.
    afterEach(() => {
        releaseFirstLayout();
        flushFrame();
        vi.restoreAllMocks();
        vi.useRealTimers();
        DOM.reset();
    });

    /** Invokes every animation-frame callback captured since the last flush (the layout pass). */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    /** A mounted container whose doLayout calls are counted. */
    function countedComponent(): { component: Container; layouts: () => number } {
        const component = new Container({ layoutManager: VBox() });
        component.getElement(true);
        component.setSize({ width: 200, height: 100 });

        const spy = vi.spyOn(component, 'doLayout');

        return { component, layouts: () => spy.mock.calls.length };
    }

    it('is invisible when it was never armed', () => {
        const { component, layouts } = countedComponent();

        expect(isFirstLayoutHeld()).toBe(false);

        component.scheduleLayout();
        flushFrame();

        expect(layouts()).toBe(1);
    });

    it('defers the flush while it is armed', () => {
        const { component, layouts } = countedComponent();

        holdFirstLayout();
        component.scheduleLayout();

        flushFrame();
        expect(layouts()).toBe(0);

        flushFrame();
        flushFrame();
        expect(layouts()).toBe(0);
    });

    it('re-requests a frame each time a held frame runs, so the retry loop keeps running', () => {
        holdFirstLayout();
        new Container({ layoutManager: VBox() }).scheduleLayout();

        flushFrame();

        expect(frames.length).toBe(1);
    });

    it('starts the release deadline on the first held frame only', () => {
        vi.useFakeTimers();
        const timers = vi.spyOn(DOM.sink, 'setTimeout');

        holdFirstLayout();
        new Container({ layoutManager: VBox() }).scheduleLayout();

        flushFrame();
        expect(timers.mock.calls.length).toBe(1);
        expect(timers.mock.calls[0][1]).toBe(FIRST_LAYOUT_HOLD_MS);

        flushFrame();
        flushFrame();
        expect(timers.mock.calls.length).toBe(1);
    });

    it('lays out once the font activation releases it', () => {
        const { component, layouts } = countedComponent();

        holdFirstLayout();
        component.scheduleLayout();
        flushFrame();

        releaseFirstLayout();
        flushFrame();

        expect(layouts()).toBe(1);
    });

    it('lays out on its own once the deadline expires', () => {
        vi.useFakeTimers();
        const { component, layouts } = countedComponent();

        holdFirstLayout();
        component.scheduleLayout();
        flushFrame();

        expect(layouts()).toBe(0);

        vi.advanceTimersByTime(FIRST_LAYOUT_HOLD_MS);
        expect(isFirstLayoutHeld()).toBe(false);

        flushFrame();
        expect(layouts()).toBe(1);
    });

    it('cancels the deadline when it is released early', () => {
        vi.useFakeTimers();
        const timers    = vi.spyOn(DOM.sink, 'setTimeout');
        const cancelled = vi.spyOn(DOM.sink, 'clearTimeout');

        holdFirstLayout();
        new Container({ layoutManager: VBox() }).scheduleLayout();
        flushFrame();

        releaseFirstLayout();

        // The timer is handed back, not just abandoned — an abandoned one would
        // still fire and land on an idempotent release, which the end state
        // below cannot tell apart from a real cancellation.
        expect(cancelled).toHaveBeenCalledWith(timers.mock.results[0].value);

        vi.advanceTimersByTime(FIRST_LAYOUT_HOLD_MS * 20);

        expect(isFirstLayoutHeld()).toBe(false);
    });

    it('is bypassed by the synchronous resumeLayout escape hatch', () => {
        const { component, layouts } = countedComponent();

        flushFrame();
        const settled = layouts();

        component.pauseLayout();

        holdFirstLayout();
        component.resumeLayout();

        // Same contract as flushLayout: resuming lays out on the spot, so it
        // reads geometry measured against whatever font is active now.
        expect(layouts()).toBeGreaterThan(settled);
    });

    it('is idempotent to release, armed or not', () => {
        expect(() => releaseFirstLayout()).not.toThrow();
        expect(isFirstLayoutHeld()).toBe(false);

        holdFirstLayout();
        releaseFirstLayout();
        releaseFirstLayout();

        expect(isFirstLayoutHeld()).toBe(false);
    });

    it('is bypassed by the synchronous flushLayout escape hatch', () => {
        const { component, layouts } = countedComponent();

        holdFirstLayout();
        component.scheduleLayout();
        component.flushLayout();

        expect(layouts()).toBeGreaterThan(0);
    });

    it('does not lay out a paused component when it is released', () => {
        const { component, layouts } = countedComponent();

        // Settle the layout the construction-time setSize queued, so what this
        // test counts is only what the gate's release drives.
        flushFrame();
        const settled = layouts();

        holdFirstLayout();
        component.pauseLayout();
        component.scheduleLayout();
        flushFrame();

        releaseFirstLayout();
        flushFrame();

        expect(layouts()).toBe(settled);
    });

    it('holds a virtual row view that renders at element-creation time', () => {
        holdFirstLayout();

        // Tree.init ends with renderWindow(), so a mounted tree commits its row
        // geometry the moment its element exists — synchronously, without ever
        // entering the layout queue. Holding the queue alone would not reach it.
        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([{ label: 'World' }, { label: 'Hello' }]);

        const pool = (tree as unknown as { _rowPool: unknown[] })._rowPool;

        expect(pool.length).toBe(0);

        releaseFirstLayout();
        flushFrame();

        expect(pool.length).toBeGreaterThan(0);
    });

    it('renders a held table body once the release drives its layout', async () => {
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: '1' }, { a: '2' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });

        // Settle everything first, so the table itself is clean when the body
        // defers below. With a dirty ancestor the flush prunes the body and the
        // table's own layout re-renders it, which would hide whether the body's
        // own doLayout picks the deferred pass back up — the case this covers,
        // and the only route left when the parent layout does not run.
        flushFrame();

        const body = (table as unknown as {
            _body: { _boundIndices: number[]; renderWindow(): void };
        })._body;

        holdFirstLayout();

        // Model a data change: unbind every slot, then ask for the render that
        // would re-bind them. The gate must defer it.
        body._boundIndices.fill(-1);
        body.renderWindow();

        expect(body._boundIndices.every(index => index < 0)).toBe(true);

        releaseFirstLayout();
        flushFrame();

        expect(body._boundIndices.some(index => index >= 0)).toBe(true);
    });

    it('replays a deferred render with the widths its caller supplied', async () => {
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: '1' }, { a: '2' }]);
        await store.load();

        // Armed before the table's first layout ever runs — the real startup
        // order, since Body's static INSTANCE arms the gate at module load.
        holdFirstLayout();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });

        // A synchronous ancestor layout during the hold. It bypasses the hold
        // for its own frame, but the body's render pass checks the hold itself
        // and defers — and this is the only call that ever supplies the body's
        // widths, so a deferral that drops them has no other source to recover
        // them from.
        table.flushLayout();

        const body = (table as unknown as { _body: { _lastBodyWidth: number } })._body;

        releaseFirstLayout();
        flushFrame();

        expect(body._lastBodyWidth).toBeGreaterThan(0);
    });

    it('does not replay a startup pass over the state a later render committed', async () => {
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: '1' }, { a: '2' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });
        flushFrame();

        const body = (table as unknown as {
            _body: { _lastBodyWidth: number; renderWindow(w?: number, c?: number[]): void; doLayout(): unknown };
        })._body;

        holdFirstLayout();
        body.renderWindow(100, [100]);

        releaseFirstLayout();
        body.renderWindow(500, [500]);

        expect(body._lastBodyWidth).toBe(500);

        // A render that proceeds for real supersedes the held one, so no pass
        // is still pending. Were the flag to outlive it, every later layout of
        // this view would carry one redundant full re-render.
        const rendered = vi.spyOn(body, 'renderWindow');

        body.doLayout();

        expect(rendered).not.toHaveBeenCalled();
    });

    it('does not mirror a scroll whose render pass was deferred', async () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ a: String(i) }));
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), rows);
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });
        flushFrame();

        const body = (table as unknown as {
            _body: { on(event: string, fn: () => void): unknown; onScrollerTick(): void };
        })._body;

        let mirrored = 0;
        body.on('verticalscroll', () => { mirrored += 1; });

        holdFirstLayout();
        body.onScrollerTick();

        // The tick's render was deferred, so the header translate and the
        // pinned-side body must not be moved to an offset no rows were laid
        // out at.
        expect(mirrored).toBe(0);

        releaseFirstLayout();
        body.onScrollerTick();

        expect(mirrored).toBeGreaterThan(0);
    });

    it('keeps a paused row view unrendered when the release drives a parent layout', async () => {
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: '1' }, { a: '2' }]);
        await store.load();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });
        flushFrame();

        const body = (table as unknown as {
            _body: {
                _boundIndices: number[];
                renderWindow(): void;
                doLayout(): unknown;
                pauseLayout(): unknown;
                resumeLayout(): unknown;
            };
        })._body;

        holdFirstLayout();
        body.pauseLayout();
        body._boundIndices.fill(-1);
        body.renderWindow();

        releaseFirstLayout();

        // A parent's layout recursion calls doLayout on its children whatever
        // their pause state, so this is the path that would run the deferred
        // pass behind pauseLayout's back.
        body.doLayout();

        expect(body._boundIndices.every(index => index < 0)).toBe(true);

        // Resuming is what the pause was holding back, so the deferred pass
        // must still be pending rather than dropped.
        body.resumeLayout();

        expect(body._boundIndices.some(index => index >= 0)).toBe(true);
    });

    it('still reveals a row selected while the gate was held', () => {
        holdFirstLayout();

        // Real ordering: the tree's size arrives from the parent layout the
        // gate is holding, never from an imperative setSize. A reveal computed
        // before that size lands has no viewport to compute against.
        const tree   = new _Tree();
        const parent = new Container({ layoutManager: Fit(), components: [tree] });

        parent.getElement(true);
        parent.setSize({ width: 300, height: 120 });
        tree.setNodes(Array.from({ length: 200 }, (_, i) => ({ label: 'n' + i })));

        tree.selectNode(tree.getNodes()[150]);

        releaseFirstLayout();
        flushFrame();

        const scroller = (tree as unknown as { _scroller: { getScrollY(): number } })._scroller;
        const scrollY  = scroller.getScrollY();
        const rowTop    = 150 * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;

        // The contract is that the row is visible, not merely that something
        // scrolled: a target computed against a zero viewport also moves.
        expect(scrollY).toBeLessThanOrEqual(rowTop);
        expect(scrollY + tree.getHeight()).toBeGreaterThanOrEqual(rowBottom);
    });

    it('still reveals a table record selected while the gate was held', async () => {
        const rows = Array.from({ length: 200 }, (_, i) => ({ a: String(i) }));
        const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), rows);
        await store.load();

        holdFirstLayout();

        const table = new Table(store);
        table.getElement(true);
        table.setSize({ width: 300, height: 120 });

        // The table reveals through its own scrollToRecord, which sets the
        // offset directly rather than going via scrollRowIntoView — so the hold
        // has to live at the scroll setter to catch this path too.
        table.selectRecord(store.getAll()[150]);

        releaseFirstLayout();
        flushFrame();

        const body = (table as unknown as {
            _body: { _scroller: { getScrollY(): number }; getRowHeight(): number };
        })._body;

        // scrollToRecord's contract is that the record lands at the top, not
        // merely that something moved.
        expect(body._scroller.getScrollY()).toBe(150 * body.getRowHeight());
    });

    it('both reveals a row and names it when one pass carries scroll and selection', () => {
        holdFirstLayout();

        const tree   = new _Tree();
        const parent = new Container({ layoutManager: Fit(), components: [tree] });

        parent.getElement(true);
        parent.setSize({ width: 300, height: 120 });
        tree.setNodes(Array.from({ length: 200 }, (_, i) => ({ label: 'n' + i })));

        // A selection far down the list holds both a scroll offset and an
        // active-descendant refresh on the same deferred pass. Applying the
        // scroll re-enters renderWindow, so the pass has to keep hold of its
        // own resumed state across that.
        tree.selectNode(tree.getNodes()[150]);

        releaseFirstLayout();
        flushFrame();

        const scroller = (tree as unknown as { _scroller: { getScrollY(): number } })._scroller;

        expect(scroller.getScrollY()).toBeGreaterThan(0);
        expect(tree.getAria().getActiveDescendant()).toBeTruthy();
    });

    it('applies a horizontal offset held while the gate was up', () => {
        holdFirstLayout();

        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(120);
        tree.setHeight(120);
        tree.setNodes([{ label: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' }]);

        tree.setScrollX(200);

        releaseFirstLayout();
        flushFrame();

        const scroller = (tree as unknown as {
            _scroller: { getScrollX(): number; getMaxScrollX?(): number };
        })._scroller;

        // The held offset arrives intact where the content allows it, so this
        // pins the value rather than just "non-zero".
        expect(scroller.getScrollX()).toBe(200);
    });

    it('lets the last vertical request win when a reveal and an offset are both held', () => {
        holdFirstLayout();

        const tree   = new _Tree();
        const parent = new Container({ layoutManager: Fit(), components: [tree] });

        parent.getElement(true);
        parent.setSize({ width: 300, height: 120 });
        tree.setNodes(Array.from({ length: 200 }, (_, i) => ({ label: 'n' + i })));

        // Reveal first, then an explicit offset: the offset is the later
        // request, so it must survive rather than being overridden on replay.
        tree.selectNode(tree.getNodes()[150]);
        tree.setScrollY(0);

        releaseFirstLayout();
        flushFrame();

        const scroller = (tree as unknown as { _scroller: { getScrollY(): number } })._scroller;

        expect(scroller.getScrollY()).toBe(0);
    });

    it('lets a reveal win when it is the later of the two held requests', () => {
        holdFirstLayout();

        const tree   = new _Tree();
        const parent = new Container({ layoutManager: Fit(), components: [tree] });

        parent.getElement(true);
        parent.setSize({ width: 300, height: 120 });
        tree.setNodes(Array.from({ length: 200 }, (_, i) => ({ label: 'n' + i })));

        // The other order: a stale offset must not drag the view away from the
        // row the later reveal asked for.
        tree.setScrollY(0);
        tree.selectNode(tree.getNodes()[150]);

        releaseFirstLayout();
        flushFrame();

        const scroller  = (tree as unknown as { _scroller: { getScrollY(): number } })._scroller;
        const scrollY   = scroller.getScrollY();
        const rowTop    = 150 * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;

        expect(scrollY).toBeLessThanOrEqual(rowTop);
        expect(scrollY + tree.getHeight()).toBeGreaterThanOrEqual(rowBottom);
    });

    it('cancels an in-flight wheel ease even when the offset itself is held', () => {
        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([{ label: 'World' }]);
        flushFrame();

        const scroller  = (tree as unknown as { _scroller: { resetWheelEase(): void } })._scroller;
        const cancelled = vi.spyOn(scroller, 'resetWheelEase');

        holdFirstLayout();
        tree.setScrollY(500);

        // The offset waits for the gate, but the ease must not: it would keep
        // animating toward a target the programmatic scroll just replaced.
        expect(cancelled).toHaveBeenCalled();

        releaseFirstLayout();
        flushFrame();
    });

    it('lets a scroll made after the release supersede one held before it', () => {
        holdFirstLayout();

        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes(Array.from({ length: 200 }, (_, i) => ({ label: 'n' + i })));
        tree.setScrollY(1000);

        releaseFirstLayout();

        // This one is applied for real. The held offset must not come back and
        // revert it on the next render.
        tree.setScrollY(0);
        flushFrame();

        const scroller = (tree as unknown as { _scroller: { getScrollY(): number } })._scroller;

        expect(scroller.getScrollY()).toBe(0);
    });

    it('renders a tree once, not twice, on the frame the gate opens', () => {
        holdFirstLayout();

        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([{ label: 'World' }, { label: 'Hello' }]);

        const rendered = vi.spyOn(tree as unknown as { renderWindow(): void }, 'renderWindow');

        releaseFirstLayout();
        flushFrame();

        // The deferred pass renders the window, so the unconditional render in
        // Tree.doLayout must stand down rather than repeat it.
        expect(rendered).toHaveBeenCalledTimes(1);
    });

    it('refreshes the active descendant a deferred pass could not name', () => {
        holdFirstLayout();

        const tree = new _Tree();
        tree.getElement(true);
        tree.setWidth(300);
        tree.setHeight(120);
        tree.setNodes([{ label: 'World' }, { label: 'Hello' }]);

        // selectNode refreshes aria-activedescendant right after renderWindow.
        // With the pass deferred there are no rows yet, so the id it wants does
        // not exist and it can only write "".
        tree.selectNode(tree.getNodes()[0]);

        expect(tree.getAria().getActiveDescendant()).toBeFalsy();

        releaseFirstLayout();
        flushFrame();

        // Once the deferred pass has run the row exists, so the attribute must
        // name that row rather than staying empty until the next selection
        // change.
        const firstRow = (tree as unknown as { _rowPool: Array<{ getId(): string }> })._rowPool[0];

        expect(tree.getAria().getActiveDescendant()).toBe(firstRow.getId());
    });

    it('defers afterNextLayout callbacks until after the release', () => {
        const ran = vi.fn();

        holdFirstLayout();
        Component.afterNextLayout(ran);
        flushFrame();

        expect(ran).not.toHaveBeenCalled();

        releaseFirstLayout();
        flushFrame();

        expect(ran).toHaveBeenCalledTimes(1);
    });
});
