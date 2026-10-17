import { $createParagraphNode, $createRangeSelection, $getRoot, $isElementNode, $isTextNode, $setSelection } from 'lexical';
import type { LexicalNode } from 'lexical';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { lexicalEditorOf } from './sourceCaret';

// Where a source offset stands in the document, by what the document shows there and not by the source map: a mark is put
// into the Markdown at the offset, the marked Markdown is loaded, and the mark is found in the loaded document by the path of
// child indexes that leads to it. The same path leads to the same place in the document without the mark. Nothing here
// calls the code that places a source selection.

/** A private-use code point, which reads as a letter of the text it stands in. */
const MARK = '';

/** A place named by structure: the child-index path from the root, and the offset in the node it leads to. */
export interface ShownPlace {
    readonly path:   number[];
    readonly offset: number;
    readonly type:   'text' | 'element';
}

/** What the mark showed: a place in the document, a block the mark made on its own, or nothing usable. */
export interface ShownPlacement {
    /** `text` (a place in a text node), `empty` (an element that shows nothing), `newblock` (the mark made a root block of its own) or `none`. */
    readonly kind:   'text' | 'empty' | 'newblock' | 'none';
    /** Where a block the mark made stands: before the first block, between blocks or after the last. */
    readonly where?: 'before-first' | 'between' | 'after-last';
    readonly place?: ShownPlace;
    /** Whether, on the way down from the root block to an element that shows nothing, a block holds more than one child (three empty items). */
    readonly crowded?: boolean;
    /** Whether the root block the place is in shows nothing at all (no text and no line break anywhere in it). */
    readonly blockShowsNothing?: boolean;
}

/**
 * The child-index path from the root to a node.
 *
 * @param node - The node.
 * @returns The path.
 */
function pathOf(node: LexicalNode): number[] {
    const path: number[] = [];
    let at: LexicalNode | null = node;

    while (at !== null && at.getParent() !== null) {
        path.unshift(at.getIndexWithinParent());
        at = at.getParent();
    }

    return path;
}

/**
 * The node a path leads to.
 *
 * @param path - The child-index path from the root.
 * @returns The node, or `null` when the path leads nowhere.
 */
export function nodeAtPath(path: number[]): LexicalNode | null {
    let at: LexicalNode | null = $getRoot();

    for (const index of path) {
        at = $isElementNode(at) ? at.getChildAtIndex(index) : null;

        if (at === null) {
            return null;
        }
    }

    return at;
}

/**
 * Loads a document in an editor of its own and reads it.
 *
 * @param doc - The Markdown.
 * @param read - What to read inside the editor.
 * @returns What it read.
 */
function loadAndRead<T>(doc: string, read: () => T): T {
    const editor = new MarkdownEditor(doc);

    editor.getValue();

    const result = lexicalEditorOf(editor).read(read);

    editor.dispose();

    return result;
}

/**
 * Finds a place by the shown text: the offset is marked, and the marked document says where the mark shows. A `#` heading
 * with nothing after it reads the mark as text, so a space and the mark are tried as well.
 *
 * @param doc - The Markdown.
 * @param offset - The offset in it.
 * @returns What the mark showed.
 */
export function shownPlacement(doc: string, offset: number): ShownPlacement {
    if (doc.includes(MARK)) {
        return { kind: 'none' };
    }

    const plainCount = loadAndRead(doc, () => $getRoot().getChildrenSize());

    for (const insert of [MARK, ' ' + MARK]) {
        const marked = doc.slice(0, offset) + insert + doc.slice(offset);
        const read = loadAndRead(marked, () => {
            const text = $getRoot().getAllTextNodes().find((node) => node.getTextContent().includes(MARK));

            return {
                found: text === undefined ? null : { path: pathOf(text), content: text.getTextContent() },
                count: $getRoot().getChildrenSize(),
                blockType: text === undefined ? null : text.getTopLevelElement()?.getType() ?? null,
            };
        });

        if (read.found === null) {
            continue;
        }

        const { path, content } = read.found;
        const without = content.replace(MARK, '');

        if (read.count === plainCount + 1) {
            // The mark made a paragraph of its own (a mark under a line of text can make a heading instead: `-` under it).
            if (content.trim() === MARK && read.blockType === 'paragraph') {
                const index = path[0]!;

                // Below the last block only when nothing but blank text follows the mark: a mark at a line's start ends the list or quote
                // around it, and the text after it is the rest of that block.
                const isBelowAll = index === plainCount && doc.slice(offset).trim() === '';

                return { kind: 'newblock', where: index === 0 ? 'before-first' : isBelowAll ? 'after-last' : 'between' };
            }

            continue;
        }

        if (read.count !== plainCount) {
            continue;
        }

        const place = loadAndRead(doc, (): ShownPlacement | null => {
            const node = nodeAtPath(path);

            if (node !== null && $isTextNode(node) && node.getTextContent() === without) {
                return { kind: 'text', place: { path, offset: content.indexOf(MARK), type: 'text' } };
            }

            const parentPath = path.slice(0, -1);
            const parent = nodeAtPath(parentPath);
            const showsNothing = without.trim() === '' && $isElementNode(parent) && parent.getChildrenSize() === 0;

            const crowded = parentPath.some((_, depth) => {
                const ancestor = nodeAtPath(parentPath.slice(0, depth + 1));

                return $isElementNode(ancestor) && ancestor.getChildrenSize() > 1;
            });

            const top = nodeAtPath(path.slice(0, 1));
            const blockShowsNothing = $isElementNode(top) && $dfs(top).every((entry) => $isElementNode(entry.node));

            return showsNothing ? { kind: 'empty', place: { path: parentPath, offset: 0, type: 'element' }, crowded, blockShowsNothing } : null;
        });

        if (place !== null) {
            return place;
        }
    }

    return { kind: 'none' };
}

/**
 * Selects a range between two places in the current Lexical update; for a new last paragraph, adds it and selects it.
 *
 * @param start - The place of the range's start, or `null` for a new last paragraph.
 * @param end - The place of its end.
 * @returns Whether the selection was made.
 */
export function $selectShownPlaces(start: ShownPlace | null, end: ShownPlace | null): boolean {
    if (start === null || end === null) {
        const paragraph = $createParagraphNode();

        $getRoot().append(paragraph);
        paragraph.select(0, 0);

        return true;
    }

    const first = nodeAtPath(start.path);
    const last = nodeAtPath(end.path);

    if (first === null || last === null) {
        return false;
    }

    const selection = $createRangeSelection();

    selection.anchor.set(first.getKey(), start.offset, start.type);
    selection.focus.set(last.getKey(), end.offset, end.type);
    $setSelection(selection);

    return true;
}
