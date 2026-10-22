import { describe, it, expect } from 'vitest';
import {
    BOLD_SOURCE, ITALIC_SOURCE, UNDERLINE_SOURCE, STRIKETHROUGH_SOURCE, INLINE_CODE_SOURCE,
    REMOVE_LINK_SOURCE, CLEAR_FORMAT_SOURCE, linkSource, spanStyleSource, readSourceSelectionState, imageSource,
} from '~/component/editor/markdownSourceEdits';
import {
    FENCED_CODE_SOURCE, blockPrefixSource, listSource, paragraphAroundBlockSource, tableSource,
} from '~/component/editor/markdownSourceLines';
import type { MarkdownSourceEdit } from '~/component/editor/markdownSourceEdits';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { formatDelimiterRow } from '~/component/editor/markdownSerializer';
import type { Token } from 'marked';
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
    });

    // The viewer's `++` extension has no flanking test, and source mode now
    // reads the document through it, so the wrap reads back as underline.
    it('wraps underline regardless of flanking, as the viewer reads `++`', () => {
        const text = 'a hello.b';

        expect(apply(text, UNDERLINE_SOURCE(text, 2, 8)!)).toBe('a ++hello.++b');
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

    // The viewer pairs `++` with no flanking test, so an underline cannot
    // nest in another; a partly covered one splits like any other run.
    it('removes a doubled strikethrough, and splits an underline, the same way', () => {
        const struck = '~~one ~~two~~ six~~';

        expect(apply(struck, STRIKETHROUGH_SOURCE(struck, 8, 11)!)).toBe('~~one~~ two ~~six~~');

        const underlined = '++one two++';

        expect(apply(underlined, UNDERLINE_SOURCE(underlined, 6, 9)!)).toBe('++one++ two');
    });

    it('splits a code span around the selection, keeping its spaces as code', () => {
        const text = '`hello world`';
        const edit = INLINE_CODE_SOURCE(text, 7, 12)!;

        expect(readSourceSelectionState(text, 7, 12).code).toBe(true);
        expect(apply(text, edit)).toBe('`hello `world');
    });

    it('writes a split\'s kept run inside a link the selection reaches into', () => {
        const text = '**[foo bar](/u)**';

        expect(apply(text, BOLD_SOURCE(text, 7, 10)!)).toBe('[**foo** bar](/u)');
    });

    it('removes underscore and single-tilde runs around the selection too', () => {
        const bold = '__foo, __bar__ az__';
        const struck = '~[~zq0001~](https://e.test/zq0005)~';

        expect(apply(bold, BOLD_SOURCE(bold, 9, 12)!)).toBe('__foo,__ bar __az__');
        expect(apply(struck, STRIKETHROUGH_SOURCE(struck, 3, 9)!)).toBe('[zq0001](https://e.test/zq0005)');
    });

    it('keeps the format on the rest of a link and the text after it', () => {
        const text = '***[**zq0029** r](/u) zq0035***';
        const [from, to] = rangeOf(text, 'zq0029');
        const edit = BOLD_SOURCE(text, from, to)!;
        const result = apply(text, edit);

        expect(result).toBe('*[zq0029 **r**](/u) **zq0035***');
        expect(result.slice(edit.selection.from, edit.selection.to)).toBe('zq0029');
        expect(readSourceSelectionState(result, edit.selection.from, edit.selection.to)).toMatchObject({ bold: false, italic: true });
    });

    it('declines when no Markdown reads as the selection without the format', () => {
        // A bold run cannot open between `9` and `[`: the marker would be no left-flanking run.
        const text = '***[**zq0029**[r]](/u) zq0035***';

        expect(BOLD_SOURCE(text, ...rangeOf(text, 'zq0029'))).toBeNull();
    });

    it('escapes the code taken out of a code span when it would read as Markdown', () => {
        const text = '`a *b* c`';

        expect(apply(text, INLINE_CODE_SOURCE(text, 3, 6)!)).toBe('`a `\\*b\\*` c`');
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

    it('escapes the & of a character reference in a new link\'s URL, so the link reads back to that URL', () => {
        const text = 'see docs here';

        expect(apply(text, linkSource('/a&copy;')(text, 4, 8)!)).toBe('see [docs](/a\\&copy;) here');
        expect(apply(text, linkSource('/a b&amp;')(text, 4, 8)!)).toBe('see [docs](</a b\\&amp;>) here');
    });

    it('escapes it in the title a reference link brings when it becomes an inline link', () => {
        const text = 'see [docs][r]\n\n[r]: /d "&amp;copy;"';

        expect(apply(text, linkSource('/e')(text, 6, 6)!)).toBe('see [docs](/e "\\&copy;")\n\n[r]: /d "&amp;copy;"');
    });

    it('keeps the text of an autolink holding a reference when it is unlinked or pointed elsewhere', () => {
        const text = 'x <https://a.t/?q&copy;> y';

        expect(apply(text, REMOVE_LINK_SOURCE(text, 8, 8)!)).toBe('x https\\://a.t/?q\\&copy; y');
        expect(apply(text, linkSource('/n')(text, 8, 8)!)).toBe('x [https://a.t/?q\\&copy;](/n) y');
    });

    it('does the same for a numeric reference in an autolink', () => {
        const text = 'x <https://a.t/?q&#35;> y';

        expect(apply(text, REMOVE_LINK_SOURCE(text, 8, 8)!)).toBe('x https\\://a.t/?q\\&#35; y');
        expect(apply(text, linkSource('/n')(text, 8, 8)!)).toBe('x [https://a.t/?q\\&#35;](/n) y');
    });

    it('writes a destination holding angle brackets or a control character in angle brackets, escaped', () => {
        const text = 'see docs here';

        expect(apply(text, linkSource('/a<b>c')(text, 4, 8)!)).toBe('see [docs](</a\\<b\\>c>) here');
        expect(apply(text, linkSource('/a\u0001b')(text, 4, 8)!)).toBe('see [docs](</a\u0001b>) here');
    });

    it.each(['/a\u00A0', '\u00A0/a', '/a\u00A0b', '/a\u2003', '\u2003/a'])('reads a destination %j back exactly, as marked trims and splits at Unicode spaces', (url) => {
        const text = 'see docs here';
        const result = apply(text, linkSource(url)(text, 4, 8)!);
        const paragraph = lexMarkdown(result)[0] as { tokens: Array<{ type: string; href?: string }> };
        const link = paragraph.tokens.find((token) => token.type === 'link');

        expect(link?.href).toBe(url);
    });

    it('links to a destination holding a backslash exactly as given', () => {
        const text = 'see docs here';

        expect(apply(text, linkSource('/a\\&copy;')(text, 4, 8)!)).toBe('see [docs](</a\\\\\\&copy;>) here');
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

    // The brackets land INSIDE the emphasis run, `**[hello]{…}**` — the form
    // the serializer writes for colour on a whole bold run (S19), so a span
    // written in source mode saves unchanged after a switch to WYSIWYG.
    it('writes the span inside the emphasis run around the selection', () => {
        const edit = spanStyleSource({ color: '#cc0000' })('a **hello** b', 4, 9)!;

        expect(edit).toEqual({
            from: 4, to: 9, insert: '[hello]{color=#cc0000}', selection: { from: 5, to: 10 },
        });
    });

    it('writes it inside the run when the selection included the markers too', () => {
        const text = 'a **hello** b';
        const edit = spanStyleSource({ color: '#cc0000' })(text, 2, 11)!;

        expect(apply(text, edit)).toBe('a **[hello]{color=#cc0000}** b');
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

    // Source mode reads the line through the viewer's own tokens, so it refuses
    // only a selection that would cut a token's syntax in two, and styles text
    // anywhere else — inside emphasis of any family, beside other runs, beside
    // literal marker characters the viewer reads as text.
    const COLOUR = { color: '#cc0000' };

    it('styles a selection inside a wider emphasis run, for every family', () => {
        for (const text of ['**hello world**', '*hello world*', '~~hello world~~', '++hello world++']) {
            const at = text.indexOf('world');
            const marker = text.slice(0, text.indexOf('hello'));

            expect(apply(text, spanStyleSource(COLOUR)(text, at, at + 5)!), text)
                .toBe(`${marker}hello [world]{color=#cc0000}${marker}`);
        }
    });

    // Code is atomic: a span inside the backticks would be code text.
    it('declines a selection inside a code span', () => {
        const text = '`hello world`';
        const at = text.indexOf('world');

        expect(spanStyleSource(COLOUR)(text, at, at + 5)).toBeNull();
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

    // The viewer reads these asterisks and plus signs as literal text, or (the
    // second) as the `++…++` underline it is, and the span keeps them either way.
    it('styles prose around literal marker characters without touching them', () => {
        expect(apply('2 * 3 and 4 * 5', spanStyleSource(COLOUR)('2 * 3 and 4 * 5', 6, 9)!))
            .toBe('2 * 3 [and]{color=#cc0000} 4 * 5');
        expect(apply('C++ and Java++', spanStyleSource(COLOUR)('C++ and Java++', 4, 7)!))
            .toBe('C++ [and]{color=#cc0000} Java++');
    });

    it('styles a selection between two separate emphasis runs', () => {
        expect(apply('a *b* and *c* d', spanStyleSource(COLOUR)('a *b* and *c* d', 6, 9)!))
            .toBe('a *b* [and]{color=#cc0000} *c* d');
    });

    it('styles a selection inside a nested run', () => {
        const text = '**hello *world* again**';
        const at = text.indexOf('again');

        expect(apply(text, spanStyleSource(COLOUR)(text, at, at + 5)!)).toBe('**hello *world* [again]{color=#cc0000}**');
    });

    it('declines a selection covering only part of a flanking marker run', () => {
        expect(spanStyleSource(COLOUR)('**hello world**', 8, 15)).toBeNull();
        expect(spanStyleSource(COLOUR)('**hello world**', 0, 7)).toBeNull();
    });

    it('styles a word on a line whose emphasis is elsewhere', () => {
        expect(apply('*emph* then plain words', spanStyleSource(COLOUR)('*emph* then plain words', 12, 17)!))
            .toBe('*emph* then [plain]{color=#cc0000} words');
        expect(apply('*one* and **two** and *three*', spanStyleSource(COLOUR)('*one* and **two** and *three*', 12, 15)!))
            .toBe('*one* and **[two]{color=#cc0000}** and *three*');
    });

    it('wraps the text of a run that is the only emphasis on its line', () => {
        const text = '**world**';
        const edit = spanStyleSource(COLOUR)(text, 2, 7)!;

        expect(apply(text, edit)).toBe('**[world]{color=#cc0000}**');
    });

    // The rewrite re-emits each span and each stretch between spans as its own
    // group, which is safe while the emphasis run around them stays outside the
    // brackets; a code span cannot hold a span at all.
    it('restyles spans inside a marker run, leaving the run outside the brackets', () => {
        expect(apply('**hello [world]{size=1.2em}**', spanStyleSource(COLOUR)('**hello [world]{size=1.2em}**', 0, 29)!))
            .toBe('**[hello ]{color=#cc0000}[world]{color=#cc0000 size=1.2em}**');
        expect(apply('**[x]{size=1em}**', spanStyleSource(COLOUR)('**[x]{size=1em}**', 3, 4)!))
            .toBe('**[x]{color=#cc0000 size=1em}**');
        expect(spanStyleSource(COLOUR)('`a [b]{size=1em}`', 0, 17)).toBeNull();
    });

    it('still styles a word on a line carrying no emphasis at all', () => {
        const text = 'plain words here';
        const edit = spanStyleSource(COLOUR)(text, 6, 11)!;

        expect(apply(text, edit)).toBe('plain [words]{color=#cc0000} here');
    });

    // A `*`/`+` list bullet, a `~` in a path and arithmetic `+` are not
    // emphasis to the viewer, so none of them stands in the way.
    it('styles a line carrying a marker character that is not emphasis', () => {
        expect(apply('* item here', spanStyleSource(COLOUR)('* item here', 2, 6)!)).toBe('* [item]{color=#cc0000} here');
        expect(apply('+ item here', spanStyleSource(COLOUR)('+ item here', 2, 6)!)).toBe('+ [item]{color=#cc0000} here');
        expect(apply('see ~/foo and hello', spanStyleSource(COLOUR)('see ~/foo and hello', 14, 19)!))
            .toBe('see ~/foo and [hello]{color=#cc0000}');
        expect(apply('1 + 1 is two', spanStyleSource(COLOUR)('1 + 1 is two', 9, 12)!)).toBe('1 + 1 is [two]{color=#cc0000}');

        const edit = spanStyleSource(COLOUR)('- item here', 2, 6)!;

        expect(apply('- item here', edit)).toBe('- [item]{color=#cc0000} here');
    });

    // The viewer reads a `[…]{…}` group carrying a newline as a span too, and
    // source mode now reads it through the same tokens, so it merges into it
    // (the rewritten group is written on one line, keeping the attribute the
    // dialect does not model) or splits it like any other.
    it('merges into a span whose group carries a newline', () => {
        const text = '[hello]{color=red\nfoo=bar}';

        expect(apply(text, spanStyleSource({ color: '#cc0000' })(text, 1, 6)!)).toBe('[hello]{color=#cc0000 foo=bar}');
    });

    it('splits a span whose text carries a newline', () => {
        const text = '[hel\nlo]{color=red}';

        expect(apply(text, spanStyleSource({ 'font-size': '1.2em' })(text, 1, 4)!))
            .toBe('[hel]{color=red size=1.2em}[\nlo]{color=red}');
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

describe('CLEAR_FORMAT_SOURCE and character references', () => {
    it('maps the selection through the backslash it adds, so it still covers the same text', () => {
        const text = 'a `&copy;` b';
        const edit = CLEAR_FORMAT_SOURCE(text, 3, 9)!;
        const result = apply(text, edit);

        expect(result).toBe('a \\&copy; b');
        expect(result.slice(edit.selection.from, edit.selection.to)).toBe('\\&copy;');
    });


    it('keeps the text of a code span that holds a reference as typed, by escaping its &', () => {
        const text = 'a `&copy;` b `&#35;` c';

        expect(apply(text, CLEAR_FORMAT_SOURCE(text, 4, 9)!)).toBe('a \\&copy; b `&#35;` c');
        expect(apply(text, CLEAR_FORMAT_SOURCE(text, 14, 18)!)).toBe('a `&copy;` b \\&#35; c');
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

    // Two items become two paragraphs, set apart by a blank line: written
    // on adjacent lines they would read as one paragraph.
    it('turns an unordered list back into paragraphs', () => {
        const text = '- a\n- b';
        const edit = listSource('unordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('a\n\nb');
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

    it('turns an ordered list back into paragraphs', () => {
        const text = '1. a\n2. b';
        const edit = listSource('ordered')(text, 0, text.length)!;

        expect(apply(text, edit)).toBe('a\n\nb');
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

    // A block tag name with nothing after it starts an HTML block as the last line of the text too.
    it('declines a block tag name that ends the text, as it does before a line end', () => {
        expectAllDecline('a\n\n<div', 5, 5);
        expectAllDecline('a\n\n<div\n', 5, 5);
        expectAllDecline('::: columns\na\n\n<div\n|||\nb\n:::', 17, 17);
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

    // `marked` drops a definition whose label an earlier one already defines,
    // so no token stands for it — yet it is still a definition, not text.
    it('declines a repeated link reference definition, which has no token of its own', () => {
        const text = '[r]: /a\n\n[r]: /b\n\n[s]:\n  /c\n[s]:\n  /d';

        expectAllDecline(text, text.indexOf('/b'), text.indexOf('/b'));
        expectAllDecline(text, text.indexOf('/d'), text.indexOf('/d'));
    });

    it('declines a repeated definition inside a `:::` column, which no column token stands for either', () => {
        const text = '::: {gap=1rem}\n[r]: /a\n[r]: /b "t"\n|||\n[r]: /c\n:::\n\npara';

        expectAllDecline(text, text.indexOf('/b'), text.indexOf('/b'));
        expectAllDecline(text, text.indexOf('/c'), text.indexOf('/c'));
        expect(runAll(text, text.length, text.length).heading).toBe(text.replace('para', '## para'));
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

    // The viewer reads `+ a` inside the quote as an unordered item, so the
    // toggle takes it off: its text, continued line included, becomes a
    // paragraph — and the continued line never turns into code.
    it('toggles off an item inside a quote without turning its continued line into code', () => {
        const text = '> + a\n>     [](/u)';
        const result = apply(text, listSource('unordered')(text, 3, 3)!);

        expect(result).toBe('a\n  [](/u)');
        expect(blockTypes(result)).toEqual(['paragraph']);
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

    it('makes the blocks of a selection items of one tight list, and keeps the blank line between headings', () => {
        const text = 'foo\n\nbar';

        expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('- foo\n- bar');
        expect(apply(text, listSource('ordered')(text, 0, text.length)!)).toBe('1. foo\n2. bar');
        expect(apply(text, blockPrefixSource('## ')(text, 0, text.length)!)).toBe('## foo\n\n## bar');
    });

    it('toggles a list off across the blank lines between its items', () => {
        const text = '- a\n\n- b';

        expect(apply(text, listSource('unordered')(text, 0, text.length)!)).toBe('a\n\nb');
    });
});

// The WYSIWYG editor holds no code block or table inside a list item. A
// fence lifts the item's text out to the top level, the list split around it;
// a table, which converts no block, declines inside an item's content.
describe('code fences and tables stay out of list items', () => {
    it('lifts a fenced block out of a list item\'s content', () => {
        expect(apply('- a\n\n  b', FENCED_CODE_SOURCE('- a\n\n  b', 7, 7)!)).toBe('- a\n\n```\nb\n```');
        expect(apply('- x\n  - a', FENCED_CODE_SOURCE('- x\n  - a', 8, 8)!)).toBe('- x\n```\na\n```');
    });

    it('declines a table on a list item\'s indented content', () => {
        expect(tableSource(2, 2)('- a\n\n  b', 7, 7)).toBeNull();
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

// Whole-stack review fixes (source-mode fuzz): the line commands find the
// blocks they convert from the viewer's tokens and check their result by
// lexing it. A block leaves its quotes and list items for the top level, the
// containers split around it, so what followed it inside them stays there.
describe('line commands act on the blocks the viewer reads', () => {
    const lineCommands = {
        paragraph: blockPrefixSource(''),
        heading:   blockPrefixSource('## '),
        quote:     blockPrefixSource('> '),
        bullets:   listSource('unordered'),
        numbers:   listSource('ordered'),
        code:      FENCED_CODE_SOURCE,
    };

    it('keeps a list item\'s other content in the item when its text is lifted out', () => {
        expect(apply('- a\n  - b\n- c', blockPrefixSource('## ')('- a\n  - b\n- c', 2, 2)!)).toBe('## a\n- - b\n- c');
        expect(apply('10. a\n\n    b', blockPrefixSource('## ')('10. a\n\n    b', 4, 4)!)).toBe('## a\n\n10. b');
        expect(apply('- a\n\n  b', blockPrefixSource('> ')('- a\n\n  b', 2, 2)!)).toBe('> a\n\n- b');
        expect(apply('- x\n  - a\n  - b', blockPrefixSource('## ')('- x\n  - a\n  - b', 8, 8)!)).toBe('- x\n## a\n- - b');
        expect(apply('10. a\n\n    b', FENCED_CODE_SOURCE('10. a\n\n    b', 4, 4)!)).toBe('```\na\n```\n\n10. b');
        expect(blockTypes('## a\n\n10. b')).toEqual(['heading', 'list']);
    });

    // The shapes with a tab that decline are on the line an item's marker stands on, where `marked` counts a tab as
    // three spaces: the item's content column cannot be read from `-\t`, and its text is not found past a tab.
    it('declines when a tab on an item\'s marker line stands where the command has to read', () => {
        expect(blockPrefixSource('## ')('-\tone\n\n\tsecond\n- two', 2, 2)).toBeNull();
        expect(listSource('unordered')('-\tone\n\n\tsecond\n- two', 2, 2)).toBeNull();

        // A tab in the item's text is content, and the command reads past it.
        expect(apply('- one\ttab\n- z', blockPrefixSource('## ')('- one\ttab\n- z', 2, 2)!)).toBe('## one\ttab\n- z');
        expect(apply('- one\ttab\n- z', listSource('ordered')('- one\ttab\n- z', 2, 2)!)).toBe('1. one\ttab\n- z');

        // An item of one line needs neither: the tab after its marker goes with the marker.
        expect(apply('-\tone\n- two', blockPrefixSource('## ')('-\tone\n- two', 2, 2)!)).toBe('## one\n- two');
    });

    // The tab after `>` is three columns wide here. Source mode acts on the list as it acts on its spaces form,
    // which writes the list's markers three columns in.
    it('S2. acts on an item of a list in a quote whose markers a tab after the quote marker indents, as on its spaces form', () => {
        const text = '>\t- a\n>\t- b';
        const spaced = '>   - a\n>   - b';

        expect(apply(text, blockPrefixSource('## ')(text, 4, 4)!)).toBe('## a\n>\t- b');
        expect(apply(spaced, blockPrefixSource('## ')(spaced, 4, 4)!)).toBe('## a\n>   - b');
        expect(apply(text, listSource('unordered')(text, 4, 4)!)).toBe('a\n>\t- b');
    });

    it('lifts a block out of a quote that a list item holds, and re-opens the item on the quote\'s next line', () => {
        const other = '- outer\n\n  > - one\n  >\n  >   held\n  >\n  > 1. other list\n- z';

        expect(apply(other, listSource('unordered')(other, other.indexOf('held'), other.indexOf('held'))!))
            .toBe('- outer\n\n  > - one\n  >\n- held\n- >\n  > 1. other list\n- z');

        const para = '- outer\n\n  > para\n  >\n  > - two\n- z';

        expect(apply(para, listSource('unordered')(para, para.indexOf('para'), para.indexOf('para'))!))
            .toBe('- outer\n\n- para\n- >\n  > - two\n- z');
    });

    it('re-opens the item around a quote on the next item of the quote\'s list', () => {
        const quoted = '- outer\n\n  > - one\n  >\n  >   held\n  > - two';
        const lifted = apply(quoted, listSource('ordered')(quoted, quoted.indexOf('held'), quoted.indexOf('held'))!);

        expect(lifted).toBe('- outer\n\n  > - one\n  >\n1. held\n- > - two');
    });

    // A list that gains an item below it no longer ends where it did. What its last line read as can change with
    // that, and then the new item is written as a list of its own, as it was before the items joined.
    it('writes a new item as a list of its own where joining the list above would change how that list reads', () => {
        const joins = '2) a\n\n       x\n- b';
        const trailing = '2) a\n\n       x \n- b';
        const open = '2) [x] a\n\n   ~~~js\n   > q \n- b\n\n  c';

        expect(apply(joins, listSource('ordered')(joins, joins.indexOf('b'), joins.indexOf('b'))!)).toBe('2) a\n\n       x\n3) b');
        expect(apply(trailing, listSource('ordered')(trailing, trailing.indexOf('b'), trailing.indexOf('b'))!)).toBe('2) a\n\n       x \n1. b');
        expect(apply(open, listSource('ordered')(open, open.indexOf('b'), open.indexOf('b'))!)).toBe('2) [x] a\n\n   ~~~js\n   > q \n1. b\n\n- c');
    });

    it('sets a converted paragraph apart rather than joining it to a neighbour', () => {
        expect(apply('# a\n[r]: /u\n\n[r]', blockPrefixSource('')('# a\n[r]: /u\n\n[r]', 2, 2)!)).toBe('a\n\n[r]: /u\n\n[r]');
        expect(apply('# a\n    b', blockPrefixSource('')('# a\n    b', 2, 2)!)).toBe('a\n\n    b');
        expect(apply('- a\n> b', blockPrefixSource('')('- a\n> b', 6, 6)!)).toBe('- a\n\nb');
        expect(apply('foo\n> b', blockPrefixSource('')('foo\n> b', 6, 6)!)).toBe('foo\n\nb');
    });

    it('escapes a character the conversion would leave opening another block', () => {
        const text = '###### ~~~ x';
        const result = apply(text, blockPrefixSource('> ')(text, 8, 8)!);

        expect(result).toBe('> \\~~~ x');
        expect(blockTypes(result)).toEqual(['blockquote']);
    });

    // A fence closed inside a nested quote ends the lines the quote takes: `b` is a paragraph after the quote.
    it('acts on the line after a fence closed inside a nested quote', () => {
        const text = '> > ```\n> > a\n> > ```\nb';
        const at = (command: (text: string, from: number, to: number) => MarkdownSourceEdit | null): string | null => {
            const edit = command(text, text.length, text.length);

            return edit === null ? null : apply(text, edit);
        };

        expect(blockTypes(text)).toEqual(['blockquote', 'paragraph']);
        expect(at(lineCommands.paragraph)).toBeNull();
        expect(at(lineCommands.heading)).toBe('> > ```\n> > a\n> > ```\n## b');
        expect(at(lineCommands.quote)).toBe('> > ```\n> > a\n> > ```\n> b');
        expect(at(lineCommands.bullets)).toBe('> > ```\n> > a\n> > ```\n- b');
        expect(at(lineCommands.numbers)).toBe('> > ```\n> > a\n> > ```\n1. b');
        expect(at(lineCommands.code)).toBe('> > ```\n> > a\n> > ```\n```\nb\n```');
        expect(at(tableSource(2, 2))).toBe('> > ```\n> > a\n> > ```\n\n|  |  |\n| --- | --- |\n|  |  |\n\nb');
    });

    it('declines a line of a table, whose cells hold text only', () => {
        const text = '| a |\n| - |\n| b |';

        for (const command of Object.values(lineCommands)) {
            expect(command(text, 14, 14)).toBeNull();
        }
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
        ['a reference link\'s label', '[docs][d] x\n\n[d]: /d', 7, 7],
        ['an autolink', '<https://a.test/x> y', 5, 5],
        ['a bare-URL autolink', 'see https://a.test/x y', 10, 10],
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
        ['in a quote, before a row\'s opening pipe', '> | a |\n> | --- |\n> | b |', 20, 20],
    ])('declines in a table %s', (_name, text, from, to) => {
        expect(imageSource('/i.png', 'i', {})(text, from, to)).toBeNull();
    });

    it.each([
        ['inside a cell', '| a |\n| --- |\n| b |', 17, 17, '| a |\n| --- |\n| b![i](/i.png) |'],
        ['inside an empty cell', '| a |\n| --- |\n|  |', 16, 16, '| a |\n| --- |\n| ![i](/i.png) |'],
        ['in a row with no outer pipes', 'a | b\n--- | ---\nc | d', 0, 0, '![i](/i.png)a | b\n--- | ---\nc | d'],
        ['in a quote, inside a cell', '> | a |\n> | --- |\n> | b |', 23, 23, '> | a |\n> | --- |\n> | b![i](/i.png) |'],
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
        ['on the opening line of a fence in a quote', '> ::: columns\n> a\n> :::', 5, 5],
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
        ['on a list item\'s fence line', '- a\n\n  ```\n  x\n  ```\n', 6, 6],
        ['on a quoted fence\'s closing line', '> ```\n> x\n> ```\n', 12, 12],
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

/** The `[from, to)` range of the first occurrence of `word` in `text`, at or after `after`. */
function rangeOf(text: string, word: string, after: number = 0): [number, number] {
    const at = text.indexOf(word, after);

    return [at, at + word.length];
}

/** Whether any token in `tokens` (searched depth-first) is a link. */
function holdsLink(tokens: Token[]): boolean {
    return tokens.some((token) => token.type === 'link' || holdsLink(('tokens' in token ? token.tokens : undefined) ?? []));
}

// Plan markdown-editor-marked-import, whole-stack review C1/C2/F13: source mode
// reads the document through the viewer's own `lexMarkdown` tokens, so it sees
// every form the viewer (and so the editor's importer) reads — not only the
// `*`-family emphasis and `[text](url)` links its old regular expressions knew.
describe('source mode reads `_` emphasis as the viewer does (C1)', () => {
    const COLOUR = { color: '#cc0000' };

    it('declines a span that would cut an underscore run in two', () => {
        const text = '_hello world_ again';
        const [from] = rangeOf(text, 'world');

        expect(spanStyleSource(COLOUR)(text, from, text.length)).toBeNull();
    });

    it('reports `__…__` as bold and `_…_` as italic', () => {
        expect(readSourceSelectionState('__hello__', 2, 7).bold).toBe(true);
        expect(readSourceSelectionState('_hello_', 1, 6).italic).toBe(true);
        expect(readSourceSelectionState('__hello__', 4, 4).bold).toBe(true);
    });

    it('toggles an underscore run off rather than nesting a star run inside it', () => {
        expect(apply('_hello_', ITALIC_SOURCE('_hello_', 1, 6)!)).toBe('hello');
        expect(apply('__hello__', BOLD_SOURCE('__hello__', 2, 7)!)).toBe('hello');
        expect(apply('a _hello_ b', ITALIC_SOURCE('a _hello_ b', 5, 5)!)).toBe('a hello b');
    });

    it('clears underscore emphasis', () => {
        expect(apply('__hello__', CLEAR_FORMAT_SOURCE('__hello__', 4, 4)!)).toBe('hello');
        expect(apply('a _b_ c', CLEAR_FORMAT_SOURCE('a _b_ c', 0, 7)!)).toBe('a b c');
    });

    it('expands a caret inside an underscore run to the word, not the closing underscore', () => {
        const text = '_hello world_';
        const [from] = rangeOf(text, 'world');
        const edit = BOLD_SOURCE(text, from + 1, from + 1)!;

        expect(apply(text, edit)).toBe('_hello **world**_');
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

    it('refuses a span inside a reference link', () => {
        for (const link of ['[docs]', '[docs][]', '[docs][d]']) {
            const text = `see ${link} here${DEFINED}`;

            expect(spanStyleSource(COLOUR)(text, 5, 9), link).toBeNull();
        }
    });

    it('removes a reference link, keeping its text', () => {
        for (const link of ['[docs]', '[docs][]', '[docs][d]']) {
            const text = `see ${link} here${DEFINED}`;

            expect(apply(text, REMOVE_LINK_SOURCE(text, 6, 6)!), link).toBe(`see docs here${DEFINED}`);
        }
    });

    it('re-points a reference link as an inline link, keeping its title', () => {
        const text = `see [docs] here${DEFINED}`;

        expect(apply(text, linkSource('/x')(text, 6, 6)!)).toBe(`see [docs](/x "T") here${DEFINED}`);
    });

    it('never nests a new link around an existing one', () => {
        const text = `see [docs] here${DEFINED}`;

        expect(linkSource('/x')(text, 0, 15)).toBeNull();
        expect(linkSource('/x')('a https://e.com b', 0, 17)).toBeNull();
    });

    it('reads bare, angle-bracket and email autolinks', () => {
        expect(readSourceSelectionState('see https://example.com/docs', 26, 26).linkUrl).toBe('https://example.com/docs');
        expect(readSourceSelectionState('see www.x.test', 6, 6).linkUrl).toBe('http://www.x.test');
        expect(readSourceSelectionState('mail me@example.com', 8, 8).linkUrl).toBe('mailto:me@example.com');
        expect(readSourceSelectionState('<https://a.b>', 3, 3).linkUrl).toBe('https://a.b');
    });

    it('refuses a span inside any autolink', () => {
        const bare = 'see https://example.com/docs';
        const email = 'mail me@example.com';

        expect(spanStyleSource(COLOUR)(bare, ...rangeOf(bare, 'docs'))).toBeNull();
        expect(spanStyleSource(COLOUR)(email, ...rangeOf(email, 'example'))).toBeNull();
        expect(spanStyleSource(COLOUR)('<m@x.y>', 3, 4)).toBeNull();
    });

    // Unwrapping alone would leave text GFM links again, so the trigger
    // character is escaped, as the serializer escapes it in plain text.
    it('removes an autolink so the text stays unlinked', () => {
        for (const [text, unlinked] of [
            ['see https://e.com/x here', 'see https\\://e.com/x here'],
            ['see <https://e.com> here', 'see https\\://e.com here'],
            ['see www.e.com here', 'see www\\.e.com here'],
            ['mail me@e.com now', 'mail me\\@e.com now'],
        ] as const) {
            const result = apply(text, REMOVE_LINK_SOURCE(text, 7, 7)!);

            expect(result, text).toBe(unlinked);
            expect(holdsLink(lexMarkdown(result)), text).toBe(false);
        }
    });

    it('reads a destination holding parentheses and link text holding brackets', () => {
        const parens = 'see [a](https://x.y/(b)) here';
        const brackets = 'see [a [b] c](/u) here';

        expect(readSourceSelectionState(parens, 5, 5).linkUrl).toBe('https://x.y/(b)');
        expect(spanStyleSource(COLOUR)(parens, 5, 6)).toBeNull();
        expect(readSourceSelectionState(brackets, 8, 8).linkUrl).toBe('/u');
        expect(apply(brackets, REMOVE_LINK_SOURCE(brackets, 8, 8)!)).toBe('see a [b] c here');
        expect(spanStyleSource(COLOUR)(brackets, 8, 9)).toBeNull();
    });
});

describe('source-mode inline toggles keep autolinks whole (F13)', () => {
    it('declines a marker inside an autolink', () => {
        expect(BOLD_SOURCE('<m@x.y>', 3, 4)).toBeNull();
        expect(BOLD_SOURCE('https://x.y/ab', 12, 14)).toBeNull();
        expect(ITALIC_SOURCE('www.x.test', 6, 10)).toBeNull();
        expect(INLINE_CODE_SOURCE('see https://x.y/ab', 16, 18)).toBeNull();
    });

    it('formats a whole autolink from outside it', () => {
        expect(apply('<m@x.y>', BOLD_SOURCE('<m@x.y>', 1, 6)!)).toBe('**<m@x.y>**');
        expect(apply('<m@x.y>', BOLD_SOURCE('<m@x.y>', 0, 7)!)).toBe('**<m@x.y>**');
    });

    it('re-points an autolink instead of nesting a link inside it', () => {
        const text = '<https://a.b>';

        expect(apply(text, linkSource('https://n')(text, 9, 12)!)).toBe('[https://a.b](https://n)');
    });
});

describe('source-mode styling refuses only what it would break (advisory)', () => {
    const COLOUR = { color: '#cc0000' };

    it('styles a word beside an existing span inside a bold run', () => {
        const text = '**hello [world]{size=1.2em} again**';
        const edit = spanStyleSource(COLOUR)(text, ...rangeOf(text, 'again'))!;

        expect(apply(text, edit)).toBe('**hello [world]{size=1.2em} [again]{color=#cc0000}**');
    });

    it('styles the text of a `*` or `+` list item', () => {
        expect(apply('* item here', spanStyleSource(COLOUR)('* item here', 2, 6)!)).toBe('* [item]{color=#cc0000} here');
        expect(apply('+ item here', spanStyleSource(COLOUR)('+ item here', 2, 6)!)).toBe('+ [item]{color=#cc0000} here');
    });

    // The form the serializer writes for colour on a whole bold run (S19).
    it('writes the span inside the emphasis around it, as the serializer does', () => {
        const text = 'a **hello** b';

        expect(apply(text, spanStyleSource(COLOUR)(text, 4, 9)!)).toBe('a **[hello]{color=#cc0000}** b');
        expect(apply(text, spanStyleSource(COLOUR)(text, 2, 11)!)).toBe('a **[hello]{color=#cc0000}** b');
    });

    it('formats a list item\'s text when its whole line is selected', () => {
        expect(apply('- item', BOLD_SOURCE('- item', 0, 6)!)).toBe('- **item**');
        expect(apply('## Title', ITALIC_SOURCE('## Title', 0, 8)!)).toBe('## *Title*');
    });

    it('declines inline formatting inside a code block, where markers are literal', () => {
        const text = '```\ncode\n```';

        expect(BOLD_SOURCE(text, 4, 8)).toBeNull();
        expect(spanStyleSource(COLOUR)(text, 4, 8)).toBeNull();
        expect(linkSource('/x')(text, 4, 8)).toBeNull();
    });
});

// The tokens of a quote, list item, table cell or `:::` column are lexed from
// text `marked` has stripped of its container's line prefixes; source mode
// finds them in the source across those prefixes.
describe('source mode finds inline text inside containers', () => {
    const cases: Array<[string, string, string]> = [
        ['> one two\n> three four', 'three', '> one two\n> **three** four'],
        ['> > deep text\n> > more', 'more', '> > deep text\n> > **more**'],
        ['- one\n  two three', 'three', '- one\n  two **three**'],
        ['1. a\n\n   b c\n2. d', 'c', '1. a\n\n   b **c**\n2. d'],
        ['| a \\| b | c |\n| --- | --- |\n| d | e |', 'b', '| a \\| **b** | c |\n| --- | --- |\n| d | e |'],
        ['| a | b |\n| --- | --- |\n| d | b |', 'b', '| a | **b** |\n| --- | --- |\n| d | b |'],
        ['::: {align=center}\nhello world\n:::', 'world', '::: {align=center}\nhello **world**\n:::'],
    ];

    for (const [text, word, bolded] of cases) {
        it(`bolds "${word}" in ${JSON.stringify(text)}`, () => {
            expect(apply(text, BOLD_SOURCE(text, ...rangeOf(text, word))!)).toBe(bolded);
        });
    }

    it('finds a body cell in its own row, not in the header holding the same text', () => {
        const text = '| a | b |\n| --- | --- |\n| d | b |';
        const [from, to] = rangeOf(text, 'b', text.lastIndexOf('\n'));

        expect(apply(text, BOLD_SOURCE(text, from, to)!)).toBe('| a | b |\n| --- | --- |\n| d | **b** |');
    });

    it('does not mistake code for the paragraph after it', () => {
        const text = '```\nhello\n```\n\nhello';
        const [from, to] = rangeOf(text, 'hello', 10);

        expect(apply(text, BOLD_SOURCE(text, from, to)!)).toBe('```\nhello\n```\n\n**hello**');
    });

    it('finds none in an HTML block, a block tag name that ends the text included', () => {
        expect(BOLD_SOURCE('<div>\nhi\n</div>', 6, 8)).toBeNull();
        expect(BOLD_SOURCE('a\n\n<div\n', 4, 7)).toBeNull();
        expect(BOLD_SOURCE('a\n\n<div', 4, 7)).toBeNull();
    });
});

describe('REMOVE_LINK_SOURCE — a link nested in a link (whole-stack review fix #16b)', () => {
    const cases: Array<[string, string, string]> = [
        ['the nested link opens the outer link\'s text', 'x [<https://a.test/in> b](/out) y', 'x https\\://a.test/in[ b](/out) y'],
        ['the nested link sits inside the outer link\'s text', 'x [c <https://a.test/in> b](/out) y', 'x [c ](/out)https\\://a.test/in[ b](/out) y'],
        ['the nested link ends the outer link\'s text', 'x [c <https://a.test/in>](/out) y', 'x [c ](/out)https\\://a.test/in y'],
        ['the outer link is a reference link', 'x [<https://a.test/in> b][r] y\n\n[r]: /out', 'x https\\://a.test/in[ b][r] y\n\n[r]: /out'],
    ];

    for (const [name, text, unlinked] of cases) {
        it(`${name}: its text is unlinked and the outer link's text keeps its target`, () => {
            const [from, to] = rangeOf(text, 'a.test');

            expect(apply(text, REMOVE_LINK_SOURCE(text, from, to)!)).toBe(unlinked);
        });
    }

    // A link written around a link is no link: only the inner one is. Taking the inner link's syntax away would
    // leave `[a b](/out)`, which reads as a link to `/out`, so the command declines.
    it.each([
        'x [[a](/in) b](/out) y',
        'x [c [a](/in) b](/out) y',
        'x [c [a](/in)](/out) y',
        'x [[a](/in) b][r] y\n\n[r]: /out',
    ])('declines on the inner link of %j, whose text would join a link around it', (text) => {
        const [from, to] = rangeOf(text, 'a');

        expect(REMOVE_LINK_SOURCE(text, from, to)).toBeNull();
    });
});

// A tab in a line's container prefix is the spaces to its tab stop in the lexer's reading, so the tokens of a
// quote's or item's content hold spaces where the source holds the tab. The commands and the toolbar state act on
// these documents as they act on their spaces forms.
describe('a tab in a container prefix', () => {
    const QUOTE = '>\tfoo bar\n>\tbaz';
    const CONTINUED = '> one\n> \ttwo';
    const ITEM = '- foo bar\n  \tbaz';
    const TABBED_ITEM = '- foo bar\n\tbaz';
    const TASK = '- [ ]\tAlpha beta';

    it.each<[string, string, number, number, string]>([
        ['TB1: the first line of a quote whose lines follow a marker and a tab', QUOTE, 2, 5, '>\t**foo** bar\n>\tbaz'],
        ['TB2: the second line of that quote', QUOTE, 12, 15, '>\tfoo bar\n>\t**baz**'],
        ['TB3: the first line of a quote continued after a space and a tab', CONTINUED, 2, 5, '> **one**\n> \ttwo'],
        ['TB4: the continued line of that quote', CONTINUED, 9, 12, '> one\n> \t**two**'],
        ['TB5: a line of an item indented by two spaces and a tab', ITEM, 13, 16, '- foo bar\n  \t**baz**'],
        ['TB6: a line of an item indented by a tab', TABBED_ITEM, 11, 14, '- foo bar\n\t**baz**'],
        // TB7 is a guard row: the text after a checkbox acted on before the source analysis read tabs by column.
        ['TB7: the text after a task item\'s checkbox and a tab', TASK, 12, 16, '- [ ]\tAlpha **beta**'],
        ['TB7b: a continued line of a task item written with a checkbox and a tab', '- [ ]\tAlpha beta\n\tgamma delta', 18, 23, '- [ ]\tAlpha beta\n\t**gamma** delta'],
    ])('%s: bold acts', (_title, text, from, to, expected) => {
        expect(apply(text, BOLD_SOURCE(text, from, to)!)).toBe(expected);
    });

    it('TB8: a link acts on text in a quote after a marker and a tab, and on a continued line', () => {
        expect(apply(QUOTE, linkSource('u')(QUOTE, 2, 5)!)).toBe('>\t[foo](u) bar\n>\tbaz');
        expect(apply(CONTINUED, linkSource('u')(CONTINUED, 9, 12)!)).toBe('> one\n> \t[two](u)');
    });

    it('TB9: the heading command acts on a quote whose lines follow a marker and a tab', () => {
        expect(apply(QUOTE, blockPrefixSource('## ')(QUOTE, 3, 3)!)).toBe('## foo bar\n## baz');
    });

    it('TB10: the toolbar state reads a bold run in a quote after a marker and a tab', () => {
        expect(readSourceSelectionState('>\t**foo** bar', 4, 7).bold).toBe(true);
        expect(readSourceSelectionState('> one\n> \t**two**', 11, 14).bold).toBe(true);
        expect(readSourceSelectionState('- [ ]\tAlpha **beta**', 14, 18).bold).toBe(true);
    });

    // Two tabs in one line's prefix, a tab after a lazy task line, and quotes nested in items: each acts as its spaces form
    // does, with the tabs left where they stand.
    it.each<[string, string, number, string, string, string | null]>([
        ['TB11: a list in a quote, a tab after each marker', '>\t-\tx y', 4, '>\t-\t**x** y', '>\t-\t[x](u) y', '## x y'],
        ['TB12: a quote in a quote, a tab after each marker', '>\t>\tx', 4, '>\t>\t**x**', '>\t>\t[x](u)', '## x'],
        ['TB13: a lazy line of a task item opened by a tab', '* [ ]\tc d\n   \t[ ] y z', 6, '* [ ]\t**c** d\n   \t[ ] y z', '* [ ]\t[c](u) d\n   \t[ ] y z', '## \\[ \\] c d\n## [ ] y z'],
        ['TB14: a quote in an item, tabs after the marker and in the next line', '1.\t> x\n\t  >\t---', 5, '1.\t> **x**\n\t  >\t---', '1.\t> [x](u)\n\t  >\t---', '## x'],
        ['TB15: a quote in an item, a tab after its marker', '-\t>\t# h\n\t>', 6, '-\t>\t# **h**\n\t>', '-\t>\t# [h](u)\n\t>', null],
        ['TB16: a quote in a quote in an item, a tab after the inner marker', '- > a\n  >\t> b', 4, '- > **a**\n  >\t> b', '- > [a](u)\n  >\t> b', '## a\n- >\t> b'],
        ['TB17: an item whose marker is followed by spaces and a tab, a line indented by a space and a tab', '-  \tx\n \t  w', 4, '-  \t**x**\n \t  w', '-  \t[x](u)\n \t  w', '## x\n## w'],
        ['TB18: a task item opened by a tab, an item indented by a tab after it', '   * [ ] a\tb\n\t- ```', 9, '   * [ ] **a**\tb\n\t- ```', '   * [ ] [a](u)\tb\n\t- ```', '## \\[ \\] a\tb\n## - ```'],
    ])('%s', (_title, text, at, bold, link, heading) => {
        const word = /[A-Za-z]/.exec(text.slice(at))![0].length;

        expect(apply(text, BOLD_SOURCE(text, at, at + word)!)).toBe(bold);
        expect(apply(text, linkSource('u')(text, at, at + word)!)).toBe(link);

        // The heading command lifts the block, and a tab on a line it keeps stays a decline of source mode.
        const edit = blockPrefixSource('## ')(text, at, at);

        expect(edit === null ? null : apply(text, edit)).toBe(heading);
    });

    // A tab after a quote marker inside a `:::` column is read like one outside it.
    it.each<[string, string, string, string, string | null]>([
        ['TB22: a quote in the only column of a fence', '::: {gap=2}\n>\tq r\n:::', 'q', '::: {gap=2}\n>\t**q** r\n:::', '::: {gap=2}\n## q r\n:::'],
        ['TB23: a quote in the second column of a fence', '::: {gap=2}\nx\n|||\n>\tq r\n:::', 'q', '::: {gap=2}\nx\n|||\n>\t**q** r\n:::', '::: {gap=2}\nx\n|||\n## q r\n:::'],
    ])('%s', (_title, text, word, bold, heading) => {
        const at = text.lastIndexOf(word === 'b' ? 'b c' : 'q r');

        expect(apply(text, BOLD_SOURCE(text, at, at + 1)!)).toBe(bold);
        expect(readSourceSelectionState(bold, bold.indexOf('**') + 2, bold.indexOf('**') + 3).bold).toBe(true);

        const edit = blockPrefixSource('## ')(text, at, at);

        expect(edit === null ? null : apply(text, edit)).toBe(heading);
    });
});
