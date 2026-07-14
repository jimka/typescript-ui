import { describe, it, expect } from 'vitest';
import { JsonWriter } from '~/data/proxy/Writer';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id');

describe('JsonWriter', () => {
    it('writeRecord serializes a single record as JSON.stringify(record.getData())', () => {
        const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
        const writer = new JsonWriter();
        expect(writer.writeRecord(record)).toBe(JSON.stringify(record.getData()));
    });
    it('writeRecords serializes a batch as a JSON array in input order', () => {
        const a = new ModelRecord(MODEL, { id: 1, name: 'Ann' });
        const b = new ModelRecord(MODEL, { id: 2, name: 'Bob' });
        const writer = new JsonWriter();
        expect(writer.writeRecords([a, b])).toBe(JSON.stringify([a.getData(), b.getData()]));
    });
    it('writeRecords serializes a single-element batch as a one-element array', () => {
        const a = new ModelRecord(MODEL, { id: 1, name: 'Ann' });
        const writer = new JsonWriter();
        expect(writer.writeRecords([a])).toBe(JSON.stringify([a.getData()]));
    });
    it('writeRecords serializes an empty batch as "[]"', () => {
        expect(new JsonWriter().writeRecords([])).toBe('[]');
    });

    describe("mode: 'dirty'", () => {
        it('writeRecord on an update with one changed field sends only that field plus the pk', () => {
            const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
            record.set('name', 'Zoe');
            const writer = new JsonWriter({ mode: 'dirty' });
            expect(writer.writeRecord(record, 'update')).toBe(JSON.stringify({ name: 'Zoe', id: 5 }));
        });
        it('writeRecord on a create always sends the full record', () => {
            const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
            const writer = new JsonWriter({ mode: 'dirty' });
            expect(writer.writeRecord(record, 'create')).toBe(JSON.stringify(record.getData()));
        });
        it('writeRecord with no operation defaults to the full record', () => {
            const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
            record.set('name', 'Zoe');
            const writer = new JsonWriter({ mode: 'dirty' });
            expect(writer.writeRecord(record)).toBe(JSON.stringify(record.getData()));
        });
        it('writeRecords on an update batch sends each record\'s changed data, in order', () => {
            const a = new ModelRecord(MODEL, { id: 1, name: 'Ann' });
            const b = new ModelRecord(MODEL, { id: 2, name: 'Bob' });
            a.set('name', 'Annie');
            b.set('name', 'Bobby');
            const writer = new JsonWriter({ mode: 'dirty' });
            expect(writer.writeRecords([a, b], 'update')).toBe(JSON.stringify([a.getChangedData(), b.getChangedData()]));
        });
    });

    describe("mode: 'full' (default)", () => {
        it('writeRecord ignores the operation and always sends the full record', () => {
            const record = new ModelRecord(MODEL, { id: 5, name: 'Eve' });
            record.set('name', 'Zoe');
            const writer = new JsonWriter();
            expect(writer.writeRecord(record, 'update')).toBe(JSON.stringify(record.getData()));
        });
    });
});
