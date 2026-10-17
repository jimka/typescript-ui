---
depends-on: [markdown-editor-raw-block-range-edits, markdown-editor-cross-item-range-removal, markdown-editor-list-looseness-transform-cost]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/reference/changelog/next.md
---

# MarkdownEditor Large Document Costs — Implementation Plan

## Overview

In `MarkdownEditor`'s WYSIWYG mode some edits take time that grows with the square of the document, and one load grows with its cube. `markdown-editor-list-looseness-transform-cost` removes one such path, the looseness read of a changed list item. This plan removes the seven that are left. They were found by a survey of edits on 13 kinds of document at 500 to 8,000 blocks, with that plan's code in place, and by a CPU profile of each edit that grew faster than its document. Each was then timed before and after.[^survey]

| # | Path | Seen as | Cause |
|---|---|---|---|
| P1 | A rule that checks one block asks whether anything in the whole document uses link reference definitions. | A paste of n paragraphs, a format over n paragraphs, n paragraphs made code blocks: n walks of the document. | `$collectDefinitions` → `$needsDefinitions`, [markdownSerializer.ts:748](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L748) |
| P2 | The raw-block rule asks the same question once for every raw block it looks at. | A document of reference links and definitions: every keystroke walks the document once per raw block; its load once per raw block per paragraph. | the default value of `$rawBlockWritesAsParagraph`'s second parameter, [markdownSerializer.ts:2183](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2183) |
| P3 | The raw-block rule looks at every sibling of every changed block. | A load or a paste of n blocks beside m raw blocks: n × m checks. | `checkSiblings`, [markdownWritable.ts:904](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L904) |
| P4 | Each item lifted out of a list makes a new list for the items after it and moves them all into it. | `setBlockType` over a list of n items: n × n / 2 moves. | `$splitListAfter`, [markdownListItemNode.ts:869](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L869) |
| P5 | Lexical counts a node's place among its siblings by walking them, each time a node is removed or put after another. | Every list toggle and block type over n items: n walks of the list. | `$removePlainly`, `getIndexWithinParent` in `$liftItemOut` and `$splitListAfter` |
| P6 | A list toggle over blocks that go back into the list they came from leaves one list for each of them, and the list rule joins those one at a time. | The bulleted toggle over a bulleted list whose n items each hold a paragraph: n joins, each of a list that has grown. | `$makeItemsOfRun`, [MarkdownEditor.ts:3283](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3283) |
| P7 | A save lexes every unchanged block that starts with a `:::` opening line together with everything written after it. | A document of n `:::` blocks: each save lexes the document n / 2 times over. The editor saves after every update, so every typed letter and every caret move does. | `fenceClosedAfter` → `readsOtherwiseAfter`, [markdownSerializer.ts:1391](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1391) |

Measured headless, in ms, each run alone on an idle machine; the median of three runs (two at 8,000 and at the small sizes), with the lowest and the highest in brackets.[^machine] A document's size is its number of blocks: paragraphs, list items, raw blocks.

| Edit | Blocks | Before | After |
|---|---|---|---|
| A paste of the whole document into an empty one, plain paragraphs | 500 | 350 [350–354] | 41 [37–43] |
|  | 2,000 | 5,471 [5,410–5,596] | 192 [187–195] |
|  | 8,000 | 82,075 [81,341–82,808] | 1,872 [1,833–1,911] |
| Bold over every paragraph | 500 | 247 [239–261] | 45 [42–61] |
|  | 2,000 | 3,295 [3,263–3,371] | 165 [164–169] |
|  | 8,000 | 49,990 [47,672–52,308] | 646 [643–650] |
| Every paragraph made a code block | 500 | 227 [222–228] | 21 [20–26] |
|  | 2,000 | 3,197 [3,046–3,220] | 83 [83–87] |
| `setBlockType("h2")` over one tight list | 500 | 188 [185–203] | 40 [36–46] |
|  | 2,000 | 2,753 [2,687–2,842] | 160 [157–161] |
|  | 8,000 | 41,840 [41,682–41,999] | 637 [633–640] |
| The bulleted toggle over a list whose items each hold a paragraph | 500 | 254 [253–278] | 47 [41–48] |
|  | 2,000 | 4,044 [3,963–4,122] | 182 [174–183] |
|  | 8,000 | 79,828 [68,799–90,858] | 740 [731–749] |
| The numbered toggle over one tight list | 500 | 56 [55–56] | 50 [49–50] |
|  | 2,000 | 369 [340–369] | 217 [212–219] |
|  | 8,000 | 4,228 [4,203–4,252] | 841 [840–842] |
| A typed letter in a document of `:::` column blocks | 500 | 137 [133–141] | 11 [11–20] |
|  | 2,000 | 2,035 [2,032–2,051] | 31 [31–36] |
|  | 8,000 | 34,367 [33,148–35,587] | 130 [128–132] |
| The load of raw blocks | 50 | 136 [127–144] | 17 [7.1–28] |
|  | 100 | 930 [924–936] | 9.0 [6.8–11] |
|  | 200 | 7,031 [7,021–7,040] | 12 [8.5–16] |
| The load of reference links, a definition after each | 50 | 170 [169–171] | 10 [7.7–13] |
|  | 100 | 1,280 [1,277–1,283] | 11 [11–12] |
|  | 200 | 9,916 [9,792–10,040] | 27 [26–28] |
| A typed letter in that document | 50 | 5.3 [5.0–5.7] | 2.6 [1.9–3.2] |
|  | 100 | 12 [12–13] | 3.2 [3.1–3.3] |
|  | 200 | 39 [39–39] | 5.3 [5.1–5.4] |

The after column is with all three parts. Without part C the bulleted toggle over a list whose items each hold a paragraph stays as before (252, 3,830 and 74,739 ms); no other row needs part C.

The plan has three parts, each a few small edits. Part A (P1 to P3 and P7) changes how the rules read definitions, which raw blocks a changed block checks, and how much a save lexes for a `:::` block: `markdownSerializer.ts` and `markdownWritable.ts`. Part B (P4 and P5) changes how items leave a list: `markdownListItemNode.ts`. Part C (P6) is one edit of one function of `MarkdownEditor.ts`. One new test file pins each cost by counting calls. No public API changes.

Parts A and B leave every document, save, selection and undo step as it is.[^identical] Part C changes one save, of a rare toggle, to what the docs already say it is. Part C therefore waits for the user's sign-off; see *P6* and *One decision awaits the user's sign-off*.

Line numbers are those of `fef32344b`, the tip of `feature/markdown-editor-raw-block-edge-cases`. The three plans in `depends-on` edit the same files first, so find each site by its symbol name. Where a dependency renames a symbol this plan edits, both names are given.

---

## Architecture Decisions

### One plan, three parts

The seven fixes are small and stand apart, so they are one plan. The three parts touch different files, are committed apart, and are checked apart.[^one-plan]

| Part | Paths | Checked as |
|---|---|---|
| A | P1, P2, P3, P7 | every recorded update identical, node keys included |
| B | P4, P5 | every recorded update identical with each node named by where it stands: the fix for P4 makes fewer short-lived nodes, so the nodes that stay get other keys |
| C | P6 | as part B, but for two things P6 changes: one flag of an update's dirty set, and the save of one kind of toggle |

### P1 — a block is read under the definitions only when it holds something they decide

A rule that writes a block and reads it back needs the document's definitions for two things only: to write a reference link in its own form, and to read back a run kept as source that holds a `[`. Today each such rule first asks whether *any* node of the document is one of those (`$needsDefinitions`, a walk of the whole document), and passes the definitions when one is. The new `$definitionsReader` asks the same of the nodes being written, and reads the document's definitions only for those that hold one.[^local]

| The block being checked | Elsewhere in the document | Today | After |
|---|---|---|---|
| plain text, or text with an inline link | no reference link | walks the document; passes no definitions | walks the block; passes no definitions |
| plain text, or text with an inline link | a reference link | walks the document; reads and passes the definitions | walks the block; passes no definitions |
| holds a reference link, or a kept `[][ref]` | anything | walks the document; reads and passes the definitions | walks the block; reads and passes the definitions |
| holds a reference link, and is outside the document: a copy of a block, or a block being joined away | no reference link | walks the document; passes no definitions | walks the block, then the document; passes no definitions |

The second row is the only one where what is passed differs. A block that holds no reference reads the same under any definitions: the serializer escapes every bracket of text, so its Markdown holds nothing a definition can turn into a link. `registerDefinitionRules` already rests on that.[^reads-alike]

The last row keeps what a block outside the document gets today. The walk of the document finds attached nodes only, so such a block's own reference does not count, and the block gets the definitions only when the document holds another reference. `$definitionsReader(true)` asks the document for that case alone.[^outside]

The four exported readers change: `$serializeBlock`, `$serializeInlineNodes`, `$readsBackAsShown` and `$runsReadingOtherwise`. `$collectDefinitions` has no caller left and is deleted. `$needsDefinitions` stays, for `$readDefinitions`, which asks once per save, and for the last row.

### P2 — the raw-block rule passes no definitions

`$rawBlockWritesAsParagraph(node, definitions)` uses the definitions for one question: does a block after the raw block write anything. Its second parameter defaults to `$collectDefinitions()`, read anew for every raw block the rule looks at. The default becomes `null`. Whether a block writes anything does not depend on the definitions, which `$writesSomething` states and relies on already.[^emptiness]

### P3 — a changed block checks the raw blocks its change reaches

A raw block is written as a paragraph by what follows it. So a changed block can change that answer only for itself and for the raw blocks before it, back to the nearest block that writes something: a raw block further back already had that nearer block after it.

| Blocks of one parent, in order | Changed | Raw blocks checked |
|---|---|---|
| raw `A`, paragraph `p`, raw `B`, empty paragraph, paragraph `q` | `q` gets text | `B` (the empty paragraph ends no reach; `B`, which writes, does) |
| the same | `p` gets text | `A` |
| the same | raw `B`'s text is edited | `B`, and no other: `p` writes |

The first changed block of a parent in an update still checks every raw block of the parent, as every changed block does today. That one whole check sees everything the update's command changed in that parent before any rule ran. Each later changed block of that parent, in the same update, checks what its own change reaches (`$showRawBlocksBeforeAsWritten`).[^first-whole]

"One update" is tracked as `registerDefinitionRules` ([markdownWritable.ts:1178](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1178)) tracks it, and as the looseness plan's `readWhole` does: a variable of `registerRawBlockRules`, checked against `editor.getEditorState()`, and cleared by an update listener.

`markdown-editor-raw-block-range-edits` moves `checkSiblings` and `$showRawBlockAsSaved` out of `registerRawBlockRules` and calls `$showRawBlockAsSaved` from a command. A command's call keeps the whole check: `$showRawBlockAsSaved` takes the check of the siblings as a second parameter, which defaults to the whole one, and only the node transforms pass the tracked one.[^range-edits]

### P4 — an item lifted off the front of a list this update made needs no new list

`$liftItemOut` puts the lifted blocks after the item's list, and `$splitListAfter` then makes a copy of the list for the item's later items and moves them into it. `setBlockType` lifts a run of items first to last, so from the second item on, the list being split is the copy the item before it made, and the lifted item is its first. For that case the lifted blocks go *before* the list, and the list stays as the rest: no copy and no move.

| List, lifting `a` then `b` | Today | After |
|---|---|---|
| `[a, b, c, d]`, lift `a` | `a`; a new list `R1 = [b, c, d]`; the old list goes | the same |
| lift `b`, the first item of `R1` | `a`, `b`; a new list `R2 = [c, d]`; `R1` goes | `a`, `b`; `R1 = [c, d]` |

The rule applies only to a list that the running update made. A list that was in the document before keeps what it does today, so which node a list is after the edit does not change for any node that existed before it.[^made-now]

The lists that are no longer made were made and dropped within one update. Lexical numbers nodes as they are made, so the nodes an edit leaves get lower key numbers than today. Nothing reads those numbers; the differential compares part B with each node named by where it first appears.[^by-name]

### P5 — a node leaves or joins without a walk over its siblings

Lexical's `remove` and `insertAfter` count the node's place among its siblings, by walking them from the first, so that a selection point standing on the parent can be kept in place. With no point on the node, in it or on its parent, that count is not used. Two helpers do the same work without it in that case, with Lexical's exported `$removeFromParent` and its own `insertAfter` called without selection handling, and fall back to the calls of today in every other case.[^unwalked]

| Call today | Walk | After |
|---|---|---|
| `$removePlainly(item, true)` in `$splitListAfter` | the list, up to the item | `$removeUnwalked(item, true)` |
| `parent.splice(list.getIndexWithinParent() + 1, 0, moved)` in `$liftItemOut` | the document, up to the list | `$insertAfterUnwalked(list, moved)` |
| `parent.splice(last.getIndexWithinParent() + 1, 0, [restList])` in `$splitListAfter` | the document, up to the lifted blocks | `$insertAfterUnwalked(last, [restList])` |
| `item.insertAfter(next)` in `$splitItemBefore` | the list, up to the item | `$insertAfterUnwalked(item, [next])` |
| `list.remove()` of an emptied list in `$splitListAfter` | the document, up to the list | `$removeUnwalked(list)` |

### P6 — the toggle joins the list it has made adjacent

`$makeItemsOfRun` puts a run of blocks into the list right before the run when there is one. When a list of the same kind also stands right after the run, it leaves that second list where it is, for the list rule (`$normalizeList`) to join later. A toggle over n blocks of one list therefore leaves n lists side by side, and the list rule joins them from the last to the first, each time moving, numbering and reading the list it has grown to. `$makeItemsOfRun` now moves the second list's items into the first itself, when the two write the same marker, which is when the list rule would join them.[^join-now]

The join then happens in the command and not in a later pass of the rules. Two things come out differently.

**One save.** A toggle handles its runs first to last, and a run between two lists makes the list before it loose when the list after it is loose. Today that looseness is lost when the list rule later joins that list into the one before it. With the join made at once it is kept, as `docs/components/MarkdownEditor.md` says of the toggles: the joined list is "loose when one of them is loose".[^chain]

| Document, bulleted toggle | Today | After |
|---|---|---|
| `* a⏎⏎p⏎⏎* b⏎⏎q⏎⏎* c⏎⏎* d`, from `p` to `q`: a tight list, a run, a tight list, a run, a loose list | `* a⏎* p⏎* b⏎* q⏎* c⏎* d`: all tight, the list `c`, `d` too, which the selection did not touch | `* a⏎⏎* p⏎⏎* b⏎⏎* q⏎⏎* c⏎⏎* d` |
| `* a⏎⏎q⏎⏎* c⏎⏎* d`, caret in `q`: a tight list, a run, a loose list | `* a⏎⏎* q⏎⏎* c⏎⏎* d` | the same |
| `* a⏎⏎p⏎⏎* b⏎⏎q⏎⏎* c⏎* d`, from `p` to `q`: all three lists tight | `* a⏎* p⏎* b⏎* q⏎* c⏎* d` | the same |

**One flag.** The committed document, the selection, the undo steps and the nodes in the update's dirty set are otherwise the same. Lexical flags each dirty element as written itself or as holding something written, by the last pass that touched it, and the list that takes the run is flagged `false` where it was flagged `true`.[^join-flag]

### P7 — a block that closes its own fence is not asked about what follows it

A save writes an unchanged block as its source. `fenceClosedAfter` first asks, for every such block whose source starts with a `:::` opening line, whether what is now written after the block closes that fence. It answers by lexing the block's text together with the whole rest of the document. A block whose own text holds the line that closes its fence reads the same whatever follows it. The new `closesOwnFence` lexes the block alone, and `fenceClosedAfter` lexes the rest of the document only for a block that leaves its fence open.[^own-fence]

| The unchanged block's source | Written after it | Today | After |
|---|---|---|---|
| `::: columns⏎left⏎\|\|\|⏎right⏎:::` | anything | lexes the block with everything after it; the block is written as its source | lexes the block alone; the same |
| `::: note`, which no line closes: a paragraph | a pasted raw block `<div>⏎:::⏎</div>` | lexes the block with everything after it; the block is written `\::: note` | the same |
| `::: note` | nothing that holds a `:::` line | lexes the block with everything after it; the block is written as its source | the same |

(`⏎` is a line end.)

### The costs are pinned by counting calls

A test of elapsed time is flaky. The test file wraps five functions in spies that still do their work, and counts calls: the idiom of `markdown-source-preservation.test.ts` ([:22](../packages/lib/tests/component/markdown-source-preservation.test.ts#L22), [:441](../packages/lib/tests/component/markdown-source-preservation.test.ts#L441)) and of the looseness plan's test.[^count]

| Path | What is counted | Pinned as |
|---|---|---|
| P1, P2 | walks of the whole document: calls of `$dfs()` with no start node | the same number for 20 and 40 blocks |
| P3 | calls of `$rawBlockWritesAsParagraph` | at most 8 for each raw block, at 40 and at 80 |
| P4 | calls of `$copyNode` | the same number for 20 and 40 items, for a plain list and for one whose items hold a paragraph |
| P5 | siblings walked: the sum of what `getIndexWithinParent` returns | at most 2 for each item, at 40 and at 80 |
| P6 | calls of `$listReadsLoose` | the same number for 20 and 40 items |
| P7 | characters handed to `lexMarkdown` in one save, for each character saved | at most 4, at 40 and at 80 `:::` blocks |

The spies replace modules for the whole file, so the rows go in a new file, `markdown-editor-large-document-costs.test.ts`.

### One decision awaits the user's sign-off

Parts A and B change nothing a user sees. Part C does, in one case. The plan is written for the recommended answer.

| # | Decision | Recommended | In this plan |
|---|---|---|---|
| 1 | Part C (P6): a list toggle over two or more runs of blocks that stand between lists of one marker gives a loose list when a list after the second or a later run is loose. Today it gives a tight one, and writes that untouched loose list tight. | yes. Today's result takes the blank lines from a list the selection did not touch, and the docs already describe the result of after. Without part C the bulleted toggle over a list whose items each hold a paragraph stays quadratic: 0.25 s at 500 items, 3.8 s at 2,000 and 75 s at 8,000, where part C makes it 0.05 s, 0.18 s and 0.74 s | yes |

A no leaves part C out: step 11, the edit of `MarkdownEditor.ts`, the second changelog entry, and rows `L5`, `L6` and `S8` of the test file, which then goes in with part B's commit.

### What still grows faster than the document

Five paths are left. This plan names them and does not remove them.[^what-remains]

| Path | Seen as | Why it stays |
|---|---|---|
| An update that changes many blocks which each hold a reference link reads the document's definitions once or twice for each of them. | A paste of 1,000 reference links with their 1,000 definitions: 28 s after this plan. Every such block made a code block: 1.7 s. Before this plan the same paste took 10 s at a tenth of that size and grew with the cube. | One read for the whole update would need to know that nothing was written between two reads, which Lexical does not record. |
| `marked` lists every definition for each block it lexes, and the lexer the editor reads a block back with copies them first. | The load of 1,000 reference links with their 1,000 definitions: 0.5 s, growing with the power 1.4 between 500 and 2,000 blocks. | The listing is `marked`'s own code, and it is of the same order as the copy. |
| Lexical's own paste counts each pasted top-level block's place among its siblings. | A paste of 8,000 paragraphs: 1.9 s. In a CPU profile three quarters of that paste is Lexical's `insertNodes`. | The code is Lexical's. |
| An unchanged block that leaves a `:::` fence open, or ends inside an open definition label or title, is still lexed with everything written after it. | Not seen in a document of the survey; it needs many such blocks. | What closes such a block can stand anywhere after it. |
| Two rules look at a whole block once for each changed text in it, or cost more than the block's length each time: the line-break rule, which writes a heading each time, and the reading of a raw block's source. | `setBlockType("h2")` over a document that ends in one raw block of 1,000 lines: 4.7 s. The load of that document: 0.8 s, a third of it for that one block. | These grow with the lines of one block, not with the number of blocks. Blocks of many lines were not surveyed, so the plan would fix single cases of a kind it has not measured. |

---

## Internal Structure

Every block below is the final code. It was applied as printed to a private copy of `fef32344b` that holds the looseness plan's code and the shape `markdown-editor-raw-block-range-edits` gives `registerRawBlockRules`; that copy typechecks, lints clean and passes the 28 rows.

### `markdownSerializer.ts` — P1, P2 and P7

Replace `$collectDefinitions` ([:740–750](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L740), its JSDoc and body) by these two functions. `$needsDefinitions`, right after it, stays as it is.

```typescript
/**
 * Makes a reader of the definitions that nodes are written and read back
 * under: the document's ({@link $documentDefinitions}) for nodes that hold
 * something they decide ({@link $referenceIn}), and none for any other
 * nodes, whose Markdown reads alike under any definitions. The document is
 * read at most once, for the first nodes that need it, so a reader serves
 * one pass over a block's runs, during which nothing is written.
 *
 * A rule that checks many blocks in one update therefore reads the document
 * only for the blocks that hold a reference, where asking whether anything
 * in the document does ({@link $needsDefinitions}) walked the whole
 * document for each block.
 *
 * @param asksDocument - Whether nodes that hold a reference outside the
 *   document — a copy of a block, a block being joined away — get the
 *   definitions only when the document itself holds a reference, which is
 *   what the readers that asked the document first gave them.
 * @returns The reader: the definitions for the nodes it is given, or `null`.
 */
function $definitionsReader(asksDocument: boolean): (nodes: readonly LexicalNode[]) => Links | null {
    let read: Links | null = null;

    return (nodes) => {
        const reference = $referenceIn(nodes);

        if (reference === null) {
            return null;
        }

        const isDecided = !asksDocument || reference.isAttached() || $needsDefinitions();

        if (!isDecided) {
            return null;
        }

        read ??= $documentDefinitions();

        return read;
    };
}

/**
 * Finds, among nodes and at any depth in them, the first node the
 * document's definitions decide: a reference link, which needs them to be
 * written in its own form, or a run kept as source holding a `[`, which may
 * be a reference (`[][label]`) whose reading needs them.
 *
 * @param nodes - The nodes.
 * @returns The first such node, or `null` when they hold none.
 */
function $referenceIn(nodes: readonly LexicalNode[]): LexicalNode | null {
    for (const node of nodes) {
        const isReference = $isReferenceLinkNode(node) || ($isMarkdownSourceTextNode(node) && node.getSource().includes(LABEL_OPEN));

        if (isReference) {
            return node;
        }

        const inside = $isElementNode(node) ? $referenceIn(node.getChildren()) : null;

        if (inside !== null) {
            return inside;
        }
    }

    return null;
}
```

Change the five call sites. Nothing else in these functions changes.

| Function | Today | After |
|---|---|---|
| `$serializeBlock` ([:899](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L899)) | `serializeBlock(node, $collectDefinitions())` | `serializeBlock(node, $definitionsReader(true)([node]))` |
| `$serializeInlineNodes` ([:913](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L913)) | `definitions: $collectDefinitions()` | `definitions: $definitionsReader(true)(nodes)` |
| `$readsBackAsShown` ([:935](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L935)) | `const definitions = $collectDefinitions();` and `{ ...context, definitions }` | `const definitionsFor = $definitionsReader(true);` and `{ ...context, definitions: definitionsFor(nodes) }` |
| `$runsReadingOtherwise` ([:955](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L955)) | `const definitions = $documentDefinitions();` and `{ ...base, definitions }` | `const definitionsFor = $definitionsReader(false);` and `{ ...base, definitions: definitionsFor(nodes) }` |
| `$rawBlockWritesAsParagraph` ([:2183](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2183)) | `definitions: Links \| null = $collectDefinitions()` | `definitions: Links \| null = null` |

In `$readsBackAsShown` and `$runsReadingOtherwise` the variable `nodes` is the first element of the pair each `inlineRuns` entry destructures, already in scope where `definitions` was used. `$runsReadingOtherwise` passes `false`: it never asked the document, so a block outside the document that holds a reference gets the definitions there, as today.

In the JSDoc of `$rawBlockWritesAsParagraph`, the `@param definitions` text becomes: "The saved document's link reference definitions, or `null`, which the rules pass: the definitions only choose how a reference link is written, never whether a block after the raw block writes anything."

Export `$writesSomething` ([:2493](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2493)): add `export` before `function`. P3 calls it.

For P7, replace the body of `fenceClosedAfter` ([:1391](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L1391)), whose JSDoc stays, and add `closesOwnFence` directly after it:

```typescript
function fenceClosedAfter(blocks: readonly WrittenBlock[], index: number): boolean {
    const text = blocks[index]!.text;
    const leavesFenceOpen = FENCE_OPENING_START.test(text) && index < blocks.length - 1
        && !closesOwnFence(text, separatorBefore(blocks, index + 1));

    return leavesFenceOpen && readsOtherwiseAfter(blocks, index, () => 0);
}

/**
 * Tells whether a block that starts with a `:::` opening line closes that
 * fence itself: lexed alone, its text starts with the fence's token, and a
 * line end follows that token's closing line. Nothing written after such a
 * block changes how it reads. The fence's tokenizer is the first rule `marked`
 * tries at the block's start; it reads line by line from the opening line and
 * stops at the line that closes the fence, so it returns the same token
 * whatever follows that line.
 *
 * @param text - The block's text, which starts with a `:::` opening line.
 * @param separatorAfter - What is written between the block and the next one.
 * @returns `true` when the fence the block opens ends inside the block.
 */
function closesOwnFence(text: string, separatorAfter: string): boolean {
    const first = lexMarkdown(text).find((token) => token.type !== "space");

    if (first?.type !== "mdblock") {
        return false;
    }

    // The closing line is whole: the text after it starts a new line, so nothing is added to it.
    return (text.slice(first.raw.length) + separatorAfter).startsWith("\n");
}
```

`labelClosedAfter` and `readsOtherwiseAfter` do not change.

### `markdownWritable.ts` — P3

Add `$writesSomething` to the import from `markdownSerializer.js`. `NodeKey` is in the type import from `"lexical"` since the looseness plan.

After `markdown-editor-raw-block-range-edits`, `$showSiblingRawBlocksAsWritten` (`checkSiblings` at `fef32344b`) and `$showRawBlockAsSaved` stand at module level before `registerRawBlockRules`. Give `$showRawBlockAsSaved` its second parameter, add the interface before the first of the two, and replace the body of `registerRawBlockRules`. The result:

```typescript
/** The elements whose raw blocks a changed block has checked whole in one update. */
interface BlocksCheckedWhole {
    /** The committed state the update started from. */
    readonly from:    EditorState;
    /** The keys of the elements checked whole. */
    readonly parents: Set<NodeKey>;
}

/**
 * Shows the raw blocks among a changed block's siblings that the save writes
 * as a paragraph as that paragraph ({@link $showRawBlocksAsWritten}).
 *
 * @param node - The block that changed.
 */
function $showSiblingRawBlocksAsWritten(node: LexicalNode): void {
    const parent = node.getParent();

    if (parent !== null) {
        $showRawBlocksAsWritten(parent);
    }
}

/**
 * Shows a raw block whose text or place changed as its save reads:
 * without the blocks a join left inside it, which follow it
 * ({@link $moveBlocksOutAfter}: its text is read next, and theirs is
 * none of it); as the paragraph it is written as, else as the blocks its
 * own text reads as; and where it stays a raw block in a list item that
 * no raw block of its text can stand in, the whole list read again. Each
 * step runs only while the one before it left the raw block in place.
 *
 * @param node - The raw block.
 * @param $showSiblings - The check of the raw block's siblings: of every
 *   raw block among them, unless the caller keeps track of what an update
 *   has checked already, as the node transforms do.
 */
export function $showRawBlockAsSaved(node: MarkdownRawBlockNode, $showSiblings: (node: LexicalNode) => void = $showSiblingRawBlocksAsWritten): void {
    const steps = [$moveBlocksOutAfter, $showSiblings, $showRawBlockAsItsBlocks, $readListAgainAroundRawBlock];

    for (const step of steps) {
        const inPlace = node.isAttached();

        if (inPlace) {
            step(node);
        }
    }
}
```

`registerRawBlockRules` keeps its JSDoc. Its body becomes:

```typescript
function registerRawBlockRules(editor: LexicalEditor): () => void {
    let checkedWhole: BlocksCheckedWhole | null = null;

    /**
     * Shows the raw blocks a changed block can have made a save write as a
     * paragraph as that paragraph. The first changed block of a parent in
     * an update checks every raw block of the parent
     * ({@link $showSiblingRawBlocksAsWritten}), which also takes in what
     * the update's command changed elsewhere in it; each later one checks
     * the raw blocks its own change reaches
     * ({@link $showRawBlocksBeforeAsWritten}). An update that changes many
     * blocks of one parent, such as a load or a paste, therefore checks each
     * raw block a fixed number of times, not once for each changed block.
     *
     * @param node - The block that changed.
     */
    const $showSiblingsOnceWhole = (node: LexicalNode): void => {
        const parent = node.getParent();

        if (parent === null) {
            return;
        }

        const from = editor.getEditorState();

        if (checkedWhole?.from !== from) {
            checkedWhole = { from, parents: new Set() };
        }

        const key = parent.getKey();
        const isCheckedWhole = checkedWhole.parents.has(key);

        if (!isCheckedWhole) {
            checkedWhole.parents.add(key);
            $showSiblingRawBlocksAsWritten(node);

            return;
        }

        $showRawBlocksBeforeAsWritten(node);
    };

    return mergeRegister(
        editor.registerNodeTransform(RootNode, $showRawBlocksAsWritten),
        editor.registerNodeTransform(MarkdownColumnNode, $showColumnRawBlocksAsWritten),
        editor.registerNodeTransform(ListItemNode, $showRawBlocksAsWritten),
        editor.registerNodeTransform(MarkdownRawBlockNode, (node) => {
            $showRawBlockAsSaved(node, $showSiblingsOnceWhole);
        }),
        editor.registerNodeTransform(ParagraphNode, $showSiblingsOnceWhole),
        editor.registerNodeTransform(MarkdownListItemTextNode, $showSiblingsOnceWhole),
        editor.registerNodeTransform(TextNode, (text) => {
            const parent = text.getParent();

            if ($isMarkdownRawBlockNode(parent)) {
                $showRawBlockAsSaved(parent, $showSiblingsOnceWhole);
            }
        }),
        // An undo can bring back the very state an update started from; the next update starts afresh.
        editor.registerUpdateListener(() => {
            checkedWhole = null;
        }),
    );
}
```

Add the new function directly before `$showRawBlocksAsWritten` ([:1129](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1129)), which does not change:

```typescript
/**
 * Turns into a paragraph each raw block that a change of one block can have
 * made a save write as one ({@link $rawBlockWritesAsParagraph}): the block
 * itself, when it is a raw block, and the raw blocks before it up to the
 * nearest block that writes something. A raw block is written as a paragraph
 * by what follows it, and a raw block further back already had that nearer
 * block after it. They are turned in document order, as
 * {@link $showRawBlocksAsWritten} turns them.
 *
 * @param node - The block that changed.
 */
function $showRawBlocksBeforeAsWritten(node: LexicalNode): void {
    const reached: MarkdownRawBlockNode[] = [];

    for (let block: LexicalNode | null = node; block !== null; block = block.getPreviousSibling()) {
        const current: LexicalNode = block;
        const isRawBlock = $isMarkdownRawBlockNode(current);

        if (isRawBlock) {
            reached.unshift(current);
        }

        const endsReach = !current.is(node) && $isElementNode(current) && $writesSomething(current);

        if (endsReach) {
            break;
        }
    }

    for (const raw of reached) {
        const asParagraph = $rawBlockWritesAsParagraph(raw);

        if (asParagraph) {
            raw.replace($createParagraphNode(), true);
        }
    }
}
```

What differs from the code the dependency leaves:

| Where | Before | After |
|---|---|---|
| `$showRawBlockAsSaved` | one parameter; its steps name `$showSiblingRawBlocksAsWritten` | a second parameter `$showSiblings`, which the steps name |
| the `MarkdownRawBlockNode` transform | `$showRawBlockAsSaved` | `(node) => { $showRawBlockAsSaved(node, $showSiblingsOnceWhole); }` |
| the `ParagraphNode` and `MarkdownListItemTextNode` transforms | `$showSiblingRawBlocksAsWritten` | `$showSiblingsOnceWhole` |
| the `TextNode` transform | `$showRawBlockAsSaved(parent)` | `$showRawBlockAsSaved(parent, $showSiblingsOnceWhole)` |
| new | — | `BlocksCheckedWhole`, `checkedWhole`, `$showSiblingsOnceWhole`, the update listener, `$showRawBlocksBeforeAsWritten` |

A call of `$showRawBlockAsSaved` from `MarkdownEditor.ts` (the dependency's `$removeGuardedRange`) is not changed: it passes one argument and gets the whole check.

### `markdownListItemNode.ts` — P4 and P5

Extend the value import from `"lexical"`:

```typescript
import {
    $copyNode, $createParagraphNode, $getEditor, $getNodeByKey, $getSelection, $hasAncestor, $isElementNode, $isRangeSelection, $isRootNode,
    $isRootOrShadowRoot, $removeFromParent, ElementNode, ParagraphNode,
} from "lexical";
```

Add three functions directly before `$movePointsBetween` ([:611](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L611)):

```typescript
/**
 * Tells whether a selection point stands where Lexical moves it as a node
 * leaves or joins a parent: on the node, inside it, or on that parent. With
 * no point there, Lexical's own removal and insertion leave the selection
 * as it is, and the place of the node among its siblings, which they count
 * by walking those siblings from the first, is not needed.
 *
 * @param node - The node that leaves or joins.
 * @param parent - The parent it leaves or joins.
 * @returns `true` when the selection is a range with a point there.
 */
function $holdsPointAt(node: LexicalNode, parent: LexicalNode): boolean {
    const selection = $getSelection();
    const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];

    return points.some((point) => {
        const at = point.getNode();

        return at.is(node) || at.is(parent) || $hasAncestor(at, node);
    });
}

/**
 * Removes a node as {@link $removePlainly} does, without the walk over its
 * earlier siblings that Lexical's removal makes to keep a selection point on
 * its parent in place: with no point on the node, in it or on its parent
 * ({@link $holdsPointAt}) the removal only unlinks the node, which
 * `$removeFromParent` does. Removing the items of a long list one by one
 * otherwise walks the list once for each of them.
 *
 * @param node - The node to remove.
 * @param preserveEmptyParent - Whether a parent left empty stays.
 */
export function $removeUnwalked(node: LexicalNode, preserveEmptyParent?: boolean): void {
    const parent = node.getParent();
    const selection = $getSelection();
    const isRange = $isRangeSelection(selection);
    const movesPoint = parent === null || !isRange || $holdsPointAt(node, parent);

    if (movesPoint) {
        $removePlainly(node, preserveEmptyParent);

        return;
    }

    $removeFromParent(node);

    // What Lexical's removal does after it unlinks a node.
    const leavesParentEmpty = preserveEmptyParent !== true && !$isRootOrShadowRoot(parent) && !parent.canBeEmpty() && parent.isEmpty();

    if (leavesParentEmpty) {
        $removePlainly(parent);
    }

    const leavesRootEmpty = $isRootNode(parent) && parent.isEmpty();

    if (leavesRootEmpty) {
        parent.selectEnd();
    }
}

/**
 * Puts nodes after a node, in order, as `ElementNode.splice` on its parent
 * does, without counting the node's place among its siblings: each goes in
 * by `LexicalNode.insertAfter`, whatever a class overrides, and the
 * selection is left as it is.
 *
 * @param node - The node to put them after.
 * @param inserted - The nodes, in the order they are to stand in.
 */
export function $insertAfterUnwalked(node: LexicalNode, inserted: readonly LexicalNode[]): void {
    let last = node;

    for (const each of inserted) {
        ElementNode.prototype.insertAfter.call(last, each, false);
        last = each;
    }
}
```

In `$splitItemBefore` ([:677](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L677)), the body becomes:

```typescript
export function $splitItemBefore(item: MarkdownListItemNode, block: LexicalNode): MarkdownListItemNode {
    const next = new MarkdownListItemNode();
    const list = item.getParent();
    const movesPoint = list === null || $holdsPointAt(next, list);

    if (movesPoint) {
        item.insertAfter(next);
    } else {
        $insertAfterUnwalked(item, [next]);
    }

    next.splice(0, 0, [block, ...block.getNextSiblings()]);

    return next;
}
```

In `$liftItemOut` ([:780](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L780)), replace the lines from `const after = item.getNextSiblings();` through `$splitListAfter(list, item, after, last);` by:

```typescript
    const last = moved[moved.length - 1]!;
    // The list is the rest list an earlier lift of this update made, and the item is its first: it needs no new one.
    // A point on the list itself is one Lexical moves when the list goes, so that case is left as it was.
    const opensRestList = item.getPreviousSibling() === null && $isMadeInThisUpdate(list) && $elementPointsOn(list).length === 0;

    if (opensRestList) {
        $putBefore(list, moved);
    } else {
        $insertAfterUnwalked(list, moved);
    }

    if (text !== null) {
        $removePlainly(text, true);
    }

    if (opensRestList) {
        $dropEmptied(list, item);
    } else {
        $splitListAfter(list, item, item.getNextSiblings(), last);
    }
```

Add three functions directly before `$putPointBefore` ([:837](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L837)):

```typescript
/**
 * Tells whether a node was made by the update that is running: the
 * committed state does not hold it.
 *
 * @param node - The node.
 * @returns `true` when no committed state holds the node yet.
 */
function $isMadeInThisUpdate(node: LexicalNode): boolean {
    const key = node.getKey();

    return $getEditor().getEditorState().read(() => $getNodeByKey(key) === null);
}

/**
 * Puts nodes right before a node, in order, without counting its place
 * among its siblings.
 *
 * @param node - The node to put them before.
 * @param inserted - The nodes, in the order they are to stand in.
 */
function $putBefore(node: LexicalNode, inserted: readonly LexicalNode[]): void {
    const previous = node.getPreviousSibling();

    if (previous === null) {
        node.getParentOrThrow().splice(0, 0, [...inserted]);
    } else {
        $insertAfterUnwalked(previous, inserted);
    }
}

/**
 * Ends the lift of a list's first item whose text and first blocks were put
 * before the list: the item goes when it holds nothing any more, and so
 * does the list. What is left is the list {@link $splitListAfter} would
 * have made for the item and the items after it, with nothing moved.
 *
 * @param list - The list.
 * @param item - Its first item, whose text and blocks were taken out.
 */
function $dropEmptied(list: ListNode, item: MarkdownListItemNode): void {
    const keepsItem = item.getChildrenSize() > 0;

    if (!keepsItem) {
        $removeUnwalked(item, true);
    }

    const listIsLeftEmpty = list.isEmpty();

    if (listIsLeftEmpty) {
        $removeUnwalked(list);
    }
}
```

In `$splitListAfter` ([:869](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts#L869)), three calls change:

| Today | After |
|---|---|
| `last.getParentOrThrow().splice(last.getIndexWithinParent() + 1, 0, [restList]);` | `$insertAfterUnwalked(last, [restList]);` |
| `$removePlainly(item, true);` | `$removeUnwalked(item, true);` |
| `list.remove();` | `$removeUnwalked(list);` |

### `MarkdownEditor.ts` — P6 (part C)

Add `$removeUnwalked` to the import from `markdownListItemNode.js`. At the end of `$makeItemsOfRun` ([:3283](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3283)), after its `list.splice(…)` line, add:

```typescript
    // The list rule would join `below` into `above` in its own time; a toggle over many blocks would leave it a list for each.
    const joinsBoth = joinsAbove && joinsBelow && $writtenListMarker(below) === $writtenListMarker(above);

    if (joinsBoth) {
        above.splice(above.getChildrenSize(), 0, below.getChildren());
        $removeUnwalked(below);
    }
```

`above` and `below` are narrowed to `ListNode` by `joinsAbove` and `joinsBelow`, which `joinsBoth` holds; keep all three `const`.

### `tests/component/markdown-editor-large-document-costs.test.ts`

The whole file is in *Addendum: the test file*.

---

## Ordered Implementation Steps

1. **Check the base.** The three plans in `depends-on` are in `plans/implemented/`. From the repository root:
   - `grep -n '\$collectDefinitions(' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` — expect five matches: the definition, and four of the five sites of the table in *P1, P2 and P7* (`$runsReadingOtherwise` calls `$documentDefinitions`; the default value of `$rawBlockWritesAsParagraph` is the fourth). If a plan in between added a caller, stop and report it.
   - `grep -n 'function \$showSiblingRawBlocksAsWritten\|export function \$showRawBlockAsSaved\|function registerRawBlockRules\|function \$showRawBlocksAsWritten' packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` — expect four matches.
   - `grep -n 'function \$liftItemOut\|function \$splitListAfter\|function \$splitItemBefore\|function \$removePlainly' packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` — expect four matches.
   - `grep -n 'function fenceClosedAfter\|function readsOtherwiseAfter\|function separatorBefore' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` — expect three matches.
   - `grep -c 'level: *"block"' packages/lib/src/typescript/lib/component/display/markdownExtensions.ts` — expect `1`: the `:::` tokenizer is the lexer's one block-level extension, which P7 rests on. With another count, stop and report it.
2. **Add the test file.** Create `packages/lib/tests/component/markdown-editor-large-document-costs.test.ts` with the content of *Addendum: the test file*, unchanged.
3. **See it fail.** From `packages/lib`: `npx vitest run tests/component/markdown-editor-large-document-costs.test.ts`. Expect 20 failed and 8 passed: `D1` to `D8`, `R1` to `R3`, `L1` to `L7`, `F1` and `S8` fail; `S1` to `S7` and `S9` pass. Any other split means the base differs from what this plan measured; stop and report it. Do not commit the test file yet: it goes in with the last part, so that no commit holds a failing row.
4. **Part A, `markdownSerializer.ts`.** Make the edits of *P1, P2 and P7*. Check: `grep -n '\$collectDefinitions' packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` — expect no match. Rows `D1` to `D8` and `F1` now pass, so 17 of the 28 rows pass; `R1` to `R3`, `L1` to `L7` and `S8` still fail.
5. **Part A, `markdownWritable.ts`.** Make the edits of *P3*. Check: rows `R1` to `R3` pass too, so 20 of the 28 rows pass; `L1` to `L7` and `S8` still fail.
6. **Static checks and suite for part A.** From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`. Every test other than `L1` to `L7` and `S8` passes.
7. **Commit part A** (the `commit` skill): the two source files, without the test file.
8. **Part B, `markdownListItemNode.ts`.** Make the edits of *P4 and P5*. Check: rows `L1` to `L4` and `L7` pass, so 25 of the 28 rows pass; `L5`, `L6` and `S8` still fail.
9. **Static checks and suite for part B.** As step 6; every test other than `L5`, `L6` and `S8` passes.
10. **Commit part B**: the one source file.
11. **Part C, `MarkdownEditor.ts`.** Only with a yes to the sign-off. Make the edit of *P6*. Check: all 28 rows pass.
12. **Static checks and suite for part C, and commit it** with the test file. Every test passes, 28 more than at the base.
13. **Run the differential** as in `## Verification`, *The differential*, for the three commits. If a line is not as expected, the change is wrong: do not adjust a test or a probe, stop and report the first differing file.
14. **Run the timings** as in `## Verification`, *The timings*, and record them in the Implementation Notes.
15. **Changelog.** Add the entries of `## Documentation Impact`.
16. **Docs and build checks.** From `packages/lib`: `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.
17. **Manual check** of `## Expected Behaviour`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-large-document-costs.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All rows are unit tests in `markdown-editor-large-document-costs.test.ts`.

### Cost rows — fail before the change, pass after

Rows `D1` to `D8` run on 20 and on 40 blocks and assert the same number of whole-document walks for both, and at most 20. A walk is a call of `$dfs()` with no start node.

| Row | Edit | Walks at 20 / 40, before | After |
|---|---|---|---|
| D1 | a paste of n paragraphs into an empty document | 56 / 96 | 16 / 16 |
| D2 | a paste of n paragraphs that each hold an inline link | 96 / 176 | 16 / 16 |
| D3 | bold over n paragraphs | 31 / 51 | 9 / 9 |
| D4 | n paragraphs made code blocks | 29 / 49 | 9 / 9 |
| D5 | a load of n raw blocks | 827 / 3,247 | 7 / 7 |
| D6 | a load of n raw blocks and n paragraphs | 1,227 / 4,847 | 7 / 7 |
| D7 | a load of n reference links and their n definitions | 1,227 / 4,847 | 7 / 7 |
| D8 | one letter typed in the document of D7 | 23 / 43 | 2 / 2 |

Rows `R1` to `R3` load a document of 40 and of 80 units and assert at most 8 calls of `$rawBlockWritesAsParagraph` for each unit.

| Row | Document | Calls for each unit at 40 / 80, before | After |
|---|---|---|---|
| R1 | n raw blocks | 81 / 161 | 5.9 / 6.0 |
| R2 | n raw blocks and n paragraphs | 121 / 241 | 5.0 / 5.0 |
| R3 | n reference links and their n definitions | 121 / 241 | 5.0 / 5.0 |

Rows `L1` to `L7` select every item of a list of n items and run one edit.

| Row | List | Edit | Counted | Before | After | Asserted |
|---|---|---|---|---|---|---|
| L1 | tight | `setBlockType("h2")` | calls of `$copyNode` at 20 / 40 | 18 / 38 | 1 / 1 | equal, at most 2 |
| L2 | tight | the numbered toggle | siblings walked for each item at 40 / 80 | 20.5 / 40.5 | 1 / 1 | at most 2 |
| L3 | tight | the bulleted toggle off | the same | 19.5 / 39.5 | 0 / 0 | at most 2 |
| L4 | tight | `setBlockType("h2")` | the same | 56.6 / 116.5 | 1 / 1 | at most 2 |
| L5 | each item holds a paragraph | the bulleted toggle | the same | 80 / 160 | 1 / 1, with part C | at most 2 |
| L6 | each item holds a paragraph | the bulleted toggle | calls of `$listReadsLoose` at 20 / 40 | 59 / 119 | 2 / 2, with part C | equal, at most 10 |
| L7 | each item holds a paragraph | `setBlockType("h2")` | calls of `$copyNode` at 20 / 40 | 19 / 39 | 1 / 1 | equal, at most 2 |

Row `F1` saves a document of n `:::` column blocks with a paragraph after each, and divides the characters handed to `lexMarkdown` during that save by the length of what is saved.

| Row | Counted | At 40 / 80 blocks, before | After | Asserted |
|---|---|---|---|---|
| F1 | characters lexed for each character saved | 21.5 / 41.6 | 0.79 / 0.79 | at most 4 |

### Rows that pin what the edits leave — pass before and after, but for `S8`

Row `S8` is part C's change: it fails until part C and passes after it.

| Row | Document | Steps | Expected |
|---|---|---|---|
| S1 | a tight list of 6 | `setBlockType("h2")` over all; one undo | six `## item` headings; then the list again |
| S2 | a tight list of 5 | `setBlockType("h2")` over the first three items | three headings, then `- item3⏎- item4` as one list |
| S3 | three items that each hold a paragraph | the bulleted toggle over all | `- item0⏎⏎- more0⏎⏎- item1⏎⏎- more1⏎⏎- item2⏎⏎- more2`, which reloads to itself |
| S4 | `<!-- open`, an empty paragraph appended after it | `x` typed in the paragraph | `\<!-- open⏎⏎x`: the comment shows as the paragraph it is saved as |
| S5 | `p0` | a paste of `<!-- a`, `x0`, `<pre>`, `x1` at the caret | a save that holds `\<!-- a` and reloads to itself |
| S6 | `::: note⏎⏎p0⏎⏎p1` | a paste of `x0`, the raw block `<div>⏎:::⏎</div>` and `x1` after the `p` of `p0` | `\::: note⏎⏎px0⏎⏎<div>⏎:::⏎</div>⏎⏎x10⏎⏎p1`, which reloads to itself: the opener is escaped, because the pasted block would close it |
| S7 | `::: columns⏎l0⏎\|\|\|⏎r0⏎:::⏎⏎p0` | the same paste | `::: columns⏎l0⏎\|\|\|⏎r0⏎:::⏎⏎px0⏎⏎<div>⏎:::⏎</div>⏎⏎x10`, which reloads to itself: the fence closes itself and stays as written |
| S8 | `* a⏎⏎p⏎⏎* b⏎⏎q⏎⏎* c⏎⏎* d` | the bulleted toggle from `p` to `q` | `* a⏎⏎* p⏎⏎* b⏎⏎* q⏎⏎* c⏎⏎* d`, which reloads to itself. Before part C: `* a⏎* p⏎* b⏎* q⏎* c⏎* d` |
| S9 | `* a⏎⏎q⏎⏎* c⏎⏎* d` | the bulleted toggle with the caret in `q` | `* a⏎⏎* q⏎⏎* c⏎⏎* d`, which reloads to itself |

(`⏎` is a line end.)

### Manual check — needs manual verification

The headless numbers leave out what the browser does to draw the document. In the demo's MD Editor page (`npx vite` in `packages/lib`): paste a document of 500 lines `text [link][rN] end` with their 500 definitions `[rN]: /uN`, a blank line between every two lines, into source mode, and switch to WYSIWYG. The switch takes about a second, not minutes, and a typed letter appears without a wait. Then load a tight bulleted list of 2,000 items, select all, and choose the heading block type: the headings appear in about a second, and one Ctrl+Z gives the list back. Last, load 600 blocks `::: columns⏎left⏎|||⏎right⏎:::` with a paragraph after each, and type in one of the paragraphs: each letter appears without a wait.

---

## Verification

From `packages/lib`: `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, `npm test`, `npm run docs:api`, `npm run docs:llms:check`, `npm run build:lib`.

### The differential

These rules decide what is shown as a paragraph, how a list is split and what a save escapes, so a wrong one changes documents without any error. The check runs the same probes on a private copy of the parent and of each of the three commits, and compares what they record.

The scripts and probes are in `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/large-doc/` (called `$K` below); `README.md` there describes each. Every probe runs with a setup file (`probes/zz-ld-digest.ts`) that writes one line for every committed update of every editor: a hash of the state's JSON, its node keys, the selection, the dirty elements and leaves, and the update's tags; and one more line for every Markdown value handed to the change seam and for every `getValue()`. It writes each line a second time, to a file ending in `.canon`, with every node named by where it first appeared in a committed state, in document order, in place of its key. A third file, ending in `.canon2`, adds to that line the same hash without the flags of the dirty elements, the hash without the dirty sets, and how many lists and how many other elements carry each flag.

```bash
K=~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans3/large-doc
$K/setup.sh parent <the commit the branch started from>
$K/setup.sh partA  <the commit of part A>
$K/setup.sh partB  <the commit of part B>
$K/setup.sh partC  <the commit of part C>
for side in parent partA partB partC; do $K/runside.sh $side $side 2; done
$K/cmpall.sh parent partA
CANON=1 $K/cmpall.sh parent partB
CANON=1 $K/cmpall.sh partB partC
python3 $K/cmprows.py partB partC
```

Use the tags `parent`, `partA`, `partB` and `partC`: the tags `base`, `fA`, `fB` and `f4` hold the planner's runs. `runside.sh` runs the families one after the other and is resumable: run the same line again after a break. Run one side at a time, with two jobs: each job is a vitest process of 0.5 to 2 GB, and the machine has run out of memory under more.

| Family | What it runs | Size |
|---|---|---|
| aimed set (`runaim.sh`) | 35 documents chosen for this plan: definitions, reference links, references kept as source, brackets in text, links and images; raw blocks that run on with empty and written blocks after them, in the document, in list items and in columns; runs of list items. At every text, 31 edits at a caret and 18 over each range of up to seven texts, joins and pairs of edits; then 2 × 1,500 random runs; every edit undone and redone. A state is recorded after the load and after every edit, undo and redo | 58,052 cases, 273,998 recorded states |
| fence set (`FENCE=1 runaim.sh`) | 12 documents for P7: `:::` blocks that close themselves, openers no line closes, nested fences, a closing line inside a code block, a fence in a list item, a fence followed by one line end. The edits of the aimed set, and pastes and typed text that hold `:::` lines | 17,024 cases, 72,686 recorded states |
| looseness set (`runloose.sh`) | the looseness plan's set, with its extra set | 35,541 cases |
| seeded fuzz (`runfuzzall.sh`) | the paste, table edge, list-edit and reviewer 7 harnesses, same seeds and sizes as the raw block edge cases plan | 60 result files |
| list toggle sets (`rundiffall.sh`) | the 49 row sets of the list toggle plan and review 4's probes | 58 record files, 77,396 records |

| Comparison | Must end with | Which means |
|---|---|---|
| `cmpall.sh parent partA` | `ALL IDENTICAL` | every record file and every digest file is byte-identical |
| `CANON=1 cmpall.sh parent partB` | `IDENTICAL BY NAME`, and in every line of digests by name `0 differ in the flag of a dirty element alone` | every fuzz result file and every toggle-set record file is byte-identical; the records of the aimed and the looseness set differ in nothing but the selection, which they write with node keys; and every update is the same by name |
| `CANON=1 cmpall.sh partB partC` | `NOT IDENTICAL`, for one reason: in the toggle sets the record file `dxb2.jsonl` differs, and the updates that `differ otherwise` are all in `dxb2`. Every other family reads `0 differ otherwise` | part C changes the flag of a dirty element in the updates that join two lists, and one save |
| `cmprows.py partB partC` | `1 record(s) looser with the same tree, 0 differing otherwise` | the one save is `dxb124/tod-lor`: the same tree, loose after and tight before |

`CANON=1` compares the digests by name update by update (`cmpcanon.py`, on the `.canon2` files). For each family it prints how many updates are the same, how many differ in the flag of a dirty element alone, and how many differ otherwise. Under each count of flags it prints what changed: for part C, lists going from `true` to `false`.

With `CANON=1` the script also counts the plain digest files that differ. They differ wherever an edit lifts more than one item of a list first to last, and only in node keys (P4).

In the aimed and the fence set, Lexical's character delete throws `window object not found` at some carets, because the headless DOM has no selection to extend. The probe records the throw and goes on to the next case. Both sides record the same throws: 2,247 cases.

The five sets of review 5 (`R5=1 runside.sh …`, sets `r5w-*`) need a 6 GB heap each. The planner did not run them: the machine ran out of memory under the planner's runs, and they were left out to keep within two small processes. Run them one at a time when the machine allows, compare with the same `cmpall.sh` lines, and say in the Implementation Notes whether they ran.

What the planner ran, on which code, and what it found is in *Addendum: what the planner measured*.

### The timings

A timing is taken with nothing else running: one vitest process, and at least 4 GB of memory available. Runs made side by side on a busy machine gave times five to ten times higher.

```bash
OPS=type,enter,backspaceStart,selStateAll,pasteSmall,pasteAll,cut,deleteAll,toggleUL,toggleOL,h2,code,bold
for side in parent partC; do
    STREAMS="paras,tight,twoblock,shortlists,nested,tables,columns" OPS=$OPS NS=500,2000 REPEAT=3 CAP=8000 $K/runsurvey.sh $side T$side
done
python3 $K/summ2.py Tparent TpartC
```

Time `partB` in place of `partC` when part C is left out. `runsurvey.sh` runs its streams one after the other. `summ2.py` prints, for each kind of document and edit, the median and the spread of the edit, its undo and its redo at each size, and the growth exponent between the sizes: 1 is growth with the document, 2 with its square. A size is skipped once the size before it took more than `CAP` ms. Expected: every row of *Addendum: what the planner measured* that reads 1.4 and more before reads about 1 after, but for the rows that addendum names as left.

The planner's larger runs (8,000 blocks, with `NODE_OPTIONS=--max-old-space-size=3072`) and the runs on raw blocks and definitions are `$K/timings3.sh` to `$K/timings6.sh`. Rerun them only if the two sizes above leave a doubt.

---

## Documentation Impact

No exported symbol changes, and no page under `docs/components/` changes: the page already describes the toggle's looseness as part C makes it. Add two entries at the end of `## Fixed` → `### Components` in `packages/lib/docs/reference/changelog/next.md`, the second only with part C:

> **`MarkdownEditor` no longer slows down by the square of a document's length.** In WYSIWYG mode a document holding a few hundred raw blocks or link reference definitions took a minute to load; a document holding several hundred `:::` blocks took seconds for every typed letter; a paste of many blocks, a format or a block type over many blocks, and a list toggle or a block type over a long list took time that grew with the square of their number. These now grow with the number. What is saved is unchanged.
>
> **`MarkdownEditor`: a list toggle over several runs of blocks keeps a loose list loose.** `toggleUnorderedList()` and `toggleOrderedList()` over blocks standing between three or more lists of one marker wrote the joined list tight when only a later one of those lists was loose, and so took the blank lines from a list the selection did not touch. The joined list is now loose when one of the lists is, as documented.

---

## Potential Challenges

- **Line numbers have moved, and one symbol has another name.** `checkSiblings` is `$showSiblingRawBlocksAsWritten` after `markdown-editor-raw-block-range-edits`. Locate every function by name; step 1's greps confirm the shape.
- **`$definitionsReader(…)` is called once for each pass.** In `$readsBackAsShown` and `$runsReadingOtherwise` make the reader before the loop over `inlineRuns`, so one call of either reads the document at most once. A reader must not be kept across calls: the document can change between them.
- **`true` and `false` are not interchangeable.** Three readers pass `true` and `$runsReadingOtherwise` passes `false`; rows of the aimed set fail the differential when one is swapped.
- **`nodes` is not `node`.** `$readsBackAsShown(node, …)` checks runs; the reader is given each run's `nodes`, which for a table cell is the cell. Passing `[node]` would miss a reference in another paragraph of the same cell.
- **`$showRawBlocksBeforeAsWritten` turns raw blocks in document order.** It collects with `unshift` while it walks back, then replaces first to last. Replacing while walking back would make the paragraphs in another order, and so with other keys.
- **`$insertAfterUnwalked` calls `ElementNode.prototype.insertAfter`.** As `$removePlainly` calls `ElementNode.prototype.remove`: the lifted blocks' own classes override `insertAfter`, and their overrides must not run here.
- **P7 rests on how the `:::` tokenizer reads.** It reads line by line from the opening line and stops at the closing line. `markdown-raw-block-html-tail-parity` edits the same file, `markdownExtensions.ts`, in its HTML tokenizer. If the `:::` tokenizer (`BLOCK_EXTENSION`) has changed, check that it still stops at the closing line and returns the text up to that line's end before applying P7.
- **`closesOwnFence` is given the separator, not the next block.** `separatorBefore(blocks, index + 1)` is what is written between the block and the next one. The closing line is whole only when a line end follows it; without that test a block whose last line is `:::` and whose separator were empty would be skipped wrongly.
- **`$isMadeInThisUpdate` reads the committed state inside an update.** `editor.getEditorState().read(…)` is the call `$editedLeaves` ([markdownWritable.ts:2011](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2011)) already makes there.
- **Part C's comparison ends with `NOT IDENTICAL`.** That is expected, and only for the one record `## Verification` names. Any other record that differs is a defect.
- **The differential is long and needs memory.** At two jobs one side takes about about 50 minutes on an idle machine, and several times that on a busy one. Start a side as soon as its commit exists, and run nothing else beside it.

---

## Critical Files

- [markdownSerializer.ts](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts): `$collectDefinitions` (L748), `$needsDefinitions` (L760), `$documentDefinitions` (L777), `$serializeBlock` (L899), `$serializeInlineNodes` (L913), `$readsBackAsShown` (L935), `$runsReadingOtherwise` (L955), `inlineRuns` (L1049), `$rawBlockWritesAsParagraph` (L2183), `$writesBlockAfter` (L2217), `$writesSomething` (L2493, the precedent for P2), `resolvesToNode` (L4236), `readBackTokens` (L4921); for P7 `FENCE_OPENING_START` (L156), `writtenBlocks` (L1322), `labelClosedAfter` (L1374), `fenceClosedAfter` (L1391), `readsOtherwiseAfter` (L1425), `separatorBefore` (L1552).
- [markdownExtensions.ts](../packages/lib/src/typescript/lib/component/display/markdownExtensions.ts): `BLOCK_EXTENSION` (L130), the `:::` tokenizer P7 rests on, and `MARKDOWN_EXTENSIONS` (L592), where it is the one block-level extension.
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts): `registerRawBlockRules` (L903), `$showRawBlocksAsWritten` (L1129), `registerDefinitionRules` (L1178, the precedent for per-update state), `registerRunEdgeRules` (L1895) and `$tidyBlock` (L1983), `$editOrRestore` (L2451), `$normalizeList` (L449).
- [markdownListItemNode.ts](../packages/lib/src/typescript/lib/component/editor/markdownListItemNode.ts): `MarkdownListItemTextNode.replace` (L504), `$removePlainly` (L600, the precedent for P5), `$splitItemBefore` (L677), `$liftItemOut` (L780), `$splitListAfter` (L869).
- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts): `$copyBlockAsCodeSource` (L363), `$liftBlockOutOfLists` (L3234), `$makeItemsOfRun` (L3283), `$toggleListOfTouchedBlocks` (L3347).
- [markdown-source-preservation.test.ts](../packages/lib/tests/component/markdown-source-preservation.test.ts): the counting idiom (L22–26, L441).
- `plans/markdown-editor-list-looseness-transform-cost.md`: the per-update seam (`readWhole`), the differential scripts this plan's are made from, and its *Addendum: other costs measured*, which this plan answers.
- `plans/markdown-editor-raw-block-range-edits.md`, *`$showRawBlockAsSaved` at module level*: the shape P3 edits.

---

## Non-Goals

- **One read of the definitions for a whole update.** See *What still grows faster than the document*. Lexical gives no way to know that nothing was written between two reads, and a read kept across rules would have to be dropped by every rule that can change a raw block.
- **A block that leaves a `:::` fence or a definition label open.** `labelClosedAfter` and the open-fence case of `fenceClosedAfter` still lex the rest of the document. Their first tests already let few blocks through.
- **Blocks of many lines.** A code block, a raw block or a paragraph of thousands of lines was not surveyed; the survey's documents hold many short blocks. Two costs of that kind were seen by chance and are named in *What still grows faster than the document*.
- **`marked`'s own costs.** Its inline lexer lists every link reference definition for each block it lexes.
- **The serialization of the whole document after every update.** `handleChange` ([MarkdownEditor.ts:8273](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L8273)) saves the document after each update, a caret move included. That grows with the document, by design, and is most of what a keystroke costs in a large document.
- **The document's own raw-block rule.** The `RootNode` transform checks every top-level raw block once in each pass. That grows with the document and no faster.
- **The size of the serializer's memories.** `RUNS_ON`, `AT_MARGIN`, `STANDS_IN_ITEM` and `DEFINITIONS_READ` hold 256 texts each. A document with more raw blocks than that lexes each again on every update. That is a constant factor of a cost that grows with the document.
- **Lexical's own costs.** `$setBlocksType`, `insertNodes` and the selection's `getNodes` are Lexical's. `insertNodes` is what is left of a paste of thousands of top-level blocks.
- **The order of the transforms.** No rule is moved to another node or another pass.

---

## Addendum: what the planner measured

Measured on private copies of `fef32344b`, on `marked` 18.0.9 as installed. Four copies are used:

| Copy | Tag | What it is |
|---|---|---|
| `base` | `base` | `fef32344b` with the looseness plan's prototype applied (`$K/looseness-proto-v3.diff`). Every "before" is `base`, so the looseness plan's code is on both sides of every comparison. |
| `finalA4` | `fA` | `base` with part A, as *Internal Structure* prints it (`$K/applyFinal.py <copy> A`) |
| `final5` | `fB` | `base` with parts A and B |
| `final4` | `f4` | `base` with parts A, B and C |

Each copy typechecks and lints clean. Of the 28 rows, `base` passes 8 (20 fail), `finalA4` 20, `final5` 25 (`L5`, `L6` and `S8` fail) and `final4` all. `final4` saves every one of 676 scenarios (13 kinds of document, 26 edits, two sizes; after the edit, after undo, after redo) as `base` does.

`base` with the digest on reproduces the raw block edge cases plan's stored fuzz results: its 60 result files are byte-identical to `…/impl/raw-block-edge-cases/{lif-b6,r7-b6,fuzz-b6}`.

**The differential, as the planner ran it.** One script at a time and two vitest processes, with 14 to 21 GB of memory available. Every family ran but the five sets of review 5. The outputs of the comparisons are `$K/out/cmp-base-fA-aimloose.txt`, `cmp-base-fB-all.txt` and `cmp-fB-f4-all.txt`.

| Comparison | Family | Result |
|---|---|---|
| `base` against `fA`: part A, with node keys | aimed and fence sets, 75,076 cases | 9 record files and 9 digest files byte-identical: 3,415,250 digest lines |
| | looseness set and its extra set, 35,541 cases | 13 record files and 13 digest files byte-identical: 2,053,519 digest lines |
| | seeded fuzz, toggle sets | not run on part A alone; `fB` holds part A and ran them |
| `base` against `fB`: parts A and B, by name | aimed and fence sets | the records differ in nothing but the selection's node keys; 3,415,250 updates and values the same, none differs in a flag, none otherwise |
| | looseness set and its extra set | the same; 2,053,519 the same, none differs |
| | seeded fuzz: list-edit (11 seeds), reviewer 7 (5 seeds) | 16 result files byte-identical, with the 1 and the 88 records they hold on `base`; 1,130,429 updates and values the same, none differs |
| | seeded fuzz: paste, table edge (44 jobs) | 44 result files byte-identical; the 44 digest files by name byte-identical: 4,272,304 lines |
| | list toggle sets | 58 record files byte-identical: 77,396 records; 2,031,789 updates and values the same, none differs |
| `fB` against `f4`: part C, by name | aimed and fence sets | records identical; 422 updates differ in the flag of a dirty element alone, none otherwise |
| | looseness set and its extra set | records identical; 635 differ in the flag alone, none otherwise |
| | seeded fuzz: list-edit, reviewer 7 | 16 result files byte-identical; 130 differ in the flag alone, none otherwise |
| | seeded fuzz: paste, table edge | 44 result files byte-identical; none of 4,272,304 differs |
| | list toggle sets | 57 of 58 record files byte-identical; in `dxb2.jsonl` one record differs (`dxb124/tod-lor`: the same tree, the save loose where it was tight); 10,939 updates differ in the flag alone, and 9 otherwise, all 9 in that one case |

Part C's 12,126 updates that differ in the flag alone: in every one of them one list is flagged `false` where it was flagged `true`. In 861 of them one more element is, which is the element the joined lists stand in when that is no top-level block: a list item or a `:::` column (one was dumped and read: `$K/out/dump3`).

`base`'s paste and table edge fuzz ran before the `.canon2` file existed, so its 44 digest files were compared with `fB`'s byte for byte in their `.canon` form, which holds the flags too.

**The fence question, asked both ways.** A copy of `final4` that computes the answer of before for every block P7 skips (`$K/copies/chk7`) ran the fence set. Of 415,113 questions about a block that starts with a `:::` line, 241,865 were skipped, and the full lex answered `false` for every one of them. 173,248 were still asked; 160 of those answered `true`. The 17,024 cases of the set record the same on `base` and on `f4`: records, digests with node keys and digests by name are byte-identical.

**Where the time went, before.** CPU profiles on `base` (the profiler slows a run about fourfold; read the shares):

| Edit | Total | Share |
|---|---|---|
| a paste of 1,000 paragraphs | 4,726 ms | `tidy` 4,226, of which `$needsDefinitions` 3,052 and `$runsReadingOtherwise` 716 |
| bold over 500 list items that each hold a paragraph | 4,849 ms | `$editOrRestore` 4,372, of which `$needsDefinitions` 3,783 |
| a load of 100 reference links and their 100 definitions | 24,395 ms | `$rawBlockWritesAsParagraph` 23,669, of which `$collectDefinitions` 23,478 |
| one letter typed in 150 reference links and 150 definitions | 328 ms | `$showRawBlocksAsWritten` 256, of which `$collectDefinitions` 262 with its callers |
| `setBlockType("h2")` over a tight list of 1,000 | 2,135 ms | `$liftItemOut` 1,608, of which `$splitListAfter` 1,408 |
| the bulleted toggle over 250 items that each hold a paragraph | 1,216 ms | `$normalizeList` 759, of which `$keepLoosenessWritable` 514 and `$joinLists` 192 |
| one letter typed in 667 `:::` blocks with a paragraph after each (on the copy without P7) | 2,332 ms | the two saves 2,260, of which `fenceClosedAfter` 2,215, all of it `lexMarkdown` |

**Why the bulleted toggle leaves a list for each item.** The looseness plan left this untraced. The toggle acts on the blocks the selection touches that do not open a bulleted item yet: here the paragraph each item holds. It lifts them last to first (`$liftBlockOutOfLists`). Each lift splits the item before the paragraph, takes the paragraph out to the top level, and `$splitListAfter` puts the one item after it into a new list. After the lifts the document is a list of one item, a paragraph, a list of one item, a paragraph, and so on. `$makeItemsOf` then puts each paragraph back as an item at the end of the list before it, which leaves n lists of two items side by side. The list rule joins them: the first list takes the second, and the others are joined from the last backwards, each taking in everything after it. Each join moves, numbers and reads all the items joined so far.

**Timings.** Headless, in ms, on `base` and on the final code. The `:::` columns rows are of `$K/copies/final4`. The other rows are of `$K/copies/final3`, which is `final4` without P7's edit: that edit runs only for a block that starts with a `:::` line, and those kinds hold none. All the timings were taken before one `if` of P3 was rewritten to take its condition from a constant, which computes the same. Each number is the median of the runs, with the lowest and the highest in brackets: three runs at 500 and 2,000 blocks, two at 8,000 and at the small sizes. Each time is the edit and the save that follows it. *Growth* is the exponent between one size and the next: 1 is growth with the document, 2 with its square, 3 with its cube.

Every run counted here was made alone: one vitest process, nothing else of the planner's running, 13 to 21 GB of memory available, a load of 1 to 5 on 24 cores. Earlier runs, made side by side while other suites kept the machine swapping, gave times five to ten times higher and are not used. At 8,000 blocks only three kinds of document with seven edits, and `:::` columns with two, were timed, each with a memory ceiling of 3 GB; a dash is a size that was not run, either for that reason or because the size before it took more than 8 seconds.

The edits that grow faster than their document on either side:

| Document | Edit | Side | 500 | 2,000 | 8,000 | Growth |
|---|---|---|---|---|---|---|
| `:::` columns | a typed letter | before | 137 [133–141] | 2,035 [2,032–2,051] | 34,367 [33,148–35,587] | 1.9, 2.0 |
| | | after | 11 [11–20] | 31 [31–36] | 130 [128–132] | 0.7, 1.0 |
| `:::` columns | Enter | before | 137 [136–138] | 2,054 [2,050–2,058] | 33,533 [33,368–33,699] | 2.0, 2.0 |
| | | after | 9.4 [7.6–11] | 33 [32–33] | 132 [129–136] | 0.9, 1.0 |
| `:::` columns | the selection-state read, everything selected | before | 76 [75–79] | 1,052 [1,043–1,055] | — | 1.9, — |
| | | after | 16 [14–18] | 55 [53–56] | — | 0.9, — |
| `:::` columns | a paste of three paragraphs | before | 143 [138–145] | 2,060 [2,053–2,068] | — | 1.9, — |
| | | after | 8.4 [8.1–9.2] | 31 [31–36] | — | 0.9, — |
| `:::` columns | a paste of the whole document into an empty one | before | 626 [612–640] | 9,473 [9,419–9,570] | — | 2.0, — |
| | | after | 42 [39–47] | 187 [185–191] | — | 1.1, — |
| `:::` columns | `setBlockType("code")` over everything | before | 328 [324–346] | 4,815 [4,682–5,022] | — | 1.9, — |
| | | after | 31 [31–33] | 120 [119–124] | — | 1.0, — |
| `:::` columns | bold over everything | before | 592 [578–636] | 8,660 [8,602–8,848] | — | 1.9, — |
| | | after | 71 [65–87] | 262 [261–269] | — | 0.9, — |
| plain paragraphs | a paste of the whole document into an empty one | before | 350 [350–354] | 5,471 [5,410–5,596] | 82,075 [81,341–82,808] | 2.0, 2.0 |
| | | after | 41 [37–43] | 192 [187–195] | 1,872 [1,833–1,911] | 1.1, 1.6 |
| plain paragraphs | `setBlockType("code")` over everything | before | 227 [222–228] | 3,197 [3,046–3,220] | — | 1.9, — |
| | | after | 21 [20–26] | 83 [83–87] | — | 1.0, — |
| plain paragraphs | bold over everything | before | 247 [239–261] | 3,295 [3,263–3,371] | 49,990 [47,672–52,308] | 1.9, 2.0 |
| | | after | 45 [42–61] | 165 [164–169] | 646 [643–650] | 0.9, 1.0 |
| one tight list | a paste of the whole document into an empty one | before | 789 [756–832] | 11,998 [11,955–12,189] | — | 2.0, — |
| | | after | 54 [47–55] | 209 [203–215] | 773 [730–817] | 1.0, 0.9 |
| one tight list | the bulleted toggle over everything | before | 59 [52–61] | 592 [568–622] | 8,754 [8,689–8,819] | 1.7, 1.9 |
| | | after | 35 [32–36] | 125 [121–130] | 530 [515–546] | 0.9, 1.0 |
| one tight list | the numbered toggle over everything | before | 56 [55–56] | 369 [340–369] | 4,228 [4,203–4,252] | 1.4, 1.8 |
| | | after | 50 [49–50] | 217 [212–219] | 841 [840–842] | 1.1, 1.0 |
| one tight list | `setBlockType("h2")` over everything | before | 188 [185–203] | 2,753 [2,687–2,842] | 41,840 [41,682–41,999] | 1.9, 2.0 |
| | | after | 40 [36–46] | 160 [157–161] | 637 [633–640] | 1.0, 1.0 |
| one tight list | `setBlockType("code")` over everything | before | 458 [454–471] | 7,512 [7,093–7,638] | — | 2.0, — |
| | | after | 32 [31–36] | 126 [123–129] | — | 1.0, — |
| one tight list | bold over everything | before | 708 [656–715] | 10,329 [10,259–10,440] | — | 1.9, — |
| | | after | 81 [72–102] | 286 [285–289] | 1,167 [1,124–1,211] | 0.9, 1.0 |
| a list whose items each hold a paragraph | a paste of the whole document into an empty one | before | 642 [608–646] | 9,943 [9,664–10,063] | — | 2.0, — |
| | | after | 44 [41–44] | 172 [169–180] | 733 [699–768] | 1.0, 1.0 |
| a list whose items each hold a paragraph | the bulleted toggle over everything | before | 254 [253–278] | 4,044 [3,963–4,122] | 79,828 [68,799–90,858] | 2.0, 2.2 |
| | | after | 47 [41–48] | 182 [174–183] | 740 [731–749] | 1.0, 1.0 |
| a list whose items each hold a paragraph | the numbered toggle over everything | before | 55 [53–58] | 365 [354–372] | 3,491 [3,302–3,681] | 1.4, 1.6 |
| | | after | 50 [49–57] | 204 [199–211] | 804 [799–809] | 1.0, 1.0 |
| a list whose items each hold a paragraph | `setBlockType("h2")` over everything | before | 83 [81–89] | 940 [929–950] | 12,746 [12,529–12,963] | 1.8, 1.9 |
| | | after | 37 [34–41] | 140 [140–151] | 562 [560–564] | 1.0, 1.0 |
| a list whose items each hold a paragraph | `setBlockType("code")` over everything | before | 334 [288–342] | 4,880 [4,749–4,901] | — | 1.9, — |
| | | after | 26 [26–30] | 111 [111–121] | — | 1.0, — |
| a list whose items each hold a paragraph | bold over everything | before | 426 [413–435] | 6,089 [6,054–6,273] | 88,281 [88,261–88,301] | 1.9, 1.9 |
| | | after | 64 [62–68] | 262 [257–281] | 1,040 [990–1,090] | 1.0, 1.0 |
| many short lists | a paste of the whole document into an empty one | before | 811 [781–812] | 13,936 [12,692–14,140] | — | 2.1, — |
| | | after | 48 [48–49] | 224 [214–224] | — | 1.1, — |
| many short lists | `setBlockType("h2")` over everything | before | 71 [67–77] | 706 [648–708] | — | 1.7, — |
| | | after | 38 [34–46] | 159 [159–172] | — | 1.0, — |
| many short lists | `setBlockType("code")` over everything | before | 351 [328–361] | 5,168 [5,058–5,395] | — | 1.9, — |
| | | after | 29 [28–30] | 134 [130–156] | — | 1.1, — |
| many short lists | bold over everything | before | 729 [706–737] | 10,889 [10,675–11,218] | — | 2.0, — |
| | | after | 82 [82–91] | 361 [354–393] | — | 1.1, — |
| nested lists | Backspace at a block start | before | 9.2 [8.9–9.7] | 75 [71–78] | — | 1.5, — |
| | | after | 9.5 [9.3–13] | 65 [64–74] | — | 1.4, — |
| nested lists | a paste of the whole document into an empty one | before | 1,002 [965–1,027] | 15,927 [15,317–16,024] | — | 2.0, — |
| | | after | 49 [48–55] | 226 [205–237] | — | 1.1, — |
| nested lists | the bulleted toggle over everything | before | 57 [56–60] | 532 [523–567] | — | 1.6, — |
| | | after | 40 [37–43] | 202 [197–231] | — | 1.2, — |
| nested lists | `setBlockType("h2")` over everything | before | 111 [111–119] | 1,234 [1,205–1,327] | — | 1.7, — |
| | | after | 42 [41–47] | 190 [183–193] | — | 1.1, — |
| nested lists | `setBlockType("code")` over everything | before | 417 [415–444] | 6,798 [6,674–7,180] | — | 2.0, — |
| | | after | 39 [33–39] | 159 [155–162] | — | 1.0, — |
| nested lists | bold over everything | before | 1,065 [1,042–1,086] | 15,557 [15,323–15,642] | — | 1.9, — |
| | | after | 109 [109–113] | 438 [435–453] | — | 1.0, — |
| tables | a paste of the whole document into an empty one | before | 2,241 [2,238–2,292] | 38,488 [37,876–40,227] | — | 2.1, — |
| | | after | 81 [80–85] | 356 [343–369] | — | 1.1, — |
| tables | bold over everything | before | 2,764 [2,745–2,873] | 47,542 [44,406–50,654] | — | 2.1, — |
| | | after | 156 [155–159] | 633 [615–649] | — | 1.0, — |

The growth exponent of every edit timed, between the two largest sizes that ran, before:

| Document | a typed letter | Enter | Backspace at a block start | the selection-state read, everything selected | a paste of three paragraphs | a paste of the whole document into an empty one | cut of everything | delete of everything | the bulleted toggle over everything | the numbered toggle over everything | `setBlockType("h2")` over everything | `setBlockType("code")` over everything | bold over everything |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `:::` columns | 2.0 | 2.0 | — | 1.9 (to 2,000) | 1.9 (to 2,000) | 2.0 (to 2,000) | 0.9 (to 2,000) | 0.9 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.9 (to 2,000) | 1.9 (to 2,000) |
| plain paragraphs | 1.1 | 1.1 | 1.0 (to 2,000) | 0.9 (to 2,000) | 1.0 (to 2,000) | 2.0 | 0.8 (to 2,000) | 0.8 (to 2,000) | 1.1 | 1.1 | 1.0 | 1.9 (to 2,000) | 2.0 |
| one tight list | 1.1 | 1.1 | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 2.0 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.9 | 1.8 | 2.0 | 2.0 (to 2,000) | 1.9 (to 2,000) |
| a list whose items each hold a paragraph | 1.1 | 1.1 | 1.0 (to 2,000) | 0.8 (to 2,000) | 1.0 (to 2,000) | 2.0 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 2.2 | 1.6 | 1.9 | 1.9 (to 2,000) | 1.9 |
| many short lists | 1.2 (to 2,000) | 0.9 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 2.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.2 (to 2,000) | 1.2 (to 2,000) | 1.7 (to 2,000) | 1.9 (to 2,000) | 2.0 (to 2,000) |
| nested lists | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.5 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 2.0 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.6 (to 2,000) | 1.2 (to 2,000) | 1.7 (to 2,000) | 2.0 (to 2,000) | 1.9 (to 2,000) |
| tables | 0.9 (to 2,000) | 1.1 (to 2,000) | — | 1.1 (to 2,000) | 0.9 (to 2,000) | 2.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | declined | declined | declined | declined | 2.1 (to 2,000) |

And after:

| Document | a typed letter | Enter | Backspace at a block start | the selection-state read, everything selected | a paste of three paragraphs | a paste of the whole document into an empty one | cut of everything | delete of everything | the bulleted toggle over everything | the numbered toggle over everything | `setBlockType("h2")` over everything | `setBlockType("code")` over everything | bold over everything |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `:::` columns | 1.0 | 1.0 | — | 0.9 (to 2,000) | 0.9 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 0.9 (to 2,000) |
| one tight list | 1.1 | 1.0 | 1.1 (to 2,000) | 0.9 (to 2,000) | 1.1 (to 2,000) | 0.9 | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.0 | 1.0 | 1.0 | 1.0 (to 2,000) | 1.0 |
| a list whose items each hold a paragraph | 1.0 | 1.0 | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 | 0.9 (to 2,000) | 0.9 (to 2,000) | 1.0 | 1.0 | 1.0 | 1.0 (to 2,000) | 1.0 |
| many short lists | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) |
| nested lists | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.4 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) | 1.2 (to 2,000) | 1.1 (to 2,000) | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.0 (to 2,000) |
| plain paragraphs | 1.1 | 1.0 | 1.0 (to 2,000) | 0.9 (to 2,000) | 0.9 (to 2,000) | 1.6 | 0.9 (to 2,000) | 0.9 (to 2,000) | 1.0 | 1.1 | 1.0 | 1.0 (to 2,000) | 1.0 |
| tables | 1.0 (to 2,000) | 1.0 (to 2,000) | — | 1.1 (to 2,000) | 1.0 (to 2,000) | 1.1 (to 2,000) | 0.9 (to 2,000) | 1.0 (to 2,000) | declined | declined | declined | declined | 1.0 (to 2,000) |

Raw blocks and definitions. Before this plan the load of these documents grows with the cube of their length (a document of 400 raw blocks took about a minute to load), so both sides were timed at 50, 100, 200 and, after, 400 units. The loads:

| Document | Side | 50 | 100 | 200 | 400 | Growth |
|---|---|---|---|---|---|---|
| raw blocks | before | 136 [127–144] | 930 [924–936] | 7,031 [7,021–7,040] | — | 2.8, 2.9, — |
|  | after | 17 [7.1–28] | 9.0 [6.8–11] | 12 [8.5–16] | 20 [19–21] | -1.0, 0.5, 0.7 |
| reference links, a definition after each | before | 170 [169–171] | 1,280 [1,277–1,283] | 9,916 [9,792–10,040] | — | 2.9, 3.0, — |
|  | after | 10 [7.7–13] | 11 [11–12] | 27 [26–28] | 48 [48–49] | 0.1, 1.2, 0.8 |
| reference links, their definitions in one block at the end | before | 9.9 [9.8–10] | 26 [24–28] | 79 [78–79] | — | 1.4, 1.6, — |
|  | after | 5.2 [5.1–5.4] | 8.7 [8.6–8.8] | 20 [19–20] | 55 [55–56] | 0.7, 1.2, 1.5 |

The edits on them:

| Document | Edit | Side | 50 | 100 | 200 | 400 | Growth |
|---|---|---|---|---|---|---|---|
| raw blocks | a typed letter | before | 12 [9.2–16] | 25 [25–25] | 92 [92–93] | — | 1.0, 1.9, — |
| | | after | 6.5 [4.0–9.1] | 3.8 [3.1–4.5] | 4.6 [4.4–4.8] | 11 [10–12] | -0.8, 0.3, 1.3 |
| raw blocks | Enter | before | 9.0 [8.4–9.6] | 25 [25–26] | 90 [90–91] | — | 1.5, 1.8, — |
| | | after | 2.5 [1.7–3.2] | 2.3 [2.3–2.4] | 3.6 [3.4–3.8] | 10 [9.8–11] | -0.1, 0.6, 1.5 |
| raw blocks | a paste of three paragraphs | before | 13 [11–14] | 37 [37–37] | 139 [136–141] | — | 1.5, 1.9, — |
| | | after | 4.2 [3.6–4.8] | 3.0 [2.9–3.0] | 5.4 [3.9–6.8] | 11 [9.9–12] | -0.5, 0.9, 1.1 |
| raw blocks | a paste of the whole document into an empty one | before | 132 [131–133] | 1,026 [1,011–1,041] | 7,943 [7,814–8,072] | — | 3.0, 3.0, — |
| | | after | 2.8 [2.2–3.3] | 4.5 [4.1–5.0] | 8.9 [8.0–9.8] | 23 [22–23] | 0.7, 1.0, 1.3 |
| raw blocks | delete of everything | before | 1.6 [1.0–2.1] | 1.4 [1.3–1.6] | 2.1 [1.9–2.2] | — | -0.1, 0.5, — |
| | | after | 1.7 [0.8–2.5] | 1.2 [1.1–1.2] | 2.3 [1.9–2.7] | 4.3 [3.0–5.5] | -0.5, 1.0, 0.9 |
| raw blocks | `setBlockType("h2")` over everything | before | 6.3 [4.6–8.0] | 7.9 [7.3–8.6] | 17 [13–21] | — | 0.3, 1.1, — |
| | | after | 6.1 [4.0–8.2] | 7.9 [7.6–8.3] | 16 [15–16] | 25 [24–25] | 0.4, 1.0, 0.6 |
| raw blocks | `setBlockType("code")` over everything | before | 3.3 [2.4–4.3] | 4.6 [4.0–5.2] | 7.3 [6.8–7.8] | — | 0.5, 0.7, — |
| | | after | 3.3 [2.1–4.4] | 4.1 [3.7–4.4] | 7.4 [6.4–8.4] | 13 [13–14] | 0.3, 0.9, 0.9 |
| reference links, a definition after each | a typed letter | before | 5.3 [5.0–5.7] | 12 [12–13] | 39 [39–39] | — | 1.2, 1.7, — |
| | | after | 2.6 [1.9–3.2] | 3.2 [3.1–3.3] | 5.3 [5.1–5.4] | 11 [10–12] | 0.3, 0.7, 1.1 |
| reference links, a definition after each | Enter | before | 12 [11–12] | 38 [38–38] | 146 [145–147] | — | 1.7, 2.0, — |
| | | after | 2.8 [2.4–3.2] | 4.0 [3.8–4.2] | 6.6 [6.5–6.6] | 15 [14–16] | 0.5, 0.7, 1.2 |
| reference links, a definition after each | a paste of three paragraphs | before | 15 [14–17] | 50 [48–52] | 176 [175–177] | — | 1.7, 1.8, — |
| | | after | 2.6 [2.3–3.0] | 4.2 [4.1–4.3] | 7.0 [6.9–7.2] | 17 [17–18] | 0.7, 0.8, 1.3 |
| reference links, a definition after each | a paste of the whole document into an empty one | before | 199 [198–201] | 1,356 [1,342–1,369] | 10,157 [10,074–10,240] | — | 2.8, 2.9, — |
| | | after | 28 [22–34] | 68 [68–68] | 198 [196–201] | 712 [700–723] | 1.3, 1.6, 1.8 |
| reference links, a definition after each | delete of everything | before | 1.4 [1.1–1.7] | 1.9 [1.8–1.9] | 2.9 [2.8–2.9] | — | 0.4, 0.6, — |
| | | after | 1.7 [1.7–1.8] | 1.8 [1.5–2.2] | 3.0 [2.7–3.2] | 5.2 [4.7–5.8] | 0.1, 0.7, 0.8 |
| reference links, a definition after each | `setBlockType("h2")` over everything | before | 8.7 [7.1–10] | 14 [13–16] | 32 [27–37] | — | 0.7, 1.1, — |
| | | after | 8.0 [7.6–8.4] | 14 [14–14] | 27 [27–28] | 65 [61–69] | 0.8, 1.0, 1.3 |
| reference links, a definition after each | `setBlockType("code")` over everything | before | 6.4 [6.3–6.4] | 13 [13–14] | 40 [38–43] | — | 1.1, 1.6, — |
| | | after | 4.6 [3.6–5.6] | 9.4 [7.8–11] | 20 [20–21] | 81 [63–98] | 1.0, 1.1, 2.0 |
| reference links, their definitions in one block at the end | a typed letter | before | 2.1 [2.1–2.1] | 11 [3.4–19] | 5.7 [5.6–5.9] | — | 2.4, -1.0, — |
| | | after | 1.4 [1.4–1.4] | 3.2 [2.2–4.1] | 3.9 [3.9–4.0] | 7.7 [7.6–7.7] | 1.2, 0.3, 1.0 |
| reference links, their definitions in one block at the end | Enter | before | 3.2 [3.0–3.5] | 11 [5.5–16] | 8.3 [8.1–8.6] | — | 1.7, -0.3, — |
| | | after | 1.9 [1.8–1.9] | 3.5 [3.4–3.6] | 5.8 [4.7–7.0] | 12 [12–13] | 0.9, 0.7, 1.1 |
| reference links, their definitions in one block at the end | a paste of three paragraphs | before | 4.0 [3.4–4.5] | 6.0 [5.9–6.1] | 21 [21–22] | — | 0.6, 1.8, — |
| | | after | 2.9 [1.9–3.9] | 4.3 [3.4–5.2] | 5.1 [5.0–5.1] | 13 [12–14] | 0.6, 0.2, 1.3 |
| reference links, their definitions in one block at the end | a paste of the whole document into an empty one | before | 36 [35–36] | 85 [80–90] | 263 [260–267] | — | 1.3, 1.6, — |
| | | after | 18 [18–18] | 46 [45–47] | 132 [131–132] | 449 [440–457] | 1.3, 1.5, 1.8 |
| reference links, their definitions in one block at the end | delete of everything | before | 1.2 [1.0–1.4] | 1.6 [1.4–1.9] | 2.4 [2.3–2.4] | — | 0.4, 0.6, — |
| | | after | 1.1 [0.8–1.4] | 1.4 [1.4–1.4] | 2.5 [2.5–2.6] | 4.2 [4.1–4.3] | 0.3, 0.9, 0.7 |
| reference links, their definitions in one block at the end | `setBlockType("h2")` over everything | before | 12 [11–12] | 24 [22–26] | 63 [58–67] | — | 1.0, 1.4, — |
| | | after | 12 [12–12] | 25 [25–26] | 58 [57–59] | 214 [212–216] | 1.1, 1.2, 1.9 |
| reference links, their definitions in one block at the end | `setBlockType("code")` over everything | before | 4.6 [3.7–5.5] | 8.6 [8.3–8.9] | 23 [23–23] | — | 0.9, 1.4, — |
| | | after | 2.7 [2.6–2.7] | 4.5 [4.5–4.6] | 10 [9.3–11] | 22 [22–22] | 0.8, 1.2, 1.1 |

The final code alone on these kinds, at the sizes of the other kinds:

| Document | Edit | 500 | 2,000 | Growth |
|---|---|---|---|---|
| raw blocks | a typed letter | 15 [14–32] | 48 [46–51] | 0.8 |
| raw blocks | Enter | 15 [12–17] | 48 [47–50] | 0.9 |
| raw blocks | a paste of three paragraphs | 17 [13–17] | 50 [49–51] | 0.8 |
| raw blocks | a paste of the whole document into an empty one | 30 [30–34] | 193 [189–239] | 1.3 |
| raw blocks | delete of everything | 4.1 [4.0–8.3] | 15 [13–17] | 0.9 |
| raw blocks | `setBlockType("h2")` over everything | 37 [34–48] | 131 [121–139] | 0.9 |
| raw blocks | `setBlockType("code")` over everything | 18 [17–25] | 70 [66–74] | 1.0 |
| reference links, a definition after each | a typed letter | 18 [15–27] | 83 [73–106] | 1.1 |
| reference links, a definition after each | Enter | 26 [24–35] | 99 [98–100] | 1.0 |
| reference links, a definition after each | a paste of three paragraphs | 21 [20–22] | 113 [109–113] | 1.2 |
| reference links, a definition after each | a paste of the whole document into an empty one | 1,123 [1,111–1,150] | 28,330 [28,048–28,952] | 2.3 |
| reference links, a definition after each | delete of everything | 6.3 [5.9–7.9] | 26 [23–27] | 1.0 |
| reference links, a definition after each | `setBlockType("h2")` over everything | 92 [87–95] | 500 [481–522] | 1.2 |
| reference links, a definition after each | `setBlockType("code")` over everything | 90 [89–93] | 1,729 [1,702–1,735] | 2.1 |
| reference links, their definitions in one block at the end | a typed letter | 9.3 [9.2–9.8] | 41 [41–44] | 1.1 |
| reference links, their definitions in one block at the end | Enter | 14 [13–14] | 49 [48–73] | 0.9 |
| reference links, their definitions in one block at the end | a paste of three paragraphs | 13 [12–13] | 53 [51–56] | 1.0 |
| reference links, their definitions in one block at the end | a paste of the whole document into an empty one | 677 [661–706] | 10,281 [10,265–10,357] | 2.0 |
| reference links, their definitions in one block at the end | delete of everything | 5.8 [5.6–6.3] | 23 [22–24] | 1.0 |
| reference links, their definitions in one block at the end | `setBlockType("h2")` over everything | 318 [314–389] | 4,744 [4,702–4,746] | 1.9 |
| reference links, their definitions in one block at the end | `setBlockType("code")` over everything | 32 [29–32] | 227 [224–236] | 1.4 |
| raw blocks | the load | 30 [25–75] | 89 [80–91] | 0.8 |
| reference links, a definition after each | the load | 72 [71–85] | 509 [503–712] | 1.4 |
| reference links, their definitions in one block at the end | the load | 74 [73–75] | 812 [808–819] | 1.7 |

**The list toggles by part.** The same runs for `base`, for parts A and B alone (`$K/copies/final5`) and for all three parts. Only the bulleted toggle over a list whose items each hold a paragraph needs part C.

| Document | Toggle | Blocks | Before | Parts A and B | With part C |
|---|---|---|---|---|---|
| a list whose items each hold a paragraph | bulleted | 500 | 254 [253–278] | 252 [243–258] | 47 [41–48] |
|  |  | 2,000 | 4,044 [3,963–4,122] | 3,830 [3,665–3,841] | 182 [174–183] |
|  |  | 8,000 | 79,828 [68,799–90,858] | 74,739 [73,295–76,184] | 740 [731–749] |
| a list whose items each hold a paragraph | numbered | 500 | 55 [53–58] | 45 [42–46] | 50 [49–57] |
|  |  | 2,000 | 365 [354–372] | 234 [205–314] | 204 [199–211] |
|  |  | 8,000 | 3,491 [3,302–3,681] | 899 [892–906] | 804 [799–809] |
| one tight list | bulleted | 500 | 59 [52–61] | 30 [29–40] | 35 [32–36] |
|  |  | 2,000 | 592 [568–622] | 119 [117–128] | 125 [121–130] |
|  |  | 8,000 | 8,754 [8,689–8,819] | 547 [527–567] | 530 [515–546] |
| one tight list | numbered | 500 | 56 [55–56] | 47 [47–49] | 50 [49–50] |
|  |  | 2,000 | 369 [340–369] | 196 [192–204] | 217 [212–219] |
|  |  | 8,000 | 4,228 [4,203–4,252] | 1,002 [988–1,015] | 841 [840–842] |
| many short lists | bulleted | 500 | 64 [64–65] | 59 [53–62] | 40 [37–42] |
|  |  | 2,000 | 320 [309–341] | 272 [270–272] | 171 [166–175] |
| many short lists | numbered | 500 | 76 [68–93] | 46 [42–48] | 56 [50–58] |
|  |  | 2,000 | 411 [398–423] | 198 [195–201] | 211 [207–226] |
| nested lists | bulleted | 500 | 57 [56–60] | 35 [32–36] | 40 [37–43] |
|  |  | 2,000 | 532 [523–567] | 158 [157–162] | 202 [197–231] |
| nested lists | numbered | 500 | 67 [67–69] | 51 [51–51] | 58 [56–59] |
|  |  | 2,000 | 360 [350–363] | 234 [230–247] | 276 [260–287] |
| plain paragraphs | bulleted | 500 | 48 [43–68] | 49 [42–77] | 45 [40–60] |
|  |  | 2,000 | 168 [166–170] | 163 [163–171] | 159 [157–159] |
|  |  | 8,000 | 762 [733–791] | — | 679 [670–687] |
| plain paragraphs | numbered | 500 | 44 [38–54] | 41 [39–42] | 40 [38–41] |
|  |  | 2,000 | 172 [168–176] | 157 [153–159] | 156 [155–158] |
|  |  | 8,000 | 742 [736–748] | — | 682 [677–687] |
| `:::` columns | bulleted | 500 | 64 [63–84] | 61 [60–71] | 64 [62–86] |
|  |  | 2,000 | 282 [280–287] | 312 [304–316] | 285 [280–288] |
| `:::` columns | numbered | 500 | 61 [60–64] | 61 [60–63] | 60 [60–62] |
|  |  | 2,000 | 284 [280–288] | 300 [298–306] | 284 [282–285] |

---

## Addendum: the test file

`packages/lib/tests/component/markdown-editor-large-document-costs.test.ts`, complete:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    $copyNode, $createParagraphNode, $createRangeSelection, $getRoot, $getSelection, $isTextNode, $setSelection, CONTROLLED_TEXT_INSERTION_COMMAND, ElementNode,
    UNDO_COMMAND,
} from 'lexical';
import type { LexicalEditor } from 'lexical';
import { $generateJSONFromSelectedNodes, $generateNodesFromSerializedNodes, $insertGeneratedNodes } from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { lexMarkdown } from '~/component/display/markdownExtensions';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $listReadsLoose, $rawBlockWritesAsParagraph } from '~/component/editor/markdownSerializer';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Each mock wraps one function in a spy that still does its work, so a test can count how often an edit calls it;
// every other test sees the modules unchanged.
vi.mock('@lexical/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@lexical/utils')>();

    return { ...actual, $dfs: vi.fn(actual.$dfs) };
});

vi.mock('lexical', async (importOriginal) => {
    const actual = await importOriginal<typeof import('lexical')>();

    return { ...actual, $copyNode: vi.fn(actual.$copyNode) };
});

vi.mock('~/component/display/markdownExtensions.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/display/markdownExtensions.js')>();

    return { ...actual, lexMarkdown: vi.fn(actual.lexMarkdown) };
});

vi.mock('~/component/editor/markdownSerializer.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('~/component/editor/markdownSerializer.js')>();

    return { ...actual, $listReadsLoose: vi.fn(actual.$listReadsLoose), $rawBlockWritesAsParagraph: vi.fn(actual.$rawBlockWritesAsParagraph) };
});

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

function load(source: string): MarkdownEditor {
    const editor = new MarkdownEditor();

    editor.setValue(source);

    return editor;
}

/** Selects from `offset` in the document's first text to `offset` in its last one; the whole of both when `offset` is `null`. */
function selectAll(editor: MarkdownEditor, offset: number | null = 1): void {
    lexicalOf(editor).update(() => {
        const texts = $getRoot().getAllTextNodes();
        const last = texts[texts.length - 1]!;
        const selection = $createRangeSelection();

        selection.anchor.set(texts[0]!.getKey(), offset ?? 0, 'text');
        selection.focus.set(last.getKey(), offset ?? last.getTextContentSize(), 'text');
        $setSelection(selection);
    }, { discrete: true });
}

/** Puts the caret after the first character of the text node reading `text`. */
function caretIn(editor: MarkdownEditor, text: string): void {
    lexicalOf(editor).update(() => {
        const node = $getRoot().getAllTextNodes().find((candidate) => candidate.getTextContent() === text)!;

        node.select(1, 1);
    }, { discrete: true });
}

/** Pastes the whole of `source`, loaded in an editor of its own, at the selection. */
function paste(editor: MarkdownEditor, source: string): void {
    const origin = load(source);
    const originLexical = lexicalOf(origin);

    selectAll(origin, null);

    const nodes = originLexical.read(() => $generateJSONFromSelectedNodes(originLexical, $getSelection()).nodes);
    const lexical = lexicalOf(editor);

    origin.dispose();
    lexical.update(() => {
        $insertGeneratedNodes(lexical, $generateNodesFromSerializedNodes(nodes), $getSelection()!);
    }, { discrete: true });
}

const repeat = (count: number, each: (index: number) => string, between: string): string => Array.from({ length: count }, (_, index) => each(index)).join(between);
const paragraphs = (count: number): string => repeat(count, (index) => `para${index}`, '\n\n');
const linked = (count: number): string => repeat(count, (index) => `para${index} [l${index}](/u${index})`, '\n\n');
const rawBlocks = (count: number): string => repeat(count, (index) => `<div>raw${index}</div>`, '\n\n');
const rawAndText = (count: number): string => repeat(count, (index) => `<div>raw${index}</div>\n\ntext${index}`, '\n\n');
const references = (count: number): string => repeat(count, (index) => `text${index} [l${index}][r${index}] end\n\n[r${index}]: /u${index}`, '\n\n');
const tight = (count: number): string => repeat(count, (index) => `- item${index}`, '\n');
const twoBlocks = (count: number): string => repeat(count, (index) => `- item${index}\n\n  more${index}`, '\n\n');
const fences = (count: number): string => repeat(count, (index) => `::: columns\nleft${index}\n|||\nright${index}\n:::\n\nsep${index}`, '\n\n');

type Edit = (count: number) => void;

/** The walks of the whole document (`$dfs()` with no start node) an edit makes. */
function documentWalks(edit: () => void): number {
    const walk = vi.mocked($dfs);

    walk.mockClear();
    edit();

    return walk.mock.calls.filter((call) => call.length === 0 || call[0] === undefined).length;
}

describe('large documents: the rules read the document once, not once for each block', () => {
    /**
     * The most walks of the whole document one row may make, whatever the
     * document's length. Every save makes one (`$readDefinitions`), and a row
     * makes a save for each update it runs, the loads and selections of its
     * set-up among them (measured: 2 to 16). Before the rules read a block's
     * definitions by what the block holds, they made one more walk for every
     * block they tidied or checked: 43 to 4,847 for the 40 blocks used here.
     */
    const DOCUMENT_WALKS_AT_MOST = 20;

    const ROWS: Array<[name: string, edit: Edit]> = [
        ['D1: a paste of paragraphs into an empty document', (count) => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
            paste(editor, paragraphs(count));
            editor.getValue();
        }],
        ['D2: a paste of paragraphs holding links', (count) => {
            const editor = load('');

            lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
            paste(editor, linked(count));
            editor.getValue();
        }],
        ['D3: bold over every paragraph', (count) => {
            const editor = load(paragraphs(count));

            selectAll(editor);
            editor.toggleBold();
            editor.getValue();
        }],
        ['D4: every paragraph made a code block', (count) => {
            const editor = load(paragraphs(count));

            selectAll(editor);
            editor.setBlockType('code');
            editor.getValue();
        }],
        ['D5: a load of raw blocks', (count) => { load(rawBlocks(count)).getValue(); }],
        ['D6: a load of raw blocks and paragraphs', (count) => { load(rawAndText(count)).getValue(); }],
        ['D7: a load of reference links and their definitions', (count) => { load(references(count)).getValue(); }],
        ['D8: a letter typed in a document of reference links and definitions', (count) => {
            const editor = load(references(count));

            caretIn(editor, 'text0 ');
            vi.mocked($dfs).mockClear();
            lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'z');
            editor.getValue();
        }],
    ];

    for (const [name, edit] of ROWS) {
        it(`${name} walks the document a fixed number of times`, () => {
            const short = documentWalks(() => edit(20));
            const long = documentWalks(() => edit(40));

            expect(long).toBe(short);
            expect(long).toBeLessThanOrEqual(DOCUMENT_WALKS_AT_MOST);
        });
    }

    /**
     * The most times a raw block may be asked whether it is written as a
     * paragraph, per raw block of the document, in one load or edit: once in
     * the first check of its siblings, once when its own text is new, once
     * for the block after it, and once in each of the passes the document's
     * own rule makes (measured: 4 to 6). Before a changed block checked only
     * the raw blocks it can change, each was asked once for every changed
     * block: 40 times and more in the documents used here.
     */
    const CHECKS_PER_RAW_BLOCK_AT_MOST = 8;

    it.each([
        ['R1: a load of raw blocks', rawBlocks],
        ['R2: a load of raw blocks and paragraphs', rawAndText],
        ['R3: a load of reference links and their definitions', references],
    ] as const)('%s asks each raw block a fixed number of times', (_name, source) => {
        const asked = vi.mocked($rawBlockWritesAsParagraph);

        for (const count of [40, 80]) {
            asked.mockClear();
            load(source(count)).getValue();

            expect(asked.mock.calls.length / count).toBeLessThanOrEqual(CHECKS_PER_RAW_BLOCK_AT_MOST);
        }
    });
});

describe('large documents: a run of list items is lifted and joined without a pass over the list for each item', () => {
    /** How many times `count` items make an edit call a spied function. */
    function calls(spy: { mockClear: () => void; mock: { calls: unknown[] } }, prepare: () => MarkdownEditor, edit: (editor: MarkdownEditor) => void): number {
        const editor = prepare();

        spy.mockClear();
        edit(editor);
        editor.getValue();

        return spy.mock.calls.length;
    }

    const all = (source: string) => (): MarkdownEditor => {
        const editor = load(source);

        selectAll(editor);

        return editor;
    };

    /**
     * The most lists one edit may copy to hold the rest of a list it splits,
     * whatever the list's length: one for the run it lifts (measured: 1).
     * Before, each lifted item made one, and moved every later item into it.
     */
    const REST_LISTS_AT_MOST = 2;

    it('L1: a block type set on every item of a list copies the list a fixed number of times', () => {
        const copy = vi.mocked($copyNode);
        const short = calls(copy, all(tight(20)), (editor) => { editor.setBlockType('h2'); });
        const long = calls(copy, all(tight(40)), (editor) => { editor.setBlockType('h2'); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(REST_LISTS_AT_MOST);
    });

    it('L7: a block type set on every block of a list whose items each hold a paragraph copies the list a fixed number of times', () => {
        const copy = vi.mocked($copyNode);
        const short = calls(copy, all(twoBlocks(20)), (editor) => { editor.setBlockType('h2'); });
        const long = calls(copy, all(twoBlocks(40)), (editor) => { editor.setBlockType('h2'); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(REST_LISTS_AT_MOST);
    });

    /**
     * The most siblings an edit may walk to count a node's place among them
     * (`getIndexWithinParent`, which walks from the first sibling), for each
     * item of the list (measured: 0 to 1). Before, every lifted item was
     * counted in its list, and its list in the document: 20 siblings an item
     * and more for the 40 items used here.
     */
    const SIBLINGS_WALKED_PER_ITEM_AT_MOST = 2;

    it.each([
        ['L2: the numbered toggle over a whole bulleted list', tight, (editor: MarkdownEditor): void => { editor.toggleOrderedList(); }],
        ['L3: the bulleted toggle off over a whole bulleted list', tight, (editor: MarkdownEditor): void => { editor.toggleUnorderedList(); }],
        ['L4: a block type set on every item of a list', tight, (editor: MarkdownEditor): void => { editor.setBlockType('h2'); }],
        ['L5: the bulleted toggle over a list whose items each hold a paragraph', twoBlocks, (editor: MarkdownEditor): void => { editor.toggleUnorderedList(); }],
    ] as const)('%s walks a fixed number of siblings for each item', (_name, source, edit) => {
        const counted = vi.spyOn(ElementNode.prototype, 'getIndexWithinParent');

        for (const count of [40, 80]) {
            calls(counted, all(source(count)), edit);

            // The place a call returns is the number of siblings it walked.
            const walked = counted.mock.results.reduce((sum, result) => sum + Math.max(0, Number(result.value)), 0);

            expect(walked / count).toBeLessThanOrEqual(SIBLINGS_WALKED_PER_ITEM_AT_MOST);
        }

        counted.mockRestore();
    });

    /**
     * The most whole-list looseness reads the bulleted toggle may make over
     * a list whose items each hold a paragraph, whatever its length
     * (measured: 3). Before, the toggle left a list for each item, and the
     * list rule joined them one at a time, reading the list it had grown to
     * each time.
     */
    const WHOLE_READS_AT_MOST = 10;

    it('L6: the bulleted toggle over a list whose items each hold a paragraph reads a whole list a fixed number of times', () => {
        const read = vi.mocked($listReadsLoose);
        const short = calls(read, all(twoBlocks(20)), (editor) => { editor.toggleUnorderedList(); });
        const long = calls(read, all(twoBlocks(40)), (editor) => { editor.toggleUnorderedList(); });

        expect(long).toBe(short);
        expect(long).toBeLessThanOrEqual(WHOLE_READS_AT_MOST);
    });
});

describe('large documents: a save lexes a block that closes its own fence alone', () => {
    /**
     * The most characters one save may hand to the block lexer for each
     * character of the document it writes, whatever the document's length
     * (measured: 0.8). Before, the save lexed every `:::` block
     * together with everything written after it: 22 and 42 characters for each
     * character of the 40 and the 80 fences used here.
     */
    const LEXED_FOR_EACH_CHARACTER_AT_MOST = 4;

    it('F1: a save of a document of `:::` blocks lexes text in proportion to the document', () => {
        const lex = vi.mocked(lexMarkdown);
        const lexedForEachCharacter = (count: number): number => {
            const editor = load(fences(count));

            lex.mockClear();

            const saved = editor.getValue();
            const lexed = lex.mock.calls.reduce((sum, call) => sum + call[0].length, 0);

            return lexed / saved.length;
        };

        expect(lexedForEachCharacter(40)).toBeLessThanOrEqual(LEXED_FOR_EACH_CHARACTER_AT_MOST);
        expect(lexedForEachCharacter(80)).toBeLessThanOrEqual(LEXED_FOR_EACH_CHARACTER_AT_MOST);
    });
});

describe('large documents: what the edits leave', () => {
    it('S1: a block type set on every item of a list gives one block for each item, and one undo gives the list back', () => {
        const editor = load(tight(6));
        const before = editor.getValue();

        selectAll(editor);
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe(repeat(6, (index) => `## item${index}`, '\n\n'));

        lexicalOf(editor).dispatchCommand(UNDO_COMMAND, undefined);

        expect(editor.getValue()).toBe(before);
    });

    it('S2: a block type set on the first items of a list leaves the rest one list', () => {
        const editor = load(tight(5));

        lexicalOf(editor).update(() => {
            const texts = $getRoot().getAllTextNodes().filter($isTextNode);
            const selection = $createRangeSelection();

            selection.anchor.set(texts[0]!.getKey(), 1, 'text');
            selection.focus.set(texts[2]!.getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.setBlockType('h2');

        expect(editor.getValue()).toBe('## item0\n\n## item1\n\n## item2\n\n- item3\n- item4');
    });

    it('S3: the bulleted toggle over a list whose items each hold a paragraph makes each paragraph an item of the same list', () => {
        const editor = load(twoBlocks(3));

        selectAll(editor);
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('- item0\n\n- more0\n\n- item1\n\n- more1\n\n- item2\n\n- more2');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S4: text typed after a raw block that runs on shows that block as the paragraph it is saved as', () => {
        const editor = load('<!-- open');

        lexicalOf(editor).update(() => {
            $getRoot().append($createParagraphNode());
            $getRoot().selectEnd();
        }, { discrete: true });

        expect(editor.getValue()).toBe('<!-- open');

        lexicalOf(editor).dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, 'x');

        expect(editor.getValue()).toBe('\\<!-- open\n\nx');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S5: paragraphs pasted between raw blocks that run on show each of those blocks as a paragraph', () => {
        const editor = load('p0');

        caretIn(editor, 'p0');
        paste(editor, '<!-- a\n\nx0\n\n<pre>\n\nx1');

        const saved = editor.getValue();

        expect(load(saved).getValue()).toBe(saved);
        expect(saved).toContain('\\<!-- a');
    });

    it('S6: an unclosed fence opener is written escaped once a block after it holds the line that would close it', () => {
        const editor = load('::: note\n\np0\n\np1');

        expect(editor.getValue()).toBe('::: note\n\np0\n\np1');

        caretIn(editor, 'p0');
        paste(editor, 'x0\n\n<div>\n:::\n</div>\n\nx1');

        expect(editor.getValue()).toBe('\\::: note\n\npx0\n\n<div>\n:::\n</div>\n\nx10\n\np1');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S7: a fence that closes itself stays as written when a block after it holds a closing line', () => {
        const editor = load('::: columns\nl0\n|||\nr0\n:::\n\np0');

        caretIn(editor, 'p0');
        paste(editor, 'x0\n\n<div>\n:::\n</div>\n\nx1');

        expect(editor.getValue()).toBe('::: columns\nl0\n|||\nr0\n:::\n\npx0\n\n<div>\n:::\n</div>\n\nx10');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S8: a toggle over two runs between lists keeps a loose list after the second run loose, and the joined list with it', () => {
        const editor = load('* a\n\np\n\n* b\n\nq\n\n* c\n\n* d');

        lexicalOf(editor).update(() => {
            const texts = $getRoot().getAllTextNodes().filter($isTextNode);
            const selection = $createRangeSelection();

            selection.anchor.set(texts[1]!.getKey(), 0, 'text');
            selection.focus.set(texts[3]!.getKey(), 1, 'text');
            $setSelection(selection);
        }, { discrete: true });
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('* a\n\n* p\n\n* b\n\n* q\n\n* c\n\n* d');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });

    it('S9: a toggle over one run before a loose list makes the joined list loose', () => {
        const editor = load('* a\n\nq\n\n* c\n\n* d');

        caretIn(editor, 'q');
        editor.toggleUnorderedList();

        expect(editor.getValue()).toBe('* a\n\n* q\n\n* c\n\n* d');
        expect(load(editor.getValue()).getValue()).toBe(editor.getValue());
    });
});
```

---

## Notes

[^machine]: One vitest process at a time and nothing else of the planner's running, 13 to 21 GB of memory available, a load of 1 to 5 on 24 cores, `marked` 18.0.9. "Before" is `fef32344b` with the looseness plan's prototype applied; "after" is that with this plan's final code. The conditions, every edit timed and what could not be timed are in *Addendum: what the planner measured*.

[^survey]: The kinds of document: plain paragraphs, headings, paragraphs with bold and italic, one tight list, one loose list, a list whose items each hold a paragraph, many short lists, nested lists, raw blocks, reference links with a definition after each, reference links with all their definitions in one block, tables, and `:::` columns. The edits: a typed letter, Enter, Backspace at a block's start, a caret move, the selection-state read over the whole document, a small paste, a paste of the whole document into an empty one, cut and delete of everything, both list toggles, three block types and bold over everything, each with its undo and redo, and the load and the save. The survey ran while other suites kept the machine busy, so it was used to find the paths and not for its numbers. The clean timings cover fewer edits and sizes: 13 edits on seven kinds at 500 and 2,000 blocks; seven edits on three kinds, and two on `:::` columns, at 8,000; and eight edits on the three kinds with raw blocks at 50 to 2,000. They are in *Addendum: what the planner measured*, with what was not timed.

[^identical]: Measured, not argued: see `## Verification`, *The differential*, and its result in the addendum. For part B, "identical" is with each node named by where it stands; see [^by-name].

[^one-plan]: None of the seven is a redesign: the largest, P3, adds one function of 20 lines and a per-update variable that copies an existing one. Splitting them into two plans would give two plans that need the same differential, on the same copies. The three parts are still kept apart inside the plan, because their proofs differ, and because part C alone needs a yes: with a no the plan ends after part B and loses nothing else.

[^local]: `$needsDefinitions` is an optimisation of its own time: it let a document with no reference skip lexing its definitions. Since `markdown-editor-raw-block-edge-cases` the definitions of a raw block's text are remembered, so the walk that decides whether to read them costs more than the read it saves, and it is made once for every block a rule checks. Asking the block itself costs a walk of the block.

    `$runsReadingOtherwise` passes the definitions without asking today. It asks the block after this plan, as the other three do.

[^outside]: Found by the aimed set of the differential, on the first form of the prototype, which gave every block that holds a reference the definitions. A range deleted from inside a raw block into a paragraph joins the rest of the paragraph to the raw block as its Markdown (`$inlineMarkdown`, MarkdownEditor.ts L2893), and writes that Markdown while the paragraph's nodes are out of the document. In `[foo]: /u0⏎⏎[foo]: /u1⏎⏎x [a][foo] y`, with the range from after the first `[` to after `x`, today's code writes the link inline, `[a](/u0)`, because the document then holds no other reference; the first prototype wrote `[a][foo]`, whose definition the same edit removes, and the link was lost. 72 of the set's 273,998 recorded states differed that way. So today's answer is kept exactly: a block outside the document asks the document.

    **Rejected: read the definitions once for the update and keep them.** That is the seam of `registerDefinitionRules`, and it is what P3 uses for its own record. For the definitions it is wrong, because the value read can be changed by any write between two reads: a command that joins a paragraph into a raw block reads the definitions, writes the raw block, and then the rules read again. Lexical keeps no count of writes, and marks a node dirty only the first time it is written in a pass, so a kept value cannot be checked cheaply. It would have to be dropped by hand at every place that can change a raw block, and a place that is missed gives a silently wrong reading. The record of P3 has no such risk: it says only that a whole check has been made.

[^reads-alike]: The comment of `registerDefinitionRules` (markdownWritable.ts L1147): "only source kept as written reads differently under others… Everything else the editor holds reads alike under any definitions: text escapes its brackets, so text never becomes a link". `needsEscape` (markdownSerializer.ts L5687) escapes `[` and `]` always. Part A's differential is the check: it passes the definitions to fewer blocks and every recorded save and update is the same.

[^emptiness]: `$writesSomething` (markdownSerializer.ts L2493) passes `null` for the same question with the comment "Definitions only choose how a reference link is written, never whether a block writes anything". A reference link writes `[text][label]` or `[text](url)`, never nothing.

[^first-whole]: Today every changed paragraph, item text and raw block checks every raw block among its siblings. So a raw block that some other change made writable as a paragraph is turned by whichever changed block comes first. The first whole check keeps that for everything the command did. After it, a raw block can come to be written as a paragraph only through a later change, and each kind of change is covered: a change of its own text or place runs the raw block's own rule, which checks the raw block itself; a paragraph or item text after it that comes to write something runs this rule for that block, which reaches back to it; and at the top level the document's own rule checks every raw block at the end of each pass, as today.

    What the later checks no longer do is turn a raw block for a reason that has no rule of its own, such as a heading after it that a rule gives content, when another changed block of the same parent happens to follow in the same update. No such case was found: the aimed set holds raw blocks before headings, quotes, lists and tables for this reason, and part A's digests are identical on it.

    The walk back stops at the nearest block that writes something, which `$writesSomething` answers without reading definitions. A block before that one already had it after it when the first whole check ran.

[^range-edits]: Read from `plans/markdown-editor-raw-block-range-edits.md`, *`$showRawBlockAsSaved` at module level*: `checkSiblings` becomes `$showSiblingRawBlocksAsWritten` at module level, `$showRawBlockAsSaved` is exported, and `$removeGuardedRange` calls it right after a removal. That call runs inside a command, before the rules. Leaving it the whole check keeps that plan's behaviour as it measured it, and keeps the record of this plan to what the rules do. The final code was applied and measured on the dependency's shape for these two functions, on a copy of `fef32344b` that does not hold the dependency's other changes.

[^made-now]: Today the first lift of an item at the front of a list that was in the document replaces that list by a new node. With the rule applied to every list, the old node would stay instead: the same document, with another node standing for the list. That is a difference in the committed state that the comparison by name would report, so the rule is kept to lists the update made itself, which only ever stand for "the rest of the list being lifted". `$isMadeInThisUpdate` asks the committed state for the list's key.

    A selection point that stands on the list itself, between two of its items, also keeps today's path: Lexical moves such a point when the list goes. A point inside an item does not matter: the item stays in the same list either way. The first form of the prototype kept today's path for a point anywhere in the list, and `setBlockType` over a list whose items each hold a paragraph stayed quadratic, because the selection's end stays in the last item's paragraph; row `L7` pins that case.

[^by-name]: A list made and dropped within one update is in no committed state, in no dirty set and in no undo step: Lexical drops a node that is detached when the update ends, if the state before did not hold it. Only the counter that numbers new nodes has moved. So after part B a heading made by `setBlockType` over a list has a lower key than today, and the plain digests, which hash the keys, differ.

    The `.canon` digests name every node by the order in which nodes first appear in committed states, walking each state in document order. Two runs give a node the same name exactly when their committed trees have had the same shape from the start, and a node that was in the state before keeps its name. They hash the same state, selection, dirty sets and tags as the plain digests, under those names.

    **Rejected: keep making one list per lifted item.** With the same nodes made in the same order, the items after the lifted one must end up in the newest list, and moving them there is the quadratic cost. There is no cheaper way to give n items a new parent n times.

[^unwalked]: `$removeNode` (Lexical 0.49, `LexicalNode.ts`) walks the siblings only when the selection is a range and neither of its points was on the removed node; its own comment reads "Doing this is O(n) so lets avoid it unless we need to do it". It uses the place for `$updateElementSelectionOnCreateDeleteNode`, which returns at once unless a point stands on the parent. Before that it moves a point that stands inside the removed node. `$holdsPointAt` is true in each of those three cases, and `$removeUnwalked` then calls `$removePlainly`. In every other case what is left of `$removeNode` is `$removeFromParent`, the removal of a parent left empty, and `selectEnd` on an emptied root, which `$removeUnwalked` does in that order.

    `insertAfter` walks for the same reason when its second argument is not `false`, and `splice` needs the index its caller computed by walking. With `false`, `insertAfter` writes the same links as `splice` and leaves the selection alone, which is what `splice` does for an insert.

    This follows `$removePlainly` (markdownListItemNode.ts L600), which already calls `ElementNode.prototype.remove` past a class's override. The helpers depend on what `$removeNode` does today; rows `L2` to `L4` and the differential pin it.

[^join-now]: `$makeItemsOfRun` already prepares that join: it sets the first list loose when the second is loose and the two write the same marker, with the comment "The list transform joins `below` into `above` when their markers match; a loose one makes the whole list loose". The list rule joins on the same test (`$normalizeList`, markdownWritable.ts L461), and not during a load, which never runs a toggle. After the join the first list is still changed, so the list rule runs for it as today, numbers it and reads its looseness, once.

    **Rejected: make the list rule's own joins cheap.** The rule joins the lists from the last backwards, and each join moves the items of the list that has grown. Joining in another order, or moving the smaller list's items, changes which list node is left or in which order the looseness of the lists is read, and the result of today depends on that order ([^chain]). No order was found that is both cheap and the same as today in every case.

[^chain]: `$makeItemsOf` hands its runs to `$makeItemsOfRun` first to last. For the document `* a⏎⏎p⏎⏎* b⏎⏎q⏎⏎* c⏎⏎* d` the lists are `[a]`, `[b]` and the loose `[c, d]`, and the runs are `p` and `q`.

    Today: the run `p` goes into `[a]`; the list after it, `[b]`, is tight, so nothing is set. The run `q` goes into `[b]`; the list after it is loose, so `[b]` is set loose. The list rule then joins the three lists into the first. A join keeps the first list's looseness and drops the second's, so the looseness set on `[b]` is lost, and the whole list is written tight.

    After: the run `p` goes into `[a]`, and `[b]` is joined into it at once. The run `q` then stands between that one list and `[c, d]`; the list after it is loose, so the list before it, which is now the whole list, is set loose.

    With one run the two agree, because the list set loose is the one that stays. The docs describe the toggles so (`docs/components/MarkdownEditor.md`, the row of `toggleUnorderedList()`): "the joined list is tight when the lists it joins are tight and the new item holds its text alone, and loose when one of them is loose".

    In the differential one record reaches this, of the 77,396 of the toggle sets, and none of the other families: row `dxb124/tod-lor` of the toggle set `dxb2`, a bulleted toggle over twelve blocks, in and between three lists, the last of them loose. Its tree is the same on both sides and its save is loose after, tight before. A trace of that case on both sides shows the steps above (`$K/out/p6/trace-trb.txt`, `trace-trf.txt`). The small rows `S8` and `S9` were made from it.

[^join-flag]: Lexical's update listeners get `dirtyElements` as a map from a node's key to a flag: `true` when the node itself was written, `false` when it is in the map only because something inside it was written. The rules run in passes, and the flag an update ends with is the one of the last pass that dirtied the node (`$applyAllTransforms` writes it anew for each pass). Before, the list rule joined the two lists in a pass, so the list was written in that pass and ended `true`. Now the command joins them, and the last pass that touches the list marks it only through something inside it: `false`.

    One reader of the flag exists after an update: `@lexical/history`'s `getDirtyNodes`, which counts the leaves and the elements flagged `true` to tell typing from other changes (`getChangeType`: none, one, or more than one). A toggle that makes a block an item writes the new item and its text as well, so the count is more than one on both sides, and the change is classed alike. The library itself reads no `dirtyElements`. The differential's undo and redo records are the same on both sides.

    When the two lists stand in a list item or in a `:::` column, that element's flag changes the same way, for the same reason.

    **Rejected: write the list once more so the flag reads `true`.** That would be a write made only to look like the old run of passes.

[^count]: `vi.mock` with `importOriginal` replaces a module for every module that imports it and passes every export through but the wrapped ones. `$dfs` is `@lexical/utils`'; `$needsDefinitions` is its one caller with no start node in the rules, and the rows count only such calls. `$copyNode` is `lexical`'s; the lifts are its only callers in an edit of a list. `getIndexWithinParent` is spied on `ElementNode.prototype`, and its results are summed: the place it returns is the number of siblings it walked. `lexMarkdown` is `markdownExtensions.js`'; the row sums the lengths of the texts it is handed during one save. The bounds are far from both sides: 2 to 16 walks after and 43 to 4,847 before; 5 to 6 checks for each raw block after and 81 to 241 before; 0 to 1 siblings for each item after and 20 to 160 before; 0.8 characters lexed for each one saved after and 22 to 42 before.

[^what-remains]: **Definitions.** After this plan a block that holds a reference reads the document's definitions when a rule checks it: twice for a pasted paragraph, once for a block made a code block. The read (`$documentDefinitions`) visits every top-level block and every list item to find the raw blocks, works out each raw block's source, and lexes each text it does not remember (it remembers 256). Typing, Enter, Backspace, a paste of a few blocks and a load read it a fixed number of times. A CPU profile of the paste of 500 reference links with their 500 definitions: 6,356 ms, of which `$documentDefinitions` 5,340.

    Removing it needs one read for the update, which is rejected in [^outside], or an index of the document's raw blocks kept in step with every write. A raw block's text is written through Lexical's own `TextNode`, so the library has no place to hook such an index.

    **Lexical's paste.** The profile of a paste of 8,000 paragraphs on the final code: 2,172 ms in the paste's update, of which `insertNodes` → `insertRangeAfter` → `insertAfter` → `getIndexWithinParent` 1,525 ms, and this library's rules 461 ms. It is the same walk P5 removes from the library's own calls.

    **Open fences and labels.** `readsOtherwiseAfter` lexes a block's text with all that follows it. After P7 it runs only for an unchanged block that starts with a `:::` opening line no line of the block closes (the block loaded as a paragraph), and, as today, for one that ends inside an open definition label or title (`OPEN_LABEL`, `OPEN_TITLE`). What closes such a block can stand any distance after it, so no part of the rest is safe to leave out.

    **`marked` and many definitions.** `marked`'s inline lexer starts with `Object.keys` over the definitions it holds (`inlineTokens`, to mask reference links), for every block. `lexMarkdownWithDefinitions` (markdownExtensions.ts L674) copies the document's definitions into a new lexer for every block it reads back. Handing the definitions over by prototype instead of by copy would hide them from that `Object.keys`, and so change what `marked` reads. The profile of the load of 1,000 reference links and their definitions: 576 ms, of which the importer's read-back of each paragraph 269.

    **Lines of one block.** `registerLineBreakRules` (markdownWritable.ts L1481) calls `$dropUnwritableBreaks` for a text's block from every changed text. For a heading that call writes the heading (`$headingWritesOneLine`) to learn whether it fits one line. The profile of `setBlockType("h2")` over 500 paragraphs and one raw block of 500 lines: 1,185 ms, of which `$dropUnwritableBreaks` 768. The profile of the load of 1,000 paragraphs and one raw block of 1,000 lines: 894 ms, of which `$rawBlockSource` for that one block 300 (`marginCandidates`, `rawBlockInBlockList`).

[^own-fence]: `BLOCK_EXTENSION` (markdownExtensions.ts L130) is the tokenizer of a `:::` fence, and the only block-level extension the lexer has (`MARKDOWN_EXTENSIONS`, L592). `marked` tries block extensions before its own rules, so at the start of a block that opens with a `:::` line this tokenizer answers first. It reads the opening line, then one line at a time (`readFenceLine`, which tracks nested fences and code fences), and stops at the first line that closes the fence; its token is the text up to the end of that line. With no such line it declines, and the lines are read as paragraphs.

    So when the block's own text holds the closing line, the tokenizer reads the same lines and stops at the same place whatever is appended, provided the closing line itself is not made longer. `closesOwnFence` checks that: the text after the token, or else the separator written after the block, starts with a line end. `fenceClosedAfter` compared the block's first token alone and with what follows; for such a block the two are the same token, so the answer was always `false`.

    Measured on a copy that computes both answers: over the fence set of the differential (17,024 cases), 241,865 questions were skipped, and the full lex answered `false` for every one of them; 173,248 were still asked, of which 160 answered `true`.

    `labelClosedAfter` uses the same `readsOtherwiseAfter` and is left as it is. Its first test lets a block through only when the block ends inside an open label or title, and no document of the survey holds one.

    **Rejected: stop the lexer after the token in question.** That would bound the cost for every block, the open ones too. `marked` has no way to stop early, and a tokenizer that looks for a closing line or a closing `]` reads to the end of what it is given when there is none.
