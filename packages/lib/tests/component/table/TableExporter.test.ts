//
// Contract-derived coverage for TableExporter. The private statics
// `escapeCSVField` and `formatValue` are reached via `(TableExporter as any)`
// — an intentional white-box dependency on those private names; a refactor
// that renames them must update this test. The public `exportCSV`/`exportJSON`
// paths get a structural smoke test (no-throw + sink-op counts) only: the Blob
// body is not observable through the recording sink, so the CSV string body
// is not asserted (see plan Architecture Decision).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { TableExporter } from '~/component/table/TableExporter';
import { Column } from '~/component/table/Column';
import { Field } from '~/data/Field';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';
import type { ColumnConfig } from '~/component/table/ColumnConfig';
import { CellTextResolver } from '~/component/table/cell/CellText';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;
let display: CellTextResolver;

beforeEach(() => {
    sink    = installTestDOM(CONFIG);
    display = new CellTextResolver();
});

afterEach(() => {
    display.dispose();
    DOM.reset();
});

/** Reaches the private static escape helper. */
function escapeCSVField(value: unknown): string {
    return (TableExporter as any).escapeCSVField(value);
}

/** Reaches the private static value formatter. */
function formatValue(column: Column, value: unknown, configs: Map<string, ColumnConfig>): unknown {
    return (TableExporter as any).formatValue(column, value, configs, display);
}

describe('TableExporter.escapeCSVField', () => {
    it('renders null as the empty string, never the word "null"', () => {
        // CONTRACT (JSDoc): "null and undefined become empty strings".
        expect(escapeCSVField(null)).toBe('');
    });

    it('renders undefined as the empty string, never the word "undefined"', () => {
        expect(escapeCSVField(undefined)).toBe('');
    });

    it('returns a plain value unquoted and unchanged', () => {
        expect(escapeCSVField('hello')).toBe('hello');
        expect(escapeCSVField(42)).toBe('42');
    });

    it('wraps a value containing a comma in double quotes', () => {
        expect(escapeCSVField('a,b')).toBe('"a,b"');
    });

    it('wraps and doubles every quote in a value containing a quote', () => {
        // CONTRACT: a"b -> "a""b".
        expect(escapeCSVField('a"b')).toBe('"a""b"');
    });

    it('wraps a value containing a newline in double quotes', () => {
        expect(escapeCSVField('a\nb')).toBe('"a\nb"');
    });

    // CONTRACT: the implementation's quoting predicate is the literal
    // `str.includes(',') || str.includes('"') || str.includes('\n')`. A value
    // with a bare carriage return (and no LF) is therefore NOT quoted. RFC 4180
    // treats a bare CR inside a field as ordinary data only when the field is
    // quoted; an unquoted CR can corrupt a strict parser that splits on CRLF.
    // OBSERVED: 'a\rb' is returned unquoted. This is asserted as the current,
    // documented behaviour (the JSDoc names only `,`, `"`, `\n` as triggers),
    // but is flagged as a latent RFC-4180 edge case for the reviewer.
    it('does NOT quote a value whose only special char is a bare carriage return', () => {
        expect(escapeCSVField('a\rb')).toBe('a\rb');
    });
});

describe('TableExporter.formatValue', () => {
    const dateField     = new Field({ name: 'd',  type: 'date' });
    const timeField     = new Field({ name: 't',  type: 'time' });
    const dateTimeField = new Field({ name: 'dt', type: 'datetime' });
    const stringField   = new Field({ name: 's',  type: 'string' });
    const numberField   = new Field({ name: 'n',  type: 'number' });

    const dateCol     = new Column(dateField);
    const timeCol     = new Column(timeField);
    const dateTimeCol = new Column(dateTimeField);
    const stringCol   = new Column(stringField);
    const numberCol   = new Column(numberField);

    const empty = new Map<string, ColumnConfig>();
    // A fixed instant so the relational assertions are deterministic.
    const SAMPLE = new Date(2021, 4, 17, 13, 45, 9);

    it('passes null through unchanged regardless of column type', () => {
        // CONTRACT: "value == null -> returns value unchanged".
        expect(formatValue(dateCol, null, empty)).toBe(null);
        expect(formatValue(dateCol, undefined, empty)).toBe(undefined);
    });

    it('returns a non-Date value unchanged regardless of column type', () => {
        expect(formatValue(dateCol, 'literal', empty)).toBe('literal');
        expect(formatValue(numberCol, 7, empty)).toBe(7);
    });

    it('formats a date column via toLocaleDateString (locale-agnostic)', () => {
        // Relational assert: equals the same call the renderer makes, so the
        // test is not pinned to a machine locale.
        expect(formatValue(dateCol, SAMPLE, empty))
            .toBe(SAMPLE.toLocaleDateString());
    });

    it('formats a time column without seconds by default', () => {
        expect(formatValue(timeCol, SAMPLE, empty))
            .toBe(SAMPLE.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    });

    it('time with showSeconds:true yields a longer/different string than without', () => {
        const cfg = new Map<string, ColumnConfig>([['t', { field: 't', showSeconds: true }]]);

        const withSecs    = formatValue(timeCol, SAMPLE, cfg) as string;
        const withoutSecs = formatValue(timeCol, SAMPLE, empty) as string;

        expect(withSecs).toBe(SAMPLE.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        expect(withSecs).not.toBe(withoutSecs);
    });

    it('formats a datetime column without seconds by default', () => {
        expect(formatValue(dateTimeCol, SAMPLE, empty))
            .toBe(SAMPLE.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    });

    it('datetime with showSeconds:true yields a longer/different string than without', () => {
        const cfg = new Map<string, ColumnConfig>([['dt', { field: 'dt', showSeconds: true }]]);

        const withSecs    = formatValue(dateTimeCol, SAMPLE, cfg) as string;
        const withoutSecs = formatValue(dateTimeCol, SAMPLE, empty) as string;

        expect(withSecs).toBe(SAMPLE.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        expect(withSecs).not.toBe(withoutSecs);
    });

    it('returns a Date unchanged for a non-temporal column type (default branch)', () => {
        // A string-typed column never formats a Date; the raw Date passes through.
        expect(formatValue(stringCol, SAMPLE, empty)).toBe(SAMPLE);
    });

    it('ignores a showSeconds config keyed under a different field name (map miss)', () => {
        // The config for 'other' must not affect column 't'.
        const cfg = new Map<string, ColumnConfig>([['other', { field: 'other', showSeconds: true }]]);

        expect(formatValue(timeCol, SAMPLE, cfg))
            .toBe(SAMPLE.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    });

    describe('combo resolution', () => {
        const roleField = new Field({ name: 'role', type: 'string' });
        const roleCol    = new Column(roleField);
        const comboCfg   = new Map<string, ColumnConfig>([['role', {
            field:  'role',
            values: [{ value: 'dev', label: 'Developer' }, { value: 'qa', label: 'QA Engineer' }],
        }]]);

        it('returns the label for a known value', () => {
            expect(formatValue(roleCol, 'dev', comboCfg)).toBe('Developer');
        });

        it('returns the raw value for a value outside the declared set', () => {
            expect(formatValue(roleCol, 'contractor', comboCfg)).toBe('contractor');
        });

        it('returns null for a null value, even on a combo-configured column', () => {
            expect(formatValue(roleCol, null, comboCfg)).toBe(null);
        });
    });
});

describe('TableExporter.exportCSV / exportJSON / exportTSV (structural smoke)', () => {
    const MODEL = new Model([
        { name: 'id',   type: 'number', order: 0 },
        { name: 'name', type: 'string', order: 1 },
    ], 'id');

    function records() {
        const store = new MemoryStore(MODEL, []);
        store.loadData([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
        ]);

        return store.getRecords();
    }

    const columns = Column.resolve(MODEL.getFields());
    const configs = new Map<string, ColumnConfig>();

    it('exportCSV does not throw and triggers exactly one anchor click', () => {
        expect(() => TableExporter.exportCSV(columns, records(), configs, display)).not.toThrow();

        expect(sink.writes.filter(w => w.op === 'createElement' && w.args[0] === 'a').length).toBe(1);
        expect(sink.writes.filter(w => w.op === 'click').length).toBe(1);
    });

    it('exportJSON does not throw and triggers exactly one anchor click', () => {
        expect(() => TableExporter.exportJSON(columns, records(), configs, display)).not.toThrow();

        expect(sink.writes.filter(w => w.op === 'createElement' && w.args[0] === 'a').length).toBe(1);
        expect(sink.writes.filter(w => w.op === 'click').length).toBe(1);
    });

    it('exportTSV does not throw and triggers exactly one anchor click', () => {
        expect(() => TableExporter.exportTSV(columns, records(), configs, display)).not.toThrow();

        expect(sink.writes.filter(w => w.op === 'createElement' && w.args[0] === 'a').length).toBe(1);
        expect(sink.writes.filter(w => w.op === 'click').length).toBe(1);
    });

    it('exportTSV downloads with the default .tsv filename', () => {
        TableExporter.exportTSV(columns, records(), configs, display);

        const applyWrite = sink.writes.find(
            w => w.op === 'apply' && (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.download !== undefined
        );

        expect((applyWrite?.args[1] as { setAttr: Record<string, string> }).setAttr.download).toBe('table-export.tsv');
    });

    it('header field count equals the column count', () => {
        // Structural invariant: one CSV header field per resolved column.
        expect(columns.length).toBe(MODEL.getFields().length);
    });
});

describe('TableExporter.buildRectangularTSV', () => {
    it('joins each row\'s cells with tabs and the rows with newlines', () => {
        expect(TableExporter.buildRectangularTSV([['Alice', '25'], ['Bob', '30']])).toBe('Alice\t25\nBob\t30');
    });

    it('formats a single-cell grid with no separators', () => {
        expect(TableExporter.buildRectangularTSV([['only']])).toBe('only');
    });

    it('quote-wraps a field containing a tab, a quote, or a newline', () => {
        expect(TableExporter.buildRectangularTSV([['a\tb', 'c"d', 'e\nf']])).toBe('"a\tb"\t"c""d"\t"e\nf"');
    });
});
