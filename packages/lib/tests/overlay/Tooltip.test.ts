import { describe, it, expect, afterEach } from 'vitest';
import { Tooltip } from '~/overlay/Tooltip';
import { LayerManager } from '~/core/LayerManager';
import { Component } from '~/core/Component';
import { Util } from '~/core/Util';
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

// Contract constants mirrored from Tooltip (private statics). These are
// documented sizing constants, not magic positioning px.
const H_PADDING   = 16;
const V_PADDING   = 8;
const MAX_WIDTH   = 300;
const ITEM_HEIGHT = 20;
// The tooltip's own 1px border. Its label is laid out inside the content box,
// so the outer box carries the text box plus this perimeter; MAX_WIDTH remains
// an outer cap.
const CHROME_W    = 2;
const CHROME_H    = 2;

// The cursor clearance box, mirrored from Tooltip's private statics. It is
// anchored on the pointer hotspot and asymmetric about it, because the glyph
// hangs down-right of the hotspot — see Tooltip.ts for the reasoning.
const CURSOR_LEFT  = 4;
const CURSOR_RIGHT = 12;
const CURSOR_UP    = 0;
const CURSOR_DOWN  = 12;
const CURSOR_GAP   = 2;

// Placement offsets derived from the box: how far past the cursor the tooltip's
// near edge sits when it fits, and how far before the cursor its far edge sits
// when it flips. The unflipped 14 is unchanged from the point-anchored version;
// the flipped sides are tighter, since no glyph reaches up or far left of the
// hotspot to clear.
const PAST_X   = CURSOR_RIGHT + CURSOR_GAP;
const PAST_Y   = CURSOR_DOWN  + CURSOR_GAP;
const BEFORE_X = CURSOR_LEFT  + CURSOR_GAP;
const BEFORE_Y = CURSOR_UP    + CURSOR_GAP;

// The modelled source measures a single line: height = ceil(ascent + descent).
// `_perLineHeight()` ceils that, so per-line === measured single-line height.
function perLine(): number {
    return Math.ceil(DOM.source.measureText('X').height);
}

// Reaches the singleton instance to read its committed width/height.
function inst(): { getWidth(): number; getHeight(): number } {
    return (Tooltip as any).getInstance();
}

describe('Tooltip.show', () => {
    afterEach(() => {
        // The singleton instance + showTimer survive DOM.reset(); clear the timer
        // so a pending show can't leak into the next test, and drop the cached
        // instance so the next show() rebuilds its element handles against the
        // fresh handle table installTestDOM mints (the old handles point into the
        // discarded table and would throw "handle not registered").
        const timer = (Tooltip as any).showTimer;

        if (timer !== null) {
            clearTimeout(timer);
            (Tooltip as any).showTimer = null;
        }

        (Tooltip as any).instance = null;
        (Tooltip as any).watching = false;
        (Tooltip as any).activeElement = null;

        DOM.reset();
    });

    it('sizes width to the widest line plus horizontal padding (capped at MAX_WIDTH)', () => {
        installTestDOM(CONFIG);

        const text       = 'Hello';
        const widestLine = Util.measureTextWidth(text);

        Tooltip.show(text, 100, 100);

        expect(inst().getWidth()).toBe(Math.min(MAX_WIDTH, widestLine + H_PADDING + CHROME_W));
    });

    it('floors a single-line tooltip height to ITEM_HEIGHT + V_PADDING', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        // lineCount === 1, so height = max(1*perLine + V_PADDING,
        // ITEM_HEIGHT + V_PADDING). With perLine (16) < ITEM_HEIGHT (20) the
        // floor wins.
        const expected = Math.max(perLine() + V_PADDING, ITEM_HEIGHT + V_PADDING) + CHROME_H;

        expect(inst().getHeight()).toBe(expected);
    });

    it('a multi-line label hugs the widest line and tracks the line count', () => {
        installTestDOM(CONFIG);

        // Three explicit lines; "Hello" is the widest.
        const text = 'He\nHello\nlo';

        Tooltip.show(text, 100, 100);

        const widestLine = Util.measureTextWidth('Hello');

        expect(inst().getWidth()).toBe(Math.min(MAX_WIDTH, widestLine + H_PADDING + CHROME_W));
        // Height tracks the 3 explicit lines (no floor — multi-line path).
        expect(inst().getHeight()).toBe(3 * perLine() + V_PADDING + CHROME_H);
    });

    it('caps the width at MAX_WIDTH for over-wide text', () => {
        installTestDOM(CONFIG);

        // 24 'W's: 24 * advance(W=12) = 288, and 288 + H_PADDING > MAX_WIDTH,
        // so the width caps at MAX_WIDTH.
        const text = 'W'.repeat(24);

        expect(Util.measureTextWidth(text) + H_PADDING).toBeGreaterThan(MAX_WIDTH);

        Tooltip.show(text, 100, 100);

        expect(inst().getWidth()).toBe(MAX_WIDTH);
    });

    it('renders above the Dialog layer band so it shows over a modal', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        // A tooltip is a transient, non-interactive affordance that must float
        // over every managed layer — including a modal Dialog and its backdrop.
        expect((inst() as any).getZIndex()).toBeGreaterThan(LayerManager.Band.Dialog);
    });

    it('dismisses when its anchor element leaves the DOM', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        // An anchor that was never appended to the document is disconnected.
        const orphan = new Component({});
        const el = orphan.getElement(true)!;
        (Tooltip as any).activeElement = el;

        expect(DOM.source.isConnected(el)).toBe(false);

        // Simulate the pointer-move anchor watch firing.
        (Tooltip as any)._onAnchorWatch();

        // hide() ran: the active anchor is forgotten.
        expect((Tooltip as any).activeElement).toBeNull();
    });

    it('does not dismiss a tooltip that has no tracked anchor', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);
        // show() installs the anchor watch.
        expect((Tooltip as any).watching).toBe(true);

        (Tooltip as any).activeElement = null;

        (Tooltip as any)._onAnchorWatch();

        // No anchor to check → no hide; the watch stays installed.
        expect((Tooltip as any).watching).toBe(true);
    });

    it('clamps x and y to >= 0 for negative coordinates', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', -100, -100);

        // x/y are floored at 0 regardless of the negative input.
        expect(inst()).toBeDefined();
        expect((inst() as any).getX()).toBeGreaterThanOrEqual(0);
        expect((inst() as any).getY()).toBeGreaterThanOrEqual(0);
    });

    it('flips a tooltip at the far viewport corner so it ends just before the cursor', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 99999, 99999);

        const w = inst().getWidth();
        const h = inst().getHeight();

        // The cursor clamps to (1280, 800), then both axes flip: there is no
        // room past the cursor, so the tooltip's far edge ends before it rather
        // than growing off-screen or landing under the cursor.
        expect((inst() as any).getX()).toBe(CONFIG.viewport.width - w - BEFORE_X);
        expect((inst() as any).getY()).toBe(CONFIG.viewport.height - h - BEFORE_Y);
    });

    it('sits past the cursor when both axes fit (bit-identical to the point-anchored version)', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        expect((inst() as any).getX()).toBe(100 + PAST_X);
        expect((inst() as any).getY()).toBe(100 + PAST_Y);
    });

    it('flips horizontally near the right edge so the right edge clears the cursor by BEFORE_X (report 2)', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 1270, 100);

        const w = inst().getWidth();

        // BEFORE_X, not PAST_X: the glyph reaches only CURSOR_LEFT px left of the
        // hotspot, so a flipped tooltip hugs the cursor instead of standing off it
        // by the full unflipped distance.
        expect((inst() as any).getX()).toBe(1270 - w - BEFORE_X);
    });

    it('flips vertically near the bottom edge so the bottom edge clears the cursor by BEFORE_Y (report 2)', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 790);

        const h = inst().getHeight();

        // Nothing at all sits above the hotspot (CURSOR_UP is 0), so a tooltip
        // flipped above the cursor stands off it by only the bare gap.
        expect((inst() as any).getY()).toBe(790 - h - BEFORE_Y);
    });

    it('report-2 invariant: the cursor point is never inside the tooltip rect, for any in-viewport cursor', () => {
        installTestDOM(CONFIG);

        for (const x of [0, 320, 640, 960, 1279]) {
            for (const y of [0, 200, 400, 600, 799]) {
                Tooltip.show('Hi', x, y);

                const tx = (inst() as any).getX();
                const ty = (inst() as any).getY();
                const w  = inst().getWidth();
                const h  = inst().getHeight();

                const cursorInside = x >= tx && x <= tx + w && y >= ty && y <= ty + h;

                expect(cursorInside).toBe(false);
            }
        }
    });

    // NOTE (offline harness limit): the contract clause "when the widest line
    // exceeds MAX_WIDTH the visual line count is derived from the wrapped
    // measureText({maxWidth}) height" (Tooltip.ts:169-175) is NOT assertable
    // offline. The modelled `measureText` ignores `maxWidth` (TestDOM.ts:356) and
    // never soft-wraps, so wrappedHeight is always one line and lineCount stays
    // at the `\n`-split count. Width capping (above) is the assertable half.
});

describe('Tooltip.attach — teardown', () => {
    afterEach(() => {
        (Tooltip as any).instance = null;
        (Tooltip as any).watching = false;
        (Tooltip as any).activeElement = null;
        DOM.reset();
    });

    it('releases the attachment when the attached component is destroyed', () => {
        installTestDOM(CONFIG);

        const c = new Component({});
        c.getElement(true);

        Tooltip.attach(c, 'Hi');
        expect((Tooltip as any).attachments.has(c.getId())).toBe(true);

        c.dispose();

        // Regression: `Tooltip.attach` used to have no teardown hook at all,
        // so a destroyed component's attachment — and the closures capturing
        // it — lived in this static map forever, pinning the component (and,
        // via `_parent`, its whole ancestor chain) off the heap permanently.
        expect((Tooltip as any).attachments.has(c.getId())).toBe(false);
    });

    it('does not register a duplicate teardown hook across repeated attach() calls on the same component', () => {
        installTestDOM(CONFIG);

        const c = new Component({});
        c.getElement(true);

        Tooltip.attach(c, 'One');
        Tooltip.attach(c, 'Two');
        Tooltip.attach(c, 'Three');

        // A second/third attach() replaces the map entry (via attach's own
        // internal detach()) but must not stack extra onDestroy closures —
        // detach() is idempotent, so a stacked duplicate would be harmless
        // in effect but would still mean the guard isn't doing its job.
        // Baseline is 2, not 1: every Component registers one onDestroy
        // cleanup of its own for `_dirtyListeners` (via `registerListenerBag`,
        // see core/Component.ts), on top of the one Tooltip.attach adds here.
        expect((c as any)._destroyCleanups.length).toBe(2);

        c.dispose();

        expect((Tooltip as any).attachments.has(c.getId())).toBe(false);
    });
});
