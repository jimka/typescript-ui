import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
    MarkdownEditor, $adoptDomSelection, $classifyContextMenuTarget, $contextMenuNodeFor, $selectEnclosingWordIfCollapsed,
} from '~/component/editor/MarkdownEditor';
import type {
    MarkdownBlockType, MarkdownEditorChange, MarkdownEditorSelectionState, ContextMenuTarget, CommandAvailability,
} from '~/component/editor/MarkdownEditor';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import type { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { Component } from '~/core/Component';
import { ORDERED_LIST_SHORTCUT, SHORTCUT_TRANSFORMERS } from '~/component/editor/markdownTransformers';
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
    $createRangeSelection, $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isParagraphNode, $isTextNode, $selectAll,
    $setSelection, FORMAT_TEXT_COMMAND, KEY_ENTER_COMMAND, PASTE_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor, ElementNode, LexicalNode, ParagraphNode, RangeSelection, TextNode } from 'lexical';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { Notification } from '~/overlay/Notification';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import type { TextField } from '~/component/input/TextField';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { EditorState } from '@codemirror/state';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';
import { canonicalSave } from './markdown-roundtrip/harness';
import { expandPrefixTabs } from '~/component/display/markdownTabs';

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
    getId(): string;
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

/** Every field of the availability record. */
const AVAILABILITY_FIELDS = [
    'canFormat', 'canStyle', 'canLink', 'canRemoveLink', 'canClearFormatting',
    'canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock',
    'canInsertTable', 'canInsertImage', 'canEditTable', 'canMergeCells', 'canUnmergeCell',
] as const satisfies ReadonlyArray<keyof CommandAvailability>;

/** The availability record in which exactly `available` are `true`. */
function availabilityOf(...available: Array<keyof CommandAvailability>): CommandAvailability {
    return Object.fromEntries(AVAILABILITY_FIELDS.map((field) => [field, available.includes(field)])) as unknown as CommandAvailability;
}

/** An availability record with every field `true`, for building a menu nothing is dimmed in. No selection gives it. */
const ALL_AVAILABLE: CommandAvailability = availabilityOf(...AVAILABILITY_FIELDS);

/** The availability with no selection at all: only the commands that make a selection of their own apply. */
const NO_SELECTION: CommandAvailability = availabilityOf('canInsertTable', 'canInsertImage');

/**
 * The availability at a caret or a range in ordinary prose: no link to
 * remove, no format to clear, no block to put a line around, no table.
 */
const IN_PROSE: CommandAvailability = availabilityOf(
    'canFormat', 'canStyle', 'canLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage',
);

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
            HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST_SHORTCUT,
            BOLD_STAR, ITALIC_STAR, INLINE_CODE, STRIKETHROUGH, LINK,
            UNDERLINE,
        ]));
    });

    it('limits the ordered-list shortcut to the nine digits a list marker allows, otherwise as Lexical\'s', () => {
        expect(ORDERED_LIST_SHORTCUT).toEqual({ ...ORDERED_LIST, regExp: ORDERED_LIST_SHORTCUT.regExp });
        expect(ORDERED_LIST_SHORTCUT.regExp.test('123456789. ')).toBe(true);
        expect(ORDERED_LIST_SHORTCUT.regExp.test('1234567890. ')).toBe(false);
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

describe('MarkdownEditor WYSIWYG surface: read-only keeps it an editing host', () => {
    /** The attributes the surface element ends up with. */
    function surfaceAttrs(editor: MarkdownEditor): Record<string, string> {
        editor.getElement(true);

        return attrsOf(DOM.sink as RecordingDOMSink, wysiwygOf(editor).getElement(true));
    }

    it('S1: an editor constructed read-only has a contenteditable surface, exposed as a read-only multi-line text box', () => {
        const editor = new MarkdownEditor('# Hi', { readOnly: true });

        expect(editor.getContentEditable()).toBe(true);
        expect(surfaceAttrs(editor)).toMatchObject({
            contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': 'true',
        });
        // A contenteditable element is a tab stop by itself; a tabindex would only be able to take it out.
        expect(surfaceAttrs(editor).tabindex).toBeUndefined();
    });

    it('S2: an editable editor\'s surface carries the same role, with aria-readonly false', () => {
        const editor = new MarkdownEditor('# Hi');

        expect(editor.getContentEditable()).toBe(true);
        expect(surfaceAttrs(editor)).toMatchObject({
            contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': 'false',
        });
    });

    it('S3: setReadOnly moves aria-readonly and nothing else: the surface stays contenteditable throughout', () => {
        const editor = new MarkdownEditor('# Hi');

        editor.setReadOnly(true);

        expect(surfaceAttrs(editor)).toMatchObject({ contenteditable: 'true', 'aria-readonly': 'true' });
        expect(editor.getContentEditable()).toBe(true);

        editor.setReadOnly(false);

        expect(surfaceAttrs(editor)).toMatchObject({ contenteditable: 'true', 'aria-readonly': 'false' });
        expect(editor.getContentEditable()).toBe(true);
    });

    it('S4: only setContentEditable moves contenteditable, whatever read-only is', () => {
        const editor = new MarkdownEditor('# Hi', { readOnly: true });

        editor.setContentEditable(false);

        expect(editor.getContentEditable()).toBe(false);
        expect(surfaceAttrs(editor).contenteditable).toBe('false');

        editor.setReadOnly(false);

        expect(editor.getContentEditable()).toBe(false);
        expect(surfaceAttrs(editor).contenteditable).toBe('false');

        editor.setContentEditable(true);

        expect(editor.getContentEditable()).toBe(true);
        expect(surfaceAttrs(editor).contenteditable).toBe('true');

        editor.setReadOnly(true);

        expect(editor.getContentEditable()).toBe(true);
        expect(surfaceAttrs(editor).contenteditable).toBe('true');
    });

    it('S9: the surface is a text box exactly while it is an editing host: the four states of read-only and contenteditable', () => {
        // With contenteditable off the surface takes no focus and has no caret, so it carries no role and neither
        // property of one, read-only or not.
        const TEXT_BOX = ['role', 'aria-multiline', 'aria-readonly'];
        const carried = (editor: MarkdownEditor): (string | undefined)[] => TEXT_BOX.map((name) => surfaceAttrs(editor)[name]);

        for (const constructedReadOnly of [true, false]) {
            const editor = new MarkdownEditor('# Hi', { readOnly: constructedReadOnly });

            for (const readOnly of [true, false, true]) {
                editor.setReadOnly(readOnly);
                editor.setContentEditable(true);

                expect(carried(editor), `read-only ${readOnly}, editing host`).toEqual(['textbox', 'true', String(readOnly)]);

                editor.setContentEditable(false);

                expect(carried(editor), `read-only ${readOnly}, no editing host`).toEqual([undefined, undefined, undefined]);

                // Read-only changed while it is no editing host writes none of them back.
                editor.setReadOnly(!readOnly);

                expect(carried(editor), `read-only ${!readOnly}, no editing host`).toEqual([undefined, undefined, undefined]);

                editor.setContentEditable(true);

                expect(carried(editor), `read-only ${!readOnly}, editing host again`).toEqual(['textbox', 'true', String(!readOnly)]);
            }
        }
    });

    it('S5: setContentEditable(true) cannot make a read-only editor editable: Lexical stays not editable and every command stays refused', () => {
        for (const editor of [new MarkdownEditor('# Hi', { readOnly: true }), new MarkdownEditor('# Hi').setReadOnly(true)]) {
            editor.setValue('hello world');
            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
            editor.setContentEditable(true);

            expect(lexicalOf(editor).isEditable()).toBe(false);

            editor.toggleBold();
            editor.insertTable(2, 2);
            editor.cut();

            expect(editor.getValue()).toBe('hello world');
            expect(Object.entries(editor.getSelectionState()).filter(([field, on]) => field.startsWith('can') && on === true)).toEqual([]);
        }
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

describe('MarkdownEditor "readonlyedit"', () => {
    /** A built editor holding `hello world` with `world` selected. */
    function withWorldSelected(): MarkdownEditor {
        const editor = new MarkdownEditor();

        editor.setValue('hello world');
        lexicalOf(editor).update(() => {
            (($getRoot().getFirstChild() as ElementNode).getFirstChild() as TextNode).select(6, 11);
        }, { discrete: true });

        return editor;
    }

    /** The clipboard writes recorded so far. */
    function clipboardWrites(): unknown[] {
        return (DOM.sink as RecordingDOMSink).writes.filter((w) => w.op === 'writeClipboardText').map((w) => w.args[0]);
    }

    it('C2: unlinking, cut() and paste() on a read-only editor are each reported once, and the clipboard is left alone', async () => {
        const editor = withWorldSelected().setReadOnly(true);
        const refused = vi.fn();
        const read = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');
        const update = vi.spyOn(lexicalOf(editor), 'update');

        editor.on('readonlyedit', refused);
        editor.toggleLink(null);

        expect(refused).toHaveBeenCalledTimes(1);

        editor.cut();

        expect(refused).toHaveBeenCalledTimes(2);
        expect(await editor.paste()).toBe(false);
        expect(refused).toHaveBeenCalledTimes(3);
        expect(read).not.toHaveBeenCalled();
        expect(clipboardWrites()).toEqual([]);
        expect(update).not.toHaveBeenCalled();
        expect(editor.getValue()).toBe('hello world');
    });

    it('C2: linking on a read-only editor is reported once, not once by the link rule and once by its field', () => {
        const editor = withWorldSelected().setReadOnly(true);
        const refused = vi.fn();

        editor.on('readonlyedit', refused);
        editor.toggleLink('https://example.com');

        expect(refused).toHaveBeenCalledTimes(1);
        expect(editor.getValue()).toBe('hello world');
    });

    it('C3: a command on an editable editor is not reported, whether it applies or declines', () => {
        const editor = withWorldSelected();
        const refused = vi.fn();

        editor.on('readonlyedit', refused);
        editor.toggleBold();
        editor.unmergeTableCell();   // declines: the selection is in no table

        expect(editor.getValue()).toBe('hello **world**');
        expect(refused).not.toHaveBeenCalled();
    });

    it('C4: a command refused by the source editor is reported by the editor itself, once', () => {
        const editor = new MarkdownEditor('hello', { mode: 'source', readOnly: true });
        const refused = vi.fn();
        const flash = vi.spyOn((editor as unknown as { _flash: { play(): void } })._flash, 'play');

        editor.on('readonlyedit', refused);
        editor.toggleBold();

        expect(editor.getValue()).toBe('hello');
        expect(refused).toHaveBeenCalledTimes(1);
        // The source editor plays its own wash; the editor's, which lies over the WYSIWYG surface, stays still.
        expect(flash).not.toHaveBeenCalled();
    });

    it('C4: cut() and paste() refused by the source editor are each reported once', async () => {
        const editor = new MarkdownEditor('hello world', { mode: 'source', readOnly: true });
        const refused = vi.fn();

        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');
        editor.on('readonlyedit', refused);
        editor.cut();

        expect(await editor.paste()).toBe(false);
        expect(refused).toHaveBeenCalledTimes(2);
        expect(editor.getValue()).toBe('hello world');
    });

    it('C5: the listeners option takes a "readonlyedit" listener', () => {
        const refused = vi.fn();
        const editor = new MarkdownEditor('x', { readOnly: true, listeners: { readonlyedit: refused } });

        editor.toggleBold();

        expect(refused).toHaveBeenCalledTimes(1);
        expect(refused).toHaveBeenCalledWith();
    });

    it('C5: off() removes a "readonlyedit" listener', () => {
        const refused = vi.fn();
        const editor = new MarkdownEditor('x', { readOnly: true });

        editor.on('readonlyedit', refused);
        editor.off('readonlyedit', refused);
        editor.toggleBold();

        expect(refused).not.toHaveBeenCalled();
    });

    it('C7: loading a document into a read-only editor and switching its mode are not edits: nothing is reported', () => {
        const editor = new MarkdownEditor('old', { readOnly: true });
        const refused = vi.fn();

        editor.on('readonlyedit', refused);
        editor.setValue('# New');
        editor.setMode('source');
        editor.setMode('wysiwyg');
        editor.markClean();
        editor.setReadOnly(false);
        editor.setReadOnly(true);

        expect(editor.getValue()).toBe('# New');
        expect(refused).not.toHaveBeenCalled();
    });

    it('C8: copy() on a read-only editor is not an edit: nothing is reported, on either surface', () => {
        const wysiwyg = withWorldSelected().setReadOnly(true);
        const source = new MarkdownEditor('hello', { mode: 'source', readOnly: true });
        const refused = vi.fn();

        wysiwyg.on('readonlyedit', refused);
        source.on('readonlyedit', refused);
        wysiwyg.copy();
        source.copy();

        expect(clipboardWrites()).toContain('world');
        expect(refused).not.toHaveBeenCalled();
    });

    it('C9: the Copy a read-only editor\'s context menu offers is not reported either, and it is the only item', () => {
        const editor = withWorldSelected().setReadOnly(true);
        const refused = vi.fn();
        const context = lexicalOf(editor).read(() => $classifyContextMenuTarget(($getSelection() as RangeSelection).anchor.getNode()));
        const items = contextMenuMethodsOf(editor).buildContextMenuItems(context);

        editor.on('readonlyedit', refused);

        expect(items.map((item) => item.text)).toEqual(['Copy']);

        items[0].action?.();

        expect(clipboardWrites()).toEqual(['world']);
        expect(refused).not.toHaveBeenCalled();
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

describe('MarkdownEditor list toggles in a list of their kind', () => {
    /** Builds an editor showing `markdown`. */
    function editorOf(markdown: string): MarkdownEditor {
        const editor = new MarkdownEditor();

        editor.setValue(markdown);

        return editor;
    }

    /** Selects from offset 1 of the text node showing `from` to offset 1 of the one showing `to`: a caret when they are the same. */
    function selectFrom(editor: MarkdownEditor, from: string, to: string = from): void {
        lexicalOf(editor).update(() => {
            const showing = (text: string): TextNode => $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!;
            const selection = showing(from).select(1, 1);

            selection.focus.set(showing(to).getKey(), 1, 'text');
        }, { discrete: true });
    }

    const unordered = (editor: MarkdownEditor): unknown => editor.toggleUnorderedList();
    const ordered = (editor: MarkdownEditor): unknown => editor.toggleOrderedList();

    /** Each case: the document, the selection's two ends, the toggle, and the document it leaves. */
    const CASES: Array<{ name: string; doc: string; from: string; to?: string; toggle: (editor: MarkdownEditor) => unknown; result: string }> = [
        {
            name: 'a caret in an item of a bulleted list takes that item out, the list split around it',
            doc: '- one\n- two\n- three', from: 'two', toggle: unordered, result: '- one\n\ntwo\n\n- three',
        },
        {
            name: 'a range over two items of a bulleted list takes both out',
            doc: '- one\n- two\n- three', from: 'one', to: 'two', toggle: unordered, result: 'one\n\ntwo\n\n- three',
        },
        {
            name: 'a caret in an item of a numbered list takes that item out, the list after it starting from one again',
            doc: '1. one\n2. two\n3. three', from: 'two', toggle: ordered, result: '1. one\n\ntwo\n\n1. three',
        },
        {
            name: 'a caret in a nested item takes it out to the top level',
            doc: '- one\n  - inner\n- three', from: 'inner', toggle: unordered, result: '- one\n\ninner\n\n- three',
        },
        {
            name: 'a caret in an item holding a nested list takes the item out and leaves its nested list an item',
            doc: '- one\n  - inner\n- three', from: 'one', toggle: unordered, result: 'one\n\n- - inner\n- three',
        },
        {
            name: 'a caret in a numbered item nested in a bulleted list takes it out',
            doc: '- one\n  1. inner\n- three', from: 'inner', toggle: ordered, result: '- one\n\ninner\n\n- three',
        },
        {
            name: 'a caret in a task item takes it out, its marker left as the text it shows',
            doc: '- [ ] one\n- [x] two', from: 'one', toggle: unordered, result: '\\[ \\] one\n\n- [x] two',
        },
        {
            name: 'a caret in an item of a loose list takes it out',
            doc: '- one\n\n- two', from: 'one', toggle: unordered, result: 'one\n\n- two',
        },
        {
            name: 'a caret in an item of a list in a ::: column takes it out inside the column',
            doc: '::: columns\n- one\n- two\n|||\nRight\n:::', from: 'one', toggle: unordered,
            result: '::: columns\none\n\n- two\n|||\nRight\n:::',
        },
        {
            name: 'in a list of the other kind the toggle changes the caret\'s item alone, its list split around it',
            doc: '- one\n- two\n- three', from: 'two', toggle: ordered, result: '- one\n\n1. two\n\n- three',
        },
        {
            name: 'a range from a bulleted list into a numbered one makes the numbered item it touches a bulleted item, joining the list before it',
            doc: '- one\n- two\n\n1. three\n2. four', from: 'two', to: 'three', toggle: unordered, result: '- one\n- two\n- three\n\n1. four',
        },
        {
            name: 'a range from a bulleted list into a paragraph makes the paragraph an item',
            doc: '- one\n- two\n\nthree', from: 'two', to: 'three', toggle: unordered, result: '- one\n- two\n- three',
        },
    ];

    for (const { name, doc, from, to, toggle, result } of CASES) {
        it(`${name}, in one undo step, and the result saves as shown`, () => {
            const editor = editorOf(doc);
            selectFrom(editor, from, to);

            toggle(editor);

            const value = editor.getValue();

            expect(value).toBe(result);
            expect(editorOf(value).getValue()).toBe(value);
            expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);

            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

            expect(editor.getValue()).toBe(doc);
        });
    }

    it('the caret stays in the text of the item taken out', () => {
        const editor = editorOf('- one\n- two\n- three');
        selectFrom(editor, 'two');

        editor.toggleUnorderedList();

        const [text, offset, type] = lexicalOf(editor).read(() => {
            const selection = $getSelection() as RangeSelection;

            return [selection.anchor.getNode().getTextContent(), selection.anchor.offset, selection.anchor.getNode().getParent()?.getType()];
        });

        expect([text, offset, type]).toEqual(['two', 1, 'paragraph']);
    });

    it('a second toggle puts the item back into its list', () => {
        const editor = editorOf('- one\n- two\n- three');
        selectFrom(editor, 'two');

        editor.toggleUnorderedList();
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('- one\n- two\n- three');
    });

    it('source mode takes the same items out of the same lists: both results read the same in the viewer', () => {
        const NESTED = '- one\n  - inner\n- three';
        const shapes: Array<[doc: string, from: string, to?: string]> = [
            ['- one\n- two\n- three', 'two'], ['- one\n- two\n- three', 'one'], ['- one\n- two\n- three', 'one', 'two'],
            [NESTED, 'inner'], [NESTED, 'one'], ['- one\n  1. inner\n- three', 'one'],
            ['- one\n\n- two', 'one'], ['::: columns\n- one\n- two\n|||\nRight\n:::', 'one'],
        ];

        for (const [doc, from, to = from] of shapes) {
            const wysiwyg = editorOf(doc);
            selectFrom(wysiwyg, from, to);
            wysiwyg.toggleUnorderedList();

            const source = new MarkdownEditor(doc, { mode: 'source' });
            const selection = { characterCount: 0, lineCount: 1, from: doc.indexOf(from) + 1, to: doc.indexOf(to) + 1 };

            vi.spyOn(codeEditorOf(source), 'getSelection').mockReturnValue(selection);
            source.toggleUnorderedList();

            expect(source.getValue(), `${doc} at ${from}`).not.toBe(doc);
            expect(viewerModel(source.getValue()).blocks, `${doc} at ${from}`).toEqual(viewerModel(wysiwyg.getValue()).blocks);
        }
    });

    /** A command a parity row runs, on either surface. */
    type ParityCommand = 'UL' | 'OL' | 'paragraph' | 'h2' | 'quote' | 'code';

    const PARITY_COMMANDS: Record<ParityCommand, (editor: MarkdownEditor) => unknown> = {
        UL:        unordered,
        OL:        ordered,
        paragraph: (editor) => editor.setBlockType('paragraph'),
        h2:        (editor) => editor.setBlockType('h2'),
        quote:     (editor) => editor.setBlockType('quote'),
        code:      (editor) => editor.setBlockType('code'),
    };

    /** [id, document, word the selection starts in, word it ends in (null: a caret), command, what the WYSIWYG surface saves, what source mode leaves] */
    type ParityRow = [id: string, doc: string, from: string, to: string | null, command: ParityCommand, wysiwyg: string, source: string];

    /** Selects from one character into the word `from` to one character into the word `to`, each in the first text node holding it. */
    function selectWords(editor: MarkdownEditor, from: string, to: string): void {
        lexicalOf(editor).update(() => {
            const holding = (word: string): TextNode => $getRoot().getAllTextNodes().find((node) => node.getTextContent().includes(word))!;
            const offsetIn = (word: string): number => holding(word).getTextContent().indexOf(word) + 1;
            const selection = holding(from).select(offsetIn(from), offsetIn(from));

            selection.focus.set(holding(to).getKey(), offsetIn(to), 'text');
        }, { discrete: true });
    }

    /** Runs a row's command on the WYSIWYG surface, on the row's selection. */
    function wysiwygAfter([, doc, from, to, command]: ParityRow): MarkdownEditor {
        const editor = editorOf(doc);

        selectWords(editor, from, to ?? from);
        PARITY_COMMANDS[command](editor);

        return editor;
    }

    /** Runs a row's command in source mode, on the same selection, and returns the text it leaves. */
    function sourceAfter([, doc, from, to, command]: ParityRow): string {
        const editor = new MarkdownEditor(doc, { mode: 'source' });
        const ends = [doc.indexOf(from) + 1, doc.indexOf(to ?? from) + 1];
        const selection = { characterCount: 0, lineCount: 1, from: Math.min(...ends), to: Math.max(...ends) };

        vi.spyOn(codeEditorOf(editor), 'getSelection').mockReturnValue(selection);
        PARITY_COMMANDS[command](editor);

        return editor.getValue();
    }

    const SAME: ParityRow[] = [
        ['B1', '- one\n- two\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
        ['B1', '- one\n- two\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n1. two\n- three'],
        ['B2', '- one\n- two\n- three', 'one', 'two', 'UL', 'one\n\ntwo\n\n- three', 'one\n\ntwo\n\n- three'],
        ['B2', '- one\n- two\n- three', 'one', 'two', 'OL', '1. one\n2. two\n\n- three', '1. one\n2. two\n- three'],
        ['B3', '- one\n- two\n- three', 'one', 'three', 'UL', 'one\n\ntwo\n\nthree', 'one\n\ntwo\n\nthree'],
        ['B3', '- one\n- two\n- three', 'one', 'three', 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
        ['N1', '1. one\n2. two\n3. three', 'two', null, 'UL', '1. one\n\n- two\n\n1. three', '1. one\n- two\n3. three'],
        ['N1', '1. one\n2. two\n3. three', 'two', null, 'OL', '1. one\n\ntwo\n\n1. three', '1. one\n\ntwo\n\n3. three'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n- [x] two', '1. [ ] one\n- [x] two'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'paragraph', '\\[ \\] one\n\n- [x] two', '\\[ \\] one\n- [x] two'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\n- [x] two', '## \\[ \\] one\n- [x] two'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'quote', '> \\[ \\] one\n\n- [x] two', '> \\[ \\] one\n- [x] two'],
        ['T1', '- [ ] one\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\n- [x] two', '```\n[ ] one\n```\n- [x] two'],
        ['T2', '- [ ] one\n- [x] two', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two', '- [ ] one\n\n\\[x\\] two'],
        ['T2', '- [ ] one\n- [x] two', 'two', null, 'OL', '- [ ] one\n\n1. [x] two', '- [ ] one\n1. [x] two'],
        ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'UL', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
        ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'OL', '1. [ ] one\n2. [x] two', '1. [ ] one\n2. [x] two'],
        ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'paragraph', '\\[ \\] one\n\n\\[x\\] two', '\\[ \\] one\n\n\\[x\\] two'],
        ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'h2', '## \\[ \\] one\n\n## \\[x\\] two', '## \\[ \\] one\n## \\[x\\] two'],
        ['T3', '- [ ] one\n- [x] two', 'one', 'two', 'quote', '> \\[ \\] one\n\n> \\[x\\] two', '> \\[ \\] one\n\n> \\[x\\] two'],
        ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'UL', '- [ ] one\n\n1. [x] two', '- [ ] one\n2. [x] two'],
        ['T4', '1. [ ] one\n2. [x] two', 'one', null, 'OL', '\\[ \\] one\n\n1. [x] two', '\\[ \\] one\n\n2. [x] two'],
        ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'UL', '\\[ \\] one\n\ntwo\n\n- three', '\\[ \\] one\n\ntwo\n\n- three'],
        ['T5', '- [ ] one\n- two\n- three', 'one', 'two', 'OL', '1. [ ] one\n2. two\n\n- three', '1. [ ] one\n2. two\n- three'],
        ['T6', '- [ ] one\n- two\n- three', 'two', null, 'UL', '- [ ] one\n\ntwo\n\n- three', '- [ ] one\n\ntwo\n\n- three'],
        ['T6', '- [ ] one\n- two\n- three', 'two', null, 'OL', '- [ ] one\n\n1. two\n\n- three', '- [ ] one\n1. two\n- three'],
        ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'UL', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
        ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'OL', '- [ ] one\n\n1. [x] two\n\n- three', '- [ ] one\n\n1. [x] two\n\n- three'],
        ['T7', '- [ ] one\n\n- [x] two\n\n- three', 'two', null, 'paragraph', '- [ ] one\n\n\\[x\\] two\n\n- three', '- [ ] one\n\n\\[x\\] two\n\n- three'],
        ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'UL', '- one\n\n\\[ \\] inner\n\n- three', '- one\n\n\\[ \\] inner\n\n- three'],
        ['T8', '- one\n  - [ ] inner\n- three', 'inner', null, 'OL', '- one\n\n1. [ ] inner\n\n- three', '- one\n1. [ ] inner\n- three'],
        ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'UL', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
        ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'OL', '1. \\[x\\] one\n\n- two\n\n[x]: /url', '1. [x] one\n- two\n\n[x]: /url'],
        ['T10', '- [x] one\n- two\n\n[x]: /url', 'one', null, 'paragraph', '\\[x\\] one\n\n- two\n\n[x]: /url', '\\[x\\] one\n- two\n\n[x]: /url'],
        ['T11', '- [ ] **one** two\n- three', 'one', null, 'UL', '\\[ \\] **one** two\n\n- three', '\\[ \\] **one** two\n- three'],
        ['T11', '- [ ] **one** two\n- three', 'one', null, 'OL', '1. [ ] **one** two\n\n- three', '1. [ ] **one** two\n- three'],
        ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\n\\[ \\] one\n\n- two\n|||\nRight\n:::', '::: columns\n\\[ \\] one\n- two\n|||\nRight\n:::'],
        ['T12', '::: columns\n- [ ] one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. [ ] one\n\n- two\n|||\nRight\n:::', '::: columns\n1. [ ] one\n- two\n|||\nRight\n:::'],
        ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'UL', '- zero\n- [ ] one\n- two', '- zero\n- [ ] one\n- two'],
        ['T13', 'zero\n\n- [ ] one\n- two', 'zero', 'one', 'OL', '1. zero\n2. [ ] one\n\n- two', '1. zero\n2. [ ] one\n- two'],
        ['T15', '- [ ] one\n\n  second\n\n- [x] two', 'second', null, 'UL', '- [ ] one\n\n- second\n\n- [x] two', '- [ ] one\n\n- second\n\n- [x] two'],
        ['T15', '- [ ] one\n\n  second\n\n- [x] two', 'second', null, 'OL', '- [ ] one\n\n1. second\n\n- [x] two', '- [ ] one\n\n1. second\n\n- [x] two'],
        ['T17', '1. [ ] one\n2. [x] two\n3. three', 'two', null, 'UL', '1. [ ] one\n\n- [x] two\n\n1. three', '1. [ ] one\n- [x] two\n3. three'],
        ['T17', '1. [ ] one\n2. [x] two\n3. three', 'two', null, 'OL', '1. [ ] one\n\n\\[x\\] two\n\n1. three', '1. [ ] one\n\n\\[x\\] two\n\n3. three'],
        ['T18', '- one\n- [ ] two\n\n1. three\n2. [x] four', 'two', 'four', 'UL', '- one\n- [ ] two\n- three\n- [x] four', '- one\n- [ ] two\n- three\n- [x] four'],
        ['T18', '- one\n- [ ] two\n\n1. three\n2. [x] four', 'two', 'four', 'OL', '- one\n\n1. [ ] two\n2. three\n3. [x] four', '- one\n1. [ ] two\n1. three\n2. [x] four'],
        ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'UL', '- one\n- two\n- three\n\n1. four', '- one\n- two\n- three\n2. four'],
        ['X1', '- one\n- two\n\n1. three\n2. four', 'two', 'three', 'OL', '- one\n\n1. two\n2. three\n3. four', '- one\n1. two\n1. three\n2. four'],
        ['X2', '- one\n- two\n\nthree', 'two', 'three', 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
        ['X2', '- one\n- two\n\nthree', 'two', 'three', 'OL', '- one\n\n1. two\n2. three', '- one\n1. two\n2. three'],
        ['X3', '- one\n- two\n\nthree', 'three', null, 'UL', '- one\n- two\n- three', '- one\n- two\n- three'],
        ['X3', '- one\n- two\n\nthree', 'three', null, 'OL', '- one\n- two\n\n1. three', '- one\n- two\n\n1. three'],
        ['X4', 'zero\n\n- one\n- two', 'zero', null, 'UL', '- zero\n- one\n- two', '- zero\n- one\n- two'],
        ['X4', 'zero\n\n- one\n- two', 'zero', null, 'OL', '1. zero\n\n- one\n- two', '1. zero\n\n- one\n- two'],
        ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'UL', '- one\n- mid\n- two', '- one\n- mid\n- two'],
        ['X5', '- one\n\nmid\n\n- two', 'mid', null, 'OL', '- one\n\n1. mid\n\n- two', '- one\n\n1. mid\n\n- two'],
        ['X6', '* one\n* two\n\nthree', 'three', null, 'UL', '* one\n* two\n* three', '* one\n* two\n* three'],
        ['X6', '* one\n* two\n\nthree', 'three', null, 'OL', '* one\n* two\n\n1. three', '* one\n* two\n\n1. three'],
        ['X7', 'one\n\ntwo', 'one', 'two', 'UL', '- one\n- two', '- one\n- two'],
        ['X7', 'one\n\ntwo', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
        ['X8', '1. one\n2. two\n\nthree', 'three', null, 'UL', '1. one\n2. two\n\n- three', '1. one\n2. two\n\n- three'],
        ['X8', '1. one\n2. two\n\nthree', 'three', null, 'OL', '1. one\n2. two\n3. three', '1. one\n2. two\n3. three'],
        ['X9', 'zero\n\n* one\n* two\n\nthree', 'zero', 'three', 'UL', '* zero\n* one\n* two\n* three', '* zero\n* one\n* two\n* three'],
        ['X9', 'zero\n\n* one\n* two\n\nthree', 'zero', 'three', 'OL', '1. zero\n2. one\n3. two\n4. three', '1. zero\n2. one\n3. two\n4. three'],
        ['X10', '- one\n\npara\n\n1. three', 'one', 'three', 'UL', '- one\n- para\n- three', '- one\n- para\n- three'],
        ['X10', '- one\n\npara\n\n1. three', 'one', 'three', 'OL', '1. one\n2. para\n3. three', '1. one\n2. para\n1. three'],
        ['X11', '- one\n  - inner\n\n    para\n\n  - last\n- two', 'para', null, 'UL', '- one\n  - inner\n- para\n- - last\n- two', '- one\n  - inner\n- para\n- - last\n- two'],
        ['X11', '- one\n  - inner\n\n    para\n\n  - last\n- two', 'para', null, 'OL', '- one\n  - inner\n\n1. para\n\n- - last\n- two', '- one\n  - inner\n\n1. para\n\n- - last\n- two'],
        ['X12', '# head\n\n> quoted\n\npara', 'head', 'para', 'UL', '- head\n- quoted\n- para', '- head\n- quoted\n- para'],
        ['X12', '# head\n\n> quoted\n\npara', 'head', 'para', 'OL', '1. head\n2. quoted\n3. para', '1. head\n2. quoted\n3. para'],
        ['X13', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n\nten', 'ten', null, 'OL', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. ten', '1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. ten'],
        ['X14', '1) a\n2) b\n\nmid', 'mid', null, 'OL', '1) a\n2) b\n3) mid', '1) a\n2) b\n3) mid'],
        ['X15', '* a\n* b\n\nmid\n\n- c\n\n- d', 'mid', null, 'UL', '* a\n* b\n* mid\n\n- c\n\n- d', '* a\n* b\n* mid\n\n- c\n\n- d'],
        ['X16', '- a\n- b\n\nmid\n\n- c\n\n- d', 'mid', null, 'UL', '- a\n\n- b\n\n- mid\n\n- c\n\n- d', '- a\n- b\n\n- mid\n\n- c\n\n- d'],
        ['X17', '* one\n\n1. two\n2. three\n3. four', 'one', 'three', 'UL', '* one\n* two\n* three\n\n1. four', '* one\n* two\n* three\n3. four'],
        ['X18', 'one\n\ntwo\n\n* three', 'one', 'two', 'UL', '* one\n* two\n* three', '* one\n* two\n* three'],
        ['X19', 'zero\n\n- one\n\n- two', 'zero', null, 'UL', '- zero\n\n- one\n\n- two', '- zero\n\n- one\n\n- two'],
        ['X20', '1. one\n\ntwo\n\nthree\n\n1) four', 'two', 'three', 'OL', '1. one\n2. two\n3. three\n\n1) four', '1. one\n2. two\n3. three\n\n1) four'],
        ['X21', '- zero\n\none\n\ntwo\n\n1) three', 'zero', 'two', 'OL', '1) zero\n2) one\n3) two\n4) three', '1) zero\n2) one\n3) two\n1) three'],
        ['X22', '1. zero\n\none\n\ntwo\n\n* three', 'zero', 'two', 'UL', '* zero\n* one\n* two\n* three', '* zero\n* one\n* two\n* three'],
        ['X26', 'one\n\n1. - aa\n2. bb', 'aa', null, 'OL', 'one\n\n1. aa\n2. bb', 'one\n\n1. aa\n2. bb'],
        ['X27', 'one\n\n1. > qq\n2. bb', 'qq', null, 'OL', 'one\n\n1. qq\n2. bb', 'one\n\n1. qq\n2. bb'],
        ['X28', '# head\n\n3. - aa\n4. bb', 'aa', null, 'OL', '# head\n\n3. aa\n4. bb', '# head\n\n3. aa\n4. bb'],
        ['X29', 'one\n\n- 1. aa\n- bb', 'aa', null, 'UL', 'one\n\n- aa\n- bb', 'one\n\n- aa\n- bb'],
        ['X30', 'para\n\n* > qq\n* bb', 'para', 'qq', 'UL', '* para\n* qq\n* bb', '* para\n* qq\n* bb'],
        ['X31', 'one\n\n1) - aa\n2) bb', 'one', 'aa', 'OL', '1) one\n2) aa\n3) bb', '1) one\n2) aa\n2) bb'],
        ['X32', '+ > qq\n\n- bb', 'qq', null, 'UL', '- qq\n- bb', '- qq\n- bb'],
        ['X33', '* one\n* two\n\n+ 1. aa\n+ bb', 'aa', null, 'UL', '* one\n* two\n* aa\n\n+ bb', '* one\n* two\n* aa\n+ bb'],
        ['S1', '- one\n  - inner\n- three', 'inner', null, 'UL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
        ['S1', '- one\n  - inner\n- three', 'inner', null, 'OL', '- one\n\n1. inner\n\n- three', '- one\n1. inner\n- three'],
        ['S2', '- one\n  - inner\n- three', 'one', null, 'UL', 'one\n\n- - inner\n- three', 'one\n- - inner\n- three'],
        ['S2', '- one\n  - inner\n- three', 'one', null, 'OL', '1. one\n\n- - inner\n- three', '1. one\n- - inner\n- three'],
        ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'UL', 'one\n\ninner\n\n- three', 'one\n\ninner\n\n- three'],
        ['S3', '- one\n  - inner\n- three', 'one', 'inner', 'OL', '1. one\n2. inner\n\n- three', '1. one\n2. inner\n- three'],
        ['S4', '- one\n  1. inner\n- three', 'inner', null, 'UL', '- one\n- inner\n- three', '- one\n- inner\n- three'],
        ['S4', '- one\n  1. inner\n- three', 'inner', null, 'OL', '- one\n\ninner\n\n- three', '- one\n\ninner\n\n- three'],
        ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'UL', '- one\n\na\n\n- - b\n- three', '- one\n\na\n\n- - b\n- three'],
        ['S5', '- one\n  - a\n  - b\n- three', 'a', null, 'OL', '- one\n\n1. a\n\n- - b\n- three', '- one\n1. a\n- - b\n- three'],
        ['L1', '- one\n\n- two\n\n- three', 'two', null, 'UL', '- one\n\ntwo\n\n- three', '- one\n\ntwo\n\n- three'],
        ['L1', '- one\n\n- two\n\n- three', 'two', null, 'OL', '- one\n\n1. two\n\n- three', '- one\n\n1. two\n\n- three'],
        ['L2', '- one\n\n- two', 'one', 'two', 'UL', 'one\n\ntwo', 'one\n\ntwo'],
        ['L2', '- one\n\n- two', 'one', 'two', 'OL', '1. one\n2. two', '1. one\n2. two'],
        ['M2', '- one\n\n  second\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
        ['M2', '- one\n\n  second\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n- two', '- one\n\n1. second\n\n- two'],
        ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
        ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'OL', '1. one\n2. second\n\n- two', '1. one\n2. second\n\n- two'],
        ['M3', '- one\n\n  second\n\n- two', 'one', 'second', 'h2', '## one\n\n## second\n\n- two', '## one\n\n## second\n\n- two'],
        ['M4', '- one\n\n  second\n\n- two', 'second', 'two', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
        ['M4', '- one\n\n  second\n\n- two', 'second', 'two', 'OL', '- one\n\n1. second\n2. two', '- one\n\n1. second\n2. two'],
        ['M5', '- one\n\n  second\n\n- two', 'one', 'two', 'UL', '- one\n\n- second\n\n- two', '- one\n\n- second\n\n- two'],
        ['M5', '- one\n\n  second\n\n- two', 'one', 'two', 'OL', '1. one\n2. second\n3. two', '1. one\n2. second\n3. two'],
        ['M9', '1. one\n\n   second\n\n2. two', 'second', null, 'UL', '1. one\n\n- second\n\n1. two', '1. one\n\n- second\n\n2. two'],
        ['M9', '1. one\n\n   second\n\n2. two', 'second', null, 'OL', '1. one\n\n2. second\n\n3. two', '1. one\n\n2. second\n\n2. two'],
        ['M11', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'UL', '- one\n\n- quoted\n\n- two', '- one\n\n- quoted\n\n- two'],
        ['M11', '- one\n\n  > quoted\n\n- two', 'quoted', null, 'OL', '- one\n\n1. quoted\n\n- two', '- one\n\n1. quoted\n\n- two'],
        ['M16', '- # Foo\n- bar', 'Foo', null, 'UL', 'Foo\n\n- bar', 'Foo\n- bar'],
        ['M16', '- # Foo\n- bar', 'Foo', null, 'OL', '1. Foo\n\n- bar', '1. Foo\n- bar'],
        ['M19', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n- - inner\n\n  after\n\n- two', '- one\n\n- second\n\n- - inner\n\n  after\n\n- two'],
        ['M19', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n- - inner\n\n  after\n\n- two', '- one\n\n1. second\n\n- - inner\n\n  after\n\n- two'],
        ['M21', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'after', null, 'UL', '- one\n\n  second\n\n  - inner\n\n- after\n\n- two', '- one\n\n  second\n\n  - inner\n\n- after\n\n- two'],
        ['M21', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'after', null, 'OL', '- one\n\n  second\n\n  - inner\n\n1. after\n\n- two', '- one\n\n  second\n\n  - inner\n\n1. after\n\n- two'],
        ['M23', '- a\n  - b\n\n  c\n\n- d', 'c', null, 'UL', '- a\n  - b\n\n- c\n\n- d', '- a\n  - b\n\n- c\n\n- d'],
        ['M29', '9. one\n\n   second', 'second', null, 'OL', '9. one\n\n10. second', '9. one\n\n10. second'],
        ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\n- two\n|||\nRight\n:::', '::: columns\none\n- two\n|||\nRight\n:::'],
        ['C1', '::: columns\n- one\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n- two\n|||\nRight\n:::'],
        ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'UL', '::: columns\n- one\n\ntwo\n|||\nRight\n:::', '::: columns\n- one\n\ntwo\n\n|||\nRight\n:::'],
        ['C2', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', null, 'OL', '::: columns\n- one\n\n1. two\n|||\nRight\n:::', '::: columns\n- one\n1. two\n|||\nRight\n:::'],
        ['C4', '::: columns\none\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\n- one\n|||\nRight\n:::', '::: columns\n- one\n|||\nRight\n:::'],
        ['C4', '::: columns\none\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n|||\nRight\n:::', '::: columns\n1. one\n|||\nRight\n:::'],
        ['Z1', '- one\n-\n- three', 'one', null, 'UL', 'one\n\n-\n- three', 'one\n\n-\n- three'],
        ['Z1', '- one\n-\n- three', 'one', null, 'OL', '1. one\n\n-\n- three', '1. one\n-\n- three'],
        // A tab in an item's text is content: both surfaces keep it.
        ['E19', '- one\ttab\n- z', 'one', null, 'h2', '## one\ttab\n\n- z', '## one\ttab\n- z'],
        // A tab in a code span is content too.
        ['E37', '- a `x\ty`\n- z', 'a', null, 'h2', '## a `x\ty`\n\n- z', '## a `x\ty`\n- z'],
        // A code block made from a heading holds the heading's text as the heading's own line holds it: none of the
        // escapes a paragraph's line needs at its start, and the escape of a last `#` run, which the line needs.
        ['E41', '### +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['E41', '# alpha \\#', 'alpha', null, 'code', '```\nalpha \\#\n```', '```\nalpha \\#\n```'],
        ['H1', '### #alpha', 'alpha', null, 'code', '```\n#alpha\n```', '```\n#alpha\n```'],
        ['H2', '### > alpha', 'alpha', null, 'code', '```\n> alpha\n```', '```\n> alpha\n```'],
        ['H3', '### - alpha', 'alpha', null, 'code', '```\n- alpha\n```', '```\n- alpha\n```'],
        ['H4', '### =alpha', 'alpha', null, 'code', '```\n=alpha\n```', '```\n=alpha\n```'],
        ['H5', '### |alpha', 'alpha', null, 'code', '```\n|alpha\n```', '```\n|alpha\n```'],
        ['H6', '### :alpha', 'alpha', null, 'code', '```\n:alpha\n```', '```\n:alpha\n```'],
        ['H7', '### 1. alpha', 'alpha', null, 'code', '```\n1. alpha\n```', '```\n1. alpha\n```'],
        ['H8', '### 1) alpha', 'alpha', null, 'code', '```\n1) alpha\n```', '```\n1) alpha\n```'],
        ['H9', '### <div> alpha', 'alpha', null, 'code', '```\n<div> alpha\n```', '```\n<div> alpha\n```'],
        ['H10', '# +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['H11', '## +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['H12', '### alpha \\##', 'alpha', null, 'code', '```\nalpha \\##\n```', '```\nalpha \\##\n```'],
        ['H13', '## +**bold** alpha', 'alpha', null, 'code', '```\n+**bold** alpha\n```', '```\n+**bold** alpha\n```'],
        ['H14', '### *alpha* \\#', 'alpha', null, 'code', '```\n*alpha* \\#\n```', '```\n*alpha* \\#\n```'],
        ['H15', '### +[alpha](/u)', 'alpha', null, 'code', '```\n+[alpha](/u)\n```', '```\n+[alpha](/u)\n```'],
        ['H16', '::: columns\n### +one\n|||\nRight\n:::', 'one', null, 'code', '::: columns\n```\n+one\n```\n|||\nRight\n:::', '::: columns\n```\n+one\n```\n|||\nRight\n:::'],
        // An escape the block's own Markdown holds stays: a `*` that can pair, a setext heading's lines, which
        // are a paragraph's lines, and a paragraph, a quote and a list item's text.
        ['H17', '### \\*alpha\\*', 'alpha', null, 'code', '```\n\\*alpha\\*\n```', '```\n\\*alpha\\*\n```'],
        ['H18', '## **bold** +alpha', 'alpha', null, 'code', '```\n**bold** +alpha\n```', '```\n**bold** +alpha\n```'],
        ['H19', '\\+one\nmore\n---', 'one', null, 'code', '```\n\\+one\nmore\n```', '```\n\\+one\nmore\n```'],
        ['H20', '\\- alpha', 'alpha', null, 'code', '```\n\\- alpha\n```', '```\n\\- alpha\n```'],
        ['H21', '> \\- alpha', 'alpha', null, 'code', '```\n\\- alpha\n```', '```\n\\- alpha\n```'],
        ['H22', '- \\- alpha', 'alpha', null, 'code', '```\n\\- alpha\n```', '```\n\\- alpha\n```'],
        // Text that would read as a character reference keeps its escaped `&` on both surfaces.
        ['CR1', '\\&copy; one & x', 'one', null, 'h2', '## \\&copy; one & x', '## \\&copy; one & x'],
        ['CR1', '\\&copy; one & x', 'one', null, 'quote', '> \\&copy; one & x', '> \\&copy; one & x'],
        ['CR1', '\\&copy; one & x', 'one', null, 'code', '```\n\\&copy; one & x\n```', '```\n\\&copy; one & x\n```'],
        ['CR1', '\\&copy; one & x', 'one', null, 'UL', '- \\&copy; one & x', '- \\&copy; one & x'],
    ];

    const DIFFERS: ParityRow[] = [
        ['Q1', '> - one\n> - two', 'one', null, 'UL', '- \\> - one\\\n  \\> - two', 'one\n> - two'],
        ['Q1', '> - one\n> - two', 'one', null, 'OL', '1. \\> - one\\\n   \\> - two', '1. one\n> - two'],
        ['Q2', '> - [ ] one\n> - [x] two', 'one', null, 'UL', '- \\> - \\[ \\] one\\\n  \\> - \\[x\\] two', '\\[ \\] one\n> - [x] two'],
        ['Q2', '> - [ ] one\n> - [x] two', 'one', null, 'OL', '1. \\> - \\[ \\] one\\\n   \\> - \\[x\\] two', '1. [ ] one\n> - [x] two'],
        ['E1', '- one\n  two\n- three', 'two', null, 'UL', 'one\ntwo\n\n- three', '- one\n- two\n- three'],
        ['E1', '- one\n  two\n- three', 'two', null, 'OL', '1. one\n   two\n\n- three', '- one\n1. two\n- three'],
        ['E2', 'one\ntwo', 'one', 'two', 'UL', '- one\n  two', '- one\n- two'],
        ['E2', 'one\ntwo', 'one', 'two', 'OL', '1. one\n   two', '1. one\n2. two'],
        ['E3', '```\none\n```\n\ntwo', 'one', null, 'UL', '- one\n\ntwo', '```\none\n```\n\ntwo'],
        ['E3', '```\none\n```\n\ntwo', 'one', null, 'OL', '1. one\n\ntwo', '```\none\n```\n\ntwo'],
        ['E4', '- one\n\n  second\n\n- two', 'second', null, 'paragraph', '- one\n\n  second\n\n- two', '- one\n\nsecond\n\n- two'],
        ['E4', '- one\n\n  second\n\n- two', 'second', null, 'h2', '- one\n\n  ## second\n\n- two', '- one\n\n## second\n\n- two'],
        ['E5', '- [ ] one\n- [x] two', 'one', 'two', 'code', '```\n[ ] one\n```\n\n```\n[x] two\n```', '```\n[ ] one\n[x] two\n```'],
        ['E6', '- one\n  - inner\n\n- three', 'three', null, 'UL', '- one\n\n  - inner\n\nthree', '- one\n  - inner\n\nthree'],
        ['E7', '- one\n  - inner\n\n  after\n\n- two', 'after', null, 'OL', '- one\n\n  - inner\n\n1. after\n\n- two', '- one\n  - inner\n\n1. after\n\n- two'],
        ['E8', '<div>x</div>\n\ntwo', 'x', null, 'UL', '- \\<div>x\\</div>\n\ntwo', '<div>x</div>\n\ntwo'],
        ['E9', 'one\n\n---\n\ntwo', 'one', 'two', 'UL', '- one\n- \\---\n- two', '- one\n\n---\n\n- two'],
        ['E10', '- one\n\n  ```\n  code\n  ```\n\n- two', 'code', null, 'UL', '- one\n\n- code\n\n- two', '- one\n\n  ```\n  code\n  ```\n\n- two'],
        ['E11', '- one\n\n  <div>x</div>\n\n- two', 'x', null, 'UL', '- one\n\n- \\<div>x\\</div>\n\n- two', '- one\n\n  <div>x</div>\n\n- two'],
        ['E12', '- # Foo\n- bar', 'Foo', null, 'paragraph', '- Foo\n- bar', 'Foo\n- bar'],
        ['E12', '- # Foo\n- bar', 'Foo', null, 'h2', '- ## Foo\n- bar', '## Foo\n- bar'],
        ['E13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'fenced', null, 'UL', '- one\n\n  ::: {align=center}\n  - fenced\n  :::\n\n- two', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two'],
        ['E13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'fenced', null, 'OL', '- one\n\n  ::: {align=center}\n  1. fenced\n  :::\n\n- two', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two'],
        ['E14', '::: columns\n- one\n- two\n|||\nRight\n:::', 'two', 'Right', 'UL', '::: columns\n- one\n- two\n|||\n- Right\n:::', '::: columns\n- one\n- two\n|||\nRight\n:::'],
        ['E15', '- one\n-\n- three', 'one', 'three', 'UL', 'one\n\nthree', 'one\n\n-\n\nthree'],
        ['E15', '- one\n-\n- three', 'one', 'three', 'OL', '1. one\n2.\n3. three', '1. one\n-\n1. three'],
        ['E16', 'one\\\ntwo', 'two', null, 'UL', '- one\\\n  two', 'one\\\ntwo'],
        ['E16', 'one\\\ntwo', 'one', 'two', 'OL', '1. one\\\n   two', 'one\\\ntwo'],
        ['E16', 'one\\\ntwo', 'one', 'two', 'h2', 'one\\\ntwo\n---', 'one\\\ntwo'],
        ['E17', '- one\\\n  two\n- three', 'one', 'three', 'UL', 'one\\\ntwo\n\nthree', '- one\\\n  two\n- three'],
        ['E19', '-\tone\n\n\tsecond\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- two', '-\tone\n\n\tsecond\n- two'],
        // The code block leaves the list on the WYSIWYG surface alone, as in the E24 rows; its tab is kept on both.
        ['E38', '- one\n\n  ```\n  a\tb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\na\tb\n```\n\n- two', 'one\n\n- ```\n  a\tb\n  ```\n\n- two'],
        // The source-mode lift rule is deferred: what a list item holds after its text leaves the list with the
        // text on the WYSIWYG surface, and stays in the list in source mode, in an item its marker re-opens. A
        // task item that holds such blocks, or a nested list, is left alone there. Each row below is a row the
        // two surfaces are to read alike once source mode lifts as the WYSIWYG surface does.
        ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'UL', '\\[ \\] one\n\n- - inner\n- three', '- [ ] one\n  - inner\n- three'],
        ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'OL', '1. [ ] one\n\n- - inner\n- three', '- [ ] one\n  - inner\n- three'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\nsecond\n\n- [x] two', '- [ ] one\n\n  second\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n   second\n\n- [x] two', '- [ ] one\n\n  second\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\nsecond\n\n- [x] two', '- [ ] one\n\n  second\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\nsecond\n\n- [x] two', '- [ ] one\n\n  second\n\n- [x] two'],
        ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'UL', '\\[x\\] one\n\n- - [ ] inner\n- two', '- [x] one\n  - [ ] inner\n- two'],
        ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'OL', '1. [x] one\n\n- - [ ] inner\n- two', '- [x] one\n  - [ ] inner\n- two'],
        ['X23', '* one\n\n* two\n\n  held\n\n1) three\n\nlast', 'two', null, 'OL', '* one\n\n1) two\n\n   held\n\n2) three\n\nlast', '* one\n\n1. two\n\n* held\n\n1) three\n\nlast'],
        ['X24', '1. one\n\n   held\n\n* two\n* three', 'one', null, 'UL', '* one\n\n  held\n\n* two\n\n* three', '- one\n\n1. held\n\n* two\n* three'],
        ['X25', 'zero\n\n1. one\n\n   held\n\n* two', 'zero', 'one', 'UL', '* zero\n\n* one\n\n  held\n\n* two', '- zero\n- one\n\n1. held\n\n* two'],
        ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'UL', '- o\n  - m\n\nx\n\n- - n\n  - y\n  - k', '- o\n  - m\n\nx\n\n- - - - n\n    - y\n  - k'],
        ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'OL', '- o\n  - m\n\n1. x\n\n- - n\n  - y\n  - k', '- o\n  - m\n1. x\n- - - - n\n    - y\n  - k'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- two', 'one\n\n- second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- two', '1. one\n\n- second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'paragraph', 'one\n\nsecond\n\n- two', 'one\n\n- second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- two', '## one\n\n- second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'quote', '> one\n\nsecond\n\n- two', '> one\n\n- second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'code', '```\none\n```\n\nsecond\n\n- two', '```\none\n```\n\n- second\n\n- two'],
        ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n  third\n\n- two', '- one\n\n- second\n\n- third\n\n- two'],
        ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n   third\n\n- two', '- one\n\n1. second\n\n- third\n\n- two'],
        ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\nthird\n\n- two', 'one\n\n- second\n\n  third\n\n- two'],
        ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n   third\n\n- two', '1. one\n\n- second\n\n  third\n\n- two'],
        ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'UL', '- one\n\n  second\n\n1. two', '- one\n\n1. second\n\n2. two'],
        ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'OL', 'one\n\nsecond\n\n1. two', 'one\n\n1. second\n\n2. two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'UL', 'one\n\n> quoted\n\n- two', 'one\n\n- > quoted\n\n- two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'OL', '1. one\n\n   > quoted\n\n- two', '1. one\n\n- > quoted\n\n- two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'h2', '## one\n\n> quoted\n\n- two', '## one\n\n- > quoted\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'UL', 'one\n\n| h |\n| --- |\n| c |\n\n- two', 'one\n\n- | h |\n  | --- |\n  | c |\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'OL', '1. one\n\n   | h |\n   | --- |\n   | c |\n\n- two', '1. one\n\n- | h |\n  | --- |\n  | c |\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'h2', '## one\n\n| h |\n| --- |\n| c |\n\n- two', '## one\n\n- | h |\n  | --- |\n  | c |\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n::: {align=center}\nfenced\n:::\n\n- two', 'one\n\n- ::: {align=center}\n  fenced\n  :::\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   ::: {align=center}\n   fenced\n   :::\n\n- two', '1. one\n\n- ::: {align=center}\n  fenced\n  :::\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'h2', '## one\n\n::: {align=center}\nfenced\n:::\n\n- two', '## one\n\n- ::: {align=center}\n  fenced\n  :::\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'UL', 'one\n\n<div>x</div>\n\n- two', 'one\n\n- <div>x</div>\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'OL', '1. one\n\n   <div>x</div>\n\n- two', '1. one\n\n- <div>x</div>\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'h2', '## one\n\n<div>x</div>\n\n- two', '## one\n\n- <div>x</div>\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\ncode\n```\n\n- two', 'one\n\n- ```\n  code\n  ```\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n   ```\n   code\n   ```\n\n- two', '1. one\n\n- ```\n  code\n  ```\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'h2', '## one\n\n```\ncode\n```\n\n- two', '## one\n\n- ```\n  code\n  ```\n\n- two'],
        ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'UL', 'Foo\n\npara\n\n- bar', 'Foo\n\n- para\n\n- bar'],
        ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'OL', '1. Foo\n\n   para\n\n- bar', '1. Foo\n\n- para\n\n- bar'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- - inner\n\n  after\n\n- two', 'one\n\n- second\n\n  - inner\n\n  after\n\n- two'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- - inner\n\n  after\n\n- two', '1. one\n\n- second\n\n  - inner\n\n  after\n\n- two'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- - inner\n\n  after\n\n- two', '## one\n\n- second\n\n  - inner\n\n  after\n\n- two'],
        ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'UL', '- one\n\n  second\n\ninner\n\nafter\n\n- two', '- one\n\n  second\n\ninner\n\n- after\n\n- two'],
        ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'OL', '- one\n\n  second\n\n1. inner\n\n   after\n\n- two', '- one\n\n  second\n\n1. inner\n\n- after\n\n- two'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'UL', '- a\n\nb\n\nc\n\n- d', '- a\n\nb\n\n- c\n\n- d'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'OL', '- a\n\n1. b\n\n   c\n\n- d', '- a\n1. b\n\n- c\n\n- d'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'h2', '- a\n\n## b\n\nc\n\n- d', '- a\n## b\n\n- c\n\n- d'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'UL', '- o\n\nx\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n\nx\n\n- - - n\n  - y\n\n  t\n\n- z'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n1. x\n- - - n\n  - y\n\n  t\n\n- z'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'h2', '- o\n\n## x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n## x\n- - - n\n  - y\n\n  t\n\n- z'],
        ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'UL', '- o\n\nx\n\np\n\n- - y\n- z', '- o\n\nx\n\n- - p\n\n  - y\n- z'],
        ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n   p\n\n- - y\n- z', '- o\n1. x\n\n- - p\n\n  - y\n- z'],
        ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n- two', 'one\n\n- > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two'],
        ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n- two', '1. one\n\n- > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two'],
        ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'UL', 'one\n\n---\n\n- two', '- one\n\n  ---\n\n- two'],
        ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'OL', '1. one\n\n   ---\n\n- two', '- one\n\n  ---\n\n- two'],
        ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'UL', '- one\n\n  second\n\n10. two', '- one\n\n10. second\n\n11. two'],
        ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'OL', 'one\n\nsecond\n\n10. two', 'one\n\n10. second\n\n11. two'],
        ['M30', '1. one\n   - two\n\n     held\n2. three', 'two', null, 'UL', '1. one\n\ntwo\n\nheld\n\n1. three', '1. one\n\ntwo\n\n1. - held\n2. three'],
        ['M30', '1. one\n   - two\n\n     held\n2. three', 'two', null, 'h2', '1. one\n\n## two\n\nheld\n\n1. three', '1. one\n## two\n\n1. - held\n2. three'],
        ['M31', '- one\n\n  ```\n  aa\n    \n  bb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\naa\n  \nbb\n```\n\n- two', 'one\n\n- ```\n  aa\n    \n  bb\n  ```\n\n- two'],
        ['M31', '- one\n\n  ```\n  aa\n    \n  bb\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n   ```\n   aa\n     \n   bb\n   ```\n\n- two', '1. one\n\n- ```\n  aa\n    \n  bb\n  ```\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n::: {align=center}\n- x\n:::\n\n- two', 'one\n\n- ::: {align=center}\n  - x\n  :::\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   ::: {align=center}\n   - x\n   :::\n\n- two', '1. one\n\n- ::: {align=center}\n  - x\n  :::\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'h2', '## one\n\n::: {align=center}\n- x\n:::\n\n- two', '## one\n\n- ::: {align=center}\n  - x\n  :::\n\n- two'],
        ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\nsecond\n\n- two\n|||\nRight\n:::', '::: columns\none\n\n- second\n\n- two\n|||\nRight\n:::'],
        ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n   second\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n\n- second\n\n- two\n|||\nRight\n:::'],
        // The deferral also leaves source mode doing nothing where what stays behind would not read as it did under
        // the re-opened marker. A task item's marker re-opens a plain item, so a block or nested item inside a task
        // item is left alone when more of that task item follows it — the item's own text is rows T9, T14 and T16.
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'UL', '- [x] alpha\n\nbeta\n\n- - gamma\n- delta', '- [x] alpha\n  - beta\n  - gamma\n- delta'],
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'OL', '- [x] alpha\n\n1. beta\n\n- - gamma\n- delta', '- [x] alpha\n  - beta\n  - gamma\n- delta'],
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'h2', '- [x] alpha\n\n## beta\n\n- - gamma\n- delta', '- [x] alpha\n  - beta\n  - gamma\n- delta'],
        ['T20', '- [x] alpha\n\n  beta\n\n  gamma\n- delta', 'beta', null, 'UL', '- [x] alpha\n\n- beta\n\n  gamma\n\n- delta', '- [x] alpha\n\n  beta\n\n  gamma\n- delta'],
        ['T20', '- [x] alpha\n\n  beta\n\n  gamma\n- delta', 'beta', null, 'OL', '- [x] alpha\n\n1. beta\n\n   gamma\n\n- delta', '- [x] alpha\n\n  beta\n\n  gamma\n- delta'],
        ['T20', '- [x] alpha\n\n  beta\n\n  gamma\n- delta', 'beta', null, 'h2', '- [x] alpha\n\n  ## beta\n\n  gamma\n\n- delta', '- [x] alpha\n\n  beta\n\n  gamma\n- delta'],
        ['T21', '- [ ] a\n  - b\n\n    held\n- c', 'b', null, 'UL', '- [ ] a\n\nb\n\nheld\n\n- c', '- [ ] a\n  - b\n\n    held\n- c'],
        ['T21', '- [ ] a\n  - b\n\n    held\n- c', 'b', null, 'h2', '- [ ] a\n\n## b\n\nheld\n\n- c', '- [ ] a\n  - b\n\n    held\n- c'],
        // `- ---` is a thematic break of its own, so a block right before a break written with the list's marker
        // character is left alone too (M27 is the item's own text). A break in another character, or a block between
        // the two, and source mode acts as in the rows above: M36, M37.
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'UL', '- one\n\n- para\n\n  ---\n\n- two', '- one\n\n  para\n\n  ---\n\n- two'],
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'OL', '- one\n\n1. para\n\n   ---\n\n- two', '- one\n\n  para\n\n  ---\n\n- two'],
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'h2', '- one\n\n  ## para\n\n  ---\n\n- two', '- one\n\n  para\n\n  ---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'UL', '- one\n\ninner\n\n---\n\n- two', '- one\n  - inner\n\n  ---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'OL', '- one\n\n1. inner\n\n   ---\n\n- two', '- one\n  - inner\n\n  ---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'h2', '- one\n\n## inner\n\n---\n\n- two', '- one\n  - inner\n\n  ---\n\n- two'],
        ['M35', '* one\n\n  ***\n\n* two', 'one', null, 'UL', 'one\n\n***\n\n* two', '* one\n\n  ***\n\n* two'],
        ['M35', '* one\n\n  ***\n\n* two', 'one', null, 'h2', '## one\n\n***\n\n* two', '* one\n\n  ***\n\n* two'],
        ['M36', '- one\n\n  ***\n\n- two', 'one', null, 'UL', 'one\n\n***\n\n- two', 'one\n\n- ***\n\n- two'],
        ['M37', '- one\n\n  mid\n\n  ---\n\n- two', 'one', null, 'UL', 'one\n\nmid\n\n---\n\n- two', 'one\n\n- mid\n\n  ---\n\n- two'],
        // The differences that stay. A heading type makes each line of a block a heading in source mode, and one
        // heading of several lines on the WYSIWYG surface.
        ['E20', 'one\nmore', 'one', 'more', 'h2', 'one\nmore\n---', '## one\n## more'],
        ['E21', 'one  \nmore\n\n- two', 'one', null, 'h2', 'one  \nmore\n---\n\n- two', '## one  \n## more\n\n- two'],
        // A list toggle on a heading written with a setext underline, the form a heading of several lines is saved in.
        ['E31', 'one\nmore\n---\n\npara', 'one', null, 'UL', '- one\n  more\n\npara', 'one\nmore\n---\n\npara'],
        ['E31', 'one\nmore\n---\n\npara', 'one', null, 'OL', '1. one\n   more\n\npara', 'one\nmore\n---\n\npara'],
        ['E36', 'Title\n=====\n\n- one', 'Title', null, 'UL', '- Title\n- one', 'Title\n=====\n\n- one'],
        // A list the WYSIWYG surface keeps as a raw Markdown block is one block there, and lines to source mode.
        ['E22', '* # alpha\n  1. beta\n* gamma', 'beta', null, 'UL', '- \\* # alpha\\\n  1\\. beta\\\n  \\* gamma', '* # alpha\n* beta\n* gamma'],
        ['E22', '* # alpha\n  1. beta\n* gamma', 'beta', null, 'OL', '1. \\* # alpha\\\n   1\\. beta\\\n   \\* gamma', '* # alpha\nbeta\n* gamma'],
        ['E23', '* # alpha\n  1. beta\n* gamma', 'gamma', null, 'UL', '- \\* # alpha\\\n  1\\. beta\\\n  \\* gamma', '* # alpha\n  1. beta\n\ngamma'],
        // Text the editor does not write itself, where source mode finds no form that reads back and does nothing.
        // A block or a nested list indented with a tab: the block itself, and a block before it in the item.
        ['E24', '- one\n\n\tsecond\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- two', '- one\n\n\tsecond\n- two'],
        ['E24', '- one\n\n\tsecond\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- two', '- one\n\n\tsecond\n- two'],
        ['E27', '- one\n\t- nested\n- two', 'one', null, 'UL', 'one\n\n- - nested\n- two', '- one\n\t- nested\n- two'],
        // Text opening with an unescaped `[ ] `, which a new item would read as a task marker (the editor writes
        // `\\[ \\]`), and the block before such text in a list item, which the item's marker would re-open as one.
        ['E28', '- aa\n- bb\n\n[ ] mid', 'mid', null, 'UL', '- aa\n- bb\n- \\[ \\] mid', '- aa\n- bb\n\n[ ] mid'],
        ['E28', '- aa\n- bb\n\n[ ] mid', 'mid', null, 'OL', '- aa\n- bb\n\n1. \\[ \\] mid', '- aa\n- bb\n\n[ ] mid'],
        ['E29', '> [ ] aa', 'aa', null, 'UL', '- \\[ \\] aa', '> [ ] aa'],
        ['E30', '- one\n\n  [ ] para\n- two', 'one', null, 'UL', 'one\n\n\\[ \\] para\n\n- two', '- one\n\n  [ ] para\n- two'],
        ['E30', '- one\n\n  [ ] para\n- two', 'one', null, 'h2', '## one\n\n\\[ \\] para\n\n- two', '- one\n\n  [ ] para\n- two'],
        // Lines that would read otherwise beside the result: a block indented below an empty item, a list whose
        // markers are indented, a raw block indented deeper than its item's content.
        ['E32', '2.\n\n   vebe\n\n   > lage', 'vebe', null, 'UL', '2.\n\n- vebe\n\n> lage', '2.\n\n   vebe\n\n   > lage'],
        ['E33', '  1. one\n\n     held\n\n  2. two', 'one', null, 'UL', '- one\n\n  held\n\n1. two', '  1. one\n\n     held\n\n  2. two'],
        ['E34', '- one\n\n    <div>x</div>\n\n- two', 'one', null, 'UL', 'one\n\n<div>x</div>\n\n- two', '- one\n\n    <div>x</div>\n\n- two'],
        // An item whose marker stands on a line of its own: source mode leaves the emptied marker as an empty item.
        ['E35', '-\n  one\n- two', 'one', null, 'UL', 'one\n\n- two', '-\none\n- two'],
    ];

    for (const row of SAME) {
        const [id, doc, from, to, command, wysiwyg, source] = row;

        it(`${id} ${command}: both surfaces leave a document the viewer reads the same`, () => {
            const loaded = editorOf(doc);

            expect(canonicalSave(loaded), 'the document is in the form the editor saves').toBe(doc);

            selectWords(loaded, from, to ?? from);

            expect(loaded.getSelectionState().canSetBlockType).toBe(true);

            const editor = wysiwygAfter(row);
            const value = editor.getValue();

            expect(value).toBe(wysiwyg);
            expect(value).not.toBe(doc);
            expect(editorOf(value).getValue()).toBe(value);
            expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);

            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

            expect(editor.getValue()).toBe(doc);
            expect(sourceAfter(row)).toBe(source);
            expect(viewerModel(source).blocks).toEqual(viewerModel(wysiwyg).blocks);
        });
    }

    for (const row of DIFFERS) {
        const [id, , , , command, wysiwyg, source] = row;

        it(`${id} ${command}: the surfaces differ here on purpose, each as pinned`, () => {
            const editor = wysiwygAfter(row);
            const value = editor.getValue();

            expect(value).toBe(wysiwyg);
            expect(editorOf(value).getValue()).toBe(value);
            expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);
            expect(sourceAfter(row)).toBe(source);
            // A row whose two results start reading alike is no difference any more: move it to SAME.
            expect(viewerModel(source).blocks).not.toEqual(viewerModel(wysiwyg).blocks);
        });
    }

    // A block or a nested list indented with a tab lifts in source mode as it lifts written with the spaces the tab
    // stands for. These two were `DIFFERS` rows while the tab kept the command from finding the block.
    it.each<[string, string, string, string]>([
        ['E25', '- one\n\n\tsecond\n- two', 'second', '- one\n\n- second\n- two'],
        ['E26', '- one\n\t- nested\n- two', 'nested', '- one\n\nnested\n\n- two'],
    ])('%s: source mode lifts the tab-indented block as it lifts its spaces form', (id, tabbed, text, expected) => {
        expect(sourceAfter([id, tabbed, text, null, 'UL', '', ''])).toBe(expected);
        expect(sourceAfter([id, expandPrefixTabs(tabbed).text, text, null, 'UL', '', ''])).toBe(expected);
    });

    // A list the WYSIWYG surface keeps as a raw Markdown block is no list there. These two documents still hold that
    // block after the command, which the editor shows as text and the viewer as a list, so they are no `DIFFERS` rows.
    it('a new item beside a list kept as a raw block joins that list in source mode alone', () => {
        const row: ParityRow = ['raw', '- ## Foo\n  - inner\n\npara', 'para', null, 'UL', '', ''];

        // On the WYSIWYG surface the item starts a list of its own, in the other bullet so that the two stay apart.
        expect(wysiwygAfter(row).getValue()).toBe('- ## Foo\n  - inner\n\n* para');
        expect(sourceAfter(row)).toBe('- ## Foo\n  - inner\n- para');
    });

    it('a list kept as a raw block leaves its item with the item\'s text on the WYSIWYG surface alone', () => {
        const row: ParityRow = ['raw', '1. one\n\n   - ## Foo\n     - inner\n\n2. two', 'one', null, 'OL', '', ''];

        expect(wysiwygAfter(row).getValue()).toBe('one\n\n- ## Foo\n  - inner\n\n1. two');
        // Source mode reads a nested list, which stays in the list, in an item the marker re-opens.
        expect(sourceAfter(row)).toBe('one\n\n1. - ## Foo\n     - inner\n\n2. two');
    });

    // A code block made from a block holds that block's text as the block's own Markdown writes it, on every route
    // `setBlockType("code")` takes. Source mode makes one code block of several blocks (row E5) and takes a block out
    // of its list item (row E12), so these two shapes are no parity rows.
    it('a code block made from each of several blocks holds each block\'s text as that block writes it', () => {
        const editor = editorOf('### +one\n\n\\- two');

        selectWords(editor, 'one', 'two');
        editor.setBlockType('code');

        const value = editor.getValue();

        expect(value).toBe('```\n+one\n```\n\n```\n\\- two\n```');
        expect(editorOf(value).getValue()).toBe(value);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);
    });

    it('a code block made from a heading a list item holds keeps the heading\'s text as its line holds it', () => {
        const editor = editorOf('- ### +one\n- two');

        selectWords(editor, 'one', 'one');
        editor.setBlockType('code');

        expect(editor.getValue()).toBe('- ```\n  +one\n  ```\n- two');
    });

    // A block made from a code block shows the code's text as it stands, so a heading made back from the code block
    // shows what the heading showed only where its line held no escape.
    it('a heading made back from a code block made from it shows the code block\'s text', () => {
        const cases: Array<[doc: string, back: MarkdownBlockType, code: string, after: string]> = [
            ['### +alpha', 'h3', '```\n+alpha\n```', '### +alpha'],
            ['# alpha \\#', 'h1', '```\nalpha \\#\n```', '# alpha \\\\#'],
        ];

        for (const [doc, back, code, after] of cases) {
            const editor = editorOf(doc);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType('code');

            expect(editor.getValue(), doc).toBe(code);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType(back);

            expect(editor.getValue(), doc).toBe(after);
        }
    });

    it('a block made from a code block shows the code\'s text as it stands, its save escaping what it must', () => {
        const cases: Array<[doc: string, type: MarkdownBlockType, after: string]> = [
            ['```\n\\+alpha\n```', 'paragraph', '\\\\+alpha'],
            ['```\n+alpha\n```', 'h3', '### +alpha'],
            ['```\n**b** alpha\n```', 'paragraph', '\\*\\*b\\*\\* alpha'],
        ];

        for (const [doc, type, after] of cases) {
            const editor = editorOf(doc);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType(type);

            expect(editor.getValue(), doc).toBe(after);
            expect(editorSurfaceModel(editor), doc).toEqual(viewerModel(after).blocks);
        }
    });
});

describe('MarkdownEditor clipboard commands', () => {
    afterEach(() => { vi.restoreAllMocks(); });

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

    it('cut() in a read-only editor writes nothing to the clipboard and removes nothing; copy() still copies', () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');
        editor.setReadOnly(true);

        editor.cut();

        expect(clipboardWrites()).toEqual([]);
        expect(editor.getValue()).toBe('hello world');

        editor.copy();

        expect(clipboardWrites()).toEqual(['world']);
    });

    it('paste() in a read-only editor resolves false without reading the clipboard, and inserts nothing', async () => {
        const editor = new MarkdownEditor();
        editor.setValue('hello world');
        selectWord(editor, 'world');
        editor.setReadOnly(true);

        const read = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        expect(await editor.paste()).toBe(false);
        expect(read).not.toHaveBeenCalled();
        expect(editor.getValue()).toBe('hello world');
    });

    it('cut() and paste() in a read-only editor on the source surface are refused by the source editor, with its rejection signal', async () => {
        // Every other command refused there is refused by the source editor, which flashes; these two are no different.
        const editor = new MarkdownEditor('hello world', { mode: 'source', readOnly: true });
        const dispatch = vi.fn();
        const rejected = vi.fn();
        const read = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: 'hello world', selection: { anchor: 0, head: 5 } }),
            dispatch, focus: vi.fn(),
        };
        codeEditorOf(editor).on('readonlyedit', rejected);

        editor.cut();

        expect(await editor.paste()).toBe(false);
        expect(rejected).toHaveBeenCalledTimes(2);
        expect(dispatch).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(clipboardWrites()).toEqual([]);
        expect(editor.getValue()).toBe('hello world');
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

    describe('focus and copy on a read-only editor leave the selection to the browser', () => {
        /** The selection's two points. */
        function pointsOf(editor: MarkdownEditor): number[] {
            return lexicalOf(editor).read(() => {
                const selection = $getSelection() as RangeSelection;

                return [selection.anchor.offset, selection.focus.offset];
            });
        }

        /** Spies on the surface's own `focus` and on Lexical's. */
        function focusSpies(editor: MarkdownEditor): { surface: MockInstance; lexical: MockInstance } {
            const surface = wysiwygOf(editor) as unknown as { focus(preventScroll?: boolean): unknown };

            return { surface: vi.spyOn(surface, 'focus'), lexical: vi.spyOn(lexicalOf(editor), 'focus') };
        }

        /** An editor holding `hello world` with the caret collapsed at `offset`. */
        function caretAt(markdown: string, offset: number): MarkdownEditor {
            const editor = new MarkdownEditor();

            editor.setValue(markdown);
            lexicalOf(editor).update(() => {
                const textNode = ($getRoot().getFirstChild() as ElementNode).getFirstChild() as TextNode;

                textNode.select(offset, offset);
            }, { discrete: true });

            return editor;
        }

        it('F1: focus() on a read-only editor focuses the surface itself, and Lexical sets no selection of its own', () => {
            const editor = caretAt('hello world', 8).setReadOnly(true);
            const spies = focusSpies(editor);

            editor.focus(true);

            expect(spies.surface).toHaveBeenCalledOnce();
            expect(spies.surface).toHaveBeenCalledWith(true);
            expect(spies.lexical).not.toHaveBeenCalled();
        });

        it('F2: focus() on an editable editor is Lexical\'s own, as before', () => {
            const editor = caretAt('hello world', 8);
            const spies = focusSpies(editor);

            editor.focus();

            expect(spies.lexical).toHaveBeenCalledOnce();
            expect(spies.surface).not.toHaveBeenCalled();
        });

        it('F3: focus() in source mode goes to the source editor, read-only or not', () => {
            const editor = new MarkdownEditor('hello', { mode: 'source', readOnly: true });
            const focusSpy = vi.spyOn(codeEditorOf(editor), 'focus');

            editor.focus(true);

            expect(focusSpy).toHaveBeenCalledOnce();
            expect(focusSpy).toHaveBeenCalledWith(true);
        });

        it('F4: copy() at a caret in a read-only editor copies the word without selecting it, in no Lexical update', () => {
            const editor = caretAt('hello world', 8).setReadOnly(true);
            const spies = focusSpies(editor);
            const update = vi.spyOn(lexicalOf(editor), 'update');

            editor.copy();

            expect(clipboardWrites()).toEqual(['world']);
            expect(pointsOf(editor)).toEqual([8, 8]);
            expect(update).not.toHaveBeenCalled();
            expect(spies.surface).toHaveBeenCalledOnce();
            expect(spies.lexical).not.toHaveBeenCalled();
        });

        it('F5: copy() of a selection in a read-only editor copies it and hands focus back to the surface', () => {
            const editor = new MarkdownEditor();

            editor.setValue('hello world');
            selectWord(editor, 'world');
            editor.setReadOnly(true);

            const spies = focusSpies(editor);

            editor.copy();

            expect(clipboardWrites()).toEqual(['world']);
            expect(pointsOf(editor)).toEqual([6, 11]);
            expect(spies.surface).toHaveBeenCalledOnce();
            expect(spies.lexical).not.toHaveBeenCalled();
        });

        it('F6: copy() at a caret in an editable editor selects the word it copies, as before', () => {
            const editor = caretAt('hello world', 8);

            editor.copy();

            expect(clipboardWrites()).toEqual(['world']);
            expect(pointsOf(editor)).toEqual([6, 11]);
        });

        it('F7: copy() at a caret with no word beside it writes nothing, read-only or not', () => {
            const editor = caretAt('a , b', 2).setReadOnly(true);
            const spies = focusSpies(editor);

            editor.copy();

            expect(clipboardWrites()).toEqual([]);
            expect(pointsOf(editor)).toEqual([2, 2]);
            expect(spies.surface).not.toHaveBeenCalled();
        });

        it('F8: copy() in a read-only editor copies a table with the selection that runs into it, as in an editable one', () => {
            const markdown = 'before\n\n| a | b |\n| - | - |\n| c | d |';
            const copied = [false, true].map((readOnly) => {
                const editor = new MarkdownEditor();

                editor.setValue(markdown);
                lexicalOf(editor).update(() => {
                    const texts = $getRoot().getAllTextNodes();
                    const selection = $createRangeSelection();

                    selection.anchor.set(texts[0].getKey(), 2, 'text');
                    selection.focus.set(texts[1].getKey(), 1, 'text');
                    $setSelection(selection);
                }, { discrete: true });
                editor.setReadOnly(readOnly);
                editor.copy();

                return clipboardWrites().at(-1);
            });

            expect(copied[1]).toBe(copied[0]);
            expect(copied[1]).toContain('d');
        });
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

// A quote or list a list item holds as a raw Markdown block shows and saves its tabs. The lexer reads the lines with the
// tabs of their prefixes as the spaces they stand for, so these rows would show spaces and save them once the item was
// edited elsewhere if the tokens did not keep their source. R1 keeps the block's two columns of indentation next to the
// item's own, because a dedent that moves a line with a prefix tab is refused.
describe('MarkdownEditor raw blocks in a list item keep their tabs', () => {
    it.each<[string, string, string]>([
        ['R1: a quote after a blank line, a tab before and after its marker', '- a\n\n\t>\t# h', '- **a**\n\n    >\t# h'],
        ['R2: a quote in a quote, a tab after the inner marker', '- a\n\n  > > q\n  > >\tr **b**', '- **a**\n\n  > > q\n  > >\tr **b**'],
    ])('%s: bolding the item\'s text saves the block as written', (_title, source, saved) => {
        const editor = new MarkdownEditor();

        editor.setValue(source);
        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().find((node) => node.getTextContent() === source.match(/[a-z]/)![0])!.select(0, 1);
        }, { discrete: true });
        editor.toggleBold();

        expect(editor.getValue()).toBe(saved);
    });
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
            canFormat: true, canStyle: true, canLink: true, canRemoveLink: false,
            canSetBlockType: true, canSetBlockLayout: false, canInsertTable: true, canInsertImage: true,
            canEditTable: false, canMergeCells: false, canUnmergeCell: false,
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
            canFormat: true, canStyle: true, canLink: true, canRemoveLink: false,
            canSetBlockType: true, canSetBlockLayout: false, canInsertTable: true, canInsertImage: true,
            canEditTable: false, canMergeCells: false, canUnmergeCell: false,
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

    it('a caret move that changes nothing tracked reports nothing, from the first one on', () => {
        // The state the source surface reports from the start is the one compared against. It used
        // to be the WYSIWYG neutral state, whose `can…` fields the source surface never reports, so
        // the first caret move in an editor built in source mode always reported, changed or not.
        const editor = new MarkdownEditor('hi there', { mode: 'source' });
        const start = EditorState.create({ doc: 'hi there', selection: { anchor: 0 } });
        const moved = EditorState.create({ doc: 'hi there', selection: { anchor: 2 } });
        const payloads: MarkdownEditorSelectionState[] = [];

        editor.on('selectionstate', (payload) => payloads.push(payload));

        codeEditorOf(editor)._view = { state: start };
        codeEditorOf(editor).onSelectionChange(start);
        codeEditorOf(editor)._view = { state: moved };
        codeEditorOf(editor).onSelectionChange(moved);

        expect(payloads).toEqual([]);
    });

    it('the first switch to WYSIWYG of an editor built in source mode reports once, with the WYSIWYG surface already showing', () => {
        // That switch is what builds the Lexical editor, and the build reports the state itself. The
        // document ends in a code block, so the build has something to report: both inserts off.
        const editor = new MarkdownEditor('para\n\n```\ncode\n```', { mode: 'source' });
        const card = (editor as unknown as { _card: { getVisibleComponentId(): string | null } })._card;
        const seen: Array<[boolean, boolean, boolean]> = [];

        editor.on('selectionstate', (state) => {
            seen.push([card.getVisibleComponentId() === wysiwygOf(editor).getId(), state.canFormat, state.canInsertTable]);
        });

        editor.setMode('wysiwyg');

        expect(seen).toEqual([[true, false, false]]);
    });

    it('the first switch to WYSIWYG reports the document it loads alone, not the one the editor was constructed with', () => {
        // A source view not mounted yet takes setValue() without reporting a change, so the value the
        // Lexical editor would be built from is still the constructor's. That one ends in a code block,
        // where both inserts are off; the document the switch loads leaves them on.
        const editor = new MarkdownEditor('para\n\n```\ncode\n```', { mode: 'source' });
        const seen: Array<[boolean, boolean]> = [];

        editor.setValue('hello');
        editor.on('selectionstate', (state) => seen.push([state.canInsertTable, state.canInsertImage]));
        editor.setMode('wysiwyg');

        expect(editor.getValue()).toBe('hello');
        expect(seen).toEqual([[true, true]]);
    });

    it('a switch to source of an editor whose source view is mounted reports once, with the source surface already showing', () => {
        // A mounted source view applies the loaded document at once and reports the change before
        // setValue returns, as CodeMirror's does, and that report refreshes the selection state.
        const editor = new MarkdownEditor('**hi** there');
        editor.setValue('**hi** there');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const card = (editor as unknown as { _card: { getVisibleComponentId(): string | null } })._card;
        const seen: boolean[] = [];

        codeEditorOf(editor)._view = {
            state:    EditorState.create({ doc: '**hi** there' }),
            dispatch: () => codeEditorOf(editor).onDocChange('**hi** there'),
        };
        editor.on('selectionstate', () => seen.push(card.getVisibleComponentId() === codeEditorOf(editor).getId()));

        editor.setMode('source');

        expect(seen).toEqual([true]);
    });

    it('a read-only editor reports no command available on the source surface either', () => {
        const editor = new MarkdownEditor('[hi](https://x) there', { mode: 'source', readOnly: true });
        codeEditorOf(editor)._view = {
            state: EditorState.create({ doc: '[hi](https://x) there', selection: { anchor: 1, head: 3 } }),
        };

        const state = editor.getSelectionState();
        const available = Object.entries(state).filter(([field, value]) => field.startsWith('can') && value !== false);

        expect(state.linkUrl).toBe('https://x');
        expect(available).toEqual([]);
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

        // An unedited document saves as loaded (plan markdown-editor-source-preservation, P1), so the
        // switch's own save cannot fail here: the importer must read what source mode wrote as the viewer
        // does, and the standard form — what an edited block saves as — must write it back.
        for (const doc of ['**hello** world', '++hello++ world', '## hello', '- a\n- b', tableSkeleton]) {
            const editor = new MarkdownEditor(doc, { mode: 'source' });

            editor.setMode('wysiwyg');

            expect(editorSurfaceModel(editor), doc).toEqual(viewerModel(doc).blocks);
            expect(normalize(canonicalSave(editor)), doc).toBe(normalize(doc));
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
        // An unedited document saves as loaded (plan markdown-editor-source-preservation, P1), so the switch's own
        // save cannot fail here: the importer must read each document as the viewer does, and the standard form
        // — what an edited block saves as — must write it byte for byte, since source mode writes colour on a
        // whole bold run inside it, the form the serializer writes too (plan markdown-editor-serializer, S19).
        const documents = [
            '[hello]{color=#cc0000} world',
            '[hello]{color=#cc0000 size=1.2em} world',
            '[hello]{font="Georgia, serif"} world',
            'a **[hello]{color=#cc0000}** b',
            '**hello [world]{color=#cc0000}**',
            '[hello ]{size=1.2em}[world]{color=#2563eb size=1.2em}',
        ];

        for (const doc of documents) {
            const editor = new MarkdownEditor(doc, { mode: 'source' });

            editor.setMode('wysiwyg');

            expect(editorSurfaceModel(editor), doc).toEqual(viewerModel(doc).blocks);
            expect(canonicalSave(editor), doc).toBe(doc);
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
            name: 'a new item written against a tight list takes every blank line between them', doc: '- one\n- two\n\n\n\nthree', select: [16, 16],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n- two\n- three',
        },
        {
            name: 'a list toggle declines over a tab-indented block of the item', doc: '- one\n\n\tsecond\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n\n\tsecond\n- two',
        },
        {
            name: 'a task marker stays with the first line of its item\'s text', doc: '- [ ] one\n  more\n- two', select: [13, 13],
            run: (editor) => editor.toggleOrderedList(), result: '- [ ] one\n1. more\n- two',
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

    // `b` is a paragraph after the quote: a fence closed inside a nested quote ends the lines the quote takes.
    it('a heading acts on the line after a fence closed inside a nested quote', () => {
        const doc = '> > ```\n> > a\n> > ```\nb';
        const editor = new MarkdownEditor(doc, { mode: 'source' });

        injectLiveSourceView(editor, doc, doc.length, doc.length);
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe('> > ```\n> > a\n> > ```\n## b');
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

    it('keeps a table authored without leading/trailing pipes as written', () => {
        // An unedited document saves as loaded (plan markdown-editor-source-preservation, P1).
        const editor = new MarkdownEditor();
        editor.setValue('a | b\n--- | ---\n1 | 2');

        expect(editor.getValue()).toBe('a | b\n--- | ---\n1 | 2');
    });

    it('absorbs a following non-blank prose line as an extra row, matching marked', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |\ntrailing prose');

        const lines = normalize(editor.getValue()).split('\n');

        expect(lines).toHaveLength(4);   // header, delimiter, and two body rows
        // An unedited document saves as loaded (plan markdown-editor-source-preservation, P1).
        expect(lines[3]).toBe('trailing prose');
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

        // An unedited document saves as loaded (plan markdown-editor-source-preservation, P1).
        const value = editor.getValue();
        expect(value).toBe('::: {columns=2}\ntext\n:::');

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
            underline: false, hasEnclosingBlock: false, linkUrl: null, availability: NO_SELECTION,
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
            // The selected text is bold, so there is a format to clear.
            availability: { ...IN_PROSE, canClearFormatting: true },
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
            const outerItem = outerList.getFirstChild() as ElementNode;
            // The outer item holds its text, then the nested list; an item's text is a node of its own.
            const innerList = outerItem.getChildAtIndex(1) as ElementNode;
            const innerFirstItem = innerList.getFirstChild() as ElementNode;
            const textNode = (innerFirstItem.getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

            return $classifyContextMenuTarget(textNode);
        });

        expect(result.kind).toBe('text');
        expect((result as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
    });

    it('classifies the empty text of a list item as "text", as a list item\'s text is: only a paragraph of its own is an empty line', () => {
        const editor = new MarkdownEditor();
        editor.setValue('- one\n-\n- three');

        const result = lexicalOf(editor).read(() => {
            const list = $getRoot().getFirstChild() as ElementNode;
            const emptyItem = list.getChildAtIndex(1) as ElementNode;

            return $classifyContextMenuTarget(emptyItem.getFirstChild() as LexicalNode);
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

        expect(result).toEqual({ kind: 'empty-line', hasSelectedText: false, availability: NO_SELECTION });
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
            // No selection, and the document ends in a cell, where a table inserted at its end would nest.
            availability: { ...NO_SELECTION, canInsertTable: false },
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
            // The caret is in the cell, where the block conversions and a nested table decline, and the
            // table commands and a line around the table apply. The cell is empty: there is no text to link.
            availability: availabilityOf(
                'canFormat', 'canStyle', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertImage', 'canEditTable',
            ),
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
            // The selection covers the table's cells, where the block conversions and a nested table decline;
            // it is a range anchored in a cell, so the table commands apply, and its text is bold.
            availability: availabilityOf(
                'canFormat', 'canStyle', 'canLink', 'canClearFormatting', 'canSetBlockLayout', 'canInsertParagraphAroundBlock',
                'canInsertImage', 'canEditTable',
            ),
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
        canFormat: false, canStyle: false, canLink: false, canRemoveLink: false,
        canSetBlockType: false, canSetBlockLayout: false, canInsertTable: true, canInsertImage: true,
        canEditTable: false, canMergeCells: false, canUnmergeCell: false,
        inTable: false, tableColumnAlignment: null, blockAlignment: null, columnCount: 1,
    };

    /** What a range selection in ordinary prose adds to `NEUTRAL`: the commands that need one apply. */
    const IN_PROSE = { canFormat: true, canStyle: true, canLink: true, canSetBlockType: true, canSetBlockLayout: true };

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
        expect(insideRun).toEqual({ ...NEUTRAL, ...IN_PROSE, bold: true, hasSelectedText: true });

        selectStart(editor);   // collapsed at the very start of the bold run
        expect(editor.getSelectionState()).toEqual({ ...NEUTRAL, ...IN_PROSE, bold: true, hasSelectedText: true });
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

    it('reports the fields read off a range at their defaults for a multi-cell TableSelection, which carries no RangeSelection anchor', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getChildAtIndex(1) as TableRowNode;
            const cellA = row.getChildAtIndex(0) as TableCellNode;
            const cellB = row.getChildAtIndex(1) as TableCellNode;

            $setSelection($createTableSelectionFrom(table, cellA, cellB));
        }, { discrete: true });

        // The format toggles apply to the selected cells, which can be merged; the document ends in a cell, where a table would nest.
        expect(editor.getSelectionState()).toEqual({ ...NEUTRAL, canFormat: true, canInsertTable: false, canMergeCells: true });
    });

    it('a selection running out of the table it is anchored in is in no table: inTable, the column alignment and the table commands are off', () => {
        // The table commands act on one table, so a range that leaves its table has none, whichever way
        // it was made; a range that stays inside the table still has one.
        const DOC = 'para\n\n| a | b |\n| :---: | --- |\n| c | d |';
        const showing = (text: string): TextNode => $getRoot().getAllTextNodes().find((node) => node.getTextContent() === text)!;
        const tableFields = (from: string, to: string): unknown[] => {
            const editor = new MarkdownEditor();

            editor.setValue(DOC);
            lexicalOf(editor).update(() => {
                const selection = showing(from).select(1, 1);

                selection.focus.set(showing(to).getKey(), 1, 'text');
            }, { discrete: true });

            const state = editor.getSelectionState();

            return [state.inTable, state.tableColumnAlignment, state.canEditTable, state.canMergeCells, state.canUnmergeCell];
        };

        expect(tableFields('c', 'para')).toEqual([false, null, false, false, false]);
        expect(tableFields('para', 'c')).toEqual([false, null, false, false, false]);
        expect(tableFields('c', 'a')).toEqual([true, 'center', true, false, false]);
    });

    it('the table fields follow the selection: a caret in a cell, a caret in a merged cell, cells selected', () => {
        const editor = new MarkdownEditor();
        const tableFields = (): boolean[] => {
            const state = editor.getSelectionState();

            return [state.canEditTable, state.canMergeCells, state.canUnmergeCell];
        };

        editor.setValue('| a | b |\n| --- | --- |\n| c | << |\n| e | f |');
        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'e')!.select(1, 1);
        }, { discrete: true });

        expect(tableFields()).toEqual([true, false, false]);

        lexicalOf(editor).update(() => {
            $getRoot().getAllTextNodes().find((node) => node.getTextContent() === 'c')!.select(1, 1);
        }, { discrete: true });

        expect(tableFields()).toEqual([true, false, true]);

        lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const row = table.getLastChild() as TableRowNode;

            $setSelection($createTableSelectionFrom(table, row.getFirstChild() as TableCellNode, row.getLastChild() as TableCellNode));
        }, { discrete: true });

        expect(tableFields()).toEqual([false, true, false]);
    });

    it('fires when a table field alone changes: from two cells selected to one', () => {
        const editor = new MarkdownEditor();
        editor.setValue('| a | b |\n| --- | --- |\n| c | d |');

        /** Selects the last row's cells from the first to the one at `lastIndex`. */
        const selectCells = (lastIndex: number): void => lexicalOf(editor).update(() => {
            const table = $getRoot().getFirstChild() as TableNode;
            const cells = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, cells[0]!, cells[lastIndex]!));
        }, { discrete: true });

        selectCells(1);

        const reported: boolean[] = [];
        editor.on('selectionstate', (state) => reported.push(state.canMergeCells));

        selectCells(0);

        expect(reported).toEqual([false]);
    });

    it('setValue on an editor not built yet reports the state of the document it loads, never that of the one it replaces', () => {
        // The first setValue builds the editor with the document it was constructed with, then loads the
        // new one. Only the loaded document's state is news to a listener.
        const CODE_AT_END = 'para\n\n```\ncode\n```';
        const insertsReportedBy = (initial: string, loaded: string): boolean[][] => {
            const editor = new MarkdownEditor(initial);
            const reported: boolean[][] = [];

            editor.on('selectionstate', (state) => reported.push([state.canInsertTable, state.canInsertImage]));
            editor.setValue(loaded);

            return reported;
        };

        expect(insertsReportedBy(CODE_AT_END, 'hello')).toEqual([]);
        expect(insertsReportedBy('hello', CODE_AT_END)).toEqual([[false, false]]);
        expect(insertsReportedBy(CODE_AT_END, `more\n\n${CODE_AT_END}`)).toEqual([[false, false]]);
    });

    it('building the editor reports the insert fields a document ending in a code block turns off', () => {
        // Before the editor is built nothing is known of the document's end, so the neutral state
        // offers both inserts; with no selection they would go in at the end, inside the code block.
        const editor = new MarkdownEditor('para\n\n```\ncode\n```');
        const reported: boolean[][] = [];

        editor.on('selectionstate', (state) => reported.push([state.canInsertTable, state.canInsertImage]));

        expect(editor.getSelectionState()).toEqual(NEUTRAL);

        (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

        expect(reported).toEqual([[false, false]]);
        expect(editor.getSelectionState()).toEqual({ ...NEUTRAL, canInsertTable: false, canInsertImage: false });
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

        // toggleBold() formats in one discrete update, so the emit has happened before this call returns; the
        // await is harmless, kept from when the toggle went through a command whose update settled a microtask later.
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
            const outerItem = outerList.getFirstChild() as ElementNode;
            const innerList = outerItem.getChildAtIndex(1) as ElementNode;
            const innerFirstItem = innerList.getFirstChild() as ElementNode;

            innerFirstItem.selectEnd();
        }, { discrete: true });

        editor.insertParagraphAfterBlock();

        // Root-level structure is untouched — the new paragraph landed inside
        // the outer item, beside the inner list, not after the outer list.
        expect(childTypes(editor)).toEqual(['list']);

        const outerItemChildTypes = lexicalOf(editor).read(() => {
            const outerList = $getRoot().getFirstChild() as ElementNode;
            const outerItem = outerList.getFirstChild() as ElementNode;

            return outerItem.getChildren().map((node) => node.getType());
        });

        expect(outerItemChildTypes).toEqual(['markdown-list-item-text', 'list', 'paragraph']);
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

describe('MarkdownEditor context menu', () => {
    it('a "text" context builds a real checkbox row per format, reflecting each active state', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            kind: 'text', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });

        expect(items).toHaveLength(20);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Block style', '(separator)', 'Text style', 'Alignment', 'Columns', '(separator)', 'Clear formatting',
        ]);
    });

    it('a "text" context with hasEnclosingBlock builds 22 entries: the 19 (linkUrl: null) existing plus a separator and the two new items', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
        });

        expect(items).toHaveLength(22);
        expect(items.slice(19).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Insert line before block', 'Insert line after block',
        ]);
    });

    it('"Edit link…" and "Remove link" are enabled while every command is available, and replace "Insert link…", in both "text" and "table-cell" contexts', () => {
        const editor = new MarkdownEditor();

        for (const kind of ['text', 'table-cell'] as const) {
            for (const hasSelectedText of [true, false]) {
                const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                    kind, hasSelectedText, linkUrl: 'https://x', ...SOME_FORMATS, availability: ALL_AVAILABLE,
                });

                expect(findItem(items, 'Edit link…')?.enabled).toBe(true);
                expect(findItem(items, 'Remove link')?.enabled).toBe(true);
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
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability: ALL_AVAILABLE,
            });

            findItem(items, 'Insert link…')?.action?.();

            expect(spy).toHaveBeenCalledWith('Insert link', '');
        });

        it('the "Edit link…" item\'s action() forwards the clicked link\'s URL as the prompt default', () => {
            const editor = new MarkdownEditor();
            const spy = vi.spyOn(contextMenuMethodsOf(editor), 'promptAndApplyLink').mockResolvedValue(undefined);

            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: false, linkUrl: 'https://x', ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
                kind: 'text', hasSelectedText: true, linkUrl: 'https://x', ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            kind: 'text', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
        }).find((item) => item.text === 'Insert line before block')?.action?.();

        expect(lexicalOf(before).read(() => $getRoot().getChildren().map((n) => n.getType())))
            .toEqual(['paragraph', 'quote']);

        const after = new MarkdownEditor();
        after.setValue('> quoted');
        lexicalOf(after).update(() => { $getRoot().selectStart(); }, { discrete: true });

        contextMenuMethodsOf(after).buildContextMenuItems({
            kind: 'text', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
        }).find((item) => item.text === 'Insert line after block')?.action?.();

        expect(lexicalOf(after).read(() => $getRoot().getChildren().map((n) => n.getType())))
            .toEqual(['quote', 'paragraph']);
    });

    it('a "text" context offers an 11-item block-style submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const blockStyleItems = submenuItemsOf(findItem(items, 'Block style'));

        blockStyleItems?.find((item) => item.text === 'Quote')?.action?.();

        expect(lexMarkdown(editor.getValue()).some((token) => token.type === 'blockquote')).toBe(true);
    });

    it('the block-style submenu\'s Code block item makes a heading\'s text the code as the heading\'s line holds it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('### +alpha');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });

        submenuItemsOf(findItem(items, 'Block style'))?.find((item) => item.text === 'Code block')?.action?.();

        expect(editor.getValue()).toBe('```\n+alpha\n```');
    });

    it('the "Text style" submenu\'s Colour ▸ Red item reaches setTextColor, and Colour ▸ Default clears it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('word');
        selectStart(editor);

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            underline: false, availability: ALL_AVAILABLE,
        });

        rowOf(items[4]).activate();

        expect(editor.getValue()).toContain('**word**');
    });

    it('an "empty-line" context omits Paragraph and offers a 6-item Heading submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE });

        expect(findItem(items, 'Paragraph')).toBeUndefined();
        expect(submenuItemsOf(findItem(items, 'Heading'))).toHaveLength(6);
    });

    it('an "empty-line" context builds 7 entries: Cut/Copy/Paste, then Heading, Insert, and Columns', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE });

        expect(items).toHaveLength(7);
        expect(items.map((item) => item.text ?? '(separator)')).toEqual([
            'Cut', 'Copy', 'Paste', '(separator)',
            'Heading', 'Insert', 'Columns',
        ]);
    });

    it('an "empty-line" context\'s Insert submenu offers Quote, Code block, Bulleted list, Numbered list, Table, and Image…, in that order', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE });

        expect(submenuItemsOf(findItem(items, 'Insert'))?.map((item) => item.text ?? '(separator)')).toEqual([
            'Quote', 'Code block', 'Bulleted list', 'Numbered list', '(separator)', 'Table', 'Image…',
        ]);
    });

    it('a "table-cell" context with linkUrl: null returns 17 entries: Cut/Copy/Paste, 5 format rows, Insert link, Text style, Clear formatting, then a Table submenu', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability: ALL_AVAILABLE,
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
            kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
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
            kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
        }).find((item) => item.text === 'Insert line before block')?.action?.();

        expect(childTypes(before)).toEqual(['paragraph', 'table']);

        const after = new MarkdownEditor();
        after.setValue('| a | b |\n| --- | --- |\n| 1 | 2 |');
        selectStart(after);

        contextMenuMethodsOf(after).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
        }).find((item) => item.text === 'Insert line after block')?.action?.();

        expect(childTypes(after)).toEqual(['table', 'paragraph']);
    });

    it('a "table-cell" context with a linkUrl returns 18 entries: the same shape but Edit link + Remove link instead of Insert link', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });

        expect(items).toHaveLength(18);
        expect(items.slice(9).map((item) => item.text ?? '(separator)')).toEqual([
            '(separator)', 'Edit link…', 'Remove link', '(separator)', 'Text style', '(separator)', 'Clear formatting', '(separator)', 'Table',
        ]);
    });

    it('a "table-cell" context with both a linkUrl and hasEnclosingBlock combines all groups: link items, Text style, Clear formatting, the Table submenu, and the two block items, in that order', () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, linkUrl: 'https://example.com', ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE,
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
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        submenuItemsOf(findItem(tableItems ?? [], 'Delete'))?.find((item) => item.text === 'Table')?.action?.();

        const tokens = lexMarkdown(editor.getValue());
        expect(tokens.some((token) => token.type === 'mdtable')).toBe(false);
    });

    it("the table-cell menu's Table ▸ Align column submenu offers exactly Left, Center, Right, None, in that order", () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        expect(submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.map((item) => item.text)).toEqual([
            'Left', 'Center', 'Right', 'None',
        ]);
    });

    it('exactly one "Align column" item is checked, matching context.columnAlignment (or "None" when omitted)', () => {
        const editor = new MarkdownEditor();

        const rightChecked = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, columnAlignment: 'right', availability: ALL_AVAILABLE,
        });
        const rightTableItems = submenuItemsOf(findItem(rightChecked, 'Table'));
        const rightItems = submenuItemsOf(findItem(rightTableItems ?? [], 'Align column'));
        expect(rightItems?.map((item) => item.checked)).toEqual([false, false, true, false]);

        const omitted = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const omittedTableItems = submenuItemsOf(findItem(omitted, 'Table'));
        const omittedItems = submenuItemsOf(findItem(omittedTableItems ?? [], 'Align column'));
        expect(omittedItems?.map((item) => item.checked)).toEqual([false, false, false, true]);
    });

    it('each "Align column" item\'s action() reaches MarkdownEditor.setTableColumnAlignment with its own alignment', () => {
        const editor = new MarkdownEditor();
        editor.insertTable(2, 3);   // caret lands in the first header cell

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const tableItems = submenuItemsOf(findItem(items, 'Table'));

        submenuItemsOf(findItem(tableItems ?? [], 'Align column'))?.find((item) => item.text === 'Center')?.action?.();

        expect(normalize(editor.getValue()).split('\n')[1]).toBe('| :---: | --- | --- |');
    });

    it('"text" and "empty-line" contexts build no "Align column" item', () => {
        const editor = new MarkdownEditor();

        const textItems = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });
        const emptyLineItems = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE,
        });

        expect(findItem(textItems, 'Align column')).toBeUndefined();
        expect(findItem(emptyLineItems, 'Align column')).toBeUndefined();
    });

    it("the empty-line menu's Insert ▸ Table item reaches MarkdownEditor.insertTable(2, 3)", () => {
        const editor = new MarkdownEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE });

        submenuItemsOf(findItem(items, 'Insert'))?.find((item) => item.text === 'Table')?.action?.();

        const lines = normalize(editor.getValue()).split('\n');
        expect(lines).toHaveLength(3);   // header, delimiter, one body row
    });

    it("the empty-line menu's Insert ▸ Bulleted list / Numbered list items reach toggleUnorderedList / toggleOrderedList", () => {
        const bulleted = new MarkdownEditor();
        bulleted.setValue('word');
        selectStart(bulleted);
        const bulletedItems = contextMenuMethodsOf(bulleted).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false, availability: ALL_AVAILABLE });

        submenuItemsOf(findItem(bulletedItems, 'Insert'))?.find((item) => item.text === 'Bulleted list')?.action?.();

        expect(bulleted.getValue()).toContain('- word');

        const numbered = new MarkdownEditor();
        numbered.setValue('word');
        selectStart(numbered);
        const numberedItems = contextMenuMethodsOf(numbered).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false, availability: ALL_AVAILABLE });

        submenuItemsOf(findItem(numberedItems, 'Insert'))?.find((item) => item.text === 'Numbered list')?.action?.();

        expect(numbered.getValue()).toContain('1. word');
    });

    it('Cut and Copy carry enabled: hasSelectedText in all three contexts; Paste never sets enabled', () => {
        const editor = new MarkdownEditor();
        const contexts: ContextMenuTarget[] = [
            { kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE },
            { kind: 'text', hasSelectedText: false, ...SOME_FORMATS, availability: ALL_AVAILABLE },
            { kind: 'table-cell', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE },
            { kind: 'table-cell', hasSelectedText: false, ...SOME_FORMATS, availability: ALL_AVAILABLE },
            { kind: 'empty-line', hasSelectedText: true, availability: ALL_AVAILABLE },
            { kind: 'empty-line', hasSelectedText: false, availability: ALL_AVAILABLE },
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

describe('MarkdownEditor context menu — caret and availability', () => {
    const TABLE = '| a | b |\n| - | - |\n| c | d |';
    const RAW_BLOCK = '[x]: https://one';
    const CODE_BLOCK = '```\ncode\n```';
    const LINK_PROSE = 'A [text](https://x) link.';
    const SOURCE_RUN = 'a <span>x</span> b';
    const NESTED_LINK = '[<https://y.test/b-c>](https://x)';
    const PROSE_AND_TABLE = 'para\n\n| a |\n| - |\n| c |';

    /** Builds an editor showing `markdown`. */
    function editorOf(markdown: string): MarkdownEditor {
        const editor = new MarkdownEditor();

        editor.setValue(markdown);

        return editor;
    }

    /** The first text node showing exactly `text`. Call inside a Lexical read or update. */
    function $textNodeShowing(text: string): TextNode {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);

        if (node === undefined) {
            throw new Error(`text node "${text}" not found`);
        }

        return node;
    }

    /** Places a collapsed caret at `offset` in the first text node showing exactly `text`. */
    function caretIn(editor: MarkdownEditor, text: string, offset: number): void {
        lexicalOf(editor).update(() => { $textNodeShowing(text).select(offset, offset); }, { discrete: true });
    }

    /** Selects from `offset` 1 of the text node showing `from` to offset 1 of the one showing `to`. */
    function selectAcross(editor: MarkdownEditor, from: string, to: string): void {
        lexicalOf(editor).update(() => {
            const selection = $textNodeShowing(from).select(1, 1);

            selection.focus.set($textNodeShowing(to).getKey(), 1, 'text');
        }, { discrete: true });
    }

    /** Selects the two cells of the first table's last row, as a drag across them does. */
    function selectLastRowCells(editor: MarkdownEditor): void {
        lexicalOf(editor).update(() => {
            const table = $getRoot().getChildren().find((node) => node.getType() === 'table') as TableNode;
            const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, first, second));
        }, { discrete: true });
    }

    /** Selects the two cells of the first table's first (header) row, as a drag across them does. */
    function selectFirstRowCells(editor: MarkdownEditor): void {
        lexicalOf(editor).update(() => {
            const table = $getRoot().getChildren().find((node) => node.getType() === 'table') as TableNode;
            const [first, second] = (table.getFirstChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, first, second));
        }, { discrete: true });
    }

    /** Classifies the way a keyboard-opened menu does: its event target resolves to the root. */
    function classifyAtCaret(editor: MarkdownEditor): ContextMenuTarget {
        return lexicalOf(editor).read(() => $classifyContextMenuTarget($contextMenuNodeFor($getRoot())));
    }

    /** A `contextmenu` event whose target Lexical resolves to the node keyed `key` (`"root"` is the editor root). */
    function contextMenuEventOn(editor: MarkdownEditor, key: string, clientX: number, clientY: number): MouseEvent {
        const target = { nodeType: 1, [`__lexicalKey_${lexicalOf(editor)._key}`]: key };

        return { target, clientX, clientY } as unknown as MouseEvent;
    }

    /** A collapsed selection at `offset` in the first text node showing exactly `text`. Call inside a Lexical update. */
    function $caretAt(text: string, offset: number): RangeSelection {
        const selection = $createRangeSelection();
        const key = $textNodeShowing(text).getKey();

        selection.anchor.set(key, offset, 'text');
        selection.focus.set(key, offset, 'text');

        return selection;
    }

    /**
     * Stands in for the browser: makes the seam's selection read give a
     * caret at `offset` of the text node showing `text` as the selection the
     * page holds when the menu opens, which a right-click has already moved
     * to the click point. Offline the modelled source has no selection.
     */
    function browserCaretIs(text: string, offset: number): void {
        vi.spyOn(DOM.source, 'readDocumentSelection').mockImplementation(() => $caretAt(text, offset));
    }

    /** A right-click on the text node showing `text`, with the browser's caret already at `offset` in it; returns the items shown. */
    function rightClickIn(editor: MarkdownEditor, text: string, offset: number): MenuItemConfig[] {
        const key = lexicalOf(editor).read(() => $textNodeShowing(text).getKey());
        const show = spyOnMenuShow(editor);

        browserCaretIs(text, offset);
        contextMenuMethodsOf(editor).handleWysiwygContextMenu(contextMenuEventOn(editor, key, 40, 50));

        return show.mock.calls[0][2];
    }

    /** Where the editor's caret is: the text its node shows and the offset in it, or `null` without a range selection. */
    function caretOf(editor: MarkdownEditor): [string, number] | null {
        return lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isRangeSelection(selection) ? [selection.anchor.getNode().getTextContent(), selection.anchor.offset] : null;
        });
    }

    /** Replaces the editor's context menu `show` with a spy, so a test reads what would be shown. */
    function spyOnMenuShow(editor: MarkdownEditor): MockInstance<(x: number, y: number, items: MenuItemConfig[]) => unknown> {
        const menu = (editor as unknown as { _contextMenu: { show(x: number, y: number, items: MenuItemConfig[]): unknown } })._contextMenu;

        return vi.spyOn(menu, 'show').mockImplementation(() => menu);
    }

    /** What a menu shows of each item: its text, enabled and checked state, its row's state, and its submenu the same way. */
    function shapeOf(items: MenuItemConfig[] | undefined): unknown[] {
        return (items ?? []).map((item) => ({
            text:      item.text,
            separator: item.separator,
            enabled:   item.enabled !== false,
            checked:   item.checked,
            row:       item.row ? { enabled: rowOf(item).isEnabled(), checked: rowOf(item).isChecked() } : undefined,
            submenu:   item.submenu ? shapeOf(submenuItemsOf(item)) : undefined,
        }));
    }

    afterEach(() => vi.restoreAllMocks());

    describe('which node the menu is built for', () => {
        it('R1: with the caret in a table cell, a root target gives the table-cell menu, with its Table submenu', () => {
            const editor = editorOf(TABLE);
            caretIn(editor, 'c', 1);

            const context = classifyAtCaret(editor);

            expect(context.kind).toBe('table-cell');
            expect(findItem(contextMenuMethodsOf(editor).buildContextMenuItems(context), 'Table')).toBeDefined();
        });

        it('R2: with the caret inside a word, a root target gives the text menu, with text to act on', () => {
            const editor = editorOf('hello world');
            caretIn(editor, 'hello world', 'hello wo'.length);

            const context = classifyAtCaret(editor);

            expect(context.kind).toBe('text');
            expect(context.hasSelectedText).toBe(true);
        });

        it('R3: with the caret on an empty line, a root target gives the empty-line menu', () => {
            const editor = new MarkdownEditor();

            (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();
            selectStart(editor);

            expect(classifyAtCaret(editor).kind).toBe('empty-line');
        });

        it('R4: with the caret in a raw Markdown block, a root target gives the text menu, formatting unavailable', () => {
            const editor = editorOf(RAW_BLOCK);
            caretIn(editor, RAW_BLOCK, 3);

            const context = classifyAtCaret(editor);

            expect(context.kind).toBe('text');
            expect(context.availability.canFormat).toBe(false);
        });

        it('R5: with the caret in a code block, a root target gives the text menu for that block, formatting unavailable', () => {
            const editor = editorOf(CODE_BLOCK);
            caretIn(editor, 'code', 2);

            const context = classifyAtCaret(editor);

            expect(context.kind).toBe('text');
            expect((context as { hasEnclosingBlock?: boolean }).hasEnclosingBlock).toBe(true);
            expect(context.availability.canFormat).toBe(false);
        });

        it('R6: with the caret inside a link, a root target gives the text menu for that link, text style unavailable', () => {
            const editor = editorOf(LINK_PROSE);
            caretIn(editor, 'text', 2);

            const context = classifyAtCaret(editor);

            expect(context.kind).toBe('text');
            expect((context as { linkUrl?: string | null }).linkUrl).toBe('https://x');
            expect(context.availability.canStyle).toBe(false);
        });

        it('R7: with the caret after an image alone in its paragraph, a root target classifies as a right-click on the image does', () => {
            const editor = editorOf('![](https://x/a.png)');

            lexicalOf(editor).update(() => {
                ($getRoot().getFirstChild() as ElementNode).select(1, 1);   // an element point after the image
            }, { discrete: true });

            const onImage = lexicalOf(editor).read(() => {
                const image = ($getRoot().getFirstChild() as ElementNode).getFirstChild() as LexicalNode;

                return $classifyContextMenuTarget(image);
            });

            expect(onImage.kind).toBe('empty-line');
            expect(classifyAtCaret(editor)).toEqual(onImage);
        });

        it('R8: a target inside the document is used as given, wherever the caret is', () => {
            const editor = editorOf(`hello\n\n${TABLE}`);
            caretIn(editor, 'hello', 2);

            const [isTarget, context] = lexicalOf(editor).read(() => {
                const target = $textNodeShowing('c');
                const node = $contextMenuNodeFor(target);

                return [node.is(target), $classifyContextMenuTarget(node)] as const;
            });

            expect(isTarget).toBe(true);
            expect(context.kind).toBe('table-cell');
        });

        it('R9: with no selection, a root target stays the root, which classifies as text', () => {
            const editor = editorOf(TABLE);
            lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

            const [isRoot, context] = lexicalOf(editor).read(() => {
                const node = $contextMenuNodeFor($getRoot());

                return [node.is($getRoot()), $classifyContextMenuTarget(node)] as const;
            });

            expect(isRoot).toBe(true);
            expect(context.kind).toBe('text');
        });

        it('a table selection resolves a root target to its anchor cell', () => {
            const editor = editorOf(TABLE);
            selectLastRowCells(editor);

            expect(classifyAtCaret(editor).kind).toBe('table-cell');
        });

        it('while table cells are selected, a target outside the table resolves to the selection\'s anchor cell too', () => {
            const editor = editorOf(`${TABLE}\n\nafter`);
            selectLastRowCells(editor);

            const [cellText, context] = lexicalOf(editor).read(() => {
                const node = $contextMenuNodeFor($textNodeShowing('after'));

                return [$isTableCellNode(node) ? node.getTextContent() : null, $classifyContextMenuTarget(node)] as const;
            });

            expect(cellText).toBe('c');   // the cell the selection was started in
            expect(context.kind).toBe('table-cell');
        });

        it('a contextmenu event on the editor root shows the menu for the caret, at the event\'s point', () => {
            const editor = editorOf(TABLE);
            caretIn(editor, 'c', 1);

            const show = spyOnMenuShow(editor);

            contextMenuMethodsOf(editor).handleWysiwygContextMenu(contextMenuEventOn(editor, 'root', 40, 50));

            expect(show).toHaveBeenCalledOnce();

            const [x, y, items] = show.mock.calls[0];

            expect([x, y]).toEqual([40, 50]);
            expect(findItem(items, 'Table')).toBeDefined();
        });

        it('a contextmenu event on content shows the menu for that content, not for the caret', () => {
            const editor = editorOf(`hello\n\n${TABLE}`);
            caretIn(editor, 'hello', 2);

            const cellTextKey = lexicalOf(editor).read(() => $textNodeShowing('c').getKey());
            const show = spyOnMenuShow(editor);

            contextMenuMethodsOf(editor).handleWysiwygContextMenu(contextMenuEventOn(editor, cellTextKey, 40, 50));

            expect(findItem(show.mock.calls[0][2], 'Table')).toBeDefined();
        });
    });

    describe('a right-click reads the selection the click made', () => {
        const PROSE_AND_CODE = 'plain **bold** end\n\n```\ncode\n```';
        const FORMAT_ROWS = [4, 5, 6, 7, 8];   // Cut, Copy, Paste, separator, then the five format rows.

        /** Whether the menu offers formatting, a link and a text style: the five format rows, Insert link… and Text style. */
        function offered(items: MenuItemConfig[]): boolean[] {
            return [
                ...FORMAT_ROWS.map((index) => rowOf(items[index]).isEnabled()),
                findItem(items, 'Insert link…')?.enabled !== false,
                findItem(items, 'Text style')?.enabled !== false,
            ];
        }

        it('caret in prose, right-click in a code block: the menu dims what a code block declines', () => {
            const editor = editorOf(PROSE_AND_CODE);
            caretIn(editor, 'plain ', 2);

            const items = rightClickIn(editor, 'code', 2);

            expect(offered(items)).toEqual([false, false, false, false, false, false, false]);
            expect(caretOf(editor)).toEqual(['code', 2]);
        });

        it('caret in a code block, right-click on a prose word: the menu offers what prose accepts', () => {
            const editor = editorOf(PROSE_AND_CODE);
            caretIn(editor, 'code', 2);

            const items = rightClickIn(editor, 'plain ', 2);

            expect(offered(items)).toEqual([true, true, true, true, true, true, true]);
            expect(caretOf(editor)).toEqual(['plain ', 2]);
        });

        it('the format checkmarks are those of the clicked run, not of the run the caret was in', () => {
            const editor = editorOf(PROSE_AND_CODE);
            caretIn(editor, 'plain ', 2);

            const onBold = rightClickIn(editor, 'bold', 2);

            expect(FORMAT_ROWS.map((index) => rowOf(onBold[index]).isChecked())).toEqual([true, false, false, false, false]);

            vi.restoreAllMocks();

            const onPlain = rightClickIn(editor, 'plain ', 2);

            expect(FORMAT_ROWS.map((index) => rowOf(onPlain[index]).isChecked())).toEqual([false, false, false, false, false]);
        });

        it('Cut, Copy and Insert link… follow the clicked word, not the caret the click moved', () => {
            const editor = editorOf('a  b word');
            caretIn(editor, 'a  b word', 2);   // between the two spaces: no word to act on

            const onWord = rightClickIn(editor, 'a  b word', 'a  b wo'.length);

            expect(['Cut', 'Copy', 'Insert link…'].map((text) => findItem(onWord, text)?.enabled)).toEqual([true, true, true]);

            vi.restoreAllMocks();

            const onSpaces = rightClickIn(editor, 'a  b word', 2);

            expect(['Cut', 'Copy', 'Insert link…'].map((text) => findItem(onSpaces, text)?.enabled)).toEqual([false, false, false]);
        });

        it('a right-click that leaves the caret where it was keeps the format pending at it', () => {
            const editor = editorOf(PROSE_AND_CODE);
            caretIn(editor, 'plain ', 6);

            lexicalOf(editor).update(() => {
                ($getSelection() as RangeSelection).setFormat(1);   // bold pending at the caret, as Ctrl+B on a bare caret leaves it
            }, { discrete: true });

            rightClickIn(editor, 'plain ', 6);

            const pending = lexicalOf(editor).read(() => ($getSelection() as RangeSelection).hasFormat('bold'));

            expect(pending).toBe(true);
        });

        it('a held table selection is kept, so a right-click on its cells still acts on all of them', () => {
            const editor = editorOf(`${TABLE}\n\nafter`);
            selectLastRowCells(editor);

            rightClickIn(editor, 'c', 1);

            const held = lexicalOf(editor).read(() => $getSelection()?.getNodes().filter($isTableCellNode).length);

            expect(held).toBe(2);
        });

        it('a right-click on prose while table cells are selected gives the menu for the cells, whose items act on them', () => {
            const editor = editorOf(`${TABLE}\n\nafter`);
            selectLastRowCells(editor);

            const items = rightClickIn(editor, 'after', 2);
            const table = submenuItemsOf(findItem(items, 'Table')) ?? [];

            expect(findItem(items, 'Block style')).toBeUndefined();
            expect(findItem(table, 'Merge cells')?.enabled).toBe(true);
            expect(FORMAT_ROWS.map((index) => rowOf(items[index]).isEnabled())).toEqual([true, true, true, true, true]);
        });

        it('with no selection for the browser to report, the editor\'s own selection stands', () => {
            const editor = editorOf(PROSE_AND_CODE);
            caretIn(editor, 'plain ', 2);

            spyOnMenuShow(editor);   // the modelled source reports no selection

            contextMenuMethodsOf(editor).handleWysiwygContextMenu(contextMenuEventOn(editor, 'root', 40, 50));

            expect(caretOf(editor)).toEqual(['plain ', 2]);
        });

        describe('$adoptDomSelection', () => {
            /** Runs `$adoptDomSelection` on what `make` builds, inside one update. */
            function adopt(editor: MarkdownEditor, make: () => RangeSelection | null): void {
                lexicalOf(editor).update(() => { $adoptDomSelection(make()); }, { discrete: true });
            }

            it('moves the selection to a caret that differs from the editor\'s, with the format of the text it lands in', () => {
                // A selection read from the browser carries no format of its own; typing at it must still
                // continue the run it sits in, so it takes the format of the text at its anchor.
                const editor = editorOf(PROSE_AND_CODE);
                caretIn(editor, 'plain ', 2);

                adopt(editor, () => $caretAt('bold', 2));

                expect(caretOf(editor)).toEqual(['bold', 2]);
                expect(lexicalOf(editor).read(() => ($getSelection() as RangeSelection).hasFormat('bold'))).toBe(true);

                adopt(editor, () => $caretAt('plain ', 2));

                expect(caretOf(editor)).toEqual(['plain ', 2]);
                expect(lexicalOf(editor).read(() => ($getSelection() as RangeSelection).hasFormat('bold'))).toBe(false);
            });

            it('a range adopted from the browser carries the formats all its text has, not those of a node it only touches', () => {
                // The range runs from the very end of "plain " over the whole code span: Code is on for it,
                // though the node its anchor sits in is plain.
                const editor = editorOf('plain `code` end');
                caretIn(editor, ' end', 2);

                adopt(editor, () => {
                    const selection = $createRangeSelection();

                    selection.anchor.set($textNodeShowing('plain ').getKey(), 'plain '.length, 'text');
                    selection.focus.set($textNodeShowing('code').getKey(), 'code'.length, 'text');

                    return selection;
                });

                expect(editor.getSelectionState().code).toBe(true);

                adopt(editor, () => {
                    const selection = $createRangeSelection();

                    selection.anchor.set($textNodeShowing('plain ').getKey(), 2, 'text');
                    selection.focus.set($textNodeShowing('code').getKey(), 2, 'text');

                    return selection;
                });

                expect(editor.getSelectionState().code).toBe(false);
            });

            it('a caret adopted at an element point takes the block\'s own text format only when the block is empty', () => {
                // Lexical's rule for a caret that is not in text: an empty block hands over the format
                // text typed into it would get; a block with content does not.
                const editor = editorOf('x\n\ny');
                caretIn(editor, 'y', 1);

                /** Adopts a caret at the start of the first block, as an element point, and reads whether it carries bold. */
                const adoptAtFirstBlock = (): boolean => {
                    adopt(editor, () => {
                        const selection = $createRangeSelection();
                        const key = ($getRoot().getFirstChild() as ElementNode).getKey();

                        selection.anchor.set(key, 0, 'element');
                        selection.focus.set(key, 0, 'element');

                        return selection;
                    });

                    return lexicalOf(editor).read(() => ($getSelection() as RangeSelection).hasFormat('bold'));
                };

                lexicalOf(editor).update(() => {
                    ($getRoot().getFirstChild() as ParagraphNode).setTextFormat(1);   // bold
                }, { discrete: true });

                expect(adoptAtFirstBlock()).toBe(false);

                caretIn(editor, 'y', 1);
                lexicalOf(editor).update(() => {
                    ($getRoot().getFirstChild() as ParagraphNode).clear();
                }, { discrete: true });

                expect(adoptAtFirstBlock()).toBe(true);
            });

            it('text typed at an adopted caret inside a bold run is bold', () => {
                const editor = editorOf(PROSE_AND_CODE);
                caretIn(editor, 'plain ', 2);

                adopt(editor, () => $caretAt('bold', 2));
                lexicalOf(editor).update(() => { ($getSelection() as RangeSelection).insertText('Q'); }, { discrete: true });

                expect(editor.getValue()).toContain('**boQld**');
            });

            it('leaves the selection object alone when the browser\'s caret is where the editor\'s is', () => {
                const editor = editorOf(PROSE_AND_CODE);
                caretIn(editor, 'plain ', 2);

                let same = false;

                lexicalOf(editor).update(() => {
                    const before = $getSelection();

                    $adoptDomSelection($caretAt('plain ', 2));
                    same = $getSelection() === before;
                }, { discrete: true });

                expect(same).toBe(true);
            });

            it('does nothing for null, and nothing while a table selection is held', () => {
                const editor = editorOf(`${TABLE}\n\nafter`);
                caretIn(editor, 'after', 2);

                adopt(editor, () => null);

                expect(caretOf(editor)).toEqual(['after', 2]);

                selectLastRowCells(editor);
                adopt(editor, () => $caretAt('after', 2));

                expect(caretOf(editor)).toBeNull();
            });
        });
    });

    describe('availability, read from the live selection', () => {
        const BARE_CARET = 'a  b word';
        const BOLD_WORD = 'a **bold** c';
        const QUOTE_BLOCK = '> quoted';
        const MERGED_CELL = '| a | b |\n| - | - |\n| c | << |';
        const SOURCE_CELLS = '| a | b |\n| - | - |\n| <b>c</b> | <i>d</i> |\n\nafter';
        const EMPTY_CELLS = '| a | b |\n| - | - |\n|  |  |\n\nafter';
        const IMAGE_AND_BOLD_CELLS = '| a | b |\n| - | - |\n| ![i](/i.png) | **d** |\n\nafter';
        const IMAGE_CELLS = '| a | b |\n| - | - |\n| ![i](/i.png) | ![j](/j.png) |\n\nafter';
        const BULLETED_LIST = '- one\n- two\n- three';
        const NUMBERED_LIST = '1. one\n2. two\n3. three';
        const TASK_LIST = '- [ ] one\n- [x] two';
        const TWO_LISTS = '- one\n- two\n\n1. three\n2. four';
        const ITEM_PARAGRAPH = '- one\n\n  second\n\n- two';

        /** What is available at a caret or a range inside the items of a list. */
        const IN_LIST: Array<keyof CommandAvailability> = [
            'canFormat', 'canStyle', 'canLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock',
            'canInsertTable', 'canInsertImage',
        ];

        /** Selects from `fromOffset` in the text node showing `from` to `toOffset` in the one showing `to`. */
        function selectBetween(editor: MarkdownEditor, from: string, fromOffset: number, to: string, toOffset: number): void {
            lexicalOf(editor).update(() => {
                const selection = $textNodeShowing(from).select(fromOffset, fromOffset);

                selection.focus.set($textNodeShowing(to).getKey(), toOffset, 'text');
            }, { discrete: true });
        }

        /** A selection point in the text node showing `text`, or on the top-level block at index `block` itself. */
        type PointAt = { text: string; offset: number } | { block: number; offset: number };

        /**
         * Selects from `anchor` to `focus`. A point on a block itself, between its children, is one only a
         * programmatic selection holds: Lexical turns the browser's into points in text.
         */
        function selectPoints(editor: MarkdownEditor, anchor: PointAt, focus: PointAt): void {
            lexicalOf(editor).update(() => {
                const selection = $createRangeSelection();

                for (const [point, at] of [[selection.anchor, anchor], [selection.focus, focus]] as const) {
                    if ('text' in at) {
                        point.set($textNodeShowing(at.text).getKey(), at.offset, 'text');
                    } else {
                        point.set($getRoot().getChildAtIndex(at.block)!.getKey(), at.offset, 'element');
                    }
                }

                $setSelection(selection);
            }, { discrete: true });
        }

        /** Leaves the editor with no selection at all. */
        const selectNoneOf = (editor: MarkdownEditor): void => lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });

        /** Selects the first cell of the first table's last row alone, as a table selection. */
        function selectOneCell(editor: MarkdownEditor): void {
            lexicalOf(editor).update(() => {
                const table = $getRoot().getChildren().find((node) => node.getType() === 'table') as TableNode;
                const first = (table.getLastChild() as TableRowNode).getFirstChild() as TableCellNode;

                $setSelection($createTableSelectionFrom(table, first, first));
            }, { discrete: true });
        }

        /** Each availability case: its document, how its selection is made, and the fields that are available there, all others not. */
        const CASES: Array<{
            name: string;
            markdown: string;
            select: (editor: MarkdownEditor) => void;
            available: Array<keyof CommandAvailability>;
        }> = [
            {
                name: 'A1: a caret inside a plain word', markdown: 'hello world',
                select: (editor) => caretIn(editor, 'hello world', 'hello wo'.length),
                available: ['canFormat', 'canStyle', 'canLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // Offset 2 sits between the two spaces: the caret expands to nothing, so a format or style is
                // left pending at it, and there is no word for a link to take.
                name: 'a bare caret in prose', markdown: BARE_CARET,
                select: (editor) => caretIn(editor, BARE_CARET, 2),
                available: ['canFormat', 'canStyle', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'N1: a caret inside the word of a task-list marker', markdown: '- [ ] one\n- [x] two',
                select: (editor) => caretIn(editor, '[x] ', 1),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'N2: a caret at the end of a run kept as Markdown source', markdown: 'kept <span>x</span> source',
                select: (editor) => caretIn(editor, '<span>', 6),
                available: ['canFormat', 'canStyle', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'N3: a bare caret inside a link', markdown: 'A [te  xt](https://x) link.',
                select: (editor) => caretIn(editor, 'te  xt', 3),
                available: [
                    'canFormat', 'canLink', 'canRemoveLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage',
                ],
            },
            {
                name: 'N4: a caret at the end of a paragraph, after a full stop', markdown: 'Left column.',
                select: (editor) => caretIn(editor, 'Left column.', 12),
                available: ['canFormat', 'canStyle', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'N5: a caret in a paragraph holding an image alone', markdown: '![i](/i.png)',
                select: (editor) => selectStart(editor),
                available: ['canFormat', 'canStyle', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'N6: an underlined word selected from code', markdown: '++c++ x',
                select: (editor) => selectPoints(editor, { text: 'c', offset: 0 }, { text: 'c', offset: 1 }),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canClearFormatting', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable',
                    'canInsertImage',
                ],
            },
            {
                name: 'a caret inside a bold word', markdown: BOLD_WORD,
                select: (editor) => caretIn(editor, 'bold', 2),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canClearFormatting', 'canSetBlockType', 'canSetBlockLayout',
                    'canInsertTable', 'canInsertImage',
                ],
            },
            {
                name: 'A2: a caret in a raw Markdown block', markdown: RAW_BLOCK,
                select: (editor) => caretIn(editor, RAW_BLOCK, 3),
                available: ['canSetBlockType', 'canSetBlockLayout'],
            },
            {
                name: 'A3: a caret in a code block', markdown: CODE_BLOCK,
                select: (editor) => caretIn(editor, 'code', 2),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock'],
            },
            {
                name: 'a caret in a blockquote', markdown: QUOTE_BLOCK,
                select: (editor) => caretIn(editor, 'quoted', 2),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock',
                    'canInsertTable', 'canInsertImage',
                ],
            },
            {
                name: 'A4: a caret inside a run kept as Markdown source', markdown: SOURCE_RUN,
                select: (editor) => caretIn(editor, '<span>', 3),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'A5: a range holding a run kept as Markdown source', markdown: SOURCE_RUN,
                select: (editor) => lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true }),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'A6: a caret inside a link\'s text', markdown: LINK_PROSE,
                select: (editor) => caretIn(editor, 'text', 2),
                available: ['canFormat', 'canLink', 'canRemoveLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // Offset 6 of "https://y.test/b-c" stands between `:` and `/`, no word character on either side, so the caret expands to nothing.
                name: 'A7: a bare caret in a link nested in a link', markdown: NESTED_LINK,
                select: (editor) => caretIn(editor, 'https://y.test/b-c', 6),
                available: ['canFormat', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'A7: a caret inside a word of a link nested in a link', markdown: NESTED_LINK,
                select: (editor) => caretIn(editor, 'https://y.test/b-c', 2),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // The range is removed before a table goes in, its table included, so the table does not nest.
                name: 'A8: a range from a paragraph into a table cell', markdown: PROSE_AND_TABLE,
                select: (editor) => selectAcross(editor, 'para', 'c'),
                available: ['canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // The same range made the other way: its anchor is in the cell, so a line goes around the table.
                name: 'a range from a table cell back into a paragraph', markdown: PROSE_AND_TABLE,
                select: (editor) => selectAcross(editor, 'c', 'para'),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertTable', 'canInsertImage',
                ],
            },
            {
                name: 'a caret in a table cell', markdown: TABLE,
                select: (editor) => caretIn(editor, 'c', 1),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertImage', 'canEditTable',
                ],
            },
            {
                name: 'a caret in a merged table cell', markdown: MERGED_CELL,
                select: (editor) => caretIn(editor, 'c', 1),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertImage',
                    'canEditTable', 'canUnmergeCell',
                ],
            },
            {
                name: 'a table selection', markdown: `${TABLE}\n\nafter`,
                select: (editor) => selectLastRowCells(editor),
                available: ['canFormat', 'canInsertTable', 'canInsertImage', 'canMergeCells'],
            },
            {
                // Markdown merges body cells only, so the header row's cells are not offered a merge.
                name: 'a table selection holding a header cell', markdown: `${TABLE}\n\nafter`,
                select: (editor) => selectFirstRowCells(editor),
                available: ['canFormat', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'a table selection of one cell', markdown: `${TABLE}\n\nafter`,
                select: (editor) => selectOneCell(editor),
                available: ['canFormat', 'canInsertTable', 'canInsertImage'],
            },
            {
                // The format toggles leave out a cell holding a run kept as source, and here both cells hold one.
                name: 'a table selection whose cells all hold a run kept as Markdown source', markdown: SOURCE_CELLS,
                select: (editor) => selectLastRowCells(editor),
                available: ['canInsertTable', 'canInsertImage', 'canMergeCells'],
            },
            {
                name: 'a table selection of empty cells', markdown: EMPTY_CELLS,
                select: (editor) => selectLastRowCells(editor),
                available: ['canInsertTable', 'canInsertImage', 'canMergeCells'],
            },
            {
                // The image cell takes no format, so the toggle reads the bold cell alone and takes its bold off.
                name: 'a table selection of a cell holding an image alone and a bold cell', markdown: IMAGE_AND_BOLD_CELLS,
                select: (editor) => selectLastRowCells(editor),
                available: ['canFormat', 'canInsertTable', 'canInsertImage', 'canMergeCells'],
            },
            {
                name: 'a table selection of cells holding an image alone', markdown: IMAGE_CELLS,
                select: (editor) => selectLastRowCells(editor),
                available: ['canInsertTable', 'canInsertImage', 'canMergeCells'],
            },
            {
                // What Shift+Right at a line's end selects: the range holds no text for a format, a style or a link.
                name: 'a range from the end of one block to the start of the next', markdown: 'one\n\ntwo',
                select: (editor) => selectBetween(editor, 'one', 3, 'two', 0),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // A link wraps an image as it wraps text; a format or a style has no text to go on.
                name: 'a range over an image alone', markdown: 'a ![i](/i.png) b',
                select: (editor) => selectBetween(editor, 'a ', 2, ' b', 0),
                available: ['canLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'a range over the line break between two lines of a paragraph', markdown: 'one  \ntwo',
                select: (editor) => selectBetween(editor, 'one', 3, 'two', 0),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // The same place named twice, the first time as a point on the paragraph: an empty range, which
                // holds no text though the text node before the image is among its nodes.
                name: 'a range from a point on a paragraph to the same place in its text', markdown: 'a ![i](/i.png) b',
                select: (editor) => selectPoints(editor, { block: 0, offset: 1 }, { text: 'a ', offset: 2 }),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'a range from a place in a paragraph\'s text to the same place as a point on the paragraph', markdown: 'a ![i](/i.png) b',
                select: (editor) => selectPoints(editor, { text: ' b', offset: 0 }, { block: 0, offset: 2 }),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // The range of the case above made of points on the two blocks: the list toggles still take both.
                name: 'a range from a point at the end of one block to a point at the start of the next', markdown: 'one\n\ntwo',
                select: (editor) => selectPoints(editor, { block: 0, offset: 1 }, { block: 1, offset: 0 }),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'the same range of points on two blocks, made backward', markdown: 'one\n\ntwo',
                select: (editor) => selectPoints(editor, { block: 1, offset: 0 }, { block: 0, offset: 1 }),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                // A format or a style is left pending at the caret; there is no text for a link to take.
                name: 'a caret in an empty paragraph', markdown: '',
                select: (editor) => selectStart(editor),
                available: ['canFormat', 'canStyle', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage'],
            },
            {
                name: 'a caret in an item of a bulleted list', markdown: BULLETED_LIST,
                select: (editor) => caretIn(editor, 'two', 1),
                available: IN_LIST,
            },
            {
                name: 'a caret in an item of a numbered list', markdown: NUMBERED_LIST,
                select: (editor) => caretIn(editor, 'two', 1),
                available: IN_LIST,
            },
            {
                name: 'a caret in an item of a task list', markdown: TASK_LIST,
                select: (editor) => caretIn(editor, 'one', 1),
                available: IN_LIST,
            },
            {
                name: 'a range over two items of a bulleted list', markdown: BULLETED_LIST,
                select: (editor) => selectAcross(editor, 'one', 'two'),
                available: IN_LIST,
            },
            {
                name: 'a range over two items of a numbered list', markdown: NUMBERED_LIST,
                select: (editor) => selectAcross(editor, 'one', 'two'),
                available: IN_LIST,
            },
            {
                name: 'a range from a bulleted list into a numbered one', markdown: TWO_LISTS,
                select: (editor) => selectAcross(editor, 'two', 'three'),
                available: IN_LIST,
            },
            {
                name: 'a caret in a paragraph a list item holds after its text', markdown: ITEM_PARAGRAPH,
                select: (editor) => caretIn(editor, 'second', 1),
                available: IN_LIST,
            },
            {
                name: 'a range from a list item\'s text into the paragraph it holds', markdown: ITEM_PARAGRAPH,
                select: (editor) => selectAcross(editor, 'one', 'second'),
                available: IN_LIST,
            },
            {
                name: 'a caret in a heading a list item opens with', markdown: '- ## Foo\n- bar',
                select: (editor) => caretIn(editor, 'Foo', 1),
                available: IN_LIST,
            },
            {
                name: 'a caret in a quote a list item holds', markdown: '- one\n\n  > quoted\n\n- two',
                select: (editor) => caretIn(editor, 'quoted', 1),
                available: IN_LIST,
            },
            {
                name: 'a caret in a table cell of a list item', markdown: '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two',
                select: (editor) => caretIn(editor, 'c', 1),
                available: [
                    'canFormat', 'canStyle', 'canLink', 'canSetBlockLayout', 'canInsertParagraphAroundBlock', 'canInsertImage', 'canEditTable',
                ],
            },
            {
                name: 'a caret in a code block a list item holds', markdown: '- one\n\n  ```\n  code\n  ```\n\n- two',
                select: (editor) => caretIn(editor, 'code', 2),
                available: ['canSetBlockType', 'canSetBlockLayout', 'canInsertParagraphAroundBlock'],
            },
            {
                name: 'no selection', markdown: 'hello world',
                select: selectNoneOf,
                available: ['canInsertTable', 'canInsertImage'],
            },
            {
                // With no selection the two inserts go in at the document's end, which here is inside the code block.
                name: 'no selection in a document ending in a code block', markdown: `para\n\n${CODE_BLOCK}`,
                select: selectNoneOf,
                available: [],
            },
            {
                name: 'no selection in a document ending in a raw Markdown block', markdown: `para\n\n${RAW_BLOCK}`,
                select: selectNoneOf,
                available: [],
            },
            {
                name: 'no selection in a document ending in a table', markdown: TABLE,
                select: selectNoneOf,
                available: ['canInsertImage'],
            },
        ];

        /** The commands each availability field covers, each one run with arguments that would change a document it applies to. */
        const COMMANDS: Record<keyof CommandAvailability, Array<[string, (editor: MarkdownEditor) => void]>> = {
            canFormat: [
                ['toggleBold', (editor) => editor.toggleBold()],
                ['toggleItalic', (editor) => editor.toggleItalic()],
                ['toggleUnderline', (editor) => editor.toggleUnderline()],
                ['toggleStrikethrough', (editor) => editor.toggleStrikethrough()],
                ['toggleInlineCode', (editor) => editor.toggleInlineCode()],
            ],
            canStyle: [
                ['setTextColor', (editor) => editor.setTextColor('#f00')],
                ['setFontFamily', (editor) => editor.setFontFamily('monospace')],
                ['setFontSize', (editor) => editor.setFontSize('1.2em')],
            ],
            canLink:            [['toggleLink', (editor) => editor.toggleLink('https://z')]],
            canRemoveLink:      [['removeLink', (editor) => editor.removeLink()]],
            canClearFormatting: [['clearFormatting', (editor) => editor.clearFormatting()]],
            canSetBlockType:    [
                ['setBlockType', (editor) => editor.setBlockType('h1')],
                ['toggleUnorderedList', (editor) => editor.toggleUnorderedList()],
                ['toggleOrderedList', (editor) => editor.toggleOrderedList()],
            ],
            canSetBlockLayout: [
                ['setBlockAlignment', (editor) => editor.setBlockAlignment('center')],
                ['setColumnCount', (editor) => editor.setColumnCount(2)],
            ],
            canInsertParagraphAroundBlock: [
                ['insertParagraphBeforeBlock', (editor) => editor.insertParagraphBeforeBlock()],
                ['insertParagraphAfterBlock', (editor) => editor.insertParagraphAfterBlock()],
            ],
            canInsertTable: [['insertTable', (editor) => editor.insertTable(2, 2)]],
            canInsertImage: [['insertImage', (editor) => editor.insertImage('https://x/a.png')]],
            canEditTable:   [
                ['insertTableRow', (editor) => editor.insertTableRow()],
                ['deleteTableRow', (editor) => editor.deleteTableRow()],
                ['insertTableColumn', (editor) => editor.insertTableColumn()],
                ['deleteTableColumn', (editor) => editor.deleteTableColumn()],
                ['setTableColumnAlignment', (editor) => editor.setTableColumnAlignment('right')],
                ['setTableColumnWidth', (editor) => editor.setTableColumnWidth(120)],
                ['deleteTable', (editor) => editor.deleteTable()],
            ],
            canMergeCells:  [['mergeTableCells', (editor) => editor.mergeTableCells()]],
            canUnmergeCell: [['unmergeTableCell', (editor) => editor.unmergeTableCell()]],
        };

        /** The route Lexical's key and input handlers take to a format: the command, not the method. */
        const FORMAT_COMMAND_ROUTES: Array<[string, (editor: MarkdownEditor) => void]> = (
            [
                ['Ctrl+B', 'bold'], ['Ctrl+I', 'italic'], ['Ctrl+U', 'underline'], ['formatStrikeThrough input', 'strikethrough'],
                ['code', 'code'],
            ] as const
        ).map(([key, format]) => [
            `${key} (FORMAT_TEXT_COMMAND ${format})`,
            (editor: MarkdownEditor): void => { lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, format); },
        ]);

        /** Every route to the commands a field covers. */
        const routesOf = (field: keyof CommandAvailability): Array<[string, (editor: MarkdownEditor) => void]> => (
            field === 'canFormat' ? [...COMMANDS[field], ...FORMAT_COMMAND_ROUTES] : COMMANDS[field]
        );

        /** The fields of the availability record the selection state reports. */
        const REPORTED = [
            'canFormat', 'canStyle', 'canLink', 'canRemoveLink', 'canSetBlockType', 'canSetBlockLayout', 'canInsertTable', 'canInsertImage',
            'canEditTable', 'canMergeCells', 'canUnmergeCell',
        ] as const;

        /**
         * Where the selection is and what it carries: its kind, its two
         * points, and for a range the format and style pending at it. A
         * command that applies without changing the document changes this.
         */
        function selectionOf(editor: MarkdownEditor): string {
            return lexicalOf(editor).read(() => {
                const selection = $getSelection();
                const isRange = $isRangeSelection(selection);

                if (isRange) {
                    const points = [selection.anchor, selection.focus].map((point) => `${point.key}:${point.offset}:${point.type}`);

                    return ['range', ...points, selection.format, selection.style].join('|');
                }

                return selection === null ? 'none' : `cells|${selection.getNodes().map((node) => node.getKey()).join(',')}`;
            });
        }

        /** Every node of the document, by key and type, nested as the tree is: a node replaced by an equal one changes this. */
        function nodesOf(editor: MarkdownEditor): string {
            const describeNode = (node: LexicalNode): string => {
                const children = $isElementNode(node) ? `[${node.getChildren().map(describeNode).join(',')}]` : '';

                return `${node.getKey()}:${node.getType()}${children}`;
            };

            return lexicalOf(editor).read(() => describeNode($getRoot()));
        }

        /** What a command that does nothing leaves as it was: the saved Markdown, every node, and the selection. */
        function stateOf(editor: MarkdownEditor): { value: string; nodes: string; selection: string } {
            return { value: editor.getValue(), nodes: nodesOf(editor), selection: selectionOf(editor) };
        }

        /** How many steps Undo can take: it is pressed until a press changes nothing, which leaves the editor undone. */
        function undoDepthOf(editor: MarkdownEditor): number {
            const lexical = lexicalOf(editor);
            let depth = 0;
            let before = null;

            while (before !== lexical.getEditorState()) {
                before = lexical.getEditorState();
                lexical.dispatchCommand(UNDO_COMMAND, undefined);
                depth += 1;
            }

            return depth - 1;
        }

        for (const { name, markdown, select, available } of CASES) {
            const unavailable = AVAILABILITY_FIELDS.filter((field) => !available.includes(field));

            it(`${name}: the context carries what is available there, and the selection state reports the same`, () => {
                const editor = editorOf(markdown);
                select(editor);

                const expected = availabilityOf(...available);
                const state = editor.getSelectionState();

                expect(classifyAtCaret(editor).availability).toEqual(expected);
                expect(REPORTED.map((field) => state[field])).toEqual(REPORTED.map((field) => expected[field]));
            });

            it(`${name}: A9: every command reported unavailable there changes nothing, adds no undo step and reports nothing`, () => {
                const untouched = editorOf(markdown);
                select(untouched);

                const undoDepth = undoDepthOf(untouched);

                for (const field of unavailable) {
                    for (const [command, run] of routesOf(field)) {
                        const editor = editorOf(markdown);
                        select(editor);

                        const before = stateOf(editor);
                        const updated = vi.fn();
                        const reported = vi.fn();
                        const started = vi.spyOn(lexicalOf(editor), 'update');

                        lexicalOf(editor).registerUpdateListener(updated);
                        editor.on('selectionstate', reported);
                        editor.on('change', reported);
                        run(editor);

                        // The command returns on its field: it does not so much as start an update that then finds nothing to do.
                        expect(started, command).not.toHaveBeenCalled();
                        started.mockRestore();

                        expect(stateOf(editor), command).toEqual(before);
                        expect(updated, command).not.toHaveBeenCalled();
                        expect(reported, command).not.toHaveBeenCalled();
                        expect(undoDepthOf(editor), command).toBe(undoDepth);
                    }
                }
            });

            it(`${name}: every command reported available there applies`, () => {
                for (const field of available) {
                    for (const [command, run] of routesOf(field)) {
                        const editor = editorOf(markdown);
                        select(editor);

                        const before = [editor.getValue(), selectionOf(editor)];

                        run(editor);

                        expect([editor.getValue(), selectionOf(editor)], command).not.toEqual(before);
                    }
                }
            });

            it(`${name}: C3: the menu's link item is dimmed by canLink alone`, () => {
                const editor = editorOf(markdown);
                select(editor);

                const context = classifyAtCaret(editor);
                const items = contextMenuMethodsOf(editor).buildContextMenuItems(context);
                const linkItem = findItem(items, 'Insert link…') ?? findItem(items, 'Edit link…');

                if (linkItem !== undefined) {
                    expect(linkItem.enabled).toBe(available.includes('canLink'));
                }
            });

            it(`${name}: C4: paste() pastes there`, async () => {
                const editor = editorOf(markdown);
                select(editor);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('pasted');

                const before = editor.getValue();
                const pasted = await editor.paste();

                expect(pasted).toBe(true);
                expect(editor.getValue()).not.toBe(before);
            });
        }

        it('every availability field has a case where it is available and one where it is not', () => {
            for (const field of AVAILABILITY_FIELDS) {
                const cases = CASES.filter(({ available }) => available.includes(field));

                expect(cases.length, field).toBeGreaterThan(0);
                expect(cases.length, field).toBeLessThan(CASES.length);
            }
        });

        // A field covers a command, not a call: where the argument asks for what is already there, the field is
        // `true` and the call still changes nothing at all.
        const ALREADY_SET: Array<{ name: string; markdown: string; select: (editor: MarkdownEditor) => void; run: (editor: MarkdownEditor) => void }> = [
            {
                name: 'setBlockType("paragraph") in a paragraph', markdown: 'para',
                select: (editor) => caretIn(editor, 'para', 2), run: (editor) => editor.setBlockType('paragraph'),
            },
            {
                name: 'setBlockType("paragraph") over two paragraphs', markdown: 'one\n\ntwo',
                select: (editor) => selectBetween(editor, 'one', 1, 'two', 2), run: (editor) => editor.setBlockType('paragraph'),
            },
            {
                name: 'setBlockType("paragraph") in a paragraph of a ::: column', markdown: '::: columns\nA\n|||\nB\n:::',
                select: (editor) => caretIn(editor, 'A', 1), run: (editor) => editor.setBlockType('paragraph'),
            },
            {
                name: 'setBlockType("h1") in a level 1 heading', markdown: '# head',
                select: (editor) => caretIn(editor, 'head', 2), run: (editor) => editor.setBlockType('h1'),
            },
            {
                // The heading keeps the form it was written in: nothing is rewritten as `# head`.
                name: 'setBlockType("h1") in a level 1 heading written with an underline', markdown: 'head\n====',
                select: (editor) => caretIn(editor, 'head', 2), run: (editor) => editor.setBlockType('h1'),
            },
            {
                name: 'setBlockType("quote") in a blockquote', markdown: QUOTE_BLOCK,
                select: (editor) => caretIn(editor, 'quoted', 2), run: (editor) => editor.setBlockType('quote'),
            },
            {
                name: 'setBlockType("code") in a code block', markdown: CODE_BLOCK,
                select: (editor) => caretIn(editor, 'code', 2), run: (editor) => editor.setBlockType('code'),
            },
            {
                // The code block keeps its language.
                name: 'setBlockType("code") in a code block with a language', markdown: '```ts\nconst x = 1;\n```',
                select: (editor) => caretIn(editor, 'const x = 1;', 2), run: (editor) => editor.setBlockType('code'),
            },
            {
                name: 'setTableColumnAlignment() with the alignment the column has', markdown: '| a | b |\n| :-: | - |\n| c | d |',
                select: (editor) => caretIn(editor, 'c', 1), run: (editor) => editor.setTableColumnAlignment('center'),
            },
            {
                name: 'setTableColumnAlignment("none") in a column with none', markdown: TABLE,
                select: (editor) => caretIn(editor, 'c', 1), run: (editor) => editor.setTableColumnAlignment('none'),
            },
            {
                name: 'setTableColumnWidth() with the width the column has', markdown: '| a | b |\n| - {width=120} | - |\n| c | d |',
                select: (editor) => caretIn(editor, 'c', 1), run: (editor) => editor.setTableColumnWidth(120),
            },
            {
                name: 'setTableColumnWidth(null) in a column with no width', markdown: TABLE,
                select: (editor) => caretIn(editor, 'c', 1), run: (editor) => editor.setTableColumnWidth(null),
            },
            {
                name: 'setTableColumnWidth(null) in a column with no width beside one that has one', markdown: '| a | b |\n| - | - {width=80} |\n| c | d |',
                select: (editor) => caretIn(editor, 'c', 1), run: (editor) => editor.setTableColumnWidth(null),
            },
            {
                name: 'setBlockAlignment() with the alignment the ::: block has', markdown: '::: {align=center}\ntext\n:::',
                select: (editor) => caretIn(editor, 'text', 2), run: (editor) => editor.setBlockAlignment('center'),
            },
            {
                name: 'setBlockAlignment(null) in a ::: block of columns with no alignment', markdown: '::: columns\nA\n|||\nB\n:::',
                select: (editor) => caretIn(editor, 'A', 1), run: (editor) => editor.setBlockAlignment(null),
            },
            {
                name: 'setBlockAlignment(null) outside a ::: block', markdown: 'para',
                select: (editor) => caretIn(editor, 'para', 2), run: (editor) => editor.setBlockAlignment(null),
            },
            {
                name: 'setColumnCount() with the count the ::: block has', markdown: '::: columns\nA\n|||\nB\n:::',
                select: (editor) => caretIn(editor, 'A', 1), run: (editor) => editor.setColumnCount(2),
            },
            {
                name: 'setColumnCount() with the count and the gap the ::: block has', markdown: '::: columns {gap=2em}\nA\n|||\nB\n:::',
                select: (editor) => caretIn(editor, 'A', 1), run: (editor) => editor.setColumnCount(2, '2em'),
            },
            {
                name: 'setColumnCount(2, null) in a ::: block of two columns with no gap', markdown: '::: columns\nA\n|||\nB\n:::',
                select: (editor) => caretIn(editor, 'A', 1), run: (editor) => editor.setColumnCount(2, null),
            },
            {
                name: 'setColumnCount(1) outside a ::: block', markdown: 'para',
                select: (editor) => caretIn(editor, 'para', 2), run: (editor) => editor.setColumnCount(1),
            },
        ];

        it.each(ALREADY_SET)('$name changes nothing, adds no undo step and reports nothing', ({ markdown, select, run }) => {
            const untouched = editorOf(markdown);
            select(untouched);

            const undoDepth = undoDepthOf(untouched);
            const editor = editorOf(markdown);
            select(editor);

            const before = stateOf(editor);
            const updated = vi.fn();
            const reported = vi.fn();

            lexicalOf(editor).registerUpdateListener(updated);
            editor.on('selectionstate', reported);
            editor.on('change', reported);
            run(editor);

            expect(stateOf(editor)).toEqual(before);
            expect(before.value).toBe(markdown);
            expect(updated).not.toHaveBeenCalled();
            expect(reported).not.toHaveBeenCalled();
            expect(undoDepthOf(editor)).toBe(undoDepth);
        });

        it('a call that changes nothing leaves the edit made before it as the one Undo takes back', () => {
            const editor = editorOf('one\n\n| a | b |\n| :-: | - |\n| c | d |');

            selectBetween(editor, 'one', 0, 'one', 3);
            editor.toggleBold();
            editor.setBlockType('paragraph');
            caretIn(editor, 'c', 1);
            editor.setTableColumnAlignment('center');
            editor.setTableColumnWidth(null);

            expect(editor.getValue()).toBe('**one**\n\n| a | b |\n| :-: | - |\n| c | d |');

            lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

            expect(editor.getValue()).toBe('one\n\n| a | b |\n| :-: | - |\n| c | d |');
        });

        it('setBlockType() still converts when one of the blocks the selection touches is of another type', () => {
            const editor = editorOf('one\n\n# two');

            selectBetween(editor, 'one', 1, 'two', 2);
            editor.setBlockType('paragraph');

            expect(editor.getValue()).toBe('one\n\ntwo');
        });

        it('a table goes in for a range between a paragraph and a table cell, whichever way it was made, in place of the range', () => {
            for (const [from, to] of [['para', 'c'], ['c', 'para']]) {
                const editor = editorOf(`${PROSE_AND_TABLE}\n\nafter`);
                selectAcross(editor, from, to);

                expect(editor.getSelectionState().canInsertTable, `${from} to ${to}`).toBe(true);

                editor.insertTable(2, 2);

                expect(editor.getValue(), `${from} to ${to}`).toBe('p\n\n|  |  |\n| --- | --- |\n|  |  |\n\nafter');
            }
        });

        it('a table does not go in for a range inside one table, whichever way it was made', () => {
            for (const [from, to] of [['a', 'c'], ['c', 'a']]) {
                const editor = editorOf(PROSE_AND_TABLE);
                selectAcross(editor, from, to);

                expect(editor.getSelectionState().canInsertTable, `${from} to ${to}`).toBe(false);

                editor.insertTable(2, 2);

                expect(editor.getValue(), `${from} to ${to}`).toBe(PROSE_AND_TABLE);
            }
        });

        it('A4: the caret of that case sits in a node kept as Markdown source', () => {
            const editor = editorOf(SOURCE_RUN);
            caretIn(editor, '<span>', 3);

            const anchorIsSource = lexicalOf(editor).read(() => {
                const selection = $getSelection();

                return $isRangeSelection(selection) && selection.anchor.getNode() instanceof MarkdownSourceTextNode;
            });

            expect(anchorIsSource).toBe(true);
        });

        it('A9: with every command available, the format, style and link commands change the document', () => {
            for (const field of ['canFormat', 'canStyle', 'canLink'] as const) {
                for (const [command, run] of COMMANDS[field]) {
                    const editor = editorOf('hello world');
                    caretIn(editor, 'hello world', 'hello wo'.length);

                    const before = editor.getValue();

                    run(editor);

                    expect(editor.getValue(), command).not.toBe(before);
                }
            }
        });

        it('in a table cell an image still goes in, and with no selection a table still does, as the context reports', () => {
            const inCell = editorOf(TABLE);
            caretIn(inCell, 'c', 1);

            inCell.insertImage('https://x/a.png');

            expect(inCell.getValue()).toContain('![](https://x/a.png)');

            const unselected = editorOf('hello world');
            lexicalOf(unselected).update(() => { $setSelection(null); }, { discrete: true });

            unselected.insertTable(2, 2);

            expect(childTypes(unselected)).toContain('table');
        });

        it('A6: inside a link the format toggles still apply, as the context reports', () => {
            const editor = editorOf(LINK_PROSE);
            caretIn(editor, 'text', 2);

            editor.toggleBold();

            expect(editor.getValue()).not.toBe(LINK_PROSE);
            expect(editor.getSelectionState().bold).toBe(true);
        });

        describe('in a read-only editor', () => {
            for (const { name, markdown, select } of CASES) {
                it(`${name}: no command changes anything, adds an undo step or reports anything, and none is reported available`, () => {
                    const untouched = editorOf(markdown);
                    select(untouched);

                    const undoDepth = undoDepthOf(untouched);

                    for (const field of AVAILABILITY_FIELDS) {
                        for (const [command, run] of routesOf(field)) {
                            const editor = editorOf(markdown);
                            select(editor);
                            editor.setReadOnly(true);

                            const before = stateOf(editor);
                            const updated = vi.fn();
                            const reported = vi.fn();
                            const refused = vi.fn();

                            lexicalOf(editor).registerUpdateListener(updated);
                            editor.on('selectionstate', reported);
                            editor.on('change', reported);
                            editor.on('readonlyedit', refused);
                            run(editor);

                            expect(stateOf(editor), command).toEqual(before);
                            expect(updated, command).not.toHaveBeenCalled();
                            expect(reported, command).not.toHaveBeenCalled();
                            // C1: each refused command is reported once.
                            expect(refused, command).toHaveBeenCalledTimes(1);

                            // Undo is refused too while read-only, so the history is read once it is lifted.
                            editor.setReadOnly(false);

                            expect(undoDepthOf(editor), command).toBe(undoDepth);
                        }
                    }

                    const editor = editorOf(markdown);
                    select(editor);
                    editor.setReadOnly(true);

                    const state = editor.getSelectionState();

                    expect(REPORTED.filter((field) => state[field])).toEqual([]);
                });
            }

            it('unlinking, which no field covers, is refused too', () => {
                const editor = editorOf(LINK_PROSE);
                caretIn(editor, 'text', 2);
                editor.setReadOnly(true);

                editor.toggleLink(null);

                expect(editor.getValue()).toBe(LINK_PROSE);
            });

            it('C6: a command on a read-only editor that is not built yet is reported and does not build it', () => {
                const editor = new MarkdownEditor('hello world', { readOnly: true });
                const refused = vi.fn();

                editor.on('readonlyedit', refused);
                editor.toggleBold();
                editor.insertTable(2, 2);

                expect(refused).toHaveBeenCalledTimes(2);
                expect(lexicalOf(editor)).toBeNull();
            });

            it('"selectionstate" reports the fields turning false as the editor becomes read-only, and back as it becomes editable', () => {
                const editor = editorOf('hello world');
                caretIn(editor, 'hello world', 2);

                const reported: boolean[][] = [];
                editor.on('selectionstate', (state) => reported.push([state.canFormat, state.canInsertImage]));

                editor.setReadOnly(true);
                editor.setReadOnly(false);

                expect(reported).toEqual([[false, false], [true, true]]);
            });

            it('an editor constructed read-only reports no command available before it is built, and building it reports nothing', () => {
                const editor = new MarkdownEditor(`para\n\n${CODE_BLOCK}`, { readOnly: true });
                const reported = vi.fn();

                editor.on('selectionstate', reported);

                expect(REPORTED.filter((field) => editor.getSelectionState()[field])).toEqual([]);

                (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

                expect(reported).not.toHaveBeenCalled();
            });

            it('an editor made read-only before it is built reports the inserts turning off at once, and building it reports nothing more', () => {
                const editor = new MarkdownEditor('hello world');
                const reported: boolean[][] = [];

                editor.on('selectionstate', (state) => reported.push([state.canInsertTable, state.canInsertImage]));
                editor.setReadOnly(true);

                expect(reported).toEqual([[false, false]]);

                (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

                expect(reported).toEqual([[false, false]]);
            });

            it('setValue() still replaces the document: only editing commands are refused', () => {
                const editor = editorOf('hello world');
                editor.setReadOnly(true);

                editor.setValue('replaced');

                expect(editor.getValue()).toBe('replaced');
            });
        });

        it('classification reads the availability from the selection, not from the node the menu is built for', () => {
            const editor = editorOf(`${RAW_BLOCK}\n\ntext`);
            caretIn(editor, 'text', 2);

            const onRawBlock = lexicalOf(editor).read(() => $classifyContextMenuTarget($textNodeShowing(RAW_BLOCK)));

            expect(onRawBlock.availability).toEqual(IN_PROSE);
        });

        it('"selectionstate" reports canFormat turning false as the caret enters a raw block, and true as it leaves', () => {
            const editor = editorOf(`${RAW_BLOCK}\n\ntext`);
            caretIn(editor, 'text', 2);

            const reported: boolean[] = [];
            editor.on('selectionstate', (state) => reported.push(state.canFormat));

            caretIn(editor, RAW_BLOCK, 3);
            caretIn(editor, 'text', 2);

            expect(reported).toEqual([false, true]);
        });
    });

    describe('the menu built from a context', () => {
        const FORMAT_ROWS = [4, 5, 6, 7, 8];   // Cut, Copy, Paste, separator, then the five format rows.

        it('M1: a text context where formatting is unavailable dims the format rows, Text style and Insert link…', () => {
            const editor = new MarkdownEditor();
            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
                availability: { ...ALL_AVAILABLE, canFormat: false, canStyle: false, canLink: false },
            });

            expect(FORMAT_ROWS.map((index) => rowOf(items[index]).isEnabled())).toEqual([false, false, false, false, false]);
            expect(findItem(items, 'Text style')?.enabled).toBe(false);
            expect(findItem(items, 'Insert link…')?.enabled).toBe(false);
        });

        it('M2: with every command available, only what the selection lacks is dimmed', () => {
            const editor = new MarkdownEditor();
            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability: ALL_AVAILABLE,
            });

            expect(FORMAT_ROWS.map((index) => rowOf(items[index]).isEnabled())).toEqual([true, true, true, true, true]);
            expect(items.filter((item) => item.enabled === false)).toEqual([]);
        });

        it('M3: a text context in a link whose link commands are unavailable dims Edit link… and Remove link', () => {
            const editor = new MarkdownEditor();
            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: 'https://x', ...SOME_FORMATS,
                availability: { ...ALL_AVAILABLE, canLink: false, canRemoveLink: false },
            });

            expect(findItem(items, 'Edit link…')?.enabled).toBe(false);
            expect(findItem(items, 'Remove link')?.enabled).toBe(false);
        });

        it('M3: Edit link… and Remove link dim separately', () => {
            const editor = new MarkdownEditor();
            const build = (availability: CommandAvailability): MenuItemConfig[] => contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: 'https://x', ...SOME_FORMATS, availability,
            });

            const noEdit = build({ ...ALL_AVAILABLE, canLink: false });
            const noRemove = build({ ...ALL_AVAILABLE, canRemoveLink: false });

            expect([findItem(noEdit, 'Edit link…')?.enabled, findItem(noEdit, 'Remove link')?.enabled]).toEqual([false, true]);
            expect([findItem(noRemove, 'Edit link…')?.enabled, findItem(noRemove, 'Remove link')?.enabled]).toEqual([true, false]);
        });

        it('M4: a text context where block conversions are unavailable dims Block style, and leaves Alignment and Columns alone', () => {
            const editor = new MarkdownEditor();
            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
                availability: { ...ALL_AVAILABLE, canSetBlockType: false },
            });

            expect(findItem(items, 'Block style')?.enabled).toBe(false);
            expect(findItem(items, 'Alignment')?.enabled).not.toBe(false);
            expect(findItem(items, 'Columns')?.enabled).not.toBe(false);
        });

        it('a context where alignment and columns are unavailable dims Alignment and Columns, and leaves Block style alone', () => {
            const editor = new MarkdownEditor();
            const availability = { ...ALL_AVAILABLE, canSetBlockLayout: false };
            const text = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'text', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability,
            });
            const emptyLine = contextMenuMethodsOf(editor).buildContextMenuItems({ kind: 'empty-line', hasSelectedText: false, availability });

            expect(findItem(text, 'Alignment')?.enabled).toBe(false);
            expect(findItem(text, 'Columns')?.enabled).toBe(false);
            expect(findItem(text, 'Block style')?.enabled).not.toBe(false);
            expect(findItem(emptyLine, 'Columns')?.enabled).toBe(false);
            expect(findItem(emptyLine, 'Heading')?.enabled).not.toBe(false);
        });

        it('Clear formatting is dimmed where there is no format to clear, in the text and the table-cell menu', () => {
            const editor = new MarkdownEditor();

            for (const kind of ['text', 'table-cell'] as const) {
                const build = (canClearFormatting: boolean): MenuItemConfig[] => contextMenuMethodsOf(editor).buildContextMenuItems({
                    kind, hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability: { ...ALL_AVAILABLE, canClearFormatting },
                });

                expect(findItem(build(false), 'Clear formatting')?.enabled, kind).toBe(false);
                expect(findItem(build(true), 'Clear formatting')?.enabled, kind).toBe(true);
            }
        });

        it('the two Insert line items are dimmed where there is no block to put a line around, in the text and the table-cell menu', () => {
            const editor = new MarkdownEditor();

            for (const kind of ['text', 'table-cell'] as const) {
                const build = (canInsertParagraphAroundBlock: boolean): MenuItemConfig[] => contextMenuMethodsOf(editor).buildContextMenuItems({
                    kind, hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, hasEnclosingBlock: true,
                    availability: { ...ALL_AVAILABLE, canInsertParagraphAroundBlock },
                });
                const lines = (items: MenuItemConfig[]): Array<boolean | undefined> =>
                    ['Insert line before block', 'Insert line after block'].map((text) => findItem(items, text)?.enabled);

                expect(lines(build(false)), kind).toEqual([false, false]);
                expect(lines(build(true)), kind).toEqual([true, true]);
            }
        });

        it('the Table submenu dims its entries by three rules: the table the caret is in, cells to merge, a cell to unmerge', () => {
            const editor = new MarkdownEditor();
            const tableEntries = (availability: CommandAvailability): Record<string, boolean> => {
                const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                    kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS, availability,
                });
                const entries = (submenuItemsOf(findItem(items, 'Table')) ?? []).filter((item) => item.separator !== true);

                return Object.fromEntries(entries.map((item) => [item.text, item.enabled !== false]));
            };

            expect(tableEntries(ALL_AVAILABLE)).toEqual({
                'Insert': true, 'Delete': true, 'Merge cells': true, 'Unmerge cell': true, 'Column width…': true, 'Align column': true,
            });
            expect(tableEntries({ ...ALL_AVAILABLE, canEditTable: false })).toEqual({
                'Insert': false, 'Delete': false, 'Merge cells': true, 'Unmerge cell': true, 'Column width…': false, 'Align column': false,
            });
            expect(tableEntries({ ...ALL_AVAILABLE, canMergeCells: false })).toEqual({
                'Insert': true, 'Delete': true, 'Merge cells': false, 'Unmerge cell': true, 'Column width…': true, 'Align column': true,
            });
            expect(tableEntries({ ...ALL_AVAILABLE, canUnmergeCell: false })).toEqual({
                'Insert': true, 'Delete': true, 'Merge cells': true, 'Unmerge cell': false, 'Column width…': true, 'Align column': true,
            });
        });

        it('M5: an empty-line context dims Heading and each Insert entry by its own rule', () => {
            const editor = new MarkdownEditor();
            const build = (availability: CommandAvailability): MenuItemConfig[] => contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'empty-line', hasSelectedText: false, availability,
            });
            const insertEnabled = (items: MenuItemConfig[]): Record<string, boolean | undefined> => Object.fromEntries(
                (submenuItemsOf(findItem(items, 'Insert')) ?? [])
                    .filter((item) => item.separator !== true)
                    .map((item) => [item.text, item.enabled]),
            );

            const neither = build({ ...ALL_AVAILABLE, canSetBlockType: false, canInsertTable: false, canInsertImage: false });

            expect(findItem(neither, 'Heading')?.enabled).toBe(false);
            expect(insertEnabled(neither)).toEqual({
                'Quote': false, 'Code block': false, 'Bulleted list': false, 'Numbered list': false, 'Table': false, 'Image…': false,
            });

            const noBlockType = build({ ...ALL_AVAILABLE, canSetBlockType: false });

            expect(findItem(noBlockType, 'Heading')?.enabled).toBe(false);
            expect(insertEnabled(noBlockType)).toEqual({
                'Quote': false, 'Code block': false, 'Bulleted list': false, 'Numbered list': false, 'Table': true, 'Image…': true,
            });

            const noTable = build({ ...ALL_AVAILABLE, canInsertTable: false });

            expect(findItem(noTable, 'Heading')?.enabled).toBe(true);
            expect(insertEnabled(noTable)).toEqual({
                'Quote': true, 'Code block': true, 'Bulleted list': true, 'Numbered list': true, 'Table': false, 'Image…': true,
            });

            const noImage = build({ ...ALL_AVAILABLE, canInsertImage: false });

            expect(insertEnabled(noImage)).toEqual({
                'Quote': true, 'Code block': true, 'Bulleted list': true, 'Numbered list': true, 'Table': true, 'Image…': false,
            });
        });

        it('M6: a table-cell context where formatting is unavailable dims the format rows and keeps the Table submenu', () => {
            const editor = new MarkdownEditor();
            const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                kind: 'table-cell', hasSelectedText: true, linkUrl: null, ...SOME_FORMATS,
                availability: { ...ALL_AVAILABLE, canFormat: false, canStyle: false, canLink: false },
            });

            expect(FORMAT_ROWS.map((index) => rowOf(items[index]).isEnabled())).toEqual([false, false, false, false, false]);
            expect(findItem(items, 'Text style')?.enabled).toBe(false);
            expect(findItem(items, 'Insert link…')?.enabled).toBe(false);
            expect(findItem(items, 'Table')).toBeDefined();
            expect(findItem(items, 'Table')?.enabled).not.toBe(false);
        });

        it('M7: a read-only editor\'s menu offers only Copy, enabled with text to copy, in every context', () => {
            const editor = new MarkdownEditor('', { readOnly: true });
            const copy = vi.spyOn(editor, 'copy').mockReturnValue(editor);

            for (const hasSelectedText of [true, false]) {
                const contexts: ContextMenuTarget[] = [
                    { kind: 'text', hasSelectedText, linkUrl: 'https://x', ...SOME_FORMATS, hasEnclosingBlock: true, availability: ALL_AVAILABLE },
                    { kind: 'table-cell', hasSelectedText, ...SOME_FORMATS, availability: ALL_AVAILABLE },
                    { kind: 'empty-line', hasSelectedText, availability: ALL_AVAILABLE },
                ];

                for (const context of contexts) {
                    const items = contextMenuMethodsOf(editor).buildContextMenuItems(context);

                    expect(items).toEqual([{ text: 'Copy', enabled: hasSelectedText, action: expect.any(Function) }]);

                    copy.mockClear();
                    items[0].action?.();

                    expect(copy).toHaveBeenCalledOnce();
                }
            }
        });

        it('M7: an editor made read-only later offers only Copy, and the full menu again once editable', () => {
            const editor = new MarkdownEditor();
            const context: ContextMenuTarget = { kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE };

            editor.setReadOnly(true);

            expect(contextMenuMethodsOf(editor).buildContextMenuItems(context).map((item) => item.text)).toEqual(['Copy']);

            editor.setReadOnly(false);

            expect(findItem(contextMenuMethodsOf(editor).buildContextMenuItems(context), 'Paste')).toBeDefined();
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
            underline: false, hasEnclosingBlock: false, linkUrl: null, availability: IN_PROSE,
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

describe('MarkdownEditor link, format and paste command fixes', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    const SOURCE_RUN = 'kept <span>x</span> source';
    const TABLE = '| a | b |\n| - | - |\n| c | d |\n\nafter';

    /** Builds an editor showing `markdown`. */
    function editorOf(markdown: string): MarkdownEditor {
        const editor = new MarkdownEditor();

        editor.setValue(markdown);

        return editor;
    }

    /** The first text node showing exactly `text`. Call inside a Lexical read or update. */
    function $textNodeShowing(text: string): TextNode {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);

        if (node === undefined) {
            throw new Error(`text node "${text}" not found`);
        }

        return node;
    }

    /** Places a collapsed caret at `offset` in the first text node showing exactly `text`. */
    function caretIn(editor: MarkdownEditor, text: string, offset: number): void {
        lexicalOf(editor).update(() => { $textNodeShowing(text).select(offset, offset); }, { discrete: true });
    }

    /** Selects from `fromOffset` in the text node showing `from` to `toOffset` in the one showing `to`, as code does (no cached format). */
    function selectFromCode(editor: MarkdownEditor, from: string, fromOffset: number, to: string, toOffset: number): void {
        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();

            selection.anchor.set($textNodeShowing(from).getKey(), fromOffset, 'text');
            selection.focus.set($textNodeShowing(to).getKey(), toOffset, 'text');
            $setSelection(selection);
        }, { discrete: true });
    }

    /** Where the selection is, by place rather than node key, and the format and style pending at it. */
    function selectionPlaceOf(editor: MarkdownEditor): string {
        return lexicalOf(editor).read(() => {
            const selection = $getSelection();

            if (!$isRangeSelection(selection)) {
                return 'not a range';
            }

            const place = (point: RangeSelection['anchor']): string => {
                const path: number[] = [];

                for (let node: LexicalNode | null = point.getNode(); node !== null && node.getParent() !== null; node = node.getParent()) {
                    path.unshift(node.getIndexWithinParent());
                }

                return `${path.join('/')}:${point.offset}:${point.type}`;
            };

            return [place(selection.anchor), place(selection.focus), selection.format, selection.style].join('|');
        });
    }

    /** How many steps Undo can take. */
    function undoDepthOf(editor: MarkdownEditor): number {
        const lexical = lexicalOf(editor);
        let depth = 0;
        let before = null;

        while (before !== lexical.getEditorState()) {
            before = lexical.getEditorState();
            lexical.dispatchCommand(UNDO_COMMAND, undefined);
            depth += 1;
        }

        return depth - 1;
    }

    /** Classifies the way a keyboard-opened menu does: its event target resolves to the root. */
    function classifyAtCaret(editor: MarkdownEditor): ContextMenuTarget {
        return lexicalOf(editor).read(() => $classifyContextMenuTarget($contextMenuNodeFor($getRoot())));
    }

    /** Types `text` at the selection, as the keyboard does. */
    function typeText(editor: MarkdownEditor, text: string): void {
        lexicalOf(editor).update(() => { ($getSelection() as RangeSelection).insertText(text); }, { discrete: true });
    }

    /** Dispatches the command Lexical's key and input handlers dispatch for a format. */
    function dispatchFormat(editor: MarkdownEditor, format: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'): void {
        lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, format);
    }

    describe('S: the format shortcuts read canFormat', () => {
        it('S7: bold pending in a kept-source run is not applied to the text typed next', () => {
            const editor = editorOf(SOURCE_RUN);
            caretIn(editor, '<span>', 3);

            dispatchFormat(editor, 'bold');
            typeText(editor, 'Q');

            expect(editor.getValue()).toBe('kept Qx</span> source');
        });

        it('S8: bold pending at a caret in a word is applied to the text typed next', () => {
            const editor = editorOf('hello world');
            caretIn(editor, 'hello world', 8);

            dispatchFormat(editor, 'bold');
            typeText(editor, 'Q');

            expect(editor.getValue()).toBe('hello wo**Q**rld');
        });
    });

    describe('D: a command declined after trying puts back all the selection carried', () => {
        const CASES: Array<{ name: string; markdown: string; text: string; offset: number; run: (editor: MarkdownEditor) => void; pending?: boolean }> = [
            { name: 'D1: toggleUnderline() over a plus', markdown: '**a+b** x', text: 'a+b', offset: 1, run: (editor) => editor.toggleUnderline() },
            { name: 'D2: setTextColor() over a bracket', markdown: '**a]b** x', text: 'a]b', offset: 1, run: (editor) => editor.setTextColor('#f00') },
            { name: 'D3: toggleBold() in code beside parentheses', markdown: 'x`(a)`b', text: '(a)', offset: 1, run: (editor) => editor.toggleBold() },
            { name: 'D4: toggleLink() with a URL holding a line break', markdown: 'hello world', text: 'hello world', offset: 8, run: (editor) => editor.toggleLink('a\nb') },
            {
                name: 'D5: D1 with a format and a style pending at the caret', markdown: '**a+b** x', text: 'a+b', offset: 1,
                run: (editor) => editor.toggleUnderline(), pending: true,
            },
        ];

        for (const { name, markdown, text, offset, run, pending } of CASES) {
            it(`${name}: changes nothing, leaves the caret and what is pending at it, and adds no undo step`, () => {
                const editor = editorOf(markdown);
                caretIn(editor, text, offset);

                if (pending === true) {
                    lexicalOf(editor).update(() => {
                        const selection = $getSelection() as RangeSelection;

                        selection.setFormat(2);
                        selection.setStyle('color: red');
                    }, { discrete: true });
                }

                const value = editor.getValue();
                const place = selectionPlaceOf(editor);
                const untouched = editorOf(markdown);
                caretIn(untouched, text, offset);

                const undoDepth = undoDepthOf(untouched);
                const state = editor.getSelectionState();
                const reported = vi.fn();

                editor.on('change', reported);
                editor.on('selectionstate', reported);
                run(editor);

                expect(editor.getValue()).toBe(value);
                expect(selectionPlaceOf(editor)).toBe(place);
                expect(reported).not.toHaveBeenCalled();
                expect(editor.getSelectionState()).toEqual(state);
                expect(undoDepthOf(editor)).toBe(undoDepth);
            });
        }

        /** Runs `run` at a range over `a+b`, which no format can be saved on, and checks it changed and reported nothing. */
        function expectRangeLeftAlone(run: (editor: MarkdownEditor) => void): void {
            const editor = editorOf('a+b x');

            selectFromCode(editor, 'a+b x', 0, 'a+b x', 3);

            const place = selectionPlaceOf(editor);
            const untouched = editorOf('a+b x');

            selectFromCode(untouched, 'a+b x', 0, 'a+b x', 3);

            const undoDepth = undoDepthOf(untouched);
            const reported = vi.fn();

            editor.on('change', reported);
            editor.on('selectionstate', reported);
            run(editor);

            expect(editor.getValue()).toBe('a+b x');
            expect(selectionPlaceOf(editor)).toBe(place);
            expect(reported).not.toHaveBeenCalled();
            expect(undoDepthOf(editor)).toBe(undoDepth);
        }

        it('D6: toggleUnderline() over a range holding a plus is left as it was (control)', () => {
            expectRangeLeftAlone((editor) => editor.toggleUnderline());
        });

        it('D7: the underline command route over the same range changes nothing either (control)', () => {
            expectRangeLeftAlone((editor) => dispatchFormat(editor, 'underline'));
        });
    });

    describe('F: every format is read from the selected text', () => {
        const FORMATS: Array<{ format: 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code'; markdown: string; toggle: (editor: MarkdownEditor) => unknown }> = [
            { format: 'bold', markdown: '**c** x', toggle: (editor) => editor.toggleBold() },
            { format: 'italic', markdown: '*c* x', toggle: (editor) => editor.toggleItalic() },
            { format: 'strikethrough', markdown: '~~c~~ x', toggle: (editor) => editor.toggleStrikethrough() },
            { format: 'underline', markdown: '++c++ x', toggle: (editor) => editor.toggleUnderline() },
            { format: 'code', markdown: '`c` x', toggle: (editor) => editor.toggleInlineCode() },
        ];

        for (const { format, markdown, toggle } of FORMATS) {
            it(`F1-F4: ${format} on a word selected from code reads as on, comes off and goes back on, by method and by command`, () => {
                const viaCommand = editorOf(markdown);

                selectFromCode(viaCommand, 'c', 0, 'c', 1);
                dispatchFormat(viaCommand, format);

                expect(viaCommand.getValue()).toBe('c x');

                dispatchFormat(viaCommand, format);

                expect(viaCommand.getValue()).toBe(markdown);

                const editor = editorOf(markdown);

                selectFromCode(editor, 'c', 0, 'c', 1);

                expect(editor.getSelectionState()[format]).toBe(true);
                expect((classifyAtCaret(editor) as unknown as Record<string, boolean>)[format]).toBe(true);

                toggle(editor);

                expect(editor.getValue()).toBe('c x');

                toggle(editor);

                expect(editor.getValue()).toBe(markdown);
            });
        }

        it('F5: underline reads as off over a range reaching text that has none, and the toggle puts it on the whole range', () => {
            const editor = editorOf('++c++ x');

            selectFromCode(editor, 'c', 0, ' x', 2);

            expect(editor.getSelectionState().underline).toBe(false);

            editor.toggleUnderline();

            expect(editor.getValue()).toBe('++c x++');

            editor.toggleUnderline();

            expect(editor.getValue()).toBe('c x');
        });

        it('F6: underline reads as on over a range across a soft line break inside the span, and the toggle takes it off', () => {
            const editor = editorOf('++a\nb++ x');

            selectFromCode(editor, 'a', 0, 'b', 1);

            expect(editor.getSelectionState().underline).toBe(true);

            editor.toggleUnderline();

            expect(editor.getValue()).toBe('a\nb x');
        });
    });

    describe('L: links', () => {
        it('L1: a caret between two spaces links nothing', () => {
            const editor = editorOf('a  b word');
            caretIn(editor, 'a  b word', 2);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('a  b word');
            expect(editor.getSelectionState().canLink).toBe(false);
        });

        it('L2: a caret after a full stop links nothing', () => {
            const editor = editorOf('Left column.');
            caretIn(editor, 'Left column.', 12);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('Left column.');
        });

        it('L3: a caret in a word links the word', () => {
            const editor = editorOf('hello world');
            caretIn(editor, 'hello world', 8);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('hello [world](https://z)');
        });

        it('L4: a caret inside a link re-points the link though no word is under it', () => {
            const editor = editorOf('A [te  xt](https://x) link.');
            caretIn(editor, 'te  xt', 3);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('A [te  xt](https://z) link.');
        });

        it('L5: the image selected alone is wrapped', () => {
            const editor = editorOf('a ![i](/i.png) b');

            selectFromCode(editor, 'a ', 2, ' b', 0);

            expect(editor.getSelectionState().canLink).toBe(true);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('a [![i](/i.png)](https://z) b');
        });

        it('L6: a caret beside an image links nothing', () => {
            const editor = editorOf('![i](/i.png)');

            selectStart(editor);
            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('![i](/i.png)');
            expect(editor.getSelectionState().canLink).toBe(false);
        });

        it('L7: a caret between two spaces inside a bold run links the run', () => {
            const editor = editorOf('a **b  c** d');
            caretIn(editor, 'b  c', 2);

            editor.toggleLink('https://z');

            expect(editor.getValue()).toBe('a **[b  c](https://z)** d');
        });

        it('L8: Insert link… is enabled exactly when canLink is true, whatever hasSelectedText says', () => {
            const editor = new MarkdownEditor();
            const availabilityWith = (canLink: boolean): CommandAvailability => ({ ...ALL_AVAILABLE, canLink });

            for (const kind of ['text', 'table-cell'] as const) {
                for (const hasSelectedText of [true, false]) {
                    for (const canLink of [true, false]) {
                        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
                            kind, hasSelectedText, linkUrl: null, ...SOME_FORMATS, availability: availabilityWith(canLink),
                        });

                        expect(findItem(items, 'Insert link…')?.enabled, `${kind} ${hasSelectedText} ${canLink}`).toBe(canLink);
                    }
                }
            }
        });
    });

    describe('P: paste', () => {
        /** Selects the two cells of the last row, from the first to the second or the other way round. */
        function selectCells(editor: MarkdownEditor, backward: boolean = false): void {
            lexicalOf(editor).update(() => {
                const table = $getRoot().getChildren().find((node) => node.getType() === 'table') as TableNode;
                const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

                $setSelection($createTableSelectionFrom(table, backward ? second : first, backward ? first : second));
            }, { discrete: true });
        }

        it('P1: pasted into selected table cells, the text goes into the cell the selection began in', async () => {
            const editor = editorOf(TABLE);
            selectCells(editor);
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('PASTED');

            const pasted = await editor.paste();

            expect(pasted).toBe(true);
            expect(editor.getValue()).toBe('| a | b |\n| --- | --- |\n| PASTED | d |\n\nafter');
        });

        it('P2: with the cells selected backward the text goes into the cell the selection began in', async () => {
            const editor = editorOf(TABLE);
            selectCells(editor, true);
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('PASTED');

            await editor.paste();

            expect(editor.getValue()).toContain('| c | PASTED |');
        });

        it('P3: tabbed text pasted into selected cells gives what Ctrl/Cmd+V gives', async () => {
            const text = 'x\ty\nz\tw';
            const viaMethod = editorOf(TABLE);
            const viaKeyboard = editorOf(TABLE);

            selectCells(viaMethod);
            selectCells(viaKeyboard);
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(text);
            await viaMethod.paste();

            vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
            vi.stubGlobal('DragEvent', class DragEvent {});
            vi.stubGlobal('InputEvent', class InputEvent {});
            vi.stubGlobal('KeyboardEvent', class KeyboardEvent {});

            const event = Object.assign(new ClipboardEvent('paste'), {
                clipboardData: { types: ['text/plain'], files: [], getData: (type: string) => (type === 'text/plain' ? text : '') },
                preventDefault: () => {},
            });

            lexicalOf(viaKeyboard).update(() => { lexicalOf(viaKeyboard).dispatchCommand(PASTE_COMMAND, event); }, { discrete: true });
            vi.unstubAllGlobals();

            expect(viaMethod.getValue()).toBe(viaKeyboard.getValue());
            expect(viaMethod.getValue()).not.toBe(editorOf(TABLE).getValue());
        });

        it('P4: with no selection the text goes in at the document end', async () => {
            const editor = editorOf('hello world');
            lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

            const pasted = await editor.paste();

            expect(pasted).toBe(true);
            expect(editor.getValue()).toBe('hello worldX');
        });

        it('P5: with no selection in a document ending in a code block the text joins the code', async () => {
            const editor = editorOf('para\n\n```\ncode\n```');
            lexicalOf(editor).update(() => { $setSelection(null); }, { discrete: true });
            vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

            await editor.paste();

            expect(editor.getValue()).toContain('codeX');
        });
    });
});
