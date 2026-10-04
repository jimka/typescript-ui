// @vitest-environment jsdom
//
// In a browser, `@lexical/table` registers its own Backspace, Delete and cut
// handlers once per table, from the table selection observer. Before handing
// a selection running from a paragraph into a table cell on, they move the
// end inside the table to the start of the block after it (or the end of the
// block before it), so Lexical's range removal joins that block onto the
// paragraph. `MarkdownEditor` registers the observer only once Lexical has a
// real root element, which the modelled test DOM never provides, so offline
// none of these handlers exist and a key-route test there would pass with or
// without the editor's table-edge guard. This file keeps the
// `@vitest-environment jsdom` pragma, gives the editor a real root element
// and registers the observer itself, as the editor's WYSIWYG mount does, and
// must not call installTestDOM.

// Keeps `@lexical/clipboard`'s real module (`@lexical/rich-text` imports it
// for its paste path) and replaces only `copyToClipboard`, which needs a
// browser clipboard jsdom does not have.
vi.mock('@lexical/clipboard', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@lexical/clipboard')>()),
    copyToClipboard: vi.fn(async () => true),
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { copyToClipboard } from '@lexical/clipboard';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $isTextNode, $setSelection, COPY_COMMAND,
    CUT_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, createEditor,
} from 'lexical';
import type { ElementNode, LexicalEditor, PointType, TextNode } from 'lexical';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import {
    $createTableNodeWithDimensions, $isTableNode, registerTablePlugin, registerTableSelectionObserver,
    TableCellNode, TableNode, TableRowNode,
} from '@lexical/table';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';

/** What a test registered on a Lexical editor, unregistered after it. */
const unregister: (() => void)[] = [];

beforeEach(() => {
    // jsdom has neither; `@lexical/table`'s cut handler uses both while the editor's guard is missing.
    vi.stubGlobal('ClipboardEvent', class ClipboardEvent {});
    Object.assign(document, { execCommand: () => true });
});
afterEach(() => {
    unregister.splice(0).forEach((remove) => remove());
    DOM.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(copyToClipboard).mockClear();
    Reflect.deleteProperty(document, 'execCommand');
    document.body.replaceChildren();
});

/** A selection end: the exact text content of a text node, and an offset in it. */
type TextPoint = [text: string, offset: number];

/**
 * A selection end: a text point, or an element point on the document's first
 * table — the end of its last row's last cell, the start of its first row's
 * first cell, or the start of the table node itself.
 */
type End = TextPoint | 'last-cell-end' | 'first-cell-start' | 'table-start';

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
 * The document's text node whose text content is exactly `text`. Must run
 * inside a read or update.
 *
 * @param text - The text content to find.
 * @returns The text node.
 */
function $textNode(text: string): TextNode {
    const found = $dfs().map(({ node }) => node).find((node) => $isTextNode(node) && node.getTextContent() === text);

    if (!$isTextNode(found)) {
        throw new Error(`no text node holds ${JSON.stringify(text)}`);
    }

    return found;
}

/**
 * The document's first table. Must run inside a read or update.
 *
 * @returns The table node.
 */
function $firstTable(): TableNode {
    const found = $dfs().map(({ node }) => node).find($isTableNode);

    if (!$isTableNode(found)) {
        throw new Error('the document holds no table');
    }

    return found;
}

/**
 * Sets `point` to `end`. Must run inside an update.
 *
 * @param point - The selection point to set.
 * @param end - Where it goes.
 */
function $setEnd(point: PointType, end: End): void {
    if (Array.isArray(end)) {
        point.set($textNode(end[0]).getKey(), end[1], 'text');

        return;
    }

    const table = $firstTable();

    if (end === 'table-start') {
        point.set(table.getKey(), 0, 'element');

        return;
    }

    if (end === 'first-cell-start') {
        const firstCell = (table.getFirstChildOrThrow() as ElementNode).getFirstChildOrThrow() as ElementNode;

        point.set(firstCell.getKey(), 0, 'element');

        return;
    }

    const lastCell = (table.getLastChildOrThrow() as ElementNode).getLastChildOrThrow() as ElementNode;

    point.set(lastCell.getKey(), lastCell.getChildrenSize(), 'element');
}

/**
 * Selects from `anchor` to `focus`.
 *
 * @param editor - The editor.
 * @param anchor - Where the selection's anchor goes.
 * @param focus - Where the selection's focus goes.
 */
function select(editor: MarkdownEditor, anchor: End, focus: End): void {
    lexicalOf(editor).update(() => {
        const selection = $createRangeSelection();

        $setEnd(selection.anchor, anchor);
        $setEnd(selection.focus, focus);
        $setSelection(selection);
    }, { discrete: true });
}

/**
 * Gives `editor`'s Lexical editor a real root element under the document
 * body and registers `@lexical/table`'s selection observer on it, as the
 * editor's WYSIWYG mount does once Lexical has a root element.
 *
 * @param editor - The editor.
 */
function mount(editor: MarkdownEditor): void {
    const root = document.createElement('div');

    root.contentEditable = 'true';
    document.body.append(root);
    lexicalOf(editor).setRootElement(root);
    unregister.push(registerTableSelectionObserver(lexicalOf(editor), true));
}

/**
 * Loads `source`, mounts the editor, and selects from `anchor` to `focus`.
 *
 * @param source - The Markdown to load.
 * @param anchor - Where the selection's anchor goes.
 * @param focus - Where the selection's focus goes.
 * @returns The editor.
 */
function mountedWithSelection(source: string, anchor: End, focus: End): MarkdownEditor {
    const editor = load(source);

    mount(editor);
    select(editor, anchor, focus);

    return editor;
}

/**
 * Dispatches a key command with a cancelable keydown event, inside a discrete
 * update, as Lexical's own key handling does.
 *
 * @param editor - The editor.
 * @param command - `KEY_DELETE_COMMAND` or `KEY_BACKSPACE_COMMAND`.
 * @returns The dispatched event.
 */
function pressKey(editor: LexicalEditor, command: typeof KEY_DELETE_COMMAND | typeof KEY_BACKSPACE_COMMAND): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { cancelable: true });

    editor.update(() => {
        editor.dispatchCommand(command, event);
    }, { discrete: true });

    return event;
}

/**
 * The text of each table cell in `html`, in document order.
 *
 * @param html - Copied HTML.
 * @returns The cells' texts, tags stripped.
 */
function cellTexts(html: string): string[] {
    return [...html.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs)].map(([, cell]) => cell!.replace(/<[^>]+>/g, ''));
}

const T = '| a | b |\n| --- | --- |\n| c1 | d1 |';
const T2 = '| x |\n| - |\n| y |';
const DOC = `Above para\n\n${T}\n\nafter`;
const TWO_TABLES = `Above para\n\n${T}\n\nmid\n\n${T2}\n\nafter`;

describe('@lexical/table\'s key and cut handlers no longer join the block past a table (K rows)', () => {
    it('K1: Delete over a range from a paragraph to the end of the last cell', () => {
        const editor = mountedWithSelection(DOC, ['Above para', 4], 'last-cell-end');
        const event = pressKey(lexicalOf(editor), KEY_DELETE_COMMAND);

        expect(editor.getValue()).toBe('Abov\n\nafter');
        expect(event.defaultPrevented).toBe(true);
    });

    it('K2: Backspace over a range from a paragraph to the end of the last cell', () => {
        const editor = mountedWithSelection(DOC, ['Above para', 4], 'last-cell-end');

        pressKey(lexicalOf(editor), KEY_BACKSPACE_COMMAND);

        expect(editor.getValue()).toBe('Abov\n\nafter');
    });

    it('K3: Delete over a range from the first cell into the paragraph after', () => {
        const editor = mountedWithSelection(DOC, 'first-cell-start', ['after', 2]);

        pressKey(lexicalOf(editor), KEY_DELETE_COMMAND);

        expect(editor.getValue()).toBe('Above para\n\nter');
    });

    it('K4: a native cut (CUT_COMMAND) of a range from a paragraph to the end of the last cell', async () => {
        const editor = mountedWithSelection(DOC, ['Above para', 4], 'last-cell-end');

        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);
        }, { discrete: true });

        await vi.waitFor(() => expect(editor.getValue()).toBe('Abov\n\nafter'));
    });

    // `@lexical/table` grows a range into one table over that table, but not one from a table into another:
    // the cut copies both tables whole all the same, as it removes them.
    it('K6: a native cut (CUT_COMMAND) of a range from one table into another copies what it removes', async () => {
        const editor = mountedWithSelection(TWO_TABLES, ['c1', 1], ['x', 1]);

        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(CUT_COMMAND, null);
        }, { discrete: true });

        await vi.waitFor(() => expect(editor.getValue()).toBe('Above para\n\nafter'));

        const data = vi.mocked(copyToClipboard).mock.calls[0]![2];

        expect(data?.['text/plain']?.split(/\s+/)).toEqual(['a', 'b', 'c1', 'd1', 'mid', 'x', 'y']);
        expect(cellTexts(data?.['text/html'] ?? '')).toEqual(['a', 'b', 'c1', 'd1', 'x', 'y']);
    });

    // No handler of `@lexical/table` takes a copy; the row pins that the editor's guard does, on a mounted editor
    // too, and that the HTML and the Lexical nodes it copies are the cut's, not only the text.
    it('K7: a native copy (COPY_COMMAND) of a range from a paragraph into a cell\'s word copies what a cut removes', async () => {
        const cutFrom = mountedWithSelection(DOC, ['Above para', 4], ['c1', 1]);

        lexicalOf(cutFrom).update(() => {
            lexicalOf(cutFrom).dispatchCommand(CUT_COMMAND, null);
        }, { discrete: true });

        await vi.waitFor(() => expect(cutFrom.getValue()).toBe('Abov\n\nafter'));

        const editor = mountedWithSelection(DOC, ['Above para', 4], ['c1', 1]);

        lexicalOf(editor).update(() => {
            lexicalOf(editor).dispatchCommand(COPY_COMMAND, null);
        }, { discrete: true });

        const [cutData, copiedData] = vi.mocked(copyToClipboard).mock.calls.map(([, , data]) => data);
        // The rest of the Lexical payload is the editor's namespace, which differs from one editor to the next.
        const nodesOf = (data: typeof cutData): unknown => JSON.parse(data?.['application/x-lexical-editor'] ?? '{}').nodes;

        expect(copiedData?.['text/plain']).toBe(cutData?.['text/plain']);
        expect(copiedData?.['text/html']).toBe(cutData?.['text/html']);
        expect(nodesOf(copiedData)).toEqual(nodesOf(cutData));
        expect(copiedData?.['text/plain']?.trim().split(/\s+/)).toEqual(['e', 'para', 'a', 'b', 'c1', 'd1']);
        expect(cellTexts(copiedData?.['text/html'] ?? '')).toEqual(['a', 'b', 'c1', 'd1']);
        expect(editor.getValue()).toBe(DOC);
    });
});

describe('upstream canary: the @lexical/table bug the key listeners work around still reproduces', () => {
    // When this fails after a Lexical upgrade, `@lexical/table` no longer joins
    // the block after a table; the two key listeners
    // `$backspaceOverTableEdgeRange` / `$deleteKeyOverTableEdgeRange` may then
    // be removable — keep the rest of the table-edge guard, which also covers
    // routes `@lexical/table` never handled.
    it('K5: Delete over a range from a paragraph to the end of the last cell joins the paragraph after the table', () => {
        const editor = createEditor({
            nodes: [HeadingNode, QuoteNode, TableNode, TableRowNode, TableCellNode],
            onError: (error) => { throw error; },
        });
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        unregister.push(registerRichText(editor), registerTablePlugin(editor), registerTableSelectionObserver(editor, true));

        editor.update(() => {
            const above = $createTextNode('Above para');
            const table = $createTableNodeWithDimensions(2, 2, true);

            $getRoot().append($createParagraphNode().append(above), table, $createParagraphNode().append($createTextNode('after')));

            const lastCell = (table.getLastChildOrThrow() as ElementNode).getLastChildOrThrow() as ElementNode;
            const selection = $createRangeSelection();

            selection.anchor.set(above.getKey(), 4, 'text');
            selection.focus.set(lastCell.getKey(), lastCell.getChildrenSize(), 'element');
            $setSelection(selection);
        }, { discrete: true });

        pressKey(editor, KEY_DELETE_COMMAND);

        expect(editor.read(() => $getRoot().getChildren().map((child) => child.getTextContent()))).toEqual(['Abovafter']);
    });
});
