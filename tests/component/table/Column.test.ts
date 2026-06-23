// Pure constructor/round-trip + Column.resolve ordering coverage. No DOM seam
// is needed — Column and Field are plain value objects — so this file does not
// install the test DOM.
import { describe, it, expect } from 'vitest';
import { Column } from '~/component/table/Column';
import { Field } from '~/data/Field';
import type { ColumnConfig, ColumnSpec } from '~/component/table/ColumnConfig';

describe('Column constructor defaults', () => {
    it('defaults every optional config field when no config is given', () => {
        // CONTRACT (Column constructor): minWidth/maxWidth -> undefined;
        // hidden/unhideable/readOnly -> false; headerGlyph/group/groupColor -> null.
        const col = new Column(new Field({ name: 'x' }));

        expect(col.getMinWidth()).toBeUndefined();
        expect(col.getMaxWidth()).toBeUndefined();
        expect(col.isInitiallyHidden()).toBe(false);
        expect(col.isUnhideable()).toBe(false);
        expect(col.isReadOnly()).toBe(false);
        expect(col.getHeaderGlyph()).toBe(null);
        expect(col.getGroup()).toBe(null);
        expect(col.getGroupColor()).toBe(null);
    });

    it('round-trips every provided config field through its getter', () => {
        const config: ColumnConfig = {
            field:       'x',
            minWidth:    50,
            maxWidth:    200,
            hidden:      true,
            unhideable:  true,
            readOnly:    true,
            headerGlyph: 'star',
            group:       'g1',
            groupColor:  '#abc',
        };
        const col = new Column(new Field({ name: 'x' }), config);

        expect(col.getMinWidth()).toBe(50);
        expect(col.getMaxWidth()).toBe(200);
        expect(col.isInitiallyHidden()).toBe(true);
        expect(col.isUnhideable()).toBe(true);
        expect(col.isReadOnly()).toBe(true);
        expect(col.getHeaderGlyph()).toBe('star');
        expect(col.getGroup()).toBe('g1');
        expect(col.getGroupColor()).toBe('#abc');
    });

    it('exposes the field it was constructed with', () => {
        const field = new Field({ name: 'x' });

        expect(new Column(field).getField()).toBe(field);
    });

    it('clearHeaderGlyph and setHeaderGlyph(null) both clear the glyph', () => {
        const col = new Column(new Field({ name: 'x' }), { field: 'x', headerGlyph: 'star' });

        expect(col.getHeaderGlyph()).toBe('star');

        col.setHeaderGlyph(null);
        expect(col.getHeaderGlyph()).toBe(null);

        col.setHeaderGlyph('again');
        col.clearHeaderGlyph();
        expect(col.getHeaderGlyph()).toBe(null);
    });
});

describe('Column.resolve', () => {
    // Deliberately declare fields whose array order differs from their
    // getOrder() so the "output tracks getOrder, not input order" invariant
    // has something to bite on.
    function fields(): Field[] {
        return [
            new Field({ name: 'c', order: 2 }),
            new Field({ name: 'a', order: 0 }),
            new Field({ name: 'b', order: 1 }),
        ];
    }

    it('with no spec, produces one Column per field sorted by getOrder()', () => {
        const cols = Column.resolve(fields());

        expect(cols.map(c => c.getField().getName())).toEqual(['a', 'b', 'c']);
    });

    it('output order tracks getOrder(), not input-array order nor spec.columns order', () => {
        const spec: ColumnSpec = {
            // Listed in a deliberately scrambled order.
            columns: [
                { field: 'c' },
                { field: 'a' },
                { field: 'b' },
            ],
        };
        const cols = Column.resolve(fields(), spec);

        expect(cols.map(c => c.getField().getName())).toEqual(['a', 'b', 'c']);
    });

    it('with appendUnlisted default (true), all fields survive and listed configs apply', () => {
        const spec: ColumnSpec = {
            columns: [{ field: 'b', minWidth: 99 }],
        };
        const cols = Column.resolve(fields(), spec);

        expect(cols.map(c => c.getField().getName())).toEqual(['a', 'b', 'c']);

        const b = cols.find(c => c.getField().getName() === 'b')!;
        expect(b.getMinWidth()).toBe(99);

        // Unlisted fields get a bare Column (no constraints).
        const a = cols.find(c => c.getField().getName() === 'a')!;
        expect(a.getMinWidth()).toBeUndefined();
    });

    it('with appendUnlisted:false, only listed fields survive, still in getOrder() order', () => {
        const spec: ColumnSpec = {
            appendUnlisted: false,
            columns: [
                { field: 'c' },
                { field: 'a' },
            ],
        };
        const cols = Column.resolve(fields(), spec);

        expect(cols.map(c => c.getField().getName())).toEqual(['a', 'c']);
    });

    it('a spec entry naming an absent field contributes no column', () => {
        const spec: ColumnSpec = {
            appendUnlisted: false,
            columns: [
                { field: 'a' },
                { field: 'ghost' },
            ],
        };
        const cols = Column.resolve(fields(), spec);

        expect(cols.map(c => c.getField().getName())).toEqual(['a']);
    });

    // CONTRACT: `configMap = new Map(spec.columns.map(c => [c.field, c]))`.
    // A Map built from duplicate keys keeps the LAST entry, so the surviving
    // config for a duplicated field is the last one listed. OBSERVED: minWidth
    // 222 wins over 111. This matches Map semantics; flagged for the reviewer as
    // a possibly-unintended silent override (the spec gives no precedence rule).
    it('duplicate field names in spec.columns: last config wins (Map semantics)', () => {
        const spec: ColumnSpec = {
            appendUnlisted: false,
            columns: [
                { field: 'a', minWidth: 111 },
                { field: 'a', minWidth: 222 },
            ],
        };
        const cols = Column.resolve(fields(), spec);

        // Only one column for 'a' (Set of listed names dedupes), carrying the
        // last config.
        expect(cols.filter(c => c.getField().getName() === 'a').length).toBe(1);
        expect(cols[0].getMinWidth()).toBe(222);
    });
});
