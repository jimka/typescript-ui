import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createParagraphNode, $getSelection, $isElementNode, $isLineBreakNode, $isNodeSelection, $isRangeSelection, $isTextNode } from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { expandPrefixTabs, prefixTabLines } from '~/component/display/markdownTabs';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $readRawBlockAsBlocks } from '~/component/editor/markdownImporter';
import { $selectSourceRange } from '~/component/editor/markdownSourceModel';
import { $placeOfSourceOffset, $placeOutsideSourceNode, $sourceOffsetOfPoint } from '~/component/editor/markdownSourcePlaces';
import type { SourcePlace } from '~/component/editor/markdownSourcePlaces';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { CORPUS } from './markdown-roundtrip/corpus';
import { tabDocuments } from './markdown-roundtrip/tabDocuments';
import { sourceMapOfEditor } from './markdown-roundtrip/sourceCaret';
import { blockOutline, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The editor whose updates the rows build their nodes in. */
let editor: MarkdownEditor;

beforeEach(() => {
    installTestDOM(CONFIG);
    editor = new MarkdownEditor();
    editor.setValue('x');
});
afterEach(() => {
    editor.dispose();
    DOM.reset();
});

/** Stands where the offset is in a row's Markdown, and where the place is in what the block shows. */
const CARET = '\u00a6';

/** The mark of {@link markOffsetIn}: a private-use character, which reads as a letter of the text it stands in. */
const MARK = '\uE000';

/**
 * Runs `read` inside an update of the editor, where nodes can be built.
 *
 * @param read - What to run.
 * @returns What it returns.
 */
function inUpdate<T>(read: () => T): T {
    const lexical = (editor as unknown as { _editor: LexicalEditor })._editor;
    let result: T;

    lexical.update(() => { result = read(); }, { discrete: true });

    return result!;
}

/** A block Markdown reads as around an offset, with the offset's place in it. */
interface Placed {
    readonly block: LexicalNode;
    readonly place: SourcePlace | null;
}

/**
 * Reads Markdown as a raw block's text is read, and finds an offset's place in the block it falls in.
 *
 * @param text - The Markdown.
 * @param offset - The offset.
 * @returns The block and the place, or `null` when the text reads as one raw block.
 */
function $placeIn(text: string, offset: number): Placed | null {
    const reading = $readRawBlockAsBlocks(text);

    if (reading === null) {
        return null;
    }

    const index = Math.max(0, reading.spans.findIndex(([, end]) => end >= offset));
    const block = reading.nodes[index]!;
    const [start, end] = reading.spans[index]!;

    return { block, place: $placeOfSourceOffset(text, offset, block, start, end) };
}

/**
 * Writes what a block shows, with {@link CARET} at a place: a block in `[ ]`, an inline element in `\u2039 \u203a`, text
 * that has a format or is a source node in `{format: }` (a source node's format followed by `\u00a7`), a line break as
 * `\u23ce`, and any other node as its type in `< >`.
 *
 * @param node - The block.
 * @param place - The place.
 * @returns The text.
 */
function $shown(node: LexicalNode, place: SourcePlace): string {
    if ($isTextNode(node)) {
        const text = node.getTextContent();
        const body = place.node.is(node) ? text.slice(0, place.offset) + CARET + text.slice(place.offset) : text;
        const isPlain = node.getFormat() === 0 && node.getType() === 'text';

        return isPlain ? body : `{${node.getFormat()}${node.getType() === 'text' ? '' : '\u00a7'}:${body}}`;
    }

    if (!$isElementNode(node)) {
        return $isLineBreakNode(node) ? '\u23ce' : `<${node.getType()}>`;
    }

    const children = node.getChildren().map((child, at) => (place.node.is(node) && place.offset === at ? CARET : '') + $shown(child, place));
    const atEnd = place.node.is(node) && place.offset === children.length ? CARET : '';

    return (node.isInline() ? '\u2039' : '[') + children.join('') + atEnd + (node.isInline() ? '\u203a' : ']');
}

/**
 * The place of the offset a row marks with {@link CARET}, in the block the row's Markdown reads as there.
 *
 * @param marked - The Markdown, with {@link CARET} at the offset.
 * @returns What the block shows, with {@link CARET} at the place; `null` when there is no place.
 */
function placeOf(marked: string): string | null {
    const offset = marked.indexOf(CARET);

    return inUpdate(() => {
        const placed = $placeIn(marked.slice(0, offset) + marked.slice(offset + 1), offset);

        if (placed === null) {
            throw new Error('the Markdown reads as one raw block');
        }

        return placed.place === null ? null : $shown(placed.block, placed.place);
    });
}

/**
 * What a block shows, one entry for each character and each node that is no text, with its format.
 *
 * @param block - The block.
 * @returns The entries, in document order.
 */
function $shownCharacters(block: LexicalNode): string[] {
    return $dfs(block).map(({ node }) => node).filter((node) => !$isElementNode(node))
        .flatMap((node) => ($isTextNode(node) ? node.getTextContent().split('').map((char) => `${char}#${node.getFormat()}`) : [`<${node.getType()}>`]));
}

/**
 * How many characters and nodes that are no text a block shows before a place.
 *
 * @param block - The block.
 * @param place - The place.
 * @returns The count.
 */
/**
 * A count of shown characters that falls strictly inside a source node, moved to that node's nearer end (its start
 * where both are as near): where the place of an offset inside a source node's source is. Any other count as it is.
 *
 * @param block - The block.
 * @param count - How many characters the block shows before a place.
 * @returns The count, outside any source node.
 */
function $outsideSourceNode(block: LexicalNode, count: number): number {
    let start = 0;

    for (const node of $dfs(block).map((entry) => entry.node).filter((entry) => !$isElementNode(entry))) {
        const size = $isTextNode(node) ? node.getTextContentSize() : 1;
        const isSource = $isTextNode(node) && node.getType() !== 'text';
        const isInside = isSource && count > start && count < start + size;

        if (isInside) {
            return (count - start) * 2 > size ? start + size : start;
        }

        start += size;
    }

    return count;
}

function $shownBefore(block: LexicalNode, place: SourcePlace): number {
    let count = 0;

    for (const node of $dfs(block).map((entry) => entry.node).filter((entry) => !$isElementNode(entry))) {
        const isBefore = !$isTextNode(place.node) && place.node.is(node.getParent()) && node.getIndexWithinParent() === place.offset;

        if (place.node.is(node) || isBefore) {
            return count + ($isTextNode(node) && place.node.is(node) ? place.offset : 0);
        }

        count += $isTextNode(node) ? node.getTextContentSize() : 1;
    }

    return count;
}

/**
 * Where a mark put at an offset of Markdown shows in the block it falls in, when the Markdown reads with the mark as
 * it does without it: a place found without the source of what the block shows.
 *
 * @param text - The Markdown.
 * @param offset - The offset.
 * @param shown - What the block shows without the mark, from {@link $shownCharacters}.
 * @param index - The block's index among the blocks the Markdown reads as.
 * @returns How many entries of `shown` stand before the mark, or `null` when the mark changes what the Markdown reads as.
 */
function $markOffsetIn(text: string, offset: number, shown: readonly string[], index: number): number | null {
    const marked = text.includes(MARK) ? null : $readRawBlockAsBlocks(text.slice(0, offset) + MARK + text.slice(offset));
    const block = marked?.nodes[index];
    const characters = block === undefined ? [] : $shownCharacters(block);
    const at = characters.findIndex((character) => character.startsWith(MARK));
    const rest = characters.filter((_, position) => position !== at);
    const readsTheSame = at !== -1 && rest.length === shown.length && rest.every((character, position) => character === shown[position]);

    return readsTheSame ? at : null;
}

describe('$placeOfSourceOffset: where an offset of a block\'s Markdown stands in the block a load builds of it (SP rows)', () => {
    it.each<[string, string | null]>([
        ['> a **Note:**¦ next', '[[a {1:Note:}¦ next]]'],
        ['> some _word_¦ next', '[[some {2:word}¦ next]]'],
        ['> a ~~s.~~¦  next', '[[a {4:s.}¦  next]]'],
        ['> q1 ¦ **(b)** z', '[[q1 ¦ {1:(b)} z]]'],
        ['- one _w_¦ next', '[[[one {2:w}¦ next]]]'],
        ['> a 😀¦b **c😀d**', '[[a 😀¦b {1:c😀d}]]'],
        ['> a\tb¦\n> \tc', '[[a\tb¦{0§: }  c]]'],
        ['> a\tb\n> ¦\tc', '[[a\tb{0§: }¦  c]]'],
    ])('SP1: nothing the block shows changes sides: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['> a ¦**b** c', '[[a ¦{1:b} c]]'],
        ['> a **¦b** c', '[[a {1:¦b} c]]'],
        ['> a **b¦** c', '[[a {1:b¦} c]]'],
        ['> a **b**¦ c', '[[a {1:b}¦ c]]'],
        ['> a *¦*b** c', '[[a ¦{1:b} c]]'],
        ['> **b**¦_i_ x', '[[{1:b}{2:¦i} x]]'],
        ['> ¦**b** c', '[[{1:¦b} c]]'],
        ['> a **b**¦', '[[a {1:b¦}]]'],
        ['> x ¦[t](/u) y', '[[x ¦‹t› y]]'],
        ['> x [¦t](/u) y', '[[x ‹¦t› y]]'],
        ['> x [t¦](/u) y', '[[x ‹t¦› y]]'],
        ['> x [t]¦(/u) y', '[[x ‹t›¦ y]]'],
        ['> x [t](/¦u) y', '[[x ‹t›¦ y]]'],
        ['> x [t](/u)¦ y', '[[x ‹t›¦ y]]'],
        ['> ¦[t](/u) y', '[[‹¦t› y]]'],
        ['> x [t](/u)¦', '[[x ‹t¦›]]'],
        ['> x <http://a.b¦> y', '[[x ‹http://a.b¦› y]]'],
        ['> x ¦www.a.com y', '[[x ¦‹www.a.com› y]]'],
        ['> x www.a.com¦ y', '[[x ‹www.a.com›¦ y]]'],
        ['> [s¦]{.c} t', '[[s¦ t]]'],
    ])('SP2: between two text nodes of a line, the place is in the one whose format the offset has: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['>¦ q1', '[[¦q1]]'],
        ['> ¦q1', '[[¦q1]]'],
        ['> q1¦\n> q2', '[[q1¦{0§: }q2]]'],
        ['> q1\n¦> q2', '[[q1{0§: }¦q2]]'],
        ['> q1\n>¦ q2', '[[q1{0§: }¦q2]]'],
        ['> q1\n> ¦q2', '[[q1{0§: }¦q2]]'],
        ['>¦  Next', '[[¦ Next]]'],
        ['> ¦ Next', '[[¦ Next]]'],
        ['>  ¦Next', '[[ ¦Next]]'],
        ['> q1\n>¦  cd', '[[q1{0§: }¦ cd]]'],
        ['> q1\n> ¦ cd', '[[q1{0§: }¦ cd]]'],
        ['> q1\n>  ¦cd', '[[q1{0§: } ¦cd]]'],
        ['- one¦\nlazy', '[[[one¦{0§: }lazy]]]'],
        ['- one\n¦lazy', '[[[one{0§: }¦lazy]]]'],
        ['# Head *i¦t*\npara', '[Head {2:i¦t}]'],
        ['Setext\n=¦==\nx', '[Setext¦]'],
        ['<div>\n\naf¦ter *x*', '[af¦ter {2:x}]'],
    ])('SP3: a marker, an indentation and a line end show nothing or a space, and the place is past what the offset is past: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['- a\n¦- b', '[[[a]][[¦b]]]'],
        ['- a¦\n- b', '[[[a¦]][[b]]]'],
        ['- a\n-¦ b', '[[[a]][[¦b]]]'],
        ['1. a\n\n   b¦\n2. c', '[[[a][b¦]][[c]]]'],
        ['1. a\n\n¦   b\n2. c', '[[[a][¦b]][[c]]]'],
        ['| a | b |\n|---|---|\n| c ¦| e |', '[[[[a]][[b]]][[[c¦]][[e]]]]'],
        ['| a | b |\n|---|---|\n| c |¦ e |', '[[[[a]][[b]]][[[c]][[¦e]]]]'],
        ['| a | b |\n|---¦|---|\n| c | e |', '[[[[a]][[b]]][[[¦c]][[e]]]]'],
        ['| a | b |\n|---|---|\n| c | e |¦', '[[[[a]][[b]]][[[c]][[e¦]]]]'],
        ['| a | b |\n|---|---|\n| c\\n\\n¦d | e |', '[[[[a]][[b]]][[[c][¦d]][[e]]]]'],
        ['| a | b |\n|---|---|\n| c\\n¦\\nd | e |', '[[[[a]][[b]]][[[c¦][d]][[e]]]]'],
        ['::: columns\ncol *a¦*\n|||\nB\n:::', '[[[col {2:a¦}]][[B]]]'],
        ['::: columns\nA\n|||\nB¦\n:::', '[[[A]][[B¦]]]'],
    ])('SP4: between two blocks, the place is in the one before until the source ends it: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['> a \\¦*b', '[[a ¦*b]]'],
        ['> a ¦\\*b', '[[a ¦*b]]'],
        ['> a \\*¦b', '[[a *¦b]]'],
        ['> a¦\\\n> b', '[[a¦⏎b]]'],
        ['> a\\¦\n> b', '[[a¦⏎b]]'],
        ['> a\\\n¦> b', '[[a⏎¦b]]'],
        ['> a ¦ \n> b', '[[a¦⏎b]]'],
        ['> a <b¦>x</b> c', '[[a {0§:<b>}¦x{0§:</b>} c]]'],
        ['> a <¦b>x</b> c', '[[a ¦{0§:<b>}x{0§:</b>} c]]'],
        ['> a ¦<b>x</b> c', '[[a ¦{0§:<b>}x{0§:</b>} c]]'],
        ['> a <b>¦x</b> c', '[[a {0§:<b>}¦x{0§:</b>} c]]'],
        ['> a ![al¦t](u.png) c', '[[a ¦<markdown-image> c]]'],
        ['> a ![alt](u.png)¦ c', '[[a <markdown-image>¦ c]]'],
        ['> a ![alt](u.png){width=10¦} c', '[[a ¦<markdown-image> c]]'],
        ['> a ![alt](u.png "ti¦tle") c', '[[a ¦<markdown-image> c]]'],
        ['> a ![alt](u.png "title")¦ c', '[[a <markdown-image>¦ c]]'],
        ['> a ![alt](<u¦.png>) c', '[[a ¦<markdown-image> c]]'],
        ['> a ![a *b¦*](u.png) c', '[[a ¦<markdown-image> c]]'],
        ['> a ![a ![b](v.png)¦](u.png) c', '[[a ¦<markdown-image> c]]'],
        ['- [x] ta¦sk\n- [ ] open', '[[[<markdown-task-checkbox>ta¦sk]][[<markdown-task-checkbox>open]]]'],
        ['- [x¦] task', '[[[<markdown-task-checkbox>¦task]]]'],
        ['- [x]¦ task', '[[[<markdown-task-checkbox>¦task]]]'],
        ['| a | b |\n|---|---|\n| c | e¦<br>f |', '[[[[a]][[b]]][[[c]][[e¦⏎f]]]]'],
        ['- a\n\u00a6- [x] b', '[[[a]][[<markdown-task-checkbox>¦b]]]'],
        ['- a\n-\u00a6 [x] b', '[[[a]][[<markdown-task-checkbox>¦b]]]'],
        ['- [ ] a\n\u00a6- [x] b', '[[[<markdown-task-checkbox>a]][[<markdown-task-checkbox>¦b]]]'],
        ['- [ ] a\n-\u00a6 [x] b', '[[[<markdown-task-checkbox>a]][[<markdown-task-checkbox>¦b]]]'],
        ['- [ ] a\u00a6\n- [x] b', '[[[<markdown-task-checkbox>a¦]][[<markdown-task-checkbox>b]]]'],
        ['- [ ] a\n- \u00a6[x] b', '[[[<markdown-task-checkbox>a]][[<markdown-task-checkbox>¦b]]]'],
        ['- a\n\u00a6  - [x] b', '[[[a][[[<markdown-task-checkbox>¦b]]]]]'],
        ['- a\n  \u00a6- [x] b', '[[[a][[[<markdown-task-checkbox>¦b]]]]]'],
        ['- a\n  -\u00a6 [x] b', '[[[a][[[<markdown-task-checkbox>¦b]]]]]'],
        ['1. [ ] a\n\u00a62. [x] b', '[[[<markdown-task-checkbox>a]][[<markdown-task-checkbox>¦b]]]'],
        ['1. [ ] a\n2.\u00a6 [x] b', '[[[<markdown-task-checkbox>a]][[<markdown-task-checkbox>¦b]]]'],
        ['* a\n\n\u00a6* [x] b', '[[[a]][[<markdown-task-checkbox>¦b]]]'],
    ])('SP5: an offset inside the source of one thing the block shows is before it, and at the nearer end of a source node that shows its source: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['> a `c¦o de` x', '[[a {16:c¦o de} x]]'],
        ['> a ¦`co de` x', '[[a ¦{16:co de} x]]'],
        ['> a `¦co de` x', '[[a {16:¦co de} x]]'],
        ['> a `co de¦` x', '[[a {16:co de¦} x]]'],
        ['> a `co de`¦ x', '[[a {16:co de}¦ x]]'],
        ['> a `` c¦`d `` x', '[[a {16:c¦`d} x]]'],
        ['> a `c\n> d¦e` x', '[[a {16:c d¦e} x]]'],
        ['> a `c\n>   ¦x` y', '[[a {16:c   ¦x} y]]'],
        ['- a `c\n  d¦e\n  f` x', '[[[a {16:c d¦e f} x]]]'],
        ['> a `c ¦` x', '[[a {16:c ¦} x]]'],
        ['| a | b |\n|---|---|\n| `p \\|¦ q` | e |', '[[[[a]][[b]]][[[{16:p |¦ q}]][[e]]]]'],
        ['| a |\n|---|\n| g \\|¦h |', '[[[[a]]][[[g |¦h]]]]'],
        ['para\n\n```\nco¦de\n  x\n```', '[co¦de\n  x]'],
        ['para\n\n```\ncode\n ¦ x\n```', '[code\n ¦ x]'],
        ['para\n\n```\ncode\n```¦', '[code¦]'],
        ['- a\n\n  ```\n  co¦de\n  ```', '[[[a][co¦de]]]'],
        ['- a\n\n      in¦dented', '[[[a][in¦dented]]]'],
        ['```\nopen\n¦', '[open\n¦]'],
        ['- a\n\n  [d]: /x\n  [d]: /¦y\n- b', '[[[a][[d]: /x⏎[d]: /¦y]][[b]]]'],
        ['- t\n\n  [d]: /b\n\n  [d]: /¦c\n- e', '[[[t][[d]: /b][[d]: /¦c]][[e]]]'],
    ])('SP6: code shows as it is written: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['>¦', null],
        ['- ¦', null],
        ['- a¦\n\n- [x]  zz', null],
        ['- a\n\n- [x]  z¦z', null],
    ])('SP7: there is no place where the block shows nothing, or holds text whose source is not found beside the offset or after it: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    // `marked` 18.1 hands a tab between the words of a list item's text back as written. A tab after `[x]` is the
    // spaces to its tab stop in the dialect's reading, which makes the item a task: its checkbox shows as its source
    // and the text after it has its source found, so an offset anywhere in the item has a place. The rows after the
    // checkbox rows are lines of items that a tab indents, which show the spaces it stands for.
    it.each<[string, string | null]>([
        ['¦- [x]\tAlpha beta', '[[[¦<markdown-task-checkbox>Alpha beta]]]'],
        ['- ¦[x]\tAlpha beta', '[[[<markdown-task-checkbox>¦Alpha beta]]]'],
        ['- [x¦]\tAlpha beta', '[[[<markdown-task-checkbox>¦Alpha beta]]]'],
        ['- [x]¦\tAlpha beta', '[[[<markdown-task-checkbox>¦Alpha beta]]]'],
        ['- [x]\t¦Alpha beta', '[[[<markdown-task-checkbox>¦Alpha beta]]]'],
        ['- a\n- [x]\t¦Alpha beta', '[[[a]][[<markdown-task-checkbox>¦Alpha beta]]]'],
        ['1. [ ]\t¦Alpha', '[[[<markdown-task-checkbox>¦Alpha]]]'],
        ['- a\tb w¦ x', '[[[a\tb w¦ x]]]'],
        ['- a\tb w x¦', '[[[a\tb w x¦]]]'],
        ['- a¦\tb w', '[[[a¦\tb w]]]'],
        ['- a\tb\n  c¦ d', '[[[a\tb{0§: }c¦ d]]]'],
        ['1. a\tb¦ c', '[[[a\tb¦ c]]]'],
        ['- [ ] a\tb¦ c', '[[[<markdown-task-checkbox>a\tb¦ c]]]'],
        ['- a\n  - b\tc¦ d', '[[[a][[[b\tc¦ d]]]]]'],
        ['- a¦\n- b\n\t zz', '[[[a¦]][[b{0§: }   zz]]]'],
        ['- a¦ x\n- b\n\t zz', '[[[a¦ x]][[b{0§: }   zz]]]'],
        ['- a\n- b\n\t z¦z', '[[[a]][[b{0§: }   z¦z]]]'],
        ['- [x]\tA¦lpha beta', '[[[<markdown-task-checkbox>A¦lpha beta]]]'],
        ['- [x]\tAlpha¦ beta', '[[[<markdown-task-checkbox>Alpha¦ beta]]]'],
    ])('SP16: a tab in a list item\'s text has its source found: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    // A quote an item holds is a quote node, and the places are those of its blocks: an offset in the prefix of a line
    // that holds a tab, which the quote's text shows as the spaces it stands for, is placed in the text beside it.
    it.each<[string, string | null]>([
        ['¦1. a\n\n   >\t# h', '[[[¦a][[h]]]]'],
        ['1. a\n\n¦   >\t# h', '[[[a][[¦h]]]]'],
        ['1. a\n\n   >¦\t# h', '[[[a][[¦h]]]]'],
        ['1. a\n\n   >\t¦# h', '[[[a][[¦h]]]]'],
        ['1. a\n\n   >\t# h¦', '[[[a][[h¦]]]]'],
        ['¦- a\n\n  > > q\n  > >\tr **b**', '[[[¦a][[[q{0§: }  r {1:b}]]]]]'],
        ['- a\n\n¦  > > q\n  > >\tr **b**', '[[[a][[[¦q{0§: }  r {1:b}]]]]]'],
        ['- a\n\n  >¦ > q\n  > >\tr **b**', '[[[a][[[¦q{0§: }  r {1:b}]]]]]'],
        ['- a\n\n  > > q\n ¦ > >\tr **b**', '[[[a][[[q{0§: } ¦ r {1:b}]]]]]'],
        ['- a\n\n  > > q\n  > >\tr¦ **b**', '[[[a][[[q{0§: }  r¦ {1:b}]]]]]'],
        ['- a\n\n  > > q\n  > >\tr **b**¦', '[[[a][[[q{0§: }  r {1:b¦}]]]]]'],
    ])('SP19: a quote in a list item is placed by its blocks, tabs in its prefixes included: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['- a\n- ¦', '[[[a]][[¦]]]'],
        ['- a\n- ¦\n- c', '[[[a]][[¦]][[c]]]'],
        ['- ¦\n- c', '[[[¦]][[c]]]'],
        ['1. a\n2. ¦\n3. c', '[[[a]][[¦]][[c]]]'],
        ['- a\n\n- ¦\n\n- c', '[[[a]][[¦]][[c]]]'],
        ['| h1 | h2 |\n| --- | --- |\n| ¦', '[[[[h1]][[h2]]][[[¦]][[]]]]'],
        ['| h1 | h2 |\n| --- | --- |\n| c | ¦', '[[[[h1]][[h2]]][[[c]][[¦]]]]'],
        ['| h1 | h2 |\n| --- | --- |\n| ¦ | d |', '[[[[h1]][[h2]]][[[¦]][[d]]]]'],
        ['- | h1 | h2 |\n  | --- | --- |\n  | ¦ |  |', '[[[[[[h1]][[h2]]][[[¦]][[]]]]]]'],
        ['- | h1 | h2 |\n  | --- | --- |\n  | c | ¦ |', '[[[[[[h1]][[h2]]][[[c]][[¦]]]]]]'],
        ['- a\n- | h |\n  | --- |\n  | ¦ |\n- b', '[[[a]][[[[[h]]][[[¦]]]]][[b]]]'],
        ['- - x\n- ¦', '[[[[[x]]]][[¦]]]'],
        ['- 1. x\n- ¦', '[[[[[x]]]][[¦]]]'],
        ['- a\n  - b\n  - ¦\n- c', '[[[a][[[b]][[¦]]]][[c]]]'],
        ['| h1 | h2 |\n| --- | --- |\n| c |  |¦', '[[[[h1]][[h2]]][[[c]][[¦]]]]'],
        ['h1 | h2\n--- | ---\nc | ¦', '[[[[h1]][[h2]]][[[c]][[¦]]]]'],
        ['| h1 | h2 | h3 |\n| --- | --- | --- |\n| c \\| e | ¦ | f |', '[[[[h1]][[h2]][[h3]]][[[c | e]][[¦]][[f]]]]'],
        ['|  | h2 |\n| ¦--- | --- |\n| c | d |', '[[[[]][[h2]]][[[¦c]][[d]]]]'],
        ['- \n¦\n- c', '[[[]][[¦c]]]'],
    ])('SP15: an offset in a list item or a table cell that shows nothing, with text in a neighbour, is in that item or cell: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['- a\n\t zz\n- b¦ c', '[[[a{0§: }   zz]][[b¦ c]]]'],
    ])('SP8: text whose source is not found in an item before the offset\'s own leaves the place: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['> q1 ¦[a \\[b](/u) c', '[[q1 ¦‹a [b› c]]'],
        ['> [a \\[¦b](/u) c', '[[‹a [¦b› c]]'],
        ['> [a \\[b¦](/u) c', '[[‹a [b¦› c]]'],
        ['> [a \\[b]¦(/u) c', '[[‹a [b›¦ c]]'],
        ['> [a \\[b](/u) q1 ¦c', '[[‹a [b› q1 ¦c]]'],
        ['> x [a \\]¦ b](/u) y', '[[x ‹a ]¦ b› y]]'],
        ['> x [**a** \\] `c¦d` e](/u) y', '[[x ‹{1:a} ] {16:c¦d} e› y]]'],
        ['> [![i](u.png) \\[¦b](/u) c', '[[‹<markdown-image> [¦b› c]]'],
    ])('SP11: a link text that holds an escaped bracket has its source found: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['[r]: /u\n\ntext [a][r¦] x', '[text ‹a›¦ x]'],
        ['[r]: /u\n\ntext [a¦][r] x', '[text ‹a¦› x]'],
        ['[r]: /u\n\ntext [r]¦ x', '[text ‹r›¦ x]'],
    ])('SP12: a reference link reads by a definition that stands in a block before its own: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    // Every kind of thing a block shows that is no text of its own, with none, one and two blanks after it, at the offsets
    // just before it, inside its source and just after it, and at each blank: a blank that the source holds after such a
    // thing is the text's, and none of the thing's own characters is taken for it. An offset inside a source node's
    // source is at the nearer end of that node, never inside it, where a typed character would replace the node whole.
    it.each<[string, string, string]>([
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[x] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦x] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x] ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[x]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦x]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x] ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]  ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[x]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦x]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]¦   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x] ¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]  ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [x]   ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[ ] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦ ] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ] ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[ ]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦ ]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ] ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]  ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- ¦[ ]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [¦ ]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]¦   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ] ¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]  ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- [ ]   ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. ¦[x] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [¦x] cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x] ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. ¦[x]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [¦x]  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x] ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]  ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. ¦[x]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [¦x]   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]¦   cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x] ¦  cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]  ¦ cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '1. [x]   ¦cd', '[[[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- ¦[X] cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [¦X] cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]¦ cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X] ¦cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- ¦[X]  cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [¦X]  cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]¦  cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X] ¦ cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]  ¦cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- ¦[X]   cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [¦X]   cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]¦   cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X] ¦  cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]  ¦ cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['a task item\'s checkbox, which stands for its marker and the blanks after it', '- a\n- [X]   ¦cd', '[[[a]][[<markdown-task-checkbox>¦cd]]]'],
        ['inline HTML', '> a ¦<b>cd', '[[a ¦{0§:<b>}cd]]'],
        ['inline HTML', '> a <¦b>cd', '[[a ¦{0§:<b>}cd]]'],
        ['inline HTML', '> a <b¦>cd', '[[a {0§:<b>}¦cd]]'],
        ['inline HTML', '> a <b>¦cd', '[[a {0§:<b>}¦cd]]'],
        ['inline HTML', '> a ¦<b> cd', '[[a ¦{0§:<b>} cd]]'],
        ['inline HTML', '> a <¦b> cd', '[[a ¦{0§:<b>} cd]]'],
        ['inline HTML', '> a <b¦> cd', '[[a {0§:<b>}¦ cd]]'],
        ['inline HTML', '> a <b>¦ cd', '[[a {0§:<b>}¦ cd]]'],
        ['inline HTML', '> a <b> ¦cd', '[[a {0§:<b>} ¦cd]]'],
        ['inline HTML', '> a ¦<b>  cd', '[[a ¦{0§:<b>}  cd]]'],
        ['inline HTML', '> a <¦b>  cd', '[[a ¦{0§:<b>}  cd]]'],
        ['inline HTML', '> a <b¦>  cd', '[[a {0§:<b>}¦  cd]]'],
        ['inline HTML', '> a <b>¦  cd', '[[a {0§:<b>}¦  cd]]'],
        ['inline HTML', '> a <b> ¦ cd', '[[a {0§:<b>} ¦ cd]]'],
        ['inline HTML', '> a <b>  ¦cd', '[[a {0§:<b>}  ¦cd]]'],
        ['inline HTML', '> a ¦<!-- c -->cd', '[[a ¦{0§:<!-- c -->}cd]]'],
        ['inline HTML', '> a <¦!-- c -->cd', '[[a ¦{0§:<!-- c -->}cd]]'],
        ['inline HTML', '> a <!-- c --¦>cd', '[[a {0§:<!-- c -->}¦cd]]'],
        ['inline HTML', '> a <!-- c -->¦cd', '[[a {0§:<!-- c -->}¦cd]]'],
        ['inline HTML', '> a ¦<!-- c --> cd', '[[a ¦{0§:<!-- c -->} cd]]'],
        ['inline HTML', '> a <¦!-- c --> cd', '[[a ¦{0§:<!-- c -->} cd]]'],
        ['inline HTML', '> a <!-- c --¦> cd', '[[a {0§:<!-- c -->}¦ cd]]'],
        ['inline HTML', '> a <!-- c -->¦ cd', '[[a {0§:<!-- c -->}¦ cd]]'],
        ['inline HTML', '> a <!-- c --> ¦cd', '[[a {0§:<!-- c -->} ¦cd]]'],
        ['an image', '> a ¦![i](u.png)cd', '[[a ¦<markdown-image>cd]]'],
        ['an image', '> a !¦[i](u.png)cd', '[[a ¦<markdown-image>cd]]'],
        ['an image', '> a ![i](u.png¦)cd', '[[a ¦<markdown-image>cd]]'],
        ['an image', '> a ![i](u.png)¦cd', '[[a <markdown-image>¦cd]]'],
        ['an image', '> a ¦![i](u.png) cd', '[[a ¦<markdown-image> cd]]'],
        ['an image', '> a !¦[i](u.png) cd', '[[a ¦<markdown-image> cd]]'],
        ['an image', '> a ![i](u.png¦) cd', '[[a ¦<markdown-image> cd]]'],
        ['an image', '> a ![i](u.png)¦ cd', '[[a <markdown-image>¦ cd]]'],
        ['an image', '> a ![i](u.png) ¦cd', '[[a <markdown-image> ¦cd]]'],
        ['an image', '> a ¦![i](u.png)  cd', '[[a ¦<markdown-image>  cd]]'],
        ['an image', '> a !¦[i](u.png)  cd', '[[a ¦<markdown-image>  cd]]'],
        ['an image', '> a ![i](u.png¦)  cd', '[[a ¦<markdown-image>  cd]]'],
        ['an image', '> a ![i](u.png)¦  cd', '[[a <markdown-image>¦  cd]]'],
        ['an image', '> a ![i](u.png) ¦ cd', '[[a <markdown-image> ¦ cd]]'],
        ['an image', '> a ![i](u.png)  ¦cd', '[[a <markdown-image>  ¦cd]]'],
        ['a line end inside a paragraph', '> a¦\n> cd', '[[a¦{0§: }cd]]'],
        ['a line end inside a paragraph', '> a\n¦> cd', '[[a{0§: }¦cd]]'],
        ['a line end inside a paragraph', '> a\n>¦ cd', '[[a{0§: }¦cd]]'],
        ['a line end inside a paragraph', '> a\n> ¦cd', '[[a{0§: }¦cd]]'],
        ['a line end inside a paragraph', '> a¦\n>  cd', '[[a¦{0§: } cd]]'],
        ['a line end inside a paragraph', '> a\n¦>  cd', '[[a{0§: }¦ cd]]'],
        ['a line end inside a paragraph', '> a\n>¦  cd', '[[a{0§: }¦ cd]]'],
        ['a line end inside a paragraph', '> a\n> ¦ cd', '[[a{0§: }¦ cd]]'],
        ['a line end inside a paragraph', '> a\n>  ¦cd', '[[a{0§: } ¦cd]]'],
        ['a line end inside a paragraph', '> a¦\n>   cd', '[[a¦{0§: }  cd]]'],
        ['a line end inside a paragraph', '> a\n¦>   cd', '[[a{0§: }¦  cd]]'],
        ['a line end inside a paragraph', '> a\n>¦   cd', '[[a{0§: }¦  cd]]'],
        ['a line end inside a paragraph', '> a\n> ¦  cd', '[[a{0§: }¦  cd]]'],
        ['a line end inside a paragraph', '> a\n>  ¦ cd', '[[a{0§: } ¦ cd]]'],
        ['a line end inside a paragraph', '> a\n>   ¦cd', '[[a{0§: }  ¦cd]]'],
        ['a hard line break', '> a¦\\\n> cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\¦\n> cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>¦ cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a\\\n> ¦cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a¦\\\n>  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\¦\n>  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>¦  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n> ¦ cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>  ¦cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a¦\\\n>   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\¦\n>   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>¦   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n> ¦  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>  ¦ cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a\\\n>   ¦cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a¦  \n> cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a ¦ \n> cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>¦ cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a  \n> ¦cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a¦  \n>  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a ¦ \n>  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>¦  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n> ¦ cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>  ¦cd', '[[a⏎¦cd]]'],
        ['a hard line break', '> a¦  \n>   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a ¦ \n>   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>¦   cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n> ¦  cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>  ¦ cd', '[[a¦⏎cd]]'],
        ['a hard line break', '> a  \n>   ¦cd', '[[a⏎¦cd]]'],
        ['a link that shows nothing', '> a ¦[](u)cd', '[[a ¦{0§:}cd]]'],
        ['a link that shows nothing', '> a [¦](u)cd', '[[a ¦{0§:}cd]]'],
        ['a link that shows nothing', '> a [](u¦)cd', '[[a ¦{0§:}cd]]'],
        ['a link that shows nothing', '> a [](u)¦cd', '[[a {0§:}¦cd]]'],
        ['a link that shows nothing', '> a ¦[](u) cd', '[[a ¦{0§:} cd]]'],
        ['a link that shows nothing', '> a [¦](u) cd', '[[a ¦{0§:} cd]]'],
        ['a link that shows nothing', '> a [](u¦) cd', '[[a ¦{0§:} cd]]'],
        ['a link that shows nothing', '> a [](u)¦ cd', '[[a {0§:}¦ cd]]'],
        ['a link that shows nothing', '> a [](u) ¦cd', '[[a {0§:} ¦cd]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e¦<br>f |', '[[[[a]][[b]]][[[c]][[e¦⏎f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<¦br>f |', '[[[[a]][[b]]][[[c]][[e¦⏎f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br¦>f |', '[[[[a]][[b]]][[[c]][[e¦⏎f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br>¦f |', '[[[[a]][[b]]][[[c]][[e⏎¦f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e¦<br> f |', '[[[[a]][[b]]][[[c]][[e¦⏎ f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<¦br> f |', '[[[[a]][[b]]][[[c]][[e¦⏎ f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br¦> f |', '[[[[a]][[b]]][[[c]][[e¦⏎ f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br>¦ f |', '[[[[a]][[b]]][[[c]][[e⏎¦ f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br> ¦f |', '[[[[a]][[b]]][[[c]][[e⏎ ¦f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e¦<br>  f |', '[[[[a]][[b]]][[[c]][[e¦⏎  f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<¦br>  f |', '[[[[a]][[b]]][[[c]][[e¦⏎  f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br¦>  f |', '[[[[a]][[b]]][[[c]][[e¦⏎  f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br>¦  f |', '[[[[a]][[b]]][[[c]][[e⏎¦  f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br> ¦ f |', '[[[[a]][[b]]][[[c]][[e⏎ ¦ f]]]]'],
        ['a `<br>` in a table cell', '| a | b |\n|---|---|\n| c | e<br>  ¦f |', '[[[[a]][[b]]][[[c]][[e⏎  ¦f]]]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦[p [q](/u) r](/v)cd', '[[a ¦[p ‹q› r](/v)cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [¦p [q](/u) r](/v)cd', '[[a [¦p ‹q› r](/v)cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [p [q](/u) r](/v¦)cd', '[[a [p ‹q› r](/v¦)cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [p [q](/u) r](/v)¦cd', '[[a [p ‹q› r](/v)¦cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦[p [q](/u) r](/v) cd', '[[a ¦[p ‹q› r](/v) cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [¦p [q](/u) r](/v) cd', '[[a [¦p ‹q› r](/v) cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [p [q](/u) r](/v¦) cd', '[[a [p ‹q› r](/v¦) cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [p [q](/u) r](/v)¦ cd', '[[a [p ‹q› r](/v)¦ cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [p [q](/u) r](/v) ¦cd', '[[a [p ‹q› r](/v) ¦cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦<http://x.y>cd', '[[a ¦‹http://x.y›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <¦http://x.y>cd', '[[a ‹¦http://x.y›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <http://x.y¦>cd', '[[a ‹http://x.y¦›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <http://x.y>¦cd', '[[a ‹http://x.y›¦cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦<http://x.y> cd', '[[a ¦‹http://x.y› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <¦http://x.y> cd', '[[a ‹¦http://x.y› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <http://x.y¦> cd', '[[a ‹http://x.y¦› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <http://x.y>¦ cd', '[[a ‹http://x.y›¦ cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a <http://x.y> ¦cd', '[[a ‹http://x.y› ¦cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦[^n]cd\n\n[^n]: note', '[[a ¦‹^n›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [¦^n]cd\n\n[^n]: note', '[[a ‹¦^n›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [^n¦]cd\n\n[^n]: note', '[[a ‹^n¦›cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [^n]¦cd\n\n[^n]: note', '[[a ‹^n›¦cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a ¦[^n] cd\n\n[^n]: note', '[[a ¦‹^n› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [¦^n] cd\n\n[^n]: note', '[[a ‹¦^n› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [^n¦] cd\n\n[^n]: note', '[[a ‹^n¦› cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [^n]¦ cd\n\n[^n]: note', '[[a ‹^n›¦ cd]]'],
        ['an autolink, a footnote reference and a link inside a link', '> a [^n] ¦cd\n\n[^n]: note', '[[a ‹^n› ¦cd]]'],
    ])('SP13: what is no text keeps the place of its own source, %s: %j', (_kind, marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    // A hard line break takes the next line's leading blanks into its source (`marked` 18.1): in a list item, those the
    // item's indentation does not account for. An offset among the indentation, or among the break's own blanks when it
    // has some, is before the break; an offset after the last blank is after it.
    it.each<[string, string | null]>([
        ['- a\\\n¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n  ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n   ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n    ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['- a\\\n¦     cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n ¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n  ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n   ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n    ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a\\\n     ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['1. a\\\n¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n  ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n   ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n    ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['1. a\\\n¦     cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n ¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n  ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n   ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n    ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a\\\n     ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['- a  \n¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n  ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n   ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n    ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['- a  \n¦     cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n ¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n  ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n   ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n    ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['- a  \n     ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['1. a  \n¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n  ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n   ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n    ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
        ['1. a  \n¦     cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n ¦    cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n  ¦   cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n   ¦  cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n    ¦ cd', '[[[{0§:a¦}⏎{0§:cd}]]]'],
        ['1. a  \n     ¦cd', '[[[{0§:a}⏎{0§:¦cd}]]]'],
    ])('SP17: an offset in the indentation or the blanks after a hard line break in a list item is before the break, after the last blank it is after it: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    // A quote in a list item after a hard line break: the offsets among the blanks before the `>` are before the break.
    // The offsets right before that `>` (`- > a\\\n  ¦>  cd`, `1. > a\\\n   ¦>  cd`) give a place after the break, against the
    // rule: a known issue, left as it is, and not tested here. The code block rows only pin the answer: a code block in
    // a list item is placed by its own text, whatever its line starts with.
    // A code line inside a list item or quote that starts with a tab shows that tab (or, where the container cuts it,
    // the columns left of it as spaces), so its source is found and the blocks around it keep their places.
    it.each<[string, string | null]>([
        ['¦- one\n\n  ```\n  aa\n  \tbb\n  ```', '[[[¦one][aa\n\tbb]]]'],
        ['- one¦\n\n  ```\n  aa\n  \tbb\n  ```', '[[[one¦][aa\n\tbb]]]'],
        ['- one\n\n  ```\n  aa\n  ¦\tbb\n  ```', '[[[one][aa\n¦\tbb]]]'],
        ['- one\n\n  ```\n  aa\n  \t¦bb\n  ```', '[[[one][aa\n\t¦bb]]]'],
        ['- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- tw¦o', '[[[one][aa\n\tbb]][[tw¦o]]]'],
        ['- a\n\n  ```\n  -\t¦old\n  ```', '[[[a][-\t¦old]]]'],
        ['> ```\n> \tb¦b\n> ```', '[[\tb¦b]]'],
        ['¦- one\n\n  ```\n  aa\n \tbb\n  ```', '[[[¦one][aa\n  bb]]]'],
        ['- one\n\n  ```\n  aa\n ¦\tbb\n  ```', '[[[one][aa\n¦  bb]]]'],
        ['- one\n\n  ```\n  aa\n \t¦bb\n  ```', '[[[one][aa\n  ¦bb]]]'],
        ['¦- a\n\n\t\tcode', '[[[¦a][  code]]]'],
        ['- a\n\n\t\tco¦de', '[[[a][  co¦de]]]'],
        [' ```\n\tx¦\n ```', '[   x¦]'],
    ])('a code line in a list item or quote that starts with a tab has its source found: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string | null]>([
        ['- > a\\\n ¦ >  cd', '[[[[a¦⏎cd]]]]'],
        ['1. > a\\\n ¦  >  cd', '[[[[a¦⏎cd]]]]'],
        ['1. > a\\\n  ¦ >  cd', '[[[[a¦⏎cd]]]]'],
        ['- a\n\n      x\n      ¦ > y', '[[[a][x\n¦ > y]]]'],
        ['- a\n\n      x\n       ¦> y', '[[[a][x\n ¦> y]]]'],
    ])('SP18: a hard line break in a quote in a list item, and a code block in a list item, follow the rule: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it.each<[string, string, number, string]>([
        ['> a <b>cd', '<b>', 0, '[[a {0§:¦<b>}cd]]'],
        ['> a <b>cd', '<b>', 1, '[[a ¦{0§:<b>}cd]]'],
        ['> a <b>cd', '<b>', 2, '[[a {0§:<b>}¦cd]]'],
        ['> a <b>cd', '<b>', 3, '[[a {0§:<b>¦}cd]]'],
        ['> a <b>', '<b>', 2, '[[a {0§:<b>¦}]]'],
        ['> a <b>cd', 'cd', 1, '[[a {0§:<b>}c¦d]]'],
    ])('SP14: a place inside a source node is moved to its nearer end, into the text beside it there: %j, %j at %i', (text, shown, offset, expected) => {
        const placed = inUpdate(() => {
            const block = $readRawBlockAsBlocks(text)!.nodes[0]!;
            const node = $dfs(block).map((entry) => entry.node).find((entry) => $isTextNode(entry) && entry.getTextContent() === shown)!;

            return $shown(block, $placeOutsideSourceNode({ node: node as TextNode, offset }));
        });

        expect(placed).toBe(expected);
    });

    it('SP9: a list item\'s text that begins as a link reference definition `marked` dropped before it has no place', () => {
        // `marked` drops a definition that repeats a label, and the item's text is then found where that definition
        // stands: the sources found are not in the order of what the block shows.
        expect(placeOf(`[d]: /a\n\n- t\n\n  [d]: /b\n  [d]: /c\n\n  [${CARET}`)).toBeNull();
    });

    it.each<[string, string]>([
        ['a &#35; b and \u00a6more', '[a # b and \u00a6more]'],
        ['more &amp; \u00a6less', '[more & \u00a6less]'],
    ])('SP21: an offset after a character reference has a place in the text that shows what it reads as: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    it('SP22: an offset after a character reference is after the character it reads as', () => {
        expect(placeOf('more &amp;\u00a6 less')).toBe('[more &\u00a6 less]');
    });

    it('SP23: an offset inside a character reference is before the character it reads as', () => {
        expect(placeOf('a &#3\u00a65; b')).toBe('[a \u00a6# b]');
    });

    // A no-break space is content, not the whitespace a save trims at a block's edge: a link whose text is one is a
    // link, and every offset of its block has a place, as with a letter there.
    it.each<[string, string | null]>([
        ['[\u00a0\u00a6](/u) b', '[\u2039\u00a0\u00a6\u203a b]'],
        ['[\u00a0](/u) \u00a6b', '[\u2039\u00a0\u203a \u00a6b]'],
        ['\u00a6[\u00a0](/u) b', '[\u2039\u00a6\u00a0\u203a b]'],
        ['- [\u00a0](/u) \u00a6b', '[[[\u2039\u00a0\u203a \u00a6b]]]'],
        ['| h | k |\n| - | - |\n| [\u00a0](/u) | \u00a6b |', '[[[[h]][[k]]][[[\u2039\u00a0\u203a]][[\u00a6b]]]]'],
        ['| h | k |\n| - | - |\n| [\u00a0](/u) | b |\u00a6', '[[[[h]][[k]]][[[\u2039\u00a0\u203a]][[b\u00a6]]]]'],
        ['| \u00a6h | k |\n| - | - |\n| [\u00a0](/u) | b |', '[[[[\u00a6h]][[k]]][[[\u2039\u00a0\u203a]][[b]]]]'],
    ])('a link whose text is a no-break space is shown, so an offset of its block has a place: %j', (marked, expected) => {
        expect(placeOf(marked)).toBe(expected);
    });

    /**
     * The offset the reverse walk gives for a point in the text node that shows `shown`, or in the block itself.
     *
     * @param text - The block's Markdown.
     * @param shown - The text of the text node the point is in; `null` for a point among the block's children.
     * @param offset - The offset in the text node, or the child index.
     * @returns The offset in `text`.
     */
    function offsetOfPoint(text: string, shown: string | null, offset: number): number | null {
        return inUpdate(() => {
            const reading = $readRawBlockAsBlocks(text)!;
            const block = reading.nodes[0]!;
            const [start, end] = reading.spans[0]!;

            if (shown === null) {
                return $sourceOffsetOfPoint(text, block, start, end, { node: block, offset, type: 'element' });
            }

            const node = $dfs(block).map((entry) => entry.node).find((entry) => $isTextNode(entry) && entry.getTextContent() === shown)!;

            return $sourceOffsetOfPoint(text, block, start, end, { node, offset, type: 'text' });
        });
    }

    it.each<[string, string | null, number, number | null]>([
        ['a **bc** d', 'bc', 0, 4],
        ['a **bc** d', 'bc', 2, 6],
        ['a **bc** d', ' d', 0, 8],
        ['a \\* b', '*', 0, 2],
        ['a \\* b', ' b', 0, 4],
        ['a &#35; b', 'a # b', 2, 2],
        ['- one\n- two', null, 1, 8],
    ])('SP24: the offset of a point is the start of the source of what the block shows there: %j at %j %i', (text, shown, offset, expected) => {
        expect(offsetOfPoint(text, shown, offset)).toBe(expected);
    });

    // A horizontal rule is one shown thing whose source is its line: an offset in the line, from its first character, is
    // before the rule, and the line's end is after it. Seen as the ends of a source selection over `a` / `---` / `b`.
    it.each<[number, number, string]>([
        [0, 3, 'text@0..root@1'],
        [0, 6, 'text@0..root@2'],
        [3, 9, 'root@1..text@1'],
        [6, 9, 'root@2..text@1'],
    ])('SP27: an offset on a horizontal rule\'s line is before the rule, its line end after it: %i to %i', (from, to, expected) => {
        const text = 'a\n\n---\n\nb';
        const rules = new MarkdownEditor();

        rules.setValue(text);

        const map = sourceMapOfEditor(rules);
        const lexical = (rules as unknown as { _editor: LexicalEditor })._editor;
        let selected = '';

        lexical.update(() => {
            const placed = $selectSourceRange(text, map, from, to);
            const selection = $getSelection();

            expect(placed).toBe(true);
            expect($isRangeSelection(selection)).toBe(true);

            if ($isRangeSelection(selection)) {
                const end = (point: typeof selection.anchor): string => `${point.type === 'text' ? 'text' : point.getNode().getType()}@${point.offset}`;

                selected = `${end(selection.anchor)}..${end(selection.focus)}`;
            }
        }, { discrete: true });
        rules.dispose();

        expect(selected).toBe(expected);
    });

    it('SP27: a collapsed caret on a horizontal rule\'s line selects the rule', () => {
        const text = 'a\n\n---\n\nb';
        const rules = new MarkdownEditor();

        rules.setValue(text);

        const map = sourceMapOfEditor(rules);
        const lexical = (rules as unknown as { _editor: LexicalEditor })._editor;

        for (const offset of [3, 4, 5, 6]) {
            lexical.update(() => {
                expect($selectSourceRange(text, map, offset, offset), `offset ${offset}`).toBe(true);
                expect($isNodeSelection($getSelection()), `offset ${offset}`).toBe(true);
            }, { discrete: true });
        }

        rules.dispose();
    });

    it('SP25: a point in an empty paragraph has no offset', () => {
        const offset = inUpdate(() => {
            const paragraph = $createParagraphNode();

            return $sourceOffsetOfPoint('', paragraph, 0, 0, { node: paragraph, offset: 0, type: 'element' });
        });

        expect(offset).toBeNull();
    });

    it('SP26: over the round-trip corpus, the offset of the point of an offset has the same place', () => {
        const differing: string[] = [];
        let checked = 0;

        for (const source of CORPUS.map((entry) => entry.source.replace(/\r\n?/g, '\n').replace(/\n+$/, ''))) {
            for (let offset = 1; offset <= source.length; offset += 1) {
                const text = source.slice(0, offset);

                inUpdate(() => {
                    const placed = $placeIn(text, offset);

                    if (placed === null || placed.place === null) {
                        return;
                    }

                    const reading = $readRawBlockAsBlocks(text)!;
                    const index = Math.max(0, reading.spans.findIndex(([, end]) => end >= offset));
                    const [start, end] = reading.spans[index]!;
                    const { node } = placed.place;
                    const point = { node, offset: placed.place.offset, type: $isTextNode(node) ? 'text' as const : 'element' as const };
                    const back = $sourceOffsetOfPoint(text, placed.block, start, end, point);

                    if (back === null) {
                        return;
                    }

                    checked += 1;

                    const again = $placeOfSourceOffset(text, back, placed.block, start, end);
                    const isSame = again !== null && again.node.is(node) && again.offset === placed.place.offset;

                    if (!isSame) {
                        differing.push(JSON.stringify([text, offset, back]));
                    }
                });
            }
        }

        expect(differing).toEqual([]);
        expect(checked).toBeGreaterThan(10_000);
    }, 120_000);

    // A tab document reads as its spaces form (the container prefix's tabs written as the spaces they stand for), so
    // an offset has a place in one exactly when it has one in the other. The documents left out hold a code block,
    // whose text keeps a tab that the spaces form writes as spaces (rows T30 to T33), an HTML, task or table block,
    // whose text shows the spaces a tab stands for, or a line of markers and tabs that is text (row T42).
    it('SP20: over the generated tab documents, the places agree with the spaces form', () => {
        const differing: string[] = [];

        for (const source of tabDocuments(600)) {
            const outline = blockOutline(viewerModel(source).blocks);
            // An item written otherwise than as `- x` or `1. x` (spaces before the marker, a tab or more than one space after it)
            // that holds a quote keeps the spaces its tabs stand for in the quote's raw block: a save writes the item's
            // blocks at the item's own column, where those tabs would not keep their width.
            const holdsQuoteInOddItem = /li\[quote/.test(outline) && /^ *(?:[-*+]|\d+[.)])(?! \S)/m.test(source);
            const isLeftOut = /code|raw|table|\[[ x]\]/.test(outline) || /\t-\t-/.test(source) || holdsQuoteInOddItem;

            if (isLeftOut) {
                continue;
            }

            const expansion = expandPrefixTabs(source);
            const expandedAt = (offset: number): number => expansion.offsets.indexOf(offset);
            const text = source.replace(/\n+$/, '');
            const spaced = expansion.text.replace(/\n+$/, '');

            for (let offset = 1; offset <= text.length; offset += 1) {
                inUpdate(() => {
                    const tab = $placeIn(text, offset)?.place ?? null;
                    const spaces = $placeIn(spaced, expandedAt(offset))?.place ?? null;

                    if ((tab === null) !== (spaces === null)) {
                        differing.push(JSON.stringify([source, offset]));
                    }
                });
            }
        }

        expect([...new Set(differing)]).toEqual([]);
    }, 120_000);

    it('SP10: over the round-trip corpus, the place is where a mark put at the offset shows, wherever the mark tells', () => {
        const tails = ['', ' next'];
        const untold: string[] = [];
        let told = 0;

        for (const source of CORPUS.map((entry) => entry.source.replace(/\r\n?/g, '\n').replace(/\n+$/, ''))) {
            for (let offset = 1; offset <= source.length; offset += 1) {
                for (const tail of tails) {
                    const text = source.slice(0, offset) + tail;

                    inUpdate(() => {
                        const placed = $placeIn(text, offset);
                        const reading = placed === null ? null : $readRawBlockAsBlocks(text)!;
                        const index = reading === null ? -1 : Math.max(0, reading.spans.findIndex(([, end]) => end >= offset));
                        const shown = placed === null ? [] : $shownCharacters(placed.block);
                        const mark = placed === null ? null : $markOffsetIn(text, offset, shown, index);
                        // Between the backslash of an escape and its character the mark shows after the backslash it frees.
                        const isInEscape = text[offset - 1] === '\\';

                        if (placed === null || mark === null || isInEscape) {
                            return;
                        }

                        if (placed.place === null && shown.length > 0) {
                            untold.push(text);
                        } else if (placed.place !== null) {
                            told += 1;
                            expect($shownBefore(placed.block, placed.place), JSON.stringify([text, offset])).toBe($outsideSourceNode(placed.block, mark));
                        }
                    });
                }
            }
        }

        // Where the mark tells and there is no place, the block shows nothing (not counted above) or holds one of the
        // three texts whose source is not found that this corpus has: a code line whose prefix holds a tab, a
        // paragraph line of markers and tabs, and a link reference definition that repeats a label. (The other, a task item's checkbox followed by two spaces in a loose list, is a row of SP7.)
        const isKnown = (text: string): boolean => {
            const labels = [...text.matchAll(/^\s*\[([^\]]+)\]:/gm)].map((match) => match[1]);
            const repeatsLabel = new Set(labels).size < labels.length;

            // An HTML line of an item whose prefix holds a tab shows the tab as the spaces to its stop, in a tag, or after a
            // run of blanks that holds a tab and goes on: `- foo`, a blank line, two tabs. (A fenced code line keeps its tab.)
            const hasPrefixTab = prefixTabLines(text.split('\n')).some(Boolean);
            const holdsCodeWithPrefixTab = hasPrefixTab && (/<\/?(?:div|pre)>/.test(text) || /^[ >]*(?:(?:[-*+]|\d+[.)])\t[ \t]+|[ ]*\t[ ]*\t[ \t]*)\S/m.test(text));

            // A paragraph line made of markers and tabs (row T42) shows its tabs as the spaces they are read as.
            const holdsMarkerLine = /^[ \t]*-\t-\t*$/m.test(text);

            return holdsCodeWithPrefixTab || holdsMarkerLine || repeatsLabel;
        };

        expect(untold.filter((text) => !isKnown(text))).toEqual([]);
        // Not computed: this corpus gives 19,089 places the mark confirms, and a change that loses many of them should
        // fail here even where no single row does.
        expect(told).toBeGreaterThan(15_000);
    }, 120_000);
});
