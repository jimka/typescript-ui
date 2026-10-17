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
    /**
     * Whether a nested part of the block has a source other than its standard
     * form at load: only then does an edit of the block write it part by part.
     */
    readonly partsDiffer: boolean;
}

/** A list item of a loaded document, as its list held it. */
export interface MarkdownSourceItem {
    readonly kind:            "item";
    /** The import that loaded it. */
    readonly load:            MarkdownSourceLoad;
    /** The `:::` column it stood in at load; `null` for none. */
    readonly column:          NodeKey | null;
    /** Its lines without the whitespace after them, the spaces before its marker kept. */
    readonly source:          string;
    /** The spaces before its marker on its first line, 0 to 3. */
    readonly indent:          number;
    /** Its bullet (`-`, `*`, `+`) or ordered delimiter (`.`, `)`). */
    readonly marker:          string;
    /** Its number as written, digits and leading zeros included, for an ordered item; else `null`. */
    readonly digits:          string | null;
    /** The spaces between its marker and its text on its first line. */
    readonly spacing:         string;
    /** Whether a blank line stands between two of its own blocks. */
    readonly separatesBlocks: boolean;
    /** Its standard lines at load under its list's fingerprint marker. */
    readonly fingerprint:     string;
}

/** A header or body row of a loaded table. */
export interface MarkdownSourceRow {
    readonly kind:             "row";
    readonly load:             MarkdownSourceLoad;
    readonly column:           NodeKey | null;
    /** The row's line. */
    readonly line:             string;
    /** Each cell's text between its pipes, as written, spaces kept. */
    readonly cells:            readonly string[];
    /** Whether the line has a pipe at each end. */
    readonly outerPipes:       boolean;
    /** The row's standard line at load. */
    readonly fingerprint:      string;
    /** Each column's standard cell text at load. */
    readonly cellFingerprints: readonly string[];
}

/** A loaded table's delimiter row, keyed by the table. */
export interface MarkdownSourceDelimiterRow {
    readonly kind:        "delimiterRow";
    /** The delimiter row's line. */
    readonly line:        string;
    /** The standard delimiter row at load. */
    readonly fingerprint: string;
}

/** A loaded fenced code block's fence lines. */
export interface MarkdownSourceCodeFrame {
    readonly kind:           "codeFrame";
    /** The opening fence line. */
    readonly opening:        string;
    /** The closing fence line. */
    readonly closing:        string;
    readonly fenceCharacter: "`" | "~";
    readonly fenceLength:    number;
    /** The info string the standard form wrote at load. */
    readonly fingerprint:    string;
}

/** A block of a loaded `:::` column. */
export interface MarkdownSourceColumnBlock {
    readonly kind:   "columnBlock";
    /** The column it stood in. */
    readonly column: NodeKey;
    /** Its source, as a top-level block's; its `load` is its column's. */
    readonly block:  MarkdownSourceBlock;
}

/**
 * The key a block of a column is stored under in {@link MarkdownSourceMap.parts}.
 * A table or a code block standing directly in a column is a column block and
 * also holds a part of its own (its delimiter row, its fence lines), which is
 * keyed by the node itself.
 *
 * @param node - The key of the block's node.
 * @returns The key of its column-block part.
 */
export function columnBlockKey(node: NodeKey): NodeKey {
    return `column-block:${node}`;
}

/** A nested part of a loaded document. */
export type MarkdownSourcePart =
    | MarkdownSourceItem | MarkdownSourceRow | MarkdownSourceDelimiterRow | MarkdownSourceCodeFrame | MarkdownSourceColumnBlock;

/**
 * What a save needs to write a loaded document's unedited blocks as they were
 * written: each top-level block's source, keyed by its node, the source of
 * the nested parts of the blocks, and the text around the blocks. An editor's map holds the blocks of every import it has
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
    /**
     * The nested parts of the loaded blocks, keyed by the node each was
     * loaded as: a list item, a table row, a table (its delimiter row), a
     * code block (its fence lines); a block of a column is keyed by
     * {@link columnBlockKey} of its node, since the same node can hold a
     * part of its own.
     */
    readonly parts:  ReadonlyMap<NodeKey, MarkdownSourcePart>;
}

/** The import of an empty document. */
const EMPTY_SOURCE_LOAD: MarkdownSourceLoad = {
    prefix: "", endsWithNewline: false, blockCount: 0, endsOpen: false, definitions: {}, definitionsKey: "{}",
};

/** The map of a document with no source to preserve: every block saves in the standard form. */
export const EMPTY_SOURCE_MAP: MarkdownSourceMap = { latest: EMPTY_SOURCE_LOAD, blocks: new Map(), parts: new Map() };
