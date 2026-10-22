---
depends-on:
  - markdown-editor-reference-links
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-roundtrip/harness.ts
  - packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/types.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# Markdown Editor Source Preservation — Implementation Plan

## Overview

After plans 1–3 every save writes the whole document in the serializer's
standard form: `*` bullets become `-`, a table loses its alignment padding, an
indented code block becomes a fence. The meaning is kept, but a one-word edit
rewrites every block, and switching to source mode and back reformats the
document.

This plan makes a save change only what the user changed. When a top-level
block is still exactly as loaded, the serializer writes the block's original
source text, and the original blank lines around it. An edited block is written
in the standard form. Loading a document and saving it without edits returns it
byte for byte (line endings become `\n`).

The importer records, per top-level node, the source slice it came from and a
*fingerprint* — the serializer's standard output for that node at load. At save
time a node whose standard output still equals its fingerprint is unchanged,
and its slice is written instead.

Because an untouched load now saves verbatim, the harness's `parity` and
`idempotence` checks no longer test the serializer. This plan adds a
`canonical` check that does — the same comparison on the standard output — and
moves the remaining known entries onto it.

---

## Architecture Decisions

### "Unchanged" means the block's standard output equals its standard output at load

At import, after building the document, `$importMarkdown` serializes each
top-level node in the standard form and stores it as the node's fingerprint,
keyed by `NodeKey`. At save, a node is written from its slice exactly when its
key has an entry and its standard output equals the fingerprint.[^fingerprint]

| Situation after load | Standard output vs fingerprint | Written |
|---|---|---|
| nothing touched | equal | slice |
| text typed, then undone | equal | slice |
| bold toggled on a word | differs | standard form |
| the next list merged into this one by Lexical's list transform | differs (more items) | standard form — the merged items are kept |
| this paragraph's reference link's definition edited (plan 3) | differs (the link now writes inline) | standard form |
| block pasted or newly typed | no entry | standard form |

The fingerprint is taken inside the import update, before Lexical's node
transforms run, so a transform that changes content (the list merge) makes the
block differ.[^before-transforms]

### Only top-level blocks are preserved

Slices are kept for the root's children only. A list, quote, table or `:::`
fence is preserved or rewritten as a whole.[^top-level]

### Blank lines between blocks are preserved between two unchanged neighbours

Each entry also stores the text that followed its slice up to the next block
(blank lines). Between two consecutive output blocks:

| Previous block | Next block | Separator |
|---|---|---|
| unchanged, original index `i` | unchanged, original index `i + 1` | the previous entry's following text |
| any other pair | | `"\n\n"` |

The text before the first block is written when the first output block is the
unchanged original first block; the text after the last block likewise. When
the last block was edited, the output ends with `"\n"` if the source did.

| Source | Edit | Saved |
|---|---|---|
| `# H\n\n\n\npara\n` | none | `# H\n\n\n\npara\n` |
| `# H\n\n\n\npara\n` | append `!` to `para` | `# H\n\npara!\n` |
| `* a\n* b\n\ntext` | append `!` to `text` | `* a\n* b\n\ntext!` |
| `* a\n* b\n\ntext` | append `!` to item `a` | `- a!\n- b\n\ntext` |

### The source map belongs to the editor instance and is replaced on every import

`MarkdownEditor` holds the map from the last import in a private
`_sourceMap` field and passes it to every save. `setValue`, the
source-to-WYSIWYG switch and the first build each replace it.[^instance-map]

### A load whose tokens cannot be located preserves nothing

If `locateTokens` (plan 2) fails to find the text of one or more top-level
tokens, the map holds no blocks and the whole document saves in the standard
form, as before this plan.[^locate-fallback]

---

## Public API

No barrel export changes.

```typescript
// component/editor/markdownSourceMap.ts
export interface MarkdownSourceBlock {
    readonly index:       number;   // position among the document's top-level blocks at load
    readonly body:        string;   // the block's source, without trailing newlines
    readonly after:       string;   // the source between this block and the next (or the end)
    readonly fingerprint: string;   // the block's standard output at load
}

export interface MarkdownSourceMap {
    readonly prefix:          string;    // the source before the first block
    readonly endsWithNewline: boolean;
    readonly blockCount:      number;
    readonly blocks:          ReadonlyMap<NodeKey, MarkdownSourceBlock>;
}

export const EMPTY_SOURCE_MAP: MarkdownSourceMap;

// component/editor/markdownImporter.ts — return type changes from void
export function $importMarkdown(markdown: string): MarkdownSourceMap;

// component/editor/markdownSerializer.ts — optional parameter added
export function $serializeMarkdown(sourceMap?: MarkdownSourceMap): string;
export function $serializeTopLevelBlocks(): Array<{ node: LexicalNode; text: string }>;
```

`$serializeMarkdown()` with no map is the standard form — what plans 1–3
returned. `$serializeTopLevelBlocks()` returns the standard output of each root
child under the document's context (plan 3's definitions); both the fingerprint
and the save use it, so the two are computed identically.

---

## Implementation

### Import

`$importMarkdown` keeps plan 2's body and additionally, for the root list only:

1. Extends plan 2's `LocatedBlock` with `start` and `body`: for a token, `body`
   is its `raw` without trailing newlines and `start` where `indexOf` found it;
   for a gap, `body` is the trimmed gap text and `start` where that trimmed text
   begins. For the root list, records both for each entry.
2. After `root.append(...)` **and after plan 3's `importedContent` pass** (a
   reference link written before that pass would fingerprint in its full form
   and never match again), calls `$serializeTopLevelBlocks()` and pairs its
   results with the recorded entries in order.
3. Builds the map: `after` of entry `i` is `source.slice(start_i + body_i.length, start_(i+1))`
   (for the last entry, to the end of the source); `prefix` is
   `source.slice(0, start_0)`, or the whole source when there are no entries;
   `endsWithNewline` is `source.endsWith("\n")`; `blockCount` is the number of
   entries.
4. Returns a map with an empty `blocks` (keeping `prefix` and
   `endsWithNewline`) when a root token failed to locate, or when the number of
   root nodes differs from the number of entries.

### Save

```typescript
export function $serializeMarkdown(sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP): string {
    const parts = $serializeTopLevelBlocks().filter((part) => part.text !== "");

    if (parts.length === 0) {
        return sourceMap.blocks.size === 0 ? sourceMap.prefix : "";
    }

    return assembleDocument(parts, sourceMap);
}
```

`assembleDocument` walks `parts`; for each it looks up
`entry = sourceMap.blocks.get(part.node.getKey())`, treats the part as
unchanged when `entry !== undefined && entry.fingerprint === part.text`, writes
`entry.body` or `part.text`, and writes separators, prefix and ending per the
tables above. Split it into `separatorBefore`, `documentStart` and
`documentEnd`.

With no map, `parts` are joined with `"\n\n"` — plans 1–3's output exactly.

### `MarkdownEditor.ts`

- Field, next to `_editor`:
  ```typescript
  /** The source map of the last import; `EMPTY_SOURCE_MAP` before the editor is built. */
  private _sourceMap: MarkdownSourceMap = EMPTY_SOURCE_MAP;
  ```
- The three import sites become
  `editor.update(() => { this._sourceMap = $importMarkdown(markdown); }, { discrete: true })`
  (with each site's own argument). The assignment runs inside the update, so
  the `"change"` emitted by that same commit already saves verbatim.
- The three save sites pass `this._sourceMap`:
  `editor.read(() => $serializeMarkdown(this._sourceMap))`.
- `ensureEditor`'s comment "The importer and serializer normalize what they
  round-trip (a trailing newline is dropped, …)" becomes "An unedited document
  saves as loaded, except that `\r\n` line endings become `\n`".

### Harness

- `corpus/types.ts`: `HarnessCheck` gains `'canonical'`, `'canonicalIdempotence'`
  and `'verbatim'`.
- `harness.ts`: add
  ```typescript
  /** The editor's standard-form save, ignoring the source map. */
  export function canonicalSave(editor: MarkdownEditor): string;
  ```
  reading the private Lexical editor as `editorSurfaceModel` does and
  returning `read(() => $serializeMarkdown())`.
- `markdown-roundtrip.test.ts`: per case add

  | Test title | Body |
  |---|---|
  | `checkTitle(case, 'verbatim')` | `assertCheck(case, 'verbatim', saved, source.replace(/\r\n?/g, '\n'))` |
  | `checkTitle(case, 'canonical')` | `assertCheck(case, 'canonical', viewerModel(canonicalSave(editor)), viewerModel(source))` |
  | `checkTitle(case, 'canonicalIdempotence')` | `const first = canonicalSave(editor)`; load `first` into a fresh editor `second`; `assertCheck(case, 'canonicalIdempotence', canonicalSave(second), first)` |

---

## Ordered Implementation Steps

Paths are relative to `packages/lib/`.

1. **Tests first.** Create `tests/component/markdown-source-preservation.test.ts`
   (setup as in `markdown-importer.test.ts`) with rows P1–P12. Run — they fail.
2. **Create `src/typescript/lib/component/editor/markdownSourceMap.ts`** with
   the two interfaces and `EMPTY_SOURCE_MAP`
   (`{ prefix: "", endsWithNewline: false, blockCount: 0, blocks: new Map() }`).
3. **Serializer** — extract `$serializeTopLevelBlocks()` from
   `$serializeMarkdown()` (the definitions context moves with it), then add the
   map parameter and `assembleDocument`. Check: the existing serializer,
   importer and reference-link tests still pass (no map → old output).
4. **Importer** — record entries and return the map per *Import*.
5. **`MarkdownEditor.ts`** — the field, the six sites, the comment. Check:
   P1–P12 pass.
6. **Harness** — the three new checks. Run
   `npx vitest run tests/component/markdown-roundtrip`. Expected:
   - every remaining `parity` entry fails with "now holds": move it to
     `canonical` with the same reason;
   - every remaining `idempotence` entry likewise moves to
     `canonicalIdempotence`;
   - `verbatim` holds for every case (no entries);
   - `surface` entries are unchanged.
   Any other outcome follows plan 2's step-11 triage rules.
7. **`tests/component/markdown-editor.test.ts`** — tests that assert a
   normalisation of an *unedited* document now see the source. Change
   `normalises a table authored without leading/trailing pipes to the canonical
   piped form` to assert the source comes back unchanged (rename it
   `keeps a table authored without leading/trailing pipes as written`), and
   `absorbs a following non-blank prose line as an extra row, matching marked`
   to assert `lines[3]` is `trailing prose`. Run the file; any other failure
   of this kind is updated the same way, naming row P1.
8. **Docs and changelog** per `## Documentation Impact`.
9. Run `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/editor/markdownSourceMap.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-source-preservation.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/harness.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/markdown-roundtrip.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/types.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/commonmark.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/referenceLinks.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Preservation (`markdown-source-preservation.test.ts`, unit)

Each row: `new MarkdownEditor()`, `setValue(source)`, the edit (through the
private Lexical editor, as `lexicalOf` does), then `getValue()`.

| # | Source | Edit | `getValue()` |
|---|---|---|---|
| P1 | `MarkdownEditorPanel.ts`'s `SAMPLE` (copy it), `* a\n* b`, `a \| b\n--- \| ---\n1 \| 2`, `Para one\nwrapped.\n`, `    code\n`, `Title\n===\n` | none | each returned unchanged |
| P2 | `` and `\n\n` | none | unchanged |
| P3 | `# H\n\n\n\npara\n` | append `!` to `para` | `# H\n\npara!\n` |
| P4 | `* a\n* b\n\ntext` | append `!` to `text` | `* a\n* b\n\ntext!` |
| P5 | `* a\n* b\n\ntext` | append `!` to item `a` | `- a!\n- b\n\ntext` |
| P6 | `first\nwrapped\n\nsecond` | append `!` to `wrapped` | `first\nwrapped!\n\nsecond` |
| P7 | `- a\n+ b` (two lists: the bullet changes) | none (Lexical merges the two lists) | `- a\n- b` |
| P8 | `[x]\n\n[x]: https://one` | replace the definition text with `[x]: https://two` | `[x](https://one)\n\n[x]: https://two` |
| P9 | `* a\n\ntext` | append `!` to `text`, then undo | `* a\n\ntext` |
| P10 | `a\r\nb` | none | `a\nb` |
| P11 | `[a]\n\n[a]: https://one\n[a]: https://two\n` | none | unchanged |
| P12 | `* a` | `setMode('source')`, `setMode('wysiwyg')` | `* a` after each switch |

P7 pins the safety rule: the second list's item must survive the merge.

### Harness baseline after this plan (unit, the acceptance gate)

| Check | Known entries |
|---|---|
| `verbatim` | none |
| `parity`, `idempotence` | none (moved) |
| `canonical` | exactly the `parity` entries left after plan 3, same reasons (CommonMark 301, `listMarkers`, and any recorded in plans 2–3's Implementation Notes) |
| `canonicalIdempotence` | exactly the `idempotence` entries left after plan 3 (expected: none) |
| `surface` | unchanged from plan 3 |

### Manual (MD Editor demo)

- **M1.** Load the sample, switch to source mode: the text is the sample
  exactly. Back to WYSIWYG, change one word in the table, back to source: only
  the table's lines differ from the sample.
- **M2.** The dirty flag: after **Save**, typing a character and deleting it
  clears the flag again.

---

## Verification

- `npx vitest run tests/component/markdown-source-preservation.test.ts tests/component/markdown-roundtrip`
  (from `packages/lib`).
- `npm run test`.
- From the repo root: `npm run typecheck`, `npm run lint`, `npm run docs:api`
  (zero warnings), `npm run docs:llms:check`.
- Manual M1–M2.

---

## Documentation Impact

- **`docs/components/MarkdownEditor.md`**, **Common methods**, after the table:
  "Saving changes only what was edited. A top-level block you did not touch —
  a paragraph, list, table, quote or fence — is written back exactly as it was
  loaded, with the blank lines around it; an edited block is written in the
  editor's standard form (`-` bullets, `*` emphasis, fenced code, …). An
  unedited document, and a switch to source mode and back, return the text
  unchanged except that `\r\n` line endings become `\n`."
- **`docs/reference/changelog/next.md`** — append to **Changed › Components**:
  ```markdown
  - **`MarkdownEditor` saves only what you edited.** Blocks you did not
    change keep their exact source — list markers, table padding, line
    wrapping and blank lines — so a one-word edit no longer reformats the
    document, and switching to source mode and back leaves the text as it
    was. No consumer action is needed.
  ```

---

## Potential Challenges

- **Save cost.** Every save already serializes each top-level block; the only
  addition is a string comparison per block. Plan 3's definitions lex is
  shared.
- **Tests that expected normalisation on load** — see step 7. The
  source-mode branches' tests that switch modes and compare `normalize(...)`
  values keep passing; one that compares exact bytes after a mode switch now
  sees the source.
- **Keys reused by Lexical.** A node keeps its key across edits; that is why
  the fingerprint, not the key alone, decides.

---

## Critical Files

- `component/editor/markdownImporter.ts` — `locateTokens` and the root build (plan 2).
- `component/editor/markdownSerializer.ts` — `$serializeMarkdown` and the plan 3 definitions context.
- [`component/editor/MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2585) — `ensureEditor`, `setValue`, `setMode`, `getValue`, `handleChange`.
- `node_modules/@lexical/list/dist/LexicalList.dev.mjs` — `ListNode`'s merging `$transform` (P7).
- `tests/component/markdown-roundtrip/harness.ts` and `markdown-roundtrip.test.ts` — the checks extended here.

---

## Non-Goals

- **Preserving nested blocks** (one list item, one table cell, one block inside
  a `:::` column). The enclosing top-level block is rewritten whole.
- **Preserving `\r\n` line endings.** `marked` normalizes them before lexing.
- **A byte-exact contract for edited blocks** beyond plan 1's standard form.

---

## Notes

[^fingerprint]: Comparing node object identity was considered: Lexical clones a
    node on every write, so an untouched subtree keeps its objects. It misses
    two cases the fingerprint catches. A change elsewhere can change what an
    untouched block must write — a reference link whose definition was edited
    must now write inline (plan 3's rule that a save never changes where a link
    points). And a no-op write (a format toggled on and off) clones nodes
    without changing content, which would needlessly drop the verbatim
    slice. The fingerprint costs nothing extra at save time, since the
    serializer produces the standard output anyway.

[^before-transforms]: Lexical runs node transforms when the update that built
    the document commits, after `$importMarkdown` returns. `ListNode`'s
    transform merges a following list of the same type into it, so with a
    fingerprint taken *after* that, the merged node would still match and its
    slice — holding only the first list — would be written, deleting the
    second list's items. Taken before, the merged node differs and is
    rewritten in full (P7).

[^top-level]: Only top-level tokens' `raw` is a slice of the document: a
    blockquote's children are lexed from text with the `>` markers removed, a
    list item's from de-indented text, and a `:::` column's from text with
    `\|||` unescaped. Mapping their positions back would need to undo each of
    those transformations; the top level covers the common cases (an edit
    touches one paragraph, list or table) with none of that.

[^instance-map]: Lexical's node keys are per editor, so the map cannot be
    shared or global. Storing it on the nodes (Lexical node state) was
    considered: it would travel with copy-paste into another document, where
    the slice is meaningless; the fingerprint check would catch most such
    cases, but a per-import map has no such case at all.

[^locate-fallback]: Location fails only if `marked` rewrites a token's `raw`
    in a way plan 2's newline trimming does not cover. Falling back to the
    standard form is always correct, only less tidy; the harness's `verbatim`
    check would show any corpus case that hits it.

## Implementation Notes

- **No per-step audit (user decision).** The worker's audit/fix loop was not
  run for this plan; the user replaced per-step audits with one fresh
  whole-stack review plus a fuzz pass after the last step of the stack.
- **Reconciled with plans 1–3.** `LocatedBlock` already carried `start` and
  `end` (plan 2's audit fix), so step 1's extension was not needed: a block's
  `body` is `source.slice(start, end)` for tokens, gaps and plan 3's joined
  definition runs alike. Its trailing spaces fall into `after`. `locateTokens`
  no longer "fails" — a token that matches nowhere joins the next gap as a raw
  block — so the empty-`blocks` fallback is kept only for a root/entry count
  mismatch (never seen) and for the empty document. The six MarkdownEditor
  sites are the three imports (`setMode`, `setValue`, `ensureEditor`) and the
  three saves (`getValue`, `ensureEditor`'s `_cleanValue`, `handleChange`);
  the plan's `#L2585` anchor had drifted to `ensureEditor` at ~2740.
- **P5 keeps the authored marker.** Plan 2 keeps a list's `*`, so the edited
  list saves `* a!\n* b\n\ntext`, not the plan's `- a!…` (the same for the
  fourth row of the separator table).
- **Three rules beyond the plan: a block's source is not written where it
  would read differently (deviation; plan gap).** The plan writes an
  unchanged block's source wherever it lands; three cases changed what the
  viewer shows, each pinned by a test written first:
  - *An indented block after a list* (P13): `  - n\n\n  ***` with the list
    edited saved `- n!\n\n  ***`, putting the break inside the item — plan
    2's raw-block dedent existed for this. A block whose first line is
    indented is written in the standard form when the block written before
    it is a list or raw block that was not its neighbour at load. Indented
    code after an edited paragraph stays as written (P14).
  - *An unclosed code fence* (P15): only the source's last block can run to
    the end; the importer lexes it with a paragraph after it
    (`MarkdownSourceMap.endsOpen`), and such a block is written in the
    standard form (closed) once anything is written after it.
  - *Changed definitions* (P16): text the viewer showed as `[y]` becomes a
    link once a raw definition block is edited to define `y`, which no
    fingerprint shows. The map records the definitions at load
    (`MarkdownSourceMap.definitions`, from the new `$definitionsKey`, the
    raw blocks' definitions as `marked` resolves them); once they differ, the
    whole document saves in the standard form. P8 is unaffected. (Narrowed by
    the whole-stack review, below: only a block whose source lexes
    differently under the new definitions falls back.)
- **A block that writes nothing keeps its source while unchanged (P17;
  plan gap).** A paragraph holding only `[](u)` or `[][ref]` loads empty, and
  the plan's `filter((part) => part.text !== "")` dropped it even unedited.
  Unchanged blocks are now kept whatever their standard output.
- **Empty-text links (plan 2's known drop).** Unedited, they are now kept in
  every case: inside a paragraph by the paragraph's source, alone by P17.
  Still dropped once the block holding them is edited — `a [](u) b` with an
  edit saves `a  b!` — because the importer builds no node for them; that fix
  belongs in the import branch.
- **Harness.** Before: 29 entries (`parity` 2 — CommonMark 301 `listMarkers`,
  `task item text that saves escaped` `taskListMarker`; `surface` 27). After:
  31 — `surface` 27 unchanged; `parity` 1 and `verbatim` 1 (CommonMark 301,
  `listMarkers`); `canonical` 2 (CommonMark 301 `listMarkers`, the task item
  `taskListMarker`); `idempotence` and `canonicalIdempotence` none. The task
  item's `parity` moved to `canonical` as planned. CommonMark 301 keeps
  `parity` and gains `verbatim`, against the plan's "verbatim holds for every
  case": Lexical merges its two lists, so P7's rule saves them in the
  standard form. Both reasons were reworded.
- **Tests changed beyond step 7's two.** In `markdown-editor.test.ts`, also
  `round-trips its own output through a mode switch` (each document now comes
  back as written) and `the old {columns=2} attribute keeps its fence`
  (unedited, it keeps `{columns=2}`). Rows that pin the standard form now
  read it through the harness's `canonicalSave`: `markdown-importer.test.ts`'s
  R rows, I18 and I7, and RL12 in `markdown-reference-links.test.ts`, which
  also asserts the unedited source comes back.
- **Fuzz.** 17,842 one- and two-step edits (append text, delete a block,
  insert a paragraph before or after one) over the corpus and 23 extra
  documents compared the viewer's reading of the save with that of the
  standard form: equal everywhere but the task-list viewer quirk, where the
  preserved save matches the source and the standard form does not.
- **Performance.** `getValue()` on 300 paragraphs with 600 references and
  600 definition blocks: about 7.6 ms, against 6.2 ms for the standard form
  alone; the difference is the definitions lex.
- **Manual M1–M2** in the MD Editor demo (`vite`, Chrome): source mode
  showed the sample byte for byte (902 characters); after typing in the
  `yes` cell, only the table's delimiter row and that row changed. After
  **Save**, typing a character set the dirty flag and Backspace cleared it.
  No console errors.
- **Observed, out of scope:** a `:::` fence's legacy `{columns=2}` attribute
  is still dropped (`::: {}`) once the fence is edited, as before this plan.
- **Restacked onto the marked-import review fixes (round 2).** That plan
  added the serializer's `runsOn` (a raw block whose text runs on past
  itself is written as a paragraph while blocks follow it), the same probe
  `endsOpen` used; `endsOpen` now calls it and `OPEN_BLOCK_PROBE` is gone. A
  run-on raw block's standard output depends on what follows it, so a block
  added after an unclosed `<!--` at the document's end changes its
  fingerprint and it saves in that paragraph form. The round-2 importer
  tests that check the standard form of an unedited document use
  `canonicalSave`, as the tests this plan converted do.

## Whole-stack review fixes

- **Undo past an import rewrote every block (B2; deviation from "The source
  map belongs to the editor instance and is replaced on every import").** A
  `setValue`, or a switch back from source mode, is one undoable update, and
  undo brought back the earlier import's nodes, whose keys the replaced map
  no longer held: `* a\n* b\n\n_em_ text\n\n| x | y |\n|---|---|\n| 1 | 2 |`
  saved `*em*` and `| --- | --- |` after an undo, and the editor turned
  dirty. The editor now merges each import's blocks into one map
  (`adoptSourceMap`; node keys never repeat within a Lexical editor), and
  what an import knew about the document as a whole — prefix, ending, block
  count, unclosed fence, definitions — moved from the map onto a
  `MarkdownSourceLoad` each block points to, so a block is written with its
  own import's surroundings and two blocks are neighbours only within one
  import. The document's ending and a blank document's text come from the
  import of the last top-level block still in the map (else the last
  import), and a blank import records its empty paragraph so an undo back to
  it returns its own blank lines. The map is never pruned: it grows by one
  small entry per top-level block per import, no faster than Lexical's
  unbounded undo history, which already holds every import's nodes. The
  dirty flag follows, since it compares `getValue()` with the clean value.
- **Editing a definition dropped every preserved block (B3).** The map's
  blocks were discarded once the definitions differed from those at load,
  so fixing a definition's URL turned `_em_` into `*em*`, re-padded tables
  and made setext headings ATX, even with no reference link in the
  document. Each block now falls back only when its source reads
  differently: source without a `[` cannot use a definition, and source with
  one is lexed under the definitions at its load and under the current ones
  (the new `lexMarkdownWithDefinitions`, which pre-loads `marked`'s link
  map), falling back when the tokens differ. The result is cached per block
  and definitions set, so a document whose definitions were edited lexes a
  block once per new set, not once per save. P16 still holds; new tests
  cover a document with no reference link, a block with an unrelated
  `[other]`, and a reference whose definition changed.
- **One definitions lex per save.** `$definitionsKey` and
  `$collectDefinitions` each lexed every raw block's text when reference
  links existed; `$readDefinitions` now lexes once and returns the
  definitions, their comparable key and what the block serializers take
  (`null` with no reference link). The import uses it too. A test counts
  the calls (a spy on `lexMarkdownLinkDefinitions`).
- **Round-trip tests that could no longer fail (C5).** Two
  `markdown-editor.test.ts` tests compared the save of an unedited
  source-mode round trip with the document, which preservation makes
  trivially true. They now check what they meant through the harness: the importer
  reads each document as the viewer does (`editorSurfaceModel` against
  `viewerModel`), and the standard form (`canonicalSave`, what an edited
  block saves as) writes it back — byte for byte for the styled-span
  documents, normalized for the others.
- **The fuzz is committed** as
  `tests/component/markdown-roundtrip/markdown-edit-fuzz.test.ts`: for every
  corpus case, 8 seeded sequences of one or two random edits (append a word
  to an editable text node, delete a block, insert a paragraph before or
  after one), each case's stream seeded from its name. Each save must
  re-lex to the editor's surface, save again unchanged, read in the viewer
  as the standard form does, and keep every word of the source outside the
  edited and deleted blocks and every word the editor shows. It runs in
  about 4 s; with 40 sequences per case (about 18,000 edits) and a second
  seed it passed too. Known divergences use the harness's `known`
  mechanism: a new `edits` check (skipped, not asserted to fail, since a
  random edit may miss the divergent block) names a new
  `emphasisNextToWord` divergence on four cases — a pre-existing serializer
  defect the fuzz found, not a preservation one: typing a word right before
  emphasis that opens with punctuation or another delimiter run
  (`foo fuzz*\**`, `*foo fuzz**bar** baz*`, `A fuzz**[ref]**`) writes
  delimiters the flanking rules no longer read as before, in the standard
  form as much as in the save. A whole-stack review fix in
  `markdown-editor-serializer` now writes an outer pair `marked` would
  mis-pair with `_` (`_foo fuzz**bar** baz_`), so CommonMark 410 and 516
  hold (checked with 60 sequences per case under two seeds) and lost the
  entry. The two left — a delimiter between a letter and punctuation, which
  neither `*` nor `_` opens, and whose CommonMark remedy (a character
  reference for the letter) the viewer would show as typed — keep it, with
  its reason rewritten to say so. The re-lex check is also skipped for a case
  with a known `surface` or `parity` divergence, after an edit typed into
  Markdown source (a raw block shows its text until reloaded). It was also
  skipped after an edit changed the definitions of a document holding a
  kept-source run (an image kept as `![foo][]` went on showing the image once
  `[foo]`'s definition was deleted); the reference-links plan's definition
  rule now shows such a block anew, so that exemption is gone, and a
  deterministic companion removes every raw block of each corpus case whose
  kept-source runs a definition can change, in turn, checking that the
  viewer and a reload read the save as the editor shows it.
- **P7 after the marked-import unrepresentable-state round.** That round
  keeps two lists whose markers differ apart (Lexical no longer merges
  them), so `- a\n+ b` saves as written: P7 now pins that, CommonMark 301's
  `verbatim` and `canonical` entries and the `listMarkers` divergence are
  gone, and `$serializeTopLevelBlocks` keeps a list right after another list
  apart, as the serializer's block list does. The dirty-state corner case in
  the docs no longer names merged lists.


## Stack fuzz round

The marked-import plan's stack fuzz round (typing tidies run edges; a
construct the standard form would write differently is kept as written;
two raw lists an edit brings together are kept apart by `[//]: #`)
reaches this plan in four places:

- **`emphasisNextToWord` is gone.** A word typed right before emphasis that
  opens with punctuation now takes that emphasis off its edge as it is
  typed, so the save reads as shown; the divergence, its entries in
  `commonmark.ts` and `referenceLinks.ts`, and its reason are removed, and
  the `edits` check holds on those cases.
- **Read-back with the definitions (decision: read as the save does).**
  `readBackTokens` lexes with the document's definitions when the context
  has them, and `segmentReading` reads a reference link with them instead
  of giving up; `$readsBackAsShown` takes the document's definitions
  (`$collectDefinitions`). Which documents need them is now
  `$needsDefinitions` — a reference link node, or a source run whose source
  holds a `[` — replacing `$holdsReferenceLink`, so a kept `[x][ref]` run
  is read with them both when a load checks it and when a save writes it.
- **Separator between unedited raw blocks.** `separatorBefore` writes
  `[//]: #` between two raw blocks that were not next to each other at load
  and whose lists would join, as the serializer's block list does for the
  standard form.
- **Kept constructs keep their source.** A block holding one saves through
  the standard form only when edited; unedited, it saves verbatim as
  before. Adjacent text nodes of one format are merged before the
  fingerprint is taken (the serializer's `flattenInline`), so a block a
  load built in several nodes and Lexical then merged still matches its
  fingerprint.

## Stack fuzz round 2

The fifth whole-stack fuzz (harness cleaned of its own artifacts) found
one case here, fixed and pinned in `markdown-source-preservation.test.ts`:

- **A kept block that opens a label something later closes (decision:
  write it in the standard form).** An unedited paragraph whose source
  ends inside a `[` label (`[fo`) was written as its source while a block
  written after it now closes the label (a code block holding `o]: /url`);
  `marked` reads a definition's label across blank lines, so the viewer
  read the paragraph and the later text as one definition. `writtenBlocks`
  now checks, from the document's end, each block written as source whose
  text ends in such a label (`OPEN_LABEL`, a cheap filter) against what is
  written after it (`labelClosedAfter`), and writes it in the standard
  form, which escapes its `[`, when its last token reads otherwise. Only
  such blocks are lexed again, so a save's cost is unchanged otherwise.
- **Restacked onto round 3's importer fixes (`markdown-editor-marked-import`).**
  The docs' "Kept as source" paragraph conflicted between this branch's
  "(once edited, without the up to three spaces of indentation …)" and the
  importer branch's new note that a task-list marker left alone on its
  item's first line saves as the text it shows; resolved as the union.

## Stack fuzz round 4

A whole-stack fuzz at the stack's top (run and paste seeds 601 … 7703 and
two new, 8819 and 9907; source mode, two new seeds) found one case here,
fixed and pinned in `markdown-source-preservation.test.ts`:

- **A kept block that opens a definition title something later closes.**
  `marked` reads a definition's title across blank lines too: an unedited
  paragraph `[x]: </b> "` (a paragraph while nothing closes its `"`) was
  written as its source after a paste left a later block ending in `"`,
  and the viewer read the two as one definition. `labelClosedAfter` now
  also checks a block whose text ends inside such a title (`OPEN_TITLE`, a
  cheap filter beside `OPEN_LABEL`), and writes it in the standard form,
  which writes the reference there as `[x][]`.
- **Restacked onto this round's serializer and importer fixes.** `runsOn`,
  exported here for the importer's `endsOpen`, conflicted with the
  importer branch's new `rawBlockEnd` (a raw block a second blank line
  ends, `<details` on its own line); resolved as the union: `runsOn` is
  `rawBlockEnd(...) !== "apart"`, the importer's meaning unchanged, and the
  probe is `takesInProbe`.
