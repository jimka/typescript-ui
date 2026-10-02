// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { NodeKey } from "lexical";
import type { Links } from "marked";

/**
 * What one import knew about the loaded document as a whole, shared by every
 * block it loaded.
 */
export interface MarkdownSourceLoad {
    /** The source before the first block (blank lines), or the whole source when it holds no block. */
    readonly prefix:          string;
    /** Whether the source ended with a newline. */
    readonly endsWithNewline: boolean;
    /** The number of top-level blocks the source held. */
    readonly blockCount:      number;
    /**
     * Whether the source's last block runs to the end of the document (an
     * unclosed code fence), so a block written after it would join it.
     */
    readonly endsOpen:        boolean;
    /**
     * The document's link reference definitions at load, as the viewer
     * resolves them: a block's source is written as loaded only while it
     * reads the same under the definitions the document holds now.
     */
    readonly definitions:     Links;
    /** `definitions` in a form two reads can compare. */
    readonly definitionsKey:  string;
}

/**
 * One top-level block of a loaded document: where it stood, its source, and
 * the serializer's standard output for it at load. A save writes `body` in
 * place of the standard output while the two outputs are still equal.
 */
export interface MarkdownSourceBlock {
    /** The import that loaded the block. */
    readonly load:        MarkdownSourceLoad;
    /** The block's position among the document's top-level blocks at load. */
    readonly index:       number;
    /** The block's source, without the whitespace after it. */
    readonly body:        string;
    /** The source between this block and the next one, or the end of the document. */
    readonly after:       string;
    /** The block's standard output at load. */
    readonly fingerprint: string;
}

/**
 * What a save needs to write a loaded document's unedited blocks as they were
 * written: each top-level block's source, keyed by its node, and the text
 * around the blocks. An editor's map holds the blocks of every import it has
 * made, since undo can bring an earlier import's nodes back.
 */
export interface MarkdownSourceMap {
    /** The last import, which a document holding none of the loaded blocks is written after. */
    readonly latest: MarkdownSourceLoad;
    /**
     * The loaded blocks, keyed by the node each was loaded as. A blank
     * document's empty paragraph is recorded too, with an empty `body`, so a
     * save can tell the document is still that blank one.
     */
    readonly blocks: ReadonlyMap<NodeKey, MarkdownSourceBlock>;
}

/** The import of an empty document. */
const EMPTY_SOURCE_LOAD: MarkdownSourceLoad = {
    prefix: "", endsWithNewline: false, blockCount: 0, endsOpen: false, definitions: {}, definitionsKey: "{}",
};

/** The map of a document with no source to preserve: every block saves in the standard form. */
export const EMPTY_SOURCE_MAP: MarkdownSourceMap = { latest: EMPTY_SOURCE_LOAD, blocks: new Map() };
