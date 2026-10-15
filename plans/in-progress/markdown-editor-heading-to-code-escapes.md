---
depends-on: [code-editor-flash-after-dispose]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts
  - packages/lib/tests/component/markdown-document-panel.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Heading-to-Code Escapes — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode, `setBlockType("code")` on a heading gives a code block whose text carries a backslash the heading never showed: `### +alpha` becomes a code block holding `\+alpha`. Source mode gives `+alpha`. The repository's owner decided on 2026-10-14 that source mode is right (sign-off 8 of [markdown-source-mode-command-gaps.md](markdown-source-mode-command-gaps.md)). This plan fixes the WYSIWYG side.

The escape enters in [MarkdownEditor.ts:372](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L372), `$copyBlockAsCodeSource`, the hook `$setBlocksType` runs for each block it turns into a code block. The hook writes every block's inline content as a paragraph writes it ([markdownSerializer.ts:913](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L913), `$serializeInlineNodes`, context `MULTI_LINE`). A paragraph escapes a block-start character at a line's start (`LINE_START_ESCAPED`, [markdownSerializer.ts:268](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L268)). A heading's line needs none of those escapes, and needs one a paragraph does not: a trailing `#` run is escaped so the heading rule does not strip it ([markdownSerializer.ts:2289](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2289), `serializeHeading`). The fix writes each block's content as that block's own save writes it. Only the heading changes; a paragraph, quote and list item's text are already written in their own form.

The change is one new serializer export, `$serializeBlockContent`, which shares its heading branch with `serializeHeading`, and one call in `$copyBlockAsCodeSource`. Source mode, the typing shortcuts and the reverse conversion (code block to another block) are not changed. Line numbers are from `736452bbc`, the tip of the Markdown stack (`code-editor-flash-after-dispose`). Every result below was measured on the same files, with the change as given here in place of the real modules.[^measured]

---

## Architecture Decisions

### A code block holds the block's text as the block's own Markdown writes it

A code block made from a block holds the Markdown that the block's own save writes for its text, without the block's syntax (`#`s, `> `, a list marker, a setext underline). For any document in the editor's standard form, that is the text source mode takes from the block's line, so the two surfaces agree.[^rule]

| Block (as saved) | It shows | Code block holds, after | Before (WYSIWYG) | Why |
|---|---|---|---|---|
| `### +alpha` | `+alpha` | `+alpha` | `\+alpha` | a heading's line escapes nothing at its start |
| `# alpha \#` | `alpha #` | `alpha \#` | `alpha #` | the heading's line escapes its last `#`, or `alpha #` would read as `alpha` |
| `\+alpha` (a paragraph) | `+alpha` | `\+alpha` | `\+alpha` | unchanged: this is the paragraph's own Markdown |
| `## +**bold** alpha` | +**bold** alpha | `+**bold** alpha` | `\+**bold** alpha` | formatting stays Markdown, as before |

The second row is the one place where the code shows a backslash the heading did not show. It follows the owner's decision: source mode gives `alpha \#` there, and both `E41` rows move to `SAME`.[^row-two]

### The serializer writes a heading's content in one place

`serializeHeading`'s body is split: a new private `writtenHeadingContent(node, definitions)` returns the content and whether it is written setext, and `serializeHeading` adds the `#`s or the underline. The new export `$serializeBlockContent(block)` returns `writtenHeadingContent(...).content` for a heading and the block's lines in the paragraph context for any other block. This mirrors how the serializer already picks a heading's own context when it reads a block's content: `$readStandardForm` ([markdownSerializer.ts:1006](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1006)) and `inlineRuns` ([markdownSerializer.ts:1061](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1061)) both choose `headingContext(node)` for a heading. `$serializeBlock` ([markdownSerializer.ts:899](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L899)) is the precedent for an exported "as a save writes it" entry point that the editor uses to fill a text-only block.[^one-place]

`$serializeInlineNodes` loses its `inListItem` parameter: `$copyBlockAsCodeSource` was its only caller that passed it.

### Every WYSIWYG route to a code block goes through the same hook

The toolbar's *Insert… ▸ Code block* ([MarkdownDocumentPanel.ts:324](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L324)), the context menu's *Block style ▸ Code block* ([MarkdownEditor.ts:9039](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9039)) and *Insert ▸ Code block* ([MarkdownEditor.ts:9116](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L9116)) all call `setBlockType("code")`. A selection across several blocks runs the hook once per block, so each block is written in its own form. No route needs its own change.

A code fence typed at the start of a heading's text (` ``` ` and a space) is a different route: Lexical's `CODE` shortcut moves the heading's nodes into the code block, and `$keepTextOnly` ([MarkdownEditor.ts:2939](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2939)) turns only formatted runs into Markdown. Plain text goes in as it shows, so this route adds no escape and is not changed. A test pins it.[^typed-fence]

### A block made from a code block is not changed

Turning a code block into a paragraph or heading on the WYSIWYG surface moves the code's text in as text: the new block shows the code's characters exactly, and its save escapes what it must. The new block gains and loses no visible backslash, so this direction does not have the defect.[^inverse] Because the code block now holds the heading's own Markdown, `# alpha \#` made a code block and then a heading again shows `alpha \#`, where before the fix it came back as it was. Tests pin both directions.

### Tests are parity rows plus a few WYSIWYG-only tests

Every heading shape that both surfaces convert alike is a row in `SAME` of `describe('MarkdownEditor list toggles in a list of their kind')` ([markdown-editor.test.ts:1113](../packages/lib/tests/component/markdown-editor.test.ts#L1113)), so the source-mode result is checked too. The shapes source mode converts differently for another reason — several blocks (row `E5`) and a heading inside a list item (row `E12`) — are WYSIWYG-only tests after the parity loops, not new `DIFFERS` rows.[^no-differs]

### Rows `E41` move to `SAME` — whichever plan lands second updates them

`markdown-source-mode-command-gaps` (not yet implemented) adds two `E41` rows to `DIFFERS` and a docs clause for the difference. This plan adds both `E41` rows to `SAME`. If that plan has landed, step 1 also deletes its two `DIFFERS` rows and step 7 its docs clause. If this plan lands first, the command-gaps plan must leave out its `E41` rows, its comment above them, its docs clause, and *One difference is pinned, not closed*; its `DIFFERS` count drops by two.

---

## Internal Structure

### `markdownSerializer.ts`

Replace `serializeHeading` ([:2289](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2289)) — doc comment kept as it is — and add `writtenHeadingContent` directly after it:

```ts
function serializeHeading(node: HeadingNode, definitions: Links | null): string {
    const level = Number(node.getTag().slice(1));
    const { content, setext } = writtenHeadingContent(node, definitions);

    if (setext) {
        return `${content}\n${level === 1 ? SETEXT_H1_UNDERLINE : SETEXT_H2_UNDERLINE}`;
    }

    return "#".repeat(level) + (content === "" ? "" : " " + content);
}

/**
 * The content {@link serializeHeading} writes for a heading, without its
 * `#`s or underline: the lines of its setext form, or the one line of its ATX
 * form, whose trailing `#` run has its first `#` escaped.
 *
 * @param node - The heading.
 * @param definitions - The saved document's link reference definitions, or `null`.
 * @returns The content, and whether it is written setext.
 */
function writtenHeadingContent(node: HeadingNode, definitions: Links | null): { content: string; setext: boolean } {
    const level = Number(node.getTag().slice(1));

    if (level <= SETEXT_MAX_LEVEL) {
        const lines = serializeInline(node, { ...MULTI_LINE, definitions });

        if (lines.includes("\n") && !lines.split("\n").some((line) => SETEXT_INTERRUPTING_LINE.test(line))) {
            return { content: lines, setext: true };
        }
    }

    const content = serializeInline(node, { ...HEADING_LINE, definitions }).replace(/(^|[ \t])(#+)$/, "$1\\$2");

    return { content, setext: false };
}
```

Replace `$serializeInlineNodes` ([:903–915](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L903)), doc comment included, with these two functions:

```ts
/**
 * Serializes a run of inline nodes as a save writes them, their lines kept —
 * the Markdown a raw block or code block holds for content it takes in from
 * another block. Must run inside an `editor.read` or `editor.update`.
 *
 * @param nodes - The inline nodes.
 * @returns Their Markdown, lines separated by `\n`.
 */
export function $serializeInlineNodes(nodes: LexicalNode[]): string {
    return serializeInlineNodes(nodes, { ...MULTI_LINE, definitions: $collectDefinitions() });
}

/**
 * Serializes a block's inline content as the block's own save writes it —
 * the Markdown a code block holds for a block converted to one. A heading's
 * content is written as the heading's save writes it, without its `#`s or
 * underline: an ATX heading's line, with no escape a paragraph's line start
 * needs (`+alpha`, not `\+alpha`) and its trailing `#` run escaped
 * (`alpha \#`), or the lines of its setext form. A paragraph's or quote's
 * content is its lines, a list item's text its lines with a task marker as
 * written. Must run inside an `editor.read` or `editor.update`.
 *
 * @param block - A paragraph, heading, quote or list item's text.
 * @returns Its content's Markdown, lines separated by `\n`.
 */
export function $serializeBlockContent(block: ElementNode): string {
    const definitions = $collectDefinitions();

    if ($isHeadingNode(block)) {
        return writtenHeadingContent(block, definitions).content;
    }

    return serializeInline(block, { ...MULTI_LINE, definitions, inListItem: $isMarkdownListItemTextNode(block) });
}
```

`ElementNode`, `$isHeadingNode` and `$isMarkdownListItemTextNode` are already imported in this module. The exported doc comment names no internal symbol, per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) (*Don't `{@link}` internal symbols from public JSDoc*).

### `MarkdownEditor.ts`

Import line ([:65](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L65)):

```ts
import { $serializeBlock, $serializeBlockContent, $serializeInlineNodes, $serializeMarkdown, $writtenListMarker } from "~/component/editor/markdownSerializer.js";
```

`$copyBlockAsCodeSource` ([:359–386](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L359)): replace the whole doc comment with this one, and the `markdown` line with the one after it. The rest of the function stays.

```ts
/**
 * `$setBlocksType`'s after-create hook for a conversion to a code block:
 * copies the block's format and indent, as the default hook does, and
 * replaces its inline content with that content's Markdown as the block's
 * own save writes it, so the code block shows — and saves — the source of
 * the formatting, links and images it cannot hold, and nothing is lost. A
 * heading's text is written as its own line holds it (`### +alpha` gives
 * `+alpha`, with none of the escapes a paragraph's line start needs). A
 * list item's text is written as an item's text is, so a task marker it
 * opens with goes into the code as it was written (`[ ] `). A raw block or
 * a code block already holds only its text and is left as it is.
 *
 * @param block - The block being converted; its children move into `code`.
 * @param code - The new code block.
 */
```

```ts
    const markdown = $serializeBlockContent(block);
```

`$isMarkdownListItemTextNode` stays imported: other functions in the file use it.

---

## Ordered Implementation Steps

1. **Parity rows — [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts).**
   - If `DIFFERS` holds `E41` rows (the command-gaps plan has landed), delete them and the two comment lines above them, which start `// A code block made from a heading holds the heading's text as each surface writes it`.
   - Append the block of `SAME` rows under *Test code* at the end of `SAME`, directly before its closing `];` (today after the second `Z1` row, [:1245](../packages/lib/tests/component/markdown-editor.test.ts#L1245)).
   - Check: `grep -c "\['E41'" packages/lib/tests/component/markdown-editor.test.ts` gives `2`, both inside `SAME`.

2. **WYSIWYG-only tests — the same file.**
   - Add `MarkdownBlockType` to the `import type { … } from '~/component/editor/MarkdownEditor'` list ([:6–8](../packages/lib/tests/component/markdown-editor.test.ts#L6)), first in the list.
   - Append the four tests under *Test code* after the last `it` of `describe('MarkdownEditor list toggles in a list of their kind')` (today `it('a list kept as a raw block leaves its item…')`, ending [:1474](../packages/lib/tests/component/markdown-editor.test.ts#L1474)).
   - Add the context-menu test under *Test code* directly after `it('the block-style submenu\'s Quote and Code block items reach setBlockType', …)` ([:4934](../packages/lib/tests/component/markdown-editor.test.ts#L4934)).

3. **Toolbar and typed-fence tests.**
   - [markdown-document-panel.test.ts](../packages/lib/tests/component/markdown-document-panel.test.ts): add the panel test under *Test code* as the last `it` of `describe('MarkdownDocumentPanel Insert dropdown')` ([:807](../packages/lib/tests/component/markdown-document-panel.test.ts#L807)).
   - [markdown-editor-typing-shortcuts.test.ts](../packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts): add `TY20` under *Test code* as the last `it` of `describe('a Markdown typing shortcut is applied by typing alone (TY rows)')` (after `TY19`, [:792](../packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts#L792)).

4. **See them fail.** Run `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-editor-typing-shortcuts.test.ts` from `packages/lib`. Exactly 23 tests fail: the 18 `SAME` rows `E41` (two) and `H1`–`H16`, the first three WYSIWYG-only tests, the context-menu test and the panel test. `H17`–`H22`, the inverse test and `TY20` pass.

5. **Serializer — [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts).** Make the two replacements under *Internal Structure*. Check: `grep -n "inListItem: boolean" packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` gives nothing.

6. **Editor — [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).** Change the import and `$copyBlockAsCodeSource` as under *Internal Structure*. Check: `grep -nF '$serializeInlineNodes(block' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` gives nothing. Run the three files of step 4: all pass.

7. **Docs — [MarkdownEditor.md](../packages/lib/docs/components/MarkdownEditor.md).**
   - On [line 82](../packages/lib/docs/components/MarkdownEditor.md#L82), after the sentence `Converting a block to a code block keeps its formatting, links and images as their Markdown in the code.` add, on the same line:

     > The code holds the block's text as the block's own Markdown writes it: a heading's text as its line holds it, so `### +alpha` gives a code block holding `+alpha` and `# alpha \#` one holding `alpha \#`, where a paragraph saved as `\+alpha` gives `\+alpha`.

   - If the command-gaps plan has landed, delete from the differences paragraph ([line 299](../packages/lib/docs/components/MarkdownEditor.md#L299) at the base) its clause that starts `a code block made from a heading holds the heading's text as each surface writes it` and ends ``source mode as the heading's own line holds it (`+a`, `a \#`);``.

8. **Changelog — [next.md](../packages/lib/docs/reference/changelog/next.md).** Append as the last bullet of `## Fixed` → `### Components` (before `### Core`):

   ```markdown
   - **`MarkdownEditor` no longer adds a backslash to a heading's text when
     the heading becomes a code block.** `setBlockType("code")`, and the
     toolbar's and context menu's *Code block*, wrote a heading's text with
     the escapes a paragraph needs at a line's start, so `### +alpha` gave a
     code block holding `\+alpha`. The code block now holds the text as the
     heading's own line holds it, `+alpha`, as source mode already did. A
     heading that ends in an escaped `#` (`# alpha \#`) now gives
     `alpha \#`, as in source mode, where it gave `alpha #`.
   ```

9. **Verification.** Run everything under `## Verification`.

### Test code

`SAME` rows (step 1):

````ts
        // A code block made from a heading holds the heading's text as the heading's own line holds it: none of the
        // escapes a paragraph's line needs at its start, and the escape of a last `#` run, which the line needs.
        ['E41', '### +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['E41', '# alpha \\#', 'alpha', null, 'code', '```\nalpha \\#\n```', '```\nalpha \\#\n```'],
        ['H1', '### #alpha', 'alpha', null, 'code', '```\n#alpha\n```', '```\n#alpha\n```'],
        ['H2', '### > alpha', 'alpha', null, 'code', '```\n> alpha\n```', '```\n> alpha\n```'],
        ['H3', '### - alpha', 'alpha', null, 'code', '```\n- alpha\n```', '```\n- alpha\n```'],
        ['H4', '### =alpha', 'alpha', null, 'code', '```\n=alpha\n```', '```\n=alpha\n```'],
        ['H5', '### |alpha', 'alpha', null, 'code', '```\n|alpha\n```', '```\n|alpha\n```'],
        ['H6', '### :alpha', 'alpha', null, 'code', '```\n:alpha\n```', '```\n:alpha\n```'],
        ['H7', '### 1. alpha', 'alpha', null, 'code', '```\n1. alpha\n```', '```\n1. alpha\n```'],
        ['H8', '### 1) alpha', 'alpha', null, 'code', '```\n1) alpha\n```', '```\n1) alpha\n```'],
        ['H9', '### <div> alpha', 'alpha', null, 'code', '```\n<div> alpha\n```', '```\n<div> alpha\n```'],
        ['H10', '# +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['H11', '## +alpha', 'alpha', null, 'code', '```\n+alpha\n```', '```\n+alpha\n```'],
        ['H12', '### alpha \\##', 'alpha', null, 'code', '```\nalpha \\##\n```', '```\nalpha \\##\n```'],
        ['H13', '## +**bold** alpha', 'alpha', null, 'code', '```\n+**bold** alpha\n```', '```\n+**bold** alpha\n```'],
        ['H14', '### *alpha* \\#', 'alpha', null, 'code', '```\n*alpha* \\#\n```', '```\n*alpha* \\#\n```'],
        ['H15', '### +[alpha](/u)', 'alpha', null, 'code', '```\n+[alpha](/u)\n```', '```\n+[alpha](/u)\n```'],
        ['H16', '::: columns\n### +one\n|||\nRight\n:::', 'one', null, 'code', '::: columns\n```\n+one\n```\n|||\nRight\n:::', '::: columns\n```\n+one\n```\n|||\nRight\n:::'],
        // An escape the block's own Markdown holds stays: an always-escaped character, a setext heading's lines, which
        // are a paragraph's lines, and a paragraph, a quote and a list item's text.
        ['H17', '### \\* alpha', 'alpha', null, 'code', '```\n\\* alpha\n```', '```\n\\* alpha\n```'],
        ['H18', '## **bold** +alpha', 'alpha', null, 'code', '```\n**bold** +alpha\n```', '```\n**bold** +alpha\n```'],
        ['H19', '\\+one\nmore\n---', 'one', null, 'code', '```\n\\+one\nmore\n```', '```\n\\+one\nmore\n```'],
        ['H20', '\\+alpha', 'alpha', null, 'code', '```\n\\+alpha\n```', '```\n\\+alpha\n```'],
        ['H21', '> \\+alpha', 'alpha', null, 'code', '```\n\\+alpha\n```', '```\n\\+alpha\n```'],
        ['H22', '- \\+alpha', 'alpha', null, 'code', '```\n\\+alpha\n```', '```\n\\+alpha\n```'],
````

WYSIWYG-only tests (step 2), after the last `it` of the describe:

````ts

    // A code block made from a block holds that block's text as the block's own Markdown writes it, on every route
    // `setBlockType("code")` takes. Source mode makes one code block of several blocks (row E5) and takes a block out
    // of its list item (row E12), so these two shapes are no parity rows.
    it('a code block made from each of several blocks holds each block\'s text as that block writes it', () => {
        const editor = editorOf('### +one\n\n\\+two');

        selectWords(editor, 'one', 'two');
        editor.setBlockType('code');

        const value = editor.getValue();

        expect(value).toBe('```\n+one\n```\n\n```\n\\+two\n```');
        expect(editorOf(value).getValue()).toBe(value);
        expect(editorSurfaceModel(editor)).toEqual(viewerModel(value).blocks);
    });

    it('a code block made from a heading a list item holds keeps the heading\'s text as its line holds it', () => {
        const editor = editorOf('- ### +one\n- two');

        selectWords(editor, 'one', 'one');
        editor.setBlockType('code');

        expect(editor.getValue()).toBe('- ```\n  +one\n  ```\n- two');
    });

    // A block made from a code block shows the code's text as it stands, so a heading made back from the code block
    // shows what the heading showed only where its line held no escape.
    it('a heading made back from a code block made from it shows the code block\'s text', () => {
        const cases: Array<[doc: string, back: MarkdownBlockType, code: string, after: string]> = [
            ['### +alpha', 'h3', '```\n+alpha\n```', '### +alpha'],
            ['# alpha \\#', 'h1', '```\nalpha \\#\n```', '# alpha \\\\#'],
        ];

        for (const [doc, back, code, after] of cases) {
            const editor = editorOf(doc);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType('code');

            expect(editor.getValue(), doc).toBe(code);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType(back);

            expect(editor.getValue(), doc).toBe(after);
        }
    });

    it('a block made from a code block shows the code\'s text as it stands, its save escaping what it must', () => {
        const cases: Array<[doc: string, type: MarkdownBlockType, after: string]> = [
            ['```\n\\+alpha\n```', 'paragraph', '\\\\+alpha'],
            ['```\n+alpha\n```', 'h3', '### +alpha'],
            ['```\n**b** alpha\n```', 'paragraph', '\\*\\*b\\*\\* alpha'],
        ];

        for (const [doc, type, after] of cases) {
            const editor = editorOf(doc);

            selectWords(editor, 'alpha', 'alpha');
            editor.setBlockType(type);

            expect(editor.getValue(), doc).toBe(after);
            expect(editorSurfaceModel(editor), doc).toEqual(viewerModel(after).blocks);
        }
    });
````

Context-menu test (step 2):

````ts

    it('the block-style submenu\'s Code block item makes a heading\'s text the code as the heading\'s line holds it', () => {
        const editor = new MarkdownEditor();
        editor.setValue('### +alpha');
        lexicalOf(editor).update(() => { $selectAll(); }, { discrete: true });

        const items = contextMenuMethodsOf(editor).buildContextMenuItems({
            kind: 'text', hasSelectedText: true, ...SOME_FORMATS, availability: ALL_AVAILABLE,
        });

        submenuItemsOf(findItem(items, 'Block style'))?.find((item) => item.text === 'Code block')?.action?.();

        expect(editor.getValue()).toBe('```\n+alpha\n```');
    });
````

Panel test (step 3):

````ts

    it('"Code block" makes a heading\'s text the code as the heading\'s line holds it', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('### +alpha');
        selectStart(panel.getEditor());
        findItem(resolveItems(findMenuButton(panel, 'Insert…').getMenuItems()), 'Code block').action!();

        expect(panel.getValue()).toBe('```\n+alpha\n```');
    });
````

`TY20` (step 3):

````ts

    // A code fence typed at the start of a heading's text moves that text into the code block as it shows: the block
    // takes in plain text as it is, as a code block takes in any text that joins it.
    it('TY20: a code fence typed at the start of a heading\'s text makes a code block holding the text the heading shows', () => {
        const editor = select('### \\`\\`\\` ;+alpha', 1, false);
        const typed = completingCharacter(editor);

        remove(editor, 'Delete', true);
        dispatch(editor, CONTROLLED_TEXT_INSERTION_COMMAND, typed, true);

        expect(settledValue(editor)).toBe('```\n+alpha\n```');

        editor.dispose();
    });
````

Every helper these tests call already exists in the scope they are added to: `editorOf`, `selectWords`, `editorSurfaceModel`, `viewerModel` in the list-toggle describe; `lexicalOf`, `$selectAll`, `contextMenuMethodsOf`, `SOME_FORMATS`, `ALL_AVAILABLE`, `submenuItemsOf`, `findItem` beside the Quote test; `selectStart`, `resolveItems`, `findMenuButton`, `findItem` in the panel test file; `select`, `completingCharacter`, `remove`, `dispatch`, `settledValue` and `CONTROLLED_TEXT_INSERTION_COMMAND` in the typing file.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-typing-shortcuts.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests (step 1–3 code). "Red" means the test fails before step 5 and passes after it; "green" means it passes before and after. `⏎` is a line end and `⏎⏎` a blank line; `\|` stands for `|`.

**Heading to code, `setBlockType("code")` with the caret in the heading — `SAME` rows.** Each row also checks that the document is in the standard form, that one undo restores it, that the result reloads unchanged, and that source mode gives the same code block.

| Row | Document | What it covers | Code block holds, both surfaces | WYSIWYG before | Test |
|---|---|---|---|---|---|
| `E41` | `### +alpha` | `+` | `+alpha` | `\+alpha` | red |
| `E41` | `# alpha \#` | a trailing `#` the line escapes | `alpha \#` | `alpha #` | red |
| `H1` | `### #alpha` | `#` | `#alpha` | `\#alpha` | red |
| `H2` | `### > alpha` | `>` | `> alpha` | `\> alpha` | red |
| `H3` | `### - alpha` | `-` | `- alpha` | `\- alpha` | red |
| `H4` | `### =alpha` | `=` | `=alpha` | `\=alpha` | red |
| `H5` | `### \|alpha` | `\|` | `\|alpha` | the same with a backslash before it | red |
| `H6` | `### :alpha` | `:` | `:alpha` | `\:alpha` | red |
| `H7` | `### 1. alpha` | an ordered-list number, `.` | `1. alpha` | `1\. alpha` | red |
| `H8` | `### 1) alpha` | an ordered-list number, `)` | `1) alpha` | `1\) alpha` | red |
| `H9` | `### <div> alpha` | an HTML block start | `<div> alpha` | `\<div> alpha` | red |
| `H10` | `# +alpha` | level 1, ATX | `+alpha` | `\+alpha` | red |
| `H11` | `## +alpha` | level 2, ATX | `+alpha` | `\+alpha` | red |
| `H12` | `### alpha \##` | a trailing run of two `#` | `alpha \##` | `alpha ##` | red |
| `H13` | `## +**bold** alpha` | formatting after the first character | `+**bold** alpha` | `\+**bold** alpha` | red |
| `H14` | `### *alpha* \#` | formatting and a trailing `#` | `*alpha* \#` | `*alpha* #` | red |
| `H15` | `### +[alpha](/u)` | a link | `+[alpha](/u)` | `\+[alpha](/u)` | red |
| `H16` | `::: columns ⏎ ### +one ⏎ \|\|\| ⏎ Right ⏎ :::` | a heading in a `:::` column | `+one`, in the column | `\+one` | red |
| `H17` | `### \* alpha` | `*` is escaped anywhere in text, as `~` and `` ` `` are | `\* alpha` | the same | green |
| `H18` | `## **bold** +alpha` | formatting first | `**bold** +alpha` | the same | green |
| `H19` | `\+one ⏎ more ⏎ ---` | a setext heading: its lines are a paragraph's | `\+one ⏎ more` | the same | green |
| `H20` | `\+alpha` | a paragraph | `\+alpha` | the same | green |
| `H21` | `> \+alpha` | a quote | `\+alpha` | the same | green |
| `H22` | `- \+alpha` | a list item's text | `\+alpha` | the same | green |

**Other routes and shapes — WYSIWYG only.**

| Case | Document, action | Result | Test |
|---|---|---|---|
| Several blocks | `### +one ⏎⏎ \+two`, selection `one` to `two` | two code blocks, holding `+one` and `\+two` (`` ```⏎+one⏎```⏎⏎```⏎\+two⏎``` ``); reloads unchanged | red |
| Heading in a list item | `- ### +one ⏎ - two`, caret in `one` | `` - ```⏎  +one⏎  ```⏎- two `` | red |
| Context menu | `### +alpha`, all selected, *Block style ▸ Code block* | `` ```⏎+alpha⏎``` `` | red |
| Toolbar | `MarkdownDocumentPanel`, `### +alpha`, caret at the start, *Insert… ▸ Code block* | `` ```⏎+alpha⏎``` `` | red |
| Typed fence (`TY20`) | `` ### \`\`\` ;+alpha ``, the `;` and the space before it deleted, a space typed after `` ``` `` | `` ```⏎+alpha⏎``` `` | green |

**Back from a code block — WYSIWYG only.**

| Case | Document, action | Result | Test |
|---|---|---|---|
| Round trip, no escape | `### +alpha` → code → `h3` | code `+alpha`, then `### +alpha` | red |
| Round trip, the heading's own escape | `# alpha \#` → code → `h1` | code `alpha \#`, then `# alpha \\#`, a heading showing `alpha \#` | red (the code half) |
| Code to paragraph | code `\+alpha` → `paragraph` | `\\+alpha`, a paragraph showing `\+alpha` | green |
| Code to heading | code `+alpha` → `h3` | `### +alpha` | green |
| Code with Markdown syntax | code `**b** alpha` → `paragraph` | `\*\*b\*\* alpha`, a paragraph showing `**b** alpha` | green |

**Manual.** In the library demo (`npm run dev` in `packages/lib`, section *MD Editor*): type a heading `### +alpha`, then (a) choose *Insert… ▸ Code block* in the toolbar, (b) undo, right-click the heading and choose *Block style ▸ Code block*, (c) undo, put the caret at the heading's text start and type ` ``` ` and a space. Each gives a code block showing `+alpha`; switching to source mode shows `` ```⏎+alpha⏎``` ``. The typed route needs a real keyboard, which the unit test only stands in for.

---

## Verification

From `packages/lib`, with `free -g` checked first and at most two vitest runs at a time:

- `npm run typecheck` and `npm run typecheck:test`.
- `npm run lint`.
- `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-editor-typing-shortcuts.test.ts` — all of `## Expected Behaviour` passes.
- `npx vitest run --maxWorkers=4 tests/component/markdown tests/component/display` — the serializer, round-trip, source-preservation and importer suites stay green; they are what pins `serializeHeading`'s output, which step 5 must leave unchanged. On the prototype these 47 files ran 10,147 tests, all green.
- `grep -rnF '$serializeInlineNodes(' packages/lib/src` — the definition and the one call in `$inlineMarkdown`, each with one parameter or argument.
- `npm run docs:api`.
- The manual check under `## Expected Behaviour`.

---

## Potential Challenges

- **`markdown-editor-large-document-costs` deletes `$collectDefinitions`.** If that plan has landed, `$serializeBlockContent` reads its definitions as that plan's `$serializeBlock` row does: `const definitions = $definitionsReader(true)([block]);`. Its row for `$serializeInlineNodes` edits only the `definitions:` value, which this plan leaves as it is.
- **The command-gaps plan may land in between.** Steps 1 and 7 say what to remove when its `E41` rows and docs clause exist; check for them when starting, not from this plan's base.
- **Backslashes in the test strings.** The rows hold Markdown inside TypeScript strings: `'# alpha \\#'` is the four-character tail ` \#`, and `'# alpha \\\\#'` is ` \\#`. Copy the rows as given.
- **The heading refactor must not change a save.** `serializeHeading` keeps every branch it had; only where the content is computed moves. The full markdown suites in `## Verification` are the check.

---

## Critical Files

- [MarkdownEditor.ts:372](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L372) — `$copyBlockAsCodeSource`, the hook that changes; [:7771](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L7771) `setBlockType`, which passes it to `$setBlocksType`.
- [markdownSerializer.ts:2289](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2289) — `serializeHeading`; [:1087](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1087) `headingContext`; [:1006](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1006) `$readStandardForm` and [:1061](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1061) `inlineRuns`, the precedent for choosing a heading's own context; [:899](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L899) `$serializeBlock`, the precedent for the export; [:268](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L268) `LINE_START_ESCAPED` and [:5721](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L5721) `escapeLineStart`, where the stray escape came from.
- [MarkdownEditor.ts:2939](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2939) — `$keepTextOnly`, the rule the typed fence follows.
- [markdownSourceLines.ts:1151](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1151) — `FENCED_CODE_SOURCE`, and [:526](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L526) `blockTextLines`: source mode's code text, the target the WYSIWYG side now matches.
- [markdown-editor.test.ts:1091–1111](../packages/lib/tests/component/markdown-editor.test.ts#L1091) — `wysiwygAfter` / `sourceAfter`, and [:1414–1456](../packages/lib/tests/component/markdown-editor.test.ts#L1414) the `SAME` / `DIFFERS` loops the new rows run through.
- [markdown-source-mode-command-gaps.md](markdown-source-mode-command-gaps.md) — *One difference is pinned, not closed* and sign-off 8.

---

## Non-Goals

- **Source mode.** It already gives the agreed result; nothing in `markdownSourceLines.ts` changes.
- **Documents not in the editor's standard form.** A block loaded as written and saved unchanged (`### [ ] alpha`, whose standard form is `### \[ \] alpha`) still gives a code block holding its standard form, `\[ \] alpha`, where source mode takes the bytes, `[ ] alpha`.[^kept-source]
- **The reverse conversion.** A block made from a code block keeps showing the code's text as it stands; source mode reads that text as Markdown instead. Which is right is a separate question.[^inverse]
- **The typed fence's rule.** It keeps taking plain text in as it shows and writing only formatting as Markdown, as joins and pastes into a code block do.[^typed-fence]
- **Rows `E5` and `E12`.** One code block per block, and a heading converted inside its list item, stay WYSIWYG behaviour; this plan changes only the text each code block holds.

---

## Notes

[^measured]: The prototype was the two modules with exactly the code under *Internal Structure*, swapped in for the real ones by a Vitest `resolveId` plugin (`scratch-keep/plans4/heading-code-escapes/vitest.proto.config.ts`, modules in `proto/`). The test code under *Test code* was run against the base and against the prototype: 23 failures on the base, as step 4 lists, and none on the prototype. `tsc` on `tsconfig.json` and `tsconfig.test.json`, and `eslint` on the two modules, reported nothing with the prototype in place.

[^rule]: Source mode's `FENCED_CODE_SOURCE` takes each block's text from the viewer's token (`blockTextLines`): a heading's text without its `#`s or closing sequence, a paragraph's lines without quote or list prefixes. For a document in the standard form, those bytes are what the block's save wrote, so "the block's own save" and "what source mode takes" give the same text. `$copyBlockAsCodeSource` already followed this rule for every block but the heading: it wrote all content in `MULTI_LINE`, the context of a paragraph, quote and list item. The probe found 15 heading shapes with a different result on the two surfaces before the change and none after; every non-heading shape it tried already agreed (`probe2.base.log`, `probe2.proto.log` in the scratch folder).

[^row-two]: The task as given asked that "a code block made from any block holds the text that block showed" and that both `E41` rows move to `SAME`. For `# alpha \#` these two asks disagree: the heading shows `alpha #`, and source mode, which the owner chose as right, gives `alpha \#`. This plan follows the owner's decision. Two other rules were weighed and rejected. *Write the text as it shows* (`alpha #`, and `+alpha` for the paragraph `\+alpha`) would leave row two in `DIFFERS`, open a new difference for every paragraph whose save holds an escape, and give code that, made a heading again in source mode, reads as `alpha` with its `#` lost. *Use the heading's context but skip the trailing-`#` escape* would give code that is neither the text shown nor the heading's Markdown. If the owner wants row two the other way, that is a change to source mode, not to this plan.

[^one-place]: `headingContext(node)` with the closing-`#` replace added would give the same text, but it would copy `serializeHeading`'s rule into a second place, and `headingContext` serializes without the document's definitions where `serializeHeading` passes them. Splitting `serializeHeading` keeps one function deciding what a heading's content is, for both the save and the code block.

[^typed-fence]: Measured on the base: typing ` ``` ` and a space at the start of `### +alpha`'s text gives a code block holding `+alpha`; of `## **bold** +x`, `**bold** +x`; of `# alpha \#`, `alpha #`. Lexical's `CODE` transformer (`@lexical/markdown` 0.49.0, `createBlockNode`) appends the heading's children to the new code node, and `$keepTextOnly` replaces only runs that are not plain text with their Markdown, as it does for a paragraph joined into a code block by Backspace or a paste. So this route never adds an escape. It differs from `setBlockType("code")` on the last shape (`alpha #` against `alpha \#`) and on any paragraph whose save holds an escape (`\+alpha` typed after a fence gives `+alpha`). Source mode has no counterpart to compare with: there, ` ``` ` typed before a heading's text leaves a heading. Changing the rule would touch joins and pastes too, and is not part of this defect.

[^inverse]: Measured on the base and the prototype alike. The WYSIWYG surface: code `\+alpha` made a paragraph saves `\\+alpha` and shows `\+alpha`; code `**b** alpha` saves `\*\*b\*\* alpha` and shows `**b** alpha`; code `alpha \#` made `h1` saves `# alpha \\#` and shows `alpha \#`. Source mode, with the fences selected whole: the same three give `\+alpha` (showing `+alpha`), `**b** alpha` (bold `b`) and `# alpha \#` (showing `alpha #`). So the WYSIWYG surface keeps the code's characters and source mode reads them as Markdown. That is a difference about formatting as much as escapes (`**b**` becomes bold in source mode only), no parity row pins it, and the docs do not list it. Before this plan, `# alpha \#` survived a WYSIWYG round trip through a code block because the code held `alpha #`; after it, the code holds `alpha \#` and the heading made back from it shows that. `\+alpha` as a paragraph already behaved this way.

[^no-differs]: `DIFFERS` rows are counted and owned row by row in the command-gaps plan's table *Every row that remains in `DIFFERS`*. Two new rows there for shapes whose difference is already `E5`'s and `E12`'s would change that plan's counts for no new information; a WYSIWYG-only test pins the code text, which is all this plan changes.

[^kept-source]: The save writes an unedited top-level block as its source (`MarkdownSourceMap`), but a block's content is written in the standard form wherever it is serialized on its own, and the parity table only holds documents in the standard form (`canonicalSave(loaded)` must equal the document). Measured: `### [ ] alpha` loaded as written gives `\[ \] alpha` on the WYSIWYG surface, before and after this change, and `[ ] alpha` in source mode. Taking the code text from the source map would work only for a top-level block that is still unedited, would need the block's source parsed for its text, and is a different defect from the stray escapes this plan fixes.
