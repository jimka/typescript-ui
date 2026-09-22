// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins DragManager's pointer-move coalescing. onMouseMove used to re-run
// pickDropTarget (a forced-layout elementsFromPoint hit test) and the full
// enter/leave/onDragOver dispatch on every raw mousemove during a drag; both
// shipped onDragOver consumers (TabBar.updateReorderSlot, DockRegion.computeZone)
// force a second layout flush of their own on top of that. scheduleMove /
// flushMove now buffer the latest pointer position and resolve the drop
// target at most once per animation frame — mirroring Split's own
// scheduleDrag and its per-frame drag session — while the ghost's own reposition stays inline and
// unthrottled since it is two cheap setX/setY writes. See
// plans/implemented/dragmanager-pointer-coalescing.md.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DragManager, type DragEventDetail } from '~/overlay/DragManager';
import { DragGhost } from '~/overlay/DragGhost';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The offline sink drops requestAnimationFrame / cancelAnimationFrame (see
// DOMSink); captured here keyed by an incrementing handle, with a
// cancelAnimationFrame override that actually deletes the entry — a no-op
// override (as ScrollRebindLayoutEconomy.test.ts uses, where nothing ever
// cancels) would let the cancel() case below pass vacuously, since it must
// prove the buffered frame was removed, not merely never invoked.
let nextFrameHandle = 1;
let frames: Map<number, FrameRequestCallback> = new Map();

beforeEach(() => {
    installTestDOM(CONFIG);
    nextFrameHandle = 1;
    frames = new Map();
    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;
        frames.set(handle, callback);

        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});

// Torn down by afterEach below — see dragSource()'s doc comment for why this
// is required in a file with more than one full-gesture test.
let tearDownSource: (() => void) | null = null;

// activeSession is module-level state in DragManager.ts that outlives
// DOM.reset() (same gotcha DragManager.repeatedDragDisposal.test.ts notes for
// Event's viewportListenerMap) — several cases below deliberately end a test
// mid-drag (an un-drained buffered move), so a stray committed session would
// otherwise block the next test's own onSourceMouseDown from starting one.
//
// tearDownSource matters for a second, file-wide reason: Event.ts's
// installBaseListener caches "already installed" per event type for the life
// of the module, but installTestDOM() swaps in a brand-new sink every test —
// so unless the *last* mousedown subtree registration is actually removed
// (Event.removeSubtreeListener, reached through makeDragSource's own teardown
// closure below), that cache never clears and the second test's fresh sink
// never gets the window-level listener re-attached, so its press silently
// goes nowhere. makeDropTarget needs no such teardown: drop targets are plain
// hit-tested data, not wired through Event's listener maps.
afterEach(() => {
    DragManager.cancel();
    tearDownSource?.();
    tearDownSource = null;
    DOM.reset();
});

/** Runs every currently-queued animation frame once, then clears the queue. */
function drainFrames(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/**
 * A registered drag source, rendered and sized so it can be dragged. Stashes
 * its teardown closure in `tearDownSource` for `afterEach` to call — see the
 * comment above `afterEach` for why that matters in this file.
 */
function dragSource(): Component {
    const source = new Component();

    source.getElement(true);
    source.setWidth(100);
    source.setHeight(100);

    tearDownSource = DragManager.makeDragSource(source, { dragData: { row: 1 } });

    return source;
}

/** Spy handles for one registered drop target's callbacks. */
interface TargetSpies {
    onDragOver:  ReturnType<typeof vi.fn<(detail: DragEventDetail) => number | null | void>>;
    onDragLeave: ReturnType<typeof vi.fn<(detail: DragEventDetail) => void>>;
    onDrop:      ReturnType<typeof vi.fn<(detail: DragEventDetail) => boolean | void>>;
}

/**
 * A registered drop target spanning `(x, y)` to `(x + width, y + height)`,
 * with spied callbacks so a test can assert per-target call counts.
 */
function dropTarget(x: number, y: number, width: number, height: number): TargetSpies {
    const target = new Component();

    target.getElement(true);
    target.setX(x);
    target.setY(y);
    target.setWidth(width);
    target.setHeight(height);
    target.doLayout();

    const spies: TargetSpies = {
        onDragOver:  vi.fn<(detail: DragEventDetail) => number | null | void>(),
        onDragLeave: vi.fn<(detail: DragEventDetail) => void>(),
        onDrop:      vi.fn<(detail: DragEventDetail) => boolean | void>(),
    };

    DragManager.makeDropTarget(target, {
        accepts:     (): boolean => true,
        onDragOver:  spies.onDragOver,
        onDragLeave: spies.onDragLeave,
        onDrop:      spies.onDrop,
    });

    return spies;
}

/** Dispatches a `mousedown` at `(clientX, clientY)` on `element`. */
function press(element: Handle, clientX: number, clientY: number): void {
    const event = makeEvent(element, 'mousedown') as unknown as Record<string, unknown>;

    event.clientX = clientX;
    event.clientY = clientY;
    event.button  = 0;
    DOM.sink.dispatchEvent(element, event as never);
}

/** Dispatches a `mousemove` at `(clientX, clientY)` on `element`. */
function move(element: Handle, clientX: number, clientY: number): void {
    const event = makeEvent(element, 'mousemove') as unknown as Record<string, unknown>;

    event.clientX = clientX;
    event.clientY = clientY;
    DOM.sink.dispatchEvent(element, event as never);
}

/** Dispatches a `mouseup` at `(clientX, clientY)` on `element`. */
function release(element: Handle, clientX: number, clientY: number): void {
    const event = makeEvent(element, 'mouseup') as unknown as Record<string, unknown>;

    event.clientX = clientX;
    event.clientY = clientY;
    DOM.sink.dispatchEvent(element, event as never);
}

describe('DragManager pointer-move coalescing', () => {
    it('buffers a burst of raw mousemoves to a single animation frame and calls no target callback until it drains', () => {
        const source  = dragSource();
        const target  = dropTarget(50, 50, 400, 400);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60); // crosses the threshold and commits: schedules scheduleMove's frame

        // Baseline after the commit move, not a literal 1 — DragGhost.show()'s
        // own scheduleLayout() also lands in this same requestAnimationFrame
        // override (the framework's unrelated coalesced-layout queue), so the
        // count includes that alongside scheduleMove's frame. What this case
        // pins is that the *next two* raw moves add nothing further.
        const afterCommit = frames.size;

        move(element, 70, 70);
        move(element, 90, 90);

        expect(frames.size).toBe(afterCommit);
        expect(target.onDragOver).not.toHaveBeenCalled();
    });

    it('draining applies only the latest buffered position', () => {
        const source  = dragSource();
        const target  = dropTarget(50, 50, 400, 400);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60);
        move(element, 70, 70);
        move(element, 90, 90);
        drainFrames();

        expect(target.onDragOver).toHaveBeenCalledTimes(1);
        expect(target.onDragOver.mock.calls[0][0]).toMatchObject({ clientX: 90, clientY: 90 });
    });

    it("a pointer that visits a second target and returns within one un-drained burst never touches the second target's callbacks", () => {
        const source  = dragSource();
        const target1 = dropTarget(50, 50, 400, 400);
        const target2 = dropTarget(600, 600, 100, 100);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60);
        move(element, 70, 70);
        move(element, 90, 90);
        drainFrames();

        // Enters and leaves Target 2 between two animation frames — never
        // drained while the pointer is actually over it.
        move(element, 650, 650);
        move(element, 90, 90);
        drainFrames();

        expect(target1.onDragOver).toHaveBeenCalledTimes(2);
        expect(target1.onDragLeave).not.toHaveBeenCalled();
        expect(target2.onDragOver).not.toHaveBeenCalled();
        expect(target2.onDragLeave).not.toHaveBeenCalled();
    });

    it("mouseup flushes a still-buffered move before deciding the drop, using the buffered position rather than the release event's own coordinates", () => {
        const source  = dragSource();
        const target  = dropTarget(50, 50, 400, 400);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60); // schedules a frame; not drained

        release(element, 900, 900); // outside every target

        expect(target.onDrop).toHaveBeenCalledTimes(1);
        expect(DragManager.isDragging()).toBe(false);
    });

    it('cancel() cancels a pending frame without flushing it', () => {
        const source  = dragSource();
        const target  = dropTarget(50, 50, 400, 400);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60); // schedules scheduleMove's frame; not drained

        // Not asserted as a literal frame count — see the "buffers a burst"
        // case above for why an unrelated framework frame can share this same
        // requestAnimationFrame override. What matters here is the delta:
        // cancelling removes exactly the one frame scheduleMove armed.
        const beforeCancel = frames.size;

        DragManager.cancel();

        // The Map-based override proves the frame was actually removed, not
        // merely unreached — a no-op cancelAnimationFrame would leave the size
        // unchanged.
        expect(frames.size).toBe(beforeCancel - 1);
        expect(target.onDragOver).not.toHaveBeenCalled();
        expect(target.onDragLeave).not.toHaveBeenCalled();
        expect(DragManager.isDragging()).toBe(false);

        drainFrames();

        expect(target.onDragOver).not.toHaveBeenCalled();
        expect(target.onDragLeave).not.toHaveBeenCalled();
    });

    it('repositions the ghost on every raw move, decoupled from target resolution', () => {
        const moveToSpy = vi.spyOn(DragGhost.prototype, 'moveTo');

        const source  = dragSource();
        const target  = dropTarget(50, 50, 400, 400);
        const element = source.getElement()!;

        press(element, 10, 10);
        move(element, 60, 60);
        move(element, 70, 70);
        move(element, 90, 90);

        expect(moveToSpy).toHaveBeenCalledTimes(3);
        expect(target.onDragOver).not.toHaveBeenCalled();

        moveToSpy.mockRestore();
    });
});
