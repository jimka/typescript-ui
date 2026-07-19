// Pure node-env suite for the tiny BaseObject base class.
import { describe, it, expect } from 'vitest';
import { BaseObject } from '~/core/BaseObject';

class Widget extends BaseObject {}

describe('BaseObject', () => {
    it('assigns distinct, non-empty ids to two instances', () => {
        const a = new BaseObject();
        const b = new BaseObject();

        expect(a.getId().length).toBeGreaterThan(0);
        expect(b.getId().length).toBeGreaterThan(0);
        expect(a.getId()).not.toBe(b.getId());
    });

    it('setId overrides the id and returns this (chainable)', () => {
        const obj = new BaseObject();

        const returned = obj.setId('custom');

        expect(obj.getId()).toBe('custom');
        expect(returned).toBe(obj);
    });

    it('getClassName returns the constructor name for a direct instance', () => {
        // NOTE: getClassName relies on constructor.name, which the prod minifier
        // mangles (a known project issue). That does not affect this Vitest run
        // (unminified), so the assertion is valid as-is.
        expect(new BaseObject().getClassName()).toBe('BaseObject');
    });

    it('getClassName returns the subclass name for a subclass instance', () => {
        expect(new Widget().getClassName()).toBe('Widget');
    });
});
