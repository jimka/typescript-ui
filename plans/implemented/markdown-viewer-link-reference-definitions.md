---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/markdown-editor.test.ts
---

# Markdown Viewer Link Reference Definitions — Implementation Plan

## Overview

A *link reference definition* is a line such as `[0.4.0]: https://…/v0.4.0`.
It gives a URL to a *reference link* written elsewhere as `[text][label]`
(full form), `[label][]` (collapsed form) or `[label]` (shortcut form).
CommonMark renderers show nothing for the definition itself.

The `Markdown` viewer already renders reference links as links: `marked`
resolves each one into an ordinary `link` token. Two viewer bugs remain:

- **Definitions print as text.** The definition's own `def` token has no case
  in
  [`Markdown.appendBlockToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637).
  It falls to the `default:` branch and renders as a line of literal text.
  SQLAdmin's Changelog dialog shows the version-link block at the foot of its
  `CHANGELOG.md` this way.
- **Table cells miss later definitions.** A reference link inside a table cell
  stays literal text when its definition comes after the table, because
  [`TABLE_EXTENSION`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L210)
  lexes cell text before the lines below the table have been read.

This plan fixes both in the viewer only, plus the `@remarks` wording, the
viewer docs page, a changelog entry and tests. `MarkdownEditor` is not
changed. Ships in 0.11.0.

The code, tests and docs already exist on the parked branch
`feature/markdown-link-reference-definitions`. Commit `9163eb63` (code and
tests) applies cleanly to `master` at `575ba825`; commit `6a0266cd` (docs)
applies except for its `next.md` hunk. The implementer may port them, but the
steps below are complete without that branch.[^port]

---

## Architecture Decisions

### Skip `def` tokens the way `space` tokens are skipped

`appendBlockToken` gets `case "def": break;` next to the existing
[`case "space": break;`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1648).[^def-skip]
Blockquotes, loose list items and `:::` columns all render their children
through `appendBlockToken`, so this one case covers definitions at every
depth.

### Table cells lex through `marked`'s inline queue

The two `this.lexer.inlineTokens(text)` calls in `TABLE_EXTENSION` become
`this.lexer.inline(text)`. The change mirrors `marked` 18's own built-in `table`
tokenizer, and its `paragraph` and `heading` tokenizers, which all call
`this.lexer.inline(...)`.[^inline-queue] The cell's inline tokens are then
filled in after the whole document's definitions are known.

The two inline extensions in `markdownExtensions.ts` (`UNDERLINE_EXTENSION`,
`STYLED_SPAN_EXTENSION`) keep `inlineTokens`.[^inline-extensions]

### Viewer-only; the editor side waits for the editor rewrite

The project rule is that `Markdown` and `MarkdownEditor` support the same
Markdown subset. This plan does not widen the gap between them, because it
adds no syntax to the viewer:

| Construct | Viewer before | Viewer after | `MarkdownEditor` (unchanged) |
|---|---|---|---|
| `[text][label]`, `[label][]`, `[label]` outside tables | link | link | literal bracket text |
| reference link in a table cell, definition after the table | literal text | link | literal bracket text |
| `[label]: url` line | literal text (fallback bug) | nothing | plain paragraph |

The table-cell row is a consistency fix: a cell now resolves exactly as a
paragraph already did. Editor support for reference links is deferred to the
planned rewrite of `MarkdownEditor`'s Markdown import/export on top of
`marked`.[^parity]

### The editor test's viewer token list gains `"def"`

`VIEWER_TOKENS` in
[`tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts#L76)
is documented as "the exact token types the read-only `Markdown` viewer
renders". It gains `'def'` so it stays an exact copy of `appendBlockToken`'s
cases.[^viewer-tokens] No editor code changes.

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first: steps 1–3 add tests
that fail, steps 4–5 make them pass.

1. **`tests/component/display/Markdown.test.ts`** — after the
   `describe('Markdown links', …)` block (ends at line 808), add
   `describe('Markdown reference links and definitions', …)` with one `it` per
   row V1–V9 of `## Expected Behaviour`. Put the case's label in its title,
   e.g. `'renders nothing for a trailing definition block (V1)'`. Inside the
   `describe`, add a local helper (the existing helpers `attrWrites`,
   `textWrites`, `createdTags` and `childTagsOf` are at the top of the file):
   ```ts
   /** The `href` of every `<a>` attribute write, in order. */
   function linkHrefs(): string[] {
       return attrWrites().filter((a) => a.href !== undefined).map((a) => a.href);
   }
   ```
   Commit `9163eb63` has V1–V8 verbatim (its V8 test has no label in its
   title — add `(V8)`); V9 is new.
2. **`tests/component/display/markdownLexer.test.ts`** — after the
   `describe('the table extension emits the same tokens as the line-splitting original', …)`
   block (ends at line 90), add
   `describe('the table extension lexes cells after the definitions are known', …)`
   with case L1, using the file's `tokenAt<MdTableToken>` helper.
3. Run `npm -w packages/lib exec -- vitest run tests/component/display`.
   Expect V1–V5, V7, V8 and L1 to fail, and V6 and V9 to pass (they guard
   behaviour that must not change).
4. **`src/typescript/lib/component/display/Markdown.ts`**
   - In `appendBlockToken`, after `case "space": break;`
     ([:1648](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1648))
     and its blank line, add:
     ```ts
     // A link reference definition: `marked` has already resolved every
     // reference to it into a `link` token, so the definition renders nothing.
     case "def": break;
     ```
   - In the class `@remarks`
     ([:581](packages/lib/src/typescript/lib/component/display/Markdown.ts#L581)),
     change `bold, italic, links, GFM pipe tables` to
     `bold, italic, links (inline and reference-style; a reference definition renders nothing), GFM pipe tables`,
     re-wrapping the paragraph at the existing width.
5. **`src/typescript/lib/component/display/markdownTableExtension.ts`** —
   replace `this.lexer.inlineTokens(text)` with `this.lexer.inline(text)` at
   [:210](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L210)
   (header cells) and
   [:256](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L256)
   (body cells). Check:
   `grep -n "inlineTokens" src/typescript/lib/component/display/markdownTableExtension.ts`
   — expect zero matches. Re-run step 3's command — all green.
6. **`tests/component/markdown-editor.test.ts`** — at
   [:78](packages/lib/tests/component/markdown-editor.test.ts#L78), append
   `'def'` to the `VIEWER_TOKENS` set:
   ```ts
   const VIEWER_TOKENS = new Set(['heading', 'paragraph', 'list', 'blockquote', 'code', 'space', 'mdtable', 'mdblock', 'def']);
   ```
7. **`docs/components/Markdown.md`** — in **Supported syntax (v1)**, after the
   `[text](url)` row
   ([:58](packages/lib/docs/components/Markdown.md#L58)), add two rows:
   ```markdown
   | `[text][label]`, `[label][]`, `[label]` | `<a>` whose href is the matching reference definition's URL; labels match case-insensitively, and an undefined label renders as literal text |
   | `[label]: url "title"` | nothing — the definition only supplies a URL, wherever it sits (top level, blockquote, list item, `:::` fence) |
   ```
8. **`docs/reference/changelog/next.md`** — append as the last entry of
   **Fixed › Components** (after the "modified tab without a glyph" entry,
   just above the `### Core` heading at
   [:285](packages/lib/docs/reference/changelog/next.md#L285)); locate it by
   heading, not line number:
   ```markdown
   - **`Markdown` no longer prints link reference definitions.** A
     `[label]: url` line — such as the version-link block at the foot of a
     changelog — rendered as a paragraph of literal text. It now renders
     nothing, as CommonMark specifies, at the top level or inside a
     blockquote, list item or `:::` fence. A reference link inside a table
     cell also resolves now when its definition comes after the table; it
     used to render as literal text. No consumer action is needed.
   ```
9. Run the `## Verification` commands.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/display/markdownLexer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable under the modelled DOM. "Before" is the result on
`master` at `575ba825`, checked by running the ported V1–V8 and L1 tests there; V9 has no unresolved-reference path to break and passes before and after.

| # | Source | Expected | Before |
|---|---|---|---|
| V1 | `# H\n\n[x]: https://example.com\n` | no text write contains `[x]:`; no `p` is created (SQLAdmin's case) | fails |
| V2 | `See [text][ref] and [ref] and [ref][] and [Ref].\n\n[ref]: https://e.com "T"` | `linkHrefs()` is four times `https://e.com`; no text write contains `]:` | fails |
| V3 | `> [q]\n>\n> [q]: https://q.com` | `linkHrefs()` is `['https://q.com']`; no text write contains `[q]:` | fails |
| V4 | `::: {align=center}\n[x]\n\n[x]: https://blk\n:::` | `linkHrefs()` is `['https://blk']`; no text write contains `[x]:` | fails |
| V5 | `\| a \|\n\| --- \|\n\| [ref] \|\n\n[ref]: https://e.com` | `linkHrefs()` is `['https://e.com']`; `childTagsOf('td')` contains `'A'` | fails |
| V6 | `para\n[x]: https://e.com` | the joined text writes contain `[x]: https://e.com` — a definition cannot interrupt a paragraph[^v6-join] | passes |
| V7 | `[a]\n\n[a]: https://one\n[a]: https://two` | `linkHrefs()` is `['https://one']` (first definition wins); no text write contains `[a]:`[^duplicate] | fails |
| V8 | `- [l]\n\n  [l]: https://l.com` | `linkHrefs()` is `['https://l.com']`; no text write contains `[l]:` | fails |
| V9 | `see [nope] here` | `createdTags()` does not contain `'a'`; the joined text writes contain `[nope]` (undefined label stays text) | passes |
| L1 | `lexMarkdown` of the V5 source | `tokenAt<MdTableToken>(source, 0).rows[0]![0]!.tokens[0]` matches `{ type: 'link', href: 'https://e.com' }` | fails |

**Manual** (renders in a real browser, not covered by the modelled DOM):

- **M1.** `npm run dev` → **MD Editor**. Turn on **Edit Markdown source** in
  the toolbar and replace the document with:
  ```markdown
  See [the spec][cm].

  | a |
  | --- |
  | [cm] |

  [cm]: https://spec.commonmark.org
  ```
  The live viewer on the right shows two links (paragraph and table cell) and
  no `[cm]: …` line.

---

## Verification

From the repo root:

- `npm run typecheck`
- `npm run lint`
- `npm run test` — includes every case above, the unchanged
  `lexMarkdown` ↔ `lexMarkdownUnbounded` parity suites in
  `markdownLexer.test.ts`, and the editor's "dialect fidelity (viewer token
  set)" suite.
- `npm run docs:api`
- `npm run docs:llms:check`
- Manual M1.

---

## Potential Challenges

- **`next.md` is appended to by other open branches**
  (`feature/markdown-source-mode-editing`,
  `feature/markdown-source-mode-styled-spans`,
  `feature/spatial-navigation-container-priority-band`). Conflicts are
  append-only; keep both sides' entries.
- **`markdown-editor.test.ts` is heavily edited by the two source-mode
  branches.** Their hunks do not touch line 78, so the one-line
  `VIEWER_TOKENS` change should merge cleanly; if it conflicts, keep their
  side and re-append `'def'`.
- **A worktree has no `node_modules`.** Symlink the main tree's
  `node_modules` into the worktree root before running the checks.

---

## Critical Files

- [`component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1637) — `appendBlockToken` and its `space` case, the precedent for the `def` case.
- [`component/display/markdownTableExtension.ts`](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L164) — `TABLE_EXTENSION`.
- [`component/display/markdownExtensions.ts`](packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L344) — the extension list and the scoped `marked` instances behind `lexMarkdown` / `lexMarkdownUnbounded`.
- `node_modules/marked/lib/marked.esm.js` — `Lexer.lex` (block pass, then drains `inlineQueue`), `Lexer.inline`, `Tokenizer.table` (the `this.lexer.inline` precedent) and the `def` branch of `blockTokens`.
- [`tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts#L29) — the recording-sink helpers the new tests use.
- [`tests/component/markdown-editor.test.ts`](packages/lib/tests/component/markdown-editor.test.ts#L1152) — the dialect-fidelity suite that reads `VIEWER_TOKENS`.

---

## Non-Goals

- **`MarkdownEditor` support for reference links and definitions.** Anything
  under `component/editor/`, `docs/components/MarkdownEditor.md`, the demo
  panel and `@lexical/clipboard` stay untouched. This waits for the editor's
  Markdown import/export rewrite on `marked`. `MarkdownEditor.md`'s claim
  that its dialect is "the exact subset the viewer renders" was already
  inexact for reference links before this plan; it is corrected by that
  rewrite.
- **`lexMarkdownLinkDefinitions`** from the parked branch. It is
  editor-only plumbing with no viewer caller.
- **Porting the parked branch's editor commits** (`8ef01cc6`, `f9911f0a`) or
  its `MarkdownEditorPanel.ts` sample change.
- **Editing `plans/markdown-link-reference-definitions.md`.** That combined
  viewer + editor plan stays as it is; this plan replaces its viewer half.
- **Reference-style images** (`![alt][ref]`) and **rendering a link
  `title`.** Neither is rendered today; unchanged.

---

## Notes

[^port]: Checked with `git format-patch -1 --stdout <commit> | git apply --check`
    against `575ba825`. `9163eb63` touches `Markdown.ts`,
    `markdownTableExtension.ts`, `Markdown.test.ts` and
    `markdownLexer.test.ts`; none of the four changed between the branch's
    base `d4ce08f7` and `master`. `6a0266cd`'s `Markdown.md` hunk applies;
    its `next.md` hunk does not, because other entries landed in `next.md`
    since. Neither commit contains steps 6 or V9 — those are new here. The
    branch's other commits (`8ef01cc6`, `f9911f0a`, `522f5ac6`, `b7ed21ba`)
    are editor work or plan bookkeeping and are not ported.

[^def-skip]: The `default:` branch's literal-text fallback is for constructs
    the viewer cannot render (raw HTML, task lists). A `def` token is
    different: `marked` has already folded it into every reference that uses
    it, so nothing is left to render. Consuming it silently is what every
    CommonMark renderer does, and what `case "space"` already does for the
    other token that exists only for source layout.

[^inline-queue]: `this.lexer.inlineTokens(text)` lexes the cell immediately,
    during the block pass. At that point `lexer.tokens.links` holds only the
    definitions *above* the table, so `[ref]` with its definition below lexes
    as `{ type: 'text', raw: '[ref]' }`. `this.lexer.inline(text)` pushes the
    cell onto `marked`'s inline queue and returns the still-empty token
    array; `Lexer.lex` fills it after the block pass, when every definition
    is known. Nothing in `TABLE_EXTENSION` reads a cell's `tokens` during the
    block pass, and every caller reaches the extension through a full
    `_marked.lexer(source)` call (`lexMarkdown`, `lexMarkdownUnbounded`),
    which always drains the queue — including for tables nested in a `:::`
    fence, which the fence lexes with `this.lexer.blockTokens` on the same
    lexer. The parity suites stay green because both lexers share the
    extension.

[^inline-extensions]: `UNDERLINE_EXTENSION` and `STYLED_SPAN_EXTENSION` are
    `level: "inline"` extensions. They run inside the inline pass, after all
    definitions are known, so their `inlineTokens` call already resolves
    references. This matches `marked`'s own `strong` / `em` tokenizers,
    which also call `inlineTokens`. Only a block-level tokenizer needs the
    deferred `inline`.

[^parity]: The rule exists because an asymmetry can lose data: syntax the
    viewer renders but the editor cannot represent is either unauthorable or
    damaged when a document passes through the editor. Reference links were
    already in that state before this plan — `marked` has always resolved
    them in the viewer, while the editor shows `[text][ref]` as bracket text
    and backslash-escapes characters such as `_` in reference and definition
    lines on save. This plan does not add a construct the editor lacks: it
    removes a fallback bug (definitions printed as text) and makes table
    cells resolve as paragraphs already did. A full editor implementation
    was built on the parked branch and is being abandoned: the planned
    rewrite of the editor's Markdown import/export on top of `marked` will
    receive resolved reference links from the same lexer as the viewer, so
    building a separate Lexical transformer layer now would be thrown away.
    Shipping the viewer fix alone fixes SQLAdmin's Changelog dialog in
    0.11.0 without waiting for that rewrite.

[^viewer-tokens]: The dialect-fidelity suite checks that every block token in
    the editor's saved output is one the viewer renders. The editor can
    already emit a definition line today: it keeps `[x]: https://e.com` as a
    paragraph and saves it back as that text, which `marked` lexes as `def`
    (a definition holding a character Lexical escapes, such as `_`, is saved
    escaped, and still lexes as `def`).
    Before this plan the viewer printed such a line as text, so leaving
    `'def'` out of the set was accurate. After step 4 the viewer handles
    `def`, so the set must include it to stay a copy of `appendBlockToken`'s
    cases. No corpus row contains a definition, so no test result changes.

[^v6-join]: GFM autolinks the bare URL in `para\n[x]: https://e.com`, so the
    line is written as two text writes (`para\n[x]: ` and the link text).
    The test checks the joined text, not a single write.

[^duplicate]: In `marked` 18, `blockTokens` records only the first
    definition of a label in `tokens.links` and pushes only that one as a
    `def` token. The second definition is dropped without producing any
    token, so after this change neither line renders.

---

## Implementation Notes

- **Extra test for header cells.** The plan's Expected Behaviour table only
  lists a body-cell case (V5, L1), so reverting the header-cell swap at
  `markdownTableExtension.ts:210` left every test green. `markdownLexer.test.ts`
  gains a header-cell variant of L1. It fails with `inlineTokens` on that
  line and passes with `inline`.
- **Queueing cells exposed `marked`'s task-marker scan to cells; fixed in the
  dialect.** Footnote `[^inline-queue]` says nothing reads a cell's queued
  entry during the block pass. That is not quite true. `marked` 18's list
  tokenizer lexes each item's blocks, then strips a GFM task marker by
  searching `lexer.inlineQueue` backwards for the *last* entry that starts with
  `[ ] `/`[x] ` — not the entry of the item's own first text. Once cells were
  queued, that entry could be a table cell: `- [ ] foo` followed by a table
  whose cell reads `[x] baz` rendered the item text as `[ ] [ ] foo` (marker
  twice) and the cell as `baz`. A later paragraph in the same task item
  (`- [ ] foo\n\n  [x] bar`) already lost its marker the same way on
  `master`. The first version of this note accepted the regression as an
  upstream bug; the whole-stack review overruled that (user decision: fix it
  on our side, do not report upstream) — see the fix below.

### Whole-stack review fixes

- **A2 — a task item's marker comes off its own first text only.**
  `markdownExtensions.ts` gains `listWithOwnTaskMarker`, installed in
  `marked`'s `list` slot: `BOUNDED_BLOCK_TOKENIZERS.list` calls it behind its
  guard and window, and the unbounded twin installs it through a new
  `DIALECT_BLOCK_TOKENIZERS` object, so the two lexers still differ only in
  guards and windows (the same shape as the existing bounded-tokenizer
  wrappers). It runs `marked`'s own list tokenizer against a view of the lexer
  whose `blockTokens` records, per item, the inline-queue entries that item's
  lexing queued and their text — the call `marked` makes just before its
  queue search. Afterwards every recorded entry gets its recorded text back
  (undoing whichever strip `marked` made) and a task item's own entry — the
  one sharing its first paragraph/text token's `tokens` array — loses the
  marker. The token tree, checkbox placement included, stays exactly
  `marked`'s; only queued sources change. Nested lists fix their own items
  inside the parent item's lexing, before the parent records, so the parent
  restores their entries to the already-fixed text. Tests, written first and
  failing before the fix (all but the last): `markdownLexer.test.ts` "a
  task-list item's marker comes off the item's own first text" — a later
  table cell, a later paragraph, a loose item (checkbox inside the first
  paragraph, `[X]  ` with two spaces kept literal), a nested plain item inside
  a task item, nested task items, and a list with no task items (unchanged);
  each also asserts `lexMarkdown` equals `lexMarkdownUnbounded`. `Markdown.test.ts`
  adds a render-level case for the review's table example.
- **A8 — manual check M1 run.** Run on this branch with the fix applied: the
  worktree's library demo served by Vite (on port 8115 with a separate cache
  directory, because the main tree's dev server held 8015), **MD Editor**,
  **Edit Markdown source** on, document replaced with M1's source. The live
  viewer showed exactly two links, "the spec" and the table cell's "cm", both
  to `https://spec.commonmark.org/`, and no `[cm]: …` line. Passed. (Typing
  the A2 table example into the source editor was not a usable manual check:
  the editor continues the `- [ ] ` list marker on every Enter, so the typed
  document was not the example; A2 is covered by the unit tests above.)
