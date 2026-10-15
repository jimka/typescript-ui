---
depends-on: [markdown-editor-heading-to-code-escapes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-reference-links.test.ts
  - packages/lib/tests/component/markdown-source-preservation.test.ts
  - packages/lib/tests/component/markdown-editor-list-item-edits.test.ts
  - packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts
  - packages/lib/tests/component/markdown-editor-columns.test.ts
  - packages/lib/tests/component/markdown-editor-command-crashes.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Minimal Escapes — Implementation Plan

## Overview

`MarkdownEditor`'s WYSIWYG surface saves through the library's own serializer ([markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)). The serializer escapes some characters wherever they stand, and some at every line start, whether or not they would start anything there. A save is therefore full of backslashes the text does not need: `\--- tail`, `\===`, `\| a |`, `\: x`, `\*\*\*`, `\_\_\_`, `\[a\]`. They are harmless on reload, but noisy in the saved Markdown. Source mode writes none of them, because it keeps the author's bytes.

This plan makes the save write a backslash only where the text would otherwise read differently in the viewer, under the library's own `marked` setup and dialect (GFM tables and task items, `:::` columns, reference links). Each block is first written with *lean escapes*: a set of context rules leave out every escape the character does not need where it stands (`--- tail`, `===`, `| a |`, `\[a]`). The lean writing is then read with the viewer's lexer and kept only when it reads exactly as the writing with every escape does. Otherwise the block is written as today.

Measured on the round-trip corpus, the standard-form saves hold 67 escapes instead of 119. Over a seeded fuzz of 6,000 documents the count drops by 43 %, and by 52 % over 1,500 documents of plain text. No save in the corpus or the fuzz reads differently in the viewer, and no document that reloads as shown today reloads differently. The change is in `markdownSerializer.ts`, plus one call site in [MarkdownEditor.ts:2772](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2772). Line numbers are from `f984cf5e7`, the tip of the Markdown stack (`marked-version-pin-or-upgrade`, `marked` 18.0.10). The stack was restacked to `ef607a8e6` while this plan was drafted; every Markdown source and test file is identical there.

---

## Architecture Decisions

### A lean writing is kept only where it reads exactly as the full writing

`serializeInlineNodes` ([markdownSerializer.ts:2925](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2925)) chooses a block's writing as today. A new function, `leanOrFull`, then assembles that same writing twice: with lean escapes, and with every escape (the *full* writing, today's output). The lean writing is kept when `marked`, through the viewer's own reading code (`markdownReading`, [:4901](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4901)), reads both the same: every character, whitespace, mark, link, style and break. Otherwise the full writing is kept. A block whose lean writing leaves out no escape skips the check.[^check]

This mirrors two choices the serializer already makes. `bareAutolinks` ([:3042](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L3042)) writes an autolink bare only where the bare form still reads back. The `looseTildes` writing ([:360](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L360)) leaves out the escape of a lone `~` and is used only after a read-back.

### The lean rules

The lean rules only ever take an escape away: a character the full writing leaves bare stays bare.

**In text outside a link's or styled span's brackets:**

| Character | Lean rule | Full writing | Lean writing |
|---|---|---|---|
| `]` | never escaped: text escapes its every `[`, so no text `]` closes anything | `\[a\]` | `\[a]` |
| `(` `{` after a `]` of the same text | not escaped: that `]` closes nothing | `\[a\]\(b)` | `\[a](b)` |
| `*` `_` `~` | escaped only when the block holds two or more runs of the character, and the run does not have whitespace on both sides | `2\*3`, `a \* b`, `\~5 km` | `2*3`, `a * b`, `~5 km` |
| `` ` `` `+` | escaped only when the block holds two or more runs of the character (of `+`, runs of two or more) | ``a\`b``, `a \+\+ b` | ``a`b``, `a ++ b` |
| any delimiter character whose run touches another delimiter character | escaped as today: it would join that run or change how it flanks | `**a**\*`, `*a*\~b` | the same |
| every other character | escaped as today | `\<b>`, `https\://`, `www\.e.com`, `a\@b.co` | the same |

Text inside a link's or styled span's brackets keeps every escape.[^grouped]

**At a line's start** (paragraphs, quotes and list items; a heading and a table cell have no line starts):

| The line, written bare, would be | Lean writing escapes its first character | Example (full → lean) |
|---|---|---|
| an ATX heading: one to six `#`, then whitespace or the end | yes | `\# x` → `\# x`; `\#tag` → `#tag` |
| a quote (`>`) | yes | `\> x` → `\> x` |
| a bullet item: `-` `+` `*`, then whitespace or the end | yes | `\- x` → `\- x`; `\-x` → `-x`; `\+1` → `+1` |
| an ordered item: digits, `.` or `)`, then whitespace or the end | yes (as `1\.`) | `1\. x` → `1\. x`; `1\.5 l` → `1.5 l` |
| a thematic break (`---`, `***`, `___`, `_ _ _`) | yes | `\---` → `\---`; `\*\*\*` → `\***` |
| a code fence (three backticks or tildes) | yes | `` \`\`\` `` → `` \``` ``; `\~\~\~` → `\~~~` |
| a `:::` fence line or a `\|\|\|` separator | yes | `\:::` → `\:::`; a `\|\|\|` line keeps its backslash |
| under another line of the block: a setext underline or a table delimiter row | yes | `a⏎\===` → `a⏎\===`; `a⏎\:-:` → `a⏎\:-:` |
| anything else | no | `\--- tail` → `--- tail`; `\===` → `===`; `\: x` → `: x`; a line `\| a \| b \|` loses its backslash |

The "first line" of a block is its first written line. A list item's first line follows its marker, so `- \# x`, `- \- x` and `- \[ ] mid` keep their escapes there.

### Escapes kept on purpose

These escapes cannot be decided from where the character stands, so the lean rules keep them:

| Kept escape | Why the character's own context cannot decide it |
|---|---|
| every `[` of text | Whether `[a]` is a link depends on the document's link reference definitions, which another block can add later without this block being written again. Keeping the `[` escaped is also what `registerDefinitionRules` ([markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)), `$documentDefinitions` ([:777](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L777)) and `markdown-editor-large-document-costs` rest on: text never becomes a link.[^bracket] |
| a delimiter character (`*` `_` `~` `` ` `` `+`) the block holds another run of, in a run that can open or close | Whether two runs pair is decided by `marked`'s emphasis pairing over the whole block, including runs inside other constructs. |
| any escape in a link's or styled span's text | `marked` scans link text for brackets and backticks before it reads it, and unescapes its brackets once. A lone backtick in link text unescaped ends the link. |
| a `:::` or `\|\|\|` line start | It closes or splits a `:::` column, which the writer of a paragraph does not see. A `::: x` line opens a fence wherever a closing `:::` line follows later, even in another block. |
| an ordered marker on any line (`2\. x` under `a`) | A `2.` cannot interrupt a paragraph in CommonMark, but the check reads a block alone, not inside its list item, where `marked` reads the item's content line by line (see `InlineContext.inListItem`). Keeping the escape costs one backslash in a rare line. |
| every escape in a setext heading's lines | The underline `---` after the last line is Markdown the check does not read: `\|` written bare over `---` is a table.[^setext] |
| every escape in Markdown that joins other Markdown | See the next decision. |
| `<`, `\`, a pipe in a table cell, the `:` `.` `@` of autolinks, `!` before a link, `&` | These rules are already exact, or their context (a `>` later in the block, HTML block starts) is not local. |

### Markdown joined into other Markdown keeps every escape

Two places write a block's Markdown into the middle of other Markdown: `$inlineMarkdown` ([MarkdownEditor.ts:2900](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2900)), through `$serializeInlineNodes`, and the Backspace/Delete join of a paragraph into a raw block or code block ([MarkdownEditor.ts:2772](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2772)). The joined text lands next to text the lean rules and the check never see: a bare `*` there pairs with a `*` of the raw block. A new `InlineContext` field, `joinsMarkdown`, tells the writer to keep every escape. `$serializeInlineNodes` sets it, and the join calls `$serializeInlineNodes(paragraph.getChildren())` instead of `$serializeBlock(paragraph)`. The two write the same Markdown for a paragraph, except that `$serializeBlock` now writes lean escapes.[^join]

A code block made from a paragraph (`$copyBlockAsCodeSource`, through `markdown-editor-heading-to-code-escapes`' `$serializeBlockContent`) holds the paragraph's own lean Markdown. That plan's rule is "the block's own Markdown", which a save now writes leaner.

### The check's answers are remembered

`leanReadsAsFull` keeps its answers in a module-level `Map`, `LEAN_READS`, keyed by the block kind, the definitions and the two writings. The map is cleared when it holds `LEAN_READING_CACHE_SIZE` (8,192) entries. This follows `rawBlockEnd`'s `RUNS_ON` cache ([:72](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L72), [:2243](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2243)). The editor saves the whole document after every update, so without the map every block that leaves out an escape would be lexed twice on every keystroke.[^cost]

### Correctness is round-trip equality, measured three ways

A save is correct when the document it reloads to holds what the editor held, and when the viewer reads it as it read today's save. The plan checks this with:

1. the round-trip harness's corpus (`canonical` and `canonicalIdempotence` checks, unchanged);
2. a new seeded fuzz, `markdown-escape-fuzz.test.ts`, of plain text full of Markdown punctuation in every block the editor writes text in;
3. a one-off before/after count of escapes, run by hand (see `## Verification`).[^measured]

The fuzz uses plain text only: with marks, links and styles, today's serializer already fails to round-trip about 5 % of random documents, for reasons unrelated to escaping. The prototype's runs with marks and links are recorded in *Addendum: Measurements*.

### Source mode is not changed; the overlap with command-gaps

Source mode keeps the author's bytes and has its own escaping (`escapeBlockStart`, [markdownSourceLines.ts:950](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L950)). This plan does not touch it. The viewer is not touched either.

`markdown-source-mode-command-gaps` (not yet implemented) writes a new item's task form as `\[ \] mid` in source mode, because the WYSIWYG save wrote it that way (its decision G7). After this plan the WYSIWYG save writes `\[ ] mid`. The two still read alike, so no parity row breaks, but the bytes differ again. Whichever of the two plans lands second makes source mode write `\[ ] mid` too (its `escapeItemText` escapes only the `[`), and moves its pinned rows to that form.[^g7] This needs the owner's sign-off.

The follow-up plan for the link reference definition label (`[a]: /url` as new item text: source mode `- \[a]: /url`, WYSIWYG `- \[a\]: /url`) overlaps this one. This design settles its escape difference: the WYSIWYG save now writes `- \[a]: /url` as well. Whatever difference that plan finds in which items a toggle makes is left to it.

---

## Internal Structure

All code is in `markdownSerializer.ts` unless noted. It was run in a private copy of `f984cf5e7`, with the full test suite.

### New `InlineContext` fields

Insert after `readsWhitespace` ([:388](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L388)):

```ts
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
```

### New constants

Insert after `LINE_START_ESCAPED` ([:268](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L268)):

```ts
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
```

Insert after `READING_KEY_SEPARATOR` ([:327](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L327)):

```ts
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

/** Each definitions map's part of a {@link LEAN_READS} key: a save hands every block the same map, so its JSON is made once. */
const DEFINITIONS_KEYS = new WeakMap<Links, string>();
```

### `serializeInlineNodes` and the check

In `serializeInlineNodes` ([:2925](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2925)), every `return` goes through `leanOrFull`, and the `first` variable goes. `first` was always `assembleLines(written, context)`: the first writing tried is `context` with the first policy, whose pieces are `written`. The two conditions that called a function inside an `if` take their value from a `const` first, as the project's rule asks. From the line `const segments = …` on, the body becomes:

```ts
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
```

Add directly after `serializeInlineNodes`:

```ts
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
    const alike = leanReadsAsFull(lean, full, context);

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
    const key = [kind, definitionsKey(context.definitions), full, lean].join(READING_KEY_SEPARATOR);
    const known = LEAN_READS.get(key);

    if (known !== undefined) {
        return known;
    }

    const reading: InlineContext = { ...context, readsWhitespace: true };
    const fullReading = markdownReading(full, reading);
    const alike = fullReading !== null && JSON.stringify(markdownReading(lean, reading)) === JSON.stringify(fullReading);

    if (LEAN_READS.size >= LEAN_READING_CACHE_SIZE) {
        LEAN_READS.clear();
    }

    LEAN_READS.set(key, alike);

    return alike;
}

/**
 * A definitions map's part of a {@link LEAN_READS} key: its JSON, made once
 * per map.
 *
 * @param definitions - The definitions, or `null`.
 * @returns The key part; `""` for none.
 */
function definitionsKey(definitions: Links | null): string {
    if (definitions === null) {
        return "";
    }

    const known = DEFINITIONS_KEYS.get(definitions);

    if (known !== undefined) {
        return known;
    }

    const key = JSON.stringify(definitions);

    DEFINITIONS_KEYS.set(definitions, key);

    return key;
}
```

Also update the doc comment of `serializeInlineNodes` ([:2906](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2906)): append the sentence "The chosen writing is then written with lean escapes where that reads as the writing with every escape ({@link leanOrFull})."

### `assembleLines`, `renderLine`, `escapeText`, `escapeLineStart`

`assembleLines` ([:5134](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5134)) takes a fourth parameter, `drops: { count: number } = { count: 0 }`, documented as `@param drops - Counts the escapes a lean writing ({@link InlineContext.lean}) leaves out.` After the `strayTaskMarkersAsText` loop, its line rendering becomes:

```ts
    const block = context.lean === true ? leanBlock(lineContents) : null;

    return lines.map((line, index) => {
        const lean = block === null ? null : { pairable: block.pairable, grouped: block.grouped[index]!, continuation: index > 0, drops };
        const content = escapeHtmlBlockStart(renderLine(lineContents[index]!, context, !written, lean), lineContents[index]!, index === 0, context);
```

The rest of the map callback is unchanged.

`renderLine` ([:5522](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5522)) takes `lean: LeanLine | null = null` (documented `@param lean - What the lean rules know beyond the line, for a lean writing; \`null\` for every escape.`). Its text branch and its last line become:

```ts
        const leanText = lean === null ? null : { pairable: lean.pairable, grouped: lean.grouped[index] === true, drops: lean.drops };

        return escapeText(piece.text, before, after, context, leanText);
    }).join("");

    return !context.singleLine && pieces[0]?.kind === "text" ? escapeLineStart(rendered, lean) : rendered;
}
```

Add after `renderLine`:

```ts
/** What the lean rules know beyond one line: read off the whole block by {@link leanBlock}. */
interface LeanLine {
    /** The delimiter characters the block holds two or more runs of, which may pair. */
    readonly pairable: ReadonlySet<string>;
    /** For each of the line's pieces, whether it stands inside a link's or styled span's brackets. */
    readonly grouped: readonly boolean[];
    /** Whether the line follows another line of the block. */
    readonly continuation: boolean;
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
```

`writeBracketed` ([:4194](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L4194)) pushes a group's opening as the syntax piece `[` and its closing as one syntax piece starting with `]`; no other syntax piece is exactly `[` or starts with `]` outside a group.[^depth]

`escapeText` ([:5646](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5646)) takes `lean: LeanText | null = null` (documented like `renderLine`'s), and `EscapeSite` ([:5665](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5665)) gains the text's own neighbours:

```ts
function escapeText(text: string, before: string, after: string, context: InlineContext, lean: LeanText | null = null): string {
    let escaped = "";

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index]!;

        const site: EscapeSite = {
            text, index, context, before, after,
            previous: index > 0 ? text[index - 1]! : before,
            next:     index < text.length - 1 ? text[index + 1]! : after,
        };

        const full = needsEscape(char, site);
        const dropped = full && lean !== null && !leanKeepsEscape(char, site, lean);

        if (dropped) {
            lean!.drops.count += 1;
        }

        escaped += full && !dropped ? "\\" + char : char;
    }

    return escaped;
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
```

Add after `EscapeSite`:

```ts
/**
 * Tells whether a lean writing keeps an escape {@link needsEscape} asks for.
 * Text inside a link's or styled span's brackets keeps every escape. Outside
 * them a `]` closes nothing, since text escapes its every `[`, so a `(` or
 * `{` after a `]` of the same text opens nothing; a delimiter character
 * follows {@link delimiterKeepsEscape}; every other character keeps its
 * escape.
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

    if (char === "]") {
        return false;
    }

    if (char === "(" || char === "{") {
        return site.index === 0;
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
```

`leanKeepsEscape` is asked only where `needsEscape` already escapes. A `(` or `{` is escaped there only after a `]` (or, for `{`, at the text's start after an image's `)`), so `site.index === 0` keeps exactly the escapes whose `]` or `)` belongs to another piece.

Replace `escapeLineStart` ([:5715–5730](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5715)), doc comment included, and add `leanLineStartEscaped` after it:

```ts
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
function escapeLineStart(line: string, lean: LeanLine | null = null): string {
    const number = ORDERED_LIST_MARKER.exec(line);
    const full = LINE_START_ESCAPED.has(line[0] ?? "") || number !== null;
    const escapes = lean === null ? full : leanLineStartEscaped(line, lean.continuation);

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
 * @returns `true` when its first character is escaped.
 */
function leanLineStartEscaped(line: string, continuation: boolean): boolean {
    const underLine = continuation && (SETEXT_UNDERLINE.test(line) || TABLE_DELIMITER_ROW.test(line));

    switch (line[0]) {
        case "#": return ATX_HEADING_START.test(line);
        case ">": return true;
        case "-": case "+": case "*": case "_": case "=":
            return BULLET_MARKER_START.test(line) || THEMATIC_BREAK.test(line) || underLine;
        case "|": return COLUMN_SEPARATOR_LINE.test(line) || underLine;
        case ":": return COLUMN_FENCE_LINE.test(line) || underLine;
        case "`": case "~": return CODE_FENCE_START.test(line);
        default:  return ORDERED_MARKER_START.test(line);
    }
}
```

When the in-text rules already escaped a line's first character, the line starts with `\` and no line-start escape is added, as today.

### Setext headings and joined Markdown

In the setext branch of `serializeHeading` ([:2293](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2293); `writtenHeadingContent` once `markdown-editor-heading-to-code-escapes` has landed), the content is written with `joinsMarkdown`:

```ts
        // The underline is Markdown the lean rules do not see: `|` over `---` is a table.
        const lines = serializeInline(node, { ...MULTI_LINE, definitions, joinsMarkdown: true });
```

`$serializeInlineNodes` ([:913](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L913)) adds `joinsMarkdown: true` to the context it passes. Its doc comment gains: "Every escape is written: the Markdown joins text already there."

In `MarkdownEditor.ts`, line 2772 becomes `const added = $textOnlyChildren($serializeInlineNodes(paragraph.getChildren()));`. `$serializeBlock` then has no use left in `MarkdownEditor.ts`; remove it from the import on line 65.

---

## Ordered Implementation Steps

1. **Read the base.** Confirm `markdown-editor-heading-to-code-escapes` is in `plans/implemented/`. Check whether `markdown-source-mode-command-gaps`, `marked-upgrade` and `markdown-named-character-references` have landed: `ls plans/implemented/ | grep -E 'command-gaps|marked-upgrade|named-character'`. Note the result; steps 9 and 10 depend on it. Re-find every line number below by symbol name: plans that landed since `f984cf5e7` move them.
2. **Write the new tests first** (`## Expected Behaviour`, rows L1–L40 and J1–J19) as a new `describe('$serializeMarkdown — lean escapes', …)` at the end of `packages/lib/tests/component/markdown-serializer.test.ts`. Use the file's own helpers: `serialize`, `p`, `fill`, `text`, `list`, `table`, `cell`, `viewerModel`, `editorSurfaceModel`; build headings with `$createHeadingNode`, quotes with `$createQuoteNode`, columns with `$createMarkdownBlockNode`/`$createMarkdownColumnNode`, and a line break inside text with `br()`. Each row asserts the output string and that `viewerModel(output).blocks` equals `editorSurfaceModel` of the serialized editor. Add rows R15 and R16 to `markdown-editor-command-crashes.test.ts` the same way. Run `npx vitest run tests/component/markdown-serializer.test.ts tests/component/markdown-editor-command-crashes.test.ts` from `packages/lib`: the L and J rows whose "after" differs from "before" fail; R15 and R16 pass already (they pin that joined Markdown keeps today's escapes).
3. **Create `packages/lib/tests/component/markdown-roundtrip/markdown-escape-fuzz.test.ts`** as given in *Addendum: The fuzz test*. Run it: it passes before the change too (every escape kept is correct), which is expected; it guards the change.
4. **Add the `InlineContext` fields and the constants** (`## Internal Structure`). `npm run typecheck` from `packages/lib`: clean.
5. **Add `leanOrFull`, `leanReadsAsFull`, `definitionsKey`, and route `serializeInlineNodes`' returns through `leanOrFull`.** Check: `grep -n "first" packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts | grep -c "first ??="` gives `0`.
6. **Change `assembleLines`, `renderLine`, `escapeText`, `EscapeSite`, `escapeLineStart`; add `LeanLine`, `LeanText`, `leanBlock`, `bracketDepthChange`, `leanKeepsEscape`, `delimiterKeepsEscape`, `runEdges`, `leanLineStartEscaped`.** If `marked-upgrade` or `markdown-named-character-references` has landed, `needsEscape` holds an `&` case; leave it as it is (`leanKeepsEscape` keeps every `&` escape). `npm run typecheck`: clean.
7. **Setext and joined Markdown.** Add `joinsMarkdown: true` in the setext branch and in `$serializeInlineNodes`; change `MarkdownEditor.ts` line 2772 and its import. Check: `grep -n '\$serializeBlock\b' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives no match.
8. **Run the new tests.** Steps 2 and 3's tests pass.
9. **Re-pin the tests that pin today's escapes.** Run `npx vitest run tests/component/` from `packages/lib`. On `f984cf5e7` exactly the tests in *Addendum: Re-pinned tests* fail, each on a saved string that differs from its pinned value only by left-out backslashes. For each one, check that the old and the new value give the same `viewerModel(…).blocks`, then pin the new value. A failure not in the addendum, or one whose new value differs by anything but a missing backslash, is a defect: stop and report it. Rows that `markdown-editor-heading-to-code-escapes` added are listed there too.
10. **The task form in source mode** (only if `markdown-source-mode-command-gaps` has landed). Make `escapeItemText` escape only the `[` of a task form (`\[ ] mid`), and move that plan's pinned rows and docs clause from `\[ \]` to `\[ ]`; their viewer models must not change. If it has not landed, do nothing here: that plan does it when it lands (see *Source mode is not changed* above).
11. **Docs and changelog** (`## Documentation Impact`).
12. **Measure** (`## Verification`, the escape count), and record the numbers in the commit's notes.
13. **Full checks:** `npm run typecheck`, `npm run lint`, and the whole suite with `npx vitest run --maxWorkers=2` from `packages/lib`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-escape-fuzz.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-reference-links.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-preservation.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-list-item-edits.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-columns.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (step 10, only if landed) | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` and its tests |

---

## Expected Behaviour

All rows are unit-testable through `$serializeMarkdown` on a document the test builds (step 2). "Before" is today's save; every row's output must also read in the viewer as the editor shows the document. `⏎` is a line break inside the block (`br()`), written `\` and a newline.

**Paragraphs** (a paragraph holding the text):

| # | Text | Before | After |
|---|---|---|---|
| L1 | `--- tail` | `\--- tail` | `--- tail` |
| L2 | `---` | `\---` | `\---` |
| L3 | `a⏎--- tail` | `a\⏎\--- tail` | `a\⏎--- tail` |
| L4 | `a⏎---` | `a\⏎\---` | `a\⏎\---` |
| L5 | `--` | `\--` | `--` |
| L6 | `a⏎--` | `a\⏎\--` | `a\⏎\--` |
| L7 | `===` | `\===` | `===` |
| L8 | `a⏎===` | `a\⏎\===` | `a\⏎\===` |
| L9 | `#tag` | `\#tag` | `#tag` |
| L10 | `# x` | `\# x` | `\# x` |
| L11 | `####### foo` | `\####### foo` | `####### foo` |
| L12 | `- x` | `\- x` | `\- x` |
| L13 | `+1` | `\+1` | `+1` |
| L14 | `*x*` | `\*x\*` | `\*x\*` |
| L15 | `***` | `\*\*\*` | `\***` |
| L16 | `a * b` | `a \* b` | `a * b` |
| L17 | `a * b *c*` | `a \* b \*c\*` | `a * b \*c\*` |
| L18 | `2*3` | `2\*3` | `2*3` |
| L19 | `___` | `\_\_\_` | `\___` |
| L20 | `_ _ _` | `\_ \_ \_` | `\_ _ _` |
| L21 | `__init__` | `\_\_init\_\_` | `\_\_init\_\_` |
| L22 | `_x` | `\_x` | `_x` |
| L25 | `a \| b⏎--- \| ---` | `a \| b\⏎\--- \| ---` | `a \| b\⏎\--- \| ---` |
| L26 | `a⏎:-:` | `a\⏎\:-:` | `a\⏎\:-:` |
| L27 | `: x` | `\: x` | `: x` |
| L28 | `::: x` | `\::: x` | `\::: x` |
| L29 | `~5 km` | `\~5 km` | `~5 km` |
| L30 | `~a~` | `\~a\~` | `\~a\~` |
| L31 | `~~~` | `\~\~\~` | `\~~~` |
| L32 | ``a`b`` | ``a\`b`` | ``a`b`` |
| L33 | ```` ``` ```` | ``\`\`\` `` | ``\``` `` |
| L34 | `[a]` | `\[a\]` | `\[a]` |
| L35 | `[a](b)` | `\[a\]\(b)` | `\[a](b)` |
| L36 | `[a]: /url` | `\[a\]: /url` | `\[a]: /url` |
| L37 | `1.5 l` | `1\.5 l` | `1.5 l` |
| L38 | `a⏎2. x` | `a\⏎2\. x` | `a\⏎2\. x` |
| L39 | `a ++ b` | `a \+\+ b` | `a ++ b` |
| L40 | `a ++ b ++ c` | `a \+\+ b \+\+ c` | `a \+\+ b \+\+ c` |

Rows whose Markdown holds a backslash before a pipe, which a table cannot print:

- **L23** — text `| a | b |`: before `\| a | b |`, after `| a | b |`.
- **L24** — text `|||`: before `\|||`, after `\|||`.

**Other blocks and contexts:**

| # | Document | Before | After |
|---|---|---|---|
| J1 | list item text `[ ] mid` | `- \[ \] mid` | `- \[ ] mid` |
| J2 | list item text `[a]: /url` | `- \[a\]: /url` | `- \[a]: /url` |
| J3 | list item text `- x` | `- \- x` | `- \- x` |
| J4 | list item text `a⏎===` | `- a\⏎  \===` | `- a\⏎  \===` |
| J5 | heading `###` with text `***` | `### \*\*\*` | `### ***` |
| J6 | heading `###` with text `[a]` | `### \[a\]` | `### \[a]` |
| J7 | quote with text `--- tail` | `> \--- tail` | `> --- tail` |
| J9 | table cell ``a`b`` | cell ``a\`b`` | cell ``a`b`` |
| J10 | column fence, first column paragraph `:::` | `\:::` | `\:::` |
| J12 | column fence, first column paragraph `--- tail` | `\--- tail` | `--- tail` |
| J13 | link to `/u` with text ``x` `` | ``[x\`](/u)`` | ``[x\`](/u)`` |
| J14 | link to `/u` with text `[a]` | `[\\[a\\]](/u)` | `[\\[a\\]](/u)` |
| J15 | link `a` to `/u`, then text ` b] c` | `[a](/u) b\] c` | `[a](/u) b] c` |
| J16 | bold `a`, then text `*` | `**a**\*` | `**a**\*` |
| J17 | italic `a`, then text `~b` | `*a*\~b` | `*a*\~b` |
| J18 | text `x * `, then bold `b` | `x \* **b**` | `x * **b**` |

Rows whose Markdown holds a backslash before a pipe:

- **J8** — a one-column table (header `h`) whose body cell holds `a | b`: the cell is written `a \| b` before and after.
- **J11** — a column fence whose first column's paragraph is `|||`: written `\|||` before and after.
- **J19** — a level 2 heading with the lines `a` and `|` (a line break between): written `a\`, `\|`, `---` on three lines, before and after — a setext heading keeps every escape.

The values of L1–L40 and J1–J19 were measured on the prototype by a scratch test; each output read in the viewer as the editor showed the document, and reloaded to it.

**Joined Markdown** (needs a full editor: two new rows in `describe('a range from a block start into a later block\'s word is removed without throwing (R rows)')` of `markdown-editor-command-crashes.test.ts`, after `R14`, using its `load`, `selectText` and `DELETE_CHARACTER_COMMAND`):

| # | Document | Action | `getValue()` after |
|---|---|---|---|
| R15 | `'<div>\n\na * b'` | caret at offset 0 of the text node `'a * b'`, then `DELETE_CHARACTER_COMMAND` with `true` (Backspace) | `'<div>a \\* b'`: the joined paragraph keeps every escape |
| R16 | ``'```\ncode\n```\n\nefgh a * b **c** kl'`` | select from `['code', 0]` to `['efgh a * b ', 3]`, then `DELETE_CHARACTER_COMMAND` with `true` | ``'```\nh a \\* b **c** kl\n```'``: the rest joins as Markdown with every escape |

Both were measured on the prototype. With lean escapes in these two paths they would save `a * b`, which reads the same alone but can pair with a `*` of the raw block's own text.

**Unchanged behaviour:** an unedited document saves exactly as loaded (verbatim corpus check). Every corpus `canonical` check (viewer of the standard-form save equals viewer of the source) still holds. The new fuzz passes. Nothing to verify by hand: no rendering, focus or geometry changes.

---

## Verification

- `npm run typecheck`, `npm run lint` and `npm run test` from `packages/lib`, the suite with `--maxWorkers=2`. On `f984cf5e7` the prototype passed all 19,637 tests: the 19,636 existing ones after the re-pins of step 9, and the new fuzz.
- `grep -c "joinsMarkdown: true" packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives `2` (the setext branch and `$serializeInlineNodes`).
- **Escape count, before and after (by hand, not committed).** Add *Addendum: The escape count* as `tests/component/markdown-roundtrip/zz-escape-count.test.ts`, run it on the base commit and on the branch, compare, and delete the file. On `f984cf5e7` the corpus saves 119 escapes before and 67 after. Plans that land first add corpus cases, so the numbers may grow; the after count must stay below 60 % of the before count, and `]` must fall to almost none.
- `npm run docs:api` stays warning-free (no public symbol changes).

---

## Documentation Impact

No public API changes. Two docs change:

- [`packages/lib/docs/components/MarkdownEditor.md`](../packages/lib/docs/components/MarkdownEditor.md), table *Supported constructs*: add this last row, as written:

  ```markdown
  | Markdown punctuation in text | a backslash only where the character would otherwise start something there: `\- x`, `\# x`, `\[label]`, `\*x\*`; `--- tail`, `#tag`, `a * b` and `===` stay bare |
  ```

  The sentence "a `[label]` you type … is saved escaped" ([line 78](../packages/lib/docs/components/MarkdownEditor.md#L78)) stays true: its `[` is escaped.
- [`packages/lib/docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md), `## Changed` → `### Components`, a new bullet:
  "**`MarkdownEditor` saves fewer backslashes.** An edited block's Markdown escapes a character only where it would otherwise read as something else: `--- tail`, `===`, `#tag`, `| a |` and `a * b` save bare, and `[a]` saves as `\[a]`. What the viewer shows for a save does not change. No consumer action is needed."

---

## Potential Challenges

- **Re-pinned tests hide a defect.** Step 9 re-pins only values that differ by left-out backslashes and read the same in the viewer; anything else stops the work.
- **Conflicts with queued plans.** `marked-upgrade` and `markdown-named-character-references` add an `&` case to `needsEscape`; `markdown-editor-large-document-costs` rewrites the context `$serializeInlineNodes` passes (its definitions). Each is a textual merge: keep both changes.
- **A rule leaves out a needed escape.** The check in `leanOrFull` then keeps the full writing, so a save never reads differently. Where the check cannot see (Markdown around a block), only a fuzz finds it; a prototype fuzz run found the setext case that way.[^setext]
- **Cost on large documents.** With the remembered answers the measured cost is within noise on the library's own docs and +11 % per save on 1,000 prose paragraphs that all drop escapes. Without them it was +40 %.[^cost]

---

## Critical Files

- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `serializeInlineNodes` (:2925), `bareAutolinks` (:3042, the precedent for keeping a writing only where it reads back), `InlineContext.looseTildes` (:360), `markdownReading` (:4901) and `readBackTokens` (:4921), `assembleLines` (:5134), `renderLine` (:5522), `escapeHtmlBlockStart` (:5565, a line-start escape decided by lexing), `escapeText` (:5646), `needsEscape` (:5687), `escapeLineStart` (:5721), `RUNS_ON_CACHE_SIZE`/`RUNS_ON` (:72, :85, used at :2243, the precedent for the bounded cache), `serializeHeading` (:2289), `$serializeInlineNodes` (:913), `writeBracketed` (:4194).
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$joinIntoTextOnlyBlock` (:2753, the join at :2772), `$inlineMarkdown` (:2900), `$copyBlockAsCodeSource` (:372).
- [markdown-roundtrip/harness.ts](../packages/lib/tests/component/markdown-roundtrip/harness.ts) (`canonicalSave`) and [markdown-edit-fuzz.test.ts](../packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts) (`randomStream`, the seeded stream the new fuzz copies).
- [markdown-serializer.test.ts](../packages/lib/tests/component/markdown-serializer.test.ts) `$serializeMarkdown — escaping` (:524) and the line-start loop (:608).
- `plans/markdown-editor-heading-to-code-escapes.md` (its rows H17, H20–H22) and `plans/markdown-source-mode-command-gaps.md` (G7).

---

## Non-Goals

- **Source mode's escapes.** Source mode keeps the author's bytes; only the task form of step 10 follows the WYSIWYG save, and only where `markdown-source-mode-command-gaps` has landed.
- **Leaner escapes in joined Markdown and setext headings.** They keep every escape; see the decisions above.
- **Unescaping `[` where no `]` follows.** It would save a rare escape and give up the rule that text never becomes a link.
- **Escapes inside link and span text.** Their bracket handling (`protectLabelBrackets`, `unescapeCodeSpanBrackets`) is unchanged.
- **Today's lossy writings.** Documents whose save already reads otherwise (about 5 % of random documents with marks and links) are not fixed here; they keep exactly today's reading.
- **The link reference definition label plan.** Only its escape half is settled here.

---

## Addendum: The fuzz test

`packages/lib/tests/component/markdown-roundtrip/markdown-escape-fuzz.test.ts`, as run in the prototype (about 1.3 s; 300 documents):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createTableCellNode, $createTableNode, $createTableRowNode, TableCellHeaderStates } from '@lexical/table';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $createMarkdownBlockNode, $createMarkdownColumnNode } from '~/component/editor/markdownBlockNode';
import { $createMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { canonicalSave } from './harness';
import { editorSurfaceModel } from './viewModel';

// A deterministic fuzz of plain text full of Markdown punctuation, in every
// block the editor writes text in: the standard-form save of each document
// must load back to what the editor showed, and save again to itself. The
// save escapes a character only where it would otherwise read as something
// else, so a rule that leaves out a needed escape shows here as a document
// that reloads differently.

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** The fixed seed of the document stream; changing it explores other documents. */
const FUZZ_SEED = 0xe5c;

/** Documents per run: about a second of the suite, and enough to reach every line start in every block kind. */
const DOCUMENTS = 300;

/** The ASCII punctuation a word is drawn from: every character a backslash escapes in CommonMark that text holds. */
const PUNCTUATION = '*_~`[]()!<>#-+=|:.{}\\&@/\'"$%^?,;';

/** Line starts and words that open, or nearly open, a construct. */
const OPENERS = [
    '---', '===', '- ', '* ', '+ ', '1. ', '2) ', '# ', '###### x', '#tag', '> ', '|||', ':::', ':::x', '```', '~~~', '***', '___',
    '_ _ _', '| a |', '--- | ---', '|-|', ':-:', '[a]: /u', '[ ] ', '[x] ', '<div>', '--', '-', '=', '+', '1.5', '10.', '~', '`',
    '__init__', '*a*', '[a]', '[a](b)', '[a]{color=red}', '![x](y)', 'https://e.com', 'www.e.com', 'a@b.co', '&amp;', '\\', ':',
    '|', '>', '#', '    x',
];

/**
 * A seeded pseudo-random stream (mulberry32), as `markdown-edit-fuzz.test.ts` uses; its constants are mulberry32's own.
 *
 * @param seed - The stream's seed.
 * @returns A function returning the next number in [0, 1).
 */
function randomStream(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Picks one entry of a list.
 *
 * @param random - The stream.
 * @param items - The list.
 * @returns The entry.
 */
function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)]!;
}

/**
 * One word: letters, a run of punctuation, or an opener.
 *
 * @param random - The stream.
 * @returns The word.
 */
function word(random: () => number): string {
    const roll = random();

    if (roll < 0.45) {
        return 'abcdefghij'.slice(0, 1 + Math.floor(random() * 6));
    }

    if (roll < 0.8) {
        return Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(random, [...PUNCTUATION])).join('');
    }

    return pick(random, OPENERS);
}

/**
 * One line of text, half of them opening with an opener.
 *
 * @param random - The stream.
 * @returns The line.
 */
function line(random: () => number): string {
    const words = Array.from({ length: 1 + Math.floor(random() * 4) }, () => word(random));

    return (random() < 0.5 ? pick(random, OPENERS) : '') + words.join(random() < 0.7 ? ' ' : '');
}

/**
 * A block's text: one to three lines, joined by line breaks unless the block holds one line.
 *
 * @param random - The stream.
 * @param oneLine - Whether the block holds a single line.
 * @returns Its text nodes and line breaks.
 */
function text(random: () => number, oneLine: boolean): LexicalNode[] {
    const lines = oneLine ? 1 : 1 + Math.floor(random() * 3);

    return Array.from({ length: lines }, (_, index) => {
        const node = $createTextNode(line(random));

        return index === 0 ? [node] : [$createLineBreakNode(), node];
    }).flat();
}

/**
 * Appends children to an element.
 *
 * @param element - The element.
 * @param children - Its children.
 * @returns `element`.
 */
function fill<T extends ElementNode>(element: T, children: LexicalNode[]): T {
    element.append(...children);

    return element;
}

/**
 * A list of one to three items, an item sometimes holding a paragraph or a nested list after its text.
 *
 * @param random - The stream.
 * @param depth - How deep the list is nested.
 * @returns The list.
 */
function list(random: () => number, depth: number): LexicalNode {
    const node = $createListNode(random() < 0.5 ? 'bullet' : 'number', 1);
    const items = 1 + Math.floor(random() * 3);

    for (let index = 0; index < items; index++) {
        const item = $createListItemNode().append(fill($createMarkdownListItemTextNode(), text(random, false)));
        const withParagraph = random() < 0.2;

        if (withParagraph) {
            item.append(fill($createParagraphNode(), text(random, false)));
        }

        const withNestedList = random() < 0.2;

        if (withNestedList && depth < 2) {
            item.append(list(random, depth + 1));
        }

        node.append(item);
    }

    return node;
}

/**
 * A two-by-two table, each cell holding one line.
 *
 * @param random - The stream.
 * @returns The table.
 */
function table(random: () => number): LexicalNode {
    const node = $createTableNode();

    for (let row = 0; row < 2; row++) {
        const cells = [0, 1].map(() => $createTableCellNode(row === 0 ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS)
            .append(fill($createParagraphNode(), text(random, true))));

        node.append(fill($createTableRowNode(), cells));
    }

    return node;
}

/**
 * One block: a paragraph, heading, quote, list, table or, at the top level, a two-column fence.
 *
 * @param random - The stream.
 * @param nested - Whether the block stands in a column.
 * @returns The block.
 */
function block(random: () => number, nested: boolean): LexicalNode {
    const roll = random();

    if (roll < 0.4) {
        return fill($createParagraphNode(), text(random, false));
    }

    if (roll < 0.52) {
        return fill($createHeadingNode(pick(random, ['h1', 'h2', 'h3'] as const)), text(random, random() < 0.6));
    }

    if (roll < 0.62) {
        return fill($createQuoteNode(), text(random, false));
    }

    if (roll < 0.82) {
        return list(random, 0);
    }

    if (roll < 0.92 || nested) {
        return table(random);
    }

    return fill($createMarkdownBlockNode(), [0, 1].map(() => fill($createMarkdownColumnNode(), [block(random, true), block(random, true)])));
}

/**
 * Reaches the private Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * An editor holding one to three random blocks.
 *
 * @param random - The stream.
 * @returns The editor.
 */
function randomDocument(random: () => number): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue('');
    lexicalOf(editor).update(() => {
        const root = $getRoot();

        root.clear();
        root.append(...Array.from({ length: 1 + Math.floor(random() * 3) }, () => block(random, false)));
    }, { discrete: true });

    return editor;
}

describe('a save escapes only what would read otherwise, and reloads as shown', () => {
    it(`${DOCUMENTS} seeded documents of text with Markdown punctuation load back as shown and save again unchanged`, () => {
        const random = randomStream(FUZZ_SEED);

        for (let index = 0; index < DOCUMENTS; index++) {
            const editor = randomDocument(random);
            const saved = canonicalSave(editor);
            const reloaded = new MarkdownEditor();

            reloaded.setValue(saved);

            expect(editorSurfaceModel(reloaded), `document ${index}: ${saved}`).toEqual(editorSurfaceModel(editor));
            expect(canonicalSave(reloaded), `document ${index}`).toBe(saved);

            reloaded.dispose();
            editor.dispose();
        }
    });
});
```

`randomStream` is copied from `markdown-edit-fuzz.test.ts`, which defines it locally; that file is not touched.[^copy]

---

## Addendum: The escape count

A throwaway test, run on the base and on the branch, then deleted:

```ts
import { it, beforeEach, afterEach } from 'vitest';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { canonicalSave, loadAndSave } from './harness';
import { CORPUS } from './corpus';

beforeEach(() => installTestDOM({ rootMountOffset: { x: 0, y: 0 }, viewport: { width: 1280, height: 800 }, scrollBarWidth: 15, fontMetrics, themeVars: {} }));
afterEach(() => DOM.reset());

/**
 * Counts the escape tokens the viewer's lexer reads in a text, by escaped character.
 *
 * @param markdown - The text.
 * @param counts - The counts so far. Updated in place.
 */
function countEscapes(markdown: string, counts: Map<string, number>): void {
    const seen = new Set<unknown>();
    const visit = (value: unknown): void => {
        const visited = seen.has(value);

        if (value === null || typeof value !== 'object' || visited) {
            return;
        }

        seen.add(value);

        const token = value as { type?: string; text?: string };

        if (token.type === 'escape') {
            counts.set(token.text ?? '', (counts.get(token.text ?? '') ?? 0) + 1);
        }

        Object.entries(value).filter(([key]) => key !== 'raw' && key !== 'links').forEach(([, child]) => visit(child));
    };

    visit(lexMarkdown(markdown));
}

it('escape count', () => {
    const counts = new Map<string, number>();

    for (const testCase of CORPUS) {
        countEscapes(canonicalSave(loadAndSave(testCase.source).editor), counts);
    }

    console.log([...counts.values()].reduce((sum, count) => sum + count, 0), Object.fromEntries(counts));
});
```

---

## Addendum: Re-pinned tests

Every value below changes only by left-out backslashes; old and new read alike in the viewer. TypeScript string escapes are written as in the files.

**`markdown-editor.test.ts`**, describe `MarkdownEditor list toggles in a list of their kind`:

- In `SAME` and `DIFFERS`, the WYSIWYG column (the sixth entry) of 31 rows: replace `\\[ \\]` with `\\[ ]` and `\\[x\\]` with `\\[x]`. Rows: `T1` UL, paragraph, h2, quote; `T2` UL; `T3` UL, paragraph, h2, quote; `T4` OL; `T5` UL; `T7` UL, paragraph; `T8` UL; `T10` UL, OL, paragraph; `T11` UL; `T12` UL; `T17` OL; `Q2` UL, OL; `T9` UL; `T14` UL, h2; `T16` UL; `E28` UL, OL; `E29` UL; `E30` UL, h2. The source column (seventh entry) is not changed.
- `CASES`, "a caret in a task item takes it out, its marker left as the text it shows": `result: '\\[ \\] one\n\n- [x] two'` → `'\\[ ] one\n\n- [x] two'`.

**`markdown-serializer.test.ts`:**

- `E11`: `'\\[x\\]: https\\://e.com'` → `'\\[x]: https\\://e.com'`.
- `S20`: `'[a ]{color=red}\\[[x]{color=red}\\][ b]{color=red}'` → `'[a ]{color=red}\\[[x]{color=red}][ b]{color=red}'`.
- The loop `for (const char of ['>', '-', '+', '*', '=', '|', ':', '~', '`'])` ("a paragraph starting with ${char} escapes it") keeps `['>', '-', '+', '*']`. A second loop over `['=', '|', ':', '~', '`']`, titled "a paragraph starting with ${char} that opens no block writes it bare", expects `` `${char} x` `` unescaped.
- "` and ~ are escaped anywhere in text" becomes "a lone ` and ~ need no escape; two of either are escaped": `'a`b~c'` saves `'a`b~c'`, and `'a`b`c ~d~'` saves `'a\\`b\\`c \\~d\\~'`; both read back as their text.

**`markdown-importer.test.ts`:**

| Test | Old | New |
|---|---|---|
| "emphasis around an empty link that a word before it keeps from opening is not written" | `'\\_1[](),'` | `'_1[](),'` |
| "C++ above Rust" row (`underline over C++ above Rust …`) | `` `${ONE_COLUMN}\| C\\+\\+ \|\n\| ++Rust++ \|` `` | `` `${ONE_COLUMN}\| C++ \|\n\| ++Rust++ \|` `` |
| "a word typed right before emphasis that opens with punctuation …" | `'foo fuzz\\*'` | `'foo fuzz*'` |
| row "with a definition naming its label" | `'- \\[x\\]\n\n[x]: /u'` | `'- \\[x]\n\n[x]: /u'` |
| row "unchecked" | `'- \\[ \\]'` | `'- \\[ ]'` |
| "a checkbox that text typed before it leaves inside its item's line …" | `'- }}\\[x\\] done\n\n[x]: https://e.com'` | `'- }}\\[x] done\n\n[x]: https://e.com'` |
| "a checkbox a line break moves off its item's first line …" | `'- a\\\n  \\[x\\] done\n\n[x]: /u'` | `'- a\\\n  \\[x] done\n\n[x]: /u'` |

**`markdown-reference-links.test.ts`:** `RL12` `'see \\[x\\]\\[toString\\]'` → `'see \\[x]\\[toString]'`; `DEF1` `'a \\[\\]\\[ref\\] b'` → `'a \\[]\\[ref] b'`; `DEF2` `'!\\[foo\\]\\[bar\\] y'` → `'!\\[foo]\\[bar] y'`; `DEF6` `'!\\[a\\]\\[q\\] z'` → `'!\\[a]\\[q] z'`; `DEF9` `'!\\[foo\\]\\[bar\\] y and \\[\\]\\[bar\\]\n\n[bar]: /url'` → `'!\\[foo]\\[bar] y and \\[]\\[bar]\n\n[bar]: /url'`; `DEF10` `'… and !\\[i\\]\\[s\\]\n\n…'` → `'… and !\\[i]\\[s]\n\n…'` (the link's own `\\\\[x\\\\]\\\\[r\\\\]` is unchanged); `DEF11` `'a \\[\\]\\[ref\\] b !\\[i\\]\\[ref\\]'` → `'a \\[]\\[ref] b !\\[i]\\[ref]'`.

**`markdown-source-preservation.test.ts`:** `P16` `'see \\[y\\]\n\n[y]: https://one'` → `'see \\[y]\n\n[y]: https://one'`; "writes text that a new definition would turn into a link in the standard form, and nothing else" `'see \\[y\\] and *em*\n\n_em_ alone\n\n[y]: https://one'` → `'see \\[y] and *em*\n\n_em_ alone\n\n[y]: https://one'`.

**`markdown-editor-list-item-edits.test.ts`** (`saved:` values): `D5` `'Z\\[x\\]: /a…'` → `'Z\\[x]: /a…'`; `J1` `'# h\\[x\\] w4…'` → `'# h\\[x] w4…'`; `J2` `'k\\[x\\] w4…'` → `'k\\[x] w4…'`; `J3` `'## \\[x\\] w4…'` → `'## \\[x] w4…'`; `RD12` and `RD14` `'…|||\n\\[x\\]: /u w…'` → `'…|||\n\\[x]: /u w…'`.

**`markdown-editor-typing-shortcuts.test.ts`**, the shared shapes table: row `'a link'` third entry `'a \\[t\\]\\(u)b'` → `'a \\[t](u)b'`; row `'a code fence'` third entry `'\\`\\`\\` cd'` → `'\\``` cd'`. This one table feeds 20 tests (`TY1`, `TY2`, `TY4`–`TY6`, `TY10`–`TY12`, `TY15`, `TY19`).

The row "space after a line-ending source run" (`'![i](javascript:x)\n<b> \n\\| a | b |\n==='`) is a setext heading and keeps its `\|`: it is not re-pinned.

**`markdown-editor-columns.test.ts`:** `W5` `'::: columns\n\\<div>\\\n\\`\\`\\`\\\n\\</div>\n|||\n\n:::'` → `'::: columns\n\\<div>\\\n\\```\\\n\\</div>\n|||\n\n:::'`.

**Rows of `markdown-editor-heading-to-code-escapes`** (not in the prototype's base; their documents are no longer in the standard form, which the row's first assertion checks):

| Row | Old document → code | New document → code |
|---|---|---|
| `H17` | `'### \\* alpha'` → `\* alpha` | `'### \\*alpha\\*'` → `` '```\n\\*alpha\\*\n```' `` on both surfaces |
| `H20` | `'\\+alpha'` | `'\\- alpha'`, code `` '```\n\\- alpha\n```' `` |
| `H21` | `'> \\+alpha'` | `'> \\- alpha'`, code `` '```\n\\- alpha\n```' `` |
| `H22` | `'- \\+alpha'` | `'- \\- alpha'`, code `` '```\n\\- alpha\n```' `` |
| "a code block made from each of several blocks …" | `'### +one\n\n\\+two'` → `` '```\n+one\n```\n\n```\n\\+two\n```' `` | `'### +one\n\n\\- two'` → `` '```\n+one\n```\n\n```\n\\- two\n```' `` |

Their comment line "an always-escaped character" becomes "a `*` that can pair". `H19` (a setext heading, which keeps every escape) and every other row of that plan are unchanged.

---

## Addendum: Measurements

Prototype in a private copy of `f984cf5e7`, `marked` 18.0.10. Escapes are counted as the `escape` tokens the viewer's lexer reads in each standard-form save.

| Input | Escapes before | After | Viewer reads a save differently | New round-trip or idempotence failures |
|---|---|---|---|---|
| Round-trip corpus (all cases) | 119 | 67 | 0 | 0 |
| Fuzz, marks/links/styles on, seed 24301, 3,000 documents | 45,043 | 25,883 | 0 | 0 (275 before and after) |
| Fuzz, marks/links/styles on, seed 99, 3,000 documents | 43,419 | 24,644 | 0 | 0 (289 before and after) |
| Fuzz, plain text, seed 777, 1,500 documents | 24,021 | 11,651 | 0 | 0 (none before or after) |

Corpus escapes by character, before → after: `]` 33 → 1, `*` 18 → 9, `#` 8 → 5, `_` 7 → 5, `|` 3 → 1, `(` 2 → 0, `-` 1 → 0, `=` 1 → 0; `[` 34, `+` 5, `\` 3, `` ` `` 1, `.` 1, `:` 1, `<` 1 unchanged.

Plain-text fuzz by character, before → after: `[` 3,185 → 3,185, `]` 3,196 → 0, `_` 4,187 → 2,213, `*` 2,817 → 1,330, `~` 2,143 → 703, `` ` `` 2,097 → 782, `(` 688 → 0, `:` 790 → 538, `-` 536 → 127, `|` 474 → 5, `#` 449 → 229, `{` 330 → 0, `=` 270 → 4, `+` 281 → 135; the rest unchanged.

Cost of `getValue()` (a full save, which the editor runs after every update), median of five, headless, measured on the prototype with the remembered answers:

| Document | Before | After |
|---|---|---|
| The library's `docs/components` pages, 60,000 characters, 284 blocks | 12.8–15.1 ms | 14.1–15.7 ms |
| 1,000 prose paragraphs, each with escapes to leave out | 66–68 ms | 75 ms |

Loading either document took the same time before and after, within run-to-run noise. Without the remembered answers the second row took 95 ms.

---

## Notes

[^check]: The check compares the lean writing with the full writing, not with the editor's own reading of the block (the `intended` reading `createReadBack` scores against). The intended reading is not exact everywhere: a task marker turned into text reads without its trailing space, so a heading made from `- [ ] one` never reads back as intended, whatever is written. Compared with it, a lean writing of such a block was rejected although it read exactly as today's save. Compared with the full writing, the rule the owner set — nothing the viewer shows may change — is checked directly, and a lossy block keeps exactly today's reading. `markdownReading` returns `null` when the Markdown does not lex as one block of its kind; the full writing is then kept.

[^grouped]: The prototype first let the lean rules run inside link text too. Its fuzz then rejected 873 of 43,262 lean writings, most of them a lone backtick in link text (`[abc\`](/u)` written ``[abc`](/u)`` is no link any more: `marked` pairs backticks while it looks for the end of link text), and the rest a `~` written bare next to a `*` delimiter (`marked` counts a bare `~` as a letter there, so the `*` no longer closes). With link and span text kept whole and the touching-delimiter rule added, no lean writing was rejected in 40,000 tries.

[^bracket]: `[a]` written bare reads as text only while no definition labels it `a`. `$needsDefinitions` reads the definitions only when the document holds a reference link, so most saves do not even know them. Escaping the `[` alone is enough: with no opener, no `]` can close anything, which is why the lean writing is `\[a]`. The comment of `registerDefinitionRules` ("text escapes its brackets, so text never becomes a link") and the footnote `[^reads-alike]` of `markdown-editor-large-document-costs` need only the `[`.

[^setext]: Found by the fuzz with marks on (seed 24301, document 317): a level 2 heading whose last line is `|` was written `|⏎---`, and `marked` reads a table there. The heading's lines are checked as a paragraph, without the underline that follows them. Setext headings with several lines are rare, so they keep every escape rather than gaining a check of their own.

[^join]: `$serializeBlock(paragraph)` and `$serializeInlineNodes(paragraph.getChildren())` write the same Markdown for a paragraph: both call `serializeInlineNodes` on its children in the `MULTI_LINE` context with `$collectDefinitions()`. `$paragraphAfterTextOnlyBlockEnd` and `$textOnlyBlockBeforeParagraphStart` only ever return a `ParagraphNode`.

[^cost]: The editor runs a whole save after every update (`handleChange`, `MarkdownEditor.ts:9317`), and a save writes every block's standard form to compare it with the one at load. On 1,000 paragraphs that each leave out an escape, checking every block on every save took a save from 67 ms to 95 ms; remembering the answers brought it to 75 ms. The rest is the second assembly of each such block. The map holds one entry per block that leaves out an escape, two writings each; 8,192 entries of a few hundred bytes is a few megabytes at most.

[^measured]: "What the editor holds" is compared as `editorSurfaceModel`, the projection the harness already uses for its `surface` check. The fuzz and the corpus were run in the prototype with a switch that turned the lean writing off, so before and after came from the same documents; the switch is not part of this plan.

[^depth]: `unescapeCodeSpanBrackets` adds `[` and `]` syntax pieces only in pairs inside a link's text, so they never take the depth below the link's own. `protectLabelBrackets` adds `\\[` and `\\]`, which neither are `[` nor start with `]`. A code span or an image is one syntax piece that starts with a backtick or `!`.

[^g7]: G7 chose `\[ \]` over `\[ ]` only so that source mode writes "exactly what the WYSIWYG surface writes there". Once the WYSIWYG save writes `\[ ]`, the same reason picks `\[ ]`, which was the first recommendation. The viewer reads both as `[ ] mid`.

[^copy]: Moving `randomStream` into `harness.ts` for both fuzz files would remove the copy, but it would edit `markdown-edit-fuzz.test.ts`, which other queued plans may also edit. The copy is twelve lines.
