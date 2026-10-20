import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { viewerModel, editorSurfaceModel, linkTargets } from './viewModel';
import type { Run, Mark, LinkTarget, Cell } from './viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * Builds the checkbox run the projection emits for a task item's checkbox.
 *
 * @param checked - Whether the box is checked.
 * @returns The checkbox run.
 */
function checkboxRun(checked: boolean): Run {
    return { kind: 'checkbox', checked };
}

/**
 * Builds the text run the projection emits for `text` with the given marks and link, and no span style.
 *
 * @param text - The run's text.
 * @param marks - The run's marks, in the projection's fixed order.
 * @param link - The run's link target, or `null` for none.
 * @returns The text run.
 */
function textRun(text: string, marks: Mark[] = [], link: LinkTarget | null = null): Run {
    return { kind: 'text', text, marks, link, style: null };
}

/**
 * Builds an unaligned, unmerged table cell holding one plain text run.
 *
 * @param text - The cell's text.
 * @returns The cell.
 */
function plainCell(text: string): Cell {
    return { align: null, colSpan: 1, rowSpan: 1, runs: [textRun(text)] };
}

/**
 * Builds a headless editor loaded with `source`, the way the round-trip harness does.
 *
 * @param source - The Markdown to load.
 * @returns The loaded editor.
 */
function loadedEditor(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

describe('viewer projection', () => {
    it('V1. splits a paragraph into runs at each change of marks', () => {
        expect(viewerModel('A **b** c').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('A '), textRun('b', ['bold']), textRun(' c')] },
        ]);
    });

    it('V2. flattens nested emphasis into one run carrying both marks', () => {
        expect(viewerModel('***both***').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('both', ['bold', 'italic'])] },
        ]);
    });

    it('V3. collapses a soft break to one space', () => {
        expect(viewerModel('a\nb').blocks).toEqual([{ kind: 'paragraph', runs: [textRun('a b')] }]);
    });

    it('V4. resolves a reference link and gives its definition no block', () => {
        expect(viewerModel('[x]\n\n[x]: https://e.com').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('x', [], { href: 'https://e.com', title: null })] },
        ]);
    });

    it('V5. projects a thematic break to a rule', () => {
        expect(viewerModel('---').blocks).toEqual([{ kind: 'rule' }]);
    });

    it('V6. projects an empty or blank document to no blocks and no headings', () => {
        expect(viewerModel('')).toEqual({ blocks: [], headingIds: [] });
        expect(viewerModel('\n\n\n')).toEqual({ blocks: [], headingIds: [] });
    });

    it('V7. drops the closing newline of an indented code block', () => {
        expect(viewerModel('    foo\n').blocks).toEqual([{ kind: 'code', lang: null, text: 'foo' }]);
    });

    it('V8. drops a paragraph whose only image the viewer rejects', () => {
        expect(viewerModel('![a](data:image/svg+xml;base64,AAAA)').blocks).toEqual([]);
    });

    it('V9. equates a styled span with the same span split around its bold run', () => {
        expect(viewerModel('[**bold** span]{color=blue}')).toEqual(viewerModel('[**bold**]{color=blue}[ span]{color=blue}'));
    });

    it('V10. dedupes repeated heading ids the way the viewer does', () => {
        expect(viewerModel('# a\n# a').headingIds).toEqual(['a', 'a-1']);
    });

    it('V11. copies a list\'s loose flag and turns each item into blocks', () => {
        expect(viewerModel('- a\n\n- b').blocks).toEqual([
            {
                kind:    'list',
                ordered: false,
                loose:   true,
                items:   [[{ kind: 'paragraph', runs: [textRun('a')] }], [{ kind: 'paragraph', runs: [textRun('b')] }]],
            },
        ]);
    });

    it('V12. projects a table\'s widths, header and body cells', () => {
        expect(viewerModel('| a |\n| --- |\n| x |').blocks).toEqual([
            { kind: 'table', widths: [null], header: [plainCell('a')], rows: [[plainCell('x')]] },
        ]);
    });

    it('V13. keeps only the first word of a fence\'s info string', () => {
        expect(viewerModel('```js extra\nx\n```').blocks).toEqual([{ kind: 'code', lang: 'js', text: 'x' }]);
    });

    it('V14. keeps a link\'s title and lists its target', () => {
        const model = viewerModel('[t](https://e.com "T")');

        expect(model.blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('t', [], { href: 'https://e.com', title: 'T' })] },
        ]);

        expect(linkTargets(model)).toEqual(['https://e.com']);
    });

    it('V15. resolves a reference in a table cell to a later definition', () => {
        expect(linkTargets(viewerModel('| a |\n| --- |\n| [r] |\n\n[r]: https://e.com'))).toEqual(['https://e.com']);
    });

    it('V16. shows a task item\'s checkbox as the first run of its paragraph', () => {
        expect(viewerModel('- [ ] task').blocks).toEqual([
            { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [checkboxRun(false), textRun('task')] }]] },
        ]);
    });

    it('V17. maps a hard line break to a break run', () => {
        expect(viewerModel('foo  \nbar').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('foo'), { kind: 'break' }, textRun('bar')] },
        ]);
    });

    it('V18. shows a task item\'s checkbox before text holding an escape', () => {
        expect(viewerModel('- [ ] see \\[docs\\]').blocks).toEqual([
            { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [checkboxRun(false), textRun('see [docs]')] }]] },
        ]);
    });

    it('V19. shows the checkboxes of a loose task list', () => {
        expect(viewerModel('- [ ] a\n\n- [x] b').blocks).toEqual([
            {
                kind:    'list',
                ordered: false,
                loose:   true,
                items:   [
                [{ kind: 'paragraph', runs: [checkboxRun(false), textRun('a')] }],
                [{ kind: 'paragraph', runs: [checkboxRun(true), textRun('b')] }],
            ],
            },
        ]);
    });

    it('V20. shows a task item\'s checkbox at the start of its first paragraph when a paragraph, not a text run, follows it', () => {
        expect(viewerModel('- [ ] foo\n\n  [x] bar').blocks).toEqual([
            {
                kind:    'list',
                ordered: false,
                loose:   true,
                items:   [[
                    { kind: 'paragraph', runs: [checkboxRun(false), textRun('foo')] },
                    { kind: 'paragraph', runs: [textRun('[x] bar')] },
                ]],
            },
        ]);
    });

    it('V22. shows the checkbox of a task item a nested list after a blank line makes loose as a list loose from the start does', () => {
        const items = (source: string): unknown => (viewerModel(source).blocks[0] as { items: unknown[] }).items[0];

        expect(items('- [x] **a** b\n\n  - c')).toEqual([
            { kind: 'paragraph', runs: [checkboxRun(true), textRun('a', ['bold']), textRun(' b')] },
            { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [textRun('c')] }]] },
        ]);
        expect(items('- [x] **a** b\n\n- c')).toEqual([
            { kind: 'paragraph', runs: [checkboxRun(true), textRun('a', ['bold']), textRun(' b')] },
        ]);
    });

    it('V21. keeps a later table cell\'s marker text in a task item, beside the item\'s checkbox', () => {
        expect(viewerModel('- [ ] foo\n  | a |\n  | - |\n  | [x] baz |').blocks).toEqual([
            {
                kind:    'list',
                ordered: false,
                loose:   false,
                items:   [[
                    { kind: 'paragraph', runs: [checkboxRun(false), textRun('foo')] },
                    { kind: 'table', widths: [null], header: [plainCell('a')], rows: [[plainCell('[x] baz')]] },
                ]],
            },
        ]);
    });

    it('WS1. drops a space that follows a space, across a run boundary, as HTML collapses it', () => {
        expect(viewerModel('++a&#32;++ b').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('a ', ['underline']), textRun('b')] },
        ]);
    });

    it('WS2. trims the spaces at a line edge, through a run the trim empties', () => {
        expect(viewerModel('++&#32;++ a').blocks).toEqual([{ kind: 'paragraph', runs: [textRun('a')] }]);
    });

    it('WS3. gives a space the bold and italic of the text on both sides of it, since a space shows neither', () => {
        expect(viewerModel('**a** **b**').blocks).toEqual(viewerModel('**a b**').blocks);
        expect(viewerModel('**a** **b**').blocks).toEqual([{ kind: 'paragraph', runs: [textRun('a b', ['bold'])] }]);
        expect(viewerModel('***a*** *b*').blocks).toEqual([
            { kind: 'paragraph', runs: [textRun('a', ['bold', 'italic']), textRun(' b', ['italic'])] },
        ]);
    });
});

describe('underline pairs its ++ marks as strikethrough pairs ~~', () => {
    const u = (text: string): Run => textRun(text, ['underline']);
    const t = (text: string): Run => textRun(text);

    // Each row: the source, what the viewer shows, and the `~~` form of the same source, which must show the same with
    // strikethrough in place of underline.
    const ROWS: ReadonlyArray<[source: string, runs: Run[]]> = [
        ['C++ and C++', [t('C++ and C++')]],
        ['Use C++ or C++20.', [t('Use C++ or C++20.')]],
        ['x ++ y ++ z', [t('x ++ y ++ z')]],
        ['++a ++', [t('++a ++')]],
        ['++ a++', [t('++ a++')]],
        ['a++ b++', [t('a++ b++')]],
        ['a++b++c', [t('a'), u('b'), t('c')]],
        ['++a++b', [u('a'), t('b')]],
        ['(++a++)', [t('('), u('a'), t(')')]],
        ['++a+b++', [u('a+b')]],
        ['++a++ and C++', [u('a'), t(' and C++')]],
        ['++C++ is fun++', [u('C'), t(' is fun++')]],
        ['++a ++b++ c++', [u('a b c')]],
    ];

    for (const [source, runs] of ROWS) {
        it(`${JSON.stringify(source)} shows as the ~~ form does`, () => {
            const struck = runs.map((run) => (run.kind === 'text' && run.marks.includes('underline') ? textRun(run.text, ['strike']) : run));

            expect(viewerModel(source).blocks).toEqual([{ kind: 'paragraph', runs }]);
            expect(viewerModel(source.replace(/\+/g, '~')).blocks).toEqual([{ kind: 'paragraph', runs: struck.map((run) => (run.kind === 'text' ? textRun(run.text.replace(/\+/g, '~'), run.marks) : run)) }]);
        });
    }

    it('a run of three or more plus signs neither opens nor closes', () => {
        expect(viewerModel('+++a+++').blocks).toEqual([{ kind: 'paragraph', runs: [t('+++a+++')] }]);
        expect(viewerModel('++a++++b++').blocks).toEqual([{ kind: 'paragraph', runs: [u('a++++b')] }]);
        expect(viewerModel('a+++b+++c').blocks).toEqual([{ kind: 'paragraph', runs: [t('a+++b+++c')] }]);
    });

    it('an escaped plus is no part of a run, and a ++ in a code span or a link\'s text is not a mark of an underline around it', () => {
        expect(viewerModel('\\+++a++').blocks).toEqual([{ kind: 'paragraph', runs: [t('+'), u('a')] }]);
        expect(viewerModel('++a\\+++').blocks).toEqual([{ kind: 'paragraph', runs: [u('a+')] }]);
        expect(viewerModel('++a `b++` c++').blocks).toEqual([{ kind: 'paragraph', runs: [u('a '), textRun('b++', ['code', 'underline']), u(' c')] }]);
        expect(viewerModel('++[t](/a+b)++').blocks).toEqual([{ kind: 'paragraph', runs: [textRun('t', ['underline'], { href: '/a+b', title: null })] }]);
    });
});

describe('editor surface projection', () => {
    it('S1. drops Lexical\'s lone empty paragraph', () => {
        expect(editorSurfaceModel(loadedEditor(''))).toEqual([]);
    });

    it('S2. maps a line break inside a paragraph to a break run', () => {
        // A hard break: a soft one now loads as a source node showing a space (plan markdown-editor-marked-import, I1/I4).
        expect(editorSurfaceModel(loadedEditor('line one\\\nline two'))).toEqual([
            { kind: 'paragraph', runs: [textRun('line one'), { kind: 'break' }, textRun('line two')] },
        ]);
    });

    it('S3. folds Lexical\'s nested-list item into the item before it', () => {
        const source = '- a\n    - nested\n- c';
        const surface = editorSurfaceModel(loadedEditor(source));

        expect(surface).toEqual(viewerModel(source).blocks);

        expect(surface).toEqual([
            {
                kind:    'list',
                ordered: false,
                loose:   false,
                items:   [
                    [
                        { kind: 'paragraph', runs: [textRun('a')] },
                        { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [textRun('nested')] }]] },
                    ],
                    [{ kind: 'paragraph', runs: [textRun('c')] }],
                ],
            },
        ]);
    });

    it('S4. reads table widths, alignment and an unset width as null', () => {
        const source = '| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |';
        const surface = editorSurfaceModel(loadedEditor(source));

        expect(surface).toEqual(viewerModel(source).blocks);

        expect(surface[0]).toMatchObject({
            kind:   'table',
            widths: [240, null],
            header: [{ align: 'left' }, { align: 'right' }],
        });
    });

    it('S5. reads a column fence\'s gap and columns', () => {
        const source = '::: columns {gap=2rem}\nA\n|||\nB\n|||\nC\n:::';
        const surface = editorSurfaceModel(loadedEditor(source));

        expect(surface).toEqual(viewerModel(source).blocks);
        expect(surface).toHaveLength(1);
        expect(surface[0]).toMatchObject({ kind: 'fence', columnGap: '2rem' });
        expect((surface[0] as { columns: unknown[] }).columns).toHaveLength(3);
    });

    it('S6. resolves a text node\'s inline style to the span style', () => {
        const source = 'A [red]{color=#cc0000} word.';
        const surface = editorSurfaceModel(loadedEditor(source));

        expect(surface).toEqual(viewerModel(source).blocks);

        expect(surface).toEqual([
            {
                kind: 'paragraph',
                runs: [
                    textRun('A '),
                    { kind: 'text', text: 'red', marks: [], link: null, style: { color: '#cc0000', fontFamily: null, fontSize: null } },
                    textRun(' word.'),
                ],
            },
        ]);
    });

    it('S7. reads a sized image node as an image run', () => {
        const source = '![d](/img/d.png){width=320}';
        const surface = editorSurfaceModel(loadedEditor(source));

        expect(surface).toEqual(viewerModel(source).blocks);

        expect(surface).toEqual([
            { kind: 'paragraph', runs: [{ kind: 'image', src: '/img/d.png', alt: 'd', title: null, width: 320, height: null, link: null }] },
        ]);
    });

    it('S8. projects a quote node as a quote holding one paragraph', () => {
        expect(editorSurfaceModel(loadedEditor('> a quoted line'))).toEqual([
            { kind: 'quote', blocks: [{ kind: 'paragraph', runs: [textRun('a quoted line')] }] },
        ]);
    });

    it('IB1. projects an item\'s blocks in order, a block after its nested list last', () => {
        const editor = loadedEditor('x');
        const lexical = (editor as unknown as { _editor: LexicalEditor })._editor;

        lexical.update(() => {
            const itemText = (text: string): LexicalNode => $createMarkdownListItemTextNode().append($createTextNode(text));
            const nested = $createListNode('bullet').append($createListItemNode().append(itemText('n')));
            const item = $createListItemNode().append(itemText('a'), nested, $createParagraphNode().append($createTextNode('after')));
            const list = $createListNode('bullet').append(item);

            $getRoot().clear().append(list);
        }, { discrete: true });

        expect(editorSurfaceModel(editor)).toEqual([
            {
                kind:    'list',
                ordered: false,
                // An item holding a block after its nested list makes the list loose (the editor's looseness rule).
                loose:   true,
                items:   [
                    [
                        { kind: 'paragraph', runs: [textRun('a')] },
                        { kind: 'list', ordered: false, loose: false, items: [[{ kind: 'paragraph', runs: [textRun('n')] }]] },
                        { kind: 'paragraph', runs: [textRun('after')] },
                    ],
                ],
            },
        ]);
    });

    it('S9. drops a raw block holding only link reference definitions, which the viewer renders nothing for', () => {
        expect(editorSurfaceModel(loadedEditor('# H\n\n[x]: https://e.com'))).toEqual([
            { kind: 'heading', depth: 1, runs: [textRun('H')] },
        ]);
    });

    it('S10. maps a newline inside a text node to a break run, as the editor\'s pre-wrap surface shows it', () => {
        // A code block turned into a paragraph keeps its lines in one text node; the save writes each newline as a
        // hard break, which the viewer shows as the editor does.
        const editor = loadedEditor('');

        (editor as unknown as { _editor: LexicalEditor })._editor.update(() => {
            $getRoot().clear().append($createParagraphNode().append($createTextNode('x\n# y')));
        }, { discrete: true });

        expect(editorSurfaceModel(editor)).toEqual([
            { kind: 'paragraph', runs: [textRun('x'), { kind: 'break' }, textRun('# y')] },
        ]);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel('x\\\n\\# y').blocks);
    });

    it('S10. lets a run showing nothing (an empty link in emphasis) neither start a run nor split the one around it', () => {
        expect(editorSurfaceModel(loadedEditor('__[]()_,'))).toEqual([{ kind: 'paragraph', runs: [textRun('_,')] }]);
    });
});
