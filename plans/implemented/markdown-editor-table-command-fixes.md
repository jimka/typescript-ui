---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/Markdown.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-editor-table-edge.test.ts
  - packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts
---

# MarkdownEditor Table Command Fixes — Implementation Plan

## Overview

Five defects in `MarkdownEditor`'s WYSIWYG commands were recorded as still open
during the reviews of the Markdown stack. All five were reproduced for this
plan, at the stack's tip and on `master`.[^reproduced] This plan fixes them in
four parts, all in
[MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts):

| Part | Defect | Fix in one line |
|---|---|---|
| A | `insertTable()` at the end of a quote leaves an empty `>` after the table | the table is inserted without an empty copy of the block it splits |
| B | `mergeTableCells()` saves a literal `\n\n` | `\n\n` is the dialect's cell break and stays; the merge itself gets three fixes |
| C | a toolbar click with cells selected leaves the keyboard on the button; Lexical warns "ran while a read-only context was on the stack" | a command takes the keyboard before its update, and a document load does not move it |
| D | `insertImage()` throws for a caret on a list or `:::` block; Delete, Enter and `insertTable()` leave an emptied container | one rule moves such a selection point to a caret position before a command acts |

Part A's defect is wider than recorded: the empty copy is also left after a
heading (`#`) and a list item (`-`), and *before* the table when the caret is
at a block's start. Part B found two more faults in the merge. After a merge
the selection names a cell that no longer exists, so every table control is
disabled until the next click. And merging header cells moves their text into
one cell without merging anything.

No public signature changes. The serializer, the importer, the viewer and
`MarkdownDocumentPanel` are not touched. Two docs pages, the changelog and
the round-trip corpus are updated.

Line numbers are from `63a81117d`, the tip of
`feature/markdown-raw-block-html-tail-parity`. Four sibling plans edit the same
file, so find each site by its symbol name first.

---

## Architecture Decisions

### A1 — `insertTable()` inserts the table itself, and makes no empty half

`insertTable()` stops dispatching `INSERT_TABLE_COMMAND`. It creates the table
with `$createTableNodeWithDimensions` and places it with Lexical's
`$insertNodeToNearestRootAtCaret`, passing `$shouldSplit: () => false`. That
option splits the caret's block only where both halves hold content.[^split]

| Caret in `> quote` | Before | After |
|---|---|---|
| at the end | `> quote`, table, `>` | `> quote`, table |
| at the start | `>`, table, `> quote` | table, `> quote` |
| after `qu` | `> qu`, table, `> ote` | the same |

The same holds for a heading, a list item and a paragraph. A list is split
between two items when the caret is at an item's edge, so no empty item is
left: the end of `one` in `- one\n- two` gives `- one`, table, `- two`.

### A2 — A table that ends its container gets an empty paragraph after it

When the inserted table has no next sibling, `insertTable()` adds an empty
paragraph after it. An empty paragraph saves nothing, and it is what an insert
at a paragraph's end has always left, so the caret can go below the
table.[^trailing]

### B1 — A merged cell saves its paragraphs with the dialect's cell break

The saved `1\n\n2` (backslash, `n`, backslash, `n`) is not changed. It is the
dialect's *cell break*: what a table cell writes between two of its
paragraphs. The viewer renders it as one `<br>` and the importer reads it back
as a paragraph boundary. A merged cell holds one paragraph per merged cell
that had content, so the save reloads to what the editor shows and reads the
same in the viewer.[^cell-break] The cell break is in neither docs page and
not in the round-trip corpus; this plan adds it to both.

### B2 — An empty first cell leaves no blank line

When the top-left cell of the merge is empty and another cell has content, the
merged cell drops the empty paragraph it started with.[^blank-line]

| Cells merged | Before | After |
|---|---|---|
| `1`, `2` | `1\n\n2` | the same |
| empty, `2` | `\n\n2` | `2` |
| `1`, empty | `1` | the same |
| a cell saved as `\n\nx`, then `2` | `\n\nx\n\n2` | the same: that blank line was the author's |

### B3 — Header cells do not merge

`canMergeCells` is `false` when the selected cells include a cell of the
table's first row, and `mergeTableCells()` then changes nothing. Markdown
merges body cells only.[^header-merge]

### B4 — After a merge the caret is in the merged cell

`mergeTableCells()` ends by putting a caret at the end of the merged cell's
content. `canUnmergeCell` and `canEditTable` are then `true` at once, and the
selection names a node that exists.[^merge-caret]

### C1 — A command takes the keyboard before its update

`refocusSurface()` becomes the one way the WYSIWYG surface gets the keyboard.
It focuses the surface's element through the DOM seam
(`this._wysiwyg.focus(true)`), then calls Lexical's `focus()` as it does today.
`commandApplies()` calls `refocusSurface()` whenever its answer is `true`, so
every command that applies takes the keyboard *before* its update runs. A
command that declines still changes nothing, the focus included.

This one change fixes two defects. With cells selected, Lexical never focuses
its root, so the keyboard stayed on the toolbar button.[^table-focus] And with
the keyboard already in the editor, Lexical's commit raises no focus event, so
the warning is not triggered.[^warning-ours]

The commands that do not go through `commandApplies()` call
`refocusSurface()` themselves, before their first update: `copy()`, `cut()`,
`paste()`, `toggleLink(null)` and the public `focus()`. This mirrors what
`copy()` and `paste()` already do, moved ahead of the update.[^precedent-focus]

### C2 — The surface is focused only where that keeps the selection

`refocusSurface()` focuses the surface's element in two cases only:

- the editor's selection is a table selection, or
- the browser's selection already lies inside the editor.

In any other case it skips the element focus and calls Lexical's `focus()`
alone, as today.[^focus-guard]

| Editor's selection | Browser's selection | Element focused first? |
|---|---|---|
| a caret or range | inside the editor (after a toolbar or menu click) | yes |
| table cells | none (Lexical removes it) | yes |
| a caret or range | in another element | no |
| none | anywhere | no |

### C3 — Loading a document does not move the keyboard

`setValue()` and `setMode("wysiwyg")` load through one private method,
`loadWysiwygDocument()`. When the surface does not hold the keyboard, the load
is tagged with Lexical's `SKIP_DOM_SELECTION_TAG`, so Lexical does not write
its selection to the browser. Writing it is what pulled the keyboard into the
editor, and what raised the warning inside `setValue`.[^load-focus] When the
surface holds the keyboard, the load is as today and the caret goes to the
document's start.

### D1 — A point where no caret can be is moved before a command acts

A selection made in code can hold a point on a node that holds blocks. The
browser never makes one, and Lexical's insert and removal fail on it. One
function, `$settleSelectionOffContainers`, moves such a point to the caret
position it names. After that, a command does what it does for the same
selection made with the mouse.[^one-rule]

Which points are moved:

| The point is on | Moved when |
|---|---|
| a list, a `:::` block, or a list item whose first child is a block | always |
| the root or a `:::` column, between two blocks | the selection is a range (not collapsed) |
| a table, a table row or a table cell | never |
| a paragraph, heading, quote or other block holding text | never |

Where a point goes:

| Point | Goes to |
|---|---|
| a caret, or a range's start | the start of the block after the point; at the container's end, the end of the block before it |
| a range's end | the end of the block before the point; at the container's start, the start of the block after it |

Worked on `Above\n\n- one\n- two` (root children: paragraph, list):

| Selection | Becomes |
|---|---|
| caret on the list, between its items | caret at the start of `two` |
| caret on the list, at its end | caret at the end of `two` |
| from the root's start to the end of `two` | from the start of `Above` to the end of `two` |
| from the root before the list to the list's end | from the start of `one` to the end of `two` |
| caret on the root before the list | not moved |

The collapsed caret between blocks and the table points stay because Lexical
and `@lexical/table` make and handle them themselves.[^left-alone]

### D2 — The rule runs where a range is removed or something is inserted

`$settleSelectionOffContainers` is called at the editor's existing seam for
"before a range is removed or replaced": the range guards.[^guard-seam] Five
call sites cover every route:

1. the `guard` helper in `registerRangeGuards` wraps each guard listener, so
   every guarded Lexical command settles first;
2. `$removeGuardedRange`, which `cut()`, `paste()` and the removal Enter makes
   in a raw block call;
3. `insertTable()`'s update;
4. `insertImage()`'s update;
5. `$handleRawBlockEnter`, which reads the selection before it removes it.

The two inserts call it themselves, ahead of `$removeGuardedRange`, because
they need to know whether a point moved (D3).

The other commands (formats, block types, alignment, table commands) are not
changed: none of them throws or empties a container on such a
point.[^other-commands]

### D3 — `insertImage()` and `insertTable()` judge again once a point moved

Both read their `can…` field before their update, on the selection as it
stood. When `$settleSelectionOffContainers` moves a point, the insert reads
`$imageInsertApplies` / `$tableInsertApplies` again inside the update and
returns without inserting when the answer is now `false`.[^judge-again]

### D4 — `$replaceEmptiedContainerAtCaret` is removed, and six R43 tests change

`$replaceEmptiedContainerAtCaret` patched one command for one result of the
missing rule. With the rule in place it can no longer find anything, so it is
deleted with its call.[^dead-patch] Six of the R43 tests in
`markdown-editor-table-edge.test.ts` pinned what the patch produced: an image
in a paragraph of its own, the list or `:::` block gone. Their expected values
change to what the mouse selection of the same text gives: the image in what
is left of the list item or column.[^r43] The new values are listed under
*Expected Behaviour*.

### E — What stays upstream

The warning itself is raised by Lexical for a focus event its own commit
causes, and `@lexical/table` registers the listener that exposes it. After
this plan the editor's own commands and loads no longer trigger it. It can
still appear when Lexical's commit pulls the keyboard in by itself, which the
cases of C2's table marked "no" still allow. See
*Addendum: The Lexical warning*.

---

## Internal Structure

All in `MarkdownEditor.ts`. Every new function carries JSDoc per the code
conventions; the snippets leave it out for space.

### Part A

```ts
/** `$insertNodeToNearestRootAtCaret`'s split test: never make a half that would be empty. */
function $makesNoEmptyHalf(): boolean {
    return false;
}

function $insertTableAt(point: PointType, rows: number, columns: number): void {
    const table = $createTableNodeWithDimensions(rows, columns, { rows: true, columns: false });

    $insertNodeToNearestRootAtCaret(table, $caretFromPoint(point, "next"), { $shouldSplit: $makesNoEmptyHalf });

    const endsContainer = table.getNextSibling() === null;

    if (endsContainer) {
        table.insertAfter($createParagraphNode());
    }

    table.selectStart();
}
```

`insertTable()`'s update becomes:

```ts
editor.update(() => {
    const initial = $getSelection();
    const moved = $settleSelectionOffContainers(initial);
    const isTableEdge = $isTableEdgeRange(initial);

    if (isTableEdge) {
        $removeTableEdgeRange(initial, $holdsNoTable);
    } else if (!$isRangeSelection(initial)) {
        $getRoot().selectEnd();
    }

    const selection = $getSelection();
    const declinedOnceSettled = moved && !$tableInsertApplies($selectionTouchesTextOnlyBlock());

    if (!$isRangeSelection(selection) || declinedOnceSettled) {
        return;
    }

    $insertTableAt(selection.focus, rows, columns);
}, { discrete: true });
```

### Part B

```ts
function $holdsOneEmptyParagraph(cell: TableCellNode): boolean {
    const only = cell.getFirstChild();

    return cell.getChildrenSize() === 1 && $isParagraphNode(only) && only.isEmpty();
}

function $isHeaderCell(cell: TableCellNode): boolean {
    const row = cell.getParent();

    return row !== null && row.getPreviousSibling() === null;
}
```

`mergeTableCells()`'s update body:

```ts
const cells = selection.getNodes().filter($isTableCellNode);
const emptyBefore = new Set(cells.filter($holdsOneEmptyParagraph).map((cell) => cell.getKey()));
const merged = $mergeCells(cells);

if (merged === null) {
    return;
}

const leadsWithBlank = emptyBefore.has(merged.getKey()) && merged.getChildrenSize() > 1;

if (leadsWithBlank) {
    merged.getFirstChildOrThrow().remove();
}

merged.selectEnd();
```

`$readTableAvailability` reads the selected cells once:

```ts
const selectedCells = $isTableSelection(selection) ? selection.getNodes().filter($isTableCellNode) : [];
const holdsHeaderCell = selectedCells.some($isHeaderCell);
// ...
canMergeCells: selectedCells.length > 1 && !holdsHeaderCell,
```

### Part C

```ts
function $surfaceFocusKeepsSelection(editor: LexicalEditor): boolean {
    const isTableSelection = $isTableSelection($getSelection());

    if (isTableSelection) {
        return true;
    }

    // Lexical's own reading of the browser's selection: null when it lies outside the editor.
    const browserSelection = DOM.source.readDocumentSelection((selection) => $createRangeSelectionFromDom(selection, editor));

    return browserSelection !== null;
}
```

```ts
private refocusSurface(): this {
    const editor = this.ensureEditor();
    const mounted = editor.getRootElement() !== null;
    const keepsSelection = mounted && editor.read(() => $surfaceFocusKeepsSelection(editor));

    if (keepsSelection) {
        this._wysiwyg.focus(true);
    }

    editor.focus();

    return this;
}

private surfaceHoldsKeyboard(): boolean {
    const element = this._wysiwyg.getElement();

    if (!element) {
        return false;
    }

    return DOM.source.contains(element, DOM.source.getActiveElement());
}

private loadWysiwygDocument(editor: LexicalEditor, markdown: string): void {
    const holdsKeyboard = this.surfaceHoldsKeyboard();
    const options: EditorUpdateOptions = holdsKeyboard ? { discrete: true } : { discrete: true, tag: SKIP_DOM_SELECTION_TAG };

    // Discrete forces a synchronous commit, so the resulting `"change"` fires before the caller returns.
    editor.update(() => {
        this.adoptSourceMap($importMarkdown(markdown));
    }, options);
}
```

`commandApplies()` ends:

```ts
const applies = this.ensureEditor().read(() => $readCommandAvailability($computeWordExpansion())[field]);

if (applies) {
    this.refocusSurface();
}

return applies;
```

### Part D

```ts
function $holdsNoCaret(node: LexicalNode): boolean {
    if ($isListNode(node) || $isMarkdownBlockNode(node)) {
        return true;
    }

    const first = $isListItemNode(node) ? node.getFirstChild() : null;

    return $isElementNode(first) && !first.isInline();
}

function $liesBetweenBlocks(node: LexicalNode): boolean {
    return $isRootOrShadowRoot(node) && !$isTableCellNode(node);
}

function $pointNeedsSettling(point: PointType, isCollapsed: boolean): boolean {
    if (point.type !== "element") {
        return false;
    }

    const node = point.getNode();

    return $holdsNoCaret(node) || (!isCollapsed && $liesBetweenBlocks(node));
}

function $settlePoint(point: PointType, prefers: CaretDirection): void {
    const container = point.getNode();

    if (!$isElementNode(container)) {
        return;
    }

    const next = container.getChildAtIndex(point.offset);
    const previous = container.getChildAtIndex(point.offset - 1);
    const preferred = prefers === "next" ? next : previous;
    const direction: CaretDirection = preferred !== null ? prefers : (prefers === "next" ? "previous" : "next");
    const neighbour = direction === "next" ? next : previous;

    if ($isTextNode(neighbour)) {
        point.set(neighbour.getKey(), direction === "next" ? 0 : neighbour.getTextContentSize(), "text");

        return;
    }

    // As $settleCaretIntoBlock enters a block: a child caret, brought down to the deepest position.
    if ($isElementNode(neighbour)) {
        $setPointFromCaret(point, $normalizeCaret($getChildCaret(neighbour, direction)));
    }
}

function $settleSelectionOffContainers(selection: BaseSelection | null): boolean {
    if (!$isRangeSelection(selection)) {
        return false;
    }

    const isCollapsed = selection.isCollapsed();
    const [start, end] = $orderedPoints(selection);
    const startMoves = $pointNeedsSettling(start, isCollapsed);
    const endMoves = !isCollapsed && $pointNeedsSettling(end, isCollapsed);

    if (startMoves) {
        $settlePoint(start, "next");
    }

    if (isCollapsed) {
        end.set(start.key, start.offset, start.type);
    } else if (endMoves) {
        $settlePoint(end, "previous");
    }

    return startMoves || endMoves;
}
```

`$orderedPoints` returns the selection's own two points, start first, as
`$coverWholeTables` already relies on. A container with no child at all is
left as it is: nothing in the editor makes one once this rule runs.

The `guard` helper in `registerRangeGuards`:

```ts
const guard = <P>(command: LexicalCommand<P>, listener: CommandListener<P>): (() => void) =>
    editor.registerCommand(command, (payload, target) => {
        $settleSelectionOffContainers($getSelection());

        return listener(payload, target);
    }, COMMAND_PRIORITY_CRITICAL);
```

---

## Ordered Implementation Steps

Work test-first: write the rows of a part, see them fail, then make the change.

**Tests**

1. Create `packages/lib/tests/component/markdown-editor-table-commands.test.ts`
   (offline, modelled DOM). Copy the header and the helpers `lexicalOf`,
   `load`, `$textNode`, `rootChildren` and `caretOf` from
   [markdown-editor-table-edge.test.ts:56](../packages/lib/tests/component/markdown-editor-table-edge.test.ts#L56).
   Add a helper `expectRoundTrips(editor)` asserting
   `editorSurfaceModel(editor)` equals `viewerModel(editor.getValue()).blocks`
   and that a fresh editor loaded with `editor.getValue()` gives the same
   value. Write rows T1–T17, M1–M12 and P1–P13 from *Expected Behaviour*.
   Check: `npx vitest run tests/component/markdown-editor-table-commands.test.ts`
   — the T, M and P rows named as changed fail; control rows pass.
2. Create
   `packages/lib/tests/component/markdown-editor-table-commands-mounted.test.ts`
   with `// @vitest-environment jsdom` on line 1. Copy the header comment
   pattern and `mounted`, `lexicalOf` and `selectLastRowCells` from
   [markdown-editor-context-menu-mounted.test.ts:47](../packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts#L47).
   Add the helper `mountedForFocus(source)` described under *Expected
   Behaviour — mounted rows*. Write rows F1–F8 and W1–W6. Check: the file
   fails. F7, F8 and W6 are controls: they pass as soon as
   `surfaceHoldsKeyboard` exists (step 24), the others only once Parts B and
   C are in.
3. In
   [markdown-editor-table-edge.test.ts:1330](../packages/lib/tests/component/markdown-editor-table-edge.test.ts#L1330),
   change the R43 expected values to those in *Expected Behaviour — changed
   R43 rows*. The comment above the second `it.each` (line 1371) now reads:
   the range is read as the text it covers, so what is left of the list or
   `:::` block holds the image. Check: the six changed tests fail.
4. In
   [markdown-editor.test.ts:5216](../packages/lib/tests/component/markdown-editor.test.ts#L5216),
   add one case to the A9 consistency list after `'a table selection'`:
   `name: 'a table selection holding a header cell'`, the same Markdown, a
   selection of the first row's two cells, and
   `available: ['canFormat', 'canInsertTable', 'canInsertImage']`. Add the
   selecting helper beside `selectLastRowCells`. Check: its A9 test fails,
   since `canMergeCells` is still `true` there.
5. In
   [corpus/dialect.ts:70](../packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts#L70),
   add after `'table merged rows'`:
   `{ name: 'table cell break', source: '| a |\n| --- |\n| x\\n\\ny |' }` and
   `{ name: 'table merged cell holding two paragraphs', source: '| a | b |\n| --- | --- |\n| 1\\n\\n2 | << |' }`.
   Check: `npx vitest run tests/component/markdown-roundtrip` passes — these
   two pin existing behaviour.

**Part D first** (the other parts call it)

6. Add `$holdsNoCaret`, `$liesBetweenBlocks`, `$pointNeedsSettling`,
   `$settlePoint` and `$settleSelectionOffContainers` directly below
   `$settleCaretIntoBlock`
   ([:1477](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1477)).
7. In `registerRangeGuards`
   ([:2745](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2745)),
   replace the `guard` helper with the wrapping form from *Internal
   Structure*. Leave the `DELETE_CHARACTER_COMMAND` /
   `COMMAND_PRIORITY_HIGH` registration as it is. Extend the function's
   `@remarks` with one sentence: each guard first settles a point where no
   caret can be.
8. In `$removeGuardedRange`
   ([:1690](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1690)),
   add `$settleSelectionOffContainers(selection);` as the first statement, and
   one sentence to its JSDoc.
9. In `$handleRawBlockEnter`
   ([:961](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L961)),
   add `$settleSelectionOffContainers(selection);` straight after
   `const selection = $getSelection();`, before `$rawBlockAtEitherEnd`.
10. In `insertImage()`
    ([:5406](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5406)),
    inside `if ($isRangeSelection(selection))`, before
    `$removeRangeBeforeImage(selection)`:

    ```ts
    const moved = $settleSelectionOffContainers(selection);
    const declinedOnceSettled = moved && !$imageInsertApplies($selectionTouchesTextOnlyBlock());

    if (declinedOnceSettled) {
        return;
    }
    ```
11. Delete `$replaceEmptiedContainerAtCaret`
    ([:1749](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1749))
    and its call in `$removeRangeBeforeImage`
    ([:1737](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1737)).
    Rewrite `$removeRangeBeforeImage`'s `@remarks`: the range's points are
    settled first, so the removal runs between two caret positions and empties
    no container. Check:
    `grep -n 'replaceEmptiedContainerAtCaret' packages/lib/src packages/lib/tests -r`
    — zero matches. Check: P1–P11 and the R43 tests pass.

**Part A**

12. Add `$makesNoEmptyHalf` and `$insertTableAt` above
    `$documentEndNode`
    ([:3000](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3000)).
    Import `$insertNodeToNearestRootAtCaret` from `"lexical"` and
    `$createTableNodeWithDimensions` from `"@lexical/table"`.
13. Replace `insertTable()`'s update
    ([:5358](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5358))
    with the one from *Internal Structure*, and rewrite the comment above it:
    the table is placed by `$insertTableAt`, which splits the caret's block
    only where both halves hold content. Remove the `INSERT_TABLE_COMMAND`
    import. Check: `grep -n 'INSERT_TABLE_COMMAND' packages/lib/src -r` — zero
    matches. Check: the T rows, P12 and P13 pass, and R37 and U8 in
    `markdown-editor-table-edge.test.ts` still pass.
14. Update `insertTable()`'s JSDoc: add that the block holding the caret is
    split only where the caret is inside its content, and that a table ending
    its container is followed by an empty paragraph.

**Part B**

15. Add `$holdsOneEmptyParagraph` and `$isHeaderCell` below
    `$getTableColumnCount`
    ([:444](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L444)).
16. Change `$readTableAvailability`
    ([:3224](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3224))
    as in *Internal Structure*. Update its JSDoc: merging needs more than one
    selected cell and none of them a header cell.
17. Replace the body of `mergeTableCells()`'s update after the
    `$isTableSelection` guard
    ([:5640](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5640))
    with the snippet. Update its JSDoc: header cells do not merge, an empty
    first cell adds no blank line, and the caret lands at the end of the
    merged cell.
18. In `$selectionTouchesTableCell`'s JSDoc
    ([:2409](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2409)),
    drop the clause "(one merged away, until the next selection change)":
    a merge no longer leaves that state. Keep the code. Check: M rows and
    step 4's case pass.

**Part C**

19. Add `$surfaceFocusKeepsSelection` below `$adoptDomSelection`
    ([:3372](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3372)).
    Import `SKIP_DOM_SELECTION_TAG` from `"lexical"`.
20. Replace `refocusSurface()`
    ([:4089](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4089))
    with the snippet. Rewrite its JSDoc: it hands the keyboard to the WYSIWYG
    surface — the surface's element first, where that keeps the selection,
    then Lexical's own `focus()` — and every command that applies calls it
    before its update.
21. Change `commandApplies()`
    ([:4067](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4067))
    as in the snippet, and add to its JSDoc that a command that applies takes
    the keyboard here.
22. Remove the five hand-backs that `commandApplies()` now covers: in
    `setBlockType`
    ([:5122](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5122)),
    `setTableColumnAlignment`
    ([:5577](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5577))
    and `setTableColumnWidth`
    ([:5695](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5695))
    write `if (alreadySet) { return this; }`; in `setBlockAlignment`
    ([:5191](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5191))
    and `setColumnCount`
    ([:5257](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5257))
    end with `return this;` and delete the comment line above it. Check:
    `grep -n 'refocusSurface()' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts`
    lists the definition and the call sites of steps 21 and 23 only.
23. Route the remaining hand-backs through `refocusSurface()`, before the
    update:
    - `focus()`
      ([:4407](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4407)):
      replace `this.ensureEditor().focus();` with `this.refocusSurface();`.
    - `copyWysiwygSelection()`
      ([:4965](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4965)):
      call `this.refocusSurface();` as the first statement after
      `const editor = …`; delete the trailing `this.ensureEditor().focus();`
      and its comment block (lines 4986–4996). Keep the
      `DOM.sink.writeClipboardText(text)` guard. `cut()` gets the hand-back
      through this method and needs no call of its own.
    - `paste()`
      ([:5058](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5058)):
      call `this.refocusSurface();` once, straight after the `await`; delete
      the two later `this.ensureEditor().focus();` calls and their comments.
    - `toggleLink()`
      ([:4804](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4804)):
      after `if (!applies) { return this; }` add
      `if (url === null) { this.refocusSurface(); }` — the other branch went
      through `commandApplies()`.
24. Add `surfaceHoldsKeyboard()` and `loadWysiwygDocument()` below
    `refocusSurface()`. In `setValue()`
    ([:4315](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4315))
    and `setMode()`
    ([:4172](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4172)),
    replace the `editor.update(…)` block with
    `this.loadWysiwygDocument(editor, value);` /
    `this.loadWysiwygDocument(editor, markdown);`. Add to both JSDocs: keyboard
    focus stays where it is. Check: F and W rows pass.

**Docs and checks**

25. Update the docs and the changelog as listed in *Documentation Impact*.
26. Run the checks in *Verification*, then the manual rows X1–X8.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Create | `packages/lib/tests/component/markdown-editor-table-commands.test.ts` |
| Create | `packages/lib/tests/component/markdown-editor-table-commands-mounted.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-table-edge.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-roundtrip/corpus/dialect.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/Markdown.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

`TABLE` stands for what `insertTable(2, 2)` saves:
`|  |  |\n| --- | --- |\n|  |  |`. In the cell values below, `\n\n` is the
four literal characters of the cell break; elsewhere `\n` is a line end.

Every T, M and P row also asserts, unless it says otherwise:

- **one undo step** — one `UNDO_COMMAND` gives back the loaded Markdown;
- **parity** — `expectRoundTrips(editor)` passes on the result.

### T — `insertTable(2, 2)` at a caret (unit-testable, offline)

| Row | Document | Caret | Saved | Root children |
|---|---|---|---|---|
| T1 | `> quote` | end | `> quote\n\nTABLE` | quote, table, empty paragraph |
| T2 | `> quote` | start | `TABLE\n\n> quote` | table, quote |
| T3 | `> quote` | after `qu` | `> qu\n\nTABLE\n\n> ote` | quote, table, quote |
| T4 | `# head` | end | `# head\n\nTABLE` | heading, table, empty paragraph |
| T5 | `# head` | start | `TABLE\n\n# head` | table, heading |
| T6 | `- one\n- two` | end of `two` | `- one\n- two\n\nTABLE` | list, table, empty paragraph |
| T7 | `- one\n- two` | end of `one` | `- one\n\nTABLE\n\n- two` | list, table, list |
| T8 | `- one\n- two` | start of `one` | `TABLE\n\n- one\n- two` | table, list |
| T9 | `- one\n- two` | start of `two` | `- one\n\nTABLE\n\n- two` | list, table, list |
| T10 | `- one\n  - two\n- three` | end of `two` | `- one\n  - two\n\nTABLE\n\n- three` | list, table, list |
| T11 | `para` | end | `para\n\nTABLE` | paragraph, table, empty paragraph |
| T12 | `para` | start | `TABLE\n\npara` | table, paragraph |
| T13 | `para\n\nafter` | end of `para` | `para\n\nTABLE\n\nafter` | paragraph, table, paragraph |
| T14 | `::: columns\n> q\n\|\|\|\nB\n:::` | end of `q` | `::: columns\n> q\n\nTABLE\n\|\|\|\nB\n:::` | one `:::` block |
| T15 | empty document | no selection | `TABLE` | table, empty paragraph |
| T16 | `# head` | no selection | `# head\n\nTABLE` | heading, table, empty paragraph |
| T17 | every row above | — | the caret is in the table's first cell | — |

T3, T11 and T13's saved values are as before the change; T12 and T13 lose an
empty paragraph that stood beside the table and saved nothing. In T14 the
source's `|||` is the column separator, written `\|\|\|` only for this table.

### M — `mergeTableCells()` (unit-testable, offline)

Cells are selected with `$createTableSelectionFrom(table, first, last)`; the
header row is row 0. Every source starts `| a | b |\n| --- | --- |\n`.

| Row | Body rows | Selected | Saved body rows | After |
|---|---|---|---|---|
| M1 | `\| 1 \| 2 \|` | row 1, both cells | `\| 1\n\n2 \| << \|` | caret at the end of `2` |
| M2 | `\|  \| 2 \|` | both | `\| 2 \| << \|` | caret at the end of `2` |
| M3 | `\| 1 \|  \|` | both | `\| 1 \| << \|` | caret at the end of `1` |
| M4 | `\|  \|  \|` | both | `\|  \| << \|` | caret in the merged cell |
| M5 | `\| 1 \| 2 \|`, `\| 3 \| 4 \|` | column 0 of rows 1–2 | `\| 1\n\n3 \| 2 \|`, `\| ^^ \| 4 \|` | caret at the end of `3` |
| M6 | as M1 | selected backward (second cell first) | as M1 | as M1 |
| M7 | `\|  \| 2 \|`, `\| 3 \| 4 \|` | all four body cells | `\| 2\n\n3\n\n4 \| << \|`, `\| ^^ \| ^^ \|` | caret at the end of `4` |
| M8 | `\| \n\nx \| 2 \|` | both | `\| \n\nx\n\n2 \| << \|` | caret at the end of `2` |
| M9 | `\| 1 \| **2** \|` | both | `\| 1\n\n **2** \| << \|` | caret at the end of `2` |

- **M10 — the state after a merge.** After M1, `getSelectionState()` reports
  `inTable: true`, `canEditTable: true`, `canUnmergeCell: true`,
  `canMergeCells: false`; the selection is a range, and both its points name
  attached nodes.
- **M11 — unmerge straight after.** After M1, `unmergeTableCell()` with no
  selection change saves `| 1\n\n2 |  |`. Two undo steps give back the source.
- **M12 — header cells decline.** With row 0's two cells selected, and with
  row 0's first cell and row 1's first cell selected: `canMergeCells` is
  `false`, and `mergeTableCells()` leaves the saved Markdown, every node key
  and the selection as they were and adds no undo step. (Step 4's A9 case
  covers the full "changes nothing" assertion.)

### P — points where no caret can be (unit-testable, offline)

Selections are set through the Lexical editor with `$createRangeSelection`.
"root@1" is an element point on the root at offset 1; "list@1" one on the list
node at offset 1. `IMG` is `![i](/i.png)`, inserted with
`insertImage('/i.png', { alt: 'i' })`. Delete is
`DELETE_CHARACTER_COMMAND` with `false`; Enter is `KEY_ENTER_COMMAND` with
`null`.

| Row | Document | Selection | Command | Saved |
|---|---|---|---|---|
| P1 | `Above\n\n- one\n- two` | caret list@1 | `insertImage` | `Above\n\n- one\n- IMGtwo` |
| P2 | same | caret list@2 | `insertImage` | `Above\n\n- one\n- twoIMG` |
| P3 | `Above\n\n::: columns\nA\n\|\|\|\nB\n:::` | caret on the `:::` block @1 | `insertImage` | `Above\n\n::: columns\nA\n\|\|\|\nIMGB\n:::` |
| P4 | `Above\n\n- one\n- two` | list@1 → end of `two` | `insertImage` | `Above\n\n- one\n- IMG` |
| P5 | same | list@1 → end of `two` | Delete | `Above\n\n- one\n-` |
| P6 | same | root@0 → end of `two` | Delete | `` (one empty paragraph) |
| P7 | `- one\n- two` | root@0 → end of `two` | Delete | `-` |
| P8 | `Above\n\n- one\n- two` | root@1 → list@2 | Delete | `Above\n\n-` |
| P9 | `Above\n\n::: columns\nA\n\|\|\|\nB\n:::` | root@1 → `:::` block @2 | Delete | `Above\n\n::: {}\n\n:::` |
| P10 | `Above\n\n- one\n- two` | root@0 → end of `two` | Enter | `` (two empty paragraphs) |
| P11 | same | caret list@1 | `INSERT_LINE_BREAK_COMMAND` | no throw |
| P12 | the matrix below | — | — | — |
| P13 | ```` ::: columns\n```\ncode\n```\n\|\|\|\nB\n::: ```` | caret on the `:::` block @0 | `insertImage`, and `insertTable` | unchanged: nothing is inserted |

Before the change P1–P4 and P11 throw, and P5–P10 leave an emptied list or
`:::` block or insert without removing the range. P13 pins D3: the point
settles into the code block, where neither insert goes. It does not assert an
undo step, since nothing changed.

**P12 — the matrix.** One test walks seven documents (`Above\n\n- one\n- two`,
the same with `\n\nafter`, `Above\n\n::: columns\nA\n|||\nB\n:::`,
`::: {align=center}\nA\n:::\n\nafter`, a table between two paragraphs,
`- one\n  - two\n- three`, and `> quote\n\n` + a code block + `\n\n# head`).
For each it collects every element point on the root, a column, a list, a
`:::` block and a list item holding a block, at every offset. It runs each
point as a caret, and a sample of pairs as ranges, through `insertImage`,
`insertTable`, `cut`, Enter, `INSERT_PARAGRAPH_COMMAND`,
`INSERT_LINE_BREAK_COMMAND`, a typed `x` (`CONTROLLED_TEXT_INSERTION_COMMAND`)
and — for ranges only — Delete and Backspace. Each run asserts: no throw; no
attached list, `:::` block, column, table, row or root is empty; and
`expectRoundTrips`. Destroy each editor after its run, or the test runs out of
memory.[^matrix]

**Control rows.** A caret on the root between two blocks (root@1 in
`Above\n\n- one\n- two`) is not moved: `insertImage` there saves
`Above\n\nIMG\n\n- one\n- two`. A point on a table cell is not moved: the D
and K rows of the two table-edge test files pass unchanged.

### Changed R43 rows — `markdown-editor-table-edge.test.ts`

Both directions of each range give the same result.

| Group | Source | New saved value | New `rootChildren` |
|---|---|---|---|
| first `it.each`, "a list alone" | `- one\n- two` | `- ![i](/i.png)` | — |
| first `it.each`, "a table then a list" | `${T}\n\n- one\n- two` | `- ![i](/i.png)` | — |
| second `it.each`, "a list" | `Above para\n\n- one\n- two` | `Above para\n\n- ![i](/i.png)` | `paragraph:Above para`, `list:` |
| second `it.each`, "a list with a block after it" | `…\n\nafter` | `Above para\n\n- ![i](/i.png)\n\nafter` | `paragraph:Above para`, `list:`, `paragraph:after` |
| second `it.each`, "a fence" | `Above para\n\n::: columns\nA\n\|\|\|\nB\n:::` | `Above para\n\n::: {}\n![i](/i.png)\n:::` | `paragraph:Above para`, `markdown-block:` |
| "between a list's items" | `Above para\n\n- one\n- two` | `Above para\n\n- ![i](/i.png)\n- two` | `paragraph:Above para`, `list:\n\ntwo` |

The other four sources of the first `it.each`, and the paragraph control, keep
`![i](/i.png)`. Rename the three tests to say what they now pin: the image
goes into what is left of the last block's container.

### Mounted rows — `markdown-editor-table-commands-mounted.test.ts` (unit-testable, jsdom)

`mountedForFocus(source)` does what `mounted(source)` does, and also:

- sets `root.tabIndex = 0`, since jsdom focuses no bare `contenteditable`;
- appends a `<button>` to the body, returned as `button`;
- stubs `getBoundingClientRect` on `Range.prototype` and `Text.prototype` to
  return a zero rectangle, which Lexical's scroll-into-view needs once the
  root has focus;
- stands the Lexical root in for the surface's element, which the harness
  bypasses (`surface` is the private `_wysiwyg`).
  `vi.spyOn(editor, 'surfaceHoldsKeyboard')` returns
  `root.contains(document.activeElement)`. `vi.spyOn(surface, 'focus')` does
  what Chromium does on focusing a `contenteditable`: when the browser's
  selection is not inside the root it first runs
  `window.getSelection().collapse(root, 0)`, then it calls `root.focus()`. It
  also pushes `'focus'` onto an `events` array;
- registers a Lexical update listener that pushes `'commit'` onto `events`;
- makes the browser's selection move the keyboard as Chromium does:
  `vi.spyOn(Selection.prototype, 'setBaseAndExtent')` calls the original, then
  `root.focus()` when the anchor node is inside the root and the active
  element is not;
- collects `console.warn` calls whose first argument contains
  `read-only context` into `warnings`.

Each row first focuses the root and sets its selection through the Lexical
editor, which writes it to the browser. Then it does its setup step, clears
`events` and `warnings`, and acts.

| Row | Setup | Action | Expected |
|---|---|---|---|
| F1 | last row's cells selected; `button.focus()` | `toggleBold()` | `document.activeElement` is the root; the selection is still a table selection; the cells are bold |
| F2 | as F1, after `toggleBold()` | `UNDO_COMMAND` | the bold is gone in one step; still a table selection |
| F3 | as F1 | `toggleUnderline()` | as F1, underlined |
| F4 | as F1 | `mergeTableCells()` | the root is active; the selection is a range in the merged cell |
| F5 | caret in `para one`; `button.focus()` | `setBlockAlignment('center')` | `events[0]` is `'focus'`: the surface is focused before any update commits |
| F6 | caret in a paragraph; `button.focus()` | `setValue('new doc')` | `document.activeElement` is still the button |
| F7 | caret in a paragraph; the root focused | `setValue('new doc')` | the root is still active; the caret is at the start of `new doc` |
| F8 | caret after `para` in `para one`; `window.getSelection().selectAllChildren(button)`; `button.focus()` | `insertImage('/i.png', { alt: 'i' })` | `events` holds no `'focus'`; the first paragraph saves as `para![i](/i.png) one` |
| W1 | document with a table; caret in a paragraph; `button.focus()` | `setBlockAlignment('center')` | `warnings` is empty |
| W2 | caret in a cell; `button.focus()` | `setTableColumnAlignment('center')` | `warnings` is empty |
| W3 | caret in a link; `button.focus()` | `toggleLink('https://y.test')` | `warnings` is empty |
| W4 | cells selected; `button.focus()` | `setValue('new doc')` | `warnings` is empty; the button is still active |
| W5 | caret in a paragraph; `button.focus()` | the public `focus()` | `warnings` is empty; the root is active |
| W6 | upstream canary: as W1, but the action is `lexical.update(() => $textNode('para one').select(4, 4), { discrete: true })` | — | `warnings` has one entry |

W6 pins what stays upstream. When it fails after a Lexical upgrade, Lexical no
longer warns there; the comment on the row says so, as K5's does in
`markdown-editor-table-edge-mounted.test.ts`.

### X — manual, in Chromium

Real clicks and key presses on the demo's **MD Editor** page
(`npm run dev`, then the Markdown editor section), DevTools console open.
Cells are selected by dragging across them.

- **X1.** Drag across two body cells. Click **Bold** in the toolbar. Press
  Ctrl+Z without clicking anywhere. The bold is undone and the cells are still
  selected. Before: the key did nothing.
- **X2.** As X1 with **Underline**, then Ctrl+Z twice more after a second
  click: each press undoes one click.
- **X3.** Drag across two body cells. Table ▸ Merge cells. The cells merge, no
  cell stays highlighted, the caret blinks at the end of the merged cell, and
  the Table button stays enabled with Unmerge cell not dimmed. Type a letter:
  it lands in the merged cell. Ctrl+Z twice gives back the two cells.
- **X4.** Drag across two header cells. Table ▸ Merge cells is dimmed.
- **X5.** Click into a paragraph of the sample (which holds a table).
  Alignment ▸ Center, then Table ▸ Align column ▸ Center with the caret in a
  cell, then right-click a link ▸ Edit link…, change the URL, confirm. The
  console holds no "read-only context" warning. Each time, a key typed next
  lands in the editor.
- **X6.** Click in the editor, then in the DevTools console (which moves the
  keyboard out of the page) run `setValue('new doc')` on the editor. No
  warning; the document is replaced.
- **X7.** Put the caret at the end of the sample's blockquote. Insert ▸ Table.
  The table follows the quote; an empty line follows the table; switching to
  source mode shows no `>` line after the table.
- **X8.** Put the caret in a table cell and drag out of the table into the
  text below it, so the whole table is highlighted. Press Delete. The table
  and the selected text go; the result is as before this plan.

---

## Verification

From the repository root:

- `npm run typecheck` and `npm -w packages/lib run typecheck:test`.
- `npm run lint` — in particular `local/no-raw-dom` stays clean: the new code
  reaches the DOM only through `this._wysiwyg.focus`, `DOM.source.contains`,
  `DOM.source.getActiveElement` and `DOM.source.readDocumentSelection`.
- The files this plan creates or changes:
  `npx vitest run tests/component/markdown-editor-table-commands.test.ts tests/component/markdown-editor-table-commands-mounted.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-table-edge-mounted.test.ts tests/component/markdown-editor-context-menu-mounted.test.ts tests/component/markdown-editor.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/markdown-roundtrip`
  (run from `packages/lib`).
- `npm run test` — the whole suite.
- `npm run docs:api`, `npm run docs:llms:check` and `npm run build:lib`.
- Mutation checks, each applied and taken out again:
  - `$makesNoEmptyHalf` returning `true` fails T1, T2 and T4–T10;
  - without the `endsContainer` paragraph, T1's root children fail;
  - without `merged.selectEnd()`, M10 and F4 fail;
  - without the `leadsWithBlank` removal, M2 and M7 fail;
  - without `!holdsHeaderCell`, M12 and step 4's case fail;
  - without `this._wysiwyg.focus(true)`, F1–F3, F5, W1–W3 and W5 fail;
  - with `$surfaceFocusKeepsSelection` returning `true` always, F8 fails: the
    image lands at the document's start;
  - without the `SKIP_DOM_SELECTION_TAG`, F6 and W4 fail;
  - each of the five `$settleSelectionOffContainers` call sites removed in
    turn: the `guard` helper's fails P5–P11; `$removeGuardedRange`'s fails
    P12's `cut` runs; `insertTable()`'s fails P12's `insertTable` runs and
    P13; `insertImage()`'s fails P13; `$handleRawBlockEnter`'s changes no row
    of this plan when removed, since the guard on `INSERT_PARAGRAPH_COMMAND`
    settles the same selection next — add a row with a range from root@0 into
    an HTML raw block and Enter, and keep the call only if that row needs it.
    Record the outcome in the Implementation Notes.
- The manual rows X1–X8 in Chromium. Firefox and WebKitGTK when a tool for
  them is at hand; record in the Implementation Notes which were run.

---

## Documentation Impact

No export changes. `docs:api` picks up the changed JSDoc.

- [MarkdownEditor.md:121](../packages/lib/docs/components/MarkdownEditor.md)
  — the `insertTable` row: add that the block holding the caret is split only
  where the caret is inside its content (no empty quote, heading or list item
  is left), and that a table ending its container is followed by an empty
  line.
- `MarkdownEditor.md:127` — the `mergeTableCells()` row: the merged cell holds
  the text of each merged cell on a line of its own, saved with the cell break
  (link to the viewer page's table section); header cells do not merge; the
  caret lands in the merged cell.
- `MarkdownEditor.md:192` — the `canMergeCells` row's "false when" column:
  add "a header cell is among them".
- `MarkdownEditor.md:96` — the **Tables** bullet: add one sentence on the cell
  break: two paragraphs of a cell are saved with `\n\n` (the four characters)
  between them.
- `MarkdownEditor.md:136` — the paragraph under the commands table: add that
  a command that applies takes keyboard focus to the editor before it acts,
  that `setValue` and `setMode` leave keyboard focus where it is, and that a
  host wanting the caret in the editor after a load calls `focus()`.
- [Markdown.md:65](../packages/lib/docs/components/Markdown.md) — add a row
  to the syntax table after the `<<` / `^^` row:
  ``| `\n\n` inside a table cell (backslash, `n`, twice) | `<br>` — a line break in the cell; a single `\n` stays literal text |``.
  Add one sentence to the paragraph at line 71 saying `MarkdownEditor` writes
  it between a cell's paragraphs, a merged cell's included.
- [next.md](../packages/lib/docs/reference/changelog/next.md), under
  `## Fixed` → `### Components`, four entries:
  - `MarkdownEditor.insertTable()` leaves no empty quote, heading or list item
    beside the table;
  - `mergeTableCells()`: no blank first line from an empty first cell, the
    caret lands in the merged cell so Unmerge is available at once, and header
    cells are declined (`canMergeCells` is `false`) where the merge used to
    move their text into one cell;
  - a toolbar or menu command with table cells selected gives the keyboard
    back to the editor, and the editor's commands no longer raise Lexical's
    "read-only context" console warning;
  - `insertImage()` no longer throws, and Delete, Enter, typing and
    `insertTable()` no longer leave an empty list or `:::` block, for a
    selection made in code with a point on a list, a `:::` block or between
    two blocks.
- `next.md`, under `## Changed` → `### Components`, one entry:
  `MarkdownEditor.setValue()` and `setMode("wysiwyg")` no longer move keyboard
  focus into the editor; call `focus()` to put the caret there.
- If `npm run docs:llms:check` reports a difference, run `npm run docs:llms`.

---

## Potential Challenges

- **Sibling plans edit the same methods.** `toggleLink`, `commandApplies` and
  the list toggles are also changed by other plans of the stack. Find each
  site by symbol; where a sibling has already restructured a method, apply the
  same statement at the same logical place (after the "applies" guard, before
  the first update).
- **`@lexical/table`'s observer after a merge.** The observer may still hold
  its highlight state when the selection becomes a range. X3 checks that no
  cell stays highlighted; if one does, call
  `editor.dispatchCommand(SELECTION_CHANGE_COMMAND, undefined)` after the
  update in `mergeTableCells()` and record it in the Implementation Notes.
- **jsdom is not Chromium.** jsdom moves no focus when a selection is set and
  focuses no bare `contenteditable`. The mounted rows stub both, so they pin
  our calls, not the browser's behaviour. X1–X6 are what prove the result.
- **A declined Shift+Enter over a range with a settled point** leaves the
  range's points renamed (the same place, as text points), since the guard
  settles before it asks whether the break is declined. No browser selection
  is affected.
- **`refocusSurface()` runs a Lexical update** (its `focus()`), a
  selection-only update with no undo step and neither event. Offline the
  editor has no root element and Lexical's `focus()` does nothing, so the
  offline rows that count update listeners hold as written.
- **Line numbers will have moved.** `markdown-editor-list-item-block-paste`
  does not touch `MarkdownEditor.ts`, but the sibling plans do.

---

## Critical Files

- [MarkdownEditor.ts](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts)
  — the precedents this plan follows:
  `registerRangeGuards` and `$removeGuardedRange` (the guard seam, D2),
  `$settleCaretIntoBlock` (how a point enters a block, D1),
  `refocusSurface`, `copyWysiwygSelection` and `paste` (the focus hand-back,
  C1), `handleWysiwygContextMenu` (reading the browser's selection through
  the seam, C2), `commandApplies` (the gate every command passes).
- [markdownWritable.ts](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts)
  — `$unmergeHeaderCells` (why header cells cannot stay merged) and
  `$orderedPoints`.
- [markdownSerializer.ts:2193](../packages/lib/src/typescript/lib/component/editor/markdownSerializer.ts#L2193)
  — `serializeTableCell`, which writes the cell break. Read only.
- [Markdown.ts:70](../packages/lib/src/typescript/lib/component/display/Markdown.ts#L70)
  — `CELL_PARAGRAPH_BREAK` and `appendTextWithBreaks`. Read only.
- [AbstractWindow.ts:952](../packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L952)
  — the precedent for "does this element hold the keyboard"
  (`DOM.source.contains(element, DOM.source.getActiveElement())`).
- `node_modules/lexical/src/caret/LexicalCaretUtils.ts:778` and `:826` —
  `$splitAtPointCaretNext` and `$insertNodeToNearestRootAtCaret`, whose
  `$shouldSplit` option Part A uses.
- `node_modules/@lexical/table/src/LexicalTableUtils.ts:827` — `$mergeCells`.
- [markdown-editor-table-edge.test.ts](../packages/lib/tests/component/markdown-editor-table-edge.test.ts)
  and
  [markdown-editor-context-menu-mounted.test.ts](../packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts)
  — the helpers the two new test files copy.
- [plans/implemented/markdown-editor-table-delete-merge.md](implemented/markdown-editor-table-delete-merge.md)
  and
  [plans/implemented/markdown-editor-context-menu-caret.md](implemented/markdown-editor-context-menu-caret.md)
  — their Implementation Notes record these defects.

---

## Non-Goals

- **Changing how a cell break is written.** `\n\n` is established dialect
  syntax, written by every multi-paragraph cell, not only a merged one.
- **`MarkdownDocumentPanel`.** Its Table button and dropdown already read
  `canMergeCells`; the header rule reaches them through the field.
- **Fixing the warning in Lexical.** See the addendum. No patch, no
  `console.warn` filter.
- **The keyboard for a command made while the browser's selection is in
  another element.** Lexical's own commit pulls it in, as today (C2).
- **Settling a selection when it is set.** The rule runs when a command acts;
  `getSelectionState()` for a point on a list is as today.
- **The other commands on such a point** — formats, block types, lists,
  alignment, table commands. They neither throw nor empty a container.
- **A list's numbering after a table splits it.** `1. one\n2. two\n3. three`
  split after `two` still saves the second list from `1.`, as before.
- **A caret between two blocks in the browser** (Lexical's block cursor beside
  a table). Not moved, not changed.
- **Firefox and WebKitGTK focus behaviour** beyond running X1–X6 there when a
  tool is at hand.

---

## Addendum: The Lexical warning

**The message.** `updateEditorSync: an editor update (e.g. a command listener
that mutates the editor) ran while a read-only context was on the stack.`
Development builds only. The update is not lost: Lexical runs it in a fresh
update.

**Where it comes from** (all in `node_modules/lexical/src`, 0.49.0, and
`@lexical/table` 0.49.0):

1. `$commitPendingUpdatesImpl` (`LexicalUpdates.ts:581`) marks the pending
   state read-only, then sets it as the active state with the editor as the
   active editor (`:725`) while it calls `$updateDOMSelection`.
2. `$updateDOMSelection` (`LexicalSelection.ts:3748`) writes the selection to
   the browser with `setDOMSelectionBaseAndExtent`, or calls
   `rootElement.focus()`. When the keyboard is in another element, Chromium
   moves focus into the editor *synchronously* and fires `focus` on the root.
3. Lexical's root `focus` listener (`LexicalEvents.ts:1983`) dispatches
   `FOCUS_COMMAND`.
4. `triggerCommandListeners` (`LexicalUpdates.ts:878`) runs a command's
   listeners inside `updateEditorSync` (`:1279`) whenever at least one
   listener is registered. `updateEditorSync` sees the same editor active with
   a read-only state and warns.
5. The only `FOCUS_COMMAND` listener in this editor is `@lexical/table`'s: one
   per mounted table, registered by `applyTableHandlers`
   (`LexicalTableSelectionHelpers.ts:1019`). It only reads
   `tableNode.isSelected()`.

**Measured.** In Chromium, a real click on a button followed by
`setBlockAlignment('center')` with the caret in a *paragraph* of a document
holding a table gives the stack
`$commitPendingUpdatesImpl → $updateDOMSelection → setDOMSelectionBaseAndExtent → (root focus listener) → dispatchCommand → triggerCommandListeners → updateEditorSync`.
The same happens for `setValue()` from a button, and for Lexical's own
`editor.focus()`. In jsdom with Chromium's focus move stubbed in:

| Document | Table observer | `FOCUS_COMMAND` listener | Keyboard elsewhere at commit | Warning |
|---|---|---|---|---|
| holds a table | registered | the table's | yes | yes |
| holds a table | registered | the table's | no | no |
| holds a table | not registered | none | yes | no |
| no table | registered | none | yes | no |
| no table | — | a test's own no-op listener | yes | yes |

So a table need not hold the selection, and neither the mutation listener nor
`SELECTION_CHANGE_COMMAND` is involved; the earlier reading recorded in
`markdown-editor-context-menu-caret.md` is superseded by this trace.

**What was ours.** Running a command's update, or loading a document, while
the keyboard was in another element, and leaving it to Lexical's commit to
pull the keyboard in. C1 and C3 remove that for every command and load of the
editor. Clearing the selection before `setValue` would also have avoided the
warning there, but it would have dropped the caret of an editor that holds
the keyboard; skipping the DOM selection write only when the keyboard is
elsewhere does not.

**What stays upstream.** Steps 1–4: a commit that can raise a focus event
while its own frozen state is the active one, and a dispatch that treats that
as a read-only context. Any `FOCUS_COMMAND` listener exposes it; Lexical's own
`focus()` raises it. It remains reachable where C2 skips the element focus,
and from any Lexical update made outside this editor's commands while the
keyboard is elsewhere. W6 is the canary.

---

## Notes

[^reproduced]: How each was reproduced, at `63a81117d` and at `master`
    (`40eb0dda6`, same Lexical 0.49.0), with the same result on both.
    **1:** load `> quote`, caret at the end, `insertTable(2, 2)`; the save ends
    `\n\n>` (on `master` `\n\n> `). **2:** load a 2×2 table, select the body
    row's two cells with `$createTableSelectionFrom`, `mergeTableCells()`; the
    save holds `1\n\n2 | <<`. **3 and 5:** in Chromium on a scratch page
    holding a `MarkdownDocumentPanel`, with real clicks and key presses, at
    the stack's tip; on `master` in jsdom with Chromium's focus move stubbed
    in, since the mechanism is Lexical's and the version is the same.
    **4:** load `Above\n\n- one\n- two`, set a caret on the list node at
    offset 1, `insertImage(…)`; it throws `Expected node ListNode … to have a
    block ElementNode ancestor`. The scratch tests and their outputs are kept
    under `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/table-commands/`.

[^split]: `@lexical/table`'s `INSERT_TABLE_COMMAND` handler calls
    `$insertNodeToNearestRoot`, which calls `$insertNodeToNearestRootAtCaret`
    with default options. The default `$shouldSplit` always splits, so a caret
    at a block's end leaves an empty copy of the block after the table, and
    one at its start leaves the emptied original before it. An empty
    paragraph saves nothing, which hid the fault; an empty quote, heading or
    list item saves `>`, `#` or `-`. With `$shouldSplit: () => false`,
    `$splitAtPointCaretNext` returns the position before or after the block
    without splitting when one side would be empty, and still splits when both
    sides hold content. The handler takes no options, so the editor calls the
    function itself; it is the function the handler ends in, with the same
    caret (`$caretFromPoint(selection.focus, "next")`). Removing the empty
    block after the command was rejected: by then nothing says which empty
    block the split made, and the empty item can sit inside a list half that
    also holds real items. A prototype of this decision was run over 27 caret
    positions; every result reads the same in the viewer and reloads to
    itself.

[^trailing]: Without it, a table inserted at the end of the document's last
    block would be the last block, with no line below to click into. The
    paragraph case has always had one (the empty half of the split), and
    A1 would otherwise take it away. The table can only land in the root or a
    `:::` column, since `$insertNodeToNearestRootAtCaret` splits up to the
    nearest root or shadow root, so no parent test is needed.

[^cell-break]: `CELL_PARAGRAPH_BREAK` is defined in `Markdown.ts` (the viewer
    splits a cell's text on it), `markdownSerializer.ts` (`serializeTableCell`
    joins a cell's paragraphs with it) and `markdownImporter.ts` (which splits
    on it). It predates the stack and is on `master`. `@lexical/table`'s
    `$mergeCells` appends the children of every non-empty merged cell to the
    top-left one, so the merged cell holds several paragraphs. Measured over
    800 merges of two cells (20 kinds of content, in a row and in a column):
    every result reads the same in the viewer, reloads to the same Markdown
    and the same editor surface, and one undo restores the source. A `<br>`
    was not an option: the viewer shows inline HTML as literal text and the
    editor keeps it as source. Joining the texts on one line would lose the
    line structure the editor shows.

[^blank-line]: `$mergeCells` skips a merged-in cell that holds only an empty
    paragraph, but keeps the top-left cell's own empty paragraph, so
    `empty + 2` gave a cell starting with a blank line while `1 + empty` gave
    none. The fix applies Lexical's own test to the one cell it leaves out.
    Only a cell that held *exactly* one empty paragraph before the merge
    loses it; a cell whose first paragraph was blank by the author's hand
    (M8) is not empty and keeps it.

[^header-merge]: Today a merge of header cells is made and then undone by the
    writable rule `$unmergeHeaderCells`, which splits a spanning header cell
    back into single cells with the content kept in the first. The net effect
    is that `| a | b |` becomes `| a\n\nb |  |`: text moved, nothing merged,
    one undo step. With a header and a body cell selected the body cell's
    text moves into the header. The project's rule is that a command that
    cannot do its job is not available and changes nothing, so the field
    says so. The header row is the table's first row, as
    `$unmergeHeaderCells` and `$getTableColumnCount` take it.

[^merge-caret]: After `$mergeCells` the table selection's focus (or anchor,
    for a backward selection) names a removed cell:
    `Point.getNode: node not found`. `$selectionTouchesTableCell`'s JSDoc
    already records the state. Measured in Chromium after a real click on
    Merge cells: the selection stays that table selection, every table field
    is `false`, and the Table button is disabled until the next click in the
    editor. `$mergeCells` returns the merged cell, so `merged.selectEnd()`
    needs no lookup. A prototype was run in Chromium: after the click the
    caret is at the end of the merged cell, no cell stays highlighted, and
    `canUnmergeCell` is `true`. A range selection is also what lets Lexical
    write the browser's selection again.

[^table-focus]: Lexical hands the keyboard back as a side effect of writing
    its selection to the browser, in `$updateDOMSelection`. That function
    returns early for a selection that is not a range, after removing the
    browser's ranges, so with cells selected nothing focuses the root —
    neither a command's commit nor Lexical's own `focus()`. Measured in
    Chromium: after a real click on Bold with two cells selected,
    `document.activeElement` is the button and Ctrl+Z does nothing; after the
    surface's element is focused, the cells are still selected and Ctrl+Z
    undoes the bold. On `master` the keyboard stays on the button the same
    way (measured in jsdom).

[^warning-ours]: See the addendum for the full trace. The warning is raised
    when Lexical's commit moves the keyboard into the editor. Focusing the
    surface first makes that move happen outside any commit, where the focus
    event is dispatched normally. Measured in Chromium with a real click on a
    button: `setBlockAlignment` alone warns once; the same call after
    focusing the root warns not at all, the caret stays where it was, and the
    command applies.

[^precedent-focus]: `copyWysiwygSelection` and `paste` call
    `this.ensureEditor().focus()` after a menu row took the keyboard, and
    `refocusSurface` was added for the five commands that find nothing to
    change. All of them run *after* the update, relying on Lexical's
    `focus()`, which itself raises the warning when a table is mounted
    (measured). Moving the one call ahead of the update and through the
    surface keeps the pattern and removes the cause. The five explicit
    hand-backs become redundant because `commandApplies` already made them;
    the seven mounted rows that pin them keep passing through that call.

[^focus-guard]: Chromium keeps the browser's selection when a
    `contenteditable` that already holds it is focused, and otherwise puts a
    caret at the element's start. Lexical reads the browser's selection at the
    start of an update that runs under no event (after a dialog's promise, a
    timer, a host call) and adopts it when it lies inside the editor
    (`$internalCreateRangeSelection`). So focusing the element while the
    browser's selection is elsewhere would move the editor's caret to the
    document's start, and the command would act there. Today such a call
    keeps Lexical's own selection, because Lexical ignores a browser selection
    outside the editor. A table selection is never replaced that way
    (`$internalCreateSelection` clones it), and the stray caret is removed by
    the commit that follows, so that case is safe; it was measured in
    Chromium. The inside-the-editor test reuses the expression
    `handleWysiwygContextMenu` reads the browser's selection with.

[^load-focus]: `$importMarkdown` moves an existing selection to the document's
    start, and the commit writes it to the browser, which in Chromium moves
    the keyboard into the editor. A host that loads a document from a file
    tree or a button therefore had the keyboard taken away, and with a table
    in the old document the move raised the warning (measured: a real click
    on a button calling `setValue`). `SKIP_DOM_SELECTION_TAG` is Lexical's tag
    for "make this update without changing the selection or focus". It was
    measured in Chromium: the document is replaced, the button keeps the
    keyboard, no warning. The browser's selection is brought in line the next
    time the user clicks or `focus()` is called. Setting the selection to
    `null` instead would also avoid the write, but would leave a focused
    editor without a caret after a load.

[^one-rule]: The reviews found four shapes where `insertImage()` throws, and
    noted that Delete leaves an emptied list or `:::` block, and that Enter
    and `insertTable()` insert without removing the range. All come from one
    cause: Lexical's `insertNodes` needs a block that holds inline content
    around the caret, and its removal of a range that starts between blocks
    removes every block but the root's last child, which it leaves empty. A
    matrix of 10 850 runs (every such point in seven documents, as a caret
    through 34 commands and in ranges through 15) shows failures in exactly these
    routes: `insertImage`, `insertTable`, `cut`, Delete, Backspace, Enter,
    `INSERT_PARAGRAPH_COMMAND`, `INSERT_LINE_BREAK_COMMAND` and typing. With
    the points moved first, the same matrix has no throw, no empty container
    and no parity failure. `$moveBlockPointsIntoText` could not be reused: it
    moves a point only where text lies directly beside it, and leaves one
    between two blocks where it is. `$settleCaretIntoBlock` is the precedent
    for entering a block from one side, and `$settlePoint` enters the same
    way.

[^left-alone]: A collapsed caret on the root between two blocks is what
    Lexical draws its block cursor for, so a caret can stand beside a table,
    and `@lexical/table` leaves one when it removes a wholly selected table
    (`tableNode.selectPrevious()`). Lexical's inserts handle it: the matrix
    shows no failure for a caret on the root or a column. `@lexical/table`
    also sets points on cells when it grows a range dragged into a table
    (`cell@0`, `cell@size`), and the table-edge guard is built on them; the
    matrix shows no failure for a point on a table, row or cell either.
    Shift+Arrow beside a table gives a range whose focus is between blocks.
    That range is settled only when a command acts on it; one of its ends
    then lies in the table, so the table-edge guard removes the whole table,
    as the selection showed. Settling a selection as soon as it is committed was
    prototyped and rejected for this reason: it would rewrite selections that
    Lexical and `@lexical/table` make on purpose, and each rewrite of the
    browser's selection triggers their handlers again.

[^guard-seam]: `registerRangeGuards` exists so that every command removing or
    replacing a range first passes a check for the range shapes Lexical
    mishandles (table-edge, stale-focus), and `cut()`, `paste()`,
    `insertImage()` and `insertTable()` call the same check. A point where no
    caret can be is a third such shape. The earlier review of that plan
    removed listeners whose order depended on registration order, so the call
    is made inside each guard listener (through the `guard` helper) and not as
    a separate listener registered first.

[^other-commands]: In the unsettled matrix the format, style, link,
    block-type, list, alignment, column, insert-line and table commands show
    no throw, no empty container and no parity failure on these points. They
    are left as they are, so their `can…` fields and results do not change.

[^judge-again]: The fields are read on the selection as it stands, in a
    read-only context, where the selection cannot be replaced by a settled
    copy without passing a selection through a dozen helpers. For these two
    inserts the settled place can differ in what matters: a caret on a `:::`
    block whose first column starts with a code block settles into the code
    block, where neither goes. The second reading runs only when a point
    moved, so no browser-made selection takes it. A declined insert then
    leaves the selection settled, a selection-only update with no undo step;
    the precedent is the format commands, which the docs already describe as
    declined after trying.

[^dead-patch]: With the points settled, the removal `insertImage()` makes
    runs between two caret positions and leaves the start's block in place.
    The matrix was run with the call disabled in a scratch copy of the
    source: 641 `insertImage` runs, no throw, no empty container, no parity
    failure.

[^r43]: The patch answered "the whole list was selected, so it goes". The
    rule answers "the selection is read as the text it covers", which is what
    selecting the same text with the mouse and inserting an image has always
    done, and what Delete, Enter and typing now do too. Keeping the patch's
    results would need a second mechanism on every removal route, one per
    container that can be emptied (list, `:::` block, column, root). That is
    the patch-per-shape design this part was asked to replace. All affected
    selections can only be made in code.

[^matrix]: This is the scratch matrix that found the failures, kept as a
    test. Collapsed Delete and Backspace are left out offline: Lexical steps a
    caret with the browser's `Selection.modify`, which the modelled DOM does
    not have. Without `destroy()` on each editor the test worker runs out of
    memory.

---

## Implementation Notes

Written by the implementer; the plan above is unchanged. The branch starts on
`feature/markdown-editor-typing-at-link-start-swallowed`, whose list item
rules, read-only branches and typing shortcuts landed after the plan was
written. Line numbers were not used; every site was found by symbol.

### Deviations from the plan

1. **Part D leaves lists and list items alone (D1, D2, D4, P1, P2, P5, P8,
   three R43 rows).** The list item rules below this branch give a point on a
   list, or on an item, a meaning of their own: a caret between items opens an
   item (`$openBlockAtItemCaret`, Z31, Z36, Z37), a caret between an item's
   blocks opens a paragraph (Z21, Z23, T6, E4), and Backspace over a range from
   just before a list that reaches its end takes the whole list (X11).
   Settling those points as D1 says broke 23 tests in
   `markdown-editor-list-item-edits.test.ts` and
   `markdown-editor-list-item-paste.test.ts`. So `$holdsNoCaret` is the `:::`
   block alone, and `$liesBetweenBlocks` (the root or a column, for a range)
   does not move a range's start when the block after it is a list. A range's
   end after a list is moved, as the plan says. Expected values changed for
   that reason: P1 `Above\n\n- one\n- IMG\n- two`, P2
   `Above\n\n- one\n- two\n- IMG`, P5 `Above\n\n- one`, P8 `Above`. Of the six
   changed R43 rows only "a list alone", "a table then a list" and the fence
   row take the plan's new values; the list and between-items rows keep the old
   ones.

   The exemption was first thought to be covered by the list item rules for
   every command; only Backspace, paste and typing are. A paragraph break (Enter,
   `INSERT_PARAGRAPH_COMMAND`) over a range from just before a list depended on
   the selection's direction: with the anchor at the start Lexical inserted the
   paragraph and removed nothing, backward it removed the list but left the
   caret at the document's end. P10c-P10h and a matrix pairing container points
   with text ends in both directions pin it, asserting where the break and the
   caret land. The design is remove-first, the precedent of
   `$removeGuardedRangeForInsert` for a range ending on a list: the
   paragraph-break guard removes a range that starts before a list
   (`$isRangeStartingBeforeList`) with `removeText()`, then lets Lexical insert
   at the caret. Weighed and dropped: turning a forward range around
   (the break landed at the document's end), and settling the start into the
   list's first item (the removal then keeps an empty item, unlike Delete).
   P10h pins the case of a list that is the root's only child: the removal
   empties the list, `$openBlockAtItemCaret` refills it with one blank item and
   the guard returns `false`, so Lexical's insert runs there and Enter turns
   the blank item into a paragraph (`x`), as Delete then Enter does. An earlier
   version returned the refill's result and lost the break (`- x`).
   P10i pins the table-edge exclusion (Enter into a table's cell removes the
   table too). The matrix compares the save, the caret and the root's block
   types with Delete-then-Enter for every range that starts on the root or a
   column, a list-only column included.
   Separately, Shift+Enter over `root@1` to the end of `two` (a text end) changes
   nothing while Enter removes the range; that predates the branch. Tab
   (`INSERT_TAB_COMMAND`) over `root@0` to the end of `two` in `- one\n- two`
   throws "Expected node ListNode … to have a block ElementNode ancestor"; it
   also predates the branch and is a follow-up. The matrix's emptied-column
   finding (a range ending at the end of a list in a column) is fixed by
   `$endsListOfColumn`, which moves such an end into the list's text.
2. **`$handleRawBlockEnter` does not call the rule.** The plan allows this when
   no row needs the call. Removing it changes no row of this plan or of the
   suites below it, even with a row added for a range from the root's start
   into an HTML raw block and Enter (P10b, kept as a control). The other four
   call sites are in.
3. **The settle call sites in `insertTable()` and `insertImage()` did not fail
   P13 as written.** The `canInsert…` field already declines for a caret on a
   `:::` block at offset 0. P13 gained a second source, a caret between a
   `:::` block's columns where the second column opens with a code block, which
   reads as touching no code block until it settles. Removing either call now
   fails P13, and the insert writes into the code block.
4. **Other mutation outcomes.** The `guard` helper removed fails P6, P9 and the
   matrix; `$removeGuardedRange` removed fails the matrix `cut` runs;
   `$makesNoEmptyHalf` returning `true` fails T1, T2, T4-T10, T12-T16; no
   trailing paragraph fails T1, T4, T6, T11, T16; no `selectEnd()` fails
   M1-M11; no blank-line drop fails M2, M7; no header rule fails M12 and the
   A9 case; no `_wysiwyg.focus(true)` fails F1, F3, F5, W1-W3, W5 (F2 and F4
   pass either way: jsdom's undo and merge need no focus); an always-true
   `$surfaceFocusKeepsSelection` fails F8; no `SKIP_DOM_SELECTION_TAG` fails F6
   and W4.
5. **`copy()` focuses the surface only when something is copied.** The plan's
   first-statement call broke F7 in `markdown-editor.test.ts` (a copy at a caret
   with no word touches nothing, focus included). The text read became
   `$copiedSelectionText`, read before the focus and again after the word
   expansion. `paste()` and the rest are as the plan says.
6. **`refocusSurface(preventScroll)` keeps the read-only branch** the read-only
   branches added (the surface is focused alone); the editable path is the
   plan's. `toggleLink(null)` takes the keyboard in `unlinkSelection()`, where
   the newer code moved that path. `focus()` already called `refocusSurface()`.
7. **A matrix finding fixed outside the plan's list:** Shift+Enter over a range
   that ends on a list or list item (not only one that starts there) threw
   "Expected node ListNode … to have a block ElementNode ancestor".
   `$clearGuardedRangeBeforeLineBreak` now declines it too
   (`$isListContainerRange`), as it declines a range that starts there.
8. **Test constants.** The matrix timeout and the range partner stride are
    named (`MATRIX_TIMEOUT_MS`, `RANGE_PARTNER_STRIDE`); P4 and P10 assert the
    one undo step; P11b pins that Shift+Enter over a range ending on a list is
    declined with the document unchanged.
9. **The edit fuzz test needed one change.** The corpus rows for the cell break
   failed `markdown-edit-fuzz.test.ts` (its `wordsOf` read the backslash `n`
   as the letter `n` glued to the next word); `wordsOf` now treats that pair
   as a break between words.
10. **Test details.** The matrix skips a run that throws "window object not
   found" (a range that settles into a caret, stepped by `Selection.modify`,
   which the modelled DOM lacks), samples every fourth partner for ranges, and
   reports all failures of a document at once. `clickAway` restores the
   browser's selection after the button takes focus, since jsdom drops it and
   a click in Chromium does not. M9's saved value is `| 1\n\n **2** | << |`,
   with the space the plan shows. The docs link to the viewer page uses
   `#supported-syntax-v1` (`#markdown-syntax` does not exist). The changelog's `insertImage`
   entry names `:::` blocks and ranges between blocks, not lists.

### Overlap with `markdown-editor-raw-block-range-edits`

That branch is held above this one. Its container-point rule overlaps D1; the
plan was implemented for points on containers as written except for the list
cases in item 1, so a rebase will meet `$settleSelectionOffContainers`,
`$pointNeedsSettling` and `$liesBetweenBlocks`.

### Checks run

`typecheck`, `typecheck:test`, `eslint src`, the full suite with
`--maxWorkers=2` (566 files, 19 131 tests), `docs:api`, the llms coverage check
and `build:lib`, all clean. The mutation checks listed above.

### Not run

- Manual rows X1-X8 (they need a Chromium session on the demo; no browser or
  dev server was started).
- Firefox and WebKitGTK.
- The "Potential Challenges" X3 check for a highlight that stays after a merge,
  so `SELECTION_CHANGE_COMMAND` after the merge was not needed or added.
