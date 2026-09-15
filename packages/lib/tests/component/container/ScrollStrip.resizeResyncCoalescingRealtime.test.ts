// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Simulates an actual multi-frame `Split`-gutter drag against `ScrollStrip`'s
// resize-resync coalescing: exactly one real `layoutContent` pass per
// animation frame (`Split.flushDrag`'s own per-frame coalescing — see
// `layout/Split.ts`'s `scheduleDrag`/`flushDrag` — cascades synchronously
// through `Tab.doLayout` -> `TabBar.placeStrip`/`layoutChrome` to exactly one
// `ScrollStrip.layoutContent` call per frame), interleaved with draining
// whatever settle-relay callback is currently queued *before* each pass —
// mirroring the real timing: the strip's own settle-relay callback for a
// given frame is registered synchronously during the *previous* frame's
// pass, so it always sorts earlier in that frame's `requestAnimationFrame`
// batch than the drag's own per-frame pass, which is registered later, by a
// `mousemove` task that runs only after the previous frame's batch has
// fully completed.
//
// `ScrollStrip.resizeResyncCoalescing.test.ts`'s cases call `layoutContent`
// several times back-to-back with no intervening frame — a shape a real
// `Split`-driven drag never produces, and the reason an earlier, single-hop
// version of the settle relay (which raced and always lost to this exact
// per-frame timing, so it never withheld anything during a real drag) still
// passed every one of that file's cases. This file pins the shape that
// would have caught it; see the plan's `## Implementation Notes` for the
// full trace.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollStrip } from '~/component/container/ScrollStrip';
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
// box, so they comfortably overflow the widths this file drives the strip to.
const ITEM_LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];

// Fixed band thickness (px) for every frame in this file — arbitrary, only
// large enough that a Button's own min height never binds.
const BAND_THICKNESS = 24;

// The per-end arrow gutter ScrollStrip reserves on overflow (mirrored from
// ScrollStrip.ts only to derive the clip's expected resolved width, not
// asserted as an opaque golden — same convention as the sibling test file).
const SCROLL_ARROW_SIZE = 24;

// Every live pass or settle catch-up calls `_clip.syncScrollOffsets()`
// exactly once, via `refreshArrows`'s call into `mainScroll()`, and
// `refreshArrows()` once — see
// `ScrollStrip.resizeResyncCoalescing.test.ts`'s own constants of the same
// name for the full explanation.
const SYNC_PER_LIVE_PASS = 1;
const REFRESH_PER_LIVE_PASS = 1;

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
    // that ends mid-drag doesn't leave Component's module-level rafHandle
    // non-null, which would make the next test's own scheduleResizeSettle()
    // find a flush already "pending" and skip registering a fresh frame.
    drainFrames();
    DOM.reset();
});

/**
 * Fires exactly the frames currently queued, without draining any a callback
 * re-queues in turn — one real `requestAnimationFrame` batch.
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

/** Builds a strip whose items overflow at every width this file drives it to. */
function buildOverflowingStrip(): ScrollStrip {
    const strip = new ScrollStrip({ scrollable: true });

    for (const label of ITEM_LABELS) {
        strip.addItem(new Button({ text: label }));
    }

    const box = strip.getContentBox() as BoxLayout;

    box.setMode('preferred');
    box.setOverflowing(true, false);

    return strip;
}

/** Sums each item's preferred width — mirrors BorderedStripHost.predictedItemsExtent. */
function predictedItemsExtent(strip: ScrollStrip): number {
    return strip.getItems().reduce((sum, item) => sum + (item.getPreferredSize()?.width ?? 0), 0);
}

/**
 * One real drag frame: the single `layoutContent` pass `Split.flushDrag`'s
 * own per-frame-coalesced drag callback would trigger this frame.
 */
function realDragFrame(strip: ScrollStrip, width: number): void {
    strip.setWidth(width);
    strip.setHeight(BAND_THICKNESS);

    const reserve = strip.arrowReserve(predictedItemsExtent(strip), width);

    strip.layoutContent(reserve, 0);
}

/**
 * Advances one real animation frame of an ongoing drag: first fires whatever
 * settle-relay callback is currently queued — registered during the
 * *previous* frame, so it always sorts earlier in this frame's batch than
 * the drag's own pass (see this file's header comment) — then runs this
 * frame's real drag pass.
 */
function advanceDragFrame(strip: ScrollStrip, width: number): void {
    runQueuedFramesOnce();
    realDragFrame(strip, width);
}

/**
 * One height-only drag frame — mirrors realDragFrame but varies the band's
 * height instead of its width, with the width pinned at 200: the
 * horizontal-gutter-drag case, where the strip's own box never changes on
 * the tracked (width) axis.
 */
function realHeightOnlyDragFrame(strip: ScrollStrip, height: number): void {
    strip.setWidth(200);
    strip.setHeight(height);

    const reserve = strip.arrowReserve(predictedItemsExtent(strip), 200);

    strip.layoutContent(reserve, 0);
}

describe('ScrollStrip resize-resync coalescing under a realistic one-pass-per-frame drag', () => {
    it('withholds the resync on every frame after the first while the drag continues', () => {
        const strip = buildOverflowingStrip();

        realDragFrame(strip, 200); // frame 1: drag start, always live

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        // Frames 2-20: a continuing drag, one real pass per frame, each a
        // genuinely different width — the scenario this plan exists to fix.
        // Under a settle mechanism that races the same-frame real pass (the
        // defect this file's header comment describes), every one of these
        // would resync live too, same as before the fix.
        for (let frame = 2; frame <= 20; frame++) {
            advanceDragFrame(strip, 200 - frame);
        }

        expect(syncSpy).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('catches up exactly once, reflecting the final width, once the drag stops', () => {
        const strip = buildOverflowingStrip();
        const lastWidth = 190;

        realDragFrame(strip, 200);

        for (let frame = 2; frame <= 10; frame++) {
            advanceDragFrame(strip, 200 - frame); // last iteration lands at lastWidth (190)
        }

        // Drag stops here: no further frames arrive.
        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        drainFrames();

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);
        expect((strip as any)._clip.getWidth()).toBe(lastWidth - 2 * SCROLL_ARROW_SIZE);
        expect((strip as any)._resizeSettleHandle).toBeNull();
    });

    it('stays withheld through a much longer drag (35 frames), not just the first few', () => {
        // The single-hop settle this file's header comment describes raced
        // and always lost to the drag's own per-frame pass, so it never
        // withheld anything — a defect a short burst wouldn't distinguish
        // from a correct two-hop relay that happened to catch up early. This
        // drives a burst well past the two frames the relay itself needs,
        // guarding against a regression to that single-hop shape specifically.
        const strip = buildOverflowingStrip();
        const lastWidth = 165;

        realDragFrame(strip, 200);

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        for (let frame = 2; frame <= 35; frame++) {
            advanceDragFrame(strip, 200 - frame); // last iteration lands at lastWidth (165)
        }

        expect(syncSpy).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();

        drainFrames();

        expect(syncSpy).toHaveBeenCalledTimes(SYNC_PER_LIVE_PASS);
        expect(refreshSpy).toHaveBeenCalledTimes(REFRESH_PER_LIVE_PASS);
        expect((strip as any)._clip.getWidth()).toBe(lastWidth - 2 * SCROLL_ARROW_SIZE);
        expect((strip as any)._resizeSettleHandle).toBeNull();
    });

    it('a height-only per-frame drag never reads and never arms', () => {
        const strip = buildOverflowingStrip();

        realDragFrame(strip, 200); // mount frame: live; arms the (harmless) settle relay

        // The offline harness only realises the clip's element — and so
        // HBox's committed item geometry — partway through the mount frame
        // (via ensureArrows's getElement(true), called after that frame's
        // own layoutItems already ran); a genuine browser mount always
        // finishes realising and painting before a drag can begin, so one
        // further identical frame is what gives _lastItemsExtent its first
        // real (non-placeholder) baseline.
        realDragFrame(strip, 200);
        drainFrames(); // let the mount settle frame resolve to idle

        const syncSpy = vi.spyOn((strip as any)._clip, 'syncScrollOffsets');
        const refreshSpy = vi.spyOn(strip, 'refreshArrows');

        // 20 frames that change only the band's height — the tracked (width)
        // axis of the clamp signature never moves, so every pass is silent.
        for (let frame = 1; frame <= 20; frame++) {
            runQueuedFramesOnce(); // whatever settle-relay callback is queued for this frame
            realHeightOnlyDragFrame(strip, BAND_THICKNESS + frame);
        }

        expect(syncSpy).not.toHaveBeenCalled();
        expect(refreshSpy).not.toHaveBeenCalled();
        expect((strip as any)._resizeSettleHandle).toBeNull();
    });
});
