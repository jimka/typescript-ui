import { describe, it, expect } from 'vitest';
import {
    BOLD_SOURCE, ITALIC_SOURCE, UNDERLINE_SOURCE, STRIKETHROUGH_SOURCE, INLINE_CODE_SOURCE,
    REMOVE_LINK_SOURCE, CLEAR_FORMAT_SOURCE, linkSource, spanStyleSource, readSourceSelectionState,
    FENCED_CODE_SOURCE, blockPrefixSource, listSource, paragraphAroundBlockSource, imageSource, tableSource,
} from '~/component/editor/markdownSourceEdits';
import type { MarkdownSourceEdit } from '~/component/editor/markdownSourceEdits';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { formatDelimiterRow } from '~/component/editor/markdownTableTransformer';
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

describe('BOLD_SOURCE / ITALIC_SOURCE / STRIKETHROUGH_SOURCE / UNDERLINE_SOURCE marker rule', () => {
    it('wraps plain text in bold markers', () => {
        const edit = BOLD_SOURCE('hello', 0, 5)!;

        expect(apply('hello', edit)).toBe('**hello**');
    });

    it('unwraps bold markers when already bold', () => {
        const edit = BOLD_SOURCE('**hello**', 0, 9)!;

        expect(apply('**hello**', edit)).toBe('hello');
    });

    it('adds a third star when italic presses over bold', () => {
        const edit = ITALIC_SOURCE('**hello**', 0, 9)!;

        expect(apply('**hello**', edit)).toBe('***hello***');
    });

    it('drops to a single star when bold presses over bold+italic', () => {
        const edit = BOLD_SOURCE('***hello***', 0, 11)!;

        expect(apply('***hello***', edit)).toBe('*hello*');
    });

    it('unwraps italic markers when already italic', () => {
        const edit = ITALIC_SOURCE('*hello*', 0, 7)!;

        expect(apply('*hello*', edit)).toBe('hello');
    });

    it('unwraps strikethrough markers when already struck', () => {
        const edit = STRIKETHROUGH_SOURCE('~~hello~~', 0, 9)!;

        expect(apply('~~hello~~', edit)).toBe('hello');
    });

    it('unwraps underline markers when already underlined', () => {
        const edit = UNDERLINE_SOURCE('++hello++', 0, 9)!;

        expect(apply('++hello++', edit)).toBe('hello');
    });

    it('uses the dialect\'s ++ marker for underline on plain text', () => {
        const edit = UNDERLINE_SOURCE('hello', 0, 5)!;

        expect(apply('hello', edit)).toBe('++hello++');
    });
});

describe('normalised-range rule', () => {
    it('trims a trailing space out of the range', () => {
        const edit = BOLD_SOURCE('a hello b', 2, 8)!;

        expect(apply('a hello b', edit)).toBe('a **hello** b');
        expect(edit.selection).toEqual({ from: 4, to: 9 });
    });

    it('expands a collapsed caret to the enclosing word', () => {
        const edit = BOLD_SOURCE('a hello b', 4, 4)!;

        expect(apply('a hello b', edit)).toBe('a **hello** b');
    });

    it('absorbs edge markers already wrapping the selection', () => {
        const edit = ITALIC_SOURCE('a **hello** b', 2, 11)!;

        expect(apply('a **hello** b', edit)).toBe('a ***hello*** b');
    });

    it('returns null for a whitespace-only selection', () => {
        expect(BOLD_SOURCE('a   b', 1, 4)).toBeNull();
    });

    it('returns null for a collapsed caret on whitespace with no adjacent word', () => {
        expect(BOLD_SOURCE('a  b', 2, 2)).toBeNull();
    });

    it('is fine with a single embedded newline', () => {
        const edit = BOLD_SOURCE('one\ntwo', 0, 7)!;

        expect(apply('one\ntwo', edit)).toBe('**one\ntwo**');
    });

    it('declines a selection spanning a blank line', () => {
        expect(BOLD_SOURCE('one\n\ntwo', 0, 8)).toBeNull();
    });

    it('declines an inline-code range that still contains a backtick', () => {
        expect(INLINE_CODE_SOURCE('a `b` c', 0, 7)).toBeNull();
    });
});

// A marker pair is only emphasis when CommonMark's flanking rules let the
// opener open and the closer close — `**hello.**b` is literal text, because a
// closer preceded by punctuation must be followed by whitespace or punctuation.
describe('inline toggles and CommonMark flanking', () => {
    it('declines a wrap whose closer could not close emphasis', () => {
        expect(BOLD_SOURCE('a hello.b', 2, 8)).toBeNull();
        expect(ITALIC_SOURCE('a hello.b', 2, 8)).toBeNull();
        expect(STRIKETHROUGH_SOURCE('a hello.b', 2, 8)).toBeNull();
        expect(UNDERLINE_SOURCE('a hello.b', 2, 8)).toBeNull();
    });

    it('declines a wrap whose opener could not open emphasis', () => {
        expect(BOLD_SOURCE('a.hello b', 1, 7)).toBeNull();
    });

    it('still wraps punctuation-ended text followed by whitespace', () => {
        const text = 'a hello. b';
        const edit = BOLD_SOURCE(text, 2, 8)!;
        const result = apply(text, edit);

        expect(result).toBe('a **hello.** b');
        expect(lexMarkdown(result)[0]).toMatchObject({ tokens: [{ type: 'text' }, { type: 'strong' }, { type: 'text' }] });
    });

    it('wraps inline code regardless of flanking, since a code span has none', () => {
        const text = 'a hello.b';
        const edit = INLINE_CODE_SOURCE(text, 2, 8)!;

        expect(apply(text, edit)).toBe('a `hello.`b');
    });

    it('reports no bold for literal markers that cannot close', () => {
        expect(readSourceSelectionState('a **hello.**b', 4, 10).bold).toBe(false);
    });

    it('treats a press on literal markers as declined, not as a toggle-off', () => {
        expect(BOLD_SOURCE('a **hello.**b', 4, 10)).toBeNull();
    });
});

// A backslash escapes the character after it, so a marker written straight
// after one (or straight before the closer's backslash) is literal text.
describe('inline toggles and backslash escapes', () => {
    it('declines a wrap whose opener would follow a backslash', () => {
        expect(BOLD_SOURCE('C:\\Users', 3, 8)).toBeNull();
        expect(INLINE_CODE_SOURCE('C:\\Users', 3, 8)).toBeNull();
    });

    it('declines a wrap whose closer would follow a backslash ending the selection', () => {
        expect(BOLD_SOURCE('foo\\ bar', 0, 4)).toBeNull();
    });

    it('wraps text after an escaped backslash pair, whose marker is not escaped', () => {
        const text = 'C:\\\\Users';
        const edit = BOLD_SOURCE(text, 4, 9)!;

        expect(apply(text, edit)).toBe('C:\\\\**Users**');
    });

    it('lets inline code close after a backslash, which is literal inside a code span', () => {
        const text = 'foo\\ bar';
        const edit = INLINE_CODE_SOURCE(text, 0, 4)!;

        expect(apply(text, edit)).toBe('`foo\\` bar');
    });

    it('reports no bold when the opening marker is escaped', () => {
        const state = readSourceSelectionState('\\**hello**', 3, 8);

        expect(state.bold).toBe(false);
        expect(state.italic).toBe(true);
    });
});

// A toggle must actually toggle: pressing a format the selection already
// shows removes it from the whole selection, however many runs of it cover
// the text, splitting a run the selection covers only part of.
describe('toggling a format off removes it from the whole selection', () => {
    it('removes both the inner and the outer run of a doubly bold word', () => {
        const text = '**foo, **bar** az**';
        const edit = BOLD_SOURCE(text, 9, 12)!;
        const result = apply(text, edit);

        expect(readSourceSelectionState(text, 9, 12).bold).toBe(true);
        expect(result).toBe('**foo,** bar **az**');
        expect(result.slice(edit.selection.from, edit.selection.to)).toBe('bar');
        expect(readSourceSelectionState(result, edit.selection.from, edit.selection.to).bold).toBe(false);
    });

    it('splits a run around a selection at its end', () => {
        const text = '**hello world**';
        const edit = BOLD_SOURCE(text, 8, 13)!;

        expect(readSourceSelectionState(text, 8, 13).bold).toBe(true);
        expect(apply(text, edit)).toBe('**hello** world');
        expect(edit.selection).toEqual({ from: 10, to: 15 });
    });

    it('splits a run around a selection inside one word', () => {
        const text = '**hello**';
        const edit = BOLD_SOURCE(text, 3, 6)!;

        expect(apply(text, edit)).toBe('**h**ell**o**');
        expect(edit.selection).toEqual({ from: 5, to: 8 });
    });

    it('closes and reopens the run outside another format around the selection', () => {
        const text = '*a **b** c*';
        const edit = ITALIC_SOURCE(text, 5, 6)!;
        const result = apply(text, edit);

        expect(result).toBe('*a* **b** *c*');
        expect(readSourceSelectionState(result, edit.selection.from, edit.selection.to)).toMatchObject({ bold: true, italic: false });
    });

    it('removes a doubled strikethrough and underline the same way', () => {
        const struck = '~~one ~~two~~ six~~';

        expect(apply(struck, STRIKETHROUGH_SOURCE(struck, 8, 11)!)).toBe('~~one~~ two ~~six~~');

        const underlined = '++one ++two++ six++';

        expect(apply(underlined, UNDERLINE_SOURCE(underlined, 8, 11)!)).toBe('++one++ two ++six++');
    });

    it('splits a code span around the selection, keeping its spaces as code', () => {
        const text = '`hello world`';
        const edit = INLINE_CODE_SOURCE(text, 7, 12)!;

        expect(readSourceSelectionState(text, 7, 12).code).toBe(true);
        expect(apply(text, edit)).toBe('`hello `world');
    });

    it('declines a split whose markers would cross a link\'s brackets', () => {
        expect(BOLD_SOURCE('**[foo bar](/u)**', 7, 10)).toBeNull();
    });
});

describe('link commands', () => {
    it('wraps a plain selection in a new link', () => {
        const text = 'see docs here';
        const edit = linkSource('/d')(text, 4, 8)!;

        expect(apply(text, edit)).toBe('see [docs](/d) here');
    });

    it('updates the URL of the link the caret sits in', () => {
        const text = 'see [docs](/d) here';
        const edit = linkSource('/e')(text, 8, 8)!;

        expect(apply(text, edit)).toBe('see [docs](/e) here');
    });

    it('removes the enclosing link, keeping its text', () => {
        const text = 'see [docs](/d) here';
        const edit = REMOVE_LINK_SOURCE(text, 8, 8)!;

        expect(apply(text, edit)).toBe('see docs here');
    });

    it('declines to remove a link when the selection is not inside one', () => {
        const text = 'see docs here';

        expect(REMOVE_LINK_SOURCE(text, 4, 8)).toBeNull();
    });

    it('linkSource(null) is the same edit REMOVE_LINK_SOURCE returns', () => {
        const text = 'see [docs](/d)';

        expect(linkSource(null)(text, 7, 7)).toEqual(REMOVE_LINK_SOURCE(text, 7, 7));
    });

    it('declines to wrap when there is nothing to wrap', () => {
        expect(linkSource('/d')('a  b', 2, 2)).toBeNull();
    });

    it('keeps a link\'s title when its URL is updated', () => {
        const text = 'see [docs](/d "Title") here';
        const edit = linkSource('/e')(text, 7, 7)!;

        expect(apply(text, edit)).toBe('see [docs](/e "Title") here');
    });

    it('keeps a single-quoted or parenthesised title too', () => {
        expect(apply('[a](/d \'T\')', linkSource('/e')('[a](/d \'T\')', 1, 1)!)).toBe('[a](/e \'T\')');
        expect(apply('[a](/d (T))', linkSource('/e')('[a](/d (T))', 1, 1)!)).toBe('[a](/e (T))');
    });

    it('removes a titled link, keeping its text', () => {
        const text = 'see [docs](/d "Title") here';
        const edit = REMOVE_LINK_SOURCE(text, 7, 7)!;

        expect(apply(text, edit)).toBe('see docs here');
    });

    it('refuses to wrap a link inside an image\'s alt text', () => {
        expect(linkSource('/e')('![alt](src)', 3, 3)).toBeNull();
        expect(linkSource('/e')('see ![alt](src) here', 6, 9)).toBeNull();
    });
});

describe('spanStyleSource', () => {
    it('wraps the selection in a new styled span', () => {
        const edit = spanStyleSource({ color: '#cc0000' })('hello world', 0, 5)!;

        expect(edit).toEqual({
            from: 0, to: 5, insert: '[hello]{color=#cc0000}', selection: { from: 1, to: 6 },
        });
    });

    it('acts on the selection itself when there is nothing to trim or extrude', () => {
        const text = 'a hello b';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 2, 7)!;

        expect(edit.from).toBe(2);
        expect(edit.to).toBe(7);
        expect(apply(text, edit)).toBe('a [hello]{color=#cc0000} b');
    });

    it('merges a second attribute into an existing span rather than nesting inside it', () => {
        const text = '[hello]{color=#cc0000} world';
        const edit = spanStyleSource({ 'font-size': '1.2em' })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{color=#cc0000 size=1.2em} world');
        expect(edit.selection).toEqual({ from: 1, to: 6 });
    });

    // The dialect's own colour/font/size order, whatever order the group it
    // merges into was written in — one re-ordering on the first edit, stable
    // from then on, which is what makes a repeated press idempotent.
    it('re-emits the attributes in the dialect\'s own order', () => {
        const text = '[hello]{size=1.2em}';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{color=#cc0000 size=1.2em}');
    });

    it('removes the whole group when the patch clears the last attribute', () => {
        const text = '[hello]{color=#cc0000} world';
        const edit = spanStyleSource({ color: null })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('hello world');
        expect(edit.selection).toEqual({ from: 0, to: 5 });
    });

    it('keeps the group when the patch clears one of two attributes', () => {
        const text = '[hello]{color=#cc0000 size=1.2em} world';
        const edit = spanStyleSource({ color: null })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{size=1.2em} world');
    });

    // An attribute the dialect does not model is the author's, not the
    // patch's: it stays, after the dialect's own keys, and keeps the group.
    it('keeps an unknown attribute when the patch clears the colour', () => {
        const text = '[hello]{color=#cc0000 bogus=1} world';
        const edit = spanStyleSource({ color: null })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{bogus=1} world');
        expect(edit.selection).toEqual({ from: 1, to: 6 });
    });

    it('declines clearing the colour of a span holding only an unknown attribute', () => {
        expect(spanStyleSource({ color: null })('[hello]{bogus=1} world', 1, 6)).toBeNull();
        expect(spanStyleSource({ color: null })('[hello]{bogus=1} world', 3, 3)).toBeNull();
    });

    it('keeps an unknown attribute on every piece of a split span', () => {
        const text = '[hello]{color=#cc0000 bogus=1}';
        const edit = spanStyleSource({ color: null })(text, 2, 5)!;

        expect(apply(text, edit)).toBe('[h]{color=#cc0000 bogus=1}[ell]{bogus=1}[o]{color=#cc0000 bogus=1}');
    });

    it('keeps an unknown attribute, after the dialect\'s own keys, when the patch sets one', () => {
        const text = '[hello]{bogus=1 size=1.2em}';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{color=#cc0000 size=1.2em bogus=1}');
    });

    it('splits a span the selection only partly covers', () => {
        const text = '[hello world]{size=1.2em}';
        const edit = spanStyleSource({ color: '#2563eb' })(text, 7, 12)!;

        expect(apply(text, edit)).toBe('[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}');
        expect(edit.selection).toEqual({ from: 21, to: 26 });
        expect(apply(text, edit).slice(edit.selection.from, edit.selection.to)).toBe('world');
    });

    it('rewrites a span and the plain text around it in one edit', () => {
        const text = 'The [warning]{color=#cc0000} is loud.';
        const edit = spanStyleSource({ 'font-size': '1.2em' })(text, 0, text.length)!;

        expect(apply(text, edit))
            .toBe('[The ]{size=1.2em}[warning]{color=#cc0000 size=1.2em}[ is loud.]{size=1.2em}');
    });

    // The brackets must land OUTSIDE the emphasis run: a span written inside
    // one loses the emphasis on the next mode switch (see the round-trip cases
    // in `markdown-editor.test.ts`), so this is correctness, not cosmetics.
    it('extrudes the emphasis markers flanking the selection', () => {
        const edit = spanStyleSource({ color: '#cc0000' })('a **hello** b', 4, 9)!;

        expect(edit).toEqual({
            from: 2, to: 11, insert: '[**hello**]{color=#cc0000}', selection: { from: 3, to: 12 },
        });
    });

    it('extrudes back out when the selection already included the markers', () => {
        const text = 'a **hello** b';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 2, 11)!;

        expect(apply(text, edit)).toBe('a [**hello**]{color=#cc0000} b');
    });

    it('does not mistake a span\'s own brackets for emphasis markers', () => {
        const text = '[hello]{color=red}';
        const edit = spanStyleSource({ 'font-size': '1.2em' })(text, 1, 6)!;

        expect(apply(text, edit)).toBe('[hello]{color=red size=1.2em}');
    });

    it('expands a collapsed caret to its enclosing word', () => {
        const text = 'a hello b';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 4, 4)!;

        expect(apply(text, edit)).toBe('a [hello]{color=#cc0000} b');
    });

    it('declines a collapsed caret with no word under it', () => {
        expect(spanStyleSource({ color: '#cc0000' })('a  b', 2, 2)).toBeNull();
    });

    it('declines a whitespace-only selection', () => {
        expect(spanStyleSource({ color: '#cc0000' })('a   b', 1, 4)).toBeNull();
    });

    // The word expansion lands on `red`, which clamps out of the span's text
    // range, so no piece is patched and the rewrite equals what it replaces.
    it('declines a caret inside a span\'s attribute text', () => {
        expect(spanStyleSource({ color: '#cc0000' })('[x]{color=red}', 10, 10)).toBeNull();
    });

    // The refusal is coarse on purpose: it declines whenever the selection's line
    // carries an emphasis marker OUTSIDE the selection. Deciding which `*` or
    // `++` is emphasis needs an inline parser this module deliberately is not, and
    // three narrower rules reasoning from nearby marker positions each missed a
    // shape that corrupted the document. The cases below are those shapes.
    const COLOUR = { color: '#cc0000' };

    it('declines a selection inside a wider emphasis run, for every family', () => {
        for (const text of ['**hello world**', '*hello world*', '~~hello world~~', '++hello world++', '`hello world`']) {
            const at = text.indexOf('world');

            expect(spanStyleSource(COLOUR)(text, at, at + 5), text).toBeNull();
        }
    });

    // A selection swallowing one side of a run while its partner stays outside.
    // Reachable with a plain shift+End or shift+Home from inside an emphasised word.
    it('declines a selection carrying a marker run in its interior', () => {
        const cases: Array<[string, number, number]> = [
            ['**hello** world', 4, 15],
            ['a **bold** c', 5, 12],
            ['a **bold** c', 0, 7],
            ['a ~~struck~~ c', 5, 14],
            ['a *it* c', 4, 8],
            ['**a** b', 2, 7],
            ['a ++under++ c', 5, 13],
            ['a `code` c', 4, 10],
        ];

        for (const [text, from, to] of cases) {
            expect(spanStyleSource(COLOUR)(text, from, to), `${text} (${from},${to})`).toBeNull();
        }
    });

    // The refusal is what keeps ordinary prose intact: a marker-scanning split
    // reads these asterisks and plus signs as emphasis and eats them.
    it('declines rather than damage literal marker characters in prose', () => {
        expect(spanStyleSource(COLOUR)('2 * 3 and 4 * 5', 6, 9)).toBeNull();
        expect(spanStyleSource(COLOUR)('C++ and Java++', 4, 7)).toBeNull();
    });

    it('declines a selection between two separate emphasis runs', () => {
        expect(spanStyleSource(COLOUR)('a *b* and *c* d', 6, 9)).toBeNull();
    });

    it('declines a selection inside a nested run', () => {
        const text = '**hello *world* again**';
        const at = text.indexOf('again');

        expect(spanStyleSource(COLOUR)(text, at, at + 5)).toBeNull();
    });

    it('declines a selection covering only part of a flanking marker run', () => {
        expect(spanStyleSource(COLOUR)('**hello world**', 8, 15)).toBeNull();
        expect(spanStyleSource(COLOUR)('**hello world**', 0, 7)).toBeNull();
    });

    // The documented cost of the coarse rule: these would have been safe.
    it('over-declines a word on a line whose emphasis is elsewhere', () => {
        expect(spanStyleSource(COLOUR)('*emph* then plain words', 12, 17)).toBeNull();
        expect(spanStyleSource(COLOUR)('*one* and **two** and *three*', 12, 15)).toBeNull();
    });

    it('still wraps a run that is the only emphasis on its line', () => {
        const text = '**world**';
        const edit = spanStyleSource(COLOUR)(text, 2, 7)!;

        expect(apply(text, edit)).toBe('[**world**]{color=#cc0000}');
    });

    // The rewrite re-emits each span and each stretch between spans as its own
    // group, so a marker run wrapping an existing span would be cut in two —
    // `[**hello ]{…}[world]{…}[**]{…}` reads back as literal asterisks.
    it('declines a marker run that wraps an existing span', () => {
        expect(spanStyleSource(COLOUR)('**hello [world]{size=1.2em}**', 0, 29)).toBeNull();
        expect(spanStyleSource(COLOUR)('`a [b]{size=1em}`', 0, 17)).toBeNull();
        expect(spanStyleSource(COLOUR)('**[x]{size=1em}**', 3, 4)).toBeNull();
    });

    it('still styles a word on a line carrying no emphasis at all', () => {
        const text = 'plain words here';
        const edit = spanStyleSource(COLOUR)(text, 6, 11)!;

        expect(apply(text, edit)).toBe('plain [words]{color=#cc0000} here');
    });

    // The rule counts marker CHARACTERS, not emphasis: a `*`/`+` list bullet,
    // a `~` in a path and arithmetic `+` all refuse, while a `-` bullet does not.
    it('declines on a line carrying a marker character that is not emphasis', () => {
        expect(spanStyleSource(COLOUR)('* item here', 2, 6)).toBeNull();
        expect(spanStyleSource(COLOUR)('+ item here', 2, 6)).toBeNull();
        expect(spanStyleSource(COLOUR)('see ~/foo and hello', 14, 19)).toBeNull();
        expect(spanStyleSource(COLOUR)('1 + 1 is two', 9, 12)).toBeNull();

        const edit = spanStyleSource(COLOUR)('- item here', 2, 6)!;

        expect(apply('- item here', edit)).toBe('- [item]{color=#cc0000} here');
    });

    // A `[…]{…}` group carrying a newline is not a span this module can parse,
    // but it is still a span: treating it as plain text re-brackets it into
    // `[[x]{…}]{…}`, which STYLED_TEXT's `[^[\]]+` inner pattern cannot read
    // back. Refusing is the only safe answer. Reachable by pressing Enter
    // inside a styled span in source mode, then restyling part of it.
    it('declines a range inside a span whose group carries a newline', () => {
        const text = '[hello]{color=red\nfoo=bar}';

        expect(spanStyleSource({ color: '#cc0000' })(text, 1, 6)).toBeNull();
    });

    it('declines a range inside a span whose text carries a newline', () => {
        const text = '[hel\nlo]{color=red}';

        expect(spanStyleSource({ 'font-size': '1.2em' })(text, 1, 4)).toBeNull();
    });

    // Distinguishes the no-piece-patched decline from the equality decline: a
    // NON-canonical group re-emits re-ordered, so the rewrite does not equal
    // what it replaces and only the unset-selection guard can refuse it.
    it('declines a caret inside a non-canonically ordered attribute group', () => {
        expect(spanStyleSource({ color: '#cc0000' })('[x]{size=1.2em color=red}', 22, 22)).toBeNull();
    });

    it('declines a selection crossing a line break', () => {
        expect(spanStyleSource({ color: '#cc0000' })('one\ntwo', 0, 7)).toBeNull();
        expect(spanStyleSource({ color: '#cc0000' })('one\ntwo', 3, 4)).toBeNull();
    });

    // A cell's literal `\n\n` is the paragraph break the viewer splits its
    // text on; a span holding it or cutting into it shows it as literal text.
    it('declines a selection holding or cutting into a table cell\'s paragraph break', () => {
        const table = '| a\\n\\nb |\n| - |';

        expect(spanStyleSource({ color: '#cc0000' })(table, 2, 8)).toBeNull();
        expect(spanStyleSource({ color: '#cc0000' })(table, 5, 8)).toBeNull();
        expect(apply(table, spanStyleSource({ color: '#cc0000' })(table, 7, 8)!)).toBe('| a\\n\\n[b]{color=#cc0000} |\n| - |');
    });

    it('declines a selection inside a link', () => {
        expect(spanStyleSource({ color: '#cc0000' })('see [docs](/d) here', 5, 9)).toBeNull();
    });

    it('declines a selection straddling a link', () => {
        expect(spanStyleSource({ color: '#cc0000' })('see [docs](/d) here', 5, 16)).toBeNull();
    });

    it('declines a selection inside an image\'s alt text', () => {
        expect(spanStyleSource({ color: '#cc0000' })('a ![alt](/i.png) b', 4, 7)).toBeNull();
    });

    it('declines a run that would be bracketed while still holding a bracket', () => {
        expect(spanStyleSource({ color: '#cc0000' })('a [b c', 0, 6)).toBeNull();
    });

    it('declines a CSS property the dialect has no attribute key for', () => {
        expect(spanStyleSource({ 'text-decoration': 'underline' })('hello', 0, 5)).toBeNull();
    });

    it('declines a clear that would change nothing', () => {
        expect(spanStyleSource({ color: null })('hello', 0, 5)).toBeNull();
    });

    it('declines an invalid value on plain text', () => {
        expect(spanStyleSource({ color: 'nope!' })('hello', 0, 5)).toBeNull();
    });

    // What the WYSIWYG path does with the same unusable value: it reaches
    // `$patchStyleText` and the export drops it, clearing the old colour.
    it('clears an existing value when the new one is invalid', () => {
        const text = '[x]{color=#cc0000}';
        const edit = spanStyleSource({ color: 'nope!' })(text, 1, 2)!;

        expect(apply(text, edit)).toBe('x');
    });

    it('keeps an attribute key the dialect does not know on re-emit', () => {
        const text = '[x]{weight=bold}';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 1, 2)!;

        expect(apply(text, edit)).toBe('[x]{color=#cc0000 weight=bold}');
    });

    it('quotes a font family containing a space', () => {
        const edit = spanStyleSource({ 'font-family': 'Georgia, serif' })('hello', 0, 5)!;

        expect(apply('hello', edit)).toBe('[hello]{font="Georgia, serif"}');
    });

    it('declines a second identical press', () => {
        const first = spanStyleSource({ color: '#cc0000' })('hello world', 0, 5)!;
        const pressed = apply('hello world', first);

        expect(spanStyleSource({ color: '#cc0000' })(pressed, first.selection.from, first.selection.to))
            .toBeNull();
    });

    // WYSIWYG keeps one text node per distinct style, so a press that leaves
    // part of a span styled exactly as the rest must not fragment it.
    it('declines a redundant press on part of a span', () => {
        expect(spanStyleSource({ color: '#cc0000' })('[hello world]{color=#cc0000}', 7, 12)).toBeNull();
        expect(spanStyleSource({ 'font-size': '1.2em' })('[a b c]{size=1.2em}', 3, 4)).toBeNull();
    });

    it('emits equally styled neighbours as one span', () => {
        const text = '[warning]{color=#cc0000} text';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('[warning text]{color=#cc0000}');
        expect(edit.selection).toEqual({ from: 1, to: 13 });

        const abutting = '[a]{color=#cc0000}b';
        const joined = spanStyleSource({ color: '#cc0000' })(abutting, 18, 19)!;

        expect(apply(abutting, joined)).toBe('[ab]{color=#cc0000}');
        expect(joined.selection).toEqual({ from: 2, to: 3 });
    });

    it('rejoins a split span once its parts are styled alike again', () => {
        const text = '[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}';
        const at = text.indexOf('world');
        const edit = spanStyleSource({ color: null })(text, at, at + 5)!;

        expect(apply(text, edit)).toBe('[hello world]{size=1.2em}');
        expect(edit.selection).toEqual({ from: 7, to: 12 });
    });
});

// Each `{…}` attribute group the dialect writes outside a styled span belongs
// to a construct a span cannot nest in: bracketing a word inside one turns the
// group into `{width=[320]{…}}`, which its importer no longer reads, so the
// construct falls apart (an image loses its size, a fence its alignment, a
// table its delimiter row and with it the whole table).
describe('spanStyleSource refuses the dialect\'s other attribute groups', () => {
    const COLOUR = { color: '#cc0000' };

    it('declines a caret or selection inside an image\'s size group', () => {
        const text = '![a](/i.png){width=320}';
        const at = text.indexOf('320');

        expect(spanStyleSource(COLOUR)(text, at + 1, at + 1)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, at, at + 3)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, text.indexOf('width'), text.indexOf('width') + 5)).toBeNull();
    });

    it('declines a selection reaching into an image\'s size group from outside', () => {
        const text = '![a](/i.png){width=320} tail';

        expect(spanStyleSource(COLOUR)(text, text.indexOf('320'), text.length)).toBeNull();
    });

    it('declines a caret inside an image\'s alt text or destination', () => {
        const text = '![alt](/img.png){width=320}';

        expect(spanStyleSource(COLOUR)(text, 3, 3)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, text.indexOf('img') + 1, text.indexOf('img') + 1)).toBeNull();
    });

    // A title in parentheses is CommonMark link syntax the link commands
    // already read; the refusal must recognise the same link.
    it('declines a selection inside a link carrying a parenthesised title', () => {
        const text = 'see [docs](/d (Title)) here';

        expect(spanStyleSource(COLOUR)(text, 5, 9)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, text.indexOf('Title'), text.indexOf('Title') + 5)).toBeNull();
    });

    it('still styles prose after a sized image', () => {
        const text = '![a](/i.png){width=320} and more';
        const at = text.indexOf('more');
        const edit = spanStyleSource(COLOUR)(text, at, at + 4)!;

        expect(apply(text, edit)).toBe('![a](/i.png){width=320} and [more]{color=#cc0000}');
    });

    it('declines anywhere on a ::: fence line', () => {
        const text = '::: {align=center gap=2em}\nhello\n:::';
        const at = text.indexOf('center');

        expect(spanStyleSource(COLOUR)(text, at + 1, at + 1)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, at, at + 6)).toBeNull();

        const named = '::: note {align=center}\nhello\n:::';

        expect(spanStyleSource(COLOUR)(named, 4, 8)).toBeNull();
    });

    it('still styles text inside a ::: fence', () => {
        const text = '::: {align=center}\nhello\n:::';
        const at = text.indexOf('hello');
        const edit = spanStyleSource(COLOUR)(text, at, at + 5)!;

        expect(apply(text, edit)).toBe('::: {align=center}\n[hello]{color=#cc0000}\n:::');
    });

    it('declines anywhere on a table delimiter row', () => {
        const text = '| a | b |\n| :--- {width=240} | --- |\n| c | d |';
        const at = text.indexOf('240');

        expect(spanStyleSource(COLOUR)(text, at + 1, at + 1)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, text.indexOf('width'), text.indexOf('width') + 5)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, text.indexOf(':---'), at + 3)).toBeNull();
    });

    it('still styles a table cell', () => {
        const text = '| a | b |\n| :--- {width=240} | --- |\n| c | d |';
        const at = text.indexOf('c');
        const edit = spanStyleSource(COLOUR)(text, at, at + 1)!;

        expect(apply(text, edit)).toBe('| a | b |\n| :--- {width=240} | --- |\n| [c]{color=#cc0000} | d |');
    });
});

// A bracket written straight after an escaping backslash is literal text, as
// is one written straight after a selection ending in one: either way the span
// syntax would stay visible, and the backslash would no longer mean what it
// meant. The inline toggles decline the same shape (`C:\**Users**`).
describe('spanStyleSource and backslash escapes', () => {
    const COLOUR = { color: '#cc0000' };

    it('declines a selection straight after an escaping backslash', () => {
        expect(spanStyleSource(COLOUR)('C:\\Users', 3, 8)).toBeNull();
        expect(spanStyleSource(COLOUR)('C:\\Users', 5, 5)).toBeNull();
    });

    it('declines a selection ending in an escaping backslash', () => {
        expect(spanStyleSource(COLOUR)('a\\ b', 0, 2)).toBeNull();
    });

    it('declines a split that would end a span\'s text in a backslash', () => {
        const text = '[a\\b]{size=1em}';

        expect(spanStyleSource(COLOUR)(text, 3, 4)).toBeNull();
    });

    it('styles a selection after an escaped backslash, which is literal', () => {
        const text = 'C:\\\\Users';
        const edit = spanStyleSource(COLOUR)(text, 4, 9)!;

        expect(apply(text, edit)).toBe('C:\\\\[Users]{color=#cc0000}');
    });
});

describe('CLEAR_FORMAT_SOURCE', () => {
    // Selections here are the plan's contract inputs — the selected WORD, not
    // the whole marked run. Selecting the whole run makes the raw and
    // normalised ranges coincide, which hides a raw/normalised mismatch.
    it('strips nested bold+italic markers around the selected word', () => {
        const text = '***hello***';
        const edit = CLEAR_FORMAT_SOURCE(text, 3, 8)!;

        expect(apply(text, edit)).toBe('hello');
    });

    it('strips an inner italic run inside an outer bold selection', () => {
        const text = '**a *hello* b**';
        const edit = CLEAR_FORMAT_SOURCE(text, 2, 13)!;

        expect(apply(text, edit)).toBe('a hello b');
    });

    it('strips the enclosing markers from a collapsed caret inside a bold word', () => {
        const text = '**hello**';
        const edit = CLEAR_FORMAT_SOURCE(text, 4, 4)!;

        expect(apply(text, edit)).toBe('hello');
    });

    // Nothing to clear is no edit at all — not an identical rewrite, which
    // would still cost the user an undo step.
    it('declines when the selection carries no formatting', () => {
        expect(CLEAR_FORMAT_SOURCE('a hello b', 2, 8)).toBeNull();
    });

    it('leaves a link untouched, declining', () => {
        expect(CLEAR_FORMAT_SOURCE('[hello](x)', 1, 6)).toBeNull();
    });

    // A selection that touches only one marker of a pair still clears the
    // pair: deleting just the selected marker leaves its partner behind.
    it('removes the whole bold pair when the selection touches only its closer', () => {
        const text = 'a **bold** b';
        const edit = CLEAR_FORMAT_SOURCE(text, 7, 10)!;

        expect(apply(text, edit)).toBe('a bold b');
        expect(edit.selection).toEqual({ from: 5, to: 6 });
    });

    it('removes the whole code span when the selection touches only its closer', () => {
        const text = 'a `code` b';
        const edit = CLEAR_FORMAT_SOURCE(text, 6, 8)!;

        expect(apply(text, edit)).toBe('a code b');
    });

    it('removes every pair the selection touches, and only those', () => {
        const text = '**a** and *b* or ~~c~~';
        const edit = CLEAR_FORMAT_SOURCE(text, 2, 12)!;

        expect(apply(text, edit)).toBe('a and b or ~~c~~');
    });

    it('keeps the markers inside a code span, which are literal there', () => {
        const text = '**x** `a*b*c`';
        const edit = CLEAR_FORMAT_SOURCE(text, 0, 5)!;

        expect(apply(text, edit)).toBe('x `a*b*c`');
    });

    it('declines a marker with no partner', () => {
        expect(CLEAR_FORMAT_SOURCE('a **bold b', 4, 8)).toBeNull();
    });

    it('declines escaped markers, which are literal text', () => {
        expect(CLEAR_FORMAT_SOURCE('\\*a\\*', 0, 5)).toBeNull();
    });

    it('never treats a thematic break as markers', () => {
        expect(CLEAR_FORMAT_SOURCE('para\n\n***\n\nmore', 6, 9)).toBeNull();
        expect(CLEAR_FORMAT_SOURCE('para\n\n* * *\n\nmore', 6, 11)).toBeNull();
    });

    it('does not pair markers across a blank line', () => {
        expect(CLEAR_FORMAT_SOURCE('**a\n\nb**', 5, 8)).toBeNull();
    });

    it('is a no-op on a collapsed caret that expands to nothing', () => {
        expect(CLEAR_FORMAT_SOURCE('a  b', 2, 2)).toBeNull();
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

describe('blockPrefixSource', () => {
    it('converts a heading to a quote', () => {
        const text = '## Title';
        const edit = blockPrefixSource('> ')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('> Title');
    });

    it('converts a quote to a heading', () => {
        const text = '> quoted';
        const edit = blockPrefixSource('## ')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('## quoted');
    });

    it('converts a list item to a paragraph', () => {
        const text = '- item';
        const edit = blockPrefixSource('')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('item');
    });

    it('drops the fence lines when converting a fenced code block to a paragraph', () => {
        const text = '```\nhello\n```';
        const edit = blockPrefixSource('')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('hello');
    });

    it('expands a caret to its whole line', () => {
        const text = '## Title';
        const edit = blockPrefixSource('> ')(text, 4, 4)!;

        expect(apply(text, edit)).toBe('> Title');
    });

    it('declines when the lines already carry the prefix', () => {
        expect(blockPrefixSource('')('hello', 0, 5)).toBeNull();
        expect(blockPrefixSource('## ')('## Title', 3, 3)).toBeNull();
    });
});

describe('FENCED_CODE_SOURCE', () => {
    it('wraps plain text in a fence', () => {
        const text = 'hello';
        const edit = FENCED_CODE_SOURCE(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('```\nhello\n```');
    });

    it('declines when the lines already are a fenced block', () => {
        expect(FENCED_CODE_SOURCE('```\nhello\n```', 0, 13)).toBeNull();
    });
});

describe('listSource', () => {
    it('turns plain lines into an unordered list', () => {
        const text = 'a\nb';
        const edit = listSource('unordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('- a\n- b');
    });

    it('turns an unordered list back into plain lines', () => {
        const text = '- a\n- b';
        const edit = listSource('unordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('a\nb');
    });

    it('adds the marker to every line when only some already carry it', () => {
        const text = '- a\nb';
        const edit = listSource('unordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('- a\n- b');
    });

    it('turns plain lines into an ordered list, counting from one', () => {
        const text = 'a\nb';
        const edit = listSource('ordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('1. a\n2. b');
    });

    it('turns an ordered list back into plain lines', () => {
        const text = '1. a\n2. b';
        const edit = listSource('ordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('a\nb');
    });

    it('takes both whole lines for a partial multi-line selection', () => {
        const text = 'one\ntwo';
        const edit = listSource('unordered')(text, 1, 5)!;

        expect(apply(text, edit)).toBe('- one\n- two');
    });
});

// A line command rewrites line prefixes, so it must never reach a line that
// belongs to a multi-line construct other than paragraph text: rewriting one
// line of a fence, table, definition, `:::` fence or HTML block breaks the
// whole construct. Such a selection is declined; a fenced code block covered
// whole, fences included, still converts as one unit.
describe('line commands leave multi-line constructs whole', () => {
    const lineCommands = {
        paragraph: blockPrefixSource(''),
        heading:   blockPrefixSource('## '),
        quote:     blockPrefixSource('> '),
        bullets:   listSource('unordered'),
        numbers:   listSource('ordered'),
        code:      FENCED_CODE_SOURCE,
    };

    /** Runs every line command on `[from, to)` of `text`, keyed by name, `'declined'` for a `null`. */
    function runAll(text: string, from: number, to: number): Record<string, string> {
        return Object.fromEntries(Object.entries(lineCommands).map(([name, command]) => {
            const edit = command(text, from, to);

            return [name, edit === null ? 'declined' : apply(text, edit)];
        }));
    }

    /** Asserts every line command declines on `[from, to)` of `text`. */
    function expectAllDecline(text: string, from: number, to: number): void {
        expect(runAll(text, from, to)).toEqual(Object.fromEntries(Object.keys(lineCommands).map((name) => [name, 'declined'])));
    }

    it('declines a selection holding only one of a fence\'s two lines', () => {
        const text = '```\nx\n```\n\npara *em*';
        const from = text.indexOf('```\n\npara');

        expectAllDecline(text, from, from + '```\n\npara'.length);
        expectAllDecline(text, 0, 5);
    });

    it('declines a caret on a fenced code block\'s content', () => {
        expectAllDecline('```\nx\n```', 4, 4);
        expectAllDecline('~~~\nx\n~~~', 4, 4);
        expectAllDecline('para\n\n````\n```\nx\n````', 15, 15);
    });

    it('declines a caret on an indented code block', () => {
        const text = 'para\n\n    code\n    more';

        expectAllDecline(text, 10, 10);
        expectAllDecline(text, 0, text.length);
    });

    it('declines a table row, the delimiter row and the header', () => {
        const text = '| c |\n| - |\n| d |';

        expectAllDecline(text, 0, 0);
        expectAllDecline(text, 7, 7);
        expectAllDecline(text, 14, 14);
        expectAllDecline('| a | b |\n| :--- | --- {width=80} |\n| c | d |', 30, 30);
    });

    it('declines a link reference definition and its continuation lines', () => {
        const text = '[r]\n\n[r]:\n  /u\n  "title"';

        expectAllDecline(text, 5, 5);
        expectAllDecline(text, text.indexOf('/u'), text.indexOf('/u'));
        expectAllDecline(text, text.indexOf('title'), text.indexOf('title'));
    });

    it('declines a `:::` fence line, but not the Markdown inside the fence', () => {
        const text = '::: x\nA\n:::';

        expectAllDecline(text, 0, 0);
        expectAllDecline(text, text.length, text.length);
        expectAllDecline(text, 0, text.length);
        expect(runAll(text, 6, 6).heading).toBe('::: x\n## A\n:::');
    });

    it('declines a line of an HTML block', () => {
        expectAllDecline('<div>\nhi\n</div>', 7, 7);
        expectAllDecline('<!-- a\n\nb -->', 8, 8);
    });

    it('still rewrites paragraph text next to a construct', () => {
        expect(runAll('| c |\n| - |\n\npara', 14, 14).heading).toBe('| c |\n| - |\n\n## para');
        expect(runAll('```\nx\n```\n\npara', 12, 12).quote).toBe('```\nx\n```\n\n> para');
        expect(runAll('[r]: /u\n\npara', 10, 10).bullets).toBe('[r]: /u\n\n- para');
    });

    it('converts a fenced code block covered whole, dropping both of its fences', () => {
        const text = '```\nx\n```\n\npara';

        expect(runAll(text, 0, text.length).paragraph).toBe('x\n\npara');
        expect(runAll('~~~\nx\n~~~', 0, 9).paragraph).toBe('x');
        expect(runAll('para\n```\nx\n```', 0, 14).code).toBe('```\npara\nx\n```');
    });

    it('never turns a fenced code block covered whole into list items', () => {
        expect(runAll('```\nx\n```', 0, 9).bullets).toBe('declined');
    });
});

// A paragraph's lines read as one block: a line below the first continues it,
// lazily or indented. A line command acting on some of those lines leaves the
// others to be re-read on their own — as a definition, indented code, an HTML
// block, or under a setext underline that no longer closes a heading — so the
// commands that rewrite a block take its whole paragraph, and the list toggle,
// which keeps its one-item-per-line reading, declines a line that would read
// as anything but text once it opens an item.
describe('line commands keep a paragraph whole', () => {
    it('turns every line of the caret\'s paragraph into a heading', () => {
        expect(apply('foo\n    bar', blockPrefixSource('## ')('foo\n    bar', 1, 1)!)).toBe('## foo\n## bar');
        expect(apply('- one two\n  three', blockPrefixSource('## ')('- one two\n  three', 3, 3)!)).toBe('## one two\n## three');
        expect(apply('foo\nbar', blockPrefixSource('## ')('foo\nbar', 5, 5)!)).toBe('## foo\n## bar');
    });

    it('quotes and unquotes the whole paragraph', () => {
        expect(apply('foo\nbar', blockPrefixSource('> ')('foo\nbar', 5, 5)!)).toBe('> foo\n> bar');
        expect(apply('> foo\n> bar\nlazy', blockPrefixSource('')('> foo\n> bar\nlazy', 1, 1)!)).toBe('foo\nbar\nlazy');
    });

    it('fences the whole paragraph', () => {
        expect(apply('foo\n    bar', FENCED_CODE_SOURCE('foo\n    bar', 1, 1)!)).toBe('```\nfoo\n    bar\n```');
    });

    it('stops at a blank line and at a line that interrupts the paragraph', () => {
        expect(apply('foo\nbar\n\nbaz', blockPrefixSource('## ')('foo\nbar\n\nbaz', 1, 1)!)).toBe('## foo\n## bar\n\nbaz');
        expect(apply('foo\n- item', blockPrefixSource('## ')('foo\n- item', 1, 1)!)).toBe('## foo\n- item');
        expect(apply('## h\nfoo', blockPrefixSource('> ')('## h\nfoo', 5, 5)!)).toBe('## h\n> foo');
        expect(apply('1. a\n2. b', blockPrefixSource('## ')('1. a\n2. b', 3, 3)!)).toBe('## a\n2. b');
        expect(apply('> a\n>\n> b', blockPrefixSource('## ')('> a\n>\n> b', 2, 2)!)).toBe('## a\n>\n> b');
    });

    it('drops a setext heading\'s underline with the rest of its syntax', () => {
        const text = 'foo\nbar\n===';

        expect(apply(text, blockPrefixSource('## ')(text, 1, 1)!)).toBe('## foo\n## bar');
        expect(apply(text, blockPrefixSource('')(text, text.length, text.length)!)).toBe('foo\nbar');
        expect(apply(text, FENCED_CODE_SOURCE(text, 1, 1)!)).toBe('```\nfoo\nbar\n```');
    });

    it('lets the lines below a new list item continue it', () => {
        expect(apply('foo\nbar', listSource('unordered')('foo\nbar', 1, 1)!)).toBe('- foo\nbar');
    });

    it('drops a continuation line\'s indentation when it opens a list item', () => {
        const text = 'foo\n    bar';

        expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('- foo\n- bar');
    });

    it('declines a list item over a continuation line that would read as an HTML block', () => {
        const text = 'foo\n<span>';

        expect(listSource('unordered')(text, 6, 6)).toBeNull();
        expect(listSource('ordered')(text, 0, text.length)).toBeNull();
    });

    it('declines a list item that a line below would interrupt rather than continue', () => {
        expect(listSource('ordered')('foo\n2. bar', 1, 1)).toBeNull();
        expect(listSource('unordered')('foo\n    # not a heading', 1, 1)).toBeNull();
    });

    it('keeps a continuation line\'s leading number or marker as its text', () => {
        expect(apply('foo\n2. bar', blockPrefixSource('## ')('foo\n2. bar', 1, 1)!)).toBe('## foo\n## 2. bar');
        expect(listSource('unordered')('foo\n2. bar', 0, 10)).toBeNull();
    });

    it('declines a list item over a setext heading\'s text', () => {
        expect(listSource('unordered')('foo\n===', 1, 1)).toBeNull();
        expect(listSource('ordered')('foo\nbar\n===', 5, 5)).toBeNull();
    });
});

// A blank line is no block, only the gap between two; a heading or list
// marker written onto it joins the blocks on either side to the new one —
// an empty list item cannot interrupt a paragraph, so it reads as that
// paragraph's text, and the text below it as the item's.
describe('line commands leave blank lines blank', () => {
    it('declines on a blank line alone', () => {
        const text = 'foo\n\nbar';

        for (const command of [listSource('unordered'), listSource('ordered'), blockPrefixSource('## '), blockPrefixSource('> ')]) {
            expect(command(text, 4, 4)).toBeNull();
        }
    });

    it('marks only the non-blank lines of a selection spanning several blocks', () => {
        const text = 'foo\n\nbar';

        expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('- foo\n\n- bar');
        expect(apply(text, listSource('ordered')(text, 0, text.length)!)).toBe('1. foo\n\n2. bar');
        expect(apply(text, blockPrefixSource('## ')(text, 0, text.length)!)).toBe('## foo\n\n## bar');
    });

    it('toggles a list off across the blank lines between its items', () => {
        const text = '- a\n\n- b';

        expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('a\n\nb');
    });
});

// The WYSIWYG editor holds no code block or table inside a list item, and
// syntax written at column 0 there ends the list, leaving the rest of the
// item's content outside it. A list item's own marker line still converts.
describe('code fences and tables stay out of list items', () => {
    it('declines a fence or a table on a list item\'s indented content', () => {
        expect(FENCED_CODE_SOURCE('- a\n\n  b', 7, 7)).toBeNull();
        expect(tableSource(2, 2)('- a\n\n  b', 7, 7)).toBeNull();
        expect(FENCED_CODE_SOURCE('- x\n  - a', 8, 8)).toBeNull();
        expect(tableSource(2, 2)('- x\n  - a', 8, 8)).toBeNull();
    });

    it('still fences a top-level list item, and an indented paragraph outside a list', () => {
        expect(apply('- a\n- b', FENCED_CODE_SOURCE('- a\n- b', 1, 1)!)).toBe('```\na\n```\n- b');
        expect(apply('foo\n  bar', FENCED_CODE_SOURCE('foo\n  bar', 6, 6)!)).toBe('```\nfoo\n  bar\n```');
    });
});

// A table cell keeps its paragraphs apart with a literal `\n\n` — the
// sequence the viewer splits a cell's text on — so an inline command must not
// write syntax into it: markers inside it show as literal text, and markers
// cutting it leave a lone `\n` that shows as literal text too.
describe('inline commands keep a table cell\'s paragraph break whole', () => {
    const table = '| a\\n\\nb |\n| - |';

    it('declines a range holding the break', () => {
        expect(INLINE_CODE_SOURCE(table, 2, 8)).toBeNull();
        expect(BOLD_SOURCE(table, 2, 8)).toBeNull();
        expect(linkSource('/u')(table, 2, 8)).toBeNull();
    });

    it('declines a range cutting into the break', () => {
        expect(BOLD_SOURCE(table, 5, 8)).toBeNull();
        expect(ITALIC_SOURCE(table, 2, 5)).toBeNull();
        expect(linkSource('/u')(table, 5, 8)).toBeNull();
    });

    it('still wraps the text on either side of the break', () => {
        expect(apply(table, BOLD_SOURCE(table, 7, 8)!)).toBe('| a\\n\\n**b** |\n| - |');
        expect(apply(table, INLINE_CODE_SOURCE(table, 2, 3)!)).toBe('| `a`\\n\\nb |\n| - |');
    });

    it('still wraps a literal `\\n\\n` outside a table', () => {
        const text = 'use a\\n\\nb here';

        expect(apply(text, INLINE_CODE_SOURCE(text, 4, 10)!)).toBe('use `a\\n\\nb` here');
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

describe('imageSource', () => {
    it('rejects an unsafe scheme', () => {
        expect(imageSource('javascript:alert(1)', 'x', {})('', 0, 0)).toBeNull();
    });

    it('emits the dialect\'s attribute block', () => {
        const edit = imageSource('/d.png', 'Diagram', { width: '320' })('', 0, 0)!;

        expect(edit.insert).toBe('![Diagram](/d.png){width=320}');
    });

    it.each([
        ['an image\'s alt text', '![alt](/a.png) x', 3, 3],
        ['an image\'s source', '![alt](/a.png) x', 9, 9],
        ['an image\'s size group', '![alt](/a.png){width=320} x', 20, 20],
        ['an image\'s alt text, from a selection starting outside', 'x ![alt](/a.png)', 0, 5],
        ['a link\'s destination', '[docs](/d "Title") x', 9, 9],
        ['a link\'s title', '[docs](/d "Title") x', 13, 13],
        ['a link\'s syntax between its text and destination', '[docs](/d) x', 6, 6],
    ])('declines with an end inside %s', (_name, text, from, to) => {
        expect(imageSource('/i.png', 'i', {})(text, from, to)).toBeNull();
    });

    // A table's rows and pipes are its structure: an image written over a
    // row break joins two rows, and one outside a row's pipes is a cell past
    // the header, which the viewer drops.
    it.each([
        ['after a row\'s closing pipe', '| a |\n| --- |\n| b |', 5, 5],
        ['before a row\'s opening pipe', '| a |\n| --- |\n| b |', 14, 14],
        ['on the delimiter row', '| a |\n| --- |\n| b |', 9, 9],
        ['over a row break', '| a |\n| --- |\n| b |', 13, 16],
        ['over a pipe between cells', '| a | c |\n| --- | --- |\n| b | d |', 2, 7],
    ])('declines in a table %s', (_name, text, from, to) => {
        expect(imageSource('/i.png', 'i', {})(text, from, to)).toBeNull();
    });

    it.each([
        ['inside a cell', '| a |\n| --- |\n| b |', 17, 17, '| a |\n| --- |\n| b![i](/i.png) |'],
        ['inside an empty cell', '| a |\n| --- |\n|  |', 16, 16, '| a |\n| --- |\n| ![i](/i.png) |'],
        ['in a row with no outer pipes', 'a | b\n--- | ---\nc | d', 0, 0, '![i](/i.png)a | b\n--- | ---\nc | d'],
    ])('inserts in a table %s', (_name, text, from, to, expected) => {
        expect(apply(text, imageSource('/i.png', 'i', {})(text, from, to)!)).toBe(expected);
    });

    // A `:::` fence's opening and closing lines and its `|||` separators
    // hold its structure; an image written on one is no image, and breaks it.
    it.each([
        ['on a fence\'s opening line', '::: columns {align=center}\na\n:::', 20, 20],
        ['over a fence\'s opening line', '::: columns\na\n:::', 5, 13],
        ['on a column separator', '::: columns\na\n|||\nb\n:::', 15, 15],
        ['on a fence\'s closing line', '::: columns\na\n:::', 15, 15],
    ])('declines %s', (_name, text, from, to) => {
        expect(imageSource('/i.png', 'i', {})(text, from, to)).toBeNull();
    });

    // A code fence's opening and closing lines delimit the code block: an
    // image written over a fence line's indentation, or onto the line, ends
    // or opens the block somewhere else, and the lines around it read anew.
    it.each([
        ['over a fence\'s indentation', 'a\n\n   ```\n[d]: /u\n   ```\n', 3, 6],
        ['on a fence\'s opening line, after its backticks', 'a\n\n```js\nx\n```\n', 6, 6],
        ['at the start of a fence\'s opening line', 'a\n\n```\nx\n```\n', 3, 3],
        ['on a fence\'s closing line', 'a\n\n```\nx\n```\n', 12, 12],
        ['on a tilde fence\'s closing line', '~~~\nx\n~~~\n', 8, 8],
        ['over a fence line from the paragraph above', 'a\n```\nx\n```\n', 0, 3],
    ])('declines %s', (_name, text, from, to) => {
        expect(imageSource('/i.png', 'i', {})(text, from, to)).toBeNull();
    });

    it('inserts in the paragraph after a closed code block', () => {
        const text = '```\nx\n```\nb';

        expect(apply(text, imageSource('/i.png', 'i', {})(text, 10, 10)!)).toBe('```\nx\n```\n![i](/i.png)b');
    });

    it('inserts in a column\'s text', () => {
        const text = '::: columns\na\n|||\nb\n:::';

        expect(apply(text, imageSource('/i.png', 'i', {})(text, 13, 13)!)).toBe('::: columns\na![i](/i.png)\n|||\nb\n:::');
    });

    it.each([
        ['inside a link\'s text', '[docs](/d) x', 3, 3, '[do![i](/i.png)cs](/d) x'],
        ['just before an image', '![alt](/a.png)', 0, 0, '![i](/i.png)![alt](/a.png)'],
        ['just after an image', '![alt](/a.png)', 14, 14, '![alt](/a.png)![i](/i.png)'],
        ['over a whole link', 'x [docs](/d) y', 2, 12, 'x ![i](/i.png) y'],
    ])('inserts %s', (_name, text, from, to, expected) => {
        expect(apply(text, imageSource('/i.png', 'i', {})(text, from, to)!)).toBe(expected);
    });
});

describe('tableSource', () => {
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
