// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//
// Coverage for Component's generic dirty-state propagation: a self-report
// (`setDirty`/`isDirty`) plus an automatic relay through `wireChild`/
// `unwireChild` that folds every descendant's dirty state into each
// ancestor's own `isDirty()`, arbitrarily deep, with a `dirtychange` event
// that fires exactly once per real transition. See
// plans/in-progress/component-dirty-state.md.
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

/** Test-only seam onto `Component`'s protected `setDirty()`. */
class DirtyProbe extends Component {
    markDirty(dirty: boolean): void { this.setDirty(dirty); }
}

describe('Component dirty state — self-report', () => {
    it('a fresh Component is not dirty', () => {
        expect(new Component({}).isDirty()).toBe(false);
    });

    it('markDirty(true)/markDirty(false) flips isDirty()', () => {
        const probe = new DirtyProbe({});

        probe.markDirty(true);
        expect(probe.isDirty()).toBe(true);

        probe.markDirty(false);
        expect(probe.isDirty()).toBe(false);
    });

    it('onDirtyChange fires exactly once per real transition', () => {
        const probe    = new DirtyProbe({});
        const listener = vi.fn();
        probe.onDirtyChange(listener);

        probe.markDirty(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);

        probe.markDirty(true);
        expect(listener).toHaveBeenCalledTimes(1);

        probe.markDirty(false);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(false);
    });

    it('offDirtyChange stops delivery to that exact listener reference', () => {
        const probe    = new DirtyProbe({});
        const listener = vi.fn();
        probe.onDirtyChange(listener);
        probe.offDirtyChange(listener);

        probe.markDirty(true);
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('Component dirty state — single-level relay', () => {
    it('a dirty child flips and un-flips the parent', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        parent.addComponent(child);

        child.markDirty(true);
        expect(parent.isDirty()).toBe(true);

        child.markDirty(false);
        expect(parent.isDirty()).toBe(false);
    });

    it('a dirtychange listener on the parent fires once when a child becomes dirty', () => {
        const parent   = new DirtyProbe({});
        const child    = new DirtyProbe({});
        parent.addComponent(child);

        const listener = vi.fn();
        parent.onDirtyChange(listener);
        child.markDirty(true);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);
    });

    it('two dirty children collapse onto the parent\'s 0<->>0 count transition', () => {
        const parent = new DirtyProbe({});
        const childA = new DirtyProbe({});
        const childB = new DirtyProbe({});
        parent.addComponent(childA);
        parent.addComponent(childB);

        const listener = vi.fn();
        parent.onDirtyChange(listener);

        // step 1: A dirty, B clean -> parent true, fires (true)
        childA.markDirty(true);
        expect(parent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);

        // step 2: A dirty, B dirty -> parent still true, no additional fire
        childB.markDirty(true);
        expect(parent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);

        // step 3: A clean, B dirty -> parent still true, no additional fire
        childA.markDirty(false);
        expect(parent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);

        // step 4: A clean, B clean -> parent false, fires (false)
        childB.markDirty(false);
        expect(parent.isDirty()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith(false);
    });
});

describe('Component dirty state — arbitrary depth', () => {
    it('propagates through an unrelated intermediate ancestor to the grandparent', () => {
        const grandparent = new DirtyProbe({});
        const parent       = new DirtyProbe({});
        const child        = new DirtyProbe({});
        grandparent.addComponent(parent);
        parent.addComponent(child);

        const listener = vi.fn();
        grandparent.onDirtyChange(listener);

        child.markDirty(true);

        expect(parent.isDirty()).toBe(true);
        expect(grandparent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);
    });
});

describe('Component dirty state — attach/detach reconciliation', () => {
    it('adding an already-dirty child immediately reflects on the parent, firing once', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        child.markDirty(true);

        const listener = vi.fn();
        parent.onDirtyChange(listener);
        parent.addComponent(child);

        expect(parent.isDirty()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(true);
    });

    it('removeComponent detaches: parent clears, child keeps its own dirty state', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        parent.addComponent(child);
        child.markDirty(true);

        const listener = vi.fn();
        parent.onDirtyChange(listener);
        parent.removeComponent(child);

        expect(parent.isDirty()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(false);
        expect(child.isDirty()).toBe(true);
    });

    it('disposeAllComponents reconciles the count through unwireChild the same as removeComponent', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        parent.addComponent(child);
        child.markDirty(true);

        parent.disposeAllComponents();

        expect(parent.isDirty()).toBe(false);
    });

    it('a clean child never fires the parent\'s dirtychange on add or remove', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});

        const listener = vi.fn();
        parent.onDirtyChange(listener);

        parent.addComponent(child);
        parent.removeComponent(child);

        expect(listener).not.toHaveBeenCalled();
    });

    it('a redundant removeComponent on an already-detached dirty child does not corrupt the count', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        parent.addComponent(child);
        child.markDirty(true);

        parent.removeComponent(child); // real removal: count 1 -> 0
        parent.removeComponent(child); // redundant: must be a no-op on the count

        const other = new DirtyProbe({});
        other.markDirty(true);
        parent.addComponent(other);

        expect(parent.isDirty()).toBe(true);
    });

    it('removeComponent on a component that was never this parent\'s child leaves the count untouched', () => {
        const parent   = new DirtyProbe({});
        const foreign  = new DirtyProbe({});
        foreign.markDirty(true); // dirty, but never added to `parent`

        parent.removeComponent(foreign);

        // A driven-negative count would still read `false` here by coincidence
        // (a negative count fails the `> 0` check same as zero), so surface it
        // the way it actually manifests: it takes one real dirty child less
        // than it should to flip `parent.isDirty()` back to `true`.
        const child = new DirtyProbe({});
        parent.addComponent(child);
        child.markDirty(true);

        expect(parent.isDirty()).toBe(true);
    });
});

describe('Component dirty state — combining own-dirty and descendant-dirty', () => {
    it('clearing only the own flag while a child stays dirty leaves isDirty() true, with no spurious fire', () => {
        const parent = new DirtyProbe({});
        const child  = new DirtyProbe({});
        parent.addComponent(child);

        parent.markDirty(true);
        child.markDirty(true);

        const listener = vi.fn();
        parent.onDirtyChange(listener);

        parent.markDirty(false);
        expect(parent.isDirty()).toBe(true);
        expect(listener).not.toHaveBeenCalled();

        child.markDirty(false);
        expect(parent.isDirty()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith(false);
    });
});
