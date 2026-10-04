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
