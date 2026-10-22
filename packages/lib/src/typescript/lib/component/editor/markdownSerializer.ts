// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    $findMatchingParent, $getRoot, $getState, $isElementNode, $isLineBreakNode, $isParagraphNode, $isTextNode, TEXT_TYPE_TO_FORMAT,
} from "lexical";
import type { ElementFormatType, ElementNode, LexicalNode, NodeKey, TextFormatType, TextNode } from "lexical";
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
    blockStyleToAttributes, breaksColumn, cssTextToAttributes, FENCE_ATTRIBUTE_GROUP, FENCE_COLUMNS_KEYWORD, formatAttributes,
    joinColumnSections, parseAttributes, resolveBlockStyle,
    resolveImageSpec, resolveSpanStyle, spanStyleToAttributes,
} from "~/component/display/markdownAttributes.js";
import {
    FULL_REFERENCE, lexMarkdown, lexMarkdownInline, lexMarkdownLinkDefinitions, lexMarkdownWithDefinitions, linkLabelKey, SHORT_REFERENCE,
} from "~/component/display/markdownExtensions.js";
import type { MdBlockToken, MdImageToken } from "~/component/display/markdownExtensions.js";
import { needsAngleBrackets } from "~/component/display/markdownDestinations.js";
import { headingSlug } from "~/component/display/markdownHeadingIds.js";
import { holdsLineContent } from "~/component/display/markdownLineContent.js";
import { prefixTabLines } from "~/component/display/markdownTabs.js";
import {
    decodeEscapesAndCharacterReferences, escapeCharacterReferences, startsWithCharacterReference,
} from "~/component/display/markdownCharacterReferences.js";
import { CELL_LINE_BREAK_TAG } from "~/component/display/markdownTableExtension.js";
import type { MdTableToken } from "~/component/display/markdownTableExtension.js";
import { $isMarkdownBlockNode, $isMarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import type { MarkdownBlockNode, MarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import { $isMarkdownListItemTextNode } from "~/component/editor/markdownListItemNode.js";
import { $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import type { MarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import {
    bareAutolinkState, codeInfoState, fenceOpeningState, hardBreakMarkerState, imageAttributesState, imageMarksState, imageWrittenState, KEPT_SOURCE_WRITES_LINK,
    KEPT_SOURCE_WRITES_STYLE, keptSourceState, listLooseState, listMarkerState, NESTED_LINK_WRITES_STYLE, nestedLinkGroupState,
    nestedLinkState, spanAttributesState,
} from "~/component/editor/markdownNodeState.js";
import type { KeptSource } from "~/component/editor/markdownNodeState.js";
import { $isReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import type { ReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import { $horizontalRuleMarkdown, $isMarkdownHorizontalRuleNode } from "~/component/editor/markdownHorizontalRuleNode.js";
import { $emptyTaskItemMarkdown, $isMarkdownTaskCheckboxNode, $openingCheckbox, $taskMarkerMarkdown } from "~/component/editor/markdownTaskCheckboxNode.js";
import { $isMarkdownRawBlockNode, $isMarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import type { MarkdownRawBlockNode, MarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";
import { columnBlockKey, EMPTY_SOURCE_MAP, quoteBlockKey } from "~/component/editor/markdownSourceMap.js";
import type { MarkdownSourceQuoteBlock } from "~/component/editor/markdownSourceMap.js";
import type {
    MarkdownSourceBlock, MarkdownSourceCodeFrame, MarkdownSourceItem, MarkdownSourceLoad, MarkdownSourceMap, MarkdownSourcePart,
} from "~/component/editor/markdownSourceMap.js";

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

/** The indentation CommonMark ignores before a block: up to three spaces (four make indented code). */
const MAX_IGNORED_INDENT = 3;

/** The indentation before a block's first line that CommonMark ignores ({@link MAX_IGNORED_INDENT} spaces at most). */
const INDENT_BEFORE_BLOCK = /^ {1,3}/;

/** The whitespace before each line of a paragraph, which `marked` keeps in its text and the viewer does not show. */
const INDENT_BEFORE_LINE = /^[ \t]+/gm;

/** The lines holding nothing but whitespace that open a text, each with its line end. */
const BLANK_FIRST_LINES = /^(?:[ \t]*\n)+/;

/** The lines holding nothing but whitespace that end a text, each with the line end before it. */
const BLANK_LAST_LINES = /(?:\n[ \t]*)+$/;

/**
 * The line end a raw block only a second blank line ends is written with
 * while a block follows it: no written form of a raw block ends in one of
 * its own.
 */
const SECOND_BLANK_LINE_END = /\n$/;

/** The bullet the probes of {@link rawBlockStandsInItem} are written with: the one a list made in the editor writes. */
const PROBE_MARKER = "-";

/** What {@link rawBlockStandsInItem} found, by item form; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries. */
const STANDS_IN_ITEM = new Map<string, boolean>();

/** The definitions source ({@link $definitionsSource}) of a document holding no raw block. */
export const NO_DEFINITIONS_SOURCE = "[]";

/** The definitions each raw-block text holds, read alone; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries. */
const DEFINITIONS_READ = new Map<string, Links>();

/**
 * What {@link rawBlockAtMargin} answered for each text it had to lex, by
 * kind and text; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries.
 * Every keystroke and every save ask for each raw block's written form.
 */
const AT_MARGIN = new Map<string, string>();

/** The image forms {@link readImageForm} read that name no definition; cleared when it holds {@link RUNS_ON_CACHE_SIZE} entries. */
const IMAGE_FORMS_READ = new Map<string, MdImageToken | null>();

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
 * Source that starts with a line opening a `:::` fence (`:::` and more on
 * the line, as the fence tokenizer reads it): loaded as a paragraph, the
 * fence had no closing line, but text written after the block can hold one
 * (a raw block's `:::` line), and the two then read as one fence.
 */
const FENCE_OPENING_START = /^[ \t]*:::[^\n]*\S/;

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
export const SETEXT_H2_UNDERLINE = "---";

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
 * paragraphs. Mirrors the viewer's own `CELL_PARAGRAPH_BREAK`, the only
 * sequence it splits a cell's text on (one `<br>` per boundary) — a lone
 * {@link CELL_LINE_BREAK} renders as literal text — and the importer reads it
 * back as a paragraph boundary.
 */
const CELL_PARAGRAPH_BREAK = CELL_LINE_BREAK + CELL_LINE_BREAK;

/**
 * What a table cell writes for a line break, or a newline, inside one of its
 * paragraphs: the HTML line break GFM uses in a cell, which the viewer
 * renders as a line break there and the importer loads as one
 * ({@link CELL_LINE_BREAK_TAG}).
 */
const CELL_HARD_BREAK = "<br>";

/**
 * The bullet a bullet list is written with when its first line is a bare
 * marker right under a line of text, where a bare `-` would be a setext
 * underline.
 */
export const UNDER_TEXT_BULLET = "*";

/** The whole-cell texts the table import reads as merge continuations, so a cell holding one is escaped. */
const MERGE_MARKERS: ReadonlySet<string> = new Set(["<<", "^^"]);

/**
 * The shortest code fence CommonMark accepts (three backticks or tildes). A
 * fixed grammar constant, not a tuning value: a fence only grows past it when
 * the code itself holds a line starting with that many of its character.
 */
const MIN_CODE_FENCE_LENGTH = 3;

/**
 * A code line's leading backtick and tilde runs, at any indentation: the
 * `:::` fence scan reads a closing fence at any indentation, so the written
 * fence must outrun every one.
 */
const CODE_LINE_FENCE_RUN = /^[ \t]*(`+|~+)/;

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

/** The delimiter characters a lean writing leaves bare unless the block holds two runs of one ({@link leanBlock}). */
const PAIRING_DELIMITERS: readonly string[] = ["*", "_", "~", "`", "+"];

/** A run of each pairing delimiter character; the underline grammar reads only a run of two or more `+`. */
const DELIMITER_RUN: Readonly<Record<string, RegExp>> = { "*": /\*+/g, "_": /_+/g, "~": /~+/g, "`": /`+/g, "+": /\+{2,}/g };

/** The characters whose run a delimiter run next to it joins, or changes the flanking of. */
const DELIMITER_CHARACTERS = "*_~`+";

/** An ATX heading's opening: one to six `#`, then whitespace or the line's end. */
const ATX_HEADING_START = /^#{1,6}(?:[ \t]|$)/;

/** A bullet list item's marker: `-`, `+` or `*`, then whitespace or the line's end. */
const BULLET_MARKER_START = /^[-+*](?:[ \t]|$)/;

/** An ordered list item's marker: one to nine digits, `.` or `)`, then whitespace or the line's end. */
const ORDERED_MARKER_START = /^\d{1,9}[.)](?:[ \t]|$)/;

/** A setext heading's underline: a run of `=` or of `-`, then spaces or tabs. */
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;

/** A GFM table's delimiter row: dash cells with optional alignment colons, pipes between them and optionally around. */
const TABLE_DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A `:::` fence line: an opener, with anything after it, or a closer. */
const COLUMN_FENCE_LINE = /^:::/;

/** A column separator line: `|||` alone. */
const COLUMN_SEPARATOR_LINE = /^\|\|\|[ \t]*$/;

/** A code fence's opening run: three or more backticks or tildes. */
const CODE_FENCE_START = /^(?:`{3,}|~{3,})/;

/** One whitespace character, as a delimiter run's neighbour. */
const WHITESPACE = /^\s$/;

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

/** A text of spaces and tabs only (or nothing): what `marked` strips from a line's edge, unlike a no-break space. */
const ASCII_BLANK = /^[ \t]*$/;

/** The no-break space (U+00A0), which `marked` trims like any whitespace at some edges ({@link noBreakSpaceEntities}). */
const NO_BREAK_SPACE = "\u00A0";

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

/**
 * How many answers {@link leanReadsAsFull} remembers. The editor saves the
 * whole document after every update, so it asks again for every block that
 * leaves out an escape: the memory holds one answer for each such block of
 * the largest documents the editor's cost measurements use (8,000 blocks),
 * or it would start over on every save and lex them all again.
 */
const LEAN_READING_CACHE_SIZE = 8192;

/** {@link leanReadsAsFull}'s answers, by block kind, definitions and the two writings; cleared when it holds {@link LEAN_READING_CACHE_SIZE} entries. */
const LEAN_READS = new Map<string, boolean>();

/**
 * The definitions of the save in progress, which {@link leanReadsAsFull}
 * lexes with: a block's own definitions are `null` when no reference link
 * needs them, yet `marked` masks every `[label]` stretch a definition names
 * before it pairs emphasis, so a lean writing is read under them all. Set by
 * {@link $serializeTopLevelBlocks}, as the importer sets its own definitions
 * (`IMPORT_DEFINITIONS`); outside one, the editor state's are read with
 * {@link $readDefinitions}.
 */
const SAVE_DEFINITIONS: { current: DocumentDefinitions | null } = { current: null };

/**
 * What the load's fingerprint pass stores while it serializes the document in
 * the standard form: each nested part's standard form, keyed by node.
 */
export interface RecordedFingerprints {
    /** An item's fingerprint, a row's standard line, a delimiter row's (keyed by its table), a code frame's info string. */
    readonly partFingerprints:  Map<NodeKey, string>;
    /** Every block's standard form, as a block list writes it: a column block's fingerprint. */
    readonly blockFingerprints: Map<NodeKey, string>;
    /** A row's standard cell texts. */
    readonly cellFingerprints:  Map<NodeKey, readonly string[]>;
    /** An item's standard lines under the marker it is written with, to tell whether its source differs. */
    readonly standardItems:     Map<NodeKey, string>;
}

/**
 * How the serializer treats nested parts while it writes: it records each
 * part's standard form (the load's fingerprint pass; the output is the
 * standard form), or writes the parts whose standard form still equals their
 * fingerprint as their source (a save of an edited block).
 */
type PartsContext =
    | ({ readonly mode: "record" } & RecordedFingerprints)
    | { readonly mode: "write"; readonly parts: ReadonlyMap<NodeKey, MarkdownSourcePart>; readonly column: NodeKey | null };

/** A write context. */
type WriteContext = Extract<PartsContext, { mode: "write" }>;

/**
 * The running pass's parts context; `null` writes the standard form. Set only
 * through {@link withPartsContext}.
 */
const SAVE_PARTS: { current: PartsContext | null } = { current: null };

/**
 * The standard-form blocks of every list item a save has written in the
 * standard form, keyed by item. A save writes the standard form of the whole
 * document, then an edited list again part by part; each level of that second
 * write needs the standard form of its items to tell which are unchanged, and
 * writing it afresh at every level made the cost grow with the square of the
 * depth. `null` outside a save. A pass that records or writes parts neither
 * reads nor fills it.
 */
const STANDARD_ITEM_BLOCKS: { current: Map<NodeKey, ItemBlock[]> | null } = { current: null };

/**
 * The standard-form cell texts of every table row a save has written in the
 * standard form, keyed by row: a table written part by part reads them again
 * to compare each with its fingerprint. `null` outside a save.
 */
const STANDARD_ROW_TEXTS: { current: Map<NodeKey, string[]> | null } = { current: null };

/**
 * The standard text of every list a save has written in the standard form,
 * with how it was kept apart from its neighbours, keyed by list. Choosing that
 * reads the neighbours with the lexer, so a list inside a column, which a save
 * writes in the standard form with its fence and again part by part, is
 * chosen once. `null` outside a save.
 */
const STANDARD_LIST_TEXTS: { current: Map<NodeKey, StandardListText> | null } = { current: null };

/** What {@link keepNestedListsApart} did to one block of an item. */
interface KeptApartChoice {
    /** Whether {@link LIST_SEPARATOR} was written before the block. */
    readonly separatorBefore: boolean;
    /** The other bullet or delimiter a nested list was written with; `undefined` for its own. */
    readonly marker:          string | undefined;
}

/**
 * What {@link keepNestedListsApart} made of an item's blocks, keyed by the
 * array of blocks: it reads the neighbours of each nested list with the
 * lexer, so a save, which asks again for the same blocks to compare an item
 * with its fingerprint and for the blocks of the same item written part by
 * part, takes the choices of the first answer.
 */
const KEPT_APART = new WeakMap<readonly ItemBlock[], { readonly kept: ItemBlock[]; readonly choices: KeptApartChoice[] }>();

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

/** A blank line in a link title: a line break, then whitespace alone up to the next one. */
const BLANK_LINE_IN_TITLE = /\n[ \t]*\n/;

// ---------------------------------------------------------------- types

/** Where inline content is being written. */
interface InlineContext {
    /** The content cannot span lines (headings, table cells). */
    readonly singleLine: boolean;
    /** Escape every `|`; a `\` before `n` is escaped; a `LineBreakNode` writes `<br>`. */
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
     * The content is a paragraph after a list item's text. `marked` reads all
     * of an item line by line, so a continuation line opening an HTML block
     * ends that paragraph too; its first line, unlike the item's own, holds
     * no task checkbox.
     */
    readonly inItemParagraph?: boolean;
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
     * Write the lean escapes: an escape {@link needsEscape} or
     * {@link escapeLineStart} asks for is left out where the character cannot
     * start anything where it stands ({@link leanKeepsEscape},
     * {@link leanLineStartEscaped}). Set only for a writing that is then
     * checked against the writing with every escape ({@link leanOrFull}).
     */
    readonly lean?: boolean;
    /**
     * The Markdown joins Markdown already written around it — a raw block's
     * or code block's text — which neither the lean rules nor their check
     * see: every escape is written.
     */
    readonly joinsMarkdown?: boolean;
    /**
     * The Markdown is joined into a raw or code block's text, which holds no
     * line edge of its own: a no-break space is written as the character.
     * Distinct from {@link joinsMarkdown}, which also covers a setext
     * heading's and a multi-paragraph cell's writing, whose edges `marked`
     * trims.
     */
    readonly joinsIntoRawBlock?: boolean;
    /** `marked` trims each line's edges of the content (a setext heading's lines), as it does a single-line block's. */
    readonly trimsLineEdges?: boolean;
    /**
     * The character the content's first line follows, for content written
     * after text already on that line (a raw block's or code block's line it
     * joins). That line is escaped against it and takes no escape a line's
     * start needs: no block starter, HTML block start, link reference
     * definition opens there. Absent when the content opens
     * its line.
     */
    readonly continuesAfter?: string;
    /**
     * The saved document's link reference definitions, as the viewer resolves
     * them; `null` when the document holds no reference link to resolve.
     */
    readonly definitions: Links | null;
}

/** The context of a paragraph or list item. */
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
    | { kind: "image"; node: MarkdownImageNode; marks: Mark[]; link: LinkNode | null; member?: KeptMember }
    | { kind: "break"; marker: string; link: LinkNode | null; member?: KeptMember };

/** A run of an inline construct kept as written ({@link keptSourceState}), as flattened. */
interface KeptMember {
    readonly kept:   KeptSource;
    /** The Markdown the run writes. */
    readonly source: string;
    /** What the run shows, as segments. */
    readonly shown:  Segment[];
    /** Whether the run still shows what it did at load (an image keeps its source, alt text, title and size). */
    readonly intact: boolean;
}

/** One block of a list item's content, before its indentation. */
interface ItemBlock {
    /** The block's Markdown. */
    readonly markdown: string;
    /** Whether it is a nested list, written right under the item's text or the list before it. */
    readonly isList: boolean;
    /** Whether it is text: the item's text, or a further paragraph. */
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
    | { kind: "reference"; text: string; shortcut: boolean; image?: boolean } // `[label]` or `[label][]`, written as is; `image` for a shortcut or collapsed reference image, whose `]` a `{` can attach a size group to
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
    /**
     * For a list, table, code block or fence a save writes part by part: its
     * text with its unedited parts as their source.
     */
    readonly written?: string;
}

/** A top-level block as a save writes it. */
interface WrittenBlock {
    /** The block's node. */
    readonly node:     LexicalNode;
    /** The block's source at load when it is written as that source, else `undefined`. */
    readonly source:   MarkdownSourceBlock | undefined;
    /**
     * What is written: the source, with one more line end where a raw block needs its second blank line
     * (`takesInBlockAfter`), or the standard output.
     */
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

/** Where one top-level block stands in a save. */
export interface WrittenBlockPlace {
    /** The block's node key. */
    readonly key:   NodeKey;
    /** The start offset of its written text in the save. */
    readonly start: number;
    /** The end offset of its written text in the save. */
    readonly end:   number;
}

/** A save, with where each top-level block it writes stands in it. */
export interface MarkdownWithPlaces {
    /** The Markdown. */
    readonly text:   string;
    /** The blocks the save writes, in order; a block that writes nothing has no entry. */
    readonly places: readonly WrittenBlockPlace[];
}

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
    return $serializeMarkdownWithPlaces(sourceMap).text;
}

/**
 * Serializes the document as {@link $serializeMarkdown} does, and reports
 * where each top-level block it writes stands in the text.
 *
 * @param sourceMap - The source map of the editor's imports.
 * @returns The Markdown, with the offsets of each written block.
 */
export function $serializeMarkdownWithPlaces(sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP): MarkdownWithPlaces {
    const definitions = $readDefinitions();
    const parts = $serializeTopLevelBlocks(definitions, sourceMap);
    const load = documentLoad(parts, sourceMap);
    const blocks = writtenBlocks(parts, sourceMap, definitions);

    if (blocks.length === 0) {
        return { text: load.blockCount === 0 ? load.prefix : "", places: [] };
    }

    return assembleDocumentWithPlaces(blocks, load);
}

/**
 * Serializes each of the root's children in the standard form, under the
 * document's link reference definitions, a list next to a raw block or right
 * after another list written so it stays its own list
 * ({@link serializeListApart}). The import takes a
 * block's fingerprint and a save its standard output from this one function,
 * so the two are computed identically.
 *
 * @param documentDefinitions - The document's definitions
 *   ({@link $readDefinitions}); the block serializers take their
 *   {@link DocumentDefinitions.forBlocks}, and a lean writing is read under
 *   all of them.
 * @param sourceMap - The source map of the editor's imports. With it, a
 *   list, table, code block or fence whose standard form differs from its
 *   fingerprint, and that holds a part with a source other than its standard
 *   form, is also written part by part ({@link StandardBlock.written}); without
 *   it no part is written.
 * @returns One entry per root child, in document order.
 */
export function $serializeTopLevelBlocks(
    documentDefinitions: DocumentDefinitions, sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP,
): StandardBlock[] {
    SAVE_DEFINITIONS.current = documentDefinitions;
    STANDARD_ITEM_BLOCKS.current = new Map();
    STANDARD_ROW_TEXTS.current = new Map();
    STANDARD_LIST_TEXTS.current = new Map();

    try {
        return blockListParts($getRoot().getChildren(), documentDefinitions.forBlocks, sourceMap, null);
    } finally {
        SAVE_DEFINITIONS.current = null;
        STANDARD_ITEM_BLOCKS.current = null;
        STANDARD_ROW_TEXTS.current = null;
        STANDARD_LIST_TEXTS.current = null;
    }
}

/**
 * The load's fingerprint pass: serializes the document in the standard form
 * as {@link $serializeTopLevelBlocks} does, and stores each nested part's
 * standard form, each column block's included, in `record`. The output is the
 * standard form, so the load takes a top-level block's fingerprint from the
 * same pass.
 *
 * @param documentDefinitions - The document's definitions ({@link $readDefinitions}).
 * @param record - The maps the pass fills, keyed by node.
 * @returns One entry per root child, in document order.
 */
export function $recordPartFingerprints(documentDefinitions: DocumentDefinitions, record: RecordedFingerprints): StandardBlock[] {
    return withPartsContext({ mode: "record", ...record }, () => $serializeTopLevelBlocks(documentDefinitions));
}

/**
 * Runs `write` under another parts context, restoring the one before it, also
 * when `write` throws.
 *
 * @param context - The context to run under; `null` writes the standard form.
 * @param write - What to run.
 * @returns What `write` returns.
 */
function withPartsContext<T>(context: PartsContext | null, write: () => T): T {
    const previous = SAVE_PARTS.current;

    SAVE_PARTS.current = context;

    try {
        return write();
    } finally {
        SAVE_PARTS.current = previous;
    }
}

/**
 * Tells whether a block can hold nested parts a save writes as their source.
 *
 * @param node - A block.
 * @returns `true` for a list, a table, a code block, a `:::` fence or a quote.
 */
function $holdsParts(node: LexicalNode): boolean {
    return $isListNode(node) || $isTableNode(node) || $isCodeNode(node) || $isMarkdownBlockNode(node) || $isQuoteNode(node);
}

/**
 * A block's standard text, and for a list how it was kept apart. A list the
 * save has already written in the standard form is not chosen again.
 *
 * @param node - The block.
 * @param previousJoinable - The Markdown of the raw block or list written right before it, if one was.
 * @param following - The blocks after it.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The block's text and the choice.
 */
function standardBlockText(node: LexicalNode, previousJoinable: string | undefined, following: LexicalNode[], definitions: Links | null): StandardListText {
    if (!$isListNode(node)) {
        return { text: serializeBlock(node, definitions), apart: null };
    }

    const cache = STANDARD_LIST_TEXTS.current;
    const mode = SAVE_PARTS.current?.mode;
    const cached = cache !== null && mode !== "record" ? cache.get(node.getKey()) : undefined;

    if (cached !== undefined) {
        return cached;
    }

    const chosen = chooseListApart(node, previousJoinable, following, definitions);

    if (cache !== null && mode === undefined) {
        cache.set(node.getKey(), chosen);
    }

    return chosen;
}

/**
 * Serializes a run of sibling blocks, the root's or a column's, each in the
 * standard form — a list next to a raw block or right after another list
 * written so it stays its own list ({@link serializeListApart}) — and, for a
 * block that is edited and holds a part with a source other than its standard
 * form, also part by part. One loop for both, so a column is written as a
 * document is.
 *
 * @param nodes - The blocks, in document order.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param sourceMap - The source map the blocks' entries and parts are read from.
 * @param column - The column the blocks stand in; `null` for the root.
 * @returns One entry per block.
 */
function blockListParts(nodes: LexicalNode[], definitions: Links | null, sourceMap: MarkdownSourceMap, column: NodeKey | null): StandardBlock[] {
    const context = SAVE_PARTS.current;
    const writesParts = sourceMap.parts.size > 0 && context?.mode !== "record";
    let previousJoinable: string | undefined;

    return nodes.map((node, index) => {
        const standard = (): StandardListText => standardBlockText(node, previousJoinable, nodes.slice(index + 1), definitions);

        // Under a write pass (the column of a fence written part by part) the standard form is written with no context.
        const { text, apart } = context?.mode === "write" ? withPartsContext(null, standard) : standard();
        const entry = sourceMap.blocks.get(node.getKey());
        const partByPart = writesParts && $holdsParts(node) && (entry === undefined || (entry.fingerprint !== text && entry.partsDiffer));

        // A list is written the way the standard pass chose to keep it apart: the choice reads the neighbours, which costs lexer calls.
        const write = (): string => ($isListNode(node) && apart !== null ? writeListApart(node, apart, definitions) : serializeBlock(node, definitions));
        const written = partByPart ? withPartsContext({ mode: "write", parts: sourceMap.parts, column }, write) : text;

        if (context?.mode === "record") {
            context.blockFingerprints.set(node.getKey(), text);
        }

        if (text !== "") {
            previousJoinable = $isMarkdownRawBlockNode(node) || $isListNode(node) ? text : undefined;
        }

        return written === text ? { node, text } : { node, text, written };
    });
}

/**
 * Reads the document's link reference definitions off its raw blocks
 * ({@link $documentDefinitions}), once for both the block serializers and a
 * comparison with the definitions at load.
 *
 * @returns The definitions; `forBlocks` is `null` when no reference link
 *   needs them. They are always read: a lean writing is checked under them.
 */
export function $readDefinitions(): DocumentDefinitions {
    const needed = $needsDefinitions();
    const all = $documentDefinitions();

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
 * Makes a reader of the definitions that nodes are written and read back
 * under: the document's ({@link $documentDefinitions}) for nodes that hold
 * something they decide ({@link $referenceIn}), and none for any other
 * nodes, whose Markdown reads alike under any definitions. The document is
 * read at most once, for the first nodes that need it, so a reader serves
 * one pass over a block's runs, during which nothing is written.
 *
 * A rule that checks many blocks in one update therefore reads the document
 * only for the blocks that hold a reference, where asking whether anything
 * in the document does ({@link $needsDefinitions}) walked the whole
 * document for each block.
 *
 * @param asksDocument - Whether nodes that hold a reference outside the
 *   document — a copy of a block, a block being joined away — get the
 *   definitions only when the document itself holds a reference, which is
 *   what the readers that asked the document first gave them.
 * @returns The reader: the definitions for the nodes it is given, or `null`.
 */
function $definitionsReader(asksDocument: boolean): (nodes: readonly LexicalNode[]) => Links | null {
    let read: Links | null = null;

    return (nodes) => {
        const reference = $referenceIn(nodes);

        if (reference === null) {
            return null;
        }

        const isDecided = !asksDocument || reference.isAttached() || $needsDefinitions();

        if (!isDecided) {
            return null;
        }

        read ??= $documentDefinitions();

        return read;
    };
}

/**
 * Finds, among nodes and at any depth in them, the first node the
 * document's definitions decide: a reference link, which needs them to be
 * written in its own form, or a run kept as source holding a `[`, which may
 * be a reference (`[][label]`) whose reading needs them.
 *
 * @param nodes - The nodes.
 * @returns The first such node, or `null` when they hold none.
 */
function $referenceIn(nodes: readonly LexicalNode[]): LexicalNode | null {
    for (const node of nodes) {
        const isReference = $isReferenceLinkNode(node) || ($isMarkdownSourceTextNode(node) && node.getSource().includes(LABEL_OPEN)) || $imageNamesLabel(node);

        if (isReference) {
            return node;
        }

        const inside = $isElementNode(node) ? $referenceIn(node.getChildren()) : null;

        if (inside !== null) {
            return inside;
        }
    }

    return null;
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
    return $dfs().some(({ node }) => $isReferenceLinkNode(node) || ($isMarkdownSourceTextNode(node) && node.getSource().includes(LABEL_OPEN)) || $imageNamesLabel(node));
}

/**
 * Whether a node is an image whose written form can name a definition, so a
 * save needs the document's definitions to judge it.
 *
 * @param node - The node.
 * @returns `true` for such an image.
 */
export function $imageNamesLabel(node: LexicalNode): boolean {
    return $isMarkdownImageNode(node) && imageFormNamesLabel($getState(node, imageWrittenState));
}

/**
 * The document's link reference definitions, as the viewer resolves them in
 * its save. Only raw blocks can hold one (the serializer escapes the `[` of
 * any other text), and each raw block is written so that it reads where it
 * stands as it reads alone, so each one's written form is read alone for its
 * own definitions, in document order, the first definition of a label
 * counting as in `marked`. The raw blocks' text is not read joined: an HTML
 * block left open (`<div`, `<!-- c`) ends with its column or list item in the
 * document, but would take in the definition after it in a joined text.
 * Must run inside an `editor.read` or `editor.update`.
 *
 * @returns The definitions by label, in a map without a prototype.
 */
export function $documentDefinitions(): Links {
    return definitionsOfTexts(rawBlockTexts($getRoot().getChildren()));
}

/**
 * The definitions a definitions source ({@link $definitionsSource}) holds.
 *
 * @param source - The source.
 * @returns The definitions by label, as {@link $documentDefinitions} reads
 *   them off the document the source was taken from.
 */
export function definitionsOfSource(source: string): Links {
    return definitionsOfTexts(JSON.parse(source) as string[]);
}

/**
 * Merges the definitions of raw-block texts, each read alone: the first
 * definition of a label is the one that counts. The map has no prototype, as
 * `marked`'s own has none, so a label naming a member of `Object.prototype`
 * (`constructor`) is a label like any other.
 *
 * @param texts - The raw blocks' written forms, in document order.
 * @returns The definitions by label.
 */
function definitionsOfTexts(texts: readonly string[]): Links {
    const all = Object.create(null) as Links;

    for (const text of texts) {
        for (const [label, definition] of Object.entries(definitionsOfText(text))) {
            const isFirst = !Object.hasOwn(all, label);

            if (isFirst) {
                all[label] = definition;
            }
        }
    }

    return all;
}

/**
 * The definitions one raw-block text holds, read alone and remembered
 * ({@link DEFINITIONS_READ}): a document whose raw blocks did not change
 * since they were last read lexes none again.
 *
 * @param text - A raw block's written form.
 * @returns `marked`'s map of its definitions.
 */
function definitionsOfText(text: string): Links {
    const known = DEFINITIONS_READ.get(text);

    if (known !== undefined) {
        return known;
    }

    const read = definitionsIn(text);

    if (DEFINITIONS_READ.size >= RUNS_ON_CACHE_SIZE) {
        DEFINITIONS_READ.clear();
    }

    DEFINITIONS_READ.set(text, read);

    return read;
}

/**
 * The definitions a text holds, read alone and not remembered: the margin
 * rule asks it of the forms it tries, which are no raw block's text.
 *
 * @param text - Markdown.
 * @returns `marked`'s map of its definitions.
 */
function definitionsIn(text: string): Links {
    // Every definition opens with a `[`: text without one is not lexed.
    return text.includes(LABEL_OPEN) ? lexMarkdownLinkDefinitions(text) : (Object.create(null) as Links);
}

/**
 * The written form ({@link $rawBlockSource}) of every raw block among
 * `nodes`, in their `:::` fences' columns, in their lists' items and in their quotes — every
 * place a block is written as a block of the saved document, where `marked`
 * reads a definition it holds.
 *
 * @param nodes - Blocks, in document order.
 * @returns The raw blocks' written forms, in document order.
 */
function rawBlockTexts(nodes: LexicalNode[]): string[] {
    return nodes.flatMap((node): string[] => {
        if ($isMarkdownRawBlockNode(node)) {
            return [$rawBlockSource(node)];
        }

        const holdsBlocks = $isMarkdownBlockNode(node) || $isMarkdownColumnNode(node) || $isListNode(node) || $isListItemNode(node) || $isQuoteNode(node);

        return holdsBlocks ? rawBlockTexts(node.getChildren()) : [];
    });
}

/**
 * What the document's link reference definitions are read from
 * ({@link $documentDefinitions}): the written forms of its raw blocks, in
 * document order, as the JSON of that list — so two raw blocks never compare
 * equal to one raw block holding both texts, which holds other definitions.
 * Two documents whose sources are equal hold the same definitions
 * ({@link definitionsOfSource}). Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @returns The raw blocks' written forms, as JSON.
 */
export function $definitionsSource(): string {
    return JSON.stringify(rawBlockTexts($getRoot().getChildren()));
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
    return serializeBlock(node, $definitionsReader(true)([node]));
}

/**
 * Serializes a run of inline nodes as a save writes them, their lines kept —
 * the Markdown a raw block or code block holds for content it takes in from
 * another block. Must run inside an `editor.read` or `editor.update`.
 *
 * Every escape is written: the Markdown joins text already there.
 *
 * @param nodes - The inline nodes.
 * @param before - The character the nodes follow on their first line; `""` (the default) or `"\n"` where they open a line.
 * @returns Their Markdown, lines separated by `\n`.
 */
export function $serializeInlineNodes(nodes: LexicalNode[], before: string = ""): string {
    const context: InlineContext = {
        ...MULTI_LINE, definitions: $definitionsReader(true)(nodes), joinsMarkdown: true, joinsIntoRawBlock: true, continuesAfter: continuationOf(before),
    };

    return serializeInlineNodes(nodes, context);
}

/**
 * The character a first line continues after, as {@link InlineContext.continuesAfter} takes it.
 *
 * @param before - The character before the content on its line; `""` or `"\n"` where the content opens its line.
 * @returns The character, or `undefined` at a line's start.
 */
function continuationOf(before: string): string | undefined {
    const opensLine = before === "" || before === "\n";

    return opensLine ? undefined : before;
}

/**
 * Serializes a block's inline content as the block's own save writes it —
 * the Markdown a code block holds for a block converted to one.
 * See {@link $serializeRestOfBlock}.
 *
 * @param block - A paragraph, heading or list item's text.
 * @returns Its content's Markdown, lines separated by `\n`.
 */
export function $serializeBlockContent(block: ElementNode): string {
    return $writeRestOfBlock(block, block.getChildren(), "", false);
}

/**
 * Serializes the rest of a block from a point as the block's own save
 * writes it — the Markdown a code block holds for a block, or the rest of
 * one, that joins it. A heading's content is written as the heading's save
 * writes it, without its `#`s or underline: an ATX heading's line, with no
 * escape a paragraph's line start needs (`+alpha`, not `\+alpha`) and its
 * trailing `#` run escaped (`alpha \#`), or the lines of its setext form. A
 * paragraph's content is its lines, a list item's text its lines
 * with its checkbox's marker as written. Only the first line of a rest that
 * continues a line (`before` neither `""` nor `"\n"`) leaves out a line
 * start's escapes. The text is written for a code block or raw block, which
 * holds no line edge of its own: a no-break space at its edge is the
 * character itself, not the `&nbsp;` the block's own save writes there.
 * Must run inside an `editor.read` or `editor.update`.
 *
 * @param block - A paragraph, heading or list item's text.
 * @param nodes - The rest of the block, or all of it: the nodes to write.
 * @param before - The character before the nodes in the block; `""` or `"\n"` where they open a line.
 * @returns Their Markdown, lines separated by `\n`.
 */
export function $serializeRestOfBlock(block: ElementNode, nodes: LexicalNode[], before: string): string {
    return $writeRestOfBlock(block, nodes, before, true);
}

/**
 * Writes the rest of a block as {@link $serializeRestOfBlock} does.
 *
 * @param block - A paragraph, heading or list item's text.
 * @param nodes - The nodes to write.
 * @param before - The character before the nodes in the block.
 * @param joinsIntoRawBlock - Whether the text is joined into a raw block or code block, which holds no line edge of its own
 *   ({@link InlineContext.joinsIntoRawBlock}): a no-break space at its edge is written as the character, not `&nbsp;`.
 * @returns Their Markdown.
 */
function $writeRestOfBlock(block: ElementNode, nodes: LexicalNode[], before: string, joinsIntoRawBlock: boolean): string {
    const definitions = $definitionsReader(true)(nodes);

    if ($isHeadingNode(block)) {
        return writtenHeadingLines(nodes, Number(block.getTag().slice(1)), definitions, before, joinsIntoRawBlock).content;
    }

    const context: InlineContext = {
        ...MULTI_LINE, definitions, inListItem: $isMarkdownListItemTextNode(block), continuesAfter: continuationOf(before),
        ...(joinsIntoRawBlock ? { joinsIntoRawBlock } : {}),
    };
    const written = serializeInlineNodes(nodes, context);

    // The checkbox is written by the item's writer, not inline: the nodes open with the item's own checkbox.
    return $isMarkdownListItemTextNode(block) && $isMarkdownTaskCheckboxNode(nodes[0]) ? withTaskMarker(block, written) : written;
}

/**
 * An item's text with the marker of the checkbox it opens with. The text is
 * written as the start of a line, which is how Markdown reads what follows a
 * task marker; written inline after the marker, a `[x]` reference link and a
 * no-break space at the edge would read differently.
 *
 * @param text - The item's text.
 * @param written - The Markdown its inline content was written as.
 * @returns The marker and the content, or the content alone when the text opens with no checkbox. A checkbox alone
 *   is written as the text Markdown reads it as ({@link $emptyTaskItemMarkdown}).
 */
function withTaskMarker(text: ElementNode, written: string): string {
    const box = $openingCheckbox(text);

    if (box === null) {
        return written;
    }

    return written === "" ? $emptyTaskItemMarkdown(box) : $taskMarkerMarkdown(box) + written;
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
    const definitionsFor = $definitionsReader(true);

    return inlineRuns(node, inCell).every(([nodes, context]) => inlineReadsBack(nodes, { ...context, definitions: definitionsFor(nodes) }));
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
    const definitionsFor = $definitionsReader(false);

    return inlineRuns(node, inCell).flatMap(([nodes, base]) => {
        const context: InlineContext = { ...base, definitions: definitionsFor(nodes) };

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
 * viewer gives it, which it makes from what it reads of the heading's text
 * ({@link headingSlug}). Must run
 * inside an `editor.read` or `editor.update`.
 *
 * @param container - The block (a table cell for a cell's content).
 * @param tokens - The inline tokens it was loaded from (a task item's, without its checkbox).
 * @param isHeading - Whether the block is a heading, whose id the standard form is read for.
 * @param definitions - The document's link reference definitions, which keep a reference link in its written form; `null` for none.
 * @returns How far the standard form reads as the tokens do.
 */
export function $readStandardForm(
    container: ElementNode, tokens: readonly Token[], isHeading: boolean, definitions: Links | null,
): StandardFormReading {
    const cell = $isTableCellNode(container);
    const heading = $isHeadingNode(container) ? container : null;
    const base = cell ? TABLE_CELL : heading !== null ? headingContext(heading) : $isMarkdownListItemTextNode(container) ? { ...MULTI_LINE, inListItem: true } : MULTI_LINE;
    const context: InlineContext = { ...base, definitions };
    const reading: InlineContext = { ...context, readsWhitespace: true };
    const intended: string[] = [];
    const spans = new Map<Token, readonly [number, number]>();

    pushTokenReading(intended, tokens, { marks: [], link: "", style: "" }, reading, spans);

    const written = cell ? serializeTableCell(container, definitions) : serializeInline(container, context);
    const score = readingScore(withoutTrailingWhitespace(markdownReading(written, reading)), withoutTrailingWhitespace(intended));

    if (heading === null || !isHeading) {
        return { score, spans, idScore: Infinity };
    }

    const writtenHeading = lexMarkdown(serializeHeading(heading, definitions)).find((token) => token.type === "heading") as Tokens.Heading | undefined;
    const [id, writtenId] = [headingSlug(tokens), headingSlug(writtenHeading?.tokens ?? [])];
    const differs = [...id].findIndex((char, index) => writtenId[index] !== char);

    return { score, spans, idScore: id === writtenId ? Infinity : differs === -1 ? id.length : differs };
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

    if ($isParagraphNode(node) || $isHeadingNode(node)) {
        return [[node.getChildren(), inTableCell ? TABLE_CELL : $isHeadingNode(node) ? headingContext(node) : MULTI_LINE]];
    }

    return node.getChildren().flatMap((child) => inlineRuns(child, inTableCell || $isTableCellNode(node)));
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
    const items = list.getChildren().filter($isListItemNode).map(itemBlockKinds);
    const isMadeLoose = items.some(blocksReadLoose);

    if (isMadeLoose) {
        return true;
    }

    return $getState(list, listLooseState) && (items.length > 1 || (items[0]?.length ?? 0) > 1);
}

/**
 * Tells whether a list item alone makes its list read loose, whatever the
 * list's looseness ({@link $listReadsLoose}). Must run inside an
 * `editor.read` or `editor.update`.
 *
 * @param item - The list item.
 * @returns `true` when the item's blocks need a blank line between them.
 */
export function $itemReadsLoose(item: ListItemNode): boolean {
    return blocksReadLoose(itemBlockKinds(item));
}

/**
 * Tells whether the blocks of one list item need a blank line between them:
 * a block that is not a nested list after the first, or a nested list after
 * a first block that is not text.
 *
 * @param blocks - The kinds of the item's blocks ({@link itemBlockKinds}).
 * @returns `true` when they do.
 */
function blocksReadLoose(blocks: ReadonlyArray<"list" | "text" | "block">): boolean {
    return blocks.slice(1).some((kind) => kind !== "list") || (blocks[0] === "block" && blocks.length > 1);
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
 * @returns The Markdown, with where each block's text stands in it.
 */
function assembleDocumentWithPlaces(blocks: readonly WrittenBlock[], load: MarkdownSourceLoad): MarkdownWithPlaces {
    const places: WrittenBlockPlace[] = [];
    let text = documentStart(blocks[0]!.source);

    blocks.forEach((block, index) => {
        text += separatorBefore(blocks, index);
        places.push({ key: block.node.getKey(), start: text.length, end: text.length + block.text.length });
        text += block.text;
    });

    return { text: text + documentEnd(blocks[blocks.length - 1]!.source, load), places };
}

/**
 * Joins the written blocks of a column as a document's are
 * ({@link assembleDocumentWithPlaces}), without where each stands.
 *
 * @param blocks - The blocks to write, at least one.
 * @param load - The column's import, whose ending the column keeps.
 * @returns The Markdown.
 */
function assembleDocument(blocks: readonly WrittenBlock[], load: MarkdownSourceLoad): string {
    return assembleDocumentWithPlaces(blocks, load).text;
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
 * output. A source stops reading the same when what is now written after it
 * closes a definition label or title it leaves open
 * ({@link labelClosedAfter}) or a `:::` fence it opens
 * ({@link fenceClosedAfter}), or when it ran on to the end of its document
 * (an unclosed code fence) and a block now follows it. A raw block only a
 * second blank line ends, when the block after it is not one it was loaded
 * before ({@link takesInBlockAfter}) — it was loaded before another, or as
 * its document's last block — stays its source and is given one more line
 * end, so every byte of the unedited block is kept. A block that writes
 * nothing (an empty paragraph) is left out — unless it is unchanged, since a
 * block the viewer shows as nothing (a link with empty text) still has
 * source to keep.
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

    candidates.forEach(({ node, text, written: partByPart, entry }, index) => {
        const endedOpenLoad = entry !== undefined && entry.load.endsOpen && entry.index === entry.load.blockCount - 1;
        // A raw block only a second blank line ends stays its source and is given that line below; any other block
        // that ran on to the document's end (an unclosed code fence) is closed by its standard form.
        const lacksOnlyLineEnd = endedOpenLoad && $isMarkdownRawBlockNode(node) && rawBlockEnd(entry.body) === "wide";
        const runsOn = endedOpenLoad && !lacksOnlyLineEnd && index < candidates.length - 1;
        const keep = entry !== undefined && !runsOn && !joinsPreviousBlock(entry, written[written.length - 1]);
        const block = keep
            ? { node, source: entry, text: entry.body, standard: text }
            : { node, source: undefined, text: partByPart ?? text, standard: text };

        if (block.text !== "") {
            written.push(block);
        }
    });

    // From the end, so each block is checked against what is finally written after it.
    for (let index = written.length - 1; index >= 0; index--) {
        const block = written[index]!;
        const readsOtherwise = block.source !== undefined && (labelClosedAfter(written, index) || fenceClosedAfter(written, index));
        const lacksLineEnd = !readsOtherwise && block.source !== undefined && takesInBlockAfter(written, index);

        if (readsOtherwise) {
            written.splice(index, 1, ...(block.standard === "" ? [] : [{ ...block, source: undefined, text: block.standard }]));
        } else if (lacksLineEnd) {
            // Still its source, byte for byte, with the line end that makes the blank line after it the second.
            written[index] = { ...block, text: `${block.text}\n` };
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

    return (OPEN_LABEL.test(text) || OPEN_TITLE.test(text)) && readsOtherwiseAfter(blocks, index, (alone) => alone.length - 1);
}

/**
 * Tells whether a block written as its source opens a `:::` fence
 * ({@link FENCE_OPENING_START}) that what is written after it closes, so the
 * fence takes in the blocks after it: its source no longer reads as loaded,
 * and it must be written in the standard form, which escapes its `:`.
 *
 * @param blocks - The blocks being written.
 * @param index - The block's position among them.
 * @returns `true` when the block's first block-level token reads otherwise
 *   with what follows it.
 */
function fenceClosedAfter(blocks: readonly WrittenBlock[], index: number): boolean {
    const text = blocks[index]!.text;

    const leavesFenceOpen = FENCE_OPENING_START.test(text) && index < blocks.length - 1
        && !closesOwnFence(text, separatorBefore(blocks, index + 1));

    return leavesFenceOpen && readsOtherwiseAfter(blocks, index, () => 0);
}

/**
 * Tells whether a block that starts with a `:::` opening line closes that
 * fence itself: lexed alone, its text starts with the fence's token, and a
 * line end follows that token's closing line. Nothing written after such a
 * block changes how it reads. The fence's tokenizer is the first rule `marked`
 * tries at the block's start; it reads line by line from the opening line and
 * stops at the line that closes the fence, so it returns the same token
 * whatever follows that line.
 *
 * @param text - The block's text, which starts with a `:::` opening line.
 * @param separatorAfter - What is written between the block and the next one.
 * @returns `true` when the fence the block opens ends inside the block.
 */
function closesOwnFence(text: string, separatorAfter: string): boolean {
    const first = lexMarkdown(text).find((token) => token.type !== "space");

    if (first?.type !== "mdblock") {
        return false;
    }

    // The closing line is whole: the text after it starts a new line, so nothing is added to it.
    return (text.slice(first.raw.length) + separatorAfter).startsWith("\n");
}

/**
 * Tells whether a raw block written as its source takes in the block now
 * written after it: only a second blank line ends its text (`<div`), and the
 * block after it is not the one that followed it at load, so the source's
 * own text between the two is not what is written there. One more line end
 * must follow its text, as the standard form of such a block writes. A raw
 * block no blank line ends is not asked about: with a block after it the
 * editor holds it as a paragraph.
 *
 * @param blocks - The blocks being written.
 * @param index - The block's position among them.
 * @returns `true` when the block written after it would be read as part of it.
 */
function takesInBlockAfter(blocks: readonly WrittenBlock[], index: number): boolean {
    const block = blocks[index]!;
    const next = blocks[index + 1];
    const followedAsLoaded = next === undefined || followsAtLoad(block.source, next.source);

    return !followedAsLoaded && $isMarkdownRawBlockNode(block.node) && rawBlockEnd(block.text) === "wide";
}

/**
 * Tells whether one of a block's block-level tokens reads otherwise once the
 * blocks written after it follow it.
 *
 * @param blocks - The blocks being written.
 * @param index - The block's position among them.
 * @param tokenAt - Picks the token compared, from the block's tokens alone.
 * @returns `true` when that token's source differs with what follows it.
 */
function readsOtherwiseAfter(blocks: readonly WrittenBlock[], index: number, tokenAt: (alone: readonly Token[]) => number): boolean {
    if (index === blocks.length - 1) {
        return false;
    }

    const text = blocks[index]!.text;
    const following = blocks.slice(index + 1).map((block, offset) => separatorBefore(blocks, index + 1 + offset) + block.text).join("");
    const lexBlocks = (markdown: string): Token[] => lexMarkdown(markdown).filter((token) => token.type !== "space");
    const alone = lexBlocks(text);
    const at = tokenAt(alone);

    return at >= 0 && at < alone.length && (lexBlocks(text + following)[at]?.raw ?? "").trim() !== (alone[at]!.raw ?? "").trim();
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

    return entry !== undefined && writesAsAtLoad(part, entry) && readsAlike(entry, definitions) ? entry : undefined;
}

/**
 * Tells whether a block's standard output is its output at load. A raw block
 * only a second blank line ends writes one more line end while a block
 * follows it ({@link serializeRawBlock}), which tells of its neighbour and
 * not of the block: that line end is left out, so a block added after such a
 * raw block, or the removal of every block after it, does not make it an
 * edited one.
 *
 * @param part - A block and its standard output.
 * @param entry - The block it was loaded as.
 * @returns `true` when the block itself writes what it wrote at load.
 */
function writesAsAtLoad(part: StandardBlock, entry: MarkdownSourceBlock): boolean {
    const isRaw = $isMarkdownRawBlockNode(part.node);
    const own = (text: string): string => (isRaw ? text.replace(SECOND_BLANK_LINE_END, "") : text);

    return own(entry.fingerprint) === own(part.text);
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
    let previousRaw: string | undefined;

    for (const { node, text } of blockListParts(nodes, definitions, EMPTY_SOURCE_MAP, null)) {
        if (text === "") {
            continue;
        }

        const raw = $isMarkdownRawBlockNode(node);
        const joinsPreviousRaw = raw && previousRaw !== undefined && listsJoin(previousRaw, text);

        if (joinsPreviousRaw) {
            written.push(LIST_SEPARATOR);
        }

        written.push(text);
        previousRaw = raw ? text : undefined;
    }

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
 * stand next to each other; lists of two types do not join. A paragraph or
 * raw block after the list that writes nothing (an empty paragraph, a raw
 * block an edit emptied) stands between it and nothing: the block after
 * that one is the list's neighbour.
 *
 * @param list - The list.
 * @param before - The Markdown of the raw block or list written right
 *   before it, if one was.
 * @param following - The blocks after it.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The list's Markdown, with any separator.
 */
function serializeListApart(list: ListNode, before: string | undefined, following: LexicalNode[], definitions: Links | null): string {
    return chooseListApart(list, before, following, definitions).text;
}

/** How a top-level list is kept apart from the blocks next to it ({@link chooseListApart}). */
interface ListApart {
    /** The bullet or delimiter the list is written with; `undefined` for its own. */
    readonly marker:          string | undefined;
    /** Whether {@link LIST_SEPARATOR} is written before the list. */
    readonly separatedBefore: boolean;
    /** Whether {@link LIST_SEPARATOR} is written after the list. */
    readonly separatedAfter:  boolean;
}

/** A block's standard text, and for a list how it was kept apart; `null` for any other block. */
interface StandardListText {
    readonly text:  string;
    readonly apart: ListApart | null;
}

/**
 * Serializes a top-level list as {@link serializeListApart} describes, and
 * says how it was kept apart, so a write of the same list part by part
 * ({@link writeListApart}) takes the same choice without reading the
 * neighbours again.
 *
 * @param list - The list.
 * @param before - The Markdown of the raw block or list written right before it, if one was.
 * @param following - The blocks after it.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The list's Markdown, with any separator, and the choice.
 */
function chooseListApart(list: ListNode, before: string | undefined, following: LexicalNode[], definitions: Links | null): StandardListText {
    const markdown = serializeList(list, definitions);

    // A paragraph or raw block that writes nothing keeps the list from nothing: the block after it is the neighbour.
    const writesNothing = (node: LexicalNode): boolean => ($isParagraphNode(node) || $isMarkdownRawBlockNode(node))
        && serializeBlock(node, definitions) === "";

    const nextNode = following.find((node) => !writesNothing(node));
    const after = $isMarkdownRawBlockNode(nextNode) ? serializeBlock(nextNode, definitions) : undefined;

    if (before === undefined && after === undefined) {
        return { text: markdown, apart: { marker: undefined, separatedBefore: false, separatedAfter: false } };
    }

    const joinsBefore = (candidate: string): boolean => before !== undefined && blocksJoin(before, candidate);
    const joinsAfter = (candidate: string): boolean => after !== undefined && blocksJoin(candidate, after);
    const markers = list.getListType() === "number" ? ORDERED_DELIMITERS : BULLET_MARKERS;
    const own = $getState(list, listMarkerState);
    const others = markers.filter((marker) => marker !== own);
    const candidates = [{ marker: undefined as string | undefined, text: markdown }, ...others.map((marker) => ({ marker, text: serializeList(list, definitions, false, marker) }))];
    const apart = candidates.find((candidate) => !joinsBefore(candidate.text) && !joinsAfter(candidate.text));

    if (apart !== undefined) {
        return { text: apart.text, apart: { marker: apart.marker, separatedBefore: false, separatedAfter: false } };
    }

    const separatedBefore = joinsBefore(markdown);
    const separatedAfter = joinsAfter(markdown);
    const separated = separatedBefore ? [LIST_SEPARATOR, markdown] : [markdown];

    return {
        text: (separatedAfter ? [...separated, LIST_SEPARATOR] : separated).join(BLOCK_SEPARATOR),
        apart: { marker: undefined, separatedBefore, separatedAfter },
    };
}

/**
 * Serializes a top-level list with the marker and separators
 * {@link chooseListApart} chose for it, under the running parts context.
 *
 * @param list - The list.
 * @param apart - The choice.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The list's Markdown, with any separator.
 */
function writeListApart(list: ListNode, apart: ListApart, definitions: Links | null): string {
    const markdown = serializeList(list, definitions, false, apart.marker);
    const separated = apart.separatedBefore ? [LIST_SEPARATOR, markdown] : [markdown];

    return (apart.separatedAfter ? [...separated, LIST_SEPARATOR] : separated).join(BLOCK_SEPARATOR);
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

    if ($isMarkdownHorizontalRuleNode(node)) {
        return $horizontalRuleMarkdown(node);
    }

    if ($isMarkdownRawBlockNode(node)) {
        return serializeRawBlock(node, definitions);
    }

    return $isElementNode(node) ? serializeBlockList(node.getChildren(), definitions) : node.getTextContent();
}

/**
 * Serializes a raw block: its written form ({@link $rawBlockSource}), the
 * form of its text that reads where it is written as it reads alone — unless
 * that text runs on (an HTML block its own text does not close, `<!--`
 * without `-->`, `<pre>` without `</pre>`) and a block that writes something
 * follows it, which the text would take in, or it stands in a `:::` column
 * and its text would break the column (`breaksColumn`): end the fence,
 * swallow its closing line, or lose a backslash to the separator unescape.
 * It is then written as a paragraph holding its text, escaped, its lines
 * kept by hard breaks, so it shows the same text and the blocks after it
 * stay their own, as the editor shows them.
 *
 * @param node - The raw block.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns Its Markdown.
 */
function serializeRawBlock(node: MarkdownRawBlockNode, definitions: Links | null): string {
    if ($rawBlockWritesAsParagraph(node, definitions)) {
        return serializeInline(node, MULTI_LINE);
    }

    const text = $rawBlockSource(node);

    // A block only a second blank line ends writes that line itself, so the block after it stays its own.
    return rawBlockEnd(text) === "wide" && $writesBlockAfter(node, definitions) ? `${text}\n` : text;
}

/**
 * A raw block's text as a save writes it, its written form: in a list item
 * its item form ({@link rawBlockInItem}), and anywhere else — in the document
 * or in a `:::` column — its block-list form ({@link rawBlockInBlockList}).
 * Must run inside an `editor.read` or `editor.update`.
 *
 * @param node - The raw block.
 * @returns The text a save writes for it.
 */
export function $rawBlockSource(node: MarkdownRawBlockNode): string {
    const text = node.getTextContent();
    const parent = node.getParent();

    return $isListItemNode(parent) ? rawBlockInItem(text) : rawBlockInBlockList(text);
}

/**
 * The form a raw block's text is written in as a block of the document or of
 * a `:::` column: from the first line that holds something to the last, and
 * without the indentation before it that means nothing to Markdown
 * ({@link rawBlockAtMargin}). A blank edge line is only space between blocks,
 * and spaces before the block would move it into a list written above it.
 * The form changes nothing the block holds: indentation goes only where the
 * text then reads as the same blocks with the same content and the same
 * definitions, so the lines of a list item keep their place under its
 * marker, and the lines after an HTML block's first, or a title's second
 * line, keep theirs. The spaces that end its last line stay, unlike in the
 * item form: they can be content (the one line of a code block inside a
 * quote, `>` and two spaces under `` >``` ``), and a load keeps them here.
 * Text holding whitespace alone writes nothing.
 *
 * @param text - The raw block's text.
 * @returns Its block-list form.
 */
export function rawBlockInBlockList(text: string): string {
    return text.trim() === "" ? "" : rawBlockAtMargin(text.replace(BLANK_FIRST_LINES, "").replace(BLANK_LAST_LINES, ""), false, true);
}

/**
 * The form a raw block's text is written in as a block of a list item: from
 * the first line that holds something to the last, and without the
 * indentation before it that means nothing to Markdown
 * ({@link rawBlockAtMargin}). In an item each would place the block
 * elsewhere: an empty first line leaves the item's marker bare (an empty
 * item, or a setext underline under a line of text), an empty last line
 * reads as a blank line between items, which makes a list loose, and spaces
 * before the block put it under the nested list above it. Like the
 * block-list form ({@link rawBlockInBlockList}) it takes indentation off
 * only where the text then says what it said: the same blocks, the same
 * content and the same definitions. Text holding whitespace alone writes
 * nothing.
 *
 * @param text - The raw block's text.
 * @returns Its item form.
 */
export function rawBlockInItem(text: string): string {
    return text.trim() === "" ? "" : rawBlockAtMargin(withoutBlankEdges(text), false, true);
}

/**
 * Tells whether a raw block can stand in a list item: whether its item form
 * ({@link rawBlockInItem}), written as a block of an item by this
 * serializer, is read by `marked` as the same blocks the text reads as on
 * its own — opening the item or under its text, as the item's last block or
 * before another item, in a tight list or after a blank line. This is the
 * one rule for a raw block in a list item. A load builds a list item holding
 * a raw block only when it holds; an edit that leaves a raw block for which
 * it does not hold has the editor read the whole list again as its save
 * reads; so the save, which writes the item form, always reads back as the
 * editor shows it.
 *
 * It fails for text that reads by where it stands: a quote ending on a line
 * without `>` that starts an HTML block (part of the quote where the item's
 * text ends, a block after it before a blank line), text that keeps spaces
 * before its first line because it reads otherwise without them (on the
 * item's marker line they shift the item's content, which the first probe
 * shows), and text `marked` reads otherwise line by line, as it reads an
 * item, than as a paragraph.
 *
 * @param text - The raw block's text.
 * @returns `true` when a list item can hold a raw block of that text.
 */
export function rawBlockStandsInItem(text: string): boolean {
    const source = rawBlockInItem(text);
    const known = STANDS_IN_ITEM.get(source);

    if (known !== undefined) {
        return known;
    }

    const stands = source === "" || itemProbes(source).every((probe) => probe === itemShape(lexMarkdown(source)));

    if (STANDS_IN_ITEM.size >= RUNS_ON_CACHE_SIZE) {
        STANDS_IN_ITEM.clear();
    }

    STANDS_IN_ITEM.set(source, stands);

    return stands;
}

/**
 * Writes a raw block as a block of a list item at each place one is written,
 * and reads each back: the shape ({@link itemShape}) of the blocks `marked`
 * gives the item for it, or `""` when the text does not stay one item's
 * (it ends the list, or takes the next item in).
 *
 * @param source - The raw block's item form.
 * @returns One shape per place: opening the item, and under the item's
 *   text, each as the list's last line and before another item.
 */
function itemProbes(source: string): string[] {
    const block: ItemBlock = { markdown: source, isList: false, isText: false, isRaw: true };
    const text: ItemBlock = { markdown: PARAGRAPH_PROBE_LINE, isList: false, isText: true };
    const opening = listItemLines(PROBE_MARKER, [block], false).join("\n");
    const under = listItemLines(PROBE_MARKER, [text, block], false).join("\n");
    const next = `${PROBE_MARKER} ${PARAGRAPH_PROBE_LINE}`;

    return [
        probedItemShape(opening, 1, 0),
        probedItemShape(`${opening}\n${next}`, 2, 0),
        probedItemShape(`${opening}${LOOSE_ITEM_SEPARATOR}${next}`, 2, 0),
        probedItemShape(under, 1, 1),
        probedItemShape(`${under}${LOOSE_ITEM_SEPARATOR}${next}`, 2, 1),
    ];
}

/**
 * Lexes a probe list and gives the shape of its first item's blocks after
 * the item's own text.
 *
 * @param probe - The list's Markdown.
 * @param items - How many items the list must read as.
 * @param textBlocks - How many blocks of text open the first item.
 * @returns The shape, or `""` when the probe does not read as one list of
 *   that many items whose later items hold their line of text alone.
 */
function probedItemShape(probe: string, items: number, textBlocks: number): string {
    const tokens = lexMarkdown(probe).filter((token) => token.type !== "space");
    const list = tokens.length === 1 && tokens[0]!.type === "list" ? tokens[0] as Tokens.List : null;
    const readsAsProbed = list !== null && list.items.length === items
        && list.items.slice(1).every((item) => itemShape(item.tokens) === "paragraph");

    return readsAsProbed ? itemShape(list.items[0]!.tokens.filter((token) => token.type !== "space").slice(textBlocks)) : "";
}

/**
 * The block structure of tokens ({@link blockShape}), a list item's line of
 * text counted as the paragraph it is: `marked` gives a tight item's text a
 * token type of its own.
 *
 * @param tokens - Block tokens.
 * @returns A string naming the structure.
 */
function itemShape(tokens: Token[]): string {
    return blockShape(tokens).replace(/\btext\b/g, "paragraph");
}

/**
 * Drops the blank lines before a text and the whitespace after it, keeping
 * the indentation of its first line.
 *
 * @param text - A stretch of source, or a token's `raw`.
 * @returns The text without its blank edges.
 */
export function withoutBlankEdges(text: string): string {
    return text.replace(BLANK_FIRST_LINES, "").trimEnd();
}

/**
 * A raw block's Markdown without its leading indentation (up to three
 * spaces, the indentation CommonMark ignores at a block's start). Each block
 * is written at column 0, so a list indented in the source is not: a raw
 * block after it keeping its indent would fall into the list's content
 * column and join the list.
 *
 * A raw list loses only the indentation all its lines share, which keeps
 * every continuation line's position relative to its marker. Any other raw
 * block also loses what is left of its first line's indent: only a block's
 * first line places it (an HTML block's or a quote's later lines are not
 * measured against it).
 *
 * `marked` does measure some lines against the margin, though (a quote's
 * lazy line, a list's next marker), so a dedent is kept only when the text
 * still lexes to the same blocks, at both places a block of a block list can
 * stand ({@link readingInBlockList}): `> q` over `<div` is one quote where
 * its input ends, and a quote and an HTML block before a line end, while
 * over an indented `<div` it is one quote at both. Else the block loses less
 * of its indent: what all its lines share, then its first line's alone, every
 * other line as written — which keeps a quote's last line in it, at the
 * margin where a list above cannot take the block in — or none.
 *
 * In every use the dedent must also leave each list item of the text holding
 * what it held. An item's lines are measured from its marker, so a marker
 * moved alone changes them, and a line indented less than its item's content
 * (the last line of an item's HTML block, say) is read as written: with the
 * whole list further left it would hold fewer spaces.
 *
 * A load asks for no more: the text it gives the raw block is what the
 * editor shows from then on. A save's form of that text must say what the
 * text says, so it asks for the content of every other block as well
 * (`keepsContent`): an indentation `marked` reads as part of a block — of an
 * HTML block's later lines, of a definition's title — stays.
 *
 * A dedented form that moves a line holding a tab in its container prefix is
 * not kept either: the tab would reach its tab stop from another column.
 *
 * @param source - The block's Markdown.
 * @param isList - Whether the block is a list. `false` also tries the first
 *   line at the margin, which is kept when the block reads the same.
 * @param keepsContent - Whether a form must also hold the content of every
 *   block and the definitions the source holds, not only its blocks and what
 *   its list items hold.
 * @returns The Markdown at the margin.
 */
export function rawBlockAtMargin(source: string, isList: boolean, keepsContent: boolean = false): string {
    const candidates = marginCandidates(source, isList);

    if (candidates[0] === source) {
        return source;
    }

    const key = `${isList}${keepsContent}${READING_KEY_SEPARATOR}${source}`;
    const known = AT_MARGIN.get(key);

    if (known !== undefined) {
        return known;
    }

    const reading = readingInBlockList(source, keepsContent);
    const lines = source.split("\n");
    const keepsReading = (candidate: string): boolean => {
        if (candidate === source) {
            return true;
        }

        const movesATab = movesLineWithPrefixTab(lines, candidate);

        return !movesATab && readingInBlockList(candidate, keepsContent) === reading;
    };
    const atMargin = candidates.find(keepsReading) ?? source;

    if (AT_MARGIN.size >= RUNS_ON_CACHE_SIZE) {
        AT_MARGIN.clear();
    }

    AT_MARGIN.set(key, atMargin);

    return atMargin;
}

/**
 * Tells whether a dedented form of a block moves a line that holds a tab in
 * its container prefix. Such a tab reaches its tab stop from wherever the
 * line starts, so the moved line would be read with another indentation.
 *
 * @param lines - The block's lines as written.
 * @param candidate - A dedented form of the block.
 * @returns `true` when a changed line holds such a tab.
 */
function movesLineWithPrefixTab(lines: readonly string[], candidate: string): boolean {
    const moved = candidate.split("\n");
    const hasPrefixTab = prefixTabLines(lines);

    return lines.some((line, index) => line !== moved[index] && hasPrefixTab[index]);
}

/**
 * The forms {@link rawBlockAtMargin} tries for a block's Markdown, the one
 * that loses most indentation first: without the indentation all its lines
 * share and what is left of its first line's; without the shared indentation
 * alone; and with its first line alone at the margin, every other line as
 * written. For a list the first form is the second and the third is the
 * text as written: a list loses only the indentation all its lines share.
 *
 * @param source - The block's Markdown.
 * @param isList - Whether the block is a list.
 * @returns The three forms, in the order they are tried.
 */
function marginCandidates(source: string, isList: boolean): string[] {
    const lines = source.split("\n");
    const indentOf = (line: string): number => /^ */.exec(line)![0].length;
    const shared = Math.min(MAX_IGNORED_INDENT, ...lines.filter((line) => line.trim() !== "").map(indentOf));
    const dedented = lines.map((line) => line.slice(Math.min(shared, indentOf(line))));
    const firstDedented = [...dedented];
    const firstOnly = [...lines];

    if (!isList && lines.length > 0) {
        firstDedented[0] = firstDedented[0]!.slice(Math.min(MAX_IGNORED_INDENT, indentOf(firstDedented[0]!)));
        firstOnly[0] = firstOnly[0]!.slice(Math.min(MAX_IGNORED_INDENT, indentOf(firstOnly[0]!)));
    }

    return [firstDedented.join("\n"), dedented.join("\n"), firstOnly.join("\n")];
}

/**
 * What a text reads as at the two places a block of a block list is
 * written: where its input ends (the last block of the document or of a
 * `:::` column), and before a line end (any other block). Two texts with the
 * same reading are the same blocks wherever a block list holds them, and
 * their list items hold the same: an item's lines are measured from its
 * marker, so a marker moved alone changes what they are. With the content,
 * every block says the same and the texts give the same definitions.
 *
 * @param text - A block's Markdown.
 * @param withContent - Whether the reading also tells what the blocks
 *   outside list items hold, and which definitions the text gives.
 * @returns The two block structures ({@link blockShape}) and what the
 *   blocks hold ({@link blockContent}), with the definitions when asked
 *   for, as one key.
 */
function readingInBlockList(text: string, withContent: boolean): string {
    const whereInputEnds = lexMarkdown(text);
    const beforeLineEnd = lexMarkdown(`${text}\n`);
    const reading = [blockShape(whereInputEnds), blockShape(beforeLineEnd), blockContent(whereInputEnds, withContent)];

    return (withContent ? [...reading, JSON.stringify(definitionsIn(text))] : reading).join(READING_KEY_SEPARATOR);
}

/**
 * What block tokens hold: a quote's and a `:::` fence's blocks, a list's
 * items' blocks, and the text of each block of a list item. In a list item
 * `marked` has already measured every line from the item's marker, so each
 * space left is content: the indentation inside an indented code block, or
 * before an HTML block's lines. A block outside list items gives its text
 * only when asked (`ofEveryBlock`), and then without the indentation before
 * its first line, which is no part of it.
 *
 * @param tokens - Block tokens.
 * @param ofEveryBlock - Whether a block outside list items gives its text
 *   too, not only its type.
 * @returns A string that two token lists share only when they hold the same.
 */
function blockContent(tokens: Token[], ofEveryBlock: boolean): string {
    return blockStructure(tokens, (token, inListItem) => (inListItem || ofEveryBlock ? JSON.stringify(ownText(token, inListItem)) : token.type));
}

/**
 * The text of a block token that holds no blocks, as {@link blockContent}
 * compares it: what the block says, without indentation that is no part of
 * it.
 *
 * @param token - The token.
 * @param inListItem - Whether it is a list item's.
 * @returns Its text. A paragraph's lines are taken without the whitespace
 *   before them, which shows as nothing. Any other block is taken without
 *   the indentation before its first line — unless it stands in a list item,
 *   or is a code block, whose text `marked` gives without the indentation
 *   that makes it one: what is left is code.
 */
function ownText(token: Token, inListItem: boolean): string {
    const text = (token as { text?: string }).text ?? token.raw;
    const isParagraph = token.type === "paragraph" || token.type === "text";

    if (isParagraph) {
        return text.replace(INDENT_BEFORE_LINE, "");
    }

    const startsWithContent = inListItem || token.type === "code";

    return startsWithContent ? text : text.replace(INDENT_BEFORE_BLOCK, "");
}

/**
 * The block structure tokens lex to: each block's type, a quote's and a
 * `:::` fence's blocks, and a list's items' blocks — what an indentation
 * change can alter.
 *
 * @param tokens - Block tokens.
 * @returns A string naming the structure.
 */
function blockShape(tokens: Token[]): string {
    return blockStructure(tokens, (token) => token.type);
}

/**
 * The block structure the viewer's lexer reads a stretch of Markdown as:
 * each block's type, a list's items' blocks, a quote's and a `:::` fence's
 * blocks. Two texts with equal shapes read as the same blocks.
 *
 * @param markdown - The Markdown.
 * @returns A string naming the structure.
 */
export function markdownBlockShape(markdown: string): string {
    return blockShape(lexMarkdown(markdown));
}

/**
 * Writes block tokens as one string that follows their structure: a list's
 * items' blocks, a quote's and a `:::` fence's blocks, and for each block
 * that holds none what `ofBlock` gives for it.
 *
 * @param tokens - Block tokens.
 * @param ofBlock - What a block that holds no blocks is written as; it is
 *   told whether the block is a list item's.
 * @param inListItem - Whether the tokens are a list item's.
 * @returns The string.
 */
function blockStructure(tokens: Token[], ofBlock: (token: Token, inListItem: boolean) => string, inListItem: boolean = false): string {
    return tokens.filter((token) => token.type !== "space").map((token) => {
        switch (token.type) {
            case "list":       return `list[${(token as Tokens.List).items.map((item) => blockStructure(item.tokens, ofBlock, true)).join("|")}]`;
            case "blockquote": return `quote(${blockStructure((token as Tokens.Blockquote).tokens, ofBlock, inListItem)})`;
            case "mdblock":    return `fence(${(token as unknown as MdBlockToken).columns.map((column) => blockStructure(column, ofBlock, inListItem)).join("|")})`;
            default:           return ofBlock(token, inListItem);
        }
    }).join(",");
}

/**
 * Tells whether a save writes a raw block as a paragraph holding its text
 * ({@link serializeRawBlock}): its text runs on and a block after it writes
 * something, or it stands in a `:::` column — as a block of the column, or
 * of a list item in it, whose lines the fence reads all the same — and its
 * text would break the column (`breaksColumn`): end the fence, swallow its
 * closing line, or lose a backslash to the separator unescape. The editor
 * then shows it as that paragraph. Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @param node - The raw block.
 * @param definitions - The saved document's link reference definitions, or
 *   `null`, which the rules pass: the definitions only choose how a reference
 *   link is written, never whether a block after the raw block writes anything.
 * @returns `true` when it is written as a paragraph.
 */
export function $rawBlockWritesAsParagraph(node: MarkdownRawBlockNode, definitions: Links | null = null): boolean {
    const breaksItsColumn = $standsInColumn(node) && breaksColumn(node.getTextContent());

    return breaksItsColumn || (rawBlockEnd($rawBlockSource(node)) === "runsOn" && $writesBlockAfter(node, definitions));
}

/**
 * Tells whether a block stands in a `:::` column: as one of its blocks, or
 * as a block of a list item of a list there, at any depth. Must run inside
 * an `editor.read` or `editor.update`.
 *
 * @param node - The block.
 * @returns `true` when a column holds it with nothing but lists between.
 */
function $standsInColumn(node: LexicalNode): boolean {
    let container = node.getParent();

    while ($isListItemNode(container) || $isListNode(container)) {
        container = container.getParent();
    }

    return $isMarkdownColumnNode(container);
}

/**
 * Tells whether a block after a node, in the container the save writes it
 * in, writes something: one of its later siblings, which for a block of a
 * list item are the item's later blocks, its nested lists among them. Must
 * run inside an `editor.read` or `editor.update`.
 *
 * @param node - The node.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns `true` when a later block of its container writes Markdown.
 */
function $writesBlockAfter(node: LexicalNode, definitions: Links | null): boolean {
    return node.getNextSiblings().some((block) => serializeBlock(block, definitions) !== "");
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
    const { content, setext } = writtenHeadingContent(node, definitions);

    if (setext) {
        return `${content}\n${level === 1 ? SETEXT_H1_UNDERLINE : SETEXT_H2_UNDERLINE}`;
    }

    return "#".repeat(level) + (content === "" ? "" : " " + content);
}

/**
 * The content {@link serializeHeading} writes for a heading, without its
 * `#`s or underline: the lines of its setext form, or the one line of its ATX
 * form, whose trailing `#` run has its first `#` escaped.
 *
 * @param node - The heading.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The content, and whether it is written setext.
 */
function writtenHeadingContent(node: HeadingNode, definitions: Links | null): { content: string; setext: boolean } {
    return writtenHeadingLines(node.getChildren(), Number(node.getTag().slice(1)), definitions, "", false);
}

/**
 * The content of a heading, or the rest of one from a point, written as
 * {@link writtenHeadingContent} writes it.
 *
 * @param nodes - The heading's children, or the ones after the point.
 * @param level - The heading's level.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param before - The character before the nodes in the heading; `""` or `"\n"` where they open a line.
 * @param joinsIntoRawBlock - Whether the text is joined into a raw block or code block ({@link InlineContext.joinsIntoRawBlock}).
 * @returns The content, and whether it is written setext.
 */
function writtenHeadingLines(
    nodes: LexicalNode[], level: number, definitions: Links | null, before: string, joinsIntoRawBlock: boolean,
): { content: string; setext: boolean } {
    const continuesAfter = continuationOf(before);
    const joined = joinsIntoRawBlock ? { joinsIntoRawBlock } : {};

    if (level <= SETEXT_MAX_LEVEL) {
        // The underline is Markdown the lean rules do not see: `|` over `---` is a table.
        const lines = serializeInlineNodes(
            nodes, { ...MULTI_LINE, definitions, joinsMarkdown: true, trimsLineEdges: true, continuesAfter, ...joined },
        );

        const isMultiLine = lines.includes("\n") || before === "\n";
        const isInterrupted = lines.split("\n").some((line) => SETEXT_INTERRUPTING_LINE.test(line));

        if (isMultiLine && !isInterrupted) {
            return { content: lines, setext: true };
        }
    }

    const line = serializeInlineNodes(nodes, { ...HEADING_LINE, definitions, continuesAfter, ...joined });

    return { content: escapeClosingHashes(line, before), setext: false };
}

/**
 * Escapes the `#` run an ATX heading's line ends with, which would
 * otherwise read as the heading's closing sequence: a run after a space or
 * a tab, or one that is the whole line — when the line opens there.
 *
 * @param line - The heading's line, or the rest of it from a point.
 * @param before - The character before the line's text; `""` or `"\n"` at the heading's start.
 * @returns The line, its closing run escaped.
 */
function escapeClosingHashes(line: string, before: string): string {
    const runMayOpen = before === "" || /^[ \t\n]$/.test(before);

    return line.replace(/(^|[ \t])(#+)$/, (match: string, space: string, hashes: string) => {
        const isClosing = space !== "" || runMayOpen;

        return isClosing ? space + "\\" + hashes : match;
    });
}

/**
 * Serializes a quote as a document is serialized — its blocks, each as it is
 * written anywhere — with every line prefixed `> `. In a block a save writes
 * part by part, the blocks that were loaded in this quote are decided as a
 * document's are ({@link writtenQuote}).
 *
 * @param node - The quote.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The quoted lines, or `>` for a quote that writes nothing.
 */
function serializeQuote(node: QuoteNode, definitions: Links | null): string {
    const context = SAVE_PARTS.current;
    const written = context?.mode === "write" ? writtenQuote(node, definitions, context) : null;

    return written ?? quotedLines(serializeBlockList(node.getChildren(), definitions));
}

/**
 * Writes inner Markdown under a quote's marker: `> ` before a line that holds
 * something, `>` alone before an empty one, and `>` for nothing.
 *
 * @param content - The Markdown inside the quote.
 * @returns The quoted lines.
 */
function quotedLines(content: string): string {
    return content === "" ? ">" : content.split("\n").map((line) => (line === "" ? ">" : `> ${line}`)).join("\n");
}

/**
 * Writes a quote in a block a save writes part by part, as a save writes a
 * document: its blocks that were loaded in this quote are decided as the
 * top-level blocks are, with the lines before, between and after them kept,
 * markers and all, while those blocks are kept. Only a block written anew is
 * written under `> `.
 *
 * @param node - The quote.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param context - The write context of the block holding the quote.
 * @returns The quote's Markdown, or `null` when no block of it was loaded in it.
 */
function writtenQuote(node: QuoteNode, definitions: Links | null, context: WriteContext): string | null {
    return withPartsContext(context, () => {
        const children = node.getChildren();
        const blocks = new Map<NodeKey, MarkdownSourceBlock>();
        const quoted = new Map<MarkdownSourceBlock, MarkdownSourceQuoteBlock>();

        for (const child of children) {
            const part = context.parts.get(quoteBlockKey(child.getKey()));

            if (part?.kind === "quoteBlock" && part.quote === node.getKey()) {
                blocks.set(child.getKey(), part.block);
                quoted.set(part.block, part);
            }
        }

        if (blocks.size === 0) {
            return null;
        }

        const map: MarkdownSourceMap = { latest: blocks.values().next().value!.load, blocks, parts: context.parts };
        const parts = blockListParts(children, definitions, map, context.column);
        const written = writtenBlocks(parts, map, SAVE_DEFINITIONS.current!);

        return written.length === 0 ? ">" : quotedWrittenBlocks(written, quoted).join("\n");
    });
}

/**
 * Lays the blocks a quote writes out as its lines: a block written as its
 * source keeps its lines as written, and so do the lines between two such
 * blocks that followed each other at load; every other block, and every other
 * stretch between blocks, is written under the marker.
 *
 * @param written - The blocks the quote writes, at least one.
 * @param quoted - The quote's loaded blocks, by their source.
 * @returns The quote's lines.
 */
function quotedWrittenBlocks(written: readonly WrittenBlock[], quoted: ReadonlyMap<MarkdownSourceBlock, MarkdownSourceQuoteBlock>): string[] {
    const lines: string[] = [];
    const first = written[0]!;
    const last = written[written.length - 1]!;

    if (first.source !== undefined && first.source.index === 0) {
        lines.push(...linesOf(quoted.get(first.source)!.quotedPrefix));
    }

    written.forEach((block, index) => {
        if (index > 0) {
            const previous = written[index - 1]!;
            const keptBetween = followsAtLoad(previous.source, block.source);

            lines.push(...(keptBetween ? linesOf(quoted.get(previous.source!)!.quotedAfter) : quotedLines(separatorBefore(written, index)).split("\n").slice(1, -1)));
        }

        const part = block.source === undefined ? undefined : quoted.get(block.source);

        if (part === undefined) {
            lines.push(...quotedLines(block.text).split("\n"));

            return;
        }

        // The line end `writtenBlocks` adds after a raw block's source (`takesInBlockAfter`) is a line of the marker alone.
        const extra = block.text.slice(block.source!.body.length);

        lines.push(...linesOf(part.quotedBody), ...(extra === "" ? [] : quotedLines(extra).split("\n").slice(1)));
    });

    if (last.source !== undefined && last.source.index === last.source.load.blockCount - 1) {
        lines.push(...linesOf(quoted.get(last.source)!.quotedAfter));
    }

    return lines;
}

/**
 * Splits lines kept as written into their lines.
 *
 * @param text - The lines, joined by line ends; `""` for none.
 * @returns The lines.
 */
function linesOf(text: string): string[] {
    return text === "" ? [] : text.split("\n");
}

/**
 * Serializes a fenced code block: a backtick fence, or a `~` one when the
 * info string holds a backtick (which a backtick fence's info string cannot),
 * longer than any run of the fence's character that starts one of its lines.
 * The info string is the one the block was loaded with
 * ({@link codeInfoState}) while its first word, read as `marked` reads it,
 * is still the block's language, else the language with the `&` of each
 * character reference escaped.
 *
 * @param node - The code block.
 * @returns The fenced code.
 */
function serializeCode(node: CodeNode): string {
    const code = node.getTextContent();
    const language = node.getLanguage() ?? "";
    const authored = $getState(node, codeInfoState);
    const authoredLanguage = decodeEscapesAndCharacterReferences(authored).split(/\s+/)[0];
    // A backslash before punctuation or a symbol (`marked`'s escapable characters) is an escape, so it is doubled to stay a backslash before the `&` escape lands.
    const written = escapeCharacterReferences(language.replace(/\\(?=[\p{P}\p{S}])/gu, "\\\\"));
    const info = authored !== "" && authoredLanguage === language ? authored : written;
    const char = info.includes("`") ? "~" : "`";

    const longestRun = Math.max(0, ...code.split("\n").map((line) => {
        const run = CODE_LINE_FENCE_RUN.exec(line)?.[1] ?? "";

        return run.startsWith(char) ? run.length : 0;
    }));

    const fence = char.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestRun + 1));
    const context = SAVE_PARTS.current;

    if (context?.mode === "record") {
        context.partFingerprints.set(node.getKey(), info);
    } else if (context?.mode === "write") {
        const kept = keptCodeFrame(context.parts.get(node.getKey()), info, code);

        if (kept !== undefined) {
            return kept.opening + "\n" + (code === "" ? "" : code + "\n") + kept.closing;
        }
    }

    return fence + info + "\n" + (code === "" ? "" : code + "\n") + fence;
}

/**
 * The fence lines a save writes around a code block's code as they were
 * loaded: its info string is still
 * the one the standard form wrote at load, and no line of the code would
 * close the kept fence.
 *
 * @param part - The code block's part, if the load recorded one.
 * @param info - The info string the standard form writes now.
 * @param code - The code.
 * @returns The loaded frame, or `undefined` when the block is written in the standard form.
 */
function keptCodeFrame(
    part: MarkdownSourcePart | undefined, info: string, code: string,
): MarkdownSourceCodeFrame | undefined {
    if (part?.kind !== "codeFrame" || part.fingerprint !== info) {
        return undefined;
    }

    const closesFence = code.split("\n").some((line) => {
        const run = CODE_LINE_FENCE_RUN.exec(line)?.[1] ?? "";

        return run.startsWith(part.fenceCharacter) && run.length >= part.fenceLength;
    });

    return closesFence ? undefined : part;
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
 * Serializes a list with its authored marker: each item's blocks
 * ({@link serializeItemBlocks}) under its marker, a nested list among them indented
 * by the marker's width plus one. A loose list separates its items with a
 * blank line.
 *
 * @param list - The list.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param underText - Whether the list's first line follows a line of text in
 *   the same container: a bare `-` marker there would be a setext underline,
 *   so a `-` bullet list whose first line is a bare marker is written with `*`.
 *   That switch also applies when the first item opens with a thematic
 *   break of the bullet's own character, which would stand under a bare marker.
 * @param marker - The bullet or delimiter to write instead of the authored one.
 * @returns One line or more per item, joined by newlines.
 */
function serializeList(list: ListNode, definitions: Links | null, underText = false, marker?: string): string {
    const context = SAVE_PARTS.current;

    if (context?.mode === "write") {
        return writeListWithParts(list, definitions, underText, marker, context);
    }

    const nodes = list.getChildren().filter($isListItemNode);
    const items = nodes.map((item) => serializeItemBlocks(item, definitions));
    const { loose, nestedSeparated, markerOf } = listLayout(list, items, underText, marker);
    const itemLines = items.map((blocks, index) => listItemLines(markerOf(index), blocks, nestedSeparated).join("\n"));

    // Only the list's own marker is recorded: a candidate marker (`serializeListApart`) writes the items otherwise.
    if (context?.mode === "record" && marker === undefined) {
        nodes.forEach((item, index) => {
            context.partFingerprints.set(item.getKey(), itemFingerprint(list, items[index]!, nestedSeparated));
            context.standardItems.set(item.getKey(), itemLines[index]!);
        });
    }

    return itemLines.join(loose ? LOOSE_ITEM_SEPARATOR : "\n");
}

/** How a list writes its items: its looseness, whether a single item's nested list is set apart, and its markers. */
interface ListLayout {
    readonly loose:           boolean;
    readonly nestedSeparated: boolean;
    readonly markerOf:        (index: number) => string;
}

/**
 * Works out how a list writes its items from the items' blocks.
 *
 * @param list - The list.
 * @param items - Each item's blocks in the standard form.
 * @param underText - Whether the list's first line follows a line of text in the same container ({@link serializeList}).
 * @param marker - The bullet or delimiter to write instead of the authored one.
 * @returns The list's layout.
 */
function listLayout(list: ListNode, items: readonly (readonly ItemBlock[])[], underText: boolean, marker?: string): ListLayout {
    const loose = $getState(list, listLooseState);
    const opening = items[0]?.[0];
    const plainMarker = listMarkerWriter(list, false, marker)(0);

    // A thematic break of the bullet's own character opening the first item puts the marker on a line of
    // its own (see `listItemLines`), which under a line of text is a setext underline, as an empty item's is.
    const opensWithBreak = opening !== undefined && opening.withMarker === undefined
        && THEMATIC_BREAK.test(`${plainMarker} ${opening.markdown.split("\n")[0]!}`);

    const markerOf = listMarkerWriter(list, underText && (items[0]?.length === 0 || opensWithBreak), marker);

    // A single-item list is loose only through a blank line inside its item:
    // between its text and its nested list.
    return { loose, nestedSeparated: loose && items.length === 1, markerOf };
}

/**
 * The marker an item's fingerprint is written under: the list's bullet, or
 * `1` and its delimiter, so the number an ordered item is written with never
 * counts: inserting or deleting an item renumbers the later ones.
 *
 * @param list - The list.
 * @returns The marker.
 */
function fingerprintMarker(list: ListNode): string {
    return list.getListType() === "number" ? `1${$writtenListMarker(list)}` : $writtenListMarker(list);
}

/**
 * An item's fingerprint: its standard lines under the list's fingerprint marker.
 *
 * @param list - The list.
 * @param blocks - The item's blocks in the standard form.
 * @param nestedSeparated - Whether a nested list follows a blank line.
 * @returns The fingerprint.
 */
function itemFingerprint(list: ListNode, blocks: readonly ItemBlock[], nestedSeparated: boolean): string {
    return listItemLines(fingerprintMarker(list), blocks, nestedSeparated).join("\n");
}

/**
 * The most spaces between a list marker and its text that still set the
 * item's content column (CommonMark §5.2): with more, the text is indented
 * code and the column is one space after the marker.
 */
export const MAX_MARKER_SPACING = 4;

/** An item's first line as a content column reads it: the spaces before the marker, the marker, the spaces after it and the text. */
const ITEM_FIRST_LINE = /^( *)([-*+]|\d{1,9}[.)])( *)(.*)$/;

/** The digits an ordered item's first line starts with, after the spaces before them. */
const ITEM_NUMBER = /^( *)\d{1,9}/;

/**
 * The column an item's text starts at, which a nested block is indented to: the
 * spaces before the marker, the marker, and the spaces after it when one to
 * four and text follows, else one.
 *
 * @param line - The item's first line.
 * @returns The content column.
 *
 * @example
 * ```
 * contentColumn("   * inner")  // -> 5
 * contentColumn("1.  one")     // -> 4
 * contentColumn("-      x")    // -> 2
 * ```
 */
export function contentColumn(line: string): number {
    const match = ITEM_FIRST_LINE.exec(line);

    if (match === null) {
        return 0;
    }

    const [, before, marker, after, text] = match as unknown as [string, string, string, string, string];
    const spaced = after.length >= 1 && after.length <= MAX_MARKER_SPACING && text !== "";

    return before.length + marker.length + (spaced ? after.length : 1);
}

/**
 * A loaded item's source with the spaces before its marker taken off every
 * line, so it stands at its list's margin.
 *
 * @param part - The item.
 * @returns Its lines moved left by `part.indent`.
 */
function atMargin(part: MarkdownSourceItem): string {
    if (part.indent === 0) {
        return part.source;
    }

    return part.source.split("\n").map((line) => {
        const spaces = /^ */.exec(line)![0].length;

        return line.slice(Math.min(part.indent, spaces));
    }).join("\n");
}

/** Where an item stands among its list's items. */
interface ItemPlace {
    /** Whether the item may keep spaces before its marker: not the first item of a list that does not stand under text. */
    readonly mayIndent: boolean;
    /** The content column of the item written before it, which the spaces before this item's marker must stay under; unbounded for the first. */
    readonly room:      number;
}

/** What a list item is written with, apart from its blocks. */
interface ItemMarker {
    /** The marker, with its number for an ordered item. */
    readonly marker: string;
    /** The bullet or delimiter of the marker. */
    readonly bullet: string;
    /** The digits of an ordered item's number; `undefined` for a bullet. */
    readonly number: string | undefined;
}

/**
 * Writes a list in a block a save writes part by part: an item whose
 * fingerprint holds, and that reads the same where it now stands, as its
 * source; any other in the standard form, keeping its own spacing and
 * indentation, with its children written the same way.
 *
 * @param list - The list.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param underText - Whether the list's first line follows a line of text ({@link serializeList}).
 * @param marker - The bullet or delimiter to write instead of the authored one.
 * @param context - The write context.
 * @returns One line or more per item, joined by newlines.
 */
function writeListWithParts(list: ListNode, definitions: Links | null, underText: boolean, marker: string | undefined, context: WriteContext): string {
    const nodes = list.getChildren().filter($isListItemNode);
    const standard = withPartsContext(null, () => nodes.map((item) => serializeItemBlocks(item, definitions)));
    const layout = listLayout(list, standard, underText, marker);
    const written: string[] = [];

    nodes.forEach((item, index) => {
        const itemMarker = layout.markerOf(index);
        const delimiter = WRITTEN_LIST_MARKER.exec(itemMarker);
        const itemWrites: ItemMarker = {
            marker: itemMarker, bullet: delimiter?.[1] ?? delimiter?.[2] ?? "", number: ORDERED_LIST_MARKER.exec(itemMarker)?.[1],
        };
        const place: ItemPlace = {
            mayIndent: index > 0 || underText,
            room:      index === 0 ? Infinity : contentColumn(written[index - 1]!.split("\n")[0]!),
        };
        const found = context.parts.get(item.getKey());
        const part = found?.kind === "item" && found.column === context.column ? found : undefined;
        const fingerprint = itemFingerprint(list, standard[index]!, layout.nestedSeparated);
        const keeps = part !== undefined && itemKeepsSource(part, fingerprint, itemWrites, layout.loose, nodes.length);

        written.push(keeps
            ? keptItemSource(part, place, itemWrites.number)
            : rewrittenItemLines(part, itemWrites, place, serializeItemBlocks(item, definitions), standard[index]!, layout.nestedSeparated));
    });

    return written.join(layout.loose ? LOOSE_ITEM_SEPARATOR : "\n");
}

/**
 * Tells whether an ordered item is written with another number than the one
 * it was loaded with. `08` and `8` are one number, so a width-padded number
 * that is still the item's number is kept as written.
 *
 * @param digits - The digits the item was loaded with; `null` for a bullet item.
 * @param number - The digits the item is numbered with now.
 * @returns `true` when the numbers differ.
 */
function isRenumbered(digits: string | null, number: string): boolean {
    return digits !== null && Number(digits) !== Number(number);
}

/**
 * Tells whether an ordered item written with its new number keeps the content
 * column it was loaded with. A number that is still the item's (`08` written
 * as `8`) is kept as loaded; a new number replaces the old one in place only
 * if it has as many digits, since a wider or narrower marker moves what is
 * indented to the content column (a code block under the item gains or loses
 * a space).
 *
 * @param digits - The digits the item was loaded with; `null` for a bullet item.
 * @param number - The digits the item is numbered with now; `undefined` for a bullet.
 * @returns `true` when the item can keep its source.
 */
function keepsContentColumn(digits: string | null, number: string | undefined): boolean {
    return digits === null || (number !== undefined && (!isRenumbered(digits, number) || digits.length === number.length));
}

/**
 * Tells whether a loaded item is still written as its source: its fingerprint
 * holds, it stands in a list written with its bullet or delimiter, an ordered
 * item keeps its content column ({@link keepsContentColumn}), the list's looseness
 * suits the blank lines inside the item, and it reads the same under the
 * definitions now.
 *
 * @param part - The loaded item.
 * @param fingerprint - The item's standard lines now, under the list's fingerprint marker.
 * @param written - What the item is written with now.
 * @param loose - Whether the list is written loose.
 * @param itemCount - The number of items in the list.
 * @returns `true` when the item can be written as its source.
 */
function itemKeepsSource(part: MarkdownSourceItem, fingerprint: string, written: ItemMarker, loose: boolean, itemCount: number): boolean {
    return part.fingerprint === fingerprint
        && part.marker === written.bullet
        && keepsContentColumn(part.digits, written.number)
        && (loose ? itemCount > 1 || part.separatesBlocks : !part.separatesBlocks)
        && readsAlikeUnderDefinitions(part.source, part.load);
}

/**
 * A loaded item as its source, renumbered in place when its number changed and
 * moved to its list's margin where its indentation no longer fits.
 *
 * @param part - The loaded item.
 * @param place - Where the item stands among its list's items.
 * @param number - The digits the item is numbered with now; `undefined` for a bullet.
 * @returns The item's lines.
 */
function keptItemSource(part: MarkdownSourceItem, place: ItemPlace, number: string | undefined): string {
    const source = place.mayIndent && part.indent < place.room ? part.source : atMargin(part);

    return number === undefined || !isRenumbered(part.digits, number) ? source : source.replace(ITEM_NUMBER, `$1${number}`);
}

/**
 * An item in the standard form that keeps its own frame when it can: the
 * spaces between its marker and its text, and the spaces before its marker.
 * Its children are indented to its content column, so the loaded items
 * nested in it keep their place.
 *
 * @param part - The loaded item, if it has one in this column.
 * @param written - What the item is written with.
 * @param place - Where the item stands among its list's items.
 * @param blocks - The item's blocks, written part by part.
 * @param standardBlocks - The item's blocks in the standard form.
 * @param nestedSeparated - Whether a nested list follows a blank line.
 * @returns The item's lines.
 */
function rewrittenItemLines(
    part: MarkdownSourceItem | undefined, written: ItemMarker, place: ItemPlace, blocks: readonly ItemBlock[], standardBlocks: readonly ItemBlock[],
    nestedSeparated: boolean,
): string {
    const framed = part !== undefined && part.marker === written.bullet;
    const spaced = framed && blocks[0]?.isText === true && part.spacing.length >= 1 && part.spacing.length <= MAX_MARKER_SPACING;
    const lines = listItemLines(written.marker, blocks, nestedSeparated, spaced ? part.spacing : " ", standardBlocks);
    const indented = framed && place.mayIndent && part.indent > 0 && part.indent < place.room;

    return (indented ? lines.map((line) => (line === "" ? line : " ".repeat(part.indent) + line)) : lines).join("\n");
}

/**
 * Writes a list item's blocks, one per child of the item: its text
 * (`MarkdownListItemTextNode`), a further paragraph, a nested list, or any
 * other block. Empty blocks are dropped.
 *
 * @param item - The list item.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The item's blocks, in order.
 */
function serializeItemBlocks(item: ListItemNode, definitions: Links | null): ItemBlock[] {
    const cache = STANDARD_ITEM_BLOCKS.current;

    if (cache === null || SAVE_PARTS.current !== null) {
        return buildItemBlocks(item, definitions);
    }

    const cached = cache.get(item.getKey());

    if (cached !== undefined) {
        return cached;
    }

    const built = buildItemBlocks(item, definitions);

    cache.set(item.getKey(), built);

    return built;
}

/**
 * Writes a list item's blocks as {@link serializeItemBlocks} describes,
 * without the cache of a save's standard form.
 *
 * @param item - The list item.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The item's blocks, in order.
 */
function buildItemBlocks(item: ListItemNode, definitions: Links | null): ItemBlock[] {
    const blocks: ItemBlock[] = [];

    const push = (markdown: string, isList: boolean, isText: boolean, more?: Pick<ItemBlock, "marker" | "withMarker" | "isRaw" | "continuesText">): void => {
        if (markdown !== "") {
            blocks.push({ markdown, isList, isText, ...more });
        }
    };

    for (const child of item.getChildren()) {
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
        } else if ($isMarkdownListItemTextNode(child)) {
            push(withTaskMarker(child, serializeInline(child, { ...MULTI_LINE, definitions, inListItem: true })), false, true);
        } else if ($isParagraphNode(child)) {
            push(serializeInline(child, { ...MULTI_LINE, definitions, inItemParagraph: true }), false, true);
        } else {
            push(serializeBlock(child, definitions), false, false, { isRaw: $isMarkdownRawBlockNode(child) });
        }
    }

    return blocks;
}

/**
 * The kinds of the blocks {@link serializeItemBlocks} writes for a list item, in
 * order — each child that writes something — without writing them.
 *
 * @param item - The list item.
 * @returns `"list"` for a nested list, `"text"` for the item's text or a
 *   paragraph, `"block"` for anything else.
 */
function itemBlockKinds(item: ListItemNode): Array<"list" | "text" | "block"> {
    const kinds: Array<"list" | "text" | "block"> = [];
    let isInRun = false;

    for (const child of item.getChildren()) {
        // A horizontal rule is no element, yet a block.
        const isInline = $isElementNode(child) ? child.isInline() : !$isMarkdownHorizontalRuleNode(child);

        if (isInline) {
            // Inline nodes straight in an item, as Lexical's list code and its HTML import put them, before the
            // item is brought to its shape: each run of them is the one paragraph that shape makes of it.
            if (!isInRun) {
                kinds.push("text");
            }

            isInRun = true;

            continue;
        }

        isInRun = false;

        const writes = $isListNode(child)
            ? child.getChildrenSize() > 0
            : $isMarkdownHorizontalRuleNode(child) || $writesSomething(child as ElementNode);

        if (writes) {
            kinds.push($isListNode(child) ? "list" : $isParagraphNode(child) ? "text" : "block");
        }
    }

    return kinds;
}

/**
 * Tells whether a block of a list item writes anything, without writing it
 * where its kind tells: a paragraph by its inline content, a raw block by its
 * text, and a table or code block always. A list's looseness is read on
 * every keystroke in such a block, and writing every block of every item
 * for it made a keystroke cost grow with the list. The raw-block rules ask
 * it of the siblings of a changed block in any parent (the root, a `:::`
 * column, a list item), where the block may be a heading, quote, table or
 * any other element.
 *
 * @param block - A block child of a list item, other than a nested list, or
 *   a sibling of a changed block in another parent.
 * @returns `true` when a save writes Markdown for it.
 */
export function $writesSomething(block: ElementNode): boolean {
    if ($isParagraphNode(block)) {
        return holdsInlineContent(block.getChildren());
    }

    if ($isMarkdownRawBlockNode(block)) {
        return block.getTextContent().trim() !== "";
    }

    // Definitions only choose how a reference link is written, never whether a block writes anything.
    return $isTableNode(block) || $isCodeNode(block) || serializeBlock(block, null) !== "";
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
        || (segment.kind === "text" && (segment.code || holdsLineContent(segment.text)))
        || (segment.kind === "source" && holdsLineContent(segment.source)));
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
 * first block is a nested list starts it on the marker's line, as `- - n` is
 * written (CommonMark example 298's own form). An item whose first block is
 * not a nested list and whose marker line would read as a thematic break
 * (`- ---`) is written with its marker on a line of its own and the block
 * under it.
 *
 * @param marker - The item's marker (`-`, `3.`, …).
 * @param blocks - The item's blocks.
 * @param nestedSeparated - Whether a nested list follows a blank line.
 * @param spacing - The spaces between the marker and the item's first line; the content column follows it.
 * @param standardBlocks - The blocks of the same item in the standard form, when `itemBlocks` is the item written part by part.
 * @returns The item's lines.
 */
function listItemLines(
    marker: string, itemBlocks: readonly ItemBlock[], nestedSeparated: boolean, spacing: string = " ", standardBlocks?: readonly ItemBlock[],
): string[] {
    const indent = " ".repeat(marker.length + spacing.length);
    const lines: string[] = [];
    const blocks = keepNestedListsApart(itemBlocks, standardBlocks);

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

    const first = `${marker}${spacing}${lines[0]!.slice(indent.length)}`;
    const nested = blocks[0]!;

    // An item opening with a nested list of empty items writes its markers on one line, which can read as a
    // thematic break (`- - -`): the nested list then takes the other bullet, which no break mixes.
    if (THEMATIC_BREAK.test(first) && nested.withMarker !== undefined && BULLET_MARKERS.includes(nested.marker!)) {
        const bullet = first.trimEnd().at(-1) === "*" ? "-" : "*";

        return listItemLines(marker, [{ ...nested, markdown: nested.withMarker(bullet), marker: bullet }, ...blocks.slice(1)], nestedSeparated, spacing, standardBlocks);
    }

    // An item opening with a thematic break of its bullet's own character would read as one break
    // (`- ---`): the marker stands on a line of its own and the block under it, which `marked` reads as the
    // item's block.
    const opensWithOwnBreak = nested.withMarker === undefined && THEMATIC_BREAK.test(first);

    if (opensWithOwnBreak) {
        return [marker, ...lines];
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
 * as one. With no marker that keeps it apart, the list keeps its own. Two
 * raw blocks whose lists would join are written as they are, so
 * {@link LIST_SEPARATOR} goes between them, as between two at the top level.
 *
 * @param blocks - An item's blocks.
 * @returns The blocks, those lists rewritten or set apart.
 */
function keepNestedListsApart(blocks: readonly ItemBlock[], standard?: readonly ItemBlock[]): ItemBlock[] {
    const known = KEPT_APART.get(blocks);

    if (known !== undefined) {
        return known.kept;
    }

    // The same item written part by part has the blocks of its standard form, with nested lists written otherwise:
    // it keeps them apart the way the standard form did.
    const standardChoices = standard === undefined ? undefined : KEPT_APART.get(standard)?.choices;

    if (standardChoices !== undefined && standardChoices.length === blocks.length) {
        return applyKeptApart(blocks, standardChoices);
    }

    const kept: ItemBlock[] = [];
    const choices: KeptApartChoice[] = [];

    blocks.forEach((block, index) => {
        const previous = kept[kept.length - 1];
        const next = blocks[index + 1];
        const joinsRawBefore = block.isRaw === true && previous?.isRaw === true && listsJoin(previous.markdown, block.markdown);

        if (joinsRawBefore) {
            kept.push({ markdown: LIST_SEPARATOR, isList: false, isText: false, isRaw: true });
        }

        choices.push({ separatorBefore: joinsRawBefore, marker: undefined });

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

        choices[choices.length - 1] = { separatorBefore: joinsRawBefore, marker: other };
        kept.push({ ...block, markdown, marker: writtenListMarker(markdown) });
    });

    KEPT_APART.set(blocks, { kept, choices });

    return kept;
}

/**
 * Keeps an item's nested lists apart as an earlier answer of
 * {@link keepNestedListsApart} did for the same item's blocks.
 *
 * @param blocks - The item's blocks, one for each of the choices.
 * @param choices - The choices made for each.
 * @returns The blocks, with the separators and the markers the choices tell.
 */
function applyKeptApart(blocks: readonly ItemBlock[], choices: readonly KeptApartChoice[]): ItemBlock[] {
    return blocks.flatMap((block, index) => {
        const choice = choices[index]!;
        const separator: ItemBlock[] = choice.separatorBefore ? [{ markdown: LIST_SEPARATOR, isList: false, isText: false, isRaw: true }] : [];

        if (choice.marker === undefined || block.withMarker === undefined) {
            return [...separator, block];
        }

        const markdown = block.withMarker(choice.marker);

        return [...separator, { ...block, markdown, marker: writtenListMarker(markdown) }];
    });
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
        writtenRow(rows[0]!, rowTexts(rows[0]!, () => [...headerCells.map((cell) => serializeTableCell(cell, definitions)), ...padding])),
        writtenDelimiterRow(table, formatDelimiterRow(alignments, table.getColWidths() ?? [])),
    ];

    for (const row of rows.slice(1)) {
        lines.push(writtenRow(row, rowTexts(row, () => serializeBodyRow(row, columnCount, pendingRowSpans, definitions))));
    }

    return lines.join("\n");
}

/**
 * Whether a loaded source holding a `[` still reads as loaded under the
 * definitions the save is writing: only such source can use a definition.
 *
 * @param source - A part's source.
 * @param load - The import that loaded the part.
 * @returns `true` when the source means what it meant at load.
 */
function readsAlikeUnderDefinitions(source: string, load: MarkdownSourceLoad): boolean {
    return !source.includes(LABEL_OPEN) || load.definitionsKey === SAVE_DEFINITIONS.current!.key;
}

/**
 * Writes a table row's line. The load records its standard line and each
 * column's standard cell text; a save writes the row as its line while its
 * standard line equals the recorded one, and otherwise cell by cell: a cell
 * whose standard text equals its recorded text as the text between its pipes
 * in the source, spaces included, any other as its standard text with a
 * space each side.
 *
 * @param row - The row.
 * @param texts - The row's standard cell texts, one per column.
 * @returns The row's line.
 */
function writtenRow(row: TableRowNode, texts: string[]): string {
    const standard = formatPipeRow(texts);
    const context = SAVE_PARTS.current;

    if (context?.mode === "record") {
        context.partFingerprints.set(row.getKey(), standard);
        context.cellFingerprints.set(row.getKey(), texts);

        return standard;
    }

    const found = context?.mode === "write" ? context.parts.get(row.getKey()) : undefined;
    const part = found?.kind === "row" && found.column === context?.column && readsAlikeUnderDefinitions(found.line, found.load) ? found : undefined;

    if (part === undefined) {
        return standard;
    }

    // A merge marker the source holds as text (the standard form escapes it) reads as a merge by the cell above or
    // to the left, so it is kept only where it was loaded, which no edit around it guarantees: it is written anew.
    const literalMarkers = part.cells.map((cell, column) => holdsLiteralMergeMarker(cell, part.cellFingerprints[column]));

    const hasLiteralMarker = literalMarkers.includes(true);

    if (part.fingerprint === standard && !hasLiteralMarker) {
        return part.line;
    }

    // A row without outer pipes keeps that frame only while its first and last cells hold text.
    const bare = !part.outerPipes && texts[0] !== "" && texts[texts.length - 1] !== "";

    const cells = texts.map((text, column) => {
        const kept = part.cells[column];

        if (part.cellFingerprints[column] === text && kept !== undefined && !literalMarkers[column]) {
            return kept;
        }

        return `${bare && column === 0 ? "" : " "}${text}${bare && column === texts.length - 1 ? "" : " "}`;
    });

    return bare ? cells.join("|") : `|${cells.join("|")}|`;
}

/**
 * Tells whether a loaded cell's text is a merge marker (`<<`, `^^`) that the
 * standard form writes escaped: the source holds the marker as text where the
 * cell above or to the left cannot merge, and written next to other cells it
 * would merge.
 *
 * @param cell - The cell's text between its pipes, as written.
 * @param standard - The cell's standard text at load.
 * @returns `true` when the source and the standard form read the cell differently.
 */
function holdsLiteralMergeMarker(cell: string, standard: string | undefined): boolean {
    const text = cell.trim();

    return MERGE_MARKERS.has(text) && standard !== text;
}

/**
 * Writes a table's delimiter row: the load records its standard form, and a
 * save writes the loaded line while the standard form is still that.
 *
 * @param table - The table.
 * @param standard - The delimiter row in the standard form.
 * @returns The delimiter row's line.
 */
function writtenDelimiterRow(table: TableNode, standard: string): string {
    const context = SAVE_PARTS.current;

    if (context?.mode === "record") {
        context.partFingerprints.set(table.getKey(), standard);

        return standard;
    }

    const found = context?.mode === "write" ? context.parts.get(table.getKey()) : undefined;
    // No column rule: a delimiter row holds only dashes, colons and pipes, so no column line (`:::`, `|||`) is one.
    const kept = found?.kind === "delimiterRow" && found.fingerprint === standard;

    return kept ? found.line : standard;
}

/**
 * A row's cell texts in the standard form. A save writes a table in the
 * standard form first, and writes it again part by part when it is edited;
 * the second time the texts of the first are read again. (The texts of a row
 * depend on the rows above it only through spans, which the first pass has
 * resolved for every row.)
 *
 * @param row - The row.
 * @param write - Writes the row's texts.
 * @returns The texts, one per column.
 */
function rowTexts(row: TableRowNode, write: () => string[]): string[] {
    const cache = STANDARD_ROW_TEXTS.current;
    const mode = SAVE_PARTS.current?.mode;

    if (cache === null || mode === "record") {
        return write();
    }

    const cached = mode === "write" ? cache.get(row.getKey()) : undefined;

    if (cached !== undefined) {
        return cached;
    }

    const texts = write();

    if (mode === undefined) {
        cache.set(row.getKey(), texts);
    }

    return texts;
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
    const children = cell.getChildren();

    // The paragraphs and list items are written as one run, so a delimiter left bare in two of them can pair
    // across the break, which no paragraph's own lean check sees: they keep every escape.
    const joined = children.length > 1 || children.some($isListNode);

    const text = children
        .map((child) => serializeCellChild(child, definitions, joined))
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
 * @param joined - Whether the cell's children are written as one run, so each keeps every escape.
 * @returns Its text for the pipe row.
 */
function serializeCellChild(child: LexicalNode, definitions: Links | null, joined: boolean): string {
    if (!$isListNode(child)) {
        return serializeInlineNodes($isElementNode(child) ? child.getChildren() : [child], { ...TABLE_CELL, definitions, joinsMarkdown: joined });
    }

    // An item's empty text gives no line, as an item holding nothing gives none.
    return child.getChildren().filter($isListItemNode)
        .flatMap((item) => item.getChildren().filter((block) => !($isMarkdownListItemTextNode(block) && block.isEmpty())))
        .map((block) => serializeCellChild(block, definitions, joined))
        .join(CELL_PARAGRAPH_BREAK);
}

/**
 * Serializes a `:::` fence: its opening line ({@link fenceOpeningLine}), its
 * columns and its closing `:::`.
 *
 * @param node - The fence.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The fence, or its children's blocks when it has no columns.
 */
function serializeFence(node: MarkdownBlockNode, definitions: Links | null): string {
    const columns = node.getColumns();
    const context = SAVE_PARTS.current;

    if (columns.length === 0) {
        // The load builds every fence with columns, so a fence without one holds blocks no part was loaded for: they
        // are written in the standard form (a block list given no source map keeps no part).
        return serializeBlockList(node.getChildren(), definitions);
    }

    const opening = fenceOpeningLine(node, columns.length);

    const body = joinColumnSections(columns.map((column) => (context?.mode === "write"
        ? writtenColumn(column, definitions, context)
        : serializeBlockList(column.getChildren(), definitions))));

    return `${opening}\n${body}\n:::`;
}

/**
 * Writes one column of a fence in a block a save writes part by part, as a
 * save writes a document: its blocks that were loaded in this column are
 * decided as the top-level blocks are, with the text before, between and
 * after them kept while those blocks are kept.
 *
 * @param column - The column.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @param context - The write context of the fence.
 * @returns The column's Markdown.
 */
function writtenColumn(column: MarkdownColumnNode, definitions: Links | null, context: WriteContext): string {
    const own: WriteContext = { ...context, column: column.getKey() };

    return withPartsContext(own, () => {
        const children = column.getChildren();
        const blocks = new Map<NodeKey, MarkdownSourceBlock>();

        for (const child of children) {
            const part = context.parts.get(columnBlockKey(child.getKey()));

            if (part?.kind === "columnBlock" && part.column === own.column) {
                blocks.set(child.getKey(), part.block);
            }
        }

        if (blocks.size === 0) {
            return serializeBlockList(children, definitions);
        }

        const map: MarkdownSourceMap = { latest: blocks.values().next().value!.load, blocks, parts: context.parts };
        const parts = blockListParts(children, definitions, map, column.getKey());
        const written = writtenBlocks(parts, map, SAVE_DEFINITIONS.current!);

        return written.length === 0 ? "" : assembleDocument(written, documentLoad(parts, map));
    });
}

/**
 * Writes a fence's opening line. A fence with an authored label
 * ({@link MarkdownBlockNode.hasAuthoredLabel}) is written as loaded, its
 * attribute group rewritten only when the fence's style changed
 * ({@link withAttributeGroup}). Any other fence is written in the standard
 * form: `columns` when it has two or more columns, its attributes, and `{}`
 * for a one-column fence with none (a bare `:::` cannot open a fence).
 *
 * @param node - The fence.
 * @param columnCount - The fence's column count.
 * @returns The opening line, starting with `:::`.
 */
function fenceOpeningLine(node: MarkdownBlockNode, columnCount: number): string {
    const authored = $getState(node, fenceOpeningState);
    const group = FENCE_ATTRIBUTE_GROUP.exec(authored);
    const attributes = fenceAttributeText(node, group?.[1] ?? "");
    const labelled = node.hasAuthoredLabel();

    if (labelled) {
        return ":::" + withAttributeGroup(authored, group, attributes);
    }

    return ":::"
        + (columnCount > 1 ? " " + FENCE_COLUMNS_KEYWORD : "")
        + (attributes !== "" ? ` {${attributes}}` : columnCount > 1 ? "" : " {}");
}

/**
 * Applies a fence's attributes to its loaded opening line: no group and no
 * attributes leaves the line as loaded; no group and attributes adds one at
 * the end; a group with the same text stays; otherwise the group is replaced
 * in place, or dropped with the whitespace before it when the attributes are
 * empty (a space then keeps the words either side of it apart) — unless a later group follows, which the viewer would then read, so
 * the first stays, emptied.
 *
 * @param authored - The opening line's text after its `:::`, as loaded.
 * @param group - The loaded line's attribute group, or `null` for none.
 * @param attributes - The attribute text the fence is written with.
 * @returns The opening line's text after its `:::`.
 */
function withAttributeGroup(authored: string, group: RegExpExecArray | null, attributes: string): string {
    if (group === null) {
        return attributes === "" ? authored : `${authored} {${attributes}}`;
    }

    if (group[1] === attributes) {
        return authored;
    }

    const before = authored.slice(0, group.index);
    const after = authored.slice(group.index + group[0].length);
    // A later group would become the one the viewer reads once this one goes, so it stays, emptied.
    const droppable = attributes === "" && !FENCE_ATTRIBUTE_GROUP.test(after);

    if (!droppable) {
        return `${before}{${attributes}}${after}`;
    }

    const kept = before.trimEnd();
    // Whitespace after the `:::` (`before` without `kept`) is the author's own, so it is kept too.
    const joinsWords = (kept !== "" || before !== "") && /^\S/.test(after);

    return joinsWords ? `${kept} ${after}` : kept + after;
}

/**
 * Reads the attribute text a fence is written with: the loaded group's text
 * ({@link fenceOpeningState}) while it still resolves to the fence's
 * alignment and column gap — keeping the attributes' order and the ones the
 * editor does not model — else its style as normalized attribute text.
 *
 * @param node - The fence.
 * @param authored - The attribute text inside the loaded opening line's group, or `""`.
 * @returns The attribute text (`align=right …`), or `""` for none.
 */
function fenceAttributeText(node: MarkdownBlockNode, authored: string): string {
    const normalized = formatAttributes(node.toAttributes());
    const writable = authored !== "" && !/[\n{}]/.test(authored);

    return writable && formatAttributes(blockStyleToAttributes(resolveBlockStyle(parseAttributes(authored)))) === normalized ? authored : normalized;
}

// ---------------------------------------------------------------- inline: flatten and group

/**
 * Serializes an element's inline content.
 *
 * @param element - The paragraph, heading, list item or cell paragraph.
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
 * their source text — and a heading's id — survives. The chosen writing is
 * then written with lean escapes where that reads as the writing with every
 * escape ({@link leanOrFull}).
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

    const plain = !tildes && !written.some((piece) => piece.kind === "delimiter" || piece.kind === "autolink");

    if (plain) {
        return leanOrFull(written, context, NO_CHOICES);
    }

    const intended = withoutTrailingWhitespace(segmentReading(segments, { ...context, readsWhitespace: true }));

    if (intended === null) {
        return leanOrFull(written, context, NO_CHOICES);
    }

    const readBack = createReadBack(intended, context);

    const writings = tildes ? [context, { ...context, looseTildes: true }] : [context];

    for (const writing of holds("<") ? [...writings, ...writings.map((loose) => ({ ...loose, escapedAngles: true }))] : writings) {
        for (const policy of WRITING_POLICIES) {
            const pieces = writing === context && policy === WRITING_POLICIES[0] ? written : writeInlinePieces(segments, writing, policy);
            const switched = switchedPairs(pieces, writing, readBack);

            if (switched !== null) {
                return leanOrFull(pieces, writing, { switched, bare: bareAutolinks(pieces, writing, switched, readBack) });
            }

            const spent = readBack.spent();

            if (spent) {
                return leanOrFull(written, context, NO_CHOICES);
            }
        }
    }

    return leanOrFull(written, context, NO_CHOICES);
}

/**
 * Assembles a block's chosen writing with the lean escapes where that reads,
 * to the viewer, exactly as the writing with every escape does, and with
 * every escape otherwise. Markdown that joins other Markdown
 * ({@link InlineContext.joinsMarkdown}) keeps every escape.
 *
 * @param pieces - The block's written pieces.
 * @param context - The chosen writing's context.
 * @param choices - The chosen writing's assembly choices.
 * @returns The inline Markdown.
 */
function leanOrFull(pieces: Piece[], context: InlineContext, choices: AssemblyChoices): string {
    if (context.joinsMarkdown === true) {
        return assembleLines(pieces, context, choices);
    }

    const drops = { count: 0 };
    const lean = assembleLines(pieces, { ...context, lean: true }, choices, drops);

    if (drops.count === 0) {
        return lean;
    }

    const full = assembleLines(pieces, context, choices);
    // A first line that continues a line is read after the character it follows.
    const prefix = context.continuesAfter ?? "";
    const alike = leanReadsAsFull(prefix + lean, prefix + full, context);

    return alike ? lean : full;
}

/**
 * Tells whether a block's lean writing reads, to the viewer, exactly as its
 * writing with every escape does — the same characters, whitespace, marks,
 * links, styles and breaks, in the block it is written for — remembering
 * each answer.
 *
 * @param lean - The lean writing.
 * @param full - The writing with every escape.
 * @param context - Where the block is written.
 * @returns `true` when the two read alike and the full writing reads as one such block.
 */
function leanReadsAsFull(lean: string, full: string, context: InlineContext): boolean {
    const kind = context.inTableCell ? "cell" : context.singleLine ? "line" : "lines";
    const definitions = SAVE_DEFINITIONS.current ?? $readDefinitions();
    const key = [kind, definitions.key, full, lean].join(READING_KEY_SEPARATOR);
    const known = LEAN_READS.get(key);

    if (known !== undefined) {
        return known;
    }

    const reading: InlineContext = { ...context, definitions: definitions.all, readsWhitespace: true };
    const fullReading = markdownReading(full, reading);
    const alike = fullReading !== null && JSON.stringify(markdownReading(lean, reading)) === JSON.stringify(fullReading);

    if (LEAN_READS.size >= LEAN_READING_CACHE_SIZE) {
        LEAN_READS.clear();
    }

    LEAN_READS.set(key, alike);

    return alike;
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
            segments.push(keptLeafSegment({ kind: "image", node, marks: imageSegmentMarks(node), link }, node));
        } else if ($isMarkdownTaskCheckboxNode(node)) {
            // Not inline content: the item's writer writes its marker (withTaskMarker).
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
 * The marks an image was read inside ({@link imageMarksState}), in the fixed
 * order. Must run inside an `editor.read` or `editor.update`.
 *
 * @param node - The image.
 * @returns Its marks.
 */
function imageSegmentMarks(node: MarkdownImageNode): Mark[] {
    const formats = $getState(node, imageMarksState).split(" ");

    return MARK_ORDER.filter((mark) => formats.includes(MARK_FORMATS[mark]));
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
 * What an image showed, for {@link KeptSource.shown}: its source, alt text,
 * title and size. A kept construct is written as its source only while its image
 * still shows the same. Must run inside an `editor.read` or
 * `editor.update`.
 *
 * @param node - The image.
 * @returns A key of what it shows.
 */
export function keptImageShown(node: MarkdownImageNode): string {
    return JSON.stringify([node.getSrc(), node.getAlt(), node.getTitle(), node.getImageWidth(), node.getImageHeight()]);
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

    return whole(lexMarkdown(source)) || whole(lexMarkdownWithDefinitions(source, $documentDefinitions()));
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
 * cell keeps them all: the viewer renders its `<br>` at either edge. A
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
        || (segment.kind === "text" && (segment.code || holdsLineContent(segment.text)))
        || (segment.kind === "source" && holdsLineContent(segment.source));

    const isBreak = (segment: Segment): boolean =>
        segment.kind === "break" || (segment.kind === "source" && !holdsLineContent(segment.source));

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

        const holdsContent = segment.kind === "image" || (segment.kind === "text" && (segment.code || holdsLineContent(segment.text)))
            || (segment.kind === "source" && holdsLineContent(segment.source));

        if (holdsContent) {
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

    return (unit.kind === "text" || unit.kind === "source" || unit.kind === "image") && unit.marks.includes(mark);
}

/**
 * Writes one segment, first closing and opening marks to match it. A break
 * carries no marks. An image is written inside the marks it was read inside
 * ({@link imageMarksState}) where their delimiters can pair, and inside the
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

    if (segment.kind === "image") {
        // The marks the image was read inside are written where their delimiters can pair around its punctuation.
        const own = invisibleRunMarks(writer, segment.marks.filter((mark) => !inherited.includes(mark)), next);

        syncMarks(writer, [...new Set([...imageMarks(writer, inherited, next), ...own])], "");
        writeImage(writer, segment.node);

        return;
    }

    syncMarks(writer, [], "");

    writer.pieces.push(writeBreak(segment.marker, writer.context));
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
 * URL and title, matching labels as `marked` does ({@link linkLabelKey}).
 * An empty title counts as none, as `marked`
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

    const key = linkLabelKey(node.getReference().label);

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
 * inherited ones. A break carries none. Underline is left out when
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
        && segments.every((segment) => (segment.kind === "text" || segment.kind === "source" || segment.kind === "image") && segment.marks.includes(mark)));
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
 * The piece a line break writes: `<br>` in a table cell
 * ({@link CELL_HARD_BREAK}), a space in a heading, else a hard break with its
 * marker.
 *
 * @param marker - The break's authored marker.
 * @param context - Where it is written.
 * @returns The piece.
 */
function writeBreak(marker: string, context: InlineContext): Piece {
    if (context.inTableCell) {
        return { kind: "syntax", text: CELL_HARD_BREAK };
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
 * breaks are written where its block can hold them: in a heading or table
 * cell, whose content is one line, each is written `&#10;`, which reads back
 * as the line feed; elsewhere no blank line is written, which would end the
 * block, so each stretch of line breaks becomes one. The `&` of a character
 * reference is escaped in both (`\&copy;`), since `marked` reads one as its
 * character.
 *
 * @param link - The link.
 * @param context - Where it is written.
 * @returns `(url)`, `(<url>)` when the URL holds a character a bare destination cannot, plus ` "title"`.
 */
function writeLinkDestination(link: LinkNode, context: InlineContext): string {
    return writeDestination(link.getURL(), link.getTitle(), context);
}

/**
 * Writes a title's text between its quotes. A line feed is written as a
 * character reference (`&#10;`), which reads back as the line feed, wherever
 * a literal one would end the block or the line: in a block that holds one
 * line, and next to a blank line or a line edged by whitespace. A line feed
 * between two lines of text stays a literal line break. The last backslash of
 * a title that ends in one is written `&#92;`.
 *
 * @param title - The title.
 * @param context - Where it is written.
 * @returns The title's text.
 */
function writeTitleLines(title: string, context: InlineContext): string {
    const parts = title.split("\n");
    const joined = parts.reduce((written, part, index) => {
        const escaped = escapeCharacterReferences(part.replace(/[\\"]/g, "\\$&"));
        const bothHoldText = /\S$/.test(parts[index - 1] ?? "") && /^\S/.test(part);

        return index === 0 ? escaped : written + (context.singleLine || !bothHoldText ? "&#10;" : "\n") + escaped;
    }, "");

    return joined.replace(/\\\\$/, "&#92;");
}

/**
 * Writes a destination and title in parentheses, as {@link writeLinkDestination}
 * does for a link and {@link writeImage} does for an image. The last backslash
 * of a title that ends in one is written `&#92;`, since `marked` reads a
 * closing quote after a backslash as escaped.
 *
 * @param url - The destination.
 * @param title - The title; `null` or `""` for none.
 * @param context - Where it is written.
 * @returns `(url)`, `(<url>)` when the URL holds a character a bare destination cannot, plus ` "title"`.
 */
function writeDestination(url: string, title: string | null, context: InlineContext): string {
    const titled = title !== null && title !== "";
    const bare = url !== "" && ![...url].some((char) => needsAngleBrackets(char));
    const destination = bare ? escapeCharacterReferences(url) : url === "" && !titled ? "" : `<${escapeCharacterReferences(url.replace(/[\\<>]/g, "\\$&"))}>`;
    const titleText = titled ? writeTitleLines(title, context) : "";
    const written = `(${destination}${titled ? ` "${titleText}"` : ""})`;

    return context.inTableCell ? written.replace(/\|/g, "\\|") : written;
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
 * Writes an image onto the line being built: the form it was loaded in while
 * that still reads as this image, else the standard form
 * `![alt](destination "title")`, its alt text written as link text is. Both
 * forms are followed by the image's attribute group.
 *
 * @param writer - The inline writer.
 * @param node - The image.
 */
function writeImage(writer: InlineWriter, node: MarkdownImageNode): void {
    const attributeText = imageAttributeText(node);
    const attributes = attributeText === "" ? "" : `{${attributeText}}`;
    const written = $getState(node, imageWrittenState);

    if (writtenFormHolds(node, written, writer.context)) {
        const form = attributes === "" ? imageReferenceForm(written) : null;

        // A shortcut or collapsed reference is a reference piece, as a reference link's are: its `]` is no reason
        // to escape a `(` after it, and a shortcut is written collapsed where the next character would join it.
        writer.pieces.push(form === "shortcut" || form === "collapsed"
            ? { kind: "reference", text: written, shortcut: form === "shortcut", image: true }
            : { kind: "syntax", text: written + attributes });

        return;
    }

    writer.pieces.push({ kind: "syntax", text: "!" }, { kind: "syntax", text: "[" });

    const altStart = writer.pieces.length;

    node.getAlt().split("\n").forEach((line, index) => {
        if (index > 0) {
            writer.pieces.push({ kind: "syntax", text: "&#10;" });
        }

        if (line !== "") {
            writer.pieces.push({ kind: "text", text: line });
        }
    });

    protectLabelBrackets(writer.pieces, altStart);
    writer.pieces.push({ kind: "syntax", text: `]${writeDestination(node.getSrc(), node.getTitle(), writer.context)}${attributes}` });
}

/**
 * Whether a written image form can name a link reference definition: it ends
 * in `]` (a reference form) or holds a `[` after its `![` (its alt text may
 * hold a reference).
 *
 * @param written - The image as written.
 * @returns `true` when it can.
 */
function imageFormNamesLabel(written: string): boolean {
    return written.endsWith("]") || written.includes(LABEL_OPEN, 2);
}

/**
 * Reads a written image form alone, under definitions.
 *
 * @param written - The image as written, without its attribute group.
 * @param definitions - The definitions in force; `null` for none.
 * @returns The image token when the whole text reads as one image, else `null`.
 */
export function readImageForm(written: string, definitions: Links | null): MdImageToken | null {
    const namesLabel = imageFormNamesLabel(written);
    const known = namesLabel ? undefined : IMAGE_FORMS_READ.get(written);

    if (known !== undefined) {
        return known;
    }

    const tokens = lexMarkdownInline(written, definitions ?? undefined);
    const only = tokens.length === 1 && tokens[0]!.type === "mdimage" && tokens[0]!.raw === written ? tokens[0] as unknown as MdImageToken : null;

    if (!namesLabel) {
        if (IMAGE_FORMS_READ.size >= RUNS_ON_CACHE_SIZE) {
            IMAGE_FORMS_READ.clear();
        }

        IMAGE_FORMS_READ.set(written, only);
    }

    return only;
}

/**
 * Whether an image's written form still reads as the image: lexed alone under
 * the save's definitions, it is one image whose source, alt text and title
 * equal the node's, and it can stand where it is written.
 *
 * @param node - The image.
 * @param written - The form it was loaded in; `""` for an image made in the editor.
 * @param context - Where it is written.
 * @returns `true` when the written form can be saved as it is.
 */
function writtenFormHolds(node: MarkdownImageNode, written: string, context: InlineContext): boolean {
    if (written === "" || BLANK_LINE_IN_TITLE.test(written) || (context.singleLine && written.includes("\n")) || (context.inTableCell && written.includes("|"))) {
        return false;
    }

    const image = readImageForm(written, context.definitions);
    const title = node.getTitle();

    return image !== null && image.src === node.getSrc() && image.alt === node.getAlt()
        && (image.title === title || BLANK_LINE_IN_TITLE.test(title ?? ""));
}

/**
 * Which reference form a written image is, read the way `marked` and the
 * reference-link importer read it: by matching the whole written text against
 * `marked`'s own patterns, never by how it ends, since a label may end in an
 * escaped bracket (`![a\[]` is a shortcut reference to the label `a\[`).
 *
 * @param written - The image as written, without its attribute group.
 * @returns `"full"` (`![alt][label]`), `"collapsed"` (`![label][]`), `"shortcut"` (`![label]`), or `null` for an inline image.
 */
function imageReferenceForm(written: string): "full" | "collapsed" | "shortcut" | null {
    const matchesWhole = (pattern: RegExp, text: string): boolean => pattern.exec(text)?.[0] === text;

    if (matchesWhole(FULL_REFERENCE, written)) {
        return "full";
    }

    if (!matchesWhole(SHORT_REFERENCE, written)) {
        return null;
    }

    const collapsed = written.endsWith("[]") && matchesWhole(SHORT_REFERENCE, written.slice(0, -2));

    return collapsed ? "collapsed" : "shortcut";
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
            reading.push(imageReading(segment.node.getSrc(), segment.node.getAlt(), segment.node.getTitle(), link));
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
            case "html":       pushHtmlReading(reading, token as Tokens.HTML, scope, context); break;
            case "mdimage": {
                const image = token as unknown as MdImageToken;

                reading.push(imageReading(image.src, image.alt, image.title, scope.link));

                break;
            }
            // As the viewer shows any other token: its text, else its source.
            default:           pushCharacterReading(reading, (token as Tokens.Generic).text ?? token.raw, scope, context);
        }

        spans?.set(token, [start, reading.length]);
    }
}

/**
 * Appends the reading of inline HTML: a break for a `<br>` in a table cell
 * ({@link CELL_LINE_BREAK_TAG}), as the viewer renders it there; else its
 * characters, as the viewer shows them.
 *
 * @param reading - The reading units so far. Extended in place.
 * @param token - The `html` token.
 * @param scope - What it inherits.
 * @param context - Where it is written.
 */
function pushHtmlReading(reading: string[], token: Tokens.HTML, scope: ReadingScope, context: InlineContext): void {
    const isCellLineBreak = context.inTableCell && CELL_LINE_BREAK_TAG.test(token.text);

    if (isCellLineBreak) {
        pushBreakReading(reading);
    } else {
        pushCharacterReading(reading, token.text, scope, context);
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
function imageReading(src: string, alt: string, title: string | null, link: string): string {
    return ["\u0002image", src, alt, title ?? "", link].join(READING_KEY_SEPARATOR);
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
 * @param drops - Counts the escapes a lean writing ({@link InlineContext.lean}) leaves out.
 * @returns The inline Markdown.
 */
function assembleLines(
    pieces: Piece[], context: InlineContext, choices: AssemblyChoices = NO_CHOICES, drops: { count: number } = { count: 0 },
): string {
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
    // A first line that continues a line opens no block: no definition starts there.
    const continues = context.continuesAfter !== undefined;
    let written = continues;

    const block = context.lean === true ? leanBlock(lineContents) : null;

    return lines.map((line, index) => {
        const lean = block === null ? null : {
            pairable: block.pairable, grouped: block.grouped[index]!, continuation: index > 0,
            afterMarker: context.inListItem === true && index === 0 && !continues, drops,
        };

        const continuing = continues && index === 0;
        const rendered = renderLine(lineContents[index]!, context, !written, lean, continuing ? context.continuesAfter! : null);
        const content = continuing ? rendered : escapeHtmlBlockStart(rendered, lineContents[index]!, index === 0, context);

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
 * Whether a text node is written after syntax of its own — the `++` of
 * underline, the `[` of a styled span — so that the spaces and tabs it opens
 * with are not at a line's start in the save: {@link trimLineEdges} trims only
 * a line whose first piece is text, and keeps these. Other marks (bold,
 * italic, strike) never carry edge whitespace, the writer puts it outside. A
 * span is written when {@link spanAttributeText} gives its attributes, as the
 * writer decides: a span loaded with attributes the editor does not model
 * (`{foo=1}`) holds an unstyled node and is written all the same.
 *
 * @param node - The text node.
 * @returns `true` when its leading whitespace is written after syntax.
 */
export function $writesSyntaxBeforeText(node: TextNode): boolean {
    return node.hasFormat("underline") || spanAttributeText(node) !== "";
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
    const indentsSource = !firstLine && trimmed[1]?.kind === "source" && first?.kind === "text" && ASCII_BLANK.test(first.text);

    if (first?.kind === "text" && !indentsSource) {
        trimmed[0] = { kind: "text", text: first.text.replace(/^[ \t]+/, "") };
    }

    const lastIndex = trimmed.length - 1;
    const last = trimmed[lastIndex];

    if (last?.kind === "text") {
        const followsSource = lastIndex > 0 && trimmed[lastIndex - 1]?.kind === "source" && ASCII_BLANK.test(last.text);

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
 * Renders one line's pieces, escaping each text against the characters on
 * either side of it, and writing a shortcut reference collapsed where the
 * next character would join it to another construct.
 *
 * @param pieces - The line's pieces.
 * @param context - Where the line is written.
 * @param startsBlock - Whether nothing of the block has been written before
 *   this line, so it is where a link reference definition could start.
 * @param lean - What the lean rules know beyond the line, for a lean writing; `null` for every escape.
 * @param continuesAfter - The character the line follows, when it continues a line; `null` when it opens one.
 * @returns The line.
 */
function renderLine(
    pieces: LinePiece[], context: InlineContext, startsBlock: boolean, lean: LeanLine | null = null, continuesAfter: string | null = null,
): string {
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
        // A reference image's is the exception for a `{`, which attaches the
        // image's size group to it.
        const before = previous === undefined ? continuesAfter ?? "\n"
            : previous.kind === "reference" && !(previous.image === true && piece.text.startsWith("{")) ? "" : previous.text.slice(-1);
        const after = pieces[index + 1]?.text[0] ?? "\n";

        const leanText = lean === null ? null : { pairable: lean.pairable, grouped: lean.grouped[index] === true, drops: lean.drops };

        return escapeText(piece.text, before, after, context, leanText);
    }).join("");

    const opensLine = continuesAfter === null;

    return !context.singleLine && opensLine && pieces[0]?.kind === "text" ? escapeLineStart(rendered, lean) : rendered;
}

/** What the lean rules know beyond one line: read off the whole block by {@link leanBlock}. */
interface LeanLine {
    /** The delimiter characters the block holds two or more runs of, which may pair. */
    readonly pairable: ReadonlySet<string>;
    /** For each of the line's pieces, whether it stands inside a link's or styled span's brackets. */
    readonly grouped: readonly boolean[];
    /** Whether the line follows another line of the block. */
    readonly continuation: boolean;
    /** Whether the line opens a list item's text, right after the item's marker. */
    readonly afterMarker: boolean;
    /** Counts the escapes the lean rules leave out, over the whole block. */
    readonly drops: { count: number };
}

/** What the lean rules know beyond one text. */
interface LeanText {
    /** The delimiter characters the block holds two or more runs of, which may pair. */
    readonly pairable: ReadonlySet<string>;
    /** Whether the text stands inside a link's or styled span's brackets. */
    readonly grouped: boolean;
    /** Counts the escapes the lean rules leave out, over the whole block. */
    readonly drops: { count: number };
}

/**
 * Reads what the lean rules need off a block's assembled lines: the
 * delimiter characters it holds two or more runs of, which may pair, and,
 * for each piece, whether it stands inside a link's or styled span's
 * brackets, whose text keeps every escape. The pieces are joined with a
 * space, so a text run next to a delimiter counts as a run of its own.
 *
 * @param lines - The block's line pieces.
 * @returns The pairable characters, and each line's grouped flags.
 */
function leanBlock(lines: readonly LinePiece[][]): { pairable: ReadonlySet<string>; grouped: boolean[][] } {
    const text = lines.map((pieces) => pieces.map((piece) => piece.text).join(" ")).join("\n");
    const pairable = new Set(PAIRING_DELIMITERS.filter((char) => (text.match(DELIMITER_RUN[char]!) ?? []).length > 1));
    let depth = 0;

    const grouped = lines.map((pieces) => pieces.map((piece) => {
        depth = Math.max(0, depth + bracketDepthChange(piece));

        return depth > 0;
    }));

    return { pairable, grouped };
}

/**
 * How a piece changes the depth of link and styled span brackets: a group's
 * opening `[` opens one, and the syntax from its `]` on closes it.
 *
 * @param piece - The piece.
 * @returns `1`, `-1` or `0`.
 */
function bracketDepthChange(piece: LinePiece): number {
    if (piece.kind !== "syntax") {
        return 0;
    }

    if (piece.text === "[") {
        return 1;
    }

    return piece.text.startsWith("]") ? -1 : 0;
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
    const readsByLine = context.inListItem === true || context.inItemParagraph === true;
    const endsItem = readsByLine && !firstLine && opensHtmlBlockInItem(line);

    if (tokens.length === 1 && tokens[0]!.type === "paragraph" && !endsItem) {
        return line;
    }

    // Escaped, the run is text, whose indent the next load drops; dropping it here keeps the save stable.
    return firstLine ? line.replace("<", "\\<") : "\\" + line.trimStart();
}

/**
 * Tells whether a line under a list item's first line starts an HTML block
 * there: one of the item's own blocks is HTML. Inline HTML opening the line
 * is not — it stays in the item's text.
 *
 * @param line - The rendered line.
 * @returns `true` when the line ends the item's text as an HTML block.
 */
function opensHtmlBlockInItem(line: string): boolean {
    const list = lexMarkdown(`- ${PARAGRAPH_PROBE_LINE}\n  ${line}`).find((token) => token.type === "list") as Tokens.List | undefined;

    return list?.items[0]?.tokens.some((token) => token.type === "html") === true;
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
 * @param lean - What the lean rules know beyond the text, for a lean writing; `null` for every escape.
 * @returns The escaped text.
 */
function escapeText(text: string, before: string, after: string, context: InlineContext, lean: LeanText | null = null): string {
    const entities = noBreakSpaceEntities(text, before, after, context);
    const written = text.split("").map((char, index) => (entities[index] === true ? "&" : char)).join("");
    let escaped = "";

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!;

        if (entities[index] === true) {
            escaped += "&nbsp;";
            continue;
        }

        // The neighbours are read as written, so a `\` before a no-break space written `&nbsp;` sees the `&`.
        const site: EscapeSite = {
            text: written, index, context, before, after,
            previous: index > 0 ? written[index - 1]! : before,
            next:     index < text.length - 1 ? written[index + 1]! : after,
        };

        const full = needsEscape(char, site);
        const dropped = full && lean !== null && !leanKeepsEscape(char, site, lean);

        if (dropped) {
            lean.drops.count += 1;
        }

        escaped += full && !dropped ? "\\" + char : char;
    }

    return escaped;
}

/**
 * Tells which no-break spaces of a text are written as the entity `&nbsp;`,
 * so the escape rules can read what is written (a `\` before the entity is a
 * `\` before `&`) and not the character.
 *
 * A no-break space is written as the entity where `marked` would trim it: at
 * the edge of a heading's, a table cell's or a list item's line, and in a
 * line holding nothing else, which `marked` takes for a blank line. Elsewhere
 * it is written as itself, since `marked` keeps it at a paragraph's line
 * edge. Markdown joined into a raw or code block ({@link InlineContext.joinsIntoRawBlock})
 * holds no line edge of its own, so it writes the character.
 *
 * @param text - The text.
 * @param before - The output character before it (`\n` at a line start).
 * @param after - The output character after it (`\n` at a line end).
 * @param context - Where it is written.
 * @returns For each character, whether it is a no-break space written as the entity.
 */
function noBreakSpaceEntities(text: string, before: string, after: string, context: InlineContext): boolean[] {
    const edgeTrimmed = context.singleLine || context.inTableCell || context.inListItem === true || context.inItemParagraph === true || context.trimsLineEdges === true;
    const trimsEdges = context.joinsIntoRawBlock !== true && edgeTrimmed;
    const alone = context.joinsIntoRawBlock !== true && before === "\n" && after === "\n" && text.trim() === "";
    const lastIndex = text.length - 1;

    return text.split("").map((char, index) => {
        const atEdge = (index === 0 && before === "\n") || (index === lastIndex && after === "\n");

        return char === NO_BREAK_SPACE && ((trimsEdges && atEdge) || alone);
    });
}

/** One character's surroundings, as {@link needsEscape} reads them. */
interface EscapeSite {
    readonly text:     string;
    readonly index:    number;
    readonly previous: string;
    readonly next:     string;
    /** The output character before the whole text (`\n` at a line start). */
    readonly before:   string;
    /** The output character after the whole text (`\n` at a line end). */
    readonly after:    string;
    readonly context:  InlineContext;
}

/**
 * Tells whether a lean writing keeps an escape {@link needsEscape} asks for.
 * Text inside a link's or styled span's brackets keeps every escape. Outside
 * them a delimiter character follows {@link delimiterKeepsEscape}; every
 * other character keeps its escape, a `]` included: `marked` masks every
 * `[label]` stretch a definition names before it pairs emphasis, from any
 * `[` of the block (in a code span, inline HTML or kept source too), and a
 * definition may come after the block is written.
 *
 * @param char - The character.
 * @param site - Its surroundings.
 * @param lean - What the lean rules know beyond the text.
 * @returns `false` where the character cannot start anything where it stands.
 */
function leanKeepsEscape(char: string, site: EscapeSite, lean: LeanText): boolean {
    if (lean.grouped) {
        return true;
    }

    const delimiter = PAIRING_DELIMITERS.includes(char);

    return delimiter ? delimiterKeepsEscape(char, site, lean.pairable) : true;
}

/**
 * Tells whether a lean writing keeps the escape of a delimiter character
 * (`*`, `_`, `~`, `` ` ``, `+`). Its run keeps it when it touches another
 * delimiter character, whose run it would join or change the flanking of;
 * otherwise it needs none when the block holds no other run of it, which it
 * could pair with, nor — for `*`, `_` and `~` — when whitespace stands on
 * both sides of it, so it can neither open nor close.
 *
 * @param char - The character.
 * @param site - Its surroundings.
 * @param pairable - The delimiter characters the block holds two or more runs of.
 * @returns `true` when the escape is kept.
 */
function delimiterKeepsEscape(char: string, site: EscapeSite, pairable: ReadonlySet<string>): boolean {
    const { start, end } = runEdges(site.text, site.index);
    const before = start > 0 ? site.text[start - 1]! : site.before;
    const after = end < site.text.length ? site.text[end]! : site.after;
    const touchesDelimiter = DELIMITER_CHARACTERS.includes(before) || DELIMITER_CHARACTERS.includes(after);

    if (touchesDelimiter) {
        return true;
    }

    const canPair = pairable.has(char);

    if (!canPair) {
        return false;
    }

    if (char === "`" || char === "+") {
        return true;
    }

    const spaced = WHITESPACE.test(before) && WHITESPACE.test(after);

    return !spaced;
}

/**
 * The edges of the run of one character that a position of a text stands in.
 *
 * @param text - The text.
 * @param index - The position.
 * @returns The run's first index, and the index after its last.
 */
function runEdges(text: string, index: number): { start: number; end: number } {
    let start = index;
    let end = index + 1;

    while (start > 0 && text[start - 1] === text[index]) {
        start -= 1;
    }

    while (end < text.length && text[end] === text[index]) {
        end += 1;
    }

    return { start, end };
}

/**
 * Tells whether a character must be escaped where it stands: an emphasis,
 * code or bracket character always; a `\` before punctuation or at a run's
 * end; a `_` that is not intraword; a tag-shaped `<`; a `+` next to a `+`
 * (underline); a `|` in a table cell; the `:` of a bare URL scheme, the `.`
 * of `www.` and the `@` of an email address (GFM autolinks); an `&` that
 * starts a character reference (`&copy;`, `&#35;`); a `!` just before a link (an image); and a
 * `(` or `{` after a `]` or an image's `)`
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
        case "&":  return startsWithCharacterReference(site.text.slice(site.index));
        case "!":  return isLast && site.next === "[";
        case "(":  return site.previous === "]";
        case "{":  return site.previous === "]" || (site.index === 0 && site.previous === ")");
        default:   return false;
    }
}

/**
 * Escapes the block starter a line opens with: one of the block-start
 * characters, or the `.` / `)` of an ordered-list number — for a lean
 * writing, only where {@link leanLineStartEscaped} says the line would open
 * a block.
 *
 * @param line - The rendered line, its text already escaped.
 * @param lean - What the lean rules know beyond the line, for a lean writing; `null` for every escape.
 * @returns The line, safe at a line start.
 */
export function escapeLineStart(line: string, lean: LeanLine | null = null): string {
    const number = ORDERED_LIST_MARKER.exec(line);
    const full = LINE_START_ESCAPED.has(line[0] ?? "") || number !== null;
    const escapes = lean === null ? full : leanLineStartEscaped(line, lean.continuation, lean.afterMarker);

    if (lean !== null && full && !escapes) {
        lean.drops.count += 1;
    }

    if (!escapes) {
        return line;
    }

    return number === null ? "\\" + line : number[1] + "\\" + line.slice(number[1]!.length);
}

/**
 * Tells whether a lean writing escapes a line's first character: only where
 * the line, written as it is, would open a block — an ATX heading, a quote,
 * a list item, a thematic break, a code fence, and, under another line of
 * the block, a setext underline or a table delimiter row — or is a `:::`
 * fence or `|||` separator line, which a column the writer does not see
 * would read.
 *
 * @param line - The rendered line, its text already escaped.
 * @param continuation - Whether the line follows another line of the block.
 * @param afterMarker - Whether the line opens a list item's text, where the item's marker and the line may form a thematic break.
 * @returns `true` when its first character is escaped.
 */
function leanLineStartEscaped(line: string, continuation: boolean, afterMarker: boolean): boolean {
    const underLine = continuation && (SETEXT_UNDERLINE.test(line) || TABLE_DELIMITER_ROW.test(line));
    const breaksAfterMarker = afterMarker && (THEMATIC_BREAK.test(`- ${line}`) || THEMATIC_BREAK.test(`* ${line}`));

    switch (line[0]) {
        case "#": return ATX_HEADING_START.test(line);
        case ">": return true;
        case "-": case "+": case "*": case "_": case "=":
            return BULLET_MARKER_START.test(line) || THEMATIC_BREAK.test(line) || underLine || breaksAfterMarker;
        case "|": return COLUMN_SEPARATOR_LINE.test(line) || underLine;
        case ":": return COLUMN_FENCE_LINE.test(line) || underLine;
        case "`": case "~": return CODE_FENCE_START.test(line);
        default:  return ORDERED_MARKER_START.test(line);
    }
}
