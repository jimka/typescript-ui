// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Probe tests backing `plans/dom-only-state-inventory.md`. Each case drives a
 * component's state, calls the protected `render()` — the real rebuild half
 * of a future release-and-rebuild API (see the plan) — and asserts what the
 * FRESH element does and does not receive. A recorded write is mechanical
 * evidence that a verdict in the inventory is correct; it cannot decide
 * anything the offline harness has no signal for (focus, canvas pixels,
 * media playback) — those stay `manual-verify` in the inventory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { TextInput } from '~/component/input/TextInput';
import { Video } from '~/component/display/Video';
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

/**
 * Test-only seam onto `Component`'s protected `render()` / `setElementAttribute()`
 * — the two rebuild-path primitives this file exercises. Isolated to the two
 * helpers below; never exported.
 */
type Reboundable = {
    render(): Handle;
    setElementAttribute(key: string, value: unknown): unknown;
};

// The write-log index `rebuild()` captured just before calling `render()` for
// a given fresh handle. `RecordingDOMSink` (tests/dom/TestDOM.ts) does NOT
// include the target handle in `args` for most single-purpose ops (`setValue`,
// `setSelectionRange`, `addListener`, `focus`, `blur`, `setCurrentTime`, ...) —
// only `apply`/`appendChild`/`release` do. The plan's `writesFor` was specified
// to filter on `args[0] === handle`, which is unusable for exactly the ops
// these probes need. Since each test renders one component with no children,
// the writes recorded between "capture the log length" and "render() returns"
// are unambiguously the fresh element's — so `writesFor` filters by that
// temporal window instead. See `## Implementation Notes` in the plan.
// `Handle` is a branded number (core/DOM.ts), not an object, so a plain `Map`
// is used — a `WeakMap` rejects primitive keys.
const rebuildWriteStart = new Map<Handle, number>();

/**
 * Calls a component's protected `render()`, returning the FRESH element
 * handle it creates. Does not update the component's own `_element` cache —
 * `getElement()` still resolves to the OLD handle after this call.
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

describe('DOM-state replay probe', () => {
    it('replays the input value onto the rebuilt element (TextInput)', () => {
        const input = new TextInput({ text: 'abc' });
        input.getElement(true);

        const fresh = rebuild(input);
        const write = writesFor(fresh).find(w => w.op === 'setValue');

        expect(write?.args).toEqual(['abc']);
    });

    it('does not replay the selection range onto the rebuilt element (TextInput)', () => {
        const input = new TextInput({ text: 'hello' });
        input.getElement(true);
        input.select(1, 2);

        const fresh = rebuild(input);

        expect(writesFor(fresh).some(w => w.op === 'setSelectionRange')).toBe(false);
    });

    it('does not replay the native scroll offset onto the rebuilt element (Component)', () => {
        const component = new Component({});
        component.getElement(true);
        component.setScrollTop(40);

        const fresh = rebuild(component);
        const scrolled = writesFor(fresh).some(w =>
            w.op === 'apply' && (w.args[1] as { scrollTop?: number }).scrollTop !== undefined
        );

        expect(scrolled).toBe(false);
    });

    it('replays media options onto the rebuilt element (Video)', () => {
        const video = new Video({ muted: true, volume: 0.4, playbackRate: 1.5 });
        video.getElement(true);

        const fresh = rebuild(video);
        const ops   = writesFor(fresh).map(w => w.op);

        expect(ops).toContain('setMuted');
        expect(ops).toContain('setVolume');
        expect(ops).toContain('setPlaybackRate');
    });

    it('does not replay the playhead position onto the rebuilt element (Video)', () => {
        const video = new Video({});
        video.getElement(true);
        video.setCurrentTime(12);

        const fresh = rebuild(video);

        expect(writesFor(fresh).some(w => w.op === 'setCurrentTime')).toBe(false);
    });

    it('re-attaches the native media listeners onto the rebuilt element (Video)', () => {
        const video = new Video({});
        video.getElement(true);

        const fresh            = rebuild(video);
        const addListenerWrites = writesFor(fresh).filter(w => w.op === 'addListener');
        const types              = addListenerWrites.map(w => w.args[0]);

        expect(addListenerWrites.length).toBeGreaterThan(0);
        expect(types).toContain('timeupdate');
        expect(types).toContain('play');
    });

    it('does not replay an attribute written through the raw setElementAttribute seam', () => {
        const component = new Component({});
        component.getElement(true);
        setRawAttribute(component, 'data-probe', '1');

        const fresh = rebuild(component);
        const wrote = writesFor(fresh).some(w =>
            w.op === 'apply' && 'data-probe' in ((w.args[1] as { setAttr?: Record<string, string> }).setAttr ?? {})
        );

        expect(wrote).toBe(false);
    });
});
