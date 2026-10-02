import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createLineBreakNode, $createParagraphNode, $createRangeSelection, $getRoot, $getSelection, $getState, $isElementNode, $isLineBreakNode,
    $isParagraphNode, $isRangeSelection, $isTextNode, $setSelection, $setState, $createTextNode, KEY_ENTER_COMMAND,
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, PASTE_COMMAND, DELETE_CHARACTER_COMMAND, FORMAT_TEXT_COMMAND, COMMAND_PRIORITY_LOW,
    UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, RangeSelection, TextNode } from 'lexical';
import { $createListItemNode, $createListNode, $isListNode, $isListItemNode } from '@lexical/list';
import type { ListNode } from '@lexical/list';
import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $isCodeNode } from '@lexical/code';
import { $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text';
import {
    $createTableCellNode, $createTableNode, $createTableRowNode, $createTableSelectionFrom, $isTableNode, $isTableRowNode, $isTableCellNode,
    $isTableSelection,
} from '@lexical/table';
import type { TableCellNode } from '@lexical/table';
import { $dfs, $findMatchingParent } from '@lexical/utils';
import { MarkdownEditor, $classifyContextMenuTarget } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorSelectionState } from '~/component/editor/MarkdownEditor';
import { $serializeMarkdown } from '~/component/editor/markdownSerializer';
import {
    bareAutolinkState, hardBreakMarkerState, imageAttributesState, listLooseState, listMarkerState, spanAttributesState,
} from '~/component/editor/markdownNodeState';
import {
    $createMarkdownRawBlockNode, $createMarkdownSourceTextNode, $isMarkdownRawBlockNode, $isMarkdownSourceTextNode,
} from '~/component/editor/markdownSourceNodes';
import { $isMarkdownBlockNode, $isMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $isMarkdownImageNode } from '~/component/editor/markdownImageNode';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, linkTargets, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** One inline node, summarised for comparison. */
type InlineSummary =
    | { text: string; format?: number; style?: string }
    | { source: string; display: string; format?: number }
    | { br: string }
    | { link: string; children: InlineSummary[] };

/**
 * Reaches the private headless Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Loads `source` into a fresh editor.
 *
 * @param source - The Markdown to load.
 * @returns The editor.
 */
function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/**
 * Runs `read` against the editor's document.
 *
 * @param editor - The editor.
 * @param read - What to read; runs inside `editor.read`.
 * @returns What `read` returns.
 */
function readDocument<T>(editor: MarkdownEditor, read: () => T): T {
    return lexicalOf(editor).read(read);
}

/**
 * The root's children's Lexical types.
 *
 * @param editor - The editor.
 * @returns One type per top-level node.
 */
function rootTypes(editor: MarkdownEditor): string[] {
    return readDocument(editor, () => $getRoot().getChildren().map((node) => node.getType()));
}

/**
 * Summarises inline nodes: text with its format and style when set, source nodes, breaks and links.
 *
 * @param nodes - The inline nodes.
 * @returns One summary per node.
 */
function summarize(nodes: LexicalNode[]): InlineSummary[] {
    return nodes.map((node): InlineSummary => {
        if ($isMarkdownSourceTextNode(node)) {
            return { source: node.getSource(), display: node.getTextContent(), ...(node.getFormat() === 0 ? {} : { format: node.getFormat() }) };
        }

        if ($isTextNode(node)) {
            return {
                text: node.getTextContent(),
                ...(node.getFormat() === 0 ? {} : { format: node.getFormat() }),
                ...(node.getStyle() === '' ? {} : { style: node.getStyle() }),
            };
        }

        if ($isLineBreakNode(node)) {
            return { br: $getState(node, hardBreakMarkerState) };
        }

        if ($isLinkNode(node)) {
            return { link: node.getURL(), children: summarize(node.getChildren()) };
        }

        throw new Error(`unexpected inline node ${node.getType()}`);
    });
}

/**
 * Summarises the inline children of the first top-level block.
 *
 * @param editor - The editor.
 * @returns The first block's inline summary.
 */
function firstBlockInline(editor: MarkdownEditor): InlineSummary[] {
    return readDocument(editor, () => summarize(($getRoot().getFirstChild() as ElementNode).getChildren()));
}

/**
 * The text of every top-level node.
 *
 * @param editor - The editor.
 * @returns One text per top-level node.
 */
function rootTexts(editor: MarkdownEditor): string[] {
    return readDocument(editor, () => $getRoot().getChildren().map((node) => node.getTextContent()));
}

/**
 * Asserts that the editor's surface shows what the viewer shows for `source`.
 *
 * @param editor - The editor `source` was loaded into.
 * @param source - The loaded Markdown.
 */
function expectSurface(editor: MarkdownEditor, source: string): void {
    expect(editorSurfaceModel(editor)).toEqual(viewerModel(source).blocks);
}

/** Lexical's bold format bit. */
const BOLD = 1;

/** Lexical's italic format bit. */
const ITALIC = 2;

/** Lexical's strikethrough format bit. */
const STRIKETHROUGH = 4;

const SOFT: InlineSummary = { source: '\n', display: ' ' };

describe('$importMarkdown — blocks and inline (I rows)', () => {
    it('I1: a soft break is a source node showing a space and saving a newline', () => {
        const editor = load('a\nb');

        expect(firstBlockInline(editor)).toEqual([{ text: 'a' }, SOFT, { text: 'b' }]);
        expectSurface(editor, 'a\nb');
    });

    it('I2: a soft break inside bold is bold', () => {
        const editor = load('**a\nb**');

        expect(firstBlockInline(editor)).toEqual([
            { text: 'a', format: BOLD }, { ...SOFT, format: BOLD }, { text: 'b', format: BOLD },
        ]);
        expectSurface(editor, '**a\nb**');
    });

    it('I3: a two-space hard break is a LineBreakNode keeping its marker', () => {
        const editor = load('foo  \nbar');

        expect(firstBlockInline(editor)).toEqual([{ text: 'foo' }, { br: '  ' }, { text: 'bar' }]);
        expectSurface(editor, 'foo  \nbar');
    });

    it('I4: a backslash hard break is a LineBreakNode keeping its marker', () => {
        const editor = load('foo\\\nbar');

        expect(firstBlockInline(editor)).toEqual([{ text: 'foo' }, { br: '\\' }, { text: 'bar' }]);
        expectSurface(editor, 'foo\\\nbar');
    });

    it('I5: a thematic break is a raw block', () => {
        const editor = load('***');

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(rootTexts(editor)).toEqual(['***']);
        expectSurface(editor, '***');
    });

    it('I6: an HTML block is one raw block', () => {
        const editor = load('<div>\nx\n</div>');

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(rootTexts(editor)).toEqual(['<div>\nx\n</div>']);
        expectSurface(editor, '<div>\nx\n</div>');
    });

    it('I7: a blockquote holding two paragraphs is one raw block', () => {
        const editor = load('> a\n>\n> b');

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(rootTexts(editor)).toEqual(['> a\n>\n> b']);
    });

    it('I8: a quote with a lazy continuation line is one quote', () => {
        const editor = load('> a quoted\nline');

        expect(rootTypes(editor)).toEqual(['quote']);
        expectSurface(editor, '> a quoted\nline');
    });

    it('I9: a loose list carries the loose state', () => {
        const editor = load('- a\n\n- b');

        expect(rootTypes(editor)).toEqual(['list']);
        expect(readDocument(editor, () => $getState($getRoot().getFirstChild() as ListNode, listLooseState))).toBe(true);
        expectSurface(editor, '- a\n\n- b');
    });

    it('I10: a list nested two spaces deep nests', () => {
        expectSurface(load('- a\n  - nested\n- c'), '- a\n  - nested\n- c');
    });

    it('I11: a list item holding two paragraphs makes the whole list one raw block', () => {
        const editor = load('- one\n\n  two');

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(rootTexts(editor)).toEqual(['- one\n\n  two']);
    });

    it('I12: indented code is a code node with no language', () => {
        const editor = load('    code\n');

        expect(readDocument(editor, () => {
            const node = $getRoot().getFirstChild();

            return $isCodeNode(node) ? [node.getLanguage() ?? null, node.getTextContent()] : null;
        })).toEqual([null, 'code']);
        expectSurface(editor, '    code\n');
    });

    it('I13: a tilde fence is a code node with its language', () => {
        const editor = load('~~~py\nx\n~~~');

        expect(readDocument(editor, () => {
            const node = $getRoot().getFirstChild();

            return $isCodeNode(node) ? node.getLanguage() : null;
        })).toBe('py');
        expectSurface(editor, '~~~py\nx\n~~~');
    });

    it('I14: a setext heading is a heading', () => {
        const editor = load('Title\n===');

        expect(readDocument(editor, () => {
            const node = $getRoot().getFirstChild();

            return $isHeadingNode(node) ? node.getTag() : null;
        })).toBe('h1');
        expectSurface(editor, 'Title\n===');
    });

    it('I15: underscore emphasis is italic and bold', () => {
        const editor = load('_u_ and __s__');

        expect(firstBlockInline(editor)).toEqual([{ text: 'u', format: ITALIC }, { text: ' and ' }, { text: 's', format: BOLD }]);
        expectSurface(editor, '_u_ and __s__');
    });

    it('I16: angle-bracket and bare autolinks are links', () => {
        const editor = load('<https://a.b> and https://c.d');

        expect(firstBlockInline(editor)).toEqual([
            { link: 'https://a.b', children: [{ text: 'https://a.b' }] },
            { text: ' and ' },
            { link: 'https://c.d', children: [{ text: 'https://c.d' }] },
        ]);
        expectSurface(editor, '<https://a.b> and https://c.d');
    });

    it('I17: a reference link is a link, and its definition a raw block', () => {
        const editor = load('[r][x]\n\n[x]: https://e.com');

        expect(rootTypes(editor)).toEqual(['paragraph', 'markdown-raw-block']);
        expect(firstBlockInline(editor)).toEqual([{ link: 'https://e.com', children: [{ text: 'r' }] }]);
        expect(rootTexts(editor)[1]).toBe('[x]: https://e.com');
    });

    it('I18: a duplicate definition marked drops is kept in its run\'s raw block', () => {
        // A run of definitions on consecutive lines is one raw block, so it saves with its lines as written.
        const editor = load('[a]\n\n[a]: https://one\n[a]: https://two');

        expect(rootTypes(editor)).toEqual(['paragraph', 'markdown-raw-block']);
        expect(rootTexts(editor).slice(1)).toEqual(['[a]: https://one\n[a]: https://two']);
    });

    it('I18 (definitions apart): definitions a blank line separates stay apart', () => {
        const source = '[a]: https://one\n\n[b]: https://two';

        expect(rootTypes(load(source))).toEqual(['markdown-raw-block', 'markdown-raw-block']);
        expect(load(source).getValue()).toBe(source);
    });

    it('I18 (a dropped definition before the next block): a token is only found where it starts and ends a line', () => {
        // `b`, `a` and `[x]` also occur inside the dropped definitions; matching there split them and repeated text.
        for (const [source, texts] of [
            ['[x]: /a\n[x]: /b\n\nb', ['[x]: /a\n[x]: /b', 'b']],
            ['[a]: https://one\n[a]: https://two\n\na', ['[a]: https://one\n[a]: https://two', 'a']],
            ['[x]: /u\n[x]: /v\n> - b', ['[x]: /u\n[x]: /v', '> - b']],
        ] as Array<[string, string[]]>) {
            const editor = load(source);

            expect(rootTexts(editor), source).toEqual(texts);
            expect(editor.getValue(), source).toBe(texts.join('\n\n'));
            expect(load(editor.getValue()).getValue(), source).toBe(editor.getValue());
        }

        // The definitions stay one run, the reference `[x]` keeps its form, and the dropped line is kept once.
        const editor = load('[x]: /v\n[x]: /u\n[x]');

        expect(rootTexts(editor)).toEqual(['[x]: /v\n[x]: /u', 'x']);
        expect(editor.getValue()).toBe('[x]: /v\n[x]: /u\n\n[x]');

        // A paragraph equal to the dropped definition but for whitespace: only an exact match anchors it. Its
        // shortcut reference starts the paragraph before a `:`, so it is written collapsed (else a definition).
        const spaced = load('[x]: /a\n[x]: </b> "t"\n\n[x]: </b>"t"');

        expect(rootTexts(spaced)).toEqual(['[x]: /a\n[x]: </b> "t"', 'x: </b>"t"']);
        expect(spaced.getValue()).toBe('[x]: /a\n[x]: </b> "t"\n\n[x][]: </b>"t"');
        expect(viewerModel(spaced.getValue())).toEqual(viewerModel('[x]: /a\n[x]: </b> "t"\n\n[x]: </b>"t"'));
    });

    it('I7 (a raw block\'s text): a blockquote whose raw marked rebuilt keeps its own source text', () => {
        // marked rebuilds the raw of a quote holding a list plus a lazy line (`> - a\n\n<b>`); the raw block must hold
        // the document's text, or the save moves the lazy line out of the quote.
        for (const [source, saved] of [
            ['> - a\n<b>', '> - a\n<b>'],
            ['> - not\nx  ', '> - not\nx  '],
            ['para\n\n> - a\nlazy\n\nafter', 'para\n\n> - a\nlazy\n\nafter'],
            // The next block repeats the lazy line: it must not be found inside the quote.
            ['> - a\n<b>\n\n<b>', '> - a\n<b>\n\n<b>'],
            // marked rebuilds these quotes' raw beyond whitespace (`> - - a…`): kept as source, written once.
            ['> - a\n> - b\nc\n\nz', '> - a\n> - b\nc\n\nz'],
            ['> - a\n>\n> - b\nc', '> - a\n>\n> - b\nc'],
            // A later copy of a rebuilt raw must not be matched instead of the token itself.
            ['> - a\n<b>\n\npara\n\n> - a\n\n<b>', '> - a\n<b>\n\npara\n\n> - a\n\n<b>'],
        ] as Array<[string, string]>) {
            const editor = load(source);
            const value = editor.getValue();

            expect(value, source).toBe(saved);
            expect(viewerModel(value), source).toEqual(viewerModel(source));
            expect(load(value).getValue(), source).toBe(value);
        }
    });

    it('I7/I11 (a dropped definition in a container): a quote or list holding one is kept as a raw block', () => {
        // marked emits no token for a repeated definition, so the container looks emptier than it is; building it from
        // its tokens would drop that line on save. No source is ever dropped.
        for (const source of ['[x]: /a\n\n> [x]: /b', '[x]: /a\n\n- [x]: /b\n- c', '[x]: /a\n\n- item\n\n  [x]: /b']) {
            const editor = load(source);

            expect(rootTypes(editor), source).toEqual(['markdown-raw-block', 'markdown-raw-block']);
            expect(editor.getValue(), source).toBe(source);
        }
    });

    it('I19: an image with a title is a source node showing its alt text', () => {
        const editor = load('![a](/u "t")');

        expect(firstBlockInline(editor)).toEqual([{ source: '![a](/u "t")', display: 'a' }]);
        expectSurface(editor, '![a](/u "t")');
    });

    it('I20: an image whose source the viewer rejects is a source node showing nothing, as the viewer renders nothing', () => {
        const source = '![a](data:image/svg+xml;base64,AAAA)';

        expect(firstBlockInline(load(source))).toEqual([{ source, display: '' }]);
    });

    it('I21: a task-list checkbox is a source node before the item text', () => {
        const editor = load('- [ ] task');

        expect(readDocument(editor, () => {
            const list = $getRoot().getFirstChild() as ListNode;

            return summarize((list.getFirstChild() as ElementNode).getChildren());
        })).toEqual([{ source: '[ ] ', display: '[ ] ' }, { text: 'task' }]);
    });

    it('I22: inline HTML tags are source nodes', () => {
        const editor = load('a <b>x</b> c');

        expect(firstBlockInline(editor)).toEqual([
            { text: 'a ' }, { source: '<b>', display: '<b>' }, { text: 'x' }, { source: '</b>', display: '</b>' }, { text: ' c' },
        ]);
        expectSurface(editor, 'a <b>x</b> c');
    });

    it('I23: a table cell\'s paragraph break splits it into two paragraphs', () => {
        // The cell paragraph break is the four characters `\n\n` (the serializer's Implementation Notes), not one `\n`.
        const source = '| a |\n| --- |\n| x\\n\\ny |';
        const editor = load(source);

        expect(readDocument(editor, () => {
            const table = $getRoot().getFirstChild();
            const bodyRow = $isTableNode(table) ? table.getChildren().filter($isTableRowNode)[1] : undefined;
            const bodyCell = bodyRow?.getChildren().filter($isTableCellNode)[0];

            return bodyCell?.getChildren().map((paragraph) => paragraph.getTextContent());
        })).toEqual(['x', 'y']);
        expectSurface(editor, source);
    });

    it('I24: the legacy {columns=2} attribute keeps its fence, with no align, no gap and one column', () => {
        const source = '::: {columns=2}\nold\n:::';
        const editor = load(source);

        expect(readDocument(editor, () => {
            const fence = $getRoot().getFirstChild();

            return $isMarkdownBlockNode(fence)
                ? [fence.getAlign(), fence.getColumnGap(), fence.getChildren().filter($isMarkdownColumnNode).length]
                : null;
        })).toEqual([null, null, 1]);
        expectSurface(editor, source);
    });

    it('I25: a styled span styles every run inside it', () => {
        const editor = load('[x **b**]{color=red}');

        expect(firstBlockInline(editor)).toEqual([
            { text: 'x ', style: 'color: red' }, { text: 'b', format: BOLD, style: 'color: red' },
        ]);
        expectSurface(editor, '[x **b**]{color=red}');
    });

    it('I26: a link nested in a link wins, and the outer link reopens after it', () => {
        const editor = load('[a [b](/2) c](/1)');

        expect(firstBlockInline(editor)).toEqual([
            { link: '/1', children: [{ text: 'a ' }] },
            { link: '/2', children: [{ text: 'b' }] },
            { link: '/1', children: [{ text: ' c' }] },
        ]);
        expectSurface(editor, '[a [b](/2) c](/1)');
    });

    it('I27: the empty string is one empty paragraph, and CRLF reads as LF', () => {
        const empty = load('');

        expect(rootTypes(empty)).toEqual(['paragraph']);
        expect(rootTexts(empty)).toEqual(['']);
        expect(firstBlockInline(load('a\r\nb'))).toEqual(firstBlockInline(load('a\nb')));
    });

    it('I28: an entity stays text and an escape is its character, in one text node', () => {
        const editor = load('&amp; \\*');

        expect(firstBlockInline(editor)).toEqual([{ text: '&amp; *' }]);
        expectSurface(editor, '&amp; \\*');
    });
});

describe('$importMarkdown — authored list markers (addition to the plan)', () => {
    /**
     * Reads the marker state of the first top-level list.
     *
     * @param editor - The editor.
     * @returns The list's marker state.
     */
    function firstListMarker(editor: MarkdownEditor): string {
        return readDocument(editor, () => {
            const list = $getRoot().getFirstChild();

            return $isListNode(list) ? $getState(list, listMarkerState) : 'not a list';
        });
    }

    it('LM1: a * bullet list keeps its marker and saves with it', () => {
        const editor = load('* a\n* b');

        expect(firstListMarker(editor)).toBe('*');
        expect(editor.getValue()).toBe('* a\n* b');
    });

    it('LM2: a + bullet list keeps its marker and saves with it', () => {
        const editor = load('+ a');

        expect(firstListMarker(editor)).toBe('+');
        expect(editor.getValue()).toBe('+ a');
    });

    it('LM3: an ordered list keeps its ) delimiter and saves with it', () => {
        const editor = load('1) x\n2) y');

        expect(firstListMarker(editor)).toBe(')');
        expect(editor.getValue()).toBe('1) x\n2) y');
    });

    it('LM4: a nested list keeps its own marker', () => {
        const editor = load('* a\n  + b');

        expect(readDocument(editor, () => {
            const list = $getRoot().getFirstChild() as ListNode;
            const nested = list.getChildren().filter($isListItemNode).flatMap((item) => item.getChildren()).find($isListNode);

            return nested === undefined ? null : $getState(nested, listMarkerState);
        })).toBe('+');
        expect(editor.getValue()).toBe('* a\n  + b');
    });

    it('LM5: a - list and a . list save with their own markers', () => {
        expect(load('- a').getValue()).toBe('- a');
        expect(load('3. a').getValue()).toBe('3. a');
    });
});

describe('$importMarkdown — authored autolink and span forms (whole-stack review fix)', () => {
    it('a bare autolink is marked bare; an angle-bracket or inline one is not', () => {
        const states = readDocument(load('www.x.test <https://x.test> [www.x.test](http://www.x.test)'), () => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;

            return paragraph.getChildren().filter($isLinkNode).map((link) => $getState(link, bareAutolinkState));
        });

        expect(states).toEqual([true, false, false]);
    });

    it('a styled span\'s text keeps the span\'s authored attribute text', () => {
        const attributes = readDocument(load('[a]{size=2em bogus=1 color=red} b'), () => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;

            return paragraph.getChildren().filter($isTextNode).map((node) => $getState(node, spanAttributesState));
        });

        expect(attributes).toEqual(['size=2em bogus=1 color=red', '']);
    });

    it('an image keeps its authored attribute text', () => {
        const attributes = readDocument(load('![](g){height=2 width=3 bogus=1} ![](h)'), () => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;

            return paragraph.getChildren().filter($isMarkdownImageNode).map((node) => $getState(node, imageAttributesState));
        });

        expect(attributes).toEqual(['height=2 width=3 bogus=1', '']);
    });

    const rows: Array<[string, string]> = [
        ['an image\'s attributes in authored order, an invalid and an unknown one', '# a ![](g){height=2 width=3} ![](h){width=x} ![](i){bogus=1}'],
        ['a bare URL and www. address inside emphasis before a word', '*http://e*4 x **www.e.test**9'],
        ['a www. autolink in a heading', '### www.x.test'],
        ['a bare URL and email address', 'see https://x.test/a_b or a@x.test now'],
        ['an angle-bracket autolink', '### <https://x.test>'],
        ['a span with its attributes in authored order and an unknown one', '## [a]{size=2em bogus=1 color=red} [b]{bogus=1}'],
    ];

    for (const [name, source] of rows) {
        it(`${name} saves unchanged, so a heading keeps its id`, () => {
            expect(load(source).getValue()).toBe(source);
        });
    }

    it('an inline link whose text is a www. address stays an inline link', () => {
        expect(load('### [www.x.test](http://www.x.test)').getValue()).toBe('### [www\\.x.test](http://www.x.test)');
    });
});

describe('$importMarkdown — round trips (R rows)', () => {
    const rows: Array<[string, string, string]> = [
        ['R1', '_x_', '*x*'],
        ['R2', 'Title\n===', '# Title'],
        ['R3', '    code', '```\ncode\n```'],
        ['R4', '***', '***'],
        ['R5', 'https://c.d', 'https://c.d'],
        ['R6', '1\\. x', '1\\. x'],
        ['R7', '&#35; x', '&#35; x'],
        ['R8', '[r][x]\n\n[x]: https://e.com', '[r][x]\n\n[x]: https://e.com'],
        ['R9', '- a\n  - b', '- a\n  - b'],
        ['R10', 'a\r\nb', 'a\nb'],
        ['R11', 'foo  \nbar', 'foo  \nbar'],
        ['R12', 'foo\\\nbar', 'foo\\\nbar'],
        ['setext heading with a hard break', 'Foo  \nbar\n===', 'Foo  \nbar\n==='],
        ['single-item loose list', '- a\n\n  - b', '- a\n\n  - b'],
        // A source run leading or ending a line keeps the whitespace around it, so marked parses it as before.
        ['indented inline html after a soft break', 'a\n  <div>', 'a\n  <div>'],
        ['indented inline html in bold after a soft break', '**a\n  <div>**', '**a\n  <div>**'],
        ['indented inline html after a hard break', 'a  \n  <div>', 'a  \n  <div>'],
        ['space after a line-ending source run', '![i](javascript:x)\n<b> \n| a | b |\n===', '![i](javascript:x)\n<b> \n\\| a | b |\n==='],
        // An item holding only a nested list is written on its marker's line, as authored.
        ['item holding only a nested list, second', '- a\n- - b', '- a\n- - b'],
        ['item holding only a nested list, first', '- - b\n- a', '- - b\n- a'],
        // A raw block's common indentation is dropped, so it cannot join a list written at column 0.
        ['indented thematic break after an indented list', '  - n\n\n  ***', '- n\n\n***'],
        ['indented html after an indented list', '  - n\n\n  <div>x</div>', '- n\n\n<div>x</div>'],
        ['indented thematic break after an indented ordered list', '   1. a\n\n   ***', '1. a\n\n***'],
        ['indented html block after an indented list', '  - n\n\n  <div>\n[x]: /v\n***', '- n\n\n<div>\n[x]: /v\n***'],
        ['indented html block lazily after an indented list', '  - n\n  <div>\n- item', '- n\n\n<div>\n- item'],
    ];

    for (const [id, source, saved] of rows) {
        it(`${id}: ${JSON.stringify(source)} saves as ${JSON.stringify(saved)}`, () => {
            expect(load(source).getValue()).toBe(saved);
            expect(viewerModel(saved)).toEqual(viewerModel(source));
            expect(load(saved).getValue()).toBe(saved);
        });
    }
});

describe('$importMarkdown — structure details', () => {
    it('a raw block holds one text node per line with line breaks between', () => {
        const editor = load('> a\n>\n> b');

        expect(readDocument(editor, () => {
            const raw = $getRoot().getFirstChild();

            return $isElementNode(raw) ? raw.getChildren().map((node) => node.getType()) : null;
        })).toEqual(['text', 'linebreak', 'text', 'linebreak', 'text']);
    });
});

describe('MarkdownSourceTextNode and MarkdownRawBlockNode', () => {
    it('a source node keeps its source when Lexical clones it for a write', () => {
        const editor = load('a <b>x</b> c');

        lexicalOf(editor).update(() => {
            const node = ($getRoot().getFirstChild() as ElementNode).getChildren()[1]!;

            node.getWritable();
        }, { discrete: true });

        expect(firstBlockInline(editor)[1]).toEqual({ source: '<b>', display: '<b>' });
        expect(editor.getValue()).toBe('a <b>x</b> c');
    });

    it('a source node keeps its display text whatever text Lexical writes into it, as TabNode does', () => {
        const editor = load('a <b>x</b> c');

        lexicalOf(editor).update(() => {
            const node = ($getRoot().getFirstChild() as ElementNode).getChildren()[1]!;

            if ($isMarkdownSourceTextNode(node)) {
                node.setTextContent('typed');
            }
        }, { discrete: true });

        expect(firstBlockInline(editor)[1]).toEqual({ source: '<b>', display: '<b>' });
    });

    it('both nodes survive a JSON round trip of the editor state (the copy-paste and history path)', () => {
        const source = 'a\nb <i>c</i>\n\n***';
        const editor = load(source);
        const lexical = lexicalOf(editor);
        const saved = editor.getValue();
        const restored = load('');

        lexicalOf(restored).setEditorState(lexicalOf(restored).parseEditorState(JSON.stringify(lexical.getEditorState().toJSON())));

        expect(rootTypes(restored)).toEqual(['paragraph', 'markdown-raw-block']);
        expect(firstBlockInline(restored)).toEqual(firstBlockInline(editor));
        expect(restored.getValue()).toBe(saved);
    });

    it('a source node is created in token mode, so Backspace deletes it whole', () => {
        const editor = load('');
        let token = false;

        lexicalOf(editor).update(() => {
            token = $createMarkdownSourceTextNode(' ', '\n').isToken();
        }, { discrete: true });

        expect(token).toBe(true);
    });

    it('Backspace at the start of an empty raw block removes it and keeps the next block', () => {
        const editor = load('');
        let removed = false;

        lexicalOf(editor).update(() => {
            const raw = $createMarkdownRawBlockNode('');
            const next = $createParagraphNode();

            $getRoot().clear();
            $getRoot().append(raw, next);
            removed = raw.collapseAtStart();
        }, { discrete: true });

        expect(removed).toBe(true);
        expect(rootTypes(editor)).toEqual(['paragraph']);
    });

    it('Backspace at the start of a raw block with text keeps it', () => {
        const editor = load('***\n\npara');
        let removed = true;

        lexicalOf(editor).update(() => {
            const raw = $getRoot().getFirstChild();

            removed = $isMarkdownRawBlockNode(raw) ? raw.collapseAtStart() : true;
        }, { discrete: true });

        expect(removed).toBe(false);
        expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
    });
});

describe('editing raw blocks and source nodes', () => {
    /**
     * Places a collapsed caret, then runs an edit in a separate update, as a keystroke does.
     *
     * @param editor - The editor.
     * @param place - Returns the caret's node key and offset; runs inside an update.
     * @param edit - The edit, run against the selection in the next update.
     */
    function editAt(editor: MarkdownEditor, place: () => [string, number], edit: () => void): void {
        lexicalOf(editor).update(() => {
            const [key, offset] = place();
            const selection = $createRangeSelection();

            selection.anchor.set(key, offset, 'text');
            selection.focus.set(key, offset, 'text');
            $setSelection(selection);
        }, { discrete: true });

        lexicalOf(editor).update(edit, { discrete: true });
    }

    /**
     * The key of the first block's `index`-th child.
     *
     * @param index - The child index.
     * @returns The child's key.
     */
    function firstBlockChildKey(index: number): string {
        return ($getRoot().getFirstChild() as ElementNode).getChildren()[index]!.getKey();
    }

    /**
     * Presses Enter (or Shift+Enter) as the keyboard does: dispatches `KEY_ENTER_COMMAND`, then, when no
     * handler took it, does what `registerRichText`'s handler does: a paragraph, or a line break with Shift.
     *
     * @param editor - The editor.
     * @param shiftKey - Whether Shift is held.
     */
    function pressEnter(editor: MarkdownEditor, shiftKey: boolean = false): void {
        lexicalOf(editor).update(() => {
            const handled = lexicalOf(editor).dispatchCommand(
                KEY_ENTER_COMMAND, { altKey: false, shiftKey, preventDefault: () => {} } as KeyboardEvent);
            const selection = $getSelection();

            if (!handled && $isRangeSelection(selection)) {
                if (shiftKey) {
                    selection.insertLineBreak();
                } else {
                    selection.insertParagraph();
                }
            }
        }, { discrete: true });
    }

    /**
     * Places a collapsed caret in the first block's `index`-th child.
     *
     * @param editor - The editor.
     * @param index - The child index.
     * @param offset - The caret's offset in that child.
     */
    function placeCaret(editor: MarkdownEditor, index: number, offset: number): void {
        editAt(editor, () => [firstBlockChildKey(index), offset], () => {});
    }

    /** Runs Shift+Enter's edit: a line break at the selection. */
    function pressShiftEnter(): void {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
            selection.insertLineBreak();
        }
    }

    /**
     * Types one character at the selection.
     *
     * @param char - The character.
     * @returns The edit.
     */
    function type(char: string): () => void {
        return () => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertText(char);
            }
        };
    }

    it('Enter in the middle of a raw block inserts a line break in the block', () => {
        const editor = load('<div>\nxy\n</div>');

        placeCaret(editor, 2, 1);
        pressEnter(editor);

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<div>\nx\ny\n</div>');
    });

    it('Enter at the start of a raw block inserts an empty paragraph before it', () => {
        const editor = load('<div>\nx\n</div>');

        placeCaret(editor, 0, 0);
        pressEnter(editor);

        expect(rootTypes(editor)).toEqual(['paragraph', 'markdown-raw-block']);
        expect(rootTexts(editor)).toEqual(['', '<div>\nx\n</div>']);
    });

    it('Enter at the end of a raw block starts a paragraph after it', () => {
        const editor = load('***');

        placeCaret(editor, 0, 3);
        pressEnter(editor);

        expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
        expect(editor.getValue()).toBe('***');
    });

    /**
     * Pastes nodes as the clipboard does: dispatches `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`, then, when no
     * handler took it, inserts them with `insertNodes`, as `@lexical/clipboard`'s `$insertGeneratedNodes` does.
     *
     * @param editor - The editor.
     * @param build - Creates the pasted nodes; runs inside the update.
     */
    function paste(editor: MarkdownEditor, build: () => LexicalNode[]): void {
        lexicalOf(editor).update(() => {
            const selection = $getSelection()!;
            const nodes = build();
            const handled = lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection });

            if (!handled) {
                selection.insertNodes(nodes);
            }
        }, { discrete: true });
    }

    /** Two pasted paragraphs, `P1` and `P2`. */
    function twoParagraphs(): LexicalNode[] {
        return [$createParagraphNode().append($createTextNode('P1')), $createParagraphNode().append($createTextNode('P2'))];
    }

    it('blocks pasted in the middle of a raw block go in at the caret as raw text', () => {
        const editor = load('<div>\nx\n</div>');

        placeCaret(editor, 0, 3);
        paste(editor, twoParagraphs);

        // The raw text now reads as two paragraphs and an HTML block, which the editor shows.
        expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph', 'markdown-raw-block']);
        expect(viewerModel(editor.getValue())).toEqual(viewerModel('<diP1\n\nP2v>\nx\n</div>'));
    });

    it('blocks pasted into a paragraph still insert as blocks (the raw-block paste leaves other blocks alone)', () => {
        const editor = load('ab');

        placeCaret(editor, 0, 1);
        paste(editor, twoParagraphs);

        expect(editor.getValue()).toBe('aP1\n\nP2b');
    });

    it('a paragraph inserted in the middle of a raw block splits it into the blocks its two pieces read as', () => {
        const editor = load('<div>\nx\n</div>');

        editAt(editor, () => [firstBlockChildKey(0), 3], () => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertParagraph();
            }
        });

        // The first piece reads as a paragraph, the second as a paragraph and an HTML block, which the editor shows.
        expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph', 'markdown-raw-block']);
        expect(viewerModel(editor.getValue())).toEqual(viewerModel('<di\n\nv>\nx\n\n</div>'));
    });

    it('Enter with the caret inside a source node keeps the node whole and breaks after it', () => {
        const editor = load('a <span class="k">x</span> c');

        placeCaret(editor, 1, 3);
        pressEnter(editor);

        expect(editor.getValue()).toBe('a <span class="k">\n\nx</span> c');
    });

    it('Shift+Enter with the caret inside a source node keeps the node whole and breaks after it', () => {
        const editor = load('a <span class="k">x</span> c');

        placeCaret(editor, 1, 3);
        pressEnter(editor, true);

        expect(editor.getValue()).toBe('a <span class="k">\\\nx</span> c');
    });

    it('toggleLink over a selection starting inside a source node is declined, leaving the node whole', () => {
        const editor = load('a <span class="k">x</span> c');

        lexicalOf(editor).update(() => {
            const children = ($getRoot().getFirstChild() as ElementNode).getChildren();
            const selection = $createRangeSelection();

            selection.anchor.set(children[1]!.getKey(), 3, 'text');
            selection.focus.set(children[2]!.getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });

        expect(() => editor.toggleLink('https://x.y')).not.toThrow();
        expect(editor.getValue()).toBe('a <span class="k">x</span> c');
        expect(firstBlockInline(editor)).toContainEqual({ source: '<span class="k">', display: '<span class="k">' });
    });

    /**
     * Appends text to the end of the first block and places the caret after it.
     *
     * @param editor - The editor.
     * @param text - The text to append.
     */
    function appendToFirstBlock(editor: MarkdownEditor, text: string): void {
        lexicalOf(editor).update(() => {
            const block = $getRoot().getFirstChild() as ElementNode;
            const node = $createTextNode(text);

            block.append(node);
            node.select(text.length, text.length);
        }, { discrete: true });
    }

    /** Types `*` at the selection, as a keystroke does, in its own update. */
    function typeStar(editor: MarkdownEditor): void {
        lexicalOf(editor).update(type('*'), { discrete: true });
    }

    it('a typing shortcut applies in a paragraph (control for the next case)', () => {
        const editor = load('');

        appendToFirstBlock(editor, 'a **b*');
        typeStar(editor);

        expect(firstBlockInline(editor)).toEqual([{ text: 'a ' }, { text: 'b', format: BOLD }]);
        expect(editor.getValue()).toBe('a **b**');
    });

    it('a typing shortcut does not apply in a raw block, whose text is saved as typed', () => {
        const editor = load('<div>');

        appendToFirstBlock(editor, ' **b*');
        typeStar(editor);

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<div> **b**');
    });

    /**
     * Places a selection over the first block's text, from `[anchorIndex, anchorOffset]` to `[focusIndex, focusOffset]`.
     *
     * @param editor - The editor.
     * @param anchor - The anchor's child index and offset.
     * @param focus - The focus's child index and offset.
     */
    function selectInFirstBlock(editor: MarkdownEditor, anchor: [number, number], focus: [number, number]): void {
        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();

            selection.anchor.set(firstBlockChildKey(anchor[0]), anchor[1], 'text');
            selection.focus.set(firstBlockChildKey(focus[0]), focus[1], 'text');
            $setSelection(selection);
        }, { discrete: true });
    }

    /**
     * Whether any text node of the document carries a format or a style, or the document holds a link or an image.
     *
     * @param editor - The editor.
     * @returns `true` when anything in the document is formatted, linked or an image.
     */
    function holdsFormatting(editor: MarkdownEditor): boolean {
        return readDocument(editor, () => $dfs().some(({ node }) =>
            ($isTextNode(node) && (node.getFormat() !== 0 || node.getStyle() !== ''))
            || $isLinkNode(node) || $isMarkdownImageNode(node)));
    }

    it('formatting and inserting inside a raw block are declined, so nothing the block cannot save is added', () => {
        const editor = load('<!--\nx\n-->');

        placeCaret(editor, 2, 1);
        pressEnter(editor);
        editor.toggleBold();
        editor.toggleItalic();
        editor.toggleInlineCode();
        editor.toggleStrikethrough();
        editor.toggleUnderline();
        editor.setTextColor('#cc0000');
        editor.setFontFamily('serif');
        editor.setFontSize('2em');
        editor.insertImage('https://x.test/i.png');
        editor.insertTable(2, 2);

        expect(holdsFormatting(editor)).toBe(false);
        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<!--\nx\n\n-->');
    });

    it('a link applied to a selection inside a raw block is declined', () => {
        const editor = load('___');

        selectInFirstBlock(editor, [0, 0], [0, 3]);
        editor.toggleLink('https://u.test');

        expect(holdsFormatting(editor)).toBe(false);
        expect(editor.getValue()).toBe('___');
    });

    it('a format command reaching a raw block from the keyboard (FORMAT_TEXT_COMMAND) is declined', () => {
        const editor = load('<div>\nx\n</div>');

        selectInFirstBlock(editor, [0, 0], [0, 5]);
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
        }, { discrete: true });

        expect(holdsFormatting(editor)).toBe(false);
        expect(editor.getValue()).toBe('<div>\nx\n</div>');
    });

    it('a format toggle over a selection reaching from a paragraph into a raw block is declined', () => {
        const editor = load('para\n\n***');

        lexicalOf(editor).update(() => {
            const [paragraph, raw] = $getRoot().getChildren() as ElementNode[];
            const selection = $createRangeSelection();

            selection.anchor.set(paragraph!.getFirstChild()!.getKey(), 0, 'text');
            selection.focus.set(raw!.getFirstChild()!.getKey(), 3, 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.toggleBold();

        expect(holdsFormatting(editor)).toBe(false);
        expect(editor.getValue()).toBe('para\n\n***');
    });

    it('formatting a paragraph still applies (control for the raw-block guards)', () => {
        const editor = load('para');

        selectInFirstBlock(editor, [0, 0], [0, 4]);
        editor.toggleBold();

        expect(editor.getValue()).toBe('**para**');
    });

    /**
     * Pastes plain text as the browser's paste event does: dispatches `PASTE_COMMAND` with clipboard data holding
     * only `text/plain`. (`registerRichText`'s own paste handler, which inserts a paragraph per newline, needs the
     * browser's event classes, so a case that reaches it registers a probe ahead of it.)
     *
     * @param editor - The editor.
     * @param text - The pasted text.
     */
    function pastePlainText(editor: MarkdownEditor, text: string): void {
        const clipboardData = { getData: (type: string): string => (type === 'text/plain' ? text : '') };
        const event = { clipboardData, preventDefault: () => {} } as unknown as ClipboardEvent;

        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(PASTE_COMMAND, event);
        }, { discrete: true });
    }

    it('plain text pasted into a raw block goes in as lines of the block', () => {
        const editor = load('<div>\nx\n</div>');

        placeCaret(editor, 2, 1);
        pastePlainText(editor, 'a\nb');

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<div>\nxa\nb\n</div>');
    });

    it('plain text pasted into a paragraph is left to rich text\'s own paste (control for the raw-block paste)', () => {
        const editor = load('xy');
        let reachedRichText = false;

        lexicalOf(editor).registerCommand(PASTE_COMMAND, () => {
            reachedRichText = true;

            return true;
        }, COMMAND_PRIORITY_LOW);
        placeCaret(editor, 0, 1);
        pastePlainText(editor, 'a\nb');

        expect(reachedRichText).toBe(true);
        expect(editor.getValue()).toBe('xy');
    });

    it('Backspace at the start of a paragraph after a raw block merges the paragraph in as its Markdown', () => {
        const editor = load('<div>x</div>\n\n**b** and \\*star\\*');

        lexicalOf(editor).update(() => {
            ($getRoot().getChildren()[1] as ElementNode).selectStart();
        }, { discrete: true });
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        }, { discrete: true });

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<div>x</div>**b** and \\*star\\*');
        expect(readDocument(editor, () => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? selection.anchor.getNode().getTextContent().slice(0, selection.anchor.offset) : null;
        })).toBe('<div>x</div>');
    });

    it('Delete at the end of a raw block merges the paragraph after it in as its Markdown', () => {
        const editor = load('<div>x</div>\n\n**b** and \\*star\\*');

        placeCaret(editor, 0, 12);
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, false);
        }, { discrete: true });

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe('<div>x</div>**b** and \\*star\\*');
    });

    it('Backspace at the start of a paragraph after another paragraph still merges as text (control)', () => {
        const editor = load('a\n\n**b**');

        lexicalOf(editor).update(() => {
            ($getRoot().getChildren()[1] as ElementNode).selectStart();
        }, { discrete: true });
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
        }, { discrete: true });

        expect(editor.getValue()).toBe('a**b**');
    });
});

describe('$importMarkdown — whole-stack review fixes: no source dropped', () => {
    /**
     * Types `text` at the end of a top-level block, as a keystroke does, so the block saves as edited.
     *
     * @param editor - The editor.
     * @param index - The block's index among the root's children.
     * @param text - The text to type.
     */
    function typeAtEnd(editor: MarkdownEditor, index: number, text: string): void {
        lexicalOf(editor).update(() => {
            const block = $getRoot().getChildren()[index] as ElementNode;
            const last = block.getLastDescendant();

            if ($isTextNode(last)) {
                last.select(last.getTextContentSize(), last.getTextContentSize());
            } else {
                block.selectEnd();
            }

            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertText(text);
            }
        }, { discrete: true });
    }

    it('a link with empty text is a source node showing nothing and saving its source', () => {
        const editor = load('a [](u) b');

        expect(firstBlockInline(editor)).toEqual([{ text: 'a ' }, { source: '[](u)', display: '' }, { text: ' b' }]);
        expectSurface(editor, 'a [](u) b');
        typeAtEnd(editor, 0, '!');
        expect(editor.getValue()).toBe('a [](u) b!');
    });

    const blankLinks: Array<[string, string, string]> = [
        ['at the end of a paragraph', 'a [ ](u)', '[ ](u)'],
        ['at the start of a paragraph', '[ ](u) a', '[ ](u)'],
        ['around a soft break, in emphasis, at the end of a paragraph', '4\n*[  \n]()*', '*[  \n]()*'],
        ['around a soft break, before a code block', '4\n*[  \n]()* \n\n```\ncode\n```', '*[  \n]()*'],
        ['beside links nested in it, at the end of a paragraph', '[[a](/1)[b](/2)    ](/o)', '[[a](/1)[b](/2)    ](/o)'],
        ['beside a link nested in it, at the start of a paragraph', 'x\n\n[  [a](/1)](/o) b', '[  [a](/1)](/o)'],
    ];

    for (const [name, source, link] of blankLinks) {
        it(`a link whose text is only whitespace ${name} is kept: its source is saved`, () => {
            const editor = load(source);

            expect(editor.getValue()).toContain(link);
            expect(editorSurfaceModel(editor)).toEqual(viewerModel(source).blocks);
            expect(viewerModel(editor.getValue()).blocks).toEqual(viewerModel(source).blocks);
        });
    }

    it('a link with whitespace between the links nested in it, at a paragraph\'s start, keeps its link node', () => {
        // Only whitespace at the link's own edge is trimmed there; an empty link beside the space stays its own source node.
        const editor = load('[<https://a.test/x> [](https://e.test/y)](/o) z');

        expect(firstBlockInline(editor)).toEqual([
            { link: 'https://a.test/x', children: [{ text: 'https://a.test/x' }] },
            { link: '/o', children: [{ text: ' ' }, { source: '[](https://e.test/y)', display: '' }] },
            { text: ' z' },
        ]);
    });

    it('a link whose text is only whitespace at a paragraph\'s end keeps its source when text is typed after it', () => {
        const editor = load('a [ ](u)');

        typeAtEnd(editor, 0, '!');

        expect(editor.getValue()).toBe('a [ ](u)!');
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks);
    });

    it('an empty link keeps the formatting around it', () => {
        const editor = load('a **[](u)** b');

        expect(firstBlockInline(editor)[1]).toEqual({ source: '[](u)', display: '', format: BOLD });
        typeAtEnd(editor, 0, '!');
        expect(editor.getValue()).toBe('a **[](u)** b!');
    });

    const nested: Array<[string, string, string, string, number | undefined]> = [
        ['an autolink inside a link', '[<https://a/x>](/p/y) z', 'https://a/x', 'https://a/x', undefined],
        ['a link inside a link', '[[a](/in)](/out) z', 'a', '/in', undefined],
        ['a link inside emphasis inside a link', '[**[a](/in)**](/out) z', 'a', '/in', BOLD],
    ];

    for (const [name, source, display, href, format] of nested) {
        it(`${name} is one source node inside the nested link's target, showing its text and saving the whole link`, () => {
            const editor = load(source);
            const raw = source.slice(0, -' z'.length);

            expect(firstBlockInline(editor)).toEqual([{ link: href, children: [{ source: raw, display, ...(format === undefined ? {} : { format }) }] }, { text: ' z' }]);
            expectSurface(editor, source);
            typeAtEnd(editor, 0, '!');
            expect(editor.getValue()).toBe(`${source}!`);
            expect(linkTargets(viewerModel(editor.getValue()))).toEqual(linkTargets(viewerModel(source)));
        });
    }

    it('a table whose body row has more cells than its header is kept as a raw block', () => {
        const source = '| a |\n| - |\n| b | c |';
        const editor = load(source);

        expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
        expect(editor.getValue()).toBe(source);
    });

    it('a table whose extra body cells are empty is still a table', () => {
        expect(rootTypes(load('| a |\n| - |\n| b |  |'))).toEqual(['table']);
    });
});

describe('$importMarkdown — whole-stack review fixes: code blocks', () => {
    const rows: Array<[string, string]> = [
        ['a code block ending in a blank line', '```\nx\n\n```'],
        ['a code block ending in two blank lines', '```\nx\n\n\n```'],
    ];

    for (const [name, source] of rows) {
        it(`${name} keeps its blank lines across saves`, () => {
            const saved = load(source).getValue();

            expect(saved).toBe(source);
            expect(load(saved).getValue()).toBe(source);
        });
    }
});

describe('$importMarkdown — whole-stack review fixes: an HTML block that runs on', () => {
    /**
     * Appends a paragraph holding `text` after the root's last block, as Enter at the end and typing do.
     *
     * @param editor - The editor.
     * @param text - The paragraph's text.
     */
    function appendParagraph(editor: MarkdownEditor, text: string): void {
        lexicalOf(editor).update(() => {
            $getRoot().append($createParagraphNode().append($createTextNode(text)));
        }, { discrete: true });
    }

    /**
     * The viewer's blocks for `markdown`, reduced to each block's kind and text, as a reader sees them.
     *
     * @param markdown - The Markdown.
     * @returns One `kind: text` entry per block.
     */
    function viewedBlocks(markdown: string): string[] {
        return viewerModel(markdown).blocks.map((block) => {
            const runs = 'runs' in block ? block.runs.map((run) => (run.kind === 'text' ? run.text : run.kind)).join('|') : '';

            return `${block.kind}: ${block.kind === 'raw' ? block.text : runs}`;
        });
    }

    const unclosed: Array<[string, string, string]> = [
        ['an unclosed comment', '<!-- note', 'paragraph: <!-- note'],
        ['an unclosed pre', '<pre>\nx', 'paragraph: <pre>|break|x'],
        ['an unclosed script', '<script>\nx', 'paragraph: <script>|break|x'],
    ];

    for (const [name, source, shown] of unclosed) {
        it(`${name} at the end saves as written while nothing follows it`, () => {
            expect(load(source).getValue()).toBe(source);
        });

        it(`${name} followed by a new block saves so the block after it stays its own`, () => {
            const editor = load(source);

            appendParagraph(editor, 'new');

            const saved = editor.getValue();

            expect(viewedBlocks(saved)).toEqual([shown, 'paragraph: new']);
            expect(load(saved).getValue()).toBe(saved);
        });
    }

    it('a raw block edited into an unclosed comment does not swallow the block after it', () => {
        const editor = load('<!-- x -->\n\nb');

        lexicalOf(editor).update(() => {
            const text = ($getRoot().getFirstChild() as ElementNode).getFirstChild();

            if ($isTextNode(text)) {
                text.setTextContent('<!-- x>');
            }
        }, { discrete: true });
        typeAtEnd(editor, 1, '!');

        const saved = editor.getValue();

        expect(saved).toBe('\\<!-- x>\n\nb!');
        expect(viewedBlocks(saved)).toEqual(['paragraph: <!-- x>', 'paragraph: b!']);
    });

    it('an unclosed comment followed only by an empty paragraph saves as written', () => {
        const editor = load('<!-- note');

        lexicalOf(editor).update(() => {
            $getRoot().append($createParagraphNode());
        }, { discrete: true });

        expect(editor.getValue()).toBe('<!-- note');
    });

    it('an HTML block a blank line ends saves as written when a block follows it', () => {
        const editor = load('<div>\nx');

        appendParagraph(editor, 'new');

        expect(editor.getValue()).toBe('<div>\nx\n\nnew');
    });

    it('an HTML block whose start tag ends its line shows as the raw block it is and stays apart from the block after it', () => {
        // `marked` spends the tag line's own newline on the start condition, so one blank line does not end
        // the block: it is ended by a second one, as it was loaded.
        const source = '<details\n\n\n</details>';
        const editor = load(source);

        expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'markdown-raw-block']);
        expect(editor.getValue()).toBe(source);
        expect(viewedBlocks(editor.getValue())).toEqual(['raw: <details', 'raw: </details>']);
    });

    it('an HTML block whose start tag ends its line, followed by a new block, keeps the block after it its own', () => {
        const editor = load('<details\n\n\nb');

        appendParagraph(editor, 'new');

        const saved = editor.getValue();

        expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph', 'paragraph']);
        expect(saved).toBe('<details\n\n\nb\n\nnew');
        expect(viewedBlocks(saved)).toEqual(['raw: <details', 'paragraph: b', 'paragraph: new']);
        expect(load(saved).getValue()).toBe(saved);
    });

    /**
     * Types `text` at the end of a top-level block.
     *
     * @param editor - The editor.
     * @param index - The block's index among the root's children.
     * @param text - The text to type.
     */
    function typeAtEnd(editor: MarkdownEditor, index: number, text: string): void {
        lexicalOf(editor).update(() => {
            const block = $getRoot().getChildren()[index] as ElementNode;

            block.selectEnd();

            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertText(text);
            }
        }, { discrete: true });
    }
});

describe('$importMarkdown — whole-stack review fixes: combined table merges', () => {
    const rows: Array<[string, string, string]> = [
        ['a ^^ under a two-column cell with no continuation beside it is literal', '| a | b |\n|-|-|\n| 6 | << |\n| ^^ |',
            '| a | b |\n| --- | --- |\n| 6 | << |\n| \\^^ |  |'],
        ['a << after a ^^ that extends a one-column cell is literal', '| a | b |\n|-|-|\n| x | y |\n| ^^ | << |',
            '| a | b |\n| --- | --- |\n| x | y |\n| ^^ | \\<< |'],
        ['a ^^ under the covered half of a two-column cell is literal', '| a | b |\n|-|-|\n| x | << |\n| y | ^^ |',
            '| a | b |\n| --- | --- |\n| x | << |\n| y | \\^^ |'],
        ['a two-by-two cell written ^^ ^^', '| a | b |\n|-|-|\n| x | << |\n| ^^ | ^^ |', '| a | b |\n| --- | --- |\n| x | << |\n| ^^ | ^^ |'],
        ['a two-by-two cell written ^^ <<', '| a | b |\n|-|-|\n| x | << |\n| ^^ | << |', '| a | b |\n| --- | --- |\n| x | << |\n| ^^ | ^^ |'],
    ];

    for (const [name, source, saved] of rows) {
        it(`${name}: the editor shows the viewer's grid and saves it unchanged`, () => {
            const editor = load(source);

            expectSurface(editor, source);
            expect(editor.getValue()).toBe(saved);
            expect(viewerModel(saved)).toEqual(viewerModel(source));
            expect(load(saved).getValue()).toBe(saved);
        });
    }
});

describe('$importMarkdown — whole-stack review fixes: edit-fuzz round', () => {
    /**
     * Finds the `nth` text node whose text holds `needle`.
     *
     * @param needle - Text the node holds.
     * @param nth - Which match (0 for the first).
     * @returns The node and where `needle` starts in it.
     */
    function $textNodeHolding(needle: string, nth: number = 0): [LexicalNode, number] {
        const nodes = $dfs().map(({ node }) => node).filter((node) => $isTextNode(node) && node.getTextContent().includes(needle));
        const node = nodes[nth];

        if (node === undefined) {
            throw new Error(`no text node holds ${needle}`);
        }

        return [node, node.getTextContent().indexOf(needle)];
    }

    /**
     * Selects from an offset into one needle's text to an offset into another's (the same needle for a selection
     * inside one node), as a mouse drag does.
     *
     * @param editor - The editor.
     * @param from - The anchor's needle and its offset from the needle's start.
     * @param to - The focus's needle and offset; the anchor when omitted (a caret).
     */
    function select(editor: MarkdownEditor, from: [string, number], to: [string, number] = from): void {
        lexicalOf(editor).update(() => {
            const [anchorNode, anchorStart] = $textNodeHolding(from[0]);
            const [focusNode, focusStart] = $textNodeHolding(to[0]);
            const selection = $createRangeSelection();

            selection.anchor.set(anchorNode.getKey(), anchorStart + from[1], 'text');
            selection.focus.set(focusNode.getKey(), focusStart + to[1], 'text');
            $setSelection(selection);
        }, { discrete: true });
    }

    /**
     * Runs an edit against the selection in one update, as a keystroke does.
     *
     * @param editor - The editor.
     * @param edit - The edit; runs inside `editor.update`.
     */
    function edit(editor: MarkdownEditor, edit: () => void): void {
        lexicalOf(editor).update(edit, { discrete: true });
    }

    /**
     * Whether any node of the document is a link or an image, or a text node carrying a format or a style.
     *
     * @param editor - The editor.
     * @returns `true` when anything is formatted, linked or an image.
     */
    function holdsFormatting(editor: MarkdownEditor): boolean {
        return readDocument(editor, () => $dfs().some(({ node }) =>
            ($isTextNode(node) && (node.getFormat() !== 0 || node.getStyle() !== ''))
            || $isLinkNode(node) || $isMarkdownImageNode(node)));
    }

    /**
     * Asserts that what the editor shows is what the viewer shows for its save, and that the save is stable.
     *
     * @param editor - The editor.
     */
    function expectSaveShowsSurface(editor: MarkdownEditor): void {
        const saved = editor.getValue();

        expect(editorSurfaceModel(editor)).toEqual(viewerModel(saved).blocks);
        expect(load(saved).getValue()).toBe(saved);
    }

    describe('#1 code blocks hold only text', () => {
        const commands: Array<[string, (editor: MarkdownEditor) => void]> = [
            ['toggleLink', (editor) => editor.toggleLink('https://u.test')],
            ['toggleBold', (editor) => editor.toggleBold()],
            ['toggleItalic', (editor) => editor.toggleItalic()],
            ['toggleInlineCode', (editor) => editor.toggleInlineCode()],
            ['toggleStrikethrough', (editor) => editor.toggleStrikethrough()],
            ['toggleUnderline', (editor) => editor.toggleUnderline()],
            ['setTextColor', (editor) => editor.setTextColor('#cc0000')],
            ['setFontFamily', (editor) => editor.setFontFamily('serif')],
            ['setFontSize', (editor) => editor.setFontSize('2em')],
            ['insertImage', (editor) => editor.insertImage('https://x.test/i.png')],
        ];

        for (const [name, run] of commands) {
            it(`${name} on a selection inside a code block is declined`, () => {
                const editor = load('```\nabc def\n```');

                select(editor, ['abc', 0], ['abc', 3]);
                run(editor);

                expect(holdsFormatting(editor)).toBe(false);
                expect(editor.getValue()).toBe('```\nabc def\n```');
            });
        }

        it('a format command reaching a code block from the keyboard (FORMAT_TEXT_COMMAND) is declined', () => {
            const editor = load('para\n\n```\nabc\n```');

            select(editor, ['para', 1], ['abc', 2]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
            });

            expect(holdsFormatting(editor)).toBe(false);
            expect(editor.getValue()).toBe('para\n\n```\nabc\n```');
        });

        it('converting a paragraph to a code block keeps its inline content as its Markdown source', () => {
            const source = 'a ![i](https://i/a.png) [l](https://u) **b**';
            const editor = load(source);

            select(editor, ['a ', 0]);
            editor.setBlockType('code');

            expect(rootTypes(editor)).toEqual(['code']);
            expect(holdsFormatting(editor)).toBe(false);
            expect(editor.getValue()).toBe('```\na ![i](https://i/a.png) [l](https://u) **b**\n```');
            expectSaveShowsSurface(editor);
        });

        it('converting a heading with a line break to a code block keeps its lines as Markdown', () => {
            const editor = load('*h*\\\nx\n===');

            select(editor, ['x', 0]);
            editor.setBlockType('code');

            expect(editor.getValue()).toBe('```\n*h*\\\nx\n```');
            expectSaveShowsSurface(editor);
        });

        it('pasted nodes land in a code block as plain text', () => {
            const editor = load('```\nab\n```');

            select(editor, ['ab', 1]);
            edit(editor, () => {
                const bold = $createTextNode('w');

                bold.toggleFormat('bold');

                const nodes = [$createParagraphNode().append(bold, $createTextNode(' x')), $createParagraphNode().append($createTextNode('y'))];

                lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection: $getSelection()! });
            });

            expect(rootTypes(editor)).toEqual(['code']);
            expect(holdsFormatting(editor)).toBe(false);
            expect(editor.getValue()).toBe('```\naw x\nyb\n```');
        });
    });

    describe('#1b text styled with CSS the save does not write, in a code block', () => {
        it('stays its text, its newlines line breaks, not hard breaks written as Markdown', () => {
            const editor = load('```\nx\n```');

            edit(editor, () => {
                const code = $getRoot().getFirstChildOrThrow<ElementNode>();

                code.clear().append($createTextNode('a\nb').setStyle('white-space: pre-wrap'));
            });

            expect(editor.getValue()).toBe('```\na\nb\n```');
            expectSaveShowsSurface(editor);
        });
    });

    describe('#2 deleting from a raw block or code block into the next block', () => {
        /**
         * Presses Delete (or Backspace) on the selection: dispatches `DELETE_CHARACTER_COMMAND`, as the keyboard does.
         *
         * @param editor - The editor.
         * @param isBackward - `true` for Backspace.
         */
        function pressDelete(editor: MarkdownEditor, isBackward: boolean = false): void {
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);
            });
        }

        /**
         * Whether every top-level raw block and code block holds only unformatted text and line breaks.
         *
         * @param editor - The editor.
         * @returns `true` when no such block holds anything else.
         */
        function textOnlyBlocksHoldText(editor: MarkdownEditor): boolean {
            return readDocument(editor, () => $getRoot().getChildren()
                .filter((block) => $isMarkdownRawBlockNode(block) || $isCodeNode(block))
                .every((block) => (block as ElementNode).getChildren().every((child) => $isLineBreakNode(child)
                    || ($isTextNode(child) && !$isMarkdownSourceTextNode(child) && child.getFormat() === 0 && child.getStyle() === ''))));
        }

        it('the rest of a paragraph joins a raw block as its Markdown, so its link and bold are kept', () => {
            const editor = load('<div>\nxx\n</div>\n\na [ll](https://u) **bb**');

            select(editor, ['xx', 1], ['ll', 1]);
            pressDelete(editor, true);

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            expect(textOnlyBlocksHoldText(editor)).toBe(true);
            expect(editor.getValue()).toBe('<div>\nx[l](https://u) **bb**');
        });

        it('the rest of a list item joins a raw block as its Markdown, so its link and image are kept', () => {
            const editor = load('<div>\nxx\n</div>\n\n- [ll](https://u) ![i](https://img/a.png) z');

            select(editor, ['xx', 1], ['ll', 1]);
            pressDelete(editor);

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            expect(textOnlyBlocksHoldText(editor)).toBe(true);
            expect(editor.getValue()).toBe('<div>\nx[l](https://u) ![i](https://img/a.png) z');
        });

        it('the rest of a paragraph joins a raw block with its escapes and its leading space', () => {
            const editor = load('<div>\nxx\n</div>\n\na \\*b\\* c');

            select(editor, ['xx', 1], ['a *b* c', 1]);
            pressDelete(editor, true);

            expect(editor.getValue()).toBe('<div>\nx \\*b\\* c');
        });

        it('the rest of a raw block joins a raw block as its text', () => {
            const editor = load('<div>\nxx\n</div>\n\n<p>\nyy\n</p>');

            select(editor, ['xx', 1], ['yy', 1]);
            pressDelete(editor, true);

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            expect(editor.getValue()).toBe('<div>\nxy\n</p>');
        });

        it('the rest of a paragraph joins a code block as its Markdown', () => {
            const editor = load('```\nab\n```\n\nc [d](https://u) e');

            select(editor, ['ab', 1], ['d', 0]);
            pressDelete(editor, true);

            expect(rootTypes(editor)).toEqual(['code']);
            expect(textOnlyBlocksHoldText(editor)).toBe(true);
            expect(editor.getValue()).toBe('```\na[d](https://u) e\n```');
        });

        it('Delete at the end of a code block joins the paragraph after it as its Markdown', () => {
            const editor = load('```\nab\n```\n\n**c** \\*d');

            select(editor, ['ab', 2]);
            pressDelete(editor);

            expect(rootTypes(editor)).toEqual(['code']);
            expect(textOnlyBlocksHoldText(editor)).toBe(true);
            expect(editor.getValue()).toBe('```\nab**c** \\*d\n```');
        });

        it('text typed over a range from a raw block into a paragraph keeps the rest of the paragraph as Markdown', () => {
            const editor = load('<div>\nxx\n</div>\n\na [ll](https://u)');

            select(editor, ['xx', 1], ['ll', 1]);
            edit(editor, () => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertText('Q');
                }
            });

            expect(textOnlyBlocksHoldText(editor)).toBe(true);
            expect(editor.getValue()).toBe('<div>\nxQ[l](https://u)');
        });
    });

    describe('#3b a code fence keeps its whole info string', () => {
        const rows: Array<[string, string, string]> = [
            ['words after the language', '```ts extra\ncode\n```', '```ts extra\ncodex\n```'],
            ['escapes and spacing inside it', '``` ts  a\\_b {x}\ncode\n```', '```ts  a\\_b {x}\ncodex\n```'],
        ];

        for (const [name, source, saved] of rows) {
            it(`${name} are saved after the code is edited`, () => {
                const editor = load(source);

                select(editor, ['code', 4]);
                edit(editor, () => {
                    const selection = $getSelection();

                    if ($isRangeSelection(selection)) {
                        selection.insertText('x');
                    }
                });

                expect(editor.getValue()).toBe(saved);
                expectSaveShowsSurface(editor);
            });
        }

        it('a code block made in the editor saves its language alone (control)', () => {
            const editor = load('code');

            select(editor, ['code', 0]);
            editor.setBlockType('code');

            expect(editor.getValue()).toBe('```\ncode\n```');
        });
    });

    describe('#5 a paragraph line starting with inline HTML stays in the paragraph', () => {
        /**
         * Deletes the selection, as Backspace on a range does.
         *
         * @param editor - The editor.
         */
        function deleteSelection(editor: MarkdownEditor): void {
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });
        }

        it('Enter before inline HTML that would open an HTML block escapes it', () => {
            const editor = load('a<v>\nb *c*');

            select(editor, ['a', 1]);
            edit(editor, () => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertParagraph();
                }
            });

            expect(editor.getValue()).toBe('a\n\n\\<v>\nb *c*');
            expectSaveShowsSurface(editor);
        });

        it('deleting the text before inline HTML alone on its line escapes it', () => {
            const editor = load('x <r>');

            select(editor, ['x ', 0], ['x ', 2]);
            deleteSelection(editor);

            expect(editor.getValue()).toBe('\\<r>');
            expectSaveShowsSurface(editor);
        });

        it('a continuation line left starting with a block tag escapes it', () => {
            const editor = load('a\nb <div>');

            select(editor, ['b ', 0], ['b ', 2]);
            deleteSelection(editor);

            expect(editor.getValue()).toBe('a\n\\<div>');
            expectSaveShowsSurface(editor);
        });

        it('inline HTML starting a line it does not end stays unescaped (control)', () => {
            const editor = load('x <span>y</span>');

            select(editor, ['x ', 0], ['x ', 2]);
            deleteSelection(editor);

            expect(editor.getValue()).toBe('<span>y</span>');
            expectSaveShowsSurface(editor);
        });
    });

    describe('#12 a list next to a raw list with its marker stays its own list', () => {
        const rows: Array<[string, string, string, (editor: MarkdownEditor) => void, string]> = [
            ['a bullet list after a raw bullet list', '- a\n\n  b\n\n1) x', 'x', (editor) => editor.toggleUnorderedList(), '- a\n\n  b\n\n* x'],
            ['a bullet list before a raw bullet list', '1) x\n\n- a\n\n  b', 'x', (editor) => editor.toggleUnorderedList(), '* x\n\n- a\n\n  b'],
            ['an ordered list after a raw ordered list', '1. a\n\n   b\n\n- x', 'x', (editor) => editor.toggleOrderedList(), '1. a\n\n   b\n\n1) x'],
            ['a bullet list between raw bullet lists of two markers', '- a\n\n  b\n\n1) x\n\n* c\n\n  d', 'x', (editor) => editor.toggleUnorderedList(),
                '- a\n\n  b\n\n+ x\n\n* c\n\n  d'],
            ['an ordered list between raw ordered lists of both delimiters', '1. a\n\n   b\n\n- x\n\n1) c\n\n   d', 'x', (editor) => editor.toggleOrderedList(),
                '1. a\n\n   b\n\n[//]: #\n\n1. x\n\n1) c\n\n   d'],
        ];

        for (const [name, source, needle, run, saved] of rows) {
            it(`${name} is written with a marker that keeps it apart`, () => {
                const editor = load(source);

                select(editor, [needle, 0]);
                run(editor);

                expect(editor.getValue()).toBe(saved);
                expect(viewerModel(saved).blocks.filter((block) => block.kind === 'list')).toHaveLength(viewerModel(source).blocks.length);
                expect(load(saved).getValue()).toBe(saved);
                // Any separator shows nothing: the viewer shows as many blocks as the editor.
                expect(viewerModel(saved).blocks).toHaveLength(editorSurfaceModel(editor).length);
            });
        }

        it('two raw lists an edit brings together are kept apart by a separator that shows nothing', () => {
            const editor = load('- a\n\n  b\n\n<!-- x -->\n\n- c\n\n  d');

            edit(editor, () => {
                $getRoot().getChildAtIndex(1)!.remove();
            });

            const saved = editor.getValue();

            expect(saved).toBe('- a\n\n  b\n\n[//]: #\n\n- c\n\n  d');
            expect(viewerModel(saved).blocks.filter((block) => block.kind === 'list')).toHaveLength(2);
        });

        it('a loaded list before an indented raw list it would take in is kept apart by a separator that shows nothing', () => {
            const source = ' - *\n  * 0\n\n    9\nd';
            const editor = load(source);

            const standard = readDocument(editor, () => $serializeMarkdown());

            expect(standard).toBe('- *\n\n[//]: #\n\n  * 0\n\n    9\nd');
            expect(viewerModel(standard).blocks).toEqual(viewerModel(source).blocks);
        });
    });

    describe('import: a link whose text all sits in links nested in it', () => {
        /**
         * Types `text` at the end of the document, as a keystroke does, so its last block saves as edited.
         *
         * @param editor - The editor.
         * @param text - The text to type.
         */
        function typeAtDocumentEnd(editor: MarkdownEditor, text: string): void {
            edit(editor, () => {
                $getRoot().selectEnd();

                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertText(text);
                }
            });
        }

        const sources = [
            'x [[a](/in)](/out) y',
            '[[2]()]()',
            '[<ps:>]()',
            '[<4@x.t>]()',
            '[~~[6]()~~]()',
            '[***[0]()***]()',
            '[++[1]()++]()',
            '**[[a](/in)](/out)** y',
            '[[a](/1)[b](/2)](/o)',
            '[**[a](/1)**[b](/2)](/o) z',
            'x [[\\[a \\]b](/p)](/q)',
        ];

        for (const source of sources) {
            it(`${JSON.stringify(source)} shows the nested link as the viewer does and saves the link as written`, () => {
                const editor = load(source);

                expectSurface(editor, source);
                typeAtDocumentEnd(editor, ' q');
                expect(editor.getValue()).toBe(source + ' q');
                expectSaveShowsSurface(editor);
            });
        }

        const breaks: Array<[string, string, (editor: MarkdownEditor) => void]> = [
            ['deleting the second run of a split nested link', '[[**a**, b](/in)](/out) z', (editor) => {
                select(editor, [', b', 0], [' z', 0]);
                edit(editor, () => {
                    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
                });
            }],
            ['typing between the runs of a split nested link', '[[a](/1)[b](/2)](/o) z', (editor) => {
                edit(editor, () => {
                    const [node] = $textNodeHolding('a');

                    node.selectNext(0, 0);

                    const selection = $getSelection();

                    if ($isRangeSelection(selection)) {
                        selection.insertText('Q');
                    }
                });
            }],
            ['splitting a nested link\'s paragraph inside it', '[[x y _w_](/in)](/out) **q**', (editor) => {
                select(editor, ['w', 0]);
                edit(editor, () => {
                    const selection = $getSelection();

                    if ($isRangeSelection(selection)) {
                        selection.insertParagraph();
                    }
                });
            }],
        ];

        for (const [name, source, run] of breaks) {
            it(`${name} saves what is left as the editor shows it, keeping the outer link`, () => {
                const editor = load(source);
                const outer = source.slice(source.lastIndexOf(']('), source.lastIndexOf(')') + 1);

                run(editor);
                expectSaveShowsSurface(editor);
                expect(editor.getValue()).toContain(outer);
            });
        }

        it('removing, re-pointing or clearing the link of a nested link\'s text is declined', () => {
            const source = 'x [~~[a](/in)~~](/out) y';
            const editor = load(source);

            select(editor, ['a', 0]);
            editor.removeLink();
            editor.toggleLink('https://n.test');
            editor.toggleLink(null);
            select(editor, ['x ', 0], [' y', 2]);
            editor.clearFormatting();

            expectSurface(editor, source);
            typeAtDocumentEnd(editor, ' q');
            expect(editor.getValue()).toBe(source + ' q');
        });

        it('emphasis around an empty link that a word before it keeps from opening is not written', () => {
            const editor = load('__[]()_,');

            select(editor, ['_', 1]);
            edit(editor, () => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertText('1');
                }
            });

            expect(editor.getValue()).toBe('\\_1[](),');
            expectSaveShowsSurface(editor);
        });

        it('emphasis around an empty link that can open and close is kept (control)', () => {
            const editor = load('a **[](u)** b');

            typeAtDocumentEnd(editor, '!');

            expect(editor.getValue()).toBe('a **[](u)** b!');
        });

        it('an image whose source the viewer rejects shows nothing, as in the viewer, and saves as written', () => {
            for (const source of ['![](:) x', '![alt](:) x', 'a ![a](data:image/svg+xml;base64,AAAA) b']) {
                const editor = load(source);

                expectSurface(editor, source);
                typeAtDocumentEnd(editor, ' q');
                expect(editor.getValue()).toBe(source + ' q');
            }
        });
    });

    describe('import: a raw block keeps what it reads as', () => {
        const rows: Array<[string, string]> = [
            ['a quote whose indented lazy comment line marked keeps inside it', ' >)\n <!--'],
            ['a raw list whose indented second marker marked reads as part of the first item', '   + __4_\n\n     p\n    + 2'],
            ['code in a quote ending in a line of spaces', '>```\n>  '],
        ];

        for (const [name, source] of rows) {
            it(`${name}: a save after an edit elsewhere reads the same`, () => {
                const editor = load(`${source}\n\nz`);

                select(editor, ['z', 1]);
                edit(editor, () => {
                    const selection = $getSelection();

                    if ($isRangeSelection(selection)) {
                        selection.insertText('q');
                    }
                });

                const saved = editor.getValue();

                expect(viewerModel(saved).blocks).toEqual(viewerModel(`${source}\n\nzq`).blocks);
                expect(load(saved).getValue()).toBe(saved);
            });
        }

        it('a list whose task item marked made loose is kept as a raw block, as the viewer shows its marker on a line of its own', () => {
            const source = '- [x] a\n\n  - b';
            const editor = load(source);

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            expect(rootTexts(editor)).toEqual([source]);
        });

        it('a task item whose nested list follows directly is still a list (control)', () => {
            expect(rootTypes(load('- [ ] a\n  - b'))).toEqual(['list']);
        });

        it('a dropped definition whose title is on its next line is kept whole, not matched for the paragraph after it', () => {
            const source = '[x]:a\n[x]:>\n"t"\n"t"';
            const editor = load(source);

            const types = rootTypes(editor);
            const texts = rootTexts(editor);

            expect(types.slice(0, -1).every((type) => type === 'markdown-raw-block')).toBe(true);
            expect(texts.slice(0, -1).join('\n')).toBe('[x]:a\n[x]:>\n"t"');
            expect([types.at(-1), texts.at(-1)]).toEqual(['paragraph', '"t"']);
            expect(viewerModel(editor.getValue()).blocks).toEqual(viewerModel(source).blocks);
        });

        it('a raw block after an indented list still loses its indent (control)', () => {
            const editor = load('  - n\n\n  ***');

            expect(rootTexts(editor)[1]).toBe('***');
        });
    });

    describe('#6 formatting declines over a run kept as source', () => {
        const cases: Array<[string, string, [string, number], [string, number], (editor: MarkdownEditor) => void]> = [
            ['colour on a task marker', '- [ ] a', ['[ ]', 0], ['[ ]', 4], (editor) => editor.setTextColor('#cc0000')],
            ['bold over a task marker and its text', '- [ ] a', ['[ ]', 0], ['a', 1], (editor) => editor.toggleBold()],
            ['inline code on inline HTML', 'x <b> y', ['<b>', 0], ['<b>', 3], (editor) => editor.toggleInlineCode()],
            ['colour on a link nested in a link', 'x [[a](/in)](/out) y', ['a', 0], ['a', 1], (editor) => editor.setTextColor('#cc0000')],
            ['a link over inline HTML', 'x <b> y', ['x', 0], [' y', 2], (editor) => editor.toggleLink('https://u.test')],
        ];

        for (const [name, source, from, to, run] of cases) {
            it(`${name} is declined, so nothing is shown that the save would not write`, () => {
                const editor = load(source);
                const links = (): number => readDocument(editor, () => $dfs().filter(({ node }) => $isLinkNode(node)).length);
                const linksBefore = links();

                select(editor, from, to);
                run(editor);

                expect(readDocument(editor, () => $dfs().some(({ node }) => $isTextNode(node) && (node.getFormat() !== 0 || node.getStyle() !== '')))).toBe(false);
                expect(links()).toBe(linksBefore);
                expect(editor.getValue()).toBe(source);
            });
        }

        it('a format command reaching a source run from the keyboard (FORMAT_TEXT_COMMAND) is declined', () => {
            const editor = load('x <b> y');

            select(editor, ['x', 0], [' y', 2]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
            });

            expect(editor.getValue()).toBe('x <b> y');
        });

        it('a selection holding only a soft line break still formats (control)', () => {
            const editor = load('aa\nbb');

            select(editor, ['aa', 0], ['bb', 2]);
            editor.toggleBold();

            expect(editor.getValue()).toBe('**aa\nbb**');
        });

        it('a selection ending where a source run starts still formats (control)', () => {
            const editor = load('xy<b>');

            select(editor, ['xy', 0], ['xy', 2]);
            editor.toggleBold();

            expect(editor.getValue()).toBe('**xy**<b>');
        });

        describe('under a table selection, cell by cell', () => {
            const HEAD = '| h | i |\n| --- | --- |\n';

            /**
             * Selects whole cells of one table, as a drag from one cell to another does.
             *
             * @param editor - The editor.
             * @param from - Text in the cell the selection starts at.
             * @param to - Text in the cell it ends at.
             */
            function selectCells(editor: MarkdownEditor, from: string, to: string): void {
                lexicalOf(editor).update(() => {
                    const anchorCell = $findMatchingParent($textNodeHolding(from)[0], $isTableCellNode)!;
                    const focusCell = $findMatchingParent($textNodeHolding(to)[0], $isTableCellNode)!;
                    const table = $findMatchingParent(anchorCell, $isTableNode)!;

                    $setSelection($createTableSelectionFrom(table, anchorCell, focusCell));
                }, { discrete: true });
            }

            it('a selected cell holding a source run is left as it is, and the other cells format', () => {
                const editor = load(`${HEAD}| c <span>x</span> y | d |`);

                selectCells(editor, 'c ', 'd');
                editor.toggleBold();

                expect(editor.getValue()).toBe(`${HEAD}| c <span>x</span> y | **d** |`);
                expectSaveShowsSurface(editor);
            });

            it('a range over the same cell text declines too (control)', () => {
                const source = `${HEAD}| c <span>x</span> y | d |`;
                const editor = load(source);

                select(editor, ['c ', 0], [' y', 2]);
                editor.toggleBold();

                expect(editor.getValue()).toBe(source);
            });

            it('every selected cell formats, and a second press takes the format off again', () => {
                const source = `${HEAD}| c | d |`;
                const editor = load(source);

                selectCells(editor, 'c', 'd');
                editor.toggleBold();

                expect(editor.getValue()).toBe(`${HEAD}| **c** | **d** |`);
                expectSaveShowsSurface(editor);

                editor.toggleBold();

                expect(editor.getValue()).toBe(source);
            });

            it('a press with the format on only some of the cells puts it on all of them', () => {
                const editor = load(`${HEAD}| **c** | d |`);

                selectCells(editor, 'c', 'd');
                editor.toggleBold();

                expect(editor.getValue()).toBe(`${HEAD}| **c** | **d** |`);
                expectSaveShowsSurface(editor);
            });

            it('the selection spans the header row and an empty cell', () => {
                const editor = load(`${HEAD}| c |  |`);

                selectCells(editor, 'h', 'c');
                editor.toggleItalic();

                expect(editor.getValue()).toBe('| *h* | i |\n| --- | --- |\n| *c* |  |');
                expectSaveShowsSurface(editor);
            });

            it('the keyboard command is handled here, so the table plugin never formats the cells its own way', () => {
                const editor = load(`${HEAD}| c <b> y | d |`);
                let handled = false;

                selectCells(editor, 'c ', 'd');
                edit(editor, () => {
                    handled = lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
                });

                expect(handled).toBe(true);
                expect(editor.getValue()).toBe(`${HEAD}| c <b> y | *d* |`);
            });

            it('the cells stay selected', () => {
                const editor = load(`${HEAD}| c | d |`);

                selectCells(editor, 'c', 'd');
                editor.toggleBold();

                const cells = readDocument(editor, () => {
                    const selection = $getSelection();

                    return $isTableSelection(selection) ? selection.getNodes().filter($isTableCellNode).map((cell) => cell.getTextContent()) : null;
                });

                expect(cells).toEqual(['c', 'd']);
            });

            it('a cell whose format the save could not write is declined alone, and the press still undoes', () => {
                const source = `${HEAD}| a+b | d |`;
                const editor = load(source);

                selectCells(editor, 'a+b', 'd');
                editor.toggleUnderline();

                expect(editor.getValue()).toBe(`${HEAD}| a+b | ++d++ |`);
                expectSaveShowsSurface(editor);

                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

                expect(editor.getValue()).toBe(source);
            });

            it('a press every cell declines adds no undo step', () => {
                const source = `${HEAD}| a+b | d |`;
                const editor = load(source);

                select(editor, ['d', 0], ['d', 1]);
                editor.toggleBold();
                selectCells(editor, 'a+b', 'a+b');
                editor.toggleUnderline();

                expect(editor.getValue()).toBe(`${HEAD}| a+b | **d** |`);

                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

                expect(editor.getValue()).toBe(source);
            });

            it('a range over that cell text declines too (control)', () => {
                const source = `${HEAD}| a+b | d |`;
                const editor = load(source);

                select(editor, ['a+b', 0], ['a+b', 3]);
                editor.toggleUnderline();

                expect(editor.getValue()).toBe(source);
            });

            const TOGGLES: ReadonlyArray<[name: string, toggle: (editor: MarkdownEditor) => void, open: string, close: string]> = [
                ['bold', (editor) => editor.toggleBold(), '**', '**'],
                ['italic', (editor) => editor.toggleItalic(), '*', '*'],
                ['strikethrough', (editor) => editor.toggleStrikethrough(), '~~', '~~'],
                ['underline', (editor) => editor.toggleUnderline(), '++', '++'],
                ['inline code', (editor) => editor.toggleInlineCode(), '`', '`'],
            ];

            it.each(TOGGLES)('%s goes on with one press and comes off with the next', (_name, toggle, open, close) => {
                const source = `${HEAD}| c | d |`;
                const editor = load(source);

                selectCells(editor, 'c', 'd');
                toggle(editor);

                expect(editor.getValue()).toBe(`${HEAD}| ${open}c${close} | ${open}d${close} |`);

                toggle(editor);

                expect(editor.getValue()).toBe(source);
            });

            it.each(TOGGLES)('%s comes off cells loaded with it on', (_name, toggle, open, close) => {
                const editor = load(`${HEAD}| ${open}c${close} | ${open}d${close} |`);

                selectCells(editor, 'c', 'd');
                toggle(editor);

                expect(editor.getValue()).toBe(`${HEAD}| c | d |`);
            });

            it.each(TOGGLES)('%s on part of a cell\'s text only is not on: the press puts it on the rest', (_name, toggle, open, close) => {
                const editor = load(`${HEAD}| ${open}c${close} x | ${open}d${close} |`);

                selectCells(editor, 'c', 'd');
                toggle(editor);

                expect(editor.getValue()).toBe(`${HEAD}| ${open}c x${close} | ${open}d${close} |`);
            });

            /**
             * Selects the two cells of a body row, from the first cell to the second, which holds `text`.
             *
             * @param editor - The editor.
             * @param text - Text in the row's second cell.
             */
            function selectRowOf(editor: MarkdownEditor, text: string): void {
                lexicalOf(editor).update(() => {
                    const cell = $findMatchingParent($textNodeHolding(text)[0], $isTableCellNode)!;
                    const table = $findMatchingParent(cell, $isTableNode)!;

                    $setSelection($createTableSelectionFrom(table, cell.getPreviousSibling() as TableCellNode, cell));
                }, { discrete: true });
            }

            it('a cell holding an image alone takes no format, so it does not keep the format on the others', () => {
                const editor = load(`${HEAD}| ![i](/i.png) | **d** |`);

                selectRowOf(editor, 'd');
                editor.toggleBold();

                expect(editor.getValue()).toBe(`${HEAD}| ![i](/i.png) | d |`);
                expectSaveShowsSurface(editor);
            });

            it('a cell holding spaces alone does not keep bold on the others', () => {
                const editor = load(`${HEAD}| c | **d** |`);

                edit(editor, () => {
                    ($textNodeHolding('c')[0] as TextNode).setTextContent(' ');
                });
                selectRowOf(editor, 'd');
                editor.toggleBold();

                expect(editor.getValue()).toBe(`${HEAD}|  | d |`);
            });

            /**
             * Sends Undo to the editor.
             *
             * @param editor - The editor.
             */
            function undo(editor: MarkdownEditor): void {
                lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
            }

            const ONE_COLUMN = '| h |\n| --- |\n';
            // `C++` is written as the save writes it (`C\+\+`), so the source is also what the cells save as once the underline is off again.
            const UNDERLINE_DECLINED_BY_ONE_CELL: ReadonlyArray<[name: string, source: string, from: string, to: string, on: string]> = [
                ['C++ above Rust', `${ONE_COLUMN}| C\\+\\+ |\n| Rust |`, 'C++', 'Rust', `${ONE_COLUMN}| C\\+\\+ |\n| ++Rust++ |`],
                ['a+b beside d', `${HEAD}| a+b | d |`, 'a+b', 'd', `${HEAD}| a+b | ++d++ |`],
                ['a lone + beside d', `${HEAD}| + | d |`, '+', 'd', `${HEAD}| + | ++d++ |`],
            ];

            it.each(UNDERLINE_DECLINED_BY_ONE_CELL)(
                'underline over %s is read over the cells that take it: it comes off with the second press, and each press is one undo step',
                (_name, source, from, to, on) => {
                    const editor = load(source);

                    selectCells(editor, from, to);
                    editor.toggleUnderline();

                    expect(editor.getValue()).toBe(on);
                    expectSaveShowsSurface(editor);

                    editor.toggleUnderline();

                    expect(editor.getValue()).toBe(source);
                    expectSaveShowsSurface(editor);

                    undo(editor);

                    expect(editor.getValue()).toBe(on);

                    selectCells(editor, from, to);
                    editor.toggleUnderline();

                    expect(editor.getValue()).toBe(source);

                    undo(editor);

                    expect(editor.getValue()).toBe(on);

                    undo(editor);

                    expect(editor.getValue()).toBe(source);
                },
            );

            it.each(TOGGLES)('%s over cells taking and declining it goes on the ones taking it, comes off them, and each press undoes', (name, toggle, open, close) => {
                const head = '| h | i | j |\n| --- | --- | --- |\n';
                const source = `${head}| c <b> y | a+b | d |`;
                const editor = load(source);
                // Underline cannot hold the plus sign; every other format takes that cell.
                const plusCell = name === 'underline' ? 'a+b' : `${open}a+b${close}`;
                const on = `${head}| c <b> y | ${plusCell} | ${open}d${close} |`;

                selectCells(editor, 'c ', 'd');
                toggle(editor);

                expect(editor.getValue()).toBe(on);
                expectSaveShowsSurface(editor);

                toggle(editor);

                expect(editor.getValue()).toBe(source);

                undo(editor);

                expect(editor.getValue()).toBe(on);

                undo(editor);

                expect(editor.getValue()).toBe(source);
            });

            it.each([
                ['an empty cell', ''],
                ['a cell holding an image alone', '![i](/i.png)'],
            ])('%s takes no format, so a press the one other cell declines adds no undo step', (_name, cell) => {
                const source = `para\n\n${HEAD}| ${cell} | a+b |`;
                const editor = load(source);

                select(editor, ['para', 0], ['para', 4]);
                editor.toggleBold();
                selectRowOf(editor, 'a+b');
                editor.toggleUnderline();

                expect(editor.getValue()).toBe(`**para**\n\n${HEAD}| ${cell} | a+b |`);

                undo(editor);

                expect(editor.getValue()).toBe(source);
            });

            it.each<[name: string, toggle: (editor: MarkdownEditor) => void, format: 'underline' | 'code', mark: string]>([
                ['underline', (editor) => editor.toggleUnderline(), 'underline', '++'],
                ['inline code', (editor) => editor.toggleInlineCode(), 'code', '`'],
            ])('%s counts a space at a cell\'s edge: on all of the text but that space is not on, so the press puts it there', (_name, toggle, format, mark) => {
                const editor = load(`${HEAD}| ${mark}c${mark} | ${mark}d${mark} |`);

                edit(editor, () => {
                    $textNodeHolding('c')[0].insertAfter($createTextNode(' '));
                });
                selectCells(editor, 'c', 'd');
                toggle(editor);

                const bodyText = readDocument(editor, () => $dfs().map(({ node }) => node).filter($isTextNode)
                    .filter((text) => !['h', 'i'].includes(text.getTextContent()))
                    .map((text) => ({ text: text.getTextContent(), carries: text.hasFormat(format) })));

                expect(bodyText.map(({ text }) => text).join('')).toBe('c d');
                expect(bodyText.map(({ carries }) => carries)).not.toContain(false);
            });

            describe('the list toggles and setBlockType are refused before anything is dispatched', () => {
                const BLOCK_COMMANDS: ReadonlyArray<[name: string, run: (editor: MarkdownEditor) => void]> = [
                    ['toggleUnorderedList', (editor) => editor.toggleUnorderedList()],
                    ['toggleOrderedList', (editor) => editor.toggleOrderedList()],
                    ['setBlockType("h2")', (editor) => editor.setBlockType('h2')],
                ];

                /**
                 * The key of every node in the document, in document order.
                 *
                 * @param editor - The editor.
                 * @returns The keys.
                 */
                function nodeKeys(editor: MarkdownEditor): string[] {
                    return readDocument(editor, () => $dfs().map(({ node }) => node.getKey()));
                }

                it.each(BLOCK_COMMANDS)('%s leaves the value, the nodes and the cell selection as they were', (_name, run) => {
                    const source = `${HEAD}| c | d |`;
                    const editor = load(source);

                    selectCells(editor, 'c', 'd');

                    const keys = nodeKeys(editor);
                    const updates = vi.fn();
                    const unregister = lexicalOf(editor).registerUpdateListener(updates);

                    run(editor);
                    unregister();

                    expect(editor.getValue()).toBe(source);
                    expect(nodeKeys(editor)).toEqual(keys);
                    expect(updates).not.toHaveBeenCalled();
                    expect(readDocument(editor, () => $isTableSelection($getSelection()))).toBe(true);
                });

                // Merging leaves the table selection naming a cell that is gone, until the next selection change.
                it.each(BLOCK_COMMANDS)('%s is refused after the selected cells were merged, without reading the selection\'s nodes', (_name, run) => {
                    const editor = load(`${HEAD}| c | d |`);

                    selectCells(editor, 'c', 'd');
                    editor.mergeTableCells();

                    const merged = editor.getValue();

                    expect(() => run(editor)).not.toThrow();
                    expect(editor.getValue()).toBe(merged);
                });

                it.each(BLOCK_COMMANDS)('%s adds no undo step: one Undo still takes back the edit made before it', (_name, run) => {
                    const source = `para\n\n${HEAD}| c | d |`;
                    const editor = load(source);

                    select(editor, ['para', 0], ['para', 4]);
                    editor.toggleBold();
                    selectCells(editor, 'c', 'd');
                    run(editor);

                    expect(editor.getValue()).toBe(`**para**\n\n${HEAD}| c | d |`);

                    lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

                    expect(editor.getValue()).toBe(source);
                });
            });
        });
    });

    describe('lists keep the markers they were written with', () => {
        /**
         * The list nodes at the top level of the document.
         *
         * @param editor - The editor.
         * @returns One entry per top-level list: its item texts.
         */
        function topLists(editor: MarkdownEditor): string[][] {
            return readDocument(editor, () => $getRoot().getChildren()
                .filter($isListNode)
                .map((list) => list.getChildren().map((item) => item.getTextContent())));
        }

        for (const [name, source] of [
            ['a change of bullet character', '- foo\n- bar\n+ baz'],
            ['a change of ordered delimiter', '1. a\n1) b'],
            ['a change of bullet character on the second item of three', '* a\n- b\n- c'],
        ] as const) {
            it(`${name} starts a second list, as the viewer reads it`, () => {
                const editor = load(source);

                expectSurface(editor, source);
                expect(topLists(editor)).toHaveLength(2);
                expectSaveShowsSurface(editor);
            });
        }

        it('two lists of one marker the viewer reads apart (after an empty item) load apart', () => {
            const source = '- foo\n\n\n- \n\n\n- baz';
            const editor = load(source);

            expectSurface(editor, source);
            expectSaveShowsSurface(editor);
        });

        it('an edit inside the first list leaves the two lists apart', () => {
            const editor = load('- foo\n- bar\n+ baz');

            select(editor, ['bar', 3]);
            edit(editor, () => {
                ($getSelection() as ReturnType<typeof $createRangeSelection>).insertText('x');
            });

            expect(topLists(editor)).toEqual([['foo', 'barx'], ['baz']]);
            expectSaveShowsSurface(editor);
        });

        it('a list converted next to a list of one marker joins it, as Lexical joins lists made in the editor', () => {
            const editor = load('- a\n\nx\n\n- b');

            select(editor, ['x', 0]);
            editor.toggleUnorderedList();

            expect(topLists(editor)).toEqual([['a', 'x', 'b']]);
            expectSaveShowsSurface(editor);
        });

        it('two new adjacent lists of one marker merge, as Lexical merges them', () => {
            const editor = load('p');

            edit(editor, () => {
                $getRoot().append(
                    $createListNode('bullet').append($createListItemNode().append($createTextNode('a'))),
                    $createListNode('bullet').append($createListItemNode().append($createTextNode('b'))),
                );
            });

            expect(topLists(editor)).toEqual([['a', 'b']]);
        });

        it('two adjacent lists that write the same marker are saved apart', () => {
            const editor = load('p');
            let saved = '';

            // Serialized in the update that builds them, before any transform runs.
            edit(editor, () => {
                $getRoot().clear().append(
                    $createListNode('bullet').append($createListItemNode().append($createTextNode('a'))),
                    $createListNode('bullet').append($createListItemNode().append($createTextNode('b'))),
                );
                saved = $serializeMarkdown();
            });

            const reloaded = load(saved);

            expect(topLists(reloaded)).toEqual([['a'], ['b']]);
            expect(viewerModel(saved).blocks).toEqual([
                { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [{ kind: 'text', text: 'a', marks: [], link: null, style: null }] }]] },
                { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [{ kind: 'text', text: 'b', marks: [], link: null, style: null }] }]] },
            ]);
        });
    });

    describe('a list is loose only where its save can be', () => {
        it('a loose list left with one item of one block is tight', () => {
            const editor = load('1. a\n\n2. b');

            select(editor, ['b', 0]);
            editor.setBlockType('quote');

            expect(readDocument(editor, () => $getState($getRoot().getFirstChildOrThrow<ListNode>(), listLooseState))).toBe(false);
            expectSaveShowsSurface(editor);
        });

        it('text typed into a paragraph after a nested list makes the list loose, as its save reads', () => {
            // `123456789.` opens an ordered list nested in the item, so the paragraph goes in after it.
            const editor = load('- 123456789. ok');

            select(editor, ['ok', 2]);
            editor.insertParagraphAfterBlock();
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('x');
            });

            const saved = editor.getValue();

            expect(saved).toBe('- 123456789. ok\n\n  x');
            expect(viewerModel(saved).blocks[0]).toMatchObject({ kind: 'list', loose: true });
            expect(readDocument(editor, () => $getState($getRoot().getFirstChildOrThrow<ListNode>(), listLooseState))).toBe(true);
        });

        it('an item holding only nested empty items does not save as a thematic break', () => {
            const editor = load('- - - b\n- a');

            select(editor, ['b', 0], ['b', 1]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(editor.getValue()).not.toMatch(/^- - -$/m);
            expectSaveShowsSurface(editor);
        });

        it('a single-item list whose item keeps its nested list stays loose', () => {
            const editor = load('- a\n\n  - b');

            expect(readDocument(editor, () => $getState($getRoot().getFirstChildOrThrow<ListNode>(), listLooseState))).toBe(true);
            expectSaveShowsSurface(editor);
        });
    });

    describe('line breaks Markdown cannot hold are not made', () => {
        /**
         * Presses Shift+Enter as the keyboard does: dispatches `KEY_ENTER_COMMAND` with Shift held, then, when no
         * handler took it, inserts a line break as `registerRichText`'s handler does.
         *
         * @param editor - The editor.
         */
        function shiftEnter(editor: MarkdownEditor): void {
            edit(editor, () => {
                const handled = lexicalOf(editor).dispatchCommand(
                    KEY_ENTER_COMMAND, { altKey: false, shiftKey: true, preventDefault: () => {} } as KeyboardEvent);
                const selection = $getSelection();

                if (!handled && $isRangeSelection(selection)) {
                    selection.insertLineBreak();
                }
            });
        }

        /**
         * Whether the document holds a line break, as a node or a newline in text outside code.
         *
         * @param editor - The editor.
         * @returns `true` when any block shows a line break.
         */
        function holdsBreak(editor: MarkdownEditor): boolean {
            return readDocument(editor, () => $dfs().some(({ node }) => $isLineBreakNode(node)
                || ($isTextNode(node) && !$isMarkdownSourceTextNode(node) && node.getTextContent().includes('\n'))));
        }

        const declined: Array<[string, string, [string, number]]> = [
            ['at the end of a paragraph', 'abc', ['abc', 3]],
            ['at the end of a quote', '> abc', ['abc', 3]],
            ['at the end of a list item', '- abc\n- d', ['abc', 3]],
            ['in a level 3 heading', '### abc', ['abc', 1]],
            ['in a level 6 heading', '###### abc', ['abc', 1]],
        ];

        for (const [name, source, at] of declined) {
            it(`Shift+Enter ${name} is declined: a save could not keep the break`, () => {
                const editor = load(source);

                select(editor, at);
                shiftEnter(editor);

                expect(holdsBreak(editor)).toBe(false);
                expect(editor.getValue()).toBe(source);
                expectSaveShowsSurface(editor);
            });
        }

        it('Shift+Enter in an empty paragraph is declined: a block of breaks alone saves nothing', () => {
            const editor = load('a\n\nb');

            select(editor, ['a', 1]);
            pressEnterIn(editor);
            shiftEnter(editor);

            expect(holdsBreak(editor)).toBe(false);
        });

        const kept: Array<[string, string, [string, number], string]> = [
            ['inside a paragraph', 'abc', ['abc', 1], 'a\\\nbc'],
            ['at the start of a paragraph', 'abc', ['abc', 0], '\\\nabc'],
            ['inside a level 2 heading, written setext', '## abc', ['abc', 1], 'a\\\nbc\n---'],
            ['at the end of a table cell', '| a |\n| --- |\n| b |', ['b', 1], '| a |\n| --- |\n| b\\n\\n |'],
        ];

        for (const [name, source, at, saved] of kept) {
            it(`Shift+Enter ${name} still breaks the line (control)`, () => {
                const editor = load(source);

                select(editor, at);
                shiftEnter(editor);

                expect(holdsBreak(editor)).toBe(true);
                expect(editor.getValue()).toBe(saved);
                expectSaveShowsSurface(editor);
            });
        }

        it('deleting the text after a break leaves no break at the end of the block', () => {
            const editor = load('a\\\nbc');

            select(editor, ['bc', 0], ['bc', 2]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(holdsBreak(editor)).toBe(false);
            expect(editor.getValue()).toBe('a');
            expectSaveShowsSurface(editor);
        });

        it('a break pasted at the end of a paragraph is not kept', () => {
            const editor = load('ab');

            select(editor, ['ab', 2]);
            edit(editor, () => {
                const selection = $getSelection()!;
                const nodes = [$createTextNode('c'), $createLineBreakNode()];

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(holdsBreak(editor)).toBe(false);
            expect(editor.getValue()).toBe('abc');
            expectSaveShowsSurface(editor);
        });

        it('a break pasted into a level 4 heading shows as the space it saves as', () => {
            const editor = load('#### ab');

            select(editor, ['ab', 1]);
            edit(editor, () => {
                const selection = $getSelection()!;
                const nodes = [$createTextNode('x'), $createLineBreakNode(), $createTextNode('y')];

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(holdsBreak(editor)).toBe(false);
            expect(rootTexts(editor)).toEqual(['ax yb']);
            expect(editor.getValue()).toBe('#### ax yb');
            expectSaveShowsSurface(editor);
        });

        it('a code block made a level 3 heading shows its line breaks as the spaces they save as', () => {
            const editor = load('```\na\nb\n```');

            select(editor, ['a', 0]);
            editor.setBlockType('h3');

            expect(holdsBreak(editor)).toBe(false);
            expect(rootTexts(editor)).toEqual(['a b']);
            expect(editor.getValue()).toBe('### a b');
            expectSaveShowsSurface(editor);
        });

        it('a code block made a paragraph keeps no break after its last line', () => {
            const editor = load('```\na\nb\n\n```');

            select(editor, ['a', 0]);
            editor.setBlockType('paragraph');

            expect(editor.getValue()).toBe('a\\\nb');
            expectSaveShowsSurface(editor);
        });

        // A level 1 or 2 heading saves its breaks only in its setext form,
        // which a line the setext rule would not read as heading content
        // (a lone tag here) rules out; the save is then ATX, its breaks
        // spaces, and the editor shows that.
        it('a break before a lone tag in a level 1 heading shows as the space the save writes', () => {
            const editor = load('# ab <span>');

            select(editor, ['ab ', 3]);
            shiftEnter(editor);

            expect(holdsBreak(editor)).toBe(false);
            expect(editor.getValue()).toMatch(/^# ab +<span>$/);
            expectSaveShowsSurface(editor);
        });

        /**
         * Presses Enter at the selection as the keyboard does.
         *
         * @param editor - The editor.
         */
        function pressEnterIn(editor: MarkdownEditor): void {
            edit(editor, () => {
                const handled = lexicalOf(editor).dispatchCommand(
                    KEY_ENTER_COMMAND, { altKey: false, shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
                const selection = $getSelection();

                if (!handled && $isRangeSelection(selection)) {
                    selection.insertParagraph();
                }
            });
        }
    });

    describe('formats the save cannot write as shown are not made', () => {
        /**
         * The text runs of the first block, each with its format bits.
         *
         * @param editor - The editor.
         * @returns `[text, format]` per text node.
         */
        function runs(editor: MarkdownEditor): Array<[string, number]> {
            return readDocument(editor, () => $dfs($getRoot().getFirstChildOrThrow())
                .map(({ node }) => node)
                .filter($isTextNode)
                .map((node): [string, number] => [node.getTextContent(), node.getFormat()]));
        }

        /**
         * Types text one character at a time, each in its own update, as the keyboard does, so the typing
         * shortcuts run after each.
         *
         * @param editor - The editor.
         * @param text - The characters.
         */
        function typeChars(editor: MarkdownEditor, text: string): void {
            for (const char of text) {
                edit(editor, () => {
                    ($getSelection() as RangeSelection).insertText(char);
                });
            }
        }

        it('bold over a word and the space after it bolds the word only', () => {
            const editor = load('one two');

            select(editor, ['one', 0], ['two', 0]);
            editor.toggleBold();

            expect(runs(editor)).toEqual([['one', BOLD], [' two', 0]]);
            expect(editor.getValue()).toBe('**one** two');
            expectSaveShowsSurface(editor);
        });

        it('strikethrough over spaces around a word strikes the word only', () => {
            const editor = load('a b c');

            select(editor, ['a b c', 1], ['a b c', 4]);
            editor.toggleStrikethrough();

            expect(editor.getValue()).toBe('a ~~b~~ c');
            expectSaveShowsSurface(editor);
        });

        it('italic on whitespace alone formats nothing', () => {
            const editor = load('a b');

            select(editor, ['a b', 1], ['a b', 2]);
            editor.toggleItalic();

            expect(runs(editor)).toEqual([['a b', 0]]);
            expect(editor.getValue()).toBe('a b');
        });

        it('bold taken off a word inside a bold run leaves the spaces around it plain', () => {
            const editor = load('**a b c**');

            select(editor, ['a b c', 2], ['a b c', 3]);
            // A selection made in the view carries the format of the text it starts in.
            edit(editor, () => {
                ($getSelection() as RangeSelection).setFormat(BOLD);
            });
            editor.toggleBold();

            expect(editor.getValue()).toBe('**a** b **c**');
            expectSaveShowsSurface(editor);
        });

        it('bold over the space between two bold words joins them (control)', () => {
            const editor = load('**a** **b**');

            select(editor, ['a', 1], ['b', 0]);
            editor.toggleBold();

            expect(editor.getValue()).toBe('**a b**');
            expectSaveShowsSurface(editor);
        });

        describe('a format toggled over the spaces around a word comes off on the next toggle', () => {
            /**
             * Selects characters of the first block's text as the view does when the page's selection changes: the
             * selection carries the formats every text node it covers shares (Lexical's own rule, which leaves out a
             * node the selection only touches at its edge).
             *
             * @param editor - The editor.
             * @param from - Where the anchor sits, as an offset in the block's text.
             * @param to - Where the focus sits; before `from` for a backward selection.
             */
            function selectCharsAsView(editor: MarkdownEditor, from: number, to: number): void {
                edit(editor, () => {
                    const texts = $dfs($getRoot().getFirstChildOrThrow()).map(({ node }) => node).filter($isTextNode);
                    const selection = $createRangeSelection();
                    const [startPoint, endPoint] = from <= to ? [selection.anchor, selection.focus] : [selection.focus, selection.anchor];
                    const [start, end] = [Math.min(from, to), Math.max(from, to)];
                    let offset = 0;

                    for (const text of texts) {
                        const size = text.getTextContentSize();

                        if (start >= offset && start < offset + size) {
                            startPoint.set(text.getKey(), start - offset, 'text');
                        }

                        if (end > offset && end <= offset + size) {
                            endPoint.set(text.getKey(), end - offset, 'text');
                        }

                        offset += size;
                    }

                    const covered = selection.getNodes().filter((node) => $isTextNode(node) && node.getTextContentSize() !== 0
                        && !(node.is(startPoint.getNode()) && startPoint.offset === node.getTextContentSize())
                        && !(node.is(endPoint.getNode()) && endPoint.offset === 0));

                    selection.format = covered.reduce((format, node) => format & (node as TextNode).getFormat(), covered.length === 0 ? 0 : -1);
                    $setSelection(selection);
                });
            }

            const toggles: Array<[string, (editor: MarkdownEditor) => void, (state: MarkdownEditorSelectionState) => boolean, string]> = [
                ['bold', (editor) => editor.toggleBold(), (state) => state.bold, 'This is a **string,** of text'],
                ['italic', (editor) => editor.toggleItalic(), (state) => state.italic, 'This is a *string,* of text'],
                ['strikethrough', (editor) => editor.toggleStrikethrough(), (state) => state.strikethrough, 'This is a ~~string,~~ of text'],
            ];

            for (const [name, toggle, shown, formatted] of toggles) {
                it(`${name}: the first toggle puts it on the word, the second takes it off, and the toolbar shows it on between`, () => {
                    const editor = load('This is a string, of text');

                    selectCharsAsView(editor, 9, 18);
                    toggle(editor);

                    expect(editor.getValue()).toBe(formatted);

                    selectCharsAsView(editor, 9, 18);

                    expect(shown(editor.getSelectionState())).toBe(true);

                    toggle(editor);

                    expect(editor.getValue()).toBe('This is a string, of text');
                    expectSaveShowsSurface(editor);
                });
            }

            it('the context menu\'s Bold checkbox is on for the spaces and the bold word between them', () => {
                const editor = load('This is **string,** of text');

                selectCharsAsView(editor, 7, 16);

                const target = readDocument(editor, () => $classifyContextMenuTarget($getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()));

                expect(target).toMatchObject({ kind: 'text', bold: true });
            });

            it('the keyboard\'s bold (FORMAT_TEXT_COMMAND) over the spaces and the bold word between them takes it off', () => {
                const editor = load('This is **string,** of text');

                selectCharsAsView(editor, 7, 16);
                edit(editor, () => {
                    lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
                });

                expect(editor.getValue()).toBe('This is string, of text');
            });

            it('bold over two bold words and the plain space between them joins them, as the space counts (control)', () => {
                const editor = load('**a** **b**');

                selectCharsAsView(editor, 0, 3);

                expect(editor.getSelectionState().bold).toBe(false);

                editor.toggleBold();

                expect(editor.getValue()).toBe('**a b**');
                expectSaveShowsSurface(editor);
            });

            it('a backward selection over the spaces and the bold word between them reads as bold and takes it off', () => {
                const editor = load('This is **string,** of text');

                selectCharsAsView(editor, 16, 7);

                expect(editor.getSelectionState().bold).toBe(true);

                editor.toggleBold();

                expect(editor.getValue()).toBe('This is string, of text');
            });

            const joins: Array<[string, string]> = [
                ['the second word a link', '**a** **[b](https://u.test)**'],
                ['the first word a link', '**[a](https://u.test)** **b**'],
                ['the second word a styled span', '**a** **[b]{color=red}**'],
            ];

            for (const [name, source] of joins) {
                it(`bold over two bold words and the plain space between them, ${name}, joins them (control)`, () => {
                    const editor = load(source);

                    selectCharsAsView(editor, 0, 3);

                    expect(editor.getSelectionState().bold).toBe(false);

                    editor.toggleBold();

                    expect(runs(editor).map(([text, format]) => [text, format & BOLD])).toEqual(
                        runs(editor).map(([text]) => [text, BOLD]));
                    expect(runs(editor).map(([text]) => text).join('')).toBe('a b');
                    expectSaveShowsSurface(editor);
                });
            }

            it('bold over two words with an image between them comes off on the second toggle, the spaces by the image not counting', () => {
                const editor = load('a ![i](https://i.test/i.png) b');

                selectCharsAsView(editor, 0, 4);
                editor.toggleBold();

                expect(editor.getValue()).toBe('**a** ![i](https://i.test/i.png) **b**');

                selectCharsAsView(editor, 0, 4);

                expect(editor.getSelectionState().bold).toBe(true);

                editor.toggleBold();

                expect(editor.getValue()).toBe('a ![i](https://i.test/i.png) b');
            });

            it('a selection of whitespace alone reads the formats the selection keeps (control)', () => {
                const plain = load('a b');
                const bold = load('**a b**');

                selectCharsAsView(plain, 1, 2);
                selectCharsAsView(bold, 1, 2);

                expect(plain.getSelectionState().bold).toBe(false);
                expect(bold.getSelectionState().bold).toBe(true);
            });

            it('inline code over the spaces around a word comes off on the second toggle (control: code is not trimmed)', () => {
                const editor = load('This is a string, of text');

                selectCharsAsView(editor, 9, 18);
                editor.toggleInlineCode();
                selectCharsAsView(editor, 9, 18);

                expect(editor.getSelectionState().code).toBe(true);

                editor.toggleInlineCode();

                expect(editor.getValue()).toBe('This is a string, of text');
            });
        });

        const unwritable: Array<[string, string, [string, number], [string, number], (editor: MarkdownEditor) => void]> = [
            ['bold whose content starts with punctuation right after a letter', 'x(a) b', ['x(a)', 1], ['x(a)', 4], (editor: MarkdownEditor) => editor.toggleBold()],
            ['italic whose content ends with punctuation right before a letter', 'a (b)c', ['(b)c', 0], ['(b)c', 3], (editor: MarkdownEditor) => editor.toggleItalic()],
            ['strikethrough over a code span right after a letter', 'a`c` d', ['a', 1], ['c', 1], (editor: MarkdownEditor) => editor.toggleStrikethrough()],
            ['underline over a plus sign', 'a+b c', ['a+b', 0], ['a+b', 3], (editor: MarkdownEditor) => editor.toggleUnderline()],
            ['a colour over brackets', 'a[b]c d', ['a[b]c', 0], ['a[b]c', 5], (editor: MarkdownEditor) => editor.setTextColor('#cc0000')],
            ['a font over a bracket', 'a]b', ['a]b', 0], ['a]b', 3], (editor: MarkdownEditor) => editor.setFontFamily('Georgia')],
        ];

        for (const [name, source, from, to, run] of unwritable) {
            it(`${name} is declined`, () => {
                const editor = load(source);
                const before = editor.getValue();
                const formats = runs(editor);

                select(editor, from, to);
                run(editor);

                expect(runs(editor)).toEqual(formats);
                expect(readDocument(editor, () => $dfs().some(({ node }) => $isTextNode(node) && node.getStyle() !== ''))).toBe(false);
                expect(editor.getValue()).toBe(before);
                expectSaveShowsSurface(editor);
            });
        }

        it('the keyboard\'s bold (FORMAT_TEXT_COMMAND) whose content starts with punctuation after a letter is declined', () => {
            const editor = load('x(a) b');

            select(editor, ['x(a)', 1], ['x(a)', 4]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
            });

            expect(holdsFormatting(editor)).toBe(false);
            expect(editor.getValue()).toBe('x(a) b');
        });

        it('bold over punctuation with a space before it still applies (control)', () => {
            const editor = load('x (a) b');

            select(editor, ['(a)', 0], ['(a)', 3]);
            editor.toggleBold();

            expect(editor.getValue()).toBe('x **(a)** b');
            expectSaveShowsSurface(editor);
        });

        it('a declined format leaves the document clean', () => {
            const editor = load('x(a) b');

            editor.markClean();
            select(editor, ['x(a)', 1], ['x(a)', 4]);
            editor.toggleBold();

            expect(editor.isDirty()).toBe(false);
        });

        it('a bold typing shortcut whose content starts with punctuation after a letter stays typed text', () => {
            const editor = load('p');

            select(editor, ['p', 1]);
            typeChars(editor, ' x**(a)**');

            expect(holdsFormatting(editor)).toBe(false);
            expect(rootTexts(editor)).toEqual(['p x**(a)**']);
            expectSaveShowsSurface(editor);
        });

        for (const alt of ['a[b]', 'a]', '[']) {
            it(`an image whose alt text holds a bracket (${alt}) is declined: the image syntax cannot hold one`, () => {
                const editor = load('x');

                select(editor, ['x', 1]);
                editor.insertImage('https://i.test/a.png', { alt });

                expect(readDocument(editor, () => $dfs().some(({ node }) => $isMarkdownImageNode(node)))).toBe(false);
                expect(editor.getValue()).toBe('x');
            });
        }

        it('an image whose alt text holds no bracket is inserted (control)', () => {
            const editor = load('x');

            select(editor, ['x', 1]);
            editor.insertImage('https://i.test/a.png', { alt: 'a(b)' });

            expect(editor.getValue()).toBe('x![a(b)](https://i.test/a.png)');
            expectSaveShowsSurface(editor);
        });

        it('bold over a word and part of a link takes the space before the link off the bold', () => {
            const editor = load('a [bc](u)');

            select(editor, ['a ', 0], ['bc', 1]);
            editor.toggleBold();

            expect(editor.getValue()).toBe('**a** [**b**c](u)');
            expectSaveShowsSurface(editor);
        });

        it('deleting the word a bold run starts with leaves no bold on the space after it', () => {
            const editor = load('x **a b** y');

            select(editor, ['a b', 0], ['a b', 1]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(editor.getValue()).toBe('x  **b** y');
            expectSaveShowsSurface(editor);
        });

        it('bold text pasted with a trailing space keeps the space plain', () => {
            const editor = load('xy');

            select(editor, ['xy', 1]);
            edit(editor, () => {
                const selection = $getSelection()!;
                const nodes = [$createTextNode('p ').toggleFormat('bold')];

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(editor.getValue()).toBe('x**p** y');
            expectSaveShowsSurface(editor);
        });

        it('bold text opening with punctuation pasted right after a letter loses the bold on that punctuation', () => {
            const editor = load('xy');

            select(editor, ['xy', 1]);
            edit(editor, () => {
                const selection = $getSelection()!;
                const nodes = [$createTextNode('(a)').toggleFormat('bold')];

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(runs(editor)).toEqual([['x(', 0], ['a', BOLD], [')y', 0]]);
            expectSaveShowsSurface(editor);
        });

        it('a bold link pasted right after a letter loses the bold, whose delimiter would stand before its bracket', () => {
            const editor = load('xy');

            select(editor, ['xy', 1]);
            edit(editor, () => {
                const selection = $getSelection()!;
                const nodes = [$createLinkNode('https://l.test').append($createTextNode('re').toggleFormat('bold'))];

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(holdsFormatting(editor)).toBe(true);
            expect(runs(editor).some(([, format]) => format !== 0)).toBe(false);
            expectSaveShowsSurface(editor);
        });

        it('a run of a link nested in a link keeps the strikethrough its source writes, joined after a letter', () => {
            const editor = load('a\n\n[~~[6]()~~]() x');

            select(editor, ['6', 0]);
            edit(editor, () => {
                const selection = $getSelection() as RangeSelection;
                const paragraph = $getRoot().getLastChildOrThrow<ElementNode>();

                selection.anchor.set(paragraph.getKey(), 0, 'element');
                selection.focus.set(paragraph.getKey(), 0, 'element');
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(editor.getValue()).toBe('a[~~[6]()~~]() x');
            expectSaveShowsSurface(editor);
        });

        it('deleting the space before bold that opens with punctuation takes the bold off it', () => {
            const editor = load('x **(a)** y');

            select(editor, ['x ', 1], ['x ', 2]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(editor.getValue()).toBe('x(**a)** y');
            expectSaveShowsSurface(editor);
        });

        /**
         * Types text one character at a time with a format, as typing with Bold (or another format) on does: the
         * caret keeps the format it was given whatever the text it lands in.
         *
         * @param editor - The editor.
         * @param text - The characters.
         * @param format - The Lexical format bits to type with.
         */
        function typeFormatted(editor: MarkdownEditor, text: string, format: number): void {
            for (const char of text) {
                edit(editor, () => {
                    const selection = $getSelection() as RangeSelection;

                    selection.setFormat(format);
                    selection.insertText(char);
                });
            }
        }

        it('a space typed at the end of a bold run takes no bold, and the bold goes on with the next word', () => {
            const editor = load('**a**');

            select(editor, ['a', 1]);
            typeFormatted(editor, ' ', BOLD);

            expect(runs(editor)).toEqual([['a', BOLD], [' ', 0]]);
            expectSaveShowsSurface(editor);

            typeFormatted(editor, 'next', BOLD);

            expect(runs(editor)).toEqual([['a next', BOLD]]);
            expect(editor.getValue()).toBe('**a next**');
        });

        it('a space typed at the end of a struck run shows unstruck until the next word joins the run', () => {
            const editor = load('~~a~~');

            select(editor, ['a', 1]);
            typeFormatted(editor, ' ', 4);

            expect(runs(editor)).toEqual([['a', 4], [' ', 0]]);
            expectSaveShowsSurface(editor);

            typeFormatted(editor, 'b', 4);

            expect(editor.getValue()).toBe('~~a b~~');
            expectSaveShowsSurface(editor);
        });

        it('a word typed right before emphasis that opens with punctuation takes that emphasis off its edge', () => {
            const editor = load('foo *\\**');

            select(editor, ['foo ', 4]);
            typeChars(editor, 'fuzz');

            expect(runs(editor)).toEqual([['foo fuzz*', 0]]);
            expect(editor.getValue()).toBe('foo fuzz\\*');
            expectSaveShowsSurface(editor);
        });

        it('a word typed right after bold that ends with punctuation takes the bold off that punctuation', () => {
            const editor = load('**(a)** b');

            select(editor, [' b', 0]);
            typeChars(editor, 'x');

            expectSaveShowsSurface(editor);
            expect(editor.getValue()).toBe('**(a**)x b');
        });

        it('bold over the end of a styled word and the start of the next settles: the space between is not joined into the bold', () => {
            const editor = load('A [red]{color=#cc0000} word.');

            select(editor, ['red', 1], [' word.', 2]);
            editor.toggleBold();

            expectSaveShowsSurface(editor);
        });

        /**
         * Pastes nodes at the selection, as a paste does.
         *
         * @param editor - The editor.
         * @param nodes - Builds the pasted nodes; runs inside the update.
         */
        function pasteNodes(editor: MarkdownEditor, nodes: () => LexicalNode[]): void {
            edit(editor, () => {
                const selection = $getSelection()!;

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes: nodes(), selection })) {
                    selection.insertNodes(nodes());
                }
            });
        }

        it('strikethrough over the end of one emphasis and into the next keeps the space between struck, as shown', () => {
            const editor = load('1. _under_ and __strong__');

            select(editor, ['under', 2], ['strong', 4]);
            editor.toggleStrikethrough();

            expectSaveShowsSurface(editor);
        });

        it('text typed over the rest of a line after a run whose source writes its own strikethrough keeps no struck edge space', () => {
            const editor = load('[~~[6]()~~]() x');

            // The selection opens at the end of the run, so the typed text takes its strikethrough.
            select(editor, ['6', 1], [' x', 2]);
            edit(editor, () => ($getSelection() as RangeSelection).insertText(' w'));

            expect(runs(editor).slice(1)).toEqual([[' ', 0], ['w', STRIKETHROUGH]]);
            expectSaveShowsSurface(editor);
        });

        it('a source run of inline HTML in a line still lets bold over a styled span move inside it, so it closes before a word', () => {
            const editor = load('<br> a **[b]{size=1.2em}** c');

            select(editor, [' c', 0], [' c', 1]);
            edit(editor, () => ($getSelection() as RangeSelection).removeText());

            expect(editor.getValue()).toBe('<br> a [**b**]{size=1.2em}c');
            expectSaveShowsSurface(editor);
        });

        it('italic tildes pasted right after a word lose the italic, whose delimiter could not open before them', () => {
            const editor = load('word');

            select(editor, ['word', 4]);
            pasteNodes(editor, () => [$createTextNode('~~**').toggleFormat('italic')]);

            expectSaveShowsSurface(editor);
        });

        it('text typed right after a construct kept as written, so that it would read differently, makes it ordinary text', () => {
            const editor = load('# 1http://3');

            edit(editor, () => {
                const typed = $createTextNode('x');

                $getRoot().getFirstChildOrThrow<ElementNode>().append(typed);
                typed.select();
            });

            expect(readDocument(editor, () => $dfs().some(({ node }) => $isMarkdownSourceTextNode(node)))).toBe(false);
            expectSaveShowsSurface(editor);
        });

        it('brackets typed into a styled span show unstyled, as the save writes them outside it', () => {
            const editor = load('[ab]{color=red}');

            select(editor, ['ab', 1]);
            edit(editor, () => {
                const selection = $getSelection() as RangeSelection;

                // A caret placed in the view takes the style of the text it sits in.
                selection.setStyle(selection.anchor.getNode().getStyle());
                selection.insertText('[x]');
            });

            expect(readDocument(editor, () => $dfs().filter(({ node }) => $isTextNode(node) && /[[\]]/.test(node.getTextContent()))
                .every(({ node }) => (node as ReturnType<typeof $createTextNode>).getStyle() === ''))).toBe(true);
            expectSaveShowsSurface(editor);
        });

        it('a plus sign typed into underlined text shows without the underline, as the save writes it', () => {
            const editor = load('++ab++');

            select(editor, ['ab', 1]);
            edit(editor, () => {
                const selection = $getSelection() as RangeSelection;

                selection.setFormat(8);
                selection.insertText('+');
            });

            expect(runs(editor)).toEqual([['a', 8], ['+', 0], ['b', 8]]);
            expectSaveShowsSurface(editor);
        });

        it('a bold typing shortcut after a space still applies (control)', () => {
            const editor = load('p');

            select(editor, ['p', 1]);
            typeChars(editor, ' **a**');

            expect(editor.getValue()).toBe('p **a**');
        });
    });

    describe('a table stays rectangular, aligned by column', () => {
        /**
         * The table's cells, row by row, as `text:alignment`.
         *
         * @param editor - The editor.
         * @returns One array per row.
         */
        function cells(editor: MarkdownEditor): string[][] {
            return readDocument(editor, () => $getRoot().getChildren().filter($isTableNode).flatMap((table) => table.getChildren()
                .filter($isTableRowNode)
                .map((row) => row.getChildren().filter($isTableCellNode)
                    .map((cell) => `${cell.getTextContent()}:${cell.getFormatType() || '-'}`))));
        }

        it('a body cell given an alignment of its own takes its column\'s again', () => {
            const editor = load('| a | b |\n| --- | :---: |\n| 1 | 2 |');

            edit(editor, () => {
                const row = $getRoot().getFirstChildOrThrow<ElementNode>().getLastChildOrThrow<ElementNode>();

                (row.getLastChildOrThrow() as ElementNode).setFormat('right');
                (row.getFirstChildOrThrow() as ElementNode).setFormat('center');
            });

            expect(cells(editor)).toEqual([['a:-', 'b:center'], ['1:-', '2:center']]);
            expectSaveShowsSurface(editor);
        });

        it('a table pasted into a cell takes the columns\' alignment', () => {
            const editor = load('| a | b |\n| --- | :---: |\n| 1 | 2 |');

            select(editor, ['1', 1]);
            edit(editor, () => {
                const row = (texts: string[]): ReturnType<typeof $createTableRowNode> => $createTableRowNode().append(
                    ...texts.map((text) => $createTableCellNode().append($createParagraphNode().append($createTextNode(text)))));
                const nodes = [$createTableNode().append(row(['x', 'y']), row(['z', 'w']))];
                const selection = $getSelection()!;

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                    selection.insertNodes(nodes);
                }
            });

            expect(cells(editor).every((row) => row[1]?.endsWith(':center'))).toBe(true);
            expectSaveShowsSurface(editor);
        });

        it('a body row left short of the header is filled with empty cells', () => {
            const editor = load('| a | b | c |\n| --- | --- | ---: |\n| 1 | 2 | 3 |');

            edit(editor, () => {
                const row = $getRoot().getFirstChildOrThrow<ElementNode>().getLastChildOrThrow<ElementNode>();

                row.getLastChildOrThrow().remove();
            });

            expect(cells(editor)).toEqual([['a:-', 'b:-', 'c:right'], ['1:-', '2:-', ':right']]);
            expectSaveShowsSurface(editor);
        });

        for (const [name, build] of [
            ['a list', () => [$createListNode('bullet').append(
                $createListItemNode().append($createTextNode('x')),
                $createListItemNode().append($createListNode('bullet').append($createListItemNode().append($createTextNode('y')))),
            )]],
            ['a heading', () => [$createHeadingNode('h2').append($createTextNode('x'))]],
            ['a quote and a paragraph', () => [$createQuoteNode().append($createTextNode('x')), $createParagraphNode().append($createTextNode('y'))]],
        ] as const) {
            it(`${name} pasted into a table cell becomes the lines of text the cell saves`, () => {
                const editor = load('| a |\n| --- |\n| 1 |');

                select(editor, ['1', 1]);
                edit(editor, () => {
                    const selection = $getSelection()!;
                    const nodes = build();

                    if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes, selection })) {
                        selection.insertNodes(nodes);
                    }
                });

                expect(readDocument(editor, () => $dfs().filter(({ node }) => $isTableCellNode(node))
                    .every(({ node }) => (node as ElementNode).getChildren().every((child) => $isParagraphNode(child))))).toBe(true);
                expectSaveShowsSurface(editor);
            });
        }

        it('a cell spanning rows past a removed last row spans only the rows left', () => {
            const editor = load('| a |\n| --- |\n| b |\n| ^^ |');

            edit(editor, () => {
                $getRoot().getFirstChildOrThrow<ElementNode>().getLastChildOrThrow().remove();
            });

            expect(readDocument(editor, () => $dfs().filter(({ node }) => $isTableCellNode(node))
                .map(({ node }) => (node as ReturnType<typeof $createTableCellNode>).getRowSpan()))).toEqual([1, 1]);
            expectSaveShowsSurface(editor);
        });

        it('a cell spanning rows down onto a cell of a lower row spans only the rows above it', () => {
            // Removing the first cell of the row holding `c` moves `c` left, under the merged `x` of the row below.
            const editor = load('| h1 | h2 | h3 |\n| --- | --- | --- |\n| a | b | c |\n| x | << | ^^ |');

            edit(editor, () => {
                $dfs().find(({ node }) => $isTableCellNode(node) && node.getTextContent() === 'a')!.node.remove();
            });

            expect(readDocument(editor, () => $dfs().filter(({ node }) => $isTableCellNode(node) && node.getTextContent() === 'c')
                .map(({ node }) => (node as ReturnType<typeof $createTableCellNode>).getRowSpan()))).toEqual([1]);
            expectSaveShowsSurface(editor);
        });

        it('a body row wider than the header widens the header', () => {
            const editor = load('| a |\n| --- |\n| 1 |');

            edit(editor, () => {
                const row = $getRoot().getFirstChildOrThrow<ElementNode>().getLastChildOrThrow<ElementNode>();

                row.append($createTableCellNode().append($createParagraphNode().append($createTextNode('2'))));
            });

            expect(cells(editor)).toEqual([['a:-', ':-'], ['1:-', '2:-']]);
            expectSaveShowsSurface(editor);
        });
    });

    describe('a soft break keeps the formats it shows', () => {
        it('an underlined soft break saves underlined', () => {
            const source = 'a+b++\n++a+b++';
            const editor = load(source);

            expectSurface(editor, source);
            expect(viewerModel(readDocument(editor, () => $serializeMarkdown())).blocks).toEqual(viewerModel(source).blocks);
            expectSaveShowsSurface(editor);
        });

        it('inline code over a soft break saves as one code span', () => {
            const editor = load('> bar\n!baz');

            select(editor, ['bar', 0], ['baz', 0]);
            editor.toggleInlineCode();

            expect(editor.getValue()).toBe('> `bar !`baz');
            expectSaveShowsSurface(editor);
        });

        it('inline code ending on a soft break keeps the code before it (control)', () => {
            const editor = load('bar\nbaz');

            select(editor, ['bar', 0], ['baz', 0]);
            editor.toggleInlineCode();

            expectSaveShowsSurface(editor);
        });
    });

    describe('a link that shows nothing at a block\'s edge', () => {
        it('a link around a soft break, split to the start of a paragraph, is not kept', () => {
            const editor = load('inner\ninner');

            edit(editor, () => {
                const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();
                const soft = paragraph.getChildAtIndex(1)!;
                const selection = $createRangeSelection();

                selection.anchor.set(paragraph.getKey(), 1, 'element');
                selection.focus.set(paragraph.getKey(), 2, 'element');
                $setSelection(selection);
                expect($isMarkdownSourceTextNode(soft)).toBe(true);
            });
            editor.toggleLink('https://l.test/x');
            select(editor, ['inner', 5]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertParagraph();
            });

            expect(readDocument(editor, () => $dfs().some(({ node }) => $isLinkNode(node)))).toBe(false);
            expectSaveShowsSurface(editor);
        });

        it('a link left holding only a soft break at a paragraph\'s end by a deletion inside it is not kept', () => {
            const editor = load('fo[o\nbaz');

            select(editor, ['fo[o', 4], ['baz', 3]);
            editor.toggleLink('https://l.test/x');
            select(editor, ['baz', 0], ['baz', 3]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(readDocument(editor, () => $dfs().some(({ node }) => $isLinkNode(node)))).toBe(false);
            expectSaveShowsSurface(editor);
        });
    });

    describe('a raw block that saves as a paragraph shows as one', () => {
        it('an unclosed comment followed by a new block becomes the paragraph it saves as', () => {
            const editor = load('<!-- note');

            edit(editor, () => {
                $getRoot().append($createParagraphNode().append($createTextNode('new')));
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph']);
            expect(rootTexts(editor)).toEqual(['<!-- note', 'new']);
            expect(editor.getValue()).toBe('\\<!-- note\n\nnew');
            expectSaveShowsSurface(editor);
        });

        it('a comment edited open before a block becomes the paragraph it saves as, its lines kept', () => {
            const editor = load('<!-- x\ny -->\n\nb');

            select(editor, ['y -->', 1], ['y -->', 5]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph']);
            expect(editor.getValue()).toBe('\\<!-- x\\\ny\n\nb');
            expectSaveShowsSurface(editor);
        });

        it('an unclosed comment with nothing written after it stays a raw block (control)', () => {
            const editor = load('<!-- note');

            edit(editor, () => {
                $getRoot().append($createParagraphNode());
            });

            expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
            expect(editor.getValue()).toBe('<!-- note');
        });

        it('a comment edited and still closed stays a raw block (control)', () => {
            const editor = load('<!-- x -->\n\nb');

            select(editor, ['<!-- x -->', 5]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('y');
            });

            expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
            expect(editor.getValue()).toBe('<!-- yx -->\n\nb');
        });
    });

    describe('a raw block edited until it reads as several blocks shows as those blocks', () => {
        /**
         * Presses Enter at the selection as the keyboard does.
         *
         * @param editor - The editor.
         */
        function pressEnter(editor: MarkdownEditor): void {
            edit(editor, () => {
                const handled = lexicalOf(editor).dispatchCommand(
                    KEY_ENTER_COMMAND, { altKey: false, shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
                const selection = $getSelection();

                if (!handled && $isRangeSelection(selection)) {
                    selection.insertParagraph();
                }
            });
        }

        it('a blank line typed into an HTML block ends it: the text after it shows as its own paragraph', () => {
            const editor = load('<div>\ny');

            select(editor, ['<div>', 5]);
            pressEnter(editor);

            expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'paragraph']);
            expect(rootTexts(editor)).toEqual(['<div>', 'y']);
            expect(readDocument(editor, () => ($getSelection() as RangeSelection).anchor.getNode().getTextContent())).toBe('y');
            expectSaveShowsSurface(editor);
        });

        it('a fence pasted into a thematic break\'s text shows the paragraph and code block it saves as', () => {
            const editor = load('***');

            select(editor, ['***', 0]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertRawText(' a```\nb\n``` ');
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'code']);
            expectSaveShowsSurface(editor);
        });

        it('a raw block of definitions stays one block (control)', () => {
            const editor = load('[a]: /x\n[a]: /y');

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            select(editor, ['[a]: /y', 7]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertRawText('\n[b]: /z');
            });

            expect(rootTypes(editor)).toEqual(['markdown-raw-block']);
            expect(editor.getValue()).toBe('[a]: /x\n[a]: /y\n[b]: /z');
        });
    });

    describe('inline HTML opening a list item\'s continuation line', () => {
        it('saves escaped where it would end the item, so the item keeps it', () => {
            const editor = load('(\na\n  <div>');

            select(editor, ['(', 0]);
            editor.toggleOrderedList();

            expect(editor.getValue()).toBe('1. (\n   a\n   \\<div>');
            expectSaveShowsSurface(editor);
        });

        it('saves as written in a paragraph, where the paragraph takes it in (control)', () => {
            expect(load('(\na\n  <div>').getValue()).toBe('(\na\n  <div>');
        });
    });

    describe('an inline construct the standard form cannot write back is kept as written', () => {
        /**
         * Adds a word at the end of the first block, after its last node: the block is then written again.
         *
         * @param editor - The editor.
         */
        function appendWord(editor: MarkdownEditor): void {
            edit(editor, () => {
                $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode(' w'));
            });
        }

        /**
         * The texts of the first block's leaves that are plain text nodes, not kept as source.
         *
         * @param editor - The editor.
         * @returns Their texts, in order.
         */
        function plainTexts(editor: MarkdownEditor): string[] {
            return readDocument(editor, () => $dfs($getRoot().getFirstChildOrThrow())
                .map(({ node }) => node)
                .filter((node) => $isTextNode(node) && !$isMarkdownSourceTextNode(node))
                .map((node) => node.getTextContent()));
        }

        // [name, source, its save once a word is typed at the block's end]
        const cases: Array<[string, string, string]> = [
            ['strikethrough over a space before a linked image', '~~5 [![](g)]()~~', '~~5 [![](g)]()~~ w'],
            ['a bare URL right after a word, in a heading whose id it is part of', '# 1http://3', '# 1http://3 w'],
            ['a styled span with an attribute the editor drops, in a heading', '## [http://2]{m}', '## [http://2]{m} w'],
            ['a link holding a link, in a heading', '# [0[3]()](p)', '# [0[3]()](p) w'],
            ['a bare URL and the punctuation after it, which keeping it alone would read into it, in a heading', '## http://t>*', '## http://t>* w'],
            ['a link holding a link whose text escapes a bracket, in a heading', '# [`9`[\\[4]()](9)', '# [`9`[\\[4]()](9) w'],
            ['a struck link holding a link, its text escaping a bracket', '[~[a](/b) \\]~)]()', '[~[a](/b) \\]~)]() w'],
        ];

        for (const [name, source, saved] of cases) {
            it(`${name}: shows what the viewer shows and saves as written after an edit elsewhere`, () => {
                const editor = load(source);

                expectSurface(editor, source);
                expect(editor.getValue()).toBe(source);

                appendWord(editor);

                expect(editor.getValue()).toBe(saved);
                expectSaveShowsSurface(editor);
            });
        }

        it('only the construct is kept: the text around it stays plain, editable text', () => {
            const editor = load('x ~~5 [![](g)]()~~ y');

            expect(plainTexts(editor)).toEqual(['x ', ' y']);
            appendWord(editor);
            expect(editor.getValue()).toBe('x ~~5 [![](g)]()~~ y w');
        });

        it('clearing formatting over a construct keeps the formats its source writes, its spaces\' too', () => {
            const editor = load('a ~~5 [![](g)]()~~ w');

            select(editor, ['a ', 0], [' w', 2]);
            editor.clearFormatting();

            expect(editor.getValue()).toBe('a ~~5 [![](g)]()~~ w');
            expectSaveShowsSurface(editor);
        });

        it('a construct an edit takes apart shows and saves what is left of it, as ordinary text', () => {
            const editor = load('~~5 [![](g)]()~~ w');

            edit(editor, () => {
                $dfs().map(({ node }) => node).find($isMarkdownImageNode)!.remove();
            });

            expect(readDocument(editor, () => $dfs().some(({ node }) => $isMarkdownSourceTextNode(node)))).toBe(false);
            expectSaveShowsSurface(editor);
        });
    });

    describe('a raw block edited until it reads as one block the editor holds shows as that block', () => {
        it('an HTML block whose tag a deletion broke shows as the paragraph it saves as', () => {
            const editor = load('<div>\nx *y*</div>\n\nb');

            select(editor, ['<div>', 0], ['<div>', 3]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph']);
            expectSaveShowsSurface(editor);
        });

        it('a comment typed into until it reads as a heading shows as that heading, the caret kept in its text', () => {
            const editor = load('<!-- a -->');

            select(editor, ['<!-- a -->', 0], ['<!-- a -->', 4]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('#');
            });

            expect(rootTypes(editor)).toEqual(['heading']);
            expect(rootTexts(editor)).toEqual(['a -->']);
            expectSaveShowsSurface(editor);
        });

        it('the halves of a definition a paste split show and save as the paragraphs they read as, not one definition', () => {
            const editor = load('x');

            edit(editor, () => {
                $getRoot().clear();
                $getRoot().append($createMarkdownRawBlockNode('[foo'), $createMarkdownRawBlockNode('bar]: /url'));
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph']);
            expect(rootTexts(editor)).toEqual(['[foo', 'bar]: /url']);
            expect(viewerModel(editor.getValue()).blocks).toHaveLength(2);
            expectSaveShowsSurface(editor);
        });

        it('a label opened in a raw block and closed two blocks later shows and saves as three paragraphs', () => {
            const editor = load('x');

            edit(editor, () => {
                $getRoot().clear();
                $getRoot().append(
                    $createMarkdownRawBlockNode('[x'), $createMarkdownRawBlockNode('b'), $createMarkdownRawBlockNode('1]:\n  https://e.com'));
            });

            expect(rootTypes(editor)).toEqual(['paragraph', 'paragraph', 'paragraph']);
            expectSaveShowsSurface(editor);
        });

        it('a raw block still reading as a definition or an HTML block stays raw (control)', () => {
            const editor = load('[a]: /x\n\n<div>\ny\n</div>');

            select(editor, ['[a]: /x', 7]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('z');
            });
            select(editor, ['y', 1]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('z');
            });

            expect(rootTypes(editor)).toEqual(['markdown-raw-block', 'markdown-raw-block']);
            expect(editor.getValue()).toBe('[a]: /xz\n\n<div>\nyz\n</div>');
        });
    });

    describe('stack fuzz round 2: what an edit leaves shows as it saves', () => {
        /**
         * Pastes nodes at the selection, as a paste does: `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`, else `insertNodes`.
         *
         * @param editor - The editor.
         * @param nodes - Builds the pasted nodes; runs inside the update.
         */
        function pasteAt(editor: MarkdownEditor, nodes: () => LexicalNode[]): void {
            edit(editor, () => {
                const selection = $getSelection()!;
                const pasted = nodes();

                if (!lexicalOf(editor).dispatchCommand(SELECTION_INSERT_CLIPBOARD_NODES_COMMAND, { nodes: pasted, selection })) {
                    selection.insertNodes(pasted);
                }
            });
        }

        /**
         * A text node with the given formats.
         *
         * @param content - Its text.
         * @param formats - Its formats.
         * @returns The text node.
         */
        function formatted(content: string, ...formats: Array<'bold' | 'italic' | 'strikethrough' | 'code'>): LexicalNode {
            const node = $createTextNode(content);

            formats.forEach((format) => node.toggleFormat(format));

            return node;
        }

        /**
         * A one-column table of a header cell and a body cell.
         *
         * @returns The table.
         */
        function smallTable(): LexicalNode {
            const row = (text: string): LexicalNode => $createTableRowNode().append(
                $createTableCellNode().append($createParagraphNode().append($createTextNode(text))));

            return $createTableNode().append(row('h'), row('c'));
        }

        it('an item opening with a table and holding a nested list after it is loose, as its save reads', () => {
            const editor = load('- a');

            edit(editor, () => {
                const item = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow<ElementNode>();

                item.clear();
                item.append(smallTable(), $createListNode('bullet').append($createListItemNode().append($createTextNode('b'))));
            });

            expect(readDocument(editor, () => $getState($getRoot().getFirstChildOrThrow(), listLooseState))).toBe(true);
            expectSaveShowsSurface(editor);
        });

        it('two nested lists of one marker in one item are written apart, each its own list', () => {
            const editor = load('- a');

            edit(editor, () => {
                const nested = (text: string): LexicalNode => $createListItemNode().append(
                    $createListNode('bullet').append($createListItemNode().append($createTextNode(text))));

                $getRoot().getFirstChildOrThrow<ElementNode>().append(nested('b'), nested('c'));
            });

            expectSaveShowsSurface(editor);
        });

        it('a nested list after a raw list of its marker in one item is written with the other marker', () => {
            const editor = load('- a');

            edit(editor, () => {
                const item = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow<ElementNode>();
                const nested = $createListNode('number', 3).append($createListItemNode().append($createTextNode('y')));

                $setState(nested, listMarkerState, ')');
                // A list whose item holds a second paragraph: the editor's list nodes cannot hold it, so it stays raw.
                item.getLastChildOrThrow().insertAfter($createMarkdownRawBlockNode('1) x\n\n   p'));
                item.getLastChildOrThrow().insertAfter(nested);
            });

            // The raw list and the nested list read as two lists of the item, as the editor holds them.
            const item = (viewerModel(editor.getValue()).blocks[0] as unknown as { items: Array<Array<{ kind: string }>> }).items[0]!;

            expect(item.map((block) => block.kind)).toEqual(['paragraph', 'list', 'list']);
        });

        it('a range deleted from a table\'s header row into a merged body row leaves no header span the save cannot write', () => {
            const editor = load('```\nx\n```\n\n| a | b | c |\n| --- | --- | --- |\n| d | << | f |\n| ^^ | ^^ | g |');

            select(editor, ['x', 1], ['c', 1]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });

            expectSaveShowsSurface(editor);
        });

        it('a paste that leaves a run no writing reads back as shown shows the run as its save reads', () => {
            const editor = load('p');

            select(editor, ['p', 1]);
            pasteAt(editor, () => [formatted('x ` ', 'code'), formatted('d ~e', 'strikethrough'), $createTextNode('f '), formatted('y ` z', 'code')]);

            expectSaveShowsSurface(editor);
        });

        it('a run holding a link nested in a link is read back, so a paste breaking its emphasis shows as saved', () => {
            const editor = load('***[ab]{font=Georgia} [[c](/x)](/y)***');

            select(editor, ['ab', 1]);
            pasteAt(editor, () => [$createTextNode('Q')]);

            expectSaveShowsSurface(editor);
        });

        it('a reference image kept as source, a link written right after it, is written so the two stay apart', () => {
            const editor = load('![foo]\n\n[foo]: /url');

            edit(editor, () => {
                $getRoot().getFirstChildOrThrow<ElementNode>().append($createLinkNode('/u').append($createTextNode('x')));
            });

            expect(editor.getValue()).toBe('![foo][][x](/u)\n\n[foo]: /url');
            // The paragraph reads as the editor shows it (the definition's raw block shows nothing in the viewer).
            expect(viewerModel(editor.getValue()).blocks[0]).toEqual(editorSurfaceModel(editor)[0]);
        });

        it('a list before a raw block whose indented list it would take in is kept apart from it', () => {
            const editor = load('- a');

            edit(editor, () => {
                // An item holding a second paragraph: the editor's list nodes cannot hold it, so the block stays raw.
                $getRoot().append($createMarkdownRawBlockNode('  + b\n\n    p\n\n+ c'));
            });

            const list = viewerModel(editor.getValue()).blocks[0] as unknown as { items: Array<Array<{ kind: string }>> };

            expect(list.items).toHaveLength(1);
            expect(list.items[0]!.map((block) => block.kind)).toEqual(['paragraph']);
        });

        it('a link a paste leaves with no content is removed: it shows nothing and the save writes nothing', () => {
            const editor = load('a [b](/u) c');

            select(editor, ['a ', 1]);
            pasteAt(editor, () => [$createTextNode('q'), $createLinkNode('/v')]);

            expect(readDocument(editor, () => $dfs().some(({ node }) => $isLinkNode(node) && node.getChildrenSize() === 0))).toBe(false);
            expect(editor.getValue()).toBe('aq [b](/u) c');
        });

        it('a fence keeps the attributes it was loaded with when its content is edited', () => {
            const editor = load('::: {x1=2 align=right}\na\n:::');

            select(editor, ['a', 1]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('b');
            });

            expect(editor.getValue()).toBe('::: {x1=2 align=right}\nab\n:::');
        });

        it('a level 2 heading whose continuation line keeps an indent before a source run is written on one line', () => {
            const editor = load('x\n    [[a](/1)[b](/2)](/o)');

            select(editor, ['x', 1]);
            editor.setBlockType('h2');
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('y');
            });

            expect(rootTypes(editor)).toEqual(['heading']);
            expectSaveShowsSurface(editor);
        });

        it('a table cell is read back whole, so a tag its paragraphs form together shows as saved', () => {
            const editor = load('| h |\n| --- |\n| q |');

            select(editor, ['q', 1]);
            pasteAt(editor, () => [
                $createParagraphNode().append($createTextNode('x <'), $createLinkNode('/u').append($createTextNode('y'))),
                $createParagraphNode().append(formatted('c', 'italic'), $createTextNode(' z>')),
            ]);

            expectSaveShowsSurface(editor);
        });

        it('an image inserted right after an image kept as written shows that source as the text it now reads as', () => {
            const editor = load('![a](data(:image/svg+xml;base64,AAAA)');

            edit(editor, () => {
                $getRoot().selectEnd();
            });
            editor.insertImage('https://i.test/b.png', { alt: 'b' });

            expectSaveShowsSurface(editor);
        });
    });

    describe('a task marker left alone in its item', () => {
        // Without text after it on its line, `[x]` is no checkbox: the viewer
        // reads it as text, or as a reference link where a definition names
        // it. The marker kept as source is then written as the text it shows.
        const cases: Array<[string, string, string]> = [
            ['with a definition naming its label', '- [x] a\n\n[x]: /u', '- \\[x\\]\n\n[x]: /u'],
            ['unchecked', '- [ ] a', '- \\[ \\]'],
        ];

        for (const [name, source, saved] of cases) {
            it(`${name}: saves as the text it shows`, () => {
                const editor = load(source);

                select(editor, ['a', 0], ['a', 1]);
                edit(editor, () => {
                    lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
                });

                // The list alone: a definition shows as a raw block in the editor and as nothing in the viewer.
                expect(editor.getValue()).toBe(saved);
                expect(editorSurfaceModel(editor)[0]).toEqual(viewerModel(saved).blocks[0]);
                expect(load(saved).getValue()).toBe(saved);
            });
        }

        it('a checkbox that text typed before it leaves inside its item\'s line saves as the text it shows', () => {
            // `[x]` after text is no checkbox: the viewer reads it as a reference link where a definition names it.
            const source = '- [x] done\n\n[x]: https://e.com';
            const editor = load(source);

            select(editor, ['[x] ', 0]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('}}');
            });

            const saved = editor.getValue();

            expect(saved).toBe('- }}\\[x\\] done\n\n[x]: https://e.com');
            expect(editorSurfaceModel(editor)[0]).toEqual(viewerModel(saved).blocks[0]);
            expect(load(saved).getValue()).toBe(saved);
        });

        it('a checkbox a line break moves off its item\'s first line saves as the text it shows', () => {
            const editor = load('- [x] done\n\n[x]: /u');

            select(editor, ['[x] ', 0]);
            edit(editor, () => {
                ($getSelection() as RangeSelection).insertText('a');
                ($getSelection() as RangeSelection).insertLineBreak();
            });

            const saved = editor.getValue();

            expect(saved).toBe('- a\\\n  \\[x\\] done\n\n[x]: /u');
            expect(editorSurfaceModel(editor)[0]).toEqual(viewerModel(saved).blocks[0]);
        });
    });

    describe('stack fuzz round 4: what an edit leaves shows as it saves', () => {
        /**
         * Presses Enter at the selection as the keyboard does.
         *
         * @param editor - The editor.
         */
        function pressEnter(editor: MarkdownEditor): void {
            edit(editor, () => {
                const handled = lexicalOf(editor).dispatchCommand(
                    KEY_ENTER_COMMAND, { altKey: false, shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
                const selection = $getSelection();

                if (!handled && $isRangeSelection(selection)) {
                    selection.insertParagraph();
                }
            });
        }

        it('Enter between two code spans in a bold table cell shows the cell as its save reads', () => {
            // The cell's paragraphs are written on one line; the code spans' backticks hide the bold delimiters
            // next to the break from pairing, so the cell as a whole does not read back as two bold runs.
            const editor = load('| __`` a ` x `` `` a ` y ``__ |\n| --- |');

            select(editor, ['a ` y', 0]);
            pressEnter(editor);

            expectSaveShowsSurface(editor);
        });

        it('a format a selection from a list into the next paragraph cannot apply keeps a construct kept as written in the list', () => {
            // The declined edit puts the list back from its JSON: the image's place in the kept construct must survive it.
            const source = '- ~[![a](/i.png)](/p) [[b c](/p_(q))](/out)~\n- [[e &#35;](/x)]\n\nf';
            const editor = load(source);

            select(editor, ['e &#35;', 6], ['f', 1]);
            editor.toggleStrikethrough();

            expect(editor.getValue()).toContain('~[![a](/i.png)](/p) [[b c](/p_(q))](/out)~');
            expectSaveShowsSurface(editor);
        });

        it('two nested lists of an item, the first an empty item under the item\'s text, stay two lists', () => {
            const editor = load('- a\n  - b\n- d\n  - e\n  - f');

            select(editor, ['b', 0], ['e', 1]);
            edit(editor, () => {
                lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
            });
            select(editor, ['f', 0]);
            pressEnter(editor);

            expectSaveShowsSurface(editor);
        });
    });
});
