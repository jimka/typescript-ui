---
depends-on: [markdown-demo-sample-table-width]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/tests/component/display/markdownLexer.test.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/tests/component/markdown-importer.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Raw Block HTML Tail Parity — Implementation Plan

## Overview

`MarkdownEditor` keeps Markdown it has no rich form for — an HTML block, a
thematic break — in a *raw block* (`MarkdownRawBlockNode`): monospace text,
saved exactly as typed. A raw block must show what its saved text means, so
the editor reads a raw block's text again after every edit.

The editor's reading of a raw block is wrong in one case. An HTML block
edited down to a tag name with nothing after it — `<div`, `</div`, `<pre` —
stays a raw block in the editor, but the `Markdown` viewer reads the save as
a paragraph, and so does the next load. The mismatch happens when the raw
block is the last block of the document or of a `:::` column.

| Step | Editor shows | Save | Viewer and reload read |
|---|---|---|---|
| load `a\n\n<div>` | paragraph, raw block | `a\n\n<div>` | paragraph, HTML block |
| Backspace over the `>` | paragraph, raw block `<div` | `a\n\n<div` | paragraph, **paragraph** `<div` |

The cause is in the lexer both sides share (`lexMarkdown`,
[`markdownExtensions.ts:589`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L589)).
`marked` 18.0.9 reads `<div` as the start of an HTML block only when a space,
a `>` or a line-end character follows the tag name. The end of the text does
not count, although CommonMark says it does. The editor reads a raw block's
text with a line end added
([`markdownImporter.ts:299`](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L299));
the save has none after the last block of a document or of a column.

This plan fixes the lexer: one wrapper around `marked`'s HTML tokenizer, in
`markdownExtensions.ts`, that reads the end of the text as a line end. The
viewer, the editor's load, the editor's raw-block reading and the editor's
`"source"` mode all go through that lexer, so they change together. No editor logic changes. The
rest is tests, one comment and the changelog. The plan lands on top of
`markdown-demo-sample-table-width`; line numbers are as of `4f68f3556`.

---

## Architecture Decisions

### The end of the input ends a line for an HTML block start

The *input* is the text one block-lexing call receives: the whole document,
one `:::` column's section, one list item's content or one blockquote's
content. An *HTML block start* is a line that opens an HTML block: `<` or
`</`, a block tag name, then a space, a `>`, a `/>` or the end of the line.

The lexer reads a tag name that ends the input as an HTML block start, exactly
as it reads the same line before a line end.[^commonmark][^marked-rule][^why-lexer]

| Source, nothing after it | Before | After | With a line end after it (unchanged) |
|---|---|---|---|
| `<div`, `</div`, `<h1`, `<li`, `<table` | paragraph | HTML block | HTML block |
| `<pre`, `<script`, `<style`, `<textarea` | paragraph | HTML block | HTML block |
| `<DIV`, `   <div` (up to three spaces) | paragraph | HTML block | HTML block |
| `<div `, `<div>`, `<!--`, `<?`, `<!D` | HTML block | HTML block | HTML block |
| `<span`, `<a`, `<divx`, `<` | paragraph | paragraph | paragraph |
| `    <div` (four spaces) | code | code | code |

### The fix is a wrapper in the dialect's tokenizer slots — mirrors `blockquoteWithSourceRaw`

A new function `htmlWithInputEndAsLineEnd` wraps `marked`'s own `html`
tokenizer. It goes in `DIALECT_BLOCK_TOKENIZERS`
([`markdownExtensions.ts:481`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L481)),
and the `html` guard in `BOUNDED_BLOCK_TOKENIZERS`
([`:528`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L528))
calls it instead of returning `false`.

The precedent is `blockquoteWithSourceRaw`
([`:459`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L459))
and `listWithOwnTaskMarker`
([`:362`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L362)).
Each corrects one `marked` defect by wrapping `Tokenizer.prototype.<rule>`,
and is called by `BOUNDED_BLOCK_TOKENIZERS` behind that rule's guard. Each
also sits in `DIALECT_BLOCK_TOKENIZERS`, which the *unbounded twin* installs
as is. The twin is `lexMarkdownUnbounded`, a test-only copy of the lexer
without the speed guards; tests assert that it and `lexMarkdown` produce the
same tokens.[^precedent]

### The wrapper retries only a one-line input

The wrapper calls `marked`'s tokenizer on the source. If `marked` returns no
token and the source holds no line end, the wrapper calls `marked` again with
a line end appended. A token from the second call gets its `raw` and `text`
set back to the source, so the lexer advances by exactly what the source
holds.[^one-line][^raw-reset]

| Remaining source | First call | Second call | Result |
|---|---|---|---|
| `<div>\nx` | HTML token | not made | `marked`'s token |
| `<div` | no token | on `<div\n`: HTML token | HTML token, `raw` and `text` `<div` |
| `<span` | no token | on `<span\n`: no token | no token (a paragraph follows) |
| `<divx\nmore` | no token | not made: the source holds a line end | no token |

### The change applies to every input, list items and blockquotes included

The wrapper is the HTML rule for every block list `marked` lexes, so all four
kinds of input change. A list item's content and a blockquote's content
reach the rule without their final line end, like a column's section.[^containers]

The viewer has no element for an HTML block. Its *fallback* prints the
block's text in a `<span>`, where a paragraph gets a `<p>`.

| Source | Viewer before | Viewer after | Editor before | Editor after |
|---|---|---|---|---|
| `a\n\n<div` | `<p>` `<div` | fallback text `<div` | paragraph | raw block |
| `::: columns\na\n\n<div\n\|\|\|\nb\n:::` | `<p>` `<div` in the first column | fallback text in the first column | paragraph in the first column | raw block in the first column |
| `- <div` | item text `<div` | item holding the fallback text | list | raw block `- <div` |
| `> <div` | quote paragraph `<div` | quote holding the fallback text | quote | raw block `> <div` |

A list or blockquote that holds an HTML block has no rich form in the editor
today: `- <div>` and `> <div>` already load as raw blocks. The round-trip
harness records such a case as a *known divergence* — the editor shows source
where the viewer renders the construct — under the ids `listItemBlocks` and
`quoteBlocks`. `- <div` and `> <div` now join them. Text typed into a list
item or quote is not affected: the serializer writes a typed `<div` as
`\<div`.

### The editor's raw-block rule does not change

`$showRawBlockAsItsBlocks`
([`markdownWritable.ts:573`](packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L573))
already reads an edited raw block's text again and shows the blocks that text
reads as. It reads the text with a line end after it. With the lexer fixed,
that reading equals the save's reading wherever the raw block stands, so no
transform, serializer or node changes.[^rule-unchanged]

The shapes an edited raw block can turn into, and what covers each:

| Raw block's text after the edit | Reads as | Editor shows | Covered by |
|---|---|---|---|
| `plain`, `<`, `<a`, `<di` | paragraph | paragraph | existing rule — pinned as controls |
| `# h` | heading | heading | existing rule — control |
| `- item`, `> q` | list, quote | list, quote | existing rule — control |
| ```` ``` ```` | code block | code block | existing rule — control |
| `[a]: /u` | link reference definition | raw block (the viewer shows nothing) | existing rule — control |
| `---` | thematic break | raw block | existing rule — control |
| `<!--`, `<?`, `<!D` (never closed) | HTML block that takes in what follows | raw block while last; a paragraph once a block follows | existing `$showRawBlocksAsWritten` — control |
| `<div`, `</div`, `<pre`, `<DIV`, `   <div` | HTML block | raw block | **this plan** (the lexer fix) |
| `- <div`, `> <div` | list or quote holding an HTML block | raw block | **this plan**; the viewer shows a list or quote (known divergence) |
| empty | nothing | an empty raw block that saves nothing | out of scope (see Non-Goals) |

### The harness checks edits inside Markdown source

The edit fuzz (`markdown-edit-fuzz.test.ts`) is the harness's seeded
random-edit test. Its `checkRelexes` skips the reload check when an edit
typed into a raw block, on the ground that the editor "shows as source until
it is loaded again". That ground is the opposite of the rule this plan relies
on. The skip and the `editedSource` flag that feeds it are removed.[^skip]

A new deterministic test in the same file sets a raw HTML block's text to
each shape listed under *The editor's raw-block rule does not change*, in
each position, and checks viewer parity, reload and save stability.

---

## Internal Structure

### `markdownExtensions.ts`

Add after `blockquoteWithSourceRaw` (which ends at line 472), before the
`DIALECT_BLOCK_TOKENIZERS` doc comment:

```ts
/** The line end `marked`'s HTML rule wants after a tag name that ends its line. */
const LINE_END = "\n";

/**
 * Runs `marked`'s HTML-block tokenizer, reading the end of the input as the
 * end of a line. `marked` 18's rule takes a block tag name (`<div`, `</div`,
 * `<pre`) as an HTML block start only when a space, a `>` or a line-end
 * character follows it, so the same line is an HTML block before a line end
 * and a paragraph as the last line of a document, a `:::` column, a list item
 * or a blockquote. CommonMark ends a line at the end of the input too. When
 * `marked` declines a one-line input, it is asked again with a line end after
 * it; a token it then returns is that line's, so its `raw` and `text` are set
 * back to the input. An input holding a line end is not asked again: the rule
 * already saw what follows the tag name there.
 *
 * @param src - The remaining source at the current block position.
 * @returns The HTML token, or `undefined` when no HTML block starts here.
 */
function htmlWithInputEndAsLineEnd(this: Tokenizer, src: string): Tokens.HTML | undefined {
    const token = Tokenizer.prototype.html.call(this, src);
    const oneLine = !src.includes(LINE_END);

    if (token !== undefined || !oneLine) {
        return token;
    }

    const ended = Tokenizer.prototype.html.call(this, src + LINE_END);

    if (ended === undefined) {
        return undefined;
    }

    return { ...ended, raw: src, text: src };
}
```

`DIALECT_BLOCK_TOKENIZERS` gains the fourth entry:

```ts
const DIALECT_BLOCK_TOKENIZERS: TokenizerObject = {
    blockquote: blockquoteWithSourceRaw,
    list:       listWithOwnTaskMarker,
    table:      dialectTable,
    html:       htmlWithInputEndAsLineEnd,
};
```

`BOUNDED_BLOCK_TOKENIZERS.html` keeps its guard and no window:

```ts
    html(src) {
        return HTML_START.test(src) ? htmlWithInputEndAsLineEnd.call(this, src) : undefined;
    },
```

### `markdown-edit-fuzz.test.ts` — the raw-block edit test

```ts
/** Documents holding one raw HTML block, each named by where that block stands. */
const RAW_BLOCK_POSITIONS: ReadonlyArray<readonly [string, string]> = [
    ['the last block of the document', 'a\n\n<div>\nw\n</div>'],
    ['the last block of a document ending in a line end', 'a\n\n<div>\nw\n</div>\n'],
    ['the only block', '<div>\nw\n</div>'],
    ['a block mid-document', 'a\n\n<div>\nw\n</div>\n\nb'],
    ['the last block of a column', '::: columns\na\n\n<div>\nw\n</div>\n|||\nb\n:::'],
    ['the last block of the last column', '::: columns\na\n|||\nb\n\n<div>\nw\n</div>\n:::'],
    ['the last block of a one-column fence', '::: {align=center}\na\n\n<div>\nw\n</div>\n:::'],
    ['a block mid-column', '::: columns\n<div>\nw\n</div>\n\na\n|||\nb\n:::'],
];

/** What an edit leaves of the raw block's text: HTML block starts first, then every other shape it can read as. */
const RAW_BLOCK_TEXTS: readonly string[] = [
    '<div', '<div ', '<div>', '</div', '</div>', '<pre', '<script', '<style', '<textarea', '<DIV', '   <div', '<h1', '<p',
    '<', '<a', '<a>', 'plain', '# h', '- item', '> q', '```', '[a]: /u', '---', '<!--', '<!-- x', '<?', '<!D', '',
    '<div\n</div', '<div>\nw\n</div', '<div>\nw\n</di', '<div>\nw\n<',
];

/**
 * Replaces a raw block's text as an edit leaves it: one text node per non-empty line, a line break between lines.
 *
 * @param block - The raw block.
 * @param text - Its new text.
 */
function $setRawBlockText(block: MarkdownRawBlockNode, text: string): void {
    block.clear();

    text.split('\n').forEach((line, index) => {
        if (index > 0) {
            block.append($createLineBreakNode());
        }

        if (line !== '') {
            block.append($createTextNode(line));
        }
    });
}

describe('raw block edits: a raw block shows what its save reads as, wherever it stands', () => {
    const cases = RAW_BLOCK_POSITIONS.flatMap(([position, source]) =>
        RAW_BLOCK_TEXTS.map((text) => [`${JSON.stringify(text)} as ${position}`, source, text] as const));

    it.each(cases)('RB. %s', (_title, source, text) => {
        const { editor } = loadAndSave(source);

        try {
            lexicalOf(editor).update(() => {
                const block = $dfs().map(({ node }) => node).filter($isMarkdownRawBlockNode)[0]!;

                $setRawBlockText(block, text);
            }, { discrete: true });

            const saved = editor.getValue();
            const context = `${JSON.stringify(text)} in ${JSON.stringify(source)}:\n${saved}`;
            const reloaded = loadAndSave(saved);

            expect(viewerModel(saved).blocks, context).toEqual(editorSurfaceModel(editor));
            expect(editorSurfaceModel(reloaded.editor), context).toEqual(editorSurfaceModel(editor));
            expect(reloaded.saved, context).toBe(saved);
            reloaded.editor.dispose();
        } finally {
            editor.dispose();
        }
    });
});
```

### `markdown-importer.test.ts` — the shape of an edit row

The edit rows use the helpers already in scope inside
`describe('$importMarkdown — whole-stack review fixes: edit-fuzz round', …)`:
`select` (line 1490), `edit` (1508) and `expectSaveShowsSurface` (1529).

```ts
it('HE1. an HTML block cut down to its tag name as the last block stays a raw block its save reads as', () => {
    const editor = load('a\n\n<div>');

    select(editor, ['<div>', 4], ['<div>', 5]);
    edit(editor, () => {
        lexicalOf(editor).dispatchCommand(DELETE_CHARACTER_COMMAND, true);
    });

    expect(rootTypes(editor)).toEqual(['paragraph', 'markdown-raw-block']);
    expect(rootTexts(editor)).toEqual(['a', '<div']);
    expect(editor.getValue()).toBe('a\n\n<div');
    expectSaveShowsSurface(editor);
});
```

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first; run commands from
`packages/lib`. Steps 1–5 write the tests; step 6 makes them pass; steps 7–9
finish the harness, the comment and the changelog. Line numbers are as of
the base commit: an insertion made earlier in the same file moves the lines
below it.

1. **`tests/component/display/markdownLexer.test.ts`** — after
   `describe('a blockquote\'s raw is the source it used', …)` (ends at line
   618), add
   `describe('an HTML block start ending its input reads as one before a line end', …)`
   with rows LX14–LX24 from *Expected Behaviour*. Use the file's own
   `typesOf` (line 518), `joinedRaws` (523) and `tokenAt` (44).
2. **`tests/component/display/Markdown.test.ts`** — after
   `describe('Markdown task-list items', …)` (ends at line 1319), add
   `describe('Markdown HTML block start ending its input', …)` with rows
   BF18–BF20. Use the file's own `textWriteTags` (line 48) and `textWrites`
   (36).
3. **`tests/component/markdown-importer.test.ts`**
   - Append at the end of the file
     `describe('$importMarkdown — an HTML block start ending its input (HT rows)', …)`
     with rows HT1–HT6. Use the top-level `load`, `rootTypes`, `rootTexts`
     and `expectSurface`.
   - Inside
     `describe('$importMarkdown — whole-stack review fixes: edit-fuzz round', …)`,
     right after
     `describe('a raw block edited until it reads as one block the editor holds shows as that block', …)`
     (ends at line 3572), add
     `describe('a raw block ending in an HTML block start reads the same where its input ends', …)`
     with rows HE1–HE13, in the shape shown under *Internal Structure*.
4. **`tests/component/markdown-roundtrip/corpus/dialect.ts`** — append the
   eight cases from *Expected Behaviour › Corpus* after the last entry (line
   130), before the closing `];`.
5. **`tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts`** — add
   the constants, `$setRawBlockText` and the `describe` from *Internal
   Structure* at the end of the file. Add `$createLineBreakNode` to the
   `lexical` import (line 2), and `type MarkdownRawBlockNode` to the existing
   `markdownSourceNodes` import (line 9), so no line below moves.

   Checkpoint: run
   `npx vitest run tests/component/display/markdownLexer.test.ts tests/component/display/Markdown.test.ts tests/component/markdown-importer.test.ts tests/component/markdown-roundtrip`.
   Exactly the rows marked **red** in *Expected Behaviour* fail. Every other
   test in those files passes.
6. **`src/typescript/lib/component/display/markdownExtensions.ts`**
   - Add `LINE_END` and `htmlWithInputEndAsLineEnd` as shown under *Internal
     Structure*.
   - Add `html: htmlWithInputEndAsLineEnd` to `DIALECT_BLOCK_TOKENIZERS`. In
     its doc comment (lines 474–480) change "The three block tokenizers" to
     "The four block tokenizers", "`blockquote`, `list` and `table` slots" to
     "`blockquote`, `list`, `table` and `html` slots", and "calls the same
     three" to "calls the same four".
   - Replace the body of `BOUNDED_BLOCK_TOKENIZERS.html` (line 529) as shown.
     In its doc comment change "(`blockquote` and `list` reach theirs through
     the dialect's wrappers)" (lines 491–492) to "(`blockquote`, `list` and
     `html` reach theirs through the dialect's wrappers)", and replace the
     sentence at lines 501–504 with: "`html` takes the guard only and calls
     the dialect's input-end wrapper on the whole source, because its
     `<script>`, comment, processing-instruction, declaration and CDATA forms
     all run to a closing marker no restart line bounds."
   - In `lexMarkdownUnbounded`'s doc comment (line 558) change "`table`,
     `blockquote` and `list` tokenizers" to "`table`, `blockquote`, `list`
     and `html` tokenizers".

   Checkpoint: the command from step 5 passes in full.
   `grep -n 'false : undefined' src/typescript/lib/component/display/markdownExtensions.ts`
   — expect zero matches.
7. **`tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts`** —
   remove the stale skip:
   - delete the `editedSource` field and its doc line from `EditRecord`
     (lines 58–59);
   - delete the `record.editedSource ||= …` statement (line 201);
   - drop `, editedSource: false` from the record literal (line 264);
   - change `if (known || run.record.editedSource) {` (line 290) to
     `if (known) {`;
   - replace the first sentence of `checkRelexes`'s doc comment (lines
     278–279, up to "…is no longer a thematic break).") with: "Checks that the
     save re-lexes to what the editor shows, also after an edit typed into
     Markdown source: a raw block shows the blocks its text reads as (`***`
     with a word after it shows as a paragraph)."

   No import becomes unused: `$isMarkdownSourceTextNode`,
   `$isMarkdownRawBlockNode` and `$findMatchingParent` each have another
   reader in the file.

   Checkpoint: `npx vitest run tests/component/markdown-roundtrip` passes.
   `grep -n 'editedSource' tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts`
   — expect zero matches.
8. **`src/typescript/lib/component/editor/markdownImporter.ts`** — comment
   only. In `$readRawBlockAsBlocks`'s doc comment (lines 286–287) replace
   "Reads a raw block's text where it stands — a line end after it, as a save
   writes it before the next block — and builds" with: "Reads a raw block's
   text with a line end after it, as a save writes it before the next block.
   The last block of a document or `:::` column may have none after it and
   reads the same: the lexer takes the end of its input as the line end an
   HTML block start needs. Builds".[^importer-comment]
9. **`docs/reference/changelog/next.md`** — add the entry from
   *Documentation Impact*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` (comment only) |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-importer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every row is testable offline, in the headless editor and the modelled DOM.
A row marked **red** fails before step 6; an unmarked row is a control that
already passes and must keep passing. One manual check (M1, under
*Verification*) confirms the same thing in the running demo.

Sources and values are written as they appear inside a JavaScript string
literal: `\n` is a line end and `\\<` is a backslash before `<`. Inside a
table cell a `|` is written `\|`, for the table's sake only.

### Lexer (`markdownLexer.test.ts`)

| # | Source | Expect | |
|---|---|---|---|
| LX14 | `<div` | one token: `type` `html`, `raw` `<div`, `text` `<div` | **red** |
| LX15 | each of `</div`, `<pre`, `<script`, `<style`, `<textarea`, `<DIV`, `   <div`, `<h1`, `<li` | `typesOf` is `['html']`; `joinedRaws` equals the source | **red** |
| LX16 | `a\n\n<div` | `typesOf` is `['paragraph', 'space', 'html']`; the last `raw` is `<div`; `joinedRaws` equals the source | **red** |
| LX17 | `<div\n` | one `html` token, `raw` `<div\n` | |
| LX18 | each of `<span`, `<a`, `<divx`, `<`, `<x-y` | `typesOf` is `['paragraph']` | |
| LX19 | `    <div` | `typesOf` is `['code']` | |
| LX20 | `::: columns\na\n\n<div\n\|\|\|\nb\n:::` | one `mdblock`; `columns[0]`'s token types are `paragraph`, `space`, `html` and its last `raw` is `<div`; `columns[1]`'s are `paragraph` | **red** |
| LX21 | `- <div\n- b`, then `> <div` | the list's first item's `tokens` hold one `html` token with `raw` `<div`, its second item's a `text` token; the blockquote's `tokens` hold one `html` token | **red** |
| LX22 | `a\n<div` | `typesOf` is `['paragraph']` (the tag name continues the paragraph; see Non-Goals) | |
| LX23 | every source of LX14–LX22 | `lexMarkdown(source)` equals `lexMarkdownUnbounded(source)` | |
| LX24 | every source of LX14, LX15 and LX18 | `typesOf(source)` equals `typesOf(source + '\n')` | **red** for LX14 and LX15's sources |

### Viewer (`Markdown.test.ts`, modelled DOM)

Each row renders `new Markdown(source).getElement(true)`.

| # | Source | Expect | |
|---|---|---|---|
| BF18 | `a\n\n<div` | `textWriteTags()` is `['P', 'SPAN']`; `textWrites()` is `['a', '<div']` | **red** |
| BF19 | `::: columns\na\n\n<div\n\|\|\|\nb\n:::` | `textWriteTags()` is `['P', 'SPAN', 'P']` | **red** |
| BF20 | `a\n\n<span` | `textWriteTags()` is `['P', 'P']` | |

### Importer — loading (`markdown-importer.test.ts`, HT rows)

| # | Source | Expect | |
|---|---|---|---|
| HT1 | `a\n\n<div` | `rootTypes` `['paragraph', 'markdown-raw-block']`; `rootTexts` `['a', '<div']`; `expectSurface(editor, source)`; `getValue()` equals the source | **red** |
| HT2 | `<div` | `rootTypes` `['markdown-raw-block']`; `getValue()` equals the source | **red** |
| HT3 | `::: columns\na\n\n<div\n\|\|\|\nb\n:::` | `rootTypes` `['markdown-block']`; `expectSurface(editor, source)`; the first column (`($getRoot().getFirstChild() as ElementNode).getFirstChild()`) has children of types `['paragraph', 'markdown-raw-block']` | **red** |
| HT4 | `- <div`, then `> <div` | `rootTypes` `['markdown-raw-block']`; `rootTexts` equals `[source]`; `getValue()` equals the source | **red** |
| HT5 | `a\n\n<span` | `rootTypes` `['paragraph', 'paragraph']` | |
| HT6 | `a\n<div` | `rootTypes` `['paragraph']` | |

### Importer — editing (`markdown-importer.test.ts`, HE rows)

Each row loads the source, selects the given range with `select`, and
dispatches `DELETE_CHARACTER_COMMAND` with `true` (Backspace), as HE1 shows
under *Internal Structure*. "Shows its save" means `expectSaveShowsSurface`.

| # | Source | Range deleted | Expect | |
|---|---|---|---|---|
| HE1 | `a\n\n<div>` | `['<div>', 4]`–`['<div>', 5]` | types `['paragraph', 'markdown-raw-block']`; texts `['a', '<div']`; value `a\n\n<div`; shows its save | **red** |
| HE2 | `::: columns\na\n\n<div>\n\|\|\|\nb\n:::` | same | value `::: columns\na\n\n<div\n\|\|\|\nb\n:::`; shows its save | **red** |
| HE3 | `::: columns\na\n\|\|\|\nb\n\n<div>\n:::` | same | value `::: columns\na\n\|\|\|\nb\n\n<div\n:::`; shows its save | **red** |
| HE4 | `a\n\n</div>` | `['</div>', 5]`–`['</div>', 6]` | types `['paragraph', 'markdown-raw-block']`; value `a\n\n</div`; shows its save | **red** |
| HE5 | `a\n\n<div>\nw\n</div>` | `['<div>', 4]`–`['</div>', 6]` | texts `['a', '<div']`; value `a\n\n<div`; shows its save | **red** |
| HE6 | HE1's result, then `insertText('>')` at the caret | — | types `['paragraph', 'markdown-raw-block']`; value `a\n\n<div>`; shows its save | |
| HE7 | `a\n\n<div>\n\nb` | `['<div>', 4]`–`['<div>', 5]` | types `['paragraph', 'markdown-raw-block', 'paragraph']`; value `a\n\n<div\n\n\nb`; shows its save | |
| HE8 | `a\n\n<div>\n` | same | types `['paragraph', 'markdown-raw-block']`; value `a\n\n<div\n`; shows its save | |
| HE9 | `a\n\n<div>` | `['<div>', 3]`–`['<div>', 5]` | types `['paragraph', 'paragraph']`; value `a\n\n\\<di`; shows its save | |
| HE10 | `a\n\n<div>` | `['<div>', 1]`–`['<div>', 5]` | types `['paragraph', 'paragraph']`; value `a\n\n<`; shows its save | |
| HE11 | `- <div>` | `['<div>', 4]`–`['<div>', 5]` | types `['markdown-raw-block']`; texts `['- <div']`; value `- <div`; `load(value).getValue()` equals the value and `rootTypes(load(value))` is `['markdown-raw-block']` | **red** |
| HE12 | `> <div>` | same | as HE11 with `> <div` | **red** |
| HE13 | `- a\n\n  <div>` | same | types `['markdown-raw-block']`; value `- a\n\n  <div`; `load(value).getValue()` equals the value | |

HE11–HE13 do not call `expectSaveShowsSurface`: the viewer shows a list or a
quote there, which is the known `listItemBlocks` / `quoteBlocks` divergence.

### Harness — edited raw blocks (`markdown-edit-fuzz.test.ts`, RB rows)

All 256 pairs of `RAW_BLOCK_POSITIONS` × `RAW_BLOCK_TEXTS` hold three checks:
the viewer's reading of the save equals what the editor shows, a reload shows
the same, and saving the reload changes nothing.

**Red**: the ten texts `<div`, `</div`, `<pre`, `<script`, `<style`,
`<textarea`, `<DIV`, `   <div`, `<h1`, `<p`, in the five positions "the last
block of the document", "the only block", "the last block of a column", "the
last block of the last column" and "the last block of a one-column fence" —
50 rows. The other 206 are controls.

### Corpus (`corpus/dialect.ts`)

```ts
    { name: 'html block start ending the document', source: 'a\n\n<div' },
    { name: 'html closing tag start ending the document', source: 'a\n\n</div' },
    { name: 'html block start ending the document before a line end', source: 'a\n\n<div\n' },
    { name: 'html block start ending a column', source: '::: columns\na\n\n<div\n|||\nb\n:::' },
    { name: 'html block start ending the last column', source: '::: columns\na\n|||\nb\n\n</div\n:::' },
    { name: 'html block start ending a list item', source: '- a\n- <div', known: { surface: 'listItemBlocks' } },
    { name: 'html block start ending a quote', source: '> <div', known: { surface: 'quoteBlocks' } },
    { name: 'tag name of no block ending the document', source: 'a\n\n<span' },
```

Every harness check and the edit fuzz hold for all eight, with `surface`
listed as known for the list and the quote case.[^corpus-red]

**Red**: `html block start ending the document before a line end` fails
`canonical`, `canonicalIdempotence` and its edit-fuzz row; the list and the
quote case fail `surface` with "now holds".

### Existing suites

Every existing test under `tests/component/display`,
`tests/component/markdown-roundtrip` and `tests/component/markdown*.test.ts`
passes unchanged after step 6. No existing test pins the old reading.

---

## Verification

- From `packages/lib`:
  `npx vitest run tests/component/display tests/component/markdown-roundtrip tests/component/markdown`
- From `packages/lib`: `npm run test`.
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`,
  `npm run docs:llms:check`.
- The two `grep` checkpoints in steps 6 and 7.
- Manual M1: `npm run dev` → **MD Editor**.
  1. Switch to source mode. Replace the text with three lines: `a`, an empty
     line, `<div>`. Leave no line after `<div>`.
  2. Switch to WYSIWYG. The `<div>` line shows monospace.
  3. Put the caret after the `>` and press Backspace. The line still shows
     monospace `<div`, and the viewer on the right shows `a` and `<div`.
  4. Switch to source mode and back. The `<div` line is still monospace.
     Before the fix it came back as an ordinary paragraph.
  5. Repeat with the source `::: columns`, `a`, an empty line, `<div>`, `|||`,
     `b`, `:::`.

---

## Documentation Impact

No public API changes. `markdownExtensions.ts` stays internal: nothing new
is exported from it.

No component page changes. Neither `docs/components/Markdown.md` nor
`docs/components/MarkdownEditor.md` states where an HTML block starts, and
both stay true: raw HTML renders through the fallback, and HTML blocks load
as raw Markdown blocks.

**`docs/reference/changelog/next.md`** — append to **Fixed › Components**,
after the "**Typing HTML in Markdown source no longer adds or re-indents
text.**" entry (starts at line 623) and before `### Core` (line 640):

```markdown
- **`Markdown` reads an HTML block start on a last line.** A block tag name
  with nothing after it — `<div`, `</div`, `<pre` — was an HTML block before
  a line end, but a paragraph as the last line of a document that ends
  without a line end, of a `:::` column, of a list item or of a blockquote.
  It is now an HTML block there too, as CommonMark specifies; `Markdown`
  shows its text either way. In `MarkdownEditor`, an HTML block edited down
  to such a line at the end of the document or of a column stayed a raw
  Markdown block while its save read as a paragraph, so it came back as a
  paragraph on the next load; the save now reads as the editor shows it. A
  list or blockquote whose item or content ends in such a line now loads as
  a raw Markdown block, as one holding `<div>` already did. No consumer
  action is needed.
```

---

## Potential Challenges

- **The retry must stay off multi-line input.** Calling `marked`'s rule a
  second time on a long remainder would double the lex's cost; the
  `oneLine` test keeps the second call to a single last line.
- **`BOUNDED_BLOCK_TOKENIZERS.html` must no longer return `false`.** `false`
  tells `marked` to run its own tokenizer, which skips the wrapper; return
  the wrapper's result.
- **The twin must share the wrapper.** Without the `html` entry in
  `DIALECT_BLOCK_TOKENIZERS`, LX23 and the 5,000-document twin test fail.
- **Corpus `known` ids must match the block kind.** The list case names
  `listItemBlocks`, the quote case `quoteBlocks`; a wrong id still passes
  the check but misfiles the reason.
- **`$setRawBlockText` runs inside the update.** The raw-block transform
  runs when that update ends, so read the document only after it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts)
  — the fix site. The precedents `listWithOwnTaskMarker` (:362) and
  `blockquoteWithSourceRaw` (:459), `DIALECT_BLOCK_TOKENIZERS` (:481),
  `BOUNDED_BLOCK_TOKENIZERS` (:512), and the column lexing in
  `BLOCK_EXTENSION` (:174–180).
- [`packages/lib/src/typescript/lib/component/editor/markdownImporter.ts`](packages/lib/src/typescript/lib/component/editor/markdownImporter.ts)
  — `$readRawBlockAsBlocks` (:298), which reads a raw block's text with a
  line end added.
- [`packages/lib/src/typescript/lib/component/editor/markdownWritable.ts`](packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — `registerRawBlockRules` (:532), `$showRawBlockAsItsBlocks` (:573) and
  `$showRawBlocksAsWritten` (:671): the existing rule that an edited raw
  block shows what its text reads as. Read only.
- [`packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts`](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts)
  — `serializeRawBlock` (:1589) and `documentEnd` (:1398): why the last
  block's text has no line end after it. Read only.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts)
  — the fallback arm (:1656) that prints an HTML block's text. Read only.
- [`packages/lib/tests/component/markdown-roundtrip/viewModel.ts`](packages/lib/tests/component/markdown-roundtrip/viewModel.ts)
  and [`harness.ts`](packages/lib/tests/component/markdown-roundtrip/harness.ts)
  — `viewerModel`, `editorSurfaceModel`, `loadAndSave`.
- [`plans/implemented/markdown-viewer-block-fixes.md`](plans/implemented/markdown-viewer-block-fixes.md)
  — the plan that introduced the wrapper pattern this one follows.
- `node_modules/marked/lib/marked.esm.js` — `Tokenizer.html` and the block
  rule `html`, version 18.0.9.

---

## Non-Goals

- **`marked`'s other HTML-block differences from CommonMark.** A tab after
  the tag name (`<div\tx`) is a paragraph, and `<div`, a blank line and text
  read as one HTML block (the serializer's `"wide"` case). Both read the
  same in every position, so the viewer and the editor agree on them.
- **A tag name on the last line of a paragraph.** `a\n<div` at the end of an
  input is one paragraph; with a line end after it, a paragraph and an HTML
  block. `marked`'s paragraph rule decides that, not its HTML rule. No raw
  block keeps such text: the editor shows it as a paragraph and a raw block.
- **Changing the editor's raw-block transforms or the serializer.** They
  are correct once the lexer is.
- **The empty raw block.** A raw block emptied by an edit stays, shows
  nothing and saves nothing, like an empty paragraph. Typing into it reads
  it again.
- **A rich form for a list or quote that holds an HTML block.** That is the
  existing `listItemBlocks` / `quoteBlocks` work.
- **Upgrading or patching `marked`.** The wrapper lives in the dialect, as
  the two earlier ones do.

---

## Addendum: How the bug was reproduced and the fix checked

The fix was simulated without editing source: a test setup file replaced
`Tokenizer.prototype.html` with the wrapper's body before any test module
loaded. Both `marked` instances reach that method, so the effect equals
registering the wrapper in the two tokenizer maps. The real wiring differs
and is what steps 5 and 6's checkpoints cover. The scratch tests and their
result files are kept outside the repository in
`/home/jika/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plan-raw-block-tail/`;
nothing there is needed to implement the plan.

| Check | Before | With the fix simulated |
|---|---|---|
| 32 raw-block texts × 8 positions (the RB rows) | 50 pairs fail: 10 texts × 5 input-end positions | 0 fail |
| 5,849 random raw-block texts × 7 positions | 48 texts fail only where their input ends; every one ends in `<div`, `</div`, `<li`, `<table`, `<h1`, `<pre`, `<script` or `<p` | 0 texts fail only where their input ends |
| The same 5,849 texts, failures not tied to where an input ends | 66 texts, each a raw list or quote the viewer renders as a list or quote | 71 texts of the same kind; reload and save stability hold for every one |
| 195,336 random sources, bounded lexer against the unbounded twin | identical | identical |
| The seeded table-edge fuzz that found the bug, strict mode, seeds 601 and 3313, 3,000 runs each | 2 failure signatures per seed, all a raw block ending in `<div` | 0 |
| Existing Markdown suites (4,655 tests) | pass | pass |
| The edit fuzz with its source-edit skip removed (330 tests) | pass | pass |

`marked` 18.0.9's readings, taken directly from its lexer:

| Source | Tokens |
|---|---|
| `<div` | `paragraph` |
| `<div\n` | `html` |
| `<div ` | `html` |
| `</div` | `paragraph` |
| `<pre` | `paragraph` |
| `<!--` | `html` |
| `- <div\n- b` | a list whose first item holds `text` `<div` |
| `- <div\n  x` | a list whose item holds `html` `<div\nx` |
| `> <div` | a blockquote holding `paragraph` `<div` |
| `> <div\n> b` | a blockquote holding `html` `<div\nb` |

---

## Notes

[^commonmark]: CommonMark 0.31.2, section 4.6. Start condition 6 is a line
    beginning `<` or `</`, one of the block tag names, then "a space, a tab,
    the end of the line, the string `>`, or the string `/>`". Start condition
    1 (`<pre`, `<script`, `<style`, `<textarea`) likewise accepts "the end of
    the line". A line ends at a line ending or at the end of the file, so a
    tag name that ends the document is an HTML block start.

[^marked-rule]: `marked` 18.0.9's block rule `html` writes the two start
    conditions as `<(script|pre|style|textarea)[\s>]` and
    `<\/?(address|…|ul)(?: +|\n|\/?>)`. Both demand a character after the tag
    name; neither has an end-of-input alternative. So `<div\n` matches and
    `<div` with nothing after it does not. The Addendum lists the observed
    tokens. The rule object is the same for `marked`'s `normal` and `gfm`
    rule sets.

[^why-lexer]: The editor's reading (with a line end) is the CommonMark one;
    the save's reading (without) is `marked`'s defect. Fixing the lexer makes
    one line mean one thing wherever it stands. Two other fix sites were
    considered and rejected. (1) Have the editor read a last raw block
    without the added line end and turn it into a paragraph. The result would
    depend on position and on whether the loaded file ended in a line end
    (`documentEnd` writes one only then), a transform would need that
    load-time fact, and the change could not be undone by typing: deleting the
    `>` of `<div>` would give a paragraph, and typing `>` again would give
    the escaped text `\<div>`, not the HTML block. (2) Have the serializer
    write a line end after such a raw block, as it does for its `"wide"`
    case. That changes the saved text (a final line end the file did not
    have, a blank line before `|||` or `:::`) to work around a wrong reading,
    and leaves the viewer wrong for hand-written documents.

[^precedent]: `markdown-viewer-block-fixes` introduced
    `DIALECT_BLOCK_TOKENIZERS` for this purpose: a `marked` defect is
    corrected in a dialect-owned wrapper, the bounded instance and the
    unbounded twin both install it, and the editor follows with no importer
    change because it lexes through `lexMarkdown`. This plan adds a third
    wrapper of the same shape. The `html` slot in `BOUNDED_BLOCK_TOKENIZERS`
    currently returns `false`, which tells `marked` to run its own
    tokenizer; calling the wrapper there is the same as what `blockquote`
    and `list` do with theirs.

[^one-line]: An appended line end can only change the rule's answer when it
    becomes the character right after the tag name. That needs the source to
    be the tag line alone. Every other alternative of the rule (comments,
    processing instructions, declarations, CDATA, a complete tag) already
    accepts the end of the input. So "the source holds no line end" is the
    exact condition, not an approximation. It also bounds the cost: the
    second call runs at most once per input, on one line, so the lex stays
    linear and the scan-count test in `markdownLexer.test.ts` is unaffected.

[^raw-reset]: The second call's match always runs to the end of what it was
    given: the rule's body is lazy up to a blank line or the end of the
    input, and a one-line source has neither before its end. So the token's
    `raw` is the source plus the appended line end, and cutting it back to
    the source is exact. The lexer advances by `raw.length`; leaving the
    appended character in `raw` would make it advance past the source's end.

[^containers]: `marked` lexes a list item's and a blockquote's content with
    their final line end stripped, so `- <div` holds `text` while
    `- <div\n  x` holds `html`: the same inconsistency as at the end of a
    document. Restricting the fix to documents and columns was considered
    and rejected. The wrapper cannot tell which input it is in, so that
    would need shared state set by the list and blockquote wrappers, written
    only to keep `marked`'s defect alive in two places. The cost of applying
    it everywhere is that a list or quote whose item or content ends in a
    bare block tag name loads as a raw block where it loaded as a list or
    quote. That already happens for `- <div>`, and the editor never writes
    such text itself: a typed `<` before a letter is saved as `\<`.

[^rule-unchanged]: Checked by setting a raw block's text to 5,849 random
    Markdown strings in seven positions with the fix simulated. No text
    failed only where its input ends. The texts that still differ from the
    viewer are raw lists and quotes, wherever they stand, and each of them
    reloads to the same raw block. See the Addendum.

[^skip]: With the skip removed, the edit fuzz's 330 tests pass on the base
    and with the fix simulated, so the skip no longer guards anything. Its
    own example is out of date: `***` with a word appended is a raw block
    that reads as a paragraph, and `$showRawBlockAsItsBlocks` shows it as
    one. The flag `editedSource` has no other reader.

[^importer-comment]: The doc comment says a raw block's text is read "where
    it stands — a line end after it". That was the false assumption behind
    the bug: the last block has none. The new wording says why reading with
    one is still right.

[^corpus-red]: The first, second, fourth, fifth and eighth case hold every
    check before the fix too, because the viewer and the editor then agree
    on a paragraph. They are in the corpus so the edit fuzz covers them and
    so the new reading is pinned. The lexer, viewer and importer rows are
    what turns red for that reading.
