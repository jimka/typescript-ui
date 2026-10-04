---
depends-on: [markdown-columns-fixes]
---

# Markdown Demo Sample Table Width — Implementation Plan

## Overview

Two demo sample documents put a table column's width attribute in the **header cell** (`| Column {width=160} | Aligned |`). The library's Markdown dialect reads a column width only from a **delimiter cell** — the `:---` / `---` segment in the row under the header. So both the `Markdown` viewer and the `MarkdownEditor` show `{width=160}` as literal header text, and no width is applied. The library code is correct; the samples are wrong. This bug is already on master.

The fix moves each width onto its delimiter cell in the three places that use the header-cell form:

| File | Line | Shown by |
|---|---|---|
| [packages/lib/src/typescript/MarkdownEditorPanel.ts:27](packages/lib/src/typescript/MarkdownEditorPanel.ts#L27) | `\| Column {width=160} \| Aligned \|` | "MD Editor" demo: `MarkdownDocumentPanel` beside a `Markdown` viewer |
| [packages/lib/src/typescript/MarkdownPanel.ts:69](packages/lib/src/typescript/MarkdownPanel.ts#L69) | `\| Feature {width=200} \| Support \|` | "Markdown" demo: `MarkdownViewer` |
| [packages/lib/tests/component/markdown-source-preservation.test.ts:50](packages/lib/tests/component/markdown-source-preservation.test.ts#L50) | `\| Column {width=160} \| Aligned \|` | the test's copy of the MD Editor demo's `SAMPLE` |

It also adds a test that pins the width in the demo sample, and a round-trip corpus case for the corrected table. The docs describe the syntax correctly, so no doc page changes.[^docs-audit]

---

## Architecture Decisions

### The dialect's width syntax — a trailing group on the delimiter cell

A column width is a `{width=N}` group after a delimiter cell's dashes. The viewer's table tokenizer accepts each delimiter segment with this pattern ([markdownTableExtension.ts:98](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L98)):

```ts
const match = /^(:?-+:?)(?:\s*\{[^{}]*\})?$/.exec(segment);
```

and reads the width with `resolveColumnWidth` ([markdownAttributes.ts:537](packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L537)), documented as `resolveColumnWidth(":--- {width=240}")   // -> 240`. The docs say the same:

- [docs/components/Markdown.md:71](packages/lib/docs/components/Markdown.md#L71): "A delimiter cell's trailing `{width=240}` renders a `<colgroup>`/`<col style="width:240px">` for that column".
- [docs/components/MarkdownEditor.md:60](packages/lib/docs/components/MarkdownEditor.md#L60): "Table column width | delimiter cell's trailing `{width=240}`".

A header cell's text is tokenized as ordinary inline content, so a `{width=…}` there stays literal text.[^header-rejected]

| Source | Viewer widths | Header cell 0 text |
|---|---|---|
| `\| Column {width=160} \| Aligned \|`<br>`\|:---\|:---:\|` | `[null, null]` | `Column {width=160}` |
| `\| Column \| Aligned \|`<br>`\| :--- {width=160} \| :---: \|` | `[160, null]` | `Column` |

### Write the corrected delimiter row in the serializer's standard form

The corrected delimiter rows use spaces around every cell — `| :--- {width=160} | :---: |` — which is exactly what `formatDelimiterRow` ([markdownSerializer.ts:1110](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1110)) writes. That makes the table byte-identical both on an unedited save and when the editor rewrites the table from scratch.[^standard-form]

The MD Editor sample's current compact delimiter row `|:---|:---:|` is replaced by the spaced form. The viewer sample's `| --- | --- |` row is already spaced.

### Guard the demo sample with a test, following the existing copy

`markdown-source-preservation.test.ts` already keeps a verbatim copy of the MD Editor demo's `SAMPLE` and checks it saves unchanged (test `P1`). The new test reuses that copy and asserts the width the viewer and editor read from it. A new round-trip corpus case adds the corrected table to the harness, beside the existing `table column width` case ([corpus/dialect.ts:68](packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts#L68)).[^test-placement]

---

## Ordered Implementation Steps

1. **Write the failing test first.** In [packages/lib/tests/component/markdown-source-preservation.test.ts](packages/lib/tests/component/markdown-source-preservation.test.ts), add a new `describe` block directly after the `'an unedited document saves as loaded'` block (which ends at line 170):

   ```ts
   describe('the MD Editor demo sample', () => {
       it('P18. reads its table\'s column width from the delimiter row, in the viewer and the editor', () => {
           const viewerTable = viewerModel(SAMPLE).blocks.find((block) => block.kind === 'table');
           const editorTable = editorSurfaceModel(load(SAMPLE)).find((block) => block.kind === 'table');

           expect(viewerTable).toMatchObject({
               widths: [160, null],
               header: [
                   { align: 'left',   runs: [{ text: 'Column' }] },
                   { align: 'center', runs: [{ text: 'Aligned' }] },
               ],
           });
           expect(editorTable).toEqual(viewerTable);
       });
   });
   ```

   `viewerModel`, `editorSurfaceModel` and `load` are already imported or defined in this file. Run `npx vitest run tests/component/markdown-source-preservation.test.ts` from `packages/lib` — expect `P18` to fail: widths are `[null, null]` and the header text is `Column {width=160}`.

2. **Fix the test's `SAMPLE` copy.** In the same file, replace lines 50–51:

   ```
   | Column {width=160} | Aligned |
   |:---|:---:|
   ```

   with:

   ```
   | Column | Aligned |
   | :--- {width=160} | :---: |
   ```

   Change nothing else in `SAMPLE`. Re-run the file — expect `P18` and every `P1` case to pass.

3. **Fix the MD Editor demo.** In [packages/lib/src/typescript/MarkdownEditorPanel.ts](packages/lib/src/typescript/MarkdownEditorPanel.ts), make the identical replacement on lines 27–28. Check that the demo and the test copy still match, from the repo root — expect no output:

   ```bash
   diff <(sed -n '/^const SAMPLE = `/,/^`;/p' packages/lib/src/typescript/MarkdownEditorPanel.ts) \
        <(sed -n '/^const SAMPLE = `/,/^`;/p' packages/lib/tests/component/markdown-source-preservation.test.ts)
   ```

4. **Fix the Markdown viewer demo.** In [packages/lib/src/typescript/MarkdownPanel.ts](packages/lib/src/typescript/MarkdownPanel.ts), replace lines 69–70:

   ```
   | Feature {width=200} | Support |
   | --- | --- |
   ```

   with:

   ```
   | Feature | Support |
   | --- {width=200} | --- |
   ```

5. **Add the corpus case.** In [packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts](packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts), insert after the `'table merged rows'` entry (line 70):

   ```ts
       { name: 'table width with alignment and merge', source: '| Column | Aligned |\n| :--- {width=160} | :---: |\n| Tables | yes |\n| Merge | << |' },
   ```

   Run `npx vitest run tests/component/markdown-roundtrip -t 'table width with alignment and merge'` from `packages/lib` — expect the `parity`, `idempotence`, `surface`, `verbatim`, `canonical`, `canonicalIdempotence` and fuzz `edits` checks to pass.

6. **Check no header-cell width is left.** From the repo root: `grep -rnE '\| *[A-Za-z][^|]*\{width=[0-9]+\} *\|' packages --include=*.ts --include=*.md --include=*.txt --exclude-dir=node_modules` — expect zero matches (it matches the three lines above before the fix).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/tests/component/markdown-source-preservation.test.ts` |
| Modify | `packages/lib/src/typescript/MarkdownEditorPanel.ts` |
| Modify | `packages/lib/src/typescript/MarkdownPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |

---

## Expected Behaviour

Unit-testable:

1. **Viewer renders the width.** `viewerModel(SAMPLE)`'s table block has `widths: [160, null]`, and header cell 0's only run has text `Column` (no `{width=160}`). Covered by `P18`.
2. **Alignment is unchanged.** In the same table, header cell 0 aligns `left` and header cell 1 aligns `center`, as before the fix. Covered by `P18`.
3. **Editor shows no literal attribute text.** The table in `editorSurfaceModel(load(SAMPLE))` equals the viewer's table block from case 1, so its header cell 0 reads `Column` and its widths are `[160, null]`. Covered by `P18`.
4. **Save is byte-identical.** `load(SAMPLE).getValue()` returns `SAMPLE` unchanged. Covered by the existing `P1` case for `SAMPLE`.
5. **The table alone round-trips in both save forms.** The `table width with alignment and merge` corpus case passes `verbatim` (unedited save equals the source) and `canonical` (the serializer's standard form equals the source), plus `parity`, `surface`, `idempotence` and the edit fuzz.

Manual (visual output):

6. In the demo app (`npm run dev` in `packages/lib`), open **MD Editor**: neither the editor pane nor the viewer pane shows `{width=160}` in the table header. In DevTools, the viewer's table has a `<col style="width:160px">` for its first column.
7. Open **Markdown**: the "Sized and merged columns" table header shows `Feature` (no `{width=200}`), and DevTools shows a `<col style="width:200px">` for its first column.

---

## Verification

- From `packages/lib`: `npx vitest run tests/component/markdown-source-preservation.test.ts tests/component/markdown-roundtrip` — all pass.
- From `packages/lib`: `npm run typecheck:test` and `npm run typecheck` — no errors.
- Step 3's `diff` and step 6's `grep` — no output.
- Manual checks 6 and 7.

---

## Critical Files

- [packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts:92](packages/lib/src/typescript/lib/component/display/markdownTableExtension.ts#L92) — `parseDelimiterRow`, which defines where a width may appear.
- [packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts:1110](packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1110) — `formatDelimiterRow`, the standard form the corrected rows copy.
- [packages/lib/tests/component/markdown-source-preservation.test.ts:33](packages/lib/tests/component/markdown-source-preservation.test.ts#L33) — the `SAMPLE` copy and its `P1` check, which the new test sits beside.
- [packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts:68](packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts#L68) — the existing `table column width` case the new case sits near.

---

## Non-Goals

- **No library change.** The tokenizer, serializer and docs already agree on the delimiter-cell form; accepting a header-cell width as well would add a second syntax for one thing.[^header-rejected]
- **No changelog entry.** The demo panels are not part of the published library, so `docs/reference/changelog/next.md` gains nothing.
- **No docs example block.** The docs state the syntax correctly; adding a worked table example to `Markdown.md` is not part of this fix.

---

## Notes

[^docs-audit]: Every Markdown source in the repo was searched for `{width=` (demo samples, `packages/lib/docs/`, `packages/lib/llms.txt`, `packages/docs`, `packages/qa`, every test and the round-trip corpus). Only the three lines in the Overview table use the header-cell form. `docs/components/Markdown.md` (lines 64, 71, 124, 140) and `docs/components/MarkdownEditor.md` (lines 60, 70) all describe the delimiter-cell form, and every test fixture outside the demo copy (for example `Markdown.test.ts:1528`, `corpus/dialect.ts:68`, `markdown-editor.test.ts:2010`) uses it too. `llms.txt` does not mention table widths.

[^header-rejected]: The original design plan (`plans/implemented/markdown-rich-formatting-extension.md`, footnote `table-extension`) rejected a header-cell width: `marked` has already tokenized the cell's inline content by the time the table is built, so the `{…}` would render as visible text. A probe on this branch confirmed it: the current sample's viewer table has widths `[null, null]` and header text `Column {width=160}`, and the editor surface matches that same literal text.

[^standard-form]: A probe on this branch loaded three variants into a headless editor. The compact `|:--- {width=160}|:---:|` also reads width 160 and saves verbatim while unedited, but the serializer's standard form rewrites it to `| :--- {width=160} | :---: |` once the table is edited. The spaced form is equal to the standard form, so it stays byte-identical in both cases. It also matches how the docs and every width test fixture write the row.

[^test-placement]: `P1` alone does not catch this bug: the broken sample also saves byte-identically, and its editor surface also equals its viewer model, since both show the same literal text. Only an assertion on the width value and the header text catches it, so `P18` asserts both. The corpus case is a cheap addition that runs the corrected table through every harness check and the edit fuzz; a probe on this branch confirmed all of them pass. The viewer demo's sample (`MarkdownPanel.ts`) has no test copy; it gets the grep check and manual check 7 rather than a new copy, since it is viewer-only and its table is the same shape as the corpus case.

---

## Implementation Notes

### The test's `SAMPLE` copy: gone, where the plan edits it

**What the plan called for.** Step 2 replaces the two table lines in the
test's copy of `SAMPLE` and says "Change nothing else in `SAMPLE`"; step 3
checks with a `diff` that the copy and the demo's sample are the same text.

**What this branch's commit holds.** The two table lines in the demo, and
no copy: `markdown-source-preservation.test.ts` now reads the sample out of
the demo panel's source (`const SAMPLE = readDemoEditorSample()`), so the
tests run on the document the demo shows. Step 2 has nothing left to edit
and step 3 nothing to compare. How it came to that is told in three steps:
the bullet below, `P20` under *Review fixes*, and *Review fixes, round 2*.

**What it held at first.** The context-menu branch
(`markdown-editor-context-menu-caret`) landed below this one after the plan
was drafted. It added this bullet to the demo's `SAMPLE` in
`MarkdownEditorPanel.ts` and did not touch the test's copy:

```
- Press Shift+F10 or the menu key for the same menu at the caret
```

So the two were one line apart before this branch started, and step 3
requires its `diff` of the two to print nothing. This branch's commit first
took the bullet into the copy, as a deviation, and noted that it could
instead be folded into the context-menu branch's own commit. The combined
review of 2026-10-05 did that: the bullet now reaches the copy in the commit
that adds it to the demo, and this branch's commit no longer carries it.
At the branch below, where the copy still stands, step 3's `diff` prints
nothing, and `P1` passes on the longer sample at both branches.

### Deviation: a blank line in the `P18` snippet

**What the plan called for.** Step 1's snippet puts
`expect(editorTable).toEqual(viewerTable);` directly under the multi-line
`expect(viewerTable).toMatchObject({ … });`.

**What was done.** A blank line separates the two statements.

**Why.** The first audit flagged the snippet as written: the code
conventions require a blank line after a multi-line statement that is not
the last in its scope. The assertions are unchanged.

### Addition: `P19`, a byte-level check of the standard form

**What the plan called for.** Expected Behaviour 5 says the new corpus case
passes "`canonical` (the serializer's standard form equals the source)", and
the decision to write the delimiter row with spaces rests on that equality.

**What the second audit found.** The harness's `canonical` check does not
compare bytes. It compares the viewer's model of the standard-form save with
the viewer's model of the source, and `canonicalIdempotence` compares two
standard-form saves with each other. So the corpus case would also pass for
a table whose standard form differs from its source in spacing.

**What was done.** `markdown-source-preservation.test.ts` gained `P19` in
the same `describe` as `P18`. It checks that `SAMPLE` holds the table as its
own block, and that `canonicalSave(load(table))` returns the table
byte-for-byte. `canonicalSave` is the harness's own helper; four other test
files assert on it the same way (`markdown-editor.test.ts`,
`markdown-editor-columns.test.ts`, `markdown-importer.test.ts`,
`markdown-reference-links.test.ts`).

**Red phase.** `P19` was written after the samples were fixed, so it was
proved on a throwaway copy of the test file with the delimiter row put back
to the compact `|:--- {width=160}|:---:|`. There it failed: the standard
form came back as `| :--- {width=160} | :---: |`. The copy was deleted.

### Line numbers that had drifted

The Shift+F10 bullet the context-menu branch added moved the demo's table
down one line: the header and delimiter rows sat at `MarkdownEditorPanel.ts:28–29`, not 27–28 as step 3
says. The other three locations matched the plan. `plans/in-progress/` did
not exist on this stack and was created by the first plan move.

### Red phase

`P18` was added first and run against the unchanged samples. It failed as
step 1 predicts: `widths` was `[null, null]` and header cell 0's text was
`Column {width=160}`. The other 42 tests in the file passed. The file now
holds 44 tests, with `P19`; `P20`, which made it 45 for a while, is gone
again (see *Review fixes, round 2*).

### Manual checks 6 and 7

Run in Chromium, driven through the chrome-devtools MCP server, against this
worktree's dev server on port 8037. The server was stopped afterwards.

| Panel | Table | Header row | `<col>` styles | First cell width | `{width=` in page text |
|---|---|---|---|---|---|
| MD Editor, editor pane | sample table | `Column`, `Aligned` | `width: 160px;`, none | 160 px | no |
| MD Editor, viewer pane | sample table | `Column`, `Aligned` | `width: 160px;`, none | 160 px | no |
| Markdown | "Sized and merged columns" | `Feature`, `Support` | `width: 200px;`, none | 200 px | no |

In all three the last row is still one cell spanning both columns, and in
the MD Editor viewer the header cells still align left and centre. The
console showed two warnings, both about a code block's guessed height on the
Markdown panel; neither involves a table. Firefox was not run.

### Checks at the stack top

All from `packages/lib`, all passing: `typecheck`, `typecheck:test`, `lint`,
the whole `vitest run` (550 files, 12927 passed, 2 todo), `docs:api` with no
warnings, `docs:llms:check`, `build` (the demo app) and `build:lib`. Step 3's
`diff` and step 6's `grep` printed nothing; the `diff` has had nothing to
compare since round 2.

### Regression fuzz

The two throwaway fuzzes kept from the branches below, table-edge deletion
(`zz-table-edge-fuzz`) and column paste (`zz-column-paste-fuzz`), are not in
the repository and were never committed. They and their saved result files
live in the user's scratch directory outside it. Both were copied into
`tests/component/`, run with `FUZZ_N=3000` over seeds 601, 1709, 2207, 3313,
4409, 5521, 6607, 7703, 8819, 9907 and 11003, and deleted again.

| Fuzz | Cases | Failures | Against the results saved at the lower branches |
|---|---|---|---|
| table-edge deletion | 33000 | 0 | byte-identical for all 11 seeds |
| column paste | 31951 pastes | 925 | byte-identical for all 11 seeds |

The paste fuzz's 925 failures are not new. They are the classes
`plans/implemented/markdown-editor-column-paste.md` records under "What the
fuzz found outside this plan", and
`plans/implemented/markdown-editor-context-menu-caret.md` reports the same
count. An identical result file means the same cases fail in the same way,
so this branch adds none and removes none. That is expected: the branch
changes no library code, and neither fuzz reads the demo samples or the
round-trip corpus.

### Audit

The audit skill ran its three rounds, each with a fresh reviewer.

| Round | BLOCKING | What was done |
|---|---|---|
| 1 | No blank line after the multi-line `expect` in `P18` | Blank line added (see the deviation above) |
| 2 | Expected Behaviour 5's "standard form equals the source" had no byte-level test | `P19` added (see the addition above) |
| 2 | A sentence in these notes claimed every other multi-line `expect` in the Markdown tests is followed by a blank line; 18 of 136 are not | Sentence removed |
| 3 | The notes commit's message said "the one departure" while the notes record three, and the code commit's message named one new test of two | Both messages reworded when the fixups were folded |

Round 3 was the skill's last, so that loop did not audit the reworded
messages again; the combined review of 2026-10-05 read them (see the review
fixes below). They change no file: the tree is the same before and after.

Advisory findings, and what became of each:

- **The fuzz note named files that are not in the repo.** Fixed: the note
  now says where they live and which plans record the failure classes.
- **Who allowed the `SAMPLE` bullet.** Moot since the review fixes: the
  bullet is no longer added by this branch.
- **The test's `SAMPLE` copy has no automatic check against the demo.** Left
  open by the audit loop, fixed by the review fixes below (`P20`), and made
  moot by round 2, which removes the copy. The reason first given here for
  leaving it, that a check reading the demo's source would be a new
  mechanism the plan does not sanction, was wrong.
- **The Markdown panel's sample has no automated test.** Left as the plan
  decided: step 6's `grep` and manual check 7 cover it. Two reviewers probed
  it and read widths `[200, null]` and header text `Feature`.
- **The table text appears three times** (in the demo's `SAMPLE`, in `P19`
  and in the corpus). Left: `P19` checks its copy against `SAMPLE`, and the
  corpus case is independent test data.
- **These notes are hard-wrapped and the plan above is not.** Left: it
  matches the notes of the plans below in this stack.
- **Firefox was not run.** No Firefox tool was available.

### Review fixes

From the combined review of 2026-10-05 (items D-5 to D-8).

- **`P20`: the test's `SAMPLE` copy was checked against the demo.** (Round
  2 below replaces the guard and the copy by reading the demo directly; the
  reader this bullet describes stays.) The copy
  drifted once in this stack (the bullet above), and a source-reading drift
  guard is an existing mechanism here: `tests/unit/readme-mirror.test.ts`
  with `tests/helpers/readReadmes.mjs`, and `libraryClassScan.mjs`. `P20`
  followed it. `tests/helpers/readDemoSample.mjs` (typed by its `.d.mts`, so
  no Node types enter the test program) reads `MarkdownEditorPanel.ts`,
  finds ``const SAMPLE = `…`;`` and returns the literal's text, and `P20`
  expected the test's `SAMPLE` to be that text. The literal is read by hand,
  not evaluated: it may escape a backtick, a backslash or a `$`, and the
  reader throws on any other escape, on a `${…}` substitution, and when the
  declaration is gone or reshaped, so it fails rather than misreads. Checked
  on throwaway edits, each reverted: a reworded bullet in the demo, a
  trailing space added to the copy, the constant renamed, a substitution and
  a `\n` escape put in the demo's sample each failed `P20`.
- **The commit no longer adds the Shift+F10 bullet**, and its message and
  the first section of these notes say what it holds now.
- **The code commit's message names the three surfaces** that showed the
  literal text (the MD Editor demo's editor and viewer panes, and the
  Markdown demo's viewer), where it said "both panes".
- **`canonicalSave` is asserted on by four other test files**, not three.
- **The checks were run again at the stack top**, on this branch as it
  stood before this bullet was added (which changes only this file). The
  counts under "Checks at the stack top" and "Regression fuzz" above are the
  first run's. Now: `typecheck`, `typecheck:test`, `lint`, the whole
  `vitest run` (550 files, 13132 passed, 2 todo), `docs:api` with no
  warnings, `docs:llms:check` and `build:lib` pass, and so do `typecheck`,
  `typecheck:test` and the whole `vitest run` on each of the sixteen
  branches below, each checked out on its own. The two fuzzes ran over the
  same eleven seeds at `FUZZ_N=3000`. The table-edge one is now the variant
  that counts a declined Shift+Enter, which leaves its range, as declined:
  33000 cases, no failures, its result files byte-identical to those saved
  when the table-edge branch's review fixes landed. Column paste: 31951
  pastes, 925 failures, byte-identical to the files saved at the
  column-paste branch. These counts are that run's too; round 2's are
  below.

### Review fixes, round 2

From the re-review of 2026-10-05/06 (items R-8 and R-9).

- **The test reads the demo's sample; the copy and `P20` are gone (R-9).**
  With the reader in place the copy was redundant: a copy guarded against
  drift is the same text held twice. `markdown-source-preservation.test.ts`
  now declares `const SAMPLE = readDemoEditorSample()`, as
  `libraryClassScan.mjs` derives its data rather than guard a copy of it,
  so `P1`, `P18` and `P19` run on the document the demo shows and there is
  nothing left that could drift. The history in one line: a copy that
  drifted, then a guard on the copy (`P20`), then no copy.
- **The reader's refusals are tested.** `P20` failing was the only sign
  that the reader throws where it could misread, and with `P20` gone a
  reader that guessed would go unnoticed. The parsing is split out as
  `readSampleDeclaration(panelSource)`, which the file-reading
  `readDemoEditorSample()` calls, and `tests/unit/read-demo-sample.test.ts`
  runs it on source text made for each case: eleven shapes of a declaration
  it must not accept (gone, exported, `let`, indented, annotated, a quoted
  string, a tagged template, followed by more of an expression, without its
  semicolon, holding an unescaped backtick, never closed) and five things in
  the literal it must not read (a `\n`, a `\t` and a `\u` escape, a line
  continuation, a `${…}` substitution), each of which throws; and what it
  does read: text with line breaks and a `$` that opens no substitution,
  the three escapes that stand for themselves, and the demo's own sample.
  The tests were written before the split and failed for want of the
  function.
- **The call is out of the `if` (R-8).** The reader's test for an escape it
  reads is assigned to `standsForItself` before it is tested.
- **The commit messages say what the commits hold now**: the code commit no
  longer speaks of the test's copy, and the notes commit's summary names
  the reader in place of `P20`.
- **Checks, run again at the stack top.** `typecheck`, `typecheck:test`,
  `lint`, the whole `vitest run` (551 files, 13274 passed, 2 todo),
  `docs:api` with no warnings, `docs:llms:check`, `build` and `build:lib`
  pass on this branch; `typecheck`, `typecheck:test` and the whole
  `vitest run` pass on the two branches below it, which this round changed
  too (13201 and 13246 tests). The fourteen below those were checked by the
  round's fixes there and are not touched since. The two fuzzes ran over
  the same eleven seeds at `FUZZ_N=3000`. Table-edge deletion: 33000 cases,
  no failures, its result files byte-identical to those saved after round
  2's fixes on the branches below. Column paste: 31951 pastes, 925
  failures, byte-identical to the files saved at the column-paste branch.
  Manual checks 6 and 7 were not run again, the two samples being as they
  were. The MD Editor demo was opened in Chromium at this tip for the
  context menu branch's checks, and its sample table showed the headers
  `Column` and `Aligned` and no `{width=` text.

### Review fixes, round 3

- **The reader's errors name no file.** `readSampleDeclaration` takes any
  panel's source, but its two errors said `MarkdownEditorPanel.ts`. They
  say "the panel source" now; the tests match the rest of each message and
  did not change.
- **Checks, run again at the stack top.** The third round changed every
  branch below this one. `typecheck`, `typecheck:test`, `lint`, the whole
  `vitest run` (551 files, 13343 passed, 2 todo), `docs:api` with no
  warnings, `docs:llms:check` and `build:lib` pass on this branch, and
  `typecheck`, `typecheck:test` and the whole `vitest run` on each of the
  sixteen below it. The two fuzzes ran over the same eleven seeds at
  `FUZZ_N=3000`. Table-edge deletion: 33000 cases, no failures. Column
  paste: 31951 pastes, 925 failures. All 22 result files are byte-identical
  to the ones saved after round 2. The MD Editor demo was opened in
  Chromium at this tip for the checks the context menu branch's notes
  record; manual checks 6 and 7 were not run again, the two samples being
  as they were.
