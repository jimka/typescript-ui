import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorChange } from '~/component/editor/MarkdownEditor';
import { TRANSFORMERS } from '~/component/editor/markdownTransformers';
import {
    HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
    BOLD_STAR, ITALIC_STAR, INLINE_CODE, LINK,
    STRIKETHROUGH, HIGHLIGHT, CHECK_LIST,
} from '@lexical/markdown';
import { $getRoot } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { lexer } from 'marked';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// MarkdownEditor runs its Lexical editor headless: `createEditor()` needs no DOM,
// so markdown <-> state conversion (getValue/setValue/commands/change) is a real
// offline unit test against the modelled sink. Only the mounted `contenteditable`
// view (typing, selection, paste) is the plan's manual-verify section — under the
// recording sink `mountView` returns `null`, so the view never attaches and the
// state path exercised here is the same one the live editor uses.

// The construct corpus: one document per supported dialect construct.
const CORPUS: Record<string, string> = {
    'heading h1':       '# Heading one',
    'heading h2':       '## Heading two',
    'heading h6':       '###### Heading six',
    'paragraph':        'A plain paragraph of prose.',
    'inline formats':   'Text with **bold**, *italic*, and `inline code`.',
    'unordered list':   '- one\n- two\n- three',
    'ordered list':     '1. first\n2. second',
    'blockquote':       '> a quoted line',
    'fenced code':      '```\nplain code\n```',
    'fenced code lang': '```js\nconst x = 1;\n```',
    'link':             'A [link](https://example.com) in prose.',
};

// The exact token types the read-only `Markdown` viewer renders; anything else
// falls to its plain-text fallback.
const VIEWER_TOKENS = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'space']);

/** Normalises Lexical's markdown export for comparison: strip trailing spaces, collapse blank-line runs, trim. */
function normalize(md: string): string {
    return md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Reaches the private headless Lexical editor for white-box selection setup. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/** Places a collapsed range selection at the start of the document, so a block command has a selection to act on. */
function selectStart(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
}

describe('markdownTransformers curation', () => {
    it('contains exactly the nine dialect transformers', () => {
        expect(TRANSFORMERS).toHaveLength(9);
        expect(TRANSFORMERS).toEqual(expect.arrayContaining([
            HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
            BOLD_STAR, ITALIC_STAR, INLINE_CODE, LINK,
        ]));
    });

    it('excludes the constructs the viewer drops (strikethrough, highlight, check-list)', () => {
        expect(TRANSFORMERS).not.toContain(STRIKETHROUGH);
        expect(TRANSFORMERS).not.toContain(HIGHLIGHT);
        expect(TRANSFORMERS).not.toContain(CHECK_LIST);
    });
});

describe('MarkdownEditor offline value', () => {
    it('getValue reads the positional constructor value before the editor is built', () => {
        expect(new MarkdownEditor('# Hi').getValue()).toBe('# Hi');
    });

    it('getValue defaults to "" when unset', () => {
        expect(new MarkdownEditor().getValue()).toBe('');
    });

    it('setValue builds the headless editor and getValue reads the converted markdown', () => {
        const editor = new MarkdownEditor();

        editor.setValue('# Title');

        expect(normalize(editor.getValue())).toBe('# Title');
    });

    it('setContentEditable defaults to true and survives construction', () => {
        expect(new MarkdownEditor().getContentEditable()).toBe(true);
        expect(new MarkdownEditor(undefined, {}).getContentEditable()).toBe(true);
    });
});

describe('MarkdownEditor applyOptions', () => {
    it('forwards value and readOnly from the options bag', () => {
        const editor = new MarkdownEditor(undefined, { value: '# From options', readOnly: true });

        expect(editor.getValue()).toBe('# From options');
        expect(editor.getReadOnly()).toBe(true);
    });

    it('a positional value is not overridden by an unset options.value', () => {
        expect(new MarkdownEditor('positional').getValue()).toBe('positional');
    });
});

describe('MarkdownEditor readOnly routing', () => {
    it('defaults to false and round-trips through setReadOnly', () => {
        const editor = new MarkdownEditor();

        expect(editor.getReadOnly()).toBe(false);

        editor.setReadOnly(true);
        expect(editor.getReadOnly()).toBe(true);

        editor.setReadOnly(false);
        expect(editor.getReadOnly()).toBe(false);
    });

    it('reflects readOnly into the built editor editable flag', () => {
        const editor = new MarkdownEditor(undefined, { readOnly: true });

        editor.setValue('locked');

        expect(lexicalOf(editor).isEditable()).toBe(false);
    });
});

describe('MarkdownEditor change event', () => {
    it('fires a change with the new markdown on a content-changing setValue', () => {
        let received: MarkdownEditorChange | null = null;
        const editor = new MarkdownEditor(undefined, { listeners: { change: (payload) => { received = payload; } } });

        editor.setValue('# Heading');

        expect(received).not.toBeNull();
        expect(normalize(received!.value)).toBe('# Heading');
    });

    it('on() / off() register and remove a change listener', () => {
        const editor = new MarkdownEditor();
        let fired = 0;
        const listener = (): void => { fired += 1; };

        editor.on('change', listener);
        editor.setValue('one');
        expect(fired).toBe(1);

        editor.off('change', listener);
        editor.setValue('two');
        expect(fired).toBe(1);
    });
});

describe('MarkdownEditor command API', () => {
    it('all commands no-throw on the headless editor with no selection', () => {
        const editor = new MarkdownEditor();

        expect(() =>
            editor
                .toggleBold()
                .toggleItalic()
                .toggleInlineCode()
                .toggleUnorderedList()
                .toggleOrderedList()
                .toggleLink('https://example.com')
                .toggleLink(null)
                .setBlockType('h1')
        ).not.toThrow();
    });

    it('setBlockType("h2") converts the selected paragraph to a heading', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        selectStart(editor);
        editor.setBlockType('h2');

        expect(editor.getValue()).toContain('## hello world');
    });

    it('setBlockType("quote") converts the selected paragraph to a blockquote', () => {
        const editor = new MarkdownEditor();
        editor.setValue('quote me');

        selectStart(editor);
        editor.setBlockType('quote');

        expect(editor.getValue()).toContain('> quote me');
    });

    it('toggleUnorderedList converts the selected paragraph to a bullet item', () => {
        const editor = new MarkdownEditor();
        editor.setValue('list me');

        selectStart(editor);
        editor.toggleUnorderedList();

        expect(editor.getValue()).toContain('- list me');
    });
});

describe('MarkdownEditor value round-trip (idempotence)', () => {
    for (const [name, doc] of Object.entries(CORPUS)) {
        it(`round-trips ${name} to a fixpoint`, () => {
            const first  = new MarkdownEditor();
            first.setValue(doc);
            const v1 = first.getValue();

            const second = new MarkdownEditor();
            second.setValue(v1);
            const v2 = second.getValue();

            // Second pass is a fixpoint: the editor's own output round-trips unchanged.
            expect(normalize(v2)).toBe(normalize(v1));
            // And the first pass is canonically equal to the authored source.
            expect(normalize(v1)).toBe(normalize(doc));
        });
    }
});

describe('MarkdownEditor dialect fidelity (viewer token set)', () => {
    for (const [name, doc] of Object.entries(CORPUS)) {
        it(`emits only viewer-supported tokens for ${name}`, () => {
            const editor = new MarkdownEditor();
            editor.setValue(doc);

            const tokens = lexer(editor.getValue());
            const types = tokens.map((token) => token.type);

            for (const type of types) {
                expect(VIEWER_TOKENS.has(type)).toBe(true);
            }
        });
    }
});
