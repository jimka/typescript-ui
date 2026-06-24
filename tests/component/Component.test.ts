import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Insets } from '~/primitive/Insets';

describe('Component', () => {
    it('assigns a unique, non-empty id', () => {
        const a = new Component({});
        const b = new Component({});
        expect(a.getId()).toBeTruthy();
        expect(a.getId()).not.toBe(b.getId());
    });
    it('has an unset (NaN) width before sizing', () => {
        expect(Number.isNaN(new Component({}).getWidth())).toBe(true);
    });
    it('stores an explicit width', () => {
        const c = new Component({});
        c.setWidth(100);
        expect(c.getWidth()).toBe(100);
    });
    it('defaults insets to zero on every edge', () => {
        const insets = new Component({}).getInsets();
        expect(insets.getTop()).toBe(0);
        expect(insets.getRight()).toBe(0);
        expect(insets.getBottom()).toBe(0);
        expect(insets.getLeft()).toBe(0);
    });
    it('updates stored insets', () => {
        const c = new Component({});
        c.setInsets(new Insets(1, 2, 3, 4));
        expect(c.getInsets().getTop()).toBe(1);
    });
    it('stores and returns the background color', () => {
        const c = new Component({});
        c.setBackgroundColor('red');
        expect(c.getBackgroundColor()).toBe('red');
    });
    it('defaults visibility to null and reflects setVisible', () => {
        const c = new Component({});
        expect(c.isVisible()).toBe(null);
        c.setVisible(false);
        expect(c.isVisible()).toBe(false);
        c.setVisible(true);
        expect(c.isVisible()).toBe(true);
    });
    it('throws when setVisible receives a non-boolean truthy value', () => {
        const c = new Component({});
        expect(() => (c.setVisible as (v: unknown) => unknown)('foo')).toThrow('not a boolean');
    });
    it('registers a child via addComponent', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        expect(child.getParentComponent()).toBe(parent);
    });
    it('throws when adding a child that already has a parent', () => {
        const child = new Component({});
        new Component({}).addComponent(child);
        expect(() => new Component({}).addComponent(child)).toThrow('already has a parent');
    });
    it('removes a child via removeComponent', () => {
        const parent = new Component({});
        const child  = new Component({});
        parent.addComponent(child);
        parent.removeComponent(child);
        expect(child.getParentComponent()).toBeFalsy();
    });
});
