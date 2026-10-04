---
depends-on: [markdown-viewer-block-fixes, markdown-editor-command-crash-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownAttributes.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown `:::` Column Fixes — Implementation Plan

## Overview

A fuzz pass over the tip of the unmerged Markdown stack found four defects in
the dialect's `:::` column fences. Defects 1 and 2 sit in code that is
unchanged from `master`. This plan is written against the stack tip,
`feature/markdown-viewer-block-fixes` at `4eccafcb`, and lands on top of
`markdown-editor-command-crash-fixes`. Line numbers are from `4eccafcb`; find
each site by its symbol name first.

| # | Defect | Where the fault is | Fix |
|---|---|---|---|
| 1 | Viewer: a `:::` line inside a fenced code block in a fence closes the fence; a `::: x` line there leaves it unclosed | [`BLOCK_EXTENSION`](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L124) scans for its closing line without tracking code fences | one shared line reader that tracks code fences |
| 2 | Viewer: `\|\|\|` after a ```` ```` ```` fence holding a ```` ``` ```` line (or a `~~~` fence holding one) does not split | [`splitColumnSections`](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L69) and [`joinColumnSections`](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L129) flip "in code" on any fence-looking line | the same reader: a fence closes only on its own character and length |
| 3 | Editor: wrapping blocks in a fence (`setBlockAlignment`, `setColumnCount`), or pasting or typing into a column, saves a fence the viewer reads differently | defects 1–2, plus a raw Markdown block whose `:::` / `::: x` / code-fence lines the fence grammar reads, plus a code block whose fence an indented content line closes for the fence scan | defects 1–2's fix; a raw block that would break its column saves and shows as a paragraph; code fences longer than any run at any indent |
| 4 | Editor: pasting a selection that spans two columns leaves bare `markdown-column` nodes in a column or at the root, and a paragraph nested in a paragraph in a table cell (save flattens them; nothing is lost) | no rule keeps a column inside a fence | a node transform unwraps a column whose parent is not a fence |

The viewer fixes live in the dialect's grammar module
[markdownAttributes.ts](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts)
and its tokenizer in
[markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts).
The editor loads Markdown through the same lexer, so it reads the fixed
documents the same way with no importer change. The editor fixes live in
[markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
and [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts).
`MarkdownEditor.ts` is not changed. Tests, harness corpus cases, both
component pages and the changelog are updated.

---

## Architecture Decisions

### One line reader for the `:::` grammar

`markdownAttributes.ts` gets one function, `readFenceLine(scan, line)`, that
reads a fence's inner text one line at a time and says what each line is at
the fence's own level. `BLOCK_EXTENSION`, `splitColumnSections` and
`joinColumnSections` all use it instead of their own loops. The module's
header already says it keeps the dialect's grammar "in exactly one place" so
the viewer and the editor agree; split and join already live there.[^one-reader]

`readFenceLine` returns one of four roles:

| Role | Line (trimmed) | When |
|---|---|---|
| `"closer"` | `:::` | depth 0, outside code |
| `"separator"` | `\|\|\|` | depth 0, outside code |
| `"escaped-separator"` | `\\|\|\|` | depth 0, outside code |
| `"content"` | anything else, and every line inside code or a nested fence | — |

The scan state is `{ depth, code }`. A `::: x` line (non-empty remainder)
raises `depth`; a `:::` line at depth > 0 lowers it. A code-fence line sets or
clears `code`. Lines inside code change nothing.

### Code fences are read as `marked` reads them, at any indentation

A code fence opens on a run of three or more `` ` `` or `~`; a backtick run's
info string may not hold a backtick. It closes on a line that starts with the
opening run repeated (same character, at least as long) followed only by
fence characters. This mirrors `marked`'s own `fences` rule. Indentation is
ignored, as it already is for `:::` and `|||` lines.[^fence-rule]

| Inside code opened by | Line | Closes the code? |
|---|---|---|
| ```` ``` ```` | ```` ``` ```` | yes |
| ```` ``` ```` | ```` ```` ```` | yes (longer run) |
| ```` ``` ```` | ```` ```~ ```` | yes (`marked` accepts trailing fence characters) |
| ```` ``` ```` | ```` ``` x ```` | no (text after the run) |
| ```` ```` ```` | ```` ``` ```` | no (shorter) |
| `~~~` | ```` ``` ```` | no (other character) |
| outside code | ```` ``` a`b ```` | does not open code (backtick in a backtick info string) |

### A code block left open hides the fence's closing line

When the scan reaches the end of the source still inside code, the `:::`
fence has no closing line, so `BLOCK_EXTENSION` declines, exactly as it
already does for an unclosed `:::` fence. The lines then read as `marked`
reads them: the opener as a paragraph, the code block running to the end of
the document.[^open-code]

| Source | Reads as |
|---|---|
| `::: columns\nA\n\|\|\|\n```\nB\n:::` | paragraph `::: columns\nA\n\|\|\|`, then code `B\n:::` |
| `::: columns\n```\na\n``` x\n\|\|\|\nB\n:::` | paragraph `::: columns`, then code `a\n``` x\n\|\|\|\nB\n:::` |

### A raw block that would break its column saves as a paragraph

A raw Markdown block (`MarkdownRawBlockNode`: an HTML block, a quote or list
kept as source, …) is saved as its text. Inside a column, that text can hold a
line the fence grammar reads: a `:::` line ends the fence early, a `::: x`
line or a code fence left open swallows the closing line, and a `\|||` line
loses its backslash. Such a raw block is now written as a paragraph holding
its text — escaped, its lines kept by hard breaks — and the editor shows it as
that paragraph.[^why-convert]

This extends the existing run-on rule. `$rawBlockWritesAsParagraph`
([markdownSerializer.ts:1334](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1334))
already makes the save write a run-on HTML block as a paragraph, and
`$showRawBlocksAsWritten`
([markdownWritable.ts:442](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L442)),
already registered on `MarkdownColumnNode`, `ParagraphNode`,
`MarkdownRawBlockNode` and raw-block text, shows it as that paragraph. The
new condition is one more reason in `$rawBlockWritesAsParagraph`; every
trigger (wrap, paste, typing, a shrink moving blocks between columns) is
already wired.[^triggers]

The test is a new pure function `breaksColumn(content)` in
`markdownAttributes.ts`: the content is joined as the only column, the join is
read with `readFenceLine`, and the content breaks the column when any line is
a `"closer"`, the scan ends at depth ≠ 0 or inside code, or splitting the join
does not give back exactly `[content]`.[^scan-not-lex]

| Raw block text | `breaksColumn` | Why |
|---|---|---|
| `<div>\n:::\n</div>` | `true` | closes the fence early |
| `<div>\n::: x\n</div>` | `true` | leaves depth 1 |
| `<div>\n```\n</div>` | `true` | leaves code open |
| `<div>\n\\\|\|\|\n</div>` | `true` | the split would drop the backslash |
| `- a\n\n  b\n  :::` | `true` | closes the fence early |
| `<div>\n\|\|\|\n</div>` | `false` | join escapes it, split restores it |
| ```` ```\n:::\n``` ```` | `false` | the `:::` is code |
| `::: {align=right}\nx\n:::` | `false` | balanced nested fence |

Only raw blocks need the test: every other block the serializer writes keeps
a column intact once defects 1–2 are fixed.[^only-raw]

### Code blocks are written with a fence longer than any run, at any indentation

`serializeCode` sizes its fence past the longest backtick or tilde run that
starts a content line. Today it counts only runs indented up to three spaces
(`CODE_LINE_FENCE_RUN`, [markdownSerializer.ts:161](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L161)),
which is where `marked` reads a closer. The fence scan reads a closer at any
indentation, so the run is now counted at any indentation.[^fence-length]

| Code block text | Fence today | Fence after |
|---|---|---|
| ``'    ````\n:::'`` | ```` ``` ```` | ```` ````` ```` |
| ``'    ```'`` (loaded from `~~~`) | ```` ``` ```` | ```` ```` ```` |
| `'  ~~~~'` | ```` ``` ```` | ```` ``` ```` (other character) |

### A column outside a fence becomes the blocks it holds

A new `MarkdownColumnNode` transform, `$keepColumnInFence`, replaces a column
whose parent is not a `MarkdownBlockNode` with its children, using
`@lexical/utils`' `$unwrapNode`. The save already writes such a column as its
children, so the editor now shows what is saved. The precedent is
`$keepCellParagraphs`
([markdownWritable.ts:248](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L248)):
blocks pasted where Markdown cannot hold them become what the save
writes.[^flatten]

| Paste of a selection from `Left`@1 to `Right`@2 in `::: columns\nLeft\n\|\|\|\nRight\n:::` | Today | After |
|---|---|---|
| into the second column, after `Right` | two bare columns inside the column (shown as raw blocks) | paragraphs `eft`, `Ri` in the column |
| into a top-level paragraph `para` at 2 | two bare columns at the root | paragraphs `eft`, `Ri` at the root |
| into a table cell `c1` at 1 | nested paragraphs in the cell | paragraphs `eft`, `Ri` in the cell |

### No change to the wrap commands

`setBlockAlignment` and `setColumnCount` keep wrapping through
`$wrapSelectedTopLevelBlocks`
([MarkdownEditor.ts:468](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L468)),
which `markdown-editor-command-crash-fixes` rewrites (its defect 1). This plan
fixes what a wrap saves, not which blocks it wraps, so it does not touch that
function. A selection that reaches into an existing fence still wraps the
whole fence in a new one; nested fences are valid in the dialect.

---

## Internal Structure

### `markdownAttributes.ts`

Replace `splitColumnSections` and `joinColumnSections` (L51–154) with the
block below, in this order. Keep `COLUMN_SEPARATOR` (L49) above it. Every
function gets a JSDoc block as the module already does; the `@example`s on
split and join stay and gain one for the length rule.

```typescript
/** An open code fence: its character and the length of its opening run. */
interface CodeFence {
    readonly char:   string;
    readonly length: number;
}

/** A trimmed code-fence line: three or more backticks or tildes, then the rest of the line. */
const CODE_FENCE_LINE = /^(`{3,}|~{3,})(.*)$/;

/** What may follow a closing fence's run: more fence characters only, as `marked`'s `fences` rule allows. */
const CLOSING_FENCE_TAIL = /^[`~]*$/;

/** Where a line scan of a `:::` fence's inner text stands. */
export interface FenceLineScan {
    depth: number;
    code:  CodeFence | null;
}

/** What one line is at a `:::` fence's own level. */
export type FenceLineRole = "closer" | "separator" | "escaped-separator" | "content";

export function startFenceLineScan(): FenceLineScan {
    return { depth: 0, code: null };
}

function openedCodeFence(trimmed: string): CodeFence | null {
    const match = CODE_FENCE_LINE.exec(trimmed);

    if (match === null) {
        return null;
    }

    const run = match[1]!;

    // A backtick fence's info string cannot hold a backtick (CommonMark §4.5).
    return run[0] === "`" && match[2]!.includes("`") ? null : { char: run[0]!, length: run.length };
}

function closesCodeFence(trimmed: string, fence: CodeFence): boolean {
    return trimmed.startsWith(fence.char.repeat(fence.length)) && CLOSING_FENCE_TAIL.test(trimmed.slice(fence.length));
}

export function readFenceLine(scan: FenceLineScan, line: string): FenceLineRole {
    const trimmed = line.trim();

    if (scan.code !== null) {
        const closed = closesCodeFence(trimmed, scan.code);

        scan.code = closed ? null : scan.code;

        return "content";
    }

    const opened = openedCodeFence(trimmed);

    if (opened !== null) {
        scan.code = opened;

        return "content";
    }

    if (trimmed === ":::") {
        if (scan.depth === 0) {
            return "closer";
        }

        scan.depth -= 1;

        return "content";
    }

    // A `:::` line with anything after it opens a nested fence (3 is ":::".length, as in the tokenizer).
    const opensFence = trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "";

    if (opensFence) {
        scan.depth += 1;

        return "content";
    }

    if (scan.depth === 0 && trimmed === COLUMN_SEPARATOR) {
        return "separator";
    }

    return scan.depth === 0 && trimmed === `\\${COLUMN_SEPARATOR}` ? "escaped-separator" : "content";
}

export function splitColumnSections(inner: string): string[] {
    const sections: string[] = [];
    const scan = startFenceLineScan();
    let current: string[] = [];

    for (const line of inner.split("\n")) {
        const role = readFenceLine(scan, line);

        if (role === "separator") {
            sections.push(current.join("\n"));
            current = [];

            continue;
        }

        // Keep the existing comment about unescaping only at this fence's own level.
        current.push(role === "escaped-separator" ? line.replace("\\", "") : line);
    }

    sections.push(current.join("\n"));

    return sections;
}

export function joinColumnSections(sections: string[]): string {
    return sections
        .map((section) => {
            const scan = startFenceLineScan();

            return section.split("\n")
                .map((line) => (readFenceLine(scan, line) === "separator" ? line.replace(COLUMN_SEPARATOR, `\\${COLUMN_SEPARATOR}`) : line))
                .join("\n");
        })
        .join(`\n${COLUMN_SEPARATOR}\n`);
}

export function breaksColumn(content: string): boolean {
    const inner = joinColumnSections([content]);
    const scan = startFenceLineScan();
    const closesEarly = inner.split("\n").some((line) => readFenceLine(scan, line) === "closer");
    const sections = splitColumnSections(inner);

    return closesEarly || scan.depth !== 0 || scan.code !== null || sections.length !== 1 || sections[0] !== content;
}
```

`readFenceLine`'s JSDoc states the four roles (the decision table above) and
that it mutates `scan`. `breaksColumn`'s JSDoc says: "whether content written
as the only column of a `:::` fence would not read back as that column: a line
would close the fence, the fence's closing line would be swallowed by a
nested fence or a code block left open, or the join and split would change a
line".

### `markdownExtensions.ts` — `BLOCK_EXTENSION`

Replace the depth loop (L142–164) with:

```typescript
const scan = startFenceLineScan();
let closingStart = -1;
let lineEnd = openingEnd;

while (lineEnd < src.length) {
    const lineStart = lineEnd + 1;

    lineEnd = lineEndAt(src, lineStart);

    const role = readFenceLine(scan, src.slice(lineStart, lineEnd));

    if (role === "closer") {
        closingStart = lineStart;

        break;
    }
}
```

The rest of the tokenizer (`raw`, `inner`, `splitColumnSections(inner)`) is
unchanged. In its JSDoc (L114–123), replace "The scan tracks depth so fences
nest" with "The scan (`readFenceLine`) tracks depth so fences nest, and code
fences so a `:::` line inside code is code; a code block left open hides the
closing line, and the fence then declines".

### `markdownSerializer.ts`

```typescript
const CODE_LINE_FENCE_RUN = /^[ \t]*(`+|~+)/;

export function $rawBlockWritesAsParagraph(node: MarkdownRawBlockNode, definitions: Links | null = $collectDefinitions()): boolean {
    const breaksItsColumn = $isMarkdownColumnNode(node.getParent()) && breaksColumn(node.getTextContent());

    return breaksItsColumn
        || (runsOn(node.getTextContent()) && node.getNextSiblings().some((sibling) => serializeBlock(sibling, definitions) !== ""));
}
```

### `markdownWritable.ts`

```typescript
function $keepColumnInFence(column: MarkdownColumnNode): void {
    const inFence = $isMarkdownBlockNode(column.getParent());

    if (!inFence) {
        $unwrapNode(column);
    }
}
```

Registered directly in `registerWritableStateRules`, beside
`$keepUnwritableCharactersPlain`:
`editor.registerNodeTransform(MarkdownColumnNode, $keepColumnInFence)`.

---

## Ordered Implementation Steps

Work in the plan's own worktree, on top of the stack tip after
`markdown-editor-command-crash-fixes` has landed. Run every command from
`packages/lib` unless noted.

1. **Worktree setup.** Symlink `node_modules` and `packages/lib/node_modules`
   to the main tree's, as the stack's worktrees do. Check:
   `npm ls @lexical/clipboard` lists it as a direct dependency (added by
   `markdown-editor-command-crash-fixes` step 4).
2. **Failing viewer tests.**
   - In `tests/component/display/markdownLexer.test.ts`, after the
     `'the fence extension emits the same tokens as the line-splitting original'`
     describe (L197–238), add
     `describe('the fence extension reads code fences inside a fence (CF rows)')`
     with one `it` per CF row of *Expected Behaviour*, using the file's
     `tokenAt` / `typesOf` helpers.
   - In `tests/component/display/Markdown.test.ts`, add the S rows to the
     `'splitColumnSections / joinColumnSections'` describe (L593–638), and a
     new `describe('breaksColumn')` right after it with the BC rows. Add
     `breaksColumn` to the file's `markdownAttributes` import.
   - Check: `npx vitest run tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts`.
     CF1–CF4, CF6, CF7, CF10, S1–S4 and every BC row fail (BC with
     `breaksColumn is not a function`); CF5, CF8 and CF9 pass.
3. **Failing editor tests.** Create
   `tests/component/markdown-editor-columns.test.ts`. Copy the header of
   `markdown-reference-links.test.ts` (`CONFIG`, `installTestDOM` /
   `DOM.reset`, `lexicalOf`, `load`), without its `vi.mock`. Add helpers:
   - `selectText(editor, [anchorText, anchorOffset], [focusText, focusOffset])`:
     finds each text node by exact text and sets a `$createRangeSelection`
     in a discrete update (the same helper as `markdown-editor-command-crashes.test.ts`).
   - `copySelection(editor)`: `$generateJSONFromSelectedNodes(lexical, $getSelection()).nodes` inside `read`.
   - `pasteNodes(editor, nodes)`: in a discrete update,
     `$insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!)`.
     All three come from `@lexical/clipboard`; `$insertGeneratedNodes`
     dispatches `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`, as a real paste does.
   - `columnChildTypes(editor)`: the types of every column's children, in document order.
   - `strayColumns(editor)`: the count of `markdown-column` nodes whose parent is not a `markdown-block`.
   - `expectParity(editor)`: `expect(editorSurfaceModel(editor)).toEqual(viewerModel(editor.getValue()).blocks)`
     (both from `./markdown-roundtrip/viewModel`).

   Write one `it` per W, T, P, G and SC row. Wrap rows put the caret with
   `$getRoot().selectStart()` in a discrete update before the command.
   Check: `npx vitest run tests/component/markdown-editor-columns.test.ts`;
   W6, P4 and G1 pass, every other row fails.
4. **`markdownAttributes.ts`.** Replace `splitColumnSections` /
   `joinColumnSections` with the *Internal Structure* block. Update the
   module header (L3–11) to say it also holds the code-fence rule the `:::`
   grammar reads. Check: S and BC rows pass;
   `grep -n 'inCode' src/typescript/lib/component/display/markdownAttributes.ts`
   finds nothing.
5. **`markdownExtensions.ts`.** Import `readFenceLine` and
   `startFenceLineScan` (L5) and replace `BLOCK_EXTENSION`'s loop and JSDoc as
   in *Internal Structure*. Check: CF rows pass; the whole
   `markdownLexer.test.ts` passes, including its complexity cases.
6. **`markdownSerializer.ts`.**
   - Add `breaksColumn` to the `markdownAttributes.js` import (L19–22).
   - Change `CODE_LINE_FENCE_RUN` (L161) to ``/^[ \t]*(`+|~+)/`` and its JSDoc
     (L157–160) to: "A code line's leading backtick and tilde runs, at any
     indentation: the `:::` fence scan reads a closing fence at any
     indentation, so the written fence must outrun every one."
   - Rewrite `$rawBlockWritesAsParagraph` (L1334) as in *Internal Structure*.
     Its JSDoc (L1322–1333) and `serializeRawBlock`'s (L1306–1318) gain the
     second reason: "or it stands in a `:::` column and its text would break
     the column (`breaksColumn`): end the fence, swallow its closing line, or
     lose a backslash to the separator unescape."
   - Check: W1–W8, T1, P5 and SC1 pass.
7. **`markdownWritable.ts`.**
   - Import `$unwrapNode` with `mergeRegister` from `@lexical/utils` (L22),
     and `$isMarkdownBlockNode` with `MarkdownColumnNode` (L28).
   - Add a section `// ---------------------------------------------------------------- columns`
     between the tables section and the raw-blocks section (before L317),
     holding `$keepColumnInFence` with JSDoc: "Replaces a `:::` column that
     stands outside a fence — pasted from a selection that spanned columns —
     with the blocks it holds, which is what the save writes for it."
   - Register it in `registerWritableStateRules` (L60–65) after
     `$keepUnwritableCharactersPlain`. Extend that function's JSDoc list with
     "a `:::` column stands only in its fence ({@link $keepColumnInFence})".
     Extend `registerRawBlockRules`' JSDoc (L319–331): "and so does a raw
     block in a `:::` column whose text would break the column".
   - Check: P1–P3 and P6 pass; the whole new file passes.
8. **Harness corpus.** Append the seven H rows of *Expected Behaviour* to
   `DIALECT_CASES` in `tests/component/markdown-roundtrip/corpus/dialect.ts`,
   with no `known` entries. Check:
   `npx vitest run tests/component/markdown-roundtrip` — all checks and the
   edit fuzz pass.
9. **Docs.** Apply the `Markdown.md` and `MarkdownEditor.md` edits in
   *Documentation Impact*.
10. **Changelog.** Add the two entries in *Documentation Impact* to
    `docs/reference/changelog/next.md` → `## Fixed` → `### Components`, after
    the entries `markdown-editor-command-crash-fixes` added.
11. **Full verification.** Run everything in *Verification*, then the manual
    checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-columns.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests unless marked manual. "Today" is the stack tip.
Every expected value below was checked against a prototype of this plan, and
every "Today" against the stack tip.[^prototype] Sources are JavaScript string
literals.

### Viewer: the fence tokenizer (`markdownLexer.test.ts`)

"Columns" lists each column's top-level tokens as `type "text"`.

| # | Source | Expected `lexMarkdown` | Today |
|---|---|---|---|
| CF1 | `'::: columns\n```\n:::\n```\n\|\|\|\nB\n:::'` | one `mdblock`, `raw` = the whole source; columns `[code ":::"]`, `[paragraph "B"]` | `mdblock` ends at the code's `:::` (one column, code `""`), then code `"\|\|\|\nB\n:::"` |
| CF2 | `'::: columns\n```\n::: x\n```\n\|\|\|\nB\n:::'` | one `mdblock`; columns `[code "::: x"]`, `[paragraph "B"]` | no `mdblock`: paragraph, code, paragraph |
| CF3 | `'::: columns\n````\n```\n````\n\|\|\|\nB\n:::'` | one `mdblock`; columns `[code "```"]`, `[paragraph "B"]` | one column: code, paragraph `"\|\|\|\nB"` |
| CF4 | `'::: columns\n~~~\n```\n~~~\n\|\|\|\nB\n:::'` | as CF3 | as CF3 today |
| CF5 | `'::: columns\n```\na\n```~\n\|\|\|\nB\n:::'` | one `mdblock`; columns `[code "a"]`, `[paragraph "B"]` | same |
| CF6 | `'::: columns\n```\na\n``` x\n\|\|\|\nB\n:::'` | paragraph `"::: columns"`, code `"a\n``` x\n\|\|\|\nB\n:::"` | `mdblock` of two columns |
| CF7 | `'::: columns\nA\n\|\|\|\n```\nB\n:::'` | paragraph `"::: columns\nA\n\|\|\|"`, code `"B\n:::"` | `mdblock`: `[paragraph "A"]`, `[code "B"]` |
| CF8 | ``'::: {align=center}\n``` a`b\n:::'`` | one `mdblock`; one column ``[paragraph "``` a`b"]`` | same |
| CF9 | `'::: columns\n::: {align=right}\n```\n\|\|\|\n```\n:::\n\|\|\|\nB\n:::'` | one `mdblock`; columns `[mdblock [[code "\|\|\|"]]]`, `[paragraph "B"]` | same |
| CF10 | `'::: columns\n  ```\n  :::\n  ```\n\|\|\|\nB\n:::'` | one `mdblock`; columns `[code ":::"]`, `[paragraph "B"]` | as CF1 today |

### Viewer: split and join (`Markdown.test.ts`)

| # | Call | Expected | Today |
|---|---|---|---|
| S1 | `splitColumnSections('````\n```\n````\n\|\|\|\nB')` | `['````\n```\n````', 'B']` | one section |
| S2 | `splitColumnSections('~~~\n```\n~~~\n\|\|\|\nB')` | `['~~~\n```\n~~~', 'B']` | one section |
| S3 | `joinColumnSections(['````\n```\n\|\|\|\n````', 'B'])` | `'````\n```\n\|\|\|\n````\n\|\|\|\nB'` (the code's `\|\|\|` is not escaped) | the code's `\|\|\|` is escaped |
| S4 | `splitColumnSections(joinColumnSections(['````\n```\n\|\|\|\n````', 'B']))` | the input array | one section |

### `breaksColumn` (`Markdown.test.ts`)

| # | Input | Expected |
|---|---|---|
| BC1 | `'<div>\n:::\n</div>'` | `true` |
| BC2 | `'<div>\n::: x\n</div>'` | `true` |
| BC3 | `'<div>\n```\n</div>'` | `true` |
| BC4 | `'<div>\n\\\|\|\|\n</div>'` | `true` |
| BC5 | `'- a\n\n  b\n  :::'` | `true` |
| BC6 | `'<div>\n\|\|\|\n</div>'` | `false` |
| BC7 | `'```\n:::\n```'` | `false` |
| BC8 | `'::: {align=right}\nx\n:::'` | `false` |
| BC9 | `''` | `false` |

### Editor (`markdown-editor-columns.test.ts`)

Each W, T and P row also asserts `expectParity(editor)`. "Parity" in the
Today column means that assertion.

| # | Load | Action | Expected `getValue()` | Also | Today |
|---|---|---|---|---|---|
| W1 | `'```\n:::\n```'` | `setBlockAlignment('center')` | `'::: {align=center}\n```\n:::\n```\n:::'` | — | same value, parity fails |
| W2 | `'````\naaa\n```\n````'` | `setColumnCount(2)` | `'::: columns\n````\naaa\n```\n````\n\|\|\|\n\n:::'` | — | same value, parity fails |
| W3 | `'<div>\n:::\n</div>'` | `setBlockAlignment('center')` | `'::: {align=center}\n\\<div>\\\n\\:::\\\n\\</div>\n:::'` | `columnChildTypes` = `['paragraph']` | `'::: {align=center}\n<div>\n:::\n</div>\n:::'`, parity fails |
| W4 | `'<div>\n::: x\n</div>'` | `setColumnCount(2)` | `'::: columns\n\\<div>\\\n\\::: x\\\n\\</div>\n\|\|\|\n\n:::'` | — | raw text written, parity fails |
| W5 | `'<div>\n```\n</div>'` | `setColumnCount(2)` | ``'::: columns\n\\<div>\\\n\\`\\`\\`\\\n\\</div>\n\|\|\|\n\n:::'`` | — | raw text written, parity fails |
| W6 | `'<div>\n\|\|\|\n</div>'` | `setColumnCount(2)` | `'::: columns\n<div>\n\\\|\|\|\n</div>\n\|\|\|\n\n:::'` | `columnChildTypes` = `['markdown-raw-block', 'paragraph']` | same |
| W7 | `'- a\n\n  b\n  :::'` | `setColumnCount(2)` | `'::: columns\n\\- a\\\n\\\nb\\\n\\:::\n\|\|\|\n\n:::'` | — | raw text written, parity fails |
| W8 | `'````\n    ````\n:::\n````'` | `setBlockAlignment('center')` | `'::: {align=center}\n`````\n    ````\n:::\n`````\n:::'` | — | fence ```` ``` ````, parity fails |
| T1 | `'::: {align=center}\n<div>\nx\n</div>\n:::'` | in a discrete update, set the text node `x` to `:::` | `'::: {align=center}\n\\<div>\\\n\\:::\\\n\\</div>\n:::'` | `columnChildTypes` = `['markdown-raw-block']` before, `['paragraph']` after | raw text written, parity fails |
| P1 | `'::: columns\nLeft\n\|\|\|\nRight\n:::'` | copy `Left`@1→`Right`@2; paste at `Right`@5 | `'::: columns\nLeft\n\|\|\|\nRight\n\neft\n\nRi\n:::'` | `strayColumns` = 0 | same value, parity fails |
| P2 | `'::: columns\nLeft\n\|\|\|\nRight\n:::\n\npara'` | copy `Left`@1→`Right`@2; paste at `para`@2 | `'::: columns\nLeft\n\|\|\|\nRight\n:::\n\npa\n\neft\n\nRi\n\nra'` | root child types `['markdown-block', 'paragraph', 'paragraph', 'paragraph', 'paragraph']` | same value, parity fails |
| P3 | `'- item\n\n::: columns\nLeft\n\|\|\|\nRight\n:::'` | copy `Left`@1→`Right`@2; paste at `item`@2 | `'- it\n\neft\n\nRiem\n\n::: columns\nLeft\n\|\|\|\nRight\n:::'` | `strayColumns` = 0 | same value, parity fails |
| P4 | `'::: columns\nLeft\n\|\|\|\nRight\n:::\n\npara'` | copy `Left`@0→`para`@2; paste at `Right`@3 | `'::: columns\nLeft\n\|\|\|\nRig\n\n::: columns\nLeft\n\|\|\|\nRight\n:::\n\npaht\n:::\n\npara'` (a nested fence) | — | same |
| P5 | `'z\n\n<div>\n:::\n</div>\n\n::: {align=center}\nA\n:::'` | copy `z`@0→`</div>`@6; paste at `A`@1 | `'z\n\n<div>\n:::\n</div>\n\n::: {align=center}\nAz\n\n\\<div>\\\n\\:::\\\n\\</div>\n:::'` | `columnChildTypes` = `['paragraph', 'paragraph']` | raw block kept in the column, parity fails |
| P6 | `'::: columns\nLeft\n\|\|\|\nRight\n:::\n\n\| h1 \| h2 \|\n\| --- \| --- \|\n\| c1 \| c2 \|'` | copy `Left`@1→`Right`@2; paste at `c1`@1 | `'::: columns\nLeft\n\|\|\|\nRight\n:::\n\n\| h1 \| h2 \|\n\| --- \| --- \|\n\| c\\n\\neft\\n\\nRi\\n\\n1 \| c2 \|'` | the cell's children are four `paragraph`s, none holding a `paragraph` | same value; the cell holds a paragraph inside a paragraph |
| G1 | `'::: {align=center}\n<div>\nx\n</div>\n:::'` | none | the source, unchanged | `columnChildTypes` = `['markdown-raw-block']` | same |
| SC1 | `'~~~\n    ```\n~~~'` | `canonicalSave(editor)` (from `./markdown-roundtrip/harness`) | `'````\n    ```\n````'` | — | `'```\n    ```\n```'` |

### Harness corpus (`corpus/dialect.ts`)

Each case passes all six harness checks and the edit fuzz with no `known`
entry.

| # | `name` | `source` |
|---|---|---|
| H1 | `code fence holding a fence closer in a column` | `'::: columns\n```\n:::\n```\n\|\|\|\nB\n:::'` |
| H2 | `code fence holding a fence opener in a column` | `'::: columns\n```\n::: x\n```\n\|\|\|\nB\n:::'` |
| H3 | `long code fence holding a shorter one in a column` | `'::: columns\n````\n```\n````\n\|\|\|\nB\n:::'` |
| H4 | `tilde code fence holding a backtick fence in a column` | `'::: columns\n~~~\n```\n~~~\n\|\|\|\nB\n:::'` |
| H5 | `code fence left open in a column` | `'::: columns\nA\n\|\|\|\n```\nB\n:::'` |
| H6 | `html block holding a fence closer in a column` | `'::: columns\n<div>\n:::\n</div>\n\|\|\|\nB\n:::'` |
| H7 | `html block holding an escaped separator in a column` | `'::: columns\n<div>\n\\\|\|\|\n</div>\n\|\|\|\nB\n:::'` |

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**.

| # | Steps | Expected |
|---|---|---|
| M1 | Switch to source mode, enter `<div>`, `:::`, `</div>` on three lines, switch back. Put the caret in that block; right-click → Alignment → Center | the block shows as a centred paragraph of the three lines (no longer monospace); source mode shows `\<div>\`, `\:::\`, `\</div>` inside a `::: {align=center}` fence; no console error |
| M2 | Make a two-column region (right-click → Columns → 2) and type `Left` / `Right` in the columns. Drag from the middle of `Left` into `Right`, Ctrl/Cmd+C, click into a paragraph below the region, Ctrl/Cmd+V | the pasted text lands as plain paragraphs, with no column frame around it |
| M3 | Open the **Markdown** viewer demo with `::: columns` / a code block holding `:::` / `\|\|\|` / `B` / `:::` | two columns: the code block holding `:::`, then `B` |

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/markdown-editor-columns.test.ts tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts`: every row passes.
- `npx vitest run tests/component/markdown-roundtrip`: all harness checks and the edit fuzz pass.
- `npm test` (repo root): full suite green.
- `npm run lint` (repo root): zero errors.
- `grep -n 'inCode' packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`: no matches.
- `npm run docs:api` (repo root) finishes with zero warnings.
- Manual rows M1–M3.

---

## Documentation Impact

No public API changes: `markdownAttributes.ts`, `markdownExtensions.ts`,
`markdownSerializer.ts` and `markdownWritable.ts` are not re-exported from
any entry point.

- **`docs/components/Markdown.md`**
  - In the paragraph at [:75](../packages/lib/docs/components/Markdown.md#L75),
    after "fences nest, tracked by depth.", insert:
    ```markdown
    A fenced code block inside a fence is code: a `:::` or `|||` line in it neither opens, closes nor splits anything. The code block ends only at a line holding a run of its own fence character at least as long as its opening run and nothing else but fence characters, as `marked` reads it; like the `:::` and `|||` lines, a code-fence line counts at any indentation. A code block left open inside a fence hides the fence's closing line, so that fence is unclosed and renders as ordinary paragraphs. An HTML block is not tracked: a `:::` or `|||` line inside one still closes or splits the fence.
    ```
  - In the paragraph at [:126](../packages/lib/docs/components/Markdown.md#L126),
    replace "inside a nested `:::` fence, or inside a fenced code block, it is
    ordinary content." with "inside a nested `:::` fence, or inside a fenced
    code block (which ends only at its own closing fence, so a ```` ``` ````
    line inside a ```` ```` ```` block is still code), it is ordinary content."
- **`docs/components/MarkdownEditor.md`**
  - In the raw-block paragraph at [:80](../packages/lib/docs/components/MarkdownEditor.md#L80),
    after the sentence ending "…or a block is added after it.", insert:
    ```markdown
    A raw block in a `:::` column whose text holds a line the fence would read — a `:::` line, a `::: …` opener, a code fence it leaves open, or a `\|||` line — saves as a paragraph of the same text for the same reason, and the editor shows it as that paragraph: this is what an HTML block holding `:::` becomes when `setBlockAlignment` or `setColumnCount` wraps it, or when it is pasted or typed into a column.
    ```
  - In *What Markdown cannot hold*, after the **Tables.** bullet
    ([:94](../packages/lib/docs/components/MarkdownEditor.md#L94)), add:
    ```markdown
    - **Columns.** A `:::` column exists only inside its fence. Columns pasted anywhere else — a selection copied across two columns and pasted into a paragraph, another column or a table cell — become the blocks they hold, which is what the save writes.
    ```
- **`docs/reference/changelog/next.md`** → `## Fixed` → `### Components`:
  ```markdown
  - **`Markdown` reads code blocks inside a `:::` fence as code.** A `:::`
    line inside a fenced code block in a fence closed the fence early, and a
    `::: …` line there left it unclosed. A `|||` after a ```` ```` ```` code
    block holding a ```` ``` ```` line, or after a `~~~` block holding one,
    did not start a new column. Code fences now open and close as CommonMark
    reads them, and a `:::` or `|||` line inside code is code. `MarkdownEditor`
    loads these documents the same way. A code block left open inside a fence
    now hides the fence's closing line, so that fence renders as ordinary
    paragraphs; close the code block to keep the fence.

  - **`MarkdownEditor` saves `:::` columns as it shows them.** Wrapping a
    block in a fence with `setBlockAlignment` or `setColumnCount`, or pasting
    or typing into a column, could save a fence the viewer ended early or
    never closed: an HTML or other raw Markdown block holding a `:::` line, a
    `::: …` line or an unclosed code fence, and a code block holding an
    indented fence-like line. Such a raw block now saves, and shows, as a
    paragraph of the same text, and such a code block is written with a
    longer fence. Pasting a selection that spanned two columns left bare
    columns in the document, shown as raw blocks and saved as their contents;
    they now become the blocks they hold. No consumer action is needed.
  ```

---

## Potential Challenges

- **The stack tip moves before implementation.** Find each site by symbol
  (`BLOCK_EXTENSION`, `splitColumnSections`, `joinColumnSections`,
  `CODE_LINE_FENCE_RUN`, `$rawBlockWritesAsParagraph`,
  `registerWritableStateRules`), not by line number.
- **Worktree `node_modules`.** A fresh worktree needs `node_modules` and
  `packages/lib/node_modules` symlinked to the main tree's.
- **The escaped-separator test changed shape.** The old split unescaped
  only `^(\s*)\\\|\|\|$`; `"escaped-separator"` matches on the trimmed line,
  so `\|||` with trailing spaces now unescapes too. Join escapes such a line
  (its trimmed form is `|||`), so the two now agree; S4 and the existing
  split/join round-trip tests cover it.
- **Transform order in a table cell (P6).** P6 passes because the column
  transform unwraps the pasted columns before `$keepCellParagraphs` sees the
  cell. If P6 shows a paragraph nested in a paragraph, make
  `$keepCellParagraphs` call `$unwrapNode` on a `MarkdownColumnNode` child
  instead of replacing it.
- **`docs:api`.** The new exports live in a module no entry point
  re-exports; keep `{@link}`s to them inside internal JSDoc only.

---

## Critical Files

- [markdownAttributes.ts](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts): module header (L3–11), `COLUMN_SEPARATOR` (L49), `splitColumnSections` (L69), `joinColumnSections` (L129).
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts): `BLOCK_EXTENSION` (L124), its scan (L142–164).
- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `CODE_LINE_FENCE_RUN` (L161), `serializeRawBlock` (L1319), `$rawBlockWritesAsParagraph` (L1334, the precedent this plan extends), `runsOn` (L1347), `serializeCode` (L1425), `serializeFence` (L1857).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerWritableStateRules` (L60), `$keepCellParagraphs` (L248, the precedent for `$keepColumnInFence`), `registerRawBlockRules` (L332), `$showRawBlocksAsWritten` (L442).
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts): `MarkdownColumnNode` (L37), `MarkdownBlockNode`.
- [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts): `$buildFence` (L1033), which splits a fence with `splitColumnSections`.
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$wrapSelectedTopLevelBlocks` (L468), `setBlockAlignment` (L2811), `setColumnCount` (L2860) — read only.
- `packages/lib/tests/component/markdown-roundtrip/viewModel.ts`: `editorBlock` (L606) projects an unknown element, such as a stray column, as a raw block (L637).
- `packages/lib/tests/component/display/markdownLexer.test.ts` (`tokenAt`, `typesOf`, the fence describe at L197) and `packages/lib/tests/component/markdown-reference-links.test.ts` (test-file header).
- `plans/markdown-editor-command-crash-fixes.md`: its defect 1 owns `$wrapSelectedTopLevelBlocks`; its step 4 adds `@lexical/clipboard`.

---

## Non-Goals

- **Tracking HTML blocks in the fence scan.** A `:::` line inside an HTML block
  still closes the fence, for authored documents (H6). The editor never saves
  such a block in a column as raw text.
- **CommonMark indentation for fence lines.** A code-fence, `:::` or `|||` line
  counts at any indentation, as `:::` and `|||` lines already do.
- **A loaded column whose raw block is unbalanced alone but balanced by a later
  block** (an HTML block holding a ```` ``` ```` line, then a code block left
  open in the same column). After load the editor shows that raw block as a
  paragraph while an unedited save keeps it raw. The shape needs two
  unbalanced blocks in one column.
- **Rebuilding pasted columns into a fence.** They become plain blocks, as
  they save today.
- **Changing which blocks the wrap commands wrap** — owned by
  `markdown-editor-command-crash-fixes`.
- **The docs app's VitePress `:::` containers** (`packages/docs/src/content/containers.ts`),
  expanded before the dialect sees the page.
- **Fuzz hits outside columns** (tables, images, reference links).

---

## Notes

[^one-reader]: Today the three loops disagree. `BLOCK_EXTENSION` tracks no
    code at all (defect 1). `splitColumnSections` and `joinColumnSections`
    flip a boolean on any line that starts with ```` ``` ```` or `~~~` (defect
    2), so a ```` ``` ```` line inside a ```` ```` ```` block ends the code for
    them while `marked` keeps it as code. One reader shared by all three keeps
    the tokenizer's closing line, the split and the join on one rule.

[^fence-rule]: `marked` 18.0.9's `fences` rule opens on up to three spaces
    and a run of three or more backticks (whose info string holds no
    backtick) or tildes. It closes on up to three spaces, the opening run
    repeated (the rule's `\1`), any number of further fence characters, then
    spaces. Checked on the stack tip: ```` ```~ ```` and ```` ```` ```` close a
    ```` ``` ```` block; ```` ``` x ````, `~~~` and a four-space-indented
    ```` ``` ```` do not. The scan ignores indentation because it cannot know
    a line's container: a code block inside a list item in a column is
    indented by the item (CF10), and the dialect already reads `:::` and `|||`
    at any indentation. The serializer is changed so that it never writes the
    one shape where this differs from `marked` (the fence-length decision).

[^open-code]: The alternative was to close a code block left open at the
    fence's closing line, as CommonMark closes code at a container's end.
    The scan cannot know a fence is never closed until it reaches the end of
    the source, so it would need a second pass or a look-ahead per code-fence
    line, against the linear-time lexer rule (`markdown-lexer-linear-time`).
    The chosen rule matches what `marked` does with an unclosed code fence at
    the top level and what the tokenizer already does with an unclosed `:::`
    fence. The editor always writes closed code fences, so its saves never
    reach this case.

[^why-convert]: Two other remedies were rejected. Declining the wrap commands
    covers only `setBlockAlignment` / `setColumnCount`; paste, typing and a
    column-count shrink would still put such a block in a column. Teaching
    the fence scan HTML blocks and list items would change how authored
    documents read and needs `marked`'s block rules inside a line scan. The
    run-on rule already turns a raw block into the paragraph the save writes,
    with the same escaping, so the same mechanism keeps one rule for the
    editor and the docs.

[^triggers]: Checked in the prototype: the transform fires on a wrap (the
    new column is dirty), a paste of a raw block into a column (P5), and an
    edit of a raw block's text in a column (T1). No new registration is
    needed.

[^scan-not-lex]: `breaksColumn` reads the join with the same
    `readFenceLine` the tokenizer uses, so it answers exactly what the
    tokenizer would do, with no lexing and no cache. A column's tokens are
    `this.lexer.blockTokens(section)`, so when the split returns the content
    unchanged, the column reads as the content does alone. The last
    comparison catches a `\|||` line the split would unescape (BC4).

[^only-raw]: Every other block the serializer writes keeps a column intact.
    Paragraph, heading and list-item lines escape a leading `:`, `|`, `` ` ``
    and `~` (`LINE_START_ESCAPED`). Quote and table lines start with `>` or
    `|`. A code block's fence is balanced and outruns its content (defects 1–2
    and the fence-length change). A nested fence is balanced when its own
    columns are. Only a raw block is written verbatim.

[^fence-length]: Without this change, W8 still fails after defects 1–2 are
    fixed. The code text `    ````\n:::` is written with a ```` ``` ```` fence.
    `marked` reads the four-space-indented ```` ```` ```` as code, but the
    scan reads it as the closing fence, and the `:::` line then closes the
    `:::` fence. Counting runs at any indentation makes the fence
    ```` ````` ````. A top-level code block can get a longer fence than
    before (SC1); both forms read the same.

[^flatten]: The other option was to wrap a run of pasted columns in a new
    fence, keeping the copied layout. The save already writes the paste as
    its contents, and a selection across two columns copies text, not a
    layout. `$unwrapNode` is `@lexical/utils`' "replace this node with
    its children", the same move as `$unwrapMarkdownBlock`
    ([MarkdownEditor.ts:514](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L514)).
    Today the harness view model shows a stray column as a raw block
    (`viewModel.ts` L637), which is how the fuzz saw it.

[^prototype]: A prototype of the four source changes was applied to a
    detached copy of `4eccafcb`. Every row above passed on it; the "Today"
    values were taken with the same tests on the unchanged tip. The full
    Markdown suites (4,176 tests, the edit fuzz included) passed with the
    prototype and the H rows. The stack-review fuzz (corpus, generated and
    small documents; default and paste edit sets; seeds 601, 1709 and 2207,
    3,000 documents each) found 31 column-related `editParity` hits on the
    tip and none with the prototype; the three hits left in those runs are
    table and image defects.

## Implementation Notes

- **No per-step audit loop.** By the user's decision this run skipped
  `worker.md`'s audit step; the whole stack is checked by fuzzing instead
  (the stack fuzz harness, run/paste seeds 601, 1709, 2207, 3313, 4409,
  5521, 6607 and a new 7703 at n=3000; source mode 6719 and a new 7841 at
  n=4000).
- **Code drift reconciled.** Every site was found by symbol; line numbers
  had moved (`CODE_LINE_FENCE_RUN` and `$rawBlockWritesAsParagraph` sit
  further down after `markdown-editor-command-crash-fixes`). The planned
  code went in unchanged otherwise. The editor test file types the copied
  nodes as `Parameters<typeof $generateNodesFromSerializedNodes>[0]`:
  `BaseSerializedNode` is not exported from `@lexical/clipboard`'s entry.
- **One code commit, one docs commit.** The viewer and editor halves share
  `readFenceLine` and `breaksColumn` and the editor half needs the viewer
  half (W1, W2), so they are one functionality; the two changelog entries
  ride in the one docs commit.
- **Fuzz-found column defects outside the plan, fixed here** (each with a
  test written red first):
  - *An unedited paragraph opening a fence it does not close* (K1). With
    code fences tracked, `` ::: x … ``` … ::: `` loads as a paragraph and a code
    block (the open code hides the closer). The paragraph is then kept as
    source; an edit that removes the open code block, or pastes a raw block
    holding a `:::` line after it, made the save a fence the editor did not
    show. `writtenBlocks` now writes such a block in the standard form
    (`\::: x`) when what follows would close it (`fenceClosedAfter`, beside
    the existing `labelClosedAfter`; the two share `readsOtherwiseAfter`).
    The same class existed before (an unclosed `::: x` paragraph followed by
    a pasted HTML block holding `:::`), so this is not only a consequence of
    the new code rule.
  - *A block opened on a list item's marker line* (CF11, CF12, BC10–BC12,
    W9, W10). `` - ``` `` and `- ::: {…}` were not read as openers by the line
    scan, but the lines closing them, indented under the item, were: a list
    item starting with a code block in a column opened code at its closing
    line and swallowed the fence's closer, and a fence in a list item in a
    column closed the outer fence early. `readFenceLine` now reads openers
    after leading list markers (`LEADING_LIST_MARKERS`); closers and
    separators still need the bare line. An authored list item whose code
    block is left open (closed only by the item's end) now hides the closer,
    the same rule as any other open code block in a fence.
- **Fuzz result.** Column hits per run/paste seed, step-11 tip → this
  branch: 601 12→0, 1709 22→0, 2207 19→0, 3313 22→0 (the `canonical` and
  `canonicalIdempotence` hits included), 4409 15→0, 5521 16→0, 6607 28→0,
  7703 11→0; no throws. Source mode 6719 (81 hits) and 7841 (92) are
  unchanged and hold no column signature (their hits inside a fence are
  the empty-link `link|noEffect` seen outside fences too). The hits left
  (4409 one, 6607 six, 7703 one) reproduce outside any fence and belong to
  lower branches.
- **Manual checks M1–M3** were not run (headless session); W3, P2 and CF1
  pin the same behaviour.

### Stack fuzz round 4

Run at this branch after the round's fixes in lower branches (run and
paste seeds 601, 1709, 2207, 3313, 4409, 5521, 6607, 7703 and new 8819 and
9907, 3 000 documents per mode; source mode new seeds 8923 and 9931, 4 000
per mode): no run or paste signature left, and no column signature; the
source-mode signatures left are the harness's by-design ones. No case
belonged here. **Restacked twice onto the lower branches' fixes.**
`$rawBlockWritesAsParagraph` conflicted between this branch's
`breaksColumn` test and the importer branch's `rawBlockEnd` /
`$writesBlockAfter`: resolved as the union (a raw block that breaks its
column, or one that runs on before a block that writes something). The
source-preservation branch's new `OPEN_TITLE` filter conflicted with this
branch's `FENCE_OPENING_START` and its `readsOtherwiseAfter` refactor of
`labelClosedAfter`: both constants kept, `labelClosedAfter` written on
`readsOtherwiseAfter` with either filter. The changelog conflicted on the
crash-fixes branch's new ordered-list entry: both entries kept.
