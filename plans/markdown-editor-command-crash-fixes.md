---
depends-on: [markdown-viewer-block-fixes]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/package.json
  - package-lock.json
---

# MarkdownEditor Command Crash Fixes — Implementation Plan

## Overview

A fuzz pass found four `MarkdownEditor` command defects. All four reproduce on
`master` and on the tip of the unmerged Markdown stack. This plan is written
against that stack tip, `feature/markdown-viewer-block-fixes` at `8ac3a61a`.
Line numbers below are from that commit; the stack is still moving, so find
each site by its symbol name first.

| # | Defect | Where the fault is | Fix |
|---|---|---|---|
| 1 | `setBlockAlignment` / `setColumnCount` throw (or wrap the wrong block) when the selection reaches into a table cell or a `:::` column | our code: [`$wrapSelectedTopLevelBlocks`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L427) | resolve each selected node to its child of the root |
| 2 | `toggleLink(null)` throws when a selection end only touches a link's edge | Lexical: `@lexical/link`'s `$splitLinkAtSelection` | move such an end just outside the link before calling `$toggleLink` |
| 3 | removing a cross-block range throws `$getTextNodeOffset: invalid offset` | Lexical: `RangeSelection.removeText` | remove that range shape through a guarded path, at every place a range is removed |
| 4 | deleting a range across table cells leaves a ragged table | not reachable in a browser or through the public API | no code change; manual check only |

Everything lives in
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts).
Defect 3 also adds `@lexical/clipboard` as a direct dependency. The tests go in
a new file, and the changelog gets three *Fixed* entries.

---

## Architecture Decisions

### Defect 1 — index by the root's child, not by `getTopLevelElement()`

`$wrapSelectedTopLevelBlocks` ([MarkdownEditor.ts:436](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L436))
calls `node.getTopLevelElementOrThrow().getIndexWithinParent()` and uses the
result as an index into `$getRoot().getChildren()`. Lexical's
`getTopLevelElement()` stops at a *shadow root*: an element Lexical treats as
the top of its own little document. `TableCellNode` and our
`MarkdownColumnNode` ([markdownBlockNode.ts:76](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts#L76))
are both shadow roots. For a node inside one, the returned index counts
siblings inside the cell or column, not children of the root.[^d1-trace]

| Document | Selection | Today | After |
|---|---|---|---|
| `a\|\|\n-\|-` | `a` to the second (empty) cell | throws: second cell is index 1 in its row, root has 1 child | the table is wrapped |
| `p\n\n\|a\|b\|\n\|-\|-\|\n\|1\|2\|` | caret in `b` | wraps `p` (index 0 inside the cell) | the table is wrapped |
| `p\n\n::: columns\nA\n\nA2\n\nA3\n\|\|\|\nB\n:::` | `p` to `A3` | throws: `A3` is index 2 in its column | `p` and the fence are wrapped |

The fix is a helper `$getRootChild(node)` built on `$findMatchingParent`, the
same Lexical helper the file already uses for every ancestor search (for
example `$findEnclosingLinkNode`, [MarkdownEditor.ts:375](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L375)).
A selection that starts outside a fence and reaches into it now wraps the whole
fence in a new one. Fences nest in the dialect, so this is valid
output.[^nesting]

### Defect 2 — move a link-edge end outside the link before `$toggleLink(null)`

`$toggleLink(null)` on a range calls `selection.extract()`. When a selection
end sits exactly on a link's edge with none of the link's text selected,
`extract()` returns the `LinkNode` but none of its children.
`$splitLinkAtSelection` assumes at least one child was extracted and calls
`insertAfter` on `undefined`.[^d2-upstream] The selection's direction does not
matter. Only the edge does:

| Document `a [b](u) c`, selection | Link text selected | Today | After |
|---|---|---|---|
| `a ␣`@0 → `b`@0 (ends at the link's start) | none | throws | unchanged `a [b](u) c` |
| ` c`@1 → `b`@1, backward (starts at the link's end) | none | throws | unchanged `a [b](u) c` |
| `a ␣`@0 → `b`@1 | all | `a b c` | `a b c` (unchanged behaviour) |

`toggleLink` gets one extra step for `url === null`:
`$moveRangeEdgesOutOfLinks(selection)` moves such an end point onto the
equivalent position just outside the link, as an element point on the link's
parent. The step does nothing to a collapsed selection, which `$toggleLink`
already handles in its own branch. The precedent is `removeLink`
([MarkdownEditor.ts:2007](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2007)).
It also reshapes the selection before `$toggleLink(null)` and keeps a comment
naming the Lexical behaviour it works around.

### Defect 3 — remove the faulty range shape ourselves, wherever a range is removed

Lexical's `RangeSelection.removeText()` throws on one range shape. In this plan
it is called a **stale-focus range**:

- the selection is not collapsed;
- its end point, in document order, is a text point strictly inside its text
  node (`0 < offset < size`);
- its start and end points lie in different blocks.

Lexical slices the text off the end node but leaves the selection's end offset
unchanged. When it then moves the end block's children into the start block, it
reads that stale offset and throws.[^d3-mechanism] This is an upstream bug. It
reproduces with plain `createEditor()` and still reproduces on Lexical 0.52.0,
the latest release.[^d3-upstream]

It only throws when the stale offset is past the end of the remaining text. The
guard still covers the whole shape, because the shape is cheap to test and
every range in it is handled correctly by the guarded path:

| Range (start → end) | Throws in Lexical 0.49 |
|---|---|
| `ab ␣`@0 → `efgh ␣`@3 in `ab **cd**\n\nefgh **ij** kl` | yes (3 > `"h "`.length 2) |
| `ab ␣`@1 → `efgh ␣`@3 in the same document | no (start block keeps `a`) |
| `ab ␣`@1 → ` ef`@2 in `ab **cd** ef` | no (one block: not a stale-focus range) |

The guard, `$removeStaleFocusRange(selection)`, first splits the end text node
at the end offset. It then puts the end point at offset 0 of the right-hand
half and calls `removeText()`. With the end at offset 0 nothing can go stale,
and the result is the removal Lexical meant to make.[^d3-split] The split has to
happen in the same Lexical update as the removal. At the end of every update,
Lexical merges adjacent text nodes that share a format, so a split made in an
earlier update is gone by the time a later update removes the range.[^d3-merge]

Every route that removes a range checks for the shape and runs the guard first:

| Route | Where it is guarded |
|---|---|
| `cut()`, `paste()`, `insertImage()` (our own calls to `removeText` / `insertRawText` / `insertNodes`) | at the call site, via `$removeRangeIfStaleFocus(selection)` |
| Backspace/Delete, word and line delete, drag-delete (`DELETE_CHARACTER`, `DELETE_WORD`, `DELETE_LINE`, `REMOVE_TEXT`) | `COMMAND_PRIORITY_CRITICAL` listener `$deleteStaleFocusRange`. It removes the range and returns `true`, because removing the range is the whole effect of these commands on a range |
| Enter, Shift+Enter, Tab (`INSERT_PARAGRAPH`, `INSERT_LINE_BREAK`, `INSERT_TAB`) | CRITICAL listener `$clearStaleFocusRangeBeforeInsert`. It removes the range and returns `false`, so Lexical inserts at the now-collapsed caret |
| Typing over the range (`CONTROLLED_TEXT_INSERTION`) | CRITICAL listener `$clearStaleFocusRangeBeforeTyping`. Like the line above, but it first copies the start text node's format and style onto the selection, as Lexical's own `insertText` does |
| Paste and drop of clipboard nodes (`SELECTION_INSERT_CLIPBOARD_NODES`) | CRITICAL listener `$clearStaleFocusRangeBeforePaste`. It acts on `payload.selection`, which is the selection Lexical will insert into |
| Native Ctrl/Cmd+X (`CUT_COMMAND`) | CRITICAL listener `$cutStaleFocusRange`. It mirrors `@lexical/rich-text`'s cut: `copyToClipboard`, then one update tagged `CUT_TAG` that runs the guard and `removeText()`. It returns `true` |

Each listener does nothing and returns `false` when the selection is not a
stale-focus range, so every other edit keeps Lexical's own behaviour. The
listeners do the removal themselves, inside their own update, so they are safe
however Lexical dispatches the command.[^d3-dispatch] The precedent for
registering a module-level `$`-function as a command listener is
`ensureEditor`'s `KEY_ENTER_COMMAND` / `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND`
registrations ([MarkdownEditor.ts:2785–2787](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2785)).

`$readSelectionState` is left unchanged. It throws only because an earlier
update threw partway through and its half-applied state was committed. Making
it tolerate that state would hide a corrupted document.[^d3-readstate]

The guard is documented as an upstream workaround in its JSDoc. Two *canary*
tests reproduce each upstream bug with plain Lexical; a canary is a test that
asserts the bug is still there. When a Lexical upgrade makes a canary fail, the
matching guard can be removed.[^canary]

### Defect 4 — no code change; it is not reachable

A `RangeSelection` with points in two different cells of one table cannot be
made through the browser or the public API.[^d4-reach] Lexical's table selection
observer is registered when the editor mounts, in `mountWysiwyg`. On every
selection change it turns a range between two cells of one table into a
`TableSelection`. Deleting that clears the cells and keeps the table's shape. A
range that crosses a table's edge is widened to cover the whole table. No
`MarkdownEditor` method builds a range across cells. The fuzz built one by
setting the private Lexical selection directly.

The serializer writing only header-width cells is GFM behaviour: GFM ignores
extra body cells. It stays.

---

## Internal Structure

All new functions are module-level, private and documented with JSDoc. Lexical
types (`PointType`, `RangeSelection`, `CommandPayloadType`) are type-only
imports from `"lexical"`.

```typescript
// Defect 1
function $getRootChild(node: LexicalNode): LexicalNode | null {
    return $findMatchingParent(node, (candidate) => $isRootNode(candidate.getParent()));
}

// Defect 2
function $isAtLinkStart(point: PointType, link: LinkNode): boolean;   // see rules below
function $isAtLinkEnd(point: PointType, link: LinkNode): boolean;
function $moveRangeEdgesOutOfLinks(selection: RangeSelection): void;

// Defect 3
function $isStaleFocusRange(selection: BaseSelection | null): selection is RangeSelection;
function $removeStaleFocusRange(selection: RangeSelection): void;    // split end + removeText
function $removeRangeIfStaleFocus(selection: RangeSelection): void;  // if ($isStaleFocusRange(selection)) $removeStaleFocusRange(selection)
function $deleteStaleFocusRange(): boolean;
function $clearStaleFocusRangeBeforeInsert(): boolean;
function $clearStaleFocusRangeBeforeTyping(): boolean;
function $clearStaleFocusRangeBeforePaste(
    payload: CommandPayloadType<typeof SELECTION_INSERT_CLIPBOARD_NODES_COMMAND>,
): boolean;
function $cutStaleFocusRange(event: CommandPayloadType<typeof CUT_COMMAND>, editor: LexicalEditor): boolean;
```

**Link-edge rules (defect 2).** A point is *at a link's start* when no text of
the link lies before it. A point is *at its end* when no text lies after it.
Both a text point and an element point can be at an edge. Lexical's
`$toggleLink(null)` throws for both forms.

| Point | At start of `link` | At end of `link` |
|---|---|---|
| text point on `link.getFirstDescendant()`, offset 0 | yes | — |
| text point on `link.getLastDescendant()`, offset = its text size | — | yes |
| element point on `link` itself, offset 0 | yes | — |
| element point on `link` itself, offset = `link.getChildrenSize()` | — | yes |
| any other point | no | no |

`$moveRangeEdgesOutOfLinks`:

1. Return when the selection is collapsed.
2. Take `[start, end]` in document order: `selection.isBackward() ? [focus, anchor] : [anchor, focus]`.
3. If `start` is inside a link (`$findEnclosingLinkNode(start.getNode())`) and
   at that link's end, set
   `start.set(link.getParentOrThrow().getKey(), link.getIndexWithinParent() + 1, "element")`.
4. If `end` is inside a link and at that link's start, set
   `end.set(link.getParentOrThrow().getKey(), link.getIndexWithinParent(), "element")`.

**Stale-focus guard (defect 3).**

```typescript
function $isStaleFocusRange(selection: BaseSelection | null): selection is RangeSelection {
    if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        return false;
    }

    const [start, end] = selection.isBackward()
        ? [selection.focus, selection.anchor]
        : [selection.anchor, selection.focus];
    const endNode = end.getNode();

    return $isTextNode(endNode)
        && end.offset > 0 && end.offset < endNode.getTextContentSize()
        && $findEnclosingBlock(start.getNode()) !== $findEnclosingBlock(endNode);
}

function $removeStaleFocusRange(selection: RangeSelection): void {
    const end = selection.isBackward() ? selection.anchor : selection.focus;
    const [, rest] = (end.getNode() as TextNode).splitText(end.offset);

    end.set(rest!.getKey(), 0, "text");
    selection.removeText();
}

function $cutStaleFocusRange(event: CommandPayloadType<typeof CUT_COMMAND>, editor: LexicalEditor): boolean {
    if (!$isStaleFocusRange($getSelection())) {
        return false;
    }

    // `copyToClipboard` takes only a ClipboardEvent; Lexical also dispatches
    // CUT_COMMAND with a KeyboardEvent. `"clipboardData" in event` tells them
    // apart without naming a DOM global.
    const clipboardEvent = event !== null && "clipboardData" in event ? event : null;

    void copyToClipboard(editor, clipboardEvent).then(() => {
        editor.update(() => {
            const selection = $getSelection();

            if ($isRangeSelection(selection)) {
                $removeRangeIfStaleFocus(selection);
                selection.removeText();
            }
        }, { tag: CUT_TAG });
    });

    return true;
}
```

`$findEnclosingBlock(node)` is
`$findMatchingParent(node, (n) => $isElementNode(n) && !n.isInline())`. That is
the same block test `$classifyContextMenuTarget` uses
([MarkdownEditor.ts:974](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L974)).
Add it as a small named helper and leave `$classifyContextMenuTarget` as it is.

`$clearStaleFocusRangeBeforeTyping` reads the start point's node before the
removal. When that node is a text node, it saves `getFormat()` / `getStyle()`.
After `$removeStaleFocusRange`, it sets `selection.format` and
`selection.style` to the saved values. This copies what
`RangeSelection.insertText` does for a non-collapsed range, so typing over a
range that starts in bold text still types bold.

---

## Ordered Implementation Steps

Work in the plan's own worktree, rebased onto the stack's final tip. Run every
command from `packages/lib` unless noted.

1. **Write the failing tests.** Create
   `packages/lib/tests/component/markdown-editor-command-crashes.test.ts`.
   Copy the header pattern of `markdown-reference-links.test.ts`: `CONFIG`,
   `installTestDOM` / `DOM.reset`, and `lexicalOf`. Add at the top of the file,
   before the other imports:
   ```typescript
   vi.mock('@lexical/clipboard', async (importOriginal) => ({
       ...(await importOriginal<typeof import('@lexical/clipboard')>()),
       copyToClipboard: vi.fn(async () => true),
   }));
   ```
   The `ElkLayoutEngine.test.ts` `vi.mock` is the precedent. Add a helper
   `selectText(editor, [anchorText, anchorOffset], [focusText, focusOffset])`.
   It finds each text node by its exact text content and sets a
   `$createRangeSelection` inside `lexicalOf(editor).update(…, { discrete: true })`.
   Write one `it` per row of *Expected Behaviour* (B, L, R and U rows).
   Check: `npx vitest run tests/component/markdown-editor-command-crashes.test.ts`.
   Every B1–B4, L1–L4 and R1–R9 row fails; B5, L5, L6, R10–R12, U1 and U2 pass.
2. **Defect 1.** In `MarkdownEditor.ts`, add `$isRootNode` to the `"lexical"`
   value import. Add `$getRootChild` (JSDoc: unlike Lexical's
   `getTopLevelElement()`, it does not stop at a table cell or a `:::` column).
   In `$wrapSelectedTopLevelBlocks`'s loop, replace
   `node.getTopLevelElementOrThrow().getIndexWithinParent()` with
   `$getRootChild(node)`. `continue` when it is `null`, otherwise use its
   `getIndexWithinParent()`. Extend that function's JSDoc: a selection inside a
   table cell or a `:::` column counts as its whole enclosing child of the root.
   Check: `grep -n getTopLevelElementOrThrow src/typescript/lib/component/editor/MarkdownEditor.ts`
   returns no matches. The B rows pass.
3. **Defect 2.** Add `$isAtLinkStart`, `$isAtLinkEnd` and
   `$moveRangeEdgesOutOfLinks` next to `$findEnclosingLinkNode`. In `toggleLink`
   ([MarkdownEditor.ts:1956](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1956)),
   turn the `if (url !== null)` block into an `if / else`. The `else` branch
   calls `$moveRangeEdgesOutOfLinks(selection)` and carries a comment naming
   `$splitLinkAtSelection`'s fault. Add type imports `PointType`,
   `RangeSelection`. Check: the L rows pass.
4. **Defect 3 — dependency.** In `packages/lib/package.json` `dependencies`, add
   `"@lexical/clipboard": "^0.49.0"`, sorted before `"@lexical/code"`. Use the
   same version range as the other `@lexical/*` entries at that point, in case
   the stack bumped them. Run `npm install` at the repo root. Check:
   `git diff --stat` shows only `packages/lib/package.json` and
   `package-lock.json`. `npm ls @lexical/clipboard` shows one version.
5. **Defect 3 — guard functions.** Add `$findEnclosingBlock`,
   `$isStaleFocusRange`, `$removeStaleFocusRange`, `$removeRangeIfStaleFocus`
   and the five listeners from *Internal Structure*. Put them directly after
   `$pasteIntoRawBlock`. Add to the `"lexical"` import: `DELETE_CHARACTER_COMMAND`,
   `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND`, `REMOVE_TEXT_COMMAND`,
   `CONTROLLED_TEXT_INSERTION_COMMAND`, `INSERT_PARAGRAPH_COMMAND`,
   `INSERT_LINE_BREAK_COMMAND`, `INSERT_TAB_COMMAND`, `CUT_COMMAND`, `CUT_TAG`,
   `COMMAND_PRIORITY_CRITICAL`, plus type `CommandPayloadType`. Add
   `import { copyToClipboard } from "@lexical/clipboard";`. Write the
   upstream-bug JSDoc on `$isStaleFocusRange`: the shape, *Lexical 0.49.0–0.52.0*,
   and "remove when the canary in `markdown-editor-command-crashes.test.ts`
   fails".
6. **Defect 3 — our own call sites.** Call `$removeRangeIfStaleFocus(selection)`
   directly before each of: `selection.removeText()` in `cut()`
   ([:2129](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2129)),
   `selection.insertRawText(text)` in `paste()`
   ([:2165](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2165)),
   and `selection.insertNodes(…)` in `insertImage()`
   ([:2409](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2409)).
   Leave `$pasteIntoRawBlock`'s `insertRawText` alone. The paste listener runs
   before it.
7. **Defect 3 — listener registration.** In `ensureEditor`'s `mergeRegister`
   ([:2779](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2779)),
   after the `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` line and before
   `registerUpdateListener`, add one `editor.registerCommand(…, COMMAND_PRIORITY_CRITICAL)`
   per row:

   | Command | Listener |
   |---|---|
   | `DELETE_CHARACTER_COMMAND`, `DELETE_WORD_COMMAND`, `DELETE_LINE_COMMAND`, `REMOVE_TEXT_COMMAND` | `$deleteStaleFocusRange` |
   | `INSERT_PARAGRAPH_COMMAND`, `INSERT_LINE_BREAK_COMMAND`, `INSERT_TAB_COMMAND` | `$clearStaleFocusRangeBeforeInsert` |
   | `CONTROLLED_TEXT_INSERTION_COMMAND` | `$clearStaleFocusRangeBeforeTyping` |
   | `SELECTION_INSERT_CLIPBOARD_NODES_COMMAND` | `$clearStaleFocusRangeBeforePaste` |
   | `CUT_COMMAND` | `$cutStaleFocusRange` |

   Check: the R rows pass.
8. **Changelog.** Add the three entries from *Documentation Impact* to
   `packages/lib/docs/reference/changelog/next.md` → `## Fixed` → `### Components`,
   after the existing `MarkdownEditor` / `Markdown` entries.
9. **Full verification.** Run everything in *Verification*, then the manual
   checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/markdown-editor-command-crashes.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/package.json` |
| Modify | `package-lock.json` (via `npm install`) |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests in the new file unless marked manual. `getValue()`
strings are exact; the outputs were checked against a prototype of this plan.
"Today" is the behaviour on the stack tip.

### Defect 1 — `$wrapSelectedTopLevelBlocks`

| # | Document | Selection | Call | Expected `getValue()` | Today |
|---|---|---|---|---|---|
| B1 | `a\|\|\n-\|-` | anchor text `a`@0, focus = element point (second cell's paragraph, 0)[^b1-setup] | `setBlockAlignment('center')` | `::: {align=center}\n\| a \|  \|\n\| --- \| --- \|\n:::` | throws |
| B2 | same as B1 | same | `setColumnCount(2)` | `::: columns\n\| a \|  \|\n\| --- \| --- \|\n\|\|\|\n\n:::` | throws |
| B3 | `p\n\n\|a\|b\|\n\|-\|-\|\n\|1\|2\|` | collapsed, `b`@0 | `setBlockAlignment('center')` | `p\n\n::: {align=center}\n\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|\n:::` | wraps `p` |
| B4 | `p\n\n::: columns\nA\n\nA2\n\nA3\n\|\|\|\nB\n:::` | `p`@0 → `A3`@1 | `setBlockAlignment('center')` | `::: {align=center}\np\n\n::: columns\nA\n\nA2\n\nA3\n\|\|\|\nB\n:::\n:::` | throws |
| B5 | `::: columns\nA\n\|\|\|\nB\n:::` | `A`@0 → `B`@1 | `setBlockAlignment('center')` | `::: columns {align=center}\nA\n\|\|\|\nB\n:::` | same |

Also assert for B4 that the root holds exactly one `markdown-block`.

### Defect 2 — `toggleLink(null)`

| # | Document | Selection (anchor → focus) | Expected `getValue()` | Today |
|---|---|---|---|---|
| L1 | `a [b](u) c` | `a ␣`@0 → `b`@0 | `a [b](u) c` | throws |
| L2 | `a [b](u) c` | ` c`@1 → `b`@1 (backward) | `a [b](u) c` | throws |
| L3 | `x\n\n[b](u) c` | `x`@0 → `b`@0 | `x\n\n[b](u) c` | throws |
| L4 | `[a](u) x [b](v)` | `a`@1 → `b`@0 (touches two links) | `[a](u) x [b](v)` | throws |
| L5 | `a [b](u) c` | `a ␣`@0 → `b`@1 | `a b c` | same |
| L6 | `[ab](u) x [cd](v)` | `ab`@1 → `cd`@1 | `[a](u)b x c[d](v)` | same |

In the table, `␣` stands for a trailing space in the text node (`"a "`).

### Defect 3 — stale-focus ranges

Document `D = 'ab **cd**\n\nefgh **ij** kl'`. Its text nodes are `"ab "`,
`"cd"`, `"efgh "`, `"ij"`, `" kl"`. Unless stated, the selection is
`"ab "`@0 → `"efgh "`@3.

| # | Action | Expected | Today |
|---|---|---|---|
| R1 | `cut()` | `getValue()` = `h **ij** kl`; a following `getSelectionState()` returns without throwing | throws |
| R2 | backward selection (`"efgh "`@3 → `"ab "`@0), `cut()` | `h **ij** kl` | throws |
| R3 | `lexicalOf(e).dispatchCommand(DELETE_CHARACTER_COMMAND, true)`, outside any update | `h **ij** kl` | throws |
| R4 | `dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x')` | `xh **ij** kl` | throws |
| R5 | document `**ab** cd\n\nefgh **ij** kl`, `"ab"`@0 → `"efgh "`@3, `dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x')` | `**x**h **ij** kl` (the start's bold is carried) | throws |
| R6 | `dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined)` | `getValue()` = `h **ij** kl`, root has 2 children | throws |
| R7 | `insertImage('/i.png', { alt: 'i' })` | `![i](/i.png)h **ij** kl` | throws |
| R8 | `vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('zz')`, `await paste()` | `zzh **ij** kl` | throws |
| R9 | `dispatchCommand(CUT_COMMAND, null)`, then `await vi.waitFor(…)` | `h **ij** kl`; mocked `copyToClipboard` called once | throws |
| R10 | `"ab "`@1 → `"efgh "`@3 (not a stale-focus range), `dispatchCommand(CUT_COMMAND, null)` | `ah **ij** kl` (Lexical's own cut) | same |
| R11 | document `**ab** cd\n\nefgh **ij** kl`, `"ab"`@1 → `"efgh "`@3, `dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x')` | `**ax**h **ij** kl` (Lexical's own path) | same |
| R12 | document `ab **cd** ef`, `"ab "`@1 → `" ef"`@2, `cut()` | `af` | same |

### Upstream canaries

These use plain `createEditor({ onError })` from `lexical`, with an `onError`
that records the error and does not rethrow.

| # | Setup | Expected |
|---|---|---|
| U1 | Paragraphs `["ab ", bold "cd"]`, `["efgh ", bold "ij", " kl"]`; select `"ab "`@0 → `"efgh "`@3; `selection.removeText()` | the recorded error message contains `$getTextNodeOffset: invalid offset` |
| U2 | Register `LinkNode`; paragraph `"a "`, link(`u`)[`"b"`], `" c"`; select `"a "`@0 → `"b"`@0; `$toggleLink(null)` | an error was recorded (`TypeError`) |

Give each canary a comment: *when this fails after a Lexical upgrade, the
upstream bug is fixed — delete the matching guard in `MarkdownEditor.ts` and
this canary*.

### Manual (browser) checks

Run `npm run dev` at the repo root and open **MD Editor**.

| # | Steps | Expected |
|---|---|---|
| M1 | Below the sample's table, add a paragraph. Drag from that paragraph's start into a cell of the table. Right-click → Align → Center | the paragraph and the whole table sit in one centred fence; no console error |
| M2 | Type `ab **cd**`, Enter, `efgh **ij** kl`. Select from the start of `ab` to just after `efg`. In turn, press Backspace, type `x`, press Enter, press Ctrl/Cmd+X (undo between each) | each edit applies (text becomes `h ij kl`, `xh ij kl`, …); no console error; Ctrl/Cmd+V afterwards pastes the cut text |
| M3 | Same selection, press Ctrl+Backspace (Alt+Backspace on macOS) | the range is removed; no console error (`DELETE_WORD`; `DELETE_LINE` cannot run headless) |
| M4 | Drag from one table cell into another | cells highlight as a block (table selection); Delete clears their contents and the table keeps its shape |
| M5 | Drag from the paragraph above a table into one of its cells | the selection grows to cover the whole table; Delete removes the selected text and the whole table, leaving no partial table |

M4 and M5 confirm that defect 4 cannot be reached.

---

## Verification

- `npm run typecheck` (repo root) and `npm -w packages/lib run typecheck:test`.
- `npx vitest run tests/component/markdown-editor-command-crashes.test.ts`: all rows pass.
- `npm test` (repo root): full suite green, including
  `tests/unit/import-without-dom.test.ts`, since `@lexical/clipboard` is a new import.
- `npm run lint` (repo root): zero errors, including `local/no-raw-dom`.
- `grep -n getTopLevelElementOrThrow packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`: no matches.
- `npm run docs:api` (repo root) finishes with zero warnings.
- Manual rows M1–M5.

---

## Documentation Impact

No public API changes, so no component page changes. Changelog entries for
`next.md` → `## Fixed` → `### Components`:

- **`MarkdownEditor` aligns and columns a selection that reaches into a table
  or a `:::` column.** `setBlockAlignment` and `setColumnCount` threw when
  the selection spanned two table cells, or ran from outside a `:::` fence
  into one of its columns. With the caret in a table that was not the
  document's first block, they wrapped an earlier block instead of the table.
  They now wrap the whole table or fence the selection reaches. No consumer
  action is needed.

- **`MarkdownEditor.toggleLink(null)` no longer throws at a link's edge.** A
  selection that ended exactly where a link starts, or started exactly where
  one ends, made Lexical's link removal throw. A link with none of its text
  selected is now left as it is. No consumer action is needed.

- **`MarkdownEditor` no longer throws when deleting from the start of a
  paragraph into a later one.** Deleting, typing over, cutting, pasting over
  or pressing Enter on a selection that started at the beginning of a block
  and ended inside a word of a later block could throw inside Lexical. The
  document was then left partly edited. These edits now apply normally. No
  consumer action is needed.

---

## Potential Challenges

- **The stack tip moves before implementation.** Find each site by its symbol
  (`$wrapSelectedTopLevelBlocks`, `toggleLink`, `cut`, `paste`, `insertImage`,
  `ensureEditor`), not by line number.
- **Worktree `node_modules`.** A fresh worktree needs `node_modules` and
  `packages/lib/node_modules` symlinked to the main tree's, as the stack's
  worktrees do. Run `npm install` for step 4 in the main tree's root, or make
  sure the lockfile change lands in the worktree's commit.
- **`vi.mock` hoisting.** Keep the `@lexical/clipboard` mock spread over the
  real module. `@lexical/rich-text` imports it too, and a bare mock would break
  its paste path.
- **A Lexical upgrade changes the bug's shape.** The canaries U1/U2 fail
  loudly. Do not change the guards' shape tests without re-running the R rows.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$wrapSelectedTopLevelBlocks` (L427), `$findEnclosingLinkNode` (L375), `$pasteIntoRawBlock` (L666), `$classifyContextMenuTarget`'s block test (L974), `toggleLink` (L1956), `removeLink` (L1989, the precedent for reshaping a selection before `$toggleLink`), `cut` (L2116), `paste` (L2147), `insertImage` (L2389), `ensureEditor` (L2757, the precedent for command registration).
- [markdownBlockNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownBlockNode.ts): `MarkdownColumnNode.isShadowRoot`.
- `packages/lib/tests/component/markdown-reference-links.test.ts`: header and helper pattern for the new test file.
- `packages/lib/tests/component/diagram/ElkLayoutEngine.test.ts`: `vi.mock` of a third-party module.
- `node_modules/@lexical/rich-text/dist/LexicalRichText.dev.mjs`: `onCutForRichText`, which `$cutStaleFocusRange` mirrors.

---

## Non-Goals

- **Changing `reportEditorError`.** Its rethrow skips Lexical's rollback of a
  failed update, so any upstream throw leaves a half-applied document that
  commits on the next read. This turned defects 1–3 into corruption, not just
  errors.[^rollback] Fixing it changes when every command's errors surface, so
  it belongs in its own plan.
- **`setBlockAlignment` / `setColumnCount` with a table selection.** In a
  browser, two selected cells form a `TableSelection`, and both commands no-op
  on it, as before. This is not a crash.
- **Making tables rectangular after a forged cross-cell range delete, or
  writing body cells past the header width.** Defect 4 is not reachable; see
  its decision.
- **`insertTable` over a non-collapsed range** inserts at the focus without
  removing the range. That is Lexical's behaviour, unchanged.

---

## Notes

[^d1-trace]: Reproduced on the stack tip with `a||\n-|-` and a selection from
    `a` into the second cell. `getNodes()` returns the second `TableCellNode`,
    whose `getTopLevelElement()` is itself (index 1 in its row). The root has
    one child, so `children[1]` is `undefined`, and `column.append(undefined)`
    throws inside Lexical's `splice` (`Cannot read properties of undefined
    (reading 'is')`, MarkdownEditor.ts:459). The same code on `master` (line
    384) behaves the same way.

[^nesting]: `docs/components/Markdown.md` documents that `:::` fences nest,
    tracked by depth. The editor already round-trips nested fences.
    Refusing to wrap would make the command a no-op for a perfectly ordinary
    drag selection.

[^d2-upstream]: `@lexical/link` 0.49.0 `$splitLinkAtSelection`: with no
    extracted children, `firstExtractedIndex` and `lastExtractedIndex` are
    `-1`, so it takes the "middle" branch and calls
    `extractedChildren[-1].insertAfter(…)`. It also reproduces with plain
    Lexical and on 0.52.0. Both a text point and an element point on the edge
    trigger it; an element point on the link's parent does not. That is why
    the fix moves the point there.

[^d3-mechanism]: In `$removeTextFromCaretRange` (Lexical 0.49.0), the end text
    node is sliced, then the end block's remaining children are spliced into
    the start block. When the start block was emptied, the selection's anchor
    is an element point on it. Each `insertBefore` then calls
    `$updateElementSelectionOnCreateDeleteNode`, which calls
    `selection.isBackward()`. That builds a caret from the selection's focus,
    which still holds the original offset (3) against the sliced node (size
    2), and throws.

[^d3-upstream]: Checked in a scratch install of `lexical@0.49.0` and
    `lexical@0.52.0` with plain `createEditor()`: both throw. The open-source
    editor Zettel hit and worked around the same error
    (github.com/opral/zettel, PR #23). Lexical PR #9263, "share directional
    selection operations and endpoint repair", may address it upstream; this
    is not verified. Filing a minimal issue with the U1 setup is left to the
    user.

[^d3-split]: Splitting changes no content. It puts the end on a node
    boundary, so after the slice there is no offset left to go stale. The
    prototype gave the same result as Lexical for every range shape that
    does not throw. The two text halves share a format and are merged back
    by Lexical's end-of-update normalisation.

[^d3-merge]: Shown by the prototype's first version, which only split the
    node in a CRITICAL listener and returned `false`. It worked when the
    command was dispatched inside an update. It still threw when dispatched
    from outside one (R3): Lexical runs each priority level of an outside
    dispatch in its own update, and the split had been merged back before
    the EDITOR-priority handler ran.

[^d3-dispatch]: Lexical dispatches these commands both from inside an update
    (`onBeforeInput`, nested dispatches) and from outside one (`onKeyDown`'s
    fallback `DELETE_CHARACTER`, the `cut` / `paste` pass-through events).
    Native cut is not a removal command at all: `onCutForRichText` awaits
    `copyToClipboard` and then calls `removeText()` in a separate update.
    That is why it gets a full mirror, which needs `copyToClipboard`, and
    therefore the direct `@lexical/clipboard` dependency. That package is
    already installed at the same version as a dependency of
    `@lexical/rich-text`, and the lib build already externalises `@lexical/*`.

[^d3-readstate]: The brief that reported this defect described it as
    `$readSelectionState` throwing. The full stack shows the first throw
    inside `removeText()` itself. `reportEditorError` rethrows, which skips
    Lexical's rollback, so the half-applied pending state (with the stale
    focus) commits on the next `editor.read()`. The update listener's
    `$readSelectionState` then throws a second time, via
    `getTextContent()` → `getNodes()`.

[^canary]: There is no existing precedent for a third-party canary test in
    this repo. It is test-only, and it is the cheapest way to tie each guard
    to the upstream bug it exists for, so neither guard outlives the bug
    unnoticed.

[^d4-reach]: `@lexical/table` 0.49.0 `$handleTableSelectionChangeCommand` →
    `$fixRangeSelectionForSelectedTable` runs on every `SELECTION_CHANGE`
    once `registerTableSelectionObserver` is registered (in `mountWysiwyg`,
    whenever a root element exists). The only `MarkdownEditor` code that
    sets a selection is `selectStart` / `selectEnd` / `select` on single
    nodes and `$selectEnclosingWordIfCollapsed` (one text node). Headless, a
    forged cross-cell `removeText()` removes whole cells and rows.
    `$tableTransform` does not pad the result, because only the rows, not
    the table, are marked dirty. A guard for this would be code for an
    unreachable state (CLAUDE.md §2).

[^b1-setup]: The second cell holds an empty paragraph and no text node, so
    B1 sets the focus with `focus.set(paragraphKey, 0, 'element')`. Reach
    the paragraph via
    `($getRoot().getFirstChild() as ElementNode).getFirstChild()` (the row)
    `.getChildAtIndex(1)` (the cell) `.getFirstChild()`.

[^rollback]: Lexical's `$beginUpdate` calls `editor._onError(error)` and only
    then restores the previous state. Its default `onError` is
    `console.error`. Because our handler throws, the restore never runs.
    Observed on the stack tip: after B1's throw, `getValue()` returned the
    table wrapped in an empty `::: {}` fence. A deferred rethrow
    (`queueMicrotask(() => { throw error; })`) would keep errors loud and
    let Lexical roll back.
