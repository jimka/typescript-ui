---
depends-on:
  - marked-version-pin-or-upgrade
  - marked-upgrade
  - markdown-list-toggle-task-item-parity
  - markdown-editor-raw-block-edge-cases
  - markdown-editor-raw-block-range-edits
  - markdown-editor-cross-item-range-removal
  - markdown-tab-column-parity
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-source-edits.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Source-Mode List Lift Parity — Implementation Plan

## Overview

`MarkdownEditor` has two editing surfaces: WYSIWYG, and source mode, which edits the raw Markdown text. When a block leaves its list item — a list toggle turned off, `setBlockType`, the code fence — the WYSIWYG surface takes what the item holds after that block out of the list with it. Source mode leaves those blocks in the list, in an item its marker re-opens, and in some shapes does nothing at all. This plan makes source mode do what the WYSIWYG surface does.

| Document | Caret, command | WYSIWYG | Source mode before | Source mode after |
|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎ - two` | `one`, bulleted toggle | `one ⏎⏎ second ⏎⏎ - two` | `one ⏎⏎ - second ⏎⏎ - two` | `one ⏎⏎ second ⏎⏎ - two` |
| same | `one`, numbered toggle | `1. one ⏎⏎    second ⏎⏎ - two` | `1. one ⏎⏎ - second ⏎⏎ - two` | `1. one ⏎⏎    second ⏎⏎ - two` |
| `- [x] a ⏎   - b ⏎   - c ⏎ - d` | `b`, `setBlockType("h2")` | `- [x] a ⏎⏎ ## b ⏎⏎ - - c ⏎ - d` | nothing | `- [x] a ⏎ ## b ⏎ - - c ⏎ - d` |
| `- one ⏎⏎ →second ⏎ - two` | `one`, bulleted toggle | `one ⏎⏎ second ⏎⏎ - two` | nothing | `one ⏎⏎ ··second ⏎ - two` |

`⏎` is a line end, `⏎⏎` a blank line, `→` a tab and `·` a space throughout.

A line that leaves the list this way loses the list items' indentation. When a tab stands in that indentation, the tab is written as the spaces it stood for, so the line reads at its new place as it read in the item (the last row). No other byte of the line changes.

The whole change is in [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts). `markdownSourceTokens.ts`, `markdownExtensions.ts`, `MarkdownEditor.ts` and `CodeEditor.ts` are not touched. The tests are rows in two existing test files. The docs lose their paragraph on "the difference that is to go".

A first implementation of this rule was written inside `markdown-list-toggle-task-item-parity`, went through five reviews without converging, and was withdrawn on 2026-10-11. Its branch was deleted on 2026-10-12. This plan calls it *the first attempt*; its design is not reused.

*Base* means the code this plan starts from: commit `736452bbc`, the tip of the Markdown stack, with the plans of `depends-on` on top. `marked` is 18.1.0 there (`marked-version-pin-or-upgrade`, then `marked-upgrade`), and `markdown-tab-column-parity` reads a tab in a line's container prefix as the spaces to its tab stop. Every number here was measured on `736452bbc` with those three plans' code applied and `marked` 18.1.0.[^measured] `markdownSourceLines.ts` is the same file at `736452bbc` as at the older tip `75d022ba1`, but for one comment line `marked-upgrade` edits. Line numbers are from `736452bbc`; find each site by its symbol name.

---

## Architecture Decisions

### The rule — a lifted block's tail leaves the list with it

Terms:

- A *lifted block* is a paragraph, heading or list item text that a line command takes out of its quotes and list items.
- Its *outermost list item* is the list item around it that no other list item holds.
- Its *wrap item* is the first list item that follows it inside its outermost list item, in a list that stands directly in a list item or quote around the lifted block. A list inside another block that follows (a quote the item holds) does not count: it belongs to that block.
- Its *tail* is everything between the lifted block and its wrap item, or to the end of the outermost list item when there is no wrap item.

The rule has three parts.

1. The tail loses the indentation of every list item around the lifted block. It stands where the lifted block stands. When a list toggle makes the lifted block a new item, the tail becomes the blocks that item holds.
2. From the wrap item on, what follows stays in the list, in one plain item that the outermost list item's marker re-opens. The list items between that one and the lifted block are gone, so a nested item's own nested list stands one level up.
3. Quotes are kept. A line keeps every `>` it carries.

| Document | Lifted block | Tail | Wrap item | Result of the bulleted toggle |
|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `one` | `second`, `third` | none | `one ⏎⏎ second ⏎⏎ third ⏎⏎ - two` |
| `- one ⏎⏎   second ⏎⏎   - inner ⏎⏎   after ⏎ - two` | `one` | `second` | `inner` | `one ⏎⏎ second ⏎⏎ - - inner ⏎⏎   after ⏎ - two` |
| `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | `b` | `c` | none | `- a ⏎⏎ b ⏎⏎ c ⏎⏎ - d` |
| `- o ⏎   - x ⏎     - n ⏎   - y ⏎ - z` | `x` | nothing | `n` | `- o ⏎⏎ x ⏎⏎ - - n ⏎   - y ⏎ - z` |
| `> - one ⏎ > ⏎ >   second ⏎ > - two` | `one` | `second` | none | `one ⏎ > ⏎ > second ⏎ > - two` |

This is the rule the WYSIWYG surface follows through `$liftItemOut` ([markdownListItemNode.ts:780](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L780)).[^rule]

### Two candidates, one check — the tail lift is tried first, the base edit after it

A line command builds its edit in *forms* and takes the first form whose result reads as expected: as written, set apart by blank lines, and each of those with an opening character escaped (`firstReadingEdit`, [markdownSourceLines.ts:977](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L977)). This plan puts a second axis in front of the forms. Each command hands `firstReadingEdit` a list of *candidates*:

1. the **tail candidate**: the edit with every lifted block's tail taken out of the list, and the leaves the rule says that result must read as;
2. the **base candidate**: the edit and the expected leaves exactly as the base builds them, tail left in the list.

Every form of the tail candidate is tried before any form of the base candidate. The first form that reads as its own candidate expects is the edit. When none does, the command declines.

| Document, caret on `one`, `setBlockType("h2")` | Tail candidate | Base candidate | Edit |
|---|---|---|---|
| `- one ⏎⏎   second ⏎ - two` | `## one ⏎⏎ second ⏎ - two` reads as expected | not tried | the tail candidate's |
| `` - one ⏎⏎   ``` ⏎   open ⏎ - two `` (a code fence left open) | `` ## one ⏎⏎ ``` ⏎ open ⏎ - two `` does not: the fence now takes `- two` | `` ## one ⏎⏎ - ``` ⏎   open ⏎ - two `` reads as expected | the base candidate's |
| `- one ⏎⏎ →second ⏎ - two` (a tab indents the tail) | `## one ⏎⏎ ··second ⏎ - two` reads as expected | not tried (it would not be built: the base cannot re-open the item on a tab) | the tail candidate's, where the base did nothing |

Because the base candidate is the base's own edit under the base's own check, a command that acts at the base acts after this plan. That holds by construction and was measured.[^mechanism]

The precedent is `listOn` ([markdownSourceLines.ts:1343](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts#L1343)), which already tries the new items joined to the list next to them and then written as a list of their own, each under the same check.

### The tail candidate is written line by line, with the base's own prefix readers

A new function, `liftLinesWithTail`, stands beside `liftLines` and has its shape. For every line after a lifted block it reads the containers that hold the line from the block tree (`containersOfLine`), takes the prefix each container gives the line with the readers the base has (`QUOTE_MARKER`, `itemIndent`), and writes this in the prefix's place:

| The container | The line | Written for the prefix |
|---|---|---|
| a quote | any | the marker, as the line carries it |
| a list item that is not around the lifted block | any | its spaces, as they are |
| a list item around the lifted block, inside the outermost one | any | nothing |
| the outermost list item | in the tail | nothing; or the new item's content indentation, when a list toggle makes the block an item |
| the outermost list item | the wrap item's first line | the item's marker |
| the outermost list item | after that line | its spaces, as they are |

What stands past the prefixes is the line's content. `liftLinesWithTail` writes it back byte for byte: a tab in a code line, trailing spaces, an escape. A tab in the prefixes themselves is the one exception, the next decision. A line that carries less than a prefix — a lazy line, or a line of whitespace — gives up the spaces it carries and nothing more.

`liftLines` and `reopenContainers` are not changed. `containerPrefix` and `itemIndent` gain one optional parameter, `tabStops`, `false` by default; the base candidate runs through all four as before.

### A tab in a moved line's container prefix is written as the spaces it stood for

`liftLinesWithTail` reads each line after a lifted block in its *spaces form*: the line with every tab of its container prefix written as the spaces that reach that tab's stop, counted from the line's start. That is what `withPrefixTabsAsSpaces` returns, the function `markdown-tab-column-parity` adds to `markdownExtensions.ts` and the lexer reads every list and quote line through. A *container prefix* is that plan's term: a line's leading run of spaces, tabs, `>` markers and list markers, and a task checkbox right after a list marker.

The prefixes are taken off and put on in the spaces form, as for a line without a tab. The line is then written as its own bytes up to the first column the lift changes, and as the spaces form from there on (`keptBytes`). An item's marker line is read in its spaces form too, so a tab after the marker gives the item's content column (`-→one` puts it at column 4).[^tabs] The pattern is the lexer's own: `listWithTabStops` in `markdownExtensions.ts` (added by `markdown-tab-column-parity`) reads a list from the spaces form of its lines and sets each token's `raw` back to the source's bytes.

Which bytes the tail lift may rewrite, and which never:

| Bytes of a line after the lifted block | Written |
|---|---|
| a tab of the container prefix at or past the first column the lift changes | the spaces that reach its tab stop from the column it stood at; the lift then takes the list items' columns off those spaces as off any others |
| whitespace that holds a tab and ends the line right after a marker (`··-→`) | one space, as `withPrefixTabsAsSpaces` writes it and the lexer reads it |
| a tab of the container prefix before the first column the lift changes | kept |
| a tab past the container prefix: in text, a code span, or a code or HTML line past its first character that is no prefix | kept |
| every byte of a line whose prefixes the lift writes back unchanged: a line before the lifted block, a line from the wrap item on that keeps all its prefixes, a line outside the outermost list item | kept |
| a line the base candidate writes | as at the base: a tab there still makes the base decline |

| Line after the lifted block, in a `- ` item (`one` lifted, bulleted toggle) | Written |
|---|---|
| `··second` | `second` |
| `··a→b` in a code block | `a→b` |
| `→second` | `··second`: the tab ran from column 0 to 4, two of them the item's |
| `··→bb` in a code block | `··bb` |
| `··-→old` in a code block | `-·old` |
| `→after`, below the item's nested list | `→after`: the outermost item keeps its columns from the nested list on |

The lifted block's own lines are not in this table: the lift writes them from the block's text, without any indentation, whether a tab stood there or not.

### The expected leaves come from the block tree, the lines from the text

The tail candidate's expected leaves are computed by `keptLeafAfterLifts` from the analysis's entries and block nodes alone. It never looks at a line. `liftLinesWithTail` works from lines and container spans. The two meet only in the wrap item. A reading that one of them gets wrong therefore shows as a mismatch in the check.[^independent]

| A kept leaf | Path before | Expected path in the tail candidate |
|---|---|---|
| in the tail of a lifted item text | `list / item / p` | `p` |
| in the tail, the block made a numbered item | `list:false / item / p` | `list:true / item / p` |
| at or after the wrap item, two list items around the lifted block | `list / item / list / item / list / item / p` | `list / item:false:false / list / item / p` |
| before the lifted block, or outside its outermost list item | any | unchanged |

### The check on a tail candidate also tells one container from two

`readsAsExpected` compares each leaf's key, its path of container signatures, and whether two neighbouring leaves share a block. A path cannot tell one quote from two quotes side by side, or a tail under its new item from a tail in an item of its own. For a tail candidate the check therefore also compares container *instances*: two neighbouring leaves must stand in the same quote, and in the same list item, exactly when they are expected to.[^instances]

| Result | Paths | Blocks | Instances |
|---|---|---|---|
| `> second ⏎ > ⏎ > - two` where one quote is expected | as expected | as expected | as expected |
| `> second ⏎⏎ > - two` where one quote is expected | as expected | as expected | **two quotes: rejected** |

The base candidate is checked as at the base, without instances, so that it accepts exactly what the base accepts.

### `markdownSourceTokens.ts` is not changed

The token search stays as it is. A block whose text it does not find stays *unplaced*: the analysis has no source offsets for it. A command on it declines as at the base. Source analysis therefore costs what it cost.[^analysis]

### Ownership — this plan writes the lines after a lifted block, `markdown-source-mode-block-locator` places blocks

`markdown-source-mode-block-locator` comes next. It replaces the token search, so that a block a tab indents is placed (rows `E25`, `E26`), and its owner's answer B1 is that a block command on such a block writes the block's line without the tab. The two plans split the work this way:

| Lines | Owner | What happens to a tab there |
|---|---|---|
| the lifted block's own lines | the lift as it stands at the base | the line is written from the block's text, so no indentation is kept, tab or not; B1 is this, once the block is placed |
| the lines after the lifted block that the tail lift writes: the tail, the wrap item's line, the lines below it | this plan | a tab of the container prefix that moves is written as spaces (the table above) |
| which blocks are placed, and so which commands reach a lift at all | `markdown-source-mode-block-locator` | none: placing writes no line |

Once the locator places a tab-indented block, every line after it that a lift moves goes through this plan's rule. There is one rule for prefix tabs, not two.

### What a tab does, on top of `markdown-tab-column-parity`

`markdown-tab-column-parity` is implemented first. It makes the viewer and the WYSIWYG surface read a tab in a line's container prefix as the spaces that reach its tab stop, counted from the line start, and keep every other tab. This plan reads tabs through that plan's `withPrefixTabsAsSpaces` and adds no reading of its own.[^tab-order]

| Shape (`- ` item, caret on `one` unless said) | Source mode after this plan | Why | Row |
|---|---|---|---|
| `` ··``` ⏎ ··a→b ⏎ ··``` `` held by the item: a tab inside a code line | the code block leaves the list, the tab kept | the tab is content | `E38`, moves to `SAME` |
| `` ··``` ⏎ ··aa ⏎ ··→bb ⏎ ··``` ``: a tab that indents a code line | the code block leaves the list as `aa ⏎ ··bb`, the WYSIWYG surface's text | the tab moves, and is written as the two columns it stood for in the item | `E18`, new, source-mode rows |
| `→second` held by the item: a tab indents the block after the caret's | `second` leaves the list as `··second` | the tab moves | `E24` (two), to source-mode rows |
| `-→one ⏎⏎ →second`: a tab after the marker of an item that holds more lines | `second` leaves the list as `second` | the marker line is read in its spaces form: the content column is 4, as wide as the tab of `→second` | `E19` `UL`, to source-mode rows |
| the caret on that `second` in `- one ⏎⏎ →second` | nothing | the token search does not place the block | `E25`, stays; the locator's |
| `→- nested`: a nested list indented by a tab, caret on `nested` | nothing | the same | `E26`, stays; the locator's |
| the same, caret on `one` | nothing | the nested list the tail ends at is not placed, so the tail candidate is not built | `E27`, stays; once the locator places the list, this plan's rule writes the list's line |
| `- one→tab`: a tab in the item's text | acts | content tab | `E19` `h2`, in `SAME` since `marked-upgrade` |
| a block before a tab-indented block: `··ok ⏎⏎ →tabbed` | both leave the list, `tabbed` as `··tabbed` | the tab moves | source-mode row |

The `E18`, `E19` `UL` and `E24` documents hold a tab in an item's indentation, which the editor never saves, so they cannot be `SAME` rows; they become rows of the source-mode `CASES` table, and their results read as the WYSIWYG results do.

### Decisions (signed off 2026-10-14)

The repository's owner answered these on 2026-10-14. The plan is written for these answers.

**L1. `setBlockType` and the code fence lift the tail too — accepted.** The three commands share one lift, as on the WYSIWYG surface.

| Document | Caret | Command | Source mode at the base | Source mode after | WYSIWYG |
|---|---|---|---|---|---|
| `- one ⏎⏎   second ⏎⏎ - two` | `one` | bulleted toggle, `setBlockType("paragraph")` | `one ⏎⏎ - second ⏎⏎ - two` | `one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("h2")` | `## one ⏎⏎ - second ⏎⏎ - two` | `## one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("quote")` | `> one ⏎⏎ - second ⏎⏎ - two` | `> one ⏎⏎ second ⏎⏎ - two` | the same |
| same | `one` | `setBlockType("code")` | a fence holding `one`, then `- second ⏎⏎ - two` | the fence, then `second ⏎⏎ - two` | the same |
| same | `one` | numbered toggle | `1. one ⏎⏎ - second ⏎⏎ - two` | `1. one ⏎⏎    second ⏎⏎ - two` | the same |
| `10. a ⏎⏎     b` | `a` | `setBlockType("h2")` | `## a ⏎⏎ 10. b` | `## a ⏎⏎ b` | the same |
| same | `a` | `setBlockType("code")` | a fence holding `a`, then `10. b` | the fence, then `b` | the same |
| same | `a` | bulleted toggle | `- a ⏎⏎ 10. b` | `- a ⏎⏎   b` | the same |
| `- one ⏎⏎   second ⏎⏎   third ⏎⏎ - two` | `second` | bulleted toggle | `- one ⏎⏎ - second ⏎⏎ - third ⏎⏎ - two` | `- one ⏎⏎ - second ⏎⏎   third ⏎⏎ - two` | the same |
| same | `second` | `setBlockType("h2")` | `- one ⏎⏎ ## second ⏎⏎ - third ⏎⏎ - two` | `- one ⏎⏎ ## second ⏎⏎ third ⏎⏎ - two` | `- one ⏎⏎   ## second ⏎⏎   third ⏎⏎ - two` |
| `- a ⏎   - b ⏎⏎   c ⏎⏎ - d` | `b` | bulleted toggle | `- a ⏎⏎ b ⏎⏎ - c ⏎⏎ - d` | `- a ⏎⏎ b ⏎⏎ c ⏎⏎ - d` | the same |
| `- o ⏎   - x ⏎     - n ⏎   - y ⏎ - z` | `x` | bulleted toggle | `- o ⏎⏎ x ⏎⏎ - - - n ⏎   - y ⏎ - z` | `- o ⏎⏎ x ⏎⏎ - - n ⏎   - y ⏎ - z` | the same |

**L2. `setBlockType` on a block inside a task item acts as on any other item — accepted.** `setBlockType` on a block an item holds converts it in place on the WYSIWYG surface and takes it out of the list in source mode (the `setBlockType("h2")` row on `second` above). At the base source mode did nothing where that block stood in a task item with more of the item after it. It now acts there as on any other item, so those cases move from "both do nothing" to that known difference (rows `T20` `h2`, `M33` `h2`).[^held]

**L3. Row `E18`: the code block leaves the list, its tab written as spaces — decided against the first recommendation.** With `markdown-tab-column-parity` the tab in `··→bb` is two columns wide inside a `- ` item. The WYSIWYG surface takes the code block out of the list and writes those two columns as spaces (`··bb`). Source mode now does the same: it rewrites the bytes of that line's indentation, and the two surfaces agree.[^e18]

**L4. The tab-indented item lines of `E24` to `E27` and `E19` `UL` are rewritten too — decided against the first recommendation.** The same rule as L3: a tab in a moved line's container prefix is written as the spaces the tab rule gives. `E24` and `E19` `UL` act with this plan. `E25`, `E26` and `E27` stay declined here, because their blocks are not placed. Once `markdown-source-mode-block-locator` places them, that plan's B1 covers the placed block's own line (`E25`, `E26`), and this plan's rule every line a lift moves after it (`E27`'s nested list). What those three rows then give is that plan's to measure.

**L5. A tail inside a quote stays in the quote — accepted.** When a quote holds the list, a numbered toggle on `one` in `> - one ⏎ > ⏎ >   second` gives `1. one ⏎ > ⏎ > second`: the new item stands outside the quote, so the tail cannot be one of its blocks. The WYSIWYG surface keeps such a list as a raw block, so there is nothing to agree with.

### Scope edges

- **Task items.** A lifted block inside a task item acts. The item's marker stays with the part of the item before the lifted block; what stays in the list after the tail is a plain item (rows `T19` to `T21`).
- **A thematic break.** A break in the tail leaves the list like any block, so a break written in the list's own marker character no longer makes the command decline (rows `M33` to `M37`).
- **`:::` columns.** Nothing changes: a block never leaves its column, and the lift works inside it (rows `C3`).
- **Numbered lists not starting at 1.** Source mode leaves every number as written. The viewer numbers a list from 1 whatever its markers say, so both surfaces read alike. A numbered item not numbered 1 cannot follow a paragraph directly; the set-apart form writes a blank line between the tail and that item (`3. a ⏎⏎    b ⏎ 4. c` gives `## a ⏎⏎ b ⏎⏎ 4. c`).
- **The blank line below the tail.** Only the set-apart forms write one, and only where no blank line or quote-marker line stands there. It carries the markers of the quotes that hold both the tail's last line and the line below (`>`), so it splits no quote.
- **Looseness.** A list that was loose because of blocks that left it reads tight in source mode and keeps its loose spacing on the WYSIWYG surface. The docs already state this difference; the lift makes it show in more documents.[^looseness]

### Tests are rows in the existing tables, each seen to fail first

Parity rows go into `SAME` and `DIFFERS` of [markdown-editor.test.ts:1113](../packages/lib/tests/component/markdown-editor.test.ts#L1113). Source-mode rows that hold text the editor would not save go into the `CASES` table of `describe('MarkdownEditor source-mode line commands read the viewer's blocks')` ([:2853](../packages/lib/tests/component/markdown-editor.test.ts#L2853)). Rows on the transforms themselves go into `describe('line commands act on the blocks the viewer reads')` in [markdown-source-edits.test.ts:1389](../packages/lib/tests/component/markdown-source-edits.test.ts#L1389). There is no new test file.

---

## Internal Structure

All code is for [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts). It is the code that was measured: a copy of the module with these changes was run in place of the real one.[^prototype]

### Leaves carry the containers they stand in

`LeafView` and `ExpectedLeaf` each gain one field.

```ts
// in LeafView, after `offset`
    /** For each container of `path`, the index of the entry that opened it. */
    readonly holders: readonly number[];

// in ExpectedLeaf, after `group`
    /**
     * For each container of `path`, which instance of it the leaf stands in:
     * two leaves stand in one quote or list item exactly when the ids at its
     * depth are equal. `""` where the instance is not predicted.
     */
    readonly holders?: readonly string[];
```

`readLeaves` keeps a second stack beside `stack`, pushed and popped with it, and copies it into each leaf.

| In `readLeaves` | Change |
|---|---|
| after `const stack: string[] = [];` | add `const holders: number[] = [];` |
| the three `leaves.push({ … })` calls | add `, holders: [...holders]` as the last property of each |
| `stack.pop();` | add `holders.pop();` on the next line |
| `stack.push(…);` | add `holders.push(index);` on the next line |

### The check

`readsAsExpected` gains the parameter `strict`, `false` by default, and `sameHolders` is new. The two other callers of `readsAsExpected` (`addsOneTable`, `opensOwnParagraph`) are not changed.

```ts
/**
 * Whether an edit's result reads as `expected`: the same leaves in the same
 * order, each with the expected containers, and two neighbouring leaves in
 * one block exactly when they are expected in one. Leaves inside a wildcard
 * range only need its path. With `strict`, two neighbouring leaves must also
 * share each quote and list item exactly where they are expected to
 * ({@link sameHolders}).
 *
 * @param text - The pre-edit text.
 * @param edit - The edit.
 * @param expected - The leaves the result must read as, wildcard ranges' leaves left out.
 * @param wildcards - Ranges of the result, in its own offsets, whose leaves are not predicted.
 * @param strict - Whether container instances are compared too: `true` for a tail lift, `false` for every other edit.
 * @returns Whether it does.
 */
function readsAsExpected(
    text: string, edit: MarkdownSourceEdit, expected: readonly ExpectedLeaf[], wildcards: readonly WildcardRange[], strict = false,
): boolean {
    const after = analyzeMarkdownSource(text.slice(0, edit.from) + edit.insert + text.slice(edit.to));
    const actual: LeafView[] = [];

    for (const leaf of readLeaves(after)) {
        const wildcard = wildcards.find((range) => range.from <= leaf.offset && leaf.offset < range.to);

        if (wildcard === undefined) {
            actual.push(leaf);
        } else if (!samePath(leaf.path, wildcard.path)) {
            return false;
        }
    }

    return actual.length === expected.length && actual.every((leaf, index) => {
        const want = expected[index]!;
        const previous = index > 0 ? actual[index - 1]! : null;
        const wantPrevious = index > 0 ? expected[index - 1]! : null;
        const joined = previous !== null && leaf.block === previous.block;
        const sameBlocks = wantPrevious === null || joined === (want.group === wantPrevious.group);
        const sameInstances = !strict || previous === null || wantPrevious === null || sameHolders(leaf, previous, want, wantPrevious);

        return leaf.key === want.key && samePath(leaf.path, want.path) && sameBlocks && sameInstances;
    });
}

/**
 * Whether two neighbouring leaves of a result share each quote and list
 * item exactly where they are expected to: at every depth both leaves have
 * a predicted instance for, they stand in one container there exactly when
 * the two predicted ids are equal. This is what tells one quote from two,
 * and a tail under its new item from a tail in an item of its own, which
 * the paths alone cannot.
 *
 * @param leaf - A leaf of the result.
 * @param previous - The leaf before it.
 * @param want - What `leaf` is expected to be.
 * @param wantPrevious - What `previous` is expected to be.
 * @returns Whether they do.
 */
function sameHolders(leaf: LeafView, previous: LeafView, want: ExpectedLeaf, wantPrevious: ExpectedLeaf): boolean {
    const ids = want.holders;
    const previousIds = wantPrevious.holders;

    if (ids === undefined || previousIds === undefined) {
        return true;
    }

    const depth = Math.min(ids.length, previousIds.length, leaf.holders.length, previous.holders.length);

    for (let index = 0; index < depth; index += 1) {
        if (ids[index] === "" || previousIds[index] === "") {
            continue;
        }

        if ((leaf.holders[index] === previous.holders[index]) !== (ids[index] === previousIds[index])) {
            return false;
        }
    }

    return true;
}
```

### The expected leaves

`expectLeaves` gains the parameter `lifts`. With it, a kept leaf is expected where the tail lift puts it.

```ts
/**
 * The leaves a document is expected to keep: each as it is, its group its
 * own block, unless `change` says what it becomes. With `lifts`, a kept leaf
 * is expected where the tail lift puts it ({@link keptLeafAfterLifts}).
 *
 * @param leaves - The document's leaves.
 * @param change - What a leaf becomes (one leaf or several), `null` to keep it, `undefined` to drop it.
 * @param lifts - The command's lifts when their tails leave their list items; `null` when the tails stay.
 * @returns The expected leaves.
 */
function expectLeaves(
    leaves: readonly LeafView[], change: (leaf: LeafView) => ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined,
    lifts: LiftPlan | null = null,
): ExpectedLeaf[] {
    const expected: ExpectedLeaf[] = [];

    for (const leaf of leaves) {
        const changed = change(leaf);

        if (changed === null) {
            expected.push(lifts === null ? { key: leaf.key, path: leaf.path, group: `o${leaf.block}` } : keptLeafAfterLifts(leaf, lifts));
        } else if (changed !== undefined) {
            expected.push(...(Array.isArray(changed) ? changed as readonly ExpectedLeaf[] : [changed as ExpectedLeaf]));
        }
    }

    return expected;
}

/** One block a line command lifts out of its list items, as the leaves after it in those items read it. */
interface Lift {
    /** The lifted block. */
    readonly node:   SourceBlockNode;
    /** The list and item of the new item the block's tail goes into; empty when the tail stands outside every list. */
    readonly into:   readonly string[];
    /** The instance id of that new item; `""` with no new item. */
    readonly intoId: string;
}

/** A lift with what {@link keptLeafAfterLifts} reads of it for every leaf, read once. */
interface PlannedLift extends Lift {
    /** The list items around the lifted block, outermost first. */
    readonly items:    readonly SourceBlockNode[];
    /** The entries those list items open on. */
    readonly closedAt: ReadonlySet<number>;
    /** The list item that ends the block's tail, `null` for none. */
    readonly wrapper:  SourceBlockNode | null;
}

/** The lifts of one command, with the document's blocks by entry. */
interface LiftPlan {
    readonly lifts:  readonly PlannedLift[];
    readonly nodeAt: ReadonlyMap<number, SourceBlockNode>;
}

/**
 * Plans the lifts of one command.
 *
 * @param analysis - The document's analysis.
 * @param lifts - The lifts, in document order.
 * @returns The plan.
 */
function planLifts(analysis: SourceAnalysis, lifts: readonly Lift[]): LiftPlan {
    return {
        lifts: lifts.map((lift) => {
            const items = liftedItems(lift.node);

            return { ...lift, items, closedAt: new Set(items.map((item) => item.entryStart)), wrapper: wrapperItemAfter(lift.node) };
        }),
        nodeAt: nodesByEntry(analysis),
    };
}

/**
 * What a kept leaf is expected to read as once the lifts' tails have left
 * their list items. A leaf that follows a lifted block inside the block's
 * outermost list item loses the block's list items: before the first list
 * item that follows the block there ({@link wrapperItemAfter}) it loses them
 * all and stands outside every list, or in the lift's new item; from that
 * list item on it keeps the outermost one, as a plain item, and loses the
 * ones inside it. Every other leaf keeps its path.
 *
 * @param leaf - The leaf.
 * @param plan - The lifts.
 * @returns The expected leaf.
 */
function keptLeafAfterLifts(leaf: LeafView, plan: LiftPlan): ExpectedLeaf {
    const lift = liftBefore(leaf, plan);
    const path: string[] = [];
    const holders: string[] = [];

    leaf.path.forEach((segment, depth) => {
        const kept = segmentAfterLift(leaf, depth, segment, lift, plan);

        path.push(...kept.path);
        holders.push(...kept.holders);
    });

    return { key: leaf.key, path, group: `o${leaf.block}`, holders };
}

/**
 * The lift whose tail or re-opened item a leaf stands in: the last lifted
 * block before the leaf whose outermost list item holds the leaf.
 *
 * @param leaf - The leaf.
 * @param plan - The lifts.
 * @returns The lift, or `undefined` for a leaf no lift moves.
 */
function liftBefore(leaf: LeafView, plan: LiftPlan): PlannedLift | undefined {
    return plan.lifts.findLast((candidate) => {
        const outermost = candidate.items[0];

        return candidate.node.entryEnd <= leaf.entry && outermost !== undefined && holdsEntry(outermost, leaf.entry);
    });
}

/**
 * Whether a leaf stays in the list when a lift's tail leaves it: it stands
 * at or after the list item that ends the tail.
 *
 * @param leaf - The leaf.
 * @param lift - The lift the leaf follows, if any.
 * @returns Whether it does.
 */
function staysInList(leaf: LeafView, lift: PlannedLift | undefined): boolean {
    return lift !== undefined && lift.wrapper !== null && leaf.entry >= lift.wrapper.entryStart;
}

/**
 * What one container of a kept leaf's path becomes once the lifts' tails
 * have left their list items, with the instance id of what it becomes.
 *
 * | The container at `depth` | Becomes |
 * |---|---|
 * | the leaf's own block of text (it has no entry) | itself |
 * | the outermost list item around the lifted block, the leaf in the tail | the lift's `into`: nothing, or the new item's list and item |
 * | that item, the leaf at or after the item that ends the tail | a plain item, `item:false:false` |
 * | a list item around the lifted block inside that one | nothing |
 * | the list of a list item that becomes nothing | nothing |
 * | anything else | itself |
 *
 * @param leaf - The leaf.
 * @param depth - The container's index in the leaf's path.
 * @param segment - The container's signature.
 * @param lift - The lift the leaf follows, if any.
 * @param plan - The lifts.
 * @returns The path segments it becomes, and one instance id for each.
 */
function segmentAfterLift(
    leaf: LeafView, depth: number, segment: string, lift: PlannedLift | undefined, plan: LiftPlan,
): { path: string[]; holders: string[] } {
    const holder = leaf.holders[depth];
    const inner = leaf.holders[depth + 1];
    const outermost = lift?.items[0]?.entryStart;
    const stays = staysInList(leaf, lift);
    const isClosed = lift !== undefined && holder !== undefined && lift.closedAt.has(holder);
    const isListOfClosed = lift !== undefined && inner !== undefined && lift.closedAt.has(inner);

    if (isClosed && holder === outermost && stays) {
        return { path: ["item:false:false"], holders: [instanceId(leaf, holder, lift, plan)] };
    }

    if (isClosed && holder === outermost) {
        return { path: [...lift.into], holders: lift.into.map((_, index) => (index === lift.into.length - 1 ? lift.intoId : "")) };
    }

    if (isClosed || (isListOfClosed && !(inner === outermost && stays))) {
        return { path: [], holders: [] };
    }

    const hasInstance = holder !== undefined && !isListOfClosed && (segment === "quote" || segment.startsWith("item:"));

    return { path: [segment], holders: [hasInstance ? instanceId(leaf, holder, lift, plan) : ""] };
}

/**
 * The instance id of a quote or list item a kept leaf stands in: the entry
 * the container opens on, and how many lifted blocks inside it stand before
 * the leaf, since each of them splits the container in two. Inside a lifted
 * block's outermost list item, what stays in the list is one more instance:
 * the tail of a quote there leaves the list and the rest of it does not.
 *
 * @param leaf - The leaf.
 * @param holder - The entry the container opens on.
 * @param lift - The lift the leaf follows, if any.
 * @param plan - The lifts.
 * @returns The id.
 */
function instanceId(leaf: LeafView, holder: number, lift: PlannedLift | undefined, plan: LiftPlan): string {
    const container = plan.nodeAt.get(holder)!;
    const outermost = lift?.items[0];
    const splits = plan.lifts.filter(({ node }) => container.entryStart < node.entryStart && node.entryEnd <= container.entryEnd && node.entryEnd <= leaf.entry).length;
    const inOutermost = outermost !== undefined && outermost.entryStart <= holder && holder < outermost.entryEnd;

    return `${holder}:${splits}${staysInList(leaf, lift) && inOutermost ? "r" : ""}`;
}

/**
 * Whether a leaf at an entry lies inside a block.
 *
 * @param node - The block.
 * @param entry - The leaf's index in the analysis's entries.
 * @returns Whether it does.
 */
function holdsEntry(node: SourceBlockNode, entry: number): boolean {
    return node.entryStart < entry && entry < node.entryEnd;
}
```

### The tail lift

`LineReplacement` gains one optional field, after `nodes`:

```ts
    /**
     * The indentation given to the lines that leave their list items with the
     * replaced ones: none (the default) to stand outside every list, a new
     * item's content indentation to be that item's blocks.
     */
    readonly follow?: string;
```

The module imports the spaces form from the lexer module. Add this line directly after the import of `lineEndAt`:

```ts
import { withPrefixTabsAsSpaces } from "~/component/display/markdownExtensions.js";
```

`itemIndent` and `containerPrefix` each gain a last parameter, `tabStops = false`. With it `true`, `itemIndent` reads the item's first line in its spaces form. Every existing call keeps its arguments, so the base candidate reads exactly as before; only `itemPrefixAfterLift` below passes `true`.

| Function | Change |
|---|---|
| `containerPrefix` | signature `(analysis, container, rest, indents, tabStops = false)`; doc `@param tabStops - Whether lines are read in their spaces form, as {@link itemIndent} takes it.`; its call `itemIndent(analysis, container, indents)` becomes `itemIndent(analysis, container, indents, tabStops)` |
| `itemIndent` | signature `(analysis, item, indents, tabStops = false)`, written over three lines like `containerPrefix`'s; doc `@param tabStops - Whether the first line is read in its spaces form ({@link withPrefixTabsAsSpaces}), as a tail lift reads it.`; `const line = text.slice(lineStart, lineEndAt(text, lineStart));` becomes `const source = text.slice(lineStart, lineEndAt(text, lineStart));` followed by `const line = tabStops ? withPrefixTabsAsSpaces(source) : source;`; its two calls, `itemIndent(analysis, container, indents)` and `containerPrefix(analysis, container, line.slice(position), indents)`, pass `tabStops` as the last argument |

The functions below go directly after `liftLines`, before `liftedRegionEnd`. `liftedItems` moves nowhere; it is already in the module.

```ts
/** A line that holds nothing but quote markers and whitespace: a blank line, also one inside a quote. */
const MARKERS_ONLY = /^[ \t>]*$/;

/** The containers a tail lift has closed, by what each does with the lines that follow the lifted block inside it. */
interface ClosedForTail {
    /** Quotes: each is re-opened by its own marker on the next line that carries it. */
    readonly quotes:    Set<SourceBlockNode>;
    /** Outermost list items: the line each is re-opened on (`-1` for none), and the indentation its lines before that one get. */
    readonly outermost: Map<SourceBlockNode, { readonly wrapLine: number; readonly follow: string }>;
    /** The list items inside an outermost one: every later line loses their indentation. */
    readonly inner:     Set<SourceBlockNode>;
}

/** One line after a lifted block, as a tail lift writes it. */
interface LineAfterLift {
    readonly text:    string;
    /** Whether the line left its list items with the lifted block. */
    readonly isTail:  boolean;
    /** The quotes that open the line before any list item, each with the marker written for it. */
    readonly leading: ReadonlyArray<{ readonly quote: SourceBlockNode; readonly marker: string }>;
}

/**
 * {@link liftLines} with the lifted blocks' tails taken out of their list
 * items. Every line before a replacement is kept. A line after it inside a
 * quote keeps the quote. A line after it inside its list items, before the
 * first list item that follows ({@link wrapperItemAfter}), loses those
 * items' indentation and takes the replacement's `follow` in its place. From
 * that list item on, the outermost of the list items is re-opened by its own
 * marker and the ones inside it are not. With `separate`, each replacement
 * and its tail is set apart from the lines around it by a blank line, which
 * carries the markers of the quotes that hold both its neighbours.
 *
 * @param analysis - The document's analysis.
 * @param replacements - The replacements, in document order, none overlapping.
 * @param separate - Whether to set them apart by blank lines.
 * @returns The edit, or `null` when a line's container prefixes cannot be read or re-opened.
 */
function liftLinesWithTail(analysis: SourceAnalysis, replacements: readonly LineReplacement[], separate: boolean): LiftedEdit | null {
    const text = analysis.text;
    const regionStart = replacements[0]!.first;
    const regionEnd = liftedRegionEnd(text, replacements);
    const closed: ClosedForTail = { quotes: new Set(), outermost: new Map(), inner: new Set() };
    const indents = new Map<SourceBlockNode, ItemIndent | null>();
    const out: string[] = [];
    const ranges: Array<{ from: number; to: number }> = [];
    let length = 0;
    let blankDue = false;
    let tailAbove: LineAfterLift | null = null;

    /** Appends one line to the output, tracking the output's length. */
    const emit = (line: string): void => {
        length += (out.length > 0 ? 1 : 0) + line.length;
        out.push(line);
    };

    for (let lineStart = regionStart; lineStart <= regionEnd;) {
        const replacement = replacements.find((candidate) => candidate.first === lineStart);

        if (replacement !== undefined) {
            const isSetApart = separate && needsBlankAbove(text, regionStart, out, blankDue);

            if (isSetApart) {
                emit("");
            }

            const from = length + (out.length > 0 ? 1 : 0);

            replacement.lines.forEach(emit);
            ranges.push({ from: regionStart + from, to: regionStart + length });

            const isClosed = replacement.nodes.every((node) => closeForTail(text, node, replacement.follow ?? "", closed));

            if (!isClosed) {
                return null;
            }

            blankDue = separate;
            tailAbove = null;
            lineStart = replacement.last + 1;
            continue;
        }

        const lineEnd = lineEndAt(text, lineStart);
        const line = text.slice(lineStart, lineEnd);
        const written = writeLineAfterLift(analysis, lineStart, line, closed, indents);

        if (written === null) {
            return null;
        }

        const separator = separatorAbove(line, written, blankDue, tailAbove);

        if (separator !== null) {
            emit(separator);
        }

        blankDue = false;
        tailAbove = separate && written.isTail && !MARKERS_ONLY.test(line) ? written : null;
        emit(written.text);
        lineStart = lineEnd + 1;
    }

    const lineBelow = regionEnd < text.length ? text.slice(regionEnd + 1, lineEndAt(text, regionEnd + 1)) : "";
    const isApartDue = (blankDue || tailAbove !== null) && !isBlank(lineBelow);

    if (isApartDue) {
        emit("");
    }

    const insert = out.join("\n");

    return { edit: { from: regionStart, to: regionEnd, insert, selection: { from: regionStart, to: regionStart + insert.length } }, ranges };
}

/**
 * Whether a replacement that is set apart needs a blank line written above
 * it: one is due from the replacement before it, or the line above it — the
 * last one written, or the document's line above the lifted region — is not
 * blank.
 *
 * @param text - The full document text.
 * @param regionStart - The start of the lifted region.
 * @param out - The lines written so far.
 * @param blankDue - Whether a blank line is due below the replacement before.
 * @returns Whether it does.
 */
function needsBlankAbove(text: string, regionStart: number, out: readonly string[], blankDue: boolean): boolean {
    const above = out.length > 0 ? out[out.length - 1]! : text.slice(lineStartAt(text, regionStart - 1), Math.max(regionStart - 1, 0));
    const hasLineAbove = regionStart > 0 || out.length > 0;

    return blankDue || (hasLineAbove && !isBlank(above));
}

/**
 * The blank line a tail lift writes above a kept line: an empty line below
 * a replacement that is set apart, and below the last line of a tail that is
 * set apart, the line {@link separatorBelowTail} gives. A line that is blank
 * itself, or holds quote markers alone, already sets what stands above it
 * apart.
 *
 * @param line - The kept line, as it stands in the document.
 * @param written - The line as it is written.
 * @param blankDue - Whether a blank line is due below a replacement.
 * @param tailAbove - The last line of a tail that is set apart, when it stands right above; else `null`.
 * @returns The line to write above, or `null` for none.
 */
function separatorAbove(line: string, written: LineAfterLift, blankDue: boolean, tailAbove: LineAfterLift | null): string | null {
    const isBlankLine = isBlank(line);

    if (blankDue) {
        return isBlankLine ? null : "";
    }

    const endsTail = tailAbove !== null && !written.isTail && !MARKERS_ONLY.test(line);

    return endsTail ? separatorBelowTail(tailAbove, written) : null;
}

/**
 * The blank line that sets a tail apart from the line below it: the markers
 * of the quotes that hold both, so the line splits none of them.
 *
 * @param tail - The tail's last line.
 * @param below - The line below it.
 * @returns The line to write.
 */
function separatorBelowTail(tail: LineAfterLift, below: LineAfterLift): string {
    let shared = 0;

    while (shared < tail.leading.length && shared < below.leading.length && tail.leading[shared]!.quote === below.leading[shared]!.quote) {
        shared += 1;
    }

    return below.leading.slice(0, shared).map((quote) => quote.marker).join("").trimEnd();
}

/**
 * Closes the containers around a lifted block for a tail lift: its quotes,
 * to be re-opened; its outermost list item, re-opened on the first line of
 * the first list item that follows the block inside it; and the list items
 * inside that one, which are not re-opened.
 *
 * @param text - The full document text.
 * @param node - The lifted block.
 * @param follow - The indentation for the lines that leave the list with the block.
 * @param closed - The containers closed; updated.
 * @returns Whether the containers could be closed: `false` when the list item that ends the tail is not located.
 */
function closeForTail(text: string, node: SourceBlockNode, follow: string, closed: ClosedForTail): boolean {
    const [outermost, ...inner] = liftedItems(node);
    const wrapper = wrapperItemAfter(node);

    if (wrapper !== null && wrapper.start === -1) {
        return false;
    }

    liftedContainers(node)!.filter((container) => container.type === "blockquote").forEach((quote) => closed.quotes.add(quote));
    inner.forEach((item) => closed.inner.add(item));

    if (outermost !== undefined) {
        closed.outermost.set(outermost, { wrapLine: wrapper === null ? -1 : wrapLineOf(text, node, wrapper), follow });
    }

    return true;
}

/**
 * The line a lifted block's outermost list item is re-opened on: the first
 * line of the list item that ends the tail, or, when lines holding nothing
 * but a quote's marker stand right above it, the first of those. Such a line
 * is the quote's own blank line before that item: left with the tail, it
 * would be an empty quote there.
 *
 * @param text - The full document text.
 * @param node - The lifted block.
 * @param wrapper - The list item that ends the tail.
 * @returns The line's start.
 */
function wrapLineOf(text: string, node: SourceBlockNode, wrapper: SourceBlockNode): number {
    const blockEnd = lineEndAt(text, node.end - 1);
    let wrapLine = lineStartAt(text, wrapper.start);
    let isMarkerLine = true;

    while (isMarkerLine && wrapLine > 0) {
        const above = lineStartAt(text, wrapLine - 1);
        const line = text.slice(above, lineEndAt(text, above));

        isMarkerLine = above > blockEnd && !isBlank(line) && MARKERS_ONLY.test(line);

        if (isMarkerLine) {
            wrapLine = above;
        }
    }

    return wrapLine;
}

/**
 * The list item that ends a lifted block's tail: the first list item that
 * follows the block inside its outermost list item, in a list that stands
 * directly in one of the block's own containers — a list item or a quote
 * around it. Going up from the block, that is the item after the one holding
 * the block in each list around it, and the first item of the first list
 * that follows in each list item or quote around it. A list inside another
 * block that follows (a quote the item holds after the lifted block) is part
 * of that block and goes where the block goes.
 *
 * @param node - The lifted block.
 * @returns The item, or `null` when no list item follows the block there.
 */
function wrapperItemAfter(node: SourceBlockNode): SourceBlockNode | null {
    const outermost = liftedItems(node)[0];

    if (outermost === undefined) {
        return null;
    }

    for (let child = node; child !== outermost; child = child.parent!) {
        const holder = child.parent!;
        const later = holder.children.slice(holder.children.indexOf(child) + 1);
        const found = holder.type === "list" ? later[0] : later.find((sibling) => sibling.type === "list")?.children[0];

        if (found !== undefined) {
            return found;
        }
    }

    return null;
}

/**
 * How much of a list item's indentation a line carries: the spaces it opens
 * with, up to the indentation's width. The line is in its spaces form
 * ({@link withPrefixTabsAsSpaces}), so its indentation holds no tab.
 *
 * @param rest - The line, from where the indentation starts.
 * @param width - The indentation's width.
 * @returns The count.
 */
function carriedIndent(rest: string, width: number): number {
    let carried = 0;

    while (carried < width && rest[carried] === " ") {
        carried += 1;
    }

    return carried;
}

/**
 * The columns a tab advances to in Markdown: the next multiple of four. The
 * lexer's tab rule (`withPrefixTabsAsSpaces` in `display/markdownExtensions.ts`)
 * and source mode's Enter rule (`editor/languages.ts`) hold the same number.
 */
const MARKDOWN_TAB_STOP = 4;

/**
 * A line after a lifted block as a tail lift writes it, from what it wrote
 * for the line's spaces form: the line's own characters up to the first
 * column the lift changed, then what was written from that column on. A tab
 * of the line's container prefix at or past that column is thereby written
 * as the spaces that reach its tab stop, counted where the line stood; every
 * other character is the line's own.
 *
 * @param line - The line, as it stands in the document.
 * @param changedAt - The first column the lift changed, `-1` for none.
 * @param written - What was written for the line's spaces form.
 * @returns The line to write.
 */
function keptBytes(line: string, changedAt: number, written: string): string {
    if (changedAt === -1) {
        return line;
    }

    let column = 0;
    let index = 0;

    while (index < line.length) {
        const width = line[index] === "\t" ? MARKDOWN_TAB_STOP - (column % MARKDOWN_TAB_STOP) : 1;

        if (column + width > changedAt) {
            break;
        }

        column += width;
        index += 1;
    }

    return line.slice(0, index) + written.slice(column);
}

/**
 * Writes one line after a lifted block for a tail lift: reads the prefix
 * each container gives the line, outermost first, and writes in its place
 * what the lift leaves of that container. A quote keeps its marker. A list
 * item around the lifted block loses its indentation, except the outermost
 * one from the line it is re-opened on: there it gets its marker, and below
 * it keeps its indentation. Any other list item keeps its indentation. What
 * stands past the prefixes is the line's content and is written back byte
 * for byte. A line that carries less than a prefix (a lazy line, or a line
 * of whitespace) gives up what it carries of a prefix that is taken off.
 * The prefixes are read from the line's spaces form, in which a tab of the
 * container prefix is the spaces that reach its tab stop; the line keeps its
 * own bytes up to the first column the lift changes ({@link keptBytes}).
 *
 * @param analysis - The document's analysis.
 * @param lineStart - The line's start.
 * @param line - The line.
 * @param closed - The containers closed; updated.
 * @param indents - List item indentation already read; updated.
 * @returns The line to write, or `null` when a container that must be
 *   re-opened on the line cannot be, or a list item's indentation cannot be
 *   read (its marker not where expected).
 */
function writeLineAfterLift(
    analysis: SourceAnalysis, lineStart: number, line: string, closed: ClosedForTail, indents: Map<SourceBlockNode, ItemIndent | null>,
): LineAfterLift | null {
    const chain = containersOfLine(analysis, lineStart);
    const deepest = chain.findLastIndex((container) => closed.quotes.has(container) || closed.outermost.has(container) || closed.inner.has(container));
    const spaced = withPrefixTabsAsSpaces(line);
    const leading = leadingQuoteMarkers(chain, spaced);
    let isTail = false;
    let written = "";
    let rest = spaced;
    let changedAt = -1;

    /** The line as written so far, with what stands past the prefixes read. */
    const result = (): LineAfterLift => ({ text: keptBytes(line, changedAt, written + rest), isTail, leading });

    /** Ends the line where it stops carrying its containers' prefixes: nothing below can be re-opened on it. */
    const endLazily = (from: number): LineAfterLift | null => {
        const opens = chain.slice(from, deepest + 1).some((pending) => closed.quotes.has(pending) || closed.outermost.get(pending)?.wrapLine === lineStart);

        return opens && !isBlank(line) ? null : result();
    };

    for (const [index, container] of chain.slice(0, deepest + 1).entries()) {
        const prefix = container.type === "blockquote"
            ? quotePrefixAfterLift(container, rest, closed)
            : itemPrefixAfterLift(analysis, container, rest, lineStart, closed, indents);

        if (prefix === null) {
            return null;
        }

        if (prefix === undefined) {
            return endLazily(index);
        }

        const isChanged = changedAt === -1 && prefix.written !== rest.slice(0, prefix.length);

        if (isChanged) {
            changedAt = written.length;
        }

        written += prefix.written;
        rest = rest.slice(prefix.length);
        isTail = isTail || prefix.isTail;

        if (!prefix.isWhole) {
            return endLazily(index + 1);
        }
    }

    return result();
}

/** The prefix one container gives a line after a lifted block, with what a tail lift writes in its place. */
interface PrefixAfterLift {
    /** What is written in the prefix's place. */
    readonly written: string;
    /** How much of the line the prefix takes up. */
    readonly length:  number;
    /** Whether the line carries the whole prefix; a lazy line or a line of whitespace can stop short of a list item's. */
    readonly isWhole: boolean;
    /** Whether the prefix is a list item's indentation that the line gives up to leave the list with the lifted block. */
    readonly isTail:  boolean;
}

/**
 * A quote's prefix on a line after a lifted block: its marker, kept as the
 * line carries it. A quote the lift closed is re-opened by it.
 *
 * @param quote - The quote.
 * @param rest - The line, from where the quote's marker would start.
 * @param closed - The containers closed; updated.
 * @returns The prefix, or `undefined` when the line does not carry the marker (a lazy line, or a blank one).
 */
function quotePrefixAfterLift(quote: SourceBlockNode, rest: string, closed: ClosedForTail): PrefixAfterLift | undefined {
    const marker = QUOTE_MARKER.exec(rest)?.[0];

    if (marker === undefined) {
        return undefined;
    }

    closed.quotes.delete(quote);

    return { written: marker, length: marker.length, isWhole: true, isTail: false };
}

/**
 * A list item's prefix on a line after a lifted block: the spaces the line
 * carries of the item's indentation, and what a tail lift writes for them.
 *
 * | The item | On the line | Written |
 * |---|---|---|
 * | not around the lifted block | any | the spaces, as they are |
 * | around it, inside its outermost list item | any | nothing |
 * | its outermost list item | before the line the item is re-opened on | the replacement's `follow`, when the line holds more than the indentation; else nothing |
 * | its outermost list item | the line it is re-opened on | the item's marker |
 * | its outermost list item | after that line | the spaces, as they are (the item is no longer closed) |
 *
 * @param analysis - The document's analysis.
 * @param item - The list item.
 * @param rest - The line, from where the item's indentation starts.
 * @param lineStart - The line's start.
 * @param closed - The containers closed; updated.
 * @param indents - List item indentation already read; updated.
 * @returns The prefix, or `null` when the indentation cannot be read (the
 *   item's marker not where expected) or the item must be re-opened on a line
 *   that does not carry its whole indentation.
 */
function itemPrefixAfterLift(
    analysis: SourceAnalysis, item: SourceBlockNode, rest: string, lineStart: number, closed: ClosedForTail,
    indents: Map<SourceBlockNode, ItemIndent | null>,
): PrefixAfterLift | null {
    const indent = itemIndent(analysis, item, indents, true);

    if (indent === null) {
        return null;
    }

    const carried = carriedIndent(rest, indent.width);
    const isWhole = carried === indent.width;
    const outermost = closed.outermost.get(item);
    const isInner = closed.inner.has(item);
    const prefix = { length: carried, isWhole, isTail: false };

    if (isInner) {
        return { ...prefix, written: "" };
    }

    if (outermost === undefined) {
        return { ...prefix, written: rest.slice(0, carried) };
    }

    if (outermost.wrapLine !== lineStart) {
        return { ...prefix, isTail: true, written: isWhole && rest.length > carried ? outermost.follow : "" };
    }

    if (!isWhole) {
        return null;
    }

    closed.outermost.delete(item);

    return { ...prefix, written: indent.opener };
}

/**
 * The quotes that open a line before any list item, each with the marker the line carries for it.
 *
 * @param chain - The containers holding the line, outermost first.
 * @param line - The line.
 * @returns The quotes, outermost first, up to the first whose marker the line does not carry.
 */
function leadingQuoteMarkers(chain: readonly SourceBlockNode[], line: string): Array<{ quote: SourceBlockNode; marker: string }> {
    const leading: Array<{ quote: SourceBlockNode; marker: string }> = [];
    let rest = line;

    for (const container of chain) {
        const marker = container.type === "blockquote" ? QUOTE_MARKER.exec(rest)?.[0] : undefined;

        if (marker === undefined) {
            break;
        }

        leading.push({ quote: container, marker });
        rest = rest.slice(marker.length);
    }

    return leading;
}
```

### Candidates

`firstReadingEdit` takes candidates in place of one `build` and one `expected`.

```ts
/**
 * Tries a line command's candidates in order, and each candidate's edit in
 * its forms, in order — as written, with the lifted blocks set apart by
 * blank lines, then each with the lifted lines' opening block characters
 * escaped — and returns the first edit whose result reads as its candidate
 * expects. Every form of one candidate is tried before the next candidate,
 * so a command whose first candidate takes the lifted blocks' tails out of
 * their list items falls back to leaving them there only when no form of
 * the first reads.
 *
 * @param analysis - The document's analysis.
 * @param candidates - The ways to write the edit, the preferred one first.
 * @param wildcardPaths - For each replacement, the path its leaves must have
 *   when they are not predicted one by one, `null` when they are.
 * @param escapes - Whether the escaped forms are worth trying.
 * @returns The edit, or `null` when no form reads as expected.
 */
function firstReadingEdit(
    analysis: SourceAnalysis, candidates: readonly EditCandidate[],
    wildcardPaths: ReadonlyArray<readonly string[] | null>, escapes: boolean,
): MarkdownSourceEdit | null {
    const forms = escapes ? [[false, false], [true, false], [false, true], [true, true]] : [[false, false], [true, false]];

    for (const candidate of candidates) {
        let expected: readonly ExpectedLeaf[] | null = null;

        for (const [separate, escape] of forms) {
            const replacements = candidate.build(escape!);
            const lifted = candidate.tail ? liftLinesWithTail(analysis, replacements, separate!) : liftLines(analysis, replacements, separate!);
            const changesNothing = lifted !== null && analysis.text.slice(lifted.edit.from, lifted.edit.to) === lifted.edit.insert;

            if (lifted === null || changesNothing) {
                continue;
            }

            const wildcards = lifted.ranges.flatMap((range, index) => {
                const path = wildcardPaths[index];

                return path === null || path === undefined ? [] : [{ ...range, path }];
            });

            expected ??= candidate.expected();

            const reads = readsAsExpected(analysis.text, lifted.edit, expected, wildcards, candidate.tail);

            if (reads) {
                const { ranges } = lifted;

                return { ...lifted.edit, selection: { from: ranges[0]!.from, to: ranges[ranges.length - 1]!.to } };
            }
        }
    }

    return null;
}

/** One way a line command's edit is written, with what its result must read as. */
interface EditCandidate {
    /** Builds the replacements, given whether to escape. */
    readonly build:    (escape: boolean) => LineReplacement[];
    /** Reads the leaves the result must read as; called when the candidate is first tried. */
    readonly expected: () => readonly ExpectedLeaf[];
    /** Whether the lifted blocks' tails leave their list items ({@link liftLinesWithTail}) or stay in them ({@link liftLines}). */
    readonly tail:     boolean;
}

/**
 * The lifts of a command whose lifted blocks' tails stand outside every list.
 *
 * @param analysis - The document's analysis.
 * @param targets - The lifted blocks.
 * @returns The plan, or `null` when no target stands in a list item: no tail leaves a list then.
 */
function tailLifts(analysis: SourceAnalysis, targets: readonly SourceBlockNode[]): LiftPlan | null {
    const hasListItem = targets.some((target) => liftedItems(target).length > 0);

    return hasListItem ? planLifts(analysis, targets.map((node) => ({ node, into: [], intoId: "" }))) : null;
}
```

### The commands

`convertBlocks`, `FENCED_CODE_SOURCE` and `listOff` build two candidates from the replacements they build already. Their bodies up to the expected leaves are unchanged.

```ts
/**
 * Converts the blocks a selection touches (see {@link readLineTargets}) to the
 * block `prefix` writes — a paragraph for `""`, a quote for `"> "`, a heading
 * for `"#".repeat(level) + " "` — lifting each out of its quotes and list
 * items (see {@link liftLinesWithTail} and {@link liftLines}). A block already of that kind at the top
 * level is left alone; a heading is written one line per line of text. A
 * task item's marker is carried as the text it shows (`\[x\] `).
 *
 * @param text - The full document text.
 * @param from - 0-based start of the raw selection.
 * @param to - 0-based end (exclusive) of the raw selection.
 * @param prefix - The block prefix.
 * @returns The edit, or `null` when the command declines.
 */
function convertBlocks(text: string, from: number, to: number, prefix: string): MarkdownSourceEdit | null {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);
    const targets = selection?.targets.filter((target) => !alreadyBlock(target, prefix)) ?? [];

    if (targets.length === 0) {
        return null;
    }

    const kind = prefix === "" ? ["p"] : prefix === "> " ? ["quote", "p"] : [`h${prefix.trim().length}`];
    const targetOf = targetOfEntry(targets);
    const code = targets.map((target) => target.type === "code");
    const leaves = readLeaves(analysis);

    const change = (leaf: LeafView): ExpectedLeaf | readonly ExpectedLeaf[] | null | undefined => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        if (code[index]!) {
            return undefined;
        }

        const line = prefix.startsWith("#") ? `:${lineStartAt(text, leaf.offset)}` : "";
        const path = [...columnPath(leaf.path), ...kind];

        return markerTextLeaves(leaf, path, `t${index}${line}`) ?? { key: leaf.key, path, group: `t${index}${line}` };
    };

    const lifts = tailLifts(analysis, targets);

    const build = (escape: boolean): LineReplacement[] => targets.map((target, index) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => {
            const written = isBlank(line) || prefix === "" ? line : prefix + line.trimStart();

            return escape && !code[index]! && !isBlank(line) ? escapeBlockStart(written, prefix) : written;
        }),
        nodes: [target],
    }));
    // A code block's code becomes Markdown, read afresh: only the kind of block it lands in is predicted.
    const wildcardPaths = targets.map((target, index) => {
        const own = leaves.find((leaf) => leaf.entry === target.entryStart);

        return code[index]! && own !== undefined ? [...columnPath(own.path), ...kind] : null;
    });

    const candidates: EditCandidate[] = [
        ...(lifts === null ? [] : [{ build, expected: () => expectLeaves(leaves, change, lifts), tail: true }]),
        { build, expected: () => expectLeaves(leaves, change), tail: false },
    ];

    return firstReadingEdit(analysis, candidates, wildcardPaths, true);
}

/**
 * Converts the blocks the selection's lines touch into one fenced code block:
 * from the first block's first line to the last block's last line, every line
 * a converted block's or blank, each block's text taken as written (a code
 * block's code, its fences dropped, a task item's marker as it was written),
 * the blocks lifted out of their quotes and list items as
 * {@link blockPrefixSource} lifts them. The fence is three
 * backticks, or one more than the longest run opening a code line. The result
 * must read as that code block with nothing else changed, the block set apart
 * by blank lines when it does not otherwise. Declines when the lines already
 * are exactly that block, when a line between the blocks holds anything else,
 * and when a selected line holds part of any other block.
 */
export const FENCED_CODE_SOURCE: MarkdownSourceTransform = (text, from, to) => {
    const analysis = analyzeMarkdownSource(text);
    const selection = readLineTargets(analysis, from, to, true);

    if (selection === null) {
        return null;
    }

    const { targets } = selection;
    const code = fencedContent(text, targets);

    if (code === null) {
        return null;
    }

    const fence = "`".repeat(Math.max(MIN_FENCE_LENGTH, longestOpeningBacktickRun(code) + 1));
    const targetOf = targetOfEntry(targets);
    const leaves = readLeaves(analysis);

    /** Reads the expected leaves, with or without the tails lifted. */
    const expect = (lifts: LiftPlan | null): ExpectedLeaf[] => {
        let placed = false;

        return expectLeaves(leaves, (leaf) => {
            if (targetOf(leaf.entry) === -1) {
                return null;
            }

            if (placed) {
                return undefined;
            }

            placed = true;

            return { key: `code::${code.join("\n")}`.replace(/\n+$/, ""), path: columnPath(leaf.path), group: "fence" };
        }, lifts);
    };

    const lifts = tailLifts(analysis, targets);

    const replacement: LineReplacement = {
        first: lineStartAt(text, targets[0]!.start),
        last:  lineEndAt(text, targets[targets.length - 1]!.end - 1),
        lines: [fence, ...code, fence],
        nodes: targets,
    };

    const candidates: EditCandidate[] = [
        ...(lifts === null ? [] : [{ build: () => [replacement], expected: () => expect(lifts), tail: true }]),
        { build: () => [replacement], expected: () => expect(null), tail: false },
    ];

    return firstReadingEdit(analysis, candidates, [null], false);
};

/**
 * Lifts list item texts out of their items as paragraphs, a task item's
 * marker as the text it shows.
 *
 * @param analysis - The document's analysis.
 * @param targets - The item texts.
 * @returns The edit, or `null` when no form reads as intended.
 */
function listOff(analysis: SourceAnalysis, targets: readonly SourceBlockNode[]): MarkdownSourceEdit | null {
    const text = analysis.text;
    const targetOf = targetOfEntry(targets);
    const leaves = readLeaves(analysis);

    const change = (leaf: LeafView): ExpectedLeaf | readonly ExpectedLeaf[] | null => {
        const index = targetOf(leaf.entry);

        if (index === -1) {
            return null;
        }

        const path = [...columnPath(leaf.path), "p"];

        return markerTextLeaves(leaf, path, `t${index}`) ?? { key: leaf.key, path, group: `t${index}` };
    };

    const lifts = tailLifts(analysis, targets);

    const build = (escape: boolean): LineReplacement[] => targets.map((target) => ({
        first: lineStartAt(text, target.start),
        last:  lineEndAt(text, target.end - 1),
        lines: textLinesOf(target, "text").map((line) => (escape && !isBlank(line) ? escapeBlockStart(line, "") : line)),
        nodes: [target],
    }));

    const candidates: EditCandidate[] = [
        ...(lifts === null ? [] : [{ build, expected: () => expectLeaves(leaves, change, lifts), tail: true }]),
        { build, expected: () => expectLeaves(leaves, change), tail: false },
    ];

    return firstReadingEdit(analysis, candidates, targets.map(() => null), true);
}
```

`listOn` builds four candidates: the new items joined and written apart, each with the tail under the last new item and with the tail left in the list.

```ts
/**
 * Turns selected lines into list items of `kind`: in each block, every
 * selected line that is not already the marker line of a `kind` item becomes
 * a new top-level item; the block's lines below the selection continue the
 * last new item, and its lines above the first new item stay where they are.
 * The new items of blocks with only blank lines between them are one run
 * ({@link adjoiningRuns}), written line after line and joined to the list of
 * `kind` next to them ({@link readListJoin}). When no form of that edit
 * reads as intended, the items are written as a list of their own, each
 * block's where it stands ({@link itemsApart}), and that edit is checked the
 * same way. Both are tried first with what each block's list item held after
 * it as the blocks of the block's last new item, and then with that left in
 * the list.
 *
 * @param analysis - The document's analysis.
 * @param targets - The blocks the selection touches.
 * @param selected - The selected lines' starts.
 * @param kind - The list kind.
 * @returns The edit, or `null` when nothing changes or no form reads as intended.
 */
function listOn(analysis: SourceAnalysis, targets: readonly SourceBlockNode[], selected: ReadonlySet<number>, kind: "unordered" | "ordered"): MarkdownSourceEdit | null {
    const text = analysis.text;
    const plans: ListPlan[] = targets.map((target) => {
        const lines = nodeLines(text, target);
        const converted = lines.map((line) => selected.has(line.start) && !isMarkerLine(text, target, line.start, kind));

        return { target, lines, converted, first: converted.indexOf(true) };
    }).filter((plan) => plan.first !== -1);

    if (plans.length === 0) {
        return null;
    }

    const runs = adjoiningRuns(text, plans);
    const hasListItem = plans.some((plan) => liftedItems(plan.target).length > 0);
    const candidates: EditCandidate[] = [];

    // A list that gains an item below it no longer ends where it did, and what its last line read as can change
    // with that (trailing whitespace there, an indented code block, a fence left open). The items then stand apart.
    for (const tail of hasListItem ? [true, false] : [false]) {
        let leaves: ExpectedLeaf[] | null = null;
        /** Reads the expected leaves once for the two candidates that share them. */
        const expected = (): ExpectedLeaf[] => (leaves ??= expectedItemLeaves(analysis, plans, kind, tail));

        candidates.push({ build: () => runs.map((run) => itemReplacement(text, run, kind, readListJoin(analysis, run, kind, tail), tail)), expected, tail });
        candidates.push({ build: () => itemsApart(text, plans, kind, tail), expected, tail });
    }

    // Every candidate writes one replacement per run or per block; none predicts leaves by a wildcard.
    return firstReadingEdit(analysis, candidates, [], false);
}

/**
 * Whether a block's tail goes into the new item made of the block: it does
 * unless a quote holds the block's outermost list item, since the new item
 * stands outside that quote and the tail keeps it.
 *
 * @param target - The block.
 * @returns Whether it does.
 */
function tailGoesIntoItem(target: SourceBlockNode): boolean {
    const containers = liftedContainers(target) ?? [];

    return containers[0]?.type === "list_item";
}

/**
 * The start of the last line a block's new items take up when its tail goes
 * into the last of them: the block's own last line, or the last line of its
 * outermost list item when no list item follows the block in there
 * ({@link wrapperItemAfter}).
 *
 * @param text - The full document text.
 * @param plan - The block.
 * @returns The line's start.
 */
function lastLineOfNewItems(text: string, plan: ListPlan): number {
    const ownLast = plan.lines[plan.lines.length - 1]!.start;
    const outermost = liftedItems(plan.target)[0];
    const wrapper = wrapperItemAfter(plan.target);

    return outermost === undefined || wrapper !== null || !tailGoesIntoItem(plan.target) ? ownLast : Math.max(ownLast, lineStartAt(text, outermost.end - 1));
}

/**
 * The leaves a list-on edit's result must read as: every leaf of a converted
 * line in a new item of `kind` at its column's top level, one item per
 * converted line, the item made from a task item's marker line still a task
 * item.
 *
 * @param analysis - The document's analysis.
 * @param plans - The touched blocks.
 * @param kind - The list kind.
 * @param tail - Whether what follows a block in its list items leaves them with it: it then stands in the last item made from the block.
 * @returns The expected leaves.
 */
function expectedItemLeaves(analysis: SourceAnalysis, plans: readonly ListPlan[], kind: "unordered" | "ordered", tail: boolean): ExpectedLeaf[] {
    const list = `list:${String(kind === "ordered")}`;
    /** The signature of the item made from a block's converted line: only the one from its first line carries the marker that line opens with. */
    const itemOf = (plan: ListPlan, line: number): string => (line === 0 && taskMarkerOf(plan.target) !== null ? itemSignature(plan.target.parent!) : "item:false:false");

    // What follows a block in its list items goes into the last item made from the block.
    const lifts = !tail ? null : planLifts(analysis, plans.map((plan, index) => {
        const last = plan.converted.lastIndexOf(true);
        const goesIn = tailGoesIntoItem(plan.target);

        return { node: plan.target, into: goesIn ? [list, itemOf(plan, last)] : [], intoId: goesIn ? `n${index}:${last}` : "" };
    }));

    return expectLeaves(readLeaves(analysis), (leaf) => {
        const index = plans.findIndex((plan) => firstEntryOf(plan.target) <= leaf.entry && leaf.entry < plan.target.entryEnd);

        if (index === -1) {
            return null;
        }

        const plan = plans[index]!;
        const line = plan.lines.findIndex((candidate) => candidate.start <= leaf.offset && leaf.offset <= candidate.end);
        const group = plan.converted.lastIndexOf(true, line);

        if (line < plan.first) {
            return null;
        }

        const column = columnPath(leaf.path);
        const path = [...column, list, itemOf(plan, group)];
        const holders = [...column.map(() => ""), "", `n${index}:${group}`];

        return TASK_MARKER_LEAF.test(leaf.key)
            ? { key: leaf.key, path, group: `t${index}:${group}:marker`, holders }
            : { key: leaf.key, path: [...path, "p"], group: `t${index}:${group}`, holders: [...holders, ""] };
    }, lifts);
}
```

`readListJoin`, `itemReplacement` and `itemsApart` each gain the parameter `tail`.

| Function | Change |
|---|---|
| `readListJoin(analysis, run, kind, tail: boolean)` | `const lastLine = tail ? lastLineOfNewItems(text, last) : last.lines[last.lines.length - 1]!.start;` in place of the `lastLine` line. With the tail under the last new item, the list below is looked for after the tail |
| `itemReplacement(text, run, kind, join, tail: boolean)` | as below |
| `itemsApart(text, plans, kind, tail: boolean)` | passes `tail` on as the last argument of its `itemReplacement` call |

```ts
/**
 * Writes one run's converted lines as items, in one replacement.
 *
 * @param text - The full document text.
 * @param run - The run's blocks, in document order.
 * @param kind - The list kind.
 * @param join - The lists the items join, and the marker they are written with.
 * @param tail - Whether what follows the run's last block in its list items becomes the blocks of the last new item.
 * @returns The replacement.
 */
function itemReplacement(text: string, run: readonly ListPlan[], kind: "unordered" | "ordered", join: ListJoin, tail: boolean): LineReplacement {
    let number = join.start;
    let follow = "";

    const lines = run.flatMap(({ target, converted, first }) => textLinesOf(target, "written").slice(first).map((line, offset) => {
        if (!converted[first + offset]!) {
            return line;
        }

        const marker = kind === "unordered" ? join.bullet : `${number}${join.delimiter}`;

        number += 1;
        // What the block's item holds after it goes into the last new item, at the column that item's text starts at.
        follow = tail && tailGoesIntoItem(target) ? " ".repeat(marker.length + 1) : "";

        return `${marker} ${line.trimStart()}`;
    }));

    return { ...replacedLines(text, run, join), lines, nodes: run.map((plan) => plan.target), follow };
}
```

### Comments

The module's opening comment and the JSDoc of `blockPrefixSource`, `FENCED_CODE_SOURCE` and `listSource` describe the lift. Change each as follows; leave the rest of each comment as it is.

| Where | Text now | Text after |
|---|---|---|
| the module's opening comment | "and splits those containers around it: what follows the block inside them stays in them, each container re-opened by its own marker on its first line after the block." | "and splits those containers around it. What follows the block in its list items, up to the next list item, leaves the list with it; from that item on, what follows stays in the list, in one item the outermost list item's marker re-opens. A quote keeps what follows inside it. A tab in the indentation of a line that moves is written as the spaces it stood for." |
| the same comment, its last sentence | "otherwise the command tries the same edit with the lifted blocks set apart by blank lines and with their first character escaped, and declines when no form reads back as intended." | "otherwise the command tries the same edit with the lifted blocks set apart by blank lines and with their first character escaped, then the same forms with what followed the blocks left in their list items, and declines when no form reads back as intended." |
| `blockPrefixSource` | "those containers split around it: what follows it inside them stays in them, re-opened by their own marker (`- x\n  - a\n  - b`, `a` to a heading, gives `- x\n## a\n- - b`)." | "those containers split around it. What follows it in its list items up to the next list item leaves the list with it (`- a\n\n  b`, `a` to a heading, gives `## a\n\nb`); from that item on, what follows stays in the list (`- x\n  - a\n  - b`, `a` to a heading, gives `- x\n## a\n- - b`). Where what follows would read otherwise outside the list, it is left in the list, re-opened by the item's marker." |
| `FENCED_CODE_SOURCE` | "the blocks lifted out of their quotes and list items as {@link blockPrefixSource} lifts them." | unchanged: the reference covers it |
| `listSource` | "otherwise each selected line that is not yet such a marker line becomes a new top-level item, a block's lines below the selection continuing the last new item." | the same sentence, with this added: "What the block's list item held after it, up to the next list item, becomes the blocks of the last new item." |
| `liftLines` | first sentence of its JSDoc | add before it: "The base form of a lift: what follows a lifted block stays in its containers. {@link liftLinesWithTail} is the form tried first." |

---

## Ordered Implementation Steps

Run every command from `packages/lib`. Never run `npm install`, `npm ci` or `npm update`. The scratch folder is `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans4/lift-revision/`. It holds the measured module (`proto/markdownSourceLines.ts`), the two test files with this plan's changes (`proto/markdown-editor.test.ts`, `proto/markdown-source-edits.test.ts`), the same changes as a diff against the files as `markdown-tab-column-parity` leaves them (`proto/tests.diff`), and the probes of step 8. Use the files to check your edits against, not in place of them: the plans of `depends-on` may have changed lines around them. The folder is not in the repository.

0. **Check the `marked` version and the tab plan.** `node -p "require('marked/package.json').version"` prints `18.1.0`, and `grep -n "export function withPrefixTabsAsSpaces" src/typescript/lib/component/display/markdownExtensions.ts` finds the function `markdown-tab-column-parity` adds. If either does not hold, stop and report: every expectation below was measured with both.

1. **Check the base.** `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts` is green. `git diff 736452bbc -- src/typescript/lib/component/editor/markdownSourceLines.ts` shows what the plans of `depends-on` changed in the module: on the measured base that is one comment line, which `marked-upgrade` shortens. If `liftLines`, `reopenContainers`, `containerPrefix`, `itemIndent`, `firstReadingEdit`, `expectLeaves`, `readsAsExpected`, `convertBlocks`, `FENCED_CODE_SOURCE`, `listOff`, `listOn`, `expectedItemLeaves`, `readListJoin`, `itemReplacement` or `itemsApart` differ from `736452bbc`, stop and report: the code of this plan was measured against those bodies.

2. **Change the parity rows** in `tests/component/markdown-editor.test.ts`, as `### Parity rows` says: move 84 rows from `DIFFERS` to `SAME` with their new source-mode text, move `E38`, add 6 `SAME` rows, delete 8 `DIFFERS` rows whose documents move to the source-mode rows, restate 2 `DIFFERS` rows, add 2, delete four comments of the `DIFFERS` table, and change three.

3. **Change the source-mode rows** in the same file, as `### Source-mode rows` says: restate 3 rows of the `CASES` table, add 21, and add one row to the wiring table.

4. **Change the transform tests** in `tests/component/markdown-source-edits.test.ts`, as `### Transform tests` says.

5. **See the rows fail.** `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-source-edits.test.ts`. Exactly 123 tests fail: 91 `SAME` rows (the 84, `E38` and the 6 new), `T20 h2` and `M33 h2` of `DIFFERS`, 23 rows of the `CASES` table, the wiring row, and 6 tests of `markdown-source-edits.test.ts`. `### What is red before the code` lists them. The rows `E39`, `E40`, the `CASES` row `a code fence left open stays in its list item, where the item closes it` and the test `leaves what a list item holds in the list where it would read otherwise outside it` are green: they pin what stays. If another test fails, or one of these does not, stop and report.

6. **Change `markdownSourceLines.ts`**, in this order, each as `## Internal Structure` gives it:
   1. the two `holders` fields and the four edits of `readLeaves`;
   2. `readsAsExpected` and `sameHolders`;
   3. `expectLeaves` and the declarations that follow it in that code block, placed between `expectLeaves` and the comment line `// ---- reading the selection`;
   4. the `follow` field of `LineReplacement`;
   5. the import of `withPrefixTabsAsSpaces`, the `tabStops` parameter of `containerPrefix` and `itemIndent`, and the tail lift, after `liftLines`;
   6. `firstReadingEdit`, `EditCandidate`, `tailLifts`;
   7. `convertBlocks`, `FENCED_CODE_SOURCE`, `listOff`;
   8. `listOn`, `tailGoesIntoItem`, `lastLineOfNewItems`, `expectedItemLeaves`, and the `tail` parameter of `readListJoin`, `itemReplacement`, `itemsApart`;
   9. the comments.

   Check: `npm run typecheck` is clean. `grep -n "firstReadingEdit(" src/typescript/lib/component/editor/markdownSourceLines.ts` gives five lines: the definition and four calls. `grep -c "liftLinesWithTail" src/typescript/lib/component/editor/markdownSourceLines.ts` is at least 3. `grep -n "tabStops)" src/typescript/lib/component/editor/markdownSourceLines.ts` gives three lines: the two calls inside `itemIndent` and the one inside `containerPrefix`. `git diff --stat` names no file under `src/` but `markdownSourceLines.ts`.

7. **See the rows pass.** The command of step 5 is green: 1,242 tests in the two files when only this plan's rows were added to what `markdown-tab-column-parity` left, 26 more than its 1,216 (the count is higher by whatever the other plans added).

8. **Run the differential check** of `## Verification`. Every hard check is 0.

9. **Docs and changelog**, as `## Documentation Impact` says.

10. **Full checks.** `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

11. **Manual checks**, as `### Manual checks` says.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-source-edits.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Everything here is unit-testable but `### Manual checks`.

### Parity rows

A row is `[id, document, word the selection starts in, word it ends in or null, command, what the WYSIWYG surface saves, what source mode leaves]`. Each row was run on both surfaces with the module of this plan, the code of `markdown-tab-column-parity` and `marked` 18.1.0 in place.

**Rows that leave `DIFFERS` for `SAME`.** Delete from `DIFFERS` every row with one of these ids, but `T20 h2` and `M33 h2`, which stay and are restated below. Five of the deleted rows (`T20 UL`, `T20 OL`, `E30 UL`, `E30 h2`, `E34 UL`) go to neither table but to the source-mode rows of `### Source-mode rows`:

`T9 T14 T16 T19 T20 T21 X23 X24 X25 S6 M1 M6 M7 M8 M10 M12 M13 M14 M15 M17 M18 M20 M22 M24 M25 M26 M27 M28 M30 M31 M32 M33 M34 M35 M36 M37 C3 E30 E34 E38`

Delete also the three `DIFFERS` rows `E19 UL` (`'-\tone\n\n\tsecond\n- two'`), `E24 UL` and `E24 h2`. Their documents move to the source-mode rows too.

Append these 85 rows to `SAME`, directly after the row `E37`, the last row `markdown-tab-column-parity` leaves there. Only the last element of each differs from the row deleted.

```ts
        // What a list item holds after a lifted block leaves the list with the block, on both surfaces.
        ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'UL', '\\[ \\] one\n\n- - inner\n- three', '\\[ \\] one\n- - inner\n- three'],
        ['T9', '- [ ] one\n  - inner\n- three', 'one', null, 'OL', '1. [ ] one\n\n- - inner\n- three', '1. [ ] one\n- - inner\n- three'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'UL', '\\[ \\] one\n\nsecond\n\n- [x] two', '\\[ \\] one\n\nsecond\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'OL', '1. [ ] one\n\n   second\n\n- [x] two', '1. [ ] one\n\n   second\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'h2', '## \\[ \\] one\n\nsecond\n\n- [x] two', '## \\[ \\] one\n\nsecond\n\n- [x] two'],
        ['T14', '- [ ] one\n\n  second\n\n- [x] two', 'one', null, 'code', '```\n[ ] one\n```\n\nsecond\n\n- [x] two', '```\n[ ] one\n```\n\nsecond\n\n- [x] two'],
        ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'UL', '\\[x\\] one\n\n- - [ ] inner\n- two', '\\[x\\] one\n- - [ ] inner\n- two'],
        ['T16', '- [x] one\n  - [ ] inner\n- two', 'one', null, 'OL', '1. [x] one\n\n- - [ ] inner\n- two', '1. [x] one\n- - [ ] inner\n- two'],
        ['X23', '* one\n\n* two\n\n  held\n\n1) three\n\nlast', 'two', null, 'OL', '* one\n\n1) two\n\n   held\n\n2) three\n\nlast', '* one\n\n1) two\n\n   held\n\n1) three\n\nlast'],
        ['X24', '1. one\n\n   held\n\n* two\n* three', 'one', null, 'UL', '* one\n\n  held\n\n* two\n\n* three', '* one\n\n  held\n\n* two\n* three'],
        ['X25', 'zero\n\n1. one\n\n   held\n\n* two', 'zero', 'one', 'UL', '* zero\n\n* one\n\n  held\n\n* two', '* zero\n* one\n\n  held\n\n* two'],
        ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'UL', '- o\n  - m\n\nx\n\n- - n\n  - y\n  - k', '- o\n  - m\n\nx\n\n- - n\n  - y\n  - k'],
        ['S6', '- o\n  - m\n    - x\n      - n\n    - y\n  - k', 'x', null, 'OL', '- o\n  - m\n\n1. x\n\n- - n\n  - y\n  - k', '- o\n  - m\n1. x\n- - n\n  - y\n  - k'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- two', 'one\n\nsecond\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- two', '1. one\n\n   second\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'paragraph', 'one\n\nsecond\n\n- two', 'one\n\nsecond\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- two', '## one\n\nsecond\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'quote', '> one\n\nsecond\n\n- two', '> one\n\nsecond\n\n- two'],
        ['M1', '- one\n\n  second\n\n- two', 'one', null, 'code', '```\none\n```\n\nsecond\n\n- two', '```\none\n```\n\nsecond\n\n- two'],
        ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'UL', '- one\n\n- second\n\n  third\n\n- two', '- one\n\n- second\n\n  third\n\n- two'],
        ['M6', '- one\n\n  second\n\n  third\n\n- two', 'second', null, 'OL', '- one\n\n1. second\n\n   third\n\n- two', '- one\n\n1. second\n\n   third\n\n- two'],
        ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\nthird\n\n- two', 'one\n\nsecond\n\nthird\n\n- two'],
        ['M7', '- one\n\n  second\n\n  third\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n   third\n\n- two', '1. one\n\n   second\n\n   third\n\n- two'],
        ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'UL', '- one\n\n  second\n\n1. two', '- one\n\n  second\n\n2. two'],
        ['M8', '1. one\n\n   second\n\n2. two', 'one', null, 'OL', 'one\n\nsecond\n\n1. two', 'one\n\nsecond\n\n2. two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'UL', 'one\n\n> quoted\n\n- two', 'one\n\n> quoted\n\n- two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'OL', '1. one\n\n   > quoted\n\n- two', '1. one\n\n   > quoted\n\n- two'],
        ['M10', '- one\n\n  > quoted\n\n- two', 'one', null, 'h2', '## one\n\n> quoted\n\n- two', '## one\n\n> quoted\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'UL', 'one\n\n| h |\n| --- |\n| c |\n\n- two', 'one\n\n| h |\n| --- |\n| c |\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'OL', '1. one\n\n   | h |\n   | --- |\n   | c |\n\n- two', '1. one\n\n   | h |\n   | --- |\n   | c |\n\n- two'],
        ['M12', '- one\n\n  | h |\n  | --- |\n  | c |\n\n- two', 'one', null, 'h2', '## one\n\n| h |\n| --- |\n| c |\n\n- two', '## one\n\n| h |\n| --- |\n| c |\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n::: {align=center}\nfenced\n:::\n\n- two', 'one\n\n::: {align=center}\nfenced\n:::\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   ::: {align=center}\n   fenced\n   :::\n\n- two', '1. one\n\n   ::: {align=center}\n   fenced\n   :::\n\n- two'],
        ['M13', '- one\n\n  ::: {align=center}\n  fenced\n  :::\n\n- two', 'one', null, 'h2', '## one\n\n::: {align=center}\nfenced\n:::\n\n- two', '## one\n\n::: {align=center}\nfenced\n:::\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'UL', 'one\n\n<div>x</div>\n\n- two', 'one\n\n<div>x</div>\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'OL', '1. one\n\n   <div>x</div>\n\n- two', '1. one\n\n   <div>x</div>\n\n- two'],
        ['M14', '- one\n\n  <div>x</div>\n\n- two', 'one', null, 'h2', '## one\n\n<div>x</div>\n\n- two', '## one\n\n<div>x</div>\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\ncode\n```\n\n- two', 'one\n\n```\ncode\n```\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n   ```\n   code\n   ```\n\n- two', '1. one\n\n   ```\n   code\n   ```\n\n- two'],
        ['M15', '- one\n\n  ```\n  code\n  ```\n\n- two', 'one', null, 'h2', '## one\n\n```\ncode\n```\n\n- two', '## one\n\n```\ncode\n```\n\n- two'],
        ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'UL', 'Foo\n\npara\n\n- bar', 'Foo\n\npara\n\n- bar'],
        ['M17', '- # Foo\n\n  para\n\n- bar', 'Foo', null, 'OL', '1. Foo\n\n   para\n\n- bar', '1. Foo\n\n   para\n\n- bar'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'UL', 'one\n\nsecond\n\n- - inner\n\n  after\n\n- two', 'one\n\nsecond\n\n- - inner\n\n  after\n\n- two'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'OL', '1. one\n\n   second\n\n- - inner\n\n  after\n\n- two', '1. one\n\n   second\n\n- - inner\n\n  after\n\n- two'],
        ['M18', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'one', null, 'h2', '## one\n\nsecond\n\n- - inner\n\n  after\n\n- two', '## one\n\nsecond\n\n- - inner\n\n  after\n\n- two'],
        ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'UL', '- one\n\n  second\n\ninner\n\nafter\n\n- two', '- one\n\n  second\n\ninner\n\nafter\n\n- two'],
        ['M20', '- one\n\n  second\n\n  - inner\n\n  after\n\n- two', 'inner', null, 'OL', '- one\n\n  second\n\n1. inner\n\n   after\n\n- two', '- one\n\n  second\n\n1. inner\n\n   after\n\n- two'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'UL', '- a\n\nb\n\nc\n\n- d', '- a\n\nb\n\nc\n\n- d'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'OL', '- a\n\n1. b\n\n   c\n\n- d', '- a\n1. b\n\n   c\n\n- d'],
        ['M22', '- a\n  - b\n\n  c\n\n- d', 'b', null, 'h2', '- a\n\n## b\n\nc\n\n- d', '- a\n## b\n\nc\n\n- d'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'UL', '- o\n\nx\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n\nx\n\n- - n\n  - y\n\n  t\n\n- z'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n1. x\n- - n\n  - y\n\n  t\n\n- z'],
        ['M24', '- o\n  - x\n    - n\n  - y\n\n  t\n\n- z', 'x', null, 'h2', '- o\n\n## x\n\n- - n\n  - y\n\n  t\n\n- z', '- o\n## x\n- - n\n  - y\n\n  t\n\n- z'],
        ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'UL', '- o\n\nx\n\np\n\n- - y\n- z', '- o\n\nx\n\np\n\n- - y\n- z'],
        ['M25', '- o\n  - x\n\n    p\n\n  - y\n- z', 'x', null, 'OL', '- o\n\n1. x\n\n   p\n\n- - y\n- z', '- o\n1. x\n\n   p\n\n- - y\n- z'],
        ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n- two', 'one\n\n> q\n\n| h |\n| --- |\n| c |\n\n::: {align=center}\nf\n:::\n\n- two'],
        ['M26', '- one\n\n  > q\n\n  | h |\n  | --- |\n  | c |\n\n  ::: {align=center}\n  f\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n- two', '1. one\n\n   > q\n\n   | h |\n   | --- |\n   | c |\n\n   ::: {align=center}\n   f\n   :::\n\n- two'],
        ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'UL', 'one\n\n---\n\n- two', 'one\n\n---\n\n- two'],
        ['M27', '- one\n\n  ---\n\n- two', 'one', null, 'OL', '1. one\n\n   ---\n\n- two', '1. one\n\n   ---\n\n- two'],
        ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'UL', '- one\n\n  second\n\n10. two', '- one\n\n  second\n\n11. two'],
        ['M28', '10. one\n\n    second\n\n11. two', 'one', null, 'OL', 'one\n\nsecond\n\n10. two', 'one\n\nsecond\n\n11. two'],
        ['M30', '1. one\n   - two\n\n     held\n2. three', 'two', null, 'UL', '1. one\n\ntwo\n\nheld\n\n1. three', '1. one\n\ntwo\n\nheld\n\n2. three'],
        ['M30', '1. one\n   - two\n\n     held\n2. three', 'two', null, 'h2', '1. one\n\n## two\n\nheld\n\n1. three', '1. one\n\n## two\n\nheld\n\n2. three'],
        ['M31', '- one\n\n  ```\n  aa\n    \n  bb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\naa\n  \nbb\n```\n\n- two', 'one\n\n```\naa\n  \nbb\n```\n\n- two'],
        ['M31', '- one\n\n  ```\n  aa\n    \n  bb\n  ```\n\n- two', 'one', null, 'OL', '1. one\n\n   ```\n   aa\n     \n   bb\n   ```\n\n- two', '1. one\n\n   ```\n   aa\n     \n   bb\n   ```\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'UL', 'one\n\n::: {align=center}\n- x\n:::\n\n- two', 'one\n\n::: {align=center}\n- x\n:::\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'OL', '1. one\n\n   ::: {align=center}\n   - x\n   :::\n\n- two', '1. one\n\n   ::: {align=center}\n   - x\n   :::\n\n- two'],
        ['M32', '- one\n\n  ::: {align=center}\n  - x\n  :::\n\n- two', 'one', null, 'h2', '## one\n\n::: {align=center}\n- x\n:::\n\n- two', '## one\n\n::: {align=center}\n- x\n:::\n\n- two'],
        ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'UL', '::: columns\none\n\nsecond\n\n- two\n|||\nRight\n:::', '::: columns\none\n\nsecond\n\n- two\n|||\nRight\n:::'],
        ['C3', '::: columns\n- one\n\n  second\n\n- two\n|||\nRight\n:::', 'one', null, 'OL', '::: columns\n1. one\n\n   second\n\n- two\n|||\nRight\n:::', '::: columns\n1. one\n\n   second\n\n- two\n|||\nRight\n:::'],
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'UL', '- [x] alpha\n\nbeta\n\n- - gamma\n- delta', '- [x] alpha\n\nbeta\n\n- - gamma\n- delta'],
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'OL', '- [x] alpha\n\n1. beta\n\n- - gamma\n- delta', '- [x] alpha\n1. beta\n- - gamma\n- delta'],
        ['T19', '- [x] alpha\n  - beta\n  - gamma\n- delta', 'beta', null, 'h2', '- [x] alpha\n\n## beta\n\n- - gamma\n- delta', '- [x] alpha\n## beta\n- - gamma\n- delta'],
        ['T21', '- [ ] a\n  - b\n\n    held\n- c', 'b', null, 'UL', '- [ ] a\n\nb\n\nheld\n\n- c', '- [ ] a\n\nb\n\nheld\n\n- c'],
        ['T21', '- [ ] a\n  - b\n\n    held\n- c', 'b', null, 'h2', '- [ ] a\n\n## b\n\nheld\n\n- c', '- [ ] a\n## b\n\nheld\n- c'],
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'UL', '- one\n\n- para\n\n  ---\n\n- two', '- one\n\n- para\n\n  ---\n\n- two'],
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'OL', '- one\n\n1. para\n\n   ---\n\n- two', '- one\n\n1. para\n\n   ---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'UL', '- one\n\ninner\n\n---\n\n- two', '- one\n\ninner\n\n---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'OL', '- one\n\n1. inner\n\n   ---\n\n- two', '- one\n1. inner\n\n   ---\n\n- two'],
        ['M34', '- one\n  - inner\n\n  ---\n\n- two', 'inner', null, 'h2', '- one\n\n## inner\n\n---\n\n- two', '- one\n## inner\n\n---\n\n- two'],
        ['M35', '* one\n\n  ***\n\n* two', 'one', null, 'UL', 'one\n\n***\n\n* two', 'one\n\n***\n\n* two'],
        ['M35', '* one\n\n  ***\n\n* two', 'one', null, 'h2', '## one\n\n***\n\n* two', '## one\n\n***\n\n* two'],
        ['M36', '- one\n\n  ***\n\n- two', 'one', null, 'UL', 'one\n\n***\n\n- two', 'one\n\n***\n\n- two'],
        ['M37', '- one\n\n  mid\n\n  ---\n\n- two', 'one', null, 'UL', 'one\n\nmid\n\n---\n\n- two', 'one\n\nmid\n\n---\n\n- two'],
        ['E38', '- one\n\n  ```\n  a\tb\n  ```\n\n- two', 'one', null, 'UL', 'one\n\n```\na\tb\n```\n\n- two', 'one\n\n```\na\tb\n```\n\n- two'],
```

**New `SAME` rows**, appended after them. They pin what the moved rows do not: two blocks in a tail under the fence and the quote commands, a range over two items that each hold a block, and an escape that must stay.

```ts
        ['F1', '- one\n\n  ```\n  code\n  ```\n\n  after\n\n- two', 'one', null, 'code', '```\none\n```\n\n```\ncode\n```\n\nafter\n\n- two', '```\none\n```\n\n```\ncode\n```\n\nafter\n\n- two'],
        ['F1', '- one\n\n  ```\n  code\n  ```\n\n  after\n\n- two', 'one', null, 'quote', '> one\n\n```\ncode\n```\n\nafter\n\n- two', '> one\n\n```\ncode\n```\n\nafter\n\n- two'],
        ['F2', '1. one\n\n   second\n\n2. two\n\n   third', 'one', 'two', 'UL', '- one\n\n- second\n\n- two\n\n  third', '- one\n- second\n- two\n\n  third'],
        ['F2', '1. one\n\n   second\n\n2. two\n\n   third', 'one', 'two', 'h2', '## one\n\n## second\n\n## two\n\nthird', '## one\n\n## second\n\n## two\n\nthird'],
        ['F3', '- one\n\n  \\- dash\n\n- two', 'one', null, 'UL', 'one\n\n\\- dash\n\n- two', 'one\n\n\\- dash\n\n- two'],
        ['F3', '- one\n\n  \\- dash\n\n- two', 'one', null, 'OL', '1. one\n\n   \\- dash\n\n- two', '1. one\n\n   \\- dash\n\n- two'],
```

**`DIFFERS`.** Delete four comments of the table: the line that starts `// The code block leaves the list on the WYSIWYG surface alone` (above `E38`, which leaves), the four lines that start `// The source-mode lift rule is deferred`, the three that start `// The deferral also leaves source mode doing nothing`, and the three that start `` // `- ---` is a thematic break of its own ``. Change three:

- The comment line `// A block or a nested list indented with a tab: the block itself, and a block before it in the item.` becomes the two lines `// A block or a nested list indented with a tab, which source mode does not find: the block itself, and the` and `// block before such a list in the item.`
- In the comment on text opening with `[ ] `, end the sentence after `` `\\[ \\]`) ``.
- In the comment on lines that read otherwise, end the sentence after `markers are indented`.

Append:

```ts
        // `setBlockType` on a block a list item holds converts it in place on the WYSIWYG surface and takes it out of
        // the list in source mode, with what the item holds after it (the rows `E4` and `E12` are the plain cases).
        ['T20', '- [x] alpha\n\n  beta\n\n  gamma\n- delta', 'beta', null, 'h2', '- [x] alpha\n\n  ## beta\n\n  gamma\n\n- delta', '- [x] alpha\n\n## beta\n\ngamma\n- delta'],
        ['M33', '- one\n\n  para\n\n  ---\n\n- two', 'para', null, 'h2', '- one\n\n  ## para\n\n  ---\n\n- two', '- one\n\n## para\n\n---\n\n- two'],
        // What a list item holds stays in the list in source mode where it would read otherwise outside it: a code
        // fence left open, and a numbered item not numbered 1 that would come to stand right under a paragraph.
        ['E39', '- one\n\n  ```\n  open\n- two', 'one', null, 'UL', 'one\n\n```\nopen\n```\n\n- two', 'one\n\n- ```\n  open\n- two'],
        ['E40', '* eps\n  10) zeta\n\n      1) eta\n      2) theta\n\n      kappa\n  11) lam', 'zeta', null, 'UL', '* eps\n\n* zeta\n\n* 1) eta\n  2) theta\n\n  kappa\n\n  10) lam', '* eps\n* zeta\n* 10) 1) eta\n      2) theta\n\n      kappa\n  11) lam'],
```

After this step `DIFFERS` has 51 rows where `markdown-tab-column-parity` left 142, and `SAME` has 91 more.

| Of the 142 `DIFFERS` rows `markdown-tab-column-parity` leaves | Rows |
|---|---|
| read alike with this plan, and move to `SAME` (`E38` among them) | 85 |
| read alike, in a document the editor would not save: move to the source-mode `CASES` (`T20 UL`, `T20 OL`, `E30 UL`, `E30 h2`, `E34 UL`, `E19 UL`, `E24 UL`, `E24 h2`) | 8 |
| still differ, with another source-mode text (`T20 h2`, `M33 h2`) | 2 |
| unchanged, `E25`, `E26` and `E27` among them | 47 |

The notes of `markdown-list-toggle-task-item-parity` name 70 rows and 23 more that change with the lift. All 70 read alike. Of the 23, 21 read alike, and `T20 h2` and `M33 h2` change their text and stay.[^rows-23]

### Source-mode rows

In the `CASES` table of `describe('MarkdownEditor source-mode line commands read the viewer's blocks')`, restate three rows:

| Row | Name after | `result` after |
|---|---|---|
| `a heading from a list item keeps the item's indented content in the item` | `a heading from a list item takes the item's indented content out of the list with it` | `'## a\n\nb'` |
| `a code block from a list item keeps the item's indented content in the item` | `a code block from a list item takes the item's indented content out of the list with it` | `` '```\na\n```\n\nb' `` |
| `a list toggle declines over a tab-indented block of the item` | `E24 UL: a list toggle takes a tab-indented block of the item out of the list, the tab written as spaces` | `'one\n\n  second\n- two'` |

Add these 21 rows after the row `a task marker stays with the first line of its item's text`. Eight of them are `DIFFERS` rows: `E18` (two), `E24 h2`, `E19 UL`, `T20 UL`, `T20 OL`, `E30 UL`, `E30 h2` and `E34 UL`; with the restated `E24 UL`, nine. Both surfaces read alike on them, but their documents are not in the form the editor saves, which a `SAME` row requires: a tab in an item's indentation, or text the editor would write otherwise. On the `E18`, `E19 UL` and `E24` rows the WYSIWYG surface saves `one ⏎⏎ ``` ⏎ aa ⏎ ··bb ⏎ ``` ⏎⏎ - two` (with `## ` before `one` for `h2`), `one ⏎⏎ second ⏎⏎ - two` and `one ⏎⏎ second ⏎⏎ - two` (`## one` for `h2`), which the results below read as.

```ts
        {
            name: 'a list item taken out of its list takes a lazy line of its paragraph along', doc: '- one\n\n  second\nlazy\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nsecond\nlazy\n\n- two',
        },
        {
            name: 'an item that changes kind re-indents the paragraph it holds, a lazy line left as it is', doc: '- one\n\n  second\nlazy\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleOrderedList(), result: '1. one\n\n   second\nlazy\n\n- two',
        },
        {
            name: 'indented code a list item holds stays indented code outside the list', doc: '- one\n\n      code\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n    code\n\n- two',
        },
        {
            name: 'a later line of an item\'s text made an item takes the blocks its item held', doc: '- one\n  two\n\n  para\n- three', select: [9, 9],
            run: (editor) => editor.toggleUnorderedList(), result: '- one\n- two\n\n  para\n- three',
        },
        {
            name: 'a task item taken out of its list leaves its nested list in a plain item', doc: '- [ ] one\n  - inner\n\n  after\n- two', select: [7, 7],
            run: (editor) => editor.toggleUnorderedList(), result: '\\[ \\] one\n- - inner\n\n  after\n- two',
        },
        {
            name: 'a nested item taken out of its lists leaves its own nested list one level up', doc: '- o\n  - x\n    - n\n  - y\n\n  t\n- z', select: [9, 9],
            run: (editor) => editor.toggleUnorderedList(), result: '- o\n\nx\n\n- - n\n  - y\n\n  t\n- z',
        },
        {
            name: 'a code block that leaves its list item keeps the tab its code holds', doc: '- one\n\n  ```\n  a\tb\n  ```\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n```\na\tb\n```\n\n- two',
        },
        {
            name: 'E18 UL: a code block whose line a tab indents leaves its list item, the tab written as the spaces it read as', doc: '- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n```\naa\n  bb\n```\n\n- two',
        },
        {
            name: 'E18 h2: a code block whose line a tab indents leaves its list item, the tab written as the spaces it read as', doc: '- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n\n```\naa\n  bb\n```\n\n- two',
        },
        {
            name: 'a line of whitespace in a code block gives up the item\'s indentation alone', doc: '- one\n\n  ```\n  aa\n      \n  bb\n  ```\n\n- two', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n\n```\naa\n    \nbb\n```\n\n- two',
        },
        {
            name: 'a hard line break written with trailing spaces stays one in what leaves the list', doc: '- one\n\n  second  \n  third\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nsecond  \nthird\n- two',
        },
        {
            name: 'a numbered item not numbered 1 is set apart from the paragraph that left the list above it', doc: '3. a\n\n   b\n4. c', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## a\n\nb\n\n4. c',
        },
        {
            name: 'a code fence left open stays in its list item, where the item closes it', doc: '- one\n\n  ```\n  open\n- two', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n\n- ```\n  open\n- two',
        },
        {
            name: 'a tab-indented block of the item leaves the list after the block before it, the tab written as spaces', doc: '- one\n\n  ok\n\n\ttabbed\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nok\n\n  tabbed\n- two',
        },
        {
            name: 'E24 h2: what the item holds leaves the list, its tab written as spaces, in a document the editor would not write so', doc: '- one\n\n\tsecond\n- two', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n\n  second\n- two',
        },
        {
            name: 'E19 UL: an item whose marker a tab follows lets its tab-indented block leave the list with its text', doc: '-\tone\n\n\tsecond\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\nsecond\n- two',
        },
        {
            name: 'T20 UL: what the item holds leaves the list in a document the editor would not write so', doc: '- [x] alpha\n\n  beta\n\n  gamma\n- delta', select: [16, 16],
            run: (editor) => editor.toggleUnorderedList(), result: '- [x] alpha\n\n- beta\n\n  gamma\n- delta',
        },
        {
            name: 'T20 OL: what the item holds leaves the list in a document the editor would not write so', doc: '- [x] alpha\n\n  beta\n\n  gamma\n- delta', select: [16, 16],
            run: (editor) => editor.toggleOrderedList(), result: '- [x] alpha\n\n1. beta\n\n   gamma\n- delta',
        },
        {
            name: 'E30 UL: what the item holds leaves the list in a document the editor would not write so', doc: '- one\n\n  [ ] para\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n[ ] para\n- two',
        },
        {
            name: 'E30 h2: what the item holds leaves the list in a document the editor would not write so', doc: '- one\n\n  [ ] para\n- two', select: [3, 3],
            run: (editor) => editor.setBlockType('h2'), result: '## one\n\n[ ] para\n- two',
        },
        {
            name: 'E34 UL: what the item holds leaves the list in a document the editor would not write so', doc: '- one\n\n    <div>x</div>\n\n- two', select: [3, 3],
            run: (editor) => editor.toggleUnorderedList(), result: 'one\n\n  <div>x</div>\n\n- two',
        },
```

In the `CASES` table of `describe('MarkdownEditor source-mode command wiring')`, add after the `toggleOrderedList` row. It pins that a lift with a tail is one edit, which is one undo step:

```ts
        {
            name: 'toggleUnorderedList, with what the item holds', doc: '- one\n\n  second\n- two', anchor: 2, head: 2,
            run: (editor) => editor.toggleUnorderedList(), changes: { from: 0, to: 15, insert: 'one\n\nsecond' },
        },
```

### Transform tests

In `describe('line commands act on the blocks the viewer reads')` of `markdown-source-edits.test.ts`:

1. Replace the two comment lines above the `describe` that end `so what followed it inside them stays there.` with:

```ts
// lexing it. A block leaves its quotes and list items for the top level, the
// containers split around it. What followed it in its list items, up to the
// next list item, leaves the list with it; from that item on it stays there.
```

2. Replace the test `keeps a list item's other content in the item when its text is lifted out` with the five tests below.

3. In the test `writes a new item as a list of its own where joining the list above would change how that list reads`, the last expectation becomes `'2) [x] a\n\n   ~~~js\n   > q \n1. b\n\n   c'`: the paragraph `c` is the tail of `b` and goes under the new item.

4. Replace the test `declines when a tab on an item's marker line stands where the command has to read`, with the two comment lines above it, by the test after the five. Its two declines now act; its other three expectations are kept.

```ts
    it('takes what a list item holds after a lifted block out of the list with it, up to the next list item', () => {
        expect(apply('- a\n  - b\n- c', blockPrefixSource('## ')('- a\n  - b\n- c', 2, 2)!)).toBe('## a\n- - b\n- c');
        expect(apply('10. a\n\n    b', blockPrefixSource('## ')('10. a\n\n    b', 4, 4)!)).toBe('## a\n\nb');
        expect(apply('- a\n\n  b', blockPrefixSource('> ')('- a\n\n  b', 2, 2)!)).toBe('> a\n\nb');
        expect(apply('- x\n  - a\n  - b', blockPrefixSource('## ')('- x\n  - a\n  - b', 8, 8)!)).toBe('- x\n## a\n- - b');
        expect(apply('10. a\n\n    b', FENCED_CODE_SOURCE('10. a\n\n    b', 4, 4)!)).toBe('```\na\n```\n\nb');
        expect(blockTypes('## a\n\nb')).toEqual(['heading', 'paragraph']);

        // The tail ends at the item's first nested list: from there on the item is re-opened, one level up.
        const nested = '- one\n\n  second\n\n  - inner\n\n  after\n- two';

        expect(apply(nested, listSource('unordered')(nested, 2, 2)!)).toBe('one\n\nsecond\n\n- - inner\n\n  after\n- two');
        // An item of the other kind takes its tail along as the blocks it holds.
        expect(apply(nested, listSource('ordered')(nested, 2, 2)!)).toBe('1. one\n\n   second\n\n- - inner\n\n  after\n- two');
    });

    it('keeps the quotes around what leaves a list, and splits none of them', () => {
        const quoted = '> - one\n>\n>   second\n> - two';

        expect(apply(quoted, listSource('unordered')(quoted, 4, 4)!)).toBe('one\n>\n> second\n> - two');
        // The new item stands outside the quote, so what it held cannot follow it: it stays in the quote, out of the list.
        expect(apply(quoted, listSource('ordered')(quoted, 4, 4)!)).toBe('1. one\n>\n> second\n> - two');

        // A quote the item holds goes under the new item with the rest of what the item held.
        const holds = '- > one\n  >\n  > second\n- two';

        expect(apply(holds, listSource('ordered')(holds, 4, 4)!)).toBe('1. one\n   >\n   > second\n- two');
        expect(apply(holds, blockPrefixSource('## ')(holds, 4, 4)!)).toBe('## one\n>\n> second\n- two');

        // The blank line that sets a tail apart carries the quote's marker: an empty line would end the quote there.
        const numbered = '> 3. one\n>\n>    second\n> 4. two';

        expect(apply(numbered, blockPrefixSource('')(numbered, 5, 5)!)).toBe('one\n\n>\n> second\n>\n> 4. two');
        expect(blockTypes('one\n\n>\n> second\n>\n> 4. two')).toEqual(['paragraph', 'blockquote']);
    });

    it('writes back every byte of what leaves a list, but for the list items\' indentation and the tabs in it', () => {
        const tab = '- one\n\n  ```\n  a\tb\n  ```\n\n- two';
        const spaces = '- one\n\n  second  \n  third\n   \n- two';
        const lazy = '- one\n\n  second\nlazy\n- two';

        expect(apply(tab, listSource('unordered')(tab, 2, 2)!)).toBe('one\n\n```\na\tb\n```\n\n- two');
        expect(apply(tab, listSource('ordered')(tab, 2, 2)!)).toBe('1. one\n\n   ```\n   a\tb\n   ```\n\n- two');
        expect(apply(spaces, listSource('unordered')(spaces, 2, 2)!)).toBe('one\n\nsecond  \nthird\n \n- two');
        expect(apply(lazy, listSource('ordered')(lazy, 2, 2)!)).toBe('1. one\n\n   second\nlazy\n- two');
    });

    // Where what an item holds would not read the same outside the list, it is left in the list, re-opened by the
    // item's marker, as it was before the tail left the list: the command acts either way.
    it('leaves what a list item holds in the list where it would read otherwise outside it', () => {
        const open = '- one\n\n  ```\n  open\n- two';
        const trailing = '- one\n\n      code \n';
        const numbered = '* eps\n  10) zeta\n\n      1) eta\n      2) theta\n\n      kappa\n  11) lam';

        // An open fence is closed by the end of its item; outside the list it would take the rest of the document.
        expect(apply(open, blockPrefixSource('## ')(open, 2, 2)!)).toBe('## one\n\n- ```\n  open\n- two');
        // `marked` drops the whitespace that ends a list; outside the list the code would keep it.
        expect(apply(trailing, listSource('unordered')(trailing, 2, 2)!)).toBe('one\n\n-     code \n');
        // One level up, `11) lam` would stand right under the paragraph `kappa` and continue it.
        expect(apply(numbered, blockPrefixSource('## ')(numbered, numbered.indexOf('zeta'), numbered.indexOf('zeta'))!))
            .toBe('* eps\n## zeta\n\n* 10) 1) eta\n      2) theta\n\n      kappa\n  11) lam');
    });

    it('acts in a task item and before a thematic break, where a re-opened marker would read otherwise', () => {
        const task = '- [x] alpha\n  - beta\n  - gamma\n- delta';
        const held = '- [x] alpha\n\n  beta\n\n  gamma\n- delta';
        const rule = '- one\n\n  para\n\n  ---\n\n- two';

        expect(apply(task, blockPrefixSource('## ')(task, task.indexOf('beta'), task.indexOf('beta'))!)).toBe('- [x] alpha\n## beta\n- - gamma\n- delta');
        expect(apply(held, listSource('unordered')(held, held.indexOf('beta'), held.indexOf('beta'))!)).toBe('- [x] alpha\n\n- beta\n\n  gamma\n- delta');
        expect(apply(rule, listSource('ordered')(rule, rule.indexOf('para'), rule.indexOf('para'))!)).toBe('- one\n\n1. para\n\n   ---\n\n- two');
        expect(apply(rule, blockPrefixSource('## ')(rule, 2, 2)!)).toBe('## one\n\npara\n\n---\n\n- two');
    });
```

```ts
    // A tab in the container prefix of a line that a lift moves is written as the spaces that reach its tab stop,
    // counted where the line stood, so the line reads at its new place as it read in the item. A tab the lift does
    // not move, and a tab past the container prefix, is kept.
    it('writes a tab of a moved line\'s container prefix as the spaces it read as', () => {
        const marker = '-\tone\n\n\tsecond\n- two';
        const block = '- one\n\n  ok\n\n\ttabbed\n- two';
        const code = '- one\n\n  ```\n  aa\n  \tbb\n  ```\n\n- two';
        const unmoved = '- one\n\n  - inner\n\n\tafter\n- two';

        // The tab after the marker puts the item's text at column 4, and the tab of `second` reaches it.
        expect(apply(marker, blockPrefixSource('## ')(marker, 2, 2)!)).toBe('## one\n\nsecond\n- two');
        expect(apply(marker, listSource('unordered')(marker, 2, 2)!)).toBe('one\n\nsecond\n- two');
        // Two of the tab's four columns were the item's; the other two stay, as spaces.
        expect(apply(block, listSource('unordered')(block, 2, 2)!)).toBe('one\n\nok\n\n  tabbed\n- two');
        expect(apply(code, listSource('unordered')(code, 2, 2)!)).toBe('one\n\n```\naa\n  bb\n```\n\n- two');
        // From the nested list on, the outermost item keeps its columns, so the tab of `after` does not move.
        expect(apply(unmoved, listSource('unordered')(unmoved, 2, 2)!)).toBe('one\n\n- - inner\n\n\tafter\n- two');

        // A tab in the item's text is content, and the command reads past it.
        expect(apply('- one\ttab\n- z', blockPrefixSource('## ')('- one\ttab\n- z', 2, 2)!)).toBe('## one\ttab\n- z');
        expect(apply('- one\ttab\n- z', listSource('ordered')('- one\ttab\n- z', 2, 2)!)).toBe('1. one\ttab\n- z');

        // An item of one line: the tab after its marker goes with the marker.
        expect(apply('-\tone\n- two', blockPrefixSource('## ')('-\tone\n- two', 2, 2)!)).toBe('## one\n- two');
    });
```

### What is red before the code

With the rows in place and `markdownSourceLines.ts` unchanged, 123 tests fail.

| Where | Red | Green controls |
|---|---|---|
| `SAME` | the 85 moved rows and the 6 new ones | every row that was there |
| `DIFFERS` | `T20 h2`, `M33 h2` | `E39 UL`, `E40 UL`, and every row that was there |
| `CASES`, line commands | the 3 restated rows; of the 21 new ones, all but `a code fence left open stays in its list item, where the item closes it` | that row, and every row that was there |
| `CASES`, wiring | `toggleUnorderedList, with what the item holds` | the rest |
| `markdown-source-edits.test.ts` | `takes what a list item holds after a lifted block out of the list with it, up to the next list item`; `keeps the quotes around what leaves a list, and splits none of them`; `writes back every byte of what leaves a list, but for the list items' indentation and the tabs in it`; `writes a tab of a moved line's container prefix as the spaces it read as`; `acts in a task item and before a thematic break, where a re-opened marker would read otherwise`; `writes a new item as a list of its own where joining the list above would change how that list reads` | `leaves what a list item holds in the list where it would read otherwise outside it` |

### What does not change

- **Availability.** `canSetBlockType` is `true` in source mode whenever the editor is not read-only, as before. Source mode does not predict where a command declines. A read-only editor's commands change nothing. The availability rows of `markdown-editor.test.ts` stay as they are and stay green.
- **Undo.** A source-mode command is one transform, one edit and one `CodeEditor` change. The wiring row above pins it for a lift with a tail.
- **The WYSIWYG surface.** No file of it is touched.

### Manual checks

Needs manual verification, in a browser on the demo's MD Editor page (`npx vite` in `packages/lib`), in source mode:

| # | Text | Action | Expect |
|---|---|---|---|
| B1 | `- one`, blank, `  second`, blank, `- two` | caret on `one`; **Insert ▸ Bulleted list** | `one`, blank, `second`, blank, `- two`; one Ctrl+Z gives the text back |
| B2 | the same | caret on `one`; **Insert ▸ Numbered list** | `1. one`, blank, `   second`, blank, `- two` |
| B3 | the same | caret on `one`; context menu ▸ **Block style ▸ Heading 2** | `## one`, blank, `second`, blank, `- two` |
| B4 | `- [x] a`, `  - b`, `  - c`, `- d` | caret on `b`; **Insert ▸ Bulleted list** | `- [x] a`, blank, `b`, blank, `- - c`, `- d` |
| B5 | B1's result | switch to WYSIWYG | two paragraphs and a one-item list, as the viewer shows them |
| B6 | `- one`, blank, a tab and `second`, `- two` | caret on `one`; **Insert ▸ Bulleted list** | `one`, blank, two spaces and `second`, `- two`: the tab is gone, the line reads as a paragraph |

---

## Verification

1. `npm run typecheck`, `npm run typecheck:test`, `npm run lint`: clean.
2. `npm test`: green. Against the base the count grows by 26: 6 `SAME` rows, 2 `DIFFERS` rows, 21 line-command `CASES` rows, the wiring row and 4 tests of `markdown-source-edits.test.ts`, less the 8 `DIFFERS` rows whose documents move to the `CASES` rows. On the measured copy the whole suite is 591 files and 20,196 tests, 2 of them `todo`.
3. `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
4. **The differential check against the base.** The probes are in the scratch folder under `probes/`. Before step 6, copy `src/typescript/lib/component/editor/markdownSourceLines.ts` over `probes/zz-base-lines.ts` there (the file there now is the measured base); `run.sh` copies it into the tests tree with the other helpers on every run. They compare `zz-base-lines.ts` with the module itself, in one process. `run.sh` there copies a probe and the probes' helper files into the tests tree, runs the probe and removes the probe; set `P_LIB` to your `packages/lib`. `runall.sh` gives the first three runs below, two Vitest processes at a time; `rundump.sh` the planner's sets again for `cat2.py`.

   - `zz-lr-gen.test.ts` for seeds 11 to 14, with the case counts `runall.sh` gives.
   - `zz-lr-rows.test.ts` over every file of `scratch-keep/plans3/source-list-lift/sets/`.
   - `zz-lr-parity.test.ts` for the three families.
   - `zz-lr-tabeq.test.ts` for seeds 21 and 22, 1,500 drawn documents each.
   - `zz-lr-equiv.test.ts`. It compares the module with the measured one (`zz-proto-lines.ts`, a copy of `proto/markdownSourceLines.ts`), edit for edit: `differ` is 0.

   Delete every `zz-*` file from the tests tree afterwards and commit none of them.

   Hard checks, each 0:

   | Check | Meaning |
   |---|---|
   | H1 | the new module throws |
   | H2 | the base acts and the new module declines |
   | H3 | the viewer's text, all blocks joined and whitespace removed, differs from the document's (commands other than the code fence) |
   | H4 | two blocks of text are one block afterwards, where the base's result keeps them apart or the base declines; a join beside a code block that the command turned into text is the base's own rule and is not counted |
   | H5 | a line kept by a tail lift differs from its source line by more than quote markers and spaces taken off, a list marker and spaces put on, and a tab of its container prefix written as the spaces to its stop; or it keeps a prefix tab that does not stand in the bytes the line kept, or it loses a tab past its prefix. Only the module with trace lines counts this (`proto/markdownSourceLines.hooked.ts`, the measured module with lines ending `//HOOK` added); for the module in the tree, the equivalence run stands in |
   | H7 | an edit that changes nothing |
   | H8 | a source-mode result, loaded into the editor, is shown otherwise than the viewer shows it, in a document that holds no list the WYSIWYG surface keeps as a raw block |
   | H9 | a source-mode result, loaded and saved, does not reload to itself |
   | P | the base's result reads as the WYSIWYG result and the new one does not, in a case that is not `setBlockType` on a block a list item holds |
   | T | a document with tabs in its container prefixes, all of whose blocks are placed, gets a result whose spaces form is not the result on its spaces form, or a result where its spaces form gets none, or the reverse (`zz-lr-tabeq.test.ts`: every count whose name starts `TAB-`) |

   Measured on `736452bbc` with the code of the three plans before this one, and `marked` 18.1.0:[^numbers]

   | Set | Cases | H1 to H7 | Acts where the base did nothing | Differs from the base's edit | Tail candidate tried, base candidate taken | A prefix tab written as spaces |
   |---|---|---|---|---|---|---|
   | review 6's generator, seeds 11 to 14, 1,500 documents each (`zz-lr-gen.test.ts`) | 2,017,812 | 0 | 225,604 | 191,553 | 1,670 | 0 |
   | review 5's source rows, 17 sets (`sets/r5-*.json`): 267,212 rows, of which 165,208 are line commands | 165,208 | 0 | 17,897 | 18,969 | 5,305 | 4,797 |
   | the planner's and implementer's differential sets and reviews 1 to 3 (`sets/pl-*.json`) | 68,522 | 0 | 9,330 | 10,823 | 0 | 0 |
   | review 4: `hand`, `rand41`, `tab`, `tab2` (`sets/r4-*.json`) | 2,822 | 0 | 711 | 607 | 0 | 42 |
   | review 6's generator with spaces written as tabs, seeds 21 and 22 (`zz-lr-tabeq.test.ts`) | 385,476 | 0 | 17,566 | 12,746 | 10,485 | 9,927 |

   The 102,004 other rows of review 5 are inline commands, which never reach this module.

   On the tab documents of the last row, T counts 0. In 1,013 documents with a tab, the result on the tab document, in its spaces form, is the result on the space document in all 106,010 cases where both act and the tab document's blocks are all placed. In the other 1,300 cases where both act, and the 122,497 where only the space document's command acts, the tab document has a block the token search does not place: they are `markdown-source-mode-block-locator`'s.

   Parity with the WYSIWYG surface (`zz-lr-parity.test.ts`, review 6's three families, seeds 300 to 307, 60 documents each; the third family with a task probability of 0.25, which reproduces review 6's counts exactly):

   | | Cases | Source reads otherwise than WYSIWYG, base | after | P | H8 | H9 |
   |---|---|---|---|---|---|---|
   | all three families | 90,454 | 10,098 | 7,087 | 0 | 0 | 0 |

   Every one of the 7,087 stands under a clause the docs keep: 2,294 in documents that hold a list the WYSIWYG surface keeps as a raw block, 2,460 where the selection runs from one `:::` column into the next, 2,333 `setBlockType` on the heading an item opens with (`anpar.py` of `scratch-keep/plans3/source-list-lift/`). The probe also counts 68 cases where the editor shows a result otherwise than the viewer; all are in two documents that hold a list the WYSIWYG surface keeps as a raw block, which H8 leaves out.

   On the 68,522 cases of the planner's probe, whose WYSIWYG results are recorded: 33,332 read otherwise at the base and 19,150 after. `cat2.py` puts every remaining one under a clause, for documents in the form the editor saves; the footnote has the table.[^clauses] On review 4's sets, 1,758 of 2,684 cases with a recorded WYSIWYG result read otherwise at the base and 1,017 after.

5. **Cost.** `markdownSourceTokens.ts` is the same file, so analysis costs the same: measured 1.5 ms at 400 lines and 4.1 ms at 1,600 for review 5's two-tab document, and 2.5 ms for a list of 800 items. A command costs more, since the tail candidate's expected leaves are read as well and each of its forms that does not read is one more lex. Over 210 timings of commands on documents of 200 to 4,800 lines, the new module took 1.4 times the base's time at the median, 1.7 times at the ninth decile and 2.0 times at worst. Rerun `zz-lr-perf.test.ts` and report its table.[^cost]

   | Document, 800 items | Selection | Bulleted toggle, base / after | `setBlockType("h2")`, base / after |
   |---|---|---|---|
   | a tight list | a caret in the middle | 10 ms / 14 ms | 6 ms / 11 ms |
   | a tight list | everything | 35 ms / 34 ms | 52 ms / 57 ms |
   | a loose list, each item holding a paragraph | a caret in the middle | 15 ms / 24 ms | 15 ms / 24 ms |
   | a loose list, each item holding a paragraph | everything | 1,030 ms / 1,109 ms | 599 ms / 812 ms |
   | one item holding 800 paragraphs | a caret in its text | 61 ms / 63 ms | 60 ms / 63 ms |
   | a loose list, each item holding a code fence one line of which a tab indents | a caret on the first item | 13 ms / 24 ms | 15 ms / 23 ms |

## Documentation Impact

No export changes. Two pages change. `markdown-tab-column-parity` and the three raw-block plans edit the same paragraphs before this plan, so find each sentence by its words, not by its line.

**`docs/components/MarkdownEditor.md`**, the source-mode section.

1. In the paragraph that starts `The block commands —`, replace from `Those containers split around it, and what followed it inside them stays there, re-opened by its own marker:` to `rather than leaving `b` behind as indented code.` with:

   > Those containers split around it. What a list item holds after the block, up to the item's next list item, leaves the list with it — `setBlockType("h2")` on `10. a` / (blank) / `    b` gives `## a` / (blank) / `b` — or becomes the blocks of the item a list toggle makes of it (`toggleOrderedList()` on `one` in `- one` / (blank) / `  second` gives `1. one` / (blank) / `   second`). From that list item on, what followed stays in the list, in one item that the outermost item's marker re-opens: on `a` in `- x` / `  - a` / `  - b` the heading command gives `- x` / `## a` / `- - b`. A quote keeps what followed inside it. Only the indentation of the list items around the block is taken off those lines. A tab in that indentation counts to its tab stop, as the viewer reads it, and is written as the spaces it stood for: `toggleUnorderedList()` on `one` in `- one` / (blank) / a tab and `second` gives `one` / (blank) / two spaces and `second`. Every other character, a tab inside text or code included, is written back as it was.

2. In the paragraph that starts `For Markdown written as the editor saves it`, keep the first sentence and delete the rest of the paragraph, from `One of them is to go:` to its end. Join the paragraph to the next one, whose opening `The others come from the surfaces holding different things:` becomes `They come from the surfaces holding different things:`.

3. In that joined paragraph, the clause on `setBlockType` becomes: `` `setBlockType` on a block a list item holds after its text, or on the heading it opens with, converts it in place on the WYSIWYG surface and takes it out of the list in source mode, with what the item holds after it ``.

4. In the paragraph that starts `Markdown the editor would not write itself`, as `markdown-tab-column-parity` leaves it:
   - replace `These are a tab right after an item's marker when the item holds further lines, for commands on that item's text; a list in a blockquote` with `These are a list in a blockquote`: that tab no longer stops a command;
   - replace `a block or a nested list of an item indented with a tab, for commands on it and on any block before it in the item;` with `a block or a nested list of an item indented with a tab, which source mode does not find, for commands on it and on the block before such a nested list in the item;`;
   - in the clause on text that opens with an unescaped `[ ] `, delete `, and any command on the block right before such text in a list item`;
   - in the clause on indentation, delete `, an HTML block indented deeper than its item's content`;
   - add before the sentence that starts `Where an item's marker stands on a line of its own`:

   > Where what a list item holds would read otherwise outside the list, source mode leaves it in the list, in an item the marker re-opens, and the WYSIWYG command takes it out: a code fence left open, which the end of its item closes; a code or HTML block that ends its list on trailing whitespace; and a numbered item not numbered 1 that would come to stand right under a paragraph.

**`docs/reference/changelog/next.md`.** In the entry `` **`MarkdownEditor`'s list toggles change the selected blocks only.** ``, replace from `One difference between the surfaces stays for now:` to `the source-mode command does nothing.` with:

> In source mode the blocks an item holds after its text now leave the list with it, as on the WYSIWYG surface, for the two toggles, `setBlockType` and the code fence alike: `setBlockType("h2")` on `10. a` / (blank) / `    b` gives `## a` / (blank) / `b`, where it gave `## a` / (blank) / `10. b`. A tab in the indentation of a line that leaves the list is written as the spaces it stood for, so the line reads as it did. The commands also act inside a task item, before a thematic break written with the list's marker, on the text of an item whose marker a tab follows, and before a block a tab indents, where they did nothing.

Run `npm run docs:llms:check` afterwards.

---

## Potential Challenges

- **The base moved.** The plans of `depends-on` may have edited the functions this plan replaces. Step 1 stops on that; merge by hand, then rerun step 8 in full.
- **A row's expected text differs by a blank line.** The set-apart form is taken only when the plain form does not read. If a row fails on a blank line, the form order in `firstReadingEdit` is wrong, not the row.
- **A lint rule on the regex or on `findLast`.** `findLastIndex` is already used in the module (`reopenContainers`); `findLast` is the same library level.
- **The differential shows H2 above 0.** Then a base candidate is not the base's. Compare `liftLines`, `reopenContainers`, `containerPrefix` and `itemIndent` (called without `tabStops`), and the base candidate's `build` and `expected`, with `736452bbc`; do not add a case.
- **A tab kept where the plan says it is rewritten, or the reverse.** `keptBytes` is the one place that decides; the line's spaces form decides everything else. A row that fails on a tab compares `changedAt` with the table in `### A tab in a moved line's container prefix is written as the spaces it stood for`.
- **`withPrefixTabsAsSpaces` not exported.** It is exported by `markdown-tab-column-parity` (marked `@internal`). Step 0 stops when it is missing; do not copy it into this module.
- **Slow full-selection commands on large lists.** The base's `containersOfLine` walks every block for every line. This plan inherits that cost and does not add to its order.

---

## Critical Files

- [markdownSourceLines.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceLines.ts) — the module changed. Read `liftLines` (:672), `reopenContainers` (:793), `containerPrefix` (:851), `itemIndent` (:883), `firstReadingEdit` (:977) and `listOn` (:1343) first: the new code mirrors them.
- `markdownExtensions.ts` as `markdown-tab-column-parity` leaves it — `withPrefixTabsAsSpaces` and `containerPrefixEnd`, the spaces form and the container prefix this plan reads lines in, and `MARKDOWN_TAB_STOP`, the number `keptBytes` mirrors.
- [markdownSourceTokens.ts](../packages/lib/src/typescript/lib/component/editor/markdownSourceTokens.ts) — `SourceAnalysis`, `SourceBlockNode`, the entries. Read only.
- [markdownListItemNode.ts:780](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L780) — `$liftItemOut`, the WYSIWYG lift whose result the rule copies.
- [markdown-editor.test.ts](../packages/lib/tests/component/markdown-editor.test.ts) — the tables `SAME` (:1113), `DIFFERS` (:1248), the wiring `CASES` (:2430) and the line-command `CASES` (:2854); `markdown-tab-column-parity` adds rows to `SAME` and `DIFFERS` before this plan.
- [markdown-source-edits.test.ts](../packages/lib/tests/component/markdown-source-edits.test.ts) — `describe('line commands act on the blocks the viewer reads')` (:1389).
- [plans/implemented/markdown-list-toggle-task-item-parity.md](implemented/markdown-list-toggle-task-item-parity.md) — the contract, and in its notes the section *For the follow-up plan (source-mode lift rule)*.
- [plans/markdown-tab-column-parity.md](markdown-tab-column-parity.md) — how a tab is read once that plan is in.
- [plans/markdown-source-mode-block-locator.md](markdown-source-mode-block-locator.md) — the next plan, which places the blocks this plan cannot reach (`E25` to `E27`).

---

## Non-Goals

- **Placing a block a tab indents.** A command on such a block, or on a block whose tail ends at a nested list a tab indents (`E25`, `E26`, `E27`), declines here because the token search does not find the block. `markdown-source-mode-block-locator` owns placing blocks; once it has, the lines after the block go through this plan's rule.
- **The WYSIWYG surface**, including the looseness of a list that lost its blocks.
- **`setBlockType` on a block a list item holds.** Source mode takes it out of the list and the WYSIWYG surface converts it in place. Which is right is a question about `setBlockType`.
- **A code block turned into text.** `setBlockType("paragraph")` and `("quote")` over a fenced code block join its text to the block of text below it when no blank line parts them. The base does this, and it now also shows in task-item documents where the base declined.[^code-join]
- **The base's own misreadings.** A tab-indented block followed by a line with the same text is located on the later line. The tail candidate's check rejects what follows from it and the base candidate decides as before.
- **The cost of the base's line walk** (`containersOfLine` per line), and the WYSIWYG looseness transform.
- **Raw block edits.** The three raw-block plans own them.

---

## Notes

[^measured]: The measurements were made in a private copy of commit `736452bbc`, with the code and tests of `marked-version-pin-or-upgrade`, `marked-upgrade` and `markdown-tab-column-parity` applied as committed by that plan's planner (`plans4/tab-revision/repo`), and `marked` 18.1.0 in a `node_modules` of the copy's own. Nothing was installed in the main tree or a worktree. This plan's module and test changes were then applied to the copy. The three raw-block plans were not installed: they do not touch `markdownSourceLines.ts`, `markdownSourceTokens.ts` or the lexer. The first version of this plan was measured on `75d022ba1` with `marked` 18.0.9; where a footnote quotes that measurement, it says so. Everything is kept in the scratch folder named in `## Ordered Implementation Steps`: `PROGRESS.md` there says which output is which.

[^rule]: The rule is the one the first implementation settled on, recorded in the notes of `markdown-list-toggle-task-item-parity`. Measured for the first version of this plan, on 18.0.9: on the 68,522 cases of the planner's probe the module of this plan gives the same text as that implementation in 68,480. In 41 the two differ in one line of whitespace: a line that holds exactly its item's indentation is written empty here, and with the new item's indentation there. In one, this plan acts on a list inside a quote where that implementation left the document.

[^mechanism]: Three mechanisms were weighed.

    | Mechanism | Verdict |
    |---|---|
    | Write the tail from `marked`'s tokens: each tail block's `raw` is its text with the containers' prefixes already taken off | Rejected. A nested token's `raw` is not the source. `marked` lexes what a list item holds from a copy with tabs written as spaces and the task marker removed, and a quote's content from a copy with setext lines re-indented. Writing `raw` back rewrites content bytes, which is what row `E18` does on the WYSIWYG surface. Mapping `raw` to source bytes instead needs each nested token traced to its lines, which is the search that went quadratic |
    | Keep the base's line arithmetic, read a tab only through the lexer's own spaces form, never touch the token search | Taken, for writing. `containerPrefix` and `itemIndent` have run on every source-mode command since `markdown-source-mode-editing`, and the differential sets hold no misreading by them of a prefix written in spaces; the spaces form gives them nothing else to read |
    | Decline exactly where the result cannot be proved by re-lexing, the shapes enumerated | Taken, for deciding, with one change: where the tail lift cannot be proved, fall back to the base's edit, and decline only where that cannot be proved either |

    What makes the design closed is that no shape is decided by a case in the writer. The writer applies one table to every line. The check accepts or rejects. The base candidate guarantees that nothing the base did is lost. The first attempt had the first two and not the third, so every shape where a block read otherwise outside its list — an open fence, trailing whitespace at a list's end, a numbered item under a paragraph — became a decline, and each was then patched in the writer. Those shapes are now the footnote on clauses, not code.

[^tabs]: The owner decided L3 and L4 on 2026-10-14: a moved tab is rewritten, so that source mode agrees with the WYSIWYG surface. The first version of this plan declined there instead, for three reasons that no longer hold. It rewrote no byte outside a prefix written in spaces; the owner now asks for the prefix tab's bytes to change. Half a tab cannot be kept; the spaces form does not keep half a tab, it writes the whole tab as spaces before any column is taken off, so there is nothing to split. And the first attempt's tab handling (`peelIndent`, a tab-aware `containerPrefix`, a tab-aware token search) had four blocking defects in reviews 4 and 5; here no reader of the module learns about tabs, the token search is not touched, and the one tab rule is the lexer's, which `markdown-tab-column-parity` measured on 2,932 drawn tab documents. Measured for this plan: on 1,013 documents drawn by review 6's generator with the spaces that reach a tab stop written as a tab (seeds 21 and 22, 385,476 cases), the module's result on the tab document, written in its spaces form, is the result on the space document in every case where both act and the tab document's blocks are all placed; it never declines or acts alone there. Every case where the two differ is one where the token search places fewer blocks in the tab document, which is the locator's. Keeping the tab bytes up to the first changed column (`keptBytes`) keeps a tab the lift does not move, which L4 asks for; writing the whole line in its spaces form would have rewritten such tabs too.

[^independent]: The notes of the first attempt say: "The lift writes lines and expects leaves from the same reading of the document. What it gets wrong in one it gets wrong in both, and the check by lexing passes." There `leavesListWithLift` decided per line what `pathAfterLifts` decided per leaf, both from the same container walk, and a list later in the same quote was taken along by both. Here a line's role comes from the containers that hold that line, and a leaf's from the entries of the lifted block's outermost list item; a list elsewhere in the quote is in neither.

[^instances]: Review 2 found a quote split in two by a blank line written without its `>`, accepted by the check because both halves had the path `quote / p`. `separatorBelowTail` now writes the marker, and the instance comparison is the check that would catch the next writer that does not. Measured for the first version of this plan, on 18.0.9: without the comparison the module gives another result in 39 of 236,552 rows, all on one document of review 5's tab sets, where two quotes of different list items came to stand under one another and read as one. With the comparison the tail candidate is rejected there. It changes no result in the planner's sets or in review 4's.

[^analysis]: The first attempt made `findAligned` follow tabs, and `analyzeMarkdownSource` took 821 ms at 400 lines and 13 s at 1,600 on review 5's two-tab document, on every command and every selection-state read. Here the file is not in the diff.

[^tab-order]: This plan is implemented after `markdown-tab-column-parity` because that plan changes what `lexMarkdown` reads, both the source analysis and the check of this plan read through `lexMarkdown`, and the tail lift reads lines through that plan's `withPrefixTabsAsSpaces`. For the first version of this plan, on 18.0.9, the order was measured both ways. Without that plan's code, `marked` writes the tab of `··a→b` as four spaces while the block stands in its item and keeps it once the block is out, so the tail candidate is rejected and the code block stays in the list; a prototype that compared code text with tabs taken for four spaces was run to get past that, and is not needed. With that plan's code the content tab reads the same in both places and the candidate is accepted as it is. If the order were reversed, `markdown-tab-column-parity` would have to re-run this plan's step 8 and move `E38`.

[^held]: On the planner's probe, 195 cases (measured again on 18.1.0 with the tab rule: the same 195 and 21) read alike at the base and not after, and 21 on review 4's sets. All are `setBlockType("paragraph")`, `("h2")` or `("quote")` on a block that a task item holds and that already has that type: the WYSIWYG surface has nothing to change, the base did nothing because a re-opened task item reads as a plain one, and source mode now takes the block out of the list as it does in a plain item.

[^e18]: The first version of this plan recommended keeping `E18` as a pinned difference: rewriting the tab's bytes was ruled out, and the WYSIWYG surface cannot keep the tab, because it reads the block from `marked`'s token, where the tab is already spaces (`markdown-tab-column-parity` pins that as row T30). The owner chose agreement instead. The line is the only one in `E18` that changes beyond its item's indentation, and only in its prefix: `··→bb` is written `··bb`, the bytes the WYSIWYG surface saves. Source mode reads it as the same code line before and after, `··bb`.

[^looseness]: The WYSIWYG surface keeps one loose flag per list, set at load. In source mode a list is loose when a blank line parts two of its blocks. `- cu ⏎   - ni ⏎⏎     hu ⏎⏎ - nu` with the numbered toggle on `hu` leaves `- cu ⏎   - ni` in source mode, which is tight, and `- cu ⏎⏎   - ni` on the WYSIWYG surface. Rows `E6` and `E7` pin the kind. On documents in the form the editor saves, 386 of the cases that the lift settles are left with this difference alone.

[^rows-23]: The 23 are `T19` to `T21` (eight), `M33` to `M35` (eight), `M36`, `M37`, `E24` (two), `E30` (two) and `E34`. The two `E24` rows read alike through the tab rule of L4, as they did in the first attempt; there the tab's columns were taken apart by a tab-aware reader of the module's own, here by the lexer's `withPrefixTabsAsSpaces`.

[^prototype]: `proto/markdownSourceLines.ts` in the scratch folder is the module as this section gives it; the code blocks here are cut from it. `proto/markdownSourceLines.hooked.ts` is the same file with trace lines ending `//HOOK`, which the probes read; without those lines the two files are equal. The whole library suite was run with the module and this plan's two test files in place, on the copy the first note describes: 591 files, 20,194 tests pass and 2 are `todo`. `eslint` reports nothing on the module, and `npm run typecheck:test` is clean.

[^numbers]: The columns "Tail candidate tried, base candidate taken" and "A prefix tab written as spaces", and H5, come from the trace lines of `proto/markdownSourceLines.hooked.ts`, which was the module for every run of this table. `zz-lr-equiv.test.ts` then compared it with the module without them on 84,520 cases, review 5's and review 4's tab sets among them: `differ` 0. The first version of this plan, on 18.0.9 and without the tab rule, measured the first and third sets with the same counts, and the second and fourth with 14,808 and 711 newly acting, 17,098 and 565 differing, and 7,060 and 42 tail candidates that fell back. Then 4,280 of review 5's and 12 of review 4's tail candidates could not be built, mostly on a tab in an item's indentation; now 529 of review 5's cannot (a wrap item the token search does not place), and the rest of the 5,305 are built and rejected by the check, the base's edit taken, for the reasons the clauses note lists. Review 4's WYSIWYG results were recorded on the older base; its tab sets are not counted under P.

[^clauses]: For documents in the form the editor saves, the previous implementation put every case of the planner's probe where the surfaces differ under a clause of the docs (its note D22): 11,078 cases, of which 6,678 stood under the three clauses "to go". With this plan:

    | Of the 6,678 | Cases |
    |---|---|
    | read as the WYSIWYG result | 5,346 |
    | `setBlockType` on a block an item holds, or on the heading or quote it opens with | 628 |
    | looseness alone | 386 |
    | a thematic break inside the selection | 200 |
    | the WYSIWYG surface acts on a raw Markdown block as a whole | 81 |
    | an empty list item inside the selection | 20 |
    | a selection that takes the line after a backslash line break | 9 |
    | the document holds a list the WYSIWYG surface keeps as a raw block | 8 |

    The 4,400 other cases are unchanged and keep their clause. Of the 21,053 cases that read alike at the base, 59 now differ, all of the kind of L2. The planner's sets hold no tab, and this table is the same on 18.1.0 with the tab rule as it was for the first version of this plan (`rundump.sh`, then `cat2.py` of `scratch-keep/plans3/source-list-lift/`). For hand-written text the tail candidate fell back to the base candidate for these reasons, counted on review 5's rows (5,305) and on the generated set (1,670): the lifted text read otherwise (an open fence; whitespace at a list's end, a closing fence followed by a tab among them; a line after the list whose reading depends on the list, such as a numbered item or a setext underline under a moved block), the list item that ends the tail was not placed (529 of review 5's), or two containers came to read as one. `out/` in the scratch folder has each case.

[^cost]: The timings are the least of three runs each, on a machine another planner's suites were using, and vary by up to a factor of two between runs. The base's own cost grows with lines times blocks, because `containersOfLine` walks every block for every line of the lifted region; the second-long figures are the base's. `planLifts` reads each lift's wrap item once, and `wrapperItemAfter` walks up from the block, so a selection of n blocks in one item costs n short walks, not n walks of the whole item.

[^code-join]: 76 of the 2,017,812 generated cases, all with a fenced code block in the selection and a task item below it. The base joins the same way in 1,476 cases of that set where it acts.
