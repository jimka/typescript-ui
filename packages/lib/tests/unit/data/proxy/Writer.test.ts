import { describe, it, expect } from 'vitest';
import { JsonWriter } from '~/data/proxy/Writer';
import type { WriteOperation } from '~/data/proxy/Writer';
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';
import { toLocalIsoString } from '~/data/temporalValue';

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

    describe('temporal values', () => {
        const TEMPORAL = new Model([
            { name: 'id' },
            { name: 'd',  type: 'date' },
            { name: 't',  type: 'time' },
            { name: 'dt', type: 'datetime' },
            { name: 'a',  type: 'auto' },
        ], 'id');

        const D  = new Date(2026, 5, 28);
        const T  = new Date(1970, 0, 1, 9, 30, 15, 250);
        const DT = new Date(2026, 5, 28, 12, 4, 59, 123);
        const A  = new Date(2026, 0, 2, 3, 4, 5, 6);

        /** A record holding one value of each temporal type, plus an auto Date. */
        function temporalRecord(id: number): ModelRecord {
            return new ModelRecord(TEMPORAL, { id, d: D, t: T, dt: DT, a: A });
        }

        it('writeRecord writes each Date in its field type\'s form', () => {
            expect(JSON.parse(new JsonWriter().writeRecord(temporalRecord(1)))).toEqual({
                id: 1,
                d:  '2026-06-28',
                t:  '09:30:15.250',
                dt: toLocalIsoString(DT),
                a:  toLocalIsoString(A),
            });
        });

        it('writes an Invalid Date as null', () => {
            const record = new ModelRecord(TEMPORAL, { id: 1, dt: new Date(NaN) });

            expect(JSON.parse(new JsonWriter().writeRecord(record)).dt).toBe(null);
        });

        it('leaves a Date inside an object value to JSON.stringify', () => {
            const record = new ModelRecord(TEMPORAL, { id: 1, a: { when: DT } });

            expect(JSON.parse(new JsonWriter().writeRecord(record)).a).toEqual({ when: DT.toISOString() });
        });

        it('writeRecords applies the same forms to every record', () => {
            const parsed = JSON.parse(new JsonWriter().writeRecords([temporalRecord(1), temporalRecord(2)]));

            expect(parsed).toHaveLength(2);

            for (const row of parsed) {
                expect(row.d).toBe('2026-06-28');
                expect(row.t).toBe('09:30:15.250');
                expect(row.dt).toBe(toLocalIsoString(DT));
            }
        });

        it("'dirty' mode writes only the changed date, by field type, plus the pk", () => {
            const record = new ModelRecord(TEMPORAL, { id: 5, d: new Date(2026, 0, 1), t: T });
            record.commit();
            record.set('d', D);

            expect(new JsonWriter({ mode: 'dirty' }).writeRecord(record, 'update'))
                .toBe(JSON.stringify({ d: '2026-06-28', id: 5 }));
        });

        it('a subclass overriding dataFor still has its Dates written by field type', () => {
            class DropAutoWriter extends JsonWriter {
                protected dataFor(record: ModelRecord, operation?: WriteOperation): Record<string, any> {
                    const { a: _dropped, ...rest } = super.dataFor(record, operation);

                    return rest;
                }
            }

            expect(JSON.parse(new DropAutoWriter().writeRecord(temporalRecord(1)))).toEqual({
                id: 1,
                d:  '2026-06-28',
                t:  '09:30:15.250',
                dt: toLocalIsoString(DT),
            });
        });
    });
});
