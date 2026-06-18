import { describe, it, expect } from 'vitest';
import { MemoryProxy } from '~/data/proxy/MemoryProxy';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

describe('MemoryProxy', () => {
    it('read() resolves to the initial data', async () => {
        const proxy = new MemoryProxy({ data: [{ id: 1 }, { id: 2 }] });
        expect(await proxy.read()).toEqual([{ id: 1 }, { id: 2 }]);
    });
    it('read() returns a copy, not the internal array', async () => {
        const proxy = new MemoryProxy({ data: [{ id: 1 }] });
        const first = await proxy.read();
        first.push({ id: 99 });
        expect(await proxy.read()).toHaveLength(1);
    });
    it('setData() replaces the data', async () => {
        const proxy = new MemoryProxy({ data: [{ id: 1 }] });
        proxy.setData([{ id: 2 }, { id: 3 }]);
        expect(await proxy.read()).toHaveLength(2);
    });
    it('create() appends the record data', async () => {
        const proxy  = new MemoryProxy({ data: [] });
        const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
        await proxy.create(record);
        expect(await proxy.read()).toHaveLength(1);
    });
    it('destroy() removes the matching record by primary key', async () => {
        const proxy  = new MemoryProxy({ data: [{ id: 5, name: 'Eve' }] });
        const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
        await proxy.destroy(record);
        expect(await proxy.read()).toHaveLength(0);
    });
});
