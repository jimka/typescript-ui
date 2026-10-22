import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $isTextNode, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND,
    KEY_ENTER_COMMAND, UNDO_COMMAND,
} from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { $createListItemNode, $isListItemNode, ListItemNode } from '@lexical/list';
import { $isCodeNode } from '@lexical/code';
import { $createTableCellNode, $createTableRowNode, $isTableCellNode, $isTableRowNode, TableCellHeaderStates, TableCellNode } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownSourceMap } from '~/component/editor/markdownSourceMap';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $isMarkdownSourceTextNode } from '~/component/editor/markdownSourceNodes';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave } from './markdown-roundtrip/harness';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

// Wraps the lexer in a spy that still lexes, so a test can count how often a save lexes a block's text.
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

/**
 * Joins lines with line ends, so a row's document reads as the list of lines it is.
 *
 * @param lines - The lines.
 * @returns The text.
 */
function lines(...lines: string[]): string {
    return lines.join('\n');
}

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
 * The first plain text node whose text is exactly `text`. Must run inside a read or update.
 *
 * @param text - The node's text.
 * @returns The node.
 */
function $textNode(text: string): TextNode {
    const node = $dfs().map(({ node: candidate }) => candidate)
        .find((candidate) => $isTextNode(candidate) && !$isMarkdownSourceTextNode(candidate) && candidate.getTextContent() === text);

    if (node === undefined || !$isTextNode(node)) {
        throw new Error(`No text node holds '${text}'.`);
    }

    return node;
}

/**
 * Appends `suffix` to the first text node holding exactly `text`, as typing at its end would.
 *
 * @param editor - The editor.
 * @param text - The text node's text.
 * @param suffix - The text to append.
 */
function append(editor: MarkdownEditor, text: string, suffix: string = '!'): void {
    update(editor, () => {
        const node = $textNode(text);

        node.setTextContent(node.getTextContent() + suffix);
    });
}

/**
 * Puts the caret at an offset of the first text node holding exactly `text`, and presses Enter there.
 *
 * @param editor - The editor.
 * @param text - The text node's text.
 * @param offset - The caret's offset in it.
 */
function pressEnterAt(editor: MarkdownEditor, text: string, offset: number): void {
    update(editor, () => {
        $textNode(text).select(offset, offset);
    });
    lexicalOf(editor).dispatchCommand(KEY_ENTER_COMMAND, null);
}

/**
 * Types `typed` over the whole of the first text node holding exactly `text`.
 *
 * @param editor - The editor.
 * @param text - The text node's text.
 * @param typed - What is typed.
 */
function typeOver(editor: MarkdownEditor, text: string, typed: string): void {
    update(editor, () => {
        const node = $textNode(text);
        const selection = $createRangeSelection();

        selection.anchor.set(node.getKey(), 0, 'text');
        selection.focus.set(node.getKey(), node.getTextContentSize(), 'text');
        $setSelection(selection);
    });
    lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, typed);
}

/**
 * The list item holding a text node whose text is `text`. Must run inside a read or update.
 *
 * @param text - The item's text.
 * @returns The item.
 */
function $itemOf(text: string): LexicalNode {
    const item = $textNode(text).getParents().find($isListItemNode);

    if (item === undefined) {
        throw new Error(`No list item holds '${text}'.`);
    }

    return item;
}

/**
 * Inserts a list item with the text `word` after the item holding `after`.
 *
 * @param editor - The editor.
 * @param after - The text of the item to insert after.
 * @param word - The new item's text.
 */
function insertItemAfter(editor: MarkdownEditor, after: string, word: string): void {
    update(editor, () => {
        $itemOf(after).insertAfter($createListItemNode().append($createMarkdownListItemTextNode().append($createTextNode(word))));
    });
}

/**
 * Deletes the list item holding `text`.
 *
 * @param editor - The editor.
 * @param text - The item's text.
 */
function deleteItem(editor: MarkdownEditor, text: string): void {
    update(editor, () => {
        $itemOf(text).remove();
    });
}

/**
 * Builds a body table row of one paragraph per cell.
 *
 * @param texts - The cells' texts.
 * @returns The row.
 */
function $rowOf(texts: string[]): LexicalNode {
    return $createTableRowNode().append(...texts.map((text) => (
        $createTableCellNode(TableCellHeaderStates.NO_STATUS).append($createParagraphNode().append($createTextNode(text)))
    )));
}

/**
 * The table row holding a cell whose text is `text`. Must run inside a read or update.
 *
 * @param text - A cell's text.
 * @returns The row.
 */
function $rowHolding(text: string): LexicalNode {
    const row = $textNode(text).getParents().find($isTableRowNode);

    if (row === undefined) {
        throw new Error(`No table row holds '${text}'.`);
    }

    return row;
}

/**
 * Moves the document's first block into the first column of the fence that ends the document, before that column's
 * first block.
 *
 * @param editor - The editor.
 */
function moveFirstBlockIntoColumn(editor: MarkdownEditor): void {
    update(editor, () => {
        const block = $getRoot().getFirstChild()!;
        const column = ($getRoot().getLastChild() as ElementNode).getFirstChild() as ElementNode;

        column.getFirstChild()!.insertBefore(block);
    });
}

/**
 * Inserts a body row of two cells after the row holding `after`.
 *
 * @param editor - The editor.
 * @param after - The text of a cell of the row to insert after.
 */
function insertRowAfter(editor: MarkdownEditor, after: string): void {
    update(editor, () => {
        $rowHolding(after).insertAfter($rowOf(['x', 'y']));
    });
}

/**
 * Checks the two promises a save keeps beside its text: it loaded into a fresh editor saves to itself and gives the
 * same surface model, and the viewer reads it as it reads the standard form of the same document.
 *
 * @param editor - The edited editor.
 */
function expectPromises(editor: MarkdownEditor): void {
    const saved = editor.getValue();
    const reloaded = load(saved);

    expect(reloaded.getValue()).toBe(saved);
    expect(editorSurfaceModel(reloaded)).toEqual(editorSurfaceModel(editor));
    expect(viewerModel(saved)).toEqual(viewerModel(canonicalSave(editor)));
}

/** One row of the tables: a source, an edit and the save. */
interface Row {
    readonly id:     string;
    readonly source: string;
    readonly edit:   (editor: MarkdownEditor) => void;
    readonly saved:  string;
}

/**
 * Runs rows: loads the source, checks it saves as loaded, edits, and checks the save and the two promises.
 *
 * @param rows - The rows.
 */
function runRows(rows: readonly Row[]): void {
    it.each(rows.map((row) => [`${row.id}. ${JSON.stringify(row.source)}`, row] as const))('%s', (_title, row) => {
        const editor = load(row.source);

        expect(editor.getValue()).toBe(row.source);

        row.edit(editor);

        expect(editor.getValue()).toBe(row.saved);
        expectPromises(editor);
    });
}

describe('1. list items', () => {
    runRows([
        {
            id: '1.1', source: lines('* one', '* two', '* three'), edit: (editor) => append(editor, 'two'),
            saved: lines('* one', '* two!', '* three'),
        },
        {
            id: '1.2', source: lines('* one', '    * inner', '* two'), edit: (editor) => append(editor, 'two'),
            saved: lines('* one', '    * inner', '* two!'),
        },
        {
            id: '1.3', source: lines('* one', '    * inner', '    * more', '* two'), edit: (editor) => append(editor, 'inner'),
            saved: lines('* one', '    * inner!', '    * more', '* two'),
        },
        {
            id:     '1.4', source: lines('1.  one', '    more', '', '    - x', '2.  two'), edit: (editor) => append(editor, 'one'),
            saved:  lines('1.  one!', '    more', '    - x', '', '2.  two'),
        },
        {
            id: '1.5', source: lines('3. a', '4. b', '5. c'), edit: (editor) => insertItemAfter(editor, 'a', 'x'),
            saved: lines('3. a', '4. x', '5. b', '6. c'),
        },
        {
            id: '1.6', source: lines('3. a', '4. b', '5. c'), edit: (editor) => deleteItem(editor, 'a'),
            saved: lines('3. b', '4. c'),
        },
        {
            id: '1.7', source: lines('8. a', '9. b', '10. c'), edit: (editor) => insertItemAfter(editor, 'a', 'x'),
            saved: lines('8. a', '9. x', '10. b', '11. c'),
        },
        {
            id: '1.8', source: lines('+ one', '', '+ two', '', '+ three'), edit: (editor) => deleteItem(editor, 'two'),
            saved: lines('+ one', '', '+ three'),
        },
        {
            id: '1.9', source: lines('* a', '', '* b', '* c'), edit: (editor) => append(editor, 'c'),
            saved: lines('* a', '', '* b', '', '* c!'),
        },
        {
            id: '1.10', source: lines('- a', '  - x', '  -', '    ---'), edit: (editor) => deleteItem(editor, 'x'),
            saved: lines('- a', '  * ---'),
        },
        {
            id: '1.10b', source: lines('- a', '    - x', '    -', '      ---'), edit: (editor) => deleteItem(editor, 'x'),
            saved: lines('- a', '  * ---'),
        },
        {
            id: '1.11', source: lines('-   a', '   - b'), edit: (editor) => insertItemAfter(editor, 'a', 'x'),
            saved: lines('-   a', '- x', '- b'),
        },
        {
            id: '1.12', source: lines('- a', '  - b', '    > q', '', '- c'), edit: (editor) => deleteItem(editor, 'c'),
            saved: lines('- a', '', '  - b', '    > q'),
        },
        {
            id: '1.13', source: lines('- a', 'b', '- c'), edit: (editor) => append(editor, 'c'),
            saved: lines('- a', '  b', '- c!'),
        },
        {
            id: '1.14', source: lines('- one', '\t- inner', '- two'), edit: (editor) => append(editor, 'two'),
            saved: lines('- one', '  - inner', '- two!'),
        },
        {
            id: '1.15', source: lines('- [y] a', '- b', '', '[z]: /u'),
            edit: (editor) => {
                update(editor, () => {
                    const raw = $getRoot().getLastChild() as ElementNode;

                    raw.clear();
                    raw.append($createTextNode('[y]: /u'));
                });
                append(editor, 'b');
            },
            saved: lines('- \\[y\\] a', '- b!', '', '[y]: /u'),
        },
        {
            id: '1.16', source: lines('* one', '    * inner', '* two', '', 'para'), edit: (editor) => append(editor, 'para'),
            saved: lines('* one', '    * inner', '* two', '', 'para!'),
        },
        {
            id: '1.17', source: lines('08. a', '09. b', '', '         code', '10. c'), edit: (editor) => deleteItem(editor, 'a'),
            saved: lines('8. b', '', '   ```', '    code', '   ```', '', '9. c'),
        },
        {
            id: '1.18', source: lines('8. a', '9. b', '', '       code'), edit: (editor) => insertItemAfter(editor, 'a', 'x'),
            saved: lines('8. a', '', '9. x', '', '10. b', '', '    ```', '    code', '    ```'),
        },
        {
            id: '1.19', source: lines('3. a', '4. b', '', '       code'), edit: (editor) => insertItemAfter(editor, 'a', 'x'),
            saved: lines('3. a', '', '4. x', '', '5. b', '', '       code'),
        },
        {
            id: '1.20', source: lines('08. a', '09. b', '', '         code', '10. c'), edit: (editor) => append(editor, 'c'),
            saved: lines('08. a', '', '09. b', '', '         code', '', '10. c!'),
        },
        {
            id: '1.21', source: lines('- a', '', '  b', '  :::', '', '::: columns', 'x', '|||', 'y', ':::'), edit: moveFirstBlockIntoColumn,
            saved: lines('::: columns', '- a', '', '  b', '  \\:::', '', 'x', '|||', 'y', ':::'),
        },
    ]);
});

describe('2. tables', () => {
    const T = lines('| a   | bb |', '|-----|----|', '| 1   | 2  |', '| 3   | 4  |');

    runRows([
        {
            id: '2.1', source: T, edit: (editor) => append(editor, '3'),
            saved: lines('| a   | bb |', '|-----|----|', '| 1   | 2  |', '| 3! | 4  |'),
        },
        {
            id: '2.2', source: T,
            edit: (editor) => update(editor, () => {
                $rowHolding('a').insertAfter($rowOf(['x', 'y']));
            }),
            saved: lines('| a   | bb |', '|-----|----|', '| x | y |', '| 1   | 2  |', '| 3   | 4  |'),
        },
        {
            id: '2.3', source: T, edit: (editor) => update(editor, () => $rowHolding('1').remove()),
            saved: lines('| a   | bb |', '|-----|----|', '| 3   | 4  |'),
        },
        {
            id: '2.4', source: T,
            edit: (editor) => update(editor, () => {
                const cell = $textNode('2').getParents().find($isTableCellNode)!;

                cell.insertAfter($createTableCellNode(TableCellHeaderStates.NO_STATUS).append($createParagraphNode().append($createTextNode('z'))));
            }),
            saved: lines('| a   | bb |  |', '| --- | --- | --- |', '| 1   | 2  | z |', '| 3   | 4  |  |'),
        },
        {
            id: '2.6', source: `${T}\n`, edit: (editor) => append(editor, '3'),
            saved: lines('| a   | bb |', '|-----|----|', '| 1   | 2  |', '| 3! | 4  |', ''),
        },
        {
            id: '2.7', source: lines('| x |', '|---|', '|||', '', '::: columns', 'a', '|||', 'b', ':::'), edit: moveFirstBlockIntoColumn,
            saved: lines('::: columns', '| x |', '|---|', '|  |', '', 'a', '|||', 'b', ':::'),
        },
        {
            id: '2.8', source: lines('| [y] | b  |', '|-----|----|', '| 1   | 2  |', '', '[z]: /u'),
            edit: (editor) => {
                update(editor, () => {
                    const raw = $getRoot().getLastChild() as ElementNode;

                    raw.clear();
                    raw.append($createTextNode('[y]: /u'));
                });
                append(editor, '2');
            },
            saved: lines('| \\[y\\] | b |', '|-----|----|', '| 1   | 2! |', '', '[y]: /u'),
        },
        {
            id: '2.9', source: lines('| a  | b  |', '|----|----|', '| 1  | ^^ |', '| 3  | 4  |'), edit: (editor) => insertRowAfter(editor, 'a'),
            saved: lines('| a  | b  |', '|----|----|', '| x | y |', '| 1  | \\^^ |', '| 3  | 4  |'),
        },
        {
            id: '2.10', source: lines('- item', '', '  | a  | b  |', '  |----|----|', '  | 1  | ^^ |', '  | 3  | 4  |'),
            edit: (editor) => insertRowAfter(editor, 'a'), saved: lines('- item', '', '  | a  | b  |', '  |----|----|', '  | x | y |', '  | 1  | \\^^ |', '  | 3  | 4  |'),
        },
        {
            id: '2.11', source: lines('::: columns', '| a  | b  |', '|----|----|', '| 1  | ^^ |', '|||', 'c', ':::'),
            edit: (editor) => insertRowAfter(editor, 'a'), saved: lines('::: columns', '| a  | b  |', '|----|----|', '| x | y |', '| 1  | \\^^ |', '|||', 'c', ':::'),
        },
        {
            id: '2.12 (a guard row: it passes without the fix)', source: lines('| a  | b  |', '|----|----|', '| << | x  |', '| 3  | 4  |'),
            edit: (editor) => update(editor, () => {
                const cell = ($rowHolding('x') as ElementNode).getFirstChild()!;

                cell.insertBefore($createTableCellNode(TableCellHeaderStates.NO_STATUS).append($createParagraphNode().append($createTextNode('n'))));
            }),
            saved: lines('| a  | b  |  |', '| --- | --- | --- |', '| n | \\<< | x |', '| 3  | 4  |  |'),
        },
        {
            id: '2.5', source: lines('a | b', '--|--', '1 | 2'), edit: (editor) => append(editor, '2'),
            saved: lines('a | b', '--|--', '1 | 2!'),
        },
    ]);
});

describe('3. code frames', () => {
    runRows([
        {
            id: '3.1', source: lines('~~~~ js', 'let a;', '~~~~'), edit: (editor) => append(editor, 'let a;'),
            saved: lines('~~~~ js', 'let a;!', '~~~~'),
        },
        {
            id: '3.2', source: lines('```js', 'let a;', '```'),
            edit: (editor) => update(editor, () => {
                const code = $dfs().map(({ node }) => node).find($isCodeNode)!;

                code.setLanguage('ts');
            }),
            saved: lines('```ts', 'let a;', '```'),
        },
        {
            id: '3.3', source: lines('~~~', 'a', '~~~'),
            edit: (editor) => update(editor, () => {
                const text = $textNode('a');

                text.setTextContent('a\n~~~~\nb');
            }),
            saved: lines('```', 'a', '~~~~', 'b', '```'),
        },
    ]);
});

describe('4. columns', () => {
    runRows([
        {
            id: '4.1', source: lines('::: columns', 'left *x*', '', '* p', '* q', '', '|||', '', 'right', ':::'), edit: (editor) => append(editor, 'right'),
            saved: lines('::: columns', 'left *x*', '', '* p', '* q', '', '|||', 'right!', ':::'),
        },
        {
            id: '4.2', source: lines('::: columns', '_a_', '', 'b', '|||', 'c', ':::'), edit: (editor) => append(editor, 'b'),
            saved: lines('::: columns', '_a_', '', 'b!', '|||', 'c', ':::'),
        },
        {
            id: '4.4', source: lines('::: columns', '| a   | b |', '|-----|---|', '| 1   | 2 |', '|||', 'c', ':::'), edit: (editor) => append(editor, '1'),
            saved: lines('::: columns', '| a   | b |', '|-----|---|', '| 1! | 2 |', '|||', 'c', ':::'),
        },
        {
            id: '4.5', source: lines('::: columns', '~~~~ js', 'let a;', '~~~~', '|||', 'c', ':::'), edit: (editor) => append(editor, 'let a;'),
            saved: lines('::: columns', '~~~~ js', 'let a;!', '~~~~', '|||', 'c', ':::'),
        },
    ]);

    it('4.3. a list item holding a ::: line, wrapped in a fence, is written in the standard form with the line escaped', () => {
        const editor = load(lines('- a', '', '  b', '  :::'));

        update(editor, () => {
            $getRoot().selectStart();
        });
        editor.setColumnCount(2);

        expect(editor.getValue()).toBe(lines('::: columns', '- a', '', '  b', '  \\:::', '|||', '', ':::'));
    });
});

describe('5. unchanged behaviour', () => {
    const SOURCES = [
        lines('* one', '    * inner', '* two'), lines('1.  one', '    more', '', '    - x', '2.  two'),
        lines('| a   | bb |', '|-----|----|', '| 1   | 2  |'), lines('~~~~ js', 'let a;', '~~~~'),
        lines('::: columns', '_a_', '', 'b', '|||', 'c', ':::'), lines('3. a', '4. b', '5. c'),
    ];

    it.each(SOURCES)('5.1. an unedited %j saves byte for byte', (source) => {
        expect(load(source).getValue()).toBe(source);
    });

    runRows([
        { id: '5.2', source: lines('- a', '- b'), edit: (editor) => append(editor, 'b'), saved: lines('- a', '- b!') },
        {
            id: '5.3', source: lines('* a', '* b', '', '> q'), edit: (editor) => append(editor, 'a'),
            saved: lines('* a!', '* b', '', '> q'),
        },
    ]);
});

describe('6. the save reads nothing back', () => {
    /**
     * Counts the lexes a save makes after an edit.
     *
     * @param source - The document.
     * @param text - The text node to type a letter into.
     * @returns The lexer's calls during the save, and the lines of the source the save changed.
     */
    function saveCost(source: string, text: string): { lexes: number; changed: number } {
        const editor = load(source);

        append(editor, text, 'z');
        vi.mocked(lexMarkdown).mockClear();

        const saved = editor.getValue();
        const lexes = vi.mocked(lexMarkdown).mock.calls.length;
        const before = source.split('\n');
        const after = new Set(saved.split('\n'));

        return { lexes, changed: before.filter((line) => !after.has(line)).length };
    }

    it('6.1. typing into a nested list lexes nothing and changes one line', () => {
        const source = Array.from({ length: 100 }, (_, index) => `* entry ${index}\n    * sub ${index}`).join('\n');

        expect(saveCost(source, 'entry 1')).toEqual({ lexes: 0, changed: 1 });
    });

    it('6.2. typing into a cell of a padded table lexes nothing and changes one line', () => {
        const rows = Array.from({ length: 200 }, (_, index) => `| r${String(index).padEnd(5)} | v${String(index).padEnd(5)} |`);
        const source = lines('| head   | head   |', '|--------|--------|', ...rows);

        expect(saveCost(source, 'r1')).toEqual({ lexes: 0, changed: 1 });
    });
});

/**
 * Loads a document, types a letter into the text node `text`, and runs `measure` on the save with and without the
 * source map's parts, each on an editor of its own: a first save is cached, and without parts a save never writes a
 * block part by part, as before this change.
 *
 * @param source - The document.
 * @param text - The text node to type into.
 * @param measure - Runs the save and returns what it counts.
 * @returns What `measure` counted for a save with parts, and for a save without.
 */
function countSaves(source: string, text: string, measure: (editor: MarkdownEditor) => number): { withParts: number; withoutParts: number } {
    const counts = [true, false].map((keepsParts) => {
        const editor = load(source);

        append(editor, text, 'z');

        if (!keepsParts) {
            const internals = editor as unknown as { _sourceMap: MarkdownSourceMap };

            internals._sourceMap = { ...internals._sourceMap, parts: new Map() };
        }

        return measure(editor);
    });

    return { withParts: counts[0]!, withoutParts: counts[1]! };
}

describe('6b. a save costs what a save without parts costs', () => {
    /**
     * Counts the lexer's calls of a save.
     *
     * @param editor - The edited editor.
     * @returns The calls.
     */
    function lexesOfSave(editor: MarkdownEditor): number {
        vi.mocked(lexMarkdown).mockClear();
        editor.getValue();

        return vi.mocked(lexMarkdown).mock.calls.length;
    }

    it.each([
        ['an HTML block after it', lines('* a', '    * b', '* c', '', '<div>', 'x', '</div>')],
        ['an HTML block before it', lines('<div>', 'x', '</div>', '', '* a', '    * b', '* c')],
        ['another list after it (a guard row: it passes without the fix)', lines('* a', '    * b', '* c', '', '+ d', '    + e')],
        ['a raw block next to a nested list in an item', lines('* a', '', '    <div>', '    x', '    </div>', '', '    * b', '* c')],
        [
            'a raw block next to a nested list in each of 20 items',
            Array.from({ length: 20 }, (_, index) => lines(`* ${index === 0 ? 'a' : `item ${index}`}`, '', '    <div>', '    x', '    </div>', '', '    * b')).join('\n'),
        ],
        ['an HTML block after it, in a column', lines('::: columns', '* a', '    * b', '', '<div>', 'x', '</div>', '|||', 'c', ':::')],
        ['another list after it, in a column', lines('::: columns', '* a', '    * b', '', '+ d', '    + e', '|||', 'c', ':::')],
        ['an HTML block between two lists', lines('* a', '    * b', '', '<div>', 'x', '</div>', '', '+ c', '    + d')],
    ])('6.3. typing into a nested list with %s lexes as often as a save without parts', (_title, source) => {
        const { withParts, withoutParts } = countSaves(source, 'a', lexesOfSave);

        expect(withoutParts).toBeGreaterThan(0);
        expect(withParts).toBe(withoutParts);
    });

    it('6.5. typing into a cell of a table of 200 rows computes the cell texts of the standard form once, as a save without parts does', () => {
        const rows = Array.from({ length: 200 }, (_, index) => `| r${String(index).padEnd(5)} | v${String(index).padEnd(5)} |`);
        const source = lines('| head   | head   |', '|--------|--------|', ...rows);

        /**
         * Counts the cell reads of a save.
         *
         * @param editor - The edited editor.
         * @returns The calls of `TableCellNode.getChildren`.
         */
        const readsOfSave = (editor: MarkdownEditor): number => {
            const spy = vi.spyOn(TableCellNode.prototype, 'getChildren');

            editor.getValue();

            const reads = spy.mock.calls.length;

            spy.mockRestore();

            return reads;
        };

        const { withParts, withoutParts } = countSaves(source, 'r1', readsOfSave);

        expect(withoutParts).toBeGreaterThan(400);
        expect(withParts).toBe(withoutParts);
    });

    it('6.4. typing into the deepest item of a chain of 100 nested items does the work of a save without parts, not a multiple of the depth', () => {
        const source = Array.from({ length: 100 }, (_, depth) => `${' '.repeat(depth * 4)}- item ${depth}`).join('\n');

        /**
         * Counts the item reads of a save.
         *
         * @param editor - The edited editor.
         * @returns The calls of `ListItemNode.getChildren`.
         */
        const readsOfSave = (editor: MarkdownEditor): number => {
            const spy = vi.spyOn(ListItemNode.prototype, 'getChildren');

            editor.getValue();

            const reads = spy.mock.calls.length;

            spy.mockRestore();

            return reads;
        };

        const { withParts, withoutParts } = countSaves(source, 'item 99', readsOfSave);

        // Measured, a save with parts reads 1.5 times what a save without parts does; a rewrite of the subtree at every
        // level reads a multiple of the depth, 100 times here. The bound is generous for the one and far from the other.
        expect(withParts).toBeLessThan(withoutParts * 4);
    });
});

describe('7. undo', () => {
    it('7.1. guard: undoing an edit inside a nested list gives the source (it passes without parts, too)', () => {
        const source = lines('* one', '    * inner', '* two');
        const editor = load(source);

        append(editor, 'inner');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(source);
    });

    it("7.2. an earlier import's parts are still found after another import is undone", () => {
        const editor = load(lines('* one', '    * inner', '    * more', '* two'));

        editor.setValue('x');
        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);
        append(editor, 'inner');

        expect(editor.getValue()).toBe(lines('* one', '    * inner!', '    * more', '* two'));
    });
});

describe('8. quote blocks', () => {
    runRows([
        {
            id: '8.1', source: lines('>first  _x_', '>', '>   second', '> ', '>third'), edit: (editor) => append(editor, 'second'),
            saved: lines('>first  _x_', '>', '> second!', '>', '>third'),
        },
        {
            id: '8.2', source: lines('> a', '>', '> * one', '>     * inner', '>', '>  > nested *q*') + '\n', edit: (editor) => append(editor, 'a'),
            saved: lines('> a!', '>', '> * one', '>     * inner', '>', '>  > nested *q*') + '\n',
        },
        {
            id: '8.3', source: lines('- a', '', '  >b _c_', '  >', '  >d', '- e'), edit: (editor) => append(editor, 'e'),
            saved: lines('- a', '', '  >b _c_', '  >', '  >d', '', '- e!'),
        },
        {
            id: '8.4', source: lines('> x _y_', '>', '> > p', '> >', '> > q'), edit: (editor) => append(editor, 'q'),
            saved: lines('> x _y_', '>', '> > p', '> >', '> > q!'),
        },
        {
            id: '8.5', source: lines('>  * a', '>  * b', '>', '> para'), edit: (editor) => pressEnterAt(editor, 'para', 2),
            saved: lines('>  * a', '>  * b', '>', '> pa', '>', '> ra'),
        },
        {
            id: '8.6', source: lines('> _a_', '>', '> b', '>', '> *c*'), edit: (editor) => typeOver(editor, 'b', 'X'),
            saved: lines('> _a_', '>', '> X', '>', '> *c*'),
        },
        {
            id: '8.7', source: lines('> a', '>', '>```', '>  '), edit: (editor) => append(editor, 'a', 'x'),
            saved: lines('> ax', '>', '>```', '>  '),
        },
        {
            id: '8.8', source: lines('>\ta', '>', '>\tb'), edit: (editor) => append(editor, 'b'),
            saved: lines('> a', '>', '> b!'),
        },
        { id: '8.9', source: lines('>a', '>', '>b'), edit: () => undefined, saved: lines('>a', '>', '>b') },
    ]);
});
