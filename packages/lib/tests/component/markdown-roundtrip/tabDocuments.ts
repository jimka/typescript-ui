/** The indentation a generated line starts with. An entry listed more than once is drawn more often. */
const INDENTS: readonly string[] = ['', '', '', ' ', '  ', '   ', '    ', '\t', '\t', ' \t', '  \t', '   \t', '\t\t', '\t ', '\t  ', '      ', ' \t  '];

/** The marker that follows the indentation: none, a list marker or a quote marker, with a space or a tab after it. */
const MARKERS: readonly string[] = ['', '', '', '- ', '-\t', '-  \t', '1. ', '1.\t', '> ', '>\t', '>', '> \t', '* '];

/** A second marker, or a task checkbox. */
const SECOND_MARKERS: readonly string[] = ['', '', '', '', '- ', '-\t', '> ', '>\t', '[ ] ', '[ ]\t'];

/** What the line holds after its markers. None holds a double quote, which an outline uses around text. */
const CONTENTS: readonly string[] = ['x', 'y z', 'a\tb', '`c\td`', '```', '~~~', '<div>', '</div>', '<pre>', '</pre>', '# h', '#\th', '---', '', '', 'w'];

/** The seed every draw starts from, chosen once so the documents are the same on every run. */
const SEED = 20261011;

/** The share of lines left empty, so that blank lines separate blocks. */
const BLANK_LINE_SHARE = 0.15;

/** A document holds this many lines at least, and up to `LINE_SPREAD - 1` more. */
const MIN_LINES = 2;
const LINE_SPREAD = 5;

/**
 * Builds the mulberry32 generator, whose constants are the algorithm's own.
 *
 * @param seed - The starting state.
 * @returns A function giving the next number in `[0, 1)`.
 */
function mulberry32(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6D2B79F5) >>> 0;

        let mixed = state;

        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Draws documents whose lines are an indentation, up to two markers and a content, and keeps those that hold a tab.
 * The same `draws` gives the same documents on every run: 600 draws give 591 documents, 3,000 give 2,932.
 *
 * @param draws - How many documents to draw.
 * @returns The drawn documents that hold a tab, in draw order.
 */
export function tabDocuments(draws: number): string[] {
    const random = mulberry32(SEED);
    const pick = (pool: readonly string[]): string => pool[Math.floor(random() * pool.length)]!;
    const documents: string[] = [];

    for (let draw = 0; draw < draws; draw++) {
        const lineTotal = MIN_LINES + Math.floor(random() * LINE_SPREAD);
        const lines: string[] = [];

        for (let line = 0; line < lineTotal; line++) {
            const blank = random() < BLANK_LINE_SHARE;

            lines.push(blank ? '' : pick(INDENTS) + pick(MARKERS) + pick(SECOND_MARKERS) + pick(CONTENTS));
        }

        documents.push(lines.join('\n') + '\n');
    }

    return documents.filter((document) => document.includes('\t'));
}
