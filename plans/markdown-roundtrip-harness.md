---
touches-shared: []
---

# Markdown Round-Trip Harness — Implementation Plan

## Overview

The library renders Markdown with the `Markdown` viewer, which lexes through a scoped `marked` instance ([`lexMarkdown`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L393)). It edits Markdown with `MarkdownEditor`, whose load and save go through `@lexical/markdown`'s line/regex transformers ([`TRANSFORMERS`](packages/lib/src/typescript/lib/component/editor/markdownTransformers.ts#L68), used at [`MarkdownEditor.ts:1238`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1238), [`:1260`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1260), [`:1300`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1300), [`:2269`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2269), [`:2280`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2280) and [`:2892`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2892)). The two parsers disagree, and Lexical adds its own escaping. A later plan will replace the editor's import and export with a `marked`-token importer and an own serializer. This plan builds the safety net for that rewrite first.

The safety net is a corpus-driven test harness under `packages/lib/tests/component/markdown-roundtrip/`. For every corpus document it checks, under vitest and the modelled DOM:

1. **parity** — load the document into a headless `MarkdownEditor`, save it with `getValue()`, and compare what the viewer would show for the saved text with what it shows for the original.
2. **idempotence** — load the saved text again and save again; the second save must equal the first, byte for byte.
3. **surface** — compare the structure the editor's WYSIWYG surface holds after loading with what the viewer shows for the original.

Load-and-save itself (the round-trip) runs inside every check, so a throw fails the case. Every check the current editor fails is listed in the corpus as a *known divergence* with a named, reviewed reason. The harness therefore lands green on today's code, and a check that starts to hold turns its test red until its entry is removed. The plan is test infrastructure only: no file under `packages/lib/src/` changes.

---

## Architecture Decisions

### The corpus is a TypeScript table, split by source

Each case is an object literal `{ name, source, links?, known? }` in one of three modules: CommonMark spec examples, the library's own dialect, and reference-style links. This follows the existing corpus table in [`markdown-editor.test.ts:51`](packages/lib/tests/component/markdown-editor.test.ts#L51).[^ts-table]

### Compare a projected view model, not a DOM snapshot

A new `viewModel.ts` projects both sides onto one plain data shape, the *view model*: a list of blocks (heading, paragraph, quote, list, code, table, fence, raw) whose inline content is a list of *runs* (text with its marks, link and span style; image; break). `viewerModel(source)` builds it from `lexMarkdown(source)` by following the viewer's own render dispatch ([`Markdown.appendBlockToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637), [`appendInlineToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1969)) and the same exported resolvers the viewer calls. `editorSurfaceModel(editor)` builds it from the editor's Lexical node tree. Comparison is `toEqual` on these values.[^token-model]

### The viewer is the oracle

Parity and surface both compare against `viewerModel(original)`. The expected value is never the current editor's output. The view model therefore reproduces the viewer's quirks too — for example, a thematic break renders as a raw text block — with one exception: a link reference definition (`def` token) is dropped, because only the links that resolve through it are visible.[^viewer-oracle][^def-drop]

### Inline content is compared as flat runs

Nested `strong`/`em`/`del`/`underline`/`codespan`/`link`/`styledspan` tokens and Lexical's per-node format bits both flatten to runs carrying a sorted mark list, an optional link target and an optional span style. Adjacent runs with identical formatting merge, and whitespace collapses as HTML's `white-space: normal` does.[^flat-runs]

| Source A | Source B | Same view model? | Why |
|---|---|---|---|
| `***both***` | `**_both_**` | yes | both are one run `both` with marks `[bold, italic]` |
| `[**bold** span]{color=blue}` | `[**bold**]{color=blue}[ span]{color=blue}` | yes | same two runs: `bold` (bold, blue) and ` span` (blue) |
| `a\nb` | `a b` | yes | a soft break collapses to one space |
| `*foo [bar](/url)*` | `*foo* [*bar*](/url)` | no | the space before the link is italic in A only |

### Known divergences are inverted assertions with a named reason

A case's `known` entry maps a check to a reason id from one shared catalogue, `DIVERGENCES` in `corpus/divergences.ts`. For a check with no entry the harness asserts `expect(actual).toEqual(expected)`. For a listed check it asserts `expect(actual, message).not.toEqual(expected)`, where the message tells the reader to remove the entry. This mirrors the known-failure set in [`import-without-dom.test.ts:19`](packages/lib/tests/unit/import-without-dom.test.ts#L19), whose entries assert the inverted outcome at [`:53`](packages/lib/tests/unit/import-without-dom.test.ts#L53) so a fix turns red.[^inverted-assert][^reason-catalogue]

| Check has a `known` entry? | Check holds? | Test result |
|---|---|---|
| no | yes | pass |
| no | no | fail, with the `toEqual` diff |
| yes | no | pass; title reads `parity (known divergence: underscoreEmphasis)` |
| yes | yes | fail: "the 'parity' check now holds — remove its known divergence 'underscoreEmphasis'" |

The seeded baseline in [Addendum: Seed Corpus and Baseline](#addendum-seed-corpus-and-baseline) was measured on `master` at `575ba825`, and every entry carries a reason a reviewer can check against the diff.[^baseline-evidence]

### The editor runs headless through its public value API

Each check builds `new MarkdownEditor()`, calls `setValue(source)` and reads `getValue()` — the path [`markdown-editor.test.ts:43`](packages/lib/tests/component/markdown-editor.test.ts#L43) documents as the live editor's own state path. The surface check reads the private Lexical editor the same way [`lexicalOf`](packages/lib/tests/component/markdown-editor.test.ts#L86) does.[^private-editor]

### Idempotence compares exact strings

`saved2` must `toBe` `saved1`, with no `normalize`.[^exact-idempotence]

### No shared files with the unmerged branches

The harness only creates new files. `feature/markdown-source-mode-editing` and `feature/markdown-source-mode-styled-spans` both change `MarkdownEditor.ts` and `markdown-editor.test.ts`, and add `markdown-source-edits.test.ts`; none of those is touched here, so `touches-shared` is empty. The existing corpus tests in `markdown-editor.test.ts` stay as they are.[^branch-overlap]

---

## Internal Structure

All new files live in `packages/lib/tests/component/markdown-roundtrip/`. Tests use single quotes, like the rest of `tests/`.

```typescript
// viewModel.ts
export type Mark = 'bold' | 'italic' | 'strike' | 'code' | 'underline';
export interface LinkTarget { href: string; title: string | null }
export type Run =
    | { kind: 'text'; text: string; marks: Mark[]; link: LinkTarget | null; style: MarkdownSpanStyle | null }
    | { kind: 'image'; src: string; alt: string; width: number | null; height: number | null; link: LinkTarget | null }
    | { kind: 'break' };
export interface Cell { align: string | null; colSpan: number; rowSpan: number; runs: Run[] }
export type Block =
    | { kind: 'heading'; depth: number; runs: Run[] }
    | { kind: 'paragraph'; runs: Run[] }
    | { kind: 'quote'; blocks: Block[] }
    | { kind: 'list'; ordered: boolean; loose: boolean; items: Block[][] }
    | { kind: 'code'; lang: string | null; text: string }
    | { kind: 'table'; widths: (number | null)[]; header: Cell[]; rows: Cell[][] }
    | { kind: 'fence'; textAlign: string | null; columnGap: string | null; columns: Block[][] }
    | { kind: 'raw'; text: string };
export interface ViewModel { blocks: Block[]; headingIds: string[] }

export function viewerModel(source: string): ViewModel;
export function editorSurfaceModel(editor: MarkdownEditor): Block[];
export function linkTargets(model: ViewModel): string[];

// corpus/types.ts
export type HarnessCheck = 'parity' | 'idempotence' | 'surface';
export interface CorpusCase {
    readonly name:   string;                                         // unique test title
    readonly source: string;                                         // the document exactly as authored
    readonly links?: readonly string[];                              // link targets the viewer must read, in order
    readonly known?: Partial<Record<HarnessCheck, DivergenceId>>;    // checks the current editor fails
}

// corpus/divergences.ts — DivergenceCause, DivergenceReason, DIVERGENCES, DivergenceId (full text in the addendum)
// corpus/commonmark.ts      — export const COMMONMARK_CASES: readonly CorpusCase[]
// corpus/dialect.ts         — export const DIALECT_CASES: readonly CorpusCase[]
// corpus/referenceLinks.ts  — export const REFERENCE_LINK_CASES: readonly CorpusCase[]
// corpus/index.ts           — export const CORPUS: readonly CorpusCase[] = [...COMMONMARK_CASES, ...DIALECT_CASES, ...REFERENCE_LINK_CASES]

// harness.ts
export function loadAndSave(source: string): { editor: MarkdownEditor; saved: string };
export function checkTitle(testCase: CorpusCase, check: HarnessCheck): string;
export function assertCheck(testCase: CorpusCase, check: HarnessCheck, actual: unknown, expected: unknown): void;
```

`MarkdownSpanStyle` is imported from [`markdownAttributes.ts:14`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L14).

---

## Implementation

### Viewer side of the view model

`viewerModel(source)` returns `{ blocks: viewerBlocks(lexMarkdown(source)), headingIds: extractMarkdownHeadings(source).map((heading) => heading.id) }`. [`extractMarkdownHeadings`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2219) produces the same ids the viewer renders, so a save that changes an in-page anchor fails parity.

Block tokens map as follows. Every block list built here — root, quote, list item, fence column — drops a paragraph with no runs and a raw block with empty text.[^empty-blocks]

| Token `type` | Block |
|---|---|
| `space`, `def` | nothing |
| `heading` | `heading`, `depth` clamped to 1–6 (mirrors [`Markdown.ts:82`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L82)), runs of `tokens` |
| `paragraph` | `paragraph`, runs of `tokens` |
| `blockquote` | `quote`, blocks of `tokens` |
| `code` | `code`; `lang` = first whitespace-separated word of the trimmed `lang`, or `null` when empty; `text` = `token.text` with one trailing `\n` removed[^code-newline] |
| `list` | `list`; `ordered`, `loose` copied; each item's tokens become blocks, where a `text` token becomes a `paragraph` of its `tokens` (or of the `text` token itself when it has none) |
| `mdtable` | `table`; `widths` copied; header cells `{ align, colSpan: 1, rowSpan: 1, runs }`; body cells copy `align`, `colSpan`, `rowSpan`; cell runs use the table-cell rule below |
| `mdblock` | `fence`; `textAlign` / `columnGap` from [`resolveBlockStyle(token.attributes)`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L361); one block list per column |
| anything else | `raw`, `text` = `token.raw` with whitespace collapsed and trimmed (the viewer's text fallback) |

Inline tokens map onto runs, carrying a context of marks, link and style down the tree:

| Token `type` | Run |
|---|---|
| `text` with `tokens` | recurse into `tokens` |
| `text` with no `tokens`, inside a table cell, containing the four characters `\`, `n`, `\`, `n` (`CELL_PARAGRAPH_BREAK` at [`Markdown.ts:70`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L70)) | split on that sequence; the pieces become text runs joined by `break` runs |
| other `text` | text run of `token.text` |
| `strong` / `em` / `del` / `underline` | add `bold` / `italic` / `strike` / `underline`, recurse |
| `codespan` | text run of `token.text` with `code` added |
| `link` | set `link` to `{ href: token.href, title: token.title ?? null }`, recurse |
| `styledspan` | set `style` to [`resolveSpanStyle(token.attributes)`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L254), or `null` when all three fields are `null`; recurse |
| `mdimage` | [`resolveImageSpec(src, alt, attributes)`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L434); `null` adds nothing, otherwise an `image` run carrying the context's `link` |
| anything else | text run of `token.text ?? token.raw ?? ''` |

Marks are kept in the fixed order `bold, italic, strike, code, underline`. Run assembly, shared by both sides:

```typescript
/** Appends text, merging into the previous text run when its marks, link and style are identical. */
function pushText(runs: Run[], text: string, context: RunContext): void {
    const last = runs[runs.length - 1];

    if (last?.kind === 'text' && sameFormatting(last, context)) {
        last.text = collapseWhitespace(last.text + text);

        return;
    }

    runs.push({ kind: 'text', text: collapseWhitespace(text), marks: context.marks, link: context.link, style: context.style });
}

/** Drops empty text runs and trims one space at the block's edges and next to a break. */
function finishRuns(runs: Run[]): Run[] {
    const kept = runs.filter((run) => !(run.kind === 'text' && run.text === ''));

    kept.forEach((run, index) => {
        if (run.kind !== 'text') {
            return;
        }

        if (index === 0 || kept[index - 1]!.kind === 'break') {
            run.text = run.text.replace(/^ /, '');
        }

        if (index === kept.length - 1 || kept[index + 1]!.kind === 'break') {
            run.text = run.text.replace(/ $/, '');
        }
    });

    return kept.filter((run) => !(run.kind === 'text' && run.text === ''));
}
```

`collapseWhitespace` replaces every `\s+` with one space. `sameFormatting` compares `marks`, `link` and `style` by `JSON.stringify` equality. Every runs list (heading, paragraph, cell) goes through `finishRuns`.

### Editor side of the view model

`editorSurfaceModel(editor)` reads the private Lexical editor (`(editor as unknown as { _editor: LexicalEditor | null })._editor`, throwing when it is `null`) and returns `lexicalEditor.read(() => editorBlocks($getRoot().getChildren()))`. Block nodes map as follows. As on the viewer side, every block list built here — root, quote, list item, fence column — drops a paragraph with no runs and a raw block with empty text.

| Node | Block |
|---|---|
| `$isParagraphNode` | `paragraph`, runs of its children |
| `$isHeadingNode` | `heading`, `depth = Number(node.getTag().slice(1))` |
| `$isQuoteNode` | `quote` holding one `paragraph` of its children's runs |
| `$isCodeNode` | `code`; `lang = node.getLanguage() ?? null`; `text` = `getTextContent()` with one trailing `\n` removed |
| `$isListNode` | `list`; `ordered = node.getListType() === 'number'`; `loose: false`; items by the rule below |
| `$isTableNode` | `table`; see below |
| `$isMarkdownBlockNode` | `fence`; `textAlign = getAlign()`, `columnGap = getColumnGap()`; one block list per `MarkdownColumnNode` child |
| anything else | `raw`, `text` = `getTextContent()` collapsed and trimmed |

List items: Lexical stores a nested list as its own `ListItemNode` whose only children are `ListNode`s. When an item's children are all `ListNode`s and an earlier item exists, append those lists' blocks to the earlier item. Otherwise the item is `[paragraph of its non-list children's runs, ...blocks of its ListNode children]`.

Tables: rows are the `TableNode`'s children; the column count is the first row's cell count; `widths[i]` is `node.getColWidths()?.[i]` when that value is truthy, else `null` (the import stores an unset width as `0`, [`markdownTableTransformer.ts:356`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts#L356)). Each cell gives `align = cell.getFormatType() || null`, `colSpan = cell.getColSpan()`, `rowSpan = cell.getRowSpan()`, and runs of its paragraphs joined by `break` runs. The first row is the header; its cells get `colSpan: 1, rowSpan: 1`.

Inline nodes:

| Node | Run |
|---|---|
| `$isTextNode` | text run of `getTextContent()`; marks from `hasFormat('bold' / 'italic' / 'strikethrough' / 'code' / 'underline')` → `bold` / `italic` / `strike` / `code` / `underline`; `style` from [`cssTextToAttributes(getStyle())`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L325) then `resolveSpanStyle`, or `null` when `getStyle()` is empty or every field resolves to `null` |
| `$isLineBreakNode` | `break` run[^linebreak-surface] |
| `$isLinkNode` | set `link` to `{ href: getURL(), title: getTitle() ?? null }`, recurse into children |
| `$isMarkdownImageNode` | `image` run from `getSrc()`, `getAlt()`, `getImageWidth()`, `getImageHeight()`, carrying the context's `link` |
| other element | recurse into children |
| other leaf | text run of `getTextContent()` |

### Harness

`loadAndSave(source)` returns the editor built with `new MarkdownEditor()` + `setValue(source)` and its `getValue()`. It does not catch: a throw fails the check.

The runner, `markdown-roundtrip.test.ts`, installs the modelled DOM in `beforeEach` with the same `CONFIG` block as [`markdown-editor.test.ts:32`](packages/lib/tests/component/markdown-editor.test.ts#L32) and calls `DOM.reset()` in `afterEach`. For each `CORPUS` case it opens `describe(testCase.name)` and defines:

| Test title | Body |
|---|---|
| `viewer reads the declared links` (only when `links` is set; never known) | `expect(linkTargets(viewerModel(source))).toEqual(testCase.links)` |
| `checkTitle(case, 'parity')` | `assertCheck(case, 'parity', viewerModel(saved), viewerModel(source))` |
| `checkTitle(case, 'idempotence')` | `assertCheck(case, 'idempotence', loadAndSave(saved).saved, saved)` |
| `checkTitle(case, 'surface')` | `assertCheck(case, 'surface', editorSurfaceModel(editor), viewerModel(source).blocks)` |

`checkTitle` returns the check name, or `` `${check} (known divergence: ${id})` `` when the case lists one. `assertCheck` follows the table under *Known divergences are inverted assertions with a named reason*; its failure message for a listed check is `` `${name}: the '${check}' check now holds — remove its known divergence '${id}' from the corpus` ``.

`linkTargets` walks the blocks in document order (including quotes, list items, table cells and fence columns). Within each runs list it records a run's `link.href` whenever the run has a link and that link differs from the previous run's link (a run without a link, or the start of the list, counts as no link). A link split into a bold and a plain run therefore counts once, while two links to one URL with other text between them count twice.

The runner adds a `describe('corpus integrity')` with two tests: case names are unique, and every `DIVERGENCES` id is named by at least one case's `known` entry (an unused reason means a fixed divergence whose catalogue entry was left behind).

---

## Ordered Implementation Steps

All paths are under `packages/lib/`. Follow `CODE_CONVENTIONS.md` and `~/.claude/CODE_CONVENTIONS.md` in test code too: JSDoc on every function, explicit return types, blank lines around multi-line statements, braces on every control structure.

1. **Create `tests/component/markdown-roundtrip/corpus/divergences.ts`** with the content of [Addendum: Divergence Catalogue](#addendum-divergence-catalogue), adding JSDoc where the conventions require it.
2. **Create `corpus/types.ts`** with `HarnessCheck` and `CorpusCase` exactly as in *Internal Structure*, importing `DivergenceId` as a type from `./divergences`. Check: `npx tsc -p tsconfig.test.json --noEmit` passes.
3. **Write the viewer-side projection tests first.** Create `markdown-view-model.test.ts` in the same folder, with the same `beforeEach(installTestDOM(CONFIG))` / `afterEach(DOM.reset())` setup as `markdown-editor.test.ts:32–41`, and cases V1–V14 from *Expected Behaviour*. Run `npx vitest run tests/component/markdown-roundtrip` — expect them to fail (no `viewModel.ts` yet).
4. **Create `viewModel.ts`** with the types and `viewerModel` / `linkTargets` per *Implementation*. Split the token walks into named functions (`viewerBlocks`, `viewerListItem`, `viewerTable`, `viewerInline`, …) so none passes ~30 lines. Check: V1–V14 pass.
5. **Add surface-projection tests** S1–S8 to `markdown-view-model.test.ts`, then implement `editorSurfaceModel` (`editorBlocks`, `editorListItems`, `editorTable`, `editorInline`, …). Check: S1–S8 pass. The guards come from `lexical` (`$getRoot`, `$isParagraphNode`, `$isTextNode`, `$isLineBreakNode`), `@lexical/rich-text` (`$isHeadingNode`, `$isQuoteNode`), `@lexical/list` (`$isListNode`, `$isListItemNode`), `@lexical/code` (`$isCodeNode`), `@lexical/table` (`$isTableNode`, `$isTableCellNode`), `@lexical/link` (`$isLinkNode`), and `~/component/editor/markdownBlockNode` / `markdownImageNode` (`$isMarkdownBlockNode`, `$isMarkdownColumnNode`, `$isMarkdownImageNode`).
6. **Create `harness.ts`** with `loadAndSave`, `checkTitle` and `assertCheck`. Add a `describe('harness assertions')` to `markdown-roundtrip.test.ts` covering H1–H4 first, then implement. Check: H1–H4 pass.
7. **Create the three corpus modules** from [Addendum: Seed Corpus and Baseline](#addendum-seed-corpus-and-baseline), copying each listing verbatim into its array, and **`corpus/index.ts`**. Check: `grep -c "name: '" tests/component/markdown-roundtrip/corpus/*.ts` reports 155 for `commonmark.ts`, 82 for `dialect.ts` and 44 for `referenceLinks.ts`.
8. **Finish `markdown-roundtrip.test.ts`**: the per-case `describe` blocks and `corpus integrity` per *Implementation › Harness*. Run `npx vitest run tests/component/markdown-roundtrip`. Expect every test to pass: 281 cases, 238 known entries (59 parity, 2 idempotence, 177 surface), 44 link witnesses.
9. **If step 8 is not green, do not edit `known` entries to make it so.** An unlisted check that fails, or a listed check that holds, means the projection differs from *Implementation* or `master` has moved past `575ba825`. Re-read the projection against the rule tables and fix it there. If the projection matches and the difference is real, stop and report the case, the check and the diff instead of annotating it.
10. **Check by hand that a corpus edit turns a test red** (H5 / H6), then revert both edits: remove `known` from `underscore emphasis` (its two checks fail with a `toEqual` diff), and add `known: { parity: 'underscoreEmphasis' }` to `paragraph` (that test fails with the "now holds" message).
11. **Full suite.** From `packages/lib`: `npm run test` (test typecheck plus all of vitest). Check: `git diff --stat master -- packages/lib/src` prints nothing.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/harness.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/types.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/corpus/index.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Create | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |

---

## Expected Behaviour

All unit-testable under the modelled DOM. Runs are written `'text'{marks}@href`; `{}` means no marks, no link, no style.

### Viewer projection (`markdown-view-model.test.ts`)

| # | `viewerModel(source)` for source | Expected |
|---|---|---|
| V1 | `A **b** c` | blocks `[paragraph ['A '{}, 'b'{bold}, ' c'{}]]` |
| V2 | `***both***` | one run `'both'{bold, italic}` |
| V3 | `a\nb` | one run `'a b'{}` |
| V4 | `[x]\n\n[x]: https://e.com` | blocks `[paragraph ['x'@https://e.com, title null]]` — the definition adds no block |
| V5 | `---` | blocks `[raw '---']` |
| V6 | the empty string, and `\n\n\n` | blocks `[]`, headingIds `[]` |
| V7 | `    foo\n` | blocks `[code lang null, text 'foo']` |
| V8 | `![a](data:image/svg+xml;base64,AAAA)` | blocks `[]` (rejected image, empty paragraph dropped) |
| V9 | `[**bold** span]{color=blue}` | equal to `viewerModel('[**bold**]{color=blue}[ span]{color=blue}')` |
| V10 | `# a\n# a` | headingIds `['a', 'a-1']` |
| V11 | `- a\n\n- b` | blocks `[list ordered false, loose true, items [[paragraph ['a']], [paragraph ['b']]]]` |
| V12 | `\| a \|\n\| --- \|\n\| x \|` | `[table widths [null], header [{align null, colSpan 1, rowSpan 1, runs ['a']}], rows [[{align null, colSpan 1, rowSpan 1, runs ['x']}]]]` |
| V13 | ```` ```js extra\nx\n``` ```` | blocks `[code lang 'js', text 'x']` |
| V14 | `[t](https://e.com "T")` | one run `'t'@https://e.com` with title `'T'`; `linkTargets` → `['https://e.com']` |

### Editor surface projection (`markdown-view-model.test.ts`)

Each row builds `new MarkdownEditor()` and calls `setValue(source)` (`harness.ts` does not exist yet at step 5).

| # | Source | Expected `editorSurfaceModel(editor)` |
|---|---|---|
| S1 | the empty string | `[]` (Lexical's lone empty paragraph is dropped) |
| S2 | `line one\nline two` | `[paragraph ['line one', break, 'line two']]` |
| S3 | `- a\n    - nested\n- c` | equal to `viewerModel(source).blocks`: one list with items `[paragraph ['a'], list [[paragraph ['nested']]]]` and `[paragraph ['c']]` |
| S4 | `\| a \| b \|\n\| :--- {width=240} \| ---: \|\n\| 1 \| 2 \|` | equal to `viewerModel(source).blocks`; widths `[240, null]`, header aligns `left`, `right` |
| S5 | `::: columns {gap=2rem}\nA\n\|\|\|\nB\n\|\|\|\nC\n:::` | equal to `viewerModel(source).blocks`: one `fence`, `columnGap` `2rem`, three columns |
| S6 | `A [red]{color=#cc0000} word.` | equal to `viewerModel(source).blocks` (run `'red'` with style color `#cc0000`) |
| S7 | `![d](/img/d.png){width=320}` | equal to `viewerModel(source).blocks` (one `image` run, width 320) |
| S8 | `> a quoted line` | `[quote [paragraph ['a quoted line']]]` |

### Harness (`markdown-roundtrip.test.ts`)

| # | Situation | Expected |
|---|---|---|
| H1 | `assertCheck` on a case with no `known`, equal values | does not throw |
| H2 | same, unequal values | throws |
| H3 | case with `known: { parity: 'underscoreEmphasis' }`, unequal values | does not throw; `checkTitle` is `parity (known divergence: underscoreEmphasis)` |
| H4 | same case, equal values | throws an error whose message contains `now holds` and `underscoreEmphasis` |
| H5 | corpus case `underscore emphasis` with its `known` removed | its parity and surface tests fail (manual check, step 10) |
| H6 | corpus case `paragraph` with `known: { parity: 'underscoreEmphasis' }` added | its parity test fails with the "now holds" message (manual check, step 10) |
| H7 | the seeded corpus | all green; 238 known entries; every `DIVERGENCES` id used; names unique |
| H8 | witness `duplicate definitions` | `links` `['https://one']` — the first definition wins |

---

## Verification

- `npx vitest run tests/component/markdown-roundtrip` (from `packages/lib`) — all green, counts as in step 8.
- `npm run test` (from `packages/lib`) — test typecheck and the full suite green.
- `git diff --stat master -- packages/lib/src` — empty.
- Manual H5 / H6, reverted afterwards.
- In a worktree, symlink `node_modules` (repo root and `packages/lib`) to the main tree before running vitest.

---

## Potential Challenges

- **The viewer changes.** A viewer fix (for example rendering `---` as `<hr>`, or the in-flight `feature/markdown-viewer-link-reference-definitions`) changes `viewerModel` for some cases. Add the new token type to the viewer rule table and its own V-row, then re-run; flipped entries announce themselves.
- **The parked reference-link branch.** If `feature/markdown-link-reference-definitions` is ever merged, most of the 63 `referenceLinks` entries start to hold and fail as "now holds"; remove them in that merge.
- **`marked` or Lexical upgrades** can move the baseline the same way. Treat every flip as a review item: a new pass removes an entry, a new failure needs a reason before it is listed.
- **Suite time.** 281 cases build four editors each. The measuring probe built two per case for all 281 in about half a second, so the harness should take a few seconds and needs no timeout change.
- **Code-convention weight in data files.** The corpus modules are long one-line object literals; keep them one case per line so a diff shows one case per changed line.

---

## Handover to the Editor-Conversion Plan

The later plan that swaps `$convertFromMarkdownString` / `$convertToMarkdownString` for a `marked`-token importer and an own serializer uses this harness as its acceptance gate:

- Its test-first loop is "make a known entry flip". Each converted construct turns some `known` entries red with "now holds"; the implementer deletes them, and deletes a `DIVERGENCES` entry once `corpus integrity` reports it unused.
- A red test on a check with no `known` entry is a regression the conversion introduced.
- `viewerModel` is the importer's specification: the editor tree it builds must project to the same blocks (the surface check).
- The reason catalogue groups the work by cause: `escaping` and `inline-rules` belong to the serializer and inline import, `block-rules` and `unmodelled` to the block importer and any new nodes.
- That plan adds corpus cases for constructs it newly supports, and decides whether a byte-exact *canonical output* check is wanted; this harness compares meaning, not bytes.

---

## Critical Files

- [`packages/lib/tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts) — headless-editor setup (lines 32–49), `CORPUS` (51), `lexicalOf` (86), the existing idempotence (885) and viewer-token fidelity (1152) tests the harness generalises.
- [`packages/lib/tests/unit/import-without-dom.test.ts`](packages/lib/tests/unit/import-without-dom.test.ts) — the inverted known-failure precedent (lines 19, 53).
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — the render dispatch the viewer projection mirrors (1637–1651, 1969–2056), `extractMarkdownHeadings` (2219), `CELL_PARAGRAPH_BREAK` (70).
- [`packages/lib/src/typescript/lib/component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts) — `lexMarkdown` and the dialect tokens (`mdblock`, `mdimage`, `underline`, `styledspan`).
- [`packages/lib/src/typescript/lib/component/display/markdownAttributes.ts`](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts) — `resolveSpanStyle`, `cssTextToAttributes`, `resolveBlockStyle`, `resolveImageSpec`.
- [`packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts) — `MdTableToken` shape.
- [`packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `getValue` (1252), `setValue` (1291), `ensureEditor` (2263), the `_editor` field (1086).
- [`packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts), [`markdownImageNode.ts`](packages/lib/src/typescript/lib/component/editor/markdownImageNode.ts), [`markdownTableTransformer.ts`](packages/lib/src/typescript/lib/component/editor/markdownTableTransformer.ts) — the custom node getters the surface projection reads.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `installTestDOM` (1854).

---

## Non-Goals

- **No production change.** Fixing any listed divergence, in the editor or the viewer, belongs to the editor-conversion plan or a viewer plan.
- **No change to `markdown-editor.test.ts`.** Its `CORPUS`, idempotence and token-fidelity tests overlap the harness, but both unmerged source-mode branches edit that file.[^branch-overlap]
- **No byte-exact output contract.** Parity compares meaning; idempotence compares one save with the next. A canonical-serialization check is the conversion plan's decision.
- **No source-mode coverage.** Source mode stores raw text and needs no conversion.
- **No commands or typing.** The harness covers load and save only; WYSIWYG editing commands keep their own tests.
- **No changelog or docs entry.** The change is invisible to consumers.

---

## Addendum: Divergence Catalogue

The full content of `corpus/divergences.ts` (add JSDoc to match the conventions; keep the ids, causes and reason texts).

```typescript
/** Which root cause a known divergence belongs to — the editor-conversion plan works through them by cause. */
export type DivergenceCause =
    | 'unmodelled'     // the editor has no node or transformer for a construct the viewer renders
    | 'block-rules'    // a line/regex block transformer disagrees with marked's CommonMark block rules
    | 'inline-rules'   // a text-format/text-match transformer disagrees with marked's inline rules
    | 'escaping';      // Lexical's import unescaping or export escaping changes the text

/** One reviewed reason a corpus check fails on the current editor. */
export interface DivergenceReason {
    readonly cause:  DivergenceCause;
    readonly reason: string;
}

/** Every known divergence of the current editor, keyed by the id a corpus case's `known` entry names. */
export const DIVERGENCES = {
    // unmodelled
    referenceLinks: { cause: 'unmodelled', reason: 'The editor has no reference-link or definition node: [text][ref], [ref][] and [ref] show as literal text, and each definition shows as a paragraph the viewer does not render.' },
    autolinks:      { cause: 'unmodelled', reason: 'The editor has no autolink support: <scheme:…>, <name@host> and bare https:// URLs show as plain text where the viewer links them.' },
    lineBreaks:     { cause: 'unmodelled', reason: 'The editor shows each line break inside a paragraph as a line break (a LineBreakNode); the viewer flows the lines into one, rendering neither a soft break nor marked\'s br token as a break.' },
    thematicBreak:  { cause: 'unmodelled', reason: 'The editor has no thematic-break node: ---, ***, ___ and - - - import as paragraph or list text (*** and ___ save escaped), while the viewer prints the break\'s source as a raw text block.' },
    quoteBlocks:    { cause: 'unmodelled', reason: 'QuoteNode holds inline content only: a heading, list, code fence, nested quote or second paragraph inside a blockquote imports as text, and a blank > line saves as > >.' },
    listItemBlocks: { cause: 'unmodelled', reason: 'ListItemNode holds inline content and nested lists only, with no loose/tight flag: a second paragraph or a heading inside an item leaves the item or shows as text, and a loose list saves tight.' },
    rawHtml:        { cause: 'unmodelled', reason: 'Raw HTML is text to both, but the viewer prints an HTML block as one raw text block while the editor shows a paragraph with line breaks.' },
    taskListMarker: { cause: 'unmodelled', reason: 'marked lexes [ ] as a checkbox token the viewer prints as raw text ahead of the item\'s paragraph; the editor keeps it inside the item\'s text (same characters, different structure).' },
    // block-rules
    setextHeading:      { cause: 'block-rules', reason: 'HEADING reads only ATX # headings; a setext === or --- underline stays paragraph text in the editor.' },
    atxHeadingRules:    { cause: 'block-rules', reason: 'HEADING differs from CommonMark ATX rules: it keeps a closing # sequence as heading text, rejects 1-3 spaces of indentation, and does not read a bare # as an empty heading.' },
    indentedCode:       { cause: 'block-rules', reason: 'The editor has no indented-code rule: lines indented four spaces or a tab import as paragraph text.' },
    tildeFence:         { cause: 'block-rules', reason: 'CODE recognises only backtick fences: a ~~~ fence imports as paragraph text and saves escaped.' },
    fenceInfoString:    { cause: 'block-rules', reason: 'CODE keeps only the first word of the info string and moves the rest into the code body, and reads a ``` aa ``` line as a fence opener where marked reads a code span.' },
    pipelessTable:      { cause: 'block-rules', reason: 'The viewer\'s table extension reads a text line followed by a --- line as a one-column table even without pipes; the editor\'s TABLE transformer requires a pipe, so it shows paragraph text.' },
    quoteContinuation:  { cause: 'block-rules', reason: 'The editor folds a lazy continuation line into the blockquote and saves it with a > prefix, which changes how marked reads that line.' },
    listNesting:        { cause: 'block-rules', reason: 'The list transformers nest by four-space steps: a list indented two or three spaces flattens into its parent.' },
    listMarkers:        { cause: 'block-rules', reason: 'The list transformers differ from CommonMark list-item rules: 1) is not a list, a ten-digit number is, a bullet-character change does not start a new list, and an empty - item or - - foo is text.' },
    styleLessFence:     { cause: 'block-rules', reason: 'BLOCK unwraps a one-column ::: fence with no valid attribute (::: x, the legacy {columns=2}) into plain paragraphs, by design, while the viewer still renders the fence\'s empty wrapper.' },
    // inline-rules
    underscoreEmphasis: { cause: 'inline-rules', reason: 'The editor imports only * and ** emphasis (ITALIC_STAR, BOLD_STAR): _x_ and __x__ stay text and save escaped.' },
    singleTildeStrike:  { cause: 'inline-rules', reason: 'marked reads ~x~ as strikethrough; STRIKETHROUGH needs ~~, so the text stays plain and saves escaped.' },
    lineSpanningInline: { cause: 'inline-rules', reason: 'The inline transformers match within one line: emphasis or a code span that crosses a line break stays text and saves escaped.' },
    linkDestinations:   { cause: 'inline-rules', reason: 'LINK accepts only a destination with no spaces, angle brackets or nested parentheses, and not an empty ().' },
    linkPrecedence:     { cause: 'inline-rules', reason: 'LINK ignores CommonMark precedence: a code span or an escaped bracket inside the text, or a link nested in link text, decides the link differently.' },
    plainImage:         { cause: 'inline-rules', reason: 'An image that is not exactly ![alt](src){…} imports through LINK as ! plus a link, or as text; the saved text is unchanged, but the editor shows a link where the viewer shows an image or its alt text.' },
    underlineRule:      { cause: 'inline-rules', reason: 'UNDERLINE, a Lexical text-format transformer, accepts + inside ++…++; the viewer\'s underline extension does not.' },
    emphasisAroundLink: { cause: 'inline-rules', reason: 'The export closes emphasis before a link and reopens it inside the link, which moves the space before the link out of the emphasis.' },
    styledSpanInStrong: { cause: 'inline-rules', reason: 'A styled span wrapped in **…** loses its bold on import.' },
    // escaping
    unescapedPunctuation: { cause: 'escaping', reason: 'Lexical\'s import drops a backslash escape (even inside a code span, where CommonMark keeps it) and the export does not restore it, so the escaped character becomes live Markdown on save.' },
    decodedEntities:      { cause: 'escaping', reason: 'Lexical\'s import decodes numeric character references such as &#35; and the export writes the decoded character, while the viewer shows the reference text.' },
    backslashAccumulates: { cause: 'escaping', reason: 'The export escapes a literal backslash the import kept, so every save adds another backslash.' },
    formatNesting:        { cause: 'escaping', reason: 'The export writes overlapping formats (italic around bold and a code span) as marker runs its own import reads back differently, so a second save changes the text again.' },
} as const satisfies Record<string, DivergenceReason>;

/** The id a corpus case's `known` entry names. */
export type DivergenceId = keyof typeof DIVERGENCES;
```

## Addendum: Seed Corpus and Baseline

Copy each listing verbatim into its module's array; one case per line.[^seed-sources] Each module imports `CorpusCase` from `./types`. A `known` entry is the measured baseline on `575ba825`; `links` is the witness for the reference-link group.

```typescript
// corpus/commonmark.ts — 155 cases (CommonMark Spec 0.31.2 examples)
export const COMMONMARK_CASES: readonly CorpusCase[] = [
    { name: 'CommonMark 1 (Tabs)', source: '\tfoo\tbaz\t\tbim\n', known: { surface: 'indentedCode' } },
    { name: 'CommonMark 10 (Tabs)', source: '#\tFoo\n' },
    { name: 'CommonMark 15 (Backslash escapes)', source: '\\\\*emphasis*\n' },
    { name: 'CommonMark 16 (Backslash escapes)', source: 'foo\\\nbar\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 17 (Backslash escapes)', source: '`` \\[\\` ``\n', known: { parity: 'unescapedPunctuation', surface: 'unescapedPunctuation' } },
    { name: 'CommonMark 19 (Backslash escapes)', source: '~~~\n\\[\\]\n~~~\n', known: { parity: 'tildeFence', surface: 'tildeFence' } },
    { name: 'CommonMark 22 (Backslash escapes)', source: '[foo](/bar\\* "ti\\*tle")\n' },
    { name: 'CommonMark 23 (Backslash escapes)', source: '[foo]\n\n[foo]: /bar\\* "ti\\*tle"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 26 (Entity and numeric character references)', source: '&#35; &#1234; &#992; &#0;\n', known: { parity: 'decodedEntities', surface: 'decodedEntities' } },
    { name: 'CommonMark 29 (Entity and numeric character references)', source: '&copy\n' },
    { name: 'CommonMark 32 (Entity and numeric character references)', source: '[foo](/f&ouml;&ouml; "f&ouml;&ouml;")\n' },
    { name: 'CommonMark 35 (Entity and numeric character references)', source: '`f&ouml;&ouml;`\n' },
    { name: 'CommonMark 37 (Entity and numeric character references)', source: '&#42;foo&#42;\n*foo*\n', known: { parity: 'decodedEntities', surface: 'decodedEntities' } },
    { name: 'CommonMark 38 (Entity and numeric character references)', source: '&#42; foo\n\n* foo\n', known: { parity: 'decodedEntities', surface: 'decodedEntities' } },
    { name: 'CommonMark 43 (Thematic breaks)', source: '***\n---\n___\n', known: { surface: 'pipelessTable' } },
    { name: 'CommonMark 46 (Thematic breaks)', source: '--\n**\n__\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 57 (Thematic breaks)', source: '- foo\n***\n- bar\n', known: { parity: 'thematicBreak', surface: 'thematicBreak' } },
    { name: 'CommonMark 59 (Thematic breaks)', source: 'Foo\n---\nbar\n', known: { surface: 'pipelessTable' } },
    { name: 'CommonMark 62 (ATX headings)', source: '# foo\n## foo\n### foo\n#### foo\n##### foo\n###### foo\n' },
    { name: 'CommonMark 63 (ATX headings)', source: '####### foo\n' },
    { name: 'CommonMark 64 (ATX headings)', source: '#5 bolt\n\n#hashtag\n' },
    { name: 'CommonMark 65 (ATX headings)', source: '\\## foo\n', known: { parity: 'unescapedPunctuation' } },
    { name: 'CommonMark 66 (ATX headings)', source: '# foo *bar* \\*baz\\*\n' },
    { name: 'CommonMark 71 (ATX headings)', source: '## foo ##\n  ###   bar    ###\n', known: { surface: 'atxHeadingRules' } },
    { name: 'CommonMark 76 (ATX headings)', source: '### foo \\###\n## foo #\\##\n# foo \\#\n', known: { parity: 'unescapedPunctuation' } },
    { name: 'CommonMark 78 (ATX headings)', source: 'Foo bar\n# baz\nBar foo\n' },
    { name: 'CommonMark 79 (ATX headings)', source: '## \n#\n### ###\n', known: { surface: 'atxHeadingRules' } },
    { name: 'CommonMark 80 (Setext headings)', source: 'Foo *bar*\n=========\n\nFoo *bar*\n---------\n', known: { surface: 'setextHeading' } },
    { name: 'CommonMark 83 (Setext headings)', source: 'Foo\n-------------------------\n\nFoo\n=\n', known: { surface: 'setextHeading' } },
    { name: 'CommonMark 92 (Setext headings)', source: '> Foo\n---\n', known: { parity: 'quoteContinuation', surface: 'pipelessTable' } },
    { name: 'CommonMark 95 (Setext headings)', source: 'Foo\nBar\n---\n', known: { surface: 'setextHeading' } },
    { name: 'CommonMark 107 (Indented code blocks)', source: '    a simple\n      indented code block\n', known: { surface: 'indentedCode' } },
    { name: 'CommonMark 113 (Indented code blocks)', source: 'Foo\n    bar\n\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 114 (Indented code blocks)', source: '    foo\nbar\n', known: { surface: 'indentedCode' } },
    { name: 'CommonMark 119 (Fenced code blocks)', source: '```\n<\n >\n```\n' },
    { name: 'CommonMark 120 (Fenced code blocks)', source: '~~~\n<\n >\n~~~\n', known: { parity: 'tildeFence', surface: 'tildeFence' } },
    { name: 'CommonMark 122 (Fenced code blocks)', source: '```\naaa\n~~~\n```\n' },
    { name: 'CommonMark 124 (Fenced code blocks)', source: '````\naaa\n```\n``````\n' },
    { name: 'CommonMark 128 (Fenced code blocks)', source: '> ```\n> aaa\n\nbbb\n', known: { parity: 'quoteBlocks', surface: 'quoteBlocks' } },
    { name: 'CommonMark 140 (Fenced code blocks)', source: 'foo\n```\nbar\n```\nbaz\n' },
    { name: 'CommonMark 142 (Fenced code blocks)', source: '```ruby\ndef foo(x)\n  return 3\nend\n```\n' },
    { name: 'CommonMark 145 (Fenced code blocks)', source: '``` aa ```\nfoo\n', known: { parity: 'fenceInfoString', surface: 'fenceInfoString' } },
    { name: 'CommonMark 147 (Fenced code blocks)', source: '```\n``` aaa\n```\n' },
    { name: 'CommonMark 192 (Link reference definitions)', source: '[foo]: /url "title"\n\n[foo]\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 198 (Link reference definitions)', source: '[foo]:\n/url\n\n[foo]\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 203 (Link reference definitions)', source: '[foo]\n\n[foo]: url\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 204 (Link reference definitions)', source: '[foo]\n\n[foo]: first\n[foo]: second\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 205 (Link reference definitions)', source: '[FOO]: /url\n\n[Foo]\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 208 (Link reference definitions)', source: '[\nfoo\n]: /url\nbar\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 211 (Link reference definitions)', source: '    [foo]: /url "title"\n\n[foo]\n', known: { surface: 'indentedCode' } },
    { name: 'CommonMark 212 (Link reference definitions)', source: '```\n[foo]: /url\n```\n\n[foo]\n' },
    { name: 'CommonMark 213 (Link reference definitions)', source: 'Foo\n[bar]: /baz\n\n[bar]\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 214 (Link reference definitions)', source: '# [Foo]\n[foo]: /url\n> bar\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 216 (Link reference definitions)', source: '[foo]: /url\n===\n[foo]\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 218 (Link reference definitions)', source: '[foo]\n\n> [foo]: /url\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 219 (Paragraphs)', source: 'aaa\n\nbbb\n' },
    { name: 'CommonMark 220 (Paragraphs)', source: 'aaa\nbbb\n\nccc\nddd\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 222 (Paragraphs)', source: '  aaa\n bbb\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 226 (Paragraphs)', source: 'aaa     \nbbb     \n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 228 (Block quotes)', source: '> # Foo\n> bar\n> baz\n', known: { surface: 'quoteBlocks' } },
    { name: 'CommonMark 232 (Block quotes)', source: '> # Foo\n> bar\nbaz\n', known: { surface: 'quoteBlocks' } },
    { name: 'CommonMark 234 (Block quotes)', source: '> foo\n---\n', known: { parity: 'quoteContinuation', surface: 'pipelessTable' } },
    { name: 'CommonMark 235 (Block quotes)', source: '> - foo\n- bar\n', known: { surface: 'quoteBlocks' } },
    { name: 'CommonMark 237 (Block quotes)', source: '> ```\nfoo\n```\n', known: { parity: 'quoteBlocks', surface: 'quoteBlocks' } },
    { name: 'CommonMark 242 (Block quotes)', source: '> foo\n\n> bar\n' },
    { name: 'CommonMark 244 (Block quotes)', source: '> foo\n>\n> bar\n', known: { parity: 'quoteBlocks', surface: 'quoteBlocks' } },
    { name: 'CommonMark 250 (Block quotes)', source: '> > > foo\nbar\n', known: { surface: 'quoteBlocks' } },
    { name: 'CommonMark 253 (List items)', source: 'A paragraph\nwith two lines.\n\n    indented code\n\n> A block quote.\n', known: { surface: 'indentedCode' } },
    { name: 'CommonMark 256 (List items)', source: '- one\n\n  two\n', known: { surface: 'listItemBlocks' } },
    { name: 'CommonMark 265 (List items)', source: '123456789. ok\n' },
    { name: 'CommonMark 266 (List items)', source: '1234567890. not ok\n', known: { surface: 'listMarkers' } },
    { name: 'CommonMark 280 (List items)', source: '-\n\n  foo\n', known: { surface: 'listMarkers' } },
    { name: 'CommonMark 281 (List items)', source: '- foo\n-\n- bar\n', known: { surface: 'pipelessTable' } },
    { name: 'CommonMark 294 (List items)', source: '- foo\n  - bar\n    - baz\n      - boo\n', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'CommonMark 296 (List items)', source: '10) foo\n    - bar\n', known: { parity: 'listMarkers', surface: 'listMarkers' } },
    { name: 'CommonMark 298 (List items)', source: '- - foo\n', known: { surface: 'listMarkers' } },
    { name: 'CommonMark 300 (List items)', source: '- # Foo\n- Bar\n  ---\n  baz\n', known: { surface: 'listItemBlocks' } },
    { name: 'CommonMark 301 (Lists)', source: '- foo\n- bar\n+ baz\n', known: { parity: 'listMarkers', surface: 'listMarkers' } },
    { name: 'CommonMark 303 (Lists)', source: 'Foo\n- bar\n- baz\n' },
    { name: 'CommonMark 306 (Lists)', source: '- foo\n\n- bar\n\n\n- baz\n', known: { parity: 'listItemBlocks', surface: 'listItemBlocks' } },
    { name: 'CommonMark 314 (Lists)', source: '- a\n- b\n\n- c\n', known: { parity: 'listItemBlocks', surface: 'listItemBlocks' } },
    { name: 'CommonMark 316 (Lists)', source: '- a\n- b\n\n  c\n- d\n', known: { surface: 'listItemBlocks' } },
    { name: 'CommonMark 319 (Lists)', source: '- a\n  - b\n\n    c\n- d\n', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'CommonMark 323 (Lists)', source: '- a\n  - b\n', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'CommonMark 326 (Lists)', source: '- a\n  - b\n  - c\n\n- d\n  - e\n  - f\n', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'CommonMark 328 (Code spans)', source: '`foo`\n' },
    { name: 'CommonMark 329 (Code spans)', source: '`` foo ` bar ``\n' },
    { name: 'CommonMark 335 (Code spans)', source: '``\nfoo\nbar  \nbaz\n``\n', known: { parity: 'lineSpanningInline', surface: 'lineSpanningInline' } },
    { name: 'CommonMark 338 (Code spans)', source: '`foo\\`bar`\n' },
    { name: 'CommonMark 341 (Code spans)', source: '*foo`*`\n' },
    { name: 'CommonMark 342 (Code spans)', source: '[not a `link](/foo`)\n', known: { parity: 'linkPrecedence', surface: 'linkPrecedence' } },
    { name: 'CommonMark 350 (Emphasis and strong emphasis)', source: '*foo bar*\n' },
    { name: 'CommonMark 351 (Emphasis and strong emphasis)', source: 'a * foo bar*\n' },
    { name: 'CommonMark 355 (Emphasis and strong emphasis)', source: 'foo*bar*\n' },
    { name: 'CommonMark 357 (Emphasis and strong emphasis)', source: '_foo bar_\n', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'CommonMark 360 (Emphasis and strong emphasis)', source: 'foo_bar_\n' },
    { name: 'CommonMark 376 (Emphasis and strong emphasis)', source: '_foo_bar_baz_\n', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'CommonMark 378 (Emphasis and strong emphasis)', source: '**foo bar**\n' },
    { name: 'CommonMark 381 (Emphasis and strong emphasis)', source: 'foo**bar**\n' },
    { name: 'CommonMark 382 (Emphasis and strong emphasis)', source: '__foo bar__\n', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'CommonMark 389 (Emphasis and strong emphasis)', source: '__foo, __bar__, baz__\n', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'CommonMark 404 (Emphasis and strong emphasis)', source: '*foo [bar](/url)*\n', known: { parity: 'emphasisAroundLink' } },
    { name: 'CommonMark 410 (Emphasis and strong emphasis)', source: '*foo **bar** baz*\n' },
    { name: 'CommonMark 414 (Emphasis and strong emphasis)', source: '*foo **bar***\n' },
    { name: 'CommonMark 420 (Emphasis and strong emphasis)', source: '** is not an empty emphasis\n' },
    { name: 'CommonMark 428 (Emphasis and strong emphasis)', source: '**foo *bar* baz**\n' },
    { name: 'CommonMark 437 (Emphasis and strong emphasis)', source: 'foo *\\**\n' },
    { name: 'CommonMark 461 (Emphasis and strong emphasis)', source: '*_foo_*\n', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'CommonMark 467 (Emphasis and strong emphasis)', source: '***foo***\n' },
    { name: 'CommonMark 473 (Emphasis and strong emphasis)', source: '*[bar*](/url)\n' },
    { name: 'CommonMark 478 (Emphasis and strong emphasis)', source: '*a `*`*\n' },
    { name: 'CommonMark 482 (Links)', source: '[link](/uri "title")\n' },
    { name: 'CommonMark 483 (Links)', source: '[link](/uri)\n' },
    { name: 'CommonMark 485 (Links)', source: '[link]()\n', known: { surface: 'linkDestinations' } },
    { name: 'CommonMark 488 (Links)', source: '[link](/my uri)\n' },
    { name: 'CommonMark 489 (Links)', source: '[link](</my uri>)\n', known: { surface: 'linkDestinations' } },
    { name: 'CommonMark 496 (Links)', source: '[link](foo(and(bar)))\n', known: { surface: 'linkDestinations' } },
    { name: 'CommonMark 498 (Links)', source: '[link](foo\\(and\\(bar\\))\n', known: { parity: 'unescapedPunctuation', surface: 'linkDestinations' } },
    { name: 'CommonMark 506 (Links)', source: '[link](/url "title \\"&quot;")\n' },
    { name: 'CommonMark 512 (Links)', source: '[link [foo [bar]]](/uri)\n', known: { surface: 'linkPrecedence' } },
    { name: 'CommonMark 515 (Links)', source: '[link \\[bar](/uri)\n', known: { parity: 'linkPrecedence', idempotence: 'backslashAccumulates', surface: 'linkPrecedence' } },
    { name: 'CommonMark 516 (Links)', source: '[link *foo **bar** `#`*](/uri)\n', known: { idempotence: 'formatNesting' } },
    { name: 'CommonMark 517 (Links)', source: '[![moon](moon.jpg)](/uri)\n', known: { surface: 'plainImage' } },
    { name: 'CommonMark 518 (Links)', source: '[foo [bar](/uri)](/uri)\n', known: { surface: 'linkPrecedence' } },
    { name: 'CommonMark 521 (Links)', source: '*[foo*](/uri)\n' },
    { name: 'CommonMark 527 (Links)', source: '[foo][bar]\n\n[bar]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 529 (Links)', source: '[link \\[bar][ref]\n\n[ref]: /uri\n', known: { parity: 'unescapedPunctuation', surface: 'referenceLinks' } },
    { name: 'CommonMark 539 (Links)', source: '[foo][BaR]\n\n[bar]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 542 (Links)', source: '[foo] [bar]\n\n[bar]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 543 (Links)', source: '[foo]\n[bar]\n\n[bar]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 545 (Links)', source: '[bar][foo\\!]\n\n[foo!]: /url\n', known: { parity: 'unescapedPunctuation', surface: 'referenceLinks' } },
    { name: 'CommonMark 553 (Links)', source: '[foo][]\n\n[foo]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 554 (Links)', source: '[*foo* bar][]\n\n[*foo* bar]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 557 (Links)', source: '[foo]\n\n[foo]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 563 (Links)', source: '\\[foo]\n\n[foo]: /url "title"\n', known: { parity: 'unescapedPunctuation', surface: 'referenceLinks' } },
    { name: 'CommonMark 566 (Links)', source: '[foo][]\n\n[foo]: /url1\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 567 (Links)', source: '[foo]()\n\n[foo]: /url1\n', known: { surface: 'linkDestinations' } },
    { name: 'CommonMark 569 (Links)', source: '[foo][bar][baz]\n\n[baz]: /url\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 572 (Images)', source: '![foo](/url "title")\n', known: { surface: 'plainImage' } },
    { name: 'CommonMark 578 (Images)', source: '![foo](train.jpg)\n', known: { surface: 'plainImage' } },
    { name: 'CommonMark 581 (Images)', source: '![](/url)\n' },
    { name: 'CommonMark 582 (Images)', source: '![foo][bar]\n\n[bar]: /url\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 584 (Images)', source: '![foo][]\n\n[foo]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 588 (Images)', source: '![foo]\n\n[foo]: /url "title"\n', known: { surface: 'referenceLinks' } },
    { name: 'CommonMark 594 (Autolinks)', source: '<http://foo.bar.baz>\n', known: { surface: 'autolinks' } },
    { name: 'CommonMark 597 (Autolinks)', source: '<MAILTO:FOO@BAR.BAZ>\n', known: { surface: 'autolinks' } },
    { name: 'CommonMark 604 (Autolinks)', source: '<foo@bar.example.com>\n', known: { surface: 'autolinks' } },
    { name: 'CommonMark 611 (Autolinks)', source: 'https://example.com\n', known: { surface: 'autolinks' } },
    { name: 'CommonMark 633 (Hard line breaks)', source: 'foo  \nbaz\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 634 (Hard line breaks)', source: 'foo\\\nbaz\n', known: { surface: 'lineBreaks' } },
    { name: 'CommonMark 638 (Hard line breaks)', source: '*foo  \nbar*\n', known: { parity: 'lineSpanningInline', surface: 'lineSpanningInline' } },
    { name: 'CommonMark 640 (Hard line breaks)', source: '`code  \nspan`\n', known: { parity: 'lineSpanningInline', surface: 'lineSpanningInline' } },
    { name: 'CommonMark 644 (Hard line breaks)', source: 'foo\\\n' },
    { name: 'CommonMark 646 (Hard line breaks)', source: '### foo\\\n' },
    { name: 'CommonMark 648 (Soft line breaks)', source: 'foo\nbaz\n', known: { surface: 'lineBreaks' } },
];
```

```typescript
// corpus/dialect.ts — 82 cases (the editor test's CORPUS first, then dialect probes)
export const DIALECT_CASES: readonly CorpusCase[] = [
    { name: 'heading h1', source: '# Heading one' },
    { name: 'heading h2', source: '## Heading two' },
    { name: 'heading h6', source: '###### Heading six' },
    { name: 'paragraph', source: 'A plain paragraph of prose.' },
    { name: 'inline formats', source: 'Text with **bold**, *italic*, and `inline code`.' },
    { name: 'strikethrough', source: '~~struck~~ text' },
    { name: 'unordered list', source: '- one\n- two\n- three' },
    { name: 'ordered list', source: '1. first\n2. second' },
    { name: 'blockquote', source: '> a quoted line' },
    { name: 'fenced code', source: '```\nplain code\n```' },
    { name: 'fenced code lang', source: '```js\nconst x = 1;\n```' },
    { name: 'link', source: 'A [link](https://example.com) in prose.' },
    { name: 'table', source: '| a | b |\n| --- | --- |\n| 1 | 2 |' },
    { name: 'table aligned', source: '| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |' },
    { name: 'table escaped pipe', source: '| a | b |\n| --- | --- |\n| x | `p \\| q` |' },
    { name: 'underline', source: 'A ++word++ here.' },
    { name: 'styled text color', source: 'A [red]{color=#cc0000} word.' },
    { name: 'styled text font/size', source: 'A [big]{font=Georgia size=1.2em} word.' },
    { name: 'block alignment', source: '::: {align=center}\ntext\n:::' },
    { name: 'block columns', source: '::: columns\nLeft\n|||\nRight\n:::' },
    { name: 'block columns aligned', source: '::: columns {align=center}\nA\n|||\nB\n:::' },
    { name: 'sized image', source: '![d](/img/d.png){width=320}' },
    { name: 'heading underscore', source: '# my_title' },
    { name: 'heading repeated text', source: '# a\n# a' },
    { name: 'ordered list start 3', source: '3. three\n4. four' },
    { name: 'ordered list paren', source: '1) paren', known: { surface: 'listMarkers' } },
    { name: 'nested list two-space', source: '- a\n  - nested\n- c', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'nested ordered list', source: '1. a\n   1. nested ordered', known: { parity: 'listNesting', surface: 'listNesting' } },
    { name: 'nested list four-space', source: '- a\n    - nested\n- c' },
    { name: 'task-list marker', source: '- [ ] task', known: { surface: 'taskListMarker' } },
    { name: 'tilde fence', source: '~~~\ntilde fence\n~~~', known: { parity: 'tildeFence', surface: 'tildeFence' } },
    { name: 'code fence info words', source: '```js extra info\nx\n```', known: { parity: 'fenceInfoString', surface: 'fenceInfoString' } },
    { name: 'code fence in blockquote', source: '> ```\n> code\n> ```', known: { parity: 'quoteBlocks', surface: 'quoteBlocks' } },
    { name: 'multi-paragraph blockquote', source: '> a\n>\n> b', known: { parity: 'quoteBlocks', surface: 'quoteBlocks' } },
    { name: 'underscore emphasis', source: '_under_ and __strong__', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'single-tilde strikethrough', source: '~single~ tilde', known: { parity: 'singleTildeStrike', surface: 'singleTildeStrike' } },
    { name: 'intraword underscore', source: 'snake_case_word' },
    { name: 'lone star', source: 'a * b * c' },
    { name: 'unclosed strong', source: '**unclosed' },
    { name: 'named and numeric entities', source: '&amp; &copy; &#35;', known: { parity: 'decodedEntities', surface: 'decodedEntities' } },
    { name: 'escaped list marker', source: '1\\. not a list', known: { parity: 'unescapedPunctuation' } },
    { name: 'escaped heading marker', source: '\\# not heading', known: { parity: 'unescapedPunctuation' } },
    { name: 'thematic break stars', source: '***', known: { parity: 'thematicBreak', surface: 'thematicBreak' } },
    { name: 'thematic break dashes', source: '---', known: { surface: 'thematicBreak' } },
    { name: 'thematic break underscores', source: '___', known: { parity: 'thematicBreak', surface: 'thematicBreak' } },
    { name: 'plain image', source: '![alt](https://e.com/i.png)', known: { surface: 'plainImage' } },
    { name: 'image disallowed scheme', source: '![alt](javascript:alert(1))', known: { surface: 'plainImage' } },
    { name: 'image svg data', source: '![a](data:image/svg+xml;base64,AAAA)', known: { surface: 'plainImage' } },
    { name: 'image png data', source: '![a](data:image/png;base64,AAAA)', known: { surface: 'plainImage' } },
    { name: 'image width and height', source: '![a](/i.png){width=10 height=20}' },
    { name: 'linked image', source: '[![img](/i.png)](https://e.com)', known: { surface: 'plainImage' } },
    { name: 'link with underscore text', source: '[a_b](https://e.com/a_b)' },
    { name: 'link url with parens', source: '[t](https://e.com/a_(b))', known: { surface: 'linkDestinations' } },
    { name: 'link angle destination', source: '[t](<https://e.com/a b>)', known: { surface: 'linkDestinations' } },
    { name: 'autolink', source: '<https://auto.link>', known: { surface: 'autolinks' } },
    { name: 'bare url', source: 'https://bare.url', known: { surface: 'autolinks' } },
    { name: 'raw inline html', source: '<span>html</span>' },
    { name: 'raw block html', source: '<div>\nblock html\n</div>', known: { surface: 'rawHtml' } },
    { name: 'table without outer pipes', source: 'a | b\n--- | ---\n1 | 2' },
    { name: 'table absorbs trailing line', source: '| a | b |\n| --- | --- |\n| 1 | 2 |\ntrailing prose' },
    { name: 'pipe lines without delimiter', source: '| a | b |\n| 1 | 2 |', known: { surface: 'lineBreaks' } },
    { name: 'table cell emphasis', source: '| a |\n| --- |\n| **b** _i_ |', known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'table cell link', source: '| a |\n| --- |\n| [l](https://e.com) |' },
    { name: 'table column width', source: '| a | b |\n| :--- {width=240} | ---: |\n| 1 | 2 |' },
    { name: 'table merged cell', source: '| a | b |\n| --- | --- |\n| d | << |' },
    { name: 'table merged rows', source: '| a | b | c |\n| --- | --- | --- |\n| d | << | f |\n| ^^ | ^^ | g |' },
    { name: 'table cell underscore', source: '| a |\n| --- |\n| x_y |' },
    { name: 'fence with heading and list', source: '::: {align=right}\n# H\n\n- list\n:::' },
    { name: 'three columns with gap', source: '::: columns {gap=2rem}\nA\n|||\nB\n|||\nC\n:::' },
    { name: 'nested fences', source: '::: {align=center}\n::: {align=right}\ninner\n:::\n:::' },
    { name: 'legacy columns attribute', source: '::: {columns=2}\nold\n:::', known: { parity: 'styleLessFence', surface: 'styleLessFence' } },
    { name: 'gap-only fence', source: '::: {gap=1rem}\nA\n:::' },
    { name: 'attribute-less fence', source: '::: x\nA\n:::', known: { parity: 'styleLessFence', surface: 'styleLessFence' } },
    { name: 'styled span quoted font', source: '[x]{color=red size=2em font="Times New Roman"}' },
    { name: 'styled span with bold', source: '[**bold** span]{color=blue}' },
    { name: 'bold styled span', source: '**[span]{color=red}**', known: { parity: 'styledSpanInStrong', surface: 'styledSpanInStrong' } },
    { name: 'underline wrapping bold', source: '++**bu**++' },
    { name: 'underline with plus', source: '++a+b++', known: { surface: 'underlineRule' } },
    { name: 'empty document', source: '' },
    { name: 'blank lines only', source: '\n\n\n' },
    { name: 'trailing spaces', source: 'trailing spaces   ' },
    { name: 'tab-indented line', source: '\ttab start', known: { surface: 'indentedCode' } },
];
```

```typescript
// corpus/referenceLinks.ts — 44 cases (from feature/markdown-link-reference-definitions)
export const REFERENCE_LINK_CASES: readonly CorpusCase[] = [
    { name: 'every reference form', source: 'See [text][ref] and [ref] and [ref][] and [Ref].\n\n[ref]: https://e.com "T"', links: ['https://e.com', 'https://e.com', 'https://e.com', 'https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'underscores and tildes', source: 'See [go][my_ref] and [my_ref].\n\n[my_ref]: https://e.com/a_b_c~d', links: ['https://e.com/a_b_c~d', 'https://e.com/a_b_c~d'], known: { surface: 'referenceLinks' } },
    { name: 'multi-line definition', source: '[x]\n\n[x]:\n  https://e.com\n  "Title"', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'duplicate definitions', source: '[a]\n\n[a]: https://one\n[a]: https://two', links: ['https://one'], known: { surface: 'referenceLinks' } },
    { name: 'definition continues a paragraph', source: 'para line\n[ref]: https://e.com\n\n[ref]', links: ['https://e.com'], known: { surface: 'autolinks' } },
    { name: 'image reference', source: '![alt][ref] here\n\n[ref]: https://e.com', links: [], known: { surface: 'referenceLinks' } },
    { name: 'inline link and styled span share a label', source: '[ref](https://inline) and [ref]{color=red}\n\n[ref]: https://e.com', links: ['https://inline'], known: { surface: 'referenceLinks' } },
    { name: 'reference inside a link', source: '[see [ref] here](https://outer)\n\n[ref]: https://e.com', links: ['https://outer', 'https://e.com', 'https://outer'], known: { surface: 'referenceLinks' } },
    { name: 'reference inside code', source: '`[ref]` and more\n\n[ref]: https://e.com', links: [], known: { surface: 'referenceLinks' } },
    { name: 'reference in a table cell', source: '| a |\n| --- |\n| [ref] |\n\n[ref]: https://e.com', links: [], known: { surface: 'referenceLinks' } },
    { name: 'reference in a fence', source: '::: {align=center}\n[x] in block\n\n[x]: https://blk\n:::', links: ['https://blk'], known: { surface: 'referenceLinks' } },
    { name: 'escaped underscore label', source: '[a\\_b] and [a\\_b][]\n\n[a\\_b]: https://e.com', links: ['https://e.com', 'https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'entity in a label', source: '[a&#35;b] and [a&#35;b][]\n\n[a&#35;b]: https://e.com', links: ['https://e.com', 'https://e.com'], known: { parity: 'decodedEntities', surface: 'referenceLinks' } },
    { name: 'escaped bracket label', source: '[foo\\]bar]\n\n[foo\\]bar]: https://e.com', links: ['https://e.com'], known: { parity: 'unescapedPunctuation', surface: 'referenceLinks' } },
    { name: 'empty full-form text', source: '[][ref] x\n\n[ref]: https://e.com', links: [], known: { surface: 'referenceLinks' } },
    { name: 'definition then text line', source: '[x]: https://e.com\nafter **b**', links: [], known: { surface: 'referenceLinks' } },
    { name: 'bold shortcut reference', source: 'A **[ref]**\n\n[ref]: https://e.com', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition under a heading', source: '# H\n[my_ref]: https://e.com\n\nSee [my_ref].', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition after a code fence', source: '```\ncode\n```\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition after a fence block', source: '::: {align=center}\nA\n:::\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition after a thematic break', source: '---\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition in a blockquote', source: '> [q]: https://q.com\n\nSee [q].', links: ['https://q.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition in a list item', source: '- [q]: https://q.com\n\nSee [q].', links: ['https://q.com'], known: { surface: 'referenceLinks' } },
    { name: 'underscore definition in a blockquote', source: '> [my_ref]: https://e.com\n\nSee [my_ref].', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'star definition in a list item', source: '- [a*b]: https://e.com\n\nSee [x][a*b].', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition-looking line after a quote', source: '> q\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'autolinks' } },
    { name: 'definition-looking line after a list', source: '- a\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'autolinks' } },
    { name: 'indented definition-shaped line', source: 'para\n    [ref]: https://code\n\n[ref]: https://e.com', links: ['https://e.com', 'https://code'], known: { surface: 'referenceLinks' } },
    { name: 'Object.prototype labels undefined', source: '[constructor] and [__proto__] and [x][toString]', links: [], known: { parity: 'underscoreEmphasis', surface: 'underscoreEmphasis' } },
    { name: 'Object.prototype label defined', source: '[constructor]\n\n[constructor]: https://c.com', links: ['https://c.com'], known: { surface: 'referenceLinks' } },
    { name: 'bold then definition-shaped text', source: '**b** [x]: y\n\n[x]: https://e.com', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'full form followed by colon', source: '[t][ref]: foo\n\n[ref]: https://e.com', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'label broken across lines', source: '[foo\nbar]\n\n[foo bar]: https://e.com', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'bracketed link text', source: '[see [x] y][ref]\n\n[ref]: https://e.com', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition only', source: '[x]: https://e.com', links: [], known: { surface: 'referenceLinks' } },
    { name: 'dashes as a list before a definition', source: '- - -\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'thematicBreak' } },
    { name: 'setext heading before a definition', source: 'Setext\n===\n[x]: https://e.com\n\n[x]', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'undefined references', source: 'see [nope] and [a][b]', links: [] },
    { name: 'retargeted definition order', source: 'A [x] B\n\n[x]: https://one\n\n> [x]: https://two', links: ['https://one'], known: { surface: 'referenceLinks' } },
    { name: 'definition in a code block is not a definition', source: 'A [t][ref] B\n\n[ref]: https://e.com\n\n```\n[ref]: https://code\n```', links: ['https://e.com'], known: { surface: 'referenceLinks' } },
    { name: 'definition in a paragraph continuation', source: 'A [t][ref] B\n\n[ref]: https://e.com\n\npara\n[ref]: https://cont', links: ['https://e.com', 'https://e.com', 'https://cont'], known: { surface: 'referenceLinks' } },
    { name: 'backslash-bang label', source: '[bar][foo\\!]\n\n[foo!]: /url', links: [], known: { parity: 'unescapedPunctuation', surface: 'referenceLinks' } },
    { name: 'definition with trailing junk', source: '[a]\n\n[a]: https://a "t" junk', links: ['https://a'], known: { surface: 'autolinks' } },
    { name: 'reference in a heading', source: '# [Foo]\n\n[foo]: /url', links: ['/url'], known: { surface: 'referenceLinks' } },
];
```

---
## Notes

[^ts-table]: A corpus of `.md` files with front-matter was considered and rejected. These sources depend on exact trailing spaces, tabs and final newlines, which editor whitespace trimming silently changes in a `.md` file but which a TypeScript string literal shows as `\t` and `  \n`. Front-matter would also need a YAML parser the tests do not have, and its `known` ids could not be type-checked against `DIVERGENCES`. The parked branch's `IDENTICAL` table (`tests/component/markdown-reference-links.test.ts` on `feature/markdown-link-reference-definitions`) has the same shape.

[^token-model]: A rendered-DOM snapshot was rejected. Under the modelled DOM the viewer's output exists only as a log of recorded `DOM.sink` writes (`RecordingDOMSink` in `tests/dom/TestDOM.ts`), with no tree to serialise, so a snapshot would need a new tree builder over that log. It would also compare things that carry no meaning here — class names, the wrapper spans the viewer adds around interleaved text, the code-editor upgrade host — and it could not be compared with the editor's Lexical tree, which the surface check needs. The token walk is pure and DOM-free, calls the same resolvers the render path calls, and gives one shape both sides project onto. Its cost is that the projection follows the viewer's dispatch by hand; the V-rows of `markdown-view-model.test.ts` pin it, and *Potential Challenges* covers viewer changes.

[^viewer-oracle]: The requirement is parity with what the viewer shows. Seeding the corpus surfaced viewer behaviour that differs from CommonMark; the harness pins it as the contract rather than fixing it, since each item is out of scope here. (1) The dialect's table extension reads a text line followed by a `---` line as a one-column table even without a pipe, so a setext `Foo\n---` heading and CommonMark 281 (`- foo\n-\n- bar`) render as tables. (2) Entity references such as `&amp;` and `&#35;` show as literal text, because `marked`'s text tokens keep the entity source and the viewer writes token text as text content. (3) Thematic breaks, HTML blocks, `br` hard breaks and task-list checkboxes fall to the viewer's raw-text fallback. (4) An image with a title, or with parentheses in its source, shows its alt text only (CommonMark 572, `![alt](javascript:alert(1))`), because `marked`'s built-in image token reaches the inline text fallback. (5) `[link [foo [bar]]](/uri)` (CommonMark 512) renders as literal text. (6) A reference link in a table cell does not resolve (the gap the parked plan's V5 row covers). A viewer fix changes the oracle, and the harness then reports which entries flipped.

[^def-drop]: Today's viewer prints a `def` token's source as text through its `default:` branch, which the parked plan and the new, still-empty `feature/markdown-viewer-link-reference-definitions` branch set out to fix. Projecting that print would make every definition whose source changes on save — `[my_ref]: …` saved as `[my\_ref]: …`, still resolving to the same URL — a parity failure, though no link changes target. The effect that matters, the URL each reference resolves to, is already in the `link` of the runs that use it, so the projection drops the token.

[^flat-runs]: Comparing the nested token tree was rejected: `marked` nests `***x***` as `em(strong(x))`, Lexical stores one text node with two format bits, and a serializer is free to write either nesting, all rendering the same. Flattening also makes the editor's export of a styled span split around a bold run (`[**bold**]{color=blue}[ span]{color=blue}`) equal to the authored single span, which the viewer renders identically. The whitespace collapse follows the viewer's `white-space: normal` prose rule (`Markdown.ts:732`); code blocks keep their text exactly, as their `pre` rule does.

[^inverted-assert]: vitest's `it.fails` was rejected because it passes on any thrown error, so a known parity divergence would hide a later crash in load or save. The inverted `not.toEqual` passes only when both values were computed and differ, and a throw still fails the test. It also passes when the editor's wrong output changes into a different wrong output; the reason text says what is wrong, and the editor-conversion plan reviews entries as it flips them.

[^reason-catalogue]: A free-text reason per entry would repeat the same sentence dozens of times (63 entries are `referenceLinks`) and drift. One catalogue keyed by id keeps each explanation in one place, lets TypeScript reject a misspelt id, lets the integrity test catch a reason no case uses any more, and gives the conversion plan its work grouped by `cause`.

[^baseline-evidence]: Measured with a throwaway probe test in a worktree at `575ba825`, which ran every seed case through the projection rules this plan specifies and recorded which checks failed. Each failing diff was read and assigned a catalogue reason by hand, and the assignment was checked to cover exactly the failing set: 59 parity, 2 idempotence, 177 surface, and no load or save threw. Where a check fails for more than one reason the entry names the main one — `referenceLinks` for the reference-link cases, and `autolinks` where a line break and a missing autolink both differ.

[^private-editor]: Reaching `_editor` through an `unknown` cast is how `markdown-editor.test.ts` and the parked branch's tests already inspect the node tree. A public accessor would change production code for a test, which this plan rules out. `_editor` is set by `ensureEditor` (`MarkdownEditor.ts:2263`), which `setValue` calls.

[^exact-idempotence]: The existing idempotence test (`markdown-editor.test.ts:885`) compares through `normalize`, which strips trailing spaces and collapses blank-line runs. Trailing spaces are a hard break in Markdown, so `normalize` can hide a change of meaning. All but two seed cases already save to an exact fixpoint, so the stricter check adds no other entries.

[^branch-overlap]: Checked against `master` at `575ba825`. `feature/markdown-source-mode-editing` (merge base `a7fb74b0`) changes `MarkdownEditor.ts` (+338 lines, source-mode command editing), `CodeEditor.ts`, `markdown-editor.test.ts` (+414) and `code-editor.test.ts`, and adds `markdownSourceEdits.ts` and `markdown-source-edits.test.ts`. `feature/markdown-source-mode-styled-spans` contains that branch plus styled-span source edits (`MarkdownEditor.ts` +386 and `markdown-editor.test.ts` +562 in total). Neither changes the `$convertFromMarkdownString` / `$convertToMarkdownString` paths or the `_editor` field the harness reads, so the harness's results do not depend on their merge order. Moving the existing `CORPUS` tests into the harness would conflict with both. The parked `feature/markdown-link-reference-definitions` does change the conversion paths; see *Potential Challenges*.

[^code-newline]: `marked` keeps a closing newline in an indented code block's text when the source ends with one, and Lexical's code node never does. A final newline inside a `pre` adds no visible line, so both sides drop one.

[^linebreak-surface]: In the WYSIWYG surface a `LineBreakNode` renders as a line break, so mapping it to a space would hide a real difference from the viewer, which flows the lines together. The `lineBreaks` entries record that difference.

[^empty-blocks]: Lexical always keeps one paragraph in an empty document, and a paragraph whose only content the viewer refuses (a disallowed image) renders as an empty `<p>`. Neither shows any text, so both sides drop empty paragraphs, and an empty document compares equal to the viewer's empty output.

[^seed-sources]: The CommonMark rows are examples from CommonMark Spec 0.31.2 (`https://spec.commonmark.org/0.31.2/spec.json`), copied verbatim with their trailing newline and named by example number and section; they are short attributed excerpts, and no spec file is vendored. The selection covers the sections the dialect touches — escapes, entities, thematic breaks, ATX and setext headings, indented and fenced code, definitions, paragraphs, blockquotes, list items, lists, code spans, emphasis, links, images, autolinks, hard and soft breaks — and leaves HTML to two dialect cases. The dialect rows start with the 22 documents of `markdown-editor.test.ts`'s `CORPUS` and add probes for each dialect construct and its edge cases. The reference-link rows come from the parked branch: its plan's E1–E3 tables, `markdown-reference-links.test.ts`, and the probes its six review rounds recorded in the plan's Implementation Notes (definition start rules, paragraph continuation, escaped and entity labels, `Object.prototype` names, line-spanning labels, formatted and retargeted definitions).
