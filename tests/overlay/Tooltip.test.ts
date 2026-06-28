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

        expect(inst().getWidth()).toBe(Math.min(MAX_WIDTH, widestLine + H_PADDING));
    });

    it('floors a single-line tooltip height to ITEM_HEIGHT + V_PADDING', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        // lineCount === 1, so height = max(1*perLine + V_PADDING,
        // ITEM_HEIGHT + V_PADDING). With perLine (16) < ITEM_HEIGHT (20) the
        // floor wins.
        const expected = Math.max(perLine() + V_PADDING, ITEM_HEIGHT + V_PADDING);

        expect(inst().getHeight()).toBe(expected);
    });

    it('a multi-line label hugs the widest line and tracks the line count', () => {
        installTestDOM(CONFIG);

        // Three explicit lines; "Hello" is the widest.
        const text = 'He\nHello\nlo';

        Tooltip.show(text, 100, 100);

        const widestLine = Util.measureTextWidth('Hello');

        expect(inst().getWidth()).toBe(Math.min(MAX_WIDTH, widestLine + H_PADDING));
        // Height tracks the 3 explicit lines (no floor — multi-line path).
        expect(inst().getHeight()).toBe(3 * perLine() + V_PADDING);
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
        expect((inst() as { getZIndex(): number }).getZIndex()).toBeGreaterThan(LayerManager.Band.Dialog);
    });

    it('dismisses when its anchor element leaves the DOM', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);

        // An anchor that was never appended to the document is disconnected.
        const orphan = new Component({});
        const el = orphan.getElement(true)!;
        (Tooltip as { activeElement: unknown }).activeElement = el;

        expect(DOM.source.isConnected(el)).toBe(false);

        // Simulate the pointer-move anchor watch firing.
        (Tooltip as unknown as { _onAnchorWatch(): void })._onAnchorWatch();

        // hide() ran: the active anchor is forgotten.
        expect((Tooltip as { activeElement: unknown }).activeElement).toBeNull();
    });

    it('does not dismiss a tooltip that has no tracked anchor', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 100, 100);
        // show() installs the anchor watch.
        expect((Tooltip as { watching: boolean }).watching).toBe(true);

        (Tooltip as { activeElement: unknown }).activeElement = null;

        (Tooltip as unknown as { _onAnchorWatch(): void })._onAnchorWatch();

        // No anchor to check → no hide; the watch stays installed.
        expect((Tooltip as { watching: boolean }).watching).toBe(true);
    });

    it('clamps x and y to >= 0 for negative coordinates', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', -100, -100);

        // x/y are floored at 0 regardless of the negative input.
        expect(inst()).toBeDefined();
        expect((inst() as any).getX()).toBeGreaterThanOrEqual(0);
        expect((inst() as any).getY()).toBeGreaterThanOrEqual(0);
    });

    it('clamps x and y to viewport - size for huge coordinates', () => {
        installTestDOM(CONFIG);

        Tooltip.show('Hello', 99999, 99999);

        const w = inst().getWidth();
        const h = inst().getHeight();

        // clampedX = min(x + offset, vp.width - w) then max(0, …); for a huge x
        // the right-edge clamp wins, so x === vp.width - w.
        expect((inst() as any).getX()).toBe(CONFIG.viewport.width - w);
        expect((inst() as any).getY()).toBe(CONFIG.viewport.height - h);
    });

    // NOTE (offline harness limit): the contract clause "when the widest line
    // exceeds MAX_WIDTH the visual line count is derived from the wrapped
    // measureText({maxWidth}) height" (Tooltip.ts:169-175) is NOT assertable
    // offline. The modelled `measureText` ignores `maxWidth` (TestDOM.ts:356) and
    // never soft-wraps, so wrappedHeight is always one line and lineCount stays
    // at the `\n`-split count. Width capping (above) is the assertable half.
});
