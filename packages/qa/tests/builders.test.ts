import { describe, expect, it } from 'vitest';
import {
    barSeries,
    codeDocument,
    DEPARTMENTS,
    diagramTree,
    editorDocument,
    folderNodes,
    folderRows,
    lineSeriesPoints,
    listItems,
    markdownDocument,
    outlineLabels,
    ROW_FILTER_TITLES,
    tableRows,
    wideRows,
} from '../src/builders/data.js';
import { lateId, pickStrip } from '../src/builders/dom.js';
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

    it('ROW_FILTER_TITLES holds two of tableRows\' five titles, admitting 2/5 of the rows', () => {
        const rows = tableRows(20);
        const titles = new Set(rows.map((r) => r.title));

        expect(ROW_FILTER_TITLES.size).toBe(2);

        for (const title of ROW_FILTER_TITLES) {
            expect(titles.has(title)).toBe(true);
        }

        expect(rows.filter((r) => ROW_FILTER_TITLES.has(r.title))).toHaveLength(8);
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

describe('P12 data', () => {
    it.each([
        ['diagramTree', (): unknown => diagramTree(20)],
        ['editorDocument', (): unknown => editorDocument(5)],
        ['wideRows', (): unknown => wideRows(20, 40)],
    ])('%s returns the same output on every call', (_name, generate) => {
        expect(generate()).toEqual(generate());
    });

    it('diagramTree(5) is a three-way tree of labelled nodes', () => {
        const tree = diagramTree(5);

        expect(tree.nodes).toEqual([0, 1, 2, 3, 4].map((i) => ({ id: `n${i}`, label: `Node ${i}` })));
        expect(tree.edges).toEqual([
            { id: 'e1', source: 'n0', target: 'n1' },
            { id: 'e2', source: 'n0', target: 'n2' },
            { id: 'e3', source: 'n0', target: 'n3' },
            { id: 'e4', source: 'n1', target: 'n4' },
        ]);
    });

    it('editorDocument(3) has 3 parts, then a table of 3 body rows', () => {
        const doc = editorDocument(3);
        const lines = doc.split('\n');
        const header = lines.indexOf('| Name | Owner | State | Size |');

        expect(lines[0]).toBe('# Editor document');
        expect(linesStarting(doc, '## ')).toEqual(['## Part 1', '## Part 2', '## Part 3']);
        expect(linesStarting(doc, 'Part ').map((line) => line.length)).toEqual([120, 120, 120]);
        expect(header).toBeGreaterThan(0);
        expect(lines[header + 1].startsWith('| --- |')).toBe(true);
        expect(lines.slice(header + 2).filter((line) => line.startsWith('| '))).toHaveLength(3);
    });

    it('wideRows follows its rule', () => {
        const rows = wideRows(2, 40);

        expect(rows[1].id).toBe(2);
        expect(rows[1].c40).toBe(527);
        expect(Object.keys(rows[0])).toEqual(['id', ...Array.from({ length: 40 }, (_, k) => `c${k + 1}`)]);
    });
});

describe('P13 pickStrip and lateId', () => {
    /**
     * A rectangle as `pickStrip` reads it.
     *
     * @param left - Its left edge.
     * @param top - Its top edge.
     * @param width - Its width.
     * @param height - Its height.
     * @returns The rectangle.
     */
    function rect(left: number, top: number, width: number, height: number): { left: number; top: number; width: number; height: number } {
        return { left, top, width, height };
    }

    it('picks the east strip: the greatest left, ties to the greatest height', () => {
        expect(pickStrip([rect(396, 0, 4, 4), rect(396, 4, 4, 292), rect(396, 296, 4, 4)], 'east')).toBe(1);
    });

    it('picks the south strip: the greatest top, ties to the greatest width', () => {
        expect(pickStrip([rect(0, 288, 4, 12), rect(4, 288, 392, 12), rect(396, 288, 12, 12)], 'south')).toBe(1);
    });

    it('lateId reads empty until its id is set', () => {
        const late = lateId();

        expect(late.target.getId()).toBe('');

        late.set('w7');

        expect(late.target.getId()).toBe('w7');
    });
});
