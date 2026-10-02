import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isRangeSelection, $isTextNode, HISTORY_PUSH_TAG, PASTE_COMMAND,
    UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, TextNode } from 'lexical';
import { $createLinkNode, $isLinkNode } from '@lexical/link';
import { $dfs } from '@lexical/utils';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode, $isListItemNode } from '@lexical/list';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import {
    $createReferenceLinkNode, $isReferenceLinkNode,
} from '~/component/editor/markdownReferenceLinkNode';
import type { ReferenceLinkForm, ReferenceLinkNode } from '~/component/editor/markdownReferenceLinkNode';
import {
    $createMarkdownRawBlockNode, $isMarkdownRawBlockNode, $isMarkdownSourceTextNode,
} from '~/component/editor/markdownSourceNodes';
import type { MarkdownRawBlockNode } from '~/component/editor/markdownSourceNodes';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

// Wraps the viewer's lexer in a spy that still lexes, so a test can count how
// much text a load lexes; every other test sees the real lexer unchanged.
vi.mock('~/component/display/markdownExtensions.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/display/markdownExtensions.js')>();

    return { ...actual, lexMarkdown: vi.fn(actual.lexMarkdown) };
});

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** One reference link, summarised for comparison. */
interface ReferenceSummary { url: string; title: string | null; form: ReferenceLinkForm; label: string }

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
 * Every reference link of the document, in document order. Must run inside a read or update.
 *
 * @returns The reference links.
 */
function $referenceLinks(): ReferenceLinkNode[] {
    return $dfs().map(({ node }) => node).filter($isReferenceLinkNode);
}

/**
 * Summarises the document's reference links.
 *
 * @param editor - The editor.
 * @returns One summary per reference link, in document order.
 */
function references(editor: MarkdownEditor): ReferenceSummary[] {
    return lexicalOf(editor).read(() => $referenceLinks().map((node) => ({
        url:   node.getURL(),
        title: node.getTitle(),
        form:  node.getReference().form,
        label: node.getReference().label,
    })));
}

/**
 * The first text node of the document's first reference link. Must run inside an update.
 *
 * @returns The text node.
 */
function $firstLinkText(): TextNode {
    const text = $referenceLinks()[0]!.getFirstChild();

    if (!$isTextNode(text)) {
        throw new Error('the reference link holds no text node');
    }

    return text;
}

const RL1_SOURCE = 'See [text][ref].\n\n[ref]: https://e.com "T"';
const RL7_SOURCE = '[ref]\n\n[ref]: https://e.com';

describe('reference links load and save in their own form (RL rows)', () => {
    it('RL1: a full reference keeps its form and loads as a ReferenceLinkNode', () => {
        const editor = load(RL1_SOURCE);

        expect(editor.getValue()).toBe(RL1_SOURCE);
        expect(references(editor)).toEqual([{ url: 'https://e.com', title: 'T', form: 'full', label: 'ref' }]);
    });

    it('RL2: shortcut and collapsed references keep their forms and labels', () => {
        const source = '[ref] and [Ref][] and [ref][]\n\n[ref]: https://e.com';
        const editor = load(source);

        expect(editor.getValue()).toBe(source);
        expect(references(editor).map(({ form, label }) => [form, label])).toEqual([
            ['shortcut', 'ref'], ['collapsed', 'Ref'], ['collapsed', 'ref'],
        ]);
    });

    it('RL3: an underscore stays unescaped in the label and the definition', () => {
        const source = '[my_ref]\n\n[my_ref]: https://e.com/a_b';

        expect(load(source).getValue()).toBe(source);
    });

    it('RL4: a link whose URL is edited saves inline with its new URL', () => {
        const editor = load(RL1_SOURCE);

        update(editor, () => $firstLinkText().select(2, 2));
        editor.toggleLink('https://new');

        // The plan wrote `[text](https://new)`; `toggleLink` keeps a link's title, as for every link, and the inline
        // form writes the link's current URL and title — see the plan's Implementation Notes.
        expect(editor.getValue()).toBe('See [text](https://new "T").\n\n[ref]: https://e.com "T"');
    });

    it('RL5: a link whose definition is edited saves inline with its own URL', () => {
        const editor = load(RL1_SOURCE);

        update(editor, () => {
            const block = $getRoot().getChildren().find($isMarkdownRawBlockNode)!;

            block.clear();
            block.append($createTextNode('[ref]: https://other'));
        });

        expect(editor.getValue()).toBe('See [text](https://e.com "T").\n\n[ref]: https://other');
    });

    it('RL6: a link whose definition is removed saves inline', () => {
        const editor = load(RL1_SOURCE);

        update(editor, () => $getRoot().getChildren().find($isMarkdownRawBlockNode)!.remove());

        expect(editor.getValue()).toBe('See [text](https://e.com "T").');
    });

    it('RL7: a shortcut whose text is edited saves in the full form', () => {
        const editor = load(RL7_SOURCE);

        update(editor, () => {
            const text = $firstLinkText();

            text.setTextContent(text.getTextContent() + 'x');
        });

        expect(editor.getValue()).toBe('[refx][ref]\n\n[ref]: https://e.com');
    });

    it('RL8: a shortcut whose text is formatted saves in the full form', () => {
        const editor = load(RL7_SOURCE);

        update(editor, () => $firstLinkText().select(0, 3));
        editor.toggleBold();

        // The plan wrote `[**ref**][ref]`; marks every character of a link carries are written outside its
        // brackets, as for every link (`**[x](u)**`) — see the plan's Implementation Notes. Both read the same.
        expect(editor.getValue()).toBe('**[ref][ref]**\n\n[ref]: https://e.com');
        expect(viewerModel(editor.getValue())).toEqual(viewerModel('[**ref**][ref]\n\n[ref]: https://e.com'));
    });

    it('RL9: a shortcut followed by `(` saves collapsed, so it does not read as an inline link', () => {
        const editor = load('[ref] (x)\n\n[ref]: https://e.com');

        update(editor, () => {
            const after = $referenceLinks()[0]!.getNextSibling();

            if ($isTextNode(after)) {
                after.setTextContent(after.getTextContent().trimStart());
            }
        });

        expect(editor.getValue()).toBe('[ref][](x)\n\n[ref]: https://e.com');
    });

    it('RL10: with a repeated definition the first one wins and the reference keeps its form', () => {
        const source = '[a]\n\n[a]: https://one\n[a]: https://two';
        const editor = load(source);

        expect(editor.getValue()).toBe(source);
        expect(references(editor)[0]!.url).toBe('https://one');
    });

    it('RL11: a label naming an Object.prototype member resolves only through its own definition', () => {
        const source = '[constructor]\n\n[constructor]: https://c.com';

        expect(load(source).getValue()).toBe(source);
    });

    it('RL12: an undefined label is text in the viewer and the editor', () => {
        const editor = load('see [x][toString]');

        expect(editor.getValue()).toBe('see \\[x\\]\\[toString\\]');
        expect(references(editor)).toEqual([]);
    });

    it('RL13: a reference in a table cell keeps its form', () => {
        const source = '| a |\n| --- |\n| [ref] |\n\n[ref]: https://e.com';
        const editor = load(source);

        expect(editor.getValue()).toBe(source);
        expect(references(editor)).toHaveLength(1);
    });

    it('RL14: a definition held in a quote still resolves its reference', () => {
        const source = '> [q]: https://q.com\n\nSee [q].';
        const editor = load(source);

        expect(editor.getValue()).toBe(source);
        expect(lexicalOf(editor).read(() => $getRoot().getChildren().map((node) => node.getType())))
            .toEqual(['markdown-raw-block', 'paragraph']);
        expect(references(editor)).toHaveLength(1);
    });

    it('RL15: a reference link with no definition in the document saves inline', () => {
        const editor = load('');

        update(editor, () => {
            const reference = { label: 'ref', form: 'shortcut' as const, definitionUrl: 'https://e.com', definitionTitle: null, importedContent: 'ref' };
            const link = $createReferenceLinkNode('https://e.com', null, reference).append($createTextNode('ref'));

            $getRoot().clear();
            $getRoot().append($createParagraphNode().append(link));
        });

        expect(editor.getValue()).toBe('[ref](https://e.com)');
    });

    it('RL16: labels holding a backslash escape or an entity save as written', () => {
        const source = '[a\\_b] and [a&#35;b][]\n\n[a\\_b]: https://e.com\n[a&#35;b]: https://f.com';

        expect(load(source).getValue()).toBe(source);
    });
});

describe('reference links: cases beyond the plan', () => {
    it('a shortcut followed by a link saves collapsed, so the two do not read as one full reference', () => {
        const editor = load('[ref] [x](https://u)\n\n[ref]: https://e.com\n[x]: https://x.com');

        update(editor, () => {
            const after = $referenceLinks()[0]!.getNextSibling();

            if ($isTextNode(after)) {
                after.remove();
            }
        });

        const saved = editor.getValue();

        expect(saved).toBe('[ref][][x](https://u)\n\n[ref]: https://e.com\n[x]: https://x.com');
        expect(viewerModel(saved).blocks).toEqual(editorSurfaceModel(editor));
    });

    it('a shortcut starting a block and followed by `:` saves collapsed, so it does not read as a definition', () => {
        const editor = load('a [ref]: b\n\n[ref]: https://e.com');

        update(editor, () => {
            const before = $referenceLinks()[0]!.getPreviousSibling();

            if ($isTextNode(before)) {
                before.remove();
            }
        });

        expect(editor.getValue()).toBe('[ref][]: b\n\n[ref]: https://e.com');
    });

    it('a shortcut on a paragraph\'s continuation line keeps its form before `:`, where no definition can start', () => {
        const source = '[a] b\n[a]: /x\n\n[a]: /u';

        expect(load(source).getValue()).toBe(source);
    });

    it('a definition with an empty title resolves a reference that has none, as marked reads it', () => {
        const source = '[x]\n\n[x]: /u ""';

        expect(load(source).getValue()).toBe(source);
    });

    it('a bold shortcut keeps its bold outside the brackets', () => {
        const source = 'A **[ref]**\n\n[ref]: https://e.com';

        expect(load(source).getValue()).toBe(source);
    });

    it('a label that is itself emphasised is written once, without a second emphasis around it', () => {
        for (const source of [
            '[*foo*][]\n\n[*foo*]: /url',
            '[_foo_][]\n\n[_foo_]: /url',
            '[_foo_]\n\n[_foo_]: /url',
            '[__foo__]\n\n[__foo__]: /url',
            '[~foo~]\n\n[~foo~]: /url',
            '[*a\\_b*]\n\n[*a\\_b*]: /url',
            '**[*foo*][]**\n\n[*foo*]: /url',
            '*a [*foo*][] b*\n\n[*foo*]: /url',
        ]) {
            expect(load(source).getValue(), source).toBe(source);
        }
    });

    it('a shortcut followed by `{` saves collapsed, so it does not read as a styled span', () => {
        const editor = load('[ref] {x}\n\n[ref]: https://e.com');

        update(editor, () => {
            const after = $referenceLinks()[0]!.getNextSibling();

            if ($isTextNode(after)) {
                after.setTextContent(after.getTextContent().trimStart());
            }
        });

        expect(editor.getValue()).toBe('[ref][]{x}\n\n[ref]: https://e.com');
    });

    it('a definition inside a `:::` fence resolves its reference', () => {
        const source = '[x] out\n\n::: {align=center}\n[x] in block\n\n[x]: https://blk\n:::';

        expect(load(source).getValue()).toBe(source);
    });

    it('a label in a table cell keeps its `|` escaped', () => {
        const source = '| h |\n| --- |\n| [a\\|b] |\n\n[a|b]: /u';

        expect(load(source).getValue()).toBe(source);
    });

    it('a label spanning lines is written on one line where its block cannot span lines', () => {
        const editor = load('[foo\nbar]\n===\n\n[foo bar]: /u');

        update(editor, () => {
            const heading = $getRoot().getFirstChild();

            if ($isHeadingNode(heading)) {
                heading.replace($createHeadingNode('h3').append(...heading.getChildren()));
            }
        });

        expect(editor.getValue()).toBe('### [foo bar]\n\n[foo bar]: /u');
    });

    it('a label with an escaped bracket is written as authored', () => {
        const source = '[foo\\]bar]\n\n[foo\\]bar]: https://e.com';

        expect(load(source).getValue()).toBe(source);
    });

    it('a link split by a nested link writes each part in the full form', () => {
        const source = '[see [x](https://u) y][ref]\n\n[ref]: https://e.com';
        const saved = load(source).getValue();

        expect(viewerModel(saved)).toEqual(viewerModel(source));
    });

    it('a reference left with only a later, different definition saves inline with its own URL', () => {
        const editor = load('A [x] B\n\n[x]: https://one\n\n[x]: https://two');

        update(editor, () => $getRoot().getChildren().find($isMarkdownRawBlockNode)!.remove());

        expect(editor.getValue()).toBe('A [x](https://one) B\n\n[x]: https://two');
    });

    it('a reference link survives a JSON round trip of the editor state with its reference', () => {
        const editor = load(RL1_SOURCE);
        const restored = load('');

        lexicalOf(restored).setEditorState(lexicalOf(restored).parseEditorState(JSON.stringify(lexicalOf(editor).getEditorState().toJSON())));

        expect(references(restored)).toEqual(references(editor));
        expect(restored.getValue()).toBe(RL1_SOURCE);
    });

    it('a heading holding a shortcut keeps its slug', () => {
        const source = '# [Foo]\n\n[foo]: /url';
        const saved = load(source).getValue();

        expect(saved).toBe(source);
        expect(viewerModel(saved).headingIds).toEqual(viewerModel(source).headingIds);
    });

    it('a label broken across lines stays on its lines in a paragraph', () => {
        const source = '[foo\nbar]\n\n[foo bar]: https://e.com';

        expect(load(source).getValue()).toBe(source);
    });

    it('a reference link with empty text is kept whole as source, so an edit around it keeps its label', () => {
        const editor = load('a [][ref] b\n\n[ref]: /r');

        expect(references(editor)).toEqual([]);

        update(editor, () => $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode('!')));

        expect(editor.getValue()).toBe('a [][ref] b!\n\n[ref]: /r');
    });
});

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

/**
 * The document's raw blocks, at any depth, in document order. Must run inside a read or update.
 *
 * @returns The raw blocks.
 */
function $rawBlocks(): MarkdownRawBlockNode[] {
    return $dfs().map(({ node }) => node).filter($isMarkdownRawBlockNode);
}

/**
 * Replaces the text of the document's `index`th raw block, as typing over it would.
 *
 * @param editor - The editor.
 * @param text - The block's new text, one line.
 * @param index - Which raw block, in document order; the first by default.
 */
function retypeRawBlock(editor: MarkdownEditor, text: string, index = 0): void {
    update(editor, () => {
        const block = $rawBlocks()[index]!;

        block.clear();
        block.append($createTextNode(text));
    });
}

/**
 * The key of the document's first source run. Must run inside a read or update.
 *
 * @returns The key.
 */
function $firstSourceRunKey(): string {
    return $dfs().map(({ node }) => node).find($isMarkdownSourceTextNode)!.getKey();
}

describe('definitions edited after load: the editor shows what the save reads as (DEF rows)', () => {
    it('DEF1: an empty reference whose definition is removed shows its text, as the viewer reads it, and saves as that text', () => {
        const editor = load('a [][ref] b\n\n[ref]: https://e.com');

        update(editor, () => $rawBlocks()[0]!.remove());

        // The block shows what a save and a reload would show: text, which the save escapes.
        expect(expectShownAsSaved(editor)).toBe('a \\[\\]\\[ref\\] b');
        expect(lexicalOf(editor).read(() => $getRoot().getTextContent())).toBe('a [][ref] b');
    });

    it('DEF2: a reference image whose definition is removed shows its source as text', () => {
        const editor = load('![foo][bar] y\n\n[bar]: /url');

        update(editor, () => $rawBlocks()[0]!.remove());

        expect(expectShownAsSaved(editor)).toBe('!\\[foo\\]\\[bar\\] y');
    });

    it('DEF3: a reference kept as written follows its edited definition, as the viewer reads it', () => {
        const editor = load('[[x][r]](u)\n\n[r]: /r');

        retypeRawBlock(editor, '[r]: /s');

        expect(expectShownAsSaved(editor)).toBe('[[x][r]](u)\n\n[r]: /s');
        expect(lexicalOf(editor).read(() => $dfs().map(({ node }) => node).filter($isLinkNode).map((link) => link.getURL()))).toEqual(['/s']);
    });

    it('DEF4: a definition added before the one in force takes over a reference kept as written', () => {
        const editor = load('[[x][r]](u)\n\n[r]: /r');

        update(editor, () => $getRoot().getFirstChildOrThrow().insertBefore($createMarkdownRawBlockNode('[r]: /first')));

        expect(expectShownAsSaved(editor)).toBe('[r]: /first\n\n[[x][r]](u)\n\n[r]: /r');
    });

    it('DEF5: a reference link beside a kept one keeps its own URL and saves inline', () => {
        const editor = load('See [text][ref] and [[x][ref]](u).\n\n[ref]: https://e.com');

        retypeRawBlock(editor, '[ref]: https://f.com');

        const saved = expectShownAsSaved(editor);

        expect(saved).toBe('See [text](https://e.com) and [[x][ref]](u).\n\n[ref]: https://f.com');
        expect(viewerModel(saved).blocks[0]).toMatchObject({
            runs: [{ text: 'See ' }, { text: 'text', link: { href: 'https://e.com' } }, { text: ' and ' }, { text: 'x', link: { href: 'https://f.com' } }, { text: '.' }],
        });
    });

    it('DEF6: a definition held in a quote is removed', () => {
        const editor = load('> [q]: /q\n\n![a][q] z');

        update(editor, () => $rawBlocks()[0]!.remove());

        expect(expectShownAsSaved(editor)).toBe('!\\[a\\]\\[q\\] z');
    });

    it('DEF7: a definition held in a list item is edited', () => {
        const editor = load('- [l]: /l\n\nx [[l]](u)');

        retypeRawBlock(editor, '- [l]: /m');

        const saved = editor.getValue();

        // The viewer shows a list holding only a definition as an empty list; compare the paragraph.
        expect(viewerModel(saved).blocks[1]).toEqual(editorSurfaceModel(editor)[1]);
        expect(editorSurfaceModel(editor)[1]).toMatchObject({ runs: [{ text: 'x ' }, { text: 'l', link: { href: '/m' } }] });
    });

    it('DEF8: a definition inside a `:::` fence is edited', () => {
        const editor = load('[[x][c]](u)\n\n::: columns\n[c]: /c\n|||\nz\n:::');

        retypeRawBlock(editor, '[c]: /d');

        expect(expectShownAsSaved(editor)).toBe('[[x][c]](u)\n\n::: columns\n[c]: /d\n|||\nz\n:::');
    });

    it('DEF9: typing in a definition\'s label keeps every step shown as saved; runs it stopped resolving stay text', () => {
        const editor = load('![foo][bar] y and [][bar]\n\n[bar]: /url');

        for (const text of ['[barx]: /url', '[barxy]: /url', '[bar]: /url']) {
            retypeRawBlock(editor, text);
            expectShownAsSaved(editor);
        }

        // Shown as text at the first step, as a reload of that step's save shows them, the runs stay text: text
        // never becomes a reference.
        expect(editor.getValue()).toBe('!\\[foo\\]\\[bar\\] y and \\[\\]\\[bar\\]\n\n[bar]: /url');
    });

    it('DEF10: definitions pasted into a raw block leave bracket text, in a link or not, as text', () => {
        const editor = load('[[x][r]](u) and ![i][s]\n\n[a]: /a');
        const clipboardData = { getData: (type: string): string => (type === 'text/plain' ? '\n[r]: /r\n[s]: /s' : '') };

        update(editor, () => $rawBlocks()[0]!.selectEnd());
        update(editor, () => {
            lexicalOf(editor).dispatchCommand(PASTE_COMMAND, { clipboardData, preventDefault: () => {} } as unknown as ClipboardEvent);
        });

        expect(expectShownAsSaved(editor)).toBe('[\\\\[x\\\\]\\\\[r\\\\]](u) and !\\[i\\]\\[s\\]\n\n[a]: /a\n[r]: /r\n[s]: /s');
    });

    it('DEF11: undoing a removed definition shows the references as before, and later edits stay shown as saved', () => {
        const editor = load('a [][ref] b ![i][ref]\n\n[ref]: https://e.com');
        const source = editor.getValue();

        lexicalOf(editor).update(() => $rawBlocks()[0]!.remove(), { discrete: true, tag: HISTORY_PUSH_TAG });
        expectShownAsSaved(editor);
        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        }, { discrete: true });

        expect(expectShownAsSaved(editor)).toBe(source);

        update(editor, () => $rawBlocks()[0]!.remove());

        expect(expectShownAsSaved(editor)).toBe('a \\[\\]\\[ref\\] b !\\[i\\]\\[ref\\]');
    });

    it('DEF12: an edit that leaves the definitions as they were keeps every run kept as written', () => {
        const editor = load('a [][ref] b\n\n[ref]: https://e.com\n\n<div>\nx\n</div>');
        const key = lexicalOf(editor).read($firstSourceRunKey);

        update(editor, () => $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode('!')));
        retypeRawBlock(editor, '<div>y</div>', 1);

        expect(lexicalOf(editor).read($firstSourceRunKey)).toBe(key);
        expect(expectShownAsSaved(editor)).toBe('a [][ref] b!\n\n[ref]: https://e.com\n\n<div>y</div>');
    });

    it('DEF13: a definition change that does not change how a block reads keeps the block as it is', () => {
        const editor = load('a [][ref] b\n\n[ref]: https://e.com');
        const key = lexicalOf(editor).read($firstSourceRunKey);

        retypeRawBlock(editor, '[ref]: https://e.com\n[other]: /o');

        expect(lexicalOf(editor).read($firstSourceRunKey)).toBe(key);
        expectShownAsSaved(editor);
    });

    it('DEF14: the caret in a block shown anew stays in that block', () => {
        const editor = load('[[x][r]](u) tail\n\n[r]: /r');

        update(editor, () => {
            $getRoot().getFirstChildOrThrow<ElementNode>().selectEnd();
            $rawBlocks()[0]!.getFirstChildOrThrow<TextNode>().setTextContent('[r]: /s');
        });

        expectShownAsSaved(editor);
        expect(lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? selection.anchor.getNode().getTopLevelElement()?.getTextContent() : null;
        })).toBe('x tail');
    });
});

describe('stack fuzz round 2: references where the save could read them otherwise', () => {
    it('a shortcut reference opening a list item\'s text before a space is written [x][], not read as a task checkbox', () => {
        const editor = load('[x] y\n\n[x]: /a');

        update(editor, () => {
            const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();
            const list = $createListNode('bullet');
            const item = $createListItemNode();

            item.append(...paragraph.getChildren());
            list.append(item);
            paragraph.replace(list);
        });

        expect(editor.getValue()).toBe('- [x][] y\n\n[x]: /a');
        expectShownAsSaved(editor);
    });

    it('a reference whose title holds a blank line keeps its form when its definition\'s title is edited, and takes that title', () => {
        const editor = load('[foo][]\n\n[foo]: /url "\n\ntitle"');

        retypeRawBlock(editor, '[foo]: /url "\n\ntitle2"');

        expect(editor.getValue()).toBe('[foo][]\n\n[foo]: /url "\n\ntitle2"');
        expect(references(editor)).toEqual([{ label: 'foo', form: 'collapsed', url: '/url', title: '\n\ntitle2' }]);
    });

    it('a link nested in a link written as a reference keeps all its source when the block is written again', () => {
        const editor = load('[<https://a.test/q>[](/z)][r] w\n\n[r]: /c');

        update(editor, () => $getRoot().getFirstChildOrThrow<ElementNode>().append($createTextNode('!')));

        expect(editor.getValue()).toBe('[<https://a.test/q>[](/z)][r] w!\n\n[r]: /c');
    });

    it('a definition in a list item counts among the document\'s definitions: a link it would re-point is written inline', () => {
        const editor = load('[a][r]\n\n- i\n\n[r]: /second');

        update(editor, () => {
            const item = $dfs().map(({ node }) => node).find($isListItemNode)!;

            item.getLastChildOrThrow().insertAfter($createMarkdownRawBlockNode('[r]: /first'));
        });

        // The viewer resolves `[r]` to the first definition, in the list item, so the link keeps pointing where it did.
        const saved = editor.getValue();

        expect(saved.startsWith('[a](/second)\n\n')).toBe(true);
        expect(viewerModel(saved).blocks[0]).toEqual(editorSurfaceModel(editor)[0]);
    });
});

describe('bracket text in a link\'s text stays text, whatever the document defines (marked unescapes link-text brackets)', () => {
    const cases: Array<[string, string]> = [
        ['a label in the full form', 'a [x][r] b'],
        ['a shortcut label', 'a [r] b'],
        ['a collapsed label', '[r][]'],
        ['a label before a parenthesis', '[r](q)'],
        ['a bracket alone, then a pair', '[ [r]'],
        ['a closing bracket alone, then a pair', '] [r] ['],
        ['a pair inside a pair', '[[r]]'],
        ['a backslash before a pair', '\\[r]'],
        ['an exclamation mark before a pair', '![r]'],
    ];

    it.each(cases)('%s', (_name, text) => {
        const editor = load('[a](https://u)\n\n[r]: /r\n[x]: /x');

        update(editor, () => {
            const link = $dfs().map(({ node }) => node).find($isLinkNode)!;

            link.getFirstChildOrThrow<TextNode>().setTextContent(text);
        });

        const saved = expectShownAsSaved(editor);

        expect(viewerModel(saved).blocks[0]).toEqual({ kind: 'paragraph', runs: [{ kind: 'text', text, marks: [], link: { href: 'https://u', title: null }, style: null }] });
    });

    it('a reference link\'s own text holding a label stays text', () => {
        const editor = load('[a][r]\n\n[r]: /r\n[x]: /x');

        update(editor, () => $referenceLinks()[0]!.getFirstChildOrThrow<TextNode>().setTextContent('a [x] b'));

        expect(expectShownAsSaved(editor)).toBe('[a \\\\[x\\\\] b][r]\n\n[r]: /r\n[x]: /x');
    });

    it('a link built in the editor holding a label stays text once a definition for it is added', () => {
        const editor = load('a\n\n[x]: /x');

        update(editor, () => {
            const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();

            paragraph.clear();
            paragraph.append($createLinkNode('https://u').append($createTextNode('see [y]')));
        });
        retypeRawBlock(editor, '[x]: /x\n[y]: /y');

        expect(expectShownAsSaved(editor)).toBe('[see \\\\[y\\\\]](https://u)\n\n[x]: /x\n[y]: /y');
    });
});

describe('reference links: loading cost', () => {
    it('a run of consecutive definitions lexes in time linear in its length, not once per definition', () => {
        // 400 definitions make a quadratic re-lex of the growing run lex
        // about 200 times the source; a linear load lexes it a small,
        // fixed number of times whatever the count.
        const definitions = Array.from({ length: 400 }, (_, index) => `[label${index}]: https://example.com/${index}`);
        const source = `a [label0] b\n\n${definitions.join('\n')}`;
        const lex = vi.mocked(lexMarkdown);

        lex.mockClear();

        const editor = load(source);
        const lexedLength = lex.mock.calls.reduce((total, [text]) => total + text.length, 0);

        expect(editor.getValue()).toBe(source);
        expect(lexedLength).toBeLessThan(source.length * 4);
    });
});
