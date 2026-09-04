import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorChange } from '~/component/editor/MarkdownEditor';
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
import { $getRoot, $isParagraphNode } from 'lexical';
import type { LexicalEditor } from 'lexical';
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
    it('contains exactly the ten dialect transformers', () => {
        expect(TRANSFORMERS).toHaveLength(10);
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

describe('MarkdownEditor trailing paragraph after a non-paragraph last block', () => {
    /** Whether the document's last root child is a paragraph node. */
    function endsWithParagraph(editor: MarkdownEditor): boolean {
        return lexicalOf(editor).read(() => {
            const lastChild = $getRoot().getLastChild();

            return lastChild !== null && $isParagraphNode(lastChild);
        });
    }

    it('insertTable on an empty editor leaves a trailing paragraph after the table, so a click below it has somewhere to land', () => {
        const editor = new MarkdownEditor();

        editor.insertTable(2, 3);

        expect(endsWithParagraph(editor)).toBe(true);
    });

    it('setValue with content ending in a fenced code block appends a trailing paragraph', () => {
        const editor = new MarkdownEditor();

        editor.setValue('# Heading\n\n```\ncode\n```');

        expect(endsWithParagraph(editor)).toBe(true);
    });

    it('building the editor from construction-time content ending in a table appends a trailing paragraph', () => {
        const editor = new MarkdownEditor('| a | b |\n| --- | --- |\n| 1 | 2 |');

        // Forces ensureEditor()'s first-build path (the same one the SAMPLE
        // demo content and any other construction-time value goes through)
        // without a selection to act on, so the command itself is a no-op
        // on content.
        editor.setBlockType('paragraph');

        expect(endsWithParagraph(editor)).toBe(true);
    });

    it('a source-mode round trip through setMode ending in a table still leaves a trailing paragraph', () => {
        const editor = new MarkdownEditor('| a | b |\n| --- | --- |\n| 1 | 2 |');

        editor.setMode('source');
        editor.setMode('wysiwyg');

        expect(endsWithParagraph(editor)).toBe(true);
    });

    it('does not add a second trailing paragraph when the document already ends with prose', () => {
        const editor = new MarkdownEditor();

        editor.setValue('# Heading\n\nSome prose.');

        const childCount = lexicalOf(editor).read(() => $getRoot().getChildrenSize());

        expect(childCount).toBe(2);   // heading, then the one prose paragraph — no extra
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
