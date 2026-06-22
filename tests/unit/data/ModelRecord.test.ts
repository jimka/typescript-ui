import { describe, it, expect } from 'vitest';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

function makeRecord(data: Record<string, any> = {}): ModelRecord {
    const model = new Model([{ name: 'name' }, { name: 'age' }]);
    return new ModelRecord(model, data);
}

describe('ModelRecord', () => {
    it('is not dirty on construction', () => {
        expect(makeRecord({ name: 'Alice' }).isDirty()).toBe(false);
    });
    it('becomes dirty after set() changes a value', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        expect(r.isDirty()).toBe(true);
    });
    it('stays clean when set() receives the same value', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Alice');
        expect(r.isDirty()).toBe(false);
    });
    it('commit() clears dirty flag', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        r.commit();
        expect(r.isDirty()).toBe(false);
        expect(r.get('name')).toBe('Bob');
    });
    it('reject() reverts to original values', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        r.reject();
        expect(r.isDirty()).toBe(false);
        expect(r.get('name')).toBe('Alice');
    });

    describe('createRecord conversion', () => {
        it('coerces raw values to the field type at ingest', () => {
            const model = new Model([{ name: 'n', type: 'number' }]);
            expect(model.createRecord({ n: '10' }).get('n')).toBe(10);
            expect(model.createRecord({ n: '9' }).get('n')).toBe(9);
        });
        it('coerces a typed defaultValue through the same path', () => {
            const model = new Model([{ name: 'n', type: 'number', defaultValue: 0 }]);
            expect(model.createRecord({}).get('n')).toBe(0);
        });
    });

    describe('set conversion', () => {
        it('coerces the assigned value to the field type', () => {
            const model = new Model([{ name: 'n', type: 'number' }]);
            const r = model.createRecord({ n: 1 });
            r.set('n', '42');
            expect(r.get('n')).toBe(42);
        });
        it('passes values through unchanged for unknown fields', () => {
            const r = makeRecord({ name: 'Alice' });
            r.set('unknown', '7');
            expect(r.get('unknown')).toBe('7');
        });
    });

    describe('getChanges / getModified', () => {
        it('returns an empty map for a clean record', () => {
            expect(makeRecord({ name: 'Alice' }).getChanges()).toEqual({});
        });
        it('returns { old, new } for each changed field', () => {
            const r = makeRecord({ name: 'Alice', age: 30 });
            r.set('name', 'Bob');
            expect(r.getChanges()).toEqual({ name: { old: 'Alice', new: 'Bob' } });
        });
        it('getModified mirrors getChanges', () => {
            const r = makeRecord({ name: 'Alice' });
            r.set('name', 'Bob');
            expect(r.getModified()).toEqual(r.getChanges());
        });
    });

    describe('getInternalId', () => {
        it('assigns a unique, monotonic id per record', () => {
            const a = makeRecord();
            const b = makeRecord();
            expect(typeof a.getInternalId()).toBe('number');
            expect(b.getInternalId()).toBeGreaterThan(a.getInternalId());
        });
    });

    describe('clone', () => {
        it('produces a new internalId and is marked new and dirty', () => {
            const r = makeRecord({ name: 'Alice' });
            const copy = r.clone();
            expect(copy.getInternalId()).not.toBe(r.getInternalId());
            expect(copy.isNew()).toBe(true);
            expect(copy.isDirty()).toBe(true);
            expect(copy.get('name')).toBe('Alice');
        });
        it('copies field data independently of the source', () => {
            const r = makeRecord({ name: 'Alice' });
            const copy = r.clone();
            copy.set('name', 'Bob');
            expect(r.get('name')).toBe('Alice');
        });
    });

    describe('validation', () => {
        it('reports valid when all rules pass', () => {
            const model = new Model([{ name: 'name', validators: [{ type: 'required' }] }]);
            const r = model.createRecord({ name: 'Alice' });
            expect(r.isValid()).toBe(true);
            expect(r.getErrors()).toEqual({});
            expect(r.validateField('name')).toBe('');
        });
        it('reports a required-field error', () => {
            const model = new Model([{ name: 'name', validators: [{ type: 'required' }] }]);
            const r = model.createRecord({ name: '' });
            expect(r.isValid()).toBe(false);
            expect(r.validateField('name')).toBe('This field is required.');
            expect(r.getErrors()).toHaveProperty('name');
        });
        it('honours length, range, and pattern rules', () => {
            const model = new Model([
                { name: 'short', validators: [{ type: 'minLength', min: 3 }] },
                { name: 'big', type: 'number', validators: [{ type: 'max', max: 5 }] },
                { name: 'code', validators: [{ type: 'regex', pattern: /^[A-Z]+$/ }] },
            ]);
            const r = model.createRecord({ short: 'ab', big: 10, code: 'abc' });
            expect(r.validateField('short')).not.toBe('');
            expect(r.validateField('big')).not.toBe('');
            expect(r.validateField('code')).not.toBe('');
        });
        it('honours a custom predicate rule', () => {
            const model = new Model([
                { name: 'even', type: 'number', validators: [{ type: 'custom', predicate: (v) => Number(v) % 2 === 0 }] },
            ]);
            expect(model.createRecord({ even: 3 }).validateField('even')).not.toBe('');
            expect(model.createRecord({ even: 4 }).validateField('even')).toBe('');
        });
        it('runs an implicit type check before explicit validators', () => {
            const model = new Model([{ name: 'n', type: 'number' }]);
            const r = model.createRecord({ n: 1 });
            (r as unknown as { _data: Record<string, any> })._data.n = NaN;
            expect(r.validateField('n')).toBe('Value is not a valid number.');
        });
        it('returns empty for an unknown field', () => {
            expect(makeRecord({ name: 'Alice' }).validateField('nope')).toBe('');
        });
    });
});
