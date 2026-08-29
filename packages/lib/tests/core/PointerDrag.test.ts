// The two halves of a viewport drag have to move together: suppressing
// pointer events on every direct child of <html> also takes the drag handle
// out of hit-testing, so unless the document element picks the cursor up, the
// pointer reverts to the default arrow for the duration of the drag. Direct
// children of <html>, not just <body>: a Window (and a Drawer, and any
// LayerManager-hosted overlay) attaches straight to document.documentElement,
// outside <body>'s subtree, so suppressing only <body> would leave a window's
// own content hit-testable and able to steal the cursor back mid-drag — the
// bug this rule exists to close. These tests pin that pairing — a change that
// drops either half reintroduces a reverting-cursor bug.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { beginPointerDrag, endPointerDrag, beginViewportDrag, endViewportDrag } from '~/core/PointerDrag';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const SUPPRESS_SELECTOR = 'html.ts-ui-dragging > *';

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/**
 * The last `apply` patch written to the named element, or undefined when it
 * was never touched. Handles are minted per source call, so a recorded write
 * is matched back to its element by tag rather than by handle identity.
 *
 * @param tag - The upper-case tag name to look for ("HTML").
 */
function patchFor(tag: string): { addClass?: string[]; removeClass?: string[]; style?: Record<string, string> } | undefined {
    const match = sink.writes
        .filter(w => w.op === 'apply')
        .reverse()
        .find(w => DOM.source.getTagName(w.args[0] as Handle) === tag);

    return match?.args[1] as { addClass?: string[]; removeClass?: string[]; style?: Record<string, string> } | undefined;
}

describe('beginPointerDrag', () => {
    it('adds the dragging class and pins the cursor on the document element', () => {
        beginPointerDrag('ew-resize');

        const patch = patchFor('HTML');
        expect(patch?.addClass).toEqual(['ts-ui-dragging']);
        expect(patch?.style).toEqual({ cursor: 'ew-resize' });
    });

    it('registers the shared html.ts-ui-dragging > * suppression rule', () => {
        beginPointerDrag('ew-resize');

        expect(_ruleCacheHas(SUPPRESS_SELECTOR)).toBe(true);
    });

    it('holds whatever cursor the caller names', () => {
        beginPointerDrag('nwse-resize');

        expect(patchFor('HTML')?.style).toEqual({ cursor: 'nwse-resize' });
    });
});

describe('endPointerDrag', () => {
    it('removes the dragging class and releases the cursor', () => {
        beginPointerDrag('ns-resize');
        sink.writes.length = 0;

        endPointerDrag();

        const patch = patchFor('HTML');
        expect(patch?.removeClass).toEqual(['ts-ui-dragging']);
        expect(patch?.style).toEqual({ cursor: '' });
    });

    it('is safe without a matching begin — it only clears the class and cursor', () => {
        endPointerDrag();

        const patch = patchFor('HTML');
        expect(patch?.removeClass).toEqual(['ts-ui-dragging']);
        expect(patch?.style).toEqual({ cursor: '' });
    });
});

// WindowBorder and SplitGutter both wrap the same five-listener viewport-drag
// lifecycle (mouseup/touchend/touchcancel -> stop, mousemove/touchmove ->
// move) around beginPointerDrag/endPointerDrag — these tests pin that shared
// wrapper directly, independent of either call site.
describe('beginViewportDrag / endViewportDrag', () => {
    it('pins the dragging class and cursor on the document element, mirroring beginPointerDrag', () => {
        const component = new Component({});
        component.getElement(true);
        const move = (): void => {};
        const stop = (): Event.ListenerResult => true;

        beginViewportDrag(component, move, stop, 'ew-resize');

        const patch = patchFor('HTML');
        expect(patch?.addClass).toEqual(['ts-ui-dragging']);
        expect(patch?.style).toEqual({ cursor: 'ew-resize' });

        endViewportDrag(component, move, stop);
    });

    it('invokes the move listener on mousemove/touchmove and the stop listener on mouseup/touchend/touchcancel', () => {
        const component = new Component({});
        component.getElement(true);

        let moveCount = 0;
        let stopCount = 0;
        const move = (): void => { moveCount++; };
        const stop = (): Event.ListenerResult => { stopCount++; return true; };

        beginViewportDrag(component, move, stop, 'ew-resize');

        const el = component.getElement()!;
        DOM.sink.dispatchEvent(el, makeEvent(el, 'mousemove'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchmove'));
        expect(moveCount).toBe(2);

        DOM.sink.dispatchEvent(el, makeEvent(el, 'mouseup'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchend'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchcancel'));
        expect(stopCount).toBe(3);

        endViewportDrag(component, move, stop);
    });

    it('removes all five listeners and clears the dragging class / cursor', () => {
        const component = new Component({});
        component.getElement(true);

        let moveCount = 0;
        let stopCount = 0;
        const move = (): void => { moveCount++; };
        const stop = (): Event.ListenerResult => { stopCount++; return true; };

        beginViewportDrag(component, move, stop, 'ew-resize');
        endViewportDrag(component, move, stop);

        const el = component.getElement()!;
        DOM.sink.dispatchEvent(el, makeEvent(el, 'mousemove'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchmove'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'mouseup'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchend'));
        DOM.sink.dispatchEvent(el, makeEvent(el, 'touchcancel'));

        expect(moveCount).toBe(0);
        expect(stopCount).toBe(0);

        const patch = patchFor('HTML');
        expect(patch?.removeClass).toEqual(['ts-ui-dragging']);
        expect(patch?.style).toEqual({ cursor: '' });
    });
});
