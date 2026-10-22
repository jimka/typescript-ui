import { $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode } from 'lexical';
import type { LexicalEditor, LexicalNode, TextNode } from 'lexical';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import type { MarkdownSourceMap } from '~/component/editor/markdownSourceMap';
import { $selectSourceRange } from '~/component/editor/markdownSourceModel';

// Where a caret stands, as a count of the characters the root's text holds before it: the one measure a WYSIWYG caret and a
// source caret share, since a source offset and a Lexical point name the same place in different terms.

/** A source selection, as offsets into the Markdown. */
export interface SourceCaret {
    readonly from: number;
    readonly to:   number;
}

/**
 * The count of characters of the root's text before a point.
 *
 * @param point - The point.
 * @returns The count, or -1 when the point stands in a block with no text before or after it.
 */
function $characterIndex(point: { getNode(): LexicalNode; offset: number; type: 'text' | 'element' }): number {
    const node = point.getNode();
    let target: TextNode | null = null;
    let offset = point.offset;

    if (point.type === 'text' && $isTextNode(node)) {
        target = node;
    } else if ($isElementNode(node)) {
        const child = node.getChildAtIndex(point.offset);
        const first = child === null ? null : ($isTextNode(child) ? child : ($isElementNode(child) ? child.getFirstDescendant() : null));
        const last = node.getLastDescendant();

        if ($isTextNode(first)) {
            target = first;
            offset = 0;
        } else if ($isTextNode(last)) {
            target = last;
            offset = last.getTextContentSize();
        }
    }

    if (target === null) {
        return -1;
    }

    let count = 0;

    for (const text of $getRoot().getAllTextNodes()) {
        if (text.is(target)) {
            return count + offset;
        }

        count += text.getTextContentSize();
    }

    return -1;
}

/**
 * The two ends of the current selection as counts of the root's text before them, ordered.
 *
 * @returns The counts, or `null` when the selection is not a range.
 */
export function $selectionCharacters(): [number, number] | null {
    const selection = $getSelection();

    if (!$isRangeSelection(selection)) {
        return null;
    }

    const ends = [$characterIndex(selection.anchor), $characterIndex(selection.focus)];

    return [Math.min(...ends), Math.max(...ends)];
}

/**
 * Reaches the private headless Lexical editor, built.
 *
 * @param editor - The editor.
 * @returns Its Lexical editor.
 */
export function lexicalEditorOf(editor: MarkdownEditor): LexicalEditor {
    (editor as unknown as { ensureEditor(): LexicalEditor }).ensureEditor();

    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Reaches the private source map of an editor's imports.
 *
 * @param editor - The editor.
 * @returns The map.
 */
export function sourceMapOfEditor(editor: MarkdownEditor): MarkdownSourceMap {
    return (editor as unknown as { _sourceMap: MarkdownSourceMap })._sourceMap;
}

/**
 * Where a source caret stands in a document, read through a WYSIWYG editor of it.
 *
 * @param doc - The document.
 * @param caret - The caret.
 * @returns The counts of the root's text before each end, or `null` when the caret has no place in the document.
 */
export function charactersOfSourceCaret(doc: string, caret: SourceCaret): [number, number] | null {
    const editor = new MarkdownEditor(doc);
    const lexical = lexicalEditorOf(editor);
    const map = sourceMapOfEditor(editor);
    let characters: [number, number] | null = null;

    lexical.update(() => {
        const placed = $selectSourceRange(doc, map, caret.from, caret.to);

        characters = placed ? $selectionCharacters() : null;
    }, { discrete: true });
    editor.dispose();

    return characters;
}
