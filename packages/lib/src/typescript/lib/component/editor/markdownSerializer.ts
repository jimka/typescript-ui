// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $findMatchingParent, $getRoot, $getState, $isElementNode, $isLineBreakNode, $isParagraphNode, $isTextNode, TEXT_TYPE_TO_FORMAT,
} from "lexical";
import type { ElementFormatType, ElementNode, LexicalNode, TextFormatType, TextNode } from "lexical";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import type { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $isListItemNode, $isListNode } from "@lexical/list";
import type { ListItemNode, ListNode } from "@lexical/list";
import { $isLinkNode } from "@lexical/link";
import type { LinkNode } from "@lexical/link";
import { $isCodeNode } from "@lexical/code";
import type { CodeNode } from "@lexical/code";
import { $isTableCellNode, $isTableNode, $isTableRowNode } from "@lexical/table";
import type { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { $dfs } from "@lexical/utils";
import type { Links, Token, Tokens } from "marked";
import {
    blockStyleToAttributes, cssTextToAttributes, formatAttributes, joinColumnSections, parseAttributes, resolveBlockStyle, resolveImageSpec,
    resolveSpanStyle, spanStyleToAttributes,
} from "~/component/display/markdownAttributes.js";
import {
    lexMarkdown, lexMarkdownInline, lexMarkdownLinkDefinitions, lexMarkdownWithDefinitions,
} from "~/component/display/markdownExtensions.js";
import type { MdTableToken } from "~/component/display/markdownTableExtension.js";
import { $isMarkdownBlockNode, $isMarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import type { MarkdownBlockNode } from "~/component/editor/markdownBlockNode.js";
import { $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import type { MarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import {
    bareAutolinkState, codeInfoState, fenceAttributesState, hardBreakMarkerState, imageAttributesState, KEPT_SOURCE_WRITES_LINK,
    KEPT_SOURCE_WRITES_STYLE, keptSourceState, listLooseState, listMarkerState, NESTED_LINK_WRITES_STYLE, nestedLinkGroupState,
    nestedLinkState, spanAttributesState,
} from "~/component/editor/markdownNodeState.js";
import type { KeptSource } from "~/component/editor/markdownNodeState.js";
import { $isReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import type { ReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import { $isMarkdownRawBlockNode, $isMarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import type { MarkdownRawBlockNode, MarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import { EMPTY_SOURCE_MAP } from "~/component/editor/markdownSourceMap.js";
import type { MarkdownSourceBlock, MarkdownSourceLoad, MarkdownSourceMap } from "~/component/editor/markdownSourceMap.js";

// ---------------------------------------------------------------- constants

/** A thematic break: three or more of one of `-`, `*` and `_`, spaces between them allowed (CommonMark §4.1). */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * A source run's text that is a shortcut reference: `[label]` or
 * `![label]`, the label holding no unescaped bracket.
 */
const SHORTCUT_REFERENCE_SOURCE = /^!?\[(?:\\.|[^[\]\\])+\]$/;

/** Separates two top-level blocks (and two blocks of a fence column): one blank line. */
const BLOCK_SEPARATOR = "\n\n";

/**
 * The paragraph lexed after a block's Markdown to tell whether that block
 * runs on: any plain word, which no block that has ended takes in.
 */
const RUN_ON_PROBE = "probe";

/**
 * How many raw-block texts {@link rawBlockEnd} remembers: the editor asks again
 * for each raw block whenever a block before or after it changes, and a
 * document rarely holds more raw blocks than this; past it the memory starts
 * over rather than growing with every text an edit passes through.
 */
const RUNS_ON_CACHE_SIZE = 256;

/**
 * How a raw block's text ends ({@link rawBlockEnd}): `"apart"` when a blank
 * line after it ends it; `"wide"` when only a second blank line does — an
 * HTML block whose start tag ends its line (`<details`), whose newline
 * `marked` spends on the start condition, so the first blank line after it
 * is not one the end condition sees; `"runsOn"` when no blank line ends it
 * (`<!--` without `-->`, `<pre>` without `</pre>`).
 */
type RawBlockEnd = "apart" | "wide" | "runsOn";

/** {@link rawBlockEnd}'s answers, by raw-block text. */
const RUNS_ON = new Map<string, RawBlockEnd>();

/** A paragraph line put before a continuation line to lex it where it stands: in a paragraph. */
const PARAGRAPH_PROBE_LINE = "probe";

/** A block whose first line is indented: a list item before it may take it as its own content. */
const INDENTED_LINE = /^[ \t]/;

/**
 * Source that ends inside a link reference definition's label a line of it
 * opens (`[fo`): `marked` reads a label across blank lines, so text written
 * after the block that closes it (`o]: /url`) can make the two one
 * definition.
 */
const OPEN_LABEL = /(?:^|\n) {0,3}\[(?:\\[\s\S]|[^[\]\\])*$/;

/**
 * Source that ends inside the title of a link reference definition a line
 * of it opens (`[x]: /u "ti`): `marked` reads a title across blank lines, so
 * text written after the block that closes it (`tle"`) can make the two one
 * definition.
 */
const OPEN_TITLE = /(?:^|\n) {0,3}\[(?:\\[\s\S]|[^[\]\\])+\]:[ \t]*\n?[ \t]*(?:<[^<>\n]*>|[^\s<]\S*)[ \t]*\n?[ \t]*(?:"[^"]*|'[^']*|\([^()]*)$/;

/**
 * The character every use of a link reference definition opens with (a
 * reference link or image, or a definition's own label): text without it
 * reads the same under any definitions.
 */
const LABEL_OPEN = "[";

/**
 * Whether a loaded block's source read the same under its load's definitions
 * as under a later set, keyed by that set (`definitionsKey`), so a document
 * whose definitions were edited lexes each block once per new set, not once
 * per save.
 */
const READS_ALIKE = new WeakMap<MarkdownSourceBlock, { readonly definitionsKey: string; readonly alike: boolean }>();

/** The deepest heading level a setext underline can write (CommonMark: `=` is 1, `-` is 2). */
const SETEXT_MAX_LEVEL = 2;

/** The underline of a level 1 setext heading; any run of `=` reads the same, three matches `---`'s length. */
const SETEXT_H1_UNDERLINE = "===";

/** The underline of a level 2 setext heading: three `-`, the shortest run that is not a list item's marker. */
const SETEXT_H2_UNDERLINE = "---";

/**
 * A line `marked`'s setext-heading rule will not read as heading content: a
 * code-fence start (three or more backticks or tildes, as a code span with
 * a fence that long opens), a lone tag (an angle-bracket autolink, an
 * inline-HTML source run), which it takes for an HTML block start, or a line
 * indented four spaces or more (the indent kept before a source run), which
 * it takes for indented code.
 */
const SETEXT_INTERRUPTING_LINE = /^(?: {4,}| {0,3}(?:`{3,}|~{3,}|<[^\n>]+>$))/;

/** Separates two items of a loose list: one blank line, as between blocks. */
const LOOSE_ITEM_SEPARATOR = "\n\n";

/** The bullet characters a bullet list may be written with; the first is the default. */
const BULLET_MARKERS: readonly string[] = ["-", "*", "+"];

/** The delimiters an ordered list's numbers may be written with; the first is the default. */
const ORDERED_DELIMITERS: readonly string[] = [".", ")"];

/**
 * The block written between two lists `marked` would otherwise join: a link
 * reference definition, which ends a list as any block does and which the
 * viewer renders nothing for. CommonMark's own separator, an empty HTML
 * comment, would show: the viewer prints an HTML block as its text. The
 * label `//` is the usual one for a Markdown comment; an earlier definition
 * of it wins, and a later one is dropped, so it never redefines one.
 */
const LIST_SEPARATOR = "[//]: #";

/**
 * The two characters backslash and `n`, half of a table cell's break: a raw
 * newline would end the pipe row.
 */
const CELL_LINE_BREAK = "\\n";

/**
 * Two {@link CELL_LINE_BREAK}s: what a table cell writes between two of its
 * paragraphs and for a line break or a newline inside it. Mirrors the
 * viewer's own `CELL_PARAGRAPH_BREAK`, the only sequence it splits a cell's
 * text on (one `<br>` per boundary) — a lone {@link CELL_LINE_BREAK} renders
 * as literal text — and the importer reads it back as a paragraph boundary.
 */
const CELL_PARAGRAPH_BREAK = CELL_LINE_BREAK + CELL_LINE_BREAK;

/**
 * The bullet a bullet list is written with when its first line is a bare
 * marker right under a line of text, where a bare `-` would be a setext
 * underline.
 */
const UNDER_TEXT_BULLET = "*";

/** The whole-cell texts the table import reads as merge continuations, so a cell holding one is escaped. */
const MERGE_MARKERS: ReadonlySet<string> = new Set(["<<", "^^"]);

/**
 * The shortest code fence CommonMark accepts (three backticks or tildes). A
 * fixed grammar constant, not a tuning value: a fence only grows past it when
 * the code itself holds a line starting with that many of its character.
 */
const MIN_CODE_FENCE_LENGTH = 3;

/**
 * A code line's leading backtick and tilde runs, after the up-to-three spaces
 * of indentation CommonMark still reads as a closing fence.
 */
const CODE_LINE_FENCE_RUN = /^ {0,3}(`+|~+)/;

/**
 * A URL CommonMark accepts inside an angle-bracket autolink: a scheme of two
 * to thirty-two characters (the spec's own bounds), a colon, and no space,
 * `<` or `>`.
 */
const AUTOLINK_URL = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;

/**
 * An email address CommonMark accepts inside an angle-bracket autolink — the
 * spec's own definition, whose `{0,61}` caps each domain label at the DNS
 * limit of 63 characters.
 */
const AUTOLINK_EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The characters that open an inline construct wherever they stand, so text always escapes them. */
const ALWAYS_ESCAPED: ReadonlySet<string> = new Set(["`", "*", "~", "[", "]"]);

/** The characters that start a block (heading, quote, list, setext underline, table, fence) at a line start. */
const LINE_START_ESCAPED: ReadonlySet<string> = new Set(["#", ">", "-", "+", "*", "=", "|", ":", "~", "`"]);

/**
 * An ordered-list marker at a line start: one to nine digits (CommonMark's
 * limit for a list number) then `.` or `)`.
 */
const ORDERED_LIST_MARKER = /^(\d{1,9})[.)]/;

/** A list item's line holding only its marker: an empty item. */
const BARE_LIST_MARKER_LINE = /^ *(?:\d{1,9}[.)]|[-*+]) *$/;

/** A list's first marker, as its Markdown starts: an ordered item's delimiter (group 1), or a bullet (group 2). */
const WRITTEN_LIST_MARKER = /^ *(?:\d{1,9}([.)])|([-*+]))/;

/** ASCII punctuation: the characters a backslash escapes in CommonMark. */
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/** A letter or digit in any script — the characters an intraword `_` sits between. */
const WORD_CHARACTER = /^[\p{L}\p{N}]$/u;

/** The text before a `:` that makes it the colon of a GFM bare-URL autolink scheme. */
const BARE_URL_SCHEME = /(?:https?|ftp)$/i;

/** The scheme a GFM bare-URL autolink starts with. */
const BARE_URL_SCHEME_PREFIX = /^(?:https?|ftp):\/\//i;

/**
 * The text of a link written as a bare autolink: no character that ends a
 * bare URL (whitespace, `<`), that `marked` reads as other syntax around it,
 * or that a table cell escapes, and a last character `marked` does not trim.
 */
const BARE_AUTOLINK_TEXT = /^[^\s<>[\]\\`|]*[A-Za-z0-9/]$/;

/** The text before a `.` that makes it the dot of a GFM `www.` autolink. */
const BARE_WWW_PREFIX = /www$/i;

/** A character of the local part of a GFM bare email autolink. */
const EMAIL_LOCAL_CHARACTER = /^[A-Za-z0-9._+-]$/;

/** A character of the domain of a GFM bare email autolink. */
const EMAIL_DOMAIN_CHARACTER = /^[A-Za-z0-9_-]$/;

/** The highest C0 control character code; a link destination holding one must be written in angle brackets. */
const LAST_C0_CONTROL = 0x1f;

/** The DEL control character's code, the one control character above the C0 range. */
const DELETE_CHARACTER = 0x7f;

/**
 * How many times one block's inline Markdown is read back with the viewer's
 * lexer while looking for a writing that reads as the editor shows it. Each
 * read-back lexes the block once; the cap bounds the cost of a block no
 * writing keeps, which is then written the first way. It covers every
 * writing policy with a round of delimiter switches each on a block of a few
 * dozen marks; the serializer fuzz found no repairable block needing more.
 */
const MAX_READ_BACKS = 64;

/** Separates the parts of one reading unit's key: no Markdown text holds it. */
const READING_KEY_SEPARATOR = "\u0000";

/** The reading unit of a line break. */
const BREAK_READING = "\u0001break";

/** The marks whitespace shows, read with {@link InlineContext.readsWhitespace}: a line or a background drawn across it. */
const DRAWN_ON_WHITESPACE: ReadonlySet<string> = new Set(["strike", "underline", "code"]);

/**
 * The characters that, written right after a shortcut reference `[label]`,
 * would make it part of another construct: an inline link's destination, a
 * styled span's attributes, or a full reference's second bracket.
 */
const AFTER_SHORTCUT_GUARDED = "([{";

/** A shortcut reference that, opening a list item's text before whitespace, is a task item's checkbox instead. */
const TASK_CHECKBOX_SHORTCUT = /^\[[ xX]\]$/;

/** A task item's checkbox as the importer keeps it, a source run: its marker and the space after it. */
const TASK_MARKER_SOURCE = /^\[[ xX]\] $/;

/** A blank line in a link title: a line break, then whitespace alone up to the next one. */
const BLANK_LINE_IN_TITLE = /\n[ \t]*\n/;

// ---------------------------------------------------------------- types

/** Where inline content is being written. */
interface InlineContext {
    /** The content cannot span lines (headings, table cells). */
    readonly singleLine: boolean;
    /** Escape every `|`; a `\` before `n` is escaped; a `LineBreakNode` writes the cell paragraph break. */
    readonly inTableCell: boolean;
    /**
     * Leave a `~` unescaped unless another `~` touches it. An escaped `\~` is
     * punctuation to `marked`, where a lone `~` reads as a letter next to `*`;
     * set only for a writing that is then read back, since two lone tildes
     * can pair as strikethrough.
     */
    readonly looseTildes?: boolean;
    /** The content is a list item's: a continuation line opening an HTML block there ends the item. */
    readonly inListItem?: boolean;
    /**
     * Escape every `<`. `marked` hides a `<…>` stretch from emphasis pairing,
     * so a `<` that opens no tag still keeps delimiters between it and a
     * later `>` from pairing; set only for a writing that is then read back.
     */
    readonly escapedAngles?: boolean;
    /**
     * Read whitespace too: each stretch of it one unit, keyed by its link and
     * the marks that draw on it (strikethrough, underline, code), none at a
     * line's edge — as the viewer lays it out, so a writing that moves a
     * struck space out of its strikethrough reads differently. Set for every
     * read-back; never for a writing.
     */
    readonly readsWhitespace?: boolean;
    /**
     * The saved document's link reference definitions, as the viewer resolves
     * them; `null` when the document holds no reference link to resolve.
     */
    readonly definitions: Links | null;
}

/** The context of a paragraph, quote or list item. */
const MULTI_LINE: InlineContext = { singleLine: false, inTableCell: false, definitions: null };

/** The context of a heading. */
const HEADING_LINE: InlineContext = { singleLine: true, inTableCell: false, definitions: null };

/** The context of a table cell's paragraph. */
const TABLE_CELL: InlineContext = { singleLine: true, inTableCell: true, definitions: null };

/** An emphasis-like mark, written as a delimiter pair. `code` is handled separately, as a code span. */
type Mark = "bold" | "italic" | "strike" | "underline";

/** The fixed order marks are opened in, outermost first. */
const MARK_ORDER: readonly Mark[] = ["bold", "italic", "strike", "underline"];

/** The marks the editor does not draw on whitespace (underline and strikethrough draw a line across it). */
const UNDRAWN_ON_WHITESPACE: readonly Mark[] = ["bold", "italic"];

/** Each mark's delimiter. */
const MARK_DELIMITERS: Readonly<Record<Mark, string>> = { bold: "**", italic: "*", strike: "~~", underline: "++" };

/** The `_` delimiter a bold or italic pair switches to when `marked` would mis-pair its `*` one. */
const UNDERSCORE_DELIMITERS: Readonly<Partial<Record<Mark, string>>> = { bold: "__", italic: "_" };

/** A Unicode punctuation or symbol character: what `marked`'s flanking rules count as punctuation. */
const FLANKING_PUNCTUATION = /^[\p{P}\p{S}]$/u;

/** The mark each emphasis-like inline token of the viewer's lexer writes. */
const TOKEN_MARKS: Readonly<Record<string, Mark>> = { strong: "bold", em: "italic", del: "strike", underline: "underline" };

/** The Lexical text format each mark reads. */
const MARK_FORMATS: Readonly<Record<Mark, TextFormatType>> = {
    bold: "bold", italic: "italic", strike: "strikethrough", underline: "underline",
};

/** One flattened piece of inline content. */
type Segment =
    | { kind: "text"; text: string; marks: Mark[]; code: boolean; style: string; link: LinkNode | null }
    | {
        kind: "source"; source: string; shows: boolean; marks: Mark[]; style: string; link: LinkNode | null;
        /** Whether it is a resolving shortcut reference (`[label]`, `![label]`), showing its text, not its source. */
        shortcut?: boolean;
        /** A nested link's run: what it shows, and the link it belongs to. */
        nested?: { readonly shown: Segment[]; readonly group: { readonly id: string; readonly close: string } | null };
        /** A whole kept construct, its runs' sources joined: what its runs show. */
        kept?: { readonly shown: Segment[] };
        /** A run of a kept construct, before its runs are joined. */
        member?: KeptMember;
    }
    | { kind: "image"; node: MarkdownImageNode; link: LinkNode | null; member?: KeptMember }
    | { kind: "break"; marker: string; link: LinkNode | null; member?: KeptMember };

/** A run of an inline construct kept as written ({@link keptSourceState}), as flattened. */
interface KeptMember {
    readonly kept:   KeptSource;
    /** The Markdown the run writes. */
    readonly source: string;
    /** What the run shows, as segments. */
    readonly shown:  Segment[];
    /** Whether the run still shows what it did at load (an image keeps its source, alt text and size). */
    readonly intact: boolean;
}

/** One block of a list item's content, before its indentation. */
interface ItemBlock {
    /** The block's Markdown. */
    readonly markdown: string;
    /** Whether it is a nested list, written right under the item's text or the list before it. */
    readonly isList: boolean;
    /** Whether it is text: the item's inline content, or a paragraph. */
    readonly isText: boolean;
    /** Whether it is a raw block, written as it was loaded. */
    readonly isRaw?: boolean;
    /** For a nested list, the bullet or delimiter its Markdown is written with. */
    readonly marker?: string;
    /** For a nested list, its Markdown written with another bullet or delimiter. */
    readonly withMarker?: (marker: string) => string;
    /**
     * For a nested list, whether `marked` reads its lines as text a bare `-`
     * line right after them underlines as a setext heading: it holds only
     * bare markers (empty items) and follows text.
     */
    readonly continuesText?: boolean;
}

/** A text segment. */
type TextSegment = Extract<Segment, { kind: "text" }>;

/** A source segment: Markdown kept as written. */
type SourceSegment = Extract<Segment, { kind: "source" }>;

/** A run of segments with one span style, written `[…]{style}`. */
interface StyleGroup { kind: "style"; style: string; units: Segment[] }

/** A run of segments with one link, written `[…](…)` or as an autolink. */
interface LinkGroup { kind: "link"; link: LinkNode; units: Array<Segment | StyleGroup> }

/** What the inline writer walks: a segment or a group of them. */
type Unit = Segment | StyleGroup | LinkGroup;

/** One piece of written inline output, before escaping and line assembly. */
type Piece =
    | { kind: "text"; text: string }        // literal text, escaped once its neighbours are known
    | { kind: "syntax"; text: string }      // Markdown syntax, written as is
    | { kind: "delimiter"; text: string; mark: Mark; opens: boolean } // an emphasis delimiter, written as is
    | { kind: "autolink"; text: string; bare: string } // `bare` where its neighbours bound it, else `text`
    | { kind: "source"; text: string; shortcut?: boolean } // a source node's Markdown, written as is; `shortcut` for a shortcut reference
    | { kind: "reference"; text: string; shortcut: boolean } // `[label]` or `[label][]`, written as is
    | { kind: "break"; marker: string }     // a hard line break with its marker
    | { kind: "newline" };                  // a soft line break kept from the source

/** What ends a line: a hard break, a soft newline. */
type LineEnd = Extract<Piece, { kind: "break" | "newline" }>;

/** A piece of one assembled line: hard breaks and newlines have become line ends. */
type LinePiece = Exclude<Piece, LineEnd>;

/**
 * A way of writing a block's marks. Where delimiters meet each other or
 * punctuation, the order marks open in and where they stand decide whether
 * `marked` reads them; {@link serializeInlineNodes} tries the policies in
 * {@link WRITING_POLICIES} order and keeps the first writing that reads back
 * as the editor shows the block.
 */
interface WritingPolicy {
    /** Underline opens outside the other marks it opens with, so they open and close next to its `++`. */
    readonly underlineOutermost: boolean;
    /** A mark covering a whole link or styled span closes before it and opens again inside it. */
    readonly marksInsideGroups: boolean;
    /**
     * When set, the open marks are kept in this order, outermost first: a
     * mark opening outside one already open closes that one and opens it
     * again inside (`~~a~~*~~b~~*c`).
     */
    readonly rank: readonly Mark[] | null;
}

/**
 * The writing policies, in the order they are tried: the stack rules as the
 * plan writes them first, then underline outermost, then marks inside links
 * and spans, then the marks reopened in a fixed order: underline outermost
 * and strikethrough innermost, since `~~` reads as a letter next to `*`;
 * underline innermost, so a delimiter opening before punctuation opens
 * against a `++`; strikethrough outermost, so emphasis opening inside it
 * opens against punctuation for `_`.
 */
const WRITING_POLICIES: readonly WritingPolicy[] = [
    { underlineOutermost: false, marksInsideGroups: false, rank: null },
    { underlineOutermost: true,  marksInsideGroups: false, rank: null },
    { underlineOutermost: false, marksInsideGroups: true,  rank: null },
    { underlineOutermost: true,  marksInsideGroups: true,  rank: null },
    { underlineOutermost: true,  marksInsideGroups: false, rank: ["underline", "bold", "italic", "strike"] },
    { underlineOutermost: true,  marksInsideGroups: true,  rank: ["underline", "bold", "italic", "strike"] },
    { underlineOutermost: false, marksInsideGroups: false, rank: ["bold", "italic", "strike", "underline"] },
    { underlineOutermost: false, marksInsideGroups: false, rank: ["strike", "underline", "bold", "italic"] },
];

/**
 * The choices a block's lines are assembled with, beyond the writer's: the
 * bold and italic pairs (by their order of opening) written with the other
 * delimiter character than the stack rules chose, and the bare autolinks
 * written bare even where their neighbours do not visibly bound them.
 */
interface AssemblyChoices {
    readonly switched: ReadonlySet<number>;
    readonly bare: ReadonlySet<Piece>;
}

/** No choices: the block assembled as the writer wrote it. */
const NO_CHOICES: AssemblyChoices = { switched: new Set(), bare: new Set() };

/**
 * Reads a block's Markdown back with the viewer's lexer and scores it
 * against the block's reading, at most {@link MAX_READ_BACKS} times.
 */
interface ReadBack {
    /**
     * Scores Markdown by how far it reads as the editor shows the block.
     *
     * @param markdown - The block's inline Markdown.
     * @returns The number of leading reading units that match, or `Infinity` when all do.
     */
    score(markdown: string): number;
    /** Whether the read-backs are spent. */
    spent(): boolean;
}

/** What a run of tokens inherits as it is read: its marks, link and span style. */
interface ReadingScope {
    readonly marks: readonly string[];
    readonly link: string;
    readonly style: string;
}

/** The document's link reference definitions, read once per save or import. */
export interface DocumentDefinitions {
    /** Every definition the document holds, as the viewer resolves them. */
    readonly all:       Links;
    /** `all` in a form two reads can compare. */
    readonly key:       string;
    /** What the block serializers take: `all`, or `null` when nothing in the document uses them ({@link $needsDefinitions}). */
    readonly forBlocks: Links | null;
}

/** A top-level block with its standard output. */
export interface StandardBlock {
    /** The block's node. */
    readonly node: LexicalNode;
    /** Its standard output; `""` for a block that writes nothing (an empty paragraph). */
    readonly text: string;
}

/** A top-level block as a save writes it. */
interface WrittenBlock {
    /** The block's node. */
    readonly node:     LexicalNode;
    /** The block's source at load when it is written as that source, else `undefined`. */
    readonly source:   MarkdownSourceBlock | undefined;
    /** What is written: the source, or the standard output. */
    readonly text:     string;
    /** The block's standard output. */
    readonly standard: string;
}

/** The inline writer's state: the output so far, the open marks, and whitespace held back. */
interface InlineWriter {
    readonly pieces: Piece[];
    readonly context: InlineContext;
    /** How the writer places marks. */
    readonly policy: WritingPolicy;
    /** The marks open at the current group level, outermost first. */
    stack: Mark[];
    /** Trailing whitespace (and soft breaks) of the last text, written after any delimiter that closes next. */
    pending: Piece[];
    /** Whether the held-back whitespace is underlined, so an underline closing next writes it before its delimiter. */
    pendingUnderline: boolean;
    /** Whether the output is inside a link's text. */
    inLink: boolean;
    /** Computes the order the next unit's missing marks open in, outermost first. */
    openOrder: () => readonly Mark[];
}

// ---------------------------------------------------------------- entry points

/**
 * Serializes the active editor state's document to Markdown in this
 * dialect. Like `@lexical/markdown`'s `$convertToMarkdownString`, it must
 * run inside an `editor.read` or `editor.update`.
 *
 * Without a source map every block is written in the standard form, joined
 * by one blank line, with no trailing newline. With the editor's source map,
 * a top-level block whose standard output still equals its output at load,
 * and whose source still reads the same under the document's definitions, is
 * written as its source, and the text between two such blocks that were
 * neighbours at load, and around the document, is kept: an unedited document
 * saves as it was loaded.
 *
 * @param sourceMap - The source map of the editor's imports.
 * @returns The Markdown.
 */
export function $serializeMarkdown(sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP): string {
    const definitions = $readDefinitions(sourceMap.blocks.size > 0);
    const parts = $serializeTopLevelBlocks(definitions.forBlocks);
    const load = documentLoad(parts, sourceMap);
    const blocks = writtenBlocks(parts, sourceMap, definitions);

    if (blocks.length === 0) {
        return load.blockCount === 0 ? load.prefix : "";
    }

    return assembleDocument(blocks, load);
}

/**
 * Serializes each of the root's children in the standard form, under the
 * document's link reference definitions, a list next to a raw block or right
 * after another list written so it stays its own list
 * ({@link serializeListApart}). The import takes a
 * block's fingerprint and a save its standard output from this one function,
 * so the two are computed identically.
 *
 * @param definitions - The definitions the block serializers take
 *   ({@link DocumentDefinitions.forBlocks}).
 * @returns One entry per root child, in document order.
 */
export function $serializeTopLevelBlocks(definitions: Links | null): StandardBlock[] {
    const children = $getRoot().getChildren();
    let previousJoinable: string | undefined;

    return children.map((node, index) => {
        const text = $isListNode(node)
            ? serializeListApart(node, previousJoinable, children.slice(index + 1), definitions)
            : serializeBlock(node, definitions);

        if (text !== "") {
            previousJoinable = $isMarkdownRawBlockNode(node) || $isListNode(node) ? text : undefined;
        }

        return { node, text };
    });
}

/**
 * Reads the document's link reference definitions with one lex of its raw
 * blocks' text, for both the block serializers and a comparison with the
 * definitions at load.
 *
 * @param compared - Whether the definitions are compared with those at load,
 *   so they are read even when no reference link needs them.
 * @returns The definitions; `all` is empty when neither needs them.
 */
export function $readDefinitions(compared: boolean): DocumentDefinitions {
    const needed = $needsDefinitions();
    const all: Links = needed || compared ? $lexDefinitions() : {};

    return { all, key: JSON.stringify(all), forBlocks: needed ? all : null };
}

/**
 * Serializes a link's text as the body of its brackets — marks, styles and
 * escaping as in any link — in a paragraph's context with no marks open
 * around it, so the result depends only on the link's own children.
 * Comparing it with the same function's output at load tells whether the
 * text has been edited or formatted since.
 *
 * @param link - The link.
 * @returns The text between the link's brackets.
 */
export function $serializeLinkContent(link: LinkNode): string {
    const writer: InlineWriter = {
        pieces: [], context: MULTI_LINE, policy: WRITING_POLICIES[0]!, stack: [], pending: [], pendingUnderline: false,
        inLink: true, openOrder: () => MARK_ORDER,
    };

    writeUnits(writer, groupSegments(flattenInline(link.getChildren())), []);
    closeMarks(writer, 0);
    flushPending(writer);

    return assembleLines(writer.pieces, MULTI_LINE);
}

/**
 * Reads the link reference definitions the saved document will hold, as the
 * viewer resolves them: only raw blocks can hold one (the serializer escapes
 * the `[` of any other text), and a raw block lexes alone as it does in the
 * document, so their text, joined as blocks, is lexed for `marked`'s own map.
 *
 * @returns The definitions, or `null` when nothing in the document uses
 *   them, so none is needed.
 */
function $collectDefinitions(): Links | null {
    return $needsDefinitions() ? $lexDefinitions() : null;
}

/**
 * Tells whether the document holds something its definitions decide: a
 * reference link, which needs them to be written in its own form, or a run
 * kept as source holding a `[`, which may be a reference (`[][label]`) whose
 * reading needs them.
 *
 * @returns `true` when it holds one.
 */
function $needsDefinitions(): boolean {
    return $dfs().some(({ node }) => $isReferenceLinkNode(node) || ($isMarkdownSourceTextNode(node) && node.getSource().includes(LABEL_OPEN)));
}

/**
 * Lexes the document's raw blocks' text for its link reference definitions,
 * as {@link $collectDefinitions} describes.
 *
 * @returns `marked`'s map of the definitions.
 */
function $lexDefinitions(): Links {
    return lexMarkdownLinkDefinitions(rawBlockTexts($getRoot().getChildren()).join(BLOCK_SEPARATOR));
}

/**
 * The text of every raw block among `nodes`, in their `:::` fences' columns
 * and in their lists' items — every place a block is written as a block of
 * the saved document, where `marked` reads a definition it holds.
 *
 * @param nodes - Blocks, in document order.
 * @returns The raw blocks' text, in document order.
 */
function rawBlockTexts(nodes: LexicalNode[]): string[] {
    return nodes.flatMap((node): string[] => {
        if ($isMarkdownRawBlockNode(node)) {
            return [node.getTextContent()];
        }

        const holdsBlocks = $isMarkdownBlockNode(node) || $isMarkdownColumnNode(node) || $isListNode(node) || $isListItemNode(node);

        return holdsBlocks ? rawBlockTexts(node.getChildren()) : [];
    });
}

/**
 * The Markdown the document's link reference definitions are read from: its
 * raw blocks' text, joined as blocks, as {@link $collectDefinitions} lexes it.
 * Two documents whose texts are equal hold the same definitions. Must run
 * inside an `editor.read` or `editor.update`.
 *
 * @returns The raw blocks' text.
 */
export function $definitionsSource(): string {
    return rawBlockTexts($getRoot().getChildren()).join(BLOCK_SEPARATOR);
}

/**
 * Serializes one block node as a save writes it — the Markdown the editor
 * puts into a raw block when a paragraph merges into it. Must run inside an
 * `editor.read` or `editor.update`.
 *
 * @param node - The block.
 * @returns Its Markdown, or `""` when it writes nothing.
 */
export function $serializeBlock(node: LexicalNode): string {
    return serializeBlock(node, $collectDefinitions());
}

/**
 * Serializes a run of inline nodes as a save writes them, their lines kept —
 * the Markdown a raw block or code block holds for content it takes in from
 * another block. Must run inside an `editor.read` or `editor.update`.
 *
 * @param nodes - The inline nodes.
 * @returns Their Markdown, lines separated by `\n`.
 */
export function $serializeInlineNodes(nodes: LexicalNode[]): string {
    return serializeInlineNodes(nodes, { ...MULTI_LINE, definitions: $collectDefinitions() });
}

/**
 * Tells whether a block's save reads back as the editor shows it: for each
 * run of inline content it holds (a paragraph's, a heading's, a quote's, a
 * list item's, a table cell's), the viewer's reading of the Markdown written
 * for it — every visible character, image and break with its marks, link
 * and style — is the editor's. A raw block or code block, saved as written,
 * always does; so does a run whose source the reading cannot read on its
 * own (source that does not lex as inline content in a heading or table
 * cell). The editor declines an edit that would make a
 * block stop reading back. Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @param node - The block, or a run's container in it.
 * @param inTableCell - Whether it sits in a table cell, whose content is
 *   written on the cell's line; read off its ancestors when omitted, which a
 *   detached copy of a block does not have.
 * @returns `false` when some run of it would read back differently.
 */
export function $readsBackAsShown(node: LexicalNode, inTableCell?: boolean): boolean {
    const inCell = inTableCell ?? $findMatchingParent(node, $isTableCellNode) !== null;
    // A reference link is written, and read back, with the document's definitions, as a save writes it.
    const definitions = $collectDefinitions();

    return inlineRuns(node, inCell).every(([nodes, context]) => inlineReadsBack(nodes, { ...context, definitions }));
}

/**
 * The runs of inline content in a block whose save does not read back as
 * the editor shows them ({@link $readsBackAsShown}), each with the inline
 * tokens the viewer reads its save as: what the run shows once a load
 * builds it from that save. A table cell's run is the cell alone. Must run
 * inside an `editor.read` or `editor.update`.
 *
 * @param node - The block.
 * @param inTableCell - Whether it sits in a table cell; read off its
 *   ancestors when omitted, which a detached block does not have.
 * @returns The runs, in document order; none when the whole block reads back.
 */
export function $runsReadingOtherwise(node: LexicalNode, inTableCell?: boolean): Array<{ nodes: LexicalNode[]; tokens: Token[] }> {
    const inCell = inTableCell ?? $findMatchingParent(node, $isTableCellNode) !== null;
    // A reference — a reference link, or one kept as source — reads back with the document's definitions, as saved.
    const definitions = lexMarkdownLinkDefinitions($definitionsSource());

    return inlineRuns(node, inCell).flatMap(([nodes, base]) => {
        const context: InlineContext = { ...base, definitions };

        if (nodes.length === 0 || inlineReadsBack(nodes, context)) {
            return [];
        }

        const tokens = readBackTokens(runMarkdown(nodes, context), context);

        return tokens === null ? [] : [{ nodes, tokens }];
    });
}

/**
 * How far a block's standard form — what a save writes for it once it is
 * edited — reads as the tokens it was loaded from: the importer keeps a
 * construct as written ({@link keptSourceState}) where it would not.
 */
export interface StandardFormReading {
    /** How many leading reading units of the tokens the standard form reads as they do; `Infinity` when all, and no more. */
    readonly score:   number;
    /** The reading units each token, at any depth, reads as: `[start, end)`. */
    readonly spans:   ReadonlyMap<Token, readonly [number, number]>;
    /** For a heading, how many leading characters of its id the standard form keeps; `Infinity` when all, or for any other block. */
    readonly idScore: number;
}

/**
 * Reads a block's standard form against the inline tokens it was loaded
 * from: the reading of the Markdown a save writes for its inline content —
 * a paragraph's, a heading's, a quote's, a list item's or a table cell's —
 * against the viewer's reading of the tokens and, for a heading, the id the
 * viewer gives it, which it slugs from the heading's source text. Must run
 * inside an `editor.read` or `editor.update`.
 *
 * @param container - The block (a table cell for a cell's content).
 * @param tokens - The inline tokens it was loaded from (a task item's checkbox first).
 * @param headingText - A heading's source text, as `marked` gives it; `null` for any other block.
 * @param definitions - The document's link reference definitions, which keep a reference link in its written form; `null` for none.
 * @returns How far the standard form reads as the tokens do.
 */
export function $readStandardForm(
    container: ElementNode, tokens: readonly Token[], headingText: string | null, definitions: Links | null,
): StandardFormReading {
    const cell = $isTableCellNode(container);
    const heading = $isHeadingNode(container) ? container : null;
    const base = cell ? TABLE_CELL : heading !== null ? headingContext(heading) : $isListItemNode(container) ? { ...MULTI_LINE, inListItem: true } : MULTI_LINE;
    const context: InlineContext = { ...base, definitions };
    const reading: InlineContext = { ...context, readsWhitespace: true };
    const intended: string[] = [];
    const spans = new Map<Token, readonly [number, number]>();

    pushTokenReading(intended, tokens, { marks: [], link: "", style: "" }, reading, spans);

    const written = cell ? serializeTableCell(container, definitions) : serializeInline(container, context);
    const score = readingScore(withoutTrailingWhitespace(markdownReading(written, reading)), withoutTrailingWhitespace(intended));

    if (heading === null || headingText === null) {
        return { score, spans, idScore: Infinity };
    }

    const writtenHeading = lexMarkdown(serializeHeading(heading, definitions)).find((token) => token.type === "heading") as Tokens.Heading | undefined;
    const [id, writtenId] = [headingSlug(headingText), headingSlug(writtenHeading?.text ?? "")];
    const differs = [...id].findIndex((char, index) => writtenId[index] !== char);

    return { score, spans, idScore: id === writtenId ? Infinity : differs === -1 ? id.length : differs };
}

/**
 * The slug the viewer makes a heading's id from: lowercase, each run of
 * characters other than ASCII letters and digits one hyphen, none at the
 * ends. Mirrors `slugify` in `Markdown.ts`, which the viewer does not export.
 *
 * @param text - The heading's source text.
 * @returns The slug.
 */
function headingSlug(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * The runs of inline content a block holds, each with the context the save
 * writes it in. A table cell's content is one run, the cell alone: its
 * paragraphs are written on one line, which `marked` reads as a whole.
 *
 * @param node - The block.
 * @param inTableCell - Whether it sits in a table cell.
 * @returns The runs.
 */
function inlineRuns(node: LexicalNode, inTableCell: boolean): Array<[LexicalNode[], InlineContext]> {
    if ($isMarkdownRawBlockNode(node) || $isCodeNode(node) || !$isElementNode(node)) {
        return [];
    }

    const cell = $isTableCellNode(node) ? node : inTableCell ? $findMatchingParent(node, $isTableCellNode) : null;

    if (cell !== null) {
        return [[[cell], TABLE_CELL]];
    }

    if ($isParagraphNode(node) || $isQuoteNode(node) || $isHeadingNode(node)) {
        return [[node.getChildren(), inTableCell ? TABLE_CELL : $isHeadingNode(node) ? headingContext(node) : MULTI_LINE]];
    }

    if (!$isListItemNode(node)) {
        return node.getChildren().flatMap((child) => inlineRuns(child, inTableCell || $isTableCellNode(node)));
    }

    const runs: Array<[LexicalNode[], InlineContext]> = [];
    let inline: LexicalNode[] = [];
    const context = inTableCell ? TABLE_CELL : MULTI_LINE;

    for (const child of node.getChildren()) {
        if (!$isElementNode(child) || child.isInline()) {
            inline.push(child);

            continue;
        }

        runs.push([inline, context], ...inlineRuns(child, inTableCell));
        inline = [];
    }

    return [...runs, [inline, context]];
}

/**
 * Whether a heading's save writes it on one line, its line breaks as spaces:
 * a level 3–6 heading, or a level 1 or 2 heading whose content does not span
 * lines or has a line that would end its setext form
 * ({@link SETEXT_INTERRUPTING_LINE}).
 *
 * @param node - The heading.
 * @returns `true` when it is written ATX.
 */
export function $headingWritesOneLine(node: HeadingNode): boolean {
    return headingContext(node) === HEADING_LINE;
}

/**
 * The context a heading's content is written in: the setext writing's, when
 * {@link serializeHeading} writes it so, else one line.
 *
 * @param node - The heading.
 * @returns The context.
 */
function headingContext(node: HeadingNode): InlineContext {
    if (Number(node.getTag().slice(1)) > SETEXT_MAX_LEVEL) {
        return HEADING_LINE;
    }

    const lines = serializeInline(node, MULTI_LINE);

    return lines.includes("\n") && !lines.split("\n").some((line) => SETEXT_INTERRUPTING_LINE.test(line)) ? MULTI_LINE : HEADING_LINE;
}

/**
 * Tells whether a run of inline content reads back as the editor shows it:
 * the reading of its nodes as they are — before the writer moves a `+` out
 * of underline or a bracket out of a styled span, whose grammars cannot hold
 * them — equals the reading of the Markdown written for it.
 *
 * @param nodes - The inline nodes.
 * @param context - Where they are written.
 * @returns `true` when the readings are equal, or the run's reading is not known.
 */
function inlineReadsBack(nodes: LexicalNode[], context: InlineContext): boolean {
    const reading: InlineContext = { ...context, readsWhitespace: true };
    const cell = nodes.length === 1 && $isTableCellNode(nodes[0]) ? nodes[0] : null;
    const intended = withoutTrailingWhitespace(cell !== null
        ? cellReading(cell, reading)
        : segmentReading(withoutEdgeBreaks(flattenInline(nodes, true), context), reading));

    if (intended === null) {
        return true;
    }

    return readingScore(withoutTrailingWhitespace(markdownReading(runMarkdown(nodes, context), reading)), intended) === Infinity;
}

/**
 * The reading of a table cell's content as the editor shows it: each
 * paragraph's, a break between two, as the viewer renders the cell
 * paragraph break the save writes there.
 *
 * @param cell - The cell.
 * @param reading - The context it is read in.
 * @returns The reading, or `null` when it is not known (a block other than
 *   a paragraph, which the table rules turn into paragraphs).
 */
function cellReading(cell: TableCellNode, reading: InlineContext): string[] | null {
    const units: string[] = [];

    for (const [index, child] of cell.getChildren().entries()) {
        const part = $isParagraphNode(child) ? segmentReading(flattenInline(child.getChildren(), true), reading) : null;

        if (part === null) {
            return null;
        }

        if (index > 0) {
            pushBreakReading(units);
        }

        units.push(...part);
    }

    return units;
}

/**
 * The Markdown a save writes for a run of inline content: a table cell's
 * whole text for a cell, else the run's inline Markdown.
 *
 * @param nodes - The run's nodes (a table cell alone for a cell).
 * @param context - Where they are written.
 * @returns The Markdown.
 */
function runMarkdown(nodes: LexicalNode[], context: InlineContext): string {
    const cell = nodes.length === 1 && $isTableCellNode(nodes[0]) ? nodes[0] : null;

    return cell !== null ? serializeTableCell(cell, context.definitions) : serializeInlineNodes(nodes, context);
}

/**
 * The bullet character or ordered delimiter a save writes for a list: its
 * authored marker, or `-` / `.` for a list made in the editor or one whose
 * marker is of the other list type. Two adjacent lists that write the same
 * one read as one list. Must run inside an `editor.read` or `editor.update`.
 *
 * @param list - The list.
 * @returns `-`, `*`, `+`, `.` or `)`.
 */
export function $writtenListMarker(list: ListNode): string {
    const authored = $getState(list, listMarkerState);
    const markers = list.getListType() === "number" ? ORDERED_DELIMITERS : BULLET_MARKERS;

    return markers.includes(authored) ? authored : markers[0]!;
}

/**
 * Tells whether a list's save reads as a loose list: its looseness, where
 * the save can write it — between items, or, in a list of one item, between
 * that item's text and its nested list — or any item holding a block that is
 * not a nested list after its first, or a nested list after a first block
 * that is not text (a table, a quote), which a blank line sets apart and so
 * makes the list loose whatever its looseness. A single-item list whose item
 * holds one block cannot be loose. Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @param list - The list.
 * @returns `true` when the save reads as a loose list.
 */
export function $listReadsLoose(list: ListNode): boolean {
    const items: Array<Array<"list" | "text" | "block">> = [];

    for (const item of list.getChildren().filter($isListItemNode)) {
        const continues = $isListNode(item.getFirstChild()) && items.length > 0;
        const blocks = continues ? items[items.length - 1]! : [];

        blocks.push(...itemBlockKinds(item));

        if (!continues) {
            items.push(blocks);
        }
    }

    if (items.some((blocks) => blocks.slice(1).some((kind) => kind !== "list") || (blocks[0] === "block" && blocks.length > 1))) {
        return true;
    }

    return $getState(list, listLooseState) && (items.length > 1 || (items[0]?.length ?? 0) > 1);
}

/**
 * Renders a delimiter row from the header cells' formats and the table's
 * column widths. A `0` (or `null`) width is `@lexical/table`'s own "no width"
 * sentinel for `TableNode.getColWidths()`, so it re-emits with no `{width=…}`.
 *
 * @param alignments - One {@link ElementFormatType} per column.
 * @param widths - One column width (in pixels) per column, or `null`/`0` for none.
 * @returns The rendered delimiter-row line.
 *
 * @example
 * ```
 * formatDelimiterRow(["left", "center", "right", ""], [240, null, null, null])
 * // -> "| :--- {width=240} | :---: | ---: | --- |"
 * ```
 */
export function formatDelimiterRow(alignments: ElementFormatType[], widths: readonly (number | null)[]): string {
    const cells = alignments.map((alignment, index) => {
        const dashes = (() => {
            switch (alignment) {
                case "left":   return ":---";
                case "center": return ":---:";
                case "right":  return "---:";
                default:       return "---";
            }
        })();

        const width = widths[index];

        return width !== null && width !== 0 && width !== undefined ? `${dashes} {width=${width}}` : dashes;
    });

    return "| " + cells.join(" | ") + " |";
}

// ---------------------------------------------------------------- source preservation

/**
 * Joins the written blocks, keeping the source's own text between two blocks
 * written as source that were neighbours at load; any other two blocks are
 * one blank line apart.
 *
 * @param blocks - The blocks to write, at least one.
 * @param load - The document's import, whose ending the document keeps.
 * @returns The Markdown.
 */
function assembleDocument(blocks: readonly WrittenBlock[], load: MarkdownSourceLoad): string {
    const body = blocks.map((block, index) => separatorBefore(blocks, index) + block.text).join("");

    return documentStart(blocks[0]!.source) + body + documentEnd(blocks[blocks.length - 1]!.source, load);
}

/**
 * The import the document as a whole comes from: the one that loaded its last
 * top-level block still in the source map, edited or not — an undo can bring
 * back an earlier import's blocks — else the last import.
 *
 * @param parts - Every top-level block, with its standard output.
 * @param sourceMap - The source map of the editor's imports.
 * @returns The import whose text around the document a save keeps.
 */
function documentLoad(parts: readonly StandardBlock[], sourceMap: MarkdownSourceMap): MarkdownSourceLoad {
    for (let index = parts.length - 1; index >= 0; index--) {
        const entry = sourceMap.blocks.get(parts[index]!.node.getKey());

        if (entry !== undefined) {
            return entry.load;
        }
    }

    return sourceMap.latest;
}

/**
 * Decides what each top-level block writes: its source when it is unchanged
 * and its source still reads the same where it now stands, else its standard
 * output. A block that writes nothing (an empty paragraph) is left out —
 * unless it is unchanged, since a block the viewer shows as nothing (a link
 * with empty text) still has source to keep.
 *
 * @param parts - Every top-level block, with its standard output.
 * @param sourceMap - The source map of the editor's imports.
 * @param definitions - The document's definitions now.
 * @returns The blocks to write, in document order.
 */
function writtenBlocks(
    parts: readonly StandardBlock[], sourceMap: MarkdownSourceMap, definitions: DocumentDefinitions,
): WrittenBlock[] {
    const candidates = parts
        .map((part) => ({ ...part, entry: unchangedBlock(part, sourceMap, definitions) }))
        .filter((part) => part.text !== "" || part.entry !== undefined);
    const written: WrittenBlock[] = [];

    candidates.forEach(({ node, text, entry }, index) => {
        const runsOn = entry !== undefined && entry.load.endsOpen && entry.index === entry.load.blockCount - 1
            && index < candidates.length - 1;
        const keep = entry !== undefined && !runsOn && !joinsPreviousBlock(entry, written[written.length - 1]);
        const block = keep ? { node, source: entry, text: entry.body, standard: text } : { node, source: undefined, text, standard: text };

        if (block.text !== "") {
            written.push(block);
        }
    });

    // From the end, so each block is checked against what is finally written after it.
    for (let index = written.length - 1; index >= 0; index--) {
        const block = written[index]!;

        if (block.source !== undefined && labelClosedAfter(written, index)) {
            written.splice(index, 1, ...(block.standard === "" ? [] : [{ ...block, source: undefined, text: block.standard }]));
        }
    }

    return written;
}

/**
 * Tells whether a block written as its source ends inside a definition label
 * ({@link OPEN_LABEL}) or title ({@link OPEN_TITLE}) that what is written
 * after it closes, so `marked` reads the block and later text as one
 * definition: its source no longer reads as loaded, and it must be written
 * in the standard form, which escapes its `[` (or writes a reference there
 * as `[label][]`).
 *
 * @param blocks - The blocks being written.
 * @param index - The block's position among them.
 * @returns `true` when the block's last block-level token reads otherwise
 *   with what follows it.
 */
function labelClosedAfter(blocks: readonly WrittenBlock[], index: number): boolean {
    const text = blocks[index]!.text;

    if (!(OPEN_LABEL.test(text) || OPEN_TITLE.test(text)) || index === blocks.length - 1) {
        return false;
    }

    const following = blocks.slice(index + 1).map((block, offset) => separatorBefore(blocks, index + 1 + offset) + block.text).join("");
    const lexBlocks = (markdown: string): Token[] => lexMarkdown(markdown).filter((token) => token.type !== "space");
    const alone = lexBlocks(text);
    const last = alone.length - 1;

    return last >= 0 && (lexBlocks(text + following)[last]?.raw ?? "").trim() !== (alone[last]!.raw ?? "").trim();
}

/**
 * Tells whether a block's source would join the block written before it: its
 * first line is indented, and the block before it — not its neighbour at
 * load, whose text before it is kept — may be a list, whose item takes an
 * indented line after a blank one as its own content.
 *
 * @param entry - The unchanged block.
 * @param previous - The block written before it, or `undefined` at the document's start.
 * @returns `true` when the block must be written in the standard form, at
 *   column 0.
 */
function joinsPreviousBlock(entry: MarkdownSourceBlock, previous: WrittenBlock | undefined): boolean {
    if (previous === undefined || !INDENTED_LINE.test(entry.body)) {
        return false;
    }

    return !followsAtLoad(previous.source, entry) && ($isListNode(previous.node) || $isMarkdownRawBlockNode(previous.node));
}

/**
 * Tells whether two loaded blocks followed each other in the same import.
 *
 * @param previous - The earlier block, or `undefined` for one written in the standard form.
 * @param current - The later block, or `undefined` for one written in the standard form.
 * @returns `true` when `current` came right after `previous` at load.
 */
function followsAtLoad(previous: MarkdownSourceBlock | undefined, current: MarkdownSourceBlock | undefined): boolean {
    return previous !== undefined && current !== undefined && current.load === previous.load
        && current.index === previous.index + 1;
}

/**
 * The block a part was loaded as, when its standard output still equals its
 * output at load and its source still reads the same under the document's
 * definitions — the block is unchanged and can be written as its source.
 *
 * @param part - A block and its standard output.
 * @param sourceMap - The source map of the editor's imports.
 * @param definitions - The document's definitions now.
 * @returns The loaded block, or `undefined` for an edited or new block.
 */
function unchangedBlock(
    part: StandardBlock, sourceMap: MarkdownSourceMap, definitions: DocumentDefinitions,
): MarkdownSourceBlock | undefined {
    const entry = sourceMap.blocks.get(part.node.getKey());

    return entry !== undefined && entry.fingerprint === part.text && readsAlike(entry, definitions) ? entry : undefined;
}

/**
 * Tells whether a block's source reads the same under the document's
 * definitions now as under those at its load. Once they differ, text the
 * source wrote as a bracketed label may resolve differently — text becoming a
 * link, or a link another URL — which its fingerprint cannot show. Only
 * source holding a `[` can use a definition, and such source reads the same
 * exactly when it lexes to the same tokens under both sets, so a document
 * whose definitions were edited still writes every block they do not reach
 * as loaded.
 *
 * @param entry - The loaded block.
 * @param definitions - The document's definitions now.
 * @returns `true` when the source means what it meant at load.
 */
function readsAlike(entry: MarkdownSourceBlock, definitions: DocumentDefinitions): boolean {
    if (entry.load.definitionsKey === definitions.key || !entry.body.includes(LABEL_OPEN)) {
        return true;
    }

    const known = READS_ALIKE.get(entry);

    if (known?.definitionsKey === definitions.key) {
        return known.alike;
    }

    const before = JSON.stringify(lexMarkdownWithDefinitions(entry.body, entry.load.definitions));
    const alike = before === JSON.stringify(lexMarkdownWithDefinitions(entry.body, definitions.all));

    READS_ALIKE.set(entry, { definitionsKey: definitions.key, alike });

    return alike;
}

/**
 * The text written before a block: nothing before the first one, the
 * source's own text between two blocks written as source that followed each
 * other at load, and one blank line otherwise — with {@link LIST_SEPARATOR}
 * between two raw blocks that did not follow each other at load when the
 * second's list would join the first's ({@link listsJoin}), as the block
 * list keeps them apart.
 *
 * @param blocks - The blocks being written.
 * @param index - The block's position among them.
 * @returns The separator.
 */
function separatorBefore(blocks: readonly WrittenBlock[], index: number): string {
    if (index === 0) {
        return "";
    }

    const previous = blocks[index - 1]!;
    const current = blocks[index]!;

    if (followsAtLoad(previous.source, current.source)) {
        return previous.source!.after;
    }

    const joins = $isMarkdownRawBlockNode(previous.node) && $isMarkdownRawBlockNode(current.node) && listsJoin(previous.text, current.text);

    return joins ? BLOCK_SEPARATOR + LIST_SEPARATOR + BLOCK_SEPARATOR : BLOCK_SEPARATOR;
}

/**
 * The text written before the first block: its import's own leading blank
 * lines while that block is the import's first, written as source.
 *
 * @param first - The first block's source, or `undefined` for one written in the standard form.
 * @returns The text before the first block.
 */
function documentStart(first: MarkdownSourceBlock | undefined): string {
    return first !== undefined && first.index === 0 ? first.load.prefix : "";
}

/**
 * The text written after the last block: its import's own ending while that
 * block is the import's last, written as source, else a newline when the
 * document's source ended with one.
 *
 * @param last - The last block's source, or `undefined` for one written in the standard form.
 * @param load - The document's import.
 * @returns The text after the last block.
 */
function documentEnd(last: MarkdownSourceBlock | undefined, load: MarkdownSourceLoad): string {
    if (last !== undefined && last.index === last.load.blockCount - 1) {
        return last.after;
    }

    return load.endsWithNewline ? "\n" : "";
}

// ---------------------------------------------------------------- blocks

/**
 * Serializes a list of block nodes, dropping the ones that write nothing
 * (empty paragraphs). A list next to a raw block, or right after another
 * list, is written so it stays its own list ({@link serializeListApart}),
 * and a raw block that would join the raw block before it (a raw list
 * continuing a raw list of its marker) is kept apart by {@link LIST_SEPARATOR}.
 *
 * @param nodes - The blocks, in document order.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The blocks joined by one blank line.
 */
function serializeBlockList(nodes: LexicalNode[], definitions: Links | null): string {
    const written: string[] = [];
    let previousJoinable: string | undefined;
    let previousRaw: string | undefined;

    nodes.forEach((node, index) => {
        const markdown = $isListNode(node)
            ? serializeListApart(node, previousJoinable, nodes.slice(index + 1), definitions)
            : serializeBlock(node, definitions);

        if (markdown === "") {
            return;
        }

        const raw = $isMarkdownRawBlockNode(node);

        if (raw && previousRaw !== undefined && listsJoin(previousRaw, markdown)) {
            written.push(LIST_SEPARATOR);
        }

        written.push(markdown);
        previousJoinable = raw || $isListNode(node) ? markdown : undefined;
        previousRaw = raw ? markdown : undefined;
    });

    return written.join(BLOCK_SEPARATOR);
}

/**
 * Serializes a top-level list so `marked` does not join it to a list a raw
 * block next to it ends or starts with, or to a list right before it (a
 * list with the same bullet character or ordered delimiter continues one
 * after a blank line): with its own marker when that keeps it apart, else
 * with the first other marker of its type that does; when none does (an
 * ordered list between raw lists of both delimiters, a list before an
 * indented raw list), with its own marker and {@link LIST_SEPARATOR} on
 * each side it would join, which shows nothing. The editor joins adjacent lists that
 * write one marker, but only when the first changes, so two such lists can
 * stand next to each other; lists of two types do not join.
 *
 * @param list - The list.
 * @param before - The Markdown of the raw block or list written right
 *   before it, if one was.
 * @param following - The blocks after it.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The list's Markdown, with any separator.
 */
function serializeListApart(list: ListNode, before: string | undefined, following: LexicalNode[], definitions: Links | null): string {
    const markdown = serializeList(list, definitions);
    const nextNode = following.find((node) => !$isParagraphNode(node) || serializeBlock(node, definitions) !== "");
    const after = $isMarkdownRawBlockNode(nextNode) ? serializeBlock(nextNode, definitions) : undefined;

    if (before === undefined && after === undefined) {
        return markdown;
    }

    const joinsBefore = (candidate: string): boolean => before !== undefined && blocksJoin(before, candidate);
    const joinsAfter = (candidate: string): boolean => after !== undefined && blocksJoin(candidate, after);
    const markers = list.getListType() === "number" ? ORDERED_DELIMITERS : BULLET_MARKERS;
    const own = $getState(list, listMarkerState);
    const candidates = [markdown, ...markers.filter((marker) => marker !== own).map((marker) => serializeList(list, definitions, false, marker))];
    const apart = candidates.find((candidate) => !joinsBefore(candidate) && !joinsAfter(candidate));

    if (apart !== undefined) {
        return apart;
    }

    const separated = joinsBefore(markdown) ? [LIST_SEPARATOR, markdown] : [markdown];

    return (joinsAfter(markdown) ? [...separated, LIST_SEPARATOR] : separated).join(BLOCK_SEPARATOR);
}

/**
 * Tells whether a block ending in a list and a block opening with one join
 * when written one after the other ({@link blocksJoin}): the second list
 * continues the first. Definitions, which `marked` drops when repeated, are
 * never taken for a join.
 *
 * @param first - The first block's Markdown.
 * @param second - The second block's Markdown.
 * @returns `true` when the second's list joins the first's.
 */
function listsJoin(first: string, second: string): boolean {
    const blocks = (markdown: string): Token[] => lexMarkdown(markdown).filter((token) => token.type !== "space");

    return blocks(first).at(-1)?.type === "list" && blocks(second)[0]?.type === "list" && blocksJoin(first, second);
}

/**
 * Tells whether two blocks' Markdown written one after the other, a blank
 * line between, lexes as fewer blocks than each does alone, or with the
 * first's last block taking in part of the second (a list taking an
 * indented list's first item as its own nested list): the second joins the
 * first.
 *
 * @param first - The first block's Markdown.
 * @param second - The second block's Markdown.
 * @returns `true` when they join.
 */
function blocksJoin(first: string, second: string): boolean {
    const blocks = (markdown: string): Token[] => lexMarkdown(markdown).filter((token) => token.type !== "space");
    const alone = blocks(first);
    const both = blocks(first + BLOCK_SEPARATOR + second);
    const last = alone.length - 1;

    if (both.length < alone.length + blocks(second).length) {
        return true;
    }

    return last >= 0 && (both[last]?.raw ?? "").trim() !== (alone[last]!.raw ?? "").trim();
}

/**
 * Serializes one block node.
 *
 * @param node - The block.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns Its Markdown, or `""` when it writes nothing.
 */
function serializeBlock(node: LexicalNode, definitions: Links | null): string {
    if ($isParagraphNode(node)) {
        return serializeInline(node, { ...MULTI_LINE, definitions });
    }

    if ($isHeadingNode(node)) {
        return serializeHeading(node, definitions);
    }

    if ($isQuoteNode(node)) {
        return serializeQuote(node, definitions);
    }

    if ($isCodeNode(node)) {
        return serializeCode(node);
    }

    if ($isListNode(node)) {
        return serializeList(node, definitions);
    }

    if ($isTableNode(node)) {
        return serializeTable(node, definitions);
    }

    if ($isMarkdownBlockNode(node)) {
        return serializeFence(node, definitions);
    }

    if ($isMarkdownRawBlockNode(node)) {
        return serializeRawBlock(node, definitions);
    }

    return $isElementNode(node) ? serializeBlockList(node.getChildren(), definitions) : node.getTextContent();
}

/**
 * Serializes a raw block: its text as written — unless that text runs on
 * (an HTML block its own text does not close, `<!--` without `-->`, `<pre>`
 * without `</pre>`) and a block that writes something follows it, which the
 * text would take in. It is then written as a paragraph holding its text,
 * escaped, its lines kept by hard breaks, so it shows the same text and the
 * blocks after it stay their own, as the editor shows them.
 *
 * @param node - The raw block.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns Its Markdown.
 */
function serializeRawBlock(node: MarkdownRawBlockNode, definitions: Links | null): string {
    if ($rawBlockWritesAsParagraph(node, definitions)) {
        return serializeInline(node, MULTI_LINE);
    }

    const text = node.getTextContent();

    // A block only a second blank line ends writes that line itself, so the block after it stays its own.
    return rawBlockEnd(text) === "wide" && $writesBlockAfter(node, definitions) ? `${text}\n` : text;
}

/**
 * Tells whether a save writes a raw block as a paragraph holding its text
 * ({@link serializeRawBlock}): its text runs on and a block after it writes
 * something. The editor then shows it as that paragraph. Must run inside an
 * `editor.read` or `editor.update`.
 *
 * @param node - The raw block.
 * @param definitions - The saved document's link reference definitions, or
 *   `null`; read off the document when omitted.
 * @returns `true` when it is written as a paragraph.
 */
export function $rawBlockWritesAsParagraph(node: MarkdownRawBlockNode, definitions: Links | null = $collectDefinitions()): boolean {
    return rawBlockEnd(node.getTextContent()) === "runsOn" && $writesBlockAfter(node, definitions);
}

/**
 * Tells whether a block after a node, among its siblings, writes something.
 * Must run inside an `editor.read` or `editor.update`.
 *
 * @param node - The node.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns `true` when a later sibling writes Markdown.
 */
function $writesBlockAfter(node: LexicalNode, definitions: Links | null): boolean {
    return node.getNextSiblings().some((sibling) => serializeBlock(sibling, definitions) !== "");
}

/**
 * Tells whether a block's Markdown runs on past its own text, so a block
 * written after it, one blank line between, would join it: its
 * {@link rawBlockEnd} is not `"apart"`. The importer asks it of a document's
 * last block too.
 *
 * @param markdown - The block's Markdown.
 * @returns `true` when a following block would be read as part of it.
 */
export function runsOn(markdown: string): boolean {
    return rawBlockEnd(markdown) !== "apart";
}

/**
 * Tells how a block's Markdown ends ({@link RawBlockEnd}): lexed with a
 * paragraph after it, one blank line between, whether that paragraph stays
 * its own; if not, whether it does with two blank lines between.
 *
 * @param markdown - The block's Markdown.
 * @returns How a following block stays apart from it, if one can.
 */
function rawBlockEnd(markdown: string): RawBlockEnd {
    const known = RUNS_ON.get(markdown);

    if (known !== undefined) {
        return known;
    }

    const result = !takesInProbe(markdown, BLOCK_SEPARATOR) ? "apart" : !takesInProbe(markdown, `${BLOCK_SEPARATOR}\n`) ? "wide" : "runsOn";

    if (RUNS_ON.size >= RUNS_ON_CACHE_SIZE) {
        RUNS_ON.clear();
    }

    RUNS_ON.set(markdown, result);

    return result;
}

/**
 * Tells whether a block's Markdown takes in a paragraph written after it:
 * lexed with a paragraph after it, that paragraph does not stay its own.
 *
 * @param markdown - The block's Markdown.
 * @param separator - What is written between the block and the paragraph.
 * @returns `true` when a following block would be read as part of it.
 */
function takesInProbe(markdown: string, separator: string): boolean {
    const tokens = lexMarkdown(markdown + separator + RUN_ON_PROBE).filter((token) => token.type !== "space");
    const last = tokens[tokens.length - 1];

    return last?.type !== "paragraph" || last.raw.trim() !== RUN_ON_PROBE;
}

/**
 * Serializes a heading: an ATX heading, whose trailing `#` run the heading
 * rule would strip as a closing sequence has its first `#` escaped; or, for
 * a level 1 or 2 heading whose content spans lines (a hard break, or the soft
 * breaks of a setext heading it was loaded from), a setext heading, the only
 * form whose content can span lines — unless one of its lines would end the
 * heading ({@link SETEXT_INTERRUPTING_LINE}), when it is written ATX, its
 * line breaks as spaces.
 *
 * @param node - The heading.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns `#`×level, then a space and the content when there is any; or the
 *   content's lines and a `===` / `---` underline.
 */
function serializeHeading(node: HeadingNode, definitions: Links | null): string {
    const level = Number(node.getTag().slice(1));

    if (level <= SETEXT_MAX_LEVEL) {
        const lines = serializeInline(node, { ...MULTI_LINE, definitions });

        if (lines.includes("\n") && !lines.split("\n").some((line) => SETEXT_INTERRUPTING_LINE.test(line))) {
            return `${lines}\n${level === 1 ? SETEXT_H1_UNDERLINE : SETEXT_H2_UNDERLINE}`;
        }
    }

    const content = serializeInline(node, { ...HEADING_LINE, definitions }).replace(/(^|[ \t])(#+)$/, "$1\\$2");

    return "#".repeat(level) + (content === "" ? "" : " " + content);
}

/**
 * Serializes a quote: every line of its content prefixed `> `.
 *
 * @param node - The quote.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The quoted lines, or `>` for an empty quote.
 */
function serializeQuote(node: QuoteNode, definitions: Links | null): string {
    const content = serializeInline(node, { ...MULTI_LINE, definitions });

    if (content === "") {
        return ">";
    }

    return content.split("\n").map((line) => (line === "" ? ">" : "> " + line)).join("\n");
}

/**
 * Serializes a fenced code block: a backtick fence, or a `~` one when the
 * info string holds a backtick (which a backtick fence's info string cannot),
 * longer than any run of the fence's character that starts one of its lines.
 * The info string is the one the block was loaded with
 * ({@link codeInfoState}) while its first word is still the block's
 * language, else the language.
 *
 * @param node - The code block.
 * @returns The fenced code.
 */
function serializeCode(node: CodeNode): string {
    const code = node.getTextContent();
    const language = node.getLanguage() ?? "";
    const authored = $getState(node, codeInfoState);
    const authoredLanguage = authored.replace(/\\([!-/:-@[-`{-~])/g, "$1").split(/\s+/)[0];
    const info = authored !== "" && authoredLanguage === language ? authored : language;
    const char = info.includes("`") ? "~" : "`";

    const longestRun = Math.max(0, ...code.split("\n").map((line) => {
        const run = CODE_LINE_FENCE_RUN.exec(line)?.[1] ?? "";

        return run.startsWith(char) ? run.length : 0;
    }));

    const fence = char.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestRun + 1));

    return fence + info + "\n" + (code === "" ? "" : code + "\n") + fence;
}

/**
 * Indents every non-empty line of `markdown` by `indent` (a blank line stays
 * empty, so no whitespace-only line is written).
 *
 * @param markdown - One or more lines.
 * @param indent - The indentation to prefix.
 * @returns The indented lines.
 */
function indentLines(markdown: string, indent: string): string[] {
    return markdown.split("\n").map((line) => (line === "" ? line : indent + line));
}

/**
 * Serializes a list with its authored marker. An item whose first child is a
 * list — Lexical's shape for a nested list, which it numbers and shows as
 * part of the item before it — adds its blocks to that item, indented by its
 * marker width plus one. A loose list separates its items with a blank line.
 *
 * @param list - The list.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param underText - Whether the list's first line follows a line of text in
 *   the same container: a bare `-` marker there would be a setext underline,
 *   so a `-` bullet list whose first line is a bare marker is written with `*`.
 * @param marker - The bullet or delimiter to write instead of the authored one.
 * @returns One line or more per item, joined by newlines.
 */
function serializeList(list: ListNode, definitions: Links | null, underText = false, marker?: string): string {
    const items: ItemBlock[][] = [];

    for (const item of list.getChildren().filter($isListItemNode)) {
        const continues = $isListNode(item.getFirstChild()) && items.length > 0;
        const blocks = continues ? items[items.length - 1]! : [];

        appendItemBlocks(item, blocks, definitions);

        if (!continues) {
            items.push(blocks);
        }
    }

    const loose = $getState(list, listLooseState);
    const markerOf = listMarkerWriter(list, underText && items[0]?.length === 0, marker);

    // A single-item list is loose only through a blank line inside its item:
    // between its text and its nested list.
    const nestedSeparated = loose && items.length === 1;

    return items
        .map((blocks, index) => listItemLines(markerOf(index), blocks, nestedSeparated).join("\n"))
        .join(loose ? LOOSE_ITEM_SEPARATOR : "\n");
}

/**
 * Appends a list item's blocks: each run of inline children as one block, and
 * each block child (a paragraph, a nested list, or any other block a command
 * put there) as its own. Empty blocks are dropped.
 *
 * @param item - The list item.
 * @param blocks - The blocks of the item it belongs to. Extended in place.
 * @param definitions - The saved document's link reference definitions, or `null`.
 */
function appendItemBlocks(item: ListItemNode, blocks: ItemBlock[], definitions: Links | null): void {
    let inline: LexicalNode[] = [];

    const push = (markdown: string, isList: boolean, isText: boolean, more?: Pick<ItemBlock, "marker" | "withMarker" | "isRaw" | "continuesText">): void => {
        if (markdown !== "") {
            blocks.push({ markdown, isList, isText, ...more });
        }
    };

    const flushInline = (): void => {
        push(serializeInlineNodes(inline, { ...MULTI_LINE, definitions, inListItem: true }), false, true);
        inline = [];
    };

    for (const child of item.getChildren()) {
        if (!$isElementNode(child) || child.isInline()) {
            inline.push(child);

            continue;
        }

        flushInline();

        if ($isListNode(child)) {
            const previous = blocks[blocks.length - 1];
            // A list of bare markers under text reads as more lines of that text, so a list after it is under text too.
            const underText = previous !== undefined && (!previous.isList || previous.continuesText === true);
            const markdown = serializeList(child, definitions, underText);

            push(markdown, true, false, {
                marker:        writtenListMarker(markdown),
                withMarker:    (marker) => serializeList(child, definitions, underText, marker),
                continuesText: underText && markdown.split("\n").every((line) => BARE_LIST_MARKER_LINE.test(line)),
            });
        } else {
            push(serializeBlock(child, definitions), false, $isParagraphNode(child), { isRaw: $isMarkdownRawBlockNode(child) });
        }
    }

    flushInline();
}

/**
 * The kinds of the blocks {@link appendItemBlocks} writes for a list item,
 * in order — each run of inline content holding something visible, and each
 * block child that writes something — without writing them.
 *
 * @param item - The list item.
 * @returns `"list"` for a nested list, `"text"` for inline content or a
 *   paragraph, `"block"` for anything else.
 */
function itemBlockKinds(item: ListItemNode): Array<"list" | "text" | "block"> {
    const kinds: Array<"list" | "text" | "block"> = [];
    let inline: LexicalNode[] = [];

    const flushInline = (): void => {
        if (holdsInlineContent(inline)) {
            kinds.push("text");
        }

        inline = [];
    };

    for (const child of item.getChildren()) {
        if (!$isElementNode(child) || child.isInline()) {
            inline.push(child);

            continue;
        }

        flushInline();

        // Definitions only choose how a reference link is written, never whether a block writes anything.
        if ($isListNode(child) ? child.getChildrenSize() > 0 : serializeBlock(child, null) !== "") {
            kinds.push($isListNode(child) ? "list" : $isParagraphNode(child) ? "text" : "block");
        }
    }

    flushInline();

    return kinds;
}

/**
 * Tells whether inline nodes write anything: an image, text other than
 * whitespace, a code span, or source other than whitespace — what
 * {@link withoutEdgeBreaks} counts as content; breaks and whitespace alone
 * write nothing.
 *
 * @param nodes - The inline nodes.
 * @returns `true` when they hold content.
 */
function holdsInlineContent(nodes: LexicalNode[]): boolean {
    return flattenInline(nodes).some((segment) => segment.kind === "image"
        || (segment.kind === "text" && (segment.code || /\S/.test(segment.text)))
        || (segment.kind === "source" && /\S/.test(segment.source)));
}

/**
 * Returns the writer of a list's item markers: its authored bullet, or its
 * numbers counted from its start with its authored delimiter — `-` and `.`
 * for a list made in the editor, or one whose marker is of the other type.
 *
 * @param list - The list.
 * @param bareUnderText - Whether the list's first line is a bare marker right
 *   under a line of text, where a bare `-` would be a setext underline: a `-`
 *   bullet list is then written with `*`.
 * @param marker - The bullet or delimiter to write instead of the authored one.
 * @returns The marker of the item at a given index.
 */
function listMarkerWriter(list: ListNode, bareUnderText: boolean, marker?: string): (index: number) => string {
    const markers = list.getListType() === "number" ? ORDERED_DELIMITERS : BULLET_MARKERS;
    const chosen = marker !== undefined && markers.includes(marker) ? marker : $writtenListMarker(list);

    if (list.getListType() !== "number") {
        const written = bareUnderText && chosen === SETEXT_H2_UNDERLINE[0] ? UNDER_TEXT_BULLET : chosen;

        return () => written;
    }

    return (index) => `${list.getStart() + index}${chosen}`;
}

/**
 * Writes one list item: its marker and its first block's first line, then the
 * rest indented under it. A nested list follows the item's own text — its
 * first block, a paragraph — or a nested list before it directly (after a
 * blank line in a loose single-item list); any other block follows a blank
 * line, so it is not read as a continuation of the block before it: a table
 * would read a nested list's lines as rows, and a paragraph after the item's
 * text would take in an ordered list that does not start at 1. An item whose
 * first block is a nested list starts it on the marker's line (`- - n`), as
 * a bare marker line can read as a table delimiter row in this dialect.
 *
 * @param marker - The item's marker (`-`, `3.`, …).
 * @param blocks - The item's blocks.
 * @param nestedSeparated - Whether a nested list follows a blank line.
 * @returns The item's lines.
 */
function listItemLines(marker: string, itemBlocks: readonly ItemBlock[], nestedSeparated: boolean): string[] {
    const indent = " ".repeat(marker.length + 1);
    const lines: string[] = [];
    const blocks = keepNestedListsApart(itemBlocks);

    blocks.forEach((block, index) => {
        const followsDirectly = (index === 1 && blocks[0]!.isText) || blocks[index - 1]?.isList === true;

        if (index > 0 && (!block.isList || nestedSeparated || !followsDirectly)) {
            lines.push("");
        }

        lines.push(...indentLines(block.markdown, indent));
    });

    if (lines.length === 0) {
        return [marker];
    }

    const first = `${marker} ${lines[0]!.slice(indent.length)}`;
    const nested = blocks[0]!;

    // An item opening with a nested list of empty items writes its markers on one line, which can read as a
    // thematic break (`- - -`): the nested list then takes the other bullet, which no break mixes.
    if (THEMATIC_BREAK.test(first) && nested.withMarker !== undefined && BULLET_MARKERS.includes(nested.marker!)) {
        const bullet = first.trimEnd().at(-1) === "*" ? "-" : "*";

        return listItemLines(marker, [{ ...nested, markdown: nested.withMarker(bullet), marker: bullet }, ...blocks.slice(1)], nestedSeparated);
    }

    return [first, ...lines.slice(1)];
}

/**
 * Writes each nested list of an item that would join the list next to it
 * with another bullet or delimiter of its type that keeps it apart: a nested
 * list written with the same marker right before it (the marker as written:
 * a bare `-` under text is written `*`), or a raw block next to it that
 * ends or starts with a list `marked` would join it to ({@link listsJoin}).
 * `marked` reads two such lists, with or without a blank line between them,
 * as one. With no marker that keeps it apart, the list keeps its own.
 *
 * @param blocks - An item's blocks.
 * @returns The blocks, those lists rewritten.
 */
function keepNestedListsApart(blocks: readonly ItemBlock[]): ItemBlock[] {
    const kept: ItemBlock[] = [];

    blocks.forEach((block, index) => {
        const previous = kept[kept.length - 1];
        const next = blocks[index + 1];
        // Markers compare as written: an empty first item under the item's text writes `-` as `*`.
        const joins = (markdown: string): boolean =>
            (previous?.isList === true && previous.marker === writtenListMarker(markdown))
            || (previous?.isRaw === true && listsJoin(previous.markdown, markdown))
            || (next?.isRaw === true && listsJoin(markdown, next.markdown));

        if (block.withMarker === undefined || !joins(block.markdown)) {
            kept.push(block);

            return;
        }

        const markers = ORDERED_DELIMITERS.includes(block.marker!) ? ORDERED_DELIMITERS : BULLET_MARKERS;
        const other = markers.find((candidate) => candidate !== block.marker && !joins(block.withMarker!(candidate)));
        const markdown = other === undefined ? block.markdown : block.withMarker(other);

        kept.push({ ...block, markdown, marker: writtenListMarker(markdown) });
    });

    return kept;
}

/**
 * Reads the bullet or ordered delimiter a list's Markdown is written with:
 * its first item's.
 *
 * @param markdown - The list's Markdown.
 * @returns The bullet or delimiter; `""` when the Markdown opens with none.
 */
function writtenListMarker(markdown: string): string {
    const match = WRITTEN_LIST_MARKER.exec(markdown);

    return match?.[1] ?? match?.[2] ?? "";
}

/**
 * Serializes a GFM pipe table: header row, delimiter row (alignment from the
 * header cells, widths from the table) and body rows, writing a cell's
 * column span as `<<` continuations and its row span as `^^` ones. A body
 * row wider than the header — an edit can leave one — widens the table with
 * empty header cells, since `marked` drops a cell beyond the header's
 * columns.
 *
 * @param table - The table.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The table's lines, or `""` for a table with no rows.
 */
function serializeTable(table: TableNode, definitions: Links | null): string {
    const rows = table.getChildren().filter($isTableRowNode);

    if (rows.length === 0) {
        return "";
    }

    const headerCells = rows[0]!.getChildren().filter($isTableCellNode);
    const columnCount = Math.max(headerCells.length, ...rows.slice(1).map((row) => rowWidth(row)));
    const padding = new Array<string>(columnCount - headerCells.length).fill("");
    const alignments = [...headerCells.map((cell) => cell.getFormatType()), ...padding as ElementFormatType[]];
    const pendingRowSpans = new Map<number, number>();

    const lines = [
        formatPipeRow([...headerCells.map((cell) => serializeTableCell(cell, definitions)), ...padding]),
        formatDelimiterRow(alignments, table.getColWidths() ?? []),
    ];

    for (const row of rows.slice(1)) {
        lines.push(formatPipeRow(serializeBodyRow(row, columnCount, pendingRowSpans, definitions)));
    }

    return lines.join("\n");
}

/**
 * The number of columns a row's own cells cover, their column spans
 * counted.
 *
 * @param row - The row.
 * @returns The columns its cells cover.
 */
function rowWidth(row: TableRowNode): number {
    return row.getChildren().filter($isTableCellNode).reduce((width, cell) => width + cell.getColSpan(), 0);
}

/**
 * Joins cell texts into one pipe row.
 *
 * @param cells - The cells' Markdown.
 * @returns The row line.
 */
function formatPipeRow(cells: string[]): string {
    return "| " + cells.join(" | ") + " |";
}

/**
 * Writes one body row's cell texts. A cell's `colSpan` writes that many `<<`
 * continuations after it; a `rowSpan` above 1 registers a pending `^^` for
 * the columns it covers, consumed one row at a time — the reverse of the
 * import-side merge grid.
 *
 * @param row - The body row.
 * @param columnCount - The table's column count (the header's cell count).
 * @param pendingRowSpans - Per column, how many more rows a span above still covers. Updated in place.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns One text per column.
 */
function serializeBodyRow(
    row: TableRowNode, columnCount: number, pendingRowSpans: Map<number, number>, definitions: Links | null,
): string[] {
    const cells = row.getChildren().filter($isTableCellNode);
    const texts: string[] = [];
    let cellIndex = 0;

    for (let column = 0; column < columnCount; column += 1) {
        const pending = pendingRowSpans.get(column) ?? 0;

        if (pending > 0) {
            texts.push("^^");
            pendingRowSpans.set(column, pending - 1);

            continue;
        }

        const cell = cells[cellIndex];

        cellIndex += 1;

        if (cell === undefined) {
            texts.push("");

            continue;
        }

        texts.push(serializeTableCell(cell, definitions));
        column = writeCellSpans(cell, column, texts, pendingRowSpans);
    }

    return texts;
}

/**
 * Writes a cell's column span as `<<` continuations and registers its row
 * span for the rows below.
 *
 * @param cell - The cell just written.
 * @param column - The cell's own column.
 * @param texts - The row's texts so far. Extended in place.
 * @param pendingRowSpans - The pending row spans. Updated in place.
 * @returns The last column the cell covers.
 */
function writeCellSpans(cell: TableCellNode, column: number, texts: string[], pendingRowSpans: Map<number, number>): number {
    const colSpan = cell.getColSpan();
    const rowSpan = cell.getRowSpan();
    const lastColumn = column + colSpan - 1;

    for (let covered = column + 1; covered <= lastColumn; covered += 1) {
        texts.push("<<");
    }

    if (rowSpan > 1) {
        for (let covered = column; covered <= lastColumn; covered += 1) {
            pendingRowSpans.set(covered, rowSpan - 1);
        }
    }

    return lastColumn;
}

/**
 * Serializes a table cell's paragraphs onto one line, joined by
 * {@link CELL_PARAGRAPH_BREAK}. An empty paragraph keeps its boundaries, so
 * the blank line the editor shows for it stays a break in the viewer, which
 * renders one `<br>` per boundary even at the cell's edges. A paragraph
 * opening with an emphasis delimiter is written after a space, since the
 * break ends in a letter the delimiter could not open against. A cell whose
 * whole text is a merge marker is escaped so it reads back as content.
 *
 * @param cell - The cell.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The cell's text for its pipe row.
 */
function serializeTableCell(cell: TableCellNode, definitions: Links | null): string {
    const text = cell.getChildren()
        .map((child) => serializeCellChild(child, definitions))
        .map((paragraph, index) => (index > 0 && /^[*_~]/.test(paragraph) ? " " + paragraph : paragraph))
        .join(CELL_PARAGRAPH_BREAK)
        .trim();

    return MERGE_MARKERS.has(text) ? "\\" + text : text;
}

/**
 * Serializes one child of a table cell as single-line inline content. A pipe
 * table's cell holds inline content only, so any other block a command nests
 * in a cell — a heading, quote or code block — is written as the inline
 * content the editor shows, and a list as each item's content on a line of
 * its own: their own syntax would show as literal text (`# t`) and read back
 * into the cell's text.
 *
 * @param child - The cell's child.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns Its text for the pipe row.
 */
function serializeCellChild(child: LexicalNode, definitions: Links | null): string {
    if (!$isListNode(child)) {
        return serializeInlineNodes($isElementNode(child) ? child.getChildren() : [child], { ...TABLE_CELL, definitions });
    }

    return child.getChildren().filter($isListItemNode).flatMap((item) => {
        const children = item.getChildren();
        const inline = children.filter((node) => !$isListNode(node));
        const lines = inline.length > 0 ? [serializeInlineNodes(inline, { ...TABLE_CELL, definitions })] : [];

        return [...lines, ...children.filter($isListNode).map((list) => serializeCellChild(list, definitions))];
    }).join(CELL_PARAGRAPH_BREAK);
}

/**
 * Serializes a `:::` fence: `columns` when it has two or more, its
 * attributes, and `{}` for a one-column fence with none (a bare `:::` cannot
 * open a fence).
 *
 * @param node - The fence.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The fence, or its children's blocks when it has no columns.
 */
function serializeFence(node: MarkdownBlockNode, definitions: Links | null): string {
    const columns = node.getColumns();

    if (columns.length === 0) {
        return serializeBlockList(node.getChildren(), definitions);
    }

    const attributes = fenceAttributeText(node);

    const opening = ":::"
        + (columns.length > 1 ? " columns" : "")
        + (attributes !== "" ? ` {${attributes}}` : columns.length > 1 ? "" : " {}");

    const body = joinColumnSections(columns.map((column) => serializeBlockList(column.getChildren(), definitions)));

    return `${opening}\n${body}\n:::`;
}

/**
 * Reads the attribute text a fence is written with: the authored text it was
 * loaded with ({@link fenceAttributesState}) while that text still resolves
 * to the fence's alignment and column gap — keeping the attributes' order and
 * the ones the editor does not model — else its style as normalized
 * attribute text.
 *
 * @param node - The fence.
 * @returns The attribute text (`align=right …`), or `""` for none.
 */
function fenceAttributeText(node: MarkdownBlockNode): string {
    const normalized = formatAttributes(node.toAttributes());
    const authored = $getState(node, fenceAttributesState);
    const writable = authored !== "" && !/[\n{}]/.test(authored);

    return writable && formatAttributes(blockStyleToAttributes(resolveBlockStyle(parseAttributes(authored)))) === normalized ? authored : normalized;
}

// ---------------------------------------------------------------- inline: flatten and group

/**
 * Serializes an element's inline content.
 *
 * @param element - The paragraph, heading, quote, list item or cell paragraph.
 * @param context - Where the content is written.
 * @returns The content; lines are separated by `\n` unless `context.singleLine`.
 */
function serializeInline(element: ElementNode, context: InlineContext): string {
    return serializeInlineNodes(element.getChildren(), context);
}

/**
 * Serializes a run of inline nodes. The Markdown is read back with the
 * viewer's own lexer: when its emphasis would read differently from what the
 * editor shows, the block is written by the next {@link WRITING_POLICIES}
 * policy, each with its bold and italic pairs switched between `*` and `_`
 * where that helps, and the first writing that reads back as written is
 * kept; with none, the first. A block with no mark, bare autolink or `~` —
 * nothing another writing could change — is written without the read-back,
 * and so is a block holding source whose reading is not known on its own
 * (source that does not lex as inline content). A block
 * holding a `~` is tried again with its lone tildes unescaped, and one
 * holding a `<` with every `<` escaped (a `<…>` stretch hides its
 * delimiters from `marked`'s emphasis pairing). Bare
 * autolinks are then written bare wherever that still reads the same, so
 * their source text — and a heading's id — survives.
 *
 * @param nodes - The inline nodes.
 * @param context - Where the content is written.
 * @returns The content; lines are separated by `\n` unless `context.singleLine`.
 */
function serializeInlineNodes(nodes: LexicalNode[], context: InlineContext): string {
    const segments = withoutEdgeBreaks(flattenInline(nodes), context);
    const holds = (char: string): boolean => segments.some((segment) => segment.kind === "text" && !segment.code && segment.text.includes(char));
    const tildes = holds("~");
    const written = writeInlinePieces(segments, context, WRITING_POLICIES[0]!);

    if (!tildes && !written.some((piece) => piece.kind === "delimiter" || piece.kind === "autolink")) {
        return assembleLines(written, context);
    }

    const intended = withoutTrailingWhitespace(segmentReading(segments, { ...context, readsWhitespace: true }));

    if (intended === null) {
        return assembleLines(written, context);
    }

    const readBack = createReadBack(intended, context);
    let first: string | null = null;

    const writings = tildes ? [context, { ...context, looseTildes: true }] : [context];

    for (const writing of holds("<") ? [...writings, ...writings.map((loose) => ({ ...loose, escapedAngles: true }))] : writings) {
        for (const policy of WRITING_POLICIES) {
            const pieces = writing === context && policy === WRITING_POLICIES[0] ? written : writeInlinePieces(segments, writing, policy);
            const switched = switchedPairs(pieces, writing, readBack);

            first ??= assembleLines(pieces, writing);

            if (switched !== null) {
                return assembleLines(pieces, writing, { switched, bare: bareAutolinks(pieces, writing, switched, readBack) });
            }

            if (readBack.spent()) {
                return first;
            }
        }
    }

    return first!;
}

/**
 * Writes a block's segments as pieces under one writing policy.
 *
 * @param segments - The block's segments.
 * @param context - Where the content is written.
 * @param policy - How marks are placed.
 * @returns The written pieces.
 */
function writeInlinePieces(segments: Segment[], context: InlineContext, policy: WritingPolicy): Piece[] {
    const writer: InlineWriter = {
        pieces: [], context, policy, stack: [], pending: [], pendingUnderline: false, inLink: false, openOrder: () => MARK_ORDER,
    };

    writeUnits(writer, groupSegments(segments), []);
    closeMarks(writer, 0);
    flushPending(writer);

    return writer.pieces;
}

/**
 * Finds which bold and italic pairs to switch between `*` and `_` so the
 * block reads back as the editor shows it: none when it already does, else,
 * greedily, the switch that reads furthest each round.
 *
 * @param pieces - The block's written pieces.
 * @param context - Where the content is written.
 * @param readBack - The block's read-back.
 * @returns The pairs to switch, or `null` when no switch makes the block read as written.
 */
function switchedPairs(pieces: Piece[], context: InlineContext, readBack: ReadBack): ReadonlySet<number> | null {
    const pairCount = pieces.filter((piece) => piece.kind === "delimiter" && piece.opens && UNDERSCORE_DELIMITERS[piece.mark] !== undefined).length;
    let switched: ReadonlySet<number> = new Set();
    let best = readBack.score(assembleLines(pieces, context));

    while (best !== Infinity && !readBack.spent()) {
        let next: { switched: ReadonlySet<number>; score: number } | null = null;

        for (let pair = 0; pair < pairCount && !readBack.spent(); pair += 1) {
            const candidate = new Set(switched);

            if (!candidate.delete(pair)) {
                candidate.add(pair);
            }

            const score = readBack.score(assembleLines(pieces, context, { switched: candidate, bare: NO_CHOICES.bare }));

            if (score > (next?.score ?? best)) {
                next = { switched: candidate, score };
            }
        }

        if (next === null) {
            return null;
        }

        switched = next.switched;
        best = next.score;
    }

    return best === Infinity ? switched : null;
}

/**
 * Picks the bare autolinks to write bare although their neighbours do not
 * visibly bound them: each one next to punctuation, not a letter or digit —
 * a bare URL run into a word would merge with it to the eye and to most
 * readers — whose bare form still reads back as the editor shows the block
 * (`<https://a.test>www.b.test`).
 *
 * @param pieces - The block's written pieces.
 * @param context - Where the content is written.
 * @param switched - The block's switched pairs.
 * @param readBack - The block's read-back.
 * @returns The autolink pieces to write bare.
 */
function bareAutolinks(pieces: Piece[], context: InlineContext, switched: ReadonlySet<number>, readBack: ReadBack): ReadonlySet<Piece> {
    const bare = new Set<Piece>();

    for (const [index, piece] of pieces.entries()) {
        const before = pieces[index - 1];
        const after = pieces[index + 1];

        if (piece.kind !== "autolink" || readBack.spent()
            || (before?.kind === "text" && WORD_CHARACTER.test(before.text.at(-1) ?? ""))
            || (after?.kind === "text" && WORD_CHARACTER.test(after.text[0] ?? ""))) {
            continue;
        }

        bare.add(piece);

        if (readBack.score(assembleLines(pieces, context, { switched, bare })) !== Infinity) {
            bare.delete(piece);
        }
    }

    return bare;
}

/**
 * Creates a block's read-back, which caches each scored Markdown.
 *
 * @param intended - The block's reading, as the editor shows it.
 * @param context - Where the content is written.
 * @returns The read-back.
 */
function createReadBack(intended: readonly string[], context: InlineContext): ReadBack {
    const scores = new Map<string, number>();
    let readBacks = 0;

    return {
        score(markdown: string): number {
            const cached = scores.get(markdown);

            if (cached !== undefined) {
                return cached;
            }

            readBacks += 1;

            const score = readingScore(withoutTrailingWhitespace(markdownReading(markdown, { ...context, readsWhitespace: true })), intended);

            scores.set(markdown, score);

            return score;
        },
        spent: () => readBacks >= MAX_READ_BACKS,
    };
}

/**
 * Scores a reading against the intended one.
 *
 * @param reading - The Markdown's reading, or `null` when it did not lex as the block.
 * @param intended - The block's reading, as the editor shows it.
 * @returns The number of leading units that match, or `Infinity` when the readings are equal.
 */
function readingScore(reading: readonly string[] | null, intended: readonly string[]): number {
    if (reading === null) {
        return 0;
    }

    const mismatch = intended.findIndex((unit, index) => reading[index] !== unit);

    if (mismatch !== -1) {
        return mismatch;
    }

    return reading.length === intended.length ? Infinity : intended.length;
}

/**
 * Flattens inline nodes and their descendants into segments, descending into
 * links and other inline elements, and merges adjacent text segments that
 * share their formatting — code segments into one code span — so a text
 * split into several nodes of one format is written as one node is (Lexical
 * joins such nodes only when it commits an update).
 *
 * @param nodes - The inline nodes.
 * @param asShown - Whether to keep each text node's characters with its own
 *   marks and style, as the editor shows them, rather than moving a `+` out
 *   of underline and a bracket out of a styled span, as the writer must.
 * @returns The segments, in document order.
 */
function flattenInline(nodes: LexicalNode[], asShown = false): Segment[] {
    const segments: Segment[] = [];

    appendSegments(nodes, null, segments, asShown);

    const kept = keepIntactNestedLinks(keepIntactKeptSource(segments));

    return (asShown ? kept : canonicalWhitespaceMarks(kept)).reduce<Segment[]>((merged, segment) => {
        const last = merged[merged.length - 1];

        if (last?.kind === "text" && segment.kind === "text" && last.code === segment.code && sameFormatting(last, segment)) {
            merged[merged.length - 1] = { ...last, text: last.text + segment.text };
        } else {
            merged.push(segment);
        }

        return merged;
    }, []);
}

/**
 * Settles the marks the editor does not draw on whitespace — bold and
 * italic — on the whitespace at a link's or styled span's edge, to the ones
 * the characters on both sides of it share. The writer leaves whitespace at
 * a run's edge outside its delimiters, and at a group's edge it cannot keep
 * a run open across the group's brackets, so a save read back can carry
 * those marks otherwise on such whitespace while it reads the same; and
 * whether a link or styled span carries a mark whole decides where that mark
 * is written ({@link commonMarks}). Settled, both forms are written alike,
 * and a save loaded and saved again is unchanged. Whitespace away from a
 * group's edge is written as it is marked, and whitespace with an image, a
 * break or the edge of the content on either side keeps its marks.
 *
 * @param segments - The flattened segments.
 * @returns The segments, edge whitespace split off where it is settled.
 */
function canonicalWhitespaceMarks(segments: readonly Segment[]): Segment[] {
    const pieces = segments.flatMap(splitEdgeWhitespace);

    return pieces.map((piece, index) => {
        if (piece.kind !== "text" || !isWhitespaceText(piece)) {
            return piece;
        }

        const before = neighbourText(pieces, index, -1);
        const after = neighbourText(pieces, index, 1);
        const atGroupEdge = (neighbour: TextSegment): boolean => neighbour.link !== piece.link || neighbour.style !== piece.style;

        if (before === null || after === null || !(atGroupEdge(before) || atGroupEdge(after))) {
            return piece;
        }

        const settled = (mark: Mark): boolean => (UNDRAWN_ON_WHITESPACE.includes(mark)
            ? before.marks.includes(mark) && after.marks.includes(mark)
            : piece.marks.includes(mark));

        return { ...piece, marks: MARK_ORDER.filter(settled) };
    });
}

/**
 * Splits a text segment's leading and trailing whitespace off into segments
 * of their own, with its formatting; a code segment, or any other, is kept
 * whole.
 *
 * @param segment - The segment.
 * @returns The segment's pieces, in order.
 */
function splitEdgeWhitespace(segment: Segment): Segment[] {
    if (segment.kind !== "text" || segment.code) {
        return [segment];
    }

    const [, leading, core, trailing] = /^(\s*)(.*?)(\s*)$/s.exec(segment.text)!;

    return [leading!, core!, trailing!].filter((text) => text !== "").map((text) => ({ ...segment, text }));
}

/**
 * Tells whether a text segment is whitespace only, outside a code span.
 *
 * @param segment - The text segment.
 * @returns `true` when it is.
 */
function isWhitespaceText(segment: TextSegment): boolean {
    return !segment.code && !/\S/.test(segment.text);
}

/**
 * Finds the nearest text with a visible character on one side of a piece,
 * past whitespace.
 *
 * @param pieces - The pieces.
 * @param index - The piece's index.
 * @param step - `-1` to look before it, `1` after.
 * @returns The text segment, or `null` when an image, a break or the edge of
 *   the content comes first.
 */
function neighbourText(pieces: readonly Segment[], index: number, step: -1 | 1): TextSegment | null {
    for (let at = index + step; at >= 0 && at < pieces.length; at += step) {
        const piece = pieces[at]!;

        if (piece.kind !== "text") {
            return null;
        }

        if (!isWhitespaceText(piece)) {
            return piece;
        }
    }

    return null;
}

/**
 * Tells whether two text segments carry the same marks, style and link.
 *
 * @param a - One segment.
 * @param b - The other.
 * @returns `true` when all three match.
 */
function sameFormatting(a: TextSegment, b: TextSegment): boolean {
    return a.style === b.style && a.link === b.link && a.marks.join() === b.marks.join();
}

/**
 * Appends the segments of `nodes` and their inline descendants.
 *
 * @param nodes - The inline nodes.
 * @param link - The link they sit in, or `null`.
 * @param segments - The list to append to.
 * @param asShown - Whether to keep text as shown ({@link flattenInline}).
 */
function appendSegments(nodes: LexicalNode[], link: LinkNode | null, segments: Segment[], asShown: boolean): void {
    for (const node of nodes) {
        if ($isLinkNode(node)) {
            appendSegments(node.getChildren(), node, segments, asShown);
        } else if ($isLineBreakNode(node)) {
            segments.push(keptLeafSegment({ kind: "break", marker: $getState(node, hardBreakMarkerState), link }, node));
        } else if ($isMarkdownImageNode(node)) {
            segments.push(keptLeafSegment({ kind: "image", node, link }, node));
        } else if ($isMarkdownSourceTextNode(node) && $getState(node, keptSourceState) === null && node.hasFormat("code") && !/\S/.test(node.getSource())) {
            // A soft break inside a code span shows as the span's space; written as one, it stays in the span.
            segments.push({ kind: "text", text: " ", marks: MARK_ORDER.filter((mark) => node.hasFormat(MARK_FORMATS[mark])), code: true, style: spanAttributeText(node), link });
        } else if ($isMarkdownSourceTextNode(node)) {
            segments.push(sourceSegment(node, link));
        } else if ($isTextNode(node)) {
            segments.push(...textNodeSegments(node, link, asShown));
        } else if ($isElementNode(node)) {
            appendSegments(node.getChildren(), link, segments, asShown);
        } else {
            segments.push({ kind: "text", text: node.getTextContent(), marks: [], code: false, style: "", link });
        }
    }
}

/**
 * Turns a text node into segments: a hard break, with the default marker,
 * for each newline in its text — the editor's surface (`white-space:
 * pre-wrap`) shows that newline as a line break — and the segments of the
 * lines between.
 *
 * @param node - The text node.
 * @param link - The link it sits in, or `null`.
 * @param asShown - Whether to keep its text as shown ({@link flattenInline}).
 * @returns Its segments; none for empty text.
 */
function textNodeSegments(node: TextNode, link: LinkNode | null, asShown = false): Segment[] {
    const marks = MARK_ORDER.filter((mark) => node.hasFormat(MARK_FORMATS[mark]));
    const base: TextSegment = { kind: "text", text: "", marks, code: node.hasFormat("code"), style: spanAttributeText(node), link };

    return node.getTextContent().split("\n").flatMap((line, index): Segment[] => [
        ...(index > 0 ? [{ kind: "break", marker: hardBreakMarkerState.defaultValue, link } as const] : []),
        ...(asShown ? (line === "" ? [] : [{ ...base, text: line }]) : textSegments(line, base)),
    ]);
}

/**
 * Turns one line of a text node into segments. Styled text is split at `[`
 * and `]`, which go outside the span (its grammar cannot hold them), and
 * underlined text at `+`, which goes outside the underline (likewise).
 *
 * @param line - The line's text.
 * @param base - The node's segment, its text empty.
 * @returns Its segments; none for empty text.
 */
function textSegments(line: string, base: TextSegment): TextSegment[] {
    const marks = base.marks;
    const separators = (base.style !== "" ? "[]" : "") + (marks.includes("underline") ? "+" : "");
    const segments: TextSegment[] = [];
    let current = "";

    for (const char of line) {
        if (!separators.includes(char)) {
            current += char;

            continue;
        }

        segments.push({ ...base, text: current });

        segments.push(char === "+"
            ? { ...base, text: char, marks: marks.filter((mark) => mark !== "underline") }
            : { ...base, text: char, style: "" });

        current = "";
    }

    segments.push({ ...base, text: current });

    return segments.filter((segment) => segment.text !== "");
}

/**
 * Turns a source node into its segment: its source, marks and style. A run
 * of a link nested in a link ({@link nestedLinkState}) writes that link
 * itself, so it is written outside the link node it sits in, with only the
 * marks and style its source does not write; so does a run of a kept
 * construct ({@link keptSourceState}), whose segment also carries its member
 * record for {@link keepIntactKeptSource}.
 *
 * @param node - The source node.
 * @param link - The link it sits in, or `null`.
 * @returns The segment.
 */
function sourceSegment(node: MarkdownSourceTextNode, link: LinkNode | null): SourceSegment {
    const kept = $getState(node, keptSourceState);
    const written = kept?.writes ?? $getState(node, nestedLinkState);
    const nested = kept === null && written !== -1;
    const writtenBySource = (mark: Mark): boolean => (kept !== null || nested) && (written & TEXT_TYPE_TO_FORMAT[MARK_FORMATS[mark]]) !== 0;
    const marks = MARK_ORDER.filter((mark) => node.hasFormat(MARK_FORMATS[mark]) && !writtenBySource(mark));
    const writesStyle = (written & (kept === null ? NESTED_LINK_WRITES_STYLE : KEPT_SOURCE_WRITES_STYLE)) !== 0;
    const style = (kept !== null || nested) && writesStyle ? "" : spanAttributeText(node);
    const shows = node.getTextContentSize() > 0;

    if (kept !== null) {
        const member: KeptMember = { kept, source: node.getSource(), shown: textNodeSegments(node, link), intact: true };

        return { kind: "source", source: node.getSource(), shows, marks, style, link: keptLink(kept, link), member };
    }

    if (!nested) {
        const shortcut = SHORTCUT_REFERENCE_SOURCE.test(node.getSource()) && node.getTextContent() !== node.getSource();

        return { kind: "source", source: node.getSource(), shows, marks, style, link, ...(shortcut ? { shortcut } : {}) };
    }

    const group = $getState(node, nestedLinkGroupState);

    return { kind: "source", source: node.getSource(), shows, marks, style, link: null, nested: { shown: textNodeSegments(node, link), group } };
}

/**
 * Marks an image or line break that is a run of a kept construct
 * ({@link keptSourceState}) with its member record; any other is returned
 * as it is.
 *
 * @param segment - The leaf's segment.
 * @param node - The image or line break node.
 * @returns The segment, with its member record when it is a kept run.
 */
function keptLeafSegment<T extends Extract<Segment, { kind: "image" | "break" }>>(segment: T, node: LexicalNode): T {
    const kept = $getState(node, keptSourceState);

    if (kept === null) {
        return segment;
    }

    const intact = segment.kind !== "image" || kept.shown === keptImageShown(segment.node);
    const member: KeptMember = { kept, source: kept.source, shown: [{ ...segment }], intact };

    return { ...segment, link: keptLink(kept, segment.link), member };
}

/**
 * The link a kept run is written inside: the link node it sits in, unless
 * that link is the construct's own, which its source writes.
 *
 * @param kept - The run's state.
 * @param link - The link node it sits in, or `null`.
 * @returns The link to write it in, or `null`.
 */
function keptLink(kept: KeptSource, link: LinkNode | null): LinkNode | null {
    return (kept.writes & KEPT_SOURCE_WRITES_LINK) !== 0 ? null : link;
}

/**
 * What an image showed, for {@link KeptSource.shown}: its source, alt text
 * and size. A kept construct is written as its source only while its image
 * still shows the same. Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @param node - The image.
 * @returns A key of what it shows.
 */
export function keptImageShown(node: MarkdownImageNode): string {
    return JSON.stringify([node.getSrc(), node.getAlt(), node.getImageWidth(), node.getImageHeight()]);
}

/**
 * The member record of a kept construct's run, when a segment is one.
 *
 * @param segment - The segment.
 * @returns Its record, or `undefined`.
 */
function memberOf(segment: Segment): KeptMember | undefined {
    return segment.kind === "text" ? undefined : segment.member;
}

/**
 * Writes each kept construct ({@link keptSourceState}) whose runs all stand
 * together, in order and as loaded, as one source segment — their sources
 * joined, byte for byte, with the formatting outside the construct around
 * them — and the runs of any other (an edit took some away, or changed an
 * image in it) as what they show, so the save reads as the editor shows it.
 *
 * @param segments - A block's segments, in order.
 * @returns The segments, kept constructs joined.
 */
function keepIntactKeptSource(segments: Segment[]): Segment[] {
    const resolved: Segment[] = [];

    for (let index = 0; index < segments.length;) {
        const member = memberOf(segments[index]!);

        if (member === undefined) {
            resolved.push(segments[index]!);
            index += 1;

            continue;
        }

        const run = keptRun(segments, index);

        resolved.push(...(wholeKeptConstruct(run) ? [joinedKeptConstruct(run)] : run.flatMap((segment) => memberOf(segment)!.shown)));
        index += run.length;
    }

    return resolved;
}

/**
 * The run of consecutive segments of one kept construct starting at
 * `start`, each the next run of it.
 *
 * @param segments - A block's segments.
 * @param start - The index of a kept run's segment.
 * @returns The segments, at least the first.
 */
function keptRun(segments: readonly Segment[], start: number): Segment[] {
    const first = memberOf(segments[start]!)!.kept;
    const run = [segments[start]!];

    for (let next = segments[start + run.length]; next !== undefined && memberOf(next) !== undefined; next = segments[start + run.length]) {
        const kept = memberOf(next)!.kept;

        if (kept.group !== first.group || kept.index !== first.index + run.length) {
            break;
        }

        run.push(next);
    }

    return run;
}

/**
 * Tells whether a run of a kept construct's segments is the whole
 * construct as loaded: every run, from the first, each still showing what
 * it did, with one formatting outside the construct around them all.
 *
 * @param run - The segments, from {@link keptRun}.
 * @returns `true` when its sources can be written joined.
 */
function wholeKeptConstruct(run: readonly Segment[]): boolean {
    const first = memberOf(run[0]!)!.kept;
    const outside = (segment: Segment): string => (segment.kind === "source"
        ? JSON.stringify([segment.marks, segment.style, segment.link?.getKey() ?? null])
        : JSON.stringify(segment.link?.getKey() ?? null));
    const sources = run.filter((segment) => segment.kind === "source");
    const links = new Set(run.map((segment) => segment.link?.getKey() ?? null));

    return first.index === 0 && run.length === first.size && run.every((segment) => memberOf(segment)!.intact)
        && new Set(sources.map(outside)).size <= 1 && links.size === 1;
}

/**
 * Joins a whole kept construct's segments into one source segment.
 *
 * @param run - The segments, a whole construct.
 * @returns The source segment: the runs' sources joined, inside the
 *   formatting outside the construct, reading as what the runs show.
 */
function joinedKeptConstruct(run: readonly Segment[]): SourceSegment {
    const text = run.find((segment): segment is SourceSegment => segment.kind === "source");

    return {
        kind:   "source",
        source: run.map((segment) => memberOf(segment)!.source).join(""),
        shows:  run.some((segment) => segment.kind !== "source" || segment.shows),
        marks:  text?.marks ?? [],
        style:  text?.style ?? "",
        link:   run[0]!.link,
        kept:   { shown: run.flatMap((segment) => memberOf(segment)!.shown) },
    };
}

/**
 * Keeps each run of nested-link source segments ({@link nestedLinkState})
 * written as its source only while it still forms whole links: an edit can
 * delete some of a split link's runs, type between them, or split its
 * paragraph inside it, leaving source that no longer reads as a link. Such a
 * run is written as what it shows instead — its text with its marks, style
 * and the link it sits in — each stretch of one outer link's runs wrapped in
 * that outer link again ({@link nestedLinkGroupState}), so the save reads as
 * the editor shows it and the outer destination is kept.
 *
 * @param segments - A block's segments, in order.
 * @returns The segments, broken nested-link runs replaced by their text.
 */
function keepIntactNestedLinks(segments: Segment[]): Segment[] {
    const kept: Segment[] = [];
    let run: SourceSegment[] = [];

    const flush = (): void => {
        const source = run.map((segment) => segment.source).join("");
        const intact = run.length === 0 || formsWholeLinks(source);

        kept.push(...(intact ? run : rewrapNestedLinkRuns(run)));
        run = [];
    };

    for (const segment of segments) {
        if (segment.kind === "source" && segment.nested !== undefined) {
            run.push(segment);
        } else {
            flush();
            kept.push(segment);
        }
    }

    flush();

    return kept;
}

/**
 * Writes broken nested-link runs as what they show, each stretch of runs
 * from one outer link wrapped in that link's own syntax again: `[`, the
 * runs' text inside their inner links, then the outer link's closing syntax.
 *
 * @param run - Consecutive nested-link source segments.
 * @returns The segments to write instead.
 */
function rewrapNestedLinkRuns(run: SourceSegment[]): Segment[] {
    const written: Segment[] = [];
    const syntax = (text: string): SourceSegment => ({ kind: "source", source: text, shows: true, marks: [], style: "", link: null });

    runsOf(run, (segment) => segment.nested?.group?.id ?? null).forEach((stretch) => {
        const group = stretch[0]!.nested?.group ?? null;
        const shown = stretch.flatMap((segment) => segment.nested?.shown ?? []);

        written.push(...(group === null || shown.length === 0 ? shown : [syntax("["), ...shown, syntax(group.close)]));
    });

    return written;
}

/**
 * Tells whether Markdown reads as nothing but whole links, one after
 * another — with the document's link reference definitions in force when it
 * does not without them, since an outer link written as a reference
 * (`[[a](/in)][label]`) reads as one only with its definition. Must run
 * inside an `editor.read` or `editor.update`.
 *
 * @param source - The Markdown.
 * @returns `true` when it lexes to link tokens alone, together its whole text.
 */
function formsWholeLinks(source: string): boolean {
    const whole = (blocks: Token[]): boolean => {
        const tokens = blocks[0]?.type === "paragraph" ? (blocks[0] as Tokens.Paragraph).tokens : [];

        return tokens.length > 0 && tokens.every((token) => token.type === "link") && tokens.map((token) => token.raw).join("") === source;
    };

    return whole(lexMarkdown(source)) || whole(lexMarkdownWithDefinitions(source, lexMarkdownLinkDefinitions($definitionsSource())));
}

/**
 * Reads the attribute text a text node's span is written with: the authored
 * text of the span it was loaded from ({@link spanAttributesState}) while
 * that text still resolves to the node's style — keeping the attributes'
 * order and the ones the editor does not model — else the node's style as
 * normalized attribute text, the same pipeline the source mode uses.
 *
 * @param node - The text node.
 * @returns The attribute text (`color=red …`), or `""` when unstyled.
 */
function spanAttributeText(node: TextNode): string {
    const css = node.getStyle();
    const normalized = css === "" ? "" : normalizedAttributes(cssTextToAttributes(css));
    const authored = $getState(node, spanAttributesState);
    const writable = authored !== "" && !/[\n|{}]/.test(authored);

    return writable && normalizedAttributes(parseAttributes(authored)) === normalized ? authored : normalized;
}

/**
 * Normalizes span attributes: the style they resolve to, written back as
 * attribute text in the fixed order, unknown and invalid ones dropped.
 *
 * @param attributes - The attribute record.
 * @returns The normalized attribute text, or `""` for no style.
 */
function normalizedAttributes(attributes: Record<string, string>): string {
    return formatAttributes(spanStyleToAttributes(resolveSpanStyle(attributes)));
}

/**
 * Drops the line breaks the block cannot hold. CommonMark reads no hard
 * break after a block's last content — a trailing `\` is a literal
 * backslash, trailing spaces are stripped — so every break with no content
 * after it is dropped; one before the first content is a hard break after an
 * empty line, which a paragraph, quote or list item can open with, so it is
 * kept there, and dropped in a heading, whose breaks are spaces. A table
 * cell keeps them all: the viewer renders its cell break at either edge. A
 * break ending a link's text is moved after the link. A source segment of
 * whitespace only (a soft break) with no content before it, or none after
 * it, is dropped: it is whitespace at the block's edge.
 *
 * @param segments - The block's segments.
 * @param context - Where the block's content is written.
 * @returns The segments the block can write.
 */
function withoutEdgeBreaks(segments: Segment[], context: InlineContext): Segment[] {
    if (context.inTableCell) {
        return segments;
    }

    const hasContent = (segment: Segment): boolean =>
        segment.kind === "image"
        || (segment.kind === "text" && (segment.code || /\S/.test(segment.text)))
        || (segment.kind === "source" && /\S/.test(segment.source));

    const isBreak = (segment: Segment): boolean =>
        segment.kind === "break" || (segment.kind === "source" && !/\S/.test(segment.source));

    const first = segments.findIndex(hasContent);
    const last = segments.findLastIndex(hasContent);

    return segments
        .filter((segment, index) => {
            if (segment.kind === "break") {
                return index < last && (index > first || !context.singleLine);
            }

            return !isBreak(segment) || (first !== -1 && index > first && index < last);
        })
        .map((segment, index, kept) => (segment.kind === "break" && segment.link !== null && !endsInLink(kept, index)
            ? { ...segment, link: null }
            : segment));
}

/**
 * Tells whether content follows a segment inside its link. `marked` reads no
 * hard break at the end of link text, so a break with none after it there is
 * written after the link, where it still breaks the line.
 *
 * @param segments - The block's segments.
 * @param index - The segment's index.
 * @returns `true` when a later segment of the same link holds visible content.
 */
function endsInLink(segments: readonly Segment[], index: number): boolean {
    const link = segments[index]!.link;

    for (let next = index + 1; next < segments.length && segments[next]!.link === link; next += 1) {
        const segment = segments[next]!;

        if (segment.kind === "image" || (segment.kind === "text" && (segment.code || /\S/.test(segment.text)))
            || (segment.kind === "source" && /\S/.test(segment.source))) {
            return true;
        }
    }

    return false;
}

/**
 * Splits `items` into runs of consecutive items with an equal key.
 *
 * @param items - The items.
 * @param keyOf - Each item's key.
 * @returns The runs, in order.
 */
function runsOf<T, K>(items: T[], keyOf: (item: T) => K): T[][] {
    const runs: T[][] = [];

    for (const item of items) {
        const last = runs[runs.length - 1];

        if (last !== undefined && keyOf(last[0]!) === keyOf(item)) {
            last.push(item);
        } else {
            runs.push([item]);
        }
    }

    return runs;
}

/**
 * Groups segments by link, and within a link (or outside any) by span style.
 *
 * @param segments - A block's segments.
 * @returns The units the writer walks.
 */
function groupSegments(segments: Segment[]): Unit[] {
    return runsOf(segments, (segment) => segment.link).flatMap((run): Unit[] => {
        const link = run[0]!.link;

        return link === null ? groupStyles(run) : [{ kind: "link", link, units: groupStyles(run) }];
    });
}

/**
 * Groups consecutive styled text and source segments with the same style;
 * images and breaks end a style group, and so does a source segment holding
 * a bracket, which the span's grammar cannot hold.
 *
 * @param segments - Segments with one link.
 * @returns The segments, styled runs grouped.
 */
function groupStyles(segments: Segment[]): Array<Segment | StyleGroup> {
    const styleOf = (segment: Segment): string => {
        if (segment.kind === "source") {
            return /[[\]]/.test(segment.source) ? "" : segment.style;
        }

        return segment.kind === "text" ? segment.style : "";
    };

    return runsOf(segments, styleOf).flatMap((run): Array<Segment | StyleGroup> => {
        const style = styleOf(run[0]!);

        return style === "" ? run : [{ kind: "style", style, units: run }];
    });
}

// ---------------------------------------------------------------- inline: write

/**
 * Writes units at one group level.
 *
 * @param writer - The writer.
 * @param units - The units.
 * @param inherited - The marks open at enclosing group levels, which every unit here carries.
 */
function writeUnits(writer: InlineWriter, units: readonly Unit[], inherited: readonly Mark[]): void {
    units.forEach((unit, index) => {
        writer.openOrder = () => policyOrder(writer.policy, openingOrder(units, index));

        if (unit.kind === "link" || unit.kind === "style") {
            writeGroup(writer, unit, inherited);
        } else {
            writeSegment(writer, unit, inherited, units[index + 1]);
        }
    });
}

/**
 * The order to open marks in before `units[index]`: a mark carried on across
 * whitespace at a unit boundary — where a mark the next unit lacks closes —
 * outermost, the one carried furthest first; the others in the fixed order.
 * The mark that runs on thereby stays open when the shorter one closes before
 * the whitespace, so the whitespace keeps it (`++*4* 6++`, not
 * `*++4++* ++6++`). Underline, which holds the whitespace at its own edges,
 * opens outside the marks that end with the unit when the unit's text starts
 * or ends with whitespace (`++*a* ++b`). Between letters the fixed order is
 * kept: there, opening a different mark outermost only moves where
 * delimiters meet mid-word.
 *
 * @param units - The units at one group level.
 * @param index - The index of the unit about to be written.
 * @returns The marks, outermost first.
 */
function openingOrder(units: readonly Unit[], index: number): Mark[] {
    const rank = (mark: Mark): number => {
        let end = index;
        let acrossWhitespace = false;

        while (end < units.length && unitCarries(units[end]!, mark)) {
            acrossWhitespace ||= end > index && (unitEdge(units[end - 1]!, "end") || unitEdge(units[end]!, "start"));
            end += 1;
        }

        const holdsEdgeWhitespace = mark === "underline" && end > index
            && (unitEdge(units[index]!, "start") || unitEdge(units[index]!, "end"));

        return acrossWhitespace ? end - index : holdsEdgeWhitespace ? 1 : 0;
    };

    return MARK_ORDER.slice().sort((a, b) => rank(b) - rank(a));
}

/**
 * Applies a writing policy to an opening order: its fixed rank, when it has
 * one, or underline moved outermost.
 *
 * @param policy - The writing policy.
 * @param order - The opening order the stack rules chose.
 * @returns The order to open marks in, outermost first.
 */
function policyOrder(policy: WritingPolicy, order: readonly Mark[]): readonly Mark[] {
    if (policy.rank !== null) {
        return policy.rank;
    }

    return policy.underlineOutermost ? ["underline", ...order.filter((mark) => mark !== "underline")] : order;
}

/**
 * Tells whether a unit's text starts or ends with whitespace.
 *
 * @param unit - The unit.
 * @param edge - Which edge to read.
 * @returns `true` for a text or source segment, or a group whose edge
 *   segment is one, with whitespace (a soft break's newline included) at that
 *   edge.
 */
function unitEdge(unit: Unit, edge: "start" | "end"): boolean {
    if (unit.kind === "link" || unit.kind === "style") {
        const inner = edge === "start" ? unit.units[0] : unit.units[unit.units.length - 1];

        return inner !== undefined && unitEdge(inner, edge);
    }

    const text = unit.kind === "source" ? unit.source : unit.kind === "text" && !unit.code ? unit.text : "";

    return /\s/.test((edge === "start" ? text[0] : text.at(-1)) ?? "");
}

/**
 * Tells whether a unit carries a mark: a text or source segment that has it,
 * or a group every segment of which does.
 *
 * @param unit - The unit.
 * @param mark - The mark.
 * @returns `true` when the mark covers the whole unit.
 */
function unitCarries(unit: Unit, mark: Mark): boolean {
    if (unit.kind === "link" || unit.kind === "style") {
        return unit.units.every((inner) => unitCarries(inner, mark));
    }

    return (unit.kind === "text" || unit.kind === "source") && unit.marks.includes(mark);
}

/**
 * Writes one segment, first closing and opening marks to match it. A break
 * carries no marks, and neither does an image, which is written inside the
 * marks {@link imageMarks} chooses so whitespace on either side of it keeps
 * them.
 *
 * @param writer - The writer.
 * @param segment - The segment.
 * @param inherited - The marks open at enclosing group levels.
 * @param next - The unit after it at this level, or `undefined` at the end.
 */
function writeSegment(writer: InlineWriter, segment: Segment, inherited: readonly Mark[], next: Unit | undefined): void {
    if (segment.kind === "text") {
        writeTextSegment(writer, segment, segment.marks.filter((mark) => !inherited.includes(mark)));

        return;
    }

    if (segment.kind === "source") {
        const own = segment.marks.filter((mark) => !inherited.includes(mark));

        writeSourceSegment(writer, segment, segment.shows ? own : invisibleRunMarks(writer, own, next));

        return;
    }

    syncMarks(writer, segment.kind === "image" ? imageMarks(writer, inherited, next) : [], "");

    writer.pieces.push(segment.kind === "image"
        ? { kind: "syntax", text: writeImage(segment.node, writer.context) }
        : writeBreak(segment.marker, writer.context));
}

/**
 * The marks to have open around an image. After whitespace held inside open
 * marks, those stay open when what follows lets a delimiter close right after
 * the image's `)` (`~~, ![](g)~~`). Before text that starts with whitespace,
 * the marks that text carries stay open, or open before the image's `!` —
 * where an opening delimiter can stand, after whitespace, punctuation or a
 * line edge, or anywhere for underline, whose grammar has no flanking rule —
 * so that whitespace keeps them (`~~![](g) 2~~`).
 *
 * @param writer - The writer.
 * @param inherited - The marks open at enclosing group levels.
 * @param next - The unit after the image, or `undefined` at the end.
 * @returns The marks, in no particular order.
 */
function imageMarks(writer: InlineWriter, inherited: readonly Mark[], next: Unit | undefined): Mark[] {
    const kept = writer.pending.length > 0 && closesAfterPunctuation(next) ? writer.stack.slice() : [];
    const leadsWithSpace = next?.kind === "text" && !next.code && /^\s+\S/.test(next.text);
    const carried = leadsWithSpace ? next.marks.filter((mark) => !inherited.includes(mark)) : [];
    const staying = writer.stack.filter((mark) => kept.includes(mark) || carried.includes(mark));
    const closes = staying.length < writer.stack.length;

    const opens = carried.filter((mark) => !writer.stack.includes(mark) && (mark === "underline"
        || writer.pending.length > 0 || closes || opensBeforePunctuation(writer.pieces.at(-1), MARK_DELIMITERS[mark])));

    return [...staying, ...opens];
}

/**
 * The marks to have around a source run that shows nothing (an empty link,
 * an image the viewer rejects): a mark it carries is shown on nothing, so it
 * is written only where its delimiters pair around the run's punctuation —
 * open already or able to open before it, and staying open after it or able
 * to close there. Anywhere else (`a*[]()*`, after a letter) the delimiters
 * would read as literal text, so the mark is left off, which changes nothing
 * shown.
 *
 * @param writer - The writer.
 * @param own - The marks the run carries beyond the inherited ones.
 * @param next - The unit after the run, or `undefined` at the end.
 * @returns The marks to write around it.
 */
function invisibleRunMarks(writer: InlineWriter, own: readonly Mark[], next: Unit | undefined): Mark[] {
    return own.filter((mark) => {
        const opens = mark === "underline" || writer.stack.includes(mark) || writer.pending.length > 0
            || opensBeforePunctuation(writer.pieces.at(-1), MARK_DELIMITERS[mark]);
        const closes = mark === "underline" || (next !== undefined && unitCarries(next, mark)) || closesAfterPunctuation(next);

        return opens && closes;
    });
}

/**
 * Tells whether a delimiter written right after `previous` can open before
 * punctuation (an image's `!`): CommonMark's left-flanking rule then needs
 * whitespace or punctuation before it.
 *
 * @param previous - The last piece written, or `undefined` at the start.
 * @param delimiter - The delimiter to open.
 * @returns `true` at a line start, after a break, a newline or another
 *   delimiter, or after text, syntax or source ending in whitespace or
 *   punctuation.
 */
function opensBeforePunctuation(previous: Piece | undefined, delimiter: string): boolean {
    if (previous === undefined || previous.kind === "break" || previous.kind === "newline" || previous.kind === "delimiter") {
        return true;
    }

    if (previous.kind === "autolink") {
        return false;
    }

    const char = previous.text.at(-1) ?? "";

    return /\s/.test(char) || isFlankingPunctuation(char, delimiter[0]!);
}

/**
 * Tells whether a closing delimiter written after punctuation (an image's
 * `)`) still closes before `next`: CommonMark's right-flanking rule then
 * needs whitespace or punctuation after it, so `next` must not start with a
 * letter or digit.
 *
 * @param next - The unit after the delimiter, or `undefined` at the end.
 * @returns `false` when `next` is plain text, or source, starting with a
 *   word character.
 */
function closesAfterPunctuation(next: Unit | undefined): boolean {
    if (next?.kind !== "source" && (next?.kind !== "text" || next.code)) {
        return true;
    }

    const first = (next.kind === "source" ? next.source : next.text)[0] ?? "";

    return /\s/.test(first) || ASCII_PUNCTUATION.test(first);
}

/**
 * Writes a text segment: a code span inside its marks, or text whose edge
 * whitespace sits outside the delimiters around it — except underline's,
 * whose grammar has no flanking rule, so it stays inside. Whitespace alone
 * opens no mark but underline — it keeps the open marks it carries and is
 * held back.
 *
 * @param writer - The writer.
 * @param segment - The text segment.
 * @param marks - Its marks beyond the inherited ones.
 */
function writeTextSegment(writer: InlineWriter, segment: TextSegment, marks: readonly Mark[]): void {
    if (segment.code) {
        syncMarks(writer, marks, "");
        writer.pieces.push({ kind: "syntax", text: writeCodeSpan(segment.text, writer.context, writer.inLink) });

        return;
    }

    const [, leading, core, trailing] = /^(\s*)(.*?)(\s*)$/s.exec(segment.text)!;

    const underlined = segment.marks.includes("underline");

    if (core === "") {
        keepCarriedMarks(writer, marks);

        if (marks.includes("underline") && !writer.stack.includes("underline")) {
            syncMarks(writer, [...writer.stack, "underline"], "");
        }

        writer.pendingUnderline = (writer.pending.length === 0 || writer.pendingUnderline) && underlined;
        writer.pending.push({ kind: "text", text: segment.text });

        return;
    }

    syncMarks(writer, marks, leading!);
    writer.pieces.push({ kind: "text", text: core! });
    writer.pending = trailing === "" ? [] : [{ kind: "text", text: trailing! }];
    writer.pendingUnderline = underlined;
}

/**
 * Closes the open marks a whitespace-only run does not carry, from the
 * lowest one it lacks up, and keeps the rest open: whitespace alone never
 * opens a mark.
 *
 * @param writer - The writer.
 * @param marks - The marks the whitespace carries beyond the inherited ones.
 */
function keepCarriedMarks(writer: InlineWriter, marks: readonly Mark[]): void {
    const lowestMissing = writer.stack.findIndex((mark) => !marks.includes(mark));

    syncMarks(writer, lowestMissing === -1 ? writer.stack.slice() : writer.stack.slice(0, lowestMissing), "");
}

/**
 * Tells whether a source segment is a kept shortcut reference: a whole kept
 * construct written `[label]` or `![label]` that shows something other than
 * its source — the reference resolves, so it shows the link's text or the
 * image's alt text. Like any shortcut reference, it joins a bracket or
 * parenthesis written right after it ({@link joinsShortcut}).
 *
 * @param segment - The source segment.
 * @returns `true` for a kept shortcut reference.
 */
function isKeptShortcutReference(segment: SourceSegment): boolean {
    if (segment.kept === undefined || !SHORTCUT_REFERENCE_SOURCE.test(segment.source)) {
        return false;
    }

    const shown = segment.kept.shown.map((part) => (part.kind === "text" ? part.text : part.kind === "source" ? part.source : "\u0000")).join("");

    return shown !== segment.source;
}

/**
 * Writes a source segment inside its marks, unescaped: each newline in it is
 * a line end (a space where content cannot span lines), and each `|` in a
 * table cell is escaped. A whitespace-only source (a soft break) is held
 * back like trailing whitespace, so a delimiter closing next is written
 * before it, not at the start of the next line; it opens no mark but
 * underline, as whitespace text does.
 *
 * @param writer - The writer.
 * @param segment - The source segment.
 * @param marks - Its marks beyond the inherited ones.
 */
function writeSourceSegment(writer: InlineWriter, segment: SourceSegment, marks: readonly Mark[]): void {
    const context = writer.context;
    const source = context.inTableCell ? segment.source.replace(/\|/g, "\\|") : segment.source;
    const shortcut = segment.shortcut === true || isKeptShortcutReference(segment);
    const pieces = source.split("\n").flatMap((line, index): Piece[] => [
        ...(index > 0 ? [context.singleLine ? { kind: "text", text: " " } as const : { kind: "newline" } as const] : []),
        ...(line === "" ? [] : [{ kind: "source", text: line, ...(shortcut ? { shortcut } : {}) } as const]),
    ]);

    if (/\S/.test(source)) {
        syncMarks(writer, marks, "");
        writer.pieces.push(...pieces);
    } else {
        keepCarriedMarks(writer, marks);

        // Underline, whose grammar has no flanking rule, holds a soft break alone (`++` newline `++`).
        if (marks.includes("underline") && !writer.stack.includes("underline")) {
            syncMarks(writer, [...writer.stack, "underline"], "");
        }

        writer.pendingUnderline = (writer.pending.length === 0 || writer.pendingUnderline) && segment.marks.includes("underline");
        writer.pending.push(...pieces);
    }
}

/**
 * Writes a link or style group: a reference link whose label the saved
 * document resolves to its URL and title in its reference form, any other
 * link as an autolink or `[…](…)`, a style group as `[…]{…}`.
 *
 * @param writer - The writer.
 * @param group - The group.
 * @param inherited - The marks open at enclosing group levels.
 */
function writeGroup(writer: InlineWriter, group: LinkGroup | StyleGroup, inherited: readonly Mark[]): void {
    if (group.kind === "style") {
        writeBracketed(writer, group, inherited, "", `]{${group.style}}`);

        return;
    }

    const link = group.link;

    if ($isReferenceLinkNode(link) && resolvesToNode(link, writer.context.definitions)) {
        writeReference(writer, group, link, inherited);

        return;
    }

    // A marked bare autolink holds its marks outside it, bare or in its
    // `[…](…)` fallback; a link loaded from that fallback is no longer bare,
    // so where the marks go inside links it is written with them inside —
    // and so is this one, for a save loaded and saved again to be unchanged.
    const marksInside = writer.policy.marksInsideGroups && commonMarks(group, inherited, "").length > 0;
    const bare = marksInside ? null : writeBareAutolink(link, writer.context);

    if (bare !== null) {
        syncMarks(writer, commonMarks(group, inherited, ""), "");
        writer.pieces.push(bare);

        return;
    }

    const autolink = writeAutolink(link, writer.context, true);

    if (autolink !== null) {
        syncMarks(writer, commonMarks(group, inherited, ""), "");
        writer.pieces.push({ kind: "syntax", text: autolink });

        return;
    }

    const destination = writeLinkDestination(link, writer.context);

    writeBracketed(writer, group, inherited, destination, `]${destination}`);
}

/**
 * Writes a group in brackets: marks every segment carries stay open across
 * it (opening if needed); the rest close before its `[`. Inside, the stack
 * starts empty and is closed before `closing`.
 *
 * @param writer - The writer.
 * @param group - The group.
 * @param inherited - The marks open at enclosing group levels.
 * @param after - What a link writes after its text (its destination, or its
 *   reference's label), whose `+` keeps underline from spanning it; `""` for
 *   a style group.
 * @param closing - The syntax that closes the group, from its `]` on.
 */
function writeBracketed(
    writer: InlineWriter, group: LinkGroup | StyleGroup, inherited: readonly Mark[], after: string, closing: string,
): void {
    syncMarks(writer, writer.policy.marksInsideGroups ? [] : commonMarks(group, inherited, after), "");

    const outer = writer.stack;
    const outerInLink = writer.inLink;

    writer.stack = [];
    writer.inLink = outerInLink || group.kind === "link";
    writer.pieces.push({ kind: "syntax", text: "[" });

    const textStart = writer.pieces.length;

    writeUnits(writer, group.units, [...inherited, ...outer]);
    closeMarks(writer, 0);
    flushPending(writer);

    if (group.kind === "link") {
        unescapeCodeSpanBrackets(writer.pieces, textStart);
        protectLabelBrackets(writer.pieces, textStart);
    }

    writer.stack = outer;
    writer.inLink = outerInLink;
    writer.pieces.push({ kind: "syntax", text: closing });
}

/**
 * Tells whether `definitions` resolve `node`'s label to exactly its current
 * URL and title, matching labels as `marked` does: whitespace runs collapsed
 * to one space, then lowercased. An empty title counts as none, as `marked`
 * gives a reference link with an empty title none. A title holding a blank
 * line only a definition can write — an inline link's would end its block —
 * so a link with one keeps its reference form while its label resolves to
 * its URL, whatever title the definition now gives it; the editor then
 * shows that title, as the save reads.
 *
 * @param node - The reference link.
 * @param definitions - The saved document's definitions, or `null`.
 * @returns `true` when its reference form would point where it points now.
 */
function resolvesToNode(node: ReferenceLinkNode, definitions: Links | null): boolean {
    if (definitions === null) {
        return false;
    }

    const key = node.getReference().label.replace(/\s+/g, " ").toLowerCase();

    if (!Object.hasOwn(definitions, key)) {
        return false;
    }

    const definition = definitions[key]!;
    const title = node.getTitle() || null;

    return definition.href === node.getURL() && ((definition.title || null) === title || BLANK_LINE_IN_TITLE.test(title ?? ""));
}

/**
 * Writes a resolving reference link in the form it was loaded in while its
 * text is as loaded: `[label]` (a `reference` piece the line renderer turns
 * into `[label][]` before a character that would join it to another
 * construct) or `[label][]`. Once its text has been edited or formatted, or
 * when it was loaded in the full form, it is written `[text][label]`.
 *
 * Marks every segment carries are written outside the brackets, as for any
 * link — except a mark the label itself wraps all of its text in (`*foo*`,
 * `_foo_`), which is kept open only when it already is, so the label gains no
 * second emphasis around it.
 *
 * @param writer - The writer.
 * @param group - The link's group.
 * @param link - The reference link.
 * @param inherited - The marks open at enclosing group levels.
 */
function writeReference(writer: InlineWriter, group: LinkGroup, link: ReferenceLinkNode, inherited: readonly Mark[]): void {
    const reference = link.getReference();
    const label = writtenLabel(reference.label, writer.context);
    const unchanged = $serializeLinkContent(link) === reference.importedContent;

    if (reference.form === "full" || !unchanged) {
        writeBracketed(writer, group, inherited, `[${label}]`, `][${label}]`);

        return;
    }

    const own = labelMarks(reference.label);
    const marks = commonMarks(group, inherited, `[${label}]`).filter((mark) => !own.includes(mark) || writer.stack.includes(mark));

    syncMarks(writer, marks, "");

    writer.pieces.push(reference.form === "shortcut"
        ? { kind: "reference", text: `[${label}]`, shortcut: true }
        : { kind: "reference", text: `[${label}][]`, shortcut: false });
}

/**
 * The marks a label wraps all of its text in, read as the viewer reads them:
 * while the label lexes to a single emphasis-like token, that token's mark,
 * then the marks of the single token inside it.
 *
 * @param label - The label as authored.
 * @returns The marks, outermost first; none for a label not wholly emphasised.
 */
function labelMarks(label: string): Mark[] {
    const marks: Mark[] = [];
    let tokens: Token[] = lexMarkdownInline(label);

    while (tokens.length === 1 && TOKEN_MARKS[tokens[0]!.type] !== undefined) {
        marks.push(TOKEN_MARKS[tokens[0]!.type]!);
        tokens = (tokens[0] as Tokens.Generic).tokens ?? [];
    }

    return marks;
}

/**
 * A reference's label as written where it stands: as authored, except that
 * where content cannot span lines its line breaks become spaces (the label
 * matches the same definition) and in a table cell its `|` is escaped.
 *
 * @param label - The label as authored.
 * @param context - Where it is written.
 * @returns The label to write between brackets.
 */
function writtenLabel(label: string, context: InlineContext): string {
    const line = context.singleLine ? label.replace(/[ \t]*\n[ \t]*/g, " ") : label;

    return context.inTableCell ? line.replace(/\|/g, "\\|") : line;
}

/**
 * Writes as syntax, unescaped, each bracket pair of a link's text that holds
 * a code span with an odd number of backticks. `marked` finds where link
 * text ends by pairing backticks, which such a span throws off — the link
 * is then read as literal text — except inside a bracket pair, which it
 * scans as plain text. Only a pair holding no other bracket qualifies
 * (`marked` scans one level of nesting); the `(` or `{` after its `]` is
 * still escaped.
 *
 * @param pieces - The written pieces. Updated in place.
 * @param from - The index of the link text's first piece.
 */
function unescapeCodeSpanBrackets(pieces: Piece[], from: number): void {
    const brackets: Array<{ piece: number; offset: number; char: string }> = [];

    for (let index = from; index < pieces.length; index += 1) {
        const piece = pieces[index]!;

        if (piece.kind === "text") {
            [...piece.text].forEach((char, offset) => {
                if (char === "[" || char === "]") {
                    brackets.push({ piece: index, offset, char });
                }
            });
        }
    }

    const unescaped: typeof brackets = [];

    for (let index = 0; index + 1 < brackets.length; index += 1) {
        const open = brackets[index]!;
        const close = brackets[index + 1]!;

        if (open.char === "[" && close.char === "]" && holdsOddCodeSpan(pieces.slice(open.piece + 1, close.piece))) {
            unescaped.push(open, close);
            index += 1;
        }
    }

    for (const bracket of unescaped.reverse()) {
        const text = (pieces[bracket.piece] as { text: string }).text;

        pieces.splice(bracket.piece, 1, ...[
            { kind: "text", text: text.slice(0, bracket.offset) } as const,
            { kind: "syntax", text: bracket.char } as const,
            { kind: "text", text: text.slice(bracket.offset + 1) } as const,
        ].filter((piece) => piece.text !== ""));
    }
}

/**
 * Writes each bracket pair of a link's text that holds no other bracket as
 * `\\[` … `\\]`, so it stays text whatever the document defines. `marked`
 * unescapes the brackets of link text before reading it, so a pair written
 * `\[r\]` reads there as `[r]` — a reference whenever `r` is defined, and
 * with the next pair a full reference (`[x][r]`). Written `\\[r\\]`, the
 * pair is unescaped to `\[r\]`, which reads as the text `[r]`; to `marked`'s
 * link pattern its brackets are a bracket pair, which link text may hold
 * one level deep — so a pair holding a pair keeps its single escapes (it
 * reads as a reference only to a label holding escaped brackets), and a
 * bracket without a partner, which no reference can be made of, keeps its
 * own. Left as it is when the text's syntax or source holds a bracket of its
 * own, which the pattern pairs too.
 *
 * @param pieces - The written pieces. Updated in place.
 * @param from - The index of the link text's first piece.
 */
function protectLabelBrackets(pieces: Piece[], from: number): void {
    const text = pieces.slice(from);
    const pairedElsewhere = text.some((piece) => piece.kind !== "text" && "text" in piece && /[[\]]/.test(piece.text));

    if (pairedElsewhere) {
        return;
    }

    const brackets: Array<{ piece: number; offset: number; char: string }> = [];

    text.forEach((piece, index) => {
        if (piece.kind === "text") {
            [...piece.text].forEach((char, offset) => {
                if (char === "[" || char === "]") {
                    brackets.push({ piece: from + index, offset, char });
                }
            });
        }
    });

    const paired = brackets.filter((bracket, index) => (bracket.char === "["
        ? brackets[index + 1]?.char === "]"
        : brackets[index - 1]?.char === "["));

    for (const bracket of paired.reverse()) {
        const piece = pieces[bracket.piece] as { text: string };

        pieces.splice(bracket.piece, 1, ...[
            { kind: "text", text: piece.text.slice(0, bracket.offset) } as const,
            { kind: "syntax", text: "\\\\" + bracket.char } as const,
            { kind: "text", text: piece.text.slice(bracket.offset + 1) } as const,
        ].filter((part) => part.text !== ""));
    }
}

/**
 * Tells whether the pieces between a bracket pair hold a code span with an
 * odd number of backticks in its content, and no bracket in any syntax or
 * source.
 *
 * @param pieces - The pieces between the brackets.
 * @returns `true` when the pair must be written unescaped.
 */
function holdsOddCodeSpan(pieces: readonly Piece[]): boolean {
    const syntax = pieces.filter((piece) => piece.kind === "syntax");
    const unescaped = pieces.filter((piece) => piece.kind === "syntax" || piece.kind === "source");

    if (unescaped.some((piece) => /[[\]]/.test(piece.text))) {
        return false;
    }

    return syntax.some((piece) => {
        const fence = /^`*/.exec(piece.text)![0].length;
        const backticks = piece.text.split("`").length - 1;

        return fence > 0 && (backticks - 2 * fence) % 2 === 1;
    });
}

/**
 * The marks every text or source segment of a group carries beyond the
 * inherited ones. An image or break carries none. Underline is left out when
 * what the link writes after its text (its destination, or its reference's
 * label) holds a `+`, which the underline grammar cannot span.
 *
 * @param group - The group.
 * @param inherited - The marks open at enclosing group levels.
 * @param destination - The link's written destination or label, or `""` for a style group.
 * @returns The common marks, in the fixed order.
 */
function commonMarks(group: LinkGroup | StyleGroup, inherited: readonly Mark[], destination: string): Mark[] {
    const segments = group.units.flatMap((unit) => (unit.kind === "style" ? unit.units : [unit]));

    return MARK_ORDER.filter((mark) =>
        !inherited.includes(mark)
        && !(mark === "underline" && destination.includes("+"))
        && segments.every((segment) => (segment.kind === "text" || segment.kind === "source") && segment.marks.includes(mark)));
}

/**
 * Brings the open marks to `target`: closes from the top of the stack down
 * to (and including) the lowest mark `target` lacks, writes the held-back
 * whitespace and `leading`, then opens `target`'s missing marks in the fixed
 * order. Whitespace thereby sits outside the delimiters it borders, except
 * an underline's: an underline opening here opens first and holds `leading`.
 *
 * @param writer - The writer.
 * @param target - The marks the next output carries.
 * @param leading - The next text's leading whitespace.
 */
function syncMarks(writer: InlineWriter, target: readonly Mark[], leading: string): void {
    const lowestMissing = writer.stack.findIndex((mark) => !target.includes(mark));

    if (lowestMissing !== -1) {
        closeMarks(writer, lowestMissing);
    }

    const rank = writer.policy.rank;

    if (rank !== null) {
        const ordered = rank.filter((mark) => target.includes(mark));
        const outOfOrder = writer.stack.findIndex((mark, index) => ordered[index] !== mark);

        if (outOfOrder !== -1) {
            closeMarks(writer, outOfOrder);
        }
    }

    flushPending(writer);

    const missing = target.filter((mark) => !writer.stack.includes(mark));
    const order = missing.length > 0 ? writer.openOrder() : [];
    const holdsLeading = leading !== "" && missing.includes("underline");

    const open = (mark: Mark): void => {
        const previous = writer.pieces.at(-1);

        // The cell break ends in a letter, against which a delimiter before punctuation cannot open; a space after
        // it is collapsed at the start of the line it makes.
        if (previous?.kind === "syntax" && previous.text === CELL_PARAGRAPH_BREAK && mark !== "underline") {
            writer.pieces.push({ kind: "text", text: " " });
        }

        writer.stack.push(mark);
        writer.pieces.push({ kind: "delimiter", text: MARK_DELIMITERS[mark], mark, opens: true });
    };

    if (holdsLeading) {
        open("underline");
    }

    if (leading !== "") {
        writer.pieces.push({ kind: "text", text: leading });
    }

    for (const mark of order) {
        if (missing.includes(mark) && !writer.stack.includes(mark)) {
            open(mark);
        }
    }
}

/**
 * Closes the open marks from the top of the stack down to `from`. Held-back
 * underlined whitespace is written before an underline's closing delimiter,
 * so it stays underlined.
 *
 * @param writer - The writer.
 * @param from - The stack index of the lowest mark to close.
 */
function closeMarks(writer: InlineWriter, from: number): void {
    for (let index = writer.stack.length - 1; index >= from; index -= 1) {
        const mark = writer.stack[index]!;

        if (mark === "underline" && writer.pendingUnderline) {
            flushPending(writer);
        }

        writer.pieces.push({ kind: "delimiter", text: MARK_DELIMITERS[mark], mark, opens: false });
    }

    writer.stack.length = from;
}

/**
 * Writes the held-back whitespace.
 *
 * @param writer - The writer.
 */
function flushPending(writer: InlineWriter): void {
    writer.pieces.push(...writer.pending);
    writer.pending = [];
    writer.pendingUnderline = false;
}

/**
 * The piece a line break writes: the cell paragraph break in a table cell (a
 * line break the viewer reads, which loads back as a paragraph boundary), a
 * space in a heading, else a hard break with its marker.
 *
 * @param marker - The break's authored marker.
 * @param context - Where it is written.
 * @returns The piece.
 */
function writeBreak(marker: string, context: InlineContext): Piece {
    if (context.inTableCell) {
        return { kind: "syntax", text: CELL_PARAGRAPH_BREAK };
    }

    return context.singleLine ? { kind: "text", text: " " } : { kind: "break", marker };
}

/**
 * Writes a code span, fenced with the shortest backtick run its content does
 * not hold — a run of three or more at a line start reads as a code fence to
 * some of `marked`'s block rules, so it is written only when the content
 * holds runs of every shorter length — and padded with a space inside each
 * fence when the content would otherwise merge with the fence, lose an edge
 * space, or end in a backslash (`marked` masks a backslash with the
 * character after it before pairing backticks, so `\` before the closing
 * fence would hide it). Inside a link, `marked` strips one backslash before each `[` /
 * `]` of the link text before lexing it, so a backslash there is doubled to
 * survive; and its link-text scan reads from one backtick run to the next as
 * a code span, which an inner run longer than the fence ends early, so the
 * fence there is one longer than the longest run.
 *
 * @param code - The code text.
 * @param context - Where it is written.
 * @param inLink - Whether the span is inside a link's text.
 * @returns The code span.
 */
function writeCodeSpan(code: string, context: InlineContext, inLink: boolean): string {
    const runs = new Set((code.match(/`+/g) ?? []).map((run) => run.length));
    let fenceLength = inLink ? Math.max(0, ...runs) + 1 : 1;

    while (runs.has(fenceLength)) {
        fenceLength += 1;
    }

    const fence = "`".repeat(fenceLength);
    const padded = code.startsWith("`") || code.endsWith("`") || code.endsWith("\\") || (/^ .* $/s.test(code) && /[^ ]/.test(code));
    const linkSafe = inLink ? code.replace(/\\(?=[[\]])/g, "\\\\") : code;
    const content = padded ? ` ${linkSafe} ` : linkSafe;

    return fence + (context.inTableCell ? content.replace(/\|/g, "\\|") : content) + fence;
}

/**
 * Writes a link's destination and title, in parentheses. A title's line
 * breaks are written where its block can hold them: none in a heading or
 * table cell, whose content is one line, so each becomes a space; and no
 * blank line anywhere, which would end the block, so each stretch of line
 * breaks becomes one.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @returns `(url)`, `(<url>)` when the URL holds a character a bare destination cannot, plus ` "title"`.
 */
function writeLinkDestination(link: LinkNode, context: InlineContext): string {
    const url = link.getURL();
    const title = link.getTitle();
    const titled = title !== null && title !== "";
    const bare = url !== "" && ![...url].some((char) => needsAngleBrackets(char));
    const destination = bare ? url : url === "" && !titled ? "" : `<${url.replace(/[\\<>]/g, "\\$&")}>`;
    const lines = titled ? title.replace(/\n[ \t]*(?=\n)/g, "").replace(/\n+/g, context.singleLine ? " " : "\n") : "";
    const written = `(${destination}${titled ? ` "${lines.replace(/[\\"]/g, "\\$&")}"` : ""})`;

    return context.inTableCell ? written.replace(/\|/g, "\\|") : written;
}

/**
 * Tells whether a destination character forces the `<…>` form.
 *
 * @param char - One character of the URL.
 * @returns `true` for a space, `<`, `>`, `(`, `)`, `\` or a control character.
 */
function needsAngleBrackets(char: string): boolean {
    const code = char.charCodeAt(0);

    return " <>()\\".includes(char) || code <= LAST_C0_CONTROL || code === DELETE_CHARACTER;
}

/**
 * Reads the text of a link that can be written as an autolink: its only
 * child is one unstyled text, and it has no title. The text must be
 * unformatted, unless `marked`: its marks' delimiters are then written
 * around the autolink — though not underline when the text holds a `+`,
 * which the underline grammar cannot.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @param marked - Whether the text may carry marks.
 * @returns The link's text, or `null` when the link needs `[…](…)`.
 */
function autolinkText(link: LinkNode, context: InlineContext, marked = false): string | null {
    const child = link.getFirstChild();

    if (link.getChildrenSize() !== 1 || !$isTextNode(child) || child.getStyle() !== ""
        || (link.getTitle() ?? "") !== "" || (context.inTableCell && link.getURL().includes("|"))) {
        return null;
    }

    const marks = marked ? MARK_ORDER.filter((mark) => child.hasFormat(MARK_FORMATS[mark])) : [];
    const markFormat = marks.reduce((format, mark) => format | TEXT_TYPE_TO_FORMAT[MARK_FORMATS[mark]], 0);
    const text = child.getTextContent();

    return child.getFormat() === markFormat && !(marks.includes("underline") && text.includes("+")) ? text : null;
}

/**
 * Writes a link the importer read from a GFM bare autolink
 * ({@link bareAutolinkState}) back bare, when `marked` reads its text alone
 * as that same link: a `www.` address (`http://` added), a URL with an
 * `http`, `https` or `ftp` scheme, or an email address (`mailto:` added). The
 * text must hold none of the characters that end or reshape the match, and
 * end in a letter, digit or `/` — `marked` trims trailing punctuation off a
 * bare URL. Its text may carry marks, open around it. Whether whitespace, a
 * line edge or those marks' delimiters bound it, so no neighbouring character
 * runs into it, is only known once the line is assembled, so the piece
 * carries its fallback: the `<…>` or `[…](…)` form.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @returns The autolink piece, or `null` when the link is not written bare.
 */
function writeBareAutolink(link: LinkNode, context: InlineContext): Piece | null {
    const text = autolinkText(link, context, true);
    const url = link.getURL();

    if (text === null || !$getState(link, bareAutolinkState) || !BARE_AUTOLINK_TEXT.test(text)) {
        return null;
    }

    const isBare = (/^www\./i.test(text) && url === "http://" + text)
        || (BARE_URL_SCHEME_PREFIX.test(text) && url === text)
        || (AUTOLINK_EMAIL.test(text) && url === "mailto:" + text);

    if (!isBare) {
        return null;
    }

    const fallback = writeAutolink(link, context, true)
        ?? `[${escapeText(text, "[", "]", context)}]${writeLinkDestination(link, context)}`;

    return { kind: "autolink", text: fallback, bare: text };
}

/**
 * Writes a link as an angle-bracket autolink when it is one: its only child
 * is one unstyled text equal to its URL (or to its `mailto:` address), with
 * no title. Its text may carry marks, whose delimiters are written around
 * the brackets.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @param marked - Whether the text may carry marks, written around it by the caller.
 * @returns `<url>` or `<address>`, or `null` when the link needs `[…](…)`.
 */
function writeAutolink(link: LinkNode, context: InlineContext, marked = false): string | null {
    const text = autolinkText(link, context, marked);
    const url = link.getURL();

    if (text === null) {
        return null;
    }

    if (text === url && AUTOLINK_URL.test(url)) {
        return `<${url}>`;
    }

    return url === "mailto:" + text && AUTOLINK_EMAIL.test(text) ? `<${text}>` : null;
}

/**
 * Writes an image with its attributes, in the form the viewer reads.
 * Brackets are removed from the alt text, which the image grammar cannot hold.
 *
 * @param node - The image.
 * @param context - Where it is written.
 * @returns `![alt](src)`, plus `{…}` when it has attribute text.
 */
function writeImage(node: MarkdownImageNode, context: InlineContext): string {
    const attributeText = imageAttributeText(node);
    const attributes = attributeText === "" ? "" : `{${attributeText}}`;
    const written = `![${node.getAlt().replace(/[[\]]/g, "")}](${node.getSrc()})${attributes}`;

    return context.inTableCell ? written.replace(/\|/g, "\\|") : written;
}

/**
 * Reads the attribute text an image is written with: the authored text it was
 * loaded with ({@link imageAttributesState}) while that text still resolves
 * to the node's size — keeping the attributes' order and the ones the editor
 * does not model — else `width=… height=…` for whichever is set.
 *
 * @param node - The image.
 * @returns The attribute text, or `""` for none.
 */
function imageAttributeText(node: MarkdownImageNode): string {
    const width = node.getImageWidth();
    const height = node.getImageHeight();
    const authored = $getState(node, imageAttributesState);
    const resolved = resolveImageSpec(node.getSrc(), node.getAlt(), parseAttributes(authored));

    if (authored !== "" && !/[\n|{}]/.test(authored) && resolved?.width === width && resolved.height === height) {
        return authored;
    }

    const attributes: Record<string, string> = {};

    if (width !== null) {
        attributes.width = String(width);
    }

    if (height !== null) {
        attributes.height = String(height);
    }

    return formatAttributes(attributes);
}

// ---------------------------------------------------------------- inline: reading back

/**
 * The reading of a block's segments, as the editor shows them: one unit per
 * visible character, image and line break — whitespace left out, since the
 * viewer collapses it, unless `context.readsWhitespace` asks for one unit per
 * stretch of it — each keyed by its marks, link and span style. A source
 * segment reads as its source does on its own, inside its marks.
 *
 * @param segments - The block's segments.
 * @param context - Where the content is written: a heading's breaks are spaces.
 * @returns The reading units, in order, or `null` when a source segment's
 *   reading is not known on its own, or a reference link's depends on the
 *   document's definitions.
 */
function segmentReading(segments: readonly Segment[], context: InlineContext): string[] | null {
    const reading: string[] = [];

    for (const segment of segments) {
        const link = linkReading(segment.link?.getURL() ?? "", segment.link?.getTitle() ?? "");

        if (segment.kind === "break") {
            if (!context.singleLine || context.inTableCell) {
                pushBreakReading(reading);
            }
        } else if (segment.kind === "image") {
            reading.push(imageReading(segment.node.getSrc(), link));
        } else if (segment.kind === "source") {
            if (!pushSourceReading(reading, segment, link, context)) {
                return null;
            }
        } else {
            const marks = segment.code ? [...segment.marks, "code"] : segment.marks;

            pushCharacterReading(reading, segment.text, { marks, link, style: styleReading(segment.style) }, context);
        }
    }

    return reading;
}

/**
 * Appends the reading of a source segment: what its source shows when lexed
 * on its own, inside the segment's marks, link and style. Whitespace-only
 * source (a soft break) and source that shows nothing read as nothing. A
 * whole kept construct ({@link keptSourceState}) and a run of a link nested
 * in a link read as what their runs show.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param segment - The source segment.
 * @param link - The reading key of its link.
 * @param context - Where it is written.
 * @returns `false` when its reading is not known on its own: source that does not lex as
 *   inline content in a heading or table cell. In a paragraph's line, source that would open a block on its own
 *   (an HTML tag) reads as the line's inline content.
 */
function pushSourceReading(reading: string[], segment: SourceSegment, link: string, context: InlineContext): boolean {
    const kept = segment.kept ?? segment.nested;

    if (kept !== undefined) {
        const shown = segmentReading(kept.shown, context);

        reading.push(...(shown ?? []));

        return shown !== null;
    }

    if (!segment.shows) {
        return true;
    }

    if (!/\S/.test(segment.source)) {
        pushCharacterReading(reading, " ", { marks: segment.marks, link, style: styleReading(segment.style) }, context);

        return true;
    }

    // Inside a paragraph's line, source that would start a block on its own (an HTML tag, a `#`) reads inline.
    const tokens = readBackTokens(segment.source, context) ?? (context.singleLine || context.inTableCell ? null : lexMarkdownInline(segment.source));

    if (tokens !== null) {
        pushTokenReading(reading, tokens, { marks: segment.marks, link, style: styleReading(segment.style) }, context);
    }

    return tokens !== null;
}

/**
 * The reading key of a span style: its normalized attribute text.
 *
 * @param style - The span's attribute text, authored or normalized; `""` for none.
 * @returns The key.
 */
function styleReading(style: string): string {
    return style === "" ? "" : normalizedAttributes(parseAttributes(style));
}

/**
 * Reads inline Markdown back as the viewer reads it, in the block it is
 * written for: a paragraph's lines alone, a heading's content after `# `
 * (and before a closing ` #`, so a trailing `#` of its own stays text), a
 * cell's content in a one-cell table.
 *
 * @param markdown - The block's inline Markdown.
 * @param context - Where it is written.
 * @returns The reading units, or `null` when the Markdown does not lex as one such block.
 */
function markdownReading(markdown: string, context: InlineContext): string[] | null {
    const reading: string[] = [];
    const tokens = readBackTokens(markdown, context);

    if (tokens === null) {
        return markdown.trim() === "" ? reading : null;
    }

    pushTokenReading(reading, tokens, { marks: [], link: "", style: "" }, context);

    return reading;
}

/**
 * Lexes inline Markdown in the block it is written for.
 *
 * @param markdown - The block's inline Markdown.
 * @param context - Where it is written.
 * @returns The block's inline tokens, or `null` when it does not lex as one such block.
 */
function readBackTokens(markdown: string, context: InlineContext): Token[] | null {
    // A reference link reads as a link only with the document's definitions, as in the saved document.
    const lex = (probe: string): Token[] => (context.definitions === null ? lexMarkdown(probe) : lexMarkdownWithDefinitions(probe, context.definitions));

    if (context.inTableCell) {
        const table = lex(`| ${markdown} |\n| --- |`)[0];

        return table?.type === "mdtable" ? (table as unknown as MdTableToken).header[0]?.tokens ?? null : null;
    }

    if (context.singleLine) {
        const heading = lex(`# ${markdown} #`)[0];

        return heading?.type === "heading" ? (heading as Tokens.Heading).tokens : null;
    }

    const blocks = lex(markdown).filter((token) => token.type !== "space");

    return blocks.length === 1 && blocks[0]!.type === "paragraph" ? (blocks[0] as Tokens.Paragraph).tokens : null;
}

/**
 * Appends the reading of inline tokens: their visible characters, images
 * and breaks, each keyed by the marks, link and style around it. In a table
 * cell, a text's {@link CELL_PARAGRAPH_BREAK} reads as a break, as the viewer
 * renders it.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param tokens - The tokens.
 * @param scope - What the tokens inherit.
 * @param context - Where they are written.
 * @param spans - When given, records the reading units each token (at any depth) reads as: `[start, end)`.
 */
function pushTokenReading(
    reading: string[], tokens: readonly Token[], scope: ReadingScope, context: InlineContext, spans?: Map<Token, readonly [number, number]>,
): void {
    const marked = (mark: string): ReadingScope => ({ ...scope, marks: [...scope.marks, mark] });

    for (const token of tokens) {
        const children = (token as { tokens?: Token[] }).tokens ?? [];
        const start = reading.length;

        switch (token.type) {
            case "strong":     pushTokenReading(reading, children, marked("bold"), context, spans);      break;
            case "em":         pushTokenReading(reading, children, marked("italic"), context, spans);    break;
            case "del":        pushTokenReading(reading, children, marked("strike"), context, spans);    break;
            case "underline":  pushTokenReading(reading, children, marked("underline"), context, spans); break;
            case "link":       pushTokenReading(reading, children, linkScope(token as Tokens.Link, scope), context, spans); break;
            case "styledspan": pushTokenReading(reading, children, styleScope(token, scope), context, spans); break;
            case "codespan":   pushCharacterReading(reading, (token as Tokens.Codespan).text, marked("code"), context); break;
            case "text":       pushTextReading(reading, token as Tokens.Text, scope, context, spans); break;
            case "escape":     pushCharacterReading(reading, (token as Tokens.Escape).text, scope, context); break;
            case "br":         pushBreakReading(reading); break;
            case "mdimage":    reading.push(imageReading((token as unknown as { src: string }).src, scope.link)); break;
            // As the viewer shows any other token: its text (a `marked` image the dialect's image rule declined shows its alt text), else its source.
            default:           pushCharacterReading(reading, (token as Tokens.Generic).text ?? token.raw, scope, context);
        }

        spans?.set(token, [start, reading.length]);
    }
}

/**
 * The scope inside a link token.
 *
 * @param link - The link token.
 * @param scope - The scope around it.
 * @returns The scope with the link's reading key.
 */
function linkScope(link: Tokens.Link, scope: ReadingScope): ReadingScope {
    return { ...scope, link: linkReading(link.href, link.title ?? "") };
}

/**
 * The scope inside a styled span token.
 *
 * @param span - The `styledspan` token.
 * @param scope - The scope around it.
 * @returns The scope with the span's normalized style.
 */
function styleScope(span: Token, scope: ReadingScope): ReadingScope {
    return { ...scope, style: normalizedAttributes((span as unknown as { attributes: Record<string, string> }).attributes) };
}

/**
 * Appends the reading of a `text` token: its children, when it has any,
 * else its characters — in a table cell, split by the cell break into lines.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param token - The `text` token.
 * @param scope - What it inherits.
 * @param context - Where it is written.
 * @param spans - Where to record each token's reading units, as {@link pushTokenReading} does.
 */
function pushTextReading(
    reading: string[], token: Tokens.Text, scope: ReadingScope, context: InlineContext, spans?: Map<Token, readonly [number, number]>,
): void {
    if (token.tokens !== undefined && token.tokens.length > 0) {
        pushTokenReading(reading, token.tokens, scope, context, spans);

        return;
    }

    const lines = context.inTableCell ? token.text.split(CELL_PARAGRAPH_BREAK) : [token.text];

    lines.forEach((line, index) => {
        if (index > 0) {
            pushBreakReading(reading);
        }

        pushCharacterReading(reading, line, scope, context);
    });
}

/**
 * Appends one reading unit per visible character of a text; with
 * {@link InlineContext.readsWhitespace}, one per stretch of whitespace too.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param text - The text.
 * @param scope - Its marks, link and span style.
 * @param context - Where it is written; only its `readsWhitespace` is read.
 */
function pushCharacterReading(reading: string[], text: string, scope: ReadingScope, context?: InlineContext): void {
    // A mark nested in itself (`__a __b__ c__`) shows once.
    const marks = [...new Set(scope.marks)].sort().join();
    const drawn = scope.marks.filter((mark) => DRAWN_ON_WHITESPACE.has(mark)).sort().join();

    for (const char of text) {
        if (!/\s/.test(char)) {
            reading.push([char, marks, scope.link, scope.style].join(READING_KEY_SEPARATOR));
        } else if (context?.readsWhitespace === true && reading.length > 0 && !isWhitespaceReading(reading[reading.length - 1]!)
            && reading[reading.length - 1] !== BREAK_READING) {
            reading.push([" ", drawn, scope.link, ""].join(READING_KEY_SEPARATOR));
        }
    }
}

/**
 * Tells whether a reading unit is a stretch of whitespace ({@link InlineContext.readsWhitespace}).
 *
 * @param unit - The unit.
 * @returns `true` for whitespace.
 */
function isWhitespaceReading(unit: string): boolean {
    return unit.startsWith(" " + READING_KEY_SEPARATOR);
}

/**
 * Appends the reading unit of a line break, dropping whitespace before it,
 * which the viewer does not show at a line's end.
 *
 * @param reading - The reading units so far. Extended in place.
 */
function pushBreakReading(reading: string[]): void {
    if (reading.length > 0 && isWhitespaceReading(reading[reading.length - 1]!)) {
        reading.pop();
    }

    reading.push(BREAK_READING);
}

/**
 * Drops whitespace ending a reading, which the viewer does not show at a block's end.
 *
 * @param reading - The reading units, or `null`.
 * @returns The same array, trimmed in place, or `null`.
 */
function withoutTrailingWhitespace<T extends string[] | null>(reading: T): T {
    while (reading !== null && reading.length > 0 && isWhitespaceReading(reading[reading.length - 1]!)) {
        reading.pop();
    }

    return reading;
}

/**
 * The reading key of a link.
 *
 * @param href - Its destination.
 * @param title - Its title, or `""`.
 * @returns The key.
 */
function linkReading(href: string, title: string): string {
    return href === "" && title === "" ? "" : `${href} "${title}"`;
}

/**
 * The reading unit of an image.
 *
 * @param src - Its source.
 * @param link - The reading key of the link around it.
 * @returns The unit.
 */
function imageReading(src: string, link: string): string {
    return ["\u0002image", src, link].join(READING_KEY_SEPARATOR);
}

// ---------------------------------------------------------------- inline: lines and escaping

/**
 * Assembles the written pieces into lines: merges adjacent text, splits at
 * hard breaks and soft newlines, drops the spaces and tabs at each line's
 * edges, writes each bare autolink in the form its neighbours allow, writes
 * with `_` the emphasis pairs `marked` would mis-pair, escapes the text
 * against its neighbours and, outside single-line contexts, the block
 * starters at each line start.
 *
 * @param pieces - The written pieces.
 * @param context - Where they are written.
 * @param choices - The pairs to switch and the autolinks to write bare.
 * @returns The inline Markdown.
 */
function assembleLines(pieces: Piece[], context: InlineContext, choices: AssemblyChoices = NO_CHOICES): string {
    const lines: Array<{ pieces: LinePiece[]; end: LineEnd | null }> = [{ pieces: [], end: null }];

    for (const piece of pieces) {
        const line = lines[lines.length - 1]!;
        const last = line.pieces[line.pieces.length - 1];

        if (piece.kind === "break" || piece.kind === "newline") {
            line.end = piece;
            lines.push({ pieces: [], end: null });
        } else if (piece.kind === "text" && last?.kind === "text") {
            line.pieces[line.pieces.length - 1] = { kind: "text", text: last.text + piece.text };
        } else {
            line.pieces.push(piece);
        }
    }

    const lineContents = underscoreMispairedEmphasis(
        lines.map((line, index) => resolveAutolinks(
            trimLineEdges(line.pieces, index === 0), choices.bare, line.end?.kind === "break" && line.end.marker === "\\",
        )),
        choices.switched,
    );
    let written = false;

    lineContents.forEach((pieces, index) => {
        lineContents[index] = strayTaskMarkersAsText(pieces, context.inListItem === true && index === 0);
    });

    return lines.map((line, index) => {
        const content = escapeHtmlBlockStart(renderLine(lineContents[index]!, context, !written), lineContents[index]!, index === 0, context);

        written ||= content !== "";

        return content + lineEnding(line.end, content);
    }).join("");
}

/**
 * What a line's end writes after its content: a hard break's marker and a
 * newline; a newline for a soft newline, except after an empty line, where
 * it would leave a blank line and end the paragraph.
 *
 * @param end - The line's end, or `null` for the last line.
 * @param content - The line's rendered content.
 * @returns The text that ends the line.
 */
function lineEnding(end: LineEnd | null, content: string): string {
    if (end === null) {
        return "";
    }

    if (end.kind === "newline") {
        return content === "" ? "" : "\n";
    }

    return lineBreakMarker(end.marker, content) + "\n";
}

/**
 * The marker a hard break writes after `content`. Spaces after an empty
 * line would make it blank and end the paragraph, so it becomes `\` there.
 *
 * @param marker - The break's authored marker.
 * @param content - The line the break ends.
 * @returns The marker to write.
 */
function lineBreakMarker(marker: string, content: string): string {
    return content === "" ? "\\" : marker;
}

/**
 * Drops the spaces and tabs at a line's start and end, so text neither
 * becomes indented code nor a trailing-space hard break. Whitespace that
 * only separates a source run from a line edge is kept as `marked` read
 * it: the indent before a source run starting a continuation line (an
 * indented `<div>` there is inline HTML, at column 0 an HTML block), and
 * one space after a source run ending a line (more would be a hard break).
 *
 * @param pieces - The line's pieces.
 * @param firstLine - Whether this is the block's first line, whose indent
 *   `marked` strips, so it is never kept.
 * @returns The trimmed pieces.
 */
function trimLineEdges(pieces: LinePiece[], firstLine: boolean): LinePiece[] {
    const trimmed = pieces.slice();
    const first = trimmed[0];
    const indentsSource = !firstLine && trimmed[1]?.kind === "source" && first?.kind === "text" && first.text.trim() === "";

    if (first?.kind === "text" && !indentsSource) {
        trimmed[0] = { kind: "text", text: first.text.replace(/^[ \t]+/, "") };
    }

    const lastIndex = trimmed.length - 1;
    const last = trimmed[lastIndex];

    if (last?.kind === "text") {
        const followsSource = lastIndex > 0 && trimmed[lastIndex - 1]?.kind === "source" && last.text.trim() === "";

        trimmed[lastIndex] = { kind: "text", text: followsSource ? " " : last.text.replace(/[ \t]+$/, "") };
    }

    return trimmed.filter((piece) => piece.kind !== "text" || piece.text !== "");
}

/**
 * Writes each autolink piece of a line bare when its neighbours bound it,
 * else in its fallback form. A neighbour bounds it when it is a line edge or
 * starts (after it) or ends (before it) with whitespace; or when it is a
 * delimiter of the marks around it — one opening before it, or closing after
 * it — next to a letter or digit of it, so the delimiter pairs and `marked`
 * reads the URL alone inside the emphasis (`*http://e*4`). A delimiter
 * opening after it is none: `marked` reads a bare URL on across it. Nor is
 * the line's end when a `\` hard break ends the line: the URL would take
 * the backslash in.
 *
 * @param pieces - The line's pieces.
 * @param bare - The autolinks to write bare whatever their neighbours.
 * @param backslashEnd - Whether a `\` hard break ends the line.
 * @returns The pieces, each autolink resolved to syntax.
 */
function resolveAutolinks(pieces: LinePiece[], bare: ReadonlySet<Piece>, backslashEnd: boolean): LinePiece[] {
    const bounds = (neighbour: LinePiece | undefined, edge: string, side: "before" | "after"): boolean => {
        if (neighbour === undefined) {
            return side === "before" || !backslashEnd;
        }

        if (neighbour.kind === "delimiter") {
            return neighbour.opens === (side === "before") && WORD_CHARACTER.test(edge);
        }

        return /\s/.test(side === "before" ? neighbour.text.at(-1) ?? "" : neighbour.text[0] ?? "");
    };

    return pieces.map((piece, index): LinePiece => {
        if (piece.kind !== "autolink") {
            return piece;
        }

        const bounded = bare.has(piece) || (bounds(pieces[index - 1], piece.bare[0] ?? "", "before")
            && bounds(pieces[index + 1], piece.bare.at(-1) ?? "", "after"));

        return { kind: "syntax", text: bounded ? piece.bare : piece.text };
    });
}

/** A bold or italic pair: the indexes of its opening and closing delimiters. */
interface DelimiterPair {
    readonly open:  number;
    readonly close: number;
}

/** What stands between two lines when delimiters are paired across them: whitespace. */
const LINE_SEPARATOR: LinePiece = { kind: "text", text: "\n" };

/**
 * Writes with `_` each bold or italic pair whose `*` delimiters `marked`
 * would pair wrongly with the other mark's `*` run inside it. A `*` run that
 * is both left- and right-flanking (a letter, or punctuation, on both sides)
 * can both open and close; when only one end of an inner pair is such a run,
 * `marked` matches it with the outer run, where CommonMark keeps them apart:
 * `*foo fuzz**bar** baz*` loses its bold and shows two of its `*`. A `_` pair
 * never pairs with a `*` run, so the outer pair switches to `_`. The switch
 * is kept only when every delimiter that could open or close before it still
 * can — `_` cannot where the pair stands next to a letter — else the pair
 * stays `*`. The block's lines are read as one run of pieces, whitespace
 * between them. The pairs in `switched` are then written with the other
 * character.
 *
 * @param lines - Each line's pieces.
 * @param switched - The pairs, by their order of opening, to write with the other delimiter character.
 * @returns Each line's pieces, with the switched delimiters replaced.
 */
function underscoreMispairedEmphasis(lines: readonly LinePiece[][], switched: ReadonlySet<number>): LinePiece[][] {
    const block = lines.flatMap((pieces, index) => (index > 0 ? [LINE_SEPARATOR, ...pieces] : pieces));
    const pairs = delimiterPairs(block);

    for (const outer of pairs) {
        const mispaired = pairs.some((inner) => inner.open > outer.open && inner.close < outer.close
            && starRunFlanksBothWays(block, inner.open) !== starRunFlanksBothWays(block, inner.close));

        if (mispaired) {
            switchToUnderscore(block, outer);
        }
    }

    pairs.forEach((pair, ordinal) => {
        if (switched.has(ordinal)) {
            for (const index of [pair.open, pair.close]) {
                const piece = block[index] as Extract<LinePiece, { kind: "delimiter" }>;
                const other = piece.text[0] === "*" ? UNDERSCORE_DELIMITERS[piece.mark]! : MARK_DELIMITERS[piece.mark];

                block[index] = { ...piece, text: other };
            }
        }
    });

    let start = 0;

    return lines.map((pieces) => {
        const switched = block.slice(start, start + pieces.length);

        start += pieces.length + 1;

        return switched;
    });
}

/**
 * Pairs the bold and italic delimiters of a block. Marks open and close in
 * stack order, so each closing delimiter pairs with the last unpaired
 * opening one.
 *
 * @param pieces - The block's pieces.
 * @returns The bold and italic pairs, in the order they open.
 */
function delimiterPairs(pieces: readonly LinePiece[]): DelimiterPair[] {
    const pairs: DelimiterPair[] = [];
    const open: number[] = [];

    pieces.forEach((piece, index) => {
        if (piece.kind !== "delimiter" || UNDERSCORE_DELIMITERS[piece.mark] === undefined) {
            return;
        }

        if (piece.opens) {
            open.push(index);
        } else if (open.length > 0) {
            pairs.push({ open: open.pop()!, close: index });
        }
    });

    return pairs.sort((a, b) => a.open - b.open);
}

/**
 * Switches a pair to its `_` delimiters, when every delimiter of the block
 * that could open or close before can still do so, the pair's own included.
 *
 * @param pieces - The block's pieces. Updated in place when the switch is kept.
 * @param pair - The pair to switch.
 */
function switchToUnderscore(pieces: LinePiece[], pair: DelimiterPair): void {
    const working = flankingDelimiters(pieces);
    const switched = pieces.slice();

    for (const index of [pair.open, pair.close]) {
        const piece = switched[index] as Extract<LinePiece, { kind: "delimiter" }>;

        switched[index] = { ...piece, text: UNDERSCORE_DELIMITERS[piece.mark]! };
    }

    const after = flankingDelimiters(switched);
    const kept = [...working, pair.open, pair.close].every((index) => after.has(index));

    if (kept) {
        pieces.splice(0, pieces.length, ...switched);
    }
}

/**
 * Finds the delimiters that can do what they are written for: open, for an
 * opening one, or close. CommonMark's flanking rules decide it from the
 * characters around the delimiter run each one belongs to — the run of
 * adjacent delimiters written with the same character.
 *
 * @param pieces - The block's pieces.
 * @returns The indexes of the delimiters that can.
 */
function flankingDelimiters(pieces: readonly LinePiece[]): Set<number> {
    const flanking = new Set<number>();

    pieces.forEach((piece, index) => {
        if (piece.kind !== "delimiter") {
            return;
        }

        const { left, right, before, after } = delimiterRun(pieces, index);
        const run = piece.text[0]!;
        const opens = left && (run !== "_" || !right || isFlankingPunctuation(before, run));
        const closes = right && (run !== "_" || !left || isFlankingPunctuation(after, run));

        if (piece.opens ? opens : closes) {
            flanking.add(index);
        }
    });

    return flanking;
}

/**
 * Tells whether the `*` run a delimiter belongs to is both left- and
 * right-flanking, so it could either open or close.
 *
 * @param pieces - The block's pieces.
 * @param index - The delimiter's index.
 * @returns `true` for a `*` run that flanks both ways.
 */
function starRunFlanksBothWays(pieces: readonly LinePiece[], index: number): boolean {
    const run = delimiterRun(pieces, index);

    return pieces[index]!.text[0] === "*" && run.left && run.right;
}

/**
 * Reads the delimiter run a delimiter belongs to: the characters on either
 * side of it, and whether it is left- and right-flanking. Escaping never
 * changes a character's class, so the unescaped text tells.
 *
 * @param pieces - The block's pieces.
 * @param index - The delimiter's index.
 * @returns The characters before and after the run (`\n` at an edge) and its flanking.
 */
function delimiterRun(pieces: readonly LinePiece[], index: number): { before: string; after: string; left: boolean; right: boolean } {
    const char = pieces[index]!.text[0]!;
    const inRun = (piece: LinePiece | undefined): boolean => piece?.kind === "delimiter" && piece.text[0] === char;
    let first = index;
    let last = index;

    while (inRun(pieces[first - 1])) {
        first -= 1;
    }

    while (inRun(pieces[last + 1])) {
        last += 1;
    }

    const before = /.$/su.exec(pieces[first - 1]?.text ?? "")?.[0] ?? "\n";
    const after = /^./su.exec(pieces[last + 1]?.text ?? "")?.[0] ?? "\n";
    const space = (c: string): boolean => /\s/.test(c);
    const punctuation = (c: string): boolean => isFlankingPunctuation(c, char);

    return {
        before, after,
        left:  !space(after) && (!punctuation(after) || space(before) || punctuation(before)),
        right: !space(before) && (!punctuation(before) || space(after) || punctuation(after)),
    };
}

/**
 * Tells whether a character counts as punctuation next to a delimiter run:
 * a Unicode punctuation or symbol character, except `~` next to a `*` run,
 * which `marked`'s GFM rules count as a letter so `*~~a~~*` holds a
 * strikethrough.
 *
 * @param char - The character next to the run.
 * @param run - The run's delimiter character.
 * @returns `true` when it counts as punctuation.
 */
function isFlankingPunctuation(char: string, run: string): boolean {
    return FLANKING_PUNCTUATION.test(char) && !(run === "*" && char === "~");
}

/**
 * Writes a task item's checkbox kept as source as the text it shows wherever
 * it is not that item's checkbox: anywhere but the start of a list item's
 * first line, or there with no text after it. The viewer reads no checkbox
 * there, but `[x]` as text, or as a reference link where a definition names
 * it — so text typed before it, a line break moving it off the first line,
 * or a paste carrying it elsewhere leaves it literal.
 *
 * @param pieces - A line's pieces.
 * @param itemFirstLine - Whether the line is a list item's first line.
 * @returns The pieces, each stray checkbox turned into its text.
 */
function strayTaskMarkersAsText(pieces: LinePiece[], itemFirstLine: boolean): LinePiece[] {
    const isCheckbox = (index: number): boolean => itemFirstLine && index === 0 && pieces.length > 1;

    return pieces.map((piece, index) => {
        if (piece.kind !== "source" || !TASK_MARKER_SOURCE.test(piece.text) || isCheckbox(index)) {
            return piece;
        }

        return { kind: "text", text: index === pieces.length - 1 ? piece.text.trimEnd() : piece.text };
    });
}

/**
 * Renders one line's pieces, escaping each text against the characters on
 * either side of it, and writing a shortcut reference collapsed where the
 * next character would join it to another construct.
 *
 * @param pieces - The line's pieces.
 * @param context - Where the line is written.
 * @param startsBlock - Whether nothing of the block has been written before
 *   this line, so it is where a link reference definition could start.
 * @returns The line.
 */
function renderLine(pieces: LinePiece[], context: InlineContext, startsBlock: boolean): string {
    const rendered = pieces.map((piece, index) => {
        if (piece.kind === "reference" || piece.kind === "source") {
            return piece.shortcut === true && joinsShortcut(pieces, index, startsBlock, context) ? piece.text + "[]" : piece.text;
        }

        if (piece.kind !== "text") {
            return piece.text;
        }

        const previous = pieces[index - 1];

        // A reference's closing `]` is never read as a link's or span's
        // opening bracket, so it is no reason to escape a `(` or `{` after it.
        const before = previous === undefined ? "\n" : previous.kind === "reference" ? "" : previous.text.slice(-1);
        const after = pieces[index + 1]?.text[0] ?? "\n";

        return escapeText(piece.text, before, after, context);
    }).join("");

    return !context.singleLine && pieces[0]?.kind === "text" ? escapeLineStart(rendered) : rendered;
}

/**
 * Escapes the `<` a line opens with when the line starts with a source run
 * (inline HTML kept as written, after at most its kept indent) that `marked`
 * would read there as the start of an HTML block — a block tag, a comment, a
 * tag alone on a block's first line — so the line stays text of its block,
 * as the editor shows it, instead of turning the block into raw HTML. The
 * viewer shows inline HTML as its text, so the escaped `<` shows the same.
 * Decided by lexing the line where it stands: alone for a block's first line,
 * after a paragraph line for a continuation line (where only some HTML block
 * starts interrupt the paragraph) — in a list item, after a paragraph line
 * of the item, whose content an HTML block start can end where a top-level
 * paragraph would take it in. An escaped continuation line loses its indent,
 * which the next load drops from the text it now is.
 *
 * @param line - The rendered line.
 * @param pieces - Its pieces.
 * @param firstLine - Whether this is the block's first line.
 * @param context - Where the line is written.
 * @returns The line, its leading `<` escaped when it would open an HTML block.
 */
function escapeHtmlBlockStart(line: string, pieces: readonly LinePiece[], firstLine: boolean, context: InlineContext): string {
    const indented = pieces[0]?.kind === "text" && pieces[0].text.trim() === "";
    const opening = pieces[indented ? 1 : 0];

    if (context.singleLine || opening?.kind !== "source" || !opening.text.startsWith("<")) {
        return line;
    }

    const probe = (firstLine ? "" : PARAGRAPH_PROBE_LINE + "\n") + line;
    const tokens = lexMarkdown(probe).filter((token) => token.type !== "space");
    // A list item's content ends at an HTML block start that a paragraph at the top level takes in.
    const itemProbe = `- ${PARAGRAPH_PROBE_LINE}\n  ${line}`;
    const endsItem = context.inListItem === true && !firstLine && JSON.stringify(lexMarkdown(itemProbe)).includes('"type":"html"');

    if (tokens.length === 1 && tokens[0]!.type === "paragraph" && !endsItem) {
        return line;
    }

    // Escaped, the run is text, whose indent the next load drops; dropping it here keeps the save stable.
    return firstLine ? line.replace("<", "\\<") : "\\" + line.trimStart();
}

/**
 * Tells whether a shortcut reference `[label]` — a reference link's, or a
 * source run's `[label]` or `![label]` — would join what follows it:
 * a `(` (an inline link's destination), a `{` (a styled span's attributes) or
 * a `[` (a full reference's second bracket); or, at the start of a block, a
 * `:` (a link reference definition); or, opening a list item's text, the
 * whitespace that makes a `[ ]`, `[x]` or `[X]` a task item's checkbox. Text
 * escapes its own `[`, so only its `(`, `{`, `:` and whitespace count.
 *
 * @param pieces - The line's pieces.
 * @param index - The shortcut's index in them.
 * @param startsBlock - Whether the line is the first the block writes.
 * @param context - Where the line is written.
 * @returns `true` when the shortcut must be written `[label][]`.
 */
function joinsShortcut(pieces: LinePiece[], index: number, startsBlock: boolean, context: InlineContext): boolean {
    const next = pieces[index + 1];
    const char = next?.text[0] ?? "";
    const opensItem = context.inListItem === true && startsBlock && index === 0;

    if (next === undefined || char === "") {
        return false;
    }

    if (opensItem && /\s/.test(char) && TASK_CHECKBOX_SHORTCUT.test(pieces[index]!.text)) {
        return true;
    }

    if (next.kind === "text") {
        return char === "(" || char === "{" || (char === ":" && startsBlock && index === 0);
    }

    return AFTER_SHORTCUT_GUARDED.includes(char);
}

/**
 * Escapes text so `marked` reads it back as the same characters, escaping
 * only where a character could start a construct.
 *
 * @param text - The text.
 * @param before - The output character before it (`\n` at a line start).
 * @param after - The output character after it (`\n` at a line end).
 * @param context - Where it is written.
 * @returns The escaped text.
 */
function escapeText(text: string, before: string, after: string, context: InlineContext): string {
    let escaped = "";

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!;

        const site: EscapeSite = {
            text, index, context,
            previous: index > 0 ? text[index - 1]! : before,
            next:     index < text.length - 1 ? text[index + 1]! : after,
        };

        escaped += needsEscape(char, site) ? "\\" + char : char;
    }

    return escaped;
}

/** One character's surroundings, as {@link needsEscape} reads them. */
interface EscapeSite {
    readonly text:     string;
    readonly index:    number;
    readonly previous: string;
    readonly next:     string;
    readonly context:  InlineContext;
}

/**
 * Tells whether a character must be escaped where it stands: an emphasis,
 * code or bracket character always; a `\` before punctuation or at a run's
 * end; a `_` that is not intraword; a tag-shaped `<`; a `+` next to a `+`
 * (underline); a `|` in a table cell; the `:` of a bare URL scheme, the `.`
 * of `www.` and the `@` of an email address (GFM autolinks); a `!` just
 * before a link (an image); and a `(` or `{` after a `]` or an image's `)`
 * — `marked` unescapes the brackets of link text before reading it, so
 * `\]` followed by `(` or `{` would otherwise become a link or span there.
 *
 * @param char - The character.
 * @param site - Its surroundings.
 * @returns `true` when it could start a construct the text does not hold.
 */
function needsEscape(char: string, site: EscapeSite): boolean {
    if (char === "~" && site.context.looseTildes === true) {
        return site.previous === "~" || site.next === "~";
    }

    if (ALWAYS_ESCAPED.has(char)) {
        return true;
    }

    const isLast = site.index === site.text.length - 1;

    switch (char) {
        case "\\": return isLast || ASCII_PUNCTUATION.test(site.next) || (site.context.inTableCell && site.next === "n");
        case "_":  return !(WORD_CHARACTER.test(site.previous) && WORD_CHARACTER.test(site.next));
        case "<":  return site.context.escapedAngles === true || /^[A-Za-z/!?]$/.test(site.next);
        case "+":  return site.previous === "+" || site.next === "+";
        case "|":  return site.context.inTableCell;
        case ":":  return BARE_URL_SCHEME.test(site.text.slice(0, site.index)) && site.text.startsWith("//", site.index + 1);
        case ".":  return BARE_WWW_PREFIX.test(site.text.slice(0, site.index));
        case "@":  return EMAIL_LOCAL_CHARACTER.test(site.previous) && EMAIL_DOMAIN_CHARACTER.test(site.next);
        case "!":  return isLast && site.next === "[";
        case "(":  return site.previous === "]";
        case "{":  return site.previous === "]" || (site.index === 0 && site.previous === ")");
        default:   return false;
    }
}

/**
 * Escapes the block starter a line opens with: one of the block-start
 * characters, or the `.` / `)` of an ordered-list number.
 *
 * @param line - The rendered line, its text already escaped.
 * @returns The line, safe at a line start.
 */
function escapeLineStart(line: string): string {
    if (LINE_START_ESCAPED.has(line[0] ?? "")) {
        return "\\" + line;
    }

    const number = ORDERED_LIST_MARKER.exec(line);

    return number === null ? line : number[1] + "\\" + line.slice(number[1]!.length);
}
