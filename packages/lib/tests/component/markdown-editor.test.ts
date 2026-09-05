import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkdownEditor, $classifyContextMenuTarget, $selectEnclosingWordIfCollapsed } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorChange, ContextMenuTarget } from '~/component/editor/MarkdownEditor';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import type { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { Component } from '~/core/Component';
import { TRANSFORMERS } from '~/component/editor/markdownTransformers';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { ensureMarkdownEditorClassRules } from '~/component/editor/editorTheme';
import {
    HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
    BOLD_STAR, ITALIC_STAR, INLINE_CODE, LINK,
    STRIKETHROUGH, HIGHLIGHT, CHECK_LIST,
} from '@lexical/markdown';
import { TableNode, TableRowNode, TableCellNode } from '@lexical/table';
import { $getRoot, $getSelection, $isRangeSelection, $isParagraphNode, $isTextNode, $selectAll, KEY_ENTER_COMMAND } from 'lexical';
import type { LexicalEditor, ElementNode, LexicalNode } from 'lexical';
import { lexer } from 'marked';
import { DOM } from '~/core/DOM';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../dom/TestDOM';
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
};

// The exact token types the read-only `Markdown` viewer renders; anything else
// falls to its plain-text fallback.
const VIEWER_TOKENS = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'space', 'table']);

/** Normalises Lexical's markdown export for comparison: strip trailing spaces, collapse blank-line runs, trim. */
function normalize(md: string): string {
    return md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Reaches the private headless Lexical editor for white-box selection setup. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/** Reaches the private source-surface CodeEditor for white-box readOnly / dirty-state assertions. */
function codeEditorOf(editor: MarkdownEditor): {
    getReadOnly(): boolean; getValue(): string; isDirty(): boolean; onDocChange(value: string): void;
} {
    return (editor as unknown as {
        _codeEditor: { getReadOnly(): boolean; getValue(): string; isDirty(): boolean; onDocChange(value: string): void };
    })._codeEditor;
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
} {
    return editor as unknown as {
        buildContextMenuItems(context: ContextMenuTarget): MenuItemConfig[];
        handleWysiwygContextMenu(event: MouseEvent): void;
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

/** Places a collapsed range selection at the start of the document, so a block command has a selection to act on. */
function selectStart(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
}

describe('markdownTransformers curation', () => {
    it('contains exactly the eleven dialect transformers', () => {
        expect(TRANSFORMERS).toHaveLength(11);
        expect(TRANSFORMERS).toEqual(expect.arrayContaining([
            HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
            BOLD_STAR, ITALIC_STAR, INLINE_CODE, STRIKETHROUGH, LINK,
        ]));
    });

    it('excludes the constructs the viewer drops (highlight, check-list)', () => {
        expect(TRANSFORMERS).not.toContain(HIGHLIGHT);
        expect(TRANSFORMERS).not.toContain(CHECK_LIST);
    });
});

describe('editorNodes table registration', () => {
    it('EDITOR_NODES contains TableNode, TableRowNode, and TableCellNode', () => {
        expect(EDITOR_NODES).toContain(TableNode);
        expect(EDITOR_NODES).toContain(TableRowNode);
        expect(EDITOR_NODES).toContain(TableCellNode);
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
        // Calls the class-rule registrar directly rather than mounting the
        // WYSIWYG surface: `ensureMarkdownEditorClassRules` only runs from
        // `WysiwygSurface.mount`, gated on the surface's first *layout* pass
        // (`onFirstLayout`), which `getElement(true)` alone does not drive
        // in this offline harness.
        ensureMarkdownEditorClassRules();

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter((w) => w.key === 'lineHeight');

        expect(rows.some((w) => w.selector.includes('ts-ui-mde-code') && w.value === 'normal')).toBe(true);
        expect(rows.some((w) => w.selector.includes('ts-ui-mde-inline-code') && w.value === 'normal')).toBe(true);
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
                .toggleUnorderedList()
                .toggleOrderedList()
                .toggleLink('https://example.com')
                .toggleLink(null)
                .setBlockType('h1')
                .clearFormatting()
        ).not.toThrow();
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

            const tokens = lexer(editor.getValue());
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

        const tokens = lexer(editor.getValue());

        expect(tokens.some((token) => token.type === 'table')).toBe(false);
        expect(editor.getValue()).not.toContain('---');
    });

    it('a delimiter row narrower than the header does not become a table, matching the viewer', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- |\n| 1 | 2 |');

        const tokens = lexer(editor.getValue());

        expect(tokens.some((token) => token.type === 'table')).toBe(false);
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

    it('deleteTable removes the table containing the caret, including every row and cell', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        editor.deleteTable();

        const tokens = lexer(editor.getValue());

        expect(tokens.some((token) => token.type === 'table')).toBe(false);
    });

    it('deleteTable no-throws when the caret is not inside a table cell', () => {
        const editor = new MarkdownEditor();

        expect(() => editor.deleteTable()).not.toThrow();
    });

    it('all five commands chain on a fresh editor with no prior selection and no table, without throwing', () => {
        const editor = new MarkdownEditor();

        expect(() =>
            editor
                .insertTable(2, 2)
                .insertTableRow()
                .deleteTableRow()
                .insertTableColumn()
                .deleteTableColumn()
        ).not.toThrow();
    });
});

describe('$classifyContextMenuTarget', () => {
    it('classifies a text node inside ordinary prose as "text" with every format false', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as ElementNode;
            const textNode = paragraph.getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({ kind: 'text', bold: false, italic: false, strikethrough: false, code: false });
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

        expect(result).toEqual({ kind: 'text', bold: true, italic: false, strikethrough: false, code: false });
    });

    it('classifies the paragraph node of a genuinely empty paragraph as "empty-line"', () => {
        const editor = new MarkdownEditor();

        (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

        const result = lexicalOf(editor).read(() => {
            const paragraph = $getRoot().getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(paragraph);
        });

        expect(result).toEqual({ kind: 'empty-line' });
    });

    it('classifies a node inside a populated table cell as "table-cell", carrying the format state', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        const result = lexicalOf(editor).read(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getFirstChild() as TableRowNode;
            const cell = row.getFirstChild() as TableCellNode;
            const textNode = (cell.getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result).toEqual({ kind: 'table-cell', bold: false, italic: false, strikethrough: false, code: false });
    });

    it('classifies a node inside an empty table cell as "table-cell", not "empty-line" (table check wins)', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first (empty) header cell

        const result = lexicalOf(editor).read(() => {
            const selection = $getSelection();
            const node = $isRangeSelection(selection) ? selection.anchor.getNode() : null;

            return $classifyContextMenuTarget(node as LexicalNode);
        });

        expect(result).toEqual({ kind: 'table-cell', bold: false, italic: false, strikethrough: false, code: false });
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

        expect(result).toEqual({ kind: 'table-cell', bold: true, italic: false, strikethrough: false, code: false });
    });
});

describe('MarkdownEditor Alt+Enter block-separator shortcut', () => {
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
});

describe('MarkdownEditor context menu', () => {
    /** A representative fully-mixed format state: some formats on, some off. */
    const SOME_FORMATS: { bold: boolean; italic: boolean; strikethrough: boolean; code: boolean } =
        { bold: true, italic: false, strikethrough: true, code: false };

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
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'text', ...SOME_FORMATS });

        // Order from buildFormatToggleItems: Bold, Italic, Strikethrough, Inline code.
        expect(rowOf(items[0]).isChecked()).toBe(true);
        expect(rowOf(items[1]).isChecked()).toBe(false);
        expect(rowOf(items[2]).isChecked()).toBe(true);
        expect(rowOf(items[3]).isChecked()).toBe(false);
    });

    it('a "text" context offers an 11-item block-style submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'text', ...SOME_FORMATS });

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

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'text', ...SOME_FORMATS });
        const blockStyleItems = submenuItemsOf(findItem(items, 'Block style'));

        blockStyleItems?.find((item) => item.text === 'Quote')?.action?.();

        expect(lexer(editor.getValue()).some((token) => token.type === 'blockquote')).toBe(true);
    });

    it('a "text" context\'s Bold checkbox row reaches MarkdownEditor.toggleBold on activation', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', bold: false, italic: false, strikethrough: false, code: false,
        });

        rowOf(items[0]).activate();

        expect(editor.getValue()).toContain('**word**');
    });

    it('an "empty-line" context omits Paragraph and offers a 6-item Heading submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line' });

        expect(findItem(items, 'Paragraph')).toBeUndefined();
        expect(submenuItemsOf(findItem(items, 'Heading'))).toHaveLength(6);
    });

    it('a "table-cell" context returns 9 entries: 4 format rows, Clear formatting, then Insert and Delete submenus', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'table-cell', ...SOME_FORMATS });

        expect(items).toHaveLength(9);
        expect(rowOf(items[0]).isChecked()).toBe(true);    // Bold
        expect(rowOf(items[1]).isChecked()).toBe(false);   // Italic
        expect(rowOf(items[2]).isChecked()).toBe(true);    // Strikethrough
        expect(rowOf(items[3]).isChecked()).toBe(false);   // Inline code
        expect(items.slice(4).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Clear formatting', '(separator)', 'Insert', 'Delete',
        ]);

        expect(submenuItemsOf(findItem(items, 'Insert'))?.map((item) => item.text)).toEqual([
            'Row above', 'Row below', 'Column left', 'Column right',
        ]);
        expect(submenuItemsOf(findItem(items, 'Delete'))?.map((item) => item.text)).toEqual([
            'Row', 'Column', 'Table',
        ]);
    });

    it("the table-cell menu's Delete submenu's Table item reaches MarkdownEditor.deleteTable", () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'table-cell', ...SOME_FORMATS });

        submenuItemsOf(findItem(items, 'Delete'))?.find((item) => item.text === 'Table')?.action?.();

        const tokens = lexer(editor.getValue());
        expect(tokens.some((token) => token.type === 'table')).toBe(false);
    });

    it("the empty-line menu's Table item reaches MarkdownEditor.insertTable(2, 3)", () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line' });

        findItem(items, 'Table')?.action?.();

        const lines = normalize(editor.getValue()).split('\n');
        expect(lines).toHaveLength(3);   // header, delimiter, one body row
    });

    it('handleWysiwygContextMenu no-throws when event.target is not a DOM node', () => {
        const editor = new MarkdownEditor();
        const fakeEvent = { target: {} } as MouseEvent;

        expect(() => contextMenuMethodsOf(editor).handleWysiwygContextMenu(fakeEvent)).not.toThrow();
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
