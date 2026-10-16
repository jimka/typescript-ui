// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins what happens to a drag session whose source is destroyed. The session's
// mousemove / mouseup listeners are registered against the source, and the
// source's teardown purges them, so without an explicit end the session would
// stay open for the life of the page: the ghost stays on screen and no other
// drag can start. The session is abandoned instead, and the source hears
// neither "dragend" nor onDragEnd (a release over empty space is what tears a
// tab off into a new window). See plans/implemented/references-to-disposed-components.md.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DragManager, tabDragRegistry, type DragEventDetail } from '~/overlay/DragManager';
import { DragGhost } from '~/overlay/DragGhost';
import { Component } from '~/core/Component';
import { Event } from '~/core/Event';
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

let frames: Map<number, FrameRequestCallback> = new Map();
let nextFrameHandle = 1;

beforeEach(() => {
    installTestDOM(CONFIG);
    frames          = new Map();
    nextFrameHandle = 1;
    (DOM.sink as any).requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const handle = nextFrameHandle++;

        frames.set(handle, callback);

        return handle;
    };
    (DOM.sink as any).cancelAnimationFrame = (handle: number): void => {
        frames.delete(handle);
    };
});

/** Runs every queued animation frame once; applies a buffered pointer move to the drop target. */
function drainFrames(): void {
    const pending = Array.from(frames.values());

    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

// The teardown closures kept from makeDragSource. Event.ts caches "already
// installed" per event type for the life of the module, so each source's
// registration has to be removed for the next test's fresh sink to get its
// window-level listener back.
let teardowns: Array<() => void> = [];

afterEach(() => {
    DragManager.cancel();

    for (const teardown of teardowns) {
        teardown();
    }

    teardowns = [];
    DOM.reset();
});

interface SourceSpies {
    onDragEnd: ReturnType<typeof vi.fn<(detail: DragEventDetail, dropped: boolean) => void>>;
    dragend:   ReturnType<typeof vi.fn<() => void>>;
}

interface DragSourceSetup {
    dragData?:    Record<string, unknown>;
    /** Runs inside `onDragEnd`, after the spy records the call. */
    onDragEndHook?: () => void;
}

/** A registered, rendered and sized drag source, with spies on its two end notifications. */
function dragSource(setup: DragSourceSetup = {}): { source: Component; spies: SourceSpies } {
    const source = new Component();

    source.getElement(true);
    source.setWidth(100);
    source.setHeight(100);

    const spies: SourceSpies = {
        onDragEnd: vi.fn<(detail: DragEventDetail, dropped: boolean) => void>(),
        dragend:   vi.fn<() => void>(),
    };

    teardowns.push(DragManager.makeDragSource(source, {
        dragData:  setup.dragData ?? { row: 1 },
        onDragEnd: (detail: DragEventDetail, dropped: boolean): void => {
            spies.onDragEnd(detail, dropped);
            setup.onDragEndHook?.();
        },
    }));
    Event.addListener(source, 'dragend', spies.dragend);

    return { source, spies };
}

/**
 * A registered drop target spanning `(x, y)` to `(x + width, y + height)`.
 *
 * @param onDragLeave - Called when the pointer leaves the target or the session is abandoned over it.
 */
function dropTarget(x: number, y: number, width: number, height: number, onDrop: () => void, onDragLeave?: () => void): void {
    const target = new Component();

    target.getElement(true);
    target.setX(x);
    target.setY(y);
    target.setWidth(width);
    target.setHeight(height);
    target.doLayout();

    teardowns.push(DragManager.makeDropTarget(target, {
        accepts: (): boolean => true,
        onDrop,
        onDragLeave,
    }));
}

/** Dispatches a mouse event of `type` at `(clientX, clientY)` on `element`. */
function fire(type: string, element: Handle, clientX: number, clientY: number): void {
    const event = makeEvent(element, type) as unknown as Record<string, unknown>;

    event.clientX = clientX;
    event.clientY = clientY;
    event.button  = 0;
    DOM.sink.dispatchEvent(element, event as never);
}

/** Presses at (10, 10) and moves to (100, 100), committing a drag. */
function commitDrag(source: Component): Handle {
    const element = source.getElement()!;

    fire('mousedown', element, 10, 10);
    fire('mousemove', element, 100, 100);

    return element;
}

describe('DragManager — source destroyed mid-drag', () => {
    it('S1: disposing the source ends the session', () => {
        const { source } = dragSource();

        commitDrag(source);
        expect(DragManager.isDragging()).toBe(true);

        source.dispose();

        expect(DragManager.isDragging()).toBe(false);
    });

    it('S2: another source can drag after the first was disposed', () => {
        const first = dragSource();

        commitDrag(first.source);
        first.source.dispose();

        const second  = dragSource();
        const element = commitDrag(second.source);

        fire('mouseup', element, 900, 900);

        expect(second.spies.onDragEnd).toHaveBeenCalledTimes(1);
    });

    it('S3: the disposed source hears neither dragend nor onDragEnd', () => {
        const { source, spies } = dragSource();

        commitDrag(source);
        source.dispose();

        expect(DragManager.isDragging()).toBe(false);
        expect(spies.dragend).not.toHaveBeenCalled();
        expect(spies.onDragEnd).not.toHaveBeenCalled();
    });

    it('S4: control: releasing over nothing reports onDragEnd with dropped false', () => {
        const draggingInEnd: boolean[] = [];
        const { source, spies } = dragSource({
            onDragEndHook: () => draggingInEnd.push(DragManager.isDragging()),
        });
        const element = commitDrag(source);

        fire('mouseup', element, 900, 900);

        // The session is cleared before the source is told.
        expect(draggingInEnd).toEqual([false]);
        expect(spies.onDragEnd).toHaveBeenCalledTimes(1);
        expect(spies.onDragEnd.mock.calls[0][1]).toBe(false);
        expect(DragManager.isDragging()).toBe(false);
    });

    it('S5: a drop handler that disposes the source ends the session without throwing', () => {
        const { source, spies } = dragSource();

        dropTarget(50, 50, 400, 400, () => source.dispose());

        const element = commitDrag(source);

        expect(() => fire('mouseup', element, 100, 100)).not.toThrow();
        expect(DragManager.isDragging()).toBe(false);
        expect(spies.onDragEnd).not.toHaveBeenCalled();
    });

    it('S6: a source disposed inside its own onDragEnd leaves the target exactly drop then end', () => {
        const order: string[] = [];
        const { source } = dragSource({
            onDragEndHook: () => {
                order.push('end');
                source.dispose();
            },
        });

        dropTarget(50, 50, 400, 400, () => order.push('drop'), () => order.push('leave'));

        const ghostDispose = vi.spyOn(DragGhost.prototype, 'dispose');
        const element      = commitDrag(source);

        drainFrames();
        fire('mouseup', element, 100, 100);

        expect(order).toEqual(['drop', 'end']);
        expect(ghostDispose).toHaveBeenCalledTimes(1);
        expect(DragManager.isDragging()).toBe(false);
    });

    it('S7: abandoning over a drop target tells that target onDragLeave once', () => {
        const { source } = dragSource();
        const onDragLeave = vi.fn();

        dropTarget(50, 50, 400, 400, () => undefined, onDragLeave);
        commitDrag(source);
        drainFrames();

        expect(onDragLeave).not.toHaveBeenCalled();

        source.dispose();

        expect(onDragLeave).toHaveBeenCalledTimes(1);
    });

    it('S8: abandoning a tab drag drops its content from the tab drag registry', () => {
        const content = new Component();
        const { source } = dragSource({
            dragData: { tabDrag: true, sourceTabId: 'bar', componentId: 'content-1', label: 'T' },
        });

        tabDragRegistry.set('content-1', content);
        commitDrag(source);

        expect(tabDragRegistry.has('content-1')).toBe(true);

        source.dispose();

        expect(tabDragRegistry.has('content-1')).toBe(false);
    });

    it('S9: disposing the source of a pressed but uncommitted session ends it', () => {
        const first   = dragSource();
        const element = first.source.getElement()!;

        fire('mousedown', element, 10, 10);   // below the movement threshold: pending only
        first.source.dispose();

        // A press on another source is ignored while any session is open.
        const second = dragSource();

        commitDrag(second.source);

        expect(DragManager.isDragging()).toBe(true);
    });
});
