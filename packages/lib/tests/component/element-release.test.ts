// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Component.release()` / `canRelease()` — the base-class seam
 * that detaches a live component's DOM element while keeping the component
 * object alive, per plans/component-element-release.md. Follows the
 * two-half technique established by dom-state-replay-probe.test.ts: the
 * detach half is asserted on recorded `DOM.sink` writes, and the rebuild
 * half calls the protected `render()` directly (never `getElement()` after
 * `release()`), because the offline `getElementById` model does not evict a
 * released id until the next `setId()` re-indexes it — see the plan's
 * `[^offline-byid]` footnote and TestDOM.ts's `indexId`/`byId`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Animation } from '~/core/Animation';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

type Write    = { op: string; args: unknown[] };
type Recorder = { writes: Write[] };

/** Test-only seam onto `Component`'s protected `render()`. Isolated to the helpers below; never exported. */
type Reboundable = {
    render(): Handle;
    setElementAttribute(key: string, value: unknown): unknown;
};

// See dom-state-replay-probe.test.ts for why a temporal window is used
// instead of filtering by `args[0] === handle`: several single-purpose ops
// (`removeElement`, `focus`, `release` is the exception that DOES carry the
// handle) do not include the target handle in `args`.
const rebuildWriteStart = new Map<Handle, number>();

/**
 * Calls a component's protected `render()`, returning the FRESH element
 * handle it creates. Does not update the component's own `_element` cache —
 * `getElement()` without `createIfMissing` still resolves it correctly
 * afterward only because `render()` -> `init()` calls `DOM.sink.setId()`,
 * which re-indexes the offline `getElementById` model onto the fresh handle.
 */
function rebuild(component: Component<any>): Handle {
    const recorder = DOM.sink as unknown as Recorder;
    const start     = recorder.writes.length;
    const handle    = (component as unknown as Reboundable).render();

    rebuildWriteStart.set(handle, start);

    return handle;
}

/** Writes through the raw `setElementAttribute` escape hatch, via the same cast `rebuild` uses. */
function setRawAttribute(component: Component<any>, key: string, value: string): void {
    (component as unknown as Reboundable).setElementAttribute(key, value);
}

/** The writes recorded while rebuilding `handle` — see the temporal-window note above. */
function writesFor(handle: Handle): Write[] {
    const recorder = DOM.sink as unknown as Recorder;
    const start     = rebuildWriteStart.get(handle) ?? 0;

    return recorder.writes.slice(start);
}

/** The one test-only releasable subclass used throughout — mirrors the probe file's `ListenerOnInitComponent`. */
class ReleasableProbe extends Component {
    protected canRelease(): boolean { return true; }
}

describe('Component.release() — gate', () => {
    it('refuses release for the base Component (canRelease() default false)', () => {
        const component = new Component({});
        component.getElement(true);

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        const released  = component.release();

        expect(released).toBe(false);
        expect(recorder.writes.slice(before).some(w => w.op === 'removeElement')).toBe(false);
    });

    it('allows release for an opted-in subclass, detaching the live element', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        const released  = probe.release();

        expect(released).toBe(true);
        expect(recorder.writes.slice(before).filter(w => w.op === 'removeElement').length).toBe(1);
    });

    it('a second release() is a no-op: no live element remains to release', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        probe.release();

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        const released  = probe.release();

        expect(released).toBe(false);
        expect(recorder.writes.slice(before).some(w => w.op === 'removeElement')).toBe(false);
    });
});

describe('Component.release() — detach half', () => {
    it('records removeElement and release for the outgoing handle', () => {
        const probe   = new ReleasableProbe({});
        const element = probe.getElement(true)!;

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        probe.release();

        const writes = recorder.writes.slice(before);
        expect(writes.some(w => w.op === 'removeElement')).toBe(true);
        expect(writes.some(w => w.op === 'release' && w.args[0] === element)).toBe(true);
    });

    it('tears down an active clip frame, and a rebuilt clip frame is not blocked by a stale guard', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        probe.setClipFrame(0, 0, 10, 10);

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        probe.release();

        // Both the frame wrapper and the probe's own element are torn down.
        const releaseWrites = recorder.writes.slice(before).filter(w => w.op === 'release');
        expect(releaseWrites.length).toBe(2);

        rebuild(probe);
        probe.getElement(); // resolves via the by-id index setId() just corrected — no render() re-entry

        const beforeSecondClip = recorder.writes.length;
        probe.setClipFrame(1, 1, 20, 20);

        // The `if (!this._clipFrame)` guard no longer blocks: a fresh frame
        // wrapper is created rather than silently reusing the torn-down one.
        expect(recorder.writes.slice(beforeSecondClip).some(w => w.op === 'createElement')).toBe(true);
    });
});

describe('Component.release() — rebuild half', () => {
    it('the fresh element receives setId, the class list, the attribute buffer, and geometry replay', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        setRawAttribute(probe, 'data-probe', '1');
        probe.setWidth(120);
        probe.release();

        const fresh = rebuild(probe);
        const writes = writesFor(fresh);

        expect(writes.some(w => w.op === 'setId')).toBe(true);
        expect(writes.some(w =>
            w.op === 'apply' && w.args[0] === fresh &&
            (w.args[1] as { addClass?: string[] }).addClass?.includes('ReleasableProbe')
        )).toBe(true);
        expect(writes.some(w =>
            w.op === 'apply' && w.args[0] === fresh &&
            'data-probe' in ((w.args[1] as { setAttr?: Record<string, string> }).setAttr ?? {})
        )).toBe(true);
        expect(writes.some(w =>
            w.op === 'apply' && w.args[0] === fresh &&
            (w.args[1] as { style?: Record<string, string> }).style?.width === '120px'
        )).toBe(true);
    });

    it('re-appends surviving child elements onto the fresh root', () => {
        const probe  = new ReleasableProbe({});
        const childA = new Component({});
        const childB = new Component({});
        probe.addComponent(childA);
        probe.addComponent(childB);
        probe.getElement(true);
        probe.release();

        const fresh = rebuild(probe);
        const childAElement = childA.getElement()!;
        const childBElement = childB.getElement()!;

        const appended = writesFor(fresh)
            .filter(w => w.op === 'appendChild' && w.args[0] === fresh)
            .map(w => w.args[1]);

        expect(appended).toContain(childAElement);
        expect(appended).toContain(childBElement);
    });

    it('drops the outgoing handle so a second release+rebuild cycle still releases exactly one handle', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        probe.release();

        rebuild(probe);
        probe.getElement(); // resolves to the fresh handle via setId()'s corrected by-id index

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        const released  = probe.release();

        expect(released).toBe(true);
        expect(recorder.writes.slice(before).filter(w => w.op === 'release').length).toBe(1);
    });
});

describe('Component.release() — scroll / focus restore', () => {
    // `flushLayout()` is the framework's own synchronous escape hatch for
    // tests: `RecordingDOMSink.requestAnimationFrame` drops its callback (see
    // TestDOM.ts), and `Component.scheduleLayout()`'s rAF coalescing is
    // module-level state that outlives any single test, so driving a real
    // frame here is both unavailable and unreliable. `flushLayout()` calls
    // `doLayout()` directly, which drains `_firstLayoutCallbacks` the same way
    // a real connected layout would.
    beforeEach(() => {
        vi.spyOn(DOM.source, 'isConnected').mockReturnValue(true);
    });

    afterEach(() => vi.restoreAllMocks());

    it('restores the scroll offset onto the rebuilt element after the first connected layout', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        probe.setScrollTop(40);
        probe.release();

        const fresh = rebuild(probe);
        probe.flushLayout();

        const scrollWrite = writesFor(fresh).find(w =>
            w.op === 'apply' && (w.args[1] as { scrollTop?: number }).scrollTop !== undefined
        );

        expect((scrollWrite?.args[1] as { scrollTop?: number } | undefined)?.scrollTop).toBe(40);
    });

    it('restores focus onto the rebuilt element after the first connected layout', () => {
        const probe = new ReleasableProbe({});
        probe.getElement(true);
        probe.focus();
        probe.release();

        const fresh = rebuild(probe);
        probe.flushLayout();

        const focusWrite = writesFor(fresh).find(w => w.op === 'focus');

        expect(focusWrite?.args[0]).toEqual({ preventScroll: true });
    });

    it('does not restore on a first render that was never released', () => {
        const probe = new ReleasableProbe({});
        const recorder = DOM.sink as unknown as Recorder;

        probe.getElement(true);
        const before = recorder.writes.length;
        probe.flushLayout();

        const writes = recorder.writes.slice(before);
        expect(writes.some(w =>
            w.op === 'apply' &&
            ((w.args[1] as { scrollTop?: number }).scrollTop !== undefined ||
             (w.args[1] as { scrollLeft?: number }).scrollLeft !== undefined)
        )).toBe(false);
        expect(writes.some(w => w.op === 'focus')).toBe(false);
    });
});

// Mirrors tests/core/DisposedPendingTransition.test.ts's discipline for the
// identical hazard on the release() path: a pending deferred write from
// Animation.play's two-frame entrance dance must not land on the handle
// release() has already returned to the sink. Asserted on whether the write
// happened, not on `not.toThrow()` — the offline sink's `release()` keeps
// serving a released handle, so a throw-based assertion would pass
// vacuously with or without the fix.
describe('Component.release() cancels pending transitions', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        frames = [];
        vi.useFakeTimers();
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

    /** Runs every frame callback captured since the last drain. */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    /** Style-carrying `apply` writes recorded against `handle` since `from`. */
    function stylesSince(from: number, handle: Handle): Array<Record<string, string | null>> {
        const recorder = DOM.sink as unknown as Recorder;

        return recorder.writes
            .slice(from)
            .filter(w => w.op === 'apply' && w.args[0] === handle)
            .map(w => (w.args[1] as { style?: Record<string, string | null> }).style)
            .filter((style): style is Record<string, string | null> => style !== undefined);
    }

    it('performs no write against a released handle when both entrance frames land', () => {
        const probe = new ReleasableProbe({});
        const element = probe.getElement(true)!;

        Animation.play(element, {
            from:       { opacity: '0' },
            to:         { opacity: '1' },
            durationMs: 100,
            properties: ['opacity'],
        });

        const recorder = DOM.sink as unknown as Recorder;
        const mark = recorder.writes.length;
        probe.release();

        flushFrame();
        flushFrame();

        expect(stylesSince(mark, element)).toEqual([]);
    });
});
