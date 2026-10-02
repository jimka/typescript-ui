---
depends-on:
  - markdown-roundtrip-harness
touches-shared:
  - packages/lib/src/typescript/lib/component/display/Markdown.ts
  - packages/lib/tests/component/display/Markdown.test.ts
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/markdown-roundtrip/viewModel.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
---

# Markdown Viewer Hard Line Breaks — Implementation Plan

## Overview

A CommonMark *hard line break* is a line ending written as a backslash
(`foo\` then a newline) or as two or more trailing spaces (`foo  ` then a
newline). `marked` lexes it as a `br` token, and CommonMark renders it as
`<br>`. The `Markdown` viewer has no case for `br` in
[`appendInlineToken`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1974).
It falls to the `default:` branch, which writes the token's `raw` as text. Under
the viewer's `white-space: normal`, a two-space break collapses to a space and
the line flows on; a backslash break shows a stray `\`.

This plan renders `br` as a `<br>` element, inside whatever inline wrapper holds
it. It also makes the minimap's heading text read a `br` as a space, adds viewer
tests, a docs row and a changelog entry, and updates the round-trip harness:
its viewer projection learns the `br` token, and four known entries flip.

It is the first step of the editor conversion stack and lands before
`markdown-editor-serializer`. Line numbers are as of
`feature/markdown-roundtrip-harness` at `7ca6dd53`.

---

## Architecture Decisions

### `br` renders as a `<br>` element, as table-cell breaks already do

`appendInlineToken` gets `case "br":`, which appends `this.create("br")` to the
parent. That is the call
[`appendTextWithBreaks`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2127)
already makes for a table cell's line break, at
[`:2132`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2132).
The `<br>` lands in the current parent, so a break inside `*…*` sits inside the
`<em>`.

### The fix narrows the viewer/editor gap

The parity rule requires `Markdown` and `MarkdownEditor` to support the same
syntax. Hard breaks are the one construct where the **editor** was ahead:
today's editor imports `foo  \nbar` and `foo\\\nbar` as text, a `LineBreakNode`,
text — shown as a line break — and saves the authored marker back unchanged
(`@lexical/markdown` keeps it in its `mdHardLineBreak` node state).[^editor-today]
The viewer was the side that dropped the break. Rendering it closes that gap;
the editor conversion plans keep the same behaviour (a `LineBreakNode` that
saves its authored form).

### Heading text in the minimap reads a `br` as a space

`inlineText` — the plain text `extractMarkdownHeadings` gives the minimap — gets
`case "br": return " ";`. Its `default:` would otherwise return the raw marker
(`  \n` or `\` + newline) for a setext heading holding a hard break. Heading ids
are built from `token.text`, not `inlineText`, so ids do not change.

### The harness projection follows the viewer

The harness's `viewerModel` mirrors the viewer's dispatch, so its inline
`switch` gains `case 'br': runs.push({ kind: 'break' })` with a new V-row, as
the harness plan prescribes for any viewer change.[^harness-rule]

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`. Work test-first.

1. **`tests/component/display/Markdown.test.ts`** — after the
   `describe('Markdown paragraph', …)` block (ends at line 288), add
   `describe('Markdown hard line breaks', …)` with one `it` per row HB1–HB8,
   labelled with its id. Use the file's `createdTags`, `textWrites` and
   `childTagsOf` helpers. Run
   `npx vitest run tests/component/display/Markdown.test.ts` — HB1–HB3 and HB8
   fail; HB4–HB7 pass (they guard behaviour that must not change).
2. **`src/typescript/lib/component/display/Markdown.ts`**
   - In `appendInlineToken`, after the `case "mdimage": { … }` block and before
     `default:`, add:
     ```ts
     // A hard line break (`\` or two trailing spaces before a newline).
     case "br": DOM.sink.appendChild(parent, this.create("br")); break;
     ```
   - In `inlineText` ([:2169](packages/lib/src/typescript/lib/component/display/Markdown.ts#L2169)),
     before `default:`, add `case "br": return " ";`.
   - In the class `@remarks` construct list, after `links (…)`, add
     `hard line breaks`.
   Re-run step 1's command — all green.
3. **`tests/component/markdown-roundtrip/markdown-view-model.test.ts`** — add
   V17 after V16 (line 139):
   `viewerModel('foo  \nbar').blocks` equals
   `[{ kind: 'paragraph', runs: [text 'foo', break, text 'bar'] }]` (plain
   runs). Run `npx vitest run tests/component/markdown-roundtrip` — V17 fails.
4. **`tests/component/markdown-roundtrip/viewModel.ts`** — in
   `viewerInlineToken` ([:407](packages/lib/tests/component/markdown-roundtrip/viewModel.ts#L407)),
   before `default:`, add `case 'br': runs.push({ kind: 'break' }); break;`.
   V17 passes.
5. **Settle the harness baseline.** Run the harness again. Expected (see
   `## Expected Behaviour`): the `surface` entries of CommonMark 16, 226, 633
   and 634 fail with "now holds" — delete those four `known` entries in
   `corpus/commonmark.ts`. Reword the `lineBreaks` reason in
   `corpus/divergences.ts` to: "The editor shows each soft line break inside a
   paragraph as a line break (a LineBreakNode); the viewer flows the lines into
   one." Any other outcome follows the harness plan's step-9 rule: do not edit a
   `known` entry to make the run green; re-read the projection, and if the
   difference is real, stop and report it.
6. **`docs/components/Markdown.md`** — in **Supported syntax (v1)**, after the
   paragraph-text row ([:49](packages/lib/docs/components/Markdown.md#L49)), add:
   ```markdown
   | `\` or two trailing spaces at a line end | `<br>` — a hard line break; a plain line end inside a paragraph is a soft break and the lines flow together |
   ```
7. **`docs/reference/changelog/next.md`** — append as the last entry of
   **Fixed › Components** (locate it by heading):
   ```markdown
   - **`Markdown` renders hard line breaks.** A line ending in `\` or in two or
     more spaces now breaks the line, as CommonMark specifies. It used to flow
     into the next line, and the backslash form printed a stray `\`. A plain
     line end inside a paragraph still flows. No consumer action is needed.
   ```
8. Run `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/tests/component/display/Markdown.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/viewModel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-view-model.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/divergences.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Viewer (`Markdown.test.ts`, unit under the modelled DOM)

| # | Source | Expected | Before |
|---|---|---|---|
| HB1 | `foo  \nbar` | `childTagsOf('p')` contains `'BR'`; the text writes include `foo` and `bar` | fails |
| HB2 | `foo\\\nbar` (backslash, newline) | `childTagsOf('p')` contains `'BR'`; no text write contains `\` | fails |
| HB3 | `*foo  \nbar*` | `childTagsOf('em')` contains `'BR'` | fails |
| HB4 | `foo\\` (backslash at the end of the paragraph) | `createdTags()` has no `'br'`; a text write is `foo\` (CommonMark 644: not a break) | passes |
| HB5 | `a\nb` | no `'br'` (a soft break flows) | passes |
| HB6 | `### foo\\` | no `'br'`; a text write contains `foo\` (CommonMark 646) | passes |
| HB7 | `` `code  \nspan` `` | no `'br'` (a code span holds no break) | passes |
| HB8 | `extractMarkdownHeadings('Foo  \nbar\n===')` | one heading whose `text` is `Foo bar` | fails |

### Harness (`npx vitest run tests/component/markdown-roundtrip`, unit)

| Item | Expected |
|---|---|
| V17 | passes after step 4 |
| `surface` of CommonMark 16, 226, 633, 634 (`lineBreaks`) | now hold; their entries are deleted |
| `parity` of those four | still holds (no entry before or after) |
| CommonMark 638 (`lineSpanningInline`, parity and surface) | still fails: the current editor does not read emphasis across the break |
| every other check | unchanged |
| `lineBreaks` | still used (soft-break cases: CommonMark 46, 113, 213, 220, 222, 648, `pipe lines without delimiter`); reason reworded |

### Manual

- **M1.** `npm run dev` → **MD Editor**, source mode, type `one  ` + Enter +
  `two`, then `three\` + Enter + `four`: the live viewer shows each pair on two
  lines with no `\`.

---

## Verification

- `npx vitest run tests/component/display tests/component/markdown-roundtrip`
  (from `packages/lib`).
- `npm run test` (from `packages/lib`).
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`
  (zero warnings), `npm run docs:llms:check`.
- Manual M1.

---

## Potential Challenges

- **`next.md` is appended to by every branch in the stack.** Conflicts are
  append-only; keep both sides.
- **A `<br>` as the only child of a `<p>`** cannot occur: `marked` emits no
  `br` at the end of a paragraph (HB4).

---

## Critical Files

- [`component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1974) — `appendInlineToken`, `appendTextWithBreaks` (the `<br>` precedent), `inlineText`.
- [`tests/component/display/Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts#L281) — the helpers and the neighbouring blocks.
- `tests/component/markdown-roundtrip/viewModel.ts`, `markdown-view-model.test.ts`, `corpus/` — the harness.
- `plans/implemented/markdown-roundtrip-harness.md` (on the harness branch) — *Potential Challenges* and step 9: how a viewer change updates the baseline.

---

## Non-Goals

- **Any `MarkdownEditor` change.** The editor already shows and saves hard
  breaks; the conversion plans keep that behaviour.
- **Rendering soft breaks as line breaks** (`breaks: true`). CommonMark and GFM
  flow them; the editor's import plan makes the editor flow them too.

---

## Notes

[^editor-today]: Checked on `master` by loading each source into a headless
    `MarkdownEditor` and reading the tree and `getValue()`:
    `foo\\\nbar` → text `foo`, `LineBreakNode`, text `bar`, saved `foo\\\nbar`;
    `foo  \nbaz` → saved `foo  \nbaz`; `aaa     \nbbb     ` → saved unchanged.
    `@lexical/markdown` 0.49 strips the marker from the text on import and
    stores it in its `hardLineBreakState` on the `LineBreakNode`, then writes it
    back on export. The same probe shows why the four surface entries flip:
    the editor's runs are `foo`, break, `bar` — exactly what the viewer now
    renders — and why parity already held: the save keeps the marker.

[^harness-rule]: The harness plan's *Potential Challenges* says a viewer fix
    adds the token to the viewer rule table with its own V-row and lets the
    flipped entries announce themselves. The editor side already maps a
    `LineBreakNode` to a break run, so no editor-projection change is needed.

## Implementation Notes

- **The harness baseline matched the plan exactly on this base.** Re-measured
  on `feature/markdown-roundtrip-harness` at `e398c515` (the plan cites
  `7ca6dd53`): after V17 and the `br` projection case, exactly the `surface`
  checks of CommonMark 16, 226, 633 and 634 failed with "now holds", and
  nothing else changed. Those four `known` entries were deleted and the
  `lineBreaks` reason reworded as specified; CommonMark 638 still fails both
  checks under `lineSpanningInline`.
- **Two small JSDoc edits beyond the plan.** Inserting `hard line breaks`
  into the class `@remarks` construct list pushed its line past 80 columns,
  so the rest of that paragraph was re-wrapped (no wording change). The
  `inlineText` JSDoc, which lists what each inline token contributes, gained
  a clause for `br` so it stays complete.
- **M1 was run in a browser.** The worktree's dev server, **MD Editor**,
  source mode: typing `one  ` / `two` and `three\` / `four` rendered
  `<span>one</span><br><span>two</span>` and
  `<span>three</span><br><span>four</span>` in the live viewer, with no `\`.
