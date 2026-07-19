//
// SCOPE: only the DOM-free surface of DragManager is exercised here. The
// move / drop / drag-start choreography is UNTESTABLE on the offline harness —
// the gesture is driven by `onSourceMouseDown` (a subtree mousedown listener)
// plus viewport `mousemove` / `mouseup`, and the recording sink records
// `dispatchEvent` without invoking any listener (TestDOM.ts:217); drop-target
// hit-testing depends on `elementsFromPoint`, which returns `[]` offline
// (TestDOM.ts:563). So drag-start, ghost follow, target enter/leave, and drop
// cannot be reached. See the plan's ## Non-Goals. What stays assertable: the
// idle-state queries and the registry add + teardown closure.
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
