import { describe, it, expect } from 'vitest';
import { Store } from '~/data/Store';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import { Proxy, ReadParams } from '~/data/proxy/Proxy';
import { HasManyAssociation, BelongsToAssociation } from '~/data/Association';

const EMPLOYEE = new Model({
    fields: [{ name: 'id' }, { name: 'name' }, { name: 'deptId', type: 'number' }],
    primaryKey: 'id',
});

const DEPARTMENT = new Model({
    fields: [{ name: 'id' }, { name: 'name' }],
    primaryKey: 'id',
    associations: [
        { accessor: 'employees', foreignKey: 'deptId', target: () => EMPLOYEE },
    ],
});

describe('Association descriptor', () => {
    it('promotes a plain options object to HasManyAssociation by default', () => {
        const assoc = DEPARTMENT.getAssociation('employees')!;
        expect(assoc).toBeInstanceOf(HasManyAssociation);
        expect(assoc.kind).toBe('hasMany');
    });

    it('promotes a belongsTo options object to BelongsToAssociation', () => {
        const model = new Model({
            fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }],
            primaryKey: 'id',
            associations: [{ accessor: 'department', foreignKey: 'deptId', kind: 'belongsTo', target: () => DEPARTMENT }],
        });
        expect(model.getAssociation('department')).toBeInstanceOf(BelongsToAssociation);
    });

    it('defaults nestedKey to the accessor and persist to proxy', () => {
        const assoc = DEPARTMENT.getAssociation('employees')!;
        expect(assoc.getNestedKey()).toBe('employees');
        expect(assoc.getPersist()).toBe('proxy');
    });

    it('honours an explicit nestedKey and persist mode', () => {
        const model = new Model({
            fields: [{ name: 'id' }],
            primaryKey: 'id',
            associations: [{ accessor: 'kids', foreignKey: 'pid', nestedKey: 'children', persist: 'nested', target: () => EMPLOYEE }],
        });
        const assoc = model.getAssociation('kids')!;
        expect(assoc.getNestedKey()).toBe('children');
        expect(assoc.getPersist()).toBe('nested');
    });

    it('memoises resolveTarget so the thunk runs at most once', () => {
        let calls = 0;
        const assoc = new HasManyAssociation({ accessor: 'a', foreignKey: 'fk', target: () => { calls++; return EMPLOYEE; } });
        expect(assoc.resolveTarget()).toBe(EMPLOYEE);
        assoc.resolveTarget();
        expect(calls).toBe(1);
    });

    it('exposes getAssociations and getAssociation on the model', () => {
        expect(DEPARTMENT.getAssociations()).toHaveLength(1);
        expect(DEPARTMENT.getAssociation('missing')).toBeUndefined();
    });

    it('rejects a nested key that collides with a field mapping', () => {
        const model = new Model({
            fields: [{ name: 'tags', mapping: 'kids' }],
            associations: [{ accessor: 'kids', foreignKey: 'pid', target: () => EMPLOYEE }],
        });
        expect(() => model.getAssociations()).toThrow(/collides/);
    });
});

describe('eager hydration', () => {
    it('seeds the child store from an embedded array, records committed not new', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann' }, { id: 11, name: 'Bob' }] });
        const children = dept.getAssociated('employees');

        expect(children.getCount()).toBe(2);
        expect(children.getAt(0)!.isNew()).toBe(false);
        expect(children.getAt(0)!.isDirty()).toBe(false);
        expect(children.getAt(0)!.get('name')).toBe('Ann');
    });

    it('excludes the embedded array from getData()', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann' }] });
        expect(dept.getData()).toEqual({ id: 1, name: 'Sales' });
        expect('employees' in dept.getData()).toBe(false);
    });

    it('returns the same child store instance on repeated access', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann' }] });
        const a = dept.getAssociated('employees');
        const b = dept.getAssociated('employees');
        expect(a).toBe(b);
    });

    it('a mutation through one accessor reference is seen by a listener on the same store', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann' }] });
        let added = 0;
        dept.getAssociated('employees').on('add', () => { added++; });
        dept.getAssociated('employees').add({ id: 12, name: 'Cy' });
        expect(added).toBe(1);
    });

    it('throws for an unknown accessor', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales' });
        expect(() => dept.getAssociated('nope')).toThrow(/no association 'nope'/);
    });
});

/**
 * A proxy that records the ReadParams it was handed so a test can assert the
 * parent-scoped filter rode along on the lazy load path.
 */
class RecordingProxy extends Proxy {
    public lastParams: ReadParams | undefined;
    read(params?: ReadParams): Promise<any[]> { this.lastParams = params; return Promise.resolve([]); }
    create(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

describe('lazy load', () => {
    it('loads the hasMany child store through the association proxy with the parent-FK filter', async () => {
        const proxy = new RecordingProxy();
        const EMP = new Model({ fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }], primaryKey: 'id' });
        const dept = new Model({
            fields: [{ name: 'id' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMP, proxy }],
        }).createRecord({ id: 7 });

        const child = dept.getAssociated('emps');
        expect(child.getActiveFilters()).toEqual([{ type: 'eq', field: 'deptId', value: 7 }]);

        await child.load();
        expect(proxy.lastParams?.filters).toEqual([{ type: 'eq', field: 'deptId', value: 7 }]);
    });

    it('loads the belongsTo owner store through the association proxy filtered on the target primary key', async () => {
        const proxy = new RecordingProxy();
        const emp = new Model({
            fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }],
            primaryKey: 'id',
            associations: [{ accessor: 'department', foreignKey: 'deptId', kind: 'belongsTo', target: () => DEPARTMENT, proxy }],
        }).createRecord({ id: 5, deptId: 42 });

        await emp.getAssociated('department').load();
        expect(proxy.lastParams?.filters).toEqual([{ type: 'eq', field: 'id', value: 42 }]);
    });

    it('rejects load() when the association carries no proxy', async () => {
        const EMP = new Model({ fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }], primaryKey: 'id' });
        const dept = new Model({
            fields: [{ name: 'id' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMP }],
        }).createRecord({ id: 7 });

        await expect(dept.getAssociated('emps').load()).rejects.toThrow(/no proxy is configured/);
    });
});

/**
 * A proxy that assigns sequential server ids to created records so cascade can
 * stamp the parent id onto its children.
 */
class IdAssigningProxy extends Proxy {
    private _next = 1;
    read(): Promise<any[]> { return Promise.resolve([]); }
    create(record: ModelRecord): Promise<Record<string, any>> {
        return Promise.resolve({ ...record.getData(), id: this._next++ });
    }
    update(record: ModelRecord): Promise<Record<string, any>> { return Promise.resolve(record.getData()); }
    destroy(): Promise<void> { return Promise.resolve(); }
}

describe('cascade sync', () => {
    it('stamps the parent server id onto a new child before the child syncs', async () => {
        const parentProxy = new IdAssigningProxy();

        const EMP = new Model({ fields: [{ name: 'id' }, { name: 'name' }, { name: 'deptId', type: 'number' }], primaryKey: 'id' });
        const DEPT = new Model({
            fields: [{ name: 'id' }, { name: 'name' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMP }],
        });

        const deptStore = new Store({ model: DEPT, proxy: parentProxy });
        const [dept] = deptStore.add({ name: 'Sales' });

        // Materialise the child store and add a child while the parent has no id.
        const emps = dept.getAssociated('emps');
        emps.add({ name: 'Ann' });

        expect(dept.getId()).toBeUndefined();
        expect(emps.getAt(0)!.get('deptId')).toBeUndefined();

        await deptStore.sync();

        // Parent received id 1; the cascade stamped the child's FK to it before
        // the child store's own sync() (a no-op here, since the child store has
        // no proxy — the stamp is the cascade's observable effect).
        expect(dept.getId()).toBe(1);
        expect(emps.getAt(0)!.get('deptId')).toBe(1);
    });

    it('cascadeSync:false skips the child walk entirely', async () => {
        const parentProxy = new IdAssigningProxy();

        const EMP = new Model({ fields: [{ name: 'id' }, { name: 'name' }, { name: 'deptId', type: 'number' }], primaryKey: 'id' });
        const DEPT = new Model({
            fields: [{ name: 'id' }, { name: 'name' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMP }],
        });

        const deptStore = new Store({ model: DEPT, proxy: parentProxy, cascadeSync: false });
        const [dept] = deptStore.add({ name: 'Sales' });
        const emps = dept.getAssociated('emps');
        emps.add({ name: 'Ann' });

        await deptStore.sync();

        // The parent still got its id, but no FK stamp ran (cascade skipped).
        expect(dept.getId()).toBe(1);
        expect(emps.getAt(0)!.get('deptId')).toBeUndefined();
    });

    it('does not walk an association whose child store was never materialised', async () => {
        const parentProxy = new IdAssigningProxy();

        const EMP = new Model({ fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }], primaryKey: 'id' });
        const DEPT = new Model({
            fields: [{ name: 'id' }, { name: 'name' }],
            primaryKey: 'id',
            associations: [{ accessor: 'emps', foreignKey: 'deptId', target: () => EMP }],
        });

        const deptStore = new Store({ model: DEPT, proxy: parentProxy });
        deptStore.add({ name: 'Sales' });

        // No getAssociated() call → no child store → cascade is a no-op and sync resolves.
        await expect(deptStore.sync()).resolves.toBeUndefined();
    });
});

describe('belongsTo', () => {
    const EMP = new Model({
        fields: [{ name: 'id' }, { name: 'deptId', type: 'number' }],
        primaryKey: 'id',
        associations: [{ accessor: 'department', foreignKey: 'deptId', kind: 'belongsTo', target: () => DEPARTMENT }],
    });

    it('getForeignKeyValue returns the FK without loading', () => {
        const emp = EMP.createRecord({ id: 5, deptId: 42 });
        expect(emp.getForeignKeyValue('department')).toBe(42);
    });

    it('getAssociated returns an owner-scoped store filtered on the target primary key', () => {
        const emp = EMP.createRecord({ id: 5, deptId: 42 });
        const owner = emp.getAssociated('department');
        expect(owner.getActiveFilters()).toEqual([{ type: 'eq', field: 'id', value: 42 }]);
    });

    it('getForeignKeyValue throws for an unknown accessor', () => {
        const emp = EMP.createRecord({ id: 5, deptId: 42 });
        expect(() => emp.getForeignKeyValue('nope')).toThrow(/no association 'nope'/);
    });
});

describe('getDataWithNested', () => {
    it('omits children for proxy-persist associations', () => {
        const dept = DEPARTMENT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann' }] });
        dept.getAssociated('employees');
        expect(dept.getDataWithNested()).toEqual({ id: 1, name: 'Sales' });
    });

    it('embeds materialised children for a nested-persist association under the nested key', () => {
        const NESTED_DEPT = new Model({
            fields: [{ name: 'id' }, { name: 'name' }],
            primaryKey: 'id',
            associations: [{ accessor: 'employees', foreignKey: 'deptId', persist: 'nested', target: () => EMPLOYEE }],
        });
        const dept = NESTED_DEPT.createRecord({ id: 1, name: 'Sales', employees: [{ id: 10, name: 'Ann', deptId: 1 }] });
        dept.getAssociated('employees');

        const data = dept.getDataWithNested();
        expect(data.id).toBe(1);
        expect(data.employees).toHaveLength(1);
        expect(data.employees[0].name).toBe('Ann');
    });

    it('omits a nested association whose child store was never built', () => {
        const NESTED_DEPT = new Model({
            fields: [{ name: 'id' }],
            primaryKey: 'id',
            associations: [{ accessor: 'employees', foreignKey: 'deptId', persist: 'nested', target: () => EMPLOYEE }],
        });
        const dept = NESTED_DEPT.createRecord({ id: 1 });
        expect('employees' in dept.getDataWithNested()).toBe(false);
    });
});
