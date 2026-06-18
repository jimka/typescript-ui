import { describe, it, expect } from 'vitest';
import { Field } from '~/data/Field';

describe('Field', () => {
    it('stores the logical name', () => {
        expect(new Field({ name: 'age' }).getName()).toBe('age');
    });
    it("defaults the type to 'auto'", () => {
        expect(new Field({ name: 'age' }).getType()).toBe('auto');
    });
    it('keeps an explicit type', () => {
        expect(new Field({ name: 'age', type: 'number' }).getType()).toBe('number');
    });
    it('defaults the mapping to the field name', () => {
        expect(new Field({ name: 'age' }).getMapping()).toBe('age');
    });
    it('keeps an explicit mapping', () => {
        expect(new Field({ name: 'age', mapping: 'years' }).getMapping()).toBe('years');
    });
    it('falls back to the name for the description', () => {
        expect(new Field({ name: 'age' }).getDescription()).toBe('age');
    });
});
