import { describe, it, expect } from 'vitest';
import { JsonReader } from '~/data/proxy/Reader';

describe('JsonReader', () => {
    // --- unpaginated, no root ---
    it('returns the top-level array as records when unpaginated with no root', () => {
        const reader = new JsonReader();
        expect(reader.read([{ id: 1 }, { id: 2 }], false)).toEqual({ records: [{ id: 1 }, { id: 2 }] });
    });
    it('throws when an unpaginated body is not an array and no root is set', () => {
        const reader = new JsonReader();
        expect(() => reader.read({ data: [] }, false)).toThrow(/not an array and no root/);
    });

    // --- unpaginated, with root ---
    it('unwraps root to the records array when unpaginated', () => {
        const reader = new JsonReader({ root: 'payload' });
        expect(reader.read({ payload: [{ id: 1 }] }, false)).toEqual({ records: [{ id: 1 }] });
    });
    it('throws when the configured root does not resolve to an array', () => {
        const reader = new JsonReader({ root: 'payload' });
        expect(() => reader.read({ payload: { id: 1 } }, false)).toThrow(/root 'payload' did not resolve to an array/);
    });

    // --- paginated, default keys ---
    it('reads records and a numeric total from the default envelope', () => {
        const reader = new JsonReader();
        expect(reader.read({ data: [{ id: 1 }], total: 42 }, true)).toEqual({
            records: [{ id: 1 }],
            total: 42,
            success: undefined,
            message: undefined,
        });
    });
    it('coerces a non-numeric or missing total to undefined', () => {
        const reader = new JsonReader();
        expect(reader.read({ data: [], total: '42' }, true).total).toBeUndefined();
        expect(reader.read({ data: [] }, true).total).toBeUndefined();
    });
    it('carries success only when boolean and message only when string', () => {
        const reader = new JsonReader();
        const ok = reader.read({ data: [], success: true, message: 'fine' }, true);
        expect(ok.success).toBe(true);
        expect(ok.message).toBe('fine');

        const bad = reader.read({ data: [], success: 'yes', message: 0 }, true);
        expect(bad.success).toBeUndefined();
        expect(bad.message).toBeUndefined();
    });

    // --- paginated, custom keys ---
    it('reads the configured rootProperty / totalProperty', () => {
        const reader = new JsonReader({ rootProperty: 'rows', totalProperty: 'count' });
        expect(reader.read({ rows: [{ id: 1 }], count: 7 }, true)).toEqual({
            records: [{ id: 1 }],
            total: 7,
            success: undefined,
            message: undefined,
        });
    });

    // --- paginated, with root ---
    it('unwraps root to the envelope before reading paginated keys', () => {
        const reader = new JsonReader({ root: 'result' });
        expect(reader.read({ result: { data: [{ id: 1 }], total: 3 } }, true)).toEqual({
            records: [{ id: 1 }],
            total: 3,
            success: undefined,
            message: undefined,
        });
    });

    // --- paginated error shapes ---
    it('throws when a paginated body is not an envelope object', () => {
        const reader = new JsonReader();
        expect(() => reader.read(null, true)).toThrow(/not an envelope object/);
        expect(() => reader.read(42, true)).toThrow(/not an envelope object/);
    });
    it("throws when the envelope's rootProperty is not an array", () => {
        const reader = new JsonReader();
        expect(() => reader.read({ data: 'nope', total: 1 }, true)).toThrow(/'data' is not an array/);
    });

    // --- explicit mode overrides the paginated flag ---
    it("mode 'envelope' parses the envelope even when the read is unpaginated", () => {
        const reader = new JsonReader({ rootProperty: 'rows', totalProperty: 'totalCount', mode: 'envelope' });
        expect(reader.read({ rows: [{ id: 1 }], totalCount: 5 }, false)).toEqual({
            records: [{ id: 1 }],
            total: 5,
            success: undefined,
            message: undefined,
        });
    });
    it("mode 'envelope' still throws on a non-envelope body when unpaginated", () => {
        const reader = new JsonReader({ mode: 'envelope' });
        expect(() => reader.read(42, false)).toThrow(/not an envelope object/);
    });
    it("mode 'array' parses a top-level array even when the read is paginated", () => {
        const reader = new JsonReader({ mode: 'array' });
        expect(reader.read([{ id: 1 }, { id: 2 }], true)).toEqual({ records: [{ id: 1 }, { id: 2 }] });
    });
    it("mode 'auto' (default) still keys the parse off the paginated flag", () => {
        const reader = new JsonReader();
        expect(reader.read([{ id: 1 }], false)).toEqual({ records: [{ id: 1 }] });
        expect(reader.read({ data: [{ id: 1 }], total: 1 }, true).total).toBe(1);
    });
});
