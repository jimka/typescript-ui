// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Component.destructor()`'s teardown-order change, per
 * plans/implemented/destructor-subtree-detach-skip.md and its
 * `## Implementation Notes`: a component now removes its own element before
 * recursing into its children, instead of after. Every component's own
 * `DOM.sink.removeElement()` call still runs unconditionally — the plan's
 * original design gated it on `DOM.source.isConnected()` to skip a
 * descendant's redundant call once an ancestor's removal had already
 * cascaded it out of the document, but that gate produced a confirmed
 * regression (see Implementation Notes) for a component disposed while its
 * own container is merely detached-and-cached rather than itself being torn
 * down (`Menu.showAnchored()`'s `disposeAllComponents()` on the old menu
 * items while the panel sits hidden but reused). The shipped behaviour
 * instead reorders without skipping: a still-connected ancestor's removal is
 * the one call that costs a live layout invalidation and cascades the whole
 * subtree out of the document natively; every descendant's own subsequent
 * call still runs, but against an already-detached node — cheap, not
 * skipped. Follows the structure of the sibling element-release.test.ts:
 * same `DOM_CONFIG`, same `installTestDOM`/`DOM.reset()`
 * `beforeEach`/`afterEach`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
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

/** A root -> child -> grandchild tree wired via addComponent, each with a materialised element. */
function buildTree(): { root: Component; child: Component; grandchild: Component } {
    const root       = new Component({});
    const child       = new Component({});
    const grandchild = new Component({});

    root.addComponent(child);
    child.addComponent(grandchild);

    root.getElement(true);
    child.getElement(true);
    grandchild.getElement(true);

    return { root, child, grandchild };
}

describe('Component.destructor() — own-element removal runs before the child recursion', () => {
    it('removes the root before either descendant', () => {
        const { root, child, grandchild } = buildTree();
        const rootElement       = root.getElement()!;
        const childElement      = child.getElement()!;
        const grandchildElement = grandchild.getElement()!;

        const removed: Handle[] = [];
        const spy = vi.spyOn(DOM.sink, 'removeElement').mockImplementation((handle: Handle) => {
            removed.push(handle);
        });

        root.dispose();
        spy.mockRestore();

        expect(removed).toEqual([rootElement, childElement, grandchildElement]);
    });
});

describe('Component.destructor() — every component still removes its own element', () => {
    it('performs one native removal per component in a whole-subtree dispose', () => {
        const { root } = buildTree();

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        root.dispose();

        const removeCount = recorder.writes.slice(before).filter(w => w.op === 'removeElement').length;
        expect(removeCount).toBe(3);
    });

    it('still detaches a component whose own container is merely hidden-and-reused rather than itself disposed — the Menu regression guard', () => {
        // Mirrors Menu.showAnchored(): disposeAllComponents() discards the
        // previous MenuItems while the panel itself sits hidden-but-cached,
        // not disposed — the container survives and is shown again later, so
        // a disposed child's element must actually be detached from it, not
        // merely found "already disconnected" (which the rejected isConnected
        // gate would have read as true here too) and left dangling inside a
        // container that gets reused. Calls `child.dispose()` directly rather
        // than routing through `disposeAllComponents()`: the offline harness's
        // `getElementById` model never evicts a removed id
        // (`TestHandleTable._byId`), so `unwireChild()`'s follow-up
        // `removeElement()` call would recover the handle through that stale
        // index and pass vacuously even with the rejected gate reinstated —
        // production's `document.getElementById` has no such fallback.
        const container = new Component({});
        container.getElement(true);

        const child = new Component({});
        container.addComponent(child);
        const childElement = child.getElement()!;

        expect(DOM.source.getParentNode(childElement)).toBe(container.getElement()!);

        child.dispose();

        expect(DOM.source.getParentNode(childElement)).toBeNull();
    });
});

describe('Component.destructor() — bookkeeping', () => {
    it('releases every descendant handle in a whole-subtree dispose', () => {
        const { root, child, grandchild } = buildTree();

        const childHandle: Handle      = child.getElement()!;
        const grandchildHandle: Handle = grandchild.getElement()!;

        const recorder = DOM.sink as unknown as Recorder;
        const before    = recorder.writes.length;
        root.dispose();

        const releaseWrites = recorder.writes.slice(before).filter(w => w.op === 'release');
        expect(releaseWrites.filter(w => w.args[0] === childHandle).length).toBe(1);
        expect(releaseWrites.filter(w => w.args[0] === grandchildHandle).length).toBe(1);
    });
});
