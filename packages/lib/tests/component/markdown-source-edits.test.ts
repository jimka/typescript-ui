import { describe, it, expect } from 'vitest';
import { readSourceSelectionState } from '~/component/editor/markdownSourceEdits';
import { STANDARD_HORIZONTAL_RULE } from '~/component/editor/markdownHorizontalRuleNode';
import { horizontalRuleSource, paragraphAroundBlockSource, tableSource } from '~/component/editor/markdownSourceLines';
import type { MarkdownSourceEdit } from '~/component/editor/markdownSourceEdits';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { formatDelimiterRow } from '~/component/editor/markdownSerializer';
import type { ElementFormatType } from 'lexical';

// This module touches no DOM, no Lexical, no component — every transform is a
// pure function of (text, from, to), so these tests need no installTestDOM.

/** Applies an edit to `text`, so each case reads as before/after. */
function apply(text: string, edit: MarkdownSourceEdit): string {
    return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** Simulates the user typing `typed` at `at` — what an inserted blank line is for. */
function typeAt(text: string, at: number, typed: string): string {
    return text.slice(0, at) + typed + text.slice(at);
}

/** The document's top-level block token types, ignoring blank-line tokens. */
function blockTypes(text: string): string[] {
    return lexMarkdown(text).map((token) => token.type).filter((type) => type !== 'space');
}

// A marker pair is only emphasis when CommonMark's flanking rules let the
// opener open and the closer close — `**hello.**b` is literal text, because a
// closer preceded by punctuation must be followed by whitespace or punctuation.
describe('inline toggles and CommonMark flanking', () => {
    it('reports no bold for literal markers that cannot close', () => {
        expect(readSourceSelectionState('a **hello.**b', 4, 10).bold).toBe(false);
    });
});

// A backslash escapes the character after it, so a marker written straight
// after one (or straight before the closer's backslash) is literal text.
describe('inline toggles and backslash escapes', () => {
    it('reports no bold when the opening marker is escaped', () => {
        const state = readSourceSelectionState('\\**hello**', 3, 8);

        expect(state.bold).toBe(false);
        expect(state.italic).toBe(true);
    });
});

describe('readSourceSelectionState', () => {
    it('reports what a press would do for a bold selection', () => {
        const state = readSourceSelectionState('**hello** world', 2, 7);

        expect(state).toEqual({
            bold: true, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: true, linkUrl: null,
        });
    });

    it('reports the enclosing link\'s URL', () => {
        const state = readSourceSelectionState('see [docs](/d)', 7, 7);

        expect(state.linkUrl).toBe('/d');
    });

    it('reports a titled link\'s destination alone, not its title', () => {
        expect(readSourceSelectionState('see [docs](/d "Title")', 7, 7).linkUrl).toBe('/d');
        expect(readSourceSelectionState('see [docs](/d (Title))', 7, 7).linkUrl).toBe('/d');
    });

    it('reports an angle-bracketed destination without its brackets', () => {
        expect(readSourceSelectionState('see [docs](<a b> "T")', 7, 7).linkUrl).toBe('a b');
    });

    it('reports no link for an image\'s alt text', () => {
        expect(readSourceSelectionState('![alt](src)', 3, 3).linkUrl).toBeNull();
    });

    it('reports every flag false and no selection for whitespace with nothing to act on', () => {
        const state = readSourceSelectionState('a  b', 2, 2);

        expect(state).toEqual({
            bold: false, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: false, linkUrl: null,
        });
    });
});

// The WYSIWYG editor holds no code block or table inside a list item. A
// fence lifts the item's text out to the top level, the list split around it;
// a table, which converts no block, declines inside an item's content.
describe('code fences and tables stay out of list items', () => {
    it('declines a table on a list item\'s indented content', () => {
        expect(tableSource(2, 2)('- a\n\n  b', 7, 7)).toBeNull();
        expect(tableSource(2, 2)('- x\n  - a', 8, 8)).toBeNull();
    });

    const TABLE = '|  |  |\n| --- | --- |\n|  |  |\n';

    it('declines a table on a blank line inside a list or a quote, and keeps one in a column', () => {
        expect(tableSource(2, 2)('- a\n\n- b', 4, 4)).toBeNull();
        expect(tableSource(2, 2)('> a\n>\n> b', 4, 4)).toBeNull();
        expect(tableSource(2, 2)('> a\n>', 4, 4)).toBeNull();
        expect(apply('>\n> a', tableSource(2, 2)('>\n> a', 0, 0)!)).toBe(TABLE + '\n>\n> a');

        const column = '::: columns\na\n\nb\n|||\nc\n:::';

        expect(apply(column, tableSource(2, 2)(column, 14, 14)!)).toBe('::: columns\na\n\n' + TABLE + '\n\nb\n|||\nc\n:::');
        expect(apply('one\n\ntwo', tableSource(2, 2)('one\n\ntwo', 4, 4)!)).toBe('one\n\n' + TABLE + '\n\ntwo');
    });
});

// Whole-stack review fixes (source-mode fuzz): the line commands find the
// blocks they convert from the viewer's tokens and check their result by
// lexing it. A block leaves its quotes and list items for the top level, the
// containers split around it, so what followed it inside them stays there.
describe('line commands act on the blocks the viewer reads', () => {
    // A fence closed inside a nested quote ends the lines the quote takes: `b` is a paragraph after the quote.
    it('puts a table above the line after a fence closed inside a nested quote', () => {
        const text = '> > ```\n> > a\n> > ```\nb';
        const edit = tableSource(2, 2)(text, text.length, text.length)!;

        expect(blockTypes(text)).toEqual(['blockquote', 'paragraph']);
        expect(apply(text, edit)).toBe('> > ```\n> > a\n> > ```\n\n|  |  |\n| --- | --- |\n|  |  |\n\nb');
    });
});

describe('paragraphAroundBlockSource', () => {
    it('declines outside a block', () => {
        expect(paragraphAroundBlockSource(true)('plain text', 3, 3)).toBeNull();
    });

    it('finds the whole fence from inside it, inserting after the closing marker', () => {
        const text = '```\ncode\n```';
        const edit = paragraphAroundBlockSource(true)(text, 5, 5)!;

        expect(apply(text, edit)).toBe('```\ncode\n```\n\n');
        expect(edit.selection).toEqual({ from: 14, to: 14 });
    });

    it('finds the whole list from one item, inserting before it', () => {
        const text = '- a\n- b\n- c';
        const edit = paragraphAroundBlockSource(false)(text, 5, 5)!;

        expect(apply(text, edit)).toBe('\n\n- a\n- b\n- c');
        expect(edit.selection).toEqual({ from: 0, to: 0 });
    });

    // A caret ON a fence marker must still resolve to the WHOLE fence. Scanning
    // for the partner marker from the caret's own line matches that line as its
    // own partner, collapsing the run to the single marker — which drops the
    // blank line INSIDE the code block and leaves the caret there.
    it('resolves the whole fence from a caret on the closing marker', () => {
        const text = '```\ncode\n```';
        const edit = paragraphAroundBlockSource(false)(text, 10, 10)!;

        expect(apply(text, edit)).toBe('\n\n```\ncode\n```');
        expect(edit.selection).toEqual({ from: 0, to: 0 });
    });

    it('resolves the whole fence from a caret on the opening marker', () => {
        const text = '```\ncode\n```';
        const edit = paragraphAroundBlockSource(true)(text, 1, 1)!;

        expect(apply(text, edit)).toBe('```\ncode\n```\n\n');
        expect(edit.selection).toEqual({ from: 14, to: 14 });
    });

    it('keeps text typed before a fence outside the code block', () => {
        const text = '```\ncode\n```';
        const edit = paragraphAroundBlockSource(false)(text, 10, 10)!;
        const typed = typeAt(apply(text, edit), edit.selection.from, 'p');

        expect(blockTypes(typed)).toEqual(['paragraph', 'code']);
    });

    // The point of the command is a paragraph OUTSIDE the block, so the
    // assertion has to type into the inserted line: a single "\n" leaves the
    // caret on a lazy-continuation line, which re-parses back INTO the block.
    it('separates text typed into the new line from the quote above it', () => {
        const text = '> q';
        const edit = paragraphAroundBlockSource(true)(text, 2, 2)!;
        const typed = typeAt(apply(text, edit), edit.selection.from, 'p');

        expect(typed).toBe('> q\n\np');
        expect(blockTypes(typed)).toEqual(['blockquote', 'paragraph']);
    });

    it('separates text typed into the new line from the list below it', () => {
        const text = '- a\n- b';
        const edit = paragraphAroundBlockSource(false)(text, 1, 1)!;
        const typed = typeAt(apply(text, edit), edit.selection.from, 'p');

        expect(typed).toBe('p\n\n- a\n- b');
        expect(blockTypes(typed)).toEqual(['paragraph', 'list']);
    });
});

describe('tableSource', () => {
    // A text that opens with a newline: the caret at 0 is on the blank first line, and the table goes on that line.
    it('puts the table on the blank first line for a caret at the document start', () => {
        const text = '\nabc';

        expect(apply(text, tableSource(2, 2)(text, 0, 0)!)).toBe('|  |  |\n| --- | --- |\n|  |  |\n\n\nabc');
        expect(tableSource(2, 2)(text, 0, 0)!.selection).toEqual({ from: 2, to: 2 });
    });

    it('puts the table above the second line for a caret at its start', () => {
        const text = '\nabc';

        expect(apply(text, tableSource(2, 2)(text, 1, 1)!)).toBe('\n|  |  |\n| --- | --- |\n|  |  |\n\nabc');
        expect(tableSource(2, 2)(text, 1, 1)!.selection).toEqual({ from: 3, to: 3 });
    });

    it('emits the delimiter row formatDelimiterRow emits, as the insert\'s second line', () => {
        for (const columns of [1, 3, 5]) {
            const edit = tableSource(2, columns)('', 0, 0)!;
            const unaligned = Array.from({ length: columns }, (): ElementFormatType => '');

            expect(edit.insert.split('\n')[1]).toBe(formatDelimiterRow(unaligned, []));
        }
    });

    // The separator belongs ABOVE the table, so it depends on what precedes the
    // insertion point — not on the caret's own line, which ends up BELOW it.
    it('separates the table from a non-blank line above with one blank line', () => {
        const text = '# T\nhello';
        const edit = tableSource(2, 2)(text, 7, 7)!;

        expect(apply(text, edit)).toBe('# T\n\n|  |  |\n| --- | --- |\n|  |  |\n\nhello');
    });

    // Splitting a paragraph would leave its lower lines to be re-read on their
    // own — as a definition, an HTML block, or outside the quote or list item
    // they continued lazily — so the table goes above the whole paragraph.
    it('goes above the caret\'s whole paragraph, never into it', () => {
        const table = '|  |  |\n| --- | --- |\n|  |  |\n\n';

        expect(apply('para\nhello', tableSource(2, 2)('para\nhello', 7, 7)!)).toBe(table + 'para\nhello');
        expect(apply('> foo\nbar', tableSource(2, 2)('> foo\nbar', 8, 8)!)).toBe(table + '> foo\nbar');
        expect(apply('# T\n- foo\n  bar', tableSource(2, 2)('# T\n- foo\n  bar', 12, 12)!)).toBe('# T\n\n' + table + '- foo\n  bar');
    });

    // Inserting at the caret's own line would split an HTML block or a table
    // in two, so the table goes above the whole block.
    it('goes above an HTML block or a table holding the caret, never into it', () => {
        const table = '|  |  |\n| --- | --- |\n|  |  |\n\n';

        expect(apply('<div>\nhi\n</div>', tableSource(2, 2)('<div>\nhi\n</div>', 7, 7)!)).toBe(table + '<div>\nhi\n</div>');
        expect(apply('| a |\n| - |\n| b |', tableSource(2, 2)('| a |\n| - |\n| b |', 14, 14)!)).toBe(table + '| a |\n| - |\n| b |');
        expect(apply('p\n\n| a |\n| - |\n| b |', tableSource(2, 2)('p\n\n| a |\n| - |\n| b |', 17, 17)!)).toBe('p\n\n' + table + '| a |\n| - |\n| b |');
    });

    it('adds no separator when the table lands at the document start', () => {
        const text = 'hello';
        const edit = tableSource(2, 2)(text, 3, 3)!;

        expect(apply(text, edit)).toBe('|  |  |\n| --- | --- |\n|  |  |\n\nhello');
    });

    it('adds no separator when a blank line already precedes the insertion point', () => {
        const text = '# T\n\n\nX';
        const edit = tableSource(2, 2)(text, 5, 5)!;

        expect(apply(text, edit)).toBe('# T\n\n|  |  |\n| --- | --- |\n|  |  |\n\n\nX');
    });

    it('puts the caret two characters into the header row', () => {
        const edit = tableSource(2, 3)('', 0, 0)!;
        const headerLine = edit.insert.split('\n')[0]!;

        expect(edit.selection).toEqual({ from: 2, to: 2 });
        expect(headerLine.slice(0, 2)).toBe('| ');
    });
});

// Plan markdown-editor-marked-import, whole-stack review C1/C2/F13: source mode
// reads the document through the viewer's own `lexMarkdown` tokens, so it sees
// every form the viewer (and so the editor's importer) reads — not only the
// `*`-family emphasis and `[text](url)` links its old regular expressions knew.
describe('source mode reads `_` emphasis as the viewer does (C1)', () => {
    const COLOUR = { color: '#cc0000' };

    it('reports `__…__` as bold and `_…_` as italic', () => {
        expect(readSourceSelectionState('__hello__', 2, 7).bold).toBe(true);
        expect(readSourceSelectionState('_hello_', 1, 6).italic).toBe(true);
        expect(readSourceSelectionState('__hello__', 4, 4).bold).toBe(true);
    });
});

describe('source mode reads every link form the viewer reads (C2)', () => {
    const COLOUR = { color: '#cc0000' };
    const DEFINED = '\n\n[docs]: /d "T"\n[d]: /e';

    it('reports the destination of a reference link in all three forms', () => {
        for (const link of ['[docs]', '[docs][]', '[docs][d]']) {
            const text = `see ${link} here${DEFINED}`;

            expect(readSourceSelectionState(text, 6, 6).linkUrl, link).toBe(link === '[docs][d]' ? '/e' : '/d');
        }
    });

    it('reads bare, angle-bracket and email autolinks', () => {
        expect(readSourceSelectionState('see https://example.com/docs', 26, 26).linkUrl).toBe('https://example.com/docs');
        expect(readSourceSelectionState('see www.x.test', 6, 6).linkUrl).toBe('http://www.x.test');
        expect(readSourceSelectionState('mail me@example.com', 8, 8).linkUrl).toBe('mailto:me@example.com');
        expect(readSourceSelectionState('<https://a.b>', 3, 3).linkUrl).toBe('https://a.b');
    });

    it('reads a destination holding parentheses and link text holding brackets', () => {
        const parens = 'see [a](https://x.y/(b)) here';
        const brackets = 'see [a [b] c](/u) here';

        expect(readSourceSelectionState(parens, 5, 5).linkUrl).toBe('https://x.y/(b)');
        expect(readSourceSelectionState(brackets, 8, 8).linkUrl).toBe('/u');
    });
});

// A tab in a line's container prefix is the spaces to its tab stop in the lexer's reading, so the tokens of a
// quote's or item's content hold spaces where the source holds the tab. The toolbar state reads these documents as it
// reads their spaces forms.
describe('a tab in a container prefix', () => {
    it('TB10: the toolbar state reads a bold run in a quote after a marker and a tab', () => {
        expect(readSourceSelectionState('>\t**foo** bar', 4, 7).bold).toBe(true);
        expect(readSourceSelectionState('> one\n> \t**two**', 11, 14).bold).toBe(true);
        expect(readSourceSelectionState('- [ ]\tAlpha **beta**', 14, 18).bold).toBe(true);
    });

    // A tab after a quote marker inside a `:::` column is read like one outside it.
    it.each<[string, string]>([
        ['TB22: a quote in the only column of a fence', '::: {gap=2}\n>\t**q** r\n:::'],
        ['TB23: a quote in the second column of a fence', '::: {gap=2}\nx\n|||\n>\t**q** r\n:::'],
    ])('%s', (_title, bold) => {
        expect(readSourceSelectionState(bold, bold.indexOf('**') + 2, bold.indexOf('**') + 3).bold).toBe(true);
    });
});

describe('horizontalRuleSource', () => {
    it('puts a rule above the block holding the caret, a blank line apart, and keeps the caret on its character', () => {
        const text = 'one\n\ntwo';
        const edit = horizontalRuleSource()(text, 6, 6)!;

        expect(apply(text, edit)).toBe('one\n\n---\n\ntwo');
        expect(edit.selection).toEqual({ from: 11, to: 11 });
    });

    it('writes the line a rule made in the editor is saved as', () => {
        expect(horizontalRuleSource()('', 0, 0)!.insert).toBe(STANDARD_HORIZONTAL_RULE + '\n\n');
    });

    it('needs no blank line above at the document\'s start', () => {
        const text = 'abc';
        const edit = horizontalRuleSource()(text, 1, 1)!;

        expect(apply(text, edit)).toBe('---\n\nabc');
        expect(edit.selection).toEqual({ from: 6, to: 6 });
    });

    it('separates the rule from a non-blank line above with one blank line', () => {
        const text = '# T\nhello';

        expect(apply(text, horizontalRuleSource()(text, 7, 7)!)).toBe('# T\n\n---\n\nhello');
    });

    it('declines on a blank line inside a list, and past a quote\'s first block', () => {
        expect(horizontalRuleSource()('- a\n\n- b', 4, 4)).toBeNull();
        expect(horizontalRuleSource()('> a\n>\n> b', 6, 6)).toBeNull();
    });

    it('goes into a column, between its blocks', () => {
        const column = '::: columns\na\n\nb\n|||\nc\n:::';

        expect(apply(column, horizontalRuleSource()(column, 15, 15)!)).toBe('::: columns\na\n\n---\n\nb\n|||\nc\n:::');
    });

    it('goes above the whole paragraph holding the caret, never into it', () => {
        expect(apply('para\nhello', horizontalRuleSource()('para\nhello', 7, 7)!)).toBe('---\n\npara\nhello');
    });
});
