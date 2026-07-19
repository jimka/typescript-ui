// The two halves of a viewport drag have to move together: suppressing body
// pointer events also takes the drag handle out of hit-testing, so unless the
// document element picks the cursor up, the pointer reverts to the default
// arrow for the duration of the drag. These tests pin that pairing — a change
// that drops either half reintroduces the reverting-cursor bug.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { beginPointerDrag, endPointerDrag } from '~/core/PointerDrag';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/**
 * The style patch written to the named element, or undefined when it was never
 * touched. Handles are minted per source call, so a recorded write is matched
 * back to its element by tag rather than by handle identity.
 *
 * @param tag - The upper-case tag name to look for ("BODY" / "HTML").
 */
function styleFor(tag: string): Record<string, string> | undefined {
    const match = sink.writes
        .filter(w => w.op === 'apply')
        .find(w => DOM.source.getTagName(w.args[0] as Handle) === tag
                && (w.args[1] as { style?: unknown }).style !== undefined);

    return (match?.args[1] as { style?: Record<string, string> })?.style;
}

describe('beginPointerDrag', () => {
    it('suppresses body pointer events and pins the cursor on the document element', () => {
        beginPointerDrag('ew-resize');

        expect(styleFor('BODY')).toEqual({ pointerEvents: 'none' });
        // The document element, not body: body is the element being made
        // unhittable, so a cursor parked there would never win a hit test.
        expect(styleFor('HTML')).toEqual({ cursor: 'ew-resize' });
    });

    it('holds whatever cursor the caller names', () => {
        beginPointerDrag('nwse-resize');

        expect(styleFor('HTML')).toEqual({ cursor: 'nwse-resize' });
    });
});

describe('endPointerDrag', () => {
    it('restores body pointer events and releases the cursor', () => {
        beginPointerDrag('ns-resize');
        sink.writes.length = 0;

        endPointerDrag();

        expect(styleFor('BODY')).toEqual({ pointerEvents: '' });
        expect(styleFor('HTML')).toEqual({ cursor: '' });
    });

    it('is safe without a matching begin — it only clears inline values', () => {
        endPointerDrag();

        expect(styleFor('BODY')).toEqual({ pointerEvents: '' });
        expect(styleFor('HTML')).toEqual({ cursor: '' });
    });
});
