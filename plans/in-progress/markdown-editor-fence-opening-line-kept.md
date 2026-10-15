---
depends-on: [marked-version-pin-or-upgrade]
touches-shared:
  - packages/lib/src/typescript/lib/component/display/markdownAttributes.ts
  - packages/lib/src/typescript/lib/component/display/markdownExtensions.ts
  - packages/lib/src/typescript/lib/component/editor/markdownImporter.ts
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-serializer.test.ts
  - packages/lib/tests/component/markdown-editor-table-edge.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Keeps a Fence's Opening Line — Implementation Plan

## Overview

A `:::` fence's opening line can carry words besides its `{…}` attribute group: `::: tip Title`, `::: tip {align=right}`, `::: {align=right} trailing words`. The library's own docs use this form ([component-lifecycle.md:97](../packages/lib/docs/concepts/component-lifecycle.md#L97), [custom-theme.md:80](../packages/lib/docs/recipes/custom-theme.md#L80) and nine more lines). In this plan those words are the fence's **label**: everything on the opening line after `:::` except the first attribute group.

`MarkdownEditor`'s WYSIWYG mode drops the label on a save once anything inside the fence is edited. `::: tip Title` is written back as `::: {}`, `::: tip {align=right}` as `::: {align=right}`, and a two-column `::: tip Title` as `::: columns`. Typing, a format command and a block command all trigger the loss, and so do nested fences and a fence in a list item. An unedited fence is not affected, because the top-level source map writes an untouched block exactly as it was loaded.[^repro] Two commands also remove a labelled fence outright: `setBlockAlignment(null)` and `setColumnCount(1)` unwrap a one-column fence with no alignment, even when it has a label.

The viewer ignores the label (see the first decision), so the fix is to keep it, not to render it. The importer records the whole opening line on the fence node, in place of the attribute text it records today. The serializer writes a labelled fence's line as written, rewriting only its attribute group when the fence's style changed. A labelled fence is never unwrapped by the two commands. The code changes are in [markdownAttributes.ts](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts), [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts), [markdownNodeState.ts](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts), [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts), [markdownImporter.ts](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts) and [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts). No public API changes.

Line numbers are those of `ef607a8e6`, the tip of `feature/marked-version-pin-or-upgrade`. Other plans edit the same files in other functions, so find each site by its symbol name.

---

## Owner Sign-off

| # | Question | Recommendation | This plan assumes |
|---|---|---|---|
| S1 | Should `setBlockAlignment(null)` and `setColumnCount(1)` still unwrap a one-column, unaligned fence whose opening line carries a label (`::: tip Title`)? | **No — keep the fence.** The label is the author's content (the docs app renders it as a titled callout), and neither command is about it. A labelled fence is removed in source mode, or by deleting its lines.[^keep-labelled] | No |

---

## Architecture Decisions

### The dialect does not support `::: tip Title`; the editor keeps the line as written

The viewer opens a fence on any line starting with `:::` that has more after it, reads attributes from the first `{…}` group only, and renders every fence as a plain region `<div>`. A label changes nothing in the rendered output. Admonitions (`::: tip` rendered as a callout) are a VitePress feature that the owner placed in the docs app, not in the library. So the editor has nothing to model or show for a label. It must only keep the line on a save, which is the owner's minimum for text the viewer passes through.[^dialect-evidence]

### One node state holds the whole opening line — mirroring `codeInfoState`

`fenceAttributesState` ([markdownNodeState.ts:49](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L49)) is replaced by `fenceOpeningState`. The new state holds the opening line's text after its `:::`, without trailing whitespace (` tip Title {align=right}`). The attribute text the serializer used to read from `fenceAttributesState` is now the attribute group inside that line.

This mirrors `codeInfoState` ([markdownNodeState.ts:71](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts#L71)). A code block keeps its whole info string, and [`serializeCode`](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2333) writes it while the part the editor models (the language) still matches. A fence now keeps its whole opening line, and the serializer writes it while the part the editor models (the attribute group) still gives the fence's style.[^one-state]

### The attribute group is found by one shared rule

The viewer's private `extractFenceAttributeText` ([markdownExtensions.ts:110](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L110)) finds the group with `/\{([^{}]*)\}/`. That pattern moves to `markdownAttributes.ts` as the exported `FENCE_ATTRIBUTE_GROUP`. The viewer, the label helper and the serializer all use it. The importer's own `FENCE_ATTRIBUTES` regex ([markdownImporter.ts:194](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L194)) is deleted.[^shared-group]

`markdownAttributes.ts` is the module whose header says the dialect's grammar is "kept in exactly one place so both the read-only `Markdown` viewer and the `MarkdownEditor` agree". `COLUMN_SEPARATOR` ([markdownAttributes.ts:51](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L51)) is the existing example.

### A label is the line's words outside the attribute group; `columns` alone is the editor's own

`fenceOpeningLabel(remainder)` returns the opening line's text with its attribute group cut out, trimmed. A fence **has an authored label** when that text is neither empty nor exactly `columns`. The `columns` keyword is what the serializer writes for a fence of two or more columns. The serializer keeps rewriting it from the column count, as it does today.[^columns-keyword]

| Opening line | `fenceOpeningLabel` | Authored label? |
|---|---|---|
| `::: tip Title` | `tip Title` | yes |
| `::: tip {align=right}` | `tip` | yes |
| `::: {align=right} trailing words` | `trailing words` | yes |
| `::: {align=right} {gap=1em}` | `{gap=1em}` | yes |
| `::: columns Title` | `columns Title` | yes |
| `::: columns {gap=2em}` | `columns` | no |
| `::: {align=right}`, `::: {}` | `""` | no |
| a fence made in the editor (state `""`) | `""` | no |

### A labelled fence's line is written as loaded, its attribute group rewritten only when the style changed

A fence without an authored label is written exactly as today: `columns` for two or more columns, then its attributes, and `{}` for a one-column fence with none. A fence with an authored label is written as `:::` plus its loaded text, with the attribute group handled as follows. "Attributes" is what `fenceAttributeText` returns: the loaded group's text while it still resolves to the fence's alignment and gap, else the normalized attributes.

| Loaded line (after `:::`) | Attributes now | Written line | Rule |
|---|---|---|---|
| ` tip Title` | `""` | `::: tip Title` | no group, no attributes: as loaded |
| ` tip Title` | `align=center` | `::: tip Title {align=center}` | no group: add one at the end |
| ` tip {x=1 align=right}` | `x=1 align=right` (still resolves) | `::: tip {x=1 align=right}` | group unchanged: as loaded |
| ` tip {align=right}` | `align=center` | `::: tip {align=center}` | group replaced in place |
| ` {align=right} trailing words` | `""` | `::: trailing words` | group dropped with the whitespace before it |
| ` {align=right} {gap=1em}` | `""` | `::: {} {gap=1em}` | group emptied, not dropped: a later group would become the one the viewer reads |
| ` tip {}` | `""` | `::: tip {}` | group text equals attributes: as loaded |
| `   tip   Spaced  ` | `""` | `:::   tip   Spaced` | trailing whitespace is not recorded[^trailing-space] |

The column count never changes a labelled line: a labelled fence of any column count already has a non-empty opening line, so it needs no `columns` keyword.

### `canUnwrap()` is false for a fence with an authored label

`MarkdownBlockNode.canUnwrap()` ([markdownBlockNode.ts:205](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L205)) gains a third condition, `!this.hasAuthoredLabel()`. Its only callers are `setBlockAlignment` and `setColumnCount` ([MarkdownEditor.ts:7846](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7846), [:7919](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7919)). Both now leave a labelled fence in place, and a call that changes nothing else adds no undo step, as their docs already promise. This is sign-off S1.[^keep-labelled]

---

## Internal Structure

No exported package symbol changes; every symbol below is internal to the library.

### `display/markdownAttributes.ts` — after `COLUMN_SEPARATOR`

```typescript
/**
 * A `:::` fence opening line's attribute group: the first `{…}` holding no
 * brace, anywhere after the `:::`. The viewer reads the fence's attributes
 * from it and ignores the rest of the line.
 */
export const FENCE_ATTRIBUTE_GROUP = /\{([^{}]*)\}/;

/** The keyword the editor writes on a fence of two or more columns; a label of only this word is the editor's own. */
export const FENCE_COLUMNS_KEYWORD = "columns";

/**
 * The words of a `:::` fence's opening line outside its attribute group
 * ({@link FENCE_ATTRIBUTE_GROUP}) — `tip Title` in `::: tip Title {align=right}`.
 * The viewer ignores them.
 *
 * @param remainder - The opening line's text after its `:::`.
 * @returns The words, trimmed, a space standing where the group stood; `""` for none.
 */
export function fenceOpeningLabel(remainder: string): string {
    const group = FENCE_ATTRIBUTE_GROUP.exec(remainder);

    if (group === null) {
        return remainder.trim();
    }

    return (remainder.slice(0, group.index) + " " + remainder.slice(group.index + group[0].length)).trim();
}
```

`FENCE_ATTRIBUTE_GROUP` has no `g` flag, so `exec` and `test` keep no state between calls.

### `editor/markdownNodeState.ts` — replaces `fenceAttributesState`

```typescript
/**
 * The opening line a `:::` fence was loaded with, as it was written after
 * its `:::` and without trailing whitespace (` tip Title {gap=2rem bogus=1}`),
 * so a save keeps the words the viewer ignores (a `tip Title` label), the
 * attributes' order and the attributes the editor does not model. The
 * serializer writes the attribute group only while it still resolves to the
 * fence's alignment and column gap; `""` (the default) is a fence made in
 * the editor, written in the standard form.
 */
export const fenceOpeningState: StateConfig<"mdFenceOpening", string> = createState("mdFenceOpening", {
    parse: (value) => (typeof value === "string" ? value : ""),
});
```

### `editor/markdownBlockNode.ts`

```typescript
import { $getState, ElementNode } from "lexical";
import { blockStyleToAttributes, FENCE_COLUMNS_KEYWORD, fenceOpeningLabel, resolveBlockStyle } from "~/component/display/markdownAttributes.js";
import { fenceOpeningState } from "~/component/editor/markdownNodeState.js";

canUnwrap(): boolean {
    return this.getAlign() === null && this.getColumns().length <= 1 && !this.hasAuthoredLabel();
}

/**
 * True when this fence was loaded with words on its opening line besides
 * its attribute group and the `columns` keyword — a `tip Title` label —
 * which a save keeps as written.
 *
 * @returns Whether the fence's opening line carries the author's own words.
 */
hasAuthoredLabel(): boolean {
    const label = fenceOpeningLabel($getState(this, fenceOpeningState));

    return label !== "" && label !== FENCE_COLUMNS_KEYWORD;
}
```

`canUnwrap()`'s JSDoc gains: "A fence with an authored label ({@link hasAuthoredLabel}) is never bare." `markdownNodeState.ts` imports only `lexical`, so the new import makes no cycle.

### `editor/markdownImporter.ts` — in `$buildFence`

```typescript
/** A `:::` fence's opening line: the text after its `:::`, without trailing whitespace. */
const FENCE_OPENING = /^\s*:::(.*?)\s*$/;

$setState(fence, fenceOpeningState, FENCE_OPENING.exec(token.raw.slice(0, lineEndAt(token.raw, 0)))?.[1] ?? "");
```

### `editor/markdownSerializer.ts` — `serializeFence` and its helpers

`serializeFence` replaces its `attributes` / `opening` lines with `const opening = fenceOpeningLine(node, columns.length);`. Its JSDoc's first sentence becomes "Serializes a `:::` fence: its opening line ({@link fenceOpeningLine}), its columns and its closing `:::`." `fenceAttributeText` takes the loaded attribute text as a parameter instead of reading the state itself; its body is otherwise unchanged.

```typescript
function fenceOpeningLine(node: MarkdownBlockNode, columnCount: number): string {
    const authored = $getState(node, fenceOpeningState);
    const group = FENCE_ATTRIBUTE_GROUP.exec(authored);
    const attributes = fenceAttributeText(node, group?.[1] ?? "");
    const labelled = node.hasAuthoredLabel();

    if (labelled) {
        return ":::" + withAttributeGroup(authored, group, attributes);
    }

    return ":::"
        + (columnCount > 1 ? " " + FENCE_COLUMNS_KEYWORD : "")
        + (attributes !== "" ? ` {${attributes}}` : columnCount > 1 ? "" : " {}");
}

function withAttributeGroup(authored: string, group: RegExpExecArray | null, attributes: string): string {
    if (group === null) {
        return attributes === "" ? authored : `${authored} {${attributes}}`;
    }

    if (group[1] === attributes) {
        return authored;
    }

    const before = authored.slice(0, group.index);
    const after = authored.slice(group.index + group[0].length);
    // A later group would become the one the viewer reads once this one goes, so it stays, emptied.
    const droppable = attributes === "" && !FENCE_ATTRIBUTE_GROUP.test(after);

    return droppable ? before.trimEnd() + after : `${before}{${attributes}}${after}`;
}

function fenceAttributeText(node: MarkdownBlockNode, authored: string): string {
    const normalized = formatAttributes(node.toAttributes());
    const writable = authored !== "" && !/[\n{}]/.test(authored);

    return writable && formatAttributes(blockStyleToAttributes(resolveBlockStyle(parseAttributes(authored)))) === normalized ? authored : normalized;
}
```

Each function gets a JSDoc block in the file's style. `withAttributeGroup`'s describes the table under *A labelled fence's line is written as loaded*.

---

## Ordered Implementation Steps

1. **Tests first.** Create `packages/lib/tests/component/markdown-editor-fence-opening-line.test.ts` with the cases in [Expected Behaviour](#expected-behaviour). Copy the `load` / `update` / `$textNode` / `selectText` helpers and the `installTestDOM` setup from [markdown-editor-columns.test.ts](../packages/lib/tests/component/markdown-editor-columns.test.ts) (lines 1–110). Every saved document is also checked with `expect(viewerModel(saved).blocks).toEqual(editorSurfaceModel(editor))`. Run it: the E, N, C and U rows fail (the U rows because `fenceOpeningLabel` does not exist yet); the K rows pass.
2. **`markdownAttributes.ts`.** Add `FENCE_ATTRIBUTE_GROUP`, `FENCE_COLUMNS_KEYWORD` and `fenceOpeningLabel` after `COLUMN_SEPARATOR`, as in *Internal Structure*. Run the U rows: green.
3. **`markdownExtensions.ts`.** In `extractFenceAttributeText` (line 110), replace the inline `/\{([^{}]*)\}/` with `FENCE_ATTRIBUTE_GROUP`; add it to the `markdownAttributes.js` import at line 5. Check: `grep -c 'FENCE_ATTRIBUTE_GROUP' packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` prints `2`.
4. **`markdownNodeState.ts`.** Replace `fenceAttributesState` (lines 42–51) with `fenceOpeningState` as in *Internal Structure*.
5. **`markdownBlockNode.ts`.** Update the imports, add `hasAuthoredLabel()`, and add its condition and JSDoc sentence to `canUnwrap()`.
6. **`markdownImporter.ts`.** Replace the `FENCE_ATTRIBUTES` constant (lines 190–194) with `FENCE_OPENING`. In `$buildFence` (line 1223), set `fenceOpeningState` from it. Rename the import at line 36, and change `$buildFence`'s JSDoc from "its authored attribute text ({@link fenceAttributesState})" to "its authored opening line ({@link fenceOpeningState})".
7. **`markdownSerializer.ts`.** Rename the import at line 34. Add `FENCE_ATTRIBUTE_GROUP` and `FENCE_COLUMNS_KEYWORD` to the `markdownAttributes.js` import at line 19. Replace `serializeFence`'s opening-line code and `fenceAttributeText` (lines 2847–2890) with the code in *Internal Structure*. Check: `grep -rn 'fenceAttributesState\|FENCE_ATTRIBUTES' packages/lib/src packages/lib/tests` finds nothing.
8. **`markdown-serializer.test.ts`.** Import `fenceOpeningState` instead of `fenceAttributesState` (line 18). In the describe at line 1467, the `fence` helper sets the authored text as an opening line: `` $setState(block, fenceOpeningState, ` {${authored}}`) ``. The three existing expectations stay as they are. Add one case to the same describe: a one-column fence with no alignment, `fenceOpeningState` set to `' tip Title'` and a paragraph `text`, passed through `jsonRoundTrip`, serializes to `'::: tip Title\ntext\n:::'` (row P2).
9. **`markdown-editor-table-edge.test.ts`.** Four expectations pin the defect: they load `::: x` and expect `::: {}`. Change `::: {}` to `::: x` at line 380 (`TABLES_THEN_FENCED_CODE_IMAGE_RESULT`), 551 (D19), 571 (D21) and 1689 (U4's D19 row). Nothing else in the file changes.
10. **Corpus.** In [dialect.ts](../packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts), after `attribute-less fence` (line 78), add `{ name: 'labelled fence', source: '::: tip Title\nA\n:::' }`, `{ name: 'labelled fence with attributes', source: '::: tip Title {align=right}\nA\n:::' }` and `{ name: 'labelled two-column fence', source: '::: tip Title\nA\n|||\nB\n:::' }`.
11. **`MarkdownEditor.ts` JSDoc.** In `setBlockAlignment` (line 7805), after "Unwraps and removes the enclosing fence when clearing its alignment leaves it with no more than one column either", add "— unless its opening line carries the author's own words (`::: tip Title`), which keeps it". In `setColumnCount` (line 7864), add the same clause after "no alignment". No code changes in this file.
12. **Docs and changelog.** Make the edits in [Documentation Impact](#documentation-impact).
13. **Checks.** Run everything in [Verification](#verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/markdownAttributes.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownImporter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` (JSDoc only) |
| Create | `packages/lib/tests/component/markdown-editor-fence-opening-line.test.ts` |
| Modify | `packages/lib/tests/component/markdown-serializer.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit-testable in the headless editor. "Type" appends `Z` to the named text node in one discrete update; a command selects the whole named text node first. "Today" is the measured output at `ef607a8e6`; the test asserts the "After" column.

**E — typing inside a fence keeps its opening line**

| # | Loaded | Typed into | Today | After |
|---|---|---|---|---|
| E1 | `::: tip Title⏎body⏎:::` | `body` | `::: {}⏎bodyZ⏎:::` | `::: tip Title⏎bodyZ⏎:::` |
| E2 | `::: tip⏎body⏎:::` | `body` | `::: {}⏎…` | `::: tip⏎bodyZ⏎:::` |
| E3 | `::: tip {align=right}⏎body⏎:::` | `body` | `::: {align=right}⏎…` | `::: tip {align=right}⏎bodyZ⏎:::` |
| E4 | `::: {align=right} trailing words⏎body⏎:::` | `body` | `::: {align=right}⏎…` | as loaded, `bodyZ` |
| E5 | `::: {align=right} {gap=1em}⏎body⏎:::` | `body` | `::: {align=right}⏎…` | as loaded, `bodyZ` |
| E6 | `::: tip Title⏎left⏎\|\|\|⏎right⏎:::` | `left` | `::: columns⏎…` | `::: tip Title⏎leftZ⏎\|\|\|⏎right⏎:::` |
| E7 | `::: columns Title⏎body⏎:::` | `body` | `::: {}⏎…` | as loaded, `bodyZ` |
| E8 | `:::tip⏎body⏎:::` | `body` | `::: {}⏎…` | `:::tip⏎bodyZ⏎:::` |
| E9 | `::: tip *Em* \`code\` [l](/x)⏎body⏎:::` | `body` | `::: {}⏎…` | as loaded, `bodyZ` (the label is not read as inline Markdown) |
| E10 | `::: tip {broken⏎body⏎:::` | `body` | `::: {}⏎…` | as loaded, `bodyZ` |

**N — nested fences and fences in containers**

| # | Loaded | Typed into | After |
|---|---|---|---|
| N1 | `::: outer O⏎::: inner I⏎inside⏎:::⏎:::` | `inside` | `::: outer O⏎::: inner I⏎insideZ⏎:::⏎:::` (today both lines become `::: {}`) |
| N2 | `::: outer O⏎outer text⏎⏎::: inner I⏎inside⏎:::⏎:::` | `outer text` | as loaded, `outer textZ` |
| N3 | `- item⏎⏎  ::: tip T⏎  body⏎  :::` | `body` | `- item⏎⏎  ::: tip T⏎  bodyZ⏎  :::` |
| N4 | `- ::: tip T⏎  body⏎  :::` (fence on the marker line) | `body` | `- ::: tip T⏎  bodyZ⏎  :::` |

**K — the standard form is unchanged for fences without an authored label (control)**

| # | Loaded | Typed into | After |
|---|---|---|---|
| K1 | `::: {align=right}⏎body⏎:::` | `body` | `::: {align=right}⏎bodyZ⏎:::` |
| K2 | `::: {}⏎body⏎:::` | `body` | `::: {}⏎bodyZ⏎:::` |
| K3 | `::: columns {gap=2em}⏎left⏎\|\|\|⏎right⏎:::` | `left` | `::: columns {gap=2em}⏎leftZ⏎\|\|\|⏎right⏎:::` |
| K4 | `::: columns⏎left⏎\|\|\|⏎right⏎:::`, then `setColumnCount(1)` | — | `left⏎⏎right` (still unwrapped: `columns` is not a label) |

**C — commands**

| # | Loaded | Command | Today | After |
|---|---|---|---|---|
| C1 | `::: tip Title⏎body⏎:::` | `toggleBold()` | `::: {}⏎**body**⏎:::` | `::: tip Title⏎**body**⏎:::` |
| C2 | `::: tip Title⏎body⏎:::` | `setBlockAlignment("center")` | `::: {align=center}⏎…` | `::: tip Title {align=center}⏎body⏎:::` |
| C3 | `::: tip {align=right}⏎body⏎:::` | `setBlockAlignment("center")` | `::: {align=center}⏎…` | `::: tip {align=center}⏎body⏎:::` |
| C4 | `::: {align=right} trailing words⏎body⏎:::` | `setBlockAlignment("center")` | `::: {align=center}⏎…` | `::: {align=center} trailing words⏎body⏎:::` |
| C5 | `::: tip {align=right}⏎body⏎:::` | `setBlockAlignment(null)` | `body` | `::: tip⏎body⏎:::` |
| C6 | `::: {align=right} trailing words⏎body⏎:::` | `setBlockAlignment(null)` | `body` | `::: trailing words⏎body⏎:::` |
| C7 | `::: {align=right} {gap=1em}⏎body⏎:::` | `setBlockAlignment(null)` | `body` | `::: {} {gap=1em}⏎body⏎:::` |
| C8 | `::: tip Title⏎body⏎:::` | `setBlockAlignment(null)` | `body` | unchanged: `getValue()` returns the loaded text |
| C9 | `::: tip Title⏎left⏎\|\|\|⏎right⏎:::` | `setColumnCount(1)` | `left⏎⏎right` | `::: tip Title⏎left⏎⏎right⏎:::` |
| C10 | `::: tip Title⏎body⏎:::` | `setColumnCount(3)` | `::: columns⏎body⏎\|\|\|⏎⏎\|\|\|⏎⏎:::` | `::: tip Title⏎body⏎\|\|\|⏎⏎\|\|\|⏎⏎:::` |
| C11 | `::: outer O⏎::: inner I⏎inside⏎:::⏎:::`, `inside` selected | `setBlockAlignment(null)` | `::: {}⏎inside⏎:::` | unchanged |

**U — `fenceOpeningLabel`**

| # | Input | Result |
|---|---|---|
| U1 | `" tip Title"` | `"tip Title"` |
| U2 | `"tip{align=right}Title"` | `"tip Title"` |
| U3 | `" columns {gap=2em}"` | `"columns"` |
| U4 | `" {align=right}"` | `""` |
| U5 | `" {a=1} {b=2}"` | `"{b=2}"` |
| U6 | `""` | `""` |

**P — the save agrees with the viewer and reloads to the same document**

- P1. For every E, N, K and C row: `viewerModel(saved).blocks` equals `editorSurfaceModel(editor)`, and loading `saved` into a new editor gives the same `editorSurfaceModel`.
- P2. A labelled fence survives a JSON round trip of its node, as a copy and paste does (step 8).

**Manual check (not automatable).** In the demo app's MD Editor tab, replace the sample with `::: tip Title⏎body⏎:::⏎⏎after`, type a letter into `body`, then switch to source mode: the first line reads `::: tip Title`.

---

## Verification

Run from `packages/lib`. Check `free -g` before each vitest run; wait while under 6 GB available.

- `npm run typecheck` and `npm run typecheck:test` — no errors.
- `npx eslint src/typescript/lib/component/display/markdownAttributes.ts src/typescript/lib/component/display/markdownExtensions.ts src/typescript/lib/component/editor/markdownNodeState.ts src/typescript/lib/component/editor/markdownBlockNode.ts src/typescript/lib/component/editor/markdownImporter.ts src/typescript/lib/component/editor/markdownSerializer.ts src/typescript/lib/component/editor/MarkdownEditor.ts` — clean.
- `npx vitest run tests/component/markdown-editor-fence-opening-line.test.ts --maxWorkers=2` — every row in Expected Behaviour passes.
- `npx vitest run tests/component/markdown tests/component/display --maxWorkers=2` — all green, including the four updated table-edge rows and the three new corpus cases.
- `npx vitest run --maxWorkers=2` — the full suite, once, green.
- `npm run docs:api` — zero warnings.
- `grep -rn 'fenceAttributesState\|FENCE_ATTRIBUTES' packages/lib/src packages/lib/tests` — no matches.
- The manual check above.

---

## Documentation Impact

No export changes, so no API page or barrel changes.

- **[MarkdownEditor.md:62](../packages/lib/docs/components/MarkdownEditor.md#L62)** — the "Block alignment / column region" row's right cell gets: "; a loaded fence keeps its opening line as written — words the viewer ignores (`::: tip Title`) and its attribute group, which is rewritten only once the fence's alignment or gap changes".
- **[MarkdownEditor.md:130–131](../packages/lib/docs/components/MarkdownEditor.md#L130)** — the `setBlockAlignment` and `setColumnCount` rows each get: "A fence whose opening line carries the author's own words (`::: tip Title`) is never unwrapped."
- **[Markdown.md:126](../packages/lib/docs/components/Markdown.md#L126)** — after "it exists only so a two-column region with no attributes still has a non-empty opening line.", add: "Any other text on the opening line outside its first `{…}` group — the `tip Title` of `::: tip Title` — is ignored the same way: the fence renders as a plain region, not as a titled callout. `MarkdownEditor` keeps that text as written when it saves the fence."
- **[changelog/next.md](../packages/lib/docs/reference/changelog/next.md)** — under `## Fixed` › `### Components`, next to the existing `:::` entries:

  > **`MarkdownEditor` keeps a `:::` fence's opening line.** Editing anything inside a fence whose opening line carried more than its attributes — `::: tip Title`, `::: tip {align=right}`, `::: {align=right} more words` — saved the line as `::: {}`, `::: {align=right}` or `::: columns`, dropping the words. The words are now kept, and the attribute group is rewritten only when the fence's alignment or gap changes. `setBlockAlignment(null)` and `setColumnCount(1)` no longer remove such a fence. No consumer action is needed.

---

## Potential Challenges

- **`$getState` needs an active editor state.** `hasAuthoredLabel()` is called only from `canUnwrap()` (inside the commands' `update`) and from the serializer (inside a `read`), so it always has one.
- **Four existing tests expect the defect.** The table-edge rows in step 9 load `::: x` and expect `::: {}`. Change only those four strings; their other assertions stay.
- **Dropping a group must not promote a later one.** A line with two groups keeps the first as `{}` (row C7); without that rule the viewer would read the second group's `gap` while the editor shows none, which the P check catches.
- **Clipboard JSON from before the change.** The state key changes from `mdFenceAttributes` to `mdFenceOpening`. Nothing persists editor JSON across versions, so content copied before an upgrade cannot reach a newer editor.

---

## Critical Files

- [markdownNodeState.ts](../packages/lib/src/typescript/lib/component/editor/markdownNodeState.ts) — `codeInfoState` (line 71) is the precedent; `fenceAttributesState` (line 49) is replaced.
- [markdownSerializer.ts:2322–2350](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2322) — `serializeCode`, the precedent for writing a kept line while its modelled part still matches; `serializeFence` and `fenceAttributeText` at lines 2847–2890.
- [markdownImporter.ts:1209–1234](../packages/lib/src/typescript/lib/component/editor/markdownImporter.ts#L1209) — `$buildFence`.
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts) — `MarkdownBlockNode.canUnwrap()`.
- [markdownExtensions.ts:102–191](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L102) — the viewer's fence tokenizer and `extractFenceAttributeText`.
- [markdownAttributes.ts:1–51](../packages/lib/src/typescript/lib/component/display/markdownAttributes.ts#L1) — the shared-grammar module the new constants join.
- [MarkdownEditor.ts:7805–7928](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7805) — `setBlockAlignment` and `setColumnCount`, the two `canUnwrap()` callers.

---

## Non-Goals

- **Rendering admonitions.** `::: tip Title` stays a plain region in the viewer and the editor; the owner placed admonitions in the docs app ([containers.ts](../packages/docs/src/content/containers.ts)), which is unchanged.
- **Showing or editing the label in WYSIWYG mode.** The viewer does not show it either; it is edited in source mode.
- **Fences inside a blockquote.** `> ::: tip T` loads as a raw block and already saves as written.
- **The standard form of unlabelled fences.** `::: {}`, `::: columns` and `::: columns {…}` are written as today (rows K1–K4).
- **The importer's leading whitespace before `:::`.** A fence's indentation is the container's business and is written as today.

---

## Notes

[^repro]: Measured at `ef607a8e6` with a headless test that loaded 24 opening-line forms and, for each, typed into the fence and ran `toggleBold`, `setBlockAlignment("center")`, `setBlockAlignment(null)`, `setColumnCount(3)` and `setColumnCount(1)`. Every form with text outside its first attribute group lost that text on the edited save; only `::: {…}`, `::: {}`, `::: columns` and `::: columns {…}` survived. A prototype of this plan's change turned every row into the "After" column, with the viewer model of each save equal to the editor's surface and each save reloading to the same surface. The markdown and viewer tests (47 files, 10,173 tests) all passed except the four table-edge expectations in step 9, which pin the defect; with those four updated, the full suite (564 files) passed.

[^dialect-evidence]: The viewer's `BLOCK_EXTENSION` ([markdownExtensions.ts:130](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts#L130)) opens on `:::` plus any non-empty remainder and passes only `extractFenceAttributeText(openingRemainder)` on (line 181); `Markdown.appendBlock` ([Markdown.ts:1921](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L1921)) renders a `<div>` from the attributes and columns alone. [Markdown.md:126](../packages/lib/docs/components/Markdown.md#L126) documents that the `columns` keyword is ignored by both parsers, and the same holds for any other word. The decision against admonitions in the library is recorded in [packages-docs.md:79](implemented/packages-docs.md#L79) and its footnote `containers-app-level`: "`:::` containers are VitePress-specific syntax … Adding them to the viewer would drag a matching editor transformer along under the parity contract". The docs app expands them into blockquotes before the source reaches `Markdown` ([containers.ts](../packages/docs/src/content/containers.ts)). Supporting admonitions fully would reverse that recorded decision, so it is not offered here as an open choice. Source mode edits the raw text and never runs the serializer, so it already keeps the line; the WYSIWYG save is the only surface that loses it.

[^one-state]: Two alternatives were rejected. Keeping `fenceAttributesState` and adding a second state for the label gives two sources of truth for one line, which can disagree (a test or a paste could set one and not the other), and loses where the group stood among the words. Storing the label alone, without the group's position, cannot write `::: {align=right} trailing words` back as written. One state for the whole line, checked at save time, is what `codeInfoState` already does for a code block's info string.

[^shared-group]: The importer's `FENCE_ATTRIBUTES` (`/^\s*:::[^{\n]*\{([^{}\n]*)\}/`) and the viewer's `/\{([^{}]*)\}/` disagree on a line such as `::: a {b {c=1}`: the viewer reads `c=1`, the importer finds no group. The fence's style still came from the viewer's token, so only the kept attribute text was lost; with the label now kept, the two must agree on where the group is, or a rewrite would replace the wrong span.

[^columns-keyword]: [markdown-explicit-column-regions.md:60](implemented/markdown-explicit-column-regions.md#L60) introduced `columns` as an exporter convention whose only job is to make an attribute-free multi-column opening line non-empty. Keeping a loaded `columns` verbatim would leave `::: columns {align=right}` on a fence merged down to one column, and would stop a merged `::: columns` fence from unwrapping (row K4) — both changes to behaviour nobody asked for. A label that merely starts with `columns` (`columns Title`) is the author's and is kept.

[^trailing-space]: Trailing whitespace on the opening line is invisible and means nothing to the viewer, the editor or the docs app, so dropping it on an edited save changes nothing anyone reads; an unedited fence keeps it anyway through the source map. Leading whitespace after `:::` is kept, because `:::tip` and `::: tip` are both plausible author spellings.

[^keep-labelled]: Before this change, the commands unwrapped any one-column, unaligned fence because such a fence had "nothing left to justify it". A labelled fence has something: words the author wrote, which the docs app renders as a titled callout. `setBlockAlignment(null)` on `::: tip Title` (which has no alignment to clear) removed the fence and its title, and `setColumnCount(1)` on a two-column `::: tip Title` did the same after merging. With `canUnwrap()` false, C8 and C11 become the no-ops the selection-state docs already describe for "a call with what the `:::` block has". The cost is that WYSIWYG mode has no command that removes a labelled fence; the author removes it in source mode. If the owner prefers unwrapping, drop the `!this.hasAuthoredLabel()` condition and rows C8, C9 and C11 change to today's outputs; the save-side fix is unaffected.
