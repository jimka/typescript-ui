import { describe, it, expect } from 'vitest';
import { Model } from '~/data/Model';
import { Field } from '~/data/Field';
import { HasManyAssociation, BelongsToAssociation } from '~/data/Association';

const EMPLOYEE = new Model([{ name: 'id' }, { name: 'name' }], 'id');

describe('Model constructor', () => {
    it('array form resolves fields and the primary key', () => {
        const model = new Model([{ name: 'id' }, { name: 'name' }], 'id');

        expect(model.getFields()).toHaveLength(2);
        expect(model.getFields().every(f => f instanceof Field)).toBe(true);
        expect(model.getPrimaryKeyField()?.getName()).toBe('id');
    });

    it('options-bag form assigns fields, primary key, and associations', () => {
        const model = new Model({
            fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMPLOYEE }],
        });

        expect(model.getPrimaryKeyField()?.getName()).toBe('id');
        expect(model.getAssociations()).toHaveLength(1);
        expect(model.getAssociation('emps')).toBeInstanceOf(HasManyAssociation);
    });

    it('reports undefined primary key field when none is configured', () => {
        const model = new Model([{ name: 'name' }]);

        expect(model.getPrimaryKeyField()).toBeUndefined();
    });
});

describe('AbstractModel field lookup', () => {
    it('getField returns the field for a present name, undefined otherwise', () => {
        const model = new Model([{ name: 'id' }, { name: 'name' }], 'id');

        expect(model.getField('name')).toBeInstanceOf(Field);
        expect(model.getField('missing')).toBeUndefined();
    });

    it('hasField is true for a present name and false otherwise', () => {
        const model = new Model([{ name: 'id' }], 'id');

        expect(model.hasField('id')).toBe(true);
        expect(model.hasField('nope')).toBe(false);
    });

    it('promotes FieldOptions to Field and caches the resolved array by reference', () => {
        const model = new Model([{ name: 'id' }, { name: 'name' }], 'id');

        const first = model.getFields();

        expect(first[0]).toBeInstanceOf(Field);
        // The lazy index caches the resolved array; identity is the contract.
        expect(model.getFields()).toBe(first);
    });
});

describe('AbstractModel.createRecord', () => {
    it('object form applies field mapping and falls back to the default value', () => {
        const model = new Model([
            { name: 'id' },
            { name: 'label', mapping: 'title' },
            { name: 'active', defaultValue: true },
        ], 'id');

        const record = model.createRecord({ id: 1, title: 'Hello' });

        expect(record.get('label')).toBe('Hello');
        expect(record.get('active')).toBe(true);
    });

    it('array form assigns values by field order, not array index', () => {
        // Declared first-then-second, but order flips them: order 1 wins position 0.
        const model = new Model([
            { name: 'first', order: 2 },
            { name: 'second', order: 1 },
        ]);

        const record = model.createRecord(['A', 'B']);

        expect(record.get('second')).toBe('A');
        expect(record.get('first')).toBe('B');
    });

    it('seeds a hasMany child store from the nested array', () => {
        const dept = new Model({
            fields: [{ name: 'id' }, { name: 'name' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMPLOYEE }],
        });

        const record = dept.createRecord({ id: 1, name: 'Sales', emps: [{ id: 10, name: 'Ann' }] });
        const children = record.getAssociated('emps');

        expect(children.getCount()).toBe(1);
        expect(children.getAt(0)!.get('name')).toBe('Ann');
    });
});

describe('AbstractModel association schema', () => {
    it('promoteAssociation maps the kind discriminant to the concrete subclass', () => {
        const model = new Model({
            fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }],
            primaryKey: 'id',
            associations: [
                { accessor: 'emps', foreignKey: 'deptId', target: () => EMPLOYEE },
                { accessor: 'dept', foreignKey: 'deptId', kind: 'belongsTo', target: () => EMPLOYEE },
            ],
        });

        expect(model.getAssociation('emps')).toBeInstanceOf(HasManyAssociation);
        expect(model.getAssociation('dept')).toBeInstanceOf(BelongsToAssociation);
    });

    it('throws when an association nested key collides with a field mapping', () => {
        const model = new Model({
            fields: [{ name: 'tags', mapping: 'kids' }],
            associations: [{ accessor: 'kids', foreignKey: 'pid', target: () => EMPLOYEE }],
        });

        // assertNestedKeyFree runs on first index build (any indexing method).
        expect(() => model.getFields()).toThrow(/collides/);
    });
});
