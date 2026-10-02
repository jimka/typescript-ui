import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkdownEditor, $classifyContextMenuTarget, $selectEnclosingWordIfCollapsed } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorChange, MarkdownEditorSelectionState, ContextMenuTarget } from '~/component/editor/MarkdownEditor';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import type { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { Component } from '~/core/Component';
import { SHORTCUT_TRANSFORMERS } from '~/component/editor/markdownTransformers';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { ensureMarkdownEditorClassRules } from '~/component/editor/editorTheme';
import {
    HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
    BOLD_STAR, ITALIC_STAR, INLINE_CODE, LINK,
    STRIKETHROUGH, HIGHLIGHT, CHECK_LIST,
} from '@lexical/markdown';
import { UNDERLINE } from '~/component/editor/markdownStyleTransformers';
import { MarkdownBlockNode, MarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { MarkdownImageNode } from '~/component/editor/markdownImageNode';
import { MarkdownRawBlockNode, MarkdownSourceTextNode } from '~/component/editor/markdownSourceNodes';
import { ReferenceLinkNode } from '~/component/editor/markdownReferenceLinkNode';
import { TableNode, TableRowNode, TableCellNode, $createTableSelectionFrom, $isTableCellNode } from '@lexical/table';
import {
    $getRoot, $getSelection, $isRangeSelection, $isParagraphNode, $isTextNode, $selectAll, $setSelection,
    KEY_ENTER_COMMAND,
} from 'lexical';
import type { LexicalEditor, ElementNode, LexicalNode } from 'lexical';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { Notification } from '~/overlay/Notification';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import type { TextField } from '~/component/input/TextField';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { EditorState } from '@codemirror/state';
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
    'strikethrough':    '~~struck~~ text',
    'unordered list':   '- one\n- two\n- three',
    'ordered list':     '1. first\n2. second',
    'blockquote':       '> a quoted line',
    'fenced code':      '```\nplain code\n```',
    'fenced code lang': '```js\nconst x = 1;\n```',
    'link':             'A [link](https://example.com) in prose.',
    'table':            '| a | b |\n| --- | --- |\n| 1 | 2 |',
    'table aligned':    '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |',
    'table escaped pipe': '| a | b |\n| --- | --- |\n| x | `p \\| q` |',
    'underline':          'A ++word++ here.',
    'styled text color':  'A [red]{color=#cc0000} word.',
    'styled text font/size': 'A [big]{font=Georgia size=1.2em} word.',
    'block alignment':       '::: {align=center}\ntext\n:::',
    'block columns':         '::: columns\nLeft\n|||\nRight\n:::',
    'block columns aligned': '::: columns {align=center}\nA\n|||\nB\n:::',
    'sized image':           '![d](/img/d.png){width=320}',
};

// The exact token types the read-only `Markdown` viewer renders; anything else
// falls to its plain-text fallback.
const VIEWER_TOKENS = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'space', 'mdtable', 'mdblock', 'def']);

/** Normalises Lexical's markdown export for comparison: strip trailing spaces, collapse blank-line runs, trim. */
function normalize(md: string): string {
    return md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Reaches the private headless Lexical editor for white-box selection setup. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/** The private source-surface `CodeEditor`'s shape needed for white-box assertions across this file. */
interface CodeEditorHandle {
    getReadOnly(): boolean;
    getValue(): string;
    isDirty(): boolean;
    onDocChange(value: string): void;
    onSelectionChange(state: EditorState): void;
    getSelection(): { characterCount: number; lineCount: number; from: number; to: number };
    focus(preventScroll?: boolean): unknown;
    copy(): unknown;
    cut(): unknown;
    paste(): Promise<boolean>;
    on(event: 'readonlyedit', listener: () => void): unknown;
    /** A duck-typed CodeMirror `EditorView` (`{ state, dispatch }`), or unset before mount — see `code-editor.test.ts`'s own pattern. */
    _view: unknown;
}

/** Reaches the private source-surface CodeEditor for white-box readOnly / dirty-state / selection assertions. */
function codeEditorOf(editor: MarkdownEditor): CodeEditorHandle {
    return (editor as unknown as { _codeEditor: CodeEditorHandle })._codeEditor;
}

/** Reaches the private WYSIWYG contenteditable surface for white-box style assertions. */
function wysiwygOf(editor: MarkdownEditor): { getElement(createIfMissing?: boolean): unknown; getId(): string } {
    return (editor as unknown as {
        _wysiwyg: { getElement(createIfMissing?: boolean): unknown; getId(): string };
    })._wysiwyg;
}

/** Reaches the private context-menu builder/handler methods for white-box assertions. */
function contextMenuMethodsOf(editor: MarkdownEditor): {
    buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[];
    handleWysiwygContextMenu(event: MouseEvent): void;
    pasteAtContextMenuSelection(): Promise<void>;
    promptAndApplyLink(title: string, defaultUrl: string): Promise<void>;
} {
    return editor as unknown as {
        buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[];
        handleWysiwygContextMenu(event: MouseEvent): void;
        pasteAtContextMenuSelection(): Promise<void>;
        promptAndApplyLink(title: string, defaultUrl: string): Promise<void>;
    };
}

/** Folds every apply patch for `handle` into the attribute state it produces. */
function attrsOf(sink: RecordingDOMSink, handle: unknown): Record<string, string> {
    const attrs: Record<string, string> = {};

    for (const w of sink.writes) {
        if (w.op !== 'apply' || w.args[0] !== handle) continue;

        const patch = w.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] };

        for (const key of patch.removeAttr ?? []) delete attrs[key];
        for (const key of Object.keys(patch.setAttr ?? {})) attrs[key] = patch.setAttr![key];
    }

    return attrs;
}

/**
 * The class-rule style writes `ensureMarkdownEditorClassRules` makes. The
 * registrar is a module singleton guarded by `_classRulesEnsured`, so only
 * the first caller in this file records anything — this memo captures that
 * one run so several tests can assert against it.
 */
let _editorClassRuleWrites: ReturnType<typeof ruleStyleWrites> | null = null;

function editorClassRuleWrites(): ReturnType<typeof ruleStyleWrites> {
    if (_editorClassRuleWrites === null) {
        ensureMarkdownEditorClassRules();
        _editorClassRuleWrites = ruleStyleWrites(DOM.sink as RecordingDOMSink);
    }

    return _editorClassRuleWrites;
}

/** Places a collapsed range selection at the start of the document, so a block command has a selection to act on. */
function selectStart(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
}

/** The root's children, by Lexical node type, in document order. */
function childTypes(editor: MarkdownEditor): string[] {
    return lexicalOf(editor).read(() => $getRoot().getChildren().map((node) => node.getType()));
}

/** Whether the caret sits in a (necessarily just-created, still empty) paragraph. */
function caretIsInAParagraph(editor: MarkdownEditor): boolean {
    return lexicalOf(editor).read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return false;
        }

        const node = selection.anchor.getNode();

        return $isParagraphNode(node) || $isParagraphNode(node.getParent());
    });
}

describe('markdownTransformers curation', () => {
    it('contains exactly the eleven typing shortcuts', () => {
        expect(SHORTCUT_TRANSFORMERS).toHaveLength(11);
        expect(SHORTCUT_TRANSFORMERS).toEqual(expect.arrayContaining([
            HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
            BOLD_STAR, ITALIC_STAR, INLINE_CODE, STRIKETHROUGH, LINK,
            UNDERLINE,
        ]));
    });

    it('excludes the constructs the viewer drops (highlight, check-list)', () => {
        expect(SHORTCUT_TRANSFORMERS).not.toContain(HIGHLIGHT);
        expect(SHORTCUT_TRANSFORMERS).not.toContain(CHECK_LIST);
    });
});

describe('editorNodes table registration', () => {
    it('EDITOR_NODES contains TableNode, TableRowNode, and TableCellNode', () => {
        expect(EDITOR_NODES).toContain(TableNode);
        expect(EDITOR_NODES).toContain(TableRowNode);
        expect(EDITOR_NODES).toContain(TableCellNode);
    });

    it('EDITOR_NODES contains MarkdownBlockNode', () => {
        expect(EDITOR_NODES).toContain(MarkdownBlockNode);
    });

    it('EDITOR_NODES contains MarkdownColumnNode', () => {
        expect(EDITOR_NODES).toContain(MarkdownColumnNode);
    });

    it('EDITOR_NODES contains MarkdownImageNode', () => {
        expect(EDITOR_NODES).toContain(MarkdownImageNode);
    });

    it('EDITOR_NODES contains MarkdownSourceTextNode', () => {
        expect(EDITOR_NODES).toContain(MarkdownSourceTextNode);
    });

    it('EDITOR_NODES contains MarkdownRawBlockNode', () => {
        expect(EDITOR_NODES).toContain(MarkdownRawBlockNode);
    });

    it('EDITOR_NODES contains ReferenceLinkNode', () => {
        expect(EDITOR_NODES).toContain(ReferenceLinkNode);
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

describe('MarkdownEditor WYSIWYG surface line-height', () => {
    it('carries the same --ts-ui-md-line-height token the read-only Markdown viewer sets (Markdown.ts:606)', () => {
        const editor = new MarkdownEditor('# Hi');
        const surface = wysiwygOf(editor);

        editor.getElement(true);
        surface.getElement(true);

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink)
            .filter((w) => w.selector.includes(surface.getId()) && w.key === 'lineHeight');

        expect(rows.some((w) => w.value === 'var(--ts-ui-md-line-height, 1.8)')).toBe(true);
    });

    it('resets fenced- and inline-code lineHeight to normal, matching the read-only Markdown viewer\'s own reset (Markdown.ts:163,183)', () => {
        // Uses the editorClassRuleWrites() memo rather than mounting the
        // WYSIWYG surface: `ensureMarkdownEditorClassRules` only runs from
        // `WysiwygSurface.mount`, gated on the surface's first *layout* pass
        // (`onFirstLayout`), which `getElement(true)` alone does not drive
        // in this offline harness.
        const rows = editorClassRuleWrites().filter((w) => w.key === 'lineHeight');

        expect(rows.some((w) => w.selector.includes('ts-ui-mde-code') && w.value === 'normal')).toBe(true);
        expect(rows.some((w) => w.selector.includes('ts-ui-mde-inline-code') && w.value === 'normal')).toBe(true);
    });
});

describe('MarkdownEditor WYSIWYG surface table-header alignment parity', () => {
    it('writes textAlign: "left" on the table-cell-header rule, matching the read-only viewer\'s ts-ui-md-th rule', () => {
        const rows = editorClassRuleWrites().filter((w) => w.key === 'textAlign');

        expect(rows.some((w) => w.selector.includes('ts-ui-mde-table-cell-header') && w.value === 'left')).toBe(true);
    });
});

describe('MarkdownEditor WYSIWYG surface contenteditable', () => {
    it('stamps contenteditable="true" onto the surface element through the base attribute buffer', () => {
        // `setContentEditable` caches through `setElementAttribute` during
        // detached construction; `Component.init` replays the buffer onto
        // the handle it is given (Component.ts:7095 ->
        // ElementAttributes.attach at Component.ts:7107), so the surface
        // needs no `init()` override of its own to get the attribute onto
        // its element.
        const editor = new MarkdownEditor('# Hi');
        const surface = wysiwygOf(editor);

        editor.getElement(true);
        const element = surface.getElement(true);

        expect(attrsOf(DOM.sink as RecordingDOMSink, element).contenteditable).toBe('true');
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
                .toggleStrikethrough()
                .toggleUnderline()
                .setTextColor('#cc0000')
                .setTextColor(null)
                .setFontFamily('Georgia')
                .setFontFamily(null)
                .setFontSize('1.2em')
                .setFontSize(null)
                .toggleUnorderedList()
                .toggleOrderedList()
                .toggleLink('https://example.com')
                .toggleLink(null)
                .removeLink()
                .setBlockType('h1')
                .clearFormatting()
                .insertParagraphBeforeBlock()
                .insertParagraphAfterBlock()
        ).not.toThrow();
    });

    it('toggleUnderline() on a document with the caret in a word yields ++word++ in the value', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');

        selectStart(editor);
        editor.toggleUnderline();

        expect(editor.getValue()).toContain('++word++');
    });

    it('setTextColor(\'#cc0000\') with the caret in a word yields [word]{color=#cc0000}; calling it again with null yields word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');

        selectStart(editor);
        editor.setTextColor('#cc0000');

        expect(editor.getValue()).toContain('[word]{color=#cc0000}');

        editor.setTextColor(null);

        expect(normalize(editor.getValue())).toBe('word');
    });

    it('with the caret inside a link, setTextColor leaves the value unchanged', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [text](https://x) link.');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        const before = editor.getValue();
        editor.setTextColor('#cc0000');

        expect(editor.getValue()).toBe(before);
    });

    it('toggleStrikethrough round-trips ~~x~~ through setValue/getValue on a selected word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
        editor.toggleStrikethrough();

        expect(editor.getValue()).toContain('~~word~~');
    });

    it('clearFormatting strips bold/italic/strikethrough/inline-code markers, leaving plain text', () => {
        const editor = new MarkdownEditor();
        editor.setValue('**bold** *italic* `code` ~~struck~~');

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        editor.clearFormatting();

        const value = editor.getValue();

        expect(value).not.toContain('**');
        expect(value).not.toContain('*italic*');
        expect(value).not.toContain('`code`');
        expect(value).not.toContain('~~');
        expect(value).toContain('bold');
        expect(value).toContain('italic');
        expect(value).toContain('code');
        expect(value).toContain('struck');
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

    it('toggleLink("https://x") with a collapsed caret inside "hello" wraps only the enclosing word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);   // collapsed caret inside "hello"
            }
        }, { discrete: true });

        editor.toggleLink('https://x');

        expect(editor.getValue()).toContain('[hello](https://x) world');
        expect(editor.getValue()).not.toContain('[hello world](https://x)');
    });

    it('toggleLink("https://new") with the caret collapsed inside an existing link updates its URL in place', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [text](https://old) link.');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        editor.toggleLink('https://new');

        const value = editor.getValue();
        expect(value).toContain('[text](https://new)');
        expect(value).not.toContain('https://old');
        // No double-wrap: exactly one Markdown link in the document.
        expect((value.match(/\]\(/g) ?? []).length).toBe(1);
    });

    it('removeLink() with the caret collapsed inside a link leaves plain text', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [text](https://x) link.');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        editor.removeLink();

        const value = editor.getValue();
        expect(value).toContain('text');
        expect(value).not.toContain('[');
        expect(value).not.toContain('](');
    });

    it('removeLink() with only part of the link\'s text selected still removes the whole link', () => {
        const editor = new MarkdownEditor();
        editor.setValue('[hello world](https://x)');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(0, 'hello'.length);   // only "hello" selected
            }
        }, { discrete: true });

        editor.removeLink();

        const value = editor.getValue();
        expect(normalize(value)).toBe('hello world');
        expect(value).not.toContain('[');
    });

    it('removeLink() no-throws and leaves the value unchanged when the caret is not inside a link', () => {
        const editor = new MarkdownEditor();
        editor.setValue('plain text');
        selectStart(editor);

        expect(() => editor.removeLink()).not.toThrow();
        expect(normalize(editor.getValue())).toBe('plain text');
    });
});

describe('MarkdownEditor clipboard commands', () => {
    /** Selects the exact substring `word` within the document's first paragraph's first text node. */
    function selectWord(editor: MarkdownEditor, word: string): void {
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                const text = textNode.getTextContent();
                const start = text.indexOf(word);

                textNode.select(start, start + word.length);
            }
        }, { discrete: true });
    }

    /** The clipboard-write args recorded by `copy()`/`cut()`, in call order. */
    function clipboardWrites(): unknown[] {
        return (DOM.sink as RecordingDOMSink).writes
            .filter((w) => w.op === 'writeClipboardText')
            .map((w) => w.args[0]);
    }

    it('copy() with the whole document selected records exactly one write carrying the text', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        editor.copy();

        expect(clipboardWrites()).toEqual(['hello world']);
    });

    // copy()/cut() now expand a collapsed caret to its enclosing word first
    // (see $selectEnclosingWordIfCollapsed), matching the right-click menu's
    // own Cut/Copy-enabled state, which reflects that same hypothetical
    // expansion (see $classifyContextMenuTarget) — so a menu item shown as
    // enabled always does something when activated, instead of silently
    // no-oping the way an un-expanded collapsed caret used to.

    it('copy() with a collapsed caret inside a word copies the enclosing word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);   // collapsed at the start of "hello"

        editor.copy();

        expect(clipboardWrites()).toEqual(['hello']);
    });

    it('copy() with a collapsed caret with no adjacent word character records no write', () => {
        const editor = new MarkdownEditor();
        editor.setValue('a  b');   // two spaces: offset 2 is isolated from both words
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        editor.copy();

        expect(clipboardWrites()).toHaveLength(0);
    });

    it('cut() with "world" selected records the write and removes it from the value', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');

        editor.cut();

        expect(clipboardWrites()).toEqual(['world']);
        expect(editor.getValue()).not.toContain('world');
    });

    it('cut() with a collapsed caret inside a word cuts the enclosing word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);   // collapsed at the start of "hello"

        editor.cut();

        expect(clipboardWrites()).toEqual(['hello']);
        expect(editor.getValue()).not.toContain('hello');
    });

    it('cut() with a collapsed caret with no adjacent word character records no write and leaves the value unchanged', () => {
        const editor = new MarkdownEditor();
        editor.setValue('a  b');
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        editor.cut();

        expect(clipboardWrites()).toHaveLength(0);
        expect(editor.getValue()).toContain('a  b');
    });

    it('paste() with the read stubbed to "X" and a collapsed caret resolves true and inserts X at the caret', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(editor.getValue()).toContain('Xhello world');
    });

    it('paste() with the read stubbed to "X" and "world" selected resolves true and replaces world with X', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(editor.getValue()).toContain('hello X');
        expect(editor.getValue()).not.toContain('world');
    });

    it('paste() with the read stubbed to null resolves false and leaves the value unchanged', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);

        const result = await editor.paste();

        expect(result).toBe(false);
        expect(editor.getValue()).toContain('hello world');
    });

    it('paste() with the read stubbed to "" resolves true and leaves the value unchanged', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(editor.getValue()).toContain('hello world');
    });

    it('paste() with the read stubbed to "X" and the selection explicitly cleared resolves true and inserts nothing', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(editor.getValue()).toContain('hello world');
        expect(editor.getValue()).not.toContain('X');
    });

    it('copy() and cut() record no write for a multi-cell table selection, which is not a range selection', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cellA = row.getFirstChild() as TableCellNode;
            const cellB = cellA.getNextSibling() as TableCellNode;

            $setSelection($createTableSelectionFrom(table, cellA, cellB));
        }, { discrete: true });

        editor.copy();
        expect(clipboardWrites()).toHaveLength(0);

        editor.cut();
        expect(clipboardWrites()).toHaveLength(0);
        expect(editor.getValue()).toContain('1');
        expect(editor.getValue()).toContain('2');
    });

    // Regression: an explicit (already non-collapsed) selection left the
    // editor visibly unfocused after Copy/Cut/Paste, while a collapsed caret
    // expanded to its enclosing word did not. Root cause: $selectEnclosingWord-
    // IfCollapsed() is a true no-op on an already non-collapsed selection (it
    // never marks the selection dirty), so Lexical's reconciler skips its
    // selection-sync step entirely for that update — the *only* place that
    // incidentally restores focus (Lexical.dev.mjs's updateDOMSelection, the
    // "no DOM change needed" branch). Fixed by calling editor.focus()
    // explicitly, which forces that resync unconditionally via its own
    // documented behaviour: marking an already-clean selection dirty with
    // $setSelection(selection.clone()) — the same selection, not a different
    // one, so nothing about what's selected changes.
    it('copy() with an explicit (already non-collapsed) selection also focuses the editor', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');
        const focusSpy = vi.spyOn(lexicalOf(editor), 'focus');

        editor.copy();

        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('copy() with a collapsed caret expanded to a word also focuses the editor', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);
        const focusSpy = vi.spyOn(lexicalOf(editor), 'focus');

        editor.copy();

        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('cut() with an explicit (already non-collapsed) selection also focuses the editor', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');
        const focusSpy = vi.spyOn(lexicalOf(editor), 'focus');

        editor.cut();

        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('paste() focuses the editor on a successful insert, an empty clipboard, and a denied read alike', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        const focusSpy = vi.spyOn(lexicalOf(editor), 'focus');

        selectStart(editor);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');
        await editor.paste();
        expect(focusSpy).toHaveBeenCalledTimes(1);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');
        await editor.paste();
        expect(focusSpy).toHaveBeenCalledTimes(2);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);
        await editor.paste();
        expect(focusSpy).toHaveBeenCalledTimes(3);
    });
});

describe('MarkdownEditor dialect parity guard (packages-docs viewer-only additions)', () => {
    const FULL_DIALECT_DOC =
        '# Heading\n\n' +
        'A paragraph with **bold**, *italic*, and `inline code`.\n\n' +
        '- one\n- two\n\n' +
        '1. first\n2. second\n\n' +
        '> a quote\n\n' +
        '```\ncode\n```\n\n' +
        'A [link](https://example.com) in prose.';

    it('round-trips the full dialect unchanged, modulo normalize', () => {
        const editor = new MarkdownEditor();
        editor.setValue(FULL_DIALECT_DOC);

        expect(normalize(editor.getValue())).toBe(normalize(FULL_DIALECT_DOC));
    });

    it('round-trips a link byte-identical', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [link text](https://example.com/path) here.');

        expect(editor.getValue()).toContain('[link text](https://example.com/path)');
    });

    it('round-trips a link whose URL was changed in place via toggleLink through a fresh setValue/getValue', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [text](https://old) link.');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        editor.toggleLink('https://new');
        const value = editor.getValue();

        const reloaded = new MarkdownEditor();
        reloaded.setValue(value);

        expect(normalize(reloaded.getValue())).toBe(normalize(value));
        expect(reloaded.getValue()).toContain('[text](https://new)');
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

// These cover the mode API's offline-observable behaviour (get/set mode, the
// mode-aware value, cross-surface round-tripping, and change suppression on a
// no-op switch). Source-mode *change emission* — a `setValue`/user edit in
// source mode firing exactly one `"change"` — is NOT asserted here: it is driven
// only by CodeEditor's live CodeMirror update listener, which never fires under
// the modelled sink (see the file header and `CodeEditor.mount`). That path is
// manual-verify (exercised live in the MD Editor demo, whose `change → syncViewer`
// wiring reflects source edits) and shares its guard logic with the tested
// `handleChange` path.
describe('MarkdownEditor mode', () => {
    it('defaults to wysiwyg', () => {
        expect(new MarkdownEditor().getMode()).toBe('wysiwyg');
    });

    it('honours the mode option', () => {
        expect(new MarkdownEditor('x', { mode: 'source' }).getMode()).toBe('source');
    });

    it('getValue is mode-agnostic for the same document', () => {
        const editor = new MarkdownEditor('# Title');
        const wysiwyg = normalize(editor.getValue());

        editor.setMode('source');

        expect(normalize(editor.getValue())).toBe(wysiwyg);
    });

    it('setMode("source") exposes raw markdown equal to the pre-switch value', () => {
        const editor = new MarkdownEditor();
        editor.setValue('## Heading two');
        const before = editor.getValue();

        editor.setMode('source');

        expect(editor.getValue()).toBe(before);
    });

    it('edits made in source mode survive switching back to wysiwyg', () => {
        const editor = new MarkdownEditor('# Original');

        editor.setMode('source');
        editor.setValue('## Edited in source');
        editor.setMode('wysiwyg');

        expect(normalize(editor.getValue())).toContain('## Edited in source');
    });

    it('round-trips each corpus document through a source/wysiwyg switch', () => {
        for (const [name, doc] of Object.entries(CORPUS)) {
            const editor = new MarkdownEditor();
            editor.setValue(doc);
            const canonical = normalize(editor.getValue());

            editor.setMode('source');
            editor.setMode('wysiwyg');

            expect(normalize(editor.getValue()), name).toBe(canonical);
        }
    });

    it('setMode to the current mode is a no-op and fires no change', () => {
        let fired = 0;
        const editor = new MarkdownEditor('# Doc', { listeners: { change: () => { fired += 1; } } });

        editor.setMode('wysiwyg');

        expect(editor.getMode()).toBe('wysiwyg');
        expect(fired).toBe(0);
    });

    it('a mode round-trip on unchanged content fires no change', () => {
        let fired = 0;
        const editor = new MarkdownEditor('# Untouched', { listeners: { change: () => { fired += 1; } } });

        editor.setMode('source');
        editor.setMode('wysiwyg');

        expect(fired).toBe(0);
    });

    it('routes readOnly to both surfaces', () => {
        const editor = new MarkdownEditor(undefined, { readOnly: true });
        editor.setValue('locked');   // builds the headless Lexical editor

        expect(editor.getReadOnly()).toBe(true);
        expect(lexicalOf(editor).isEditable()).toBe(false);
        expect(codeEditorOf(editor).getReadOnly()).toBe(true);

        editor.setReadOnly(false);

        expect(lexicalOf(editor).isEditable()).toBe(true);
        expect(codeEditorOf(editor).getReadOnly()).toBe(false);
    });
});

describe('MarkdownEditor source-mode command no-ops', () => {
    const SOURCE_VALUE = '# Title\n\nhello world\n';

    // Every other command now has a real source-mode edit; these 11 are the
    // backlog — permanently guarded with the plain
    // `if (this.isSourceMode()) { return this; }` this block was originally
    // written to cover, since each needs its own design
    // (`setBlockAlignment`/`setColumnCount`'s `:::` fence rewrite, and the
    // nine table-structure commands' parsed pipe grid). The three style
    // setters left this table once they learnt to write the styled span —
    // see `'MarkdownEditor source-mode styled spans'`.
    const COMMANDS: Record<string, (editor: MarkdownEditor) => unknown> = {
        setBlockAlignment:     (editor) => editor.setBlockAlignment('center'),
        setColumnCount:        (editor) => editor.setColumnCount(2),
        insertTableRow:        (editor) => editor.insertTableRow(),
        deleteTableRow:        (editor) => editor.deleteTableRow(),
        insertTableColumn:     (editor) => editor.insertTableColumn(),
        deleteTableColumn:     (editor) => editor.deleteTableColumn(),
        setTableColumnAlignment: (editor) => editor.setTableColumnAlignment('left'),
        deleteTable:           (editor) => editor.deleteTable(),
        mergeTableCells:       (editor) => editor.mergeTableCells(),
        unmergeTableCell:      (editor) => editor.unmergeTableCell(),
        setTableColumnWidth:   (editor) => editor.setTableColumnWidth(120),
    };

    it('emits no change and leaves the value untouched', () => {
        for (const [name, run] of Object.entries(COMMANDS)) {
            const editor = new MarkdownEditor(SOURCE_VALUE, { mode: 'source' });
            let fired = 0;
            editor.on('change', () => { fired += 1; });

            run(editor);

            expect(fired, name).toBe(0);
            expect(editor.getValue(), name).toBe(SOURCE_VALUE);
        }
    });

    it('never builds the Lexical editor', () => {
        const editor = new MarkdownEditor('x', { mode: 'source' });

        editor.toggleBold();

        expect(lexicalOf(editor)).toBeNull();
    });

    it('still returns this for chaining', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });

        expect(editor.toggleBold()).toBe(editor);
    });

    it('paste still resolves false', async () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });

        await expect(editor.paste()).resolves.toBe(false);
    });
});

describe('MarkdownEditor source-mode commands', () => {
    it('bold rewrites the source text', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        expect(editor.toggleBold().getValue()).toBe('**hello** world');
    });

    it('pressing bold twice returns the original', () => {
        // Offline (no injected view), `getSelection()` always reports a
        // collapsed caret at offset 0, so the first press finds and wraps
        // the document's first word.
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        editor.toggleBold();

        expect(editor.getValue()).toBe('**hello** world');

        // The second press, over a real mounted view, would have a caret
        // still resting on the word it just wrapped (position 2, inside
        // `**hello**`) rather than offline's hardcoded 0 — inject that via a
        // duck-typed view, mirroring `code-editor.test.ts`'s own pattern,
        // and assert on the dispatched transaction rather than `getValue()`,
        // since the mocked `dispatch` does not itself mutate `_view.state`.
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: '**hello** world', selection: { anchor: 2, head: 7 } }),
            dispatch, focus: vi.fn(),
        };
        editor.toggleBold();

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0]![0]).toMatchObject({ changes: { from: 0, to: 9, insert: 'hello' } });
    });

    it('never builds the Lexical editor', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        editor.toggleBold();
        editor.toggleBold();

        expect(lexicalOf(editor)).toBeNull();
    });

    it('runs the transform against the injected range and dispatches once', () => {
        const editor = new MarkdownEditor('a hello b', { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: 'a hello b', selection: { anchor: 2, head: 7 } }),
            dispatch, focus: vi.fn(),
        };

        editor.toggleBold();

        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = dispatch.mock.calls[0][0];
        expect(spec.changes).toEqual({ from: 2, to: 7, insert: '**hello**' });
        expect(spec.selection).toEqual({ anchor: 4, head: 9 });
    });

    it('read-only refuses and signals, leaving the value unchanged', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source', readOnly: true });
        let readonlyEdits = 0;
        codeEditorOf(editor).on('readonlyedit', () => { readonlyEdits += 1; });

        editor.toggleBold();

        expect(editor.getValue()).toBe('hello');
        expect(readonlyEdits).toBe(1);
    });

    it('restores focus after a handled command', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });
        const focusSpy = vi.spyOn(codeEditorOf(editor), 'focus');

        editor.toggleBold();

        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('restores focus even when the transform declines', () => {
        const editor = new MarkdownEditor('a  b', { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: 'a  b', selection: { anchor: 2, head: 2 } }),
            dispatch, focus: vi.fn(),
        };
        const focusSpy = vi.spyOn(codeEditorOf(editor), 'focus');

        editor.toggleBold();

        expect(dispatch).not.toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('copy() delegates to the source editor\'s own copy()', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });
        const copySpy = vi.spyOn(codeEditorOf(editor), 'copy');

        editor.copy();

        expect(copySpy).toHaveBeenCalledOnce();
    });

    it('cut() delegates to the source editor\'s own cut()', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });
        const cutSpy = vi.spyOn(codeEditorOf(editor), 'cut');

        editor.cut();

        expect(cutSpy).toHaveBeenCalledOnce();
    });

    it('paste() resolves to what the source editor\'s own paste() resolves', async () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });
        const pasteSpy = vi.spyOn(codeEditorOf(editor), 'paste').mockResolvedValue(true);

        const pasted = await editor.paste();

        expect(pasteSpy).toHaveBeenCalledOnce();
        expect(pasted).toBe(true);
    });

    it('the selection state comes from the source text', () => {
        const editor = new MarkdownEditor('**hi** there', { mode: 'source' });
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: '**hi** there', selection: { anchor: 2, head: 4 } }),
        };

        expect(editor.getSelectionState()).toEqual({
            bold: true, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: true, linkUrl: null,
            inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
        });
    });

    it('setMode emits a fresh state for the newly-shown surface', () => {
        const editor = new MarkdownEditor('**hi** there');
        editor.setValue('**hi** there'); // forces the headless Lexical editor to build

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const payloads: MarkdownEditorSelectionState[] = [];
        editor.on('selectionstate', (state) => payloads.push(state));

        editor.setMode('source');

        expect(payloads).toEqual([{
            bold: false, italic: false, underline: false, strikethrough: false, code: false,
            hasSelectedText: false, linkUrl: null,
            inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
        }]);
    });

    it('a caret move refreshes the selection state', () => {
        // The `selectionchange` half of the wiring: a caret move alone changes
        // no text, so only this listener can keep a toolbar's pressed state
        // current as the caret crosses into a `**bold**` run.
        const editor = new MarkdownEditor('**hi** there', { mode: 'source' });
        const state = EditorState.create({ doc: '**hi** there', selection: { anchor: 2, head: 4 } });
        codeEditorOf(editor)._view = { state };

        const payloads: MarkdownEditorSelectionState[] = [];
        editor.on('selectionstate', (payload) => payloads.push(payload));

        codeEditorOf(editor).onSelectionChange(state);

        expect(payloads).toHaveLength(1);
        expect(payloads[0]!.bold).toBe(true);
        expect(payloads[0]!.hasSelectedText).toBe(true);
    });

    it('a source edit refreshes the selection state', () => {
        const editor = new MarkdownEditor('hi there', { mode: 'source' });
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: '**hi** there', selection: { anchor: 2, head: 4 } }),
        };

        const payloads: MarkdownEditorSelectionState[] = [];
        editor.on('selectionstate', (state) => payloads.push(state));

        codeEditorOf(editor).onDocChange('**hi** there');

        expect(payloads).toHaveLength(1);
        expect(payloads[0]!.bold).toBe(true);
    });
});

// Each implemented command has to route to ITS OWN transform, and has to do so
// without building the Lexical editor. A table of (document, selection,
// command) -> dispatched change catches both classes of wiring bug the rest of
// this file would miss: wiring a command to the wrong transform fails on the
// insert, and putting the source-mode guard after `ensureEditor()` fails on the
// Lexical assertion. `toggleBold`, `setBlockType`, `insertTable`, `copy`, `cut`
// and `paste` have their own cases above and below.
describe('MarkdownEditor source-mode command wiring', () => {
    const CASES: Array<{
        name:    string;
        doc:     string;
        anchor:  number;
        head:    number;
        run:     (editor: MarkdownEditor) => unknown;
        changes: { from: number; to: number; insert: string };
    }> = [
        {
            name: 'toggleItalic', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.toggleItalic(), changes: { from: 2, to: 7, insert: '*hello*' },
        },
        {
            name: 'toggleUnderline', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.toggleUnderline(), changes: { from: 2, to: 7, insert: '++hello++' },
        },
        {
            name: 'toggleStrikethrough', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.toggleStrikethrough(), changes: { from: 2, to: 7, insert: '~~hello~~' },
        },
        {
            name: 'toggleInlineCode', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.toggleInlineCode(), changes: { from: 2, to: 7, insert: '`hello`' },
        },
        {
            name: 'toggleLink', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.toggleLink('/x'), changes: { from: 2, to: 7, insert: '[hello](/x)' },
        },
        {
            name: 'removeLink', doc: 'a [hello](/x) b', anchor: 5, head: 5,
            run: (editor) => editor.removeLink(), changes: { from: 2, to: 13, insert: 'hello' },
        },
        {
            name: 'clearFormatting', doc: 'a **hello** b', anchor: 4, head: 9,
            run: (editor) => editor.clearFormatting(), changes: { from: 2, to: 11, insert: 'hello' },
        },
        {
            name: 'toggleUnorderedList', doc: 'a\nb', anchor: 0, head: 3,
            run: (editor) => editor.toggleUnorderedList(), changes: { from: 0, to: 3, insert: '- a\n- b' },
        },
        {
            name: 'toggleOrderedList', doc: 'a\nb', anchor: 0, head: 3,
            run: (editor) => editor.toggleOrderedList(), changes: { from: 0, to: 3, insert: '1. a\n2. b' },
        },
        {
            name: 'insertParagraphBeforeBlock', doc: '> q', anchor: 2, head: 2,
            run: (editor) => editor.insertParagraphBeforeBlock(), changes: { from: 0, to: 0, insert: '\n\n' },
        },
        {
            name: 'insertParagraphAfterBlock', doc: '> q', anchor: 2, head: 2,
            run: (editor) => editor.insertParagraphAfterBlock(), changes: { from: 3, to: 3, insert: '\n\n' },
        },
        {
            name: 'insertImage', doc: 'a hello b', anchor: 2, head: 7,
            run: (editor) => editor.insertImage('/d.png', { alt: 'Diagram', width: 320 }),
            changes: { from: 2, to: 7, insert: '![Diagram](/d.png){width=320}' },
        },
    ];

    for (const testCase of CASES) {
        it(`${testCase.name} dispatches its own transform's edit without building Lexical`, () => {
            const editor = new MarkdownEditor(testCase.doc, { mode: 'source' });
            const dispatch = vi.fn();
            codeEditorOf(editor)._view = {
                state: EditorState.create({
                    doc:       testCase.doc,
                    selection: { anchor: testCase.anchor, head: testCase.head },
                }),
                dispatch, focus: vi.fn(),
            };

            testCase.run(editor);

            expect(dispatch, testCase.name).toHaveBeenCalledTimes(1);
            expect(dispatch.mock.calls[0]![0].changes, testCase.name).toEqual(testCase.changes);
            expect(lexicalOf(editor), testCase.name).toBeNull();
        });
    }

    // A command with nothing to change must dispatch nothing: an identical
    // rewrite is still a transaction, and so still an undo step the user has to
    // spend to get back past it.
    const NO_OP_CASES: Array<{ name: string; doc: string; run: (editor: MarkdownEditor) => unknown }> = [
        { name: 'clearFormatting on unformatted text', doc: 'hello world', run: (editor) => editor.clearFormatting() },
        { name: 'setBlockType("paragraph") on a paragraph', doc: 'hello world', run: (editor) => editor.setBlockType('paragraph') },
        { name: 'setBlockType("h2") on an h2', doc: '## hello', run: (editor) => editor.setBlockType('h2') },
        { name: 'setBlockType("code") on a fenced block', doc: '```\nhello\n```', run: (editor) => editor.setBlockType('code') },
    ];

    for (const testCase of NO_OP_CASES) {
        it(`${testCase.name} dispatches nothing, but still restores focus`, () => {
            const editor = new MarkdownEditor(testCase.doc, { mode: 'source' });
            const dispatch = vi.fn();
            const focus = vi.fn();
            codeEditorOf(editor)._view = {
                state: EditorState.create({ doc: testCase.doc, selection: { anchor: 0, head: testCase.doc.length } }),
                dispatch, focus,
            };

            testCase.run(editor);

            expect(dispatch, testCase.name).not.toHaveBeenCalled();
            expect(focus, testCase.name).toHaveBeenCalledTimes(1);
            expect(editor.getValue(), testCase.name).toBe(testCase.doc);
        });
    }
});

describe('MarkdownEditor source-mode block commands', () => {
    it('setBlockType maps the type to the right transform', () => {
        expect(new MarkdownEditor('hello', { mode: 'source' }).setBlockType('h2').getValue()).toBe('## hello');
        expect(new MarkdownEditor('hello', { mode: 'source' }).setBlockType('code').getValue())
            .toBe('```\nhello\n```');
    });

    it('insertTable writes a GFM skeleton', () => {
        expect(new MarkdownEditor('', { mode: 'source' }).insertTable(2, 3).getValue())
            .toContain('| --- | --- | --- |');
    });

    it('the 11 backlog commands still no-op', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source' });

        editor.setBlockAlignment('center');
        editor.setColumnCount(2);
        editor.insertTableRow();
        editor.deleteTableRow();
        editor.insertTableColumn();
        editor.deleteTableColumn();
        editor.setTableColumnAlignment('left');
        editor.deleteTable();
        editor.mergeTableCells();
        editor.unmergeTableCell();
        editor.setTableColumnWidth(120);

        expect(editor.getValue()).toBe('hello');
    });

    it('source output round-trips through a mode switch', () => {
        const tableSkeleton = ((): string => {
            const codeEditor = new MarkdownEditor('', { mode: 'source' }).insertTable(2, 3).getValue();

            return codeEditor.trim();
        })();

        for (const doc of ['**hello** world', '++hello++ world', '## hello', '- a\n- b', tableSkeleton]) {
            const editor = new MarkdownEditor(doc, { mode: 'source' });

            editor.setMode('wysiwyg');

            expect(normalize(editor.getValue()), doc).toBe(normalize(doc));
        }
    });
});

// Offline, `CodeEditor.getSelection()` reports a collapsed caret at offset 0,
// so a command with no injected view acts on the document's first word — and a
// SECOND command in the same test still sees that same offset-0 caret. Every
// case needing the caret elsewhere injects a duck-typed view and asserts the
// dispatched transaction, exactly as the source-mode cases above do.
describe('MarkdownEditor source-mode styled spans', () => {
    /** The styled span the merge / clear cases act on — its length is the range the rewrite replaces. */
    const SPAN = '[hello]{color=#cc0000}';
    /** The document those cases inject a view over: that span, then plain text. */
    const SPANNED = `${SPAN} world`;

    it('a colour reaches the source text', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        expect(editor.setTextColor('#cc0000').getValue()).toBe('[hello]{color=#cc0000} world');
    });

    it('a font family reaches the source text', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        expect(editor.setFontFamily('Georgia, serif').getValue()).toBe('[hello]{font="Georgia, serif"} world');
    });

    it('a second attribute merges into the span rather than nesting inside it', () => {
        const editor = new MarkdownEditor(SPANNED, { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: SPANNED, selection: { anchor: 1, head: 6 } }),
            dispatch, focus: vi.fn(),
        };

        editor.setFontSize('1.2em');

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0]![0].changes)
            .toEqual({ from: 0, to: SPAN.length, insert: '[hello]{color=#cc0000 size=1.2em}' });
        expect(dispatch.mock.calls[0]![0].selection).toEqual({ anchor: 1, head: 6 });
    });

    it('clearing the last attribute takes the whole span away', () => {
        const editor = new MarkdownEditor(SPANNED, { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: SPANNED, selection: { anchor: 1, head: 6 } }),
            dispatch, focus: vi.fn(),
        };

        editor.setTextColor(null);

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0]![0].changes).toEqual({ from: 0, to: SPAN.length, insert: 'hello' });
        expect(dispatch.mock.calls[0]![0].selection).toEqual({ anchor: 0, head: 5 });
    });

    it('never builds the Lexical editor', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });

        editor.setTextColor('#cc0000');
        editor.setFontFamily('Georgia, serif');
        editor.setFontSize('1.2em');

        expect(lexicalOf(editor)).toBeNull();
    });

    // The WYSIWYG side refuses a style inside a link, so the source side has to
    // refuse it too — see the matching WYSIWYG case earlier in this file.
    it('a selection inside a link still refuses', () => {
        const editor = new MarkdownEditor('see [docs](/d)', { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: 'see [docs](/d)', selection: { anchor: 5, head: 9 } }),
            dispatch, focus: vi.fn(),
        };

        editor.setTextColor('#cc0000');

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('read-only refuses and signals, leaving the value unchanged', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source', readOnly: true });
        let readonlyEdits = 0;
        codeEditorOf(editor).on('readonlyedit', () => { readonlyEdits += 1; });

        editor.setTextColor('#cc0000');

        expect(editor.getValue()).toBe('hello world');
        expect(readonlyEdits).toBe(1);
    });

    it('restores focus after a handled command', () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source' });
        const focusSpy = vi.spyOn(codeEditorOf(editor), 'focus');

        editor.setTextColor('#cc0000');

        expect(focusSpy).toHaveBeenCalledOnce();
    });

    it('restores focus even when the transform declines', () => {
        const editor = new MarkdownEditor('see [docs](/d)', { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: 'see [docs](/d)', selection: { anchor: 5, head: 9 } }),
            dispatch, focus: vi.fn(),
        };
        const focusSpy = vi.spyOn(codeEditorOf(editor), 'focus');

        editor.setTextColor('#cc0000');

        expect(dispatch).not.toHaveBeenCalled();
        expect(focusSpy).toHaveBeenCalledOnce();
    });

    // Plan markdown-editor-marked-import, whole-stack review: source mode reads
    // the bold run through the viewer's tokens, so it writes the span inside it
    // rather than declining.
    it('setTextColor inside a wider bold run writes the span inside the run', () => {
        const text = '**hello world**';
        const editor = new MarkdownEditor(text, { mode: 'source' });
        const dispatch = vi.fn();
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: text, selection: { anchor: 8, head: 13 } }),
            dispatch, focus: vi.fn(),
        };

        editor.setTextColor('#cc0000');

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0]![0].changes).toEqual({ from: 8, to: 13, insert: '[world]{color=#cc0000}' });
    });

    // The dialect guarantee: what source mode writes survives a switch with
    // its meaning, and byte-for-byte unless the serializer has a canonical
    // form for it.
    it('round-trips its own output through a mode switch', () => {
        // Source mode writes colour on a whole bold run inside it, the form the serializer writes (S19).
        const documents: Array<[string, string]> = [
            ['[hello]{color=#cc0000} world', '[hello]{color=#cc0000} world'],
            ['[hello]{color=#cc0000 size=1.2em} world', '[hello]{color=#cc0000 size=1.2em} world'],
            ['[hello]{font="Georgia, serif"} world', '[hello]{font="Georgia, serif"} world'],
            ['a **[hello]{color=#cc0000}** b', 'a **[hello]{color=#cc0000}** b'],
            ['**hello [world]{color=#cc0000}**', '**hello [world]{color=#cc0000}**'],
            ['[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}', '[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}'],
        ];

        for (const [doc, saved] of documents) {
            const editor = new MarkdownEditor(doc, { mode: 'source' });

            editor.setMode('wysiwyg');

            expect(normalize(editor.getValue()), doc).toBe(normalize(saved));
            expect(viewerModel(editor.getValue()), doc).toEqual(viewerModel(doc));
        }
    });
});

/**
 * Injects a duck-typed CodeMirror view whose `dispatch` really applies the
 * transaction, so a source-mode command's edit lands in `getValue()` and a
 * later `setMode('wysiwyg')` loads the edited text.
 */
function injectLiveSourceView(editor: MarkdownEditor, doc: string, anchor: number, head: number): void {
    const view = {
        state:    EditorState.create({ doc, selection: { anchor, head } }),
        focus:    vi.fn(),
        dispatch: (spec: Parameters<EditorState['update']>[0]): void => {
            view.state = view.state.update(spec).state;
        },
    };

    codeEditorOf(editor)._view = view;
}

// Plan markdown-editor-marked-import, whole-stack review C1/C2/F13 and the
// advisory: each repro runs end to end — the command on the source text, then a
// switch to WYSIWYG, whose surface must be what the viewer shows for the
// source text the command left (a declined command leaves it unchanged).
describe('MarkdownEditor source-mode commands read the viewer\'s tokens', () => {
    const COLOUR = '#cc0000';
    const CASES: Array<{
        name:   string;
        doc:    string;
        select: string | [number, number];
        run:    (editor: MarkdownEditor) => unknown;
        result: string;
    }> = [
        {
            name: 'C1: colour cutting an underscore run declines', doc: '_hello world_ again', select: 'world_ again',
            run: (editor) => editor.setTextColor(COLOUR), result: '_hello world_ again',
        },
        {
            name: 'C1: italic on an underscore run removes it', doc: 'a _hello_ b', select: 'hello',
            run: (editor) => editor.toggleItalic(), result: 'a hello b',
        },
        {
            name: 'C1: clear formatting clears `__…__`', doc: 'a __hello__ b', select: [6, 6],
            run: (editor) => editor.clearFormatting(), result: 'a hello b',
        },
        {
            name: 'C2: colour inside a shortcut reference link declines', doc: 'see [docs] here\n\n[docs]: /d', select: 'docs',
            run: (editor) => editor.setTextColor(COLOUR), result: 'see [docs] here\n\n[docs]: /d',
        },
        {
            name: 'C2: remove link unwraps a shortcut reference link', doc: 'see [docs] here\n\n[docs]: /d', select: [6, 6],
            run: (editor) => editor.removeLink(), result: 'see docs here\n\n[docs]: /d',
        },
        {
            name: 'C2: colour inside a bare URL declines', doc: 'see https://example.com/docs', select: 'docs',
            run: (editor) => editor.setTextColor(COLOUR), result: 'see https://example.com/docs',
        },
        {
            name: 'C2: remove link keeps an email address unlinked', doc: 'mail me@example.com', select: [8, 8],
            run: (editor) => editor.removeLink(), result: 'mail me\\@example.com',
        },
        {
            name: 'F13: bold inside an email autolink declines', doc: '<m@x.y>', select: [3, 4],
            run: (editor) => editor.toggleBold(), result: '<m@x.y>',
        },
        {
            name: 'F13: a link inside an autolink re-points it instead of nesting', doc: '<https://a.b>', select: 'a.b',
            run: (editor) => editor.toggleLink('https://n'), result: '[https://a.b](https://n)',
        },
        {
            name: 'advisory: colour beside a span inside a bold run', doc: '**hello [world]{size=1.2em} again**', select: 'again',
            run: (editor) => editor.setTextColor(COLOUR), result: '**hello [world]{size=1.2em} [again]{color=#cc0000}**',
        },
        {
            name: 'advisory: colour on a `*` list item', doc: '* item here', select: 'item',
            run: (editor) => editor.setTextColor(COLOUR), result: '* [item]{color=#cc0000} here',
        },
        {
            name: 'advisory: colour on a whole bold run writes the serializer\'s form', doc: 'a **hello** b', select: 'hello',
            run: (editor) => editor.setTextColor(COLOUR), result: 'a **[hello]{color=#cc0000}** b',
        },
    ];

    for (const testCase of CASES) {
        it(testCase.name, () => {
            const editor = new MarkdownEditor(testCase.doc, { mode: 'source' });
            const [from, to] = typeof testCase.select === 'string'
                ? [testCase.doc.indexOf(testCase.select), testCase.doc.indexOf(testCase.select) + testCase.select.length]
                : testCase.select;

            injectLiveSourceView(editor, testCase.doc, from, to);
            testCase.run(editor);

            expect(editor.getValue()).toBe(testCase.result);

            editor.setMode('wysiwyg');

            // A link reference definition shows as a raw block in the editor, while the viewer shows nothing for it.
            const surface = editorSurfaceModel(editor).filter((block) => !(block.kind === 'raw' && /^\[[^\]]+\]:/.test(block.text)));

            expect(surface).toEqual(viewerModel(testCase.result).blocks);
        });
    }
});

// Whole-stack review fixes (source-mode fuzz): each line command run in
// source mode, then a switch to WYSIWYG, shows what the viewer shows.
describe('MarkdownEditor source-mode line commands read the viewer\'s blocks', () => {
    const CASES: Array<{
        name:   string;
        doc:    string;
        select: [number, number];
        run:    (editor: MarkdownEditor) => unknown;
        result: string;
    }> = [
        {
            name: 'a heading from a list item keeps the item\'s indented content in the item', doc: '10. a\n\n    b', select: [4, 4],
            run: (editor) => editor.setBlockType('h2'), result: '## a\n\n10. b',
        },
        {
            name: 'a quote from a list item keeps its nested list in the item', doc: '- a\n  - b\n- c', select: [2, 2],
            run: (editor) => editor.setBlockType('quote'), result: '> a\n- - b\n- c',
        },
        {
            name: 'a code block from a list item keeps the item\'s indented content in the item', doc: '10. a\n\n    b', select: [4, 4],
            run: (editor) => editor.setBlockType('code'), result: '```\na\n```\n\n10. b',
        },
        {
            name: 'a paragraph from a heading does not swallow the definition below', doc: '# a\n[r]: /u\n\n[r]', select: [2, 2],
            run: (editor) => editor.setBlockType('paragraph'), result: 'a\n\n[r]: /u\n\n[r]',
        },
        {
            name: 'a paragraph from a quote does not join the list item above', doc: '- a\n> b', select: [6, 6],
            run: (editor) => editor.setBlockType('paragraph'), result: '- a\n\nb',
        },
        {
            name: 'toggling a list off keeps its items apart', doc: '- a\n- b', select: [0, 7],
            run: (editor) => editor.toggleUnorderedList(), result: 'a\n\nb',
        },
        {
            name: 'a table goes above the HTML block holding the caret', doc: '<div>\nhi\n</div>', select: [7, 7],
            run: (editor) => editor.insertTable(2, 2), result: '|  |  |\n| --- | --- |\n|  |  |\n\n<div>\nhi\n</div>',
        },
        {
            name: 'a table goes above the table holding the caret', doc: '| a |\n| - |\n| b |', select: [14, 14],
            run: (editor) => editor.insertTable(2, 2), result: '|  |  |\n| --- | --- |\n|  |  |\n\n| a |\n| - |\n| b |',
        },
        {
            name: 'a quote from a heading escapes the fence its text would open', doc: '###### ~~~ x', select: [8, 8],
            run: (editor) => editor.setBlockType('quote'), result: '> \\~~~ x',
        },
        {
            name: 'a heading declines in a table cell', doc: '| a |\n| - |\n| b |', select: [14, 14],
            run: (editor) => editor.setBlockType('h2'), result: '| a |\n| - |\n| b |',
        },
    ];

    for (const testCase of CASES) {
        it(testCase.name, () => {
            const editor = new MarkdownEditor(testCase.doc, { mode: 'source' });

            injectLiveSourceView(editor, testCase.doc, testCase.select[0], testCase.select[1]);
            testCase.run(editor);

            expect(editor.getValue()).toBe(testCase.result);

            editor.setMode('wysiwyg');

            // A link reference definition shows as a raw block in the editor, while the viewer shows nothing for it.
            const surface = editorSurfaceModel(editor).filter((block) => !(block.kind === 'raw' && /^\[[^\]]+\]:/.test(block.text)));

            expect(surface).toEqual(viewerModel(testCase.result).blocks);
        });
    }

    // The editor keeps this document as a raw block, which shows `b`; the
    // viewer hides it. Only the decline is checked.
    it('a heading declines on a line the viewer does not show', () => {
        const doc = '> > ```\n> > a\n> > ```\nb';
        const editor = new MarkdownEditor(doc, { mode: 'source' });

        injectLiveSourceView(editor, doc, doc.length, doc.length);
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe(doc);
    });
});

describe('MarkdownEditor dirty state', () => {
    it('a fresh editor is clean', () => {
        expect(new MarkdownEditor('# Hi').isDirty()).toBe(false);
        expect(new MarkdownEditor().isDirty()).toBe(false);
    });

    it('a WYSIWYG edit marks it dirty, and undoing it clears the flag', () => {
        const editor = new MarkdownEditor('# Hi');

        editor.setValue('# Bye');
        expect(editor.isDirty()).toBe(true);

        editor.setValue('# Hi');
        expect(editor.isDirty()).toBe(false);
    });

    it('onDirtyChange fires once per real transition', () => {
        const editor = new MarkdownEditor('# Hi');
        let fired = 0;
        let received: boolean | null = null;
        editor.onDirtyChange((dirty) => { fired += 1; received = dirty; });

        editor.setValue('# A');
        editor.setValue('# B');
        expect(fired).toBe(1);
        expect(received).toBe(true);

        editor.setValue('# Hi');
        expect(fired).toBe(2);
        expect(received).toBe(false);
    });

    it('markClean() moves the clean point and is chainable', () => {
        const editor = new MarkdownEditor('# Hi');

        editor.setValue('# A');
        const returned = editor.markClean();
        expect(returned).toBe(editor);
        expect(editor.isDirty()).toBe(false);

        editor.setValue('# Hi');
        expect(editor.isDirty()).toBe(true);

        editor.setValue('# A');
        expect(editor.isDirty()).toBe(false);
    });

    it('"change" still fires, with the flag settled first', () => {
        const editor = new MarkdownEditor('# Hi');
        const dirtyAtChange: boolean[] = [];
        editor.on('change', () => { dirtyAtChange.push(editor.isDirty()); });

        editor.setValue('# Edited');
        editor.setValue('# Hi');

        expect(dirtyAtChange).toEqual([true, false]);
    });

    it('the relay reaches a real parent', () => {
        const editor = new MarkdownEditor('# Hi');
        const parent = new Component();
        parent.addComponent(editor);
        let fired = 0;
        parent.onDirtyChange(() => { fired += 1; });

        editor.setValue('# A');
        expect(parent.isDirty()).toBe(true);

        editor.markClean();
        expect(parent.isDirty()).toBe(false);

        expect(fired).toBe(2);
    });

    it('a construction value the converters normalize does not report dirty', () => {
        const editor = new MarkdownEditor('# Title\n\nbody\n');

        (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();
        expect(editor.isDirty()).toBe(false);

        // A selection-only update, as `focus()` produces.
        lexicalOf(editor).update(() => {}, { discrete: true });
        expect(editor.isDirty()).toBe(false);

        expect((editor as unknown as { _cleanValue: string })._cleanValue).toBe(editor.getValue());
    });

    it('a mode round trip with no edits leaves it clean, whether or not the Lexical editor was built first', () => {
        const built = new MarkdownEditor('# Title\n\nbody\n');
        (built as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();
        built.setMode('source');
        built.setMode('wysiwyg');
        expect(built.isDirty()).toBe(false);

        const notBuilt = new MarkdownEditor('# Title\n\nbody\n');
        notBuilt.setMode('source');
        notBuilt.setMode('wysiwyg');
        expect(notBuilt.isDirty()).toBe(false);
    });

    it('a source-surface edit marks the editor dirty while the child stays clean', () => {
        const editor = new MarkdownEditor('# Hi', { mode: 'source' });
        let fired = 0;
        let received: boolean | null = null;
        editor.onDirtyChange((dirty) => { fired += 1; received = dirty; });

        codeEditorOf(editor).onDocChange('# Hi typed');
        expect(editor.isDirty()).toBe(true);
        expect(codeEditorOf(editor).isDirty()).toBe(false);
        expect(fired).toBe(1);
        expect(received).toBe(true);

        codeEditorOf(editor).onDocChange('# Hi');
        expect(editor.isDirty()).toBe(false);
        expect(codeEditorOf(editor).isDirty()).toBe(false);
        expect(fired).toBe(2);
        expect(received).toBe(false);
    });

    it('markClean() leaves the child clean too', () => {
        const editor = new MarkdownEditor('# Hi', { mode: 'source' });

        codeEditorOf(editor).onDocChange('# Hi typed');
        editor.markClean();

        expect(editor.isDirty()).toBe(false);
        expect(codeEditorOf(editor).isDirty()).toBe(false);
    });

    it('dirty survives a mode switch', () => {
        const editor = new MarkdownEditor('# Hi');

        editor.setValue('# Edited');
        expect(editor.isDirty()).toBe(true);

        editor.setMode('source');
        expect(editor.isDirty()).toBe(true);

        editor.setMode('wysiwyg');
        expect(editor.isDirty()).toBe(true);
    });

    it('a first build that happens after a source-mode edit does not clear the flag', () => {
        const editor = new MarkdownEditor('# Title\n\nbody\n', { mode: 'source' });

        codeEditorOf(editor).onDocChange('# Title\n\nbody\n\nmore');
        expect(editor.isDirty()).toBe(true);

        editor.setMode('wysiwyg');   // the first ensureEditor() call
        expect(editor.isDirty()).toBe(true);
    });
});

describe('MarkdownEditor dialect fidelity (viewer token set)', () => {
    for (const [name, doc] of Object.entries(CORPUS)) {
        it(`emits only viewer-supported tokens for ${name}`, () => {
            const editor = new MarkdownEditor();
            editor.setValue(doc);

            const tokens = lexMarkdown(editor.getValue());
            const types = tokens.map((token) => token.type);

            for (const type of types) {
                expect(VIEWER_TOKENS.has(type)).toBe(true);
            }
        });
    }
});

describe('MarkdownEditor table import/export edge cases', () => {
    it('round-trips per-column alignment from the delimiter row', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| :---: | --- |\n| 1 | 2 |');

        expect(normalize(editor.getValue())).toBe('| a | b |\n| :---: | --- |\n| 1 | 2 |');
    });

    it('two pipe lines with no delimiter row do not become a table', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| 1 | 2 |');

        const tokens = lexMarkdown(editor.getValue());

        expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
        expect(editor.getValue()).not.toContain('---');
    });

    it('a delimiter row narrower than the header does not become a table, matching the viewer', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- |\n| 1 | 2 |');

        const tokens = lexMarkdown(editor.getValue());

        expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
    });

    it('normalises a table authored without leading/trailing pipes to the canonical piped form', () => {
        const editor = new MarkdownEditor();
        editor.setValue('a | b\n--- | ---\n1 | 2');

        expect(normalize(editor.getValue())).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    });

    it('absorbs a following non-blank prose line as an extra row, matching marked', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |\ntrailing prose');

        const lines = normalize(editor.getValue()).split('\n');

        expect(lines).toHaveLength(4);   // header, delimiter, and two body rows
        expect(lines[3]).toBe('| trailing prose |  |');
    });

    it('round-trips a column width to a fixpoint, and the reloaded table\'s colWidths is [240, 0]', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |');

        const value = editor.getValue();
        expect(normalize(value)).toBe('| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |');

        const reloaded = new MarkdownEditor();
        reloaded.setValue(value);

        const colWidths = lexicalOf(reloaded).read(() => (($getRoot().getFirstChild() as TableNode).getColWidths()));
        expect(colWidths).toEqual([240, 0]);
    });

    it('round-trips a merged cell to a fixpoint, and the imported table\'s first body row has one cell with colSpan 2', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| d | << |');

        const value = editor.getValue();
        expect(normalize(value)).toBe('| a | b |\n| --- | --- |\n| d | << |');

        const { cellCount, colSpan } = lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const bodyRow = table.getChildAtIndex(1) as TableRowNode;
            const bodyCells = bodyRow.getChildren().filter($isTableCellNode);

            return { cellCount: bodyCells.length, colSpan: bodyCells[0]!.getColSpan() };
        });

        expect(cellCount).toBe(1);
        expect(colSpan).toBe(2);
    });

    it('emits the << / ^^ markers again in the same positions after importing a merged table', () => {
        const editor = new MarkdownEditor();
        const doc = '| a | b | c |\n| --- | --- | --- |\n| d | << | f |\n| ^^ | ^^ | g |';
        editor.setValue(doc);

        expect(normalize(editor.getValue())).toBe(doc);
    });
});

describe('MarkdownEditor table commands', () => {
    /** The number of `|` characters in a line — one more than its column count. */
    function pipeCount(line: string): number {
        return (line.match(/\|/g) ?? []).length;
    }

    it('insertTable(2, 3) on an empty editor creates a header row, delimiter row, and one 3-column body row', () => {
        const editor = new MarkdownEditor();

        editor.insertTable(2, 3);

        const lines = normalize(editor.getValue()).split('\n');

        expect(lines).toHaveLength(3);
        expect(pipeCount(lines[0])).toBe(4);
        expect(pipeCount(lines[1])).toBe(4);
        expect(pipeCount(lines[2])).toBe(4);
        expect(lines[1]).toContain('---');
    });

    it('insertTableRow adds a body row and insertTableColumn adds a column to every row', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);

        editor.insertTableRow();
        expect(normalize(editor.getValue()).split('\n')).toHaveLength(4);   // header, delimiter, 2 body rows

        editor.insertTableColumn();
        const lines = normalize(editor.getValue()).split('\n');

        for (const line of lines) {
            expect(pipeCount(line)).toBe(5);   // 4 columns now
        }
    });

    it('deleteTableRow removes the header row (the caret sits there right after insertTable) and deleteTableColumn removes a column', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(3, 3);   // header + 2 body rows

        editor.deleteTableRow();

        let lines = normalize(editor.getValue()).split('\n');

        expect(lines).toHaveLength(3);   // one fewer row: header + 1 body row
        expect(lines[1]).toContain('---');   // the promoted row still exports a delimiter

        editor.deleteTableColumn();
        lines = normalize(editor.getValue()).split('\n');

        for (const line of lines) {
            expect(pipeCount(line)).toBe(3);   // 2 columns now
        }
    });

    // A table cell holds text only: a heading, quote, code block or list
    // made in one is written into the cell as its literal syntax (`## c`).
    it('setBlockType and the list toggles leave a table cell alone', () => {
        const commands: Array<(editor: MarkdownEditor) => unknown> = [
            (editor) => editor.setBlockType('h2'),
            (editor) => editor.setBlockType('quote'),
            (editor) => editor.setBlockType('code'),
            (editor) => editor.toggleUnorderedList(),
            (editor) => editor.toggleOrderedList(),
        ];

        for (const command of commands) {
            const editor = new MarkdownEditor();

            editor.insertTable(2, 2);
            lexicalOf(editor).update(() => {
                const selection = $getSelection();

                if ($isRangeSelection(selection)) {
                    selection.insertText('c');
                }
            }, { discrete: true });

            const before = editor.getValue();

            command(editor);

            expect(editor.getValue()).toBe(before);
            expect(viewerModel(editor.getValue()).blocks).toEqual(editorSurfaceModel(editor));
        }
    });

    it('deleteTable removes the table containing the caret, including every row and cell', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        editor.deleteTable();

        const tokens = lexMarkdown(editor.getValue());

        expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
    });

    it('deleteTable no-throws when the caret is not inside a table cell', () => {
        const editor = new MarkdownEditor();

        expect(() => editor.deleteTable()).not.toThrow();
    });

    it('all six commands chain on a fresh editor with no prior selection and no table, without throwing', () => {
        const editor = new MarkdownEditor();

        expect(() =>
            editor
                .insertTable(2, 2)
                .insertTableRow()
                .deleteTableRow()
                .insertTableColumn()
                .deleteTableColumn()
                .setTableColumnAlignment('center')
        ).not.toThrow();
    });

    it('mergeTableCells() on a TableSelection spanning two cells yields << ; unmergeTableCell() removes it again', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const bodyRow = table.getChildAtIndex(1) as TableRowNode;
            const cells = bodyRow.getChildren().filter($isTableCellNode);
            const selection = $createTableSelectionFrom(table, cells[0]!, cells[1]!);

            $setSelection(selection);
        }, { discrete: true });

        editor.mergeTableCells();

        expect(editor.getValue()).toContain('<<');

        selectStart(editor);
        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const bodyRow = table.getChildAtIndex(1) as TableRowNode;
            const mergedCell = bodyRow.getChildren().filter($isTableCellNode)[0]!;

            mergedCell.selectStart();
        }, { discrete: true });

        editor.unmergeTableCell();

        expect(editor.getValue()).not.toContain('<<');
    });

    it('setTableColumnWidth(240) with the caret in the first column yields {width=240} in the first delimiter cell; setTableColumnWidth(null) removes it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(editor);

        editor.setTableColumnWidth(240);

        expect(editor.getValue()).toContain('--- {width=240}');

        editor.setTableColumnWidth(null);

        expect(editor.getValue()).not.toContain('width=240');
    });

    it('mergeTableCells / unmergeTableCell / setTableColumnWidth do not throw on a fresh editor with no table', () => {
        const editor = new MarkdownEditor();

        expect(() =>
            editor
                .mergeTableCells()
                .unmergeTableCell()
                .setTableColumnWidth(240)
        ).not.toThrow();
    });
});

describe('MarkdownEditor block alignment / columns', () => {
    it('setBlockAlignment(\'center\') with the caret in a paragraph wraps it in a fence carrying align=center', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);

        editor.setBlockAlignment('center');

        expect(normalize(editor.getValue())).toBe('::: {align=center}\nhello world\n:::');
    });

    it('setBlockAlignment(null) inside a fence carrying only align removes the fence, leaving the paragraph at the top level', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: {align=center}\nhello world\n:::');
        selectStart(editor);

        editor.setBlockAlignment(null);

        expect(normalize(editor.getValue())).toBe('hello world');
        expect(childTypes(editor)).toEqual(['paragraph']);
    });

    it('setColumnCount(2) inside a fence that already carries align=center yields one fence carrying both attributes', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: {align=center}\nhello world\n:::');
        selectStart(editor);

        editor.setColumnCount(2);

        expect(normalize(editor.getValue())).toBe('::: columns {align=center}\nhello world\n|||\n\n:::');
        expect(childTypes(editor)).toEqual(['markdown-block']);
    });

    it('setColumnCount(2) with the caret in a lone paragraph wraps it in a two-column fence', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);

        editor.setColumnCount(2);

        expect(normalize(editor.getValue())).toBe('::: columns\nhello world\n|||\n\n:::');
        expect(childTypes(editor)).toEqual(['markdown-block']);
    });

    it('setColumnCount(3) inside a two-column region appends a third column and leaves both existing columns\' text unchanged', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');
        selectStart(editor);

        editor.setColumnCount(3);

        expect(normalize(editor.getValue())).toBe('::: columns\nA\n|||\nB\n|||\n\n:::');
    });

    it('setColumnCount(2) inside a three-column region A / B / C yields two columns, the second holding B followed by C', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n|||\nC\n:::');
        selectStart(editor);

        editor.setColumnCount(2);

        expect(normalize(editor.getValue())).toBe('::: columns\nA\n|||\nB\n\nC\n:::');
    });

    it('setColumnCount(3) then setColumnCount(2) on a two-column region returns the original value exactly', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');
        const original = normalize(editor.getValue());
        selectStart(editor);

        editor.setColumnCount(3);
        editor.setColumnCount(2);

        expect(normalize(editor.getValue())).toBe(original);
    });

    it('setColumnCount(1) inside a region carrying align=center yields one column holding every block in order, fence intact', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns {align=center}\nA\n|||\nB\n:::');
        selectStart(editor);

        editor.setColumnCount(1);

        expect(normalize(editor.getValue())).toBe('::: {align=center}\nA\n\nB\n:::');
        expect(childTypes(editor)).toEqual(['markdown-block']);
    });

    it('setColumnCount(null) inside a two-column region with no alignment removes the fence, keeping the columns\' blocks in order', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');
        selectStart(editor);

        editor.setColumnCount(null);

        expect(normalize(editor.getValue())).toBe('A\n\nB');
        expect(childTypes(editor)).toEqual(['paragraph', 'paragraph']);
    });

    it('setColumnCount(2, gap) writes the gap; a following bare setColumnCount keeps it; passing null clears it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);

        editor.setColumnCount(2, '3em');
        expect(editor.getValue()).toContain('gap=3em');

        editor.setColumnCount(3);
        expect(editor.getValue()).toContain('gap=3em');

        editor.setColumnCount(3, null);
        expect(editor.getValue()).not.toContain('gap=');
    });

    it('setColumnCount(99) clamps to six columns', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);

        editor.setColumnCount(99);

        const columnCount = lexicalOf(editor).read(
            () => ($getRoot().getFirstChild() as MarkdownBlockNode).getColumns().length,
        );

        expect(columnCount).toBe(6);
    });

    it('setBlockAlignment(null) inside a two-column region keeps the fence and yields the ::: columns opener', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');
        selectStart(editor);

        editor.setBlockAlignment(null);

        expect(normalize(editor.getValue()).startsWith('::: columns')).toBe(true);
        expect(childTypes(editor)).toEqual(['markdown-block']);
    });

    it('setBlockType(\'quote\') with the caret in a column\'s paragraph converts that paragraph only', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');
        selectStart(editor);

        editor.setBlockType('quote');

        expect(childTypes(editor)).toEqual(['markdown-block']);

        const columnTypes = lexicalOf(editor).read(() => ($getRoot().getFirstChild() as MarkdownBlockNode)
            .getColumns()
            .map((column) => column.getFirstChild()!.getType()));

        expect(columnTypes).toEqual(['quote', 'paragraph']);
    });

    it('setBlockAlignment / setColumnCount do not throw on a fresh editor with no selection', () => {
        const editor = new MarkdownEditor();

        expect(() =>
            editor
                .setBlockAlignment('center')
                .setBlockAlignment(null)
                .setColumnCount(2, '2em')
                .setColumnCount(null)
        ).not.toThrow();
    });

    it('the old {columns=2} attribute keeps its fence, with no style', () => {
        // Plan markdown-editor-marked-import, I24: the importer never unwraps a fence, as the viewer renders it;
        // the attribute the editor does not model is saved as written (stack fuzz round 2).
        const editor = new MarkdownEditor();
        editor.setValue('::: {columns=2}\ntext\n:::');

        expect(childTypes(editor)).toEqual(['markdown-block']);

        const value = editor.getValue();
        expect(normalize(value)).toBe('::: {columns=2}\ntext\n:::');

        const reloaded = new MarkdownEditor();
        reloaded.setValue(value);

        expect(normalize(reloaded.getValue())).toBe(normalize(value));
    });

    it('a one-column fence carrying only a gap is not unwrapped on import: the gap survives a round-trip', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: {gap=2em}\ntext\n:::');

        expect(childTypes(editor)).toEqual(['markdown-block']);
        expect(normalize(editor.getValue())).toBe('::: {gap=2em}\ntext\n:::');
    });
});

describe('MarkdownEditor insertImage', () => {
    it('insertImage(\'/img/d.png\', { alt: \'d\', width: 320 }) on an empty editor yields exactly that Markdown', () => {
        const editor = new MarkdownEditor();

        editor.insertImage('/img/d.png', { alt: 'd', width: 320 });

        expect(normalize(editor.getValue())).toBe('![d](/img/d.png){width=320}');
    });

    it('insertImage(\'javascript:alert(1)\') leaves the value unchanged', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello');

        editor.insertImage('javascript:alert(1)');

        expect(normalize(editor.getValue())).toBe('hello');
    });

    it('does not throw on a fresh editor with no selection', () => {
        const editor = new MarkdownEditor();

        expect(() => editor.insertImage('/img/d.png')).not.toThrow();
    });
});

describe('MarkdownEditor setTableColumnAlignment', () => {
    /** The exported delimiter-row line — the second line of a normalized value. */
    function delimiterRow(editor: MarkdownEditor): string {
        return normalize(editor.getValue()).split('\n')[1];
    }

    /** Every cell's `getFormatType()`, by row, for the (single) table in `editor`'s document. */
    function cellFormats(editor: MarkdownEditor): string[][] {
        return lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;

            return table.getChildren().map((row) =>
                (row as TableRowNode).getChildren().map((cell) => (cell as TableCellNode).getFormatType()));
        });
    }

    it('sets only the caret\'s column, leaving the other column untouched', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(editor);   // caret lands in the first header cell

        editor.setTableColumnAlignment('center');

        expect(normalize(editor.getValue())).toBe('| a | b |\n| :---: | --- |\n| 1 | 2 |');
    });

    it('formats every cell of the column, header and body alike, and no cell of the other column', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(editor);

        editor.setTableColumnAlignment('center');

        const formats = cellFormats(editor);

        expect(formats.map((row) => row[0])).toEqual(['center', 'center']);
        expect(formats.map((row) => row[1])).toEqual(['', '']);
    });

    it('produces the delimiter segment matching each of the four choices', () => {
        for (const [alignment, segment] of [
            ['left', ':---'], ['center', ':---:'], ['right', '---:'], ['none', '---'],
        ] as const) {
            const editor = new MarkdownEditor();
            editor.setValue('| a |\n| --- |\n| 1 |');
            selectStart(editor);

            editor.setTableColumnAlignment(alignment);

            expect(delimiterRow(editor)).toBe(`| ${segment} |`);
        }
    });

    it('"none" clears an imported alignment back to "---", clearing the format on every cell', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a |\n| :---: |\n| 1 |');
        selectStart(editor);

        editor.setTableColumnAlignment('none');

        expect(delimiterRow(editor)).toBe('| --- |');
        expect(cellFormats(editor).map((row) => row[0])).toEqual(['', '']);
    });

    it('re-importing the exported value after aligning reproduces the same value (fixpoint)', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(editor);

        editor.setTableColumnAlignment('right');
        const exported = normalize(editor.getValue());

        expect(normalize(new MarkdownEditor(exported).getValue())).toBe(exported);
    });

    it('no-throws and changes nothing when the caret is not inside a table cell', () => {
        const noTable = new MarkdownEditor();
        expect(() => noTable.setTableColumnAlignment('center')).not.toThrow();

        const prose = new MarkdownEditor();
        prose.setValue('hello world');
        selectStart(prose);
        const before = prose.getValue();

        prose.setTableColumnAlignment('center');
        expect(prose.getValue()).toBe(before);
    });

    it('fires "change" once and sets isDirty() true when the call actually changes an alignment', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a |\n| --- |\n| 1 |');
        editor.markClean();
        selectStart(editor);

        let fired = 0;
        editor.on('change', () => { fired += 1; });

        editor.setTableColumnAlignment('center');

        expect(fired).toBe(1);
        expect(editor.isDirty()).toBe(true);
    });

    it('survives insertTableRow: the added row does not reset the column\'s exported alignment', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 2);   // caret lands in the first header cell
        editor.setTableColumnAlignment('center');

        editor.insertTableRow();

        expect(delimiterRow(editor)).toBe('| :---: | --- |');
    });

    it('a column added by insertTableColumn starts unaligned, leaving the existing column\'s marker untouched', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a |\n| :---: |\n| 1 |');
        selectStart(editor);

        editor.insertTableColumn();

        expect(delimiterRow(editor)).toBe('| :---: | --- |');
    });
});

describe('$classifyContextMenuTarget', () => {
    it('classifies a text node inside ordinary prose as "text" with every format false', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({
            kind: 'text', hasSelectedText: false, bold: false, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: false, linkUrl: null,
        });
    });

    it('reflects the current selection\'s bold state', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
        editor.toggleBold();

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({
            kind: 'text', hasSelectedText: true, bold: true, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: false, linkUrl: null,
        });
    });

    it('reports underline: true for a caret inside an underlined run', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
        editor.toggleUnderline();

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect((result as { underline: boolean }).underline).toBe(true);
    });

    it('classifies a node inside a heading as "text" with hasEnclosingBlock false', () => {
        const editor = new MarkdownEditor();
        editor.setValue('# Heading');

        const result = lexicalOf(editor).read(() => {
            const heading = $getRoot().getFirstChild() as ElementNode;
            const textNode = heading.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(false);
    });

    it('classifies a node inside a blockquote as "text" with hasEnclosingBlock true', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> a quoted line');

        const result = lexicalOf(editor).read(() => {
            const quote = $getRoot().getFirstChild() as ElementNode;
            const textNode = quote.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
    });

    it('classifies a node inside a fenced code block as "text" with hasEnclosingBlock true', () => {
        const editor = new MarkdownEditor();
        editor.setValue('```\ncode\n```');

        const result = lexicalOf(editor).read(() => {
            const code = $getRoot().getFirstChild() as ElementNode;
            const textNode = code.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
    });

    it('classifies a node inside any item of a list as "text" with hasEnclosingBlock true, regardless of which item', () => {
        const editor = new MarkdownEditor();
        editor.setValue('- one\n- two\n- three');

        const resultForEachItem = lexicalOf(editor).read(() => {
            const list = $getRoot().getFirstChild() as ElementNode;

            return list.getChildren().map((item) => {
                const textNode = (item as ElementNode).getFirstChild() as LexicalNode;

                return $classifyContextMenuTarget(textNode);
            });
        });

        for (const result of resultForEachItem) {
            expect(result.kind).toBe('text');
            expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
        }
    });

    it('classifies a node inside a nested list\'s inner item as "text" with hasEnclosingBlock true, resolving to the inner list', () => {
        const editor = new MarkdownEditor();
        editor.setValue('- outer\n    - inner one\n    - inner two');

        const result = lexicalOf(editor).read(() => {
            const outerList = $getRoot().getFirstChild() as ElementNode;
            const outerSecondItem = outerList.getChildAtIndex(1) as ElementNode;
            const innerList = outerSecondItem.getFirstChild() as ElementNode;
            const innerFirstItem = innerList.getFirstChild() as ElementNode;
            const textNode = innerFirstItem.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
    });

    it('classifies the paragraph node of a genuinely empty paragraph as "empty-line"', () => {
        const editor = new MarkdownEditor();

        (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();
        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(paragraph);
        });

        expect(result).toEqual({ kind: 'empty-line', hasSelectedText: false });
    });

    it('classifies a node inside a populated table cell as "table-cell", carrying the format state', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

        const result = lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getFirstChild() as TableCellNode;
            const textNode = (cell.getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({
            kind: 'table-cell', hasSelectedText: false, bold: false, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: true, linkUrl: null, columnAlignment: 'none',
        });
    });

    it('classifies a node inside an empty table cell as "table-cell", not "empty-line" (table check wins)', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first (empty) header cell

        const result = lexicalOf(editor).read(() => {
            const selection = $getSelection();
            const node = $isRangeSelection(selection) ? selection.anchor.getNode() : null;

            return $classifyContextMenuTarget(node as LexicalNode);
        });

        expect(result).toEqual({
            kind: 'table-cell', hasSelectedText: false, bold: false, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: true, linkUrl: null, columnAlignment: 'none',
        });
    });

    it('reflects the current selection\'s bold state inside a table cell too', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
        editor.toggleBold();

        const result = lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getFirstChild() as TableCellNode;
            const textNode = (cell.getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({
            kind: 'table-cell', hasSelectedText: true, bold: true, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: true, linkUrl: null, columnAlignment: 'none',
        });
    });

    it('reports the clicked column\'s alignment, mapping each GFM delimiter marker to its MarkdownTableAlignment', () => {
        for (const [markdown, expected] of [
            ['| a |\n| :--- |\n| 1 |',  'left'],
            ['| a |\n| :---: |\n| 1 |', 'center'],
            ['| a |\n| ---: |\n| 1 |',  'right'],
            ['| a |\n| --- |\n| 1 |',   'none'],
        ] as const) {
            const editor = new MarkdownEditor();
            editor.setValue(markdown);
            lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

            const result = lexicalOf(editor).read(() => {
                const table = $getRoot().getFirstChild() as TableNode;
                const row = table.getFirstChild() as TableRowNode;
                const cell = row.getFirstChild() as TableCellNode;
                const textNode = (cell.getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

                return $classifyContextMenuTarget(textNode);
            });

            expect((result as { columnAlignment?: string }).columnAlignment).toBe(expected);
        }
    });

    it('classifies a node inside a link as "text" with linkUrl set to the link\'s URL', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [link](https://example.com) in prose.');

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { linkUrl?: string | null }).linkUrl).toBe('https://example.com');
    });

    it('classifies a node inside a link within a table cell as "table-cell" with linkUrl set to the link\'s URL', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| [link](https://example.com) | b |\n| --- | --- |\n| 1 | 2 |');

        const result = lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getFirstChild() as TableCellNode;
            const paragraph = cell.getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('table-cell');
        expect((result as { linkUrl?: string | null }).linkUrl).toBe('https://example.com');
    });
});

describe('MarkdownEditor.getSelectionState() / "selectionstate"', () => {
    const NEUTRAL: MarkdownEditorSelectionState = {
        bold: false, italic: false, strikethrough: false, code: false, underline: false,
        hasSelectedText: false, linkUrl: null,
        inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
    };

    it('a fresh, never-built editor returns the neutral default', () => {
        const editor = new MarkdownEditor();

        expect(editor.getSelectionState()).toEqual(NEUTRAL);
    });

    it('reports bold: true with the selection inside a bold run, and true again for a caret collapsed at its very start', () => {
        const editor = new MarkdownEditor();
        editor.setValue('**bold** word');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const boldText = paragraph.getFirstChild();

            if ($isTextNode(boldText)) {
                boldText.select(2, 2);   // collapsed, inside the bold run
            }
        }, { discrete: true });

        // hasSelectedText is true here (not the NEUTRAL default): a collapsed
        // caret anywhere inside a formatted run always yields a non-null
        // $computeWordExpansion, per that function's own format !== 0 branch.
        const insideRun = editor.getSelectionState();
        expect(insideRun).toEqual({ ...NEUTRAL, bold: true, hasSelectedText: true });

        selectStart(editor);   // collapsed at the very start of the bold run
        expect(editor.getSelectionState()).toEqual({ ...NEUTRAL, bold: true, hasSelectedText: true });
    });

    it('hasSelectedText is true for a collapsed caret mid-word, false with no word to expand into', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);   // collapsed, inside "hello"
            }
        }, { discrete: true });

        expect(editor.getSelectionState().hasSelectedText).toBe(true);

        // Two spaces: a collapsed caret between them has no adjacent word
        // character in either direction, mirroring
        // $selectEnclosingWordIfCollapsed's own "no-op" precedent above.
        const spaced = new MarkdownEditor();
        spaced.setValue('a  b');

        lexicalOf(spaced).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        expect(spaced.getSelectionState().hasSelectedText).toBe(false);
    });

    it('linkUrl reports the enclosing link\'s URL, null outside one', () => {
        const editor = new MarkdownEditor();
        editor.setValue('A [text](https://old) link.');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        expect(editor.getSelectionState().linkUrl).toBe('https://old');

        const plain = new MarkdownEditor();
        plain.setValue('plain text');
        selectStart(plain);

        expect(plain.getSelectionState().linkUrl).toBeNull();
    });

    it('"selectionstate" fires when only linkUrl changes, e.g. moving from plain text into a link', () => {
        const editor = new MarkdownEditor();
        editor.setValue('aaa [bbb](https://old) ccc');
        selectStart(editor);   // collapsed at the start of "aaa", outside the link

        const listener = vi.fn();
        editor.on('selectionstate', listener);

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(1, 1);   // collapsed, mid "bbb"
            }
        }, { discrete: true });

        expect(listener).toHaveBeenCalledTimes(1);

        const state = listener.mock.calls[0][0];
        expect(state.linkUrl).toBe('https://old');
        expect(state.hasSelectedText).toBe(true);
    });

    it('blockAlignment reflects an enclosing :::-fence alignment, columnCount stays 1 outside a columns region', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: {align=center}\ntext\n:::');
        selectStart(editor);

        const state = editor.getSelectionState();
        expect(state.blockAlignment).toBe('center');
        expect(state.columnCount).toBe(1);
    });

    it('columnCount reflects the enclosing column region\'s column count from either column, blockAlignment null with no alignment', () => {
        const editor = new MarkdownEditor();
        editor.setValue('::: columns\nA\n|||\nB\n:::');

        lexicalOf(editor).update(() => {
            (($getRoot().getFirstChild() as MarkdownBlockNode).getColumns()[0]!).selectStart();
        }, { discrete: true });

        let state = editor.getSelectionState();
        expect(state.columnCount).toBe(2);
        expect(state.blockAlignment).toBeNull();

        lexicalOf(editor).update(() => {
            (($getRoot().getFirstChild() as MarkdownBlockNode).getColumns()[1]!).selectStart();
        }, { discrete: true });

        state = editor.getSelectionState();
        expect(state.columnCount).toBe(2);
    });

    it('inTable / tableColumnAlignment reflect the caret\'s own column: center for :---:, none for a plain --- column', () => {
        const centerEditor = new MarkdownEditor();
        centerEditor.setValue('| a | b |\n| :---: | --- |\n| 1 | 2 |');
        selectStart(centerEditor);   // first header cell -> the :---: column

        const centerState = centerEditor.getSelectionState();
        expect(centerState.inTable).toBe(true);
        expect(centerState.tableColumnAlignment).toBe('center');

        const noneEditor = new MarkdownEditor();
        noneEditor.setValue('| a | b |\n| :---: | --- |\n| 1 | 2 |');
        lexicalOf(noneEditor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getChildAtIndex(1) as TableCellNode;

            cell.selectStart();
        }, { discrete: true });

        const noneState = noneEditor.getSelectionState();
        expect(noneState.inTable).toBe(true);
        expect(noneState.tableColumnAlignment).toBe('none');
    });

    it('inTable is false and tableColumnAlignment null with the caret outside any table', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);

        const state = editor.getSelectionState();
        expect(state.inTable).toBe(false);
        expect(state.tableColumnAlignment).toBeNull();
    });

    it('reports every field at its default for a multi-cell TableSelection, which carries no RangeSelection anchor', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getChildAtIndex(1) as TableRowNode;
            const cellA = row.getChildAtIndex(0) as TableCellNode;
            const cellB = row.getChildAtIndex(1) as TableCellNode;

            $setSelection($createTableSelectionFrom(table, cellA, cellB));
        }, { discrete: true });

        expect(editor.getSelectionState()).toEqual(NEUTRAL);
    });

    it('does not fire for the editor\'s initial load', () => {
        const editor = new MarkdownEditor('**bold** word');
        const listener = vi.fn();

        editor.on('selectionstate', listener);
        // The initial markdown->state conversion inside ensureEditor() runs
        // before the update-listener registration that follows it, so the
        // very first commit is never observed by a listener wired beforehand.
        (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

        expect(listener).not.toHaveBeenCalled();
    });

    it('fires once when the caret enters a bold run, then not again for a further move that changes no tracked field', () => {
        const editor = new MarkdownEditor();
        editor.setValue('**bold** more text');
        const listener = vi.fn();
        editor.on('selectionstate', listener);

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const boldText = paragraph.getFirstChild();

            if ($isTextNode(boldText)) {
                boldText.select(2, 2);
            }
        }, { discrete: true });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].bold).toBe(true);

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const boldText = paragraph.getFirstChild();

            if ($isTextNode(boldText)) {
                boldText.select(3, 3);   // still inside the same bold run
            }
        }, { discrete: true });

        expect(listener).toHaveBeenCalledTimes(1);   // no additional emit
    });

    it('off("selectionstate", fn) stops delivery', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        const listener = vi.fn();

        editor.on('selectionstate', listener);
        editor.off('selectionstate', listener);

        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });
        editor.toggleBold();

        expect(listener).not.toHaveBeenCalled();
    });

    it('a format toggle that does not move the selection still triggers a "selectionstate" emit', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const listener = vi.fn();
        editor.on('selectionstate', listener);

        // toggleBold() dispatches FORMAT_TEXT_COMMAND, whose update is not
        // `{ discrete: true }` and so — unlike setValue()'s discrete commits,
        // which every other test in this suite exercises synchronously —
        // settles on the next microtask in this headless harness rather than
        // before this call returns (see this file's own updateSelectionState
        // registration: it runs from the same registerUpdateListener callback
        // handleChange() already relies on, which has the identical deferral).
        editor.toggleBold();
        await Promise.resolve();

        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[listener.mock.calls.length - 1][0].bold).toBe(true);
    });
});

describe('MarkdownEditor Alt+Enter block-separator shortcut', () => {
    /** Selects into the end of the first cell of the document's first (only) table. */
    function selectInFirstTableCell(editor: MarkdownEditor): void {
        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getFirstChild() as TableCellNode;

            cell.selectEnd();
        }, { discrete: true });
    }

    /** Dispatches `KEY_ENTER_COMMAND` with a synthetic event, `altKey` as given. */
    function dispatchEnter(editor: MarkdownEditor, altKey: boolean): boolean {
        return lexicalOf(editor).dispatchCommand(
            KEY_ENTER_COMMAND, { altKey, shiftKey: false, preventDefault: () => {} } as KeyboardEvent);
    }

    it('with the caret in a table cell, inserts a paragraph after the table and moves the caret into it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        expect(childTypes(editor)).toEqual(['table']);   // sanity: no auto separator on import
        selectInFirstTableCell(editor);

        const handled = dispatchEnter(editor, true);

        expect(handled).toBe(true);
        expect(childTypes(editor)).toEqual(['table', 'paragraph']);
        expect(caretIsInAParagraph(editor)).toBe(true);
    });

    it('with the caret in a fenced code block, inserts a paragraph after it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('```\ncode\n```');
        expect(childTypes(editor)).toEqual(['code']);   // sanity: no auto separator on import
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });   // lands in the code block, its only child

        const handled = dispatchEnter(editor, true);

        expect(handled).toBe(true);
        expect(childTypes(editor)).toEqual(['code', 'paragraph']);
        expect(caretIsInAParagraph(editor)).toBe(true);
    });

    it('inserts a separator between a table and an immediately following code block, from the caret in the table', () => {
        // A blank line in the source Markdown between two block constructs is
        // only separator syntax, not a real paragraph, so the table imports
        // directly bordering the code block with nowhere to click between them.
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```');
        expect(childTypes(editor)).toEqual(['table', 'code']);   // no separator on import

        selectInFirstTableCell(editor);
        dispatchEnter(editor, true);

        expect(childTypes(editor)).toEqual(['table', 'paragraph', 'code']);
    });

    it('inserts a separator between a table and an immediately following code block, from the caret in the code block', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```\ncode\n```');
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });   // code is the last child

        dispatchEnter(editor, true);

        expect(childTypes(editor)).toEqual(['table', 'code', 'paragraph']);
    });

    it('a plain Enter (no Alt) in a table cell splits the cell\'s own paragraph, not the table\'s root sibling', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectInFirstTableCell(editor);

        dispatchEnter(editor, false);

        expect(childTypes(editor)).toEqual(['table']);   // no root-level paragraph added
    });

    it('outside a table or code block, falls through to a normal paragraph split', () => {
        const editor = new MarkdownEditor();
        editor.setValue('Some prose.');
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });

        const handled = dispatchEnter(editor, true);

        // $findEnclosingSeparatorTarget finds nothing, so the handler returns
        // false and registerRichText's own (lower-priority) handler runs
        // instead — the same plain paragraph split a non-Alt Enter would do.
        expect(handled).toBe(true);
        expect(childTypes(editor)).toEqual(['paragraph', 'paragraph']);
    });

    it('with the caret inside a blockquote, still returns handled via Lexical\'s own native paragraph-insertion (the shortcut was not widened)', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> quoted');
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });

        // $findEnclosingSeparatorTarget only ever resolves a table or code
        // block, so this handler returns false here regardless of altKey;
        // QuoteNode's own native Enter handling (registerRichText) is what
        // inserts the paragraph.
        const handled = dispatchEnter(editor, true);

        expect(handled).toBe(true);
        expect(childTypes(editor)).toEqual(['quote', 'paragraph']);
    });

    it('with the caret inside a list item, still returns handled via Lexical\'s own native list handling (the shortcut was not widened)', () => {
        const editor = new MarkdownEditor();
        editor.setValue('- one\n- two');
        lexicalOf(editor).update(() => { $getRoot().selectEnd(); }, { discrete: true });

        const handled = dispatchEnter(editor, true);

        expect(handled).toBe(true);
        expect(childTypes(editor)).toEqual(['list']);   // handled inside the list, no root-level paragraph
    });
});

describe('MarkdownEditor insertParagraphBeforeBlock / insertParagraphAfterBlock', () => {
    it('insertParagraphAfterBlock() with the caret inside a blockquote inserts a paragraph immediately after it, caret inside', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> quoted');
        lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });   // caret inside the quote

        editor.insertParagraphAfterBlock();

        expect(childTypes(editor)).toEqual(['quote', 'paragraph']);
        expect(caretIsInAParagraph(editor)).toBe(true);
    });

    it('insertParagraphBeforeBlock() with the caret inside a blockquote inserts a paragraph immediately before it, caret inside', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> quoted');
        lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });

        editor.insertParagraphBeforeBlock();

        expect(childTypes(editor)).toEqual(['paragraph', 'quote']);
        expect(caretIsInAParagraph(editor)).toBe(true);
    });

    it('both methods work the same way for a fenced code block', () => {
        const after = new MarkdownEditor();
        after.setValue('```\ncode\n```');
        lexicalOf(after).update(() => { $getRoot().selectEnd(); }, { discrete: true });   // lands in the code block, its only child
        after.insertParagraphAfterBlock();
        expect(childTypes(after)).toEqual(['code', 'paragraph']);

        const before = new MarkdownEditor();
        before.setValue('```\ncode\n```');
        lexicalOf(before).update(() => { $getRoot().selectEnd(); }, { discrete: true });
        before.insertParagraphBeforeBlock();
        expect(childTypes(before)).toEqual(['paragraph', 'code']);
    });

    it('both methods insert next to the whole list, never splitting it, regardless of which item the caret was in', () => {
        /** Selects into the end of the `index`-th item of the document's first (top-level) list. */
        function selectInListItem(editor: MarkdownEditor, index: number): void {
            lexicalOf(editor).update(() => {
                const list = $getRoot().getFirstChild() as ElementNode;
                const item = list.getChildAtIndex(index) as ElementNode;

                item.selectEnd();
            }, { discrete: true });
        }

        const fromFirstItem = new MarkdownEditor();
        fromFirstItem.setValue('- one\n- two\n- three');
        selectInListItem(fromFirstItem, 0);
        fromFirstItem.insertParagraphAfterBlock();
        expect(childTypes(fromFirstItem)).toEqual(['list', 'paragraph']);

        const fromLastItem = new MarkdownEditor();
        fromLastItem.setValue('- one\n- two\n- three');
        selectInListItem(fromLastItem, 2);
        fromLastItem.insertParagraphAfterBlock();
        expect(childTypes(fromLastItem)).toEqual(['list', 'paragraph']);

        const before = new MarkdownEditor();
        before.setValue('- one\n- two\n- three');
        selectInListItem(before, 1);
        before.insertParagraphBeforeBlock();
        expect(childTypes(before)).toEqual(['paragraph', 'list']);
    });

    it('for a nested list, insertParagraphAfterBlock() inserts the paragraph as a sibling of the inner list, inside the outer item', () => {
        const editor = new MarkdownEditor();
        editor.setValue('- outer\n    - inner one\n    - inner two');

        lexicalOf(editor).update(() => {
            const outerList = $getRoot().getFirstChild() as ElementNode;
            const outerSecondItem = outerList.getChildAtIndex(1) as ElementNode;
            const innerList = outerSecondItem.getFirstChild() as ElementNode;
            const innerFirstItem = innerList.getFirstChild() as ElementNode;

            innerFirstItem.selectEnd();
        }, { discrete: true });

        editor.insertParagraphAfterBlock();

        // Root-level structure is untouched — the new paragraph landed inside
        // the outer item, beside the inner list, not after the outer list.
        expect(childTypes(editor)).toEqual(['list']);

        const outerSecondItemChildTypes = lexicalOf(editor).read(() => {
            const outerList = $getRoot().getFirstChild() as ElementNode;
            const outerSecondItem = outerList.getChildAtIndex(1) as ElementNode;

            return outerSecondItem.getChildren().map((node) => node.getType());
        });

        expect(outerSecondItemChildTypes).toEqual(['list', 'paragraph']);
    });

    it('both methods insert next to the whole table, never inside it, regardless of which cell the caret was in', () => {
        /** Selects into the end of the cell at (`rowIndex`, `colIndex`) of the document's first (only) table. */
        function selectInTableCell(editor: MarkdownEditor, rowIndex: number, colIndex: number): void {
            lexicalOf(editor).update(() => {
                const table = $getRoot().getFirstChild() as TableNode;
                const row = table.getChildAtIndex(rowIndex) as TableRowNode;
                const cell = row.getChildAtIndex(colIndex) as TableCellNode;

                cell.selectEnd();
            }, { discrete: true });
        }

        const fromFirstCell = new MarkdownEditor();
        fromFirstCell.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectInTableCell(fromFirstCell, 0, 0);
        fromFirstCell.insertParagraphAfterBlock();
        expect(childTypes(fromFirstCell)).toEqual(['table', 'paragraph']);

        const fromLastCell = new MarkdownEditor();
        fromLastCell.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectInTableCell(fromLastCell, 1, 1);
        fromLastCell.insertParagraphAfterBlock();
        expect(childTypes(fromLastCell)).toEqual(['table', 'paragraph']);

        const before = new MarkdownEditor();
        before.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectInTableCell(before, 0, 1);
        before.insertParagraphBeforeBlock();
        expect(childTypes(before)).toEqual(['paragraph', 'table']);
    });

    it('both methods no-op without throwing when the caret is in a plain paragraph or a heading', () => {
        const inParagraph = new MarkdownEditor();
        inParagraph.setValue('plain prose');
        selectStart(inParagraph);
        expect(() => inParagraph.insertParagraphBeforeBlock().insertParagraphAfterBlock()).not.toThrow();
        expect(childTypes(inParagraph)).toEqual(['paragraph']);

        const inHeading = new MarkdownEditor();
        inHeading.setValue('# Heading');
        selectStart(inHeading);
        expect(() => inHeading.insertParagraphBeforeBlock().insertParagraphAfterBlock()).not.toThrow();
        expect(childTypes(inHeading)).toEqual(['heading']);
    });

    it('invoking insertParagraphAfterBlock() twice against the same still-present block (as two separate right-clicks) inserts two adjacent empty paragraphs', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> quoted');
        lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
        editor.insertParagraphAfterBlock();

        // A second right-click resolving back inside the still-present quote,
        // rather than continuing from wherever the first call left the caret.
        lexicalOf(editor).update(() => { ($getRoot().getFirstChild() as ElementNode).selectStart(); }, { discrete: true });
        editor.insertParagraphAfterBlock();

        expect(childTypes(editor)).toEqual(['quote', 'paragraph', 'paragraph']);
    });

    it('round-trips a blockquote plus content typed into the paragraph inserted after it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('> quoted');
        lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
        editor.insertParagraphAfterBlock();

        // A still-empty paragraph has no Markdown representation at all (the
        // same is true of the pre-existing Alt+Enter separator's inserted
        // paragraph) and so cannot itself survive export/re-import; what the
        // round-trip actually needs to preserve is content the user goes on
        // to type into it.
        lexicalOf(editor).update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                selection.insertText('new line');
            }
        }, { discrete: true });

        const second = new MarkdownEditor();
        second.setValue(editor.getValue());

        expect(childTypes(second)).toEqual(childTypes(editor));
        expect(second.getValue()).toContain('new line');
    });
});

describe('MarkdownEditor context menu', () => {
    /** A representative fully-mixed format state: some formats on, some off. */
    const SOME_FORMATS: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean; underline: boolean } =
        { bold: true, italic: false, strikethrough: true, code: false, underline: false };

    /** Finds the config for the item with the given `text`, in a possibly-nested submenu list. */
    function findItem(items: MenuItemConfig[], text: string): MenuItemConfig | undefined {
        return items.find((item) => item.text === text);
    }

    /** Resolves a `MenuConfig`'s `items`, which may be a fixed array or a zero-argument provider. */
    function submenuItemsOf(item: MenuItemConfig | undefined): MenuItemConfig[] | undefined {
        const items = item?.submenu?.items;

        return typeof items === 'function' ? items() : items;
    }

    /** Builds the `CheckboxMenuRow` a `row`-based `MenuItemConfig` renders. */
    function rowOf(item: MenuItemConfig | undefined): CheckboxMenuRow {
        return item?.row?.() as CheckboxMenuRow;
    }

    it('a "text" context builds a real checkbox row per format, reflecting each active state', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
        });

        // Order: Cut, Copy, Paste, separator, then buildFormatToggleItems's
        // Bold, Italic, Underline, Strikethrough, Code.
        expect(rowOf(items[4]).isChecked()).toBe(true);
        expect(rowOf(items[5]).isChecked()).toBe(false);
        expect(rowOf(items[6]).isChecked()).toBe(false);
        expect(rowOf(items[7]).isChecked()).toBe(true);
        expect(rowOf(items[8]).isChecked()).toBe(false);
    });

    it('a "text" context with linkUrl: null builds 19 entries: Cut/Copy/Paste, the format rows, Insert link, Block style, Text style, Alignment, Columns, and Clear formatting', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
        });

        expect(items).toHaveLength(19);
        expect(items.slice(0, 4).map((item) => item.text ?? '(separator)')).toEqual([
            'Cut', 'Copy', 'Paste', '(separator)',
        ]);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Insert link…', '(separator)', 'Block style', '(separator)', 'Text style', 'Alignment', 'Columns', '(separator)', 'Clear formatting',
        ]);
    });

    it('a "text" context with a linkUrl builds 20 entries: the same shape but Edit link + Remove link instead of Insert link', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS,
        });

        expect(items).toHaveLength(20);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Block style', '(separator)', 'Text style', 'Alignment', 'Columns', '(separator)', 'Clear formatting',
        ]);
    });

    it('a "text" context with hasEnclosingBlock builds 22 entries: the 19 (linkUrl: null) existing plus a separator and the two new items', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true,
        });

        expect(items).toHaveLength(22);
        expect(items.slice(19).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Insert line before block', 'Insert line after block',
        ]);
    });

    it('"Insert link…" is enabled exactly when hasSelectedText is true, in both "text" and "table-cell" contexts', () => {
        const editor = new MarkdownEditor();

        for (const kind of ['text', 'table-cell'] as const) {
            const enabled = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind, hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
            });
            const disabled = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind, hasSelectedText: false, linkUrl: null, ...SOME_FORMATS,
            });

            expect(findItem(enabled, 'Insert link…')?.enabled).toBe(true);
            expect(findItem(enabled, 'Edit link…')).toBeUndefined();
            expect(findItem(enabled, 'Remove link')).toBeUndefined();

            expect(findItem(disabled, 'Insert link…')?.enabled).toBe(false);
        }
    });

    it('"Edit link…" and "Remove link" are always enabled and replace "Insert link…", in both "text" and "table-cell" contexts', () => {
        const editor = new MarkdownEditor();

        for (const kind of ['text', 'table-cell'] as const) {
            for (const hasSelectedText of [true, false]) {
                const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                    kind, hasSelectedText, linkUrl: 'https://x', ...SOME_FORMATS,
                });

                expect(findItem(items, 'Edit link…')?.enabled).toBeUndefined();
                expect(findItem(items, 'Remove link')?.enabled).toBeUndefined();
                expect(findItem(items, 'Insert link…')).toBeUndefined();
            }
        }
    });

    describe('link menu items\' wiring', () => {
        afterEach(() => vi.restoreAllMocks());

        it('the "Insert link…" item\'s action() calls promptAndApplyLink("Insert link", "")', () => {
            const editor = new MarkdownEditor();
            const spy = vi.spyOn(contextMenuMethodsOf(editor), 'promptAndApplyLink').mockResolvedValue(undefined);

            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
            });

            findItem(items, 'Insert link…')?.action?.();

            expect(spy).toHaveBeenCalledWith('Insert link', '');
        });

        it('the "Edit link…" item\'s action() forwards the clicked link\'s URL as the prompt default', () => {
            const editor = new MarkdownEditor();
            const spy = vi.spyOn(contextMenuMethodsOf(editor), 'promptAndApplyLink').mockResolvedValue(undefined);

            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: false, linkUrl: 'https://x', ...SOME_FORMATS,
            });

            findItem(items, 'Edit link…')?.action?.();

            expect(spy).toHaveBeenCalledWith('Edit link', 'https://x');
        });

        it('the "Remove link" item\'s action() reaches removeLink() specifically, not bare toggleLink(null)', () => {
            // A partial-selection setup (only "hello" of "hello world"
            // selected) is what distinguishes removeLink() from bare
            // toggleLink(null) — see Architecture Decisions: toggleLink(null)
            // on a non-collapsed selection only unwraps the selected portion
            // via $splitLinkAtSelection, while removeLink() always collapses
            // into the link first and unwraps the whole thing. A collapsed
            // selection would not tell the two apart, since Lexical's own
            // collapsed-selection branch already unwraps the whole link.
            const editor = new MarkdownEditor();
            editor.setValue('[hello world](https://x)');

            lexicalOf(editor).update(() => {
                const paragraph = $getRoot().getFirstChild() as ElementNode;
                const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
                const textNode = linkNode.getFirstChild();

                if ($isTextNode(textNode)) {
                    textNode.select(0, 'hello'.length);   // only "hello" selected
                }
            }, { discrete: true });

            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: 'https://x', ...SOME_FORMATS,
            });

            findItem(items, 'Remove link')?.action?.();

            expect(normalize(editor.getValue())).toBe('hello world');
        });
    });

    it('the "Insert line before/after block" items reach insertParagraphBeforeBlock/insertParagraphAfterBlock', () => {
        const before = new MarkdownEditor();
        before.setValue('> quoted');
        lexicalOf(before).update(() => { $getRoot().selectStart(); }, { discrete: true });

        contextMenuMethodsOf(before).buildContextMenuItems({
            kind: 'text', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true,
        }).find((item) => item.text === 'Insert line before block')?.action?.();

        expect(lexicalOf(before).read(() => $getRoot().getChildren().map((n) => n.getType())))
            .toEqual(['paragraph', 'quote']);

        const after = new MarkdownEditor();
        after.setValue('> quoted');
        lexicalOf(after).update(() => { $getRoot().selectStart(); }, { discrete: true });

        contextMenuMethodsOf(after).buildContextMenuItems({
            kind: 'text', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true,
        }).find((item) => item.text === 'Insert line after block')?.action?.();

        expect(lexicalOf(after).read(() => $getRoot().getChildren().map((n) => n.getType())))
            .toEqual(['quote', 'paragraph']);
    });

    it('a "text" context offers an 11-item block-style submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
        });

        const blockStyleItems = submenuItemsOf(findItem(items, 'Block style'));

        // Paragraph, separator, 6 headings, separator, Quote, Code block.
        expect(blockStyleItems).toHaveLength(11);
        expect(blockStyleItems?.map((item) => item.text ?? '(separator)')).toEqual([
            'Paragraph', '(separator)',
            'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
            '(separator)', 'Quote', 'Code block',
        ]);
    });

    it('the block-style submenu\'s Quote and Code block items reach setBlockType', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
        });
        const blockStyleItems = submenuItemsOf(findItem(items, 'Block style'));

        blockStyleItems?.find((item) => item.text === 'Quote')?.action?.();

        expect(lexMarkdown(editor.getValue()).some((token) => token.type === 'blockquote')).toBe(true);
    });

    it('the "Text style" submenu\'s Colour ▸ Red item reaches setTextColor, and Colour ▸ Default clears it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        selectStart(editor);

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
        });
        const colorItems = submenuItemsOf(findItem(submenuItemsOf(findItem(items, 'Text style')) ?? [], 'Colour'));

        colorItems?.find((item) => item.text === 'Red')?.action?.();
        expect(editor.getValue()).toContain('[word]{color=#cc0000}');

        colorItems?.find((item) => item.text === 'Default')?.action?.();
        expect(normalize(editor.getValue())).toBe('word');
    });

    it('a "text" context\'s Bold checkbox row reaches MarkdownEditor.toggleBold on activation', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, bold: false, italic: false, strikethrough: false, code: false,
            underline: false,
        });

        rowOf(items[4]).activate();

        expect(editor.getValue()).toContain('**word**');
    });

    it('an "empty-line" context omits Paragraph and offers a 6-item Heading submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

        expect(findItem(items, 'Paragraph')).toBeUndefined();
        expect(submenuItemsOf(findItem(items, 'Heading'))).toHaveLength(6);
    });

    it('an "empty-line" context builds 7 entries: Cut/Copy/Paste, then Heading, Insert, and Columns', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

        expect(items).toHaveLength(7);
        expect(items.map((item) => item.text ?? '(separator)')).toEqual([
            'Cut', 'Copy', 'Paste', '(separator)',
            'Heading', 'Insert', 'Columns',
        ]);
    });

    it('an "empty-line" context\'s Insert submenu offers Quote, Code block, Bulleted list, Numbered list, Table, and Image…, in that order', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

        expect(submenuItemsOf(findItem(items, 'Insert'))?.map((item) => item.text ?? '(separator)')).toEqual([
            'Quote', 'Code block', 'Bulleted list', 'Numbered list', '(separator)', 'Table', 'Image…',
        ]);
    });

    it('a "table-cell" context with linkUrl: null returns 17 entries: Cut/Copy/Paste, 5 format rows, Insert link, Text style, Clear formatting, then a Table submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
        });

        expect(items).toHaveLength(17);
        expect(items.slice(0, 4).map((item) => item.text ?? '(separator)')).toEqual([
            'Cut', 'Copy', 'Paste', '(separator)',
        ]);
        expect(rowOf(items[4]).isChecked()).toBe(true);    // Bold
        expect(rowOf(items[5]).isChecked()).toBe(false);   // Italic
        expect(rowOf(items[6]).isChecked()).toBe(false);   // Underline
        expect(rowOf(items[7]).isChecked()).toBe(true);    // Strikethrough
        expect(rowOf(items[8]).isChecked()).toBe(false);   // Code
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Insert link…', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)', 'Table',
        ]);

        const tableItems = submenuItemsOf(findItem(items, 'Table'));
        expect(tableItems?.map((item) => item.text ?? '(separator)')).toEqual([
            'Insert', 'Delete', '(separator)', 'Merge cells', 'Unmerge cell', 'Column width…', 'Align column',
        ]);
        expect(submenuItemsOf(findItem(tableItems ?? [], 'Insert'))?.map((item) => item.text)).toEqual([
            'Row above', 'Row below', 'Column left', 'Column right',
        ]);
        expect(submenuItemsOf(findItem(tableItems ?? [], 'Delete'))?.map((item) => item.text)).toEqual([
            'Row', 'Column', 'Table',
        ]);
    });

    it('a "table-cell" context with hasEnclosingBlock builds 20 entries: the 17 existing (with no link) plus a separator and the two new items', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true,
        });

        expect(items).toHaveLength(20);
        expect(items.slice(17).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Insert line before block', 'Insert line after block',
        ]);
    });

    it('the table-cell menu\'s "Insert line before/after block" items reach insertParagraphBeforeBlock/insertParagraphAfterBlock, targeting the whole table', () => {
        const before = new MarkdownEditor();
        before.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(before);   // caret lands in the first cell

        contextMenuMethodsOf(before).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true,
        }).find((item) => item.text === 'Insert line before block')?.action?.();

        expect(childTypes(before)).toEqual(['paragraph', 'table']);

        const after = new MarkdownEditor();
        after.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(after);

        contextMenuMethodsOf(after).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true,
        }).find((item) => item.text === 'Insert line after block')?.action?.();

        expect(childTypes(after)).toEqual(['table', 'paragraph']);
    });

    it('a "table-cell" context with a linkUrl returns 18 entries: the same shape but Edit link + Remove link instead of Insert link', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS,
        });

        expect(items).toHaveLength(18);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)', 'Table',
        ]);
    });

    it('a "table-cell" context with both a linkUrl and hasEnclosingBlock combines all groups: link items, Text style, Clear formatting, the Table submenu, and the two block items, in that order', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS, hasEnclosingBlock: true,
        });

        expect(items).toHaveLength(21);
        expect(items.slice(0, 4).map((item) => item.text ?? '(separator)')).toEqual([
            'Cut', 'Copy', 'Paste', '(separator)',
        ]);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)',
            'Table', '(separator)', 'Insert line before block', 'Insert line after block',
        ]);
    });

    it("the table-cell menu's Table ▸ Delete ▸ Table item reaches MarkdownEditor.deleteTable", () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        submenuItemsOf(findItem(tableItems ?? [], 'Delete'))?.find((item) => item.text === 'Table')?.action?.();

        const tokens = lexMarkdown(editor.getValue());
        expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
    });

    it("the table-cell menu's Table ▸ Align column submenu offers exactly Left, Center, Right, None, in that order", () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        expect(submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.map((item) => item.text)).toEqual([
            'Left', 'Center', 'Right', 'None',
        ]);
    });

    it('exactly one "Align column" item is checked, matching context.columnAlignment (or "None" when omitted)', () => {
        const editor = new MarkdownEditor();

        const rightChecked = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, columnAlignment: 'right',
        });
        const rightTableItems = submenuItemsOf(findItem(rightChecked, 'Table'));
        const rightItems = submenuItemsOf(findItem(rightTableItems ?? [], 'Align column'));
        expect(rightItems?.map((item) => item.checked)).toEqual([false, false, true, false]);

        const omitted = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
        });
        const omittedTableItems = submenuItemsOf(findItem(omitted, 'Table'));
        const omittedItems = submenuItemsOf(findItem(omittedTableItems ?? [], 'Align column'));
        expect(omittedItems?.map((item) => item.checked)).toEqual([false, false, false, true]);
    });

    it('each "Align column" item\'s action() reaches MarkdownEditor.setTableColumnAlignment with its own alignment', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.find((item) => item.text === 'Center')?.action?.();

        expect(normalize(editor.getValue()).split('\n')[1]).toBe('| :---: | --- | --- |');
    });

    it('"text" and "empty-line" contexts build no "Align column" item', () => {
        const editor = new MarkdownEditor();

        const textItems = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS,
        });
        const emptyLineItems = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'empty-line', hasSelectedText: true,
        });

        expect(findItem(textItems, 'Align column')).toBeUndefined();
        expect(findItem(emptyLineItems, 'Align column')).toBeUndefined();
    });

    it("the empty-line menu's Insert ▸ Table item reaches MarkdownEditor.insertTable(2, 3)", () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true });

        submenuItemsOf(findItem(items, 'Insert'))?.find((item) => item.text === 'Table')?.action?.();

        const lines = normalize(editor.getValue()).split('\n');
        expect(lines).toHaveLength(3);   // header, delimiter, one body row
    });

    it("the empty-line menu's Insert ▸ Bulleted list / Numbered list items reach toggleUnorderedList / toggleOrderedList", () => {
        const bulleted = new MarkdownEditor();
        bulleted.setValue('word');
        selectStart(bulleted);
        const bulletedItems = contextMenuMethodsOf(bulleted).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false });

        submenuItemsOf(findItem(bulletedItems, 'Insert'))?.find((item) => item.text === 'Bulleted list')?.action?.();

        expect(bulleted.getValue()).toContain('- word');

        const numbered = new MarkdownEditor();
        numbered.setValue('word');
        selectStart(numbered);
        const numberedItems = contextMenuMethodsOf(numbered).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false });

        submenuItemsOf(findItem(numberedItems, 'Insert'))?.find((item) => item.text === 'Numbered list')?.action?.();

        expect(numbered.getValue()).toContain('1. word');
    });

    it('Cut and Copy carry enabled: hasSelectedText in all three contexts; Paste never sets enabled', () => {
        const editor = new MarkdownEditor();
        const contexts: ContextMenuTarget[] = [
            { kind: 'text', hasSelectedText: true, ...SOME_FORMATS },
            { kind: 'text', hasSelectedText: false, ...SOME_FORMATS },
            { kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS },
            { kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS },
            { kind: 'empty-line', hasSelectedText: true },
            { kind: 'empty-line', hasSelectedText: false },
        ];

        for (const context of contexts) {
            const items = contextMenuMethodsOf(editor).buildContextMenuItems(context);

            expect(findItem(items, 'Cut')?.enabled).toBe(context.hasSelectedText);
            expect(findItem(items, 'Copy')?.enabled).toBe(context.hasSelectedText);
            expect(findItem(items, 'Paste')?.enabled).toBeUndefined();
        }
    });

    it('handleWysiwygContextMenu no-throws when event.target is not a DOM node', () => {
        const editor = new MarkdownEditor();
        const fakeEvent = { target: {} } as MouseEvent;

        expect(() => contextMenuMethodsOf(editor).handleWysiwygContextMenu(fakeEvent)).not.toThrow();
    });

    describe('"Insert link…" / "Edit link…" prompt flow (promptAndApplyLink)', () => {
        afterEach(() => vi.restoreAllMocks());

        it('confirming the prompt with a URL calls toggleLink with that URL ("Insert link…")', async () => {
            const editor = new MarkdownEditor();
            editor.setValue('hello world');
            selectStart(editor);

            vi.spyOn(Dialog, 'show').mockImplementation(async (config) => {
                (config.contentComponent as TextField).setValue('https://new.example.com');

                return 'confirm';
            });

            await contextMenuMethodsOf(editor).promptAndApplyLink('Insert link', '');

            expect(editor.getValue()).toContain('https://new.example.com');
        });

        it('cancelling the prompt makes no change to the document', async () => {
            const editor = new MarkdownEditor();
            editor.setValue('hello world');
            selectStart(editor);
            const before = editor.getValue();

            vi.spyOn(Dialog, 'show').mockResolvedValue('cancel');

            await contextMenuMethodsOf(editor).promptAndApplyLink('Insert link', '');

            expect(editor.getValue()).toBe(before);
        });

        it('confirming the prompt with an empty/whitespace-only URL makes no change to the document', async () => {
            const editor = new MarkdownEditor();
            editor.setValue('hello world');
            selectStart(editor);
            const before = editor.getValue();

            vi.spyOn(Dialog, 'show').mockImplementation(async (config) => {
                (config.contentComponent as TextField).setValue('   ');

                return 'confirm';
            });

            await contextMenuMethodsOf(editor).promptAndApplyLink('Insert link', '');

            expect(editor.getValue()).toBe(before);
        });

        it('"Edit link…" confirming with the URL left unchanged from its pre-filled default makes no change', async () => {
            const editor = new MarkdownEditor();
            editor.setValue('A [text](https://old) link.');

            lexicalOf(editor).update(() => {
                const paragraph = $getRoot().getFirstChild() as ElementNode;
                const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
                const textNode = linkNode.getFirstChild();

                if ($isTextNode(textNode)) {
                    textNode.select(2, 2);
                }
            }, { discrete: true });
            const before = editor.getValue();

            // Never mutates the field: the mock resolves 'confirm' with the
            // field left at its pre-filled default ("https://old").
            vi.spyOn(Dialog, 'show').mockResolvedValue('confirm');

            await contextMenuMethodsOf(editor).promptAndApplyLink('Edit link', 'https://old');

            expect(editor.getValue()).toBe(before);
        });
    });
});

describe('MarkdownEditor context-menu paste target', () => {
    // Notification's history and live-toast queue are private static state that
    // persist across tests; clear both so each case starts clean (a stale toast
    // left in the queue from a prior test would break restack() under the fresh
    // sink), matching NotificationHistory.test.ts:25-28.
    function clearNotificationStatics(): void {
        (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).history = [];
        (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).activeNotifications = [];
    }

    beforeEach(clearNotificationStatics);
    afterEach(clearNotificationStatics);

    /** Places a collapsed caret at `offset` inside the document's first paragraph's first text node. */
    function collapseAt(editor: MarkdownEditor, offset: number): void {
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(offset, offset);
            }
        }, { discrete: true });
    }

    it('classifying a collapsed caret inside a word does not mutate the selection, though it reports selectable text', () => {
        // Regression: handleWysiwygContextMenu used to call
        // $selectEnclosingWordIfCollapsed() unconditionally before showing the
        // menu, visibly highlighting the enclosing word for as long as the
        // menu stayed open — even though Paste (via the old capture/restore
        // mechanism) ignored that highlight and landed on the untouched
        // caret. Classification must stay read-only: it reports what a
        // collapsed caret's format toggles/Cut/Copy *would* act on (see
        // $computeWordExpansion) without performing that expansion, so the
        // document's live selection is provably unchanged. Wrapped in
        // editor.read() (rather than .update()), which throws if anything
        // inside attempts to mutate — the strongest available guarantee that
        // classification performs no write.
        const editor = new MarkdownEditor();
        editor.setValue('alpha beta');
        collapseAt(editor, 'alpha beta'.indexOf('beta') + 2);   // collapsed caret inside "beta"

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({
            kind: 'text', hasSelectedText: true, bold: false, italic: false, strikethrough: false, code: false,
            underline: false, hasEnclosingBlock: false, linkUrl: null,
        });

        const stillCollapsedAtCaret = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection)
                && selection.isCollapsed()
                && selection.anchor.offset === 'alpha beta'.indexOf('beta') + 2;
        });

        expect(stillCollapsedAtCaret).toBe(true);
    });

    it('classifying a collapsed caret inside a link does not mutate the selection, and reports the link\'s URL', () => {
        // Same regression as above, for the linkUrl read: $findEnclosingLinkNode
        // must be a pure read, never expanding or otherwise touching the
        // collapsed caret it classifies.
        const editor = new MarkdownEditor();
        editor.setValue('A [link](https://example.com) in prose.');

        // Collapse mid-way through the link text ("li|nk"), inside the
        // LinkNode's own text child — not the paragraph's first child, which
        // is the plain "A " text node preceding the link.
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(2, 2);
            }
        }, { discrete: true });

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const linkNode = paragraph.getChildren().find((n) => n.getType() === 'link') as ElementNode;
            const textNode = linkNode.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect((result as { linkUrl?: string | null }).linkUrl).toBe('https://example.com');

        const stillCollapsedAtCaret = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.offset === 2;
        });

        expect(stillCollapsedAtCaret).toBe(true);
    });

    it('paste() with nothing else done first inserts at the untouched caret, leaving the enclosing word\'s characters intact', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('alpha beta');
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        collapseAt(editor, 'alpha beta'.indexOf('beta') + 2);   // collapsed caret inside "beta"; no menu action taken first

        const result = await editor.paste();

        expect(result).toBe(true);
        // "beta" is neither removed nor replaced — "X" merely lands at the
        // caret, splitting it into "be" + "X" + "ta".
        expect(editor.getValue()).toContain('alpha beXta');
    });

    it('calling paste() directly after a manual expansion replaces the expanded word instead', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('alpha beta');
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        collapseAt(editor, 'alpha beta'.indexOf('beta') + 2);
        lexicalOf(editor).update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });

        await editor.paste();

        expect(editor.getValue()).toContain('alpha X');
        expect(editor.getValue()).not.toContain('beta');
    });

    it('a format toggle invoked first expands the selection, and a following paste() replaces the toggled word', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('alpha beta');
        collapseAt(editor, 'alpha beta'.indexOf('beta') + 2);   // collapsed caret inside "beta"

        // Leaves the menu conceptually "open" (a CheckboxMenuRow toggle does
        // not close the menu): the word toggled bold is exactly what a
        // following Paste, invoked from that same still-open menu, replaces.
        editor.toggleBold();

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');
        const result = await editor.paste();

        expect(result).toBe(true);
        // The whole word is replaced, not just split at the original caret
        // (which would instead leave "alpha beXta").
        expect(editor.getValue()).toBe('alpha X');
    });

    it('pasteAtContextMenuSelection shows a "warning" toast when the read is unavailable, and none on a successful paste', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectStart(editor);
        const methods = contextMenuMethodsOf(editor);

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);
        await methods.pasteAtContextMenuSelection();

        let history = Notification.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].type).toBe('warning');
        // Mirrors MarkdownEditor.ts's private CLIPBOARD_READ_DENIED_MESSAGE constant.
        expect(history[0].message).toBe('Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.');

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');
        await methods.pasteAtContextMenuSelection();

        history = Notification.getHistory();
        expect(history).toHaveLength(1);   // unchanged: a successful paste appends nothing
    });
});

describe('$selectEnclosingWordIfCollapsed', () => {
    /** Selects the paragraph's own text at the given collapsed offset, then runs the function under test. */
    function selectAndExpand(editor: MarkdownEditor, offset: number): void {
        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(offset, offset);
            }

            $selectEnclosingWordIfCollapsed();
        }, { discrete: true });
    }

    /** The exact substring the current selection spans, via the editor's own selected-text read. */
    function selectedText(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? selection.getTextContent() : '';
        });
    }

    it('expands a collapsed selection in the middle of a word to the whole word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        selectAndExpand(editor, 3);   // between the two 'l's of "hello"

        expect(selectedText(editor)).toBe('hello');
    });

    it('expands to the whole word for non-ASCII scripts (accented, Cyrillic, CJK)', () => {
        const editor = new MarkdownEditor();
        editor.setValue('café ключ 日本語');

        selectAndExpand(editor, 2);    // inside "café"
        expect(selectedText(editor)).toBe('café');

        selectAndExpand(editor, 7);    // inside "ключ"
        expect(selectedText(editor)).toBe('ключ');

        selectAndExpand(editor, 13);   // inside "日本語"
        expect(selectedText(editor)).toBe('日本語');
    });

    it('expands a collapsed selection at a word boundary to the whole word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        selectAndExpand(editor, 0);   // start of "hello"

        expect(selectedText(editor)).toBe('hello');
    });

    it('does not touch an existing non-collapsed selection', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        lexicalOf(editor).update(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild();

            if ($isTextNode(textNode)) {
                textNode.select(0, 5);
            }
        }, { discrete: true });
        expect(selectedText(editor)).toBe('hello');

        lexicalOf(editor).update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });

        expect(selectedText(editor)).toBe('hello');
    });

    it('expands to the trailing word when the collapsed offset sits at its right edge', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        selectAndExpand(editor, 5);   // right after the 'o' of "hello", before the space

        expect(selectedText(editor)).toBe('hello');
    });

    it('is a no-op when neither adjacent character is a word character', () => {
        const editor = new MarkdownEditor();
        editor.setValue('a  b');   // two spaces: offset 2 sits between them, isolated from both words

        selectAndExpand(editor, 2);

        expect(selectedText(editor)).toBe('');
    });

    /**
     * The first specially-formatted (non-zero format) text node under the
     * document's first paragraph, if any. A plain Lexical-state reader, not
     * wrapped in its own `read`/`update` call, so it composes inside a
     * caller's own active `editor.update()` block instead of nesting one.
     */
    function findFormattedTextNode(): LexicalNode | null {
        const paragraph = $getRoot().getFirstChild() as ElementNode;

        for (const child of paragraph.getChildren()) {
            if ($isTextNode(child) && child.getFormat() !== 0) {
                return child;
            }
        }

        return null;
    }

    it('selects the whole run for a collapsed offset inside a code span\'s punctuation, not just a word within it', () => {
        // Regression: "getValue()" is one CODE-formatted text node. A click
        // landing exactly between the parens has no word character on either
        // side, so a plain word-boundary scan would leave the selection
        // collapsed — and toggling a format on a collapsed selection affects
        // only text typed from that point on, not "getValue()" itself. That
        // read as "nothing happens" when unchecking Inline code from the
        // context menu.
        const editor = new MarkdownEditor();
        editor.setValue('Text with `getValue()` here.');

        lexicalOf(editor).update(() => {
            const codeNode = findFormattedTextNode();

            if ($isTextNode(codeNode)) {
                const offset = codeNode.getTextContent().indexOf('(') + 1;   // between the parens

                codeNode.select(offset, offset);
            }

            $selectEnclosingWordIfCollapsed();
        }, { discrete: true });

        expect(selectedText(editor)).toBe('getValue()');
    });

    it('selects the whole run for a collapsed offset anywhere inside a code span, regardless of position', () => {
        const editor = new MarkdownEditor();
        editor.setValue('Text with `getValue()` here.');

        lexicalOf(editor).update(() => {
            const codeNode = findFormattedTextNode();

            if ($isTextNode(codeNode)) {
                codeNode.select(0, 0);   // the very start of the run
            }

            $selectEnclosingWordIfCollapsed();
        }, { discrete: true });

        expect(selectedText(editor)).toBe('getValue()');
    });

    it('unchecking Inline code from a collapsed click inside "getValue()" removes the format from the whole span', () => {
        const editor = new MarkdownEditor();
        editor.setValue('Text with `getValue()` here.');

        lexicalOf(editor).update(() => {
            const codeNode = findFormattedTextNode();

            if ($isTextNode(codeNode)) {
                const offset = codeNode.getTextContent().indexOf('(') + 1;

                codeNode.select(offset, offset);
            }

            $selectEnclosingWordIfCollapsed();
        }, { discrete: true });

        editor.toggleInlineCode();

        expect(editor.getValue()).not.toContain('`getValue()`');
        expect(editor.getValue()).toContain('getValue()');
    });

    it('selects the whole run for a multi-word bold phrase, not just the clicked word', () => {
        const editor = new MarkdownEditor();
        editor.setValue('Some **bold phrase** here.');

        lexicalOf(editor).update(() => {
            const boldNode = findFormattedTextNode();

            if ($isTextNode(boldNode)) {
                const offset = boldNode.getTextContent().indexOf(' ') + 1;   // between "bold" and "phrase"

                boldNode.select(offset, offset);
            }

            $selectEnclosingWordIfCollapsed();
        }, { discrete: true });

        expect(selectedText(editor)).toBe('bold phrase');
    });
});

describe('MarkdownEditor dispose', () => {
    it('runs the registered _codeEditor child\'s destructor() exactly once', () => {
        const editor = new MarkdownEditor();

        // `_codeEditor` is a registered child (added via `addComponent`), so
        // its teardown is reached through the base class's recursive
        // `destructor()` call — a redundant explicit call in
        // `MarkdownEditor.destructor()` would run it twice. Regression for
        // that double-teardown class, matching Chart.test.ts's
        // `_legend.destructor` spy.
        const codeEditorDestructor = vi.spyOn(
            (editor as unknown as { _codeEditor: { destructor(): void } })._codeEditor as unknown as { destructor(): void },
            'destructor'
        );

        editor.getElement(true);
        editor.dispose();

        expect(codeEditorDestructor).toHaveBeenCalledTimes(1);
    });
});
