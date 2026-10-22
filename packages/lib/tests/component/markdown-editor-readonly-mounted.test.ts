// @vitest-environment jsdom
//
// A read-only `MarkdownEditor` keeps its WYSIWYG surface `contenteditable`,
// so the browser gives it a caret and keyboard selection, and refuses every
// edit in layers: Lexical is not editable, a command guard stands ahead of
// every editing command, the surface cancels the edits the browser announces,
// and for one it cannot cancel the view is taken out before the browser makes
// it and rendered anew after. Three of the four only act
// on real DOM events reaching the editor's own surface as Lexical's root,
// which the modelled test DOM never provides. This file keeps the
// `@vitest-environment jsdom` pragma, mounts the editor's own surface into
// the document as the editor's WYSIWYG mount does, sends it real DOM events,
// and must not call installTestDOM. `Event` here is the DOM's class, so the
// file must not import `~/core/Event`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $getRoot, $getSelection, $isElementNode, $isRangeSelection, $setSelection,
    BEFORE_INPUT_COMMAND, CLEAR_EDITOR_COMMAND, CLEAR_HISTORY_COMMAND, CLICK_COMMAND, CONTROLLED_TEXT_INSERTION_COMMAND, COPY_COMMAND,
    DELETE_CHARACTER_COMMAND, DELETE_LINE_COMMAND, DELETE_WORD_COMMAND, FOCUS_COMMAND, FORMAT_ELEMENT_COMMAND,
    FORMAT_TEXT_COMMAND, INSERT_LINE_BREAK_COMMAND, INSERT_PARAGRAPH_COMMAND, INSERT_TAB_COMMAND, PASTE_COMMAND,
    REMOVE_TEXT_COMMAND, SELECTION_CHANGE_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { LexicalCommand, LexicalEditor, LexicalNode, RangeSelection, TextNode } from 'lexical';
import { INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';
import { $createTableSelectionFrom, INSERT_TABLE_COMMAND } from '@lexical/table';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownEditorSelectionState } from '~/component/editor/MarkdownEditor';
import { READ_ONLY_ALLOWED_COMMANDS, READ_ONLY_REFUSED_COMMANDS } from '~/component/editor/markdownReadOnly';
import { ReadOnlyFlash } from '~/component/editor/ReadOnlyFlash';
import { Component } from '~/core/Component';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import type { TextField } from '~/component/input/TextField';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';

/** The editors a test built, disposed after it. */
const built: MarkdownEditor[] = [];

// jsdom has neither class, and Lexical's handlers tell events apart by class name.
beforeEach(() => {
    class ClipboardEvent extends Event {
        clipboardData = { types: ['text/plain'], files: [], getData: (type: string): string => (type === 'text/plain' ? 'PASTED' : ''), setData: vi.fn() };
    }

    class DragEvent extends Event {
        dataTransfer = { types: ['text/plain'], files: [], getData: (): string => 'DROPPED', setData: vi.fn() };
    }

    vi.stubGlobal('ClipboardEvent', ClipboardEvent);
    vi.stubGlobal('DragEvent', DragEvent);

    // jsdom has no layout. With the surface focused, Lexical measures the caret it has written to scroll it into view.
    Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
});

afterEach(() => {
    built.splice(0).forEach((editor) => editor.dispose());   // before DOM.reset(), or a queued layout throws
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
});

/** Lets the microtasks waiting run: Lexical's mutation observer, and every deferred commit. */
const microtasks = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
        await Promise.resolve();
    }
};

/**
 * Lets everything an event sets off run, as it has by the time a browser
 * handles the next event: the microtasks, then the tasks already waiting
 * (the editor puts a selection back in one), then the microtasks those leave.
 */
const settle = async (): Promise<void> => {
    await microtasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await microtasks();
};

/** The document every route row runs on: formatted prose, a table and a list. */
const SOURCE = 'plain **bold** end\n\n| a | b |\n| - | - |\n| c | d |\n\n- one\n- two';

/** The private members the harness reaches. */
type Internals = { _editor: LexicalEditor; _wysiwyg: Component; _codeEditor: Component; mountWysiwyg(): void };

/** A mounted editor, its Lexical editor, the surface element Lexical renders into, and the DOM listeners the mount added. */
type Mounted = { editor: MarkdownEditor; lexical: LexicalEditor; root: HTMLElement; listened: string[] };

/**
 * Builds an editor and mounts its own WYSIWYG surface into the document as
 * Lexical's root, as the surface's first layout does in a browser.
 *
 * @param source - The Markdown to load.
 * @param readOnly - Whether the editor is constructed read-only.
 * @returns The editor, its Lexical editor, the root element, and the types of
 *   the listeners the mount added to the root, a table inside it or the document.
 */
function mounted(source: string, readOnly: boolean): Mounted {
    const editor = new MarkdownEditor(source, { readOnly });
    const internals = editor as unknown as Internals;

    built.push(editor);
    (DOM.sink as ProductionDOMSink).appendChild((DOM.source as ProductionDOMSource).getBody(), editor.getElement(true)!);
    internals._wysiwyg.getElement(true);

    const added: [EventTarget, string][] = [];
    const original = EventTarget.prototype.addEventListener;
    const spy = vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, ...args: unknown[]): void {
        added.push([this, args[0] as string]);

        return (original as (...rest: unknown[]) => void).apply(this, args);
    });

    internals.mountWysiwyg();
    spy.mockRestore();

    const root = internals._editor.getRootElement() as HTMLElement;

    // The surface holds the keyboard, as it does whenever a key, a paste or a composition reaches it.
    root.focus();

    const isRoute = (target: EventTarget): boolean =>
        target === root || target === document || (target instanceof HTMLTableElement && root.contains(target));
    const listened = [...new Set(added.filter(([target]) => isRoute(target)).map(([, type]) => type))].sort();

    return { editor, lexical: internals._editor, root, listened };
}

/** The first text node showing exactly `text`. Call inside a Lexical read or update. */
function $textNodeShowing(text: string): TextNode {
    const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text);

    if (node === undefined) {
        throw new Error(`text node "${text}" not found`);
    }

    return node;
}

/** The element Lexical rendered for the text node showing `text`. */
function elementOf({ lexical }: Mounted, text: string): HTMLElement {
    const key = lexical.read(() => $textNodeShowing(text).getKey());

    return lexical.getElementByKey(key) as HTMLElement;
}

/** The DOM text node inside the element Lexical rendered for the text node showing `text`. */
function domTextOf(m: Mounted, text: string): Text {
    let leaf: Node = elementOf(m, text);

    while (leaf.firstChild !== null) {
        leaf = leaf.firstChild;
    }

    return leaf as Text;
}

/**
 * Selects `from`..`to` in the text node showing `text`, in Lexical. On an
 * editable editor Lexical writes the selection to the browser, which then
 * reports it with a `selectionchange` that Lexical expects and passes over;
 * jsdom reports none, so it is sent here. Without it Lexical would pass over
 * the next real one instead.
 */
function selectIn({ lexical }: Mounted, text: string, from: number, to: number = from): void {
    lexical.update(() => { $textNodeShowing(text).select(from, to); }, { discrete: true });

    const wroteBrowserSelection = lexical.isEditable();

    if (wroteBrowserSelection) {
        document.dispatchEvent(new Event('selectionchange'));
    }
}

/** Moves the browser's selection as a key or the mouse does, and tells the document, as a browser then does. */
async function browserSelects(m: Mounted, text: string, from: number, to: number = from): Promise<void> {
    const domText = domTextOf(m, text);

    window.getSelection()?.setBaseAndExtent(domText, from, domText, to);
    document.dispatchEvent(new Event('selectionchange'));
    await settle();
}

/**
 * The route rows' editor: {@link SOURCE} with one edit made, so Undo has a
 * step, the caret in `plain`, and read-only switched on last.
 *
 * @param readOnly - Whether to switch read-only on at the end.
 * @returns The mounted editor.
 */
function prepared(readOnly: boolean = true): Mounted {
    const m = mounted(SOURCE.slice(0, -1), false);

    m.lexical.update(() => {
        $textNodeShowing('tw').select(2, 2);
        ($getSelection() as RangeSelection).insertText('o');
    }, { discrete: true });
    selectIn(m, 'plain ', 2);

    if (readOnly) {
        m.editor.setReadOnly(true);
    }

    return m;
}

/** Where the selection is and what it carries. */
function selectionOf({ lexical }: Mounted): string {
    return lexical.read(() => {
        const selection = $getSelection();
        const isRange = $isRangeSelection(selection);

        if (isRange) {
            const points = [selection.anchor, selection.focus].map((point) => `${point.key}:${point.offset}:${point.type}`);

            return ['range', ...points, selection.format, selection.style].join('|');
        }

        return selection === null ? 'none' : `cells|${selection.getNodes().map((node) => node.getKey()).join(',')}`;
    });
}

/** Every node of the document, by key and type, nested as the tree is. */
function nodesOf({ lexical }: Mounted): string {
    const describeNode = (node: LexicalNode): string => {
        const children = $isElementNode(node) ? `[${node.getChildren().map(describeNode).join(',')}]` : '';

        return `${node.getKey()}:${node.getType()}${children}`;
    };

    return lexical.read(() => describeNode($getRoot()));
}

/** How many steps Undo can take: it is pressed until a press changes nothing, which leaves the editor undone. */
function undoDepthOf({ lexical }: Mounted): number {
    let depth = 0;
    let before = null;
    let state = lexical.getEditorState();

    while (before !== state) {
        before = state;
        lexical.dispatchCommand(UNDO_COMMAND, undefined);
        state = lexical.getEditorState();
        depth += 1;
    }

    return depth - 1;
}

/** What "nothing changes" compares: the saved Markdown, every node, the selection, and what is shown. */
type Snapshot = { value: string; nodes: string; selection: string; html: string };

/** Takes the snapshot "nothing changes" is compared with. */
function snapshotOf(m: Mounted): Snapshot {
    return { value: m.editor.getValue(), nodes: nodesOf(m), selection: selectionOf(m), html: m.root.innerHTML };
}

/** Counts an editor's `"change"` and `"readonlyedit"` events and the pulses of its rejection wash from here on. */
function watch(m: Mounted): { changes: () => number; refusals: () => number; flashes: () => number } {
    let changes = 0;
    let refusals = 0;
    const flash = (m.editor as unknown as { _flash: ReadOnlyFlash })._flash;
    const play = vi.spyOn(flash, 'play');
    const playedBefore = play.mock.calls.length;   // a second spy on one wash is the first one again

    m.editor.on('change', () => { changes += 1; });
    m.editor.on('readonlyedit', () => { refusals += 1; });

    return { changes: () => changes, refusals: () => refusals, flashes: () => play.mock.calls.length - playedBefore };
}

/** The undo depth of {@link prepared}'s editor with nothing done to it. */
function untouchedUndoDepth(): number {
    return undoDepthOf(prepared(false));
}

/** Lifts read-only and expects the undo history to be what an untouched editor's is. */
function expectUntouchedHistory(m: Mounted): void {
    m.editor.setReadOnly(false);

    expect(undoDepthOf(m)).toBe(untouchedUndoDepth());
}

/** Builds a `ClipboardEvent` of the stubbed class. */
function clipboardEvent(type: string): Event {
    return new ClipboardEvent(type, { bubbles: true, cancelable: true });
}

/** Builds a `DragEvent` of the stubbed class. */
function dragEvent(type: string): Event {
    return new DragEvent(type, { bubbles: true, cancelable: true });
}

/** The modifier keys held with a key, and whether the event is a held key's repeat. */
type KeyModifiers = { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean; isComposing?: boolean };

/** Builds a cancelable `keydown`. */
function keydown(key: string, modifiers: KeyModifiers = {}): Event {
    return new KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
}

/** Builds a `beforeinput`. */
function beforeInput(inputType: string, cancelable: boolean): Event {
    return new InputEvent('beforeinput', { inputType, data: 'Z', bubbles: true, cancelable });
}

/** Builds the `input` a browser sends once it has changed the shown text. */
function inputEvent(inputType: string = 'insertCompositionText'): Event {
    return new InputEvent('input', { inputType, data: 'Z', bubbles: true });
}

/**
 * Announces an edit that cannot be cancelled, as a browser does for a
 * composition's text: a `beforeinput` on the element the caret is in.
 */
function announceUnpreventable(m: Mounted, text: string = 'plain '): void {
    elementOf(m, text).dispatchEvent(beforeInput('insertCompositionText', false));
}

/**
 * What a browser does next: it writes at the caret. That is in the text node
 * the caret was in where that node is still shown, and in the surface itself
 * where it is not.
 */
function browserWrites(m: Mounted, at: Text): void {
    if (at.isConnected) {
        at.data = `Z${at.data}`;
    } else {
        m.root.append(document.createTextNode('Z'));
    }
}

/** Where a route's event is dispatched. */
type RouteTarget = 'text' | 'root' | 'cell' | 'document';

/** One event of a route, and what the read-only editor is expected to do with it beyond changing nothing. */
type RouteVariant = { name: string; build: () => Event; target?: RouteTarget; prevented?: boolean; refusals?: number };

const BEFORE_INPUT_CANCELABLE = [
    'insertText', 'insertReplacementText', 'insertLineBreak', 'insertParagraph', 'insertFromPaste', 'insertFromDrop',
    'insertFromYank', 'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteByCut', 'deleteByDrag',
    'historyUndo', 'historyRedo', 'formatBold', 'formatItalic', 'formatUnderline', 'insertOrderedList',
];

/**
 * Every DOM event Lexical or its table plugin listens for on the surface, a
 * table or the document, with the variants sent to the read-only editor. Row
 * R0 holds the keys to the listeners a mount really adds. Unless a variant
 * says otherwise, the event is not cancelled and no refusal is signalled.
 */
const ROUTES: Record<string, RouteVariant[]> = {
    keydown: [
        ['Enter'], ['Backspace'], ['Delete'], ['Tab'], [' '], ['a'], ['z'], ['b', { ctrlKey: true }], ['i', { ctrlKey: true }],
        ['a', { ctrlKey: true }], ['c', { ctrlKey: true }], ['ArrowRight'], ['z', { ctrlKey: true, altKey: true }],
        ['ArrowLeft', { shiftKey: true }], ['Home'], ['End'], ['Escape'], ['Tab', { shiftKey: true }], ['PageDown'],
        ['Backspace', { ctrlKey: true }], ['Enter', { shiftKey: true }], ['Enter', { ctrlKey: true }],
        // The undo and redo keys are stopped, quietly: see row R16. So is a held Enter: row L16.
        ['z', { ctrlKey: true }, true], ['y', { ctrlKey: true }, true], ['z', { ctrlKey: true, shiftKey: true }, true],
        ['Backspace', { altKey: true }, true], ['Backspace', { altKey: true, shiftKey: true }, true],
        ['Enter', { repeat: true }, true], ['a', { repeat: true }],
    ].map(([key, modifiers, prevented]) => ({
        name:      `${modifiers ? Object.keys(modifiers).join('+') + '+' : ''}${JSON.stringify(key)}`,
        build:     (): Event => keydown(key as string, modifiers as KeyModifiers | undefined),
        prevented: prevented === true,
    })),
    beforeinput: [
        ...BEFORE_INPUT_CANCELABLE.map((inputType) => ({ name: inputType, build: (): Event => beforeInput(inputType, true), prevented: true, refusals: 1 })),
        // An edit that cannot be cancelled is reported too, where the browser announces it: rows R22 to R26 hold what else happens.
        ...['insertCompositionText', 'deleteCompositionText'].map((inputType) => ({ name: `${inputType}, not cancelable`, build: (): Event => beforeInput(inputType, false), refusals: 1 })),
    ],
    paste:            [{ name: 'paste', build: (): Event => clipboardEvent('paste'), prevented: true, refusals: 1 }],
    cut:              [{ name: 'cut', build: (): Event => clipboardEvent('cut'), prevented: true, refusals: 1 }],
    drop:             [{ name: 'drop', build: (): Event => dragEvent('drop'), prevented: true, refusals: 1 }],
    // A composition's start is no edit yet: an on-screen keyboard starts one around the word a tap puts the caret in.
    compositionstart: [{ name: 'compositionstart', build: (): Event => new CompositionEvent('compositionstart', { bubbles: true, cancelable: true }) }],
    compositionend:   [{ name: 'compositionend', build: (): Event => new CompositionEvent('compositionend', { bubbles: true, data: 'Z' }) }],
    // With nothing changed in the DOM: rows R6 to R8 and R14 send it after a change.
    input:            [{ name: 'input', build: (): Event => new InputEvent('input', { inputType: 'insertText', data: 'Z', bubbles: true }) }],
    dragstart:        [{ name: 'dragstart', build: (): Event => dragEvent('dragstart') }],
    dragover:         [{ name: 'dragover', build: (): Event => dragEvent('dragover') }],
    dragend:          [{ name: 'dragend', build: (): Event => dragEvent('dragend') }],
    click:            [
        { name: 'click', build: (): Event => new MouseEvent('click', { bubbles: true, cancelable: true }) },
        // Lexical listens for no auxclick; the surface does, for a link: rows L15.
        { name: 'auxclick, middle', build: (): Event => new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }) },
        { name: 'auxclick, secondary', build: (): Event => new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }) },
    ],
    pointerdown:      [{ name: 'pointerdown', build: (): Event => new MouseEvent('pointerdown', { bubbles: true, cancelable: true }) }],
    focus:            [{ name: 'focus', build: (): Event => new FocusEvent('focus'), target: 'root' }],
    blur:             [{ name: 'blur', build: (): Event => new FocusEvent('blur'), target: 'root' }],
    mousedown:        [{ name: 'mousedown', build: (): Event => new MouseEvent('mousedown', { bubbles: true, cancelable: true }), target: 'cell' }],
    // Lexical's copy handler writes the clipboard and cancels the event itself: row R9.
    copy:             [],
    // With the browser's selection where Lexical already has it: row R12 moves it.
    selectionchange:  [{ name: 'selectionchange', build: (): Event => new Event('selectionchange'), target: 'document' }],
};

/** The element a route's event is dispatched on. */
function targetOf(m: Mounted, target: RouteTarget | undefined): EventTarget {
    switch (target) {
        case 'root':     return m.root;
        case 'cell':     return m.root.querySelector('td') as HTMLElement;
        case 'document': return document;
        default:         return elementOf(m, 'plain ');
    }
}

describe('MarkdownEditor read-only, mounted: the surface', () => {
    it('S6: the mounted surface is the editing host, exposed as a read-only multi-line text box', () => {
        const { root } = mounted('# Hi', true);

        expect(root.getAttribute('contenteditable')).toBe('true');
        expect(root.getAttribute('role')).toBe('textbox');
        expect(root.getAttribute('aria-multiline')).toBe('true');
        expect(root.getAttribute('aria-readonly')).toBe('true');
        expect(root.hasAttribute('tabindex')).toBe(false);
    });

    it('S7: an editable editor\'s surface carries the same, with aria-readonly false', () => {
        const { root } = mounted('# Hi', false);

        expect(root.getAttribute('contenteditable')).toBe('true');
        expect(root.getAttribute('role')).toBe('textbox');
        expect(root.getAttribute('aria-multiline')).toBe('true');
        expect(root.getAttribute('aria-readonly')).toBe('false');
    });

    it('S8: with contenteditable off the mounted surface is no text box, read-only or not, and is one again with it on', () => {
        const attributes = (root: HTMLElement): (string | null)[] => ['contenteditable', 'role', 'aria-multiline', 'aria-readonly'].map((name) => root.getAttribute(name));

        for (const readOnly of [true, false]) {
            const { editor, root } = mounted('# Hi', readOnly);

            editor.setContentEditable(false);

            expect(attributes(root), `read-only ${readOnly}`).toEqual(['false', null, null, null]);

            editor.setReadOnly(!readOnly);

            expect(attributes(root), `read-only ${!readOnly}`).toEqual(['false', null, null, null]);

            editor.setContentEditable(true);

            expect(attributes(root), `read-only ${!readOnly}, on again`).toEqual(['true', 'textbox', 'true', String(!readOnly)]);
        }
    });
});

describe('MarkdownEditor read-only, mounted: the command guard', () => {
    it('G1: every command the mounted editor has a handler for is either allowed or refused, and no command is both', () => {
        const { lexical } = mounted('| a | b |\n| - | - |\n| c | d |\n\n- one\n- two\n\ntext', false);
        const registered = [...(lexical as unknown as { _commands: Map<LexicalCommand<unknown>, unknown> })._commands.keys()];
        const allowed = new Set(READ_ONLY_ALLOWED_COMMANDS);
        const refused = new Set(READ_ONLY_REFUSED_COMMANDS);
        const unclassified = registered.filter((command) => !allowed.has(command) && !refused.has(command)).map((command) => command.type);
        const both = READ_ONLY_ALLOWED_COMMANDS.filter((command) => refused.has(command)).map((command) => command.type);
        // A command's listeners, over the five priorities. The guard's own listener is one of a refused command's.
        const commands = (lexical as unknown as { _commands: Map<LexicalCommand<unknown>, Array<{ size: number }>> })._commands;
        const listenersOf = (command: LexicalCommand<unknown>): number =>
            (commands.get(command) ?? []).reduce((count, listeners) => count + listeners.size, 0);
        const unhandled = [
            ...READ_ONLY_ALLOWED_COMMANDS.filter((command) => listenersOf(command) < 1),
            ...READ_ONLY_REFUSED_COMMANDS.filter((command) => listenersOf(command) < 2),
        ].map((command) => command.type);

        expect(unclassified).toEqual([]);
        expect(both).toEqual([]);
        // The lists hold nothing the editor has no handler for either, so a command that goes leaves them too.
        expect(unhandled).toEqual([]);
        expect(allowed.size).toBe(READ_ONLY_ALLOWED_COMMANDS.length);
        expect(refused.size).toBe(READ_ONLY_REFUSED_COMMANDS.length);
    });

    /** The payloads of the commands whose handlers would act on one; every other command gets none, the guard returning first. */
    const PAYLOADS = new Map(([
        [INSERT_PARAGRAPH_COMMAND, (): unknown => undefined],
        [DELETE_CHARACTER_COMMAND, (): unknown => true],
        [DELETE_WORD_COMMAND, (): unknown => true],
        [DELETE_LINE_COMMAND, (): unknown => true],
        [REMOVE_TEXT_COMMAND, (): unknown => undefined],
        [CONTROLLED_TEXT_INSERTION_COMMAND, (): unknown => 'Z'],
        [INSERT_LINE_BREAK_COMMAND, (): unknown => false],
        [INSERT_TAB_COMMAND, (): unknown => undefined],
        [FORMAT_TEXT_COMMAND, (): unknown => 'bold'],
        [FORMAT_ELEMENT_COMMAND, (): unknown => 'center'],
        [INSERT_UNORDERED_LIST_COMMAND, (): unknown => undefined],
        [INSERT_TABLE_COMMAND, (): unknown => ({ rows: '2', columns: '2' })],
        [UNDO_COMMAND, (): unknown => undefined],
        [CLEAR_EDITOR_COMMAND, (): unknown => undefined],
        [CLEAR_HISTORY_COMMAND, (): unknown => undefined],
        [PASTE_COMMAND, (): unknown => clipboardEvent('paste')],
    ] as [unknown, () => unknown][]) as [LexicalCommand<unknown>, () => unknown][]);

    it('G2: every refused command, dispatched on a read-only editor, is taken by the guard, changes nothing and signals once', async () => {
        const undoDepth = untouchedUndoDepth();

        for (const command of READ_ONLY_REFUSED_COMMANDS) {
            const m = prepared();
            const before = snapshotOf(m);
            const seen = watch(m);
            const handled = m.lexical.dispatchCommand(command, PAYLOADS.get(command)?.() as never);

            await settle();

            expect(handled, command.type).toBe(true);
            expect(snapshotOf(m), command.type).toEqual(before);
            expect(seen.changes(), command.type).toBe(0);
            expect(seen.refusals(), command.type).toBe(1);
            expect(seen.flashes(), command.type).toBe(1);

            m.editor.setReadOnly(false);

            expect(undoDepthOf(m), command.type).toBe(undoDepth);
        }
    });

    it('G3: the same commands reach their handlers on an editable editor, with no signal', () => {
        // The control for G2: each of these edits when the guard stands aside.
        for (const [command, payload] of PAYLOADS) {
            // Neither clears the document here: the history's listeners are the only ones for the two.
            const isHistoryOnly = command === CLEAR_HISTORY_COMMAND || command === CLEAR_EDITOR_COMMAND;
            const m = prepared(false);

            // A range: jsdom has no Selection.modify, which a deletion at a collapsed caret needs.
            selectIn(m, 'plain ', 0, 3);

            const before = snapshotOf(m);
            const seen = watch(m);

            m.lexical.dispatchCommand(command, payload() as never);

            expect(seen.refusals(), command.type).toBe(0);

            if (isHistoryOnly) {
                expect(undoDepthOf(m), command.type).toBe(0);
            } else {
                expect(snapshotOf(m), command.type).not.toEqual(before);
            }
        }
    });

    it('G4: the four allowed commands pass a read-only editor\'s guard, signal nothing and change nothing', async () => {
        const m = prepared();

        await browserSelects(m, 'plain ', 0, 5);

        const before = snapshotOf(m);
        const seen = watch(m);

        m.lexical.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined);
        m.lexical.dispatchCommand(CLICK_COMMAND, new MouseEvent('click'));
        m.lexical.dispatchCommand(COPY_COMMAND, clipboardEvent('copy') as ClipboardEvent);
        m.lexical.dispatchCommand(FOCUS_COMMAND, new FocusEvent('focus'));
        await settle();

        expect(seen.refusals()).toBe(0);
        expect(seen.changes()).toBe(0);
        expect(snapshotOf(m)).toEqual(before);
        expectUntouchedHistory(m);
    });

    it('G5: setContentEditable(true) on a read-only editor lifts nothing: the guard still refuses', () => {
        const m = prepared();
        const before = snapshotOf(m);
        const seen = watch(m);

        m.editor.setContentEditable(true);

        expect(m.lexical.isEditable()).toBe(false);
        expect(m.lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z')).toBe(true);
        expect(snapshotOf(m)).toEqual(before);
        expect(seen.refusals()).toBe(1);
    });
});

describe('MarkdownEditor read-only, mounted: DOM routes', () => {
    it('R0: the route table holds every event the mount listens for, and beforeinput', () => {
        // jsdom's InputEvent has no getTargetRanges, so Lexical registers no beforeinput listener here; a browser has it.
        const { listened } = mounted(SOURCE, true);

        expect(Object.keys(ROUTES).sort()).toEqual([...listened, 'beforeinput'].sort());
    });

    it('R1 to R5, R10, R11: no event of any route changes anything; an announced edit is cancelled and signalled once', async () => {
        const m = prepared();
        const before = snapshotOf(m);

        for (const [type, variants] of Object.entries(ROUTES)) {
            for (const variant of variants) {
                const label = `${type}: ${variant.name}`;
                const seen = watch(m);
                const event = variant.build();

                targetOf(m, variant.target).dispatchEvent(event);
                await settle();

                expect(snapshotOf(m), label).toEqual(before);
                expect(seen.changes(), label).toBe(0);
                expect(event.defaultPrevented, label).toBe(variant.prevented ?? false);
                expect(seen.refusals(), label).toBe(variant.refusals ?? 0);
                expect(seen.flashes(), label).toBe(variant.refusals ?? 0);
            }
        }

        expectUntouchedHistory(m);
    });

    it('R1, R4 on an editable editor: Enter splits the paragraph and a paste is inserted, with no signal', async () => {
        const enter = prepared(false);
        const enterSeen = watch(enter);
        const paragraphs = (m: Mounted): number => m.lexical.read(() => $getRoot().getChildrenSize());
        const before = paragraphs(enter);

        elementOf(enter, 'plain ').dispatchEvent(keydown('Enter'));
        await settle();

        expect(paragraphs(enter)).toBe(before + 1);
        expect(enterSeen.refusals()).toBe(0);

        const paste = prepared(false);
        const pasteSeen = watch(paste);

        elementOf(paste, 'plain ').dispatchEvent(clipboardEvent('paste'));
        await settle();

        expect(paste.editor.getValue()).toContain('plPASTEDain');
        expect(pasteSeen.refusals()).toBe(0);
    });

    it('R16: the undo and redo keys are stopped at the surface, so the browser\'s own undo never runs; an editable editor still undoes', async () => {
        // The browser's undo is the page's: left to run, the key would take back the last edit made in any other field.
        // The last two are the older pair a browser on Windows gives its undo and redo.
        const keys: [string, KeyModifiers][] = [
            ['z', { ctrlKey: true }], ['y', { ctrlKey: true }], ['z', { ctrlKey: true, shiftKey: true }],
            ['Backspace', { altKey: true }], ['Backspace', { altKey: true, shiftKey: true }],
        ];
        const readOnly = prepared();
        const before = snapshotOf(readOnly);
        const seen = watch(readOnly);

        for (const [key, modifiers] of keys) {
            const event = keydown(key, modifiers);

            elementOf(readOnly, 'plain ').dispatchEvent(event);

            expect(event.defaultPrevented, key).toBe(true);
        }

        expect(snapshotOf(readOnly)).toEqual(before);
        expect(seen.refusals()).toBe(0);
        expect(seen.flashes()).toBe(0);
        expectUntouchedHistory(readOnly);

        const editable = prepared(false);

        elementOf(editable, 'plain ').dispatchEvent(keydown('z', { ctrlKey: true }));
        await settle();

        // The one edit `prepared` makes is taken back: the key reached Lexical, and nothing of the surface stood in its way.
        expect(editable.editor.getValue()).toContain('- tw');
        expect(editable.editor.getValue()).not.toContain('- two');
    });

    it('R6: text the browser changed anyway is put back, and the document never takes it', async () => {
        const m = prepared();
        const before = snapshotOf(m);
        const seen = watch(m);
        const updates = vi.fn();

        m.lexical.registerUpdateListener(({ dirtyLeaves, dirtyElements }) => { updates(dirtyLeaves.size + dirtyElements.size); });
        domTextOf(m, 'plain ').data = 'plainZ ';
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
        await settle();

        expect(snapshotOf(m)).toEqual(before);
        expect(seen.changes()).toBe(0);
        expect(seen.refusals()).toBe(0);
        // The view is put back with no node marked changed, so no rule of the editor runs.
        expect(updates.mock.calls.filter(([dirty]) => dirty > 0)).toEqual([]);
        expectUntouchedHistory(m);
    });

    it('R6 on an editable editor: the same change stays in the document', async () => {
        const m = prepared(false);

        domTextOf(m, 'plain ').data = 'plainZ ';
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
        await settle();

        expect(m.editor.getValue()).toContain('plainZ ');
    });

    it('R7: a node the browser added is taken out again, by Lexical itself', async () => {
        const m = prepared();
        const before = snapshotOf(m);
        const seen = watch(m);

        m.root.querySelector('p')!.append(document.createTextNode('Z'));
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
        await settle();

        expect(snapshotOf(m)).toEqual(before);
        expect(seen.changes()).toBe(0);
        expectUntouchedHistory(m);
    });

    it('R8: text that reads as a Markdown shortcut is put back too, and the block stays a paragraph', async () => {
        const m = mounted('\\# x', false);

        selectIn(m, '# x', 2);
        m.editor.setReadOnly(true);

        const before = snapshotOf(m);

        domTextOf(m, '# x').data = '# Zx';
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
        await settle();

        expect(snapshotOf(m)).toEqual(before);
        expect(m.lexical.read(() => $getRoot().getFirstChild()?.getType())).toBe('paragraph');
    });

    it('R9: a copy by key copies the selection through Lexical\'s own handler and signals nothing', async () => {
        const m = prepared();

        await browserSelects(m, 'plain ', 0, 5);

        const before = snapshotOf(m);
        const seen = watch(m);
        const event = clipboardEvent('copy') as ClipboardEvent;

        elementOf(m, 'plain ').dispatchEvent(event);
        await settle();

        expect(event.clipboardData!.setData).toHaveBeenCalledWith('text/plain', 'plain');
        expect(snapshotOf(m)).toEqual(before);
        expect(seen.refusals()).toBe(0);
        expect(seen.changes()).toBe(0);
    });

    it('R12: the editor follows the browser\'s caret, and reports the state there with every command unavailable', async () => {
        const m = prepared();
        const value = m.editor.getValue();
        const nodes = nodesOf(m);
        const states: MarkdownEditorSelectionState[] = [];

        m.editor.on('selectionstate', (state) => states.push(state));
        await browserSelects(m, 'bold', 1);

        expect(states).toHaveLength(1);
        expect(states[0].bold).toBe(true);
        expect(Object.entries(states[0]).filter(([field, on]) => field.startsWith('can') && on === true)).toEqual([]);
        expect(m.lexical.read(() => ($getSelection() as RangeSelection).anchor.offset)).toBe(1);
        expect(m.editor.getValue()).toBe(value);
        expect(nodesOf(m)).toBe(nodes);
    });

    it('R13: a paste the table plugin takes off the document, with cells selected, is refused by the guard', async () => {
        const m = prepared();

        m.lexical.update(() => {
            const table = $getRoot().getChildren()[1] as TableNode;
            const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, first, second));
        }, { discrete: true });
        m.root.focus();

        const value = m.editor.getValue();
        const nodes = nodesOf(m);
        const seen = watch(m);
        const dispatched = vi.spyOn(m.lexical, 'dispatchCommand');

        document.body.dispatchEvent(clipboardEvent('paste'));
        await settle();

        expect(dispatched.mock.calls.map(([command]) => command)).toContain(PASTE_COMMAND);
        expect(seen.refusals()).toBe(1);
        expect(seen.changes()).toBe(0);
        expect(m.editor.getValue()).toBe(value);
        expect(nodesOf(m)).toBe(nodes);
    });

    it('R13 on an editable editor: the same paste goes into the selected cell', async () => {
        const m = prepared(false);

        m.lexical.update(() => {
            const table = $getRoot().getChildren()[1] as TableNode;
            const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, first, second));
        }, { discrete: true });
        m.root.focus();
        document.body.dispatchEvent(clipboardEvent('paste'));
        await settle();

        expect(m.editor.getValue()).toContain('PASTED');
    });

    /**
     * What a browser can do to the surface's elements for an edit that cannot
     * be cancelled, shape by shape. A composition over a selection does the
     * last ones together: it removes the formatted run the selection starts
     * in, splits the text before it, and moves the node it composes in into
     * a wrapper of its own inside a text element Lexical rendered.
     */
    const DAMAGE: Record<string, (m: Mounted) => void> = {
        'text inserted into a text node':  (m) => { domTextOf(m, 'plain ').data = 'plZain '; },
        'a text node emptied':             (m) => { domTextOf(m, 'bold').data = ''; },
        'a text node split in two':        (m) => { domTextOf(m, 'plain ').splitText(2); },
        'a text node added to a block':    (m) => { m.root.querySelector('p')!.append(document.createTextNode('Z')); },
        'a text node added to a text element': (m) => { elementOf(m, 'plain ').append(document.createTextNode('Z')); },
        'a text node added to the surface': (m) => { m.root.append(document.createTextNode('Z')); },
        'an element added to a block':     (m) => { m.root.querySelector('p')!.append(document.createElement('b')); },
        'a formatted run removed':         (m) => { elementOf(m, 'bold').remove(); },
        'a block removed':                 (m) => { m.root.querySelector('table')!.remove(); },
        'a block\'s content moved into the block before it': (m) => { m.root.querySelector('p')!.append(...m.root.querySelector('li')!.childNodes); },
        'every element removed':           (m) => { m.root.replaceChildren(); },
        'a text node moved into a wrapper of the browser\'s, in the text element before it': (m) => {
            const composed = domTextOf(m, 'bold');
            const before = elementOf(m, 'plain ');
            const wrapper = document.createElement('font');
            const inner = document.createElement('span');

            domTextOf(m, 'plain ').splitText(2);
            composed.data = 'n';
            elementOf(m, 'bold').remove();
            inner.append(composed);
            wrapper.append(inner);
            before.append(wrapper);
        },
    };

    for (const [damage, apply] of Object.entries(DAMAGE)) {
        it(`R17: whatever the browser did to the surface, the view is rendered anew and the document takes nothing: ${damage}`, async () => {
            const m = prepared();
            const before = snapshotOf(m);
            const seen = watch(m);

            apply(m);
            m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'n', bubbles: true }));
            await settle();
            // Lexical takes an emptied text node out a moment later, where it has taken the change at all.
            await new Promise((resolve) => setTimeout(resolve, 40));
            await settle();

            expect(snapshotOf(m)).toEqual(before);
            expect(seen.changes()).toBe(0);
            expect(m.lexical.isEditable()).toBe(false);
            expectUntouchedHistory(m);
        });
    }

    it('R18: after the view is rendered anew the caret, or the selected text, is where it was, in the browser too', async () => {
        // That the surface is scrolled as it was is a browser check: jsdom keeps a scroll offset whatever happens to the content.
        for (const [from, to] of [[2, 2], [1, 4]]) {
            const m = prepared();

            m.root.focus();
            await browserSelects(m, 'bold', from, to);

            const selection = selectionOf(m);

            DAMAGE['a text node moved into a wrapper of the browser\'s, in the text element before it'](m);
            m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'n', bubbles: true }));
            // What a browser does once the event is over: it sets a selection of its own, the old one's elements being gone.
            window.getSelection()?.collapse(m.root, 0);
            await settle();

            const browser = window.getSelection()!;

            expect(selectionOf(m)).toBe(selection);
            // In the element rendered anew, not the one the browser composed in.
            expect(browser.anchorNode).toBe(domTextOf(m, 'bold'));
            expect([browser.anchorOffset, browser.focusOffset]).toEqual([from, to]);
            expect(m.lexical.isEditable()).toBe(false);
        }
    });

    it('R21: the selection is written back only where the surface holds the keyboard: a view changed from elsewhere takes no focus', async () => {
        // A script's edit of the surface, say, made while a field beside the editor holds the keyboard. A browser
        // gives the focus to an editing host a selection is set in, so no selection is set, and Lexical is never editable.
        const m = prepared();
        const field = document.createElement('input');
        const editable = vi.spyOn(m.lexical, 'setEditable');

        document.body.append(field);
        await browserSelects(m, 'bold', 2);
        field.focus();

        const selection = selectionOf(m);

        DAMAGE['text inserted into a text node'](m);
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'Z', bubbles: true }));
        await settle();

        expect(document.activeElement).toBe(field);
        expect(editable).not.toHaveBeenCalled();
        expect(selectionOf(m)).toBe(selection);
        expect(m.editor.getValue()).toBe(SOURCE);
        expect(m.root.textContent).not.toContain('Z');
    });

    it('R19: two changes in one burst are one restore, to the selection from before the first', async () => {
        const m = prepared();

        m.root.focus();
        await browserSelects(m, 'bold', 1, 3);

        const selection = selectionOf(m);
        const before = snapshotOf(m);

        for (const damage of ['text inserted into a text node', 'a formatted run removed']) {
            DAMAGE[damage](m);
            m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'n', bubbles: true }));
            window.getSelection()?.collapse(m.root, 0);
            document.dispatchEvent(new Event('selectionchange'));
            await microtasks();
        }

        await settle();

        expect(selectionOf(m)).toBe(selection);
        expect(snapshotOf(m)).toEqual(before);
    });

    it('R20: a restore still waiting does no harm to what comes before it runs: another document, read-only lifted, the editor disposed', async () => {
        const damageAndInput = (m: Mounted): void => {
            DAMAGE['text inserted into a text node'](m);
            m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'n', bubbles: true }));
        };
        const reloaded = prepared();

        damageAndInput(reloaded);
        reloaded.editor.setValue('another document');
        await settle();

        expect(reloaded.editor.getValue()).toBe('another document');
        expect(reloaded.root.textContent).toBe('another document');
        expect(reloaded.lexical.isEditable()).toBe(false);

        const lifted = prepared();

        damageAndInput(lifted);
        lifted.editor.setReadOnly(false);
        await settle();

        expect(lifted.lexical.isEditable()).toBe(true);
        expect(lifted.editor.getValue()).toBe(SOURCE);

        const disposed = prepared();
        const finished = vi.spyOn(disposed.editor as unknown as { finishViewRestore(): void }, 'finishViewRestore');

        damageAndInput(disposed);
        built.splice(built.indexOf(disposed.editor), 1);
        disposed.editor.dispose();
        await settle();

        // The task that would have written to a view that is gone was called off.
        expect(finished).not.toHaveBeenCalled();
    });

    /**
     * Which script hears of the browser's change first. A browser runs the
     * microtasks waiting after each listener of an event, Lexical's mutation
     * observer among them: where a listener of a host's or of a browser
     * extension is on the window ahead of the framework's, the observer has
     * its turn before the surface hears of the change.
     */
    const FIRST_TO_HEAR: Record<string, () => Promise<void>> = {
        'the surface':                             async () => {},
        'a listener ahead of the framework\'s':    microtasks,
    };

    for (const [first, turnOfTheObserver] of Object.entries(FIRST_TO_HEAR)) {
        it(`R22: an edit that cannot be cancelled never reaches the document: the view is out before the browser makes it. First to hear of it: ${first}`, async () => {
            const m = prepared();
            const before = snapshotOf(m);
            const seen = watch(m);
            const at = domTextOf(m, 'plain ');

            announceUnpreventable(m);

            // Nothing has changed yet, and the editor is no longer looking at the surface.
            expect(m.lexical.getRootElement()).toBeNull();
            expect(at.isConnected).toBe(false);

            browserWrites(m, at);
            await turnOfTheObserver();
            m.root.dispatchEvent(inputEvent());

            // Back in the same task, so the surface is never painted without the view.
            expect(m.lexical.getRootElement()).toBe(m.root);
            expect(m.root.innerHTML).toBe(before.html);

            await settle();

            expect(snapshotOf(m)).toEqual(before);
            expect(seen.changes()).toBe(0);
            // Reported once, where the browser announced the text.
            expect(seen.refusals()).toBe(1);
            expect(seen.flashes()).toBe(1);
            expect(m.lexical.isEditable()).toBe(false);
            expectUntouchedHistory(m);
        });
    }

    it('R23: an edit announced and never made leaves no gap: the view is back a task later', async () => {
        const m = prepared();
        const before = snapshotOf(m);
        const seen = watch(m);

        // The surface's first layout mounts a view that is not there, and in this harness, which mounts the view
        // itself, that layout may come at any time. It is kept out, so that what puts the view back is the restore.
        vi.spyOn(m.editor as unknown as Internals, 'mountWysiwyg').mockImplementation(() => {});
        announceUnpreventable(m);

        expect(m.lexical.getRootElement()).toBeNull();

        await settle();

        expect(m.lexical.getRootElement()).toBe(m.root);
        expect(snapshotOf(m)).toEqual(before);
        expect(seen.changes()).toBe(0);
        expect(m.lexical.isEditable()).toBe(false);
        expectUntouchedHistory(m);
    });

    it('R24: only a beforeinput that cannot be cancelled, on a read-only editor, takes the view out', async () => {
        const readOnly = prepared();
        const seen = watch(readOnly);
        const uncancelable = [
            new ClipboardEvent('paste', { bubbles: true }), new ClipboardEvent('cut', { bubbles: true }), new DragEvent('drop', { bubbles: true }),
            new CompositionEvent('compositionstart', { bubbles: true }), new CompositionEvent('compositionupdate', { bubbles: true, data: 'Z' }),
        ];

        for (const event of uncancelable) {
            elementOf(readOnly, 'plain ').dispatchEvent(event);

            expect(readOnly.lexical.getRootElement(), event.type).toBe(readOnly.root);
        }

        // None of them is reported as a refused edit either: not an event that cannot be cancelled and is no
        // beforeinput, and not a composition's start or update, which announce no text of their own.
        expect(seen.refusals()).toBe(0);

        for (const event of [beforeInput('insertText', true), beforeInput('insertCompositionText', true)]) {
            elementOf(readOnly, 'plain ').dispatchEvent(event);

            expect(readOnly.lexical.getRootElement(), event.type).toBe(readOnly.root);
        }

        // An editable editor takes what the browser writes, so its view stays where it is.
        const editable = prepared(false);
        const element = elementOf(editable, 'bold');
        const at = domTextOf(editable, 'plain ');

        announceUnpreventable(editable);

        expect(editable.lexical.getRootElement()).toBe(editable.root);

        browserWrites(editable, at);
        editable.root.dispatchEvent(inputEvent());
        await settle();

        expect(editable.editor.getValue()).toContain('Zplain ');
        expect(elementOf(editable, 'bold')).toBe(element);
    });

    it('R30: a host "readonlyedit" listener that throws neither defeats the take-out nor lets a cancelable edit through', async () => {
        const m = prepared();
        const before = snapshotOf(m);

        m.editor.on('readonlyedit', () => { throw new Error('host listener'); });

        // jsdom reports an exception a listener throws as an `error` event of the window; it is expected here.
        const swallow = (event: Event): void => event.preventDefault();

        window.addEventListener('error', swallow);

        try {
            // The edit that cannot be cancelled: the view is out, whatever the report does.
            announceUnpreventable(m);

            expect(m.lexical.getRootElement()).toBeNull();

            m.root.dispatchEvent(inputEvent());
            await settle();

            expect(m.lexical.getRootElement()).toBe(m.root);
            expect(snapshotOf(m)).toEqual(before);

            // The edit that can be cancelled is cancelled, whatever the report does.
            const cancelable = beforeInput('insertText', true);

            elementOf(m, 'plain ').dispatchEvent(cancelable);

            expect(cancelable.defaultPrevented).toBe(true);
        } finally {
            window.removeEventListener('error', swallow);
        }
    });

    it('R25: a burst of announced changes is one restore, to the selection from before the first', async () => {
        const m = prepared();

        m.root.focus();
        await browserSelects(m, 'bold', 1, 3);

        const selection = selectionOf(m);
        const before = snapshotOf(m);
        const finished = vi.spyOn(m.editor as unknown as { finishViewRestore(): void }, 'finishViewRestore');

        for (let step = 0; step < 3; step++) {
            const at = domTextOf(m, 'bold');

            announceUnpreventable(m, 'bold');
            browserWrites(m, at);
            await microtasks();
            m.root.dispatchEvent(inputEvent());
            // What a browser does once the event is over: it sets a selection of its own, the old one's elements being gone.
            window.getSelection()?.collapse(m.root, 0);
            document.dispatchEvent(new Event('selectionchange'));
            await microtasks();
        }

        await settle();

        const browser = window.getSelection()!;

        expect(finished).toHaveBeenCalledTimes(1);
        expect(selectionOf(m)).toBe(selection);
        expect(snapshotOf(m)).toEqual(before);
        expect(browser.anchorNode).toBe(domTextOf(m, 'bold'));
        expect([browser.anchorOffset, browser.focusOffset]).toEqual([1, 3]);
    });

    it('R26: a view that is out does no harm to what comes before it is back: another document, read-only lifted, the editor disposed', async () => {
        const reloaded = prepared();

        announceUnpreventable(reloaded);
        reloaded.editor.setValue('another document');
        reloaded.root.dispatchEvent(inputEvent());
        await settle();

        expect(reloaded.editor.getValue()).toBe('another document');
        expect(reloaded.root.textContent).toBe('another document');
        expect(reloaded.lexical.isEditable()).toBe(false);

        // Read-only lifted between the announcement and the change: the view is back with the change's own event.
        const lifted = prepared();

        announceUnpreventable(lifted);
        lifted.editor.setReadOnly(false);
        lifted.root.append(document.createTextNode('Z'));
        lifted.root.dispatchEvent(inputEvent());

        expect(lifted.lexical.getRootElement()).toBe(lifted.root);

        await settle();

        expect(lifted.lexical.isEditable()).toBe(true);
        expect(lifted.editor.getValue()).toBe(SOURCE);
        expect(lifted.root.textContent).not.toContain('Z');

        // Put back, the view is in for good: the editor, editable now, takes the next change as any editable one does.
        const element = elementOf(lifted, 'bold');

        DAMAGE['text inserted into a text node'](lifted);
        lifted.root.dispatchEvent(inputEvent());
        await settle();

        expect(lifted.editor.getValue()).toContain('plZain ');
        expect(elementOf(lifted, 'bold')).toBe(element);

        const disposed = prepared();
        const finished = vi.spyOn(disposed.editor as unknown as { finishViewRestore(): void }, 'finishViewRestore');

        announceUnpreventable(disposed);
        built.splice(built.indexOf(disposed.editor), 1);
        disposed.editor.dispose();
        await settle();
        // Long enough for the animation frame the restore also waited for.
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(finished).not.toHaveBeenCalled();
    });

    it('R29: the restore is finished in the frame about to be painted or in a task, whichever comes first, and once', async () => {
        // The browser scrolls the surface to the selection it set itself, at the document's start, and a frame can
        // be painted before a task runs: finished in that frame's callback, the offsets are back before it is seen.
        // That the offsets are kept is a browser check; here it is the order, and that the other is called off.
        // The frames asked for, by handle, and a frame coming: every callback still waiting runs. The wash asks
        // for frames too.
        const waiting = new Map<number, FrameRequestCallback>();
        let handles = 0;
        const frameComes = (): void => {
            const callbacks = [...waiting.values()];

            waiting.clear();
            callbacks.forEach((callback) => callback(0));
        };

        vi.spyOn(DOM.sink as ProductionDOMSink, 'requestAnimationFrame').mockImplementation((callback) => {
            handles += 1;
            waiting.set(handles, callback);

            return handles;
        });
        vi.spyOn(DOM.sink as ProductionDOMSink, 'cancelAnimationFrame').mockImplementation((handle) => { waiting.delete(handle); });

        const refuseComposedText = async (m: Mounted): Promise<void> => {
            const at = domTextOf(m, 'bold');

            announceUnpreventable(m, 'bold');
            browserWrites(m, at);
            m.root.dispatchEvent(inputEvent());
            window.getSelection()?.collapse(m.root, 0);
            document.dispatchEvent(new Event('selectionchange'));
            await microtasks();
        };

        // The frame first.
        const frameFirst = prepared();

        frameFirst.root.focus();
        await browserSelects(frameFirst, 'bold', 1, 3);

        const finishedInFrame = vi.spyOn(frameFirst.editor as unknown as { finishViewRestore(): void }, 'finishViewRestore');
        const selection = selectionOf(frameFirst);

        await refuseComposedText(frameFirst);

        expect(finishedInFrame).not.toHaveBeenCalled();

        frameComes();

        expect(finishedInFrame).toHaveBeenCalledTimes(1);
        expect(selectionOf(frameFirst)).toBe(selection);
        expect([window.getSelection()!.anchorOffset, window.getSelection()!.focusOffset]).toEqual([1, 3]);

        await settle();

        // The task was called off.
        expect(finishedInFrame).toHaveBeenCalledTimes(1);

        // The task first.
        const taskFirst = prepared();

        taskFirst.root.focus();
        await browserSelects(taskFirst, 'bold', 1, 3);

        const finishedInTask = vi.spyOn(taskFirst.editor as unknown as { finishViewRestore(): void }, 'finishViewRestore');

        await refuseComposedText(taskFirst);
        await settle();

        expect(finishedInTask).toHaveBeenCalledTimes(1);

        // The frame was called off: when one comes, the restore is not finished a second time.
        frameComes();

        expect(finishedInTask).toHaveBeenCalledTimes(1);
    });

    it('R27: a refused change is no change of the selection state: no "selectionstate" while the view is rendered anew', async () => {
        const m = prepared();

        m.root.focus();
        await browserSelects(m, 'bold', 2);

        const states: MarkdownEditorSelectionState[] = [];
        const reported = m.editor.getSelectionState();
        const at = domTextOf(m, 'bold');

        expect(reported.bold).toBe(true);

        m.editor.on('selectionstate', (state) => states.push(state));
        announceUnpreventable(m, 'bold');
        browserWrites(m, at);
        m.root.dispatchEvent(inputEvent());
        // The browser's own selection, set once the event is over, which the editor follows until its own is written back.
        window.getSelection()?.collapse(m.root, 0);
        document.dispatchEvent(new Event('selectionchange'));
        await microtasks();

        expect(m.editor.getSelectionState().bold).toBe(false);

        await settle();

        expect(states).toEqual([]);
        expect(m.editor.getSelectionState()).toEqual(reported);

        // Where the selection is not written back, the surface not holding the keyboard, the state the editor
        // ends in is reported, once.
        const field = document.createElement('input');

        document.body.append(field);
        field.focus();
        DAMAGE['text inserted into a text node'](m);
        m.root.dispatchEvent(inputEvent('insertText'));
        window.getSelection()?.collapse(m.root, 0);
        document.dispatchEvent(new Event('selectionchange'));
        await settle();

        expect(states).toHaveLength(1);
        expect(states[0].bold).toBe(false);
        expect(m.editor.getSelectionState()).toEqual(states[0]);
    });

    it('R28, a known limit: with table cells selected the cells stay selected and the document unchanged; the browser\'s caret is not put back', async () => {
        // Lexical writes no browser selection for a selection of cells; a browser check holds where the caret then is.
        const m = prepared();

        m.lexical.update(() => {
            const table = $getRoot().getChildren()[1] as TableNode;
            const [first, second] = (table.getLastChild() as TableRowNode).getChildren() as TableCellNode[];

            $setSelection($createTableSelectionFrom(table, first, second));
        }, { discrete: true });
        m.root.focus();

        const selection = selectionOf(m);
        const value = m.editor.getValue();
        const nodes = nodesOf(m);
        const seen = watch(m);

        announceUnpreventable(m, 'c');
        m.root.append(document.createTextNode('Z'));
        await microtasks();
        m.root.dispatchEvent(inputEvent());
        await settle();

        expect(selection.startsWith('cells|')).toBe(true);
        expect(selectionOf(m)).toBe(selection);
        expect(m.editor.getValue()).toBe(value);
        expect(nodesOf(m)).toBe(nodes);
        expect(m.root.textContent).not.toContain('Z');
        expect(seen.changes()).toBe(0);
    });

    it('R17 on an editable editor: the view is left to Lexical, which takes the change as it always has', async () => {
        const m = prepared(false);
        const elementBefore = elementOf(m, 'bold');

        DAMAGE['text inserted into a text node'](m);
        m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
        await settle();

        expect(m.editor.getValue()).toContain('plZain ');
        // Not rendered anew: the elements are the ones that were there.
        expect(elementOf(m, 'bold')).toBe(elementBefore);
    });

    it('R15, a known limit: a change of the surface the editor is not told of before the observer has its turn reaches the document', async () => {
        // Lexical's mutation observer takes changed text, and asks neither whether the editor is editable nor whether
        // an event came. Every key, paste, drop and composition is announced to the surface before the browser
        // changes anything, and is kept out there. Two changes are not.
        const readOnly = prepared();
        const editable = prepared(false);

        // The first: text a script or a browser extension writes into the surface's elements, with no event at all.
        for (const m of [readOnly, editable]) {
            domTextOf(m, 'plain ').data = 'plainZ ';
        }

        await settle();

        expect(editable.editor.getValue()).toContain('plainZ ');
        expect(readOnly.editor.getValue()).toContain('plainZ ');

        // The second: a change whose `beforeinput` never reached the surface, and whose `input` another listener
        // hears first, the observer having its turn after that listener. In a browser that takes another script's
        // capture listeners on the window, registered ahead of the framework's: one that stops `beforeinput`
        // from going further, and one for `input`. Backspace and a composition then change the document.
        const heardLate = prepared();

        domTextOf(heardLate, 'plain ').data = 'plainZ ';
        await microtasks();
        heardLate.root.dispatchEvent(inputEvent('deleteContentBackward'));
        await settle();

        expect(heardLate.editor.getValue()).toContain('plainZ ');

        // With either of the two alone the document is kept: an `input` the surface is the first to hear is row
        // R6, and a `beforeinput` that reaches the surface is cancelled or finds the view taken out (row R22).
    });

    /**
     * Documents a load leaves in a form the editor's rules rewrite as soon as
     * a node of theirs counts as changed. Putting the shown text back must
     * not count as a change.
     */
    const REWRITTEN_ONCE_CHANGED = ['> a\n<div', '- a\n\n\t[x]: /u "t\n\n\tu"\n\n- b', '- a\n<div', '1. a\n\n   b\n2. c'];

    for (const source of REWRITTEN_ONCE_CHANGED) {
        it(`R14: putting the shown text back runs none of the editor's rules: ${JSON.stringify(source)}`, async () => {
            // Loaded with setValue: an editor constructed with the first of these is rewritten as it is built.
            const m = mounted('', true);

            m.editor.setValue(source);

            const count = m.lexical.read(() => $getRoot().getAllTextNodes().length);

            for (let index = 0; index < count; index++) {
                const before = snapshotOf(m);
                const seen = watch(m);
                const key = m.lexical.read(() => $getRoot().getAllTextNodes()[index].getKey());
                let leaf: Node = m.lexical.getElementByKey(key) as HTMLElement;

                while (leaf.firstChild !== null) {
                    leaf = leaf.firstChild;
                }

                (leaf as Text).data = `Z${(leaf as Text).data}`;
                m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
                await settle();

                expect(snapshotOf(m), `text node ${index}`).toEqual(before);
                expect(seen.changes(), `text node ${index}`).toBe(0);
            }

            expect(m.editor.getValue()).toBe(source);
        });
    }
});

describe('MarkdownEditor read-only, mounted: every block kind', () => {
    /** One document per kind of block the editor shows. */
    const KINDS: Record<string, string> = {
        'headings and prose':   '# One\n\n## Two\n\nplain *it* **bo** ~~st~~ ++un++ `co` [red]{color=#cc0000} end',
        'link and image':       'a [link](https://example.com "t") b ![alt](/i.png){width=20} c <https://auto.example>',
        'reference link':       'see [ref][r] and [r]\n\n[r]: https://example.com',
        'hard break':           'one  \ntwo\\\nthree',
        'tight list':           '- one\n- two\n  - deep\n- three',
        'loose list':           '1. one\n\n   more\n\n2. two',
        'task list':            '- [ ] todo\n- [x] done',
        'quote':                '> quoted *text*\n>\n> more',
        'code block':           '```js\nconst x = 1;\n\tif (x) {}\n```',
        'indented code':        'a\n\n    code\n\nb',
        'table':                '| a | b |\n| :- | -: |\n| c | **d** |\n\nafter',
        'raw html block':       '<div>\nraw *text*\n</div>\n\nafter',
        'inline html':          'kept <span>x</span> source',
        'aligned block':        '::: {align=center}\ncentred\n:::',
        'columns':              '::: columns\nLeft\n|||\nRight\n:::',
        'blocks in a list':     '- a\n\n  ```\n  code\n  ```\n\n  > q\n\n- b',
        'thematic break':       'a\n\n---\n\nb',
        'empty document':       '',
        'empty paragraphs':     'a\n\n\n\nb',
    };

    for (const [kind, source] of Object.entries(KINDS)) {
        it(`${kind}: no route changes the document, the nodes, what is shown, or the undo history`, async () => {
            const twin = mounted(source, false);
            const m = mounted(source, false);
            const texts = m.lexical.read(() => $getRoot().getAllTextNodes().map((node) => node.getKey()));

            m.lexical.update(() => { $getRoot().selectStart(); }, { discrete: true });
            twin.lexical.update(() => { $getRoot().selectStart(); }, { discrete: true });
            m.editor.setReadOnly(true);

            const seen = watch(m);
            const before = snapshotOf(m);
            const targets: HTMLElement[] = texts.length > 0
                ? [0, texts.length - 1].map((index) => m.lexical.getElementByKey(texts[index]) as HTMLElement)
                : [m.root];

            for (const target of targets) {
                for (const [type, variants] of Object.entries(ROUTES)) {
                    for (const variant of variants) {
                        const usesDocument = variant.target === 'document';
                        const usesCell = variant.target === 'cell';
                        const cell = m.root.querySelector('td');

                        if (usesCell && cell === null) {
                            continue;
                        }

                        (usesDocument ? document : usesCell ? cell! : target).dispatchEvent(variant.build());
                        await settle();

                        expect(snapshotOf(m), `${type}: ${variant.name}`).toEqual(before);
                    }
                }

                for (const command of READ_ONLY_REFUSED_COMMANDS) {
                    m.lexical.dispatchCommand(command, undefined as never);

                    expect(snapshotOf(m), command.type).toEqual(before);
                }
            }

            // Text changed under each text node in turn, and a node added under each block.
            for (const key of texts) {
                let leaf: Node = m.lexical.getElementByKey(key) as HTMLElement;

                while (leaf.firstChild !== null) {
                    leaf = leaf.firstChild;
                }

                const isText = leaf.nodeType === Node.TEXT_NODE;

                if (isText) {
                    (leaf as Text).data = `${(leaf as Text).data}Z`;
                    m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
                    await settle();

                    expect(snapshotOf(m), `text changed in ${key}`).toEqual(before);
                }
            }

            for (const block of [...m.root.children]) {
                block.append(document.createTextNode('Z'));
                m.root.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'Z', bubbles: true }));
                await settle();

                expect(snapshotOf(m), `node added under <${block.tagName.toLowerCase()}>`).toEqual(before);
            }

            expect(seen.changes()).toBe(0);
            expect(m.editor.getValue()).toBe(twin.editor.getValue());
            expect(m.editor.isDirty()).toBe(false);

            m.editor.setReadOnly(false);

            expect(undoDepthOf(m)).toBe(undoDepthOf(twin));
        });
    }
});

describe('MarkdownEditor read-only, mounted: switching read-only', () => {
    /** The offsets of Lexical's selection in the text node it stands in. */
    const offsetsOf = ({ lexical }: Mounted): number[] => lexical.read(() => {
        const selection = $getSelection() as RangeSelection;

        return [selection.anchor.offset, selection.focus.offset];
    });

    it('M1: switching read-only on leaves the selection, the editing host and the focus as they are', async () => {
        const m = prepared(false);

        m.root.focus();
        await browserSelects(m, 'bold', 1, 3);

        const selection = selectionOf(m);
        const active = document.activeElement;

        m.editor.setReadOnly(true);

        expect(selectionOf(m)).toBe(selection);
        expect(m.root.getAttribute('contenteditable')).toBe('true');
        expect(m.root.getAttribute('aria-readonly')).toBe('true');
        expect(document.activeElement).toBe(active);
    });

    it('M2, M3: a selection moved while read-only is the one the editor edits once read-only is lifted', async () => {
        const m = prepared(false);

        await browserSelects(m, 'bold', 1, 3);
        m.editor.setReadOnly(true);
        await browserSelects(m, 'bold', 1, 4);

        expect(offsetsOf(m)).toEqual([1, 4]);

        m.editor.setReadOnly(false);

        expect(offsetsOf(m)).toEqual([1, 4]);
        expect(m.root.getAttribute('aria-readonly')).toBe('false');

        m.lexical.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'Z');
        await settle();

        expect(m.editor.getValue()).toContain('**bZ**');
    });

    it('M4: setValue replaces a mounted read-only editor\'s document and signals nothing', () => {
        const m = prepared();
        const seen = watch(m);

        m.editor.setValue('| x |\n| - |\n| y |\n\nnew');

        expect(m.editor.getValue()).toBe('| x |\n| - |\n| y |\n\nnew');
        expect(m.root.textContent).toContain('new');
        expect(seen.refusals()).toBe(0);
        expect(seen.changes()).toBe(1);
    });

    it('M5: a refused command plays the rejection wash, mounted over the editor and not inside the surface', () => {
        const m = prepared();
        const host = m.root.parentElement as HTMLElement;
        const overlays = [...host.children].filter((child) => (child as HTMLElement).style.pointerEvents === 'none');
        const seen = watch(m);

        m.editor.toggleBold();

        expect(overlays).toHaveLength(1);
        expect(m.root.contains(overlays[0])).toBe(false);
        expect(seen.refusals()).toBe(1);
        expect(seen.flashes()).toBe(1);
    });

    it('M8: toggleTaskList on a read-only editor is refused as the other list toggles are, changing nothing and signalling once', () => {
        const m = prepared();
        const seen = watch(m);
        const before = m.editor.getValue();

        m.editor.toggleTaskList();

        expect(m.editor.getValue()).toBe(before);
        expect(seen.refusals()).toBe(1);
        expect(seen.flashes()).toBe(1);
    });

    it('M6: focus() on a read-only editor gives the surface the keyboard, and Lexical sets no selection of its own', async () => {
        // That the browser keeps a caret it already holds there is a browser check: jsdom collapses the selection on every focus.
        const m = prepared();
        const lexicalFocus = vi.spyOn(m.lexical, 'focus');
        const selection = selectionOf(m);

        (document.activeElement as HTMLElement | null)?.blur();
        m.editor.focus();

        expect(document.activeElement).toBe(m.root);
        expect(lexicalFocus).not.toHaveBeenCalled();
        expect(selectionOf(m)).toBe(selection);
    });

    it('M7: a typed beforeinput whose input event a read-only editor refuses leaves no wait behind: once read-only is lifted, a removal of the character before the caret completes no typing shortcut', async () => {
        const m = mounted('\\- .cd', false);

        selectIn(m, '- .cd', 3);

        // The browser announces typed text, and read-only is switched on before its input event arrives. jsdom's
        // InputEvent has no getTargetRanges, so Lexical listens for no beforeinput here: the command is dispatched,
        // and the input event is a real one.
        m.lexical.update(() => { m.lexical.dispatchCommand(BEFORE_INPUT_COMMAND, beforeInput('insertText', true) as InputEvent); }, { discrete: true });
        m.editor.setReadOnly(true);
        m.root.dispatchEvent(inputEvent('insertText'));
        m.editor.setReadOnly(false);
        selectIn(m, '- .cd', 2, 3);
        m.lexical.update(() => { m.lexical.dispatchCommand(REMOVE_TEXT_COMMAND, null); }, { discrete: true });
        await settle();

        expect(m.editor.getValue()).toBe('\\- cd');
        expect(m.lexical.read(() => $getRoot().getFirstChild()?.getType())).toBe('paragraph');
    });
});

describe('MarkdownEditor read-only, mounted: following a link', () => {
    const LINKED = 'see [the docs](https://example.com/docs) now\n\nplain';

    /** Records each link the editor opens: the attributes of the anchor it clicks. Nothing is navigated. */
    function followed(): Array<Record<string, string | null>> {
        const opened: Array<Record<string, string | null>> = [];

        vi.spyOn(DOM.sink as ProductionDOMSink, 'click').mockImplementation((handle) => {
            opened.push(Object.fromEntries(['href', 'target', 'rel'].map((name) => [name, DOM.source.getAttribute(handle, name)])));
        });

        return opened;
    }

    /** A read-only editor holding `source`, the browser's caret (or selection) in the text node showing `text`. */
    async function readOnlyAt(source: string, text: string, from: number, to: number = from): Promise<Mounted> {
        const m = mounted('', true);

        m.editor.setValue(source);
        await browserSelects(m, text, from, to);

        return m;
    }

    /**
     * What a browser sends for a press of Enter with the surface as the editing host: the key's `keydown` on
     * the surface and, unless that is cancelled, the `beforeinput` of the edit the key asks for.
     *
     * @param text - The text whose element the `beforeinput` goes to, or `null` for the surface itself.
     * @param inputType - The edit a browser announces for the key: a paragraph break at most places, a line
     *   break at some (beside an image inside a link, in Chromium).
     * @returns The `keydown`, and the `beforeinput`, or `null` where the key was cancelled.
     */
    function pressEnter(
        m: Mounted, text: string | null, inputType: string = 'insertParagraph', modifiers: KeyModifiers = {},
    ): { key: Event; edit: Event | null } {
        const key = keydown('Enter', modifiers);

        m.root.dispatchEvent(key);

        const edit = key.defaultPrevented ? null : beforeInput(inputType, true);

        if (edit !== null) {
            (text === null ? m.root : elementOf(m, text)).dispatchEvent(edit);
        }

        return { key, edit };
    }

    /**
     * Sends a click to the element showing `text` (or to the surface itself), and returns it.
     *
     * @param detail - The click's place in its run, as a browser counts it: 1 for a click and for the first click
     *   of a double or triple click, 2 and 3 for the ones that follow, 0 for a click no pointer made.
     * @param type - `click`, or `auxclick` for a middle click.
     */
    function clickOn(m: Mounted, text: string | null, detail: number = 1, type: 'click' | 'auxclick' = 'click'): Event {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, detail, button: type === 'click' ? 0 : 1 });

        (text === null ? m.root : elementOf(m, text)).dispatchEvent(event);

        return event;
    }

    /**
     * Sends the `mousedown` a press of the pointer gives, to the element showing `text`. A browser changes the
     * selection for the press after this event.
     *
     * @param type - The kind of click the press belongs to: `auxclick` for the middle button.
     */
    function pressOn(m: Mounted, text: string, type: 'click' | 'auxclick' = 'click'): void {
        elementOf(m, text).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: type === 'click' ? 0 : 1 }));
    }

    const OPENED = { href: 'https://example.com/docs', target: '_blank', rel: 'noopener noreferrer' };

    it('L1: Enter with the caret in a link opens it in a new tab, changes nothing, and is not reported as a refused edit', async () => {
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const before = snapshotOf(m);
        const seen = watch(m);
        const { key, edit } = pressEnter(m, 'the docs');

        await settle();

        expect(opened).toEqual([OPENED]);
        // The key is taken, so the browser announces no edit for it.
        expect(key.defaultPrevented).toBe(true);
        expect(edit).toBeNull();
        expect(seen.refusals()).toBe(0);
        expect(seen.flashes()).toBe(0);
        expect(seen.changes()).toBe(0);
        expect(snapshotOf(m)).toEqual(before);
        // The anchor the link is opened through does not stay in the document.
        expect(document.querySelectorAll('body > a')).toHaveLength(0);
    });

    it('L2: Enter with the caret outside a link is the refused edit it always is', async () => {
        const m = await readOnlyAt(LINKED, 'see ', 2);
        const opened = followed();
        const seen = watch(m);
        const { key, edit } = pressEnter(m, 'see ');

        expect(opened).toEqual([]);
        // The key is left alone, and the edit the browser then announces is refused.
        expect(key.defaultPrevented).toBe(false);
        expect(edit!.defaultPrevented).toBe(true);
        expect(seen.refusals()).toBe(1);
        expect(seen.flashes()).toBe(1);
    });

    it('L3: Enter over a selection inside a link opens nothing: a link is followed from a caret', async () => {
        const m = await readOnlyAt(LINKED, 'the docs', 1, 5);
        const opened = followed();
        const seen = watch(m);

        pressEnter(m, 'the docs');

        expect(opened).toEqual([]);
        expect(seen.refusals()).toBe(1);
    });

    it('L4: every edit the browser announces at a caret in a link is a refused edit, a paragraph break among them: only the Enter key follows', async () => {
        // A paragraph break or a line break that reaches `beforeinput` did not come from an Enter the editor took:
        // whatever produced it (a script, an input method, a key with a modifier), it opens nothing.
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const seen = watch(m);
        const events = [
            beforeInput('insertParagraph', true), beforeInput('insertLineBreak', true), beforeInput('insertText', true),
            beforeInput('deleteContentBackward', true), clipboardEvent('paste'), clipboardEvent('cut'), dragEvent('drop'),
        ];

        for (const event of events) {
            elementOf(m, 'the docs').dispatchEvent(event);
        }

        expect(opened).toEqual([]);
        expect(seen.refusals()).toBe(events.length);
    });

    it('L5: a click on a link, which leaves the caret in it, opens it, and the click is the editor\'s alone', async () => {
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const before = snapshotOf(m);
        const seen = watch(m);
        const event = clickOn(m, 'the docs');

        await settle();

        expect(opened).toEqual([OPENED]);
        // Cancelled, so that a browser which would follow the link itself does not follow it a second time.
        expect(event.defaultPrevented).toBe(true);
        expect(seen.refusals()).toBe(0);
        expect(seen.changes()).toBe(0);
        expect(snapshotOf(m)).toEqual(before);
    });

    /**
     * Every shape the browser's selection can have before a press on the
     * link and at the click that follows: an anchor and a focus by text node
     * and offset, the whole surface, or none. `holdsText` says whether it is
     * a selection of text.
     */
    type SelectionShape = { name: string; ends?: [string, number, string, number]; all?: boolean; holdsText: boolean };

    const SELECTION_SHAPES: SelectionShape[] = [
        { name: 'no selection',                                    holdsText: false },
        { name: 'a caret in the link',                             ends: ['the docs', 3, 'the docs', 3], holdsText: false },
        { name: 'a caret at the link\'s start',                    ends: ['the docs', 0, 'the docs', 0], holdsText: false },
        { name: 'a caret elsewhere',                               ends: ['plain', 2, 'plain', 2],       holdsText: false },
        { name: 'text inside the link',                            ends: ['the docs', 1, 'the docs', 5], holdsText: true },
        { name: 'text inside the link, backward',                  ends: ['the docs', 5, 'the docs', 1], holdsText: true },
        { name: 'a word of the link',                              ends: ['the docs', 4, 'the docs', 8], holdsText: true },
        { name: 'the link\'s whole text',                          ends: ['the docs', 0, 'the docs', 8], holdsText: true },
        { name: 'text from before the link into it',               ends: ['see ', 2, 'the docs', 4],     holdsText: true },
        { name: 'text from inside the link to after it',           ends: ['the docs', 4, ' now', 2],     holdsText: true },
        { name: 'text from after the link back into it',           ends: [' now', 2, 'the docs', 4],     holdsText: true },
        { name: 'text around the link, an end on each side',       ends: ['see ', 2, ' now', 2],         holdsText: true },
        { name: 'text around the link, backward',                  ends: [' now', 2, 'see ', 2],         holdsText: true },
        { name: 'the link\'s block',                               ends: ['see ', 0, ' now', 4],         holdsText: true },
        { name: 'the link\'s block and the next',                  ends: ['see ', 0, 'plain', 3],        holdsText: true },
        { name: 'the whole surface',                               all: true,                            holdsText: true },
        { name: 'text elsewhere',                                  ends: ['plain', 1, 'plain', 4],       holdsText: true },
    ];

    /** Gives the browser the selection of `shape`, with neither Lexical nor the document told. */
    function browserHolds(m: Mounted, { ends, all }: SelectionShape): void {
        const selection = window.getSelection()!;

        selection.removeAllRanges();

        if (all) {
            selection.selectAllChildren(m.root);
        } else if (ends !== undefined) {
            const [anchorText, anchorOffset, focusText, focusOffset] = ends;

            selection.setBaseAndExtent(domTextOf(m, anchorText), anchorOffset, domTextOf(m, focusText), focusOffset);
        }
    }

    it('L6: a run of clicks follows its link at most once, on its first click: every selection before the press, every one after, clicks 1 to 8 of a run, both buttons, two addresses', async () => {
        // One rule. A later click of a run (detail 2 and up) never follows, whatever is selected. The first click
        // follows unless it selected text itself: unless it left text selected that was not selected before the
        // press (the end of a drag, a Shift+click). A click no pointer made (detail 0) follows. With no press
        // seen, any text selected counts as the first click's.
        for (const [source, href] of [[LINKED, OPENED.href], [LINKED.replace(OPENED.href, 'mailto:someone@example.com'), 'mailto:someone@example.com']]) {
            const m = await readOnlyAt(source, 'plain', 1);
            const opened = followed();
            const followedAt: string[] = [];
            const expected: string[] = [];
            const unseen = null;
            let cases = 0;

            for (const before of [unseen, ...SELECTION_SHAPES]) {
                for (const after of SELECTION_SHAPES) {
                    for (const type of ['click', 'auxclick'] as const) {
                        for (const detail of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
                            const label = `${before === unseen ? 'no press seen' : before.name} -> ${after.name}; ${type} ${detail}`;
                            const count = opened.length;

                            if (before !== unseen) {
                                browserHolds(m, before);
                                pressOn(m, 'the docs', type);
                            }

                            browserHolds(m, after);

                            const event = clickOn(m, 'the docs', detail, type);
                            const follows = detail === 0 || (detail === 1 && (!after.holdsText || after === before));

                            // On the link, so the editor's alone, followed or not.
                            expect(event.defaultPrevented, label).toBe(true);

                            if (opened.length > count) {
                                followedAt.push(label);
                            }

                            if (follows) {
                                expected.push(label);
                            }

                            cases += 1;
                        }
                    }
                }
            }

            expect(followedAt, href).toEqual(expected);
            expect(opened.every((anchor) => anchor.href === href), href).toBe(true);
            // Both outcomes occur.
            expect(expected.length).toBeGreaterThan(cases / 9);
            expect(expected.length).toBeLessThan(cases / 4);
            vi.restoreAllMocks();
        }
    });

    it('L19: a run of one to eight clicks on a link opens it once, on the first click', async () => {
        // What a browser sends: a press and a click for each, the clicks counted from 1. The selection is a caret
        // after the first, the word after the second, and from the third on the block, which encloses the link
        // with neither of its ends in it: the fourth click finds the block selected before its press and after.
        const [caret, word, block] = ['a caret in the link', 'a word of the link', 'the link\'s block'].map(
            (name) => SELECTION_SHAPES.find((shape) => shape.name === name)!,
        );
        const mail = 'mailto:someone@example.com';

        for (const [source, href] of [[LINKED, OPENED.href], [LINKED.replace(OPENED.href, mail), mail]]) {
            for (const clicks of [1, 2, 3, 4, 5, 6, 7, 8]) {
                for (const type of ['click', 'auxclick'] as const) {
                    const m = await readOnlyAt(source, 'plain', 1);
                    const opened = followed();

                    for (let count = 1; count <= clicks; count++) {
                        pressOn(m, 'the docs', type);
                        browserHolds(m, [caret, word, block][Math.min(count, 3) - 1]);
                        clickOn(m, 'the docs', count, type);
                    }

                    expect(opened, `${clicks} ${type}s, ${href}`).toEqual([{ ...OPENED, href }]);
                    vi.restoreAllMocks();
                }
            }
        }
    });

    it('L20: text of a link that is selected already does not stand in the way of a click on it', async () => {
        // A browser leaves a selection standing until a click inside it is over: the click finds the text selected
        // before the press still selected, and did not select it.
        const m = await readOnlyAt(LINKED, 'plain', 1);
        const opened = followed();
        const selected = ['a word of the link', 'the link\'s whole text', 'the link\'s block', 'the whole surface'];

        for (const name of selected) {
            browserHolds(m, SELECTION_SHAPES.find((shape) => shape.name === name)!);
            pressOn(m, 'the docs');
            clickOn(m, 'the docs');
        }

        expect(opened).toHaveLength(selected.length);

        // A press is used by the one click that follows it: a second click with no press of its own finds no
        // selection noted, and the text selected counts as its own.
        clickOn(m, 'the docs');

        expect(opened).toHaveLength(selected.length);
    });

    it('L18: a link with an empty address leads nowhere: neither Enter nor a click opens the page the editor is on', async () => {
        for (const source of ['see [here]() now', 'see [here](<>) now', 'see [here][r] now\n\n[r]: <>']) {
            const m = await readOnlyAt(source, 'here', 2);
            const opened = followed();
            const seen = watch(m);

            // A link all the same, with an address of nothing.
            expect(m.editor.getSelectionState().linkUrl, source).toBe('');

            pressEnter(m, 'here');

            const click = clickOn(m, 'here');

            expect(opened, source).toEqual([]);
            expect(seen.refusals(), source).toBe(1);
            expect(click.defaultPrevented, source).toBe(true);
            vi.restoreAllMocks();
        }

        // And one of white space alone, which only `toggleLink` can give a link.
        const m = mounted('', false);

        m.editor.setValue('a bad b');
        selectIn(m, 'a bad b', 2, 5);
        m.editor.toggleLink(' \t');
        m.editor.setReadOnly(true);
        await browserSelects(m, 'bad', 1);

        const opened = followed();

        expect(m.editor.getSelectionState().linkUrl).toBe(' \t');

        pressEnter(m, 'bad');
        clickOn(m, 'bad');

        expect(opened).toEqual([]);
    });

    it('L7: a click beside a link opens nothing and is left alone, wherever the caret is', async () => {
        // A click that does not move the caret out of the link: on the surface's own padding, say, or on an image.
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const events = [clickOn(m, ' now'), clickOn(m, 'plain'), clickOn(m, null)];

        await settle();

        expect(opened).toEqual([]);
        expect(events.map((event) => event.defaultPrevented)).toEqual([false, false, false]);
    });

    it('L8: an editable editor follows no link: Enter in one splits the paragraph, and a click places the caret', async () => {
        const m = mounted('', false);

        m.editor.setValue(LINKED);
        selectIn(m, 'the docs', 3);

        const opened = followed();
        const blocks = m.lexical.read(() => $getRoot().getChildrenSize());

        clickOn(m, 'the docs');
        elementOf(m, 'the docs').dispatchEvent(beforeInput('insertParagraph', true));
        elementOf(m, 'the docs').dispatchEvent(keydown('Enter'));
        await settle();

        expect(opened).toEqual([]);
        expect(m.lexical.read(() => $getRoot().getChildrenSize())).toBe(blocks + 1);
    });

    it('L9: a link whose address is not a relative, web, mail or phone one is not followed, by Enter or by a click', async () => {
        // Addresses a Markdown link can be written with, and ones only `toggleLink` can give a link:
        // a browser drops a tab from an address before it reads the scheme, so the last three are script addresses to it.
        const written = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'blob:x', 'a:b.md'];
        const set = ['java\tscript:alert(1)', 'javascript\t:1/-alert(1)', ' javascript:alert(1)'];

        for (const url of [...written, ...set]) {
            const m = mounted('', false);

            m.editor.setValue('a bad b');
            selectIn(m, 'a bad b', 2, 5);
            m.editor.toggleLink(url);
            m.editor.setReadOnly(true);
            await browserSelects(m, 'bad', 1);

            const opened = followed();
            const seen = watch(m);

            expect(m.editor.getSelectionState().linkUrl, url).toBe(url);

            pressEnter(m, 'bad');

            const click = clickOn(m, 'bad');

            await settle();

            expect(opened, url).toEqual([]);
            // Enter there is then the refused edit it is anywhere else; the click is cancelled all the same.
            expect(seen.refusals(), url).toBe(1);
            expect(click.defaultPrevented, url).toBe(true);
            vi.restoreAllMocks();
        }
    });

    it('L10: every form of link is followed to the address it was written with', async () => {
        const forms: [string, string, string][] = [
            ['see [ref][r] here\n\n[r]: https://example.com/ref', 'ref', 'https://example.com/ref'],
            ['see <https://auto.example/x> here', 'https://auto.example/x', 'https://auto.example/x'],
            ['write [me](mailto:me@example.com) now', 'me', 'mailto:me@example.com'],
            ['call [us](tel:+4612345) or [text](sms:+4612345)', 'us', 'tel:+4612345'],
            ['call [us](tel:+4612345) or [text](sms:+4612345)', 'text', 'sms:+4612345'],
            ['an [upper](HTTPS://EXAMPLE.COM/Up) case scheme', 'upper', 'HTTPS://EXAMPLE.COM/Up'],
            ['plain [http](http://example.com/) too', 'http', 'http://example.com/'],
            ['- item [in a list](https://example.com/list)\n\n| a |\n| - |\n| [cell](https://example.com/cell) |', 'cell', 'https://example.com/cell'],
            // Relative addresses, opened as written: the link's own element holds `https://other.md` for the second.
            ['see [here](../other.md#part) now', 'here', '../other.md#part'],
            ['see [here](other.md) now', 'here', 'other.md'],
            ['see [here](docs/page.html) now', 'here', 'docs/page.html'],
            ['see [here](page?x=1) now', 'here', 'page?x=1'],
            ['see [here](/abs/path) now', 'here', '/abs/path'],
            ['see [here](#part) now', 'here', '#part'],
        ];

        for (const [source, text, href] of forms) {
            const m = await readOnlyAt(source, text, 1);
            const opened = followed();

            expect(m.editor.getSelectionState().linkUrl, source).toBe(href);

            pressEnter(m, text);
            clickOn(m, text);

            expect(opened, source).toEqual([{ ...OPENED, href }, { ...OPENED, href }]);
            vi.restoreAllMocks();
        }
    });

    it('L12: a click reads the browser\'s selection: one that comes before Lexical has heard of the caret it placed still follows the link', async () => {
        // A click places the caret and arrives ahead of the selectionchange that tells Lexical about it.
        const m = await readOnlyAt(LINKED, 'plain', 2);
        const opened = followed();
        const domText = domTextOf(m, 'the docs');
        const lexicalCaret = selectionOf(m);

        window.getSelection()?.setBaseAndExtent(domText, 3, domText, 3);
        clickOn(m, 'the docs');

        expect(opened).toEqual([OPENED]);
        // Lexical's own selection was still elsewhere, and following a link moved nothing.
        expect(selectionOf(m)).toBe(lexicalCaret);

        // And the drag Lexical has not heard of either: text of the link selected, so the click that ends it follows nothing.
        pressOn(m, 'the docs');
        window.getSelection()?.setBaseAndExtent(domText, 1, domText, 5);
        clickOn(m, 'the docs');

        expect(opened).toEqual([OPENED]);
    });

    it('L17: Enter follows a link exactly where the selection state reports one for a caret, the link\'s edges included', async () => {
        const m = await readOnlyAt(LINKED, 'plain', 2);
        const opened = followed();
        const places: [string, number][] = [
            ['see ', 0], ['see ', 4], ['the docs', 0], ['the docs', 1], ['the docs', 7], ['the docs', 8], [' now', 0], [' now', 1], ['plain', 0],
        ];
        const inLink: boolean[] = [];

        for (const [text, offset] of places) {
            await browserSelects(m, text, offset);

            const reported = m.editor.getSelectionState().linkUrl;
            const before = opened.length;

            pressEnter(m, text);
            inLink.push(reported !== null);

            expect(opened.length - before, `${text}:${offset}`).toBe(reported === null ? 0 : 1);
        }

        // The caret is in the link somewhere, and out of it somewhere: the row compares two things that both vary.
        expect(new Set(inLink)).toEqual(new Set([true, false]));

        // It is the editor's caret that counts, the one the state is read from: with the browser's moved into the
        // link and the editor not yet told, the state reports no link, and Enter is a refused edit.
        const domText = domTextOf(m, 'the docs');
        const seen = watch(m);
        const before = opened.length;

        await browserSelects(m, 'plain', 2);
        window.getSelection()?.setBaseAndExtent(domText, 3, domText, 3);
        pressEnter(m, 'the docs');

        expect(m.editor.getSelectionState().linkUrl).toBeNull();
        expect(opened.length).toBe(before);
        expect(seen.refusals()).toBe(1);
    });

    it('L13: with the surface not an editing host, the editor alone follows the link: once, and the browser\'s own following is cancelled', async () => {
        // setContentEditable(false) on a read-only editor: a browser follows an <a> there by itself, in the same tab,
        // from a click and from Enter on the focused link, which arrives as a click too.
        const m = await readOnlyAt(LINKED, 'plain', 2);

        m.editor.setContentEditable(false);

        const opened = followed();
        const seen = watch(m);
        const byMouse = clickOn(m, 'the docs');

        expect(opened).toEqual([OPENED]);
        expect(byMouse.defaultPrevented).toBe(true);

        // The click the browser makes of Enter on a focused link, which no pointer made: the selection is wherever
        // it was, text selected or not, text of the link itself included.
        await browserSelects(m, 'plain', 1, 4);

        const byKey = clickOn(m, 'the docs', 0);

        expect(opened).toEqual([OPENED, OPENED]);
        expect(byKey.defaultPrevented).toBe(true);

        await browserSelects(m, 'the docs', 1, 5);

        const byKeyOverItsOwnText = clickOn(m, 'the docs', 0);

        expect(opened).toEqual([OPENED, OPENED, OPENED]);
        expect(byKeyOverItsOwnText.defaultPrevented).toBe(true);

        window.getSelection()?.removeAllRanges();

        const withNoSelection = clickOn(m, 'the docs', 0);

        expect(opened).toEqual([OPENED, OPENED, OPENED, OPENED]);
        expect(withNoSelection.defaultPrevented).toBe(true);
        expect(seen.refusals()).toBe(0);
        expect(seen.changes()).toBe(0);
    });

    it('L14: an editable editor cancels no click on a link, whatever its surface is', async () => {
        for (const contentEditable of [true, false]) {
            const m = mounted('', false);

            m.editor.setValue(LINKED);
            m.editor.setContentEditable(contentEditable);

            const opened = followed();
            const event = clickOn(m, 'the docs');

            expect(opened).toEqual([]);
            expect(event.defaultPrevented).toBe(false);
            vi.restoreAllMocks();
        }
    });

    it('L15: a middle click on a link is the editor\'s too: followed once and cancelled; a click with the secondary button is left alone', async () => {
        // With the surface not an editing host a browser opens a middle-clicked link itself, at the address on the element.
        for (const contentEditable of [true, false]) {
            const m = await readOnlyAt('see [here](other.md) now', 'here', 1);

            m.editor.setContentEditable(contentEditable);

            const opened = followed();
            const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });
            const secondary = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 });
            const beside = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });

            elementOf(m, 'here').dispatchEvent(middle);
            elementOf(m, 'here').dispatchEvent(secondary);
            elementOf(m, 'see ').dispatchEvent(beside);

            expect(opened, String(contentEditable)).toEqual([{ ...OPENED, href: 'other.md' }]);
            expect([middle, secondary, beside].map((event) => event.defaultPrevented), String(contentEditable)).toEqual([true, false, false]);
            vi.restoreAllMocks();
        }

        const editable = mounted('', false);

        editable.editor.setValue('see [here](other.md) now');

        const opened = followed();
        const middle = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 });

        elementOf(editable, 'here').dispatchEvent(middle);

        expect(opened).toEqual([]);
        expect(middle.defaultPrevented).toBe(false);
    });

    it('L16: Enter is acted on once for each press: a held key\'s repeats are stopped, in a link and out of one', async () => {
        // What a browser sends for a held Enter: a keydown, then keydowns marked as repeats, each with a
        // beforeinput of its own unless the keydown is cancelled.
        const inLink = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const seenInLink = watch(inLink);
        const press = pressEnter(inLink, 'the docs');
        const repeats = [pressEnter(inLink, 'the docs', 'insertParagraph', { repeat: true }), pressEnter(inLink, 'the docs', 'insertParagraph', { repeat: true })];

        expect(press.key.defaultPrevented).toBe(true);
        expect(repeats.map((repeat) => [repeat.key.defaultPrevented, repeat.edit])).toEqual([[true, null], [true, null]]);
        expect(opened).toEqual([OPENED]);
        expect(seenInLink.refusals()).toBe(0);

        // Out of a link the press is the refused edit, once, and the repeats neither flash nor open anything.
        const outside = await readOnlyAt(LINKED, 'plain', 2);
        const seenOutside = watch(outside);
        const first = pressEnter(outside, 'plain');
        const held = [pressEnter(outside, 'plain', 'insertParagraph', { repeat: true }), pressEnter(outside, 'plain', 'insertParagraph', { repeat: true })];

        expect(first.key.defaultPrevented).toBe(false);
        expect(held.map((repeat) => [repeat.key.defaultPrevented, repeat.edit])).toEqual([[true, null], [true, null]]);
        expect(opened).toEqual([OPENED]);
        expect(seenOutside.refusals()).toBe(1);
        expect(seenOutside.flashes()).toBe(1);
    });

    /**
     * Every place a browser can put a caret in the surface: each offset of each text node, and each child offset
     * of each element, the surface's own among them.
     */
    function caretPlaces(m: Mounted): [Node, number][] {
        const places: [Node, number][] = [];
        const walker = document.createTreeWalker(m.root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);

        for (let node: Node | null = m.root; node !== null; node = walker.nextNode()) {
            const count = node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length;

            for (let offset = 0; offset <= count; offset++) {
                places.push([node, offset]);
            }
        }

        return places;
    }

    /** Documents with a link at every kind of place, and the addresses a caret can reach in each. */
    const LINK_PLACES: [string, string, string[]][] = [
        ['a row of image links', '[![build](a.svg)](https://example.com/build) [![docs](b.svg)](https://example.com/docs)', ['https://example.com/build', 'https://example.com/docs']],
        ['an image link in prose', 'picture: [![alt text](a.svg)](https://example.com/img) after', ['https://example.com/img']],
        ['an image link alone', '[![alt2](b.svg)](https://example.com/img2)', ['https://example.com/img2']],
        ['a link of text around an image', 'text [word ![alt3](c.svg) more](https://example.com/mixed) end', ['https://example.com/mixed']],
        ['links at a paragraph\'s start and end', '[start](https://example.com/s) middle [end](https://example.com/e)', ['https://example.com/s', 'https://example.com/e']],
        ['a link in a table cell', '| a |\n| - |\n| x [cell](https://example.com/cell) y |', ['https://example.com/cell']],
        ['a link in a list item', '- item [in a list](https://example.com/list) end', ['https://example.com/list']],
        ['a link in a heading', '# Head [link](https://example.com/h) tail', ['https://example.com/h']],
    ];

    for (const [kind, source, addresses] of LINK_PLACES) {
        it(`L21: Enter follows a link at every caret place where the selection state reports one, and nowhere else: ${kind}`, async () => {
            // Whatever edit a browser would announce for the key there: Chromium announces a line break, not a
            // paragraph break, beside an image inside a link.
            for (const inputType of ['insertParagraph', 'insertLineBreak']) {
                const m = mounted('', true);

                m.editor.setValue(source);

                const opened = followed();
                const reached = new Set<string>();
                let outside = 0;

                for (const [node, offset] of caretPlaces(m)) {
                    const label = `${node.nodeName}${node.nodeType === Node.TEXT_NODE ? ` ${JSON.stringify((node as Text).data)}` : ''}:${offset}`;

                    window.getSelection()!.collapse(node, offset);
                    document.dispatchEvent(new Event('selectionchange'));
                    await microtasks();

                    const reported = m.editor.getSelectionState().linkUrl;
                    const count = opened.length;
                    const seen = watch(m);
                    const { key, edit } = pressEnter(m, null, inputType);

                    expect(opened.slice(count).map((anchor) => anchor.href), label).toEqual(reported === null ? [] : [reported]);
                    expect(key.defaultPrevented, label).toBe(reported !== null);
                    expect(edit === null, label).toBe(reported !== null);
                    expect(seen.refusals(), label).toBe(reported === null ? 1 : 0);

                    if (reported === null) {
                        outside += 1;
                    } else {
                        reached.add(reported);
                    }
                }

                // Every link of the document is reached from a caret, and there are places in no link.
                expect([...reached].sort(), inputType).toEqual([...addresses].sort());
                expect(outside, inputType).toBeGreaterThan(0);
                vi.restoreAllMocks();
            }
        });
    }

    it('L22: Enter with a modifier key, Enter while composing, and Enter where the surface is no editing host are not the key that follows', async () => {
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();
        const seen = watch(m);
        const variants: [string, KeyModifiers, string][] = [
            ['Shift', { shiftKey: true }, 'insertLineBreak'], ['Ctrl', { ctrlKey: true }, 'insertParagraph'], ['Alt', { altKey: true }, 'insertParagraph'],
            ['Meta', { metaKey: true }, 'insertParagraph'], ['Ctrl+Shift', { ctrlKey: true, shiftKey: true }, 'insertLineBreak'],
            ['composing', { isComposing: true }, 'insertParagraph'],
        ];

        for (const [name, modifiers, inputType] of variants) {
            const { key, edit } = pressEnter(m, 'the docs', inputType, modifiers);

            // Left to the browser; the edit it then announces is refused like any other.
            expect(key.defaultPrevented, name).toBe(false);
            expect(edit!.defaultPrevented, name).toBe(true);
        }

        expect(opened).toEqual([]);
        expect(seen.refusals()).toBe(variants.length);

        // No other key is the key that follows, pressed alone at the same caret.
        for (const other of ['a', ' ', 'Tab', 'ArrowRight', 'Backspace', 'Delete', 'Escape', 'F2']) {
            const event = keydown(other);

            m.root.dispatchEvent(event);

            expect(event.defaultPrevented, other).toBe(false);
        }

        expect(opened).toEqual([]);

        // The Enter of the number pad is the same key, by another name of its place on the keyboard.
        const numpad = new KeyboardEvent('keydown', { key: 'Enter', code: 'NumpadEnter', bubbles: true, cancelable: true });

        m.root.dispatchEvent(numpad);

        expect(numpad.defaultPrevented).toBe(true);
        expect(opened).toEqual([OPENED]);
        opened.length = 0;

        // With contenteditable off there is no caret: the key goes to a focused link, and the browser makes a
        // click of it, which the editor follows (row L13). The editor's own selection, wherever it was left, is
        // not asked.
        m.editor.setContentEditable(false);

        const onLink = keydown('Enter');

        elementOf(m, 'the docs').dispatchEvent(onLink);

        expect(onLink.defaultPrevented).toBe(false);
        expect(opened).toEqual([]);

        // An editable editor's Enter is never taken.
        const editable = mounted('', false);

        editable.editor.setValue(LINKED);
        selectIn(editable, 'the docs', 3);

        const onEditable = keydown('Enter');

        editable.root.dispatchEvent(onEditable);

        expect(opened).toEqual([]);
    });

    it('L11: read-only switched off and on again: links are followed only while it is on', async () => {
        const m = await readOnlyAt(LINKED, 'the docs', 3);
        const opened = followed();

        m.editor.setReadOnly(false);
        clickOn(m, 'the docs');

        expect(opened).toEqual([]);

        m.editor.setReadOnly(true);
        await browserSelects(m, 'the docs', 3);
        clickOn(m, 'the docs');

        expect(opened).toEqual([OPENED]);
    });
});

// The context menu's Insert link, Edit link, Image… and Column width… handlers await
// a dialog and then run an editing command. If the editor became read-only and was
// disposed while the dialog was open, the command is refused and asks for the
// rejection wash, whose element handle the teardown has released.
describe('MarkdownEditor read-only, mounted: a dialog answered after dispose', () => {
    type Prompting = {
        promptAndApplyLink(title: string, defaultUrl: string): Promise<void>;
        promptAndInsertImage(): Promise<void>;
        promptAndSetColumnWidth(): Promise<void>;
    };

    afterEach(() => vi.restoreAllMocks());

    /**
     * Opens a context-menu dialog, makes the editor read-only, disposes it, then
     * confirms the dialog with `answer` and expects the continuation to finish.
     *
     * @param answer - The text the user confirms the dialog's field with.
     * @param run - Starts the continuation under test and returns its promise.
     */
    async function answerAfterDispose(answer: string, run: (editor: Prompting) => Promise<void>): Promise<void> {
        const m = mounted(SOURCE, false);
        let confirmDialog!: () => void;

        vi.spyOn(Dialog, 'show').mockImplementation((config) => new Promise<'confirm'>((resolve) => {
            confirmDialog = () => {
                (config.contentComponent as TextField).setValue(answer);
                resolve('confirm');
            };
        }));

        const pending = run(m.editor as unknown as Prompting);

        m.editor.setReadOnly(true);
        built.splice(built.indexOf(m.editor), 1);
        m.editor.dispose();
        confirmDialog();

        await expect(pending).resolves.toBeUndefined();
    }

    it('Insert link does not fail', async () => {
        await answerAfterDispose('https://example.com', (editor) => editor.promptAndApplyLink('Insert link', ''));
    });

    it('Edit link does not fail', async () => {
        await answerAfterDispose('https://new.example.com', (editor) => editor.promptAndApplyLink('Edit link', 'https://old.example.com'));
    });

    it('Image… does not fail', async () => {
        await answerAfterDispose('https://example.com/a.png', (editor) => editor.promptAndInsertImage());
    });

    it('Column width… does not fail', async () => {
        await answerAfterDispose('240', (editor) => editor.promptAndSetColumnWidth());
    });
});
