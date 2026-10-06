import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $isElementNode, $parseSerializedNode, $setState,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, SerializedLexicalNode, TextFormatType, TextNode } from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode } from '@lexical/list';
import type { ListItemNode, ListNode } from '@lexical/list';
import { $createLinkNode } from '@lexical/link';
import { $createCodeNode } from '@lexical/code';
import {
    $createTableCellNode, $createTableNode, $createTableRowNode, TableCellHeaderStates,
} from '@lexical/table';
import type { TableCellNode, TableNode } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $serializeMarkdown } from '~/component/editor/markdownSerializer';
import {
    bareAutolinkState, fenceAttributesState, hardBreakMarkerState, imageAttributesState, listLooseState, listMarkerState,
    spanAttributesState,
} from '~/component/editor/markdownNodeState';
import { $createMarkdownRawBlockNode, $createMarkdownSourceTextNode } from '~/component/editor/markdownSourceNodes';
import { $createMarkdownBlockNode, $createMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $createMarkdownImageNode } from '~/component/editor/markdownImageNode';
import type { MarkdownSpanStyle } from '~/component/display/markdownAttributes';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';
import type { Block, LinkTarget, Mark, Run } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** The resolved span style `{color=red}` reads back as. */
const RED: MarkdownSpanStyle = { color: 'red', fontFamily: null, fontSize: null };

/** Reaches the private headless Lexical editor. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Replaces a fresh editor's document with the nodes `build` returns, and returns the editor.
 *
 * @param build - Creates the root's new children; runs inside the editor update.
 * @returns The editor holding exactly those children.
 */
function editorWith(build: () => LexicalNode[]): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue('');
    lexicalOf(editor).update(() => {
        const root = $getRoot();

        root.clear();
        root.append(...build());
    }, { discrete: true });

    return editor;
}

/**
 * Runs `$serializeMarkdown()` on the editor's state.
 *
 * @param editor - The editor to serialize.
 * @returns The serialized Markdown.
 */
function serialized(editor: MarkdownEditor): string {
    return lexicalOf(editor).read(() => $serializeMarkdown());
}

/**
 * Serializes the document `build` creates.
 *
 * @param build - Creates the root's children.
 * @returns The serialized Markdown.
 */
function serialize(build: () => LexicalNode[]): string {
    return serialized(editorWith(build));
}

/**
 * A text node with the given Lexical formats and optional CSS style.
 *
 * @param content - The node's text.
 * @param formats - The text formats to toggle on.
 * @param style - The node's inline CSS, e.g. `color: red`.
 * @returns The text node.
 */
function text(content: string, formats: TextFormatType[] = [], style?: string): TextNode {
    const node = $createTextNode(content);

    for (const format of formats) {
        node.toggleFormat(format);
    }

    if (style !== undefined) {
        node.setStyle(style);
    }

    return node;
}

/**
 * Appends `children` to `element`, turning each string into a plain text node.
 *
 * @param element - The element to fill.
 * @param children - Its children; a string is a plain text node.
 * @returns `element`.
 */
function fill<T extends ElementNode>(element: T, children: Array<LexicalNode | string>): T {
    element.append(...children.map((child) => (typeof child === 'string' ? $createTextNode(child) : child)));

    return element;
}

/** A paragraph of the given children. */
function p(...children: Array<LexicalNode | string>): ElementNode {
    return fill($createParagraphNode(), children);
}

/**
 * A `LineBreakNode`, with the given hard-break marker when one is passed.
 *
 * @param marker - The authored marker (`\` or two or more spaces); omitted for no state.
 * @returns The line break.
 */
function br(marker?: string): LexicalNode {
    const node = $createLineBreakNode();

    if (marker !== undefined) {
        $setState(node, hardBreakMarkerState, marker);
    }

    return node;
}

/**
 * A list of items; an array item is a nested list of the same type (`start` 1).
 *
 * @param type - The list type.
 * @param start - The first item's number.
 * @param items - Each item's text, or a nested list's items.
 * @returns The list node.
 */
function list(type: 'bullet' | 'number', start: number, items: Array<string | ListNode>): ListNode {
    const node = $createListNode(type, start);

    for (const item of items) {
        node.append(fill($createListItemNode(), [item]));
    }

    return node;
}

/**
 * A table cell holding one paragraph per entry of `paragraphs`.
 *
 * @param header - Whether the cell is a header cell.
 * @param paragraphs - The cell's paragraph texts.
 * @returns The cell.
 */
function cell(header: boolean, ...paragraphs: string[]): TableCellNode {
    const node = $createTableCellNode(header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);

    node.append(...paragraphs.map((paragraph) => p(paragraph)));

    return node;
}

/**
 * A table of the given rows; the first row is the header.
 *
 * @param rows - Each row's cells.
 * @returns The table node.
 */
function table(...rows: TableCellNode[][]): TableNode {
    const node = $createTableNode();

    for (const cells of rows) {
        node.append(fill($createTableRowNode(), cells));
    }

    return node;
}

/**
 * A text run of the viewer projection.
 *
 * @param content - The run's text.
 * @param marks - The run's marks.
 * @param link - The run's link target.
 * @param style - The run's span style.
 * @returns The run.
 */
function run(content: string, marks: Mark[] = [], link: LinkTarget | null = null, style: MarkdownSpanStyle | null = null): Run {
    return { kind: 'text', text: content, marks, link, style };
}

/** The viewer's paragraph block of the given runs. */
function para(...runs: Run[]): Block {
    return { kind: 'paragraph', runs };
}

const BREAK: Run = { kind: 'break' };

/**
 * Rebuilds a node from its JSON, children included, as a paste of copied
 * nodes or content restored from JSON does. Must run inside an update.
 *
 * @param node - The node.
 * @returns The node built from its JSON.
 */
function jsonRoundTrip(node: LexicalNode): LexicalNode {
    const exportTree = (current: LexicalNode): SerializedLexicalNode => {
        const json = current.exportJSON();

        return $isElementNode(current) ? { ...json, children: current.getChildren().map(exportTree) } as SerializedLexicalNode : json;
    };

    return $parseSerializedNode(exportTree(node));
}

describe('$serializeMarkdown — blocks', () => {
    it('S1: a paragraph writes its text', () => {
        expect(serialize(() => [p('A plain paragraph.')])).toBe('A plain paragraph.');
    });

    it('S2: blocks are joined by one blank line', () => {
        expect(serialize(() => [fill($createHeadingNode('h2'), ['Title']), p('x')])).toBe('## Title\n\nx');
    });

    it('S3: an empty heading writes its marker alone', () => {
        expect(serialize(() => [$createHeadingNode('h1')])).toBe('#');
    });

    it('S4: a trailing # run in heading text is escaped so it is not a closing sequence', () => {
        const output = serialize(() => [fill($createHeadingNode('h1'), ['foo #'])]);

        expect(output).toBe('# foo \\#');
        expect(viewerModel(output).blocks).toEqual([{ kind: 'heading', depth: 1, runs: [run('foo #')] }]);
    });

    it('S5: a quote prefixes every line, including the line after a hard break', () => {
        expect(serialize(() => [fill($createQuoteNode(), ['a', br(), 'b'])])).toBe('> a\\\n> b');
    });

    it('S6: a code block writes a fence with its language', () => {
        expect(serialize(() => [fill($createCodeNode('js'), ['x = 1'])])).toBe('```js\nx = 1\n```');
    });

    it('S7: the fence grows past a backtick run that starts a code line', () => {
        expect(serialize(() => [fill($createCodeNode(), ['```', $createLineBreakNode(), 'in'])])).toBe('````\n```\nin\n````');
    });

    it('S8: a bullet list writes one "- " item per line', () => {
        expect(serialize(() => [list('bullet', 1, ['one', 'two'])])).toBe('- one\n- two');
    });

    it('S9: a number list counts from its start', () => {
        expect(serialize(() => [list('number', 3, ['a', 'b'])])).toBe('3. a\n4. b');
    });

    it('S10: a nested list is indented by the marker width plus one', () => {
        const output = serialize(() => [list('bullet', 1, ['a', list('bullet', 1, ['nested']), 'c'])]);

        expect(output).toBe('- a\n  - nested\n- c');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'list', ordered: false, loose: false, items: [
                [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[para(run('nested'))]] }],
                [para(run('c'))],
            ],
        }]);
    });

    it('S11: a nested number list under "9." is indented three spaces', () => {
        const output = serialize(() => [list('number', 9, ['a', list('number', 1, ['b'])])]);

        expect(output).toBe('9. a\n   1. b');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'list', ordered: true, loose: false, items: [
                [para(run('a')), { kind: 'list', ordered: true, loose: false, items: [[para(run('b'))]] }],
            ],
        }]);
    });

    it('S11 (wider marker): a nested list under "10." is indented four spaces', () => {
        expect(serialize(() => [list('number', 10, ['a', list('bullet', 1, ['b'])])])).toBe('10. a\n    - b');
    });

    it('S11 (first item): a first item holding only a nested list writes the nested list on its marker\'s line', () => {
        // CommonMark example 298's own form for an item holding only a nested list.
        const output = serialize(() => [list('bullet', 1, [list('bullet', 1, ['n'])])]);

        expect(output).toBe('- - n');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'list', ordered: false, loose: false, items: [
                [{ kind: 'list', ordered: false, loose: false, items: [[para(run('n'))]] }],
            ],
        }]);
    });

    it('S26: a table writes its header, delimiter row with alignment and width, and body', () => {
        expect(serialize(() => {
            const header = [cell(true, 'a'), cell(true, 'b')];
            const node = table(header, [cell(false, '1'), cell(false, '2')]);

            header[0]!.setFormat('left');
            header[1]!.setFormat('right');
            node.setColWidths([240, 0]);

            return [node];
        })).toBe('| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |');
    });

    it('S27: a cell spanning two columns writes a << continuation', () => {
        expect(serialize(() => {
            const merged = cell(false, 'd');

            merged.setColSpan(2);

            return [table([cell(true, 'a'), cell(true, 'b')], [merged])];
        })).toBe('| a | b |\n| --- | --- |\n| d | << |');
    });

    it('S28: a cell\'s paragraphs are joined by the viewer\'s cell paragraph break, with the pipe escaped', () => {
        const output = serialize(() => [table([cell(true, 'h')], [cell(false, 'x | y', 'z')])]);

        expect(output).toBe('| h |\n| --- |\n| x \\| y\\n\\nz |');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'table', widths: [null], header: [{ align: null, colSpan: 1, rowSpan: 1, runs: [run('h')] }],
            rows: [[{ align: null, colSpan: 1, rowSpan: 1, runs: [run('x | y'), BREAK, run('z')] }]],
        }]);
    });

    it('S29: a cell whose whole text is << is escaped', () => {
        expect(serialize(() => [table([cell(true, 'h')], [cell(false, '<<')])])).toBe('| h |\n| --- |\n| \\<< |');
    });

    it('S30: an aligned one-column fence', () => {
        expect(serialize(() => {
            const block = $createMarkdownBlockNode();

            block.setAlign('center');
            block.append(fill($createMarkdownColumnNode(), [p('text')]));

            return [block];
        })).toBe('::: {align=center}\ntext\n:::');
    });

    it('S31: a two-column fence', () => {
        expect(serialize(() => [fill($createMarkdownBlockNode(), [
            fill($createMarkdownColumnNode(), [p('A')]),
            fill($createMarkdownColumnNode(), [p('B')]),
        ])])).toBe('::: columns\nA\n|||\nB\n:::');
    });

    it('S32: a one-column fence with no attributes writes "::: {}"', () => {
        const output = serialize(() => [fill($createMarkdownBlockNode(), [fill($createMarkdownColumnNode(), [p('A')])])]);

        expect(output).toBe('::: {}\nA\n:::');
        expect(viewerModel(output).blocks).toEqual([
            { kind: 'fence', textAlign: null, columnGap: null, columns: [[para(run('A'))]] },
        ]);
    });

    it('S33: empty paragraphs are dropped, and an empty document is ""', () => {
        expect(serialize(() => [p(), p('x'), p()])).toBe('x');
        expect(serialize(() => [])).toBe('');
    });
});

describe('$serializeMarkdown — inline', () => {
    it('S12: bold, italic and code', () => {
        expect(serialize(() => [p(
            'Text with ', text('bold', ['bold']), ', ', text('it', ['italic']), ' and ', text('code', ['code']), '.',
        )])).toBe('Text with **bold**, *it* and `code`.');
    });

    it('S13: bold italic', () => {
        expect(serialize(() => [p(text('both', ['bold', 'italic']))])).toBe('***both***');
    });

    it('S14: emphasis stays open across a link every segment of which carries it', () => {
        const output = serialize(() => [p(text('foo ', ['italic']), fill($createLinkNode('/url'), [text('bar', ['italic'])]))]);

        expect(output).toBe('*foo [bar](/url)*');
        expect(viewerModel(output).blocks).toEqual([
            para(run('foo ', ['italic']), run('bar', ['italic'], { href: '/url', title: null })),
        ]);
    });

    it('S15: whitespace at the edge of a marked run is written outside it', () => {
        expect(serialize(() => [p(text('bold ', ['bold']), 'next')])).toBe('**bold** next');
    });

    it('S16: an inner mark opens and closes inside an outer one', () => {
        expect(serialize(() => [p(text('a', ['bold']), text('b', ['bold', 'italic']), text('c', ['bold']))])).toBe('**a*b*c**');
    });

    it('S17: a code span sits inside the other marks', () => {
        expect(serialize(() => [p(text('x', ['bold', 'code']))])).toBe('**`x`**');
    });

    it('S18: a styled span holds the bold run inside it', () => {
        expect(serialize(() => [p(text('red ', [], 'color: red'), text('b', ['bold'], 'color: red'))]))
            .toBe('[red **b**]{color=red}');
    });

    it('S19: bold around a whole styled span is written outside it', () => {
        const output = serialize(() => [p(text('s', ['bold'], 'color: red'))]);

        expect(output).toBe('**[s]{color=red}**');
        expect(viewerModel(output).blocks).toEqual([para(run('s', ['bold'], null, RED))]);
    });

    it('S20: the brackets of styled text are written outside the span and lose its style', () => {
        const output = serialize(() => [p(text('a [x] b', [], 'color: red'))]);

        expect(output).toBe('[a ]{color=red}\\[[x]{color=red}\\][ b]{color=red}');
        expect(viewerModel(output).blocks).toEqual([
            para(run('a ', [], null, RED), run('['), run('x', [], null, RED), run(']'), run(' b', [], null, RED)),
        ]);
    });

    it('S21: a link whose text is its URL is an autolink', () => {
        expect(serialize(() => [p(fill($createLinkNode('https://e.com'), ['https://e.com']))])).toBe('<https://e.com>');
    });

    it('S22: a destination with a space is written in angle brackets', () => {
        expect(serialize(() => [p(fill($createLinkNode('/my uri'), ['t']))])).toBe('[t](</my uri>)');
    });

    it('S23: a title is quoted with its quotes escaped', () => {
        expect(serialize(() => [p(fill($createLinkNode('/u', { title: 'a "q"' }), ['t']))])).toBe('[t](/u "a \\"q\\"")');
    });

    it('S24: a code span is fenced with the shortest backtick run its content does not hold', () => {
        expect(serialize(() => [p(text('a``b', ['code']))])).toBe('`a``b`');
    });

    it('S25: a + inside underlined text is written outside the underline', () => {
        const output = serialize(() => [p(text('a', ['underline']), text('+', ['underline']), text('b', ['underline']))]);

        expect(output).toBe('++a++\\+++b++');
        expect(viewerModel(output).blocks).toEqual([para(run('a', ['underline']), run('+'), run('b', ['underline']))]);
    });
});

describe('$serializeMarkdown — hard breaks', () => {
    it('B1: a break with no marker writes a backslash hard break', () => {
        const output = serialize(() => [p('a', br(), 'b')]);

        expect(output).toBe('a\\\nb');
        expect(viewerModel(output).blocks).toEqual([para(run('a'), BREAK, run('b'))]);
    });

    it('B2: a break keeps its authored space marker', () => {
        const output = serialize(() => [p('a', br('   '), 'b')]);

        expect(output).toBe('a   \nb');
        expect(viewerModel(output).blocks).toEqual([para(run('a'), BREAK, run('b'))]);
    });

    it('B3: a break at the end of a block writes nothing; one at its start writes a hard break', () => {
        expect(serialize(() => [p('a', br())])).toBe('a');
        expect(serialize(() => [p(br(), 'a')])).toBe('\\\na');
    });

    it('B4: a break in a level 3-6 heading writes a space (an ATX heading cannot span lines)', () => {
        expect(serialize(() => [fill($createHeadingNode('h3'), ['a', br(), 'b'])])).toBe('### a b');
    });

    it('B4 (setext): a level 1 or 2 heading holding a break is written setext, keeping the break and its marker', () => {
        // Plan markdown-editor-marked-import, audit fix: the importer reads `Foo  \nbar\n===` as a heading with a
        // break, which the ATX form would flatten to a space on an unedited save.
        for (const [tag, underline] of [['h1', '==='], ['h2', '---']] as const) {
            const output = serialize(() => [fill($createHeadingNode(tag), ['Foo', br('  '), 'bar'])]);

            expect(output).toBe(`Foo  \nbar\n${underline}`);
            expect(viewerModel(output).blocks).toEqual([
                { kind: 'heading', depth: tag === 'h1' ? 1 : 2, runs: [run('Foo'), BREAK, run('bar')] },
            ]);
        }
    });

    it('B4 (setext): a line marked would read as a code fence or an HTML block start falls back to an ATX heading', () => {
        // A setext heading's lines may not start with a run of three backticks or tildes, nor be a lone tag: marked
        // then reads no heading. A code span needing a fence of three, or an autolink alone on its line, is such a
        // line, so the heading is written ATX, its breaks as spaces.
        expect(serialize(() => [fill($createHeadingNode('h1'), ['p', br(), text('a`b``c', ['code'])])])).toBe('# p ```a`b``c```');
        expect(serialize(() => [fill($createHeadingNode('h2'), ['p', br(), fill($createLinkNode('https://x.test'), ['https://x.test'])])]))
            .toBe('## p <https://x.test>');

        const editor = editorWith(() => [fill($createHeadingNode('h1'), ['p', br(), text(' ``)', ['code'])])]);
        const output = serialized(editor);

        expect(output).toBe('p\\\n` ``)`\n===');
        expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
    });

    it('B5: marks close before a break and reopen after it; trailing spaces are dropped', () => {
        expect(serialize(() => [p(text('a  ', ['italic']), br(), text('b', ['italic']))])).toBe('*a*\\\n*b*');
    });
});

describe('$serializeMarkdown — escaping', () => {
    const cases: Array<[string, string, string]> = [
        ['E1', 'snake_case_word', 'snake_case_word'],
        ['E2', '_init_ and *x*', '\\_init\\_ and \\*x\\*'],
        ['E3', 'a ++ b ++ c', 'a \\+\\+ b \\+\\+ c'],
        ['E4', 'see <b> and a < b', 'see \\<b> and a < b'],
        ['E5', 'https://e.com/a_b', 'https\\://e.com/a_b'],
        ['E6', '1. not a list', '1\\. not a list'],
        ['E7', '# not a heading', '\\# not a heading'],
        ['E8', 'C:\\path\\x', 'C:\\path\\x'],
        ['E9', 'ends with \\', 'ends with \\\\'],
        ['E10', '&amp; &#35;', '&amp; &#35;'],
        ['E11', '[x]: https://e.com', '\\[x\\]: https\\://e.com'],
    ];

    for (const [id, input, expected] of cases) {
        it(`${id}: ${JSON.stringify(input)} is written ${JSON.stringify(expected)} and reads back as itself`, () => {
            const output = serialize(() => [p(input)]);

            expect(output).toBe(expected);
            expect(viewerModel(output).blocks).toEqual([para(run(input))]);
        });
    }
});

describe('$serializeMarkdown — further cases the plan specifies', () => {
    it('an empty quote writes ">"', () => {
        expect(serialize(() => [$createQuoteNode()])).toBe('>');
    });

    it('an empty code block writes the fence, a newline and the closing fence', () => {
        expect(serialize(() => [$createCodeNode()])).toBe('```\n```');
    });

    it('a heading made only of # escapes the first one', () => {
        const output = serialize(() => [fill($createHeadingNode('h1'), ['##'])]);

        expect(output).toBe('# \\##');
        expect(viewerModel(output).blocks).toEqual([{ kind: 'heading', depth: 1, runs: [run('##')] }]);
    });

    it('a ) ordered-list marker at a paragraph start is escaped', () => {
        const output = serialize(() => [p('1) not a list')]);

        expect(output).toBe('1\\) not a list');
        expect(viewerModel(output).blocks).toEqual([para(run('1) not a list'))]);
    });

    it('the @ of an email address in text is escaped so it is not a bare email autolink', () => {
        const output = serialize(() => [p('mail a@b.co')]);

        expect(output).toBe('mail a\\@b.co');
        expect(viewerModel(output).blocks).toEqual([para(run('mail a@b.co'))]);
    });

    it('a mailto link whose text is its address is an email autolink', () => {
        const output = serialize(() => [p(fill($createLinkNode('mailto:a@b.co'), ['a@b.co']))]);

        expect(output).toBe('<a@b.co>');
        expect(viewerModel(output).blocks).toEqual([para(run('a@b.co', [], { href: 'mailto:a@b.co', title: null }))]);
    });

    it('an angle-bracket destination escapes its \\, < and >', () => {
        const output = serialize(() => [p(fill($createLinkNode('/a<b>\\c'), ['t']))]);

        expect(output).toBe('[t](</a\\<b\\>\\\\c>)');
        expect(viewerModel(output).blocks).toEqual([para(run('t', [], { href: '/a<b>\\c', title: null }))]);
    });

    it('an empty destination writes "()", and "<>" before a title', () => {
        expect(serialize(() => [p(fill($createLinkNode(''), ['t']))])).toBe('[t]()');
        expect(serialize(() => [p(fill($createLinkNode('', { title: 'x' }), ['t']))])).toBe('[t](<> "x")');
    });

    it('a cell spanning two rows writes a ^^ continuation in the row below', () => {
        expect(serialize(() => {
            const merged = cell(false, 'd');

            merged.setRowSpan(2);

            return [table([cell(true, 'a'), cell(true, 'b')], [merged, cell(false, 'e')], [cell(false, 'f')])];
        })).toBe('| a | b |\n| --- | --- |\n| d | e |\n| ^^ | f |');
    });

    for (const char of ['>', '-', '+', '*', '=', '|', ':', '~', '`']) {
        it(`a paragraph starting with ${char} escapes it`, () => {
            const output = serialize(() => [p(`${char} x`)]);

            expect(output).toBe(`\\${char} x`);
            expect(viewerModel(output).blocks).toEqual([para(run(`${char} x`))]);
        });
    }

    it('` and ~ are escaped anywhere in text', () => {
        const output = serialize(() => [p('a`b~c')]);

        expect(output).toBe('a\\`b\\~c');
        expect(viewerModel(output).blocks).toEqual([para(run('a`b~c'))]);
    });

    it('a code span starting or ending with a backtick is padded inside its fences', () => {
        const output = serialize(() => [p(text('`a', ['code']))]);

        expect(output).toBe('`` `a ``');
        expect(viewerModel(output).blocks).toEqual([para(run('`a', ['code']))]);
    });

    it('a backslash before n in a table cell is escaped so it is not a cell line break', () => {
        expect(serialize(() => [table([cell(true, 'h')], [cell(false, 'a\\nb')])])).toBe('| h |\n| --- |\n| a\\\\nb |');
    });

    it('a cell whose whole text is ^^ is escaped', () => {
        expect(serialize(() => [table([cell(true, 'h')], [cell(false, '^^')])])).toBe('| h |\n| --- |\n| \\^^ |');
    });

    it('a title escapes its backslashes', () => {
        const output = serialize(() => [p(fill($createLinkNode('/u', { title: 'a\\b' }), ['t']))]);

        expect(output).toBe('[t](/u "a\\\\b")');
        expect(viewerModel(output).blocks).toEqual([para(run('t', [], { href: '/u', title: 'a\\b' }))]);
    });

    // A pipe-table cell holds inline content only, so a block a command nests in a cell (a heading, quote, list or
    // code block toggled inside it; the importer never nests one) is written as the inline content the editor shows,
    // each of its lines split by the cell break: its own syntax would show as literal text (`# t`) and read back into
    // the cell's text.
    const nested: Array<[string, () => LexicalNode, string]> = [
        ['heading', () => fill($createHeadingNode('h2'), ['t ', text('b', ['bold'])]), 't **b**'],
        ['quote', () => fill($createQuoteNode(), ['q', br(), 'r']), 'q\\n\\nr'],
        ['code block', () => fill($createCodeNode(), ['x | y', $createLineBreakNode(), 'z']), 'x \\| y\\n\\nz'],
    ];

    for (const [name, build, expected] of nested) {
        it(`a ${name} nested in a cell is written as its inline content`, () => {
            const editor = editorWith(() => {
                const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

                body.append(build());

                return [table([cell(true, 'a')], [body])];
            });
            const output = serialized(editor);

            expect(output).toBe(`| a |\n| --- |\n| ${expected} |`);
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });
    }

    it('a list nested in a cell writes each item\'s inline content on its own line of the cell', () => {
        const output = serialize(() => {
            const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

            body.append(list('bullet', 1, ['x', list('number', 1, ['n']), 'y']));

            return [table([cell(true, 'a')], [body])];
        });

        expect(output).toBe('| a |\n| --- |\n| x\\n\\nn\\n\\ny |');
    });

    it('LM6: a bullet list with no marker state writes "-", and one with an authored marker writes that marker', () => {
        expect(serialize(() => [list('bullet', 1, ['a', 'b'])])).toBe('- a\n- b');

        expect(serialize(() => {
            const node = list('bullet', 1, ['a', 'b']);

            $setState(node, listMarkerState, '*');

            return [node];
        })).toBe('* a\n* b');
    });

    it('LM7: a number list with no marker state writes ".", and one with ")" writes ")"', () => {
        expect(serialize(() => [list('number', 2, ['a'])])).toBe('2. a');

        expect(serialize(() => {
            const node = list('number', 2, ['a', 'b']);

            $setState(node, listMarkerState, ')');

            return [node];
        })).toBe('2) a\n3) b');
    });

    it('LM8: a marker of the other list type is ignored: a bullet list never writes ")"', () => {
        expect(serialize(() => {
            const node = list('bullet', 1, ['a']);

            $setState(node, listMarkerState, ')');

            return [node];
        })).toBe('- a');
    });
});

describe('$serializeMarkdown — line breaks in a table cell', () => {
    it('a line break in a cell writes the cell paragraph break, which the viewer shows as one break', () => {
        const output = serialize(() => {
            const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

            body.append(p('x', br(), 'y'));

            return [table([cell(true, 'h')], [body])];
        });

        expect(output).toBe('| h |\n| --- |\n| x\\n\\ny |');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'table', widths: [null], header: [{ align: null, colSpan: 1, rowSpan: 1, runs: [run('h')] }],
            rows: [[{ align: null, colSpan: 1, rowSpan: 1, runs: [run('x'), BREAK, run('y')] }]],
        }]);
    });

    it('the saved break survives a reload and a second save unchanged', () => {
        const editor = editorWith(() => {
            const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

            body.append(p('x', br(), 'y'));

            return [table([cell(true, 'h')], [body])];
        });
        const saved = editor.getValue();
        const reloaded = new MarkdownEditor();

        reloaded.setValue(saved);

        expect(reloaded.getValue()).toBe(saved);
        expect(editorSurfaceModel(reloaded)).toEqual(viewerModel(saved).blocks);
    });
});

describe('$serializeMarkdown — source nodes, raw blocks and loose lists', () => {
    /** A soft break: a source node showing a space and saving a newline. */
    function soft(formats: TextFormatType[] = []): LexicalNode {
        const node = $createMarkdownSourceTextNode(' ', '\n');

        for (const format of formats) {
            node.toggleFormat(format);
        }

        return node;
    }

    it('S34: a soft break writes a newline', () => {
        expect(serialize(() => [p('a', soft(), 'b')])).toBe('a\nb');
    });

    it('S35: a bold soft break stays inside the bold', () => {
        expect(serialize(() => [p(text('a', ['bold']), soft(['bold']), text('b', ['bold']))])).toBe('**a\nb**');
    });

    it('S36: a soft break in a level 3-6 heading writes a space', () => {
        expect(serialize(() => [fill($createHeadingNode('h3'), ['a', soft(), 'b'])])).toBe('### a b');
    });

    it('S36 (setext): a soft break in a level 1 heading keeps the setext form it was loaded from', () => {
        expect(serialize(() => [fill($createHeadingNode('h1'), ['a', soft(), 'b'])])).toBe('a\nb\n===');
    });

    it('a single-item loose list keeps the blank line between its text and its nested list', () => {
        const output = serialize(() => {
            const node = list('bullet', 1, ['a', list('bullet', 1, ['b'])]);

            $setState(node, listLooseState, true);

            return [node];
        });

        expect(output).toBe('- a\n\n  - b');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'list', ordered: false, loose: true, items: [
                [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[para(run('b'))]] }],
            ],
        }]);
    });

    it('S37: the line after a soft break is quoted and escaped like any line start', () => {
        expect(serialize(() => [fill($createQuoteNode(), ['a', soft(), '- b'])])).toBe('> a\n> \\- b');
    });

    it('S38: the line after a soft break in a list item is indented under the item', () => {
        expect(serialize(() => [fill($createListNode('bullet', 1), [fill($createListItemNode(), ['a', soft(), 'b'])])])).toBe('- a\n  b');
    });

    it('S39: a raw block writes its text unchanged', () => {
        expect(serialize(() => [$createMarkdownRawBlockNode('> a\n>\n> b')])).toBe('> a\n>\n> b');
    });

    it('S40: a loose list joins its items with a blank line', () => {
        expect(serialize(() => {
            const node = list('bullet', 1, ['a', 'b']);

            $setState(node, listLooseState, true);

            return [node];
        })).toBe('- a\n\n- b');
    });

    it('S40 (nested): a loose list keeps a nested list against its item', () => {
        const output = serialize(() => {
            const node = list('bullet', 1, ['a', list('bullet', 1, ['n']), 'b']);

            $setState(node, listLooseState, true);

            return [node];
        });

        expect(output).toBe('- a\n  - n\n\n- b');
        expect(viewerModel(output).blocks).toEqual([{
            kind: 'list', ordered: false, loose: true, items: [
                [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[para(run('n'))]] }],
                [para(run('b'))],
            ],
        }]);
    });

    it('S41: a source node writes its source unescaped', () => {
        expect(serialize(() => [p('see ', $createMarkdownSourceTextNode('<b>', '<b>'), 'x')])).toBe('see <b>x');
    });

    it('S42: a source node in a table cell has its pipe escaped', () => {
        expect(serialize(() => {
            const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

            body.append(p($createMarkdownSourceTextNode('<a|b>', '<a|b>')));

            return [table([cell(true, 'a')], [body])];
        })).toBe('| a |\n| --- |\n| <a\\|b> |');
    });

    it('a soft break ending a bold run is written after the closing delimiter, not at the next line start', () => {
        const output = serialize(() => [p(text('word', ['bold']), soft(['bold']), 'next line')]);

        expect(output).toBe('**word**\nnext line');
        expect(viewerModel(output).blocks).toEqual([para(run('word', ['bold']), run(' next line'))]);
    });

    it('a soft break opening a bold run is written before the opening delimiter', () => {
        const output = serialize(() => [p('word', soft(['bold']), text('next', ['bold']), ' line')]);

        expect(output).toBe('word\n**next** line');
        expect(viewerModel(output).blocks).toEqual([para(run('word '), run('next', ['bold']), run(' line'))]);
    });

    it('S43: text before a soft break drops its trailing spaces, so they do not become a hard break', () => {
        expect(serialize(() => [p('a  ', soft(), 'b')])).toBe('a\nb');
    });
});

describe('$serializeMarkdown — constructs the viewer would read into the text', () => {
    // Each case is text (or a node) the viewer's grammar would otherwise turn into a link, image or span,
    // found by comparing the viewer's reading of the output with the editor's own tree.

    it('a www. inside a word is escaped too: GFM autolinks it anywhere', () => {
        const output = serialize(() => [p('awww.e.com')]);

        expect(output).toBe('awww\\.e.com');
        expect(viewerModel(output).blocks).toEqual([para(run('awww.e.com'))]);
    });

    it('a ! ending the text before a link is escaped so the two do not read as an image', () => {
        const output = serialize(() => [p('Wow!', fill($createLinkNode('/u'), ['t']))]);

        expect(output).toBe('Wow\\![t](/u)');
        expect(viewerModel(output).blocks).toEqual([para(run('Wow!'), run('t', [], { href: '/u', title: null }))]);
    });

    it('a ( or { after a ] is escaped and a bracket pair is written \\\\[…\\\\]: marked unescapes brackets in link text before reading it', () => {
        const output = serialize(() => [p(fill($createLinkNode('/u'), ['[a](b) [c]{color=red}']))]);

        expect(output).toBe('[\\\\[a\\\\]\\(b) \\\\[c\\\\]\\{color=red}](/u)');
        expect(viewerModel(output).blocks).toEqual([para(run('[a](b) [c]{color=red}', [], { href: '/u', title: null }))]);
    });

    it('a backslash before a bracket in a code span inside a link is doubled', () => {
        const output = serialize(() => [p(fill($createLinkNode('/u'), [text('\\[', ['code'])]))]);

        expect(output).toBe('[`\\\\[`](/u)');
        expect(viewerModel(output).blocks).toEqual([para(run('\\[', ['code'], { href: '/u', title: null }))]);
    });

    it('a { right after an image is escaped so it is not read as the image\'s attributes', () => {
        const output = serialize(() => [p(
            $createMarkdownImageNode({ src: '/i.png', alt: 'a', width: null, height: null }), '{width=3}',
        )]);

        expect(output).toBe('![a](/i.png)\\{width=3}');
        expect(viewerModel(output).blocks).toEqual([para(
            { kind: 'image', src: '/i.png', alt: 'a', width: null, height: null, link: null }, run('{width=3}'),
        )]);
    });

    it('underline closes before a link whose destination holds a +', () => {
        const output = serialize(() => [p(fill($createLinkNode('/a+b'), [text('t', ['underline'])]))]);

        expect(output).toBe('[++t++](/a+b)');
        expect(viewerModel(output).blocks).toEqual([para(run('t', ['underline'], { href: '/a+b', title: null }))]);
    });

    it('a space-marker break ending an otherwise empty line writes a backslash, so the line is not blank', () => {
        const output = serialize(() => [p('a', br('  '), br('  '), 'b')]);

        expect(output).toBe('a  \n\\\nb');
        expect(viewerModel(output).blocks).toEqual([para(run('a'), BREAK, BREAK, run('b'))]);
    });

    it('a code span of spaces only is not padded, since CommonMark strips nothing from it', () => {
        const editor = editorWith(() => [p('a ', text('  ', ['code']), ' b')]);
        const output = serialized(editor);

        expect(output).toBe('a `  ` b');
        expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
    });
});

describe('$serializeMarkdown — mark changes inside a word', () => {
    // The stack rules close and reopen marks between two letters, where the delimiters meet each other with no
    // space: a merged `****` run, or a delimiter against another delimiter's punctuation, no longer flanks. The
    // block is read back, and written another way: a pair with `_`, underline outermost, or the marks reopened.
    const cases: Array<[string, () => LexicalNode[], string]> = [
        ['bold to italic', () => [p(text('a', ['bold']), text('b', ['bold', 'italic']), text('c', ['italic']))], '__a*b*__*c*'],
        ['bold underline between letters', () => [p('a', text('b', ['bold', 'underline']), 'c')], 'a++**b**++c'],
        ['strike closing after italic before a letter', () => [p(text('a', ['strikethrough']), text('b', ['strikethrough', 'italic']), 'c')], '~~a~~*~~b~~*c'],
    ];

    for (const [name, build, expected] of cases) {
        it(`${name}: written ${JSON.stringify(expected)}`, () => {
            const editor = editorWith(build);
            const output = serialized(editor);

            expect(output).toBe(expected);
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });
    }
});

describe('$serializeMarkdown — whole-stack review fixes', () => {
    /**
     * A list item holding the given children as they are, block nodes included.
     *
     * @param children - The item's children; a string is a plain text node.
     * @returns The list item.
     */
    function item(...children: Array<LexicalNode | string>): ListItemNode {
        const node = $createListItemNode();

        // `ListItemNode.append` merges a paragraph's children into the item; inserting after the previous child keeps
        // the paragraph a block, as a command inserting it does.
        for (const child of children.map((entry) => (typeof entry === 'string' ? $createTextNode(entry) : entry))) {
            const last = node.getLastChild();

            if (last === null) {
                node.append(child);
            } else {
                last.insertAfter(child);
            }
        }

        return node;
    }

    /**
     * A link with the bare-autolink state set, as the importer marks a GFM bare URL, `www.` or email autolink.
     *
     * @param url - The link's URL.
     * @param content - Its text.
     * @returns The link node.
     */
    function bareLink(url: string, content: string): LexicalNode {
        const node = fill($createLinkNode(url), [content]);

        $setState(node, bareAutolinkState, true);

        return node;
    }

    /**
     * A text node carrying the authored attribute text of the styled span it was loaded from.
     *
     * @param content - The text.
     * @param css - The node's inline CSS.
     * @param attributes - The span's authored attribute text.
     * @returns The text node.
     */
    function spanText(content: string, css: string, attributes: string): TextNode {
        const node = text(content, [], css);

        $setState(node, spanAttributesState, attributes);

        return node;
    }

    describe('F1: a newline inside a text node is a hard break, as the editor shows it', () => {
        it('in a paragraph, each line\'s block starter is escaped', () => {
            const output = serialize(() => [p('x\n# y\n- z')]);

            expect(output).toBe('x\\\n\\# y\\\n\\- z');
            expect(viewerModel(output).blocks).toEqual([para(run('x'), BREAK, run('# y'), BREAK, run('- z'))]);
        });

        it('a line that would be a setext underline is escaped', () => {
            const output = serialize(() => [p('x\n-')]);

            expect(output).toBe('x\\\n\\-');
            expect(viewerModel(output).blocks).toEqual([para(run('x'), BREAK, run('-'))]);
        });

        it('in a quote, every line keeps its "> " prefix', () => {
            const output = serialize(() => [fill($createQuoteNode(), ['x\n# y'])]);

            expect(output).toBe('> x\\\n> \\# y');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'quote', blocks: [para(run('x'), BREAK, run('# y'))] }]);
        });

        it('in a list item, the next line is indented and escaped', () => {
            const output = serialize(() => [list('bullet', 1, ['x\n- z'])]);

            expect(output).toBe('- x\\\n  \\- z');
            expect(viewerModel(output).blocks).toEqual([
                { kind: 'list', ordered: false, loose: false, items: [[para(run('x'), BREAK, run('- z'))]] },
            ]);
        });

        it('in a level 3-6 heading, the newline is a space like a line break', () => {
            expect(serialize(() => [fill($createHeadingNode('h3'), ['x\n- z'])])).toBe('### x - z');
        });

        it('a level 1 or 2 heading holding a newline is written setext, its lines escaped', () => {
            const output = serialize(() => [fill($createHeadingNode('h2'), ['x\n# y\n- z'])]);

            expect(output).toBe('x\\\n\\# y\\\n\\- z\n---');
            expect(viewerModel(output).blocks).toEqual([
                { kind: 'heading', depth: 2, runs: [run('x'), BREAK, run('# y'), BREAK, run('- z')] },
            ]);
        });

        it('in code-formatted text, the code span is split around the break', () => {
            const output = serialize(() => [p(text('a\n# b', ['code']))]);

            expect(output).toBe('`a`\\\n`# b`');
            expect(viewerModel(output).blocks).toEqual([para(run('a', ['code']), BREAK, run('# b', ['code']))]);
        });

        it('in a table cell, the newline is the cell break, not a raw newline ending the row', () => {
            expect(serialize(() => [table([cell(true, 'h')], [cell(false, 'a\nb')])])).toBe('| h |\n| --- |\n| a\\n\\nb |');
        });
    });

    describe('F2: an empty list item is written so the viewer reads an empty item', () => {
        it('an empty first item of a nested bullet list under text switches the list to "*"', () => {
            const output = serialize(() => [list('bullet', 1, ['a', list('bullet', 1, [''])])]);

            expect(output).toBe('- a\n  *');
            expect(viewerModel(output).blocks).toEqual([{
                kind: 'list', ordered: false, loose: false, items: [
                    [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[]] }],
                ],
            }]);
        });

        it('the whole nested list switches, so its later items stay in the same list', () => {
            const output = serialize(() => [list('bullet', 1, ['a', list('bullet', 1, ['', 'b'])])]);

            expect(output).toBe('- a\n  *\n  * b');
            expect(viewerModel(output).blocks).toEqual([{
                kind: 'list', ordered: false, loose: false, items: [
                    [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[], [para(run('b'))]] }],
                ],
            }]);
        });

        it('an item holding only an empty link is empty too', () => {
            expect(serialize(() => [$createListNode('bullet').append(
                item('a'), item($createListNode('bullet').append(item($createLinkNode('/u')))),
            )])).toBe('- a\n  *');
        });

        it('a later empty item and an empty ordered item keep their markers', () => {
            expect(serialize(() => [list('bullet', 1, ['a', list('bullet', 1, ['x', ''])])])).toBe('- a\n  - x\n  -');
            expect(serialize(() => [list('bullet', 1, ['a', list('number', 1, [''])])])).toBe('- a\n  1.');
        });
    });

    describe('F6: a list item holding blocks writes each as a block of the item', () => {
        it('a paragraph after a nested list stays in the item, after a blank line', () => {
            const output = serialize(() => [$createListNode('bullet').append(
                item('a'), item(list('number', 1, ['b']), p('X')),
            )]);

            // The block after the nested list makes the list loose, which the editor's looseness then
            // records, so the nested list is set apart too; the viewer reads the same either way.
            expect(output).toBe('- a\n\n  1. b\n\n  X');
            expect(viewerModel(output).blocks).toEqual([{
                kind: 'list', ordered: false, loose: true, items: [[
                    para(run('a')), { kind: 'list', ordered: true, loose: false, items: [[para(run('b'))]] }, para(run('X')),
                ]],
            }]);
        });

        it('a paragraph and a nested list in one item', () => {
            const output = serialize(() => [$createListNode('bullet').append(item(p('a'), list('bullet', 1, ['b'])), item('c'))]);

            expect(output).toBe('- a\n  - b\n- c');
            expect(viewerModel(output).blocks).toEqual([{
                kind: 'list', ordered: false, loose: false, items: [
                    [para(run('a')), { kind: 'list', ordered: false, loose: false, items: [[para(run('b'))]] }],
                    [para(run('c'))],
                ],
            }]);
        });

        it('a nested list after a table follows a blank line, so the table does not read its lines as rows', () => {
            const output = serialize(() => [$createListNode('bullet').append(
                item('a', table([cell(true, 'h')], [cell(false, 'c')]), list('bullet', 1, ['b'])),
            )]);

            expect(output).toBe('- a\n\n  | h |\n  | --- |\n  | c |\n\n  - b');
            expect((viewerModel(output).blocks[0] as { items: Block[][] }).items[0]!.map((block) => block.kind))
                .toEqual(['paragraph', 'table', 'list']);
        });

        it('a nested ordered list not starting at 1 after a paragraph follows a blank line, so the paragraph does not take it in', () => {
            const output = serialize(() => [$createListNode('bullet').append(item('a', p('X'), list('number', 3, ['b'])))]);

            expect(output).toBe('- a\n\n  X\n\n  3. b');
            expect((viewerModel(output).blocks[0] as { items: Block[][] }).items[0]!.map((block) => block.kind))
                .toEqual(['paragraph', 'paragraph', 'list']);
        });

        it('a nested list right after the item\'s own text still follows it directly (control)', () => {
            expect(serialize(() => [$createListNode('bullet').append(item('a', list('number', 3, ['b'])))])).toBe('- a\n  3. b');
        });

        it('text then a paragraph: the paragraph is a second block of the item', () => {
            const output = serialize(() => [$createListNode('number', 1).append(item('a', p('X')), item('b'))]);

            // The second block makes the list loose, which the editor's looseness then records.
            expect(output).toBe('1. a\n\n   X\n\n2. b');
            expect(viewerModel(output).blocks).toEqual([{
                kind: 'list', ordered: true, loose: true, items: [[para(run('a')), para(run('X'))], [para(run('b'))]],
            }]);
        });

        /** A bullet list of the given items. */
        const bullets = (...items: ListItemNode[]): ListNode => $createListNode('bullet').append(...items);

        /** A bullet list of the given items, written with `*`. */
        const stars = (...items: ListItemNode[]): ListNode => {
            const list = bullets(...items);

            $setState(list, listMarkerState, '*');

            return list;
        };

        /** A raw Markdown block of the given text. */
        const raw = (source: string): LexicalNode => $createMarkdownRawBlockNode(source);

        it.each<[string, () => ListNode, string]>([
            ['S1: a raw --- opening a later item of a - list stands under a bare marker',
                () => bullets(item('a'), item(raw('---')), item('b')), '- a\n-\n  ---\n- b'],
            ['S2: a raw --- opening the first item of a - list stands under a bare marker',
                () => bullets(item(raw('---')), item('b')), '-\n  ---\n- b'],
            ['S3: a raw --- opening a - list nested under text switches that list to *',
                () => bullets(item('a'), item(bullets(item(raw('---')), item('b')))), '- a\n  * ---\n  * b'],
            ['S4: a raw *** in a - list stays on the marker\'s line (control)',
                () => bullets(item('a'), item(raw('***')), item('b')), '- a\n- ***\n- b'],
            ['S5: a raw - - - opening an item of a - list stands under a bare marker',
                () => bullets(item('a'), item(raw('- - -')), item('b')), '- a\n-\n  - - -\n- b'],
            ['S6: a raw --- opening an item that holds a second block stands under a bare marker',
                () => bullets(item('a'), item(raw('---'), raw('***')), item('b')), '- a\n\n-\n  ---\n\n  ***\n\n- b'],
            ['S7: a raw --- in an ordered list stays on the marker\'s line (control)',
                () => $createListNode('number', 1).append(item('a'), item(raw('---'))), '1. a\n2. ---'],
            ['S8: a raw --- opening a later item of a nested - list stands under a bare marker',
                () => bullets(item('a'), item(bullets(item('x'), item(raw('---'))))), '- a\n  - x\n  -\n    ---'],
            ['S9: a raw *** opening an item of a * list stands under a bare marker',
                () => stars(item('a'), item(raw('***'))), '* a\n*\n  ***'],
            ['S10: a raw *** opening a * list nested under text stands under a bare *, which underlines nothing',
                () => bullets(item('a'), item(stars(item(raw('***')), item('b')))), '- a\n  *\n    ***\n  * b'],
        ])('%s', (_name, build, expected) => {
            const output = serialize(() => [build()]);

            expect(output).toBe(expected);
            expect(viewerModel(output).blocks.map((block) => block.kind)).toEqual(['list']);
        });
    });

    describe('F9: a saved heading keeps its source text, so its id does not change', () => {
        for (const [name, url, content] of [
            ['a www. autolink', 'http://www.x.test', 'www.x.test'],
            ['a bare URL', 'https://x.test/a_b', 'https://x.test/a_b'],
            ['a bare email address', 'mailto:a@x.test', 'a@x.test'],
        ]) {
            it(`${name} the importer marked bare is written bare`, () => {
                const output = serialize(() => [fill($createHeadingNode('h3'), ['see ', bareLink(url!, content!), ' now'])]);

                expect(output).toBe(`### see ${content} now`);
                expect(viewerModel(output).blocks).toEqual([{
                    kind: 'heading', depth: 3, runs: [run('see '), run(content!, [], { href: url!, title: null }), run(' now')],
                }]);
            });
        }

        it('a bare link with no space after it falls back to a form that does not run into the next text', () => {
            const output = serialize(() => [p(bareLink('http://www.x.test', 'www.x.test'), 'x')]);

            expect(output).toBe('[www\\.x.test](http://www.x.test)x');
            expect(viewerModel(output).blocks).toEqual([para(run('www.x.test', [], { href: 'http://www.x.test', title: null }), run('x'))]);
        });

        it('a bare URL link with text before it falls back to its angle-bracket form', () => {
            expect(serialize(() => [p('a', bareLink('https://x.test', 'https://x.test'))])).toBe('a<https://x.test>');
        });

        it('a span keeps its authored attribute order and its unknown attributes', () => {
            const output = serialize(() => [fill($createHeadingNode('h2'), [
                spanText('a', 'color: red; font-size: 2em', 'size=2em bogus=1 color=red'), ' ', spanText('b', '', 'bogus=1'),
            ])]);

            expect(output).toBe('## [a]{size=2em bogus=1 color=red} [b]{bogus=1}');
            expect(viewerModel(output).headingIds).toEqual(viewerModel('## [a]{size=2em bogus=1 color=red} [b]{bogus=1}').headingIds);
        });

        it('a span restyled since it was loaded writes its current style', () => {
            expect(serialize(() => [p(spanText('a', 'color: blue', 'color=red bogus=1'))])).toBe('[a]{color=blue}');
        });
    });

    describe('F10: whitespace between differently formatted runs keeps the mark it carries', () => {
        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['underline around italic', () => [p(text('4', ['italic', 'underline']), text(' 6', ['underline']))], '++*4* 6++'],
            ['strike around bold', () => [p(text('7', ['strikethrough', 'bold']), text(' 1', ['strikethrough']))], '~~**7** 1~~'],
            ['strike before an image', () => [p(
                text(', ', ['strikethrough']), $createMarkdownImageNode({ src: 'g', alt: '', width: null, height: null }),
            )], '~~, ![](g)~~'],
            ['italic over an image before a space', () => [p(
                text('a ', ['italic']), $createMarkdownImageNode({ src: 'g', alt: '', width: null, height: null }), ' b',
            )], '*a ![](g)* b'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('an image the next text runs into closes the mark before it', () => {
            const editor = editorWith(() => [p(
                text('a ', ['italic']), $createMarkdownImageNode({ src: 'g', alt: '', width: null, height: null }), 'b',
            )]);

            expect(serialized(editor)).toBe('*a* ![](g)b');
        });
    });

    describe('F11: a bracket pair around a code span in link text', () => {
        it('is written unescaped when the code span holds an odd number of backticks', () => {
            const editor = editorWith(() => [p(fill($createLinkNode('/u'), ['[', text('`', ['code']), ']']), ' d!')]);
            const output = serialized(editor);

            expect(output).toBe('[[`` ` ``]](/u) d!');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('stays escaped otherwise', () => {
            expect(serialize(() => [p(fill($createLinkNode('/u'), ['[', text('a', ['code']), ']']))])).toBe('[\\\\[`a`\\\\]](/u)');
        });
    });

    describe('emphasis next to a word: an outer pair marked would mis-pair is written with _', () => {
        // An inner bold or italic run with a letter on both sides can both open and close, and `marked` pairs it with
        // the outer `*` run when only one end of the inner pair is such a run, so the outer pair takes `_`, which
        // never pairs with `*`.
        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['bold opening mid-word inside italic (CommonMark 410 after a typed word)', () => [p(
                text('foo fuzz', ['italic']), text('bar', ['italic', 'bold']), text(' baz', ['italic']),
            )], '_foo fuzz**bar** baz_'],
            ['italic closing mid-word inside bold', () => [p(
                text('foo ', ['bold']), text('x', ['bold', 'italic']), text('y baz', ['bold']),
            )], '__foo *x*y baz__'],
            ['in link text (CommonMark 516 after a typed word)', () => [p(fill($createLinkNode('/uri'), [
                'link ', text('foo fuzz', ['italic']), text('bar', ['italic', 'bold']), text(' ', ['italic']),
                text('#', ['italic', 'code']),
            ]))], '[link _foo fuzz**bar** `#`_](/uri)'],
            ['italic dropped and reopened inside bold', () => [p(
                text('a', ['bold', 'italic']), text('b', ['bold']), text('c', ['bold', 'italic']),
            )], '__*a*b*c*__'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('an inner pair with a letter on both sides of both ends keeps the outer *, which marked pairs right', () => {
            expect(serialize(() => [p(text('a', ['bold']), text('b', ['bold', 'italic']), text('c', ['bold']))])).toBe('**a*b*c**');
        });

        it('an outer pair opening mid-word cannot take _, so the block is read back and its pairs rewritten', () => {
            // `x*a **b**c*` reads `**b**c*` wrongly; italic stops before the space, which no delimiter can italicise
            // at the edge of a run, and resumes with the bold pair written `__`.
            const editor = editorWith(() => [p('x', text('a ', ['italic']), text('b', ['italic', 'bold']), text('c', ['italic']))]);
            const output = serialized(editor);

            expect(output).toBe('x*a* __*b*__*c*');
            expect(viewerModel(output).blocks).toEqual([para(
                // The plain space shows as the italic text on both sides of it does: a space shows no slant.
                run('x'), run('a ', ['italic']), run('b', ['bold', 'italic']), run('c', ['italic']),
            )]);
        });
    });

    describe('a code block\'s fence is valid for its info string and its code', () => {
        /**
         * A code block of the given language and text.
         *
         * @param language - Its language (info string).
         * @param content - Its text.
         * @returns The code node.
         */
        function code(language: string, content: string): LexicalNode {
            return fill($createCodeNode(language), [content]);
        }

        it('an info string holding a backtick takes a ~~~ fence, which a backtick fence cannot hold', () => {
            const output = serialize(() => [code('`2', 'x'), p('para')]);

            expect(output).toBe('~~~`2\nx\n~~~\n\npara');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'code', lang: '`2', text: 'x' }, para(run('para'))]);
        });

        it('a ~~~ fence is longer than any ~ run starting a line of its code', () => {
            const output = serialize(() => [code('`', '~~~\n~~~~ a\nb ~~~~~'), p('para')]);

            expect(output).toBe('~~~~~`\n~~~\n~~~~ a\nb ~~~~~\n~~~~~\n\npara');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'code', lang: '`', text: '~~~\n~~~~ a\nb ~~~~~' }, para(run('para'))]);
        });

        it('a backtick fence is longer than any backtick run starting a line of its code, and a ~ run does not count', () => {
            const output = serialize(() => [code('js', '```\n  ````x\n~~~~~'), p('para')]);

            expect(output).toBe('`````js\n```\n  ````x\n~~~~~\n`````\n\npara');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'code', lang: 'js', text: '```\n  ````x\n~~~~~' }, para(run('para'))]);
        });
    });

    describe('a code span is fenced with the shortest backtick run its content does not hold', () => {
        const cases: Array<[string, string, string]> = [
            ['a run of two', ' ``)', '` ``)`'],
            ['a run of two at both edges', '``', '` `` `'],
            ['runs of one and two', 'a`b``c', '```a`b``c```'],
        ];

        for (const [name, content, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(() => [p('p', br(), text(content, ['code']))]);
                const output = serialized(editor);

                expect(output).toBe(`p\\\n${expected}`);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('in link text, the fence stays one longer than the longest run', () => {
            expect(serialize(() => [p(fill($createLinkNode('/u'), [text('``', ['code'])]))])).toBe('[``` `` ```](/u)');
        });
    });

    describe('a bare autolink inside emphasis stays bare where the emphasis delimiters bound it', () => {
        /**
         * A link the importer marked bare, its text carrying the given formats.
         *
         * @param url - The link's URL.
         * @param content - Its text.
         * @param formats - The text's formats.
         * @returns The link node.
         */
        function formattedBareLink(url: string, content: string, formats: TextFormatType[]): LexicalNode {
            const node = fill($createLinkNode(url), [text(content, formats)]);

            $setState(node, bareAutolinkState, true);

            return node;
        }

        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['an italic URL right before a word', () => [p(formattedBareLink('http://e', 'http://e', ['italic']), '4 x')], '*http://e*4 x'],
            ['a bold www. address right before a word', () => [p(
                formattedBareLink('http://www.e.test', 'www.e.test', ['bold']), '9',
            )], '**www.e.test**9'],
            ['an italic URL between italic words', () => [p(
                text('a ', ['italic']), formattedBareLink('http://e', 'http://e', ['italic']), text(' b', ['italic']),
            )], '*a http://e b*'],
            ['a struck email address right before a word', () => [p(
                formattedBareLink('mailto:a@x.test', 'a@x.test', ['strikethrough']), '4',
            )], '~~a@x.test~~4'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('text running into it falls back to the angle-bracket form, the mark kept', () => {
            const editor = editorWith(() => [p(text('a', ['italic']), formattedBareLink('http://e', 'http://e', ['italic']))]);
            const output = serialized(editor);

            expect(output).toBe('*a<http://e>*');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('a mark opening right after it is no bound, so it falls back', () => {
            expect(serialize(() => [p(formattedBareLink('http://e', 'http://e', []), text('b', ['italic']))]))
                .toBe('<http://e>*b*');
        });
    });

    describe('a fence keeps its authored attributes while they still resolve to its style', () => {
        /**
         * A one-column fence aligned right, loaded with the given attribute text.
         *
         * @param authored - The attribute text it was loaded with.
         * @param align - Its alignment now.
         * @returns The fence.
         */
        function fence(authored: string, align: string): LexicalNode {
            const block = $createMarkdownBlockNode();

            block.setAlign(align);
            $setState(block, fenceAttributesState, authored);
            block.append(fill($createMarkdownColumnNode(), [p('text')]));

            return block;
        }

        it('an attribute the editor does not model and the authored order are kept', () => {
            expect(serialize(() => [fence('x1=2 align=right', 'right')])).toBe('::: {x1=2 align=right}\ntext\n:::');
        });

        it('a changed alignment writes the normalized attributes (control)', () => {
            expect(serialize(() => [fence('x1=2 align=right', 'center')])).toBe('::: {align=center}\ntext\n:::');
        });

        it('the authored attributes survive the fence\'s JSON round trip (a copy, or content restored from JSON)', () => {
            expect(serialize(() => [jsonRoundTrip(fence('x1=2 align=right', 'right'))])).toBe('::: {x1=2 align=right}\ntext\n:::');
        });
    });

    describe('a link title holding line breaks', () => {
        it('in a paragraph, a blank line in it is written as one line break, which does not end the paragraph', () => {
            const output = serialize(() => [p('a ', fill($createLinkNode('/u', { title: 'x\n\ny' }), ['t']), ' b')]);

            expect(output).toBe('a [t](/u "x\ny") b');
            expect(viewerModel(output).blocks).toEqual([para(run('a '), run('t', [], { href: '/u', title: 'x\ny' }), run(' b'))]);
        });

        it('in a heading, a line break in it is written as a space, which keeps the heading on its line', () => {
            const output = serialize(() => [fill($createHeadingNode('h3'), [fill($createLinkNode('/u', { title: 'x\ny' }), ['t'])])]);

            expect(output).toBe('### [t](/u "x y")');
            expect(viewerModel(output).blocks).toEqual([{ kind: 'heading', depth: 3, runs: [run('t', [], { href: '/u', title: 'x y' })] }]);
        });
    });

    describe('a bare autolink before a backslash hard break', () => {
        it('is written in angle brackets, since the backslash would read as part of the URL', () => {
            const editor = editorWith(() => {
                const link = fill($createLinkNode('https://e.com'), ['https://e.com']);

                $setState(link, bareAutolinkState, true);

                return [p('a ', link, br('\\'), 'b')];
            });
            const output = serialized(editor);

            expect(output).toBe('a <https://e.com>\\\nb');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('stays bare before a break written with trailing spaces (control)', () => {
            const editor = editorWith(() => {
                const link = fill($createLinkNode('https://e.com'), ['https://e.com']);

                $setState(link, bareAutolinkState, true);

                return [p('a ', link, br('  '), 'b')];
            });
            const output = serialized(editor);

            expect(output).toBe('a https://e.com  \nb');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });
    });

    describe('an image keeps its authored attributes while they still resolve to its size', () => {
        /**
         * An image of the given size carrying the authored attribute text it was loaded with.
         *
         * @param width - Its width, or `null`.
         * @param height - Its height, or `null`.
         * @param attributes - The authored attribute text.
         * @returns The image node.
         */
        function image(width: number | null, height: number | null, attributes: string): LexicalNode {
            const node = $createMarkdownImageNode({ src: 'g', alt: '', width, height });

            $setState(node, imageAttributesState, attributes);

            return node;
        }

        const cases: Array<[string, () => LexicalNode, string]> = [
            ['an invalid width', () => image(null, null, 'width=x'), '# a ![](g){width=x} b'],
            ['an unknown attribute', () => image(null, null, 'bogus=1'), '# a ![](g){bogus=1} b'],
            ['the authored order', () => image(3, 2, 'height=2 width=3'), '# a ![](g){height=2 width=3} b'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name} is kept, so the heading id does not change`, () => {
                const output = serialize(() => [fill($createHeadingNode('h1'), ['a ', build(), ' b'])]);

                expect(output).toBe(expected);
                expect(viewerModel(output).headingIds).toEqual(viewerModel(expected).headingIds);
            });
        }

        it('the authored attributes survive the image\'s JSON round trip (a copy, or content restored from JSON)', () => {
            expect(serialize(() => [p(jsonRoundTrip(image(null, null, 'width=x')))])).toBe('![](g){width=x}');
        });

        it('attributes that no longer resolve to the image\'s size are written from it', () => {
            expect(serialize(() => [p(image(5, null, 'height=2 width=3'))])).toBe('![](g){width=5}');
        });
    });

    describe('a mark the text after an image carries from its leading space opens before the image', () => {
        const image = (): LexicalNode => $createMarkdownImageNode({ src: 'g', alt: '', width: null, height: null });

        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['strike, the image first in the block', () => [p(image(), text(' 2', ['strikethrough']))], '~~![](g) 2~~'],
            ['italic, after a space', () => [p('x ', image(), text(' 2', ['italic']))], 'x *![](g) 2*'],
            ['underline, after a word', () => [p('x', image(), text(' 2', ['underline']))], 'x++![](g) 2++'],
            ['strike already open before the image', () => [p(
                text('a', ['strikethrough']), image(), text(' 2', ['strikethrough']),
            )], '~~a![](g) 2~~'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('a delimiter cannot open between a word and the image, so the space stays unmarked there', () => {
            expect(serialize(() => [p('a', image(), text(' 2', ['strikethrough']))])).toBe('a![](g) ~~2~~');
        });

        it('text split into nodes of one format is written as the one node it shows as', () => {
            // Lexical joins such nodes only when it commits an update, and a load's save fingerprints the document
            // before that, so the writing must not depend on where the text is split.
            const editor = new MarkdownEditor();
            let split = '';

            editor.setValue('');
            lexicalOf(editor).update(() => {
                $getRoot().clear().append(p(image(), text(' ', ['italic']), text('!', ['italic'])));
                split = $serializeMarkdown();
            }, { discrete: true });

            expect(split).toBe(serialize(() => [p(image(), text(' !', ['italic']))]));
        });
    });

    describe('emphasis next to a word: a run between a letter and punctuation stays lossy', () => {
        // No delimiter opens after a letter and before punctuation, or closes after punctuation and before a letter.
        // CommonMark's remedy, a character reference for the letter (`fuz&#x7A;*\\**`), shows as typed in the viewer,
        // which does not decode references. Each case asserts the loss, so a writer that fixes one turns it red.
        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['italic text opening with punctuation after a word (CommonMark 437 after a typed word)', () => [p(
                'foo fuzz', text('*', ['italic']),
            )], 'foo fuzz*\\**'],
            ['bold text ending with punctuation before a word', () => [p(text('(a)', ['bold']), 'b')], '**(a)**b'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}, which the viewer reads back differently`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks, `${name} now reads back: move it out of the lossy cases`).not.toEqual(editorSurfaceModel(editor));
            });
        }
    });

    describe('a block is read back with the viewer\'s lexer, and rewritten when its emphasis would read differently', () => {
        // Where the delimiters the stack rules write meet each other or punctuation, `marked` can read the emphasis
        // differently from what the editor holds. The serializer lexes what it wrote and, when the reading differs,
        // writes the block another way — a bold or italic pair with `_`, underline outermost, the marks of a link or
        // span inside it, or marks reopened in another order — keeping the first that reads back as written.
        const image = (): LexicalNode => $createMarkdownImageNode({ src: 'g', alt: '', width: null, height: null });
        const cases: Array<[string, () => LexicalNode[]]> = [
            ['italic, then bold, then italic, between punctuation (a merged *** run)', () => [p(
                text('&', ['italic']), text('c', ['bold']), text('.', ['italic']),
            )]],
            ['bold, then bold italic underline, between letters', () => [p(text('c', ['bold']), text('x', ['bold', 'italic', 'underline']))]],
            ['italic, strike and bold punctuation (a ~~ delimiter is a letter next to *)', () => [p(
                text('+', ['italic']), text('}', ['strikethrough']), text('{', ['bold']),
            )]],
            ['bold code, strike and bold punctuation', () => [p(
                text('é', ['bold', 'code']), text('o', ['strikethrough']), text('@', ['bold']),
            )]],
            ['bold around a code span holding a backtick and a star', () => [p(text('`*', ['bold', 'code']))]],
            ['bold struck code, then bold italic punctuation', () => [p(
                text(' ', ['bold', 'strikethrough', 'code']), text('%', ['bold', 'italic']),
            )]],
            ['an italic styled span right before a word', () => [p(text(':', ['italic'], 'color: red'), 'o')]],
            ['a bold link after a word', () => [p('A fuzz', fill($createLinkNode('/u'), [text('x', ['bold'])]))]],
            ['italic, then bold italic code', () => [p(text('o', ['italic']), text('[', ['bold', 'italic', 'code']))]],
            ['italic, then bold italic underlined tilde', () => [p(text('a', ['italic']), text('~', ['bold', 'italic', 'underline']))]],
            ['bold underlined text before a word (CommonMark ++**bu**++ loaded and saved)', () => [p(text('bu', ['bold', 'underline']), 'zq')]],
            ['bold to italic inside a word', () => [p(text('a', ['bold']), text('b', ['bold', 'italic']), text('c', ['italic']))]],
            ['bold underline between letters', () => [p('a', text('b', ['bold', 'underline']), 'c')]],
            ['strike closing after italic before a letter', () => [p(text('a', ['strikethrough']), text('b', ['strikethrough', 'italic']), 'c')]],
            ['italic over an image right before a word', () => [p(text('a', ['italic']), image(), 'b')]],
            // `marked` hides a `<…>` stretch from emphasis pairing, whatever lies between: an unescaped `<` before
            // the bold and a `>` after it would leave the bold's delimiters as text.
            ['bold between a `<` and a later `>`', () => [p('<+a', text('b', ['bold']), 'c d<e>')]],
            ['italic between a `<` and a `>`', () => [p('a <', text('b', ['italic']), 'c >')]],
        ];

        for (const [name, build] of cases) {
            it(`${name}: reads back as the editor shows it`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(viewerModel(output).blocks, output).toEqual(editorSurfaceModel(editor));
            });
        }

        it('a tilde is left unescaped where an escaped one would keep emphasis around it from closing', () => {
            // `marked` reads an escaped `\\~` as punctuation, so `**\\~**c` cannot close; a lone `~` that pairs with
            // nothing is a letter next to `*`, so `**~**c` reads as written.
            const editor = editorWith(() => [fill($createQuoteNode(), [text('~', ['bold']), 'c'])]);
            const output = serialized(editor);

            expect(output).toBe('> **~**c');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('two lone tildes stay escaped, since unescaped they would pair as strikethrough', () => {
            expect(serialize(() => [p('a~b c~d')])).toBe('a\\~b c\\~d');
        });

        it('a break ending a link\'s text is written after the link, where it still breaks the line', () => {
            const editor = editorWith(() => [p(fill($createLinkNode('/u'), ['a', br()]), 'b')]);
            const output = serialized(editor);

            expect(output).toBe('[a](/u)\\\nb');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('emphasis opening right after a table cell\'s break is written after a space, so it can open', () => {
            // The cell break `\\n\\n` ends in a letter, against which a delimiter before punctuation cannot open; the
            // space is collapsed at the start of the line the break makes.
            const editor = editorWith(() => {
                const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

                body.append(p(br(), text('{', ['italic'])), p(text('}', ['bold'])));

                return [table([cell(true, 'h')], [body])];
            });
            const output = serialized(editor);

            expect(output).toBe('| h |\n| --- |\n| \\n\\n *{*\\n\\n **}** |');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('an angle-bracket autolink inside emphasis keeps its form, the marks around it', () => {
            const output = serialize(() => [fill($createHeadingNode('h6'), [
                fill($createLinkNode('mailto:a@b.test'), [text('a@b.test', ['italic'])]),
                text(' x ', ['bold']), fill($createLinkNode('https://a.test/1'), [text('https://a.test/1', ['bold'])]), text(' (', ['bold']),
            ])]);

            expect(output).toBe('###### *<a@b.test>* **x <https://a.test/1> (**');
            expect(viewerModel(output).headingIds).toEqual(viewerModel('###### *<a@b.test>* **x <https://a.test/1> (**').headingIds);
        });

        it('a code span whose content ends with a backslash is padded, so the backslash does not escape its fence', () => {
            // `marked` masks a backslash and the character after it before pairing backticks, so `` `a \` `` followed by
            // another code span would pair its opening fence with that span's.
            const editor = editorWith(() => [p(text('a \\', ['code']), ' x *', text('b', ['code']))]);
            const output = serialized(editor);

            expect(output).toBe('` a \\ ` x \\*`b`');
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
        });

        it('a bare autolink right after an angle-bracket one stays bare, so the heading keeps its id', () => {
            const output = serialize(() => [fill($createHeadingNode('h5'), [
                fill($createLinkNode('https://a.test/1'), ['https://a.test/1']), bareLink('http://www.b.test', 'www.b.test'),
            ])]);

            expect(output).toBe('##### <https://a.test/1>www.b.test');
        });

        it('a block whose reading no writing can keep is written the first way', () => {
            expect(serialize(() => [p(text('(a)', ['bold']), 'b')])).toBe('**(a)**b');
        });
    });

    describe('underline keeps the whitespace it covers inside its delimiters', () => {
        // The underline grammar (`++([^+]+)++`) has no flanking rule, so whitespace at the edge of underlined text, or
        // underlined whitespace alone, stays underlined; emphasis and strikethrough cannot open before or close after
        // whitespace, so theirs is written outside their delimiters.
        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['leading whitespace', () => [p('b', text(' a', ['underline']))], 'b++ a++'],
            ['trailing whitespace', () => [p(text('a ', ['underline']), 'b')], '++a ++b'],
            ['whitespace alone', () => [p('a', text(' ', ['underline']), 'b')], 'a++ ++b'],
            ['whitespace alone after an underlined word', () => [p(text('a', ['underline']), text(' ', ['underline']), 'b')], '++a ++b'],
            ['an underlined space after italic underlined text', () => [p(text('a', ['italic', 'underline']), text(' ', ['underline']), 'b')], '++*a* ++b'],
            ['an underlined space before bold underlined text', () => [p('x', text(' ', ['underline']), text('a', ['bold', 'underline']))], 'x++ **a**++'],
            ['trailing whitespace with italic running on', () => [p(text('a ', ['italic', 'underline']), text('b', ['italic']))], '*++a ++b*'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        it('the edge whitespace of italic underlined text keeps its underline; its italic cannot be written', () => {
            // A closing `*` cannot follow whitespace, nor an opening one precede it, so no Markdown italicises a space
            // at the edge of italic text: the space keeps only the underline the grammar can hold.
            const output = serialize(() => [p(text('a ', ['italic', 'underline']), 'b')]);

            expect(output).toBe('++*a* ++b');
            expect(viewerModel(output).blocks).toEqual([para(run('a', ['italic', 'underline']), run(' ', ['underline']), run('b'))]);
        });
    });

    it('a body row wider than the header widens the table with empty header cells, so no cell is dropped', () => {
        // A pipe table has as many columns as its header row: `marked` drops a body cell beyond them. An edit can
        // leave a row with more cells than the header (Lexical's table transform, skipped here, would square it
        // only on a later update); the header is padded instead of the cell's text being lost.
        const editor = new MarkdownEditor();

        editor.setValue('');
        lexicalOf(editor).update(() => {
            $getRoot().clear().append(table([cell(true, 'a')], [cell(false, '1')], [cell(false, '2'), cell(false, '3')]));
        }, { discrete: true, skipTransforms: true });

        const output = serialized(editor);

        expect(output).toBe('| a |  |\n| --- | --- |\n| 1 |  |\n| 2 | 3 |');
        expect(viewerModel(output).blocks[0]).toMatchObject({ rows: [[{ runs: [run('1')] }, { runs: [] }], [{ runs: [run('2')] }, { runs: [run('3')] }]] });
    });

    describe('a hard break at the start of a block is written; a table cell keeps a break at either edge', () => {
        /**
         * A table whose one body cell holds the given paragraphs, each a list of inline children.
         *
         * @param paragraphs - The cell's paragraphs.
         * @returns The table.
         */
        function cellTable(...paragraphs: Array<Array<LexicalNode | string>>): TableNode {
            const body = $createTableCellNode(TableCellHeaderStates.NO_STATUS);

            body.append(...paragraphs.map((children) => p(...children)));

            return table([cell(true, 'h')], [body]);
        }

        const cases: Array<[string, () => LexicalNode[], string]> = [
            ['a paragraph opening with a break', () => [p(br(), 'a')], '\\\na'],
            ['a paragraph opening with two breaks', () => [p(br(), br('  '), 'a')], '\\\n\\\na'],
            ['a paragraph opening with a newline in its text', () => [p('\na')], '\\\na'],
            ['a quote opening with a break', () => [fill($createQuoteNode(), [br(), 'a'])], '> \\\n> a'],
            ['a list item opening with a break', () => [fill($createListNode('bullet', 1), [fill($createListItemNode(), [br(), 'a'])])], '- \\\n  a'],
            ['a cell opening with a break', () => [cellTable([br(), 'a'])], '| h |\n| --- |\n| \\n\\na |'],
            ['a cell ending with a break', () => [cellTable(['a', br()])], '| h |\n| --- |\n| a\\n\\n |'],
            ['a cell holding only a break', () => [cellTable([br()])], '| h |\n| --- |\n| \\n\\n |'],
            ['a cell with a break between two words', () => [cellTable(['a', br(), 'b'])], '| h |\n| --- |\n| a\\n\\nb |'],
            ['a cell ending with an empty paragraph', () => [cellTable(['a'], [])], '| h |\n| --- |\n| a\\n\\n |'],
            ['a cell opening with an empty paragraph', () => [cellTable([], ['a'])], '| h |\n| --- |\n| \\n\\na |'],
            ['a cell with an empty paragraph between two', () => [cellTable(['a'], [], ['b'])], '| h |\n| --- |\n| a\\n\\n\\n\\nb |'],
        ];

        for (const [name, build, expected] of cases) {
            it(`${name}: written ${JSON.stringify(expected)}`, () => {
                const editor = editorWith(build);
                const output = serialized(editor);

                expect(output).toBe(expected);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }

        // CommonMark reads no hard break at the end of a block — a trailing `\` is a literal backslash and trailing
        // spaces are stripped — and a block holding only breaks has no content to keep it a paragraph. No Markdown
        // the viewer reads shows the empty line such a break makes, so the serializer drops it, and the editor does
        // not keep one (its line-break rules remove it), so the save shows what the editor shows.
        const dropped: Array<[string, () => LexicalNode[]]> = [
            ['a paragraph ending with a break', () => [p('a', br())]],
            ['a paragraph holding only a break', () => [p(br())]],
            ['a quote ending with a break', () => [fill($createQuoteNode(), ['a', br()])]],
        ];

        for (const [name, build] of dropped) {
            it(`${name}: the break is dropped, by the serializer and by the editor`, () => {
                const editor = new MarkdownEditor();
                let output = '';

                editor.setValue('');
                // Serialized in the update that builds the block, before the editor's rules run.
                lexicalOf(editor).update(() => {
                    $getRoot().clear().append(...build());
                    output = $serializeMarkdown();
                }, { discrete: true });

                expect(output).not.toMatch(/\\$/);
                expect(serialized(editor)).toBe(output);
                expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(editor));
            });
        }
    });
});

// Bold and italic do not show on whitespace, and the writer keeps whitespace
// outside the delimiters at a run's edge, so a save read back can hold the
// same text with whitespace marked otherwise. Which marks a link or styled
// span carries whole decides where its marks are written, so both forms must
// save alike — else a save loaded and saved again changes (canonical
// idempotence).
describe('$serializeMarkdown — the same placement for marks however whitespace carries them', () => {
    /**
     * A link holding the given children.
     *
     * @param url - Its URL.
     * @param children - Its children; a string is a plain text node.
     * @param title - Its title, if any.
     * @returns The link node.
     */
    function link(url: string, children: Array<LexicalNode | string>, title?: string): LexicalNode {
        return fill($createLinkNode(url, title === undefined ? undefined : { title }), children);
    }

    const cases: Array<[string, () => LexicalNode[], () => LexicalNode[]]> = [
        [
            'a link ending in marked whitespace before a link with the same mark',
            () => [p('x', link('https://e.test/b', [text('a b, ', ['bold'])]), link('https://e.test/a sp', [text('c d', ['bold'])], 't'))],
            () => [p('x', link('https://e.test/b', [text('a b,', ['bold']), ' ']), link('https://e.test/a sp', [text('c d', ['bold'])], 't'))],
        ],
        [
            'marked whitespace before a styled span with the same marks, in a link',
            () => [p('z~y', link('https://e.test/x', [text('a ', ['bold', 'italic']), text('b', ['bold', 'italic'], 'color: #cc0000')]), 'z')],
            () => [p('z~y', link('https://e.test/x', [text('a', ['bold', 'italic']), ' ', text('b', ['bold', 'italic'], 'color: #cc0000')]), 'z')],
        ],
        [
            'marked whitespace before an italic styled span, in a link',
            () => [p(link('/p', [text('a b ', ['italic']), text('c d', ['italic'], 'font-size: 1.2em')]), 'z')],
            () => [p(link('/p', [text('a b', ['italic']), ' ', text('c d', ['italic'], 'font-size: 1.2em')]), 'z')],
        ],
    ];

    for (const [name, marked, unmarked] of cases) {
        it(`${name}: saved alike`, () => {
            const markedEditor = editorWith(marked);
            const unmarkedEditor = editorWith(unmarked);
            const output = serialized(markedEditor);

            expect(serialized(unmarkedEditor)).toBe(output);
            expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(markedEditor));
        });
    }

    it('whitespace away from a link or span edge is written as it is marked (control)', () => {
        expect(serialize(() => [p(text('a', ['bold']), ' ', text('b', ['bold']))])).toBe('**a** **b**');
        expect(serialize(() => [p(text('a b', ['bold']))])).toBe('**a b**');
    });

    // A bare autolink is written bare only when nothing borders it; its
    // `[…](…)` fallback holds the marks outside it, where a link loaded from
    // that fallback — no longer bare — has them written inside once the
    // block needs marks inside its links (here, for the struck link before
    // a letter). Marks inside the links, a bare autolink's included.
    it('a marked bare autolink in a block writing marks inside its links: saved as the link it reads back as', () => {
        const build = (bare: boolean) => (): LexicalNode[] => {
            const autolink = link('http://www.d.test', [text('www.d.test', ['bold'])]);

            if (bare) {
                $setState(autolink, bareAutolinkState, true);
            }

            return [p(text('a b c', ['bold']), autolink, ' ', link('/p', [text('x', ['strikethrough'])]), 'y')];
        };
        const bareEditor = editorWith(build(true));
        const output = serialized(bareEditor);

        expect(output).toBe('**a b c**[**www\\.d.test**](http://www.d.test) [~~x~~](/p)y');
        expect(serialized(editorWith(build(false)))).toBe(output);
        expect(viewerModel(output).blocks).toEqual(editorSurfaceModel(bareEditor));
    });
});
