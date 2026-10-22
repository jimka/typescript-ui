import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createTextNode, $getRoot, $getState, $isElementNode, $parseSerializedNode } from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $isTableCellNode } from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createMarkdownImageNode, $isMarkdownImageNode } from '~/component/editor/markdownImageNode';
import type { MarkdownImageNode } from '~/component/editor/markdownImageNode';
import { imageWrittenState } from '~/component/editor/markdownNodeState';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

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
 * Runs `edit` as one discrete update of the editor's document.
 *
 * @param editor - The editor.
 * @param edit - The edit; runs inside `editor.update`.
 */
function update(editor: MarkdownEditor, edit: () => void): void {
    lexicalOf(editor).update(edit, { discrete: true });
}

/**
 * Appends the text `text` to the end of the document's first block.
 *
 * @param editor - The editor.
 * @param text - The text to append.
 */
function append(editor: MarkdownEditor, text: string): void {
    update(editor, () => {
        $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode(text));
    });
}

/**
 * The editor's image nodes, in document order.
 *
 * @param editor - The editor.
 * @returns The image nodes.
 */
function imageNodes(editor: MarkdownEditor): MarkdownImageNode[] {
    return lexicalOf(editor).read(() => $dfs().map(({ node }) => node).filter($isMarkdownImageNode));
}

/**
 * Saves the editor and checks that the viewer reads the save as the editor shows it.
 *
 * @param editor - The editor.
 * @returns The save.
 */
function expectShownAsSaved(editor: MarkdownEditor): string {
    const saved = editor.getValue();

    expect(viewerModel(saved).blocks).toEqual(editorSurfaceModel(editor));

    return saved;
}

describe('an image keeps the form it was written in', () => {
    it.each([
        ['a title', '![foo](/url "title")', '![foo](/url "title") x'],
        ['a title in single quotes', "![a](/i.png 't')", "![a](/i.png 't') x"],
        ['an angle-bracket destination', '![foo](<url>)', '![foo](<url>) x'],
        ['an image in the alt text', '![foo ![bar](/url)](/url2)', '![foo ![bar](/url)](/url2) x'],
        ['a collapsed reference with emphasis in its label', '![foo *bar*][]\n\n[foo *bar*]: train.jpg "train & tracks"', '![foo *bar*][] x\n\n[foo *bar*]: train.jpg "train & tracks"'],
        ['a shortcut reference with a size group', '![a]{width=10}\n\n[a]: /i.png', '![a]{width=10} x\n\n[a]: /i.png'],
        ['a full reference with a size group', '![a][r]{height=5}\n\n[r]: /i.png "T"', '![a][r]{height=5} x\n\n[r]: /i.png "T"'],
        ['spec 587: a shortcut reference before a line of brackets', '![foo] \n[]\n\n[foo]: /url "title"\n', '![foo]\n\\[\\] x\n\n[foo]: /url "title"\n'],
        ['a line feed in the alt text', '![a\nb](/i.png)', '![a\nb](/i.png) x'],
    ])('%s', (_name, source, saved) => {
        const editor = load(source);

        append(editor, ' x');

        expect(expectShownAsSaved(editor)).toBe(saved);
    });

    it('holds a line feed in the alt text of a loaded image', () => {
        const editor = load('![a\nb](/i.png)');

        expect(lexicalOf(editor).read(() => imageNodes(editor)[0]!.getAlt())).toBe('a\nb');
    });

    it('holds the title and the written form of a loaded image', () => {
        const editor = load('![foo](/url "title")');

        lexicalOf(editor).read(() => {
            const [image] = imageNodes(editor);

            expect(image!.getTitle()).toBe('title');
            expect($getState(image!, imageWrittenState)).toBe('![foo](/url "title")');
        });
    });

    it('keeps the title and the written form through its JSON', () => {
        const editor = load('![foo](/url "title")');
        const json = lexicalOf(editor).read(() => imageNodes(editor)[0]!.exportJSON());

        expect(json.title).toBe('title');

        update(editor, () => {
            const image = $parseSerializedNode(json) as MarkdownImageNode;

            expect(image.getTitle()).toBe('title');
            expect($getState(image, imageWrittenState)).toBe('![foo](/url "title")');
        });
    });

    it('loads a serialized image with no title key as an untitled image', () => {
        const editor = load('![foo](/url)');
        const json = lexicalOf(editor).read(() => imageNodes(editor)[0]!.exportJSON());

        delete json.title;
        update(editor, () => {
            expect(($parseSerializedNode(json) as MarkdownImageNode).getTitle()).toBeNull();
        });
    });
});

describe('a shortcut reference image is collapsed where the next character would join it', () => {
    const SHORTCUT = '![foo]\n\n[foo]: /url';

    it('before a link', () => {
        const editor = load(SHORTCUT);

        update(editor, () => {
            $getRoot().getFirstChildOrThrow<ElementNode>().append($createLinkNode('/u').append($createTextNode('x')));
        });

        expect(expectShownAsSaved(editor)).toBe('![foo][][x](/u)\n\n[foo]: /url');
    });

    it('before text that opens a parenthesis and a brace', () => {
        const editor = load(SHORTCUT);

        append(editor, '(x) {y}');

        expect(expectShownAsSaved(editor)).toBe('![foo][](x) {y}\n\n[foo]: /url');
    });

    it('is left as it is with a size group, which joins nothing', () => {
        const editor = load('![foo]{width=3}\n\n[foo]: /url');

        append(editor, '(x)');

        expect(expectShownAsSaved(editor)).toBe('![foo]{width=3}(x)\n\n[foo]: /url');
    });
});

describe('text that opens a size group, written right after an image, stays text', () => {
    const TYPED = ['{width=3}', '{x}', '{height=3} y'];

    it.each(TYPED)('after every kept image form: %s', (typed) => {
        const forms = [
            '![a](/i.png)',
            '![a](/i.png "t")',
            '![a][r]\n\n[r]: /i.png',
            '![a][]\n\n[a]: /i.png',
            '![a]\n\n[a]: /i.png',
        ];

        for (const source of forms) {
            const editor = load(source);

            append(editor, typed);

            const saved = expectShownAsSaved(editor);

            expect(saved).toContain('\\' + typed);
            expect(imageNodes(editor).length).toBe(1);
            expect(lexicalOf(editor).read(() => imageNodes(editor)[0]!.getImageWidth())).toBeNull();
            const reloaded = load(saved);

            expect(lexicalOf(reloaded).read(() => imageNodes(reloaded).length)).toBe(1);
        }
    });

    it.each(TYPED)('after an image made in the editor: %s', (typed) => {
        const editor = new MarkdownEditor();

        editor.insertImage('/i.png', { alt: 'a', title: 'T' });
        append(editor, typed);

        expect(expectShownAsSaved(editor)).toBe('![a](/i.png "T")\\' + typed);
    });

    it('a shortcut reference image is saved collapsed and the brace escaped', () => {
        const editor = load('![a]\n\n[a]: /i.png');

        append(editor, '{width=3}');

        expect(expectShownAsSaved(editor)).toBe('![a][]\\{width=3}\n\n[a]: /i.png');
    });
});

describe('a reference image is kept as text by escaping its brackets', () => {
    const DEFINITION = '\n\n[l]: /img/logo.png';

    it('escaped brackets show the source as typed, and no image', () => {
        expect(viewerModel('!\\[logo\\]\\[l\\]' + DEFINITION).blocks).toEqual([
            { kind: 'paragraph', runs: [{ kind: 'text', text: '![logo][l]', marks: [], link: null, style: null }] },
        ]);
    });

    it('an escaped ! alone shows a ! followed by a link, so it keeps no text', () => {
        expect(viewerModel('\\![logo][l]' + DEFINITION).blocks).toEqual([
            { kind: 'paragraph', runs: [
                { kind: 'text', text: '!', marks: [], link: null, style: null },
                { kind: 'text', text: 'logo', marks: [], link: { href: '/img/logo.png', title: null }, style: null },
            ] },
        ]);
    });
});

describe('an image keeps the emphasis it was read inside', () => {
    it.each([
        ['emphasis around a titled image', '*![a](/i.png "t")*', '*![a](/i.png "t")* x'],
        ['strong around a full reference image', '**![a][r]**\n\n[r]: /i.png', '**![a][r]** x\n\n[r]: /i.png'],
        ['emphasis around a shortcut reference image', '*![a]*\n\n[a]: /i.png', '*![a]* x\n\n[a]: /i.png'],
        ['emphasis inside a link, written around the link as text is', '[*![a](/i.png "t")*](/u)', '*[![a](/i.png "t")](/u)* x'],
        ['emphasis around a plain image', '*![a](/i.png)*', '*![a](/i.png)* x'],
        ['strikethrough around an angle-bracket image', '~~![a](<i.png>)~~', '~~![a](<i.png>)~~ x'],
        ['underline around an image', '++![a](/i.png)++', '++![a](/i.png)++ x'],
        ['strong and emphasis together around an image', '***![a](/i.png)***', '***![a](/i.png)*** x'],
        ['text and an image inside one strong run', '**a ![i](/i.png "t") b**', '**a ![i](/i.png "t") b** x'],
        ['an image between two emphasised words', '*a* ![i](/i.png) *b*', '*a* ![i](/i.png) *b* x'],
    ])('%s', (_name, source, saved) => {
        const editor = load(source);

        append(editor, ' x');

        expect(expectShownAsSaved(editor)).toBe(saved);

        const reloaded = load(saved);

        expect(editorSurfaceModel(reloaded)).toEqual(editorSurfaceModel(editor));
        expect(reloaded.getValue()).toBe(saved);
    });

    /** Selects the whole of the document's first block. */
    function selectAll(editor: MarkdownEditor): void {
        update(editor, () => {
            const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();

            paragraph.select(0, paragraph.getChildrenSize());
        });
    }

    it('clearing formatting over a range takes the marks off the images in it, as the text\'s', () => {
        const editor = load('**a ![i](/i.png "t") b**');

        selectAll(editor);
        editor.clearFormatting();

        expect(expectShownAsSaved(editor)).toBe('a ![i](/i.png "t") b');
    });

    it('toggling bold over a range leaves the marks of the images in it as they were, which the Notes record', () => {
        const editor = load('a ![i](/i.png) b');

        selectAll(editor);
        editor.toggleBold();

        expect(expectShownAsSaved(editor)).toBe('**a** ![i](/i.png) **b**');
    });

    /** An editor holding `lead` and then the image `**![a](/i.png)**` was read as, copied through JSON. */
    function withCopiedBoldImage(lead: string): MarkdownEditor {
        const source = load('**![a](/i.png)**');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const editor = load('q');

        update(editor, () => {
            const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();

            paragraph.clear();
            paragraph.append($createTextNode(lead), $parseSerializedNode(json));
        });

        return editor;
    }

    it('keeps the marks through the image\'s JSON, where their delimiters can pair', () => {
        expect(expectShownAsSaved(withCopiedBoldImage('z '))).toBe('z **![a](/i.png)**');
    });

    it('writes no mark around an image whose delimiters could not pair', () => {
        expect(expectShownAsSaved(withCopiedBoldImage('z'))).toBe('z![a](/i.png)');
    });
});

describe('insertImage', () => {
    it.each([
        ['brackets, emphasis marks and quotes', '/i.png', { alt: 'a [b] *c*', title: 'T "q"' }, '![a \\[b\\] \\*c\\*](/i.png "T \\"q\\"")'],
        ['a source with a space', '/a b.png', { alt: 'x' }, '![x](</a b.png>)'],
        ['a title ending in a backslash', '/i.png', { alt: 'a', title: 'x\\' }, '![a](/i.png "x&#92;")'],
        ['an empty title', '/i.png', { alt: 'a', title: '' }, '![a](/i.png)'],
        ['an alt text ending in a backslash, sized', '/i.png', { alt: 'a\\', width: 3 }, '![a\\\\](/i.png){width=3}'],
        ['a line feed in the alt text', '/i.png', { alt: 'a\nb' }, '![a&#10;b](/i.png)'],
        ['a title', '/i.png', { alt: 'a', title: 'T' }, '![a](/i.png "T")'],
        ['a source the scheme allow-list refuses', 'javascript:alert(1)', { title: 't' }, ''],
    ])('writes %s', (_name, src, options, saved) => {
        const editor = new MarkdownEditor();

        editor.insertImage(src, options);

        expect(expectShownAsSaved(editor)).toBe(saved);
    });

    it('saves a link title that ends in a backslash with a character reference', () => {
        const editor = load('[a](/u "x&#92;")');

        append(editor, ' x');

        expect(expectShownAsSaved(editor)).toBe('[a](/u "x&#92;") x');
    });
});

describe('an image written where its loaded form cannot stand', () => {
    it('a paragraph image with a line break, set to a level 2 heading, is kept as a setext heading', () => {
        const editor = load('![a\nb](/i.png)');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().select(0, 0); });
        editor.setBlockType('h2');

        expect(expectShownAsSaved(editor)).toBe('![a\nb](/i.png)\n---');
    });

    it('a paragraph image with a line break, set to a level 3 heading, is written in the standard form', () => {
        const editor = load('![a\nb](/i.png)');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().select(0, 0); });
        editor.setBlockType('h3');

        expect(expectShownAsSaved(editor)).toBe('### ![a&#10;b](/i.png)');
    });

    it('a titled image in a table cell keeps its written form', () => {
        const editor = load('| a |\n| --- |\n| ![i](/i.png "t") |');

        update(editor, () => {
            const cell = $dfs().map(({ node }) => node).filter($isTableCellNode).pop()!;

            cell.getFirstChildOrThrow<ElementNode>().append($createTextNode(' x'));
        });

        expect(expectShownAsSaved(editor)).toBe('| a |\n| --- |\n| ![i](/i.png "t") x |');
    });

    it('a reference image copied where no definition resolves it is written inline', () => {
        const source = load('![a][r] y\n\n[r]: /i.png');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const target = load('z');

        update(target, () => {
            const image = $parseSerializedNode(json) as MarkdownImageNode;

            expect($getState(image, imageWrittenState)).toBe('![a][r]');
            $getRoot().getFirstChildOrThrow<ElementNode>().append(image);
        });

        expect(expectShownAsSaved(target)).toBe('z![a](/i.png)');
    });

    it('an image made in the editor has no written form', () => {
        const editor = new MarkdownEditor();

        editor.insertImage('/i.png', { alt: 'a' });

        expect(lexicalOf(editor).read(() => $getState(imageNodes(editor)[0]!, imageWrittenState))).toBe('');
    });
});

describe('a reference image whose label holds brackets keeps its meaning when text is typed after it', () => {
    const LABELS = ['a\\[', 'a\\]', 'a\\\\', 'a\\[b\\]', 'a\\[\\]'];
    const TYPED = ['(x)', '[x]', '{x}', 'x'];
    const FORMS: Array<[string, (label: string) => string]> = [
        ['full', (label) => `![alt][${label}]`],
        ['collapsed', (label) => `![${label}][]`],
        ['shortcut', (label) => `![${label}]`],
    ];

    for (const [formName, form] of FORMS) {
        for (const label of LABELS) {
            it.each(TYPED)(`the ${formName} form with the label ${label}, then %s`, (typed) => {
                const editor = load(`${form(label)}\n\n[${label}]: /i.png`);

                expect(lexicalOf(editor).read(() => imageNodes(editor).length)).toBe(1);
                append(editor, typed);

                const saved = expectShownAsSaved(editor);
                const reloaded = load(saved);

                expect(lexicalOf(reloaded).read(() => imageNodes(reloaded).map((image) => image.getSrc()))).toEqual(['/i.png']);
                expect(reloaded.getValue()).toBe(saved);
            });
        }
    }

    it('the shortcut form with a label ending in an escaped bracket is saved collapsed, and reads back as the image and the text', () => {
        const editor = load('![a\\[]\n\n[a\\[]: /i.png');

        append(editor, '(x)');

        expect(expectShownAsSaved(editor)).toBe('![a\\[][](x)\n\n[a\\[]: /i.png');
    });
});

describe('brackets typed right after an image inside a link\'s text stay text', () => {
    const DEFINITIONS = '[x]: /x\n[r]: /r.png\n[a]: /a.png\n[a\\]]: /d.png\n[a&#91;]: /f.png';
    const FORMS = ['![a](/i.png)', '![a][r]', '![a]', '![a\\]]', '![ a ]', '![a&#91;]'];
    const TYPED = ['[x]', '[]', '[x](y)'];

    /**
     * Puts a text right after the document's first image.
     *
     * @param editor - The editor.
     * @param text - The text.
     */
    function typeAfterImage(editor: MarkdownEditor, text: string): void {
        update(editor, () => {
            $dfs().map(({ node }) => node).find($isMarkdownImageNode)!.insertAfter($createTextNode(text));
        });
    }

    /**
     * The links of the document's first block, each as the types of its children.
     *
     * @param editor - The editor.
     * @returns The links.
     */
    function linkShapes(editor: MarkdownEditor): string[][] {
        return lexicalOf(editor).read(() => $dfs().map(({ node }) => node).filter($isLinkNode).map((link) => link.getChildren().map((child) => child.getType())));
    }

    it('saves the typed brackets escaped, and the save reloads as the link holding the image and the text', () => {
        const editor = load('[![a](/i.png)z](/u)\n\n[x]: /d');

        typeAfterImage(editor, '[x]');

        const saved = expectShownAsSaved(editor);
        const reloaded = load(saved);

        expect(saved).toBe('[![a](/i.png)\\[x\\]z](/u)\n\n[x]: /d');
        expect(viewerModel(saved).blocks[0]).toEqual({
            kind: 'paragraph',
            runs: [
                { kind: 'image', src: '/i.png', alt: 'a', title: null, width: null, height: null, link: { href: '/u', title: null } },
                { kind: 'text', text: '[x]z', marks: [], link: { href: '/u', title: null }, style: null },
            ],
        });
        expect(linkShapes(reloaded)).toEqual([['markdown-image', 'text']]);
        expect(reloaded.getValue()).toBe(saved);
    });

    it('saves the same without a definition for the label', () => {
        const editor = load('[![a](/i.png)z](/u)');

        typeAfterImage(editor, '[x]');

        expect(expectShownAsSaved(editor)).toBe('[![a](/i.png)\\[x\\]z](/u)');
    });

    for (const form of FORMS) {
        it.each(TYPED)(`after ${form}: %s`, (typed) => {
            const editor = load(`[${form}](/u)\n\n${DEFINITIONS}`);

            typeAfterImage(editor, typed);

            const saved = expectShownAsSaved(editor);
            const reloaded = load(saved);

            expect(linkShapes(reloaded)).toEqual([['markdown-image', 'text']]);
            expect(reloaded.getValue()).toBe(saved);
        });
    }
});

describe('a title holding a line feed is written on one line where its block holds one line', () => {
    const SPEC = { src: '/i.png', alt: 'a', width: null, height: null };

    /** Titles of the document's images and links, in order. */
    function titles(editor: MarkdownEditor): Array<string | null> {
        return lexicalOf(editor).read(() => $dfs().map(({ node }) => node)
            .map((node) => ($isMarkdownImageNode(node) ? node.getTitle() : $isLinkNode(node) ? node.getTitle() : undefined))
            .filter((title): title is string | null => title !== undefined));
    }

    /** Appends `node` to the heading or table cell paragraph the document starts with. */
    function appendInto(editor: MarkdownEditor, container: 'heading' | 'cell', make: () => LexicalNode): void {
        update(editor, () => {
            const target = container === 'heading'
                ? $getRoot().getFirstChildOrThrow<ElementNode>()
                : $dfs().map(({ node }) => node).filter($isTableCellNode).pop()!.getFirstChildOrThrow<ElementNode>();

            target.append(make());
        });
    }

    const DOCUMENTS = { heading: '### h', cell: '| a |\n| --- |\n| c |' } as const;
    const MAKERS: Array<[string, () => LexicalNode]> = [
        ['an image title', () => $createMarkdownImageNode(SPEC, 't\nu')],
        ['a link title', () => $createLinkNode('/u', { title: 't\nu' }).append($createTextNode('x'))],
        ['an image title with a blank line', () => $createMarkdownImageNode(SPEC, 't\n\nu')],
    ];

    for (const container of ['heading', 'cell'] as const) {
        it.each(MAKERS)(`${container}: %s keeps its line feed through a save and a reload`, (_name, make) => {
            const editor = load(DOCUMENTS[container]);

            appendInto(editor, container, make);

            const saved = expectShownAsSaved(editor);
            const reloaded = load(saved);

            expect(saved).toContain('&#10;');
            expect(titles(reloaded)).toEqual(titles(editor));
            expect(reloaded.getValue()).toBe(saved);
        });
    }

    it.each(['paragraph', 'quote', 'list item'])('a title with a blank line is written as character references in a %s, and reloads as it was', (container) => {
        const source = { paragraph: 'p', quote: '> p', 'list item': '- p' }[container]!;
        const editor = load(source);

        update(editor, () => {
            const block = $dfs().map(({ node }) => node).filter((node): node is ElementNode => $isElementNode(node) && node.getTextContent() === 'p').pop()!;

            block.append($createMarkdownImageNode(SPEC, 't\n\nu'), $createLinkNode('/u', { title: 'v\n \nw' }).append($createTextNode('x')));
        });

        const saved = expectShownAsSaved(editor);
        const reloaded = load(saved);

        expect(titles(reloaded)).toEqual(['t\n\nu', 'v\n \nw']);
        expect(reloaded.getValue()).toBe(saved);
    });

    it('an image copied as JSON with a blank line in its title keeps the title through a save and a reload', () => {
        const source = load('![a](/i.png "t&#10;&#10;u")');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const editor = load('z');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().append($parseSerializedNode(json)); });

        const saved = expectShownAsSaved(editor);

        expect(titles(load(saved))).toEqual(['t\n\nu']);
    });

    it('an image copied as JSON with a blank line in its title keeps the title where its label is defined with another', () => {
        const source = load('![a][x]\n\n[x]: /i.png "t&#10;&#10;u"');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const editor = load('z\n\n[x]: /i.png "other"');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().append($parseSerializedNode(json)); });

        const saved = expectShownAsSaved(editor);

        expect(saved).toBe('z![a](/i.png "t&#10;&#10;u")\n\n[x]: /i.png "other"');
        expect(titles(load(saved))).toEqual(['t\n\nu']);
    });

    // Regression row (passes on the base): where the definition gives the same title, the image keeps its reference form.
    it('an image copied as JSON with a blank line in its title keeps its reference form where the definition gives that title', () => {
        const source = load('![a][x]\n\n[x]: /i.png "t&#10;&#10;u"');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const editor = load('z\n\n[x]: /i.png "t&#10;&#10;u"');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().append($parseSerializedNode(json)); });

        expect(expectShownAsSaved(editor)).toBe('z![a][x]\n\n[x]: /i.png "t&#10;&#10;u"');
    });

    it('a crafted image whose written form spans a blank line is saved in the standard form', () => {
        const editor = load('p');
        const json = {
            type: 'markdown-image', version: 1, src: '/i.png', alt: 'a\n\n<b>x</b>', width: null, height: null, title: null,
            $: { mdImageWritten: '![a\n\n<b>x</b>](/i.png)' },
        };

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().append($parseSerializedNode(json)); });

        const saved = expectShownAsSaved(editor);

        expect(saved).toBe('p![a&#10;&#10;\\<b>x\\</b>](/i.png)');
        expect(load(saved).getValue()).toBe(saved);
    });

    it('an image copied as JSON into a level 3 heading keeps its title', () => {
        const source = load('![a](/i.png "t\nu")');
        const json = lexicalOf(source).read(() => imageNodes(source)[0]!.exportJSON());
        const editor = load('### h');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().append($parseSerializedNode(json)); });

        const saved = expectShownAsSaved(editor);

        expect(titles(load(saved))).toEqual(['t\nu']);
    });

    it('a link title with a line feed in a level 3 heading reloads with the same title', () => {
        const editor = load('[a](/u "t\nu")');

        update(editor, () => { $getRoot().getFirstChildOrThrow<ElementNode>().select(0, 0); });
        editor.setBlockType('h3');

        const saved = expectShownAsSaved(editor);

        expect(saved).toBe('### [a](/u "t&#10;u")');
        expect(titles(load(saved))).toEqual(['t\nu']);
    });
});

describe('sources the editor refuses', () => {
    it('insertImage declines an empty source', () => {
        const editor = new MarkdownEditor();

        editor.insertImage('', { alt: 'a' });

        expect(editor.getValue()).toBe('');
    });

    it('a serialized image with a refused source is neutralised when it is read', () => {
        const editor = load('');
        const json = { type: 'markdown-image', version: 1, src: 'javascript:alert(1)', alt: 'x', width: null, height: null };

        update(editor, () => {
            const image = $parseSerializedNode(json) as MarkdownImageNode;

            expect(image.getSrc()).toBe('');
            expect(image.getAlt()).toBe('x');
        });
    });

    it('a serialized image with an allowed source keeps it', () => {
        const editor = load('');
        const json = { type: 'markdown-image', version: 1, src: '/i.png', alt: 'x', width: 3, height: null };

        update(editor, () => {
            expect(($parseSerializedNode(json) as MarkdownImageNode).getSrc()).toBe('/i.png');
        });
    });
});
