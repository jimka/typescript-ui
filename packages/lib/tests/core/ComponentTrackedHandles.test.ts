// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for Component.untrackHandles (plans/implemented/markdown-lexer-linear-time.md).
//
// `untrackHandle` is an `indexOf` plus a `splice` per call, so untracking a
// whole rebuild's worth of handles one at a time shifts the tail of the list
// once per handle — about 17 million element moves for the 5,874 handles of a
// 480-section Markdown document. The bulk form does it in one pass.
//
// The list is compacted in place rather than reassigned: `trackHandle` hands
// this same array to the module's GC finalizer, which would otherwise keep
// releasing handles from an array the component no longer uses. The identity
// case below is what pins that.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Exposes the two protected tracking seams and the private list they maintain. */
class TrackingProbe extends Component {
    track(handle: Handle): void {
        this.trackHandle(handle);
    }

    untrackMany(handles: readonly Handle[]): void {
        this.untrackHandles(handles);
    }

    owned(): Handle[] {
        return (this as unknown as { _ownedHandles: Handle[] })._ownedHandles;
    }
}

/**
 * Renders a probe and tracks four further handles after its root, so the list
 * under test holds `[root, a, b, c, d]`.
 *
 * @returns The probe and the four handles tracked after its root.
 */
function probeWithFourChildren(): { probe: TrackingProbe; children: Handle[] } {
    const probe = new TrackingProbe({});

    probe.getElement(true);

    const children = [0, 1, 2, 3].map(() => DOM.sink.createElement('div'));

    for (const child of children) {
        probe.track(child);
    }

    return { probe, children };
}

describe('Component.untrackHandles', () => {
    it('drops every listed handle in one pass, keeping the order of the rest', () => {
        const { probe, children } = probeWithFourChildren();
        const [a, b, c, d] = children as [Handle, Handle, Handle, Handle];
        const root = probe.owned()[0]!;

        expect(probe.owned()).toEqual([root, a, b, c, d]);

        probe.untrackMany([b, d]);

        expect(probe.owned()).toEqual([root, a, c]);
    });

    it('leaves the list unchanged for an untracked handle and for an empty list', () => {
        const { probe } = probeWithFourChildren();
        const before = [...probe.owned()];
        const untracked = DOM.sink.createElement('div');

        probe.untrackMany([untracked]);

        expect(probe.owned()).toEqual(before);

        probe.untrackMany([]);

        expect(probe.owned()).toEqual(before);
    });

    it('compacts the same array object, so the GC finalizer keeps seeing the live list', () => {
        const { probe, children } = probeWithFourChildren();
        const list = probe.owned();

        probe.untrackMany([children[0]!, children[2]!]);

        expect(probe.owned()).toBe(list);
    });
});
