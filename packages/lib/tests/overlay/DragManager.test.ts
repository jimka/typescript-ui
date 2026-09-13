//
// SCOPE: only the DOM-free surface of DragManager is exercised here — the
// idle-state queries and the registry add + teardown closure. This file used
// to claim the move / drop / drag-start choreography was UNTESTABLE offline
// (dispatchEvent recording without invoking listeners, elementsFromPoint
// returning `[]`); neither is true of the current TestDOM.ts. The full
// gesture is reachable via `makeEvent` + `DOM.sink.dispatchEvent` against a
// registered drop target — see DragManager.repeatedDragDisposal.test.ts,
// DragManager.styleRuleDisposal.test.ts, and DragManager.pointerCoalescing.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { DragManager } from '~/overlay/DragManager';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('DragManager (idle / registry surface)', () => {
    afterEach(() => DOM.reset());

    it('isDragging() is false at rest', () => {
        installTestDOM(CONFIG);

        expect(DragManager.isDragging()).toBe(false);
    });

    it('cancel() is a no-op when idle (does not throw, stays not-dragging)', () => {
        installTestDOM(CONFIG);

        expect(() => DragManager.cancel()).not.toThrow();
        expect(DragManager.isDragging()).toBe(false);
    });

    it('makeDragSource returns a teardown closure', () => {
        installTestDOM(CONFIG);

        const source   = new Component();
        const teardown = DragManager.makeDragSource(source, { dragData: { id: 1 } });

        expect(typeof teardown).toBe('function');
        // Tearing down does not throw and leaves the manager idle.
        expect(() => teardown()).not.toThrow();
        expect(DragManager.isDragging()).toBe(false);
    });

    it('makeDropTarget returns a teardown closure', () => {
        installTestDOM(CONFIG);

        const target   = new Component();
        const teardown = DragManager.makeDropTarget(target, { accepts: () => true });

        expect(typeof teardown).toBe('function');
        expect(() => teardown()).not.toThrow();
    });

    it('re-registering a source after teardown is a fresh registration (no throw)', () => {
        installTestDOM(CONFIG);

        const source = new Component();

        const t1 = DragManager.makeDragSource(source, { dragData: {} });
        t1();

        // A second registration on the same component id behaves like a fresh
        // one — the teardown removed the prior record.
        const t2 = DragManager.makeDragSource(source, { dragData: {} });

        expect(typeof t2).toBe('function');

        t2();
    });
});
