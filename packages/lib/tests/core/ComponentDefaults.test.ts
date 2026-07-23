// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the per-class `_defaultOptions` cache introduced by
// plans/implemented/per-class-component-defaults.md — Expected Behaviour rows
// 1-8. The modelled DOM is installed globally per test by
// `tests/setup/node-setup.ts`, so no explicit `installTestDOM` call is needed
// here.
import { describe, it, expect } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Fit } from '~/layout/Fit';

class OverflowAutoComponent extends Component {
    constructor(options?: ComponentOptions) {
        super(options, { overflow: 'auto' } as Partial<ComponentOptions>);
    }
}

class FitDefaultComponent extends Component {
    constructor(options?: ComponentOptions) {
        super(options, { layoutManager: new Fit() } as Partial<ComponentOptions>);
    }
}

describe('per-class Component defaults', () => {
    it('gives two instances of the same class distinct layout managers', () => {
        const a = new Component({});
        const b = new Component({});
        const lmA = a.getLayoutManager();
        const lmB = b.getLayoutManager();

        expect(lmA).not.toBe(lmB);
        expect(lmA.getContainer()).toBe(a);
        expect(lmB.getContainer()).toBe(b);
    });

    it('shares one frozen defaults bag object across instances of the same class', () => {
        const a = new Component({}) as any;
        const b = new Component({}) as any;

        expect(a._defaultOptions).toBe(b._defaultOptions);
    });

    it("a subclass's defaults override the base's", () => {
        expect(new OverflowAutoComponent().getOverflowX()).toBe('auto');
        expect(new Component({}).getOverflowX()).toBe('hidden');
    });

    it('a subclass and its base do not share a defaults bag', () => {
        const sub  = new OverflowAutoComponent() as any;
        const base = new Component({}) as any;

        expect(sub._defaultOptions).not.toBe(base._defaultOptions);
    });

    it('rejects mutation of the frozen defaults bag', () => {
        const c = new Component({}) as any;

        expect(() => { c._defaultOptions.cursor = 'pointer'; }).toThrow();
    });

    it('falls back to the class default when _options is unset', () => {
        const c = new Component({});

        expect(c.getCursor()).toBe('default');
        expect(c.getZIndex()).toBe(0);
        expect(c.getInsets().getTop()).toBe(0);
        expect(c.getMinSizeConstraint()).toEqual({ width: 0, height: 0 });
    });

    it('a subclass supplying a layoutManager in subclassDefaults gets a per-instance manager', () => {
        const a = new FitDefaultComponent();
        const b = new FitDefaultComponent();

        expect(a.getLayoutManager()).toBeInstanceOf(Fit);
        expect(b.getLayoutManager()).toBeInstanceOf(Fit);
        expect(a.getLayoutManager()).not.toBe(b.getLayoutManager());
    });

    it('does not cross-contaminate instance-varying subclass defaults (Panel flush), plain then flush', () => {
        const plain = new Panel({});
        const flush = new Panel({ flush: true });

        expect(plain.getInsets().getTop()).toBe(4);
        expect(flush.getInsets().getTop()).toBe(0);
    });

    it('does not cross-contaminate instance-varying subclass defaults (Panel flush), flush then plain', () => {
        const flush = new Panel({ flush: true });
        const plain = new Panel({});

        expect(flush.getInsets().getTop()).toBe(0);
        expect(plain.getInsets().getTop()).toBe(4);
    });
});
