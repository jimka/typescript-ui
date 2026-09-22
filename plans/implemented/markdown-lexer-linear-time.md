---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Lexer Linear Time — Implementation Plan

## Overview

A `MarkdownViewer.setMarkdown` takes 182 ms on a 60-section document and 4,219 ms on a 480-section one in WebKitGTK — 23.2× the time for 8× the document ([W3.0 record](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L349), cells `mdu` and `mdu480`). Offline profiling puts almost all of it in lexing. In JavaScriptCore, the engine WebKitGTK runs, one call of `lexMarkdown` ([markdownExtensions.ts:202](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L202)) on that document costs about 38 ms at 60 sections and about 2,000 ms at 480. The viewer lexes the same source twice per update, so lexing is over 90% of the 4,219 ms.[^profile]

Each lex is quadratic for two separate reasons:

1. **The library's two block extensions split the whole remaining source into lines at every block position.** `TABLE_EXTENSION` ([markdownTableExtension.ts:168](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L168)) and `BLOCK_EXTENSION` ([markdownExtensions.ts:128](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L128)) each build a line array of everything left in the document, only to look at its first line or two. This is quadratic in every engine.
2. **Six of marked's own block rules scan the whole remaining source in JavaScriptCore.** marked hands its `hr`, `blockquote`, `list`, `html`, `table` and `lheading` tokenizers the entire rest of the document at every block position. Five of them run an anchored regex that JavaScriptCore's regex engine does not stop at the `^` anchor for, and `list` runs the `hr` regex once per item: each failed match costs time in proportion to the input's length. So marked alone is quadratic in WebKit (about 35 → 1,850 ms from 60 to 480 sections) while linear in V8 (0.9 → 5.4 ms).

This plan makes every lex linear and leaves every token byte-identical; a prototype of it lexes the 480-section document in 15 ms in JavaScriptCore. The two extensions read only the lines they inspect. The six built-in tokenizers are wrapped through marked's own per-instance `tokenizer` option, so each is skipped unless the current line could start its construct, and otherwise sees only a bounded window of the source. Separately, `Markdown.clearContent` untracks its handles one `splice` at a time, which is quadratic in the element count; `Component` gains a one-pass `untrackHandles` for it. The rendered DOM, every DOM write and all geometry stay the same.

---

## Architecture Decisions

### The fix targets lexing, which the profile found

`lexMarkdown` and the handle bookkeeping in `clearContent` are the only parts of `update` that grow faster than the document. The render walk, the DOM writes, the minimap and the layout pass all grow linearly or not at all.[^profile]

### The two extensions read only the lines they inspect

`TABLE_EXTENSION` reads its header, delimiter and body lines one at a time with `indexOf("\n")`, stopping at the first blank line. `BLOCK_EXTENSION` reads its opening line, declines unless it opens a fence, and walks lines until the matching close. Everything after the line walk is unchanged, and neither extension gains a `start()` hook.[^no-start]

The precedent is in the same file: the three inline extensions ([markdownExtensions.ts:28](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L28), [:57](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L57), [:84](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L84)) match an anchored regex at the current position and never read past their construct.

### Six built-in block tokenizers run behind a guard and a window

The scoped `Marked` instance ([markdownExtensions.ts:185](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L185)) gains marked's documented `tokenizer` option. It is an object whose methods replace the instance's tokenizer methods; a method that returns `false` makes marked run the original on the same input. A *guard* is a cheap check near the current position that must hold for the construct to start there. For `hr`, `blockquote`, `list`, `table` and `lheading`, the override:

1. returns `undefined` — no token here — when its guard fails;
2. otherwise returns marked's original method, `Tokenizer.prototype.<name>`, called on `blockWindow(src)` — the *window*, defined in the next decision — instead of `src`.

`html` gets the guard only: when it passes, the override returns `false` and marked runs the original on the whole source.[^html-full]

| Tokenizer | Guard | Input when the guard passes |
|---|---|---|
| `hr` | `/^ {0,3}[-*_]/` matches `src` | `blockWindow(src)` |
| `blockquote` | `/^ {0,3}>/` matches `src` | `blockWindow(src)` |
| `list` | `/^ {0,3}(?:[*+-]\|\d{1,9}[.)])(?:[ \t\n]\|$)/` matches `src` | `blockWindow(src)` |
| `table` | the second line exists and contains `-` | `blockWindow(src)` |
| `lheading` | some line after the first, before the first whitespace-only line, matches `/^ {0,3}(?:=+\|-+) *$/` | `blockWindow(src)` |
| `html` | `/^ {0,3}</` matches `src` | all of `src` (the override returns `false`) |

Each guard is a condition the rule's own regex requires, so a failed guard only skips a match that could not happen.[^guards] This mirrors how `markdownExtensions.ts` already extends marked: through the scoped instance's own options, never through marked's shared default instance or its module-level rule objects.[^no-shared-rules]

### The window stops before the first restart line

`blockWindow(src)` returns `src` cut just before its first **restart line**, or all of `src` when it has none. A restart line:

- follows an empty line or a line of spaces only;
- is not itself empty or spaces-only;
- starts at column 0 — its first character is neither a space nor a tab;
- is not a list-item marker line, `/^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/`.

None of the five windowed constructs can continue onto a restart line, so marked's original method returns the same token for the window as for the whole source.[^window-sound]

| `src` (`↵` is a newline) | Window ends before | Why |
|---|---|---|
| `- a↵↵- b↵↵  more↵↵Next↵` | `Next` | `- b` is a marker line and `  more` is indented, so neither is a restart line; `Next` is |
| `> q↵lazy↵↵> r` | `> r` | column 0, after an empty line, and not a marker |
| `Title↵===↵   ↵Body` | `Body` | a spaces-only line counts as blank |
| `- a↵↵* b` | nothing: the window is all of `src` | `* b` is a marker line, and a list can continue onto it |
| `x↵\t↵y` | nothing | a tab-only line is not spaces-only |

### Identical tokens is the gate, checked against an unbounded twin

A committed differential test compares `lexMarkdown` with `lexMarkdownUnbounded` over generated, hand-written and seeded-random documents. `lexMarkdownUnbounded` lexes with the same extension list on a second scoped instance that has no tokenizer overrides. It is an `@internal` test hook, not re-exported from the barrel, as `mapFenceLangToEditorId` and `headingSelector` are in `Markdown.ts` ([Markdown.ts:2302-2308](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2302)).[^twin]

The twin cannot check the rewrite of the two extensions, since it shares them. That rewrite is pinned by direct token cases, by the existing `Markdown` suites, and by a one-off comparison against the base commit's own lexer (step 1 and step 10). The whole design passed that comparison before this plan was written.[^prevalidated]

### The complexity test counts characters scanned, not time

The test counts every character handed to the six rules' regexes, plus every character of a string split whole with `split("\n")`, during one lex. It then requires 8× the document to cost at most 10× the characters. The count is deterministic, needs no timer, and is the quantity JavaScriptCore pays for.[^meter]

### `clearContent` untracks its handles in one pass

`Component` gains `protected untrackHandles(handles)`, which removes every listed handle from the owned-handle list in a single in-place pass. `Markdown.clearContent` calls it once, instead of calling `untrackHandle` per element — each call an `indexOf` and a `splice` over a list thousands long.[^untrack] It mirrors `untrackHandle` ([Component.ts:1354](packages/lib/src/typescript/lib/core/Component.ts#L1354)) and the bulk release loop in `destructor` ([Component.ts:1299-1303](packages/lib/src/typescript/lib/core/Component.ts#L1299)).

### Only the lexer and the rebuild are in scope

The viewer-resize half of G26 and the viewer's second lex of the same source stay out; see *Non-Goals*.[^scope]

---

## Public API

```typescript
// core/Component.ts — protected, so excluded from the API docs.
// Removes every occurrence of each listed handle from the owned-handle list,
// keeping the order of the rest. Handles not tracked are ignored.
protected untrackHandles(handles: readonly Handle[]): void;

// component/display/markdownExtensions.ts — module exports, not in the barrel.
export function lexMarkdown(source: string): Token[];          // signature unchanged
/** @internal Test-only reference lexer: the same dialect, with no block-rule guards or windows. */
export function lexMarkdownUnbounded(source: string): Token[];

// component/display/markdownAttributes.ts — module export, not in the barrel.
// The index of the "\n" ending the line that starts at `start`, or `src.length` for the last line.
export function lineEndAt(src: string, start: number): number;
```

---

## Internal Structure

### `TABLE_EXTENSION` — the new line walk

Replaces [markdownTableExtension.ts:167-200](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L167), from `tokenizer(src) {` through `const raw = …`. Everything from `const header: MdTableHeaderCell[] = …` on stays as it is.

```typescript
tokenizer(src) {
    const headerEnd = src.indexOf("\n");

    if (headerEnd === -1) {
        return undefined;
    }

    const delimiterEnd = lineEndAt(src, headerEnd + 1);
    const delimiter = parseDelimiterRow(src.slice(headerEnd + 1, delimiterEnd));

    if (delimiter === null) {
        return undefined;
    }

    const headerCells = splitRow(src.slice(0, headerEnd));
    const columnCount = headerCells.length;

    if (delimiter.align.length !== columnCount) {
        return undefined;
    }

    const bodyLines: string[] = [];
    let consumedEnd = delimiterEnd;

    while (consumedEnd < src.length) {
        const lineStart = consumedEnd + 1;
        const lineEnd = lineEndAt(src, lineStart);
        const line = src.slice(lineStart, lineEnd);

        if (line.trim() === "") {
            break;
        }

        bodyLines.push(line);
        consumedEnd = lineEnd;
    }

    const raw = src.slice(0, consumedEnd);
    // … unchanged from here
```

### `BLOCK_EXTENSION` — the new line walk

Replaces [markdownExtensions.ts:127-168](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L127), from `tokenizer(src) {` through `const inner = …`. The `return { type: "mdblock", … }` block stays as it is.

```typescript
tokenizer(src) {
    const openingEnd = lineEndAt(src, 0);
    const firstLine = src.slice(0, openingEnd).trim();

    if (!firstLine.startsWith(":::")) {
        return undefined;
    }

    const openingRemainder = firstLine.slice(3).trim();

    // A bare ":::" with nothing to open is a stray closer, not an opener.
    if (openingRemainder === "") {
        return undefined;
    }

    let depth = 1;
    let closingStart = -1;
    let lineEnd = openingEnd;

    while (lineEnd < src.length) {
        const lineStart = lineEnd + 1;

        lineEnd = lineEndAt(src, lineStart);

        const trimmed = src.slice(lineStart, lineEnd).trim();

        if (trimmed === ":::") {
            depth -= 1;

            if (depth === 0) {
                closingStart = lineStart;

                break;
            }
        } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
            depth += 1;
        }
    }

    // No matching close anywhere in the remaining source: decline
    // entirely, so the lines fall through to ordinary paragraphs.
    if (closingStart === -1) {
        return undefined;
    }

    const raw = src.slice(0, lineEnd);
    const inner = src.slice(openingEnd + 1, closingStart - 1);
    // … unchanged `return { type: "mdblock", … }`
```

After the `break`, `lineEnd` is the end of the closing line, so `raw` runs through it. When the closing line directly follows the opening line, `closingStart - 1` equals `openingEnd`, and `inner` is `""`, as `lines.slice(1, 1).join("\n")` was.

### The bounded tokenizers

In `markdownExtensions.ts`, after `BLOCK_EXTENSION`. `Tokenizer` is marked's exported class; its prototype still holds the original methods, because marked installs the overrides as own properties on the instance's tokenizer object. Call each original through `Tokenizer.prototype`, as written.

```typescript
/** An empty line or a line of spaces only: none of the windowed constructs continues past one. */
const SPACES_ONLY_LINE = /^ *$/;

/** A column-0 list-item marker line: a list may continue onto one across a blank line. */
const LIST_MARKER_LINE = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/;

function blockWindow(src: string): string {
    let lineStart = 0;
    let previousBlank = false;

    while (lineStart < src.length) {
        const lineEnd = lineEndAt(src, lineStart);
        const line = src.slice(lineStart, lineEnd);
        const blank = SPACES_ONLY_LINE.test(line);

        if (previousBlank && !blank && !line.startsWith(" ") && !line.startsWith("\t") && !LIST_MARKER_LINE.test(line)) {
            return src.slice(0, lineStart);
        }

        previousBlank = blank;
        lineStart = lineEnd + 1;
    }

    return src;
}

const HR_START         = /^ {0,3}[-*_]/;
const BLOCKQUOTE_START = /^ {0,3}>/;
const LIST_START       = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t\n]|$)/;
const HTML_START       = /^ {0,3}</;
const SETEXT_UNDERLINE_LINE = /^ {0,3}(?:=+|-+) *$/;
const WHITESPACE_ONLY_LINE  = /^\s*$/;

function secondLineHasDash(src: string): boolean {
    const firstEnd = src.indexOf("\n");

    return firstEnd !== -1 && src.slice(firstEnd + 1, lineEndAt(src, firstEnd + 1)).includes("-");
}

function hasSetextUnderline(src: string): boolean {
    let lineEnd = lineEndAt(src, 0);

    while (lineEnd < src.length) {
        const lineStart = lineEnd + 1;

        lineEnd = lineEndAt(src, lineStart);

        const line = src.slice(lineStart, lineEnd);

        if (WHITESPACE_ONLY_LINE.test(line)) {
            return false;
        }

        if (SETEXT_UNDERLINE_LINE.test(line)) {
            return true;
        }
    }

    return false;
}

const BOUNDED_BLOCK_TOKENIZERS: TokenizerObject = {
    hr(src) {
        return HR_START.test(src) ? Tokenizer.prototype.hr.call(this, blockWindow(src)) : undefined;
    },
    blockquote(src) {
        return BLOCKQUOTE_START.test(src) ? Tokenizer.prototype.blockquote.call(this, blockWindow(src)) : undefined;
    },
    list(src) {
        return LIST_START.test(src) ? Tokenizer.prototype.list.call(this, blockWindow(src)) : undefined;
    },
    table(src) {
        return secondLineHasDash(src) ? Tokenizer.prototype.table.call(this, blockWindow(src)) : undefined;
    },
    lheading(src) {
        return hasSetextUnderline(src) ? Tokenizer.prototype.lheading.call(this, blockWindow(src)) : undefined;
    },
    html(src) {
        return HTML_START.test(src) ? false : undefined;
    },
};
```

Every constant, helper and override gets its own JSDoc stating what it is and why, per CODE_CONVENTIONS.md; the one-line comments above are placeholders for them. Each guard's JSDoc names the rule it is read from, and `blockWindow`'s restates the four conditions of a restart line.

### The instances

Replaces [markdownExtensions.ts:185-189](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L185):

```typescript
/** The dialect's extensions, shared by the bounded instance and its unbounded test twin so they cannot drift. */
const MARKDOWN_EXTENSIONS: TokenizerExtension[] = [
    UNDERLINE_EXTENSION, STYLED_SPAN_EXTENSION, TABLE_EXTENSION, BLOCK_EXTENSION, IMAGE_EXTENSION,
];

const _marked = new Marked({ extensions: MARKDOWN_EXTENSIONS, tokenizer: BOUNDED_BLOCK_TOKENIZERS });

/** Created on first use: production code never lexes through it. */
let _unboundedMarked: Marked | null = null;

export function lexMarkdownUnbounded(source: string): Token[] {
    _unboundedMarked ??= new Marked({ extensions: MARKDOWN_EXTENSIONS });

    return _unboundedMarked.lexer(source);
}
```

`lexMarkdown` keeps its body, `return _marked.lexer(source);`. Its JSDoc gains one sentence: the six block rules run behind a guard and a window, and the output equals the unbounded lexer's.

### `Component.untrackHandles`

After `untrackHandle` in [Component.ts](packages/lib/src/typescript/lib/core/Component.ts#L1354). The list must be compacted in place: the GC finalizer registered in `trackHandle` holds this same array ([Component.ts:1319](packages/lib/src/typescript/lib/core/Component.ts#L1319)).

```typescript
protected untrackHandles(handles: readonly Handle[]): void {
    if (handles.length === 0) {
        return;
    }

    const dropped = new Set(handles);
    let kept = 0;

    for (const handle of this._ownedHandles) {
        if (!dropped.has(handle)) {
            this._ownedHandles[kept] = handle;
            kept += 1;
        }
    }

    this._ownedHandles.length = kept;
}
```

### `Markdown.clearContent`

[Markdown.ts:1168-1174](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1168) becomes:

```typescript
for (const handle of this._contentHandles) {
    DOM.sink.removeElement(handle);
    DOM.sink.release(handle);
}

this.untrackHandles(this._contentHandles);
this._contentHandles.length = 0;
```

The sink sees the same `removeElement` / `release` sequence as before; untracking touches no DOM.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/` unless they start with `packages/` or `plans/`. Work test-first: each test below is written, and seen to fail where it says so, before the code that makes it pass.

1. **Record the base lexer's output.** Before touching any source, create the throwaway file `tests/component/display/markdownLexer.corpus.tmp.test.ts` as specified in *Addendum: The Corpus Comparison*, and run `npx vitest run tests/component/display/markdownLexer.corpus.tmp.test.ts` with `CORPUS_MODE=record`. Check: it prints the number of documents hashed (about 3,500 files counting both line endings, plus 20,000 generated) and writes the hash file.
2. **Twin and extension list.** In `src/typescript/lib/component/display/markdownExtensions.ts`, add `MARKDOWN_EXTENSIONS`, pass it to `_marked`, and add `lexMarkdownUnbounded` (*Internal Structure → The instances*, without the `tokenizer` option yet). Check: `npm run typecheck` is clean.
3. **The lexer test file.** Create `tests/component/display/markdownLexer.test.ts` with Expected Behaviour cases 1–20. Check: cases 1–18 pass (they pin today's tokens); cases 19 and 20 — the complexity bounds — fail, with the values given there.
4. **`lineEndAt`.** Add it to `src/typescript/lib/component/display/markdownAttributes.ts`, after `joinColumnSections`, with its JSDoc.
5. **`TABLE_EXTENSION`.** Rewrite its line walk in `src/typescript/lib/component/display/markdownTableExtension.ts` (*Internal Structure*), importing `lineEndAt`. Check: `grep -n 'split("\\n")' src/typescript/lib/component/display/markdownTableExtension.ts` — zero matches; `npx vitest run tests/component/display` passes.
6. **`BLOCK_EXTENSION`.** Rewrite its line walk in `markdownExtensions.ts`, importing `lineEndAt`. Check: `grep -n 'src.split' src/typescript/lib/component/display/markdownExtensions.ts` — zero matches; case 20 now passes; `npx vitest run tests/component/display tests/component/markdown-editor.test.ts` passes.
7. **The bounded tokenizers.** Add `blockWindow`, the guards, the two helpers and `BOUNDED_BLOCK_TOKENIZERS` to `markdownExtensions.ts`; import `Tokenizer` and the type `TokenizerObject` from `"marked"`; pass `tokenizer: BOUNDED_BLOCK_TOKENIZERS` to `_marked` only. Check: cases 1–20 pass.
8. **`Component.untrackHandles`.** Write `tests/core/ComponentTrackedHandles.test.ts` with cases 21–23 (red), then add the method to `src/typescript/lib/core/Component.ts`. Check: green.
9. **`Markdown.clearContent`.** Add case 24 to `tests/component/display/markdownLexer.test.ts` — it passes before and after, and pins the bookkeeping the change must keep — then change `clearContent` in `src/typescript/lib/component/display/Markdown.ts`. Check: `grep -n 'untrackHandle(handle)' src/typescript/lib/component/display/Markdown.ts` — one match, in `applyCodeEditorUpgrade` only.
10. **Compare against the base.** Run the corpus file with `CORPUS_MODE=compare`. Check: it reports zero mismatches. Then delete `tests/component/display/markdownLexer.corpus.tmp.test.ts` and the hash file; neither is committed.
11. **Changelog.** Add the entry in *Documentation Impact* to `packages/lib/docs/reference/changelog/next.md`.
12. **Full checks.** Run everything in *Verification → Offline*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Create | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Create | `packages/lib/tests/core/ComponentTrackedHandles.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create, then delete (step 10) | `packages/lib/tests/component/display/markdownLexer.corpus.tmp.test.ts` |

---

## Expected Behaviour

Cases 1–24 are unit tests; the in-engine readings are in *Verification*. Sources are JavaScript string literals. "Tokens" means `lexMarkdown`'s return value, and `raw` a token's `raw`. marked appends a single newline that follows a block to that block's `raw`, which cases 3 and 6 show.

**The table extension** (unit, `markdownLexer.test.ts`):

1. `'| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter'` — token 0 is an `mdtable` with `raw` `'| a | b |\n| --- | --- |\n| 1 | 2 |'` and one body row of texts `1`, `2`; then a `space` token (`raw` `'\n\n'`) and a `paragraph` with text `after`.
2. `'| a | b |\n| --- | --- |\n| 1 | 2 |'` — one `mdtable` whose `raw` is the whole source.
3. `'| a | b |\n| --- | --- |\n'` — one `mdtable` with `raw` `'| a | b |\n| --- | --- |\n'` and no body rows.
4. `'| a |\n| - |\n| 1 |\n   \nnext'` — the body stops at the spaces-only line: `raw` `'| a |\n| - |\n| 1 |'`, then a `space` token `'\n   \n'` and a `paragraph` `next`.
5. `'| a | b |'` and `'| a | b |\n| --- |'` (two headers, one delimiter) — no `mdtable`; each is one `paragraph`.

**The fence extension** (unit):

6. `'::: {align=center}\ntext\n:::\nafter'` — token 0 is an `mdblock` with `raw` `'::: {align=center}\ntext\n:::\n'`, attributes `{ align: "center" }` and one column holding one `paragraph` `text`; token 1 is a `paragraph` `after`.
7. `'::: {a=1}\n::: {b=2}\nx\n:::\n:::'` — one outer `mdblock` (its `raw` is the whole source) whose single column holds one inner `mdblock` with `raw` `'::: {b=2}\nx\n:::'`.
8. `'::: {a=1}\ntext'` (no close) and `':::\ntext\n:::'` (a bare opener) — no `mdblock`; each is one `paragraph`.
9. `'::: {a=1}\n:::'` — an `mdblock` with one column and no tokens in it (`columns` is `[[]]`).

**The bounded tokenizers: identical to the unbounded twin** (unit; each case asserts `expect(lexMarkdown(src)).toEqual(lexMarkdownUnbounded(src))`):

10. A loose list continuing across blank lines: `'- a\n\n- b\n\n  more\n\nNext\n'` — and, as its own assertion, token 0 is a `list` with `raw` `'- a\n\n- b\n\n  more'` and the last token is a `paragraph` `Next`.
11. Ordered lists: `'1. a\n\n2) b\n\n10. c\n\nnext'`.
12. Setext headings: `'Title\n===\n\ntext'`, `'Title\n---'` and `'a\nb\n---\n\nc'`.
13. `hr` against lists: `'- - -\n\n***\n\n---\n\n- item'`.
14. A blockquote with a lazy line, then a second blockquote: `'> a\nlazy\n\n> b'`.
15. Constructs that span blank lines and hold column-0 lines: an HTML comment `'<!--\n\n# not a heading\n\n-->\n\nafter'`; a fenced block ``'```\ncode\n\n# not a heading\n```'``; a column fence `'::: {cols=2}\na\n\n# h\n|||\nb\n:::'`; indented code `'    a\n\n    b\n\nnext'`.
16. A reference definition after its use: `'see [ref]\n\n[ref]: https://example.com'`.
17. Every source of cases 10–16 with each `'\n'` replaced by `'\r\n'`.
18. **Generated and random documents.** A QA-shaped document of 1, 3, 7 and 60 sections (*Addendum: Test Documents*); and 5,000 seeded random documents built from the line pool in that addendum. Every one lexes to the same tokens through both lexers.

**Complexity** (unit; the meter is in *Addendum: The Scan Meter*):

19. The scanned characters (`ruleChars + splitChars`) for the QA-shaped document at 480 sections are at most 10× those at 60 sections. Today the ratio is about 64.5 (red); after step 7 it is about 8.3.
20. `splitChars` alone: its value at 480 sections is at most 10× its value at 60. Today it is 168.7 million against 2.6 million (red); after step 6 it is 0 at both sizes.

**Handle bookkeeping** (unit):

21. A test subclass of `Component` tracks `r, a, b, c, d` (in that order) through `trackHandle`; `untrackHandles([b, d])` leaves the owned list as `[r, a, c]`.
22. `untrackHandles([x])` for an untracked `x`, and `untrackHandles([])`, leave the list unchanged.
23. After `untrackHandles`, the array is the same object as before (the finalizer's reference).
24. A `Markdown` rendered from `docA` (`new Markdown(docA).getElement(true)`) and then given `setMarkdown(docB)`: every handle of `docB`'s `_contentHandles` is in `_ownedHandles`, none of `docA`'s content handles (copied before the call) is, and `_ownedHandles.length` equals its length before the call minus `docA`'s content count plus `docB`'s. Use a `docA` and a `docB` of different sizes, each with a table and a list.

Every existing suite stays green unchanged: `Markdown.test.ts` (tables at `:1056-1280`, fences at `:382-525`), `Markdown.multicolumn.test.ts`, `MarkdownViewer.test.ts`, `MarkdownMinimap.test.ts`, `MarkdownHeadingScoping.test.ts` and `markdown-editor.test.ts`, whose parity guard lexes through `lexMarkdown`.

---

## Verification

### Offline (the implementer)

Run from `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run lint` — clean.
- `npm test` — green, including cases 1–24.
- `grep -rn 'split("\\n")' src/typescript/lib/component/display/markdownExtensions.ts src/typescript/lib/component/display/markdownTableExtension.ts` — zero matches.
- Step 10's corpus comparison — zero mismatches, before the throwaway file is deleted.
- `npm run docs:api` — no warning beyond the 14 on master. `lexMarkdownUnbounded` is `@internal` and `untrackHandles` is protected, so neither renders.

**The test suite is not the gate for this change; identical tokens are.** Cases 10–18 and step 10 are that gate. A green `npm test` with step 10 skipped proves nothing about the windows.

### In WebKitGTK (the orchestrator, never the implementer)

Every run opens a full-screen MiniBrowser window; run only with the user's go-ahead. The cells are W3.0's two lexer cells, `mdu` (`markdown-doc`, 60 sections) and `mdu480` (480 sections), each run as a scored cell: the base arm at both ends and in the middle, the fix between. `wt` is the plan's base commit, `11ad15eb`; `main` is the implemented branch.

From the repository root, on the implemented branch:

```sh
npm run build:lib
git worktree add .worktrees/_g26-lex-base 11ad15eb --detach
ln -sfn "$PWD/node_modules" .worktrees/_g26-lex-base/node_modules
(cd .worktrees/_g26-lex-base/packages/lib && npm run build:lib)
export QA_WT_LIB="$PWD/.worktrees/_g26-lex-base/packages/lib"

F='work=1&seam=1&geom=1'
M='panel=markdown-doc&drive=update:20'
L='panel=markdown-doc&n=480&drive=update:20'

packages/qa/runqa.sh g26lex-mdu-wt-a   wt   "$M&$F"
packages/qa/runqa.sh g26lex-mdu-main-1 main "$M&$F"
packages/qa/runqa.sh g26lex-mdu-wt-b   wt   "$M&$F"
packages/qa/runqa.sh g26lex-mdu-main-2 main "$M&$F"
packages/qa/runqa.sh g26lex-mdu-wt-c   wt   "$M&$F"

export QA_TIMEOUT=300
packages/qa/runqa.sh g26lex-mdu480-wt-a   wt   "$L&$F"
packages/qa/runqa.sh g26lex-mdu480-main-1 main "$L&$F"
packages/qa/runqa.sh g26lex-mdu480-wt-b   wt   "$L&$F"
packages/qa/runqa.sh g26lex-mdu480-main-2 main "$L&$F"
packages/qa/runqa.sh g26lex-mdu480-wt-c   wt   "$L&$F"
```

`QA_TIMEOUT=300` because a base-arm run at 480 sections spends about 90 s in its 20 units alone, against the default 120 s bound.[^timeout] Read each cell with:

```sh
python3 packages/qa/bin/qa-table.py packages/qa/results g26lex-mdu-    --seam --work
python3 packages/qa/bin/qa-table.py packages/qa/results g26lex-mdu480- --seam --work
```

`qa-ab.py` does not apply: it scores an arm only by its `abl=` name, and a library arm has none. `qa-table.py` compares every run's geometry with the first run listed, `wt-a`, as W3.0's C40 witnesses were read.

Expected readings:

| Reading | `mdu` (60) | `mdu480` (480) |
|---|---|---|
| `geom`, every run | `=` | `=` |
| `sink/u` and every `seam.sink.*` / `seam.source.*` count, `main` against `wt` | equal (about 4,285 sink calls) | equal (about 31,956) |
| `work/u` | equal (384.1) | equal (384.0) |
| `wt` avg ms | about 182 | about 4,219 |
| `main` avg ms | about 110–115 | about 155–460 |

**Pass** when geometry is `=` in every run of both cells, every seam and work count matches between the arms, and `main`'s average at 480 divided by `main`'s at 60 is 8 or less; the expected value is about 1.4–4.2, against 23.2 for `wt`.[^expected] The saving is work avoided as well as time: no DOM write changes, and lexing, which today is over 90% of an update at 480 sections, becomes a small share of it. A `main` ratio above 8 with equal geometry means a superlinear cost remains outside the lexer; record it and stop, rather than tuning the windows.

---

## Documentation Impact

No public API changes: `lexMarkdown` and `lineEndAt` are module exports outside every barrel, `lexMarkdownUnbounded` is `@internal`, and `Component.untrackHandles` is protected. No component page changes; `llms.txt` needs no entry.

Changelog entry for `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components`, after the existing `Markdown` entries:

> - **A long Markdown document now renders in time proportional to its length.** Lexing slowed quadratically with the document: two of the library's own block extensions split the whole rest of the document into lines at every block, and in WebKit six of marked's block rules scanned the whole rest of the document at every block too. A 480-section document took about 4.2 s per `MarkdownViewer.setMarkdown` in WebKitGTK. Each extension now reads only the lines it inspects, and those six rules run only where their construct can start, on the text it can span. The tokens, the rendered DOM and the heading ids are unchanged, and no consumer action is needed.

---

## Potential Challenges

- **A future marked release could break the window's assumption.** The windows rely on how marked's five windowed tokenizers read their input; the seeded differential test (case 18) runs on every `npm test`, so an upgrade that breaks the assumption fails there rather than in a render.
- **`TokenizerObject`'s `this` type.** marked types each override's `this` as its `_Tokenizer`, so `Tokenizer.prototype.hr.call(this, …)` type-checks as written; do not annotate `this` yourself.
- **The meter touches shared objects.** The test puts an own `exec` on marked's module-level rule regexes and replaces `String.prototype.split`; restore both in a `finally`, or every later test in the file runs instrumented.
- **The corpus comparison needs the base lexer's output before any edit.** Step 1 must run on the unmodified branch; if it is skipped, check out the base commit in a throwaway worktree and record there.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — the scoped instance and the precedent for extending marked.
- [`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — `TABLE_EXTENSION`.
- [`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) — the shared dialect helpers `lineEndAt` joins.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `clearContent` (`:1167`), and the test-hook export precedent (`:2302-2308`).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `trackHandle` (`:1317`), `untrackHandle` (`:1354`), `destructor`'s bulk release (`:1299-1303`).
- `node_modules/marked/lib/marked.d.ts` — `TokenizerObject`, `Tokenizer`, `Lexer.rules`.
- [`packages/lib/tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts) — the suites that pin tables and fences.
- [`plans/research/render-review-2026-09-15/25-display-markdown.md`](plans/research/render-review-2026-09-15/25-display-markdown.md) — F25.2, the extension half of this finding.

---

## Non-Goals

- **The viewer-resize half of G26** (F25.1, F25.3, F25.4, F25.13, F25.14, F25.16, F11.5). W3.0 read it `flat` on both drag cells and a 0.03 ms `win` on passes, and it is neither small nor self-contained: it changes `FloatingPanel.placeNextTo`, which `DiagramView` shares, and it needs a deferred-measure design of its own.[^scope]
- **The viewer's second lex of the same source** (F25.9). `MarkdownViewer.setMarkdown` lexes once in `Markdown.setMarkdown` and again in `extractMarkdownHeadings`. After this plan both are linear. Removing the second belongs to G27, which has `Markdown` publish its headings from the render walk.
- **Raw HTML blocks.** `html` keeps a whole-source scan wherever a line starts with `<`, so a document with many HTML blocks still pays one scan per block in WebKit.[^html-full]
- **A single giant list.** Inside one list, marked checks each item's first line against its `hr` rule over the rest of the list, so one list of thousands of items is still quadratic in its own length in WebKit. Lists that long are rare, and bounding marked's internals further means replacing its list tokenizer.
- **Reporting JavaScriptCore's regex behaviour upstream** to marked or WebKit. Worth doing, but not a library change.

---

## Addendum: The Scan Meter

The meter for cases 19 and 20, written in `markdownLexer.test.ts`:

- `SLOW_RULES = ["hr", "blockquote", "list", "html", "table", "lheading"]`.
- For each name, give `Lexer.rules.block.gfm[name]` (import `Lexer` from `"marked"`) an own `exec` property that adds `input.length` to a `ruleChars` counter, then returns `RegExp.prototype.exec.call(this, input)`. marked's tokenizers call these regexes' `exec`, and `RegExp.prototype.test` calls `exec` too, so both paths are counted.
- Replace `String.prototype.split` with a function that adds `this.length` to a `splitChars` counter when its separator is exactly `"\n"` and no limit is given, then calls the original.
- Lex once with `lexMarkdown`, then, in a `finally`, delete the six own `exec` properties and restore `split`.
- Case 19 compares `ruleChars + splitChars`; case 20 compares `splitChars`.

Measured with a prototype of this plan on the QA-shaped document (7,606 characters at 60 sections, 62,580 at 480):

| | `ruleChars` 60 → 480 | `splitChars` 60 → 480 | Total ratio |
|---|---|---|---|
| Today | 1,959,142 → 126,293,244 | 2,615,722 → 168,713,134 | 64.5 |
| This plan | 8,706 → 72,312 | 0 → 0 | 8.3 |

## Addendum: Test Documents

**The QA-shaped document** mirrors the shape of `packages/qa/src/builders/data.ts`'s `markdownDocument`, which the library tests cannot import. The scan-meter figures above were measured with exactly this function:

```typescript
function qaShapedDocument(sections: number): string {
    const blocks = ["# Document"];

    for (let i = 0; i < sections; i++) {
        const n = i + 1;

        blocks.push(`## Section ${n}`, `Section ${n} prose. It wraps when the pane narrows.`);

        if (i % 3 === 2) {
            blocks.push([1, 2, 3, 4].map((k) => `- Point ${k} of section ${n}`).join("\n"));
        }

        if (i % 4 === 3) {
            blocks.push(["```ts", `const section = ${n};`, "console.log(section);", "```"].join("\n"));
        }

        if (i % 5 === 4) {
            blocks.push(["| Name | Count |", "| --- | --- |", ...[1, 2, 3].map((r) => `| Row ${r} | ${n * r} |`)].join("\n"));
        }
    }

    return blocks.join("\n\n") + "\n";
}
```

The periods (every third, fourth and fifth section) mirror the QA generator's so every construct recurs throughout the document; the test documents their "why" in the same terms.

**The seeded random documents** for case 18: a linear-congruential generator (`s = (s * 1664525 + 1013904223) >>> 0`, seed `12345`, value `s / 2^32`); each document is 1–25 lines drawn from the pool below; each drawn line is indented by two spaces with probability 0.15; half the documents end with `\n`. The pool, as the test's constant (the last entry is a backslash followed by `n`, the cell line-break escape):

```typescript
const LINE_POOL: readonly string[] = [
    '# Heading', '## Sub', 'Paragraph text with **bold** and `code`.', 'Setext title', '===', '---', '- item', '- item two',
    '* star item', '1. first', '2) second', '10. ten', '1.5 million', '  indented continuation', '    indented code',
    '> quote', '> > nested quote', 'lazy continuation', '```ts', '```', '~~~', '~~~~', '  ```', '<!-- comment', '-->',
    '<div>', '</div>', '<script>', '</script>', '<?php', '?>', '| a | b |', '| --- | --- |', '|---|:-:{width=80}|',
    '| x | << |', '| ^^ | y |', 'a | b', '-|-', '::: {align=center}', ':::', '|||', '::: {cols=2}', '', '', '', ' ',
    '\t', '  ', '***', '___', '- - -', '[ref]: https://example.com "t"', 'see [ref] here', '![img](a.png){width=10}',
    '[span]{color=red}', '++under++', '\\n',
];
```

With this pool, a window that ignored list-marker lines differed from the twin on 59 of 20,000 documents, so 5,000 catch that class of mistake about 15 times over. The 5,000 documents lex through both lexers in about 0.3 s in V8.

## Addendum: The Corpus Comparison

`tests/component/display/markdownLexer.corpus.tmp.test.ts` is a throwaway test, never committed:

- **Corpus:** every `.md` file under the repository's `packages/` and `plans/` directories (skip `node_modules`, `dist`, `target`), each lexed twice — as read, and with every `\n` replaced by `\r\n` — plus the 20,000 seeded random documents of *Test Documents*.
- **Record mode** (`CORPUS_MODE=record`): write `{ [documentKey]: sha256(JSON.stringify(lexMarkdown(doc))) }` to `os.tmpdir()/markdown-lexer-base-hashes.json`. The key is the file path, suffixed ` (CRLF)` for the second form, or `fuzz:<index>`.
- **Compare mode** (`CORPUS_MODE=compare`): read that file, re-hash every document with the changed `lexMarkdown`, and fail listing each key whose hash differs or is missing.

With no `CORPUS_MODE` the test skips itself, so a stray copy cannot slow `npm test`.

---

## Notes

[^profile]: Measured offline on 2026-09-22 with the QA app's own document generator (`markdownDocument(n, 1)`), three ways.
    **JavaScriptCore**, through `libjavascriptcoregtk-4.1` — the library MiniBrowser loads — driven headlessly from Python's `ctypes` with the library bundled by esbuild. Per lex, n = 60 / 120 / 240 / 480 sections, in two runs: `lexMarkdown` 39 / 137 / 544 / 2,047 ms and 37 / 129 / 491 / 1,894 ms; marked with no extensions 36 / 128 / 488 / 1,898 ms and 33 / 120 / 457 / 1,791 ms; the prototype of this plan 3 / 4 / 7 / 15 ms. Per tokenizer at n = 480 (one lex, 1,832 ms of marked alone): `html` 406 ms over 1,216 calls, `hr` 319 / 1,376, `blockquote` 291 / 1,376, `lheading` 283 / 1,120, `list` 262 / 1,376, `table` 248 / 1,216, every other tokenizer 18 ms or less. Per rule, 100 `exec`s at a paragraph position with 8,927 versus 127,887 characters left: `blockquote` 6 → 74 ms, `hr` 5 → 75, `html` 10 → 187, `lheading` 15 → 115, `table` 7 → 100; `code`, `def`, `fences`, `heading`, `list`, `newline`, `paragraph` and `text` 0–1 ms at both sizes. The `hr` regex alone costs 0.93 / 3.7 / 15 ms per failed `exec` on 159 k / 639 k / 2.6 M characters, while `/^Section/` costs nothing measurable — the engine scans every start position for these patterns. `list`'s own rule is fast; its cost is marked's `this.rules.block.hr.test(src)` once per list item, on the whole remaining source.
    **V8** (Node 25, the vitest runner): `lexMarkdown` 6.6 / 18.4 / 60.1 / 236.6 / 646.2 ms for n = 60 … 960, marked alone 0.9 → 10.7 ms. Only the extensions' splits are quadratic there.
    **The update path in the modelled DOM**, each stage of `MarkdownViewer.setMarkdown` plus the layout flush timed by wrapping it: at n = 480, 362 ms per update, of which lexing (twice) 344.5 ms, `clearContent` 7.5 ms (its `untrackHandle` calls 6.0 ms), the render walk 6.3 ms, the minimap 2.2 ms, the layout flush 1.3 ms. `untrackHandle` grows about 3× per doubling (6.0 / 17.8 / 55.4 ms at 480 / 960 / 1,920); everything but lexing and that stays within about 2× per doubling.
    **The in-engine record agrees:** twice 1,894–2,047 ms is 3,788–4,094 of `mdu480`'s 4,219 ms, and twice 37–39 ms is 74–78 of `mdu`'s 182 ms. Its DOM counts are linear — `sink/u` 4,285 → 31,956 (7.5×) — and `work/u` is flat at 384, so neither the DOM writes nor the layout pass is the superlinear term.

[^no-start]: A block extension's `start()` hook lets marked clip a paragraph where the extension could begin, so a table or a `:::` fence would begin to interrupt a paragraph with no blank line before it. That changes the tokens for such documents, which this plan must not do. Slice 25 proposed the hooks as part of F25.2 and noted, without settling it, that the missing interrupt might be intended (its section *Things that look wrong but aren't*, item 7). Whether it is intended is a dialect question for another plan.

[^html-full]: marked's `html` rule has five block types (`<script>`/`<pre>`/`<style>`/`<textarea>`, comments, processing instructions, declarations and CDATA) that run to their closing marker across blank lines and column-0 lines, so no restart line bounds them. Windowing `html` like the others changed the tokens of 1,495 of the 20,000 random documents in the prototype comparison; the guard alone keeps it exact and costs a whole-source scan only where a line starts with `<`. The library renders raw HTML as plain text, so such documents are rare in its dialect.

[^guards]: Read off each rule's source in `Lexer.rules.block.gfm`. `hr` begins `^ {0,3}` then `-`, `_` or `*`; `blockquote` begins `^( {0,3}>`; `list` is `^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)`, which matches exactly when the guard does; every `html` alternative begins `^ {0,3}<`; `table`'s second line must match `:?-+:?` segments, so it contains `-`; `lheading`'s content cannot cross a line that is whitespace-only, by JavaScript's `\s`, because of its `\n(?!\s*?\n…)` step, and must end at a line of ` {0,3}(=+|-+) *`. A guard that passes where the rule then fails costs nothing but the original call. The guards themselves are simple anchored patterns that JavaScriptCore stops at the anchor, like `/^Section/` in the measurement above; the prototype's 15 ms lex at 480 sections includes every guard call.

[^no-shared-rules]: Two other routes were considered and rejected. Replacing the six regexes on marked's `Lexer.rules.block.gfm` object would change parsing for every other user of marked in the same bundle — what the scoped instance exists to prevent (`markdownExtensions.ts:179-184`). Chunking the document at blank lines before lexing needs a tracker for fences, HTML blocks and `:::` regions across list items; a tracker that misreads one opener closes on the next real fence and splits inside it, so an error cascades. The per-tokenizer window needs no tracker: each window is decided from one tokenizer's own position, and a wrong window can change only that one token, which the differential test would show.

[^window-sound]: Why each construct ends before a restart line. `hr` is one line plus its newlines. `blockquote` repeats only over lines starting ` {0,3}>`, and its lazy-continuation lines stop at an empty or spaces-only line. `lheading` stops at a whitespace-only line (see the guards note). marked's `table` rows stop at a spaces-only line (`(?! *\n…)`). A list item takes a following line only if it is blank, indented to the item's content, or a lazy continuation with no blank line before it; after a blank line, a column-0 line ends the item, and the list continues only if that line is a list marker — which a restart line never is. The trailing `\n+` / `\n*` runs that close these rules consume the same newlines on the window as on the whole source, because a window always ends right after a newline and right before a non-blank line. A tab-only line is not spaces-only because marked's `table` body continues through one.

[^twin]: The twin is what keeps the windows honest after this plan lands: any marked upgrade, and any later edit to a guard or to `blockWindow`, is re-checked against it on every `npm test`. It shares `MARKDOWN_EXTENSIONS`, so it differs from `lexMarkdown` only in the tokenizer overrides. It is created on first call, so production code pays nothing for it.

[^prevalidated]: On 2026-09-22 a prototype of this exact design — both extension rewrites and the six overrides as specified here — was compared with the unmodified `lexMarkdown` over 1,731 Markdown files in `packages/` and `plans/` (63.7 MB), each as read and with CRLF line endings, and over 20,000 seeded random documents from the pool in *Test Documents*: zero differences. A wider run over every `.md` in the repository, worktrees included (10,416 files, 323 MB), also found none. The same harness catches mistakes: dropping the list-marker exclusion from the restart rule changed the tokens of 864 file forms and 59 random documents; letting an indented line be a restart line changed 448 file forms and 199 random documents; windowing `html` changed 1,495 random documents. Treating tab-only lines as blank changed nothing, since `TABLE_EXTENSION` takes every pipe table before marked's own `table` rule runs; the plan keeps the stricter spaces-only rule anyway.

[^meter]: A timing bound in V8 would not pin the fix: marked is linear in V8, so a V8 test passes with all six overrides missing. The meter counts the input that JavaScriptCore scans, so it fails when either half of the fix is missing. It counts at the regexes rather than at the tokenizer methods so it cannot be fooled by how the overrides call the originals.

[^untrack]: Each `untrackHandle` call finds the handle near the front of `_ownedHandles` and `splice`s it out, shifting every later entry: about 17 million moves for the 5,874 handles of a 480-section document. In V8 that is 6 ms per update at 480 sections, growing about 3× per doubling; in JavaScriptCore it measured about 1 ms, because its `splice` is a fast block move. It is small in time but quadratic in work, and it sits in the same `update` path.

[^scope]: W3.0's cells for the resize half: `m60d` drag 56.96 → 56.58 ms, `m240d` 57.05 → 56.80 ms, both inside their brackets; `mdq` passes 0.50 → 0.47 ms, 4.00 → 2.01 reads per pass. The synthesis also routes its `placeNextTo` gate through slice 11's owner because `DiagramView` uses `FloatingPanel` the same way (`99-synthesis.md`, G26 *Depends on*). A plan of its own can take it with G09's `Markdown` opt-in.

[^expected]: Estimated as the W3.0 averages minus two lexes' saving, per the JavaScriptCore figures in the profile note: at 60 sections 182 − 2 × (37–39 − 3) ≈ 110 ms; at 480, 4,219 − 2 × (1,894–2,047 − 15) ≈ 155–460 ms. The spread at 480 is the spread between the two lexer runs, so the ratio's range is wide. What the pass condition needs is only that it lands at 8 or below.

[^timeout]: `mdu480` at the base commit averaged 4,219 ms per unit over 20 units, plus a mount whose first render also lexes twice. W3.0's single `mdu480` run completed under the default, but with little margin.

---

## Implementation Notes

The plan was implemented as written: both extension line walks, `lineEndAt`,
the six bounded tokenizers with `blockWindow` and its guards, the unbounded
twin, `Component.untrackHandles` and `Markdown.clearContent`'s single-pass
untracking. Cases 1–24 are in
`packages/lib/tests/component/display/markdownLexer.test.ts` and
`packages/lib/tests/core/ComponentTrackedHandles.test.ts`. Three things are
worth recording.

**The scan meter read exactly what the plan predicted.** Before step 6,
`splitChars` was 2,615,722 at 60 sections and 168,713,134 at 480; before step
7, `ruleChars` was 1,959,142 and 126,293,244, a total ratio of 64.5. After
step 7 the figures are `ruleChars` 8,706 → 72,312 and `splitChars` 0 → 0, a
ratio of 8.31, against the plan's 8,706 → 72,312 and 8.3. Cases 19 and 20
were red at the sizes the plan said they would be, and in that order.

**The corpus comparison ran over 21,752 document forms, not the plan's
estimated ~3,500 plus 20,000.** The tree held 876 `.md` files under
`packages/` and `plans/` when step 1 recorded and step 10 compared, so 1,752
file forms with both line endings, plus the 20,000 seeded random documents.
The plan's 1,731 counted the generated `packages/lib/docs/api` tree as well —
868 gitignored `.md` files, which `npm run docs:api` had produced before its
prevalidation run and had not yet produced before step 1's. Both corpus runs
here saw the same 876 files, so the comparison is sound, but it covered about
half the *file* forms the prevalidation did; the 20,000 random documents are
unaffected. Zero mismatches against the hashes recorded on the unmodified
branch; the throwaway test file and its hash file were deleted, as step 10
requires.

**The in-engine readings in *Verification* are still pending, and are the
user's to run.** Every `packages/qa/runqa.sh` run opens a full-screen
MiniBrowser window, so this implementation ran none of them. The commands are
exactly as listed in *Verification → In WebKitGTK*, with one caveat: that
section names `11ad15eb` as the base arm `wt`, but this branch starts from
`57eb5738`, the tip of the stack of three implemented-but-unmerged wave-3
plans (`text-measurement-without-reflow` → `chart-repaint-gate` →
`motion-transform-inline`) that sits above it. A `wt` arm at `11ad15eb` would
therefore score this plan plus those three; `57eb5738` is the arm that
isolates this one. The pass condition is unchanged either way: geometry `=`
in every run of both cells, every seam and work count equal between the arms,
and `main`'s average at 480 sections divided by its average at 60 no more
than 8.
