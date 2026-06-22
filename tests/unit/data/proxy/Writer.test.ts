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
});
