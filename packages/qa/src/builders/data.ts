// The panels' data. Every generator is a pure function of its arguments — no
// random numbers, no clock — so two arms of a comparison render identical
// content, and a census that depends on the data (a chart's tick count, a
// list's rows) is reproducible. The library is imported for its types only,
// so the node tests can import this file.

import type { ChartSeries } from '@jimka/typescript-ui/component/chart';
import type { TreeNode } from '@jimka/typescript-ui/component/tree';

/** One `table-rows` record. */
export interface TableRow {
    id: number;
    name: string;
    email: string;
    department: string;
    title: string;
    salary: number;
    hired: Date;
    lastLogin: Date;
    shiftStart: Date;
    active: boolean;
    score: number;
    notes: string;
}

/** One `treetable-rows` record; `parentId` is `null` on a root. */
export interface FolderRow {
    id: number;
    parentId: number | null;
    name: string;
    size: number;
    modified: Date;
    kind: 'folder' | 'file';
}

/** One `list-items` record. */
export interface ListItem {
    id: number;
    name: string;
}

// `lineSeriesPoints`' rule fixes `chart-line`'s mark census, so it must not
// change without re-validating that panel.

/** y ∈ [0, 99]; with a 99 present the y axis nices to [0, 100], giving 11 ticks. */
export const Y_SPAN = 100;

/** Scatters consecutive points across [0, Y_SPAN): coprime with the span, so the values spread instead of repeating. */
const POINT_STRIDE = 37;

/** Shifts each series so the lines differ. */
const SERIES_OFFSET = 23;

/** Series per bar chart: three, like the line charts beside them. */
const BAR_SERIES = 3;

/** Categories per bar chart: a year of months, enough bars for the band axis to do real work. */
const BAR_CATEGORIES = 12;

/** Bar heights lie in [BAR_FLOOR, BAR_FLOOR + BAR_SPAN): every bar stands clear of the axis. */
const BAR_FLOOR = 10;
const BAR_SPAN = 50;

// Strides that scatter bar heights across categories, series and charts; each
// is coprime with BAR_SPAN, so no two neighbours repeat a height.
const BAR_CATEGORY_STRIDE = 13;
const BAR_SERIES_STRIDE = 29;
const BAR_CHART_STRIDE = 7;

/** The departments `table-rows` cycles through; also its `department` column's values. */
export const DEPARTMENTS: readonly string[] = ['Engineering', 'Sales', 'Marketing', 'Finance', 'Support', 'Operations'];

/** The job titles `table-rows` cycles through; a count coprime with DEPARTMENTS', so the pairs vary. */
const TITLES: readonly string[] = ['Engineer', 'Manager', 'Analyst', 'Director', 'Associate'];

/** Salaries lie in [SALARY_FLOOR, SALARY_FLOOR + SALARY_SPAN): a plausible band, wide enough that sorting reorders the rows. */
const SALARY_FLOOR = 40000;
const SALARY_SPAN = 90000;

/** A prime stride, so consecutive salaries scatter across the band. */
const SALARY_STRIDE = 7919;

/** `hired` counts days from here: a fixed date, since the clock is off limits. */
const HIRED_EPOCH_MS = Date.UTC(2010, 0, 1);

/** `hired` lies within this many days of its epoch, about 13.7 years, so every hire date is in the past. */
const HIRED_SPAN_DAYS = 5000;

/** A prime stride, so consecutive hire dates scatter. */
const HIRED_STRIDE_DAYS = 97;

/** `lastLogin` and `modified` count hours from here: a fixed date, since the clock is off limits. */
const RECENT_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Recent timestamps lie within this many hours, ten days, so the date-time cells show varied dates and times. */
const RECENT_SPAN_HOURS = 240;

/** Hours between consecutive rows' recent timestamps; coprime with the span. */
const RECENT_STRIDE_HOURS = 7;

/** Shifts start between SHIFT_FIRST_HOUR and SHIFT_FIRST_HOUR + SHIFT_HOURS − 1 o'clock: a morning rota. */
const SHIFT_FIRST_HOUR = 8;
const SHIFT_HOURS = 4;

/** Shift starts fall on the quarter hour. */
const SHIFT_MINUTE_STRIDE = 15;

/** Every third row is inactive, so each screenful of the boolean column shows both values. */
const INACTIVE_PERIOD = 3;

/** Scores lie in [0, 100]: a prime modulus of 101 with a coprime stride visits every score. */
const SCORE_MODULUS = 101;
const SCORE_STRIDE = 31;

/** Every fourth row has no notes, so each screenful has empty cells. */
const EMPTY_NOTES_PERIOD = 4;

/** Subfolders per root and files per subfolder: two levels of expandable rows. */
const SUBFOLDERS_PER_ROOT = 3;
const FILES_PER_SUBFOLDER = 3;

/** Rows `folderRows` gives per root: the root, and each subfolder with its files — 13. */
export const FOLDER_ROWS_PER_ROOT = 1 + SUBFOLDERS_PER_ROOT * (1 + FILES_PER_SUBFOLDER);

/** File sizes lie in [FILE_SIZE_FLOOR, FILE_SIZE_FLOOR + FILE_SIZE_SPAN), below `treetable-rows`' update base of 100,000. */
const FILE_SIZE_FLOOR = 100;
const FILE_SIZE_SPAN = 64000;

/** A prime stride, so consecutive file sizes scatter across the span. */
const FILE_SIZE_STRIDE = 7919;

/** Files per folder in an explorer tree: six nodes per folder, a tree tall enough to scroll at the panels' defaults. */
const FILES_PER_FOLDER = 5;

// Where a section of `markdownDocument` carries each construct: section `i`
// has one when `i mod PERIOD = PHASE`. The phases put the first of each in the
// first five sections, so a short document has all three; fences start at
// section 4, below the mount smoke's three sections, where jsdom would have to
// build a CodeMirror view.
const BULLET_PERIOD = 3;
const BULLET_PHASE = 2;
const FENCE_PERIOD = 4;
const FENCE_PHASE = 3;
const TABLE_PERIOD = 5;
const TABLE_PHASE = 4;

/** Items per bullet list: enough to lay out as a list, few enough to keep sections short. */
const BULLET_ITEMS = 4;

/** Body rows per table, under its header: enough rows to lay out as a table. */
const TABLE_ROWS = 6;

// Clock units, for building dates without the clock.
const MINUTES_PER_HOUR = 60;
const MINUTE_MS = 60_000;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * One line series' points, `chart-line`'s rule: `{ x: i, y: (i × 37 + s × 23) mod 100 }`.
 *
 * @param s - The series' index.
 * @param n - Points in the series.
 * @returns The points, x = 0…n−1.
 */
export function lineSeriesPoints(s: number, n: number): Array<{ x: number; y: number }> {
    return Array.from({ length: n }, (_, i) => ({ x: i, y: (i * POINT_STRIDE + s * SERIES_OFFSET) % Y_SPAN }));
}

/**
 * One bar chart's series: 3 series of 12 categories, x = 1…12.
 *
 * @param chart - The chart's index; it shifts the heights so the charts differ.
 * @returns The series.
 */
export function barSeries(chart: number): ChartSeries[] {
    return Array.from({ length: BAR_SERIES }, (_, s) => ({
        name: `Series ${s + 1}`,
        data: Array.from({ length: BAR_CATEGORIES }, (_, c) => ({
            x: c + 1,
            y: ((c * BAR_CATEGORY_STRIDE + s * BAR_SERIES_STRIDE + chart * BAR_CHART_STRIDE) % BAR_SPAN) + BAR_FLOOR,
        })),
    }));
}

/**
 * `table-rows`' records: twelve fields of every cell type the table renders.
 *
 * @param n - How many rows.
 * @returns The rows, ids 1…n.
 */
export function tableRows(n: number): TableRow[] {
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        name: `Person ${i + 1}`,
        email: `person${i + 1}@example.com`,
        department: DEPARTMENTS[i % DEPARTMENTS.length],
        title: TITLES[i % TITLES.length],
        salary: SALARY_FLOOR + ((i * SALARY_STRIDE) % SALARY_SPAN),
        hired: new Date(HIRED_EPOCH_MS + ((i * HIRED_STRIDE_DAYS) % HIRED_SPAN_DAYS) * DAY_MS),
        lastLogin: recentDate(i),
        shiftStart: new Date((SHIFT_FIRST_HOUR + (i % SHIFT_HOURS)) * HOUR_MS + ((i * SHIFT_MINUTE_STRIDE) % MINUTES_PER_HOUR) * MINUTE_MS),
        active: i % INACTIVE_PERIOD !== 0,
        score: (i * SCORE_STRIDE) % SCORE_MODULUS,
        notes: i % EMPTY_NOTES_PERIOD === 0 ? '' : `Note ${i + 1}`,
    }));
}

/**
 * A timestamp within ten days of the recent epoch, for row `i`.
 *
 * @param i - The row's index.
 * @returns The timestamp.
 */
function recentDate(i: number): Date {
    return new Date(RECENT_EPOCH_MS + ((i * RECENT_STRIDE_HOURS) % RECENT_SPAN_HOURS) * HOUR_MS);
}

/**
 * `treetable-rows`' records: per root, a folder row, then 3 subfolders, each
 * followed by its 3 files — 13 rows per root, every child after its parent.
 *
 * @param roots - How many root folders.
 * @returns The rows, ids 1…13 × roots.
 */
export function folderRows(roots: number): FolderRow[] {
    const rows: FolderRow[] = [];

    /**
     * Appends one row with the next id.
     *
     * @param parentId - Its parent's id, or `null` for a root.
     * @param name - Its name.
     * @param kind - A folder or a file.
     * @returns Its id.
     */
    function add(parentId: number | null, name: string, kind: 'folder' | 'file'): number {
        const id = rows.length + 1;
        const size = kind === 'file' ? FILE_SIZE_FLOOR + ((id * FILE_SIZE_STRIDE) % FILE_SIZE_SPAN) : 0;

        rows.push({ id, parentId, name, size, modified: recentDate(id), kind });

        return id;
    }

    for (let r = 0; r < roots; r++) {
        const root = add(null, `Folder ${r + 1}`, 'folder');

        for (let k = 0; k < SUBFOLDERS_PER_ROOT; k++) {
            const sub = add(root, `Folder ${r + 1}.${k + 1}`, 'folder');

            for (let j = 0; j < FILES_PER_SUBFOLDER; j++) {
                add(sub, `file ${r + 1}.${k + 1}.${j + 1}.ts`, 'file');
            }
        }
    }

    return rows;
}

/**
 * Tree nodes for an explorer: `Folder <i>`, each holding five files.
 *
 * @param folders - How many folders.
 * @returns The folder nodes.
 */
export function folderNodes(folders: number): TreeNode[] {
    return Array.from({ length: folders }, (_, i) => ({
        label: `Folder ${i}`,
        children: Array.from({ length: FILES_PER_FOLDER }, (_, j) => ({ label: `file ${i}.${j}.ts` })),
    }));
}

/**
 * `list-items`' records.
 *
 * @param n - How many items.
 * @returns The items, ids 0…n−1.
 */
export function listItems(n: number): ListItem[] {
    return Array.from({ length: n }, (_, i) => ({ id: i, name: `Item ${i}` }));
}

/**
 * The shells' outline entries.
 *
 * @param count - How many entries.
 * @returns The labels.
 */
export function outlineLabels(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `Outline entry ${i + 1}`);
}

/**
 * A Markdown document: a title, then `sections` sections, each a heading and
 * a one-line paragraph, some with a bullet list, a TypeScript fence or a
 * table. The two variants differ only in the paragraphs' second word.
 *
 * @param sections - How many sections.
 * @param variant - 0 for `draft` paragraphs, 1 for `revised`.
 * @returns The document.
 */
export function markdownDocument(sections: number, variant: 0 | 1): string {
    const blocks = ['# QA document'];

    for (let i = 0; i < sections; i++) {
        blocks.push(...sectionBlocks(i, variant));
    }

    return blocks.join('\n\n') + '\n';
}

/**
 * The Markdown blocks of section `i`.
 *
 * @param i - The section's index.
 * @param variant - 0 for a `draft` paragraph, 1 for `revised`.
 * @returns The blocks, in order.
 */
function sectionBlocks(i: number, variant: 0 | 1): string[] {
    const n = i + 1;
    const blocks = [
        `## Section ${n}`,
        `Section ${n} ${variant === 0 ? 'draft' : 'revised'}. The viewer lays this paragraph out at its width. It wraps when the pane narrows. Its words carry no meaning.`,
    ];

    if (i % BULLET_PERIOD === BULLET_PHASE) {
        blocks.push(Array.from({ length: BULLET_ITEMS }, (_, k) => `- Point ${k + 1} of section ${n}`).join('\n'));
    }

    if (i % FENCE_PERIOD === FENCE_PHASE) {
        blocks.push(fence(n));
    }

    if (i % TABLE_PERIOD === TABLE_PHASE) {
        blocks.push(table(n));
    }

    return blocks;
}

/**
 * A six-line TypeScript fence.
 *
 * @param n - The section's number, written into the code.
 * @returns The fence, markers included.
 */
function fence(n: number): string {
    return [
        '```ts',
        `const section = ${n};`,
        'function total(values: number[]): number {',
        '    return values.reduce((sum, value) => sum + value, section);',
        '}',
        'const result = total([1, 2, 3]);',
        'console.log(result);',
        '```',
    ].join('\n');
}

/**
 * A four-column table with six body rows.
 *
 * @param n - The section's number, written into the cells.
 * @returns The table.
 */
function table(n: number): string {
    const rows = Array.from({ length: TABLE_ROWS }, (_, r) => `| Row ${r + 1} | ${n * (r + 1)} | ${r + 1}% | section ${n} |`);

    return ['| Name | Count | Share | Note |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

/**
 * JavaScript source of exactly `lines` lines: a ten-line function block
 * repeated, numbered by block, the last one cut short when `lines` is not a
 * multiple of ten.
 *
 * @param lines - How many lines.
 * @returns The source.
 */
export function codeDocument(lines: number): string {
    const out: string[] = [];

    for (let k = 0; out.length < lines; k++) {
        out.push(...codeBlock(k));
    }

    return out.slice(0, lines).join('\n');
}

/**
 * One ten-line function block.
 *
 * @param k - The block's number.
 * @returns Its lines.
 */
function codeBlock(k: number): string[] {
    return [
        `function block${k}(value) {`,
        '    const doubled = value * 2;',
        `    const offset = doubled + ${k};`,
        '    if (offset > 100) {',
        '        return offset - 100;',
        '    }',
        `    const label = 'block ${k}: ' + offset;`,
        '    console.log(label);',
        '    return offset;',
        '}',
    ];
}
