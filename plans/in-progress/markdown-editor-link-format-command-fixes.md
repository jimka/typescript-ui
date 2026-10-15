---
depends-on: [markdown-editor-list-item-block-paste]
touches-shared:
  - packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts
  - packages/lib/src/typescript/lib/component/editor/markdownWritable.ts
  - packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts
  - packages/lib/tests/component/markdown-editor.test.ts
  - packages/lib/tests/component/markdown-document-panel.test.ts
  - packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts
  - packages/lib/docs/components/MarkdownEditor.md
  - packages/lib/docs/components/MarkdownDocumentPanel.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/reference/migration/next.md
---

# MarkdownEditor Link, Format and Paste Command Fixes — Implementation Plan

## Overview

`MarkdownEditor` reports, for each group of its commands, whether the commands would do anything at the current selection. This plan calls that report the **availability record**. `$readCommandAvailability` ([MarkdownEditor.ts:3255](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3255)) builds it, the selection state exposes eleven of its fields (`canFormat`, `canLink`, …), and the context menu and the `MarkdownDocumentPanel` toolbar dim their controls from it. The stack's rule is: where a field is `true` its command changes the document or the selection; where a field is `false` the command changes nothing and fires no event; and every command reads its own field first, through `commandApplies` ([MarkdownEditor.ts:4067](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4067)).

Six defects break that rule, or leave a control disagreeing with its command. All six were reproduced on commit `63a81117d` (the tip of `feature/markdown-raw-block-html-tail-parity`), which this plan's line numbers refer to; find each site by its symbol name first. A **kept-source run** below is text the editor keeps as its Markdown source (a `MarkdownSourceTextNode`: inline HTML such as `<span>`, a task-list marker, a link nested in a link), where a format cannot be saved. A command is **declined after trying** when its field is `true` but its result could not be saved as Markdown: the editor makes the edit, checks it, and takes it back.

| # | Defect | Reproduction | Result today |
|---|---|---|---|
| 1 | The format shortcuts skip the rule | `kept <span>x</span> source`, caret at offset 3 of `<span>`, Ctrl+B, then `Q` | `canFormat` is `false`, yet bold is left pending: `kept **Q**x</span> source` (without Ctrl+B: `kept Qx</span> source`) |
| 2 | A command declined after trying moves the selection | `**a+b** x`, caret in `a+b`, `toggleUnderline()` | nothing is underlined, but `a+b` is left selected |
| 3 | Underline and inline code do not come off a selection made from code | `++c++ x`, `c` selected through the API, `toggleUnderline()` | still `++c++ x`; the `underline` flag reads `false` |
| 4 | `toggleLink(url)` at a caret with no word under it links the whole text run | `a  b word`, caret between the two spaces, `toggleLink("https://z")` | `[a  b word](https://z)` |
| 5 | The Link controls are narrower than `canLink` | `a ![i](/i.png) b`, the image selected | `canLink` is `true` and `toggleLink` wraps the image, but the toolbar's Link button is disabled and the menu's Insert link… is dimmed |
| 6 | Paste is enabled where `paste()` does nothing | table cells selected, or no selection; menu ▸ Paste | the clipboard is read and nothing is inserted |

The fix is in the library only: `MarkdownEditor.ts`, `markdownWritable.ts`, one line of `MarkdownDocumentPanel.ts`, tests and docs. No public symbol is added. Two commands change what they do at two kinds of selection: `toggleLink(url)` at a caret with no word under it, and `paste()` without a text selection.

---

## Architecture Decisions

### The format command's handler reads `canFormat`

Lexical turns the format shortcuts into one command, `FORMAT_TEXT_COMMAND`. The editor's handler for it ([`registerWritableFormatCommand`, MarkdownEditor.ts:2718](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2718)) now starts by reading `canFormat` from the availability record. Where the field is `false`, or the editor is not editable, the handler swallows the command and changes nothing. `$declinesFormat` ([MarkdownEditor.ts:2586](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2586)), the handler's own partial copy of the rule, is deleted.[^handler-gate]

Reading the field first mirrors `commandApplies`, which gives every method the same first step.

| Input | Reaches the handler as |
|---|---|
| Ctrl/Cmd+B, Ctrl/Cmd+I, Ctrl/Cmd+U | `FORMAT_TEXT_COMMAND` with `"bold"` / `"italic"` / `"underline"` |
| A browser or OS format command (`beforeinput` with `formatBold`, `formatItalic`, `formatUnderline`, `formatStrikeThrough`) | the same command, `"strikethrough"` included |
| `toggleBold()` and the other four methods | not at all (next decision) |

Every other route from a key or a control to a command was checked as well; *Addendum: Routes checked* lists them.

### The toggles format in one update and do not dispatch the command

The five format methods share one new private body, `toggleFormat(format)`. It reads `canFormat` through `commandApplies`, then runs one discrete update that widens a collapsed caret to its word and formats. The keyboard handler and `toggleFormat` both end in `$formatWritably` ([markdownWritable.ts:2056](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2056)); only `toggleFormat` passes the widening step.[^one-update] The shared private body follows `toggleList` ([MarkdownEditor.ts:4113](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4113)) and `patchSelectionStyle` ([MarkdownEditor.ts:4607](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4607)).

The two routes keep what each does at a caret today:

| Route | Reads the field through | Widens a caret | Caret inside `world` of `hello world`, bold |
|---|---|---|---|
| `toggleBold()` | `commandApplies("canFormat")` | yes | `hello **world**`, the word selected |
| Ctrl/Cmd+B | the command handler | no | document unchanged; bold is pending for the text typed next |

### A caret is widened inside the checked edit, and a declined edit puts back all the selection carried

`$editWritably` ([markdownWritable.ts:1968](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1968)) already runs an edit, checks that every block the edit touched still saves as shown, and otherwise restores those blocks and the selection it recorded before the edit. The format, style and link commands now widen the caret inside that edit, so the recorded selection is the caret itself. The restore also brings back the selection's pending format and style, which a restore lost until now.[^restore-not-clone]

### All five formats are read from the selected text

`$selectionHasFormat` ([markdownWritable.ts:2216](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2216)) answers for every range from `$countedCarries` ([markdownWritable.ts:2240](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2240)), the per-character count that bold, italic and strikethrough, and the table-cell path (`cellsHaveFormat`, [markdownWritable.ts:2159](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2159)), already use. Underline and inline code stop reading the format Lexical caches on the selection, which only a browser selection change fills.[^text-reading]

| Selection | A format reads as on when |
|---|---|
| Collapsed caret | the selection's own pending format has it (unchanged) |
| Range holding counted characters | every counted character carries it: every selected character for underline and code; all but edge whitespace for bold, italic and strikethrough (unchanged for those three) |
| Range holding no counted character | Lexical's cached format has it (unchanged) |

The toggles, the selection state's five flags and the menu's checkmarks all read `$selectionHasFormat`, so the three agree for any selection, however the selection was made.

### A caret links the word under it, or re-points the link it is in

For a collapsed caret, `canLink` is `true` only when the caret would widen to a word or formatted run, or sits inside a link. `$selectionHoldsLinkable` ([MarkdownEditor.ts:3156](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3156)) takes both facts from its caller. A range is judged as before.[^caret-link]

| Selection | `canLink` | `toggleLink("https://z")` |
|---|---|---|
| `hello wo\|rld` (caret in a word) | `true` | `hello [world](https://z)` |
| `a \| b word` (caret between two spaces) | `false` (was `true`) | nothing (was `[a  b word](https://z)`) |
| `Left column.\|` (caret after a full stop) | `false` (was `true`) | nothing (was `[Left column.](https://z)`) |
| `A [te \| xt](https://x) link.` (caret in a link, no word under it) | `true` | `A [te  xt](https://z) link.` |
| `\|![i](/i.png)` (caret beside an image) | `false` (was `true`) | nothing (was `[![i](/i.png)](https://z)`) |
| `a ![i](/i.png) b`, the image selected | `true` | `a [![i](/i.png)](https://z) b` |

### The Link controls read `canLink` alone

The toolbar's Link button is enabled on `canLink || canRemoveLink`. The menu's Insert link… is enabled on `canLink`. `hasSelectedText` leaves both rules, so command, field, toolbar and menu follow one test.[^one-link-rule]

### `paste()` always has somewhere to paste; there is no `canPaste` field

`paste()` inserts through whichever selection the editor holds, and makes a caret at the document's end when it holds none. The menu's Paste stays always enabled and now always pastes. `buildClipboardMenuItems` is not changed.[^paste-acts]

| Selection | Where the text goes | Follows |
|---|---|---|
| Caret or text selection | at the caret, replacing the selection (unchanged) | — |
| Table cells selected | into the cells, starting at the cell the selection began in | Ctrl/Cmd+V at the same selection |
| No selection | at the document's end | `insertTable` and `insertImage` ([MarkdownEditor.ts:5432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5432)) |

### No rule is repeated inside a command

Three checks inside commands repeat what the field already decided. They are removed, so the field is the only place the rule is read.[^no-second-copy]

| Command | Check removed |
|---|---|
| The format handler | `$declinesFormat` |
| `patchSelectionStyle` (the three style setters) | the "anchor inside a link" test and the `$selectionCoversSourceRun()` test inside the update |
| `toggleLink(url)` with a URL | the `$selectionCoversSourceRun() \|\| $selectionInNestedLinkRun()` test inside the update |

`toggleLink(null)` is covered by no field. Its body moves unchanged into a private `unlinkSelection()`, with the checks it has today.

### The consistency test runs every route to a format

The consistency test in `markdown-editor.test.ts` ([:5449](../packages/lib/tests/component/markdown-editor.test.ts#L5449)) runs each `canFormat` case through ten routes: the five methods and the five `FORMAT_TEXT_COMMAND` dispatches. It also gains cases for carets with and without a word, checks the menu's link item against `canLink` in every case, and checks that `paste()` pastes in every case. A real `keydown` is dispatched in the mounted (jsdom) suite to pin the key bindings.[^test-routes]

---

## Public API

No exported symbol is added or renamed. Three public contracts change:

```typescript
export interface MarkdownEditorSelectionState {
    // …
    /**
     * Whether `toggleLink` with a URL would apply at the selection: link its
     * text or its image, or re-point the link it is in. A caret links the
     * word or formatted run it would expand to, as the format toggles format
     * it, and inside a link re-points that link. `false` with no selection,
     * while table cells are selected, when the selection touches a raw
     * Markdown block or a code block or holds (or a collapsed caret would
     * expand into) a run kept as Markdown source, when either end is in a
     * link nested in another link, and when there is nothing to link: a
     * caret with no word under it and outside a link, or a selection holding
     * neither text nor an image. A toolbar's Link control is enabled on this
     * field, or on {@link canRemoveLink} for its Remove action. Always
     * `true` in `"source"` mode.
     */
    canLink: boolean;
}

class MarkdownEditor {
    /** With a URL: no-op at a caret with no word under it and outside a link (it linked the whole text run). */
    toggleLink(url: string | null): this;

    /** Pastes into the selected table cells, and at the document's end with no selection (both were no-ops). */
    paste(): Promise<boolean>;
}
```

Module-internal signatures (not in the barrel):

```typescript
// markdownWritable.ts
export function $formatWritably(format: TextFormatType, takesFormat: (cell: TableCellNode) => boolean, widen?: () => void): void;
export function $selectionHasFormat(selection: RangeSelection, format: TextFormatType): boolean;   // signature unchanged
function $restoreSelection(anchor: PointPath, focus: PointPath, format: number, style: string): void;

// MarkdownEditor.ts
function $handleFormatCommand(format: TextFormatType, editor: LexicalEditor): boolean;
function $selectionHoldsLinkable(selection: RangeSelection, expansion: WordExpansion | null, inLink: boolean): boolean;
// class MarkdownEditor
private toggleFormat(format: TextFormatType): this;
private unlinkSelection(): void;
```

`$formatWritably` loses its `declines` parameter and its boolean result.

---

## Internal Structure

### `markdownWritable.ts`

```typescript
export function $selectionHasFormat(selection: RangeSelection, format: TextFormatType): boolean {
    const collapsed = selection.isCollapsed();

    if (collapsed) {
        return selection.hasFormat(format);
    }

    const counted = $countedCarries(selection, format);

    return counted === "" ? selection.hasFormat(format) : !counted.includes("0");
}
```

```typescript
export function $formatWritably(format: TextFormatType, takesFormat: (cell: TableCellNode) => boolean, widen?: () => void): void {
    const selection = $getSelection();

    if ($isTableSelection(selection)) {
        $formatCellsWritably(selection, format, takesFormat);

        return;
    }

    if (!$isRangeSelection(selection)) {
        return;
    }

    $editWritably(() => {
        widen?.();

        const widened = $getSelection();

        if (!$isRangeSelection(widened)) {
            return;
        }

        // The format to align every selected node to: off where it is on, on where it is not. Read once widened.
        const on = $selectionHasFormat(widened, format);

        $formatText(widened, format, on ? 0 : TEXT_TYPE_TO_FORMAT[format]);
    });
}
```

In `$editOrRestore` ([markdownWritable.ts:1988](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L1988)), read the selection's pending format and style next to `points`, before `edit()` runs, and hand both to the restore:

```typescript
const points = [$pointPath(selection.anchor), $pointPath(selection.focus)] as const;
// Read before the edit, which may change both: what the selection carries for the text typed next.
const format = selection.format;
const style = selection.style;
// … edit, check …
$restoreSelection(points[0], points[1], format, style);
```

`$restoreSelection` calls `selection.setFormat(format)` and `selection.setStyle(style)` on the selection it builds, before `$setSelection(selection)`.

### `MarkdownEditor.ts`

```typescript
function $handleFormatCommand(format: TextFormatType, editor: LexicalEditor): boolean {
    const applies = editor.isEditable() && $readCommandAvailability($computeWordExpansion()).canFormat;

    if (applies) {
        $formatWritably(format, $cellTakesFormat);
    }

    // Handled either way: where the field is false, no handler below this one may format the selection.
    return true;
}

function registerWritableFormatCommand(editor: LexicalEditor): () => void {
    return editor.registerCommand(FORMAT_TEXT_COMMAND, $handleFormatCommand, COMMAND_PRIORITY_HIGH);
}
```

```typescript
function $selectionHoldsLinkable(selection: RangeSelection, expansion: WordExpansion | null, inLink: boolean): boolean {
    const isCollapsed = selection.isCollapsed();

    if (isCollapsed) {
        // A caret links the word or run it widens to; inside a link it re-points that link.
        return expansion !== null || inLink;
    }

    const holdsImage = selection.getNodes().some($isMarkdownImageNode);

    return holdsImage || $rangeHoldsText(selection);
}
```

```typescript
private toggleFormat(format: TextFormatType): this {
    const applies = this.commandApplies("canFormat");

    if (!applies) { return this; }

    this.ensureEditor().update(() => {
        $formatWritably(format, $cellTakesFormat, $selectEnclosingWordIfCollapsed);
    }, { discrete: true });

    return this;
}
```

Each format method keeps its source-mode branch and ends in `return this.toggleFormat("bold");` (with its own format name).

`patchSelectionStyle`, after its `commandApplies("canStyle")` return:

```typescript
this.ensureEditor().update(() => {
    $editWritably(() => {
        $selectEnclosingWordIfCollapsed();

        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
            $patchStyleText(selection, patch);
        }
    });
}, { discrete: true });
```

`toggleLink`, after its source-mode and read-only returns (both stay as they are):

```typescript
if (url === null) {
    this.unlinkSelection();

    return this;
}

const applies = this.commandApplies("canLink");

if (!applies) { return this; }

this.ensureEditor().update(() => {
    $editWritably(() => {
        $selectEnclosingWordIfCollapsed();
        $toggleLink(url);
    });
}, { discrete: true });

return this;
```

`unlinkSelection()` holds today's `url === null` path, unchanged in behaviour: return when `declinesInTextOnlyBlock()`; then in one discrete update return for a selection that is not a range, call `$moveRangeEdgesOutOfLinks(selection)`, return when `$selectionCoversSourceRun() || $selectionInNestedLinkRun()`, and run `$editWritably(() => { $toggleLink(null); })`. Name each call's result before testing it, as the file does (`const declined = …; if (declined) { return; }`).

`paste()`, replacing the update that inserts the text ([MarkdownEditor.ts:5078](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L5078)):

```typescript
this.ensureEditor().update(() => {
    let selection = $getSelection();

    // With no selection the text goes in at the document's end, as insertTable() and insertImage() put theirs.
    if (selection === null) {
        $getRoot().selectEnd();
        selection = $getSelection();
    }

    if ($isRangeSelection(selection)) {
        $removeGuardedRange(selection);
    }

    // A table selection takes the text into its cells from the one it began in, as Ctrl/Cmd+V does.
    selection?.insertRawText(text);
}, { discrete: true });
```

---

## Ordered Implementation Steps

Write the tests of each step first and see them fail (see `## Expected Behaviour`), then the code. Run only the named test files while working; the full suite runs once, in step 12.

1. **`markdown-editor.test.ts` — extend the consistency test (C1–C4).** In the `availability, read from the live selection` describe ([:5051](../packages/lib/tests/component/markdown-editor.test.ts#L5051)): add `FORMAT_COMMAND_ROUTES` and `routesOf(field)` and use `routesOf` in the three per-case loops; add cases N1–N6 to `CASES`; remove `'canLink'` from `a bare caret in prose` and reword its comment; add the two new per-case tests (menu link item, `paste()`). Add `FORMAT_TEXT_COMMAND` to the `lexical` import. Check (from `packages/lib`): `npx vitest run tests/component/markdown-editor.test.ts -t "availability, read from the live selection"` fails in the classes listed under *Red phase* and nowhere else.
2. **`markdown-editor.test.ts` — the other new unit tests.** Add the S7, S8, D, F, L and P cases, importing what their helpers need (`PASTE_COMMAND`, `$isRootNode`, `PointType`). Rewrite the test at [:4015](../packages/lib/tests/component/markdown-editor.test.ts#L4015) to "`Insert link…` is enabled exactly when `availability.canLink` is `true`, whatever `hasSelectedText`" (four contexts per kind: both values of each). Rewrite the test at [:1069](../packages/lib/tests/component/markdown-editor.test.ts#L1069) to P4. Reword the comment at [:3622](../packages/lib/tests/component/markdown-editor.test.ts#L3622): the toggle's update is now discrete, and the `await` is harmless.
3. **`markdownWritable.ts` — read every format from the text (defect 3).** Replace the body of `$selectionHasFormat` as in `## Internal Structure`. Rewrite its JSDoc: a range is read from its counted characters for all five formats; code and underline count every selected character; a collapsed selection, and a range with no counted character, read the selection's own format. Check: the F tests pass; `npx vitest run tests/component/markdown-importer.test.ts` (from `packages/lib`) stays green.
4. **`markdownWritable.ts` — restore what the selection carried (defect 2).** Add the `format` and `style` parameters to `$restoreSelection` ([:2410](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts#L2410)) and pass them from `$editOrRestore`, as in `## Internal Structure`. Update both JSDocs. The D cases stay red until steps 6 to 8 move the widening inside the edit.
5. **`markdownWritable.ts` and `MarkdownEditor.ts` — the format handler (defect 1). These edits must ship together to compile.**
   - `markdownWritable.ts`: replace `$formatWritably` as in `## Internal Structure`. Rewrite its JSDoc: it no longer decides whether a format is declined outright (its callers read `canFormat`), `widen` is run inside the checked edit so a declined format restores the caret, and it returns nothing.
   - `MarkdownEditor.ts`: delete `$declinesFormat` ([:2577–2588](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2577)). Move `registerWritableFormatCommand` (with its JSDoc) to directly below `$readCommandAvailability` ([:3270](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3270)), add `$handleFormatCommand` above it, and register that function by name. In the moved JSDoc replace "declines where `$declinesFormat` rules a format out" by "declines where `canFormat` is `false`". Fix the `{@link $declinesFormat}` in `$cellTakesFormat`'s JSDoc ([:2497](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L2497)) to name `$selectionCoversSourceRun` instead.
   - Check: `grep -rn 'declinesFormat' packages/lib/src` — zero matches. `npm run typecheck` passes, and the command routes of `A9` pass.
6. **`MarkdownEditor.ts` — `toggleFormat` (defects 1 and 2).** Add the private method above `toggleBold` ([:4432](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L4432)) with a JSDoc in the style of `toggleList`'s ("Shared body of the five format toggles on the WYSIWYG surface…"). In each of the five methods replace everything after the `handledBySource` return by `return this.toggleFormat("<format>");`. Check: `grep -rn 'dispatchCommand(FORMAT_TEXT_COMMAND' packages/lib/src` — zero matches.
7. **`MarkdownEditor.ts` — `patchSelectionStyle` (defect 2).** Replace its update as in `## Internal Structure`. Remove the now-unused `inLink`, `expanded` and `coversSourceRun` locals.
8. **`MarkdownEditor.ts` — links (defects 2, 4, 5).**
   - Replace `$selectionHoldsLinkable` as in `## Internal Structure` and rewrite its JSDoc. In `$readInlineAvailability` ([:3203](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3203)) pass `expansion` and `inLink`.
   - Rewrite `toggleLink` as in `## Internal Structure` and add `unlinkSelection()` below it. Move the comment "Unlinking has no field of its own…" into `unlinkSelection`'s JSDoc. In `toggleLink`'s JSDoc add: with a URL, a caret with no word under it and outside a link is a no-op.
   - `buildLinkMenuItems` ([:6271](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6271)): `enabled: availability.canLink` for Insert link…; narrow its `context` parameter to `{ linkUrl?: string | null }`; reword its JSDoc ("dimmed where there is nothing to link").
   - Replace `canLink`'s JSDoc on `MarkdownEditorSelectionState` ([:161](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L161)) with the text in `## Public API`.
   - Check: `grep -n '\$selectionCoversSourceRun()' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — exactly two call sites, in `$readInlineAvailability` and `unlinkSelection`. `grep -n 'hasSelectedText &&' packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` — zero matches.
9. **`MarkdownEditor.ts` — `paste()` (defect 6).** Replace the insert update as in `## Internal Structure`. Rewrite the JSDoc's first paragraph: at the caret, replacing a selection; into the selected table cells from the cell the selection began in; at the document's end with no selection. In `clipboardMenuItems`'s JSDoc ([:6240](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L6240)) replace "Paste is always enabled and acts on the live selection" by "Paste is always enabled: `paste()` has somewhere to paste at every selection".
10. **`MarkdownDocumentPanel.ts` and its tests (defect 5).** In `markdown-document-panel.test.ts` add the T cases first. Then change [MarkdownDocumentPanel.ts:549](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L549) to `this._linkBtn.setEnabled(state.canLink || state.canRemoveLink);` and reword `applySelectionState`'s JSDoc ("linking the text or image there is to link"). Check: `grep -n 'hasSelectedText' packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` — zero matches.
11. **`markdown-editor-context-menu-mounted.test.ts` — real key events (S9).** Add a describe `MarkdownEditor, mounted: the format shortcuts` with the S9 cases. Change the test at [:233](../packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts#L233) to format through `lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')` instead of `editor.toggleBold()`: the command is where the editor's handler and the table observer's meet, and `toggleBold()` no longer dispatches it. Update the file's header comment the same way.
12. **JSDoc sweep, docs and full check.** In `$readCommandAvailability`'s JSDoc ([:3240](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L3240)) and `commandApplies`'s, say that a format, style or link the save could not write is still declined when tried, and then leaves the document and the selection as they were. Apply `## Documentation Impact`. Run `## Verification`.

### Red phase

A draft of step 1 was run against `63a81117d`. A *command route* in the table is a `FORMAT_TEXT_COMMAND` dispatch (C1). These classes fail before the code changes, and no other test of that describe does:

| Test | Fails for |
|---|---|
| "the context carries what is available there" | `a bare caret in prose`, N2, N4, N5 (`canLink` reads `true`) |
| "every command reported unavailable there changes nothing" | the command routes in `A4`, `A7: a caret inside a word…`, N1, the three table selections with no cell to format, and the five ranges holding no text; `toggleLink` in `a bare caret in prose`, N2, N4, N5 |
| "in a read-only editor … no command changes anything" | the command routes, in every case where they change anything today |
| "the menu's link item is dimmed by `canLink` alone" | `a range over an image alone` |
| "`paste()` pastes there" | the six table selections and the four cases with no selection |

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/markdownWritable.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts` |
| Modify | `packages/lib/tests/component/markdown-editor.test.ts` |
| Modify | `packages/lib/tests/component/markdown-document-panel.test.ts` |
| Modify | `packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts` |
| Modify | `packages/lib/docs/components/MarkdownEditor.md` |
| Modify | `packages/lib/docs/components/MarkdownDocumentPanel.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/reference/migration/next.md` |

---

## Expected Behaviour

"Unit" cases run offline against the headless Lexical editor, as the existing tests of `markdown-editor.test.ts` do. A "command route" below is `lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, format)`: the one call Lexical's key and input handlers make. "Mounted" cases run under jsdom in `markdown-editor-context-menu-mounted.test.ts`. "Manual" cases need Chromium.

"Changes nothing" means what the consistency test's `A9` asserts today: the saved Markdown, every node by key and type, the selection (points, pending format and style) are equal before and after; no Lexical update listener runs; neither `"change"` nor `"selectionstate"` fires; Undo can take as many steps as in an untouched editor.

### C — the consistency test (unit)

**C1 — routes.** Add, beside `COMMANDS`:

```typescript
/** The route Lexical's key and input handlers take to a format: the command, not the method. */
const FORMAT_COMMAND_ROUTES: Array<[string, (editor: MarkdownEditor) => void]> = [
    ['Ctrl+B (FORMAT_TEXT_COMMAND bold)', (editor) => { lexicalOf(editor).dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'); }],
    // …the same for 'italic' (Ctrl+I), 'underline' (Ctrl+U), 'strikethrough' (formatStrikeThrough input) and 'code'
];

/** Every route to the commands a field covers. */
const routesOf = (field: keyof CommandAvailability): Array<[string, (editor: MarkdownEditor) => void]> =>
    (field === 'canFormat' ? [...COMMANDS[field], ...FORMAT_COMMAND_ROUTES] : COMMANDS[field]);
```

Use `routesOf(field)` in place of `COMMANDS[field]` in three loops: `A9: every command reported unavailable there…` ([:5470](../packages/lib/tests/component/markdown-editor.test.ts#L5470)), `every command reported available there applies` ([:5498](../packages/lib/tests/component/markdown-editor.test.ts#L5498)) and the read-only loop ([:5747](../packages/lib/tests/component/markdown-editor.test.ts#L5747)). The test `A9: with every command available, the format, style and link commands change the document` ([:5697](../packages/lib/tests/component/markdown-editor.test.ts#L5697)) keeps `COMMANDS`: a command route at a caret leaves a format pending and does not change the document.

**C2 — cases.** Change one case and add six to `CASES`:

| # | Name | Markdown | Selection | `available` |
|---|---|---|---|---|
| — | `a bare caret in prose` (existing) | `a  b word` | caret at offset 2 | remove `canLink` |
| N1 | a caret inside the word of a task-list marker | `- [ ] one\n- [x] two` | `caretIn(editor, '[x] ', 1)` | `canSetBlockType`, `canSetBlockLayout`, `canInsertParagraphAroundBlock`, `canInsertTable`, `canInsertImage` |
| N2 | a caret at the end of a run kept as Markdown source | `kept <span>x</span> source` | `caretIn(editor, '<span>', 6)` | `canFormat`, `canStyle`, `canSetBlockType`, `canSetBlockLayout`, `canInsertTable`, `canInsertImage` |
| N3 | a bare caret inside a link | `A [te  xt](https://x) link.` | `caretIn(editor, 'te  xt', 3)` | `canFormat`, `canLink`, `canRemoveLink`, `canSetBlockType`, `canSetBlockLayout`, `canInsertTable`, `canInsertImage` |
| N4 | a caret at the end of a paragraph, after a full stop | `Left column.` | `caretIn(editor, 'Left column.', 12)` | as N2 |
| N5 | a caret in a paragraph holding an image alone | `![i](/i.png)` | `selectStart(editor)` | as N2 |
| N6 | an underlined word selected from code | `++c++ x` | `selectPoints(editor, { text: 'c', offset: 0 }, { text: 'c', offset: 1 })` | `canFormat`, `canStyle`, `canLink`, `canClearFormatting`, `canSetBlockType`, `canSetBlockLayout`, `canInsertTable`, `canInsertImage` |

**C3 — the menu's link item (new per-case test).** For every case: classify at the caret (`classifyAtCaret`), build the items with `buildContextMenuItems`, and take `findItem(items, 'Insert link…') ?? findItem(items, 'Edit link…')`. When the menu has such an item, its `enabled` equals `available.includes('canLink')`.

**C4 — `paste()` (new per-case test, `async`).** For every case, with `DOM.source.readClipboardText` mocked to resolve `'pasted'`: `await editor.paste()` resolves `true` and `getValue()` differs from before.

### S — the format shortcuts (defect 1)

The consistency test covers S1–S6 through C1 and C2. S7 and S8 are their own tests.

| # | Document and selection | Command route, each of the five formats | Test |
|---|---|---|---|
| S1 | `kept <span>x</span> source`, caret at offset 3 of `<span>` (`A4`) | changes nothing | unit (C1) |
| S2 | `[[b - c](https://y)](https://x)`, caret at offset 5 of `b - c` (`A7`); `- [x] two`, caret at offset 1 of `[x] ` (N1) | changes nothing | unit (C1) |
| S3 | `one\n\ntwo`, range from the end of `one` to the start of `two` | changes nothing (it added an undo step) | unit (C1) |
| S4 | `a ![i](/i.png) b`, range from the paragraph at offset 1 to offset 2 of `a ` | changes nothing (it formatted `a `) | unit (C1) |
| S5 | table cells selected, none of which takes a format (kept source in each, empty, or an image alone) | changes nothing (it ran an update) | unit (C1) |
| S6 | any case where `canFormat` is `true` | changes the document or the selection | unit (C1) |
| S7 | S1, then `Q` typed (`selection.insertText('Q')`) after `"bold"` | `kept Qx</span> source`, as without the command | unit |
| S8 | `hello world`, caret at offset 8, `"bold"`, then `Q` typed | `hello wo**Q**rld` (unchanged behaviour) | unit |
| S9 | mounted editor; a real `new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })` dispatched on the root element, `key` = `b`, `i`, `u` | S1's document, caret at offset 3 of `<span>`: the selection's `format` stays `0`. `hello world`, caret at offset 8: `format` becomes `1`, `2`, `8` | mounted |

### D — declined after trying (defect 2)

Each case: `canFormat` / `canStyle` / `canLink` is `true`, and the save cannot write the result.

| # | Document and selection | Call | Test |
|---|---|---|---|
| D1 | `**a+b** x`, caret at offset 1 of `a+b` | `toggleUnderline()` | unit |
| D2 | `**a]b** x`, caret at offset 1 of `a]b` | `setTextColor('#f00')` | unit |
| D3 | `` x`(a)`b ``, caret at offset 1 of `(a)` | `toggleBold()` | unit |
| D4 | `hello world`, caret at offset 8 | `toggleLink('a\nb')` (a URL holding a line break) | unit |
| D5 | D1, with `selection.setFormat(2)` and `selection.setStyle('color: red')` on the caret first | `toggleUnderline()` | unit |
| D6 | `a+b x`, range over `a+b` | `toggleUnderline()` (control: a range already behaves so) | unit |
| D7 | D6's selection | the command route, `"underline"` (control) | unit |

Expected for D1–D7:

- `getValue()` is unchanged.
- The selection is where it was and as it was: same place, still collapsed for D1–D5, same pending format and style (for D5: `2` and `color: red`).
- Neither `"change"` nor `"selectionstate"` fires, and `getSelectionState()` equals its value before the call.
- Undo can take as many steps as in an untouched editor.

Compare the selection by place, not by node key: each point as its child-index path from the root plus offset and type. A declined edit gives the block's inline nodes back as new nodes, so their keys change (see `## Non-Goals`).

### F — formats read from the text (defect 3)

`FORMATS` is the five rows: bold `**c** x`, italic `*c* x`, strikethrough `~~c~~ x`, underline `++c++ x`, inline code `` `c` x ``. "Selected from code" means a `$createRangeSelection()` set with `$setSelection`, which carries no cached format (the existing `selectPoints` helper does this).

| # | Document and selection | Expected | Test |
|---|---|---|---|
| F1 | each `FORMATS` row, `c` selected from code | `getSelectionState()`'s flag for that format is `true`; so is the flag of `classifyAtCaret(editor)` | unit |
| F2 | F1, then the format's method once | `c x` | unit |
| F3 | F2, then the method again (selection left as it is) | the row's original Markdown | unit |
| F4 | F1, then the command route once, then again | `c x`, then the original | unit |
| F5 | `++c++ x`, range from offset 0 of `c` to offset 2 of ` x`, from code | `underline` flag `false`; `toggleUnderline()` gives `++c x++`; again gives `c x` | unit |
| F6 | `++a\nb++ x`, range from offset 0 of `a` to offset 1 of `b`, from code | `underline` flag `true`; `toggleUnderline()` gives `a\nb x` | unit |
| F7 | `MarkdownDocumentPanel` with `++c++ x`, `c` selected from code | the Underline button `isSelected()` | unit (panel test) |

### L — links (defects 4 and 5)

| # | Document and selection | `canLink` | `toggleLink('https://z')` | Menu item | Test |
|---|---|---|---|---|---|
| L1 | `a  b word`, caret at offset 2 | `false` | changes nothing | Insert link… dimmed | unit (C2, C3) |
| L2 | `Left column.`, caret at offset 12 | `false` | changes nothing | Insert link… dimmed | unit (N4) |
| L3 | `hello world`, caret at offset 8 | `true` | `hello [world](https://z)` | Insert link… enabled | unit |
| L4 | `A [te  xt](https://x) link.`, caret at offset 3 of `te  xt` | `true` | `A [te  xt](https://z) link.` | Edit link… enabled | unit (N3) |
| L5 | `a ![i](/i.png) b`, range from offset 2 of `a ` to offset 0 of ` b` | `true` | `a [![i](/i.png)](https://z) b` | Insert link… enabled | unit (C3) |
| L6 | `![i](/i.png)`, `selectStart` | `false` | changes nothing | (the empty-line menu has no link item) | unit (N5) |
| L7 | `a **b  c** d`, caret at offset 2 of `b  c` | `true` | `a **[b  c](https://z)** d` | Insert link… enabled | unit |
| L8 | hand-built `"text"` and `"table-cell"` contexts, `linkUrl: null`, `hasSelectedText` `true` and `false`, `availability.canLink` `true` and `false` | — | — | `enabled` equals `canLink` in all four | unit |

### T — toolbar (`MarkdownDocumentPanel`, unit)

| # | Document and selection | Link button |
|---|---|---|
| T1 | `a ![i](/i.png) b`, the image selected (as L5) | enabled (was disabled) |
| T2 | `a  b`, caret at offset 2 (existing test, [:330](../packages/lib/tests/component/markdown-document-panel.test.ts#L330)) | disabled |
| T3 | `hello world`, caret at offset 8 | enabled |
| T4 | `A [te  xt](https://x) link.`, caret at offset 3 of `te  xt` | enabled |
| T5 | `![i](/i.png)`, caret at the paragraph's start | disabled |

### P — paste (defect 6)

`TABLE` is `| a | b |\n| - | - |\n| c | d |\n\nafter`. The clipboard is `DOM.source.readClipboardText` mocked.

| # | Selection and clipboard | Expected | Test |
|---|---|---|---|
| P1 | `TABLE`, cells `c`..`d` selected; `PASTED` | resolves `true`; `\| a \| b \|\n\| --- \| --- \|\n\| PASTED \| d \|\n\nafter` | unit |
| P2 | `TABLE`, cells selected from `d` back to `c`; `PASTED` | the body row reads `\| c \| PASTED \|` | unit |
| P3 | P1, and the same cells with `x\ty\nz\tw` | `getValue()` equals that of a second editor given the same selection and a plain-text `PASTE_COMMAND` (the `pasteClipboard` helper of `markdown-editor-table-edge.test.ts`, [:288](../packages/lib/tests/component/markdown-editor-table-edge.test.ts#L288), shows how to build the event) | unit |
| P4 | `hello world`, `$setSelection(null)`; `X` | resolves `true`; `hello worldX` | unit |
| P5 | `para\n\n` + a fenced code block holding `code`, no selection; `X` | the code block holds `codeX` | unit |
| P6 | every consistency case | C4 | unit |
| P7 | read-only editor | resolves `false`, the clipboard is not read (existing test, unchanged) | unit |
| P8 | any `ContextMenuTarget` kind | the Paste item has no `enabled` key (existing test [:4423](../packages/lib/tests/component/markdown-editor.test.ts#L4423), unchanged) | unit |

### X — manual (Chromium)

Run on the dev demo's MD Editor page (`npm run dev`, `#/md-editor`). Load documents from the console with `setValue`.

| # | Gesture | Expected |
|---|---|---|
| X1 | `kept <span>x</span> source`: click into `<span>`, press Ctrl+B, Ctrl+I, Ctrl+U, then type `Q` | the toolbar does not change; `Q` is plain |
| X2 | Click into a plain word, Ctrl+B, type `Q` | `Q` is bold (unchanged) |
| X3 | `**a+b** x`: click into `a+b`, click the toolbar's Underline button, type `Q` | nothing is underlined; `Q` lands at the caret and does not replace `a+b` |
| X4 | `++word++ x`: select `word` with the mouse, then with Shift+arrows | each time the Underline button is pressed; a click takes the underline off, a second click puts it back |
| X5 | `a  b`: click between the two spaces | Link button disabled; right-click ▸ Insert link… dimmed |
| X6 | `a ![i](/i.png) b`: select the image alone with Shift+Right | Link button enabled; Insert link wraps the image |
| X7 | Drag-select two cells of a table; right-click ▸ Paste | the clipboard text lands in the cell the drag began in, as Ctrl+V puts it |

---

## Verification

- `npm -w packages/lib run typecheck` and `npm -w packages/lib run typecheck:test` pass.
- `npx vitest run tests/component/markdown-editor.test.ts tests/component/markdown-document-panel.test.ts tests/component/markdown-editor-context-menu-mounted.test.ts tests/component/markdown-importer.test.ts tests/component/markdown-editor-table-edge.test.ts tests/component/markdown-editor-command-crashes.test.ts tests/component/shared/buildClipboardMenuItems.test.ts` (from `packages/lib`) passes, then the whole suite once: `npm test`.
- `npm run lint` passes. `npm run docs:api` and `npm run docs:llms:check` pass.
- Grep checks: the ones in steps 5, 6, 8 and 10.
- **Each gate is pinned.** A gate is a route's first read of its field. Make each change in turn, see the named test fail, and revert:
  - `$handleFormatCommand`: replace `applies` by `true` — the command routes of `A9` fail.
  - `$handleFormatCommand`: drop `editor.isEditable() &&` — the command routes of the read-only loop fail.
  - `toggleFormat`: replace `applies` by `true` — the method rows of `A9` fail.
  - `patchSelectionStyle` and `toggleLink`: replace `applies` by `true` — `A9` fails for the style setters and for `toggleLink`.
  - `$selectionHoldsLinkable`: return `true` for a collapsed selection — `a bare caret in prose`, `a caret in an empty paragraph`, N2, N4 and N5 fail.
  - `$restoreSelection`: drop the `setFormat` / `setStyle` calls — D5 fails.
  - Move `widen?.()` in `$formatWritably` to before `$editWritably(` — D1 fails.
- The manual X cases.

---

## Documentation Impact

No barrel export changes. `MarkdownEditorSelectionState` is re-exported from `component/editor/index.ts`, so `canLink`'s new JSDoc reaches the API docs through `docs:api`.

**`docs/components/MarkdownEditor.md`**

- [:106](../packages/lib/docs/components/MarkdownEditor.md#L106), the keyboard-shortcuts bullet: add `Ctrl/Cmd+U` (underline), and the sentence "A format shortcut declines wherever the matching toggle does (`canFormat` is `false`); at a caret it leaves the format pending for the text typed next, where the toggle formats the word."
- [:108](../packages/lib/docs/components/MarkdownEditor.md#L108), the context-menu paragraph: replace "(dimmed unless there is a selection or expandable word to wrap)" by "(dimmed where there is nothing to link: no selected text or image, and no word under the caret)". Replace the sentence "Paste is the one item this does not cover: it stays enabled though it needs a text selection." by "Paste is never dimmed, because it always has somewhere to paste: while table cells are selected into those cells, starting at the cell the selection began in, as Ctrl/Cmd+V does; with no selection at the document's end."
- [:118](../packages/lib/docs/components/MarkdownEditor.md#L118), the `toggleLink(url)` row: after "(a collapsed caret first expands to its enclosing word" add "; with no word under it and outside a link, the call does nothing".
- [:134](../packages/lib/docs/components/MarkdownEditor.md#L134), the `paste()` row: after "replacing any selection." add "With table cells selected the text goes into the cells, starting at the one the selection began in, as Ctrl/Cmd+V puts it; with no selection it goes in at the document's end."
- [:136](../packages/lib/docs/components/MarkdownEditor.md#L136): change "except `insertTable` and `insertImage`, which then insert at the document's end" to name `paste()` as the third. Delete the last sentence, "The one exception is a format, style or link declined because its result could not be saved as it shows: that is found by trying it, so a collapsed caret is left expanded to its word."
- [:185](../packages/lib/docs/components/MarkdownEditor.md#L185), the `canLink` row: replace "(a caret in an empty block, or a selection holding neither text nor an image)" by "(a caret with no word under it and outside a link, or a selection holding neither text nor an image)".
- [:198–202](../packages/lib/docs/components/MarkdownEditor.md#L198): replace the sentence that runs from "`canLink` is `true` at a caret anywhere in text" to "as `MarkdownDocumentPanel`'s is." by "A caret links the word it is in, as the format toggles format it, and re-points a link it is inside; `canLink` is `false` at a caret with neither. A Link control is enabled on `canLink`, or on `canRemoveLink` for its Remove action, as `MarkdownDocumentPanel`'s is."
- [:207–210](../packages/lib/docs/components/MarkdownEditor.md#L207): after "is still declined when tried" add ", and then leaves the document, the selection and the undo history as they were".
- In *Live selection state*, after the paragraph ending "reads the three table fields below.", add: "The five format flags describe the text a format toggle would act on, read from that text however the selection was made — with the mouse, the keyboard or from code. At a caret in a word they are the word's formats. Over a selection a format is on when every selected character carries it; for bold, italic and strikethrough the edge whitespace they never stay on is left out. At a caret with no word under it they are the formats pending for the text typed next."

**`docs/components/MarkdownDocumentPanel.md`**

- [:35](../packages/lib/docs/components/MarkdownDocumentPanel.md#L35): replace "`canLink` with text to link or a link to re-point, or `canRemoveLink`" by "`canLink` (text or an image to link, or a link to re-point), or `canRemoveLink`".

**`docs/reference/changelog/next.md`**

- `## Breaking changes › ### Components`, two entries, each ending "See [Migration](/reference/migration/next)…":
  - "**`MarkdownEditor.toggleLink(url)` links nothing from a caret with no word under it.**" Outside a link, a caret between two spaces, after a full stop or beside an image linked the whole text run it stood in, or the image. The command now declines there, as it does on the source surface, and `canLink` is `false`. A caret in a word still links the word, and a caret inside a link still re-points it.
  - "**`MarkdownEditor.paste()` pastes without a text selection.**" With table cells selected it read the clipboard and inserted nothing, though Ctrl/Cmd+V pastes into the cells; with no selection it did the same. It now puts the text into the cells, starting at the one the selection began in, and with no selection at the document's end, where `insertTable` and `insertImage` insert. The context menu's Paste, which is always enabled, therefore always pastes.
- `## Fixed › ### Components`:
  - "**`MarkdownEditor`'s format shortcuts decline where the format toggles do.**" Ctrl/Cmd+B, +I and +U, and a browser's own bold, italic, underline and strikethrough commands, reached the editor past the rule the toggles read. At a caret in text kept as Markdown source they left the format pending for the next typed character; over a selection holding no text they added an undo step that undid nothing. They now read `canFormat`, as `toggleBold()` and the others do.
  - "**Underline and inline code come off a selection made from code.**" Over a selection set through the API rather than by the mouse or the keyboard, `toggleUnderline()` and `toggleInlineCode()` put the format on again instead of taking it off, and the selection state and the menu's checkmarks read it as off. All five formats are now read from the selected text.
  - "**`MarkdownDocumentPanel`'s Link button and the menu's Insert link… follow `canLink`.**" Both also asked for selected text, so with an image alone selected they were disabled though `toggleLink` wraps the image.
  - In the existing entry "**A command that declines changes nothing at all.**" ([:667](../packages/lib/docs/reference/changelog/next.md#L667)) replace the last sentence ("One case is as it was: … expanded to its word.") by "That includes a format, style or link whose result could not be saved as it shows, which is found by trying it: the caret is put back where it was, with the format and style pending at it."

**`docs/reference/migration/next.md`** — two sections in the page's format (`## Title`, **What changed and why.**, **Who needs to act.**), after "A read-only `MarkdownEditor` refuses its editing commands":

- "`MarkdownEditor.toggleLink(url)` needs a word, a selection or a link". Who needs to act: code that called `toggleLink(url)` at a caret and relied on the whole text run becoming the link; select the text first. A toolbar of your own enables its Link control on `canLink || canRemoveLink`.
- "`MarkdownEditor.paste()` pastes without a text selection". Who needs to act: code that called `paste()` with table cells selected or with no selection and relied on nothing being inserted.

---

## Potential Challenges

- **The toggles now commit synchronously.** The toggles ran through `dispatchCommand`, whose update settled on the next microtask. A test that awaited that microtask still passes; one that asserted nothing had happened yet would not. None was found.
- **Undo after a toggle at a caret restores the caret.** The widening and the format are one update now, so Undo goes back to the collapsed caret, not to the widened word. If a test pinned the widened selection after Undo, update it.
- **An existing test may have pinned the old underline/code reading.** A test that toggles underline or inline code over a selection made from code, on text that already has the format, now takes it off. `markdown-importer.test.ts`'s `selectCharsAsView` cases set the cached format and are unaffected.
- **`FORMAT_TEXT_COMMAND` rows in `markdown-importer.test.ts`.** If one fails, its selection is one `canFormat` rules out; read the record for that selection before changing the handler.
- **`markdown-editor-paste-undo-merge` also edits `paste()`'s update.** If that plan landed first, keep the tag it puts on the update and change only the update's body.
- **`selection?.insertRawText(text)` type.** `$getSelection()` returns `BaseSelection | null`, and `insertRawText` is on `BaseSelection`, so no cast is needed.
- **jsdom key events.** S9 was tried on `63a81117d`: a `keydown` with `ctrlKey: true` dispatched on the root element reaches `FORMAT_TEXT_COMMAND`. The editor needs a root element first (the suite's `mounted()` helper).

---

## Critical Files

- [`MarkdownEditor.ts`](../packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts) — `$selectionCoversSourceRun` (:2524), `$declinesFormat` (:2586), `registerWritableFormatCommand` (:2718), `$computeWordExpansion` (:2834), `$selectEnclosingWordIfCollapsed` (:2896), `$readFormatFlags` (:2935), `$selectionHoldsLinkable` (:3156), `$readInlineAvailability` (:3191), `$readCommandAvailability` (:3255), `commandApplies` (:4067), `toggleList` (:4113, the shared-body precedent), the five toggles (:4432–4581), `patchSelectionStyle` (:4607), `toggleLink` (:4792), `paste` (:5058), `insertImage` (:5406, the document-end precedent), `clipboardMenuItems` (:6248), `buildLinkMenuItems` (:6271).
- [`markdownWritable.ts`](../packages/lib/src/typescript/lib/component/editor/markdownWritable.ts) — `$editWritably` (:1968) and `$editOrRestore` (:1988, the edit-check-restore precedent), `$formatWritably` (:2056), `$formatCellsWritably` (:2103) and `cellsHaveFormat` (:2159, the text-reading precedent), `$selectionHasFormat` (:2216), `$countedCarries` (:2240), `$restoreSelection` (:2410).
- [`MarkdownDocumentPanel.ts:535`](../packages/lib/src/typescript/lib/component/editor/MarkdownDocumentPanel.ts#L535) — `applySelectionState`.
- [`markdownSourceEdits.ts:1013`](../packages/lib/src/typescript/lib/component/editor/markdownSourceEdits.ts#L1013) — `linkSource`: the source surface already declines a link at a caret with no word under it.
- [`markdown-editor.test.ts:5051`](../packages/lib/tests/component/markdown-editor.test.ts#L5051) — the consistency test: `CASES` (:5117), `COMMANDS` (:5348), `stateOf` / `undoDepthOf` (:5430), the per-case tests (:5449).
- [`markdown-editor-context-menu-mounted.test.ts`](../packages/lib/tests/component/markdown-editor-context-menu-mounted.test.ts) — the `mounted()` helper for S9.
- `plans/implemented/markdown-editor-context-menu-caret.md` — the rule, and the *Still open* entries this plan closes.
- `node_modules/lexical/src/LexicalEvents.ts` (0.49.0) — `$handleKeyDown` and the `beforeinput` switch, the only places that dispatch `FORMAT_TEXT_COMMAND`. `node_modules/@lexical/table/src/LexicalTableSelection.ts` — `TableSelection.insertRawText`.

---

## Non-Goals

- **Foreseeing a save that cannot be written.** `canFormat`, `canStyle` and `canLink` stay `true` where a command is declined only after trying (D1–D4). One `canFormat` field covers five formats, and whether a result can be saved depends on the format and on the text.
- **A declined-after-trying edit that touches no node.** `$editWritably` still runs one update, tagged so that it adds no undo step, and gives the declined block's inline nodes back as new nodes. A range already behaved so; this plan only makes the selection exact.
- **A field for unlinking.** `toggleLink(null)` keeps its own checks.
- **`toggleLink(url)` with the URL the link already has.** The call widens the caret and adds an undo step that undoes nothing. The menu and the Link popup both skip such a submit.
- **Cut and Copy while table cells are selected.** Both stay dimmed and do nothing, which is consistent; the keyboard copies and cuts the cells.
- **A caret inside a kept-source run with no word under it.** `canFormat` stays `true` there and both routes leave the format pending, as at any caret with no word under it.
- **Showing a pending format at a caret inside a word.** The format flags describe the word, which is what a toolbar toggle acts on, so a format left pending by a shortcut there is not shown.
- **Removing the link around an image.** With the image selected as a range, the anchor is outside the link, so `linkUrl` is `null` and `canRemoveLink` is `false`.
- **Source mode.** The fields and the commands of the source surface are unchanged.
- **Firefox and WebKitGTK.** Not run in this stack so far; X is Chromium.

---

## Addendum: Routes checked

Every route by which a key, an input event or a control reaches a command was checked for skipping the availability record.

| Route | Reaches | Finding |
|---|---|---|
| Ctrl/Cmd+B, +I, +U | `FORMAT_TEXT_COMMAND` | skipped the record: defect 1, plus the classes in the next table. Fixed by the handler reading `canFormat` |
| `beforeinput` `formatBold` / `formatItalic` / `formatUnderline` / `formatStrikeThrough` | the same command | the same fix covers it |
| Ctrl/Cmd+Z, +Y | undo / redo | not a command the record covers |
| Tab | `KEY_TAB_COMMAND` | `registerRichText`'s handler returns `false`; no indent command is dispatched |
| `SET_TEXT_FORMAT_COMMAND`, `FORMAT_ELEMENT_COMMAND`, `INDENT_CONTENT_COMMAND`, `OUTDENT_CONTENT_COMMAND` | handlers registered by `registerRichText` | nothing dispatches them: no key in Lexical's `$handleKeyDown`, and no call in `packages/lib/src` |
| Ctrl+E, Ctrl+K, Ctrl+`` ` ``, Ctrl+Shift+S, Ctrl+Shift+X, Ctrl+Shift+7, Ctrl+] (tried in jsdom) | nothing | no format command is dispatched |
| Any key on a read-only editor (tried in jsdom) | nothing | Lexical delivers no key or input event to an editor that is not editable |
| Markdown typing shortcuts (`**q**`) | `$editWritably`, through the guarding proxy | no skip. A character typed inside a kept-source run first turns the run into ordinary text, so the shortcut formats ordinary text |
| Context menu: format rows, Text style, link items, Clear formatting, Block style, Alignment, Columns, Insert, Table | the public methods | each reads its field. Insert link… was narrower than `canLink` (defects 4 and 5) |
| Context menu prompts (link URL, column width, image) | the method, after the dialog closes | the method reads its field when it runs |
| Context menu: Cut, Copy | `cut()`, `copy()` | no field; dimmed by `hasSelectedText` wherever they do nothing |
| Context menu: Paste | `paste()` | enabled where it did nothing (defect 6) |
| Toolbar: format buttons, Link popup, Insert, Table, Text style, Alignment, Columns | the public methods | each reads its field. The Link button was narrower than `canLink` (defects 4 and 5) |

Running the command route over the consistency test's 39 cases on `63a81117d` broke the rule in ten of them, all with `canFormat` `false`:

| Selection | What the command route did |
|---|---|
| Caret in a word of a kept-source run, or of a link nested in a link (2 cases) | left the format pending |
| Table cells none of which takes a format (3 cases) | ran an update that changed nothing |
| Range from the end of one block to the start of the next | added an undo step that undid nothing |
| Zero-width range between a point on a block and the same place in its text (2 cases, selections made from code) | formatted the whole neighbouring text node |
| The same block gap held as two points on blocks (2 cases, selections made from code) | changed the selection and added an undo step that undid nothing |

With a stand-in for the new handler (a handler that reads the record and swallows the command where `canFormat` is `false`), all 39 cases held for all five formats.

---

## Notes

[^handler-gate]: `$declinesFormat` tested two of the record's conditions (a raw or code block; a range covering a kept-source run) and missed the rest: a caret that would widen into such a run, a range holding no text, table cells that take no format. The record already holds every condition, so the handler reads the record instead of growing a second list. `editor.isEditable()` is Lexical's own flag, which `setReadOnly` and `buildEditor` keep equal to `!getReadOnly()`; it stands in for the read-only test `commandApplies` makes, because `commandApplies` calls `editor.read`, which must not run inside the update a command handler is in. Lexical delivers no key event to a non-editable editor today, but a sibling plan (`markdown-editor-readonly-keyboard-selection`) may let a read-only surface take the keyboard, and a direct `dispatchCommand` reaches the handler either way. The handler now always reports the command handled. It reported it unhandled only with no selection, where `registerRichText`'s own handler then did nothing. *Addendum: Routes checked* lists every route that was examined and the selections at which the command route broke the rule.

[^one-update]: The methods ran two updates: one widening the caret, then `dispatchCommand`, whose handler formatted. A format declined in the second update could only restore the selection the first one had already widened, which is defect 2. Keeping `dispatchCommand` would need the handler to know whether to widen, and the keyboard must not widen: Ctrl+B at a caret leaves bold pending, which is what every editor does. Passing the widening step as a callback keeps one formatting function for both routes, and `$formatWritably` already takes its rules from `MarkdownEditor.ts` as callbacks (`takesFormat`), since `markdownWritable.ts` cannot import from the module that imports it. Lexical's `TextNode.select` moves the existing selection object in place, but the snippet re-reads `$getSelection()` after widening so that it does not depend on that.

[^restore-not-clone]: Three ways to make the decline exact were weighed. Deciding from the record alone is not possible: whether a result can be saved is known only once the block is written and read back. Trying the edit on a detached copy would need `$formatText`, `$patchStyleText` and `$toggleLink` to run against a selection in nodes outside the document, and the update would still commit because creating nodes marks it dirty. Restoring is what `$editOrRestore` already does for a range, by a path from the root that survives the block's nodes being rebuilt; widening inside the edit makes that same restore return the caret. Measured on `63a81117d` with the widening moved inside `$editWritably`: the caret comes back collapsed at its place, no event fires and the undo depth is unchanged. The one loss was the pending format and style (`format=3`, `style=color: red` came back as `0` and empty), which the two new parameters of `$restoreSelection` fix. The same loss made a declined bold at a caret in an inline-code run fire `"selectionstate"` (the restored range read as not code).

[^text-reading]: Lexical fills `selection.format` when the browser's selection changes. A selection made in code has `0` there, so underline and code read as off and the toggle "put on" a format that was already on, changing nothing. The marked-import branch fixed this for bold, italic and strikethrough (which needed the count anyway, to leave out edge whitespace) and later for table cells (`cellsHaveFormat`). `$countedCarries` already returns every selected character for underline and code, so the range path needs no new counting, only to stop branching on the format. Simulated on `63a81117d` by reading the text and aligning to it: all five formats go off and on again, a mixed selection gets the format, and a soft line break inside an underlined span carries the underline and is counted.

[^caret-link]: The command's own JSDoc says a bare caret "links just that word rather than the whole enclosing text run", and the docs table says the caret "first expands to its enclosing word". With no word to expand to, Lexical's `$toggleLink` wraps the whole text node the collapsed selection sits in, which nobody asked for. The source surface already declines there (`linkSource`: "nothing to wrap (a collapsed caret with no word under it)"), and the toolbar and menu already refused such a caret through `hasSelectedText`. Inserting the URL as the link's text was rejected: it is a new feature with its own questions (autolink or `[url](url)`), not a fix. Inside a link a caret needs no word: `$toggleLink` re-points the enclosing link. A caret beside an image got `canLink` through a quirk (a collapsed selection on a block lists the node at its point); an image is linked by selecting it.

[^one-link-rule]: `hasSelectedText` was the controls' stand-in for "the caret has a word", which `canLink` did not say. It is `false` for a selection holding an image alone, so both controls refused what the command does (defect 5). With `canLink` saying it, the extra test only narrows. For a caret, "widens to a word" is exactly when `hasSelectedText` is `true`, so no control becomes enabled where it was not, apart from the image selection.

[^paste-acts]: A `canPaste` field was the alternative: a twelfth public field, an option on the shared builder, and Paste dimmed in both cases. It was rejected because of what the keyboard does. Measured on `63a81117d`: with table cells selected, a plain-text `PASTE_COMMAND` (Ctrl/Cmd+V) puts the text into the cell the selection began in, through Lexical's `TableSelection.insertRawText`. A dimmed Paste would then sit beside a working Ctrl+V. `paste()` already inserts with `selection.insertRawText(text)`; only its `$isRangeSelection` test kept the table selection out. Calling the same method on whichever selection there is gave the same document as Ctrl+V in all six table-selection cases of the consistency test, and changed the document in all 39 cases. The inserts go to the document's end while cells are selected and paste does not; paste differs because it has a keyboard twin whose result is already fixed. With no selection there is no keyboard twin, so `paste()` follows the two commands that already handle that state. Paste then has no selection at which it does nothing, so there is nothing for a field to report, and the builder's statement that Paste never sets `enabled` stays true.

[^no-second-copy]: After the field is `true`, each removed check can only repeat the field's answer. The widened selection spans one node, so `$selectionCoversSourceRun()` on it equals the per-node test the record made on the expansion, and `$selectionInNestedLinkRun()` reads the two end nodes, which widening does not change. A repeated check also hides a missing gate: with the check gone, replacing a gate by `true` makes the command act, which the consistency test catches (see `## Verification`).

[^test-routes]: `FORMAT_TEXT_COMMAND` is what `$handleKeyDown` dispatches for Ctrl/Cmd+B, +I and +U and what the `beforeinput` switch dispatches for the four `format…` input types, so dispatching it tests everything behind the key binding offline. The binding itself was checked under jsdom: a `keydown` with `ctrlKey` on the root element reaches the command for `b`, `i` and `u`, and for none of eight other chords. The "applies" loop cannot catch defect 3 (the toggle changed the cached format, so the selection differed), which is why F has its own tests.
