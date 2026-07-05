//
// Coverage for the preferred-size-change signal a container raises up its
// ancestor chain when its own child set changes (add / insert / remove).
//
// A container's preferred size derives from its children, so gaining or losing
// one changes the size an ancestor measures it at. Without the upward notify, a
// nested mutation (e.g. a row added to a content-sized viewport) relaid out only
// the mutated container, leaving an ancestor that sizes to it — a form, a Dialog
// re-fitting via resizeToContent — measuring the stale size. This pins the
// contract: the mutation fires the same `_onPreferredSizeChange` hook a child's
// setPreferredSize already propagates, so the whole chain re-lays-out.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** Overrides a component's ancestor-notify hook with a spy so propagation is observable. */
function spyOnAncestorNotify(component: Component): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    (component as unknown as { _onPreferredSizeChange: (() => void) | null })._onPreferredSizeChange = spy;

    return spy;
}

describe('Container structural mutation — ancestor preferred-size propagation', () => {
    it('notifies the parent when a rendered container gains a child (addComponent)', () => {
        const parent = new Component({});
        const child  = new Component({});
        // Materialize the element so addComponent runs its layout path (it returns
        // early, before the notify, on an unrendered container).
        parent.getElement(true);

        const notified = spyOnAncestorNotify(parent);
        parent.addComponent(child);

        expect(notified).toHaveBeenCalled();
    });

    it('notifies the parent when a rendered container gains a child (insertComponent)', () => {
        const parent = new Component({});
        parent.getElement(true);
        parent.addComponent(new Component({}));

        const notified = spyOnAncestorNotify(parent);
        parent.insertComponent(new Component({}), 0);

        expect(notified).toHaveBeenCalled();
    });

    it('notifies the parent when a container loses a child (removeComponent)', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.getElement(true);
        parent.addComponent(child);

        const notified = spyOnAncestorNotify(parent);
        parent.removeComponent(child);

        expect(notified).toHaveBeenCalled();
    });

    it('propagates a nested add through every ancestor to the root', () => {
        const grandparent = new Component({});
        const parent      = new Component({});
        grandparent.getElement(true);
        parent.getElement(true);
        // Wiring grandparent -> parent installs parent's propagating hook (which
        // relays to grandparent). The root has no parent, so observe it directly.
        grandparent.addComponent(parent);

        const rootNotified = spyOnAncestorNotify(grandparent);
        parent.addComponent(new Component({}));

        expect(rootNotified).toHaveBeenCalled();
    });
});
