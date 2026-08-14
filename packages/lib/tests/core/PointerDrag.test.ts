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
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { beginPointerDrag, endPointerDrag } from '~/core/PointerDrag';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
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
