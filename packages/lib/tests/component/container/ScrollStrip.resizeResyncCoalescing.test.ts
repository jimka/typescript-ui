// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins ScrollStrip's resize-resync coalescing: while the clip's own main-axis
// extent is changing every pass (a live Split gutter drag resizing the
// strip's owner), layoutItems's post-layout scroll-offset resync and
// layoutArrows's arrow-enablement read each force a synchronous browser
// layout flush — expensive enough, repeated every animation frame of a drag,
// to dominate a profiled trace (see the plan). Both reads are withheld
// together after the first extent change of a burst and caught up in one
// pass on the first quiet animation frame; mainScroll() always resyncs for
// itself regardless, so a reveal or reorder-drag mid-burst is never served a
// stale scroll position.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollStrip, ScrollStripOrientation } from '~/component/container/ScrollStrip';
import { Button } from '~/component/button/Button';
import { BoxLayout } from '~/layout/BoxLayout';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrors ContentBoxPanel's demo labels — confirmed there to overflow a 250px
// box, so they comfortably overflow the much smaller widths this file drives
// the strip to (140/100/70px — see W1/W2/W3 below).
const ITEM_LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];

// Fixed band thickness (px) used for every layoutAt() call in this file —
// arbitrary, only large enough that a Button's own min height never binds.
const BAND_THICKNESS = 24;

// Test widths driving the horizontal bursts below: W1 is the initial mount,
// W2 a first resize-burst step, W3 a second step extending the same burst.
// Each stays well above 2 * SCROLL_ARROW_SIZE so the clip's own resolved
// width (main - 2 * reserve) never clamps to 0.
const W1 = 140;
const W2 = 100;
const W3 = 70;

// The per-end arrow gutter ScrollStrip reserves on overflow (mirrored from
// ScrollStrip.ts only to derive the clip's expected resolved width/height,
// not asserted as an opaque golden — same convention as ScrollStrip.test.ts).
const SCROLL_ARROW_SIZE = 24;

// Every "live" (non-withheld) pass, and every settle-frame catch-up, calls
// `_clip.syncScrollOffsets()` twice: once directly (layoutItems's own resync,
// or flushResizeSettle's catch-up resync), and once more indirectly through
// `refreshArrows()`'s pre-existing, unmodified call to `mainScroll()` — which
// this plan makes always resync the cache before returning. The plan's own
// "Non-Goals" section calls this exact redundancy out as harmless and
// deliberately not worth avoiding: the second read is served from the
// already-clean layout for free. A withheld pass skips `refreshArrows()`
// entirely, so it contributes neither call.
const SYNC_PER_LIVE_PASS = 2;
const REFRESH_PER_LIVE_PASS = 1;

// The offline sink drops requestAnimationFrame/cancelAnimationFrame (see
// DOMSink); capture them so the settle mechanism (now routed through
// Component.afterNextLayout — see ScrollStrip.ts's scheduleResizeSettle) can
// be driven to completion explicitly.
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

afterEach(() => {
    // A still-armed settle handle leaves Component's shared afterNextLayout
    // flush queued — cancel() only sets a flag (Component.afterNextLayout's
    // contract), it doesn't deregister the frame. Drain it here so a test
    // that ends mid-burst doesn't leave Component's module-level rafHandle
    // non-null, which would make the next test's own scheduleResizeSettle()
    // find a flush already "pending" and skip registering a fresh frame.
    drainFrames();
    DOM.reset();
});

/**
 * Runs exactly the currently-queued frames once, without draining any a
 * callback re-queues in turn — lets a test observe the settle mechanism's
 * intermediate state between two animation frames.
 */
function runQueuedFramesOnce(): void {
    const pending = Array.from(frames.values());
    frames.clear();

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs queued frames to quiescence, including any newly re-armed in turn. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.size > 0; guard++) {
        runQueuedFramesOnce();
    }
}

/**
 * Builds a strip whose items overflow at every width this file drives it to —
 * the same preferred+overflowing switch ContentBoxPanel's BorderedStripHost
 * demo applies before relying on paging arrows (ScrollStrip's clip box
 * defaults to "equal" mode, which divides the available space among items
 * instead of letting them overflow it).
 */
function buildOverflowingStrip(orientation: ScrollStripOrientation = 'horizontal'): ScrollStrip {
    const strip = new ScrollStrip({ orientation, scrollable: true });

    for (const label of ITEM_LABELS) {
        strip.addItem(new Button({ text: label }));
    }

    const box = strip.getContentBox() as BoxLayout;

    box.setMode('preferred');
    box.setOverflowing(true, false);

    return strip;
}

/** Sums each item's preferred main-axis extent — mirrors BorderedStripHost.predictedItemsExtent. */
function predictedItemsExtent(strip: ScrollStrip, vertical: boolean): number {
    return strip.getItems().reduce((sum, item) => {
        const preferred = item.getPreferredSize();

        return sum + (vertical ? preferred?.height ?? 0 : preferred?.width ?? 0);
    }, 0);
}

/**
 * Sizes the strip's band to `main` (its main axis) x `BAND_THICKNESS` (its
 * cross axis) and runs one layoutContent pass — the same two-step sequence
 * an owner like TabBar follows, with the reserve computed the same way
 * BorderedStripHost's doLayout does.
 */
function layoutAt(strip: ScrollStrip, main: number, orientation: ScrollStripOrientation = 'horizontal'): void {
    const vertical = orientation === 'vertical';

    strip.setWidth(vertical ? BAND_THICKNESS : main);
    strip.setHeight(vertical ? main : BAND_THICKNESS);

    const reserve = strip.arrowReserve(predictedItemsExtent(strip, vertical), main);

    strip.layoutContent(reserve, 0);
}

describe('ScrollStrip resize-resync coalescing', () => {
    it('resyncs live on the first extent change (mount)', () => {
        const strip = buildOverflowingStrip();
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        layoutAt(strip, W1);

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);

        // The very first layoutItems() call always arms one settle frame (see
        // the plan's "Potential Challenges") — harmless, since this pass's own
        // resync already happened live and nothing is owed at settle. Checked
        // via the strip's own handle field (no longer a raw frame-queue key —
        // see Component.afterNextLayout) plus the underlying sink genuinely
        // having a frame queued.
        const handle = (strip as any)._resizeSettleHandle;

        expect(handle).not.toBeNull();
        expect(frames.size).toBeGreaterThan(0);
    });

    it('withholds the resync for a second extent change in the same burst', () => {
        const strip = buildOverflowingStrip();
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        layoutAt(strip, W1);
        layoutAt(strip, W2);

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);

        // The clip's own geometry already reflects W2 even though the resync
        // that would report it externally was withheld.
        expect((strip as any)._clip.getWidth()).toBe(W2 - 2 * SCROLL_ARROW_SIZE);
    });

    it('still withholds a same-extent pass inside a burst', () => {
        const strip = buildOverflowingStrip();
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        layoutAt(strip, W1);
        layoutAt(strip, W2);
        layoutAt(strip, W2); // same width again, still mid-burst

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);
    });

    it('performs exactly one catch-up when the settle frame drains', () => {
        const strip = buildOverflowingStrip();
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        layoutAt(strip, W1);
        layoutAt(strip, W2);
        drainFrames();

        expect(syncSpy).toHaveBeenCalledTimes(2 * SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(2 * REFRESH_PER_LIVE_PASS);
        expect((strip as any)._clip.getWidth()).toBe(W2 - 2 * SCROLL_ARROW_SIZE);
    });

    it('extends the burst when a change lands between the settle relay\'s two hops', () => {
        // The settle relay is two afterNextLayout hops deep (see
        // ScrollStrip.ts's scheduleResizeSettle remarks): the first hop (a
        // decoy) only re-arms for one more frame, the second is where
        // flushResizeSettle actually decides whether to catch up. This test
        // pins the mechanism that makes that decision correctly extend the
        // burst — via the private _clipExtentMoved/_resizeSettleHandle fields
        // directly, rather than inferring it from call counts alone: the
        // clip's own width/height are never gated by the withholding (only
        // the scroll-offset read is), so by the time any settle hop runs, the
        // clip already reports the *latest* width regardless of whether
        // extension worked — a black-box, geometry-only assertion could not
        // tell a correct extension apart from one that ignored the interrupt
        // and coincidentally caught up on the same already-current geometry.
        const strip = buildOverflowingStrip();

        layoutAt(strip, W1); // live; arms the relay

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        layoutAt(strip, W2); // withheld: _clipExtentMoved set for the relay's second hop to see

        runQueuedFramesOnce(); // relay's first hop: only re-arms, doesn't touch _clipExtentMoved
        runQueuedFramesOnce(); // relay's second hop: sees W2's change, re-arms instead of catching up

        expect((strip as any)._clipExtentMoved).toBe(false); // W2's contribution consumed
        expect((strip as any)._resizeSettleHandle).not.toBeNull(); // extended, not settled
        expect(syncSpy).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();

        layoutAt(strip, W3); // lands in the window right after the second hop's re-arm
        expect((strip as any)._clipExtentMoved).toBe(true); // this pass's own contribution, not a leftover from W2

        drainFrames(); // let the newly-extended relay run to completion

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);
        expect((strip as any)._clip.getWidth()).toBe(W3 - 2 * SCROLL_ARROW_SIZE);
        expect((strip as any)._resizeSettleHandle).toBeNull();
    });

    it('mainScroll() resyncs immediately, independent of a pending burst', () => {
        const strip = buildOverflowingStrip();
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');

        layoutAt(strip, W1);
        layoutAt(strip, W2); // withheld state: settle still armed, catch-up not yet run

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);

        strip.mainScroll();

        // An extra, single call beyond the coalesced count — mainScroll()
        // never trusts the cache while a burst is pending, and (unlike
        // refreshArrows()) never calls back into mainScroll() itself, so it
        // adds exactly one more call, not two.
        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS + 1);
    });

    it('tracks height, not width, for a vertical strip', () => {
        const strip = buildOverflowingStrip('vertical');

        layoutAt(strip, W1, 'vertical'); // mount
        drainFrames(); // let the harmless mount settle frame resolve to idle

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        // Changing only the cross-axis thickness (width, for a vertical
        // strip) is not an extent change: no burst starts, live resync as
        // usual since nothing "changed" on the tracked axis.
        strip.setWidth(BAND_THICKNESS + 20);
        strip.layoutContent(strip.arrowReserve(predictedItemsExtent(strip, true), W1), 0);

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);
        expect((strip as any)._resizeSettleHandle).toBeNull();

        // Changing the main axis (height) is a genuine extent change.
        layoutAt(strip, W1 + 10, 'vertical');

        expect(syncSpy).toHaveBeenCalledTimes(2 * SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(2 * REFRESH_PER_LIVE_PASS);
        expect((strip as any)._resizeSettleHandle).not.toBeNull();
    });

    it('cancels an armed settle frame on teardown, running no callback', () => {
        const strip = buildOverflowingStrip();

        layoutAt(strip, W1);
        layoutAt(strip, W2); // settle armed, withheld state

        expect((strip as any)._resizeSettleHandle).not.toBeNull();

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        strip.dispose();

        expect((strip as any)._resizeSettleHandle).toBeNull();

        // A cancelled handle leaves the underlying frame queued, but inert
        // (Component.afterNextLayout's cancel() sets a flag; it does not
        // deregister the frame) — draining without throwing, and confirming
        // the withheld work never ran, is what proves the cancellation took
        // effect.
        expect(() => drainFrames()).not.toThrow();
        expect(syncSpy).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
    });
});
