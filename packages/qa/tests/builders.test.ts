import { describe, expect, it } from 'vitest';
import {
    barSeries,
    codeDocument,
    DEPARTMENTS,
    folderNodes,
    folderRows,
    lineSeriesPoints,
    listItems,
    markdownDocument,
    outlineLabels,
    tableRows,
} from '../src/builders/data.js';
import { choice } from '../src/builders/params.js';

/** The deep shell's grips, in `choice`'s order: the first is the default. */
const GRIPS = ['dock-h', 'dock-v', 'sidebar', 'section', 'tab'] as const;

describe('P9 choice', () => {
    it('reads a listed value', () => {
        expect(choice(new URLSearchParams('grip=tab'), 'grip', GRIPS, 'shell-deep')).toBe('tab');
    });

    it.each(['', 'grip='])('defaults to the first value for %j', (query) => {
        expect(choice(new URLSearchParams(query), 'grip', GRIPS, 'shell-deep')).toBe('dock-h');
    });

    it('rejects an unlisted value, naming the panel and the choices', () => {
        expect(() => choice(new URLSearchParams('grip=nope'), 'grip', GRIPS, 'shell-deep'))
            .toThrow('shell-deep: unknown grip "nope" (expected dock-h, dock-v, sidebar, section, tab)');
    });
});

/**
 * The lines of a Markdown document that start with `prefix`.
 *
 * @param doc - The document.
 * @param prefix - The line prefix.
 * @returns The matching lines.
 */
function linesStarting(doc: string, prefix: string): string[] {
    return doc.split('\n').filter((line) => line.startsWith(prefix));
}

/**
 * How many bullet lists a Markdown document holds: runs of consecutive `- ` lines.
 *
 * @param doc - The document.
 * @returns The number of runs.
 */
function bulletLists(doc: string): number {
    const lines = doc.split('\n');

    return lines.filter((line, i) => line.startsWith('- ') && !(lines[i - 1] ?? '').startsWith('- ')).length;
}

describe('P10 data', () => {
    it.each([
        ['lineSeriesPoints', (): unknown => lineSeriesPoints(2, 20)],
        ['barSeries', (): unknown => barSeries(1)],
        ['tableRows', (): unknown => tableRows(20)],
        ['folderRows', (): unknown => folderRows(3)],
        ['folderNodes', (): unknown => folderNodes(3)],
        ['listItems', (): unknown => listItems(20)],
        ['outlineLabels', (): unknown => outlineLabels(20)],
        ['markdownDocument', (): unknown => markdownDocument(12, 1)],
        ['codeDocument', (): unknown => codeDocument(35)],
    ])('%s returns the same output on every call', (_name, generate) => {
        expect(generate()).toEqual(generate());
    });

    it('lineSeriesPoints keeps chart-line\'s rule', () => {
        expect(lineSeriesPoints(1, 3)).toEqual([{ x: 0, y: 23 }, { x: 1, y: 60 }, { x: 2, y: 97 }]);
    });

    it('barSeries gives 3 series of 12 categories', () => {
        const series = barSeries(0);

        expect(series).toHaveLength(3);
        expect(series.map((s) => s.data.map((p) => p.x))).toEqual(Array(3).fill(Array.from({ length: 12 }, (_, c) => c + 1)));
    });

    it('tableRows follows the field rules', () => {
        const rows = tableRows(3);

        expect(rows[0].id).toBe(1);
        expect(rows[0].name).toBe('Person 1');
        expect(rows[0].department).toBe(DEPARTMENTS[0]);
        expect(rows[0].active).toBe(false);
        expect(rows[0].notes).toBe('');
        expect(rows[2].notes).toBe('Note 3');
        expect(rows[1].hired).toEqual(new Date(Date.UTC(2010, 0, 98)));
        expect(rows[1].shiftStart).toEqual(new Date(Date.UTC(1970, 0, 1, 9, 15)));
    });

    it('folderRows gives 13 rows per root, children after their parent', () => {
        const rows = folderRows(2);

        expect(rows).toHaveLength(26);
        expect(rows[0].parentId).toBeNull();
        expect(rows[1].parentId).toBe(rows[0].id);
        expect(rows[2].parentId).toBe(rows[1].id);
        expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
        expect(rows.filter((row) => row.parentId === null)).toHaveLength(2);
    });

    it('folderNodes gives folders of 5 files', () => {
        const nodes = folderNodes(2);

        expect(nodes).toHaveLength(2);
        expect(nodes.map((node) => node.children?.length)).toEqual([5, 5]);
    });

    it('listItems and outlineLabels number their entries', () => {
        expect(listItems(2)).toEqual([{ id: 0, name: 'Item 0' }, { id: 1, name: 'Item 1' }]);
        expect(outlineLabels(2)).toEqual(['Outline entry 1', 'Outline entry 2']);
    });

    it('markdownDocument(8, 0) has 8 sections, 2 fences, 1 table and 2 bullet lists', () => {
        const doc = markdownDocument(8, 0);

        expect(linesStarting(doc, '# ')).toEqual(['# QA document']);
        expect(linesStarting(doc, '## ')).toHaveLength(8);
        expect(linesStarting(doc, '```ts')).toHaveLength(2);
        expect(linesStarting(doc, '| --- |')).toHaveLength(1);
        expect(bulletLists(doc)).toBe(2);
    });

    it('markdownDocument\'s variants differ in exactly the paragraph lines', () => {
        const draft = markdownDocument(8, 0).split('\n');
        const revised = markdownDocument(8, 1).split('\n');
        const differing = draft.filter((line, i) => line !== revised[i]);

        expect(revised).toHaveLength(draft.length);
        expect(differing).toHaveLength(8);
        expect(differing.every((line, i) => line.startsWith(`Section ${i + 1} draft`))).toBe(true);
    });

    it('codeDocument gives the asked-for lines of numbered blocks', () => {
        const lines = codeDocument(20).split('\n');

        expect(lines).toHaveLength(20);
        expect(lines[0]).toBe('function block0(value) {');
        expect(lines[10]).toBe('function block1(value) {');
        expect(codeDocument(7).split('\n')).toHaveLength(7);
    });
});
